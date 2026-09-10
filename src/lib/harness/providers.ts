export type ProviderId =
  | "supergrok"
  | "chatgpt-plus"
  | "chatgpt-pro"
  | "claude-pro"
  | "claude-max"
  | "gemini"
  | "laguna-s"
  | "laguna-xs"
  | "openrouter"
  | "deepseek"
  | "local";

export type ProviderStatus = "live" | "paired" | "idle";
export type KeySlot =
  | "xai"
  | "openai"
  | "anthropic"
  | "google"
  | "poolside"
  | "openrouter"
  | "deepseek"
  | "ollama";
export type Compat = "openai" | "anthropic" | "xai" | "codex";
export type SignInKind = "chatgpt" | "supergrok" | "claude-token";

export const TOKEN_MAX = 8192;
export const CODEX_VERIFY_URL = "https://auth.openai.com/codex/device";
export const XAI_VERIFY_URL = "https://auth.x.ai/oauth2/device";
export const POOLSIDE_KEYS_URL = "https://platform.poolside.ai/";
export const GEMINI_KEYS_URL = "https://aistudio.google.com/apikey";

export interface BrainKeys {
  xai?: string;
  openai?: string;
  anthropic?: string;
  google?: string;
  poolside?: string;
  openrouter?: string;
  deepseek?: string;
  ollamaHost?: string;
  ollamaModel?: string;
  codexAccess?: string;
  codexRefresh?: string;
  codexExpires?: string;
  codexAccount?: string;
  anthropicOAuth?: string;
  xaiAccess?: string;
  xaiRefresh?: string;
  xaiExpires?: string;
  [key: string]: string | undefined;
}

export interface ProviderDef {
  id: ProviderId;
  name: string;
  plan: string;
  blurb: string;
  kind: "subscription" | "local";
  liveHere: boolean;
  auth: "subscription" | "api-key" | "local";
  pairHint: string;
  slot: KeySlot;
  envVar: string;
  model: string;
  baseUrl: string;
  compat: Compat;
  keyLabel: string;
  signIn?: SignInKind;
  connectUrl?: string;
  connectLabel?: string;
}

export interface ProviderState {
  id: ProviderId;
  status: ProviderStatus;
  pairedAt: number | null;
}

