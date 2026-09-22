/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — exercises configure-wizard.mjs against the live config writers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BRAIN_PROVIDER_CATALOG,
  CONFIGURE_SECTIONS,
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  applyBrainModelSelection,
  applyConfigureSection,
  applyGatewayAuthToken,
  brainModelMenuOptions,
  brainProviderMenuOptions,
  configureHealthCheck,
  filterMenuOptions,
  isWriteOnlySecretPath,
  parseConfigureSections,
  promptSecret,
  runModelSection,
  selectMenu,
  sectionRoutes,
  wizardSchema,
} from "./configure-wizard.mjs";
import { createInterface } from "node:readline/promises";
import { EventEmitter } from "node:events";
import { loadCanonical, configGet, configSet } from "./config.mjs";
import { brainModelSelectionWrite } from "./setup-model-picker.ts";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "paddy-configure-"));
}


async function waitForDataListener(stdin, timeoutMs = 500) {
  const start = Date.now();
  while (stdin.listenerCount("data") === 0) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for stdin data listener");
    await new Promise((r) => setImmediate(r));
  }
}

async function typeKeys(stdin, chars) {
  await waitForDataListener(stdin);
  for (const ch of chars) stdin.emit("data", ch);
}

async function pressEnter(stdin) {
  await waitForDataListener(stdin);
  stdin.emit("data", "\r");
}


test("configure sections exclude Plugins/Daemon and cover persisted surfaces", () => {
  const ids = CONFIGURE_SECTIONS.map((s) => s.id);
  assert.deepEqual(ids, [
    "workspace",
    "model",
    "gateway",
    "channels",
    "memory",
    "skills",
    "health",
    "done",
  ]);
  assert.ok(!ids.includes("plugins"));
  assert.ok(!ids.includes("daemon"));
});

test("parseConfigureSections routes known ids and reports invalid", () => {
  const parsed = parseConfigureSections(["model", "Plugins", "gateway", "daemon"]);
  assert.deepEqual(parsed.sections, ["model", "gateway"]);
  assert.deepEqual(parsed.invalid, ["plugins", "daemon"]);
});

test("sectionRoutes maps model/gateway to canonical paths", () => {
  assert.deepEqual(sectionRoutes("model")?.paths, ["brain.preferred", "brain.model"]);
  assert.deepEqual(sectionRoutes("gateway")?.paths, [
    "gateway.host",
    "gateway.port",
    "gateway.auth.token",
  ]);
  assert.equal(sectionRoutes("plugins"), null);
});

test("wizardSchema is the one canonical schema (includes workspace + writeOnly token)", () => {
  const schema = wizardSchema();
  assert.equal(schema.title, "PaddyConfig");
  assert.ok(schema.properties.agents.properties.defaults.properties.workspace);
  const token = schema.properties.gateway.properties.auth.properties.token;
  assert.equal(token.writeOnly, true);
  assert.ok(isWriteOnlySecretPath("gateway.auth.token"));
  assert.ok(isWriteOnlySecretPath("cli.token"));
  assert.equal(isWriteOnlySecretPath("brain.preferred"), false);
});

test("applyGatewayAuthToken never writes plaintext into config.json", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  const secret = "WIZARD-SECRET-TOKEN-ABCDEF012345";
  applyGatewayAuthToken(secret, { home });

  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.gateway?.auth, undefined);
  assert.equal(disk.cli?.token, "${PADDY_CLI_TOKEN}");
  assert.equal(JSON.stringify(disk).includes(secret), false);

  const env = readFileSync(join(home, ".env"), "utf8");
  assert.match(env, /PADDY_CLI_TOKEN=/);
  assert.ok(env.includes(secret));

  const got = configGet("gateway.auth.token", { home });
  assert.equal(got.value, "${PADDY_CLI_TOKEN}");
  assert.equal(got.aliasedTo, "cli.token");
});

