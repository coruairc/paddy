/**
 * Opt-in HTTP client for OpenClaw Gateway chat completions.
 * Enabled when ~/.paddy/config.json has openclaw.runtime = "openclaw".
 * Always sends stream:true (ChatGPT-backed OpenClaw paths 400 without it).
 */
export type OpenClawChatMsg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenClawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenClawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenClawUsage = { promptTokens: number; completionTokens: number };

export type OpenClawTarget = {
  url: string;
  token: string;
  model: string;
};

export type OpenClawToolSpec = {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
};

const ZERO_USAGE: OpenClawUsage = { promptTokens: 0, completionTokens: 0 };

function readUsage(raw: unknown): OpenClawUsage {
  if (!raw || typeof raw !== "object") return { ...ZERO_USAGE };
  const u = raw as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  return {
    promptTokens: Number.isFinite(prompt) ? prompt : 0,
    completionTokens: Number.isFinite(completion) ? completion : 0,
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function openClawChatUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/v1/chat/completions`;
}

export function openClawModelsUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/v1/models`;
}

/** Human hints for common OpenClaw gateway misconfig. */
export function openClawHttpHint(status: number, bodyText = ""): string {
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 180);
  if (status === 401 || status === 403) {
    return (
      `OpenClaw gateway rejected auth (HTTP ${status}). ` +
      `Set openclaw.token / OPENCLAW_GATEWAY_TOKEN to match gateway.auth.token, ` +
      `or use gateway.auth.mode=none on private loopback. ` +
      (snippet ? `Detail: ${snippet}` : "")
    ).trim();
  }
  if (status === 404) {
    return (
      `OpenClaw chat completions not found (HTTP 404). ` +
      `Enable gateway.http.endpoints.chatCompletions.enabled=true in ~/.openclaw/openclaw.json ` +
      `and restart the gateway. Default URL is http://127.0.0.1:18789. ` +
      (snippet ? `Detail: ${snippet}` : "")
    ).trim();
  }
  return snippet || `OpenClaw gateway error HTTP ${status}`;
}

type ToolCallAcc = {
  id?: string;
  name?: string;
  arguments: string;
};

/**
 * Buffer OpenAI-style chat.completion SSE into a non-stream response shape.
 * Mirrors the collect pattern used for Codex in codex-stream.ts.
 */
export function parseOpenAiChatSse(raw: string): {
  content: string;
  toolCalls: OpenClawToolCall[];
  usage: OpenClawUsage;
} {
  let content = "";
  let usage: OpenClawUsage = { ...ZERO_USAGE };
  let error: string | undefined;
  const byIndex = new Map<number, ToolCallAcc>();

  for (const block of raw.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (evt.error) {
      const err = evt.error;
      error =
        typeof err === "object" && err && "message" in err
          ? String((err as { message?: string }).message)
          : typeof err === "string"
            ? err
            : "OpenClaw stream error";
      continue;
    }
    if (evt.usage) usage = readUsage(evt.usage);
    const choices = Array.isArray(evt.choices) ? evt.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const c = choice as {
        delta?: {
          content?: string | null;
          tool_calls?: {
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
        };
        message?: {
          content?: string | null;
          tool_calls?: OpenClawToolCall[];
        };
        finish_reason?: string | null;
      };
      if (c.message?.content) content = String(c.message.content);
      if (c.message?.tool_calls?.length) {
        for (let i = 0; i < c.message.tool_calls.length; i++) {
          const tc = c.message.tool_calls[i]!;
          byIndex.set(i, {
            id: tc.id,
            name: tc.function?.name,
            arguments: tc.function?.arguments ?? "",
          });
        }
      }
      const delta = c.delta;
      if (!delta) continue;
      if (typeof delta.content === "string") content += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const idx = typeof tc.index === "number" ? tc.index : 0;
        const acc = byIndex.get(idx) ?? { arguments: "" };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") acc.arguments += tc.function.arguments;
        byIndex.set(idx, acc);
      }
    }
  }

  const toolCalls: OpenClawToolCall[] = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, acc], i) => ({
      id: acc.id || `call_${i}`,
      type: "function" as const,
      function: {
        name: acc.name || "unknown",
        arguments: acc.arguments || "{}",
      },
    }))
    .filter((t) => t.function.name !== "unknown" || t.function.arguments !== "{}");

  if (error && !content && !toolCalls.length) throw new Error(error);
  return { content, toolCalls, usage };
}

export async function readOpenClawChatHttp(
  res: Response,
): Promise<{ content: string; toolCalls: OpenClawToolCall[]; usage: OpenClawUsage }> {
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; detail?: string };
      if (typeof json.error === "string") detail = json.error;
      else if (json.error && typeof json.error === "object") detail = json.error.message || "";
      else detail = json.detail || "";
    } catch {
      detail = text.slice(0, 240);
    }
    throw new Error(openClawHttpHint(res.status, detail));
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("event-stream") || /^\s*event:|^\s*data:/m.test(text)) {
    return parseOpenAiChatSse(text);
  }
  const json = JSON.parse(text) as {
    choices?: { message?: { content?: string | null; tool_calls?: OpenClawToolCall[] } }[];
    usage?: unknown;
    error?: { message?: string };
  };
  if (json.error?.message) throw new Error(json.error.message);
  const message = json.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    toolCalls: message?.tool_calls ?? [],
    usage: readUsage(json.usage),
  };
}

export type CallOpenClawOpts = {
  target: OpenClawTarget;
  messages: OpenClawChatMsg[];
  tools?: OpenClawToolSpec[] | null;
  maxTokens?: number;
  temperature?: number;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Stable session affinity when set (OpenAI `user` field). */
  user?: string;
};

/**
 * Always posts stream:true and buffers SSE — required for ChatGPT-backed OpenClaw agents.
 */
export async function callOpenClawChat(
  opts: CallOpenClawOpts,
): Promise<{ content: string; toolCalls: OpenClawToolCall[]; usage: OpenClawUsage }> {
  const { target, messages } = opts;
  const url = openClawChatUrl(target.url);
  const body: Record<string, unknown> = {
    model: target.model || "openclaw",
    messages,
    stream: true,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  if (typeof opts.maxTokens === "number" && opts.maxTokens > 0) {
    body.max_tokens = opts.maxTokens;
  }
  if (typeof opts.temperature === "number") {
    body.temperature = opts.temperature;
  }
  if (opts.user) body.user = opts.user;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (target.token) headers.Authorization = `Bearer ${target.token}`;

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return readOpenClawChatHttp(res);
}

/** Lightweight reachability probe for FE Gateway UI (models list, not a full agent turn). */
export async function probeOpenClawGateway(
  target: OpenClawTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  const url = openClawModelsUrl(target.url);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  try {
    const res = await fetchImpl(url, { method: "GET", headers });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: openClawHttpHint(res.status, text) };
    }
    let count = 0;
    try {
      const json = JSON.parse(text) as { data?: unknown[] };
      count = Array.isArray(json.data) ? json.data.length : 0;
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      detail: `OpenClaw · ${trimSlash(target.url)} · model ${target.model || "openclaw"} · ${count} agent target(s)`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `OpenClaw unreachable at ${trimSlash(target.url)}: ${err.message}`
          : `OpenClaw unreachable at ${trimSlash(target.url)}`,
    };
  }
}
