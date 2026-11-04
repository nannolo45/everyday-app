// model.js: moved from app.js (v36). See app.js for how the modules fit together.
import { catColor, categories, esc, GROCERY_MINUTES, hint, kitchen, planSettings, range, relDay, toast, ui } from './core.js';
import { t } from './i18n.js';
import { isEvent, isMealType, isSaved, isStep, isTodo, needsKind, withKind } from './kinds.js';
import { addQuantities, formatQty } from './parse.js';
import { sameFood } from './foods.js';
import { addDays, autoTemplatesFor, completeTask, fmtDur, fmtTime, freeSlot, importanceOf, isoDay, nextOccurrence, nowMinutes, occurrences, parseDate, reopenTask, REPEATS, ruleAt, templateBlocks, today } from './plan.js';
import { prepMinutes } from './recipes.js';
import { findConflicts, placeGroceries, placePrep, spreadTasks, windowOn, WINDOWS } from './smart.js';
import { contractTooNew, get, has, live, remove, state, uid, upsert } from './store.js';
import { isConfigured, queueCooked, ricetteConfigured, unqueueCooked } from './sync.js';
import { hereNow, isTravelStep, legMinutes, ownMinutes, realSteps, travelCache, travelCfg, travelOf } from './travel-plan.js';
import { closedAt, hoursFields, placeHours, placeOfTask } from './places.js';
import { placeNotFound } from './travel.js';
import { cleanWindows, openModal } from './widgets.js';
import { changed } from './shell.js';
import { openChecklist, openOutcome, saveTask } from './editors.js';
import { shopsList } from './views/shop.js';
import { weekStart } from './views/planner.js';
import { planGroceryTrips } from './planning.js';
import { afterPantryChange, pantrySnap } from './lowstock.js';

// ---------- tasks, preparations, checklists ----------

export function blocksOn(date) { return live('blocks').filter((b) => b.date === date); }
// Google Calendar events that day (read-only; see data-repo/scripts/gcal-sync.mjs), plus your own
// all-day events (events with a time are blocks of their event task, see ---------- events).
// (v71) Invitations you said you won't go to: {[eventId]: {at, took?, hidden?, google?}}. They stay in the day,
// greyed and no longer busy (hidden: gone from the day, still in Google).
export const evSkips = () => get('config', 'evSkips')?.value || {};
export const evSkipOf = (id) => evSkips()[id] || null;
export function setEvSkip(id, v) {
  const all = { ...evSkips() };
  if (v) all[id] = v; else delete all[id];
  upsert('config', { id: 'evSkips', value: all }, { silent: true });
}
// (v71) The answers to send to Google ("No"), read by the calendar sync.
export const rsvpAsks = () => get('config', 'gcalRsvp')?.value || [];
export function setRsvpAsks(list) { upsert('config', { id: 'gcalRsvp', value: list }, { silent: true }); }
export const isInvite = (e) => Boolean(e && e.rsvp && !e.own);
export function eventsOn(date) {
  const sk = evSkips();
  const evs = state.settings.showEvents === false ? [] : live('events').filter((e) => e.date === date && !sk[e.id]?.hidden)
    .map((e) => (sk[e.id] ? { ...e, skipped: true, busy: false } : e));
  return [...evs, ...ownAllDayOn(date)];
}
export function timedEventsOn(date) { return eventsOn(date).filter((e) => !e.allDay).map((e) => ({ ...e, isEvent: true, fixed: true })); }
// Everything that takes up time: your blocks plus busy calendar events.
export function busyOn(date) { return [...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)]; }
export const itemById = (id) => get('blocks', id) || get('events', id);
// To-dos: tasks of kind 'todo' (see kinds.js).
export function openTasks() { return live('tasks').filter((x) => !x.done && isTodo(x)); }
// To-dos and events: everything that gets travel legs.
export function travelTasks() { return live('tasks').filter((x) => !x.done && (isTodo(x) || isEvent(x))); }

