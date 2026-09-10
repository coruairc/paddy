import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { helpText, parseArgv, loadDotEnv, kitRoot, VERSION } from "./paddy.mjs";

const bin = join(kitRoot(), "bin/paddy.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("help lists gateway, chat, models, doctor", () => {
  const text = helpText();
  for (const needle of [
    "paddy gateway",
    "paddy gateway start",
    "paddy chat",
    "paddy models",
    "paddy doctor",
    "paddy onboard",
    "paddy dashboard",
  ]) {
    assert.match(text, new RegExp(needle.replace(/ /g, "\\s+")));
  }
});

test("parseArgv extracts flags and rest", () => {
  const { flags, rest } = parseArgv([
    "--port",
    "9090",
    "--host",
    "0.0.0.0",
    "gateway",
    "status",
    "--json",
  ]);
  assert.equal(flags.port, 9090);
  assert.equal(flags.host, "0.0.0.0");
  assert.equal(flags.json, true);
  assert.deepEqual(rest, ["gateway", "status"]);
});

test("parseArgv rejects unknown flags", () => {
  assert.throws(() => parseArgv(["--nope"]), /Unknown flag/);
});

test("loadDotEnv skips comments and quotes", () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-env-"));
  const file = join(dir, ".env");
  writeFileSync(
    file,
    `# hi\nXAI_API_KEY="sk-test"\nEMPTY=\n# comment\nPOOLSIDE_API_KEY=abc\n`,
  );
  const env = loadDotEnv(file);
  assert.equal(env.XAI_API_KEY, "sk-test");
  assert.equal(env.POOLSIDE_API_KEY, "abc");
  assert.equal(env.EMPTY, "");
});

test("paddy --help exits 0 and mentions gateway", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /paddy gateway/);
});

test("paddy --version prints semver", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION);
});

test("unknown command exits 2", () => {
  const r = run(["blorp"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown command/);
});

test("onboard --yes writes ~/.paddy and copies env", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  const r = run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, true);
  assert.equal(existsSync(join(home, "config.json")), true);
  const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.ok(cfg.token.length >= 16);
  assert.equal(cfg.port, 8080);
});

test("doctor --json reports kit and home", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  run(["onboard", "--yes", "--json"], { PADDY_HOME: home });
  const r = run(["doctor", "--json"], { PADDY_HOME: home });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const payload = JSON.parse(r.stdout);
  const names = payload.checks.map((c) => c.name);
  assert.ok(names.includes("node"));
  assert.ok(names.includes("kit"));
  assert.ok(names.includes("home"));
});

test("agent list includes paddy", () => {
  const r = run(["agent", "list", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.agents[0].id, "paddy");
});
