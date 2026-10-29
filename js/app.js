import {
  state, load, live, get, has, upsert, remove, uid, onChange, saveSettings, saveMeta, COLLECTIONS, RICETTE, kvGet, kvSet,
} from './store.js';
import { syncNow, isConfigured, isSyncing, testConnection, watchMonth, ricetteConfigured, runWorkflow, fetchRicettePhoto } from './sync.js';
import {
  today, addDays, parseDate, isDate, nowMinutes, weekday, dateStr, fmtTime, fmtDur, parseTime, quickAdd,
  REPEATS, completeTask, reopenTask, groupTasks, sortTasks, layoutBlocks, freeSlot, dayTotals,
  parseTemplateLines, formatTemplateLines, templateBlocks, autoTemplatesFor,
} from './plan.js';
import {
  candidates, suggestDay, spareTime, scoreTask, nearestSlot, placePrep, placeGroceries, findConflicts, recipeMinutes,
} from './smart.js';
import { makeKitchen } from './kitchen.js';
import { tagsOf, foldersOf, folderList, filterRecipes, tagCounts, minutesOf } from './recipes.js';
import { formatQty, setDecimalSeparator, namesMatch, addQuantities } from './parse.js';
import { t, setLang, getLang, LANGS, detectLang } from './i18n.js';
import { setupDrag } from './drag.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const view = $('#view');
const modal = $('#modal');
const ui = { view: null, expanded: new Set(), connMsg: '', ricMsg: '', dragging: false, scrolledFor: null, showDone: false, showHelpers: false, suggest: null, showConflicts: false };

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
// Google Calendar events that day (read-only; see data-repo/scripts/gcal-sync.mjs).
function eventsOn(date) { return state.settings.showEvents === false ? [] : live('events').filter((e) => e.date === date); }
function timedEventsOn(date) { return eventsOn(date).filter((e) => !e.allDay).map((e) => ({ ...e, isEvent: true, fixed: true })); }
// Everything that takes up time: your blocks plus busy calendar events.
function busyOn(date) { return [...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)]; }
const itemById = (id) => get('blocks', id) || get('events', id);
function scheduledOn(taskId, date) { return blocksOn(date).some((b) => b.taskId === taskId); }
// To-dos are tasks that aren't preparation steps or meal types (those are set up in Settings).
const isTodo = (x) => !x.helper && !x.routine;
function openTasks() { return live('tasks').filter((x) => !x.done && isTodo(x)); }

// Tasks with a block today or later that isn't finished yet.
function plannedTaskIds() {
  const td = today();
  return new Set(live('blocks').filter((b) => b.taskId && !b.done && !b.outcome && b.date >= td && b.kind !== 'prep').map((b) => b.taskId));
}

function prepOf(task) {
  return (task?.prep || []).map((p) => ({ ...p, task: get('tasks', p.taskId) })).filter((p) => p.task);
}
// Minutes of "right before" preparation a task needs in front of it.
function leadOf(task) {
  return prepOf(task).filter((p) => p.when === 'before').reduce((s, p) => s + (p.task.minutes || 10), 0);
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
    at = freeSlot(busyOn(date), minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
    if (at == null) at = Math.min(Math.ceil(Math.max(nowMinutes(), s.dayStart) / s.snap) * s.snap, 1440 - minutes);
  }
  return newBlock({ date, start: at, minutes, title: task.title, category: task.category || null, taskId: task.id, ...extra });
}

const isCheckStep = (b) => get('tasks', b?.taskId)?.check === 'ingredients';

