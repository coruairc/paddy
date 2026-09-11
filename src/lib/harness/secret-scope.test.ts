import { test } from "node:test";
import assert from "node:assert/strict";
import {
  secret,
  secretsForProfile,
  splitKeyPool,
  withSecretScope,
  currentSecretScope,
} from "./secret-scope.ts";

test("secret() without a scope reads process.env", () => {
  const prev = process.env.PADDY_SCOPE_TEST;
  process.env.PADDY_SCOPE_TEST = "from-env";
  try {
    assert.equal(secret("PADDY_SCOPE_TEST"), "from-env");
  } finally {
    if (prev === undefined) delete process.env.PADDY_SCOPE_TEST;
    else process.env.PADDY_SCOPE_TEST = prev;
  }
});

test("an active scope is fail-closed against process.env", () => {
  const prev = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "process-key";
  try {
    withSecretScope({ OPENROUTER_API_KEY: "profile-a" }, () => {
      assert.equal(secret("OPENROUTER_API_KEY"), "profile-a");
      assert.equal(secret("XAI_API_KEY"), "");
      assert.deepEqual(currentSecretScope()?.OPENROUTER_API_KEY, "profile-a");
    });
    assert.equal(secret("XAI_API_KEY"), "process-key");
  } finally {
    if (prev === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prev;
  }
});

test("nested scopes restore the outer bag", () => {
  withSecretScope({ A: "1" }, () => {
    assert.equal(secret("A"), "1");
    withSecretScope({ A: "2", B: "inner" }, () => {
      assert.equal(secret("A"), "2");
      assert.equal(secret("B"), "inner");
    });
    assert.equal(secret("A"), "1");
    assert.equal(secret("B"), "");
  });
});

test("secretsForProfile prefers profile keys over env", () => {
  const bag = secretsForProfile(
    { openrouter: "sk-profile", xai: "" },
    { OPENROUTER_API_KEY: "sk-env", XAI_API_KEY: "xai-env" } as NodeJS.ProcessEnv,
  );
  assert.equal(bag.OPENROUTER_API_KEY, "sk-profile");
  assert.equal(bag.XAI_API_KEY, "xai-env");
});

test("splitKeyPool splits comma and newline lists", () => {
  assert.deepEqual(splitKeyPool("a, b\nc"), ["a", "b", "c"]);
  assert.deepEqual(splitKeyPool("  "), []);
});
