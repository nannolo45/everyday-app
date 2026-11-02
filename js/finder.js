// finder.js (v66): the Planner's list of tasks, in the wide pane and on the phone: Da pianificare · Nel
// piano · Tutte, and a search over all of them. A task shows where it is on the plan as pills; a pill
// jumps there and the block flashes. "Sposta…" opens the week grid for that one block.
import { catColor, catName, catsOf, esc, relDay, ui } from './core.js';
import { t } from './i18n.js';
import { isEvent } from './kinds.js';
import { outcomeOf } from './model.js';
import { addDays, fmtDur, fmtTime, isoDay, today } from './plan.js';
import { trayTasks } from './planning.js';
import { matchesQ } from './shoplist.js';
import { get, live } from './store.js';
import { render } from './shell.js';
import { agendaAdd, agendaPlan, fixProps, ghostTitle, ghostWhy } from './views/planner.js';
import { modal } from './core.js';
import { openTask } from './editors.js';
import { setWhen } from './views/impegni.js';
import { openWeekGrid } from './weekgrid.js';
import { toFix } from './weekpick.js';
import { allItems, typeOf } from './views/impegni.js';
import { taskHay } from './views/tasks.js';
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
// Da pianificare: pick one and the free time it fits in lights up (the pane's old list).
function todoRows() {
  const list = trayTasks();
  if (!list.length) return `<p class="hint fd-empty">${esc((ui.assign?.ghosts || []).length ? `✦ ${t('propsAllUp')}` : `✓ ${t('agAllPlanned')}`)}</p>`;
  const pick = ui.pick && get('tasks', ui.pick);
  return `<p class="hint">${esc(pick ? t('pnPicked', pick.title) : t('pnPick'))}</p><ul class="fd-list">${list.map((x) => `<li class="fd-row${ui.pick === x.id ? ' on' : ''}">${bar(x)}<div class="fd-c">
    <button type="button" class="fd-t" data-action="fd-pick" data-id="${esc(x.id)}" aria-pressed="${ui.pick === x.id}">${esc(x.title)}<small>${esc([x.lenSet === false ? '' : fmtDur(x.minutes || 30), x.due ? relDay(x.due) : '', ...catsOf(x).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · '))}</small></button>
    <div class="fd-pills"><button type="button" class="fd-pill act" data-action="fd-when" data-id="${esc(x.id)}">${esc(t('whenChip'))}</button></div></div></li>`).join('')}</ul>`;
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
  const fixes = fixProps().map((f) => ({ fk: `f${f.taskId}~${f.date}`, date: f.date, start: f.start, minutes: f.minutes, title: f.title, why: t('agToFix', 1), task: get('tasks', f.taskId) }));
  const all = [...ghosts, ...fixes].sort(byWhen);
  if (!all.length) return '';
  const days = new Map();
  for (const p of all) { if (!days.has(p.date)) days.set(p.date, []); days.get(p.date).push(p); }
  return `<div class="pv">${buttons ? `<div class="pv-h"><b>✦ ${esc(t('propsH'))} <small>${all.length}</small></b><button type="button" class="btn small" data-action="ag-cancel">${esc(t('cancel'))}</button><button type="button" class="btn small primary" data-action="ag-add">${esc(t('add'))}</button></div>` : ''}
    ${[...days].map(([d, ps]) => `<div class="fd-day">${esc(dayLabel(d))}</div><ul class="fd-list">${ps.map((p) => `<li class="fd-row pv-row">${bar(p.task)}<div class="fd-c"><button type="button" class="fd-t" data-action="pv-go" data-id="${esc(p.fk)}" data-date="${p.date}">${esc(p.title)}<small>${esc(`${fmtTime(p.start)}–${fmtTime(p.start + p.minutes)}`)}</small>${p.why ? `<span class="pv-why">✦ ${esc(p.why)}</span>` : ''}</button></div>${p.i != null ? `<button type="button" class="icon pv-x" data-action="ghost-rm" data-i="${p.i}" aria-label="${esc(t('remove'))}">✕</button>` : ''}</li>`).join('')}</ul>`).join('')}
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
export function finderHtml({ props = false } = {}) {
  const q = (ui.fdQ || '').trim();
  const tab = ui.fdTab || 'todo';
  const items = findItems();
  let body;
  if (q) {
    const hits = items.filter((x) => matchesQ(taskHay(x), q));
    body = hits.length ? `<div class="fd-day">${esc(t('findN', hits.length))}</div><ul class="fd-list">${hits.map(itemRow).join('')}</ul>` : `<p class="hint fd-empty">${esc(t('findNone', q))}</p>`;
  } else if (tab === 'plan') body = planRows();
  else if (tab === 'all') body = `<ul class="fd-list">${items.sort((a, b) => a.title.localeCompare(b.title)).map(itemRow).join('')}</ul>`;
  else body = todoRows();
  const nTodo = trayTasks().length;
  const nPlan = new Set(live('blocks').filter((b) => b.taskId && !outcomeOf(b) && b.date >= today() && b.date <= addDays(today(), 13) && b.kind !== 'prep').map((b) => b.taskId)).size;
  const tabs = [['todo', 'pnTabTodo', nTodo], ['plan', 'pnTabPlan', nPlan], ['all', 'pnTabAll', items.length]];
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
  ui.flash = id; ui.view = 'day'; ui.scrolledFor = null;
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
    case 'fd-pick': ui.pick = id; ui.view = 'day'; close(); render(); return true;
    case 'fd-go': close(); goToBlock(id); return true;
    case 'pv-go': close(); goToProposal(id, btn.dataset.date); return true;
    case 'ghost-rm': ui.assign?.ghosts.splice(Number(btn.dataset.i), 1); render(); openPropsList(); return true;
    case 'fd-move': { const b = get('blocks', id); const x = b && get('tasks', b.taskId); if (x) openWeekGrid(x, { block: b, onClose: () => { close(); render(); } }); return true; }
    case 'fd-when': { const x = get('tasks', id); if (x) openWeekGrid(x, { onClose: (how, k) => { if (how === 'quick') setWhen(get('tasks', id), k); close(); render(); } }); return true; }
    case 'task-edit': { const x = get('tasks', id); if (x) openTask(x); return true; }
    default: return false;
  }
}
