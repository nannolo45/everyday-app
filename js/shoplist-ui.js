// The shopping list's building blocks as HTML strings (v2), shared by Ricette and Everyday.
// Pure functions: no DOM, no storage, no imports. Each app supplies the labels (its own translations),
// the formatting of quantities, and routes the data-action clicks (all listed in SL_ACTIONS) to its own code.
// Markup for drag and drop follows sortable.js: data-sortable / data-sort-key / .drag-handle.

export const SL_ACTIONS = {
  toggle: 'sl-toggle',            // checkbox: in the cart or not            data-id
  open: 'sl-open',                // the item's name: open its sheet          data-id
  select: 'sl-select',            // checkbox while selecting                 data-id
  selectGroup: 'sl-select-group', // "All" / "None" on a group while selecting data-value = group key
  view: 'sl-view',                // a view chip in the view sheet            data-value = mode
  filter: 'sl-filter',            // a filter chip                            data-kind = shop | low, data-value
  cartToggle: 'sl-cart-toggle',   // the cart bar's count: show / hide the cart
  cartMain: 'sl-cart-main',       // the cart bar's main action (the host names it)
  menuItem: 'sl-menu-item',       // an entry of the ⋯ menu                   data-value = the host's id
  qtyDec: 'sl-qty-dec',           // item sheet: − (the host changes the qty field)
  qtyInc: 'sl-qty-inc',           // item sheet: +
  pickShop: 'sl-pick-shop',       // item sheet: a shop chip                  data-id = shop id
  newShop: 'sl-new-shop',         // item sheet: "+ New shop" (name in #sl-new-shop-name)
  save: 'sl-save',                // item sheet: Save (also a submit button, value="ok")
  remove: 'sl-delete',            // item sheet: Delete (also value="delete")
};

