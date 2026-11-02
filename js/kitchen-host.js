// Everyday's side of the kitchen rules. The rules themselves are Ricette's shared kitchen.js (copied
// unchanged, v40): finding a pantry product, adding to the list, what a recipe needs, cooking, put away.
// This file maps Everyday's collections onto it and keeps the few things only Everyday does:
//  - pantryAfter / missingFor: the pantry as it will be by a meal (the list bought, earlier meals cooked);
//  - setChecked: ticking at the shop (older records "stocked" on the spot are taken back out on untick);
//  - putAway: the ticked items, food into the pantry, the rest just off the list (a new product takes the
//    item's shops, as in Ricette v50; Everyday leaves a product's `place` to Ricette).
// "Running low" items are Ricette's alone (data contract v1): Everyday never calls ensureLowItems.
//
// store = { live(c), get(c, id), upsert(c, rec), remove(c, id), uid() }; names = { pantry, shopping }
import { atHome, createKitchen, ingredientsOf, isLevel, num, round } from './kitchen.js';
import { convert, scaleQty } from './parse.js';
import { findPantryItem, isBasic } from './recipe-tools.js';

export function makeKitchen(store, names = { pantry: 'pantry', shopping: 'shopping' }) {
  const { live, get, upsert, remove, uid } = store;
  const P = names.pantry; const S = names.shopping;
  const col = (c) => (c === 'pantry' ? P : c === 'shopping' ? S : c);
  // kitchen.js speaks of 'pantry' and 'shopping'; here they are Everyday's collection names.
  const k = createKitchen({
    live: (c) => live(col(c)),
    get: (c, id) => get(col(c), id),
    upsert: (c, r) => upsert(col(c), r),
    remove: (c, id) => remove(col(c), id),
    uid,
  });

  // What a recipe for n people needs, against the pantry now or a pantry as it will be (pantryAfter).
  function planForRecipe(r, n, pantry = null) {
    return k.planForRecipe(r, n, pantry || true).map((x) => ({ ...x, tracked: Boolean(x.have) }));
  }

  // Pantry as it will be by the time of a meal: what's there now, plus what's already on the
  // shopping list, minus what the meals planned before it will use up. Same food = foods.js.
  function pantryAfter(meals, recipeOf) {
    const pantry = live(P).map((p) => ({ ...p }));
    for (const it of live(S)) {
      // Still to buy, or bought (ticked) and not put away yet: either way it'll be at home.
      if (it.stocked) continue;
      const p = findPantryItem(it, pantry);
      if (p && isLevel(p)) { p.level = 'ok'; continue; } // on the list: bought by then
      if (it.qty == null) continue;
      if (!p) { pantry.push({ id: `list_${it.id}`, name: it.name, qty: it.qty, unit: it.unit || '', ...(it.food ? { food: it.food } : {}), ...(it.foodPinned ? { foodPinned: true } : {}) }); continue; }
      const add = convert(it.qty, it.unit, p.unit);
      if (add != null) p.qty = round((num(p.qty) || 0) + add);
    }
    for (const m of meals) {
      const r = recipeOf(m.recipeId);
      if (!r) continue;
      const base = r.servings || 4;
      for (const ing of ingredientsOf(r)) {
        if (ing.qty == null) continue;
        const p = findPantryItem(ing, pantry);
        if (!p || isLevel(p)) continue;
        const sub = convert(scaleQty(ing.qty, base, m.servings || base), ing.unit, p.unit);
        if (sub != null) p.qty = Math.max(0, round((num(p.qty) || 0) - sub));
      }
    }
    return pantry;
  }

  // Ingredients to buy for a meal. Basics (salt, pepper, oil, water) and untracked "to taste"
  // items never trigger a trip, same as Ricette's "what can I cook" suggestions.
  function missingFor(r, n, pantry) {
    return planForRecipe(r, n, pantry).filter((x) => !x.covered && (x.need != null || x.tracked) && !isBasic(x.name || ''));
  }

  // Cooking a recipe takes it out of the pantry (staples untouched).
  function cook(r, n) { return k.usePantryFor(r, n); }

  // Ticking an item at the shop marks it bought; it reaches the pantry on "Put away". Older versions
  // stocked it on the spot: unticking such an item still takes it back out.
  function setChecked(id, checked) {
    const it = get(S, id);
    if (!it) return;
    let stocked = it.stocked || null;
    if (!checked && stocked) {
      const p = get(P, stocked.pantryId);
      if (p) upsert(P, { ...p, qty: Math.max(0, round((num(p.qty) || 0) - stocked.amount)) });
      stocked = null;
    }
    upsert(S, { ...it, checked, stocked });
  }

  // "Put away" for the ticked items: food tops up its pantry product (or becomes a new one, with the
  // department from catOf(item) when a person chose one); the rest just leaves the list.
  function putAway(isFood = () => true, catOf = () => null) {
    let n = 0;
    for (const it of live(S).filter((x) => x.checked)) {
      if (isFood(it)) {
        const row = { ...it, cat: catOf(it) || it.cat || null };
        const isNew = !k.pantryTarget(row);
        const p = k.putAwayRow(row);
        // (v60, Ricette v50) a new product takes the item's shops; an existing one keeps its own
        if (isNew && p && (it.shops || []).length) upsert(P, { ...p, shops: [...it.shops] });
      }
      remove(S, it.id);
      n++;
    }
    return n;
  }

  return { findPantry: k.findPantry, addToShopping: k.addToShopping, planForRecipe, pantryAfter, missingFor, cook, setChecked, putAway, atHome };
}
