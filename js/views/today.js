// views/today.js: moved from app.js (v36). See app.js for how the modules fit together.
import { runningBlock } from '../timer.js';
import { isPalestra } from '../palestra.js';
import { catColor, esc, fmtDay, planSettings, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isEvent } from '../kinds.js';
import { blocksOn, roomy, isApptLike, eventsOn, ISSUE_SEC, issueText, legTimes, openTasks, outcomeOf, plannedTaskIds, readinessText, stepTimes, taskIssues, timedEventsOn } from '../model.js';
import { addDays, dayTotals, fmtDur, fmtTime, importanceOf, nowMinutes, today } from '../plan.js';
import { morningReflow } from '../planning.js';
import { get, state } from '../store.js';
import { blockDetail, dayCount, dayItems, giornataHtml, keyMoments, otherBlocks } from './giornata.js';
import { focusMiniHtml, planLabel } from '../focus.js';
import { stepName } from './planner.js';
import { MODE_ICON } from '../travel.js';
import { eveningMode, behindCard, loadBar, prepareDays, weekStart } from './planner.js';
import { classic } from './impegni.js';
import { recipeLink, recipesOf } from '../viewcard.js';

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
  const totals = dayTotals(blocksOn(td).filter((b) => !roomy(b)));
  const open = items.filter((b) => !b.isEvent && !outcomeOf(b));
  const upcoming = items.filter((b) => (b.isEvent && !b.skipped) || (!b.isEvent && !outcomeOf(b))); // blocks and appointments alike, in time order
  const current = upcoming.find((b) => b.start <= now && b.start + b.minutes > now);
  const next = upcoming.find((b) => b.start > now);
  // The card: your own block that is running, or one you must leave for within 15 minutes (even during
  // an appointment); else whatever is on now, else the next thing of the day.
  const run = runningBlock(); // a timer running: that's the card, whatever else overlaps
  const curBlock = (run && open.find((b) => b.id === run.id)) || open.find((b) => b.start <= now && b.start + b.minutes > now);
  const nextBlock = open.find((b) => b.start > now);
  const old = curBlock || (nextBlock && nextBlock.start - now <= 15 ? nextBlock : null) || current || next;
  // (v92) one page: the card is about what's next; what's running is a line on top of it
  const running = classic() ? null : curBlock || current;
  const card = running && next && next !== running ? next : old;
  const runLine = running && card !== running ? `<div class="now-run"><span class="now-dot" aria-hidden="true"></span><span><b>${esc(t('inProgress'))}:</b> ${esc(running.title)} · ${esc(t('untilTime', fmtTime(running.start + running.minutes)))}</span>${running.isEvent ? '' : `<button class="btn small ghost" type="button" data-action="now-done" data-id="${esc(running.id)}">${esc(t('markDone'))}</button>`}</div>` : '';
  // (v94) what's running shows its steps (the current one), its checklist to tick and its notes
  const liveB = classic() ? null : running && !running.isEvent ? running : card && !card.isEvent && card.start <= now ? card : null;
  const liveDetail = liveB && classic() ? blockDetail(liveB) : '';
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
        ${isPalestra(task) && !card.startedAt && !(lg && lg.trip > 0 && !legDone && now < lg.start) ? `<button class="btn primary" type="button" data-action="pal-start" data-id="${esc(card.id)}">▶ ${esc(t('palStart'))}</button>` : lg && lg.trip > 0 && !legDone && now < lg.start ? `<button class="btn primary" type="button" data-action="now-left" data-id="${esc(card.id)}" data-step="${esc(lg.step.id)}">${esc(t('leftNow'))}</button>` : (!started && !classic() ? `<button class="btn primary" type="button" data-action="now-start" data-id="${esc(card.id)}">▶ ${esc(t('startNow'))}</button>` : `<button class="btn primary" type="button" data-action="now-done" data-id="${esc(card.id)}">${esc(t('markDone'))}</button>`)}
        <button class="btn" type="button" data-action="now-move" data-id="${esc(card.id)}">${esc(t('move'))}</button>
        ${place ? `<a class="btn icon-btn" href="${esc(mapsHref(task))}" target="_blank" rel="noopener" aria-label="${esc(t('openMaps'))}">📍</a>` : ''}
      </div>`;
    nowCard = `<section class="now-card${started ? ' live' : ''}" aria-label="${esc(t('nextMove'))}">${runLine}${runLine && liveDetail ? `<div class="now-detail">${liveDetail}</div>` : ''}
      <div class="now-head"><span>${esc(started ? t('inProgress') : t('nextMove'))}</span><b class="${inMin <= 15 && !started ? 'soon' : ''}">${esc(status)}</b></div>
      <div class="now-main">
        ${lg && lg.trip > 0 ? `<div class="now-time"><b class="leave">${fmtTime(lg.leave)}</b><small>${esc(t('leaveWord'))}</small></div><span class="now-arrow" aria-hidden="true">→</span><div class="now-time"><b>${fmtTime(lg.start)}</b><small>${esc(t('startWord'))}</small></div>` : `<div class="now-time"><b>${fmtTime(card.start)}</b><small>${esc(t('startWord'))}</small></div>`}
        <div class="now-text"><div class="now-title">${isApptLike(task) ? '📅 ' : ''}${esc(card.title)}</div><small>${esc([place, lg && lg.trip > 0 ? `${MODE_ICON[lg.step.mode] || '🚌'} ${fmtDur(lg.trip)}` : '', t('untilTime', fmtTime(card.start + card.minutes)), isEvent(task) ? readinessText(task.id) : ''].filter(Boolean).join(' · '))}</small>${isPalestra(task) && state.meta.palestraSynced ? `<small class="pal-heard">🏋 ${esc(t('palHeard', clock(state.meta.palestraSynced)))}</small>` : ''}</div>
      </div>
      ${!runLine && liveDetail && liveB === card ? `<div class="now-detail">${liveDetail}</div>` : ''}
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
  // (v100) Oggi «Adesso e poi»: one big card (what's on, or what's next), one line for what comes after, the rest
  // of the day as chips, what's done folded; the other sections below, closed. Tapping opens the card to look at it.
  if (!classic()) {
    const body = oggiA(td, now, { run, curBlock, current, next, open, upcoming, old });
    return `<div class="today">
      <div class="today-head"><h1>${esc(fmtDay(td))}</h1><small>${esc(totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned'))}${dayCount(td).n ? ` · ${esc(t('ox_doneOf', dayCount(td).d, dayCount(td).n))}` : ''}</small></div>
      ${eventsOn(td).filter((e) => e.allDay).length ? `<div class="today-allday">${eventsOn(td).filter((e) => e.allDay).map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">📅 ${esc(e.title)}</button>`).join('')}</div>` : ''}
      ${ui.reflow ? `<div class="reflow"><span>${esc(t('reflowMoved', ui.reflow.moved))}</span><button class="linkish" type="button" data-action="reflow-undo">${esc(t('undo'))}</button><button class="icon" type="button" data-action="reflow-ok" aria-label="${esc(t('close'))}">✕</button></div>` : ''}
      ${eveningMode(td) ? `${behindCard(td)}${body}` : `${body}${behindCard(td)}`}
      ${giornataHtml(td, { skip: ['brief'], closed: true, bar: false })}</div>`;
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

// ---------- (v100) Oggi «Adesso e poi» ----------
const colorOf = (b) => (b.isEvent ? b.color || '#6b7280' : catColor(b.category) || 'var(--accent)');
const openAct = (b) => (b.isEvent ? `data-action="event" data-id="${esc(b.id)}"` : `data-action="open-block" data-id="${esc(b.id)}"`);
function stepLine(b, now) {
  if (b.isEvent) return '';
  const ys = stepTimes(b); if (ys.length < 2) return '';
  const cur = ys.find((y) => y.state !== 'done' && y.start <= now && now < y.end) || ys.find((y) => y.state !== 'done');
  if (!cur) return '';
  return `<button type="button" class="ox-step" ${openAct(b)}><span>${esc(t('vc_ofN', ys.indexOf(cur) + 1, ys.length))} · <b>${esc(stepName(cur))}</b></span><span aria-hidden="true">›</span></button>`;
}
function heroHtml(b, now, run) {
  const task = !b.isEvent && b.taskId ? get('tasks', b.taskId) : null;
  const started = b.start <= now; const end = b.start + b.minutes;
  const lg = b.isEvent ? null : legTimes(b); const legDone = lg && b.stepState?.[lg.step.id] === 'done';
  const leaving = lg && lg.trip > 0 && !legDone && now < lg.start;
  const isRun = run?.id === b.id;
  const k = isRun && run.pausedAt ? `❚❚ ${t('timerPaused')}` : started ? `● ${t('inProgress')} · ${t('untilTime', fmtTime(end))}` : leaving ? `${MODE_ICON[lg.step.mode] || '🚌'} ${t('leaveAt', fmtTime(lg.leave))} · ${t('leaveIn', fmtDur(Math.max(0, lg.leave - now)))}` : `${t('nextMove')} · ${t('startsIn', fmtDur(Math.max(0, b.start - now)))}`;
  const place = task?.place ? task.place.split(',')[0] : b.isEvent ? b.location || '' : '';
  const sub = [place ? `📍 ${place}` : '', started ? '' : `${fmtTime(lg && lg.trip > 0 ? lg.start : b.start)}–${fmtTime(end)}`, b.isEvent ? b.calendar || t('calendar') : ''].filter(Boolean).join(' · ');
  const prog = isRun && run.focus ? focusMiniHtml(run) : started ? `<div class="ox-prog"><span><i style="width:${Math.min(100, Math.round(((now - b.start) / Math.max(1, b.minutes)) * 100))}%"></i></span><small>${esc(t('vc_nowLeft', fmtDur(Math.max(0, end - now))))}</small></div>` : '';
  let acts = '';
  if (b.isEvent) acts = `<button class="btn" type="button" ${openAct(b)}>${esc(t('giOpen'))} ›</button>`;
  else if (isRun && run.focus) acts = `<button class="btn primary" type="button" data-action="${run.pausedAt ? 'timer-resume' : 'timer-pause'}">${run.pausedAt ? `▶ ${esc(t('timerResume'))}` : `❚❚ ${esc(t('timerPause'))}`}</button><button class="btn" type="button" data-action="timer-stop">✓ ${esc(t('esDone'))}</button><button class="btn" type="button" data-action="focus-open">${esc(t('giOpen'))}</button>`;
  else if (isPalestra(task) && !b.startedAt && !leaving) acts = `<button class="btn primary" type="button" data-action="pal-start" data-id="${esc(b.id)}">▶ ${esc(t('palStart'))}</button><button class="btn" type="button" ${openAct(b)}>${esc(t('giOpen'))}</button>`;
  else if (!leaving && b.kind === 'meal' && recipesOf(b).length && !b.startedAt) acts = `<a class="btn primary" href="${esc(recipeLink(recipesOf(b)[0]))}" target="_blank" rel="noopener">🍳 ${esc(t('vc_openRecipe'))} ↗</a><button class="btn" type="button" ${openAct(b)}>${esc(t('giOpen'))}</button>`; // (v115) a meal: its recipe in Ricette
  else if (leaving) acts = `<button class="btn primary" type="button" data-action="now-left" data-id="${esc(b.id)}" data-step="${esc(lg.step.id)}">${esc(t('leftNow'))}</button><button class="btn" type="button" data-action="now-move" data-id="${esc(b.id)}">${esc(t('move'))}</button>`;
  else if (started || isRun) acts = `<button class="btn primary" type="button" data-action="now-done" data-id="${esc(b.id)}">✓ ${esc(t('esDone'))}</button>${isRun ? '' : `<button class="btn" type="button" data-action="focus-start" data-id="${esc(b.id)}">▶ ${esc(planLabel(b))}</button>`}<button class="btn" type="button" ${openAct(b)}>${esc(t('giOpen'))}</button>`;
  else acts = `<button class="btn primary" type="button" data-action="focus-start" data-id="${esc(b.id)}">▶ ${esc(t('ox_focus', planLabel(b)))}</button><button class="btn" type="button" data-action="now-move" data-id="${esc(b.id)}">${esc(t('move'))}</button>`;
  return `<section class="ox-hero${started || isRun ? ' live' : ''}" style="--c:${esc(colorOf(b))}" aria-label="${esc(t('nextMove'))}">
    <div class="ox-k">${esc(k)}</div>
    <button type="button" class="ox-title" ${openAct(b)}>${isApptLike(task) ? '📅 ' : ''}${esc(b.title)}</button>
    ${sub ? `<small class="ox-sub">${esc(sub)}</small>` : ''}
    ${prog}${stepLine(b, now)}
    <div class="ox-acts">${acts}${task?.place && !isRun ? `<a class="btn icon-btn" href="${esc(mapsHref(task))}" target="_blank" rel="noopener" aria-label="${esc(t('openMaps'))}">📍</a>` : ''}</div></section>`;
}
function oggiA(td, now, { run, curBlock, current, next, open, upcoming, old }) {
  const hero = (run && open.find((b) => b.id === run.id)) || curBlock || current || old;
  if (!hero) return `<section class="ox-hero empty"><div class="ox-k">${esc(t('nextMove'))}</div><p>${esc(open.length || upcoming.length ? t('dayDone') : t('nothingToday'))}</p><div class="ox-acts"><a class="btn" href="#/plan">${esc(t('openPlanner'))}</a></div></section>`;
  const after = upcoming.find((b) => b !== hero && b.start > now && b.start >= hero.start);
  let nextLine = '';
  if (after) {
    const lg = after.isEvent ? null : legTimes(after); const ys = after.isEvent ? [] : stepTimes(after);
    const sub = [lg && lg.trip > 0 ? `${MODE_ICON[lg.step.mode] || '🚌'} ${t('leaveAt', fmtTime(lg.leave))}` : '', fmtDur(after.minutes), ys.length > 1 ? t('ox_nSteps', ys.length) : ''].filter(Boolean).join(' · ');
    nextLine = `<div class="sec-mini"><span>${esc(t('ox_then'))}</span><span>${esc(t('ox_inTime', fmtDur(Math.max(0, (lg && lg.trip > 0 ? lg.leave : after.start) - now))))}</span></div>
      <button type="button" class="ox-next" ${openAct(after)} style="--c:${esc(colorOf(after))}"><b class="ox-nt">${fmtTime(after.start)}</b><span class="ox-nx"><b>${esc(after.title)}</b><small>${esc(sub)}</small></span><span aria-hidden="true">›</span></button>`;
  }
  const keys = keyMoments(td, now); const all = dayItems(td, now, keys, otherBlocks(td, keys));
  const past = all.filter((k) => k.done || (k.ev && k.end <= now));
  const chips = all.length > 1 ? `<div class="sec-mini"><span>${esc(t('ox_rest'))}</span><button type="button" class="ox-back" data-ox-back hidden>◉ ${esc(t('ox_nowBack'))}</button></div><div class="ox-strip">${all.map((k) => { const b = k.b || null; const c = k.ev ? (eventsOn(td).find((e) => e.id === k.id)?.color || '#6b7280') : catColor(b?.category) || 'var(--accent)';
    return `<button type="button" class="ox-chip${k.done || (k.ev && k.end <= now) ? ' done' : ''}${k.id === hero.id ? ' is-now' : ''}" ${k.ev ? `data-action="event" data-id="${esc(k.id)}"` : `data-action="open-block" data-id="${esc(k.id)}"`} style="--c:${esc(c)}"><small><i></i>${fmtTime(k.leave ?? k.start)}</small><b>${esc(k.title)}</b></button>`; }).join('')}</div>` : '';
  const fold = past.length ? `<button type="button" class="ox-fold" data-action="gi-past" aria-expanded="${Boolean(ui.giPast)}"><span>✓ ${esc(t('giPastDone', past.length))} · ${fmtTime(Math.min(...past.map((k) => k.leave ?? k.start)))}–${fmtTime(Math.max(...past.map((k) => k.end)))}</span><span aria-hidden="true">${ui.giPast ? '▾' : '›'}</span></button>${ui.giPast ? `<div class="ox-past">${past.map((k) => `<button type="button" class="ox-prow${k.failed ? ' failed' : ''}" ${k.ev ? `data-action="event" data-id="${esc(k.id)}"` : `data-action="open-block" data-id="${esc(k.id)}"`}><span>${fmtTime(k.start)}</span><b>${esc(k.title)}</b><small>${k.failed ? '✕' : '✓'}</small></button>`).join('')}</div>` : ''}` : '';
  return `${heroHtml(hero, now, run)}${nextLine}${chips}${fold}`;
}
