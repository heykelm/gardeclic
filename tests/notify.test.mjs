import assert from "node:assert/strict";
import test from "node:test";
import { buildAlert } from "../src/notify.mjs";

test("l'alerte nomme l'IP et explique le risque Ads", () => {
  const alert = buildAlert({
    ip: "203.0.113.10",
    site: "serru24",
    host: "serru24.fr",
    reasons: ["repeat_paid"],
    paidCount: 4,
    dashboardUrl: "http://localhost:8787/?key=x",
  });
  assert.match(alert.subject, /203\.0\.113\.10/);
  assert.match(alert.text, /serru24\.fr/);
  assert.match(alert.text, /trop de clics payants/);
  assert.match(alert.text, /Tableau de bord/);
});
