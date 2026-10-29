import {
  state, load, live, get, has, upsert, remove, uid, onChange, saveSettings, saveMeta, COLLECTIONS, RICETTE,
} from './store.js';
import { syncNow, isConfigured, isSyncing, testConnection, watchMonth, ricetteConfigured } from './sync.js';
import {
  today, addDays, parseDate, isDate, nowMinutes, fmtTime, fmtDur, parseTime, quickAdd,
  REPEATS, completeTask, reopenTask, groupTasks, sortTasks, layoutBlocks, freeSlot, dayTotals,
  parseTemplateLines, formatTemplateLines, templateBlocks, autoTemplatesFor,
} from './plan.js';
import {
  candidates, suggestDay, spareTime, scoreTask, placePrep, placeGroceries, findConflicts, recipeMinutes,
} from './smart.js';
import { makeKitchen } from './kitchen.js';
import { formatQty, setDecimalSeparator } from './parse.js';
import { t, setLang, getLang, LANGS, detectLang } from './i18n.js';
import { setupDrag } from './drag.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const view = $('#view');
const modal = $('#modal');
const ui = { connMsg: '', ricMsg: '', dragging: false, scrolledFor: null, showDone: false, showHelpers: false, suggest: null, showConflicts: false };

const PPM = 1.2; // timeline pixels per minute (72 px per hour)
const GROCERY_MINUTES = 45;

// Built-in categories have fixed ids, so every device creates the same ones.
const DEFAULT_CATEGORIES = [
  { id: 'work', key: 'work', color: '#3d6fa8' },
  { id: 'personal', key: 'personal', color: '#8a5cb8' },
  { id: 'health', key: 'health', color: '#3f8f5a' },
  { id: 'meals', key: 'meals', color: '#c4692b' },
  { id: 'home', key: 'home', color: '#a88419' },
];
const PALETTE = ['#3d6fa8', '#8a5cb8', '#3f8f5a', '#c4692b', '#a88419', '#c0455e', '#2f8f8f', '#6b7280'];

// Ricette's shopping list and pantry, with the same rules Ricette uses.
const kitchen = makeKitchen({
  live, get, uid,
  upsert: (c, r) => upsert(c, r, { silent: true }),
  remove: (c, id) => remove(c, id),
}, { recipes: 'r_recipes', pantry: 'r_pantry', shopping: 'r_shopping' });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'plan';
  const [name, id] = h.split('/');
  return { name, id: id && decodeURIComponent(id) };
}

const TAB_OF = { plan: 'plan', tasks: 'tasks', settings: 'settings' };

function planSettings() {
  const s = state.settings;
  return {
    dayStart: s.dayStart * 60, dayEnd: s.dayEnd * 60, snap: Number(s.snap) || 15,
    buffer: Number(s.buffer ?? 5), maxLoad: Number(s.maxLoad ?? 8) * 60,
  };
}

// ---------- categories ----------

function categories() { return live('categories').sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || catName(a).localeCompare(catName(b))); }
function catName(c) { return c ? (c.name || t(`cat_${c.key}`)) : ''; }
function catColor(id) { return get('categories', id)?.color || ''; }
function findCategory(word) {
  if (!word) return null;
  const w = word.toLowerCase();
  const c = categories().find((x) => x.id === w || catName(x).toLowerCase().replace(/\s+/g, '') === w);
  return c ? c.id : null;
}

function seedCategories() {
  DEFAULT_CATEGORIES.forEach((c, i) => {
    if (!has('categories', c.id)) upsert('categories', { ...c, name: '', order: i }, { silent: true, at: 1 });
  });
}

function catOptions(selected) {
  return `<option value="">${esc(t('noCategory'))}</option>${categories().map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}`;
}

// ---------- tasks, preparations, checklists ----------

function blocksOn(date) { return live('blocks').filter((b) => b.date === date); }
function scheduledOn(taskId, date) { return blocksOn(date).some((b) => b.taskId === taskId); }
function openTasks() { return live('tasks').filter((x) => !x.done && !x.helper); }

// Tasks with a block today or later that isn't done yet.
function plannedTaskIds() {
  const td = today();
  return new Set(live('blocks').filter((b) => b.taskId && !b.done && b.date >= td && b.kind !== 'prep').map((b) => b.taskId));
}

function prepOf(task) {
  return (task?.prep || []).map((p) => ({ ...p, task: get('tasks', p.taskId) })).filter((p) => p.task);
}
// Minutes of "right before" preparation a task needs in front of it.
function leadOf(task) {
  return prepOf(task).filter((p) => p.when !== 'daybefore').reduce((s, p) => s + (p.task.minutes || 10), 0);
}
function checklistOf(block) { return (block?.taskId && get('tasks', block.taskId)?.checklist) || []; }
function checklistLeft(items, checked = []) { return items.filter((_, i) => !checked[i]).length; }

function setTaskDone(task, done, date = today()) {
  if (done) upsert('tasks', completeTask({ ...task, checked: [] }, date), { silent: true });
  else upsert('tasks', reopenTask(task), { silent: true });
}

function newBlock(fields) {
  const b = upsert('blocks', { id: uid(), done: false, ...fields }, { silent: true });
  linkFor(b);
  return b;
}

