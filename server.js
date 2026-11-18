import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecipeStore } from "./lib/store.js";
import { SESSION_DAYS, UserStore } from "./lib/users.js";
import { handleMcpMessage } from "./lib/mcp.js";
import { extractRecipeFromHtml } from "./lib/recipe-import.js";
import { fetchPageText } from "./lib/safe-fetch.js";

const { version: APP_VERSION } = createRequire(import.meta.url)("./package.json");

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const seedFile = path.join(rootDir, "data", "seed-recipes.json");
const defaultDataFile = path.join(rootDir, "data", "runtime", "recipes.json");

const SESSION_COOKIE = "rb_session";
// Requests that came through Cloudflare carry these. On the home listener they mean a tunnel
// route points at the home port by mistake, so they get the outside rules (sign-in required).
const CLOUDFLARE_HEADERS = ["cf-ray", "cf-connecting-ip", "cdn-loop"];
const ROLE_RANK = { member: 1, editor: 2, admin: 3 };
const ACCESS_RANK = { person: 1, editor: 2, admin: 3 };

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = value === null ? "" : JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

async function readJson(request, limit = 512_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const type = String(request.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("application/json")) throw httpError(415, "Send the request body as JSON.");
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

function requestZone(request, listenerZone) {
  if (listenerZone === "public") return "public";
  return CLOUDFLARE_HEADERS.some((name) => request.headers[name]) ? "public" : "home";
}

// Names a browser can only reach on the home network or tailnet. A web page cannot point a
// name like these at this server, so a page elsewhere cannot re-point ("rebind") its own
// domain here and act as the Owner. Other names go in TRUSTED_HOSTS (comma separated).
const HOME_HOST_SUFFIXES = [".local", ".lan", ".home.arpa", ".internal", ".localhost", ".ts.net"];

function hostName(header) {
  const value = String(header || "").trim().toLowerCase();
  const host = value.startsWith("[") ? value.slice(1, value.indexOf("]")) : value.split(":")[0];
  return host.replace(/\.$/, "");
}

export function isHomeHost(header, trustedHosts = []) {
  const host = hostName(header);
  if (!host) return false;
  if (net.isIP(host) || host === "localhost" || !host.includes(".")) return true;
  if (HOME_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return trustedHosts.includes(host);
}

// The visitor's address for sign-in throttling. CLIENT_IP_HEADER names the one header that
// the proxy in front of the sign-in port writes:
// - cf-connecting-ip (the default): Cloudflare Tunnel, which sets it on every request;
// - x-forwarded-for: another proxy that adds the address it saw as the last entry;
// - none: nothing in front of the port, so the connection's own address is the visitor's.
// A visitor can send either header too, so nothing else is read, and a header counts only when
// the connection comes from loopback or a private network, where such a proxy runs. Anyone who
// reaches the port directly is counted by their own address.
export const CLIENT_IP_HEADERS = ["cf-connecting-ip", "x-forwarded-for", "none"];

export function clientIpHeaderSetting(value) {
  const setting = String(value ?? "").trim().toLowerCase() || CLIENT_IP_HEADERS[0];
  if (!CLIENT_IP_HEADERS.includes(setting)) {
    throw new Error(`CLIENT_IP_HEADER must be one of ${CLIENT_IP_HEADERS.join(", ")} (got ${JSON.stringify(String(value))}).`);
  }
  return setting;
}

const PROXY_NETWORKS = new net.BlockList();
for (const [network, prefix] of [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]]) {
  PROXY_NETWORKS.addSubnet(network, prefix, "ipv4");
}
PROXY_NETWORKS.addAddress("::1", "ipv6");
PROXY_NETWORKS.addSubnet("fc00::", 7, "ipv6");

// An IPv4 connection to a server listening on "::" arrives as ::ffff:a.b.c.d, which BlockList
// matches against the IPv4 ranges (checked on Node 22, 24 and 26).
function fromProxyNetwork(address) {
  const family = net.isIP(String(address || ""));
  return family !== 0 && PROXY_NETWORKS.check(address, family === 6 ? "ipv6" : "ipv4");
}

export function clientAddress(request, zone, header = CLIENT_IP_HEADERS[0]) {
  const connection = request.socket?.remoteAddress || "unknown";
  if (zone !== "public" || header === "none" || !fromProxyNetwork(connection)) return connection;
  const value = header === "x-forwarded-for"
    ? String(request.headers["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean).pop() || ""
    : String(request.headers["cf-connecting-ip"] || "").trim();
  return net.isIP(value) ? value : connection;
}

function isHttps(request) {
  if (String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https") return true;
  return /"scheme"\s*:\s*"https"/.test(String(request.headers["cf-visitor"] || ""));
}

function sessionCookie(request, token, maxAgeSeconds) {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

// Browsers say where a request came from. Anything that changes data must come from this
// app's own pages (or from a client that is not a browser, such as an MCP client or curl).
function assertSameOrigin(request) {
  const site = request.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") throw httpError(403, "Requests from other sites are not allowed.");
}

async function lookupProduct(barcode) {
  const code = String(barcode || "").replace(/\s/g, "");
  if (!/^[0-9]{6,18}$/.test(code)) throw httpError(400, "Enter a valid grocery barcode.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const fields = "code,product_name,product_name_en,brands,quantity,categories_tags";
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, {
      headers: { "user-agent": "RecipeBox/2.0 (private personal cookbook)" },
      signal: controller.signal,
    });
    if (!response.ok) throw httpError(502, "Product lookup is unavailable right now.");
    const payload = await response.json();
    if (payload.status !== 1 || !payload.product) return { found: false, barcode: code };
    const product = payload.product;
    return {
      found: true,
      barcode: code,
      name: String(product.product_name_en || product.product_name || "").trim(),
      brand: String(product.brands || "").split(",")[0].trim(),
      packageQuantity: String(product.quantity || "").trim(),
      category: String(product.categories_tags?.[0] || "").replace(/^en:/, "").replace(/-/g, " "),
      source: "Open Food Facts",
    };
  } catch (error) {
    // The page adds "Enter the item name manually." after these.
    if (error.name === "AbortError") throw httpError(504, "Product lookup timed out.");
    if (!error.status) throw httpError(502, "Product lookup is unavailable right now.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// From outside the home network the page fetch refuses private addresses on every hop.
async function importRecipeFromUrl(rawUrl, { guard }) {
  const page = await fetchPageText(rawUrl, {
    guard,
    headers: { "user-agent": `RecipeBox/${APP_VERSION} (self-hosted recipe library)`, accept: "text/html,application/xhtml+xml" },
  });
  if (page.status < 200 || page.status >= 300) throw httpError(502, `That page responded with ${page.status}.`);
  const recipe = extractRecipeFromHtml(page.text, page.url);
  if (!recipe) throw httpError(422, "No structured recipe found on that page. Paste the recipe text into Quick fill instead.");
  return { recipe };
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return false;
  }
  const filePath = path.resolve(publicDir, `.${decoded}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const longCache = /\.(?:webp|png|svg|ico)$/.test(extension);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extension] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": longCache ? "public, max-age=604800" : "no-cache",
    });
    if (request.method === "HEAD") response.end();
    else response.end(body);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Access levels: "open" (anyone), "person" (signed in, or the Owner on the home network),
// "editor", "admin", and "home" (home network only, acting as the Owner).
function buildRoutes({ store, users }) {
  const me = (ctx) => ctx.user.id;
  const sessionPayload = (ctx, user = ctx.user, signedIn = ctx.signedIn) => ({
    user: users.publicUser(user), zone: ctx.zone, signedIn, homeNetwork: ctx.zone === "home",
  });
  const decodeId = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      throw httpError(400, "Bad id.");
    }
  };

  return [
    {
      method: "GET", path: "/api/health", access: "open",
      handler: ({ response, ctx }) => sendJson(response, 200, ctx.zone === "public"
        ? { status: "ok" }
        : { status: "ok", ...store.counts(), version: APP_VERSION }),
    },
    {
      method: "GET", path: "/api/session", access: "open",
      handler: ({ request, response, ctx }) => {
        if (!ctx.stale) return sendJson(response, 200, sessionPayload(ctx));
        response.setHeader("set-cookie", sessionCookie(request, "", 0));
        return sendJson(response, 200, sessionPayload(ctx, ctx.zone === "home" ? users.owner() : null, false));
      },
    },
    {
      method: "POST", path: "/api/session", access: "open",
      handler: async ({ request, response, ctx }) => {
        const body = await readJson(request, 16_000);
        const { token, user } = await users.signIn(body.username, body.password, { address: ctx.address, zone: ctx.zone });
        if (ctx.token) await users.signOut(ctx.token);
        response.setHeader("set-cookie", sessionCookie(request, token, SESSION_DAYS * 86_400));
        sendJson(response, 200, { ...sessionPayload(ctx, null, true), user });
      },
    },
    {
      method: "DELETE", path: "/api/session", access: "open",
      handler: async ({ request, response, ctx }) => {
        await users.signOut(ctx.token);
        response.setHeader("set-cookie", sessionCookie(request, "", 0));
        sendJson(response, 200, sessionPayload(ctx, ctx.zone === "home" ? users.owner() : null, false));
      },
    },
    {
      method: "DELETE", path: "/api/sessions", access: "person",
      handler: async ({ request, response, ctx }) => {
        await users.signOutEverywhere(me(ctx));
        if (ctx.signedIn) response.setHeader("set-cookie", sessionCookie(request, "", 0));
        // Every session for this person is gone, this browser's included.
        sendJson(response, 200, sessionPayload(ctx, ctx.zone === "home" ? users.owner() : null, false));
      },
    },
    {
      method: "PUT", path: "/api/me", access: "person",
      handler: async ({ request, response, ctx }) => sendJson(response, 200, { user: await users.updateSelf(me(ctx), await readJson(request, 16_000)) }),
    },
    {
      method: "POST", path: "/api/me/password", access: "person",
      handler: async ({ request, response, ctx }) => {
        const body = await readJson(request, 16_000);
        const user = await users.changePassword(me(ctx), {
          current: body.currentPassword, next: body.newPassword, keepToken: ctx.token, address: ctx.address,
          requireCurrent: ctx.signedIn || ctx.zone !== "home",
        });
        sendJson(response, 200, { user });
      },
    },
    { method: "GET", path: "/api/profile", access: "person", handler: ({ response, ctx }) => sendJson(response, 200, { profile: store.getProfile(me(ctx)) }) },
    {
      method: "PUT", path: "/api/profile", access: "person",
      handler: async ({ request, response, ctx }) => sendJson(response, 200, { profile: await store.updateProfile(me(ctx), await readJson(request)) }),
    },
    {
      method: "GET", path: "/api/recipes", access: "person",
      handler: ({ response, url }) => sendJson(response, 200, {
        recipes: store.list({
          search: url.searchParams.get("search") || "",
          category: url.searchParams.get("category") || "",
          tag: url.searchParams.get("tag") || "",
        }),
      }),
    },
    {
      method: "POST", path: "/api/recipes", access: "editor",
      handler: async ({ request, response }) => sendJson(response, 201, { recipe: await store.add(await readJson(request)) }),
    },
    {
      method: "GET", path: "/api/recipes/import", access: "editor",
      handler: async ({ response, url, ctx }) => sendJson(response, 200, await importRecipeFromUrl(url.searchParams.get("url"), { guard: ctx.zone === "public" })),
    },
    {
      method: "GET", path: /^\/api\/recipes\/([^/]+)$/, access: "person",
      handler: ({ response, params }) => {
        const recipe = store.get(decodeId(params[0]));
        return recipe ? sendJson(response, 200, { recipe }) : sendJson(response, 404, { error: "Recipe not found." });
      },
    },
    {
      method: "PUT", path: /^\/api\/recipes\/([^/]+)$/, access: "editor",
      handler: async ({ request, response, params }) => {
        const recipe = await store.update(decodeId(params[0]), await readJson(request));
        return recipe ? sendJson(response, 200, { recipe }) : sendJson(response, 404, { error: "Recipe not found." });
      },
    },
    {
      method: "DELETE", path: /^\/api\/recipes\/([^/]+)$/, access: "editor",
      handler: async ({ response, params }) => (await store.remove(decodeId(params[0])))
        ? sendJson(response, 200, { success: true }) : sendJson(response, 404, { error: "Recipe not found." }),
    },
    {
      method: "GET", path: "/api/history", access: "person",
      handler: ({ response, url, ctx }) => sendJson(response, 200, {
        history: store.listHistory({ userId: me(ctx), recipeId: url.searchParams.get("recipeId") || "", limit: url.searchParams.get("limit") || 200 }),
      }),
    },
    {
      method: "POST", path: "/api/history", access: "person",
      handler: async ({ request, response, ctx }) => sendJson(response, 201, { entry: await store.logMade(await readJson(request), me(ctx)) }),
    },
    {
      method: "DELETE", path: /^\/api\/history\/([^/]+)$/, access: "person",
      handler: async ({ response, params, ctx }) => (await store.removeHistory(decodeId(params[0]), me(ctx)))
        ? sendJson(response, 200, { success: true }) : sendJson(response, 404, { error: "Journal entry not found." }),
    },
    {
      method: "GET", path: "/api/inventory", access: "person",
      handler: ({ response, url, ctx }) => sendJson(response, 200, {
        inventory: store.listInventory({
          userId: me(ctx),
          search: url.searchParams.get("search") || "",
          location: url.searchParams.get("location") || "",
          low: url.searchParams.get("low") === "true",
        }),
      }),
    },
    {
      method: "POST", path: "/api/inventory", access: "person",
      handler: async ({ request, response, ctx }) => sendJson(response, 201, await store.addInventory(await readJson(request), me(ctx))),
    },
    {
      method: "GET", path: /^\/api\/inventory\/([^/]+)$/, access: "person",
      handler: ({ response, params, ctx }) => {
        const item = store.getInventory(decodeId(params[0]), me(ctx));
        return item ? sendJson(response, 200, { item }) : sendJson(response, 404, { error: "Kitchen Stock item not found." });
      },
    },
    {
      method: "PUT", path: /^\/api\/inventory\/([^/]+)$/, access: "person",
      handler: async ({ request, response, params, ctx }) => {
        const item = await store.updateInventory(decodeId(params[0]), await readJson(request), me(ctx));
        return item ? sendJson(response, 200, { item }) : sendJson(response, 404, { error: "Kitchen Stock item not found." });
      },
    },
    {
      method: "DELETE", path: /^\/api\/inventory\/([^/]+)$/, access: "person",
      handler: async ({ response, params, ctx }) => (await store.removeInventory(decodeId(params[0]), me(ctx)))
        ? sendJson(response, 200, { success: true }) : sendJson(response, 404, { error: "Kitchen Stock item not found." }),
    },
    {
      method: "POST", path: /^\/api\/inventory\/([^/]+)\/adjust$/, access: "person",
      handler: async ({ request, response, params, ctx }) => {
        const body = await readJson(request);
        const item = await store.adjustInventory(decodeId(params[0]), body.delta, me(ctx));
        return item ? sendJson(response, 200, { item }) : sendJson(response, 404, { error: "Kitchen Stock item not found." });
      },
    },
    {
      method: "GET", path: /^\/api\/products\/([^/]+)$/, access: "person",
      handler: async ({ response, params }) => sendJson(response, 200, await lookupProduct(decodeId(params[0]))),
    },
    {
      method: "GET", path: "/api/backup", access: "admin",
      handler: ({ response }) => sendJson(response, 200, { ...store.backup(), people: users.list() }, {
        "content-disposition": `attachment; filename="recipe-box-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      }),
    },
    { method: "GET", path: "/api/users", access: "admin", handler: ({ response }) => sendJson(response, 200, { users: users.list() }) },
    {
      method: "POST", path: "/api/users", access: "admin",
      handler: async ({ request, response }) => sendJson(response, 201, { user: await users.create(await readJson(request, 16_000)) }),
    },
    {
      method: "PUT", path: /^\/api\/users\/([^/]+)$/, access: "admin",
      handler: async ({ request, response, params, ctx }) => {
        const user = await users.update(decodeId(params[0]), await readJson(request, 16_000), { actorId: me(ctx) });
        return user ? sendJson(response, 200, { user }) : sendJson(response, 404, { error: "Person not found." });
      },
    },
    {
      method: "DELETE", path: /^\/api\/users\/([^/]+)$/, access: "admin",
      handler: async ({ response, params, ctx }) => {
        const id = decodeId(params[0]);
        if (!(await users.remove(id, { actorId: me(ctx) }))) return sendJson(response, 404, { error: "Person not found." });
        await store.removePersonData(id);
        return sendJson(response, 200, { success: true });
      },
    },
    {
      method: "GET", path: "/mcp", access: "home",
      handler: ({ response }) => sendJson(response, 405, { error: "This MCP server uses Streamable HTTP POST requests." }, { allow: "POST" }),
    },
    {
      method: "POST", path: "/mcp", access: "home",
      handler: async ({ request, response }) => {
        const result = await handleMcpMessage(store, await readJson(request), { userId: users.owner().id });
        if (result.body === null) {
          response.writeHead(result.status, { "cache-control": "no-store" });
          return response.end();
        }
        return sendJson(response, result.status, result.body, { "mcp-protocol-version": "2025-06-18" });
      },
    },
  ];
}

function matchRoute(routes, method, pathname) {
  const allowed = [];
  for (const route of routes) {
    const params = typeof route.path === "string"
      ? (route.path === pathname ? [] : null)
      : route.path.exec(pathname)?.slice(1) || null;
    if (!params) continue;
    if (route.method === method) return { route, params };
    allowed.push(route.method);
  }
  return allowed.length ? { allowed } : null;
}

export async function createApp(options = {}) {
  const clientIpHeader = clientIpHeaderSetting(options.clientIpHeader ?? process.env.CLIENT_IP_HEADER);
  const dataFile = options.dataFile || process.env.DATA_FILE || defaultDataFile;
  const trustedHosts = (options.trustedHosts ?? String(process.env.TRUSTED_HOSTS || "").split(","))
    .map((host) => hostName(host)).filter(Boolean);
  const store = options.store || await new RecipeStore({ dataFile, seedFile }).init();
  const users = options.users || await new UserStore({ dir: path.dirname(dataFile) }).init();
  await store.assignUnowned(users.owner().id);
  const routes = buildRoutes({ store, users });

  // A session cookie that no longer works (signed out elsewhere, turned off, expired) is not
  // quietly replaced by the Owner on the home network: the page gets a 401, learns the
  // session ended and asks again, so one person's screen never fills with another's data.
  const authenticate = (request, zone) => {
    const address = clientAddress(request, zone, clientIpHeader);
    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE] || null;
    const resolved = users.resolve(token);
    if (resolved) return { zone, address, token, user: resolved.user, signedIn: true, stale: false };
    const stale = Boolean(token);
    return { zone, address, token, user: zone === "home" && !stale ? users.owner() : null, signedIn: false, stale };
  };

  const authorize = (access, ctx) => {
    if (access === "open") return;
    if (access === "home") {
      if (ctx.zone !== "home") throw httpError(404, "Not found.");
      return;
    }
    if (!ctx.user) throw httpError(401, "Sign in to continue.");
    if ((ROLE_RANK[ctx.user.role] || 0) < ACCESS_RANK[access]) throw httpError(403, "Your account cannot do that.");
  };

  const handle = async (request, response, listenerZone) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("permissions-policy", "camera=(self), microphone=(), geolocation=()");
    response.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

    try {
      const url = new URL(request.url || "/", "http://recipe-box.invalid");
      const { pathname } = url;
      if (listenerZone === "home" && !isHomeHost(request.headers.host, trustedHosts)) {
        return sendJson(response, 421, { error: "This address is not on Recipe Box's home network list. Use the sign-in address, or add this name to TRUSTED_HOSTS." });
      }
      if (pathname.startsWith("/api/") || pathname === "/mcp") {
        const match = matchRoute(routes, request.method, pathname);
        if (!match) return sendJson(response, 404, { error: "Not found." });
        if (match.allowed) return sendJson(response, 405, { error: "Method not allowed." }, { allow: [...new Set(match.allowed)].join(", ") });
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
        const ctx = authenticate(request, requestZone(request, listenerZone));
        authorize(match.route.access, ctx);
        return await match.route.handler({ request, response, url, params: match.params, ctx });
      }
      if ((request.method === "GET" || request.method === "HEAD") && await serveStatic(request, response, pathname)) return;
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error(error);
      const headers = error.retryAfterMinutes ? { "retry-after": String(error.retryAfterMinutes * 60) } : {};
      // A reason written for people (an error with a status, such as a failed import) is passed
      // on; anything unexpected stays generic so server details never reach the page.
      const message = error.status ? error.message : "Unexpected server error.";
      if (!response.headersSent) sendJson(response, status, { error: message }, headers);
      else response.end();
    }
  };

  const server = createServer((request, response) => handle(request, response, "home"));
  const publicServer = createServer((request, response) => handle(request, response, "public"));
  return { server, publicServer, store, users, routes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const publicPort = Number(process.env.PUBLIC_PORT) || 0;
  const host = process.env.HOST || "0.0.0.0";
  const { server, publicServer } = await createApp();
  server.listen(port, host, () => console.log(`Recipe Box (home network) listening on http://${host}:${port}`));
  if (publicPort) publicServer.listen(publicPort, host, () => console.log(`Recipe Box (sign-in required) listening on http://${host}:${publicPort}`));
}
