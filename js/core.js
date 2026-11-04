// core.js: moved from app.js (v36). See app.js for how the modules fit together.
import { getLang, t } from './i18n.js';
import { isStep } from './kinds.js';
import { makeKitchen } from './kitchen-host.js';
import { addDays, fmtTime, parseDate, today } from './plan.js';
import { get, has, live, remove, state, uid, upsert } from './store.js';

// Shown under Settings; keep in step with VERSION in sw.js (a unit test checks).
export const APP_VERSION = 'v85';

export const $ = (sel, root = document) => root.querySelector(sel);
// Hints that were emptied in i18n (the guide explains instead) render nothing.
export const hint = (key, ...a) => { const v = t(key, ...a); return v ? `<p class="hint">${esc(v)}</p>` : ''; };
export const small = (key, ...a) => { const v = t(key, ...a); return v ? `<small>${esc(v)}</small>` : ''; };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const view = $('#view');
export const modal = $('#modal');
export const ui = { view: null, expanded: new Set(), connMsg: '', ricMsg: '', dragging: false, scrolledFor: null, showDone: false, showHelpers: false, showConflicts: false };

export const PPM = 1.2; // timeline pixels per minute (72 px per hour)
export const GROCERY_MINUTES = 45;

// Built-in categories have fixed ids, so every device creates the same ones.
export const DEFAULT_CATEGORIES = [
  { id: 'work', key: 'work', color: '#3d6fa8' },
  { id: 'personal', key: 'personal', color: '#8a5cb8' },
  { id: 'health', key: 'health', color: '#3f8f5a' },
  { id: 'meals', key: 'meals', color: '#c4692b' },
  { id: 'home', key: 'home', color: '#a88419' },
];
export const PALETTE = ['#3d6fa8', '#8a5cb8', '#3f8f5a', '#c4692b', '#a88419', '#c0455e', '#2f8f8f', '#6b7280'];

// Ricette's shopping list and pantry, with the same rules Ricette uses.
export const kitchen = makeKitchen({
  live, get, uid,
  upsert: (c, r) => upsert(c, r, { silent: true }),
  remove: (c, id) => remove(c, id),
}, { pantry: 'r_pantry', shopping: 'r_shopping' });
// ("Running low" items on Ricette's list are Ricette's to add: data contract v1.)
// The same rules on Everyday's own list, for when Ricette isn't connected (no pantry then).
export const kitchenOwn = makeKitchen({
  live, get, uid,
  upsert: (c, r) => upsert(c, r, { silent: true }),
  remove: (c, id) => remove(c, id),
}, { pantry: 'r_pantry', shopping: 'shopping' });

// A short message at the bottom. With actions ([{label, run}]) it holds buttons (Cambia, Annulla…) and
// stays a little longer.
export function toast(msg, ms = 3200, actions = null) {
  const el = $('#toast');
  const hide = () => { el.classList.remove('show', 'act'); el.onclick = null; };
  if (actions?.length) {
    el.innerHTML = `<span class="t-msg">${esc(msg)}</span>${actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join('')}`;
    el.classList.add('act');
    el.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (!b) return; hide(); actions[Number(b.dataset.i)].run(); };
  } else { el.textContent = msg; el.classList.remove('act'); el.onclick = null; }
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hide, actions?.length ? Math.max(ms, 5000) : ms);
  toast.hide = hide;
}
// (v63) close it now (tapping + for the next one)
export function hideToast() { clearTimeout(toast.timer); toast.hide?.(); }

export function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, id, sub] = h.split('/');
  return { name, id: id && decodeURIComponent(id), sub: sub && decodeURIComponent(sub) }; // (v62) #/settings/adv/sync
}

// Left to right, the way a week gets planned: today → events → tasks around them → the plan.
// Shopping is a part of the Tasks tab (#/shop still opens it directly); Settings opens from the gear.
export const TAB_OF = { today: 'today', events: 'events', plan: 'plan', tasks: 'tasks', shop: 'tasks', settings: 'settings' };
export const TABS = ['today', 'events', 'tasks', 'plan'];
// Rules, templates and preparations are power features: shown only when switched on under
// Settings → Advanced, or when the data already uses them.
export function advancedOn() {
  const v = state.settings.advancedFeatures;
  if (v != null) return Boolean(v);
  return live('templates').length > 0 || live('tasks').some((x) => (isStep(x) && !x.check) || (x.rules || []).some((r) => r.then !== 'groceries'));
}

export function planSettings() {
  const s = state.settings;
  return {
    dayStart: s.dayStart * 60, dayEnd: s.dayEnd * 60, snap: Number(s.snap) || 15,
    buffer: Number(s.buffer ?? 5), maxLoad: Number(s.maxLoad ?? 8) * 60,
    splitOver: Number(s.splitOver ?? 4) * 60, // 0 = never split by length alone
  };
}

