// (v73, Ricette v55) When something runs out. After Everyday itself lowers the pantry (a meal ticked done,
// an item unticked that had been put away on the spot), each product that became finished (or went from
// low to out) is offered for the shopping list, the way Ricette does. The shared pref `lowAction` decides:
// 'ask' (default) a sheet, 'auto' straight on the list with Undo, 'off' nothing. Items are made only with
// the shared kitchen.addLowItem; "No, grazie" = kitchen.skipLow. Ricette alone keeps those items up to date.
import { esc, kitchen, toast } from './core.js';
import { t } from './i18n.js';
import { lowBuy, lowMode, lowState, isLevel, num, round } from './kitchen.js';
import { changed } from './shell.js';
import { contractTooNew, get, live, remove, upsert } from './store.js';
import { ricetteConfigured } from './sync.js';
import { openModal } from './widgets.js';

export const lowPref = () => lowMode(get('r_prefs', 'lowAction')?.value);
export function setLowPref(v) {
  if (!ricetteConfigured() || contractTooNew()) return;
  const cur = get('r_prefs', 'lowAction');
  upsert('r_prefs', { ...(cur || {}), id: 'lowAction', value: lowMode(v) }, { silent: true });
}
// Before changing the pantry: what each product was.
export const pantrySnap = () => new Map(live('r_pantry').map((p) => [p.id, { st: lowState(p), qty: num(p.qty) }]));
// After: the products that just ran out (or got low), on no list and not refused.
export function newlyLow(before) {
  return live('r_pantry').filter((p) => {
    const now = lowState(p); if (!now || p.lowSkip || kitchen.onList(p)) return false;
    const was = before.get(p.id)?.st || null;
    return !was || (was === 'low' && now === 'out');
  }).map((p) => ({ p, qty: lowBuy(p, before.get(p.id)?.qty ?? null) }));
}
// Call after the pantry changed; `before` = pantrySnap() taken first.
export function afterPantryChange(before) {
  if (!ricetteConfigured() || contractTooNew()) return;
  const list = newlyLow(before);
  if (!list.length) return;
  const mode = lowPref();
  if (mode === 'off') return;
  if (mode === 'auto') { addAll(list, { undo: true }); return; }
  setTimeout(() => openLowPrompt(list), 0);
}
const qtyText = (q, unit) => (q == null ? '' : `${String(round(q)).replace('.', ',')}${unit ? ` ${unit}` : ''}`);
const stepOf = (unit, q) => (/^(g|ml)$/i.test(unit) ? (q >= 500 ? 100 : 50) : /^(kg|l)$/i.test(unit) ? 0.5 : 1);
function addAll(list, { undo = false } = {}) {
  const made = list.map(({ p, qty }) => ({ p, it: kitchen.addLowItem(get('r_pantry', p.id) || p, qty) }));
  changed();
  const names = list.map((x) => x.p.name).join(', ');
  toast(t('lowAdded', names), 6000, undo ? [{ label: t('undo'), run: () => {
    for (const { p, it } of made) { if (it) remove('r_shopping', it.id); kitchen.skipLow(get('r_pantry', p.id) || p); }
    changed(); toast(t('undone'));
  } }] : null);
}
// The sheet: one product with − / + on the amount, or several with "Aggiungi tutte".
export function openLowPrompt(list) {
  const items = list.map((x) => ({ ...x }));
  const one = items.length === 1;
  const row = (x, i) => {
    const out = lowState(x.p) === 'out';
    const staple = isLevel(x.p) || x.qty == null;
    return `<li class="low-row"><span class="low-n"><b>${esc(x.p.name)}</b><small>${esc(out ? t('lowOut') : t('lowLow'))}</small></span>
      ${staple ? '' : `<span class="low-q"><button type="button" class="icon" data-lq="${i}" data-d="-1" aria-label="−">−</button><b data-lqv="${i}">${esc(qtyText(x.qty, x.p.unit))}</b><button type="button" class="icon" data-lq="${i}" data-d="1" aria-label="+">+</button></span>`}
      ${one ? '' : `<label class="low-pick"><input type="checkbox" name="pick" value="${i}" checked aria-label="${esc(x.p.name)}"></label>`}</li>`;
  };
  const title = one ? t(lowState(items[0].p) === 'out' ? 'lowTitleOut' : 'lowTitleLow', items[0].p.name) : t('lowTitleN', items.length);
  const addLabel = () => (one ? (items[0].qty == null || isLevel(items[0].p) ? t('lowAddOne') : t('lowAddQty', qtyText(items[0].qty, items[0].p.unit))) : t('lowAddAll'));
  openModal(`<h2>${esc(title)}</h2><p class="hint">${esc(t('lowWhy'))}</p>
    <ul class="list low-list">${items.map(row).join('')}</ul>
    <label class="check"><input type="checkbox" name="autoNext"> <span>${esc(t('lowAutoNext'))}</span></label>
    <div class="button-row"><button class="btn primary" value="low-add">🛒 <span class="low-add-l">${esc(addLabel())}</span></button><button class="btn" value="low-no">${esc(t('lowNo'))}</button></div>`, (form, action) => {
    if (action !== 'low-add' && action !== 'low-no') return;
    const picked = one ? [0] : [...form.querySelectorAll('input[name=pick]:checked')].map((el) => Number(el.value));
    if (form.autoNext?.checked) setLowPref('auto');
    if (action === 'low-add') {
      const yes = items.filter((_, i) => picked.includes(i));
      for (const x of items.filter((_, i) => !picked.includes(i))) kitchen.skipLow(get('r_pantry', x.p.id) || x.p);
      if (yes.length) addAll(yes); else changed();
    } else { for (const x of items) kitchen.skipLow(get('r_pantry', x.p.id) || x.p); changed(); }
  }, { cls: 'sheet low-sheet' });
  const m = document.querySelector('dialog[open] .low-list')?.closest('form') || document.querySelector('dialog[open]');
  document.querySelector('dialog[open] .low-list')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lq]'); if (!b) return;
    const i = Number(b.dataset.lq); const x = items[i]; const st = stepOf(x.p.unit || '', x.qty || 0);
    x.qty = Math.max(st, round((x.qty || 0) + Number(b.dataset.d) * st));
    m.querySelector(`[data-lqv="${i}"]`).textContent = qtyText(x.qty, x.p.unit);
    const l = m.querySelector('.low-add-l'); if (l) l.textContent = addLabel();
  });
}
