// Ingredient amounts: reading them, writing them back as kitchen fractions, and scaling them to a
// different number of servings.

// A quantity is "1 1/2", "3/4", "2" or "8.8". A trailing "-count" or "-inch" makes it a size, which never scales.
const QUANTITY = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(-[a-z]+)?/gi;

function parseQuantity(text) {
  let number = 0;
  for (const part of text.split(/\s+/)) {
    if (part.includes("/")) {
      const [top, bottom] = part.split("/").map(Number);
      number += bottom ? top / bottom : 0;
    } else number += Number(part);
  }
  return number;
}

export function parseLeadingNumber(value) {
  const match = String(value).match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  return { number: parseQuantity(match[1]), rest: match[2] };
}

// Picks the closest of wholes, halves, thirds, quarters and eighths, so 2/3 cup stays 2/3, not 5/8.
export function friendlyNumber(value) {
  let best = { top: Math.round(value), bottom: 1 };
  for (const bottom of [2, 3, 4, 8]) {
    const top = Math.round(value * bottom);
    if (Math.abs(value - top / bottom) < Math.abs(value - best.top / best.bottom)) best = { top, bottom };
  }
  if (value > 0 && best.top === 0) return "< 1/8";
  const whole = Math.floor(best.top / best.bottom);
  const remainder = best.top % best.bottom;
  if (!remainder) return String(whole);
  return `${whole ? `${whole} ` : ""}${remainder}/${best.bottom}`;
}

function scaleQuantities(text, ratio) {
  return text.replace(QUANTITY, (match, quantity, size) => size ? match : friendlyNumber(parseQuantity(quantity) * ratio));
}

// Scales every quantity in an amount, so "1 1/2 to 2 lb" and "1/2 cup plus 1 tbsp" scale on both sides.
// Inside parentheses only an "about" total scales: "(about 1 1/2 lb)" doubles, a "(14 oz)" can size does not.
// At the recipe's own servings the amount shows exactly as written.
export function scaleAmount(amount, ratio) {
  const text = String(amount);
  if (ratio === 1) return text;
  return text.split(/(\([^)]*\))/)
    .map((part) => part.startsWith("(") && !/^\(\s*about\b/i.test(part) ? part : scaleQuantities(part, ratio))
    .join("");
}
