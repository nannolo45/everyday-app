// planning.js: moved from app.js (v36). See app.js for how the modules fit together.
import { fmtDay, GROCERY_MINUTES, planSettings, relDay, toast, ui } from './core.js';
import { t } from './i18n.js';
import { isTodo } from './kinds.js';
import { busyOn, conflictsOn, conflictText, eventTasksOf, followParent, itemById, leadOf, leaveTrace, maySplit, minutesLeft, newBlock, openTasks, outcomeOf, partsLeft, periodKey, plannedTaskIds, planTask, prereqsOf, splitsSteps, stepLen, timesLeft } from './model.js';
import { addDays, fmtTime, freeSlot, importanceOf, nowMinutes, parseDate, today } from './plan.js';
import { assignItems, planTrips, shopsFor } from './shops.js';
import { nearestSlot, placeGroceries, placePrep, scoreTask, spreadTasks, WINDOWS } from './smart.js';
import { get, live, remove, saveSettings, state, upsert } from './store.js';
import { SH, shopName, shopsList } from './views/shop.js';
import { manualOrder, passesFilter, sortTaskList } from './views/tasks.js';
import { currentView, ghostsOn, weekStart } from './views/planner.js';
import { changed, currentDate, render } from './shell.js';

// Plan the event's open, unplanned tasks over the days up to their due dates (after-the-event ones from
// the event on), the way the planner would.
export function planEventTasks(ev) {
  const td = today();
  const open = eventTasksOf(ev.id).filter((x) => !x.done && !plannedTaskIds().has(x.id));
  if (!open.length) { toast(t('allPlanned')); return 0; }
  const last = open.reduce((m, x) => (x.due && x.due > m ? x.due : m), td);
  const n = Math.min(90, Math.max(1, Math.round((parseDate(last) - parseDate(td)) / 864e5) + 1));
  const days = Array.from({ length: n }, (_, i) => addDays(td, i));
  let made = 0;
  for (const p of planPlacements(open.map((x) => x.id), days)) {
    const task = get('tasks', p.taskId); if (!task) continue;
    placeBlock(task, p); made++;
  }
  toast(made ? t('plannedN', made) : t('noRoom'));
  changed();
  return made;
}
// The auto-planner: everything still to place (or the tasks selected in the tray), laid out over a
// period you choose, as previews in the tray.
export const AUTO_SPANS = ['1', '2', '3', '7', '14', 'month', 'n'];

export function warnConflicts(block) {
  if (!block) return;
  const c = conflictsOn(block.date).find((x) => x.ids.includes(block.id));
  if (!c) return;
  toast(`⚠ ${conflictText(c)}`);
}

