import type {
  MemoryEntry,
  MemoryKind,
  Mutation,
  Skill,
  SkillStatus,
  TraceEvent,
  TraceKind,
  WorkspaceFiles,
  WorkspaceState,
} from "./types";

function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
}

export function parseMemoryFile(text: string, now = Date.now()): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^- (?:\((\w+)\)\s+)?(.+)$/);
    if (!m) continue;
    const kindRaw = m[1] ?? "fact";
    const kind: MemoryKind =
      kindRaw === "preference" || kindRaw === "lesson" || kindRaw === "episode" || kindRaw === "fact"
        ? kindRaw
        : "fact";
    const body = (m[2] ?? "").trim().slice(0, 800);
    if (!body || body === "(empty)") continue;
    out.push({
      id: uid("mem"),
      text: body,
      kind,
      at: now,
      source: "editor",
    });
  }
  return out;
}

export function rebuildMemoryFile(ws: Pick<WorkspaceState, "memories">): string {
  const lines = ws.memories.map((m) => `- (${m.kind}) ${m.text}`);
  return `# MEMORY.md\n\n${lines.join("\n") || "- (empty)"}`;
}

export function snapshotOf(ws: WorkspaceState): string {
  return JSON.stringify({
    files: ws.files,
    skills: ws.skills,
    memories: ws.memories,
    dailyNotes: ws.dailyNotes,
    canvas: ws.canvas,
    tickets: ws.tickets,
    sessions: ws.sessions,
  });
}

function event(
  kind: TraceKind,
  title: string,
  extra?: { detail?: string; status?: TraceEvent["status"]; at?: number },
): TraceEvent {
  return {
    id: uid("tr"),
    kind,
    title,
    detail: extra?.detail,
    at: extra?.at ?? Date.now(),
    status: extra?.status ?? "ok",
  };
}

export function toSkillMd(s: {
  name: string;
  description: string;
  instructions: string;
  triggers?: string[];
  status?: string;
}): string {
  const triggers = (s.triggers ?? []).join(", ");
  const desc = s.description.replace(/\n/g, " ").slice(0, 240);
  return `---
name: ${s.name}
description: ${desc}
triggers: [${triggers}]
status: ${s.status ?? "active"}
---

${s.instructions}
`;
}

export function matchSkills<
  T extends { name: string; triggers: string[]; uses: number; status: string; instructions: string },
>(skills: T[], text: string, limit = 3): T[] {
  const lower = text.toLowerCase();
  const live = skills.filter((s) => s.status !== "archived");
  const hits = live.filter((s) =>
    (s.triggers ?? []).some((t) => t && lower.includes(t.toLowerCase())),
  );
  if (hits.length) return hits.slice(0, limit);
  return [...live]
    .filter((s) => s.status === "active")
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 2);
}

