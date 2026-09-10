import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { CHANNELS, PADDY_PROFILE, POLICY, PROFILES, newAgentWorkspace, seedWorkspaces } from "./defaults";
import { getHubSkill } from "./hub";
import { defaultBrainKeys, defaultProviders, keysForSlot, PROVIDER_DEFS, slotForBrainKey, TOKEN_MAX, type BrainKeys, type KeySlot, type ProviderId, type ProviderState } from "./providers";
import type {
  Channel,
  HelixTurnResult,
  Mutation,
  Policy,
  ProfileMeta,
  SkillStatus,
  ToolName,
  TraceEvent,
  TraceKind,
  ViewId,
  WorkspaceState,
} from "./types";

function mergeProviderState(
  saved: ProviderState[] | undefined,
  defaults: ProviderState[],
): ProviderState[] {
  const map = new Map((saved ?? []).map((p) => [p.id, p]));
  return defaults.map((d) => map.get(d.id) ?? d);
}

function rebuildMemoryFile(ws: WorkspaceState): string {
  const lines = ws.memories.map((m) => `- (${m.kind}) ${m.text}`);
  return `# MEMORY.md\n\n${lines.join("\n") || "- (empty)"}`;
}

function snapshotOf(ws: WorkspaceState): string {
  return JSON.stringify({
    files: ws.files,
    skills: ws.skills,
    memories: ws.memories,
    dailyNotes: ws.dailyNotes,
    canvas: ws.canvas,
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

function applyMutation(ws: WorkspaceState, m: Mutation): WorkspaceState {
  const next: WorkspaceState = {
    ...ws,
    files: { ...ws.files },
    skills: [...ws.skills],
    memories: [...ws.memories],
    traces: [...ws.traces],
    canvas: [...ws.canvas],
    checkpoints: [...ws.checkpoints],
    wakes: [...ws.wakes],
    dailyNotes: [...ws.dailyNotes],
    messages: [...ws.messages],
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
      });
      next.traces.unshift(event("wake", `Wake gated · ${m.delayMinutes}m`, { detail: m.reason }));
      break;
    case "send_channel":
      next.traces.unshift(
        event("gateway", `Outbound · ${m.channelId}`, { detail: m.message.slice(0, 180) }),
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
        next.traces.unshift(
          event("skill", `Hub install · ${m.slug}`, { detail: m.registry }),
        );
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
    default:
      break;
  }

  next.traces = next.traces.slice(0, 80);
  next.messages = next.messages.slice(-80);
  return next;
}

export interface HelixStore {
  view: ViewId;
  moreOpen: boolean;
  inspector: "loop" | "canvas" | "context";
  hydrated: boolean;
  busy: boolean;
  error: string | null;
  activeProfileId: string;
  profiles: ProfileMeta[];
  channels: Channel[];
  policy: Policy;
  workspaces: Record<string, WorkspaceState>;
  lastPulseAt: number;
  pendingApproval: {
    tool: ToolName;
    args: Record<string, string>;
    reason: string;
  } | null;
  providers: ProviderState[];
  preferredProvider: ProviderId;
  brainKeys: BrainKeys;
  envFlags: Record<string, boolean>;
  setView: (view: ViewId) => void;
  setMoreOpen: (open: boolean) => void;
  setInspector: (tab: "loop" | "canvas" | "context") => void;
  setHydrated: () => void;
  setProfile: (id: string) => void;
  addAgent: (name: string, role: string) => { ok: true; id: string } | { ok: false; error: string };
  removeAgent: (id: string) => boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  ws: () => WorkspaceState;
  updateFiles: (patch: Partial<WorkspaceState["files"]>) => void;
  applyResult: (userText: string, channelId: string | undefined, result: HelixTurnResult) => void;
  admitChannel: (channelId: string) => string | null;
  approvePair: (channelId: string) => void;
  denyPair: (channelId: string) => void;
  firePulse: () => { woke: boolean; detail: string };
  admitWake: (id: string) => string | null;
  runCurator: () => void;
  rollback: (checkpointId: string) => void;
  manualCheckpoint: (label: string) => void;
  resolveApproval: (allow: boolean) => void;
  applySubagent: (text: string, ok: boolean) => void;
  setPolicy: (tool: ToolName, require: boolean) => void;
  resetWorkspace: () => void;
  installHubSkill: (slug: string) => { ok: boolean; detail: string };
  uninstallSkill: (name: string) => void;
  pairProvider: (id: ProviderId) => void;
  unpairProvider: (id: ProviderId) => void;
  setPreferredProvider: (id: ProviderId) => void;
  markSuperGrokLive: (live: boolean) => void;
  setBrainKey: (slot: keyof BrainKeys, value: string) => void;
  applyBrainPatch: (patch: BrainKeys) => void;
  clearBrainSlot: (slot: keyof BrainKeys) => void;
  clearProviderSlot: (slot: KeySlot) => void;
  setEnvFlags: (flags: Record<string, boolean>) => void;
}

function patchWs(
  workspaces: Record<string, WorkspaceState>,
  id: string,
  fn: (ws: WorkspaceState) => WorkspaceState,
): Record<string, WorkspaceState> {
  return { ...workspaces, [id]: fn(workspaces[id]!) };
}

type PersistedHelix = Partial<
  Pick<
    HelixStore,
    | "activeProfileId"
    | "profiles"
    | "channels"
    | "policy"
    | "workspaces"
    | "lastPulseAt"
    | "providers"
    | "preferredProvider"
    | "brainKeys"
  >
>;

export const useHelix = create<HelixStore>()(
  persist(
    (set, get) => ({
      view: "console",
      moreOpen: false,
      inspector: "loop",
      hydrated: false,
      busy: false,
      error: null,
      activeProfileId: "paddy",
      profiles: PROFILES,
      channels: CHANNELS,
      policy: POLICY,
      workspaces: seedWorkspaces(),
      lastPulseAt: Date.now() - 12 * 60_000,
      pendingApproval: null,
      providers: defaultProviders(),
      preferredProvider: "supergrok",
      brainKeys: defaultBrainKeys(),
      envFlags: {},
      setView: (view) => set({ view, moreOpen: false }),
      setMoreOpen: (moreOpen) => set({ moreOpen }),
      setInspector: (inspector) => set({ inspector }),
      setHydrated: () => set({ hydrated: true }),
      setProfile: (id) => {
        if (!get().workspaces[id]) return;
        set({ activeProfileId: id, view: "console" });
      },
      addAgent: (name, role) => {
        const trimmed = name.trim().slice(0, 40);
        if (!trimmed) return { ok: false, error: "Name the agent." };
        const taken = get().profiles.some(
          (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (taken) return { ok: false, error: "That name is already in use." };
        if (get().profiles.length >= 12) return { ok: false, error: "Twelve agents is enough." };
        const id = uid("ag");
        const roleText = role.trim().slice(0, 80) || "Custom mind";
        set({
          profiles: [...get().profiles, { id, name: trimmed, role: roleText }],
          workspaces: {
            ...get().workspaces,
            [id]: newAgentWorkspace(trimmed, roleText),
          },
          activeProfileId: id,
          view: "console",
        });
        return { ok: true, id };
      },
      removeAgent: (id) => {
        if (id === "paddy") return false;
        if (!get().workspaces[id]) return false;
        const { [id]: _dropped, ...rest } = get().workspaces;
        set({
          profiles: get().profiles.filter((p) => p.id !== id),
          workspaces: rest,
          activeProfileId: get().activeProfileId === id ? "paddy" : get().activeProfileId,
          view: get().activeProfileId === id ? "console" : get().view,
        });
        return true;
      },
      setBusy: (busy) => set({ busy }),
      setError: (error) => set({ error }),
      ws: () => get().workspaces[get().activeProfileId]!,
      updateFiles: (patch) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            files: { ...ws.files, ...patch },
          })),
        });
      },
      applyResult: (userText, channelId, result) => {
        const id = get().activeProfileId;
        const at = Date.now();
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => {
            let next: WorkspaceState = {
              ...ws,
              messages: [
                ...ws.messages,
                {
                  id: uid("msg"),
                  role: "user",
                  content: userText,
                  channelId,
                  at,
                },
              ],
            };
            if (result.ok) {
              for (const m of result.mutations) next = applyMutation(next, m);
              next = {
                ...next,
                messages: [
                  ...next.messages,
                  {
                    id: uid("msg"),
                    role: "assistant",
                    content: result.text,
                    at: Date.now(),
                  },
                ],
                traces: [
                  ...result.traces.map((t) => ({
                    ...t,
                    id: uid("tr"),
                    at: Date.now(),
                  })),
                  ...next.traces,
                ].slice(0, 80),
              };
              const lower = userText.toLowerCase();
              next.skills = next.skills.map((s) =>
                s.triggers.some((tr) => lower.includes(tr.toLowerCase()))
                  ? {
                      ...s,
                      uses: s.uses + 1,
                      lastUsedAt: Date.now(),
                      status: s.status === "new" ? "active" : s.status,
                    }
                  : s,
              );
            } else {
              next = {
                ...next,
                messages: [
                  ...next.messages,
                  {
                    id: uid("msg"),
                    role: "assistant",
                    content: result.error,
                    at: Date.now(),
                  },
                ],
                traces: [
                  {
                    id: uid("tr"),
                    kind: "model",
                    title: "Turn failed",
                    detail: result.error,
                    at: Date.now(),
                    status: "error",
                  },
                  ...next.traces,
                ],
              };
            }
            next.messages = next.messages.slice(-80);
            return next;
          }),
          pendingApproval: result.ok ? (result.pendingApproval ?? null) : null,
          error: result.ok ? null : result.error,
          busy: false,
        });
        if (channelId) {
          set({
            channels: get().channels.map((c) =>
              c.id === channelId ? { ...c, unread: 0 } : c,
            ),
          });
        }
      },
      admitChannel: (channelId) => {
        const ch = get().channels.find((c) => c.id === channelId);
        if (!ch?.lastMessage) return null;
        if (ch.pendingPair) return null;
        set({
          channels: get().channels.map((c) =>
            c.id === channelId ? { ...c, unread: 0 } : c,
          ),
          view: "console",
        });
        return `[${ch.name} · ${ch.lastMessage.from}] ${ch.lastMessage.text}`;
      },
      approvePair: (channelId) => {
        set({
          channels: get().channels.map((c) => {
            if (c.id !== channelId || !c.pendingPair) return c;
            const from = c.pendingPair.from;
            return {
              ...c,
              status: "connected" as const,
              unread: 0,
              pendingPair: undefined,
              allowFrom: [...(c.allowFrom ?? []), from],
            };
          }),
        });
      },
      denyPair: (channelId) => {
        set({
          channels: get().channels.map((c) =>
            c.id === channelId
              ? { ...c, pendingPair: undefined, unread: 0, lastMessage: undefined }
              : c,
          ),
        });
      },
      firePulse: () => {
        const due = get()
          .ws()
          .wakes.find((w) => !w.fired && w.at <= Date.now());
        const at = Date.now();
        set({ lastPulseAt: at });
        const id = get().activeProfileId;
        if (!due) {
          set({
            workspaces: patchWs(get().workspaces, id, (ws) => ({
              ...ws,
              traces: [
                event("wake", "Heartbeat · gate closed", {
                  detail: "No matching watch. Model not woken.",
                  at,
                }),
                ...ws.traces,
              ].slice(0, 80),
            })),
          });
          return { woke: false, detail: "Gate closed. Silence is cheaper." };
        }
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            wakes: ws.wakes.map((w) => (w.id === due.id ? { ...w, fired: true } : w)),
            traces: [
              event("wake", "Heartbeat · gate open", {
                detail: due.reason,
                at,
                status: "warn",
              }),
              ...ws.traces,
            ].slice(0, 80),
          })),
        });
        return { woke: true, detail: due.note };
      },
      admitWake: (wakeId) => {
        const w = get().ws().wakes.find((x) => x.id === wakeId);
        if (!w) return null;
        const id = get().activeProfileId;
        set({
          view: "console",
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            wakes: ws.wakes.map((x) => (x.id === wakeId ? { ...x, fired: true } : x)),
          })),
        });
        return `[gated wake · ${w.reason}]\n${w.note}`;
      },
      runCurator: () => {
        const id = get().activeProfileId;
        const horizonStale = 14 * 24 * 60 * 60 * 1000;
        const horizonArch = 90 * 24 * 60 * 60 * 1000;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => {
            const skills = ws.skills.map((s) => {
              if (s.origin === "seeded" && s.status === "active") return s;
              const age = s.lastUsedAt ? Date.now() - s.lastUsedAt : Date.now() - s.createdAt;
              let status: SkillStatus = s.status;
              if (s.uses === 0 && s.origin === "learned") status = "new";
              else if (age > horizonArch) status = "archived";
              else if (age > horizonStale) status = "stale";
              else if (s.uses > 0) status = "active";
              return { ...s, status };
            });
            return {
              ...ws,
              skills,
              traces: [
                event("skill", "Curator pass", {
                  detail: "Lifecycle reconciled (new → active → stale → archived).",
                }),
                ...ws.traces,
              ].slice(0, 80),
            };
          }),
        });
      },
      rollback: (checkpointId) => {
        const id = get().activeProfileId;
        const ck = get().ws().checkpoints.find((c) => c.id === checkpointId);
        if (!ck) return;
        try {
          const parsed = JSON.parse(ck.snapshot) as Pick<
            WorkspaceState,
            "files" | "skills" | "memories" | "dailyNotes" | "canvas"
          >;
          set({
            workspaces: patchWs(get().workspaces, id, (ws) => ({
              ...ws,
              files: parsed.files,
              skills: parsed.skills,
              memories: parsed.memories,
              dailyNotes: parsed.dailyNotes ?? ws.dailyNotes,
              canvas: parsed.canvas ?? [],
              traces: [
                event("checkpoint", `Rolled back · ${ck.label}`, { status: "warn" }),
                ...ws.traces,
              ].slice(0, 80),
            })),
          });
        } catch {
          /* ignore bad snapshot */
        }
      },
      manualCheckpoint: (label) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) =>
            applyMutation(ws, { type: "checkpoint", label }),
          ),
        });
      },
      resolveApproval: (allow) => {
        const pending = get().pendingApproval;
        if (!pending) return;
        const id = get().activeProfileId;
        if (allow && pending.tool === "send_channel") {
          set({
            workspaces: patchWs(get().workspaces, id, (ws) =>
              applyMutation(ws, {
                type: "send_channel",
                channelId: pending.args.channelId ?? "web",
                message: pending.args.message ?? "",
              }),
            ),
            channels: get().channels.map((c) =>
              c.id === pending.args.channelId
                ? {
                    ...c,
                    lastMessage: {
                      from: get().profiles.find((p) => p.id === id)?.name ?? "Paddy Irishman",
                      text: pending.args.message ?? "",
                      at: Date.now(),
                    },
                    status: c.status === "offline" ? c.status : "connected",
                  }
                : c,
            ),
          });
        } else if (!allow) {
          set({
            workspaces: patchWs(get().workspaces, id, (ws) => ({
              ...ws,
              traces: [
                event("permission", `Denied · ${pending.tool}`, { status: "warn" }),
                ...ws.traces,
              ].slice(0, 80),
            })),
          });
        }
        set({ pendingApproval: null });
      },
      applySubagent: (text, ok) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            messages: [
              ...ws.messages,
              {
                id: uid("msg"),
                role: "assistant" as const,
                content: text,
                at: Date.now(),
              },
            ].slice(-80),
            traces: [
              event("subagent", ok ? "Subagent ran" : "Subagent failed", {
                detail: text.slice(0, 280),
                status: ok ? "ok" : "error",
              }),
              ...ws.traces,
            ].slice(0, 80),
          })),
          busy: false,
        });
      },
      setPolicy: (tool, require) => {
        const policy = get().policy;
        const auto = policy.autoApprove.filter((t) => t !== tool);
        const req = policy.requireApproval.filter((t) => t !== tool);
        if (require) req.push(tool);
        else auto.push(tool);
        set({ policy: { autoApprove: auto, requireApproval: req } });
      },
      resetWorkspace: () => {
        set({
          workspaces: seedWorkspaces(),
          profiles: PROFILES,
          channels: CHANNELS,
          policy: POLICY,
          pendingApproval: null,
          error: null,
          activeProfileId: "paddy",
          view: "console",
          providers: defaultProviders(),
          preferredProvider: "supergrok",
        });
      },
      installHubSkill: (slug) => {
        const found = getHubSkill(slug);
        if (!found) return { ok: false, detail: "Unknown skill." };
        const id = get().activeProfileId;
        const ws = get().ws();
        if (ws.skills.some((s) => s.name === found.name)) {
          return { ok: false, detail: `${found.name} is already installed.` };
        }
        set({
          workspaces: patchWs(get().workspaces, id, (cur) =>
            applyMutation(cur, {
              type: "install_hub",
              name: found.name,
              description: found.description,
              instructions: found.instructions,
              triggers: found.triggers,
              slug: found.slug,
              registry: found.registry,
              version: found.version,
            }),
          ),
        });
        return { ok: true, detail: `Installed ${found.slug}` };
      },
      uninstallSkill: (name) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            skills: ws.skills.filter((s) => s.name !== name),
            traces: [
              event("skill", `Uninstalled · ${name}`),
              ...ws.traces,
            ].slice(0, 80),
          })),
        });
      },
      pairProvider: (pid) => {
        const list = get().providers?.length ? get().providers : defaultProviders();
        set({
          providers: list.map((p) =>
            p.id === pid
              ? { ...p, status: pid === "supergrok" ? "live" : "paired", pairedAt: Date.now() }
              : p,
          ),
        });
      },
      unpairProvider: (pid) => {
        if (pid === "supergrok") return;
        const list = get().providers?.length ? get().providers : defaultProviders();
        set({
          providers: list.map((p) =>
            p.id === pid ? { ...p, status: "idle", pairedAt: null } : p,
          ),
          preferredProvider: get().preferredProvider === pid ? "supergrok" : get().preferredProvider,
        });
      },
      setPreferredProvider: (pid) => {
        const list = get().providers?.length ? get().providers : defaultProviders();
        const st = list.find((p) => p.id === pid);
        if (!st) return;
        set({ preferredProvider: pid });
      },
      markSuperGrokLive: (live) => {
        const list = get().providers?.length ? get().providers : defaultProviders();
        set({
          providers: list.map((p) =>
            p.id === "supergrok"
              ? {
                  ...p,
                  status: live ? "live" : p.status === "live" ? "idle" : p.status,
                  pairedAt: live ? p.pairedAt ?? Date.now() : p.pairedAt,
                }
              : p,
          ),
        });
      },
      setBrainKey: (slot, value) => {
        get().applyBrainPatch({ [slot]: value });
      },
      applyBrainPatch: (patch) => {
        const brainKeys: BrainKeys = { ...get().brainKeys };
        for (const [k, v] of Object.entries(patch)) {
          const trimmed = (v ?? "").trim().slice(0, TOKEN_MAX);
          if (trimmed) brainKeys[k] = trimmed;
          else delete brainKeys[k];
        }
        const list = get().providers?.length ? get().providers : defaultProviders();
        const now = Date.now();
        const touched = new Set(
          Object.keys(patch)
            .map(slotForBrainKey)
            .filter((s): s is KeySlot => Boolean(s)),
        );
        const providers = list.map((p) => {
          const def = PROVIDER_DEFS.find((d) => d.id === p.id);
          if (!def || !touched.has(def.slot)) return p;
          const connected = keysForSlot(def.slot).some((k) => Boolean(brainKeys[k]?.trim()));
          if (!connected && def.id !== "supergrok") {
            return { ...p, status: "idle" as const, pairedAt: null };
          }
          if (!connected) return p;
          return {
            ...p,
            status: p.id === "supergrok" ? ("live" as const) : ("paired" as const),
            pairedAt: now,
          };
        });
        set({ brainKeys, providers });
      },
      clearBrainSlot: (slot) => {
        get().applyBrainPatch({ [slot]: "" });
        if (slot !== "xai") {
          const preferred = get().preferredProvider;
          const def = PROVIDER_DEFS.find((d) => d.id === preferred);
          const keySlot = slotForBrainKey(String(slot));
          if (def?.slot === keySlot) set({ preferredProvider: "supergrok" });
        }
      },
      clearProviderSlot: (slot) => {
        const patch: BrainKeys = {};
        for (const k of keysForSlot(slot)) patch[k] = "";
        get().applyBrainPatch(patch);
        const preferred = get().preferredProvider;
        const def = PROVIDER_DEFS.find((d) => d.id === preferred);
        if (def?.slot === slot && slot !== "xai") set({ preferredProvider: "supergrok" });
      },
      setEnvFlags: (flags) => set({ envFlags: flags }),
    }),
    {
      name: "paddy-harness-v1",
      skipHydration: true,
      partialize: (s) => ({
        activeProfileId: s.activeProfileId,
        profiles: s.profiles,
        channels: s.channels,
        policy: s.policy,
        workspaces: s.workspaces,
        lastPulseAt: s.lastPulseAt,
        providers: s.providers,
        preferredProvider: s.preferredProvider,
        brainKeys: s.brainKeys,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as PersistedHelix;
        const workspaces = { ...current.workspaces, ...p.workspaces };
        if (workspaces.helix && !workspaces.paddy) {
          workspaces.paddy = workspaces.helix;
        }
        delete workspaces.scout;
        delete workspaces.forge;
        delete workspaces.helix;
        if (!workspaces.paddy) {
          workspaces.paddy = current.workspaces.paddy;
        }
        let profiles = (p.profiles ?? current.profiles)
          .map((pr) => {
            if (pr.id === "helix") return { ...pr, id: "paddy", name: "Paddy Irishman" };
            if (pr.id === "paddy" && (pr.name === "Paddy" || !pr.name)) {
              return { ...pr, name: "Paddy Irishman" };
            }
            return pr;
          })
          .filter((pr) => pr.id !== "scout" && pr.id !== "forge" && pr.id !== "helix")
          .filter((pr) => pr.id === "paddy" || Boolean(workspaces[pr.id]));
        if (!profiles.some((pr) => pr.id === "paddy")) {
          profiles = [PADDY_PROFILE, ...profiles];
        }
        let activeProfileId = p.activeProfileId ?? current.activeProfileId;
        if (
          activeProfileId === "helix" ||
          activeProfileId === "scout" ||
          activeProfileId === "forge" ||
          !workspaces[activeProfileId]
        ) {
          activeProfileId = "paddy";
        }
        return {
          ...current,
          ...p,
          workspaces,
          activeProfileId,
          profiles,
          providers: mergeProviderState(p.providers, defaultProviders()),
          preferredProvider: p.preferredProvider ?? "supergrok",
          brainKeys: { ...defaultBrainKeys(), ...(p.brainKeys ?? {}) },
          policy: {
            autoApprove: (p.policy?.autoApprove ?? current.policy.autoApprove).filter(
              (t) => t !== "spawn_subagent",
            ),
            requireApproval: Array.from(
              new Set([
                ...(p.policy?.requireApproval ?? current.policy.requireApproval),
                "spawn_subagent",
                "send_channel",
              ]),
            ),
          },
          channels: (p.channels ?? current.channels).map((c) => {
            if (c.id !== "whatsapp") return c;
            const seed = current.channels.find((x) => x.id === "whatsapp");
            if (!seed?.pendingPair || c.pendingPair) return c;
            if (c.status === "connected" && (c.allowFrom?.length ?? 0) > 0) return c;
            if (!c.lastMessage) return c;
            return {
              ...c,
              pendingPair: seed.pendingPair,
              status: "pairing" as const,
              lastMessage: seed.lastMessage ?? c.lastMessage,
              unread: Math.max(c.unread, 1),
              blurb: seed.blurb,
            };
          }),
        };
      },
    },
  ),
);
