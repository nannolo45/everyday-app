// finder.js (v66): the Planner's list of tasks, in the wide pane and on the phone: Da pianificare · Nel
// piano · Tutte, and a search over all of them. A task shows where it is on the plan as pills; a pill
// jumps there and the block flashes. "Sposta…" opens the week grid for that one block.
import { catColor, catName, catsOf, esc, relDay, route, toast, ui } from './core.js';
import { getLang, t } from './i18n.js';
import { isEvent } from './kinds.js';
import { countedOf, ensureSeries, isMealTask, leadOf, outcomeOf } from './model.js';
import { addDays, fmtDur, fmtTime, isoDay, occurrences, today } from './plan.js';
import { trayTasks } from './planning.js';
import { matchesQ } from './shoplist.js';
import { get, live, upsert } from './store.js';
import { endedRoutines, hasRhythm, routines } from './routines.js';

import { currentDate, render } from './shell.js';
import { agendaAdd, agendaPlan, currentView, fixProps, ghostTitle, ghostWhy, keepFix } from './views/planner.js';
import { modal } from './core.js';
import { openPickSheet, openTask } from './editors.js';
import { setWhen } from './views/impegni.js';
import { openWeekGrid } from './weekgrid.js';
import { cardRows, fixOcc, fixTimes, skipOcc, toFix } from './weekpick.js';
import { allItems, typeOf } from './views/impegni.js';
import { taskHay } from './views/tasks.js';
import { isWide } from './views/wide.js';
import { dayShort, openModal, repeatText, searchBox } from './widgets.js';