test("applyConfigureSection routes workspace/model/memory/skills through configSet", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });

  applyConfigureSection("workspace", { workspace: "/tmp/paddy-ws" }, { home });
  applyConfigureSection(
    "model",
    { preferred: "supergrok", model: "grok-4" },
    { home },
  );
  applyConfigureSection(
    "memory",
    {
      enabled: true,
      memoryCharLimit: 2200,
      userCharLimit: 1375,
      recallLimit: 8,
      fts: true,
    },
    { home },
  );
  applyConfigureSection(
    "skills",
    { extraDirs: "/opt/skills, ~/more", allow: "alpha, beta" },
    { home },
  );

  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.agents.defaults.workspace, "/tmp/paddy-ws");
  assert.equal(disk.brain.preferred, "supergrok");
  assert.equal(disk.brain.model, "grok-4");
  assert.deepEqual(disk.agents.defaults.memory, {
    enabled: true,
    memoryCharLimit: 2200,
    userCharLimit: 1375,
    recallLimit: 8,
    fts: true,
  });
  assert.deepEqual(disk.skills.load.extraDirs, ["/opt/skills", "~/more"]);
  assert.deepEqual(disk.skills.allow, ["alpha", "beta"]);
});

test("applyConfigureSection gateway token uses hardened secret path", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  const secret = "GATEWAY-SECTION-SECRET-999";
  applyConfigureSection(
    "gateway",
    { host: "0.0.0.0", port: 9090, token: secret },
    { home },
  );
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.gateway.host, "0.0.0.0");
  assert.equal(disk.gateway.port, 9090);
  assert.equal(disk.gateway.auth, undefined);
  assert.equal(JSON.stringify(disk).includes(secret), false);
  assert.ok(readFileSync(join(home, ".env"), "utf8").includes(secret));
});

test("configureHealthCheck reports redacted gateway token status", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  applyGatewayAuthToken("HEALTH-CHECK-SECRET-TOKEN", { home });
  const report = configureHealthCheck({ home });
  assert.equal(report.ok, true);
  assert.equal(report.gateway.auth, "token");
  assert.match(String(report.gateway.token), /set|redacted/i);
  assert.equal(JSON.stringify(report).includes("HEALTH-CHECK-SECRET-TOKEN"), false);
});

test("temp home config.json exists after loadCanonical persist", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  assert.equal(existsSync(join(home, "config.json")), true);
});

test("promptSecret mutes echo when setRawMode is available", async () => {
  const written = [];
  let raw = false;
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (v) => {
    raw = Boolean(v);
    stdin.isRaw = raw;
    return stdin;
  };
  stdin.resume = () => stdin;
  stdin.pause = () => stdin;
  stdin.off = EventEmitter.prototype.off;
  stdin.on = EventEmitter.prototype.on;
  stdin.removeListener = EventEmitter.prototype.removeListener;

  const stdout = {
    isTTY: true,
    write(chunk) {
      written.push(String(chunk));
      return true;
    },
  };

  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  // pause/resume stubs used by promptSecret
  rl.pause = () => {};
  rl.resume = () => {};

  const pending = promptSecret(rl, "Gateway auth token");
  // Allow listener registration
  await new Promise((r) => setImmediate(r));
  assert.equal(raw, true);
  stdin.emit("data", "s");
  stdin.emit("data", "e");
  stdin.emit("data", "c");
  stdin.emit("data", "r");
  stdin.emit("data", "e");
  stdin.emit("data", "t");
  stdin.emit("data", "\r");
  const value = await pending;
  assert.equal(value, "secret");
  const joined = written.join("");
  assert.equal(joined.includes("secret"), false);
  assert.ok(joined.includes("Gateway auth token"));
  assert.equal(raw, false);
  rl.close();
});

