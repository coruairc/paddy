import { envPresence, resolveBrain, callBrain } from "./brain";
import { cliTurnSeed } from "./defaults";
import { applyMutation, curatorPass } from "./mutate";
import { PROVIDER_DEFS, type ProviderId } from "./providers";
import { executeTurn } from "./run-turn";
import type { HelixTurnInput, MemoryKind, Mutation, Skill, Ticket, WorkspaceState } from "./types";
import { timingSafeEqual } from "node:crypto";

export const CLI_PROTOCOL = 1;

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-paddy-cli": String(CLI_PROTOCOL),
    },
  });
}

function expectedToken(): string {
  return (process.env.PADDY_CLI_TOKEN ?? "").trim();
}

function bearer(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? "";
}

function tokenMatch(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cliAuthorized(request: Request): boolean {
  const expected = expectedToken();
  if (!expected || expected.length < 16) return false;
  const got = bearer(request);
  return got.length > 0 && tokenMatch(got, expected);
}

function publicStatus() {
  const env = envPresence();
  const preferred = (process.env.PADDY_MODEL as ProviderId | undefined) || "supergrok";
  const resolved = resolveBrain(preferred, {});
  return {
    ok: true as const,
    protocol: CLI_PROTOCOL,
    name: "paddy",
    gateway: true,
    locked: !expectedToken(),
    preferred: resolved.ok ? resolved.route.provider : preferred,
    model: resolved.ok ? resolved.route.model : null,
    label: resolved.ok ? resolved.route.label : null,
    env,
    providers: PROVIDER_DEFS.map((d) => ({
      id: d.id,
      name: d.name,
      model: d.model,
      slot: d.slot,
      envVar: d.envVar,
      connected: d.id === "local" ? Boolean(env.ollama) : Boolean(env[d.slot]),
    })),
  };
}

function asHistory(raw: unknown): HelixTurnInput["history"] {
  if (!Array.isArray(raw)) return [];
  const out: HelixTurnInput["history"] = [];
  for (const item of raw.slice(-12)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { role?: unknown; content?: unknown };
    if ((rec.role === "user" || rec.role === "assistant") && typeof rec.content === "string") {
      out.push({ role: rec.role, content: rec.content.slice(0, 2500) });
    }
  }
  return out;
}

function asFiles(raw: unknown): Partial<HelixTurnInput["files"]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const keys = ["soul", "identity", "user", "memory", "agents", "heartbeat"] as const;
  const overlay: Partial<HelixTurnInput["files"]> = {};
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) overlay[k] = v;
  }
  return Object.keys(overlay).length ? overlay : undefined;
}

function asMemories(raw: unknown): HelixTurnInput["memories"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HelixTurnInput["memories"] = [];
  for (const item of raw.slice(-48)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { text?: unknown; kind?: unknown };
    if (typeof rec.text !== "string" || !rec.text.trim()) continue;
    const kind: MemoryKind =
      rec.kind === "preference" || rec.kind === "lesson" || rec.kind === "episode" ? rec.kind : "fact";
    out.push({ text: rec.text.slice(0, 800), kind });
  }
  return out;
}

function asSkills(raw: unknown): HelixTurnInput["skills"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HelixTurnInput["skills"] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      name?: unknown;
      description?: unknown;
      instructions?: unknown;
      status?: unknown;
      uses?: unknown;
      triggers?: unknown;
    };
    if (typeof rec.name !== "string" || !rec.name.trim()) continue;
    const triggers = Array.isArray(rec.triggers)
      ? rec.triggers.filter((t): t is string => typeof t === "string").slice(0, 8)
      : [];
    const status =
      rec.status === "new" ||
      rec.status === "active" ||
      rec.status === "stale" ||
      rec.status === "archived"
        ? rec.status
        : "active";
    out.push({
      name: rec.name.slice(0, 48),
      description: typeof rec.description === "string" ? rec.description.slice(0, 240) : "",
      instructions: typeof rec.instructions === "string" ? rec.instructions.slice(0, 4000) : "",
      status,
      uses: typeof rec.uses === "number" && Number.isFinite(rec.uses) ? rec.uses : 0,
      triggers,
    });
  }
  return out;
}

function asTickets(raw: unknown): HelixTurnInput["tickets"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HelixTurnInput["tickets"] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; title?: unknown; body?: unknown; status?: unknown };
    if (typeof rec.title !== "string" || !rec.title.trim()) continue;
    const status =
      rec.status === "doing" || rec.status === "done" || rec.status === "backlog" ? rec.status : "backlog";
    out.push({
      id: typeof rec.id === "string" ? rec.id : `tk_${out.length}`,
      title: rec.title.slice(0, 120),
      body: typeof rec.body === "string" ? rec.body.slice(0, 800) : "",
      status,
    });
  }
  return out;
}

