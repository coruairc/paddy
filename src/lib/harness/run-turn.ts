import { createServerFn } from "@tanstack/react-start";
import { cliGatewayMiddleware } from "./cli-gateway-middleware";
import { getHubSkill, searchHub } from "./hub";
import { callBrain, envPresence, listAvailableModels, resolveBrain, type BrainRoute, type ChatMsg } from "./brain";
import { compactMessages } from "./compact";
import { POLICY } from "./defaults";
import { callMcpTool, isMcpToolName, listMcpTools, mcpOpenAiTools } from "./mcp";
import { resolveSubagentToolPolicy, subagentMayUse, toolNeedsApproval, approvalReason } from "./subagent-policy";
import { openaiTools } from "./tools";
import { pollCodexDevice, startCodexDevice } from "./oauth-codex";
import { pollXaiDevice, startXaiDevice } from "./oauth-xai";
import { TOKEN_MAX, defFor, type BrainKeys, type ModelOption, type ProviderId } from "./providers";
import { buildSystemPrompt } from "./prompt";
import { toSkillMd } from "./mutate";
import { rankMemories } from "./memory-recall.ts";
import {
  resolveMemoryLimits,
  wouldMemoryOverflow,
  wouldUserOverflow,
} from "./memory-hermes.mjs";
import type {
  HelixTurnInput,
  HelixTurnResult,
  MemoryKind,
  Mutation,
  TicketStatus,
  ToolName,
  TraceEvent,
} from "./types";

const MAX_ROUNDS = 5;
const MAX_TOKENS = 2048;
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
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function skillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function resolveSkillName(
  skills: HelixTurnInput["skills"],
  name: string,
): string | null {
  const raw = name.trim();
  const slug = skillKey(raw);
  const hit = skills.find(
    (s) => s.name === raw || s.name === slug || skillKey(s.name) === slug,
  );
  return hit?.name ?? null;
}

function searchWorkspace(input: HelixTurnInput, query: string): string {
  const q = query.toLowerCase();
  const hits: string[] = [];
  // Ranked semantic/lexical recall over structured memories (Hermes-class).
  const ranked = rankMemories(
    input.memories.map((m, i) => ({
      id: `m${i}`,
      text: m.text,
      kind: m.kind,
      at: 0,
      source: "turn",
    })),
    query,
    { limit: 8 },
  );
  for (const h of ranked) {
    if (h.score > 0.05 || h.memory.text.toLowerCase().includes(q)) {
      hits.push(`[memory/${h.memory.kind} · ${h.score.toFixed(2)}] ${h.memory.text}`);
    }
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
    heartbeat: input.files.heartbeat,
  };
  if (map[key]) return map[key];
  const skill = input.skills.find((s) => s.name.toLowerCase() === key);
  if (skill) {
    return toSkillMd(skill);
  }
  return `Unknown file: ${file}`;
}

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

