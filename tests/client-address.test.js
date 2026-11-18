import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clientAddress, clientIpHeaderSetting, createApp } from "../server.js";

// A request as clientAddress sees it: the headers and the connection's own address.
function request(remoteAddress, headers = {}) {
  return { headers, socket: { remoteAddress } };
}

const FIVE_THEN_PAUSED = [401, 401, 401, 401, 401, 429];
const NEVER_PAUSED = [401, 401, 401, 401, 401, 401];

// Runs `use` against a fresh app's sign-in port. `send(username, headers)` posts one wrong
// password and returns the status.
async function withSignInPort(clientIpHeader, use) {
  const dir = await mkdtemp(path.join(tmpdir(), "recipe-box-address-"));
  const app = await createApp({ dataFile: path.join(dir, "recipes.json"), clientIpHeader });
  await new Promise((resolve) => app.publicServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.publicServer.address().port}`;
  const send = async (username, headers) => (await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ username, password: "not-the-password" }),
  })).status;
  try {
    await use(send);
  } finally {
    await new Promise((resolve) => app.publicServer.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

async function sixTries(send, username, headersFor) {
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) statuses.push(await send(username, headersFor(attempt)));
  return statuses;
}

test("the setting names one header: unset means Cloudflare's, and any other value is refused", () => {
  assert.equal(clientIpHeaderSetting(undefined), "cf-connecting-ip");
  assert.equal(clientIpHeaderSetting(""), "cf-connecting-ip");
  assert.equal(clientIpHeaderSetting(" X-Forwarded-For "), "x-forwarded-for");
  assert.equal(clientIpHeaderSetting("NONE"), "none");
  assert.throws(() => clientIpHeaderSetting("x-real-ip"), /CLIENT_IP_HEADER must be one of cf-connecting-ip, x-forwarded-for, none/);
});

test("by default only CF-Connecting-IP names the visitor, and only from a proxy on loopback or a private network", () => {
  const headers = { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.1, 203.0.113.2" };
  for (const proxy of ["127.0.0.1", "::1", "172.18.0.1", "::ffff:172.18.0.1", "10.0.0.5", "192.168.1.20", "fd00::5"]) {
    assert.equal(clientAddress(request(proxy, headers), "public"), "198.51.100.7", `from ${proxy}`);
  }
  assert.equal(clientAddress(request("172.18.0.1", { "x-forwarded-for": "203.0.113.2" }), "public"), "172.18.0.1", "X-Forwarded-For is not read by default");
  for (const visitor of ["203.0.113.50", "::ffff:203.0.113.50", "100.101.102.103", "2001:db8::50"]) {
    assert.equal(clientAddress(request(visitor, headers), "public"), visitor, `a visitor connecting from ${visitor} cannot name another address`);
  }
  assert.equal(clientAddress(request("172.18.0.1", { "cf-connecting-ip": "not an address" }), "public"), "172.18.0.1");
  assert.equal(clientAddress(request("172.18.0.1", headers), "home"), "172.18.0.1", "the home port counts the connection");
});

test("x-forwarded-for reads only the last entry, the one the proxy added", () => {
  const forged = { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.1, 198.51.100.9" };
  assert.equal(clientAddress(request("172.18.0.1", forged), "public", "x-forwarded-for"), "198.51.100.9");
  assert.equal(clientAddress(request("172.18.0.1", { "cf-connecting-ip": "198.51.100.7" }), "public", "x-forwarded-for"), "172.18.0.1", "CF-Connecting-IP is not read");
  assert.equal(clientAddress(request("203.0.113.50", forged), "public", "x-forwarded-for"), "203.0.113.50", "a visitor connecting directly cannot name another address");
});

test("none counts the connection's own address", () => {
  const headers = { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "198.51.100.9" };
  assert.equal(clientAddress(request("172.18.0.1", headers), "public", "none"), "172.18.0.1");
});

test("through the sign-in port, the default counts CF-Connecting-IP and never X-Forwarded-For", async () => {
  await withSignInPort(undefined, async (send) => {
    assert.deepEqual(await sixTries(send, "visitor-one", (n) => ({ "cf-connecting-ip": `198.51.100.${n + 1}` })), NEVER_PAUSED);
    assert.deepEqual(await sixTries(send, "visitor-two", (n) => ({ "x-forwarded-for": `198.51.100.${n + 1}` })), FIVE_THEN_PAUSED);
  });
});

test("through the sign-in port, x-forwarded-for counts the last entry and ignores CF-Connecting-IP", async () => {
  await withSignInPort("X-Forwarded-For", async (send) => {
    assert.deepEqual(await sixTries(send, "visitor-one", (n) => ({ "cf-connecting-ip": `198.51.100.${n + 1}`, "x-forwarded-for": `203.0.113.${n + 1}, 198.51.100.200` })), FIVE_THEN_PAUSED);
    assert.deepEqual(await sixTries(send, "visitor-two", (n) => ({ "x-forwarded-for": `198.51.100.200, 203.0.113.${n + 1}` })), NEVER_PAUSED);
  });
});

test("through the sign-in port, none counts the connection whatever the headers say", async () => {
  await withSignInPort("none", async (send) => {
    assert.deepEqual(await sixTries(send, "visitor-one", (n) => ({ "cf-connecting-ip": `198.51.100.${n + 1}`, "x-forwarded-for": `203.0.113.${n + 1}` })), FIVE_THEN_PAUSED);
  });
});

test("an unknown setting stops the app before it starts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recipe-box-address-"));
  try {
    await assert.rejects(createApp({ dataFile: path.join(dir, "recipes.json"), clientIpHeader: "x-real-ip" }), /CLIENT_IP_HEADER must be one of/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
