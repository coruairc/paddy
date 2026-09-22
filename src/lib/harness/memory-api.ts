import { createServerFn } from "@tanstack/react-start";
import { PADDY_PROFILE, POLICY } from "./defaults";
import { applyHermesTurnPersistence } from "./mutate";
import { buildTurnInput, SyncConflictError } from "./memory-store";
import { getMemoryStore } from "./memory-store-sql";
import { resolveTurnBrainRoute } from "./turn-brain-route";
import { TOKEN_MAX, type BrainKeys } from "./providers";
import { executeTurn, executeInheritedSubagent } from "./run-turn";
import { secretsForProfile, withSecretScope } from "./secret-scope";
import type {
  HelixTurnInput,
  HelixTurnResult,
  MemoryKind,
  MemoryTarget,
  MemoryWriteAction,
  WorkspaceState,
} from "./types";
import { cliGatewayMiddleware } from "./cli-gateway-middleware";
import {
  applyMemoryWrite,
  ensureSessionFreeze,
  memoryList as listMemory,
  memoryReset as resetMemory,
  memoryStatus as statusOf,
  resolveMemoryLimits,
  usageMeters,
} from "./memory-hermes.mjs";
import { rankMemories } from "./memory-recall.ts";
import { ensureMemoryEmbedding } from "./embeddings.ts";

export const loadWorkspaces = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async () => {
  const store = await getMemoryStore();
  const ids = await store.listProfiles();
  const workspaces: Record<string, WorkspaceState> = {};
  for (const id of ids) workspaces[id] = await store.prefetch(id);
  return { ok: true as const, workspaces };
});

export const saveWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { profileId: string; workspace: WorkspaceState }) => input)
  .handler(async ({ data }) => {
    const id = data.profileId.trim().slice(0, 80) || "paddy";
    const store = await getMemoryStore();
    try {
      await store.syncTurn(id, data.workspace);
      return { ok: true as const, revision: data.workspace.revision };
    } catch (err) {
      if (err instanceof SyncConflictError) {
        return {
          ok: false as const,
          error: "sync_conflict",
          expected: err.expected,
          actual: err.actual,
        };
      }
      throw err;
    }
  });

const KEY_FIELDS: (keyof BrainKeys)[] = [
  "xai",
  "openai",
  "anthropic",
  "google",
  "kimi",
  "minimax",
  "glm",
  "qwen",
  "deepseek",
  "mistral",
  "groq",
  "poolside",
  "openrouter",
  "together",
  "fireworks",
  "huggingface",
  "ollamaHost",
  "ollamaModel",
  "codexAccess",
  "codexRefresh",
  "codexExpires",
  "codexAccount",
  "anthropicOAuth",
  "xaiAccess",
  "xaiRefresh",
  "xaiExpires",
];

function sanitizeKeys(raw?: Record<string, string | undefined>): BrainKeys {
  const out: BrainKeys = {};
  if (!raw) return out;
  for (const k of KEY_FIELDS) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, TOKEN_MAX);
  }
  return out;
}

export const runStoredHelixTurn = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: HelixTurnInput) => input)
  .handler(async ({ data }): Promise<HelixTurnResult> => {
    const profileId = (data.profileId || "paddy").slice(0, 80);
    const sessionId = data.sessionId || "web:operator";
    const store = await getMemoryStore();
    let ws = await store.prefetch(profileId);
    const freeze = ensureSessionFreeze(ws, sessionId, data.channelId || "web");
    ws = freeze.workspace;
    if (freeze.created) {
      try {
        await store.syncTurn(profileId, ws);
      } catch (err) {
        if (!(err instanceof SyncConflictError)) throw err;
        ws = await store.prefetch(profileId);
      }
    }
    const keys = sanitizeKeys(data.keys);
    const built = buildTurnInput(ws, {
      profileName: data.profileName,
      role: data.role,
      userMessage: data.userMessage,
      channelId: data.channelId,
      channelName: data.channelName,
      sessionId,
      policy: data.policy,
      preferredProvider: data.preferredProvider,
      preferredModel: data.preferredModel,
      keys,
      forceSkill: data.forceSkill,
    });
    const input: HelixTurnInput = {
      ...built,
      userMessage: data.userMessage,
    };
    const result = await withSecretScope(secretsForProfile(keys), () => executeTurn(input));
    const next = applyHermesTurnPersistence(ws, {
      userText: data.rawUserText ?? data.userMessage,
      channelId: data.channelId || "web",
      sessionId,
      result,
      clearUnread: true,
    });
    const limits = resolveMemoryLimits();
    const meters = usageMeters(next, limits);
    const memoryUsage = {
      memory: meters.memory,
      user: meters.user,
      memoryChars: meters.memoryChars,
      memoryLimit: meters.memoryLimit,
      userChars: meters.userChars,
      userLimit: meters.userLimit,
    };
    const enriched = result.ok
      ? { ...result, memoryInjected: built.memoryInjected, memoryUsage }
      : result;
    try {
      await store.syncTurn(profileId, next);
    } catch (err) {
      if (!(err instanceof SyncConflictError)) throw err;
      const latest = await store.prefetch(profileId);
      const rebased = applyHermesTurnPersistence(latest, {
        userText: data.rawUserText ?? data.userMessage,
        channelId: data.channelId || "web",
        sessionId,
        result,
        clearUnread: true,
      });
      await store.syncTurn(profileId, rebased);
      return { ...enriched, workspace: rebased };
    }
    return { ...enriched, workspace: next };
  });

