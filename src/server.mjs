import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  adsConfigured,
  excludeIpOnCampaigns,
} from "./ads.mjs";
import { evaluateHit } from "./rules.mjs";
import {
  appendHit,
  ensureData,
  loadBlocks,
  loadHits,
  loadSites,
  upsertBlock,
} from "./store.mjs";

const PORT = Number(process.env.PORT ?? 8787);

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

function snippet(origin) {
  return `/*! GardeClic — first-party paid-click beacon. No fingerprinting. */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var site = script.getAttribute("data-site");
  if (!site) return;
  var base = script.src.replace(/\\/s\\.js(\\?.*)?$/, "");
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
  <p class="muted">Règles lisibles · plusieurs sites · pas un clone ClickCease.</p>
  <p>Snippet : <code>&lt;script src="${origin}/s.js" data-site="TON_ID"&gt;&lt;/script&gt;</code></p>
  <p><a href="/export.csv${keyQuery}">Export CSV des IP</a></p>
  <h2>Sites</h2>
  <table id="sites"><thead><tr><th>id</th><th>host</th><th>Ads</th></tr></thead><tbody></tbody></table>
  <h2>Exclusions</h2>
  <table id="blocks"><thead><tr><th>IP</th><th>raisons</th><th>sites</th><th>sync Ads</th></tr></thead><tbody></tbody></table>
  <script>
    const q = ${JSON.stringify(keyQuery)};
    Promise.all([
      fetch("/api/sites" + q).then((r) => r.json()),
      fetch("/api/blocks" + q).then((r) => r.json())
    ]).then(([sites, blocks]) => {
      document.querySelector("#sites tbody").innerHTML = sites.map((s) =>
        "<tr><td>" + s.id + "</td><td>" + s.host + "</td><td>" + (s.customerId ? "oui" : "—") + "</td></tr>"
      ).join("");
      document.querySelector("#blocks tbody").innerHTML = blocks.map((b) =>
        "<tr><td>" + b.ip + "</td><td>" + (b.reasons || []).join(", ") + "</td><td>" +
        (b.sites || []).join(", ") + "</td><td>" + (b.synced ? "oui" : "non") + "</td></tr>"
      ).join("") || "<tr><td colspan=4 class=muted>Aucune exclusion pour l’instant.</td></tr>";
    });
  </script>
</body>
</html>`;
}

function ruleOptions() {
  return {
    windowMs: Number(process.env.GARDECLIC_WINDOW_HOURS ?? 24) * 60 * 60 * 1000,
    repeatLimit: Number(process.env.GARDECLIC_REPEAT_LIMIT ?? 4),
    networkSites: Number(process.env.GARDECLIC_NETWORK_SITES ?? 2),
    useDatacenter: process.env.GARDECLIC_DATACENTER === "1",
  };
}

const server = createServer(async (req, res) => {
  try {
    await ensureData();
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
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

    if (url.pathname === "/s.js") {
      text(res, 200, snippet(origin), "application/javascript; charset=utf-8");
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
      };
      const hits = await loadHits();
      const verdict = evaluateHit(hit, [...hits, hit], ruleOptions());
      await appendHit(hit);
      if (verdict.flagged) {
        const block = await upsertBlock({
          ip: hit.ip,
          customerId: site.customerId || "",
          campaignIds: site.campaignIds || [],
          reasons: verdict.reasons,
          sites: [site.id],
          updatedAt: new Date().toISOString(),
          synced: false,
        });
        if (adsConfigured() && site.customerId && site.campaignIds?.length) {
          const sync = await excludeIpOnCampaigns({
            customerId: site.customerId,
            campaignIds: site.campaignIds,
            ip: hit.ip,
          });
          if (!sync.skipped) {
            await upsertBlock({ ...block, synced: true, updatedAt: new Date().toISOString() });
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

    if (url.pathname === "/api/sites") {
      json(res, 200, await loadSites());
      return;
    }
    if (url.pathname === "/api/blocks") {
      json(res, 200, await loadBlocks());
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
});

await ensureData();
server.listen(PORT, () => {
  console.log(`GardeClic http://localhost:${PORT}`);
});
