import type { MemoryKind } from "./limits.js";
import type { HermesStore, StoreResult } from "./store.js";

const REMEMBER =
  /(?:^|\n)\s*(?:please\s+)?(?:remember(?:\s+that)?|note(?:\s+that)?)\s*[:\-]?\s+(.+)/i;

export function extractProposal(userText: string): { kind: MemoryKind; text: string } | null {
  const match = REMEMBER.exec(userText);
  const text = match?.[1]?.trim();
  if (!text || text.length < 3) {
    return null;
  }
  const kind: MemoryKind = /\b(?:i prefer|my name is|i am|i'm|i like|i use)\b/i.test(text)
    ? "user"
    : "memory";
  return { kind, text: text.slice(0, 500) };
}

/**
 * Conservative curator: only explicit remember/note requests become proposals.
 * Failures are logged and never thrown.
 */
export function curateTurn(
  store: HermesStore,
  input: { scope: string; userText: string; success: boolean; source?: string },
): StoreResult | { ok: false; error: "skipped" } {
  try {
    if (!input.success) {
      return { ok: false, error: "skipped" };
    }
    const proposal = extractProposal(input.userText);
    if (!proposal) {
      return { ok: false, error: "skipped" };
    }
    return store.propose({
      scope: input.scope,
      kind: proposal.kind,
      text: proposal.text,
      source: input.source ?? "curator",
    });
  } catch (err) {
    store.logError("curator", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "skipped" };
  }
}
