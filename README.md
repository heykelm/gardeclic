# GardeClic

A **free**, self-hosted guard for Google Ads clicks across **your sites** — taxis, marketplaces, local services, whatever you ship. It is not a ClickCease clone: no secret score, no fingerprinting, no paid quota.

You run one instance. Each site sends **paid clicks only** (`gclid` / `gbraid` / `wbraid`) plus the IP and user-agent your server sees. Named rules decide whether that IP is burning Ads spend. You get an email, a CSV, or a Google Ads IP exclusion.

Google Ads **does not give you the click IP**. That is why the collector sits on the landing page. Google’s cap: 500 IPs per campaign.

## What it flags

Rules live in `src/rules.mjs`. Each one has a name you can turn off in `.env`.

| Rule | Meaning |
| --- | --- |
| `repeat_paid` | Too many paid clicks from one IP in the window (default 4 / 24 h) |
| `network_repeat` | Same IP hits **several of your sites** (farm / competitor) |
| `burst` | Too many paid clicks in a short burst (default 3 / 2 min) |
| `click_id_reuse` | The same Ads click id shows up from **two IPs** (replay / sharing) |
| `bot_ua` | Empty or automation user-agent (`curl`, headless, scrapers…) |
| `hosting` | IP in cloud / hosting ranges (AWS, GCP, Azure, OVH, Hetzner, DO…) |
| `ua_churn` | Too many different browsers from one IP in the window |

Add extra hosting/VPN CIDRs in `data/hosting.cidrs` (see `hosting.cidrs.example`). This is a public-range heuristic, not a commercial IP-intel feed.

## MCP (agent installs it for you)

GardeClic is an MCP server. In Cursor, an agent that does not know Ads can still:

- `gardeclic_setup` — `.env`, `data/`, `.cursor/mcp.json`, optional snippet on a Next/HTML site
- `gardeclic_add_site` — id, host, Google Ads customer + campaigns
- `gardeclic_set_alerts` — Resend email and/or webhook
- `gardeclic_status` / `gardeclic_diagnose` — what is missing
- `gardeclic_list_hits` / `gardeclic_list_blocks` / `gardeclic_exclude_ip` / `gardeclic_sync_ads`
- `gardeclic_install_snippet` — patch `layout.tsx` or `index.html`

```bash
node src/cli.mjs init
node src/cli.mjs serve
```

Or from another repo, after clone:

```json
{
  "mcpServers": {
    "gardeclic": {
      "command": "node",
      "args": ["/ABS/PATH/TO/gardeclic/src/mcp.mjs"],
      "env": {
        "GARDECLIC_HOME": "/ABS/PATH/TO/gardeclic",
        "GARDECLIC_PROJECT": "/ABS/PATH/TO/the-site-repo"
      }
    }
  }
}
```

`gardeclic_setup` also registers the server in your user Cursor config (`~/.cursor/mcp.json`). Reload the window once. See `mcp.example.json`.

The collector stays HTTP (`/s.js` + `/collect`): browsers cannot speak MCP. The MCP talks to the same `data/` folder.

```bash
docker compose up --build -d
```

## Run it

```bash
cp .env.example .env
npm start
```

`data/sites.json` is created from `sites.example.json`. Put every property there (`nicehub`, `rideup`, `taxilimo`, `serru24`, …) with its Google Ads customer and campaign ids. Open `http://localhost:8787/?key=your-key`.

Docker:

```bash
docker build -t gardeclic .
docker run --rm -p 8787:8787 --env-file .env -v gardeclic-data:/app/data gardeclic
```

On each site:

```html
<script src="https://YOUR-INSTANCE/s.js" data-site="rideup"></script>
```

`data-site` is the `id` in `sites.json`.

## Alerts

One email (Resend) and/or webhook when a **new** IP is flagged — not on every later click. Set `GARDECLIC_ALERT_EMAIL` + `RESEND_API_KEY`, or `GARDECLIC_WEBHOOK_URL`.

## Free for everyone

MIT license. Everyone runs **their own** instance. Your hits stay on your disk (`data/` is not committed).

## What it does not do

It does not fingerprint devices, it does not force Google to refund a click, and it does not see other advertisers’ traffic. Cross-site signal is **your** network of sites, which is the point of running one instance for the whole catalogue.

## Tests

```bash
npm test
```
