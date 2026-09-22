import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigFields,
  fallbackConfigSchema,
  MEMORY_SCHEMA_DEFAULTS,
  parseFieldInput,
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