// Put a task on a day: at `start`, or in the first free gap (from now, if it's today).
function planTask(task, date, start = null, extra = {}) {
  const s = planSettings();
  const minutes = extra.minutes || task.minutes || 30;
  let at = start;
  if (at == null) {
    const from = (date === today() ? nowMinutes() : s.dayStart) + leadOf(task);
    at = freeSlot(blocksOn(date), minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
    if (at == null) at = Math.min(Math.ceil(Math.max(nowMinutes(), s.dayStart) / s.snap) * s.snap, 1440 - minutes);
  }
  return newBlock({ date, start: at, minutes, title: task.title, category: task.category || null, taskId: task.id, ...extra });
}

// Create the linked blocks a block needs: preparations for its task, and keep them in order.
function linkFor(block) {
  const td = today();
  if (!block || block.done || block.date < td || block.kind === 'prep') return;
  const task = block.taskId && get('tasks', block.taskId);
  if (!task || block.partial) return;
  for (const p of prepOf(task)) {
    const id = `${block.id}_p_${p.taskId}`;
    const cur = state.blocks.find((x) => x.id === id);
    if (cur && (cur.deleted || cur.done || !cur.auto)) continue; // deleted or moved by hand: leave it
    const pos = placePrep({
      parent: block, minutes: p.task.minutes || 10, mode: p.when, blocksOn: (d) => blocksOn(d).filter((x) => x.id !== id),
      today: td, nowMin: nowMinutes(), settings: planSettings(),
    });
    if (cur && cur.date === pos.date && cur.start === pos.start) continue;
    upsert('blocks', {
      ...(cur || {}), id, kind: 'prep', parentId: block.id, taskId: p.taskId, title: p.task.title,
      minutes: p.task.minutes || 10, category: p.task.category || task.category || null, date: pos.date, start: pos.start,
      auto: true, done: false,
    }, { silent: true, at: cur ? null : 1 });
  }
}

// When a block moves, its automatic preparations and grocery trip move with it.
function followParent(block) {
  linkFor(block);
  if (block.kind === 'meal' && block.groceryId) {
    const g = get('blocks', block.groceryId);
    if (g && g.auto && !g.done && !(g.date < block.date || (g.date === block.date && g.start + g.minutes <= block.start))) {
      const pos = placeGroceries({ meal: block, minutes: g.minutes, blocksOn: (d) => blocksOn(d).filter((x) => x.id !== g.id), today: today(), nowMin: nowMinutes(), settings: planSettings() });
      upsert('blocks', { ...g, ...pos }, { silent: true });
    }
  }
}

function deleteBlock(b) {
  remove('blocks', b.id);
  for (const c of live('blocks').filter((x) => x.parentId === b.id && !x.done)) remove('blocks', c.id);
}

// Ticking a block linked to a task also completes the task (or moves a repeating one on).
// A block with an unfinished checklist can't be ticked: the checklist opens instead.
function trySetBlockDone(block, done) {
  if (done) {
    const items = checklistOf(block);
    if (checklistLeft(items, block.checked) > 0) { openChecklist(block); return false; }
  }
  setBlockDone(block, done);
  if (done && block.kind === 'meal' && ricetteConfigured()) {
    const r = get('r_recipes', block.recipeId);
    if (r && confirm(t('cookedConfirm', block.servings || r.servings || 4))) {
      const n = kitchen.cook(r, block.servings || r.servings || 4);
      toast(t('pantryUpdated', n));
    }
  }
  return true;
}

function setBlockDone(block, done) {
  upsert('blocks', { ...block, done }, { silent: true });
  const task = block.taskId && get('tasks', block.taskId);
  if (!task || task.helper || block.partial || block.kind === 'prep') return;
  if (task.repeat) {
    if (done && (!task.due || task.due <= block.date)) upsert('tasks', completeTask(task, block.date < today() ? today() : block.date), { silent: true });
  } else if (Boolean(task.done) !== done) setTaskDone(task, done);
}

// ---------- meals (Ricette) ----------

function recipes() { return live('r_recipes').sort((a, b) => (a.title || '').localeCompare(b.title || '')); }
const recipeOf = (id) => get('r_recipes', id);
const isBefore = (a, b) => a.date < b.date || (a.date === b.date && a.start < b.start);

function missingForMeal(meal) {
  const r = recipeOf(meal.recipeId);
  if (!r) return [];
  const earlier = live('blocks').filter((b) => b.kind === 'meal' && !b.done && b.id !== meal.id && b.date >= today() && isBefore(b, meal));
  return kitchen.missingFor(r, meal.servings || r.servings || 4, kitchen.pantryAfter(earlier, recipeOf));
}

function qtyText(qty, unit) {
  if (qty == null) return '';
  return [formatQty(qty, unit), unit === 'pcs' ? '' : unit].filter(Boolean).join(' ');
}

// Check a meal against the pantry; offer to put what's missing on the list and plan a trip.
function checkMeal(meal, { quiet = false } = {}) {
  const r = recipeOf(meal.recipeId);
  if (!r) return;
  const missing = missingForMeal(meal);
  upsert('blocks', { ...get('blocks', meal.id), stockChecked: Date.now() }, { silent: true });
  if (!missing.length) { if (!quiet) toast(t('allInPantry')); changed(); return; }
  setTimeout(() => openModal(`
    <h2>${esc(t('missingTitle', r.title))}</h2>
    <p class="hint">${esc(t('missingHint'))}</p>
    <ul class="list checklist">${missing.map((m, i) => `<li><label><input type="checkbox" name="m" value="${i}" checked>
      <span class="item-text">${esc(m.name)}<small>${esc(qtyText(m.buy, m.unit))}${m.have ? ` · ${esc(t('inPantry'))}: ${esc(qtyText(Number(m.have.qty) || 0, m.have.unit))}` : ''}</small></span></label></li>`).join('')}</ul>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('addAndPlanShop'))}</button>
      <button class="btn" value="cancel">${esc(t('skip'))}</button>
    </div>`, (form) => {
    const picked = [...form.querySelectorAll('input[name=m]:checked')].map((i) => missing[Number(i.value)]);
    if (!picked.length) return;
    for (const m of picked) kitchen.addToShopping({ name: m.name, qty: m.buy, unit: m.unit, note: m.note }, r.title);
    kitchen.ensureLowItems();
    const g = ensureGroceries(get('blocks', meal.id));
    toast(t('groceriesPlanned', relDay(g.date), fmtTime(g.start)));
    changed();
  }), 0);
}

// Reuse a grocery trip already planned before the meal, or plan a new one.
function ensureGroceries(meal) {
  const td = today();
  const existing = live('blocks').filter((b) => b.kind === 'groceries' && !b.done && b.date >= td
    && (b.date < meal.date || (b.date === meal.date && b.start + b.minutes <= meal.start)))
    .sort((a, b) => (isBefore(a, b) ? 1 : -1))[0];
  let g = existing;
  if (!g) {
    const pos = placeGroceries({ meal, minutes: GROCERY_MINUTES, blocksOn, today: td, nowMin: nowMinutes(), settings: planSettings() });
    g = newBlock({ ...pos, kind: 'groceries', title: t('groceryTitle'), minutes: GROCERY_MINUTES, category: 'meals', auto: true });
  }
  upsert('blocks', { ...get('blocks', meal.id), groceryId: g.id }, { silent: true });
  return g;
}

function shoppingItems() {
  return live('r_shopping').sort((a, b) => Number(a.checked) - Number(b.checked) || (a.name || '').localeCompare(b.name || ''));
}

// ---------- templates ----------

function templates() { return live('templates').sort((a, b) => (a.name || '').localeCompare(b.name || '')); }

function applyTemplate(tpl, date) {
  let n = 0;
  for (const b of templateBlocks(tpl, date)) {
    if (get('blocks', b.id)) continue;
    linkFor(upsert('blocks', b, { silent: true }));
    n++;
  }
  return n;
}

// Templates set to "apply automatically" fill a day the first time it's opened.
// Their blocks get a deliberately old timestamp, so if you deleted or changed one on
// another device, that version always wins when the devices sync.
function autoApply(date) {
  if (date < today()) return;
  if (isConfigured() && !state.meta.syncedShards?.[`blocks/${date.slice(0, 7)}`]) return; // wait for the month's data
  for (const tpl of autoTemplatesFor(templates(), date)) {
    for (const b of templateBlocks(tpl, date)) if (!has('blocks', b.id)) upsert('blocks', b, { silent: true, at: 1 });
  }
}

// ---------- conflicts ----------

function conflictsOn(date) {
  return findConflicts(blocksOn(date), { getBlock: (id) => get('blocks', id), getTask: (id) => get('tasks', id) });
}

function warnConflicts(block) {
  if (!block) return;
  const c = conflictsOn(block.date).find((x) => x.ids.includes(block.id));
  if (!c) return;
  toast(`⚠ ${conflictText(c)}`);
}

function conflictText(c) {
  const [a, b] = c.ids.map((id) => get('blocks', id));
  if (c.type === 'overlap') return t('cf_overlap', a?.title, b?.title);
  if (c.type === 'order') return t('cf_order', a?.title, b?.title);
  const task = get('tasks', a?.taskId);
  return t('cf_late', a?.title, task?.due ? relDay(task.due) : '');
}

function fixConflict(c) {
  const s = planSettings();
  if (c.type === 'overlap') {
    // Move the later block to the next free gap, keeping its length.
    // Move the less important one: never a meal or something already done, otherwise the
    // block whose task scores lower (priority, due date), and on a tie the later one.
    const [a, b] = c.ids.map((id) => get('blocks', id));
    const weight = (x) => (x.done ? 1e6 : x.kind === 'meal' ? 1e5 : x.taskId && get('tasks', x.taskId) ? scoreTask(get('tasks', x.taskId), x.date).score : 20);
    const mover = weight(a) < weight(b) ? a : b;
    const others = blocksOn(mover.date).filter((x) => x.id !== mover.id && !x.allowOverlap);
    const at = freeSlot(others, mover.minutes, { from: mover.start, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
    if (at == null) { toast(t('noRoom')); return; }
    const moved = upsert('blocks', { ...mover, start: at, auto: false }, { silent: true });
    followParent(moved);
    toast(t('movedTo', mover.title, fmtTime(at)));
  } else if (c.type === 'order') {
    const [first, then] = c.ids.map((id) => get('blocks', id));
    const others = (d) => blocksOn(d).filter((x) => x.id !== first.id);
    const pos = first.kind === 'groceries'
      ? placeGroceries({ meal: then, minutes: first.minutes, blocksOn: others, today: today(), nowMin: nowMinutes(), settings: s })
      : placePrep({ parent: then, minutes: first.minutes, mode: 'before', blocksOn: others, today: today(), nowMin: nowMinutes(), settings: s });
    upsert('blocks', { ...first, ...pos, auto: true }, { silent: true });
  } else if (c.type === 'late') {
    const b = get('blocks', c.ids[0]);
    const due = get('tasks', b.taskId)?.due;
    if (!due || due < today()) return;
    const from = due === today() ? nowMinutes() : s.dayStart;
    const at = freeSlot(blocksOn(due), b.minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
    if (at == null) { toast(t('noRoom')); return; }
    followParent(upsert('blocks', { ...b, date: due, start: at }, { silent: true }));
    toast(t('movedTo', b.title, `${relDay(due)} ${fmtTime(at)}`));
  }
  changed();
}

// ---------- sync scheduling ----------

let syncTimer = null;
function changed() {
  render();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2500);
}

async function runSync() {
  if (!isConfigured()) { updateSyncBadge(); return; }
  updateSyncBadge(true);
  await syncNow();
  if (ricetteConfigured()) kitchen.ensureLowItems();
  updateSyncBadge();
  renderIfSafe();
  if (state.meta.dirty) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 2500); }
}

function updateSyncBadge(syncing = isSyncing()) {
  const b = $('#sync');
  let st;
  if (!isConfigured()) st = 'local';
  else if (syncing) st = 'syncing';
  else if (!navigator.onLine) st = 'offline';
  else if (state.meta.lastError && state.meta.lastError !== 'network') st = 'error';
  else if (state.meta.lastError === 'network') st = 'offline';
  else if (state.meta.dirty) st = 'pending';
  else st = 'synced';
  b.className = `sync ${st}`;
  b.title = t(`st_${st}`);
  b.setAttribute('aria-label', b.title);
  $('#sync-label').textContent = t(`st_${st}`);
}

// ---------- formatting ----------

function fmtDay(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const s = new Intl.DateTimeFormat(getLang(), opts).format(parseDate(date));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function relDay(date) {
  const td = today();
  if (date === td) return t('today');
  if (date === addDays(td, 1)) return t('tomorrow');
  if (date === addDays(td, -1)) return t('yesterday');
  const near = Math.abs(parseDate(date) - parseDate(td)) < 6 * 864e5;
  return fmtDay(date, near ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
}

const range = (start, minutes) => `${fmtTime(start)}–${fmtTime(start + minutes)}`;
const reasonText = (reasons) => reasons.map((r) => t(r.k, r.n)).join(' · ');

function weekdayNames() {
  // Monday first; values are JS weekday numbers.
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const d = parseDate('2024-01-07'); d.setDate(7 + wd); // 2024-01-07 is a Sunday
    return [wd, new Intl.DateTimeFormat(getLang(), { weekday: 'short' }).format(d)];
  });
}

// ---------- view: day planner ----------

function viewPlan(date) {
  const td = today();
  watchMonth(date.slice(0, 7));
  watchMonth(addDays(date, 1).slice(0, 7));
  autoApply(date);
  autoApply(addDays(date, 1)); // so tomorrow's "the evening before" preparations show up today
  for (const b of [...blocksOn(date), ...blocksOn(addDays(date, 1))]) if (b.taskId && b.kind !== 'prep' && !b.done) linkFor(b);
  const s = state.settings;
  const blocks = blocksOn(date);
  const totals = dayTotals(blocks);
  const sug = ui.suggest?.date === date ? ui.suggest : null;
  const ghosts = sug ? sug.placed.filter((p) => !sug.off.has(p.taskId)) : [];

  // Timeline range: the planner hours, stretched to fit any block outside them.
  let startMin = s.dayStart * 60; let endMin = s.dayEnd * 60;
  for (const b of [...blocks, ...ghosts]) { startMin = Math.min(startMin, Math.floor((b.start - (b.lead || 0)) / 60) * 60); endMin = Math.max(endMin, Math.ceil((b.start + b.minutes) / 60) * 60); }
  startMin = Math.max(0, startMin); endMin = Math.min(endMin, 1440);
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  const conflicts = conflictsOn(date);
  const inConflict = new Set(conflicts.flatMap((c) => c.ids));
  const laid = layoutBlocks(blocks);
  const isToday = date === td;
  const now = nowMinutes();

  const plannedElsewhere = plannedTaskIds();
  const toPlan = sortTasks(openTasks().filter((x) => !scheduledOn(x.id, date) && (x.repeat || !plannedElsewhere.has(x.id))
    && (x.due ? x.due === date || (x.due < date && date === td) : date >= td)), td);
  const due = toPlan.filter((x) => x.due);
  const anytime = toPlan.filter((x) => !x.due);

  const chip = (x) => `<button class="chip" type="button" data-action="plan-task" data-task="1" data-id="${esc(x.id)}" data-title="${esc(x.title)}" data-minutes="${x.minutes || 30}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}">
      <span class="chip-dot"></span><span class="chip-title">${esc(x.title)}</span><small>${esc(fmtDur(x.minutes || 30))}${x.due && x.due < date ? ` · ${esc(t('late'))}` : ''}</small></button>`;

  const unchecked = ricetteConfigured() ? blocks.filter((b) => b.kind === 'meal' && !b.done && !b.stockChecked && date >= td) : [];

  return `
  <div class="day-head">
    <a class="round" href="#/plan/${addDays(date, -1)}" aria-label="${esc(t('prevDay'))}">‹</a>
    <button class="day-title" type="button" data-action="pick-date">
      <span class="day-name">${esc(fmtDay(date))}</span>
      <small>${esc(isToday ? t('today') : relDay(date))} · ${esc(totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned'))}${totals.done ? ` · ${esc(t('doneSum', fmtDur(totals.done)))}` : ''}</small>
    </button>
    <a class="round" href="#/plan/${addDays(date, 1)}" aria-label="${esc(t('nextDay'))}">›</a>
    <input type="date" id="day-picker" value="${date}" tabindex="-1" aria-hidden="true">
  </div>
  <div class="day-actions">
    ${isToday ? '' : `<a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a>`}
    <button class="btn small" type="button" data-action="new-block">+ ${esc(t('block'))}</button>
    ${ricetteConfigured() ? `<button class="btn small" type="button" data-action="new-meal">+ ${esc(t('meal'))}</button>` : ''}
    <button class="btn small" type="button" data-action="templates">${esc(t('templates'))}</button>
  </div>
  <div class="plan-layout">
    <aside class="to-plan">
      ${sug ? suggestPanel(sug) : `
      <div class="smart-row">
        ${date >= td ? `<button class="btn small primary" type="button" data-action="suggest">✦ ${esc(t('suggestPlan'))}</button>` : ''}
        ${isToday ? `<button class="btn small" type="button" data-action="spare">⏱ ${esc(t('haveTime'))}</button>` : ''}
      </div>
      <h2>${esc(t('toPlan'))}</h2>
      <form id="side-add" class="row tight"><input id="side-add-input" name="title" autocomplete="off" placeholder="${esc(t('sideAddPh'))}"><button class="btn small">+</button></form>
      ${toPlan.length ? `
        ${due.length ? `<div class="chips">${due.map(chip).join('')}</div>` : ''}
        ${anytime.length ? `<div class="sub">${esc(t('anytime'))}</div><div class="chips">${anytime.map(chip).join('')}</div>` : ''}
        <p class="hint">${esc(t('chipHint'))}</p>` : `<p class="hint">${esc(t('nothingToPlan'))}</p>`}`}
    </aside>
    <section>
      ${conflicts.length ? `
      <div class="notice warn">
        <button class="notice-head" type="button" data-action="toggle-conflicts">⚠ ${esc(t('nConflicts', conflicts.length))} <span>${ui.showConflicts ? '▴' : '▾'}</span></button>
        ${ui.showConflicts ? `<ul>${conflicts.map((c, i) => `<li><span>${esc(conflictText(c))}</span>
          ${c.type !== 'late' || (get('tasks', get('blocks', c.ids[0])?.taskId)?.due || '') >= td ? `<button class="btn small" type="button" data-action="fix" data-i="${i}">${esc(t('fix'))}</button>` : ''}
          ${c.type === 'overlap' ? `<button class="btn small ghost" type="button" data-action="allow" data-i="${i}">${esc(t('fine'))}</button>` : ''}</li>`).join('')}</ul>` : ''}
      </div>` : ''}
      ${unchecked.length ? `<div class="notice"><span>🛒 ${esc(t('mealsToCheck', unchecked.length))}</span><button class="btn small" type="button" data-action="check-meals">${esc(t('checkNow'))}</button></div>` : ''}
      <div class="timeline" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${date}" style="height:${(endMin - startMin) * PPM}px">
        ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"><span>${fmtTime(m)}</span></div>`).join('')}
        ${isToday && now >= startMin && now <= endMin ? `<div class="now" id="now-line" style="top:${(now - startMin) * PPM}px"></div>` : ''}
        ${laid.map((b) => blockHtml(b, startMin, inConflict.has(b.id))).join('')}
        ${ghosts.map((g) => ghostHtml(g, startMin)).join('')}
        ${blocks.length || ghosts.length ? '' : `<div class="tl-empty">${esc(t('emptyDay'))}</div>`}
      </div>
    </section>
  </div>`;
}

function blockHtml(b, startMin, conflict) {
  const color = catColor(b.category) || 'var(--accent)';
  const short = b.minutes < 30;
  const left = `calc(${(b.col / b.cols) * 100}% + 1px)`;
  const width = `calc(${100 / b.cols}% - 3px)`;
  const items = checklistOf(b);
  const icon = { prep: '↳ ', meal: '🍽 ', groceries: '🛒 ' }[b.kind] || '';
  let extra = '';
  if (items.length) extra = `<span class="mini-badge">☑ ${items.length - checklistLeft(items, b.checked)}/${items.length}</span>`;
  if (b.kind === 'groceries') { const n = live('r_shopping').filter((x) => !x.checked).length; extra = `<span class="mini-badge">${n}</span>`; }
  return `<div class="block${b.done ? ' done' : ''}${short ? ' short' : ''}${conflict ? ' conflict' : ''}${b.kind ? ` k-${b.kind}` : ''}" data-id="${esc(b.id)}" data-start="${b.start}" data-minutes="${b.minutes}"
    style="--c:${esc(color)};top:${(b.start - startMin) * PPM}px;height:${Math.max(b.minutes * PPM, 16)}px;left:${left};width:${width}">
    <input type="checkbox" class="blk-check" data-action="block-done" data-id="${esc(b.id)}" ${b.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">
    <div class="blk-body">
      <div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${icon}${esc(b.title)} ${extra}</div>
      <div class="blk-time">${range(b.start, b.minutes)}</div>
    </div>
    <div class="resize" aria-hidden="true"></div>
  </div>`;
}

function ghostHtml(g, startMin) {
  const task = get('tasks', g.taskId);
  const color = catColor(task?.category) || 'var(--accent)';
  return `<div class="block ghost suggestion" style="--c:${esc(color)};top:${(g.start - g.lead - startMin) * PPM}px;height:${Math.max((g.minutes + g.lead) * PPM, 16)}px;left:1px;right:3px">
    <div class="blk-body"><div class="blk-title">✦ ${esc(task?.title)}</div><div class="blk-time">${range(g.start, g.minutes)}${g.lead ? ` · ${esc(t('plusPrep', fmtDur(g.lead)))}` : ''}</div></div></div>`;
}

function suggestPanel(sug) {
  const on = sug.placed.filter((p) => !sug.off.has(p.taskId));
  return `
  <h2>✦ ${esc(t('suggestedPlan'))}</h2>
  <p class="hint">${esc(t('suggestHint'))}</p>
  <ul class="list sugg">${sug.placed.map((p) => {
    const x = get('tasks', p.taskId);
    return `<li><label><input type="checkbox" data-action="sug-toggle" data-id="${esc(p.taskId)}" ${sug.off.has(p.taskId) ? '' : 'checked'}>
      <span class="item-text"><b>${fmtTime(p.start)}</b> ${esc(x?.title)}<small>${esc(fmtDur(p.minutes))}${p.reasons.length ? ` · ${esc(reasonText(p.reasons))}` : ''}</small></span></label></li>`;
  }).join('')}</ul>
  ${sug.skipped.length ? `<p class="hint">${esc(t('didntFit'))}: ${sug.skipped.map((x) => esc(get('tasks', x.taskId)?.title)).join(', ')}${sug.skipped.some((x) => x.why === 'full') ? ` <small>(${esc(t('dayFull', fmtDur(planSettings().maxLoad)))})</small>` : ''}</p>` : ''}
  <div class="button-row">
    <button class="btn primary" type="button" data-action="sug-accept" ${on.length ? '' : 'disabled'}>${esc(t('addN', on.length))}</button>
    <button class="btn" type="button" data-action="sug-cancel">${esc(t('cancel'))}</button>
  </div>`;
}

// ---------- view: tasks ----------

function viewTasks() {
  const td = today();
  const all = live('tasks');
  const g = groupTasks(all.filter((x) => !x.helper), td);
  const helpers = all.filter((x) => x.helper).sort((a, b) => a.title.localeCompare(b.title));
  const section = (key, items) => (items.length ? `<h2>${esc(t(`grp_${key}`))} <small>${items.length}</small></h2><ul class="list tasks">${items.map(taskRow).join('')}</ul>` : '');
  const open = g.overdue.length + g.today.length + g.upcoming.length + g.anytime.length;
  return `
  <form id="task-add" class="row">
    <input id="task-input" name="title" autocomplete="off" placeholder="${esc(t('addTaskPh'))}">
    <button class="btn primary">${esc(t('add'))}</button>
  </form>
  <p class="hint">${esc(t('quickHint'))}</p>
  ${open ? '' : `<p class="empty">${esc(t('noTasks'))}</p>`}
  ${section('overdue', g.overdue)}
  ${section('today', g.today)}
  ${section('upcoming', g.upcoming)}
  ${section('anytime', g.anytime)}
  <div class="button-row">
    ${g.done.length ? `<button class="btn small ghost" type="button" data-action="toggle-done">${esc(ui.showDone ? t('hideDone') : t('showDone', g.done.length))}</button>` : ''}
    ${ui.showDone && g.done.length ? `<button class="btn small ghost" type="button" data-action="clear-done">${esc(t('clearDone'))}</button>` : ''}
    ${helpers.length ? `<button class="btn small ghost" type="button" data-action="toggle-helpers">${esc(ui.showHelpers ? t('hidePreps') : t('showPreps', helpers.length))}</button>` : ''}
  </div>
  ${ui.showDone && g.done.length ? `<ul class="list tasks done">${g.done.slice(0, 50).map(taskRow).join('')}</ul>` : ''}
  ${ui.showHelpers && helpers.length ? `<h2>${esc(t('preparations'))}</h2><p class="hint">${esc(t('prepsHint'))}</p><ul class="list tasks">${helpers.map(taskRow).join('')}</ul>` : ''}`;
}

function taskRow(x) {
  const td = today();
  const bits = [];
  if (x.helper) {
    const parents = live('tasks').filter((p) => (p.prep || []).some((q) => q.taskId === x.id)).map((p) => p.title);
    if (parents.length) bits.push(esc(t('prepFor', parents.join(', '))));
  }
  if (x.due) bits.push(`<span class="${x.due < td && !x.done ? 'late' : ''}">${esc(relDay(x.due))}</span>`);
  if (x.minutes) bits.push(esc(fmtDur(x.minutes)));
  if (x.repeat) bits.push(`↻ ${esc(t(`rep_${x.repeat}`))}`);
  if (x.when) bits.push(esc(t(`when_${x.when}`)));
  if (x.checklist?.length) bits.push(`☑ ${x.checklist.length}`);
  if (x.prep?.length) bits.push(`↳ ${esc(prepOf(x).map((p) => p.task.title).join(', '))}`);
  const cat = get('categories', x.category);
  if (cat) bits.push(`<span class="cat" style="--c:${esc(cat.color)}">${esc(catName(cat))}</span>`);
  const planned = live('blocks').filter((b) => b.taskId === x.id && !b.done && b.date >= td && b.kind !== 'prep').sort((a, b) => ((a.date + a.start) < (b.date + b.start) ? -1 : 1))[0];
  if (planned && !x.done) bits.push(`<span class="badge">${esc(t('plannedAt', relDay(planned.date), fmtTime(planned.start)))}</span>`);
  return `<li class="prio-${x.priority || 0}">
    ${x.helper ? '<span class="helper-dot">↳</span>' : `<input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`}
    <button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}">
      <span class="item-text">${x.priority ? `<span class="prio">${'!'.repeat(4 - x.priority)}</span> ` : ''}${esc(x.title)}<small>${bits.join(' · ')}</small></span>
    </button>
  </li>`;
}

// ---------- view: settings ----------

function viewSettings() {
  const s = state.settings;
  const msg = ui.connMsg;
  const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === Number(sel) ? 'selected' : ''}>${fmtTime(h * 60)}</option>`).join('');
  const opts = (vals, sel, label) => vals.map((v) => `<option value="${v}" ${v === Number(sel) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  return `
  <h1>${esc(t('tabSettings'))}</h1>
  <form class="form" id="lang-form">
    <label>${esc(t('language'))}
      <select name="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </label>
  </form>

  <h2>${esc(t('plannerSettings'))}</h2>
  <form class="form" id="planner-form">
    <div class="two">
      <label>${esc(t('dayStart'))}<select name="dayStart">${hourOpts(s.dayStart, 0, 12)}</select></label>
      <label>${esc(t('dayEnd'))}<select name="dayEnd">${hourOpts(s.dayEnd, 13, 24)}</select></label>
    </div>
    <div class="two">
      <label>${esc(t('snap'))}<select name="snap">${opts([5, 10, 15, 30], s.snap, (m) => `${m} min`)}</select></label>
      <label>${esc(t('buffer'))}<select name="buffer">${opts([0, 5, 10, 15], s.buffer ?? 5, (m) => (m ? `${m} min` : t('none')))}</select></label>
    </div>
    <label>${esc(t('maxLoad'))}<select name="maxLoad">${opts([4, 5, 6, 7, 8, 9, 10, 11, 12, 14], s.maxLoad ?? 8, (h) => `${h} h`)}</select>
      <small>${esc(t('maxLoadHint'))}</small></label>
  </form>

  <h2>${esc(t('templates'))}</h2>
  <p class="hint">${esc(t('templatesHint'))}</p>
  <ul class="list">
    ${templates().map((tp) => `<li><button class="task-main" type="button" data-action="tpl-edit" data-id="${esc(tp.id)}"><span class="item-text">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}${tp.days?.length ? ` · ${esc(t('autoOn', daysLabel(tp.days)))}` : ''}</small></span></button></li>`).join('') || `<li class="pad"><span class="hint">${esc(t('noTemplates'))}</span></li>`}
  </ul>
  <button class="btn small" type="button" data-action="tpl-new">+ ${esc(t('newTemplate'))}</button>

  <h2>${esc(t('categories'))}</h2>
  <ul class="list">
    ${categories().map((c) => `<li><button class="task-main" type="button" data-action="cat-edit" data-id="${esc(c.id)}"><span class="item-text"><span class="cat" style="--c:${esc(c.color)}">${esc(catName(c))}</span></span></button></li>`).join('')}
  </ul>
  <button class="btn small" type="button" data-action="cat-new">+ ${esc(t('newCategory'))}</button>

  <h2>${esc(t('sync'))}</h2>
  <p class="hint">${esc(t('syncHint'))}</p>
  <form class="form" id="gh-form">
    <div class="two">
      <label>${esc(t('owner'))}<input name="owner" value="${esc(s.owner)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>${esc(t('repo'))}<input name="repo" value="${esc(s.repo || 'everyday-data')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </div>
    <label>${esc(t('token'))}<input name="token" type="password" value="${esc(s.token)}" autocomplete="off" spellcheck="false"><small>${esc(t('tokenHint'))}</small></label>
    <label>${esc(t('branch'))}<input name="branch" value="${esc(s.branch || 'main')}" autocomplete="off" autocapitalize="off"></label>
    ${msg ? `<p class="conn ${msg === 'connected' ? 'good' : 'bad'}">${esc(t(msg))}</p>` : ''}
    <div class="button-row">
      <button class="btn primary">${esc(t('saveTest'))}</button>
      ${isConfigured() ? `<button class="btn" type="button" data-action="sync-now">${esc(t('syncNow'))}</button>` : ''}
    </div>
    <p class="hint">${esc(t('lastSync'))}: ${state.meta.lastSync ? esc(new Date(state.meta.lastSync).toLocaleString(getLang())) : esc(t('never'))}</p>
  </form>

  <h2>${esc(t('ricette'))}</h2>
  <p class="hint">${esc(t('ricetteHint'))}</p>
  <form class="form" id="ric-form">
    <label>${esc(t('ricetteRepo'))}<input name="ricetteRepo" value="${esc(s.ricetteRepo || 'ricette-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${ui.ricMsg ? `<p class="conn ${ui.ricMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.ricMsg))}</p>` : ''}
    ${ricetteConfigured() ? `<p class="hint">${esc(t('ricetteStatus', live('r_recipes').length, live('r_pantry').length, live('r_shopping').filter((x) => !x.checked).length))}</p>` : ''}
    <div class="button-row">
      <button class="btn ${ricetteConfigured() ? '' : 'primary'}" ${isConfigured() ? '' : 'disabled'}>${esc(ricetteConfigured() ? t('saveTest') : t('connect'))}</button>
      ${ricetteConfigured() ? `<button class="btn ghost" type="button" data-action="ric-off">${esc(t('disconnect'))}</button>` : ''}
    </div>
  </form>

  <div class="button-row subtle">
    <button class="btn small" type="button" data-action="export">${esc(t('export'))}</button>
  </div>`;
}

