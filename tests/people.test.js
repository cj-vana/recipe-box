import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server.js";

let app;
let home;
let outside;
let tempDir;
const passwords = { sam: "basil-onion-maple-41", erin: "thyme-pecan-lemon-77" };

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(base, pathname, { method = "GET", body, cookie, headers = {} } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json, headers: response.headers };
}

async function signIn(username, password, extraHeaders = {}) {
  const result = await call(outside, "/api/session", { method: "POST", body: { username, password }, headers: extraHeaders });
  const setCookie = result.headers.get("set-cookie") || "";
  return { ...result, cookie: setCookie.split(";")[0] };
}

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "recipe-box-people-"));
  // Data saved before people existed: no owner on the journal entry or the stock item.
  await writeFile(path.join(tempDir, "history.json"), JSON.stringify([
    { id: "legacy-entry", recipeId: "garlic-butter-filet", recipeTitle: "Garlic-Butter Filet", madeAt: "2026-08-20", rating: 5, notes: "Old note", createdAt: "2026-08-20T20:00:00.000Z" },
  ]));
  await writeFile(path.join(tempDir, "inventory.json"), JSON.stringify([
    { id: "legacy-stock", barcode: "012345678905", name: "Whole Milk", quantity: 2, unit: "carton", location: "Fridge", lowAt: 1, createdAt: "2026-08-20T20:00:00.000Z", updatedAt: "2026-08-20T20:00:00.000Z" },
  ]));
  app = await createApp({ dataFile: path.join(tempDir, "recipes.json") });
  home = await listen(app.server);
  outside = await listen(app.publicServer);
  for (const [username, role] of [["sam", "member"], ["erin", "editor"]]) {
    const created = await call(home, "/api/users", { method: "POST", body: { displayName: username === "sam" ? "Sam" : "Erin", username, role, password: passwords[username] } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
  }
});

after(async () => {
  await Promise.all([app.server, app.publicServer].map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(tempDir, { recursive: true, force: true });
});

test("the home port acts as the Owner without signing in", async () => {
  const session = await call(home, "/api/session");
  assert.equal(session.json.zone, "home");
  assert.equal(session.json.signedIn, false);
  assert.equal(session.json.user.owner, true);
  assert.equal(session.json.user.role, "admin");
  assert.equal(session.json.user.hasPassword, false);
});

test("journal entries and stock saved before profiles belong to the Owner", async () => {
  const history = await call(home, "/api/history");
  assert.deepEqual(history.json.history.map((entry) => entry.id), ["legacy-entry"]);
  const stock = await call(home, "/api/inventory");
  assert.deepEqual(stock.json.inventory.map((item) => item.name), ["Whole Milk"]);
  const owner = app.users.owner();
  const saved = JSON.parse(await readFile(path.join(tempDir, "history.json"), "utf8"));
  assert.equal(saved[0].userId, owner.id);
});

test("the outside port asks for a sign-in and hides home-only routes", async () => {
  const session = await call(outside, "/api/session");
  assert.deepEqual({ user: session.json.user, zone: session.json.zone }, { user: null, zone: "public" });
  assert.equal((await call(outside, "/api/recipes")).status, 401);
  assert.deepEqual((await call(outside, "/api/health")).json, { status: "ok" });
  assert.equal((await call(outside, "/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "ping" } })).status, 404);
  assert.equal((await call(outside, "/api/backup")).status, 401);
  const page = await fetch(`${outside}/`);
  assert.equal(page.status, 200);
});

test("Cloudflare headers on the home port get the outside rules", async () => {
  for (const header of ["cf-ray", "cf-connecting-ip", "cdn-loop"]) {
    const result = await call(home, "/api/recipes", { headers: { [header]: header === "cf-connecting-ip" ? "203.0.113.9" : "cloudflare" } });
    assert.equal(result.status, 401, header);
  }
  const mcp = await call(home, "/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "ping" }, headers: { "cf-ray": "abc" } });
  assert.equal(mcp.status, 404);
});

test("a session that ended on the home network gets a 401, then the Owner after a fresh look", async () => {
  const { cookie } = await signIn("erin", passwords.erin);
  const asErin = await call(home, "/api/session", { cookie });
  assert.equal(asErin.json.user.username, "erin");
  await call(home, "/api/session", { method: "DELETE", cookie });
  const stale = await call(home, "/api/history", { cookie });
  assert.equal(stale.status, 401, "the old cookie must not quietly become the Owner");
  const fresh = await call(home, "/api/session", { cookie });
  assert.equal(fresh.json.user.owner, true);
  assert.match(fresh.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call(home, "/api/history")).status, 200);
});

// fetch() will not send a custom Host header, so these use node:http directly.
function withHost(base, pathname, host, { method = "GET", body } = {}) {
  const target = new URL(pathname, base);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: target.hostname, port: target.port, path: target.pathname, method, headers: { host, ...(body ? { "content-type": "application/json" } : {}) } }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, text }));
    });
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}

