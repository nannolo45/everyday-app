// Time tracking (v49): start a task now, pause, finish; the block keeps the real time and the task
// remembers how long it usually takes you. One timer at a time.
// A running block: `startedAt` (ms), `pausedAt` (ms while paused), `pausedMs` (paused so far);
// on Fine: `endedAt`, `minutes` = the real time, `plannedMinutes` = what was planned.
// Starting late pushes what now overlaps (with Undo); finishing early offers the time to the next task.
import { esc, planSettings, ui } from './core.js';
import { t } from './i18n.js';
import { isPalestra, startLink } from './palestra.js';
import { isEvent } from './kinds.js';
import { blocksOn, roomy, outcomeOf, planTask, trySetBlockDone } from './model.js';
import { addDays, fmtDur, fmtTime, nowMinutes, today } from './plan.js';
import { placeBlock, planPlacements } from './planning.js';
import { get, live, remove, upsert } from './store.js';

export const runningBlock = () => live('blocks').find((b) => b.startedAt && !b.endedAt) || null;
export function elapsedMs(b, now = Date.now()) {
  if (!b?.startedAt) return 0;
  const end = b.endedAt || b.pausedAt || now;
  return Math.max(0, end - b.startedAt - (b.pausedMs || 0));
}
// 0:12 under an hour (minutes:seconds would flicker), 1:05 after (hours:minutes).
export function elapsedText(b) {
  const m = Math.floor(elapsedMs(b) / 60000);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
const realMinutes = (b) => Math.max(1, Math.round(elapsedMs(b) / 60000));

// (v100) Focus (pomodoro): a running block can carry `focus: { plan:[{k:'f'|'b', m}], skipMs }`, a run of focus
// blocks and breaks sized to the task (focusPlan). Where you are in it comes from the timer's own time (pauses
// excluded); «salta» adds the rest of the current phase to skipMs. The real time kept is the focus time only.
export const sizeOfMinutes = (m, nSteps = 0) => (m > 90 || nSteps >= 4 ? 'l' : m > 30 ? 'm' : 's');
export function focusPlan(minutes, size = sizeOfMinutes(minutes)) {
  const m = Math.max(5, Number(minutes) || 30);
  if (size === 's') return [{ k: 'f', m: Math.max(10, Math.min(30, Math.round(m / 5) * 5)) }];
  if (size === 'm') { const n = Math.max(1, Math.ceil(m / 30)); return Array.from({ length: n }, (_, i) => [{ k: 'f', m: 25 }, ...(i < n - 1 ? [{ k: 'b', m: 5 }] : [])]).flat(); }
  const n = Math.max(1, Math.ceil(m / 60)); return Array.from({ length: n }, (_, i) => [{ k: 'f', m: 50 }, ...(i < n - 1 ? [{ k: 'b', m: i === 0 ? 15 : 10 }] : [])]).flat();
}
export const focusLabel = (plan) => { const f = plan.filter((p) => p.k === 'f'); return f.length === 1 ? `${f[0].m}′` : `${f.length}×${f[0].m}′`; };
export function focusPhase(b, now = Date.now()) {
  const plan = b?.focus?.plan; if (!plan?.length) return null;
  const e = (elapsedMs(b, now) + (b.focus.skipMs || 0)) / 1000; let t0 = 0; let focusSec = 0;
  for (let i = 0; i < plan.length; i++) {
    const len = plan[i].m * 60;
    if (e < t0 + len) { if (plan[i].k === 'f') focusSec += e - t0; return { i, k: plan[i].k, m: plan[i].m, left: Math.ceil(t0 + len - e), into: e - t0, focusSec, n: plan.filter((p) => p.k === 'f').length, nth: plan.slice(0, i + 1).filter((p) => p.k === 'f').length, next: plan[i + 1] || null, over: false }; }
    if (plan[i].k === 'f') focusSec += len;
    t0 += len;
  }
  return { i: plan.length, k: 'end', m: 0, left: 0, into: e - t0, focusSec: focusSec + (e - t0), n: plan.filter((p) => p.k === 'f').length, nth: plan.filter((p) => p.k === 'f').length, next: null, over: true };
}
export function focusSkip(b) { const ph = focusPhase(b); if (!ph || ph.over) return; upsert('blocks', { ...b, focus: { ...b.focus, skipMs: (b.focus.skipMs || 0) + ph.left * 1000 } }); }
const at5 = (m) => Math.floor(m / 5) * 5;

// The block a task would start on now: today's open one (its first), else a new one from now.
export function startTask(task) {
  const td = today();
  const own = blocksOn(td).filter((b) => b.taskId === task.id && !outcomeOf(b) && b.kind !== 'prep' && !b.startedAt).sort((a, b) => a.start - b.start)[0];
  return startBlock(own || planTask(task, td, at5(nowMinutes())));
}
export function startBlock(block) {
  const other = runningBlock();
  if (other && other.id !== block.id) stopTimer(other, { done: false });
  const td = today(); const now = at5(nowMinutes());
  const late = block.date === td ? now - block.start : 0;
  const b = upsert('blocks', { ...block, date: td, start: now, startedAt: Date.now(), pausedAt: null, pausedMs: 0, endedAt: null, auto: false, plannedStart: block.date === td ? block.start : null });
  const over = overlapsAfter(b);
  if (over.length) ui.lateStart = { id: b.id, late, n: over.length };
  return get('blocks', b.id);
}
export function pauseTimer(b) { if (b && !b.pausedAt) upsert('blocks', { ...b, pausedAt: Date.now() }); }
export function resumeTimer(b) { if (b?.pausedAt) upsert('blocks', { ...b, pausedMs: (b.pausedMs || 0) + (Date.now() - b.pausedAt), pausedAt: null }); }
// Stop: the real time goes on the block and in the task's log; `done` ticks it (as the checkbox would).
export function stopTimer(block, { done = true } = {}) {
  let b = block.pausedAt ? { ...block, pausedMs: (block.pausedMs || 0) + (Date.now() - block.pausedAt), pausedAt: null } : block;
  const fp = b.focus ? focusPhase(b) : null; // (v100) with focus: the focus time, not the breaks
  const minutes = fp ? Math.max(1, Math.round(fp.focusSec / 60)) : realMinutes(b);
  const planned = b.plannedMinutes || b.minutes;
  b = upsert('blocks', { ...b, endedAt: Date.now(), plannedMinutes: planned, minutes: Math.max(5, minutes) });
  const task = b.taskId && get('tasks', b.taskId);
  if (task) upsert('tasks', { ...task, timeLog: [...(task.timeLog || []), { date: b.date, minutes, planned }].slice(-20) }, { silent: true });
  if (ui.lateStart?.id === b.id) ui.lateStart = null;
  if (done) trySetBlockDone(get('blocks', b.id), true);
  return { block: get('blocks', b.id), minutes, planned };
}

// Today's movable blocks that the running one now overlaps (planned length from its new start).
export function overlapsAfter(b) {
  if (roomy(b)) return []; // (v95) other things are meant to go inside it
  const end = b.start + (b.plannedMinutes || b.minutes);
  return blocksOn(b.date).filter((x) => x.id !== b.id && x.taskId && !outcomeOf(x) && !x.startedAt && !x.seriesId && !roomy(x)
    && x.kind !== 'prep' && !isEvent(get('tasks', x.taskId)) && x.start >= b.start && x.start < end);
}
// "Move the next ones": they go to the planner's next good slots (today, else later days); Undo puts them back.
export function shiftAfter(b) {
  const over = overlapsAfter(b);
  if (!over.length) return null;
  const before = over.map((x) => ({ ...x }));
  for (const x of over) remove('blocks', x.id);
  const ids = [...new Set(over.map((x) => x.taskId))];
  const td = today();
  // Today first (the planner would otherwise spread them over emptier days), then the next six.
  const added = planPlacements(ids, [td]).map((p) => placeBlock(get('tasks', p.taskId), p));
  const rest = ids.filter((id) => !added.some((x) => x.taskId === id));
  if (rest.length) added.push(...planPlacements(rest, Array.from({ length: 6 }, (_, i) => addDays(td, i + 1))).map((p) => placeBlock(get('tasks', p.taskId), p)));
  ui.lateStart = null;
  return { before, added };
}
export function undoShift(r) {
  for (const x of r.added) remove('blocks', x.id);
  for (const x of r.before) upsert('blocks', x, { silent: true });
}
// Finished early: the next open block of today that could move up into the time freed.
export function pullCandidate(b) {
  const plannedEnd = b.start + (b.plannedMinutes || b.minutes);
  const now = nowMinutes();
  if (b.date !== today() || plannedEnd - now < 15) return null;
  const next = blocksOn(b.date).filter((x) => x.id !== b.id && x.taskId && !outcomeOf(x) && !x.seriesId && x.start > now && !isEvent(get('tasks', x.taskId)) && x.kind !== 'prep')
    .sort((a, c) => a.start - c.start)[0];
  if (!next) return null;
  const s = planSettings();
  const start = Math.ceil((now + Math.max(5, s.buffer)) / 5) * 5;
  return next.start > start ? { block: next, start, free: plannedEnd - now } : null;
}
export function pullUp(c) { upsert('blocks', { ...c.block, start: c.start, auto: false }); }

// What the task really took the last times: {usual, entries} (usual = the middle value of the last 5).
export function timeHistory(task) {
  const log = (task?.timeLog || []).slice(-5);
  if (!log.length) return null;
  const sorted = log.map((e) => e.minutes).sort((a, b) => a - b);
  const usual = sorted[Math.floor((sorted.length - 1) / 2)];
  return { usual: Math.round(usual / 5) * 5 || usual, entries: [...log].reverse().slice(0, 3) };
}

// The bar at the top of every tab while a timer runs.
export function timerBarHtml() {
  const b = runningBlock();
  if (!b) return '';
  const planned = b.plannedMinutes || b.minutes;
  const x = b.taskId ? get('tasks', b.taskId) : null;
  return `<div class="run-bar${b.pausedAt ? ' paused' : ''}" role="timer" aria-live="off">
    <span class="run-dot" aria-hidden="true"></span>
    <button class="run-main" type="button" data-action="open-block" data-id="${esc(b.id)}"><b>${esc(b.title)}</b><small>${esc(b.palLive ? (b.pausedAt ? t('palLivePaused') : t('palLiveRun', fmtTime(b.start))) : b.pausedAt ? t('timerPaused') : t('timerSince', fmtTime(b.start), fmtDur(planned)))}</small></button>
    <span class="run-time" id="run-time">${elapsedText(b)}</span>
    ${b.palLive ? '' : `<button class="icon run-pause" type="button" data-action="${b.pausedAt ? 'timer-resume' : 'timer-pause'}" aria-label="${esc(t(b.pausedAt ? 'timerResume' : 'timerPause'))}">${b.pausedAt ? '▶' : '❚❚'}</button>`}
    ${isPalestra(x) ? `<a class="btn small run-pal" href="${esc(startLink(x, b))}" target="_blank" rel="noopener">${esc(t('palShort'))} ↗</a>` : ''}
    ${b.palLive ? '' : `<button class="btn small primary" type="button" data-action="timer-stop">${esc(t('timerStop'))}</button>`}
  </div>`;
}

// Started late and now running into what comes next: the card on Today (the same offer as the toast).
export function lateBannerHtml() {
  const ls = ui.lateStart; const b = ls && get('blocks', ls.id);
  if (!b || b.endedAt) return '';
  const over = overlapsAfter(b);
  if (!over.length) return '';
  return `<section class="late-card"><b>${esc(ls.late > 0 ? t('lateBy', fmtDur(ls.late)) : t('runsInto'))}</b>
    <p>${esc(t('lateWhat', fmtTime(b.start + (b.plannedMinutes || b.minutes)), over.map((x) => `${x.title} (${fmtTime(x.start)})`).join(', ')))}</p>
    <div class="button-row left"><button class="btn primary" type="button" data-action="shift-rest" data-id="${esc(b.id)}">${esc(t('shiftRest'))}</button><button class="btn" type="button" data-action="shift-keep">${esc(t('leaveAsIs'))}</button></div></section>`;
}