function asDaily(raw: unknown): { date: string; content: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { date: string; content: string }[] = [];
  for (const item of raw.slice(0, 14)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { date?: unknown; content?: unknown };
    if (typeof rec.date !== "string" || typeof rec.content !== "string") continue;
    out.push({ date: rec.date.slice(0, 10), content: rec.content.slice(0, 2000) });
  }
  return out;
}

function toWorkspace(
  files: HelixTurnInput["files"],
  skills: HelixTurnInput["skills"],
  memories: HelixTurnInput["memories"],
  tickets: HelixTurnInput["tickets"],
  dailyNotes: { date: string; content: string }[],
  extra: Partial<Pick<WorkspaceState, "wakes" | "canvas" | "checkpoints">> = {},
): WorkspaceState {
  const now = Date.now();
  return {
    files,
    skills: skills.map((s, i) => {
      const row: Skill = {
        id: `sk_${s.name}_${i}`,
        name: s.name,
        description: s.description,
        instructions: s.instructions,
        triggers: s.triggers ?? [],
        status: s.status,
        uses: s.uses,
        lastUsedAt: null,
        createdAt: now,
        origin: "seeded",
      };
      return row;
    }),
    memories: memories.map((m, i) => ({
      id: `mem_${i}`,
      text: m.text,
      kind: m.kind,
      at: now,
      source: "cli",
    })),
    messages: [],
    traces: [],
    canvas: extra.canvas ?? [],
    checkpoints: extra.checkpoints ?? [],
    wakes: extra.wakes ?? [],
    dailyNotes,
    tickets: (tickets ?? []).map((t) => {
      const row: Ticket = {
        id: t.id,
        title: t.title,
        body: t.body,
        status: t.status,
        at: now,
        updatedAt: now,
      };
      return row;
    }),
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      turns: 0,
      toolCalls: 0,
      lastModel: "",
      lastProvider: "",
      lastAt: null,
      turnsSinceMemoryWrite: 0,
      lastTurnToolCalls: 0,
      skillNudge: false,
    },
    sessions: [],
  };
}

function packWorkspace(ws: WorkspaceState) {
  return {
    files: ws.files,
    memories: ws.memories.map((m) => ({ text: m.text, kind: m.kind })),
    skills: ws.skills.map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      status: s.status,
      uses: s.uses,
      triggers: s.triggers,
    })),
    tickets: ws.tickets,
    dailyNotes: ws.dailyNotes,
    wakes: ws.wakes.map((w) => ({
      id: w.id,
      at: w.at,
      reason: w.reason,
      note: w.note,
      fired: w.fired,
      notified: w.notified ?? false,
    })),
    canvas: ws.canvas,
    checkpoints: ws.checkpoints.map((c) => ({
      id: c.id,
      label: c.label,
      at: c.at,
      snapshot: c.snapshot,
    })),
  };
}

function asWakes(raw: unknown): WorkspaceState["wakes"] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceState["wakes"] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      id?: unknown;
      at?: unknown;
      reason?: unknown;
      note?: unknown;
      fired?: unknown;
      notified?: unknown;
    };
    if (typeof rec.reason !== "string") continue;
    out.push({
      id: typeof rec.id === "string" ? rec.id : `wk_${out.length}`,
      at: typeof rec.at === "number" ? rec.at : Date.now(),
      reason: rec.reason.slice(0, 160),
      note: typeof rec.note === "string" ? rec.note.slice(0, 800) : "",
      fired: Boolean(rec.fired),
      notified: Boolean(rec.notified),
    });
  }
  return out;
}

function asCanvas(raw: unknown): WorkspaceState["canvas"] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).filter((c) => c && typeof c === "object") as WorkspaceState["canvas"];
}

function asCheckpoints(raw: unknown): WorkspaceState["checkpoints"] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceState["checkpoints"] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; label?: unknown; at?: unknown; snapshot?: unknown };
    if (typeof rec.label !== "string") continue;
    out.push({
      id: typeof rec.id === "string" ? rec.id : `ck_${out.length}`,
      label: rec.label.slice(0, 80),
      at: typeof rec.at === "number" ? rec.at : Date.now(),
      snapshot: typeof rec.snapshot === "string" ? rec.snapshot : "{}",
    });
  }
  return out;
}

