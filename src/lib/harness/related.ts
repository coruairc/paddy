/**
 * Lexical-overlap "related items" view over memories + skills.
 * A query, not a graph database.
 */
import type { MemoryEntry, Skill, WorkspaceState } from "./types";

const STOP = new Set([
  "the", "and", "for", "this", "that", "with", "from", "what", "how", "are",
  "was", "you", "your", "use", "into", "please", "just", "paddy", "skill",
]);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(a);
  let n = 0;
  for (const w of b) if (set.has(w)) n += 1;
  return n / Math.sqrt(a.length * b.length);
}

export interface RelatedItem {
  id: string;
  kind: "memory" | "skill";
  label: string;
  score: number;
}

export function relatedItems(ws: WorkspaceState, focusText: string, limit = 6): RelatedItem[] {
  const focus = tokens(focusText);
  if (!focus.length) return [];
  const out: RelatedItem[] = [];
  for (const m of ws.memories ?? []) {
    const score = overlap(focus, tokens(m.text));
    if (score > 0.08) out.push({ id: m.id, kind: "memory", label: m.text, score });
  }
  for (const s of ws.skills ?? []) {
    const blob = `${s.name} ${s.description} ${(s.triggers ?? []).join(" ")}`;
    const score = overlap(focus, tokens(blob));
    if (score > 0.08) out.push({ id: s.id || s.name, kind: "skill", label: s.name, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function relatedForMemory(ws: WorkspaceState, mem: MemoryEntry): RelatedItem[] {
  return relatedItems(ws, mem.text).filter((r) => r.id !== mem.id);
}

export function relatedForSkill(ws: WorkspaceState, skill: Skill): RelatedItem[] {
  return relatedItems(ws, `${skill.name} ${skill.description} ${(skill.triggers ?? []).join(" ")}`).filter(
    (r) => r.id !== skill.id && r.label !== skill.name,
  );
}
