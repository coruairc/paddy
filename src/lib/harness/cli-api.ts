import { envPresence, resolveBrain } from "./brain";
import {
  decideInbound,
  enqueueOutbound,
  isBridgeChannel,
  resolvePair,
} from "./channels";
import { PADDY_PROFILE, POLICY } from "./defaults";
import { applyTurnToWorkspace, curatorPass } from "./mutate";
import { buildTurnInput } from "./memory-store";
import { getMemoryStore } from "./memory-store-sql";
import { PROVIDER_DEFS, type BrainKeys, type ProviderId } from "./providers";
import { executeTurn, executeInheritedSubagent } from "./run-turn";
import { secretsForProfile, withSecretScope } from "./secret-scope";
import { wrapUntrusted } from "./untrusted";
import type { HelixTurnInput } from "./types";
import { cliAuthorized, expectedCliToken } from "./cli-auth";
import { canonicalBrainPreference } from "./config.mjs";

const TOKEN_MAX = 8192;



function brainDefaults(): { preferred: string; model: string | undefined } {
  return canonicalBrainPreference();
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function publicStatus() {
  const env = envPresence();
  const preferred = brainDefaults().preferred;
  return {
    ok: true as const,
    preferred,
    locked: !expectedCliToken(),
    env,
    providers: PROVIDER_DEFS.map((d) => ({
      id: d.id,
      name: d.name,
      model: d.model,
      connected: d.id === "local" ? Boolean(env.ollama) : Boolean(env[d.slot]),
    })),
  };
}

function keysFromBody(body: Record<string, unknown>): BrainKeys {
  const raw = asRecord(body.keys);
  const out: BrainKeys = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

async function runStoredTurn(opts: {
  profileId: string;
  userMessage: string;
  rawUserText: string;
  channelId: string;
  channelName?: string;
  sessionId: string;
  preferredProvider?: string;
  preferredModel?: string;
  keys?: BrainKeys;
  clearUnread?: boolean;
}) {
  const store = await getMemoryStore();
  const ws = await store.prefetch(opts.profileId);
  const keys = opts.keys ?? {};
  const input: HelixTurnInput = buildTurnInput(ws, {
    profileName: PADDY_PROFILE.name,
    role: PADDY_PROFILE.role,
    userMessage: opts.userMessage,
    channelId: opts.channelId,
    channelName: opts.channelName,
    sessionId: opts.sessionId,
    policy: POLICY,
    preferredProvider: opts.preferredProvider,
    preferredModel: opts.preferredModel,
    keys,
  });
  const result = await withSecretScope(secretsForProfile(keys), () => executeTurn(input));
  const next = applyTurnToWorkspace(ws, {
    userText: opts.rawUserText,
    channelId: opts.channelId,
    sessionId: opts.sessionId,
    result,
    clearUnread: opts.clearUnread,
  });
  if (result.ok) {
    const pass = curatorPass(next);
    next.skills = pass.skills;
    next.memories = pass.memories;
    next.files = pass.files;
  }
  await store.syncTurn(opts.profileId, next);
  return { result, workspace: next };
}

function queueOutbound(channelId: string, message: string, chatId?: string) {
  if (!isBridgeChannel(channelId)) return;
  enqueueOutbound({ channelId, chatId, message: message.slice(0, 4000) });
}

async function handleChat(body: Record<string, unknown>) {
  const message = str(body.message).slice(0, TOKEN_MAX);
  if (!message.trim()) return json({ ok: false, error: "Empty message." }, 400);
  const profileId = str(body.profileId, "paddy") || "paddy";
  const packed = await runStoredTurn({
    profileId,
    userMessage: message,
    rawUserText: message,
    channelId: str(body.channelId, "web") || "web",
    channelName: str(body.channelName, "web"),
    sessionId: str(body.sessionId, "web:operator") || "web:operator",
    preferredProvider: str(body.preferredProvider, brainDefaults().preferred),
    preferredModel: str(body.model) || brainDefaults().model,
    keys: keysFromBody(body),
    clearUnread: true,
  });
  if (!packed.result.ok) return json({ ...packed.result, workspace: packed.workspace }, 400);
  for (const m of packed.result.mutations) {
    if (m.type === "send_channel") {
      queueOutbound(m.channelId, m.message, str(body.chatId) || undefined);
    }
  }
  return json({
    ...packed.result,
    workspace: packed.workspace,
  });
}

export async function handleInbound(body: Record<string, unknown>) {
  const channelId = str(body.channelId);
  if (!isBridgeChannel(channelId)) return json({ ok: false, error: "Unknown channel." }, 400);
  const from = str(body.from, "unknown");
  const fromId = str(body.fromId);
  const chatId = str(body.chatId);
  const message = str(body.message).slice(0, TOKEN_MAX);
  const decision = decideInbound({
    channelId,
    from,
    fromId,
    chatId,
    text: message,
    isGroup: Boolean(body.isGroup),
    botNames: Array.isArray(body.botNames) ? body.botNames.map(String) : [],
  });
  if (decision.action === "deny") {
    return json({ ok: true, denied: true, error: decision.reason, reply: "" });
  }
  if (decision.action === "pair") {
    return json({
      ok: true,
      pairing: true,
      reply: decision.reply,
      pair: decision.pair,
    });
  }
  const profileId = str(body.profileId, "paddy") || "paddy";
  const packed = await runStoredTurn({
    profileId,
    userMessage: wrapUntrusted(message, str(body.channelName, channelId), from),
    rawUserText: message,
    channelId,
    channelName: str(body.channelName, channelId),
    sessionId: str(body.sessionId, `${channelId}:${chatId || fromId || "inbox"}`),
    preferredProvider: str(body.preferredProvider, brainDefaults().preferred),
    preferredModel: str(body.model) || brainDefaults().model,
    keys: keysFromBody(body),
    clearUnread: false,
  });
  if (!packed.result.ok) {
    return json({
      ok: true,
      error: packed.result.error,
      reply: `Paddy: ${packed.result.error}`,
      workspace: packed.workspace,
    });
  }
  for (const m of packed.result.mutations) {
    if (m.type === "send_channel") queueOutbound(m.channelId, m.message, chatId);
  }
  return json({
    ...packed.result,
    reply: packed.result.text,
    workspace: packed.workspace,
  });
}

async function handleWorkspace(body: Record<string, unknown>) {
  const profileId = str(body.profileId, "paddy") || "paddy";
  const store = await getMemoryStore();
  const workspace = await store.prefetch(profileId);
  return json({ ok: true, profileId, workspace });
}

async function handleWorkspaceSave(body: Record<string, unknown>) {
  const profileId = str(body.profileId, "paddy") || "paddy";
  const store = await getMemoryStore();
  const { coerceSnapshot } = await import("./memory-store");
  const incoming = coerceSnapshot(body.workspace);
  await store.syncTurn(profileId, incoming);
  return json({ ok: true, profileId, workspace: incoming });
}

async function handleWake(body: Record<string, unknown>) {
  const store = await getMemoryStore();
  const ids = await store.listProfiles();
  const fired: { profileId: string; reason: string }[] = [];
  for (const profileId of ids) {
    const ws = await store.prefetch(profileId);
    const due = (ws.wakes ?? []).filter((w) => !w.fired && w.at <= Date.now());
    if (!due.length) continue;
    const wake = due[0]!;
    const packed = await runStoredTurn({
      profileId,
      userMessage: `[gated wake · ${wake.reason}]\n${wake.note}`,
      rawUserText: `[gated wake · ${wake.reason}]\n${wake.note}`,
      channelId: "web",
      channelName: "Heartbeat",
      sessionId: "web:operator",
      preferredProvider: str(body.preferredProvider, brainDefaults().preferred),
      preferredModel: str(body.model) || brainDefaults().model,
      keys: keysFromBody(body),
      clearUnread: true,
    });
    packed.workspace.wakes = packed.workspace.wakes.map((w) =>
      w.id === wake.id ? { ...w, fired: true, notified: true } : w,
    );
    await store.syncTurn(profileId, packed.workspace);
    fired.push({ profileId, reason: wake.reason });
  }
  return json({ ok: true, fired, count: fired.length });
}

async function handlePairing(body: Record<string, unknown>) {
  const code = str(body.code);
  const allow = body.allow !== false && str(body.decision, "allow") !== "deny";
  const result = resolvePair(code, allow);
  if (!result.ok) return json(result, 400);
  return json({
    ok: true,
    pair: result.pair,
    text: allow
      ? `Allowed ${result.pair.from} on ${result.pair.channelId}.`
      : `Denied ${result.pair.from}.`,
  });
}

async function handleChannelSend(body: Record<string, unknown>) {
  const channelId = str(body.channelId);
  const message = str(body.message).slice(0, 4000);
  if (!isBridgeChannel(channelId) || !message.trim()) {
    return json({ ok: false, error: "Need channelId and message." }, 400);
  }
  queueOutbound(channelId, message, str(body.chatId) || undefined);
  return json({ ok: true, text: `Queued outbound on ${channelId}.` });
}

async function handleApprove(body: Record<string, unknown>) {
  const allow = body.allow !== false && str(body.decision) !== "deny";
  const tool = str(body.tool);
  const args = asRecord(body.args);
  if (!allow) return json({ ok: true, text: "Denied." });
  if (tool === "send_channel") {
    const channelId = str(args.channelId);
    const message = str(args.message);
    if (isBridgeChannel(channelId) && message) {
      queueOutbound(channelId, message, str(args.chatId) || undefined);
    }
    return json({
      ok: true,
      text: `Queued outbound on ${channelId || "channel"}.`,
      mutation: { type: "send_channel", channelId, message },
    });
  }
  if (tool === "spawn_subagent") {
    const brain = brainDefaults();
    const preferred = (str(body.preferredProvider, brain.preferred) ||
      "supergrok") as ProviderId;
    const keys = keysFromBody(body);
    const resolved = resolveBrain(preferred, keys, str(body.model) || brain.model);
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, 400);
    const role = str(args.role, "specialist").slice(0, 80);
    const task = str(args.task).slice(0, 1200);
    const profileId = str(body.profileId, "paddy") || "paddy";
    try {
      const store = await getMemoryStore();
      const ws = await store.prefetch(profileId);
      const input = buildTurnInput(ws, {
        profileName: PADDY_PROFILE.name,
        role: PADDY_PROFILE.role,
        userMessage: task,
        policy: POLICY,
        preferredProvider: preferred,
        preferredModel: str(body.model) || brain.model,
        keys,
      });
      const text = await withSecretScope(secretsForProfile(keys), () =>
        executeInheritedSubagent(input, resolved.route, role, task),
      );
      return json({ ok: true, text });
    } catch (err) {
      return json({
        ok: false,
        error: err instanceof Error ? err.message : "subagent failed",
      }, 400);
    }
  }
  return json({ ok: true, text: "Allowed." });
}


/** For verified provider webhooks only — never call from unsigned HTTP. */
export async function handleInboundFromVerifiedWebhook(body: Record<string, unknown>): Promise<Response> {
  return handleInbound(body);
}

export async function handleCliRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  let body: Record<string, unknown> = {};
  if (request.method !== "GET" && request.method !== "HEAD") {
    try {
      const raw = await request.json();
      body = asRecord(raw);
    } catch {
      body = {};
    }
  }
  const actionParam = new URL(request.url).searchParams.get("action");
  const action = typeof body.action === "string" ? body.action : actionParam;

  if (action === "status" || action === "doctor" || action === "models" || !action) {
    return json(publicStatus());
  }

  const gated = new Set([
    "chat",
    "approve",
    "inbound",
    "pairing",
    "channel-send",
    "workspace",
    "workspace-save",
    "wake",
  ]);
  if (!gated.has(action)) {
    return json({ ok: false, error: `Unknown action “${action}”.` }, 400);
  }

  if (!cliAuthorized(request)) {
    return json(
      {
        ok: false,
        error:
          expectedCliToken()
            ? "CLI token rejected. Use Authorization: Bearer <token> from ~/.paddy/config.json (query ?token= is no longer accepted)."
            : "CLI chat is locked on the hosted preview. Download the kit and run paddy gateway on your machine.",
        locked: !expectedCliToken(),
      },
      401,
    );
  }

  if (action === "approve") return handleApprove(body);
  if (action === "inbound") return handleInbound(body);
  if (action === "pairing") return handlePairing(body);
  if (action === "channel-send") return handleChannelSend(body);
  if (action === "workspace") return handleWorkspace(body);
  if (action === "workspace-save") return handleWorkspaceSave(body);
  if (action === "wake") return handleWake(body);
  return handleChat(body);
}