const byWhen = (a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1);
// The open blocks of a task from today on (its steps' blocks too).
export const upcomingOf = (id) => live('blocks').filter((b) => b.taskId === id && !outcomeOf(b) && b.date >= today() && b.kind !== 'prep').sort(byWhen);
// What the finder knows: your to-dos, routines and own events that aren't done.
export function findItems() {
  return [...allItems(), ...live('tasks').filter((x) => isEvent(x) && !x.deleted)].filter((x) => !x.done);
}
const dayLabel = (d) => (d === today() ? t('today') : d === addDays(today(), 1) ? t('tomorrow') : `${dayShort(isoDay(d))} ${Number(d.slice(8))}`);
const pill = (b) => `<button type="button" class="fd-pill" data-action="fd-go" data-id="${esc(b.id)}">${esc(`${dayShort(isoDay(b.date))} ${Number(b.date.slice(8))} · ${fmtTime(b.start)}`)}</button>`;
const bar = (x) => `<span class="fd-bar" style="--c:${esc(catColor(x?.category) || 'var(--line)')}"></span>`;
function itemRow(x) {
  const ups = upcomingOf(x.id);
  const state = ups.length ? t('nTimesPlanned', ups.length) : t('toSort');
  const sub = [fmtDur(x.minutes || 30), typeOf(x) === 'repeat' ? `↻ ${x.repeat ? repeatText(x) : state}` : state, x.due && !ups.length ? relDay(x.due) : '', ...catsOf(x).slice(0, 1).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · ');
  const pills = ups.slice(0, 3).map(pill).join('') + (ups.length > 3 ? `<span class="fd-pill more">${esc(t('findMoreN', ups.length - 3))}</span>` : '');
  return `<li class="fd-row">${bar(x)}<div class="fd-c"><button type="button" class="fd-t" data-action="task-edit" data-id="${esc(x.id)}">${isEvent(x) ? '📅 ' : ''}${esc(x.title)}<small>${esc(sub)}</small></button>
    <div class="fd-pills">${pills}${isEvent(x) ? '' : `<button type="button" class="fd-pill act" data-action="fd-when" data-id="${esc(x.id)}">${esc(t('whenChip'))}</button>`}</div></div></li>`;
}
// (v68) This week's routine turns that still need a time ("I pick it each week", "N times a week"): the same
// rows as the card on Oggi, with free times to tap, another time, or skip. Counted with the tasks to plan.
const routineTurns = () => cardRows(today(), weekEndOf(today()));
// (v98) the Planner's period on screen (day / week / month), for «Da pianificare» in the pane and for ✦
export function viewRange() {
  const v = currentView(); const d = currentDate();
  if (v === 'week') { const w = addDays(d, -((new Date(`${d}T12:00`).getDay() + 6) % 7)); return { v, from:w, to:addDays(w, 6) }; }
  if (v === 'month') { const m = d.slice(0, 7); const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate(); return { v, from:`${m}-01`, to:`${m}-${String(last).padStart(2, '0')}` }; }
  return { v, from:d, to:d };
}
const whenFor = (x) => x.onDay || x.due || null;
function scopedTodo() {
  const r = viewRange(); const td = today(); const list = trayTasks();
  const inR = (x) => { const w = whenFor(x); if (!w) return false; if (w >= r.from && w <= r.to) return true; return r.from <= td && td <= r.to && w < td; }; // the period with today in it: what's overdue too
  const turns = r.to < td ? [] : cardRows(r.from > td ? r.from : td, r.to);
  return { r, here:list.filter(inR), nodate:list.filter((x) => !whenFor(x)), other:list.filter((x) => whenFor(x) && !inR(x)), turns };
}
function turnRows(rows) {
  return `<ul class="fd-list">${rows.map((r) => {
    const x = r.x;
    const head = r.date ? `${x.title} · ${dayLabel(r.date)}` : `${x.title} · ${t('timesLeftN', r.n)}`;
    const sub = [fmtDur(x.minutes || 30), x.when ? t('usuallyPart', t(`when_${x.when}`).toLowerCase()) : ''].filter(Boolean).join(' · ');
    const chips = r.date
      ? `${r.options.map((o) => `<button type="button" class="fd-pill" data-action="fix-occ" data-id="${esc(x.id)}" data-date="${r.date}" data-start="${o.start}">${esc(fmtTime(o.start))}</button>`).join('') || `<small class="hint">${esc(t('noFreeSlotDay'))}</small>`}
        <button type="button" class="fd-pill act" data-action="occ-more" data-id="${esc(x.id)}" data-date="${r.date}">${esc(t('otherTime'))}</button><button type="button" class="fd-pill act" data-action="occ-skip" data-id="${esc(x.id)}" data-date="${r.date}">${esc(t('skip'))}</button>`
      : r.placements.map((pl) => `<button type="button" class="fd-pill" data-action="fix-times" data-id="${esc(x.id)}" data-date="${pl.date}" data-start="${pl.start}" data-minutes="${pl.minutes}">${esc(`${dayLabel(pl.date)} ${fmtTime(pl.start)}`)}</button>`).join('') || `<small class="hint">${esc(t('noFreeSlotWeek'))}</small>`;
    const on = ui.pick === x.id && (ui.pickOcc || '') === (r.date || '');
    return `<li class="fd-row turn${on ? ' on' : ''}" draggable="true" data-drag="turn:${esc(x.id)}:${r.date || ''}" data-min="${x.minutes || 30}">${bar(x)}<div class="fd-c"><button type="button" class="fd-t" data-action="fd-pick" data-id="${esc(x.id)}" data-occ="${r.date || ''}">↻ ${esc(head)}<small>${esc(sub)}</small></button><div class="fd-pills">${chips}</div></div></li>`;
  }).join('')}</ul>`;
}
// Da pianificare: pick one and the free time it fits in lights up; then the routine turns of the week.
function taskRow(x) {
  return `<li class="fd-row${ui.pick === x.id ? ' on' : ''}" draggable="true" data-drag="task:${esc(x.id)}" data-min="${x.minutes || 30}">${bar(x)}<div class="fd-c">
    <button type="button" class="fd-t" data-action="fd-pick" data-id="${esc(x.id)}" aria-pressed="${ui.pick === x.id}">${esc(x.title)}<small>${esc([x.lenSet === false ? '' : fmtDur(x.minutes || 30), whenFor(x) ? `${x.onDay ? '📌 ' : ''}${relDay(whenFor(x))}` : '', ...catsOf(x).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · '))}</small></button>
    </div></li>`;
}
// (v98) Da pianificare follows the Planner: this day (and what's overdue, on today), this week by day, this month
// by week; below, folded, what has no date and what's for other dates.
function scopedRows() {
  const { r, here, nodate, other, turns } = scopedTodo();
  const min = (xs) => xs.reduce((n, x) => n + (x.minutes || 30), 0);
  const scope = `<p class="fd-scope">${esc(t('fdScope', t(`fdIn_${r.v}`), here.length + turns.length, fmtDur(min(here)) || '0m'))}</p>`;
  let body = '';
  if (r.v === 'day') body = here.length ? `<ul class="fd-list">${here.map(taskRow).join('')}</ul>` : '';
  else {
    const groups = new Map(); const key = (x) => { const w = whenFor(x) < r.from ? r.from : whenFor(x); if (r.v === 'week') return w; return addDays(w, -((new Date(`${w}T12:00`).getDay() + 6) % 7)); };
    for (const x of [...here].sort((a, b) => (whenFor(a) < whenFor(b) ? -1 : 1))) { const k = key(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    body = [...groups].map(([k, xs]) => `<div class="fd-day">${esc(r.v === 'week' ? dayLabel(k) : t('fdWeekOf', `${Number(k.slice(8))}–${Number(addDays(k, 6).slice(8))}`))} <small>${xs.length} · ${esc(fmtDur(min(xs)))}</small></div><ul class="fd-list">${xs.map(taskRow).join('')}</ul>`).join('');
  }
  const turnsHtml = turns.length ? `<div class="fd-day">${esc(t('fdGrpRoutines'))} <small>${turns.length}</small></div>${turnRows(turns)}` : '';
  const fold = (k, label, xs) => xs.length ? `<button type="button" class="fd-fold" data-action="fd-fold" data-id="${k}" aria-expanded="${Boolean(ui.fdFold?.[k])}">${ui.fdFold?.[k] ? '▾' : '▸'} ${esc(label)} · ${xs.length}</button>${ui.fdFold?.[k] ? `<ul class="fd-list">${xs.map(taskRow).join('')}</ul>` : ''}` : '';
  const pick = ui.pick && get('tasks', ui.pick);
  const empty = !here.length && !turns.length ? `<p class="hint fd-empty">✓ ${esc(t('fdNoneIn', t(`fdIn_${r.v}`)))}</p>` : `<p class="hint">${esc(pick ? t('pnPicked', pick.title) : t('pnPick'))}</p>`;
  return `${scope}${empty}${body}${turnsHtml}${fold('nodate', t('fdNoDate'), nodate)}${fold('other', t('fdOther'), other)}`;
}
function todoRows() {
  if (isWide() && route().name === 'plan') return scopedRows();
  const list = trayTasks();
  const turns = routineTurns();
  if (!list.length && !turns.length) return `<p class="hint fd-empty">${esc((ui.assign?.ghosts || []).length ? `✦ ${t('propsAllUp')}` : `✓ ${t('agAllPlanned')}`)}</p>`;
  const both = list.length && turns.length;
  const turnsHtml = turns.length ? `${both || !list.length ? `<div class="fd-day">${esc(t('fdGrpRoutines'))} <small>${turns.length}</small></div>` : ''}${turnRows(turns)}` : '';
  if (!list.length) return turnsHtml;
  const pick = ui.pick && get('tasks', ui.pick);
  return `<p class="hint">${esc(pick ? t('pnPicked', pick.title) : t('pnPick'))}</p>${both ? `<div class="fd-day">${esc(t('fdGrpTasks'))} <small>${list.length}</small></div>` : ''}<ul class="fd-list">${list.map((x) => `<li class="fd-row${ui.pick === x.id ? ' on' : ''}" draggable="true" data-drag="task:${esc(x.id)}" data-min="${x.minutes || 30}">${bar(x)}<div class="fd-c">
    <button type="button" class="fd-t" data-action="fd-pick" data-id="${esc(x.id)}" aria-pressed="${ui.pick === x.id}">${esc(x.title)}<small>${esc([x.lenSet === false ? '' : fmtDur(x.minutes || 30), x.due ? relDay(x.due) : '', ...catsOf(x).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · '))}</small></button>
    </div></li>`).join('')}</ul>${turnsHtml}`; // (v81) no Quando… here: tapping the row plans it
}
// Nel piano: the next two weeks, by day; a row jumps to its block.
function planRows() {
  const td = today(); const end = addDays(td, 13);
  const blocks = live('blocks').filter((b) => b.taskId && !outcomeOf(b) && b.date >= td && b.date <= end && b.kind !== 'prep' && get('tasks', b.taskId)).sort(byWhen);
  if (!blocks.length) return `<p class="hint fd-empty">${esc(t('planNone'))}</p>`;
  const days = new Map();
  for (const b of blocks) { if (!days.has(b.date)) days.set(b.date, []); days.get(b.date).push(b); }
  return [...days].map(([d, bs]) => `<div class="fd-day">${esc(dayLabel(d))}</div><ul class="fd-list">${bs.map((b) => { const x = get('tasks', b.taskId); return `<li class="fd-row">${bar(x)}<div class="fd-c">
    <button type="button" class="fd-t" data-action="fd-go" data-id="${esc(b.id)}">${isEvent(x) ? '📅 ' : ''}${esc(b.title)}<small>${esc(`${fmtTime(b.start)}–${fmtTime(b.start + (b.minutes || 0))}`)}</small></button>
    ${isEvent(x) ? '' : `<div class="fd-pills"><button type="button" class="fd-pill act" data-action="fd-move" data-id="${esc(b.id)}">${esc(t('moveBtn'))}…</button></div>`}</div></li>`; }).join('')}</ul>`).join('');
}
// (v67) The app's proposals (✦ Pianifica per me, and this week's routine turns), by day, with the reason.
// A row jumps to its place in the calendar and flashes it; ✕ drops a proposal.
export function proposalsHtml({ buttons = true } = {}) {
  const ghosts = (ui.assign?.ghosts || []).map((g, i) => ({ fk: `g${i}`, i, date: g.date, start: g.start, minutes: g.minutes || 30, title: ghostTitle(g), why: ghostWhy(g), task: get('tasks', g.taskId) }));
  const fixes = fixProps().map((f) => ({ fk: `f${f.taskId}~${f.date}`, fix: true, taskId: f.taskId, date: f.date, start: f.start, minutes: f.minutes, title: f.title, why: t('propRoutine'), task: get('tasks', f.taskId) }));
  const all = [...ghosts, ...fixes].sort(byWhen);
  if (!all.length) return '';
  const days = new Map();
  for (const p of all) { if (!days.has(p.date)) days.set(p.date, []); days.get(p.date).push(p); }
  return `<div class="pv">${buttons ? `<div class="pv-h"><b>✦ ${esc(t('propsH'))} <small>${all.length}</small></b><button type="button" class="btn small" data-action="ag-cancel">${esc(t('cancel'))}</button><button type="button" class="btn small primary" data-action="ag-add">${esc(t('add'))}</button></div>` : ''}
    ${[...days].map(([d, ps]) => `<div class="fd-day">${esc(dayLabel(d))}</div><ul class="fd-list">${ps.map((p) => `<li class="fd-row pv-row">${bar(p.task)}<div class="fd-c"><button type="button" class="fd-t" data-action="pv-go" data-id="${esc(p.fk)}" data-date="${p.date}">${esc(p.title)}<small>${esc(`${fmtTime(p.start)}–${fmtTime(p.start + p.minutes)}`)}</small>${p.why ? `<span class="pv-why">✦ ${esc(p.why)}</span>` : ''}</button></div>${p.i != null ? `<button type="button" class="icon pv-ok" data-action="ghost-keep" data-i="${p.i}" aria-label="${esc(t('propKeep'))}" title="${esc(t('propKeep'))}">✓</button><button type="button" class="icon pv-x" data-action="ghost-rm" data-i="${p.i}" aria-label="${esc(t('remove'))}">✕</button>` : p.fix ? `<button type="button" class="icon pv-ok" data-action="fix-keep" data-id="${esc(p.taskId)}" data-date="${p.date}" data-start="${p.start}" aria-label="${esc(t('propKeep'))}" title="${esc(t('propKeep'))}">✓</button><button type="button" class="icon pv-x" data-action="pv-fix-x" data-id="${esc(p.taskId)}" data-date="${p.date}" data-start="${p.start}" aria-label="${esc(t('remove'))}">✕</button>` : ''}</li>`).join('')}</ul>`).join('')}
    <p class="hint">${esc(t('propsHint'))}</p></div>`;
}
// A proposal tapped: its day in the Planner, and it flashes there.
export function goToProposal(fk, date) {
  ui.flash = fk; ui.view = 'day'; ui.scrolledFor = null;
  const h = `#/plan/${date}`;
  if (location.hash !== h) location.hash = h; else render();
  setTimeout(() => { document.querySelector(`.plan-main [data-fk="${fk}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150);
  setTimeout(() => { if (ui.flash === fk) { ui.flash = null; render(); } }, 3600);
}
// ---------- (v69) the Routine shelf: every routine, staying after a drop, with its count for the period on screen
// (the Planner's month in the month view, otherwise the week of the day shown).
function shelfPeriod() {
  const d = currentDate(); const v = currentView();
  if (v === 'month') { const from = `${d.slice(0, 7)}-01`; const to = addDays(`${d.slice(0, 7)}-01`, new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate() - 1); return { from, to, label: t('periodMonth', new Date(`${from}T12:00`).toLocaleDateString(getLang(), { month: 'long' })), month: true }; }
  const from = addDays(d, -((new Date(`${d}T12:00`).getDay() + 6) % 7));
  return { from, to: addDays(from, 6), label: t('periodWeek'), month: false };
}
function shelfCount(x, p) {
  const bl = live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && !b.stepId && b.date >= p.from && b.date <= p.to && b.outcome !== 'failed');
  const doneN = bl.filter((b) => outcomeOf(b) === 'done').length;
  let target = null;
  if (x.repeat === 'times') target = (Number(x.timesN) || 1) * ((x.timesPer || 'week') === 'week' ? (p.month ? Math.round(((new Date(`${p.to}T12:00`) - new Date(`${p.from}T12:00`)) / 864e5 + 1) / 7) : 1) : 1);
  else if (x.repeat) target = occurrences(x, p.from, p.to).length;
  return { n: bl.length, doneN, target };
}
function shelfRow(x, p) {
  const c = shelfCount(x, p);
  const bits = [fmtDur(x.minutes || 30), x.repeat === 'times' ? t('timesShort', x.timesN || 3, t(`per_${x.timesPer || 'week'}`)) : x.repeat ? repeatText(x) : t('wm_anytime')];
  const soon = x.repeatUntil && x.repeatUntil <= addDays(today(), 7);
  const end = x.repeatCount ? t('turnsOf', countedOf(x), x.repeatCount) : x.repeatUntil ? (soon ? t('endsSoon', relDay(x.repeatUntil)) : t('endsOn', relDay(x.repeatUntil))) : '';
  const barHtml = c.target ? `<span class="tly">${Array.from({ length: Math.min(c.target, 14) }, (_, i) => `<i class="${i < c.doneN ? 'done' : i < c.n ? 'pl' : ''}"></i>`).join('')}</span><span class="tly-n">${esc(t('countOf', c.n, c.target, p.label))}</span>`
    : `<span class="tly-n">${esc(t('countN', c.n, p.label))}</span>`;
  return `<li class="fd-row${ui.pick === x.id ? ' on' : ''}" draggable="true" data-drag="rout:${esc(x.id)}" data-min="${x.minutes || 30}">${bar(x)}<div class="fd-c">
    <button type="button" class="fd-t" data-action="fd-pick" data-id="${esc(x.id)}">↻ ${esc(x.title)}<small>${esc(bits.join(' · '))}</small>${end ? `<small class="${soon ? 'warn-text' : ''}">${esc(end)}</small>` : ''}</button>
    <div class="tly-row">${barHtml}</div></div><span class="fd-grip" aria-hidden="true">⠿</span></li>`;
}
function shelfRows() {
  const p = shelfPeriod();
  const all = routines().filter((x) => !x.archived && !isMealTask(x)).sort((a, b) => a.title.localeCompare(b.title));
  const rh = all.filter((x) => hasRhythm(x)); const any = all.filter((x) => !hasRhythm(x));
  const ended = endedRoutines().sort((a, b) => (b.repeatUntil || '').localeCompare(a.repeatUntil || ''));
  return `<p class="hint">${esc(t(isWide() ? 'shelfHint' : 'shelfHintTap', p.month ? t('shelfMonth') : t('shelfWeek')))}</p>
    <div class="tly-legend"><span><i class="done"></i>${esc(t('lgDone'))}</span><span><i class="pl"></i>${esc(t('lgPlan'))}</span><span><i></i>${esc(t('lgMiss'))}</span></div>
    ${rh.length ? `<div class="fd-day">${esc(t('grpRhythm'))}</div><ul class="fd-list">${rh.map((x) => shelfRow(x, p)).join('')}</ul>` : ''}
    ${any.length ? `<div class="fd-day">${esc(t('wm_anytime'))}</div><ul class="fd-list">${any.map((x) => shelfRow(x, p)).join('')}</ul>` : ''}
    ${!all.length ? `<p class="hint fd-empty">${esc(t('noSaved'))}</p>` : ''}
    ${ended.length ? `<div class="fd-day fd-ended-h">${esc(t('grpEnded'))} <small>${ended.length}</small><button type="button" class="linkish" data-action="fd-ended">${esc(ui.fdEnded ? t('hideBtn') : t('showBtn'))}</button></div>
      ${ui.fdEnded ? `<ul class="fd-list">${ended.map((x) => `<li class="fd-row ended">${bar(x)}<div class="fd-c"><span class="fd-t as-text">↻ ${esc(x.title)}<small>${esc(x.repeatUntil && (!x.repeatCount || countedOf(x) < x.repeatCount) ? t('endedInfo', relDay(x.repeatUntil), countedOf(x)) : t('endedN', countedOf(x)))}</small></span></div><button type="button" class="btn small" data-action="rt-resume" data-id="${esc(x.id)}">${esc(t('resumeBtn'))}</button></li>`).join('')}</ul>` : ''}` : ''}`;
}
// "Riprendi": the same rhythm again from next Monday, with no end.
export function resumeRoutine(id) {
  const x = get('tasks', id); if (!x) return;
  const td = today(); const mon = addDays(td, 7 - ((new Date(`${td}T12:00`).getDay() + 6) % 7));
  const nu = upsert('tasks', { ...x, repeatUntil: null, repeatCount: null, seriesFrom: mon, due: mon, skipped: [] });
  ensureSeries(nu);
  toast(t('resumed', relDay(mon)));
  render();
}
const classicUi = () => { try { return localStorage.getItem('everyday-classic') === '1'; } catch { return false; } };
export function finderHtml({ props = false } = {}) {
  const q = (ui.fdQ || '').trim();
  const nTodo = isWide() && route().name === 'plan' ? (() => { const q2 = scopedTodo(); return q2.here.length + q2.turns.length; })() : trayTasks().length + routineTurns().length; // (v98) in the pane: the period on screen
  // (v82) nothing left to plan: no Da pianificare tab; the panel opens on the next one
  const tab0 = ui.fdTab || 'todo';
  const hideTodo = !nTodo && !trayTasks().length && !(ui.assign?.ghosts || []).length && !classicUi();
  const tab = tab0 === 'todo' && hideTodo ? 'rout' : tab0;
  const items = findItems();
  let body;
  if (q) {
    const hits = items.filter((x) => matchesQ(taskHay(x), q));
    body = hits.length ? `<div class="fd-day">${esc(t('findN', hits.length))}</div><ul class="fd-list">${hits.map(itemRow).join('')}</ul>` : `<p class="hint fd-empty">${esc(t('findNone', q))}</p>`;
  } else if (tab === 'plan') body = planRows();
  else if (tab === 'rout') body = shelfRows();
  else if (tab === 'all') body = `<ul class="fd-list">${items.sort((a, b) => a.title.localeCompare(b.title)).map(itemRow).join('')}</ul>`;
  else body = todoRows();
  const nPlan = new Set(live('blocks').filter((b) => b.taskId && !outcomeOf(b) && b.date >= today() && b.date <= addDays(today(), 13) && b.kind !== 'prep').map((b) => b.taskId)).size;
  const tabs = [...(hideTodo ? [] : [['todo', 'pnTabTodo', nTodo]]), ['rout', 'pnTabRout', routines().filter((x) => !x.archived && !isMealTask(x)).length], ['plan', 'pnTabPlan', nPlan], ['all', 'pnTabAll', items.length]];
  const pv = props ? proposalsHtml() : '';
  return `<div class="fd">
    ${searchBox({ id: 'fd-q', value: ui.fdQ || '', ph: t('findPh') })}
    ${pv && !q ? `${pv}<div class="fd-sep"></div>` : ''}
    ${q ? '' : `<div class="seg fd-tabs" role="tablist">${tabs.map(([k, l, n]) => `<button type="button" role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-action="fd-tab" data-id="${k}">${esc(t(l))} <small>${n}</small></button>`).join('')}</div>`}
    <div class="fd-body">${body}</div>
  </div>`;
}
// A slot tapped: its day in the Planner, scrolled to the block, which flashes for a moment.
export function goToBlock(id) {
  const b = get('blocks', id); if (!b) return;
  ui.flash = id; ui.view = 'day'; ui.scrolledFor = null; ui.mpSelNext = id; // (v105) the map selects it
  const h = `#/plan/${b.date}`;
  if (location.hash !== h) location.hash = h; else render();
  setTimeout(() => { document.querySelector(`.plan-main [data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150);
  setTimeout(() => { if (ui.flash === id) { ui.flash = null; render(); } }, 3600);
}

// ---------- (v67) the phone's Pianifica: a smart suggestion, or Scelgo io ----------
const weekEndOf = (d) => addDays(d, 6 - ((new Date(`${d}T12:00`).getDay() + 6) % 7));
const toPlanN = () => trayTasks().length + toFix(today(), weekEndOf(today())).length;
export function openChooser() {
  const n = toPlanN();
  openModal(`<h2>${esc(t('planChoose'))}</h2><p class="hint">${esc(n ? t('agToPlan', n) : `✓ ${t('agAllPlanned')}`)}</p>
    <div class="choose">
      <button class="btn primary choose-opt" value="smart" ${n ? '' : 'disabled'}><b>✦ ${esc(t('smartTitle'))}</b><small>${esc(t('smartSub', n))}</small></button>
      <button class="btn choose-opt" value="mine"><b>${esc(t('mineTitle'))}</b><small>${esc(t('mineSub'))}</small></button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('close'))}</button></div>`, (form, action, e) => {
    if (action === 'smart') { setTimeout(() => agendaPlan(), 0); return; }
    if (action === 'mine') { e.preventDefault(); openMine(); }
  }, { cls: 'sheet choose-sheet' });
}
// Scelgo io: the search and the three tabs, in a sheet. Picking a task closes it; its free time lights up.
export function openMine() {
  openModal(`<h2>${esc(t('mineTitle'))}</h2>${finderHtml()}<div class="button-row"><button class="btn ghost" value="cancel">${esc(t('close'))}</button></div>`, () => {}, { cls: 'sheet full fd-sheet' });
  modal.querySelector('form').addEventListener('input', (e) => { if (e.target.id === 'fd-q') { ui.fdQ = e.target.value; redrawMine(); } });
}
function redrawMine() {
  const box = modal.querySelector('.fd'); if (!box) return;
  const q = modal.querySelector('#fd-q'); const had = document.activeElement === q; const pos = q?.selectionStart ?? null;
  box.outerHTML = finderHtml();
  const n = modal.querySelector('#fd-q');
  if (had && n) { n.focus(); if (pos != null) n.setSelectionRange(pos, pos); }
}
// Elenco: the proposals by day; a row goes to its day.
export function openPropsList() {
  const n = (ui.assign?.ghosts || []).length + fixProps().length;
  if (!n) { modal.close(); render(); return; }
  openModal(`<h2>✦ ${esc(t('propsH'))}</h2>${proposalsHtml({ buttons: false })}
    <div class="button-row"><button class="btn" value="ag-cancel" formnovalidate>${esc(t('cancel'))}</button><button class="btn primary" value="ag-add">${esc(t('addN', n))}</button></div>`, (form, action) => {
    if (action === 'ag-add') agendaAdd();
    if (action === 'ag-cancel') { ui.assign.ghosts = []; ui.assign.fix = null; render(); }
  }, { cls: 'sheet pv-sheet' });
}
// Taps inside those sheets (they live in the dialog, not in the view).
export function sheetClick(btn) {
  const { action, id } = btn.dataset;
  const close = () => { modal.close(); };
  switch (action) {
    case 'fd-tab': ui.fdTab = id; redrawMine(); return true;
    case 'fd-fold': ui.fdFold = { ...(ui.fdFold || {}), [id]: !ui.fdFold?.[id] }; render(); return true;
    case 'fd-pick': ui.pick = id; ui.pickOcc = btn.dataset.occ || null; ui.pickBlock = null; ui.view = 'day'; close(); render(); return true;
    case 'fd-go': close(); goToBlock(id); return true;
    case 'pv-go': close(); goToProposal(id, btn.dataset.date); return true;
    case 'ghost-rm': ui.assign?.ghosts.splice(Number(btn.dataset.i), 1); render(); openPropsList(); return true;
    case 'pv-fix-x': keepFix(id, btn.dataset.date, Number(btn.dataset.start), false); openPropsList(); return true; // (v81) a routine's turn too
    case 'fd-move': { const b = get('blocks', id); const x = b && get('tasks', b.taskId); if (x) openWeekGrid(x, { block: b, onClose: () => { close(); render(); } }); return true; }
    case 'fd-when': { const x = get('tasks', id); if (x) openWeekGrid(x, { onClose: (how, k) => { if (how === 'quick') setWhen(get('tasks', id), k); close(); render(); } }); return true; }
    case 'task-edit': { const x = get('tasks', id); if (x) openTask(x); return true; }
    case 'fd-ended': ui.fdEnded = !ui.fdEnded; redrawMine(); return true;
    case 'rt-resume': resumeRoutine(id); redrawMine(); return true;
    // a routine turn's free time, another time, or skip it this week
    case 'fix-occ': { const x = get('tasks', id); if (x) { const b = fixOcc(x, btn.dataset.date, Number(btn.dataset.start)); toast(t('plannedToast', relDay(b.date), fmtTime(b.start + leadOf(x)))); render(); redrawMine(); } return true; }
    case 'fix-times': { const x = get('tasks', id); if (x) { fixTimes(x, { taskId: id, date: btn.dataset.date, start: Number(btn.dataset.start), minutes: Number(btn.dataset.minutes) }); render(); redrawMine(); } return true; }
    case 'occ-skip': { const x = get('tasks', id); if (x) { skipOcc(x, btn.dataset.date); toast(t('skippedOcc', relDay(btn.dataset.date))); render(); redrawMine(); } return true; }
    case 'occ-more': { const x = get('tasks', id); if (x) openPickSheet(x, btn.dataset.date); return true; }
    default: return false;
  }
}
