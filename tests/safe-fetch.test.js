import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { fetchPageText, isPrivateAddress } from "../lib/safe-fetch.js";

test("a page that keeps sending slowly still hits the total deadline", { timeout: 8000 }, async () => {
  const slow = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    const drip = setInterval(() => response.write(" "), 100);
    response.on("close", () => clearInterval(drip));
  });
  await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
  const started = Date.now();
  try {
    await assert.rejects(
      fetchPageText(`http://127.0.0.1:${slow.address().port}/`, { timeoutMs: 500, totalMs: 1200 }),
      (error) => error.status === 504,
    );
    assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
  } finally {
    slow.closeAllConnections?.();
    await new Promise((resolve) => slow.close(resolve));
  }
});

test("treats loopback, LAN, link-local, Tailscale and reserved addresses as private", () => {
  for (const address of [
    "127.0.0.1", "10.20.30.40", "172.16.4.1", "192.168.1.10", "169.254.169.254", "100.100.20.30",
    "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd7a:115c:a1e0::1", "::ffff:127.0.0.1", "[::1]", "not-an-ip",
  ]) assert.equal(isPrivateAddress(address), true, address);
});

test("treats public addresses as reachable", () => {
  for (const address of ["1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "172.32.0.1", "100.128.0.1"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});
