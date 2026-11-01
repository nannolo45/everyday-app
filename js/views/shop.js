// views/shop.js: Attività → Spesa, the shopping list (v37: the shared list v2 from Ricette).
// The markup comes from shoplist-ui.js and the grouping from shoplist.js, both shared with Ricette
// unchanged; this file supplies the labels, the formatting and what each action does.
import { esc, hint, kitchen, kitchenOwn, modal, relDay, toast, ui } from '../core.js';
import { DEPT_IDS, DEPTS, deptIcon, deptOf, NONFOOD } from '../depts.js';
import { refood } from '../foods.js';
import { getLang, t } from '../i18n.js';
import { qtyText } from '../model.js';
import { parseIngredient } from '../parse.js';
import { today } from '../plan.js';
import { tripMode } from '../planning.js';
import { changed, runSync } from '../shell.js';
import { addedOf, availableModes, fold, byItemOrder, currentMode, DRAG_MODES, filterCount, filterItems, GROUPED_MODES, groupItems, itemMatches as itemMatchesQ, saveModeTarget } from '../shoplist.js';
import { cartBarHtml, itemSheetHtml, listHtml, menuHtml, rowsHtml, shopChipsHtml, SL_ACTIONS as A, viewSheetHtml } from '../shoplist-ui.js';
import { byOrder, reorderSubset } from '../sortable.js';
import { contractTooNew, get, live, remove, saveSettings, state, uid, upsert } from '../store.js';
import { ricetteConfigured } from '../sync.js';
import { openModal, searchBox } from '../widgets.js';
import { manualOrder } from './tasks.js';

// With Ricette connected this is Ricette's own shopping list (same file, same rules: merge items,
// departments, drag to order, tick at the shop, put away in the pantry), so groceries from meals
// and "running low" items are there by themselves, and anything you add here shows up in Ricette
// too. Without Ricette it's Everyday's own list. Household and personal-care items get departments
// of their own here.

export const SH = () => (ricetteConfigured() ? 'r_shopping' : 'shopping');
export const K = () => (ricetteConfigured() ? kitchen : kitchenOwn);
// List settings shared with Ricette (data/prefs.json) when connected, else kept on this device.
export function shopPref(id, fallback) {
  if (ricetteConfigured()) { const p = get('r_prefs', id); return p && p.value !== undefined ? p.value : fallback; }
  const v = state.settings[`shop_${id}`];
  return v === undefined ? fallback : v;
}
export function setShopPref(id, value) {
  if (ricetteConfigured()) upsert('r_prefs', { ...(get('r_prefs', id) || {}), id, value }, { silent: true });
  else saveSettings({ [`shop_${id}`]: value });
}
// Ricette's data follows a newer contract than this app knows: the list is shown but not saved.
export const listFrozen = () => ricetteConfigured() && contractTooNew();

// The views (shoplist.js): dept / recipe / plain are saved in Ricette's prefs; shop / alpha / newest /
// oldest on this device.
export function listModes() { return availableModes(shopsList().length > 0); }
export function listMode() { return currentMode({ local: state.settings.shopMode, shared: shopPref('listMode', 'dept'), hasShops: shopsList().length > 0 }); }
export function setListMode(m) {
  const to = saveModeTarget(m);
  saveSettings({ shopMode: to.local });
  if (to.shared) setShopPref('listMode', to.shared);
}
export function itemMatches(i, q) { return itemMatchesQ(i, q, (i.shops || []).map(shopName).filter(Boolean)); }

// ---------- shops ----------
// Shops live with the shopping list: in Ricette's repo (data/shops.json) once it's connected.
export function SHOPS() { return ricetteConfigured() ? 'r_shops' : 'shops'; }
export function shopsList() { return live(SHOPS()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.name || '').localeCompare(b.name || '')); }
export function shopName(id) { return get(SHOPS(), id)?.name || ''; }
export function deptOrder() { return byOrder(DEPT_IDS, shopPref('deptOrder', [])); }
// An item's department (depts.js, shared): the one a person chose, else the food dictionary, else keywords.
export const shopDept = (i) => deptOf(i);
export const isFood = (i) => !NONFOOD.includes(shopDept(i));
// A shop by name (case and accents ignored), or a new one (always open; hours can be added in Settings).
function shopByName(name) {
  return shopsList().find((sh) => fold(sh.name) === fold(name))
    || upsert(SHOPS(), { id: uid(), name, minutes: 30, hours: [], place: '', link: '', order: shopsList().length }, { silent: true });
}

