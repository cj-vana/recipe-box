import { friendlyNumber, parseLeadingNumber, scaleAmount } from "./amounts.js";

const STORAGE = {
  favorites: "recipe-box:favorites",
  recipeCache: "recipe-box:recipe-cache",
  historyCache: "recipe-box:history-cache",
  inventoryCache: "recipe-box:inventory-cache",
  recent: "recipe-box:recent",
  planner: "recipe-box:planner",
  shopping: "recipe-box:shopping",
  timers: "recipe-box:timers",
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

const migratedFavorites = stored(STORAGE.favorites, stored("freezer-table:favorites", []));
const state = {
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
  cookStep: 0,
  servings: 3,
  rating: 0,
  favorites: new Set(migratedFavorites),
  recent: stored(STORAGE.recent, []),
  planner: stored(STORAGE.planner, {}),
  shopping: stored(STORAGE.shopping, []),
  timers: stored(STORAGE.timers, []).filter((timer) => timer?.id && timer?.endAt),
  weekStart: startOfWeek(new Date()),
  suggestionOffset: 0,
  installPrompt: null,
  wakeLock: null,
  scanner: null,
  scannerHandled: false,
  pendingPlanRecipeId: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  addButton: $("#addButton"), addDialog: $("#addDialog"), clearFilters: $("#clearFilters"),
  connectionStatus: $("#connectionStatus"), cookConsole: $("#cookConsole"), cookModeButton: $("#cookModeButton"),
  detailFacts: $("#detailFacts"), detailImage: $("#detailImage"), detailKicker: $("#detailKicker"),
  detailNumber: $("#detailNumber"), detailSummary: $("#detailSummary"), detailTitle: $("#detailTitle"),
  emptyState: $("#emptyState"), favoriteButton: $("#favoriteButton"), filterRow: $("#filterRow"),
  formError: $("#formError"), heroFeature: $("#heroFeature"),
  heroImage: $("#heroImage"), heroRecipeMeta: $("#heroRecipeMeta"), heroRecipeTitle: $("#heroRecipeTitle"),
  ingredientList: $("#ingredientList"), installButton: $("#installButton"), installHelp: $("#installHelp"),
  leftoverNote: $("#leftoverNote"), recipeCount: $("#recipeCount"), recipeDialog: $("#recipeDialog"),
  recipeForm: $("#recipeForm"), recipeGrid: $("#recipeGrid"), recipeHistory: $("#recipeHistory"),
  recipeNotes: $("#recipeNotes"), searchInput: $("#searchInput"), settingsButton: $("#settingsButton"),
  settingsDialog: $("#settingsDialog"), sortSelect: $("#sortSelect"),
  statusDot: $("#statusDot"), stepList: $("#stepList"), toast: $("#toast"),
  servingsDown: $("#servingsDown"), servingsUp: $("#servingsUp"), servingsValue: $("#servingsValue"),
  logMadeButton: $("#logMadeButton"), madeDialog: $("#madeDialog"), madeForm: $("#madeForm"),
  madeDate: $("#madeDate"), madeRating: $("#madeRating"), madeError: $("#madeError"),
  madeRecipeTitle: $("#madeRecipeTitle"), ratingPicker: $("#ratingPicker"), deductStock: $("#deductStock"),
  addIngredientsButton: $("#addIngredientsButton"), planRecipeButton: $("#planRecipeButton"),
  shareRecipeButton: $("#shareRecipeButton"), printRecipeButton: $("#printRecipeButton"),
  viewAllHistoryButton: $("#viewAllHistoryButton"), finishCookingButton: $("#finishCookingButton"),
  quickTimerForm: $("#quickTimerForm"), timerNameInput: $("#timerNameInput"), timerMinutesInput: $("#timerMinutesInput"),
  suggestAgainButton: $("#suggestAgainButton"), madeTotal: $("#madeTotal"), triedTotal: $("#triedTotal"),
  favoriteTotal: $("#favoriteTotal"), plannedTotal: $("#plannedTotal"), stockBadge: $("#stockBadge"),
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
  planRecipeField: $("#planRecipeField"), planRecipeSelect: $("#planRecipeSelect"),
  historyStats: $("#historyStats"), historyList: $("#historyList"), historyEmpty: $("#historyEmpty"),
  shoppingForm: $("#shoppingForm"), shoppingInput: $("#shoppingInput"), shoppingList: $("#shoppingList"),
  shoppingEmpty: $("#shoppingEmpty"), clearCheckedButton: $("#clearCheckedButton"),
  timerButton: $("#timerButton"), timerCount: $("#timerCount"), timerDock: $("#timerDock"),
  timerList: $("#timerList"), closeTimerDock: $("#closeTimerDock"), dockTimerForm: $("#dockTimerForm"),
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

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function persist(name, value) {
  localStorage.setItem(STORAGE[name], JSON.stringify(value));
}

function saveFavorites() {
  persist("favorites", [...state.favorites]);
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
  renderRecipes();
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

function createCard(recipe, index) {
  const card = document.createElement("article");
  card.className = "recipe-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${recipe.title}`);
  card.style.animationDelay = `${Math.min(index, 8) * 45}ms`;
  const photo = document.createElement("div");
  photo.className = "card-photo";
  const image = document.createElement("img");
  image.src = recipe.image;
  image.alt = recipe.title;
  image.loading = "lazy";
  const number = document.createElement("span");
  number.className = "card-number";
  number.textContent = String(state.recipes.indexOf(recipe) + 1).padStart(2, "0");
  const save = document.createElement("button");
  save.className = `card-save${state.favorites.has(recipe.id) ? " saved" : ""}`;
  save.type = "button";
  save.setAttribute("aria-label", state.favorites.has(recipe.id) ? `Remove ${recipe.title} from favorites` : `Favorite ${recipe.title}`);
  save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.5 13A5 5 0 0 1 12 6.4 5 5 0 0 1 19.5 13Z"/></svg>';
  save.addEventListener("click", (event) => { event.stopPropagation(); toggleFavorite(recipe.id); });
  photo.append(image, number, save);

  const body = document.createElement("div");
  body.className = "card-body";
  const kicker = document.createElement("div");
  kicker.className = "card-kicker";
  const category = document.createElement("span");
  category.textContent = recipe.category;
  const metadata = document.createElement("span");
  const last = latestMade(recipe.id);
  metadata.textContent = last ? `Made ${formatDate(last.madeAt, { month: "short", day: "numeric" })}` : `${formatTime(totalMinutes(recipe))} · ${recipe.servings} servings`;
  kicker.append(category, metadata);
  const title = document.createElement("h3");
  title.textContent = recipe.title;
  const summary = document.createElement("p");
  summary.textContent = recipe.summary;
  body.append(kicker, title, summary);
  card.append(photo, body);
  const open = () => openRecipe(recipe);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });
  return card;
}

function pressFilter(row, pressed) {
  row.querySelectorAll(".filter").forEach((filter) => {
    filter.classList.toggle("active", filter === pressed);
    filter.setAttribute("aria-pressed", String(filter === pressed));
  });
}

function renderRecipes() {
  const recipes = filteredRecipes();
  elements.recipeGrid.replaceChildren(...recipes.map(createCard));
  elements.emptyState.hidden = recipes.length > 0;
}

function renderHero() {
  const choices = suggestedRecipes();
  const recipe = choices[state.suggestionOffset % Math.max(1, Math.min(choices.length, 8))];
  if (!recipe) return;
  elements.heroImage.src = recipe.image;
  elements.heroImage.alt = recipe.title;
  elements.heroRecipeTitle.textContent = recipe.title;
  const matches = stockMatchCount(recipe);
  elements.heroRecipeMeta.textContent = `${formatTime(totalMinutes(recipe))} · serves ${recipe.servings}${matches ? ` · ${matches} stock match${matches === 1 ? "" : "es"}` : ""}`;
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

function renderRecipeHistory() {
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
    stars.textContent = entry.rating ? "★".repeat(entry.rating) : "—";
    row.append(date, note, stars);
    return row;
  }));
}

