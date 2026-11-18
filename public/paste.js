// Turns a pasted recipe into form fields. It lives apart from app.js so the tests can run it in
// Node. Characters outside ASCII (fraction glyphs, list bullets, dashes) are built from their code
// points, so this file stays plain ASCII.
import { friendlyNumber, parseLeadingNumber } from "./amounts.js";

const UNIT_WORDS = new Set([
  "cup", "cups", "tbsp", "tablespoon", "tablespoons", "tsp", "teaspoon", "teaspoons",
  "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "g", "gram", "grams",
  "kg", "kilogram", "kilograms", "mg", "ml", "milliliter", "milliliters", "l", "liter", "liters",
  "clove", "cloves", "can", "cans", "package", "packages", "pkg", "pinch", "pinches",
  "dash", "dashes", "slice", "slices", "stick", "sticks", "bunch", "bunches", "sprig", "sprigs",
  "head", "heads", "stalk", "stalks", "piece", "pieces", "sheet", "sheets", "tray", "trays",
  "bag", "bags", "box", "boxes", "jar", "jars", "bottle", "bottles", "quart", "quarts",
  "qt", "pint", "pints", "gallon", "gallons", "inch", "inches", "large", "medium", "small",
]);

// The vulgar fraction glyphs (one quarter to seven eighths) and what they stand for.
const FRACTION_VALUES = [
  [0xbc, "1/4"], [0xbd, "1/2"], [0xbe, "3/4"], [0x2150, "1/7"], [0x2151, "1/9"], [0x2152, "1/10"],
  [0x2153, "1/3"], [0x2154, "2/3"], [0x2155, "1/5"], [0x2156, "2/5"], [0x2157, "3/5"], [0x2158, "4/5"],
  [0x2159, "1/6"], [0x215a, "5/6"], [0x215b, "1/8"], [0x215c, "3/8"], [0x215d, "5/8"], [0x215e, "7/8"],
];
const FRACTION_CHARS = Object.fromEntries(FRACTION_VALUES.map(([code, value]) => [String.fromCodePoint(code), value]));
const FRACTIONS = Object.keys(FRACTION_CHARS).join("");
const FRACTION_PATTERN = new RegExp(`[${FRACTIONS}]`, "g");
const QUANTITY_START = new RegExp(`^[\\d${FRACTIONS}]`);
// List bullets: bullet, middle dot, small black square, white bullet.
const BULLETS = String.fromCodePoint(0x2022, 0xb7, 0x25aa, 0x25e6);
const DASHES = String.fromCodePoint(0x2013, 0x2014);
const BULLET_START = new RegExp(`^[-*${BULLETS}]\\s*`);
const LINE_MARKS = new RegExp(`^[\\s\\-${DASHES}*${BULLETS}]+`);

export const RECIPE_META_PATTERN = /^(prep(?:aration)?(?:\s*time)?|cook(?:ing)?(?:\s*time)?|bake(?:\s*time)?|total(?:\s*time)?|serves|servings?|yield|makes)\b\s*:?\s*(.*)$/i;

export function normalizeFractions(text) {
  return String(text).replace(FRACTION_PATTERN, (char) => ` ${FRACTION_CHARS[char]}`).replace(/\s+/g, " ").trim();
}

// Turns "1 1/2 cups long-grain rice" into { amount: "1 1/2 cups", item: "long-grain rice" }.
export function parseIngredientLine(line) {
  const text = normalizeFractions(String(line || "").replace(BULLET_START, ""));
  if (!text) return null;
  const parsed = parseLeadingNumber(text);
  if (!parsed) return { amount: "", item: text };
  const words = parsed.rest.trim().split(/\s+/).filter(Boolean);
  const amountWords = [];
  while (words.length && UNIT_WORDS.has(words[0].toLowerCase().replace(/[.,;]$/, ""))) amountWords.push(words.shift());
  return { amount: `${friendlyNumber(parsed.number)}${amountWords.length ? ` ${amountWords.join(" ")}` : ""}`, item: words.join(" ") || text };
}

function metaMinutes(text) {
  const hours = String(text).match(/(\d+(?:\.\d+)?)\s*(?:hr|hour)/i);
  const minutes = String(text).match(/(\d+(?:\.\d+)?)\s*(?:m\b|min)/i);
  if (!hours && !minutes) return 0;
  return Math.round((hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0));
}

function cleanStepLine(line) {
  return String(line).replace(/^\s*(?:step\s*)?\d+\s*[.):-]\s*/i, "").trim();
}

// "Bake for 20 minutes until bubbling." and "Cook the pasta: 8 to 10 minutes." are steps, not
// times. A time or yield line has a colon straight after its label ("Bake time: 25 min"), or a
// short number after it: anywhere for a yield or a "... time" label ("Makes 24 cookies",
// "Total time 35 min"), and outside the steps for the rest ("Prep 10 min").
export function recipeMetaLine(line, section) {
  const meta = line.match(RECIPE_META_PATTERN);
  if (!meta) return null;
  const labelled = line.slice(meta[1].length).trimStart().startsWith(":");
  const shortValue = /^(about\s+)?\d/i.test(meta[2]) && meta[2].split(/\s+/).length <= 4;
  const anySection = /^(serves|servings?|yield|makes)$|time$/i.test(meta[1]);
  return labelled || (shortValue && (anySection || section !== "steps")) ? meta : null;
}

// Best-effort parse of a whole pasted recipe into form-ready fields. Handles
// both sectioned text ("Ingredients:" / "Instructions:") and free-form pastes.
export function parsePastedRecipe(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(LINE_MARKS, "").trim());
  const recipe = { title: "", summary: "", prepMinutes: 0, cookMinutes: 0, servings: 0, ingredients: [], steps: [] };
  let section = "intro";
  let totalMinutes = 0;
  const summaryParts = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^(ingredients?|what you need|you will need)\s*:?$/i.test(line)) { section = "ingredients"; continue; }
    if (/^(instructions?|directions?|method|preparation|steps?|what to do)\s*:?$/i.test(line)) { section = "steps"; continue; }
    const meta = recipeMetaLine(line, section);
    if (meta) {
      const label = meta[1].toLowerCase();
      if (/^(serves|servings?|yield|makes)/.test(label)) {
        const count = meta[2].match(/\d+/);
        if (count) recipe.servings = Number(count[0]);
      } else {
        const minutes = metaMinutes(meta[2]);
        if (label.startsWith("prep")) recipe.prepMinutes = minutes || recipe.prepMinutes;
        else if (label.startsWith("total")) totalMinutes = minutes || totalMinutes;
        else recipe.cookMinutes = minutes || recipe.cookMinutes;
      }
      continue;
    }
    if (section === "ingredients") recipe.ingredients.push(line);
    else if (section === "steps") recipe.steps.push(cleanStepLine(line));
    else if (!recipe.title) recipe.title = line;
    else summaryParts.push(line);
  }
  if (!recipe.cookMinutes && totalMinutes) recipe.cookMinutes = Math.max(0, totalMinutes - recipe.prepMinutes) || totalMinutes;
  if (!recipe.ingredients.length && !recipe.steps.length) {
    // No section headers found: guess ingredients by leading quantities.
    const body = lines.filter((line) => line && !recipeMetaLine(line, "intro"));
    recipe.title = body.shift() || recipe.title;
    for (const line of body) {
      if (QUANTITY_START.test(line) && line.length <= 140) recipe.ingredients.push(line);
      else recipe.steps.push(cleanStepLine(line));
    }
    return { ...recipe, summary: "" };
  }
  return { ...recipe, summary: summaryParts.join(" ").slice(0, 600) };
}
