import assert from "node:assert/strict";
import { test } from "node:test";
import { isAddedThisMonth, monthKeyOf, monthLabel, newRecipes } from "../public/new-this-month.js";
import { WORDS, generatePassphrase } from "../public/passphrase.js";

// Dates are built in local time, the way the page computes "this month".
const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).toISOString();
const recipe = (id, createdAt) => ({ id, title: id, createdAt });

test("lists this month's recipes newest first", () => {
  const now = new Date(2026, 10, 17, 9);
  const recipes = [
    recipe("august", at(2026, 8, 16)),
    recipe("early-november", at(2026, 11, 1, 0)),
    recipe("late-october", at(2026, 10, 31, 23)),
    recipe("mid-november", at(2026, 11, 8)),
  ];
  const result = newRecipes(recipes, now);
  assert.equal(result.monthKey, "2026-11");
  assert.equal(result.isCurrentMonth, true);
  assert.deepEqual(result.recipes.map((item) => item.id), ["mid-november", "early-november"]);
  assert.equal(isAddedThisMonth(recipes[1], now), true);
  assert.equal(isAddedThisMonth(recipes[2], now), false);
});

test("falls back to the latest month with additions and names it", () => {
  const now = new Date(2026, 11, 2, 9);
  const recipes = [recipe("a", at(2026, 10, 5)), recipe("b", at(2026, 11, 20)), recipe("c", at(2026, 11, 9))];
  const result = newRecipes(recipes, now);
  assert.deepEqual({ monthKey: result.monthKey, isCurrentMonth: result.isCurrentMonth }, { monthKey: "2026-11", isCurrentMonth: false });
  assert.deepEqual(result.recipes.map((item) => item.id), ["b", "c"]);
  assert.equal(monthLabel("2026-11", now, "en-US"), "November");
  assert.equal(monthLabel("2025-11", now, "en-US"), "November 2025");
});

test("an empty library or recipes without dates give an empty current month", () => {
  const now = new Date(2026, 10, 17);
  assert.deepEqual(newRecipes([], now), { monthKey: "2026-11", isCurrentMonth: true, recipes: [] });
  assert.deepEqual(newRecipes([recipe("x", "not a date")], now).recipes, []);
  assert.equal(monthKeyOf(now), "2026-11");
});

test("generated passwords are four kitchen words and a number", () => {
  assert.ok(new Set(WORDS).size >= 128, `only ${new Set(WORDS).size} distinct words`);
  for (const word of WORDS) assert.match(word, /^[a-z]+$/);
  const seen = new Set();
  for (let round = 0; round < 50; round += 1) {
    const password = generatePassphrase();
    assert.match(password, /^([a-z]+-){4}\d{2}$/);
    assert.ok(password.length >= 10);
    seen.add(password);
  }
  assert.ok(seen.size > 45, "passwords repeat too often");
});
