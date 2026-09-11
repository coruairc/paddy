/**
 * Unified workspace store.
 *
 * Lifecycle (Hermes memory-provider shape): initialize → prefetch / syncTurn
 * per turn → shutdown. CLI, web, channels, and the scheduler all read/write
 * here. Backed by PGLite/Postgres in production; tests inject a Map or a
 * Queryable so they never need Vite's import.meta.glob.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ChatMessage,
  HelixTurnInput,
  HelixTurnResult,
  MemoryEntry,
  Policy,
  Skill,
  WorkspaceFiles,
  WorkspaceState,
} from "./types";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface WorkspaceRepo {
  get(profileId: string): Promise<WorkspaceState | null>;
  put(profileId: string, snapshot: WorkspaceState): Promise<void>;
  list(): Promise<string[]>;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  prefetch(profileId: string): Promise<WorkspaceState>;
  syncTurn(profileId: string, ws: WorkspaceState): Promise<void>;
  getWorkspace(profileId: string): Promise<WorkspaceState>;
  putWorkspace(profileId: string, ws: WorkspaceState): Promise<void>;
  listProfiles(): Promise<string[]>;
  systemPromptBlock(profileId: string): Promise<string>;
  shutdown(): Promise<void>;
}

export type SeedFn = () => Record<string, WorkspaceState> | Promise<Record<string, WorkspaceState>>;

export interface MemoryStoreOptions {
  home?: string;
  seed?: SeedFn;
}

const EMPTY_FILES: WorkspaceFiles = {
  soul: "",
  identity: "",
  user: "",
  memory: "",
  agents: "",
  heartbeat: "",
};

export function blankWorkspace(): WorkspaceState {
  return {
    files: { ...EMPTY_FILES },
    skills: [],
    memories: [],
    messages: [],
    traces: [],
    canvas: [],
    checkpoints: [],
    wakes: [],
    dailyNotes: [],
    tickets: [],
    usage: {
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
    },
    sessions: [],
  };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function coerceSnapshot(raw: unknown): WorkspaceState {
  const base = blankWorkspace();
  if (raw == null) return base;
  const src = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const o = asRecord(src);
  const files = asRecord(o.files);
  const history = asArray<{ role?: string; content?: string }>(o.history);
  const messages = asArray<ChatMessage>(o.messages);
  const fromHistory: ChatMessage[] =
    messages.length > 0
      ? messages
      : history
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .map((m, i) => ({
            id: `hist_${i}`,
            role: m.role as "user" | "assistant",
            content: String(m.content),
            at: 0,
            channelId: "web",
            sessionId: "web:operator",
          }));
  const usage = asRecord(o.usage);
  return {
    files: {
      soul: typeof files.soul === "string" ? files.soul : base.files.soul,
      identity: typeof files.identity === "string" ? files.identity : base.files.identity,
      user: typeof files.user === "string" ? files.user : base.files.user,
      memory: typeof files.memory === "string" ? files.memory : base.files.memory,
      agents: typeof files.agents === "string" ? files.agents : base.files.agents,
      heartbeat: typeof files.heartbeat === "string" ? files.heartbeat : base.files.heartbeat,
    },
    skills: asArray<Skill>(o.skills),
    memories: asArray<MemoryEntry>(o.memories),
    messages: fromHistory,
    traces: asArray(o.traces),
    canvas: asArray(o.canvas),
    checkpoints: asArray(o.checkpoints),
    wakes: asArray(o.wakes),
    dailyNotes: asArray(o.dailyNotes),
    tickets: asArray(o.tickets),
    usage: {
      ...base.usage,
      promptTokens: Number(usage.promptTokens) || 0,
      completionTokens: Number(usage.completionTokens) || 0,
      turns: Number(usage.turns) || 0,
      toolCalls: Number(usage.toolCalls) || 0,
      lastModel: typeof usage.lastModel === "string" ? usage.lastModel : "",
      lastProvider: typeof usage.lastProvider === "string" ? usage.lastProvider : "",
      lastAt: typeof usage.lastAt === "number" ? usage.lastAt : null,
      turnsSinceMemoryWrite: Number(usage.turnsSinceMemoryWrite) || 0,
      lastTurnToolCalls: Number(usage.lastTurnToolCalls) || 0,
      skillNudge: Boolean(usage.skillNudge),
    },
    sessions: asArray(o.sessions),
  };
}

export function createMemoryRepo(initial?: Record<string, WorkspaceState>): WorkspaceRepo {
  const map = new Map<string, WorkspaceState>();
  if (initial) {
    for (const [id, ws] of Object.entries(initial)) map.set(id, structuredClone(ws));
  }
  return {
    async get(profileId) {
      const hit = map.get(profileId);
      return hit ? structuredClone(hit) : null;
    },
    async put(profileId, snapshot) {
      map.set(profileId, structuredClone(snapshot));
    },
    async list() {
      return [...map.keys()];
    },
  };
}

export function createSqlRepo(db: Queryable): WorkspaceRepo {
  return {
    async get(profileId) {
      const rows = await db.query<{ snapshot: unknown }>(
        "select snapshot from paddy_workspace where profile_id = $1",
        [profileId],
      );
      if (!rows[0]) return null;
      return coerceSnapshot(rows[0].snapshot);
    },
    async put(profileId, snapshot) {
      await db.query(
        `insert into paddy_workspace (profile_id, snapshot, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (profile_id) do update
           set snapshot = excluded.snapshot, updated_at = now()`,
        [profileId, JSON.stringify(snapshot)],
      );
    },
    async list() {
      const rows = await db.query<{ profile_id: string }>(
        "select profile_id from paddy_workspace order by profile_id",
      );
      return rows.map((r) => r.profile_id);
    },
  };
}

function defaultHome(): string {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

function migrateLegacyWorkspace(home: string, raw: unknown): WorkspaceState {
  const coerced = coerceSnapshot(raw);
  return coerced;
}

export function createMemoryStore(repo: WorkspaceRepo, opts: MemoryStoreOptions = {}): MemoryStore {
  let ready = false;
  const home = opts.home;

  const store: MemoryStore = {
    async initialize() {
      if (ready) return;
      if (home) {
        const legacy = join(home, "workspace.json");
        const marker = join(home, "workspace.migrated");
        if (existsSync(legacy) && !existsSync(marker)) {
          try {
            const raw = JSON.parse(readFileSync(legacy, "utf8")) as unknown;
            const existing = await repo.get("paddy");
            if (!existing) {
              await repo.put("paddy", migrateLegacyWorkspace(home, raw));
            }
            mkdirSync(home, { recursive: true, mode: 0o700 });
            writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
            try {
              renameSync(legacy, join(home, "workspace.json.bak"));
            } catch {
              /* keep the original if rename fails */
            }
          } catch {
            /* malformed legacy file — skip */
          }
        }
      }
      const ids = await repo.list();
      if (!ids.includes("paddy") && opts.seed) {
        const seeds = await opts.seed();
        for (const [id, ws] of Object.entries(seeds)) {
          const current = await repo.get(id);
          if (!current) await repo.put(id, ws);
        }
      }
      ready = true;
    },
    async prefetch(profileId) {
      await store.initialize();
      const hit = await repo.get(profileId);
      if (hit) return hit;
      if (opts.seed) {
        const seeds = await opts.seed();
        if (seeds[profileId]) {
          await repo.put(profileId, seeds[profileId]!);
          return structuredClone(seeds[profileId]!);
        }
      }
      const blank = blankWorkspace();
      await repo.put(profileId, blank);
      return blank;
    },
    async syncTurn(profileId, ws) {
      await store.initialize();
      await repo.put(profileId, ws);
    },
    async getWorkspace(profileId) {
      return store.prefetch(profileId);
    },
    async putWorkspace(profileId, ws) {
      return store.syncTurn(profileId, ws);
    },
    async listProfiles() {
      await store.initialize();
      return repo.list();
    },
    async systemPromptBlock(profileId) {
      const ws = await store.prefetch(profileId);
      const lines = ws.memories.slice(-12).map((m) => `- (${m.kind}) ${m.text}`);
      return lines.length ? `## Memory\n${lines.join("\n")}` : "";
    },
    async shutdown() {
      ready = false;
    },
  };
  return store;
}

