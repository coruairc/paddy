/**
 * Production wiring: PGLite/Postgres via getSql(), seeded from defaults.
 * Kept out of memory-store.ts so node:test can exercise the store without
 * Vite's import.meta.glob.
 */
import { getSql } from "@/lib/db";
import { paddyHome } from "./config.mjs";
import { seedWorkspaces } from "./defaults";
import { createMemoryStore, createSqlRepo, type MemoryStore } from "./memory-store";

const globalRef = globalThis as typeof globalThis & {
  __paddyMemoryStore__?: Promise<MemoryStore>;
};

export async function getMemoryStore(): Promise<MemoryStore> {
  globalRef.__paddyMemoryStore__ ??= (async () => {
    const sql = await getSql();
    const repo = createSqlRepo({
      query: (text, params) => sql.query(text, params),
    });
    const store = createMemoryStore(repo, {
      home: paddyHome(),
      seed: seedWorkspaces,
    });
    await store.initialize();
    return store;
  })().catch((err) => {
    globalRef.__paddyMemoryStore__ = undefined;
    throw err;
  });
  return globalRef.__paddyMemoryStore__;
}

export function resetMemoryStoreForTests(): void {
  globalRef.__paddyMemoryStore__ = undefined;
}
