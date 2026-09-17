import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, localEmbed } from "./embeddings.ts";
import { rankMemories } from "./memory-recall.ts";
import type { MemoryEntry } from "./types.ts";

test("localEmbed is deterministic and cosine self-similar", () => {
  const a = localEmbed("Prefer terse replies on weekdays");
  const b = localEmbed("Prefer terse replies on weekdays");
  assert.deepEqual(a, b);
  assert.ok(cosine(a, a) > 0.99);
});

test("rankMemories prefers semantic match over unrelated recent", () => {
  const now = Date.now();
  const memories: MemoryEntry[] = [
    {
      id: "1",
      text: "Operator prefers PostgreSQL for the billing service",
      kind: "fact",
      at: now - 86400_000 * 40,
      source: "t",
      embedding: localEmbed("Operator prefers PostgreSQL for the billing service"),
      importance: 0.8,
    },
    {
      id: "2",
      text: "Had coffee this morning",
      kind: "episode",
      at: now - 60_000,
      source: "t",
      embedding: localEmbed("Had coffee this morning"),
      importance: 0.2,
    },
  ];
  const hits = rankMemories(memories, "what database do we use for billing?", { now, limit: 2 });
  assert.equal(hits[0]!.memory.id, "1");
  assert.ok(hits[0]!.score > hits[1]!.score);
});

test("rankMemories without query ranks by recency and importance", () => {
  const now = Date.now();
  const memories: MemoryEntry[] = [
    { id: "old", text: "ancient", kind: "fact", at: now - 86400_000 * 90, source: "t", importance: 0.9 },
    { id: "new", text: "fresh", kind: "preference", at: now - 1000, source: "t", importance: 0.9 },
  ];
  const hits = rankMemories(memories, "", { now, limit: 2 });
  assert.equal(hits[0]!.memory.id, "new");
});
