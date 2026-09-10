import { openaiTools } from "./tools";
import {
  aliasPreferredModel,
  canonicalizeModelId,
  defFor,
  isAnthropicOAuth,
  normalizeProviderId,
  pickModel,
  prettyModelName,
  TOKEN_MAX,
  type BrainKeys,
  type Compat,
  type ModelOption,
  type ProviderId,
} from "./providers";
import { CODEX_API, isCodexAccess, refreshCodexToken } from "./oauth-codex";
import { isXaiAccess, refreshXaiToken } from "./oauth-xai";

export type ChatMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type BrainUsage = { promptTokens: number; completionTokens: number };

const ZERO_USAGE: BrainUsage = { promptTokens: 0, completionTokens: 0 };

function readUsage(raw: unknown): BrainUsage {
  if (!raw || typeof raw !== "object") return { ...ZERO_USAGE };
  const u = raw as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    completionTokens: Number.isFinite(completion) ? completion : 0,
  };
}

export interface BrainRoute {
  provider: ProviderId;
  label: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  compat: Compat;
  accountId?: string;
  refresh?: string;
  rotated?: BrainKeys;
}

type OpenAiResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: { message?: string };
};

function trimKey(raw?: string): string {
  return (raw ?? "").trim().slice(0, TOKEN_MAX);
}

function env(name: string): string {
  return trimKey(process.env[name]);
}

export function resolveBrain(
  preferred: ProviderId,
  keys: BrainKeys,
  modelId?: string,
): { ok: true; route: BrainRoute } | { ok: false; error: string } {
  const requested = modelId || aliasPreferredModel(preferred);
  const def = defFor(normalizeProviderId(preferred)) ?? defFor("supergrok");
  if (!def) {
    return { ok: false, error: "No model provider configured." };
  }

  if (def.id === "local") {
    const host = trimKey(keys.ollamaHost) || env("OLLAMA_HOST") || def.baseUrl;
    const model =
      pickModel(def, requested) !== def.model
        ? pickModel(def, requested)
        : trimKey(keys.ollamaModel) || env("OLLAMA_MODEL") || def.model;
    const baseUrl = host.replace(/\/$/, "").endsWith("/v1")
      ? host.replace(/\/$/, "")
      : `${host.replace(/\/$/, "")}/v1`;
    return {
      ok: true,
      route: {
        provider: def.id,
        label: def.name,
        model,
        baseUrl,
        apiKey: "ollama",
        compat: "openai",
      },
    };
  }

  let apiKey = "";
  let compat: Compat = def.compat;
  let baseUrl = def.baseUrl.replace(/\/$/, "");
  let model = pickModel(def, requested);
  let accountId: string | undefined;
  let refresh: string | undefined;

  if (def.slot === "xai") {
    const access = trimKey(keys.xaiAccess);
    if (isXaiAccess(access)) {
      apiKey = access;
      refresh = trimKey(keys.xaiRefresh);
    } else {
      apiKey = trimKey(keys.xai) || env("XAI_API_KEY");
    }
  } else if (def.slot === "openai") {
    const access =
      trimKey(keys.codexAccess) || env("CHATGPT_ACCESS_TOKEN") || env("CODEX_ACCESS_TOKEN");
    if (isCodexAccess(access)) {
      apiKey = access;
      refresh = trimKey(keys.codexRefresh) || env("CHATGPT_REFRESH_TOKEN") || env("CODEX_REFRESH_TOKEN");
      accountId = trimKey(keys.codexAccount) || env("CHATGPT_ACCOUNT_ID") || undefined;
      compat = "codex";
      baseUrl = CODEX_API;
      model = pickModel(def, modelId);
    } else {
      apiKey = trimKey(keys.openai) || env("OPENAI_API_KEY");
    }
  } else if (def.slot === "anthropic") {
    apiKey =
      trimKey(keys.anthropicOAuth) ||
      trimKey(keys.anthropic) ||
      env("ANTHROPIC_TOKEN") ||
      env("CLAUDE_CODE_OAUTH_TOKEN") ||
      env("ANTHROPIC_API_KEY");
  } else if (def.slot === "google") {
    apiKey = trimKey(keys.google) || env("GOOGLE_API_KEY") || env("GEMINI_API_KEY");
  } else if (def.slot === "poolside") {
    apiKey = trimKey(keys.poolside) || env("POOLSIDE_API_KEY");
  } else if (def.slot === "openrouter") apiKey = trimKey(keys.openrouter) || env("OPENROUTER_API_KEY");
  else if (def.slot === "deepseek") apiKey = trimKey(keys.deepseek) || env("DEEPSEEK_API_KEY");

  if (!apiKey) {
    if (def.id === "supergrok") {
      return {
        ok: false,
        error: "Connect SuperGrok in Models — Sign in with SuperGrok, or paste an xAI key.",
      };
    }
    if (def.slot === "openai") {
      return {
        ok: false,
        error: `Connect ${def.name} in Models — Sign in with ChatGPT, or paste an API key.`,
      };
    }
    if (def.slot === "anthropic") {
      return {
        ok: false,
        error: `Connect ${def.name} in Models — paste a claude setup-token or an API key.`,
      };
    }
    if (def.slot === "google") {
      return {
        ok: false,
        error: "Connect Gemini in Models — get a free Google AI key, or paste one you already have.",
      };
    }
    if (def.slot === "poolside") {
      return {
        ok: false,
        error: "Connect Laguna in Models — get a free Poolside key, then pick S or XS.",
      };
    }
    return {
      ok: false,
      error: `Connect ${def.name} in Models (subscription token or ${def.keyLabel}) or set ${def.envVar} when you self-host.`,
    };
  }

  return {
    ok: true,
    route: {
      provider: def.id,
      label: def.name,
      model,
      baseUrl,
      apiKey,
      compat,
      accountId,
      refresh,
    },
  };
}

