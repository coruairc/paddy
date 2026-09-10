export type ProviderId =
  | "supergrok"
  | "chatgpt-plus"
  | "chatgpt-pro"
  | "claude-pro"
  | "claude-max"
  | "gemini"
  | "laguna"
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

export interface ModelOption {
  id: string;
  name: string;
}

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
  models: ModelOption[];
}

export interface ProviderState {
  id: ProviderId;
  status: ProviderStatus;
  pairedAt: number | null;
}

const GROK_MODELS: ModelOption[] = [
  { id: "grok-4.6", name: "Grok 4.6" },
  { id: "grok-4.5", name: "Grok 4.5" },
  { id: "grok-4-fast", name: "Grok 4 Fast" },
  { id: "grok-4.1-fast", name: "Grok 4.1 Fast" },
  { id: "grok-code-fast-1", name: "Grok Code Fast" },
  { id: "grok-4", name: "Grok 4" },
  { id: "grok-3", name: "Grok 3" },
  { id: "grok-3-mini", name: "Grok 3 Mini" },
];

const CHATGPT_PLUS_MODELS: ModelOption[] = [
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "gpt-5.1", name: "GPT-5.1" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "o4-mini", name: "o4-mini" },
];

const CHATGPT_PRO_MODELS: ModelOption[] = [
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "gpt-5.1", name: "GPT-5.1" },
  { id: "o3", name: "o3" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "o4-mini", name: "o4-mini" },
];

const CLAUDE_PRO_MODELS: ModelOption[] = [
  { id: "claude-sonnet-4-5", name: "Sonnet 4.5" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5" },
];

const CLAUDE_MAX_MODELS: ModelOption[] = [
  { id: "claude-opus-4-5", name: "Opus 4.5" },
  { id: "claude-sonnet-4-5", name: "Sonnet 4.5" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5" },
];

const GEMINI_MODELS: ModelOption[] = [
  { id: "gemini-2.5-pro", name: "2.5 Pro" },
  { id: "gemini-2.5-flash", name: "2.5 Flash" },
  { id: "gemini-2.5-flash-lite", name: "2.5 Flash-Lite" },
  { id: "gemini-2.0-flash", name: "2.0 Flash" },
];

const LAGUNA_MODELS: ModelOption[] = [
  { id: "poolside/laguna-s-2.1", name: "Laguna S 2.1" },
  { id: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1" },
];

const OPENROUTER_MODELS: ModelOption[] = [
  { id: "openrouter/auto", name: "Auto" },
  { id: "x-ai/grok-4.6", name: "Grok 4.6" },
  { id: "x-ai/grok-4.5", name: "Grok 4.5" },
  { id: "anthropic/claude-sonnet-4.5", name: "Sonnet 4.5" },
  { id: "openai/gpt-5.5", name: "GPT-5.5" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
];

const DEEPSEEK_MODELS: ModelOption[] = [
  { id: "deepseek-chat", name: "Chat" },
  { id: "deepseek-reasoner", name: "Reasoner" },
];

const OLLAMA_MODELS: ModelOption[] = [
  { id: "llama3.2", name: "Llama 3.2" },
  { id: "llama3.1", name: "Llama 3.1" },
  { id: "qwen2.5", name: "Qwen 2.5" },
  { id: "mistral", name: "Mistral" },
  { id: "deepseek-r1", name: "DeepSeek R1" },
  { id: "phi4", name: "Phi-4" },
];

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
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    compat: "xai",
    keyLabel: "xAI API key (optional)",
    signIn: "supergrok",
    models: GROK_MODELS,
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
    models: CHATGPT_PLUS_MODELS,
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
    models: CHATGPT_PRO_MODELS,
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
    models: CLAUDE_PRO_MODELS,
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
    models: CLAUDE_MAX_MODELS,
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
    models: GEMINI_MODELS,
  },
  {
    id: "laguna",
    name: "Laguna",
    plan: "Poolside · free",
    blurb: "Free agentic coding models from Poolside. One key, then pick S (stronger) or XS (faster).",
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
    models: LAGUNA_MODELS,
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
    models: OPENROUTER_MODELS,
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
    models: DEEPSEEK_MODELS,
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
    models: OLLAMA_MODELS,
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

export function normalizeProviderId(raw?: string): ProviderId {
  const id = (raw ?? "").trim();
  if (id === "laguna-s" || id === "laguna-xs" || id === "laguna") return "laguna";
  if (PROVIDER_DEFS.some((d) => d.id === id)) return id as ProviderId;
  return "supergrok";
}

export function aliasPreferredModel(raw?: string): string | undefined {
  const id = (raw ?? "").trim();
  if (id === "laguna-xs") return "poolside/laguna-xs-2.1";
  if (id === "laguna-s") return "poolside/laguna-s-2.1";
  return undefined;
}

export function canonicalizeModelId(id: string): string {
  let s = id.replace(/^models\//, "").trim();
  s = s.replace(/-(low|medium|high|max|xhigh)$/i, "");
  s = s.replace(/(\d)-(\d)(?!\d)/g, "$1.$2");
  return s;
}

export function modelIdsMatch(a: string, b: string): boolean {
  return canonicalizeModelId(a).toLowerCase() === canonicalizeModelId(b).toLowerCase();
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

export function pickModel(def: ProviderDef, requested?: string, live?: ModelOption[]): string {
  const pool = live && live.length > 0 ? live : def.models;
  const want = (requested ?? "").trim();
  if (want) {
    const hit = pool.find((m) => modelIdsMatch(m.id, want));
    if (hit) return hit.id;
    if (def.models.some((m) => modelIdsMatch(m.id, want))) return canonicalizeModelId(want);
    if (def.id === "local" || def.id === "openrouter") return want.slice(0, 120);
    if (/^[a-zA-Z0-9_./:+-]{2,120}$/.test(want)) return want;
  }
  if (pool.some((m) => m.id === def.model)) return def.model;
  return pool[0]?.id ?? def.model;
}

export function prettyModelName(id: string): string {
  let s = id.replace(/^models\//, "");
  if (s.startsWith("x-ai/")) s = s.slice(5);
  else if (s.startsWith("openai/")) s = s.slice(7);
  else if (s.startsWith("anthropic/")) s = s.slice(10);
  else if (s.startsWith("google/")) s = s.slice(7);
  else if (s.includes("/") && !s.startsWith("poolside/")) s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(/:latest$/, "");
  s = s.replace(/(\d)-(\d)(?!\d)/g, "$1.$2");
  return s
    .split(/[-_]/g)
    .filter(Boolean)
    .map((w) => {
      if (/^gpt$/i.test(w)) return "GPT";
      if (/^tts$/i.test(w)) return "TTS";
      if (/^o\d/i.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

export function modelLabel(def: ProviderDef, requested?: string, live?: ModelOption[]): string {
  const id = pickModel(def, requested, live);
  return (
    live?.find((m) => m.id === id)?.name ??
    def.models.find((m) => m.id === id)?.name ??
    prettyModelName(id)
  );
}

export function defaultModelByProvider(): Partial<Record<ProviderId, string>> {
  const out: Partial<Record<ProviderId, string>> = {};
  for (const d of PROVIDER_DEFS) out[d.id] = d.model;
  return out;
}
