/**
 * Hermes-class ranked memory recall: composite similarity + recency + importance.
 * Falls back to lexical overlap when embeddings are absent.
 */
import { cosine, localEmbed } from "./embeddings.ts";
import type { HelixTurnInput, MemoryEntry, MemoryKind } from "./types";

const KIND_WEIGHT: Record<MemoryKind, number> = {
  preference: 0.9,
  fact: 0.75,
  lesson: 0.7,
  episode: 0.45,
};

export interface RecallHit {
  memory: MemoryEntry;
  score: number;
  similarity: number;
  recency: number;
  importance: number;
}

export interface RecallWeights {
  semantic: number;
  recency: number;
  importance: number;
  halfLifeDays: number;
}

export const DEFAULT_RECALL_WEIGHTS: RecallWeights = {
  semantic: 0.5,
  recency: 0.3,
  importance: 0.2,
  halfLifeDays: 30,
};

function recallLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PADDY_RECALL_LIMIT;
  const n = raw ? Number.parseInt(raw, 10) : 12;
  return Number.isFinite(n) ? Math.min(32, Math.max(1, n)) : 12;
}

function recencyScore(at: number, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - at) / (86400 * 1000));
  return 0.5 ** (ageDays / Math.max(1, halfLifeDays));
}

function importanceOf(m: MemoryEntry): number {
  if (typeof m.importance === "number" && Number.isFinite(m.importance)) {
    return Math.min(1, Math.max(0, m.importance));
  }
  return KIND_WEIGHT[m.kind] ?? 0.5;
}

function lexicalSim(query: string, text: string): number {
  const q = localEmbed(query);
  const t = localEmbed(text);
  return Math.max(0, cosine(q, t));
}

export function rankMemories(
  memories: MemoryEntry[],
  query: string,
  opts?: {
    limit?: number;
    now?: number;
    queryEmbedding?: number[];
    weights?: Partial<RecallWeights>;
  },
): RecallHit[] {
  const weights = { ...DEFAULT_RECALL_WEIGHTS, ...opts?.weights };
  const now = opts?.now ?? Date.now();
  const limit = opts?.limit ?? recallLimit();
  const qEmb = opts?.queryEmbedding ?? (query.trim() ? localEmbed(query) : null);
  const hits: RecallHit[] = [];

  for (const memory of memories) {
    const emb = memory.embedding;
    let similarity = 0;
    if (qEmb && Array.isArray(emb) && emb.length) {
      similarity = Math.max(0, cosine(qEmb, emb));
    } else if (query.trim()) {
      similarity = lexicalSim(query, memory.text);
    } else {
      similarity = 0.5; // no query → rank by recency/importance only
    }
    const recency = recencyScore(memory.at || 0, now, weights.halfLifeDays);
    const importance = importanceOf(memory);
    const score =
      weights.semantic * similarity + weights.recency * recency + weights.importance * importance;
    hits.push({ memory, score, similarity, recency, importance });
  }

  return hits.sort((a, b) => b.score - a.score || b.memory.at - a.memory.at).slice(0, limit);
}

export function formatRecallBlock(hits: RecallHit[]): string {
  if (!hits.length) return "";
  const lines = hits.map(
    (h) => `- (${h.memory.kind}) ${h.memory.text}`,
  );
  return `## Memory\n${lines.join("\n")}`;
}


/** Hermes recall block for injection as a system message (paddy + OpenClaw routes). */
export function recallSystemMessage(
  data: Pick<HelixTurnInput, "memories"> & {
    memoryInjected?: {
      entry: MemoryEntry;
      score: number;
      similarity: number;
      recency: number;
      importance: number;
    }[];
  },
): string {
  if (data.memoryInjected?.length) {
    const hits: RecallHit[] = data.memoryInjected.map((h) => ({
      memory: h.entry,
      score: h.score,
      similarity: h.similarity,
      recency: h.recency,
      importance: h.importance,
    }));
    return formatRecallBlock(hits);
  }
  if (!data.memories?.length) return "";
  const hits: RecallHit[] = data.memories.map((m, i) => ({
    memory: {
      id: `recall_${i}`,
      text: m.text,
      kind: m.kind,
      at: 0,
      source: "turn",
    },
    score: 1,
    similarity: 1,
    recency: 1,
    importance: 1,
  }));
  return formatRecallBlock(hits);
}