// ---------- labels and formatting for shoplist-ui.js ----------
export const slLabels = () => ({
  tick: (n) => t('sl_tick', n), select: (n) => t('sl_select', n), open: t('sl_open'), drag: (n) => t('dragToMove', n),
  runningLow: t('runningLow'), added: (d) => t('sl_added', d), all: t('sl_all'), none: t('sl_none'), views: t('sl_views'), filters: t('sl_filters'),
  shopFilter: t('sl_shopFilter'), lowOnly: t('sl_lowOnly'), mode: (m) => t(`listMode_${m}`), name: t('name'),
  quantity: t('quantity'), unit: t('unit'), department: t('department'), note: t('sl_note'), whereToBuy: t('whichShops'),
  newShop: t('newShop'), newShopPh: t('sl_newShopPh'), anyShopHint: t('sl_anyShopHint'), less: t('sl_less'), more: t('sl_more'),
  save: t('save'), delete: t('delete'), cancel: t('cancel'), inCart: (n) => t('sl_inCart', n),
});
export const slFmt = {
  qty: (i) => qtyText(i.qty, i.unit),
  shopNames: (i) => (i.shops || []).map(shopName).filter(Boolean),
  addedDay: (i) => (addedOf(i) ? t('sl_added', relDay(today(new Date(addedOf(i))))) : ''),
};

export function recipeGroupLabel(k) { return k === '__pantry' ? `🔁 ${t('restock')}` : k === '__other' ? `🧺 ${t('otherItems')}` : `🍽 ${k}`; }
const groupLabel = (g) => (g.kind === 'all' ? '' : g.kind === 'recipe' ? recipeGroupLabel(g.key) : g.kind === 'shop' ? `🏪 ${shopName(g.key)}` : g.kind === 'anyShop' ? `🛒 ${t('anyShop')}` : `${deptIcon(g.key)} ${t(`dept_${g.key}`)}`);

// Open items as the list shows them: [{ key, kind, label, items }].
export function shopGroups(open, mode = listMode()) {
  return groupItems(open, mode, { deptOf: shopDept, deptOrder: deptOrder(), recipeOrder: shopPref('recipeOrder', []), shops: shopsList(), lang: getLang() })
    .map((g) => ({ ...g, label: groupLabel(g) }));
}
// The same as [[key, label, items]] (sharing, saving the order).
export function listGroups(open, mode = listMode()) { return shopGroups(open, mode).map((g) => [g.key, g.label, g.items]); }

// ---------- the view ----------
// ui.shopQ (search), ui.shopFilters {shop, low}, ui.shopSel (Set of ids while selecting),
// ui.shopReorder (drag handles in a grouped view), ui.cartOpen, ui.shopUndo {msg, items}.
const filters = () => ui.shopFilters || {};
const visible = () => {
  const q = (ui.shopQ || '').trim();
  return live(SH()).filter((i) => !q || itemMatches(i, q));
};
const openItems = () => filterItems(visible().filter((i) => !i.checked), filters(), { shops: shopsList() });
const cartItems = () => live(SH()).filter((i) => i.checked).sort(byItemOrder);

function toolRow(mode) {
  const n = filterCount(filters());
  const f = filters();
  const chips = [
    f.shop && shopName(f.shop) ? `<button type="button" class="sl-chip on" data-action="shop-filter-off" data-id="shop">🏪 ${esc(shopName(f.shop))} ✕</button>` : '',
    f.low ? `<button type="button" class="sl-chip on" data-action="shop-filter-off" data-id="low">${esc(t('sl_lowOnly'))} ✕</button>` : '',
  ].join('');
  return `<div class="task-tools shop-tools">${searchBox({ id: 'shop-q', value: ui.shopQ || '', ph: t('searchItems') })}
    <button type="button" class="btn small shop-view" data-action="shop-view" aria-label="${esc(t('sl_views'))}">⇅ ${esc(t(`listMode_${mode}`))}${n ? ` · ${n}` : ''}</button>
    <button type="button" class="btn small icon-btn" data-action="shop-menu" aria-label="${esc(t('sl_menu'))}">⋯</button>
    <button type="button" class="btn small icon-btn" data-action="shop-info" aria-label="${esc(t('shopInfo'))}" title="${esc(t('shopInfo'))}">ⓘ</button></div>
    ${chips ? `<div class="sl-chips shop-filter-chips">${chips}</div>` : ''}`;
}