function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return t('everyDay');
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('weekdaysLabel');
  if (set.size === 2 && set.has(0) && set.has(6)) return t('weekendLabel');
  return weekdayNames().filter(([wd]) => set.has(wd)).map(([, n]) => n).join(', ');
}

// ---------- rendering ----------

function renderShell() {
  document.title = t('appName');
  $('#app-title').textContent = t('appName');
  for (const a of document.querySelectorAll('nav a')) {
    a.querySelector('.label').textContent = t(`tab${a.dataset.tab.charAt(0).toUpperCase()}${a.dataset.tab.slice(1)}`);
  }
  updateSyncBadge();
}

function currentDate() {
  const r = route();
  return r.name === 'plan' && isDate(r.id) ? r.id : today();
}

function render() {
  const r = route();
  const active = document.activeElement;
  const focusId = active && active.id;
  const typed = focusId && active.tagName === 'INPUT' ? active.value : null;
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.tab === (TAB_OF[r.name] || 'plan'));
  let html;
  switch (r.name) {
    case 'tasks': html = viewTasks(); break;
    case 'settings': html = viewSettings(); break;
    default: html = viewPlan(currentDate());
  }
  view.innerHTML = html;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); if (typed != null && el.tagName === 'INPUT') el.value = typed; }
  }
  if ((r.name === 'plan' || !TAB_OF[r.name]) && ui.scrolledFor !== currentDate()) {
    ui.scrolledFor = currentDate();
    scrollTimeline();
  }
}

