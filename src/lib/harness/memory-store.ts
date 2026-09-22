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
import { ensureMemoryEmbedding } from "./embeddings.ts";
import { formatRecallBlock, rankMemories } from "./memory-recall.ts";
import {
  ensureSessionFreeze,
  filesForTurn,
  resolveMemoryLimits,
  usageMeters,
} from "./memory-hermes.mjs";

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export class SyncConflictError extends Error {
  readonly profileId: string;
  readonly expected: number;
  readonly actual: number;

  constructor(profileId: string, expected: number, actual: number) {
    super(
      `syncTurn conflict for ${profileId}: expected revision ${expected}, actual ${actual}`,
    );
    this.name = "SyncConflictError";
    this.profileId = profileId;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface WorkspaceRepo {
  get(profileId: string): Promise<WorkspaceState | null>;
  /**
   * Persist snapshot. When `expectedRevision` is set, fails with SyncConflictError
   * if the stored revision does not match (lost-update guard).
   * Returns the new revision.
   */
  put(
    profileId: string,
    snapshot: WorkspaceState,
    expectedRevision?: number,
  ): Promise<number>;
  list(): Promise<string[]>;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  prefetch(profileId: string): Promise<WorkspaceState>;
  /**
   * Persist a turn snapshot with optimistic concurrency.
   * Uses `ws.revision` as the expected base revision when present.
   * Bumps and returns via mutating `ws.revision` to the new value.
   */
  syncTurn(profileId: string, ws: WorkspaceState): Promise<void>;
  getWorkspace(profileId: string): Promise<WorkspaceState>;
  putWorkspace(profileId: string, ws: WorkspaceState): Promise<void>;
  listProfiles(): Promise<string[]>;
  systemPromptBlock(profileId: string, query?: string): Promise<string>;
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
    revision: 0,
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
  const revisionRaw = o.revision;
  const revision =
    typeof revisionRaw === "number" && Number.isFinite(revisionRaw)
      ? Math.max(0, Math.floor(revisionRaw))
      : 0;
  return {
    revision,
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
    async put(profileId, snapshot, expectedRevision) {
      const current = map.get(profileId);
      const actual = current?.revision ?? 0;
      if (expectedRevision != null && current && actual !== expectedRevision) {
        throw new SyncConflictError(profileId, expectedRevision, actual);
      }
      const nextRev = actual + 1;
      const next = structuredClone(snapshot);
      next.revision = nextRev;
      map.set(profileId, next);
      return nextRev;
    },
    async list() {
      return [...map.keys()];
    },
  };
}

export function createSqlRepo(db: Queryable): WorkspaceRepo {
  return {
    async get(profileId) {
      const rows = await db.query<{ snapshot: unknown; revision?: number }>(
        "select snapshot, revision from paddy_workspace where profile_id = $1",
        [profileId],
      );
      if (!rows[0]) return null;
      const ws = coerceSnapshot(rows[0].snapshot);
      const rev = Number(rows[0].revision);
      if (Number.isFinite(rev)) ws.revision = Math.max(ws.revision ?? 0, Math.floor(rev));
      return ws;
    },
    async put(profileId, snapshot, expectedRevision) {
      const currentRows = await db.query<{ revision: number }>(
        "select revision from paddy_workspace where profile_id = $1",
        [profileId],
      );
      const actual = currentRows[0] ? Number(currentRows[0].revision) || 0 : 0;
      if (expectedRevision != null && currentRows[0] && actual !== expectedRevision) {
        throw new SyncConflictError(profileId, expectedRevision, actual);
      }
      const nextRev = actual + 1;
      const next = { ...snapshot, revision: nextRev };
      if (!currentRows[0]) {
        await db.query(
          `insert into paddy_workspace (profile_id, snapshot, revision, updated_at)
           values ($1, $2::jsonb, $3, now())`,
          [profileId, JSON.stringify(next), nextRev],
        );
        return nextRev;
      }
      const updated = await db.query<{ revision: number }>(
        `update paddy_workspace
           set snapshot = $2::jsonb, revision = $3, updated_at = now()
         where profile_id = $1 and revision = $4
         returning revision`,
        [profileId, JSON.stringify(next), nextRev, expectedRevision ?? actual],
      );
      if (!updated[0]) {
        const again = await db.query<{ revision: number }>(
          "select revision from paddy_workspace where profile_id = $1",
          [profileId],
        );
        throw new SyncConflictError(
          profileId,
          expectedRevision ?? actual,
          Number(again[0]?.revision) || 0,
        );
      }
      return nextRev;
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
          const seeded = structuredClone(seeds[profileId]!);
          const rev = await repo.put(profileId, seeded);
          seeded.revision = rev;
          return seeded;
        }
      }
      const blank = blankWorkspace();
      const rev = await repo.put(profileId, blank);
      blank.revision = rev;
      return blank;
    },
    async syncTurn(profileId, ws) {
      await store.initialize();
      const expected =
        typeof ws.revision === "number" && Number.isFinite(ws.revision)
          ? Math.max(0, Math.floor(ws.revision))
          : undefined;
      // Attach local embeddings for new/changed memories (no network).
      ws.memories = (ws.memories ?? []).map((m) => ({
        ...m,
        embedding: ensureMemoryEmbedding(m.text, m.embedding),
      }));
      const nextRev = await repo.put(profileId, ws, expected);
      ws.revision = nextRev;
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
    async systemPromptBlock(profileId, query) {
      const ws = await store.prefetch(profileId);
      const hits = rankMemories(ws.memories ?? [], query ?? "", { limit: 12 });
      return formatRecallBlock(hits);
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
): HelixTurnInput & {
  memoryInjected?: {
    entry: import("./types").MemoryEntry;
    score: number;
    similarity: number;
    recency: number;
    importance: number;
  }[];
  memoryUsage?: ReturnType<typeof usageMeters>;
} {
  const sid = opts.sessionId || "web:operator";
  const ch = opts.channelId || "web";
  const frozen = ensureSessionFreeze(ws, sid, ch);
  const files = filesForTurn(frozen.workspace, sid);
  const limits = resolveMemoryLimits();
  const recallHits = rankMemories(ws.memories ?? [], opts.userMessage, {
    limit: limits.recallLimit,
  });
  const thread = (ws.messages ?? []).filter(
    (m) => (m.sessionId ?? "web:operator") === sid && (m.role === "user" || m.role === "assistant"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const usage = ws.usage;
  return {
    profileName: opts.profileName,
    role: opts.role,
    files,
    skills: (ws.skills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      status: s.status,
      uses: s.uses,
      triggers: s.triggers,
    })),
    memories: recallHits.map((h) => ({
      text: h.memory.text,
      kind: h.memory.kind,
    })),
    // Cap gates use live store; freeze is prompt-only (files.memory/user).
    memoryTextsLive: (ws.memories ?? []).map((m) => String(m.text ?? "")),
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
    memoryInjected: recallHits.map((h) => ({
      entry: h.memory,
      score: h.score,
      similarity: h.similarity,
      recency: h.recency,
      importance: h.importance,
    })),
    memoryUsage: usageMeters(ws, limits),
  };
}

export type { HelixTurnResult };