test("the home port only answers addresses on the home network, so a rebound domain cannot act as the Owner", async () => {
  for (const host of ["evil.example.com", "evil.example.com:13002", "recipes.example.org"]) {
    const page = await withHost(home, "/", host);
    assert.equal(page.status, 421, host);
    const create = await withHost(home, "/api/users", host, { method: "POST", body: { displayName: "Intruder", username: "intruder", role: "admin", password: "intruder-password-1" } });
    assert.equal(create.status, 421, host);
  }
  assert.equal(app.users.findByUsername("intruder"), null);
  for (const host of ["192.168.1.20:13002", "127.0.0.1:13002", "localhost", "[::1]:13002", "kitchen-pc", "kitchen.local", "server.lan", "box.home.arpa", "recipes.example-tailnet.ts.net:13002"]) {
    assert.equal((await withHost(home, "/api/session", host)).status, 200, host);
  }
});

test("the outside port takes the visitor address from the proxy, and one username cannot be guessed from many addresses", async () => {
  app.users.limiter.clear();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await signIn("erin", `wrong-${attempt}-password`, { "cf-connecting-ip": `203.0.113.${attempt + 1}` });
    assert.equal(result.status, 401, `attempt ${attempt}`);
  }
  const fromNewAddress = await signIn("erin", passwords.erin, { "cf-connecting-ip": "203.0.113.200" });
  assert.equal(fromNewAddress.status, 429, "twenty failures for one username from any addresses pause that username");
  app.users.limiter.trusted.clear();
  const atHome = await call(home, "/api/session", { method: "POST", body: { username: "erin", password: passwords.erin } });
  assert.equal(atHome.status, 200, "the real person can still sign in on the home network");
  app.users.limiter.clear();
  assert.equal((await signIn("erin", passwords.erin, { "cf-connecting-ip": "203.0.113.200" })).status, 200);
});

test("a name with no account pauses exactly like a real one, so the pause does not reveal who has an account", async () => {
  app.users.limiter.clear();
  for (const username of ["erin", "nobody-real"]) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = await signIn(username, `wrong-${attempt}-password`, { "cf-connecting-ip": `203.0.113.${attempt + 1}` });
      assert.equal(result.status, 401, `${username} attempt ${attempt}`);
    }
  }
  const real = await signIn("erin", "wrong-again-password", { "cf-connecting-ip": "203.0.113.201" });
  const fake = await signIn("nobody-real", "wrong-again-password", { "cf-connecting-ip": "203.0.113.202" });
  assert.equal(real.status, 429);
  assert.equal(fake.status, 429, "the name with no account is paused too");
  assert.equal(fake.json.error.replace(/\d+/g, "N"), real.json.error.replace(/\d+/g, "N"));
  assert.ok(Number(fake.headers.get("retry-after")) > 0);
  app.users.limiter.clear();
});

