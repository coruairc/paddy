import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeHermesEnvText,
  mergeOpenClawText,
  parseHermesEnv,
  parseJson5,
  parseOpenClawChannels,
  summarizeImported,
} from "./lineage.mjs";

type Acc = {
  token?: string;
  appToken?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  host?: string;
};
type AccMap = Record<string, Acc | undefined>;

test("parseJson5 strips comments and trailing commas", () => {
  const doc = parseJson5(`{
    // telegram
    channels: {
      telegram: { botToken: "123:abc", dmPolicy: "pairing", },
    },
  }`) as { channels: { telegram: { botToken: string } } };
  assert.equal(doc.channels.telegram.botToken, "123:abc");
});

test("parseOpenClawChannels reads telegram botToken and allowFrom", () => {
  const accounts = parseOpenClawChannels(`{
    channels: {
      telegram: {
        enabled: true,
        botToken: "111:AAA",
        dmPolicy: "pairing",
        allowFrom: ["tg:99"],
        groups: { "*": { requireMention: true } }
      },
      discord: { token: "MTI.bot" }
    }
  }`) as AccMap;
  assert.equal(accounts.telegram?.token, "111:AAA");
  assert.equal(accounts.telegram?.dmPolicy, "pairing");
  assert.deepEqual(accounts.telegram?.allowFrom, ["tg:99"]);
  assert.equal(accounts.discord?.token, "MTI.bot");
});

test("parseOpenClawChannels skips disabled channels", () => {
  const accounts = parseOpenClawChannels(`{
    channels: { telegram: { enabled: false, botToken: "x" } }
  }`) as AccMap;
  assert.equal(accounts.telegram, undefined);
});

test("parseHermesEnv maps TELEGRAM_BOT_TOKEN and allow list", () => {
  const accounts = parseHermesEnv(`
TELEGRAM_BOT_TOKEN=123:hermes
TELEGRAM_ALLOWED_USERS=42, 99
DISCORD_BOT_TOKEN=disc
SLACK_BOT_TOKEN=xoxb-1
SLACK_APP_TOKEN=xapp-1
`) as AccMap;
  assert.equal(accounts.telegram?.token, "123:hermes");
  assert.deepEqual(accounts.telegram?.allowFrom, ["42", "99"]);
  assert.equal(accounts.telegram?.dmPolicy, "allowlist");
  assert.equal(accounts.slack?.appToken, "xapp-1");
});

test("GATEWAY_ALLOW_ALL_USERS opens DMs", () => {
  const accounts = parseHermesEnv(`TELEGRAM_BOT_TOKEN=t\nGATEWAY_ALLOW_ALL_USERS=true\n`) as AccMap;
  assert.equal(accounts.telegram?.dmPolicy, "open");
});

test("mergeOpenClawText writes botToken without dropping other keys", () => {
  const next = mergeOpenClawText(
    `{ agents: { defaults: { workspace: "~/.openclaw/workspace" } }, channels: { telegram: { extra: 1 } } }`,
    { telegram: { token: "9:z", dmPolicy: "pairing", allowFrom: ["1"], requireMention: true } },
  );
  const doc = parseJson5(next) as {
    agents: { defaults: { workspace: string } };
    channels: { telegram: { botToken: string; extra: number; enabled: boolean } };
  };
  assert.equal(doc.agents.defaults.workspace, "~/.openclaw/workspace");
  assert.equal(doc.channels.telegram.botToken, "9:z");
  assert.equal(doc.channels.telegram.extra, 1);
  assert.equal(doc.channels.telegram.enabled, true);
});

test("mergeHermesEnvText upserts tokens and keeps unrelated keys", () => {
  const next = mergeHermesEnvText("OPENROUTER_API_KEY=sk\nTELEGRAM_BOT_TOKEN=old\n", {
    telegram: { token: "new:tok", allowFrom: ["7"] },
  });
  assert.match(next, /OPENROUTER_API_KEY=sk/);
  assert.match(next, /TELEGRAM_BOT_TOKEN=new:tok/);
  assert.match(next, /TELEGRAM_ALLOWED_USERS=7/);
});

test("summarizeImported lists connected ids", () => {
  const rows = summarizeImported({
    telegram: { token: "a", dmPolicy: "pairing", allowFrom: [] },
  }) as { id: string; hasToken: boolean }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "telegram");
  assert.equal(rows[0].hasToken, true);
});
