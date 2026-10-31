import {
  state, load, live, get, has, upsert, remove, uid, onChange, saveSettings, saveMeta, COLLECTIONS, RICETTE, replaceCollection, kvGet, kvSet,
} from './store.js';
import { syncNow, isConfigured, isSyncing, testConnection, watchMonth, ricetteConfigured, runWorkflow, fetchRicettePhoto, removeCalendarData } from './sync.js';
import {
  today, addDays, parseDate, isDate, nowMinutes, weekday, dateStr, fmtTime, fmtDur, parseTime, quickAdd,
  REPEATS, occurrences, nextOccurrence, completeTask, reopenTask, groupTasks, sortTasks, layoutBlocks, freeSlot, dayTotals,
  parseTemplateLines, IMPORTANCE, importanceOf, formatTemplateLines, templateBlocks, autoTemplatesFor,
} from './plan.js';
import {
  candidates, spareTime, spreadTasks, scoreTask, WINDOWS, windowOn, nearestSlot, placePrep, placeGroceries, findConflicts, recipeMinutes,
} from './smart.js';
import { makeKitchen } from './kitchen.js';
import { DEPTS, DEPT_IDS, NONFOOD, deptIcon, deptOf } from './depts.js';
import { reorderSubset, byOrder, isDragging } from './sortable.js';
import { MODES as TRAVEL_MODES, MODE_ICON, UNKNOWN_MINUTES, travelMinutes, cachedMinutes, placeNotFound } from './travel.js';
import { availableModes, currentMode, saveModeTarget, GROUPED_MODES, DRAG_MODES, fold, matchesQ, itemMatches as itemMatchesQ, addedOf, byItemOrder, recipeGroupOf, groupItems } from './shoplist.js';
import { tagsOf, tagLabel, folderOfRecipe, folderTree, filterRecipes, tagCounts, minutesOf, timeParts, prepMinutes } from './recipes.js';
import { pantryCoverage } from './recipe-tools.js';
import { formatQty, setDecimalSeparator, namesMatch, addQuantities, parseIngredient } from './parse.js';
import { t, setLang, getLang, LANGS, detectLang } from './i18n.js';
import { setupDrag } from './drag.js';
import { setupTrayDrag } from './tray.js';
import { assignItems, planTrips, openOn, shopsFor } from './shops.js';

// Shown under Settings; keep in step with VERSION in sw.js (a unit test checks).
export const APP_VERSION = 'v31';

const $ = (sel, root = document) => root.querySelector(sel);
// Hints that were emptied in i18n (the guide explains instead) render nothing.
const hint = (key, ...a) => { const v = t(key, ...a); return v ? `<p class="hint">${esc(v)}</p>` : ''; };
const small = (key, ...a) => { const v = t(key, ...a); return v ? `<small>${esc(v)}</small>` : ''; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const view = $('#view');
const modal = $('#modal');
const ui = { view: null, expanded: new Set(), connMsg: '', ricMsg: '', dragging: false, scrolledFor: null, showDone: false, showHelpers: false, showConflicts: false };

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
// The same rules on Everyday's own list, for when Ricette isn't connected (no pantry then).
const kitchenOwn = makeKitchen({
  live, get, uid,
  upsert: (c, r) => upsert(c, r, { silent: true }),
  remove: (c, id) => remove(c, id),
}, { recipes: 'r_recipes', pantry: 'r_pantry', shopping: 'shopping' });

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, id] = h.split('/');
  return { name, id: id && decodeURIComponent(id) };
}

// Left to right, the way a week gets planned: today → events → tasks around them → the plan.
// Shopping is a part of the Tasks tab (#/shop still opens it directly); Settings opens from the gear.
const TAB_OF = { today: 'today', events: 'events', plan: 'plan', tasks: 'tasks', shop: 'tasks', settings: 'settings' };
const TABS = ['today', 'events', 'tasks', 'plan'];
// Rules, templates and preparations are power features: shown only when switched on under
// Settings → Advanced, or when the data already uses them.
function advancedOn() {
  const v = state.settings.advancedFeatures;
  if (v != null) return Boolean(v);
  return live('templates').length > 0 || live('tasks').some((x) => (x.helper && !x.check) || (x.rules || []).some((r) => r.then !== 'groceries'));
}

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
// A task from what quick add parsed ("Dentist 1h !2 #health @Via Roma 12 fri").
function quickFields(q) {
  return {
    title: q.title, minutes: q.minutes || 30, lenSet: Boolean(q.minutes), priority: q.priority, importance: q.importance || 3,
    category: findCategory(q.category), due: q.due || null, repeat: q.repeat || null, repeatDays: q.repeatDays || undefined, seriesFrom: q.repeat ? q.due : undefined,
    place: q.place || '', notes: '', done: false,
  };
}
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

// Categories as chips showing their colour (a plain list can't show colours on a phone).
function catChips(selected, name = 'category') {
  const chip = (id, label, color) => `<label class="cat-chip" style="--c:${esc(color || 'var(--line)')}"><input type="radio" name="${name}" value="${esc(id)}" ${(selected || '') === id ? 'checked' : ''}><span>${color ? '<i class="cat-dot"></i>' : ''}${esc(label)}</span></label>`;
  return `<div class="cat-chips" role="radiogroup" aria-label="${esc(t('category'))}">${chip('', t('noCategory'), '')}${categories().map((c) => chip(c.id, catName(c), c.color)).join('')}</div>`;
}
function catOptions(selected) {
  return `<option value="">${esc(t('noCategory'))}</option>${categories().map((c) => `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}`;
}

// ---------- tasks, preparations, checklists ----------

function blocksOn(date) { return live('blocks').filter((b) => b.date === date); }
// Google Calendar events that day (read-only; see data-repo/scripts/gcal-sync.mjs), plus your own
// all-day events (events with a time are blocks of their event task, see ---------- events).
function eventsOn(date) { return [...(state.settings.showEvents === false ? [] : live('events').filter((e) => e.date === date)), ...ownAllDayOn(date)]; }
function timedEventsOn(date) { return eventsOn(date).filter((e) => !e.allDay).map((e) => ({ ...e, isEvent: true, fixed: true })); }
// Everything that takes up time: your blocks plus busy calendar events.
function busyOn(date) { return [...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)]; }
const itemById = (id) => get('blocks', id) || get('events', id);
function scheduledOn(taskId, date) { return blocksOn(date).some((b) => b.taskId === taskId); }
// To-dos are tasks that aren't preparation steps, meal types (set up in Settings) or events.
const isTodo = (x) => !x.helper && !x.routine && !x.event;
function openTasks() { return live('tasks').filter((x) => !x.done && isTodo(x)); }
// To-dos and events: everything that gets travel legs.
function travelTasks() { return live('tasks').filter((x) => !x.done && (isTodo(x) || x.event)); }

// ---------- events ----------
// An event is a task with `event: true` and a fixed date: it is never moved by the planner or the
// morning re-flow. With a time it has exactly one block (or a series of them when it repeats); without
// one it is all-day (`allDay`, no block). `due` is its date. Tasks to do around it carry `eventId` and
// `eventOffset` {days, when: 'before' | 'after'}; their due date follows the event (syncEventTasks).
const isEventTask = (x) => Boolean(x?.event);
function ownEvents() { return live('tasks').filter((x) => x.event); }
function ownAllDayOn(date) {
  return ownEvents().filter((x) => x.allDay && x.due === date)
    .map((x) => ({ id: x.id, title: x.title, date, allDay: true, color: catColor(x.category) || 'var(--accent)', own: true, calendar: t('tabEvents'), location: x.place || '' }));
}
// An event by id: one of yours (a task) or an imported one.
const eventOf = (id) => { const x = get('tasks', id); return x?.event ? x : get('events', id); };
// The event's date: for your own, the day of its next block (it may have been dragged), else `due`.
function eventDate(ev) {
  if (!ev) return null;
  if (!ev.event) return ev.date || null; // imported
  const b = ev.allDay ? null : nextBlockOf(ev.id);
  return b?.date || ev.due || null;
}
function eventStart(ev) {
  if (!ev || ev.allDay) return null;
  if (!ev.event) return ev.start ?? null;
  const b = nextBlockOf(ev.id);
  return b ? b.start + anchorOffset(b) : (ev.eventTime ?? null);
}
// The tasks attached to an event (open first), and how ready it is.
function eventTasksOf(id) { return live('tasks').filter((x) => x.eventId === id && !x.helper).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '').localeCompare(b.due || '')); }
function eventReadiness(id) {
  const list = eventTasksOf(id);
  const open = list.filter((x) => !x.done);
  const planned = plannedTaskIds();
  return { total: list.length, open: open.length, unplanned: open.filter((x) => !planned.has(x.id)).length, late: open.filter((x) => x.due && x.due < today()).length };
}
function readinessText(id) {
  const r = eventReadiness(id);
  if (!r.total) return '';
  if (!r.open) return `✓ ${t('allReady')}`;
  return [t('nToDo', r.open), r.unplanned ? t('nToPlan', r.unplanned) : '', r.late ? t('nLate', r.late) : ''].filter(Boolean).join(' · ');
}
const offsetDue = (date, off) => addDays(date, (off?.when === 'after' ? 1 : -1) * Math.max(0, Number(off?.days) || 0));
function offsetText(off) {
  const d = Math.max(0, Number(off?.days) || 0);
  if (!d) return t('sameDayAsEvent');
  const n = d % 7 === 0 ? d / 7 : d;
  const unit = d % 7 === 0 ? t(n === 1 ? 'week1' : 'weeksN', n) : t(n === 1 ? 'day1' : 'daysN', n);
  return t(off?.when === 'after' ? 'afterEvent' : 'beforeEvent', unit);
}
// Keep dates in step: an event's `due` follows its block; an attached task's due follows the event.
function syncEventTasks() {
  let any = false;
  for (const ev of ownEvents().filter((x) => !x.allDay && !x.repeat)) {
    const b = nextBlockOf(ev.id);
    if (b && b.date !== ev.due) { upsert('tasks', { ...ev, due: b.date }, { silent: true }); any = true; }
  }
  for (const x of live('tasks').filter((y) => y.eventId && !y.done)) {
    const ev = eventOf(x.eventId);
    if (!ev) { upsert('tasks', { ...x, eventId: null, eventOffset: null }, { silent: true }); any = true; continue; }
    const d = eventDate(ev);
    if (!d) continue;
    const due = offsetDue(d, x.eventOffset);
    if (x.due !== due) { upsert('tasks', { ...x, due }, { silent: true }); any = true; }
  }
  return any;
}
// An event from quick add ("Concerto 20 mag 21:00 @Arena"): saved, and on the plan when it has a time.
function saveEvent(d) {
  const { planDate, planTime, ...fields } = d;
  const rec = saveTask({ ...fields, event: true, due: planDate, allDay: planTime == null, eventTime: planTime ?? null, importance: 3, checklist: fields.checklist || [], steps: fields.steps || [], allRules: [] });
  if (planTime != null) planTask(rec, planDate, Math.max(0, planTime - anchorOffset(null, rec)));
  return get('tasks', rec.id);
}
// "+ To do before / after": a task attached to an event, due so many days or weeks around it.
function openEventTaskAdd(ev, { back = false } = {}) {
  const d = eventDate(ev);
  openModal(`
    <h2>✓ ${esc(t('addEventTask'))}</h2>
    <p class="hint">📅 ${esc(ev.title)}${d ? ` · ${esc(relDay(d))}` : ''}</p>
    <label>${esc(t('title'))}<input name="title" required autocomplete="off" placeholder="${esc(t('eventTaskPh'))}"></label>
    <div class="offset-row">
      <input name="evDays" type="number" min="0" max="365" step="1" value="1" aria-label="${esc(t('offsetDays'))}">
      <select name="evUnit"><option value="days">${esc(t('daysUnit'))}</option><option value="weeks">${esc(t('weeksUnit'))}</option></select>
      <select name="evWhen"><option value="before">${esc(t('beforeIt'))}</option><option value="after">${esc(t('afterIt'))}</option></select>
    </div>
    ${small('eventTaskOffsetHint')}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('add'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form, action) => {
    if (action === 'ok') {
      const q = quickAdd(form.title.value);
      if (!q.title) return;
      const off = { days: Math.max(0, Number(form.evDays.value) || 0) * (form.evUnit.value === 'weeks' ? 7 : 1), when: form.evWhen.value };
      const base = quickFields(q);
      applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...base, category: base.category || (ev.event ? ev.category : null) || null, eventId: ev.id, eventOffset: off, due: d ? offsetDue(d, off) : null }, { silent: true }));
      toast(t('eventTaskAdded', ev.title));
      changed();
    }
    if (back) setTimeout(() => (ev.event ? openTask(get('tasks', ev.id)) : openEvent(get('events', ev.id))), 0);
  });
}
// Plan the event's open, unplanned tasks over the days up to their due dates (after-the-event ones from
// the event on), the way the planner would.
function planEventTasks(ev) {
  const td = today();
  const open = eventTasksOf(ev.id).filter((x) => !x.done && !plannedTaskIds().has(x.id));
  if (!open.length) { toast(t('allPlanned')); return 0; }
  const last = open.reduce((m, x) => (x.due && x.due > m ? x.due : m), td);
  const n = Math.min(90, Math.max(1, Math.round((parseDate(last) - parseDate(td)) / 864e5) + 1));
  const days = Array.from({ length: n }, (_, i) => addDays(td, i));
  let made = 0;
  for (const p of planPlacements(open.map((x) => x.id), days)) {
    const task = get('tasks', p.taskId); if (!task) continue;
    planTask(task, p.date, p.start, { minutes: p.minutes }); made++;
  }
  toast(made ? t('plannedN', made) : t('noRoom'));
  changed();
  return made;
}
// Older plain blocks (no task) become events, so everything you put on the plan has a home.
function migrateBlocksToEvents() {
  // (Blocks laid down by a day template stay plain: they are the template's, not events.)
  const plain = live('blocks').filter((b) => !b.taskId && !b.kind && !b.stepId && !b.parentId && !b.templateId && !outcomeOf(b) && b.date >= today());
  for (const b of plain) {
    const tk = upsert('tasks', { id: uid(), createdAt: Date.now(), event: true, title: b.title || t('tabEvents'), minutes: b.minutes, category: b.category || null, due: b.date, eventTime: b.start, notes: b.notes || '', done: false, checklist: [], rules: [], steps: [] }, { silent: true });
    upsert('blocks', { ...b, taskId: tk.id }, { silent: true });
  }
  return plain.length > 0;
}

// Tasks with a block today or later that isn't finished yet.
// The next open block of a task (today on), or null.
function nextPlanned(id) {
  const td = today();
  return live('blocks').filter((b) => b.taskId === id && !b.done && !b.outcome && b.date >= td && b.kind !== 'prep')
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))[0] || null;
}
// Already on the plan, so not to plan again: one-off tasks with an open block from today on (tasks to do
// "X times" or step by step still count as to plan while occurrences or steps are left).
function alreadyPlanned() {
  const ids = plannedTaskIds();
  return openTasks().filter((x) => ids.has(x.id) && x.repeat !== 'times' && !splitsSteps(x) && (!x.repeat || x.seriesTime != null));
}
// "Already planned": a folded list at the bottom of the planning panels, each one a link to its day.
function plannedList(list, action, open) {
  if (!list.length) return '';
  return `<details class="tray-planned"${open ? ' open' : ''}><summary data-action="${action}">📅 ${esc(t('grp_planned'))} <small>${list.length}</small></summary>
    ${hint('plannedNote')}
    ${sortTasks(list, today()).map((x) => { const b = nextPlanned(x.id); return `<a class="tp-planned" href="#/plan/${esc(b.date)}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}"><span class="tp-dot"></span><span>${esc(x.title)}</span><small>${esc(plannedWhen(x))}</small></a>`; }).join('')}
  </details>`;
}
function plannedWhen(x) { const b = nextPlanned(x.id); return b ? t('plannedAt', relDay(b.date), fmtTime(b.start)) : ''; }
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

