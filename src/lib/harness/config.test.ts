/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — exercises config.mjs; assertions are the contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACCESS_MODES,
  SCHEMA_VERSION,
  accountToChannel,
  atomicWrite,
  channelToAccount,
  detectImportConflicts,
  exportToLineage,
  extractChannelSecrets,
  importFromLineage,
  interpolate,
  isEnvRef,
  loadCanonical,
  loadResolvedAccounts,
  mergeImportedAccounts,
  migrateFromLegacy,
  redactConfig,
  redactValue,
  removeCanonicalChannel,
  saveCanonical,
  upsertCanonicalChannel,
  validateCanonical,
} from "./config.mjs";

function home() {
  return mkdtempSync(join(tmpdir(), "paddy-cfg-"));
}

test("fresh install creates versioned config.json", () => {
  const dir = home();
  const { config } = loadCanonical({ home: dir, persist: true });
  assert.equal(config.version, SCHEMA_VERSION);
  assert.equal(config.gateway.port, 8080);
  assert.equal(existsSync(join(dir, "config.json")), true);
  const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(disk.version, 1);
  assert.deepEqual(disk.channels, {});
});

test("validateCanonical rejects bad port and access mode", () => {
  const badPort = validateCanonical({ version: 1, gateway: { host: "127.0.0.1", port: 0 }, channels: {} });
  assert.equal(badPort.ok, false);
  assert.match(badPort.errors.join(" "), /port/);
  const badMode = validateCanonical({
    version: 1,
    gateway: { host: "h", port: 8080 },
    channels: { telegram: { enabled: true, access: { mode: "friends" } } },
  });
  assert.equal(badMode.ok, false);
  assert.match(badMode.errors.join(" "), /access.mode/);
  const ok = validateCanonical({ version: 1, gateway: { host: "h", port: 9 }, channels: {} });
  assert.equal(ok.ok, true);
});

test("malformed JSON throws a useful error", () => {
  const dir = home();
  writeFileSync(join(dir, "config.json"), "{ not json");
  assert.throws(() => loadCanonical({ home: dir, persist: false }), /Malformed JSON/);
});

