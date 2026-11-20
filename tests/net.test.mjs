import assert from "node:assert/strict";
import test from "node:test";
import { ipInCidr } from "../src/net.mjs";

test("CIDR match includes the network address and a host inside", () => {
  assert.equal(ipInCidr("52.12.10.8", "52.0.0.0/8"), true);
  assert.equal(ipInCidr("203.0.113.10", "52.0.0.0/8"), false);
  assert.equal(ipInCidr("203.0.113.10", "203.0.113.0/24"), true);
});
