import { adsConfigured, excludeIpOnCampaigns } from "./ads.mjs";
import { loadBlocks, loadSites, upsertBlock } from "./store.mjs";

export async function syncPendingBlocks() {
  if (!adsConfigured()) {
    return { error: "ads_not_configured", results: [] };
  }
  const sites = await loadSites();
  const blocks = await loadBlocks();
  const results = [];
  for (const block of blocks) {
    if (block.synced) continue;
    const site =
      sites.find((row) => row.customerId === block.customerId) ??
      sites.find((row) => (block.sites || []).includes(row.id));
    if (!site?.customerId || !site.campaignIds?.length) continue;
    const sync = await excludeIpOnCampaigns({
      customerId: site.customerId,
      campaignIds: site.campaignIds,
      ip: block.ip,
    });
    const ok = !sync.skipped && sync.results?.every((row) => row.status < 300);
    if (ok) {
      await upsertBlock({ ...block, synced: true, updatedAt: new Date().toISOString() });
    }
    results.push({ ip: block.ip, ok, skipped: sync.skipped ?? false });
  }
  return { results };
}
