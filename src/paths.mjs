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
  return path.join(homeDir(), "data");
}

export function envFile() {
  return path.join(homeDir(), ".env");
}
