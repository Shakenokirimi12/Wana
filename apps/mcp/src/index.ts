import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { patAuthMiddleware } from "./auth";
import { registerTools } from "./tools/register";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", service: "wana-mcp" }));

/**
 * Stateless Streamable HTTP MCP endpoint. Workers isolates don't hold
 * connections open across requests, so — like Cloudflare's own stateless
 * Workers MCP examples — every POST gets a fresh `McpServer` +
 * `WebStandardStreamableHTTPServerTransport` pair (`sessionIdGenerator:
 * undefined`), scoped to the caller resolved by `patAuthMiddleware`.
 */
app.post("/mcp", patAuthMiddleware, async (c) => {
  const userId = c.get("userId");
  const server = new McpServer({ name: "wana", version: "0.1.0" });
  registerTools(server, c.env, userId);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Must be wired up before handleRequest — it registers the onmessage
  // handler that turns the incoming JSON-RPC call into a tool invocation.
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

// Stateless mode has no server-initiated stream and no session to close.
app.get("/mcp", (c) => c.json({ error: "This server does not support GET /mcp (stateless mode)" }, 405));
app.delete("/mcp", (c) => c.json({ error: "This server does not support DELETE /mcp (stateless mode)" }, 405));

export default app;