// On opening a day: scroll to "now" (today) or the first block (other days).
function scrollTimeline() {
  const target = $('#now-line') || $('.timeline .block');
  if (!target) return;
  const y = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
  window.scrollTo(0, Math.max(0, y));
}

function renderIfSafe() {
  const r = route();
  if (r.name === 'settings' || modal.open || ui.dragging) return;
  render();
}

// ---------- dialogs ----------

function openModal(html, onSubmit) {
  modal.innerHTML = `<form method="dialog" class="form">${html}</form>`;
  const form = modal.querySelector('form');
  form.addEventListener('submit', (e) => {
    const v = e.submitter?.value;
    if (v === 'cancel') return;
    onSubmit(form, v || 'ok', e);
  });
  if (!modal.open) modal.showModal();
}

modal.addEventListener('close', () => render());

const durOptions = (sel, list = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240]) => {
  const opts = [...list];
  if (sel && !opts.includes(sel)) opts.push(sel);
  return opts.sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtDur(m)}</option>`).join('');
};

const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

// Task editor. Preparations are small tasks of their own (with their own checklist),
// planned automatically before this one whenever it goes on the timeline.
function openTask(task, draft = null) {
  const isNew = !task;
  const base = task || { title: '', minutes: 30, priority: 0, category: '', due: '', repeat: '', notes: '', when: '' };
  const x = draft || { ...base, prep: [...(base.prep || [])], checklist: [...(base.checklist || [])] };
  const helper = Boolean(x.helper);
  const prepRows = (x.prep || []).map((p, i) => {
    const pt = p.newTask || get('tasks', p.taskId);
    if (!pt) return '';
    return `<li><span class="item-text pad">↳ ${esc(pt.title)}<small>${esc(fmtDur(pt.minutes || 10))} · ${esc(t(`pw_${p.when}`))}${pt.checklist?.length ? ` · ☑ ${pt.checklist.length}` : ''}</small></span>
      <button class="btn small ghost" value="edit-prep:${i}">${esc(t('edit'))}</button>
      <button class="btn small ghost" value="rm-prep:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></li>`;
  }).join('');
  openModal(`
    <h2>${esc(helper ? t('editPrep') : isNew ? t('newTask') : t('editTask'))}</h2>
    <label>${esc(t('title'))}<input name="title" required value="${esc(x.title)}" autocomplete="off"></label>
    <div class="two">
      <label>${esc(t('duration'))}<select name="minutes">${durOptions(x.minutes || 30)}</select></label>
      ${helper ? '' : `<label>${esc(t('priority'))}<select name="priority">${[0, 1, 2, 3].map((p) => `<option value="${p}" ${p === (x.priority || 0) ? 'selected' : ''}>${esc(t(`prio_${p}`))}</option>`).join('')}</select></label>`}
    </div>
    ${helper ? '' : `
    <div class="two">
      <label>${esc(t('due'))}<input name="due" type="date" value="${esc(x.due || '')}"></label>
      <label>${esc(t('repeat'))}<select name="repeat"><option value="">${esc(t('rep_none'))}</option>${REPEATS.map((r) => `<option value="${r}" ${r === x.repeat ? 'selected' : ''}>${esc(t(`rep_${r}`))}</option>`).join('')}</select></label>
    </div>
    <div class="two">
      <label>${esc(t('bestTime'))}<select name="when">${['', 'morning', 'afternoon', 'evening'].map((w) => `<option value="${w}" ${w === (x.when || '') ? 'selected' : ''}>${esc(t(`when_${w || 'any'}`))}</option>`).join('')}</select></label>
      <label>${esc(t('category'))}<select name="category">${catOptions(x.category)}</select></label>
    </div>`}
    <label>${esc(t('checklist'))}<textarea name="checklist" rows="3" placeholder="${esc(t('checklistPh'))}">${esc((x.checklist || []).join('\n'))}</textarea>
      <small>${esc(t('checklistHint'))}</small></label>
    ${helper ? '' : `
    <div class="field-label">${esc(t('prepTitle'))}</div>
    <p class="hint">${esc(t('prepHint'))}</p>
    ${prepRows ? `<ul class="list">${prepRows}</ul>` : ''}
    <div class="prep-add">
      <input name="prepTitle" placeholder="${esc(t('prepPh'))}" autocomplete="off">
      <select name="prepMinutes">${durOptions(10, [5, 10, 15, 20, 30, 45, 60])}</select>
      <select name="prepWhen"><option value="before">${esc(t('pw_before'))}</option><option value="daybefore">${esc(t('pw_daybefore'))}</option></select>
      <button class="btn small" value="add-prep" formnovalidate>+ ${esc(t('add'))}</button>
    </div>`}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${helper ? '' : `<button class="btn" value="plan">${esc(t('planIt'))}</button>`}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    const collect = () => {
      x.title = form.title.value.trim();
      x.minutes = Number(form.minutes.value) || 30;
      x.checklist = lines(form.checklist.value);
      x.notes = form.notes.value.trim();
      if (!helper) {
        x.priority = Number(form.priority.value) || 0;
        x.due = form.due.value || null;
        x.repeat = form.repeat.value || null;
        x.when = form.when.value || '';
        x.category = form.category.value || null;
      }
    };
    collect();
    if (action === 'add-prep') {
      e.preventDefault();
      const title = form.prepTitle.value.trim();
      if (title) x.prep = [...(x.prep || []), { newTask: { title, minutes: Number(form.prepMinutes.value) || 10 }, when: form.prepWhen.value }];
      openTask(task, x);
      modal.querySelector('input[name=prepTitle]')?.focus();
      return;
    }
    if (action.startsWith('rm-prep:')) {
      e.preventDefault();
      x.prep = x.prep.filter((_, i) => i !== Number(action.slice(8)));
      openTask(task, x);
      return;
    }
    if (action === 'delete') {
      if (!confirm(t('confirmDeleteTask'))) { e.preventDefault(); return; }
      remove('tasks', x.id);
      for (const b of live('blocks').filter((y) => y.taskId === x.id && !y.done && y.date >= today())) deleteBlock(b);
      changed();
      return;
    }
    if (!x.title) { e.preventDefault(); return; }
    const rec = saveTask(x);
    if (action.startsWith('edit-prep:')) {
      const p = rec.prep[Number(action.slice(10))];
      setTimeout(() => openTask(get('tasks', p.taskId)), 0);
    }
    if (action === 'plan') {
      const date = rec.due && rec.due > today() ? rec.due : today();
      const b = planTask(rec, date);
      toast(t('plannedToast', relDay(date), fmtTime(b.start)));
      location.hash = `#/plan/${date}`;
    }
    changed();
  });
}

