import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DISH_IMAGES = {
  "garlic-butter-filet": "/images/dishes/garlic-butter-filet.webp",
  "cheddar-herb-beef-pot-pie": "/images/dishes/cheddar-herb-beef-pot-pie.webp",
  "stroganoff-swedish-meatballs": "/images/dishes/stroganoff-swedish-meatballs.webp",
  "loaded-taco-bowls": "/images/dishes/loaded-taco-bowls.webp",
  "caramelized-onion-patty-melts": "/images/dishes/caramelized-onion-patty-melts.webp",
  "flat-iron-steak-fajitas": "/images/dishes/flat-iron-steak-fajitas.webp",
  "mushroom-swiss-burgers": "/images/dishes/mushroom-swiss-burgers.webp",
  "garlic-parmesan-wings": "/images/dishes/garlic-parmesan-wings.webp",
  "baked-ziti-dinner": "/images/dishes/baked-ziti-dinner.webp",
  "smoked-bacon-mac-and-cheese": "/images/dishes/smoked-bacon-mac-and-cheese.webp",
  "homestyle-beef-stew": "/images/dishes/homestyle-beef-stew.webp",
  "bacon-breakfast-hash": "/images/dishes/bacon-breakfast-hash.webp",
  "lemon-butter-scallops-risotto": "/images/dishes/lemon-butter-scallops-risotto.webp",
};

const MAIN_INGREDIENTS = {
  "garlic-butter-filet": "Filet mignon",
  "cheddar-herb-beef-pot-pie": "Beef pot pie",
  "stroganoff-swedish-meatballs": "Swedish meatballs",
  "loaded-taco-bowls": "Ground beef",
  "caramelized-onion-patty-melts": "Beef patties",
  "flat-iron-steak-fajitas": "Flat-iron steak",
  "mushroom-swiss-burgers": "Beef patties",
  "garlic-parmesan-wings": "Chicken wings",
  "baked-ziti-dinner": "Baked ziti",
  "smoked-bacon-mac-and-cheese": "Smoked bacon mac and cheese",
  "homestyle-beef-stew": "Beef stew",
  "bacon-breakfast-hash": "Bacon",
  "lemon-butter-scallops-risotto": "Sea scallops",
};

const STOCK_LOCATIONS = new Set(["Fridge", "Pantry", "Freezer", "Other"]);

function cleanString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function slugify(value) {
  return cleanString(value, 120)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "recipe";
}

function normalizeIngredients(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((ingredient) => typeof ingredient === "string"
      ? { amount: "", item: cleanString(ingredient, 240) }
      : { amount: cleanString(ingredient?.amount, 80), item: cleanString(ingredient?.item, 240) })
    .filter((ingredient) => ingredient.item);
}

function normalizeRecipe(input, existing = {}, { touch = true } = {}) {
  const title = cleanString(input.title ?? existing.title, 140);
  if (!title) throw new Error("A recipe title is required.");
  const ingredients = normalizeIngredients(input.ingredients ?? existing.ingredients);
  const steps = (input.steps ?? existing.steps ?? [])
    .map((step) => cleanString(step, 1200))
    .filter(Boolean)
    .slice(0, 40);
  if (!ingredients.length) throw new Error("Add at least one ingredient.");
  if (!steps.length) throw new Error("Add at least one instruction.");

  const now = new Date().toISOString();
  const id = existing.id || slugify(title);
  const { freezerItem: _legacyFreezerItem, ...base } = existing;
  return {
    ...base,
    id,
    title,
    summary: cleanString(input.summary ?? existing.summary, 600),
    mainIngredient: MAIN_INGREDIENTS[id] || cleanString(input.mainIngredient ?? input.freezerItem ?? existing.mainIngredient ?? existing.freezerItem, 160),
    image: DISH_IMAGES[id] || cleanString(input.image ?? existing.image, 240) || "/images/recipe-placeholder.svg",
    category: cleanString(input.category ?? existing.category, 60) || "Other",
    tags: [...new Set((input.tags ?? existing.tags ?? [])
      .map((tag) => cleanString(tag, 40))
      .filter((tag) => tag && tag.toLowerCase() !== "freezer"))].slice(0, 12),
    ingredients,
    steps,
    notes: (input.notes ?? existing.notes ?? []).map((note) => cleanString(note, 600)).filter(Boolean).slice(0, 10),
    prepMinutes: Math.max(0, Number(input.prepMinutes ?? existing.prepMinutes) || 0),
    cookMinutes: Math.max(0, Number(input.cookMinutes ?? existing.cookMinutes) || 0),
    servings: Math.max(1, Number(input.servings ?? existing.servings) || 3),
    leftoverNote: cleanString(input.leftoverNote ?? existing.leftoverNote, 300),
    source: cleanString(input.source ?? existing.source, 160) || "Personal recipe",
    createdAt: existing.createdAt || now,
    updatedAt: touch ? now : existing.updatedAt || now,
  };
}