export const runStoredSubagent = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      role: string;
      task: string;
      profileId?: string;
      preferredProvider?: string;
      preferredModel?: string;
      keys?: Record<string, string | undefined>;
      policy?: HelixTurnInput["policy"];
    }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const profileId = (data.profileId || "paddy").slice(0, 80);
    const store = await getMemoryStore();
    const ws = await store.prefetch(profileId);
    const keys = sanitizeKeys(data.keys);
    const policy = data.policy ?? POLICY;
    const input = buildTurnInput(ws, {
      profileName: PADDY_PROFILE.name,
      role: PADDY_PROFILE.role,
      userMessage: data.task,
      policy,
      preferredProvider: data.preferredProvider,
      preferredModel: data.preferredModel,
      keys,
    });
    const resolved = resolveTurnBrainRoute({
      preferredProvider: data.preferredProvider,
      preferredModel: data.preferredModel,
      keys,
    });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    try {
      const text = await withSecretScope(secretsForProfile(keys), () =>
        executeInheritedSubagent(input, resolved.route, data.role.slice(0, 80) || "specialist", data.task.slice(0, 1200)),
      );
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "subagent failed" };
    }
  });

/* ─── Hermes memory APIs (PR3+PR4) ─────────────────────────────────────── */

function toApiHits(hits: ReturnType<typeof rankMemories>) {
  return hits.map((h) => ({
    entry: h.memory,
    score: h.score,
    similarity: h.similarity,
    recency: h.recency,
    importance: h.importance,
  }));
}

/** `{ memoryChars, memoryLimit, userChars, userLimit, entryCount, ftsEnabled, embeddingMode }` */
export const memoryStatus = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async () => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    return { ok: true as const, ...statusOf(ws) };
  });

export const memoryList = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .validator((input?: { target?: MemoryTarget }) => input ?? {})
  .handler(async ({ data }) => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    const target = data?.target;
    if (target === "memory" || target === "user") {
      return { ok: true as const, ...listMemory(ws, target) };
    }
    const both = listMemory(ws) as {
      memory: ReturnType<typeof listMemory>;
      user: ReturnType<typeof listMemory>;
    };
    return { ok: true as const, ...both };
  });

export const memorySearch = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { query: string; limit?: number; target?: MemoryTarget }) => input)
  .handler(async ({ data }) => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    const query = (data.query ?? "").slice(0, 2000);
    const limit = typeof data.limit === "number" ? data.limit : undefined;
    let pool = ws.memories ?? [];
    if (data.target === "user") {
      const listed = listMemory(ws, "user") as { entries: typeof pool };
      pool = listed.entries;
    } else if (data.target === "memory") {
      pool = ws.memories ?? [];
    }
    const hits = rankMemories(pool, query, { limit });
    return { ok: true as const, hits: toApiHits(hits) };
  });

export const memoryWrite = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      target: MemoryTarget;
      action: MemoryWriteAction;
      text: string;
      oldText?: string;
      kind?: MemoryKind;
    }) => input,
  )
  .handler(async ({ data }) => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    const limits = resolveMemoryLimits();
    const result = applyMemoryWrite(ws, {
      target: data.target,
      action: data.action,
      text: data.text,
      oldText: data.oldText,
      kind: data.kind,
      limits,
      embed: (text: string, existing?: number[]) => ensureMemoryEmbedding(text, existing),
    });
    if (!result.ok) {
      return {
        ok: false as const,
        error: result.error as string,
        code: (result as { code?: string }).code,
        currentEntries: (result as { currentEntries?: string[] }).currentEntries,
        matches: (result as { matches?: string[] }).matches,
        usage: (result as { usage?: string }).usage,
      };
    }
    try {
      await store.syncTurn("paddy", result.workspace);
    } catch (err) {
      if (err instanceof SyncConflictError) {
        return {
          ok: false as const,
          error: "sync_conflict",
          expected: err.expected,
          actual: err.actual,
        };
      }
      throw err;
    }
    return {
      ok: true as const,
      message: result.message,
      replacedEntry: result.replacedEntry,
      usage: result.usage ?? usageMeters(result.workspace, limits),
      workspace: result.workspace,
    };
  });

export const memoryRecall = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { query: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    const limits = resolveMemoryLimits();
    const query = (data.query ?? "").slice(0, 2000);
    const limit = typeof data.limit === "number" ? data.limit : limits.recallLimit;
    const hits = rankMemories(ws.memories ?? [], query, { limit });
    return {
      ok: true as const,
      hits: toApiHits(hits),
      memoryUsage: usageMeters(ws, limits),
    };
  });

export const memoryReset = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { target: "all" | "memory" | "user"; confirm: boolean }) => input)
  .handler(async ({ data }) => {
    const store = await getMemoryStore();
    const ws = await store.prefetch("paddy");
    const result = resetMemory(ws, data.target, data.confirm);
    if (!result.ok) {
      return { ok: false as const, error: result.error as string };
    }
    try {
      await store.syncTurn("paddy", result.workspace);
    } catch (err) {
      if (err instanceof SyncConflictError) {
        return {
          ok: false as const,
          error: "sync_conflict",
          expected: err.expected,
          actual: err.actual,
        };
      }
      throw err;
    }
    return {
      ok: true as const,
      message: result.message,
      status: statusOf(result.workspace),
    };
  });

export { ensureSessionFreeze, resolveMemoryLimits, usageMeters };
