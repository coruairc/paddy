import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Gamepad2,
  Hash,
  LoaderCircle,
  Mail,
  Monitor,
  Phone,
  Send,
  Shield,
} from "lucide-react";
import { HelixMark } from "@/components/helix-mark";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WEB_SESSION_ID } from "@/lib/harness/defaults";
import { sendTurn } from "@/lib/harness/send";
import { useHelix } from "@/lib/harness/store";
import type { ChannelStatus, Session } from "@/lib/harness/types";
import { cn, formatRelative, formatTime } from "@/lib/utils";

const CHANNEL_ORDER = [
  "web",
  "whatsapp",
  "telegram",
  "slack",
  "discord",
  "signal",
  "email",
] as const;

const CHANNEL_META: Record<
  string,
  { label: string; icon: typeof Monitor }
> = {
  web: { label: "Web", icon: Monitor },
  whatsapp: { label: "WhatsApp", icon: Phone },
  telegram: { label: "Telegram", icon: Send },
  slack: { label: "Slack", icon: Hash },
  discord: { label: "Discord", icon: Gamepad2 },
  signal: { label: "Signal", icon: Shield },
  email: { label: "Email", icon: Mail },
};

const STATUS: Record<ChannelStatus, { label: string; variant: "ok" | "warn" | "danger" | "default" }> = {
  connected: { label: "live", variant: "ok" },
  idle: { label: "idle", variant: "default" },
  pairing: { label: "pairing", variant: "warn" },
  offline: { label: "offline", variant: "danger" },
};

