import { envPresence, resolveBrain } from "./brain";
import { cliTurnSeed } from "./defaults";
import { PROVIDER_DEFS, type ProviderId } from "./providers";
import { executeTurn } from "./run-turn";
import type { HelixTurnInput, Mutation } from "./types";

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
  if (m?.[1]) return m[1].trim();
  try {
    return new URL(request.url).searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

export function cliAuthorized(request: Request): boolean {
  const expected = expectedToken();
  if (!expected || expected.length < 16) return false;
  const got = bearer(request);
  return got.length > 0 && got === expected;
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
      connected: Boolean(env[d.slot]) || d.id === "local",
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

function asFiles(raw: unknown): HelixTurnInput["files"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const pick = (k: string) => (typeof rec[k] === "string" ? rec[k] : "");
  const files = {
    soul: pick("soul"),
    identity: pick("identity"),
    user: pick("user"),
    memory: pick("memory"),
    agents: pick("agents"),
  };
  if (!files.soul && !files.identity && !files.user) return undefined;
  return files;
}

async function handleChat(body: Record<string, unknown>): Promise<Response> {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ ok: false, error: "Missing message." }, 400);
  if (message.length > 8000) return json({ ok: false, error: "Message too long." }, 400);

  const seed = cliTurnSeed();
  const files = asFiles(body.files) ?? seed.files;
  const preferred =
    (typeof body.preferredProvider === "string" && body.preferredProvider) ||
    process.env.PADDY_MODEL ||
    "supergrok";

  const input: HelixTurnInput = {
    profileName: typeof body.profileName === "string" ? body.profileName.slice(0, 48) : seed.profileName,
    role: typeof body.role === "string" ? body.role.slice(0, 120) : seed.role,
    files,
    skills: seed.skills,
    memories: seed.memories,
    history: asHistory(body.history),
    userMessage: message.slice(0, 4000),
    channelId: "cli",
    channelName: "CLI",
    policy: seed.policy,
    preferredProvider: preferred,
    keys: {},
  };

  const result = await executeTurn(input);
  if (!result.ok) {
    return json({ ok: false, error: result.error, provider: preferred }, 502);
  }
  return json({
    ok: true,
    text: result.text,
    mutations: result.mutations as Mutation[],
    traces: result.traces,
    pendingApproval: result.pendingApproval ?? null,
    provider: preferred,
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

  if (action !== "chat") {
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

  return handleChat(body);
}
