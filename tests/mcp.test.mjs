import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { packageRoot } from "../src/paths.mjs";
import { handleRpc } from "../src/mcp.mjs";
import { callTool } from "../src/tools.mjs";

async function tmpHome() {
  const dir = await mkdtemp(path.join(packageRoot(), "tmp-test-"));
  process.env.GARDECLIC_HOME = dir;
  process.env.GARDECLIC_PROJECT = dir;
  delete process.env.GARDECLIC_DASHBOARD_KEY;
  delete process.env.GARDECLIC_PUBLIC_ORIGIN;
  return dir;
}

test("MCP layer", async (t) => {
  t.after(async () => {
    const names = await readdir(packageRoot());
    await Promise.all(
      names
        .filter((name) => name.startsWith("tmp-test-"))
        .map((name) => rm(path.join(packageRoot(), name), { recursive: true, force: true })),
    );
  });

  await t.test("initialize and tools/list expose setup", async () => {
    const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(init.serverInfo.name, "gardeclic");
    const listed = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.tools.map((row) => row.name);
    assert.ok(names.includes("gardeclic_setup"));
    assert.ok(names.includes("gardeclic_diagnose"));
    assert.ok(names.includes("gardeclic_add_site"));
  });

  await t.test("setup writes env, data and Cursor MCP config", async () => {
    const home = await tmpHome();
    const result = await callTool("gardeclic_setup", { public_origin: "https://gc.example" });
    assert.equal(result.isError, undefined);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.ok, true);
    assert.equal(body.origin, "https://gc.example");
    const env = await readFile(path.join(home, ".env"), "utf8");
    assert.match(env, /GARDECLIC_DASHBOARD_KEY=/);
    assert.doesNotMatch(env, /change-me/);
    let mcpRaw;
    try {
      mcpRaw = await readFile(path.join(home, ".cursor", "mcp.json"), "utf8");
    } catch {
      mcpRaw = await readFile(path.join(home, "gardeclic.mcp.json"), "utf8");
    }
    const mcp = JSON.parse(mcpRaw);
    assert.equal(mcp.mcpServers.gardeclic.env.GARDECLIC_HOME, home);
    const sites = JSON.parse(await readFile(path.join(home, "data", "sites.json"), "utf8"));
    assert.ok(sites.sites.some((row) => row.id === "serru24"));
  });

  await t.test("add_site upserts a catalogue property", async () => {
    await tmpHome();
    await callTool("gardeclic_setup", {});
    const result = await callTool("gardeclic_add_site", {
      id: "rideup",
      host: "rideup.example",
      customerId: "123-456-7890",
      campaignIds: ["111"],
    });
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.site.id, "rideup");
    assert.equal(body.site.customerId, "1234567890");
    assert.deepEqual(body.site.campaignIds, ["111"]);
  });

  await t.test("install_snippet patches a Next layout", async () => {
    const home = await tmpHome();
    const app = path.join(home, "app-repo");
    await mkdir(path.join(app, "src", "app"), { recursive: true });
    await writeFile(
      path.join(app, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "16.0.0" } }),
    );
    await writeFile(
      path.join(app, "src", "app", "layout.tsx"),
      `export default function RootLayout({ children }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
`,
    );
    const result = await callTool("gardeclic_install_snippet", {
      project_root: app,
      site_id: "rideup",
      public_origin: "https://gc.example",
    });
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.hasSnippet, true);
    const layout = await readFile(path.join(app, "src", "app", "layout.tsx"), "utf8");
    assert.match(layout, /GardeClicSnippet/);
    const local = await readFile(path.join(app, ".env.local"), "utf8");
    assert.match(local, /NEXT_PUBLIC_GARDECLIC_SITE=rideup/);
  });
});
