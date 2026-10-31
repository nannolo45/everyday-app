// The "smart" part of the planner: plain rules and scores, no AI and no outside services.
// Everything here is pure (no DOM, no storage) so it can be unit-tested.
import { addDays, parseDate, importanceOf } from './plan.js';

// Preferred times of day, in minutes from midnight.
export const WINDOWS = { morning: [0, 720], afternoon: [720, 1050], evening: [1050, 1440] };

const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5); // b - a

// ---------- how urgent / important is a task on a given day ----------
// Returns a score and the reasons behind it, as {k: i18n key, n?: number} so the UI can explain itself.

export function scoreTask(task, date, now = Date.now()) {
  let score = 0; const reasons = [];
  // Importance weighs as much as a close due date: a very important task beats a normal one due tomorrow.
  const imp = importanceOf(task);
  // Your own order in the task list (a preference, not a rule): up to +30.
  if (task.boost) { score += task.boost; if (task.boost >= 15) reasons.push({ k: 'r_yourOrder' }); }
  score += { 1: 0, 2: 5, 3: 12, 4: 28, 5: 45 }[imp];
  if (imp >= 4) reasons.push({ k: imp === 5 ? 'r_veryImportant' : 'r_high' });
  if (imp <= 2) reasons.push({ k: 'r_low' });
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

const pad4 = (n) => String(n).padStart(4, '0');
export function findConflicts(dayBlocks, { getBlock = () => null, getTask = () => null, blocksOfTask = () => [] } = {}) {
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
    // It needs another task first, and that one is planned later (or at the same time).
    for (const pre of (t?.after || [])) {
      const pb = blocksOfTask(pre).filter((x) => !x.done && !x.deleted).sort((x, y) => (x.date + pad4(x.start + x.minutes) < y.date + pad4(y.start + y.minutes) ? 1 : -1))[0];
      if (pb && (pb.date > b.date || (pb.date === b.date && pb.start + pb.minutes > b.start))) out.push({ type: 'after', ids: [b.id, pb.id] });
    }
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

// ---------- spread tasks over several days ----------
// For the planner's tray and the auto-planner: put tasks on a set of days. Each task goes on or
// before its due date, the most urgent and important first; among the days it may go on, it prefers
// the emptiest (earlier days win ties, the more so the more important or the sooner due it is), and
// only where it fits in a free gap without the day going over its limit.
// `days` = [{date, blocks, from}]: what's already there (busy time) and the earliest start.
// A task may also carry:
//   days: [dates]      only these days (one period of a "3 times a week" task)
//   group: key         at most one task of the group per day (the occurrences of that task)
//   windows: [{days: [1-7, Monday = 1] | date: 'YYYY-MM-DD', from, to}]   only inside these times (office hours)
// A day may carry `to` (the latest end for this day: the auto-planner's hours, weekday or weekend).
//   after: [ids]       other tasks of this run it must come after (prerequisites, earlier steps)
//   notBefore: {date, minute}   it can't start before then (a prerequisite planned already)
// Returns placements ({taskId, key, stepId, date, start, minutes, lead}) and what couldn't be placed.
export const isoDay = (date) => ((parseDate(date).getDay() + 6) % 7) + 1;
// A time window applies on a date: a specific date, or one of its weekdays.
export const windowOn = (w, date) => (w.date ? w.date === date : (w.days || []).includes(isoDay(date)));
const later = (a, b) => (!a ? b : !b ? a : (b.date > a.date || (b.date === a.date && b.minute > a.minute)) ? b : a);

export function spreadTasks({ tasks, days, settings, leadOf = () => 0, now = Date.now() }) {
  const s = { dayStart: 360, dayEnd: 1380, snap: 15, buffer: 5, maxLoad: 480, ...settings };
  const out = (t) => t.taskId ?? t.id;
  if (!days.length) return { placed: [], skipped: tasks.map((t) => ({ taskId: out(t), key: t.id, why: 'nodays' })) };
  const busy = new Map(days.map((d) => [d.date, [...d.blocks]]));
  const load = new Map(days.map((d) => [d.date, d.blocks.reduce((n, b) => n + (b.minutes || 0), 0)]));
  const first = days[0].date;
  const ranked = tasks.map((t) => ({ t, ...scoreTask(t, first, now) }))
    .sort((a, b) => b.score - a.score || (b.t.minutes || 30) - (a.t.minutes || 30) || String(a.t.id).localeCompare(String(b.t.id)));
  // A task comes after the ones it needs (when they're in this run), otherwise in ranking order.
  const byId = new Map(ranked.map((r) => [r.t.id, r]));
  const ordered = []; const seen = new Set();
  const visit = (r, path = new Set()) => {
    if (seen.has(r.t.id) || path.has(r.t.id)) return;
    path.add(r.t.id);
    for (const a of r.t.after || []) if (byId.has(a)) visit(byId.get(a), path);
    seen.add(r.t.id); ordered.push(r);
  };
  for (const r of ranked) visit(r);
  const endOf = new Map(); const used = new Map();
  const placed = []; const skipped = [];
  for (const { t, score, reasons } of ordered) {
    const minutes = t.minutes || 30;
    const lead = leadOf(t);
    const need = lead + minutes;
    let nb = t.notBefore || null; let waiting = false;
    for (const a of t.after || []) {
      if (!byId.has(a)) continue;
      const e = endOf.get(a);
      if (!e) { waiting = true; break; }
      nb = later(nb, e);
    }
    if (waiting) { skipped.push({ taskId: out(t), key: t.id, why: 'waiting' }); continue; }
    const ok = (d) => (!t.days || t.days.includes(d.date)) && (!nb || d.date >= nb.date) && !(t.group && used.get(t.group)?.has(d.date));
    let allowed = days.filter((d) => ok(d) && (!t.due || d.date <= t.due));
    if (!allowed.length && t.due && t.due < first) allowed = days.filter(ok).slice(0, 1); // already late: as soon as possible
    const bias = 6 + Math.max(0, importanceOf(t) - 3) * 20 + (t.due ? 25 : 0);
    let best = null; let why = 'full';
    allowed.forEach((d, i) => {
      if (load.get(d.date) + need > s.maxLoad) return;
      why = 'nofit';
      const from = Math.max(d.from ?? s.dayStart, nb && nb.date === d.date ? nb.minute : 0);
      const dayEnd = d.to ?? s.dayEnd;
      const free = freeIntervals(busy.get(d.date), { from, dayStart: s.dayStart, dayEnd, buffer: s.buffer });
      let at = null;
      if (t.windows?.length) {
        const wins = t.windows.filter((w) => windowOn(w, d.date));
        if (!wins.length) { why = 'window'; return; }
        // Inside a window (lead time may start earlier); a window can stretch past the usual day.
        const freeW = freeIntervals(busy.get(d.date), { from: Math.min(from, ...wins.map((w) => w.from - lead)), dayStart: 0, dayEnd: 1440, buffer: s.buffer });
        for (const w of wins) {
          const a = fit(freeW, need, { snap: s.snap, window: [w.from - lead, w.to] });
          if (a != null && (at == null || a < at)) at = a;
        }
        if (at == null) { why = 'window'; return; }
      } else {
        const win = WINDOWS[t.when];
        if (win) at = fit(free, need, { snap: s.snap, window: win });
        if (at == null) at = fit(free, need, { snap: s.snap });
      }
      if (at == null) return;
      const cost = load.get(d.date) + i * bias;
      if (!best || cost < best.cost) best = { d, at, cost };
    });
    if (!best) { skipped.push({ taskId: out(t), key: t.id, why: minutes > s.maxLoad ? 'toolong' : why }); continue; }
    // Say so when it landed in its time window or its preferred part of the day.
    const win = WINDOWS[t.when]; const st = best.at + lead;
    const extra = t.windows?.length ? [{ k: 'r_window' }] : win && st >= win[0] && st < win[1] ? [{ k: `r_${t.when}` }] : [];
    placed.push({ taskId: out(t), key: t.id, stepId: t.stepId || null, date: best.d.date, start: st, minutes, lead, score, reasons: [...reasons, ...extra] });
    busy.get(best.d.date).push({ start: best.at, minutes: need });
    load.set(best.d.date, load.get(best.d.date) + need);
    endOf.set(t.id, { date: best.d.date, minute: best.at + need });
    if (t.group) { if (!used.has(t.group)) used.set(t.group, new Set()); used.get(t.group).add(best.d.date); }
  }
  placed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  return { placed, skipped };
}
