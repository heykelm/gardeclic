import { loadExtraCidrs } from "./store.mjs";

export function envOn(name, defaultOn = true) {
  const value = process.env[name];
  if (value == null || value === "") return defaultOn;
  return value !== "0" && value !== "false";
}

export async function ruleOptions() {
  return {
    windowMs: Number(process.env.GARDECLIC_WINDOW_HOURS ?? 24) * 60 * 60 * 1000,
    repeatLimit: Number(process.env.GARDECLIC_REPEAT_LIMIT ?? 4),
    networkSites: Number(process.env.GARDECLIC_NETWORK_SITES ?? 2),
    burstLimit: Number(process.env.GARDECLIC_BURST_LIMIT ?? 3),
    burstMs: Number(process.env.GARDECLIC_BURST_SECONDS ?? 120) * 1000,
    uaChurnLimit: Number(process.env.GARDECLIC_UA_CHURN ?? 4),
    useBurst: envOn("GARDECLIC_BURST"),
    useClickIdReuse: envOn("GARDECLIC_CLICK_ID_REUSE"),
    useBotUa: envOn("GARDECLIC_BOT_UA"),
    useHosting: envOn("GARDECLIC_HOSTING") && process.env.GARDECLIC_DATACENTER !== "0",
    useUaChurn: envOn("GARDECLIC_UA_CHURN_ON"),
    extraCidrs: await loadExtraCidrs(),
  };
}

export function enabledRuleNames(opts) {
  const names = ["repeat_paid", "network_repeat"];
  if (opts.useBurst) names.push("burst");
  if (opts.useClickIdReuse) names.push("click_id_reuse");
  if (opts.useBotUa) names.push("bot_ua");
  if (opts.useHosting) names.push("hosting");
  if (opts.useUaChurn) names.push("ua_churn");
  return names;
}

export function publicOrigin() {
  const raw = process.env.GARDECLIC_PUBLIC_ORIGIN;
  if (raw) return raw.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "")}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 8787}`;
}