test("selectMenu restores stdin for a following readline prompt", async () => {
  let raw = false;
  let paused = true;
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (v) => {
    raw = Boolean(v);
    stdin.isRaw = raw;
    return stdin;
  };
  stdin.isPaused = () => paused;
  stdin.resume = () => {
    paused = false;
    return stdin;
  };
  stdin.pause = () => {
    paused = true;
    return stdin;
  };

  const stdout = {
    isTTY: true,
    write() {
      return true;
    },
  };

  const selected = selectMenu([{ value: "workspace", label: "Workspace" }], {
    stdin,
    stdout,
  });
  await new Promise((resolve) => setImmediate(resolve));
  stdin.emit("data", "\r");

  assert.equal(await selected, "workspace");
  assert.equal(raw, false);
  assert.equal(stdin.isPaused(), false);
  assert.equal(stdin.listenerCount("data"), 0);

  const rl = createInterface({ input: stdin, output: stdout, terminal: false });
  const answer = rl.question("Workspace path: ");
  await new Promise((resolve) => setImmediate(resolve));
  stdin.emit("data", "/tmp/workspace\r\n");
  assert.equal(await answer, "/tmp/workspace");
  rl.close();
});

test("filterMenuOptions type-to-search matches label hint and value", () => {
  const options = [
    { value: "supergrok", label: "SuperGrok", hint: "Sign-in · xAI" },
    { value: "claude", label: "Claude", hint: "Sign-in · Anthropic" },
    { value: "openrouter", label: "OpenRouter", hint: "Gateways · many models" },
  ];
  assert.deepEqual(
    filterMenuOptions(options, "claude").map((o) => o.value),
    ["claude"],
  );
  assert.deepEqual(
    filterMenuOptions(options, "gateways").map((o) => o.value),
    ["openrouter"],
  );
  assert.deepEqual(
    filterMenuOptions(options, "SUPER").map((o) => o.value),
    ["supergrok"],
  );
  assert.equal(filterMenuOptions(options, "zzz").length, 0);
  assert.equal(filterMenuOptions(options, "").length, 3);
});

test("brain catalog mirrors providers and menu rows include Back", () => {
  assert.ok(BRAIN_PROVIDER_CATALOG.length >= 10);
  assert.ok(BRAIN_PROVIDER_CATALOG.some((p) => p.id === "supergrok"));
  assert.ok(BRAIN_PROVIDER_CATALOG.some((p) => p.id === "claude"));
  const providers = brainProviderMenuOptions({ currentPreferred: "supergrok" });
  assert.ok(providers.some((o) => o.value === MENU_KEEP));
  assert.equal(providers.at(-1)?.value, MENU_BACK);
  const models = brainModelMenuOptions("claude", { currentModel: "claude-opus-4-5" });
  assert.equal(models[0]?.value, MENU_DEFAULT_MODEL);
  assert.ok(models.some((o) => o.value === "claude-sonnet-4-5"));
  assert.equal(models.at(-1)?.value, MENU_BACK);
});

test("selectMenu searchable filter then Enter selects filtered row", async () => {
  let raw = false;
  let paused = true;
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (v) => {
    raw = Boolean(v);
    stdin.isRaw = raw;
    return stdin;
  };
  stdin.isPaused = () => paused;
  stdin.resume = () => {
    paused = false;
    return stdin;
  };
  stdin.pause = () => {
    paused = true;
    return stdin;
  };

  const stdout = {
    isTTY: true,
    write() {
      return true;
    },
  };

  const pending = selectMenu(
    [
      { value: "supergrok", label: "SuperGrok", hint: "xAI" },
      { value: "claude", label: "Claude", hint: "Anthropic" },
      { value: "gemini", label: "Gemini", hint: "Google" },
    ],
    { stdin, stdout, searchable: true, message: "Pick provider" },
  );
  await new Promise((r) => setImmediate(r));
  stdin.emit("data", "c");
  stdin.emit("data", "l");
  stdin.emit("data", "a");
  await new Promise((r) => setImmediate(r));
  stdin.emit("data", "\r");
  assert.equal(await pending, "claude");
  assert.equal(raw, false);
  assert.equal(stdin.listenerCount("data"), 0);
});

