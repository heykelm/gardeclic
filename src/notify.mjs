/**
 * Prévenir l'admin : e-mail (Resend) et/ou webhook.
 * Un mail par nouvelle IP (ou nouvelle raison), pas à chaque clic suivant.
 */

function reasonLabel(reason) {
  return {
    repeat_paid: "trop de clics payants depuis la même IP",
    network_repeat: "même IP sur plusieurs de tes sites",
    burst: "rafale de clics payants trop rapides",
    click_id_reuse: "même identifiant de clic Ads vu depuis plusieurs IP",
    bot_ua: "user-agent automate ou vide",
    hosting: "IP d’hébergeur / cloud",
    datacenter: "IP d’hébergeur / cloud",
    ua_churn: "trop de navigateurs différents depuis la même IP",
    manual: "exclusion manuelle",
  }[reason] ?? reason;
}

export function buildAlert({ ip, site, host, reasons, paidCount, dashboardUrl }) {
  const why = (reasons ?? []).map(reasonLabel).join(" ; ");
  const subject = `GardeClic : IP ${ip} risque de te coûter des clics Ads`;
  const text = [
    `Une IP vient d’être flaggée sur ${host || site || "un de tes sites"}.`,
    "",
    `IP : ${ip}`,
    `Site : ${site || "—"}`,
    `Pourquoi : ${why || "règle GardeClic"}`,
    paidCount != null ? `Clics payants vus dans la fenêtre : ${paidCount}` : "",
    "",
    "Ce n’est pas encore exclu dans Google Ads tant que tu n’as pas validé",
    "(export CSV ou sync Ads), sauf si la sync auto est déjà branchée.",
    dashboardUrl ? `\nTableau de bord : ${dashboardUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, text };
}

export async function notifyAdmin(payload) {
  const to = process.env.GARDECLIC_ALERT_EMAIL;
  const webhook = process.env.GARDECLIC_WEBHOOK_URL;
  const { subject, text } = buildAlert(payload);
  const jobs = [];

  if (to && process.env.RESEND_API_KEY) {
    jobs.push(
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.GARDECLIC_ALERT_FROM || "GardeClic <onboarding@resend.dev>",
          to: [to],
          subject,
          text,
        }),
      }),
    );
  }

  if (webhook) {
    jobs.push(
      fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, text, ...payload }),
      }),
    );
  }

  if (jobs.length === 0) return { sent: false, reason: "no_channel" };
  const results = await Promise.allSettled(jobs);
  return { sent: results.some((row) => row.status === "fulfilled"), results };
}
