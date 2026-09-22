import type { BrainKeys } from "./providers";

export type ViewId =
  | "console"
  | "sessions"
  | "gateway"
  | "board"
  | "identity"
  | "skills"
  | "memory"
  | "checkpoints"
  | "observatory"
  | "models";

export type ToolName =
  | "write_memory"
  | "update_user"
  | "create_skill"
  | "patch_skill"
  | "skill_manage"
  | "search_memory"
  | "read_workspace"
  | "list_skills"
  | "use_skill"
  | "canvas_render"
  | "spawn_subagent"
  | "checkpoint"
  | "schedule_wake"
  | "send_channel"
  | "hub_search"
  | "install_skill"
  | "create_ticket"
  | "update_ticket"
  | "write_daily"
  | "update_heartbeat";

export type TraceKind =
  | "model"
  | "tool"
  | "memory"
  | "skill"
  | "compress"
  | "wake"
  | "checkpoint"
  | "permission"
  | "gateway"
  | "subagent";

export type SkillStatus = "new" | "active" | "stale" | "archived";
export type MemoryKind = "fact" | "preference" | "lesson" | "episode";
export type MemoryTarget = "memory" | "user";
export type MemoryWriteAction = "add" | "replace" | "remove";
export type ChannelStatus = "connected" | "idle" | "pairing" | "offline";
export type TicketStatus = "backlog" | "doing" | "done";

export interface Policy {
  autoApprove: ToolName[];
  requireApproval: ToolName[];
}

export interface ProfileMeta {
  id: string;
  name: string;
  role: string;
}

export interface WorkspaceFiles {
  soul: string;
  identity: string;
  user: string;
  memory: string;
  agents: string;
  heartbeat: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
  status: SkillStatus;
  uses: number;
  lastUsedAt: number | null;
  createdAt: number;
  origin: "seeded" | "learned" | "patched" | "hub";
  slug?: string;
  registry?: string;
  version?: string;
}

export interface MemoryEntry {
  id: string;
  text: string;
  kind: MemoryKind;
  at: number;
  source: string;
  /** Optional unit embedding for ranked recall (local hash or API). */
  embedding?: number[];
  /** 0..1 importance hint for composite recall scoring. */
  importance?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  channelId?: string;
  sessionId?: string;
  at: number;
}

export interface Session {
  id: string;
  channelId: string;
  title: string;
  peer?: string;
  lastAt: number;
  preview: string;
  unread: number;
  /** Hermes frozen MEMORY/USER markdown captured at session start. */
  frozenMemory?: { memory: string; user: string; at: number };
}

export interface TraceEvent {
  id: string;
  kind: TraceKind;
  title: string;
  detail?: string;
  at: number;
  status: "ok" | "warn" | "error" | "pending";
}

export interface CanvasCard {
  id: string;
  at: number;
  kind: "markdown" | "stats" | "diagram" | "timeline";
  title: string;
  body: string;
  stats?: { label: string; value: string }[];
  nodes?: { id: string; label: string }[];
  edges?: { from: string; to: string }[];
}

export interface Checkpoint {
  id: string;
  label: string;
  at: number;
  snapshot: string;
}

export interface Wake {
  id: string;
  at: number;
  reason: string;
  note: string;
  fired: boolean;
  notified?: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  body: string;
  status: TicketStatus;
  at: number;
  updatedAt: number;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  turns: number;
  toolCalls: number;
  lastModel: string;
  lastProvider: string;
  lastAt: number | null;
  turnsSinceMemoryWrite: number;
  lastTurnToolCalls: number;
  skillNudge: boolean;
}

export interface DailyNote {
  date: string;
  content: string;
}

export interface Channel {
  id: string;
  name: string;
  blurb: string;
  status: ChannelStatus;
  unread: number;
  lastMessage?: { from: string; text: string; at: number };
  pendingPair?: { from: string; text: string; code: string; at: number };
  allowFrom?: string[];
  configured?: boolean;
  error?: string;
  label?: string;
}

