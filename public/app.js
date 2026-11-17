import { friendlyNumber, parseLeadingNumber, scaleAmount } from "./amounts.js";
import { api, ApiError, isOfflineError, onUnauthorized } from "./api.js";
import { initials, setupAccount } from "./account.js";
import { MEALS, mealLabel, mealsOf, mergePlans, normalizePlanner, removeMeal, setMeal, suggestedMeal } from "./meal-plan.js";
import { isAddedThisMonth, monthKeyOf, monthLabel, newRecipes } from "./new-this-month.js";

const GLYPH = {
  star: String.fromCodePoint(0x2605),
  starOutline: String.fromCodePoint(0x2606),
  timer: String.fromCodePoint(0x23f1),
  times: String.fromCodePoint(0xd7),
  minus: String.fromCodePoint(0x2212),
  ellipsis: String.fromCodePoint(0x2026),
  dot: String.fromCodePoint(0xb7),
  check: String.fromCodePoint(0x2713),
  left: String.fromCodePoint(0x2190),
  right: String.fromCodePoint(0x2192),
};

// Shared keys, plus keys that hold one person's data (suffixed with their id).
const STORAGE = {
  recipeCache: "recipe-box:recipe-cache",
  session: "recipe-box:session",
  timers: "recipe-box:timers",
  profileUploaded: "recipe-box:profile-uploaded",
};
const personKey = (name, userId = state.me?.id) => `recipe-box:${name}:${userId}`;
// Lists kept in the browser before profiles existed; uploaded once into the Owner's profile.
const LEGACY = {
  favorites: ["recipe-box:favorites", "freezer-table:favorites"],
  planner: ["recipe-box:planner"],
  shopping: ["recipe-box:shopping"],
};

// Remove credentials left by the retired write-key flow from existing installations.
localStorage.removeItem("recipe-box:write-key");
localStorage.removeItem("freezer-table:write-key");

function stored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const state = {
  me: null,
  zone: "home",
  signedIn: false,
  homeNetwork: true,
  offline: false,
  recipes: [],
  history: [],
  inventory: [],
  query: "",
  category: "",
  sort: "recommended",
  stockQuery: "",
  stockLocation: "",
  stockLowOnly: false,
  activeRecipe: null,
  editingRecipeId: null,
  cookStep: 0,
  servings: 3,
  rating: 0,
  favorites: new Set(),
  recent: [],
  planner: {},
  shopping: [],
  timers: stored(STORAGE.timers, []).filter((timer) => timer?.id && timer?.endAt),
  weekStart: startOfWeek(new Date()),
  suggestionOffset: 0,
  installPrompt: null,
  wakeLock: null,
  scanner: null,
  scannerHandled: false,
  pendingPlanRecipeId: null,
  started: false,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  addButton: $("#addButton"), addDialog: $("#addDialog"), clearFilters: $("#clearFilters"),
  cookConsole: $("#cookConsole"), cookModeButton: $("#cookModeButton"), cookStepBar: $("#cookStepBar"),
  detailFacts: $("#detailFacts"), detailImage: $("#detailImage"), detailKicker: $("#detailKicker"),
  detailSummary: $("#detailSummary"), detailTitle: $("#detailTitle"),
  editRecipeButton: $("#editRecipeButton"), deleteRecipeButton: $("#deleteRecipeButton"),
  recipeFormTitle: $("#recipeFormTitle"), recipeSubmit: $("#recipeSubmit"), quickFill: $("#quickFill"),
  offlineLine: $("#offlineLine"), heroNewLink: $("#heroNewLink"), heroNewCount: $("#heroNewCount"),
  newBadge: $("#newBadge"), newTitle: $("#newTitle"), newSummary: $("#newSummary"), newGrid: $("#newGrid"),
  newEmpty: $("#newEmpty"), profileButton: $("#profileButton"), profileInitials: $("#profileInitials"),
  profileName: $("#profileName"), personDialog: $("#personDialog"), shareDialog: $("#shareDialog"),
  emptyState: $("#emptyState"), favoriteButton: $("#favoriteButton"), filterRow: $("#filterRow"),
  formError: $("#formError"), heroFeature: $("#heroFeature"),
  heroImage: $("#heroImage"), heroRecipeMeta: $("#heroRecipeMeta"), heroRecipeTitle: $("#heroRecipeTitle"),
  ingredientList: $("#ingredientList"), installButton: $("#installButton"), installHelp: $("#installHelp"),
  leftoverNote: $("#leftoverNote"), recipeCount: $("#recipeCount"), recipeDialog: $("#recipeDialog"),
  recipeForm: $("#recipeForm"), recipeGrid: $("#recipeGrid"), recipeHistory: $("#recipeHistory"),
  recipeNotes: $("#recipeNotes"), searchInput: $("#searchInput"),
  settingsDialog: $("#settingsDialog"), sortSelect: $("#sortSelect"),
  stepList: $("#stepList"), toast: $("#toast"),
  servingsDown: $("#servingsDown"), servingsUp: $("#servingsUp"), servingsValue: $("#servingsValue"),
  logMadeButton: $("#logMadeButton"), madeDialog: $("#madeDialog"), madeForm: $("#madeForm"),
  madeDate: $("#madeDate"), madeRating: $("#madeRating"), madeError: $("#madeError"),
  madeRecipeTitle: $("#madeRecipeTitle"), ratingPicker: $("#ratingPicker"), deductStock: $("#deductStock"),
  addIngredientsButton: $("#addIngredientsButton"), planRecipeButton: $("#planRecipeButton"),
  shareRecipeButton: $("#shareRecipeButton"), printRecipeButton: $("#printRecipeButton"),
  viewAllHistoryButton: $("#viewAllHistoryButton"), finishCookingButton: $("#finishCookingButton"),
  quickTimerForm: $("#quickTimerForm"), timerNameInput: $("#timerNameInput"), timerMinutesInput: $("#timerMinutesInput"),
  suggestAgainButton: $("#suggestAgainButton"), stockBadge: $("#stockBadge"),
  shoppingBadge: $("#shoppingBadge"), stockSummary: $("#stockSummary"), stockGrid: $("#stockGrid"),
  stockEmpty: $("#stockEmpty"), stockSearch: $("#stockSearch"), stockFilters: $("#stockFilters"),
  addStockButton: $("#addStockButton"), scanStockButton: $("#scanStockButton"), stockDialog: $("#stockDialog"),
  stockForm: $("#stockForm"), stockDialogTitle: $("#stockDialogTitle"), stockError: $("#stockError"),
  deleteStockButton: $("#deleteStockButton"), lookupStatus: $("#lookupStatus"),
  lookupBarcodeButton: $("#lookupBarcodeButton"), scanFromFormButton: $("#scanFromFormButton"),
  scannerDialog: $("#scannerDialog"), barcodeReader: $("#barcodeReader"), scannerError: $("#scannerError"),
  manualBarcodeForm: $("#manualBarcodeForm"), manualBarcodeInput: $("#manualBarcodeInput"),
  plannerGrid: $("#plannerGrid"), weekTitle: $("#weekTitle"), previousWeekButton: $("#previousWeekButton"),
  nextWeekButton: $("#nextWeekButton"), thisWeekButton: $("#thisWeekButton"), planDialog: $("#planDialog"),
  planForm: $("#planForm"), planDate: $("#planDate"), planRecipeTitle: $("#planRecipeTitle"),
  planRecipeField: $("#planRecipeField"), planRecipeSelect: $("#planRecipeSelect"), planReplaces: $("#planReplaces"),
  historyStats: $("#historyStats"), historyList: $("#historyList"), historyEmpty: $("#historyEmpty"), historyHeading: $("#historyHeading"),
  shoppingForm: $("#shoppingForm"), shoppingInput: $("#shoppingInput"), shoppingList: $("#shoppingList"),
  shoppingEmpty: $("#shoppingEmpty"), clearCheckedButton: $("#clearCheckedButton"),
  timerButton: $("#timerButton"), timerCount: $("#timerCount"), timerDock: $("#timerDock"),
  timerList: $("#timerList"), closeTimerDock: $("#closeTimerDock"), dockTimerForm: $("#dockTimerForm"), timerDockHeading: $("#timerDockHeading"),
  dockTimerName: $("#dockTimerName"), dockTimerMinutes: $("#dockTimerMinutes"),
  exportBackupButton: $("#exportBackupButton"),
  cookPrevButton: $("#cookPrevButton"), cookNextButton: $("#cookNextButton"),
  cookStepLabel: $("#cookStepLabel"), cookStepTimer: $("#cookStepTimer"),
  importUrlInput: $("#importUrlInput"), importUrlButton: $("#importUrlButton"),
  pasteRecipeInput: $("#pasteRecipeInput"), parsePasteButton: $("#parsePasteButton"),
  quickFillError: $("#quickFillError"),
};

function totalMinutes(recipe) {
  return Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0);
}

function formatTime(minutes) {
  if (!minutes) return "Heat & serve";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  return dateFromKey(value).toLocaleDateString(undefined, options);
}

function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("visible"), 3200);
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* Storage can be full or blocked; the server copy still holds the data. */ }
}

function can(level) {
  const rank = { member: 1, editor: 2, admin: 3 }[state.me?.role] || 0;
  return rank >= ({ editor: 2, admin: 3 }[level] || 1);
}

// Favorites, meal plan and shopping list live in the person's profile on the server, with a
// copy on this device for offline use. A change made offline is kept and sent on the next save.
function profileSnapshot() {
  return { favorites: [...state.favorites], planner: state.planner, shopping: state.shopping };
}

function cacheProfile(dirtyFields = []) {
  const cached = stored(personKey("profile"), {});
  const dirty = new Set([...(cached.dirty || []), ...dirtyFields]);
  writeLocal(personKey("profile"), { ...profileSnapshot(), dirty: [...dirty] });
}