// The labels a host passes in (labels[key]; the functions get the arguments shown).
export const SL_LABELS = [
  'tick',        // (name) → aria label of the checkbox, e.g. "pane: in the cart"
  'select',      // (name) → aria label while selecting
  'open',        // title of the name button, e.g. "Change quantity, note or shops"
  'drag',        // (name) → aria label of a drag handle
  'runningLow',  // badge on items the pantry added
  'added',       // (day) → "added today"
  'all', 'none', // select a whole group / none of it
  'views', 'filters', 'shopFilter', 'lowOnly', // view sheet headings and chips
  'mode',        // (mode) → the view's name
  'name', 'quantity', 'unit', 'department', 'note', 'whereToBuy', 'newShop', 'newShopPh', 'anyShopHint',
  'less', 'more', 'save', 'delete', 'cancel',
  'inCart',      // (n) → "In the cart · 3"
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const L = (labels, key, ...args) => { const v = labels?.[key]; return typeof v === 'function' ? v(...args) : (v ?? key); };
const A = SL_ACTIONS;
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';

/**
 * The meta line under an item's name: quantity · recipes · shops · note · day added.
 * fmt: { qty(item) → '2 l', shopNames(item) → ['Bakery'], addedDay(item) → 'today' } (the host's formatting).
 * The current view leaves out what the group already says (recipes in "Recipes", shops in "Shops").
 */
export function metaParts(item, { mode = 'dept', fmt = {} } = {}) {
  const parts = [];
  const q = fmt.qty ? fmt.qty(item) : '';
  if (q) parts.push(q);
  if (mode !== 'recipe' && !item.auto && (item.sources || []).length) parts.push(item.sources.join(', '));
  const shops = mode !== 'shop' && fmt.shopNames ? fmt.shopNames(item) : [];
  if (shops.length) parts.push(shops.join(', '));
  if (item.note) parts.push(item.note);
  if ((mode === 'newest' || mode === 'oldest') && fmt.addedDay && fmt.addedDay(item)) parts.push(fmt.addedDay(item));
  return parts;
}

/**
 * One row. opts: { labels, fmt, mode, drag, selecting, selected }
 * - normal: ⠿ (only when drag), checkbox (sl-toggle), the name + meta (sl-open)
 * - selecting: a selection checkbox (sl-select) instead, the name selects too
 * No delete button on the row: delete from the item sheet or by selecting.
 */
export function rowHtml(item, opts = {}) {
  const { labels, drag = false, selecting = false } = opts;
  const selected = opts.selected ?? (opts.isSelected ? Boolean(opts.isSelected(item.id)) : false);
  const meta = metaParts(item, opts);
  const id = esc(item.id);
  const text = `<span class="sl-name">${esc(item.name)}</span>${item.auto ? ` <span class="sl-badge">${esc(L(labels, 'runningLow'))}</span>` : ''}${meta.length ? `<span class="sl-meta">${esc(meta.join(' · '))}</span>` : ''}`;
  if (selecting && !item.checked) {
    return `<li class="sl-row selecting${selected ? ' on' : ''}" data-id="${id}">
      <input type="checkbox" class="sl-check" data-action="${A.select}" data-id="${id}" ${selected ? 'checked' : ''} aria-label="${esc(L(labels, 'select', item.name))}">
      <button type="button" class="sl-main" data-action="${A.select}" data-id="${id}">${text}</button>
    </li>`;
  }
  return `<li class="sl-row${item.checked ? ' checked' : ''}" data-id="${id}" ${drag ? `data-sort-key="${id}"` : ''}>
    ${drag ? `<button type="button" class="drag-handle sl-handle" id="h-${id}" aria-label="${esc(L(labels, 'drag', item.name))}">${GRIP}</button>` : ''}
    <input type="checkbox" class="sl-check" data-action="${A.toggle}" data-id="${id}" ${item.checked ? 'checked' : ''} aria-label="${esc(L(labels, 'tick', item.name))}">
    <button type="button" class="sl-main" data-action="${A.open}" data-id="${id}" title="${esc(L(labels, 'open'))}">${text}</button>
  </li>`;
}

/** Rows on their own (e.g. a trip's checklist): <ul class="sl-rows">…</ul>. sortKey = group key for dragging. */
export function rowsHtml(items, opts = {}, sortKey = '') {
  return `<ul class="sl-rows" ${opts.drag && sortKey ? `data-sortable="items" data-group="${esc(sortKey)}"` : ''}>${items.map((i) => rowHtml(i, opts)).join('')}</ul>`;
}

/**
 * A group heading. group: { key, kind, label, items, extra? (host HTML, e.g. a shop's opening status) }
 * opts: { labels, drag, selecting, allSelected }
 */
export function groupHeadHtml(group, opts = {}) {
  const { labels, drag = false, selecting = false, allSelected = false, mode = '' } = opts;
  const canDrag = drag && group.kind !== 'anyShop';
  return `<h3 class="sl-ghead">${canDrag ? `<button type="button" class="drag-handle sl-handle" id="g-${esc(mode)}-${esc(group.key)}" aria-label="${esc(L(labels, 'drag', group.label))}">${GRIP}</button>` : ''}<span class="sl-glabel">${esc(group.label)}</span>${group.extra || ''}${selecting
    ? `<button type="button" class="sl-link" data-action="${A.selectGroup}" data-value="${esc(group.key)}">${esc(L(labels, allSelected ? 'none' : 'all'))}</button>`
    : `<small class="sl-count">${group.items.length}</small>`}</h3>`;
}

/**
 * The whole list. groups: [{ key, kind, label, items, extra? }]; kind 'all' = one unnamed group.
 * opts: rowHtml's options + { mode, isSelected(id) }.
 */
export function listHtml(groups, opts = {}) {
  const { drag = false, mode = '', selecting = false, isSelected = () => false } = opts;
  const rows = (g) => rowsHtml(g.items, { ...opts, drag: drag && !selecting }, g.key);
  if (groups.length === 1 && groups[0].kind === 'all') return `<div class="sl-list flat">${rowsHtml(groups[0].items, { ...opts, drag: drag && !selecting }, 'all')}</div>`;
  return `<div class="sl-list" ${drag && !selecting ? `data-sortable="groups" data-group="${esc(mode)}"` : ''}>${groups.map((g) => {
    const sel = g.items.length > 0 && g.items.every((i) => isSelected(i.id));
    return `<section class="sl-group" ${g.kind === 'anyShop' ? '' : `data-sort-key="${esc(g.key)}"`} data-kind="${esc(g.kind)}">${groupHeadHtml(g, { ...opts, drag: drag && !selecting, allSelected: sel })}${rows(g)}</section>`;
  }).join('')}</div>`;
}

/**
 * The view and filters sheet's content. { labels, modes, mode, filters: {shop, low}, shops: [{id, name}], hasLow }
 */
export function viewSheetHtml({ labels, modes = [], mode, filters = {}, shops = [], hasLow = false } = {}) {
  const chip = (action, attrs, label, on) => `<button type="button" class="sl-chip${on ? ' on' : ''}" data-action="${action}" ${attrs} aria-pressed="${on}">${esc(label)}</button>`;
  return `<section class="sl-sec"><h4 class="sl-sech">${esc(L(labels, 'views'))}</h4>
    <div class="sl-chips">${modes.map((m) => chip(A.view, `data-value="${esc(m)}"`, L(labels, 'mode', m), m === mode)).join('')}</div></section>
    ${shops.length || hasLow ? `<section class="sl-sec"><h4 class="sl-sech">${esc(L(labels, 'filters'))}</h4>
    ${shops.length ? `<div class="sl-sub">${esc(L(labels, 'shopFilter'))}</div><div class="sl-chips">${shops.map((s) => chip(A.filter, `data-kind="shop" data-value="${esc(s.id)}"`, s.name, filters.shop === s.id)).join('')}</div>` : ''}
    ${hasLow ? `<div class="sl-chips">${chip(A.filter, 'data-kind="low" data-value="1"', L(labels, 'lowOnly'), Boolean(filters.low))}</div>` : ''}
    </section>` : ''}`;
}

/**
 * The item sheet's content (the host puts it in its own dialog/form).
 * { item, labels, units: [{value, label}], depts: [{id, label}], cat, shops: [{id, name}], picked: [shop ids], origin: '' }
 * Fields: name="name", "qty", "unit", "cat", "note"; the new shop name: #sl-new-shop-name.
 */
export function itemSheetHtml({ item, labels, units = [], depts = [], cat = '', shops = [], picked = [], origin = '' } = {}) {
  return `<div class="sl-sheet">
    <label class="sl-field">${esc(L(labels, 'name'))}<input name="name" value="${esc(item.name)}" required autocomplete="off"></label>
    <div class="sl-two">
      <label class="sl-field">${esc(L(labels, 'quantity'))}<span class="sl-stepper">
        <button type="button" data-action="${A.qtyDec}" aria-label="${esc(L(labels, 'less'))}">−</button>
        <input name="qty" inputmode="decimal" value="${esc(item.qty ?? '')}">
        <button type="button" data-action="${A.qtyInc}" aria-label="${esc(L(labels, 'more'))}">+</button></span></label>
      <label class="sl-field">${esc(L(labels, 'unit'))}<select name="unit">${units.map((u) => `<option value="${esc(u.value)}" ${u.value === (item.unit || '') ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select></label>
    </div>
    <label class="sl-field">${esc(L(labels, 'department'))}<select name="cat">${depts.map((d) => `<option value="${esc(d.id)}" ${d.id === cat ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></label>
    <div class="sl-field"><span>${esc(L(labels, 'whereToBuy'))}</span>
      <div class="sl-chips" id="sl-shop-chips">${shopChipsHtml(shops, picked)}
        <span class="sl-newshop"><input id="sl-new-shop-name" placeholder="${esc(L(labels, 'newShopPh'))}" autocomplete="off" aria-label="${esc(L(labels, 'newShop'))}"><button type="button" class="sl-chip dashed" data-action="${A.newShop}">+ ${esc(L(labels, 'newShop'))}</button></span>
      </div>
      <small class="sl-hint">${esc(L(labels, 'anyShopHint'))}</small></div>
    <label class="sl-field">${esc(L(labels, 'note'))}<input name="note" value="${esc(item.note || '')}" autocomplete="off"></label>
    ${origin ? `<p class="sl-hint">${esc(origin)}</p>` : ''}
    <div class="sl-actions">
      <button type="submit" class="sl-danger" value="delete" formnovalidate data-action="${A.remove}">${esc(L(labels, 'delete'))}</button>
      <span class="sl-gap"></span>
      <button type="submit" class="sl-cancel" value="cancel" formnovalidate>${esc(L(labels, 'cancel'))}</button>
      <button type="submit" class="sl-primary" value="ok" data-action="${A.save}">${esc(L(labels, 'save'))}</button>
    </div>
  </div>`;
}

/** The shop chips alone, to refresh them after a tap or a new shop. */
export function shopChipsHtml(shops = [], picked = []) {
  return shops.map((s) => { const on = picked.includes(s.id); return `<button type="button" class="sl-chip${on ? ' on' : ''}" data-action="${A.pickShop}" data-id="${esc(s.id)}" role="checkbox" aria-checked="${on}">${esc(s.name)}</button>`; }).join('');
}

/**
 * The cart bar: "In the cart · 3" (shows/hides the cart) + the host's main action (or none).
 * { labels, count, open, main: { label } | null }
 */
export function cartBarHtml({ labels, count = 0, open = false, main = null } = {}) {
  if (!count) return '';
  return `<div class="sl-cartbar">
    <button type="button" class="sl-cartcount" data-action="${A.cartToggle}" aria-expanded="${open}">${esc(L(labels, 'inCart', count))} <span aria-hidden="true">${open ? '▾' : '▴'}</span></button>
    ${main ? `<button type="button" class="sl-cartmain" data-action="${A.cartMain}">${esc(main.label)}</button>` : ''}
  </div>`;
}

/** A ⋯ menu's entries: [{ id, label, danger? }] → buttons (sl-menu-item, data-value = id). */
export function menuHtml(entries = []) {
  return `<div class="sl-menu">${entries.map((e) => `<button type="button" class="sl-menuitem${e.danger ? ' danger' : ''}" data-action="${A.menuItem}" data-value="${esc(e.id)}">${esc(e.label)}</button>`).join('')}</div>`;
}
