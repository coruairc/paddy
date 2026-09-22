/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase C: turn preference SoT without importing resolveBrain (node ESM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configSet,
  loadCanonical,
  resolveOpenClawRuntime,
  turnBrainPreference,
} from "./config.mjs";

function home() {
  return mkdtempSync(join(tmpdir(), "paddy-turn-pref-"));
}

/**
 * Mirrors resolveTurnBrainRoute preference selection (OpenClaw vs turnBrainPreference).
 * Kept local so node:test does not need to load brain.ts (extensionless Vite imports).
 */
function pickTurnPreferred(
  data: { preferredProvider?: string; preferredModel?: string },
  opts?: { home?: string },
) {
  const oc = resolveOpenClawRuntime({ home: opts?.home });
  if (oc.active) {
    return { kind: "openclaw" as const, url: oc.url, model: oc.model };
  }
  const brain = turnBrainPreference({
    preferred: data.preferredProvider,
    model: data.preferredModel,
    home: opts?.home,
  });
  return { kind: "paddy" as const, preferred: brain.preferred, model: brain.model };
}

test("configure brain.preferred is what turn preference uses when payload omits it", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  configSet("brain", { preferred: "claude", model: "claude-opus-4" }, { home: dir, merge: true });
  const picked = pickTurnPreferred({}, { home: dir });
  assert.equal(picked.kind, "paddy");
  if (picked.kind !== "paddy") return;
  assert.equal(picked.preferred, "claude");
  assert.equal(picked.model, "claude-opus-4");
});

test("no silent hardcoded supergrok when config has another preferred", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  configSet("brain", { preferred: "qwen", model: "qwen-plus" }, { home: dir, merge: true });
  // GUI Phase C: send.ts omits preferredProvider — same as undefined override
  const picked = pickTurnPreferred({ preferredProvider: undefined }, { home: dir });
  assert.equal(picked.kind, "paddy");
  if (picked.kind !== "paddy") return;
  assert.equal(picked.preferred, "qwen");
  assert.notEqual(picked.preferred, "supergrok");
});

test("openclaw.runtime=openclaw still wins over brain.preferred (Phase B)", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  configSet("brain", { preferred: "claude", model: "claude-opus-4" }, { home: dir, merge: true });
  configSet("openclaw.runtime", "openclaw", { home: dir });
  configSet("openclaw.url", "http://127.0.0.1:18789", { home: dir });
  const picked = pickTurnPreferred({ preferredProvider: "claude" }, { home: dir });
  assert.equal(picked.kind, "openclaw");
  if (picked.kind !== "openclaw") return;
  assert.equal(picked.url, "http://127.0.0.1:18789");
});

test("CLI-style preferredProvider override still works when runtime is paddy", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  configSet("brain", { preferred: "qwen", model: "qwen-plus" }, { home: dir, merge: true });
  const picked = pickTurnPreferred(
    { preferredProvider: "claude", preferredModel: "claude-sonnet-4" },
    { home: dir },
  );
  assert.equal(picked.kind, "paddy");
  if (picked.kind !== "paddy") return;
  assert.equal(picked.preferred, "claude");
  assert.equal(picked.model, "claude-sonnet-4");
});
