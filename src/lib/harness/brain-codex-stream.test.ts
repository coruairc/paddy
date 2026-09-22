import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodexJson, parseCodexSse } from "./codex-stream.ts";

test("parseCodexSse reads output_text deltas and completed usage", () => {
  const raw = [
    'data: {"type":"response.output_text.delta","delta":"Go "}',
    "",
    'data: {"type":"response.output_text.delta","delta":"on."}',
    "",
    'data: {"type":"response.completed","response":{"output_text":"Go on.","usage":{"input_tokens":11,"output_tokens":2}}}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  const got = parseCodexSse(raw);
  assert.equal(got.content, "Go on.");
  assert.equal(got.usage.promptTokens, 11);
  assert.equal(got.usage.completionTokens, 2);
  assert.equal(got.toolCalls.length, 0);
});

test("parseCodexSse collects function_call from completed output", () => {
  const raw = `data: ${JSON.stringify({
    type: "response.completed",
    response: {
      output: [
        {
          type: "function_call",
          call_id: "c1",
          name: "write_memory",
          arguments: '{"kind":"fact","text":"hi"}',
        },
      ],
      usage: { input_tokens: 4, output_tokens: 8 },
    },
  })}\n\n`;
  const got = parseCodexSse(raw);
  assert.equal(got.toolCalls.length, 1);
  assert.equal(got.toolCalls[0]?.function.name, "write_memory");
  assert.equal(got.usage.completionTokens, 8);
});

test("parseCodexJson still works for non-stream fallbacks", () => {
  const got = parseCodexJson({
    output_text: "Hello",
    output: [{ type: "message", content: [{ type: "output_text", text: "" }] }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  assert.equal(got.content, "Hello");
});
