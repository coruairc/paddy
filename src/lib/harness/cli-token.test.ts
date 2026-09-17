import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLI_AUTH_NEEDED_MESSAGE,
  clearCliToken,
  getCliToken,
  isCliAuthFailure,
  messageForCliAuthFailure,
  setCliToken,
} from "./cli-token.ts";

test("isCliAuthFailure detects CliAuthError name and 401", () => {
  assert.equal(isCliAuthFailure({ name: "CliAuthError", message: "nope" }), true);
  assert.equal(isCliAuthFailure({ status: 401, message: "Unauthorized" }), true);
  assert.equal(isCliAuthFailure({ message: "CLI token rejected. Use Authorization: Bearer." }), true);
  assert.equal(isCliAuthFailure({ message: "network down" }), false);
});

test("messageForCliAuthFailure does not echo bearer secrets", () => {
  const msg = messageForCliAuthFailure({
    name: "CliAuthError",
    message: "CLI token rejected. Bearer super-secret-token-value was wrong",
  });
  assert.equal(msg, CLI_AUTH_NEEDED_MESSAGE);
  assert.equal(msg.includes("super-secret"), false);
});

test("setCliToken keeps token in memory only", () => {
  clearCliToken();
  setCliToken("  abc  ");
  assert.equal(getCliToken(), "abc");
  clearCliToken();
  assert.equal(getCliToken(), "");
});
