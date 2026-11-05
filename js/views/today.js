// views/today.js: moved from app.js (v36). See app.js for how the modules fit together.
import { runningBlock } from '../timer.js';
import { isPalestra } from '../palestra.js';
import { catColor, esc, fmtDay, planSettings, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isEvent } from '../kinds.js';
import { blocksOn, isApptLike, eventsOn, ISSUE_SEC, issueText, legTimes, openTasks, outcomeOf, plannedTaskIds, readinessText, taskIssues, timedEventsOn } from '../model.js';
import { addDays, dayTotals, fmtDur, fmtTime, importanceOf, nowMinutes, today } from '../plan.js';
import { morningReflow } from '../planning.js';
import { get, state } from '../store.js';
import { dayCount, giornataHtml, nextPrepHtml, tomorrowHtml } from './giornata.js';
import { MODE_ICON } from '../travel.js';
import { behindCard, loadBar, prepareDays, weekStart } from './planner.js';
import { classic } from './impegni.js';

// ---------- Today: the home tab ----------
// "What do I do now?" first: the next move with its leave and start times. Then the day, what is
// pressing, and the week at a glance.
export function todayItems(date) {
  return [...blocksOn(date).filter((b) => b.kind !== 'prep' || !b.parentId), ...timedEventsOn(date)].sort((a, b) => a.start - b.start);
}
export function pressingTasks() {
  const td = today(); const soon = addDays(td, 3);
  const planned = plannedTaskIds();
  return openTasks().filter((x) => !planned.has(x.id) && !x.travelRole && (
    (x.due && x.due < td) || (x.due && x.due <= soon) || taskIssues(x).length))
    .sort((a, b) => {
      const ka = a.due && a.due < td ? 0 : a.due ? 1 : 2; const kb = b.due && b.due < td ? 0 : b.due ? 1 : 2;
      return ka - kb || (a.due || '').localeCompare(b.due || '') || importanceOf(b) - importanceOf(a);
    }).slice(0, 6);
}