test("atomicWrite replaces the target and leaves no tmp", () => {
  const dir = home();
  const path = join(dir, "config.json");
  atomicWrite(path, '{"a":1}\n');
  atomicWrite(path, '{"a":2}\n');
  assert.equal(JSON.parse(readFileSync(path, "utf8")).a, 2);
  const leftovers = readdirSync(dir).filter((n) => n.includes(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("interpolate expands ${ENV} and missing refs become empty", () => {
  assert.equal(interpolate("x${TELEGRAM_BOT_TOKEN}y", { TELEGRAM_BOT_TOKEN: "123:abc" }), "x123:abcy");
  assert.equal(interpolate("${MISSING}", {}), "");
  assert.equal(isEnvRef("${TELEGRAM_BOT_TOKEN}"), true);
  assert.equal(isEnvRef("123:abc"), false);
});

test("secrets are extracted to .env and referenced from config.json", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel(
    "telegram",
    { token: "111:AAA", dmPolicy: "pairing", allowFrom: [], requireMention: true },
    dir,
  );
  const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(disk.channels.telegram.token, "${TELEGRAM_BOT_TOKEN}");
  assert.equal(disk.channels.telegram.access.mode, "pairing");
  const env = readFileSync(join(dir, ".env"), "utf8");
  assert.match(env, /TELEGRAM_BOT_TOKEN=111:AAA/);
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "111:AAA");
});

test("redactConfig never prints tokens", () => {
  const redacted = redactConfig({
    channels: { telegram: { token: "111:SUPERSECRET", access: { mode: "pairing" } } },
  });
  assert.doesNotMatch(JSON.stringify(redacted), /SUPERSECRET/);
  assert.equal(redactValue("${TELEGRAM_BOT_TOKEN}"), "${TELEGRAM_BOT_TOKEN}");
});

test("Telegram pairing / allowlist / open and multiple users", () => {
  for (const mode of ACCESS_MODES) {
    const ch = accountToChannel("telegram", {
      token: "${TELEGRAM_BOT_TOKEN}",
      dmPolicy: mode,
      allowFrom: ["1", "2", "3"],
    });
    assert.equal(ch.access.mode, mode);
    assert.deepEqual(ch.access.users, ["1", "2", "3"]);
    const acc = channelToAccount("telegram", ch, { TELEGRAM_BOT_TOKEN: "t" });
    assert.equal(acc.dmPolicy, mode);
    assert.deepEqual(acc.allowFrom, ["1", "2", "3"]);
  }
});

test("Discord Slack WhatsApp Signal Email round-trip through the canonical shape", () => {
  const samples = {
    discord: { token: "MTI.bot", dmPolicy: "pairing", allowFrom: [] },
    slack: { token: "xoxb-1", appToken: "xapp-1", dmPolicy: "allowlist", allowFrom: ["U1"] },
    whatsapp: {
      token: "EAA",
      phoneId: "99",
      verifyToken: "sec",
      dmPolicy: "pairing",
      allowFrom: [],
    },
    signal: { host: "http://127.0.0.1:8080", number: "+1555", dmPolicy: "open", allowFrom: [] },
    email: {
      host: "imap.gmail.com",
      user: "a@b.c",
      pass: "app-pass",
      from: "paddy@b.c",
      dmPolicy: "allowlist",
      allowFrom: ["a@b.c"],
    },
  };
  for (const [id, acc] of Object.entries(samples)) {
    const ch = accountToChannel(id, acc);
    const extracted = extractChannelSecrets(id, ch);
    assert.ok(extracted.channel.token === undefined || isEnvRef(extracted.channel.token) || id === "signal" || id === "email");
    const back = channelToAccount(id, extracted.channel, {
      DISCORD_BOT_TOKEN: "MTI.bot",
      SLACK_BOT_TOKEN: "xoxb-1",
      SLACK_APP_TOKEN: "xapp-1",
      WHATSAPP_TOKEN: "EAA",
      WHATSAPP_VERIFY_TOKEN: "sec",
      SIGNAL_HTTP_URL: "http://127.0.0.1:8080",
      SIGNAL_ACCOUNT: "+1555",
      IMAP_PASS: "app-pass",
    });
    if (id === "discord") assert.equal(back.token, "MTI.bot");
    if (id === "slack") {
      assert.equal(back.token, "xoxb-1");
      assert.equal(back.appToken, "xapp-1");
      assert.equal(back.dmPolicy, "allowlist");
    }
    if (id === "whatsapp") {
      assert.equal(back.token, "EAA");
      assert.equal(back.phoneId, "99");
      assert.equal(back.verifyToken, "sec");
    }
    if (id === "signal") {
      assert.equal(back.host, "http://127.0.0.1:8080");
      assert.equal(back.number, "+1555");
      assert.equal(back.dmPolicy, "open");
    }
    if (id === "email") {
      assert.equal(back.pass, "app-pass");
      assert.equal(back.user, "a@b.c");
    }
  }
});

test("migrate from previous Paddy config.json + channels.json", () => {
  const migrated = migrateFromLegacy(
    { port: 9090, host: "0.0.0.0", token: "cli-secret-token-value", preferredProvider: "laguna" },
    {
      channelsFile: {
        accounts: {
          telegram: { token: "tg:old", dmPolicy: "allowlist", allowFrom: ["42"], requireMention: true },
        },
        pending: [],
      },
      env: {},
    },
  );
  assert.equal(migrated.config.gateway.port, 9090);
  assert.equal(migrated.config.gateway.host, "0.0.0.0");
  assert.equal(migrated.config.brain.preferred, "laguna");
  assert.equal(migrated.config.cli.token, "${PADDY_CLI_TOKEN}");
  assert.equal(migrated.envPatch.PADDY_CLI_TOKEN, "cli-secret-token-value");
  assert.equal(migrated.config.channels.telegram.token, "${TELEGRAM_BOT_TOKEN}");
  assert.equal(migrated.envPatch.TELEGRAM_BOT_TOKEN, "tg:old");
  assert.equal(migrated.config.channels.telegram.access.mode, "allowlist");
  assert.deepEqual(migrated.config.channels.telegram.access.users, ["42"]);
});

test("OpenClaw import then export is semantically equivalent", () => {
  const root = home();
  const dir = join(root, ".paddy");
  mkdirSync(join(root, ".openclaw"));
  writeFileSync(
    join(root, ".openclaw", "openclaw.json"),
    `{
      channels: {
        telegram: { enabled: true, botToken: "oc:tok", dmPolicy: "pairing", allowFrom: ["99"] },
        discord: { token: "disc.tok", dmPolicy: "allowlist", allowFrom: ["1"] }
      }
    }\n`,
  );
  const result = importFromLineage({ home: dir, source: "openclaw", rootHome: root, replace: ["telegram", "discord"] });
  assert.equal(result.ok, true);
  assert.ok(result.imported.includes("telegram"));
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "oc:tok");
  assert.equal(accounts.telegram.dmPolicy, "pairing");
  assert.deepEqual(accounts.telegram.allowFrom, ["99"]);
  const paths = exportToLineage("openclaw", { home: dir, rootHome: root });
  const written = readFileSync(paths[0], "utf8");
  assert.match(written, /oc:tok/);
  assert.match(written, /pairing/);
  assert.match(written, /disc\.tok/);
});

test("Hermes import then export preserves TELEGRAM_BOT_TOKEN and allow list", () => {
  const root = home();
  const dir = join(root, ".paddy");
  mkdirSync(join(root, ".hermes"));
  writeFileSync(
    join(root, ".hermes", ".env"),
    "TELEGRAM_BOT_TOKEN=hm:tok\nTELEGRAM_ALLOWED_USERS=1,2\nDISCORD_BOT_TOKEN=d.tok\n",
  );
  const result = importFromLineage({ home: dir, source: "hermes", rootHome: root, replace: ["telegram", "discord"] });
  assert.equal(result.ok, true);
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "hm:tok");
  assert.equal(accounts.telegram.dmPolicy, "allowlist");
  assert.deepEqual(accounts.telegram.allowFrom, ["1", "2"]);
  exportToLineage("hermes", { home: dir, rootHome: root });
  const env = readFileSync(join(root, ".hermes", ".env"), "utf8");
  assert.match(env, /TELEGRAM_BOT_TOKEN=hm:tok/);
  assert.match(env, /TELEGRAM_ALLOWED_USERS=1,2/);
});

