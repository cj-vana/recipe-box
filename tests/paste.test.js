import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIngredientLine, parsePastedRecipe, recipeMetaLine } from "../public/paste.js";

const lines = (...parts) => parts.join(String.fromCharCode(10));
// Characters outside ASCII are built from code points so this file stays plain ASCII.
const glyph = (...codes) => String.fromCodePoint(...codes);
const HALF = glyph(0xbd);
const QUARTER = glyph(0xbc);
const THREE_QUARTERS = glyph(0xbe);
const THIRD = glyph(0x2153);
const EIGHTH = glyph(0x215b);
const BULLET = glyph(0x2022);
const MIDDLE_DOT = glyph(0xb7);
const SQUARE = glyph(0x25aa);
const WHITE_BULLET = glyph(0x25e6);
const EN_DASH = glyph(0x2013);
const EM_DASH = glyph(0x2014);

test("a step that starts with Bake stays a step; labelled times and a serves line above are read", () => {
  const recipe = parsePastedRecipe(lines("Phone Pasta Bake", "Serves 4", "Prep 10 min", "Ingredients", "1 lb pasta",
    "2 cups marinara", "Steps", "Boil the pasta until just tender.", "Bake for 20 minutes until bubbling.", "Cook time: 25 min"));
  assert.equal(recipe.title, "Phone Pasta Bake");
  assert.deepEqual([recipe.servings, recipe.prepMinutes, recipe.cookMinutes], [4, 10, 25]);
  assert.deepEqual(recipe.ingredients, ["1 lb pasta", "2 cups marinara"]);
  assert.deepEqual(recipe.steps, ["Boil the pasta until just tender.", "Bake for 20 minutes until bubbling."]);
});

test("a colon later in a step does not make it a time line", () => {
  const recipe = parsePastedRecipe(lines("Colon Pasta", "Ingredients", "1 lb pasta", "Steps", "Cook the pasta: 8 to 10 minutes.", "Drain and serve."));
  assert.equal(recipe.cookMinutes, 0);
  assert.deepEqual(recipe.steps, ["Cook the pasta: 8 to 10 minutes.", "Drain and serve."]);
});

test("a yield or a total time after the steps is read, not kept as a step", () => {
  const cookies = parsePastedRecipe(lines("Footer Cookies", "Ingredients", "2 cups flour", "1 cup sugar", "Steps",
    "Mix everything.", "Bake for 12 minutes.", "Makes 24 cookies"));
  assert.equal(cookies.servings, 24);
  assert.deepEqual(cookies.steps, ["Mix everything.", "Bake for 12 minutes."]);
  const stew = parsePastedRecipe(lines("Footer Stew", "Ingredients", "2 lb beef", "Steps", "Brown the beef.", "Simmer until tender.", "Total time 35 min"));
  assert.equal(stew.cookMinutes, 35);
  assert.deepEqual(stew.steps, ["Brown the beef.", "Simmer until tender."]);
});

test("without headings, quantity lines are ingredients and a Cook line stays a step", () => {
  const recipe = parsePastedRecipe(lines("Phone Oat Bowl", "Serves 2", "1 cup oats", "2 cups milk",
    "Cook for 5 minutes, stirring often.", "Top with berries and serve."));
  assert.equal(recipe.title, "Phone Oat Bowl");
  assert.deepEqual([recipe.servings, recipe.cookMinutes], [2, 0]);
  assert.deepEqual(recipe.ingredients, ["1 cup oats", "2 cups milk"]);
  assert.deepEqual(recipe.steps, ["Cook for 5 minutes, stirring often.", "Top with berries and serve."]);
  assert.equal(recipe.summary, "");
});

test("labelled prep and yield lines above the ingredients are read", () => {
  const recipe = parsePastedRecipe(lines("Labelled Soup", "Prep: 15 min", "Yield: 6 bowls", "Ingredients", "1 onion", "Instructions", "Chop the onion.", "Simmer it."));
  assert.deepEqual([recipe.prepMinutes, recipe.servings], [15, 6]);
  assert.deepEqual(recipe.ingredients, ["1 onion"]);
  assert.deepEqual(recipe.steps, ["Chop the onion.", "Simmer it."]);
});