// ---------- events ----------
// An event is a task of kind 'event' with a fixed date: it is never moved by the planner or the
// morning re-flow. With a time it has exactly one block (or a series of them when it repeats); without
// one it is all-day (`allDay`, no block). `due` is its date. Tasks to do around it carry `eventId` and
// `eventOffset` {days, when: 'before' | 'after'}; their due date follows the event (syncEventTasks).
export function ownEvents() { return live('tasks').filter(isEvent); }
export function ownAllDayOn(date) {
  // (v82) an appointment of several days (`days`) shows on each of them
  return ownEvents().filter((x) => x.allDay && x.due && date >= x.due && date <= addDays(x.due, Math.max(1, Number(x.days) || 1) - 1))
    .map((x) => ({ id: x.id, title: x.title, date, allDay: true, color: catColor(x.category) || 'var(--accent)', own: true, calendar: t('tabEvents'), location: x.place || '' }));
}
// An event by id: one of yours (a task) or an imported one.
export const eventOf = (id) => { const x = get('tasks', id); return isEvent(x) ? x : get('events', id); };
// The event's date: for your own, the day of its next block (it may have been dragged), else `due`.
export function eventDate(ev) {
  if (!ev) return null;
  if (!isEvent(ev)) return ev.date || null; // imported
  const b = ev.allDay ? null : nextBlockOf(ev.id);
  return b?.date || ev.due || null;
}
export function eventStart(ev) {
  if (!ev || ev.allDay) return null;
  if (!isEvent(ev)) return ev.start ?? null;
  const b = nextBlockOf(ev.id);
  return b ? b.start + anchorOffset(b) : (ev.eventTime ?? null);
}
// The tasks attached to an event (open first), and how ready it is.
export function eventTasksOf(id) { return live('tasks').filter((x) => x.eventId === id && !isStep(x)).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '').localeCompare(b.due || '')); }
export function eventReadiness(id) {
  const list = eventTasksOf(id);
  const open = list.filter((x) => !x.done);
  const planned = plannedTaskIds();
  return { total: list.length, open: open.length, unplanned: open.filter((x) => !planned.has(x.id)).length, late: open.filter((x) => x.due && x.due < today()).length };
}
export function readinessText(id) {
  const r = eventReadiness(id);
  if (!r.total) return '';
  if (!r.open) return `✓ ${t('allReady')}`;
  return [t('nToDo', r.open), r.unplanned ? t('nToPlan', r.unplanned) : '', r.late ? t('nLate', r.late) : ''].filter(Boolean).join(' · ');
}
export const offsetDue = (date, off) => addDays(date, (off?.when === 'after' ? 1 : -1) * Math.max(0, Number(off?.days) || 0));
export function offsetText(off) {
  const d = Math.max(0, Number(off?.days) || 0);
  if (!d) return t('sameDayAsEvent');
  const n = d % 7 === 0 ? d / 7 : d;
  const unit = d % 7 === 0 ? t(n === 1 ? 'week1' : 'weeksN', n) : t(n === 1 ? 'day1' : 'daysN', n);
  return t(off?.when === 'after' ? 'afterEvent' : 'beforeEvent', unit);
}
// A one-off event with a time is one block on the plan. These are that block and any extra copies
// (older versions could add a copy on the event's old date: see tidyEventBlocks).
const byWhen = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start);
export const eventBlocks = (id) => live('blocks').filter((b) => b.taskId === id && !b.kind && !b.stepId && !b.seriesId && !b.parentId).sort(byWhen);
// The event's block: the next open one, else the latest it had (past or ticked), so that editing an
// event that already happened moves that block instead of planning it a second time.
export function eventBlockOf(id) { return nextBlockOf(id) || eventBlocks(id).at(-1) || null; }
// Copies on another date: up to v40, saving an event whose block was past or ticked planned it again on
// the event's old date. Such a copy (not ticked, on the old date, while another block sits on a
// different date) is removed; the block you moved stays. Copies on the same day are left alone.
export function tidyEventBlocks(ev) {
  const list = eventBlocks(ev.id);
  if (list.length < 2) return false;
  const extra = list.filter((b) => b.date === ev.due && !outcomeOf(b) && list.some((k) => k.date !== ev.due));
  for (const b of extra) deleteBlock(b);
  return extra.length > 0;
}
// Keep dates in step: an event's `due` follows its block; an attached task's due follows the event.
export function syncEventTasks() {
  let any = false;
  for (const ev of ownEvents().filter((x) => !x.allDay && !x.repeat)) {
    if (tidyEventBlocks(ev)) any = true;
    const b = eventBlockOf(ev.id);
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
export function saveEvent(d) {
  const { planDate, planTime, ...fields } = d;
  const rec = saveTask({ ...fields, kind: 'event', due: planDate, allDay: planTime == null, eventTime: planTime ?? null, importance: 3, checklist: fields.checklist || [], steps: fields.steps || [], allRules: [] });
  if (planTime != null) planTask(rec, planDate, Math.max(0, planTime - anchorOffset(null, rec)));
  return get('tasks', rec.id);
}
// Records from before v34 (booleans instead of `kind`, see kinds.js) take the new shape. Dated just
// after their own timestamp: the change uploads once, and any real edit made elsewhere still wins.
// (v82) Routines added from the + before v81 lost their rhythm ("ogni gio" became "Quando capita") but kept
// the day: they are weekly again on that day. Those with no day left get asked once (Impegni → Routine).
export function repairRhythms() {
  for (const x of live('tasks')) {
    if (x.deleted || x.done || x.kind !== 'saved' || x.repeat || !(x.repeatDays || []).length || x.rhythmFixed) continue;
    const td = today();
    upsert('tasks', { ...x, repeat: 'weekly', every: 1, whenMode: 'repeat', pickTime: x.seriesTime == null, due: x.due || td, seriesFrom: x.seriesFrom || td, rhythmFixed: true }, { silent: true });
  }
}
export const noRhythm = () => live('tasks').filter((x) => !x.deleted && !x.done && x.kind === 'saved' && !x.repeat && !x.next && !x.archived && !x.palOut && !x.travelRole && !x.rhythmOk && !x.palestraId);
export function normalizeKinds() {
  let n = 0;
  for (const x of state.tasks) if (!x.deleted && needsKind(x)) { upsert('tasks', withKind(x), { silent: true, at: (x.updatedAt || 0) + 1 }); n++; }
  return n;
}
// Older plain blocks (no task) become events, so everything you put on the plan has a home.
export function migrateBlocksToEvents() {
  // (Blocks laid down by a day template stay plain: they are the template's, not events.)
  const plain = live('blocks').filter((b) => !b.taskId && !b.kind && !b.stepId && !b.parentId && !b.templateId && !outcomeOf(b) && b.date >= today());
  for (const b of plain) {
    const tk = upsert('tasks', { id: uid(), createdAt: Date.now(), kind: 'event', title: b.title || t('tabEvents'), minutes: b.minutes, category: b.category || null, due: b.date, eventTime: b.start, notes: b.notes || '', done: false, checklist: [], rules: [], steps: [] }, { silent: true });
    upsert('blocks', { ...b, taskId: tk.id }, { silent: true });
  }
  return plain.length > 0;
}

// Tasks with a block today or later that isn't finished yet.
// The next open block of a task (today on), or null.
export function nextPlanned(id) {
  const td = today();
  return live('blocks').filter((b) => b.taskId === id && !b.done && !b.outcome && b.date >= td && b.kind !== 'prep')
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))[0] || null;
}
// Already on the plan, so not to plan again: one-off tasks with an open block from today on (tasks to do
// "X times" or step by step still count as to plan while occurrences or steps are left).
export function alreadyPlanned() {
  const ids = plannedTaskIds();
  return openTasks().filter((x) => ids.has(x.id) && x.repeat !== 'times' && !splitsSteps(x) && (!x.repeat || x.seriesTime != null));
}
export function plannedWhen(x) { const b = nextPlanned(x.id); return b ? t('plannedAt', relDay(b.date), fmtTime(b.start)) : ''; }
export function plannedTaskIds() {
  const td = today();
  return new Set(live('blocks').filter((b) => b.taskId && !b.done && !b.outcome && b.date >= td && b.kind !== 'prep').map((b) => b.taskId));
}

