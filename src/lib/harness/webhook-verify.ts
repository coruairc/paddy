/**
 * Provider webhook authenticity checks.
 * Fail closed: missing secrets or bad signatures reject before inbound runs.
 * Never synthesize PADDY_CLI_TOKEN for unsigned traffic.
 *
 * Secrets come from process env / ~/.paddy/.env (loaded by the gateway):
 *   WHATSAPP_APP_SECRET | META_APP_SECRET
 *   TELEGRAM_WEBHOOK_SECRET | TELEGRAM_SECRET_TOKEN
 *   SLACK_SIGNING_SECRET
 *   DISCORD_PUBLIC_KEY (HTTP interactions not implemented — use bridge)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex");
    const right = Buffer.from(b, "hex");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function safeEqualUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** WhatsApp Cloud API: X-Hub-Signature-256 = sha256=<hmac_hex(app_secret, rawBody)> */
export function verifyWhatsappSignature(rawBody: string, headers: Headers): WebhookVerifyResult {
  const appSecret = env("WHATSAPP_APP_SECRET") || env("META_APP_SECRET");
  if (!appSecret) {
    return {
      ok: false,
      status: 401,
      error: "WhatsApp webhook requires WHATSAPP_APP_SECRET (Meta app secret). Refusing unsigned POST.",
    };
  }
  const header = (headers.get("x-hub-signature-256") ?? "").trim();
  const prefix = "sha256=";
  if (!header.toLowerCase().startsWith(prefix)) {
    return { ok: false, status: 401, error: "Missing or invalid X-Hub-Signature-256." };
  }
  const theirs = header.slice(prefix.length).trim().toLowerCase();
  const ours = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (!safeEqualHex(ours, theirs)) {
    return { ok: false, status: 401, error: "WhatsApp signature mismatch." };
  }
  return { ok: true };
}

/** Telegram: X-Telegram-Bot-Api-Secret-Token must match TELEGRAM_WEBHOOK_SECRET. */
export function verifyTelegramSecret(headers: Headers): WebhookVerifyResult {
  const want = env("TELEGRAM_WEBHOOK_SECRET") || env("TELEGRAM_SECRET_TOKEN");
  if (!want) {
    return {
      ok: false,
      status: 401,
      error:
        "Telegram HTTP webhook requires TELEGRAM_WEBHOOK_SECRET. Prefer paddy-bridge long-poll.",
    };
  }
  const got = (headers.get("x-telegram-bot-api-secret-token") ?? "").trim();
  if (!got || !safeEqualUtf8(got, want)) {
    return { ok: false, status: 401, error: "Telegram webhook secret mismatch." };
  }
  return { ok: true };
}

/** Slack: v0=<hmac_sha256(signing_secret, "v0:ts:body")> in X-Slack-Signature. */
export function verifySlackSignature(rawBody: string, headers: Headers): WebhookVerifyResult {
  const secret = env("SLACK_SIGNING_SECRET");
  if (!secret) {
    return {
      ok: false,
      status: 401,
      error: "Slack HTTP webhook requires SLACK_SIGNING_SECRET. Prefer Slack Socket Mode via paddy-bridge.",
    };
  }
  const ts = (headers.get("x-slack-request-timestamp") ?? "").trim();
  const sig = (headers.get("x-slack-signature") ?? "").trim();
  if (!ts || !sig) {
    return { ok: false, status: 401, error: "Missing Slack signature headers." };
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > 60 * 5) {
    return { ok: false, status: 401, error: "Slack request timestamp too old." };
  }
  const base = `v0:${ts}:${rawBody}`;
  const digest = createHmac("sha256", secret).update(base, "utf8").digest("hex");
  const ours = `v0=${digest}`;
  const left = Buffer.from(ours);
  const right = Buffer.from(sig);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, status: 401, error: "Slack signature mismatch." };
  }
  return { ok: true };
}

/**
 * Discord Interactions require Ed25519 over timestamp+body with the application
 * public key. Until implemented, refuse HTTP webhooks — paddy-bridge uses Gateway WS.
 */
export function verifyDiscordInteraction(_rawBody: string, _headers: Headers): WebhookVerifyResult {
  return {
    ok: false,
    status: 501,
    error: "Discord HTTP interaction verify is not implemented yet; use paddy-bridge.",
  };
}

export function verifyChannelWebhook(
  channelId: string,
  rawBody: string,
  headers: Headers,
): WebhookVerifyResult {
  switch (channelId) {
    case "whatsapp":
      return verifyWhatsappSignature(rawBody, headers);
    case "telegram":
      return verifyTelegramSecret(headers);
    case "slack":
      return verifySlackSignature(rawBody, headers);
    case "discord":
      return verifyDiscordInteraction(rawBody, headers);
    case "signal":
    case "email":
      return {
        ok: false,
        status: 401,
        error: `${channelId} HTTP webhooks are not accepted; use paddy-bridge.`,
      };
    default:
      return { ok: false, status: 404, error: "Unknown channel." };
  }
}
