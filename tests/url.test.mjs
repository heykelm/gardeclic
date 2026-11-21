import assert from "node:assert/strict";
import test from "node:test";
import { incomingUrl } from "../src/server.mjs";

test("Vercel rewrite __path is the public pathname", () => {
  const url = incomingUrl({
    url: "/api/index?__path=/s.js",
    headers: { host: "gardeclic.vercel.app", "x-forwarded-proto": "https" },
  });
  assert.equal(url.pathname, "/s.js");
  assert.equal(url.host, "gardeclic.vercel.app");
  assert.equal(url.protocol, "https:");
});
