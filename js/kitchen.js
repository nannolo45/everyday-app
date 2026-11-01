// Kitchen rules shared by Ricette and Everyday (copied unchanged in both apps):
// finding a pantry product, adding to the shopping list, what a recipe still needs,
// what cooking takes out of the pantry, putting shopping away, and running low.
// Every comparison of two foods goes through foods.js (sameFood), so both apps match alike.
//
// The host passes its store:  createKitchen({ live, get, upsert, remove, uid })
//   live(collection) → records not deleted;  get(collection, id) → record or undefined (not deleted)
//   upsert(collection, record, { silent: true }) → the stored record;  remove(collection, id);  uid() → new id
//   all(collection) → records including deleted ones (optional; only ensureLowItems uses it)
// Nothing here touches the screen; the host shows messages and saves.
import { parseIngredient, convert, scaleQty, addQuantities, stepFor, normalizeName } from './parse.js';
import { sameFood, foodFields } from './foods.js';

export const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const round = (x) => Math.round(x * 1000) / 1000;
const earlier = (a, b) => { if (!a) return b || null; if (!b) return a; return a < b ? a : b; };

// Staples (contract v1): track 'level' = counted as C'è / Poca / Finita instead of a quantity.
export const LEVELS = ['ok', 'low', 'out'];
export const isLevel = (p) => p?.track === 'level';
export const levelOf = (p) => (LEVELS.includes(p?.level) ? p.level : 'ok');
/** At home: ok or low for staples (qty ignored), qty > 0 otherwise. */
export const atHome = (p) => (isLevel(p) ? levelOf(p) !== 'out' : (num(p?.qty) || 0) > 0);

/** A recipe's ingredients, parsed when they were stored as text only. */
export function ingredientsOf(r) {
  // stored as text only (older imports): parsed here, keeping the other fields (group, food)
  return (r?.ingredients || []).map((i) => (i.name == null ? { ...i, ...parseIngredient(i.raw || '') } : i));
}

/** Running low? { buy } = how much to buy (null for staples), or null. */
export function lowInfo(p) {
  if (isLevel(p)) return levelOf(p) === 'ok' ? null : { buy: null };
  const min = num(p.min);
  if (min == null) return null;
  const qty = num(p.qty) || 0;
  if (qty > min) return null;
  const tgt = num(p.target);
  const target = tgt != null && tgt > min ? tgt : Math.max(min * 2, min + stepFor(p.unit));
  return { buy: round(target - qty) };
}

const codesOf = (p) => [...new Set([...(p.barcodes || []), ...(p.barcode ? [p.barcode] : [])])];