async function saveProfile(...fields) {
  cacheProfile(fields);
  const cached = stored(personKey("profile"), {});
  const send = [...new Set([...(cached.dirty || []), ...fields])];
  const snapshot = profileSnapshot();
  try {
    await api("/api/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(send.map((field) => [field, snapshot[field]]))) });
    writeLocal(personKey("profile"), { ...profileSnapshot(), dirty: [] });
  } catch (error) {
    if (error.status === 401) return;
    if (isOfflineError(error)) showToast("Saved on this device. It syncs when you are back online.");
    else showToast(error.message);
  }
}

function applyProfile(profile) {
  state.favorites = new Set(profile.favorites || []);
  state.planner = normalizePlanner(profile.planner);
  state.shopping = profile.shopping || [];
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveProfile("favorites");
  preserveFocus(() => { renderRecipes(); renderNew(); });
  renderStats();
  if (state.activeRecipe?.id === id) updateFavoriteButton();
}

function latestMade(recipeId) {
  return state.history.find((entry) => entry.recipeId === recipeId) || null;
}

function madeCount(recipeId) {
  return state.history.filter((entry) => entry.recipeId === recipeId).length;
}

function hashNumber(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function stockMatchCount(recipe) {
  const available = state.inventory.filter((item) => item.quantity > 0).map((item) => item.name.toLowerCase());
  return recipe.ingredients.reduce((matches, ingredient) => {
    const name = ingredient.item.toLowerCase();
    return matches + (available.some((item) => item.length > 2 && (name.includes(item) || item.includes(name))) ? 1 : 0);
  }, 0);
}

function recommendationScore(recipe) {
  const last = latestMade(recipe.id);
  const days = last ? Math.max(0, Math.floor((Date.now() - dateFromKey(last.madeAt)) / 86_400_000)) : 120;
  const quick = Math.max(0, 60 - totalMinutes(recipe)) / 8;
  const daily = hashNumber(`${dateKey(new Date())}:${recipe.id}`) % 17;
  return Math.min(days, 100) + stockMatchCount(recipe) * 16 + quick + daily - madeCount(recipe) * 2;
}

function suggestedRecipes() {
  return [...state.recipes].sort((a, b) => recommendationScore(b) - recommendationScore(a));
}

function filteredRecipes() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.recipes.filter((recipe) => {
    const searchable = [recipe.title, recipe.summary, recipe.mainIngredient, recipe.category, ...recipe.tags].join(" ").toLowerCase();
    const categoryMatch = !state.category
      || (state.category === "favorites" ? state.favorites.has(recipe.id) : recipe.category === state.category);
    return categoryMatch && (!query || searchable.includes(query));
  });
  return filtered.sort((a, b) => {
    if (state.sort === "title") return a.title.localeCompare(b.title);
    if (state.sort === "newest") return String(b.createdAt).localeCompare(String(a.createdAt)) || a.title.localeCompare(b.title);
    if (state.sort === "quick") return totalMinutes(a) - totalMinutes(b);
    if (state.sort === "recent") {
      const left = state.recent.indexOf(a.id);
      const right = state.recent.indexOf(b.id);
      return (left < 0 ? 999 : left) - (right < 0 ? 999 : right);
    }
    if (state.sort === "least-made") return madeCount(a.id) - madeCount(b.id) || a.title.localeCompare(b.title);
    return recommendationScore(b) - recommendationScore(a);
  });
}

function addedLabel(recipe) {
  const date = new Date(recipe.createdAt);
  return Number.isNaN(date.getTime()) ? "" : `Added ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

// The title is the card's button; the rest of the card is clickable through it, and the
// favorite heart is a separate button on top.
function createCard(recipe, index, { showAdded = false } = {}) {
  const card = document.createElement("article");
  card.className = "recipe-card";
  card.style.animationDelay = `${Math.min(index, 8) * 45}ms`;
  const photo = document.createElement("div");
  photo.className = "card-photo";
  const image = document.createElement("img");
  image.src = recipe.image;
  image.alt = "";
  image.loading = "lazy";
  const saved = state.favorites.has(recipe.id);
  const save = document.createElement("button");
  save.className = `card-save${saved ? " saved" : ""}`;
  save.type = "button";
  save.setAttribute("aria-pressed", String(saved));
  save.setAttribute("aria-label", `Favorite ${recipe.title}`);
  save.dataset.focusKey = `save:${recipe.id}`;
  save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.5 13A5 5 0 0 1 12 6.4 5 5 0 0 1 19.5 13Z"/></svg>';
  save.addEventListener("click", (event) => { event.stopPropagation(); toggleFavorite(recipe.id); });
  photo.append(image, save);

  const body = document.createElement("div");
  body.className = "card-body";
  const kicker = document.createElement("div");
  kicker.className = "card-kicker";
  const category = document.createElement("span");
  category.textContent = recipe.category;
  if (isAddedThisMonth(recipe)) {
    const tag = document.createElement("span");
    tag.className = "new-tag";
    tag.textContent = "New";
    category.append(" ", tag);
  }
  const metadata = document.createElement("span");
  const last = latestMade(recipe.id);
  metadata.textContent = showAdded ? addedLabel(recipe)
    : last ? `Made ${formatDate(last.madeAt, { month: "short", day: "numeric" })}`
      : `${formatTime(totalMinutes(recipe))}, serves ${recipe.servings}`;
  kicker.append(category, metadata);
  const heading = document.createElement("h3");
  const open = document.createElement("button");
  open.type = "button";
  open.className = "card-open";
  open.dataset.focusKey = `open:${recipe.id}`;
  open.textContent = recipe.title;
  open.addEventListener("click", () => openRecipe(recipe));
  heading.append(open);
  const summary = document.createElement("p");
  summary.textContent = recipe.summary;
  body.append(kicker, heading, summary);
  card.append(photo, body);
  return card;
}

// Category chips come from the recipes themselves, with counts, so no chip leads nowhere.
function renderFilters() {
  const counts = new Map();
  for (const recipe of state.recipes) counts.set(recipe.category, (counts.get(recipe.category) || 0) + 1);
  const categories = [...counts.keys()].sort((a, b) => (a === "Other") - (b === "Other") || a.localeCompare(b));
  if (state.category && state.category !== "favorites" && !counts.has(state.category)) state.category = "";
  const chip = (value, label, count) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter${state.category === value ? " active" : ""}`;
    button.dataset.category = value;
    button.dataset.focusKey = `chip:${value || "all"}`;
    button.setAttribute("aria-pressed", String(state.category === value));
    button.textContent = label;
    if (count !== undefined) {
      const number = document.createElement("span");
      number.className = "filter-count";
      number.textContent = count;
      button.append(" ", number);
    }
    return button;
  };
  elements.filterRow.replaceChildren(
    chip("", "All", state.recipes.length),
    ...categories.map((category) => chip(category, category, counts.get(category))),
    chip("favorites", "Favorites", state.favorites.size),
  );
}

function pressFilter(row, pressed) {
  row.querySelectorAll(".filter").forEach((filter) => {
    filter.classList.toggle("active", filter === pressed);
    filter.setAttribute("aria-pressed", String(filter === pressed));
  });
}

function renderRecipes() {
  renderFilters();
  const recipes = filteredRecipes();
  elements.recipeGrid.replaceChildren(...recipes.map((recipe, index) => createCard(recipe, index)));
  elements.emptyState.hidden = recipes.length > 0;
}

// The New view: recipes added this month, or the latest month that had additions.
function renderNew() {
  const result = newRecipes(state.recipes);
  const now = new Date();
  const month = monthLabel(result.monthKey, now);
  const thisMonthCount = result.isCurrentMonth ? result.recipes.length : 0;
  elements.newTitle.textContent = result.isCurrentMonth ? `New in ${month}` : `Added in ${month}`;
  elements.newSummary.textContent = !result.recipes.length
    ? "No recipes have been added yet."
    : result.isCurrentMonth
      ? `${result.recipes.length} recipe${result.recipes.length === 1 ? "" : "s"} added since ${month} 1, newest first.`
      : `Nothing new yet in ${monthLabel(monthKeyOf(now), now)}. These were the latest additions.`;
  elements.newGrid.replaceChildren(...result.recipes.map((recipe, index) => createCard(recipe, index, { showAdded: true })));
  elements.newEmpty.hidden = result.recipes.length > 0;
  elements.newBadge.hidden = thisMonthCount === 0;
  elements.newBadge.textContent = thisMonthCount;
  const newTab = document.querySelector('.view-tab[data-view="new"]');
  newTab.setAttribute("aria-label", thisMonthCount ? `New, ${thisMonthCount} added this month` : "New");
  elements.heroNewLink.hidden = thisMonthCount === 0;
  elements.heroNewCount.textContent = thisMonthCount;
}

function renderHero() {
  const choices = suggestedRecipes();
  const recipe = choices[state.suggestionOffset % Math.max(1, Math.min(choices.length, 8))];
  if (!recipe) return;
  elements.heroImage.src = recipe.image;
  elements.heroImage.alt = "";
  elements.heroRecipeTitle.textContent = recipe.title;
  const matches = stockMatchCount(recipe);
  elements.heroRecipeMeta.textContent = `${formatTime(totalMinutes(recipe))}, serves ${recipe.servings}${matches ? `, ${matches} from your Kitchen Stock` : ""}`;
  elements.heroFeature.setAttribute("aria-label", `Open tonight's suggestion: ${recipe.title}`);
  elements.heroFeature.onclick = () => openRecipe(recipe);
}

function fact(text) {
  const value = document.createElement("span");
  value.className = "fact";
  value.textContent = text;
  return value;
}

// Finds a cooking duration in a step ("roast for 25–30 minutes") and returns
// the lower-bound minutes plus a short label for a timer chip.
function parseStepDuration(step) {
  const text = String(step);
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:–|—|-|\bto\b)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i);
  const match = range || text.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[range ? 3 : 2].toLowerCase();
  let minutes = value;
  if (unit.startsWith("h")) minutes *= 60;
  else if (unit.startsWith("s")) minutes = Math.ceil(value / 60);
  minutes = Math.max(1, Math.min(600, Math.round(minutes)));
  const rawLabel = range && match[1] === match[2] ? `${match[1]} ${match[3]}` : match[0].trim();
  const label = rawLabel.replace(/hours?|hrs?/i, "hr").replace(/minutes?|mins?/i, "min").replace(/seconds?|secs?/i, "sec");
  return { minutes, label };
}