// ---------- categories ----------

export function categories() { return live('categories').sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || catName(a).localeCompare(catName(b))); }
export function catName(c) { return c ? (c.name || t(`cat_${c.key}`)) : ''; }
export function catColor(id) { return get('categories', id)?.color || ''; }
// A task's categories (v48): \`category\` is the main one (its colour, what blocks and Google get),
// \`moreCats\` the others. Filters, search and the task list use them all.
export const catsOf = (x) => [...new Set([x?.category, ...(x?.moreCats || [])].filter((c) => c && get('categories', c)))];
// Category chips where several can be on; the main one is marked.
export function catChipsMulti(x, name = 'cats') {
  const on = catsOf(x);
  const chip = (c) => `<label class="cat-chip" style="--c:${esc(c.color || 'var(--line)')}"><input type="checkbox" name="${name}" value="${esc(c.id)}" ${on.includes(c.id) ? 'checked' : ''}><span><i class="cat-dot"></i>${esc(catName(c))}${on[0] === c.id && on.length > 1 ? ` <small class="cat-main">${esc(t('catMain'))}</small>` : ''}</span></label>`;
  return `<div class="cat-chips multi" role="group" aria-label="${esc(t('category'))}">${categories().map(chip).join('')}</div><small class="hint">${esc(t('catsHint'))}</small>`;
}
// Reads them back: the main one stays if still ticked, else the first ticked.
export function readCats(form, x, name = 'cats') {
  const picked = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
  const main = picked.includes(x.category) ? x.category : picked[0] || null;
  return { category: main, moreCats: picked.filter((c) => c !== main) };
}
// A task from what quick add parsed ("Dentist 1h !2 #health @Via Roma 12 fri").
export function quickFields(q) {
  return {
    kind: 'todo', title: q.title, minutes: q.minutes || 30, lenSet: Boolean(q.minutes), priority: q.priority, importance: q.importance || 3,
    category: findCategory(q.category), moreCats: [...new Set((q.moreCats || []).map(findCategory).filter(Boolean))], due: q.due || null, repeat: q.repeat || null, repeatDays: q.repeatDays || undefined, seriesFrom: q.repeat ? q.due : undefined,
    place: q.place || '', notes: '', done: false,
    // (v81) a rhythm typed in: "3 volte a settimana", or days with (or without) a time
    ...(q.repeat === 'times' ? { timesN: q.timesN || 3, timesPer: q.timesPer || 'week', pickTime: true, seriesFrom: undefined, due: null } : {}),
    ...(q.repeat && q.repeat !== 'times' ? { pickTime: q.time == null, whenMode: 'repeat' } : {}),
  };
}
export function findCategory(word) {
  if (!word) return null;
  const w = word.toLowerCase();
  const c = categories().find((x) => x.id === w || catName(x).toLowerCase().replace(/\s+/g, '') === w);
  return c ? c.id : null;
}

export function seedCategories() {
  DEFAULT_CATEGORIES.forEach((c, i) => {
    if (!has('categories', c.id)) upsert('categories', { ...c, name: '', order: i }, { silent: true, at: 1 });
  });
}

// Categories as chips showing their colour (a plain list can't show colours on a phone).
export function catChips(selected, name = 'category') {
  const chip = (id, label, color) => `<label class="cat-chip" style="--c:${esc(color || 'var(--line)')}"><input type="radio" name="${name}" value="${esc(id)}" ${(selected || '') === id ? 'checked' : ''}><span>${color ? '<i class="cat-dot"></i>' : ''}${esc(label)}</span></label>`;
  return `<div class="cat-chips" role="radiogroup" aria-label="${esc(t('category'))}">${chip('', t('noCategory'), '')}${categories().map((c) => chip(c.id, catName(c), c.color)).join('')}</div>`;
}

// ---------- formatting ----------

export function fmtDay(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const s = new Intl.DateTimeFormat(getLang(), opts).format(parseDate(date));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function relDay(date) {
  const td = today();
  if (date === td) return t('today');
  if (date === addDays(td, 1)) return t('tomorrow');
  if (date === addDays(td, -1)) return t('yesterday');
  const near = Math.abs(parseDate(date) - parseDate(td)) < 6 * 864e5;
  return fmtDay(date, near ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
}

export const range = (start, minutes) => `${fmtTime(start)}–${fmtTime(start + minutes)}`;
export const reasonText = (reasons) => reasons.map((r) => t(r.k, r.n)).join(' · ');

export function weekdayNames() {
  // Monday first; values are JS weekday numbers.
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const d = parseDate('2024-01-07'); d.setDate(7 + wd); // 2024-01-07 is a Sunday
    return [wd, new Intl.DateTimeFormat(getLang(), { weekday: 'short' }).format(d)];
  });
}
