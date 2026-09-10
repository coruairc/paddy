#!/usr/bin/env node
/**
 * Paddy CLI — same control plane as `openclaw gateway` / `hermes gateway`.
 *
 *   paddy gateway          run in the foreground
 *   paddy gateway start    background
 *   paddy chat "…"         one-shot (gateway must be up)
 *
 * Talks to the local gateway over HTTP. Keys come from the gateway env
 * (selfhost.env), not from the browser's localStorage.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as stdinStream, stdout as stdoutStream } from "node:process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

export const VERSION = "0.1.0";
const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "127.0.0.1";

export function kitRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function paddyHome() {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

function homePath(...parts) {
  return join(paddyHome(), ...parts);
}

export function parseArgv(argv) {
  const flags = {
    port: undefined,
    host: undefined,
    json: false,
    help: false,
    version: false,
    yes: false,
    prefer: undefined,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--version" || a === "-V") flags.version = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--port") flags.port = Number(argv[++i]);
    else if (a?.startsWith("--port=")) flags.port = Number(a.slice(7));
    else if (a === "--host") flags.host = argv[++i];
    else if (a?.startsWith("--host=")) flags.host = a.slice(7);
    else if (a === "--prefer") flags.prefer = argv[++i];
    else if (a?.startsWith("--prefer=")) flags.prefer = a.slice(9);
    else if (a === "--") rest.push(...argv.slice(i + 1));
    else if (a?.startsWith("-") && a !== "-") {
      throw new Error(`Unknown flag ${a}`);
    } else if (a) rest.push(a);
  }
  if (flags.port != null && (!Number.isFinite(flags.port) || flags.port < 1 || flags.port > 65535)) {
    throw new Error(" --port must be 1–65535");
  }
  return { flags, rest };
}

export function helpText() {
  return `Paddy — Irish-roots super harness  v${VERSION}

Usage:
  paddy <command> [flags]

Gateway
  paddy gateway              Run the gateway in the foreground
  paddy gateway start        Start in the background
  paddy gateway stop         Stop the background gateway
  paddy gateway restart      Restart the background gateway
  paddy gateway status       Is the gateway up?

Talk
  paddy chat                 Interactive REPL (gateway must be running)
  paddy chat "message"       One-shot turn
  paddy dashboard            Open the web console
  paddy models               List brains the gateway can see
  paddy models prefer <id>   Remember a preferred brain
  paddy agent list           List minds

Setup
  paddy onboard              Write ~/.paddy and copy selfhost.env
  paddy doctor               Check the install
  paddy status               Alias for gateway status

Flags
  --port <n>     Gateway port (default ${DEFAULT_PORT})
  --host <h>     Bind / connect host (default ${DEFAULT_HOST})
  --prefer <id>  Brain for this chat (supergrok, chatgpt-plus, laguna-s, …)
  --json         Machine-readable output
  --yes          Non-interactive onboard
  --help

Keys live in the gateway environment (selfhost.env). Sign-in in the dashboard
is for the browser; the CLI spends env subscriptions and keys.

Quick start
  unzip paddy-selfhost.zip && cd paddy-selfhost
  npm install
  npx paddy onboard
  npx paddy gateway
`;
}

function ensureHome() {
  mkdirSync(paddyHome(), { recursive: true });
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  ensureHome();
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadConfig() {
  const raw = readJson(homePath("config.json"), {});
  return {
    port: Number(raw.port) || DEFAULT_PORT,
    host: typeof raw.host === "string" && raw.host ? raw.host : DEFAULT_HOST,
    token: typeof raw.token === "string" ? raw.token : "",
    preferredProvider: typeof raw.preferredProvider === "string" ? raw.preferredProvider : "supergrok",
    root: typeof raw.root === "string" ? raw.root : kitRoot(),
  };
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  if (!next.token || next.token.length < 16) {
    next.token = randomBytes(24).toString("hex");
  }
  writeJson(homePath("config.json"), next);
  return next;
}

function pidPath() {
  return homePath("gateway.pid");
}

function logPath() {
  return homePath("gateway.log");
}

export function readPid() {
  try {
    const [pidLine, portLine] = readFileSync(pidPath(), "utf8").trim().split(/\n/);
    const pid = Number(pidLine);
    const port = Number(portLine) || loadConfig().port;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, port };
  } catch {
    return null;
  }
}

function writePid(pid, port) {
  ensureHome();
  writeFileSync(pidPath(), `${pid}\n${port}\n`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function loadDotEnv(file) {
  if (!file || !existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

function gatewayEnv(cfg) {
  const root = cfg.root || kitRoot();
  const fileEnv = {
    ...loadDotEnv(join(root, "selfhost.env.example")),
    ...loadDotEnv(homePath("selfhost.env")),
    ...loadDotEnv(join(root, "selfhost.env")),
  };
  for (const [k, v] of Object.entries(fileEnv)) {
    if (typeof v === "string" && !v.trim()) delete fileEnv[k];
  }
  const env = { ...fileEnv, ...process.env };
  env.PADDY_CLI_TOKEN = cfg.token;
  env.PADDY_MODEL = cfg.preferredProvider;
  return env;
}

function out(flags, data, text) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}

function fail(flags, error, code = 1) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  } else {
    process.stderr.write(`paddy: ${error}\n`);
  }
  process.exitCode = code;
}

export function baseUrl(cfg, flags) {
  const host = flags.host || cfg.host || DEFAULT_HOST;
  const port = flags.port || cfg.port || DEFAULT_PORT;
  const hostname = host === "0.0.0.0" ? "127.0.0.1" : host;
  return { host, port, hostname, origin: `http://${hostname}:${port}` };
}

export async function fetchCli(cfg, flags, { method = "GET", body } = {}) {
  const { origin } = baseUrl(cfg, flags);
  const headers = { accept: "application/json" };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  if (body) headers["content-type"] = "application/json";
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(`${origin}/api/cli`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: res.ok, raw: text.slice(0, 400) };
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

async function pingHttp(origin) {
  try {
    const res = await fetch(origin, { method: "GET", redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

function spawnGateway(cfg, flags, { detached }) {
  const root = cfg.root || kitRoot();
  const wrapper = join(root, "scripts/with-app-env.mjs");
  const viteJs = join(root, "node_modules/vite/bin/vite.js");
  const viteBin = existsSync(viteJs) ? viteJs : "vite";
  const { host, port } = baseUrl(cfg, flags);
  if (!existsSync(wrapper)) {
    throw new Error(`Not a Paddy kit (${wrapper} missing). Run this from the unzipped folder.`);
  }
  const args = [wrapper, viteBin, "dev", "--host", host, "--port", String(port)];
  const env = gatewayEnv(cfg);
  ensureHome();
  if (detached) {
    const fd = openSync(logPath(), "a");
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    closeSync(fd);
    writePid(child.pid, port);
    return child;
  }
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  writePid(child.pid, port);
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code, signal) => {
    try {
      const rec = readPid();
      if (rec?.pid === child.pid) rmSync(pidPath(), { force: true });
    } catch {
      /* ignore */
    }
    if (signal) process.exit(128);
    process.exit(code ?? 0);
  });
  return child;
}

