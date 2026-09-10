import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const sh = join(import.meta.dirname, "install.sh");

function run(args, env = {}) {
  return spawnSync("bash", [sh, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("install.sh --help mentions curl, powershell, and paddy gateway", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  for (const needle of [
    "paddy gateway",
    "install.sh | bash",
    "install.ps1",
    "--no-onboard",
    "curl -fsSL",
  ]) {
    assert.match(r.stdout, new RegExp(needle.replace(/[|]/g, "\\|")));
  }
});

test("install.sh unknown flag exits 1", () => {
  const r = run(["--nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag/);
});

test("install.sh --dry-run prints clone and wrapper without writing src", () => {
  const r = run(["--dry-run", "--no-onboard", "--git-dir", "/tmp/paddy-dry-src"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /\[dry-run\] git clone/);
  assert.match(r.stdout, /\[dry-run\] npm install/);
  assert.match(r.stdout, /\[dry-run\] write /);
  assert.match(r.stdout, /Paddy installed successfully, Sláinte🍀/);
  assert.match(r.stdout, /paddy gateway/);
});

test("install copies stay in sync", () => {
  const root = readFileSync(sh, "utf8");
  assert.equal(readFileSync(join(import.meta.dirname, "public/install.sh"), "utf8"), root);
  assert.equal(readFileSync(join(import.meta.dirname, "docs/install.sh"), "utf8"), root);
  const ps1 = readFileSync(join(import.meta.dirname, "install.ps1"), "utf8");
  assert.equal(readFileSync(join(import.meta.dirname, "public/install.ps1"), "utf8"), ps1);
  assert.equal(readFileSync(join(import.meta.dirname, "docs/install.ps1"), "utf8"), ps1);
  assert.match(ps1, /Paddy installed successfully, Sláinte🍀/);
});

