import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { linkCli } from "./link-cli.mjs";

test("linkCli writes a paddy wrapper, never npx", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-bin-"));
  const prev = process.env.PADDY_BIN_DIR;
  process.env.PADDY_BIN_DIR = dir;
  try {
    const { dest } = linkCli();
    assert.equal(existsSync(dest), true);
    const body = readFileSync(dest, "utf8");
    assert.match(body, /bin\/paddy\.mjs/);
    assert.doesNotMatch(body, /npx/);
  } finally {
    if (prev === undefined) delete process.env.PADDY_BIN_DIR;
    else process.env.PADDY_BIN_DIR = prev;
  }
});

test("postinstall script exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-bin-"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "link-cli.mjs")], {
    encoding: "utf8",
    env: { ...process.env, PADDY_BIN_DIR: dir },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /paddy →/);
});
