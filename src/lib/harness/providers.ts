export type ProviderId =
  | "supergrok"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "kimi"
  | "minimax"
  | "glm"
  | "qwen"
  | "deepseek"
  | "mistral"
  | "groq"
  | "laguna"
  | "openrouter"
  | "together"
  | "fireworks"
  | "huggingface"
  | "local";

export type ProviderGroup = "signin" | "labs" | "gateways" | "local";

export type ProviderStatus = "live" | "paired" | "idle";
export type KeySlot =
  | "xai"
  | "openai"
  | "anthropic"
  | "google"
  | "kimi"
  | "minimax"
  | "glm"
  | "qwen"
  | "deepseek"
  | "mistral"
  | "groq"
  | "poolside"
  | "openrouter"
  | "together"
  | "fireworks"
  | "huggingface"
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
  kimi?: string;
  minimax?: string;
  glm?: string;
  qwen?: string;
  deepseek?: string;
  mistral?: string;
  groq?: string;
  poolside?: string;
  openrouter?: string;
  together?: string;
  fireworks?: string;
  huggingface?: string;
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
  group: ProviderGroup;
  envAliases?: string[];
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

const CHATGPT_MODELS: ModelOption[] = [
  { id: "gpt-5.6", name: "GPT-5.6" },
  { id: "gpt-5.5", name: "GPT-5.5" },
  { id: "gpt-5.4", name: "GPT-5.4" },
  { id: "gpt-5.1", name: "GPT-5.1" },
  { id: "gpt-5", name: "GPT-5" },
  { id: "gpt-4.1", name: "GPT-4.1" },
  { id: "o3", name: "o3" },
  { id: "o4-mini", name: "o4-mini" },
];