test("export --to both writes OpenClaw JSON and Hermes env without changing Paddy config", () => {
  const root = home();
  const dir = join(root, ".paddy");
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "both:tok", dmPolicy: "open", allowFrom: [] }, dir);
  const before = readFileSync(join(dir, "config.json"), "utf8");
  mkdirSync(join(root, ".openclaw"));
  mkdirSync(join(root, ".hermes"));
  const paths = exportToLineage("both", { home: dir, rootHome: root });
  assert.equal(paths.length, 2);
  assert.equal(readFileSync(join(dir, "config.json"), "utf8"), before);
  assert.match(readFileSync(join(root, ".openclaw", "openclaw.json"), "utf8"), /both:tok/);
  assert.match(readFileSync(join(root, ".hermes", ".env"), "utf8"), /TELEGRAM_BOT_TOKEN=both:tok/);
});

test("conflicting imports are detected and not applied until replace", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "mine:tok", dmPolicy: "pairing", allowFrom: [] }, dir);
  const current = loadCanonical({ home: dir, persist: false }).config.channels;
  const incoming = { telegram: { token: "theirs:tok", dmPolicy: "allowlist", allowFrom: ["1"] } };
  const conflicts = detectImportConflicts(current, incoming, { TELEGRAM_BOT_TOKEN: "mine:tok" });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].id, "telegram");
  const skipped = mergeImportedAccounts(current, incoming, { replace: [] });
  assert.deepEqual(skipped.skipped, ["telegram"]);
  const replaced = mergeImportedAccounts(current, incoming, { replace: ["telegram"] });
  assert.ok(replaced.imported.includes("telegram"));
  assert.equal(replaced.channels.telegram.access.mode, "allowlist");
});

