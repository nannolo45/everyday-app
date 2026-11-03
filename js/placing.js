// placing.js (v69): putting something on a day at a time, by dragging it or tapping it then a free stretch.
// A task is simply planned there. A routine depends on its rhythm:
// - "N volte a settimana": one of the N (past N it asks: one more this week?);
// - "la scelgo ogni settimana": on one of its days it fills that day's turn; a turn dragged elsewhere keeps
//   its day (`occ`); dropped on another day it asks: instead of which turn, or one more;
// - fixed times: on one of its days it's already there (drag the block to move it); on another day it
//   asks: instead of which turn (only that one moves), or one more;
// - "quando capita": a turn wherever you put it, as often as you like.
// Every placement can be undone from the bar at the bottom.
import { esc, planSettings, relDay, toast, ui } from './core.js';
import { t } from './i18n.js';
import { busyOn, countedOf, deleteBlock, ensureSeries, followParent, isEnded, isSeries, itemById, leadOf, outcomeOf, planTask, timesLeft, turnCounts } from './model.js';
import { isEvent } from './kinds.js';
import { addDays, fmtDur as fmtDurShort, fmtTime, freeSlot, isOccurrence, nowMinutes, parseDate, ruleAt, today } from './plan.js';
import { autoHoursFor, warnConflicts } from './planning.js';
import { isRoutine } from './routines.js';
import { changed } from './shell.js';
import { get, live, remove, upsert } from './store.js';
import { fixOcc, skipOcc } from './weekpick.js';
import { openModal } from './widgets.js';