export function prepOf(task) {
  return (task?.prep || []).map((p) => ({ ...p, task: get('tasks', p.taskId) })).filter((p) => p.task);
}
// Minutes of "right before" preparation a task needs in front of it.
export function leadOf(task) {
  return prepOf(task).filter((p) => p.when === 'before').reduce((s, p) => s + (p.task.minutes || 10), 0);
}
export function checklistOf(block) { return (block?.taskId && get('tasks', block.taskId)?.checklist) || []; }

// ---------- readiness: what the planner still needs to know ----------
// Each issue is an i18n key; the editor section to open is `secOf`.
export function taskIssues(x) {
  if (!x || x.done || isStep(x) || isSaved(x) || x.travelRole) return [];
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
export const ISSUE_SEC = { iss_len: 'basics', iss_place: 'place', iss_home: 'place', iss_geo: 'place', iss_travel: 'place', iss_long: 'steps' };
export function issueText(x) { return taskIssues(x).map((k) => t(k)).join(' · '); }
export function checklistLeft(items, checked = []) { return items.filter((_, i) => !checked[i]).length; }

export function setTaskDone(task, done, date = today()) {
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

export function newBlock(fields) {
  const b = upsert('blocks', { id: uid(), done: false, ...fields }, { silent: true });
  linkFor(b);
  return b;
}

// Put a task on a day: at `start`, or in the first free gap (from now, if it's today).
export function planTask(task, date, start = null, extra = {}) {
  const s = planSettings();
  const { series, ...fields0 } = extra;
  const fields = isMealType(task) && !fields0.kind && !fields0.stepId ? { kind: 'meal', recipes: [], servings: 2, ...fields0 } : fields0; // (v80) a meal type's turn is a meal
  const minutes = fields.minutes || (fields.stepId ? task.minutes : !(task.stepsDone || []).length && task.dayMinutes && isSeries(task) ? minutesOn(task, date) : minutesLeft(task)) || 30;
  let at = start;
  // (v85) its place has opening hours: the first free time that day when it's open
  if (at == null && !fields.stepId && placeHours(task)) {
    const p = spreadTasks({ tasks: [{ id: 'x', taskId: task.id, title: task.title, minutes, ...hoursFields(task) }], settings: { ...s, maxLoad: 1440 },
      days: [{ date, blocks: busyOn(date).filter((b) => !b.allowOverlap), from: (date === today() ? nowMinutes() : s.dayStart) + leadOf(task), to: s.dayEnd }] }).placed[0];
    if (p) at = p.start;
  }
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
  // Part of it was done on earlier days: this block holds only the steps left.
  const before = !fields.stepId && (task.stepsDone || []).length ? { doneBefore: [...task.stepsDone] } : {};
  return newBlock({ date, start: at, minutes, title: task.title, category: task.category || null, taskId: task.id, ...before, ...fields });
}

// ---------- recurring tasks as a series of blocks ----------
// Once a recurring task has a time, every occurrence in the coming weeks is a block of its own
// (`seriesId` = the task, `occ` = the date). Blocks still `auto` follow the series (time, length,
// title); one you change on its own stops following. Rules live in plan.js (occurrences()).
export const SERIES_DAYS = 56;
export const isSeries = (x) => Boolean(x && (REPEATS.includes(x.repeat) || REPEATS.includes(x.next?.repeat)) && !isStep(x));
// The fixed time of a series on a day (its own, or the next rule's from that rule's date on).
// (v66) A weekly series may have a time for each day it comes back on (`slotTimes` {isoDay: minute}, the
// week grid's "every week"); otherwise one time for all.
const seriesTimeOn = (task, d) => { const r = ruleAt(task, d); return r.slotTimes?.[isoDay(d)] ?? r.seriesTime; };
// (v71) …and a length for some of its days (`dayMinutes` {isoDay: minutes}): Pulizie 45m on Tue and Thu, 2h on Sat.
export const hasDayLen = (x) => Boolean(x && x.repeat === 'weekly' && (x.repeatDays || []).length > 1);
export function minutesOn(task, d) {
  const r = ruleAt(task, d);
  return (r.repeat === 'weekly' && r.dayMinutes?.[isoDay(d)]) || r.minutes || task.minutes || 30;
}
export function setDayMinutes(task, iso, minutes) {
  const dm = { ...(task.dayMinutes || {}) };
  if (!minutes || minutes === task.minutes) delete dm[iso]; else dm[iso] = minutes;
  return upsert('tasks', { ...task, dayMinutes: Object.keys(dm).length ? dm : null }, { silent: true });
}
// (v71) "Apprendimento intelligente" (a setting): when a weekday's turns took a lot more or less than planned
// three times in a row (real times, from the timer or a corrected end), the block's Esito offers that length.
export function learnHint(b) {
  if (!state.settings.smartLearn || !b?.taskId || !b.endedAt) return null;
  const x = get('tasks', b.taskId);
  if (!hasDayLen(x) || (x.learnOff || []).includes('all')) return null;
  const iso = isoDay(b.date);
  if ((x.learnOff || []).includes(iso)) return null;
  const same = live('blocks').filter((y) => y.taskId === x.id && !y.stepId && y.kind !== 'prep' && y.endedAt && outcomeOf(y) === 'done' && isoDay(y.date) === iso && y.date <= b.date)
    .sort((a, c) => (a.date < c.date ? 1 : -1)).slice(0, 3);
  if (same.length < 3) return null;
  const cur = minutesOn(x, b.date);
  const real = same.map((y) => y.minutes);
  const far = (m) => Math.abs(m - cur) >= Math.max(15, cur * 0.25);
  if (!real.every(far) || !(real.every((m) => m > cur) || real.every((m) => m < cur))) return null;
  const med = [...real].sort((a, c) => a - c)[1];
  const minutes = Math.max(5, Math.round(med / 15) * 15);
  if (minutes === cur) return null;
  return { task: x, iso, minutes, cur, real, longer: minutes > cur };
}
export const seriesBlockId = (taskId, occ, slot = 0) => (slot ? `s~${taskId}~${occ}~${slot}` : `s~${taskId}~${occ}`); // (v82) a second time that day: ~1, ~2…
export const seriesBlocks = (taskId) => live('blocks').filter((b) => b.seriesId === taskId);
// ---------- (v69) the end of a routine ----------
// A routine may end on a date (`repeatUntil`) or after N turns that count (`repeatCount`). A turn counts
// when it's marked done, unless you said otherwise on it (`block.counts`); a turn not done, or done in
// part, counts only if you say so. Ended routines leave the lists and the plan; they're kept ("Concluse").
export const turnCounts = (b) => (b.counts != null ? Boolean(b.counts) : outcomeOf(b) === 'done');
export function countedOf(x) {
  if (!x) return 0;
  return live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && !b.stepId && outcomeOf(b) && turnCounts(b)).length + (x.doneLog || []).length;
}
export const turnsLeftOf = (x) => (x?.repeatCount ? Math.max(0, Number(x.repeatCount) - countedOf(x)) : Infinity);
export const openTurnsOf = (x, td = today()) => live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && !b.stepId && !outcomeOf(b) && b.date >= td).length;
export function isEnded(x, td = today()) {
  if (!x || !(x.repeat || x.next?.repeat)) return false;
  if (x.repeatUntil && td > x.repeatUntil) return true;
  return Boolean(x.repeatCount) && countedOf(x) >= Number(x.repeatCount);
}
export function ensureSeries(task) {
  if (!isSeries(task) || (task.seriesTime == null && task.next?.seriesTime == null) || task.done) return;
  const td = today();
  let want = isEnded(task) ? [] : occurrences(task, td, addDays(td, SERIES_DAYS)).filter((d) => seriesTimeOn(task, d) != null && !ruleAt(task, d).pickTime && !(task.replan || []).includes(d)); // (v81) a turn sent back to plan again
  // (v77) one block per turn: two devices used to make the same turn each (random ids, both kept by the
  // sync), and a turn already on the plan another way (placed by hand, a session from Palestra, a move)
  // got a second one. Series blocks now have an id made of the task and the day, and duplicates go.
  const mine = live('blocks').filter((b) => b.taskId === task.id && b.kind !== 'prep' && !b.stepId && !b.extra);
  const rank = (b) => (outcomeOf(b) ? 8 : 0) + (b.startedAt ? 4 : 0) + (!b.auto ? 2 : 0) + (b.id === seriesBlockId(task.id, b.occ, b.slot || 0) ? 1 : 0);
  // (v82) several times a day (`dayTimes`): each time is a turn of its own, `slot` 1, 2… after the first
  const turnOf = (b) => { const o = b.occ || (!b.seriesId ? b.date : null); return o && b.slot ? `${o}#${b.slot}` : o; };
  const best = new Map();
  for (const b of mine) { const k = turnOf(b); if (!k) continue; const c = best.get(k); if (!c || rank(b) > rank(c) || (rank(b) === rank(c) && b.id < c.id)) best.set(k, b); } // same on every device
  for (const b of mine) { const k = turnOf(b); if (k && best.get(k) !== b && b.auto && !outcomeOf(b) && !b.startedAt) remove('blocks', b.id); }
  const taken = new Set(best.keys());
  const have = new Map(seriesBlocks(task.id).filter((b) => best.get(turnOf(b)) === b).map((b) => [turnOf(b), b]));
  if (task.repeatCount) { // "per N volte": recorded turns stay; only as many open ones as still count
    const recorded = (d) => have.get(d) && outcomeOf(have.get(d));
    const open = want.filter((d) => !recorded(d)).slice(0, turnsLeftOf(task));
    want = want.filter((d) => recorded(d) || open.includes(d));
  }
  const extra = (task.dayTimes || []).slice(1);
  const wantKeys = [];
  for (const d of want) {
    const len = minutesOn(task, d);
    const slots = [[0, seriesTimeOn(task, d)], ...extra.map((tm, i) => [i + 1, tm])];
    for (const [slot, tm] of slots) {
      const k = slot ? `${d}#${slot}` : d; wantKeys.push(k);
      const start = Math.max(0, tm - anchorOffset(null, task));
      const b = have.get(k);
      if (!b) { if (!taken.has(k)) planTask(task, d, start, { id: seriesBlockId(task.id, d, slot), seriesId: task.id, occ: d, ...(slot ? { slot } : {}), auto: true, series: true, minutes: len, ...(isMealType(task) ? { kind: 'meal', recipes: [], servings: 2 } : {}) }); /* (v80) a meal type that repeats: meal blocks */ continue; }
      if (b.auto && !outcomeOf(b) && (b.start !== start || b.minutes !== len || b.title !== task.title || (b.category || null) !== (task.category || null))) {
        upsert('blocks', { ...b, start, minutes: len, title: task.title, category: task.category || null }, { silent: true });
      }
    }
  }
  const wantSet = new Set(wantKeys);
  for (const [k, b] of have) if (k.slice(0, 10) >= td && !wantSet.has(k) && b.auto && !outcomeOf(b)) remove('blocks', b.id);
}
export function ensureAllSeries() { for (const x of live('tasks').filter((y) => isSeries(y) && (y.seriesTime != null || y.next?.seriesTime != null) && !y.done)) ensureSeries(x); syncEventTasks(); publishTrips(); }
// The grocery trips to come, shared with Ricette (prefs record {id: 'trips', value}) so its list can show them:
// [{id, date, start, minutes, shops}] in time order (shops = shop ids; [] = a trip for anywhere). Written only
// when it changed, never while the contract is newer than Everyday's.
export function upcomingTrips(td = today()) {
  return live('blocks').filter((b) => b.kind === 'groceries' && !outcomeOf(b) && b.date >= td)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))
    .map((b) => ({ id: b.id, date: b.date, start: b.start, minutes: b.minutes, shops: [...(b.shops || [])] }));
}
export function publishTrips() {
  if (!ricetteConfigured() || contractTooNew()) return false;
  const value = upcomingTrips();
  const cur = get('r_prefs', 'trips');
  if (JSON.stringify(cur?.value || []) === JSON.stringify(value) && (cur || !value.length)) return false;
  upsert('r_prefs', { ...(cur || {}), id: 'trips', value }, { silent: true });
  return true;
}
// Change a series from one occurrence on: the old series ends the day before, a copy carries the
// changes from `fromOcc`, and the blocks from that day on move to the copy.
export function splitSeries(prev, changes, fromOcc) {
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
export function endSeries(task, fromOcc) {
  for (const b of seriesBlocks(task.id).filter((x) => x.occ >= fromOcc && !outcomeOf(x))) deleteBlock(b);
  const first = task.seriesFrom || task.due;
  if (!first || fromOcc <= first) { upsert('tasks', { ...task, done: true, doneAt: Date.now() }, { silent: true }); return; }
  const until = addDays(fromOcc, -1);
  upsert('tasks', { ...task, repeatUntil: until, ...(task.due >= fromOcc ? { done: true, doneAt: Date.now() } : {}) }, { silent: true });
}

export const isCheckStep = (b) => get('tasks', b?.taskId)?.check === 'ingredients';

// Create the linked blocks a block needs: preparations for its task, and keep them in order.
export function linkFor(block) {
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
export function followParent(block) {
  linkFor(block);
  if (block.kind === 'meal' && block.groceryId) {
    const g = get('blocks', block.groceryId);
    if (g && g.auto && !g.done && !(g.date < block.date || (g.date === block.date && g.start + g.minutes <= block.start))) {
      const pos = placeGroceries({ meal: block, minutes: g.minutes, blocksOn: (d) => busyOn(d).filter((x) => x.id !== g.id), today: today(), nowMin: nowMinutes(), settings: planSettings() });
      upsert('blocks', { ...g, ...pos }, { silent: true });
    }
  }
}

export function deleteBlock(b) {
  remove('blocks', b.id);
  for (const c of live('blocks').filter((x) => (x.parentId === b.id || x.sourceId === b.id) && !x.done && !x.outcome)) remove('blocks', c.id);
}

// ---------- outcomes and rules ----------
// A block ends up done, or "couldn't do it". Tasks can carry rules that react to that, e.g.
// "Check ingredients: when it couldn't be done → plan a grocery trip before the meal".

export function outcomeOf(b) { return b?.outcome || (b?.done ? 'done' : null); }

export function setOutcome(block, outcome, { steps = true } = {}) {
  const prev = outcomeOf(block);
  const b = upsert('blocks', { ...block, done: outcome === 'done', outcome: outcome || null }, { silent: true });
  // A meal eaten counts as cooked in Ricette too (cookedCount / lastCooked), at the next sync.
  if (b.kind === 'meal' && ricetteConfigured()) {
    if (outcome === 'done' && prev !== 'done') for (const x of mealRecipes(b)) if (x.recipeId && get('r_recipes', x.recipeId)) queueCooked(x.recipeId, b.id);
    if (outcome !== 'done' && prev === 'done') unqueueCooked(b.id);
  }
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
export function stepsOf(b) {
  if (b?.stepId) return []; // a single step planned on its own
  const task = b?.taskId && get('tasks', b.taskId);
  // A block that continues a task started on earlier days holds only the steps left at the time.
  const before = new Set(b?.doneBefore || []);
  return (task?.steps || []).filter((x) => x.title && !before.has(x.id));
}
// ---------- a task over several days ----------
// A task whose day ends with only some steps ticked: that day's block stays as a trace (outcome
// 'partial', its ticks kept), the ticked steps join task.stepsDone, and the rest is planned again as a
// block of its own (doneBefore = the steps already done then). So the plan shows every day the task
// was on your plate, and what got done on each.
export const stepsDoneOf = (task) => new Set(task?.stepsDone || []);
export function stepsLeftOf(task) { const done = stepsDoneOf(task); return (task?.steps || []).filter((y) => y.title && !done.has(y.id)); }
// What's left of a task, in minutes (its whole length when nothing is done yet).
export function minutesLeft(task) {
  if (!(task?.stepsDone || []).length) return task?.minutes || 30;
  return stepsLeftOf(task).reduce((n, y) => n + stepLen({}, y), 0) || task.minutes || 30;
}
// The days a task has been on the plan so far: {first, last, days} (null when never planned).
export function taskSpan(task) {
  const dates = [...new Set(live('blocks').filter((b) => b.taskId === task.id && b.kind !== 'prep' && !b.seriesId).map((b) => b.date))].sort();
  return dates.length ? { first: dates[0], last: dates[dates.length - 1], days: dates.length } : null;
}
// Which day of the task a block is (1 for the first), counting only days it was planned on.
export function taskDayOf(b) {
  // Only a one-off to-do has "days": saved tasks, meals, events and repeating tasks come back by design.
  const task = b?.taskId && !b.seriesId && get('tasks', b.taskId);
  if (!task || !isTodo(task) || task.repeat) return 0;
  const dates = [...new Set(live('blocks').filter((x) => x.taskId === b.taskId && x.kind !== 'prep').map((x) => x.date))].sort();
  return dates.length > 1 ? dates.indexOf(b.date) + 1 : 0;
}
// Leave a past block as a trace of the steps done that day; returns the task as updated (or null).
export function leaveTrace(b) {
  const task = get('tasks', b.taskId);
  const ticked = stepsOf(b).filter((y) => b.stepState?.[y.id] === 'done').map((y) => y.id);
  if (!task || !ticked.length) return null;
  upsert('blocks', { ...b, outcome: 'partial' }, { silent: true });
  return upsert('tasks', { ...task, stepsDone: [...new Set([...(task.stepsDone || []), ...ticked])] }, { silent: true });
}
// A step's length on a block: your own length for this one (✎ in the meal dialog), else, for a
// step that takes its length from the recipes, the meal's prep time; else its usual length.
export function recipePrep(b) {
  if (b?.kind !== 'meal') return null;
  return prepMinutes(mealRecipes(b).map((x) => recipeOf(x.recipeId)));
}
export function stepLen(b, y) {
  const own = Number(b?.stepMinutes?.[y.id]);
  if (own) return own;
  if (y.from === 'recipes') return recipePrep(b) ?? (Number(y.minutes) || 15);
  return Number(y.minutes) || 10;
}
// The step a saved task's usual time refers to: for a meal whose prep depends on the recipes, the
// step right after the prep (you eat at 19:30; preparing grows earlier). Otherwise the first step.
// Returns an index; steps.length means "the end".
export function anchorIndex(steps, anchorId = null) {
  const i = anchorId ? steps.findIndex((y) => y.id === anchorId) : -1;
  if (i >= 0) return i;
  const last = steps.map((y) => y.from).lastIndexOf('recipes');
  if (last >= 0) return last + 1;
  const first = steps.findIndex((y) => !y.travel); // the task itself, after "Get there"
  return first < 0 ? 0 : first;
}
// How far into a block its task's time is (the anchor step's start), in minutes. With no steps, 0.
export function anchorOffset(b, task = b?.taskId && get('tasks', b.taskId)) {
  const steps = (task?.steps || []).filter((y) => y.title);
  if (!steps.length) return 0;
  const ai = anchorIndex(steps, task.anchorStepId);
  if (b?.id && has('blocks', b.id)) {
    const st = stepTimes(b);
    return ai < st.length ? st[ai].start - b.start : b.minutes;
  }
  return steps.slice(0, ai).reduce((n, y) => n + stepLen(b || {}, y), 0);
}
export function anchorTitle(task) {
  const steps = (task?.steps || []).filter((y) => y.title);
  const ai = anchorIndex(steps, task?.anchorStepId);
  return ai > 0 && ai < steps.length ? steps[ai].title : ai > 0 ? null : null;
}
// The next planned (not finished) block of a task, if any.
export function nextBlockOf(taskId) {
  const td = today();
  return live('blocks').filter((b) => b.taskId === taskId && !outcomeOf(b) && b.date >= td && b.kind !== 'prep')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))[0] || null;
}
// Each step's time inside the block (scaled if the block was made longer or shorter by hand).
export function stepTimes(b) {
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
export function legTimes(b) {
  const going = stepTimes(b).filter((y) => y.travel === 'there');
  if (!going.length) return null;
  const start = going[going.length - 1].end;
  return { leave: b.start, start, trip: start - b.start, step: going[going.length - 1] };
}
// The time line of a block: "leave 11:00 · 11:20–12:20" with a leg, "11:00–12:00" without.
export function blockTimeText(b) {
  const lg = legTimes(b);
  return lg && lg.trip > 0 ? `${t('leaveAt', fmtTime(lg.leave))} · ${range(lg.start, b.start + b.minutes - lg.start)}` : range(b.start, b.minutes);
}
export function setStepOutcome(block, sid, outcome, { parent = true } = {}) {
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
export function tryStep(block, sid, done) {
  if (done && rulesOf(block, sid).some((r) => r.when === 'failed')) { openOutcome(block, sid); return false; }
  setStepOutcome(block, sid, done ? 'done' : null);
  return true;
}
export function setBlockDone(block, done) { return setOutcome(block, done ? 'done' : null); }

// "planned" rules are the task's preparations (stored in task.prep, planned by linkFor).
export const RULE_WHEN = ['planned', 'done', 'failed', 'missed'];
export const RULE_PLACES = ['before', 'after', 'next', 'tomorrow', 'slots', 'pool'];
export const PREP_PLACES = ['before', 'sameday', 'daybefore'];
// Rules about the whole block (sid null) or about one of its steps.
export function rulesOf(b, sid = null) { return ((b?.taskId && get('tasks', b.taskId)?.rules) || []).filter((r) => (r.stepId || null) === sid); }

export function fireRules(block, when, sid = null) {
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
        id: uid(), createdAt: Date.now(), kind: 'todo', title, minutes, importance: importanceOf(from || {}), category: linked?.category || block.category || null,
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
export function undoRules(block, when, sid = null) {
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
export function nextWindowSlot(wins, minutes) {
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
export function checkMissed(date) {
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
export function runCheck(step, { auto = false } = {}) {
  const meal = step.parentId && get('blocks', step.parentId);
  if (!meal || !ricetteConfigured() || !mealRecipes(meal).length) { setOutcome(step, 'done'); return; }
  const missing = missingForMeal(meal);
  if (!missing.length) { setOutcome(step, 'done'); if (!auto) toast(t('allInPantry')); return; }
  for (const m of missing) kitchen.addToShopping(mealItem(m), meal.title);
  const b = upsert('blocks', { ...get('blocks', step.id), missing: missing.map((m) => [qtyText(m.buy, m.unit), m.name].filter(Boolean).join(' ')) }, { silent: true });
  setOutcome(b, 'failed');
  toast(t('checkMissing', missing.length, meal.title));
}

export function autoChecks(date) {
  if (date !== today()) return;
  const now = nowMinutes();
  for (const b of blocksOn(date)) if (isCheckStep(b) && !outcomeOf(b) && b.start <= now) runCheck(b, { auto: true });
}

// Ticking a block. A block with an unfinished checklist can't be ticked: the checklist opens
// instead. An ingredient check runs the check.
export function trySetBlockDone(block, done, { fromSteps = false } = {}) {
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
      const before = pantrySnap(); // (v73) what ran out because of this meal goes to the list, as Ricette does
      for (const x of list) n += kitchen.cook(x.r, x.n || x.r.servings || 2);
      toast(t('pantryUpdated', n));
      afterPantryChange(before);
    }
  }
  return true;
}

// ---------- meals (Ricette) ----------
// Meal types (Breakfast, Lunch, Dinner, Snack, or your own) are tasks set up in Settings, with a
// usual time, and by default a "Check ingredients" step before them. A meal on the plan is a block
// of a meal type with one or more recipes inside.

export const MEAL_DEFAULTS = [
  { key: 'breakfast', start: 450, minutes: 20, check: 'daybefore' },
  { key: 'lunch', start: 750, minutes: 45, check: 'sameday' },
  { key: 'dinner', start: 1170, minutes: 60, check: 'sameday' },
  { key: 'snack', start: 990, minutes: 15, check: null },
];

export function seedMeals() {
  if (!has('tasks', 'meal_check')) {
    upsert('tasks', {
      id: 'meal_check', kind: 'step', check: 'ingredients', title: t('checkStep'), minutes: 5, category: 'meals', checklist: [], notes: '',
      rules: [{ id: 'groceries', when: 'failed', then: 'groceries' }], createdAt: 1,
    }, { silent: true, at: 1 });
  }
  for (const m of MEAL_DEFAULTS) {
    const id = `meal_${m.key}`;
    if (has('tasks', id)) continue;
    upsert('tasks', {
      id, kind: 'meal', title: t(`mt_${m.key}`), minutes: m.minutes, defaultStart: m.start, category: 'meals',
      prep: m.check ? [{ taskId: 'meal_check', when: m.check }] : [], rules: [], checklist: [], notes: '', createdAt: 1,
    }, { silent: true, at: 1 });
  }
}

// ---------- saved tasks ----------
// Tasks that come back often, at different times: meals (with recipes), the gym, cleaning…
// They're the "routine" tasks, grouped by category. "+ From saved" puts one on the plan.
export function savedTasks() { return live('tasks').filter((x) => isSaved(x) && !x.archived && !x.palOut); }
export function savedGroups() {
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
export function savedInfo(x) {
  const when = x.defaultStart != null ? fmtTime(x.defaultStart) : t(`when_${x.when || 'any'}`);
  const bits = [when, fmtDur(x.minutes || 30)];
  if ((x.steps || []).length) bits.push(`▤ ${x.steps.map((y) => (y.from === 'recipes' ? `${y.title} ⟲` : y.title)).join(', ')}`);
  if (prepOf(x).length) bits.push(`↳ ${prepOf(x).map((p) => p.task.title).join(', ')}`);
  return bits.join(' · ');
}
// When a saved task would go on a day: its usual time, else the first free slot in its part of the day.
export function savedStart(x, date) {
  const s = planSettings();
  if (x.defaultStart != null) return Math.max(0, x.defaultStart - anchorOffset(null, x));
  const win = WINDOWS[x.when];
  const from = Math.max(win ? win[0] : s.dayStart, date === today() ? nowMinutes() : s.dayStart) + leadOf(x);
  return freeSlot(busyOn(date), x.minutes || 30, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap })
    ?? Math.min(Math.ceil(from / s.snap) * s.snap, 1440 - (x.minutes || 30));
}

export function mealTypes() { return live('tasks').filter(isMealType).sort((a, b) => (a.defaultStart ?? 0) - (b.defaultStart ?? 0)); }
export function mealRecipes(b) { return b?.recipes || (b?.recipeId ? [{ recipeId: b.recipeId, servings: b.servings }] : []); }
export function mealTitle(type, list) {
  const names = list.map((x) => recipeOf(x.recipeId)?.title).filter(Boolean);
  return `${type}${names.length ? ` · ${names.join(', ')}` : ''}`;
}

export function recipes() { return live('r_recipes').sort((a, b) => (a.title || '').localeCompare(b.title || '')); }
export const recipeOf = (id) => get('r_recipes', id);
export const isBefore = (a, b) => a.date < b.date || (a.date === b.date && a.start < b.start);

// What's missing for all of a meal's recipes, counting the pantry, the shopping list, the meals
// planned before it, and the recipes before it in the same meal.
export function missingForMeal(meal) {
  const flat = (b) => mealRecipes(b).map((x) => ({ recipeId: x.recipeId, servings: x.servings }));
  const earlier = live('blocks').filter((b) => b.kind === 'meal' && !b.done && b.id !== meal.id && b.date >= today() && isBefore(b, meal)).flatMap(flat);
  const mine = flat(meal);
  const out = [];
  mine.forEach((x, i) => {
    const r = recipeOf(x.recipeId);
    if (!r) return;
    const pantry = kitchen.pantryAfter([...earlier, ...mine.slice(0, i)], recipeOf);
    for (const m of kitchen.missingFor(r, x.servings || r.servings || 2, pantry)) {
      const same = out.find((o) => sameFood(o.name, m.name) && addQuantities({ qty: o.buy, unit: o.unit }, { qty: m.buy, unit: m.unit }));
      if (same) { const sum = addQuantities({ qty: same.buy, unit: same.unit }, { qty: m.buy, unit: m.unit }); same.buy = sum.qty; same.unit = sum.unit; } else out.push({ ...m });
    }
  });
  return out;
}

// A missing ingredient as a list item, with the food the recipe says it is (Ricette v40).
const mealItem = (m) => ({ name: m.name, qty: m.buy, unit: m.unit, note: m.note, ...(m.food ? { food: m.food } : {}), ...(m.foodPinned ? { foodPinned: true } : {}) });

export function qtyText(qty, unit) {
  if (qty == null) return '';
  return [formatQty(qty, unit), unit === 'pcs' ? '' : unit].filter(Boolean).join(' ');
}

// "Check ingredients" from the meal itself: runs its check step, or (for a meal without one)
// asks what to put on the list.
export function checkMealNow(meal) {
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
    for (const m of picked) kitchen.addToShopping(mealItem(m), meal.title);
      const g = ensureGroceries(get('blocks', meal.id));
    toast(t('groceriesPlanned', relDay(g.date), fmtTime(g.start)));
    changed();
  }), 0);
}

// Reuse a grocery trip already planned before the meal, or plan a new one.
export function ensureGroceries(meal, newId = null) {
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

export function shoppingItems() {
  return live('r_shopping').sort((a, b) => Number(a.checked) - Number(b.checked) || (a.name || '').localeCompare(b.name || ''));
}

// ---------- templates ----------

export function templates() { return live('templates').sort((a, b) => (a.name || '').localeCompare(b.name || '')); }

export function applyTemplate(tpl, date) {
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
export function autoApply(date) {
  if (date < today()) return;
  if (isConfigured() && !state.meta.syncedShards?.[`blocks/${date.slice(0, 7)}`]) return; // wait for the month's data
  for (const tpl of autoTemplatesFor(templates(), date)) {
    for (const b of templateBlocks(tpl, date)) if (!has('blocks', b.id)) upsert('blocks', b, { silent: true, at: 1 });
  }
}

// ---------- conflicts ----------

export function conflictsOn(date) {
  return findConflicts([...blocksOn(date), ...timedEventsOn(date).filter((e) => e.busy !== false)], {
    getBlock: (id) => get('blocks', id), getTask: (id) => get('tasks', id),
    blocksOfTask: (id) => live('blocks').filter((b) => b.taskId === id && b.kind !== 'prep' && !outcomeOf(b)),
    closedOf: (b) => (b.taskId && !outcomeOf(b) ? closedIssue(b) : null),
  });
}
// (v85) The time a block spends at its task's place: after «Get there», for the task's own length (a
// step block: the step, unless it's a travel step). Null when the task has no saved place.
export function onSiteOf(b, x = b?.taskId && get('tasks', b.taskId)) {
  if (!x?.placeId) return null;
  if (b.stepId) { const y = (x.steps || []).find((z) => z.id === b.stepId); return !y || isTravelStep(y) ? null : [b.start, b.start + b.minutes]; }
  const there = Math.min(legMinutes(x, 'there'), b.minutes);
  return [b.start + there, b.start + there + Math.max(1, Math.min(ownMinutes(x), b.minutes - there))];
}
// The block is at its place while the place is closed: what's wrong ({k, at, ranges} from places.js,
// plus the place), or null. «Va bene così» (okClosed) holds while the block stays where it was.
export function closedIssue(b, place = null) {
  const x = b?.taskId && get('tasks', b.taskId);
  const p = place || placeOfTask(x);
  if (!p || !p.hours?.length || (b.okClosed && b.okClosed.date === b.date && b.okClosed.start === b.start)) return null;
  const at = onSiteOf(b, x); if (!at) return null;
  const c = closedAt(p, b.date, at[0], at[1]);
  return c && { ...c, place: p, s: at[0], e: at[1] };
}

export function conflictText(c) {
  const [a, b] = c.ids.map(itemById);
  if (c.type === 'overlap') return t('cf_overlap', a?.title, b?.title);
  if (c.type === 'order') return t('cf_order', a?.title, b?.title);
  if (c.type === 'after') return t('cf_after', a?.title, b?.title, relDay(b?.date), fmtTime((b?.start || 0) + (b?.minutes || 0)));
  if (c.type === 'closed') {
    const i = closedIssue(a); if (!i) return t('cf_out', a?.title, fmtTime(a?.start || 0), '', '');
    const n = i.place.name;
    if (i.k === 'day') return t('cf_closedDay', a.title, relDay(a.date), n);
    if (i.k === 'closes') return t('cf_closes', a.title, fmtTime(i.e), n, fmtTime(i.at));
    if (i.k === 'opens') return t('cf_opens', a.title, fmtTime(i.s), n, fmtTime(i.at));
    return t('cf_out', a.title, fmtTime(i.s), n, i.ranges.map(([f, e]) => `${fmtTime(f)}–${fmtTime(e)}`).join(', '));
  }
  const task = get('tasks', a?.taskId);
  return t('cf_late', a?.title, task?.due ? relDay(task.due) : '');
}
// ---------- what's left to place ----------
// A task may need: several occurrences ("3 times a week"), its steps planned one by one (too long for
// one day, or "plan each step on its own"), other tasks done first, and only certain times (windows).

// The period a "times" task counts in: a day, an ISO week, a month or a year.
export function periodKey(date, per) {
  return per === 'day' ? date : per === 'week' ? weekStart(date) : per === 'month' ? date.slice(0, 7) : date.slice(0, 4);
}
// How many more times it should happen in the period of `date`: target − done − planned − previewed.
export function timesLeft(x, date) {
  if (x.repeat !== 'times' || isEnded(x)) return 0;
  const per = x.timesPer || 'week'; const pk = periodKey(date, per);
  const inP = (d) => periodKey(d, per) === pk;
  const blocks = live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && inP(b.date) && b.outcome !== 'failed');
  const logged = (x.doneLog || []).filter(inP).length;
  const ghosts = (ui.assign?.ghosts || []).filter((g) => g.taskId === x.id && inP(g.date)).length;
  const n = Math.max(0, (Number(x.timesN) || 1) - blocks.length - logged - ghosts);
  return x.repeatCount ? Math.min(n, Math.max(0, turnsLeftOf(x) - openTurnsOf(x) - ghosts)) : n; // (v69) per N volte
}
export function timesDone(x, date) {
  if (x.repeat !== 'times') return 0;
  const per = x.timesPer || 'week'; const pk = periodKey(date, per);
  const inP = (d) => periodKey(d, per) === pk;
  return live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && inP(b.date) && outcomeOf(b) === 'done').length + (x.doneLog || []).filter(inP).length;
}
// Steps planned as their own blocks: when asked to, once a step has its own block, or (unless the
// task is kept together) when the whole is longer than a day's limit or than "split tasks over".
export function splitsSteps(x) {
  const steps = (x.steps || []).filter((y) => y.title);
  if (steps.length < 2 || isMealType(x)) return false;
  if (x.splitSteps || live('blocks').some((b) => b.taskId === x.id && b.stepId)) return true;
  if (x.keepTogether) return false;
  const total = steps.reduce((n, y) => n + stepLen({}, y), 0); const s = planSettings();
  return total > s.maxLoad || (s.splitOver > 0 && total > s.splitOver);
}
// The planner may still split it by its steps when no single gap fits the whole (see placeWithSplit).
export function maySplit(x) {
  return !splitsSteps(x) && !x.keepTogether && !isMealType(x) && x.repeat !== 'times' && stepsLeftOf(x).length > 1;
}
// Steps that don't have a block (or a preview) yet.
export function partsLeft(x) {
  const steps = stepsLeftOf(x);
  const has = new Set([...live('blocks').filter((b) => b.taskId === x.id && b.stepId).map((b) => b.stepId),
    ...(ui.assign?.ghosts || []).filter((g) => g.taskId === x.id && g.stepId).map((g) => g.stepId)]);
  return steps.filter((y) => !has.has(y.id));
}
// Open tasks it needs first: [{task, block}] (block = where it's planned, if it is).
export function prereqsOf(x) {
  return (x.after || []).map((id) => get('tasks', id)).filter((p) => p && !p.done && p.id !== x.id).map((p) => ({
    task: p,
    block: [...live('blocks').filter((b) => b.taskId === p.id && !outcomeOf(b) && b.kind !== 'prep'), ...(ui.assign?.ghosts || []).filter((g) => g.taskId === p.id)]
      .sort((a, b) => (a.date + String(a.start + a.minutes).padStart(4, '0') < b.date + String(b.start + b.minutes).padStart(4, '0') ? 1 : -1))[0] || null,
  }));
}
