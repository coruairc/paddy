/**
 * OpenClaw-style interactive `paddy configure` wizard.
 *
 * Reviewer gates:
 * 1. ONE schema — canonicalConfigSchema() (same source getConfigSchema uses).
 * 2. writeOnly tokens only via configSet("gateway.auth.token"|cli.token) → .env.
 * 3. Sections we persist today only — no Plugins / Daemon fake writers.
 * 4. Non-interactive config get|set|unset|schema|show|validate stay in bin.
 * 5. Bare `paddy config` / `paddy configure` (TTY) → this wizard.
 */
import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import {
  applyBrainModelSelection,
  canonicalConfigSchema,
  configGet,
  configSet,
  loadCanonical,
  loadResolvedAccounts,
  paddyHome,
  redactConfig,
  removeCanonicalChannel,
  resolvedSnapshot,
  upsertCanonicalChannel,
  validateCanonical,
} from "./config.mjs";
import {
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  MENU_KEEP_MODEL,
  brainModelMenuOptions,
  brainProviderById,
  brainProviderMenuOptions,
} from "./brain-catalog.mjs";

export { applyBrainModelSelection } from "./config.mjs";

export {
  BRAIN_PROVIDER_CATALOG,
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  MENU_KEEP_MODEL,
  brainModelMenuOptions,
  brainProviderById,
  brainProviderMenuOptions,
} from "./brain-catalog.mjs";

/** @typedef {"workspace"|"model"|"gateway"|"channels"|"memory"|"skills"|"health"|"done"} WizardSectionId */

/** @type {ReadonlyArray<{ id: WizardSectionId, label: string, hint: string, paths: string[] }>} */
export const CONFIGURE_SECTIONS = Object.freeze([
  {
    id: "workspace",
    label: "Workspace",
    hint: "agents.defaults.workspace path",
    paths: ["agents.defaults.workspace"],
  },
  {
    id: "model",
    label: "Model / Brain",
    hint: "searchable provider → model → brain.preferred / brain.model",
    paths: ["brain.preferred", "brain.model"],
  },
  {
    id: "gateway",
    label: "Gateway",
    hint: "host, port, auth token → cli.token / .env",
    paths: ["gateway.host", "gateway.port", "gateway.auth.token"],
  },
  {
    id: "channels",
    label: "Channels",
    hint: "list / add / edit channel accounts",
    paths: ["channels"],
  },
  {
    id: "memory",
    label: "Memory",
    hint: "agents.defaults.memory caps",
    paths: [
      "agents.defaults.memory.enabled",
      "agents.defaults.memory.memoryCharLimit",
      "agents.defaults.memory.userCharLimit",
      "agents.defaults.memory.recallLimit",
      "agents.defaults.memory.fts",
    ],
  },
  {
    id: "skills",
    label: "Skills",
    hint: "skills.load.extraDirs / skills.allow",
    paths: ["skills.load.extraDirs", "skills.allow"],
  },
  {
    id: "health",
    label: "Health",
    hint: "validate + doctor-lite snapshot",
    paths: [],
  },
  {
    id: "done",
    label: "Skip / Done",
    hint: "Leave the wizard",
    paths: [],
  },
]);

const SECTION_IDS = new Set(CONFIGURE_SECTIONS.map((s) => s.id));
const BRIDGE_IDS = ["telegram", "discord", "slack", "whatsapp", "signal", "email"];

/** Same schema document getConfigSchema returns — never invent a second schema. */
export function wizardSchema() {
  return canonicalConfigSchema();
}

/**
 * @param {unknown} raw
 * @returns {{ sections: WizardSectionId[], invalid: string[] }}
 */
export function parseConfigureSections(raw) {
  const list = Array.isArray(raw)
    ? raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : raw
      ? [String(raw).trim().toLowerCase()]
      : [];
  if (!list.length) return { sections: [], invalid: [] };
  /** @type {string[]} */
  const invalid = [];
  /** @type {WizardSectionId[]} */
  const sections = [];
  for (const s of list) {
    if (SECTION_IDS.has(/** @type {WizardSectionId} */ (s))) {
      sections.push(/** @type {WizardSectionId} */ (s));
    } else {
      invalid.push(s);
    }
  }
  return { sections, invalid };
}

