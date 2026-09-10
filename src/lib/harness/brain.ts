import { openaiTools } from "./tools";
import {
  defFor,
  isAnthropicOAuth,
  TOKEN_MAX,
  type BrainKeys,
  type Compat,
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
): { ok: true; route: BrainRoute } | { ok: false; error: string } {
  const def = defFor(preferred) ?? defFor("supergrok");
  if (!def) {
    return { ok: false, error: "No model provider configured." };
  }

  if (def.id === "local") {
    const host = trimKey(keys.ollamaHost) || env("OLLAMA_HOST") || def.baseUrl;
    const model = trimKey(keys.ollamaModel) || env("OLLAMA_MODEL") || def.model;
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
  let model = def.model;
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
      model = def.model;
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
        error: "Connect Laguna in Models — get a free Poolside key, then prefer S or XS.",
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
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
  return { content, toolCalls };
}

async function callOpenAiCompat(
  route: BrainRoute,
  messages: ChatMsg[],
  useTools: boolean,
  maxTokens: number,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
  };
}

type AnthropicResponse = {
  content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
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
): Promise<{ content: string; toolCalls: ToolCall[] }> {
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
  return { content: text, toolCalls };
}
