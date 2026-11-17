import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

// Addresses a recipe import from outside the home network must never reach: loopback,
// private LANs, link-local, carrier-grade NAT (Tailscale), multicast and reserved ranges.
// BlockList checks IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) against the IPv4 rules, so
// there is no ::ffff:0:0/96 rule here: that rule would match every IPv4 address.
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32],
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
]) blocked.addSubnet(address, prefix, "ipv6");

export function isPrivateAddress(address) {
  const value = String(address || "").replace(/^\[|\]$/g, "");
  const family = net.isIP(value);
  if (family === 4) return blocked.check(value, "ipv4");
  if (family === 6) return blocked.check(value, "ipv6");
  return true;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function privateAddressError() {
  return Object.assign(httpError(400, "That address is on a private network, so it cannot be imported from outside."), { code: "EPRIVATE" });
}

// dns.lookup wrapper that refuses private answers at connect time, so a name cannot be
// re-pointed at a private address between a check and the request.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) return callback(privateAddressError());
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function decode(response) {
  const encoding = String(response.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(zlib.createGunzip());
  if (encoding === "deflate") return response.pipe(zlib.createInflate());
  if (encoding === "br") return response.pipe(zlib.createBrotliDecompress());
  return response;
}

function requestOnce(url, { guard, headers, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      method: "GET",
      headers: { "accept-encoding": "gzip, deflate, br", ...headers },
      lookup: guard ? guardedLookup : undefined,
    }, (response) => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        resolve({ status, location: response.headers.location });
        return;
      }
      const chunks = [];
      let size = 0;
      const body = decode(response);
      body.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          body.destroy();
          request.destroy();
          resolve({ status, text: Buffer.concat(chunks).toString("utf8") });
          return;
        }
        chunks.push(chunk);
      });
      body.on("end", () => resolve({ status, text: Buffer.concat(chunks).toString("utf8") }));
      body.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
    request.end();
  });
}

// Fetches a page as text. With `guard`, hosts that are or resolve to private addresses are
// refused on every hop, and redirects are followed by hand (at most five).
export async function fetchPageText(rawUrl, { guard = false, headers = {}, timeoutMs = 10_000, maxBytes = 2_000_000 } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    throw httpError(400, "Enter a valid recipe URL.");
  }
  for (let hop = 0; hop <= 5; hop += 1) {
    if (!/^https?:$/.test(url.protocol)) throw httpError(400, "Only http and https recipe URLs are supported.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (guard && net.isIP(host) && isPrivateAddress(host)) throw privateAddressError();
    let result;
    try {
      result = await requestOnce(url, { guard, headers, timeoutMs, maxBytes });
    } catch (error) {
      if (error.code === "EPRIVATE") throw error;
      if (error.code === "ETIMEDOUT") throw httpError(504, "Fetching that page timed out.");
      throw httpError(502, "Could not reach that page.");
    }
    if (result.location) {
      url = new URL(result.location, url);
      continue;
    }
    return { ...result, url: url.toString() };
  }
  throw httpError(502, "That page redirected too many times.");
}
