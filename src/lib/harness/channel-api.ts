import { createServerFn } from "@tanstack/react-start";
import {
  BRIDGE_CHANNELS,
  CHANNEL_SETUP,
  applyEnvAccounts,
  defaultAccount,
  isBridgeChannel,
  loadChannelConfig,
  maskSecret,
  removeAccount,
  resolvePair,
  summarizeChannels,
  upsertAccount,
  type BridgeChannelId,
  type ChannelAccount,
  type DmPolicy,
} from "./channels";
import { detectLineage, readLineageAccounts, summarizeImported } from "./lineage.mjs";
import { exportToLineage, importFromLineage } from "./config.mjs";
import { cliGatewayMiddleware } from "./cli-auth.server";

function gatewayReady(): boolean {
  return Boolean((process.env.PADDY_CLI_TOKEN ?? "").trim());
}

function publicAccount(id: BridgeChannelId, acc?: ChannelAccount) {
  const setup = CHANNEL_SETUP[id];
  const row = acc ?? defaultAccount();
  return {
    id,
    title: setup.title,
    how: setup.how,
    href: setup.href,
    fields: setup.fields.map((f) => ({
      key: f.key,
      label: f.label,
      placeholder: f.placeholder,
      set: Boolean(String(row[f.key] ?? "").trim()),
      preview: maskSecret(String(row[f.key] ?? "")),
    })),
    dmPolicy: row.dmPolicy,
    allowFrom: row.allowFrom,
    requireMention: row.requireMention,
    configured: Boolean(acc && Object.values(acc).some((v) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.length : false))),
  };
}

export const listGatewayChannels = createServerFn({ method: "GET" }).handler(async () => {
  const ready = gatewayReady();
  const lineage = detectLineage();
  const lineageSummary = ready
    ? {
        openclaw: lineage.openclaw,
        hermes: lineage.hermes,
        openclawChannels: lineage.openclaw
          ? summarizeImported(readLineageAccounts().openclaw)
          : [],
        hermesChannels: lineage.hermes ? summarizeImported(readLineageAccounts().hermes) : [],
      }
    : {
        openclaw: false,
        hermes: false,
        openclawChannels: [] as ReturnType<typeof summarizeImported>,
        hermesChannels: [] as ReturnType<typeof summarizeImported>,
      };
  if (!ready) {
    return {
      ok: true as const,
      ready: false,
      channels: summarizeChannels().map((s) => ({
        ...s,
        configured: false,
        status: "idle" as const,
      })),
      accounts: BRIDGE_CHANNELS.map((id) => publicAccount(id)),
      pending: [] as ReturnType<typeof loadChannelConfig>["pending"],
      lineage: lineageSummary,
    };
  }
  const cfg = applyEnvAccounts(loadChannelConfig());
  return {
    ok: true as const,
    ready: true,
    channels: summarizeChannels(),
    accounts: BRIDGE_CHANNELS.map((id) => publicAccount(id, cfg.accounts[id])),
    pending: cfg.pending,
    lineage: lineageSummary,
  };
});

export const saveGatewayChannel = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      id: string;
      token?: string;
      appToken?: string;
      phoneId?: string;
      verifyToken?: string;
      number?: string;
      host?: string;
      user?: string;
      pass?: string;
      from?: string;
      dmPolicy?: DmPolicy;
      allowFrom?: string;
      requireMention?: boolean;
      remove?: boolean;
    }) => input,
  )
  .handler(async ({ data }) => {
    if (!gatewayReady()) {
      return {
        ok: false as const,
        error:
          "Channels connect on paddy gateway on your machine. Paste the Telegram token from @BotFather — Paddy stores it in canonical config.",
      };
    }
    if (!isBridgeChannel(data.id)) return { ok: false as const, error: "Unknown channel." };
    if (data.remove) {
      removeAccount(data.id);
      return { ok: true as const, detail: `${data.id} disconnected.` };
    }
    const allowFrom = (data.allowFrom ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const patch: Partial<ChannelAccount> = {
      dmPolicy: data.dmPolicy,
      requireMention: data.requireMention,
    };
    if (allowFrom.length) patch.allowFrom = allowFrom;
    for (const key of [
      "token",
      "appToken",
      "phoneId",
      "verifyToken",
      "number",
      "host",
      "user",
      "pass",
      "from",
    ] as const) {
      const v = data[key];
      if (typeof v === "string" && v.trim()) patch[key] = v.trim();
    }
    upsertAccount(data.id, patch);
    return {
      ok: true as const,
      detail: `${data.id} saved to Paddy config. The bridge picks it up within a few seconds.`,
    };
  });

export const resolveGatewayPair = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { code: string; allow: boolean }) => input)
  .handler(async ({ data }) => {
    if (!gatewayReady()) {
      return { ok: false as const, error: "Pairing lives on paddy gateway." };
    }
    const result = resolvePair(data.code, data.allow);
    if (!result.ok) return result;
    return {
      ok: true as const,
      detail: data.allow
        ? `Allowed ${result.pair.from} on ${result.pair.channelId}.`
        : `Denied ${result.pair.from}.`,
    };
  });

export const importLineageChannels = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { source: "openclaw" | "hermes" | "both"; replace?: string[] }) => input)
  .handler(async ({ data }) => {
    if (!gatewayReady()) {
      return {
        ok: false as const,
        error: "Import OpenClaw / Hermes channels on the machine running paddy gateway.",
        imported: [] as string[],
        skipped: [] as string[],
        conflicts: [] as Array<{
          id: string;
          reason: string;
          currentMode?: string;
          incomingMode?: string;
          currentUsers?: string[];
          incomingUsers?: string[];
        }>,
      };
    }
    const replace = (data.replace ?? []).filter((id) => isBridgeChannel(id));
    const result = importFromLineage({ source: data.source, replace });
    if (!result.ok && !result.conflicts?.length && !result.imported?.length) {
      return {
        ok: false as const,
        error: result.error || "No Telegram/Discord/Slack tokens found in ~/.openclaw or ~/.hermes.",
        imported: [] as string[],
        skipped: [] as string[],
        conflicts: [] as typeof result.conflicts,
      };
    }
    const bits: string[] = [];
    if (result.imported?.length) bits.push(`Imported ${result.imported.join(", ")} into Paddy config.`);
    if (result.conflicts?.length) {
      bits.push(
        `Conflicts on ${result.conflicts.map((c: { id: string }) => c.id).join(", ")} — keep the current channel or replace it.`,
      );
    }
    if (result.skipped?.length && !result.conflicts?.length) {
      bits.push(`Kept existing: ${result.skipped.join(", ")}.`);
    }
    return {
      ok: true as const,
      detail: bits.join(" ") || "No changes.",
      imported: result.imported ?? [],
      skipped: result.skipped ?? [],
      conflicts: result.conflicts ?? [],
    };
  });

export const exportLineageChannels = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { target: "openclaw" | "hermes" | "both" }) => input)
  .handler(async ({ data }) => {
    if (!gatewayReady()) {
      return { ok: false as const, error: "Export writes ~/.openclaw and ~/.hermes on this machine." };
    }
    const paths = exportToLineage(data.target);
    return {
      ok: true as const,
      detail: `Wrote ${paths.join(" · ") || "nothing"}. Paddy config is unchanged. Restart OpenClaw / Hermes to pick them up.`,
      paths,
    };
  });