function saveTask(x) {
  const prep = (x.prep || []).map((p) => {
    if (!p.newTask) return { taskId: p.taskId, when: p.when };
    const h = upsert('tasks', {
      id: uid(), createdAt: Date.now(), helper: true, title: p.newTask.title, minutes: p.newTask.minutes,
      category: x.category || null, checklist: [], notes: '', done: false,
    }, { silent: true });
    return { taskId: h.id, when: p.when };
  });
  let due = x.due || null;
  if (x.repeat && !due) due = today();
  const { newTask, ...clean } = x;
  void newTask;
  return upsert('tasks', {
    ...clean, id: x.id || uid(), createdAt: x.createdAt || Date.now(), due, prep, done: Boolean(x.done),
  }, { silent: true });
}

// A checklist that must be finished before something counts as done.
function openChecklist(block) {
  const items = checklistOf(block);
  const draw = () => {
    const b = get('blocks', block.id);
    const checked = b.checked || [];
    const left = checklistLeft(items, checked);
    openModal(`
      <h2>☑ ${esc(b.title)}</h2>
      <p class="hint">${esc(left ? t('checklistFirst', left) : t('checklistReady'))}</p>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${checked[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>
      <div class="button-row">
        <button class="btn primary" value="done" ${left ? 'disabled' : ''}>${esc(t('markDone'))}</button>
        ${left ? `<button class="btn" value="all" formnovalidate>${esc(t('checkAll'))}</button>` : ''}
        <button class="btn" value="cancel">${esc(t('close'))}</button>
      </div>`, (form, action, e) => {
      if (action === 'all') { e.preventDefault(); upsert('blocks', { ...get('blocks', block.id), checked: items.map(() => true) }, { silent: true }); draw(); return; }
      if (action === 'done') { setBlockDone(get('blocks', block.id), true); changed(); }
    });
    modal.querySelector('form').addEventListener('change', (ev) => {
      const i = ev.target.dataset.ci;
      if (i == null) return;
      const cur = get('blocks', block.id);
      const next = [...(cur.checked || [])];
      next[Number(i)] = ev.target.checked;
      upsert('blocks', { ...cur, checked: next }, { silent: true });
      draw();
    });
  };
  draw();
}

