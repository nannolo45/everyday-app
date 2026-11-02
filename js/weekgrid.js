// weekgrid.js (v66): "Quando", the week grid. Days × parts of the day (the planner's own windows:
// morning · afternoon · evening); one tap is one slot, at the first free start that fits there (tap the
// time to pick another). Only this time (blocks of their own), every week or every 2 weeks (a weekly
// series with a time for each day: `slotTimes` {isoDay: minute}, read by ensureSeries). Opened from the +
// sheet, the task sheet, Rivedi, the planner pane ("Sposta") and the search.
import { esc, planSettings, toast } from './core.js';
import { t } from './i18n.js';
import { anchorOffset, busyOn, deleteBlock, ensureSeries, followParent, isSeries, leadOf, outcomeOf, planTask, seriesBlocks } from './model.js';
import { addDays, fmtDur, fmtTime, freeSlot, isoDay, nowMinutes, parseDate, today, weekday } from './plan.js';
import { autoHoursFor, warnConflicts } from './planning.js';
import { WINDOWS } from './smart.js';
import { get, live, upsert } from './store.js';
import { changed } from './shell.js';
import { dayShort, openModal } from './widgets.js';

export const PARTS = ['morning', 'afternoon', 'evening'];
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
export const partOf = (m) => (m < WINDOWS.morning[1] ? 'morning' : m < WINDOWS.afternoon[1] ? 'afternoon' : 'evening');

// The stretch of a part of the day the planner may use: [from, to] in minutes (today: not before now).
// The planner's hours (Settings → Planner) bound it, as for the weekly "pick a time" card; evenings may run
// on to the end of your day (23:00 at most).
export function partSpan(date, part) {
  const s = planSettings();
  const [a, b] = WINDOWS[part];
  const [h0, h1] = autoHoursFor(date);
  let from = Math.max(a, h0, s.dayStart);
  const to = Math.min(b, part === 'evening' ? Math.max(h1, Math.min(s.dayEnd, 1380)) : h1);
  if (date === today()) from = Math.max(from, Math.ceil((nowMinutes() + 5) / 5) * 5);
  return [from, to];
}
// What's busy on a date for this task (its own blocks don't count: they're what we're moving).
function busyFor(x, date, skipIds) {
  return busyOn(date).filter((b) => !b.allowOverlap && b.taskId !== x.id && !skipIds.has(b.id));
}
// A cell: free minutes in it, the first block start that fits (need = length + the lead time), or null.
export function cellInfo(x, date, part, skipIds = new Set()) {
  const [from, to] = partSpan(date, part);
  if (to - from < 15) return { past: true, free: 0, start: null, from, to };
  const busy = busyFor(x, date, skipIds).map((b) => [Math.max(from, b.start), Math.min(to, b.start + (b.minutes || 0))]).filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0]);
  let free = 0; let cur = from;
  for (const [p, q] of busy) { if (p > cur) free += p - cur; cur = Math.max(cur, q); }
  if (to > cur) free += to - cur;
  const need = (x.minutes || 30) + leadOf(x);
  const s = planSettings();
  const start = freeSlot(busyFor(x, date, skipIds), need, { from, dayStart: from, dayEnd: to, snap: s.snap || 15 });
  return { past: false, free, start, from, to };
}
// The other starts that fit in a cell (up to six, half an hour apart or more).
function startsIn(x, date, part, skipIds) {
  const [from, to] = partSpan(date, part);
  const need = (x.minutes || 30) + leadOf(x); const s = planSettings();
  const busy = busyFor(x, date, skipIds); const out = [];
  let f = from;
  while (out.length < 6) {
    const at = freeSlot(busy, need, { from: f, dayStart: from, dayEnd: to, snap: s.snap || 15 });
    if (at == null) break;
    out.push(at); f = at + 30;
  }
  return out;
}
const openBlocksOf = (x) => live('blocks').filter((b) => b.taskId === x.id && !outcomeOf(b) && b.date >= today() && b.kind !== 'prep' && !b.stepId);
// The slots as words: "Lun pom · Mar mat · Ven sera" (and "· ogni sett.").
export function slotsText(sel, mode = 'once') {
  const list = [...sel].sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));
  const s = list.map((p) => `${dayShort(isoDay(p.date))} ${t(`wgPart_${p.part}`)}`).join(' · ');
  return mode === 'weekly' ? `${s} · ${t('wgWeekly').toLowerCase()}` : mode === '2w' ? `${s} · ${t('wg2w').toLowerCase()}` : s;
}
// What the task has now, as cells: a weekly series with times → its days in the week shown; otherwise
// its open blocks from today on.
function current(x, ws) {
  if (isSeries(x) && x.repeat === 'weekly' && !x.pickTime && (x.seriesTime != null || x.slotTimes)) {
    const days = (x.repeatDays || []).length ? x.repeatDays : [isoDay(x.seriesFrom || x.due || today())];
    const sel = days.map((d) => {
      const date = addDays(ws, d - 1);
      const tm = x.slotTimes?.[d] ?? x.seriesTime;
      const start = Math.max(0, tm - anchorOffset(null, x));
      return { date, part: partOf(start + leadOf(x)), start };
    });
    return { sel, mode: Number(x.every) === 2 ? '2w' : 'weekly' };
  }
  return { sel: openBlocksOf(x).map((b) => ({ date: b.date, part: partOf(b.start + leadOf(x)), start: b.start, blockId: b.id })), mode: 'once' };
}

