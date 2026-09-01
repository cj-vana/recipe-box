import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../server.js";

let server;
let baseUrl;
let tempDir;
const jsonHeaders = { "content-type": "application/json" };

before(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "recipe-box-test-"));
  ({ server } = await createApp({ dataFile: path.join(tempDir, "recipes.json") }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
});

test("serves the Recipe Box PWA shell and health endpoint", async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Recipe Box/);
  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifest.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.deepEqual({ status: health.status, recipes: health.recipes, version: health.version }, { status: "ok", recipes: 13, version: "2.1.0" });
});

test("lists normal recipes with finished-dish images and filters them", async () => {
  const all = await fetch(`${baseUrl}/api/recipes`).then((response) => response.json());
  assert.equal(all.recipes.length, 13);
  assert.match(all.recipes[0].image, /^\/images\/dishes\//);
  assert.equal("freezerItem" in all.recipes[0], false);
  const seafood = await fetch(`${baseUrl}/api/recipes?category=Seafood`).then((response) => response.json());
  assert.deepEqual(seafood.recipes.map((recipe) => recipe.id), ["lemon-butter-scallops-risotto"]);
  const search = await fetch(`${baseUrl}/api/recipes?search=patty`).then((response) => response.json());
  assert.equal(search.recipes[0].id, "caramelized-onion-patty-melts");
});

test("serves a unique generated image for every seeded recipe", async () => {
  const { recipes } = await fetch(`${baseUrl}/api/recipes`).then((response) => response.json());
  assert.equal(new Set(recipes.map((recipe) => recipe.image)).size, 13);
  const responses = await Promise.all(recipes.map((recipe) => fetch(`${baseUrl}${recipe.image}`)));
  assert.equal(responses.every((response) => response.status === 200 && response.headers.get("content-type") === "image/webp"), true);
});

test("allows changes directly from the private network without a key", async () => {
  const recipe = { title: "Test Soup", ingredients: [{ amount: "1 cup", item: "broth" }], steps: ["Warm the broth."] };
  const allowed = await fetch(`${baseUrl}/api/recipes`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(recipe) });
  assert.equal(allowed.status, 201);
  assert.equal((await allowed.json()).recipe.title, "Test Soup");
});

test("records cooking history with ratings and notes", async () => {
  const logged = await fetch(`${baseUrl}/api/history`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ recipeId: "garlic-butter-filet", madeAt: "2026-08-16", rating: 5, notes: "Great crust." }),
  });
  assert.equal(logged.status, 201);
  const history = await fetch(`${baseUrl}/api/history?recipeId=garlic-butter-filet`).then((response) => response.json());
  assert.equal(history.history.length, 1);
  assert.equal(history.history[0].rating, 5);
  assert.equal(history.history[0].notes, "Great crust.");
});

test("tracks Kitchen Stock, merges matching barcodes, and records use", async () => {
  const item = { barcode: "012345678905", name: "Whole Milk", brand: "Test Dairy", quantity: 1, unit: "carton", location: "Fridge", lowAt: 1 };
  const first = await fetch(`${baseUrl}/api/inventory`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(item) }).then((response) => response.json());
  const second = await fetch(`${baseUrl}/api/inventory`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...item, quantity: 2 }),
  }).then((response) => response.json());
  assert.equal(second.merged, true);
  assert.equal(second.item.quantity, 3);
  const adjusted = await fetch(`${baseUrl}/api/inventory/${first.item.id}/adjust`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ delta: -1 }),
  }).then((response) => response.json());
  assert.equal(adjusted.item.quantity, 2);
  const stock = await fetch(`${baseUrl}/api/inventory?location=Fridge`).then((response) => response.json());
  assert.equal(stock.inventory[0].name, "Whole Milk");
});

test("implements the expanded MCP lifecycle and tools", async () => {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const rpc = (body) => fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  const initialize = await rpc({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  }).then((response) => response.json());
  assert.equal(initialize.result.serverInfo.name, "recipe-box");
  const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }).then((response) => response.json());
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    "list_recipes", "search_recipes", "get_recipe", "suggest_recipes", "add_recipe",
    "list_cooking_history", "record_recipe_made", "list_kitchen_stock", "add_kitchen_stock",
    "update_kitchen_stock", "remove_kitchen_stock",
  ]);
  const suggested = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "suggest_recipes", arguments: { limit: 2 } } }).then((response) => response.json());
  assert.equal(JSON.parse(suggested.result.content[0].text).length, 2);
  const updated = await rpc({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "update_kitchen_stock", arguments: { id_or_barcode: "012345678905", quantity_change: -1 } },
  }).then((response) => response.json());
  assert.match(updated.result.content[0].text, /Whole Milk/);
});

test("imports a recipe from a URL with JSON-LD", async () => {
  const origin = createServer((request, response) => {
    response.end(`<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: "Imported Stew",
      description: "Slow Sunday stew.",
      prepTime: "PT15M",
      cookTime: "PT2H",
      recipeYield: "4 servings",
      recipeIngredient: ["2 lb beef chuck", "3 carrots"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Brown the beef." }, "Simmer gently."],
    })}</script></head><body></body></html>`);
  });
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  try {
    const originUrl = `http://127.0.0.1:${origin.address().port}/stew`;
    const imported = await fetch(`${baseUrl}/api/recipes/import?url=${encodeURIComponent(originUrl)}`);
    assert.equal(imported.status, 200);
    const { recipe } = await imported.json();
    assert.equal(recipe.title, "Imported Stew");
    assert.equal(recipe.prepMinutes, 15);
    assert.equal(recipe.cookMinutes, 120);
    assert.equal(recipe.servings, 4);
    assert.deepEqual(recipe.ingredients, ["2 lb beef chuck", "3 carrots"]);
    assert.deepEqual(recipe.steps, ["Brown the beef.", "Simmer gently."]);
  } finally {
    await new Promise((resolve) => origin.close(resolve));
  }
});

test("rejects bad recipe import URLs", async () => {
  const missing = await fetch(`${baseUrl}/api/recipes/import`);
  assert.equal(missing.status, 400);
  const scheme = await fetch(`${baseUrl}/api/recipes/import?url=${encodeURIComponent("ftp://example.com/x")}`);
  assert.equal(scheme.status, 400);
});