function updateFavoriteButton() {
  const saved = state.activeRecipe && state.favorites.has(state.activeRecipe.id);
  elements.favoriteButton.textContent = saved ? "Favorited" : "Favorite";
}

function openRecipe(recipe, updateHash = true) {
  state.activeRecipe = recipe;
  state.cookStep = 0;
  state.servings = recipe.servings;
  state.recent = [recipe.id, ...state.recent.filter((id) => id !== recipe.id)].slice(0, 30);
  persist("recent", state.recent);
  const index = state.recipes.findIndex((item) => item.id === recipe.id) + 1;
  elements.detailImage.src = recipe.image;
  elements.detailImage.alt = recipe.title;
  elements.detailNumber.textContent = String(index).padStart(2, "0");
  elements.detailKicker.textContent = [recipe.category, recipe.mainIngredient].filter(Boolean).join(" · ");
  elements.detailTitle.textContent = recipe.title;
  elements.detailSummary.textContent = recipe.summary;
  elements.detailFacts.replaceChildren(
    fact(formatTime(totalMinutes(recipe))),
    fact(`Prep ${recipe.prepMinutes || 0} min`),
    fact(`Serves ${recipe.servings}`),
    fact(`${madeCount(recipe.id)}× made`),
  );
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
      chip.textContent = `⏱ ${timer.label}`;
      chip.addEventListener("click", () => startTimer(`${recipe.title} · step ${index + 1}`, timer.minutes));
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
  elements.cookModeButton.textContent = "Start Cook Mode";
  elements.timerNameInput.value = `${recipe.title} timer`;
  elements.timerMinutesInput.value = Math.max(1, recipe.cookMinutes || 10);
  if (!elements.recipeDialog.open) elements.recipeDialog.showModal();
  if (updateHash) history.replaceState(null, "", `#recipe=${encodeURIComponent(recipe.id)}`);
}