// The sheet. `block`: move that one block (only this time). `onClose(how)`: 'done' | 'back' | 'more' | 'quick'.
export function openWeekGrid(task, { block = null, onClose = () => {} } = {}) {
  let x = get('tasks', task.id) || task;
  const moving = block ? get('blocks', block.id) : null;
  const td = today();
  const ws0 = mondayOf(td);
  const cur = moving ? { sel: [], mode: 'once' } : current(x, ws0);
  const st = { w: moving ? Math.max(0, Math.round((parseDate(mondayOf(moving.date)) - parseDate(ws0)) / (7 * 864e5))) : 0, sel: cur.sel, mode: cur.mode, editing: null, note: '' };
  if (!moving && cur.sel.length) st.w = Math.max(0, Math.round((parseDate(mondayOf(cur.sel.map((p) => p.date).sort()[0])) - parseDate(ws0)) / (7 * 864e5)));
  const skip = new Set(moving ? [moving.id] : []);
  const key = (p) => `${p.date}~${p.part}`;
  const draw = () => {
    x = get('tasks', x.id) || x;
    const ws = addDays(ws0, st.w * 7);
    const len = x.minutes || 30;
    const head = st.w === 0 ? t('wgThisWeek') : st.w === 1 ? t('wgNextWeek') : t('wgInWeeks', st.w);
    let grid = `<div class="wg"><span></span>${PARTS.map((p) => `<span class="wg-h">${esc(t(`when_${p}`))}</span>`).join('')}`;
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      grid += `<span class="wg-d${date === td ? ' today' : ''}">${esc(dayShort(i + 1))}<small>${parseDate(date).getDate()}</small></span>`;
      for (const part of PARTS) {
        const on = st.sel.find((p) => p.date === date && p.part === part);
        const c = date < td ? { past: true } : cellInfo(x, date, part, skip);
        const was = moving && moving.date === date && partOf(moving.start + leadOf(x)) === part;
        const full = !c.past && c.start == null;
        const label = on ? `✓ ${fmtTime(on.start + leadOf(x))}<small>${esc(fmtDur(len))}</small>` : c.past ? '—' : full ? esc(t('wgFull')) : esc(t('wgFree', fmtDur(c.free)));
        grid += `<button class="wg-c${on ? ' on' : ''}${full && !on ? ' full' : ''}${c.past ? ' past' : ''}${was ? ' was' : ''}" value="cell~${date}~${part}" ${c.past ? 'disabled' : ''} formnovalidate aria-pressed="${Boolean(on)}" aria-label="${esc(`${dayShort(i + 1)} ${t(`when_${part}`)}`)}">${label}</button>`;
      }
    }
    grid += '</div>';
    const sorted = [...st.sel].sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));
    const picked = sorted.length ? `<div class="wg-picked">${sorted.map((p) => {
      const k = key(p); const ed = st.editing === k;
      const starts = ed ? startsIn(x, p.date, p.part, skip) : [];
      const name = st.mode === 'once' ? `${dayShort(isoDay(p.date))} ${parseDate(p.date).getDate()}` : t('wgEvery', dayShort(isoDay(p.date)).toLowerCase());
      return `<div class="wg-pk"><span>${esc(name)} · ${esc(t(`when_${p.part}`).toLowerCase())}</span><button class="mchip${ed ? ' set' : ''}" value="edit~${k}" formnovalidate aria-label="${esc(t('wgTimes'))}">${esc(fmtTime(p.start + leadOf(x)))}</button><button class="icon" value="rm~${k}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>
        ${ed ? `<div class="wg-times">${starts.map((m) => `<button class="mchip${m === p.start ? ' set' : ''}" value="time~${k}~${m}" formnovalidate>${esc(fmtTime(m + leadOf(x)))}</button>`).join('') || `<small class="hint">${esc(t('wgOverlap'))}</small>`}</div>` : ''}`;
    }).join('')}</div>` : '';
    const n = st.sel.length;
    const go = moving ? (n ? t('wgMoveGo') : t('wgNone')) : !n ? t('wgNone') : st.mode === 'once' ? t('wgGo', n) : t('wgGoWeekly', n);
    const canGo = n > 0 || (!moving && cur.sel.length > 0);
    openModal(`<div class="wg-top"><button class="linkish wg-back" value="back" formnovalidate>‹ ${esc(t('back'))}</button><h2>${esc(moving ? t('wgMoving', x.title) : t('wgTitle'))}</h2></div>
      <p class="hint wg-sub">${esc(moving ? fmtDur(len) : `${x.title} · ${fmtDur(len)}`)}</p>
      ${moving ? '' : `<div class="pills wg-quick">${['today', 'tomorrow', 'week', 'none'].map((k) => `<button class="mchip" value="quick~${k}" formnovalidate>${esc(t(`wp_${k}`))}</button>`).join('')}</div>
      <p class="hint">${esc(t('wgPickHint'))}</p>`}
      <div class="wg-nav"><button class="icon" value="wk~-1" formnovalidate ${st.w === 0 ? 'disabled' : ''} aria-label="${esc(t('rtPrevWeek'))}">‹</button><b>${esc(head)}</b><button class="icon" value="wk~1" formnovalidate aria-label="${esc(t('rtNextWeek'))}">›</button></div>
      ${grid}
      ${st.note ? `<p class="hint warn-text">${esc(st.note)}</p>` : ''}
      ${moving ? '' : `<div class="field-label">${esc(t('wgRepeat'))}</div>
      <div class="seg wg-mode">${[['once', 'wgOnce'], ['weekly', 'wgWeekly'], ['2w', 'wg2w']].map(([m, k]) => `<button class="${st.mode === m ? 'on' : ''}" value="mode~${m}" formnovalidate aria-pressed="${st.mode === m}">${esc(t(k))}</button>`).join('')}</div>
      <button class="linkish wg-more" value="more" formnovalidate>${esc(t('wgMore'))}</button>`}
      ${picked}
      <div class="button-row wg-go"><button class="btn primary" value="go" ${canGo ? '' : 'disabled'}>${esc(go)}</button></div>`, (form, action, e) => {
      e.preventDefault();
      const [a, b1, b2] = action.split('~');
      if (a === 'back') { onClose('back'); return; }
      if (a === 'more') { onClose('more'); return; }
      if (a === 'quick') { onClose('quick', b1); return; }
      if (a === 'wk') { st.w = Math.max(0, st.w + Number(b1)); st.editing = null; }
      if (a === 'mode') {
        st.mode = b1; st.note = '';
        if (b1 !== 'once') { // one a day at most: keep the first of each weekday
          const seen = new Set(); const before = st.sel.length;
          st.sel = st.sel.filter((p) => { const d = isoDay(p.date); if (seen.has(d)) return false; seen.add(d); return true; });
          if (st.sel.length < before) st.note = t('wgOneADay');
        }
      }
      if (a === 'cell') {
        const date = b1; const part = b2; st.note = '';
        const i = st.sel.findIndex((p) => p.date === date && p.part === part);
        if (i >= 0) st.sel.splice(i, 1);
        else {
          const c = cellInfo(x, date, part, skip);
          const start = c.start ?? c.from;
          if (c.start == null) st.note = t('wgOverlap');
          if (moving) st.sel = [];
          if (st.mode !== 'once') {
            const j = st.sel.findIndex((p) => isoDay(p.date) === isoDay(date));
            if (j >= 0) { st.sel.splice(j, 1); st.note = t('wgOneADay'); }
          }
          st.sel.push({ date, part, start });
        }
        st.editing = null;
      }
      if (a === 'edit') st.editing = st.editing === `${b1}~${b2}` ? null : `${b1}~${b2}`;
      if (a === 'rm') st.sel = st.sel.filter((p) => key(p) !== `${b1}~${b2}`);
      if (a === 'time') { const p = st.sel.find((q) => key(q) === `${b1}~${b2}`); if (p) p.start = Number(action.split('~')[3]); st.editing = null; }
      if (a === 'go') {
        const r = moving ? moveTo(x, moving, st.sel[0]) : apply(x, cur, st.sel, st.mode);
        changed();
        if (r) toast(r);
        onClose('done');
        return;
      }
      draw();
    }, { cls: 'sheet full wg-sheet' });
  };
  draw();
}

