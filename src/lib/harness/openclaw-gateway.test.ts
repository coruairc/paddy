import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callOpenClawChat,
  openClawHttpHint,
  parseOpenAiChatSse,
  probeOpenClawGateway,
} from "./openclaw-gateway.ts";

test("parseOpenAiChatSse collects content deltas and usage", () => {
  const raw = [
    'data: {"choices":[{"delta":{"role":"assistant","content":"Go "}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"on."}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const got = parseOpenAiChatSse(raw);
  assert.equal(got.content, "Go on.");
  assert.equal(got.usage.promptTokens, 3);
  assert.equal(got.usage.completionTokens, 2);
  assert.equal(got.toolCalls.length, 0);
});

test("parseOpenAiChatSse collects streamed tool_calls", () => {
  const raw = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"write_memory","arguments":"{\\"t\\""}}]}}]}',
    "",
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"hi\\"}"}}]}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const got = parseOpenAiChatSse(raw);
  assert.equal(got.toolCalls.length, 1);
  assert.equal(got.toolCalls[0]?.function.name, "write_memory");
  assert.equal(got.toolCalls[0]?.function.arguments, '{"t":"hi"}');
});

test("openClawHttpHint explains 401 and 404", () => {
  assert.match(openClawHttpHint(401), /OPENCLAW_GATEWAY_TOKEN|gateway\.auth/);
  assert.match(openClawHttpHint(404), /chatCompletions\.enabled/);
});

test("callOpenClawChat always posts stream:true and surfaces 401 hint", async () => {
  let posted: { url: string; body: Record<string, unknown>; headers: Record<string, string> } | null =
    null;
  const fetchImpl: typeof fetch = async (input, init) => {
    posted = {
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    };
    return new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 });
  };
  await assert.rejects(
    () =>
      callOpenClawChat({
        target: { url: "http://127.0.0.1:18789", token: "sek", model: "openclaw" },
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
      }),
    /OPENCLAW_GATEWAY_TOKEN|gateway\.auth|401/,
  );
  assert.notEqual(posted, null);
  const seen = posted as unknown as {
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  };
  assert.equal(seen.body.stream, true);
  assert.equal(seen.url, "http://127.0.0.1:18789/v1/chat/completions");
  assert.equal(seen.headers.authorization, "Bearer sek");
  assert.equal(seen.headers.accept, "text/event-stream");
});

test("callOpenClawChat surfaces 404 chatCompletions hint", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  await assert.rejects(
    () =>
      callOpenClawChat({
        target: { url: "http://127.0.0.1:18789", token: "", model: "openclaw" },
        messages: [{ role: "user", content: "hi" }],
        fetchImpl,
      }),
    /chatCompletions\.enabled/,
  );
});

test("callOpenClawChat buffers SSE success", async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"pong"}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
    assert.equal(body.stream, true);
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  const got = await callOpenClawChat({
    target: { url: "http://127.0.0.1:18789/", token: "t", model: "openclaw/default" },
    messages: [{ role: "user", content: "ping" }],
    fetchImpl,
  });
  assert.equal(got.content, "pong");
  assert.equal(got.usage.completionTokens, 1);
});

test("probeOpenClawGateway reports 404 hint", async () => {
  const fetchImpl: typeof fetch = async () => new Response("", { status: 404 });
  const got = await probeOpenClawGateway(
    { url: "http://127.0.0.1:18789", token: "", model: "openclaw" },
    fetchImpl,
  );
  assert.equal(got.ok, false);
  if (!got.ok) assert.match(got.error, /chatCompletions\.enabled|404/);
});
