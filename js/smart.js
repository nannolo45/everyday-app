// The "smart" part of the planner: plain rules and scores, no AI and no outside services.
// Everything here is pure (no DOM, no storage) so it can be unit-tested.
import { addDays, parseDate } from './plan.js';

// Preferred times of day, in minutes from midnight.
export const WINDOWS = { morning: [0, 720], afternoon: [720, 1050], evening: [1050, 1440] };

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5); // b - a

// ---------- how urgent / important is a task on a given day ----------
// Returns a score and the reasons behind it, as {k: i18n key, n?: number} so the UI can explain itself.

export function scoreTask(task, date, now = Date.now()) {
  let score = 0; const reasons = [];
  const prio = { 1: 40, 2: 25, 3: 5 }[task.priority] ?? 12;
  score += prio;
  if (task.priority === 1) reasons.push({ k: 'r_high' });
  if (task.due) {
    const d = daysBetween(date, task.due);
    if (d < 0) { score += 60; reasons.push({ k: 'r_overdue', n: -d }); }
    else if (d === 0) { score += 45; reasons.push({ k: 'r_dueToday' }); }
    else if (d === 1) { score += 25; reasons.push({ k: 'r_dueTomorrow' }); }
    else if (d <= 3) { score += 15; reasons.push({ k: 'r_dueIn', n: d }); }
    else if (d <= 7) { score += 8; reasons.push({ k: 'r_dueIn', n: d }); }
    else score += 2;
    if (task.repeat && d <= 0) score += 10;
  }
  // Tasks that have been waiting a while slowly float up.
  const ageDays = task.createdAt ? (now - task.createdAt) / 864e5 : 0;
  if (ageDays >= 7) reasons.push({ k: 'r_waiting', n: Math.floor(ageDays) });
  score += Math.min(10, ageDays / 2);
  return { score: Math.round(score * 10) / 10, reasons };
}

// Tasks worth considering for a day: open, not a preparation helper, not already planned,
// and (for repeating tasks) actually due by then.
export function candidates(tasks, plannedTaskIds, date) {
  return tasks.filter((t) => !t.done && !t.deleted && !t.helper && !t.routine && !plannedTaskIds.has(t.id)
    && !(t.repeat && t.due && t.due > date));
}

// ---------- free time ----------

// Free intervals [start, end] in a day, keeping `buffer` minutes around existing blocks.
export function freeIntervals(blocks, { from = 0, dayStart = 0, dayEnd = 1440, buffer = 0 } = {}) {
  const lo = Math.max(from, dayStart);
  const busy = blocks.map((b) => [b.start - buffer, b.start + b.minutes + buffer]).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = lo;
  for (const [s, e] of busy) {
    if (e <= cur) continue;
    if (s > cur) out.push([cur, Math.min(s, dayEnd)]);
    cur = Math.max(cur, e);
    if (cur >= dayEnd) break;
  }
  if (cur < dayEnd) out.push([cur, dayEnd]);
  return out.filter(([s, e]) => e > s);
}

// Find room for `need` minutes inside free intervals (optionally inside a window).
// 'early' takes the first fit, 'late' the last one that ends by `before`.
export function fit(intervals, need, { snap = 5, window = null, prefer = 'early', before = 1440 } = {}) {
  const opts = [];
  for (let [s, e] of intervals) {
    if (window) { s = Math.max(s, window[0]); e = Math.min(e, window[1]); }
    e = Math.min(e, before);
    if (prefer === 'early') {
      const st = Math.ceil(s / snap) * snap;
      if (st + need <= e) opts.push(st);
    } else {
      const st = Math.floor((e - need) / snap) * snap;
      if (st >= s) opts.push(st);
    }
  }
  if (!opts.length) return null;
  return prefer === 'early' ? Math.min(...opts) : Math.max(...opts);
}

// The free spot closest to `target` (earlier or later), e.g. to move a block out of a clash.
export function nearestSlot(blocks, minutes, target, { from = 0, dayStart = 0, dayEnd = 1440, snap = 15, buffer = 0 } = {}) {
  let best = null;
  for (const [s, e] of freeIntervals(blocks, { from, dayStart, dayEnd, buffer })) {
    const lo = Math.ceil(s / snap) * snap; const hi = Math.floor((e - minutes) / snap) * snap;
    if (hi < lo) continue;
    const c = Math.min(Math.max(Math.round(target / snap) * snap, lo), hi);
    if (best == null || Math.abs(c - target) < Math.abs(best - target)) best = c;
  }
  return best;
}

