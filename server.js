import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecipeStore } from "./lib/store.js";
import { handleMcpMessage } from "./lib/mcp.js";
import { extractRecipeFromHtml } from "./lib/recipe-import.js";

const { version: APP_VERSION } = createRequire(import.meta.url)("./package.json");

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const seedFile = path.join(rootDir, "data", "seed-recipes.json");
const defaultDataFile = path.join(rootDir, "data", "runtime", "recipes.json");

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

function sendJson(response, status, value, extraHeaders = {}) {
  const body = value === null ? "" : JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

async function readJson(request, limit = 512_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

async function lookupProduct(barcode) {
  const code = String(barcode || "").replace(/\s/g, "");
  if (!/^[0-9]{6,18}$/.test(code)) {
    throw Object.assign(new Error("Enter a valid grocery barcode."), { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const fields = "code,product_name,product_name_en,brands,quantity,categories_tags";
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`, {
      headers: { "user-agent": "RecipeBox/2.0 (private personal cookbook)" },
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error("Product lookup is unavailable right now."), { status: 502 });
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
    if (error.name === "AbortError") throw Object.assign(new Error("Product lookup timed out. You can enter the name manually."), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function importRecipeFromUrl(rawUrl) {
  let target;
  try {
    target = new URL(String(rawUrl || ""));
  } catch {
    throw Object.assign(new Error("Enter a valid recipe URL."), { status: 400 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    throw Object.assign(new Error("Only http and https recipe URLs are supported."), { status: 400 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": `RecipeBox/${APP_VERSION} (self-hosted recipe library)`,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw Object.assign(new Error(`That page responded with ${response.status}.`), { status: 502 });
    const html = (await response.text()).slice(0, 2_000_000);
    const recipe = extractRecipeFromHtml(html, target.toString());
    if (!recipe) {
      throw Object.assign(new Error("No structured recipe found on that page. Paste the recipe text into Quick fill instead."), { status: 422 });
    }
    return { recipe };
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("Fetching that page timed out."), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(requested);
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

export async function createApp(options = {}) {
  const dataFile = options.dataFile || process.env.DATA_FILE || defaultDataFile;
  const store = options.store || await new RecipeStore({ dataFile, seedFile }).init();

  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("permissions-policy", "camera=(self), microphone=(), geolocation=()");
    response.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const { pathname } = url;

    try {
      if (pathname === "/api/health") {
        return sendJson(response, 200, {
          status: "ok",
          recipes: store.list().length,
          history: store.listHistory().length,
          inventory: store.listInventory().length,
          version: APP_VERSION,
        });
      }

      if (pathname === "/api/recipes" && request.method === "GET") {
        return sendJson(response, 200, {
          recipes: store.list({
            search: url.searchParams.get("search") || "",
            category: url.searchParams.get("category") || "",
            tag: url.searchParams.get("tag") || "",
          }),
        });
      }

      if (pathname === "/api/recipes" && request.method === "POST") {
        const recipe = await store.add(await readJson(request));
        return sendJson(response, 201, { recipe });
      }

      if (pathname === "/api/recipes/import" && request.method === "GET") {
        return sendJson(response, 200, await importRecipeFromUrl(url.searchParams.get("url")));
      }

      const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
      if (recipeMatch && request.method === "GET") {
        const recipe = store.get(decodeURIComponent(recipeMatch[1]));
        return recipe ? sendJson(response, 200, { recipe }) : sendError(response, 404, "Recipe not found.");
      }

      if (recipeMatch && request.method === "PUT") {
        const recipe = await store.update(decodeURIComponent(recipeMatch[1]), await readJson(request));
        return recipe ? sendJson(response, 200, { recipe }) : sendError(response, 404, "Recipe not found.");
      }

      if (recipeMatch && request.method === "DELETE") {
        const removed = await store.remove(decodeURIComponent(recipeMatch[1]));
        return removed ? sendJson(response, 200, { success: true }) : sendError(response, 404, "Recipe not found.");
      }

      if (pathname === "/api/history" && request.method === "GET") {
        return sendJson(response, 200, {
          history: store.listHistory({
            recipeId: url.searchParams.get("recipeId") || "",
            limit: url.searchParams.get("limit") || 200,
          }),
        });
      }

      if (pathname === "/api/history" && request.method === "POST") {
        return sendJson(response, 201, { entry: await store.logMade(await readJson(request)) });
      }

      const historyMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
      if (historyMatch && request.method === "DELETE") {
        const removed = await store.removeHistory(decodeURIComponent(historyMatch[1]));
        return removed ? sendJson(response, 200, { success: true }) : sendError(response, 404, "History entry not found.");
      }

      if (pathname === "/api/inventory" && request.method === "GET") {
        return sendJson(response, 200, {
          inventory: store.listInventory({
            search: url.searchParams.get("search") || "",
            location: url.searchParams.get("location") || "",
            low: url.searchParams.get("low") === "true",
          }),
        });
      }

      if (pathname === "/api/inventory" && request.method === "POST") {
        return sendJson(response, 201, await store.addInventory(await readJson(request)));
      }

      const inventoryMatch = pathname.match(/^\/api\/inventory\/([^/]+)$/);
      if (inventoryMatch && request.method === "GET") {
        const item = store.getInventory(decodeURIComponent(inventoryMatch[1]));
        return item ? sendJson(response, 200, { item }) : sendError(response, 404, "Kitchen Stock item not found.");
      }

      if (inventoryMatch && request.method === "PUT") {
        const item = await store.updateInventory(decodeURIComponent(inventoryMatch[1]), await readJson(request));
        return item ? sendJson(response, 200, { item }) : sendError(response, 404, "Kitchen Stock item not found.");
      }

      if (inventoryMatch && request.method === "DELETE") {
        const removed = await store.removeInventory(decodeURIComponent(inventoryMatch[1]));
        return removed ? sendJson(response, 200, { success: true }) : sendError(response, 404, "Kitchen Stock item not found.");
      }

      const adjustMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/adjust$/);
      if (adjustMatch && request.method === "POST") {
        const body = await readJson(request);
        const item = await store.adjustInventory(decodeURIComponent(adjustMatch[1]), body.delta);
        return item ? sendJson(response, 200, { item }) : sendError(response, 404, "Kitchen Stock item not found.");
      }

      const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
      if (productMatch && request.method === "GET") {
        return sendJson(response, 200, await lookupProduct(decodeURIComponent(productMatch[1])));
      }

      if (pathname === "/api/backup" && request.method === "GET") {
        return sendJson(response, 200, store.backup(), {
          "content-disposition": `attachment; filename="recipe-box-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        });
      }

      if (pathname === "/mcp" && request.method === "GET") {
        response.setHeader("allow", "POST");
        return sendError(response, 405, "This MCP server uses Streamable HTTP POST requests.");
      }

      if (pathname === "/mcp" && request.method === "POST") {
        const result = await handleMcpMessage(store, await readJson(request));
        if (result.body === null) {
          response.writeHead(result.status);
          return response.end();
        }
        return sendJson(response, result.status, result.body, { "mcp-protocol-version": "2025-06-18" });
      }

      if ((request.method === "GET" || request.method === "HEAD") && await serveStatic(request, response, pathname)) return;
      sendError(response, 404, "Not found.");
    } catch (error) {
      const status = Number(error.status) || 500;
      if (status >= 500) console.error(error);
      sendError(response, status, status >= 500 ? "Unexpected server error." : error.message);
    }
  });

  return { server, store };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "0.0.0.0";
  const { server } = await createApp();
  server.listen(port, host, () => {
    console.log(`Recipe Box listening on http://${host}:${port}`);
  });
}
