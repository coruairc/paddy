import { test } from "node:test";
import assert from "node:assert/strict";
import { rotateKey, shouldFailover } from "./failover.ts";

test("429 and 402 failover, other statuses do not", () => {
  assert.equal(shouldFailover(429), true);
  assert.equal(shouldFailover(402), true);
  assert.equal(shouldFailover(401), false);
  assert.equal(shouldFailover(500), false);
});

test("rotateKey walks a same-provider pool", () => {
  const pool = ["sk-a", "sk-b", "sk-c"];
  const once = rotateKey("sk-a", pool);
  assert.equal(once?.key, "sk-b");
  const twice = rotateKey("sk-b", pool);
  assert.equal(twice?.key, "sk-c");
  const done = rotateKey("sk-c", pool);
  assert.equal(done, null);
});