export function applyMutation(ws: WorkspaceState, m: Mutation): WorkspaceState {
  const next: WorkspaceState = {
    ...ws,
    files: { ...ws.files },
    skills: [...ws.skills],
    memories: [...ws.memories],
    traces: [...(ws.traces ?? [])],
    canvas: [...(ws.canvas ?? [])],
    checkpoints: [...(ws.checkpoints ?? [])],
    wakes: [...(ws.wakes ?? [])],
    dailyNotes: [...(ws.dailyNotes ?? [])],
    messages: [...(ws.messages ?? [])],
    tickets: [...(ws.tickets ?? [])],
    usage: { ...(ws.usage ?? { promptTokens: 0, completionTokens: 0, turns: 0, toolCalls: 0, lastModel: "", lastProvider: "", lastAt: null, turnsSinceMemoryWrite: 0, lastTurnToolCalls: 0, skillNudge: false }) },
    sessions: [...(ws.sessions ?? [])],
  };

  switch (m.type) {
    case "write_memory": {
      if (m.mode === "replace") next.memories = [];
      next.memories.push({
        id: uid("mem"),
        text: m.text,
        kind: m.kind,
        at: Date.now(),
        source: "agent",
      });
      next.files.memory = rebuildMemoryFile(next);
      break;
    }
    case "update_user":
      next.files.user = m.content;
      break;
    case "update_soul":
      next.files.soul = m.content;
      break;
    case "update_heartbeat":
      next.files.heartbeat = m.content;
      break;
    case "create_skill": {
      const exists = next.skills.some((s) => s.name === m.name);
      if (!exists) {
        next.skills.unshift({
          id: uid("sk"),
          name: m.name,
          description: m.description,
          instructions: m.instructions,
          triggers: m.triggers,
          status: "new",
          uses: 0,
          lastUsedAt: null,
          createdAt: Date.now(),
          origin: "learned",
        });
      }
      break;
    }
    case "patch_skill": {
      next.skills = next.skills.map((s) =>
        s.name === m.name
          ? {
              ...s,
              instructions: m.instructions,
              origin: "patched" as const,
              status: s.status === "archived" ? s.status : "active",
            }
          : s,
      );
      break;
    }
    case "archive_skill": {
      next.skills = next.skills.map((s) =>
        s.name === m.name ? { ...s, status: "archived" as const } : s,
      );
      next.traces.unshift(event("skill", `Archived · ${m.name}`));
      break;
    }
    case "bump_skill": {
      next.skills = next.skills.map((s) =>
        s.name === m.name
          ? {
              ...s,
              uses: s.uses + 1,
              lastUsedAt: Date.now(),
              status: s.status === "new" ? "active" : s.status,
            }
          : s,
      );
      break;
    }
    case "canvas":
      next.canvas.unshift({
        ...m.card,
        id: uid("cv"),
        at: Date.now(),
      });
      next.canvas = next.canvas.slice(0, 12);
      break;
    case "checkpoint":
      next.checkpoints.unshift({
        id: uid("ck"),
        label: m.label,
        at: Date.now(),
        snapshot: snapshotOf(next),
      });
      next.checkpoints = next.checkpoints.slice(0, 20);
      next.traces.unshift(event("checkpoint", `Checkpoint · ${m.label}`));
      break;
    case "schedule_wake":
      next.wakes.unshift({
        id: uid("wk"),
        at: Date.now() + m.delayMinutes * 60_000,
        reason: m.reason,
        note: m.note,
        fired: false,
        notified: false,
      });
      next.traces.unshift(event("wake", `Wake gated · ${m.delayMinutes}m`, { detail: m.reason }));
      break;
    case "send_channel":
      next.traces.unshift(
        event("gateway", `Outbound queued · ${m.channelId}`, {
          detail: m.message.slice(0, 180),
        }),
      );
      break;
    case "install_hub": {
      const exists = next.skills.some((s) => s.name === m.name);
      if (!exists) {
        next.skills.unshift({
          id: uid("sk"),
          name: m.name,
          description: m.description,
          instructions: m.instructions,
          triggers: m.triggers,
          status: "active",
          uses: 0,
          lastUsedAt: null,
          createdAt: Date.now(),
          origin: "hub",
          slug: m.slug,
          registry: m.registry,
          version: m.version,
        });
        next.traces.unshift(event("skill", `Hub install · ${m.slug}`, { detail: m.registry }));
      }
      break;
    }
    case "daily_note": {
      const date = new Date().toISOString().slice(0, 10);
      const existing = next.dailyNotes.find((d) => d.date === date);
      if (existing) {
        next.dailyNotes = next.dailyNotes.map((d) =>
          d.date === date ? { ...d, content: `${d.content}\n${m.content}` } : d,
        );
      } else {
        next.dailyNotes.unshift({ date, content: m.content });
      }
      break;
    }
    case "create_ticket": {
      next.tickets.unshift({
        id: uid("tk"),
        title: m.title,
        body: m.body,
        status: m.status,
        at: Date.now(),
        updatedAt: Date.now(),
      });
      next.traces.unshift(event("tool", `Ticket · ${m.title}`, { detail: m.status }));
      break;
    }
    case "update_ticket": {
      next.tickets = next.tickets.map((t) =>
        t.id === m.id
          ? {
              ...t,
              title: m.title?.trim() ? m.title : t.title,
              body: m.body !== undefined ? m.body : t.body,
              status: m.status ?? t.status,
              updatedAt: Date.now(),
            }
          : t,
      );
      const hit = next.tickets.find((t) => t.id === m.id);
      next.traces.unshift(
        event("tool", `Ticket moved · ${hit?.title ?? m.id}`, {
          detail: m.status ?? "edited",
        }),
      );
      break;
    }
    case "remove_ticket": {
      next.tickets = next.tickets.filter((t) => t.id !== m.id);
      break;
    }
    default:
      break;
  }

  next.traces = next.traces.slice(0, 80);
  next.messages = next.messages.slice(-80);
  return next;
}

