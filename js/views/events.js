// views/events.js: moved from app.js (v36). See app.js for how the modules fit together.
import { catColor, esc, fmtDay, hint, range, ui } from '../core.js';
import { t } from '../i18n.js';
import { anchorOffset, eventDate, eventReadiness, eventStart, outcomeOf, ownEvents, readinessText, seriesBlocks } from '../model.js';
import { fmtTime, parseDate, today } from '../plan.js';
import { fold, matchesQ } from '../shoplist.js';
import { live, state } from '../store.js';
import { ownMinutes } from '../travel-plan.js';
import { repeatText, searchBox } from '../widgets.js';

// ---------- Events: the second tab ----------
// Things with a fixed date — yours and the ones imported from Google Calendar — nearest first, with
// how ready each one is (the tasks attached to it). Past events fold away at the bottom.
export function eventItems() {
  const own = ownEvents().map((x) => ({ id: x.id, own: true, title: x.title, date: eventDate(x), start: eventStart(x), minutes: ownMinutes(x), allDay: Boolean(x.allDay), place: x.place || '', category: x.category, repeat: x.repeat, done: Boolean(x.done), task: x }));
  // A recurring event shows once per coming occurrence.
  const occ = [];
  for (const e of own) {
    if (!e.task.repeat || e.allDay) { occ.push(e); continue; }
    const blocks = seriesBlocks(e.id).filter((b) => b.date >= today()).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 8);
    if (!blocks.length) occ.push(e);
    for (const b of blocks) occ.push({ ...e, date: b.date, start: b.start + anchorOffset(b), blockId: b.id, done: Boolean(outcomeOf(b)) });
  }
  const imported = state.settings.showEvents === false ? [] : live('events').map((e) => ({ id: e.id, own: false, title: e.title, date: e.date, start: e.allDay ? null : e.start, minutes: e.minutes || 0, allDay: Boolean(e.allDay), place: e.location || '', color: e.color, calendar: e.calendar, event: e }));
  return [...occ, ...imported].filter((e) => e.date).sort((a, b) => (a.date === b.date ? (a.start ?? -1) - (b.start ?? -1) : a.date < b.date ? -1 : 1));
}
export function viewEvents() {
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
    const bits = [fmtDay(e.date, { weekday: 'short' }), when, e.place ? `📍 ${e.place}` : '', e.own && e.repeat ? `↻ ${repeatText(e.task)}` : '', !e.own ? e.calendar : ''].filter(Boolean);
    const color = e.own ? catColor(e.category) || 'var(--accent)' : e.color || '#6b7280';
    return `<li class="ev-row${e.own ? '' : ' imported'}${e.date === td ? ' is-today' : ''}${e.done ? ' done' : ''}" style="--c:${esc(color)}">
      <button class="ev-main" type="button" data-action="event-open" data-id="${esc(e.id)}">
        <span class="ev-date"><b>${parseDate(e.date).getDate()}</b><small>${esc(fmtDay(e.date, { month: 'short' }))}</small></span>
        <span class="item-text">${esc(e.title)}<small>${esc(bits.join(' · '))}</small>${ready ? `<small class="ev-ready${r && !r.open ? ' ok' : r && r.late ? ' late' : ''}">${esc(ready)}</small>` : ''}</span>
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