function renderIngredients() {
  const recipe = state.activeRecipe;
  if (!recipe) return;
  const ratio = state.servings / recipe.servings;
  elements.servingsValue.textContent = state.servings;
  elements.ingredientList.replaceChildren(...recipe.ingredients.map((ingredient, index) => {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `Mark ${ingredient.item} complete`);
    const amount = document.createElement("span");
    amount.className = "ingredient-amount";
    amount.textContent = scaleAmount(ingredient.amount, ratio);
    const name = document.createElement("span");
    name.className = "ingredient-name";
    name.textContent = ingredient.item;
    label.append(checkbox, amount, name);
    item.dataset.ingredientIndex = index;
    item.append(label);
    return item;
  }));
}

function renderDetailFacts() {
  const recipe = state.activeRecipe;
  if (!recipe) return;
  elements.detailFacts.replaceChildren(
    fact(formatTime(totalMinutes(recipe))),
    fact(`Prep ${recipe.prepMinutes || 0} min`),
    fact(`Serves ${recipe.servings}`),
    fact(madeFact(madeCount(recipe.id))),
  );
}

// The open recipe's journal: its facts (made count) and its last few entries.
function renderRecipeHistory() {
  renderDetailFacts();
  const entries = state.history.filter((entry) => entry.recipeId === state.activeRecipe?.id).slice(0, 3);
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "no-history";
    empty.textContent = "Not logged yet. Your notes and ratings will appear here.";
    elements.recipeHistory.replaceChildren(empty);
    return;
  }
  elements.recipeHistory.replaceChildren(...entries.map((entry) => {
    const row = document.createElement("div");
    row.className = "mini-history";
    const date = document.createElement("time");
    date.textContent = formatDate(entry.madeAt, { month: "short", day: "numeric" });
    const note = document.createElement("span");
    note.textContent = entry.notes || "Made without a note.";
    const stars = document.createElement("span");
    stars.className = "stars";
    stars.textContent = entry.rating ? GLYPH.star.repeat(entry.rating) : "Not rated";
    if (entry.rating) stars.setAttribute("aria-label", `${entry.rating} of 5 stars`);
    row.append(date, note, stars);
    return row;
  }));
}

function updateFavoriteButton() {
  const saved = Boolean(state.activeRecipe && state.favorites.has(state.activeRecipe.id));
  elements.favoriteButton.textContent = saved ? "Favorited" : "Favorite";
  elements.favoriteButton.setAttribute("aria-pressed", String(saved));
}

function madeFact(count) {
  if (!count) return "Not made yet";
  return count === 1 ? "Made once" : `Made ${count} times`;
}

function openRecipe(recipe, updateHash = true) {
  state.activeRecipe = recipe;
  state.cookStep = 0;
  state.servings = recipe.servings;
  state.recent = [recipe.id, ...state.recent.filter((id) => id !== recipe.id)].slice(0, 30);
  writeLocal(personKey("recent"), state.recent);
  elements.detailImage.src = recipe.image;
  elements.detailImage.alt = "";
  elements.detailKicker.textContent = [recipe.category, recipe.mainIngredient].filter(Boolean).join(", ");
  elements.detailTitle.textContent = recipe.title;
  elements.detailSummary.textContent = recipe.summary;
  renderDetailFacts();
  elements.editRecipeButton.hidden = !can("editor");
  renderIngredients();
  elements.stepList.replaceChildren(...recipe.steps.map((step, index) => {
    const item = document.createElement("li");
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const text = document.createElement("span");
    text.textContent = step;
    label.append(checkbox, text);
    item.append(label);
    const timer = parseStepDuration(step);
    if (timer) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "step-timer-chip";
      chip.textContent = `${GLYPH.timer} ${timer.label}`;
      chip.setAttribute("aria-label", `Start a ${timer.label} timer for step ${index + 1}`);
      chip.addEventListener("click", () => startTimer(`${recipe.title}, step ${index + 1}`, timer.minutes));
      item.append(chip);
    }
    return item;
  }));
  elements.leftoverNote.textContent = recipe.leftoverNote || "Pack the extra portion once it has cooled.";
  elements.recipeNotes.replaceChildren(...(recipe.notes || []).map((note) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = note;
    return paragraph;
  }));
  renderRecipeHistory();
  updateFavoriteButton();
  elements.recipeDialog.classList.remove("cook-mode");
  elements.cookConsole.hidden = true;
  elements.cookStepBar.hidden = true;
  elements.cookModeButton.textContent = "Start Cook Mode";
  elements.timerNameInput.value = `${recipe.title} timer`;
  elements.timerMinutesInput.value = Math.max(1, recipe.cookMinutes || 10);
  if (!elements.recipeDialog.open) elements.recipeDialog.showModal();
  if (updateHash) history.replaceState(null, "", `#recipe=${encodeURIComponent(recipe.id)}`);
}

