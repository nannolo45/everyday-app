// Kept for one version (v39) as a thin wrapper over foods.js, so code written against the old
// translation table keeps working. Removed in v40: use foods.js (foodOf, foodName, sameFood).
import { FOODS, foodOf, foodName, sameFood as same } from './foods.js';

/** [it, de, en, …other names] per food, as the old table had them. */
export const FOOD_ROWS = FOODS.map((f) => [f.it, f.de, f.en, ...f.alt]);
const ROW = new Map(FOODS.map((f, i) => [f.id, i]));

/** Which food (row index) a name is, or -1. */
export function foodKey(name) {
  const id = foodOf(name);
  return id && ROW.has(id) ? ROW.get(id) : -1;
}

/** The name of an ingredient in another language (it/de/en); the original when unknown. */
export function translateFood(name, lang) {
  const id = foodOf(name);
  return (id && foodName(id, lang)) || String(name || '').trim();
}

/** Same food, in any of the three languages? */
export function sameFood(a, b) { return same(a, b); }