// Create the linked blocks a block needs: preparations for its task, and keep them in order.
function linkFor(block) {
  const td = today();
  if (!block || block.done || block.outcome || block.date < td || block.kind === 'prep' || block.kind === 'followup') return;
  const task = block.taskId && get('tasks', block.taskId);
  if (!task || block.partial) return;
  for (const p of prepOf(task)) {
    const id = `${block.id}_p_${p.taskId}`;
    const cur = state.blocks.find((x) => x.id === id);
    // An ingredient check only makes sense for a meal that has recipes.
    if (p.task.check === 'ingredients' && !mealRecipes(block).length) {
      if (cur && !cur.deleted && !cur.done && !cur.outcome && cur.auto) remove('blocks', id);
      continue;
    }
    if (cur && (cur.deleted || cur.done || cur.outcome || !cur.auto)) continue; // finished, deleted or moved by hand: leave it
    const pos = placePrep({
      parent: block, minutes: p.task.minutes || 10, mode: p.when, blocksOn: (d) => busyOn(d).filter((x) => x.id !== id),
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
      const pos = placeGroceries({ meal: block, minutes: g.minutes, blocksOn: (d) => busyOn(d).filter((x) => x.id !== g.id), today: today(), nowMin: nowMinutes(), settings: planSettings() });
      upsert('blocks', { ...g, ...pos }, { silent: true });
    }
  }
}

function deleteBlock(b) {
  remove('blocks', b.id);
  for (const c of live('blocks').filter((x) => (x.parentId === b.id || x.sourceId === b.id) && !x.done && !x.outcome)) remove('blocks', c.id);
}

// ---------- outcomes and rules ----------
// A block ends up done, or "couldn't do it". Tasks can carry rules that react to that, e.g.
// "Check ingredients: when it couldn't be done → plan a grocery trip before the meal".

function outcomeOf(b) { return b?.outcome || (b?.done ? 'done' : null); }

function setOutcome(block, outcome) {
  const prev = outcomeOf(block);
  const b = upsert('blocks', { ...block, done: outcome === 'done', outcome: outcome || null }, { silent: true });
  const task = b.taskId && get('tasks', b.taskId);
  if (task && isTodo(task) && !b.partial && b.kind !== 'prep') {
    const done = outcome === 'done';
    if (task.repeat) {
      if (done && (!task.due || task.due <= b.date)) upsert('tasks', completeTask(task, b.date < today() ? today() : b.date), { silent: true });
    } else if (Boolean(task.done) !== done) setTaskDone(task, done);
  }
  if (prev !== (outcome || null)) {
    if (prev) undoRules(b, prev);
    if (outcome) fireRules(get('blocks', b.id), outcome);
  }
  return get('blocks', b.id);
}
function setBlockDone(block, done) { return setOutcome(block, done ? 'done' : null); }

const RULE_WHEN = ['done', 'failed', 'missed'];
const RULE_PLACES = ['before', 'after', 'next', 'tomorrow'];
function rulesOf(b) { return (b?.taskId && get('tasks', b.taskId)?.rules) || []; }

function fireRules(block, when) {
  for (const rule of rulesOf(block).filter((r) => r.when === when)) {
    const id = `${block.id}_r_${rule.id}`;
    if (has('blocks', id)) continue; // fired before (even if its result was deleted since): never twice
    const parent = block.parentId ? get('blocks', block.parentId) : null;
    const target = parent || block;
    if (rule.then === 'groceries') {
      const g = ensureGroceries(target, id);
      toast(t('ruleGroceries', relDay(g.date), fmtTime(g.start)));
      continue;
    }
    const linked = rule.taskId && get('tasks', rule.taskId);
    const minutes = Number(rule.minutes) || linked?.minutes || 30;
    const title = rule.title || linked?.title || t('followUp');
    const s = planSettings();
    let date = block.date; let start;
    if (rule.place === 'before') {
      ({ date, start } = placePrep({ parent: target, minutes, mode: 'before', blocksOn: busyOn, today: today(), nowMin: nowMinutes(), settings: s }));
    } else {
      if (rule.place === 'tomorrow') date = addDays(today(), 1);
      if (rule.place === 'next') date = today();
      const from = rule.place === 'after' ? block.start + block.minutes : rule.place === 'next' ? nowMinutes() : s.dayStart;
      start = freeSlot(busyOn(date), minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? Math.min(from, 1440 - minutes);
    }
    newBlock({
      id, date, start, minutes, title, taskId: linked?.id || null, category: linked?.category || block.category || null,
      kind: 'followup', sourceId: block.id, parentId: rule.place === 'before' ? target.id : null, mustPrecede: rule.place === 'before', auto: true,
    });
    toast(t('ruleAdded', title, relDay(date), fmtTime(start)));
  }
}

// Changed your mind (unticked, or reset "couldn't do it"): take back what the rules added, unless it's under way.
function undoRules(block, when) {
  for (const rule of rulesOf(block).filter((r) => r.when === when)) {
    const cur = get('blocks', `${block.id}_r_${rule.id}`);
    if (cur && !cur.done && !cur.outcome) remove('blocks', cur.id);
  }
}

// "When this was missed": the block's time has passed today without it being done.
function checkMissed(date) {
  if (date !== today()) return;
  const now = nowMinutes();
  for (const b of blocksOn(date)) {
    if (outcomeOf(b) || b.missedAt || b.start + b.minutes > now || !rulesOf(b).some((r) => r.when === 'missed')) continue;
    fireRules(upsert('blocks', { ...b, missedAt: Date.now() }, { silent: true }), 'missed');
  }
}

// The "Check ingredients" step before a meal ticks itself once its time comes: everything there →
// done; something missing → it goes on Ricette's shopping list and the step "couldn't be done",
// which (by its rule) plans a grocery trip before the meal.
function runCheck(step, { auto = false } = {}) {
  const meal = step.parentId && get('blocks', step.parentId);
  if (!meal || !ricetteConfigured() || !mealRecipes(meal).length) { setOutcome(step, 'done'); return; }
  const missing = missingForMeal(meal);
  if (!missing.length) { setOutcome(step, 'done'); if (!auto) toast(t('allInPantry')); return; }
  for (const m of missing) kitchen.addToShopping({ name: m.name, qty: m.buy, unit: m.unit, note: m.note }, meal.title);
  kitchen.ensureLowItems();
  const b = upsert('blocks', { ...get('blocks', step.id), missing: missing.map((m) => [qtyText(m.buy, m.unit), m.name].filter(Boolean).join(' ')) }, { silent: true });
  setOutcome(b, 'failed');
  toast(t('checkMissing', missing.length, meal.title));
}

function autoChecks(date) {
  if (date !== today()) return;
  const now = nowMinutes();
  for (const b of blocksOn(date)) if (isCheckStep(b) && !outcomeOf(b) && b.start <= now) runCheck(b, { auto: true });
}

// Ticking a block. A block with an unfinished checklist can't be ticked: the checklist opens
// instead. An ingredient check runs the check.
function trySetBlockDone(block, done) {
  if (done && isCheckStep(block)) { runCheck(block); return true; }
  if (done && checklistLeft(checklistOf(block), block.checked) > 0) { openChecklist(block); return false; }
  setOutcome(block, done ? 'done' : null);
  if (done && block.kind === 'meal' && ricetteConfigured()) {
    const list = mealRecipes(block).map((x) => ({ r: recipeOf(x.recipeId), n: x.servings })).filter((x) => x.r);
    if (list.length && confirm(t('cookedConfirm', list.map((x) => x.r.title).join(', ')))) {
      let n = 0;
      for (const x of list) n += kitchen.cook(x.r, x.n || x.r.servings || 2);
      toast(t('pantryUpdated', n));
    }
  }
  return true;
}

// ---------- meals (Ricette) ----------
// Meal types (Breakfast, Lunch, Dinner, Snack, or your own) are tasks set up in Settings, with a
// usual time, and by default a "Check ingredients" step before them. A meal on the plan is a block
// of a meal type with one or more recipes inside.

const MEAL_DEFAULTS = [
  { key: 'breakfast', start: 450, minutes: 20, check: 'daybefore' },
  { key: 'lunch', start: 750, minutes: 45, check: 'sameday' },
  { key: 'dinner', start: 1170, minutes: 60, check: 'sameday' },
  { key: 'snack', start: 990, minutes: 15, check: null },
];

function seedMeals() {
  if (!has('tasks', 'meal_check')) {
    upsert('tasks', {
      id: 'meal_check', helper: true, check: 'ingredients', title: t('checkStep'), minutes: 5, category: 'meals', checklist: [], notes: '',
      rules: [{ id: 'groceries', when: 'failed', then: 'groceries' }], createdAt: 1,
    }, { silent: true, at: 1 });
  }
  for (const m of MEAL_DEFAULTS) {
    const id = `meal_${m.key}`;
    if (has('tasks', id)) continue;
    upsert('tasks', {
      id, routine: true, meal: true, title: t(`mt_${m.key}`), minutes: m.minutes, defaultStart: m.start, category: 'meals',
      prep: m.check ? [{ taskId: 'meal_check', when: m.check }] : [], rules: [], checklist: [], notes: '', createdAt: 1,
    }, { silent: true, at: 1 });
  }
}

function mealTypes() { return live('tasks').filter((x) => x.meal).sort((a, b) => (a.defaultStart ?? 0) - (b.defaultStart ?? 0)); }
function mealRecipes(b) { return b?.recipes || (b?.recipeId ? [{ recipeId: b.recipeId, servings: b.servings }] : []); }
function mealTitle(type, list) {
  const names = list.map((x) => recipeOf(x.recipeId)?.title).filter(Boolean);
  return `${type}${names.length ? ` · ${names.join(', ')}` : ''}`;
}

function recipes() { return live('r_recipes').sort((a, b) => (a.title || '').localeCompare(b.title || '')); }
const recipeOf = (id) => get('r_recipes', id);
const isBefore = (a, b) => a.date < b.date || (a.date === b.date && a.start < b.start);

// What's missing for all of a meal's recipes, counting the pantry, the shopping list, the meals
// planned before it, and the recipes before it in the same meal.
function missingForMeal(meal) {
  const flat = (b) => mealRecipes(b).map((x) => ({ recipeId: x.recipeId, servings: x.servings }));
  const earlier = live('blocks').filter((b) => b.kind === 'meal' && !b.done && b.id !== meal.id && b.date >= today() && isBefore(b, meal)).flatMap(flat);
  const mine = flat(meal);
  const out = [];
  mine.forEach((x, i) => {
    const r = recipeOf(x.recipeId);
    if (!r) return;
    const pantry = kitchen.pantryAfter([...earlier, ...mine.slice(0, i)], recipeOf);
    for (const m of kitchen.missingFor(r, x.servings || r.servings || 2, pantry)) {
      const same = out.find((o) => namesMatch(o.name, m.name) && addQuantities({ qty: o.buy, unit: o.unit }, { qty: m.buy, unit: m.unit }));
      if (same) { const sum = addQuantities({ qty: same.buy, unit: same.unit }, { qty: m.buy, unit: m.unit }); same.buy = sum.qty; same.unit = sum.unit; } else out.push({ ...m });
    }
  });
  return out;
}

function qtyText(qty, unit) {
  if (qty == null) return '';
  return [formatQty(qty, unit), unit === 'pcs' ? '' : unit].filter(Boolean).join(' ');
}

// "Check ingredients" from the meal itself: runs its check step, or (for a meal without one)
// asks what to put on the list.
function checkMealNow(meal) {
  const step = live('blocks').find((b) => b.parentId === meal.id && isCheckStep(b));
  if (step) { if (outcomeOf(step)) setOutcome(step, null); runCheck(get('blocks', step.id)); changed(); return; }
  const missing = missingForMeal(meal);
  if (!missing.length) { toast(t('allInPantry')); return; }
  setTimeout(() => openModal(`
    <h2>${esc(t('missingTitle', meal.title))}</h2>
    <p class="hint">${esc(t('missingHint'))}</p>
    <ul class="list checklist">${missing.map((m, i) => `<li><label><input type="checkbox" name="m" value="${i}" checked>
      <span class="item-text">${esc(m.name)}<small>${esc(qtyText(m.buy, m.unit))}${m.have ? ` · ${esc(t('inPantry'))}: ${esc(qtyText(Number(m.have.qty) || 0, m.have.unit))}` : ''}</small></span></label></li>`).join('')}</ul>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('addAndPlanShop'))}</button>
      <button class="btn" value="cancel">${esc(t('skip'))}</button>
    </div>`, (form) => {
    const picked = [...form.querySelectorAll('input[name=m]:checked')].map((i) => missing[Number(i.value)]);
    if (!picked.length) return;
    for (const m of picked) kitchen.addToShopping({ name: m.name, qty: m.buy, unit: m.unit, note: m.note }, meal.title);
    kitchen.ensureLowItems();
    const g = ensureGroceries(get('blocks', meal.id));
    toast(t('groceriesPlanned', relDay(g.date), fmtTime(g.start)));
    changed();
  }), 0);
}

// Reuse a grocery trip already planned before the meal, or plan a new one.
function ensureGroceries(meal, newId = null) {
  const td = today();
  const existing = live('blocks').filter((b) => b.kind === 'groceries' && !b.done && !b.outcome && b.date >= td
    && (b.date < meal.date || (b.date === meal.date && b.start + b.minutes <= meal.start)))
    .sort((a, b) => (isBefore(a, b) ? 1 : -1))[0];
  let g = existing;
  if (!g) {
    const pos = placeGroceries({ meal, minutes: GROCERY_MINUTES, blocksOn: busyOn, today: td, nowMin: nowMinutes(), settings: planSettings() });
    g = newBlock({ ...(newId ? { id: newId } : {}), ...pos, kind: 'groceries', title: t('groceryTitle'), minutes: GROCERY_MINUTES, category: 'meals', auto: true });
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
  return findConflicts([...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)], { getBlock: (id) => get('blocks', id), getTask: (id) => get('tasks', id) });
}

function warnConflicts(block) {
  if (!block) return;
  const c = conflictsOn(block.date).find((x) => x.ids.includes(block.id));
  if (!c) return;
  toast(`⚠ ${conflictText(c)}`);
}

function conflictText(c) {
  const [a, b] = c.ids.map(itemById);
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
    const [a, b] = c.ids.map((id) => itemById(id) && { ...itemById(id), fixed: !get('blocks', id) });
    const weight = (x) => (x.fixed ? 1e7 : x.done ? 1e6 : x.kind === 'meal' ? 1e5 : x.taskId && get('tasks', x.taskId) ? scoreTask(get('tasks', x.taskId), x.date).score : 20);
    const mover = weight(a) < weight(b) ? a : b;
    const others = busyOn(mover.date).filter((x) => x.id !== mover.id && !x.allowOverlap);
    const from = mover.date === today() ? nowMinutes() : s.dayStart;
    const at = nearestSlot(others, mover.minutes, mover.start, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap, buffer: s.buffer });
    if (at == null) { toast(t('noRoom')); return; }
    const moved = upsert('blocks', { ...mover, start: at, auto: false }, { silent: true });
    followParent(moved);
    toast(t('movedTo', mover.title, fmtTime(at)));
  } else if (c.type === 'order') {
    const [first, then] = c.ids.map((id) => get('blocks', id));
    const others = (d) => busyOn(d).filter((x) => x.id !== first.id);
    const pos = first.kind === 'groceries'
      ? placeGroceries({ meal: then, minutes: first.minutes, blocksOn: others, today: today(), nowMin: nowMinutes(), settings: s })
      : placePrep({ parent: then, minutes: first.minutes, mode: 'before', blocksOn: others, today: today(), nowMin: nowMinutes(), settings: s });
    upsert('blocks', { ...first, ...pos, auto: true }, { silent: true });
  } else if (c.type === 'late') {
    const b = get('blocks', c.ids[0]);
    const due = get('tasks', b.taskId)?.due;
    if (!due || due < today()) return;
    const from = due === today() ? nowMinutes() : s.dayStart;
    const at = freeSlot(busyOn(due), b.minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
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
  const planChanged = Object.keys(state.meta.dirtyShards || {}).some((k) => k.startsWith('blocks/'));
  await syncNow();
  // Plan changed and Google Calendar is set up: push it there soon (at most every 10 minutes).
  if (planChanged && !state.meta.lastError && get('gcal', 'status') && Date.now() - (ui.lastDispatch || 0) > 600_000) gcalNow(true);
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

// ---------- views of the plan: list, day, week, month ----------

const VIEWS = ['list', 'day', 'week', 'month'];
function currentView() { return ui.view || state.settings.defaultView || 'day'; }
function weekStart(date) { return addDays(date, -((weekday(date) + 6) % 7)); } // Monday

// Keep linked blocks up to date and run what's due, for the days on screen.
function prepareDays(days) {
  for (const d of days) { watchMonth(d.slice(0, 7)); autoApply(d); }
  const next = addDays(days[days.length - 1], 1);
  watchMonth(next.slice(0, 7));
  autoApply(next); // so "the evening before" preparations for the next day show up
  for (const d of [...days, next]) for (const b of blocksOn(d)) if (b.taskId && b.kind !== 'prep' && !outcomeOf(b)) linkFor(b);
  if (days.includes(today())) { autoChecks(today()); checkMissed(today()); }
}

function viewPlan(date) {
  const v = currentView();
  const td = today();
  let title; let prev; let next; let sub = '';
  if (v === 'day') {
    const totals = dayTotals(blocksOn(date));
    title = fmtDay(date); prev = addDays(date, -1); next = addDays(date, 1);
    sub = `${date === td ? t('today') : relDay(date)} · ${totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned')}${totals.done ? ` · ${t('doneSum', fmtDur(totals.done))}` : ''}`;
  } else if (v === 'month') {
    const d = parseDate(date);
    title = fmtDay(date, { month: 'long', year: 'numeric' });
    prev = dateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)); next = dateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  } else {
    const from = v === 'week' ? weekStart(date) : date;
    title = `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(from, 6), { day: 'numeric', month: 'short' })}`;
    prev = addDays(date, -7); next = addDays(date, 7);
    sub = v === 'week' ? t('weekN', isoWeek(from)) : t('nextDays');
  }
  const showToday = v === 'day' || v === 'list' ? date !== td : v === 'week' ? weekStart(date) !== weekStart(td) : date.slice(0, 7) !== td.slice(0, 7);
  const head = `
  <div class="view-switch" role="tablist">${VIEWS.map((k) => `<button type="button" role="tab" class="${k === v ? 'on' : ''}" data-action="view" data-id="${k}" aria-selected="${k === v}">${esc(t(`v_${k}`))}</button>`).join('')}</div>
  <div class="day-head">
    <a class="round" href="#/plan/${prev}" aria-label="${esc(t('previous'))}">‹</a>
    <button class="day-title" type="button" data-action="pick-date">
      <span class="day-name">${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
    </button>
    <a class="round" href="#/plan/${next}" aria-label="${esc(t('next'))}">›</a>
    <input type="date" id="day-picker" value="${date}" tabindex="-1" aria-hidden="true">
  </div>
  <div class="day-actions">
    ${showToday ? `<a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a>` : ''}
    <button class="btn small" type="button" data-action="new-block">+ ${esc(t('block'))}</button>
    <button class="btn small" type="button" data-action="new-meal">+ ${esc(t('meal'))}</button>
    <button class="btn small" type="button" data-action="templates">${esc(t('templates'))}</button>
  </div>`;
  if (v === 'list') return head + viewList(date);
  if (v === 'week') return head + viewWeek(date);
  if (v === 'month') return head + viewMonth(date);
  return head + viewDay(date);
}

function isoWeek(date) {
  const d = parseDate(date); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function timelineRange(items) {
  const s = state.settings;
  let startMin = s.dayStart * 60; let endMin = s.dayEnd * 60;
  for (const b of items) { startMin = Math.min(startMin, Math.floor((b.start - (b.lead || 0)) / 60) * 60); endMin = Math.max(endMin, Math.ceil((b.start + b.minutes) / 60) * 60); }
  startMin = Math.max(0, startMin); endMin = Math.min(endMin, 1440);
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);
  return { startMin, endMin, hours };
}

function conflictBanner(date) {
  const td = today();
  const conflicts = conflictsOn(date);
  if (!conflicts.length) return '';
  return `<div class="notice warn">
    <button class="notice-head" type="button" data-action="toggle-conflicts">⚠ ${esc(t('nConflicts', conflicts.length))} <span>${ui.showConflicts ? '▴' : '▾'}</span></button>
    ${ui.showConflicts ? `<ul>${conflicts.map((c, i) => `<li><span>${esc(conflictText(c))}</span>
      ${c.type !== 'late' || (get('tasks', get('blocks', c.ids[0])?.taskId)?.due || '') >= td ? `<button class="btn small" type="button" data-action="fix" data-date="${date}" data-i="${i}">${esc(t('fix'))}</button>` : ''}
      ${c.type === 'overlap' ? `<button class="btn small ghost" type="button" data-action="allow" data-date="${date}" data-i="${i}">${esc(t('fine'))}</button>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function viewDay(date) {
  prepareDays([date]);
  const td = today();
  const s = state.settings;
  const blocks = blocksOn(date);
  const events = timedEventsOn(date);
  const allDay = eventsOn(date).filter((e) => e.allDay);
  const sug = ui.suggest?.date === date ? ui.suggest : null;
  const ghosts = sug ? sug.placed.filter((p) => !sug.off.has(p.taskId)) : [];
  const { startMin, endMin, hours } = timelineRange([...blocks, ...events, ...ghosts]);
  const inConflict = new Set(conflictsOn(date).flatMap((c) => c.ids));
  const laid = layoutBlocks([...blocks, ...events]);
  const isToday = date === td;

  const plannedElsewhere = plannedTaskIds();
  const toPlan = sortTasks(openTasks().filter((x) => !scheduledOn(x.id, date) && (x.repeat || !plannedElsewhere.has(x.id))
    && (x.due ? x.due === date || (x.due < date && date === td) : date >= td)), td);
  const due = toPlan.filter((x) => x.due);
  const anytime = toPlan.filter((x) => !x.due);
  const chip = (x) => `<button class="chip" type="button" data-action="plan-task" data-task="1" data-id="${esc(x.id)}" data-title="${esc(x.title)}" data-minutes="${x.minutes || 30}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}">
      <span class="chip-dot"></span><span class="chip-title">${esc(x.title)}</span><small>${esc(fmtDur(x.minutes || 30))}${x.due && x.due < date ? ` · ${esc(t('late'))}` : ''}</small></button>`;

  return `
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
      ${conflictBanner(date)}
      ${allDay.length ? `<div class="allday">${allDay.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>` : ''}
      <div class="timeline" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${date}" style="height:${(endMin - startMin) * PPM}px">
        ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"><span>${fmtTime(m)}</span></div>`).join('')}
        ${isToday ? '<div class="now" id="now-line" hidden></div>' : ''}
        ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id)))).join('')}
        ${ghosts.map((g) => ghostHtml(g, startMin)).join('')}
        ${blocks.length || events.length || ghosts.length ? '' : `<div class="tl-empty">${esc(t('emptyDay'))}</div>`}
      </div>
    </section>
  </div>`;
}

// Week: seven day columns side by side. Blocks can be dragged within a day and across days.
function viewWeek(date) {
  const td = today();
  const s = state.settings;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  prepareDays(days.filter((d) => d >= td).length ? days : [days[0]]);
  const all = days.flatMap((d) => [...blocksOn(d), ...timedEventsOn(d)]);
  const { startMin, endMin, hours } = timelineRange(all);
  const h = (endMin - startMin) * PPM;
  const allDay = days.map((d) => eventsOn(d).filter((e) => e.allDay));
  const wd = (d) => fmtDay(d, { weekday: 'short' });
  return `
  <div class="week">
    <div class="week-head"><div class="wk-gutter"></div>
      ${days.map((d) => `<button type="button" class="wk-day${d === td ? ' today' : ''}" data-action="view-day" data-id="${d}"><span>${esc(wd(d))}</span><b>${parseDate(d).getDate()}</b></button>`).join('')}
    </div>
    ${allDay.some((x) => x.length) ? `<div class="week-allday"><div class="wk-gutter"></div>${allDay.map((list) => `<div>${list.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>` : ''}
    <div class="week-body">
      <div class="wk-hours" style="height:${h}px">${hours.map((m) => `<span style="top:${(m - startMin) * PPM}px">${fmtTime(m)}</span>`).join('')}</div>
      ${days.map((d) => {
    const inConflict = new Set(conflictsOn(d).flatMap((c) => c.ids));
    const laid = layoutBlocks([...blocksOn(d), ...timedEventsOn(d)]);
    return `<div class="timeline wk-col${d === td ? ' today' : ''}" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${d}" style="height:${h}px">
          ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"></div>`).join('')}
          ${d === td ? '<div class="now" id="now-line" hidden></div>' : ''}
          ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id)))).join('')}
        </div>`;
  }).join('')}
    </div>
  </div>`;
}

