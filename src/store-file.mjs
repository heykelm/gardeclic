import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { dataDir, packageRoot } from "./paths.mjs";

function hitsPath() {
  return path.join(dataDir(), "hits.jsonl");
}
function blocksPath() {
  return path.join(dataDir(), "blocks.json");
}
function sitesPath() {
  return path.join(dataDir(), "sites.json");
}

export async function ensureData() {
  await mkdir(dataDir(), { recursive: true });
  try {
    await readFile(sitesPath(), "utf8");
  } catch {
    const example = await readFile(path.join(packageRoot(), "sites.example.json"), "utf8");
    await writeFile(sitesPath(), example);
  }
  try {
    await readFile(blocksPath(), "utf8");
  } catch {
    await writeFile(blocksPath(), "[]\n");
  }
  try {
    await readFile(hitsPath(), "utf8");
  } catch {
    await writeFile(hitsPath(), "");
  }
}

export async function loadSites() {
  const raw = JSON.parse(await readFile(sitesPath(), "utf8"));
  return Array.isArray(raw.sites) ? raw.sites : [];
}

export async function saveSites(sites) {
  await writeFile(sitesPath(), `${JSON.stringify({ sites }, null, 2)}\n`);
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

export async function appendHit(hit) {
  await appendFile(hitsPath(), `${JSON.stringify(hit)}\n`);
}

export async function loadHits() {
  const raw = await readFile(hitsPath(), "utf8");
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function loadBlocks() {
  return JSON.parse(await readFile(blocksPath(), "utf8"));
}

export async function saveBlocks(blocks) {
  await writeFile(blocksPath(), `${JSON.stringify(blocks, null, 2)}\n`);
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
  try {
    const raw = await readFile(path.join(dataDir(), "hosting.cidrs"), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

export async function pruneHits(maxAgeMs) {
  const hits = await loadHits();
  const cutoff = Date.now() - maxAgeMs;
  const kept = hits.filter((row) => Number(row.at) >= cutoff);
  if (kept.length === hits.length) return hits.length;
  await writeFile(
    hitsPath(),
    kept.map((row) => JSON.stringify(row)).join("\n") + (kept.length ? "\n" : ""),
  );
  return kept.length;
}
