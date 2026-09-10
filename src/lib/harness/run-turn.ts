import { createServerFn } from "@tanstack/react-start";
import { getHubSkill, searchHub } from "./hub";
import { callBrain, envPresence, resolveBrain, type BrainRoute, type ChatMsg } from "./brain";
import { pollCodexDevice, startCodexDevice } from "./oauth-codex";
import { pollXaiDevice, startXaiDevice } from "./oauth-xai";
import { TOKEN_MAX, type BrainKeys, type ProviderId } from "./providers";
import { buildSystemPrompt } from "./prompt";
import type {
  HelixTurnInput,
  HelixTurnResult,
  MemoryKind,
  Mutation,
  ToolName,
  TraceEvent,
} from "./types";

const MAX_ROUNDS = 3;
const MAX_TOKENS = 1024;
const SUBAGENT_TOKENS = 350;

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return { raw };
  }
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function searchWorkspace(input: HelixTurnInput, query: string): string {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const m of input.memories) {
    if (m.text.toLowerCase().includes(q)) hits.push(`[memory/${m.kind}] ${m.text}`);
  }
  const files = input.files;
  for (const [name, content] of Object.entries(files)) {
    if (content.toLowerCase().includes(q)) {
      const line = content
        .split("\n")
        .filter((line: string) => line.toLowerCase().includes(q))
        .slice(0, 3)
        .join(" | ");
      hits.push(`[file/${name}] ${line}`);
    }
  }
  for (const s of input.skills) {
    const blob = `${s.name} ${s.description} ${s.instructions}`.toLowerCase();
    if (blob.includes(q)) hits.push(`[skill/${s.name}] ${s.description}`);
  }
  for (const m of input.transcript ?? input.history) {
    if (m.content.toLowerCase().includes(q)) {
      hits.push(`[transcript/${m.role}] ${m.content.slice(0, 180)}`);
    }
  }
  if (!hits.length) return `No matches for “${query}”.`;
  return hits.slice(0, 8).join("\n");
}

function readFile(input: HelixTurnInput, file: string): string {
  const key = file.toLowerCase().replace(/\.md$/, "");
  const map: Record<string, string> = {
    soul: input.files.soul,
    identity: input.files.identity,
    user: input.files.user,
    memory: input.files.memory,
    agents: input.files.agents,
  };
  if (map[key]) return map[key];
  const skill = input.skills.find((s) => s.name.toLowerCase() === key);
  if (skill) {
    return `# ${skill.name}\n\n${skill.description}\n\n${skill.instructions}`;
  }
  return `Unknown file: ${file}`;
}

