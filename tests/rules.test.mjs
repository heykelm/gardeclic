import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHit } from "../src/rules.mjs";

const options = { windowMs: 24 * 60 * 60 * 1000, repeatLimit: 4, networkSites: 2 };

test("un clic payant isolé n'est pas flaggé", () => {
  const hit = { ip: "1.1.1.1", site: "a", gclid: "x", at: 1_000 };
  const verdict = evaluateHit(hit, [hit], options);
  assert.equal(verdict.flagged, false);
});

test("quatre clics payants de la même IP dans la fenêtre → repeat_paid", () => {
  const hits = [1, 2, 3, 4].map((n) => ({
    ip: "9.9.9.9",
    site: "a",
    gclid: "g",
    at: n,
  }));
  const verdict = evaluateHit(hits[3], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("repeat_paid"));
});

test("la même IP sur deux sites avec gclid → network_repeat", () => {
  const hits = [
    { ip: "8.8.8.8", site: "a", gclid: "1", at: 1 },
    { ip: "8.8.8.8", site: "b", gclid: "2", at: 2 },
  ];
  const verdict = evaluateHit(hits[1], hits, options);
  assert.equal(verdict.flagged, true);
  assert.ok(verdict.reasons.includes("network_repeat"));
});
