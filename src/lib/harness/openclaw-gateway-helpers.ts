/**
 * Pure OpenClawTarget helpers (Phase B FE). Safe for node:test — no createServerFn.
 *
 * Config keys locked with Backend Phase B: openclaw.runtime|url|token|model.
 * Prefer Backend openclaw-gateway.ts / resolveOpenClawRuntime for HTTP client.
 */

export type AgentRuntime = "openclaw" | "paddy";

export type OpenClawTarget = {
  runtime: AgentRuntime;
  url: string;
  /** Write-only — never returned from load; paste to overwrite. */
  token?: string;
  model?: string;
};

/** UI/config target (includes runtime). Alias — distinct name from Backend openclaw-gateway OpenClawTarget. */
export type OpenClawUiTarget = OpenClawTarget;

export const OPENCLAW_TARGET_ROOT = "openclaw";

export const OPENCLAW_TARGET_PATHS = {
  runtime: "openclaw.runtime",
  url: "openclaw.url",
  token: "openclaw.token",
  model: "openclaw.model",
} as const;

export const DEFAULT_OPENCLAW_TARGET: OpenClawUiTarget = {
  runtime: "paddy",
  url: "",
  model: "",
};

export const OPENCLAW_PROBE_TIMEOUT_MS = 8_000;

/** Hosted shared demo: auth-off, no PADDY_CLI_TOKEN — same gate as persistBrainKeys. */
export function isHostedPaddyDemoEnv(
  env: { PADDY_CLI_TOKEN?: string | undefined } = typeof process !== "undefined" ? process.env : {},
): boolean {
  return !(env.PADDY_CLI_TOKEN ?? "").trim();
}

export function normalizeOpenClawUrl(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  if (u.pathname === "/") u.pathname = "";
  else if (u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString().replace(/\/$/, "");
}

export function isLoopbackOpenClawUrl(raw: string): boolean {
  const normalized = normalizeOpenClawUrl(raw);
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function resolveEffectiveRuntime(opts: {
  configured?: string | null;
  hostedDemo: boolean;
}): AgentRuntime {
  if (opts.hostedDemo) return "paddy";
  return opts.configured === "openclaw" ? "openclaw" : "paddy";
}

/** Candidate health probe URLs (OpenClaw documents both /health and /healthz). */
export function buildOpenClawHealthUrls(baseUrl: string): string[] {
  const base = normalizeOpenClawUrl(baseUrl);
  if (!base) return [];
  return [`${base}/health`, `${base}/healthz`];
}

/** Never include secrets in probe error/detail strings. */
export function sanitizeOpenClawProbeText(text: string, token?: string): string {
  let out = String(text ?? "");
  const secret = (token ?? "").trim();
  if (secret && secret.length >= 4) {
    out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/authorization\s*:\s*bearer\s+\S+/gi, "Authorization: Bearer [redacted]");
  return out.slice(0, 240);
}

export function parseOpenClawTargetFromConfig(config: unknown): OpenClawUiTarget {
  const root =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>).openclaw
      : undefined;
  const obj =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {};
  const runtimeRaw = typeof obj.runtime === "string" ? obj.runtime : "paddy";
  const runtime: AgentRuntime = runtimeRaw === "openclaw" ? "openclaw" : "paddy";
  const url = typeof obj.url === "string" ? obj.url : "";
  const model = typeof obj.model === "string" ? obj.model : "";
  return { runtime, url, model };
}

export type OpenClawProbeResult =
  | { ok: true; detail: string; status: number; endpoint: string }
  | { ok: false; error: string; status?: number; endpoint?: string };

export async function probeOpenClawHealth(opts: {
  url: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OpenClawProbeResult> {
  const base = normalizeOpenClawUrl(opts.url);
  if (!base) {
    return { ok: false, error: "Enter a valid OpenClaw gateway URL (http:// or https://)." };
  }
  const token = (opts.token ?? "").trim();
  const endpoints = buildOpenClawHealthUrls(base);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? OPENCLAW_PROBE_TIMEOUT_MS;
  let lastError = "No health endpoint responded.";

  for (const endpoint of endpoints) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(endpoint, {
        method: "GET",
        headers,
        signal: ctrl.signal,
        redirect: "manual",
      });
      if (res.ok) {
        let body = "";
        try {
          body = (await res.text()).trim().slice(0, 120);
        } catch {
          body = "";
        }
        const detail = sanitizeOpenClawProbeText(
          body ? `HTTP ${res.status} · ${body}` : `HTTP ${res.status} · live`,
          token,
        );
        return { ok: true, detail, status: res.status, endpoint };
      }
      lastError = sanitizeOpenClawProbeText(`HTTP ${res.status} from ${endpoint}`, token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = sanitizeOpenClawProbeText(
        msg.toLowerCase().includes("abort") ? `Timed out after ${timeoutMs}ms` : msg,
        token,
      );
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: lastError };
}

export function hostedOpenClawDemoNote(): string {
  return "Hosted preview stays on runtime “paddy” + SuperGrok. OpenClaw loopback is non-functional here — self-host with `paddy gateway` to attach an OpenClaw URL.";
}