// ---------- travel ----------
// A task with a place gets travel steps: "Get there" before it (on unless switched off) and
// "Come back" after it (off unless switched on). They are real steps with fixed ids, so they show
// on the plan, can be ticked and count in the task's length; the editor keeps them out of the
// editable list. A task without steps of its own gets a hidden "main" step for its own length.
const TRV = { there: 'trv_there', back: 'trv_back', main: 'trv_main', buffer: 'trv_buf' };
const isTravelStep = (y) => Boolean(y?.travel) || Boolean(y?.main) || Boolean(y?.buffer);
const realSteps = (task) => (task?.steps || []).filter((y) => y.title && !isTravelStep(y));
// The leg's step that carries the looked-up time (a leg built from a saved task with steps has more).
const travelStep = (task, kind) => (task?.steps || []).find((y) => y.travel === kind && y.lookup !== false) || null;
const legMinutes = (task, kind) => (task?.steps || []).filter((y) => y.travel === kind).reduce((n, y) => n + (Number(y.minutes) || 0), 0);
// "Get there" and "Come back" are saved tasks (`travelRole`): rename them, give them steps. The step
// marked ⚓ (else the first) gets the travel time; the other steps keep their own length.
const LEGS = ['there', 'back'];
function legTemplate(kind) { return live('tasks').filter((x) => x.travelRole === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null; }
function ensureLegTasks() {
  let made = false;
  if (isConfigured() && !state.meta.lastSync) return false; // wait for the first sync: another device may have them
  for (const kind of LEGS) {
    // Two devices made one each before syncing: drop the newer one if it's still untouched.
    const dups = live('tasks').filter((x) => x.travelRole === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(1);
    for (const d of dups) if (!realSteps(d).length && d.title === t(kind === 'there' ? 'getThere' : 'comeBack')) { remove('tasks', d.id); made = true; }
    if (legTemplate(kind)) continue;
    upsert('tasks', { id: uid(), title: t(kind === 'there' ? 'getThere' : 'comeBack'), routine: true, travelRole: kind, minutes: 30, steps: [], checklist: [], notes: '', category: '', createdAt: Date.now() }, { silent: true });
    made = true;
  }
  return made;
}
function setLegTask(kind, id) {
  for (const x of live('tasks').filter((y) => y.travelRole === kind && y.id !== id)) upsert('tasks', { ...x, travelRole: null }, { silent: true });
  const x = get('tasks', id);
  if (x && x.travelRole !== kind) upsert('tasks', { ...x, travelRole: kind, routine: true }, { silent: true });
}
// Margin after a task: its own, or the default from Settings → Planner.
function bufferOf(task) { const b = task?.buffer; return b == null || b === '' ? Number(state.settings.taskBuffer) || 0 : Number(b) || 0; }
// The task's own length, without travel.
function ownMinutes(task) {
  const rs = realSteps(task);
  if (rs.length) return rs.reduce((n, y) => n + (Number(y.minutes) || 10), 0);
  const m = (task?.steps || []).find((y) => y.main);
  return Number(m?.minutes) || Number(task?.minutes) || 30;
}
function travelCfg() { const s = state.settings.travel || {}; return { home: '', mode: 'transit', buffer: 5, googleKey: '', startHere: false, thereDefault: 'place', backDefault: s.back ? 'place' : 'off', ...s }; }
function travelOf(task) { const c = travelCfg(); return { there: c.thereDefault !== 'off', back: c.backDefault !== 'off', mode: 'default', ...(task?.travel || {}) }; }
const travelAffected = (x) => x.place || x.steps?.some((y) => y.travel || y.buffer) || travelCfg().thereDefault === 'always' || travelCfg().backDefault === 'always' || bufferOf(x) > 0;
const travelMode = (task) => { const m = travelOf(task).mode; return TRAVEL_MODES.includes(m) ? m : travelCfg().mode; };
const travelCache = () => state.settings.travelCache || {};
function hereNow(date = today()) {
  const c = travelCfg(); const h = state.settings.here;
  return c.startHere && h && today(new Date(h.at)) === date ? `${h.lat},${h.lon}` : '';
}
// Where a trip starts: the place of the last planned task before it that day that doesn't come
// home again; otherwise where you are (today, if you let the app use your location) or home.
function originFor(task, block = null) {
  const c = travelCfg();
  const date = block?.date || null;
  if (block) {
    const before = busyOn(date).filter((b) => b.id !== block.id && b.taskId && b.taskId !== task.id && b.start + b.minutes <= block.start + 1)
      .sort((a, b) => b.start - a.start);
    for (const b of before) {
      const tk = get('tasks', b.taskId);
      if (tk?.place) return travelOf(tk).back ? (hereNow(date) || c.home) : tk.place;
    }
  }
  return (date ? hereNow(date) : '') || c.home;
}
function travelDest(task) { return hereNow() || travelCfg().home; }
// (Re)build a task's steps around its travel, using what's cached; returns the task with
// `minutes` and `steps` updated, and marks what still needs fetching.
function withTravel(task, { origin = null, block = null } = {}) {
  const tv = travelOf(task);
  const c = travelCfg();
  const rs = realSteps(task);
  const own = ownMinutes(task);
  const mode = travelMode(task);
  const core = rs.length ? rs : [{ id: TRV.main, title: task.title, minutes: own, main: true }];
  const total = (steps) => steps.reduce((n, y) => n + (Number(y.minutes) || 0), 0);
  if (task.helper || task.travelRole) return { ...task, steps: rs, minutes: own };
  const buf = bufferOf(task);
  const bufSteps = buf > 0 ? [{ id: TRV.buffer, title: t('bufferStep'), buffer: true, minutes: buf }] : [];
  // A leg: the saved task's title and steps, with the looked-up time on its ⚓ step (else its only step).
  const legOf = (kind, look) => {
    const tpl = legTemplate(kind);
    const name = tpl?.title || t(kind === 'there' ? 'getThere' : 'comeBack');
    const subs = realSteps(tpl);
    if (!subs.length) return [{ ...look, title: name }];
    const ai = Math.min(anchorIndex(subs, tpl.anchorStepId), subs.length - 1);
    return subs.map((y, i) => (i === ai ? { ...look, title: y.title || name }
      : { id: `${TRV[kind]}_${y.id}`, title: y.title, travel: kind, lookup: false, mode, from: '', to: '', minutes: Number(y.minutes) || 10, known: true, pending: false }));
  };
  const placeholder = (kind) => ({ id: TRV[kind], travel: kind, mode, from: '', to: '', minutes: UNKNOWN_MINUTES, known: false, pending: false, noPlace: true });
  if (!task.place) {
    // "Always": without a place the leg is a "?" reminder to account for the trip.
    const there = tv.there && c.thereDefault === 'always' && !task.routine ? legOf('there', placeholder('there')) : [];
    const back = tv.back && c.backDefault === 'always' && !task.routine ? legOf('back', placeholder('back')) : [];
    if (!there.length && !back.length && !bufSteps.length) return { ...task, steps: rs, minutes: own };
    const steps = [...there, ...core, ...back, ...bufSteps];
    return { ...task, steps, minutes: total(steps) };
  }
  if (!tv.there && !tv.back) {
    const steps = bufSteps.length ? [...core, ...bufSteps] : rs;
    return { ...task, steps, minutes: bufSteps.length ? total(steps) : own };
  }
  const from = origin ?? originFor(task, block);
  const mk = (kind, a, b, old) => {
    const to = kind === 'there' ? task.place : travelDest(task);
    const m = cachedMinutes(travelCache(), mode, a, b);
    const known = m != null && m !== undefined;
    return legOf(kind, { id: TRV[kind], travel: kind, mode, from: a, to,
      minutes: known ? m + (m ? Number(c.buffer) || 0 : 0) : (old?.known ? old.minutes : UNKNOWN_MINUTES), known, pending: m === undefined });
  };
  const steps = [];
  if (tv.there) steps.push(...mk('there', from, task.place, travelStep(task, 'there')));
  steps.push(...core);
  if (tv.back) steps.push(...mk('back', task.place, travelDest(task), travelStep(task, 'back')));
  steps.push(...bufSteps);
  return { ...task, steps, minutes: total(steps) };
}
// Apply the travel steps to a saved task and move its blocks so the task itself stays at its time
// (travel grows or shrinks in front of it). Returns the stored task.
function applyTravel(task, opts = {}) {
  const block = opts.block || nextBlockOf(task.id);
  const next = withTravel(task, { ...opts, block });
  const prev = opts.prev || task; // what the blocks were sized for
  const same = JSON.stringify(next.steps) === JSON.stringify(task.steps) && next.minutes === task.minutes && prev === task;
  if (same) return task;
  const oldThere = legMinutes(prev, 'there');
  const newThere = legMinutes(next, 'there');
  const saved = upsert('tasks', next, { silent: true });
  for (const b of live('blocks').filter((x) => x.taskId === task.id && !x.stepId && !outcomeOf(x) && x.date >= today() && x.kind !== 'prep')) {
    const delta = (next.minutes || 0) - (prev.minutes || 0);
    if (!delta && oldThere === newThere) continue;
    upsert('blocks', { ...b, start: Math.max(0, b.start - (newThere - oldThere)), minutes: Math.max(5, b.minutes + delta) }, { silent: true });
  }
  return saved;
}
// Fetch the travel times that are missing, one at a time (the free services ask for that), and
// apply them. Runs a moment after anything changes; does nothing when all is known.
let travelTimer = null; let travelBusy = false; let travelAgain = false;
function scheduleTravelRefresh() { clearTimeout(travelTimer); travelTimer = setTimeout(refreshTravel, 1200); }
async function refreshTravel() {
  if (typeof fetch !== 'function') return;
  if (travelBusy) { travelAgain = true; return; } // a change while looking things up: go again after
  travelBusy = true;
  try {
    const cache = { ...travelCache(), geo: { ...(travelCache().geo || {}) }, routes: { ...(travelCache().routes || {}) } };
    const ctx = { fetchFn: (u, i) => fetch(u, i), cache, now: Date.now(), googleKey: travelCfg().googleKey || '' };
    let changed = false; let n = 0;
    for (const task of travelTasks().filter((x) => x.place)) {
      const block = nextBlockOf(task.id);
      const planned = withTravel(task, { block });
      for (const y of planned.steps.filter((z) => z.travel && z.pending)) {
        if (n >= 12) break; // the rest next time
        const departAt = block ? parseDate(block.date).getTime() + (block.start + (y.travel === 'back' ? block.minutes : 0)) * 60000 : Date.now() + 3600000;
        await travelMinutes(y.from, y.to, y.mode, departAt, ctx);
        changed = true; n++;
        if (n < 12) await new Promise((r) => setTimeout(r, 1100));
      }
    }
    if (changed) saveSettings({ travelCache: cache });
    // Apply what's known now (also when origins moved) to every task with a place.
    let any = false;
    for (const task of travelTasks().filter(travelAffected)) { const before = task.updatedAt; if (applyTravel(task).updatedAt !== before) any = true; }
    if (any || changed) { render(); clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 2500); }
  } finally { travelBusy = false; if (travelAgain) { travelAgain = false; scheduleTravelRefresh(); } }
}

// ---------- readiness: what the planner still needs to know ----------
// Each issue is an i18n key; the editor section to open is `secOf`.
function taskIssues(x) {
  if (!x || x.done || x.helper || x.routine || x.travelRole) return [];
  const out = [];
  const rs = realSteps(x);
  if (!x.lenSet && !rs.length && ownMinutes(x) === 30) out.push('iss_len');
  if (!x.place && (x.steps || []).some((y) => y.noPlace)) out.push('iss_place');
  if (x.place) {
    const tv = travelOf(x);
    if (!travelCfg().home && !hereNow()) out.push('iss_home');
    else if (placeNotFound(travelCache(), x.place)) out.push('iss_geo');
    else if ((tv.there || tv.back) && (x.steps || []).some((y) => y.travel && !y.known)) out.push('iss_travel');
  }
  if (ownMinutes(x) > planSettings().maxLoad && !splitsSteps(x)) out.push('iss_long');
  return out;
}
const ISSUE_SEC = { iss_len: 'basics', iss_place: 'place', iss_home: 'place', iss_geo: 'place', iss_travel: 'place', iss_long: 'steps' };
function issueText(x) { return taskIssues(x).map((k) => t(k)).join(' · '); }
function issueBadge(x) {
  const iss = taskIssues(x);
  return iss.length ? `<button type="button" class="iss" data-action="task-fix" data-id="${esc(x.id)}" data-sec="${ISSUE_SEC[iss[0]]}" title="${esc(issueText(x))}" aria-label="${esc(issueText(x))}">⚠</button>` : '';
}
function checklistLeft(items, checked = []) { return items.filter((_, i) => !checked[i]).length; }

function setTaskDone(task, done, date = today()) {
  // A recurring task on the plan: ticking it ticks its next occurrence's block.
  if (isSeries(task) && task.seriesTime != null) {
    const b = seriesBlocks(task.id).find((x) => x.occ === task.due) || seriesBlocks(task.id).filter((x) => !outcomeOf(x) && x.occ >= date).sort((p, q) => (p.occ < q.occ ? -1 : 1))[0];
    if (b) { setOutcome(b, done ? 'done' : null); return; }
  }
  // "3 times a week": ticking counts one time (it stays open for the next ones).
  if (task.repeat === 'times') {
    const log = [...(task.doneLog || [])];
    if (done) log.push(date); else { const i = log.lastIndexOf(date); if (i >= 0) log.splice(i, 1); }
    upsert('tasks', { ...task, doneLog: log.slice(-200), checked: [] }, { silent: true });
    return;
  }
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
  const { series, ...fields } = extra;
  const minutes = fields.minutes || task.minutes || 30;
  let at = start;
  if (at == null) {
    const from = (date === today() ? nowMinutes() : s.dayStart) + leadOf(task);
    at = freeSlot(busyOn(date), minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
    if (at == null) at = Math.min(Math.ceil(Math.max(nowMinutes(), s.dayStart) / s.snap) * s.snap, 1440 - minutes);
  }
  // Planning a recurring task once plans the whole series: this is its first occurrence, at this time.
  if (isSeries(task) && !series && !fields.stepId) {
    const tk = upsert('tasks', { ...task, seriesFrom: date, due: date, seriesTime: at + anchorOffset(null, task), skipped: (task.skipped || []).filter((d) => d < date) }, { silent: true });
    const b = newBlock({ date, start: at, minutes, title: task.title, category: task.category || null, taskId: task.id, seriesId: task.id, occ: date, auto: true, ...fields });
    ensureSeries(tk);
    return b;
  }
  return newBlock({ date, start: at, minutes, title: task.title, category: task.category || null, taskId: task.id, ...fields });
}

// ---------- recurring tasks as a series of blocks ----------
// Once a recurring task has a time, every occurrence in the coming weeks is a block of its own
// (`seriesId` = the task, `occ` = the date). Blocks still `auto` follow the series (time, length,
// title); one you change on its own stops following. Rules live in plan.js (occurrences()).
const SERIES_DAYS = 56;
const isSeries = (x) => Boolean(x && REPEATS.includes(x.repeat) && !x.helper);
const seriesBlocks = (taskId) => live('blocks').filter((b) => b.seriesId === taskId);
function ensureSeries(task) {
  if (!isSeries(task) || task.seriesTime == null || task.done) return;
  const td = today();
  const want = occurrences(task, td, addDays(td, SERIES_DAYS));
  const have = new Map(seriesBlocks(task.id).map((b) => [b.occ, b]));
  const start = Math.max(0, task.seriesTime - anchorOffset(null, task));
  for (const d of want) {
    const b = have.get(d);
    if (!b) { planTask(task, d, start, { seriesId: task.id, occ: d, auto: true, series: true }); continue; }
    if (b.auto && !outcomeOf(b) && (b.start !== start || b.minutes !== task.minutes || b.title !== task.title || (b.category || null) !== (task.category || null))) {
      upsert('blocks', { ...b, start, minutes: task.minutes, title: task.title, category: task.category || null }, { silent: true });
    }
  }
  const wantSet = new Set(want);
  for (const [d, b] of have) if (d >= td && !wantSet.has(d) && b.auto && !outcomeOf(b)) remove('blocks', b.id);
}
function ensureAllSeries() { for (const x of live('tasks').filter((y) => isSeries(y) && y.seriesTime != null && !y.done)) ensureSeries(x); syncEventTasks(); }
// Change a series from one occurrence on: the old series ends the day before, a copy carries the
// changes from `fromOcc`, and the blocks from that day on move to the copy.
function splitSeries(prev, changes, fromOcc) {
  const first = prev.seriesFrom || prev.due;
  if (!first || fromOcc <= first) return upsert('tasks', { ...prev, ...changes, id: prev.id }, { silent: true });
  const until = addDays(fromOcc, -1);
  const old = { ...prev, repeatUntil: until };
  if (old.due && old.due >= fromOcc) { old.done = true; old.doneAt = Date.now(); } // everything before was done already
  upsert('tasks', old, { silent: true });
  const { id, createdAt, lastDone, doneAt, ...rest } = { ...prev, ...changes };
  void id; void createdAt; void lastDone; void doneAt;
  const nu = upsert('tasks', { ...rest, id: uid(), createdAt: Date.now(), seriesFrom: fromOcc, due: fromOcc, done: false, skipped: (rest.skipped || []).filter((d) => d >= fromOcc) }, { silent: true });
  for (const b of seriesBlocks(prev.id).filter((x) => x.occ >= fromOcc)) upsert('blocks', { ...b, taskId: nu.id, seriesId: nu.id }, { silent: true });
  for (const b of live('blocks').filter((x) => x.taskId === prev.id && x.date >= fromOcc && !x.seriesId)) upsert('blocks', { ...b, taskId: nu.id }, { silent: true });
  // The new rule may not start on fromOcc itself.
  if (!occurrences(nu, fromOcc, fromOcc).length) { const nd = nextOccurrence(nu, fromOcc); if (nd) upsert('tasks', { ...get('tasks', nu.id), due: nd }, { silent: true }); }
  ensureSeries(get('tasks', nu.id));
  return get('tasks', nu.id);
}
// End a series from an occurrence on (that one included).
function endSeries(task, fromOcc) {
  for (const b of seriesBlocks(task.id).filter((x) => x.occ >= fromOcc && !outcomeOf(x))) deleteBlock(b);
  const first = task.seriesFrom || task.due;
  if (!first || fromOcc <= first) { upsert('tasks', { ...task, done: true, doneAt: Date.now() }, { silent: true }); return; }
  const until = addDays(fromOcc, -1);
  upsert('tasks', { ...task, repeatUntil: until, ...(task.due >= fromOcc ? { done: true, doneAt: Date.now() } : {}) }, { silent: true });
}
// A small choice: only this occurrence, or this and the following ones.
function askScope({ title, thisLabel, followingLabel, onThis, onFollowing }) {
  openModal(`
    <h2>↻ ${esc(title)}</h2>
    <div class="add-opts">
      <button class="add-opt" value="this" formnovalidate><span class="add-ico">1</span><span class="item-text">${esc(thisLabel)}</span></button>
      <button class="add-opt" value="following" formnovalidate><span class="add-ico">↻</span><span class="item-text">${esc(followingLabel)}</span></button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (action === 'this') setTimeout(onThis, 0);
    if (action === 'following') setTimeout(onFollowing, 0);
  });
}

const isCheckStep = (b) => get('tasks', b?.taskId)?.check === 'ingredients';

// Create the linked blocks a block needs: preparations for its task, and keep them in order.
function linkFor(block) {
  const td = today();
  if (!block || block.done || block.outcome || block.date < td || block.kind === 'prep') return;
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

function setOutcome(block, outcome, { steps = true } = {}) {
  const prev = outcomeOf(block);
  const b = upsert('blocks', { ...block, done: outcome === 'done', outcome: outcome || null }, { silent: true });
  // Ticking the whole task ticks its open steps; unticking it (or resetting) clears them.
  if (steps && stepsOf(b).length) {
    if (outcome === 'done') for (const st of stepsOf(b)) if (!b.stepState?.[st.id]) setStepOutcome(get('blocks', b.id), st.id, 'done', { parent: false });
    if (!outcome) for (const st of stepsOf(b)) if (get('blocks', b.id).stepState?.[st.id]) setStepOutcome(get('blocks', b.id), st.id, null, { parent: false });
  }
  const task = b.taskId && get('tasks', b.taskId);
  if (task && isTodo(task) && b.stepId) {
    // A step planned on its own: the task is done once every step's block is.
    const steps = (task.steps || []).filter((y) => y.title);
    const all = steps.length > 0 && steps.every((y) => live('blocks').some((x) => x.taskId === task.id && x.stepId === y.id && outcomeOf(x) === 'done'));
    if (Boolean(task.done) !== all) setTaskDone(get('tasks', task.id), all);
  } else if (task && isTodo(task) && !b.partial && b.kind !== 'prep' && task.repeat !== 'times') {
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

// ---------- steps ----------
// A task can be split into steps (Dinner: Prep, Eat, Clean up). Its length is the sum of the steps.
// On the plan it stays one block; each step has its own time inside it, can be ticked or marked
// "couldn't do it", and can have rules of its own. The block is done once every step is.
function stepsOf(b) {
  if (b?.stepId) return []; // a single step planned on its own
  const task = b?.taskId && get('tasks', b.taskId);
  return (task?.steps || []).filter((x) => x.title);
}
// A step's length on a block: your own length for this one (✎ in the meal dialog), else, for a
// step that takes its length from the recipes, the meal's prep time; else its usual length.
function recipePrep(b) {
  if (b?.kind !== 'meal') return null;
  return prepMinutes(mealRecipes(b).map((x) => recipeOf(x.recipeId)));
}
function stepLen(b, y) {
  const own = Number(b?.stepMinutes?.[y.id]);
  if (own) return own;
  if (y.from === 'recipes') return recipePrep(b) ?? (Number(y.minutes) || 15);
  return Number(y.minutes) || 10;
}
// The step a saved task's usual time refers to: for a meal whose prep depends on the recipes, the
// step right after the prep (you eat at 19:30; preparing grows earlier). Otherwise the first step.
// Returns an index; steps.length means "the end".
function anchorIndex(steps, anchorId = null) {
  const i = anchorId ? steps.findIndex((y) => y.id === anchorId) : -1;
  if (i >= 0) return i;
  const last = steps.map((y) => y.from).lastIndexOf('recipes');
  if (last >= 0) return last + 1;
  const first = steps.findIndex((y) => !y.travel); // the task itself, after "Get there"
  return first < 0 ? 0 : first;
}
// How far into a block its task's time is (the anchor step's start), in minutes. With no steps, 0.
function anchorOffset(b, task = b?.taskId && get('tasks', b.taskId)) {
  const steps = (task?.steps || []).filter((y) => y.title);
  if (!steps.length) return 0;
  const ai = anchorIndex(steps, task.anchorStepId);
  if (b?.id && has('blocks', b.id)) {
    const st = stepTimes(b);
    return ai < st.length ? st[ai].start - b.start : b.minutes;
  }
  return steps.slice(0, ai).reduce((n, y) => n + stepLen(b || {}, y), 0);
}
function anchorTitle(task) {
  const steps = (task?.steps || []).filter((y) => y.title);
  const ai = anchorIndex(steps, task?.anchorStepId);
  return ai > 0 && ai < steps.length ? steps[ai].title : ai > 0 ? null : null;
}
// The next planned (not finished) block of a task, if any.
function nextBlockOf(taskId) {
  const td = today();
  return live('blocks').filter((b) => b.taskId === taskId && !outcomeOf(b) && b.date >= td && b.kind !== 'prep')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))[0] || null;
}
// Each step's time inside the block (scaled if the block was made longer or shorter by hand).
function stepTimes(b) {
  const steps = stepsOf(b);
  const lens = steps.map((y) => stepLen(b, y));
  const total = lens.reduce((n, m) => n + m, 0) || 1;
  const k = b.minutes / total;
  let cum = 0;
  return steps.map((x, i) => {
    const start = b.start + Math.round(cum * k);
    cum += lens[i];
    return { ...x, len: lens[i], start, end: b.start + Math.round(cum * k), state: b.stepState?.[x.id] || null };
  });
}
// A block that starts with a "Get there" leg has two times worth reading: when to leave (the block's
// start) and when the task itself starts (after the leg). Null when there is no leg.
function legTimes(b) {
  const going = stepTimes(b).filter((y) => y.travel === 'there');
  if (!going.length) return null;
  const start = going[going.length - 1].end;
  return { leave: b.start, start, trip: start - b.start, step: going[going.length - 1] };
}
// The time line of a block: "leave 11:00 · 11:20–12:20" with a leg, "11:00–12:00" without.
function blockTimeText(b) {
  const lg = legTimes(b);
  return lg && lg.trip > 0 ? `${t('leaveAt', fmtTime(lg.leave))} · ${range(lg.start, b.start + b.minutes - lg.start)}` : range(b.start, b.minutes);
}
function setStepOutcome(block, sid, outcome, { parent = true } = {}) {
  const prev = block.stepState?.[sid] || null;
  const stepState = { ...(block.stepState || {}) };
  if (outcome) stepState[sid] = outcome; else delete stepState[sid];
  let b = upsert('blocks', { ...block, stepState }, { silent: true });
  if (prev !== (outcome || null)) {
    if (prev) undoRules(b, prev, sid);
    if (outcome) fireRules(get('blocks', b.id), outcome, sid);
  }
  b = get('blocks', b.id);
  if (parent) {
    const steps = stepsOf(b);
    const all = steps.length > 0 && steps.every((x) => b.stepState?.[x.id] === 'done');
    if (all && outcomeOf(b) !== 'done') trySetBlockDone(b, true, { fromSteps: true });
    else if (!all && outcomeOf(b) === 'done') setOutcome(b, null, { steps: false });
  }
  return get('blocks', b.id);
}
// Ticking a step: if a rule waits for it to fail, ask how it went.
function tryStep(block, sid, done) {
  if (done && rulesOf(block, sid).some((r) => r.when === 'failed')) { openOutcome(block, sid); return false; }
  setStepOutcome(block, sid, done ? 'done' : null);
  return true;
}
function setBlockDone(block, done) { return setOutcome(block, done ? 'done' : null); }

// "planned" rules are the task's preparations (stored in task.prep, planned by linkFor).
const RULE_WHEN = ['planned', 'done', 'failed', 'missed'];
const RULE_PLACES = ['before', 'after', 'next', 'tomorrow', 'slots', 'pool'];
const PREP_PLACES = ['before', 'sameday', 'daybefore'];
// Rules about the whole block (sid null) or about one of its steps.
function rulesOf(b, sid = null) { return ((b?.taskId && get('tasks', b.taskId)?.rules) || []).filter((r) => (r.stepId || null) === sid); }

function fireRules(block, when, sid = null) {
  const step = sid ? stepTimes(block).find((x) => x.id === sid) : null;
  for (const rule of rulesOf(block, sid).filter((r) => r.when === when)) {
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
    const title = linked?.title || rule.title || t('followUp');
    const s = planSettings();
    const wins = cleanWindows(rule.windows?.length ? rule.windows : linked?.windows);
    if (rule.place === 'pool' || rule.place === 'slots') {
      // "Another time": a to-do of its own, labelled with what it came from, back among the tasks to
      // plan (with the windows it can go in). "Next free window": planned straight into the first one.
      const slot = rule.place === 'slots' ? nextWindowSlot(wins, minutes) : null;
      if (block.ruleTasks?.[rule.id] && has('tasks', block.ruleTasks[rule.id])) continue; // fired before
      const from = get('tasks', block.taskId);
      const tk = upsert('tasks', {
        id: uid(), createdAt: Date.now(), title, minutes, importance: importanceOf(from || {}), category: linked?.category || block.category || null,
        windows: wins, steps: (linked?.steps || []).map((y) => ({ ...y })), checklist: [...(linked?.checklist || [])], rules: (linked?.rules || []).map((r) => ({ ...r })),
        fromTaskId: block.taskId || null, fromTitle: block.title, due: null, repeat: null, notes: '', done: false,
      }, { silent: true });
      upsert('blocks', { ...get('blocks', block.id), ruleTasks: { ...(get('blocks', block.id).ruleTasks || {}), [rule.id]: tk.id } }, { silent: true });
      if (slot) {
        newBlock({ id, date: slot.date, start: slot.start, minutes, title, taskId: tk.id, category: tk.category, kind: 'followup', sourceId: block.id, auto: true });
        toast(t('ruleAdded', title, relDay(slot.date), fmtTime(slot.start)));
      } else toast(t(rule.place === 'slots' ? 'ruleNoWindow' : 'ruleToPool', title), 5000);
      continue;
    }
    let date = block.date; let start;
    if (rule.place === 'before') {
      ({ date, start } = placePrep({ parent: target, minutes, mode: 'before', blocksOn: busyOn, today: today(), nowMin: nowMinutes(), settings: s }));
    } else {
      if (rule.place === 'tomorrow') date = addDays(today(), 1);
      if (rule.place === 'next') date = today();
      const from = rule.place === 'after' ? (step ? step.end : block.start + block.minutes) : rule.place === 'next' ? nowMinutes() : s.dayStart;
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
function undoRules(block, when, sid = null) {
  for (const rule of rulesOf(block, sid).filter((r) => r.when === when)) {
    // A to-do the rule made ("another time"): taken back unless it's been planned or done since.
    const made = block.ruleTasks?.[rule.id] && get('tasks', block.ruleTasks[rule.id]);
    if (made && !made.done && !live('blocks').some((b) => b.taskId === made.id && b.id !== `${block.id}_r_${rule.id}`)) {
      remove('tasks', made.id);
      const rt = { ...(get('blocks', block.id).ruleTasks || {}) }; delete rt[rule.id];
      upsert('blocks', { ...get('blocks', block.id), ruleTasks: rt }, { silent: true });
    }
    const cur = get('blocks', `${block.id}_r_${rule.id}`);
    if (cur && !cur.done && !cur.outcome) remove('blocks', cur.id);
  }
}

// The first free time inside one of these windows, from now: within four weeks (or up to the last
// specific date among them, at most a year).
function nextWindowSlot(wins, minutes) {
  const s = planSettings(); const td = today(); const now = nowMinutes();
  const last = wins.map((w) => w.date).filter(Boolean).sort().pop();
  const span = Math.min(366, Math.max(28, last ? Math.round((parseDate(last) - parseDate(td)) / 864e5) + 1 : 0));
  for (let i = 0; i < span; i++) {
    const d = addDays(td, i);
    for (const w of wins.filter((x) => windowOn(x, d)).sort((a, b) => a.from - b.from)) {
      const from = Math.max(w.from, d === td ? Math.ceil(now / 5) * 5 : 0);
      const at = freeSlot(busyOn(d).filter((b) => !b.allowOverlap), minutes, { from, dayStart: 0, dayEnd: w.to, snap: Math.min(s.snap, 15) });
      if (at != null) return { date: d, start: at };
    }
  }
  return null;
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
function trySetBlockDone(block, done, { fromSteps = false } = {}) {
  if (done && isCheckStep(block)) { runCheck(block); return true; }
  // A step whose rule waits for "couldn't be done" asks first, before the whole task is ticked.
  if (done && !fromSteps) {
    const ask = stepsOf(block).find((x) => !block.stepState?.[x.id] && rulesOf(block, x.id).some((r) => r.when === 'failed'));
    if (ask) { openOutcome(block, ask.id, { thenWhole: true }); return false; }
  }
  if (done && checklistLeft(checklistOf(block), block.checked) > 0) { openChecklist(block); return false; }
  if (done && rulesOf(block).some((r) => r.when === 'failed')) { openOutcome(block); return false; }
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

// A step whose result matters ("Check the backpack": ready, or not?): ticking it asks how it went.
function openOutcome(block, sid = null, { thenWhole = false } = {}) {
  const failRules = rulesOf(block, sid).filter((r) => r.when === 'failed');
  const title = sid ? stepsOf(block).find((x) => x.id === sid)?.title || block.title : block.title;
  const what = failRules.map((r) => (r.then === 'groceries' ? t('groceryTitle') : get('tasks', r.taskId)?.title || r.title)).filter(Boolean);
  setTimeout(() => openModal(`
    <h2>${esc(t('howDidItGo', title))}</h2>
    ${what.length ? `<p class="hint">${esc(t('ifNotThen', what.join(', ')))}</p>` : ''}
    <div class="outcome-choice">
      <button class="btn primary" value="done">✓ ${esc(t('wentOk'))}</button>
      <button class="btn" value="fail">✕ ${esc(t('couldntDo'))}</button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (sid) {
      setStepOutcome(get('blocks', block.id), sid, action === 'done' ? 'done' : 'failed');
      // You ticked the whole task: once this step is answered, the rest follow.
      if (thenWhole && action === 'done' && outcomeOf(get('blocks', block.id)) !== 'done' && trySetBlockDone(get('blocks', block.id), true)) changed();
      else changed();
      return;
    } else setOutcome(get('blocks', block.id), action === 'done' ? 'done' : 'failed');
    changed();
  }), 0);
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

// ---------- saved tasks ----------
// Tasks that come back often, at different times: meals (with recipes), the gym, cleaning…
// They're the "routine" tasks, grouped by category. "+ From saved" puts one on the plan.
function savedTasks() { return live('tasks').filter((x) => x.routine); }
function savedGroups() {
  const cats = categories();
  const order = (id) => { const i = cats.findIndex((c) => c.id === id); return i < 0 ? 999 : i; };
  const groups = new Map();
  for (const x of savedTasks().sort((a, b) => (a.defaultStart ?? 9999) - (b.defaultStart ?? 9999) || a.title.localeCompare(b.title))) {
    const c = get('categories', x.category) ? x.category : '';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(x);
  }
  return [...groups.entries()].sort((a, b) => (a[0] ? order(a[0]) : 1000) - (b[0] ? order(b[0]) : 1000)).map(([c, list]) => [c ? get('categories', c) : null, list]);
}
function savedInfo(x) {
  const when = x.defaultStart != null ? fmtTime(x.defaultStart) : t(`when_${x.when || 'any'}`);
  const bits = [when, fmtDur(x.minutes || 30)];
  if ((x.steps || []).length) bits.push(`▤ ${x.steps.map((y) => (y.from === 'recipes' ? `${y.title} ⟲` : y.title)).join(', ')}`);
  if (prepOf(x).length) bits.push(`↳ ${prepOf(x).map((p) => p.task.title).join(', ')}`);
  return bits.join(' · ');
}
// When a saved task would go on a day: its usual time, else the first free slot in its part of the day.
function savedStart(x, date) {
  const s = planSettings();
  if (x.defaultStart != null) return Math.max(0, x.defaultStart - anchorOffset(null, x));
  const win = WINDOWS[x.when];
  const from = Math.max(win ? win[0] : s.dayStart, date === today() ? nowMinutes() : s.dayStart) + leadOf(x);
  return freeSlot(busyOn(date), x.minutes || 30, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap })
    ?? Math.min(Math.ceil(from / s.snap) * s.snap, 1440 - (x.minutes || 30));
}
// The auto-planner: everything still to place (or the tasks selected in the tray), laid out over a
// period you choose, as previews in the tray.
const AUTO_SPANS = ['1', '2', '3', '7', '14', 'month', 'n'];
function openAutoPlanner() {
  // The guided flow: pick the span, fill the few details the planner is missing (inline, no editor),
  // then the previews appear on the plan and the drawer asks to add them.
  const td = today();
  const last = state.settings.autoSpan || { span: '7', n: 5 };
  const from0 = currentDate() > td ? currentDate() : td;
  const all = trayTasks();
  const sel = ui.assign?.sel?.size ? all.filter((x) => ui.assign.sel.has(x.id)) : all;
  const bad = sel.filter((x) => taskIssues(x).length).slice(0, 6);
  const noHome = bad.some((x) => taskIssues(x).includes('iss_home'));
  const LENS = [15, 30, 45, 60, 90, 120];
  const fix = (x) => {
    const iss = taskIssues(x);
    const rows = [];
    if (iss.includes('iss_len')) rows.push(`<div class="fix-row"><span>${esc(t('duration'))}</span><div class="pills">${LENS.map((m) => `<label class="day-pill"><input type="radio" name="len_${esc(x.id)}" value="${m}" ${m === 30 ? 'checked' : ''}><span>${esc(fmtDur(m))}</span></label>`).join('')}</div></div>`);
    if (iss.includes('iss_place') || iss.includes('iss_geo')) rows.push(`<div class="fix-row"><span>${esc(t('place'))}</span><input name="place_${esc(x.id)}" value="${esc(x.place || '')}" placeholder="${esc(t('placePh'))}" autocomplete="off"></div>${iss.includes('iss_geo') ? `<small class="hint warn-text">${esc(t('iss_geo'))}</small>` : ''}`);
    if (iss.includes('iss_long')) rows.push(`<div class="fix-row"><span>${esc(t('tooLongShort'))}</span><div class="pills"><label class="day-pill"><input type="radio" name="long_${esc(x.id)}" value="split" checked><span>${esc(t('splitIt'))}</span></label><label class="day-pill"><input type="radio" name="long_${esc(x.id)}" value="keep"><span>${esc(t('keepWhole'))}</span></label></div></div>`);
    if (iss.includes('iss_travel')) rows.push(`<small class="hint">${esc(t('iss_travel'))} · ${esc(t('travelCounted'))}</small>`);
    return rows.length ? `<div class="fix-card"><div class="fix-head"><b>${esc(x.title)}</b><small>${esc([x.due ? relDay(x.due) : '', x.minutes && x.lenSet ? fmtDur(x.minutes) : ''].filter(Boolean).join(' · '))}</small></div>${rows.join('')}</div>` : '';
  };
  const cards = bad.map(fix).filter(Boolean);
  openModal(`
    <h2>✦ ${esc(t('planBtn'))}</h2>
    <p class="hint">${esc(t('planFlowIntro', sel.length, cards.length))}</p>
    <div class="days spans">${AUTO_SPANS.map((k) => `<label class="day-pill"><input type="radio" name="span" value="${k}" ${k === last.span ? 'checked' : ''}><span>${esc(t(`span_${k}`))}</span></label>`).join('')}</div>
    <div class="two">
      <label>${esc(t('fromDay'))}<input type="date" name="from" value="${esc(from0)}" min="${esc(td)}"></label>
      <label>${esc(t('spanN'))}<input type="number" name="n" min="1" max="90" value="${esc(last.n || 5)}"></label>
    </div>
    ${cards.length ? `<div class="field-label">${esc(t('fixFirstTitle'))}</div>${noHome ? `<label>${esc(t('homeAddress'))}<input name="home" value="${esc(travelCfg().home)}" placeholder="${esc(t('homePh'))}" autocomplete="street-address"></label>` : ''}${cards.join('')}<small class="hint">${esc(t('fixSkipHint'))}</small>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(cards.length ? t('showPreview') : t('autoGo'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form) => {
    // Apply the inline fixes.
    for (const x of bad) {
      const len = form[`len_${x.id}`]; const pl = form[`place_${x.id}`]; const lg = form[`long_${x.id}`];
      const patch = {};
      if (len) { const v = Number(form.querySelector(`input[name="len_${x.id}"]:checked`)?.value); if (v) { patch.minutes = v; patch.lenSet = true; } }
      if (pl && pl.value.trim() !== (x.place || '')) patch.place = pl.value.trim();
      if (lg) patch.splitSteps = form.querySelector(`input[name="long_${x.id}"]:checked`)?.value === 'split' && (x.steps || []).filter((y) => y.title && !isTravelStep(y)).length > 1;
      if (Object.keys(patch).length) applyTravel(upsert('tasks', { ...x, ...patch }, { silent: true }), { prev: x });
    }
    if (form.home && form.home.value.trim() !== travelCfg().home) { saveSettings({ travel: { ...travelCfg(), home: form.home.value.trim() } }); for (const x of travelTasks()) applyTravel(x); }
    const span = form.querySelector('input[name=span]:checked')?.value || '7';
    const n = Math.max(1, Math.min(90, Number(form.n.value) || 5));
    saveSettings({ autoSpan: { span, n } });
    const from = isDate(form.from.value) && form.from.value >= td ? form.from.value : td;
    let days = [];
    if (span === 'month') { const m = from.slice(0, 7); for (let d = from; d.slice(0, 7) === m; d = addDays(d, 1)) days.push(d); } else {
      const k = span === 'n' ? n : Number(span);
      for (let i = 0; i < k; i++) days.push(addDays(from, i));
    }
    const weekend = (d) => [0, 6].includes(parseDate(d).getDay());
    if (state.settings.freeWeekends && days.some((d) => !weekend(d))) days = days.filter((d) => !weekend(d));
    if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
    const ids = ui.assign.sel.size ? trayTasks().filter((x) => ui.assign.sel.has(x.id)).map((x) => x.id) : trayTasks().map((x) => x.id);
    if (!ids.length) { toast(t('trayEmpty')); render(); return; }
    if (route().name !== 'plan') { location.hash = span === '1' ? `#/plan/${from}` : '#/plan'; ui.view = span === '1' ? 'day' : span === 'month' ? 'month' : 'week'; }
    ui.assign.open = false; // the previews matter now; the list can be opened again
    placeGhosts(ids, days);
    scheduleTravelRefresh();
  });
  modal.querySelector('input[name=n]').addEventListener('input', () => { const r = modal.querySelector('input[name=span][value=n]'); if (r) r.checked = true; });
}

// Import tasks from pasted text: one per line (lists from messages, notes, emails). Bullets,
// numbers and checkboxes are dropped; "30m", "!1" and "#work" work as in quick add.
function parseTaskLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·–—>]+|\d+[.)]|\[[ xX]?\]|[☐☑✓✔︎]+)\s*/u, '').trim())
    .filter((l) => l && !/^[-=_*]{3,}$/.test(l)).map((l) => ({ line: l, ...quickAdd(l) })).filter((q) => q.title);
}
function openImport(draft = null) {
  const x = draft || { text: '', due: '', category: '' };
  const items = parseTaskLines(x.text);
  openModal(`
    <h2>⤓ ${esc(t('importTasks'))}</h2>
    ${hint('importHint')}
    <label><textarea name="text" rows="7" placeholder="${esc(t('importPh'))}" aria-label="${esc(t('importTasks'))}">${esc(x.text)}</textarea></label>
    <label>${esc(t('due'))}<input type="date" name="due" value="${esc(x.due || '')}"></label>
    <div class="field-label">${esc(t('category'))}</div>${catChips(x.category)}
    ${items.length ? `<div class="field-label">${esc(t('importPreview', items.length))}</div>
    <ul class="list import-list">${items.map((q, i) => `<li><label class="check"><input type="checkbox" name="pick" value="${i}" ${/:$/.test(q.title) ? '' : 'checked'}><span>${impBadge(q) ? `${impBadge(q)} ` : ''}${esc(q.title)}<small>${esc([q.minutes ? fmtDur(q.minutes) : '', q.category ? `#${q.category}` : ''].filter(Boolean).join(' · '))}</small></span></label></li>`).join('')}</ul>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok" ${items.length ? '' : 'disabled'}>${esc(t('importN', items.length))}</button>
      <button class="btn" value="preview" formnovalidate>${esc(t('importCheck'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form, action, e) => {
    x.text = form.text.value; x.due = form.due.value; x.category = form.category.value;
    if (action === 'preview') { e.preventDefault(); openImport(x); return; }
    const picked = new Set([...form.querySelectorAll('input[name=pick]:checked')].map((el) => Number(el.value)));
    const list = parseTaskLines(x.text).filter((_, i) => picked.has(i));
    let n = 0;
    for (const q of list) {
      upsert('tasks', {
        id: uid(), createdAt: Date.now() + n, title: q.title, minutes: q.minutes || 30, lenSet: Boolean(q.minutes), priority: q.priority, importance: q.importance || 3,
        category: findCategory(q.category) || x.category || null, due: x.due || null, repeat: null, notes: '', done: false,
      }, { silent: true });
      n++;
    }
    toast(t('imported', n));
    changed();
  });
  // The preview follows what you paste or type (after a short pause).
  let tmr = null;
  modal.querySelector('textarea[name=text]').addEventListener('input', (ev) => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { if (!ev.target.isConnected || !modal.open) return; const f = ev.target.form; openImport({ text: f.text.value, due: f.due.value, category: f.category.value }); const ta = modal.querySelector('textarea[name=text]'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 600);
  });
}

// A searchable list of tasks to pick from: to-dos by when they're due, then saved tasks and small steps.
function taskPickList(selected = null) {
  const td = today();
  const done = new Set(alreadyPlanned().map((x) => x.id));
  const g = groupTasks(openTasks().filter((x) => !done.has(x.id)), td);
  const item = (x) => `<button type="button" class="tp-item${x.id === selected ? ' on' : ''}" data-tp="${esc(x.id)}" data-q="${esc(fold(x.title))}" ${done.has(x.id) ? `data-planned="${esc(plannedWhen(x))}"` : ''} style="--c:${esc(catColor(x.category) || 'var(--accent)')}">
      <span class="tp-dot"></span><span class="tp-text"><span>${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}</span><small>${esc([fmtDur(x.minutes || 30), x.due ? (x.due < td ? t('late') : relDay(x.due)) : '', x.helper ? t('stepLabel') : '', x.routine ? t('savedLabel') : '', done.has(x.id) ? `📅 ${plannedWhen(x)}` : ''].filter(Boolean).join(' · '))}</small></span></button>`;
  const groups = [
    ...['overdue', 'today', 'upcoming', 'anytime'].map((k) => [t(`grp_${k}`), sortTasks(g[k], td)]),
    [t('savedTasks'), savedTasks().filter((x) => !x.meal)],
    [t('preparations'), live('tasks').filter((x) => x.helper && !x.check)],
    [t('grp_planned'), sortTasks(alreadyPlanned(), td), true],
  ].filter(([, l]) => l.length);
  return `${searchBox({ cls: 'tp-q' })}
    <div class="tp-list">${groups.map(([label, l, planned]) => `<div class="tp-grp${planned ? ' planned' : ''}"><div class="tp-h">${esc(label)} <small>${l.length}</small></div>${planned ? `<p class="hint tp-note">${esc(t('plannedNote'))}</p>` : ''}${l.map(item).join('')}</div>`).join('')}</div>`;
}
function wirePicker(root, onPick) {
  const q = root.querySelector('.tp-q');
  q?.addEventListener('input', () => {
    const v = fold(q.value.trim());
    for (const el of root.querySelectorAll('.tp-item')) el.hidden = Boolean(v) && !el.dataset.q.includes(v);
    for (const gEl of root.querySelectorAll('.tp-grp')) gEl.hidden = ![...gEl.querySelectorAll('.tp-item')].some((el) => !el.hidden);
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tp]');
    if (!b) return;
    ev.preventDefault();
    // Already on the plan: only on purpose.
    if (b.dataset.planned && !confirm(t('planAgain', b.dataset.planned))) return;
    onPick(b.dataset.tp);
  });
}
// "+ Add → Task": an existing task (or a new one) on this day, at a time you confirm.
function openTaskAdd(date) {
  openModal(`
    <h2>✓ ${esc(t('addTaskTitle', relDay(date)))}</h2>
    <div class="row tight"><input name="newTask" placeholder="${esc(t('addTaskNewPh'))}" autocomplete="off"><button class="btn primary" value="new">+</button></div>
    <div class="field-label">${esc(t('orPickTask'))}</div>
    <div class="task-pick open">${taskPickList()}</div>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (action !== 'new') return;
    e.preventDefault();
    const q = quickAdd(form.newTask.value);
    if (!q.title) return;
    const x = applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...quickFields(q), due: q.due || null }, { silent: true }));
    openPlanSaved(x, date);
  });
  wirePicker(modal, (id) => openPlanSaved(get('tasks', id), date));
}

// "+ Add": things you put on the plan by hand.
function openAddMenu() {
  const date = currentDate();
  const opt = (v, icon, label, hint) => `<button class="add-opt" value="${v}" formnovalidate><span class="add-ico">${icon}</span><span class="item-text">${esc(label)}<small>${esc(hint)}</small></span></button>`;
  openModal(`
    <h2>${esc(t('addMenuTitle', relDay(date)))}</h2>
    <div class="add-opts">
      ${opt('task', '✓', t('addTaskOpt'), t('addTaskHint'))}
      ${opt('event', '📅', t('eventOpt'), t('addEventHint'))}
      ${opt('saved', '★', t('fromSaved'), t('addSavedHint'))}
      ${opt('meal', '🍽', t('meal'), t('addMealHint'))}
      ${advancedOn() ? opt('templates', '▦', t('templates'), t('addTplHint')) : ''}
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    setTimeout(() => {
      if (action === 'saved') openSavedPicker(date);
      if (action === 'task') openTaskAdd(date);
      if (action === 'meal') { ui.mealDate = date; openMeal(null); }
      if (action === 'templates') openTemplatesMenu();
      if (action === 'event') {
        const s = planSettings();
        const from = date === today() ? nowMinutes() : 9 * 60;
        openTask(null, null, { event: true, date, start: freeSlot(busyOn(date), 60, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? from });
      }
    }, 0);
  });
}

function openSavedPicker(date) {
  const groups = savedGroups();
  openModal(`
    <h2>${esc(t('pickSaved'))}</h2>
    <p class="hint">${esc(fmtDay(date))}</p>
    ${groups.length ? groups.map(([cat, list]) => `<div class="sub">${esc(cat ? catName(cat) : t('noCategory'))}</div>
      <ul class="list saved-pick">${list.map((x) => `<li><button class="task-main" value="pick:${esc(x.id)}" formnovalidate><span class="item-text">${x.meal ? '🍽 ' : ''}${esc(x.title)}<small>${esc(savedInfo(x))}</small></span></button></li>`).join('')}</ul>`).join('')
    : `${hint('noSaved')}`}
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (!action.startsWith('pick:')) return;
    e.preventDefault();
    const x = get('tasks', action.slice(5));
    if (x.meal) { ui.mealDate = date; openMeal(null, { kind: 'meal', date, typeId: x.id, start: savedStart(x, date), minutes: x.minutes || 45, recipes: [], people: 2, notes: '' }); return; }
    openPlanSaved(x, date);
  });
}
function openPlanSaved(x, date) {
  openModal(`
    <h2>${esc(t('planSaved', x.title))}</h2>
    ${(x.steps || []).length ? `<p class="hint">▤ ${esc(x.steps.map((y) => `${y.title} ${fmtDur(y.minutes)}`).join(' → '))}</p>` : ''}
    <div class="three">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(date)}"></label>
      <label>${esc(anchorTitle(x) ? t('anchorAt', anchorTitle(x)) : t('start'))}<input name="start" ${TIME24} required value="${fmtTime(savedStart(x, date) + anchorOffset(null, x))}"></label>
      <label>${esc(t('duration'))}${durField('minutes', x.minutes || 30)}</label>
    </div>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('planIt'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form) => {
    const d = form.date.value || date;
    const shown = parseTime(form.start.value);
    const b = planTask(x, d, shown != null ? Math.max(0, shown - anchorOffset(null, x)) : null, { minutes: readDur(form, 'minutes', x.minutes || 30) });
    toast(t('plannedToast', relDay(d), fmtTime(b.start)));
    if (d !== currentDate()) location.hash = `#/plan/${d}`;
    changed();
    warnConflicts(get('blocks', b.id));
  });
  // A different day can mean a different free slot.
  modal.querySelector('input[name=date]').addEventListener('change', (ev) => {
    if (isDate(ev.target.value)) ev.target.form.start.value = fmtTime(savedStart(x, ev.target.value) + anchorOffset(null, x));
  });
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
    ${hint('missingHint')}
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
  if (!g && shopsList().length) {
    const { blocks } = planGroceryTrips({ meal, newId });
    g = blocks.filter((x) => x.date < meal.date || (x.date === meal.date && x.start < meal.start)).pop() || blocks[0] || null;
  }
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
  return findConflicts([...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)], {
    getBlock: (id) => get('blocks', id), getTask: (id) => get('tasks', id),
    blocksOfTask: (id) => live('blocks').filter((b) => b.taskId === id && b.kind !== 'prep' && !outcomeOf(b)),
  });
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
  if (c.type === 'after') return t('cf_after', a?.title, b?.title, relDay(b?.date), fmtTime((b?.start || 0) + (b?.minutes || 0)));
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
  } else if (c.type === 'after') {
    // Move it to the first free time after the task it needs.
    const [b, pre] = c.ids.map((id) => get('blocks', id));
    let done = false;
    for (let i = 0; i < 21 && !done; i++) {
      const d = addDays(pre.date, i);
      const from = Math.max(i ? s.dayStart : pre.start + pre.minutes, d === today() ? nowMinutes() : 0);
      const at = freeSlot(busyOn(d).filter((x) => x.id !== b.id && !x.allowOverlap), b.minutes, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap });
      if (at != null) { followParent(upsert('blocks', { ...b, date: d, start: at, auto: false }, { silent: true })); toast(t('movedTo', b.title, `${relDay(d)} ${fmtTime(at)}`)); done = true; }
    }
    if (!done) { toast(t('noRoom')); return; }
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
  ensureAllSeries();
  render();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2500);
  scheduleTravelRefresh();
}

async function runSync() {
  if (!isConfigured()) { updateSyncBadge(); return; }
  updateSyncBadge(true);
  const planChanged = Object.keys(state.meta.dirtyShards || {}).some((k) => k.startsWith('blocks/'));
  await syncNow();
  // Plan changed and Google Calendar is set up: push it there soon (at most every 10 minutes).
  if (planChanged && !state.meta.lastError && get('gcal', 'status') && Date.now() - (ui.lastDispatch || 0) > 600_000) gcalNow(true);
  if (ricetteConfigured()) kitchen.ensureLowItems();
  migrateBlocksToEvents();
  ensureAllSeries();
  updateSyncBadge();
  renderIfSafe();
  scheduleTravelRefresh();
  if (state.meta.dirty) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 2500); }
}