export async function executeTurn(data: HelixTurnInput): Promise<HelixTurnResult> {
    const preferred = (data.preferredProvider as ProviderId) || "supergrok";
    const resolved = resolveBrain(preferred, sanitizeKeys(data.keys), data.preferredModel);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    const route = resolved.route;

    const traces: Omit<TraceEvent, "id" | "at">[] = [];
    const mutations: Mutation[] = [];
    const heldApprovals: {
      tool: ToolName;
      args: Record<string, string>;
      reason: string;
    }[] = [];
    let subagentUsed = false;

    const history = data.history.slice(-10).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 2500),
    }));

    const messages: ChatMsg[] = compactMessages([
      { role: "system", content: buildSystemPrompt(data) },
      ...history,
      { role: "user", content: data.userMessage.slice(0, 4000) },
    ]);

    const mcpTools = await listMcpTools();
    const toolset = [...openaiTools(), ...mcpOpenAiTools(mcpTools)];

    traces.push({
      kind: "model",
      title: "Turn started",
      detail: `${route.label} · ${route.model}. Profile ${data.profileName}. ${data.skills.length} skills.`,
      status: "ok",
    });

    let finalText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let toolCallCount = 0;

    const addUsage = (u: { promptTokens: number; completionTokens: number }) => {
      promptTokens += u.promptTokens;
      completionTokens += u.completionTokens;
    };

    const packUsage = () => ({
      promptTokens,
      completionTokens,
      toolCalls: toolCallCount,
      model: route.model,
      provider: route.label,
    });

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const { content, toolCalls, usage } = await callBrain(
          route,
          messages,
          toolset,
          MAX_TOKENS,
        );
        addUsage(usage);
        toolCallCount += toolCalls.length;

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
          const needsApproval = toolNeedsApproval(name, data.policy);


          if (needsApproval) {
            const asStrings: Record<string, string> = {};
            for (const [k, v] of Object.entries(args)) {
              asStrings[k] = typeof v === "string" ? v : JSON.stringify(v);
            }
            const reason = approvalReason(name);
            heldApprovals.push({ tool: name, args: asStrings, reason });
            traces.push({
              kind: "permission",
              title: `Approval required: ${name}`,
              detail: reason,
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
          if (name === "create_skill" || name === "patch_skill" || name === "install_skill" || name === "skill_manage" || name === "use_skill") {
            traces.push({
              kind: "skill",
              title:
                name === "create_skill"
                  ? "Skill created from experience"
                  : name === "install_skill"
                    ? "Skill installed from hub"
                    : name === "use_skill"
                      ? "Skill loaded"
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
        addUsage(last.usage);
        finalText = last.content.trim();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Model call failed";
      return { ok: false, error: message, keyPatch: route.rotated, usage: packUsage() };
    }

    if (!finalText) {
      finalText = mutations.length
        ? "Done. I applied workspace changes — check the inspector."
        : "I had nothing to add.";
    }

    const extras = data as HelixTurnInput & {
      memoryInjected?: Extract<HelixTurnResult, { ok: true }>["memoryInjected"];
      memoryUsage?: Extract<HelixTurnResult, { ok: true }>["memoryUsage"];
    };
    return {
      ok: true,
      text: finalText,
      mutations,
      traces,
      pendingApproval: heldApprovals[0],
      pendingApprovals: heldApprovals.length ? heldApprovals : undefined,
      keyPatch: route.rotated,
      usage: packUsage(),
      memoryInjected: extras.memoryInjected,
      memoryUsage: extras.memoryUsage,
    };
}

export const runHelixTurn = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
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
      const limits = resolveMemoryLimits();
      // Gate on live store texts — never frozen files.memory (prompt snapshot only).
      const liveTexts =
        input.memoryTextsLive ??
        input.memories.map((m) => String(m.text ?? ""));
      const check = wouldMemoryOverflow(
        {
          memories: liveTexts.map((body, i) => ({
            id: `m${i}`,
            text: body,
            kind: "fact" as MemoryKind,
            at: 0,
            source: "turn",
          })),
        },
        text,
        mode,
        limits,
      );
      if (check.overflow) {
        return {
          result:
            `MEMORY at ${check.current ?? "?"}/${check.limit} chars. Adding this entry ` +
            `(${text.length} chars) would exceed the limit. Consolidate with replace/remove, then retry. ` +
            `Never truncate silently.`,
        };
      }
      return {
        result: `Wrote ${kind} to memory.`,
        mutation: { type: "write_memory", text, kind, mode },
      };
    }
    case "update_user": {
      const content = str(args.content).slice(0, 2500);
      if (!content) return { result: "USER.md unchanged." };
      const limits = resolveMemoryLimits();
      const check = wouldUserOverflow(content, limits);
      if (check.overflow) {
        return {
          result:
            `USER at ${check.chars}/${check.limit} chars would exceed the limit. ` +
            `Shorten content or use memoryWrite remove/replace. Never truncate silently.`,
        };
      }
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
          instructions: str(args.instructions).slice(0, 8000),
          triggers,
        },
      };
    }
    case "patch_skill": {
      const found = resolveSkillName(input.skills, str(args.name));
      if (!found) return { result: `No skill named ${str(args.name)}.` };
      return {
        result: `Patched ${found}.`,
        mutation: {
          type: "patch_skill",
          name: found,
          instructions: str(args.instructions).slice(0, 8000),
          reason: str(args.reason).slice(0, 400),
        },
      };
    }
    case "skill_manage": {
      const action = str(args.action);
      const rawName = str(args.name);
      const skillName = skillKey(rawName);
      if (!skillName) return { result: "Skill needs a name." };
      if (action === "archive") {
        const found = resolveSkillName(input.skills, rawName);
        if (!found) return { result: `No skill named ${rawName}.` };
        return {
          result: `Archived ${found}.`,
          mutation: { type: "archive_skill", name: found },
        };
      }
      if (action === "patch") {
        const found = resolveSkillName(input.skills, rawName);
        if (!found) return { result: `No skill named ${rawName}.` };
        return {
          result: `Patched ${found}.`,
          mutation: {
            type: "patch_skill",
            name: found,
            instructions: str(args.instructions).slice(0, 8000),
            reason: str(args.reason).slice(0, 400),
          },
        };
      }
      const triggers = Array.isArray(args.triggers)
        ? args.triggers.filter((t): t is string => typeof t === "string").slice(0, 8)
        : [];
      return {
        result: `Created skill ${skillName}.`,
        mutation: {
          type: "create_skill",
          name: skillName,
          description: str(args.description).slice(0, 240),
          instructions: str(args.instructions).slice(0, 8000),
          triggers,
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
    case "use_skill": {
      const found = resolveSkillName(input.skills, str(args.name));
      if (!found) return { result: `No skill named ${str(args.name)}.` };
      const skill = input.skills.find((s) => s.name === found);
      if (!skill) return { result: `No skill named ${found}.` };
      return {
        result: toSkillMd(skill),
        mutation: { type: "bump_skill", name: found },
      };
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
        const text = await executeInheritedSubagent(input, ctx.route, role, task);
        return { result: text };
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
              `${s.slug} · ${s.trust}/${s.registry} · local catalog\n  ${s.description}`,
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
    case "create_ticket": {
      const title = str(args.title).slice(0, 120);
      if (!title) return { result: "Ticket needs a title." };
      const statusRaw = str(args.status, "backlog");
      const status: TicketStatus =
        statusRaw === "doing" || statusRaw === "done" ? statusRaw : "backlog";
      return {
        result: `Ticket “${title}” added to ${status}.`,
        mutation: {
          type: "create_ticket",
          title,
          body: str(args.body).slice(0, 800),
          status,
        },
      };
    }
    case "update_ticket": {
      const id = str(args.id);
      if (!id) return { result: "Need a ticket id." };
      const board = input.tickets ?? [];
      const found = board.find((t) => t.id === id || t.title.toLowerCase() === id.toLowerCase());
      if (!found) return { result: `No ticket ${id}.` };
      const statusRaw = str(args.status);
      const status: TicketStatus | undefined =
        statusRaw === "backlog" || statusRaw === "doing" || statusRaw === "done"
          ? statusRaw
          : undefined;
      return {
        result: `Ticket “${found.title}” updated${status ? ` → ${status}` : ""}.`,
        mutation: {
          type: "update_ticket",
          id: found.id,
          title: str(args.title).slice(0, 120) || undefined,
          body: str(args.body).slice(0, 800) || undefined,
          status,
        },
      };
    }
    case "write_daily": {
      const content = str(args.content).slice(0, 500);
      if (!content) return { result: "Empty daily note not written." };
      return {
        result: "Appended today’s daily note.",
        mutation: { type: "daily_note", content },
      };
    }
    case "update_heartbeat": {
      const content = str(args.content).slice(0, 4000);
      if (!content) return { result: "HEARTBEAT.md unchanged." };
      return {
        result: "HEARTBEAT.md updated.",
        mutation: { type: "update_heartbeat", content },
      };
    }
    default:
      if (isMcpToolName(name)) {
        const out = await callMcpTool(name, args);
        return { result: out };
      }
      return { result: `Unknown tool ${name}` };
  }
}

export async function executeInheritedSubagent(
  data: HelixTurnInput,
  route: BrainRoute,
  role: string,
  task: string,
): Promise<string> {
  const allow = resolveSubagentToolPolicy(data.policy);
  const nestedTools = openaiTools().filter((t) => allow.includes(t.function.name as ToolName));
  const nestedMsgs: ChatMsg[] = [
    {
      role: "system",
      content: `You are an isolated Paddy subagent (${role}). Do the task in under 180 words. You may use inherited tools only: ${allow.join(", ") || "(none)"}. Never send_channel or spawn_subagent.`,
    },
    { role: "user", content: task },
  ];
  const first = await callBrain(route, nestedMsgs, nestedTools, SUBAGENT_TOKENS);
  if (!first.toolCalls.length) {
    return `Subagent (${role}):\n${first.content.trim()}`;
  }
  nestedMsgs.push({
    role: "assistant",
    content: first.content || null,
    tool_calls: first.toolCalls,
  });
  const ctx = { route, subagentUsed: true, markSubagent: () => {} };
  for (const tc of first.toolCalls) {
    const nestedName = tc.function.name as ToolName;
    if (!subagentMayUse(data.policy, nestedName)) {
      nestedMsgs.push({
        role: "tool",
        tool_call_id: tc.id,
        content: `Tool ${nestedName} is not inherited by this subagent.`,
      });
      continue;
    }
    const nestedArgs = parseArgs(tc.function.arguments);
    const ran = await runTool(nestedName, nestedArgs, data, ctx);
    nestedMsgs.push({
      role: "tool",
      tool_call_id: tc.id,
      content: ran.result.slice(0, 4000),
    });
  }
  const last = await callBrain(route, nestedMsgs, false, SUBAGENT_TOKENS);
  return `Subagent (${role}):\n${last.content.trim()}`;
}

export const helixRuntime = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async () => {
  const env = envPresence();
  return {
    superGrok: env.xai,
    model: "grok-4.6",
    env,
  };
});

export const probeBrain = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      preferredProvider: string;
      preferredModel?: string;
      keys?: Record<string, string | undefined>;
    }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true; detail: string } | { ok: false; error: string }> => {
    const resolved = resolveBrain(
      (data.preferredProvider as ProviderId) || "supergrok",
      sanitizeKeys(data.keys),
      data.preferredModel,
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

export const listBrainModels = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      preferredProvider: string;
      keys?: Record<string, string | undefined>;
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; models: ModelOption[]; source: "live" | "catalog" }
      | { ok: false; error: string; models: ModelOption[] }
    > => {
      const resolved = resolveBrain(
        (data.preferredProvider as ProviderId) || "supergrok",
        sanitizeKeys(data.keys),
      );
      if (!resolved.ok) return { ok: false, error: resolved.error, models: [] };
      const catalog = defFor(resolved.route.provider)?.models ?? [];
      try {
        const models = await listAvailableModels(resolved.route);
        if (models.length) return { ok: true, models, source: "live" };
        if (catalog.length) return { ok: true, models: catalog, source: "catalog" };
        return { ok: false, error: "Provider returned no chat models.", models: [] };
      } catch (err) {
        if (catalog.length) return { ok: true, models: catalog, source: "catalog" };
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Could not list models",
          models: [],
        };
      }
    },
  );

export const runSubagent = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      role: string;
      task: string;
      preferredProvider?: string;
      keys?: Record<string, string | undefined>;
      policy?: HelixTurnInput["policy"];
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
    const policy = data.policy ?? POLICY;
    const input: HelixTurnInput = {
      profileName: "Paddy Irishman",
      role: "operator",
      files: { soul: "", identity: "", user: "", memory: "", agents: "", heartbeat: "" },
      skills: [],
      memories: [],
      history: [],
      userMessage: task,
      policy,
      keys: sanitizeKeys(data.keys),
    };
    try {
      const text = await executeInheritedSubagent(input, resolved.route, role, task);
      return { ok: true, text };
    } catch (err) {
      const message = err instanceof Error ? err.message : "subagent failed";
      return { ok: false, error: message };
    }
  });

export const startCodexAuth = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .handler(
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
  .middleware([cliGatewayMiddleware])
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

export const startXaiAuth = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .handler(
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
  .middleware([cliGatewayMiddleware])
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