// Month: a calendar grid; each day shows its first few items. Tap a day to open it.
function viewMonth(date) {
  const td = today();
  const first = `${date.slice(0, 7)}-01`;
  const start = weekStart(first);
  const month = date.slice(0, 7);
  for (const m of [-1, 0, 1]) { const d = parseDate(first); d.setMonth(d.getMonth() + m); watchMonth(dateStr(d).slice(0, 7)); }
  const cells = [];
  for (let d = start; cells.length < 42; d = addDays(d, 1)) cells.push(d);
  while (cells.length > 35 && cells.slice(-7).every((d) => d.slice(0, 7) !== month)) cells.splice(-7);
  const heads = Array.from({ length: 7 }, (_, i) => fmtDay(addDays(start, i), { weekday: 'short' }));
  return `
  <div class="month">
    <div class="m-head">${heads.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    <div class="m-grid">${cells.map((d) => {
    const items = [...eventsOn(d).filter((e) => e.allDay), ...[...blocksOn(d), ...timedEventsOn(d)].sort((a, b) => a.start - b.start)];
    const conflict = conflictsOn(d).length > 0;
    return `<button type="button" class="m-cell${d.slice(0, 7) !== month ? ' other' : ''}${d === td ? ' today' : ''}" data-action="view-day" data-id="${d}">
        <span class="m-num">${parseDate(d).getDate()}${conflict ? ' <span class="warn-ico">⚠</span>' : ''}</span>
        ${items.slice(0, 3).map((x) => `<span class="m-item${outcomeOf(x) ? ' done' : ''}" style="--c:${esc(x.isEvent || x.allDay ? x.color : catColor(x.category) || 'var(--accent)')}">${x.allDay ? '' : `<i>${fmtTime(x.start)}</i> `}${esc(x.title)}</span>`).join('')}
        ${items.length > 3 ? `<span class="m-more">${esc(t('nMore', items.length - 3))}</span>` : ''}
      </button>`;
  }).join('')}</div>
  </div>`;
}

// List: the next seven days as an agenda. What each row shows at a glance is set in Settings;
// tap a row to see the rest (notes, checklist, recipes) and act on it.
const GLANCE = ['time', 'duration', 'category', 'due', 'priority', 'checklist', 'prep', 'recipes', 'location', 'notes'];
const GLANCE_DEFAULT = ['time', 'duration', 'category', 'due', 'checklist', 'recipes', 'location'];
function glance() { return new Set(state.settings.glance || GLANCE_DEFAULT); }

function viewList(date) {
  const td = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i));
  prepareDays(days.filter((d) => d >= td).length ? days : [date]);
  const planned = plannedTaskIds();
  return `<div class="agenda">${days.map((d) => {
    const items = [...eventsOn(d).filter((e) => e.allDay).map((e) => ({ ...e, isEvent: true })), ...[...blocksOn(d), ...timedEventsOn(d)].sort((a, b) => a.start - b.start || a.minutes - b.minutes)];
    const dueTasks = sortTasks(openTasks().filter((x) => !planned.has(x.id) && x.due && (x.due === d || (d === td && x.due < td))), td);
    const totals = dayTotals(blocksOn(d));
    const inConflict = new Set(conflictsOn(d).flatMap((c) => c.ids));
    return `<section class="ag-day${d === td ? ' today' : ''}">
      <h2><button type="button" class="linkish plain" data-action="view-day" data-id="${d}">${esc(d === td || d === addDays(td, 1) ? relDay(d) : fmtDay(d, { weekday: 'long' }))}</button>
        <small>${esc(fmtDay(d, { day: 'numeric', month: 'long' }))}${totals.planned ? ` · ${esc(t('plannedSum', fmtDur(totals.planned)))}` : ''}</small></h2>
      ${inConflict.size ? conflictBanner(d) : ''}
      ${items.length || dueTasks.length ? `<ul class="ag-list">${items.map((x) => agendaRow(x, inConflict.has(x.id))).join('')}${dueTasks.map((x) => dueRow(x, d)).join('')}</ul>`
    : `<p class="hint ag-empty">${esc(t('nothingPlanned'))}</p>`}
    </section>`;
  }).join('')}</div>`;
}

