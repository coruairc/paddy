import type { BrainKeys } from "./providers";

export type ViewId =
  | "console"
  | "gateway"
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
  | "search_memory"
  | "read_workspace"
  | "list_skills"
  | "canvas_render"
  | "spawn_subagent"
  | "checkpoint"
  | "schedule_wake"
  | "send_channel"
  | "hub_search"
  | "install_skill";

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
export type ChannelStatus = "connected" | "idle" | "pairing" | "offline";

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
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  channelId?: string;
  at: number;
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
}

export interface WorkspaceState {
  files: WorkspaceFiles;
  skills: Skill[];
  memories: MemoryEntry[];
  messages: ChatMessage[];
  traces: TraceEvent[];
  canvas: CanvasCard[];
  checkpoints: Checkpoint[];
  wakes: Wake[];
  dailyNotes: DailyNote[];
}

export type Mutation =
  | { type: "write_memory"; text: string; kind: MemoryKind; mode: "append" | "replace" }
  | { type: "update_user"; content: string }
  | { type: "update_soul"; content: string }
  | {
      type: "create_skill";
      name: string;
      description: string;
      instructions: string;
      triggers: string[];
    }
  | { type: "patch_skill"; name: string; instructions: string; reason: string }
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
    };

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
  keys?: Record<string, string | undefined>;
}

export type HelixTurnResult =
  | { ok: false; error: string; keyPatch?: BrainKeys }
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
      keyPatch?: BrainKeys;
    };