export function createKitchen({ live, get, upsert, remove, uid, all }) {
  const silent = { silent: true };

  /**
   * The pantry product for a name or an item: the same name first, else the same food.
   * `pantry`: optional list to search instead of the stored pantry (Everyday: the pantry by a meal's time).
   */
  function findPantry(nameOrItem, pantry = live('pantry')) {
    const name = typeof nameOrItem === 'string' ? nameOrItem : nameOrItem?.name;
    const n = normalizeName(name);
    return pantry.find((p) => normalizeName(p.name) === n) || pantry.find((p) => sameFood(p, nameOrItem)) || null;
  }

  /**
   * Add to the shopping list, merging into an open item of the same food when the units add up.
   * item: { name, qty, unit, note, shops, cat, food, foodPinned }  (cat only when a person chose it; food/foodPinned
   * when the source has them, e.g. a recipe ingredient, else resolved from the name). Returns the stored record.
   * A merge keeps the existing item's food.
   */
  function addToShopping(item, source) {
    const { name, qty, unit, note, shops } = item;
    const existing = live('shopping').find((s) => !s.checked && !s.auto && sameFood(s, item) && addQuantities(s, { qty, unit }) !== null);
    if (existing) {
      const sum = addQuantities(existing, { qty, unit });
      const sources = [...new Set([...(existing.sources || []), source].filter(Boolean))];
      const merged = [...new Set([...(existing.shops || []), ...(shops || [])])];
      const added = existing.addedAt || existing.createdAt || Date.now();
      return upsert('shopping', { ...existing, qty: sum.qty == null ? null : round(sum.qty), unit: sum.unit, sources, ...(merged.length ? { shops: merged } : {}), addedAt: Math.min(added, Date.now()) }, silent);
    }
    // the department: what a person chose, or the pantry product's chosen one; otherwise worked out when shown
    const p = item.cat ? null : findPantry(item);
    const cat = item.cat || p?.cat || null;
    return upsert('shopping', {
      id: uid(), name, qty: qty == null ? null : round(qty), unit: unit || '', note: note || '',
      checked: false, sources: source ? [source] : [], addedAt: Date.now(), ...(cat ? { cat } : {}), ...(shops && shops.length ? { shops } : {}),
      ...foodFields(name, item),
    }, silent);
  }

  /** Ricette only (contract v1: automatic items are Ricette's while it is connected). */
  function ensureLowItems() {
    const pantry = live('pantry');
    for (const p of pantry) {
      const id = `low_${p.id}`;
      const cur = get('shopping', id);
      const low = lowInfo(p);
      const unit = low && low.buy == null ? '' : p.unit || '';
      if (low) {
        if (!cur) {
          upsert('shopping', { id, name: p.name, qty: low.buy, unit, checked: false, auto: true, pantryId: p.id, sources: [], addedAt: Date.now(), ...(p.cat ? { cat: p.cat } : {}), ...foodFields(p.name, p) }, silent);
        } else if ((!cur.checked && (cur.qty ?? null) !== low.buy) || cur.name !== p.name || cur.unit !== unit) {
          upsert('shopping', { ...cur, name: p.name, qty: low.buy, unit }, silent);
        }
      } else if (cur && !cur.checked) {
        remove('shopping', id);
      }
    }
    // products deleted since (tombstones, when the host passes `all`): their open automatic items go too
    for (const p of all ? all('pantry').filter((x) => x.deleted) : []) {
      const cur = get('shopping', `low_${p.id}`);
      if (cur && !cur.checked) remove('shopping', cur.id);
    }
  }

  /**
   * What a recipe needs for n people: [{ idx, name, unit, note, food, foodPinned, need, buy, covered, have }].
   * usePantry: false, true (the stored pantry) or an array of pantry products to plan against.
   */
  function planForRecipe(r, n, usePantry) {
    const base = r.servings || 4;
    const pantry = Array.isArray(usePantry) ? usePantry : usePantry ? live('pantry') : null;
    return ingredientsOf(r).map((ing, idx) => {
      const need = scaleQty(ing.qty, base, n);
      let buy = need; let covered = false; let have = null;
      if (pantry) {
        const p = findPantry(ing, pantry);
        if (p && isLevel(p)) {
          have = p;
          covered = atHome(p);
          if (covered) buy = 0;
        } else if (p) {
          have = p;
          const pq = num(p.qty) || 0;
          if (need == null) covered = pq > 0;
          else {
            const avail = convert(pq, p.unit, ing.unit);
            if (avail != null) { buy = Math.max(0, need - avail); covered = buy <= 1e-9; }
          }
        }
      }
      return { idx, name: ing.name, unit: ing.unit, note: ing.note, ...(ing.food ? { food: ing.food } : {}), ...(ing.foodPinned ? { foodPinned: true } : {}), need, buy, covered, have };
    });
  }

  /** Take a cooked recipe (n people) out of the pantry. Staples are left alone. Returns how many products changed. */
  function usePantryFor(r, n) {
    const base = r.servings || 4;
    let count = 0;
    for (const ing of ingredientsOf(r)) {
      if (ing.qty == null) continue;
      const p = findPantry(ing);
      if (!p || isLevel(p)) continue;
      const sub = convert(scaleQty(ing.qty, base, n), ing.unit, p.unit);
      if (sub == null) continue;
      upsert('pantry', { ...p, qty: Math.max(0, round((num(p.qty) || 0) - sub)) }, silent);
      count++;
    }
    return count;
  }

  /** The pantry product a bought item goes into: its pantryId, its barcode, else the same food. */
  function pantryTarget(row) {
    const pantry = live('pantry');
    return (row.pantryId && get('pantry', row.pantryId))
      || (row.barcode && pantry.find((p) => codesOf(p).includes(row.barcode)))
      || findPantry(row)
      || null;
  }

  /**
   * Put one bought item away. row: { name, qty, unit, expires, pantryId?, barcode?, brand?, packQty?, packUnit?, cat?, stocked?, food?, foodPinned? }
   * Tops up the product (or creates it, copying food/foodPinned from the row); a staple goes back to 'ok' and keeps
   * its qty. An existing product keeps its own food. Returns the pantry record.
   */
  function putAwayRow(row) {
    const tg = pantryTarget(row);
    const qty = num(row.qty);
    const unit = row.unit || '';
    const withCode = (p) => (row.barcode ? (() => { const codes = [...new Set([...codesOf(p), row.barcode])]; return { barcode: codes[0], barcodes: codes }; })() : {});
    if (tg && isLevel(tg)) {
      return upsert('pantry', {
        ...tg, level: 'ok', expires: row.expires || tg.expires || null, ...withCode(tg),
        brand: tg.brand || row.brand || '', cat: tg.cat || row.cat || null,
      }, silent);
    }
    if (tg) {
      const before = num(tg.qty) || 0;
      const wasEmpty = before <= 0;
      let newQty = before; let newUnit = tg.unit || '';
      if (!row.stocked && qty != null) {
        const add = convert(qty, unit, newUnit);
        if (add != null) newQty = round(before + add);
        else if (wasEmpty) { newQty = qty; newUnit = unit; }
      }
      return upsert('pantry', {
        ...tg, qty: newQty, unit: newUnit,
        expires: row.expires ? (wasEmpty ? row.expires : earlier(tg.expires, row.expires)) : (wasEmpty ? null : tg.expires || null),
        ...withCode(tg),
        brand: tg.brand || row.brand || '', packQty: tg.packQty || row.packQty || null, packUnit: tg.packQty ? tg.packUnit : (row.packUnit || null),
        cat: tg.cat || row.cat || null,
      }, silent);
    }
    return upsert('pantry', {
      id: uid(), name: String(row.name || '').trim(), qty: qty ?? 1, unit, expires: row.expires || null, min: null, target: null, addedAt: Date.now(),
      ...(row.barcode ? { barcode: row.barcode, barcodes: [row.barcode] } : {}), brand: row.brand || '', packQty: row.packQty || null, packUnit: row.packUnit || null,
      cat: row.cat || null, ...(row.lookupPending ? { lookupPending: true } : {}), ...(row.nameFromCode ? { nameFromCode: true } : {}),
      ...foodFields(row.name, row),
    }, silent);
  }

  return { findPantry, addToShopping, ensureLowItems, planForRecipe, usePantryFor, pantryTarget, putAwayRow };
}
