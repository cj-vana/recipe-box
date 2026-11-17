// Easy-to-type passwords for new accounts: four kitchen words and a number, e.g.
// "maple-cumin-radish-tofu-47". 144 words give about 35 bits, plenty behind a sign-in that
// slows down after five wrong tries.
export const WORDS = [
  "anise", "apple", "apricot", "bacon", "bagel", "basil", "bean", "beet", "berry", "biscuit",
  "bread", "brisket", "broth", "butter", "cabbage", "cake", "candy", "caper", "caramel", "carrot",
  "cashew", "celery", "cheddar", "cherry", "chili", "chive", "cider", "cilantro", "cinnamon", "clove",
  "cocoa", "coconut", "cod", "coffee", "cookie", "corn", "cracker", "cream", "crepe", "cumin",
  "curry", "custard", "date", "dill", "dough", "dumpling", "egg", "fennel", "feta", "fig",
  "flour", "fudge", "garlic", "ginger", "granola", "grape", "gravy", "guava", "ham", "hazelnut",
  "herb", "honey", "jam", "kale", "kiwi", "leek", "lemon", "lentil", "lime", "mango",
  "maple", "melon", "mint", "miso", "muffin", "mushroom", "mustard", "noodle", "nutmeg", "oat",
  "olive", "onion", "orange", "oregano", "paprika", "parsley", "pasta", "peach", "peanut", "pear",
  "pecan", "pepper", "pesto", "pickle", "pie", "plum", "potato", "pretzel", "pumpkin", "quinoa",
  "radish", "raisin", "ramen", "rice", "risotto", "rye", "saffron", "sage", "salmon", "salsa",
  "salt", "scone", "sesame", "shallot", "sorbet", "soup", "spinach", "squash", "stew", "sugar",
  "syrup", "taco", "tamale", "tea", "thyme", "toast", "tofu", "tomato", "truffle", "tuna",
  "turnip", "vanilla", "waffle", "walnut", "wasabi", "yogurt", "zucchini", "barley", "brownie", "chowder",
  "falafel", "gnocchi", "nacho", "paella",
];

function randomBelow(limit, random) {
  // Rejection sampling keeps every value equally likely.
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  const buffer = new Uint32Array(1);
  for (;;) {
    random(buffer);
    if (buffer[0] < ceiling) return buffer[0] % limit;
  }
}

export function generatePassphrase(random = (array) => crypto.getRandomValues(array)) {
  const words = Array.from({ length: 4 }, () => WORDS[randomBelow(WORDS.length, random)]);
  const number = String(10 + randomBelow(90, random));
  return [...words, number].join("-");
}