/**
 * @param {string} id
 * @returns {{ id: WizardSectionId, label: string, paths: string[] } | null}
 */
export function sectionRoutes(id) {
  const hit = CONFIGURE_SECTIONS.find((s) => s.id === id);
  if (!hit) return null;
  return { id: hit.id, label: hit.label, paths: [...hit.paths] };
}

/** @param {string} path */
export function isWriteOnlySecretPath(path) {
  const n = String(path || "").trim().toLowerCase();
  return n === "gateway.auth.token" || n === "gateway.auth" || n === "cli.token";
}

/**
 * Hardened secret write — configSet extracts plaintext into ~/.paddy/.env.
 * @param {string} token
 * @param {{ home?: string }} [opts]
 */
export function applyGatewayAuthToken(token, opts = {}) {
  return configSet("gateway.auth.token", token, { home: opts.home ?? paddyHome() });
}

/**
 * Non-interactive section apply (tests + --section scripting).
 * @param {WizardSectionId} section
 * @param {Record<string, unknown>} [values]
 * @param {{ home?: string }} [opts]
 */
export function applyConfigureSection(section, values = {}, opts = {}) {
  const home = opts.home ?? paddyHome();
  const route = sectionRoutes(section);
  if (!route) {
    const err = new Error(`Unknown configure section: ${section}`);
    // @ts-ignore
    err.code = "ECONFIGURE_SECTION";
    throw err;
  }

  /** @type {Array<{ path: string, result: unknown }>} */
  const writes = [];
  const set = (path, value) => {
    if (value === undefined) return;
    const result = configSet(path, value, { home });
    writes.push({ path, result });
  };

  switch (section) {
    case "workspace":
      if (values.workspace != null) set("agents.defaults.workspace", String(values.workspace));
      break;
    case "model": {
      // Atomic preferred+model when both present (confirm path). Partial single-path otherwise.
      if (values.preferred != null && values.model !== undefined) {
        const result = applyBrainModelSelection(
          {
            preferred: String(values.preferred),
            model: values.model == null ? "" : String(values.model),
          },
          { home },
        );
        writes.push({ path: "brain", result });
      } else {
        if (values.preferred != null) set("brain.preferred", String(values.preferred));
        if (values.model !== undefined) set("brain.model", values.model == null ? "" : String(values.model));
      }
      break;
    }
    case "gateway":
      if (values.host != null) set("gateway.host", String(values.host));
      if (values.port != null) set("gateway.port", Number(values.port));
      if (values.token != null && String(values.token).length) {
        writes.push({
          path: "gateway.auth.token",
          result: applyGatewayAuthToken(String(values.token), { home }),
        });
      }
      break;
    case "channels": {
      const id = values.id != null ? String(values.id).toLowerCase() : "";
      if (values.remove && id) {
        removeCanonicalChannel(id, home);
        writes.push({ path: `channels.${id}`, result: { ok: true, removed: true } });
      } else if (id && values.account && typeof values.account === "object") {
        const acc = upsertCanonicalChannel(id, /** @type {Record<string, unknown>} */ (values.account), home);
        writes.push({ path: `channels.${id}`, result: { ok: true, account: acc } });
      }
      break;
    }
    case "memory": {
      const mem = {};
      if (values.enabled !== undefined) mem.enabled = Boolean(values.enabled);
      if (values.memoryCharLimit !== undefined) mem.memoryCharLimit = Number(values.memoryCharLimit);
      if (values.userCharLimit !== undefined) mem.userCharLimit = Number(values.userCharLimit);
      if (values.recallLimit !== undefined) mem.recallLimit = Number(values.recallLimit);
      if (values.fts !== undefined) mem.fts = Boolean(values.fts);
      if (Object.keys(mem).length) {
        // Merge onto existing memory object so partial updates don't wipe siblings.
        let prev = {};
        try {
          const hit = configGet("agents.defaults.memory", { home });
          if (hit.value && typeof hit.value === "object") prev = hit.value;
        } catch {
          /* missing path */
        }
        set("agents.defaults.memory", { ...prev, ...mem });
      }
      break;
    }
    case "skills": {
      if (values.extraDirs !== undefined) {
        const dirs = Array.isArray(values.extraDirs)
          ? values.extraDirs.map(String)
          : String(values.extraDirs)
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean);
        set("skills.load.extraDirs", dirs);
      }
      if (values.allow !== undefined) {
        const allow = Array.isArray(values.allow)
          ? values.allow.map(String)
          : String(values.allow)
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean);
        set("skills.allow", allow);
      }
      break;
    }
    case "health":
    case "done":
      break;
    default:
      break;
  }

  return { ok: true, section, writes, schema: wizardSchema() };
}

