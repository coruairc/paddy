/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — exercises configure-wizard.mjs against the live config writers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIGURE_SECTIONS,
  applyConfigureSection,
  applyGatewayAuthToken,
  configureHealthCheck,
  isWriteOnlySecretPath,
  parseConfigureSections,
  sectionRoutes,
  wizardSchema,
} from "./configure-wizard.mjs";
import { loadCanonical, configGet } from "./config.mjs";

function tempHome() {
  return mkdtempSync(join(tmpdir(), "paddy-configure-"));
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