// Number of things still to buy, on the Shopping tab.
function updateShopCount() {
  const el = $('#shop-count');
  if (!el) return;
  const n = live(SH()).filter((i) => !i.checked).length;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
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

const VIEWS = ['day', 'week', 'month'];
function currentView() { const v = ui.view || state.settings.defaultView || 'day'; return VIEWS.includes(v) ? v : 'day'; }
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

// ---------- Today: the home tab ----------
// "What do I do now?" first: the next move with its leave and start times. Then the day, what is
// pressing, and the week at a glance.
function todayItems(date) {
  return [...blocksOn(date).filter((b) => b.kind !== 'prep' || !b.parentId), ...timedEventsOn(date)].sort((a, b) => a.start - b.start);
}
function pressingTasks() {
  const td = today(); const soon = addDays(td, 3);
  const planned = plannedTaskIds();
  return openTasks().filter((x) => !planned.has(x.id) && !x.travelRole && (
    (x.due && x.due < td) || (x.due && x.due <= soon) || taskIssues(x).length))
    .sort((a, b) => {
      const ka = a.due && a.due < td ? 0 : a.due ? 1 : 2; const kb = b.due && b.due < td ? 0 : b.due ? 1 : 2;
      return ka - kb || (a.due || '').localeCompare(b.due || '') || importanceOf(b) - importanceOf(a);
    }).slice(0, 6);
}
// ---------- Events: the second tab ----------
// Things with a fixed date — yours and the ones imported from Google Calendar — nearest first, with
// how ready each one is (the tasks attached to it). Past events fold away at the bottom.
function eventItems() {
  const own = ownEvents().map((x) => ({ id: x.id, own: true, title: x.title, date: eventDate(x), start: eventStart(x), minutes: ownMinutes(x), allDay: Boolean(x.allDay), place: x.place || '', category: x.category, repeat: x.repeat, done: Boolean(x.done), task: x }));
  // A recurring event shows once per coming occurrence.
  const occ = [];
  for (const e of own) {
    if (!e.task.repeat || e.allDay) { occ.push(e); continue; }
    const blocks = seriesBlocks(e.id).filter((b) => b.date >= today()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    if (!blocks.length) occ.push(e);
    for (const b of blocks) occ.push({ ...e, date: b.date, start: b.start + anchorOffset(b), blockId: b.id, done: Boolean(outcomeOf(b)) });
  }
  const imported = state.settings.showEvents === false ? [] : live('events').map((e) => ({ id: e.id, own: false, title: e.title, date: e.date, start: e.allDay ? null : e.start, minutes: e.minutes || 0, allDay: Boolean(e.allDay), place: e.location || '', color: e.color, calendar: e.calendar, event: e }));
  return [...occ, ...imported].filter((e) => e.date).sort((a, b) => (a.date === b.date ? (a.start ?? -1) - (b.start ?? -1) : a.date < b.date ? -1 : 1));
}
function viewEvents() {
  const td = today();
  const q = (ui.eventQ || '').trim();
  const hit = (e) => !q || matchesQ(fold([e.title, e.place, e.calendar || ''].join(' ')), q);
  const all = eventItems().filter(hit);
  const upcoming = all.filter((e) => e.date >= td);
  const past = all.filter((e) => e.date < td).reverse().slice(0, 30);
  const monthOf = (d) => fmtDay(d, { month: 'long', year: parseDate(d).getFullYear() !== parseDate(td).getFullYear() ? 'numeric' : undefined });
  const row = (e) => {
    const ready = readinessText(e.id);
    const r = ready ? eventReadiness(e.id) : null;
    const when = e.allDay ? t('allDay') : e.start != null ? (e.minutes ? range(e.start, e.minutes) : fmtTime(e.start)) : t('timeTbd');
    const bits = [fmtDay(e.date, { weekday: 'short' }), when, e.place ? `📍 ${e.place}` : '', e.own && e.repeat ? `↻ ${repeatText(e.task)}` : '', !e.own ? e.calendar : ''].filter(Boolean);
    const color = e.own ? catColor(e.category) || 'var(--accent)' : e.color || '#6b7280';
    return `<li class="ev-row${e.own ? '' : ' imported'}${e.date === td ? ' is-today' : ''}${e.done ? ' done' : ''}" style="--c:${esc(color)}">
      <button class="ev-main" type="button" data-action="event-open" data-id="${esc(e.id)}">
        <span class="ev-date"><b>${parseDate(e.date).getDate()}</b><small>${esc(fmtDay(e.date, { month: 'short' }))}</small></span>
        <span class="item-text">${esc(e.title)}<small>${esc(bits.join(' · '))}</small>${ready ? `<small class="ev-ready${r && !r.open ? ' ok' : r && r.late ? ' late' : ''}">${esc(ready)}</small>` : ''}</span>
      </button>
    </li>`;
  };
  const groups = [];
  for (const e of upcoming) {
    const k = e.date.slice(0, 7);
    if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, monthOf(e.date), []]);
    groups[groups.length - 1][2].push(e);
  }
  return `
  <form id="event-add" class="row">
    <input id="event-input" name="title" autocomplete="off" placeholder="${esc(t('addEventPh'))}">
    <button class="btn primary">${esc(t('add'))}</button>
  </form>
  ${hint('eventQuickHint')}
  <div class="task-tools">${searchBox({ id: 'event-q', value: ui.eventQ || '', ph: t('searchEvents') })}</div>
  ${upcoming.length ? groups.map(([k, label, list]) => `<section class="ev-month"><h2 class="part-h">${esc(label)} <small>${list.length}</small></h2><ul class="list events">${list.map(row).join('')}</ul></section>`).join('')
    : `<p class="empty">${esc(q ? t('noMatch') : t('noEvents'))}</p>`}
  ${past.length ? `<details class="ev-past"><summary>${esc(t('pastEvents'))} <small>${past.length}</small></summary><ul class="list events">${past.map(row).join('')}</ul></details>` : ''}`;
}

function viewToday() {
  const td = today(); const now = nowMinutes();
  prepareDays([td]);
  morningReflow();
  const items = todayItems(td);
  const totals = dayTotals(blocksOn(td));
  const open = items.filter((b) => !b.isEvent && !outcomeOf(b));
  const upcoming = items.filter((b) => b.isEvent || !outcomeOf(b)); // blocks and appointments alike, in time order
  const current = upcoming.find((b) => b.start <= now && b.start + b.minutes > now);
  const next = upcoming.find((b) => b.start > now);
  // The card: your own block that is running, or one you must leave for within 15 minutes (even during
  // an appointment); else whatever is on now, else the next thing of the day.
  const curBlock = open.find((b) => b.start <= now && b.start + b.minutes > now);
  const nextBlock = open.find((b) => b.start > now);
  const card = curBlock || (nextBlock && nextBlock.start - now <= 15 ? nextBlock : null) || current || next;
  const lg = card && !card.isEvent ? legTimes(card) : null;
  const task = card && !card.isEvent && card.taskId ? get('tasks', card.taskId) : null;
  const until = next ? next.start - now : null;
  const place = task?.place || '';
  let nowCard = '';
  if (card) {
    const started = card.start <= now;
    const inMin = card.start - now;
    const status = started ? t('untilTime', fmtTime(card.start + card.minutes)) : inMin <= 0 ? t('nowLabel') : lg && lg.trip > 0 ? t('leaveIn', fmtDur(inMin)) : t('startsIn', fmtDur(inMin));
    const legDone = lg && card.stepState?.[lg.step.id] === 'done';
    const main = card.isEvent ? '' : `<div class="now-actions">
        ${lg && lg.trip > 0 && !legDone && now < lg.start ? `<button class="btn primary" type="button" data-action="now-left" data-id="${esc(card.id)}" data-step="${esc(lg.step.id)}">${esc(t('leftNow'))}</button>` : `<button class="btn primary" type="button" data-action="now-done" data-id="${esc(card.id)}">${esc(t('markDone'))}</button>`}
        <button class="btn" type="button" data-action="now-move" data-id="${esc(card.id)}">${esc(t('move'))}</button>
        ${place ? `<a class="btn icon-btn" href="${esc(mapsHref(task))}" target="_blank" rel="noopener" aria-label="${esc(t('openMaps'))}">📍</a>` : ''}
      </div>`;
    nowCard = `<section class="now-card${started ? ' live' : ''}" aria-label="${esc(t('nextMove'))}">
      <div class="now-head"><span>${esc(started ? t('inProgress') : t('nextMove'))}</span><b class="${inMin <= 15 && !started ? 'soon' : ''}">${esc(status)}</b></div>
      <div class="now-main">
        ${lg && lg.trip > 0 ? `<div class="now-time"><b class="leave">${fmtTime(lg.leave)}</b><small>${esc(t('leaveWord'))}</small></div><span class="now-arrow" aria-hidden="true">→</span><div class="now-time"><b>${fmtTime(lg.start)}</b><small>${esc(t('startWord'))}</small></div>` : `<div class="now-time"><b>${fmtTime(card.start)}</b><small>${esc(t('startWord'))}</small></div>`}
        <div class="now-text"><div class="now-title">${task?.event ? '📅 ' : ''}${esc(card.title)}</div><small>${esc([place, lg && lg.trip > 0 ? `${MODE_ICON[lg.step.mode] || '🚌'} ${fmtDur(lg.trip)}` : '', t('untilTime', fmtTime(card.start + card.minutes)), task?.event ? readinessText(task.id) : ''].filter(Boolean).join(' · '))}</small></div>
      </div>
      ${main}
    </section>`;
  } else nowCard = `<section class="now-card empty"><div class="now-head"><span>${esc(t('nextMove'))}</span></div><p>${esc(open.length || items.length ? t('dayDone') : t('nothingToday'))}</p><div class="now-actions"><a class="btn" href="#/plan">${esc(t('openPlanner'))}</a></div></section>`;
  const row = (b) => {
    const st = outcomeOf(b); const lgb = b.isEvent ? null : legTimes(b);
    const cls = b === card ? ' current' : st ? ` ${st}` : b.start + b.minutes <= now ? ' past' : '';
    const evb = !b.isEvent && b.taskId && get('tasks', b.taskId)?.event;
    const inner = `<span class="td-time${lgb && lgb.trip > 0 ? ' leave' : ''}">${fmtTime(b.start)}</span><span class="td-title">${evb ? '📅 ' : ''}${esc(b.title)}${lgb && lgb.trip > 0 ? ` <small>· ${esc(t('startWord'))} ${fmtTime(lgb.start)}</small>` : ''}${b.seriesId ? ' <span class="series-ico">↻</span>' : ''}</span><small class="td-meta">${esc(b.isEvent ? b.calendar || t('calendar') : st === 'done' ? t('doneLabel') : st === 'failed' ? t('couldnt') : fmtDur(b.minutes))}</small>`;
    return b.isEvent ? `<button class="td-row event${cls}" type="button" data-action="event" data-id="${esc(b.id)}" style="--c:${esc(b.color || '#6b7280')}">${inner}</button>`
      : `<button class="td-row${cls}" type="button" data-action="open-block" data-id="${esc(b.id)}" style="--c:${esc(catColor(b.category) || 'var(--accent)')}">${inner}</button>`;
  };
  const gap = next ? Math.floor((next.start - Math.max(now, current ? current.start + current.minutes : now)) / 5) * 5 : (now < planSettings().dayEnd ? planSettings().dayEnd - now : 0);
  const spareLine = `<button class="td-spare" type="button" data-action="spare">⏱ ${esc(!current && gap >= 15 ? (next ? t('freeUntil', fmtDur(Math.min(gap, 240)), fmtTime(next.start)) : t('freeNow', fmtDur(Math.min(gap, 240)))) : t('haveTime'))}</button>`;
  const pressing = pressingTasks();
  const pr = (x) => {
    const late = x.due && x.due < td; const iss = taskIssues(x);
    const why = late ? t('dueLate', relDay(x.due)) : x.due ? t('dueOn', relDay(x.due)) : issueText(x);
    return `<div class="pr-row"><span class="pr-dot ${late ? 'late' : x.due ? 'soon' : 'fix'}"></span><button class="pr-text" type="button" data-action="edit-task" data-id="${esc(x.id)}"><span>${esc(x.title)}</span><small>${esc([why, fmtDur(x.minutes || 30)].join(' · '))}</small></button>
      ${iss.length && !late ? `<button class="btn small" type="button" data-action="task-fix" data-id="${esc(x.id)}" data-sec="${ISSUE_SEC[iss[0]]}">${esc(t('fix'))}</button>` : `<button class="btn small primary-ghost" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${td}">${esc(t('today'))}</button>`}</div>`;
  };
  const ws = weekStart(td);
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return `
  <div class="today">
    <div class="today-head"><h1>${esc(fmtDay(td))}</h1><small>${esc(totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned'))}${items.filter((b) => b.isEvent).length ? ` · ${esc(t('nEvents', items.filter((b) => b.isEvent).length))}` : ''}</small></div>
    ${eventsOn(td).filter((e) => e.allDay).length ? `<div class="today-allday">${eventsOn(td).filter((e) => e.allDay).map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">📅 ${esc(e.title)}</button>`).join('')}</div>` : ''}
    ${ui.reflow ? `<div class="reflow"><span>${esc(t('reflowMoved', ui.reflow.moved))}</span><button class="linkish" type="button" data-action="reflow-undo">${esc(t('undo'))}</button><button class="icon" type="button" data-action="reflow-ok" aria-label="${esc(t('close'))}">✕</button></div>` : ''}
    ${nowCard}
    <section class="today-list" aria-label="${esc(t('today'))}">
      ${items.length ? items.map(row).join('') : `<p class="empty">${esc(t('emptyDay'))}</p>`}
      ${spareLine}
    </section>
    ${pressing.length ? `<section class="pressing" aria-label="${esc(t('pressing'))}">
      <div class="sec-head"><h2>${esc(t('pressing'))}</h2><a href="#/tasks">${esc(t('allTasks'))} ›</a></div>
      ${pressing.map(pr).join('')}
    </section>` : ''}
    <section class="week-strip" aria-label="${esc(t('thisWeek'))}">
      ${week.map((d) => `<a href="#/plan/${d}" class="${d === td ? 'today' : ''}"><span>${esc(fmtDay(d, { weekday: 'short' }))}</span>${loadBar(d, { text: false })}</a>`).join('')}
    </section>
  </div>`;
}
// Once a day, the first time Today opens: what was left undone on earlier days goes back on the
// plan over the coming week, and a line says so, with Undo. Series occurrences are left alone.
let reflowing = false;
function morningReflow() {
  const td = today();
  if (reflowing || state.settings.lastReflow === td) return;
  reflowing = true;
  try {
    const left = live('blocks').filter((b) => b.date < td && b.taskId && !outcomeOf(b) && !b.seriesId && b.kind !== 'prep' && !b.stepId
      && get('tasks', b.taskId) && !get('tasks', b.taskId).done && isTodo(get('tasks', b.taskId)));
    saveSettings({ lastReflow: td });
    if (!left.length) return;
    const removed = left.map((b) => ({ ...b }));
    for (const b of left) remove('blocks', b.id);
    const ids = [...new Set(left.map((b) => b.taskId))];
    const days = Array.from({ length: 7 }, (_, i) => addDays(td, i));
    const added = [];
    for (const p of planPlacements(ids, days)) {
      const task = get('tasks', p.taskId); if (!task) continue;
      const b = planTask(task, p.date, p.start, { minutes: p.minutes });
      added.push(b.id);
    }
    ui.reflow = { moved: ids.length, removed, added };
    setTimeout(changed, 0);
  } finally { reflowing = false; }
}
function undoReflow() {
  const r = ui.reflow; if (!r) return;
  for (const id of r.added) remove('blocks', id);
  for (const b of r.removed) upsert('blocks', b, { silent: true });
  ui.reflow = null;
  toast(t('undone'));
  changed();
}
// Where the planner would put these tasks over these days (no previews involved).
function planPlacements(ids, dates) {
  const s = planSettings(); const td = today(); const now = nowMinutes();
  const tasks = ids.map((id) => get('tasks', id)).filter(Boolean);
  const { items } = planningItems(tasks, dates);
  const leadOfItem = (it) => (it.stepId && !(it.prep || []).length ? 0 : leadOf(get('tasks', it.taskId)));
  const dayInfo = (d) => ({ date: d, blocks: busyOn(d).filter((b) => !b.allowOverlap), from: Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((now + 5) / 5) * 5 : 0), to: autoHoursFor(d)[1] });
  return spreadTasks({ tasks: items, days: dates.map(dayInfo), settings: s, leadOf: leadOfItem }).placed;
}
function mapsHref(task) {
  if (!task) return '#';
  if (task.link) return task.link;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.place || '')}`;
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
  const showToday = v === 'day' ? date !== td : v === 'week' ? weekStart(date) !== weekStart(td) : date.slice(0, 7) !== td.slice(0, 7);
  // One drawer of tasks to plan sits under every view; "Plan" runs the guided flow.
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  const head = `
  <div class="plan-top">
    <div class="view-switch" role="tablist">${VIEWS.map((k) => `<button type="button" role="tab" class="${k === v ? 'on' : ''}" data-action="view" data-id="${k}" aria-selected="${k === v}">${esc(t(`v_${k}`))}</button>`).join('')}</div>
    ${v === 'day' ? `<button class="steps-switch" type="button" role="switch" data-action="toggle-steps" aria-checked="${showSteps()}" aria-pressed="${showSteps()}" title="${esc(t(showSteps() ? 'hideSteps' : 'showSteps'))}"><span class="sw" aria-hidden="true"></span>${esc(t('steps'))}</button>` : ''}
  </div>
  <div class="day-head">
    <a class="round" href="#/plan/${prev}" aria-label="${esc(t('previous'))}">‹</a>
    <button class="day-title" type="button" data-action="pick-date">
      <span class="day-name">${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
    </button>
    <a class="round" href="#/plan/${next}" aria-label="${esc(t('next'))}">›</a>
    <input type="date" id="day-picker" value="${date}" tabindex="-1" aria-hidden="true">
    ${v === 'day' ? loadBar(date) : ''}
  </div>
  <div class="day-actions">
    ${showToday ? `<a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a>` : ''}
    <button class="btn small primary" type="button" data-action="auto">✦ ${esc(t('planBtn'))}</button>
    <button class="btn small" type="button" data-action="add-menu">＋ ${esc(t('addMenu'))}</button>
  </div>`;
  const main = v === 'week' ? viewWeek(date) : v === 'month' ? viewMonth(date) : viewDay(date);
  return `${head}<section class="plan-main">${main}</section>${trayHtml()}`;
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

function stepCheck(b, y) {
  const st = y.state || (outcomeOf(b) === 'done' ? 'done' : null);
  return `<input type="checkbox" data-action="step-done" data-block="${esc(b.id)}" data-step="${esc(y.id)}" ${st === 'done' ? 'checked' : ''} aria-label="${esc(y.title)}">`;
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
  const { startMin, endMin, hours } = timelineRange([...blocks, ...events, ...ghostsOn(date)]);
  const inConflict = new Set(conflictsOn(date).flatMap((c) => c.ids));
  const laid = layoutBlocks([...blocks, ...events]);
  const isToday = date === td;


  return `
      ${conflictBanner(date)}
      ${allDay.length ? `<div class="allday">${allDay.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>` : ''}
      <div class="timeline" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${date}" style="height:${(endMin - startMin) * PPM}px">
        ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"><span>${fmtTime(m)}</span></div>`).join('')}
        ${isToday ? '<div class="now" id="now-line" hidden></div>' : ''}
        ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id)))).join('')}
        ${ghostsOn(date).map((g) => assignGhostHtml(g, startMin)).join('')}
        ${blocks.length || events.length ? '' : `<div class="tl-empty">${esc(t('emptyDay'))}</div>`}
      </div>`;
}

// Week: seven day columns side by side. Blocks can be dragged within a day and across days.
function viewWeek(date) {
  const td = today();
  const s = state.settings;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  prepareDays(days.filter((d) => d >= td).length ? days : [days[0]]);
  const all = days.flatMap((d) => [...blocksOn(d), ...timedEventsOn(d), ...ghostsOn(d)]);
  const { startMin, endMin, hours } = timelineRange(all);
  const h = (endMin - startMin) * PPM;
  const allDay = days.map((d) => eventsOn(d).filter((e) => e.allDay));
  const wd = (d) => fmtDay(d, { weekday: 'short' });
  return `
  <div class="week">
    <div class="week-head"><div class="wk-gutter"></div>
      ${days.map((d) => `<button type="button" class="wk-day${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-action="${selecting() ? 'assign-range' : 'view-day'}" data-id="${d}" data-drop="${d}"><span>${esc(wd(d))}</span><b>${parseDate(d).getDate()}</b>${loadBar(d)}</button>`).join('')}
    </div>
    ${allDay.some((x) => x.length) ? `<div class="week-allday"><div class="wk-gutter"></div>${allDay.map((list) => `<div>${list.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>` : ''}
    <div class="week-body">
      <div class="wk-hours" style="height:${h}px">${hours.map((m) => `<span style="top:${(m - startMin) * PPM}px">${fmtTime(m)}</span>`).join('')}</div>
      ${days.map((d) => {
    const inConflict = new Set(conflictsOn(d).flatMap((c) => c.ids));
    const laid = layoutBlocks([...blocksOn(d), ...timedEventsOn(d)]);
    return `<div class="timeline wk-col${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${d}" style="height:${h}px">
          ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"></div>`).join('')}
          ${d === td ? '<div class="now" id="now-line" hidden></div>' : ''}
          ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id), true))).join('')}
          ${ghostsOn(d).map((g) => assignGhostHtml(g, startMin)).join('')}
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
    const gh = ghostsOn(d);
    return `<button type="button" class="m-cell${d.slice(0, 7) !== month ? ' other' : ''}${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-action="${selecting() ? 'assign-range' : 'view-day'}" data-id="${d}" data-drop="${d}">
        <span class="m-num">${parseDate(d).getDate()}${conflict ? ' <span class="warn-ico">⚠</span>' : ''}</span>
        ${loadBar(d, { text: false })}
        ${gh.map((g) => `<span class="m-item ghost" title="${esc(ghostTip(g))}">${esc(ghostTitle(g))}</span>`).join('')}
        ${items.slice(0, 3).map((x) => `<span class="m-item${outcomeOf(x) ? ' done' : ''}" style="--c:${esc(x.isEvent || x.allDay ? x.color : catColor(x.category) || 'var(--accent)')}">${x.allDay ? '' : `<i>${fmtTime(x.start)}</i> `}${esc(x.title)}</span>`).join('')}
        ${items.length > 3 ? `<span class="m-more">${esc(t('nMore', items.length - 3))}</span>` : ''}
      </button>`;
  }).join('')}</div>
  </div>`;
}

// List: the next seven days as an agenda. What each row shows at a glance is set in Settings;
// tap a row to see the rest (notes, checklist, recipes) and act on it.
// Importance at a glance: !!! very high, !! high, ↓ low; nothing for normal.
function impBadge(x) {
  const n = importanceOf(x);
  if (n === 3) return '';
  return n > 3 ? `<span class="prio" title="${esc(t(`imp_${n}`))}">${'!'.repeat(n - 2)}</span>` : `<span class="prio low" title="${esc(t(`imp_${n}`))}">↓</span>`;
}
// Steps on the plan: listed (default) or folded into their task. Toggled from the plan.
function showSteps() { return state.settings.showSteps !== false; }

const GLANCE = ['time', 'duration', 'category', 'due', 'priority', 'checklist', 'prep', 'recipes', 'location', 'notes'];
const GLANCE_DEFAULT = ['time', 'duration', 'category', 'due', 'checklist', 'recipes', 'location'];
function glance() { return new Set(state.settings.glance || GLANCE_DEFAULT); }


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
  if (g.has('priority') && task && impBadge(task)) bits.push(impBadge(task));
  const st = stepTimes(x);
  if (st.length && !showSteps()) bits.push(`▤ ${st.filter((y) => y.state === 'done' || (outcomeOf(x) === 'done')).length}/${st.length}`);
  const items = checklistOf(x);
  if (g.has('checklist') && items.length) bits.push(`☑ ${items.length - checklistLeft(items, x.checked)}/${items.length}`);
  if (g.has('prep') && x.parentId) { const p = get('blocks', x.parentId); if (p) bits.push(`↳ ${esc(t('forParent', p.title))}`); }
  if (g.has('recipes') && x.kind === 'meal') { const n = mealRecipes(x).length; if (n) bits.push(`🍽 ${esc(t('nRecipes', n))}`); }
  if (g.has('location') && task?.place) bits.push(`📍 ${esc(task.place)}`);
  if (g.has('notes') && x.notes) bits.push(`<span class="ag-note">${esc(x.notes.slice(0, 60))}</span>`);
  if (x.outcome === 'failed') bits.push(`<span class="late">${esc(t('couldnt'))}</span>`);
  return bits;
}

const KIND_ICON = { prep: '↳ ', meal: '🍽 ', groceries: '🛒 ', followup: '↪ ' };


function blockHtml(b, startMin, conflict, compact = false) {
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
  const st = stepTimes(b);
  // Steps fit beside the title when the block is a single column and tall enough; otherwise a count.
  const stepsIn = st.length && showSteps() && b.cols === 1 && !compact && b.minutes >= 30;
  if (st.length && !stepsIn && status !== 'failed') extra += `<span class="mini-badge">▤ ${status === 'done' ? st.length : st.filter((y) => y.state === 'done').length}/${st.length}</span>`;
  const stepsHtml = stepsIn ? `<div class="blk-steps">${st.map((y, i) => {
    const hpx = (y.end - y.start) * PPM;
    return `<div class="blk-step${i ? '' : ' first'}${hpx < 16 ? ' tight' : ''}${y.state ? ` ${y.state}` : status === 'done' ? ' done' : ''}" style="top:${(y.start - b.start) * PPM}px;height:${hpx}px">
      ${hpx >= 11 ? `${stepCheck(b, y)}<span class="st-title${y.travel && !y.known ? ' unknown' : ''}">${y.travel ? `${MODE_ICON[y.mode] || '🚌'} ` : ''}${y.travel && !y.known ? '? ' : ''}${esc(y.title)}</span><span class="st-time">${fmtTime(y.start)}</span>` : ''}</div>`;
  }).join('')}</div>` : '';
  const isEv = Boolean(b.taskId && get('tasks', b.taskId)?.event);
  return `<div class="block${stepsIn ? ' with-steps' : ''}${status ? ` ${status}` : ''}${status === 'failed' ? ' done' : ''}${short ? ' short' : ''}${conflict ? ' conflict' : ''}${b.kind ? ` k-${b.kind}` : ''}${isEv ? ' own-event' : ''}" data-id="${esc(b.id)}" data-start="${b.start}" data-minutes="${b.minutes}"
    style="--c:${esc(color)};top:${(b.start - startMin) * PPM}px;height:${Math.max(b.minutes * PPM, 16)}px;left:${left};width:${width}">
    <input type="checkbox" class="blk-check" data-action="block-done" data-id="${esc(b.id)}" ${status === 'done' ? 'checked' : ''} aria-label="${esc(t('markDone'))}">
    <div class="blk-body">
      <div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${KIND_ICON[b.kind] || ''}${isEv ? '📅 ' : ''}${esc(b.title)}${b.seriesId ? ' <span class="series-ico" title="' + esc(t('recurring')) + '">↻</span>' : ''} ${extra}</div>
      <div class="blk-time">${esc(blockTimeText(b))}</div>
    </div>
    ${stepsHtml}
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

// An imported (Google Calendar) event: read-only, but tasks can be attached to it like to your own.
function openEvent(e) {
  const list = eventTasksOf(e.id);
  openModal(`
    <h2>${esc(e.title)}</h2>
    <p class="hint"><span class="cat" style="--c:${esc(e.color)}">${esc(e.calendar)}</span> · ${esc(fmtDay(e.date))}${e.allDay ? '' : ` · ${range(e.start, e.minutes)}`}</p>
    ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    ${hint('eventReadOnly')}
    <div class="field-label">✓ ${esc(t('secEventTasks'))}${list.length ? ` <small>${esc(readinessText(e.id))}</small>` : ''}</div>
    ${list.length ? `<ul class="list ev-tasks">${list.map((y) => { const nb = nextPlanned(y.id); return `<li class="${y.done ? 'done' : ''}"><button class="task-main" value="ev-task:${esc(y.id)}" formnovalidate><span class="item-text">${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc([offsetText(y.eventOffset), y.due ? relDay(y.due) : ''].filter(Boolean).join(' · '))}</small><small class="${y.done ? '' : nb ? 'ok' : 'warn'}">${esc(y.done ? t('doneLabel') : nb ? t('plannedAt', relDay(nb.date), fmtTime(nb.start)) : t('toPlanLabel'))}</small></span></button></li>`; }).join('')}</ul>` : ''}
    <div class="button-row left">
      <button class="btn small" value="add-task" formnovalidate>+ ${esc(t('addEventTask'))}</button>
      ${list.some((y) => !y.done && !nextPlanned(y.id)) ? `<button class="btn small primary-ghost" value="plan-tasks" formnovalidate>✦ ${esc(t('planThese'))}</button>` : ''}
    </div>
    <div class="button-row">
      ${e.link ? `<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(t('openInGoogle'))}</a>` : ''}
      <button class="btn" value="cancel">${esc(t('close'))}</button>
    </div>`, (form, action) => {
    if (action === 'add-task') setTimeout(() => openEventTaskAdd(e, { back: true }), 0);
    if (action === 'plan-tasks') { planEventTasks(e); setTimeout(() => openEvent(get('events', e.id)), 0); }
    if (action.startsWith('ev-task:')) setTimeout(() => openTask(get('tasks', action.slice(8))), 0);
  });
}


// ---------- meals: the meal dialog and the recipe picker ----------

// "Can I cook it?" exactly as Ricette answers it (salt, pepper, oil and water count as always there).
const coverage = (r, people) => pantryCoverage(r, live('r_pantry'), { servings: people || r.servings || 2 });
const tagDefs = () => live('r_tagdefs');
const pinnedTags = () => { const v = get('r_prefs', 'pinnedTags')?.value; return Array.isArray(v) ? v : []; };
const tagName = (tg) => tagLabel(tg, tagDefs(), (id) => t(`tag_${id}`));
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
    ? { ...block, typeId: block.taskId || types.find((tp) => block.title?.startsWith(tp.title))?.id || types[0].id, recipes: mealRecipes(block).map((r) => ({ ...r })), people: block.servings || mealRecipes(block)[0]?.servings || 2, stepMinutes: { ...(block.stepMinutes || {}) } }
    : (() => {
      const now = nowMinutes(); const date = ui.mealDate || currentDate();
      // The next meal of the day by default.
      const tp = (date === today() && types.find((y) => (y.defaultStart ?? 0) > now)) || types.find((y) => y.id === 'meal_dinner') || types[0];
      return { kind: 'meal', date, typeId: tp.id, start: tp.defaultStart ?? 1170, minutes: tp.minutes || 45, recipes: [], people: 2, notes: '' };
    })());
  const type = get('tasks', x.typeId) || types[0];
  // A meal type split into steps: you set when you eat (or whichever step its usual time refers
  // to); the steps before it, prep from the recipes among them, are laid out backwards from there.
  const steps = (type.steps || []).filter((y) => y.title);
  x.stepMinutes = x.stepMinutes || {};
  if (steps.length && x.anchorAt == null) {
    const ai = anchorIndex(steps, type.anchorStepId);
    if (block && block.taskId === type.id) {
      const st = stepTimes(block);
      x.anchorAt = ai < st.length ? st[ai].start : block.start + block.minutes;
    } else x.anchorAt = type.defaultStart ?? x.start ?? 1170;
  }
  const plan = steps.length ? mealPlan(x, type) : null;
  // A step's own length for this meal: empty means automatic (from the recipes, or its usual length).
  const readStepOwn = (f) => {
    for (const el of f.querySelectorAll('[data-sm]')) {
      const m = readDur(f, `sm_${el.dataset.sm}`, null);
      if (m) x.stepMinutes[el.dataset.sm] = m; else delete x.stepMinutes[el.dataset.sm];
    }
  };
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
    ${plan ? `
    <div class="two">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(x.date)}"></label>
      <label>${esc(plan.anchorTitle ? t('anchorAt', plan.anchorTitle) : t('endsAt'))}<input name="start" ${TIME24} required value="${fmtTime(x.anchorAt)}"></label>
    </div>` : `
    <div class="three">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(x.date)}"></label>
      <label>${esc(t('start'))}<input name="start" ${TIME24} required value="${fmtTime(x.start)}"></label>
      <label>${esc(t('duration'))}${durField('minutes', x.minutes)}</label>
    </div>`}
    <label>${esc(t('servings'))}<input name="people" type="number" min="1" max="30" step="1" value="${esc(x.people)}"></label>
    <div class="field-label">${esc(t('recipesInMeal'))}</div>
    ${rows ? `<ul class="meal-recipes">${rows}</ul>` : `<p class="hint">${esc(ricetteConfigured() ? t('noRecipeYet') : t('ricetteNeeded'))}</p>`}
    ${ricetteConfigured() ? `<button class="btn add-recipe" value="pick" formnovalidate>＋ ${esc(t('addRecipe'))}</button>` : ''}
    ${plan ? mealStepsHtml(plan, block) : stepsSection(block)}
    <button class="btn small edit-task" value="edit-type" formnovalidate>▤ ${esc(t('editTaskSteps', type.title))}</button>
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
      if (plan) {
        x.anchorAt = parseTime(form.start.value) ?? x.anchorAt;
        readStepOwn(form);
      } else {
        x.start = parseTime(form.start.value) ?? x.start;
        x.minutes = readDur(form, 'minutes', x.minutes);
      }
      x.people = Math.max(1, Number(form.people.value) || 2);
      x.notes = form.notes.value.trim();
      x.recipes = x.recipes.map((r) => ({ ...r, servings: x.people }));
    };
    collect();
    if (block && stepAction(block, action, e, (nb) => openMeal(nb))) return;
    if (action === 'edit-type') { setTimeout(() => openTask(get('tasks', x.typeId)), 0); return; }
    if (action === 'delete') { deleteBlock(block); changed(); return; }
    if (action === 'pick') {
      e.preventDefault();
      openPicker({
        people: x.people, selected: x.recipes.map((r) => r.recipeId),
        onDone: (ids) => {
          x.recipes = ids.map((id) => ({ recipeId: id, servings: x.people }));
          // A meal takes at least as long as its longest recipe (with steps, the prep step follows the recipes).
          const longest = Math.max(0, ...ids.map((id) => minutesOf(recipeOf(id)) || 0));
          if (!plan && longest > x.minutes) x.minutes = Math.ceil(longest / 5) * 5;
          openMeal(block, x);
        },
        onBack: () => openMeal(block, x),
      });
      return;
    }
    if (action.startsWith('rm-rec:')) { e.preventDefault(); x.recipes.splice(Number(action.slice(7)), 1); openMeal(block, x); return; }
    const tp = get('tasks', x.typeId);
    const before = JSON.stringify(mealRecipes(block || {}));
    if ((tp.steps || []).some((y) => y.title)) {
      const p = mealPlan(x, tp);
      x.start = Math.max(0, x.anchorAt - p.before);
      x.minutes = p.total;
    }
    const { typeId, people, anchorAt, ...rest } = x;
    void typeId; void anchorAt;
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
  if (block) wireSteps(block, (nb) => openMeal(nb));
  // Picking a type moves a new meal to that type's usual time (and its steps); changing a step's
  // length or the time updates the steps' times.
  modal.querySelector('form').addEventListener('change', (ev) => {
    const f = ev.target.form;
    if (ev.target.name === 'type') {
      x.typeId = ev.target.value;
      const tp = get('tasks', x.typeId);
      x.stepMinutes = {};
      if (isNew) { x.anchorAt = null; x.start = tp?.defaultStart ?? x.start; x.minutes = Math.max(tp?.minutes || 30, ...x.recipes.map((r) => minutesOf(recipeOf(r.recipeId)) || 0)); }
      else if (x.anchorAt == null && f.start) x.anchorAt = parseTime(f.start.value);
      x.date = f.date.value || x.date; x.people = Math.max(1, Number(f.people.value) || 2); x.notes = f.notes.value.trim();
      openMeal(block, x);
      return;
    }
    if (plan && (ev.target.closest('[data-sm]') || ev.target.name === 'start')) {
      x.anchorAt = parseTime(f.start.value) ?? x.anchorAt;
      readStepOwn(f);
      x.date = f.date.value || x.date; x.people = Math.max(1, Number(f.people.value) || 2); x.notes = f.notes.value.trim();
      openMeal(block, x);
    }
  });
}