function glanceBits(x) {
  const g = glance();
  const bits = [];
  if (x.isEvent) {
    if (g.has('location') && x.location) bits.push(`📍 ${esc(x.location)}`);
    bits.push(`<span class="cat" style="--c:${esc(x.color)}">${esc(x.calendar)}</span>`);
    return bits;
  }
  const task = x.taskId && get('tasks', x.taskId);
  if (g.has('duration')) bits.push(esc(fmtDur(x.minutes)));
  const cat = get('categories', x.category);
  if (g.has('category') && cat) bits.push(`<span class="cat" style="--c:${esc(cat.color)}">${esc(catName(cat))}</span>`);
  if (g.has('due') && task?.due && isTodo(task)) bits.push(`<span class="${task.due < x.date ? 'late' : ''}">${esc(t('dueOn', relDay(task.due)))}</span>`);
  if (g.has('priority') && task?.priority) bits.push(`<span class="prio">${'!'.repeat(4 - task.priority)}</span>`);
  const items = checklistOf(x);
  if (g.has('checklist') && items.length) bits.push(`☑ ${items.length - checklistLeft(items, x.checked)}/${items.length}`);
  if (g.has('prep') && x.parentId) { const p = get('blocks', x.parentId); if (p) bits.push(`↳ ${esc(t('forParent', p.title))}`); }
  if (g.has('recipes') && x.kind === 'meal') { const n = mealRecipes(x).length; if (n) bits.push(`🍽 ${esc(t('nRecipes', n))}`); }
  if (g.has('notes') && x.notes) bits.push(`<span class="ag-note">${esc(x.notes.slice(0, 60))}</span>`);
  if (x.outcome === 'failed') bits.push(`<span class="late">${esc(t('couldnt'))}</span>`);
  return bits;
}

const KIND_ICON = { prep: '↳ ', meal: '🍽 ', groceries: '🛒 ', followup: '↪ ' };

