// when.js (v81): one «Quando» sheet for everything that puts a task on a day, or moves a block: the +
// sheet's Quando…, the task card, every Sposta, Rivedi and the Overview. The day (today, tomorrow, the
// next days, another day, no date), then the time: an exact one (typed, or a start tapped in a free
// stretch of that day), the first free time, or just "that day" (no time: it waits on that day's list).
// The length. One line says what will happen, and warns when it overlaps something (it lets you).
// The old week grid (several times, every week with a time per day) is one tap away.
import { esc, planSettings, relDay, toast } from './core.js';
import { t } from './i18n.js';
import { busyOn, followParent, isSeries, leadOf, outcomeOf, planTask } from './model.js';
import { addDays, fmtDur, fmtTime, freeSlot, isDate, isoDay, nowMinutes, parseDate, parseTime, today } from './plan.js';
import { warnConflicts } from './planning.js';
import { get, live, upsert } from './store.js';
import { changed } from './shell.js';
import { dateBox, dayShort, openModal, TIME24 } from './widgets.js';

const LENS = [15, 30, 45, 60, 90, 120];
const openBlocks = (x) => live('blocks').filter((b) => b.taskId === x.id && !outcomeOf(b) && b.date >= today() && b.kind !== 'prep' && !b.stepId && !b.seriesId);
const dayName = (d) => (d === today() ? t('today') : d === addDays(today(), 1) ? t('tomorrow') : `${dayShort(isoDay(d))} ${parseDate(d).getDate()}`);

// What's busy that day for this task (its own block, the one being moved, doesn't count).
function busyFor(x, date, skipId) {
  return busyOn(date).filter((b) => !b.allowOverlap && b.id !== skipId && !(b.taskId === x.id && !b.seriesId && !skipId))
    .map((b) => ({ start: b.start, minutes: b.minutes || 0, title: b.title || '' }));
}
// The day's free stretches long enough for `need` minutes: [{a, z, starts: [six starts at most]}].
export function freeStretches(x, date, need, skipId = null) {
  const s = planSettings();
  let from = s.dayStart;
  if (date === today()) from = Math.max(from, Math.ceil((nowMinutes() + 5) / 15) * 15);
  const to = Math.max(s.dayEnd, from);
  const busy = busyFor(x, date, skipId).map((b) => [b.start, b.start + b.minutes]).sort((p, q) => p[0] - q[0]);
  const out = []; let cur = from;
  const add = (a, z) => {
    if (z - a < need) return;
    const starts = []; let m = Math.ceil(a / 15) * 15;
    while (m + need <= z && starts.length < 6) { starts.push(m); m += starts.length < 2 ? 15 : 30; }
    if (starts.length) out.push({ a, z, starts });
  };
  for (const [p, q] of busy) { if (p > cur) add(cur, Math.min(p, to)); cur = Math.max(cur, q); if (cur >= to) break; }
  if (to > cur) add(cur, to);
  return out;
}
function stripHtml(x, date, start, len, skipId) {
  const S = 420; const E = 1380; const W = E - S; const pct = (m) => Math.max(0, Math.min(100, ((m - S) / W) * 100));
  const busy = busyFor(x, date, skipId).filter((b) => b.start + b.minutes > S && b.start < E)
    .map((b) => `<i class="ws-busy" style="left:${pct(b.start)}%;width:${pct(b.start + b.minutes) - pct(b.start)}%" title="${esc(b.title)}"></i>`).join('');
  const me = start != null ? `<i class="ws-me" style="left:${pct(start)}%;width:${Math.max(2, pct(start + len) - pct(start))}%"></i>` : '';
  return `<div class="ws-strip" aria-hidden="true">${busy}${me}</div><div class="ws-ticks"><span>7</span><span>11</span><span>15</span><span>19</span><span>23</span></div>`;
}