export function viewShop() {
  const q = (ui.shopQ || '').trim();
  const mode = listMode();
  const open = openItems();
  const sel = ui.shopSel || null;
  const reorder = Boolean(ui.shopReorder) && GROUPED_MODES.includes(mode);
  const drag = DRAG_MODES.includes(mode) && !q && !filterCount(filters()) && !sel && (mode === 'plain' || reorder);
  const groups = shopGroups(open, mode);
  const done = cartItems().filter((i) => !q || itemMatches(i, q));
  const allDone = cartItems();
  const labels = slLabels();
  const food = allDone.filter(isFood).length;
  const any = live(SH()).length > 0;
  // (v52) the explanation and the sync line are behind ⓘ; adding goes through the + button
  return `
  ${listFrozen() ? `<p class="sl-frozen" role="alert">⚠ ${esc(t('sl_contract'))}</p>` : ''}
  ${ui.shopUndo ? `<div class="reflow"><span>${esc(ui.shopUndo.msg)}</span><button class="linkish" type="button" data-action="shop-undo">${esc(t('undo'))}</button><button class="icon" type="button" data-action="shop-undo-ok" aria-label="${esc(t('close'))}">✕</button></div>` : ''}
  ${toolRow(mode)}
  ${reorder ? `<div class="reflow sl-bar"><span>${esc(t('sl_reorderBar'))}</span><button class="btn small primary" type="button" data-action="shop-reorder-done">${esc(t('sl_done'))}</button></div>` : ''}
  ${sel ? `<div class="reflow sl-bar sel"><span>${esc(t('sl_nSelected', sel.size))}</span>
    <button class="btn small" type="button" data-action="shop-sel-shops" ${sel.size ? '' : 'disabled'}>${esc(t('sl_setShops'))}</button>
    <button class="btn small danger" type="button" data-action="shop-sel-delete" ${sel.size ? '' : 'disabled'}>${esc(t('delete'))}</button>
    <button class="btn small primary" type="button" data-action="shop-sel-done">${esc(t('sl_done'))}</button></div>` : ''}
  ${open.length ? listHtml(groups, { labels, fmt: slFmt, mode, drag, selecting: Boolean(sel), isSelected: (id) => Boolean(sel?.has(id)) })
    : !any ? `<p class="empty">${esc(t('listEmpty'))}</p>` : (q || filterCount(filters())) ? `<p class="empty">${esc(t('noItemMatch'))}</p>` : `<p class="empty">${esc(t('sl_allInCart'))}</p>`}
  ${(ui.cartOpen || q) && done.length ? `<div class="sl-cart"><h3 class="sl-ghead"><span class="sl-glabel">🛒 ${esc(t('inCart'))}</span><small class="sl-count">${done.length}</small></h3>${rowsHtml(done, { labels, fmt: slFmt, mode })}
    ${ricetteConfigured() && food ? hint('putAwayFood') : ''}</div>` : ''}
  ${cartBarHtml({ labels, count: allDone.length, open: Boolean(ui.cartOpen), main: { label: `📦 ${ricetteConfigured() && food ? t('putAway') : t('doneShopping')}` } })}`;
}