function agendaRow(x, conflict) {
  const g = glance();
  const open = ui.expanded.has(x.id);
  const time = x.allDay ? t('allDay') : range(x.start, x.minutes);
  const status = outcomeOf(x);
  return `<li class="ag-row${status ? ` ${status}` : ''}${conflict ? ' conflict' : ''}${x.isEvent ? ' event' : ''}${open ? ' open' : ''}" style="--c:${esc(x.isEvent ? x.color : catColor(x.category) || 'var(--accent)')}">
    ${x.isEvent ? '<span class="ag-check"></span>' : `<input type="checkbox" class="ag-check" data-action="block-done" data-id="${esc(x.id)}" ${status === 'done' ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`}
    <button type="button" class="ag-main" data-action="${x.isEvent ? 'event' : 'ag-toggle'}" data-id="${esc(x.id)}">
      ${g.has('time') ? `<span class="ag-time">${esc(time)}</span>` : ''}
      <span class="ag-text"><span class="ag-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${KIND_ICON[x.kind] || ''}${esc(x.title)}</span>
      <small>${glanceBits(x).join(' · ')}</small></span>
    </button>
    ${open && !x.isEvent ? agendaDetails(x) : ''}
  </li>`;
}

function agendaDetails(b) {
  const items = checklistOf(b);
  const task = b.taskId && get('tasks', b.taskId);
  const parent = b.parentId && get('blocks', b.parentId);
  const recs = b.kind === 'meal' ? mealRecipes(b).map((x) => recipeOf(x.recipeId)).filter(Boolean) : [];
  return `<div class="ag-details">
    ${parent ? `<p class="hint">↳ ${esc(t('prepForBlock', parent.title, fmtTime(parent.start)))}</p>` : ''}
    ${b.missing?.length ? `<p class="hint">🛒 ${esc(t('missingWere', b.missing.join(', ')))}</p>` : ''}
    ${recs.length ? `<ul class="ag-recipes">${recs.map((r) => `<li>${(r.photos && r.photos[0]) || r.image ? photoTag((r.photos && r.photos[0]) || r.image) : ''}<span>${esc(r.title)}</span></li>`).join('')}</ul>` : ''}
    ${items.length ? `<ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" data-block="${esc(b.id)}" ${(b.checked || [])[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>` : ''}
    ${b.notes ? `<p class="notes">${esc(b.notes)}</p>` : ''}
    ${task && isTodo(task) && task.notes ? `<p class="notes">${esc(task.notes)}</p>` : ''}
    <div class="button-row">
      <button class="btn small" type="button" data-action="block-edit" data-id="${esc(b.id)}">${esc(t('edit'))}</button>
      ${outcomeOf(b) ? `<button class="btn small ghost" type="button" data-action="block-reset" data-id="${esc(b.id)}">${esc(t('reset'))}</button>`
    : `<button class="btn small ghost" type="button" data-action="block-fail" data-id="${esc(b.id)}">${esc(t('couldntDo'))}</button>`}
    </div>
  </div>`;
}

// A task due that day that isn't planned yet.
function dueRow(x, date) {
  const td = today();
  const g = glance();
  const bits = [];
  if (g.has('duration')) bits.push(esc(fmtDur(x.minutes || 30)));
  const cat = get('categories', x.category);
  if (g.has('category') && cat) bits.push(`<span class="cat" style="--c:${esc(cat.color)}">${esc(catName(cat))}</span>`);
  if (g.has('priority') && x.priority) bits.push(`<span class="prio">${'!'.repeat(4 - x.priority)}</span>`);
  return `<li class="ag-row due" style="--c:${esc(catColor(x.category) || 'var(--accent)')}">
    <input type="checkbox" class="ag-check" data-action="task-done" data-id="${esc(x.id)}" aria-label="${esc(t('markDone'))}">
    <button type="button" class="ag-main" data-action="task-edit" data-id="${esc(x.id)}">
      ${g.has('time') ? `<span class="ag-time ${x.due < td ? 'late' : ''}">${esc(x.due < td ? t('overdue') : t('dueLabel'))}</span>` : ''}
      <span class="ag-text"><span class="ag-title">${esc(x.title)}</span><small>${bits.join(' · ')}</small></span>
    </button>
    <button class="btn small" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${date < td ? td : date}">${esc(t('planIt'))}</button>
  </li>`;
}

function blockHtml(b, startMin, conflict) {
  const color = catColor(b.category) || 'var(--accent)';
  const short = b.minutes < 30;
  const left = `calc(${(b.col / b.cols) * 100}% + 1px)`;
  const width = `calc(${100 / b.cols}% - 3px)`;
  const items = checklistOf(b);
  const status = outcomeOf(b);
  let extra = '';
  if (items.length) extra = `<span class="mini-badge">☑ ${items.length - checklistLeft(items, b.checked)}/${items.length}</span>`;
  if (b.kind === 'groceries') { const n = live('r_shopping').filter((x) => !x.checked).length; extra = `<span class="mini-badge">${n}</span>`; }
  if (status === 'failed') extra = `<span class="mini-badge bad">✕</span>`;
  return `<div class="block${status ? ` ${status}` : ''}${status === 'failed' ? ' done' : ''}${short ? ' short' : ''}${conflict ? ' conflict' : ''}${b.kind ? ` k-${b.kind}` : ''}" data-id="${esc(b.id)}" data-start="${b.start}" data-minutes="${b.minutes}"
    style="--c:${esc(color)};top:${(b.start - startMin) * PPM}px;height:${Math.max(b.minutes * PPM, 16)}px;left:${left};width:${width}">
    <input type="checkbox" class="blk-check" data-action="block-done" data-id="${esc(b.id)}" ${status === 'done' ? 'checked' : ''} aria-label="${esc(t('markDone'))}">
    <div class="blk-body">
      <div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${KIND_ICON[b.kind] || ''}${esc(b.title)} ${extra}</div>
      <div class="blk-time">${range(b.start, b.minutes)}</div>
    </div>
    <div class="resize" aria-hidden="true"></div>
  </div>`;
}

function eventHtml(e, startMin, conflict) {
  const left = `calc(${(e.col / e.cols) * 100}% + 1px)`;
  const width = `calc(${100 / e.cols}% - 3px)`;
  return `<div class="block event${e.busy === false ? ' free' : ''}${e.minutes < 30 ? ' short' : ''}${conflict ? ' conflict' : ''}" data-id="${esc(e.id)}"
    style="--c:${esc(e.color || '#6b7280')};top:${(e.start - startMin) * PPM}px;height:${Math.max(e.minutes * PPM, 16)}px;left:${left};width:${width}">
    <div class="blk-body"><div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${esc(e.title)}</div>
    <div class="blk-time">${range(e.start, e.minutes)} · ${esc(e.calendar)}</div></div></div>`;
}

function openEvent(e) {
  openModal(`
    <h2>${esc(e.title)}</h2>
    <p class="hint"><span class="cat" style="--c:${esc(e.color)}">${esc(e.calendar)}</span> · ${esc(fmtDay(e.date))}${e.allDay ? '' : ` · ${range(e.start, e.minutes)}`}</p>
    ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    <p class="hint">${esc(t('eventReadOnly'))}</p>
    <div class="button-row">
      ${e.link ? `<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(t('openInGoogle'))}</a>` : ''}
      <button class="btn" value="cancel">${esc(t('close'))}</button>
    </div>`, () => {});
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

// ---------- meals: the meal dialog and the recipe picker ----------

const canCookNow = (r) => kitchen.missingFor(r, r.servings || 2, live('r_pantry')).length === 0;
const coverOf = (r) => (r?.photos && r.photos[0]) || r?.image || '';

// Photos: from Ricette's repo (images/...) via GitHub, cached on the device; web images directly.
const photoUrls = new Map();
const photoReady = new Map();
function photoTag(src, cls = '') {
  if (String(src).startsWith('images/')) return `<img class="${cls}" data-photo="${esc(src)}" alt="">`;
  return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
async function photoUrl(path) {
  if (photoUrls.has(path)) return photoUrls.get(path);
  const p = (async () => {
    let blob = await kvGet(`rimg:${path}`);
    if (!blob) { blob = await fetchRicettePhoto(path); if (blob) await kvSet(`rimg:${path}`, blob); }
    return blob ? URL.createObjectURL(blob) : null;
  })();
  photoUrls.set(path, p);
  return p;
}
function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const path = img.dataset.photo;
    if (photoReady.has(path)) { img.src = photoReady.get(path); continue; }
    photoUrl(path).then((url) => { if (url) { photoReady.set(path, url); img.src = url; } else img.remove(); });
  }
}

// A meal: its type (Breakfast, Lunch…), when, for how many people, and the recipes in it.
function openMeal(block, draft = null) {
  const types = mealTypes();
  if (!types.length) { toast(t('noMealTypes')); return; }
  const isNew = !block;
  const x = draft || (block
    ? { ...block, typeId: block.taskId || types.find((tp) => block.title?.startsWith(tp.title))?.id || types[0].id, recipes: mealRecipes(block).map((r) => ({ ...r })), people: block.servings || mealRecipes(block)[0]?.servings || 2 }
    : (() => {
      const now = nowMinutes(); const date = ui.mealDate || currentDate();
      // The next meal of the day by default.
      const tp = (date === today() && types.find((y) => (y.defaultStart ?? 0) > now)) || types.find((y) => y.id === 'meal_dinner') || types[0];
      return { kind: 'meal', date, typeId: tp.id, start: tp.defaultStart ?? 1170, minutes: tp.minutes || 45, recipes: [], people: 2, notes: '' };
    })());
  const type = get('tasks', x.typeId) || types[0];
  const rows = x.recipes.map((r, i) => {
    const rec = recipeOf(r.recipeId);
    const m = rec && minutesOf(rec);
    return `<li>${rec && coverOf(rec) ? photoTag(coverOf(rec), 'mr-photo') : `<span class="mr-photo ph">${esc((rec?.title || '?').charAt(0))}</span>`}
      <span class="mr-text">${esc(rec?.title || t('unknownRecipe'))}<small>${[m ? fmtDur(m) : '', t('nPeople', x.people)].filter(Boolean).map(esc).join(' · ')}</small></span>
      <button class="icon" value="rm-rec:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></li>`;
  }).join('');
  openModal(`
    <h2>🍽 ${esc(isNew ? t('newMeal') : t('meal'))}</h2>
    <div class="days meal-types">${types.map((tp) => `<label class="day-pill"><input type="radio" name="type" value="${esc(tp.id)}" ${tp.id === type.id ? 'checked' : ''}><span>${esc(tp.title)}</span></label>`).join('')}</div>
    <div class="three">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(x.date)}"></label>
      <label>${esc(t('start'))}<input name="start" type="time" required step="300" value="${fmtTime(x.start)}"></label>
      <label>${esc(t('duration'))}<select name="minutes">${durOptions(x.minutes)}</select></label>
    </div>
    <label>${esc(t('servings'))}<input name="people" type="number" min="1" max="30" step="1" value="${esc(x.people)}"></label>
    <div class="field-label">${esc(t('recipesInMeal'))}</div>
    ${rows ? `<ul class="meal-recipes">${rows}</ul>` : `<p class="hint">${esc(ricetteConfigured() ? t('noRecipeYet') : t('ricetteNeeded'))}</p>`}
    ${ricetteConfigured() ? `<button class="btn add-recipe" value="pick" formnovalidate>＋ ${esc(t('addRecipe'))}</button>` : ''}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${!isNew && x.recipes.length && ricetteConfigured() ? `<button class="btn" value="check">🛒 ${esc(t('checkIngredients'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    const collect = () => {
      x.typeId = form.querySelector('input[name=type]:checked')?.value || x.typeId;
      x.date = form.date.value || x.date;
      x.start = parseTime(form.start.value) ?? x.start;
      x.minutes = Number(form.minutes.value) || x.minutes;
      x.people = Math.max(1, Number(form.people.value) || 2);
      x.notes = form.notes.value.trim();
      x.recipes = x.recipes.map((r) => ({ ...r, servings: x.people }));
    };
    collect();
    if (action === 'delete') { deleteBlock(block); changed(); return; }
    if (action === 'pick') {
      e.preventDefault();
      openPicker({
        people: x.people, selected: x.recipes.map((r) => r.recipeId),
        onDone: (ids) => {
          x.recipes = ids.map((id) => ({ recipeId: id, servings: x.people }));
          // A meal takes at least as long as its longest recipe.
          const longest = Math.max(0, ...ids.map((id) => minutesOf(recipeOf(id)) || 0));
          if (longest > x.minutes) x.minutes = Math.ceil(longest / 5) * 5;
          openMeal(block, x);
        },
        onBack: () => openMeal(block, x),
      });
      return;
    }
    if (action.startsWith('rm-rec:')) { e.preventDefault(); x.recipes.splice(Number(action.slice(7)), 1); openMeal(block, x); return; }
    const tp = get('tasks', x.typeId);
    const before = JSON.stringify(mealRecipes(block || {}));
    const { typeId, people, ...rest } = x;
    void typeId;
    const saved = upsert('blocks', {
      ...rest, id: x.id || uid(), kind: 'meal', taskId: tp.id, servings: people, recipes: x.recipes, recipeId: undefined,
      title: mealTitle(tp.title, x.recipes), category: 'meals', auto: block && (block.date !== x.date || block.start !== x.start) ? false : rest.auto,
      done: block?.done || false,
    }, { silent: true });
    // Different recipes: the ingredient check starts over.
    if (block && before !== JSON.stringify(x.recipes)) {
      for (const st of live('blocks').filter((b) => b.parentId === saved.id && isCheckStep(b) && outcomeOf(b))) setOutcome(st, null);
    }
    followParent(saved);
    if (saved.date !== currentDate()) location.hash = `#/plan/${saved.date}`;
    changed();
    warnConflicts(get('blocks', saved.id));
    if (action === 'check') checkMealNow(get('blocks', saved.id));
  });
  hydratePhotos(modal);
  // Picking a type moves a new meal to that type's usual time.
  modal.querySelector('form').addEventListener('change', (ev) => {
    if (ev.target.name !== 'type' || !isNew) return;
    const tp = get('tasks', ev.target.value);
    const f = ev.target.form;
    if (tp?.defaultStart != null) f.start.value = fmtTime(tp.defaultStart);
    if (tp?.minutes) f.minutes.innerHTML = durOptions(Math.max(tp.minutes, ...x.recipes.map((r) => minutesOf(recipeOf(r.recipeId)) || 0)));
  });
}

// The recipe picker: a full sheet with photos, search, folders, tags and quick filters.
// Tap cards to select one or more recipes; ⓘ shows the recipe with what's in the pantry.
function openPicker({ people = 2, selected = [], onDone, onBack }) {
  const st = { q: '', folder: '', tags: new Set(), canCook: false, quick: false, sel: [...selected], preview: null };
  const folders = live('r_folders');
  const all = recipes();
  const flist = folderList(all, folders);
  const tags = tagCounts(all);
  const unfiled = all.some((r) => !foldersOf(r, folders).length);
  const tree = [];
  const walk = (parent, depth) => { for (const f of flist.filter((y) => String(y.parent ?? '') === String(parent ?? ''))) { tree.push({ ...f, depth }); walk(f.id, depth + 1); } };
  walk(null, 0);
  for (const f of flist) if (!tree.some((y) => y.id === f.id)) tree.push({ ...f, depth: 0 });

  const list = () => filterRecipes(all, { q: st.q, folder: st.folder, tags: st.tags, canCook: st.canCook ? canCookNow : null, maxMinutes: st.quick ? 30 : null }, folders);
  const card = (r) => {
    const on = st.sel.includes(r.id);
    const miss = kitchen.missingFor(r, people, live('r_pantry')).length;
    const m = minutesOf(r);
    const fname = foldersOf(r, folders).map((id) => flist.find((f) => f.id === id)?.name || id)[0];
    return `<div class="pk-card${on ? ' on' : ''}">
      <button class="pk-pick" value="tog:${esc(r.id)}" formnovalidate aria-pressed="${on}">
        <span class="pk-photo">${coverOf(r) ? photoTag(coverOf(r)) : ''}<span class="pk-letter">${esc((r.title || '?').charAt(0))}</span>
          <span class="stock ${miss ? 'miss' : 'ok'}">${miss ? esc(t('nMissing', miss)) : `✓ ${esc(t('inPantryShort'))}`}</span>
          <span class="pk-tick">${on ? st.sel.indexOf(r.id) + 1 : ''}</span></span>
        <span class="pk-body"><b>${esc(r.title)}</b>
          <small>${[m ? `⏱ ${fmtDur(m)}` : '', fname ? `📁 ${fname}` : ''].filter(Boolean).map(esc).join(' · ')}</small>
          ${tagsOf(r).length ? `<span class="card-tags">${tagsOf(r).slice(0, 3).map((x) => `<span>#${esc(x)}</span>`).join('')}</span>` : ''}</span>
      </button>
      <button class="pk-info" value="info:${esc(r.id)}" formnovalidate aria-label="${esc(t('details'))}">i</button>
    </div>`;
  };
  const grid = () => {
    const l = list();
    return l.length ? l.map(card).join('') : `<p class="empty">${esc(t('noMatches'))}</p>`;
  };
  const pill = (value, label, on) => `<button class="pill${on ? ' on' : ''}" value="${esc(value)}" formnovalidate>${esc(label)}</button>`;

  const draw = () => {
    if (st.preview) return drawPreview(recipeOf(st.preview));
    const n = st.sel.length;
    openModal(`
      <div class="pk-head">
        <button class="icon" value="back" formnovalidate aria-label="${esc(t('back'))}">‹</button>
        <h2>${esc(t('chooseRecipes'))}</h2>
        <span class="pk-count">${esc(t('forPeople', people))}</span>
      </div>
      <input type="search" id="pk-q" value="${esc(st.q)}" placeholder="${esc(t('recSearch'))}" autocomplete="off">
      ${tree.length ? `<div class="pills">${pill('folder:', t('allFolders'), !st.folder)}${tree.map((f) => pill(`folder:${f.id}`, `${f.depth ? '· '.repeat(f.depth) : '📁 '}${f.name}`, st.folder === f.id)).join('')}${unfiled ? pill('folder:__none', t('noFolder'), st.folder === '__none') : ''}</div>` : ''}
      <div class="pills">${pill('cook', `✓ ${t('canCookNow')}`, st.canCook)}${pill('quick', `⏱ ${t('underMin', 30)}`, st.quick)}${tags.map(([tg]) => pill(`tag:${tg}`, `#${tg}`, st.tags.has(tg))).join('')}</div>
      <div class="pk-grid" id="pk-grid">${grid()}</div>
      <div class="pk-foot">
        <button class="btn primary" value="done" ${n ? '' : 'disabled'}>${esc(n ? t('addNRecipes', n) : t('pickSome'))}</button>
      </div>`, onSubmit, { cls: 'sheet' });
    hydratePhotos(modal);
    const q = modal.querySelector('#pk-q');
    q.addEventListener('input', () => { st.q = q.value; const g = modal.querySelector('#pk-grid'); g.innerHTML = grid(); hydratePhotos(g); });
  };

  const drawPreview = (r) => {
    const plan = kitchen.planForRecipe(r, people, live('r_pantry'));
    const m = minutesOf(r);
    const steps = (r.steps || []).map((x) => (typeof x === 'string' ? x : x.text || '')).filter(Boolean);
    const on = st.sel.includes(r.id);
    openModal(`
      <div class="pk-head">
        <button class="icon" value="list" formnovalidate aria-label="${esc(t('back'))}">‹</button>
        <h2>${esc(r.title)}</h2><span></span>
      </div>
      ${coverOf(r) ? `<div class="rec-hero">${photoTag(coverOf(r))}</div>` : ''}
      <p class="hint">${[m ? `⏱ ${fmtDur(m)}` : '', t('forPeople', people), ...foldersOf(r, folders).map((id) => `📁 ${flist.find((f) => f.id === id)?.name || id}`), ...tagsOf(r).map((x) => `#${x}`)].map(esc).join(' · ')}</p>
      <ul class="list ing">${plan.map((p) => `<li class="${p.covered ? 'have' : p.need == null && !p.tracked ? '' : 'need'}"><span class="q">${esc(qtyText(p.need, p.unit))}</span><span class="item-text">${esc(p.name)}${!p.covered && p.buy ? `<small>${esc(t('buyAmount', qtyText(p.buy, p.unit)))}</small>` : ''}</span><span class="mark">${p.covered ? '✓' : p.need == null && !p.tracked ? '' : '✕'}</span></li>`).join('')}</ul>
      ${steps.length ? `<details class="steps-box"><summary>${esc(t('stepsN', steps.length))}</summary><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
      <div class="pk-foot">
        <button class="btn ${on ? '' : 'primary'}" value="tog:${esc(r.id)}" formnovalidate>${esc(on ? t('unselect') : t('select'))}</button>
        ${r.url ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(t('source'))}</a>` : ''}
      </div>`, onSubmit, { cls: 'sheet' });
    hydratePhotos(modal);
  };

  function onSubmit(form, action, e) {
    e.preventDefault(); // stay in the dialog: the picker hands back to the meal
    if (action === 'done') { onDone(st.sel); return; }
    if (action === 'back') { onBack(); return; }
    if (action === 'list') { st.preview = null; draw(); return; }
    if (action.startsWith('tog:')) {
      const id = action.slice(4);
      st.sel = st.sel.includes(id) ? st.sel.filter((y) => y !== id) : [...st.sel, id];
      if (st.preview) st.preview = null;
    } else if (action.startsWith('info:')) st.preview = action.slice(5);
    else if (action.startsWith('folder:')) st.folder = action.slice(7);
    else if (action.startsWith('tag:')) { const tg = action.slice(4); if (st.tags.has(tg)) st.tags.delete(tg); else st.tags.add(tg); }
    else if (action === 'cook') st.canCook = !st.canCook;
    else if (action === 'quick') st.quick = !st.quick;
    const scroll = modal.querySelector('form')?.scrollTop;
    draw();
    if (scroll) modal.querySelector('form').scrollTop = scroll;
  }
  draw();
}

// ---------- view: tasks ----------

function viewTasks() {
  const td = today();
  const all = live('tasks');
  const g = groupTasks(all.filter(isTodo), td);
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
    <label>${esc(t('defaultView'))}<select name="defaultView">${VIEWS.map((v) => `<option value="${v}" ${v === (s.defaultView || 'day') ? 'selected' : ''}>${esc(t(`v_${v}`))}</option>`).join('')}</select></label>
    <div class="field-label">${esc(t('glanceTitle'))}</div>
    <div class="days glance">${GLANCE.map((k) => `<label class="day-pill"><input type="checkbox" name="glance" value="${k}" ${glance().has(k) ? 'checked' : ''}><span>${esc(t(`gl_${k}`))}</span></label>`).join('')}</div>
    <p class="hint">${esc(t('glanceHint'))}</p>
    <label>${esc(t('maxLoad'))}<select name="maxLoad">${opts([4, 5, 6, 7, 8, 9, 10, 11, 12, 14], s.maxLoad ?? 8, (h) => `${h} h`)}</select>
      <small>${esc(t('maxLoadHint'))}</small></label>
  </form>

  <h2>${esc(t('meals'))}</h2>
  <p class="hint">${esc(t('mealsHint'))}</p>
  <ul class="list">
    ${mealTypes().map((tp) => `<li><button class="task-main" type="button" data-action="task-edit" data-id="${esc(tp.id)}"><span class="item-text">🍽 ${esc(tp.title)}<small>${esc(fmtTime(tp.defaultStart ?? 0))} · ${esc(fmtDur(tp.minutes || 30))}${prepOf(tp).length ? ` · ↳ ${esc(prepOf(tp).map((p) => p.task.title).join(', '))}` : ''}</small></span></button></li>`).join('')}
  </ul>
  <button class="btn small" type="button" data-action="meal-type-new">+ ${esc(t('newMealType'))}</button>

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
  ${ghConnected() && !ui.editGithub ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.repo)}</b>
      <small>${esc(t('branch'))}: ${esc(s.branch || 'main')} · ${esc(t('lastSync'))}: ${state.meta.lastSync ? esc(new Date(state.meta.lastSync).toLocaleString(getLang())) : esc(t('never'))}</small></div></div>
    ${state.meta.lastError && state.meta.lastError !== 'network' ? `<p class="conn bad">${esc(t(`err_${state.meta.lastError}`))}</p>` : ''}
    <div class="button-row">
      <button class="btn small" type="button" data-action="sync-now">${esc(t('syncNow'))}</button>
      <button class="btn small ghost" type="button" data-action="gh-edit">${esc(t('changeConn'))}</button>
    </div>
  </div>` : `
  <p class="hint">${esc(t('syncHint'))}</p>
  <form class="form" id="gh-form">
    <div class="two">
      <label>${esc(t('owner'))}<input name="owner" value="${esc(s.owner)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>${esc(t('repo'))}<input name="repo" value="${esc(s.repo || 'everyday-data')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </div>
    <label>${esc(t('token'))}<input name="token" type="password" value="" placeholder="${esc(s.token ? t('tokenSaved') : '')}" autocomplete="off" spellcheck="false"><small>${esc(t(s.token ? 'tokenKeepHint' : 'tokenHint'))}</small></label>
    <label>${esc(t('branch'))}<input name="branch" value="${esc(s.branch || 'main')}" autocomplete="off" autocapitalize="off"></label>
    ${msg ? `<p class="conn ${msg === 'connected' ? 'good' : 'bad'}">${esc(t(msg))}</p>` : ''}
    <div class="button-row">
      <button class="btn primary">${esc(t('saveTest'))}</button>
      ${ui.editGithub ? `<button class="btn" type="button" data-action="gh-cancel">${esc(t('cancel'))}</button>` : ''}
    </div>
  </form>`}

  <h2>${esc(t('ricette'))}</h2>
  ${ricetteConfigured() ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.ricetteRepo)}</b>
      <small>${esc(t('ricetteStatus', live('r_recipes').length, live('r_pantry').length, live('r_shopping').filter((x) => !x.checked).length))}</small></div></div>
    ${ui.ricMsg && ui.ricMsg !== 'connected' ? `<p class="conn bad">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn small ghost" type="button" data-action="ric-off">${esc(t('disconnect'))}</button></div>
  </div>` : `
  <p class="hint">${esc(t('ricetteHint'))}</p>
  <form class="form" id="ric-form">
    <label>${esc(t('ricetteRepo'))}<input name="ricetteRepo" value="${esc(s.ricetteRepo || 'ricette-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${ui.ricMsg ? `<p class="conn ${ui.ricMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn primary" ${isConfigured() ? '' : 'disabled'}>${esc(t('connect'))}</button></div>
  </form>`}

  <h2>${esc(t('gcal'))}</h2>
  ${gcalSection()}

  <div class="button-row subtle">
    <button class="btn small" type="button" data-action="export">${esc(t('export'))}</button>
  </div>`;
}

function gcalSection() {
  const st = get('gcal', 'status');
  if (!st) {
    return `<p class="hint">${esc(t('gcalIntro'))}</p>
      <ol class="steps">${[1, 2, 3, 4].map((i) => `<li>${esc(t(`gcalStep${i}`))}</li>`).join('')}</ol>
      <p class="hint">${esc(t('gcalGuide'))}</p>
      ${ghConnected() ? `<div class="button-row"><button class="btn small" type="button" data-action="sync-now">${esc(t('gcalCheck'))}</button></div>` : ''}`;
  }
  return `<div class="conn-card">
    <div class="conn-main"><span class="ok-dot ${st.error ? 'bad' : ''}"></span><div><b>${esc(t('gcalLast', new Date(st.lastRun).toLocaleString(getLang())))}</b>
      <small>${st.error ? '' : esc(t('gcalStats', st.events || 0, (st.imported || []).join(', ') || '—', st.blocks || 0, st.calendar || 'Everyday'))}</small></div></div>
    ${st.error ? `<p class="conn bad">${esc(st.error)}</p>` : ''}
    ${ui.gcalMsg ? `<p class="hint">${esc(t(ui.gcalMsg))}</p>` : ''}
    <label class="check"><input type="checkbox" id="show-events" ${state.settings.showEvents === false ? '' : 'checked'}> ${esc(t('showEvents'))}</label>
    <div class="button-row"><button class="btn small" type="button" data-action="gcal-now">${esc(t('gcalNow'))}</button></div>
  </div>`;
}

// Start the Google Calendar workflow now, then pick up its results a little later.
async function gcalNow(quiet = false) {
  const res = await runWorkflow('google-calendar.yml');
  ui.lastDispatch = Date.now();
  if (!quiet) { ui.gcalMsg = res === 'ok' ? 'gcalStarted' : res === 'forbidden' ? 'gcalNeedsActions' : 'err_network'; render(); }
  if (res === 'ok') for (const wait of [45_000, 90_000]) setTimeout(runSync, wait);
}

// Connected = saved and tested (or, for setups from before this check existed, synced at least once).
function ghConnected() { return isConfigured() && (state.meta.ghOk ?? Boolean(state.meta.lastSync)); }

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
  // Nothing changed (e.g. a sync that found no news): leave the page alone. Replacing it
  // anyway is what made the screen flicker and fields lose what you were typing.
  if (html === ui.lastHtml && view.childElementCount) { positionNow(); return; }
  ui.lastHtml = html;
  view.innerHTML = html;
  hydratePhotos(view);
  positionNow();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typed != null && el.tagName === 'INPUT') {
        el.value = typed;
        try { el.setSelectionRange(typed.length, typed.length); } catch { /* not a text field */ }
      }
    }
  }
  if ((r.name === 'plan' || !TAB_OF[r.name]) && ui.scrolledFor !== currentDate()) {
    ui.scrolledFor = currentDate();
    scrollTimeline();
  }
}