test("wrong current passwords count across addresses when changing a password", async () => {
  app.users.limiter.clear();
  const created = await call(home, "/api/users", { method: "POST", body: { displayName: "Pat", username: "pat", role: "member", password: "basil-onion-pat-55" } });
  assert.equal(created.status, 201);
  const { cookie } = await signIn("pat", "basil-onion-pat-55", { "cf-connecting-ip": "198.51.100.60" });
  const change = (currentPassword, address) => call(outside, "/api/me/password", {
    method: "POST", cookie, body: { currentPassword, newPassword: "a-brand-new-password-1" }, headers: { "cf-connecting-ip": address },
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal((await change(`wrong-${attempt}-password`, `203.0.113.${attempt + 1}`)).status, 403, `attempt ${attempt}`);
  }
  const fromNewAddress = await change("basil-onion-pat-55", "203.0.113.230");
  assert.equal(fromNewAddress.status, 429, "twenty wrong current passwords from any addresses pause password changes");
  const fromOwnAddress = await change("basil-onion-pat-55", "198.51.100.60");
  assert.equal(fromOwnAddress.status, 200, "the address Pat signed in from can still change the password");
  await call(home, `/api/users/${created.json.user.id}`, { method: "DELETE" });
  app.users.limiter.clear();
});

test("sign-in names no account can have never reach another counter, but still count against the address", async () => {
  app.users.limiter.clear();
  const created = await call(home, "/api/users", { method: "POST", body: { displayName: "Kim", username: "kim", role: "member", password: "basil-onion-kim-66" } });
  assert.equal(created.status, 201);
  const { cookie } = await signIn("kim", "basil-onion-kim-66", { "cf-connecting-ip": "198.51.100.62" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await signIn(`password:${created.json.user.id}`, `wrong-${attempt}-password`, { "cf-connecting-ip": `203.0.113.${attempt + 1}` });
    assert.equal(result.status, 401, `attempt ${attempt}`);
  }
  const change = await call(outside, "/api/me/password", {
    method: "POST", cookie, body: { currentPassword: "basil-onion-kim-66", newPassword: "a-brand-new-password-2" }, headers: { "cf-connecting-ip": "203.0.113.231" },
  });
  assert.equal(change.status, 200, "sign-in attempts cannot pause Kim's password change");
  await call(home, `/api/users/${created.json.user.id}`, { method: "DELETE" });
  const visitor = { "cf-connecting-ip": "198.51.100.77" };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal((await signIn("not a name!", "wrong-password-x", visitor)).status, 401, `attempt ${attempt}`);
  }
  assert.equal((await signIn("not a name!", "wrong-password-x", visitor)).status, 429, "names no account can have still count against the address");
  app.users.limiter.clear();
});

test("a burst of sign-ins from one address cannot slip past the limit while passwords are checked", async () => {
  app.users.limiter.clear();
  const visitor = { "cf-connecting-ip": "198.51.100.90" };
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => signIn("erin", `burst-${index}-password`, visitor)));
  const statuses = results.map((result) => result.status);
  assert.equal(statuses.filter((status) => status === 401).length, 5, statuses.join(","));
  assert.equal(statuses.filter((status) => status === 429).length, 25);
  app.users.limiter.clear();
});

test("only the Owner can change the Owner's account", async () => {
  const owner = app.users.owner();
  const admin = await call(home, "/api/users", { method: "POST", body: { displayName: "Second Admin", username: "admin2", role: "admin", password: "basil-onion-admin-77" } });
  assert.equal(admin.status, 201);
  const { cookie } = await signIn("admin2", "basil-onion-admin-77");
  for (const body of [{ password: "takeover-password-1" }, { username: "taken-over" }, { displayName: "Not the owner" }]) {
    const result = await call(outside, `/api/users/${owner.id}`, { method: "PUT", cookie, body });
    assert.equal(result.status, 403, JSON.stringify(body));
  }
  assert.equal(app.users.owner().username, owner.username);
  assert.equal((await call(outside, "/api/users", { cookie })).status, 200, "the second admin still manages other people");
  await call(home, `/api/users/${admin.json.user.id}`, { method: "DELETE" });
});

test("the passwordless Owner cannot sign in from outside", async () => {
  const result = await signIn("owner", "anything-long-enough");
  assert.equal(result.status, 401);
  assert.equal(result.cookie, "");
});

test("people the admin adds can sign in from outside and stay signed in", async () => {
  const result = await signIn("Sam", passwords.sam);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Max-Age=2592000/);
  assert.equal(result.json.user.username, "sam");
  const session = await call(outside, "/api/session", { cookie: result.cookie });
  assert.equal(session.json.user.displayName, "Sam");
  assert.equal(session.json.signedIn, true);
  const recipes = await call(outside, "/api/recipes", { cookie: result.cookie });
  assert.equal(recipes.status, 200);
  assert.ok(recipes.json.recipes.length >= 13);
  const secure = await signIn("sam", passwords.sam, { "x-forwarded-proto": "https" });
  assert.match(secure.headers.get("set-cookie"), /; Secure$/);
});

