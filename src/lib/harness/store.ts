import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uid } from "@/lib/utils";
import { CHANNELS, PADDY_PROFILE, POLICY, PROFILES, WEB_SESSION_ID, emptyUsage, newAgentWorkspace, seedSessions, seedWorkspaces, webSession } from "./defaults";
import { getHubSkill } from "./hub";
import { applyMutation, curatorPass, DEMO_SESSION_IDS, matchSkills, parseMemoryFile, parseSkillMd } from "./mutate";
import { persistBrainKeys } from "./config-api";
import { defaultBrainKeys, defaultModelByProvider, defaultProviders, keysForSlot, normalizeProviderId, PROVIDER_DEFS, slotConnected, slotForBrainKey, TOKEN_MAX, type BrainKeys, type KeySlot, type ProviderId, type ProviderState } from "./providers";
import type {
  Channel,
  HelixTurnResult,
  Policy,
  ProfileMeta,
  Session,
  Skill,
  TicketStatus,
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
  const map = new Map<string, ProviderState>((saved ?? []).map((p) => [p.id, p]));
  if (!map.has("laguna")) {
    const old = map.get("laguna-s") ?? map.get("laguna-xs");
    if (old) map.set("laguna", { ...old, id: "laguna" });
  }
  if (!map.has("chatgpt")) {
    const old = map.get("chatgpt-plus") ?? map.get("chatgpt-pro");
    if (old) map.set("chatgpt", { ...old, id: "chatgpt" });
  }
  if (!map.has("claude")) {
    const old = map.get("claude-pro") ?? map.get("claude-max");
    if (old) map.set("claude", { ...old, id: "claude" });
  }
  return defaults.map((d) => map.get(d.id) ?? d);
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
    profileId?: string;
    sessionId?: string;
  } | null;
  pendingQueue: {
    tool: ToolName;
    args: Record<string, string>;
    reason: string;
    profileId?: string;
    sessionId?: string;
  }[];
  providers: ProviderState[];
  preferredProvider: ProviderId;
  modelByProvider: Partial<Record<ProviderId, string>>;
  brainKeys: BrainKeys;
  envFlags: Record<string, boolean>;
  activeSessionId: string;
  setView: (view: ViewId) => void;
  setMoreOpen: (open: boolean) => void;
  setInspector: (tab: "loop" | "canvas" | "context") => void;
  setHydrated: () => void;
  setProfile: (id: string) => void;
  addAgent: (name: string, role: string) => { ok: true; id: string } | { ok: false; error: string };
  removeAgent: (id: string) => boolean;
  addTicket: (title: string, body?: string) => void;
  moveTicket: (id: string, status: TicketStatus) => void;
  removeTicket: (id: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  ws: () => WorkspaceState;
  updateFiles: (patch: Partial<WorkspaceState["files"]>) => void;
  applyResult: (
    userText: string,
    channelId: string | undefined,
    result: HelixTurnResult,
    sessionId?: string,
    profileId?: string,
  ) => void;
  commitTurn: (
    userText: string,
    channelId: string | undefined,
    result: HelixTurnResult,
    sessionId?: string,
    profileId?: string,
  ) => void;
  replaceWorkspace: (id: string, ws: WorkspaceState) => void;
  hydrateWorkspaces: (all: Record<string, WorkspaceState>) => void;
  openSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  admitChannel: (channelId: string) => string | null;
  approvePair: (channelId: string) => void;
  denyPair: (channelId: string) => void;
  mergeLiveChannels: (
    rows: Array<{
      id: string;
      status?: Channel["status"];
      configured?: boolean;
      error?: string;
      label?: string;
      lastAt?: number;
      lastMessage?: { from: string; text: string };
      pending?: number;
    }>,
    pending?: Array<{ channelId: string; from: string; text: string; code: string; at: number }>,
  ) => void;
  firePulse: () => { woke: boolean; detail: string; fresh: boolean };
  admitWake: (id: string) => string | null;
  runCurator: () => void;
  rollback: (checkpointId: string) => void;
  manualCheckpoint: (label: string) => void;
  resolveApproval: (allow: boolean) => void;
  applySubagent: (text: string, ok: boolean, profileId?: string) => void;
  setPolicy: (tool: ToolName, require: boolean) => void;
  resetWorkspace: () => void;
  installHubSkill: (slug: string) => { ok: boolean; detail: string };
  uninstallSkill: (name: string) => void;
  createSkill: (input: {
    name: string;
    description: string;
    instructions: string;
    triggers: string[];
  }) => { ok: true } | { ok: false; error: string };
  importSkillMd: (
    markdown: string,
  ) => { ok: true; name: string; updated: boolean; detail: string } | { ok: false; error: string };
  patchSkill: (
    name: string,
    patch: { description?: string; instructions?: string; triggers?: string[] },
  ) => void;
  setSkillStatus: (name: string, status: Skill["status"]) => void;
  pairProvider: (id: ProviderId) => void;
  unpairProvider: (id: ProviderId) => void;
  setPreferredProvider: (id: ProviderId) => void;
  setProviderModel: (id: ProviderId, model: string) => void;
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

function touchSession(
  sessions: Session[],
  opts: {
    id: string;
    channelId: string;
    preview: string;
    title?: string;
    peer?: string;
    unread?: number;
    clearUnread?: boolean;
  },
): Session[] {
  const at = Date.now();
  const preview = opts.preview.slice(0, 160);
  const found = sessions.some((s) => s.id === opts.id);
  if (!found) {
    return [
      {
        id: opts.id,
        channelId: opts.channelId,
        title: opts.title ?? opts.peer ?? opts.channelId,
        peer: opts.peer,
        lastAt: at,
        preview,
        unread: opts.clearUnread ? 0 : (opts.unread ?? 0),
      },
      ...sessions,
    ];
  }
  return sessions.map((s) =>
    s.id === opts.id
      ? {
          ...s,
          lastAt: at,
          preview,
          unread: opts.clearUnread ? 0 : s.unread + (opts.unread ?? 0),
        }
      : s,
  );
}

type PersistedHelix = Partial<
  Pick<
    HelixStore,
    | "activeProfileId"
    | "profiles"
    | "channels"
    | "policy"
    | "lastPulseAt"
    | "providers"
    | "preferredProvider"
    | "modelByProvider"
    | "brainKeys"
    | "activeSessionId"
    | "pendingApproval"
    | "pendingQueue"
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
      pendingQueue: [],
      providers: defaultProviders(),
      preferredProvider: "supergrok",
      modelByProvider: defaultModelByProvider(),
      brainKeys: defaultBrainKeys(),
      envFlags: {},
      activeSessionId: WEB_SESSION_ID,
      setView: (view) => set({ view, moreOpen: false }),
      setMoreOpen: (moreOpen) => set({ moreOpen }),
      setInspector: (inspector) => set({ inspector }),
      setHydrated: () => set({ hydrated: true }),
      setProfile: (id) => {
        if (!get().workspaces[id]) return;
        const web =
          get().workspaces[id]!.sessions?.find((s) => s.channelId === "web")?.id ?? WEB_SESSION_ID;
        set({ activeProfileId: id, activeSessionId: web });
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
          activeSessionId: WEB_SESSION_ID,
          view: "console",
        });
        return { ok: true, id };
      },
      removeAgent: (id) => {
        if (id === "paddy") return false;
        if (!get().workspaces[id]) return false;
        const { [id]: _dropped, ...rest } = get().workspaces;
        const nextId = get().activeProfileId === id ? "paddy" : get().activeProfileId;
        const web =
          rest[nextId]?.sessions?.find((s) => s.channelId === "web")?.id ?? WEB_SESSION_ID;
        set({
          profiles: get().profiles.filter((p) => p.id !== id),
          workspaces: rest,
          activeProfileId: nextId,
          activeSessionId: get().activeProfileId === id ? web : get().activeSessionId,
          view: get().activeProfileId === id ? "console" : get().view,
        });
        return true;
      },
      addTicket: (title, body) => {
        const trimmed = title.trim().slice(0, 120);
        if (!trimmed) return;
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) =>
            applyMutation(ws, {
              type: "create_ticket",
              title: trimmed,
              body: (body ?? "").trim().slice(0, 800),
              status: "backlog",
            }),
          ),
        });
      },
      moveTicket: (ticketId, status) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) =>
            applyMutation(ws, { type: "update_ticket", id: ticketId, status }),
          ),
        });
      },
      removeTicket: (ticketId) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) =>
            applyMutation(ws, { type: "remove_ticket", id: ticketId }),
          ),
        });
      },
      openSession: (sessionId) => {
        const id = get().activeProfileId;
        set({
          activeSessionId: sessionId,
          view: "sessions",
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            sessions: (ws.sessions ?? []).map((s) =>
              s.id === sessionId ? { ...s, unread: 0 } : s,
            ),
          })),
        });
      },
      setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
      setBusy: (busy) => set({ busy }),
      setError: (error) => set({ error }),
      ws: () => get().workspaces[get().activeProfileId]!,
      updateFiles: (patch) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => {
            const files = { ...ws.files, ...patch };
            if (typeof patch.memory !== "string") return { ...ws, files };
            const parsed = parseMemoryFile(patch.memory);
            if (parsed.length) return { ...ws, files, memories: parsed };
            const stripped = patch.memory.replace(/^#\s*MEMORY\.md\s*/i, "").trim();
            if (!stripped || stripped === "- (empty)") {
              return { ...ws, files, memories: [] };
            }
            return {
              ...ws,
              files,
              memories: [
                {
                  id: uid("mem"),
                  text: stripped.slice(0, 800),
                  kind: "fact" as const,
                  at: Date.now(),
                  source: "editor",
                },
              ],
            };
          }),
        });
      },
      applyResult: (userText, channelId, result, sessionId, profileId) => {
        const id =
          profileId && get().workspaces[profileId] ? profileId : get().activeProfileId;
        const at = Date.now();
        const sid =
          sessionId ||
          (channelId && channelId !== "web" ? `${channelId}:inbox` : WEB_SESSION_ID);
        const ch = channelId || "web";
        const isActive = sid === get().activeSessionId && get().view === "sessions";
        const isWebConsole = sid === WEB_SESSION_ID && get().view === "console";
        const clearUnread = isActive || isWebConsole || ch === "web";
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
                  channelId: ch,
                  sessionId: sid,
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
                    channelId: ch,
                    sessionId: sid,
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
              const matched = matchSkills(next.skills, userText, 5);
              const already = new Set(
                result.mutations
                  .filter((m): m is Extract<typeof m, { type: "bump_skill" }> => m.type === "bump_skill")
                  .map((m) => m.name),
              );
              next.skills = next.skills.map((s) =>
                matched.some((m) => m.name === s.name) && !already.has(s.name)
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
                    channelId: ch,
                    sessionId: sid,
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
            next.messages = next.messages.slice(-120);
            next.sessions = touchSession(next.sessions ?? [], {
              id: sid,
              channelId: ch,
              preview: result.ok ? result.text : userText,
              clearUnread,
              unread: clearUnread ? 0 : 1,
            });
            if (result.usage) {
              const prev = next.usage ?? emptyUsage();
              const wroteMemory = result.ok
                ? result.mutations.some(
                    (m) => m.type === "write_memory" || m.type === "update_user",
                  )
                : false;
              const wroteSkill = result.ok
                ? result.mutations.some(
                    (m) =>
                      m.type === "create_skill" ||
                      m.type === "patch_skill" ||
                      m.type === "install_hub" ||
                      m.type === "archive_skill",
                  )
                : false;
              next.usage = {
                promptTokens: prev.promptTokens + result.usage.promptTokens,
                completionTokens: prev.completionTokens + result.usage.completionTokens,
                turns: prev.turns + 1,
                toolCalls: prev.toolCalls + result.usage.toolCalls,
                lastModel: result.usage.model || prev.lastModel,
                lastProvider: result.usage.provider || prev.lastProvider,
                lastAt: Date.now(),
                turnsSinceMemoryWrite: wroteMemory ? 0 : (prev.turnsSinceMemoryWrite ?? 0) + 1,
                lastTurnToolCalls: result.usage.toolCalls,
                skillNudge: result.usage.toolCalls >= 4 && !wroteSkill,
              };
            }
            return next;
          }),
          pendingApproval: result.ok && result.pendingApproval
            ? { ...result.pendingApproval, profileId: id, sessionId: sid }
            : null,
          pendingQueue:
            result.ok && result.pendingApprovals && result.pendingApprovals.length > 1
              ? result.pendingApprovals.slice(1).map((p) => ({
                  ...p,
                  profileId: id,
                  sessionId: sid,
                }))
              : [],
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
      commitTurn: (userText, channelId, result, sessionId, profileId) => {
        const id =
          profileId && get().workspaces[profileId] ? profileId : get().activeProfileId;
        const sid =
          sessionId ||
          (channelId && channelId !== "web" ? `${channelId}:inbox` : WEB_SESSION_ID);
        const ch = channelId || "web";
        if (result.workspace) {
          set({ workspaces: { ...get().workspaces, [id]: result.workspace } });
        } else {
          get().applyResult(userText, channelId, result, sessionId, profileId);
          return;
        }
        set({
          pendingApproval:
            result.ok && result.pendingApproval
              ? { ...result.pendingApproval, profileId: id, sessionId: sid }
              : null,
          pendingQueue:
            result.ok && result.pendingApprovals && result.pendingApprovals.length > 1
              ? result.pendingApprovals.slice(1).map((p) => ({
                  ...p,
                  profileId: id,
                  sessionId: sid,
                }))
              : [],
          error: result.ok ? null : result.error,
          busy: false,
        });
        if (ch) {
          set({
            channels: get().channels.map((c) =>
              c.id === ch ? { ...c, unread: 0 } : c,
            ),
          });
        }
      },
      replaceWorkspace: (id, ws) => {
        set({ workspaces: { ...get().workspaces, [id]: ws } });
      },
      hydrateWorkspaces: (all) => {
        set({ workspaces: { ...get().workspaces, ...all } });
      },
      admitChannel: (channelId) => {
        const ch = get().channels.find((c) => c.id === channelId);
        if (!ch?.lastMessage) return null;
        if (ch.pendingPair) return null;
        const peer = ch.lastMessage.from;
        const existing = get()
          .ws()
          .sessions?.find((s) => s.channelId === channelId && s.peer === peer);
        const slug = peer.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "inbox";
        const sessionId = existing?.id ?? `${channelId}:${slug}`;
        const id = get().activeProfileId;
        set({
          channels: get().channels.map((c) =>
            c.id === channelId ? { ...c, unread: 0 } : c,
          ),
          activeSessionId: sessionId,
          view: "sessions",
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            sessions: touchSession(ws.sessions ?? [], {
              id: sessionId,
              channelId,
              preview: ch.lastMessage!.text,
              title: peer,
              peer,
              clearUnread: true,
            }),
          })),
        });
        return `[${ch.name} · ${peer}] ${ch.lastMessage.text}`;
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
      mergeLiveChannels: (rows, pending) => {
        set({
          channels: get().channels.map((c) => {
            const row = rows.find((r) => r.id === c.id);
            if (!row) return c;
            const pair = pending?.find((p) => p.channelId === c.id);
            const raw = String(row.status || "");
            const status: Channel["status"] =
              raw === "connected" || raw === "idle" || raw === "pairing" || raw === "offline"
                ? raw
                : raw === "error"
                  ? "offline"
                  : c.status;
            return {
              ...c,
              status: pair ? "pairing" : status,
              configured: row.configured,
              error: row.error,
              label: row.label,
              lastMessage: row.lastMessage
                ? { from: row.lastMessage.from, text: row.lastMessage.text, at: row.lastAt ?? Date.now() }
                : c.lastMessage,
              pendingPair: pair
                ? { from: pair.from, text: pair.text, code: pair.code, at: pair.at }
                : status === "pairing"
                  ? c.pendingPair
                  : undefined,
            };
          }),
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
          return { woke: false, detail: "Gate closed. Silence is cheaper.", fresh: false };
        }
        const fresh = !due.notified;
        if (fresh) {
          set({
            workspaces: patchWs(get().workspaces, id, (ws) => ({
              ...ws,
              wakes: ws.wakes.map((w) => (w.id === due.id ? { ...w, notified: true } : w)),
              traces: [
                event("wake", "Heartbeat · gate open", {
                  detail: `${due.reason} — admit to spend a turn.`,
                  at,
                  status: "warn",
                }),
                ...ws.traces,
              ].slice(0, 80),
            })),
          });
        }
        return { woke: true, detail: due.note, fresh };
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
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => {
            const pass = curatorPass(ws);
            return {
              ...ws,
              skills: pass.skills,
              memories: pass.memories,
              files: pass.files,
              traces: [
                event("skill", "Curator pass", { detail: pass.detail }),
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
          const parsed = JSON.parse(ck.snapshot) as Partial<WorkspaceState>;
          set({
            workspaces: patchWs(get().workspaces, id, (ws) => ({
              ...ws,
              files: parsed.files ?? ws.files,
              skills: parsed.skills ?? ws.skills,
              memories: parsed.memories ?? ws.memories,
              dailyNotes: parsed.dailyNotes ?? ws.dailyNotes,
              canvas: parsed.canvas ?? ws.canvas,
              tickets: parsed.tickets ?? ws.tickets,
              sessions: parsed.sessions ?? ws.sessions,
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
        const id =
          pending.profileId && get().workspaces[pending.profileId]
            ? pending.profileId
            : get().activeProfileId;
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
        const rest = get().pendingQueue;
        const next = rest[0] ?? null;
        set({
          pendingApproval: next,
          pendingQueue: rest.slice(1),
        });
      },
      applySubagent: (text, ok, profileId) => {
        const id =
          profileId && get().workspaces[profileId] ? profileId : get().activeProfileId;
        const sid = get().activeSessionId;
        const ch =
          get().workspaces[id]?.sessions?.find((s) => s.id === sid)?.channelId ?? "web";
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            messages: [
              ...ws.messages,
              {
                id: uid("msg"),
                role: "assistant" as const,
                content: text,
                sessionId: sid,
                channelId: ch,
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
          pendingQueue: [],
          error: null,
          activeProfileId: "paddy",
          view: "console",
          providers: defaultProviders(),
          preferredProvider: "supergrok",
          modelByProvider: defaultModelByProvider(),
          brainKeys: defaultBrainKeys(),
          activeSessionId: WEB_SESSION_ID,
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
        return { ok: true, detail: `Live · say “${found.triggers[0] ?? found.name}”` };
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
      createSkill: (input) => {
        const name = input.name
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48);
        if (!name) return { ok: false, error: "Name the skill." };
        const id = get().activeProfileId;
        const ws = get().workspaces[id];
        if (ws?.skills.some((s) => s.name === name)) {
          return { ok: false, error: `${name} is already on this mind.` };
        }
        set({
          workspaces: patchWs(get().workspaces, id, (cur) =>
            applyMutation(cur, {
              type: "create_skill",
              name,
              description: input.description.trim().slice(0, 240),
              instructions: input.instructions.trim().slice(0, 8000),
              triggers: input.triggers.map((t) => t.trim()).filter(Boolean).slice(0, 8),
              origin: "learned",
              status: "active",
            }),
          ),
        });
        return { ok: true };
      },
      importSkillMd: (markdown) => {
        const parsed = parseSkillMd(markdown);
        if (!parsed.ok) return parsed;
        const id = get().activeProfileId;
        const ws = get().ws();
        const exists = ws.skills.some((s) => s.name === parsed.name);
        if (exists) {
          set({
            workspaces: patchWs(get().workspaces, id, (cur) => ({
              ...cur,
              skills: cur.skills.map((s) =>
                s.name === parsed.name
                  ? {
                      ...s,
                      description: parsed.description,
                      instructions: parsed.instructions,
                      triggers: parsed.triggers.length ? parsed.triggers : s.triggers,
                      origin: s.origin === "seeded" || s.origin === "hub" ? s.origin : ("patched" as const),
                      status: s.status === "archived" ? "active" : s.status,
                      version: parsed.version || s.version,
                    }
                  : s,
              ),
              traces: [event("skill", `Playbook updated · ${parsed.name}`), ...cur.traces].slice(0, 80),
            })),
          });
          return {
            ok: true,
            name: parsed.name,
            updated: true,
            detail: `Updated ${parsed.name}`,
          };
        }
        set({
          workspaces: patchWs(get().workspaces, id, (cur) =>
            applyMutation(cur, {
              type: "create_skill",
              name: parsed.name,
              description: parsed.description,
              instructions: parsed.instructions,
              triggers: parsed.triggers,
              origin: "learned",
              status: "active",
              version: parsed.version || undefined,
            }),
          ),
        });
        return {
          ok: true,
          name: parsed.name,
          updated: false,
          detail: `Live · say “${parsed.triggers[0] ?? parsed.name}”`,
        };
      },
      patchSkill: (name, patch) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            skills: ws.skills.map((s) =>
              s.name === name
                ? {
                    ...s,
                    description: patch.description?.trim() ? patch.description.slice(0, 240) : s.description,
                    instructions: patch.instructions !== undefined ? patch.instructions.slice(0, 8000) : s.instructions,
                    triggers: patch.triggers ?? s.triggers,
                    origin: s.origin === "seeded" ? s.origin : ("patched" as const),
                    status: s.status === "archived" ? s.status : "active",
                  }
                : s,
            ),
          })),
        });
      },
      setSkillStatus: (name, status) => {
        const id = get().activeProfileId;
        set({
          workspaces: patchWs(get().workspaces, id, (ws) => ({
            ...ws,
            skills: ws.skills.map((s) => (s.name === name ? { ...s, status } : s)),
            traces: [event("skill", `${status} · ${name}`), ...ws.traces].slice(0, 80),
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
      setProviderModel: (pid, model) => {
        const def = PROVIDER_DEFS.find((d) => d.id === pid);
        if (!def) return;
        const trimmed = model.trim().slice(0, 120);
        if (!trimmed) return;
        set({
          modelByProvider: { ...get().modelByProvider, [pid]: trimmed },
        });
        if (pid === "local") get().setBrainKey("ollamaModel", trimmed);
      },
      markSuperGrokLive: (live) => {
        const list = get().providers?.length ? get().providers : defaultProviders();
        const hasLocal = slotConnected(get().brainKeys ?? {}, "xai");
        const nextLive = live || hasLocal;
        set({
          providers: list.map((p) =>
            p.id === "supergrok"
              ? {
                  ...p,
                  status: nextLive ? "live" : p.status === "live" ? "idle" : p.status,
                  pairedAt: nextLive ? p.pairedAt ?? Date.now() : p.pairedAt,
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
        const persistable: Record<string, string> = {};
        for (const [k, v] of Object.entries(brainKeys)) {
          persistable[k] = v ?? "";
        }
        void persistBrainKeys({ data: { keys: persistable } });
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
        lastPulseAt: s.lastPulseAt,
        providers: s.providers,
        preferredProvider: s.preferredProvider,
        modelByProvider: s.modelByProvider,
        brainKeys: s.brainKeys,
        activeSessionId: s.activeSessionId,
        pendingApproval: s.pendingApproval,
        pendingQueue: s.pendingQueue,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as PersistedHelix & {
          workspaces?: Record<string, WorkspaceState>;
        };
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
        for (const key of Object.keys(workspaces)) {
          const ws = workspaces[key];
          if (!ws) continue;
          workspaces[key] = {
            ...ws,
            files: {
              soul: ws.files?.soul ?? "",
              identity: ws.files?.identity ?? "",
              user: ws.files?.user ?? "",
              memory: ws.files?.memory ?? "",
              agents: ws.files?.agents ?? "",
              heartbeat:
                ws.files?.heartbeat ||
                "# HEARTBEAT.md\n\nStanding watch. Silence is valid. HEARTBEAT_OK when nothing is due.\n",
            },
            tickets: Array.isArray(ws.tickets) ? ws.tickets : [],
            usage: {
              ...emptyUsage(),
              ...(ws.usage ?? {}),
            },
            sessions: (() => {
              const raw = Array.isArray(ws.sessions) ? ws.sessions : [];
              const cleaned = raw.filter((s) => !DEMO_SESSION_IDS.includes(s.id));
              if (cleaned.length > 0) return cleaned;
              return key === "paddy" ? seedSessions() : [webSession()];
            })(),
            messages: (ws.messages ?? []).filter(
              (m) => !m.sessionId || !DEMO_SESSION_IDS.includes(m.sessionId),
            ),
            wakes: (ws.wakes ?? []).map((w) => ({ ...w, notified: w.notified ?? w.fired })),
          };
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
          workspaces,
          activeProfileId,
          activeSessionId:
            (p.activeSessionId &&
            workspaces[activeProfileId]?.sessions?.some((s) => s.id === p.activeSessionId)
              ? p.activeSessionId
              : workspaces[activeProfileId]?.sessions?.find((s) => s.channelId === "web")?.id) ??
            WEB_SESSION_ID,
          profiles,
          providers: mergeProviderState(p.providers, defaultProviders()),
          preferredProvider: normalizeProviderId(p.preferredProvider ?? "supergrok"),
          modelByProvider: (() => {
            const saved = p.modelByProvider ?? {};
            const merged = { ...defaultModelByProvider(), ...saved };
            const oldLaguna =
              saved.laguna ||
              (saved as Record<string, string>)["laguna-s"] ||
              (saved as Record<string, string>)["laguna-xs"];
            if (oldLaguna) merged.laguna = oldLaguna;
            delete (merged as Record<string, string>)["laguna-s"];
            delete (merged as Record<string, string>)["laguna-xs"];
            const oldGpt =
              saved.chatgpt ||
              (saved as Record<string, string>)["chatgpt-plus"] ||
              (saved as Record<string, string>)["chatgpt-pro"];
            if (oldGpt) merged.chatgpt = oldGpt;
            delete (merged as Record<string, string>)["chatgpt-plus"];
            delete (merged as Record<string, string>)["chatgpt-pro"];
            const oldClaude =
              saved.claude ||
              (saved as Record<string, string>)["claude-pro"] ||
              (saved as Record<string, string>)["claude-max"];
            if (oldClaude) merged.claude = oldClaude;
            delete (merged as Record<string, string>)["claude-pro"];
            delete (merged as Record<string, string>)["claude-max"];
            return merged;
          })(),
          brainKeys: { ...defaultBrainKeys(), ...(p.brainKeys ?? {}) },
          policy: {
            autoApprove: Array.from(
              new Set([
                ...(p.policy?.autoApprove ?? current.policy.autoApprove),
                "write_daily",
                "update_heartbeat",
                "skill_manage",
                "use_skill",
              ]),
            ).filter((t) => t !== "spawn_subagent" && t !== "send_channel") as ToolName[],
            requireApproval: Array.from(
              new Set([
                ...(p.policy?.requireApproval ?? current.policy.requireApproval),
                "spawn_subagent",
                "send_channel",
              ]),
            ) as ToolName[],
          },
          channels: current.channels.map((def) => {
            const saved = (p.channels ?? []).find((c) => c.id === def.id);
            return {
              ...def,
              allowFrom: saved?.allowFrom,
            };
          }),
          pendingQueue: Array.isArray(p.pendingQueue) ? p.pendingQueue : [],
          pendingApproval: p.pendingApproval ?? current.pendingApproval,
          lastPulseAt: p.lastPulseAt ?? current.lastPulseAt,
        };
      },
    },
  ),
);
