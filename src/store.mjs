import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const HITS = path.join(DATA, "hits.jsonl");
const BLOCKS = path.join(DATA, "blocks.json");
const SITES = path.join(DATA, "sites.json");

export async function ensureData() {
  await mkdir(DATA, { recursive: true });
  try {
    await readFile(SITES, "utf8");
  } catch {
    const example = await readFile(path.join(ROOT, "sites.example.json"), "utf8");
    await writeFile(SITES, example);
  }
  try {
    await readFile(BLOCKS, "utf8");
  } catch {
    await writeFile(BLOCKS, "[]\n");
  }
  try {
    await readFile(HITS, "utf8");
  } catch {
    await writeFile(HITS, "");
  }
}

export async function loadSites() {
  const raw = JSON.parse(await readFile(SITES, "utf8"));
  return Array.isArray(raw.sites) ? raw.sites : [];
}

export async function appendHit(hit) {
  await appendFile(HITS, `${JSON.stringify(hit)}\n`);
}

export async function loadHits() {
  const raw = await readFile(HITS, "utf8");
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
  return JSON.parse(await readFile(BLOCKS, "utf8"));
}

export async function saveBlocks(blocks) {
  await writeFile(BLOCKS, `${JSON.stringify(blocks, null, 2)}\n`);
}

export async function upsertBlock(entry) {
  const blocks = await loadBlocks();
  const existing = blocks.find(
    (row) => row.ip === entry.ip && row.customerId === entry.customerId,
  );
  if (existing) {
    existing.reasons = [...new Set([...(existing.reasons ?? []), ...entry.reasons])];
    existing.sites = [...new Set([...(existing.sites ?? []), ...entry.sites])];
    existing.updatedAt = entry.updatedAt;
    existing.synced = existing.synced && entry.synced;
  } else {
    blocks.push(entry);
  }
  await saveBlocks(blocks);
  return existing ?? entry;
}
