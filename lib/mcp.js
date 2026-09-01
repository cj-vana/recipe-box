import { createRequire } from "node:module";

const { version: APP_VERSION } = createRequire(import.meta.url)("../package.json");
const MCP_PROTOCOL_VERSION = "2025-06-18";

const tools = [
  {
    name: "list_recipes",
    title: "List recipes",
    description: "List compact summaries of recipes saved in Recipe Box.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Optional category filter such as Beef, Seafood, or Prepared." },
        tag: { type: "string", description: "Optional exact tag filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_recipes",
    title: "Search recipes",
    description: "Search saved recipes by title, main ingredient, category, summary, or tag.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to search for." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recipe",
    title: "Get a recipe",
    description: "Get one complete recipe by its id or exact title.",
    inputSchema: {
      type: "object",
      properties: { id_or_title: { type: "string", description: "Recipe id or exact title." } },
      required: ["id_or_title"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_recipes",
    title: "Suggest recipes",
    description: "Suggest saved recipes, favoring meals not made recently and recipes that match Kitchen Stock.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 10, default: 3 } },
      additionalProperties: false,
    },
  },
  {
    name: "add_recipe",
    title: "Add a recipe",
    description: "Add a complete recipe to the private Recipe Box library. Recipes normally serve 2 people with a small leftover portion.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        mainIngredient: { type: "string", description: "Optional main ingredient or prepared item." },
        category: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        ingredients: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: { amount: { type: "string" }, item: { type: "string" } },
            required: ["item"],
            additionalProperties: false,
          },
        },
        steps: { type: "array", minItems: 1, items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
        prepMinutes: { type: "integer", minimum: 0 },
        cookMinutes: { type: "integer", minimum: 0 },
        servings: { type: "number", minimum: 1, default: 3 },
        leftoverNote: { type: "string" },
      },
      required: ["title", "ingredients", "steps"],
      additionalProperties: false,
    },
  },
  {
    name: "list_cooking_history",
    title: "List cooking history",
    description: "List meals that have been marked as made, including dates, ratings, and notes.",
    inputSchema: {
      type: "object",
      properties: {
        recipe_id: { type: "string", description: "Optional recipe id filter." },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "record_recipe_made",
    title: "Record a cooked recipe",
    description: "Record that a recipe was made, with an optional date, 1–5 rating, and notes.",
    inputSchema: {
      type: "object",
      properties: {
        recipe_id: { type: "string" },
        made_at: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
        rating: { type: "integer", minimum: 0, maximum: 5 },
        notes: { type: "string" },
      },
      required: ["recipe_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_kitchen_stock",
    title: "List Kitchen Stock",
    description: "List what is currently recorded in the fridge, pantry, freezer, or other kitchen storage.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional name, brand, category, or barcode search." },
        location: { type: "string", enum: ["Fridge", "Pantry", "Freezer", "Other"] },
        low_only: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_kitchen_stock",
    title: "Add Kitchen Stock",
    description: "Add a bought item. If its barcode already exists, the new quantity is added to the existing amount.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        barcode: { type: "string" },
        brand: { type: "string" },
        quantity: { type: "number", minimum: 0, default: 1 },
        unit: { type: "string", default: "item" },
        location: { type: "string", enum: ["Fridge", "Pantry", "Freezer", "Other"], default: "Pantry" },
        category: { type: "string" },
        expiration_date: { type: "string", description: "Optional YYYY-MM-DD date." },
        low_at: { type: "number", minimum: 0, default: 0 },
        notes: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_kitchen_stock",
    title: "Use or restock an item",
    description: "Change an item's quantity by an amount, or set its exact quantity. Use a negative quantity_change when something is used.",
    inputSchema: {
      type: "object",
      properties: {
        id_or_barcode: { type: "string" },
        quantity_change: { type: "number", description: "Amount to add or subtract." },
        set_quantity: { type: "number", minimum: 0, description: "Exact new quantity; takes precedence over quantity_change." },
        location: { type: "string", enum: ["Fridge", "Pantry", "Freezer", "Other"] },
        expiration_date: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id_or_barcode"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_kitchen_stock",
    title: "Remove Kitchen Stock",
    description: "Delete an item from Kitchen Stock by its id or barcode.",
    inputSchema: {
      type: "object",
      properties: { id_or_barcode: { type: "string" } },
      required: ["id_or_barcode"],
      additionalProperties: false,
    },
  },
];

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function toolResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function compact(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    summary: recipe.summary,
    category: recipe.category,
    tags: recipe.tags,
    totalMinutes: recipe.prepMinutes + recipe.cookMinutes,
    servings: recipe.servings,
  };
}

function suggestions(store, limit) {
  const stockWords = new Set(store.listInventory()
    .filter((item) => item.quantity > 0)
    .flatMap((item) => item.name.toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length > 2));
  const latest = new Map();
  for (const entry of store.listHistory({ limit: 500 })) {
    if (!latest.has(entry.recipeId)) latest.set(entry.recipeId, entry.madeAt);
  }
  return store.list().map((recipe) => {
    const ingredientWords = recipe.ingredients.flatMap((ingredient) => ingredient.item.toLowerCase().split(/[^a-z0-9]+/));
    const matches = [...new Set(ingredientWords.filter((word) => stockWords.has(word)))];
    const lastMade = latest.get(recipe.id) || null;
    const daysSince = lastMade ? Math.floor((Date.now() - Date.parse(`${lastMade}T12:00:00Z`)) / 86_400_000) : 365;
    return { recipe, score: Math.min(daysSince, 90) + matches.length * 18, lastMade, stockMatches: matches };
  }).sort((a, b) => b.score - a.score)
    .slice(0, Math.min(10, Math.max(1, Number(limit) || 3)))
    .map(({ recipe, lastMade, stockMatches }) => ({ ...compact(recipe), lastMade, stockMatches }));
}

async function callTool(store, name, args = {}) {
  if (name === "list_recipes") return toolResult(store.list({ category: args.category, tag: args.tag }).map(compact));
  if (name === "search_recipes") {
    if (!String(args.query ?? "").trim()) return toolResult("A search query is required.", true);
    return toolResult(store.list({ search: args.query }).map(compact));
  }
  if (name === "get_recipe") {
    const recipe = store.get(args.id_or_title);
    return recipe ? toolResult(recipe) : toolResult("Recipe not found.", true);
  }
  if (name === "suggest_recipes") return toolResult(suggestions(store, args.limit));
  if (name === "add_recipe") {
    try {
      const recipe = await store.add({ ...args, source: "MCP client" });
      return toolResult({ success: true, message: `Added ${recipe.title}.`, recipe });
    } catch (error) {
      return toolResult(error.message, true);
    }
  }
  if (name === "list_cooking_history") return toolResult(store.listHistory({ recipeId: args.recipe_id, limit: args.limit }));
  if (name === "record_recipe_made") {
    try {
      const entry = await store.logMade({ recipeId: args.recipe_id, madeAt: args.made_at, rating: args.rating, notes: args.notes });
      return toolResult({ success: true, entry });
    } catch (error) {
      return toolResult(error.message, true);
    }
  }
  if (name === "list_kitchen_stock") {
    return toolResult(store.listInventory({ search: args.query, location: args.location, low: args.low_only }));
  }
  if (name === "add_kitchen_stock") {
    try {
      const result = await store.addInventory({
        ...args,
        expirationDate: args.expiration_date,
        lowAt: args.low_at,
      });
      return toolResult({ success: true, ...result });
    } catch (error) {
      return toolResult(error.message, true);
    }
  }
  if (name === "update_kitchen_stock") {
    const current = store.getInventory(args.id_or_barcode);
    if (!current) return toolResult("Kitchen Stock item not found.", true);
    const item = args.set_quantity !== undefined
      ? await store.updateInventory(current.id, {
          quantity: args.set_quantity,
          location: args.location,
          expirationDate: args.expiration_date,
          notes: args.notes,
        })
      : await store.adjustInventory(current.id, args.quantity_change || 0);
    if (args.set_quantity === undefined && (args.location || args.expiration_date !== undefined || args.notes !== undefined)) {
      return toolResult({ success: true, item: await store.updateInventory(current.id, {
        ...item,
        location: args.location,
        expirationDate: args.expiration_date,
        notes: args.notes,
      }) });
    }
    return toolResult({ success: true, item });
  }
  if (name === "remove_kitchen_stock") {
    const item = store.getInventory(args.id_or_barcode);
    if (!item) return toolResult("Kitchen Stock item not found.", true);
    await store.removeInventory(item.id);
    return toolResult({ success: true, removed: item.name });
  }
  return toolResult(`Unknown tool: ${name}`, true);
}

export async function handleMcpMessage(store, message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return { status: 400, body: jsonRpcError(message?.id, -32600, "Invalid JSON-RPC request.") };
  }
  if (message.method.startsWith("notifications/")) return { status: 202, body: null };
  if (message.method === "initialize") {
    return {
      status: 200,
      body: jsonRpcResult(message.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "recipe-box", title: "Recipe Box", version: APP_VERSION },
        instructions: "Use these tools for the user's private recipes, cooking history, suggestions, and Kitchen Stock. Default new recipes to two people plus a small leftover unless asked otherwise.",
      }),
    };
  }
  if (message.method === "ping") return { status: 200, body: jsonRpcResult(message.id, {}) };
  if (message.method === "tools/list") return { status: 200, body: jsonRpcResult(message.id, { tools }) };
  if (message.method === "tools/call") {
    const result = await callTool(store, message.params?.name, message.params?.arguments || {});
    return { status: 200, body: jsonRpcResult(message.id, result) };
  }
  return { status: 200, body: jsonRpcError(message.id, -32601, `Method not found: ${message.method}`) };
}

export { tools as mcpTools };
