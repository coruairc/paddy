/**
 * Normalize provider webhook payloads into the same inbound shape the CLI
 * already sends to handleCliRequest({ action: "inbound" }).
 */

export type BridgeChannelId = "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "email";

const BRIDGE: readonly BridgeChannelId[] = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "email",
];

export interface NormalizedInbound {
  channelId: BridgeChannelId;
  from: string;
  fromId: string;
  chatId: string;
  message: string;
  isGroup: boolean;
  botNames: string[];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function normalizeInbound(channelId: string, payload: unknown): NormalizedInbound | null {
  if (!(BRIDGE as readonly string[]).includes(channelId)) return null;
  const body = asRecord(payload);
  switch (channelId) {
    case "telegram":
      return normalizeTelegram(body);
    case "discord":
      return normalizeDiscord(body);
    case "slack":
      return normalizeSlack(body);
    case "signal":
      return normalizeSignal(body);
    case "email":
      return normalizeEmail(body);
    case "whatsapp":
      return normalizeWhatsapp(body);
    default:
      return null;
  }
}

function normalizeTelegram(body: Record<string, unknown>): NormalizedInbound | null {
  const msg = asRecord(body.message ?? body.edited_message);
  const text = str(msg.text ?? msg.caption);
  if (!text) return null;
  const from = asRecord(msg.from);
  const chat = asRecord(msg.chat);
  const fromId = str(from.id);
  const chatId = str(chat.id, fromId);
  const name = str(from.username) || str(from.first_name) || fromId;
  const isGroup = ["group", "supergroup"].includes(str(chat.type));
  return {
    channelId: "telegram",
    from: name,
    fromId,
    chatId,
    message: text,
    isGroup,
    botNames: [],
  };
}

function normalizeDiscord(body: Record<string, unknown>): NormalizedInbound | null {
  if (Number(body.type) === 1) return null;
  const text = str(body.content);
  if (!text) return null;
  const author = asRecord(body.author);
  const fromId = str(author.id);
  return {
    channelId: "discord",
    from: str(author.username, fromId),
    fromId,
    chatId: str(body.channel_id, fromId),
    message: text,
    isGroup: !body.guild_id ? false : true,
    botNames: [],
  };
}

function normalizeSlack(body: Record<string, unknown>): NormalizedInbound | null {
  const event = asRecord(body.event);
  const text = str(event.text, str(body.text));
  if (!text) return null;
  const fromId = str(event.user, str(body.user));
  return {
    channelId: "slack",
    from: fromId,
    fromId,
    chatId: str(event.channel, str(body.channel, fromId)),
    message: text,
    isGroup: str(event.channel).startsWith("C"),
    botNames: [],
  };
}

function normalizeSignal(body: Record<string, unknown>): NormalizedInbound | null {
  const envelope = asRecord(body.envelope ?? body);
  const data = asRecord(envelope.dataMessage ?? envelope.data_message);
  const text = str(data.message ?? data.text ?? envelope.message);
  if (!text) return null;
  const fromId = str(envelope.sourceNumber ?? envelope.source ?? envelope.from);
  return {
    channelId: "signal",
    from: fromId,
    fromId,
    chatId: str(data.groupInfo ? asRecord(data.groupInfo).groupId : fromId, fromId),
    message: text,
    isGroup: Boolean(data.groupInfo),
    botNames: [],
  };
}

function normalizeEmail(body: Record<string, unknown>): NormalizedInbound | null {
  const text = str(body.text, str(body.body, str(body.subject)));
  if (!text) return null;
  const from = str(body.from, "unknown");
  return {
    channelId: "email",
    from,
    fromId: from,
    chatId: from,
    message: text,
    isGroup: false,
    botNames: [],
  };
}

function normalizeWhatsapp(body: Record<string, unknown>): NormalizedInbound | null {
  const entries = Array.isArray(body.entry) ? body.entry : [body];
  for (const entry of entries) {
    const changes = Array.isArray(asRecord(entry).changes) ? (asRecord(entry).changes as unknown[]) : [];
    for (const change of changes) {
      const value = asRecord(asRecord(change).value);
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const raw of messages) {
        const msg = asRecord(raw);
        if (msg.type && str(msg.type) !== "text") continue;
        const fromId = str(msg.from);
        const text = str(asRecord(msg.text).body);
        if (!fromId || !text) continue;
        return {
          channelId: "whatsapp",
          from: fromId,
          fromId,
          chatId: fromId,
          message: text,
          isGroup: false,
          botNames: [],
        };
      }
    }
  }
  const fromId = str(body.from);
  const text = str(body.message ?? body.text);
  if (!fromId || !text) return null;
  return {
    channelId: "whatsapp",
    from: fromId,
    fromId,
    chatId: fromId,
    message: text,
    isGroup: false,
    botNames: [],
  };
}

export function slackUrlVerification(payload: unknown): string | null {
  const body = asRecord(payload);
  if (str(body.type) === "url_verification") return str(body.challenge) || null;
  return null;
}

export function discordPing(payload: unknown): boolean {
  return Number(asRecord(payload).type) === 1;
}

/** Shape the CLI `action=inbound` body so every webhook hits executeTurn the same way. */
export function toCliInboundBody(channelId: string, payload: unknown) {
  const inbound = normalizeInbound(channelId, payload);
  if (!inbound) return null;
  return {
    action: "inbound" as const,
    channelId: inbound.channelId,
    from: inbound.from,
    fromId: inbound.fromId,
    chatId: inbound.chatId,
    message: inbound.message,
    isGroup: inbound.isGroup,
    botNames: inbound.botNames,
  };
}

