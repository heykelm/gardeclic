/**
 * Vercel KV / Upstash REST. Serverless has no durable disk.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { packageRoot } from "./paths.mjs";

const KEYS = {
  sites: "gardeclic:sites",
  blocks: "gardeclic:blocks",
  hits: "gardeclic:hits",
  cidrs: "gardeclic:cidrs",
};

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("kv_not_configured");
  return { url: url.replace(/\/$/, ""), token };
}

async function redis(commands) {
  const { url, token } = creds();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`kv_http_${res.status}`);
  return json;
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getKey(key, fallback) {
  const rows = await redis([["GET", key]]);
  const value = Array.isArray(rows) ? rows[0]?.result : rows?.result;
  return parseJson(value, fallback);
}

async function setKey(key, value) {
  await redis([["SET", key, JSON.stringify(value)]]);
}

export async function ensureData() {
  const sites = await getKey(KEYS.sites, null);
  if (!sites) {
    const example = JSON.parse(await readFile(path.join(packageRoot(), "sites.example.json"), "utf8"));
    await setKey(KEYS.sites, example.sites ?? []);
  }
  if ((await getKey(KEYS.blocks, null)) == null) await setKey(KEYS.blocks, []);
  if ((await getKey(KEYS.hits, null)) == null) await setKey(KEYS.hits, []);
}

export async function loadSites() {
  const raw = await getKey(KEYS.sites, []);
  return Array.isArray(raw) ? raw : raw.sites ?? [];
}

export async function saveSites(sites) {
  await setKey(KEYS.sites, sites);
}

export async function upsertSite(entry) {
  await ensureData();
  const id = String(entry.id ?? "").trim();
  if (!id) throw new Error("site id required");
  const sites = await loadSites();
  const campaignIds = Array.isArray(entry.campaignIds)
    ? entry.campaignIds.map(String).filter(Boolean)
    : [];
  const next = {
    id,
    host: String(entry.host ?? "").trim(),
    customerId: String(entry.customerId ?? "").replace(/-/g, ""),
    campaignIds,
  };
  const index = sites.findIndex((row) => row.id === id);
  if (index >= 0) {
    const prev = sites[index];
    sites[index] = {
      ...prev,
      ...next,
      host: next.host || prev.host,
      customerId: next.customerId || prev.customerId,
      campaignIds: campaignIds.length ? campaignIds : prev.campaignIds || [],
    };
  } else {
    sites.push(next);
  }
  await saveSites(sites);
  return sites.find((row) => row.id === id);
}

export async function loadHits() {
  const raw = await getKey(KEYS.hits, []);
  return Array.isArray(raw) ? raw : [];
}

export async function appendHit(hit) {
  const hits = await loadHits();
  hits.push(hit);
  await setKey(KEYS.hits, hits);
}

export async function loadBlocks() {
  const raw = await getKey(KEYS.blocks, []);
  return Array.isArray(raw) ? raw : [];
}

export async function saveBlocks(blocks) {
  await setKey(KEYS.blocks, blocks);
}

export async function upsertBlock(entry) {
  const blocks = await loadBlocks();
  const existing = blocks.find(
    (row) => row.ip === entry.ip && row.customerId === entry.customerId,
  );
  if (existing) {
    const before = new Set(existing.reasons ?? []);
    existing.reasons = [...new Set([...(existing.reasons ?? []), ...(entry.reasons ?? [])])];
    existing.sites = [...new Set([...(existing.sites ?? []), ...(entry.sites ?? [])])];
    existing.updatedAt = entry.updatedAt;
    existing.synced = Boolean(entry.synced) || Boolean(existing.synced);
    await saveBlocks(blocks);
    return {
      block: existing,
      isNew: false,
      addedReasons: existing.reasons.filter((reason) => !before.has(reason)),
    };
  }
  blocks.push(entry);
  await saveBlocks(blocks);
  return {
    block: entry,
    isNew: true,
    addedReasons: entry.reasons ?? [],
  };
}

export async function loadExtraCidrs() {
  const raw = await getKey(KEYS.cidrs, []);
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }
  return [];
}

export async function pruneHits(maxAgeMs) {
  const hits = await loadHits();
  const cutoff = Date.now() - maxAgeMs;
  const kept = hits.filter((row) => Number(row.at) >= cutoff);
  if (kept.length === hits.length) return hits.length;
  await setKey(KEYS.hits, kept);
  return kept.length;
}
