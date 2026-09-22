import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  memoryList,
  memoryRecall,
  memorySearch,
  memoryStatus,
  memoryWrite,
} from "@/lib/harness/memory-api";
import { getConfig } from "@/lib/harness/config-api";
import {
  configuredRuntimeFromConfig,
  describeHermesMemoryPath,
  formatSyncConflictMessage,
  isHostedPaddyDemoEnv,
  isSyncConflictResult,
  type HermesMemoryPathStatus,
} from "@/lib/harness/hermes-memory-ux";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import type { MemoryEntry, MemoryKind, MemoryTarget, MemoryWriteAction } from "@/lib/harness/types";
import { cn, formatRelative } from "@/lib/utils";

const KIND: Record<MemoryKind, "ok" | "accent" | "warn" | "default"> = {
  fact: "default",
  preference: "accent",
  lesson: "ok",
  episode: "warn",
};

type StatusOk = {
  ok: true;
  memoryChars: number;
  memoryLimit: number;
  userChars: number;
  userLimit: number;
  entryCount: number;
  ftsEnabled: boolean;
  embeddingMode: string;
};

type ListedEntry = Pick<MemoryEntry, "id" | "text" | "kind" | "at" | "source">;

type Hit = {
  entry: MemoryEntry;
  score: number;
  similarity: number;
  recency: number;
  importance: number;
};

function handleAuth(err: unknown): boolean {
  if (!isCliAuthFailure(err)) return false;
  markCliAuthNeeded();
  toast.error(messageForCliAuthFailure(err));
  return true;
}

function meterPct(chars: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((chars / limit) * 100));
}

