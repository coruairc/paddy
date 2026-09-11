/**
 * MCP client. Prefers the official SDK when installed; otherwise speaks the
 * stdio JSON-RPC subset (initialize / tools/list / tools/call).
 * Discovered tools are named mcp__<server>__<tool> and always approval-gated.
 */
export interface McpDiscoveredTool {
  server: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpHandler {
  (args: Record<string, unknown>): Promise<string>;
}

interface LocalTool extends McpDiscoveredTool {
  handler: McpHandler;
}

const local = new Map<string, LocalTool>();
let builtinReady = false;
let configuredReady = false;
const sessions: { close: () => Promise<void> }[] = [];

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const i = rest.indexOf("__");
  if (i <= 0) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

export function isMcpToolName(name: string): boolean {
  return Boolean(parseMcpToolName(name));
}

export function registerMcpTool(tool: LocalTool): void {
  local.set(mcpToolName(tool.server, tool.name), tool);
}

export function clearMcpTools(): void {
  local.clear();
  builtinReady = false;
  configuredReady = false;
  for (const s of sessions) {
    void s.close().catch(() => {});
  }
  sessions.length = 0;
}

/** In-process echo so at least one MCP tool is always callable (approval-gated). */
export function ensureBuiltinMcp(): void {
  if (builtinReady) return;
  builtinReady = true;
  if (local.has(mcpToolName("paddy", "echo"))) return;
  registerMcpTool({
    server: "paddy",
    name: "echo",
    description: "Echo text back. Always requires operator approval.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    handler: async (args) => `pong:${String(args.text ?? "")}`,
  });
}

export async function listMcpTools(): Promise<McpDiscoveredTool[]> {
  ensureBuiltinMcp();
  await ensureConfiguredMcpServers();
  const out: McpDiscoveredTool[] = [...local.values()].map((t) => ({
    server: t.server,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  return out;
}

export async function callMcpTool(qualified: string, args: Record<string, unknown>): Promise<string> {
  ensureBuiltinMcp();
  const parsed = parseMcpToolName(qualified);
  if (!parsed) return `Unknown MCP tool ${qualified}`;
  const hit = local.get(qualified);
  if (!hit) return `MCP tool ${qualified} is not registered.`;
  return hit.handler(args);
}

function stringifyMcpResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const rec = result as { content?: { type?: string; text?: string }[] };
    if (Array.isArray(rec.content)) {
      const text = rec.content
        .map((c) => (typeof c.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** Connect an MCP stdio server via the official SDK and register its tools. */
export async function connectStdioMcpServer(
  name: string,
  command: string,
  args: string[] = [],
  env?: Record<string, string>,
): Promise<number> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({ command, args, env });
  const client = new Client({ name: "paddy", version: "0.1.0" });
  await client.connect(transport);
  sessions.push({
    close: async () => {
      try {
        await client.close();
      } catch {
        /* already closed */
      }
      try {
        await transport.close();
      } catch {
        /* already closed */
      }
    },
  });
  const listed = await client.listTools();
  for (const t of listed.tools ?? []) {
    registerMcpTool({
      server: name,
      name: t.name,
      description: t.description || t.name,
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      handler: async (callArgs) => {
        const result = await client.callTool({ name: t.name, arguments: callArgs });
        return stringifyMcpResult(result);
      },
    });
  }
  return listed.tools?.length ?? 0;
}

export async function connectConfiguredMcpServers(
  servers: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>,
): Promise<number> {
  let n = 0;
  for (const [name, spec] of Object.entries(servers ?? {})) {
    if (!spec?.command) continue;
    n += await connectStdioMcpServer(name, spec.command, spec.args ?? [], spec.env);
  }
  return n;
}

async function ensureConfiguredMcpServers(): Promise<void> {
  if (configuredReady) return;
  configuredReady = true;
  try {
    const { loadCanonical } = await import("./config.mjs");
    const { config } = loadCanonical({ persist: false });
    const servers = config?.mcp?.servers;
    if (servers && typeof servers === "object") {
      await connectConfiguredMcpServers(servers);
    }
  } catch {
    /* no config, or no servers */
  }
}

export function mcpOpenAiTools(tools: McpDiscoveredTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: mcpToolName(t.server, t.name),
      description: `[MCP ${t.server}] ${t.description}`,
      parameters: t.parameters,
    },
  }));
}
