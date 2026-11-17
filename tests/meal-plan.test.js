import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { RecipeStore } from "../lib/store.js";
import { MEALS, mealLabel, mealsOf, mergePlans, normalizePlanner, removeMeal, setMeal, suggestedMeal } from "../public/meal-plan.js";

test("the day has breakfast, lunch and dinner, in that order", () => {
  assert.deepEqual(MEALS.map((meal) => meal.id), ["breakfast", "lunch", "dinner"]);
  assert.equal(mealLabel("lunch"), "Lunch");
});

test("a day saved before meals existed is that night's dinner", () => {
  assert.deepEqual(mealsOf("loaded-taco-bowls"), { dinner: "loaded-taco-bowls" });
  assert.deepEqual(mealsOf({ breakfast: "oats", snack: "chips", lunch: "", dinner: 7 }), { breakfast: "oats" });
  assert.deepEqual(mealsOf(null), {});
  assert.deepEqual(normalizePlanner({
    "2026-11-18": "loaded-taco-bowls",
    "2026-11-19": { breakfast: "oats", dinner: "ziti" },
    "2026-11-20": {},
    "not-a-date": { dinner: "x" },
  }), {
    "2026-11-18": { dinner: "loaded-taco-bowls" },
    "2026-11-19": { breakfast: "oats", dinner: "ziti" },
  });
  assert.deepEqual(normalizePlanner(["2026-11-18"]), {});
});

test("setting and removing a meal leaves the other meals and the old plan alone", () => {
  const before = { "2026-11-18": { dinner: "ziti" } };
  const withLunch = setMeal(before, "2026-11-18", "lunch", "salad");
  assert.deepEqual(withLunch, { "2026-11-18": { lunch: "salad", dinner: "ziti" } });
  assert.deepEqual(before, { "2026-11-18": { dinner: "ziti" } }, "the old plan is not changed");
  assert.deepEqual(setMeal(withLunch, "2026-11-18", "dinner", "tacos")["2026-11-18"], { lunch: "salad", dinner: "tacos" });
  assert.deepEqual(removeMeal(withLunch, "2026-11-18", "lunch"), { "2026-11-18": { dinner: "ziti" } });
  assert.deepEqual(removeMeal(before, "2026-11-18", "dinner"), {}, "a day with no meals left is dropped");
  assert.throws(() => setMeal(before, "2026-11-18", "snack", "chips"), /meal/);
});

test("old plans merge into empty meals only", () => {
  const { planner, added } = mergePlans({ "2026-11-18": { dinner: "ziti" } }, { "2026-11-18": "tacos", "2026-11-19": "chili" });
  assert.deepEqual(planner, { "2026-11-18": { dinner: "ziti" }, "2026-11-19": { dinner: "chili" } });
  assert.equal(added, 1);
  assert.equal(mergePlans(planner, {}).added, 0);
});

test("a recipe's category or tags suggest its meal", () => {
  assert.equal(suggestedMeal({ category: "Breakfast", tags: [] }), "breakfast");
  assert.equal(suggestedMeal({ category: "Prepared", tags: ["breakfast sandwich"] }), "breakfast");
  assert.equal(suggestedMeal({ category: "Other", tags: ["brunch"] }), "breakfast");
  assert.equal(suggestedMeal({ category: "Chicken", tags: ["salad", "lunch"] }), "lunch");
  assert.equal(suggestedMeal({ category: "Beef", tags: ["weeknight"] }), "dinner");
  assert.equal(suggestedMeal(null), "dinner");
});

test("plans saved on the server before meals existed become dinner when the store starts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recipe-box-meals-"));
  try {
    await writeFile(path.join(dir, "recipes.json"), "[]");
    await writeFile(path.join(dir, "profiles.json"), JSON.stringify({
      "person-1": { favorites: [], planner: { "2026-11-18": "loaded-taco-bowls", "2026-11-19": { lunch: "salad", dinner: { id: "x" } } }, shopping: [] },
    }));
    const store = await new RecipeStore({ dataFile: path.join(dir, "recipes.json") }).init();
    const expected = { "2026-11-18": { dinner: "loaded-taco-bowls" }, "2026-11-19": { lunch: "salad" } };
    assert.deepEqual(store.getProfile("person-1").planner, expected);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "profiles.json"), "utf8"))["person-1"].planner, expected, "the file is rewritten in the new shape");
    const saved = await store.updateProfile("person-1", { planner: { "2026-11-20": { breakfast: "oats", snack: "chips" } } });
    assert.deepEqual(saved.planner, { "2026-11-20": { breakfast: "oats" } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
