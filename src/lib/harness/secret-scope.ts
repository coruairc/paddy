/**
 * Profile-scoped credential resolution.
 *
 * A multiplexing gateway must not union every profile's keys into process.env:
 * profile A's WhatsApp token would otherwise leak into profile B's turn.
 * When a scope is active, secret() is fail-closed — only the bag is visible.
 * With no scope (single-profile / tests), secret() falls back to process.env.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { BrainKeys } from "./providers";

export type SecretBag = Record<string, string>;

const als = new AsyncLocalStorage<SecretBag>();

export const BRAIN_KEY_ENV: Record<string, string> = {
  xai: "XAI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  kimi: "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  glm: "GLM_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  poolside: "POOLSIDE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  together: "TOGETHER_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  huggingface: "HF_TOKEN",
  ollamaHost: "OLLAMA_HOST",
  ollamaModel: "OLLAMA_MODEL",
  codexAccess: "CHATGPT_ACCESS_TOKEN",
  codexRefresh: "CHATGPT_REFRESH_TOKEN",
  codexExpires: "CHATGPT_EXPIRES",
  codexAccount: "CHATGPT_ACCOUNT_ID",
  anthropicOAuth: "ANTHROPIC_TOKEN",
  xaiAccess: "XAI_ACCESS_TOKEN",
  xaiRefresh: "XAI_REFRESH_TOKEN",
  xaiExpires: "XAI_EXPIRES",
};

const ENV_ALIASES: Record<string, string[]> = {
  GOOGLE_API_KEY: ["GEMINI_API_KEY"],
  ANTHROPIC_API_KEY: ["ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  CHATGPT_ACCESS_TOKEN: ["CODEX_ACCESS_TOKEN"],
  CHATGPT_REFRESH_TOKEN: ["CODEX_REFRESH_TOKEN"],
  HF_TOKEN: ["HUGGINGFACE_API_KEY"],
  DASHSCOPE_API_KEY: ["QWEN_API_KEY"],
  GLM_API_KEY: ["ZAI_API_KEY", "Z_AI_API_KEY"],
};

export function withSecretScope<T>(bag: SecretBag, fn: () => T): T {
  return als.run({ ...bag }, fn);
}

export function currentSecretScope(): SecretBag | undefined {
  return als.getStore();
}

export function secret(name: string): string {
  const bag = als.getStore();
  if (bag) {
    const direct = bag[name];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    return "";
  }
  if (typeof process === "undefined" || !process.env) return "";
  return (process.env[name] ?? "").trim();
}

export function splitKeyPool(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function secretsForProfile(keys: BrainKeys = {}, fallbackEnv: NodeJS.ProcessEnv = process.env): SecretBag {
  const bag: SecretBag = {};
  const assign = (envName: string, value?: string) => {
    const v = (value ?? "").trim();
    if (!v) return;
    bag[envName] = v;
    for (const alias of ENV_ALIASES[envName] ?? []) {
      if (!bag[alias]) bag[alias] = v;
    }
  };
  for (const [field, envName] of Object.entries(BRAIN_KEY_ENV)) {
    const fromKey = keys[field];
    if (typeof fromKey === "string" && fromKey.trim()) assign(envName, fromKey);
    else assign(envName, fallbackEnv[envName]);
    for (const alias of ENV_ALIASES[envName] ?? []) {
      if (!bag[envName]) assign(envName, fallbackEnv[alias]);
    }
  }
  return bag;
}
