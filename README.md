# GardeClic

A **free**, self-hosted guard for Google Ads clicks across several of your sites. It is **not** a ClickCease clone: no secret “2000 tests”, no paid SaaS, no fingerprinting.

You run one instance. Your sites send **paid clicks only** (`gclid` / `gbraid` / `wbraid`) plus the IP your server sees. A few **readable rules** decide whether that IP should be excluded. You export a CSV, or you connect the Google Ads API if you have a token.

## What it does

1. **First-party beacon** — the snippet fires only when an Ads click id is present.
2. **Three rules**, in `src/rules.mjs`:
   - `repeat_paid`: too many paid clicks from the same IP in the window (default 4 / 24 h)
   - `network_repeat`: the same IP clicks **more than one of your sites** (competitor / click farm)
   - `datacenter`: hosting prefixes — **off** by default (too broad)
3. **Multi-site** via `data/sites.json` (copied from `sites.example.json` on first start).
4. **Admin alert**: one email (Resend) and/or webhook when a **new** IP is flagged — not on every later click. Without `GARDECLIC_ALERT_EMAIL`, nobody is notified; you have to open the dashboard.
5. **Optional Google Ads sync**: IP exclusions on your campaigns. Without a token, the CSV export is enough.

Google Ads **does not give you the click IP**. That is why there is a small collector on your landing pages. Google’s cap: 500 IPs per campaign.

## Run it

```bash
cp .env.example .env
npm start
```

`data/sites.json` is created for you. Open `http://localhost:8787/?key=your-key`.

Docker:

```bash
docker build -t gardeclic .
docker run --rm -p 8787:8787 --env-file .env -v gardeclic-data:/app/data gardeclic
```

Render / Railway / Fly: `Procfile` and `Dockerfile` are ready. Persist a volume on `/app/data`.

On each site:

```html
<script src="https://YOUR-INSTANCE/s.js" data-site="site-1"></script>
```

`data-site` is the `id` in `sites.json`. Set `customerId` and `campaignIds` if you want Ads sync.

## Free for everyone

MIT license. Everyone runs **their own** instance (VPS, Railway, Fly, Node on a Pi). No quotas for sale. Your data stays on your disk (`data/` is not committed).

## What it is not

Not a magic ClickCease replacement, not a blunt 4G blocker (a shared mobile IP can be a real customer). Stay conservative on local trades (locksmith, emergency call-outs, and the like).

## Tests

```bash
npm test
```
