import { useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, KeyRound, LogIn } from "lucide-react";
import { INSTALL_SH } from "@/lib/harness/install";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  pollCodexAuth,
  pollXaiAuth,
  probeBrain,
  listBrainModels,
  startCodexAuth,
  startXaiAuth,
} from "@/lib/harness/run-turn";
import {
  CODEX_VERIFY_URL,
  PROVIDER_DEFS,
  XAI_VERIFY_URL,
  isAnthropicOAuth,
  maskKey,
  modelIdsMatch,
  modelLabel,
  pickModel,
  slotConnected,
  type BrainKeys,
  type KeySlot,
  type ModelOption,
  type ProviderId,
} from "@/lib/harness/providers";
import { useHelix } from "@/lib/harness/store";
import { cn, formatRelative } from "@/lib/utils";

type DeviceFlow = {
  kind: "chatgpt" | "supergrok";
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  target: ProviderId;
};

export function ModelsView() {
  const providers = useHelix((s) => s.providers ?? []);
  const preferredProvider = useHelix((s) => s.preferredProvider ?? "supergrok");
  const modelByProvider = useHelix((s) => s.modelByProvider ?? {});
  const brainKeys = useHelix((s) => s.brainKeys ?? {});
  const envFlags = useHelix((s) => s.envFlags ?? {});
  const setPreferredProvider = useHelix((s) => s.setPreferredProvider);
  const setProviderModel = useHelix((s) => s.setProviderModel);
  const setBrainKey = useHelix((s) => s.setBrainKey);
  const applyBrainPatch = useHelix((s) => s.applyBrainPatch);
  const clearProviderSlot = useHelix((s) => s.clearProviderSlot);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [probing, setProbing] = useState<ProviderId | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
  const [deviceStarting, setDeviceStarting] = useState<ProviderId | null>(null);
  const [liveModels, setLiveModels] = useState<Partial<Record<ProviderId, ModelOption[]>>>({});
  const [listing, setListing] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [listError, setListError] = useState<Partial<Record<ProviderId, string>>>({});
  const [modelFilter, setModelFilter] = useState<Partial<Record<ProviderId, string>>>({});

  const preferred = PROVIDER_DEFS.find((d) => d.id === preferredProvider);
  const chatgptOn = Boolean(brainKeys.codexAccess);
  const claudeOn = Boolean(brainKeys.anthropicOAuth);
  const grokOn = Boolean(brainKeys.xaiAccess);

  function connected(id: ProviderId): boolean {
    const def = PROVIDER_DEFS.find((d) => d.id === id);
    if (!def) return false;
    if (def.id === "local") return Boolean(brainKeys.ollamaHost?.trim()) || Boolean(envFlags.ollama);
    if (def.slot === "xai") {
      return grokOn || slotConnected(brainKeys, "xai") || Boolean(envFlags.xai);
    }
    return slotConnected(brainKeys, def.slot) || Boolean(envFlags[def.slot]);
  }

  async function refreshCatalog(id: ProviderId, keysOverride?: BrainKeys) {
    const def = PROVIDER_DEFS.find((d) => d.id === id);
    if (!def) return;
    const keys = keysOverride ?? brainKeys;
    setListing((s) => ({ ...s, [id]: true }));
    try {
      const result = await listBrainModels({
        data: { preferredProvider: id, keys },
      });
      const siblings = PROVIDER_DEFS.filter((d) => d.slot === def.slot).map((d) => d.id);
      if (result.ok) {
        const catalog = def.models;
        const live = result.models;
        const merged = [
          ...live,
          ...catalog.filter((c) => !live.some((m) => modelIdsMatch(m.id, c.id))),
        ];
        setLiveModels((s) => {
          const next = { ...s };
          for (const sid of siblings) next[sid] = merged;
          return next;
        });
        setListError((s) => {
          const next = { ...s };
          for (const sid of siblings) delete next[sid];
          return next;
        });
      } else {
        setListError((s) => ({ ...s, [id]: result.error }));
      }
    } catch (err) {
      setListError((s) => ({
        ...s,
        [id]: err instanceof Error ? err.message : "Could not list models",
      }));
    } finally {
      setListing((s) => ({ ...s, [id]: false }));
    }
  }

  useEffect(() => {
    const seen = new Set<string>();
    for (const def of PROVIDER_DEFS) {
      if (!connected(def.id) || seen.has(def.slot)) continue;
      seen.add(def.slot);
      void refreshCatalog(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch when credentials change
  }, [
    brainKeys.xai,
    brainKeys.xaiAccess,
    brainKeys.openai,
    brainKeys.codexAccess,
    brainKeys.anthropic,
    brainKeys.anthropicOAuth,
    brainKeys.google,
    brainKeys.poolside,
    brainKeys.openrouter,
    brainKeys.deepseek,
    brainKeys.ollamaHost,
    envFlags.xai,
    envFlags.openai,
    envFlags.anthropic,
    envFlags.google,
    envFlags.poolside,
    envFlags.openrouter,
    envFlags.deepseek,
  ]);

  const liveLabel = useMemo(() => {
    const def = preferred ?? PROVIDER_DEFS[0];
    if (!def) return "None";
    const chosen = modelLabel(def, modelByProvider[def.id], liveModels[def.id]);
    const hasEnv = Boolean(envFlags[def.slot]);
    const hasLocal = slotConnected(brainKeys, def.slot);
    if (def.id === "supergrok" && (envFlags.xai || hasLocal || grokOn)) {
      return `${def.name} · ${chosen}`;
    }
    if (hasLocal || hasEnv || def.id === "local") return `${def.name} · ${chosen}`;
    if (def.auth === "subscription") return `${def.name} · ${chosen} (connect)`;
    return `${def.name} · ${chosen} (needs a key)`;
  }, [preferred, brainKeys, envFlags, grokOn, modelByProvider, liveModels]);

  function slotValue(slot: KeySlot): string {
    if (slot === "ollama") return brainKeys.ollamaHost ?? "";
    if (slot === "openai") return brainKeys.codexAccess || brainKeys.openai || "";
    if (slot === "anthropic") return brainKeys.anthropicOAuth || brainKeys.anthropic || "";
    if (slot === "xai") return brainKeys.xaiAccess || brainKeys.xai || "";
    return brainKeys[slot] ?? "";
  }

  function saveSlot(id: ProviderId) {
    const def = PROVIDER_DEFS.find((d) => d.id === id);
    if (!def) return;
    if (def.slot === "ollama") {
      const host = (drafts.ollamaHost ?? brainKeys.ollamaHost ?? "").trim();
      const model = (drafts.ollamaModel ?? brainKeys.ollamaModel ?? "").trim();
      setBrainKey("ollamaHost", host || "http://127.0.0.1:11434");
      setBrainKey("ollamaModel", model || "llama3.2");
      setProviderModel("local", model || "llama3.2");
      void refreshCatalog("local", {
        ...brainKeys,
        ollamaHost: host || "http://127.0.0.1:11434",
        ollamaModel: model || "llama3.2",
      });
      toast("Ollama saved", { description: "Works when Paddy runs on the same machine." });
      return;
    }
    const value = (drafts[def.slot] ?? "").trim();
    if (!value) {
      toast(def.auth === "subscription" ? "Paste a token or key first" : "Paste a key first");
      return;
    }
    if (def.slot === "anthropic" && isAnthropicOAuth(value)) {
      applyBrainPatch({ anthropicOAuth: value });
    } else if (def.slot === "anthropic") {
      applyBrainPatch({ anthropic: value });
    } else {
      setBrainKey(def.slot, value);
    }
    setPreferredProvider(id);
    setDrafts((d) => ({ ...d, [def.slot]: "" }));
    const nextKeys: BrainKeys = { ...brainKeys };
    if (def.slot === "anthropic" && isAnthropicOAuth(value)) nextKeys.anthropicOAuth = value;
    else if (def.slot === "anthropic") nextKeys.anthropic = value;
    else nextKeys[def.slot] = value;
    void refreshCatalog(id, nextKeys);
    toast(`${def.name} connected`, {
      description: isAnthropicOAuth(value)
        ? "Claude setup-token stays in this browser."
        : "Turns on this workspace now use that key. It stays in this browser.",
    });
  }

  async function testProvider(id: ProviderId) {
    const def = PROVIDER_DEFS.find((d) => d.id === id);
    if (!def) return;
    setProbing(id);
    const keys = { ...brainKeys };
    if (def.slot !== "ollama" && drafts[def.slot]?.trim()) {
      const pasted = drafts[def.slot].trim();
      if (def.slot === "anthropic" && isAnthropicOAuth(pasted)) keys.anthropicOAuth = pasted;
      else keys[def.slot] = pasted;
    }
    if (def.slot === "ollama") {
      keys.ollamaHost = drafts.ollamaHost ?? keys.ollamaHost;
      keys.ollamaModel = drafts.ollamaModel ?? keys.ollamaModel;
    }
    try {
      const result = await probeBrain({
        data: {
          preferredProvider: id,
          preferredModel: modelByProvider[id] || def.model,
          keys,
        },
      });
      if (result.ok) toast("Reachable", { description: result.detail });
      else toast("Not reachable", { description: result.error });
    } catch (err) {
      toast("Probe failed", {
        description: err instanceof Error ? err.message : "Could not reach the provider",
      });
    } finally {
      setProbing(null);
    }
  }

  async function beginDevice(kind: "chatgpt" | "supergrok", id: ProviderId) {
    setDeviceStarting(id);
    try {
      const started = kind === "chatgpt" ? await startCodexAuth() : await startXaiAuth();
      if (!started.ok) {
        toast(kind === "chatgpt" ? "Could not start ChatGPT sign-in" : "Could not start SuperGrok sign-in", {
          description: started.error,
        });
        return;
      }
      setDeviceFlow({
        kind,
        sessionId: started.sessionId,
        userCode: started.userCode,
        verificationUrl:
          started.verificationUrl || (kind === "chatgpt" ? CODEX_VERIFY_URL : XAI_VERIFY_URL),
        target: id,
      });
    } catch (err) {
      toast("Could not start sign-in", {
        description: err instanceof Error ? err.message : "Try again, or paste a key.",
      });
    } finally {
      setDeviceStarting(null);
    }
  }

  useEffect(() => {
    if (!deviceFlow) return;
    let cancelled = false;
    const tick = async () => {
      const result =
        deviceFlow.kind === "chatgpt"
          ? await pollCodexAuth({ data: { sessionId: deviceFlow.sessionId } })
          : await pollXaiAuth({ data: { sessionId: deviceFlow.sessionId } });
      if (cancelled) return;
      if (!result.ok) {
        toast("Pairing failed", { description: result.error });
        setDeviceFlow(null);
        return;
      }
      if (result.status === "expired") {
        toast("Code expired", { description: "Start sign-in again." });
        setDeviceFlow(null);
        return;
      }
      if (result.status === "ready") {
        let nextKeys: BrainKeys = { ...useHelix.getState().brainKeys };
        if (deviceFlow.kind === "chatgpt") {
          const tokens = "tokens" in result ? result.tokens : null;
          if (tokens && "accountId" in tokens) {
            nextKeys = {
              ...nextKeys,
              codexAccess: tokens.access,
              codexRefresh: tokens.refresh,
              codexExpires: String(tokens.expires),
              codexAccount: typeof tokens.accountId === "string" ? tokens.accountId : "",
            };
            applyBrainPatch(nextKeys);
          }
          toast("ChatGPT connected", {
            description: "Plus/Pro quota is now the live brain for that preference.",
          });
        } else {
          const tokens = "tokens" in result ? result.tokens : null;
          if (tokens) {
            nextKeys = {
              ...nextKeys,
              xaiAccess: tokens.access,
              xaiRefresh: tokens.refresh,
              xaiExpires: String(tokens.expires),
            };
            applyBrainPatch({
              xaiAccess: tokens.access,
              xaiRefresh: tokens.refresh,
              xaiExpires: String(tokens.expires),
            });
          }
          toast("SuperGrok connected", {
            description: "Your SuperGrok / X Premium+ quota is now the live brain.",
          });
        }
        setPreferredProvider(deviceFlow.target);
        setDeviceFlow(null);
        void refreshCatalog(deviceFlow.target, nextKeys);
      }
    };
    const id = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deviceFlow, applyBrainPatch, setPreferredProvider]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Bring your own brain
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Models</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Sign in with SuperGrok or ChatGPT, paste a Claude setup-token, grab a free
            Google or Poolside key, or drop in API keys. Download the kit to run the
            same harness on your machine.
          </p>
        </header>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Live brain</p>
          <p className="mt-1 font-display text-2xl">{liveLabel}</p>
          <p className="mt-1 text-sm text-muted">
            Preferred: {preferred?.name ?? "SuperGrok"}
            {preferred
              ? ` · ${modelLabel(preferred, modelByProvider[preferred.id], liveModels[preferred.id])}`
              : ""}
            . Models listed for a connected key are what that plan can actually call.
          </p>
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
                Self-host
              </p>
              <h2 className="mt-1 font-display text-xl">Take Paddy Irishman home</h2>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
                One curl installs from git — same shape as the usual harness
                installers. Or download the zip. Then paddy gateway, your
                subscriptions, your keys. Ollama only works on your machine.
              </p>
            </div>
            <Button asChild>
              <a href="/paddy-selfhost.zip" download>
                <Download className="size-4" />
                Download kit
              </a>
            </Button>
          </div>
          <ol className="mt-4 grid gap-2 text-sm text-muted sm:grid-cols-3">
            <li className="rounded-xl bg-bg px-3 py-3">
              <span className="font-mono text-[11px] text-subtle">1</span>
              <p className="mt-1 break-all font-mono text-xs text-fg">{INSTALL_SH}</p>
            </li>
            <li className="rounded-xl bg-bg px-3 py-3">
              <span className="font-mono text-[11px] text-subtle">2</span>
              <p className="mt-1 text-fg">Sign in or set keys</p>
            </li>
            <li className="rounded-xl bg-bg px-3 py-3">
              <span className="font-mono text-[11px] text-subtle">3</span>
              <p className="mt-1 text-fg">paddy gateway — prefer a model</p>
            </li>
          </ol>
        </section>

        <ul className="grid gap-3">
          {PROVIDER_DEFS.map((def) => {
            const st = providers.find((p) => p.id === def.id);
            const status = st?.status ?? "idle";
            const isPreferred = preferredProvider === def.id;
            const stored = slotValue(def.slot);
            const envOn = Boolean(envFlags[def.slot]);
            const signedIn =
              (def.slot === "openai" && chatgptOn) ||
              (def.slot === "anthropic" && claudeOn) ||
              (def.slot === "xai" && grokOn);
            const badge = isPreferred
              ? "preferred"
              : signedIn
                ? "signed in"
                : envOn
                  ? "env"
                  : status === "paired"
                    ? "key"
                    : "idle";
            return (
              <li
                key={def.id}
                className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-medium">{def.name}</h2>
                      <Badge
                        variant={
                          isPreferred ? "ok" : signedIn || status === "paired" || envOn ? "accent" : "default"
                        }
                      >
                        {badge}
                      </Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-subtle">{def.plan}</p>
                    <p className="mt-1 text-sm text-muted">{def.blurb}</p>
                    <div className="mt-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                          {listing[def.id]
                            ? "Asking the provider…"
                            : liveModels[def.id]
                              ? "On this key"
                              : "Catalog"}
                        </p>
                        {connected(def.id) ? (
                          <button
                            type="button"
                            className="text-[11px] text-muted hover:text-fg"
                            onClick={() => void refreshCatalog(def.id)}
                          >
                            Refresh
                          </button>
                        ) : null}
                      </div>
                      {liveModels[def.id] ? null : (
                        <p className="mb-2 text-xs text-subtle">
                          {listError[def.id]
                            ? `Could not list (${listError[def.id]}). Showing a catalog — connect a working key to see what you can actually call.`
                            : "Connect this provider to list models on your plan. Catalog ids can 404 if your quota does not include them."}
                        </p>
                      )}
                      {((liveModels[def.id] ?? def.models).length > 12) ? (
                        <Input
                          className="mb-2"
                          placeholder="Filter models"
                          value={modelFilter[def.id] ?? ""}
                          onChange={(e) =>
                            setModelFilter((s) => ({ ...s, [def.id]: e.target.value }))
                          }
                        />
                      ) : null}
                      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                        {(liveModels[def.id] ?? def.models)
                          .filter((m) => {
                            const q = (modelFilter[def.id] ?? "").trim().toLowerCase();
                            if (!q) return true;
                            return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
                          })
                          .map((m) => {
                            const selected =
                              pickModel(def, modelByProvider[def.id], liveModels[def.id]) === m.id;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                title={m.id}
                                onClick={() => setProviderModel(def.id, m.id)}
                                className={cn(
                                  "min-h-11 rounded-lg px-3 text-xs font-medium transition-colors",
                                  selected
                                    ? "bg-bg text-fg shadow-[var(--shadow-border)]"
                                    : "text-muted hover:bg-bg hover:text-fg",
                                )}
                              >
                                {m.name}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                    {stored ? (
                      <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-subtle">
                        <KeyRound className="size-3" />
                        {def.slot === "openai" && chatgptOn
                          ? `ChatGPT session · ${maskKey(brainKeys.codexAccess)}`
                          : def.slot === "anthropic" && claudeOn
                            ? `setup-token · ${maskKey(brainKeys.anthropicOAuth)}`
                            : def.slot === "xai" && grokOn
                              ? `SuperGrok session · ${maskKey(brainKeys.xaiAccess)}`
                              : def.slot === "ollama"
                                ? stored
                                : maskKey(stored)}
                        {st?.pairedAt ? ` · ${formatRelative(st.pairedAt)}` : ""}
                      </p>
                    ) : envOn ? (
                      <p className="mt-1 font-mono text-[11px] text-subtle">
                        {def.envVar} is set on this server
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!isPreferred ? (
                      <Button size="sm" variant="secondary" onClick={() => setPreferredProvider(def.id)}>
                        Prefer
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={probing === def.id}
                      onClick={() => void testProvider(def.id)}
                    >
                      {probing === def.id ? "Testing…" : "Test"}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {def.signIn === "chatgpt" ? (
                    chatgptOn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          applyBrainPatch({
                            codexAccess: "",
                            codexRefresh: "",
                            codexExpires: "",
                            codexAccount: "",
                          });
                          toast("ChatGPT signed out");
                        }}
                      >
                        Disconnect ChatGPT
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={deviceStarting !== null}
                        onClick={() => void beginDevice("chatgpt", def.id)}
                      >
                        <LogIn className="size-4" />
                        {deviceStarting === def.id ? "Starting…" : "Sign in with ChatGPT"}
                      </Button>
                    )
                  ) : null}
                  {def.signIn === "supergrok" ? (
                    grokOn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          applyBrainPatch({
                            xaiAccess: "",
                            xaiRefresh: "",
                            xaiExpires: "",
                          });
                          toast("SuperGrok signed out");
                        }}
                      >
                        Disconnect SuperGrok
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={deviceStarting !== null}
                        onClick={() => void beginDevice("supergrok", def.id)}
                      >
                        <LogIn className="size-4" />
                        {deviceStarting === def.id ? "Starting…" : "Sign in with SuperGrok"}
                      </Button>
                    )
                  ) : null}
                  {def.signIn === "claude-token" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText("claude setup-token");
                        toast("Copied", {
                          description: "Run it on your machine, then paste the token below.",
                        });
                      }}
                    >
                      <Copy className="size-4" />
                      Copy setup-token command
                    </Button>
                  ) : null}
                  {def.connectUrl && def.connectLabel ? (
                    <Button size="sm" variant="secondary" asChild>
                      <a href={def.connectUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                        {def.connectLabel}
                      </a>
                    </Button>
                  ) : null}
                </div>

                {def.slot === "ollama" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      placeholder={brainKeys.ollamaHost || "http://127.0.0.1:11434"}
                      value={drafts.ollamaHost ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, ollamaHost: e.target.value }))}
                      autoComplete="off"
                    />
                    <Input
                      placeholder={brainKeys.ollamaModel || "llama3.2"}
                      value={drafts.ollamaModel ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, ollamaModel: e.target.value }))}
                      autoComplete="off"
                    />
                  </div>
                ) : (
                  <Input
                    type="password"
                    placeholder={
                      stored
                        ? `Saved ${maskKey(stored)} — paste to replace`
                        : def.keyLabel
                    }
                    value={drafts[def.slot] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [def.slot]: e.target.value }))}
                    autoComplete="off"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => saveSlot(def.id)}>
                    Save & prefer
                  </Button>
                  {stored ? (
                    <Button size="sm" variant="ghost" onClick={() => clearProviderSlot(def.slot)}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog open={Boolean(deviceFlow)} onOpenChange={(open) => !open && setDeviceFlow(null)}>
        <DialogContent>
          <DialogTitle>
            {deviceFlow?.kind === "supergrok" ? "Sign in with SuperGrok" : "Sign in with ChatGPT"}
          </DialogTitle>
          <DialogDescription>
            {deviceFlow?.kind === "supergrok"
              ? "Approve this code on xAI with a SuperGrok or X Premium+ account. Paddy waits until you confirm."
              : "Enable device-code in ChatGPT → Settings → Security, then enter this code on the OpenAI device page. Paddy waits until you confirm."}
          </DialogDescription>
          {deviceFlow ? (
            <div className="mt-4 flex flex-col gap-4">
              <p className="rounded-xl bg-bg px-4 py-3 text-center font-mono text-2xl tracking-[0.2em] text-fg">
                {deviceFlow.userCode}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(deviceFlow.userCode);
                    toast("Code copied");
                  }}
                >
                  <Copy className="size-4" />
                  Copy code
                </Button>
                <Button size="sm" asChild>
                  <a href={deviceFlow.verificationUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    {deviceFlow.kind === "supergrok" ? "Open xAI" : "Open ChatGPT"}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-subtle">
                Waiting for confirmation… this dialog closes when the session is live.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