// Same for a task ticked off in the task list.
function openTaskChecklist(task) {
  const draw = () => {
    const x = get('tasks', task.id);
    const items = x.checklist || [];
    const checked = x.checked || [];
    const left = checklistLeft(items, checked);
    openModal(`
      <h2>☑ ${esc(x.title)}</h2>
      <p class="hint">${esc(left ? t('checklistFirst', left) : t('checklistReady'))}</p>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${checked[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>
      <div class="button-row">
        <button class="btn primary" value="done" ${left ? 'disabled' : ''}>${esc(t('markDone'))}</button>
        ${left ? `<button class="btn" value="all">${esc(t('checkAll'))}</button>` : ''}
        <button class="btn" value="cancel">${esc(t('close'))}</button>
      </div>`, (form, action, e) => {
      if (action === 'all') { e.preventDefault(); upsert('tasks', { ...get('tasks', task.id), checked: items.map(() => true) }, { silent: true }); draw(); return; }
      if (action === 'done') { setTaskDone(get('tasks', task.id), true); changed(); }
    });
    modal.querySelector('form').addEventListener('change', (ev) => {
      const i = ev.target.dataset.ci;
      if (i == null) return;
      const cur = get('tasks', task.id);
      const next = [...(cur.checked || [])];
      next[Number(i)] = ev.target.checked;
      upsert('tasks', { ...cur, checked: next }, { silent: true });
      draw();
    });
  };
  draw();
}

function openBlock(block, defaults = {}) {
  const isNew = !block;
  const b = block || { title: '', date: currentDate(), start: 9 * 60, minutes: 30, category: '', notes: '', done: false, ...defaults };
  const task = b.taskId && get('tasks', b.taskId);
  const parent = b.parentId && get('blocks', b.parentId);
  const items = checklistOf(b);
  const isMeal = b.kind === 'meal';
  const isShop = b.kind === 'groceries';
  const taskChoices = sortTasks(live('tasks').filter((x) => !x.done || x.id === b.taskId), today()).slice(0, 80);
  const r = isMeal && recipeOf(b.recipeId);
  openModal(`
    <h2>${esc(isMeal ? (isNew ? t('newMeal') : t('meal')) : isShop ? `🛒 ${t('groceryTitle')}` : isNew ? t('newBlock') : t('editBlock'))}</h2>
    ${parent ? `<p class="hint">↳ ${esc(t('prepForBlock', parent.title, fmtTime(parent.start)))}</p>` : ''}
    ${isMeal ? `
      <label>${esc(t('recipe'))}<select name="recipeId" required><option value="">—</option>${recipes().map((x) => `<option value="${esc(x.id)}" ${x.id === b.recipeId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label>${esc(t('servings'))}<input name="servings" type="number" min="1" step="1" value="${esc(b.servings || r?.servings || 2)}"></label>`
    : isShop ? '' : `
      ${b.kind === 'prep' ? '' : `<label>${esc(t('linkTask'))}<select name="taskId"><option value="">—</option>${taskChoices.map((x) => `<option value="${esc(x.id)}" ${x.id === b.taskId ? 'selected' : ''}>${x.helper ? '↳ ' : ''}${esc(x.title)}</option>`).join('')}</select></label>`}
      <label>${esc(t('title'))}<input name="title" value="${esc(b.title)}" autocomplete="off"></label>`}
    <div class="three">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(b.date)}"></label>
      <label>${esc(t('start'))}<input name="start" type="time" required step="300" value="${fmtTime(b.start)}"></label>
      <label>${esc(t('duration'))}<select name="minutes">${durOptions(b.minutes)}</select></label>
    </div>
    ${isShop ? shoppingSection() : ''}
    ${items.length && !isNew ? `<div class="field-label">${esc(t('checklist'))}</div>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${(b.checked || [])[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>` : ''}
    ${isMeal || isShop ? '' : `<label>${esc(t('category'))}<select name="category">${catOptions(b.category)}</select></label>`}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="allowOverlap" ${b.allowOverlap ? 'checked' : ''}> ${esc(t('allowOverlap'))}</label>
    ${task && !task.helper ? `<p class="hint">${esc(t('linkedTask'))}: <a href="#/tasks" data-action="open-task" data-id="${esc(task.id)}">${esc(task.title)}</a></p>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${isMeal && !isNew ? `<button class="btn" value="check">🛒 ${esc(t('checkIngredients'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn" value="dup" formnovalidate>${esc(t('duplicate'))}</button>
      <button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    if (action === 'delete') { deleteBlock(b); changed(); return; }
    if (action === 'dup') {
      newBlock({ ...b, id: uid(), start: Math.min(b.start + b.minutes, 1440 - b.minutes), done: false, templateId: null, checked: [], stockChecked: null, groceryId: null });
      changed();
      return;
    }
    const picked = form.taskId?.value ? get('tasks', form.taskId.value) : null;
    const titleInput = form.elements.namedItem('title'); // (form.title is the form's own title attribute)
    let title = titleInput ? titleInput.value.trim() : '';
    let category = form.category?.value || null;
    const rec = { ...b, id: b.id || uid(), date: form.date.value || b.date, start: parseTime(form.start.value) ?? b.start,
      minutes: Number(form.minutes.value) || 30, notes: form.notes.value.trim(), allowOverlap: form.allowOverlap.checked };
    if (isMeal) {
      const rr = recipeOf(form.recipeId.value);
      if (!rr) { e.preventDefault(); return; }
      if (rr.id !== b.recipeId || Number(form.servings.value) !== b.servings) rec.stockChecked = null;
      Object.assign(rec, { recipeId: rr.id, servings: Math.max(1, Number(form.servings.value) || rr.servings || 2), title: rr.title, category: 'meals' });
    } else if (!isShop) {
      if (!title && picked) title = picked.title;
      if (!title) { e.preventDefault(); titleInput.focus(); return; }
      if (!category && picked) category = picked.category || null;
      Object.assign(rec, { title, category });
      if (form.taskId) rec.taskId = picked ? picked.id : null;
    }
    if (rec.date !== b.date || rec.start !== b.start) rec.auto = false;
    const saved = upsert('blocks', rec, { silent: true });
    followParent(saved);
    if (rec.date !== currentDate()) location.hash = `#/plan/${rec.date}`;
    changed();
    warnConflicts(get('blocks', saved.id));
    if (isMeal && (action === 'check' || !saved.stockChecked)) checkMeal(get('blocks', saved.id), { quiet: !isNew && action !== 'check' });
  });
  const form = modal.querySelector('form');
  // Checklist items and shopping items are saved as you tick them.
  form.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.ci != null && !isNew) {
      const cur = get('blocks', b.id);
      const next = [...(cur.checked || [])];
      next[Number(el.dataset.ci)] = el.checked;
      upsert('blocks', { ...cur, checked: next }, { silent: true });
    }
    if (el.dataset.shop) { kitchen.setChecked(el.dataset.shop, el.checked); el.closest('li').classList.toggle('got', el.checked); }
    if (el.name === 'taskId') {
      const x = get('tasks', el.value);
      if (!x) return;
      const ti = form.elements.namedItem('title');
      if (ti && (!ti.value.trim() || isNew)) ti.value = x.title;
      if (isNew && x.minutes) form.minutes.innerHTML = durOptions(x.minutes);
      if (x.category) form.category.value = x.category;
    }
    if (el.name === 'recipeId' && isNew) {
      const rr = recipeOf(el.value);
      if (rr) {
        form.servings.value = rr.servings || 2;
        const m = recipeMinutes(rr.time);
        if (m) form.minutes.innerHTML = durOptions(Math.ceil(m / 5) * 5);
      }
    }
  });
}

function shoppingSection() {
  if (!ricetteConfigured()) return '';
  const items = shoppingItems();
  if (!items.length) return `<p class="hint">${esc(t('listEmpty'))}</p>`;
  return `<div class="field-label">${esc(t('shoppingList'))}</div>
    <ul class="list checklist shop">${items.map((it) => `<li class="${it.checked ? 'got' : ''}"><label><input type="checkbox" data-shop="${esc(it.id)}" ${it.checked ? 'checked' : ''}>
      <span class="item-text">${esc(it.name)}<small>${esc(qtyText(it.qty, it.unit))}${it.sources?.length ? ` · ${esc(it.sources.join(', '))}` : ''}</small></span></label></li>`).join('')}</ul>
    <p class="hint">${esc(t('shopHint'))}</p>`;
}