const CLAUDE_MODELS: ModelOption[] = [
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

const KIMI_MODELS: ModelOption[] = [
  { id: "kimi-k2.5", name: "Kimi K2.5" },
  { id: "k3", name: "Kimi K3" },
  { id: "k3-256k", name: "Kimi K3 256k" },
  { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
  { id: "moonshot-v1-auto", name: "Moonshot Auto" },
];

const MINIMAX_MODELS: ModelOption[] = [
  { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
  { id: "MiniMax-M2.7-highspeed", name: "M2.7 Highspeed" },
  { id: "MiniMax-M3", name: "MiniMax M3" },
];

const GLM_MODELS: ModelOption[] = [
  { id: "glm-5.1", name: "GLM 5.1" },
  { id: "glm-5", name: "GLM 5" },
  { id: "glm-5-turbo", name: "GLM 5 Turbo" },
  { id: "glm-4.7", name: "GLM 4.7" },
  { id: "glm-4.6", name: "GLM 4.6" },
];

const QWEN_MODELS: ModelOption[] = [
  { id: "qwen-plus", name: "Qwen Plus" },
  { id: "qwen-max", name: "Qwen Max" },
  { id: "qwen-turbo", name: "Qwen Turbo" },
  { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
];

const MISTRAL_MODELS: ModelOption[] = [
  { id: "mistral-large-latest", name: "Mistral Large" },
  { id: "mistral-medium-latest", name: "Mistral Medium" },
  { id: "codestral-latest", name: "Codestral" },
];

const GROQ_MODELS: ModelOption[] = [
  { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
];

const TOGETHER_MODELS: ModelOption[] = [
  { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B" },
  { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B" },
  { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
];

const FIREWORKS_MODELS: ModelOption[] = [
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B" },
  { id: "accounts/fireworks/models/deepseek-v3", name: "DeepSeek V3" },
  { id: "accounts/fireworks/models/qwen2p5-72b-instruct", name: "Qwen 2.5 72B" },
];

const HUGGINGFACE_MODELS: ModelOption[] = [
  { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
  { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
  { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
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
    group: "signin",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    plan: "OpenAI · Go / Plus / Pro",
    blurb: "One ChatGPT sign-in. Go, Plus, and Pro all work — Paddy spends that plan’s Codex quota. An API key still works as a fallback.",
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
    models: CHATGPT_MODELS,
    group: "signin",
  },
  {
    id: "claude",
    name: "Claude",
    plan: "Anthropic · Pro / Max",
    blurb: "One Claude login. Paste a claude setup-token (Pro or Max) or an API key. Anthropic does not let third-party apps run Claude.ai login.",
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
    models: CLAUDE_MODELS,
    group: "signin",
  },
  {
    id: "gemini",
    name: "Gemini",
    plan: "Google AI · free or Pro/Ultra",
    blurb: "A free AI Studio key is enough. Google AI Pro/Ultra keys work too.",
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
    group: "labs",
    envAliases: ["GEMINI_API_KEY"],
  },
  {
    id: "kimi",
    name: "Kimi",
    plan: "Moonshot · Kimi Coding",
    blurb: "Moonshot / Kimi Coding Plan. A sk-kimi- membership key uses the coding endpoint; a Moonshot key uses api.moonshot.ai.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "platform.moonshot.ai or kimi.com/code → API key.",
    slot: "kimi",
    envVar: "KIMI_API_KEY",
    model: "kimi-k2.5",
    baseUrl: "https://api.moonshot.ai/v1",
    compat: "openai",
    keyLabel: "Kimi / Moonshot API key",
    connectUrl: "https://platform.moonshot.ai/",
    connectLabel: "Get a Kimi key",
    models: KIMI_MODELS,
    group: "labs",
    envAliases: ["MOONSHOT_API_KEY", "KIMI_CODING_API_KEY"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    plan: "MiniMax · M2 / M3",
    blurb: "International MiniMax API. Paste a MINIMAX_API_KEY. Set MINIMAX_API_HOST if you use the China endpoint.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "platform.minimax.io → API keys.",
    slot: "minimax",
    envVar: "MINIMAX_API_KEY",
    model: "MiniMax-M2.7",
    baseUrl: "https://api.minimax.io/v1",
    compat: "openai",
    keyLabel: "MiniMax API key",
    connectUrl: "https://platform.minimax.io/",
    connectLabel: "Get a MiniMax key",
    models: MINIMAX_MODELS,
    group: "labs",
  },
  {
    id: "glm",
    name: "GLM",
    plan: "Z.AI · GLM",
    blurb: "Zhipu GLM via z.ai. Coding-plan and platform keys both work. Same stack OpenClaw and Hermes call zai.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "z.ai or bigmodel.cn → API key.",
    slot: "glm",
    envVar: "ZAI_API_KEY",
    model: "glm-5.1",
    baseUrl: "https://api.z.ai/api/paas/v4",
    compat: "openai",
    keyLabel: "Z.AI / GLM API key",
    connectUrl: "https://z.ai/",
    connectLabel: "Get a Z.AI key",
    models: GLM_MODELS,
    group: "labs",
    envAliases: ["GLM_API_KEY", "Z_AI_API_KEY"],
  },
  {
    id: "qwen",
    name: "Qwen",
    plan: "Alibaba · DashScope",
    blurb: "Qwen via DashScope compatible-mode. Coding Plan keys work too.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "modelstudio.console.aliyun.com → API key.",
    slot: "qwen",
    envVar: "DASHSCOPE_API_KEY",
    model: "qwen-plus",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    compat: "openai",
    keyLabel: "DashScope API key",
    connectUrl: "https://modelstudio.console.aliyun.com/",
    connectLabel: "Get a Qwen key",
    models: QWEN_MODELS,
    group: "labs",
    envAliases: ["QWEN_API_KEY", "ALIBABA_CODING_PLAN_API_KEY"],
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
    group: "labs",
  },
  {
    id: "mistral",
    name: "Mistral",
    plan: "Mistral AI · La Plateforme",
    blurb: "Official Mistral API. Large, Medium, and Codestral.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "console.mistral.ai → API keys.",
    slot: "mistral",
    envVar: "MISTRAL_API_KEY",
    model: "mistral-large-latest",
    baseUrl: "https://api.mistral.ai/v1",
    compat: "openai",
    keyLabel: "Mistral API key",
    connectUrl: "https://console.mistral.ai/api-keys/",
    connectLabel: "Get a Mistral key",
    models: MISTRAL_MODELS,
    group: "labs",
  },
  {
    id: "groq",
    name: "Groq",
    plan: "GroqCloud · LPU",
    blurb: "Fast OpenAI-compatible inference. Llama, GPT-OSS, Qwen on Groq LPUs.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "console.groq.com → API keys.",
    slot: "groq",
    envVar: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai/v1",
    compat: "openai",
    keyLabel: "Groq API key",
    connectUrl: "https://console.groq.com/keys",
    connectLabel: "Get a Groq key",
    models: GROQ_MODELS,
    group: "labs",
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
    group: "labs",
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
    group: "gateways",
  },
  {
    id: "together",
    name: "Together",
    plan: "Together AI · inference",
    blurb: "Open models hosted by Together. Llama, Qwen, DeepSeek.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "api.together.ai → keys.",
    slot: "together",
    envVar: "TOGETHER_API_KEY",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    baseUrl: "https://api.together.xyz/v1",
    compat: "openai",
    keyLabel: "Together API key",
    connectUrl: "https://api.together.ai/",
    connectLabel: "Get a Together key",
    models: TOGETHER_MODELS,
    group: "gateways",
  },
  {
    id: "fireworks",
    name: "Fireworks",
    plan: "Fireworks AI · inference",
    blurb: "OpenAI-compatible Fireworks inference.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "fireworks.ai → API keys.",
    slot: "fireworks",
    envVar: "FIREWORKS_API_KEY",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    compat: "openai",
    keyLabel: "Fireworks API key",
    connectUrl: "https://fireworks.ai/account/api-keys",
    connectLabel: "Get a Fireworks key",
    models: FIREWORKS_MODELS,
    group: "gateways",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    plan: "HF Inference · router",
    blurb: "Hugging Face router. One token, many open models.",
    kind: "subscription",
    liveHere: false,
    auth: "api-key",
    pairHint: "huggingface.co/settings/tokens.",
    slot: "huggingface",
    envVar: "HF_TOKEN",
    model: "Qwen/Qwen2.5-72B-Instruct",
    baseUrl: "https://router.huggingface.co/v1",
    compat: "openai",
    keyLabel: "HF token",
    connectUrl: "https://huggingface.co/settings/tokens",
    connectLabel: "Get an HF token",
    models: HUGGINGFACE_MODELS,
    group: "gateways",
    envAliases: ["HUGGINGFACE_API_KEY"],
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
    group: "local",
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
  if (id === "chatgpt-plus" || id === "chatgpt-pro" || id === "codex") return "chatgpt";
  if (id === "claude-pro" || id === "claude-max") return "claude";
  if (id === "kimi-coding" || id === "moonshot") return "kimi";
  if (id === "zai" || id === "zhipu" || id === "z-ai") return "glm";
  if (id === "dashscope" || id === "alibaba") return "qwen";
  if (PROVIDER_DEFS.some((d) => d.id === id)) return id as ProviderId;
  return "supergrok";
}

export const PROVIDER_GROUP_LABEL: Record<ProviderGroup, string> = {
  signin: "Sign in",
  labs: "Labs",
  gateways: "Gateways",
  local: "On this machine",
};

export const PROVIDER_GROUP_ORDER: ProviderGroup[] = ["signin", "labs", "gateways", "local"];

export function aliasPreferredModel(raw?: string): string | undefined {
  const id = (raw ?? "").trim();
  if (id === "laguna-xs") return "poolside/laguna-xs-2.1";
  if (id === "laguna-s") return "poolside/laguna-s-2.1";
  return undefined;
}

export function canonicalizeModelId(id: string): string {
  let s = id.replace(/^models\//, "").trim();
  s = s.replace(/-(low|medium|high|max|xhigh)$/i, "");
  // Fold grok-4-6 → grok-4.6, not dated stamps like grok-4.20-0309.
  s = s.replace(/(?<![0-9.])(\d)-(\d)(?![0-9])/g, "$1.$2");
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
  const slots: KeySlot[] = [
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
  ];
  return slots.find((s) => s === key);
}

export function envNamesFor(def: { envVar: string; envAliases?: string[]; slot: KeySlot }): string[] {
  const names = [def.envVar, ...(def.envAliases ?? [])];
  if (def.slot === "openai") names.push("CHATGPT_ACCESS_TOKEN", "CODEX_ACCESS_TOKEN");
  if (def.slot === "anthropic") names.push("ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN");
  return names;
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