test("list bullets, dashes and step numbers are taken off; fraction glyphs are kept for the ingredient parser", () => {
  const recipe = parsePastedRecipe(lines("Rice Bowl", "Ingredients", `${BULLET} 1${HALF} cups rice`, `${MIDDLE_DOT} ${THREE_QUARTERS} cup broth`,
    `${SQUARE} 2 eggs`, `${WHITE_BULLET} ${EIGHTH} tsp salt`, "Steps", `${EN_DASH} Rinse the rice.`, `${EM_DASH} Simmer for 18 min.`, "1. Serve."));
  assert.deepEqual(recipe.ingredients, [`1${HALF} cups rice`, `${THREE_QUARTERS} cup broth`, "2 eggs", `${EIGHTH} tsp salt`]);
  assert.deepEqual(recipe.steps, ["Rinse the rice.", "Simmer for 18 min.", "Serve."]);
  assert.equal(recipe.cookMinutes, 0);
});

test("without headings, a line that starts with a fraction glyph is an ingredient", () => {
  const recipe = parsePastedRecipe(lines("Milk Oats", `${HALF} cup milk`, `${THIRD} cup oats`, "1 pinch salt", "Stir and heat until thick."));
  assert.equal(recipe.title, "Milk Oats");
  assert.deepEqual(recipe.ingredients, [`${HALF} cup milk`, `${THIRD} cup oats`, "1 pinch salt"]);
  assert.deepEqual(recipe.steps, ["Stir and heat until thick."]);
});

test("a total time with hours and a prep time give the cook time; numbered steps lose their numbers", () => {
  const recipe = parsePastedRecipe(lines(`${EM_DASH} Dashed Title`, "Total time: 1 hr 20 min", "Prep time 20 min", "Ingredients",
    "- 3 apples", "* 1 cup oats", "Directions", "Step 1: Slice.", "2) Bake."));
  assert.equal(recipe.title, "Dashed Title");
  assert.deepEqual([recipe.prepMinutes, recipe.cookMinutes], [20, 60]);
  assert.deepEqual(recipe.ingredients, ["3 apples", "1 cup oats"]);
  assert.deepEqual(recipe.steps, ["Slice.", "Bake."]);
});

test("recipeMetaLine keeps a short-numbered Prep line out of the steps only", () => {
  assert.ok(recipeMetaLine("Prep 10 min", "intro"));
  assert.equal(recipeMetaLine("Prep 10 min", "steps"), null);
  assert.ok(recipeMetaLine("Prep: 10 min", "steps"));
  assert.equal(recipeMetaLine("Bake for 20 minutes until bubbling.", "steps"), null);
});

test("parseIngredientLine splits the amount from the item, through bullets and fraction glyphs", () => {
  assert.deepEqual(parseIngredientLine("1 1/2 cups long-grain rice"), { amount: "1 1/2 cups", item: "long-grain rice" });
  assert.deepEqual(parseIngredientLine(`1${HALF} cups rice`), { amount: "1 1/2 cups", item: "rice" });
  assert.deepEqual(parseIngredientLine(`${MIDDLE_DOT} ${THREE_QUARTERS} cup broth`), { amount: "3/4 cup", item: "broth" });
  assert.deepEqual(parseIngredientLine(`${BULLET} 2${QUARTER} cups flour`), { amount: "2 1/4 cups", item: "flour" });
  assert.deepEqual(parseIngredientLine(`${SQUARE} ${EIGHTH} tsp salt`), { amount: "1/8 tsp", item: "salt" });
  assert.deepEqual(parseIngredientLine(`${WHITE_BULLET} 3 large eggs`), { amount: "3 large", item: "eggs" });
  assert.deepEqual(parseIngredientLine("* 1 can tomatoes"), { amount: "1 can", item: "tomatoes" });
  assert.deepEqual(parseIngredientLine(`${THIRD} cup sugar`), { amount: "1/3 cup", item: "sugar" });
  assert.deepEqual(parseIngredientLine("- pinch of salt"), { amount: "", item: "pinch of salt" });
  assert.equal(parseIngredientLine(""), null);
});