async function toggleCookMode() {
  const enabled = elements.recipeDialog.classList.toggle("cook-mode");
  elements.cookConsole.hidden = !enabled;
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
    elements.cookStepTimer.textContent = `⏱ ${timer.label}`;
    elements.cookStepTimer.onclick = () => startTimer(`${recipe.title} · step ${state.cookStep + 1}`, timer.minutes);
  }
  elements.cookPrevButton.disabled = state.cookStep === 0;
  elements.cookNextButton.textContent = state.cookStep === total - 1 ? "Finish ✓" : "Next step →";
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
    button.classList.toggle("active", Number(button.dataset.rating) <= state.rating);
    button.setAttribute("aria-label", `${button.dataset.rating} star${button.dataset.rating === "1" ? "" : "s"}`);
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
    persist("historyCache", state.history);
    const deducted = elements.deductStock.checked ? await deductMatchingStock(state.activeRecipe) : 0;
    elements.madeDialog.close();
    renderRecipeHistory();
    renderRecipes();
    renderHero();
    renderStats();
    renderHistory();
    showToast(`Saved to your cooking journal${deducted ? ` and updated ${deducted} stock item${deducted === 1 ? "" : "s"}` : ""}.`);
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
  persist("shopping", state.shopping);
  renderShopping();
  showToast(`${added} ingredient${added === 1 ? "" : "s"} added to the shopping list.`);
}

function renderShopping() {
  elements.shoppingList.replaceChildren(...state.shopping.map((shoppingItem) => {
    const row = document.createElement("label");
    row.className = `shopping-item${shoppingItem.checked ? " checked" : ""}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = shoppingItem.checked;
    checkbox.addEventListener("change", () => {
      shoppingItem.checked = checkbox.checked;
      persist("shopping", state.shopping);
      renderShopping();
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
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${shoppingItem.text}`);
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      state.shopping = state.shopping.filter((item) => item.id !== shoppingItem.id);
      persist("shopping", state.shopping);
      renderShopping();
    });
    row.append(checkbox, copy, remove);
    return row;
  }));
  elements.shoppingEmpty.hidden = state.shopping.length > 0;
  elements.shoppingBadge.textContent = state.shopping.filter((item) => !item.checked).length;
}

function plannedThisWeek() {
  return Array.from({ length: 7 }, (_, index) => state.planner[dateKey(addDays(startOfWeek(new Date()), index))]).filter(Boolean).length;
}

function renderStats() {
  elements.madeTotal.textContent = state.history.length;
  elements.triedTotal.textContent = new Set(state.history.map((entry) => entry.recipeId)).size;
  elements.favoriteTotal.textContent = state.favorites.size;
  elements.plannedTotal.textContent = plannedThisWeek();
  elements.stockBadge.textContent = state.inventory.filter((item) => item.quantity > 0).length;
  elements.shoppingBadge.textContent = state.shopping.filter((item) => !item.checked).length;
}