// ---------- "suggest a plan" ----------
// Greedy: most important first, each into the earliest gap that fits (inside its preferred
// time of day when it has one), leaving room before it for "right before" preparations,
// and stopping once the day holds as much as you said you want to plan.

export function suggestDay({ tasks, blocks, date, from, settings, leadOf = () => 0, now = Date.now() }) {
  const s = { dayStart: 360, dayEnd: 1380, snap: 15, buffer: 5, maxLoad: 480, ...settings };
  let load = blocks.reduce((sum, b) => sum + b.minutes, 0);
  const busy = [...blocks];
  const ranked = tasks.map((t) => ({ t, ...scoreTask(t, date, now) })).sort((a, b) => b.score - a.score || (a.t.minutes || 30) - (b.t.minutes || 30));
  const placed = []; const skipped = [];
  for (const { t, score, reasons } of ranked) {
    const minutes = t.minutes || 30;
    const lead = leadOf(t);
    const need = lead + minutes;
    if (load + need > s.maxLoad) { skipped.push({ taskId: t.id, why: 'full' }); continue; }
    const free = freeIntervals(busy, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, buffer: s.buffer });
    const win = WINDOWS[t.when];
    let at = win ? fit(free, need, { snap: s.snap, window: win }) : null;
    const inWindow = at != null && Boolean(win);
    if (at == null) at = fit(free, need, { snap: s.snap });
    if (at == null) { skipped.push({ taskId: t.id, why: 'nofit' }); continue; }
    const start = at + lead;
    placed.push({ taskId: t.id, start, minutes, lead, score, reasons: inWindow ? [...reasons, { k: `r_${t.when}` }] : reasons });
    busy.push({ start: at, minutes: need });
    load += need;
  }
  placed.sort((a, b) => a.start - b.start);
  return { placed, skipped };
}

// ---------- "I have X minutes" ----------

export function spareTime({ tasks, minutes: X, date, leadOf = () => 0, now = Date.now() }) {
  const scored = tasks.map((t) => {
    const len = (t.minutes || 30) + leadOf(t);
    const { score, reasons } = scoreTask(t, date, now);
    return { t, len, score, reasons };
  });
  const fitting = scored.filter((x) => x.len <= X);
  // Prefer important tasks, with a small bonus for using the time well.
  const singles = fitting.map((x) => ({ ...x, rank: x.score + 12 * (x.len / X) }))
    .sort((a, b) => b.rank - a.rank).slice(0, 5);
  // Best combination of 2-3 shorter tasks that fits in the time.
  const pool = fitting.sort((a, b) => b.score - a.score).slice(0, 12);
  let combo = null; let best = 0;
  const consider = (set) => {
    const len = set.reduce((s, x) => s + x.len, 0);
    if (len > X) return;
    const val = set.reduce((s, x) => s + x.score, 0) + 12 * (len / X);
    if (val > best) { best = val; combo = set; }
  };
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      consider([pool[i], pool[j]]);
      for (let k = j + 1; k < pool.length; k++) consider([pool[i], pool[j], pool[k]]);
    }
  }
  if (combo && singles[0] && best <= singles[0].score + 12 * (singles[0].len / X) + 5) combo = null; // not worth it
  // Longer tasks you could at least make a start on.
  const starts = scored.filter((x) => x.len > X && x.score >= 30).sort((a, b) => b.score - a.score).slice(0, 2);
  const strip = (x) => ({ taskId: x.t.id, minutes: x.len, score: x.score, reasons: x.reasons });
  return { singles: singles.map(strip), combo: combo ? combo.map(strip) : null, starts: starts.map(strip) };
}

// ---------- placing linked blocks ----------