async function toggleCookMode() {
  const enabled = elements.recipeDialog.classList.toggle("cook-mode");
  elements.cookConsole.hidden = !enabled;
  elements.cookStepBar.hidden = !enabled;
  elements.cookModeButton.textContent = enabled ? "Leave Cook Mode" : "Start Cook Mode";
  if (enabled) {
    const boxes = [...elements.stepList.querySelectorAll("input")];
    const firstUnchecked = boxes.findIndex((box) => !box.checked);
    state.cookStep = firstUnchecked === -1 ? 0 : firstUnchecked;
    updateCookStepUI();
  } else {
    [...elements.stepList.children].forEach((item) => item.classList.remove("current"));
  }
  if (enabled && "wakeLock" in navigator) {
    try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* Wake lock is optional. */ }
  } else if (state.wakeLock) {
    await state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

function updateCookStepUI() {
  const recipe = state.activeRecipe;
  if (!recipe) return;
  const total = recipe.steps.length;
  state.cookStep = Math.max(0, Math.min(state.cookStep, total - 1));
  elements.cookStepLabel.textContent = `Step ${state.cookStep + 1} of ${total}`;
  const timer = parseStepDuration(recipe.steps[state.cookStep] || "");
  elements.cookStepTimer.hidden = !timer;
  if (timer) {
    elements.cookStepTimer.textContent = `${GLYPH.timer} ${timer.label}`;
    elements.cookStepTimer.setAttribute("aria-label", `Start a ${timer.label} timer for step ${state.cookStep + 1}`);
    elements.cookStepTimer.onclick = () => startTimer(`${recipe.title}, step ${state.cookStep + 1}`, timer.minutes);
  }
  elements.cookPrevButton.disabled = state.cookStep === 0;
  elements.cookNextButton.textContent = state.cookStep === total - 1 ? `Finish ${GLYPH.check}` : `Next step ${GLYPH.right}`;
  const items = [...elements.stepList.children];
  items.forEach((item, index) => {
    item.classList.toggle("current", index === state.cookStep);
    const box = item.querySelector("input");
    if (box && index < state.cookStep) box.checked = true;
  });
  items[state.cookStep]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function moveCookStep(delta) {
  const recipe = state.activeRecipe;
  if (!recipe) return;
  if (delta > 0 && state.cookStep === recipe.steps.length - 1) {
    closeDialog(elements.recipeDialog);
    openMadeDialog();
    return;
  }
  state.cookStep = Math.max(0, Math.min(state.cookStep + delta, recipe.steps.length - 1));
  updateCookStepUI();
}

function openMadeDialog() {
  if (!state.activeRecipe) return;
  state.rating = 0;
  elements.madeForm.reset();
  elements.madeDate.value = dateKey(new Date());
  elements.madeRating.value = "0";
  elements.madeRecipeTitle.textContent = state.activeRecipe.title;
  elements.madeError.textContent = "";
  updateRatingPicker();
  elements.madeDialog.showModal();
}

function updateRatingPicker() {
  elements.ratingPicker.querySelectorAll("button").forEach((button) => {
    const value = Number(button.dataset.rating);
    button.classList.toggle("active", value <= state.rating);
    button.textContent = value <= state.rating ? GLYPH.star : GLYPH.starOutline;
    button.setAttribute("aria-pressed", String(value === state.rating));
    button.setAttribute("aria-label", `${value} star${value === 1 ? "" : "s"}`);
  });
}

async function deductMatchingStock(recipe) {
  const ingredients = recipe.ingredients.map((ingredient) => ingredient.item.toLowerCase());
  const matches = state.inventory.filter((stock) => stock.quantity > 0 && stock.name.length > 2 && ingredients.some((ingredient) => {
    const name = stock.name.toLowerCase();
    return ingredient.includes(name) || name.includes(ingredient);
  }));
  await Promise.all(matches.map((item) => api(`/api/inventory/${encodeURIComponent(item.id)}/adjust`, {
    method: "POST", body: JSON.stringify({ delta: -1 }),
  })));
  if (matches.length) await loadInventory();
  return matches.length;
}

async function submitMade(event) {
  event.preventDefault();
  elements.madeError.textContent = "";
  const form = new FormData(elements.madeForm);
  try {
    const payload = await api("/api/history", {
      method: "POST",
      body: JSON.stringify({ recipeId: state.activeRecipe.id, madeAt: form.get("madeAt"), rating: state.rating, notes: form.get("notes") }),
    });
    state.history.unshift(payload.entry);
    writeLocal(personKey("history-cache"), state.history);
    const deducted = elements.deductStock.checked ? await deductMatchingStock(state.activeRecipe) : 0;
    elements.madeDialog.close();
    renderRecipeHistory();
    renderRecipes();
    renderNew();
    renderHero();
    renderStats();
    renderHistory();
    showToast(`Saved to your journal${deducted ? ` and used ${deducted} Kitchen Stock item${deducted === 1 ? "" : "s"}` : ""}.`);
  } catch (error) {
    elements.madeError.textContent = error.message;
  }
}

function addRecipeToShopping(recipe) {
  const ratio = state.servings / recipe.servings;
  const existing = new Set(state.shopping.filter((item) => !item.checked).map((item) => item.text.toLowerCase()));
  let added = 0;
  for (const ingredient of recipe.ingredients) {
    const text = `${scaleAmount(ingredient.amount, ratio)} ${ingredient.item}`.trim();
    if (existing.has(text.toLowerCase())) continue;
    state.shopping.push({ id: uid(), text, checked: false, source: recipe.title });
    existing.add(text.toLowerCase());
    added += 1;
  }
  saveProfile("shopping");
  renderShopping();
  showToast(added ? `${added} ingredient${added === 1 ? "" : "s"} added to the shopping list.` : "Those ingredients are already on the shopping list.");
}

function renderShopping() {
  elements.shoppingList.replaceChildren(...state.shopping.map((shoppingItem) => {
    const row = document.createElement("label");
    row.className = `shopping-item${shoppingItem.checked ? " checked" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = shoppingItem.checked;
    checkbox.dataset.focusKey = `shop:${shoppingItem.id}`;
    checkbox.addEventListener("change", () => {
      shoppingItem.checked = checkbox.checked;
      saveProfile("shopping");
      preserveFocus(renderShopping);
    });
    const copy = document.createElement("span");
    copy.textContent = shoppingItem.text;
    if (shoppingItem.source) {
      const source = document.createElement("small");
      source.className = "shopping-source";
      source.textContent = shoppingItem.source;
      copy.append(document.createElement("br"), source);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = GLYPH.times;
    remove.setAttribute("aria-label", `Remove ${shoppingItem.text}`);
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      const index = state.shopping.findIndex((item) => item.id === shoppingItem.id);
      state.shopping = state.shopping.filter((item) => item.id !== shoppingItem.id);
      saveProfile("shopping");
      renderShopping();
      const next = elements.shoppingList.querySelectorAll(".remove-button")[Math.min(index, state.shopping.length - 1)];
      (next || elements.shoppingInput).focus();
    });
    row.append(checkbox, copy, remove);
    return row;
  }));
  elements.shoppingEmpty.hidden = state.shopping.length > 0;
  renderStats();
}

// Tab badges: only numbers that ask for attention, and none at zero.
function setBadge(badge, view, count, label) {
  badge.hidden = !count;
  badge.textContent = count;
  const tab = document.querySelector(`.view-tab[data-view="${view}"]`);
  const name = tab.firstChild.textContent.trim();
  tab.setAttribute("aria-label", count ? `${name}, ${count} ${label}` : name);
}

function renderStats() {
  setBadge(elements.shoppingBadge, "shopping", state.shopping.filter((item) => !item.checked).length, "to buy");
  setBadge(elements.stockBadge, "stock", state.inventory.filter((item) => item.quantity <= item.lowAt).length, "low or out");
}

function chosenMeal() {
  return elements.planForm.querySelector('input[name="meal"]:checked')?.value || "dinner";
}

// Recipes that suit the meal come first, under their own heading.
function fillPlanRecipes(meal) {
  const chosen = elements.planRecipeSelect.value;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a recipe";
  const group = (label, recipes) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = label;
    optgroup.append(...recipes.map((recipe) => {
      const option = document.createElement("option");
      option.value = recipe.id;
      option.textContent = recipe.title;
      return option;
    }));
    return optgroup;
  };
  const sorted = [...state.recipes].sort((a, b) => a.title.localeCompare(b.title));
  const suits = sorted.filter((recipe) => suggestedMeal(recipe) === meal);
  const others = sorted.filter((recipe) => suggestedMeal(recipe) !== meal);
  elements.planRecipeSelect.replaceChildren(placeholder, ...[
    suits.length ? group(`${mealLabel(meal)} recipes`, suits) : null,
    others.length ? group(suits.length ? "Other recipes" : "All recipes", others) : null,
  ].filter(Boolean));
  elements.planRecipeSelect.value = chosen;
}

function updatePlanReplaces() {
  const recipeId = state.pendingPlanRecipeId || elements.planRecipeSelect.value;
  const current = mealsOf(state.planner[elements.planDate.value])[chosenMeal()];
  const recipe = current && current !== recipeId ? state.recipes.find((item) => item.id === current) : null;
  elements.planReplaces.hidden = !recipe;
  elements.planReplaces.textContent = recipe ? `Replaces ${recipe.title}.` : "";
}

function openPlanDialog(recipe = null, date = dateKey(new Date()), meal = suggestedMeal(recipe)) {
  state.pendingPlanRecipeId = recipe?.id || null;
  elements.planDate.value = date;
  for (const input of elements.planForm.querySelectorAll('input[name="meal"]')) input.checked = input.value === meal;
  elements.planRecipeSelect.value = "";
  fillPlanRecipes(meal);
  elements.planRecipeField.hidden = Boolean(recipe);
  elements.planRecipeSelect.required = !recipe;
  elements.planRecipeTitle.textContent = recipe ? recipe.title : "Choose a recipe, a day and a meal.";
  updatePlanReplaces();
  elements.planDialog.showModal();
}

function longDay(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// "November 16-22, 2026", or "Nov 30 - Dec 6, 2026" across a month boundary.
function weekRangeLabel(start, end) {
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString(undefined, { month: "long" })} ${start.getDate()}-${end.getDate()}, ${end.getFullYear()}`;
  }
  const short = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString(undefined, short)} - ${end.toLocaleDateString(undefined, short)}, ${end.getFullYear()}`;
}

function mealSlot(key, meal, recipeId) {
  const slot = document.createElement("div");
  slot.className = "meal-slot";
  slot.dataset.meal = meal.id;
  const recipe = recipeId ? state.recipes.find((item) => item.id === recipeId) : null;
  const where = `${meal.label.toLowerCase()} on ${longDay(key)}`;
  if (!recipe) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "meal-add";
    add.textContent = `+ ${meal.label}`;
    add.setAttribute("aria-label", `Choose a recipe for ${where}`);
    add.dataset.focusKey = `plan-add:${key}:${meal.id}`;
    add.addEventListener("click", () => openPlanDialog(null, key, meal.id));
    slot.append(add);
    return slot;
  }
  const open = document.createElement("button");
  open.type = "button";
  open.className = "meal-open";
  const name = document.createElement("span");
  name.className = "meal-name";
  name.textContent = meal.label;
  const title = document.createElement("span");
  title.className = "meal-title";
  title.textContent = recipe.title;
  open.append(name, title);
  open.setAttribute("aria-label", `Open ${recipe.title}, ${where}`);
  open.dataset.focusKey = `plan-open:${key}:${meal.id}`;
  open.addEventListener("click", () => openRecipe(recipe));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "meal-remove";
  remove.textContent = GLYPH.times;
  remove.setAttribute("aria-label", `Remove ${recipe.title} from ${where}`);
  remove.dataset.focusKey = `plan-remove:${key}:${meal.id}`;
  remove.addEventListener("click", () => {
    state.planner = removeMeal(state.planner, key, meal.id);
    saveProfile("planner");
    preserveFocus(renderPlanner);
    renderStats();
  });
  slot.append(open, remove);
  return slot;
}

function renderPlanner() {
  const start = state.weekStart;
  const end = addDays(start, 6);
  const today = dateKey(new Date());
  elements.weekTitle.textContent = weekRangeLabel(start, end);
  elements.plannerGrid.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const planned = mealsOf(state.planner[key]);
    const day = document.createElement("article");
    day.className = `planner-day${key === today ? " today" : ""}`;
    const header = document.createElement("header");
    const name = document.createElement("h3");
    name.textContent = date.toLocaleDateString(undefined, { weekday: "short" });
    const number = document.createElement("time");
    number.dateTime = key;
    number.textContent = date.getDate();
    header.append(name, number);
    day.append(header, ...MEALS.map((meal) => mealSlot(key, meal, planned[meal.id])));
    return day;
  }));
}

function renderHistory() {
  const tried = new Set(state.history.map((entry) => entry.recipeId)).size;
  const ratings = state.history.filter((entry) => entry.rating).map((entry) => entry.rating);
  const average = ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : "None yet";
  const last30 = state.history.filter((entry) => Date.now() - dateFromKey(entry.madeAt) <= 30 * 86_400_000).length;
  const repeat = state.history.length - tried;
  elements.historyStats.replaceChildren(
    statBlock(state.history.length, "meals logged"), statBlock(tried, "recipes tried"),
    statBlock(average, "average rating"), statBlock(last30 || repeat, last30 ? "made in 30 days" : "repeat meals"),
  );
  elements.historyList.replaceChildren(...state.history.map((entry) => {
    const row = document.createElement("article");
    row.className = "history-entry";
    const date = document.createElement("time");
    date.className = "history-date";
    date.dateTime = entry.madeAt;
    date.textContent = formatDate(entry.madeAt, { month: "short", day: "numeric", year: "numeric" });
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = entry.recipeTitle;
    const stars = document.createElement("span");
    stars.className = "stars";
    stars.textContent = entry.rating ? `${GLYPH.star.repeat(entry.rating)}${GLYPH.starOutline.repeat(5 - entry.rating)}` : "Not rated";
    if (entry.rating) stars.setAttribute("aria-label", `${entry.rating} of 5 stars`);
    copy.append(title, stars);
    if (entry.notes) { const note = document.createElement("p"); note.textContent = entry.notes; copy.append(note); }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button-quiet history-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${entry.recipeTitle} from ${formatDate(entry.madeAt)}`);
    remove.addEventListener("click", () => removeHistoryEntry(entry));
    row.append(date, copy, remove);
    return row;
  }));
  elements.historyEmpty.hidden = state.history.length > 0;
}

function statBlock(value, label) {
  const block = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  block.append(strong, span);
  return block;
}

