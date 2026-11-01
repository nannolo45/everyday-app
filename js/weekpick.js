// "I pick the time each week" (v51): repeating tasks with `pickTime` have days but no fixed time. Their
// occurrences without a block show on a card ("To fix this week") with free slots to tap: on Today from
// the weekly moment (Settings → My day: Sunday 18:00 by default) for the week ahead, and always for
// today; in the Planner's week view for the week on screen. "X times a week" tasks get placements.
import { esc, planSettings, relDay, ui } from './core.js';
import { t } from './i18n.js';
import { isSaved, isTodo } from './kinds.js';
import { busyOn, leadOf, planTask, timesLeft } from './model.js';
import { addDays, fmtDur, fmtTime, freeSlot, nowMinutes, occurrences, REPEATS, today } from './plan.js';
import { autoHoursFor, placeBlock, planPlacements } from './planning.js';
import { WINDOWS } from './smart.js';
import { get, live, saveSettings, state, upsert } from './store.js';
import { weekStart } from './views/planner.js';

export const pickTasks = () => live('tasks').filter((x) => !x.done && x.pickTime && (isTodo(x) || isSaved(x)) && (REPEATS.includes(x.repeat) || x.repeat === 'times'));
const hasBlock = (x, date) => live('blocks').some((b) => b.taskId === x.id && b.date === date && b.kind !== 'prep');

// The weekly moment: {day 0–6 (0 = Sunday), hour}. The card for the week ahead shows from then on.
export function weekCue() { return { day: Number(state.settings.weekCardDay ?? 0), hour: Number(state.settings.weekCardHour ?? 18) }; }
// The week the card is about now (its Monday): from the weekly moment on, the week ahead (or this one when
// the moment is on a Monday); before it, the week we're in, until its occurrences have times.
export function cardWeek(now = new Date()) {
  const td = today(); const ws = weekStart(td); const { day, hour } = weekCue();
  const cueDate = addDays(ws, (day + 6) % 7);
  const passed = td > cueDate || (td === cueDate && now.getHours() >= hour);
  return passed && day !== 1 ? addDays(ws, 7) : ws;
}

// What needs a time between two dates: [{x, date}] for days, [{x, n, days}] for "N times a week".
export function toFix(from, to) {
  const out = [];
  for (const x of pickTasks()) {
    if (x.repeat === 'times') {
      if ((x.timesPer || 'week') !== 'week') continue;
      const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const n = timesLeft(x, days[days.length - 1]);
      if (n > 0) out.push({ x, n, days: days.filter((d) => d >= today()) });
      continue;
    }
    for (const d of occurrences(x, from, to)) if (d >= today() && !hasBlock(x, d) && !(x.skipped || []).includes(d)) out.push({ x, date: d });
  }
  return out.sort((a, b) => ((a.date || '9') < (b.date || '9') ? -1 : 1));
}

