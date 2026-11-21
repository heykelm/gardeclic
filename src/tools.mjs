import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { adsConfigured, excludeIpOnCampaigns } from "./ads.mjs";
import { enabledRuleNames, publicOrigin, ruleOptions } from "./config.mjs";
import { ensureEnvFile, upsertEnvFile } from "./envfile.mjs";
import { loadEnv } from "./env.mjs";
import { envFile, homeDir, packageRoot, projectDir } from "./paths.mjs";
import { detectProject, installSnippet, snippetTag } from "./project.mjs";
import {
  ensureData,
  loadBlocks,
  loadHits,
  loadSites,
  upsertBlock,
  upsertSite,
} from "./store.mjs";
import { syncPendingBlocks } from "./sync.mjs";

function text(data) {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

async function mergeMcpFile(file, entry, fallbackDir = path.dirname(file)) {
  const payload = { mcpServers: { gardeclic: entry } };
  try {
    let current = { mcpServers: {} };
    try {
      current = JSON.parse(await readFile(file, "utf8"));
      if (!current || typeof current !== "object") current = { mcpServers: {} };
      if (!current.mcpServers) current.mcpServers = {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    current.mcpServers.gardeclic = entry;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(current, null, 2)}\n`);
    return { file, merged: true };
  } catch (error) {
    await mkdir(fallbackDir, { recursive: true });
    const sidecar = path.join(fallbackDir, "gardeclic.mcp.json");
    await writeFile(sidecar, `${JSON.stringify(payload, null, 2)}\n`);
    return {
      file: sidecar,
      merged: false,
      reason: `could not write ${file} (${error.message}); wrote ${sidecar} instead`,
    };
  }
}

function mergeCursorMcp(targetRoot, entry) {
  return mergeMcpFile(path.join(targetRoot, ".cursor", "mcp.json"), entry, targetRoot);
}

export async function setup(args = {}) {
  if (args.project_root) process.env.GARDECLIC_PROJECT = path.resolve(args.project_root);
  const home = homeDir();
  const project = path.resolve(args.project_root || projectDir());
  await mkdir(home, { recursive: true });
  await ensureEnvFile();
  loadEnv();
  if (!process.env.GARDECLIC_DASHBOARD_KEY || process.env.GARDECLIC_DASHBOARD_KEY === "change-me") {
    const key = randomBytes(16).toString("hex");
    await upsertEnvFile(envFile(), { GARDECLIC_DASHBOARD_KEY: key });
  }
  if (args.public_origin) {
    await upsertEnvFile(envFile(), {
      GARDECLIC_PUBLIC_ORIGIN: String(args.public_origin).replace(/\/$/, ""),
    });
  }
  await ensureData();
  const mcpEntry = {
    type: "stdio",
    command: process.execPath,
    args: [path.join(packageRoot(), "src", "mcp.mjs")],
    env: {
      GARDECLIC_HOME: home,
      GARDECLIC_PROJECT: project,
    },
  };
  const mcpHome = await mergeCursorMcp(home, mcpEntry);
  const mcpProject =
    path.resolve(project) === path.resolve(home) ? mcpHome : await mergeCursorMcp(project, mcpEntry);
  let mcpUser = { skipped: true };
  if (args.user_mcp !== false && process.env.GARDECLIC_SKIP_USER_MCP !== "1") {
    mcpUser = await mergeMcpFile(
      path.join(homedir(), ".cursor", "mcp.json"),
      mcpEntry,
      path.join(homedir(), ".cursor"),
    );
  }
  const detected = await detectProject(project);
  const origin = publicOrigin();
  const siteId = args.site_id || detected.name;
  let snippet = { snippet: snippetTag(origin, siteId), steps: [] };
  if (args.apply_snippet) {
    snippet = await installSnippet({ projectRoot: project, origin, siteId });
  }
  return text({
    ok: true,
    home,
    project,
    origin,
    dashboard: `${origin}/?key=${process.env.GARDECLIC_DASHBOARD_KEY || ""}`,
    mcp: { home: mcpHome, project: mcpProject, user: mcpUser },
    detected,
    snippet: snippet.snippet,
    snippet_steps: snippet.steps,
    next: [
      "Start the collector: npx gardeclic serve  (or npm start)",
      "Call gardeclic_add_site with host + Google Ads customerId/campaignIds",
      "Call gardeclic_set_alerts for email or webhook",
      args.apply_snippet ? "Redeploy the site so the snippet ships" : "Call gardeclic_install_snippet or set apply_snippet true",
    ],
  });
}

export async function status() {
  await ensureData();
  const opts = await ruleOptions();
  const sites = await loadSites();
  const blocks = await loadBlocks();
  const hits = await loadHits();
  return text({
    home: homeDir(),
    origin: publicOrigin(),
    ads: adsConfigured(),
    alerts: {
      email: Boolean(process.env.GARDECLIC_ALERT_EMAIL && process.env.RESEND_API_KEY),
      webhook: Boolean(process.env.GARDECLIC_WEBHOOK_URL),
    },
    rules: enabledRuleNames(opts),
    sites: sites.map((row) => ({
      id: row.id,
      host: row.host,
      ads: Boolean(row.customerId && row.campaignIds?.length),
    })),
    blocks: blocks.length,
    hits: hits.length,
    last_hit: hits.at(-1) ?? null,
  });
}

export async function diagnose(args = {}) {
  await ensureData();
  const project = path.resolve(args.project_root || projectDir());
  const origin = publicOrigin();
  const issues = [];
  const ok = [];
  const sites = await loadSites();
  const hits = await loadHits();
  const blocks = await loadBlocks();
  if (!sites.length) issues.push("No sites in data/sites.json");
  else ok.push(`${sites.length} site(s) configured`);
  for (const site of sites) {
    if (!site.customerId || !site.campaignIds?.length) {
      issues.push(`${site.id}: missing Google Ads customerId or campaignIds (CSV export still works)`);
    }
  }
  if (!process.env.GARDECLIC_ALERT_EMAIL && !process.env.GARDECLIC_WEBHOOK_URL) {
    issues.push("No admin alert: set email (Resend) or GARDECLIC_WEBHOOK_URL");
  } else ok.push("Alert channel configured");
  if (!hits.length) issues.push("No paid clicks collected yet — snippet missing or collector not public");
  else ok.push(`${hits.length} paid click(s) stored`);
  if (blocks.length) ok.push(`${blocks.length} IP(s) flagged`);
  if (!adsConfigured()) issues.push("Google Ads API not configured — exclusions stay in CSV until tokens are set");
  else ok.push("Google Ads API tokens present");
  const detected = await detectProject(project);
  if (!detected.hasSnippet) issues.push(`Snippet not found in ${project} (${detected.kind})`);
  else ok.push(`Snippet present in ${detected.layout || detected.html}`);
  let collector = { reachable: false };
  try {
    const res = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2500) });
    collector = { reachable: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
    if (res.ok) ok.push(`Collector up at ${origin}`);
    else issues.push(`Collector ${origin}/health → ${res.status}`);
  } catch (error) {
    issues.push(`Collector not reachable at ${origin} (${error.message}). Start it with: npx gardeclic serve`);
  }
  return text({ ready: issues.length === 0, ok, issues, collector, detected });
}

export async function addSite(args = {}) {
  if (!args.id) return fail("id is required (e.g. rideup)");
  const site = await upsertSite(args);
  return text({ ok: true, site, snippet: snippetTag(publicOrigin(), site.id) });
}

export async function setAlerts(args = {}) {
  await ensureEnvFile();
  const entries = {};
  if (args.email) entries.GARDECLIC_ALERT_EMAIL = args.email;
  if (args.from) entries.GARDECLIC_ALERT_FROM = args.from;
  if (args.resend_api_key) entries.RESEND_API_KEY = args.resend_api_key;
  if (args.webhook_url) entries.GARDECLIC_WEBHOOK_URL = args.webhook_url;
  if (!Object.keys(entries).length) {
    return fail("Pass email and/or webhook_url (and resend_api_key for mail)");
  }
  await upsertEnvFile(envFile(), entries);
  return text({
    ok: true,
    email: Boolean(process.env.GARDECLIC_ALERT_EMAIL && process.env.RESEND_API_KEY),
    webhook: Boolean(process.env.GARDECLIC_WEBHOOK_URL),
  });
}

export async function listBlocks() {
  await ensureData();
  return text(await loadBlocks());
}

export async function listHits(args = {}) {
  await ensureData();
  const limit = Math.min(Number(args.limit ?? 40), 200);
  const hits = await loadHits();
  return text(hits.slice(-limit).reverse());
}

export async function excludeIp(args = {}) {
  const ip = String(args.ip ?? "").trim();
  if (!IPV4.test(ip)) return fail("ip must be IPv4");
  await ensureData();
  const sites = await loadSites();
  const site = sites.find((row) => row.id === args.site) ?? sites[0];
  const result = await upsertBlock({
    ip,
    customerId: site?.customerId || "",
    campaignIds: site?.campaignIds || [],
    reasons: ["manual"],
    sites: site ? [site.id] : [],
    updatedAt: new Date().toISOString(),
    synced: false,
  });
  let ads = { skipped: true, reason: "no_ads_credentials" };
  if (adsConfigured() && site?.customerId && site.campaignIds?.length) {
    ads = await excludeIpOnCampaigns({
      customerId: site.customerId,
      campaignIds: site.campaignIds,
      ip,
    });
    if (!ads.skipped) {
      await upsertBlock({ ...result.block, synced: true, updatedAt: new Date().toISOString() });
    }
  }
  return text({ ok: true, block: result.block, ads });
}

export async function syncAds() {
  await ensureData();
  return text(await syncPendingBlocks());
}

export async function installProjectSnippet(args = {}) {
  const project = path.resolve(args.project_root || projectDir());
  const siteId = args.site_id;
  if (!siteId) return fail("site_id is required");
  const result = await installSnippet({
    projectRoot: project,
    origin: args.public_origin || publicOrigin(),
    siteId,
  });
  return text(result);
}

export const TOOLS = [
  {
    name: "gardeclic_setup",
    description:
      "Install GardeClic: .env, data dir, Cursor MCP config, optional snippet on the current site. Use this first.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string", description: "Site repo to protect (defaults to GARDECLIC_PROJECT or cwd)" },
        public_origin: { type: "string", description: "Public URL of the GardeClic collector, e.g. https://gardeclic.example" },
        site_id: { type: "string", description: "sites.json id to bake into the snippet (e.g. rideup)" },
        apply_snippet: { type: "boolean", description: "If true, patch Next layout or index.html now" },
      },
    },
    handler: setup,
  },
  {
    name: "gardeclic_status",
    description: "Health snapshot: sites, rules, alerts, Ads tokens, hit/block counts.",
    inputSchema: { type: "object", properties: {} },
    handler: status,
  },
  {
    name: "gardeclic_diagnose",
    description: "Checklist of what is missing (snippet, collector, alerts, Ads) so a non-Ads developer can finish setup.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string" },
      },
    },
    handler: diagnose,
  },
  {
    name: "gardeclic_add_site",
    description: "Add or update a site on this GardeClic instance (id, host, Google Ads customer and campaigns).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        host: { type: "string" },
        customerId: { type: "string" },
        campaignIds: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    handler: addSite,
  },
  {
    name: "gardeclic_set_alerts",
    description: "Configure admin email (Resend) and/or webhook. One alert per new flagged IP.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        from: { type: "string" },
        resend_api_key: { type: "string" },
        webhook_url: { type: "string" },
      },
    },
    handler: setAlerts,
  },
  {
    name: "gardeclic_list_blocks",
    description: "List flagged IPs and whether they were synced to Google Ads.",
    inputSchema: { type: "object", properties: {} },
    handler: listBlocks,
  },
  {
    name: "gardeclic_list_hits",
    description: "Recent paid clicks collected from landing pages.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    handler: listHits,
  },
  {
    name: "gardeclic_exclude_ip",
    description: "Manually exclude an IPv4. Pushes to Google Ads when tokens and campaign ids exist.",
    inputSchema: {
      type: "object",
      properties: {
        ip: { type: "string" },
        site: { type: "string" },
      },
      required: ["ip"],
    },
    handler: excludeIp,
  },
  {
    name: "gardeclic_sync_ads",
    description: "Push unsynced IP exclusions to Google Ads campaigns.",
    inputSchema: { type: "object", properties: {} },
    handler: syncAds,
  },
  {
    name: "gardeclic_install_snippet",
    description: "Patch the open site (Next.js layout or index.html) with the GardeClic paid-click beacon.",
    inputSchema: {
      type: "object",
      properties: {
        project_root: { type: "string" },
        site_id: { type: "string" },
        public_origin: { type: "string" },
      },
      required: ["site_id"],
    },
    handler: installProjectSnippet,
  },
];

export async function callTool(name, args = {}) {
  const tool = TOOLS.find((row) => row.name === name);
  if (!tool) return fail(`Unknown tool: ${name}`);
  return tool.handler(args);
}
