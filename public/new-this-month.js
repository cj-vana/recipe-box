// Which recipes count as "new": those added in the viewer's current calendar month (local
// time). When nothing was added yet this month, the most recent month that had additions.

export function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function addedDate(recipe) {
  const date = new Date(recipe?.createdAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAddedThisMonth(recipe, now = new Date()) {
  const date = addedDate(recipe);
  return Boolean(date) && monthKeyOf(date) === monthKeyOf(now) && date <= now;
}

export function newRecipes(recipes, now = new Date()) {
  const current = monthKeyOf(now);
  const dated = recipes
    .map((recipe) => ({ recipe, date: addedDate(recipe) }))
    .filter((entry) => entry.date && entry.date <= now)
    .sort((a, b) => b.date - a.date);
  const inMonth = (key) => dated.filter((entry) => monthKeyOf(entry.date) === key).map((entry) => entry.recipe);
  const thisMonth = inMonth(current);
  if (thisMonth.length || !dated.length) return { monthKey: current, isCurrentMonth: true, recipes: thisMonth };
  const latest = monthKeyOf(dated[0].date);
  return { monthKey: latest, isCurrentMonth: false, recipes: inMonth(latest) };
}

// "November", or "November 2025" when the month is not in the current year.
export function monthLabel(monthKey, now = new Date(), locale = undefined) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  const options = year === now.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" };
  return date.toLocaleDateString(locale, options);
}
