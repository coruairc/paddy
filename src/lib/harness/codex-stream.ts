type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type BrainUsage = { promptTokens: number; completionTokens: number };

type CodexItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
};

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

function collectCodexItem(
  item: CodexItem | undefined,
  toolCalls: ToolCall[],
  addText: (text: string) => void,
): void {
  if (!item) return;
  if (item.type === "function_call" && item.call_id && item.name) {
    if (!toolCalls.some((t) => t.id === item.call_id)) {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "{}" },
      });
    }
  }
  if (item.type === "message") {
    addText((item.content ?? []).map((c) => c.text ?? "").join(""));
  }
}

export function parseCodexJson(json: {
  output_text?: string;
  output?: CodexItem[];
  usage?: unknown;
}): { content: string; toolCalls: ToolCall[]; usage: BrainUsage } {
  const toolCalls: ToolCall[] = [];
  let content = json.output_text ?? "";
  for (const item of json.output ?? []) {
    collectCodexItem(item, toolCalls, (text) => {
      content += text;
    });
  }
  return { content, toolCalls, usage: readUsage(json.usage) };
}

/** ChatGPT Codex only returns SSE. Buffer it into the same shape as a JSON response. */
export function parseCodexSse(raw: string): { content: string; toolCalls: ToolCall[]; usage: BrainUsage } {
  let content = "";
  const toolCalls: ToolCall[] = [];
  let usage: BrainUsage = { ...ZERO_USAGE };
  let error: string | undefined;
  let completedText: string | undefined;

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
    const type = String(evt.type ?? "");
    if (type === "error" || (typeof evt.detail === "string" && !type.startsWith("response."))) {
      const err = evt.error;
      error =
        (typeof err === "object" && err && "message" in err ? String((err as { message?: string }).message) : undefined) ||
        (typeof evt.message === "string" ? evt.message : undefined) ||
        (typeof evt.detail === "string" ? evt.detail : undefined) ||
        "Codex stream error";
      continue;
    }
    if (type === "response.output_text.delta") {
      content += String(evt.delta ?? "");
      continue;
    }
    if (type === "response.output_item.done" || type === "response.output_item.added") {
      collectCodexItem(evt.item as CodexItem | undefined, toolCalls, (text) => {
        content += text;
      });
      continue;
    }
    if (type === "response.completed" || type === "response.done") {
      const resp =
        (evt.response as {
          output_text?: string;
          output?: CodexItem[];
          usage?: unknown;
        }) ?? evt;
      if (typeof resp.output_text === "string" && resp.output_text) completedText = resp.output_text;
      usage = readUsage(resp.usage);
      for (const item of resp.output ?? []) {
        collectCodexItem(item, toolCalls, (text) => {
          if (!completedText) content += text;
        });
      }
    }
  }
  if (completedText) content = completedText;
  if (error && !content && !toolCalls.length) throw new Error(error);
  return { content, toolCalls, usage };
}

export async function readCodexHttp(
  res: Response,
): Promise<{ content: string; toolCalls: ToolCall[]; usage: BrainUsage }> {
  const text = await res.text();
  if (!res.ok) {
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; detail?: string };
      throw new Error(json.error?.message || json.detail || `ChatGPT error ${res.status}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(text.slice(0, 240) || `ChatGPT error ${res.status}`);
      }
      throw err;
    }
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("event-stream") || /^\s*event:|^\s*data:/m.test(text)) {
    return parseCodexSse(text);
  }
  return parseCodexJson(JSON.parse(text) as Parameters<typeof parseCodexJson>[0]);
}
