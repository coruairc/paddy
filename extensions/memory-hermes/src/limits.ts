/** Caps for durable Hermes memory. Proposals and promotions both count. */
export const LIMITS = {
  memory: { maxEntries: 200, maxChars: 24_000 },
  user: { maxEntries: 80, maxChars: 8_000 },
} as const;

export const RECALL_LIMIT = 6;
export const RECALL_MAX_CHARS = 2_000;

export type MemoryKind = keyof typeof LIMITS;