test("wrong passwords get one message and too many make the visitor wait", async () => {
  const wrong = await signIn("erin", "not-the-password");
  assert.equal(wrong.status, 401);
  const unknown = await signIn("nobody-here", "not-the-password");
  assert.equal(unknown.status, 401);
  assert.equal(unknown.json.error, wrong.json.error);
  const visitor = { "cf-connecting-ip": "198.51.100.23" };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await signIn("erin", "still-not-right", visitor)).status, 401);
  }
  const blocked = await signIn("erin", passwords.erin, visitor);
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /Too many attempts\. Try again in \d+ minutes?\./);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  const otherVisitor = await signIn("erin", passwords.erin, { "cf-connecting-ip": "198.51.100.24" });
  assert.equal(otherVisitor.status, 200);
});

test("every protected route refuses a signed-out visitor on the outside port", async () => {
  const concrete = (route) => typeof route.path === "string" ? route.path
    : route.path.source.replace(/^\^|\$$/g, "").replaceAll("\\/", "/").replaceAll("([^/]+)", "x");
  const checked = [];
  for (const route of app.routes) {
    if (route.access === "open") continue;
    const body = ["POST", "PUT"].includes(route.method) ? {} : undefined;
    const result = await call(outside, concrete(route), { method: route.method, body });
    assert.equal(result.status, route.access === "home" ? 404 : 401, `${route.method} ${concrete(route)}`);
    checked.push(`${route.method} ${concrete(route)}`);
  }
  assert.ok(checked.length >= 25, checked.join("\n"));
  const openRoutes = app.routes.filter((route) => route.access === "open").map((route) => `${route.method} ${route.path}`);
  assert.deepEqual(openRoutes, ["GET /api/health", "GET /api/session", "POST /api/session", "DELETE /api/session"]);
});

test("members use the library and their own data but cannot change recipes or people", async () => {
  const { cookie } = await signIn("sam", passwords.sam);
  const editorOrAdmin = app.routes.filter((route) => route.access === "editor" || route.access === "admin");
  for (const route of editorOrAdmin) {
    const target = typeof route.path === "string" ? route.path
      : route.path.source.replace(/^\^|\$$/g, "").replaceAll("\\/", "/").replaceAll("([^/]+)", "x");
    const result = await call(outside, target, { method: route.method, cookie, body: ["POST", "PUT"].includes(route.method) ? {} : undefined });
    assert.equal(result.status, 403, `${route.method} ${target}`);
  }
  const recipe = { title: "Sam's Soup", ingredients: [{ amount: "1 cup", item: "broth" }], steps: ["Warm it."] };
  assert.equal((await call(outside, "/api/recipes", { method: "POST", cookie, body: recipe })).status, 403);
  const erin = await signIn("erin", passwords.erin);
  const added = await call(outside, "/api/recipes", { method: "POST", cookie: erin.cookie, body: { ...recipe, title: "Erin's Soup" } });
  assert.equal(added.status, 201);
  const edited = await call(outside, `/api/recipes/${added.json.recipe.id}`, { method: "PUT", cookie: erin.cookie, body: { summary: "Warm and quick." } });
  assert.equal(edited.json.recipe.summary, "Warm and quick.");
  assert.equal((await call(outside, `/api/recipes/${added.json.recipe.id}`, { method: "DELETE", cookie: erin.cookie })).status, 200);
  assert.equal((await call(outside, "/api/users", { cookie: erin.cookie })).status, 403);
});

