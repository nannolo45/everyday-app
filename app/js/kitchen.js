// Shopping list and pantry rules, shared with Ricette.
// These are the same rules Ricette uses (merge items, restock the pantry when an item is
// ticked, "remind me" thresholds, using up ingredients when you cook), written against a
// small store interface so both apps can run the same code.
//
// store = { live(c), get(c, id), upsert(c, rec), remove(c, id), uid() }
// names = { recipes, pantry, shopping } -> collection names in that store

import { parseIngredient, scaleQty, convert, addQuantities, namesMatch, stepFor } from './parse.js';
import { isBasic } from './recipe-tools.js';

const round = (x) => Math.round(x * 1000) / 1000;
const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

export function ingredientsOf(r) {
  return (r?.ingredients || []).map((i) => (i.name == null ? parseIngredient(i.raw || '') : i));
}

export function makeKitchen(store, names = { recipes: 'recipes', pantry: 'pantry', shopping: 'shopping' }) {
  const { live, get, upsert, remove, uid } = store;
  const P = names.pantry; const S = names.shopping;

  const findPantry = (name, pantry = live(P)) => pantry.find((p) => namesMatch(p.name, name));

  function addToShopping({ name, qty, unit, note }, source) {
    const existing = live(S).find((s) => !s.checked && !s.auto && namesMatch(s.name, name)
      && addQuantities(s, { qty, unit }) !== null);
    if (existing) {
      const sum = addQuantities(existing, { qty, unit });
      const sources = [...new Set([...(existing.sources || []), source].filter(Boolean))];
      upsert(S, { ...existing, qty: sum.qty == null ? null : round(sum.qty), unit: sum.unit, sources });
    } else {
      upsert(S, {
        id: uid(), name, qty: qty == null ? null : round(qty), unit: unit || '', note: note || '',
        checked: false, sources: source ? [source] : [], addedAt: Date.now(),
      });
    }
  }

  function lowInfo(p) {
    const min = num(p.min);
    if (min == null) return null;
    const qty = num(p.qty) || 0;
    if (qty > min) return null;
    const tgt = num(p.target);
    const target = tgt != null && tgt > min ? tgt : Math.max(min * 2, min + stepFor(p.unit));
    return { buy: round(target - qty) };
  }

  // Items at or below their "remind me at" threshold go on the list by themselves (Ricette's rule:
  // an item already ticked as bought stays ticked until it's put away in the pantry).
  function ensureLowItems() {
    for (const p of live(P)) {
      const id = `low_${p.id}`;
      const cur = get(S, id);
      const low = lowInfo(p);
      if (low) {
        if (!cur) {
          upsert(S, { id, name: p.name, qty: low.buy, unit: p.unit || '', checked: false, auto: true, pantryId: p.id, sources: [] });
        } else if (!cur.checked && (cur.qty !== low.buy || cur.name !== p.name || cur.unit !== (p.unit || ''))) {
          upsert(S, { ...cur, name: p.name, qty: low.buy, unit: p.unit || '' });
        }
      } else if (cur && !cur.checked) {
        remove(S, id);
      }
    }
    // Pantry item deleted: its automatic list item goes too.
    for (const it of live(S)) {
      if (it.auto && !it.checked && it.pantryId && !get(P, it.pantryId)) remove(S, it.id);
    }
  }

  // Ticking an item at the shop marks it bought. As in Ricette, it reaches the pantry when you
  // put the shopping away there ("Put away", with expiry dates). Older versions stocked it on
  // the spot: unticking such an item still takes it back out.
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
    ensureLowItems();
  }

  // "Put in pantry" for the ticked items: food tops up the matching pantry item (or becomes a new
  // one); things that aren't food (isFood false) just leave the list. Ricette's own put-away also
  // asks for expiry dates and barcodes: use that when you want them.
  function putAway(isFood = () => true, newItem = (it) => ({})) {
    let n = 0;
    for (const it of live(S).filter((x) => x.checked)) {
      if (isFood(it)) {
        const p = it.pantryId ? get(P, it.pantryId) : findPantry(it.name);
        const qty = num(it.qty);
        if (p) {
          let next = num(p.qty) || 0; let unit = p.unit || '';
          if (!it.stocked && qty != null) {
            const add = convert(qty, it.unit || '', unit);
            if (add != null) next = round(next + add);
            else if (next <= 0) { next = qty; unit = it.unit || ''; }
          }
          upsert(P, { ...p, qty: next, unit });
        } else {
          upsert(P, { id: uid(), name: it.name, qty: qty ?? 1, unit: it.unit || '', expires: null, min: null, target: null, brand: '', ...newItem(it) });
        }
      }
      remove(S, it.id);
      n++;
    }
    ensureLowItems();
    return n;
  }

  // What a recipe for n people needs, against a pantry (by default the real one).
  function planForRecipe(r, n, pantry = live(P)) {
    const base = r.servings || 4;
    return ingredientsOf(r).map((ing, idx) => {
      const need = scaleQty(ing.qty, base, n);
      let buy = need; let covered = false; let have = null;
      const p = findPantry(ing.name, pantry);
      if (p) {
        have = p;
        const pq = num(p.qty) || 0;
        if (need == null) covered = pq > 0;
        else {
          const avail = convert(pq, p.unit, ing.unit);
          if (avail != null) { buy = Math.max(0, need - avail); covered = buy <= 1e-9; }
        }
      }
      return { idx, name: ing.name, unit: ing.unit, note: ing.note, need, buy, covered, have, tracked: Boolean(p) };
    });
  }

  // Pantry as it will be by the time of a meal: what's there now, plus what's already on the
  // shopping list, minus what the meals planned before it will use up.
  function pantryAfter(meals, recipeOf) {
    const pantry = live(P).map((p) => ({ ...p }));
    for (const it of live(S)) {
      // Still to buy, or bought (ticked) and not put away yet: either way it'll be at home.
      if (it.stocked || it.qty == null) continue;
      const p = findPantry(it.name, pantry);
      if (!p) { pantry.push({ id: `list_${it.id}`, name: it.name, qty: it.qty, unit: it.unit || '' }); continue; }
      const add = convert(it.qty, it.unit, p.unit);
      if (add != null) p.qty = round((num(p.qty) || 0) + add);
    }
    for (const m of meals) {
      const r = recipeOf(m.recipeId);
      if (!r) continue;
      const base = r.servings || 4;
      for (const ing of ingredientsOf(r)) {
        if (ing.qty == null) continue;
        const p = findPantry(ing.name, pantry);
        if (!p) continue;
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

  function cook(r, n) {
    const base = r.servings || 4;
    let count = 0;
    for (const ing of ingredientsOf(r)) {
      if (ing.qty == null) continue;
      const p = findPantry(ing.name);
      if (!p) continue;
      const sub = convert(scaleQty(ing.qty, base, n), ing.unit, p.unit);
      if (sub == null) continue;
      upsert(P, { ...p, qty: Math.max(0, round((num(p.qty) || 0) - sub)) });
      count++;
    }
    ensureLowItems();
    return count;
  }

  return { addToShopping, ensureLowItems, setChecked, putAway, planForRecipe, pantryAfter, missingFor, cook, findPantry };
}
