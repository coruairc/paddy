import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  verifyChannelWebhook,
  verifySlackSignature,
  verifyTelegramSecret,
  verifyWhatsappSignature,
} from "./webhook-verify.ts";

test("whatsapp rejects when app secret missing", () => {
  const prev = process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.META_APP_SECRET;
  try {
    const r = verifyWhatsappSignature("{}", new Headers());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 401);
  } finally {
    if (prev !== undefined) process.env.WHATSAPP_APP_SECRET = prev;
  }
});

test("whatsapp accepts valid X-Hub-Signature-256", () => {
  const prev = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "app-secret";
  try {
    const body = '{"ok":true}';
    const hex = createHmac("sha256", "app-secret").update(body, "utf8").digest("hex");
    const headers = new Headers({ "x-hub-signature-256": `sha256=${hex}` });
    assert.equal(verifyWhatsappSignature(body, headers).ok, true);
    assert.equal(verifyWhatsappSignature(body, new Headers({ "x-hub-signature-256": "sha256=dead" })).ok, false);
  } finally {
    if (prev === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = prev;
  }
});

test("telegram rejects without secret and accepts matching header", () => {
  const prev = process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_SECRET_TOKEN;
  try {
    assert.equal(verifyTelegramSecret(new Headers()).ok, false);
    process.env.TELEGRAM_WEBHOOK_SECRET = "tg-secret";
    assert.equal(
      verifyTelegramSecret(new Headers({ "x-telegram-bot-api-secret-token": "tg-secret" })).ok,
      true,
    );
    assert.equal(
      verifyTelegramSecret(new Headers({ "x-telegram-bot-api-secret-token": "nope" })).ok,
      false,
    );
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = prev;
  }
});

test("slack rejects unsigned and accepts valid signature", () => {
  const prev = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = "slack-secret";
  try {
    const body = '{"type":"event_callback"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const base = `v0:${ts}:${body}`;
    const digest = createHmac("sha256", "slack-secret").update(base, "utf8").digest("hex");
    const headers = new Headers({
      "x-slack-request-timestamp": ts,
      "x-slack-signature": `v0=${digest}`,
    });
    assert.equal(verifySlackSignature(body, headers).ok, true);
    assert.equal(verifySlackSignature(body, new Headers()).ok, false);
  } finally {
    if (prev === undefined) delete process.env.SLACK_SIGNING_SECRET;
    else process.env.SLACK_SIGNING_SECRET = prev;
  }
});

test("generic channel hook fails closed for signal/email", () => {
  const r = verifyChannelWebhook("signal", "{}", new Headers());
  assert.equal(r.ok, false);
});
