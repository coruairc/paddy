import { uid } from "@/lib/utils";
import type {
  Channel,
  ChatMessage,
  Checkpoint,
  HelixTurnInput,
  MemoryEntry,
  Policy,
  ProfileMeta,
  Session,
  Skill,
  Ticket,
  TraceEvent,
  UsageStats,
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
    "use_skill",
    "canvas_render",
    "checkpoint",
    "schedule_wake",
    "hub_search",
    "install_skill",
    "create_ticket",
    "update_ticket",
    "write_daily",
    "update_heartbeat",
    "skill_manage",
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
  heartbeat: `# HEARTBEAT.md

Standing watch. The pulse fires on a timer. Do not spend a model call unless a line below is due.

- Keep MEMORY.md honest; drop trivia.
- If a ticket sits in doing with no progress, nudge the board.
- If a learned skill has never been used, leave it — the curator will age it.
- Silence is valid. HEARTBEAT_OK when nothing is due.
`,
};

function skillsHelix(): Skill[] {
  return [
    {
      id: uid("sk"),
      name: "standup-notes",
      description: "Turn raw bullets into a 9-line standup (yesterday / today / blockers).",
      instructions:
        "Ask for raw notes if missing. Three headed sections only: Yesterday / Today / Blockers. No preamble. canvas_render kind=markdown title=\"Standup\". Offer create_ticket for each blocker.",
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
        "Extract only facts, preferences, and lessons that should survive a week. write_memory with kind=fact|preference|lesson. Never store secrets. Confirm what you persisted in one line.",
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
        "Use canvas_render. Prefer stats for numbers, diagram for loops/architecture, markdown for briefs, timeline for sequences. Do not dump the same content as a chat wall if it belongs on the canvas.",
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
        "search_memory. Group into shipped / learned / stuck / next. canvas_render kind=markdown title=\"Week in review\". Keep it under one page. Offer write_daily. Offer to patch this skill if the format works.",
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

export function emptyUsage(): UsageStats {
  return {
    promptTokens: 0,
    completionTokens: 0,
    turns: 0,
    toolCalls: 0,
    lastModel: "",
    lastProvider: "",
    lastAt: null,
    turnsSinceMemoryWrite: 0,
    lastTurnToolCalls: 0,
    skillNudge: false,
  };
}

export const WEB_SESSION_ID = "web:operator";

export function webSession(at = now): Session {
  return {
    id: WEB_SESSION_ID,
    channelId: "web",
    title: "Operator",
    peer: "you",
    lastAt: at - 1000 * 60 * 44,
    preview: "Web console",
    unread: 0,
  };
}

export function seedSessions(): Session[] {
  return [webSession()];
}

export function seedSessionMessages(): ChatMessage[] {
  return [];
}

function seedTickets(): Ticket[] {
  return [
    {
      id: uid("tk"),
      title: "Connect a subscription",
      body: "Sign in SuperGrok or ChatGPT, or paste a Claude setup-token in Models.",
      status: "doing",
      at: now - 1000 * 60 * 90,
      updatedAt: now - 1000 * 60 * 40,
    },
    {
      id: uid("tk"),
      title: "Morning briefing skill",
      body: "Learn a skill that summarises overnight channel mail into one note.",
      status: "backlog",
      at: now - 1000 * 60 * 50,
      updatedAt: now - 1000 * 60 * 50,
    },
  ];
}

export function cliTurnSeed(): Pick<
  HelixTurnInput,
  "profileName" | "role" | "files" | "skills" | "memories" | "policy" | "tickets"
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
    tickets: seedTickets().map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.status,
    })),
  };
}

function tracesHelix(): TraceEvent[] {
  return [
    {
      id: uid("tr"),
      kind: "gateway",
      title: "Gateway online",
      detail: "Web console bound. Telegram, Discord, Slack, WhatsApp, Signal, and email wait on a token — same fields OpenClaw and Hermes use.",
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
    tickets: extra.tickets ?? [],
    usage: extra.usage ?? emptyUsage(),
    sessions: extra.sessions ?? [webSession()],
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
    heartbeat: PADDY_FILES.heartbeat,
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
      tickets: seedTickets(),
      sessions: seedSessions(),
      messages: seedSessionMessages(),
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
  },
  {
    id: "telegram",
    name: "Telegram",
    blurb: "BotFather token. Same field OpenClaw and Hermes store. Pairing code on first DM.",
    status: "idle",
    unread: 0,
  },
  {
    id: "slack",
    name: "Slack",
    blurb: "Socket Mode. Bot token + app token — the Hermes pair.",
    status: "idle",
    unread: 0,
  },
  {
    id: "discord",
    name: "Discord",
    blurb: "Bot token with Message Content Intent. Guilds wait on mention.",
    status: "idle",
    unread: 0,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    blurb: "Meta Cloud API. Webhook /api/hooks/whatsapp on this gateway.",
    status: "idle",
    unread: 0,
  },
  {
    id: "signal",
    name: "Signal",
    blurb: "signal-cli REST URL + number. Same as Hermes SIGNAL_HTTP_URL.",
    status: "idle",
    unread: 0,
  },
  {
    id: "email",
    name: "Email",
    blurb: "IMAP poll + SMTP send. Gmail needs an app password.",
    status: "idle",
    unread: 0,
  },
];

export const SUGGESTIONS = [
  "Search the hub for a calendar skill and install it.",
  "Remember that I prefer terse replies and weekday standups at 9.",
  "Draw Paddy Irishman’s loop on the canvas: gateway, heartbeat, learning, gated wake.",
  "Connect a ChatGPT subscription and tell me which brain is live.",
];
