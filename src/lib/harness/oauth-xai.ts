const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const SCOPE = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const XAI_VERIFY_URL = "https://auth.x.ai/oauth2/device";

const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

export type XaiTokens = {
  access: string;
  refresh: string;
  expires: number;
};

type Pending = {
  deviceCode: string;
  userCode: string;
  intervalMs: number;
  expiresAt: number;
};

const pending = new Map<string, Pending>();

export async function startXaiDevice(): Promise<{
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Could not start SuperGrok sign-in (${res.status}). ${text.slice(0, 180) || "Try an xAI API key."}`,
    );
  }
  const body = JSON.parse(text) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  };
  if (!body.device_code || !body.user_code) {
    throw new Error("xAI did not return a device code.");
  }
  const sessionId = crypto.randomUUID();
  pending.set(sessionId, {
    deviceCode: body.device_code,
    userCode: body.user_code,
    intervalMs: Math.max(3, body.interval ?? 5) * 1000,
    expiresAt: Date.now() + (body.expires_in ?? 900) * 1000,
  });
  return {
    sessionId,
    userCode: body.user_code,
    verificationUrl: body.verification_uri_complete || body.verification_uri || XAI_VERIFY_URL,
    expiresIn: body.expires_in ?? 900,
  };
}

export async function pollXaiDevice(
  sessionId: string,
): Promise<{ status: "pending" } | { status: "ready"; tokens: XaiTokens } | { status: "expired" }> {
  const sess = pending.get(sessionId);
  if (!sess) return { status: "expired" };
  if (Date.now() > sess.expiresAt) {
    pending.delete(sessionId);
    return { status: "expired" };
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      grant_type: DEVICE_GRANT,
      device_code: sess.deviceCode,
      client_id: CLIENT_ID,
    }),
  });
  const text = await res.text();
  let body: {
    error?: string;
    error_description?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    /* ignore */
  }
  if (body.access_token) {
    pending.delete(sessionId);
    return {
      status: "ready",
      tokens: {
        access: body.access_token,
        refresh: body.refresh_token ?? "",
        expires: Date.now() + (body.expires_in ?? 3600) * 1000,
      },
    };
  }
  const err = body.error ?? "";
  if (err === "expired_token" || err === "access_denied") {
    pending.delete(sessionId);
    throw new Error(
      err === "access_denied" ? "SuperGrok sign-in was denied." : "SuperGrok code expired. Start again.",
    );
  }
  if (err === "authorization_pending" || err === "slow_down" || res.status === 400) {
    return { status: "pending" };
  }
  throw new Error(body.error_description || err || `SuperGrok pairing failed (${res.status}).`);
}

export async function refreshXaiToken(refresh: string): Promise<XaiTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error("SuperGrok session expired. Sign in again in Models.");
  }
  const body = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!body.access_token) throw new Error("xAI returned no access token.");
  return {
    access: body.access_token,
    refresh: body.refresh_token || refresh,
    expires: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export function isXaiAccess(token?: string): boolean {
  const t = (token ?? "").trim();
  if (!t || t.startsWith("xai-")) return false;
  return t.length > 20;
}
