import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { friendlyNumber, parseLeadingNumber, scaleAmount } from "../public/amounts.js";

const EN_DASH = String.fromCodePoint(0x2013);

test("keeps every amount as written at the original servings", async () => {
  const recipes = JSON.parse(await readFile(new URL("../data/seed-recipes.json", import.meta.url), "utf8"));
  const changed = recipes.flatMap((recipe) => recipe.ingredients
    .filter((ingredient) => scaleAmount(ingredient.amount, 1) !== ingredient.amount)
    .map((ingredient) => `${recipe.id}: ${ingredient.amount}`));
  assert.deepEqual(changed, []);
  assert.equal(scaleAmount("1/3 cup", 1), "1/3 cup");
  assert.equal(scaleAmount("8.8 oz", 1), "8.8 oz");
});

test("scales both ends of a range", () => {
  assert.equal(scaleAmount(`1 1/2${EN_DASH}2 lb`, 2), `3${EN_DASH}4 lb`);
  assert.equal(scaleAmount(`3${EN_DASH}3 1/2 cups`, 0.5), `1 1/2${EN_DASH}1 3/4 cups`);
  assert.equal(scaleAmount("2 to 3 stalks", 2), "4 to 6 stalks");
  assert.equal(scaleAmount("1-2 cups", 3), "3-6 cups");
});

test("scales each part of a compound amount", () => {
  assert.equal(scaleAmount("1/2 cup plus 1 tbsp", 2), "1 cup plus 2 tbsp");
});

test("scales an amount that starts with About", () => {
  assert.equal(scaleAmount("About 3 lb", 2), "About 6 lb");
  assert.equal(scaleAmount("About 1 1/2 lb", 0.5), "About 3/4 lb");
});

test("scales an about total in parentheses but not a package or can size", () => {
  assert.equal(scaleAmount("2 medium (about 1 1/2 lb)", 2), "4 medium (about 3 lb)");
  assert.equal(scaleAmount("1 jar (about 6 to 8 oz)", 2), "2 jar (about 12 to 16 oz)");
  assert.equal(scaleAmount("1 package (12-count)", 2), "2 package (12-count)");
  assert.equal(scaleAmount("1 (14 oz) can", 2), "2 (14 oz) can");
  assert.equal(scaleAmount("2 6-packs", 2), "4 6-packs");
});

test("rounds to thirds when they are closer than eighths", () => {
  assert.equal(scaleAmount("1/3 cup", 2), "2/3 cup");
  assert.equal(friendlyNumber(1 / 3), "1/3");
  assert.equal(friendlyNumber(0.75), "3/4");
  assert.equal(friendlyNumber(0.375), "3/8");
  assert.equal(friendlyNumber(1.5), "1 1/2");
  assert.equal(friendlyNumber(2), "2");
});

test("shows a tiny scaled amount as less than an eighth, never zero", () => {
  assert.equal(scaleAmount("1/4 tsp", 1 / 6), "< 1/8 tsp");
  assert.equal(friendlyNumber(0), "0");
});

test("leaves amounts without numbers alone", () => {
  assert.equal(scaleAmount("To taste", 2), "To taste");
  assert.equal(scaleAmount("", 2), "");
});

test("reads the leading quantity of a pasted ingredient line", () => {
  assert.deepEqual(parseLeadingNumber("1 1/2 cups rice"), { number: 1.5, rest: " cups rice" });
  assert.equal(parseLeadingNumber("salt to taste"), null);
});
