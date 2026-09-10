const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH = "https://auth.openai.com";
const USERCODE_URL = `${AUTH}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH}/api/accounts/deviceauth/token`;
const OAUTH_TOKEN_URL = `${AUTH}/oauth/token`;
const CALLBACK = `${AUTH}/deviceauth/callback`;
export const CODEX_VERIFY_URL = `${AUTH}/codex/device`;
const CODEX_API = "https://chatgpt.com/backend-api/codex";

// Public Codex CLI client_id — same path OpenClaw uses. Originator must match
// what chatgpt.com/backend-api/codex expects for that client.
const HEADERS = {
  "Content-Type": "application/json",
  originator: "codex_cli_rs",
  "User-Agent": "Paddy/1.0",
};

export type CodexTokens = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

type Pending = {
  deviceAuthId: string;
  userCode: string;
  expiresAt: number;
};

const pending = new Map<string, Pending>();

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...HEADERS, ...extra };
}

export async function startCodexDevice(): Promise<{
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}> {
  const res = await fetch(USERCODE_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Device-code login is off for this ChatGPT account. Enable it in ChatGPT → Settings → Security, or paste an API key."
        : `Could not start ChatGPT sign-in (${res.status}). ${text.slice(0, 180)}`,
    );
  }
  const body = JSON.parse(text) as {
    device_auth_id?: string;
    user_code?: string;
    usercode?: string;
    interval?: string | number;
    expires_at?: string;
  };
  const userCode = body.user_code || body.usercode || "";
  const deviceAuthId = body.device_auth_id || "";
  if (!userCode || !deviceAuthId) {
    throw new Error("ChatGPT did not return a device code.");
  }
  const sessionId = crypto.randomUUID();
  pending.set(sessionId, {
    deviceAuthId,
    userCode,
    expiresAt: Date.now() + 15 * 60_000,
  });
  return {
    sessionId,
    userCode,
    verificationUrl: CODEX_VERIFY_URL,
    expiresIn: 900,
  };
}

export async function pollCodexDevice(
  sessionId: string,
): Promise<{ status: "pending" } | { status: "ready"; tokens: CodexTokens } | { status: "expired" }> {
  const sess = pending.get(sessionId);
  if (!sess) return { status: "expired" };
  if (Date.now() > sess.expiresAt) {
    pending.delete(sessionId);
    return { status: "expired" };
  }
  const res = await fetch(DEVICE_TOKEN_URL, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      device_auth_id: sess.deviceAuthId,
      user_code: sess.userCode,
    }),
  });
  if (res.status === 403 || res.status === 404) {
    return { status: "pending" };
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`ChatGPT pairing failed (${res.status}). ${text.slice(0, 180)}`);
  }
  const body = JSON.parse(text) as {
    authorization_code?: string;
    code_verifier?: string;
  };
  if (!body.authorization_code || !body.code_verifier) {
    return { status: "pending" };
  }
  const tokens = await exchangeCode(body.authorization_code, body.code_verifier);
  pending.delete(sessionId);
  return { status: "ready", tokens };
}

async function exchangeCode(code: string, verifier: string): Promise<CodexTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      originator: "codex_cli_rs",
      "User-Agent": "Paddy/1.0",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}). ${text.slice(0, 180)}`);
  }
  return parseTokenResponse(text);
}

export async function refreshCodexToken(refresh: string): Promise<CodexTokens> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      originator: "codex_cli_rs",
      "User-Agent": "Paddy/1.0",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("ChatGPT session expired. Pair again in Models.");
  }
  return parseTokenResponse(text);
}

function parseTokenResponse(text: string): CodexTokens {
  const body = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("ChatGPT returned no access token.");
  return {
    access: body.access_token,
    refresh: body.refresh_token ?? "",
    expires: Date.now() + (body.expires_in ?? 3600) * 1000,
    accountId: accountIdFromJwt(body.access_token),
  };
}

export function accountIdFromJwt(token: string): string | undefined {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(part, "base64url").toString("utf8")
        : atob(pad);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const nested = payload["https://api.openai.com/auth"];
    if (nested && typeof nested === "object") {
      const id = (nested as Record<string, unknown>).chatgpt_account_id;
      if (typeof id === "string") return id;
    }
    if (typeof payload.chatgpt_account_id === "string") return payload.chatgpt_account_id;
  } catch {
    /* ignore */
  }
  return undefined;
}

export function isCodexAccess(token?: string): boolean {
  const t = (token ?? "").trim();
  return t.startsWith("eyJ") && t.length > 40;
}

export { CODEX_API };
