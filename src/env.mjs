import { readFileSync } from "node:fs";
import { envFile } from "./paths.mjs";

export function applyEnvText(raw) {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

export function loadEnv() {
  try {
    applyEnvText(readFileSync(envFile(), "utf8"));
  } catch {
    /* no .env yet */
  }
}