test("missing environment variables resolve to empty credentials", () => {
  const acc = channelToAccount(
    "telegram",
    { enabled: true, token: "${TELEGRAM_BOT_TOKEN}", access: { mode: "pairing", users: [] } },
    {},
  );
  assert.equal(acc.token, undefined);
});

test("invalid configuration is rejected on save", () => {
  const dir = home();
  assert.throws(
    () =>
      saveCanonical(
        { version: 1, gateway: { host: "h", port: 99999 }, channels: {} },
        { home: dir },
      ),
    /Invalid Paddy config/,
  );
});

test("preserve unknown future fields", () => {
  const dir = home();
  const cfg = {
    version: 1,
    gateway: { host: "127.0.0.1", port: 8080, extraBind: "tailscale" },
    cli: { token: "${PADDY_CLI_TOKEN}" },
    brain: { preferred: "supergrok" },
    kit: {},
    channels: {},
    plugins: { experimental: true },
  };
  saveCanonical(cfg, { home: dir });
  const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(disk.gateway.extraBind, "tailscale");
  assert.equal(disk.plugins.experimental, true);
});

test("removeCanonicalChannel drops the channel from config.json", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("discord", { token: "d.tok", dmPolicy: "pairing", allowFrom: [] }, dir);
  removeCanonicalChannel("discord", dir);
  const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(disk.channels.discord, undefined);
});

test("runtime accounts come from config.json without channels.json", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel(
    "telegram",
    { token: "111:AAA", dmPolicy: "pairing", allowFrom: ["7"], requireMention: true },
    dir,
  );
  assert.equal(existsSync(join(dir, "channels.json")), false);
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "111:AAA");
  assert.deepEqual(accounts.telegram.allowFrom, ["7"]);
});

test("Gateway save path (upsert) is what runtime loadResolvedAccounts reads", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel(
    "slack",
    { token: "xoxb-g", appToken: "xapp-g", dmPolicy: "allowlist", allowFrom: ["U1"] },
    dir,
  );
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.slack.token, "xoxb-g");
  assert.equal(accounts.slack.appToken, "xapp-g");
  assert.equal(accounts.slack.dmPolicy, "allowlist");
  const disk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
  assert.equal(disk.channels.slack.token, "${SLACK_BOT_TOKEN}");
  assert.equal(disk.channels.slack.appToken, "${SLACK_APP_TOKEN}");
});

test("identical import is not a conflict", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "same:tok", dmPolicy: "pairing", allowFrom: ["1"] }, dir);
  const current = loadCanonical({ home: dir, persist: false }).config.channels;
  const conflicts = detectImportConflicts(
    current,
    { telegram: { token: "same:tok", dmPolicy: "pairing", allowFrom: ["1"] } },
    { TELEGRAM_BOT_TOKEN: "same:tok" },
  );
  assert.equal(conflicts.length, 0);
});

test("non-conflicting additional channel imports without touching the existing one", () => {
  const root = home();
  const dir = join(root, ".paddy");
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "mine:tok", dmPolicy: "pairing", allowFrom: [] }, dir);
  mkdirSync(join(root, ".openclaw"));
  writeFileSync(
    join(root, ".openclaw", "openclaw.json"),
    `{ channels: { discord: { token: "disc.tok", dmPolicy: "pairing" } } }\n`,
  );
  const result = importFromLineage({ home: dir, source: "openclaw", rootHome: root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);
  assert.ok(result.imported.includes("discord"));
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "mine:tok");
  assert.equal(accounts.discord.token, "disc.tok");
});