test("runModelSection provider→model→confirm writes brain.preferred and brain.model", async () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });

  let raw = false;
  let paused = true;
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (v) => {
    raw = Boolean(v);
    stdin.isRaw = raw;
    return stdin;
  };
  stdin.isPaused = () => paused;
  stdin.resume = () => {
    paused = false;
    return stdin;
  };
  stdin.pause = () => {
    paused = true;
    return stdin;
  };
  const stdout = {
    isTTY: true,
    write() {
      return true;
    },
  };
  const logs = [];

  const pending = runModelSection({
    home,
    log: (line) => logs.push(line),
    stdin,
    stdout,
  });

  await typeKeys(stdin, "claude");
  await pressEnter(stdin);

  await typeKeys(stdin, "haiku");
  await pressEnter(stdin);

  await pressEnter(stdin); // Confirm Save

  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.preferred, "claude");
  assert.equal(result.model, "claude-haiku-4-5");
  assert.equal(raw, false);

  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "claude");
  assert.equal(disk.brain.model, "claude-haiku-4-5");
  assert.ok(logs.some((l) => /Brain: claude/.test(l)));
});

test("runModelSection Back on provider skips writes", async () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  applyConfigureSection("model", { preferred: "supergrok", model: "grok-4" }, { home });

  let paused = true;
  const stdin = new EventEmitter();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = (v) => {
    stdin.isRaw = Boolean(v);
    return stdin;
  };
  stdin.isPaused = () => paused;
  stdin.resume = () => {
    paused = false;
    return stdin;
  };
  stdin.pause = () => {
    paused = true;
    return stdin;
  };
  const stdout = {
    isTTY: true,
    write() {
      return true;
    },
  };

  const pending = runModelSection({
    home,
    log: () => {},
    stdin,
    stdout,
  });
  await typeKeys(stdin, "back");
  await pressEnter(stdin);
  const result = await pending;
  assert.equal(result.skipped, true);
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "supergrok");
  assert.equal(disk.brain.model, "grok-4");
});

test("applyBrainModelSelection writes preferred+model in one merge configSet", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  applyConfigureSection("model", { preferred: "supergrok", model: "grok-4" }, { home });

  const result = applyBrainModelSelection(
    { preferred: "claude", model: "claude-haiku-4-5" },
    { home },
  );
  assert.equal(result.ok, true);
  assert.equal(result.path, "brain");
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "claude");
  assert.equal(disk.brain.model, "claude-haiku-4-5");
});

test("failed atomic brain write leaves prior preferred+model unchanged", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  applyConfigureSection("model", { preferred: "supergrok", model: "grok-4" }, { home });

  // Same one-shot shape as applyBrainModelSelection / brainModelSelectionWrite,
  // but with a non-string model so validateCanonical rejects before save.
  assert.throws(
    () => configSet("brain", { preferred: "claude", model: 12345 }, { home, merge: true }),
    /brain\.model|Invalid Paddy config/,
  );

  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "supergrok");
  assert.equal(disk.brain.model, "grok-4");
});

test("applyBrainModelSelection rejects empty preferred without touching disk", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  applyConfigureSection("model", { preferred: "supergrok", model: "grok-4" }, { home });

  assert.throws(
    () => applyBrainModelSelection({ preferred: "  ", model: "x" }, { home }),
    /brain\.preferred/,
  );
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "supergrok");
  assert.equal(disk.brain.model, "grok-4");
});

test("applyConfigureSection model uses atomic brain write (not two path sets)", () => {
  const home = tempHome();
  loadCanonical({ home, persist: true });
  const result = applyConfigureSection(
    "model",
    { preferred: "claude", model: "claude-sonnet-4-5" },
    { home },
  );
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].path, "brain");
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "claude");
  assert.equal(disk.brain.model, "claude-sonnet-4-5");
});

test("brainModelSelectionWrite payload matches applyBrainModelSelection configSet shape", () => {
  const payload = brainModelSelectionWrite({ preferred: "claude", model: "claude-opus-4-5" });
  assert.deepEqual(payload, {
    path: "brain",
    value: { preferred: "claude", model: "claude-opus-4-5" },
    merge: true,
  });
  const home = tempHome();
  loadCanonical({ home, persist: true });
  configSet(payload.path, payload.value, { home, merge: payload.merge });
  const disk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.equal(disk.brain.preferred, "claude");
  assert.equal(disk.brain.model, "claude-opus-4-5");
});
