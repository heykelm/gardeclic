import * as file from "./store-file.mjs";
import * as kv from "./store-kv.mjs";

export function kvConfigured() {
  return Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
      (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN),
  );
}

export function storeName() {
  if (kvConfigured()) return "kv";
  if (process.env.VERCEL) return "file-ephemeral";
  return "file";
}

function backend() {
  return kvConfigured() ? kv : file;
}

export async function ensureData() {
  return backend().ensureData();
}
export async function loadSites() {
  return backend().loadSites();
}
export async function saveSites(sites) {
  return backend().saveSites(sites);
}
export async function upsertSite(entry) {
  return backend().upsertSite(entry);
}
export async function appendHit(hit) {
  return backend().appendHit(hit);
}
export async function loadHits() {
  return backend().loadHits();
}
export async function loadBlocks() {
  return backend().loadBlocks();
}
export async function saveBlocks(blocks) {
  return backend().saveBlocks(blocks);
}
export async function upsertBlock(entry) {
  return backend().upsertBlock(entry);
}
export async function loadExtraCidrs() {
  const fromStore = await backend().loadExtraCidrs();
  const fromEnv = (process.env.GARDECLIC_EXTRA_CIDRS ?? "")
    .split(/[,\s]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...fromStore, ...fromEnv];
}
export async function pruneHits(maxAgeMs) {
  return backend().pruneHits(maxAgeMs);
}
