#!/usr/bin/env node
import { loadEnv } from "./env.mjs";
import { callTool } from "./tools.mjs";

const command = process.argv[2] || "serve";

if (command === "mcp") {
  const { startMcpStdio } = await import("./mcp.mjs");
  startMcpStdio();
} else if (command === "init") {
  loadEnv();
  const result = await callTool("gardeclic_setup", {
    project_root: process.argv[3],
    public_origin: process.env.GARDECLIC_PUBLIC_ORIGIN,
    apply_snippet: process.argv.includes("--snippet"),
    site_id: flagValue("--site"),
  });
  console.log(result.content[0].text);
} else if (command === "serve" || command === "start") {
  loadEnv();
  await import("./server.mjs");
} else {
  console.error(`Usage:
  gardeclic init [project] [--snippet] [--site id]
  gardeclic serve
  gardeclic mcp`);
  process.exit(1);
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
