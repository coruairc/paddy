import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openNodeSqliteDatabase } from "openclaw/plugin-sdk/sqlite-runtime";
import { LIMITS, type MemoryKind } from "./limits.js";
import { findSecret } from "./secret-filter.js";

export type MemoryStatus = "proposed" | "approved" | "rejected";

export type MemoryRow = {
  id: string;
  scope: string;
  kind: MemoryKind;
  text: string;
  status: MemoryStatus;
  version: number;
  createdAt: number;
  updatedAt: number;
  source: string;
};

export type StoreResult = { ok: true; id?: string; row?: MemoryRow } | { ok: false; error: string };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS memory_versions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS memory_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  op TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_scope_status ON memories (scope, status);
`;

type SqlRow = Record<string, unknown>;

const MEMORY_STATUSES: readonly MemoryStatus[] = ["proposed", "approved", "rejected"];

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return MEMORY_STATUSES.some((status) => status === value);
}

// Rows come from this store's own NOT NULL columns; the field readers narrow
// node:sqlite's output union instead of asserting a row shape.
function textField(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  return "";
}

function numberField(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return 0;
}

// An unknown status is never recallable: only "approved" rows are recalled.
function statusField(value: unknown): MemoryStatus {
  return isMemoryStatus(value) ? value : "rejected";
}

function rowFrom(record: SqlRow): MemoryRow {
  return {
    id: textField(record.id),
    scope: textField(record.scope),
    kind: record.kind === "user" ? "user" : "memory",
    text: textField(record.text),
    status: statusField(record.status),
    version: numberField(record.version),
    createdAt: numberField(record.created_at),
    updatedAt: numberField(record.updated_at),
    source: textField(record.source),
  };
}

export class HermesStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
    this.db = openNodeSqliteDatabase(dbPath);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  logError(op: string, message: string): void {
    try {
      this.db
        .prepare("INSERT INTO memory_errors (at, op, message) VALUES (?, ?, ?)")
        .run(Date.now(), op, message.slice(0, 500));
    } catch {
      /* diagnostics must not throw into the agent turn */
    }
  }

  recentErrors(limit = 10): { at: number; op: string; message: string }[] {
    return this.db
      .prepare("SELECT at, op, message FROM memory_errors ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        at: numberField(row.at),
        op: textField(row.op),
        message: textField(row.message),
      }));
  }

  usage(scope: string): Record<MemoryKind, { entries: number; chars: number }> {
    const out = {
      memory: { entries: 0, chars: 0 },
      user: { entries: 0, chars: 0 },
    };
    const rows = this.db
      .prepare(
        `SELECT kind, COUNT(*) AS entries, COALESCE(SUM(LENGTH(text)), 0) AS chars
         FROM memories WHERE scope = ? AND status != 'rejected' GROUP BY kind`,
      )
      .all(scope);
    for (const row of rows) {
      const kind = row.kind;
      if (kind === "user" || kind === "memory") {
        out[kind] = { entries: numberField(row.entries), chars: numberField(row.chars) };
      }
    }
    return out;
  }

  propose(input: { scope: string; kind: MemoryKind; text: string; source?: string }): StoreResult {
    const text = input.text.trim();
    if (!text) {
      return { ok: false, error: "empty" };
    }
    if (!input.scope.trim()) {
      return { ok: false, error: "scope required" };
    }
    const secret = findSecret(text);
    if (secret) {
      this.logError("secret-filter", "blocked credential-shaped proposal");
      return { ok: false, error: "secret" };
    }
    const cap = this.capBlock(input.scope, input.kind, text.length);
    if (cap) {
      return { ok: false, error: cap };
    }
    const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO memories (id, scope, kind, text, status, version, created_at, updated_at, source)
         VALUES (?, ?, ?, ?, 'proposed', 1, ?, ?, ?)`,
      )
      .run(id, input.scope, input.kind, text, now, now, input.source ?? "");
    this.snapshot(id, 1, text, "proposed", now);
    return { ok: true, id, row: this.get(id) };
  }

  approve(id: string): StoreResult {
    const row = this.get(id);
    if (!row) {
      return { ok: false, error: "not found" };
    }
    if (row.status === "approved") {
      return { ok: true, id, row };
    }
    const secret = findSecret(row.text);
    if (secret) {
      return { ok: false, error: "secret" };
    }
    const now = Date.now();
    const version = row.version + 1;
    this.db
      .prepare("UPDATE memories SET status = 'approved', version = ?, updated_at = ? WHERE id = ?")
      .run(version, now, id);
    this.snapshot(id, version, row.text, "approved", now);
    return { ok: true, id, row: this.get(id) };
  }

  reject(id: string): StoreResult {
    const row = this.get(id);
    if (!row) {
      return { ok: false, error: "not found" };
    }
    const now = Date.now();
    const version = row.version + 1;
    this.db
      .prepare("UPDATE memories SET status = 'rejected', version = ?, updated_at = ? WHERE id = ?")
      .run(version, now, id);
    this.snapshot(id, version, row.text, "rejected", now);
    return { ok: true, id, row: this.get(id) };
  }

  /** Restore the previous version of this entry only. */
  rollback(id: string): StoreResult {
    const row = this.get(id);
    if (!row) {
      return { ok: false, error: "not found" };
    }
    const priorRow = this.db
      .prepare(
        `SELECT version, text, status FROM memory_versions
         WHERE id = ? AND version < ? ORDER BY version DESC LIMIT 1`,
      )
      .get(id, row.version);
    const prior = priorRow
      ? { text: textField(priorRow.text), status: statusField(priorRow.status) }
      : undefined;
    const now = Date.now();
    if (!prior) {
      this.db
        .prepare("UPDATE memories SET status = 'rejected', updated_at = ? WHERE id = ?")
        .run(now, id);
      return { ok: true, id, row: this.get(id) };
    }
    const version = row.version + 1;
    this.db
      .prepare("UPDATE memories SET text = ?, status = ?, version = ?, updated_at = ? WHERE id = ?")
      .run(prior.text, prior.status, version, now, id);
    this.snapshot(id, version, prior.text, prior.status, now);
    return { ok: true, id, row: this.get(id) };
  }

  list(scope: string, status?: MemoryStatus): MemoryRow[] {
    if (status) {
      return this.db
        .prepare("SELECT * FROM memories WHERE scope = ? AND status = ? ORDER BY updated_at DESC")
        .all(scope, status)
        .map(rowFrom);
    }
    return this.db
      .prepare("SELECT * FROM memories WHERE scope = ? ORDER BY updated_at DESC")
      .all(scope)
      .map(rowFrom);
  }

  get(id: string): MemoryRow | undefined {
    const record = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    return record ? rowFrom(record) : undefined;
  }

  approvedForRecall(scope: string): MemoryRow[] {
    return this.db
      .prepare(
        `SELECT * FROM memories
           WHERE status = 'approved' AND (scope = ? OR scope = 'global')
           ORDER BY updated_at DESC`,
      )
      .all(scope)
      .map(rowFrom);
  }

  private capBlock(scope: string, kind: MemoryKind, extraChars: number): string | null {
    const usage = this.usage(scope)[kind];
    const limit = LIMITS[kind];
    if (usage.entries + 1 > limit.maxEntries) {
      this.logError("cap", `${kind} entry cap`);
      return "cap";
    }
    if (usage.chars + extraChars > limit.maxChars) {
      this.logError("cap", `${kind} char cap`);
      return "cap";
    }
    return null;
  }

  private snapshot(id: string, version: number, text: string, status: string, at: number): void {
    this.db
      .prepare(`INSERT INTO memory_versions (id, version, text, status, at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, version, text, status, at);
  }
}