const HORIZON_STALE = 14 * 24 * 60 * 60 * 1000;
const HORIZON_ARCH = 90 * 24 * 60 * 60 * 1000;
const LEARNED_STALE = 7 * 24 * 60 * 60 * 1000;
const LEARNED_ARCH = 30 * 24 * 60 * 60 * 1000;
const MEMORY_CAP = 48;

export function curatorPass(
  ws: WorkspaceState,
  now = Date.now(),
): { skills: Skill[]; memories: MemoryEntry[]; files: WorkspaceFiles; detail: string } {
  let skills = ws.skills.map((s) => {
    const age = s.lastUsedAt ? now - s.lastUsedAt : now - s.createdAt;
    let status: SkillStatus = s.status;
    if (s.status === "archived") return s;
    if (s.origin === "learned" && s.uses === 0) {
      if (age > LEARNED_ARCH) status = "archived";
      else if (age > LEARNED_STALE) status = "stale";
      else status = "new";
    } else if (age > HORIZON_ARCH) status = "archived";
    else if (age > HORIZON_STALE) status = "stale";
    else if (s.uses > 0) status = "active";
    return { ...s, status };
  });

  let consolidated = 0;
  const live = skills.filter((s) => s.status !== "archived");
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      const shared = (a.triggers ?? []).filter((t) =>
        (b.triggers ?? []).some((u) => u.toLowerCase() === t.toLowerCase()),
      );
      if (shared.length < 2) continue;
      const drop = a.uses <= b.uses ? a : b;
      const keep = drop === a ? b : a;
      skills = skills.map((s) =>
        s.name === drop.name && s.status !== "archived"
          ? {
              ...s,
              status: "archived" as const,
              instructions: `${s.instructions}\n\nSuperseded by ${keep.name} (shared triggers: ${shared.join(", ")}).`,
            }
          : s,
      );
      consolidated += 1;
    }
  }

  let memories = [...ws.memories];
  if (memories.length > MEMORY_CAP) {
    const overflow = memories.length - MEMORY_CAP;
    const episodes = memories.filter((m) => m.kind === "episode");
    const dropIds = new Set(
      [...episodes]
        .sort((a, b) => a.at - b.at)
        .slice(0, overflow)
        .map((m) => m.id),
    );
    if (dropIds.size < overflow) {
      for (const m of [...memories].sort((a, b) => a.at - b.at)) {
        if (dropIds.size >= overflow) break;
        if (m.kind === "preference" || m.kind === "lesson") continue;
        dropIds.add(m.id);
      }
    }
    memories = memories.filter((m) => !dropIds.has(m.id));
  }

  const files = { ...ws.files, memory: rebuildMemoryFile({ memories }) };
  const archived = skills.filter((s) => s.status === "archived").length;
  const detail = `Lifecycle ${skills.length} skills (${archived} archived${consolidated ? `, ${consolidated} folded` : ""}). Memory ${memories.length}/${MEMORY_CAP}.`;
  return { skills, memories, files, detail };
}

export function todayKey(at = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

export const DEMO_SESSION_IDS = [
  "whatsapp:353",
  "telegram:ada",
  "telegram:donal",
  "slack:ops",
  "slack:ciara",
  "discord:mod",
  "email:brief",
];