async function removeHistoryEntry(entry) {
  if (!confirm(`Remove the ${entry.recipeTitle} journal entry from ${formatDate(entry.madeAt)}?`)) return;
  try {
    await api(`/api/history/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    const index = state.history.findIndex((item) => item.id === entry.id);
    state.history = state.history.filter((item) => item.id !== entry.id);
    writeLocal(personKey("history-cache"), state.history);
    renderHistory(); renderStats(); renderRecipes(); renderNew(); renderHero();
    // The button that was pressed is gone: keep the keyboard on the list.
    const buttons = elements.historyList.querySelectorAll(".history-entry button");
    (buttons[index] || buttons[index - 1] || elements.historyHeading).focus();
    showToast("Removed from your journal.");
  } catch (error) { showToast(error.message); }
}

function filteredInventory() {
  const query = state.stockQuery.trim().toLowerCase();
  return state.inventory.filter((item) => {
    const matchesQuery = !query || [item.name, item.brand, item.barcode, item.category].join(" ").toLowerCase().includes(query);
    const matchesLocation = !state.stockLocation || item.location === state.stockLocation;
    const matchesLow = !state.stockLowOnly || item.quantity <= item.lowAt;
    return matchesQuery && matchesLocation && matchesLow;
  });
}

function renderStock() {
  const available = state.inventory.filter((item) => item.quantity > 0);
  const low = state.inventory.filter((item) => item.quantity <= item.lowAt);
  const expiring = state.inventory.filter((item) => item.expirationDate && dateFromKey(item.expirationDate) - Date.now() <= 7 * 86_400_000 && dateFromKey(item.expirationDate) >= Date.now() - 86_400_000);
  elements.stockSummary.replaceChildren(
    statBlock(available.length, "items on hand"),
    statBlock(state.inventory.filter((item) => item.location === "Fridge" && item.quantity > 0).length, "in the fridge"),
    statBlock(state.inventory.filter((item) => item.location === "Pantry" && item.quantity > 0).length, "in the pantry"),
    statBlock(low.length || expiring.length, low.length ? "low or out" : "expiring soon"),
  );
  const items = filteredInventory();
  elements.stockGrid.replaceChildren(...items.map((item) => {
    const card = document.createElement("article");
    card.className = `stock-card${item.quantity <= item.lowAt ? " low" : ""}`;
    const initial = document.createElement("span");
    initial.className = "stock-initial";
    initial.textContent = item.name.charAt(0).toUpperCase();
    const copy = document.createElement("div");
    copy.className = "stock-copy";
    const place = document.createElement("small");
    place.textContent = `${item.location}${item.barcode ? `, ${item.barcode}` : ""}`;
    const title = document.createElement("h3");
    title.textContent = item.name;
    const detail = document.createElement("p");
    detail.textContent = [item.brand, item.expirationDate ? `Best by ${formatDate(item.expirationDate, { month: "short", day: "numeric" })}` : ""].filter(Boolean).join(", ") || "No extra details";
    copy.append(place, title, detail);
    const controls = document.createElement("div");
    controls.className = "quantity-control";
    const minus = document.createElement("button");
    minus.type = "button"; minus.textContent = GLYPH.minus; minus.setAttribute("aria-label", `Use one ${item.unit} of ${item.name}`);
    minus.dataset.focusKey = `stock-minus:${item.id}`;
    minus.addEventListener("click", () => adjustStock(item, -1));
    const quantity = document.createElement("strong");
    quantity.className = item.quantity <= item.lowAt ? "low-label" : "";
    quantity.textContent = `${item.quantity} ${item.unit}${item.quantity === 1 ? "" : item.unit === "item" ? "s" : ""}`;
    const plus = document.createElement("button");
    plus.type = "button"; plus.textContent = "+"; plus.setAttribute("aria-label", `Add one ${item.unit} of ${item.name}`);
    plus.dataset.focusKey = `stock-plus:${item.id}`;
    plus.addEventListener("click", () => adjustStock(item, 1));
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "edit-stock"; edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${item.name}`);
    edit.dataset.focusKey = `stock-edit:${item.id}`;
    edit.addEventListener("click", () => openStockDialog(item));
    controls.append(minus, quantity, plus, edit);
    card.append(initial, copy, controls);
    return card;
  }));
  elements.stockEmpty.hidden = items.length > 0;
  const filtered = state.inventory.length > 0;
  elements.stockEmpty.querySelector("span").textContent = filtered ? "Nothing matches." : "Nothing recorded here yet.";
  elements.stockEmpty.querySelector("p").textContent = filtered ? "Try another word or filter." : "Scan a barcode or add an item by hand.";
  renderStats();
}

async function adjustStock(item, delta) {
  try {
    const payload = await api(`/api/inventory/${encodeURIComponent(item.id)}/adjust`, { method: "POST", body: JSON.stringify({ delta }) });
    const index = state.inventory.findIndex((candidate) => candidate.id === item.id);
    state.inventory[index] = payload.item;
    writeLocal(personKey("inventory-cache"), state.inventory);
    preserveFocus(renderStock); renderHero();
  } catch (error) { showToast(error.message); }
}

function openStockDialog(item = null) {
  elements.stockForm.reset();
  elements.stockForm.elements.id.value = item?.id || "";
  elements.stockDialogTitle.textContent = item ? "Edit item" : "Add an item";
  elements.deleteStockButton.hidden = !item;
  elements.lookupStatus.textContent = "";
  elements.stockError.textContent = "";
  if (item) {
    for (const name of ["barcode", "name", "brand", "category", "quantity", "unit", "location", "lowAt", "expirationDate", "notes"]) {
      elements.stockForm.elements[name].value = item[name] ?? "";
    }
  } else {
    elements.stockForm.elements.quantity.value = "1";
    elements.stockForm.elements.unit.value = "item";
    elements.stockForm.elements.location.value = "Pantry";
    elements.stockForm.elements.lowAt.value = "0";
  }
  if (!elements.stockDialog.open) elements.stockDialog.showModal();
}

async function submitStock(event) {
  event.preventDefault();
  const form = new FormData(elements.stockForm);
  const id = String(form.get("id") || "");
  const item = Object.fromEntries(form.entries());
  delete item.id;
  item.quantity = Number(item.quantity);
  item.lowAt = Number(item.lowAt);
  elements.stockError.textContent = "";
  try {
    const payload = await api(id ? `/api/inventory/${encodeURIComponent(id)}` : "/api/inventory", {
      method: id ? "PUT" : "POST", body: JSON.stringify(item),
    });
    const saved = payload.item;
    const index = state.inventory.findIndex((candidate) => candidate.id === saved.id);
    if (index >= 0) state.inventory[index] = saved;
    else state.inventory.push(saved);
    writeLocal(personKey("inventory-cache"), state.inventory);
    elements.stockDialog.close();
    preserveFocus(renderStock); renderHero();
    showToast(payload.merged ? `Added to the existing ${saved.name} quantity.` : `${saved.name} saved to Kitchen Stock.`);
  } catch (error) { elements.stockError.textContent = error.message; }
}