export function MemoryView() {
  const [status, setStatus] = useState<StatusOk | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<ListedEntry[]>([]);
  const [userEntries, setUserEntries] = useState<ListedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<MemoryTarget | "both">("both");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "search" | "recall">("list");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [writeText, setWriteText] = useState("");
  const [writeOld, setWriteOld] = useState("");
  const [writeKind, setWriteKind] = useState<MemoryKind>("fact");
  const [writeTarget, setWriteTarget] = useState<MemoryTarget>("memory");
  const [writeAction, setWriteAction] = useState<MemoryWriteAction>("add");
  const [hermesPath, setHermesPath] = useState<HermesMemoryPathStatus>(() =>
    describeHermesMemoryPath({ hostedDemo: true }),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, list, cfg] = await Promise.all([
        memoryStatus(),
        memoryList({ data: {} }),
        getConfig().catch(() => null),
      ]);
      if (st?.ok) setStatus(st as StatusOk);
      if (list?.ok) {
        const both = list as {
          ok: true;
          memory?: { entries: ListedEntry[] };
          user?: { entries: ListedEntry[] };
        };
        setMemoryEntries(both.memory?.entries ?? []);
        setUserEntries(both.user?.entries ?? []);
      }
      const configured = cfg?.ok ? configuredRuntimeFromConfig(cfg.config) : null;
      // Trust disk/config runtime. Hosted demo defaults openclaw.runtime=paddy
      // (SuperGrok + Hermes) — never pretend OpenClaw loopback in the panel.
      setHermesPath(
        describeHermesMemoryPath({
          configuredRuntime: configured,
          hostedDemo: configured !== "openclaw" && isHostedPaddyDemoEnv(),
        }),
      );
    } catch (err) {
      if (!handleAuth(err)) {
        const msg = err instanceof Error ? err.message : "Failed to load memory";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const listed = useMemo(() => {
    if (target === "memory") return memoryEntries.map((e) => ({ ...e, _bucket: "memory" as const }));
    if (target === "user") return userEntries.map((e) => ({ ...e, _bucket: "user" as const }));
    return [
      ...memoryEntries.map((e) => ({ ...e, _bucket: "memory" as const })),
      ...userEntries.map((e) => ({ ...e, _bucket: "user" as const })),
    ];
  }, [target, memoryEntries, userEntries]);

  async function runQuery(nextMode: "search" | "recall") {
    const query = q.trim();
    if (!query) {
      toast.error("Enter a query");
      return;
    }
    setBusy(true);
    setMode(nextMode);
    setError(null);
    try {
      if (nextMode === "search") {
        const res = await memorySearch({
          data: {
            query,
            target: target === "both" ? undefined : target,
          },
        });
        if (res?.ok) setHits((res.hits as Hit[]) ?? []);
        else toast.error("Search failed");
      } else {
        const res = await memoryRecall({ data: { query } });
        if (res?.ok) {
          setHits((res.hits as Hit[]) ?? []);
          if (res.memoryUsage) {
            setStatus((prev) =>
              prev
                ? {
                    ...prev,
                    memoryChars: res.memoryUsage.memoryChars,
                    memoryLimit: res.memoryUsage.memoryLimit,
                    userChars: res.memoryUsage.userChars,
                    userLimit: res.memoryUsage.userLimit,
                  }
                : prev,
            );
          }
        } else toast.error("Recall failed");
      }
    } catch (err) {
      if (!handleAuth(err)) {
        const msg = err instanceof Error ? err.message : "Query failed";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitWrite() {
    const text = writeText.trim();
    if (!text && writeAction !== "remove") {
      toast.error("Text required");
      return;
    }
    if ((writeAction === "replace" || writeAction === "remove") && !writeOld.trim()) {
      toast.error("oldText required for replace/remove");
      return;
    }
    setBusy(true);
    try {
      const res = await memoryWrite({
        data: {
          target: writeTarget,
          action: writeAction,
          text: writeAction === "remove" ? writeOld.trim() : text,
          oldText:
            writeAction === "replace" || writeAction === "remove"
              ? writeOld.trim()
              : undefined,
          kind: writeTarget === "memory" ? writeKind : undefined,
        },
      });
      if (!res?.ok) {
        if (isSyncConflictResult(res)) {
          toast.error("Memory sync conflict", {
            description: formatSyncConflictMessage(res),
            action: { label: "Reload", onClick: () => void refresh() },
          });
          await refresh();
          return;
        }
        const msg =
          (res as { error?: string; usage?: string })?.error ||
          "Write rejected";
        const usage = (res as { usage?: string })?.usage;
        toast.error(usage ? `${msg} (${usage})` : msg);
        return;
      }
      toast.success((res as { message?: string }).message || "Saved");
      setWriteText("");
      setWriteOld("");
      setMode("list");
      await refresh();
    } catch (err) {
      if (!handleAuth(err)) {
        toast.error(err instanceof Error ? err.message : "Write failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
              Hermes memory · both runtimes
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Memory</h1>
            <p className="mt-2 text-sm text-muted">
              Default path for <span className="font-mono text-fg/80">paddy</span> and{" "}
              <span className="font-mono text-fg/80">openclaw</span> runtimes. Prefetch profile{" "}
              <span className="font-mono text-fg/80">paddy</span>. Sync conflicts (409) surface with
              reload — no silent truncate.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || busy}
            onClick={() => void refresh()}
            aria-label="Refresh memory"
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </header>

        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-elevated px-4 py-3 text-sm"
          >
            <p className="text-danger">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : null}

        <section
          aria-label="Hermes MemoryStore path"
          className="rounded-2xl border border-accent/25 bg-elevated p-4 shadow-[var(--shadow-border)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg tracking-tight">{hermesPath.title}</h2>
              <p className="mt-1 text-sm text-muted">{hermesPath.blurb}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="accent">{hermesPath.memoryPath}</Badge>
              <Badge variant={hermesPath.openclawModelOnly ? "warn" : "ok"}>
                runtime · {hermesPath.runtime}
                {hermesPath.openclawModelOnly ? " · model only" : ""}
              </Badge>
              {hermesPath.hostedDemo ? <Badge variant="default">hosted demo</Badge> : null}
            </div>
          </div>
          <p className="mt-3 font-mono text-[11px] tracking-wide text-subtle">
            lifecycle · {hermesPath.lifecycleLabel}
          </p>
        </section>

        {loading && !status ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="size-4 animate-spin" /> Loading memory status…
          </p>
        ) : status ? (
          <section aria-label="Memory status" className="grid gap-3 sm:grid-cols-2">
            <MeterCard
              label="MEMORY.md"
              value={`${status.memoryChars}/${status.memoryLimit}`}
              pct={meterPct(status.memoryChars, status.memoryLimit)}
            />
            <MeterCard
              label="USER.md"
              value={`${status.userChars}/${status.userLimit}`}
              pct={meterPct(status.userChars, status.userLimit)}
            />
            <div className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)] sm:col-span-2">
              <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
                <div>
                  <dt className="inline text-subtle">entries </dt>
                  <dd className="inline font-mono tabular-nums text-fg">{status.entryCount}</dd>
                </div>
                <div>
                  <dt className="inline text-subtle">embedding </dt>
                  <dd className="inline font-mono text-fg">{status.embeddingMode}</dd>
                </div>
                <div>
                  <dt className="inline text-subtle">fts </dt>
                  <dd className="inline font-mono text-fg">{String(status.ftsEnabled)}</dd>
                </div>
              </dl>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl tracking-tight">Inspect</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Target filter">
            {(["both", "memory", "user"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTarget(t);
                  setMode("list");
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  target === t ? "bg-bg text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="relative flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runQuery("search");
                }}
                placeholder="Search or recall query"
                className="pl-10"
                aria-label="Memory query"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !q.trim()}
              onClick={() => void runQuery("search")}
            >
              Search
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !q.trim()}
              onClick={() => void runQuery("recall")}
            >
              Recall
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl tracking-tight">Write</h2>
          <div className="flex flex-wrap gap-2">
            {(["memory", "user"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setWriteTarget(t)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium capitalize",
                  writeTarget === t ? "bg-bg text-fg" : "text-muted hover:text-fg",
                )}
              >
                {t}
              </button>
            ))}
            {(["add", "replace", "remove"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setWriteAction(a)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium capitalize",
                  writeAction === a ? "bg-bg text-fg" : "text-muted hover:text-fg",
                )}
              >
                {a}
              </button>
            ))}
            {writeTarget === "memory"
              ? (["fact", "preference", "lesson", "episode"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setWriteKind(k)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium capitalize",
                      writeKind === k ? "bg-bg text-fg" : "text-muted hover:text-fg",
                    )}
                  >
                    {k}
                  </button>
                ))
              : null}
          </div>
          {writeAction === "replace" || writeAction === "remove" ? (
            <Input
              value={writeOld}
              onChange={(e) => setWriteOld(e.target.value)}
              placeholder="oldText (exact or unique substring)"
              aria-label="Old text"
            />
          ) : null}
          {writeAction !== "remove" ? (
            <Textarea
              value={writeText}
              onChange={(e) => setWriteText(e.target.value)}
              placeholder={writeAction === "replace" ? "New text" : "New memory entry"}
              rows={3}
              aria-label="Memory text"
            />
          ) : null}
          <div className="flex justify-end">
            <Button type="button" size="sm" disabled={busy} onClick={() => void submitWrite()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Apply write
            </Button>
          </div>
        </section>

        {mode === "list" ? (
          <ul className="space-y-2" aria-live="polite">
            {listed.map((m) => (
              <li key={`${m._bucket}-${m.id}`} className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={KIND[(m.kind as MemoryKind) || "fact"]}>
                      {(m.kind as string) || "fact"}
                    </Badge>
                    <span className="font-mono text-[10px] tracking-wide text-subtle uppercase">
                      {m._bucket}
                    </span>
                  </div>
                  <span className="text-[11px] text-subtle tabular-nums">
                    {m.at ? `${formatRelative(m.at)} · ` : ""}
                    {m.source}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fg/90">{m.text}</p>
              </li>
            ))}
            {!loading && !listed.length ? (
              <li className="rounded-2xl bg-surface p-6 text-sm text-muted">No entries.</li>
            ) : null}
          </ul>
        ) : (
          <section>
            <h2 className="mb-2 font-display text-xl capitalize">{mode} hits</h2>
            <ul className="space-y-2" aria-live="polite">
              {hits.map((h) => (
                <li key={h.entry.id} className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={KIND[h.entry.kind] || "default"}>{h.entry.kind}</Badge>
                    <span className="font-mono text-[11px] text-subtle tabular-nums">
                      score {h.score.toFixed(3)} · sim {h.similarity.toFixed(2)} · rec{" "}
                      {h.recency.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-fg/90">{h.entry.text}</p>
                </li>
              ))}
              {!busy && !hits.length ? (
                <li className="rounded-2xl bg-surface p-6 text-sm text-muted">No hits.</li>
              ) : null}
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setMode("list")}
            >
              Back to list
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}

function MeterCard({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
        <p className="font-mono text-sm tabular-nums text-fg">{value}</p>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${label} usage`}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
