import { runStoredHelixTurn } from "./memory-api";
import { WEB_SESSION_ID } from "./defaults";
import { todayKey } from "./mutate";
import { useHelix } from "./store";
import { wrapUntrusted } from "./untrusted";
import type { HelixTurnInput } from "./types";

export async function sendTurn(
  text: string,
  channelId?: string,
  sessionId?: string,
  opts?: { skill?: string },
) {
  const state = useHelix.getState();
  const profileId = state.activeProfileId;
  const profile = state.profiles.find((p) => p.id === profileId);
  const ws = state.ws();
  const ch = channelId ?? "web";
  const sid =
    sessionId ??
    (ch === "web"
      ? WEB_SESSION_ID
      : (ws.sessions ?? []).find((s) => s.id === state.activeSessionId && s.channelId === ch)?.id ??
        (ws.sessions ?? []).find((s) => s.channelId === ch)?.id ??
        `${ch}:inbox`);
  const channel = state.channels.find((c) => c.id === ch);
  const session = (ws.sessions ?? []).find((s) => s.id === sid);

  const thread = ws.messages.filter(
    (m) => (m.sessionId ?? WEB_SESSION_ID) === sid && (m.role === "user" || m.role === "assistant"),
  );

  const history = thread.slice(-10).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const transcript = ws.messages.slice(-80).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content.slice(0, 400),
  }));

  const inbound =
    ch !== "web"
      ? wrapUntrusted(text, channel?.name ?? ch, session?.peer ?? channel?.lastMessage?.from)
      : text;

  const today = todayKey();
  const dailyToday = (ws.dailyNotes ?? []).find((d) => d.date === today)?.content;
  const usage = ws.usage;

  const payload: HelixTurnInput = {
    profileName: profile?.name ?? "Paddy Irishman",
    role: profile?.role ?? "operator",
    files: ws.files,
    skills: ws.skills.map((s) => ({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      status: s.status,
      uses: s.uses,
      triggers: s.triggers,
    })),
    memories: ws.memories.slice(-16).map((m) => ({ text: m.text, kind: m.kind })),
    history,
    transcript,
    userMessage: inbound,
    channelId: ch,
    channelName: channel?.name,
    policy: state.policy,
    preferredProvider: state.preferredProvider ?? "supergrok",
    preferredModel:
      state.modelByProvider?.[state.preferredProvider ?? "supergrok"] ??
      undefined,
    keys: state.brainKeys ?? {},
    tickets: (ws.tickets ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.status,
    })),
    dailyToday,
    otherSessions: (ws.sessions ?? [])
      .filter((s) => s.id !== sid)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 5)
      .map((s) => ({ id: s.id, title: s.title, preview: s.preview })),
    dueWakes: (ws.wakes ?? [])
      .filter((w) => !w.fired && w.at <= Date.now())
      .map((w) => ({ reason: w.reason, note: w.note })),
    nudgeMemory: (usage?.turnsSinceMemoryWrite ?? 0) >= 6 && (usage?.turns ?? 0) > 0,
    nudgeSkill: Boolean(usage?.skillNudge),
    forceSkill: opts?.skill,
    profileId,
    sessionId: sid,
    rawUserText: text,
  };

  useHelix.getState().setBusy(true);
  useHelix.getState().setError(null);
  try {
    const result = await runStoredHelixTurn({ data: payload });
    if (result.keyPatch) useHelix.getState().applyBrainPatch(result.keyPatch);
    if (result.workspace) {
      useHelix.getState().commitTurn(text, ch, result, sid, profileId);
    } else {
      useHelix.getState().applyResult(text, ch, result, sid, profileId);
      if (result.ok) useHelix.getState().runCurator();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Turn failed";
    useHelix.getState().applyResult(text, ch, { ok: false, error: message }, sid, profileId);
  }
}