async function deleteStock() {
  const id = elements.stockForm.elements.id.value;
  const item = state.inventory.find((candidate) => candidate.id === id);
  if (!item || !confirm(`Delete ${item.name} from Kitchen Stock?`)) return;
  try {
    await api(`/api/inventory/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.inventory = state.inventory.filter((candidate) => candidate.id !== id);
    writeLocal(personKey("inventory-cache"), state.inventory);
    elements.stockDialog.close();
    preserveFocus(renderStock); renderHero();
    showToast(`${item.name} deleted from Kitchen Stock.`);
  } catch (error) { elements.stockError.textContent = error.message; }
}

async function lookupBarcode(barcode, openForm = true) {
  const code = String(barcode || "").replace(/\s/g, "");
  if (openForm) openStockDialog();
  elements.stockForm.elements.barcode.value = code;
  elements.lookupStatus.textContent = `Looking up product${GLYPH.ellipsis}`;
  try {
    const product = await api(`/api/products/${encodeURIComponent(code)}`);
    if (product.found) {
      elements.stockForm.elements.name.value = product.name || elements.stockForm.elements.name.value;
      elements.stockForm.elements.brand.value = product.brand || "";
      elements.stockForm.elements.category.value = product.category || "";
      elements.lookupStatus.textContent = `Found on ${product.source}${product.packageQuantity ? `, ${product.packageQuantity}` : ""}.`;
      elements.stockForm.elements.quantity.focus();
    } else {
      elements.lookupStatus.textContent = "No product match found. Enter the item name manually.";
      elements.stockForm.elements.name.focus();
    }
  } catch (error) {
    elements.lookupStatus.textContent = `${error.message} Enter the item name manually.`;
    elements.stockForm.elements.name.focus();
  }
}

async function clearScanner() {
  if (state.scanner) {
    await state.scanner.clear().catch(() => {});
    state.scanner = null;
  }
  elements.barcodeReader.replaceChildren();
}

function openScanner() {
  elements.scannerError.textContent = "";
  elements.manualBarcodeInput.value = "";
  state.scannerHandled = false;
  elements.scannerDialog.showModal();
  if (!window.isSecureContext) elements.scannerError.textContent = "Live camera access needs HTTPS or localhost; photo upload and manual entry still work.";
  const Scanner = window.Html5QrcodeScanner;
  if (!Scanner) {
    elements.scannerError.textContent = "The scanner did not load. Type the barcode below.";
    return;
  }
  const formats = window.Html5QrcodeSupportedFormats;
  const formatsToSupport = formats ? [formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E, formats.CODE_128] : undefined;
  state.scanner = new Scanner("barcodeReader", {
    fps: 10,
    qrbox: { width: 280, height: 150 },
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true,
    formatsToSupport,
  }, false);
  state.scanner.render(async (decodedText) => {
    if (state.scannerHandled) return;
    state.scannerHandled = true;
    await clearScanner();
    elements.scannerDialog.close();
    await lookupBarcode(decodedText, true);
  }, () => {});
}

function renderHistoryAndStockAfterLoad() {
  renderHistory(); renderStock(); renderPlanner(); renderShopping(); renderStats();
}

const VIEWS = ["recipes", "new", "planner", "shopping", "stock", "history"];

function switchView(name, updateHash = true) {
  if (!VIEWS.includes(name)) name = "recipes";
  document.querySelectorAll("[data-app-view]").forEach((view) => {
    const active = view.dataset.appView === name;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle("active", active);
    if (active) {
      tab.setAttribute("aria-current", "page");
      tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else tab.removeAttribute("aria-current");
  });
  if (name === "new") renderNew();
  if (name === "stock") renderStock();
  if (name === "history") renderHistory();
  if (name === "planner") renderPlanner();
  if (name === "shopping") renderShopping();
  // A control in the view that was just hidden (the hero's "new this month" link) leaves focus
  // on nothing; give it to the new view's heading instead.
  const focused = document.activeElement;
  if (!focused || focused === document.body || !focused.offsetParent) {
    const heading = document.querySelector(`[data-app-view="${name}"] h1`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
  if (updateHash) history.replaceState(null, "", name === "recipes" ? location.pathname : `#view=${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

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

const FRACTION_CHARS = {
  "¼": "1/4", "½": "1/2", "¾": "3/4", "⅐": "1/7", "⅑": "1/9", "⅒": "1/10",
  "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

const RECIPE_META_PATTERN = /^(prep(?:aration)?(?:\s*time)?|cook(?:ing)?(?:\s*time)?|bake(?:\s*time)?|total(?:\s*time)?|serves|servings?|yield|makes)\b\s*:?\s*(.*)$/i;

function normalizeFractions(text) {
  return String(text).replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (char) => ` ${FRACTION_CHARS[char]}`).replace(/\s+/g, " ").trim();
}

// Turns "1 1/2 cups long-grain rice" into { amount: "1 1/2 cups", item: "long-grain rice" }.
function parseIngredientLine(line) {
  const text = normalizeFractions(String(line || "").replace(/^[-•*·▪◦]\s*/, ""));
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

// Best-effort parse of a whole pasted recipe into form-ready fields. Handles
// both sectioned text ("Ingredients:" / "Instructions:") and free-form pastes.
function parsePastedRecipe(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/^[\s\-–—•*·▪◦]+/, "").trim());
  const recipe = { title: "", summary: "", prepMinutes: 0, cookMinutes: 0, servings: 0, ingredients: [], steps: [] };
  let section = "intro";
  let totalMinutes = 0;
  const summaryParts = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^(ingredients?|what you need|you will need)\s*:?$/i.test(line)) { section = "ingredients"; continue; }
    if (/^(instructions?|directions?|method|preparation|steps?|what to do)\s*:?$/i.test(line)) { section = "steps"; continue; }
    const meta = line.match(RECIPE_META_PATTERN);
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
    const body = lines.filter((line) => line && !RECIPE_META_PATTERN.test(line));
    recipe.title = body.shift() || recipe.title;
    for (const line of body) {
      if (/^[\d¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(line) && line.length <= 140) recipe.ingredients.push(line);
      else recipe.steps.push(cleanStepLine(line));
    }
    return { ...recipe, summary: "" };
  }
  return { ...recipe, summary: summaryParts.join(" ").slice(0, 600) };
}

function fillRecipeForm(recipe) {
  const form = elements.recipeForm;
  const known = [...new Set([...state.recipes.map((item) => item.category), ...[...document.querySelectorAll("#categoryOptions option")].map((option) => option.value)])];
  const category = String(recipe.category || "").trim();
  form.elements.title.value = recipe.title || "";
  form.elements.summary.value = recipe.summary || "";
  form.elements.mainIngredient.value = recipe.mainIngredient || "";
  form.elements.category.value = known.find((option) => option.toLowerCase() === category.toLowerCase()) || category || "Other";
  form.elements.prepMinutes.value = recipe.prepMinutes || 0;
  form.elements.cookMinutes.value = recipe.cookMinutes || 0;
  form.elements.servings.value = recipe.servings || 3;
  form.elements.tags.value = (recipe.tags || []).join(", ");
  form.elements.ingredients.value = (recipe.ingredients || []).map((ingredient) => {
    const parsed = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
    return parsed ? `${parsed.amount} | ${parsed.item}`.replace(/^ \| /, "") : "";
  }).filter(Boolean).join("\n");
  form.elements.steps.value = (recipe.steps || []).join("\n");
}

function handleParsePaste() {
  elements.quickFillError.textContent = "";
  const parsed = parsePastedRecipe(elements.pasteRecipeInput.value);
  if (!parsed.ingredients.length || !parsed.steps.length) {
    elements.quickFillError.textContent = "Could not find ingredients and steps in that text. Include an Ingredients and an Instructions section.";
    return;
  }
  fillRecipeForm(parsed);
  showToast("Form filled. Check it below, then save.");
}

async function handleImportUrl() {
  const target = elements.importUrlInput.value.trim();
  elements.quickFillError.textContent = "";
  if (!target) {
    elements.quickFillError.textContent = "Paste a recipe URL first.";
    return;
  }
  elements.importUrlButton.disabled = true;
  elements.importUrlButton.textContent = `Importing${GLYPH.ellipsis}`;
  try {
    const payload = await api(`/api/recipes/import?url=${encodeURIComponent(target)}`);
    fillRecipeForm(payload.recipe);
    showToast(`Imported from ${payload.recipe.source}. Check it below, then save.`);
  } catch (error) {
    elements.quickFillError.textContent = error.message;
  } finally {
    elements.importUrlButton.disabled = false;
    elements.importUrlButton.textContent = "Import";
  }
}

function recipeFromForm(form) {
  const data = new FormData(form);
  return {
    title: data.get("title"), summary: data.get("summary"), mainIngredient: data.get("mainIngredient"),
    category: data.get("category"), prepMinutes: Number(data.get("prepMinutes")),
    cookMinutes: Number(data.get("cookMinutes")), servings: Number(data.get("servings")),
    tags: String(data.get("tags")).split(",").map((tag) => tag.trim()).filter(Boolean),
    ingredients: String(data.get("ingredients")).split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [amount, ...rest] = line.split("|");
      return rest.length ? { amount: amount.trim(), item: rest.join("|").trim() } : { amount: "", item: amount };
    }),
    steps: String(data.get("steps")).split("\n").map((step) => step.trim()).filter(Boolean),
    leftoverNote: data.get("leftoverNote"),
  };
}

// One form adds a recipe or edits an existing one (editors and admins only).
function openRecipeForm(recipe = null) {
  if (!can("editor")) return;
  state.editingRecipeId = recipe?.id || null;
  elements.recipeForm.reset();
  elements.formError.textContent = "";
  elements.quickFillError.textContent = "";
  elements.recipeFormTitle.textContent = recipe ? "Edit recipe" : "Add a recipe";
  elements.recipeSubmit.textContent = recipe ? "Save changes" : "Add recipe";
  elements.deleteRecipeButton.hidden = !recipe;
  elements.quickFill.hidden = Boolean(recipe);
  elements.quickFill.open = !recipe;
  if (recipe) {
    fillRecipeForm(recipe);
    elements.recipeForm.elements.leftoverNote.value = recipe.leftoverNote || "";
  }
  elements.addDialog.showModal();
}

function replaceRecipe(saved) {
  const index = state.recipes.findIndex((item) => item.id === saved.id);
  if (index >= 0) state.recipes[index] = saved;
  else state.recipes.unshift(saved);
  writeLocal(STORAGE.recipeCache, state.recipes);
}

async function submitRecipe(event) {
  event.preventDefault();
  elements.formError.textContent = "";
  const editing = state.editingRecipeId;
  try {
    const payload = await api(editing ? `/api/recipes/${encodeURIComponent(editing)}` : "/api/recipes", {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(recipeFromForm(elements.recipeForm)),
    });
    replaceRecipe(payload.recipe);
    elements.recipeForm.reset();
    elements.addDialog.close();
    state.editingRecipeId = null;
    renderAll();
    if (editing && elements.recipeDialog.open) openRecipe(payload.recipe, false);
    showToast(editing ? `${payload.recipe.title} was saved.` : `${payload.recipe.title} was added.`);
  } catch (error) { elements.formError.textContent = error.message; }
}

async function deleteRecipe() {
  const recipe = state.recipes.find((item) => item.id === state.editingRecipeId);
  if (!recipe) return;
  if (!confirm(`Delete ${recipe.title} for everyone? Journal entries keep its name. This cannot be undone.`)) return;
  try {
    await api(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: "DELETE" });
    state.recipes = state.recipes.filter((item) => item.id !== recipe.id);
    writeLocal(STORAGE.recipeCache, state.recipes);
    state.editingRecipeId = null;
    elements.addDialog.close();
    closeDialog(elements.recipeDialog);
    renderAll();
    focusViewHeading();
    showToast(`${recipe.title} was deleted.`);
  } catch (error) { elements.formError.textContent = error.message; }
}

// When the control that had focus is gone, give it to the open view's heading.
function focusViewHeading() {
  const active = document.activeElement;
  if (active && active !== document.body && active.offsetParent) return;
  const view = document.querySelector("[data-app-view]:not([hidden])");
  const heading = view?.querySelector("#libraryTitle") || view?.querySelector("h1");
  if (!heading) return;
  heading.tabIndex = -1;
  heading.focus();
}

function renderAll() {
  elements.recipeCount.textContent = state.recipes.length;
  renderHero(); renderRecipes(); renderNew(); renderHistoryAndStockAfterLoad();
}

// Each loader falls back to this device's saved copy only when the network is down; a 401
// means the session ended, and the sign-in screen takes over instead.
async function loadList(path, field, cacheKey) {
  try {
    const payload = await api(path);
    writeLocal(cacheKey, payload[field]);
    return payload[field];
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    state.offline = true;
    return stored(cacheKey, []);
  }
}

async function loadRecipes() {
  state.recipes = await loadList("/api/recipes", "recipes", STORAGE.recipeCache);
}

async function loadHistory() {
  state.history = await loadList("/api/history", "history", personKey("history-cache"));
}

async function loadInventory() {
  state.inventory = await loadList("/api/inventory", "inventory", personKey("inventory-cache"));
}

async function loadProfile() {
  const cached = stored(personKey("profile"), null);
  try {
    const { profile } = await api("/api/profile");
    applyProfile(profile);
    if (cached?.dirty?.length) {
      // Changes made while offline win over the server copy for the lists they touched.
      for (const field of cached.dirty) {
        if (field === "favorites") state.favorites = new Set(cached.favorites || []);
        else state[field] = cached[field] ?? state[field];
      }
      await saveProfile(...cached.dirty);
    } else cacheProfile();
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    state.offline = true;
    applyProfile(cached || {});
  }
}

