import { createFileRoute } from "@tanstack/react-router";
import { applyEnvAccounts, decideInbound, loadChannelConfig } from "@/lib/harness/channels";
import { handleCliRequest } from "@/lib/harness/cli-api";
import { normalizeInbound } from "@/lib/harness/inbound";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function whatsappAccount() {
  return applyEnvAccounts(loadChannelConfig()).accounts.whatsapp;
}

async function handleGet(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const acc = whatsappAccount();
  const want = acc?.verifyToken?.trim();
  if (mode === "subscribe" && want && token === want && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return json({ ok: false, error: "Verify token mismatch." }, 403);
}

async function handlePost(request: Request) {
  const acc = whatsappAccount();
  if (!acc?.token || !acc.phoneId) {
    return json({ ok: false, error: "WhatsApp is not connected." }, 400);
  }
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const inbound = normalizeInbound("whatsapp", body);
  if (!inbound) return json({ ok: true, ignored: true });
  const cliToken = (process.env.PADDY_CLI_TOKEN ?? "").trim();
  const decision = decideInbound({
    channelId: "whatsapp",
    from: inbound.from,
    fromId: inbound.fromId,
    chatId: inbound.chatId,
    text: inbound.message,
    isGroup: inbound.isGroup,
  });
  let reply = "";
  if (decision.action === "pair") reply = decision.reply;
  else if (decision.action === "allow" && cliToken) {
    const inner = new Request(request.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cliToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "inbound",
        channelId: inbound.channelId,
        from: inbound.from,
        fromId: inbound.fromId,
        chatId: inbound.chatId,
        message: inbound.message,
        isGroup: inbound.isGroup,
      }),
    });
    const res = await handleCliRequest(inner);
    const data = (await res.json().catch(() => ({}))) as { reply?: string; text?: string };
    reply = data.reply || data.text || "";
  }
  if (reply) {
    await fetch(`https://graph.facebook.com/v21.0/${acc.phoneId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${acc.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: inbound.fromId,
        type: "text",
        text: { body: reply.slice(0, 4000) },
      }),
    }).catch(() => null);
  }
  return json({ ok: true });
}

export const Route = createFileRoute("/api/hooks/whatsapp")({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
      POST: async ({ request }) => handlePost(request),
    },
  },
});
