/**
 * Embeddings for Hermes-class ranked memory recall.
 *
 * Default: deterministic local hashing (no network, no secrets) so self-host
 * and tests always work. Optional OpenAI-compatible HTTP embedder via env.
 */
export const LOCAL_EMBED_DIM = 64;

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 1);
}

/** Fast local embedding: hashed bag-of-tokens into a unit vector. */
export function localEmbed(text: string, dim = LOCAL_EMBED_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  const toks = tokens(text);
  if (!toks.length) return v;
  for (const t of toks) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i += 1) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = h & 1 ? 1 : -1;
    v[idx]! += sign;
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

export interface EmbedConfig {
  url?: string;
  model?: string;
  apiKey?: string;
}

export function embedConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbedConfig {
  const url = (env.PADDY_EMBEDDING_URL || "").trim();
  const model = (env.PADDY_EMBEDDING_MODEL || "text-embedding-3-small").trim();
  const apiKey = (
    env.PADDY_EMBEDDING_API_KEY ||
    env.OPENAI_API_KEY ||
    env.XAI_API_KEY ||
    ""
  ).trim();
  return { url: url || undefined, model, apiKey: apiKey || undefined };
}

/**
 * Embed text. Uses HTTP when URL+key configured; otherwise local hash.
 * Never logs the API key.
 */
export async function embedText(
  text: string,
  cfg: EmbedConfig = embedConfigFromEnv(),
): Promise<number[]> {
  const clipped = text.slice(0, 8000);
  if (!cfg.url || !cfg.apiKey) return localEmbed(clipped);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model || "text-embedding-3-small",
        input: clipped,
      }),
    });
    if (!res.ok) return localEmbed(clipped);
    const body = (await res.json()) as {
      data?: { embedding?: number[] }[];
      embedding?: number[];
    };
    const vec = body.data?.[0]?.embedding ?? body.embedding;
    if (Array.isArray(vec) && vec.every((x) => typeof x === "number")) return vec;
    return localEmbed(clipped);
  } catch {
    return localEmbed(clipped);
  }
}

export function ensureMemoryEmbedding(text: string, existing?: number[]): number[] {
  if (Array.isArray(existing) && existing.length >= 8) return existing;
  return localEmbed(text);
}
