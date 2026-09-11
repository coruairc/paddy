#!/usr/bin/env node
/**
 * Tiny stdio MCP server used as the built-in "at least one real MCP server"
 * fixture. Tools are namespaced mcp__echo__* once Paddy's client connects.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "0.1.0" });
server.registerTool(
  "ping",
  {
    description: "Echo text back. Paddy always approval-gates this.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `pong:${text}` }],
  }),
);
await server.connect(new StdioServerTransport());