// A meal's steps laid out around the time its usual time refers to: what each takes and why.
function mealPlan(x, type) {
  const steps = (type.steps || []).filter((y) => y.title);
  const fake = { kind: 'meal', recipes: x.recipes, stepMinutes: x.stepMinutes || {} };
  const recs = x.recipes.map((r) => recipeOf(r.recipeId)).filter(Boolean);
  const auto = (y) => stepLen({ ...fake, stepMinutes: {} }, y);
  const rows = steps.map((y) => ({ ...y, len: stepLen(fake, y), auto: auto(y), own: Boolean(fake.stepMinutes[y.id]) }));
  const ai = anchorIndex(steps, type.anchorStepId);
  const before = rows.slice(0, ai).reduce((n, y) => n + y.len, 0);
  let at = (x.anchorAt ?? 0) - before;
  for (const y of rows) { y.start = at; at += y.len; }
  const timed = recs.filter((r) => timeParts(r.time)?.active);
  const waiting = recs.reduce((n, r) => n + (timeParts(r.time)?.waiting || 0), 0);
  return {
    steps: rows, before, total: rows.reduce((n, y) => n + y.len, 0), start: (x.anchorAt ?? 0) - before,
    anchorTitle: ai < steps.length ? steps[ai].title : null,
    source: timed.length ? (recs.length > 1 ? t('prepFromMany', timed.map((r) => r.title).join(', ')) : t('prepFrom', timed[0].title)) : recs.length ? t('prepNoTime') : t('prepNoRecipe'),
    waiting,
  };
}
function mealStepsHtml(plan, block) {
  const st = block ? Object.fromEntries(stepTimes(block).map((y) => [y.id, y.state])) : {};
  const whole = block && outcomeOf(block) === 'done';
  return `<div class="field-label">▤ ${esc(t('steps'))} <small>${esc(range(plan.start, plan.total))}</small></div>
    <ul class="meal-steps">${plan.steps.map((y) => `<li class="${st[y.id] || (whole ? 'done' : '')}">
      ${block ? `<input type="checkbox" data-sstep="${esc(y.id)}" ${st[y.id] === 'done' || whole ? 'checked' : ''} aria-label="${esc(y.title)}">` : ''}
      <span class="ms-time">${fmtTime(y.start)}</span>
      <span class="ms-title">${esc(y.title)}${y.from === 'recipes' ? `<small>${esc(y.own ? t('ownLength') : plan.source)}</small>` : ''}${st[y.id] === 'failed' ? `<small class="late">${esc(t('couldnt'))}</small>` : ''}</span>
      <span data-sm="${esc(y.id)}">${durField(`sm_${y.id}`, y.own ? y.len : 0, { placeholder: `${y.auto}${y.from === 'recipes' ? ' ⟲' : ''}` })}</span>
    </li>`).join('')}</ul>
    ${plan.waiting ? `<p class="hint">⏳ ${esc(t('waitingNotCounted', fmtDur(plan.waiting)))}</p>` : ''}`;
}

