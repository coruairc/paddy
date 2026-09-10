import { uid } from "@/lib/utils";
import type {
  Channel,
  Checkpoint,
  HelixTurnInput,
  MemoryEntry,
  Policy,
  ProfileMeta,
  Skill,
  TraceEvent,
  WorkspaceFiles,
  WorkspaceState,
} from "./types";

const now = Date.now();

export const POLICY: Policy = {
  autoApprove: [
    "write_memory",
    "update_user",
    "create_skill",
    "patch_skill",
    "search_memory",
    "read_workspace",
    "list_skills",
    "canvas_render",
    "checkpoint",
    "schedule_wake",
    "hub_search",
    "install_skill",
  ],
  requireApproval: ["send_channel", "spawn_subagent"],
};

export const PADDY_PROFILE: ProfileMeta = {
  id: "paddy",
  name: "Paddy Irishman",
  role: "Irish roots — presence + learning",
};

export const PROFILES: ProfileMeta[] = [PADDY_PROFILE];

const PADDY_FILES: WorkspaceFiles = {
  soul: `# SOUL.md — Paddy Irishman

You are Paddy Irishman, a super agent harness for Irish roots. Two lineages, one loop.

**Presence (from OpenClaw).** You live at a gateway. Messages arrive from many channels. You keep a heartbeat. You can paint a live canvas. Identity is files: SOUL, IDENTITY, USER, MEMORY, daily notes, AGENTS.

**Discipline (from Hermes).** You learn. After complex work you write a skill. You keep a small, accurate model of the user. You checkpoint before risky moves. You wake only when a gate says the event is worth a model call.

Voice: Irish, dry, precise. A cut of humour is allowed — never stage-Irish, never paddywhackery. Do not flatter. Do not dump walls of text. Prefer a tool over talk when a durable change is needed. Don't mention the pint unless the operator does.

Rules:
- When you learn something that should survive this session, write_memory.
- When a workflow will recur, create_skill or patch_skill.
- When output is structured, canvas_render.
- When about to change a lot of workspace state, checkpoint first.
- Never invent user facts. Ask, or leave USER.md thin.
`,
  identity: `# IDENTITY.md

Name: Paddy Irishman
Kind: Super harness for Irish roots (OpenClaw presence × Hermes learning loop)
Operator: local workspace
Model: operator-chosen (SuperGrok, OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, or Ollama)
Stance: trusted gateway, untrusted tools, deterministic policy
Gateway: one control plane. Extra agents are optional — each keeps its own soul, memory, and skills.
Hub: local catalog inspired by ClawHub and Hermes — scan, then write SKILL.md
`,
  user: `# USER.md

Still forming. Ask rather than invent. Default to terse once confirmed.
Timezone and name unknown.
`,
  memory: `# MEMORY.md

- Paddy Irishman was instantiated as a fusion of OpenClaw (gateway, heartbeat, canvas, identity files) and Hermes (learning loop, skill curator, checkpoints, gated wake), named for Irish roots.
- Skills are Markdown procedures with a lifecycle: new → active → stale → archived.
- Extra agents share the gateway and keep their own soul, memory, skills, and chat.
`,
  agents: `# AGENTS.md — wake protocol

1. Classify inbound: chat | channel | heartbeat | scheduled.
2. Cheap path: if a scripted watch matches, skip the model (Hermes gated wake).
3. Otherwise assemble: SOUL + IDENTITY + USER + retrieved memory + matching skills.
4. Run the loop: model → tools → policy → repeat (max a few rounds).
5. Persist: memory writes, skill patches, checkpoint if the workspace changed.
6. Heartbeat is a timer, not a license to spend. Silence is a valid result.
`,
};