export function paddyDataHome(): string {
  return defaultHome();
}

export function buildTurnInput(
  ws: WorkspaceState,
  opts: {
    profileName: string;
    role: string;
    userMessage: string;
    channelId?: string;
    channelName?: string;
    sessionId?: string;
    policy: Policy;
    preferredProvider?: string;
    preferredModel?: string;
    keys?: Record<string, string | undefined>;
    forceSkill?: string;
  },
): HelixTurnInput {
  const sid = opts.sessionId || "web:operator";
  const ch = opts.channelId || "web";
  const thread = (ws.messages ?? []).filter(
    (m) => (m.sessionId ?? "web:operator") === sid && (m.role === "user" || m.role === "assistant"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const usage = ws.usage;
  return {
    profileName: opts.profileName,
    role: opts.role,
    files: ws.files,
    skills: (ws.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      status: s.status,
      uses: s.uses,
      triggers: s.triggers,
    })),
    memories: (ws.memories ?? []).slice(-16).map((m) => ({ text: m.text, kind: m.kind })),
    history: thread.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    transcript: (ws.messages ?? []).slice(-80).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 400),
    })),
    userMessage: opts.userMessage,
    channelId: ch,
    channelName: opts.channelName,
    policy: opts.policy,
    preferredProvider: opts.preferredProvider,
    preferredModel: opts.preferredModel,
    keys: opts.keys,
    tickets: (ws.tickets ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.status,
    })),
    dailyToday: (ws.dailyNotes ?? []).find((d) => d.date === today)?.content,
    otherSessions: (ws.sessions ?? [])
      .filter((s) => s.id !== sid)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 5)
      .map((s) => ({ id: s.id, title: s.title, preview: s.preview })),
    dueWakes: (ws.wakes ?? [])
      .filter((w) => !w.fired && w.at <= Date.now())
      .map((w) => ({ reason: w.reason, note: w.note })),
    nudgeMemory: (usage?.turnsSinceMemoryWrite ?? 0) >= 6 && (usage?.turns ?? 0) > 0,
    nudgeSkill: Boolean(usage?.skillNudge),
    forceSkill: opts.forceSkill,
  };
}

export type { HelixTurnResult };