export function fixConflict(c) {
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
// Once a day, the first time Today opens: what was left undone on earlier days goes back on the
// plan over the coming week, and a line says so, with Undo. Series occurrences are left alone.
export let reflowing = false;
export function morningReflow() {
  const td = today();
  if (reflowing || state.settings.lastReflow === td) return;
  reflowing = true;
  try {
    // (steps planned on their own come back too: a step block left undone moves like a task)
    const left = live('blocks').filter((b) => b.date < td && b.taskId && !outcomeOf(b) && !b.seriesId && b.kind !== 'prep'
      && get('tasks', b.taskId) && !get('tasks', b.taskId).done && isTodo(get('tasks', b.taskId)));
    saveSettings({ lastReflow: td });
    if (!left.length) return;
    const removed = left.map((b) => ({ ...b }));
    const tasksBefore = new Map();
    for (const b of left) {
      // Some of its steps done that day: the block stays as a trace and only the rest is planned again.
      const before = get('tasks', b.taskId);
      if (!b.stepId && leaveTrace(b)) { if (!tasksBefore.has(before.id)) tasksBefore.set(before.id, before); continue; }
      remove('blocks', b.id);
    }
    const ids = [...new Set(left.map((b) => b.taskId))];
    const days = Array.from({ length: 7 }, (_, i) => addDays(td, i));
    const added = [];
    for (const p of planPlacements(ids, days)) {
      const task = get('tasks', p.taskId); if (!task) continue;
      added.push(placeBlock(task, p).id);
    }
    ui.reflow = { moved: ids.length, removed, added, tasks: [...tasksBefore.values()] };
    setTimeout(changed, 0);
  } finally { reflowing = false; }
}
export function undoReflow() {
  const r = ui.reflow; if (!r) return;
  for (const id of r.added) remove('blocks', id);
  for (const b of r.removed) upsert('blocks', b, { silent: true });
  for (const x of r.tasks || []) upsert('tasks', x, { silent: true }); // the steps done count as before
  ui.reflow = null;
  toast(t('undone'));
  changed();
}
// Where the planner would put these tasks over these days (no previews involved).
export function planPlacements(ids, dates) {
  const s = planSettings(); const td = today(); const now = nowMinutes();
  const tasks = ids.map((id) => get('tasks', id)).filter(Boolean);
  const { items } = planningItems(tasks, dates);
  const dayInfo = (d) => ({ date: d, blocks: busyOn(d).filter((b) => !b.allowOverlap), from: Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((now + 5) / 5) * 5 : 0), to: autoHoursFor(d)[1] });
  return spreadWithSplit(items, dates.map(dayInfo), s).placed;
}
const leadOfItem = (it) => (it.stepId && !(it.prep || []).length ? 0 : leadOf(get('tasks', it.taskId)));
// Step items for a task, one after another (the first one keeps the task's prerequisites and prep).
function stepItems(x, base) {
  const out = []; let prev = null;
  for (const y of partsLeft(x)) {
    const id = `${x.id}~${y.id}`;
    out.push({ ...base, id, stepId: y.id, title: `${x.title} · ${y.title}`, minutes: stepLen({}, y), prep: prev ? [] : x.prep, after: prev ? [prev] : [], afterTasks: prev ? [] : base.afterTasks, notBefore: prev ? null : base.notBefore });
    prev = id;
  }
  return out;
}
// spreadTasks, and then a second go for whole tasks that fit nowhere but have steps: planned step by
// step over the days instead (unless kept together), with the tasks that were waiting for them.
export function spreadWithSplit(items, days, settings) {
  const r = spreadTasks({ tasks: items, days, settings, leadOf: leadOfItem });
  const NOFIT = new Set(['nofit', 'full', 'toolong']);
  const split = r.skipped.filter((k) => k.key === k.taskId && NOFIT.has(k.why) && maySplit(get('tasks', k.taskId)));
  if (!split.length) return r;
  const lastOf = new Map(); const again = [];
  for (const k of split) {
    const it = items.find((i) => i.id === k.key);
    const steps = stepItems(get('tasks', k.taskId), { ...it, after: [], afterTasks: [] });
    steps[0].after = [...(it.after || [])];
    again.push(...steps); lastOf.set(k.key, steps[steps.length - 1].id);
  }
  const waitingKeys = new Set(r.skipped.filter((k) => k.why === 'waiting').map((k) => k.key));
  again.push(...items.filter((i) => waitingKeys.has(i.id)));
  // What came before in the first go: its end becomes a "not before", since it's not in this run.
  const endOf = new Map(r.placed.map((p) => [p.key, { date: p.date, minute: p.start + p.minutes }]));
  const later = (a, b) => (!a ? b : !b ? a : (b.date > a.date || (b.date === a.date && b.minute > a.minute)) ? b : a);
  const run = again.map((i) => {
    let nb = i.notBefore || null; const after = [];
    for (const a of i.after || []) { if (endOf.has(a)) nb = later(nb, endOf.get(a)); else after.push(lastOf.get(a) || a); }
    return { ...i, after, notBefore: nb };
  });
  const placedDays = days.map((d) => ({ ...d, blocks: [...d.blocks, ...r.placed.filter((p) => p.date === d.date).map((p) => ({ start: p.start - (p.lead || 0), minutes: p.minutes + (p.lead || 0) }))] }));
  const r2 = spreadTasks({ tasks: run, days: placedDays, settings, leadOf: leadOfItem });
  const splitIds = new Set(split.map((k) => k.taskId));
  const placed2 = r2.placed.map((p) => (splitIds.has(p.taskId) ? { ...p, reasons: [...(p.reasons || []), { k: 'r_split' }] } : p));
  const done = new Set(r2.placed.map((p) => p.taskId)); const keys2 = new Set(r2.placed.map((p) => p.key));
  // A split task with at least one step placed isn't "skipped": the steps left stay in the drawer.
  const skipped = r.skipped.filter((k) => !(splitIds.has(k.taskId) && done.has(k.taskId)) && !(waitingKeys.has(k.key) && keys2.has(k.key)));
  const placed = [...r.placed, ...placed2].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  return { placed, skipped };
}
export function tripMode() { return get('config', 'shopping')?.value?.tripMode || 'perShop'; }
export function tripTitle(ids) {
  const names = (ids || []).map(shopName).filter(Boolean);
  if (!names.length) return t('groceryTitle');
  return names.length === 1 ? `${t('groceryTitle')} · ${names[0]}` : `${t('groceryTitle')}: ${names.join(' → ')}`;
}
// The hours the planner may use on a day (Settings → Planner): weekdays and weekends apart.
export function autoHoursFor(date) {
  const h = state.settings.autoHours || {};
  const we = [0, 6].includes(parseDate(date).getDay());
  const [f, to] = (we ? h.we : h.wd) || (we ? [600, 1200] : [540, 1200]);
  return [f, Math.max(to, f + 30)];
}
// Plan the grocery trips for what's on the list: which shop gets each item (as few shops as possible),
// then a time for each trip (or one trip for all, Settings → Shops), inside opening hours. Before
// `meal` when given (as late as possible, so things are fresh), otherwise as soon as possible.
// Earlier automatic trips that haven't happened yet are replaced; ones you moved by hand are kept.
export function planGroceryTrips({ meal = null, newId = null } = {}) {
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
export function tripItems(b) {
  const all = live(SH());
  if (!b?.shops?.length) return all;
  const byShop = assignItems(all, shopsList()) || new Map();
  const ids = new Set(b.shops.flatMap((id) => (byShop.get(id) || []).map((i) => i.id)));
  return all.filter((i) => ids.has(i.id) || (i.checked && shopsFor(i, shopsList()).some((id) => b.shops.includes(id))));
}
export function trayTasks() {
  const planned = plannedTaskIds();
  const ghosted = new Set((ui.assign?.ghosts || []).map((g) => g.taskId));
  const stepGhosted = new Set((ui.assign?.ghosts || []).filter((g) => g.stepId).map((g) => g.taskId));
  const td = today();
  return sortTaskList(openTasks().filter((x) => {
    if (!passesFilter(x)) return false;
    if (x.repeat === 'times') return timesLeft(x, td) > 0;
    if (splitsSteps(x) || stepGhosted.has(x.id)) return partsLeft(x).length > 0;
    return !planned.has(x.id) && !ghosted.has(x.id);
  }), state.settings.traySort || 'smart');
}
// What the planner places for these tasks over these days: one item per occurrence or step part.
export function planningItems(tasks, dates) {
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
    const base = { taskId: x.id, boost: boostOf.get(x.id) || 0, title: x.title, minutes: minutesLeft(x), due: x.repeat === 'times' ? null : x.due || null, importance: importanceOf(x), priority: x.priority, when: x.when, createdAt: x.createdAt, windows: x.windows?.length ? x.windows : null, prep: x.prep };
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
      const steps = stepItems(x, { ...base, afterTasks, notBefore });
      items.push(...steps);
      if (steps.length) lastItem.set(x.id, steps[steps.length - 1].id);
      continue;
    } else items.push({ ...base, id: x.id, afterTasks, notBefore });
    lastItem.set(x.id, items[items.length - 1]?.id);
  }
  for (const it of items) it.after = [...(it.after || []), ...(it.afterTasks || []).map((id) => lastItem.get(id)).filter(Boolean)];
  return { items, skipped };
}
export function loadOf(date) {
  const now = busyOn(date).filter((b) => !b.allowOverlap && !b.outcome).reduce((n, b) => n + (b.minutes || 0), 0);
  const add = ghostsOn(date).reduce((n, g) => n + g.minutes + (g.lead || 0), 0);
  return { now, add, limit: planSettings().maxLoad };
}
// Hours to the nearest quarter, short: 2h, 1½h, ¾h, – for nothing.
// Morning, afternoon or evening for a time of day (the same split the planner uses).
export function partOfDay(m) { return m < WINDOWS.morning[1] ? 'morning' : m < WINDOWS.afternoon[1] ? 'afternoon' : 'evening'; }