function openPlanDialog(recipe = null, date = dateKey(new Date())) {
  state.pendingPlanRecipeId = recipe?.id || null;
  elements.planDate.value = date;
  elements.planRecipeSelect.replaceChildren(...state.recipes.map((optionRecipe) => {
    const option = document.createElement("option");
    option.value = optionRecipe.id;
    option.textContent = optionRecipe.title;
    if (optionRecipe.id === recipe?.id) option.selected = true;
    return option;
  }));
  elements.planRecipeField.hidden = Boolean(recipe);
  elements.planRecipeTitle.textContent = recipe ? recipe.title : "Choose a recipe for this night.";
  elements.planDialog.showModal();
}

function renderPlanner() {
  const start = state.weekStart;
  const end = addDays(start, 6);
  elements.weekTitle.textContent = `${start.toLocaleDateString(undefined, { month: "long", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`;
  elements.plannerGrid.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    const recipe = state.recipes.find((item) => item.id === state.planner[key]);
    const day = document.createElement("article");
    day.className = `planner-day${key === dateKey(new Date()) ? " today" : ""}`;
    const header = document.createElement("header");
    const name = document.createElement("h3");
    name.textContent = date.toLocaleDateString(undefined, { weekday: "short" });
    const number = document.createElement("time");
    number.dateTime = key;
    number.textContent = date.getDate();
    header.append(name, number);
    day.append(header);
    if (recipe) {
      const card = document.createElement("div");
      card.className = "planned-card";
      const image = document.createElement("img");
      image.src = recipe.image;
      image.alt = "";
      const title = document.createElement("strong");
      title.textContent = recipe.title;
      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open recipe";
      open.addEventListener("click", () => openRecipe(recipe));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove from plan";
      remove.addEventListener("click", () => {
        delete state.planner[key];
        persist("planner", state.planner);
        renderPlanner();
        renderStats();
      });
      card.append(image, title, open, remove);
      day.append(card);
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-plan";
      const label = document.createElement("span");
      label.textContent = "Dinner is open";
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "+ Choose recipe";
      add.addEventListener("click", () => openPlanDialog(null, key));
      empty.append(label, add);
      day.append(empty);
    }
    return day;
  }));
}

function renderHistory() {
  const tried = new Set(state.history.map((entry) => entry.recipeId)).size;
  const ratings = state.history.filter((entry) => entry.rating).map((entry) => entry.rating);
  const average = ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : "—";
  const last30 = state.history.filter((entry) => Date.now() - dateFromKey(entry.madeAt) <= 30 * 86_400_000).length;
  const repeat = state.history.length - tried;
  elements.historyStats.replaceChildren(
    statBlock(state.history.length, "meals logged"), statBlock(tried, "recipes tried"),
    statBlock(average, "average rating"), statBlock(last30 || repeat, last30 ? "made in 30 days" : "repeat dinners"),
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
    stars.textContent = entry.rating ? `${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}` : "Not rated";
    copy.append(title, stars);
    if (entry.notes) { const note = document.createElement("p"); note.textContent = entry.notes; copy.append(note); }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
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
    state.history = state.history.filter((item) => item.id !== entry.id);
    persist("historyCache", state.history);
    renderHistory(); renderStats(); renderRecipes(); renderHero();
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
    place.textContent = `${item.location}${item.barcode ? ` · ${item.barcode}` : ""}`;
    const title = document.createElement("h3");
    title.textContent = item.name;
    const detail = document.createElement("p");
    detail.textContent = [item.brand, item.expirationDate ? `Best by ${formatDate(item.expirationDate, { month: "short", day: "numeric" })}` : ""].filter(Boolean).join(" · ") || "No extra details";
    copy.append(place, title, detail);
    const controls = document.createElement("div");
    controls.className = "quantity-control";
    const minus = document.createElement("button");
    minus.type = "button"; minus.textContent = "−"; minus.setAttribute("aria-label", `Use one ${item.unit} of ${item.name}`);
    minus.addEventListener("click", () => adjustStock(item, -1));
    const quantity = document.createElement("strong");
    quantity.className = item.quantity <= item.lowAt ? "low-label" : "";
    quantity.textContent = `${item.quantity} ${item.unit}${item.quantity === 1 ? "" : item.unit === "item" ? "s" : ""}`;
    const plus = document.createElement("button");
    plus.type = "button"; plus.textContent = "+"; plus.setAttribute("aria-label", `Add one ${item.unit} of ${item.name}`);
    plus.addEventListener("click", () => adjustStock(item, 1));
    const edit = document.createElement("button");
    edit.type = "button"; edit.className = "edit-stock"; edit.textContent = "Edit";
    edit.addEventListener("click", () => openStockDialog(item));
    controls.append(minus, quantity, plus, edit);
    card.append(initial, copy, controls);
    return card;
  }));
  elements.stockEmpty.hidden = items.length > 0;
  renderStats();
}