// The recipe picker: a full sheet with photos, search, folders, tags and quick filters.
// Tap cards to select one or more recipes; ⓘ shows the recipe with what's in the pantry.
function openPicker({ people = 2, selected = [], onDone, onBack }) {
  const st = { q: '', folder: '', tags: new Set(), canCook: false, quick: false, sort: 'name', sel: [...selected], preview: null };
  const folders = live('r_folders');
  const defs = tagDefs();
  const all = recipes();
  const tree = folderTree(folders);
  const fname = (id) => tree.find((f) => f.id === id)?.name || '';
  const tags = tagCounts(all, defs, pinnedTags());
  const unfiled = all.some((r) => !folderOfRecipe(r, folders));
  const canCook = (r) => coverage(r, people).missing.length === 0;

  const list = () => filterRecipes(all, { q: st.q, folder: st.folder, tags: st.tags, canCook: st.canCook ? canCook : null, maxMinutes: st.quick ? 30 : null, sort: st.sort },
    { folders, defs, label: tagName });
  const card = (r) => {
    const on = st.sel.includes(r.id);
    const miss = coverage(r, people).missing.length;
    const m = minutesOf(r);
    const folder = fname(folderOfRecipe(r, folders));
    return `<div class="pk-card${on ? ' on' : ''}">
      <button class="pk-pick" value="tog:${esc(r.id)}" formnovalidate aria-pressed="${on}">
        <span class="pk-photo">${coverOf(r) ? photoTag(coverOf(r)) : ''}<span class="pk-letter">${esc((r.title || '?').charAt(0))}</span>
          <span class="stock ${miss ? 'miss' : 'ok'}">${miss ? esc(t('nMissing', miss)) : `✓ ${esc(t('inPantryShort'))}`}</span>
          <span class="pk-tick">${on ? st.sel.indexOf(r.id) + 1 : ''}</span></span>
        <span class="pk-body"><b>${esc(r.title)}</b>
          <small>${[m ? `⏱ ${fmtDur(m)}` : '', folder ? `📁 ${folder}` : ''].filter(Boolean).map(esc).join(' · ')}</small>
          ${tagsOf(r, defs).length ? `<span class="card-tags">${tagsOf(r, defs).slice(0, 3).map((x) => `<span>${esc(tagName(x))}</span>`).join('')}</span>` : ''}</span>
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
      <div class="pills">${pill('cook', `✓ ${t('canCookNow')}`, st.canCook)}${pill('quick', `⏱ ${t('underMin', 30)}`, st.quick)}${pill('sort', st.sort === 'cooked' ? `↕ ${t('sortCooked')}` : `↕ ${t('sortAZ')}`, st.sort === 'cooked')}</div>
      ${tags.length ? `<div class="pills">${tags.map((x) => pill(`tag:${x.tag}`, `${x.pinned ? '📌 ' : ''}${tagName(x.tag)}`, st.tags.has(x.tag))).join('')}</div>` : ''}
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
      <p class="hint">${[m ? `⏱ ${fmtDur(m)}` : '', t('forPeople', people), fname(folderOfRecipe(r, folders)) ? `📁 ${fname(folderOfRecipe(r, folders))}` : '', ...tagsOf(r, defs).map(tagName)].filter(Boolean).map(esc).join(' · ')}</p>
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
    else if (action === 'sort') st.sort = st.sort === 'cooked' ? 'name' : 'cooked';
    const scroll = modal.querySelector('form')?.scrollTop;
    draw();
    if (scroll) modal.querySelector('form').scrollTop = scroll;
  }
  draw();
}

// ---------- view: shopping list ----------
// With Ricette connected this is Ricette's own shopping list (same file, same rules: merge items,
// departments, drag to order, tick at the shop, put away in the pantry), so groceries from meals
// and "running low" items are there by themselves, and anything you add here shows up in Ricette
// too. Without Ricette it's Everyday's own list. Household and personal-care items get departments
// of their own here.

const SH = () => (ricetteConfigured() ? 'r_shopping' : 'shopping');
const K = () => (ricetteConfigured() ? kitchen : kitchenOwn);
// List settings shared with Ricette (data/prefs.json) when connected, else kept on this device.
function shopPref(id, fallback) {
  if (ricetteConfigured()) { const p = get('r_prefs', id); return p && p.value !== undefined ? p.value : fallback; }
  const v = state.settings[`shop_${id}`];
  return v === undefined ? fallback : v;
}
function setShopPref(id, value) {
  if (ricetteConfigured()) upsert('r_prefs', { id, value }, { silent: true });
  else saveSettings({ [`shop_${id}`]: value });
}

// The views (shoplist.js, shared with Ricette): dept / recipe / plain are saved in Ricette's prefs;
// shop / alpha / newest / oldest on this device.
function listModes() { return availableModes(shopsList().length > 0); }
function listMode() { return currentMode({ local: state.settings.shopMode, shared: shopPref('listMode', 'dept'), hasShops: shopsList().length > 0 }); }
function setListMode(m) {
  const to = saveModeTarget(m);
  saveSettings({ shopMode: to.local });
  if (to.shared) setShopPref('listMode', to.shared);
}
function itemMatches(i, q) { return itemMatchesQ(i, q, (i.shops || []).map(shopName).filter(Boolean)); }

// ---------- shops ----------
// Shops live with the shopping list: in Ricette's repo (data/shops.json) once it's connected.
function SHOPS() { return ricetteConfigured() ? 'r_shops' : 'shops'; }
function shopsList() { return live(SHOPS()).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.name || '').localeCompare(b.name || '')); }
function shopName(id) { return get(SHOPS(), id)?.name || ''; }
function tripMode() { return get('config', 'shopping')?.value?.tripMode || 'perShop'; }
function tripTitle(ids) {
  const names = (ids || []).map(shopName).filter(Boolean);
  if (!names.length) return t('groceryTitle');
  return names.length === 1 ? `${t('groceryTitle')} · ${names[0]}` : `${t('groceryTitle')}: ${names.join(' → ')}`;
}
// The hours the planner may use on a day (Settings → Planner): weekdays and weekends apart.
function autoHoursFor(date) {
  const h = state.settings.autoHours || {};
  const we = [0, 6].includes(parseDate(date).getDay());
  const [f, to] = (we ? h.we : h.wd) || (we ? [600, 1200] : [540, 1200]);
  return [f, Math.max(to, f + 30)];
}
// Plan the grocery trips for what's on the list: which shop gets each item (as few shops as possible),
// then a time for each trip (or one trip for all, Settings → Shops), inside opening hours. Before
// `meal` when given (as late as possible, so things are fresh), otherwise as soon as possible.
// Earlier automatic trips that haven't happened yet are replaced; ones you moved by hand are kept.
function planGroceryTrips({ meal = null, newId = null } = {}) {
  const td = today(); const now = nowMinutes();
  const items = live(SH()).filter((i) => !i.checked);
  if (!items.length) return { blocks: [], missing: [] };
  const shops = shopsList();
  const byShop = assignItems(items, shops);
  const kept = live('blocks').filter((b) => b.kind === 'groceries' && !outcomeOf(b) && b.date >= td && !b.auto);
  for (const b of live('blocks').filter((x) => x.kind === 'groceries' && !outcomeOf(x) && x.date >= td && x.auto && x.shops)) remove('blocks', b.id);
  const keptShops = new Set(kept.flatMap((b) => b.shops || []));
  const shopIds = byShop ? [...byShop.keys()].filter((id) => !keptShops.has(id)) : ['_any'];
  if (!shopIds.length) return { blocks: [], missing: [] };
  const list = byShop ? shops : [{ id: '_any', name: t('groceryTitle'), minutes: GROCERY_MINUTES }];
  const lastDay = meal ? meal.date : addDays(td, 13);
  const days = []; for (let d = td; d <= lastDay; d = addDays(d, 1)) days.push(d);
  const trips = planTrips({
    shopIds, shops: list, mode: tripMode(), days, snap: planSettings().snap,
    busyOn: (d) => busyOn(d).filter((b) => !b.allowOverlap && !outcomeOf(b)),
    from: { date: td, minute: now + 5 }, deadline: meal ? { date: meal.date, minute: meal.start - 15 } : null, hours: autoHoursFor,
  });
  const blocks = []; const missing = [];
  trips.forEach((tr, n) => {
    if (!tr.date) { missing.push(...tr.shopIds); return; }
    blocks.push(newBlock({
      ...(newId && n === 0 ? { id: newId } : {}), date: tr.date, start: tr.start, minutes: tr.minutes, kind: 'groceries',
      title: byShop ? tripTitle(tr.shopIds) : t('groceryTitle'), shops: byShop ? tr.shopIds : null, category: 'meals', auto: true,
    }));
  });
  return { blocks, missing };
}
// What to buy on this trip: the items whose shop (as assigned now) is on it; all of them for a trip without shops.
function tripItems(b) {
  const all = live(SH());
  if (!b?.shops?.length) return all;
  const byShop = assignItems(all, shopsList()) || new Map();
  const ids = new Set(b.shops.flatMap((id) => (byShop.get(id) || []).map((i) => i.id)));
  return all.filter((i) => ids.has(i.id) || (i.checked && shopsFor(i, shopsList()).some((id) => b.shops.includes(id))));
}
function openShopRec(shop = null) {
  const x = shop ? { ...shop, hours: (shop.hours || []).map((w) => ({ ...w })) } : { name: '', minutes: 30, hours: [], place: '', link: '' };
  const draw = () => openModal(`
    <h2>🏪 ${esc(shop ? x.name : t('newShop'))}</h2>
    <label>${esc(t('name'))}<input name="name" required value="${esc(x.name)}" autocomplete="off"></label>
    <label>${esc(t('shopVisit'))}${durField('minutes', x.minutes || 30)}</label>
    <div class="field-label">🕒 ${esc(t('openingHours'))}</div>
    ${windowsEditor('w_', x.hours)}
    ${hint('openingHoursHint')}
    <label>${esc(t('place'))}<input name="place" value="${esc(x.place || '')}" autocomplete="off"></label>
    <label>${esc(t('placeLink'))}<input name="link" type="url" value="${esc(x.link || '')}" autocomplete="off"></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${shop ? `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>` : ''}
    </div>`, (form, action, e) => {
    x.name = form.elements.namedItem('name').value.trim();
    x.minutes = readDur(form, 'minutes', 30);
    x.hours = readWindows(form, 'w_', x.hours.length);
    x.place = form.place.value.trim(); x.link = form.link.value.trim();
    const wm = action.match(/^w_(add|rm:(\d+))$/);
    if (wm) { e.preventDefault(); if (wm[1] === 'add') x.hours.push({ days: x.hours.length ? [6] : [1, 2, 3, 4, 5], from: 480, to: 1200 }); else x.hours.splice(Number(wm[2]), 1); draw(); return; }
    if (action === 'delete') { if (confirm(t('confirmDeleteShop'))) remove(SHOPS(), shop.id); render(); return; }
    if (!x.name) { e.preventDefault(); return; }
    upsert(SHOPS(), { ...(shop || {}), id: shop?.id || uid(), name: x.name, minutes: x.minutes, hours: cleanWindows(x.hours), place: x.place, link: x.link, order: shop?.order ?? shopsList().length }, { silent: true });
    changed();
    render();
  });
  draw();
}
function deptOrder() { return byOrder(DEPT_IDS, shopPref('deptOrder', [])); }
function shopDept(i) {
  if (i.cat && DEPT_IDS.includes(i.cat)) return i.cat;
  const p = ricetteConfigured() && ((i.pantryId && get('r_pantry', i.pantryId)) || K().findPantry(i.name));
  return p && p.cat && DEPT_IDS.includes(p.cat) ? p.cat : deptOf(i);
}
const isFood = (i) => !NONFOOD.includes(shopDept(i));

function recipeGroupLabel(k) { return k === '__pantry' ? `🔁 ${t('restock')}` : k === '__other' ? `🧺 ${t('otherItems')}` : `🍽 ${k}`; }

// Open items as the list shows them: [[groupKey, label, items]].
function listGroups(open, mode = listMode()) {
  const groups = groupItems(open, mode, { deptOf: shopDept, deptOrder: deptOrder(), recipeOrder: shopPref('recipeOrder', []), shops: shopsList(), lang: getLang() });
  const label = (g) => (g.kind === 'all' ? '' : g.kind === 'recipe' ? recipeGroupLabel(g.key) : g.kind === 'shop' ? `🏪 ${shopName(g.key)}` : g.kind === 'anyShop' ? `🛒 ${t('anyShop')}` : `${deptIcon(g.key)} ${t(`dept_${g.key}`)}`);
  return groups.map((g) => [g.key, label(g), g.items]);
}

const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const grip = (id, label) => `<button type="button" class="drag-handle" id="${esc(id)}" aria-label="${esc(t('dragToMove', label))}">${GRIP}</button>`;

// The shops an item names (live ones), for its row.
function itemShops(i) { return (i.shops || []).map(shopName).filter(Boolean).join(', '); }
function shopRow(i, { drag = false, showSource = true, showShops = true, added = false } = {}) {
  const src = i.auto ? `<span class="badge warn">${esc(t('runningLow'))}</span>`
    : showSource && (i.sources || []).length ? `<small>${esc(i.sources.join(', '))}</small>` : '';
  return `<li class="${i.checked ? 'checked' : ''}" ${drag ? `data-sort-key="${esc(i.id)}"` : ''}>
    ${drag ? grip(`h-${i.id}`, i.name) : ''}
    <input type="checkbox" data-action="shop-toggle" data-id="${esc(i.id)}" ${i.checked ? 'checked' : ''} aria-label="${esc(i.name)}">
    <button type="button" class="shop-main" data-action="shop-edit" data-id="${esc(i.id)}">
      <span class="item-text"><span class="q">${esc(qtyText(i.qty, i.unit))}</span> ${esc(i.name)}${i.note ? ` <small class="inline">(${esc(i.note)})</small>` : ''} ${src}${showShops && itemShops(i) ? ` <small class="item-shops">🏪 ${esc(itemShops(i))}</small>` : ''}${added && addedOf(i) ? ` <small class="item-shops">＋ ${esc(relDay(today(new Date(addedOf(i)))))}</small>` : ''}</span>
    </button>
    <button class="icon" type="button" data-action="shop-del" data-id="${esc(i.id)}" aria-label="${esc(t('remove'))}">×</button>
  </li>`;
}

function viewShop() {
  const q = (ui.shopQ || '').trim();
  const items = live(SH()).filter((i) => !q || itemMatches(i, q));
  const mode = listMode();
  const open = items.filter((i) => !i.checked);
  const dated = mode === 'newest' || mode === 'oldest';
  const canDrag = !q && DRAG_MODES.includes(mode);
  const done = items.filter((i) => i.checked).sort(byItemOrder);
  const groups = listGroups(open, mode);
  const grouped = GROUPED_MODES.includes(mode);
  const body = grouped
    ? `<div class="groups" ${canDrag ? `data-sortable="groups" data-group="${mode}"` : ''}>${groups.map(([k, label, list]) => `
      <section class="grp" data-sort-key="${esc(k)}">
        <h3 class="dept-h">${canDrag && k !== '__any' ? grip(`g-${mode}-${k}`, label) : ''}<span>${esc(label)}</span><small>${list.length}</small></h3>
        <ul class="list shop" ${canDrag ? `data-sortable="items" data-group="${esc(k)}"` : ''}>${list.map((i) => shopRow(i, { drag: canDrag, showSource: mode !== 'recipe', showShops: mode !== 'shop' })).join('')}</ul>
      </section>`).join('')}</div>`
    : `<ul class="list shop" ${canDrag ? 'data-sortable="items" data-group="all"' : ''}>${(groups[0]?.[2] || []).map((i) => shopRow(i, { drag: canDrag, added: dated })).join('')}</ul>`;
  const food = done.filter(isFood).length;
  return `
  <p class="hint">${esc(ricetteConfigured() ? t('shopFromRicette') : t('shopOwn'))}</p>
  ${ricetteConfigured()
    ? `<p class="sync-line"><span class="ok-dot"></span>${esc(state.meta.ricetteSynced ? t('ricetteSyncedAt', new Date(state.meta.ricetteSynced).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', hour12: false })) : t('ricetteNotYet'))} <button class="linkish" type="button" data-action="sync-now">↻ ${esc(t('syncNow'))}</button></p>`
    : `<p class="sync-line"><a href="#/settings">${esc(t('connectRicette'))}</a></p>`}
  <form id="shop-add" class="row">
    <input name="item" id="shop-add-input" required placeholder="${esc(t('shopAddPh'))}" autocomplete="off">
    <button class="btn primary" aria-label="${esc(t('add'))}">+</button>
  </form>
  <div class="task-tools shop-tools">${searchBox({ id: 'shop-q', value: ui.shopQ || '', ph: t('searchItems') })}
    <label class="sort-pick">⇅ <select id="shop-sort" aria-label="${esc(t('listView'))}">${listModes().map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${esc(t(`listMode_${m}`))}</option>`).join('')}</select></label></div>
  ${open.length ? `${body}
    <p class="hint">${canDrag ? `${esc(t(grouped ? 'dragHintGroups' : 'dragHintItems'))} ` : ''}${esc(t('tapItemHint'))}</p>
    <div class="button-row">
      <button class="btn primary" type="button" data-action="plan-trips">🛒 ${esc(t('planTrips'))}</button>
      <button class="btn" type="button" data-action="shop-share">${esc(t('shareList'))}</button>
    </div>
    <p class="hint">${esc(shopsList().length ? t(tripMode() === 'oneTrip' ? 'planTripsHintOne' : 'planTripsHintPer') : t('planTripsHintNoShops'))}</p>` : q ? '' : `<p class="empty">${esc(t('listEmpty'))}</p>`}
  ${q && !items.length ? `<p class="empty">${esc(t('noItemMatch'))}</p>` : ''}
  ${done.length ? `<h2>${esc(t('inCart'))} <small>${done.length}</small></h2><ul class="list shop done">${done.map((i) => shopRow(i)).join('')}</ul>
    <div class="button-row">
      <button class="btn primary" type="button" data-action="shop-putaway">📦 ${esc(ricetteConfigured() && food ? t('putAway') : t('doneShopping'))}</button>
      ${ricetteConfigured() ? `<button class="btn" type="button" data-action="shop-clear">${esc(t('clearChecked'))}</button>` : ''}
    </div>
    ${ricetteConfigured() ? `${hint('putAwayFood')}` : ''}` : ''}`;
}

function shopAdd(text) {
  const ing = parseIngredient(text);
  if (!ing.name) return;
  K().addToShopping({ name: ing.name, qty: ing.qty, unit: ing.unit, note: ing.note }, '');
  // Give it its department straight away (so Everyday's household/personal-care ones stick).
  const it = live(SH()).filter((x) => !x.checked && namesMatch(x.name, ing.name)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if (it && !it.cat) upsert(SH(), { ...it, cat: deptOf(it) }, { silent: true });
}

function openShopItem(it, draft = null) {
  const units = ['', 'g', 'kg', 'ml', 'l', 'pcs', 'packet', 'can', 'tbsp', 'tsp', 'bunch', 'slice'];
  if (it.unit && !units.includes(it.unit)) units.push(it.unit);
  // What's typed so far (kept when a new shop is added from here).
  const x = draft || { name: it.name, qty: it.qty ?? '', unit: it.unit || '', cat: shopDept(it), note: it.note || '', shops: [...(it.shops || [])] };
  const dept = x.cat;
  openModal(`
    <h2>${esc(it.name)}</h2>
    <label>${esc(t('name'))}<input name="name" required value="${esc(x.name)}" autocomplete="off"></label>
    <div class="two">
      <label>${esc(t('quantity'))}<input name="qty" inputmode="decimal" value="${esc(x.qty ?? '')}"></label>
      <label>${esc(t('unit'))}<select name="unit">${units.map((u) => `<option value="${esc(u)}" ${u === (x.unit || '') ? 'selected' : ''}>${esc(u || '—')}</option>`).join('')}</select></label>
    </div>
    <label>${esc(t('department'))}<select name="cat">${DEPTS.map((d) => `<option value="${d.id}" ${d.id === dept ? 'selected' : ''}>${d.icon} ${esc(t(`dept_${d.id}`))}</option>`).join('')}</select></label>
    <label>${esc(t('notes'))}<input name="note" value="${esc(x.note || '')}" autocomplete="off"></label>
    <div class="field-label">🏪 ${esc(t('whichShops'))}</div>
    ${shopsList().length ? `<div class="days shops-pick">${shopsList().map((sh) => `<label class="day-pill"><input type="checkbox" name="shops" value="${esc(sh.id)}" ${x.shops.includes(sh.id) ? 'checked' : ''}><span>${esc(sh.name)}</span></label>`).join('')}</div>` : ''}
    <div class="row tight"><input name="newShop" placeholder="${esc(t('newShopPh'))}" autocomplete="off" aria-label="${esc(t('newShop'))}"><button class="btn small" value="shop-add" formnovalidate>+ ${esc(t('newShop'))}</button></div>
    <small class="hint">${esc(t(shopsList().length ? 'whichShopsHint' : 'noShopsYet'))}</small>
    ${(it.sources || []).length ? `<p class="hint">${esc(t('forRecipes', it.sources.join(', ')))}</p>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      <button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>
    </div>`, (form, action, e) => {
    if (action === 'delete') { remove(SH(), it.id); changed(); return; }
    const picked = [...form.querySelectorAll('input[name=shops]:checked')].map((el) => el.value);
    // A new shop, straight from here: created (always open; hours can be added in Settings) and ticked.
    if (action === 'shop-add') {
      e.preventDefault();
      const name = form.newShop.value.trim();
      if (!name) return;
      const found = shopsList().find((sh) => fold(sh.name) === fold(name));
      const sh = found || upsert(SHOPS(), { id: uid(), name, minutes: 30, hours: [], place: '', link: '', order: shopsList().length }, { silent: true });
      openShopItem(it, { name: form.elements.namedItem('name').value, qty: form.qty.value, unit: form.unit.value, cat: form.cat.value, note: form.note.value, shops: [...new Set([...picked, sh.id])] });
      return;
    }
    const q = form.qty.value.trim().replace(',', '.');
    upsert(SH(), {
      ...get(SH(), it.id), name: form.name.value.trim() || it.name, qty: q === '' ? null : Number(q) || null,
      unit: form.unit.value, cat: form.cat.value, note: form.note.value.trim(),
      shops: picked,
    }, { silent: true });
    changed();
  });
}

// After a drag: save the new order of the items, or of the groups (shared with Ricette).
function onSorted({ kind, group, keys }) {
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

async function shareShopList() {
  const line = (i) => `• ${[qtyText(i.qty, i.unit), i.name].filter(Boolean).join(' ')}`;
  const text = listGroups(live(SH()).filter((i) => !i.checked))
    .map(([, label, items]) => [label, ...items.map(line)].filter(Boolean).join('\n')).join('\n\n');
  if (navigator.share) { try { await navigator.share({ title: t('tabShop'), text }); } catch { /* cancelled */ } return; }
  try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { /* ignore */ }
}

// ---------- view: tasks ----------

// ---------- sorting tasks ----------
// "Smart" = overdue first, then importance, then due date (what the planner also weighs). "Manual" =
// your own order, dragged by hand; the auto-planner takes it into account as a preference.
const TASK_SORTS = ['smart', 'manual', 'due', 'importance', 'length', 'category', 'added'];
function manualOrder() {
  const open = sortTasks(openTasks(), today());
  return open.map((x, i) => ({ x, i })).sort((a, b) => (a.x.order ?? 1e9 + a.i) - (b.x.order ?? 1e9 + b.i)).map((y) => y.x);
}
function sortTaskList(list, mode) {
  const td = today();
  const smart = sortTasks(list, td);
  const pos = new Map(smart.map((x, i) => [x.id, i]));
  const tie = (a, b) => pos.get(a.id) - pos.get(b.id);
  const by = {
    manual: (a, b) => (a.order ?? 1e9 + pos.get(a.id)) - (b.order ?? 1e9 + pos.get(b.id)),
    due: (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || tie(a, b),
    importance: (a, b) => importanceOf(b) - importanceOf(a) || tie(a, b),
    length: (a, b) => (a.minutes || 30) - (b.minutes || 30) || tie(a, b),
    category: (a, b) => (catName(get('categories', a.category)) || '~').localeCompare(catName(get('categories', b.category)) || '~') || tie(a, b),
    added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || tie(a, b),
  }[mode];
  return by ? [...list].sort(by) : smart;
}
// A search field: magnifier in front, ✕ to clear once something is typed (shown by CSS, no redraw needed).
const SEARCH_ICO = '<svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
function searchBox({ id = '', cls = '', value = '', ph = t('searchTasks') } = {}) {
  return `<div class="search-box"${cls ? ` data-for="${cls}"` : ''}>${SEARCH_ICO}<input type="search" ${id ? `id="${id}"` : ''} class="${cls}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="search" aria-label="${esc(ph)}"><button type="button" class="search-clear" aria-label="${esc(t('clearSearch'))}" title="${esc(t('clearSearch'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div>`;
}
function sortPicker(id, mode) {
  return `<label class="sort-pick">⇅ <select id="${id}" aria-label="${esc(t('sortBy'))}">${TASK_SORTS.map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${esc(t(`sort_${m}`))}</option>`).join('')}</select></label>`;
}

// Tasks tab: "To do" (your to-dos, in groups you can fold) and "Saved" (saved tasks, day templates
// and preparations: the things you set up once and reuse).
// Search: case and accents don't matter; every word must appear in the title, notes, place, category, steps,
// checklist or rule names.
function taskHay(x) {
  const cat = get('categories', x.category);
  return fold([x.title, x.notes, x.place, cat ? catName(cat) : '', ...(x.steps || []).map((y) => y.title), ...(x.checklist || []).map((c) => c.text || c.title || c), ...(x.rules || []).map((r) => r.title)].join(' '));
}
// Groups by date in the task list (Settings → Task list): today, tomorrow and "soon" can be switched
// on or off; a group that's off hands its tasks to the next one that's on ("later" is always there).
const DATE_GROUPS = ['today', 'tomorrow', 'soon', 'later'];
function taskGroupsCfg() { return { today: true, tomorrow: false, soon: true, soonDays: 7, ...(state.settings.taskGroups || {}) }; }
function dateBuckets(items, dateOf, td) {
  const cfg = taskGroupsCfg();
  const on = (k) => k === 'later' || cfg[k];
  const out = { overdue: [], today: [], tomorrow: [], soon: [], later: [], nodate: [] };
  const tmr = addDays(td, 1); const soonEnd = addDays(td, Number(cfg.soonDays) || 7);
  for (const x of items) {
    const d = dateOf(x);
    if (!d) { out.nodate.push(x); continue; }
    if (d < td) { out.overdue.push(x); continue; }
    const natural = d === td ? 'today' : d === tmr ? 'tomorrow' : d <= soonEnd ? 'soon' : 'later';
    out[DATE_GROUPS.slice(DATE_GROUPS.indexOf(natural)).find(on)].push(x);
  }
  return out;
}
// Filters for the task lists (Tasks tab, tray, tasks column): to fix = tasks the planner still
// needs details for; recurring; with a place; one category. Kept per device, off by default.
const FILTER_KEYS = ['fix', 'recurring', 'place'];
function taskFilter() { return { fix: false, recurring: false, place: false, cat: '', ...(state.settings.taskFilter || {}) }; }
function filterActive() { const f = taskFilter(); return FILTER_KEYS.some((k) => f[k]) || Boolean(f.cat); }
function passesFilter(x) {
  const f = taskFilter();
  if (f.fix && !taskIssues(x).length) return false;
  if (f.recurring && !(x.repeat)) return false;
  if (f.place && !x.place) return false;
  if (f.cat && (x.category || '') !== f.cat) return false;
  return true;
}
function filterBar() {
  const f = taskFilter();
  const chip = (k, label, on) => `<button type="button" class="fchip${on ? ' on' : ''}" data-action="filter" data-id="${k}" aria-pressed="${on}">${label}</button>`;
  return `<div class="filters" role="group" aria-label="${esc(t('filters'))}">
    ${chip('fix', `⚠ ${esc(t('f_fix'))}`, f.fix)}${chip('recurring', `↻ ${esc(t('f_recurring'))}`, f.recurring)}${chip('place', `📍 ${esc(t('f_place'))}`, f.place)}
    ${categories().map((c) => `<button type="button" class="fchip cat${f.cat === c.id ? ' on' : ''}" data-action="filter-cat" data-id="${esc(c.id)}" style="--c:${esc(c.color)}" aria-pressed="${f.cat === c.id}"><span class="chip-dot"></span>${esc(catName(c))}</button>`).join('')}
    ${filterActive() ? `<button type="button" class="fchip clear" data-action="filter-clear">✕ ${esc(t('clearFilters'))}</button>` : ''}
  </div>`;
}
function folded(key) { return (state.settings.folded ?? ['grp_done']).includes(key); }
function foldBtn(key, label, n, { open = !folded(key) } = {}) {
  return `<button class="fold" type="button" data-action="fold" data-id="${esc(key)}" aria-expanded="${open}"><span class="fold-ico">▸</span> ${esc(label)} <small>${n}</small></button>`;
}
function viewTasks(force = null) {
  const td = today();
  const all = live('tasks');
  const tab = force || ui.tasksTab || state.settings.tasksTab || 'todo'; // the part you used last is remembered
  const q = (ui.taskQ || '').trim();
  const hit = (x) => (!q || matchesQ(taskHay(x), q)) && passesFilter(x);
  const isFolded = (key) => !q && folded(key); // while searching, every group shows its matches
  const search = searchBox({ id: 'task-q', value: ui.taskQ || '' });
  const nShop = live(SH()).filter((i) => !i.checked).length;
  const switcher = `<div class="seg" role="tablist">${['todo', 'saved', 'shop'].map((k) => `<button type="button" role="tab" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}" data-action="tasks-tab" data-id="${k}">${esc(t(`tasksTab_${k}`))}${k === 'shop' && nShop ? ` <small>${nShop > 99 ? '99+' : nShop}</small>` : ''}</button>`).join('')}</div>`;
  if (tab === 'shop') return `${switcher}${viewShop()}`;
  if (tab === 'saved') {
    const helpers = all.filter((x) => x.helper && hit(x)).sort((a, b) => a.title.localeCompare(b.title));
    const tpls = templates().filter((tp) => !q || matchesQ(fold(tp.name), q));
    const groups = savedGroups().map(([cat, list]) => [cat, list.filter(hit)]).filter(([, list]) => list.length);
    const nSaved = groups.reduce((n, [, l]) => n + l.length, 0);
    return `${switcher}
    <div class="task-tools">${search}</div>
    ${filterBar()}
    ${q && !nSaved && !tpls.length && !helpers.length ? `<p class="empty">${esc(t('noMatch'))}</p>` : ''}
    <section class="fold-sec first">
      ${foldBtn('saved', t('savedTasks'), nSaved, { open: !isFolded('saved') })}
      ${isFolded('saved') ? '' : `${hint('savedHint')}
      ${groups.map(([cat, list]) => `<div class="sub">${esc(cat ? catName(cat) : t('noCategory'))}</div>
      <ul class="list saved">${list.map((tp) => `<li><button class="task-main" type="button" data-action="task-edit" data-id="${esc(tp.id)}"><span class="item-text">${tp.meal ? '🍽 ' : ''}${impBadge(tp) ? `${impBadge(tp)} ` : ''}${esc(tp.title)}<small>${esc(savedInfo(tp))}</small></span></button></li>`).join('')}</ul>`).join('')}
      <button class="btn small" type="button" data-action="saved-new">+ ${esc(t('newSaved'))}</button>`}
    </section>
    ${advancedOn() ? `<section class="fold-sec">
      ${foldBtn('templates', t('templates'), tpls.length, { open: !isFolded('templates') })}
      ${isFolded('templates') ? '' : `${hint('templatesHint')}
      <ul class="list">${tpls.map((tp) => `<li><button class="task-main" type="button" data-action="tpl-edit" data-id="${esc(tp.id)}"><span class="item-text">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}${tp.days?.length ? ` · ${esc(t('autoOn', daysLabel(tp.days)))}` : ''}</small></span></button></li>`).join('') || `<li class="pad"><span class="hint">${esc(t('noTemplates'))}</span></li>`}</ul>
      <button class="btn small" type="button" data-action="tpl-new">+ ${esc(t('newTemplate'))}</button>`}
    </section>
    <section class="fold-sec">
      ${foldBtn('preps', t('preparations'), helpers.length, { open: !isFolded('preps') })}
      ${isFolded('preps') ? '' : `${hint('prepsHint')}${helpers.length ? `<ul class="list preps">${helpers.map(prepRow).join('')}</ul>` : `${hint('noPreps')}`}`}
    </section>` : ''}`;
  }
  const g = groupTasks(all.filter((x) => isTodo(x) && hit(x)), td);
  const mode = state.settings.taskSort || 'smart';
  const manual = mode === 'manual' && !q; // no dragging while the list is filtered
  // Two parts: to plan (grouped by due date) and already planned (grouped by the day they're on).
  const openList = [...g.overdue, ...g.today, ...g.upcoming, ...g.anytime];
  const plannedIds = new Set(alreadyPlanned().map((x) => x.id));
  const toPlan = openList.filter((x) => !plannedIds.has(x.id));
  const planned = openList.filter((x) => plannedIds.has(x.id));
  const whenOf = (x) => { const b = nextPlanned(x.id); return b ? b.date + String(b.start).padStart(4, '0') : ''; };
  const byWhen = (list) => (mode === 'smart' || mode === 'due' ? [...list].sort((a, b) => (whenOf(a) < whenOf(b) ? -1 : 1)) : sortTaskList(list, mode));
  const groupLabel = (k) => (k === 'soon' ? t('grp_soonN', Number(taskGroupsCfg().soonDays) || 7) : k === 'nodate' ? t('grp_anytime') : t(`grp_${k}`));
  const section = (key, label, items, sorted) => (items.length ? `<section class="fold-sec grp-sec">${foldBtn(key, label, items.length, { open: !isFolded(key) })}
    ${isFolded(key) ? '' : `<ul class="list tasks${manual ? ' sortable' : ''}" ${manual ? `data-sortable="tasks" data-group="${key}"` : ''}>${sorted.map((x) => taskRow(x, { drag: manual })).join('')}</ul>`}</section>` : '');
  const part = (key, label, items, buckets, sortFn, hint = '') => {
    if (!items.length) return '';
    const open = !isFolded(key);
    return `<section class="task-part">
      <h2 class="part-h">${foldBtn(key, label, items.length, { open })}</h2>
      ${open ? `${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${['overdue', ...DATE_GROUPS, 'nodate'].map((k) => section(`${key}_${k}`, groupLabel(k), buckets[k], sortFn(buckets[k]))).join('')}` : ''}
    </section>`;
  };
  const open = openList.length;
  return `${switcher}
  <form id="task-add" class="row">
    <input id="task-input" name="title" autocomplete="off" placeholder="${esc(t('addTaskPh'))}">
    <button class="btn primary">${esc(t('add'))}</button>
  </form>
  ${hint('quickHint')}
  <div class="task-tools">${search}${sortPicker('task-sort', mode)}<button class="btn small${state.settings.compact ? ' on' : ''}" type="button" data-action="compact" aria-pressed="${Boolean(state.settings.compact)}" title="${esc(t('compactHint'))}">≡ ${esc(t('compact'))}</button><button class="btn small" type="button" data-action="import">⤓ ${esc(t('importTasks'))}</button></div>
  ${filterBar()}
  ${manual && !q ? `${hint('manualHint')}` : ''}
  ${open || g.done.length ? '' : `<p class="empty">${esc(q || filterActive() ? t('noMatch') : t('noTasks'))}</p>`}
  ${part('part_toplan', t('partToPlan'), toPlan, dateBuckets(toPlan, (x) => x.due, td), (l) => sortTaskList(l, mode))}
  ${part('part_planned', t('partPlanned'), planned, dateBuckets(planned, (x) => nextPlanned(x.id)?.date, td), byWhen, t('partPlannedHint'))}
  ${g.done.length ? `<section class="fold-sec grp-sec">${foldBtn('grp_done', t('grp_done'), g.done.length, { open: !isFolded('grp_done') })}
    ${isFolded('grp_done') ? '' : `<ul class="list tasks done">${g.done.slice(0, 50).map(taskRow).join('')}</ul>
    <button class="btn small ghost" type="button" data-action="clear-done">${esc(t('clearDone'))}</button>`}</section>` : ''}`;
}

// Which tasks use a small step (preparation or rule follow-up), and how.
function ownersOf(x) {
  const out = [];
  for (const y of live('tasks')) {
    if (y.id === x.id) continue;
    for (const p of y.prep || []) if (p.taskId === x.id) out.push({ task: y, how: t('ownerPrep', t(`pw_${p.when || 'before'}`)) });
    for (const r of y.rules || []) {
      if (r.taskId !== x.id) continue;
      const step = r.stepId && (y.steps || []).find((z) => z.id === r.stepId);
      out.push({ task: y, how: step ? t('ownerStepRule', step.title, t(`rws_${r.when}`)) : t('ownerRule', t(`rw_${r.when}`)) });
    }
  }
  return out;
}
function prepRow(x) {
  const own = ownersOf(x);
  const bits = [fmtDur(x.minutes || 10)];
  if (x.checklist?.length) bits.push(`☑ ${x.checklist.length}`);
  if (x.steps?.length) bits.push(`▤ ${x.steps.length}`);
  if (x.rules?.length) bits.push(`⚙ ${x.rules.length}`);
  return `<li class="prep-row">
    <button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}"><span class="item-text">↳ ${esc(x.title)}<small>${esc(bits.join(' · '))}</small></span></button>
    <div class="prep-owners">${own.length ? own.map((o) => `<button class="owner" type="button" data-action="task-edit" data-id="${esc(o.task.id)}" title="${esc(t('openTask', o.task.title))}">
      <span class="owner-t">${o.task.meal ? '🍽 ' : o.task.routine ? '★ ' : ''}${esc(o.task.title)} ↗</span><small>${esc(o.how)}</small></button>`).join('')
    : `<span class="hint">${esc(t('prepUnused'))}</span><button class="btn small ghost" type="button" data-action="prep-del" data-id="${esc(x.id)}">${esc(t('delete'))}</button>`}</div>
  </li>`;
}

function taskRow(x, { drag = false } = {}) {
  const td = today();
  const bits = [];
  if (x.helper) {
    const parents = live('tasks').filter((p) => (p.prep || []).some((q) => q.taskId === x.id)).map((p) => p.title);
    if (parents.length) bits.push(esc(t('prepFor', parents.join(', '))));
  }
  if (x.due) bits.push(`<span class="${x.due < td && !x.done ? 'late' : ''}">${esc(relDay(x.due))}</span>`);
  if (x.minutes) bits.push(esc(fmtDur(x.minutes)));
  if (x.repeat === 'times') bits.push(`↻ ${esc(t('timesShort', x.timesN || 1, t(`per_${x.timesPer || 'week'}`)))} · ${timesDone(x, td)}/${x.timesN || 1}`);
  else if (x.repeat) bits.push(`↻ ${esc(repeatText(x))}`);
  if (x.fromTitle) bits.push(`↪ ${esc(t('fromTask', x.fromTitle))}`);
  if (x.eventId && eventOf(x.eventId)) bits.push(`📅 ${esc(eventOf(x.eventId).title)} · ${esc(offsetText(x.eventOffset))}`);
  const pre = prereqsOf(x);
  if (pre.length) bits.push(`🔒 ${esc(t('afterTask', pre.map((p) => p.task.title).join(', ')))}`);
  if (x.windows?.length) bits.push(`🕒 ${esc(windowsText(x.windows))}`);
  if (x.when) bits.push(esc(t(`when_${x.when}`)));
  if (x.checklist?.length) bits.push(`☑ ${x.checklist.length}`);
  if (realSteps(x).length) bits.push(`▤ ${realSteps(x).length}`);
  if (x.place) bits.push(`📍 ${esc(x.place)}`);
  for (const y of (x.steps || []).filter((z) => z.travel && z.lookup !== false)) bits.push(`${MODE_ICON[y.mode] || '🚌'} ${y.known ? esc(fmtDur(y.minutes)) : '?'}`);
  if (bufferOf(x) > 0 && (x.steps || []).some((z) => z.buffer)) bits.push(`⏳ ${esc(fmtDur(bufferOf(x)))}`);
  if (x.prep?.length) bits.push(`↳ ${esc(prepOf(x).map((p) => p.task.title).join(', '))}`);
  const cat = get('categories', x.category);
  if (cat) bits.push(`<span class="cat" style="--c:${esc(cat.color)}">${esc(catName(cat))}</span>`);
  const planned = live('blocks').filter((b) => b.taskId === x.id && !b.done && b.date >= td && b.kind !== 'prep').sort((a, b) => ((a.date + a.start) < (b.date + b.start) ? -1 : 1))[0];
  if (planned && !x.done) bits.push(`<span class="badge">${esc(t('plannedAt', relDay(planned.date), fmtTime(planned.start)))}</span>`);
  return `<li class="imp-${importanceOf(x)}${taskIssues(x).length ? ' has-iss' : ''}" ${drag ? `data-sort-key="${esc(x.id)}"` : ''}>
    ${drag ? grip(`th-${x.id}`, x.title) : ''}
    ${x.helper ? '<span class="helper-dot">↳</span>' : `<input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done || (x.repeat === 'times' && timesDone(x, td) >= (x.timesN || 1)) ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`}
    <button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}">
      <span class="item-text">${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}<small>${bits.join(' · ')}</small></span>
    </button>
    ${issueBadge(x)}
  </li>`;
}

// ---------- view: settings ----------

// Saved tasks that can serve as "Get there" / "Come back" (no meals).
function savedForLegs() { return live('tasks').filter((x) => x.routine && !x.meal && !x.done).sort((a, b) => a.title.localeCompare(b.title)); }
function viewSettings() {
  const s = state.settings;
  const msg = ui.connMsg;
  if (ensureLegTasks()) setTimeout(changed, 0);
  return settingsHtml(s, msg);
}
function settingsHtml(s, msg) {
  const hourOpts = (sel, from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === Number(sel) ? 'selected' : ''}>${fmtTime(h * 60)}</option>`).join('');
  const opts = (vals, sel, label) => vals.map((v) => `<option value="${v}" ${v === Number(sel) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  const card = (title, body, cls = '') => `<section class="set-card ${cls}"><h2>${title}</h2>${body}</section>`;
  // Three cards: my day, travel, connections. The rest folds under "Advanced".
  const dayCard = `
  <form class="form" id="planner-form">
    <div class="two">
      <label>${esc(t('dayStart'))}<select name="dayStart">${hourOpts(s.dayStart, 0, 12)}</select></label>
      <label>${esc(t('dayEnd'))}<select name="dayEnd">${hourOpts(s.dayEnd, 13, 24)}</select></label>
    </div>
    <div class="field-label">✦ ${esc(t('autoHours'))}</div>
    <div class="auto-hours">
      <span>${esc(t('weekdays'))}</span><input name="ahWdF" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-02')[0])}" aria-label="${esc(t('weekdays'))} ${esc(t('from'))}"> – <input name="ahWdT" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-02')[1])}" aria-label="${esc(t('weekdays'))} ${esc(t('to'))}">
      <span>${esc(t('weekend'))}</span><input name="ahWeF" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-07')[0])}" aria-label="${esc(t('weekend'))} ${esc(t('from'))}"> – <input name="ahWeT" ${TIME24} value="${fmtTime(autoHoursFor('2026-11-07')[1])}" aria-label="${esc(t('weekend'))} ${esc(t('to'))}">
    </div>
    <div class="two">
      <label>${esc(t('maxLoad'))}<select name="maxLoad">${opts([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14], s.maxLoad ?? 8, (h) => `${h} h`)}</select></label>
      <label>${esc(t('breathing'))}<select name="taskBuffer">${opts([0, 5, 10, 15, 30], s.taskBuffer ?? 0, (m) => (m ? `${m} min` : t('none')))}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="freeWeekends" ${s.freeWeekends ? 'checked' : ''}> <span>${esc(t('freeWeekends'))}</span></label>
    <label>${esc(t('defaultView'))}<select name="defaultView">${VIEWS.map((v) => `<option value="${v}" ${v === currentViewDefault() ? 'selected' : ''}>${esc(t(`v_${v}`))}</option>`).join('')}</select></label>
  </form>`;
  const travelCard = `
  <form class="form" id="travel-form">
    <label>${esc(t('homeAddress'))}<input name="home" value="${esc(travelCfg().home)}" placeholder="${esc(t('homePh'))}" autocomplete="street-address"></label>
    <div class="two">
      <label>${esc(t('travelModeDefault'))}<select name="mode">${TRAVEL_MODES.map((m) => `<option value="${m}" ${m === travelCfg().mode ? 'selected' : ''}>${MODE_ICON[m]} ${esc(t(`tm_${m}`))}</option>`).join('')}</select></label>
      <label class="check tall"><input type="checkbox" name="startHere" ${travelCfg().startHere ? 'checked' : ''}> <span>${esc(t('startHere'))}${state.settings.here ? `<small>${esc(t('hereSetAt', new Date(state.settings.here.at).toLocaleString(getLang())))}</small>` : ''}</span></label>
    </div>
    <div class="field-label">🧭 ${esc(t('legsTitle'))}</div>
    ${LEGS.map((kind) => { const sel = kind === 'there' ? 'thereDefault' : 'backDefault'; return `
    <div class="leg-line">
      <span class="leg-name">${esc(t(kind === 'there' ? 'legBefore' : 'legAfter'))}</span>
      <select name="leg_${kind}" aria-label="${esc(t('legTask'))}">${savedForLegs().map((x) => `<option value="${esc(x.id)}" ${x.travelRole === kind ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
      <select name="${sel}" aria-label="${esc(t('legWhen'))}">${['place', 'always', 'off'].map((k) => `<option value="${k}" ${k === travelCfg()[sel] ? 'selected' : ''}>${esc(t(`legWhen_${k}`))}</option>`).join('')}</select>
      <button class="icon" type="button" data-action="leg-edit" data-kind="${kind}" aria-label="${esc(t('legEdit', legTemplate(kind)?.title || ''))}" title="${esc(t('legEdit', legTemplate(kind)?.title || ''))}">✎</button>
    </div>`; }).join('')}
    <div class="button-row"><button class="btn small" type="button" data-action="use-location">📍 ${esc(t('useLocation'))}</button><button class="btn small ghost" type="button" data-action="travel-refresh">↻ ${esc(t('travelRefresh'))}</button></div>
    <p class="hint">${esc(travelCfg().googleKey ? t('travelViaGoogle') : t('travelViaFree'))}</p>
  </form>`;
  const github = ghConnected() && !ui.editGithub ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.repo)}</b>
      <small>${esc(t('branch'))}: ${esc(s.branch || 'main')} · ${esc(t('lastSync'))}: ${state.meta.lastSync ? esc(new Date(state.meta.lastSync).toLocaleString(getLang())) : esc(t('never'))}</small></div></div>
    ${state.meta.lastError && state.meta.lastError !== 'network' ? `<p class="conn bad">${esc(t(`err_${state.meta.lastError}`))}</p>` : ''}
    <div class="button-row">
      <button class="btn small" type="button" data-action="sync-now">${esc(t('syncNow'))}</button>
      <button class="btn small ghost" type="button" data-action="gh-edit">${esc(t('changeConn'))}</button>
    </div>
  </div>` : `
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
  </form>`;
  const ricette = ricetteConfigured() ? `
  <div class="conn-card">
    <div class="conn-main"><span class="ok-dot"></span><div><b>${esc(s.owner)}/${esc(s.ricetteRepo)}</b>
      <small>${esc(t('ricetteStatus', live('r_recipes').length, live('r_pantry').length, live('r_shopping').filter((x) => !x.checked).length))}</small></div></div>
    ${ui.ricMsg && ui.ricMsg !== 'connected' ? `<p class="conn bad">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn small ghost" type="button" data-action="ric-off">${esc(t('disconnect'))}</button></div>
  </div>` : `
  <form class="form" id="ric-form">
    <label>${esc(t('ricetteRepo'))}<input name="ricetteRepo" value="${esc(s.ricetteRepo || 'ricette-data')}" autocomplete="off" autocapitalize="off" spellcheck="false" ${isConfigured() ? '' : 'disabled'}>
      <small>${esc(isConfigured() ? t('ricetteRepoHint') : t('ricetteNeedsSync'))}</small></label>
    ${ui.ricMsg ? `<p class="conn ${ui.ricMsg === 'connected' ? 'good' : 'bad'}">${esc(t(ui.ricMsg))}</p>` : ''}
    <div class="button-row"><button class="btn primary" ${isConfigured() ? '' : 'disabled'}>${esc(t('connect'))}</button></div>
  </form>`;
  const connections = `
  <h3>${esc(t('sync'))}</h3>${github}
  <h3>${esc(t('ricette'))}</h3>${ricette}
  <h3>${esc(t('gcal'))}</h3>${gcalSection()}`;
  const lists = `
  <h3>${esc(t('categories'))}</h3>
  <ul class="list">
    ${categories().map((c) => `<li><button class="task-main" type="button" data-action="cat-edit" data-id="${esc(c.id)}"><span class="item-text"><span class="cat" style="--c:${esc(c.color)}">${esc(catName(c))}</span></span></button></li>`).join('')}
  </ul>
  <button class="btn small" type="button" data-action="cat-new">+ ${esc(t('newCategory'))}</button>
  <h3>🏪 ${esc(t('shopsTitle'))}</h3>
  ${shopsList().length ? `<ul class="list">${shopsList().map((sh) => `<li><button class="task-main" type="button" data-action="shop-rec" data-id="${esc(sh.id)}"><span class="item-text">${esc(sh.name)}<small>${esc([fmtDur(sh.minutes || 30), sh.hours?.length ? windowsText(sh.hours) : t('alwaysOpen'), sh.place || ''].filter(Boolean).join(' · '))}</small></span></button></li>`).join('')}</ul>` : ''}
  <button class="btn small" type="button" data-action="shop-new">+ ${esc(t('newShop'))}</button>`;
  const advanced = `
  <form class="form" id="advanced-form">
    <div class="two">
      <label>${esc(t('snap'))}<select name="snap">${opts([5, 10, 15, 30], s.snap, (m) => `${m} min`)}</select></label>
      <label>${esc(t('travelBuffer'))}<select name="travelBuffer">${[0, 5, 10, 15].map((m) => `<option value="${m}" ${m === Number(travelCfg().buffer) ? 'selected' : ''}>${m ? `${m} min` : esc(t('none'))}</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="advancedFeatures" ${advancedOn() ? 'checked' : ''}> <span>${esc(t('advancedFeatures'))}<small>${esc(t('advancedFeaturesHint'))}</small></span></label>
    <label class="check"><input type="checkbox" name="longUnits" ${s.longUnits ? 'checked' : ''}> <span>${esc(t('longUnits'))}</span></label>
    <div class="field-label">${esc(t('taskGroupsLabel'))}</div>
    <div class="days glance">${['today', 'tomorrow', 'soon'].map((k) => `<label class="day-pill"><input type="checkbox" name="tg" value="${k}" ${taskGroupsCfg()[k] ? 'checked' : ''}><span>${esc(k === 'soon' ? t('grp_soon') : t(`grp_${k}`))}</span></label>`).join('')}</div>
    <label>${esc(t('soonDays'))}<select name="soonDays">${[3, 5, 7, 14, 30].map((n) => `<option value="${n}" ${n === Number(taskGroupsCfg().soonDays) ? 'selected' : ''}>${esc(t('nDays', n))}</option>`).join('')}</select></label>
    <div class="field-label">${esc(t('glanceTitle'))}</div>
    <div class="days glance">${GLANCE.map((k) => `<label class="day-pill"><input type="checkbox" name="glance" value="${k}" ${glance().has(k) ? 'checked' : ''}><span>${esc(t(`gl_${k}`))}</span></label>`).join('')}</div>
    <label>${esc(t('tripModeLabel'))}<select id="trip-mode">${['perShop', 'oneTrip'].map((m) => `<option value="${m}" ${m === tripMode() ? 'selected' : ''}>${esc(t(`trip_${m}`))}</option>`).join('')}</select></label>
    <label>${esc(t('googleKey'))}<input name="googleKey" value="${esc(travelCfg().googleKey)}" placeholder="AIza…" autocomplete="off">${small('googleKeyHint')}</label>
  </form>
  <div class="button-row">
    <button class="btn small" type="button" data-action="export">${esc(t('export'))}</button>
    ${ghConnected() ? `<button class="btn small ghost" type="button" data-action="wipe-local">${esc(t('wipeLocal'))}</button>` : ''}
  </div>`;
  return `
  <h1>${esc(t('tabSettings'))}</h1>
  <form class="form" id="lang-form">
    <label>${esc(t('language'))}
      <select name="lang">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </label>
  </form>
  ${card(esc(t('myDay')), dayCard, 'c-day')}
  ${card(`🚌 ${esc(t('travelSettings'))}`, travelCard, 'c-travel')}
  ${card(esc(t('connections')), connections, 'c-links')}
  ${card(esc(t('listsTitle')), lists, 'c-lists')}
  <details class="set-card advanced" ${ui.advancedOpen ? 'open' : ''}><summary><h2>${esc(t('advanced'))}</h2></summary>${advanced}</details>
  <div class="button-row subtle">
    <a class="btn small" href="guide-${getLang() === 'it' ? 'it' : 'en'}.html" target="_blank" rel="noopener">📖 ${esc(t('guide'))}</a>
    <span class="version">${esc(t('appName'))} ${APP_VERSION}</span>
  </div>`;
}
function currentViewDefault() { const v = state.settings.defaultView || 'day'; return VIEWS.includes(v) ? v : 'day'; }

// Reminders: Google Calendar notifies you (the "Everyday" calendar's events carry them). A default for
// everything (shared through the data repo, read by the sync), and each task can have its own.
const REMINDS = [-1, 0, 5, 10, 15, 30, 60, 120, 1440];
function remindDefault() { const v = get('config', 'reminders')?.value?.default; return v == null ? 10 : Number(v); }
function remindLabel(m) { return m < 0 ? t('remindNone') : m === 0 ? t('remindAtStart') : m === 1440 ? t('remindDayBefore') : t('remindBefore', fmtDur(m)); }

function gcalSection() {
  const st = get('gcal', 'status');
  if (!st) {
    return `${hint('gcalIntro')}
      <ol class="steps">${[1, 2, 3, 4].map((i) => `<li>${esc(t(`gcalStep${i}`))}</li>`).join('')}</ol>
      ${hint('gcalGuide')}
      ${ghConnected() ? `<div class="button-row"><button class="btn small" type="button" data-action="sync-now">${esc(t('gcalCheck'))}</button></div>` : ''}`;
  }
  return `<div class="conn-card">
    <div class="conn-main"><span class="ok-dot ${st.error ? 'bad' : ''}"></span><div><b>${esc(t('gcalLast', new Date(st.lastRun).toLocaleString(getLang())))}</b>
      <small>${st.error ? '' : esc(t('gcalStats', st.events || 0, (st.imported || []).join(', ') || '—', st.blocks || 0, st.calendar || 'Everyday'))}</small></div></div>
    ${st.error ? `<p class="conn bad">${esc(st.error)}</p>` : ''}
    ${ui.gcalMsg ? `<p class="hint">${esc(t(ui.gcalMsg))}</p>` : ''}
    <label class="check"><input type="checkbox" id="show-events" ${state.settings.showEvents === false ? '' : 'checked'}> ${esc(t('showEvents'))}</label>
    <label>🔔 ${esc(t('remindDefault'))}<select id="remind-default">${REMINDS.map((m) => `<option value="${m}" ${m === remindDefault() ? 'selected' : ''}>${esc(remindLabel(m))}</option>`).join('')}</select>
      ${small('remindHint')}</label>
    <div class="button-row"><button class="btn small" type="button" data-action="gcal-now">${esc(t('gcalNow'))}</button>
      <button class="btn small ghost" type="button" data-action="gcal-remove">${esc(t('gcalRemove'))}</button></div>
    ${hint('gcalRemoveHint')}
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
  $('#app-title').title = t('tabToday');
  for (const a of document.querySelectorAll('nav a')) {
    a.querySelector('.label').textContent = t(`tab${a.dataset.tab.charAt(0).toUpperCase()}${a.dataset.tab.slice(1)}`);
  }
  const gear = $('#gear'); if (gear) { gear.setAttribute('aria-label', t('gearSettings')); gear.title = t('gearSettings'); }
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
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.tab === (TAB_OF[r.name] || 'today'));
  $('#gear')?.classList.toggle('active', r.name === 'settings');
  document.body.classList.toggle('compact', Boolean(state.settings.compact));
  updateShopCount();
  let html;
  switch (r.name) {
    case 'tasks': html = viewTasks(); break;
    case 'shop': html = viewTasks('shop'); break;
    case 'events': html = viewEvents(); break;
    case 'settings': html = viewSettings(); break;
    case 'plan': html = viewPlan(currentDate()); break;
    default: html = viewToday();
  }
  // Nothing changed (e.g. a sync that found no news): leave the page alone. Replacing it
  // anyway is what made the screen flicker and fields lose what you were typing.
  if (html === ui.lastHtml && view.childElementCount) { positionNow(); settleScroll(r); return; }
  ui.lastHtml = html;
  view.innerHTML = html;
  document.body.classList.toggle('has-tray', Boolean(view.querySelector('.tray')));
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
  settleScroll(r);
}

// Opening the plan (or switching to the Day view) shows today's "now"; another day starts at the
// top. Moving between days with ‹ › keeps where you are on the page.
function settleScroll(r) {
  if (r.name !== 'plan' && TAB_OF[r.name]) return;
  if (ui.scrolledFor == null) {
    ui.scrolledFor = currentDate();
    if (currentView() === 'day' && currentDate() === today()) scrollTimeline(); else window.scrollTo(0, 0);
  }
  ui.shownDate = currentDate();
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
  if (ui.pressing || typing() || isDragging()) { ui.renderLater = true; return; }
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
  // Replacing the dialog blurs the field you were in, which fires a late "change": ignore it (the
  // value was already read), so a dialog never redraws itself in the middle of being redrawn.
  ui.modalSwap = true;
  try { modal.innerHTML = `<form method="dialog" class="form">${html}</form>`; } finally { ui.modalSwap = false; }
  const form = modal.querySelector('form');
  form.addEventListener('submit', (e) => {
    const v = e.submitter?.value;
    if (v === 'cancel') return;
    onSubmit(form, v || 'ok', e);
  });
  if (!modal.open) modal.showModal();
}

modal.addEventListener('close', () => render());
modal.addEventListener('change', (e) => { if (ui.modalSwap) e.stopImmediatePropagation(); }, true);
modal.addEventListener('input', (e) => { if (ui.modalSwap) e.stopImmediatePropagation(); }, true);
// ✕ in a search field (and Esc while typing in one): empty it and search again, keeping the focus there.
function clearSearch(input) {
  if (!input || !input.value) return false;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  (document.getElementById(input.id) || input).focus();
  return true;
}
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.search-clear')) e.preventDefault(); }, true); // keep the keyboard up
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.search-clear');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  clearSearch(b.parentElement.querySelector('input'));
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest?.('.search-box') && clearSearch(e.target)) { e.preventDefault(); e.stopPropagation(); }
}, true);
// A time window with a date: its weekdays don't count, so they fade as soon as a date is picked.
modal.addEventListener('change', (e) => {
  const row = e.target.closest?.('.win-row');
  if (row && e.target.type === 'date') row.querySelector('.days.mini')?.classList.toggle('off', Boolean(e.target.value));
});

const durOptions = (sel, list = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240]) => {
  const opts = [...list];
  if (sel && !opts.includes(sel)) opts.push(sel);
  return opts.sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtDur(m)}</option>`).join('');
};

// Times are typed as 24-hour hh:mm whatever the phone's language (the browser's own time picker
// would show AM/PM on an English phone). "1900", "930" and "9" work too.
const TIME24 = 'type="text" inputmode="numeric" class="time24" maxlength="5" placeholder="hh:mm" autocomplete="off" pattern="([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]|[0-9]{1,2}"';
function tidyTime(el) {
  const v = el.value.trim();
  if (!v) return;
  const m = parseTime(v);
  if (m != null) el.value = fmtTime(m);
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList?.contains('time24')) return;
  const digits = el.value.replace(/[^0-9]/g, '').slice(0, 4);
  if (e.inputType?.startsWith('delete')) return;
  el.value = digits.length > 2 ? `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}` : digits;
});
document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('time24')) tidyTime(e.target); }, true);

const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

// A length: a number and a unit. Minutes and hours; with "longer units" (Settings → Planner) also
// days, weeks, months and years (calendar time: 1 d = 24 h), for big tasks made of many steps.
const UNITS = { min: 1, h: 60, d: 1440, wk: 10080, mo: 43200, y: 525600 };
function durField(name, minutes, { required = false, placeholder = '', label = t('duration') } = {}) {
  const m = Number(minutes) || 0;
  const long = state.settings.longUnits || m >= 1440;
  const units = long ? Object.keys(UNITS) : ['min', 'h'];
  const unit = [...units].reverse().find((u) => (u === 'h' ? m >= 60 && m % 30 === 0 : u !== 'min' && m >= UNITS[u] && m % (UNITS[u] / 2) === 0)) || 'min';
  const val = m ? +(m / UNITS[unit]).toFixed(2) : '';
  return `<span class="dur-field"><input name="${esc(name)}" type="number" inputmode="decimal" min="0" step="any" value="${val}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" aria-label="${esc(label)}"><select name="${esc(name)}_u" aria-label="${esc(t('unit'))}">${units.map((u) => `<option value="${u}" ${u === unit ? 'selected' : ''}>${esc(t(`u_${u}`))}</option>`).join('')}</select></span>`;
}
// Minutes from a length field, or `fallback` when it's empty.
function readDur(form, name, fallback = null) {
  const el = form.elements.namedItem(name);
  if (!el) return fallback;
  const n = parseFloat(String(el.value).replace(',', '.'));
  if (!(n > 0)) return fallback;
  return Math.max(1, Math.round(n * (UNITS[form.elements.namedItem(`${name}_u`)?.value] || 1)));
}

// Time windows: when something can happen at all (office hours, opening times). [{days: [1-7], from, to}]
function dayShort(d) { return fmtDay(addDays('2026-11-02', d - 1), { weekday: 'short' }); } // 2026-11-02 is a Monday
function windowsText(wins) {
  return (wins || []).map((w) => `${w.date ? fmtDay(w.date, { weekday: 'short', day: 'numeric', month: 'short' }) : (w.days || []).length === 7 ? t('everyDay') : (w.days || []).map(dayShort).join(' ')} ${fmtTime(w.from)}–${fmtTime(w.to)}`).join(', ');
}
function windowsEditor(prefix, wins) {
  return `<div class="wins">${(wins || []).map((w, k) => `<div class="win-row">
      <div class="days mini${w.date ? ' off' : ''}">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="${prefix}d${k}" value="${d}" ${(w.days || []).includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>
      <label class="win-date">${esc(t('orOnDate'))}<input type="date" name="${prefix}x${k}" value="${esc(w.date || '')}"></label>
      <span class="win-times"><input name="${prefix}f${k}" ${TIME24} value="${w.from != null ? fmtTime(w.from) : ''}" aria-label="${esc(t('from'))}"> – <input name="${prefix}t${k}" ${TIME24} value="${w.to != null ? fmtTime(w.to) : ''}" aria-label="${esc(t('to'))}">
      <button class="icon" value="${prefix}rm:${k}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span></div>`).join('')}
    <button class="btn small ghost" value="${prefix}add" formnovalidate>+ ${esc(t('addWindow'))}</button></div>`;
}
// Rows as typed (kept while editing); `clean` drops the unfinished ones.
function readWindows(form, prefix, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      days: [...form.querySelectorAll(`input[name="${prefix}d${k}"]:checked`)].map((el) => Number(el.value)),
      date: form.elements.namedItem(`${prefix}x${k}`)?.value || null,
      from: parseTime(form.elements.namedItem(`${prefix}f${k}`)?.value), to: parseTime(form.elements.namedItem(`${prefix}t${k}`)?.value),
    });
  }
  return out;
}
const cleanWindows = (wins) => (wins || []).filter((w) => (w.date || w.days?.length) && w.from != null && w.to != null && w.to > w.from)
  .map((w) => (w.date ? { date: w.date, from: w.from, to: w.to } : { days: w.days, from: w.from, to: w.to }));

// Where a task happens: a place, and a link (a map, a booking…). Without a link, the place opens in Maps.
function placeLink(x, { short = false } = {}) {
  if (!x?.place && !x?.link) return '';
  const href = x.link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}`;
  const text = x.place || (short ? t('link') : x.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40));
  return `<a class="place-link" href="${esc(href)}" target="_blank" rel="noopener">📍 ${esc(text)}</a>`;
}

// Task editor. Used for to-dos, for preparation steps (small tasks of their own, planned
// automatically before the task they belong to) and for saved tasks (Settings → Saved tasks, meals
// among them). Any task can be split into steps, and can have rules: "when this is planned / done /
// couldn't be done / was missed → …". "When it's planned" rules are its preparations (task.prep).
function rulesForEditor(task) {
  const preps = (task.prep || []).map((p, i) => {
    const pt = get('tasks', p.taskId);
    return { id: `prep${i}`, when: 'planned', then: 'task', taskId: p.taskId, title: pt?.title || '', minutes: pt?.minutes || 10, place: p.when || 'before', stepId: null };
  });
  return [...preps, ...(task.rules || []).map((r) => ({ ...r }))];
}

// The weekday of a task's date (planned, else due, else today), Monday = 1.
// "Every 2 weeks on Mon, Wed", "Every day", "Weekdays until 20 Dec".
function repeatText(x) {
  if (!x.repeat || x.repeat === 'times') return '';
  const n = Math.max(1, Number(x.every) || 1);
  let s = x.repeat === 'weekdays' ? t('rep_weekdays') : n === 1 ? t(`rep_${x.repeat}`) : t('everyN', n, t(`unit_${x.repeat}`, n));
  if (x.repeat === 'weekly' && (x.repeatDays || []).length) s += ` ${t('onDays', x.repeatDays.map(dayShort).join(', '))}`;
  if (x.repeatUntil) s += ` ${t('untilDay', relDay(x.repeatUntil))}`;
  return s;
}
function plannedIso(x) { const d = x.planDate || x.due || today(); return ((parseDate(d).getDay() + 6) % 7) + 1; }
// The one editor for tasks and events (`opts.event`, or a task with `event: true`): the same sections
// in the same order; an event's "When" is a fixed date (a time is optional) and it has a section for
// the tasks to do around it instead of due date, importance and prerequisites.
function openTask(task, draft = null, opts = {}) {
  const isNew = !task;
  const evMode = Boolean(task?.event || draft?.event || opts.event || opts.draft?.event);
  const base = task || (evMode ? { title: '', minutes: 120, importance: 3, category: '', due: '', repeat: '', notes: '', when: '', event: true }
    : { title: '', minutes: 30, importance: 3, category: '', due: '', repeat: '', notes: '', when: '' });
  const src = draft || opts.draft || base;
  const x = draft?.allRules ? draft : { ...src, importance: importanceOf(src), minutes: ownMinutes(src), steps: realSteps(src).map((y) => ({ ...y })), checklist: [...(src.checklist || [])], allRules: rulesForEditor(src), travel: travelOf(src) };
  if (!x.travel) x.travel = travelOf(src);
  if (opts.fromOcc) x.fromOcc = opts.fromOcc;
  const helper = Boolean(x.helper);
  const routine = Boolean(x.routine);
  void routine; // saved tasks get the same editor as to-dos (they only live in another list)
  // When a to-do is on the plan, its date and time show here and can be changed (or cleared to unplan).
  if (!helper && x.planDate === undefined) {
    const nb = x.id ? nextBlockOf(x.id) : null;
    x.planDate = nb?.date || '';
    x.planTime = nb ? nb.start + anchorOffset(nb) : null;
    x.planBlockId = nb?.id || null;
    if (evMode) {
      if (isNew && !x.planDate) { x.planDate = opts.date || ''; x.planTime = opts.start ?? null; }
      if (!x.planDate) x.planDate = x.due || '';
      if (x.planTime == null && !x.allDay && x.eventTime != null) x.planTime = x.eventTime;
    }
  }
  const linkedEvent = !evMode && x.eventId ? eventOf(x.eventId) : null;
  const lenOf = (y) => Number(y.minutes) || 10;
  const stepTotal = x.steps.reduce((n, y) => n + lenOf(y), 0);
  const fromRecipes = x.steps.some((y) => y.from === 'recipes');
  const ai = anchorIndex(x.steps.filter((y) => y.title || true), x.anchorStepId);
  const anchor = x.steps[ai];
  const WHEN_TASK = helper ? ['done', 'failed', 'missed'] : RULE_WHEN;
  const WHEN_STEP = ['done', 'failed'];
  const opened = state.settings.edSec || {};
  // A collapsible section of the editor; whether it's open is remembered.
  const sec = (key, title, summary, body, defOpen) => `<details class="ed-sec" data-sec="${key}" ${(opened[key] ?? defOpen) ? 'open' : ''}>
      <summary><span class="sec-t">${title}</span>${summary ? `<small>${esc(summary)}</small>` : ''}</summary>
      <div class="sec-b">${body}</div></details>`;

  const ruleCard = (r, i) => {
    const onStep = Boolean(r.stepId);
    const planned = r.when === 'planned';
    const places = planned ? PREP_PLACES : RULE_PLACES;
    const linked = r.taskId && get('tasks', r.taskId);
    return `
    <div class="rule ${r.then === 'groceries' ? 'is-groceries' : ''}">
      <input type="hidden" name="rs_${i}" value="${esc(r.stepId || '')}">
      <div class="rule-line"><span>${esc(t('ruleWhenGen'))} ${esc(onStep ? t('ruleThisStep') : t('ruleSubjectTask'))}</span>
        <select name="rw_${i}" data-rerender="1">${(onStep ? WHEN_STEP : WHEN_TASK).map((w) => `<option value="${w}" ${w === r.when ? 'selected' : ''}>${esc(t(onStep ? `rws_${w}` : `rw_${w}`))}</option>`).join('')}</select>
        <button class="icon" value="rm-rule:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>
      <div class="rule-line"><span>→</span>
        ${planned ? `<span class="rule-subj">${esc(t('rt_task'))}</span><input type="hidden" name="rt_${i}" value="task">`
    : `<select name="rt_${i}" data-rule="${i}"><option value="task" ${r.then !== 'groceries' ? 'selected' : ''}>${esc(t('rt_task'))}</option><option value="groceries" ${r.then === 'groceries' ? 'selected' : ''}>${esc(t('rt_groceries'))}</option></select>`}</div>
      <div class="rule-line rt-task">
        <select name="rk_${i}" data-rulekind="${i}"><option value="">${esc(t('ruleNewTask'))}</option>${ruleTargets(x).map((y) => `<option value="${esc(y.id)}" ${y.id === r.taskId ? 'selected' : ''}>${y.helper ? '↳ ' : ''}${esc(y.title)}</option>`).join('')}</select>
        <input class="rule-title${r.taskId ? ' hide' : ''}" name="rti_${i}" value="${esc(r.taskId ? '' : r.title || '')}" placeholder="${esc(t(planned ? 'prepPh' : 'rulePh'))}" autocomplete="off">
        ${durField(`rm_${i}`, Number(r.minutes) || linked?.minutes || 30)}
        <select name="rp_${i}" data-rerender="1">${places.map((p) => `<option value="${p}" ${p === (r.place || places[0]) ? 'selected' : ''}>${esc(t(`${planned ? 'pw' : 'rp'}_${p}`))}</option>`).join('')}</select>
        <button class="btn small ghost" value="edit-rule:${i}" formnovalidate title="${esc(t('editRuleTask'))}">${esc(t('edit'))}${linked?.steps?.length ? ` · ▤ ${linked.steps.length}` : ''}${linked?.checklist?.length ? ` · ☑ ${linked.checklist.length}` : ''}${linked?.rules?.length ? ` · ⚙ ${linked.rules.length}` : ''}</button>
      </div>
      ${!planned && ['slots', 'pool'].includes(r.place) && r.then !== 'groceries' ? `<div class="rule-wins"><p class="hint">${esc(t(r.place === 'slots' ? 'rpSlotsHint' : 'rpPoolHint'))}</p>${windowsEditor(`r${i}w_`, r.windows || [])}</div>` : ''}
    </div>`;
  };
  const rulesFor = (sid) => x.allRules.map((r, i) => [r, i]).filter(([r]) => (r.stepId || null) === sid);

  const stepCards = x.steps.map((y, i) => {
    const mine = rulesFor(y.id);
    const isAnchor = i === ai && x.steps.length > 1;
    return `<li class="step-card${isAnchor ? ' anchor' : ''}">
      <div class="step-row">
        <span class="step-n">${i + 1}</span>
        <input name="st_t_${i}" value="${esc(y.title)}" placeholder="${esc(t('stepPh'))}" autocomplete="off" aria-label="${esc(t('title'))}">
        ${durField(`st_m_${i}`, lenOf(y))}
        <button class="icon anchor-btn${isAnchor ? ' on' : ''}" value="anchor:${i}" formnovalidate title="${esc(t('anchorBtn'))}" aria-pressed="${isAnchor}">⚓</button>
        ${i ? `<button class="icon" value="up-step:${i}" formnovalidate aria-label="↑">↑</button>` : '<span class="icon-sp"></span>'}
        <button class="icon" value="rm-step:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button>
      </div>
      ${x.meal || y.from === 'recipes' ? `<label class="check step-sub"><input type="checkbox" name="st_r_${i}" data-rerender="1" ${y.from === 'recipes' ? 'checked' : ''}> <span>⟲ ${esc(t(y.from === 'recipes' ? 'stepRecipesOn' : 'stepRecipesOff'))}</span></label>` : ''}
      ${mine.map(([r, k]) => ruleCard(r, k)).join('')}
      <button class="btn small ghost step-rule-add" value="add-rule:${esc(y.id)}" formnovalidate>⚙ + ${esc(t('addStepRule'))}</button>
    </li>`;
  }).join('');
  const taskRules = rulesFor(null);
  const timeLabel = x.steps.length > 1 && ai > 0 && anchor ? t('anchorAt', anchor.title || '…') : t('startTime');
  const heading = evMode ? (isNew ? t('newEvent') : t('editEvent')) : routine ? (x.meal ? (isNew ? t('newMealType') : t('mealType')) : (isNew ? t('newSaved') : t('savedTask'))) : helper ? t('editPrep') : isNew ? t('newTask') : t('editTask');
  const catName0 = get('categories', x.category) ? catName(get('categories', x.category)) : '';

  const basics = `
    <div class="two">
      ${x.steps.length ? `<label>${esc(t('duration'))}<span class="static">${esc(fromRecipes ? t('durationRecipes', fmtDur(stepTotal)) : t('durationFromSteps', fmtDur(stepTotal)))}</span></label>`
    : `<label>${esc(t('duration'))}${durField('minutes', x.minutes || 30)}</label>`}
      ${helper || x.travelRole ? '' : `<label>${esc(t('bufferAfter'))}<select name="buffer"><option value="" ${x.buffer == null || x.buffer === '' ? 'selected' : ''}>${esc(t('bufferDefault', Number(state.settings.taskBuffer) || 0))}</option>${[0, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${x.buffer != null && x.buffer !== '' && Number(x.buffer) === m ? 'selected' : ''}>${m ? esc(fmtDur(m)) : esc(t('none'))}</option>`).join('')}</select></label>`}
      ${helper || evMode ? '' : `<label>${esc(t('importance'))}<select name="importance">${IMPORTANCE.map((n) => `<option value="${n}" ${n === x.importance ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${esc(t(`imp_${n}`))}</option>`).join('')}</select></label>`}
    </div>
    ${helper ? '' : `<div class="field-label">${esc(t('category'))}</div>${catChips(x.category)}`}
    ${helper || x.meal || evMode ? '' : `<label class="check"><input type="checkbox" name="routine" ${routine ? 'checked' : ''}> <span>★ ${esc(t('keepSaved'))}${small('keepSavedHint')}</span></label>`}
    ${routine ? `<label class="check"><input type="checkbox" name="meal" data-rerender="1" ${x.meal ? 'checked' : ''}> <span>${esc(t('isMeal'))}</span></label>` : ''}`;
  const off = x.eventOffset || { days: 0, when: 'before' };
  const offWeeks = off.days > 0 && off.days % 7 === 0;
  const evLine = linkedEvent ? `
    <div class="ev-link">
      <div class="field-label">📅 ${esc(t('forEvent', linkedEvent.title))} <small>${esc(eventDate(linkedEvent) ? relDay(eventDate(linkedEvent)) : '')}</small></div>
      <div class="offset-row">
        <input name="evDays" type="number" min="0" max="365" step="1" value="${esc(offWeeks ? off.days / 7 : off.days)}" aria-label="${esc(t('offsetDays'))}">
        <select name="evUnit"><option value="days" ${offWeeks ? '' : 'selected'}>${esc(t('daysUnit'))}</option><option value="weeks" ${offWeeks ? 'selected' : ''}>${esc(t('weeksUnit'))}</option></select>
        <select name="evWhen"><option value="before" ${off.when !== 'after' ? 'selected' : ''}>${esc(t('beforeIt'))}</option><option value="after" ${off.when === 'after' ? 'selected' : ''}>${esc(t('afterIt'))}</option><option value="none">${esc(t('detachEvent'))}</option></select>
      </div>
      <button class="btn small ghost" value="open-event" formnovalidate>${esc(t('openEvent'))} ↗</button>
    </div>` : '';
  const whenBody = evMode ? `
    <div class="two">
      <label>${esc(t('date'))}<input name="planDate" type="date" required value="${esc(x.planDate || '')}"></label>
      <label>${esc(timeLabel)}<input name="planTime" ${TIME24} value="${x.planTime != null ? fmtTime(x.planTime) : ''}"></label>
    </div>
    <small class="hint">${esc(t('eventWhenHint'))}</small>
    <div class="two">
      <label>${esc(t('repeat'))}<select name="repeat" data-rerender="1"><option value="">${esc(t('rep_none'))}</option>${REPEATS.map((r) => `<option value="${r}" ${r === x.repeat ? 'selected' : ''}>${esc(t(`rep_${r}`))}</option>`).join('')}</select></label>
    </div>
    ${REPEATS.includes(x.repeat) ? `<div class="recur-box">
      ${x.repeat !== 'weekdays' ? `<div class="times-row"><span>${esc(t('every'))}</span><input name="every" type="number" min="1" max="52" step="1" value="${esc(x.every || 1)}" aria-label="${esc(t('every'))}"><span>${esc(t(`unit_${x.repeat}`, Number(x.every) || 1))}</span></div>` : ''}
      ${x.repeat === 'weekly' ? `<div class="days mini">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="repeatDays" value="${d}" ${((x.repeatDays || []).length ? x.repeatDays : [plannedIso(x)]).includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>` : ''}
      <label>${esc(t('repeatUntil'))}<input name="repeatUntil" type="date" value="${esc(x.repeatUntil || '')}"></label>
      ${x.planTime == null ? `<small class="hint">${esc(t('repeatNeedsTime'))}</small>` : ''}
      ${x.fromOcc && (x.seriesFrom || x.due) && x.fromOcc > (x.seriesFrom || x.due) ? `<div class="field-label">${esc(t('applyTo'))}</div>
      <div class="days"><label class="day-pill"><input type="radio" name="scope" value="following" ${x.scope !== 'all' ? 'checked' : ''}><span>${esc(t('scopeFollowing', relDay(x.fromOcc)))}</span></label>
      <label class="day-pill"><input type="radio" name="scope" value="all" ${x.scope === 'all' ? 'checked' : ''}><span>${esc(t('scopeAll'))}</span></label></div>` : ''}
    </div>` : ''}
    ${remindField(x)}` : !helper ? `
    <div class="two">
      <label>${esc(t('date'))}<input name="planDate" type="date" value="${esc(x.planDate || '')}"></label>
      <label>${esc(timeLabel)}<input name="planTime" ${TIME24} value="${x.planTime != null ? fmtTime(x.planTime) : ''}"></label>
    </div>
    <small class="hint">${esc(t(x.planBlockId ? 'whenPlannedHint' : 'whenHint'))}</small>
    ${evLine}
    <div class="two">
      ${linkedEvent ? `<label>${esc(t('due'))}<span class="static">${esc(x.due ? relDay(x.due) : '—')}</span></label>` : `<label>${esc(t('due'))}<input name="due" type="date" value="${esc(x.due || '')}"></label>`}
      <label>${esc(t('repeat'))}<select name="repeat" data-rerender="1"><option value="">${esc(t('rep_none'))}</option>${[...REPEATS, 'times'].map((r) => `<option value="${r}" ${r === x.repeat ? 'selected' : ''}>${esc(t(`rep_${r}`))}</option>`).join('')}</select></label>
    </div>
    ${x.repeat === 'times' ? `<div class="times-row"><input name="timesN" type="number" min="1" max="99" step="1" value="${esc(x.timesN || 3)}" aria-label="${esc(t('timesN'))}"><span>${esc(t('timesPer'))}</span>
      <select name="timesPer">${['day', 'week', 'month', 'year'].map((u) => `<option value="${u}" ${u === (x.timesPer || 'week') ? 'selected' : ''}>${esc(t(`per_${u}`))}</option>`).join('')}</select></div>
      ${hint('timesHint')}` : ''}
    ${REPEATS.includes(x.repeat) ? `<div class="recur-box">
      ${x.repeat !== 'weekdays' ? `<div class="times-row"><span>${esc(t('every'))}</span><input name="every" type="number" min="1" max="52" step="1" value="${esc(x.every || 1)}" aria-label="${esc(t('every'))}"><span>${esc(t(`unit_${x.repeat}`, Number(x.every) || 1))}</span></div>` : ''}
      ${x.repeat === 'weekly' ? `<div class="days mini">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="repeatDays" value="${d}" ${((x.repeatDays || []).length ? x.repeatDays : [plannedIso(x)]).includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>` : ''}
      <label>${esc(t('repeatUntil'))}<input name="repeatUntil" type="date" value="${esc(x.repeatUntil || '')}"></label>
      <small class="hint">${esc(x.seriesTime != null ? t('seriesHint', fmtTime(x.seriesTime)) : t('recurHint'))}</small>
      ${x.fromOcc && (x.seriesFrom || x.due) && x.fromOcc > (x.seriesFrom || x.due) ? `<div class="field-label">${esc(t('applyTo'))}</div>
      <div class="days"><label class="day-pill"><input type="radio" name="scope" value="following" ${x.scope !== 'all' ? 'checked' : ''}><span>${esc(t('scopeFollowing', relDay(x.fromOcc)))}</span></label>
      <label class="day-pill"><input type="radio" name="scope" value="all" ${x.scope === 'all' ? 'checked' : ''}><span>${esc(t('scopeAll'))}</span></label></div>` : ''}
    </div>` : ''}
    <div class="two">
      <label>${esc(t('bestTime'))}<select name="when">${['', 'morning', 'afternoon', 'evening'].map((w) => `<option value="${w}" ${w === (x.when || '') ? 'selected' : ''}>${esc(t(`when_${w || 'any'}`))}</option>`).join('')}</select></label>
      ${routine ? `<label>${esc(x.steps.length > 1 && ai > 0 && anchor ? t('anchorAt', anchor.title || '…') : t('usualTimeOpt'))}<input name="defaultStart" ${TIME24} value="${x.defaultStart != null ? fmtTime(x.defaultStart) : ''}"></label>` : ''}
    </div>
    ${routine ? `${hint('usualTimeHint')}` : ''}
    ${remindField(x)}` : '';
  // Tasks it needs done first (not itself, not meals, not ones that already need it: no loops).
  const needCandidates = live('tasks').filter((y) => y.id !== x.id && !y.meal && !y.check && !y.done && !(y.after || []).includes(x.id) && !(x.after || []).includes(y.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const needsBody = helper || evMode ? '' : `
    <div class="field-label">🔒 ${esc(t('needsFirst'))}</div>
    ${(x.after || []).length ? `<div class="needs">${(x.after || []).map((id, k) => { const y = get('tasks', id); return `<span class="need-chip${y?.done ? ' done' : ''}">${y?.done ? '✓ ' : ''}${esc(y?.title || '?')}<button class="icon" value="rm-after:${k}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span>`; }).join('')}</div>` : ''}
    <select name="addAfter" data-rerender="1"><option value="">+ ${esc(t('addNeed'))}</option>${needCandidates.map((y) => `<option value="${esc(y.id)}">${y.helper ? '↳ ' : ''}${esc(y.title)}</option>`).join('')}</select>
    ${hint('needsHint')}
    <div class="field-label">🕒 ${esc(t('windowsTitle'))}</div>
    ${windowsEditor('w_', x.windows || [])}
    ${hint('windowsHint')}`;
  const whenSummary = evMode ? [x.planDate ? `${relDay(x.planDate)} ${x.planTime != null ? fmtTime(x.planTime) : t('allDay')}` : t('dateMissing'), x.repeat ? `↻ ${repeatText(x)}` : ''].filter(Boolean).join(' · ')
    : !helper ? [x.planDate ? `${relDay(x.planDate)}${x.planTime != null ? ` ${fmtTime(x.planTime)}` : ''}` : '', x.due ? t('dueOn', relDay(x.due)) : '', x.repeat ? `↻ ${x.repeat === 'times' ? t('timesShort', x.timesN || 3, t(`per_${x.timesPer || 'week'}`)) : repeatText(x)}` : '', routine && x.defaultStart != null ? t('usually', fmtTime(x.defaultStart)) : ''].filter(Boolean).join(' · ') : '';
  // Events: the tasks to do around them, with how far before or after, and whether each is planned.
  const evTasks = evMode && x.id ? eventTasksOf(x.id) : [];
  const evTasksBody = evMode ? `
    ${hint('eventTasksHint')}
    ${evTasks.length ? `<ul class="list ev-tasks">${evTasks.map((y) => { const nb = nextPlanned(y.id); const late = !y.done && y.due && y.due < today(); return `<li class="${y.done ? 'done' : ''}">
      <button class="task-main" value="ev-task:${esc(y.id)}" formnovalidate><span class="item-text">${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc([offsetText(y.eventOffset), y.due ? relDay(y.due) : '', fmtDur(y.minutes || 30)].filter(Boolean).join(' · '))}</small>
      <small class="${y.done ? '' : nb ? 'ok' : late ? 'late' : 'warn'}">${esc(y.done ? t('doneLabel') : nb ? t('plannedAt', relDay(nb.date), fmtTime(nb.start)) : late ? t('lateLabel') : t('toPlanLabel'))}</small></span></button>
    </li>`; }).join('')}</ul>` : ''}
    <div class="button-row left">
      <button class="btn small" value="add-evtask" formnovalidate>+ ${esc(t('addEventTask'))}</button>
      ${evTasks.some((y) => !y.done && !nextPlanned(y.id)) ? `<button class="btn small primary-ghost" value="plan-evtasks" formnovalidate>✦ ${esc(t('planThese'))}</button>` : ''}
    </div>` : '';
  const stepsBody = `
    ${hint(x.meal ? 'stepsHintMeal' : 'stepsHint')}
    ${stepCards ? `<ol class="steps-edit">${stepCards}</ol>` : ''}
    ${x.steps.length > 1 && ai > 0 && anchor ? `<p class="hint anchor-hint">⚓ ${esc(t('anchorHintGen', anchor.title || '…', x.steps.slice(0, ai).map((y) => y.title).filter(Boolean).join(', ')))}</p>` : ''}
    <button class="btn small" value="add-step" formnovalidate>+ ${esc(t('addStep'))}</button>
    ${x.steps.length > 1 && !x.meal && !helper ? `<label class="check"><input type="checkbox" name="splitSteps" ${x.splitSteps ? 'checked' : ''}> <span>${esc(t('splitSteps'))}${small('splitStepsHint')}</span></label>` : ''}`;
  const rulesBody = `
    <p class="hint">${esc(t(helper ? 'rulesHint' : 'rulesHintPrep'))}</p>
    ${taskRules.map(([r, i]) => ruleCard(r, i)).join('')}
    <button class="btn small" value="add-rule:" formnovalidate>+ ${esc(t('addRule'))}</button>`;
  const placeBody = `
    <label>${esc(t('place'))}<input name="place" value="${esc(x.place || '')}" placeholder="${esc(t('placePh'))}" autocomplete="off"></label>
    <label>${esc(t('placeLink'))}<input name="link" type="url" inputmode="url" value="${esc(x.link || '')}" placeholder="https://maps.app.goo.gl/…" autocomplete="off"></label>
    ${x.place || x.link ? `<p class="hint">${placeLink(x)}</p>` : `${hint('placeHint')}`}
    ${!helper && !x.travelRole ? `<div class="field-label">${esc(t('travelTitle'))}</div>
    <div class="travel-opts">
      <label class="check"><input type="checkbox" name="tvThere" ${x.travel.there ? 'checked' : ''}> <span>${esc(t('getThere'))}</span></label>
      <label class="check"><input type="checkbox" name="tvBack" ${x.travel.back ? 'checked' : ''}> <span>${esc(t('comeBack'))}</span></label>
      <label>${esc(t('travelMode'))}<select name="tvMode"><option value="default" ${x.travel.mode === 'default' ? 'selected' : ''}>${esc(t('tvDefault', t(`tm_${travelCfg().mode}`)))}</option>${TRAVEL_MODES.map((m) => `<option value="${m}" ${x.travel.mode === m ? 'selected' : ''}>${MODE_ICON[m]} ${esc(t(`tm_${m}`))}</option>`).join('')}</select></label>
    </div>
    ${(src.steps || []).filter((y) => y.travel).map((y) => `<p class="hint">${MODE_ICON[y.mode] || ''} ${esc(y.title)}: ${y.known ? esc(fmtDur(y.minutes)) : '?'} · ${esc(t('fromPlace', y.from || t('home')))}${y.known ? '' : ` · ${esc(t('travelPending'))}`}</p>`).join('')}
    ${!travelCfg().home && !hereNow() ? `<p class="hint warn-text">⚠ ${esc(t('homeUnset'))} <a href="#/settings">${esc(t('tabSettings'))}</a></p>` : ''}
    ${hint('travelHint')}` : ''}`;
  openModal(`
    <h2>${esc(heading)}</h2>
    ${x.check === 'ingredients' ? `${hint('checkStepHint')}` : ''}
    ${x.travelRole ? `<p class="hint">${esc(t('legTaskHint', t(x.travelRole === 'there' ? 'getThere' : 'comeBack')))}</p>` : ''}
    <label>${esc(t('title'))}<input name="title" required value="${esc(x.title)}" autocomplete="off"></label>
    ${evMode ? sec('when', `📅 ${esc(t('secWhen'))}`, whenSummary, whenBody, true) : ''}
    ${evMode ? sec('evtasks', `✓ ${esc(t('secEventTasks'))}`, evTasks.length ? readinessText(x.id) : '', evTasksBody, true) : ''}
    ${sec('basics', esc(t(evMode ? 'secBasicsEvent' : 'secBasics')), [fmtDur(x.steps.length ? stepTotal : x.minutes || 30), helper || evMode ? '' : t(`imp_${x.importance}`), catName0].filter(Boolean).join(' · '), basics, !evMode)}
    ${whenBody && !evMode ? sec('when', `🕒 ${esc(t('secWhen'))}`, [whenSummary, (x.after || []).length ? `🔒 ${(x.after || []).length}` : '', cleanWindows(x.windows).length ? windowsText(cleanWindows(x.windows)) : ''].filter(Boolean).join(' · '), whenBody + needsBody, true) : ''}
    ${helper ? '' : sec('place', `📍 ${esc(t('secPlace'))}`, x.place || (x.link ? t('link') : ''), placeBody, Boolean(x.place || x.link))}
    ${sec('steps', `▤ ${esc(t('steps'))}`, x.steps.length ? `${x.steps.length} · ${fmtDur(stepTotal)}` : '', stepsBody, true)}
    ${x.check ? '' : sec('checklist', `☑ ${esc(t('checklist'))}`, x.checklist.length ? String(x.checklist.length) : '', `<label><textarea name="checklist" rows="3" placeholder="${esc(t('checklistPh'))}" aria-label="${esc(t('checklist'))}">${esc((x.checklist || []).join('\n'))}</textarea>
      ${small('checklistHint')}</label>`, x.checklist.length > 0)}
    ${advancedOn() || taskRules.length || x.meal ? sec('rules', `⚙ ${esc(t(x.steps.length ? 'rulesWhole' : 'rules'))}`, taskRules.length ? String(taskRules.length) : '', rulesBody, true) : ''}
    ${sec('notes', esc(t('notes')), x.notes ? x.notes.slice(0, 30) : '', `<label><textarea name="notes" rows="2" aria-label="${esc(t('notes'))}">${esc(x.notes || '')}</textarea></label>`, Boolean(x.notes))}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${!helper && !evMode && !x.planBlockId ? `<button class="btn" value="plan">${esc(t('planIt'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew || x.id === 'meal_check' ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    collect(form);
    const again = (focus) => { e.preventDefault(); openTask(task, x); if (focus) modal.querySelector(focus)?.focus(); };
    if (action === 'add-step') {
      x.steps.push({ id: uid().slice(0, 6), title: '', minutes: 10 });
      again(`input[name=st_t_${x.steps.length - 1}]`);
      return;
    }
    if (action.startsWith('rm-step:')) {
      const [gone] = x.steps.splice(Number(action.slice(8)), 1);
      x.allRules = x.allRules.filter((r) => r.stepId !== gone.id); // its rules go with it
      if (x.anchorStepId === gone.id) x.anchorStepId = null;
      again(); return;
    }
    if (action.startsWith('up-step:')) {
      const i = Number(action.slice(8));
      [x.steps[i - 1], x.steps[i]] = [x.steps[i], x.steps[i - 1]];
      again(); return;
    }
    if (action.startsWith('rm-after:')) { x.after = (x.after || []).filter((_, k) => k !== Number(action.slice(9))); again(); return; }
    if (action === 'open-event' && linkedEvent) { if (linkedEvent.event) setTimeout(() => openTask(linkedEvent), 0); else setTimeout(() => openEvent(linkedEvent), 0); }
    if (evMode && !x.planDate && (action === 'ok' || action === 'add-evtask' || action === 'plan-evtasks' || action.startsWith('ev-task:'))) { e.preventDefault(); modal.querySelector('input[name=planDate]')?.focus(); return; }
    const wm = action.match(/^(w_|r(\d+)w_)(add|rm:(\d+))$/);
    if (wm) {
      const list = wm[2] != null ? (x.allRules[Number(wm[2])].windows = x.allRules[Number(wm[2])].windows || []) : (x.windows = x.windows || []);
      if (wm[3] === 'add') list.push({ days: list.length ? [] : [1, 2, 3, 4, 5], from: 540, to: 1020 }); else list.splice(Number(wm[4]), 1);
      again(); return;
    }
    if (action.startsWith('anchor:')) {
      const y = x.steps[Number(action.slice(7))];
      x.anchorStepId = x.anchorStepId === y.id ? null : y.id;
      again(); return;
    }
    if (action.startsWith('add-rule:')) {
      const stepId = action.slice(9) || null;
      x.allRules.push({ id: uid().slice(0, 6), when: stepId || helper ? 'failed' : 'planned', then: 'task', title: '', minutes: helper ? 15 : 10, place: stepId ? 'after' : 'before', stepId });
      again(`input[name=rti_${x.allRules.length - 1}]`); return;
    }
    if (action.startsWith('rm-rule:')) { x.allRules.splice(Number(action.slice(8)), 1); again(); return; }
    if (action === 'delete') {
      if (!confirm(t('confirmDeleteTask'))) { e.preventDefault(); return; }
      remove('tasks', x.id);
      for (const b of live('blocks').filter((y) => y.taskId === x.id && !y.done && y.date >= today())) deleteBlock(b);
      changed();
      return;
    }
    if (!x.title) { e.preventDefault(); return; }
    if (evMode) { x.due = x.planDate; x.allDay = x.planTime == null; x.eventTime = x.planTime; x.event = true; if (x.allDay) x.repeat = null; }
    const before = task ? Number(task.minutes) : null;
    const prevTask = task && get('tasks', task.id);
    let rec; let split = false;
    if (prevTask && isSeries(prevTask) && x.fromOcc && x.scope !== 'all' && x.fromOcc > (prevTask.seriesFrom || prevTask.due)) {
      split = true;
      // From this occurrence on: the series splits here.
      const { fromOcc, scope, planDate, planTime, planBlockId, allRules, ...fields } = x; void fromOcc; void scope; void planDate; void planTime; void planBlockId; void allRules;
      const tmp = saveTask({ ...x, id: prevTask.id }); // computes rules, steps and travel the usual way…
      const changes = { ...tmp }; delete changes.id; delete changes.createdAt;
      upsert('tasks', prevTask, { silent: true }); // …then the old series is put back and split
      rec = splitSeries(prevTask, changes, x.fromOcc);
      toast(t('seriesSplit', relDay(x.fromOcc)));
      void fields;
    } else {
      // A changed rule: the series restarts from the (new) due date.
      if (prevTask && isSeries(prevTask) && (prevTask.repeat !== x.repeat || (prevTask.every || 1) !== (x.every || 1) || JSON.stringify(prevTask.repeatDays || []) !== JSON.stringify(x.repeatDays || []) || prevTask.due !== x.due)) x.seriesFrom = x.due || today();
      rec = saveTask(x);
      if (isSeries(rec)) ensureSeries(rec);
    }
    // The "When" section: plan it, move it, change its length, or take it off the plan.
    if (!helper && !split && isSeries(rec) && rec.seriesTime != null && x.planTime != null && x.planTime !== rec.seriesTime) {
      // A new time for a recurring task on the plan: the whole series moves (occurrences changed by hand keep theirs).
      rec = upsert('tasks', { ...rec, seriesTime: x.planTime }, { silent: true });
      ensureSeries(rec);
    } else if (evMode && x.allDay) {
      const cur = x.planBlockId && get('blocks', x.planBlockId);
      if (cur) deleteBlock(cur); // no time any more: the day's all-day row shows it
    } else if (!helper && !split) {
      const cur = x.planBlockId && get('blocks', x.planBlockId);
      if (x.planDate) {
        const off = anchorOffset(cur || null, rec);
        const at = x.planTime != null ? Math.max(0, x.planTime - off) : null;
        if (cur) {
          const moved = upsert('blocks', { ...cur, date: x.planDate, start: at ?? cur.start, minutes: rec.minutes !== before ? rec.minutes : cur.minutes, title: rec.title, auto: false }, { silent: true });
          followParent(moved);
          warnConflicts(get('blocks', moved.id));
        } else if (action !== 'plan') {
          const b = planTask(rec, x.planDate, at);
          toast(t('plannedToast', relDay(x.planDate), fmtTime(b.start + anchorOffset(b))));
          warnConflicts(get('blocks', b.id));
        }
      } else if (cur) deleteBlock(cur);
    }
    if (action.startsWith('edit-rule:')) {
      const r = x.allRules[Number(action.slice(10))];
      if (r?.taskId) setTimeout(() => openTask(get('tasks', r.taskId)), 0);
    }
    if (action.startsWith('ev-task:')) setTimeout(() => openTask(get('tasks', action.slice(8))), 0);
    if (action === 'add-evtask') setTimeout(() => openEventTaskAdd(get('tasks', rec.id), { back: true }), 0);
    if (action === 'plan-evtasks') { syncEventTasks(); planEventTasks(get('tasks', rec.id)); setTimeout(() => openTask(get('tasks', rec.id)), 0); }
    if (action === 'plan') {
      const date = x.planDate || (rec.due && rec.due > today() ? rec.due : today());
      const b = planTask(rec, date, x.planTime != null ? Math.max(0, x.planTime - anchorOffset(null, rec)) : null);
      toast(t('plannedToast', relDay(date), fmtTime(b.start)));
      location.hash = `#/plan/${date}`;
    }
    changed();
  });

  function collect(form) {
    x.title = form.elements.namedItem('title').value.trim();
    x.steps = x.steps.map((y, i) => {
      const minutes = readDur(form, `st_m_${i}`, lenOf(y));
      const rec = form[`st_r_${i}`]?.checked;
      const { from, ...rest } = y; void from;
      return { ...rest, title: form[`st_t_${i}`].value.trim(), minutes, ...(rec ? { from: 'recipes' } : {}) };
    });
    x.minutes = x.steps.length ? x.steps.reduce((n, y) => n + lenOf(y), 0) || 30 : readDur(form, 'minutes', x.minutes || 30);
    if (form.checklist) x.checklist = lines(form.checklist.value);
    x.notes = form.notes.value.trim();
    if (form.importance) x.importance = Number(form.importance.value) || 3;
    if (form.place) { x.place = form.place.value.trim(); x.link = form.link.value.trim(); }
    if (form.tvThere) x.travel = { there: form.tvThere.checked, back: form.tvBack.checked, mode: form.tvMode.value || 'default' };
    if (form.buffer) x.buffer = form.buffer.value === '' ? null : Number(form.buffer.value) || 0;
    if (form.addAfter?.value) x.after = [...new Set([...(x.after || []), form.addAfter.value])];
    if (form.querySelector('[value="w_add"]')) x.windows = readWindows(form, 'w_', (x.windows || []).length);
    if (form.splitSteps) x.splitSteps = form.splitSteps.checked;
    if (form.routine) x.routine = form.routine.checked;
    if (form.evDays) {
      const when = form.evWhen.value;
      if (when === 'none') { x.eventId = null; x.eventOffset = null; } else {
        x.eventOffset = { days: Math.max(0, Number(form.evDays.value) || 0) * (form.evUnit.value === 'weeks' ? 7 : 1), when };
        const d = eventDate(linkedEvent); if (d) x.due = offsetDue(d, x.eventOffset);
      }
    }
    if (!helper) {
      if (form.due) x.due = form.due.value || null;
      x.repeat = form.repeat.value || null;
      if (x.repeat === 'times' && form.timesN) { x.timesN = Math.max(1, Number(form.timesN.value) || 1); x.timesPer = form.timesPer.value || 'week'; }
      if (form.every) x.every = Math.max(1, Number(form.every.value) || 1);
      if (form.querySelector('input[name=repeatDays]')) x.repeatDays = [...form.querySelectorAll('input[name=repeatDays]:checked')].map((el) => Number(el.value));
      if (form.repeatUntil) x.repeatUntil = form.repeatUntil.value || null;
      if (form.scope) x.scope = form.querySelector('input[name=scope]:checked')?.value || 'following';
      x.planDate = form.planDate.value || '';
      x.planTime = form.planTime.value ? parseTime(form.planTime.value) : null;
    }
    if (form.elements.namedItem('when')) x.when = form.elements.namedItem('when').value || '';
    if (form.remind) { if (form.remind.value === '') delete x.remind; else x.remind = Number(form.remind.value); }
    if (form.category) x.category = form.category.value || null;
    if (form.defaultStart) x.defaultStart = form.defaultStart.value ? parseTime(form.defaultStart.value) : null;
    if (form.meal) x.meal = form.meal.checked;
    x.allRules = x.allRules.map((r, i) => {
      const stepId = form[`rs_${i}`]?.value || null;
      const when = form[`rw_${i}`].value;
      const then = when === 'planned' ? 'task' : form[`rt_${i}`].value;
      if (then === 'groceries') return { id: r.id, when, then, stepId };
      const kind = form[`rk_${i}`].value;
      const places = when === 'planned' ? PREP_PLACES : RULE_PLACES;
      const place = places.includes(form[`rp_${i}`].value) ? form[`rp_${i}`].value : (when === 'planned' || r.when === 'planned' ? 'before' : 'next');
      const windows = form.querySelector(`[value="r${i}w_add"]`) ? readWindows(form, `r${i}w_`, (r.windows || []).length) : (r.windows || []);
      return { id: r.id, when, then, stepId, taskId: kind || null, title: kind ? get('tasks', kind)?.title : form[`rti_${i}`].value.trim(), minutes: readDur(form, `rm_${i}`, 30), place, windows };
    });
  }
  const form = modal.querySelector('form');
  form.addEventListener('change', (ev) => {
    if (ev.target.dataset.rerender) { collect(form); openTask(task, x); return; }
    // Setting a time sets the best time of day to match.
    if (ev.target.name === 'planTime' || ev.target.name === 'defaultStart') {
      const m = parseTime(ev.target.value);
      const w = form.elements.namedItem('when');
      if (m != null && w) w.value = partOfDay(m);
    }
    if (ev.target.dataset.rule != null) ev.target.closest('.rule').classList.toggle('is-groceries', ev.target.value === 'groceries');
    if (ev.target.dataset.rulekind != null) ev.target.closest('.rule').querySelector('.rule-title').classList.toggle('hide', Boolean(ev.target.value));
  });
  // Folding a section is remembered for next time.
  for (const d of form.querySelectorAll('details.ed-sec')) {
    d.addEventListener('toggle', () => { saveSettings({ edSec: { ...(state.settings.edSec || {}), [d.dataset.sec]: d.open } }); });
  }
}

function remindField(x) {
  return `<label>🔔 ${esc(t('remind'))}<select name="remind"><option value="">${esc(t('remindUseDefault', remindLabel(remindDefault())))}</option>${REMINDS.map((m) => `<option value="${m}" ${x.remind === m ? 'selected' : ''}>${esc(remindLabel(m))}</option>`).join('')}</select>
    <small>${esc(get('gcal', 'status') ? t('remindViaGcal') : t('remindNeedsGcal'))}</small></label>`;
}

// Tasks a rule can add: your to-dos and small steps, not meal types, and not the task itself.
function ruleTargets(x) {
  const used = new Set((x.allRules || []).map((r) => r.taskId).filter(Boolean));
  return live('tasks').filter((y) => used.has(y.id) || (y.id !== x.id && !y.meal && !y.check && (!y.done || y.repeat)))
    .sort((a, b) => Number(Boolean(b.helper)) - Number(Boolean(a.helper)) || a.title.localeCompare(b.title));
}

function saveTask(x) {
  const newStep = (title, minutes) => upsert('tasks', {
    id: uid(), createdAt: Date.now(), helper: true, title, minutes,
    category: x.category || null, checklist: [], rules: [], notes: '', done: false,
  }, { silent: true }).id;
  // A rule that adds a task needs one: drop the empty ones. A new name becomes a small task of its
  // own (listed under Preparations), so it can get a checklist and rules too: rules can chain.
  const all = (x.allRules || rulesForEditor(x)).filter((r) => r.then === 'groceries' || r.taskId || r.title);
  for (const r of all) if (r.then !== 'groceries' && !r.taskId) r.taskId = newStep(r.title, r.minutes || 10);
  for (const r of all) {
    // The length chosen here is the step's own length (for small steps, not for your to-dos).
    const tk = r.taskId && get('tasks', r.taskId);
    if (tk?.helper && r.minutes && tk.minutes !== r.minutes && !(tk.steps || []).length) upsert('tasks', { ...tk, minutes: r.minutes }, { silent: true });
  }
  const prep = all.filter((r) => r.when === 'planned').map((r) => ({ taskId: r.taskId, when: r.place || 'before' }));
  const rules = all.filter((r) => r.when !== 'planned').map((r) => (r.then === 'groceries'
    ? { id: r.id, when: r.when, then: r.then, stepId: r.stepId || null }
    : { id: r.id, when: r.when, then: 'task', stepId: r.stepId || null, taskId: r.taskId, title: get('tasks', r.taskId)?.title || r.title, minutes: r.minutes, place: r.place, ...(['slots', 'pool'].includes(r.place) ? { windows: cleanWindows(r.windows) } : {}) }));
  x.allRules = all;
  let due = x.due || null;
  if (x.repeat && x.repeat !== 'times' && !due) due = today(); // "X times per…" counts per period, without a due date
  if (x.repeat === 'times') due = null;
  const seriesFrom = REPEATS.includes(x.repeat) ? (x.seriesFrom && x.seriesFrom <= due ? x.seriesFrom : due) : null;
  const { allRules, newTask, planDate, planTime, planBlockId, ...clean } = x;
  void allRules; void newTask; void planDate; void planTime; void planBlockId;
  const steps = (x.steps || []).filter((y) => y.title && !isTravelStep(y));
  const prevTask = x.id ? get('tasks', x.id) : null;
  const saved = upsert('tasks', {
    ...clean, id: x.id || uid(), createdAt: x.createdAt || Date.now(), due, seriesFrom, prep, rules, steps, windows: cleanWindows(x.windows), after: (x.after || []).filter((id) => has('tasks', id)),
    minutes: steps.length ? steps.reduce((n, y) => n + (Number(y.minutes) || 0), 0) : x.minutes,
    priority: 0, done: Boolean(x.done), lenSet: true, // you saw the length: it counts as set
  }, { silent: true });
  return applyTravel(saved, { prev: prevTask || saved });
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
  // With steps, the time shown is when the anchor step starts (e.g. "Workout at 19:00"; getting there starts earlier).
  const off = !isNew && task ? anchorOffset(b, task) : 0;
  const anchorName = off ? anchorTitle(task) : null;
  openModal(`
    <h2>${esc(isShop ? `🛒 ${t('groceryTitle')}` : isNew ? t('newBlock') : t('editBlock'))}</h2>
    ${parent ? `<p class="hint">↳ ${esc(t('prepForBlock', parent.title, fmtTime(parent.start)))}</p>` : ''}
    ${status === 'failed' ? `<p class="conn bad">✕ ${esc(t('markedCouldnt'))}${b.missing?.length ? ` ${esc(t('missingWere', b.missing.join(', ')))}` : ''}</p>` : ''}
    ${isCheckStep(b) && !status ? `${hint('checkStepHint')}` : ''}
    ${isShop ? '' : `
      ${b.kind === 'prep' || task?.event ? `<input type="hidden" name="taskId" value="${esc(b.taskId || '')}">` : `<input type="hidden" name="taskId" value="${esc(b.taskId || '')}">
      <details class="task-pick" ${isNew && !b.taskId ? 'open' : ''}><summary><span class="field-label">${esc(t('linkTask'))}</span> <span class="tp-cur">${esc(task ? task.title : t('noTaskLinked'))}</span></summary>
        ${taskPickList(b.taskId)}
        <button type="button" class="tp-item none" data-tp="" data-q="">${esc(t('noTaskLinked'))}</button></details>`}
      <label>${esc(t('title'))}<input name="title" value="${esc(b.title)}" autocomplete="off"></label>`}
      ${task?.event ? `<p class="hint">📅 ${esc(t('blockOfEvent'))}</p>` : ''}
    <div class="three">
      <label>${esc(t('date'))}<input name="date" type="date" required value="${esc(b.date)}"></label>
      <label>${esc(anchorName ? t('anchorAt', anchorName) : t('start'))}<input name="start" ${TIME24} required value="${fmtTime(b.start + off)}"></label>
      <label>${esc(t('duration'))}${durField('minutes', b.minutes)}</label>
    </div>
    ${anchorName ? `<p class="hint">⚓ ${esc(t('blockAnchorHint', fmtTime(b.start), fmtTime(b.start + b.minutes)))}</p>` : ''}
    ${task?.place || task?.link ? `<p class="hint">${placeLink(task)}</p>` : ''}
    ${isShop ? shoppingSection(b) : ''}
    ${items.length && !isNew ? `<div class="field-label">${esc(t('checklist'))}</div>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${(b.checked || [])[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>` : ''}
    ${stepsSection(b)}
    ${isShop ? '' : `<div class="field-label">${esc(t('category'))}</div>${catChips(b.category)}`}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="allowOverlap" ${b.allowOverlap ? 'checked' : ''}> ${esc(t('allowOverlap'))}</label>
    ${isShop || isNew ? '' : task ? `<button class="btn small edit-task" value="edit-task" formnovalidate>${task.event ? '📅' : '▤'} ${esc(t(task.event ? 'editEventBtn' : 'editTaskSteps', task.title))}</button>`
    : `<button class="btn small edit-task" value="to-task" formnovalidate>▤ ${esc(t('makeTask'))}</button>`}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${isNew ? '' : status ? `<button class="btn" value="reset" formnovalidate>${esc(t('reset'))}</button>` : `<button class="btn" value="fail" formnovalidate>${esc(t('couldntDo'))}</button>`}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn" value="dup" formnovalidate>${esc(t('duplicate'))}</button>
      <button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    if (stepAction(b, action, e, openBlock)) return;
    if (action === 'edit-task') { setTimeout(() => openTask(get('tasks', task.id), null, { fromOcc: b.occ || null }), 0); return; }
    if (action === 'to-task') {
      // A plain block becomes a task (same title, length, category), so it can get steps and rules.
      const tk = upsert('tasks', { id: uid(), createdAt: Date.now(), title: b.title, minutes: b.minutes, category: b.category || null, importance: 3, due: null, repeat: null, notes: b.notes || '', done: false, checklist: [], rules: [], steps: [] }, { silent: true });
      upsert('blocks', { ...get('blocks', b.id), taskId: tk.id }, { silent: true });
      changed();
      setTimeout(() => openTask(tk, { ...tk, importance: 3, steps: [{ id: uid().slice(0, 6), title: '', minutes: 10 }], checklist: [], allRules: [] }), 0);
      return;
    }
    if (action === 'delete') {
      if (b.seriesId && task) {
        setTimeout(() => askScope({
          title: t('deleteWhich'), thisLabel: t('onlyThisOcc', relDay(b.occ)), followingLabel: t('thisAndFollowing'),
          onThis: () => { deleteBlock(b); upsert('tasks', { ...get('tasks', task.id), skipped: [...new Set([...(task.skipped || []), b.occ])] }, { silent: true }); changed(); },
          onFollowing: () => { endSeries(get('tasks', task.id), b.occ); changed(); },
        }), 0);
        return;
      }
      deleteBlock(b); changed(); return;
    }
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
    const minutes = readDur(form, 'minutes', b.minutes || 30);
    const shown = parseTime(form.start.value);
    // Back from "anchor time" to the block's start, with the new length (steps scale with it).
    const off2 = off && b.minutes ? Math.round(off * (minutes / b.minutes)) : 0;
    const rec = { ...b, id: b.id || uid(), date: form.date.value || b.date, start: shown != null ? Math.max(0, shown - off2) : b.start,
      minutes, notes: form.notes.value.trim(), allowOverlap: form.allowOverlap.checked };
    if (!isShop) {
      if (!title && picked) title = picked.title;
      if (!title) { e.preventDefault(); titleInput.focus(); return; }
      if (!category && picked) category = picked.category || null;
      Object.assign(rec, { title, category });
      if (form.taskId) rec.taskId = picked ? picked.id : null;
    }
    const finish = (r) => {
      const saved = upsert('blocks', r, { silent: true });
      followParent(saved);
      if (r.date !== currentDate()) location.hash = `#/plan/${r.date}`;
      changed();
      warnConflicts(get('blocks', saved.id));
    };
    const seriesChange = b.seriesId && task && !isNew && (rec.start !== b.start || rec.minutes !== b.minutes || rec.title !== b.title || (rec.category || null) !== (b.category || null));
    if (seriesChange) {
      e.preventDefault();
      const occ = b.occ;
      setTimeout(() => askScope({
        title: t('changeWhich'), thisLabel: t('onlyThisOcc', relDay(occ)), followingLabel: t('thisAndFollowing'),
        onThis: () => finish({ ...rec, auto: false }),
        onFollowing: () => {
          const tk = get('tasks', task.id);
          const own = realSteps(tk).length ? ownMinutes(tk) : Math.max(5, rec.minutes - (tk.minutes - ownMinutes(tk)));
          const main = (tk.steps || []).map((y) => (y.main ? { ...y, minutes: own } : y));
          const upd = upsert('tasks', { ...tk, title: rec.title, category: rec.category || null, seriesTime: rec.start + off2, steps: main, minutes: realSteps(tk).length ? tk.minutes : main.reduce((n, y) => n + (Number(y.minutes) || 0), 0) || own }, { silent: true });
          // Earlier occurrences keep their time; this one and the later ones follow the series.
          for (const sb of seriesBlocks(tk.id).filter((y) => y.occ < occ && y.auto)) upsert('blocks', { ...sb, auto: false }, { silent: true });
          for (const sb of seriesBlocks(tk.id).filter((y) => y.occ >= occ && !outcomeOf(y))) upsert('blocks', { ...sb, auto: true }, { silent: true });
          ensureSeries(get('tasks', upd.id));
          finish({ ...get('blocks', rec.id), date: rec.date, notes: rec.notes, allowOverlap: rec.allowOverlap, auto: rec.date === b.date });
        },
      }), 0);
      return;
    }
    if (rec.date !== b.date || rec.start !== b.start) rec.auto = false;
    finish(rec);
  });
  wireSteps(b, openBlock);
  const form = modal.querySelector('form');
  // Picking a task fills in the hidden field and tells the form (title, length and category follow).
  const pickBox = form.querySelector('.task-pick');
  if (pickBox) {
    wirePicker(pickBox, (id) => {
      form.taskId.value = id;
      for (const el of pickBox.querySelectorAll('.tp-item')) el.classList.toggle('on', el.dataset.tp === id);
      pickBox.querySelector('.tp-cur').textContent = id ? get('tasks', id)?.title || '' : t('noTaskLinked');
      pickBox.open = false;
      form.taskId.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
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
      form.querySelector('.tp-cur').textContent = x.title;
      const ti = form.elements.namedItem('title');
      if (ti && (!ti.value.trim() || isNew)) ti.value = x.title;
      if (isNew && x.minutes) { const inH = x.minutes >= 60 && x.minutes % 30 === 0; form.minutes.value = inH ? x.minutes / 60 : x.minutes; form.minutes_u.value = inH ? 'h' : 'min'; }
      if (x.category) form.category.value = x.category;
    }
  });
}

// Steps inside the block dialog: tick them, or mark one "couldn't do it".
function stepsSection(b) {
  if (!b?.id || !has('blocks', b.id)) return '';
  const st = stepTimes(b);
  if (!st.length) return '';
  const whole = outcomeOf(b) === 'done';
  return `<div class="field-label">▤ ${esc(t('steps'))}</div>
    <ul class="list checklist steps-dlg">${st.map((y) => `<li class="${y.state || (whole ? 'done' : '')}"><label><input type="checkbox" data-sstep="${esc(y.id)}" ${y.state === 'done' || whole ? 'checked' : ''}>
      <span class="item-text">${esc(y.title)}<small>${esc(range(y.start, y.end - y.start))}${y.state === 'failed' ? ` · ${esc(t('couldnt'))}` : ''}</small></span></label>
      ${y.state === 'failed' ? `<button class="btn small ghost" value="step-reset:${esc(y.id)}" formnovalidate>${esc(t('reset'))}</button>`
    : y.state || whole ? '' : `<button class="btn small ghost" value="step-fail:${esc(y.id)}" formnovalidate title="${esc(t('couldntDo'))}">✕ ${esc(t('couldnt'))}</button>`}</li>`).join('')}</ul>`;
}
function stepAction(b, action, e, reopen) {
  if (!/^step-(fail|reset):/.test(action)) return false;
  e.preventDefault();
  const [kind, sid] = action.split(':');
  setStepOutcome(get('blocks', b.id), sid, kind === 'step-fail' ? 'failed' : null);
  changed();
  if (modal.querySelector('[data-sstep]')) reopen(get('blocks', b.id));
  return true;
}
function wireSteps(b, reopen) {
  if (!b?.id) return;
  modal.querySelector('form').addEventListener('change', (ev) => {
    const sid = ev.target.dataset.sstep;
    if (!sid) return;
    const ok = tryStep(get('blocks', b.id), sid, ev.target.checked);
    changed();
    if (ok) reopen(get('blocks', b.id));
  });
}

function shoppingSection(b = null) {
  if (!ricetteConfigured() && !live('shopping').length) return '';
  const items = (b ? tripItems(b) : shoppingItems()).sort((x, y) => Number(x.checked) - Number(y.checked) || (x.name || '').localeCompare(y.name || ''));
  if (!items.length) return `${hint('listEmpty')}`;
  return `<div class="field-label">${esc(t('shoppingList'))}</div>
    <ul class="list checklist shop">${items.map((it) => `<li class="${it.checked ? 'got' : ''}"><label><input type="checkbox" data-shop="${esc(it.id)}" ${it.checked ? 'checked' : ''}>
      <span class="item-text">${esc(it.name)}<small>${esc(qtyText(it.qty, it.unit))}${it.sources?.length ? ` · ${esc(it.sources.join(', '))}` : ''}</small></span></label></li>`).join('')}</ul>
    ${hint('shopHint')}`;
}

function openTemplatesMenu() {
  const date = currentDate();
  const list = templates();
  openModal(`
    <h2>${esc(t('templates'))}</h2>
    <p class="hint">${esc(t('templatesMenuHint', fmtDay(date)))}</p>
    ${list.length ? `<ul class="list">${list.map((tp) => `<li><span class="item-text pad">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}</small></span>
      <button class="btn small" value="apply:${esc(tp.id)}">${esc(t('apply'))}</button></li>`).join('')}</ul>` : `${hint('noTemplates')}`}
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
      ${small('templateLinesHint')}</label>
    <div class="field-label">${esc(t('autoApply'))}</div>
    <div class="days">${weekdayNames().map(([wd, n]) => `<label class="day-pill"><input type="checkbox" name="day" value="${wd}" ${(x.days || []).includes(wd) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    ${hint('autoApplyHint')}
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
    const x = applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...quickFields(q) }, { silent: true }));
    if (q.due && q.time != null && !q.repeat) planTask(x, q.due, Math.max(0, q.time - anchorOffset(null, x))); // "Call Marco tue 15:00": straight onto the plan
    form.title.value = '';
    changed();
    document.getElementById(form.id === 'task-add' ? 'task-input' : 'side-add-input')?.focus();
  } else if (form.id === 'event-add') {
    const q = quickAdd(form.title.value);
    if (!q.title) return;
    const draft = { event: true, title: q.title, minutes: q.minutes || 120, category: findCategory(q.category), place: q.place || '', notes: '', done: false, planDate: q.due || '', planTime: q.time, allDay: q.time == null };
    form.title.value = '';
    if (!q.due) { openTask(null, null, { event: true, draft }); return; } // no date yet: the editor asks
    saveEvent(draft);
    toast(t('eventAdded', relDay(q.due)));
    changed();
    document.getElementById('event-input')?.focus();
  } else if (form.id === 'shop-add') {
    shopAdd(form.item.value);
    form.item.value = '';
    changed();
    $('#shop-add-input')?.focus();
  } else if (form.id === 'gh-form') saveGithub(form);
  else if (form.id === 'ric-form') saveRicette(form);
});

view.addEventListener('input', (e) => {
  if (e.target.id === 'tray-q' && ui.assign) { ui.assign.q = e.target.value; render(); }
  if (e.target.id === 'task-q') { ui.taskQ = e.target.value; render(); }
  if (e.target.id === 'event-q') { ui.eventQ = e.target.value; render(); }
  if (e.target.id === 'shop-q') { ui.shopQ = e.target.value; render(); }
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
  if (action === 'shop-toggle') { K().setChecked(id, el.checked); changed(); return; }
  if (action === 'step-done') {
    const ok = tryStep(get('blocks', el.dataset.block), el.dataset.step, el.checked);
    if (!ok) { el.checked = false; return; }
    changed();
    return;
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
  if (el.id === 'show-events') { saveSettings({ showEvents: el.checked }); }
  if (el.id === 'task-sort') { saveSettings({ taskSort: el.value }); render(); return; }
  if (el.id === 'tray-sort') { saveSettings({ traySort: el.value }); render(); return; }
  if (el.id === 'shop-sort') { setListMode(el.value); changed(); }
  if (el.id === 'trip-mode') { upsert('config', { id: 'shopping', value: { ...(get('config', 'shopping')?.value || {}), tripMode: el.value } }); changed(); }
  if (el.id === 'remind-default') { upsert('config', { id: 'reminders', value: { ...(get('config', 'reminders')?.value || {}), default: Number(el.value) } }); changed(); }
  if (el.form?.id === 'assign-opts') {
    saveSettings({ maxLoad: Number(el.form.maxLoad.value) || 8, freeWeekends: el.form.freeWeekends.checked });
    render();
    return;
  }
  if (el.id === 'day-picker' && isDate(el.value)) location.hash = `#/plan/${el.value}`;
  if (el.form?.id === 'lang-form') {
    saveSettings({ lang: el.value });
    applyLang(el.value);
    renderShell();
    render();
  }
  if (el.form?.id === 'travel-form') {
    const f = el.form;
    for (const kind of LEGS) if (el.name === `leg_${kind}`) setLegTask(kind, f[`leg_${kind}`].value);
    saveSettings({ travel: { ...travelCfg(), home: f.home.value.trim(), mode: f.mode.value, startHere: f.startHere.checked, thereDefault: f.thereDefault.value, backDefault: f.backDefault.value } });
    if (el.name === 'home' || el.name === 'mode') saveSettings({ travelCache: { ...travelCache(), routes: {} } });
    for (const x of travelTasks()) applyTravel(x);
    changed();
    return;
  }
  if (el.form?.id === 'planner-form') {
    const f = Object.fromEntries(new FormData(el.form));
    const dayStart = Number(f.dayStart); const dayEnd = Number(f.dayEnd);
    const hr = (a, b, d) => { const x = parseTime(f[a]); const y = parseTime(f[b]); return x != null && y != null && y > x ? [x, y] : d; };
    // "Breathing room" is one number: the margin after each task and the gap the planner keeps between blocks.
    const breath = Number(f.taskBuffer) || 0;
    saveSettings({
      dayStart, dayEnd: Math.max(dayEnd, dayStart + 1), buffer: Math.min(breath, 15), taskBuffer: breath, maxLoad: Number(f.maxLoad), defaultView: f.defaultView, freeWeekends: el.form.freeWeekends.checked,
      autoHours: { wd: hr('ahWdF', 'ahWdT', autoHoursFor('2026-11-02')), we: hr('ahWeF', 'ahWeT', autoHoursFor('2026-11-07')) },
    });
    if (el.name === 'defaultView') ui.view = null;
    if (el.name === 'taskBuffer') { for (const x of travelTasks()) applyTravel(x); changed(); return; }
  }
  if (el.form?.id === 'advanced-form') {
    const f = el.form; const fd = new FormData(f); const on = fd.getAll('tg');
    saveSettings({ snap: Number(f.snap.value), longUnits: f.longUnits.checked, advancedFeatures: f.advancedFeatures.checked, glance: fd.getAll('glance'), taskGroups: { today: on.includes('today'), tomorrow: on.includes('tomorrow'), soon: on.includes('soon'), soonDays: Number(f.soonDays.value) || 7 } });
    if (el.name === 'travelBuffer' || el.name === 'googleKey') {
      saveSettings({ travel: { ...travelCfg(), buffer: Number(f.travelBuffer.value) || 0, googleKey: f.googleKey.value.trim() }, travelCache: { ...travelCache(), routes: {} } });
      for (const x of travelTasks()) applyTravel(x);
      changed();
    }
  }
});

view.addEventListener('toggle', (e) => {
  const d = e.target.closest?.('details.advanced');
  if (d) ui.advancedOpen = d.open;
}, true);

view.addEventListener('click', (e) => {
  // In-app links (‹ › and Today on the plan) change the address without the browser's own jump to the top.
  const link = e.target.closest('a[href^="#/"]');
  if (link && !link.dataset.action && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.hash = link.getAttribute('href'); return; }
  const btn = e.target.closest('[data-action]');
  if (btn && btn.tagName === 'INPUT') return; // checkboxes are handled on change
  if (!btn) {
    // Tap on an empty part of the timeline: new block at that time.
    const tl = e.target.closest('.timeline');
    if (tl && !e.target.closest('.block')) {
      const g = tl.getBoundingClientRect();
      const step = Math.max(Number(tl.dataset.snap) || 15, 15);
      const m = Number(tl.dataset.start) + (e.clientY - g.top) / PPM;
      openTask(null, null, { event: true, date: tl.dataset.date, start: Math.max(0, Math.floor(m / step) * step) });
      return;
    }
    const block = e.target.closest('.block:not(.ghost)');
    if (block?.classList.contains('event')) { const ev = eventOf(block.dataset.id); if (ev?.event) openTask(ev); else if (ev) openEvent(ev); return; }
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
      const start = freeSlot(busyOn(date), 60, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? from;
      openTask(null, null, { event: true, date, start });
      break;
    }
    case 'new-meal': ui.mealDate = currentDate(); openMeal(null); break;
    case 'new-saved': openSavedPicker(currentDate()); break;
    case 'add-menu': openAddMenu(); break;
    case 'auto': openAutoPlanner(); break;
    case 'assign': if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: true, q: '' }; else ui.assign.open = !ui.assign.open; render(); break;
    case 'tray-toggle': ui.assign.open = !ui.assign.open; render(); break;
    case 'tray-planned': e.preventDefault(); ui.assign.showPlanned = !ui.assign.showPlanned; render(); break;
    case 'tray-why': e.preventDefault(); ui.assign.showWhy = !ui.assign.showWhy; render(); break;
    case 'filter': saveSettings({ taskFilter: { ...taskFilter(), [id]: !taskFilter()[id] } }); render(); break;
    case 'filter-cat': saveSettings({ taskFilter: { ...taskFilter(), cat: taskFilter().cat === id ? '' : id } }); render(); break;
    case 'wipe-local': if (confirm(t('wipeLocalConfirm'))) { wipeLocalData().then(() => { toast(t('wipedLocal')); changed(); }); } break;
    case 'filter-clear': saveSettings({ taskFilter: { fix: false, recurring: false, place: false, cat: '' } }); render(); break;
    case 'compact': saveSettings({ compact: !state.settings.compact }); render(); break;
    case 'import': openImport(); break;
    case 'assign-close': if (ui.assign) { ui.assign.ghosts = []; ui.assign.sel.clear(); ui.assign.open = false; } render(); break;
    case 'assign-opts': ui.assign.opts = !ui.assign.opts; render(); break;
    case 'assign-all': for (const x of trayTasks()) ui.assign.sel.add(x.id); render(); break;
    case 'assign-none': ui.assign.sel.clear(); render(); break;
    case 'assign-spread': {
      const days = spreadDays();
      if (!days.length) { toast(t('pastDay')); break; }
      const ids = ui.assign.sel.size ? trayTasks().filter((x) => ui.assign.sel.has(x.id)).map((x) => x.id) : trayTasks().map((x) => x.id);
      placeGhosts(ids, days);
      break;
    }
    case 'assign-range': {
      const r = ui.assign.range;
      if (!r || r.from !== r.to) ui.assign.range = { from: id, to: id };
      else if (r.from === id) ui.assign.range = null;
      else ui.assign.range = { from: id < r.from ? id : r.from, to: id > r.from ? id : r.from };
      render();
      break;
    }
    case 'assign-range-clear': ui.assign.range = null; render(); break;
    case 'assign-clear': ui.assign.ghosts = []; render(); break;
    case 'assign-add': addGhosts(); break;
    case 'ghost-rm': ui.assign?.ghosts.splice(Number(btn.dataset.i), 1); render(); break;
    case 'toggle-steps': saveSettings({ showSteps: !showSteps() }); render(); break;
    case 'view': ui.view = id; ui.scrolledFor = null; render(); if (id !== 'day') window.scrollTo(0, 0); break;
    case 'view-day': ui.view = 'day'; ui.scrolledFor = null; if (currentDate() === id) render(); else location.hash = `#/plan/${id}`; break;
    case 'ag-toggle': if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id); render(); break;
    case 'block-edit': openBlock(get('blocks', id)); break;
    case 'block-fail': setOutcome(get('blocks', id), 'failed'); changed(); break;
    case 'block-reset': setOutcome(get('blocks', id), null); changed(); break;
    case 'meal-type-new': openTask(null, { title: '', minutes: 30, routine: true, meal: true, defaultStart: 12 * 60, category: 'meals', prep: [], rules: [], checklist: [], notes: '' }); break;
    case 'saved-new': openTask(null, { title: '', minutes: 30, routine: true, meal: false, defaultStart: null, when: '', category: null, importance: 3, prep: [], rules: [], steps: [], checklist: [], notes: '' }); break;
    case 'event': { const ev = eventOf(id); if (ev?.event) openTask(ev); else if (ev) openEvent(ev); break; }
    case 'event-open': { const ev = eventOf(id); if (ev?.event) openTask(ev); else if (ev) openEvent(ev); break; }
    case 'event-new': openTask(null, null, { event: true, date: btn.dataset.date || currentDate(), start: btn.dataset.start ? Number(btn.dataset.start) : null }); break;
    case 'event-task-add': { const ev = eventOf(id); if (ev) openEventTaskAdd(ev); break; }
    case 'event-plan': { const ev = eventOf(id); if (ev) planEventTasks(ev); break; }
    case 'open-block': { const b = get('blocks', id); if (b) openBlock(b); break; }
    case 'now-left': { const b = get('blocks', id); if (b) { setStepOutcome(b, btn.dataset.step, 'done'); toast(t('goodTrip')); changed(); } break; }
    case 'now-done': { const b = get('blocks', id); if (b) { trySetBlockDone(b, true); changed(); } break; }
    case 'now-move': { const b = get('blocks', id); if (b) openBlock(b); break; }
    case 'reflow-undo': undoReflow(); break;
    case 'reflow-ok': ui.reflow = null; render(); break;
    case 'templates': openTemplatesMenu(); break;
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
    case 'task-fix': { const x = get('tasks', id); if (!x) break; const sec = btn.dataset.sec; if (sec) saveSettings({ edSec: { ...(state.settings.edSec || {}), [sec]: true } }); openTask(x); break; }
    case 'use-location': {
      if (!navigator.geolocation) { toast(t('noGeo')); break; }
      navigator.geolocation.getCurrentPosition((pos) => {
        saveSettings({ here: { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lon: Math.round(pos.coords.longitude * 1e5) / 1e5, at: Date.now() }, travel: { ...travelCfg(), startHere: true } });
        toast(t('locationSet')); changed();
      }, () => toast(t('noGeo')), { timeout: 10000, maximumAge: 300000 });
      break;
    }
    case 'travel-refresh': saveSettings({ travelCache: { ...travelCache(), routes: {} } }); scheduleTravelRefresh(); toast(t('travelRefreshing')); break;
    case 'list-mode': setListMode(id); changed(); break;
    case 'plan-trips': {
      const { blocks, missing } = planGroceryTrips();
      if (blocks.length) toast(t('tripsPlanned', blocks.map((b) => `${b.title.replace(`${t('groceryTitle')}`, '').replace(/^[ ·:]+/, '') || t('groceryTitle')} ${relDay(b.date)} ${fmtTime(b.start)}`).join(' · ')), 7000);
      if (missing.length) toast(t('tripNoTime', missing.map(shopName).join(', ')), 7000);
      changed();
      break;
    }
    case 'shop-new': openShopRec(null); break;
    case 'shop-rec': openShopRec(get(SHOPS(), id)); break;
    case 'shop-edit': openShopItem(get(SH(), id)); break;
    case 'shop-del': remove(SH(), id); changed(); break;
    case 'shop-share': shareShopList(); break;
    case 'shop-clear': for (const i of live(SH()).filter((x) => x.checked)) remove(SH(), i.id); changed(); break;
    case 'shop-putaway': {
      const n = K().putAway(isFood, (it) => ({ cat: DEPT_IDS.includes(shopDept(it)) && !NONFOOD.includes(shopDept(it)) ? shopDept(it) : null }));
      toast(t('putAwayDone', n));
      changed();
      break;
    }
    case 'toggle-done': ui.showDone = !ui.showDone; render(); break;
    case 'toggle-helpers': ui.showHelpers = !ui.showHelpers; render(); break;
    case 'toggle-saved': ui.showSaved = !ui.showSaved; render(); break;
    case 'tasks-tab': ui.tasksTab = id; saveSettings({ tasksTab: id }); if (route().name === 'shop' && id !== 'shop') location.hash = '#/tasks'; else render(); window.scrollTo(0, 0); break;
    case 'prep-del': if (confirm(t('confirmDeleteTask'))) { remove('tasks', id); changed(); } break;
    case 'fold': {
      // Done tasks start folded; everything else starts open. The choice is remembered.
      const cur = state.settings.folded ?? ['grp_done'];
      saveSettings({ folded: cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id] });
      render();
      break;
    }
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
    case 'leg-edit': { ensureLegTasks(); const x = legTemplate(btn.dataset.kind); if (x) openTask(x); break; }
    case 'gcal-remove': if (confirm(t('gcalRemoveConfirm'))) { removeCalendarData().then((n) => { toast(t('gcalRemoved', n)); changed(); }).catch(() => { toast(t('err_network')); }); } break;
    case 'ric-off': saveSettings({ ricetteRepo: '' }).then(() => { ui.ricMsg = ''; render(); }); break;
    case 'export': exportData(); break;
    default: break;
  }
});

modal.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action=open-task], [data-action=task-fix]');
  if (!a) return;
  e.preventDefault();
  const task = get('tasks', a.dataset.id);
  if (a.dataset.sec) saveSettings({ edSec: { ...(state.settings.edSec || {}), [a.dataset.sec]: true } });
  modal.close();
  setTimeout(() => openTask(task), 0);
});

