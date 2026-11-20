/**
 * Readable paid-click rules. No fingerprinting, no secret score.
 * Each reason below is a named signal the admin can turn off.
 */

import { HOSTING_CIDRS } from "./hosting-cidrs.mjs";
import { ipInAnyCidr } from "./net.mjs";
import { isAutomationUa } from "./ua.mjs";

export function evaluateHit(hit, allHits, options = {}) {
  const {
    windowMs = 24 * 60 * 60 * 1000,
    repeatLimit = 4,
    networkSites = 2,
    burstLimit = 3,
    burstMs = 120 * 1000,
    uaChurnLimit = 4,
    useRepeat = true,
    useNetwork = true,
    useBurst = true,
    useClickIdReuse = true,
    useBotUa = true,
    useHosting = true,
    useUaChurn = true,
    extraCidrs = [],
  } = options;

  const reasons = [];
  const since = hit.at - windowMs;
  const recent = allHits.filter(
    (row) => row.ip === hit.ip && row.at >= since && row.at <= hit.at,
  );
  const paid = recent.filter((row) => row.gclid);

  if (useRepeat && hit.gclid && paid.length >= repeatLimit) {
    reasons.push("repeat_paid");
  }

  const sites = new Set(paid.map((row) => row.site));
  if (useNetwork && hit.gclid && sites.size >= networkSites && paid.length >= 2) {
    reasons.push("network_repeat");
  }

  if (useBurst && hit.gclid) {
    const burstSince = hit.at - burstMs;
    const burstPaid = paid.filter((row) => row.at >= burstSince);
    if (burstPaid.length >= burstLimit) {
      reasons.push("burst");
    }
  }

  if (useClickIdReuse && hit.gclid) {
    const ips = new Set(
      allHits
        .filter((row) => row.gclid === hit.gclid && row.at <= hit.at)
        .map((row) => row.ip),
    );
    if (ips.size >= 2) {
      reasons.push("click_id_reuse");
    }
  }

  if (useBotUa && hit.gclid && isAutomationUa(hit.ua)) {
    reasons.push("bot_ua");
  }

  if (useHosting && hit.gclid && ipInAnyCidr(hit.ip, [...HOSTING_CIDRS, ...extraCidrs])) {
    reasons.push("hosting");
  }

  if (useUaChurn && hit.gclid) {
    const uas = new Set(
      paid.map((row) => String(row.ua ?? "").trim()).filter((ua) => ua.length >= 8),
    );
    if (uas.size >= uaChurnLimit) {
      reasons.push("ua_churn");
    }
  }

  return {
    flagged: reasons.length > 0,
    reasons,
    paidCount: paid.length,
    siteCount: sites.size,
  };
}

export { HOSTING_CIDRS };
