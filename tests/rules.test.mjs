import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHit } from "../src/rules.mjs";

const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605";
const options = {
  windowMs: 24 * 60 * 60 * 1000,
  repeatLimit: 4,
  networkSites: 2,
  burstLimit: 3,
  burstMs: 120_000,
  uaChurnLimit: 4,
};

function hit(partial) {
  return { ua, ...partial };
}

test("a single paid click is not flagged", () => {
  const row = hit({ ip: "203.0.113.1", site: "a", gclid: "x", at: 1_000 });
  const verdict = evaluateHit(row, [row], options);
  assert.equal(verdict.flagged, false);
});

test("four paid clicks from the same IP in the window → repeat_paid", () => {
  const hits = [1, 2, 3, 4].map((n) =>
    hit({ ip: "203.0.113.9", site: "a", gclid: `g${n}`, at: n }),
  );
  const verdict = evaluateHit(hits[3], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("repeat_paid"));
});

test("same IP on two sites with gclid → network_repeat", () => {
  const hits = [
    hit({ ip: "203.0.113.8", site: "rideup", gclid: "1", at: 1 }),
    hit({ ip: "203.0.113.8", site: "taxilimo", gclid: "2", at: 2 }),
  ];
  const verdict = evaluateHit(hits[1], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("network_repeat"));
});

test("three paid clicks in two minutes → burst", () => {
  const hits = [0, 10_000, 20_000].map((at, n) =>
    hit({ ip: "203.0.113.20", site: "nicehub", gclid: `b${n}`, at }),
  );
  const verdict = evaluateHit(hits[2], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("burst"));
});

test("same gclid from two IPs → click_id_reuse", () => {
  const hits = [
    hit({ ip: "203.0.113.30", site: "a", gclid: "shared", at: 1 }),
    hit({ ip: "203.0.113.31", site: "a", gclid: "shared", at: 2 }),
  ];
  const verdict = evaluateHit(hits[1], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("click_id_reuse"));
});

test("automation user-agent on a paid click → bot_ua", () => {
  const row = hit({
    ip: "203.0.113.40",
    site: "a",
    gclid: "x",
    at: 1,
    ua: "python-requests/2.31.0",
  });
  const verdict = evaluateHit(row, [row], options);
  assert.ok(verdict.reasons.includes("bot_ua"));
});

test("AWS-like address → hosting", () => {
  const row = hit({ ip: "52.12.10.8", site: "a", gclid: "x", at: 1 });
  const verdict = evaluateHit(row, [row], options);
  assert.ok(verdict.reasons.includes("hosting"));
});

test("many user-agents from one IP → ua_churn", () => {
  const hits = ["Chrome/1", "Chrome/2", "Firefox/3", "Safari/4"].map((name, n) =>
    hit({
      ip: "203.0.113.50",
      site: "a",
      gclid: `u${n}`,
      at: n + 1,
      ua: `Mozilla/5.0 ${name} AppleWebKit`,
    }),
  );
  const verdict = evaluateHit(hits[3], hits, options);
  assert.ok(verdict.reasons.includes("ua_churn"));
});