async function waitForUp(cfg, flags, ms = 25000) {
  const { origin } = baseUrl(cfg, flags);
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await pingHttp(origin)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function loadWorkspace() {
  const fallback = {
    files: {},
    history: [],
    preferredProvider: loadConfig().preferredProvider,
  };
  return readJson(homePath("workspace.json"), fallback);
}

function saveWorkspace(ws) {
  writeJson(homePath("workspace.json"), ws);
}

function applyMutations(ws, mutations) {
  if (!Array.isArray(mutations)) return ws;
  const next = {
    ...ws,
    files: { ...(ws.files ?? {}) },
    history: [...(ws.history ?? [])],
    memories: [...(ws.memories ?? [])],
  };
  for (const m of mutations) {
    if (!m || typeof m !== "object") continue;
    if (m.type === "write_memory" && m.text) {
      next.memories.push({ text: m.text, kind: m.kind || "fact" });
      const line = `- (${m.kind || "fact"}) ${m.text}`;
      next.files.memory = `${next.files.memory || "# MEMORY.md\n"}\n${line}\n`;
    } else if (m.type === "update_user" && m.content) {
      next.files.user = m.content;
    } else if (m.type === "update_soul" && m.content) {
      next.files.soul = m.content;
    }
  }
  return next;
}

async function cmdGateway(sub, flags) {
  const action = sub || "run";
  const cfg = saveConfig({
    port: flags.port || loadConfig().port,
    host: flags.host || loadConfig().host,
    root: kitRoot(),
  });

  if (action === "run") {
    process.stdout.write(`Paddy gateway · ${baseUrl(cfg, flags).origin}\n`);
    process.stdout.write(`Dashboard: paddy dashboard   Chat: paddy chat\n\n`);
    spawnGateway(cfg, flags, { detached: false });
    return;
  }

  if (action === "start") {
    const existing = readPid();
    if (existing && alive(existing.pid)) {
      const { origin } = baseUrl({ ...cfg, port: existing.port }, flags);
      out(
        flags,
        { ok: true, running: true, pid: existing.pid, origin },
        `Already running (pid ${existing.pid}) at ${origin}`,
      );
      return;
    }
    spawnGateway(cfg, flags, { detached: true });
    const rec = readPid();
    const up = await waitForUp(cfg, flags);
    const { origin } = baseUrl(cfg, flags);
    if (!up) {
      fail(flags, `Started pid ${rec?.pid ?? "?"} but ${origin} did not come up. See ${logPath()}`);
      return;
    }
    out(
      flags,
      { ok: true, running: true, pid: rec?.pid, origin },
      `Gateway started (pid ${rec?.pid}) at ${origin}`,
    );
    return;
  }

  if (action === "stop") {
    const rec = readPid();
    if (!rec || !alive(rec.pid)) {
      rmSync(pidPath(), { force: true });
      out(flags, { ok: true, running: false }, "Gateway is not running.");
      return;
    }
    try {
      process.kill(rec.pid, "SIGTERM");
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : "kill failed");
      return;
    }
    const start = Date.now();
    while (Date.now() - start < 8000 && alive(rec.pid)) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (alive(rec.pid)) {
      try {
        process.kill(rec.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
    rmSync(pidPath(), { force: true });
    out(flags, { ok: true, running: false, pid: rec.pid }, `Stopped pid ${rec.pid}.`);
    return;
  }

  if (action === "restart") {
    await cmdGateway("stop", flags);
    await cmdGateway("start", flags);
    return;
  }

  if (action === "status") {
    return cmdStatus(flags);
  }

  fail(flags, `Unknown gateway command “${action}”. Try run | start | stop | restart | status.`, 2);
}

async function cmdStatus(flags) {
  const cfg = loadConfig();
  const rec = readPid();
  const { origin, port } = baseUrl(cfg, flags);
  const pidAlive = Boolean(rec && alive(rec.pid));
  const http = await pingHttp(origin);
  let api = null;
  try {
    const r = await fetchCli(cfg, flags, { method: "GET" });
    api = r.data;
  } catch {
    api = null;
  }
  const running = pidAlive || http;
  const text = running
    ? `Gateway up${rec ? ` (pid ${rec.pid})` : ""} at ${origin}`
    : `Gateway down. Start with: paddy gateway`;
  out(
    flags,
    {
      ok: running,
      running,
      pid: rec?.pid ?? null,
      pidAlive,
      http,
      origin,
      port,
      api: api && api.ok ? { preferred: api.preferred, locked: api.locked } : null,
    },
    text,
  );
  if (!running) process.exitCode = 1;
}

async function cmdDoctor(flags) {
  const cfg = loadConfig();
  const root = kitRoot();
  const { origin } = baseUrl(cfg, flags);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add("node", Number(process.versions.node.split(".")[0]) >= 20, `node ${process.version}`);
  add("kit", existsSync(join(root, "package.json")) && existsSync(join(root, "scripts/with-app-env.mjs")), root);
  add("home", true, paddyHome());
  add("token", Boolean(cfg.token && cfg.token.length >= 16), cfg.token ? "present" : "missing — run paddy onboard");
  const envFile = existsSync(join(root, "selfhost.env")) || existsSync(homePath("selfhost.env"));
  add("selfhost.env", envFile, envFile ? "found" : "copy from selfhost.env.example (paddy onboard)");
  const rec = readPid();
  const http = await pingHttp(origin);
  add("gateway", http, http ? origin : "not running — paddy gateway");
  if (http) {
    try {
      const r = await fetchCli(cfg, flags, { method: "GET" });
      add("cli api", Boolean(r.data?.ok), r.data?.locked ? "up, chat locked (no token on server)" : "up");
      const env = r.data?.env ?? {};
      const brains = Object.entries(env)
        .filter(([, v]) => v)
        .map(([k]) => k);
      add("brains", brains.length > 0, brains.length ? brains.join(", ") : "no env keys — set selfhost.env");
    } catch (err) {
      add("cli api", false, err instanceof Error ? err.message : "fetch failed");
    }
  }

  const ok = checks.every((c) => c.ok || c.name === "selfhost.env" || c.name === "brains" || c.name === "gateway");
  const lines = checks.map((c) => `  ${c.ok ? "ok  " : "warn"}  ${c.name.padEnd(14)} ${c.detail}`);
  out(flags, { ok, origin, checks }, `Paddy doctor\n${lines.join("\n")}`);
}

async function cmdModels(rest, flags) {
  const cfg = saveConfig({});
  if (rest[0] === "prefer") {
    const id = rest[1] || flags.prefer;
    if (!id) {
      fail(flags, "Usage: paddy models prefer <id>", 2);
      return;
    }
    const next = saveConfig({ preferredProvider: id });
    const ws = loadWorkspace();
    ws.preferredProvider = id;
    saveWorkspace(ws);
    out(flags, { ok: true, preferredProvider: next.preferredProvider }, `Preferred brain: ${id}`);
    return;
  }

  let remote = null;
  try {
    const r = await fetchCli(cfg, flags, { method: "GET" });
    remote = r.data;
  } catch {
    remote = null;
  }
  if (!remote?.providers) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }
  const lines = remote.providers.map((p) => {
    const mark = p.id === remote.preferred ? "*" : " ";
    const conn = p.connected ? "env" : "—";
    return `  ${mark} ${p.id.padEnd(14)} ${p.name.padEnd(16)} ${p.model}  [${conn}]`;
  });
  out(
    flags,
    { ok: true, preferred: remote.preferred, providers: remote.providers },
    `Preferred: ${remote.preferred || "supergrok"}\n${lines.join("\n")}\n\nSet with: paddy models prefer <id>`,
  );
}

async function cmdChat(rest, flags) {
  const cfg = loadConfig();
  if (!cfg.token) saveConfig({});
  const { origin } = baseUrl(cfg, flags);
  const up = await pingHttp(origin);
  if (!up) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }

  const preferred = flags.prefer || loadWorkspace().preferredProvider || cfg.preferredProvider;
  const oneShot = rest.join(" ").trim();

  async function turn(message) {
    const ws = loadWorkspace();
    const r = await fetchCli(cfg, flags, {
      method: "POST",
      body: {
        action: "chat",
        message,
        history: (ws.history ?? []).slice(-10),
        files: ws.files && Object.keys(ws.files).length ? ws.files : undefined,
        preferredProvider: preferred,
        profileName: "Paddy",
      },
    });
    if (!r.data?.ok) {
      throw new Error(r.data?.error || `HTTP ${r.status}`);
    }
    ws.history = [...(ws.history ?? []), { role: "user", content: message }, { role: "assistant", content: r.data.text }];
    saveWorkspace(applyMutations(ws, r.data.mutations));
    return r.data;
  }

  if (oneShot) {
    try {
      const data = await turn(oneShot);
      out(flags, data, data.text);
    } catch (err) {
      fail(flags, err instanceof Error ? err.message : "chat failed");
    }
    return;
  }

  if (flags.json) {
    fail(flags, "Interactive chat cannot --json. Pass a message: paddy chat \"hello\"", 2);
    return;
  }

  process.stdout.write(`Paddy CLI · ${origin} · ${preferred}\n`);
  process.stdout.write(`Empty line or /exit to quit. /status for gateway.\n\n`);
  const rl = createInterface({ input: stdinStream, output: stdoutStream });
  try {
    while (true) {
      const line = (await rl.question("you › ")).trim();
      if (!line || line === "/exit" || line === "/quit") break;
      if (line === "/status") {
        await cmdStatus(flags);
        continue;
      }
      if (line === "/models") {
        await cmdModels([], flags);
        continue;
      }
      try {
        const data = await turn(line);
        process.stdout.write(`\npaddy · ${data.text}\n\n`);
      } catch (err) {
        process.stderr.write(`paddy: ${err instanceof Error ? err.message : "chat failed"}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

async function cmdDashboard(flags) {
  const cfg = loadConfig();
  const { origin } = baseUrl(cfg, flags);
  const up = await pingHttp(origin);
  if (!up) {
    fail(flags, "Gateway is not running. Start it with: paddy gateway");
    return;
  }
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", origin] : [origin];
  try {
    spawn(opener, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* headless is fine */
  }
  out(flags, { ok: true, origin }, origin);
}

async function cmdOnboard(flags) {
  const root = kitRoot();
  const cfg = saveConfig({ root, port: flags.port || DEFAULT_PORT, host: flags.host || DEFAULT_HOST });
  const example = join(root, "selfhost.env.example");
  const kitEnv = join(root, "selfhost.env");
  const homeEnv = homePath("selfhost.env");
  let copied = "";
  if (existsSync(example) && !existsSync(kitEnv) && !existsSync(homeEnv)) {
    writeFileSync(homeEnv, readFileSync(example));
    copied = homeEnv;
  }
  let preferred = cfg.preferredProvider;
  if (!flags.yes && stdinStream.isTTY && stdoutStream.isTTY) {
    const rl = createInterface({ input: stdinStream, output: stdoutStream });
    try {
      const answer = (
        await rl.question(`Preferred brain [${preferred}]: `)
      ).trim();
      if (answer) preferred = answer;
    } finally {
      rl.close();
    }
    saveConfig({ preferredProvider: preferred });
  }
  const fingerprint = createHash("sha256").update(cfg.token).digest("hex").slice(0, 8);
  const text = [
    "Paddy is ready on this machine.",
    `  home     ${paddyHome()}`,
    `  token    ${fingerprint}…`,
    copied ? `  env      wrote ${copied}` : `  env      ${existsSync(kitEnv) ? kitEnv : existsSync(homeEnv) ? homeEnv : "set selfhost.env (see selfhost.env.example)"}`,
    `  prefer   ${preferred}`,
    "",
    "Next:",
    "  1. Put keys / setup-tokens in selfhost.env  (or sign in via the dashboard)",
    "  2. paddy gateway",
    "  3. In another terminal: paddy chat   or   paddy dashboard",
  ].join("\n");
  out(
    flags,
    { ok: true, home: paddyHome(), root, copied: Boolean(copied), envFile: copied || kitEnv, preferredProvider: preferred },
    text,
  );
}

function cmdAgent(rest, flags) {
  const sub = rest[0] || "list";
  if (sub !== "list") {
    fail(flags, "Usage: paddy agent list", 2);
    return;
  }
  out(flags, { ok: true, agents: [{ id: "paddy", name: "Paddy" }] }, "  paddy    Paddy    (seed mind — add extras in the dashboard)");
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (err) {
    process.stderr.write(`paddy: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
    return;
  }
  const { flags, rest } = parsed;
  if (flags.version && rest.length === 0) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const command = rest[0];
  if (flags.help || !command) {
    process.stdout.write(helpText());
    return;
  }

  try {
    switch (command) {
      case "gateway":
        await cmdGateway(rest[1], flags);
        break;
      case "status":
        await cmdStatus(flags);
        break;
      case "doctor":
        await cmdDoctor(flags);
        break;
      case "models":
      case "model":
        await cmdModels(rest.slice(1), flags);
        break;
      case "chat":
        await cmdChat(rest.slice(1), flags);
        break;
      case "dashboard":
        await cmdDashboard(flags);
        break;
      case "onboard":
        await cmdOnboard(flags);
        break;
      case "agent":
      case "agents":
        cmdAgent(rest.slice(1), flags);
        break;
      case "help":
        process.stdout.write(helpText());
        break;
      case "version":
        process.stdout.write(`${VERSION}\n`);
        break;
      default:
        fail(flags, `Unknown command “${command}”. Try paddy --help`, 2);
    }
  } catch (err) {
    fail(flags, err instanceof Error ? err.message : String(err));
  }
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(entry) === fileURLToPath(import.meta.url);
  }
})();

if (isMain) {
  await main();
}
