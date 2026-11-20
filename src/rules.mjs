/**
 * Règles volontairement courtes et lisibles.
 * Ce n'est pas un clone de ClickCease : pas de « 2000 tests »,
 * pas de fingerprint opaque. Trois motifs, documentés.
 */

const DATACENTER_PREFIXES = [
  "34.", // Google Cloud (souvent scrapers, pas un visiteur Toulouse)
  "35.",
  "52.", // AWS large ranges — heuristique large, désactivable
  "104.16.", // Cloudflare
  "104.17.",
  "104.18.",
];

export function evaluateHit(hit, allHits, options) {
  const {
    windowMs = 24 * 60 * 60 * 1000,
    repeatLimit = 4,
    networkSites = 2,
    useDatacenter = false,
  } = options;

  const reasons = [];
  const since = hit.at - windowMs;
  const recent = allHits.filter(
    (row) => row.ip === hit.ip && row.at >= since && row.at <= hit.at,
  );
  const paid = recent.filter((row) => row.gclid);

  if (hit.gclid && paid.length >= repeatLimit) {
    reasons.push("repeat_paid");
  }

  const sites = new Set(paid.map((row) => row.site));
  if (hit.gclid && sites.size >= networkSites && paid.length >= 2) {
    reasons.push("network_repeat");
  }

  if (useDatacenter && DATACENTER_PREFIXES.some((prefix) => hit.ip.startsWith(prefix))) {
    reasons.push("datacenter");
  }

  return {
    flagged: reasons.length > 0,
    reasons,
    paidCount: paid.length,
    siteCount: sites.size,
  };
}

export { DATACENTER_PREFIXES };
