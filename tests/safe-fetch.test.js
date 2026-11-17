import assert from "node:assert/strict";
import { test } from "node:test";
import { isPrivateAddress } from "../lib/safe-fetch.js";

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
