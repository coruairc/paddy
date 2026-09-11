import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callMcpTool,
  clearMcpTools,
  connectStdioMcpServer,
  ensureBuiltinMcp,
  isMcpToolName,
  listMcpTools,
  mcpToolName,
  parseMcpToolName,
  registerMcpTool,
} from "./mcp.ts";

test("mcp tool names are namespaced and parseable", () => {
  const q = mcpToolName("fs", "read");
  assert.equal(q, "mcp__fs__read");
  assert.equal(isMcpToolName(q), true);
  assert.deepEqual(parseMcpToolName(q), { server: "fs", tool: "read" });
  assert.equal(isMcpToolName("write_memory"), false);
});

test("registered MCP tools are listable and callable", async () => {
  clearMcpTools();
  registerMcpTool({
    server: "echo",
    name: "ping",
    description: "Echo a phrase",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    handler: async (args) => `pong:${String(args.text ?? "")}`,
  });
  const listed = await listMcpTools();
  assert.ok(listed.some((t) => t.server === "echo" && t.name === "ping"));
  const result = await callMcpTool("mcp__echo__ping", { text: "hi" });
  assert.equal(result, "pong:hi");
  clearMcpTools();
});

test("builtin paddy echo is always registered and callable under the mcp__ namespace", async () => {
  clearMcpTools();
  ensureBuiltinMcp();
  const listed = await listMcpTools();
  assert.ok(listed.some((t) => t.server === "paddy" && t.name === "echo"));
  const result = await callMcpTool("mcp__paddy__echo", { text: "slainte" });
  assert.equal(result, "pong:slainte");
  clearMcpTools();
});

test("SDK stdio MCP server tools are namespaced and callable", async () => {
  clearMcpTools();
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const script = join(root, "bin/paddy-mcp-echo.mjs");
  const n = await connectStdioMcpServer("echo", process.execPath, [script]);
  assert.ok(n >= 1);
  const listed = await listMcpTools();
  assert.ok(listed.some((t) => t.server === "echo" && t.name === "ping"));
  const result = await callMcpTool("mcp__echo__ping", { text: "hi" });
  assert.match(result, /pong:hi/);
  clearMcpTools();
  await new Promise((r) => setTimeout(r, 50));
});