test("each person keeps their own Kitchen Stock, journal and lists", async () => {
  const { cookie } = await signIn("sam", passwords.sam);
  const milk = await call(outside, "/api/inventory", { method: "POST", cookie, body: { barcode: "012345678905", name: "Oat Milk", quantity: 1, location: "Fridge" } });
  assert.equal(milk.status, 201);
  assert.equal(milk.json.merged, false, "the Owner's matching barcode is not Sam's item");
  const samStock = await call(outside, "/api/inventory", { cookie });
  assert.deepEqual(samStock.json.inventory.map((item) => item.name), ["Oat Milk"]);
  const ownerStock = await call(home, "/api/inventory");
  assert.deepEqual(ownerStock.json.inventory.map((item) => item.name), ["Whole Milk"]);

  const samItem = milk.json.item.id;
  assert.equal((await call(home, `/api/inventory/${samItem}`)).status, 404);
  assert.equal((await call(home, `/api/inventory/${samItem}`, { method: "PUT", body: { name: "Taken" } })).status, 404);
  assert.equal((await call(home, `/api/inventory/${samItem}/adjust`, { method: "POST", body: { delta: -1 } })).status, 404);
  assert.equal((await call(home, `/api/inventory/${samItem}`, { method: "DELETE" })).status, 404);
  assert.equal((await call(outside, "/api/inventory/legacy-stock", { cookie })).status, 404);
  const ownerMilk = await call(home, "/api/inventory/012345678905/adjust", { method: "POST", body: { delta: -1 } });
  assert.equal(ownerMilk.json.item.name, "Whole Milk");
  assert.equal(ownerMilk.json.item.quantity, 1);

  const entry = await call(outside, "/api/history", { method: "POST", cookie, body: { recipeId: "loaded-taco-bowls", madeAt: "2026-11-10", rating: 4, notes: "Good." } });
  assert.equal(entry.status, 201);
  assert.deepEqual((await call(outside, "/api/history", { cookie })).json.history.map((item) => item.id), [entry.json.entry.id]);
  assert.equal((await call(home, "/api/history")).json.history.some((item) => item.id === entry.json.entry.id), false);
  assert.equal((await call(home, `/api/history/${entry.json.entry.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await call(outside, "/api/history/legacy-entry", { method: "DELETE", cookie })).status, 404);

  const saved = await call(outside, "/api/profile", { method: "PUT", cookie, body: { favorites: ["loaded-taco-bowls", "loaded-taco-bowls"], planner: { "2026-11-18": "loaded-taco-bowls", "2026-11-19": { breakfast: "overnight-oats", lunch: "", snack: "chips" }, "not-a-date": "x" }, shopping: [{ id: "a", text: "Limes", checked: false }] } });
  assert.deepEqual(saved.json.profile, { favorites: ["loaded-taco-bowls"], planner: { "2026-11-18": { dinner: "loaded-taco-bowls" }, "2026-11-19": { breakfast: "overnight-oats" } }, shopping: [{ id: "a", text: "Limes", checked: false, source: "" }] });
  const partial = await call(outside, "/api/profile", { method: "PUT", cookie, body: { favorites: [] } });
  assert.equal(partial.json.profile.shopping.length, 1, "only the lists sent are replaced");
  assert.deepEqual((await call(home, "/api/profile")).json.profile, { favorites: [], planner: {}, shopping: [] });
});

test("MCP on the home port reads and writes the Owner's data", async () => {
  const rpc = (body) => call(home, "/mcp", { method: "POST", body, headers: { accept: "application/json, text/event-stream" } });
  const history = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_cooking_history", arguments: {} } });
  assert.deepEqual(JSON.parse(history.json.result.content[0].text).map((entry) => entry.id), ["legacy-entry"]);
  const stock = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_kitchen_stock", arguments: {} } });
  assert.deepEqual(JSON.parse(stock.json.result.content[0].text).map((item) => item.name), ["Whole Milk"]);
});

test("requests from other sites cannot change data", async () => {
  const recipe = { title: "Cross Site", ingredients: [{ amount: "", item: "x" }], steps: ["y"] };
  const crossSite = await call(home, "/api/recipes", { method: "POST", body: recipe, headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.status, 403);
  const sameSite = await call(home, "/api/recipes", { method: "POST", body: recipe, headers: { "sec-fetch-site": "same-site" } });
  assert.equal(sameSite.status, 403);
  const formPost = await fetch(`${home}/api/recipes`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(recipe) });
  assert.equal(formPost.status, 415);
  const sameOrigin = await call(home, "/api/recipes", { method: "POST", body: { ...recipe, title: "Same Origin Soup" }, headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(sameOrigin.status, 201);
  await call(home, `/api/recipes/${sameOrigin.json.recipe.id}`, { method: "DELETE" });
});

test("password changes, turning someone off and signing out end sessions", async () => {
  const first = await signIn("sam", passwords.sam);
  const second = await signIn("sam", passwords.sam);
  const wrong = await call(outside, "/api/me/password", { method: "POST", cookie: first.cookie, body: { currentPassword: "nope-nope-nope", newPassword: "chive-garlic-onion-12" } });
  assert.equal(wrong.status, 403);
  const changed = await call(outside, "/api/me/password", { method: "POST", cookie: first.cookie, body: { currentPassword: passwords.sam, newPassword: "chive-garlic-onion-12" } });
  assert.equal(changed.status, 200);
  assert.equal((await call(outside, "/api/session", { cookie: first.cookie })).json.signedIn, true, "the browser that changed it stays signed in");
  assert.equal((await call(outside, "/api/session", { cookie: second.cookie })).json.user, null, "other sessions end");
  passwords.sam = "chive-garlic-onion-12";

  const sam = app.users.findByUsername("sam");
  const off = await call(home, `/api/users/${sam.id}`, { method: "PUT", body: { disabled: true } });
  assert.equal(off.json.user.disabled, true);
  assert.equal((await call(outside, "/api/session", { cookie: first.cookie })).json.user, null);
  const refused = await signIn("sam", passwords.sam);
  assert.equal(refused.status, 403);
  assert.match(refused.json.error, /turned off/);
  await call(home, `/api/users/${sam.id}`, { method: "PUT", body: { disabled: false } });
  const back = await signIn("sam", passwords.sam);
  assert.equal(back.status, 200);

  const reset = await call(home, `/api/users/${sam.id}`, { method: "PUT", body: { password: "radish-carrot-beet-55" } });
  assert.equal(reset.status, 200);
  assert.equal((await call(outside, "/api/session", { cookie: back.cookie })).json.user, null, "an admin reset ends Sam's sessions");
  passwords.sam = "radish-carrot-beet-55";

  const again = await signIn("sam", passwords.sam);
  const out = await call(outside, "/api/session", { method: "DELETE", cookie: again.cookie });
  assert.equal(out.json.user, null);
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call(outside, "/api/recipes", { cookie: again.cookie })).status, 401);

  const a = await signIn("sam", passwords.sam);
  const b = await signIn("sam", passwords.sam);
  const everywhere = await call(outside, "/api/sessions", { method: "DELETE", cookie: a.cookie });
  assert.equal(everywhere.status, 200);
  assert.equal((await call(outside, "/api/recipes", { cookie: b.cookie })).status, 401);
});

test("a turned-off account's session stops working even if it was not ended", async () => {
  const { cookie } = await signIn("erin", passwords.erin);
  const erin = app.users.findByUsername("erin");
  erin.disabledAt = new Date().toISOString();
  try {
    assert.equal((await call(outside, "/api/recipes", { cookie })).status, 401);
  } finally {
    erin.disabledAt = null;
  }
  assert.equal((await call(outside, "/api/recipes", { cookie })).status, 200);
});

test("the Owner can set a password from home and then sign in from outside", async () => {
  const short = await call(home, "/api/me/password", { method: "POST", body: { newPassword: "short" } });
  assert.equal(short.status, 400);
  const set = await call(home, "/api/me/password", { method: "POST", body: { newPassword: "saffron-fennel-dill-90" } });
  assert.equal(set.status, 200);
  assert.equal(set.json.user.hasPassword, true);
  const renamed = await call(home, "/api/me", { method: "PUT", body: { displayName: "Home Cook", username: "homecook" } });
  assert.equal(renamed.json.user.username, "homecook");
  const outsideSignIn = await signIn("homecook", "saffron-fennel-dill-90");
  assert.equal(outsideSignIn.status, 200);
  assert.equal(outsideSignIn.json.user.owner, true);
  const outsideChange = await call(outside, "/api/me/password", { method: "POST", cookie: outsideSignIn.cookie, body: { newPassword: "no-current-given-1" } });
  assert.equal(outsideChange.status, 403, "outside, the current password is required");
});

test("admins cannot delete or demote the Owner or themselves, and usernames stay unique", async () => {
  const owner = app.users.owner();
  assert.equal((await call(home, `/api/users/${owner.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await call(home, `/api/users/${owner.id}`, { method: "PUT", body: { role: "member" } })).status, 409);
  assert.equal((await call(home, `/api/users/${owner.id}`, { method: "PUT", body: { disabled: true } })).status, 409);
  const taken = await call(home, "/api/users", { method: "POST", body: { displayName: "Sam Two", username: "sam", role: "member", password: "long-enough-pass" } });
  assert.equal(taken.status, 409);
  const badName = await call(home, "/api/users", { method: "POST", body: { displayName: "Bad", username: "no spaces!", role: "member", password: "long-enough-pass" } });
  assert.equal(badName.status, 400);
  const shortPassword = await call(home, "/api/users", { method: "POST", body: { displayName: "Short", username: "shorty", role: "member", password: "short" } });
  assert.equal(shortPassword.status, 400);
});

test("the backup and the people list never include passwords or sessions", async () => {
  const backup = await call(home, "/api/backup");
  const text = JSON.stringify(backup.json);
  assert.equal(text.includes("passwordHash"), false);
  assert.equal(text.includes("scrypt$"), false);
  assert.equal("sessions" in backup.json, false);
  assert.ok(backup.json.people.some((person) => person.username === "sam"));
  const list = await call(home, "/api/users");
  assert.equal(JSON.stringify(list.json).includes("scrypt$"), false);
});

test("deleting a person removes their data", async () => {
  const temp = await call(home, "/api/users", { method: "POST", body: { displayName: "Temp", username: "temp-cook", role: "member", password: "parsley-mint-sage-31" } });
  const { cookie } = await signIn("temp-cook", "parsley-mint-sage-31");
  await call(outside, "/api/inventory", { method: "POST", cookie, body: { name: "Rice" } });
  await call(outside, "/api/history", { method: "POST", cookie, body: { recipeId: "baked-ziti-dinner" } });
  await call(outside, "/api/profile", { method: "PUT", cookie, body: { favorites: ["baked-ziti-dinner"] } });
  const id = temp.json.user.id;
  assert.equal((await call(home, `/api/users/${id}`, { method: "DELETE" })).status, 200);
  assert.equal(app.store.inventory.some((item) => item.ownerId === id), false);
  assert.equal(app.store.history.some((entry) => entry.userId === id), false);
  assert.equal(id in app.store.profiles, false);
  assert.equal((await call(outside, "/api/session", { cookie })).json.user, null);
});

test("importing a URL from outside refuses private addresses", async () => {
  const origin = createServer((request, response) => response.end("<html></html>"));
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  try {
    const { cookie } = await signIn("erin", passwords.erin);
    for (const target of [`http://127.0.0.1:${origin.address().port}/`, `http://localhost:${origin.address().port}/`, "http://192.168.1.20:13002/", "http://[::1]/"]) {
      const result = await call(outside, `/api/recipes/import?url=${encodeURIComponent(target)}`, { cookie });
      assert.equal(result.status, 400, target);
      assert.match(result.json.error, /private network/, target);
    }
  } finally {
    await new Promise((resolve) => origin.close(resolve));
  }
});

test("input the store refuses gets its own message as a 400, not a server error", async () => {
  const broth = [{ amount: "1 cup", item: "broth" }];
  const cases = [
    ["/api/recipes", { title: "   ", ingredients: broth, steps: ["Warm it."] }, "A recipe title is required."],
    ["/api/recipes", { title: "Blank Soup", ingredients: [{ amount: " ", item: "  " }], steps: ["Warm it."] }, "Add at least one ingredient."],
    ["/api/recipes", { title: "Blank Soup", ingredients: broth, steps: ["  "] }, "Add at least one instruction."],
    ["/api/history", { recipeId: "loaded-taco-bowls", madeAt: "17/11/2026" }, "Made date must use YYYY-MM-DD."],
    ["/api/inventory", { name: "   ", quantity: 1 }, "An item name is required."],
  ];
  for (const [pathname, body, message] of cases) {
    const result = await call(home, pathname, { method: "POST", body });
    assert.equal(result.status, 400, `${pathname} ${JSON.stringify(body)}`);
    assert.equal(result.json.error, message);
  }
});