async function handleApprove(body: Record<string, unknown>): Promise<Response> {
  const allow = body.allow !== false && body.allow !== "deny";
  const tool = typeof body.tool === "string" ? body.tool : "";
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  if (!allow) {
    return json({ ok: true, denied: true, text: `Denied ${tool || "held tool"}.` });
  }
  if (tool === "send_channel") {
    const mutation: Mutation = {
      type: "send_channel",
      channelId: String(args.channelId || "cli").slice(0, 40),
      message: String(args.message || "").slice(0, 1500),
    };
    return json({
      ok: true,
      text: `Queued outbound on ${mutation.channelId}. This kit does not deliver off-box.`,
      mutation,
    });
  }
  if (tool === "spawn_subagent") {
    const preferred =
      (typeof body.preferredProvider === "string" && body.preferredProvider) ||
      process.env.PADDY_MODEL ||
      "supergrok";
    const resolved = resolveBrain(
      preferred as ProviderId,
      {},
      typeof body.model === "string" ? body.model : undefined,
    );
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 502);
    const role = String(args.role || "specialist").slice(0, 80);
    const task = String(args.task || "").slice(0, 1200);
    try {
      const nested = await callBrain(
        resolved.route,
        [
          {
            role: "system",
            content: `You are a nested Paddy completion (${role}). Do the task in under 180 words. No tools. No fluff.`,
          },
          { role: "user", content: task },
        ],
        false,
        350,
      );
      return json({ ok: true, text: `Subagent (${role}):\n${nested.content.trim()}` });
    } catch (err) {
      return json(
        { ok: false, error: err instanceof Error ? err.message : "subagent failed" },
        502,
      );
    }
  }
  return json({ ok: false, error: `Nothing to approve for ${tool || "(none)"}.` }, 400);
}

async function handleChat(body: Record<string, unknown>): Promise<Response> {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ ok: false, error: "Missing message." }, 400);
  if (message.length > 8000) return json({ ok: false, error: "Message too long." }, 400);

  const seed = cliTurnSeed();
  const incoming = asFiles(body.files);
  const files = incoming ? { ...seed.files, ...incoming } : seed.files;
  const skills = asSkills(body.skills) ?? seed.skills;
  const memories = asMemories(body.memories) ?? seed.memories;
  const tickets = asTickets(body.tickets) ?? seed.tickets ?? [];
  const dailyNotes = asDaily(body.dailyNotes);
  const preferred =
    (typeof body.preferredProvider === "string" && body.preferredProvider) ||
    process.env.PADDY_MODEL ||
    "supergrok";

  const input: HelixTurnInput = {
    profileName: typeof body.profileName === "string" ? body.profileName.slice(0, 48) : seed.profileName,
    role: typeof body.role === "string" ? body.role.slice(0, 120) : seed.role,
    files,
    skills,
    memories,
    history: asHistory(body.history),
    userMessage: message.slice(0, 4000),
    channelId: "cli",
    channelName: "CLI",
    policy: seed.policy,
    preferredProvider: preferred,
    preferredModel: typeof body.model === "string" ? body.model.slice(0, 120) : undefined,
    keys: {},
    tickets,
    dailyToday: dailyNotes.find((d) => d.date === new Date().toISOString().slice(0, 10))?.content,
    nudgeMemory: memories.length === 0,
  };

  const result = await executeTurn(input);
  if (!result.ok) {
    return json({ ok: false, error: result.error, provider: preferred }, 502);
  }

  let ws = toWorkspace(files, skills, memories, tickets, dailyNotes, {
    wakes: asWakes(body.wakes),
    canvas: asCanvas(body.canvas),
    checkpoints: asCheckpoints(body.checkpoints),
  });
  for (const m of result.mutations) ws = applyMutation(ws, m);
  const pass = curatorPass(ws);
  ws = {
    ...ws,
    skills: pass.skills,
    memories: pass.memories,
    files: pass.files,
  };

  return json({
    ok: true,
    text: result.text,
    mutations: result.mutations as Mutation[],
    traces: result.traces,
    pendingApproval: result.pendingApproval ?? null,
    pendingApprovals: result.pendingApprovals ?? [],
    provider: preferred,
    workspace: packWorkspace(ws),
  });
}

export async function handleCliRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action") ?? "status";

  if (method === "GET" || method === "HEAD") {
    return json(publicStatus());
  }

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        allow: "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
      },
    });
  }

  if (method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    return json({ ok: false, error: "Expected JSON body." }, 400);
  }

  const action = typeof body.action === "string" ? body.action : actionParam;

  if (action === "status" || action === "doctor" || action === "models") {
    return json(publicStatus());
  }

  if (action !== "chat" && action !== "approve") {
    return json({ ok: false, error: `Unknown action “${action}”.` }, 400);
  }

  if (!cliAuthorized(request)) {
    return json(
      {
        ok: false,
        error:
          expectedToken()
            ? "CLI token rejected. Use the token from ~/.paddy/config.json (paddy gateway sets it)."
            : "CLI chat is locked on the hosted preview. Download the kit and run paddy gateway on your machine.",
        locked: !expectedToken(),
      },
      401,
    );
  }

  return action === "approve" ? handleApprove(body) : handleChat(body);
}
