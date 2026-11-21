#!/usr/bin/env node
/**
 * MCP stdio server. No extra SDK: JSON-RPC over newlines, as Cursor expects.
 * Never write logs to stdout.
 */
import { createInterface } from "node:readline";
import { loadEnv } from "./env.mjs";
import { TOOLS, callTool } from "./tools.mjs";

loadEnv();

const SERVER_INFO = { name: "gardeclic", version: "0.2.0" };
const PROTOCOL = "2024-11-05";

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

export async function handleRpc(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }
  if (method === "ping" || method === "notifications/initialized" || method === "notifications/cancelled") {
    return method === "ping" ? {} : null;
  }
  if (method === "tools/list") {
    return {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    return callTool(name, args);
  }
  if (method === "resources/list") return { resources: [] };
  if (method === "prompts/list") return { prompts: [] };
  const error = new Error(`Method not found: ${method}`);
  error.code = -32601;
  throw error;
}

async function onMessage(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const id = message.id;
  const isNotification = id === undefined && String(message.method ?? "").startsWith("notifications/");
  try {
    const result = await handleRpc(message);
    if (isNotification || result === null) return;
    if (id !== undefined) respond(id, result);
  } catch (error) {
    if (id === undefined) {
      process.stderr.write(`${error.message}\n`);
      return;
    }
    respondError(id, error.code ?? -32603, error.message);
  }
}

export function startMcpStdio() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    onMessage(line).catch((error) => process.stderr.write(`${error.message}\n`));
  });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/mcp.mjs")) {
  startMcpStdio();
}
