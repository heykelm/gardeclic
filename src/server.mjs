import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  adsConfigured,
  excludeIpOnCampaigns,
} from "./ads.mjs";
import { enabledRuleNames, ruleOptions } from "./config.mjs";
import { loadEnv } from "./env.mjs";
import { notifyAdmin } from "./notify.mjs";
import { evaluateHit } from "./rules.mjs";
import {
  appendHit,
  ensureData,
  loadBlocks,
  loadHits,
  loadSites,
  pruneHits,
  storeName,
  upsertBlock,
  upsertSite,
} from "./store.mjs";
import { syncPendingBlocks } from "./sync.mjs";

loadEnv();

const PORT = Number(process.env.PORT ?? 8787);
const RETENTION_DAYS = Number(process.env.GARDECLIC_RETENTION_DAYS ?? 30);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress?.replace("::ffff:", "") ?? "0.0.0.0";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authorized(req, url) {
  const key = process.env.GARDECLIC_DASHBOARD_KEY;
  if (!key) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${key}`) return true;
  return url.searchParams.get("key") === key;
}

function snippet(origin, siteFromQuery) {
  return `/*! GardeClic — first-party paid-click beacon. No fingerprinting. */
(function () {
  var script = document.currentScript || document.querySelector('script[src*="/s.js"]');
  var site = ${JSON.stringify(siteFromQuery || "")} || (script && script.getAttribute("data-site"));
  if (!site) return;
  var base = (script && script.src) ? script.src.replace(/\\/s\\.js(\\?.*)?$/, "") : ${JSON.stringify(origin)};
  var params = new URLSearchParams(location.search);
  var gclid = params.get("gclid") || params.get("gbraid") || params.get("wbraid") || "";
  if (!gclid) return;
  var payload = JSON.stringify({
    site: site,
    gclid: gclid,
    href: location.href,
    referrer: document.referrer || ""
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(base + "/collect", payload);
  } else {
    fetch(base + "/collect", {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true
    });
  }
})();
`;
}

function dashboardPage(origin, keyQuery) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GardeClic</title>
  <style>
    body { font-family: ui-sans-serif, system-ui; margin: 2rem; background: #0f1115; color: #ececec; }
    a { color: #9ecbff; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border-bottom: 1px solid #2a2f3a; text-align: left; padding: 0.4rem 0.5rem; font-size: 0.9rem; }
    .muted { color: #9aa3b2; }
    code { background: #1a1f29; padding: 0.1rem 0.35rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>GardeClic</h1>
  <p class="muted">Garde les campagnes Ads : clics payants, plusieurs sites, règles nommées.</p>
  <p>Snippet : <code>&lt;script src="${origin}/s.js" data-site="TON_ID"&gt;&lt;/script&gt;</code></p>
  <p id="rules" class="muted"></p>
  <p><a href="/export.csv${keyQuery}">Export CSV des IP</a>
    · <a href="/api/sync${keyQuery}" id="sync">Sync Ads</a></p>
  <form id="manual" style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap">
    <input name="ip" placeholder="IP à exclure" required
      style="padding:.4rem .6rem;border-radius:6px;border:1px solid #2a2f3a;background:#1a1f29;color:#ececec" />
    <input name="site" placeholder="id site (ex. serru24)"
      style="padding:.4rem .6rem;border-radius:6px;border:1px solid #2a2f3a;background:#1a1f29;color:#ececec" />
    <button type="submit" style="padding:.4rem .8rem;border-radius:6px;border:0;background:#ececec;color:#0f1115;font-weight:600">Exclure</button>
  </form>
  <h2>Sites</h2>
  <table id="sites"><thead><tr><th>id</th><th>host</th><th>Ads</th></tr></thead><tbody></tbody></table>
  <h2>Exclusions</h2>
  <table id="blocks"><thead><tr><th>IP</th><th>raisons</th><th>sites</th><th>sync Ads</th></tr></thead><tbody></tbody></table>
  <h2>Derniers clics payants</h2>
  <table id="hits"><thead><tr><th>quand</th><th>IP</th><th>site</th><th>UA</th></tr></thead><tbody></tbody></table>
  <script>
    const q = ${JSON.stringify(keyQuery)};
    Promise.all([
      fetch("/api/sites" + q).then((r) => r.json()),
      fetch("/api/blocks" + q).then((r) => r.json()),
      fetch("/api/hits" + q).then((r) => r.json()),
      fetch("/api/rules" + q).then((r) => r.json())
    ]).then(([sites, blocks, hits, rules]) => {
      document.querySelector("#rules").textContent = "Règles actives : " + (rules.enabled || []).join(", ");
      document.querySelector("#sites tbody").innerHTML = sites.map((s) =>
        "<tr><td>" + s.id + "</td><td>" + s.host + "</td><td>" + (s.customerId ? "oui" : "—") + "</td></tr>"
      ).join("");
      document.querySelector("#blocks tbody").innerHTML = blocks.map((b) =>
        "<tr><td>" + b.ip + "</td><td>" + (b.reasons || []).join(", ") + "</td><td>" +
        (b.sites || []).join(", ") + "</td><td>" + (b.synced ? "oui" : "non") + "</td></tr>"
      ).join("") || "<tr><td colspan=4 class=muted>Aucune exclusion pour l’instant.</td></tr>";
      const last = (hits || []).slice(-40).reverse();
      document.querySelector("#hits tbody").innerHTML = last.map((h) =>
        "<tr><td>" + new Date(h.at).toLocaleString() + "</td><td>" + h.ip + "</td><td>" +
        h.site + "</td><td class=muted>" + String(h.ua || "").slice(0, 48) + "</td></tr>"
      ).join("") || "<tr><td colspan=4 class=muted>Aucun clic payant pour l’instant.</td></tr>";
    });
    document.getElementById("manual").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const res = await fetch("/api/blocks" + q, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: data.get("ip"), site: data.get("site") })
      });
      if (res.ok) location.reload();
      else alert("Exclusion refusée");
    });
    document.getElementById("sync").addEventListener("click", async (event) => {
      event.preventDefault();
      await fetch("/api/sync" + q, { method: "POST" });
      location.reload();
    });
  </script>
</body>
</html>`;
}

function dashboardLink(origin) {
  const key = process.env.GARDECLIC_DASHBOARD_KEY;
  if (!key) return origin;
  return `${origin}/?key=${encodeURIComponent(key)}`;
}

export function incomingUrl(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost")
    .split(",")[0]
    .trim();
  const proto = String(req.headers["x-forwarded-proto"] || (process.env.VERCEL ? "https" : "http"))
    .split(",")[0]
    .trim();
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const injected = url.searchParams.get("__path");
  if (injected) {
    url.searchParams.delete("__path");
    const next = new URL(injected, url.origin);
    next.search = url.search;
    return next;
  }
  if (url.pathname === "/api/index" || url.pathname === "/api") {
    return new URL("/", url.origin);
  }
  return url;
}

async function alertIfNew(result, extra) {
  if (!result.isNew && result.addedReasons.length === 0) return;
  await notifyAdmin({
    ip: result.block.ip,
    site: extra.site,
    host: extra.host,
    reasons: result.isNew ? result.block.reasons : result.addedReasons,
    paidCount: extra.paidCount,
    dashboardUrl: extra.dashboardUrl,
  }).catch(() => {});
}

export async function handleRequest(req, res) {
  try {
    await ensureData();
    const url = incomingUrl(req);
    const origin = `${url.protocol}//${url.host}`;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      });
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      json(res, 200, { ok: true, ads: adsConfigured(), store: storeName() });
      return;
    }

    if (url.pathname === "/s.js") {
      text(
        res,
        200,
        snippet(origin, url.searchParams.get("site") ?? ""),
        "application/javascript; charset=utf-8",
      );
      return;
    }

    if (url.pathname === "/collect" && req.method === "POST") {
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      const sites = await loadSites();
      const site = sites.find((row) => row.id === payload.site);
      if (!site) {
        json(res, 400, { error: "unknown_site" });
        return;
      }
      const hit = {
        id: randomUUID(),
        at: Date.now(),
        ip: clientIp(req),
        site: site.id,
        host: site.host,
        gclid: String(payload.gclid ?? "").slice(0, 200),
        href: String(payload.href ?? "").slice(0, 500),
        referrer: String(payload.referrer ?? "").slice(0, 400),
        ua: String(req.headers["user-agent"] ?? "").slice(0, 300),
      };
      await pruneHits(RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const hits = await loadHits();
      const verdict = evaluateHit(hit, [...hits, hit], await ruleOptions());
      await appendHit(hit);
      if (verdict.flagged) {
        const result = await upsertBlock({
          ip: hit.ip,
          customerId: site.customerId || "",
          campaignIds: site.campaignIds || [],
          reasons: verdict.reasons,
          sites: [site.id],
          updatedAt: new Date().toISOString(),
          synced: false,
        });
        await alertIfNew(result, {
          site: site.id,
          host: site.host,
          paidCount: verdict.paidCount,
          dashboardUrl: dashboardLink(origin),
        });
        if (adsConfigured() && site.customerId && site.campaignIds?.length) {
          const sync = await excludeIpOnCampaigns({
            customerId: site.customerId,
            campaignIds: site.campaignIds,
            ip: hit.ip,
          });
          if (!sync.skipped) {
            await upsertBlock({
              ...result.block,
              synced: true,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }

    if (url.pathname === "/" || url.pathname === "/dashboard") {
      if (!authorized(req, url)) {
        html(res, 401, "Clé tableau de bord manquante.");
        return;
      }
      const key = url.searchParams.get("key");
      const keyQuery = key ? `?key=${encodeURIComponent(key)}` : "";
      html(res, 200, dashboardPage(origin, keyQuery));
      return;
    }

    if (!authorized(req, url)) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    if (url.pathname === "/api/sites" && req.method === "POST") {
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      try {
        json(res, 201, await upsertSite(payload));
      } catch (error) {
        json(res, 400, { error: String(error.message ?? error) });
      }
      return;
    }
    if (url.pathname === "/api/sites") {
      json(res, 200, await loadSites());
      return;
    }
    if (url.pathname === "/api/rules") {
      const opts = await ruleOptions();
      json(res, 200, {
        enabled: enabledRuleNames(opts),
        extraCidrs: opts.extraCidrs.length,
      });
      return;
    }
    if (url.pathname === "/api/blocks" && req.method === "POST") {
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      const ip = String(payload.ip ?? "").trim();
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
        json(res, 400, { error: "invalid_ip" });
        return;
      }
      const sites = await loadSites();
      const site = sites.find((row) => row.id === payload.site) ?? sites[0];
      const result = await upsertBlock({
        ip,
        customerId: site?.customerId || "",
        campaignIds: site?.campaignIds || [],
        reasons: ["manual"],
        sites: site ? [site.id] : [],
        updatedAt: new Date().toISOString(),
        synced: false,
      });
      await alertIfNew(result, {
        site: site?.id,
        host: site?.host,
        dashboardUrl: dashboardLink(origin),
      });
      if (adsConfigured() && site?.customerId && site.campaignIds?.length) {
        const sync = await excludeIpOnCampaigns({
          customerId: site.customerId,
          campaignIds: site.campaignIds,
          ip,
        });
        if (!sync.skipped) {
          await upsertBlock({
            ...result.block,
            synced: true,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      json(res, 201, { ok: true });
      return;
    }

    if (url.pathname === "/api/blocks") {
      json(res, 200, await loadBlocks());
      return;
    }

    if (url.pathname === "/api/sync" && req.method === "POST") {
      const synced = await syncPendingBlocks();
      if (synced.error) {
        json(res, 400, synced);
        return;
      }
      json(res, 200, synced);
      return;
    }
    if (url.pathname === "/api/hits") {
      json(res, 200, await loadHits());
      return;
    }
    if (url.pathname === "/export.csv") {
      const blocks = await loadBlocks();
      const csv = ["ip,reasons,sites,customerId,synced"]
        .concat(
          blocks.map((row) =>
            [row.ip, (row.reasons || []).join("|"), (row.sites || []).join("|"), row.customerId, row.synced]
              .join(","),
          ),
        )
        .join("\n");
      text(res, 200, `${csv}\n`, "text/csv; charset=utf-8");
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    json(res, 500, { error: "server_error", message: String(error.message ?? error) });
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res);
});

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("/server.mjs");
if (isMain && !process.env.VERCEL) {
  await ensureData();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`GardeClic http://localhost:${PORT}`);
  });
}
