import { createServerFn } from "@tanstack/react-start";
import { PADDY_PROFILE, POLICY } from "./defaults";
import { applyTurnToWorkspace, curatorPass } from "./mutate";
import { buildTurnInput } from "./memory-store";
import { getMemoryStore } from "./memory-store-sql";
import { resolveBrain } from "./brain";
import { TOKEN_MAX, type BrainKeys, type ProviderId } from "./providers";
import { executeTurn, executeInheritedSubagent } from "./run-turn";
import { secretsForProfile, withSecretScope } from "./secret-scope";
import type { HelixTurnInput, HelixTurnResult, WorkspaceState } from "./types";
import { cliGatewayMiddleware } from "./cli-auth.server";

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
    await store.syncTurn(id, data.workspace);
    return { ok: true as const };
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
    const ws = await store.prefetch(profileId);
    const keys = sanitizeKeys(data.keys);
    const input: HelixTurnInput = {
      ...buildTurnInput(ws, {
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
      }),
      userMessage: data.userMessage,
    };
    const result = await withSecretScope(secretsForProfile(keys), () => executeTurn(input));
    const next = applyTurnToWorkspace(ws, {
      userText: data.rawUserText ?? data.userMessage,
      channelId: data.channelId || "web",
      sessionId,
      result,
      clearUnread: true,
    });
    if (result.ok) {
      const pass = curatorPass(next);
      next.skills = pass.skills;
      next.memories = pass.memories;
      next.files = pass.files;
    }
    await store.syncTurn(profileId, next);
    return { ...result, workspace: next };
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
    const resolved = resolveBrain(
      (data.preferredProvider as ProviderId) || "supergrok",
      keys,
      data.preferredModel,
    );
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