// `block`: move that block (only this time). `onClose(how)`: 'done' | 'back' | 'more' | 'grid'.
export function openWhen(task, { block = null, onClose = () => {}, grid = true } = {}) {
  let x = get('tasks', task.id) || task;
  const moving = block ? get('blocks', block.id) : null;
  const td = today(); const lead = leadOf(x);
  const had = moving ? null : openBlocks(x).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
  const was = moving || had;
  const st = {
    day: was ? (was.date < td ? td : was.date) : x.due && x.due >= td ? x.due : td,
    mode: was ? 'at' : 'first',
    time: was ? was.start + lead : null,
    len: (moving ? moving.minutes : x.minutes) || 30,
  };
  const draw = (focus) => {
    x = get('tasks', x.id) || x;
    const skipId = moving?.id || had?.id || null;
    const need = st.len + lead;
    const days = [0, 1, 2, 3, 4].map((i) => addDays(td, i));
    const other = st.day && !days.includes(st.day);
    const chips = days.map((d) => `<button class="day-chip${st.day === d ? ' on' : ''}" value="d~${d}" formnovalidate aria-pressed="${st.day === d}">${esc(dayName(d))}</button>`).join('')
      + `<label class="day-other${other ? ' on' : ''}">${dateBox(`<input name="wsDate" type="date" min="${td}" value="${esc(other ? st.day : '')}" aria-label="${esc(t('otherDay'))}">`, other ? st.day : '')}</label>`
      + (moving ? '' : `<button class="day-chip${!st.day ? ' on' : ''}" value="d~" formnovalidate aria-pressed="${!st.day}">${esc(t('wp_none'))}</button>`);
    let body = '';
    let sum = ''; let warn = '';
    if (!st.day) sum = `<b>${esc(t('wp_none'))}</b><small>${esc(t('wsNoneSub'))}</small>`;
    else {
      const free = st.mode === 'any' ? [] : freeStretches(x, st.day, need, skipId);
      const first = free[0]?.starts[0];
      const at = st.mode === 'at' ? st.time : st.mode === 'first' ? (first != null ? first + lead : null) : null;
      const seg = [['at', 'wsAt'], ['first', 'wsFirst'], ['any', 'wsAny']].map(([k, l]) => `<button class="${st.mode === k ? 'on' : ''}" value="m~${k}" formnovalidate aria-pressed="${st.mode === k}">${esc(t(l))}</button>`).join('');
      body = `<div class="field-label">${esc(t('qwAt'))}</div><div class="seg ws-mode">${seg}</div>
        ${st.mode === 'at' ? `<div class="qw-time ws-time"><input name="wsTime" ${TIME24} value="${st.time != null ? fmtTime(st.time) : ''}" placeholder="—" aria-label="${esc(t('qwAt'))}"><small class="hint">${esc(t('wsAtHint'))}</small></div>` : ''}
        ${st.mode !== 'any' ? `<div class="field-label">${esc(t('wsFreeOn', dayName(st.day)))}</div>
        <div class="ws-free">${free.map((f) => `<div class="ws-row"><b>${esc(`${fmtTime(f.a)}–${fmtTime(f.z)}`)}</b><span class="ws-starts">${f.starts.map((m) => `<button class="mchip${st.mode === 'at' && st.time === m + lead ? ' set' : ''}" value="t~${m + lead}" formnovalidate>${esc(fmtTime(m + lead))}</button>`).join('')}</span></div>`).join('') || `<p class="hint">${esc(t('wsNoFree'))}</p>`}</div>
        ${stripHtml(x, st.day, at != null ? at - lead : null, need, skipId)}` : ''}`;
      if (at != null && st.mode !== 'any') {
        const s0 = at - lead;
        const hit = busyFor(x, st.day, skipId).find((b) => s0 < b.start + b.minutes && s0 + need > b.start);
        if (hit) warn = t('wsOverlap', hit.title);
      }
      const what = st.mode === 'any' ? t('wsAnySum') : at != null ? fmtTime(at) : st.mode === 'first' ? t('wsNoFreeShort') : '—';
      sum = `<b>${esc(`${relDay(st.day)} · ${what} · ${fmtDur(st.len)}`)}</b>${warn ? `<small>⚠ ${esc(warn)}</small>` : st.mode === 'any' ? `<small>${esc(t('wsAnySub'))}</small>` : ''}`;
    }
    const lens = LENS.includes(st.len) ? LENS : [...LENS, st.len].sort((a, b) => a - b);
    const can = !st.day || st.mode === 'any' || st.mode === 'first' || st.time != null;
    openModal(`<div class="wg-top"><button class="linkish wg-back" value="back" formnovalidate>‹ ${esc(t('back'))}</button><h2>${esc(moving ? t('wgMoving', x.title) : x.title)}</h2></div>
      <div class="field-label">${esc(t('whichDay'))}</div>
      <div class="pills day-chips ws-days">${chips}</div>
      ${body}
      <div class="field-label">${esc(t('duration'))}</div>
      <div class="pills qw-lens">${lens.map((m) => `<button class="day-chip${m === st.len ? ' on' : ''}" value="l~${m}" formnovalidate>${esc(fmtDur(m))}</button>`).join('')}</div>
      <p class="qw-sum ws-sum${warn ? ' warn' : ''}">${sum}</p>
      ${!moving && grid ? `<button class="linkish ws-grid" value="grid" formnovalidate>🗓 ${esc(t('wsGrid'))}</button>` : ''}
      ${moving ? '' : `<button class="linkish" value="more" formnovalidate>${esc(t('moreDetails'))}</button>`}
      <div class="button-row ws-go"><button class="btn" value="back" formnovalidate>${esc(t('close'))}</button><button class="btn primary" value="go" ${can ? '' : 'disabled'}>${esc(moving ? t('wgMoveGo') : t('wsGo'))}</button></div>`, (form, action, e) => {
      e.preventDefault();
      readTime(form);
      const [a, v] = action.split('~');
      if (a === 'back') { onClose('back'); return; }
      if (a === 'more') { onClose('more'); return; }
      if (a === 'grid') { onClose('grid'); return; }
      if (a === 'd') { st.day = v; }
      if (a === 'm') { st.mode = v; if (v === 'at' && st.time == null) { const f = freeStretches(x, st.day, need, skipId)[0]; st.time = f ? f.starts[0] + lead : null; } }
      if (a === 't') { st.time = Number(v); st.mode = 'at'; }
      if (a === 'l') st.len = Number(v);
      if (a === 'go') { const r = apply(); changed(); if (r) toast(r); onClose('done'); return; }
      draw(a === 'm' && v === 'at' ? 'input[name=wsTime]' : null);
    }, { cls: 'sheet full ws-sheet' });
    const form = document.querySelector('dialog[open] form');
    form?.querySelector('input[name=wsDate]')?.addEventListener('change', (ev) => { if (isDate(ev.target.value)) { st.day = ev.target.value < td ? td : ev.target.value; draw(); } });
    form?.querySelector('input[name=wsTime]')?.addEventListener('change', () => { readTime(form); draw(); });
    if (focus) form?.querySelector(focus)?.focus();
  };
  const readTime = (form) => { const el = form.querySelector('input[name=wsTime]'); if (el && el.value.trim()) { const m = parseTime(el.value); if (m != null) { st.time = m; st.mode = 'at'; } } };
  const apply = () => {
    if (st.len !== (x.minutes || 30) && !moving) x = upsert('tasks', { ...x, minutes: st.len, lenSet: true }, { silent: true });
    if (!st.day) { upsert('tasks', { ...x, due: null, noDate: true }, { silent: true }); return t('wsNoneDone'); }
    if (st.mode === 'any') { upsert('tasks', { ...x, due: st.day, noDate: false }, { silent: true }); return t('wsAnyDone', relDay(st.day)); }
    const skipId = moving?.id || had?.id || null;
    const need = st.len + leadOf(x);
    let start;
    if (st.mode === 'first') {
      const f = freeStretches(x, st.day, need, skipId)[0];
      const s = planSettings();
      start = f ? f.starts[0] : freeSlot(busyFor(x, st.day, skipId), need, { from: st.day === today() ? nowMinutes() : s.dayStart, dayStart: s.dayStart, dayEnd: 1440, snap: s.snap || 15 }) ?? s.dayStart;
    } else start = Math.max(0, st.time - leadOf(x));
    const cur = moving || had;
    let b;
    if (cur) { b = upsert('blocks', { ...get('blocks', cur.id), date: st.day, start, minutes: st.len, auto: false }, { silent: true }); followParent(b); }
    else b = planTask(get('tasks', x.id), st.day, start, st.len !== (x.minutes || 30) ? { minutes: st.len } : {});
    warnConflicts(get('blocks', b.id));
    return t('plannedToast', relDay(st.day), fmtTime(b.start + leadOf(x)));
  };
  draw();
}
// The grid is for routines (a time per day, every week); everything else uses this sheet.
export const usesWhen = (x, block) => Boolean(block || !isSeries(x));
