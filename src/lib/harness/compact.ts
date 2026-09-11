/**
 * Head/tail-protect context compaction.
 * Prune tool outputs first, then collapse the middle into an extractive note.
 * A cheap model can replace the extractive note when configured later.
 */
import type { ChatMsg } from "./brain";

export interface CompactOptions {
  keepHead?: number;
  keepTail?: number;
  toolMax?: number;
  budgetChars?: number;
}

export function pruneToolOutput(content: string, max = 240): string {
  const t = content.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function estimate(messages: ChatMsg[]): number {
  return messages.reduce((n, m) => {
    const text = typeof m.content === "string" ? m.content : "";
    return n + text.length;
  }, 0);
}

export function compactMessages(messages: ChatMsg[], opts: CompactOptions = {}): ChatMsg[] {
  const keepHead = opts.keepHead ?? 1;
  const keepTail = opts.keepTail ?? 6;
  const toolMax = opts.toolMax ?? 240;
  const budget = opts.budgetChars ?? 24_000;

  const pruned = messages.map((m) => {
    if (m.role === "tool" && typeof m.content === "string") {
      return { ...m, content: pruneToolOutput(m.content, toolMax) };
    }
    return m;
  });

  if (pruned.length <= keepHead + keepTail || estimate(pruned) <= budget) {
    return pruned;
  }

  const head = pruned.slice(0, keepHead);
  const tail = pruned.slice(-keepTail);
  const middle = pruned.slice(keepHead, -keepTail);
  const bullets = middle
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = typeof m.content === "string" ? m.content.replace(/\s+/g, " ").slice(0, 160) : "";
      return `- ${m.role}: ${text}`;
    })
    .slice(0, 24);
  const summary: ChatMsg = {
    role: "user",
    content: `[compacted ${middle.length} earlier turns]\n${bullets.join("\n") || "(tool noise pruned)"}`,
  };
  return [...head, summary, ...tail];
}