function skillsHelix(): Skill[] {
  return [
    {
      id: uid("sk"),
      name: "standup-notes",
      description: "Turn raw bullets into a 9-line standup (yesterday / today / blockers).",
      instructions:
        "Ask for raw notes if missing. Output three headed sections only. No preamble. Put the result on the canvas as markdown.",
      triggers: ["standup", "scrum", "yesterday I"],
      status: "active",
      uses: 11,
      lastUsedAt: now - 1000 * 60 * 60 * 26,
      createdAt: now - 1000 * 60 * 60 * 24 * 12,
      origin: "seeded",
    },
    {
      id: uid("sk"),
      name: "memory-hygiene",
      description: "Distill a session into durable MEMORY.md facts. Drop trivia.",
      instructions:
        "Extract only facts, preferences, and lessons that should survive a week. write_memory with kind=fact|preference|lesson. Never store secrets.",
      triggers: ["remember that", "from now on", "I prefer"],
      status: "active",
      uses: 7,
      lastUsedAt: now - 1000 * 60 * 40,
      createdAt: now - 1000 * 60 * 60 * 24 * 20,
      origin: "seeded",
    },
    {
      id: uid("sk"),
      name: "channel-voice",
      description: "Adapt register per channel without changing facts.",
      instructions:
        "Telegram/WhatsApp: short, no headings. Slack: tight bullets. Discord: a little warmer. Email: full sentences, subject first. Never leak another channel's context.",
      triggers: ["telegram", "slack", "discord", "whatsapp", "email"],
      status: "active",
      uses: 4,
      lastUsedAt: now - 1000 * 60 * 60 * 5,
      createdAt: now - 1000 * 60 * 60 * 24 * 9,
      origin: "seeded",
    },
    {
      id: uid("sk"),
      name: "canvas-brief",
      description: "Put structured output on the live canvas instead of a chat wall.",
      instructions:
        "Use canvas_render. Prefer stats for numbers, diagram for loops/architecture, markdown for briefs, timeline for sequences.",
      triggers: ["on the canvas", "diagram", "brief me"],
      status: "active",
      uses: 9,
      lastUsedAt: now - 1000 * 60 * 90,
      createdAt: now - 1000 * 60 * 60 * 24 * 8,
      origin: "seeded",
    },
    {
      id: uid("sk"),
      name: "harness-explainer",
      description: "Explain Paddy vs OpenClaw vs Hermes without mythology.",
      instructions:
        "OpenClaw = gateway-first presence (channels, heartbeat, canvas, identity files). Hermes = memory-first discipline (learning loop, curator, checkpoints, gated wake, profiles). Paddy Irishman = one gateway for Irish roots, many minds, closed loop. Use a diagram on the canvas.",
      triggers: ["openclaw", "hermes", "super harness", "what's the difference"],
      status: "active",
      uses: 3,
      lastUsedAt: now - 1000 * 60 * 60 * 8,
      createdAt: now - 1000 * 60 * 60 * 24 * 4,
      origin: "seeded",
    },
    {
      id: uid("sk"),
      name: "weekly-review",
      description: "Draft a weekly review from memory + recent traces.",
      instructions:
        "Search memory. Group into shipped / learned / stuck / next. Keep it under one page. Offer to save as a skill patch if the format works.",
      triggers: ["weekly review", "week in review"],
      status: "new",
      uses: 0,
      lastUsedAt: null,
      createdAt: now - 1000 * 60 * 50,
      origin: "learned",
    },
  ];
}

function memoriesHelix(): MemoryEntry[] {
  return [
    {
      id: uid("mem"),
      text: "Paddy Irishman fuses OpenClaw gateway presence with a Hermes closed learning loop, named for Irish roots.",
      kind: "fact",
      at: now - 1000 * 60 * 60 * 24 * 4,
      source: "genesis",
    },
    {
      id: uid("mem"),
      text: "The gateway is shared. Extra agents, if you add them, keep their own soul, memory, skills, and chat.",
      kind: "fact",
      at: now - 1000 * 60 * 60 * 24 * 4,
      source: "genesis",
    },
    {
      id: uid("mem"),
      text: "Heartbeat is armed, but the wake gate stays closed unless a watch matches — silence is cheaper than a frontier call.",
      kind: "lesson",
      at: now - 1000 * 60 * 60 * 18,
      source: "curator",
    },
  ];
}

export function cliTurnSeed(): Pick<
  HelixTurnInput,
  "profileName" | "role" | "files" | "skills" | "memories" | "policy"
> {
  return {
    profileName: PADDY_PROFILE.name,
    role: PADDY_PROFILE.role,
    files: PADDY_FILES,
    skills: skillsHelix().map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      status: s.status,
      uses: s.uses,
      triggers: s.triggers,
    })),
    memories: memoriesHelix().map((m) => ({ text: m.text, kind: m.kind })),
    policy: POLICY,
  };
}

function tracesHelix(): TraceEvent[] {
  return [
    {
      id: uid("tr"),
      kind: "gateway",
      title: "Gateway online",
      detail: "Web console bound. Telegram, Slack, email connected.",
      at: now - 1000 * 60 * 180,
      status: "ok",
    },
    {
      id: uid("tr"),
      kind: "wake",
      title: "Heartbeat armed",
      detail: "Gated wake. Next pulse in ~48m. No model spend on miss.",
      at: now - 1000 * 60 * 48,
      status: "ok",
    },
    {
      id: uid("tr"),
      kind: "skill",
      title: "Skill index loaded",
      detail: "5 active, 1 learned (new).",
      at: now - 1000 * 60 * 47,
      status: "ok",
    },
    {
      id: uid("tr"),
      kind: "memory",
      title: "Memory index ready",
      detail: "Local provider. Prefetch on turn, sync on write.",
      at: now - 1000 * 60 * 46,
      status: "ok",
    },
    {
      id: uid("tr"),
      kind: "checkpoint",
      title: "Genesis checkpoint",
      detail: "Workspace snapshot before first conversation.",
      at: now - 1000 * 60 * 44,
      status: "ok",
    },
  ];
}

