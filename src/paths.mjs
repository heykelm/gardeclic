import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packageRoot() {
  return PKG;
}

export function homeDir() {
  return process.env.GARDECLIC_HOME || PKG;
}

export function projectDir() {
  return process.env.GARDECLIC_PROJECT || process.cwd();
}

export function dataDir() {
  if (process.env.GARDECLIC_DATA_DIR) return process.env.GARDECLIC_DATA_DIR;
  const hasKv =
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN);
  if (process.env.VERCEL && !hasKv) return "/tmp/gardeclic-data";
  return path.join(homeDir(), "data");
}

export function envFile() {
  return path.join(homeDir(), ".env");
}