export function hoursShort(m) {
  if (!m) return '–';
  const q = Math.max(1, Math.round(m / 15)); const h = Math.floor(q / 4);
  return `${h || ''}${['', '¼', '½', '¾'][q % 4]}h`;
}
export function inRange(date) { const r = ui.assign?.range; return Boolean(r && date >= r.from && date <= r.to); }
// Tapping a day opens it, unless tasks are selected in the open drawer: then taps pick the days to spread over.
export const selecting = () => Boolean(ui.assign?.open && ui.assign.sel?.size);
// The days "Spread" uses: the range you tapped, else what's on screen (from today on).
export function spreadDays() {
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
export function spreadLabel() {
  const r = ui.assign?.range;
  if (r) return r.from === r.to ? fmtDay(r.from, { weekday: 'short', day: 'numeric' }) : `${fmtDay(r.from, { weekday: 'short', day: 'numeric' })} – ${fmtDay(r.to, { weekday: 'short', day: 'numeric' })}`;
  return t(`spreadOver_${currentView()}`);
}
// Put tasks on days as previews: spread over several days, or one after another from a time.
export function placeGhosts(ids, dates, minute = null) {
  const s = planSettings(); const td = today(); const now = nowMinutes();
  const tasks = ids.map((id) => get('tasks', id)).filter(Boolean);
  const { items, skipped: blocked } = planningItems(tasks, dates);
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
    ({ placed, skipped } = spreadWithSplit(items, dates.map(dayInfo), settings));
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
export function skipNote(skipped) {
  const seen = new Set(); const parts = [];
  for (const x of skipped) {
    const title = get('tasks', x.taskId)?.title || '';
    if (seen.has(x.taskId)) continue; seen.add(x.taskId);
    parts.push(x.why === 'needs' ? t('whyNeeds', title, x.name) : x.why === 'window' ? t('whyWindow', title) : x.why === 'toolong' ? t('whyLong', title) : x.why === 'waiting' ? t('whyWaiting', title) : t('whyFull', title));
  }
  return parts.join(' · ');
}
export function assignDrop(id, tgt) {
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
export function addGhosts() { const n = addGhostList(ui.assign.ghosts); ui.assign.ghosts = []; toast(t('assignAdded', n)); changed(); }
// A placement ({date, start, minutes, stepId?}) as a block: the whole task, or one of its steps on its own
// (linked to the task and the step).
export function placeBlock(task, p) {
  const step = p.stepId && (task.steps || []).find((y) => y.id === p.stepId);
  if (!step) return planTask(task, p.date, p.start, { minutes: p.minutes });
  const first = (task.steps || []).filter((y) => y.title)[0]?.id === step.id;
  return planTask(task, p.date, p.start, { minutes: p.minutes, stepId: step.id, title: `${task.title} · ${step.title}`, partial: !first });
}
// Previews become real blocks.
export function addGhostList(list) {
  let n = 0;
  for (const g of list) {
    const task = get('tasks', g.taskId);
    if (!task) continue;
    placeBlock(task, g);
    n++;
  }
  return n;
}
