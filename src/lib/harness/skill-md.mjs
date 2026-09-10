// @ts-nocheck
/**
 * agentskills.io / OpenClaw SKILL.md — parse and emit.
 * Shared by the dashboard (via mutate.ts) and the paddy CLI.
 */

export function kebabSkillName(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function stripQuotes(s) {
  const t = String(s ?? "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function asStringList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => stripQuotes(v)).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((t) => stripQuotes(t))
      .filter(Boolean);
  }
  return [];
}

function parseSimpleYaml(block) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const lines = String(block ?? "").split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const raw = (m[2] ?? "").trim();
    if (raw === ">" || raw === "|") {
      const folded = [];
      i += 1;
      while (i < lines.length && (/^(\s|$)/.test(lines[i] ?? "") || (lines[i] ?? "") === "")) {
        if (/^\s/.test(lines[i] ?? "") || (lines[i] ?? "") === "") {
          folded.push((lines[i] ?? "").replace(/^\s{1,2}/, ""));
          i += 1;
          continue;
        }
        break;
      }
      out[key] = folded.join(raw === ">" ? " " : "\n").trim();
      continue;
    }
    if (raw === "" || raw === "[]") {
      if (raw === "[]") {
        out[key] = [];
        i += 1;
        continue;
      }
      const list = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i] ?? "")) {
        list.push(stripQuotes((lines[i] ?? "").replace(/^\s+-\s+/, "")));
        i += 1;
      }
      out[key] = list.length ? list : "";
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      out[key] = raw
        .slice(1, -1)
        .split(",")
        .map((t) => stripQuotes(t))
        .filter(Boolean);
      i += 1;
      continue;
    }
    out[key] = stripQuotes(raw);
    i += 1;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {{ ok: true, name: string, description: string, instructions: string, triggers: string[], version: string } | { ok: false, error: string }}
 */
export function parseSkillMd(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  if (!src.trim()) return { ok: false, error: "SKILL.md is empty." };

  let name = "";
  let description = "";
  let instructions = src.trim();
  /** @type {string[]} */
  let triggers = [];
  let version = "";

  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    const meta = parseSimpleYaml(fm[1] ?? "");
    name = kebabSkillName(typeof meta.name === "string" ? meta.name : "");
    description = String(meta.description ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    triggers = asStringList(meta.triggers).slice(0, 8);
    version = String(meta.version ?? "").slice(0, 24);
    instructions = (fm[2] ?? "").trim();
  }

  if (!name) {
    const heading = src.match(/^#\s+(.+)$/m);
    name = kebabSkillName(heading?.[1] ?? "");
  }
  if (!name) {
    return { ok: false, error: "SKILL.md needs a name (frontmatter name: or a # heading)." };
  }
  if (!instructions) {
    return { ok: false, error: "SKILL.md has no playbook body." };
  }
  if (!description) {
    const first = instructions
      .replace(/^#.*$/m, "")
      .trim()
      .split(/\n\n/)[0] ?? "";
    description = first.replace(/\s+/g, " ").slice(0, 240);
  }

  return {
    ok: true,
    name,
    description: description || name,
    instructions: instructions.slice(0, 8000),
    triggers,
    version,
  };
}

/**
 * @param {{ name: string, description: string, instructions: string, triggers?: string[], status?: string, version?: string }} s
 */
export function toSkillMd(s) {
  const triggers = (s.triggers ?? []).join(", ");
  const desc = String(s.description ?? "").replace(/\n/g, " ").slice(0, 240);
  const version = s.version ? `\nversion: ${s.version}` : "";
  return `---
name: ${s.name}
description: ${desc}
triggers: [${triggers}]
status: ${s.status ?? "active"}${version}
---

${s.instructions}
`;
}
