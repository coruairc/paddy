import { test } from "node:test";
import assert from "node:assert/strict";
import { CODEX_MODELS, resolveCodexModel } from "./providers.ts";

test("Codex ChatGPT accounts never send the chat slug gpt-5.6", () => {
  assert.equal(resolveCodexModel("gpt-5.6"), "gpt-5.5");
  assert.equal(resolveCodexModel("gpt-5"), "gpt-5.5");
  assert.equal(resolveCodexModel("gpt-5.1"), "gpt-5.5");
  assert.equal(resolveCodexModel("o3"), "gpt-5.5");
  assert.equal(resolveCodexModel("o4-mini"), "gpt-5.4-mini");
  assert.equal(resolveCodexModel("gpt-5.6-sol-pro"), "gpt-5.6-sol");
});

test("explicit Codex slugs pass through", () => {
  assert.equal(resolveCodexModel("gpt-5.5"), "gpt-5.5");
  assert.equal(resolveCodexModel("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(resolveCodexModel("gpt-5.6-terra"), "gpt-5.6-terra");
  assert.equal(resolveCodexModel("gpt-5.4"), "gpt-5.4");
  assert.equal(resolveCodexModel(""), "gpt-5.5");
  assert.equal(resolveCodexModel("not-a-model"), "gpt-5.5");
});

test("ChatGPT provider catalog has no bare gpt-5.6", () => {
  assert.equal(CODEX_MODELS.some((m) => m.id === "gpt-5.6"), false);
  assert.ok(CODEX_MODELS.some((m) => m.id === "gpt-5.5"));
});