// Preparation before a parent block. mode 'before' = right before it, 'daybefore' = the evening before.
export function placePrep({ parent, minutes, mode, blocksOn, today, nowMin, settings }) {
  const s = { dayStart: 360, dayEnd: 1380, snap: 5, ...settings };
  const sameDay = () => {
    const from = parent.date === today ? nowMin : s.dayStart;
    const free = freeIntervals(blocksOn(parent.date).filter((b) => b.id !== parent.id), { from, dayStart: Math.min(s.dayStart, parent.start), dayEnd: parent.start });
    const at = fit(free, minutes, { snap: s.snap, prefer: 'late', before: parent.start });
    return { date: parent.date, start: at ?? Math.max(0, parent.start - minutes) };
  };
  if (mode === 'sameday') {
    // Earlier the same day: the first free slot of the day (or from now), well ahead of it.
    const from = parent.date === today ? nowMin : s.dayStart;
    const free = freeIntervals(blocksOn(parent.date).filter((b) => b.id !== parent.id), { from, dayStart: Math.min(s.dayStart, parent.start), dayEnd: parent.start });
    const at = fit(free, minutes, { snap: s.snap, prefer: 'early', before: parent.start });
    return at == null ? sameDay() : { date: parent.date, start: at };
  }
  if (mode === 'daybefore') {
    const day = addDays(parent.date, -1);
    if (day < today) return sameDay();
    const from = day === today ? nowMin : s.dayStart;
    const free = freeIntervals(blocksOn(day), { from, dayStart: s.dayStart, dayEnd: s.dayEnd });
    const at = fit(free, minutes, { snap: s.snap, window: WINDOWS.evening, prefer: 'late' })
      ?? fit(free, minutes, { snap: s.snap, prefer: 'late' });
    if (at == null) return sameDay();
    return { date: day, start: at };
  }
  return sameDay();
}

// A grocery trip before a meal: the latest free slot before it that day, else the evening before.
export function placeGroceries({ meal, minutes, blocksOn, today, nowMin, settings }) {
  const s = { dayStart: 360, dayEnd: 1380, snap: 15, buffer: 5, ...settings };
  const from = meal.date === today ? nowMin : s.dayStart;
  const free = freeIntervals(blocksOn(meal.date), { from, dayStart: s.dayStart, dayEnd: meal.start, buffer: s.buffer });
  let at = fit(free, minutes, { snap: s.snap, prefer: 'late', before: meal.start - 15 });
  if (at != null) return { date: meal.date, start: at };
  const day = addDays(meal.date, -1);
  if (day >= today) {
    const f2 = freeIntervals(blocksOn(day), { from: day === today ? nowMin : s.dayStart, dayStart: s.dayStart, dayEnd: s.dayEnd, buffer: s.buffer });
    at = fit(f2, minutes, { snap: s.snap, prefer: 'late' });
    if (at != null) return { date: day, start: at };
  }
  return { date: meal.date, start: Math.max(0, meal.start - minutes - 15) };
}

// ---------- conflicts ----------
// Kinds: 'overlap' (two blocks at the same time), 'order' (a preparation or grocery trip
// after the thing it's for), 'late' (planned after the task's due date).

const end = (b) => b.start + b.minutes;
const before = (a, b) => a.date < b.date || (a.date === b.date && end(a) <= b.start);

export function findConflicts(dayBlocks, { getBlock = () => null, getTask = () => null } = {}) {
  const out = [];
  const list = [...dayBlocks].sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      if (b.start >= end(a)) continue;
      if (a.allowOverlap || b.allowOverlap || (a.done && b.done) || (a.fixed && b.fixed)) continue; // two calendar events: not ours to fix
      out.push({ type: 'overlap', ids: [a.id, b.id] });
    }
  }
  for (const b of list) {
    if (b.done) continue;
    if ((b.kind === 'prep' || b.mustPrecede) && b.parentId) {
      const p = getBlock(b.parentId);
      if (p && !p.done && !before(b, p)) out.push({ type: 'order', ids: [b.id, p.id] });
    }
    if (b.kind === 'meal' && b.groceryId) {
      const g = getBlock(b.groceryId);
      if (g && !g.done && !before(g, b)) out.push({ type: 'order', ids: [g.id, b.id] });
    }
    const t = b.taskId && getTask(b.taskId);
    if (t && t.due && !t.repeat && !t.done && b.date > t.due) out.push({ type: 'late', ids: [b.id] });
  }
  return out;
}

// Recipe times as Ricette stores them: "45 min", "1 h 30 min", or typed by hand ("1 ora", "30 Minuten").
export function recipeMinutes(text) {
  const s = String(text || '').toLowerCase().replace(',', '.');
  if (!s) return null;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|ora|ore|std|stunde|stunden)\b/);
  const m = s.match(/(\d+)\s*(m|min|mins|minute|minutes|minuti|minuten)\b/);
  let total = 0;
  if (h) total += Math.round(Number(h[1]) * 60);
  if (m) total += Number(m[1]);
  if (!h && !m) { const n = s.match(/^(\d+)$/); if (n) total = Number(n[1]); }
  return total || null;
}
