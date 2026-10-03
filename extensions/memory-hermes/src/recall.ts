import { RECALL_LIMIT, RECALL_MAX_CHARS } from "./limits.js";
import type { HermesStore, MemoryRow } from "./store.js";

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 2);
}

export function rankMemories(query: string, rows: MemoryRow[], limit = RECALL_LIMIT): MemoryRow[] {
  const wanted = new Set(tokens(query));
  const scored = rows.map((row) => {
    if (wanted.size === 0) {
      return { row, score: 0 };
    }
    const have = tokens(row.text);
    let score = 0;
    for (const token of have) {
      if (wanted.has(token)) {
        score += 1;
      }
    }
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score || b.row.updatedAt - a.row.updatedAt);
  const relevant = wanted.size === 0 ? [] : scored.filter((item) => item.score > 0);
  return relevant.slice(0, limit).map((item) => item.row);
}

export function renderRecall(query: string, rows: MemoryRow[]): string {
  const ranked = rankMemories(query, rows);
  if (ranked.length === 0) {
    return "";
  }
  const lines = ["Hermes memory (approved, this identity only):"];
  let used = 0;
  for (const row of ranked) {
    const line = `- (${row.kind}) ${row.text}`;
    if (used + line.length > RECALL_MAX_CHARS) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/** Recall never throws into the agent turn. Empty scope recalls nothing. */
export function safeRecall(store: HermesStore, scope: string, query: string): string {
  if (!scope.trim()) {
    return "";
  }
  try {
    return renderRecall(query, store.approvedForRecall(scope));
  } catch (err) {
    store.logError("recall", err instanceof Error ? err.message : String(err));
    return "";
  }
}