view.addEventListener('sorted', (e) => onSorted(e.detail));

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

// ---------- assign: the tray of tasks to plan ----------
// "⇢ Assign" on the plan opens a tray of unplanned to-dos that stays while you switch Day / Week /
// Month / List. Tap tasks to select them; press, hold and drag them onto a day (or a time, in the
// Day and Week views); or tap days to pick a range and "Spread" them over it (or over what's on
// screen). Each day shows a load bar: what's planned, and what the tray would add. Nothing is
// planned until you tap "Add": first the tasks appear as dashed previews you can tap away.

function ghostsOn(date) { return (ui.assign?.ghosts || []).map((g, i) => ({ ...g, i })).filter((g) => g.date === date); }
// ---------- what's left to place ----------
// A task may need: several occurrences ("3 times a week"), its steps planned one by one (too long for
// one day, or "plan each step on its own"), other tasks done first, and only certain times (windows).

// The period a "times" task counts in: a day, an ISO week, a month or a year.
function periodKey(date, per) {
  return per === 'day' ? date : per === 'week' ? weekStart(date) : per === 'month' ? date.slice(0, 7) : date.slice(0, 4);
}
// How many more times it should happen in the period of `date`: target − done − planned − previewed.
function timesLeft(x, date) {
  if (x.repeat !== 'times') return 0;
  const per = x.timesPer || 'week'; const pk = periodKey(date, per);
  const inP = (d) => periodKey(d, per) === pk;
  const blocks = live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && inP(b.date) && b.outcome !== 'failed');
  const logged = (x.doneLog || []).filter(inP).length;
  const ghosts = (ui.assign?.ghosts || []).filter((g) => g.taskId === x.id && inP(g.date)).length;
  return Math.max(0, (Number(x.timesN) || 1) - blocks.length - logged - ghosts);
}
function timesDone(x, date) {
  if (x.repeat !== 'times') return 0;
  const per = x.timesPer || 'week'; const pk = periodKey(date, per);
  const inP = (d) => periodKey(d, per) === pk;
  return live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && inP(b.date) && outcomeOf(b) === 'done').length + (x.doneLog || []).filter(inP).length;
}
// Steps planned as their own blocks: when asked to, or when the whole is longer than a day's limit.
function splitsSteps(x) {
  const steps = (x.steps || []).filter((y) => y.title);
  if (steps.length < 2 || x.meal) return false;
  return Boolean(x.splitSteps) || steps.reduce((n, y) => n + stepLen({}, y), 0) > planSettings().maxLoad
    || live('blocks').some((b) => b.taskId === x.id && b.stepId);
}
// Steps that don't have a block (or a preview) yet.
function partsLeft(x) {
  const steps = (x.steps || []).filter((y) => y.title);
  const has = new Set([...live('blocks').filter((b) => b.taskId === x.id && b.stepId).map((b) => b.stepId),
    ...(ui.assign?.ghosts || []).filter((g) => g.taskId === x.id && g.stepId).map((g) => g.stepId)]);
  return steps.filter((y) => !has.has(y.id));
}
// Open tasks it needs first: [{task, block}] (block = where it's planned, if it is).
function prereqsOf(x) {
  return (x.after || []).map((id) => get('tasks', id)).filter((p) => p && !p.done && p.id !== x.id).map((p) => ({
    task: p,
    block: [...live('blocks').filter((b) => b.taskId === p.id && !outcomeOf(b) && b.kind !== 'prep'), ...(ui.assign?.ghosts || []).filter((g) => g.taskId === p.id)]
      .sort((a, b) => (a.date + String(a.start + a.minutes).padStart(4, '0') < b.date + String(b.start + b.minutes).padStart(4, '0') ? 1 : -1))[0] || null,
  }));
}
function trayTasks() {
  const planned = plannedTaskIds();
  const ghosted = new Set((ui.assign?.ghosts || []).map((g) => g.taskId));
  const td = today();
  return sortTaskList(openTasks().filter((x) => {
    if (!passesFilter(x)) return false;
    if (x.repeat === 'times') return timesLeft(x, td) > 0;
    if (splitsSteps(x)) return partsLeft(x).length > 0;
    return !planned.has(x.id) && !ghosted.has(x.id);
  }), state.settings.traySort || 'smart');
}
// What the planner places for these tasks over these days: one item per occurrence or step part.
function planningItems(tasks, dates) {
  const items = []; const skipped = [];
  // Your own order (once you've dragged tasks into one) nudges the planner: up to +30 for the first.
  const boostOf = new Map();
  if (openTasks().some((x) => x.order != null)) {
    const ord = manualOrder();
    ord.forEach((x, i) => boostOf.set(x.id, Math.round(30 * (1 - i / Math.max(1, ord.length - 1)))));
  }
  const inRun = new Set(tasks.map((x) => x.id));
  const lastItem = new Map();
  for (const x of tasks) {
    const base = { taskId: x.id, boost: boostOf.get(x.id) || 0, title: x.title, minutes: x.minutes || 30, due: x.repeat === 'times' ? null : x.due || null, importance: importanceOf(x), priority: x.priority, when: x.when, createdAt: x.createdAt, windows: x.windows?.length ? x.windows : null, prep: x.prep };
    let notBefore = null; const afterTasks = [];
    let waiting = null;
    for (const { task: p, block } of prereqsOf(x)) {
      if (block) { const e = { date: block.date, minute: block.start + block.minutes }; if (!notBefore || e.date > notBefore.date || (e.date === notBefore.date && e.minute > notBefore.minute)) notBefore = e; } else if (inRun.has(p.id)) afterTasks.push(p.id); else { waiting = p.title; break; }
    }
    if (waiting) { skipped.push({ taskId: x.id, why: 'needs', name: waiting }); continue; }
    if (x.repeat === 'times') {
      const per = x.timesPer || 'week';
      for (const pk of [...new Set(dates.map((d) => periodKey(d, per)))]) {
        const ds = dates.filter((d) => periodKey(d, per) === pk);
        const n = timesLeft(x, ds[0]);
        for (let k = 0; k < n; k++) items.push({ ...base, id: `${x.id}#${pk}#${k}`, days: ds, group: per === 'day' ? null : `${x.id}#${pk}`, afterTasks, notBefore });
      }
    } else if (splitsSteps(x)) {
      let prev = null;
      for (const y of partsLeft(x)) {
        const id = `${x.id}~${y.id}`;
        items.push({ ...base, id, stepId: y.id, title: `${x.title} · ${y.title}`, minutes: stepLen({}, y), prep: prev ? [] : x.prep, after: prev ? [prev] : [], afterTasks: prev ? [] : afterTasks, notBefore: prev ? null : notBefore });
        prev = id;
      }
      if (prev) lastItem.set(x.id, prev);
      continue;
    } else items.push({ ...base, id: x.id, afterTasks, notBefore });
    lastItem.set(x.id, items[items.length - 1]?.id);
  }
  for (const it of items) it.after = [...(it.after || []), ...(it.afterTasks || []).map((id) => lastItem.get(id)).filter(Boolean)];
  return { items, skipped };
}
function loadOf(date) {
  const now = busyOn(date).filter((b) => !b.allowOverlap && !b.outcome).reduce((n, b) => n + (b.minutes || 0), 0);
  const add = ghostsOn(date).reduce((n, g) => n + g.minutes + (g.lead || 0), 0);
  return { now, add, limit: planSettings().maxLoad };
}
// Hours to the nearest quarter, short: 2h, 1½h, ¾h, – for nothing.
// Morning, afternoon or evening for a time of day (the same split the planner uses).
function partOfDay(m) { return m < WINDOWS.morning[1] ? 'morning' : m < WINDOWS.afternoon[1] ? 'afternoon' : 'evening'; }

