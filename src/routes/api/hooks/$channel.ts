import { createFileRoute } from "@tanstack/react-router";
import { handleCliRequest } from "@/lib/harness/cli-api";
import { isBridgeChannel } from "@/lib/harness/channels";
import { discordPing, slackUrlVerification, toCliInboundBody } from "@/lib/harness/inbound";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handlePost(request: Request, channel: string) {
  if (!isBridgeChannel(channel)) return json({ ok: false, error: "Unknown channel." }, 404);
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }
  const challenge = slackUrlVerification(body);
  if (challenge) return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  if (channel === "discord" && discordPing(body)) {
    return json({ type: 1 });
  }
  const inbound = toCliInboundBody(channel, body);
  if (!inbound) return json({ ok: true, ignored: true });
  const cliToken = (process.env.PADDY_CLI_TOKEN ?? "").trim();
  if (!cliToken) return json({ ok: false, error: "Gateway CLI token missing." }, 401);
  const inner = new Request(request.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cliToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(inbound),
  });
  return handleCliRequest(inner);
}

export const Route = createFileRoute("/api/hooks/$channel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, String(params.channel || "")),
    },
  },
});
