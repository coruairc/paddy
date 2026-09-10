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
    name: "search_memory",
    description:
      "Full-text search over MEMORY.md, identity files, skills, and this profile’s recent transcript.",
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
          description: "soul | identity | user | memory | agents | or a skill name",
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
      "Delegate a bounded subtask to an isolated child mind. Requires approval. One per turn.",
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
    description: "Send an outbound message on a gateway channel. Requires approval.",
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
      "Download a hub skill into this workspace by slug or name (e.g. clawhub/google-calendar).",
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Hub slug or kebab-case name." },
      },
      required: ["slug"],
    },
  },
];

export function openaiTools() {
  return TOOL_CATALOG.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
