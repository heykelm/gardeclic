/**
 * Sync optionnel vers Google Ads.
 * Sans token : on n'appelle rien, le dashboard exporte les IP.
 */

function adsHeaders() {
  const token = process.env.GOOGLE_ADS_ACCESS_TOKEN;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token || !developerToken) return null;
  const headers = {
    Authorization: `Bearer ${token}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    headers["login-customer-id"] = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(
      /-/g,
      "",
    );
  }
  return headers;
}

export function adsConfigured() {
  return Boolean(adsHeaders());
}

export async function excludeIpOnCampaigns({ customerId, campaignIds, ip }) {
  const headers = adsHeaders();
  if (!headers) {
    return { skipped: true, reason: "no_ads_credentials" };
  }
  if (!customerId || !campaignIds?.length) {
    return { skipped: true, reason: "no_campaigns" };
  }

  const results = [];
  for (const campaignId of campaignIds) {
    const body = {
      operations: [
        {
          create: {
            campaign: `customers/${customerId}/campaigns/${campaignId}`,
            negative: true,
            ipBlock: { ipAddress: ip },
          },
        },
      ],
    };
    const response = await fetch(
      `https://googleads.googleapis.com/v19/customers/${customerId}/campaignCriteria:mutate`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    const json = await response.json().catch(() => ({}));
    results.push({ campaignId, status: response.status, body: json });
  }
  return { skipped: false, results };
}