// Before profiles, favorites, the meal plan and the shopping list lived in each browser.
// On the home network (the Owner), merge them into the Owner's profile once per browser.
// The merge only adds: an empty browser never clears what the server has.
async function uploadLegacyBrowserLists() {
  if (!state.me?.owner || state.signedIn || localStorage.getItem(STORAGE.profileUploaded)) return;
  const first = (keys, fallback) => keys.map((key) => stored(key, null)).find((value) => value !== null) ?? fallback;
  const favorites = first(LEGACY.favorites, []);
  const planner = first(LEGACY.planner, {});
  const shopping = first(LEGACY.shopping, []);
  const changed = [];
  const before = state.favorites.size;
  for (const id of Array.isArray(favorites) ? favorites : []) state.favorites.add(id);
  if (state.favorites.size !== before) changed.push("favorites");
  const merged = mergePlans(state.planner, planner);
  if (merged.added) { state.planner = merged.planner; changed.push("planner"); }
  const known = new Set(state.shopping.map((item) => item.id));
  const extra = (Array.isArray(shopping) ? shopping : []).filter((item) => item?.id && item?.text && !known.has(item.id));
  if (extra.length) { state.shopping.push(...extra); changed.push("shopping"); }
  if (changed.length) await saveProfile(...changed);
  localStorage.setItem(STORAGE.profileUploaded, new Date().toISOString());
}

function setConnectionStatus() {
  elements.offlineLine.hidden = navigator.onLine && !state.offline;
}

function closeDialog(dialog) {
  if (dialog === elements.recipeDialog) {
    elements.recipeDialog.classList.remove("cook-mode");
    elements.cookConsole.hidden = true;
    elements.cookStepBar.hidden = true;
    [...elements.stepList.children].forEach((item) => item.classList.remove("current"));
    if (state.wakeLock) state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
    if (!location.hash.startsWith("#view=")) {
      // Put the view the recipe was opened from back in the address, so a reload stays there.
      const view = document.querySelector("[data-app-view]:not([hidden])")?.dataset.appView;
      history.replaceState(null, "", view && view !== "recipes" ? `#view=${view}` : location.pathname);
    }
  }
  if (dialog === elements.scannerDialog) clearScanner();
  if (dialog.open) dialog.close();
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function saveTimers() {
  writeLocal(STORAGE.timers, state.timers);
}

function showTimerDock() {
  if (!elements.timerDock.open) elements.timerDock.showModal();
}

function hideTimerDock() {
  if (elements.timerDock.open) elements.timerDock.close();
}

async function announceTimer(timer) {
  if (timer.announced) return;
  timer.announced = true;
  saveTimers();
  if ("Notification" in window && Notification.permission === "granted") new Notification("Recipe Box timer", { body: `${timer.name} is done.` });
  showToast(`${timer.name} is done!`);
  showTimerDock();
}

function timerRow(timer) {
  const row = document.createElement("div");
  row.className = "timer-row";
  row.dataset.id = timer.id;
  const name = document.createElement("strong");
  name.textContent = timer.name;
  const time = document.createElement("time");
  const actions = document.createElement("div");
  actions.className = "timer-row-actions";
  const pause = document.createElement("button");
  pause.type = "button"; pause.dataset.role = "pause";
  const minute = document.createElement("button");
  minute.type = "button"; minute.dataset.action = "minute"; minute.textContent = "+1 min";
  minute.setAttribute("aria-label", `Add one minute to ${timer.name}`);
  const remove = document.createElement("button");
  remove.type = "button"; remove.dataset.action = "remove"; remove.textContent = "Clear";
  remove.setAttribute("aria-label", `Clear ${timer.name}`);
  actions.append(pause, minute, remove);
  row.append(name, time, actions);
  return row;
}

// Rows are kept and updated in place, so a focused button keeps focus through the
// every-second tick and through Pause, Resume and +1 min.
function renderTimers() {
  const now = Date.now();
  const existing = new Map([...elements.timerList.children].map((row) => [row.dataset.id, row]));
  const rows = state.timers.map((timer) => {
    const remaining = timer.pausedRemaining ?? timer.endAt - now;
    if (remaining <= 0) announceTimer(timer);
    const row = existing.get(timer.id) || timerRow(timer);
    row.classList.toggle("expired", remaining <= 0);
    const time = row.querySelector("time");
    const left = remaining <= 0 ? "Done" : formatCountdown(remaining);
    if (time.textContent !== left) time.textContent = left;
    const paused = timer.pausedRemaining !== undefined;
    const pause = row.querySelector('[data-role="pause"]');
    if (pause.dataset.action !== (paused ? "resume" : "pause")) {
      pause.dataset.action = paused ? "resume" : "pause";
      pause.textContent = paused ? "Resume" : "Pause";
      pause.setAttribute("aria-label", `${paused ? "Resume" : "Pause"} ${timer.name}`);
    }
    return row;
  });
  const shown = [...elements.timerList.children];
  if (rows.length !== shown.length || rows.some((row, index) => row !== shown[index])) elements.timerList.replaceChildren(...rows);
  elements.timerCount.textContent = state.timers.filter((timer) => (timer.pausedRemaining ?? timer.endAt - now) > 0).length;
  elements.timerButton.hidden = state.timers.length === 0;
}

async function startTimer(name, minutes) {
  const duration = Math.max(1, Math.min(600, Number(minutes) || 1)) * 60_000;
  state.timers.push({ id: uid(), name: String(name || "Kitchen timer").trim(), endAt: Date.now() + duration, announced: false });
  saveTimers(); renderTimers();
  showTimerDock();
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
}

function timerAction(event) {
  const button = event.target.closest("button[data-action]");
  const row = event.target.closest(".timer-row");
  if (!button || !row) return;
  const timer = state.timers.find((item) => item.id === row.dataset.id);
  if (!timer) return;
  if (button.dataset.action === "remove") {
    const index = [...elements.timerList.children].indexOf(row);
    state.timers = state.timers.filter((item) => item.id !== timer.id);
    saveTimers(); renderTimers();
    // The pressed button is gone: move to the next timer's Clear, or the panel heading.
    const rows = elements.timerList.children;
    const next = (rows[index] || rows[index - 1])?.querySelector('[data-action="remove"]');
    if (next) next.focus();
    else elements.timerDockHeading.focus();
    return;
  }
  if (button.dataset.action === "pause") timer.pausedRemaining = Math.max(0, timer.endAt - Date.now());
  if (button.dataset.action === "resume") { timer.endAt = Date.now() + timer.pausedRemaining; delete timer.pausedRemaining; timer.announced = false; }
  if (button.dataset.action === "minute") {
    if (timer.pausedRemaining !== undefined) timer.pausedRemaining += 60_000;
    else timer.endAt = Math.max(Date.now(), timer.endAt) + 60_000;
    timer.announced = false;
  }
  saveTimers(); renderTimers();
}

async function shareRecipe() {
  const recipe = state.activeRecipe;
  if (!recipe) return;
  const text = `${recipe.title}\n\n${recipe.ingredients.map((item) => `${item.amount} ${item.item}`.trim()).join("\n")}\n\n${recipe.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: recipe.title, text, url: location.href });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Recipe copied to the clipboard.");
      return;
    } catch {
      // Fall through to the dialog.
    }
  }
  // Plain http on the home network has neither sharing nor the clipboard: show the text to copy.
  account.showText({ title: `Share ${recipe.title}`, intro: "Copy the recipe and paste it into a message or a note.", label: "Recipe", text, rows: 12 });
}

async function exportBackup() {
  try {
    const response = await fetch("/api/backup");
    if (!response.ok) throw new Error((await response.json()).error || "Could not export backup.");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `recipe-box-backup-${dateKey(new Date())}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) { showToast(error.message); }
}