const clock = (ms) => { const d = new Date(ms); return fmtTime(d.getHours() * 60 + d.getMinutes()); };
export function viewToday() {
  const td = today(); const now = nowMinutes();
  prepareDays([td]);
  morningReflow();
  const items = todayItems(td);
  const totals = dayTotals(blocksOn(td));
  const open = items.filter((b) => !b.isEvent && !outcomeOf(b));
  const upcoming = items.filter((b) => (b.isEvent && !b.skipped) || (!b.isEvent && !outcomeOf(b))); // blocks and appointments alike, in time order
  const current = upcoming.find((b) => b.start <= now && b.start + b.minutes > now);
  const next = upcoming.find((b) => b.start > now);
  // The card: your own block that is running, or one you must leave for within 15 minutes (even during
  // an appointment); else whatever is on now, else the next thing of the day.
  const run = runningBlock(); // a timer running: that's the card, whatever else overlaps
  const curBlock = (run && open.find((b) => b.id === run.id)) || open.find((b) => b.start <= now && b.start + b.minutes > now);
  const nextBlock = open.find((b) => b.start > now);
  const card = curBlock || (nextBlock && nextBlock.start - now <= 15 ? nextBlock : null) || current || next;
  const lg = card && !card.isEvent ? legTimes(card) : null;
  const task = card && !card.isEvent && card.taskId ? get('tasks', card.taskId) : null;
  const place = task?.place || '';
  let nowCard = '';
  if (card) {
    const started = card.start <= now;
    const inMin = card.start - now;
    const status = started ? t('untilTime', fmtTime(card.start + card.minutes)) : inMin <= 0 ? t('nowLabel') : lg && lg.trip > 0 ? t('leaveIn', fmtDur(inMin)) : t('startsIn', fmtDur(inMin));
    const legDone = lg && card.stepState?.[lg.step.id] === 'done';
    const main = card.isEvent ? '' : `<div class="now-actions">
        ${isPalestra(task) && !card.startedAt && !(lg && lg.trip > 0 && !legDone && now < lg.start) ? `<button class="btn primary" type="button" data-action="pal-start" data-id="${esc(card.id)}">▶ ${esc(t('palStart'))}</button>` : lg && lg.trip > 0 && !legDone && now < lg.start ? `<button class="btn primary" type="button" data-action="now-left" data-id="${esc(card.id)}" data-step="${esc(lg.step.id)}">${esc(t('leftNow'))}</button>` : `<button class="btn primary" type="button" data-action="now-done" data-id="${esc(card.id)}">${esc(t('markDone'))}</button>`}
        <button class="btn" type="button" data-action="now-move" data-id="${esc(card.id)}">${esc(t('move'))}</button>
        ${place ? `<a class="btn icon-btn" href="${esc(mapsHref(task))}" target="_blank" rel="noopener" aria-label="${esc(t('openMaps'))}">📍</a>` : ''}
      </div>`;
    nowCard = `<section class="now-card${started ? ' live' : ''}" aria-label="${esc(t('nextMove'))}">
      <div class="now-head"><span>${esc(started ? t('inProgress') : t('nextMove'))}</span><b class="${inMin <= 15 && !started ? 'soon' : ''}">${esc(status)}</b></div>
      <div class="now-main">
        ${lg && lg.trip > 0 ? `<div class="now-time"><b class="leave">${fmtTime(lg.leave)}</b><small>${esc(t('leaveWord'))}</small></div><span class="now-arrow" aria-hidden="true">→</span><div class="now-time"><b>${fmtTime(lg.start)}</b><small>${esc(t('startWord'))}</small></div>` : `<div class="now-time"><b>${fmtTime(card.start)}</b><small>${esc(t('startWord'))}</small></div>`}
        <div class="now-text"><div class="now-title">${isApptLike(task) ? '📅 ' : ''}${esc(card.title)}</div><small>${esc([place, lg && lg.trip > 0 ? `${MODE_ICON[lg.step.mode] || '🚌'} ${fmtDur(lg.trip)}` : '', t('untilTime', fmtTime(card.start + card.minutes)), isEvent(task) ? readinessText(task.id) : ''].filter(Boolean).join(' · '))}</small>${isPalestra(task) && state.meta.palestraSynced ? `<small class="pal-heard">🏋 ${esc(t('palHeard', clock(state.meta.palestraSynced)))}</small>` : ''}</div>
      </div>
      ${main}
    </section>`;
  } else nowCard = `<section class="now-card empty"><div class="now-head"><span>${esc(t('nextMove'))}</span></div><p>${esc(open.length || items.length ? t('dayDone') : t('nothingToday'))}</p><div class="now-actions"><a class="btn" href="#/plan">${esc(t('openPlanner'))}</a></div></section>`;
  const row = (b) => {
    const st = outcomeOf(b); const lgb = b.isEvent ? null : legTimes(b);
    const cls = b === card ? ' current' : st ? ` ${st}` : b.start + b.minutes <= now ? ' past' : '';
    const evb = !b.isEvent && b.taskId && isApptLike(get('tasks', b.taskId));
    const inner = `<span class="td-time${lgb && lgb.trip > 0 ? ' leave' : ''}">${fmtTime(b.start)}</span><span class="td-title">${evb ? '📅 ' : ''}${esc(b.title)}${lgb && lgb.trip > 0 ? ` <small>· ${esc(t('startWord'))} ${fmtTime(lgb.start)}</small>` : ''}${b.seriesId ? ' <span class="series-ico">↻</span>' : ''}</span><small class="td-meta">${esc(b.isEvent ? b.calendar || t('calendar') : st === 'done' ? t('doneLabel') : st === 'failed' ? t('couldnt') : fmtDur(b.minutes))}</small>`;
    return b.isEvent ? `<button class="td-row event${cls}${b.skipped ? ' skipped' : ''}" type="button" data-action="event" data-id="${esc(b.id)}" style="--c:${esc(b.color || '#6b7280')}">${inner}</button>`
      : `<button class="td-row${cls}" type="button" data-action="open-block" data-id="${esc(b.id)}" style="--c:${esc(catColor(b.category) || 'var(--accent)')}">${inner}</button>`;
  };
  const gap = next ? Math.floor((next.start - Math.max(now, current ? current.start + current.minutes : now)) / 5) * 5 : (now < planSettings().dayEnd ? planSettings().dayEnd - now : 0);
  const spareLine = `<button class="td-spare" type="button" data-action="spare">⏱ ${esc(!current && gap >= 15 ? (next ? t('freeUntil', fmtDur(Math.min(gap, 240)), fmtTime(next.start)) : t('freeNow', fmtDur(Math.min(gap, 240)))) : t('haveTime'))}</button>`;
  const pressing = pressingTasks();
  const pr = (x) => {
    const late = x.due && x.due < td; const iss = taskIssues(x);
    const why = late ? t('dueLate', relDay(x.due)) : x.due ? t('dueOn', relDay(x.due)) : issueText(x);
    return `<div class="pr-row"><span class="pr-dot ${late ? 'late' : x.due ? 'soon' : 'fix'}"></span><button class="pr-text" type="button" data-action="edit-task" data-id="${esc(x.id)}"><span>${esc(x.title)}</span><small>${esc([why, fmtDur(x.minutes || 30)].join(' · '))}</small></button>
      ${iss.length && !late ? `<button class="btn small" type="button" data-action="task-fix" data-id="${esc(x.id)}" data-sec="${ISSUE_SEC[iss[0]]}">${esc(t('fix'))}</button>` : `<button class="btn small primary-ghost" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${td}">${esc(t('today'))}</button>`}</div>`;
  };
  // (v91) Adesso | Giornata
  if (!classic()) {
    const mode = state.settings.todayMode === 'now' ? 'now' : 'day';
    const { n, d } = dayCount(td);
    const seg = `<div class="seg gi-seg" role="tablist"><button type="button" role="tab" class="${mode === 'now' ? 'on' : ''}" aria-selected="${mode === 'now'}" data-action="today-mode" data-id="now">${esc(t('todayNow'))}</button><button type="button" role="tab" class="${mode === 'day' ? 'on' : ''}" aria-selected="${mode === 'day'}" data-action="today-mode" data-id="day">${esc(t('todayDay'))}${n ? ` · ${d}/${n}` : ''}</button></div>`;
    const after = upcoming.filter((b) => b !== card && b.start > now).slice(0, 2);
    const rest = upcoming.some((b) => b.start + b.minutes > now);
    const body = mode === 'day' ? giornataHtml(td) : `${nowCard}${behindCard(td)}${nextPrepHtml(td)}${spareLine}
      ${after.length ? `<section class="card gi-sec open"><div class="gi-sh"><span>${esc(t('giPoi'))}</span></div><div class="gi-sb">${after.map((b) => `<button type="button" class="gi-row" data-action="${b.isEvent ? 'event' : 'open-block'}" data-id="${esc(b.id)}"><span class="gi-t">${fmtTime(b.start)}</span><span class="gi-c"><span class="gi-x"><b>${esc(b.title)}</b></span></span><span class="gi-r">${esc(fmtDur(b.minutes))}</span></button>`).join('')}</div></section>` : ''}
      ${rest ? '' : tomorrowHtml(td)}`;
    return `<div class="today">
      <div class="today-head"><h1>${esc(fmtDay(td))}</h1><small>${esc(totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned'))}${items.filter((b) => b.isEvent).length ? ` · ${esc(t('nEvents', items.filter((b) => b.isEvent).length))}` : ''}</small></div>
      ${eventsOn(td).filter((e) => e.allDay).length ? `<div class="today-allday">${eventsOn(td).filter((e) => e.allDay).map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">📅 ${esc(e.title)}</button>`).join('')}</div>` : ''}
      ${ui.reflow ? `<div class="reflow"><span>${esc(t('reflowMoved', ui.reflow.moved))}</span><button class="linkish" type="button" data-action="reflow-undo">${esc(t('undo'))}</button><button class="icon" type="button" data-action="reflow-ok" aria-label="${esc(t('close'))}">✕</button></div>` : ''}
      ${seg}${body}</div>`;
  }
  const ws = weekStart(td);
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  return `
  <div class="today">
    <div class="today-head"><h1>${esc(fmtDay(td))}</h1><small>${esc(totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned'))}${items.filter((b) => b.isEvent).length ? ` · ${esc(t('nEvents', items.filter((b) => b.isEvent).length))}` : ''}</small></div>
    ${eventsOn(td).filter((e) => e.allDay).length ? `<div class="today-allday">${eventsOn(td).filter((e) => e.allDay).map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">📅 ${esc(e.title)}</button>`).join('')}</div>` : ''}
    ${ui.reflow ? `<div class="reflow"><span>${esc(t('reflowMoved', ui.reflow.moved))}</span><button class="linkish" type="button" data-action="reflow-undo">${esc(t('undo'))}</button><button class="icon" type="button" data-action="reflow-ok" aria-label="${esc(t('close'))}">✕</button></div>` : ''}
    ${nowCard}
    <section class="today-list" aria-label="${esc(t('today'))}">
      ${items.length ? items.map(row).join('') : `<p class="empty">${esc(t('emptyDay'))}</p>`}
      ${spareLine}
    </section>
    ${pressing.length ? `<section class="pressing" aria-label="${esc(t('pressing'))}">
      <div class="sec-head"><h2>${esc(t('pressing'))}</h2><a href="#/tasks">${esc(t('allTasks'))} ›</a></div>
      ${pressing.map(pr).join('')}
    </section>` : ''}
    <section class="week-strip" aria-label="${esc(t('thisWeek'))}">
      ${week.map((d) => `<a href="#/plan/${d}" class="${d === td ? 'today' : ''}"><span>${esc(fmtDay(d, { weekday: 'short' }))}</span>${loadBar(d, { text: false })}</a>`).join('')}
    </section>
  </div>`;
}
export function mapsHref(task) {
  if (!task) return '#';
  if (task.link) return task.link;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.place || '')}`;
}