function normalizeHistory(input, recipe) {
  const madeAt = cleanString(input.madeAt, 10) || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(madeAt)) throw new Error("Made date must use YYYY-MM-DD.");
  return {
    id: input.id || randomUUID(),
    recipeId: cleanString(input.recipeId ?? recipe?.id, 160),
    recipeTitle: cleanString(input.recipeTitle ?? recipe?.title, 140) || "Removed recipe",
    madeAt,
    rating: Math.max(0, Math.min(5, Number(input.rating) || 0)),
    notes: cleanString(input.notes, 1000),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function normalizeStockItem(input, existing = {}) {
  const name = cleanString(input.name ?? existing.name, 180);
  if (!name) throw new Error("An item name is required.");
  const location = cleanString(input.location ?? existing.location, 20) || "Pantry";
  const now = new Date().toISOString();
  return {
    ...existing,
    id: existing.id || randomUUID(),
    barcode: cleanString(input.barcode ?? existing.barcode, 80).replace(/\s/g, ""),
    name,
    brand: cleanString(input.brand ?? existing.brand, 140),
    quantity: Math.max(0, Number(input.quantity ?? existing.quantity) || 0),
    unit: cleanString(input.unit ?? existing.unit, 40) || "item",
    location: STOCK_LOCATIONS.has(location) ? location : "Other",
    category: cleanString(input.category ?? existing.category, 80),
    expirationDate: cleanString(input.expirationDate ?? existing.expirationDate, 10),
    lowAt: Math.max(0, Number(input.lowAt ?? existing.lowAt) || 0),
    notes: cleanString(input.notes ?? existing.notes, 600),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

async function loadArray(file, fallback = []) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(value) ? value : fallback;
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export class RecipeStore {
  constructor({ dataFile, seedFile, historyFile, inventoryFile }) {
    this.dataFile = dataFile;
    this.seedFile = seedFile;
    this.historyFile = historyFile || path.join(path.dirname(dataFile), "history.json");
    this.inventoryFile = inventoryFile || path.join(path.dirname(dataFile), "inventory.json");
    this.recipes = [];
    this.history = [];
    this.inventory = [];
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.dataFile), { recursive: true });
    let rawRecipes;
    try {
      rawRecipes = JSON.parse(await readFile(this.dataFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      rawRecipes = JSON.parse(await readFile(this.seedFile, "utf8"));
    }
    this.recipes = rawRecipes.map((recipe) => normalizeRecipe(recipe, recipe, { touch: false }));
    this.history = (await loadArray(this.historyFile)).map((entry) => normalizeHistory(entry, this.get(entry.recipeId)));
    this.inventory = (await loadArray(this.inventoryFile)).map((item) => normalizeStockItem(item, item));
    await Promise.all([this.persistRecipes(), this.persistHistory(), this.persistInventory()]);
    return this;
  }

  list({ search = "", category = "", tag = "" } = {}) {
    const query = cleanString(search, 120).toLowerCase();
    return this.recipes
      .filter((recipe) => {
        const haystack = [recipe.title, recipe.summary, recipe.mainIngredient, recipe.category, ...recipe.tags].join(" ").toLowerCase();
        return (!query || haystack.includes(query))
          && (!category || recipe.category.toLowerCase() === category.toLowerCase())
          && (!tag || recipe.tags.some((item) => item.toLowerCase() === tag.toLowerCase()));
      })
      .map((recipe) => structuredClone(recipe));
  }

  get(idOrTitle) {
    const needle = cleanString(idOrTitle, 160).toLowerCase();
    const recipe = this.recipes.find((item) => item.id.toLowerCase() === needle || item.title.toLowerCase() === needle);
    return recipe ? structuredClone(recipe) : null;
  }

  async add(input) {
    const recipe = normalizeRecipe(input);
    if (this.recipes.some((item) => item.id === recipe.id)) recipe.id = `${recipe.id}-${randomUUID().slice(0, 6)}`;
    this.recipes.unshift(recipe);
    await this.persistRecipes();
    return structuredClone(recipe);
  }

  async update(id, input) {
    const index = this.recipes.findIndex((recipe) => recipe.id === id);
    if (index === -1) return null;
    this.recipes[index] = normalizeRecipe(input, this.recipes[index]);
    await this.persistRecipes();
    return structuredClone(this.recipes[index]);
  }

  async remove(id) {
    const index = this.recipes.findIndex((recipe) => recipe.id === id);
    if (index === -1) return false;
    this.recipes.splice(index, 1);
    await this.persistRecipes();
    return true;
  }

  listHistory({ recipeId = "", limit = 200 } = {}) {
    return this.history
      .filter((entry) => !recipeId || entry.recipeId === recipeId)
      .sort((a, b) => b.madeAt.localeCompare(a.madeAt) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(500, Math.max(1, Number(limit) || 200)))
      .map((entry) => structuredClone(entry));
  }

  async logMade(input) {
    const recipe = this.get(input.recipeId);
    if (!recipe) throw Object.assign(new Error("Recipe not found."), { status: 404 });
    const entry = normalizeHistory(input, recipe);
    this.history.unshift(entry);
    await this.persistHistory();
    return structuredClone(entry);
  }

  async removeHistory(id) {
    const index = this.history.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    this.history.splice(index, 1);
    await this.persistHistory();
    return true;
  }

  listInventory({ search = "", location = "", low = false } = {}) {
    const query = cleanString(search, 120).toLowerCase();
    return this.inventory
      .filter((item) => {
        const haystack = [item.name, item.brand, item.barcode, item.category, item.notes].join(" ").toLowerCase();
        return (!query || haystack.includes(query))
          && (!location || item.location.toLowerCase() === location.toLowerCase())
          && (!low || item.quantity <= item.lowAt);
      })
      .sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name))
      .map((item) => structuredClone(item));
  }

  getInventory(idOrBarcode) {
    const needle = cleanString(idOrBarcode, 180).toLowerCase();
    const item = this.inventory.find((candidate) => candidate.id.toLowerCase() === needle || candidate.barcode.toLowerCase() === needle);
    return item ? structuredClone(item) : null;
  }

  async addInventory(input) {
    const barcode = cleanString(input.barcode, 80).replace(/\s/g, "");
    const existingIndex = barcode ? this.inventory.findIndex((item) => item.barcode === barcode) : -1;
    if (existingIndex >= 0) {
      const current = this.inventory[existingIndex];
      this.inventory[existingIndex] = normalizeStockItem({
        ...input,
        name: input.name || current.name,
        quantity: current.quantity + Math.max(0, Number(input.quantity) || 1),
      }, current);
      await this.persistInventory();
      return { item: structuredClone(this.inventory[existingIndex]), merged: true };
    }
    const item = normalizeStockItem({ ...input, quantity: input.quantity ?? 1 });
    this.inventory.push(item);
    await this.persistInventory();
    return { item: structuredClone(item), merged: false };
  }

  async updateInventory(id, input) {
    const index = this.inventory.findIndex((item) => item.id === id);
    if (index === -1) return null;
    this.inventory[index] = normalizeStockItem(input, this.inventory[index]);
    await this.persistInventory();
    return structuredClone(this.inventory[index]);
  }

  async adjustInventory(idOrBarcode, delta) {
    const index = this.inventory.findIndex((item) => item.id === idOrBarcode || item.barcode === idOrBarcode);
    if (index === -1) return null;
    this.inventory[index] = normalizeStockItem({ quantity: this.inventory[index].quantity + Number(delta || 0) }, this.inventory[index]);
    await this.persistInventory();
    return structuredClone(this.inventory[index]);
  }

  async removeInventory(id) {
    const index = this.inventory.findIndex((item) => item.id === id);
    if (index === -1) return false;
    this.inventory.splice(index, 1);
    await this.persistInventory();
    return true;
  }

  backup() {
    return {
      exportedAt: new Date().toISOString(),
      version: 2,
      recipes: structuredClone(this.recipes),
      history: structuredClone(this.history),
      inventory: structuredClone(this.inventory),
    };
  }

  async persistRecipes() { return this.persistFile(this.dataFile, this.recipes); }
  async persistHistory() { return this.persistFile(this.historyFile, this.history); }
  async persistInventory() { return this.persistFile(this.inventoryFile, this.inventory); }

  async persistFile(file, value) {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tempFile, payload, "utf8");
      await rename(tempFile, file);
    });
    return this.writeQueue;
  }
}
