export function shouldFailover(status: number): boolean {
  return status === 429 || status === 402;
}

function splitPool(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rotateKey(current: string, pool: string[]): { key: string; rest: string[] } | null {
  const all = pool.length ? pool : splitPool(current);
  const idx = all.indexOf(current);
  const next = idx >= 0 ? all[idx + 1] : all[1];
  if (!next) return null;
  return { key: next, rest: all.slice(all.indexOf(next) + 1) };
}