/**
 * @param {{ home?: string }} [opts]
 */
export function configureHealthCheck(opts = {}) {
  const home = opts.home ?? paddyHome();
  const snap = resolvedSnapshot(home);
  const valid = validateCanonical(snap.config);
  const missing = (snap.missing || []).map((m) => `${m.path} → ${m.name}`);
  const view = redactConfig(snap.config);
  return {
    ok: Boolean(valid.ok),
    version: snap.config?.version,
    issues: valid.issues || [],
    missing,
    gateway: {
      host: view.gateway?.host,
      port: view.gateway?.port,
      auth: "token",
      token: view.cli?.token ? "set (redacted)" : "missing",
    },
    brain: view.brain || {},
    channels: Object.keys(view.channels || {}),
  };
}

function safeGet(path, home) {
  try {
    return configGet(path, { home }).value;
  } catch {
    return undefined;
  }
}

/**
 * Case-insensitive substring filter over label/hint/value (OpenClaw-style type-to-search).
 * @param {Array<{ value: string, label: string, hint?: string }>} options
 * @param {string} [query]
 */
export function filterMenuOptions(options, query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return options.slice();
  return options.filter((opt) => {
    const hay = `${opt.label || ""} ${opt.hint || ""} ${opt.value || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * ↑/↓ + Enter menu; optional type-to-search filter; numbered fallback when raw mode is unavailable.
 * @param {Array<{ value: string, label: string, hint?: string }>} options
 * @param {{
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   message?: string,
 *   initial?: number,
 *   searchable?: boolean,
 *   cancelValue?: string,
 * }} [opts]
 */
export async function selectMenu(options, opts = {}) {
  const stdin = opts.stdin ?? defaultStdin;
  const stdout = opts.stdout ?? defaultStdout;
  const message = opts.message || "What do you want to configure?";
  const searchable = Boolean(opts.searchable);
  const cancelValue = opts.cancelValue;
  let query = "";
  let filtered = filterMenuOptions(options, query);
  let index = Math.max(0, Math.min(Math.max(filtered.length, 1) - 1, opts.initial ?? 0));

  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write(`${message}\n`);
      if (searchable) {
        const filterAns = (await rl.question("Filter (empty = all): ")).trim();
        filtered = filterMenuOptions(options, filterAns);
        if (!filtered.length) {
          stdout.write("  (no matches)\n");
          return cancelValue ?? options[0]?.value;
        }
      }
      filtered.forEach((opt, i) => {
        stdout.write(`  ${i + 1}. ${opt.label}${opt.hint ? ` — ${opt.hint}` : ""}\n`);
      });
      const answer = (await rl.question(`Choose [1-${filtered.length}]: `)).trim();
      const n = Number(answer);
      if (Number.isFinite(n) && n >= 1 && n <= filtered.length) return filtered[n - 1].value;
      return filtered[Math.min(index, filtered.length - 1)]?.value;
    } finally {
      rl.close();
    }
  }

  const footer = searchable
    ? "  ↑/↓ move · type to filter · Backspace edit · Enter select · Esc back · q quit"
    : "  ↑/↓ move · Enter select · q quit";

  const lineCount = () => filtered.length + (searchable ? 3 : 2) + (filtered.length ? 0 : 1);

  const draw = () => {
    stdout.write("\x1b[?25l");
    stdout.write(`${message}\n`);
    if (searchable) {
      stdout.write(`\x1b[90m  Filter:\x1b[0m ${query}\x1b[90m_\x1b[0m\n`);
    }
    if (!filtered.length) {
      stdout.write("\x1b[90m  (no matches)\x1b[0m\n");
    } else {
      filtered.forEach((opt, i) => {
        const cursor = i === index ? "›" : " ";
        const label = i === index ? `\x1b[36m${opt.label}\x1b[0m` : opt.label;
        const hint = opt.hint ? `\x1b[90m ${opt.hint}\x1b[0m` : "";
        stdout.write(`  ${cursor} ${label}${hint}\n`);
      });
    }
    stdout.write(`\x1b[90m${footer}\x1b[0m\n`);
  };

  let drawnLines = 0;
  const clear = () => {
    if (drawnLines <= 0) return;
    stdout.write(`\x1b[${drawnLines}A`);
    for (let i = 0; i < drawnLines; i++) stdout.write("\x1b[2K\x1b[1B");
    stdout.write(`\x1b[${drawnLines}A`);
  };

  const redraw = () => {
    clear();
    draw();
    drawnLines = lineCount();
  };

  draw();
  drawnLines = lineCount();

  return await new Promise((resolve) => {
    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
      if (typeof stdin.isPaused === "function" && stdin.isPaused()) {
        stdin.resume();
      }
      stdout.write("\x1b[?25h\n");
    };
    const onData = (buf) => {
      const s = buf.toString("utf8");
      if (s === "\u0003" || s === "q" || s === "Q") {
        cleanup();
        resolve("done");
        return;
      }
      if (s === "\u001b" || s === "\u001b\u001b") {
        if (cancelValue !== undefined) {
          cleanup();
          resolve(cancelValue);
        }
        return;
      }
      if (s === "\r" || s === "\n") {
        if (!filtered.length) return;
        const value = filtered[index]?.value ?? "done";
        cleanup();
        resolve(value);
        return;
      }
      // j/k vim keys only when not searchable — otherwise they are filter input.
      if (s === "\u001b[A" || (!searchable && s === "k")) {
        if (!filtered.length) return;
        index = (index - 1 + filtered.length) % filtered.length;
        redraw();
        return;
      }
      if (s === "\u001b[B" || (!searchable && s === "j")) {
        if (!filtered.length) return;
        index = (index + 1) % filtered.length;
        redraw();
        return;
      }
      if (searchable && (s === "\u007f" || s === "\b")) {
        query = query.slice(0, -1);
        filtered = filterMenuOptions(options, query);
        index = 0;
        redraw();
        return;
      }
      if (searchable && s === "\u0015") {
        query = "";
        filtered = filterMenuOptions(options, query);
        index = 0;
        redraw();
        return;
      }
      if (s.startsWith("\u001b")) return;
      if (searchable) {
        let changed = false;
        for (const ch of s) {
          const code = ch.charCodeAt(0);
          if (code < 32) continue;
          query += ch;
          changed = true;
        }
        if (changed) {
          filtered = filterMenuOptions(options, query);
          index = 0;
          redraw();
        }
      }
    };
    try {
      stdin.setRawMode(true);
    } catch {
      cleanup();
      resolve(filtered[index]?.value ?? options[index]?.value ?? "done");
      return;
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function promptLine(rl, label, current) {
  const suffix = current === undefined || current === "" ? "" : ` [${current}]`;
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer === "" ? current : answer;
}

/**
 * Read a secret without echoing when stdin supports setRawMode.
 * Falls back to rl.question (may echo) on non-TTY / limited streams.
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} label
 * @returns {Promise<string>}
 */
export async function promptSecret(rl, label) {
  const prompt = `${label} (empty keeps current): `;
  const stdin = /** @type {NodeJS.ReadStream | undefined} */ (rl.input);
  const stdout = /** @type {NodeJS.WriteStream | undefined} */ (rl.output) ?? defaultStdout;

  if (!stdin?.isTTY || typeof stdin.setRawMode !== "function") {
    return (await rl.question(prompt)).trim();
  }

  rl.pause();
  stdout.write(prompt);

  return new Promise((resolve, reject) => {
    let buf = "";
    const wasRaw = Boolean(stdin.isRaw);
    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        /* ignore */
      }
      try {
        rl.resume();
      } catch {
        /* ignore */
      }
    };
    const onData = (chunk) => {
      const s = String(chunk);
      if (s === "\u0003") {
        cleanup();
        reject(Object.assign(new Error("Interrupted"), { code: "EINTR" }));
        return;
      }
      if (s === "\r" || s === "\n" || s === "\r\n") {
        cleanup();
        stdout.write("\n");
        resolve(buf.trim());
        return;
      }
      if (s === "\u007f" || s === "\b") {
        buf = buf.slice(0, -1);
        return;
      }
      if (s === "\u0015") {
        buf = "";
        return;
      }
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code < 32) continue;
        buf += ch;
      }
    };
    try {
      stdin.setRawMode(true);
    } catch {
      cleanup();
      void rl.question(prompt).then((v) => resolve(String(v).trim()), reject);
      return;
    }
    stdin.on("data", onData);
  });
}

async function runWorkspaceSection(rl, home, log) {
  const cur = safeGet("agents.defaults.workspace", home);
  const next = await promptLine(rl, "Workspace path", cur ?? "");
  if (next != null && next !== "") {
    applyConfigureSection("workspace", { workspace: next }, { home });
    log(`Set agents.defaults.workspace = ${next}`);
  }
}

/**
 * OpenClaw-style searchable provider → model picker for Model / Brain.
 * Writes brain.preferred + brain.model atomically via applyBrainModelSelection (no new secret storage).
 * @param {{
 *   home: string,
 *   log: (line: string) => void,
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 * }} opts
 */
export async function runModelSection(opts) {
  const home = opts.home;
  const log = opts.log;
  const stdin = opts.stdin ?? defaultStdin;
  const stdout = opts.stdout ?? defaultStdout;

  const currentPreferred = String(safeGet("brain.preferred", home) ?? "supergrok");
  const currentModel = String(safeGet("brain.model", home) ?? "");

  while (true) {
    const providerRows = brainProviderMenuOptions({ currentPreferred });
    const providerChoice = await selectMenu(providerRows, {
      stdin,
      stdout,
      message: "Model / Brain — choose a provider (type to filter)",
      searchable: true,
      cancelValue: MENU_BACK,
      initial: Math.max(
        0,
        providerRows.findIndex((o) => o.value === currentPreferred || o.value === MENU_KEEP),
      ),
    });

    if (!providerChoice || providerChoice === "done" || providerChoice === MENU_BACK) {
      log("Model / Brain unchanged.");
      return { ok: true, skipped: true };
    }

    const preferred = providerChoice === MENU_KEEP ? currentPreferred : String(providerChoice);
    const provider = brainProviderById(preferred);
    if (!provider) {
      log(`Unknown provider “${preferred}”.`);
      continue;
    }

    const modelChoice = await selectMenu(brainModelMenuOptions(preferred, { currentModel }), {
      stdin,
      stdout,
      message: `Model for ${provider.name} (type to filter)`,
      searchable: true,
      cancelValue: MENU_BACK,
    });

    if (!modelChoice || modelChoice === "done" || modelChoice === MENU_BACK) {
      continue;
    }

    let model;
    if (modelChoice === MENU_DEFAULT_MODEL) {
      model = "";
    } else if (modelChoice === MENU_KEEP_MODEL) {
      model = currentModel;
    } else {
      model = String(modelChoice);
    }

    const confirm = await selectMenu(
      [
        {
          value: "save",
          label: "Save",
          hint: `${preferred}${model ? ` / ${model}` : " (provider default)"}`,
        },
        { value: MENU_BACK, label: "Back", hint: "Return to model list" },
      ],
      {
        stdin,
        stdout,
        message: "Confirm Model / Brain",
        searchable: false,
        cancelValue: MENU_BACK,
      },
    );

    if (!confirm || confirm === "done" || confirm === MENU_BACK) {
      continue;
    }

    applyConfigureSection("model", { preferred, model }, { home });
    log(`Brain: ${preferred}${model ? ` (${model})` : " (provider default)"}`);
    return { ok: true, preferred, model };
  }
}

async function runGatewaySection(rl, home, log) {
  const host = safeGet("gateway.host", home) ?? "127.0.0.1";
  const port = safeGet("gateway.port", home) ?? 8080;
  const nextHost = await promptLine(rl, "Gateway host", host);
  const nextPortRaw = await promptLine(rl, "Gateway port", String(port));
  const nextPort = Number(nextPortRaw);
  const token = await promptSecret(rl, "Gateway auth token");
  applyConfigureSection(
    "gateway",
    {
      host: nextHost,
      port: Number.isFinite(nextPort) ? nextPort : port,
      ...(token ? { token } : {}),
    },
    { home },
  );
  log(
    token
      ? "Gateway saved; auth token → cli.token / ~/.paddy/.env (never plaintext in config.json)"
      : "Gateway host/port saved (token unchanged)",
  );
}

async function runChannelsSection(rl, home, log) {
  const accounts = loadResolvedAccounts(home);
  log("Channels:");
  for (const id of BRIDGE_IDS) {
    const acc = accounts[id];
    const on = Boolean(acc && (acc.token || acc.host || acc.user));
    log(`  ${on ? "on " : "off"}  ${id}`);
  }
  const action = (await rl.question("Action [list/add/remove/skip] (list): ")).trim().toLowerCase();
  if (!action || action === "list" || action === "skip") return;
  if (action === "remove" || action === "rm") {
    const id = (await rl.question("Channel id to remove: ")).trim().toLowerCase();
    if (!BRIDGE_IDS.includes(id)) {
      log("Unknown channel id.");
      return;
    }
    applyConfigureSection("channels", { id, remove: true }, { home });
    log(`Disconnected ${id}.`);
    return;
  }
  if (action === "add" || action === "edit") {
    const id = (await rl.question("Channel id: ")).trim().toLowerCase();
    if (!BRIDGE_IDS.includes(id)) {
      log("Unknown channel id.");
      return;
    }
    const token = await promptSecret(rl, "Bot token");
    const dmPolicy =
      (await promptLine(rl, "DM policy (pairing|allowlist|open)", "pairing")) || "pairing";
    const allowFromRaw = (await rl.question("Allow from (comma ids, empty ok): ")).trim();
    /** @type {Record<string, unknown>} */
    const account = {
      dmPolicy: ["pairing", "allowlist", "open"].includes(dmPolicy) ? dmPolicy : "pairing",
      allowFrom: allowFromRaw
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      requireMention: true,
    };
    if (token) account.token = token;
    applyConfigureSection("channels", { id, account }, { home });
    log(`Saved ${id}.`);
  }
}

async function runMemorySection(rl, home, log) {
  const cur = safeGet("agents.defaults.memory", home) || {};
  const enabledRaw = await promptLine(rl, "Memory enabled (true/false)", String(cur.enabled ?? true));
  const memoryCharLimit = await promptLine(
    rl,
    "memoryCharLimit",
    String(cur.memoryCharLimit ?? 2200),
  );
  const userCharLimit = await promptLine(rl, "userCharLimit", String(cur.userCharLimit ?? 1375));
  const recallLimit = await promptLine(rl, "recallLimit", String(cur.recallLimit ?? 12));
  const ftsRaw = await promptLine(rl, "fts (true/false)", String(cur.fts ?? true));
  applyConfigureSection(
    "memory",
    {
      enabled: String(enabledRaw).toLowerCase() !== "false",
      memoryCharLimit: Number(memoryCharLimit),
      userCharLimit: Number(userCharLimit),
      recallLimit: Number(recallLimit),
      fts: String(ftsRaw).toLowerCase() !== "false",
    },
    { home },
  );
  log("agents.defaults.memory updated.");
}

async function runSkillsSection(rl, home, log) {
  const dirs = safeGet("skills.load.extraDirs", home) || [];
  const allow = safeGet("skills.allow", home) || [];
  const dirsRaw = await promptLine(
    rl,
    "skills.load.extraDirs (comma-separated)",
    Array.isArray(dirs) ? dirs.join(", ") : "",
  );
  const allowRaw = await promptLine(
    rl,
    "skills.allow (comma-separated)",
    Array.isArray(allow) ? allow.join(", ") : "",
  );
  applyConfigureSection(
    "skills",
    { extraDirs: dirsRaw ?? "", allow: allowRaw ?? "" },
    { home },
  );
  log("skills.load.extraDirs / skills.allow updated.");
}

function runHealthSection(log, home) {
  const report = configureHealthCheck({ home });
  log(`Health: config ${report.ok ? "ok" : "INVALID"} (version ${report.version})`);
  log(
    `  gateway  ${report.gateway.host}:${report.gateway.port}  auth=${report.gateway.auth}  token=${report.gateway.token}`,
  );
  log(
    `  brain    ${report.brain.preferred || "—"}${report.brain.model ? ` (${report.brain.model})` : ""}`,
  );
  log(`  channels ${report.channels.length ? report.channels.join(", ") : "(none)"}`);
  if (report.missing?.length) log(`  missing  ${report.missing.join(", ")}`);
  for (const issue of report.issues || []) {
    log(`  error    ${issue.path ? `${issue.path}: ` : ""}${issue.message}`);
  }
}

/**
 * @param {{
 *   home?: string,
 *   sections?: WizardSectionId[],
 *   stdin?: NodeJS.ReadStream,
 *   stdout?: NodeJS.WriteStream,
 *   log?: (line: string) => void,
 * }} [opts]
 */
export async function runConfigureWizard(opts = {}) {
  const home = opts.home ?? paddyHome();
  const stdin = opts.stdin ?? defaultStdin;
  const stdout = opts.stdout ?? defaultStdout;
  const log = opts.log ?? ((line) => stdout.write(`${line}\n`));

  loadCanonical({ home, persist: true });

  const schema = wizardSchema();
  if (!schema?.properties?.gateway) {
    throw new Error("canonicalConfigSchema missing gateway — refusing to run wizard");
  }

  const preselected = Array.isArray(opts.sections) ? [...opts.sections] : [];
  const queue = preselected.filter((id) => id !== "done");

  log("Paddy configure — OpenClaw-style section wizard");
  log("Writes use configSet/configGet only. Auth tokens never land plaintext in config.json.");
  log("Not offered: Plugins, Daemon (no persistence surface yet).");

  const menuOptions = CONFIGURE_SECTIONS.map((s) => ({
    value: s.id,
    label: s.label,
    hint: s.hint,
  }));

  while (true) {
    /** @type {WizardSectionId} */
    let choice;
    if (queue.length) {
      choice = /** @type {WizardSectionId} */ (queue.shift());
    } else {
      choice = /** @type {WizardSectionId} */ (
        await selectMenu(menuOptions, {
          stdin,
          stdout,
          message: "What do you want to configure?",
        })
      );
    }

    if (!choice || choice === "done") {
      log("Done.");
      break;
    }

    log(`\n— ${CONFIGURE_SECTIONS.find((s) => s.id === choice)?.label || choice} —`);
    if (choice === "model") {
      // Searchable menus own raw-mode stdin — do not hold a readline interface open.
      await runModelSection({ home, log, stdin, stdout });
    } else if (choice === "health") {
      runHealthSection(log, home);
    } else {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        switch (choice) {
          case "workspace":
            await runWorkspaceSection(rl, home, log);
            break;
          case "gateway":
            await runGatewaySection(rl, home, log);
            break;
          case "channels":
            await runChannelsSection(rl, home, log);
            break;
          case "memory":
            await runMemorySection(rl, home, log);
            break;
          case "skills":
            await runSkillsSection(rl, home, log);
            break;
          default:
            log(`Section “${choice}” is not implemented (no fake writer).`);
            break;
        }
      } finally {
        rl.close();
      }
    }

    if (preselected.length && !queue.length) {
      log("Done.");
      break;
    }
  }

  return { ok: true, home };
}