// The red "now" line moves on its own every minute, without redrawing the day.
function positionNow() {
  const line = $('#now-line');
  const tl = line?.closest('.timeline');
  if (!line || !tl) return;
  const start = Number(tl.dataset.start);
  const end = start + tl.offsetHeight / PPM;
  const now = nowMinutes();
  line.hidden = now < start || now > end;
  line.style.top = `${(now - start) * PPM}px`;
}

// On opening a day: scroll to "now" (today) or the first block (other days).
function scrollTimeline() {
  const nowLine = $('#now-line');
  const target = (nowLine && !nowLine.hidden && nowLine) || $('.timeline .block');
  if (!target) return;
  const y = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
  window.scrollTo(0, Math.max(0, y));
}

// Background updates (sync, the clock) re-render only when it can't get in the way:
// not on settings, not under an open dialog, and not while a finger or mouse is pressed.
function renderIfSafe() {
  const r = route();
  if (r.name === 'settings' || modal.open || ui.dragging) return;
  if (ui.pressing || typing()) { ui.renderLater = true; return; }
  // Several changes in a row (one per synced file) make a single redraw.
  if (ui.renderQueued) return;
  ui.renderQueued = true;
  requestAnimationFrame(() => { ui.renderQueued = false; if (!ui.pressing && !typing() && !modal.open && !ui.dragging) render(); else ui.renderLater = true; });
}

