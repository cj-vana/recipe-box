# Recipe Box

A self-hosted, installable recipe library. Everyone shares the recipes; each person
has their own Kitchen Stock, cooking journal, favorites, meal plan and shopping list.
On your home network it opens without signing in. A second port, for a tunnel or
reverse proxy, asks everyone to sign in with an account you create. No cloud, no npm
dependencies: just Node.js and a browser. Ships with 13 example recipes (each with a
finished-dish image) that you can keep, edit or delete.

- Recipe library with search, filters built from your own categories, favorites and
  serving-size scaling; add, edit and delete recipes in the app
- **New this month**: the recipes added this month, newest first, with a count on
  the tab (link to it with `#view=new`)
- Quick fill: import a recipe from any URL that has schema.org JSON-LD, or paste
  recipe text and let the app split it into ingredients and steps
- Cook Mode with step-by-step navigation that stays on screen, automatic per-step
  timer chips (detects "roast for 25 to 30 minutes"), wake lock and a timer dock
- People and profiles: an admin adds people, gives each a role and a password, and
  can reset, turn off or delete them
- Per-person cooking journal (ratings, notes, dates), meal plan, shopping list and
  favorites, saved on the server so they follow you between devices
- Per-person Kitchen Stock: fridge, pantry and freezer with barcode scanning (camera
  or photo), Open Food Facts lookup and low-stock flags
- JSON backup export, offline copy via a service worker, and an MCP (Model Context
  Protocol) endpoint on the home port so AI assistants can read and add recipes

## Requirements

- Node.js 22 or newer. There are no npm dependencies.

## Quick start

```sh
npm start
```

Open <http://localhost:8080>. Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Home port: no sign-in, acts as the Owner |
| `PUBLIC_PORT` | unset | Sign-in port: every API call needs an account. Unset means off |
| `HOST` | `0.0.0.0` | Address both ports listen on |
| `DATA_FILE` | `data/runtime/recipes.json` | Recipes file; the other data files sit beside it |

Run the tests with:

```sh
npm test
```

## People, roles and the two ports

Recipe Box listens on two ports that share one library:

- **Home port** (`PORT`, published as `13002`): for your own network. Without a
  sign-in it acts as the **Owner**, an admin account created on first start. Anyone
  who can reach this port has full control, including creating accounts, so keep it
  on loopback, your LAN or a private VPN.
- **Sign-in port** (`PUBLIC_PORT`, published as `13012` on loopback): for outside
  access. The page loads, and everything else needs an account. Point your Cloudflare
  Tunnel or reverse proxy at this port, never at the home port.

As a safety net, requests that carry Cloudflare headers (`cf-ray`,
`cf-connecting-ip`, `cdn-loop`) get the sign-in rules even on the home port, so a
tunnel route pointed at the wrong port still asks for a password.

Roles:

| Role | Can |
| --- | --- |
| Member | Use the shared recipes and their own Kitchen Stock, journal, favorites, meal plan and shopping list |
| Editor | Also add, import, edit and delete recipes |
| Admin | Also manage people and export the backup |

To let people in from outside:

1. On the home network open **Settings** (your name, top right). Under **Your
   profile**, set a username and a password for the Owner if you want to sign in
   from outside yourself.
2. Under **People**, choose **Add a person**, pick a role and a password (**Generate**
   makes an easy one), and send them the details the app shows.
3. They open your tunnel address and sign in. Sessions last 30 days from the last
   visit; changing a password, turning a person off or deleting them signs them out
   everywhere.

Passwords are stored as scrypt hashes. Sign-in slows down after five wrong tries for
one username from one address (twenty per address) for fifteen minutes. Cookies are
`HttpOnly`, `SameSite=Lax`, and `Secure` when the proxy reports HTTPS. Requests that
change data must come from the app's own pages (checked with `Sec-Fetch-Site`) and
send JSON.

From the sign-in port, recipe import refuses addresses on private networks
(loopback, LAN, link-local, Tailscale) at connect time and on every redirect.

## Docker

```sh
docker compose up -d --build
```

The compose file publishes the home port as `127.0.0.1:13002` and the sign-in port
as `127.0.0.1:13012`. Use HTTPS (or localhost) if you want camera-based barcode
scanning, since browsers require a secure context for the camera.

Data lives in the `recipe-box-data` volume as JSON files under `/app/data`:
`recipes.json`, `history.json`, `inventory.json`, `profiles.json`, `users.json` and
`sessions.json`. The first start of version 3 creates the Owner and gives any
existing journal entries and stock items to the Owner.

## HTTP API

Journal, Kitchen Stock and profile routes act on the signed-in person (or the Owner
on the home port without a sign-in).

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | anyone | Service status (counts and version on the home port only) |
| GET/POST/DELETE | `/api/session` | anyone | Who am I; sign in; sign out |
| DELETE | `/api/sessions` | person | Sign out on every device |
| PUT | `/api/me` | person | Change your name (admins: also username) |
| POST | `/api/me/password` | person | Set or change your password |
| GET/PUT | `/api/profile` | person | Favorites, meal plan and shopping list |
| GET | `/api/recipes`, `/api/recipes/:id` | person | List (with `search`, `category`, `tag`) or read recipes |
| POST, PUT, DELETE | `/api/recipes`, `/api/recipes/:id` | editor | Create, update, delete recipes |
| GET | `/api/recipes/import?url=` | editor | Fetch a page and extract its schema.org Recipe |
| GET/POST | `/api/history` | person | List or add journal entries |
| DELETE | `/api/history/:id` | person | Remove a journal entry |
| GET/POST | `/api/inventory` | person | List or add Kitchen Stock items |
| GET/PUT/DELETE | `/api/inventory/:id` | person | Read, update or delete a stock item |
| POST | `/api/inventory/:id/adjust` | person | Change quantity by a signed `delta` |
| GET | `/api/products/:barcode` | person | Look up a barcode via Open Food Facts |
| GET | `/api/backup` | admin | Everything as one JSON file, without passwords or sessions |
| GET/POST | `/api/users` | admin | List or add people |
| PUT/DELETE | `/api/users/:id` | admin | Change, reset, turn off or delete a person |
| POST | `/mcp` | home port | Streamable HTTP MCP endpoint, acting as the Owner |

## MCP

`POST /mcp` on the home port speaks the Model Context Protocol (Streamable HTTP,
protocol version 2025-06-18) with tools for listing, searching and adding recipes,
suggestions, cooking history and Kitchen Stock. Journal and stock tools act on the
Owner's data. Point any MCP client that supports streamable HTTP at
`http://<your-host>:13002/mcp`. It needs no key and is not served on the sign-in port.

## Project layout

```
server.js              HTTP server: both ports, routes and access rules, static files
lib/store.js           JSON-file persistence for recipes and each person's data
lib/users.js           People, password hashing, sessions and sign-in throttling
lib/safe-fetch.js      Page fetch for recipe import, with the private-address guard
lib/files.js           JSON file reads and atomic writes
lib/mcp.js             MCP protocol handler and tool definitions
lib/recipe-import.js   schema.org JSON-LD recipe extraction
public/                The installable PWA (no build step)
data/seed-recipes.json Starter recipes loaded on first run
tests/                 node:test suites (npm test)
```

## License

MIT, see [LICENSE](LICENSE). Bundled fonts are under the SIL Open Font
License (see `public/vendor/fonts/OFL-NOTICE.txt`); html5-qrcode is under its
own license (see `public/vendor/html5-qrcode-LICENSE.txt`).
