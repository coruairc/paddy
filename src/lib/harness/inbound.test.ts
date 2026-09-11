import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapUntrusted, untrustedToken } from "./untrusted.ts";
import { normalizeInbound, toCliInboundBody, type NormalizedInbound } from "./inbound.ts";

const CHANNELS = ["telegram", "discord", "slack", "signal", "email"] as const;

const FIXTURES: Record<(typeof CHANNELS)[number], unknown> = {
  telegram: {
    message: {
      text: "hello paddy",
      from: { id: 111, username: "ada" },
      chat: { id: 111, type: "private" },
    },
  },
  discord: {
    content: "hello paddy",
    author: { id: "222", username: "ada" },
    channel_id: "c1",
  },
  slack: {
    event: { type: "message", user: "U333", text: "hello paddy", channel: "D1" },
  },
  signal: {
    envelope: { sourceNumber: "+353", dataMessage: { message: "hello paddy" } },
  },
  email: { from: "ada@example.com", subject: "hi", text: "hello paddy" },
};

function assertContract(channelId: string, inbound: NormalizedInbound | null) {
  assert.ok(inbound, `${channelId} produced no inbound`);
  assert.equal(inbound!.channelId, channelId);
  assert.equal(inbound!.message, "hello paddy");
  assert.ok(inbound!.fromId);
  const wrapped = wrapUntrusted(inbound!.message, inbound!.channelId, inbound!.from);
  assert.ok(untrustedToken(wrapped));
  assert.match(wrapped, /EXTERNAL_UNTRUSTED_CONTENT/);
  assert.match(wrapped, /hello paddy/);
}

for (const channel of CHANNELS) {
  test(`contract: ${channel} webhook normalizes to Helix inbound`, () => {
    assertContract(channel, normalizeInbound(channel, FIXTURES[channel]));
  });
}

test("contract: whatsapp cloud payload normalizes the same way", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from: "353", type: "text", text: { body: "hello paddy" } }],
            },
          },
        ],
      },
    ],
  };
  assertContract("whatsapp", normalizeInbound("whatsapp", payload));
});

test("contract: three channels independently produce the same CLI inbound action", () => {
  for (const channel of ["telegram", "discord", "slack"] as const) {
    const body = toCliInboundBody(channel, FIXTURES[channel]);
    assert.ok(body, `${channel} produced no CLI body`);
    assert.equal(body!.action, "inbound");
    assert.equal(body!.channelId, channel);
    assert.equal(body!.message, "hello paddy");
    assert.ok(body!.fromId);
  }
});