function setupEvents() {
  elements.searchInput.addEventListener("input", () => { state.query = elements.searchInput.value; renderRecipes(); });
  elements.sortSelect.addEventListener("change", () => { state.sort = elements.sortSelect.value; renderRecipes(); });
  elements.suggestAgainButton.addEventListener("click", () => { state.suggestionOffset += 1; renderHero(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); switchView("recipes"); elements.searchInput.focus(); }
    if (elements.recipeDialog.classList.contains("cook-mode") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      if (event.key === "ArrowRight") { event.preventDefault(); moveCookStep(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); moveCookStep(-1); }
    }
  });
  document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    switchView(link.dataset.viewLink);
  }));
  elements.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    preserveFocus(renderRecipes);
  });
  elements.clearFilters.addEventListener("click", () => {
    state.query = ""; state.category = ""; elements.searchInput.value = "";
    renderRecipes();
    elements.searchInput.focus();
  });
  elements.addButton.addEventListener("click", () => openRecipeForm());
  elements.editRecipeButton.addEventListener("click", () => state.activeRecipe && openRecipeForm(state.activeRecipe));
  elements.deleteRecipeButton.addEventListener("click", deleteRecipe);
  elements.profileButton.addEventListener("click", () => account.openSettings());
  elements.cookModeButton.addEventListener("click", toggleCookMode);
  elements.favoriteButton.addEventListener("click", () => state.activeRecipe && toggleFavorite(state.activeRecipe.id));
  elements.servingsDown.addEventListener("click", () => { state.servings = Math.max(1, state.servings - 1); renderIngredients(); });
  elements.servingsUp.addEventListener("click", () => { state.servings = Math.min(24, state.servings + 1); renderIngredients(); });
  elements.logMadeButton.addEventListener("click", openMadeDialog);
  elements.finishCookingButton.addEventListener("click", () => { closeDialog(elements.recipeDialog); openMadeDialog(); });
  elements.ratingPicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    state.rating = Number(button.dataset.rating); elements.madeRating.value = state.rating; updateRatingPicker();
  });
  elements.addIngredientsButton.addEventListener("click", () => addRecipeToShopping(state.activeRecipe));
  elements.planRecipeButton.addEventListener("click", () => openPlanDialog(state.activeRecipe));
  elements.shareRecipeButton.addEventListener("click", shareRecipe);
  elements.printRecipeButton.addEventListener("click", () => window.print());
  elements.viewAllHistoryButton.addEventListener("click", () => { closeDialog(elements.recipeDialog); switchView("history"); });
  elements.recipeForm.addEventListener("submit", submitRecipe);
  elements.madeForm.addEventListener("submit", submitMade);
  elements.quickTimerForm.addEventListener("submit", (event) => { event.preventDefault(); startTimer(elements.timerNameInput.value, elements.timerMinutesInput.value); });
  elements.cookPrevButton.addEventListener("click", () => moveCookStep(-1));
  elements.cookNextButton.addEventListener("click", () => moveCookStep(1));
  elements.parsePasteButton.addEventListener("click", handleParsePaste);
  elements.importUrlButton.addEventListener("click", handleImportUrl);
  elements.importUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); handleImportUrl(); }
  });

  elements.exportBackupButton.addEventListener("click", (event) => { event.preventDefault(); exportBackup(); });

  elements.shoppingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = elements.shoppingInput.value.trim();
    if (!text) return;
    state.shopping.push({ id: uid(), text, checked: false, source: "" });
    elements.shoppingForm.reset(); saveProfile("shopping"); renderShopping();
    elements.shoppingInput.focus();
  });
  elements.clearCheckedButton.addEventListener("click", () => {
    const before = state.shopping.length;
    state.shopping = state.shopping.filter((item) => !item.checked);
    if (state.shopping.length === before) { showToast("Nothing is checked yet."); return; }
    saveProfile("shopping"); renderShopping();
  });

  elements.planForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const recipeId = state.pendingPlanRecipeId || elements.planRecipeSelect.value;
    const date = elements.planDate.value;
    const meal = chosenMeal();
    if (!recipeId || !date) return;
    state.planner = setMeal(state.planner, date, meal, recipeId);
    // Closing returns focus to the button that opened the dialog; when that was an empty
    // meal, the redraw moves it to the meal that was just planned.
    saveProfile("planner"); elements.planDialog.close(); preserveFocus(renderPlanner); renderStats();
    showToast(`Added to ${mealLabel(meal).toLowerCase()} on ${longDay(date)}.`);
  });
  elements.planForm.addEventListener("change", (event) => {
    if (event.target.name === "meal" && !elements.planRecipeField.hidden) fillPlanRecipes(chosenMeal());
    updatePlanReplaces();
  });
  elements.previousWeekButton.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); renderPlanner(); });
  elements.nextWeekButton.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); renderPlanner(); });
  elements.thisWeekButton.addEventListener("click", () => { state.weekStart = startOfWeek(new Date()); renderPlanner(); });

  elements.addStockButton.addEventListener("click", () => openStockDialog());
  elements.scanStockButton.addEventListener("click", openScanner);
  elements.scanFromFormButton.addEventListener("click", openScanner);
  elements.stockForm.addEventListener("submit", submitStock);
  elements.deleteStockButton.addEventListener("click", deleteStock);
  elements.lookupBarcodeButton.addEventListener("click", () => lookupBarcode(elements.stockForm.elements.barcode.value, false));
  elements.manualBarcodeForm.addEventListener("submit", async (event) => {
    event.preventDefault(); await clearScanner(); elements.scannerDialog.close(); await lookupBarcode(elements.manualBarcodeInput.value, true);
  });
  elements.stockSearch.addEventListener("input", () => { state.stockQuery = elements.stockSearch.value; renderStock(); });
  elements.stockFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-location]"); if (!button) return;
    state.stockLowOnly = button.dataset.location === "low";
    state.stockLocation = state.stockLowOnly ? "" : button.dataset.location;
    pressFilter(elements.stockFilters, button);
    renderStock();
  });

  elements.timerButton.addEventListener("click", showTimerDock);
  elements.closeTimerDock.addEventListener("click", hideTimerDock);
  elements.timerList.addEventListener("click", timerAction);
  elements.dockTimerForm.addEventListener("submit", (event) => { event.preventDefault(); startTimer(elements.dockTimerName.value, elements.dockTimerMinutes.value); });

  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog($(`#${button.dataset.close}`))));
  [elements.recipeDialog, elements.addDialog, elements.madeDialog, elements.stockDialog, elements.scannerDialog, elements.planDialog, elements.settingsDialog, elements.personDialog, elements.shareDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) closeDialog(dialog); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(dialog); });
  });
  window.addEventListener("online", setConnectionStatus);
  window.addEventListener("offline", setConnectionStatus);
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); state.installPrompt = event; elements.installButton.hidden = false; });
  elements.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return; await state.installPrompt.prompt(); state.installPrompt = null; elements.installButton.hidden = true;
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && elements.recipeDialog.classList.contains("cook-mode") && "wakeLock" in navigator) {
      try { state.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* Optional. */ }
    }
    renderTimers();
  });
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isiOS && !window.matchMedia("(display-mode: standalone)").matches) elements.installHelp.textContent = "In Safari, tap Share, then Add to Home Screen.";
}

// Re-renders a list and puts keyboard focus back on the matching control, so pressing a
// chip, a heart or a checkbox does not drop focus to the top of the page.
function preserveFocus(render) {
  const active = document.activeElement;
  const key = active?.dataset?.focusKey;
  const scope = active?.closest?.("[data-focus-scope]");
  render();
  if (!key || !scope?.id) return;
  const target = document.querySelector(`#${scope.id} [data-focus-key="${CSS.escape(key)}"]`)
    || document.querySelector(`#${scope.id} [data-focus-key$=":${CSS.escape(key.split(":").slice(1).join(":"))}"]`);
  if (target) {
    target.focus();
    return;
  }
  // The item left the list (a filter hides it now): move to the nearest heading above the list.
  const list = document.querySelector(`#${scope.id}`);
  const headings = [...(list?.closest("[data-app-view]")?.querySelectorAll("h1, h2") || [])]
    .filter((heading) => heading.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
  const heading = headings.at(-1);
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

let account = null;

function applyIdentity(session) {
  state.me = session.user;
  state.zone = session.zone;
  state.signedIn = Boolean(session.signedIn);
  state.homeNetwork = Boolean(session.homeNetwork);
  writeLocal(STORAGE.session, { user: session.user, zone: session.zone, signedIn: state.signedIn, homeNetwork: state.homeNetwork });
  elements.profileInitials.textContent = initials(session.user.displayName);
  elements.profileName.textContent = session.user.displayName;
  elements.profileButton.setAttribute("aria-label", `${session.user.displayName}: profile and settings`);
  document.querySelectorAll("[data-requires]").forEach((element) => { element.hidden = !can(element.dataset.requires); });
}

function routeFromHash() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const view = hash.get("view");
  const recipe = state.recipes.find((item) => item.id === hash.get("recipe"));
  if (view) switchView(view, false);
  else if (recipe) openRecipe(recipe, false);
  else switchView("recipes", false);
}

async function startApp(session) {
  applyIdentity(session);
  state.offline = false;
  state.recent = stored(personKey("recent"), []);
  await Promise.all([loadRecipes(), loadHistory(), loadInventory(), loadProfile()]);
  await uploadLegacyBrowserLists();
  document.body.classList.remove("booting");
  account.hideSignIn();
  setConnectionStatus();
  renderAll();
  routeFromHash();
  state.started = true;
}

function clearPersonCaches(userId) {
  for (const name of ["history-cache", "inventory-cache", "profile", "recent"]) localStorage.removeItem(personKey(name, userId));
  localStorage.removeItem(STORAGE.session);
}

function resetPersonState() {
  Object.assign(state, {
    me: null, history: [], inventory: [], favorites: new Set(), planner: {}, shopping: [], recent: [],
    activeRecipe: null, editingRecipeId: null, started: false,
  });
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
}

async function safeStart(session) {
  try {
    await startApp(session);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    document.body.classList.remove("booting");
    showToast(error.message);
    return false;
  }
}

async function handleSignedIn(session) {
  if (state.me && state.me.id !== session.user.id) resetPersonState();
  if (await safeStart(session)) showToast(`Signed in as ${session.user.displayName}.`);
}

async function handleSignedOut(session) {
  if (state.me?.id) clearPersonCaches(state.me.id);
  resetPersonState();
  if (session?.user) {
    if (await safeStart(session)) showToast(`Signed out. This is ${session.user.displayName}'s profile.`);
  } else {
    document.body.classList.remove("booting");
    account.showSignIn();
  }
}

// A request came back 401: the session ended (signed out elsewhere, password changed,
// turned off or expired). Drop this person's data and ask the server who we are now.
let handlingSessionEnd = false;
async function handleSessionEnded() {
  if (handlingSessionEnd) return;
  handlingSessionEnd = true;
  try {
    if (state.me?.id) clearPersonCaches(state.me.id);
    resetPersonState();
    let session = null;
    try { session = await api("/api/session"); } catch { /* Offline: fall through to sign-in. */ }
    if (session?.user) {
      if (await safeStart(session)) showToast(`Your sign-in ended. This is ${session.user.displayName}'s profile.`);
    } else {
      document.body.classList.remove("booting");
      account.showSignIn({ message: "Your sign-in ended. Sign in again to continue." });
    }
  } finally {
    handlingSessionEnd = false;
  }
}

async function init() {
  account = setupAccount({
    getSession: () => ({ user: state.me, zone: state.zone, signedIn: state.signedIn, homeNetwork: state.homeNetwork }),
    setSession: (session) => applyIdentity(session),
    toast: showToast,
    onSignedIn: handleSignedIn,
    onSignedOut: handleSignedOut,
  });
  onUnauthorized(handleSessionEnded);
  setupEvents(); setConnectionStatus(); renderTimers();
  setInterval(renderTimers, 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  let session = null;
  try {
    session = await api("/api/session");
  } catch (error) {
    if (!isOfflineError(error)) showToast(error.message);
    session = stored(STORAGE.session, null);
  }
  if (!session?.user) {
    document.body.classList.remove("booting");
    account.showSignIn();
    return;
  }
  await safeStart(session);
}

init();