const KEY_FIELDS: (keyof BrainKeys)[] = [
  "xai",
  "openai",
  "anthropic",
  "google",
  "poolside",
  "openrouter",
  "deepseek",
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

export async function executeTurn(data: HelixTurnInput): Promise<HelixTurnResult> {
    const preferred = (data.preferredProvider as ProviderId) || "supergrok";
    const resolved = resolveBrain(preferred, sanitizeKeys(data.keys));
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    const route = resolved.route;

    const traces: Omit<TraceEvent, "id" | "at">[] = [];
    const mutations: Mutation[] = [];
    let pendingApproval:
      | { tool: ToolName; args: Record<string, string>; reason: string }
      | undefined;
    let subagentUsed = false;

    const history = data.history.slice(-10).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2500),
    }));

    const messages: ChatMsg[] = [
      { role: "system", content: buildSystemPrompt(data) },
      ...history,
      { role: "user", content: data.userMessage.slice(0, 4000) },
    ];

    traces.push({
      kind: "model",
      title: "Turn started",
      detail: `${route.label} · ${route.model}. Profile ${data.profileName}. ${data.skills.length} skills.`,
      status: "ok",
    });

    let finalText = "";

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { content, toolCalls } = await callBrain(
          route,
          messages,
          true,
          MAX_TOKENS,
        );

        if (!toolCalls.length) {
          finalText = content.trim();
          traces.push({
            kind: "model",
            title: round === 0 ? "Direct reply" : "Loop settled",
            detail: `Round ${round + 1}.`,
            status: "ok",
          });
          break;
        }

        messages.push({
          role: "assistant",
          content: content || null,
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          const name = tc.function.name as ToolName;
          const args = parseArgs(tc.function.arguments);
          const needsApproval = data.policy.requireApproval.includes(name);

          if (needsApproval && !pendingApproval) {
            const asStrings: Record<string, string> = {};
            for (const [k, v] of Object.entries(args)) {
              asStrings[k] = typeof v === "string" ? v : JSON.stringify(v);
            }
            pendingApproval = {
              tool: name,
              args: asStrings,
              reason:
                name === "send_channel"
                  ? "Outbound channel send leaves the workspace."
                  : "Subagents spend a nested model call.",
            };
            traces.push({
              kind: "permission",
              title: `Approval required: ${name}`,
              detail: pendingApproval.reason,
              status: "pending",
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content:
                "Held for operator approval. Continue without assuming it ran. Mention that you queued it.",
            });
            continue;
          }

          const { result, mutation } = await runTool(name, args, data, {
            route,
            subagentUsed,
            markSubagent: () => {
              subagentUsed = true;
            },
          });
          if (mutation) mutations.push(mutation);
          traces.push({
            kind: name === "spawn_subagent" ? "subagent" : "tool",
            title: name,
            detail: result.slice(0, 280),
            status: "ok",
          });
          if (name === "write_memory" || name === "update_user") {
            traces.push({
              kind: "memory",
              title: "Memory synced",
              status: "ok",
            });
          }
          if (name === "create_skill" || name === "patch_skill" || name === "install_skill") {
            traces.push({
              kind: "skill",
              title:
                name === "create_skill"
                  ? "Skill created from experience"
                  : name === "install_skill"
                    ? "Skill installed from hub"
                    : "Skill patched",
              detail: str(args.name) || str(args.slug),
              status: "ok",
            });
          }
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result.slice(0, 4000),
          });
        }
      }

      if (!finalText) {
        const last = await callBrain(route, messages, false, 600);
        finalText = last.content.trim();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Model call failed";
      return { ok: false, error: message, keyPatch: route.rotated };
    }

    if (!finalText) {
      finalText = mutations.length
        ? "Done. I applied workspace changes — check the inspector."
        : "I had nothing to add.";
    }

    return {
      ok: true,
      text: finalText,
      mutations,
      traces,
      pendingApproval,
      keyPatch: route.rotated,
    };
}

export const runHelixTurn = createServerFn({ method: "POST" })
  .validator((input: HelixTurnInput) => input)
  .handler(async ({ data }): Promise<HelixTurnResult> => executeTurn(data));

