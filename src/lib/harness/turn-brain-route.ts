import { resolveBrain, type BrainRoute } from "./brain";
import { resolveOpenClawRuntime, turnBrainPreference } from "./config.mjs";
import { TOKEN_MAX, type BrainKeys, type ProviderId } from "./providers";

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

/**
 * Resolve the brain route for a turn/chat/inbound/wake.
 * OpenClaw wins when openclaw.runtime=openclaw (Phase B); otherwise wizard
 * brain.preferred/model via turnBrainPreference (optional request override).
 */
export function resolveTurnBrainRoute(
  data: {
    preferredProvider?: string;
    preferredModel?: string;
    keys?: Record<string, string | undefined>;
  },
  opts?: { home?: string },
): { ok: true; route: BrainRoute } | { ok: false; error: string } {
  const oc = resolveOpenClawRuntime({ home: opts?.home });
  if (oc.active) {
    // OpenClaw owns Codex/channels/tools when configured; Hermes recall stays in system prompt.
    return {
      ok: true,
      route: {
        provider: "supergrok",
        label: "OpenClaw",
        model: oc.model,
        baseUrl: oc.url,
        apiKey: oc.token || "openclaw",
        compat: "openai",
      },
    };
  }
  const brain = turnBrainPreference({
    preferred: data.preferredProvider,
    model: data.preferredModel,
    home: opts?.home,
  });
  return resolveBrain(
    brain.preferred as ProviderId,
    sanitizeKeys(data.keys),
    brain.model,
  );
}