function hoursShort(m) {
  if (!m) return '–';
  const q = Math.max(1, Math.round(m / 15)); const h = Math.floor(q / 4);
  return `${h || ''}${['', '¼', '½', '¾'][q % 4]}h`;
}
function loadBar(date, { text = true } = {}) {
  // Shown in every view (not only while assigning): how full each day is against your daily limit.
  if (date < today()) return '';
  const { now, add, limit } = loadOf(date);
  const pct = (v) => Math.min(100, (v / limit) * 100);
  const over = now + add > limit;
  return `<span class="load${over ? ' over' : ''}${now >= limit ? ' full' : ''}${now || add ? '' : ' empty'}" ${ui.assign ? `data-drop="${date}"` : ''} title="${esc(t('loadTitle', fmtDur(now), fmtDur(now + add), fmtDur(limit)))}">
    <span class="ld-track"><i class="ld-now" style="width:${pct(now)}%"></i><i class="ld-add" style="left:${pct(now)}%;width:${Math.max(0, pct(now + add) - pct(now))}%"></i></span>
    ${text ? `<small>${esc(add ? (now ? `${hoursShort(now)}→${hoursShort(now + add)}` : `+${hoursShort(add)}`) : hoursShort(now))}</small>` : ''}</span>`;
}
function inRange(date) { const r = ui.assign?.range; return Boolean(r && date >= r.from && date <= r.to); }
// Tapping a day opens it, unless tasks are selected in the open drawer: then taps pick the days to spread over.
const selecting = () => Boolean(ui.assign?.open && ui.assign.sel?.size);
// The days "Spread" uses: the range you tapped, else what's on screen (from today on).
function spreadDays() {
  const r = ui.assign?.range;
  const date = currentDate(); const v = currentView(); const td = today();
  let days;
  if (r) { days = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d); } else if (v === 'day') days = [date];
  else if (v === 'week') days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  else if (v === 'month') { const m = date.slice(0, 7); days = []; for (let d = `${m}-01`; d.slice(0, 7) === m; d = addDays(d, 1)) days.push(d); } else days = Array.from({ length: 7 }, (_, i) => addDays(date, i));
  days = days.filter((d) => d >= td);
  const weekend = (d) => [0, 6].includes(parseDate(d).getDay());
  if (state.settings.freeWeekends && days.length > 1 && days.some((d) => !weekend(d))) days = days.filter((d) => !weekend(d));
  return days;
}
function spreadLabel() {
  const r = ui.assign?.range;
  if (r) return r.from === r.to ? fmtDay(r.from, { weekday: 'short', day: 'numeric' }) : `${fmtDay(r.from, { weekday: 'short', day: 'numeric' })} – ${fmtDay(r.to, { weekday: 'short', day: 'numeric' })}`;
  return t(`spreadOver_${currentView()}`);
}
// Put tasks on days as previews: spread over several days, or one after another from a time.
function placeGhosts(ids, dates, minute = null) {
  const s = planSettings(); const td = today(); const now = nowMinutes();
  const tasks = ids.map((id) => get('tasks', id)).filter(Boolean);
  const { items, skipped: blocked } = planningItems(tasks, dates);
  const leadOfItem = (it) => (it.stepId && !(it.prep || []).length ? 0 : leadOf(get('tasks', it.taskId)));
  const dayInfo = (d) => ({
    date: d,
    blocks: [...busyOn(d).filter((b) => !b.allowOverlap), ...ghostsOn(d).map((g) => ({ start: g.start - (g.lead || 0), minutes: g.minutes + (g.lead || 0) }))],
    from: Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((now + 5) / 5) * 5 : 0),
    to: autoHoursFor(d)[1],
  });
  let placed = []; let skipped = [];
  if (minute != null && dates.length === 1) {
    // Dropped at a time: one after another from there, each in the next free gap.
    const d = dayInfo(dates[0]);
    let from = Math.max(minute, d.from);
    const done = new Set();
    for (const it of items) {
      // One occurrence of a repeating task per drop; steps keep their order.
      if (it.group && done.has(it.group)) continue;
      if (it.notBefore && (it.notBefore.date > d.date)) { skipped.push({ taskId: it.taskId, why: 'needs', name: prereqsOf(get('tasks', it.taskId))[0]?.task.title }); continue; }
      const lead = leadOfItem(it); const need = it.minutes + lead;
      const at = freeSlot(d.blocks, need, { from: Math.max(from, it.notBefore?.date === d.date ? it.notBefore.minute : 0), dayStart: s.dayStart, dayEnd: Math.max(s.dayEnd, 1440), snap: s.snap });
      if (at == null) { skipped.push({ taskId: it.taskId, why: 'nofit' }); continue; }
      placed.push({ taskId: it.taskId, stepId: it.stepId || null, date: d.date, start: at + lead, minutes: it.minutes, lead });
      d.blocks.push({ start: at, minutes: need });
      from = at + need;
      if (it.group) done.add(it.group);
    }
  } else {
    // Dropping on a single day you chose: its limit is a guide, not a wall.
    const settings = dates.length === 1 ? { ...s, maxLoad: 1440 } : s;
    ({ placed, skipped } = spreadTasks({ tasks: items, days: dates.map(dayInfo), settings, leadOf: leadOfItem }));
  }
  skipped = [...blocked, ...skipped];
  if (placed.length && !state.settings.trayHintSeen) saveSettings({ trayHintSeen: true });
  ui.assign.ghosts.push(...placed.map(({ taskId, stepId, date, start, minutes, lead, reasons }) => ({ taskId, stepId: stepId || null, date, start, minutes, lead, reasons: reasons || [] })));
  for (const p of placed) if (!trayTasks().some((x) => x.id === p.taskId)) ui.assign.sel.delete(p.taskId);
  ui.assign.skipped = skipped;
  if (skipped.length) toast(skipNote(skipped), 6000);
  else if (placed.length) toast(t('spreadPreview', placed.length));
  render();
}
// Why some tasks weren't placed, in one line: "Meldebescheinigung waits for SPID livello 3 · Call: no free window".
function skipNote(skipped) {
  const seen = new Set(); const parts = [];
  for (const x of skipped) {
    const title = get('tasks', x.taskId)?.title || '';
    if (seen.has(x.taskId)) continue; seen.add(x.taskId);
    parts.push(x.why === 'needs' ? t('whyNeeds', title, x.name) : x.why === 'window' ? t('whyWindow', title) : x.why === 'toolong' ? t('whyLong', title) : x.why === 'waiting' ? t('whyWaiting', title) : t('whyFull', title));
  }
  return parts.join(' · ');
}
function assignDrop(id, tgt) {
  if (!tgt?.date) return;
  if (tgt.date < today()) { toast(t('pastDay')); return; }
  const ids = ui.assign.sel.has(id) ? [...ui.assign.sel] : [id];
  // Keep the tray's order (most urgent first).
  const order = trayTasks().map((x) => x.id);
  ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (ids.length === 1 && !ui.assign.sel.has(id)) {
    // One task dragged by hand goes straight on the plan; a selection is previewed first.
    const before = ui.assign.ghosts.length;
    placeGhosts(ids, [tgt.date], tgt.minute);
    const added = ui.assign.ghosts.splice(before);
    if (added.length) { const b = addGhostList(added); if (b) { toast(t('plannedToast', relDay(added[0].date), fmtTime(added[0].start))); changed(); } }
    return;
  }
  placeGhosts(ids, [tgt.date], tgt.minute);
}
function addGhosts() { const n = addGhostList(ui.assign.ghosts); ui.assign.ghosts = []; toast(t('assignAdded', n)); changed(); }
// Previews become real blocks.
function addGhostList(list) {
  let n = 0;
  for (const g of list) {
    const task = get('tasks', g.taskId);
    if (!task) continue;
    const step = g.stepId && (task.steps || []).find((y) => y.id === g.stepId);
    if (step) {
      // One step of a task planned on its own: its own block, linked to the task and the step.
      const first = (task.steps || []).filter((y) => y.title)[0]?.id === step.id;
      planTask(task, g.date, g.start, { minutes: g.minutes, stepId: step.id, title: `${task.title} · ${step.title}`, partial: !first });
    } else planTask(task, g.date, g.start, { minutes: g.minutes });
    n++;
  }
  return n;
}
function trayInfo(x) {
  const bits = [fmtDur(x.minutes || 30)];
  for (const y of (x.steps || []).filter((z) => z.travel && z.lookup !== false)) bits.push(`${MODE_ICON[y.mode] || '🚌'} ${y.known ? fmtDur(y.minutes) : '?'}`);
  if (x.repeat === 'times') bits.push(`×${timesLeft(x, today())}`);
  else if (splitsSteps(x)) bits.push(`▤ ${partsLeft(x).length}`);
  if (x.due) bits.push(x.due < today() ? t('late') : relDay(x.due));
  if (prereqsOf(x).some((p) => !p.block)) bits.push(`🔒 ${prereqsOf(x).find((p) => !p.block).task.title}`);
  if (x.windows?.length) bits.push(`🕒 ${windowsText(x.windows)}`);
  if (x.fromTitle) bits.push(`↪ ${x.fromTitle}`);
  return bits.join(' · ');
}
function trayHtml() {
  const a = ui.assign;
  const all = trayTasks();
  const q = (a.q || '').trim();
  const list = q ? all.filter((x) => matchesQ(taskHay(x), q)) : all;
  const sel = all.filter((x) => a.sel.has(x.id));
  const selMin = sel.reduce((n, x) => n + (x.minutes || 30), 0);
  const mode = state.settings.traySort || 'smart';
  const planned = alreadyPlanned().filter((x) => !q || matchesQ(taskHay(x), q));
  const row = (x) => `<button type="button" class="tchip trow${a.sel.has(x.id) ? ' on' : ''}" data-id="${esc(x.id)}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}" aria-pressed="${a.sel.has(x.id)}">
      <span class="trow-tick">${a.sel.has(x.id) ? '✓' : ''}</span>
      <span class="trow-text"><span class="chip-title">${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}${taskIssues(x).length ? ` <span class="iss-mark" title="${esc(issueText(x))}">⚠</span>` : ''}</span><small>${esc(trayInfo(x))}</small></span>
      <span class="trow-grip" aria-hidden="true">⠿</span></button>`;
  // "Now": straight into the next free slot of the day on screen (today: after now).
  const quick = (x) => (currentDate() >= today() ? `<button class="trow-add" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${currentDate()}" title="${esc(t('nextFreeSlot', relDay(currentDate())))}" aria-label="${esc(t('nextFreeSlot', relDay(currentDate())))}">↓</button>` : '');
  const rowQ = (x) => `<div class="trow-wrap">${row(x)}${quick(x)}</div>`;
  // Grouped by when it's due (like the Tasks tab) when sorted smartly or by due date; otherwise one list.
  let body;
  if (mode === 'smart' || mode === 'due') {
    const g = dateBuckets(list, (x) => x.due, today()); // the same date groups as the task list
    const label = (k) => (k === 'soon' ? t('grp_soonN', Number(taskGroupsCfg().soonDays) || 7) : k === 'nodate' ? t('grp_anytime') : t(`grp_${k}`));
    body = ['overdue', ...DATE_GROUPS, 'nodate'].filter((k) => g[k].length)
      .map((k) => `<div class="tray-grp">${esc(label(k))} <small>${g[k].length}</small></div>${sortTaskList(g[k], mode).map(rowQ).join('')}`).join('');
  } else body = list.map(rowQ).join('');
  const hint = a.range ? t('trayHintRange') : t('trayHint');
  const fixN = all.filter((x) => taskIssues(x).length).length;
  return `<div class="tray${a.open ? ' open' : ''}" role="region" aria-label="${esc(t('toPlan'))}">
    <div class="tray-head">
      <button class="tray-toggle" type="button" data-action="tray-toggle" aria-expanded="${Boolean(a.open)}"><span class="fold-ico">▴</span> <b>${esc(t('toPlan'))}</b>
        <small>${esc(sel.length ? t('nSelected', sel.length, fmtDur(selMin)) : a.ghosts.length ? t('nPreviews', a.ghosts.length) : String(all.length))}</small></button>
      ${sel.length ? `<button class="linkish" type="button" data-action="assign-none">${esc(t('selectNone'))}</button>` : all.length > 1 && a.open ? `<button class="linkish" type="button" data-action="assign-all">${esc(t('selectAll'))}</button>` : ''}
      ${fixN && !a.open ? `<button class="fchip warn" type="button" data-action="filter" data-id="fix" aria-pressed="${Boolean(taskFilter().fix)}">⚠ ${esc(t('f_fix'))} ${fixN}</button>` : ''}
      ${a.open ? `<button class="icon" type="button" data-action="assign-opts" aria-label="${esc(t('options'))}" aria-expanded="${Boolean(a.opts)}">⚙</button>` : ''}
      ${a.ghosts.length || sel.length ? `<button class="icon" type="button" data-action="assign-close" aria-label="${esc(t('close'))}">✕</button>` : ''}
    </div>
    ${a.opts ? `<form class="tray-opts" id="assign-opts">
      <label>${esc(t('maxLoad'))}<select name="maxLoad">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((h) => `<option value="${h}" ${h === Number(state.settings.maxLoad ?? 8) ? 'selected' : ''}>${h} h</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="freeWeekends" ${state.settings.freeWeekends ? 'checked' : ''}> <span>${esc(t('freeWeekends'))}</span></label>
      <small class="hint">${esc(t('autoHoursNow', fmtTime(autoHoursFor('2026-11-02')[0]), fmtTime(autoHoursFor('2026-11-02')[1]), fmtTime(autoHoursFor('2026-11-07')[0]), fmtTime(autoHoursFor('2026-11-07')[1])))}</small>
    </form>` : ''}
    ${a.open ? `
    <div class="tray-tools">${searchBox({ id: 'tray-q', value: a.q || '' })}${sortPicker('tray-sort', mode)}</div>
    ${filterBar()}
    ${list.length ? `<div class="tray-list">${body}</div>` : `<p class="hint tray-hint">${esc(q ? t('noMatch') : a.ghosts.length ? t('trayAllPlaced') : t('trayEmpty'))}</p>`}
    ${hint ? `<p class="hint tray-hint">${esc(hint)}</p>` : ''}
    ${plannedList(planned, 'tray-planned', a.showPlanned)}` : ''}
    ${a.ghosts.length ? `<details class="tray-planned tray-why"${a.showWhy ? ' open' : ''}><summary data-action="tray-why">✦ ${esc(t('whyThese'))} <small>${a.ghosts.length}</small></summary>
      ${[...a.ghosts].sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1)).map((g) => `<a class="tp-planned" href="#/plan/${esc(g.date)}" style="--c:${esc(catColor(get('tasks', g.taskId)?.category) || 'var(--accent)')}"><span class="tp-dot"></span><span>${esc(ghostTitle(g))}<small class="why-line">${esc(ghostWhy(g) || t('noReason'))}</small></span><small>${esc(relDay(g.date))} ${esc(fmtTime(g.start))}</small></a>`).join('')}
    </details>` : ''}
    <div class="tray-actions">
      ${all.length && !a.ghosts.length ? (sel.length ? `<button class="btn primary spread" type="button" data-action="assign-spread">✦ ${esc(t('spreadSel', spreadLabel()))}</button>` : `<button class="btn primary spread" type="button" data-action="auto">✦ ${esc(t('planBtn'))}</button>`) : ''}
      ${a.ghosts.length && all.length ? `<button class="btn small" type="button" data-action="assign-spread">✦ ${esc(t('spreadMore'))}</button>` : ''}
      ${a.range ? `<button class="btn small ghost" type="button" data-action="assign-range-clear">${esc(t('clearRange'))}</button>` : ''}
      ${a.ghosts.length ? `<button class="btn small" type="button" data-action="assign-clear">${esc(t('cancel'))}</button>
        <button class="btn primary" type="button" data-action="assign-add">${esc(t('addN', a.ghosts.length))}</button>` : ''}
    </div>
  </div>`;
}
function ghostTitle(g) {
  const task = get('tasks', g.taskId);
  const step = g.stepId && (task?.steps || []).find((y) => y.id === g.stepId);
  return step ? `${task.title} · ${step.title}` : task?.title || '';
}
// A preview on a timeline (Day and Week views): tap to take it back.
// Why a suggestion was picked ("due today · very important"), from the planner's scores.
function ghostWhy(g) { return g.reasons?.length ? reasonText(g.reasons) : ''; }
function ghostTip(g) { return [ghostWhy(g), t('ghostTap')].filter(Boolean).join(' — '); }
function assignGhostHtml(g, startMin) {
  const task = get('tasks', g.taskId);
  return `<div class="block ghost assign" data-action="ghost-rm" data-i="${g.i}" title="${esc(ghostTip(g))}" style="--c:${esc(catColor(task?.category) || 'var(--accent)')};top:${(g.start - (g.lead || 0) - startMin) * PPM}px;height:${Math.max((g.minutes + (g.lead || 0)) * PPM, 16)}px;left:1px;right:3px">
    <div class="blk-body"><div class="blk-title">${esc(ghostTitle(g))} <span class="ghost-x">✕</span></div><div class="blk-time">${range(g.start, g.minutes)}</div>${ghostWhy(g) ? `<div class="blk-why">✦ ${esc(ghostWhy(g))}</div>` : ''}</div></div>`;
}

// The app name in the corner takes you back to the plan.
$('#app-title').addEventListener('click', () => {
  if (route().name === 'today') window.scrollTo({ top: 0, behavior: 'smooth' }); else location.hash = '#/today';
});
$('#app-title').setAttribute('role', 'link');
$('#app-title').tabIndex = 0;
$('#app-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = '#/today'; });
// Phones: swipe left / right on the page switches tabs (not from a block, chip or the timeline, which drag).
(() => {
  let sx = 0; let sy = 0; let at = 0; let ok = false;
  document.addEventListener('touchstart', (e) => {
    const tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY; at = Date.now();
    ok = !e.target.closest('.block, .chip, .tchip, .timeline, .week, .tray, dialog, input, textarea, select, .shop-row, [draggable], .month, .wk-grid');
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!ok || document.body.classList.contains('is-dragging') || $('#modal')?.open) return;
    const tch = e.changedTouches[0]; const dx = tch.clientX - sx; const dy = tch.clientY - sy;
    if (Date.now() - at > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const i = TABS.indexOf(TAB_OF[route().name] || 'today'); if (i < 0) return;
    const j = i + (dx < 0 ? 1 : -1);
    if (j < 0 || j >= TABS.length) return;
    location.hash = `#/${TABS[j]}`;
  }, { passive: true });
})();

