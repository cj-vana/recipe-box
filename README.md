# Recipe Box

A self-hosted, installable recipe library for your own network. No accounts, no
cloud, no dependencies — just Node.js and a browser. Ships with 13 example
recipes (each with a generated finished-dish image) that you can keep, edit, or
delete.

- Recipe library with search, filters, favorites, and serving-size scaling
- Quick fill: import a recipe from any URL that has schema.org JSON-LD, or
  paste recipe text and let the app split it into ingredients and steps
- Cook Mode with step-by-step navigation, automatic per-step timer chips
  (detects "roast for 25–30 minutes"), wake lock, and a multi-timer dock
- Cooking journal with ratings, notes, and date-made tracking
- Meal planning and an editable shopping list
- Kitchen Stock: fridge, pantry, and freezer tracking with barcode scanning
  (camera or photo), Open Food Facts lookup, and low-stock flags
- Suggestions based on what you have, what you liked, and what you haven't
  cooked in a while
- JSON backup export, offline caching via a service worker, and an MCP
  (Model Context Protocol) endpoint so AI assistants can read and add recipes

## Requirements

- Node.js 22 or newer. That's it — there are no npm dependencies.

## Quick start

```sh
npm start
```

Open <http://localhost:8080>. `PORT`, `HOST`, and `DATA_FILE` environment
variables are honored.

Run the tests with:

```sh
npm test
```

## Docker

```sh
docker compose up -d --build
```

The compose file publishes port `13002` on loopback only. Recipe Box has **no
authentication** — it is designed for a trusted home network. Put it behind
your own VPN or reverse proxy if you want remote access, and use HTTPS (or
localhost) if you want camera-based barcode scanning, since browsers require a
secure context for camera access.

Data (recipes, history, Kitchen Stock) lives in the `recipe-box-data` volume as
JSON files under `/app/data`.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service and data counts |
| GET/POST | `/api/recipes` | List (with `search`, `category`, `tag` filters) or create recipes |
| GET/PUT/DELETE | `/api/recipes/:id` | Read, update, or delete one recipe |
| GET | `/api/recipes/import?url=…` | Fetch a page and extract its schema.org Recipe |
| GET/POST | `/api/history` | List or add cooking-journal entries |
| DELETE | `/api/history/:id` | Remove a journal entry |
| GET/POST | `/api/inventory` | List or add Kitchen Stock items |
| GET/PUT/DELETE | `/api/inventory/:id` | Read, update, or delete a stock item |
| POST | `/api/inventory/:id/adjust` | Change quantity by a signed `delta` |
| GET | `/api/products/:barcode` | Look up a barcode via Open Food Facts |
| GET | `/api/backup` | Download everything as one JSON file |
| POST | `/mcp` | Streamable HTTP MCP endpoint |

Note that `/api/recipes/import` fetches arbitrary URLs server-side, which is
another reason to keep Recipe Box on a trusted network.

## MCP

`POST /mcp` speaks the Model Context Protocol (Streamable HTTP, protocol
version 2025-06-18) with tools for listing, searching, and adding recipes,
suggestions, cooking history, and Kitchen Stock management. Point any MCP
client that supports streamable HTTP at `http://<your-host>:13002/mcp` — no
API key is required, so only expose it on networks you trust.

## Project layout

```
server.js            HTTP server: static files, JSON API, import endpoint
lib/store.js         JSON-file persistence for recipes, history, inventory
lib/mcp.js           MCP protocol handler and tool definitions
lib/recipe-import.js schema.org JSON-LD recipe extraction
public/              The installable PWA (no build step)
data/seed-recipes.json  Starter recipes loaded on first run
tests/               node:test suites (npm test)
```

## License

MIT — see [LICENSE](LICENSE). Bundled fonts are under the SIL Open Font
License (see `public/vendor/fonts/OFL-NOTICE.txt`); html5-qrcode is under its
own license (see `public/vendor/html5-qrcode-LICENSE.txt`).