// Free slots on a date for a task: the part of day it usually has first, then the others.
// [{start, part, until}] (start = when the task itself starts; the lead time, e.g. getting there, is before).
export function slotOptions(x, date, n = 3) {
  const s = planSettings(); const lead = leadOf(x); const need = (x.minutes || 30) + lead;
  const busy = busyOn(date).filter((b) => !b.allowOverlap && !(b.taskId === x.id && b.date === date));
  const [h0, h1] = autoHoursFor(date);
  const from0 = date === today() ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0;
  const order = [...new Set([x.when, 'evening', 'morning', 'afternoon'].filter(Boolean))];
  const out = [];
  for (const part of order) {
    const [a, b] = WINDOWS[part];
    let from = Math.max(a, h0, from0, s.dayStart);
    const end = Math.min(b, Math.max(h1, a === WINDOWS.evening[0] ? Math.min(s.dayEnd, 1380) : h1));
    for (let k = 0; k < 2 && out.length < n; k++) {
      const at = freeSlot(busy, need, { from, dayStart: s.dayStart, dayEnd: end, snap: s.snap });
      if (at == null || at + need > end) break;
      const next = busy.map((y) => y.start).filter((st) => st >= at + need).sort((p, q) => p - q)[0];
      out.push({ start: at + lead, part, until: next ?? end });
      from = at + need + 60; // a second one in the same part of day, an hour later or more
      if (part !== order[0]) break;
    }
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

// Putting an occurrence on the plan: a block of its own for that day (the task stays "pick the time").
export function fixOcc(x, date, start) {
  return planTask(x, date, Math.max(0, start - leadOf(x)), { series: true, occ: date, pickOcc: true, auto: false });
}
export function skipOcc(x, date) { upsert('tasks', { ...x, skipped: [...new Set([...(x.skipped || []), date])] }); }
// "N times a week": the planner's placements over the days left.
export function timesPlacements(x, days) { return planPlacements([x.id], days).slice(0, timesLeft(x, days[days.length - 1])); }
export function fixTimes(x, p) { const b = placeBlock(x, p); return upsert('blocks', { ...b, pickOcc: true, auto: false }); }

// The card's rows: [{x, date, options}] and [{x, n, placements}].
export function cardRows(from, to) {
  return toFix(from, to).map((r) => (r.date ? { ...r, options: slotOptions(r.x, r.date) } : { ...r, placements: timesPlacements(r.x, r.days) }));
}
// Today: today's own occurrences always; from the weekly moment, the whole week the card is about.
export function todayRows() {
  const td = today(); const wk = cardWeek(); const key = wk;
  const weekOn = state.settings.weekCardLater !== key; // "Later" hides the week until the next one
  const to = weekOn ? addDays(wk, 6) : td;
  return { rows: cardRows(td, to), weekOn, key };
}
export function laterWeek(key) { saveSettings({ weekCardLater: key }); }

export function weekCardHtml({ rows, title, key = null }) {
  if (!rows.length) return '';
  const dayLabel = (d) => relDay(d);
  const chip = (attrs, label, on) => `<button type="button" class="occ-chip${on ? ' on' : ''}" ${attrs}>${esc(label)}</button>`;
  const body = rows.map((r) => {
    if (r.date) {
      const opts = r.options.map((o, i) => chip(`data-action="fix-occ" data-id="${esc(r.x.id)}" data-date="${r.date}" data-start="${o.start}"`, fmtTime(o.start), i === 0)).join('');
      return `<div class="occ-row"><div class="occ-head"><span><b>${esc(r.x.title)}</b> · ${esc(dayLabel(r.date))}</span><small>${esc([fmtDur(r.x.minutes || 30), r.x.when ? t('usuallyPart', t(`when_${r.x.when}`).toLowerCase()) : ''].filter(Boolean).join(' · '))}</small></div>
        <div class="occ-chips">${opts || `<small class="hint">${esc(t('noFreeSlotDay'))}</small>`}${chip(`data-action="occ-more" data-id="${esc(r.x.id)}" data-date="${r.date}"`, t('otherTime'))}${chip(`data-action="occ-skip" data-id="${esc(r.x.id)}" data-date="${r.date}"`, t('skip'))}</div></div>`;
    }
    const opts = r.placements.map((p) => chip(`data-action="fix-times" data-id="${esc(r.x.id)}" data-date="${p.date}" data-start="${p.start}" data-minutes="${p.minutes}"`, `${dayLabel(p.date)} ${fmtTime(p.start)}`, true)).join('');
    return `<div class="occ-row"><div class="occ-head"><span><b>${esc(r.x.title)}</b> · ${esc(t('timesLeftN', r.n))}</span><small>${esc(fmtDur(r.x.minutes || 30))}</small></div><div class="occ-chips">${opts || `<small class="hint">${esc(t('noFreeSlotWeek'))}</small>`}</div></div>`;
  }).join('');
  const any = rows.some((r) => (r.options || r.placements || []).length);
  return `<section class="week-card"><div class="wc-head"><b>${esc(title)}</b><small>${rows.length}</small></div>${body}
    <div class="button-row left">${any ? `<button class="btn primary" type="button" data-action="fix-week">${esc(t('fixHighlighted'))}</button>` : ''}${key ? `<button class="btn" type="button" data-action="week-later" data-id="${esc(key)}">${esc(t('laterBtn'))}</button>` : ''}</div></section>`;
}
// Accepting every highlighted suggestion of a card (the first slot of each day; all the placements).
export function fixAll(rows) {
  let n = 0;
  for (const r of rows) {
    const x = get('tasks', r.x.id); if (!x) continue;
    if (r.date && r.options?.[0]) { fixOcc(x, r.date, r.options[0].start); n++; }
    for (const p of r.placements || []) { fixTimes(x, p); n++; }
  }
  ui.weekRows = null;
  return n;
}