export const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "supergrok",
    name: "SuperGrok",
    plan: "xAI · SuperGrok / X Premium+",
    blurb: "Sign in with SuperGrok or X Premium+ to spend your quota. An xAI API key still works. This hosted preview can also use the app’s SuperGrok until you connect yours.",
    kind: "subscription",
    liveHere: true,
    auth: "subscription",
    pairHint: "Device-code sign-in at auth.x.ai.",
    slot: "xai",
    envVar: "XAI_API_KEY",
    model: "grok-4.5",
    baseUrl: "https://api.x.ai/v1",
    compat: "xai",
    keyLabel: "xAI API key (optional)",
    signIn: "supergrok",
  },
  {
    id: "chatgpt-plus",
    name: "ChatGPT Plus",
    plan: "Codex · Plus quota",
    blurb: "Sign in with ChatGPT (device code) and spend the Plus quota. An API key still works as a fallback.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "Enable device-code in ChatGPT → Settings → Security, then Sign in.",
    slot: "openai",
    envVar: "OPENAI_API_KEY",
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1",
    compat: "openai",
    keyLabel: "OpenAI API key (optional)",
    signIn: "chatgpt",
  },
  {
    id: "chatgpt-pro",
    name: "ChatGPT Pro",
    plan: "Codex · Pro quota",
    blurb: "Same ChatGPT sign-in as Plus. Prefer this if the account is Pro.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "Shares the ChatGPT session from Plus.",
    slot: "openai",
    envVar: "OPENAI_API_KEY",
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1",
    compat: "openai",
    keyLabel: "OpenAI API key (optional)",
    signIn: "chatgpt",
  },
  {
    id: "claude-pro",
    name: "Claude Pro",
    plan: "Anthropic · setup-token",
    blurb: "Paste a token from claude setup-token — that is the Pro/Max subscription. An API key still works. Anthropic does not let third-party apps run Claude.ai login.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "On your machine: claude setup-token — then paste it here.",
    slot: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com/v1",
    compat: "anthropic",
    keyLabel: "setup-token (sk-ant-oat…) or API key",
    signIn: "claude-token",
  },
  {
    id: "claude-max",
    name: "Claude Max",
    plan: "Anthropic · same token",
    blurb: "Same Anthropic setup-token as Pro. Prefer this if the account is Max.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "Shares the Anthropic token slot.",
    slot: "anthropic",
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.anthropic.com/v1",
    compat: "anthropic",
    keyLabel: "setup-token (sk-ant-oat…) or API key",
    signIn: "claude-token",
  },
  {
    id: "gemini",
    name: "Gemini",
    plan: "Google AI · free or Pro/Ultra",
    blurb: "A free AI Studio key is enough. Google AI Pro/Ultra keys work too. Google does not let third-party apps run Gemini CLI login.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "aistudio.google.com → Get API key. Free tier exists.",
    slot: "google",
    envVar: "GOOGLE_API_KEY",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    compat: "openai",
    keyLabel: "Google AI key (free or Pro/Ultra)",
    connectUrl: GEMINI_KEYS_URL,
    connectLabel: "Get a free Google key",
  },
  {
    id: "laguna-s",
    name: "Laguna S",
    plan: "Poolside · free",
    blurb: "Laguna S 2.1 — free agentic coding model. Get a free Poolside key, then prefer this brain.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "platform.poolside.ai → API Keys → New key.",
    slot: "poolside",
    envVar: "POOLSIDE_API_KEY",
    model: "poolside/laguna-s-2.1",
    baseUrl: "https://inference.poolside.ai/v1",
    compat: "openai",
    keyLabel: "Poolside API key (free)",
    connectUrl: POOLSIDE_KEYS_URL,
    connectLabel: "Get a free Poolside key",
  },
  {
    id: "laguna-xs",
    name: "Laguna XS",
    plan: "Poolside · free",
    blurb: "Laguna XS 2.1 — faster, lighter, also free. Shares the Poolside key with Laguna S.",
    kind: "subscription",
    liveHere: false,
    auth: "subscription",
    pairHint: "Shares the Poolside key from Laguna S.",
    slot: "poolside",
    envVar: "POOLSIDE_API_KEY",
    model: "poolside/laguna-xs-2.1",
    baseUrl: "https://inference.poolside.ai/v1",
    compat: "openai",
    keyLabel: "Poolside API key (free)",
    connectUrl: POOLSIDE_KEYS_URL,
    connectLabel: "Get a free Poolside key",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    plan: "Many models · one key",
    blurb: "One key, many labs. Paste an OpenRouter key or set OPENROUTER_API_KEY.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "openrouter.ai/keys",
    slot: "openrouter",
    envVar: "OPENROUTER_API_KEY",
    model: "openrouter/auto",
    baseUrl: "https://openrouter.ai/api/v1",
    compat: "openai",
    keyLabel: "OpenRouter key",
    connectUrl: "https://openrouter.ai/keys",
    connectLabel: "Get an OpenRouter key",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    plan: "Official API · paid key",
    blurb: "Official platform key — not the free chat.deepseek.com login.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "platform.deepseek.com → API keys.",
    slot: "deepseek",
    envVar: "DEEPSEEK_API_KEY",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    compat: "openai",
    keyLabel: "DeepSeek API key",
    connectUrl: "https://platform.deepseek.com/",
    connectLabel: "Get a DeepSeek key",
  },
  {
    id: "local",
    name: "Ollama",
    plan: "Local · llama.cpp compatible",
    blurb: "Self-host only. Point at your Ollama (default localhost:11434). The hosted preview cannot see your machine.",
    kind: "local",
    liveHere: false,
    auth: "local",
    pairHint: "Install Ollama, pull a model, then set the host.",
    slot: "ollama",
    envVar: "OLLAMA_HOST",
    model: "llama3.2",
    baseUrl: "http://127.0.0.1:11434/v1",
    compat: "openai",
    keyLabel: "Ollama host",
  },
];

export function defaultProviders(): ProviderState[] {
  return PROVIDER_DEFS.map((d) => ({
    id: d.id,
    status: d.id === "supergrok" ? "live" : "idle",
    pairedAt: d.id === "supergrok" ? Date.now() : null,
  }));
}

export function defaultBrainKeys(): BrainKeys {
  return {};
}

export function maskKey(value?: string): string {
  const v = (value ?? "").trim();
  if (v.length < 8) return v ? "••••" : "";
  return `••••${v.slice(-4)}`;
}

export function defFor(id: ProviderId): ProviderDef | undefined {
  return PROVIDER_DEFS.find((d) => d.id === id);
}

export function isAnthropicOAuth(token?: string): boolean {
  const t = (token ?? "").trim();
  return t.startsWith("sk-ant-oat") || (t.startsWith("eyJ") && t.length > 80);
}

export function keysForSlot(slot: KeySlot): (keyof BrainKeys)[] {
  switch (slot) {
    case "openai":
      return ["openai", "codexAccess", "codexRefresh", "codexExpires", "codexAccount"];
    case "anthropic":
      return ["anthropic", "anthropicOAuth"];
    case "xai":
      return ["xai", "xaiAccess", "xaiRefresh", "xaiExpires"];
    case "ollama":
      return ["ollamaHost", "ollamaModel"];
    default:
      return [slot];
  }
}

export function slotForBrainKey(key: string): KeySlot | undefined {
  if (key.startsWith("codex")) return "openai";
  if (key === "anthropicOAuth") return "anthropic";
  if (key === "xaiAccess" || key === "xaiRefresh" || key === "xaiExpires") return "xai";
  if (key === "ollamaHost" || key === "ollamaModel") return "ollama";
  if (
    key === "xai" ||
    key === "openai" ||
    key === "anthropic" ||
    key === "google" ||
    key === "poolside" ||
    key === "openrouter" ||
    key === "deepseek"
  ) {
    return key;
  }
  return undefined;
}

export function slotConnected(keys: BrainKeys, slot: KeySlot): boolean {
  return keysForSlot(slot).some((k) => Boolean(keys[k]?.trim()));
}