// A text field on the page has the cursor: background updates wait until you leave it.
function typing() {
  const a = document.activeElement;
  if (!a || !view.contains(a)) return false;
  return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'
    || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(a.type));
}
view.addEventListener('focusout', () => setTimeout(() => {
  if (ui.renderLater && !typing()) { ui.renderLater = false; renderIfSafe(); }
}, 0));
document.addEventListener('pointerdown', () => { ui.pressing = true; }, true);
const released = () => {
  ui.pressing = false;
  if (ui.renderLater) { ui.renderLater = false; setTimeout(renderIfSafe, 0); } // after the click is handled
};
document.addEventListener('pointerup', released, true);
document.addEventListener('pointercancel', released, true);

// ---------- dialogs ----------

function openModal(html, onSubmit, { cls = '' } = {}) {
  modal.className = cls;
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

// Task editor. Used for to-dos, for preparation steps (small tasks of their own, planned
// automatically before the task they belong to) and for meal types (Settings → Meals).
// Any of them can have rules: "when this is done / couldn't be done / was missed → …".
function openTask(task, draft = null) {
  const isNew = !task;
  const base = task || { title: '', minutes: 30, priority: 0, category: '', due: '', repeat: '', notes: '', when: '' };
  const x = draft || { ...base, prep: [...(base.prep || [])], checklist: [...(base.checklist || [])], rules: (base.rules || []).map((r) => ({ ...r })) };
  const helper = Boolean(x.helper);
  const routine = Boolean(x.routine);
  const todo = !helper && !routine;
  const prepRows = (x.prep || []).map((p, i) => {
    const pt = p.newTask || get('tasks', p.taskId);
    if (!pt) return '';
    return `<li><span class="item-text pad">↳ ${esc(pt.title)}<small>${esc(fmtDur(pt.minutes || 10))} · ${esc(t(`pw_${p.when}`))}${pt.checklist?.length ? ` · ☑ ${pt.checklist.length}` : ''}${pt.rules?.length ? ` · ⚙ ${pt.rules.length}` : ''}</small></span>
      <button class="btn small ghost" value="edit-prep:${i}">${esc(t('edit'))}</button>
      <button class="btn small ghost" value="rm-prep:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></li>`;
  }).join('');
  const ruleRows = (x.rules || []).map((r, i) => `
    <div class="rule ${r.then === 'groceries' ? 'is-groceries' : ''}">
      <div class="rule-line"><span>${esc(t('ruleWhen'))}</span>
        <select name="rw_${i}">${RULE_WHEN.map((w) => `<option value="${w}" ${w === r.when ? 'selected' : ''}>${esc(t(`rw_${w}`))}</option>`).join('')}</select>
        <button class="icon" value="rm-rule:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>
      <div class="rule-line"><span>→</span>
        <select name="rt_${i}" data-rule="${i}"><option value="task" ${r.then !== 'groceries' ? 'selected' : ''}>${esc(t('rt_task'))}</option><option value="groceries" ${r.then === 'groceries' ? 'selected' : ''}>${esc(t('rt_groceries'))}</option></select></div>
      <div class="rule-line rt-task">
        <input name="rti_${i}" value="${esc(r.title || '')}" placeholder="${esc(t('rulePh'))}" autocomplete="off">
        <select name="rm_${i}">${durOptions(Number(r.minutes) || 30, [5, 10, 15, 20, 30, 45, 60, 90, 120])}</select>
        <select name="rp_${i}">${RULE_PLACES.map((p) => `<option value="${p}" ${p === (r.place || 'next') ? 'selected' : ''}>${esc(t(`rp_${p}`))}</option>`).join('')}</select>
      </div>
    </div>`).join('');
  openModal(`
    <h2>${esc(routine ? (isNew ? t('newMealType') : t('mealType')) : helper ? t('editPrep') : isNew ? t('newTask') : t('editTask'))}</h2>
    ${x.check === 'ingredients' ? `<p class="hint">${esc(t('checkStepHint'))}</p>` : ''}
    <label>${esc(t('title'))}<input name="title" required value="${esc(x.title)}" autocomplete="off"></label>
    <div class="two">
      <label>${esc(t('duration'))}<select name="minutes">${durOptions(x.minutes || 30)}</select></label>
      ${todo ? `<label>${esc(t('priority'))}<select name="priority">${[0, 1, 2, 3].map((p) => `<option value="${p}" ${p === (x.priority || 0) ? 'selected' : ''}>${esc(t(`prio_${p}`))}</option>`).join('')}</select></label>` : ''}
      ${routine ? `<label>${esc(t('usualTime'))}<input name="defaultStart" type="time" step="300" value="${fmtTime(x.defaultStart ?? 720)}"></label>` : ''}
    </div>
    ${todo ? `
    <div class="two">
      <label>${esc(t('due'))}<input name="due" type="date" value="${esc(x.due || '')}"></label>
      <label>${esc(t('repeat'))}<select name="repeat"><option value="">${esc(t('rep_none'))}</option>${REPEATS.map((r) => `<option value="${r}" ${r === x.repeat ? 'selected' : ''}>${esc(t(`rep_${r}`))}</option>`).join('')}</select></label>
    </div>
    <div class="two">
      <label>${esc(t('bestTime'))}<select name="when">${['', 'morning', 'afternoon', 'evening'].map((w) => `<option value="${w}" ${w === (x.when || '') ? 'selected' : ''}>${esc(t(`when_${w || 'any'}`))}</option>`).join('')}</select></label>
      <label>${esc(t('category'))}<select name="category">${catOptions(x.category)}</select></label>
    </div>` : routine ? `<label>${esc(t('category'))}<select name="category">${catOptions(x.category)}</select></label>` : ''}
    ${x.check ? '' : `<label>${esc(t('checklist'))}<textarea name="checklist" rows="3" placeholder="${esc(t('checklistPh'))}">${esc((x.checklist || []).join('\n'))}</textarea>
      <small>${esc(t('checklistHint'))}</small></label>`}
    ${helper ? '' : `
    <div class="field-label">${esc(t('prepTitle'))}</div>
    <p class="hint">${esc(t('prepHint'))}</p>
    ${prepRows ? `<ul class="list">${prepRows}</ul>` : ''}
    <div class="prep-add">
      <input name="prepTitle" placeholder="${esc(t('prepPh'))}" autocomplete="off">
      <select name="prepMinutes">${durOptions(10, [5, 10, 15, 20, 30, 45, 60])}</select>
      <select name="prepWhen">${['before', 'sameday', 'daybefore'].map((w) => `<option value="${w}">${esc(t(`pw_${w}`))}</option>`).join('')}</select>
      <button class="btn small" value="add-prep" formnovalidate>+ ${esc(t('add'))}</button>
    </div>`}
    <div class="field-label">⚙ ${esc(t('rules'))}</div>
    <p class="hint">${esc(t('rulesHint'))}</p>
    ${ruleRows}
    <button class="btn small" value="add-rule" formnovalidate>+ ${esc(t('addRule'))}</button>
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${todo ? `<button class="btn" value="plan">${esc(t('planIt'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew || x.id === 'meal_check' ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    const collect = () => {
      x.title = form.title.value.trim();
      x.minutes = Number(form.minutes.value) || 30;
      if (form.checklist) x.checklist = lines(form.checklist.value);
      x.notes = form.notes.value.trim();
      if (todo) {
        x.priority = Number(form.priority.value) || 0;
        x.due = form.due.value || null;
        x.repeat = form.repeat.value || null;
        x.when = form.when.value || '';
      }
      if (form.category) x.category = form.category.value || null;
      if (routine) x.defaultStart = parseTime(form.defaultStart.value) ?? x.defaultStart;
      x.rules = (x.rules || []).map((r, i) => {
        const then = form[`rt_${i}`].value;
        return then === 'groceries'
          ? { id: r.id, when: form[`rw_${i}`].value, then }
          : { id: r.id, when: form[`rw_${i}`].value, then, title: form[`rti_${i}`].value.trim(), minutes: Number(form[`rm_${i}`].value) || 30, place: form[`rp_${i}`].value };
      });
    };
    collect();
    if (action === 'add-rule') {
      e.preventDefault();
      x.rules = [...x.rules, { id: uid().slice(0, 6), when: helper ? 'failed' : 'done', then: 'task', title: '', minutes: 30, place: helper ? 'before' : 'next' }];
      openTask(task, x);
      return;
    }
    if (action.startsWith('rm-rule:')) { e.preventDefault(); x.rules.splice(Number(action.slice(8)), 1); openTask(task, x); return; }
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
    // A rule that adds a task needs a name: drop the ones left empty.
    x.rules = x.rules.filter((r) => r.then === 'groceries' || r.title);
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
  // Switching a rule between "add a task" and "plan a grocery trip" shows the right fields.
  modal.querySelector('form').addEventListener('change', (ev) => {
    if (ev.target.dataset.rule == null) return;
    ev.target.closest('.rule').classList.toggle('is-groceries', ev.target.value === 'groceries');
  });
}

function saveTask(x) {
  const prep = (x.prep || []).map((p) => {
    if (!p.newTask) return { taskId: p.taskId, when: p.when };
    const h = upsert('tasks', {
      id: uid(), createdAt: Date.now(), helper: true, title: p.newTask.title, minutes: p.newTask.minutes,
      category: x.category || null, checklist: [], rules: [], notes: '', done: false,
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
        <button class="btn" value="fail" formnovalidate>${esc(t('couldntDo'))}</button>
        <button class="btn" value="cancel">${esc(t('close'))}</button>
      </div>`, (form, action, e) => {
      if (action === 'all') { e.preventDefault(); upsert('blocks', { ...get('blocks', block.id), checked: items.map(() => true) }, { silent: true }); draw(); return; }
      if (action === 'fail') { setOutcome(get('blocks', block.id), 'failed'); changed(); return; }
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
  if ((block || defaults).kind === 'meal') { openMeal(block); return; }
  const isNew = !block;
  const b = block || { title: '', date: currentDate(), start: 9 * 60, minutes: 30, category: '', notes: '', done: false, ...defaults };
  const task = b.taskId && get('tasks', b.taskId);
  const parent = b.parentId && get('blocks', b.parentId);
  const items = checklistOf(b);
  const isShop = b.kind === 'groceries';
  const taskChoices = sortTasks(live('tasks').filter((x) => (!x.done && !x.routine) || x.id === b.taskId), today()).slice(0, 80);
  const status = outcomeOf(b);
  openModal(`
    <h2>${esc(isShop ? `🛒 ${t('groceryTitle')}` : isNew ? t('newBlock') : t('editBlock'))}</h2>
    ${parent ? `<p class="hint">↳ ${esc(t('prepForBlock', parent.title, fmtTime(parent.start)))}</p>` : ''}
    ${status === 'failed' ? `<p class="conn bad">✕ ${esc(t('markedCouldnt'))}${b.missing?.length ? ` ${esc(t('missingWere', b.missing.join(', ')))}` : ''}</p>` : ''}
    ${isCheckStep(b) && !status ? `<p class="hint">${esc(t('checkStepHint'))}</p>` : ''}
    ${isShop ? '' : `
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
    ${isShop ? '' : `<label>${esc(t('category'))}<select name="category">${catOptions(b.category)}</select></label>`}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="allowOverlap" ${b.allowOverlap ? 'checked' : ''}> ${esc(t('allowOverlap'))}</label>
    ${task && !task.helper ? `<p class="hint">${esc(t('linkedTask'))}: <a href="#/tasks" data-action="open-task" data-id="${esc(task.id)}">${esc(task.title)}</a></p>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${isNew ? '' : status ? `<button class="btn" value="reset" formnovalidate>${esc(t('reset'))}</button>` : `<button class="btn" value="fail" formnovalidate>${esc(t('couldntDo'))}</button>`}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn" value="dup" formnovalidate>${esc(t('duplicate'))}</button>
      <button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    if (action === 'delete') { deleteBlock(b); changed(); return; }
    if (action === 'fail') { setOutcome(get('blocks', b.id), 'failed'); changed(); return; }
    if (action === 'reset') { setOutcome(get('blocks', b.id), null); changed(); return; }
    if (action === 'dup') {
      newBlock({ ...b, id: uid(), start: Math.min(b.start + b.minutes, 1440 - b.minutes), done: false, outcome: null, templateId: null, checked: [], groceryId: null, sourceId: null });
      changed();
      return;
    }
    const picked = form.taskId?.value ? get('tasks', form.taskId.value) : null;
    const titleInput = form.elements.namedItem('title'); // (form.title is the form's own title attribute)
    let title = titleInput ? titleInput.value.trim() : '';
    let category = form.category?.value || null;
    const rec = { ...b, id: b.id || uid(), date: form.date.value || b.date, start: parseTime(form.start.value) ?? b.start,
      minutes: Number(form.minutes.value) || 30, notes: form.notes.value.trim(), allowOverlap: form.allowOverlap.checked };
    if (!isShop) {
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
      const blocks = blocksOn(date).filter((b) => !b.kind || b.kind === 'meal').map((b) => ({
        start: b.start, minutes: b.minutes, title: b.title, category: b.category || null, ...(b.taskId ? { taskId: b.taskId } : {}),
        ...(b.kind === 'meal' ? { kind: 'meal', servings: b.servings, recipes: mealRecipes(b) } : {}),
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
      if (was?.kind === 'meal') Object.assign(out, { kind: 'meal', servings: was.servings, recipes: mealRecipes(was) });
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
  const res = suggestDay({ tasks, blocks: busyOn(date).filter((b) => !b.allowOverlap), date, from, settings: s, leadOf });
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
  const next = busyOn(date).filter((b) => !b.done && b.start > now).sort((a, b) => a.start - b.start)[0];
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
  if (el.dataset.ci != null && el.dataset.block) { // checklist inside an open row of the list view
    const cur = get('blocks', el.dataset.block);
    const next = [...(cur.checked || [])];
    next[Number(el.dataset.ci)] = el.checked;
    upsert('blocks', { ...cur, checked: next }, { silent: true });
    changed();
  }
  if (action === 'sug-toggle') {
    if (el.checked) ui.suggest.off.delete(id); else ui.suggest.off.add(id);
    render();
  }
  if (el.id === 'show-events') { saveSettings({ showEvents: el.checked }); }
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
    const glanceSel = new FormData(el.form).getAll('glance');
    saveSettings({ dayStart, dayEnd: Math.max(dayEnd, dayStart + 1), snap: Number(f.snap), buffer: Number(f.buffer), maxLoad: Number(f.maxLoad), defaultView: f.defaultView, glance: glanceSel });
    if (el.name === 'defaultView') ui.view = null;
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
    if (block?.classList.contains('event')) { openEvent(get('events', block.dataset.id)); return; }
    if (block && !e.target.closest('.blk-check')) openBlock(get('blocks', block.dataset.id));
    return;
  }
  const { action, id } = btn.dataset;
  switch (action) {
    case 'plan-task': {
      const date = btn.dataset.date || currentDate();
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
      const start = freeSlot(busyOn(date), 30, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? from;
      openBlock(null, { date, start });
      break;
    }
    case 'new-meal': ui.mealDate = currentDate(); openMeal(null); break;
    case 'view': ui.view = id; ui.scrolledFor = null; ui.suggest = null; render(); if (id !== 'day') window.scrollTo(0, 0); break;
    case 'view-day': ui.view = 'day'; ui.scrolledFor = null; if (currentDate() === id) render(); else location.hash = `#/plan/${id}`; break;
    case 'ag-toggle': if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id); render(); break;
    case 'block-edit': openBlock(get('blocks', id)); break;
    case 'block-fail': setOutcome(get('blocks', id), 'failed'); changed(); break;
    case 'block-reset': setOutcome(get('blocks', id), null); changed(); break;
    case 'meal-type-new': openTask(null, { title: '', minutes: 30, routine: true, meal: true, defaultStart: 12 * 60, category: 'meals', prep: [], rules: [], checklist: [], notes: '' }); break;
    case 'event': openEvent(get('events', id)); break;
    case 'templates': openTemplatesMenu(); break;
    case 'suggest': startSuggest(); break;
    case 'sug-accept': acceptSuggest(); break;
    case 'sug-cancel': ui.suggest = null; render(); break;
    case 'spare': openSpare(); break;
    case 'toggle-conflicts': ui.showConflicts = !ui.showConflicts; render(); break;
    case 'fix': fixConflict(conflictsOn(btn.dataset.date || currentDate())[Number(btn.dataset.i)]); break;
    case 'allow': {
      const c = conflictsOn(btn.dataset.date || currentDate())[Number(btn.dataset.i)];
      const b = get('blocks', c.ids[1]) || get('blocks', c.ids[0]); // calendar events can't be changed here
      upsert('blocks', { ...b, allowOverlap: true }, { silent: true });
      changed();
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
    case 'gh-edit': ui.editGithub = true; ui.connMsg = ''; render(); break;
    case 'gh-cancel': ui.editGithub = false; render(); break;
    case 'gcal-now': gcalNow(); break;
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
  move: (id, start, date) => {
    const b = get('blocks', id);
    if (b) { const m = upsert('blocks', { ...b, start, date: date || b.date, auto: false }, { silent: true }); followParent(m); }
    changed();
    warnConflicts(get('blocks', id));
  },
  resize: (id, minutes) => {
    const b = get('blocks', id);
    if (b) upsert('blocks', { ...b, minutes }, { silent: true });
    changed();
    warnConflicts(get('blocks', id));
  },
  dropTask: (id, start, date) => {
    const task = get('tasks', id);
    let b = null;
    const d = date || currentDate();
    if (task) { b = planTask(task, d, start); toast(t('plannedToast', relDay(d), fmtTime(start))); }
    changed();
    if (b) warnConflicts(get('blocks', b.id));
  },
  redraw: () => render(),
});

async function saveGithub(form) {
  await saveSettings({
    owner: form.owner.value.trim(), repo: form.repo.value.trim(),
    token: form.token.value.trim() || state.settings.token, branch: form.branch.value.trim() || 'main',
  });
  const res = await testConnection();
  ui.connMsg = res.ok ? 'connected' : `err_${res.error}`;
  await saveMeta({ ghOk: Boolean(res.ok) });
  if (res.ok) { ui.editGithub = false; toast(t('connected')); }
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

// Home-screen shortcuts (long-press the app icon): ?go=today | add | time | meal
function handleShortcut() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return;
  history.replaceState(null, '', location.pathname + (go === 'add' ? '#/tasks' : '#/plan'));
  if (go === 'today') { ui.view = 'day'; ui.scrolledFor = null; }
  render();
  if (go === 'add') setTimeout(() => $('#task-input')?.focus(), 50);
  if (go === 'time') setTimeout(openSpare, 50);
  if (go === 'meal') setTimeout(() => { ui.mealDate = today(); openMeal(null); }, 50);
}

// ---------- start ----------

async function start() {
  await load();
  applyLang(state.settings.lang);
  seedCategories();
  seedMeals();
  renderShell();
  render();
  const kinds = new Set([...COLLECTIONS, ...Object.keys(RICETTE)]);
  onChange((kind) => {
    updateSyncBadge();
    if (kind !== 'meta' && kinds.has(kind)) renderIfSafe(); // sync bookkeeping alone never redraws the page
  });
  let lastTab = TAB_OF[route().name] || 'plan';
  window.addEventListener('hashchange', () => {
    if (ui.suggest && ui.suggest.date !== currentDate()) ui.suggest = null;
    const tab = TAB_OF[route().name] || 'plan';
    if (tab === 'plan' && lastTab !== 'plan') ui.scrolledFor = null; // back on the planner: jump to now again
    lastTab = tab;
    render();
    if (tab !== 'plan') window.scrollTo(0, 0);
  });
  window.addEventListener('online', runSync);
  window.addEventListener('offline', () => updateSyncBadge());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { runSync(); renderIfSafe(); } });
  $('#sync').addEventListener('click', runSync);
  handleShortcut();
  runSync();
  // Every minute: move the "now" line, and pick up changes from other devices.
  let day = today();
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    positionNow();
    if (today() !== day) { day = today(); renderIfSafe(); } // past midnight: "today" moved on
    // Steps whose time has come (ingredient checks) and blocks that were missed.
    const n = state.blocks.length; const stamp = JSON.stringify(state.blocks.map((b) => b.outcome || b.missedAt || ''));
    autoChecks(today()); checkMissed(today());
    if (state.blocks.length !== n || stamp !== JSON.stringify(state.blocks.slice(0, n).map((b) => b.outcome || b.missedAt || ''))) changed();
    runSync();
  }, 60_000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