async function adjustStock(item, delta) {
  try {
    const payload = await api(`/api/inventory/${encodeURIComponent(item.id)}/adjust`, { method: "POST", body: JSON.stringify({ delta }) });
    const index = state.inventory.findIndex((candidate) => candidate.id === item.id);
    state.inventory[index] = payload.item;
    persist("inventoryCache", state.inventory);
    renderStock(); renderHero();
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
    persist("inventoryCache", state.inventory);
    elements.stockDialog.close();
    renderStock(); renderHero();
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
    persist("inventoryCache", state.inventory);
    elements.stockDialog.close();
    renderStock(); renderHero();
  } catch (error) { elements.stockError.textContent = error.message; }
}

async function lookupBarcode(barcode, openForm = true) {
  const code = String(barcode || "").replace(/\s/g, "");
  if (openForm) openStockDialog();
  elements.stockForm.elements.barcode.value = code;
  elements.lookupStatus.textContent = "Looking up product…";
  try {
    const product = await api(`/api/products/${encodeURIComponent(code)}`);
    if (product.found) {
      elements.stockForm.elements.name.value = product.name || elements.stockForm.elements.name.value;
      elements.stockForm.elements.brand.value = product.brand || "";
      elements.stockForm.elements.category.value = product.category || "";
      elements.lookupStatus.textContent = `Found via ${product.source}${product.packageQuantity ? ` · ${product.packageQuantity}` : ""}.`;
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

function switchView(name, updateHash = true) {
  document.querySelectorAll("[data-app-view]").forEach((view) => {
    const active = view.dataset.appView === name;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-view]").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  if (name === "stock") renderStock();
  if (name === "history") renderHistory();
  if (name === "planner") renderPlanner();
  if (name === "shopping") renderShopping();
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
  const categories = [...form.elements.category.options].map((option) => option.value);
  form.elements.title.value = recipe.title || "";
  form.elements.summary.value = recipe.summary || "";
  form.elements.mainIngredient.value = recipe.mainIngredient || "";
  form.elements.category.value = categories.find((option) => option.toLowerCase() === String(recipe.category || "").toLowerCase()) || "Other";
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
  showToast("Form filled — review it below, then Add recipe.");
}

async function handleImportUrl() {
  const target = elements.importUrlInput.value.trim();
  elements.quickFillError.textContent = "";
  if (!target) {
    elements.quickFillError.textContent = "Paste a recipe URL first.";
    return;
  }
  elements.importUrlButton.disabled = true;
  elements.importUrlButton.textContent = "Importing…";
  try {
    const payload = await api(`/api/recipes/import?url=${encodeURIComponent(target)}`);
    fillRecipeForm(payload.recipe);
    showToast(`Imported from ${payload.recipe.source} — review and save.`);
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

async function submitRecipe(event) {
  event.preventDefault();
  elements.formError.textContent = "";
  try {
    const payload = await api("/api/recipes", { method: "POST", body: JSON.stringify(recipeFromForm(elements.recipeForm)) });
    state.recipes.unshift(payload.recipe);
    elements.recipeForm.reset();
    elements.addDialog.close();
    renderAll();
    showToast(`${payload.recipe.title} was added.`);
  } catch (error) { elements.formError.textContent = error.message; }
}

function renderAll() {
  elements.recipeCount.textContent = state.recipes.length;
  renderHero(); renderRecipes(); renderHistoryAndStockAfterLoad();
}

async function loadRecipes() {
  try {
    const payload = await api("/api/recipes");
    state.recipes = payload.recipes;
    persist("recipeCache", state.recipes);
  } catch (error) {
    state.recipes = stored(STORAGE.recipeCache, stored("freezer-table:recipe-cache", []));
    if (!state.recipes.length) showToast(error.message);
  }
}

async function loadHistory() {
  try {
    const payload = await api("/api/history");
    state.history = payload.history;
    persist("historyCache", state.history);
  } catch { state.history = stored(STORAGE.historyCache, []); }
}

async function loadInventory() {
  try {
    const payload = await api("/api/inventory");
    state.inventory = payload.inventory;
    persist("inventoryCache", state.inventory);
  } catch { state.inventory = stored(STORAGE.inventoryCache, []); }
}

function setConnectionStatus() {
  const online = navigator.onLine;
  elements.statusDot.classList.toggle("offline", !online);
  elements.connectionStatus.textContent = online ? "Private recipe library online" : "Offline copy available";
}

function closeDialog(dialog) {
  if (dialog === elements.recipeDialog) {
    elements.recipeDialog.classList.remove("cook-mode");
    elements.cookConsole.hidden = true;
    [...elements.stepList.children].forEach((item) => item.classList.remove("current"));
    if (state.wakeLock) state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
    if (!location.hash.startsWith("#view=")) history.replaceState(null, "", location.pathname);
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
  persist("timers", state.timers);
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

function renderTimers() {
  const now = Date.now();
  elements.timerList.replaceChildren(...state.timers.map((timer) => {
    const remaining = timer.pausedRemaining ?? timer.endAt - now;
    if (remaining <= 0) announceTimer(timer);
    const row = document.createElement("div");
    row.className = `timer-row${remaining <= 0 ? " expired" : ""}`;
    row.dataset.id = timer.id;
    const name = document.createElement("strong");
    name.textContent = timer.name;
    const time = document.createElement("time");
    time.textContent = remaining <= 0 ? "Done" : formatCountdown(remaining);
    const actions = document.createElement("div");
    actions.className = "timer-row-actions";
    const pause = document.createElement("button");
    pause.type = "button"; pause.dataset.action = timer.pausedRemaining === undefined ? "pause" : "resume";
    pause.textContent = timer.pausedRemaining === undefined ? "Pause" : "Resume";
    const minute = document.createElement("button");
    minute.type = "button"; minute.dataset.action = "minute"; minute.textContent = "+1 min";
    const remove = document.createElement("button");
    remove.type = "button"; remove.dataset.action = "remove"; remove.textContent = "Clear";
    actions.append(pause, minute, remove);
    row.append(name, time, actions);
    return row;
  }));
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
  if (button.dataset.action === "remove") state.timers = state.timers.filter((item) => item.id !== timer.id);
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
  try {
    if (navigator.share) await navigator.share({ title: recipe.title, text, url: location.href });
    else { await navigator.clipboard.writeText(text); showToast("Recipe copied to the clipboard."); }
  } catch (error) { if (error.name !== "AbortError") showToast("Could not share the recipe."); }
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
  document.querySelectorAll("[data-view-link]").forEach((link) => link.addEventListener("click", () => switchView(link.dataset.viewLink)));
  elements.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    pressFilter(elements.filterRow, button);
    renderRecipes();
  });
  elements.clearFilters.addEventListener("click", () => {
    state.query = ""; state.category = ""; elements.searchInput.value = "";
    pressFilter(elements.filterRow, elements.filterRow.querySelector(".filter"));
    renderRecipes();
  });
  elements.addButton.addEventListener("click", () => elements.addDialog.showModal());
  elements.settingsButton.addEventListener("click", () => elements.settingsDialog.showModal());
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
    state.shopping.push({ id: uid(), text: elements.shoppingInput.value.trim(), checked: false, source: "" });
    elements.shoppingForm.reset(); persist("shopping", state.shopping); renderShopping();
  });
  elements.clearCheckedButton.addEventListener("click", () => {
    state.shopping = state.shopping.filter((item) => !item.checked); persist("shopping", state.shopping); renderShopping();
  });

  elements.planForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const recipeId = state.pendingPlanRecipeId || elements.planRecipeSelect.value;
    state.planner[elements.planDate.value] = recipeId;
    persist("planner", state.planner); elements.planDialog.close(); renderPlanner(); renderStats(); showToast("Dinner added to the meal plan.");
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
  [elements.recipeDialog, elements.addDialog, elements.madeDialog, elements.stockDialog, elements.scannerDialog, elements.planDialog, elements.settingsDialog].forEach((dialog) => {
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

async function init() {
  setupEvents(); setConnectionStatus(); renderTimers();
  setInterval(renderTimers, 1000);
  await Promise.all([loadRecipes(), loadHistory(), loadInventory()]);
  renderAll();
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const view = hash.get("view");
  const recipe = state.recipes.find((item) => item.id === hash.get("recipe"));
  if (view) switchView(view, false);
  else if (recipe) openRecipe(recipe, false);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

init();