async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  input: HelixTurnInput,
  ctx: { route: BrainRoute; subagentUsed: boolean; markSubagent: () => void },
): Promise<{ result: string; mutation?: Mutation }> {
  switch (name) {
    case "write_memory": {
      const text = str(args.text).slice(0, 500);
      const kind = (str(args.kind, "fact") as MemoryKind) || "fact";
      const mode = str(args.mode, "append") === "replace" ? "replace" : "append";
      if (!text) return { result: "Empty memory not written." };
      return {
        result: `Wrote ${kind} to memory.`,
        mutation: { type: "write_memory", text, kind, mode },
      };
    }
    case "update_user": {
      const content = str(args.content).slice(0, 2500);
      if (!content) return { result: "USER.md unchanged." };
      return {
        result: "USER.md updated.",
        mutation: { type: "update_user", content },
      };
    }
    case "create_skill": {
      const skillName = str(args.name)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      if (!skillName) return { result: "Skill needs a name." };
      const triggers = Array.isArray(args.triggers)
        ? args.triggers.filter((t): t is string => typeof t === "string").slice(0, 8)
        : [];
      return {
        result: `Created skill ${skillName}.`,
        mutation: {
          type: "create_skill",
          name: skillName,
          description: str(args.description).slice(0, 240),
          instructions: str(args.instructions).slice(0, 4000),
          triggers,
        },
      };
    }
    case "patch_skill": {
      const skillName = str(args.name);
      const found = input.skills.some((s) => s.name === skillName);
      if (!found) return { result: `No skill named ${skillName}.` };
      return {
        result: `Patched ${skillName}.`,
        mutation: {
          type: "patch_skill",
          name: skillName,
          instructions: str(args.instructions).slice(0, 4000),
          reason: str(args.reason).slice(0, 400),
        },
      };
    }
    case "search_memory": {
      const query = str(args.query);
      return { result: searchWorkspace(input, query) };
    }
    case "read_workspace": {
      return { result: readFile(input, str(args.file)) };
    }
    case "list_skills": {
      const lines = input.skills.map(
        (s) => `${s.name} · ${s.status} · ${s.uses} uses — ${s.description}`,
      );
      return { result: lines.join("\n") || "No skills." };
    }
    case "canvas_render": {
      const kindRaw = str(args.kind, "markdown");
      const kind =
        kindRaw === "stats" || kindRaw === "diagram" || kindRaw === "timeline"
          ? kindRaw
          : "markdown";
      const stats = Array.isArray(args.stats)
        ? args.stats
            .map((s) => {
              if (!s || typeof s !== "object") return null;
              const o = s as { label?: unknown; value?: unknown };
              if (typeof o.label !== "string" || typeof o.value !== "string") return null;
              return { label: o.label, value: o.value };
            })
            .filter((s): s is { label: string; value: string } => Boolean(s))
            .slice(0, 8)
        : undefined;
      const nodes = Array.isArray(args.nodes)
        ? args.nodes
            .map((n) => {
              if (!n || typeof n !== "object") return null;
              const o = n as { id?: unknown; label?: unknown };
              if (typeof o.id !== "string" || typeof o.label !== "string") return null;
              return { id: o.id, label: o.label };
            })
            .filter((n): n is { id: string; label: string } => Boolean(n))
            .slice(0, 10)
        : undefined;
      const edges = Array.isArray(args.edges)
        ? args.edges
            .map((e) => {
              if (!e || typeof e !== "object") return null;
              const o = e as { from?: unknown; to?: unknown };
              if (typeof o.from !== "string" || typeof o.to !== "string") return null;
              return { from: o.from, to: o.to };
            })
            .filter((e): e is { from: string; to: string } => Boolean(e))
            .slice(0, 12)
        : undefined;
      return {
        result: `Canvas card “${str(args.title)}” rendered.`,
        mutation: {
          type: "canvas",
          card: {
            kind,
            title: str(args.title, "Canvas").slice(0, 80),
            body: str(args.body).slice(0, 4000),
            stats,
            nodes,
            edges,
          },
        },
      };
    }
    case "spawn_subagent": {
      if (ctx.subagentUsed) return { result: "Only one subagent per turn." };
      ctx.markSubagent();
      const role = str(args.role, "specialist").slice(0, 80);
      const task = str(args.task).slice(0, 1200);
      try {
        const nested = await callBrain(
          ctx.route,
          [
            {
              role: "system",
              content: `You are an isolated Paddy subagent (${role}). Do the task in under 180 words. No tools. No fluff.`,
            },
            { role: "user", content: task },
          ],
          false,
          SUBAGENT_TOKENS,
        );
        return { result: `Subagent (${role}):\n${nested.content.trim()}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : "subagent failed";
        return { result: `Subagent failed: ${message}` };
      }
    }
    case "checkpoint": {
      return {
        result: `Checkpoint “${str(args.label, "manual")}” queued.`,
        mutation: { type: "checkpoint", label: str(args.label, "manual").slice(0, 80) },
      };
    }
    case "schedule_wake": {
      return {
        result: `Wake gated for ${num(args.delayMinutes, 30)}m.`,
        mutation: {
          type: "schedule_wake",
          delayMinutes: Math.min(24 * 60, Math.max(1, num(args.delayMinutes, 30))),
          reason: str(args.reason).slice(0, 160),
          note: str(args.note).slice(0, 800),
        },
      };
    }
    case "send_channel": {
      return {
        result: `Queued outbound on ${str(args.channelId)}.`,
        mutation: {
          type: "send_channel",
          channelId: str(args.channelId, "web"),
          message: str(args.message).slice(0, 1500),
        },
      };
    }
    case "hub_search": {
      const hits = searchHub(str(args.query), 6);
      if (!hits.length) return { result: `No hub skills matched “${str(args.query)}”.` };
      return {
        result: hits
          .map(
            (s) =>
              `${s.slug} · ${s.trust}/${s.registry} · ${s.installs} installs\n  ${s.description}`,
          )
          .join("\n"),
      };
    }
    case "install_skill": {
      const found = getHubSkill(str(args.slug));
      if (!found) {
        return {
          result: `Unknown slug “${str(args.slug)}”. Call hub_search first.`,
        };
      }
      const already = input.skills.some((s) => s.name === found.name);
      if (already) return { result: `${found.name} is already installed.` };
      return {
        result: `Installed ${found.slug} (${found.trust}). Available immediately.`,
        mutation: {
          type: "install_hub",
          name: found.name,
          description: found.description,
          instructions: found.instructions,
          triggers: found.triggers,
          slug: found.slug,
          registry: found.registry,
          version: found.version,
        },
      };
    }
    default:
      return { result: `Unknown tool ${name}` };
  }
}

export const helixRuntime = createServerFn({ method: "GET" }).handler(async () => {
  const env = envPresence();
  return {
    superGrok: env.xai,
    model: "grok-4.5",
    env,
  };
});

export const probeBrain = createServerFn({ method: "POST" })
  .validator((input: { preferredProvider: string; keys?: Record<string, string | undefined> }) => input)
  .handler(async ({ data }): Promise<{ ok: true; detail: string } | { ok: false; error: string }> => {
    const resolved = resolveBrain(
      (data.preferredProvider as ProviderId) || "supergrok",
      sanitizeKeys(data.keys),
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    try {
      const ping = await callBrain(
        resolved.route,
        [{ role: "user", content: "Reply with the single word: pong" }],
        false,
        16,
      );
      const snippet = (ping.content || "").trim().slice(0, 80) || "(empty)";
      return {
        ok: true,
        detail: `${resolved.route.label} · ${resolved.route.model} · ${snippet}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Probe failed" };
    }
  });

export const runSubagent = createServerFn({ method: "POST" })
  .validator(
    (input: {
      role: string;
      task: string;
      preferredProvider?: string;
      keys?: Record<string, string | undefined>;
    }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const resolved = resolveBrain(
      (data.preferredProvider as ProviderId) || "supergrok",
      sanitizeKeys(data.keys),
    );
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const role = data.role.slice(0, 80) || "specialist";
    const task = data.task.slice(0, 1200);
    try {
      const nested = await callBrain(
        resolved.route,
        [
          {
            role: "system",
            content: `You are an isolated Paddy subagent (${role}). Do the task in under 180 words. No tools. No fluff.`,
          },
          { role: "user", content: task },
        ],
        false,
        SUBAGENT_TOKENS,
      );
      return { ok: true, text: `Subagent (${role}):\n${nested.content.trim()}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : "subagent failed";
      return { ok: false, error: message };
    }
  });

export const startCodexAuth = createServerFn({ method: "POST" }).handler(
  async (): Promise<
    | { ok: true; sessionId: string; userCode: string; verificationUrl: string; expiresIn: number }
    | { ok: false; error: string }
  > => {
    try {
      const started = await startCodexDevice();
      return { ok: true, ...started };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not start ChatGPT sign-in",
      };
    }
  },
);

export const pollCodexAuth = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; status: "pending" }
      | {
          ok: true;
          status: "ready";
          tokens: { access: string; refresh: string; expires: number; accountId?: string };
        }
      | { ok: true; status: "expired" }
      | { ok: false; error: string }
    > => {
      try {
        const result = await pollCodexDevice(data.sessionId.slice(0, 80));
        if (result.status === "ready") {
          return { ok: true, status: "ready", tokens: result.tokens };
        }
        return { ok: true, status: result.status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "ChatGPT pairing failed",
        };
      }
    },
  );

export const startXaiAuth = createServerFn({ method: "POST" }).handler(
  async (): Promise<
    | { ok: true; sessionId: string; userCode: string; verificationUrl: string; expiresIn: number }
    | { ok: false; error: string }
  > => {
    try {
      const started = await startXaiDevice();
      return { ok: true, ...started };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not start SuperGrok sign-in",
      };
    }
  },
);

export const pollXaiAuth = createServerFn({ method: "POST" })
  .validator((input: { sessionId: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; status: "pending" }
      | { ok: true; status: "ready"; tokens: { access: string; refresh: string; expires: number } }
      | { ok: true; status: "expired" }
      | { ok: false; error: string }
    > => {
      try {
        const result = await pollXaiDevice(data.sessionId.slice(0, 80));
        if (result.status === "ready") {
          return { ok: true, status: "ready", tokens: result.tokens };
        }
        return { ok: true, status: result.status };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "SuperGrok pairing failed",
        };
      }
    },
  );