setupTrayDrag({
  onTap: (id, chip) => {
    if (ui.assign && !chip?.closest('.to-plan')) { if (ui.assign.sel.has(id)) ui.assign.sel.delete(id); else ui.assign.sel.add(id); render(); return; }
    const x = get('tasks', id); if (x) openPlanSaved(x, currentDate() < today() ? today() : currentDate());
  },
  onDrop: (id, tgt, chip) => {
    if (ui.assign && !chip?.closest('.to-plan')) { assignDrop(id, tgt); return; }
    if (!tgt?.date) return;
    if (tgt.date < today()) { toast(t('pastDay')); return; }
    const b = planTask(get('tasks', id), tgt.date, tgt.minute ?? undefined);
    toast(t('plannedToast', relDay(tgt.date), fmtTime(b.start)));
    changed();
    warnConflicts(get('blocks', b.id));
  },
  onDragging: (on) => {
    // Folding the tray while dragging must not move the page under the finger: keep its old height as margin.
    const tray = document.querySelector('.tray'), h = tray?.offsetHeight || 0;
    ui.dragging = on; document.body.classList.toggle('is-dragging', on);
    if (tray) tray.style.marginBottom = on ? `${Math.max(0, h - tray.offsetHeight)}px` : '';
  },
  label: (id, tgt) => {
    const n = ui.assign?.sel.has(id) ? ui.assign.sel.size : 1;
    const what = n > 1 ? t('nTasks', n) : get('tasks', id)?.title || '';
    if (!tgt) return what;
    return `${what} → ${fmtDay(tgt.date, { weekday: 'short', day: 'numeric' })}${tgt.minute != null ? ` ${fmtTime(tgt.minute)}` : ''}`;
  },
});

// Everything this device holds, gone (the repos are untouched): for handing a device to someone
// else, or a fresh start. Settings stay.
async function wipeLocalData() {
  for (const c of [...COLLECTIONS, ...Object.keys(RICETTE)]) await replaceCollection(c, []);
  await saveMeta({ dirty: false, dirtyShards: {}, syncedShards: {}, lastSync: null, lastError: null, ricetteSynced: null });
  ui.assign = null;
}
async function saveGithub(form, { fresh = null } = {}) {
  const prev = state.settings;
  const next = { owner: form.owner.value.trim(), repo: form.repo.value.trim(), token: form.token.value.trim() || state.settings.token, branch: form.branch.value.trim() || 'main' };
  const switching = prev.owner && prev.repo && (prev.owner !== next.owner || prev.repo !== next.repo) && live('tasks').concat(live('blocks')).length > 0;
  if (switching && fresh === null) {
    // Another repo: the data on this device would otherwise be merged into it (and its calendar
    // and tasks would keep showing until the first successful sync).
    askScope({
      title: t('switchRepoTitle'), thisLabel: t('switchRepoFresh'), followingLabel: t('switchRepoKeep'),
      onThis: () => saveGithub(form, { fresh: true }), onFollowing: () => saveGithub(form, { fresh: false }),
    });
    return;
  }
  if (fresh) await wipeLocalData();
  await saveSettings(next);
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
    // Items added to Everyday's own list before connecting move to Ricette's list.
    const own = live('shopping');
    for (const it of own) upsert('r_shopping', { ...it }, { silent: true });
    for (const it of own) remove('shopping', it.id);
    for (const sh of live('shops')) { upsert('r_shops', { ...sh }, { silent: true }); remove('shops', sh.id); }
    if (own.length) await runSync();
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
  history.replaceState(null, '', location.pathname + (go === 'add' ? '#/tasks' : go === 'today' ? '#/today' : '#/plan'));
  render();
  if (go === 'add') setTimeout(() => $('#task-input')?.focus(), 50);
  if (go === 'time') setTimeout(openSpare, 50);
  if (go === 'meal') setTimeout(() => { ui.mealDate = today(); openMeal(null); }, 50);
}

function showUpdateBar() {
  if ($('.update-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.innerHTML = `<span>${esc(t('newVersion'))}</span><button class="btn small primary" type="button">${esc(t('reloadNow'))}</button>`;
  bar.querySelector('button').addEventListener('click', () => location.reload());
  document.body.append(bar);
}

// ---------- start ----------

async function start() {
  await load();
  applyLang(state.settings.lang);
  seedCategories();
  seedMeals();
  migrateBlocksToEvents();
  syncEventTasks();
  renderShell();
  render();
  const kinds = new Set([...COLLECTIONS, ...Object.keys(RICETTE)]);
  onChange((kind) => {
    updateSyncBadge();
    if (kind !== 'meta' && kinds.has(kind)) renderIfSafe(); // sync bookkeeping alone never redraws the page
  });
  let lastTab = TAB_OF[route().name] || 'today';
  window.addEventListener('hashchange', () => {
    const tab = TAB_OF[route().name] || 'today';
    if (tab === 'plan' && lastTab !== 'plan') ui.scrolledFor = null; // back on the planner: jump to now again
    // Back to today from another day (the "Today" button): show now again.
    if (tab === 'plan' && currentDate() === today() && ui.shownDate && ui.shownDate !== today()) ui.scrolledFor = null;
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
  // New versions: the service worker installs them in the background; then a bar offers to reload.
  if ('serviceWorker' in navigator) {
    const had = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdateBar(); });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}

start();