// ⓘ: where this list comes from, and when it last synced with Ricette.
export function openShopInfo() {
  openModal(`
    <h2>ⓘ ${esc(t('shopInfo'))}</h2>
    <p>${esc(ricetteConfigured() ? t('shopFromRicette') : t('shopOwn'))}</p>
    ${ricetteConfigured()
    ? `<p class="sync-line"><span class="ok-dot"></span>${esc(state.meta.ricetteSynced ? t('ricetteSyncedAt', new Date(state.meta.ricetteSynced).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', hour12: false })) : t('ricetteNotYet'))}</p>`
    : `<p class="sync-line"><a href="#/settings/adv">${esc(t('connectRicette'))}</a></p>`}
    <div class="button-row">${ricetteConfigured() ? `<button class="btn" value="sync">↻ ${esc(t('syncNow'))}</button>` : ''}<button class="btn primary" value="cancel">${esc(t('close'))}</button></div>`, (form, action) => { if (action === 'sync') runSync(); });
}
export function shopAdd(text) {
  const ing = parseIngredient(text);
  if (!ing.name) return;
  // No stored department: it's worked out when shown (the dictionary knows household and care too).
  return K().addToShopping({ name: ing.name, qty: ing.qty, unit: ing.unit, note: ing.note }, '');
}

// Removed items can come back (Undo): the tombstones are simply overwritten.
function removeWithUndo(items) {
  if (!items.length) return;
  for (const i of items) remove(SH(), i.id);
  ui.shopUndo = { msg: t('sl_removed', items.length), items: items.map((i) => ({ ...i })) };
  clearTimeout(removeWithUndo.timer);
  removeWithUndo.timer = setTimeout(() => { if (ui.shopUndo) { ui.shopUndo = null; changed(); } }, 10000);
  changed();
}
function undoRemove() {
  const u = ui.shopUndo;
  ui.shopUndo = null;
  if (u) for (const i of u.items) { const { deleted, ...rest } = i; upsert(SH(), rest, { silent: true }); }
  changed();
}

export function putAwayCart() {
  const n = K().putAway(isFood, (it) => (it.cat && DEPT_IDS.includes(it.cat) && !NONFOOD.includes(it.cat) ? it.cat : null));
  toast(t('putAwayDone', n));
  ui.cartOpen = false;
  changed();
}

// The list's own end of a "Leave the list" (another tab): reordering stops.
export function leaveShop() { ui.shopReorder = false; ui.shopSel = null; }

// ---------- clicks and ticks (app.js routes them here) ----------
// The checkboxes (a change): in the cart or not, or selected while selecting.
export function shopChange(el) {
  const { action, id } = el.dataset;
  if (action === A.toggle) { K().setChecked(id, el.checked); changed(); return true; }
  if (action === A.select) { toggleSel(id, el.checked); return true; }
  return false;
}
function toggleSel(id, on) {
  const sel = ui.shopSel;
  if (!sel) return;
  if (on ?? !sel.has(id)) sel.add(id); else sel.delete(id);
  changed();
}

// Buttons on the page; returns true when it was one of the list's.
export function shopClick(btn, { planTrips, shareList } = {}) {
  const { action, id, value } = btn.dataset;
  switch (action) {
    case A.open: openShopItem(get(SH(), id)); return true;
    case A.select: toggleSel(id); return true;
    case A.selectGroup: {
      const g = shopGroups(openItems()).find((x) => x.key === value);
      if (!g || !ui.shopSel) return true;
      const all = g.items.every((i) => ui.shopSel.has(i.id));
      for (const i of g.items) if (all) ui.shopSel.delete(i.id); else ui.shopSel.add(i.id);
      changed();
      return true;
    }
    case A.cartToggle: ui.cartOpen = !ui.cartOpen; changed(); return true;
    case A.cartMain: putAwayCart(); return true;
    case 'shop-view': openViewSheet(); return true;
    case 'shop-menu': openShopMenu({ planTrips, shareList }); return true;
    case 'shop-filter-off': ui.shopFilters = { ...filters(), [id]: id === 'low' ? false : '' }; changed(); return true;
    case 'shop-reorder-done': ui.shopReorder = false; changed(); return true;
    case 'shop-sel-done': ui.shopSel = null; changed(); return true;
    case 'shop-sel-delete': { const items = [...(ui.shopSel || [])].map((x) => get(SH(), x)).filter(Boolean); ui.shopSel = null; removeWithUndo(items); return true; }
    case 'shop-sel-shops': openSelShops(); return true;
    case 'shop-undo': undoRemove(); return true;
    case 'shop-undo-ok': ui.shopUndo = null; changed(); return true;
    default: return false;
  }
}

// ⇅: the views and the filters, in a sheet.
function openViewSheet() {
  const draw = () => {
    openModal(`<h2>${esc(t('sl_views'))}</h2>
      ${viewSheetHtml({ labels: slLabels(), modes: listModes(), mode: listMode(), filters: filters(), shops: shopsList().map((s) => ({ id: s.id, name: s.name })), hasLow: live(SH()).some((i) => i.auto && !i.checked) })}
      <div class="button-row"><button class="btn primary" value="cancel" formnovalidate>${esc(t('sl_done'))}</button></div>`, () => {}, { cls: 'sl-dialog' });
    modal.querySelector('form').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === A.view) { setListMode(b.dataset.value); ui.shopReorder = false; changed(); draw(); }
      if (b.dataset.action === A.filter) {
        const f = filters();
        ui.shopFilters = b.dataset.kind === 'low' ? { ...f, low: !f.low } : { ...f, shop: f.shop === b.dataset.value ? '' : b.dataset.value };
        changed(); draw();
      }
    });
  };
  draw();
}

// ⋯: Everyday's extras (planning the trips) and the list's own actions.
function openShopMenu({ planTrips, shareList }) {
  const mode = listMode();
  const open = openItems().length;
  const entries = [
    open ? { id: 'plan', label: `🛒 ${t('planTrips')}` } : null,
    open ? { id: 'share', label: t('shareList') } : null,
    open ? { id: 'select', label: t('sl_selectMode') } : null,
    open && GROUPED_MODES.includes(mode) ? { id: 'reorder', label: t('sl_reorder') } : null,
    cartItems().length ? { id: 'clear', label: t('sl_clearCart'), danger: true } : null,
  ].filter(Boolean);
  openModal(`<h2>${esc(t('tabShop'))}</h2>${entries.length ? menuHtml(entries) : `<p class="empty">${esc(t('listEmpty'))}</p>`}
    ${open ? `<p class="hint">${esc(shopsList().length ? t(tripMode() === 'oneTrip' ? 'planTripsHintOne' : 'planTripsHintPer') : t('planTripsHintNoShops'))}</p>` : ''}
    <div class="button-row"><button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, () => {}, { cls: 'sl-dialog' });
  modal.querySelector('form').addEventListener('click', (e) => {
    const b = e.target.closest(`[data-action="${A.menuItem}"]`);
    if (!b) return;
    modal.close();
    const v = b.dataset.value;
    if (v === 'plan') planTrips?.();
    if (v === 'share') shareList ? shareList() : shareShopList();
    if (v === 'select') { ui.shopSel = new Set(); ui.shopReorder = false; changed(); }
    if (v === 'reorder') { ui.shopReorder = true; ui.shopSel = null; changed(); }
    if (v === 'clear') removeWithUndo(cartItems());
  });
}

// While selecting: the shops for all of them at once.
function openSelShops() {
  const ids = [...(ui.shopSel || [])];
  let picked = [];
  const draw = () => {
    openModal(`<h2>${esc(t('whichShops'))}</h2>
      <p class="hint">${esc(t('sl_nSelected', ids.length))}</p>
      <div class="sl-chips" id="sl-shop-chips">${shopChipsHtml(shopsList(), picked)}</div>
      <small class="sl-hint">${esc(t('sl_anyShopHint'))}</small>
      <div class="button-row"><button class="btn primary" value="ok">${esc(t('save'))}</button><button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, () => {
      for (const id of ids) { const it = get(SH(), id); if (it) upsert(SH(), { ...it, shops: [...picked] }, { silent: true }); }
      ui.shopSel = null;
      changed();
    }, { cls: 'sl-dialog' });
    modal.querySelector('form').addEventListener('click', (e) => {
      const b = e.target.closest(`[data-action="${A.pickShop}"]`);
      if (!b) return;
      picked = picked.includes(b.dataset.id) ? picked.filter((x) => x !== b.dataset.id) : [...picked, b.dataset.id];
      modal.querySelector('#sl-shop-chips').innerHTML = shopChipsHtml(shopsList(), picked);
    });
  };
  draw();
}

// ---------- the item sheet ----------
const UNITS = ['', 'g', 'kg', 'ml', 'l', 'pcs', 'packet', 'can', 'tbsp', 'tsp', 'bunch', 'slice'];
// − / +: by 1; grams and millilitres by 10, or by 100 from 100 up (as Ricette).
export function stepQty(v, unit, dir) {
  const n = Number(String(v || '').replace(',', '.')) || 0;
  const step = unit === 'g' || unit === 'ml' ? ((dir > 0 ? n >= 100 : n > 100) ? 100 : 10) : 1;
  const next = Math.max(0, Math.round((n + dir * step) * 1000) / 1000);
  return next ? String(next) : '';
}

export function openShopItem(it) {
  if (!it) return;
  const units = [...UNITS];
  if (it.unit && !units.includes(it.unit)) units.push(it.unit);
  const cat0 = shopDept(it);
  let picked = [...(it.shops || [])].filter((id) => get(SHOPS(), id) && !get(SHOPS(), id).deleted);
  openModal(`<h2>${esc(it.name)}</h2>
    ${itemSheetHtml({
    item: it, labels: slLabels(), cat: cat0, picked,
    units: units.map((u) => ({ value: u, label: u || '—' })),
    depts: DEPTS.map((d) => ({ id: d.id, label: `${d.icon} ${t(`dept_${d.id}`)}` })),
    shops: shopsList().map((s) => ({ id: s.id, name: s.name })),
    origin: !it.auto && (it.sources || []).length ? t('forRecipes', it.sources.join(', ')) : '',
  })}`, (form, action) => {
    if (action === 'delete') { removeWithUndo([get(SH(), it.id)].filter(Boolean)); return; }
    if (action !== 'ok') return;
    const cur = get(SH(), it.id);
    if (!cur) return;
    const q = form.qty.value.trim().replace(',', '.');
    const name = form.elements.namedItem('name').value.trim() || cur.name;
    // a new name: the food again from it, unless a person pinned it in Ricette
    const next = { ...(name !== cur.name ? refood(cur, name) : cur), name, qty: q === '' ? null : Number(q) || null, unit: form.unit.value, note: form.note.value.trim(), shops: [...picked] };
    if (form.cat.value !== cat0) next.cat = form.cat.value;
    upsert(SH(), next, { silent: true });
    changed();
  }, { cls: 'sl-dialog' });
  const form = modal.querySelector('form');
  const redrawChips = () => {
    const box = form.querySelector('#sl-shop-chips');
    for (const c of box.querySelectorAll(`[data-action="${A.pickShop}"]`)) c.remove();
    box.insertAdjacentHTML('afterbegin', shopChipsHtml(shopsList().map((s) => ({ id: s.id, name: s.name })), picked));
  };
  const addShop = () => {
    const input = form.querySelector('#sl-new-shop-name');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    const sh = shopByName(name);
    if (!picked.includes(sh.id)) picked.push(sh.id);
    input.value = '';
    redrawChips();
  };
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === A.qtyDec || a === A.qtyInc) form.qty.value = stepQty(form.qty.value, form.unit.value, a === A.qtyInc ? 1 : -1);
    if (a === A.pickShop) { picked = picked.includes(b.dataset.id) ? picked.filter((x) => x !== b.dataset.id) : [...picked, b.dataset.id]; redrawChips(); }
    if (a === A.newShop) addShop();
  });
  // Enter saves (Save is the sheet's first submit button), except in the new shop's name: there it adds the shop.
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'sl-new-shop-name') return;
    e.preventDefault();
    addShop();
  });
}

// ---------- a trip's checklist (Planner → the grocery trip) ----------
export function tripRowsHtml(items) { return rowsHtml(items, { labels: slLabels(), fmt: slFmt, mode: 'shop' }); }

// After a drag: save the new order of the items, or of the groups (shared with Ricette).
export function onSorted({ kind, group, keys }) {
  if (kind === 'tasks') {
    // Your own order: the whole list (all groups), with this group's tasks as dragged.
    reorderSubset(manualOrder().map((x) => x.id), keys).forEach((id, n) => { const x = get('tasks', id); if (x && x.order !== n) upsert('tasks', { ...x, order: n }, { silent: true }); });
    changed();
    return;
  }
  if (kind === 'items') {
    const open = live(SH()).filter((i) => !i.checked);
    const flat = listGroups(open).flatMap(([k, , list]) => (k === group ? keys.map((id) => list.find((i) => i.id === id)).filter(Boolean) : list));
    flat.forEach((i, n) => { if (i.order !== n) upsert(SH(), { ...i, order: n }, { silent: true }); });
  } else if (kind === 'groups') {
    if (group === 'shop') {
      reorderSubset(shopsList().map((x) => x.id), keys).forEach((id, n) => { const sh = get(SHOPS(), id); if (sh && sh.order !== n) upsert(SHOPS(), { ...sh, order: n }, { silent: true }); });
    }
    else if (group === 'dept') setShopPref('deptOrder', reorderSubset(deptOrder(), keys));
    else if (group === 'recipe') setShopPref('recipeOrder', reorderSubset(shopPref('recipeOrder', []), keys).slice(-200));
  }
  changed();
}

export async function shareShopList() {
  const line = (i) => `• ${[qtyText(i.qty, i.unit), i.name].filter(Boolean).join(' ')}`;
  const text = listGroups(live(SH()).filter((i) => !i.checked))
    .map(([, label, items]) => [label, ...items.map(line)].filter(Boolean).join('\n')).join('\n\n');
  if (navigator.share) { try { await navigator.share({ title: t('tabShop'), text }); } catch { /* cancelled */ } return; }
  try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { /* ignore */ }
}
