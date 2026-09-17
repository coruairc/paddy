import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearerFromHeaders,
  gatewayBindIsLoopback,
  tokensEqual,
  cliAuthorized,
  expectedCliToken,
} from "./cli-auth.ts";

test("tokensEqual is length-safe", () => {
  assert.equal(tokensEqual("abcd", "abcd"), true);
  assert.equal(tokensEqual("abcd", "abce"), false);
  assert.equal(tokensEqual("short", "longer"), false);
});

test("bearerFromHeaders parses Authorization only", () => {
  assert.equal(bearerFromHeaders(new Headers({ authorization: "Bearer secret" })), "secret");
  assert.equal(bearerFromHeaders(new Headers({ authorization: "bearer secret" })), "secret");
  assert.equal(bearerFromHeaders(new Headers()), "");
});

test("cliAuthorized rejects query-string tokens and wrong bearer", () => {
  const prevToken = process.env.PADDY_CLI_TOKEN;
  const prevBind = process.env.PADDY_BIND;
  process.env.PADDY_CLI_TOKEN = "correct-token-value";
  process.env.PADDY_BIND = "0.0.0.0";
  try {
    const badQuery = new Request("http://example.test/api/cli?token=correct-token-value", {
      method: "POST",
    });
    assert.equal(cliAuthorized(badQuery), false);

    const badBearer = new Request("http://example.test/api/cli", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    assert.equal(cliAuthorized(badBearer), false);

    const good = new Request("http://example.test/api/cli", {
      method: "POST",
      headers: { authorization: "Bearer correct-token-value" },
    });
    assert.equal(cliAuthorized(good), true);
  } finally {
    if (prevToken === undefined) delete process.env.PADDY_CLI_TOKEN;
    else process.env.PADDY_CLI_TOKEN = prevToken;
    if (prevBind === undefined) delete process.env.PADDY_BIND;
    else process.env.PADDY_BIND = prevBind;
  }
});

test("loopback bind allows missing bearer when token is set", () => {
  const prevToken = process.env.PADDY_CLI_TOKEN;
  const prevBind = process.env.PADDY_BIND;
  process.env.PADDY_CLI_TOKEN = "loop-token";
  process.env.PADDY_BIND = "127.0.0.1";
  try {
    assert.equal(gatewayBindIsLoopback(), true);
    assert.equal(expectedCliToken(), "loop-token");
    const req = new Request("http://127.0.0.1:8080/api/cli", { method: "POST" });
    assert.equal(cliAuthorized(req), true);
  } finally {
    if (prevToken === undefined) delete process.env.PADDY_CLI_TOKEN;
    else process.env.PADDY_CLI_TOKEN = prevToken;
    if (prevBind === undefined) delete process.env.PADDY_BIND;
    else process.env.PADDY_BIND = prevBind;
  }
});