export async function listAvailableModels(route: BrainRoute): Promise<ModelOption[]> {
  const ids = await fetchModelIds(route);
  const unique = [
    ...new Set(
      ids
        .map(normalizeModelId)
        .map(canonicalizeModelId)
        .filter((id) => id && !skipModelId(id)),
    ),
  ];
  const picked =
    route.provider === "openrouter" ? rankOpenRouter(unique) : unique.slice(0, 48);
  return picked.map((id) => ({ id, name: prettyModelName(id) }));
}

function normalizeModelId(id: string): string {
  return id.replace(/^models\//, "").trim();
}

function skipModelId(id: string): boolean {
  const s = id.toLowerCase();
  if (
    /embed|whisper|tts|dall-e|dalle|imagen|imagine|moderation|realtime|audio|wav|voice|flux|video|stt|computer-use/.test(
      s,
    )
  ) {
    return true;
  }
  if (/grok-2-image|image-gen/.test(s)) return true;
  return false;
}

function rankOpenRouter(ids: string[]): string[] {
  const scored = ids
    .map((id) => ({ id, n: openRouterScore(id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  return scored.slice(0, 36).map((x) => x.id);
}

function openRouterScore(id: string): number {
  const s = id.toLowerCase();
  if (s === "openrouter/auto" || s === "auto") return 100;
  if (s.includes("grok-4.6")) return 98;
  if (s.startsWith("x-ai/")) return 90;
  if (s.includes("claude") && !s.includes(":free")) return 70;
  if (s.includes("gpt-5") || s.includes("gpt-4.1")) return 65;
  if (s.includes("gemini-2")) return 60;
  if (s.includes("deepseek") && !s.includes(":free")) return 50;
  if (s.includes(":free")) return 8;
  return 12;
}

function extractIds(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  const arr = (
    Array.isArray(o.data) ? o.data : Array.isArray(o.models) ? o.models : Array.isArray(json) ? json : []
  ) as unknown[];
  const ids: string[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (Array.isArray(r.supportedGenerationMethods)) {
      const methods = r.supportedGenerationMethods as string[];
      if (!methods.includes("generateContent")) continue;
    }
    const id = r.id ?? r.name ?? r.model;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

async function fetchModelIds(route: BrainRoute): Promise<string[]> {
  if (route.provider === "local") {
    const host = route.baseUrl.replace(/\/v1\/?$/, "");
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) throw new Error(`Ollama tags ${res.status}`);
    return extractIds(await res.json());
  }
  if (route.provider === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
      headers: { "x-goog-api-key": route.apiKey },
    });
    if (!res.ok) throw new Error(`Gemini models ${res.status}`);
    return extractIds(await res.json());
  }
  if (route.compat === "anthropic") {
    const res = await fetch(`${route.baseUrl.replace(/\/$/, "")}/models`, {
      headers: anthropicHeaders(route.apiKey),
    });
    if (!res.ok) throw new Error(`Anthropic models ${res.status}`);
    return extractIds(await res.json());
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${route.apiKey}`,
    Accept: "application/json",
  };
  if (route.compat === "codex") {
    headers.originator = "codex_cli_rs";
    headers["OpenAI-Beta"] = "responses=experimental";
    if (route.accountId) headers["ChatGPT-Account-Id"] = route.accountId;
  }
  if (route.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://paddy.local";
    headers["X-Title"] = "Paddy";
  }

  const urls =
    route.compat === "xai"
      ? [`${route.baseUrl}/language-models`, `${route.baseUrl}/models`]
      : [`${route.baseUrl}/models`];

  let last = "Could not list models";
  for (const url of urls) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
      last = `Models ${res.status}`;
      continue;
    }
    const ids = extractIds(await res.json());
    if (ids.length) return ids;
  }
  throw new Error(last);
}

export function envPresence(): Record<string, boolean> {
  return {
    xai: Boolean(env("XAI_API_KEY")),
    openai: Boolean(
      env("OPENAI_API_KEY") || env("CHATGPT_ACCESS_TOKEN") || env("CODEX_ACCESS_TOKEN"),
    ),
    anthropic: Boolean(
      env("ANTHROPIC_API_KEY") || env("ANTHROPIC_TOKEN") || env("CLAUDE_CODE_OAUTH_TOKEN"),
    ),
    google: Boolean(env("GOOGLE_API_KEY") || env("GEMINI_API_KEY")),
    poolside: Boolean(env("POOLSIDE_API_KEY")),
    openrouter: Boolean(env("OPENROUTER_API_KEY")),
    deepseek: Boolean(env("DEEPSEEK_API_KEY")),
    ollama: Boolean(env("OLLAMA_HOST")),
  };
}

export async function callBrain(
  route: BrainRoute,
  messages: ChatMsg[],
  useTools: boolean,
  maxTokens: number,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: BrainUsage }> {
  if (route.compat === "codex") {
    return callCodex(route, messages, useTools, maxTokens);
  }
  if (route.compat === "anthropic") {
    return callAnthropic(route, messages, useTools, maxTokens);
  }
  return callOpenAiCompat(route, messages, useTools, maxTokens);
}

async function callCodex(
  route: BrainRoute,
  messages: ChatMsg[],
  useTools: boolean,
  maxTokens: number,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: BrainUsage }> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: m.content,
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }
    input.push({ role: m.role, content: m.content ?? "" });
  }
  const body: Record<string, unknown> = {
    model: route.model,
    store: false,
    instructions: system || undefined,
    input,
    max_output_tokens: maxTokens,
  };
  if (useTools) {
    body.tools = openaiTools().map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${route.apiKey}`,
    originator: "codex_cli_rs",
    "OpenAI-Beta": "responses=experimental",
  };
  if (route.accountId) headers["ChatGPT-Account-Id"] = route.accountId;

  let res = await fetch(`${route.baseUrl}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401 && route.refresh) {
    const next = await refreshCodexToken(route.refresh);
    route.apiKey = next.access;
    route.refresh = next.refresh;
    route.accountId = next.accountId ?? route.accountId;
    route.rotated = {
      codexAccess: next.access,
      codexRefresh: next.refresh,
      codexExpires: String(next.expires),
      codexAccount: route.accountId,
    };
    headers.Authorization = `Bearer ${next.access}`;
    if (route.accountId) headers["ChatGPT-Account-Id"] = route.accountId;
    res = await fetch(`${route.baseUrl}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
  const json = (await res.json()) as {
    output_text?: string;
    output?: {
      type?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
      content?: { type?: string; text?: string }[];
    }[];
    error?: { message?: string };
    detail?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  if (!res.ok) {
    throw new Error(json.error?.message || json.detail || `ChatGPT error ${res.status}`);
  }
  const toolCalls: ToolCall[] = [];
  let content = json.output_text ?? "";
  for (const item of json.output ?? []) {
    if (item.type === "function_call" && item.call_id && item.name) {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "{}" },
      });
    }
    if (item.type === "message") {
      content += (item.content ?? []).map((c) => c.text ?? "").join("");
    }
  }
  return { content, toolCalls, usage: readUsage(json.usage) };
}

async function callOpenAiCompat(
  route: BrainRoute,
  messages: ChatMsg[],
  useTools: boolean,
  maxTokens: number,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: BrainUsage }> {
  const body: Record<string, unknown> = {
    model: route.model,
    messages,
    temperature: 0.4,
    max_tokens: maxTokens,
  };
  if (route.compat === "xai") {
    body.reasoning_effort = "low";
  }
  if (useTools) {
    body.tools = openaiTools();
    body.tool_choice = "auto";
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${route.apiKey}`,
  };
  if (route.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://paddy.local";
    headers["X-Title"] = "Paddy";
  }
  const res = await fetch(`${route.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let used = res;
  if (res.status === 401 && route.refresh) {
    const next = await refreshXaiToken(route.refresh);
    route.apiKey = next.access;
    route.refresh = next.refresh;
    route.rotated = {
      xaiAccess: next.access,
      xaiRefresh: next.refresh,
      xaiExpires: String(next.expires),
    };
    headers.Authorization = `Bearer ${next.access}`;
    used = await fetch(`${route.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }
  const json = (await used.json()) as OpenAiResponse;
  if (!used.ok) {
    const msg = json.error?.message || `${route.label} error ${used.status}`;
    throw new Error(msg);
  }
  const message = json.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    toolCalls: message?.tool_calls ?? [],
    usage: readUsage(json.usage),
  };
}

type AnthropicResponse = {
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

function anthropicHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (isAnthropicOAuth(apiKey)) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function callAnthropic(
  route: BrainRoute,
  messages: ChatMsg[],
  useTools: boolean,
  maxTokens: number,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: BrainUsage }> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const converted: { role: "user" | "assistant"; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      converted.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      if (m.tool_calls?.length) {
        const blocks: unknown[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            input = { raw: tc.function.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        converted.push({ role: "assistant", content: blocks });
      } else {
        converted.push({ role: "assistant", content: m.content ?? "" });
      }
      continue;
    }
    converted.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content,
        },
      ],
    });
  }

  const body: Record<string, unknown> = {
    model: route.model,
    max_tokens: maxTokens,
    temperature: 0.4,
    system,
    messages: converted,
  };
  if (useTools) {
    body.tools = openaiTools().map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch(`${route.baseUrl}/messages`, {
    method: "POST",
    headers: anthropicHeaders(route.apiKey),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as AnthropicResponse;
  if (!res.ok) {
    throw new Error(json.error?.message || `${route.label} error ${res.status}`);
  }
  const blocks = json.content ?? [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use" && b.id && b.name)
    .map((b) => ({
      id: b.id as string,
      type: "function" as const,
      function: {
        name: b.name as string,
        arguments: JSON.stringify(b.input ?? {}),
      },
    }));
  return { content: text, toolCalls, usage: readUsage(json.usage) };
}
