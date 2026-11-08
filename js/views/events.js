// views/events.js: moved from app.js (v36). See app.js for how the modules fit together.
import { catColor, esc, fmtDay, hint, range, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { anchorOffset, eventDate, eventReadiness, eventStart, outcomeOf, ownEvents, readinessText, seriesBlocks } from '../model.js';
import { fmtTime, parseDate, today } from '../plan.js';
import { fold, matchesQ } from '../shoplist.js';
import { get, live, state } from '../store.js';
import { ownMinutes } from '../travel-plan.js';
import { openModal, repeatText, searchBox } from '../widgets.js';
import { addDays, fmtDur } from '../plan.js';
import { eventTasksOf, plannedTaskIds } from '../model.js';
import { placeGhosts } from '../planning.js';
import { render } from '../shell.js';
import { classic } from './impegni.js';
import { ghostTitle } from './planner.js';

// ---------- Events: the second tab ----------
// Things with a fixed date — yours and the ones imported from Google Calendar — nearest first, with
// how ready each one is (the tasks attached to it). Past events fold away at the bottom.
export function eventItems() {
  const own = ownEvents().map((x) => ({ id: x.id, own: true, title: x.title, date: eventDate(x), start: eventStart(x), minutes: ownMinutes(x), allDay: Boolean(x.allDay), place: x.place || '', category: x.category, repeat: x.repeat, done: Boolean(x.done), task: x }));
  // A recurring event shows once per coming occurrence.
  const occ = [];
  const td = today();
  for (const e of own) {
    const ds = !e.task.repeat && (e.task.dates || []).length > 1 ? [...e.task.dates].sort() : null;
    if (ds) { // (v118) one appointment on several days: one row, at the next of its days, with all of them under it
      const nx = ds.find((d) => d >= td) || ds[ds.length - 1];
      const st = e.allDay ? null : e.task.datesTimes?.[nx]?.s ?? e.start;
      occ.push({ ...e, date: nx, start: st, minutes: e.task.datesTimes?.[nx]?.m || e.minutes, dates: ds });
      continue;
    }
    if (!e.task.repeat || e.allDay) { occ.push(e); continue; }
    const blocks = seriesBlocks(e.id).filter((b) => b.date >= today()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    if (!blocks.length) occ.push(e);
    for (const b of blocks) occ.push({ ...e, date: b.date, start: b.start + anchorOffset(b), blockId: b.id, done: Boolean(outcomeOf(b)) });
  }
  const imported = state.settings.showEvents === false ? [] : live('events').map((e) => ({ id: e.id, own: false, title: e.title, date: e.date, start: e.allDay ? null : e.start, minutes: e.minutes || 0, allDay: Boolean(e.allDay), place: e.location || '', color: e.color, calendar: e.calendar, event: e }));
  return [...occ, ...imported].filter((e) => e.date).sort((a, b) => (a.date === b.date ? (a.start ?? -1) - (b.start ?? -1) : a.date < b.date ? -1 : 1));
}
// (v118) the days of an appointment on several days, the past ones struck through, the next one lit
const daysChips = (e, td) => (e.dates ? `<span class="ev-days">${e.dates.map((d) => `<i class="${d < td ? 'past' : d === e.date ? 'nx' : ''}">${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</i>`).join('')}</span>` : '');
export function viewEvents() {
  if (!classic()) return viewEvents2();
  const td = today();
  const q = (ui.eventQ || '').trim();
  const hit = (e) => !q || matchesQ(fold([e.title, e.place, e.calendar || ''].join(' ')), q);
  const all = eventItems().filter(hit);
  const upcoming = all.filter((e) => e.date >= td);
  const past = all.filter((e) => e.date < td).reverse().slice(0, 30);
  const monthOf = (d) => fmtDay(d, { month: 'long', year: parseDate(d).getFullYear() !== parseDate(td).getFullYear() ? 'numeric' : undefined });
  const row = (e) => {
    const ready = readinessText(e.id);
    const r = ready ? eventReadiness(e.id) : null;
    const when = e.allDay ? t('allDay') : e.start != null ? (e.minutes ? range(e.start, e.minutes) : fmtTime(e.start)) : t('timeTbd');
    const bits = [fmtDay(e.date, { weekday: 'short' }), e.dates ? t('plNDays', e.dates.length) : '', when, e.place ? `📍 ${e.place}` : '', e.own && e.repeat ? `↻ ${repeatText(e.task)}` : '', !e.own ? e.calendar : ''].filter(Boolean);
    const color = e.own ? catColor(e.category) || 'var(--accent)' : e.color || '#6b7280';
    return `<li class="ev-row${e.own ? '' : ' imported'}${e.date === td ? ' is-today' : ''}${e.done ? ' done' : ''}" style="--c:${esc(color)}">
      <button class="ev-main" type="button" data-action="event-open" data-id="${esc(e.id)}">
        <span class="ev-date"><b>${parseDate(e.date).getDate()}</b><small>${esc(fmtDay(e.date, { month: 'short' }))}</small></span>
        <span class="item-text">${esc(e.title)}<small>${esc(bits.join(' · '))}</small>${daysChips(e, td)}${ready ? `<small class="ev-ready${r && !r.open ? ' ok' : r && r.late ? ' late' : ''}">${esc(ready)}</small>` : ''}</span>
      </button>
    </li>`;
  };
  const groups = [];
  for (const e of upcoming) {
    const k = e.date.slice(0, 7);
    if (!groups.length || groups[groups.length - 1][0] !== k) groups.push([k, monthOf(e.date), []]);
    groups[groups.length - 1][2].push(e);
  }
  return `
  <form id="event-add" class="row">
    <input id="event-input" name="title" autocomplete="off" placeholder="${esc(t('addEventPh'))}">
    <button class="btn primary">${esc(t('add'))}</button>
  </form>
  ${hint('eventQuickHint')}
  <div class="task-tools">${searchBox({ id: 'event-q', value: ui.eventQ || '', ph: t('searchEvents') })}</div>
  ${upcoming.length ? groups.map(([k, label, list]) => `<section class="ev-month"><h2 class="part-h">${esc(label)} <small>${list.length}</small></h2><ul class="list events">${list.map(row).join('')}</ul></section>`).join('')
    : `<p class="empty">${esc(q ? t('noMatch') : t('noEvents'))}</p>`}
  ${past.length ? `<details class="ev-past"><summary>${esc(t('pastEvents'))} <small>${past.length}</small></summary><ul class="list events">${past.map(row).join('')}</ul></details>` : ''}`;
}

// ---------- (v55) Events as an agenda ----------
// The date on the left, one card per event with how ready it is, and the empty stretches between them.
// One card on top: the events still to prepare; "Prepare" proposes days for their tasks (dashed) until
// you Add or Cancel. Adding is the + button (it reads "Theatre 14 Dec 20:30 @Piccolo").
const EV_F = ['own', 'cal', 'prep'];
const evF = () => ui.evF || [];
function evPasses(e) {
  const f = evF();
  if (f.includes('own') && !f.includes('cal') && !e.own) return false;
  if (f.includes('cal') && !f.includes('own') && e.own) return false;
  if (f.includes('prep') && !(e.own && eventReadiness(e.id).open)) return false;
  return true;
}
function toPrepare(list) {
  const planned = plannedTaskIds();
  return list.filter((e) => e.own).map((e) => ({ e, open: eventTasksOf(e.id).filter((x) => !x.done && !planned.has(x.id) && x.eventOffset?.when !== 'after') })).filter((r) => r.open.length);
}
export function prepareEvents() {
  const td = today();
  const rows = toPrepare(eventItems().filter((e) => e.date >= td));
  if (!rows.length) return;
  const last = rows.reduce((m, r) => (r.e.date > m ? r.e.date : m), td);
  const days = []; for (let d = td; d <= last; d = addDays(d, 1)) days.push(d);
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  ui.assign.ghosts = [];
  placeGhosts([...new Set(rows.flatMap((r) => r.open.map((x) => x.id)))], days);
  ui.assign.evPrep = true;
  render();
}
export function openEventFilters() {
  const f = evF();
  openModal(`<h2>⇅ ${esc(t('filters'))}</h2><div class="filters">${EV_F.map((k) => `<button class="fchip${f.includes(k) ? ' on' : ''}" value="${k}" aria-pressed="${f.includes(k)}">${esc(t(`vf_ev_${k}`))}</button>`).join('')}</div>
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('vwShow'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    ui.evF = f.includes(action) ? f.filter((k) => k !== action) : [...f, action];
    render(); openEventFilters();
  }, { cls: 'sheet' });
}
function viewEvents2() {
  const td = today();
  const q = (ui.eventQ || '').trim();
  const hit = (e) => (!q || matchesQ(fold([e.title, e.place, e.calendar || ''].join(' ')), q)) && evPasses(e);
  const all = eventItems();
  const upcoming = all.filter((e) => e.date >= td && hit(e));
  const past = all.filter((e) => e.date < td && hit(e)).reverse().slice(0, 30);
  const ghosts = ui.assign?.evPrep ? (ui.assign.ghosts || []) : [];
  const ghostsFor = (id) => ghosts.map((g, i) => ({ ...g, i })).filter((g) => get('tasks', g.taskId)?.eventId === id);
  const prep = toPrepare(all.filter((e) => e.date >= td));
  const things = prep.reduce((n, r) => n + r.open.length, 0);
  const top = ghosts.length
    ? `<div class="ag-card-top on"><b>✦ ${esc(t('agProposals', ghosts.length))}</b><button class="btn small" type="button" data-action="ev-prep-cancel">${esc(t('cancel'))}</button><button class="btn small primary" type="button" data-action="ev-prep-add">${esc(t('add'))}</button></div>`
    : prep.length ? `<div class="ag-card-top"><span><b>${esc(t('evToPrep', prep.length))}</b> · ${esc(t('evThings', things))}</span><button class="btn small primary" type="button" data-action="ev-prep">✦ ${esc(t('evPrepare'))}</button></div>` : '';
  const card = (e) => {
    const r = e.own ? eventReadiness(e.id) : null;
    const when = e.allDay ? t('allDay') : e.start != null ? (e.minutes ? range(e.start, e.minutes) : fmtTime(e.start)) : t('timeTbd');
    const bits = [e.dates ? t('plNDays', e.dates.length) : '', when, e.place ? `📍 ${e.place}` : '', e.own && e.repeat ? `↻ ${repeatText(e.task)}` : '', !e.own ? e.calendar : ''].filter(Boolean);
    const color = e.own ? catColor(e.category) || 'var(--accent)' : e.color || '#6b7280';
    const pct = r?.total ? Math.round(((r.total - r.open) / r.total) * 100) : 0;
    const gs = ghostsFor(e.id);
    return `<li class="ev2${e.date === td ? ' is-today' : ''}${e.done ? ' done' : ''}${e.own ? '' : ' imported'}" style="--c:${esc(color)}">
      <span class="ev2-date"><small>${esc(fmtDay(e.date, { weekday: 'short' }))}</small><b>${parseDate(e.date).getDate()}</b><small>${esc(fmtDay(e.date, { month: 'short' }))}</small></span>
      <span class="ev2-col"><button class="ev2-card" type="button" data-action="event-open" data-id="${esc(e.id)}"><span class="ag-t">${esc(e.title)}</span><small>${esc(bits.join(' · '))}</small>${daysChips(e, td)}
        ${r?.total ? `<span class="ev2-ready${!r.open ? ' ok' : r.late ? ' late' : ''}"><i style="width:${pct}%"></i></span><small class="ev2-rt">${esc(readinessText(e.id))}</small>` : ''}</button>
        ${gs.map((g) => `<span class="ev2-ghost">→ ${esc(relDay(g.date))} ${esc(fmtTime(g.start))} · ${esc(ghostTitle(g))} <small>${esc(fmtDur(g.minutes || 30))}</small><button class="icon" type="button" data-action="ghost-rm" data-i="${g.i}" aria-label="${esc(t('remove'))}">✕</button></span>`).join('')}</span></li>`;
  };
  const rows = []; let prev = td;
  for (const e of upcoming) {
    const gapDays = Math.round((parseDate(e.date) - parseDate(prev)) / 864e5);
    if (!q && gapDays >= 14) rows.push(`<li class="ev2-gap"><button type="button" data-action="ev-new"><span>${esc(t('evNothingFor', Math.floor(gapDays / 7)))}</span><u>${esc(t('evAddOne'))}</u></button></li>`);
    rows.push(card(e)); prev = e.date;
  }
  const n = evF().length;
  return `${top}
  <div class="task-tools">${searchBox({ id: 'event-q', value: ui.eventQ || '', ph: t('searchEvents') })}<button class="btn small tools-btn${n ? ' on' : ''}" type="button" data-action="ev-filters">⇅ ${esc(t('filters'))}${n ? ` · ${n}` : ''}</button></div>
  ${upcoming.length ? `<ul class="ev2-list">${rows.join('')}</ul>` : `<p class="empty">${esc(q || n ? t('noMatch') : t('noEvents'))}</p>`}
  ${past.length ? `<details class="ev-past"><summary>${esc(t('pastEvents'))} <small>${past.length}</small></summary><ul class="ev2-list past">${past.map(card).join('')}</ul></details>` : ''}`;
}
