// The shopping list's views: how items are grouped, sorted and searched. Pure functions (no DOM, no
// storage, no labels), shared by Everyday and Ricette so both lists look and behave the same.
// Copy this file as is (it has no imports); each app supplies its own labels (docs/ricette-handoff.md).

// Sort keys by a saved order; unknown keys after the known ones, in their own order (as sortable.js).
function byOrder(keys, saved) {
  const pos = new Map((saved || []).map((k, i) => [k, i]));
  return keys.map((k, i) => [k, i]).sort((a, b) => (pos.get(a[0]) ?? 1e6 + a[1]) - (pos.get(b[0]) ?? 1e6 + b[1])).map((x) => x[0]);
}
// ---- Views ("⇅" menu), in menu order
// Grouped: dept (departments), recipe (what each meal needs), shop (the item's own shop).
// Flat:    plain (your order, drag ⠿), alpha (A–Z), newest / oldest (by when they were added).
export const MODES = ['dept', 'recipe', 'shop', 'plain', 'alpha', 'newest', 'oldest'];
// Saved in the shared prefs (data/prefs.json, id "listMode"), so both apps open on the same view.
// The others are kept per device, so an older copy of either app never meets a view it doesn't know.
export const SHARED_MODES = ['dept', 'recipe', 'plain'];
export const LOCAL_MODES = ['shop', 'alpha', 'newest', 'oldest'];
export const GROUPED_MODES = ['dept', 'recipe', 'shop'];
// Views where ⠿ dragging makes sense (the others are sorted by a rule).
export const DRAG_MODES = ['dept', 'recipe', 'shop', 'plain'];

// The views to offer: "By shop" only once there's at least one shop.
export function availableModes(hasShops) { return MODES.filter((m) => m !== 'shop' || hasShops); }

// The view to show: the device's own choice (if it's a local view and still available), else the
// shared one, else departments.
export function currentMode({ local, shared, hasShops }) {
  if (LOCAL_MODES.includes(local) && (local !== 'shop' || hasShops)) return local;
  return SHARED_MODES.includes(shared) ? shared : 'dept';
}
// Where a chosen view is saved: { local } (per device; also clears the shared choice's override) or
// { shared } (the prefs, and the local choice is cleared).
export function saveModeTarget(mode) {
  return LOCAL_MODES.includes(mode) ? { local: mode, shared: undefined } : { local: null, shared: mode };
}

// ---- Search: lower case, accents ignored ("cafe" finds "café"); every word must appear
export const fold = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function matchesQ(hay, q) { const words = fold(q).split(/\s+/).filter(Boolean); return words.every((w) => hay.includes(w)); }
// An item matches on its name, note, the recipes it's for and the names of its shops.
export function itemMatches(item, q, shopNames = []) {
  return matchesQ(fold([item.name, item.note, ...(item.sources || []), ...shopNames].join(' ')), q);
}

// ---- Order
// When it was added (older items may only have updatedAt).
export const addedOf = (i) => i.addedAt || i.createdAt || i.updatedAt || 0;
// Your order first (⠿, field `order`), then items nobody has placed yet, by name.
export function byItemOrder(a, b) {
  const oa = Number.isFinite(a.order) ? a.order : Infinity;
  const ob = Number.isFinite(b.order) ? b.order : Infinity;
  if (oa !== ob) return oa - ob;
  return (a.name || '').localeCompare(b.name || '');
}
// The "by recipe" group of an item: running low (auto) → '__pantry', else its first recipe, else '__other'.
export function recipeGroupOf(i) { return i.auto ? '__pantry' : (i.sources || [])[0] || '__other'; }

// ---- Groups
// open:  the unticked items (already filtered by the search, if any)
// ctx:   { deptOf(item) → department id, deptOrder: [ids in your order], recipeOrder: [saved keys],
//          shops: [live shops in your order], lang }
// Returns [{ key, kind, items }]: kind 'all' (flat views: one group), 'dept' (key = department id),
// 'recipe' (key = recipe name, '__pantry' or '__other'), 'shop' (key = shop id) or 'anyShop' (key '__any').
export function groupItems(open, mode, ctx = {}) {
  const items = [...open].sort(byItemOrder);
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', ctx.lang, { sensitivity: 'base' });
  if (mode === 'plain') return [{ key: 'all', kind: 'all', items }];
  if (mode === 'alpha') return [{ key: 'all', kind: 'all', items: [...open].sort(byName) }];
  if (mode === 'newest' || mode === 'oldest') {
    const dir = mode === 'newest' ? -1 : 1;
    return [{ key: 'all', kind: 'all', items: [...open].sort((a, b) => dir * (addedOf(a) - addedOf(b)) || byName(a, b)) }];
  }
  if (mode === 'recipe') {
    // Meals in the order they were added (running-low items last), unless you dragged them.
    const groups = new Map(); const first = new Map();
    for (const i of items) {
      const k = recipeGroupOf(i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
      first.set(k, Math.min(first.get(k) ?? Infinity, i.addedAt || 0));
    }
    const natural = [...groups.keys()].sort((a, b) => (a === '__pantry') - (b === '__pantry') || first.get(a) - first.get(b));
    return byOrder(natural, ctx.recipeOrder || []).map((k) => ({ key: k, kind: 'recipe', items: groups.get(k) }));
  }
  if (mode === 'shop') {
    // Each item under its own first (live) shop, in your order of shops; items naming none: "Any shop", last.
    const shops = ctx.shops || []; const ids = new Set(shops.map((x) => x.id));
    const groups = new Map([...shops.map((x) => [x.id, []]), ['__any', []]]);
    for (const i of items) groups.get((i.shops || []).find((id) => ids.has(id)) || '__any').push(i);
    return [...shops.filter((x) => groups.get(x.id).length).map((x) => ({ key: x.id, kind: 'shop', items: groups.get(x.id) })),
      ...(groups.get('__any').length ? [{ key: '__any', kind: 'anyShop', items: groups.get('__any') }] : [])];
  }
  // Departments, in your order.
  const order = ctx.deptOrder || [];
  const groups = new Map(order.map((c) => [c, []]));
  for (const i of items) {
    const d = ctx.deptOf ? ctx.deptOf(i) : 'other';
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(i);
  }
  return [...groups.keys()].filter((c) => groups.get(c).length).map((c) => ({ key: c, kind: 'dept', items: groups.get(c) }));
}
