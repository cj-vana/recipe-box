const JSON_LD_PATTERN = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function isoDurationToMinutes(value) {
  const match = String(value ?? "").match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return 0;
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match.map((part) => Number(part) || 0);
  return Math.round(days * 1440 + hours * 60 + minutes + seconds / 60);
}

function* walkJson(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walkJson(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  yield node;
  if (node["@graph"]) yield* walkJson(node["@graph"]);
}

function findRecipeNode(document) {
  for (const node of walkJson(document)) {
    const type = node["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((entry) => String(entry).toLowerCase() === "recipe")) return node;
  }
  return null;
}

function instructionTexts(instructions) {
  if (!instructions) return [];
  if (typeof instructions === "string") return instructions.split(/\n+/);
  const list = Array.isArray(instructions) ? instructions : [instructions];
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!entry || typeof entry !== "object") return [];
    if (Array.isArray(entry.itemListElement)) return instructionTexts(entry.itemListElement);
    return [entry.text || entry.name || ""];
  });
}

function firstYield(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = String(raw ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function keywordTags(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return list.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8);
}

function hostOf(pageUrl) {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Finds the first usable schema.org Recipe in a page's JSON-LD blocks and
// maps it to the shape the Add Recipe form understands. Images are skipped on
// purpose: the app only serves self-hosted images (see the CSP in server.js).
export function extractRecipeFromHtml(html, pageUrl = "") {
  for (const [, body] of String(html).matchAll(JSON_LD_PATTERN)) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    const node = findRecipeNode(parsed);
    if (!node) continue;
    const prepMinutes = isoDurationToMinutes(node.prepTime);
    let cookMinutes = isoDurationToMinutes(node.cookTime);
    const totalMinutes = isoDurationToMinutes(node.totalTime);
    if (!cookMinutes && totalMinutes) cookMinutes = Math.max(0, totalMinutes - prepMinutes) || totalMinutes;
    const recipe = {
      title: stripHtml(node.name),
      summary: stripHtml(node.description),
      category: stripHtml(Array.isArray(node.recipeCategory) ? node.recipeCategory[0] : node.recipeCategory) || "Other",
      tags: keywordTags(node.keywords),
      ingredients: (Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [node.recipeIngredient]).map(stripHtml).filter(Boolean),
      steps: instructionTexts(node.recipeInstructions).map(stripHtml).filter(Boolean),
      prepMinutes,
      cookMinutes,
      servings: firstYield(node.recipeYield),
      source: hostOf(pageUrl) || "Imported recipe",
    };
    if (!recipe.title || !recipe.ingredients.length || !recipe.steps.length) continue;
    return recipe;
  }
  return null;
}
