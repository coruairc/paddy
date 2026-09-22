import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigFields,
  buildSetupFields,
  fallbackConfigSchema,
  isWriteOnlySecretPath,
  MEMORY_SCHEMA_DEFAULTS,
  parseFieldInput,
  SETUP_SECTIONS,
  valueForField,
} from "./config-panel.ts";

test("fallback schema is version const 1", () => {
  const schema = fallbackConfigSchema();
  assert.equal(schema.properties?.version?.const, 1);
});

test("buildConfigFields marks writeOnly token; memory is runtime SoT", () => {
  const fields = buildConfigFields(fallbackConfigSchema());
  const token = fields.find((f) => f.path === "gateway.auth.token");
  assert.equal(token?.writeOnly, true);
  assert.equal(token?.kind, "password");
  const mem = fields.find((f) => f.path === "agents.defaults.memory.memoryCharLimit");
  assert.equal(mem?.notRuntimeSot, false);
  assert.equal(mem?.defaultValue, MEMORY_SCHEMA_DEFAULTS.memoryCharLimit);
});

test("valueForField uses schema memory defaults when unset", () => {
  const fields = buildConfigFields(null);
  const field = fields.find((f) => f.path === "agents.defaults.memory.recallLimit")!;
  assert.equal(valueForField({}, field), MEMORY_SCHEMA_DEFAULTS.recallLimit);
  assert.equal(valueForField({ agents: { defaults: { memory: { recallLimit: 8 } } } }, field), 8);
});

test("parseFieldInput coerces numbers and booleans", () => {
  assert.equal(parseFieldInput("number", "2200"), 2200);
  assert.equal(parseFieldInput("boolean", "true"), true);
  assert.equal(parseFieldInput("string", "supergrok"), "supergrok");
});

test("SETUP_SECTIONS locks Backend configure contract order and ids", () => {
  assert.deepEqual(
    SETUP_SECTIONS.map((s) => s.id),
    ["workspace", "model", "gateway", "channels", "memory", "skills", "health", "done"],
  );
  const ids = SETUP_SECTIONS.map((s) => s.id as string);
  assert.ok(!ids.includes("plugins") && !ids.includes("daemon"));
  const gateway = SETUP_SECTIONS.find((s) => s.id === "gateway")!;
  assert.deepEqual(gateway.paths, ["gateway.host", "gateway.port", "gateway.auth.token"]);
  const memory = SETUP_SECTIONS.find((s) => s.id === "memory")!;
  assert.ok(memory.paths.every((p) => p.startsWith("agents.defaults.memory")));
});

test("buildSetupFields groups by section; skills form-only; token writeOnly", () => {
  const schema = fallbackConfigSchema();
  const gw = buildSetupFields(schema, "gateway");
  assert.equal(gw.length, 3);
  assert.equal(gw.find((f) => f.path === "gateway.auth.token")?.writeOnly, true);
  assert.equal(gw.find((f) => f.path === "gateway.auth.token")?.kind, "password");

  const skills = buildSetupFields(schema, "skills");
  assert.deepEqual(
    skills.map((f) => f.path),
    ["skills.load.extraDirs", "skills.allow"],
  );
  assert.ok(skills.every((f) => f.notRuntimeSot));
  assert.ok(skills.every((f) => f.kind === "json"));

  assert.deepEqual(buildSetupFields(schema, "health"), []);
  assert.deepEqual(buildSetupFields(schema, "done"), []);

  const ws = buildSetupFields(schema, "workspace");
  assert.equal(ws[0]?.path, "agents.defaults.workspace");
  assert.equal(ws[0]?.kind, "string");
});

test("isWriteOnlySecretPath never treats memory or brain as secrets", () => {
  assert.equal(isWriteOnlySecretPath("gateway.auth.token"), true);
  assert.equal(isWriteOnlySecretPath("cli.token"), true);
  assert.equal(isWriteOnlySecretPath("brain.preferred"), false);
  assert.equal(isWriteOnlySecretPath("agents.defaults.memory.enabled"), false);
});

test("valueForField never echoes writeOnly token from config", () => {
  const fields = buildSetupFields(fallbackConfigSchema(), "gateway");
  const token = fields.find((f) => f.path === "gateway.auth.token")!;
  assert.equal(
    valueForField({ gateway: { auth: { token: "should-not-leak" } }, cli: { token: "nor-this" } }, token),
    "",
  );
});
