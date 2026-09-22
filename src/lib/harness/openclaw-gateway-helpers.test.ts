import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenClawHealthUrls,
  isHostedPaddyDemoEnv,
  isLoopbackOpenClawUrl,
  normalizeOpenClawUrl,
  parseOpenClawTargetFromConfig,
  probeOpenClawHealth,
  resolveEffectiveRuntime,
  sanitizeOpenClawProbeText,
} from "./openclaw-gateway-helpers.ts";

test("normalizeOpenClawUrl adds http and strips trailing slash", () => {
  assert.equal(normalizeOpenClawUrl("127.0.0.1:18789"), "http://127.0.0.1:18789");
  assert.equal(normalizeOpenClawUrl("https://gw.example/"), "https://gw.example");
  assert.equal(normalizeOpenClawUrl("ftp://nope"), "");
  assert.equal(normalizeOpenClawUrl(""), "");
});

test("isLoopbackOpenClawUrl detects localhost and 127.0.0.1", () => {
  assert.equal(isLoopbackOpenClawUrl("http://127.0.0.1:18789"), true);
  assert.equal(isLoopbackOpenClawUrl("http://localhost:18789/"), true);
  assert.equal(isLoopbackOpenClawUrl("https://gw.example"), false);
});

test("resolveEffectiveRuntime forces paddy on hosted demo", () => {
  assert.equal(resolveEffectiveRuntime({ configured: "openclaw", hostedDemo: true }), "paddy");
  assert.equal(resolveEffectiveRuntime({ configured: "openclaw", hostedDemo: false }), "openclaw");
  assert.equal(resolveEffectiveRuntime({ configured: "paddy", hostedDemo: false }), "paddy");
  assert.equal(resolveEffectiveRuntime({ configured: null, hostedDemo: false }), "paddy");
});

test("isHostedPaddyDemoEnv keys off PADDY_CLI_TOKEN", () => {
  assert.equal(isHostedPaddyDemoEnv({}), true);
  assert.equal(isHostedPaddyDemoEnv({ PADDY_CLI_TOKEN: "" }), true);
  assert.equal(isHostedPaddyDemoEnv({ PADDY_CLI_TOKEN: "  " }), true);
  assert.equal(isHostedPaddyDemoEnv({ PADDY_CLI_TOKEN: "secret" }), false);
});

test("buildOpenClawHealthUrls lists /health then /healthz", () => {
  assert.deepEqual(buildOpenClawHealthUrls("http://127.0.0.1:18789"), [
    "http://127.0.0.1:18789/health",
    "http://127.0.0.1:18789/healthz",
  ]);
});

test("sanitizeOpenClawProbeText never echoes the token", () => {
  const token = "SUPER-SECRET-TOKEN-99";
  const out = sanitizeOpenClawProbeText(`fail Authorization: Bearer ${token} boom`, token);
  assert.equal(out.includes(token), false);
  assert.match(out, /\[redacted\]/i);
});

test("parseOpenClawTargetFromConfig never surfaces token", () => {
  const t = parseOpenClawTargetFromConfig({
    openclaw: {
      runtime: "openclaw",
      url: "http://127.0.0.1:18789",
      token: "should-not-appear",
      model: "claude",
    },
  });
  assert.equal(t.runtime, "openclaw");
  assert.equal(t.url, "http://127.0.0.1:18789");
  assert.equal(t.model, "claude");
  assert.equal("token" in t && t.token !== undefined, false);
});

test("probeOpenClawHealth succeeds on first /health 200 without logging token", async () => {
  const token = "probe-secret-xyz";
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    assert.equal(auth, `Bearer ${token}`);
    return new Response(JSON.stringify({ ok: true, status: "live" }), { status: 200 });
  };
  const result = await probeOpenClawHealth({
    url: "http://127.0.0.1:18789",
    token,
    fetchImpl: fakeFetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.endpoint, "http://127.0.0.1:18789/health");
    assert.equal(result.detail.includes(token), false);
  }
  assert.deepEqual(calls, ["http://127.0.0.1:18789/health"]);
});

test("probeOpenClawHealth falls back to /healthz when /health fails", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/health")) return new Response("nope", { status: 404 });
    return new Response('{"ok":true}', { status: 200 });
  };
  const result = await probeOpenClawHealth({
    url: "https://gw.example",
    fetchImpl: fakeFetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.endpoint, "https://gw.example/healthz");
});