const mondayOf = (d) => addDays(d, -((parseDate(d).getDay() + 6) % 7));
// What kind of routine it is, for placing.
export function rhythmOf(x) {
  if (!isRoutine(x)) return 'task';
  const r = ruleAt(x, today());
  if (r.repeat === 'times') return 'times';
  if (isSeries(x)) return r.pickTime ? 'pick' : r.seriesTime != null || r.slotTimes ? 'fixed' : 'pick';
  return 'any';
}
// The first start on a date where it fits (inside the planner's hours; today: from now on).
export function firstFreeStart(x, date) {
  const s = planSettings(); const [h0, h1] = autoHoursFor(date);
  const lead = leadOf(x); const need = (x.minutes || 30) + lead;
  const from = Math.max(h0, s.dayStart, date === today() ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0);
  const at = freeSlot(busyOn(date).filter((b) => !b.allowOverlap), need, { from, dayStart: from, dayEnd: Math.max(h1, from + need), snap: s.snap || 15 });
  return at ?? from;
}
const openBlocks = (x) => live('blocks').filter((b) => b.taskId === x.id && !outcomeOf(b) && b.kind !== 'prep' && !b.stepId);
// After a placement: `extra.then` runs (v70: the block it took the place of moves), and Undo undoes both.
const done = (made, undo, extra = {}) => {
  if (made && extra.then) extra.then();
  changed();
  if (!made) return;
  warnConflicts(get('blocks', made.id));
  toast(t('plannedToast', relDay(made.date), fmtTime(made.start + leadOf(get('tasks', made.taskId)))), 5000, [{ label: t('undo'), run: () => { undo(); if (extra.alsoUndo) extra.alsoUndo(); changed(); toast(t('undone')); } }]);
};
const undoNew = (b) => () => { if (get('blocks', b.id)) remove('blocks', b.id); };
// Put task or routine `x` on `date` at `start` (the block's start). `occ`: the turn it was dragged as.
export function placeItem(x, date, start, { occ = null, then = null, alsoUndo = null } = {}) {
  const ex = { then, alsoUndo };
  if (!x) return;
  if (date < today()) { toast(t('pastDay')); return; }
  const kind = rhythmOf(x);
  if (kind === 'task' || kind === 'any') { const b = planTask(x, date, start, isSeries(x) ? { series: true, auto: false } : {}); done(b, undoNew(b), ex); return; }
  if (isEnded(x) || (x.repeatUntil && date > x.repeatUntil)) { toast(t('dropEnded', relDay(x.repeatUntil || today()))); return; }
  if (kind === 'times') {
    if (timesLeft(x, date) > 0) { const b = planTask(x, date, start, { series: true, pickOcc: true, auto: false }); done(b, undoNew(b), ex); return; }
    askPlace(x, date, start, [], t('dropTimesFull', Number(x.timesN) || 1), ex); return;
  }
  const has = (d) => live('blocks').some((b) => b.taskId === x.id && (b.date === d || b.occ === d) && b.kind !== 'prep' && !b.stepId);
  if (kind === 'pick') {
    if (occ) { const b = occ === date ? fixOcc(x, date, start) : planTask(x, date, start, { series: true, occ, pickOcc: true, auto: false }); done(b, undoNew(b), ex); return; }
    if (isOccurrence(x, date) && !has(date) && !(x.skipped || []).includes(date)) { const b = fixOcc(x, date, start); done(b, undoNew(b), ex); return; }
    const ws = mondayOf(date); const turns = [];
    for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d >= today() && isOccurrence(x, d) && !has(d) && !(x.skipped || []).includes(d)) turns.push({ value: `occ:${d}`, label: t('dropInstead', relDay(d)), sub: t('dropInsteadSub') }); }
    askPlace(x, date, start, turns, '', ex); return;
  }
  // fixed times
  if (isOccurrence(x, date) && has(date)) { toast(t('dropFixedThere')); return; }
  const ws = mondayOf(date);
  const turns = openBlocks(x).filter((b) => b.date >= ws && b.date <= addDays(ws, 6) && b.date !== date)
    .sort((a, b) => (a.date < b.date ? -1 : 1)).map((b) => ({ value: `move:${b.id}`, label: t('dropInstead', `${relDay(b.date)} ${fmtTime(b.start + leadOf(x))}`), sub: t('dropOnlyThis') }));
  askPlace(x, date, start, turns, '', ex);
}
// "Al posto di …" or "In più": a small sheet.
function askPlace(x, date, start, turns, why = '', ex = {}) {
  openModal(`<h2>${esc(x.title)}</h2><p class="hint">${esc(`${relDay(date)} · ${fmtTime(start + leadOf(x))}`)}${why ? ` · ${esc(why)}` : ''}</p>
    <div class="choose">${turns.map((o) => `<button class="btn choose-opt" value="${esc(o.value)}"><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></button>`).join('')}
    <button class="btn choose-opt" value="extra"><b>${esc(t('dropExtra'))}</b><small>${esc(t('dropExtraSub'))}</small></button></div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    const cur = get('tasks', x.id);
    if (action === 'extra') { const b = planTask(cur, date, start, { series: true, auto: false, extra: true }); done(b, undoNew(b), ex); return; }
    if (action.startsWith('occ:')) { const occ = action.slice(4); const b = planTask(cur, date, start, { series: true, occ, pickOcc: true, auto: false }); done(b, undoNew(b), ex); return; }
    if (action.startsWith('move:')) {
      const old = get('blocks', action.slice(5)); if (!old) return;
      const before = { ...old };
      const m = upsert('blocks', { ...old, date, start, auto: false }, { silent: true }); followParent(m);
      done(m, () => upsert('blocks', before, { silent: true }), ex);
    }
  }, { cls: 'sheet choose-sheet' });
}
// A block dragged to another stretch or day (only that one; a series turn stops following the series).
export function moveBlockTo(id, date, start, ex = {}) {
  const b = get('blocks', id); if (!b) return;
  if (date < today()) { toast(t('pastDay')); return; }
  const before = { ...b };
  const m = upsert('blocks', { ...b, date, start, auto: false }, { silent: true });
  followParent(m);
  done(m, () => upsert('blocks', before, { silent: true }), ex);
}

// ---------- (v70) taking someone's place, and choosing who stays ----------
// Where a block goes when something else takes its slot: the first free time that day, a place you pick
// (it becomes the one you're placing), or off the plan: a task back to "to plan", a routine's turn to plan
// again, a turn of a routine with fixed times skipped. Returns how to undo it.
function moveChoices(y) {
  const x = y.taskId && get('tasks', y.taskId);
  const ff = freeStartFor(y);
  const fixedTurn = y.seriesId && !y.pickOcc;
  const back = isEvent(x) ? null : fixedTurn ? ['skip', t('mvSkip'), t('mvSkipSub')] : x && isRoutine(x) ? ['back', t('mvBackTurn'), t('mvBackTurnSub')] : ['back', t('mvBack'), t('mvBackSub')];
  return `<button class="btn primary choose-opt" value="mv:free" ${ff == null ? 'disabled' : ''}><b>${esc(t('mvFree'))}</b><small>${esc(ff == null ? t('mvNoFree') : `${relDay(y.date)} ${fmtTime(ff)}`)}</small></button>
    <button class="btn choose-opt" value="mv:pick"><b>${esc(t('mvPick'))}</b><small>${esc(t('mvPickSub', y.title))}</small></button>
    ${back ? `<button class="btn choose-opt" value="mv:${back[0]}"><b>${esc(back[1])}</b><small>${esc(back[2])}</small></button>` : ''}`;
}
// The first free start that day for block `y` (not counting its own slot, nor anything taking it).
function freeStartFor(y, taken = null) {
  const s = planSettings(); const [h0, h1] = autoHoursFor(y.date);
  const from = Math.max(h0, s.dayStart, y.date === today() ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0);
  const busy = busyOn(y.date).filter((b) => !b.allowOverlap && b.id !== y.id);
  if (taken) busy.push(taken);
  return freeSlot(busy, y.minutes || 30, { from, dayStart: from, dayEnd: Math.max(h1, from + (y.minutes || 30)), snap: s.snap || 15 });
}
function applyMove(y, how, taken = null) {
  const before = { ...y };
  const x = y.taskId && get('tasks', y.taskId);
  const xBefore = x ? { ...x } : null;
  if (how === 'free') { const at = freeStartFor(y, taken); if (at == null) return () => {}; const m = upsert('blocks', { ...y, start: at, auto: false }, { silent: true }); followParent(m); }
  if (how === 'back') deleteBlock(y);
  if (how === 'skip') { if (x) skipOcc(x, y.occ || y.date); deleteBlock(y); }
  if (how === 'pick') { ui.pickBlock = y.id; ui.pick = null; ui.pickOcc = null; }
  return () => { upsert('blocks', before, { silent: true }); if (xBefore && how === 'skip') upsert('tasks', xBefore, { silent: true }); if (how === 'pick') ui.pickBlock = null; };
}
// Placing something on a busy block: it takes that slot; you say where the other one goes.
export function openSwap(yId) {
  const y = get('blocks', yId); if (!y) return;
  const pb = ui.pickBlock && get('blocks', ui.pickBlock);
  const px = !pb && ui.pick && get('tasks', ui.pick);
  if (!pb && !px) return;
  const title = pb ? pb.title : px.title;
  openModal(`<h2>${esc(t('swapTitle', title, fmtTime(y.start)))}</h2><p class="hint">${esc(t('swapWhere', y.title))}</p>
    <div class="choose">${moveChoices(y)}</div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (!action.startsWith('mv:')) return;
    const how = action.slice(3); const occ = ui.pickOcc;
    const slot = { start: y.start, minutes: pb ? pb.minutes : (px.minutes || 30) };
    let undoY = () => {};
    const then = () => { undoY = applyMove(get('blocks', y.id), how, slot); };
    ui.pick = null; ui.pickOcc = null; ui.pickBlock = null;
    if (pb) moveBlockTo(pb.id, y.date, y.start, { then, alsoUndo: () => undoY() });
    else placeItem(px, y.date, y.start, { occ, then, alsoUndo: () => undoY() });
    if (how === 'pick') { location.hash = `#/plan/${y.date}`; changed(); }
  }, { cls: 'sheet choose-sheet' });
}
// A conflict, by hand: the two side by side with "Tieni questo"; then where the other one goes.
export function openConflictChoice(c) {
  if (!c) return;
  const items = c.ids.map((id) => get('blocks', id) || { ...itemById(id), fixed: true }).filter(Boolean);
  if (items.length < 2) return;
  const [a, b] = items;
  const ov = Math.max(0, Math.min(a.start + a.minutes, b.start + b.minutes) - Math.max(a.start, b.start));
  const side = (x, other) => `<div class="vs-side${x.fixed || x.isEvent ? ' ev' : ''}"><b>${x.fixed ? '📅 ' : ''}${esc(x.title)}</b><small>${esc(`${fmtTime(x.start)}–${fmtTime(x.start + x.minutes)}`)}${x.fixed ? ` · ${esc(t('keepFixed'))}` : ''}</small>
    <button class="btn small primary" value="keep:${esc(x.id)}" ${other.fixed ? 'disabled' : ''}>${esc(t('keepThis'))}</button></div>`;
  openModal(`<h2>${esc(t('keepTitle', fmtTime(Math.max(a.start, b.start))))}</h2><p class="hint">${esc(t('keepOverlap', fmtDurShort(ov)))}</p>
    <div class="vs">${side(a, b)}${side(b, a)}</div>
    <div class="choose"><button class="btn choose-opt" value="both"><b>${esc(t('bothOk'))}</b><small>${esc(t('bothOkSub'))}</small></button></div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (action === 'both') { const mv = items.find((x) => !x.fixed); if (mv) { upsert('blocks', { ...get('blocks', mv.id), allowOverlap: true }, { silent: true }); changed(); } return; }
    if (!action.startsWith('keep:')) return;
    e.preventDefault();
    const keep = items.find((x) => x.id === action.slice(5)); const other = items.find((x) => x !== keep);
    if (other.fixed) { toast(t('cantMove', other.title)); return; }
    openModal(`<h2>${esc(t('keepStays', keep.title))}</h2><p class="hint">${esc(t('keepWhere', other.title))}</p>
      <div class="choose">${moveChoices(get('blocks', other.id))}</div>
      <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (f2, act) => {
      if (!act.startsWith('mv:')) return;
      const how = act.slice(3);
      const undo = applyMove(get('blocks', other.id), how);
      if (how === 'pick') { location.hash = `#/plan/${other.date}`; changed(); return; }
      changed();
      const now = get('blocks', other.id);
      toast(how === 'free' && now ? t('movedTo', now.title, fmtTime(now.start)) : t('wgOnceRemoved'), 5000, [{ label: t('undo'), run: () => { undo(); changed(); toast(t('undone')); } }]);
    }, { cls: 'sheet choose-sheet' });
  }, { cls: 'sheet choose-sheet' });
}
// (v69) "Per N volte": after a turn is marked, say whether it counts, with the other choice one tap away.
export function countToast(blockId) {
  const b = get('blocks', blockId); const x = b && get('tasks', b.taskId);
  if (!x?.repeatCount || !outcomeOf(b)) return false;
  const n = countedOf(x); const on = turnCounts(b);
  toast(on ? t('tickCounted', n, x.repeatCount) : t('tickNotCounted', n, x.repeatCount), 7000, [{ label: on ? t('dontCount') : t('countIt'), run: () => { setCounts(blockId, !on); countToast(blockId); } }]);
  return true;
}
export function setCounts(blockId, on) {
  const b = get('blocks', blockId); if (!b) return;
  upsert('blocks', { ...b, counts: on }, { silent: true });
  const x = get('tasks', b.taskId);
  if (x && isSeries(x)) ensureSeries(x); // an uncounted turn adds one at the end (or brings it back from Concluse)
  changed();
}
