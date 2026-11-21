import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { envFile, packageRoot } from "./paths.mjs";

export async function ensureEnvFile() {
  const dest = envFile();
  try {
    await readFile(dest, "utf8");
  } catch {
    const example = await readFile(path.join(packageRoot(), ".env.example"), "utf8");
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, example);
  }
  return dest;
}

export async function upsertEnvFile(file, entries) {
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch {
    raw = "";
  }
  const lines = raw.length ? raw.split("\n") : [];
  const keys = Object.keys(entries).filter((key) => entries[key] != null && entries[key] !== "");
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (match && keys.includes(match[1])) {
      out.push(`${match[1]}=${entries[match[1]]}`);
      seen.add(match[1]);
    } else {
      out.push(line);
    }
  }
  if (out.length && out[out.length - 1] === "") out.pop();
  for (const key of keys) {
    if (!seen.has(key)) out.push(`${key}=${entries[key]}`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${out.join("\n")}\n`);
  for (const key of keys) process.env[key] = String(entries[key]);
}