// One block to another cell (only this time; a series occurrence stops following the series).
function moveTo(x, b, p) {
  if (!p) return null;
  const moved = upsert('blocks', { ...b, date: p.date, start: p.start, auto: false }, { silent: true });
  followParent(moved);
  warnConflicts(get('blocks', moved.id));
  return t('plannedToast', p.date === today() ? t('today') : `${dayShort(isoDay(p.date))} ${parseDate(p.date).getDate()}`, fmtTime(p.start + leadOf(x)));
}
// The cells chosen, as the plan: blocks of their own (only this time) or a weekly series.
function apply(x, cur, sel, mode) {
  const td = today();
  if (mode === 'once') {
    if (isSeries(x)) { // a routine becomes a one-off: its open occurrences go (done ones stay)
      for (const b of seriesBlocks(x.id).filter((y) => !outcomeOf(y) && y.date >= td)) deleteBlock(b);
      x = upsert('tasks', { ...x, repeat: null, repeatDays: [], slotTimes: null, seriesTime: null, pickTime: null, whenMode: 'once', kind: x.kind === 'saved' ? 'saved' : x.kind }, { silent: true });
      cur = { sel: [], mode: 'once' };
    }
    const keep = new Set(sel.map((p) => p.blockId).filter(Boolean));
    for (const p of cur.sel) if (p.blockId && !keep.has(p.blockId)) { const b = get('blocks', p.blockId); if (b) deleteBlock(b); }
    let n = 0;
    for (const p of sel) {
      if (p.blockId) {
        const b = get('blocks', p.blockId);
        if (b && (b.date !== p.date || b.start !== p.start)) { const m = upsert('blocks', { ...b, date: p.date, start: p.start, auto: false }, { silent: true }); followParent(m); warnConflicts(get('blocks', m.id)); }
      } else { const b = planTask(get('tasks', x.id), p.date, p.start); warnConflicts(get('blocks', b.id)); }
      n++;
    }
    return n ? t('wgPlaced', n) : t('wgOnceRemoved');
  }
  // Every week / every 2 weeks: one block per day it comes back on, at that day's time.
  const list = [...sel].sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = list[0].date;
  const off = anchorOffset(null, x);
  const slotTimes = Object.fromEntries(list.map((p) => [isoDay(p.date), p.start + off]));
  const days = [...new Set(list.map((p) => isoDay(p.date)))].sort((a, b) => a - b);
  // one-off blocks it had are replaced by the series
  for (const b of openBlocksOf(x).filter((y) => !y.seriesId)) deleteBlock(b);
  const from = first < td ? td : first;
  const rec = upsert('tasks', { ...x, repeat: 'weekly', repeatDays: days, every: mode === '2w' ? 2 : 1, slotTimes, seriesTime: slotTimes[isoDay(first)], pickTime: false, whenMode: 'repeat', due: from, seriesFrom: from, skipped: (x.skipped || []).filter((d) => d < from), noDate: false }, { silent: true });
  // the series' own open blocks follow the new times (blocks moved by hand keep theirs)
  ensureSeries(rec);
  return t('wgSaved', slotsText(list, mode));
}
