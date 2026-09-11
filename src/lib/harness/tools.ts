import type { ToolName } from "./types";

export const TOOL_CATALOG: {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
}[] = [
  {
    name: "write_memory",
    description:
      "Persist a durable fact, preference, or lesson to MEMORY.md. Use after learning something that should survive this session.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "One or two sentences. No secrets." },
        kind: {
          type: "string",
          enum: ["fact", "preference", "lesson", "episode"],
        },
        mode: { type: "string", enum: ["append", "replace"], default: "append" },
      },
      required: ["text", "kind"],
    },
  },
  {
    name: "update_user",
    description: "Rewrite USER.md with a small, accurate model of the operator.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Full Markdown for USER.md." },
      },
      required: ["content"],
    },
  },
  {
    name: "create_skill",
    description:
      "Create a new SKILL.md from experience. Call after a non-trivial workflow that will recur.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "kebab-case id" },
        description: { type: "string" },
        instructions: { type: "string", description: "Imperative procedure." },
        triggers: {
          type: "array",
          items: { type: "string" },
          description: "Phrases that should fire this skill.",
        },
      },
      required: ["name", "description", "instructions"],
    },
  },
  {
    name: "patch_skill",
    description: "Improve an existing skill when it was wrong or incomplete.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        instructions: { type: "string" },
        reason: { type: "string" },
      },
      required: ["name", "instructions", "reason"],
    },
  },
  {
    name: "skill_manage",
    description:
      "Create, patch, or archive a skill. Prefer this when retiring a bad procedure. create_skill / patch_skill still work.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "patch", "archive"] },
        name: { type: "string", description: "kebab-case id" },
        description: { type: "string" },
        instructions: { type: "string" },
        triggers: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["action", "name"],
    },
  },
  {
    name: "search_memory",
    description:
      "Substring search over MEMORY.md, identity files, skills, and this profile’s recent transcript.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_workspace",
    description: "Read an identity file or a skill by name.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "soul | identity | user | memory | agents | heartbeat | or a skill name",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "list_skills",
    description: "List skills with status and use counts.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "use_skill",
    description:
      "Load a installed skill’s full playbook by name and follow it this turn. Call this when a capability matches, before improvising.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name or kebab-case id." },
      },
      required: ["name"],
    },
  },
  {
    name: "canvas_render",
    description: "Paint structured output on the live canvas (OpenClaw presence).",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["markdown", "stats", "diagram", "timeline"] },
        title: { type: "string" },
        body: { type: "string" },
        stats: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
          },
        },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, label: { type: "string" } },
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            properties: { from: { type: "string" }, to: { type: "string" } },
          },
        },
      },
      required: ["kind", "title"],
    },
  },
  {
    name: "spawn_subagent",
    description:
      "Delegate a bounded nested completion. Requires approval. One per turn. Inherits the parent turn's auto-approved tools except send_channel and spawn_subagent.",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string" },
        task: { type: "string" },
      },
      required: ["role", "task"],
    },
  },
  {
    name: "checkpoint",
    description: "Snapshot the workspace so it can be rolled back.",
    parameters: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    },
  },
  {
    name: "schedule_wake",
    description: "Queue a gated wake. The model will not run until the operator admits it.",
    parameters: {
      type: "object",
      properties: {
        delayMinutes: { type: "number" },
        reason: { type: "string" },
        note: { type: "string" },
      },
      required: ["delayMinutes", "reason", "note"],
    },
  },
  {
    name: "send_channel",
    description:
      "Queue an outbound on a live gateway channel (telegram, slack, discord, whatsapp, signal, email). Requires approval. The bridge delivers it once a chat is connected.",
    parameters: {
      type: "object",
      properties: {
        channelId: {
          type: "string",
          description: "web | telegram | slack | discord | whatsapp | signal | email",
        },
        message: { type: "string" },
      },
      required: ["channelId", "message"],
    },
  },
  {
    name: "hub_search",
    description:
      "Search the local Paddy catalog (inspired by ClawHub and Hermes, not their live registries). Use before install_skill.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "install_skill",
    description:
      "Copy a hub skill from the local catalog into this workspace by slug or name (e.g. meeting-actions). Instantly live. Not a live ClawHub download.",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Hub slug or kebab-case name." },
      },
      required: ["slug"],
    },
  },
  {
    name: "create_ticket",
    description:
      "Create a ticket on this mind’s kanban. Use for work to track — not for chat replies.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string", description: "Short description. Optional." },
        status: { type: "string", enum: ["backlog", "doing", "done"], default: "backlog" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_ticket",
    description: "Move or edit a ticket by id (from the board in context).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        status: { type: "string", enum: ["backlog", "doing", "done"] },
      },
      required: ["id"],
    },
  },
  {
    name: "write_daily",
    description:
      "Append a line to today’s daily note (OpenClaw-style YYYY-MM-DD log). Short. No secrets.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "One or two sentences for today." },
      },
      required: ["content"],
    },
  },
  {
    name: "update_heartbeat",
    description:
      "Rewrite HEARTBEAT.md standing watch. Keep it short. Silence is valid. HEARTBEAT_OK when nothing is due.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Full Markdown for HEARTBEAT.md." },
      },
      required: ["content"],
    },
  },
];

export function openaiTools(
  extra: { name: string; description: string; parameters: Record<string, unknown> }[] = [],
) {
  return [...TOOL_CATALOG, ...extra].map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
