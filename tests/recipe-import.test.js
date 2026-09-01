import assert from "node:assert/strict";
import { test } from "node:test";
import { extractRecipeFromHtml, isoDurationToMinutes } from "../lib/recipe-import.js";

const page = (data) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;

test("isoDurationToMinutes parses ISO 8601 durations", () => {
  assert.equal(isoDurationToMinutes("PT15M"), 15);
  assert.equal(isoDurationToMinutes("PT1H30M"), 90);
  assert.equal(isoDurationToMinutes("PT2H"), 120);
  assert.equal(isoDurationToMinutes("P1DT1H"), 1500);
  assert.equal(isoDurationToMinutes("PT45S"), 1);
  assert.equal(isoDurationToMinutes(""), 0);
  assert.equal(isoDurationToMinutes("garbage"), 0);
});

test("extractRecipeFromHtml reads a standard JSON-LD recipe", () => {
  const recipe = extractRecipeFromHtml(page({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Test <b>Cake</b>",
    description: "A fine &amp; easy cake.",
    prepTime: "PT10M",
    cookTime: "PT25M",
    recipeYield: ["4 servings", "1 cake"],
    keywords: "cake, easy, oven",
    recipeCategory: "Dessert",
    recipeIngredient: ["2 cups flour", "1 tsp salt"],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Mix the batter." },
      { "@type": "HowToStep", text: "Bake it." },
    ],
  }), "https://www.example.com/cake");
  assert.equal(recipe.title, "Test Cake");
  assert.equal(recipe.summary, "A fine & easy cake.");
  assert.equal(recipe.category, "Dessert");
  assert.equal(recipe.prepMinutes, 10);
  assert.equal(recipe.cookMinutes, 25);
  assert.equal(recipe.servings, 4);
  assert.deepEqual(recipe.tags, ["cake", "easy", "oven"]);
  assert.deepEqual(recipe.ingredients, ["2 cups flour", "1 tsp salt"]);
  assert.deepEqual(recipe.steps, ["Mix the batter.", "Bake it."]);
  assert.equal(recipe.source, "example.com");
});

test("extractRecipeFromHtml finds recipes in @graph, string instructions, and totalTime", () => {
  const recipe = extractRecipeFromHtml(page({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Soup page" },
      {
        "@type": "Recipe",
        name: "Soup",
        recipeIngredient: "1 onion",
        recipeInstructions: "Chop the onion.\nSimmer until soft.",
        prepTime: "PT10M",
        totalTime: "PT40M",
      },
    ],
  }), "https://example.com/soup");
  assert.equal(recipe.title, "Soup");
  assert.deepEqual(recipe.ingredients, ["1 onion"]);
  assert.deepEqual(recipe.steps, ["Chop the onion.", "Simmer until soft."]);
  assert.equal(recipe.prepMinutes, 10);
  assert.equal(recipe.cookMinutes, 30);
});

test("extractRecipeFromHtml handles HowToSection instruction groups", () => {
  const recipe = extractRecipeFromHtml(page({
    "@type": "Recipe",
    name: "Layered Dip",
    recipeIngredient: ["1 can beans"],
    recipeInstructions: [
      { "@type": "HowToSection", name: "Base", itemListElement: [{ "@type": "HowToStep", text: "Spread the beans." }] },
      "Chill before serving.",
    ],
  }), "https://example.com/dip");
  assert.deepEqual(recipe.steps, ["Spread the beans.", "Chill before serving."]);
});

test("extractRecipeFromHtml skips broken JSON and pages without a recipe", () => {
  const broken = `<html><head><script type="application/ld+json">{not json</script></head></html>`;
  assert.equal(extractRecipeFromHtml(broken), null);
  assert.equal(extractRecipeFromHtml("<html><body>No recipe here.</body></html>"), null);
  assert.equal(extractRecipeFromHtml(page({ "@type": "Article", name: "Not a recipe" })), null);
});

test("extractRecipeFromHtml rejects recipes missing title, ingredients, or steps", () => {
  assert.equal(extractRecipeFromHtml(page({ "@type": "Recipe", name: "No steps", recipeIngredient: ["1 egg"] })), null);
  assert.equal(extractRecipeFromHtml(page({ "@type": "Recipe", recipeIngredient: ["1 egg"], recipeInstructions: ["Cook."] })), null);
});
