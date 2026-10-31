// Pure planning logic (no DOM): dates, durations, recurring tasks, day layout, templates.
// Kept separate from app.js so it can be unit-tested in Node.

// ---------- dates (always local time, as YYYY-MM-DD strings) ----------

const pad = (n) => String(n).padStart(2, '0');
export function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function today(now = new Date()) { return dateStr(now); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); }
export function weekday(s) { return parseDate(s).getDay(); } // 0 = Sunday
export function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
export function nowMinutes(now = new Date()) { return now.getHours() * 60 + now.getMinutes(); }

// ---------- times and durations ----------

export function fmtTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function parseTime(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2] || 0);
  if (h > 24 || mi > 59) return null;
  return Math.min(1440, h * 60 + mi);
}

export function fmtDur(min) {
  if (!min) return '';
  const h = Math.floor(min / 60); const m = Math.round(min % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// "30m", "45min", "1h", "1.5h", "1,5h", "1h30", "1h30m", "90" (minutes)
export function parseDuration(s) {
  const t = String(s || '').trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = t.match(/^(\d+)h\s*(\d+)\s*m?(in)?$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = t.match(/^(\d+(?:\.\d+)?)\s*h$/))) return Math.round(Number(m[1]) * 60);
  if ((m = t.match(/^(\d+)\s*(m|min|mins)?$/))) return Number(m[1]);
  return null;
}

// Importance, 1 (very low) to 5 (very high); 3 is normal. Older tasks had a priority
// (1 high, 2 medium, 3 low), which maps onto it.
export const IMPORTANCE = [1, 2, 3, 4, 5];
export function importanceOf(task) {
  const n = Number(task?.importance);
  if (n >= 1 && n <= 5) return n;
  return { 1: 5, 2: 4, 3: 2 }[task?.priority] ?? 3;
}

// Quick add: "Call the dentist 15m !1 #health" -> title, minutes, importance, category name.
// !1 = very important … !5 = not important (!1–!3 as before; the number is the rank).
export function quickAdd(text) {
  const out = { title: '', minutes: null, priority: 0, importance: null, category: null };
  const words = [];
  for (const w of String(text || '').trim().split(/\s+/)) {
    let m;
    if (out.minutes == null && /^\d/.test(w) && /[hm]|min/i.test(w) && parseDuration(w) != null) out.minutes = parseDuration(w);
    else if (!out.importance && (m = w.match(/^!([1-5])$/))) { out.importance = 6 - Number(m[1]); out.priority = Number(m[1]) <= 3 ? Number(m[1]) : 0; }
    else if (!out.category && (m = w.match(/^#(\S+)$/))) out.category = m[1];
    else words.push(w);
  }
  out.title = words.join(' ');
  return out;
}

// ---------- recurring tasks ----------

export const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];

// ---------- recurrence ----------
// A recurring task has `repeat` (daily | weekdays | weekly | monthly), `every` (1 = each, 2 = every
// other…), for weekly `repeatDays` (ISO weekdays, Monday = 1; empty = the start date's weekday), an
// optional `repeatUntil` (last date) and `skipped` dates. `seriesFrom` is the first occurrence (the
// due date when the rule was set); `due` is the next one still to do.
export const isoDay = (s) => ((weekday(s) + 6) % 7) + 1;
const weekStartOf = (s) => addDays(s, -(isoDay(s) - 1));
const monthsBetween = (a, b) => { const x = parseDate(a); const y = parseDate(b); return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth()); };
const sameDayOfMonth = (anchor, s) => { const d = parseDate(anchor).getDate(); const m = parseDate(s); const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate(); return m.getDate() === Math.min(d, last); };

// Is `s` an occurrence of the task's rule? (Ignores `skipped` and `repeatUntil`.)
export function isOccurrence(task, s) {
  const anchor = task.seriesFrom || task.due;
  if (!task.repeat || !anchor || s < anchor) return false;
  const n = Math.max(1, Number(task.every) || 1);
  const days = Math.round((parseDate(s) - parseDate(anchor)) / 864e5);
  switch (task.repeat) {
    case 'daily': return days % n === 0;
    case 'weekdays': return ![0, 6].includes(weekday(s));
    case 'weekly': {
      const set = (task.repeatDays || []).length ? task.repeatDays : [isoDay(anchor)];
      if (!set.includes(isoDay(s))) return false;
      const weeks = Math.round((parseDate(weekStartOf(s)) - parseDate(weekStartOf(anchor))) / (7 * 864e5));
      return weeks % n === 0;
    }
    case 'monthly': { const m = monthsBetween(anchor, s); return m % n === 0 && sameDayOfMonth(anchor, s); }
    default: return false;
  }
}
// The occurrences between two dates (inclusive), honouring `skipped` and `repeatUntil`.
export function occurrences(task, from, to) {
  const out = [];
  if (!task.repeat || !REPEATS.includes(task.repeat)) return out;
  const anchor = task.seriesFrom || task.due;
  if (!anchor) return out;
  const start = from > anchor ? from : anchor;
  const end = task.repeatUntil && task.repeatUntil < to ? task.repeatUntil : to;
  const skip = new Set(task.skipped || []);
  for (let d = start; d <= end; d = addDays(d, 1)) if (isOccurrence(task, d) && !skip.has(d)) out.push(d);
  return out;
}
// The next occurrence strictly after `after` (within two years), or null.
export function nextOccurrence(task, after) {
  const [d] = occurrences(task, addDays(after, 1), addDays(after, 731));
  return d || null;
}
// Completing a recurring task moves it to its next date after today.
export function nextDue(repeat, due, todayStr, task = null) {
  const tk = task || { repeat, due, seriesFrom: due };
  const from = due && due > todayStr ? due : todayStr;
  return nextOccurrence({ ...tk, repeat: tk.repeat || repeat, due: tk.due || due }, from);
}

export function completeTask(task, todayStr, now = Date.now()) {
  if (task.repeat && REPEATS.includes(task.repeat)) {
    const due = nextDue(task.repeat, task.due, todayStr, task);
    return due ? { ...task, done: false, lastDone: todayStr, due } : { ...task, done: true, doneAt: now, lastDone: todayStr }; // the series is over
  }
  return { ...task, done: true, doneAt: now };
}

export function reopenTask(task) {
  const { doneAt, ...rest } = task;
  return { ...rest, done: false };
}

// Order: overdue first, then importance (most important first), then due date, then oldest first.
export function sortTasks(tasks, todayStr) {
  const key = (t) => [
    t.due && t.due < todayStr ? 0 : 1,
    6 - importanceOf(t),
    t.due || '9999-99-99',
    t.createdAt || 0,
    t.id || '', // last tie-break, so the order never changes between redraws
  ];
  return [...tasks].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}

// Groups for the task list.
export function groupTasks(tasks, todayStr) {
  const g = { overdue: [], today: [], upcoming: [], anytime: [], done: [] };
  for (const t of tasks) {
    if (t.done) g.done.push(t);
    else if (!t.due) g.anytime.push(t);
    else if (t.due < todayStr) g.overdue.push(t);
    else if (t.due === todayStr) g.today.push(t);
    else g.upcoming.push(t);
  }
  for (const k of ['overdue', 'today', 'upcoming', 'anytime']) g[k] = sortTasks(g[k], todayStr);
  g.done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return g;
}

// ---------- day layout ----------

// Places overlapping blocks side by side: adds {col, cols} to each block.
export function layoutBlocks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.minutes - a.minutes);
  const out = [];
  let cluster = []; let clusterEnd = -1; let colEnds = [];
  const flush = () => {
    const cols = colEnds.length;
    for (const b of cluster) b.cols = cols;
    cluster = []; colEnds = [];
  };
  for (const blk of sorted) {
    const b = { ...blk };
    const end = b.start + Math.max(b.minutes, 1);
    if (b.start >= clusterEnd) { flush(); clusterEnd = -1; }
    let col = colEnds.findIndex((e) => e <= b.start);
    if (col < 0) { col = colEnds.length; colEnds.push(end); } else colEnds[col] = end;
    b.col = col;
    cluster.push(b); out.push(b);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export function snapTo(min, snap) { return Math.round(min / snap) * snap; }

// First gap of `minutes` at or after `from`, within the day. Null if the day is full.
export function freeSlot(blocks, minutes, { from = 0, dayStart = 0, dayEnd = 1440, snap = 15 } = {}) {
  const busy = blocks.map((b) => [b.start, b.start + b.minutes]).sort((a, b) => a[0] - b[0]);
  let start = Math.ceil(Math.max(from, dayStart) / snap) * snap;
  for (;;) {
    const clash = busy.find(([s, e]) => s < start + minutes && e > start);
    if (!clash) break;
    start = Math.ceil(clash[1] / snap) * snap;
  }
  return start + minutes <= dayEnd ? start : null;
}

export function dayTotals(blocks) {
  let planned = 0; let done = 0;
  for (const b of blocks) { planned += b.minutes; if (b.done) done += b.minutes; }
  return { planned, done };
}

// ---------- day templates ----------
// A template is {id, name, days: [weekday numbers to apply automatically], blocks: [{start, minutes, title, category}]}
// Edited as text, one block per line:  "07:00 30m Morning routine #health"  or  "07:00-07:30 Morning routine"

export function parseTemplateLines(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{1,2}[:.]\d{2}|\d{1,2})(?:\s*-\s*(\d{1,2}[:.]\d{2}|\d{1,2}))?\s+(.*)$/);
    if (!m) continue;
    const start = parseTime(m[1]);
    if (start == null) continue;
    const words = m[3].split(/\s+/);
    let minutes = m[2] ? parseTime(m[2]) - start : null;
    let category = null;
    const rest = [];
    for (const w of words) {
      const c = w.match(/^#(\S+)$/);
      if (c && !category) category = c[1];
      else if (minutes == null && /^\d/.test(w) && parseDuration(w) != null) minutes = parseDuration(w);
      else rest.push(w);
    }
    if (!minutes || minutes < 0) minutes = 30;
    const title = rest.join(' ').trim();
    if (title) out.push({ start, minutes, title, category });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function formatTemplateLines(blocks, categoryName = (c) => c) {
  return [...blocks].sort((a, b) => a.start - b.start).map((b) => {
    const cat = b.category ? ` #${String(categoryName(b.category)).replace(/\s+/g, '')}` : '';
    return `${fmtTime(b.start)}-${fmtTime(b.start + b.minutes)} ${b.title}${cat}`;
  }).join('\n');
}

// Block ids from a template are fixed per day, so applying the same template twice,
// or on two devices at once, never makes duplicates.
export function templateBlockId(tplId, date, i) { return `t${tplId}_${date.replace(/-/g, '')}_${i}`; }

export function templateBlocks(tpl, date) {
  return (tpl.blocks || []).map((b, i) => {
    const rec = {
      id: templateBlockId(tpl.id, date, i), date, start: b.start, minutes: b.minutes,
      title: b.title, category: b.category || null, templateId: tpl.id, done: false,
    };
    if (b.taskId) rec.taskId = b.taskId; // e.g. "Gym", so its preparation and checklist come along
    if (b.kind === 'meal') {
      Object.assign(rec, { kind: 'meal', servings: b.servings, recipes: b.recipes || (b.recipeId ? [{ recipeId: b.recipeId, servings: b.servings }] : []) });
    }
    return rec;
  });
}

// Templates set to apply on this weekday.
export function autoTemplatesFor(templates, date) {
  const wd = weekday(date);
  return templates.filter((t) => Array.isArray(t.days) && t.days.includes(wd));
}
