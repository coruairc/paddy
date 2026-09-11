import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountConfigured,
  defaultAccount,
  mentionedIn,
  pairingCode,
  senderAllowed,
} from "./channels.ts";

test("pairingCode is 4 chars from the alphabet", () => {
  const code = pairingCode();
  assert.equal(code.length, 4);
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
});

test("senderAllowed pairing asks unknown senders to pair", () => {
  const acc = { ...defaultAccount(), dmPolicy: "pairing" as const, allowFrom: ["111"] };
  assert.equal(senderAllowed(acc, "111"), "allow");
  assert.equal(senderAllowed(acc, "222"), "pair");
});

test("senderAllowed open lets anyone in", () => {
  const acc = { ...defaultAccount(), dmPolicy: "open" as const, allowFrom: [] };
  assert.equal(senderAllowed(acc, "999"), "allow");
});

test("senderAllowed allowlist denies strangers", () => {
  const acc = { ...defaultAccount(), dmPolicy: "allowlist" as const, allowFrom: ["111"] };
  assert.equal(senderAllowed(acc, "222"), "deny");
});

test("mentionedIn finds a bot handle", () => {
  assert.equal(mentionedIn("hey @paddy_bot look", ["@paddy_bot", "Paddy"]), true);
  assert.equal(mentionedIn("hello there", ["@paddy_bot"]), false);
});

test("accountConfigured matches each bridge", () => {
  assert.equal(accountConfigured("telegram", { ...defaultAccount(), token: "123:abc" }), true);
  assert.equal(accountConfigured("slack", { ...defaultAccount(), token: "xoxb" }), false);
  assert.equal(
    accountConfigured("slack", { ...defaultAccount(), token: "xoxb", appToken: "xapp" }),
    true,
  );
  assert.equal(
    accountConfigured("whatsapp", { ...defaultAccount(), token: "EAA", phoneId: "1" }),
    true,
  );
});