export interface WorkspaceState {
  /** Monotonic revision for optimistic syncTurn (lost-update guard). */
  revision?: number;
  files: WorkspaceFiles;
  skills: Skill[];
  memories: MemoryEntry[];
  messages: ChatMessage[];
  traces: TraceEvent[];
  canvas: CanvasCard[];
  checkpoints: Checkpoint[];
  wakes: Wake[];
  dailyNotes: DailyNote[];
  tickets: Ticket[];
  usage: UsageStats;
  sessions: Session[];
}

export type Mutation =
  | { type: "write_memory"; text: string; kind: MemoryKind; mode: "append" | "replace" }
  | { type: "update_user"; content: string }
  | { type: "update_soul"; content: string }
  | { type: "update_heartbeat"; content: string }
  | {
      type: "create_skill";
      name: string;
      description: string;
      instructions: string;
      triggers: string[];
      origin?: Skill["origin"];
      status?: SkillStatus;
      version?: string;
    }
  | { type: "patch_skill"; name: string; instructions: string; reason: string }
  | { type: "archive_skill"; name: string }
  | { type: "bump_skill"; name: string }
  | { type: "canvas"; card: Omit<CanvasCard, "id" | "at"> }
  | { type: "checkpoint"; label: string }
  | { type: "schedule_wake"; delayMinutes: number; reason: string; note: string }
  | { type: "send_channel"; channelId: string; message: string }
  | { type: "daily_note"; content: string }
  | {
      type: "install_hub";
      name: string;
      description: string;
      instructions: string;
      triggers: string[];
      slug: string;
      registry: string;
      version: string;
    }
  | { type: "create_ticket"; title: string; body: string; status: TicketStatus }
  | {
      type: "update_ticket";
      id: string;
      title?: string;
      body?: string;
      status?: TicketStatus;
    }
  | { type: "remove_ticket"; id: string };

export interface HelixTurnInput {
  profileName: string;
  role: string;
  files: WorkspaceFiles;
  skills: Pick<Skill, "name" | "description" | "instructions" | "status" | "uses" | "triggers">[];
  memories: Pick<MemoryEntry, "text" | "kind">[];
  history: { role: "user" | "assistant"; content: string }[];
  transcript?: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  channelId?: string;
  channelName?: string;
  policy: Policy;
  preferredProvider?: string;
  preferredModel?: string;
  keys?: Record<string, string | undefined>;
  tickets?: Pick<Ticket, "id" | "title" | "body" | "status">[];
  dailyToday?: string;
  otherSessions?: { id: string; title: string; preview: string }[];
  dueWakes?: { reason: string; note: string }[];
  nudgeMemory?: boolean;
  nudgeSkill?: boolean;
  forceSkill?: string;
  profileId?: string;
  sessionId?: string;
  rawUserText?: string;
}

export type HelixTurnResult =
  | {
      ok: false;
      error: string;
      keyPatch?: BrainKeys;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        toolCalls: number;
        model: string;
        provider: string;
      };
      workspace?: WorkspaceState;
    }
  | {
      ok: true;
      text: string;
      mutations: Mutation[];
      traces: Omit<TraceEvent, "id" | "at">[];
      pendingApproval?: {
        tool: ToolName;
        args: Record<string, string>;
        reason: string;
      };
      pendingApprovals?: {
        tool: ToolName;
        args: Record<string, string>;
        reason: string;
      }[];
      keyPatch?: BrainKeys;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        toolCalls: number;
        model: string;
        provider: string;
      };
      workspace?: WorkspaceState;
      /** Ranked recall hits injected into this turn (FE observability). */
      memoryInjected?: {
        entry: MemoryEntry;
        score: number;
        similarity: number;
        recency: number;
        importance: number;
      }[];
      /** Hermes-style usage meters, e.g. memory: "1474/2200". */
      memoryUsage?: {
        memory: string;
        user: string;
        memoryChars: number;
        memoryLimit: number;
        userChars: number;
        userLimit: number;
      };
    };