test("conflicting access policy is a conflict", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "same:tok", dmPolicy: "pairing", allowFrom: [] }, dir);
  const current = loadCanonical({ home: dir, persist: false }).config.channels;
  const conflicts = detectImportConflicts(
    current,
    { telegram: { token: "same:tok", dmPolicy: "allowlist", allowFrom: [] } },
    { TELEGRAM_BOT_TOKEN: "same:tok" },
  );
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /access mode/);
});

test("conflicting allowed users is a conflict", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "same:tok", dmPolicy: "allowlist", allowFrom: ["1"] }, dir);
  const current = loadCanonical({ home: dir, persist: false }).config.channels;
  const conflicts = detectImportConflicts(
    current,
    { telegram: { token: "same:tok", dmPolicy: "allowlist", allowFrom: ["2"] } },
    { TELEGRAM_BOT_TOKEN: "same:tok" },
  );
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /allowed users/);
  const skipped = mergeImportedAccounts(current, {
    telegram: { token: "same:tok", dmPolicy: "allowlist", allowFrom: ["2"] },
  }, { replace: [] });
  assert.deepEqual(skipped.skipped, ["telegram"]);
});

test("mixed conflicts: one channel conflicts, another imports", () => {
  const root = home();
  const dir = join(root, ".paddy");
  loadCanonical({ home: dir, persist: true });
  upsertCanonicalChannel("telegram", { token: "mine:tok", dmPolicy: "pairing", allowFrom: [] }, dir);
  mkdirSync(join(root, ".hermes"));
  writeFileSync(
    join(root, ".hermes", ".env"),
    "TELEGRAM_BOT_TOKEN=theirs:tok\nDISCORD_BOT_TOKEN=d.tok\n",
  );
  const result = importFromLineage({ home: dir, source: "hermes", rootHome: root });
  assert.equal(result.ok, true);
  assert.ok(result.conflicts.some((c) => c.id === "telegram"));
  assert.ok(result.imported.includes("discord"));
  assert.ok(result.skipped.includes("telegram"));
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "mine:tok");
  assert.equal(accounts.discord.token, "d.tok");
});

test("OpenClaw import then runtime accounts match without channels.json", () => {
  const root = home();
  const dir = join(root, ".paddy");
  mkdirSync(join(root, ".openclaw"));
  writeFileSync(
    join(root, ".openclaw", "openclaw.json"),
    `{ channels: { telegram: { enabled: true, botToken: "oc-rt:tok", dmPolicy: "pairing", allowFrom: ["9"] } } }\n`,
  );
  const result = importFromLineage({ home: dir, source: "openclaw", rootHome: root, replace: ["telegram"] });
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(dir, "channels.json")), false);
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "oc-rt:tok");
  assert.deepEqual(accounts.telegram.allowFrom, ["9"]);
});

test("Hermes import then runtime accounts match without channels.json", () => {
  const root = home();
  const dir = join(root, ".paddy");
  mkdirSync(join(root, ".hermes"));
  writeFileSync(
    join(root, ".hermes", ".env"),
    "TELEGRAM_BOT_TOKEN=hm-rt:tok\nTELEGRAM_ALLOWED_USERS=3,4\n",
  );
  const result = importFromLineage({ home: dir, source: "hermes", rootHome: root, replace: ["telegram"] });
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(dir, "channels.json")), false);
  const accounts = loadResolvedAccounts(dir);
  assert.equal(accounts.telegram.token, "hm-rt:tok");
  assert.equal(accounts.telegram.dmPolicy, "allowlist");
  assert.deepEqual(accounts.telegram.allowFrom, ["3", "4"]);
});
