// The meal plan: date ("2026-11-18") -> { breakfast, lunch, dinner } recipe ids, each optional.
// Shared by the page and the server so both read a plan the same way.

export const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
];

const MEAL_IDS = new Set(MEALS.map((meal) => meal.id));
const DATE_KEY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function mealLabel(id) {
  return MEALS.find((meal) => meal.id === id)?.label || "Dinner";
}

// One day's meals. A day saved before meals existed holds a single recipe id: that night's dinner.
export function mealsOf(value) {
  if (typeof value === "string") return value ? { dinner: value } : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const meals = {};
  for (const { id } of MEALS) {
    if (typeof value[id] === "string" && value[id]) meals[id] = value[id];
  }
  return meals;
}

export function normalizePlanner(input) {
  const planner = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return planner;
  for (const [date, value] of Object.entries(input)) {
    const meals = mealsOf(value);
    if (DATE_KEY.test(date) && Object.keys(meals).length) planner[date] = meals;
  }
  return planner;
}

function checkMeal(meal) {
  if (!MEAL_IDS.has(meal)) throw new Error(`Unknown meal: ${meal}`);
}

// Both return a new plan and leave the one passed in unchanged.
export function setMeal(planner, date, meal, recipeId) {
  checkMeal(meal);
  return { ...planner, [date]: { ...mealsOf(planner[date]), [meal]: recipeId } };
}

export function removeMeal(planner, date, meal) {
  checkMeal(meal);
  const meals = { ...mealsOf(planner[date]) };
  delete meals[meal];
  const next = { ...planner, [date]: meals };
  if (!Object.keys(meals).length) delete next[date];
  return next;
}

// Adds plans from elsewhere (an old browser copy) without replacing a meal already planned.
export function mergePlans(planner, extra) {
  let next = { ...planner };
  let added = 0;
  for (const [date, meals] of Object.entries(normalizePlanner(extra))) {
    for (const [meal, recipeId] of Object.entries(meals)) {
      if (mealsOf(next[date])[meal]) continue;
      next = setMeal(next, date, meal, recipeId);
      added += 1;
    }
  }
  return { planner: next, added };
}

// Breakfast for a breakfast or brunch recipe, lunch for one tagged lunch, otherwise dinner.
export function suggestedMeal(recipe) {
  const words = [recipe?.category, ...(Array.isArray(recipe?.tags) ? recipe.tags : [])]
    .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z]+/));
  if (words.includes("breakfast") || words.includes("brunch")) return "breakfast";
  if (words.includes("lunch")) return "lunch";
  return "dinner";
}