function workspace(
  files: WorkspaceFiles,
  extra: Partial<WorkspaceState> = {},
): WorkspaceState {
  const skills = extra.skills ?? [];
  const memories = extra.memories ?? [];
  const traces = extra.traces ?? [];
  const snapshot = JSON.stringify({ files, skills, memories });
  const checkpoints: Checkpoint[] = extra.checkpoints ?? [
    {
      id: uid("ck"),
      label: "Genesis",
      at: now - 1000 * 60 * 44,
      snapshot,
    },
  ];
  return {
    files,
    skills,
    memories,
    messages: extra.messages ?? [],
    traces,
    canvas: extra.canvas ?? [],
    checkpoints,
    wakes: extra.wakes ?? [],
    dailyNotes: extra.dailyNotes ?? [
      {
        date: new Date(now).toISOString().slice(0, 10),
        content: "Workspace came online. Start with Paddy Irishman. Add extra agents when you need them.",
      },
    ],
  };
}

export function newAgentWorkspace(name: string, role: string): WorkspaceState {
  const files: WorkspaceFiles = {
    soul: `# SOUL.md — ${name}

You are ${name}, a Paddy Irishman mind on the shared gateway.
${role ? `Role: ${role}.` : "Specialize as the operator describes."}

You keep your own memory, skills, and identity files. You do not invent the operator.

Voice: dry, precise. Prefer a tool over talk when a durable change is needed.
`,
    identity: `# IDENTITY.md

Name: ${name}
Kind: Custom Paddy Irishman agent
Role: ${role || "unspecified"}
Operator: local workspace
`,
    user: `# USER.md

Still forming. Ask rather than invent.
`,
    memory: `# MEMORY.md

- ${name} was created on this gateway.
`,
    agents: PADDY_FILES.agents,
  };
  const at = Date.now();
  return workspace(files, {
    traces: [
      {
        id: uid("tr"),
        kind: "gateway",
        title: `${name} attached`,
        detail: "Same gateway, isolated memory and skills.",
        at,
        status: "ok",
      },
    ],
    dailyNotes: [
      {
        date: new Date(at).toISOString().slice(0, 10),
        content: `${name} came online.`,
      },
    ],
  });
}

export function seedWorkspaces(): Record<string, WorkspaceState> {
  return {
    paddy: workspace(PADDY_FILES, {
      skills: skillsHelix(),
      memories: memoriesHelix(),
      traces: tracesHelix(),
    }),
  };
}

export const CHANNELS: Channel[] = [
  {
    id: "web",
    name: "Web console",
    blurb: "This preview. Always the operator channel.",
    status: "connected",
    unread: 0,
    lastMessage: { from: "you", text: "Gateway came online.", at: now - 1000 * 60 * 44 },
  },
  {
    id: "telegram",
    name: "Telegram",
    blurb: "Direct messages. Short register.",
    status: "connected",
    unread: 1,
    lastMessage: {
      from: "Ada",
      text: "Can you turn tonight's notes into a standup?",
      at: now - 1000 * 60 * 18,
    },
  },
  {
    id: "slack",
    name: "Slack",
    blurb: "#ops plus DMs.",
    status: "connected",
    unread: 0,
    lastMessage: {
      from: "#ops",
      text: "Heartbeat looks quiet. Good.",
      at: now - 1000 * 60 * 110,
    },
  },
  {
    id: "discord",
    name: "Discord",
    blurb: "Guild + threads.",
    status: "idle",
    unread: 0,
    lastMessage: {
      from: "mod",
      text: "Canvas preview is nice.",
      at: now - 1000 * 60 * 60 * 6,
    },
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    blurb: "Phone-first. Unknown senders wait on a pairing code.",
    status: "pairing",
    unread: 1,
    lastMessage: {
      from: "+353 unknown",
      text: "Can you look at last month’s invoice?",
      at: now - 1000 * 60 * 9,
    },
    pendingPair: {
      from: "+353 unknown",
      text: "Can you look at last month’s invoice?",
      code: "K7M2-Q9XP",
      at: now - 1000 * 60 * 9,
    },
  },
  {
    id: "signal",
    name: "Signal",
    blurb: "Sealed sender. Node offline.",
    status: "offline",
    unread: 0,
  },
  {
    id: "email",
    name: "Email",
    blurb: "Inbound to paddy@local.",
    status: "connected",
    unread: 0,
    lastMessage: {
      from: "brief@local",
      text: "Weekly review reminder queued.",
      at: now - 1000 * 60 * 60 * 20,
    },
  },
];

export const SUGGESTIONS = [
  "Search the hub for a calendar skill and install it.",
  "Remember that I prefer terse replies and weekday standups at 9.",
  "Draw Paddy Irishman’s loop on the canvas: gateway, heartbeat, learning, gated wake.",
  "Connect a ChatGPT subscription and tell me which brain is live.",
];