function openNewMeal() {
  const date = currentDate();
  const now = nowMinutes();
  const start = date === today() && now > 13 * 60 ? 19 * 60 + 30 : date === today() && now > 10 * 60 ? 19 * 60 + 30 : 12 * 60 + 30;
  if (!recipes().length) { toast(t('noRecipes')); return; }
  openBlock(null, { kind: 'meal', date, start, minutes: 45, category: 'meals' });
}

function openTemplatesMenu() {
  const date = currentDate();
  const list = templates();
  openModal(`
    <h2>${esc(t('templates'))}</h2>
    <p class="hint">${esc(t('templatesMenuHint', fmtDay(date)))}</p>
    ${list.length ? `<ul class="list">${list.map((tp) => `<li><span class="item-text pad">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}</small></span>
      <button class="btn small" value="apply:${esc(tp.id)}">${esc(t('apply'))}</button></li>`).join('')}</ul>` : `<p class="hint">${esc(t('noTemplates'))}</p>`}
    <div class="button-row">
      ${blocksOn(date).length ? `<button class="btn" value="save-day">${esc(t('saveDayAsTemplate'))}</button>` : ''}
      <button class="btn" value="new">+ ${esc(t('newTemplate'))}</button>
      <button class="btn ghost" value="cancel">${esc(t('close'))}</button>
    </div>`, (form, action) => {
    if (action.startsWith('apply:')) {
      const tp = get('templates', action.slice(6));
      const n = applyTemplate(tp, date);
      toast(t('appliedN', n));
      changed();
    } else if (action === 'save-day') {
      const blocks = blocksOn(date).filter((b) => !b.kind || b.kind === 'meal').map(({ start, minutes, title, category, taskId, kind, recipeId, servings }) => ({
        start, minutes, title, category: category || null, ...(taskId ? { taskId } : {}), ...(kind === 'meal' ? { kind, recipeId, servings } : {}),
      }));
      setTimeout(() => openTemplate(null, { name: fmtDay(date, { weekday: 'long' }), blocks }), 0);
    } else if (action === 'new') setTimeout(() => openTemplate(null), 0);
  });
}

function openTemplate(tpl, preset = {}) {
  const isNew = !tpl;
  const x = tpl || { name: '', blocks: [], days: [], ...preset };
  const nameOf = (id) => catName(get('categories', id)) || id;
  openModal(`
    <h2>${esc(isNew ? t('newTemplate') : t('editTemplate'))}</h2>
    <label>${esc(t('name'))}<input name="name" required value="${esc(x.name)}" autocomplete="off" placeholder="${esc(t('templateNamePh'))}"></label>
    <label>${esc(t('templateBlocks'))}<textarea name="lines" rows="9" spellcheck="false" placeholder="07:00-07:30 ${esc(t('exampleBlock'))} #${esc(nameOf('health'))}">${esc(formatTemplateLines(x.blocks || [], nameOf))}</textarea>
      <small>${esc(t('templateLinesHint'))}</small></label>
    <div class="field-label">${esc(t('autoApply'))}</div>
    <div class="days">${weekdayNames().map(([wd, n]) => `<label class="day-pill"><input type="checkbox" name="day" value="${wd}" ${(x.days || []).includes(wd) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    <p class="hint">${esc(t('autoApplyHint'))}</p>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action) => {
    if (action === 'delete') { if (confirm(t('confirmDeleteTemplate'))) { remove('templates', x.id); changed(); } return; }
    // Keep links (to a task, or a recipe) for lines whose title didn't change. Lines named
    // exactly like a task with preparations or a checklist get linked to it.
    const prev = x.blocks || [];
    const blocks = parseTemplateLines(form.lines.value).map((b) => {
      const was = prev.find((p) => p.title === b.title && (p.taskId || p.kind));
      const named = !was && openTasks().concat(live('tasks').filter((y) => y.repeat)).find((y) => y.title.toLowerCase() === b.title.toLowerCase() && (y.prep?.length || y.checklist?.length));
      const out = { ...b, category: findCategory(b.category) };
      if (was?.taskId) out.taskId = was.taskId;
      else if (named) out.taskId = named.id;
      if (was?.kind === 'meal') Object.assign(out, { kind: 'meal', recipeId: was.recipeId, servings: was.servings });
      return out;
    });
    const days = [...form.querySelectorAll('input[name=day]:checked')].map((i) => Number(i.value));
    upsert('templates', { ...x, id: x.id || uid(), name: form.name.value.trim(), blocks, days }, { silent: true });
    changed();
  });
}

function openCategory(cat) {
  const isNew = !cat;
  const used = new Set(live('categories').map((c) => c.color));
  const c = cat || { name: '', color: PALETTE.find((p) => !used.has(p)) || PALETTE[0] };
  openModal(`
    <h2>${esc(isNew ? t('newCategory') : t('editCategory'))}</h2>
    <label>${esc(t('name'))}<input name="name" ${isNew ? 'required' : ''} value="${esc(c.name || '')}" placeholder="${esc(catName(c))}" autocomplete="off"></label>
    <label>${esc(t('color'))}<input name="color" type="color" value="${esc(c.color)}"></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action) => {
    if (action === 'delete') { if (confirm(t('confirmDeleteCategory'))) { remove('categories', c.id); changed(); } return; }
    upsert('categories', { ...c, id: c.id || uid(), name: form.name.value.trim(), color: form.color.value, order: c.order ?? 50 }, { silent: true });
    changed();
  });
}

// ---------- smart: suggest a plan / I have some time ----------

function startSuggest() {
  const date = currentDate();
  const s = planSettings();
  const from = date === today() ? Math.ceil((nowMinutes() + 5) / 5) * 5 : s.dayStart;
  const tasks = candidates(live('tasks'), plannedTaskIds(), date);
  const res = suggestDay({ tasks, blocks: blocksOn(date).filter((b) => !b.allowOverlap), date, from, settings: s, leadOf });
  if (!res.placed.length) { toast(tasks.length ? t('noRoomToday') : t('nothingToSuggest')); return; }
  ui.suggest = { date, ...res, off: new Set() };
  render();
}

function acceptSuggest() {
  const sug = ui.suggest;
  let n = 0;
  for (const p of sug.placed) {
    if (sug.off.has(p.taskId)) continue;
    const task = get('tasks', p.taskId);
    if (task) { planTask(task, sug.date, p.start); n++; }
  }
  ui.suggest = null;
  toast(t('addedN', n));
  changed();
}

function openSpare(minutes = null) {
  const date = today();
  const now = nowMinutes();
  const next = blocksOn(date).filter((b) => !b.done && b.start > now).sort((a, b) => a.start - b.start)[0];
  const untilNext = next ? Math.floor((next.start - now) / 5) * 5 : null;
  const X = minutes || (untilNext && untilNext >= 10 ? Math.min(untilNext, 240) : 30);
  const tasks = candidates(live('tasks'), plannedTaskIds(), date);
  const res = spareTime({ tasks, minutes: X, date, leadOf });
  const name = (id) => esc(get('tasks', id)?.title);
  const choices = [...new Set([15, 30, 45, 60, 90, 120, ...(untilNext && untilNext >= 10 && untilNext <= 240 ? [untilNext] : [])])].sort((a, b) => a - b);
  openModal(`
    <h2>⏱ ${esc(t('haveTimeTitle'))}</h2>
    ${next && untilNext >= 10 ? `<p class="hint">${esc(t('untilNext', fmtDur(untilNext), next.title, fmtTime(next.start)))}</p>` : ''}
    <div class="days">${choices.map((m) => `<button class="pill ${m === X ? 'on' : ''}" value="min:${m}" formnovalidate>${fmtDur(m)}</button>`).join('')}</div>
    ${res.singles.length ? `<ul class="list sugg">${res.singles.map((x) => `<li><span class="item-text pad">${name(x.taskId)}<small>${esc(fmtDur(x.minutes))}${x.reasons.length ? ` · ${esc(reasonText(x.reasons))}` : ''}</small></span>
      <button class="btn small primary" value="do:${esc(x.taskId)}">${esc(t('doIt'))}</button></li>`).join('')}</ul>` : `<p class="empty">${esc(t('nothingFits'))}</p>`}
    ${res.combo ? `<div class="field-label">${esc(t('orCombo'))}</div>
      <ul class="list sugg"><li><span class="item-text pad">${res.combo.map((x) => name(x.taskId)).join(' + ')}<small>${esc(fmtDur(res.combo.reduce((s, x) => s + x.minutes, 0)))}</small></span>
      <button class="btn small" value="combo">${esc(t('doAll'))}</button></li></ul>` : ''}
    ${res.starts.length ? `<div class="field-label">${esc(t('makeStart'))}</div>
      <ul class="list sugg">${res.starts.map((x) => `<li><span class="item-text pad">${name(x.taskId)}<small>${esc(t('ofTotal', fmtDur(X), fmtDur(x.minutes)))}${x.reasons.length ? ` · ${esc(reasonText(x.reasons))}` : ''}</small></span>
      <button class="btn small" value="start:${esc(x.taskId)}">${esc(t('start'))}</button></li>`).join('')}</ul>` : ''}
    <div class="button-row"><button class="btn" value="cancel">${esc(t('close'))}</button></div>`, (form, action, e) => {
    if (action.startsWith('min:')) { e.preventDefault(); openSpare(Number(action.slice(4))); return; }
    const at = Math.ceil(nowMinutes() / 5) * 5;
    const doTask = (id, from, extra = {}) => {
      const task = get('tasks', id);
      const b = planTask(task, date, from + (extra.partial ? 0 : leadOf(task)), extra);
      return b.start + b.minutes;
    };
    if (action.startsWith('do:')) doTask(action.slice(3), at);
    else if (action === 'combo') { let from = at; for (const x of res.combo) from = doTask(x.taskId, from); }
    else if (action.startsWith('start:')) doTask(action.slice(6), at, { minutes: X, partial: true });
    location.hash = '#/plan';
    changed();
  });
}

// ---------- events ----------

view.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'task-add' || form.id === 'side-add') {
    const q = quickAdd(form.title.value);
    if (!q.title) return;
    const onDay = form.id === 'side-add' ? currentDate() : null;
    upsert('tasks', {
      id: uid(), createdAt: Date.now(), title: q.title, minutes: q.minutes || 30, priority: q.priority,
      category: findCategory(q.category), due: onDay, repeat: null, notes: '', done: false,
    }, { silent: true });
    form.title.value = '';
    changed();
    document.getElementById(form.id === 'task-add' ? 'task-input' : 'side-add-input')?.focus();
  } else if (form.id === 'gh-form') saveGithub(form);
  else if (form.id === 'ric-form') saveRicette(form);
});

view.addEventListener('change', (e) => {
  const el = e.target;
  const { action, id } = el.dataset;
  if (action === 'task-done') {
    const task = get('tasks', id);
    if (el.checked && checklistLeft(task.checklist || [], task.checked) > 0) { el.checked = false; openTaskChecklist(task); return; }
    setTaskDone(task, el.checked);
    changed();
  }
  if (action === 'block-done') {
    const ok = trySetBlockDone(get('blocks', id), el.checked);
    if (!ok) { el.checked = false; return; }
    changed();
  }
  if (action === 'sug-toggle') {
    if (el.checked) ui.suggest.off.delete(id); else ui.suggest.off.add(id);
    render();
  }
  if (el.id === 'day-picker' && isDate(el.value)) location.hash = `#/plan/${el.value}`;
  if (el.form?.id === 'lang-form') {
    saveSettings({ lang: el.value });
    applyLang(el.value);
    renderShell();
    render();
  }
  if (el.form?.id === 'planner-form') {
    const f = Object.fromEntries(new FormData(el.form));
    const dayStart = Number(f.dayStart); const dayEnd = Number(f.dayEnd);
    saveSettings({ dayStart, dayEnd: Math.max(dayEnd, dayStart + 1), snap: Number(f.snap), buffer: Number(f.buffer), maxLoad: Number(f.maxLoad) });
  }
});