export function SessionsView() {
  const channels = useHelix((s) => s.channels);
  const ws = useHelix((s) => s.workspaces[s.activeProfileId]!);
  const activeSessionId = useHelix((s) => s.activeSessionId);
  const openSession = useHelix((s) => s.openSession);
  const profile = useHelix((s) => s.profiles.find((p) => p.id === s.activeProfileId));
  const busy = useHelix((s) => s.busy);
  const approvePair = useHelix((s) => s.approvePair);
  const denyPair = useHelix((s) => s.denyPair);
  const [draft, setDraft] = useState("");
  const [mobileThread, setMobileThread] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const sessions = ws.sessions ?? [];
  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const channel = channels.find((c) => c.id === session?.channelId);
  const pairing = Boolean(
    channel?.pendingPair && session?.peer && channel.pendingPair.from === session.peer,
  );

  const thread = useMemo(
    () =>
      ws.messages.filter(
        (m) => (m.sessionId ?? WEB_SESSION_ID) === (session?.id ?? WEB_SESSION_ID),
      ),
    [ws.messages, session?.id],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length, busy, session?.id]);

  const groups = CHANNEL_ORDER.map((id) => ({
    id,
    meta: CHANNEL_META[id] ?? { label: id, icon: Monitor },
    channel: channels.find((c) => c.id === id),
    sessions: sessions
      .filter((s) => s.channelId === id)
      .sort((a, b) => b.lastAt - a.lastAt),
  }));

  async function submit() {
    const value = draft.trim();
    if (!value || busy || !session || pairing) return;
    setDraft("");
    await sendTurn(value, session.channelId, session.id);
  }

  function pick(s: Session) {
    openSession(s.id);
    setMobileThread(true);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-r border-border bg-bg sm:flex sm:w-72",
          mobileThread ? "hidden sm:flex" : "flex",
        )}
      >
        <div className="shrink-0 border-b border-border px-4 py-4">
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Inbox</p>
          <h1 className="mt-1 font-display text-2xl tracking-tight">Sessions</h1>
          <p className="mt-1 text-xs text-muted">Split by channel. One thread at a time.</p>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto py-2">
          {groups.map((g) => {
            const Icon = g.meta.icon;
            const unread = g.sessions.reduce((n, s) => n + s.unread, 0);
            const st = g.channel ? STATUS[g.channel.status] : null;
            return (
              <section key={g.id} className="px-2 py-2">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Icon className="size-3.5 shrink-0 text-muted" />
                  <p className="min-w-0 flex-1 text-xs font-medium tracking-wide text-muted uppercase">
                    {g.meta.label}
                  </p>
                  {st ? <Badge variant={st.variant}>{st.label}</Badge> : null}
                  {unread > 0 ? (
                    <span className="font-mono text-[11px] tabular-nums text-accent">{unread}</span>
                  ) : null}
                </div>
                {g.sessions.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-subtle">
                    {g.id === "web" ? "No sessions" : "Idle — no live bridge in this kit"}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {g.sessions.map((s) => {
                      const active = s.id === session?.id;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => pick(s)}
                            className={cn(
                              "flex min-h-11 w-full flex-col items-start rounded-xl px-2.5 py-2 text-left transition-colors",
                              active ? "bg-elevated text-fg" : "text-muted hover:bg-surface hover:text-fg",
                            )}
                          >
                            <span className="flex w-full items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.title}</span>
                              {s.unread > 0 ? (
                                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                              ) : null}
                              <span className="shrink-0 text-[11px] text-subtle">
                                {formatRelative(s.lastAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 w-full truncate text-xs text-subtle">{s.preview}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </aside>

      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          mobileThread ? "flex" : "hidden sm:flex",
        )}
      >
        {session ? (
          <>
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
              <button
                type="button"
                className="rounded-md p-2 text-muted hover:bg-surface hover:text-fg sm:hidden"
                onClick={() => setMobileThread(false)}
                aria-label="Back to sessions"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{session.title}</p>
                <p className="truncate text-xs text-muted">
                  {CHANNEL_META[session.channelId]?.label ?? session.channelId}
                  {channel ? ` · ${STATUS[channel.status].label}` : ""}
                </p>
              </div>
            </header>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
              {thread.length === 0 ? (
                <p className="text-sm text-muted">No messages in this thread yet.</p>
              ) : (
                <div className="mx-auto flex max-w-2xl flex-col gap-5">
                  {thread.map((m) => (
                    <article key={m.id}>
                      {m.role === "user" ? (
                        <div className="flex justify-end">
                          <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-br-md bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
                            <p className="text-sm leading-relaxed text-fg">{m.content}</p>
                            <p className="mt-1.5 text-right text-xs text-subtle tabular-nums">
                              {formatTime(m.at)}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <HelixMark className="mt-1 size-7 shrink-0 text-accent" />
                          <div className="min-w-0 flex-1">
                            <p className="mb-1 text-xs font-medium tracking-wide text-muted uppercase">
                              {profile?.id === "paddy" ? "Paddy" : (profile?.name ?? "Paddy")}
                            </p>
                            <Markdown text={m.content} />
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                  {busy ? (
                    <div className="flex items-center gap-3 text-muted">
                      <HelixMark spinning className="size-6 text-accent" />
                      <span className="shimmer-text text-sm">Running the loop</span>
                    </div>
                  ) : null}
                  <div ref={endRef} />
                </div>
              )}
            </div>
            {pairing && channel?.pendingPair ? (
              <div className="border-t border-border px-4 py-4">
                <div className="mx-auto max-w-2xl rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
                  <p className="text-xs font-medium tracking-wide text-muted uppercase">
                    Pairing code
                  </p>
                  <p className="mt-1 font-mono text-lg tracking-[0.18em]">{channel.pendingPair.code}</p>
                  <p className="mt-2 text-sm text-muted">
                    {channel.pendingPair.from} is unknown. Approve before this thread reaches the model.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="ghost" onClick={() => denyPair(channel.id)}>
                      Deny
                    </Button>
                    <Button onClick={() => approvePair(channel.id)}>Approve pair</Button>
                  </div>
                </div>
              </div>
            ) : channel?.status === "offline" ? (
              <p className="border-t border-border px-4 py-3 text-center text-sm text-subtle">
                Channel is offline.
              </p>
            ) : (
              <form
                className="border-t border-border px-3 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl bg-elevated p-2 shadow-[var(--shadow-border)]">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                    rows={1}
                    placeholder={`Message ${session.title}`}
                    className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-none"
                  />
                  <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="Send">
                    {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
            Pick a session.
          </div>
        )}
      </section>
    </div>
  );
}
