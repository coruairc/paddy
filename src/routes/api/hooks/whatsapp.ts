import { createFileRoute } from "@tanstack/react-router";
import { applyEnvAccounts, decideInbound, loadChannelConfig } from "@/lib/harness/channels";
import { handleCliRequest } from "@/lib/harness/cli-api";

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
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const cliToken = (process.env.PADDY_CLI_TOKEN ?? "").trim();
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as { changes?: unknown }).changes)
      ? (entry as { changes: unknown[] }).changes
      : [];
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[] } }).value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const raw of messages) {
        const msg = raw as { from?: string; type?: string; text?: { body?: string } };
        if (msg.type && msg.type !== "text") continue;
        const fromId = String(msg.from || "");
        const text = String(msg.text?.body || "");
        if (!fromId || !text) continue;
        const decision = decideInbound({
          channelId: "whatsapp",
          from: fromId,
          fromId,
          chatId: fromId,
          text,
          isGroup: false,
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
              channelId: "whatsapp",
              from: fromId,
              fromId,
              chatId: fromId,
              message: text,
            }),
          });
          const res = await handleCliRequest(inner);
          const data = (await res.json().catch(() => ({}))) as { reply?: string; text?: string };
          reply = data.reply || data.text || "";
        }
        if (!reply) continue;
        await fetch(`https://graph.facebook.com/v21.0/${acc.phoneId}/messages`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${acc.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: fromId,
            type: "text",
            text: { body: reply.slice(0, 4000) },
          }),
        }).catch(() => null);
      }
    }
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