view.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn && btn.tagName === 'INPUT') return; // checkboxes are handled on change
  if (!btn) {
    // Tap on an empty part of the timeline: new block at that time.
    const tl = e.target.closest('.timeline');
    if (tl && !e.target.closest('.block')) {
      const g = tl.getBoundingClientRect();
      const step = Math.max(Number(tl.dataset.snap) || 15, 15);
      const m = Number(tl.dataset.start) + (e.clientY - g.top) / PPM;
      openBlock(null, { date: tl.dataset.date, start: Math.max(0, Math.floor(m / step) * step) });
      return;
    }
    const block = e.target.closest('.block:not(.ghost)');
    if (block && !e.target.closest('.blk-check')) openBlock(get('blocks', block.dataset.id));
    return;
  }
  const { action, id } = btn.dataset;
  switch (action) {
    case 'plan-task': {
      const date = currentDate();
      const b = planTask(get('tasks', id), date);
      toast(t('plannedToast', relDay(date), fmtTime(b.start)));
      changed();
      warnConflicts(get('blocks', b.id));
      break;
    }
    case 'pick-date': {
      const p = $('#day-picker');
      try { p.showPicker(); } catch { p.focus(); p.click(); }
      break;
    }
    case 'new-block': {
      const date = currentDate();
      const s = planSettings();
      const from = date === today() ? nowMinutes() : 9 * 60;
      const start = freeSlot(blocksOn(date), 30, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? from;
      openBlock(null, { date, start });
      break;
    }
    case 'new-meal': openNewMeal(); break;
    case 'templates': openTemplatesMenu(); break;
    case 'suggest': startSuggest(); break;
    case 'sug-accept': acceptSuggest(); break;
    case 'sug-cancel': ui.suggest = null; render(); break;
    case 'spare': openSpare(); break;
    case 'toggle-conflicts': ui.showConflicts = !ui.showConflicts; render(); break;
    case 'fix': fixConflict(conflictsOn(currentDate())[Number(btn.dataset.i)]); break;
    case 'allow': {
      const c = conflictsOn(currentDate())[Number(btn.dataset.i)];
      const b = get('blocks', c.ids[1]);
      upsert('blocks', { ...b, allowOverlap: true }, { silent: true });
      changed();
      break;
    }
    case 'check-meals': {
      const date = currentDate();
      const meals = blocksOn(date).filter((b) => b.kind === 'meal' && !b.done && !b.stockChecked);
      if (meals[0]) checkMeal(meals[0]);
      break;
    }
    case 'task-edit': openTask(get('tasks', id)); break;
    case 'toggle-done': ui.showDone = !ui.showDone; render(); break;
    case 'toggle-helpers': ui.showHelpers = !ui.showHelpers; render(); break;
    case 'clear-done':
      for (const x of live('tasks').filter((y) => y.done)) remove('tasks', x.id);
      changed();
      break;
    case 'tpl-new': openTemplate(null); break;
    case 'tpl-edit': openTemplate(get('templates', id)); break;
    case 'cat-new': openCategory(null); break;
    case 'cat-edit': openCategory(get('categories', id)); break;
    case 'sync-now': runSync().then(() => { ui.connMsg = state.meta.lastError ? `err_${state.meta.lastError}` : 'connected'; render(); }); break;
    case 'ric-off': saveSettings({ ricetteRepo: '' }).then(() => { ui.ricMsg = ''; render(); }); break;
    case 'export': exportData(); break;
    default: break;
  }
});

modal.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action=open-task]');
  if (!a) return;
  e.preventDefault();
  const task = get('tasks', a.dataset.id);
  modal.close();
  setTimeout(() => openTask(task), 0);
});

setupDrag(view, {
  dragging: (on) => { ui.dragging = on; document.body.classList.toggle('is-dragging', on); },
  label: (start, minutes) => range(start, minutes),
  move: (id, start) => {
    const b = get('blocks', id);
    if (b) { const m = upsert('blocks', { ...b, start, auto: false }, { silent: true }); followParent(m); }
    changed();
    warnConflicts(get('blocks', id));
  },
  resize: (id, minutes) => {
    const b = get('blocks', id);
    if (b) upsert('blocks', { ...b, minutes }, { silent: true });
    changed();
    warnConflicts(get('blocks', id));
  },
  dropTask: (id, start) => {
    const task = get('tasks', id);
    let b = null;
    if (task) { b = planTask(task, currentDate(), start); toast(t('plannedToast', relDay(currentDate()), fmtTime(start))); }
    changed();
    if (b) warnConflicts(get('blocks', b.id));
  },
  redraw: () => render(),
});

async function saveGithub(form) {
  await saveSettings({
    owner: form.owner.value.trim(), repo: form.repo.value.trim(),
    token: form.token.value.trim(), branch: form.branch.value.trim() || 'main',
  });
  const res = await testConnection();
  ui.connMsg = res.ok ? 'connected' : `err_${res.error}`;
  render();
  if (res.ok) {
    await runSync();
    ui.connMsg = state.meta.lastError ? `err_${state.meta.lastError}` : 'connected';
    render();
  }
}

async function saveRicette(form) {
  const repo = form.ricetteRepo.value.trim();
  if (!repo) return;
  const res = await testConnection(repo);
  ui.ricMsg = res.ok ? 'connected' : `err_${res.error}`;
  if (res.ok) {
    await saveSettings({ ricetteRepo: repo });
    await runSync();
    if (state.meta.lastError) ui.ricMsg = `err_${state.meta.lastError}`;
  }
  render();
}

function exportData() {
  const data = {};
  for (const c of COLLECTIONS) data[c] = state[c];
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `everyday-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function applyLang(code) {
  setLang(code || detectLang());
  setDecimalSeparator(getLang() === 'en' ? '.' : ',');
}

// ---------- start ----------

async function start() {
  await load();
  applyLang(state.settings.lang);
  seedCategories();
  renderShell();
  render();
  const kinds = new Set([...COLLECTIONS, ...Object.keys(RICETTE), 'meta']);
  onChange((kind) => { if (kinds.has(kind)) { updateSyncBadge(); renderIfSafe(); } });
  window.addEventListener('hashchange', () => { if (ui.suggest && ui.suggest.date !== currentDate()) ui.suggest = null; render(); if (route().name !== 'plan') window.scrollTo(0, 0); });
  window.addEventListener('online', runSync);
  window.addEventListener('offline', () => updateSyncBadge());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { runSync(); renderIfSafe(); } });
  $('#sync').addEventListener('click', runSync);
  runSync();
  // Every minute: move the "now" line, and pick up changes from other devices.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    renderIfSafe();
    runSync();
  }, 60_000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

void saveMeta;
start();
