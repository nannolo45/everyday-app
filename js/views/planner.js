// views/planner.js: moved from app.js (v36). See app.js for how the modules fit together.
import { cardRows, fixAll, slotOptions, toFix, weekCardHtml } from '../weekpick.js';
import { leadOf, openTasks, plannedTaskIds } from '../model.js';
import { openAutoPlanner } from '../editors.js';
import { catColor, esc, fmtDay, hint, PPM, range, reasonText, relDay, toast, ui } from '../core.js';
import { t } from '../i18n.js';
import { isEvent } from '../kinds.js';
import { roomOf, roomUsed, roomy, alreadyPlanned, isApptLike, isMealTask, mealRecipes, taskIcon, autoApply, autoChecks, blocksOn, blockTimeText, checklistLeft, checklistOf, checkMissed, conflictsOn, conflictText, eventsOn, isInvite, ISSUE_SEC, issueText, linkFor, nextPlanned, outcomeOf, partsLeft, plannedWhen, prereqsOf, splitsSteps, stepTimes, taskDayOf, taskIssues, timedEventsOn, timesLeft } from '../model.js';
import { addDays, dateStr, dayTotals, fmtDur, fmtTime, importanceOf, layoutBlocks, parseDate, sortTasks, today, weekday } from '../plan.js';
import { addGhostList, autoHoursFor, hoursShort, inRange, loadOf, selecting, spreadLabel, trayTasks } from '../planning.js';
import { changed, currentDate, render } from '../shell.js';
import { matchesQ } from '../shoplist.js';
import { get, live, state } from '../store.js';
import { ricetteConfigured, watchMonth } from '../sync.js';
import { MODE_ICON } from '../travel.js';
import { openModal, searchBox, windowsText } from '../widgets.js';
import { DATE_GROUPS, dateBuckets, filterBar, sortPicker, sortTaskList, taskFilter, taskGroupsCfg, taskHay } from './tasks.js';
import { isWide } from './wide.js';
import { placeItem } from '../placing.js';
import { hasRhythm, routines } from '../routines.js';
import { viewScaletta } from './scaletta.js';
import { viewMappa } from './mappa.js';

// "Already planned": a folded list at the bottom of the planning panels, each one a link to its day.
export function plannedList(list, action, open) {
  if (!list.length) return '';
  return `<details class="tray-planned"${open ? ' open' : ''}><summary data-action="${action}">📅 ${esc(t('grp_planned'))} <small>${list.length}</small></summary>
    ${hint('plannedNote')}
    ${sortTasks(list, today()).map((x) => { const b = nextPlanned(x.id); return `<a class="tp-planned" href="#/plan/${esc(b.date)}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}"><span class="tp-dot"></span><span>${esc(x.title)}</span><small>${esc(plannedWhen(x))}</small></a>`; }).join('')}
  </details>`;
}
export function issueBadge(x) {
  const iss = taskIssues(x);
  return iss.length ? `<button type="button" class="iss" data-action="task-fix" data-id="${esc(x.id)}" data-sec="${ISSUE_SEC[iss[0]]}" title="${esc(issueText(x))}" aria-label="${esc(issueText(x))}">⚠</button>` : '';
}

// ---------- views of the plan: list, day, week, month ----------

export const VIEWS = ['day', 'week', 'month'];
export function currentView() { const v = ui.view || state.settings.defaultView || 'day'; return VIEWS.includes(v) ? v : 'day'; }
export function weekStart(date) { return addDays(date, -((weekday(date) + 6) % 7)); } // Monday

// Keep linked blocks up to date and run what's due, for the days on screen.
export function prepareDays(days) {
  for (const d of days) { watchMonth(d.slice(0, 7)); autoApply(d); }
  const next = addDays(days[days.length - 1], 1);
  watchMonth(next.slice(0, 7));
  autoApply(next); // so "the evening before" preparations for the next day show up
  for (const d of [...days, next]) for (const b of blocksOn(d)) if (b.taskId && b.kind !== 'prep' && !outcomeOf(b)) linkFor(b);
  if (days.includes(today())) { autoChecks(today()); checkMissed(today()); }
}
export function viewPlan(date) {
  const v = currentView();
  const td = today();
  let title; let prev; let next; let sub = '';
  if (v === 'day') {
    const totals = dayTotals(blocksOn(date).filter((b) => !roomy(b))); // (v95) a block with room for other things isn't load
    title = fmtDay(date); prev = addDays(date, -1); next = addDays(date, 1);
    sub = `${date === td ? t('today') : relDay(date)} · ${totals.planned ? t('plannedSum', fmtDur(totals.planned)) : t('nothingPlanned')}${totals.done ? ` · ${t('doneSum', fmtDur(totals.done))}` : ''}`;
  } else if (v === 'month') {
    const d = parseDate(date);
    title = fmtDay(date, { month: 'long', year: 'numeric' });
    prev = dateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)); next = dateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1));
  } else {
    const from = v === 'week' ? weekStart(date) : date;
    title = `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(from, 6), { day: 'numeric', month: 'short' })}`;
    prev = addDays(date, -7); next = addDays(date, 7);
    sub = v === 'week' ? t('weekN', isoWeek(from)) : t('nextDays');
  }
  const showToday = v === 'day' ? date !== td : v === 'week' ? weekStart(date) !== weekStart(td) : date.slice(0, 7) !== td.slice(0, 7);
  // One drawer of tasks to plan sits under every view; "Plan" runs the guided flow.
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  const ps = planStyle(); const ag = ps !== 'hours';
  const head = `
  <div class="plan-top">
    <div class="view-switch" role="tablist">${VIEWS.map((k) => `<button type="button" role="tab" class="${k === v ? 'on' : ''}" data-action="view" data-id="${k}" aria-selected="${k === v}">${esc(t(`v_${k}`))}</button>`).join('')}</div>
    ${v === 'day' && !ag ? `<button class="steps-switch" type="button" role="switch" data-action="toggle-steps" aria-checked="${showSteps()}" aria-pressed="${showSteps()}" title="${esc(t(showSteps() ? 'hideSteps' : 'showSteps'))}"><span class="sw" aria-hidden="true"></span>${esc(t('steps'))}</button>` : ''}
  </div>
  <div class="day-head">
    <a class="round" href="#/plan/${prev}" aria-label="${esc(t('previous'))}">‹</a>
    <button class="day-title" type="button" data-action="pick-date">
      <span class="day-name">${esc(title)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
    </button>
    <a class="round" href="#/plan/${next}" aria-label="${esc(t('next'))}">›</a>
    <input type="date" id="day-picker" value="${date}" tabindex="-1" aria-hidden="true">
    ${v === 'day' ? loadBar(date) : ''}
  </div>
  ${ag ? (showToday ? `<div class="day-actions"><a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a></div>` : '') : `<div class="day-actions">
    ${showToday ? `<a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a>` : ''}
    <button class="btn small primary" type="button" data-action="auto">✦ ${esc(t('planBtn'))}</button>
    <button class="btn small" type="button" data-action="add-menu">＋ ${esc(t('addMenu'))}</button>
  </div>`}`;
  if (ps === 'scaletta') return head + viewScaletta(v, date);
  if (ps === 'mappa') return head + viewMappa(v, date);
  if (ag) return `${head}<section class="plan-main agenda-main">${v === 'week' ? agendaWeek(date) : v === 'month' ? viewMonth(date) : agendaDay(date)}</section>`;
  const main = v === 'week' ? viewWeek(date) : v === 'month' ? viewMonth(date) : viewDay(date);
  return `${head}<section class="plan-main">${main}</section>${trayHtml()}`;
}

export function isoWeek(date) {
  const d = parseDate(date); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

export function timelineRange(items) {
  const s = state.settings;
  let startMin = s.dayStart * 60; let endMin = s.dayEnd * 60;
  for (const b of items) { startMin = Math.min(startMin, Math.floor((b.start - (b.lead || 0)) / 60) * 60); endMin = Math.max(endMin, Math.ceil((b.start + b.minutes) / 60) * 60); }
  startMin = Math.max(0, startMin); endMin = Math.min(endMin, 1440);
  const hours = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);
  return { startMin, endMin, hours };
}

export function stepCheck(b, y) {
  const st = y.state || (outcomeOf(b) === 'done' ? 'done' : null);
  // A trace (a day the task was partly done) is a record: its ticks stay as they were.
  return `<input type="checkbox" data-action="step-done" data-block="${esc(b.id)}" data-step="${esc(y.id)}" ${st === 'done' ? 'checked' : ''} ${outcomeOf(b) === 'partial' ? 'disabled' : ''} aria-label="${esc(y.title)}">`;
}
export function conflictBanner(date) {
  const td = today();
  const conflicts = conflictsOn(date);
  if (!conflicts.length) return '';
  return `<div class="notice warn">
    <button class="notice-head" type="button" data-action="toggle-conflicts">⚠ ${esc(t('nConflicts', conflicts.length))} <span>${ui.showConflicts ? '▴' : '▾'}</span></button>
    ${ui.showConflicts ? `<ul>${conflicts.map((c, i) => `<li><span>${esc(conflictText(c))}</span>
      ${(c.type !== 'late' || (get('tasks', get('blocks', c.ids[0])?.taskId)?.due || '') >= td) && !(c.type === 'closed' && isEvent(get('tasks', get('blocks', c.ids[0])?.taskId))) ? `<button class="btn small" type="button" data-action="fix" data-date="${date}" data-i="${i}">${esc(t('fix'))}</button>` : ''}
      ${c.type === 'overlap' ? `<button class="btn small primary" type="button" data-action="conflict-choose" data-date="${date}" data-i="${i}">${esc(t('chooseBtn'))}</button><button class="btn small ghost" type="button" data-action="allow" data-date="${date}" data-i="${i}">${esc(t('fine'))}</button>` : ''}
      ${c.type === 'closed' ? `<button class="btn small ghost" type="button" data-action="allow" data-date="${date}" data-i="${i}">${esc(t('fine'))}</button>` : ''}</li>`).join('')}</ul>` : ''}
  </div>`;
}

export function viewDay(date) {
  prepareDays([date]);
  const td = today();
  const s = state.settings;
  const blocks = blocksOn(date);
  const events = timedEventsOn(date);
  const allDay = eventsOn(date).filter((e) => e.allDay);
  const { startMin, endMin, hours } = timelineRange([...blocks, ...events, ...ghostsOn(date)]);
  const inConflict = new Set(conflictsOn(date).flatMap((c) => c.ids));
  const laid = layoutBlocks([...blocks, ...events]);
  const isToday = date === td;
  P = scaleFor([...blocks, ...events, ...ghostsOn(date)]);


  return `
      ${conflictBanner(date)}
      ${allDay.length ? `<div class="allday">${allDay.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>` : ''}
      <div class="timeline" data-start="${startMin}" data-ppm="${P}" data-snap="${s.snap}" data-date="${date}" style="height:${(endMin - startMin) * P}px">
        ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * P}px"><span>${fmtTime(m)}</span></div>`).join('')}
        ${isToday ? '<div class="now" id="now-line" hidden></div>' : ''}
        ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id)))).join('')}
        ${ghostsOn(date).map((g) => assignGhostHtml(g, startMin)).join('')}
        ${blocks.length || events.length ? '' : `<div class="tl-empty">${esc(t('emptyDay'))}</div>`}
      </div>`;
}

// Week: seven day columns side by side. Blocks can be dragged within a day and across days.
export function viewWeek(date) {
  P = PPM;
  const td = today();
  const s = state.settings;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  prepareDays(days.filter((d) => d >= td).length ? days : [days[0]]);
  const all = days.flatMap((d) => [...blocksOn(d), ...timedEventsOn(d), ...ghostsOn(d)]);
  const { startMin, endMin, hours } = timelineRange(all);
  const h = (endMin - startMin) * PPM;
  const allDay = days.map((d) => eventsOn(d).filter((e) => e.allDay));
  const wd = (d) => fmtDay(d, { weekday: 'short' });
  // (v51) this week's repeats that still need a time, from today on
  const fixRows = days[6] >= td ? cardRows(days[0] > td ? days[0] : td, days[6]) : [];
  ui.weekRows = fixRows;
  return `${weekCardHtml({ rows: fixRows, title: t('toFixThisWeek') })}
  <div class="week">
    <div class="week-head"><div class="wk-gutter"></div>
      ${days.map((d) => `<button type="button" class="wk-day${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-action="${selecting() ? 'assign-range' : 'view-day'}" data-id="${d}" data-drop="${d}"><span>${esc(wd(d))}</span><b>${parseDate(d).getDate()}</b>${loadBar(d)}</button>`).join('')}
    </div>
    ${allDay.some((x) => x.length) ? `<div class="week-allday"><div class="wk-gutter"></div>${allDay.map((list) => `<div>${list.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>` : ''}
    <div class="week-body">
      <div class="wk-hours" style="height:${h}px">${hours.map((m) => `<span style="top:${(m - startMin) * PPM}px">${fmtTime(m)}</span>`).join('')}</div>
      ${days.map((d) => {
    const inConflict = new Set(conflictsOn(d).flatMap((c) => c.ids));
    const laid = layoutBlocks([...blocksOn(d), ...timedEventsOn(d)]);
    return `<div class="timeline wk-col${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-start="${startMin}" data-ppm="${PPM}" data-snap="${s.snap}" data-date="${d}" style="height:${h}px">
          ${hours.map((m) => `<div class="hour" style="top:${(m - startMin) * PPM}px"></div>`).join('')}
          ${d === td ? '<div class="now" id="now-line" hidden></div>' : ''}
          ${laid.map((b) => (b.isEvent ? eventHtml(b, startMin, inConflict.has(b.id)) : blockHtml(b, startMin, inConflict.has(b.id), true))).join('')}
          ${ghostsOn(d).map((g) => assignGhostHtml(g, startMin)).join('')}
        </div>`;
  }).join('')}
    </div>
  </div>`;
}

// Month: a calendar grid; each day shows its first few items. Tap a day to open it.
export function viewMonth(date) {
  const td = today();
  const first = `${date.slice(0, 7)}-01`;
  const start = weekStart(first);
  const month = date.slice(0, 7);
  for (const m of [-1, 0, 1]) { const d = parseDate(first); d.setMonth(d.getMonth() + m); watchMonth(dateStr(d).slice(0, 7)); }
  const cells = [];
  for (let d = start; cells.length < 42; d = addDays(d, 1)) cells.push(d);
  while (cells.length > 35 && cells.slice(-7).every((d) => d.slice(0, 7) !== month)) cells.splice(-7);
  const heads = Array.from({ length: 7 }, (_, i) => fmtDay(addDays(start, i), { weekday: 'short' }));
  return `
  <div class="month">
    <div class="m-head">${heads.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
    <div class="m-grid">${cells.map((d) => {
    const items = [...eventsOn(d).filter((e) => e.allDay), ...[...blocksOn(d), ...timedEventsOn(d)].sort((a, b) => a.start - b.start)];
    const conflict = conflictsOn(d).length > 0;
    const gh = ghostsOn(d);
    return `<button type="button" class="m-cell${d.slice(0, 7) !== month ? ' other' : ''}${d === td ? ' today' : ''}${inRange(d) ? ' in-range' : ''}" data-action="${selecting() ? 'assign-range' : 'view-day'}" data-id="${d}" data-drop="${d}">
        <span class="m-num">${parseDate(d).getDate()}${conflict ? ' <span class="warn-ico">⚠</span>' : ''}</span>
        ${loadBar(d, { text: false })}
        ${gh.map((g) => `<span class="m-item ghost" title="${esc(ghostTip(g))}">${esc(ghostTitle(g))}</span>`).join('')}
        ${items.slice(0, 3).map((x) => `<span class="m-item${outcomeOf(x) ? ' done' : ''}" style="--c:${esc(x.isEvent || x.allDay ? x.color : catColor(x.category) || 'var(--accent)')}">${x.allDay ? '' : `<i>${fmtTime(x.start)}</i> `}${esc(x.title)}</span>`).join('')}
        ${items.length > 3 ? `<span class="m-more">${esc(t('nMore', items.length - 3))}</span>` : ''}
      </button>`;
  }).join('')}</div>
  </div>`;
}

// List: the next seven days as an agenda. What each row shows at a glance is set in Settings;
// tap a row to see the rest (notes, checklist, recipes) and act on it.
// Importance at a glance: !!! very high, !! high, ↓ low; nothing for normal.
export function impBadge(x) {
  const n = importanceOf(x);
  if (n === 3) return '';
  return n > 3 ? `<span class="prio" title="${esc(t(`imp_${n}`))}">${'!'.repeat(n - 2)}</span>` : `<span class="prio low" title="${esc(t(`imp_${n}`))}">↓</span>`;
}
// Steps on the plan: listed (default) or folded into their task. Toggled from the plan.
export function showSteps() { return state.settings.showSteps !== false; }

export const GLANCE = ['time', 'duration', 'category', 'due', 'priority', 'checklist', 'prep', 'recipes', 'location', 'notes'];
export const GLANCE_DEFAULT = ['time', 'duration', 'category', 'due', 'checklist', 'recipes', 'location'];
export function glance() { return new Set(state.settings.glance || GLANCE_DEFAULT); }



// Pixels per minute of the time line being drawn: the Day view zooms in when short things are on it,
// so a 15-minute block (or preview) is tall enough to read; the Week view keeps the base scale.
let P = PPM;
const SHORT_ZOOM = 1.8;
export const scaleFor = (items) => (items.some((x) => (x.minutes || 0) + (x.lead || 0) < 30) ? SHORT_ZOOM : PPM);
export const KIND_ICON = { prep: '↳ ', meal: '🍽 ', groceries: '🛒 ', followup: '↪ ' };


export function blockHtml(b, startMin, conflict, compact = false) {
  const color = catColor(b.category) || 'var(--accent)';
  const short = b.minutes < 30;
  const left = `calc(${(b.col / b.cols) * 100}% + 1px)`;
  const width = `calc(${100 / b.cols}% - 3px)`;
  const items = checklistOf(b);
  const status = outcomeOf(b);
  let extra = '';
  if (items.length) extra = `<span class="mini-badge">☑ ${items.length - checklistLeft(items, b.checked)}/${items.length}</span>`;
  if (b.kind === 'groceries') { const n = live('r_shopping').filter((x) => !x.checked).length; extra = `<span class="mini-badge">${n}</span>`; }
  if (status === 'failed') extra = `<span class="mini-badge bad">✕</span>`;
  // (v87) a meal with nothing chosen yet: «＋ Ricetta» right on the block
  if (b.kind === 'meal' && !status && !mealRecipes(b).length && ricetteConfigured() && !compact && b.cols === 1) extra += `<button class="blk-btn blk-addrec" type="button" data-action="meal-pick" data-id="${esc(b.id)}">＋ ${esc(t('recipeShort'))}</button>`;
  const st = stepTimes(b);
  // A task over several days: which day this is, and on a trace how much got done that day.
  // (on the time line: the title column is often too narrow to show them)
  const day = taskDayOf(b);
  const along = `${day ? `<span class="mini-badge day" title="${esc(t('taskDayTitle'))}">${esc(t('taskDayN', day))}</span>` : ''}${status === 'partial' ? `<span class="mini-badge part">◐ ${st.filter((y) => y.state === 'done').length}/${st.length}</span>` : ''}`;
  // Steps fit beside the title when the block is a single column and tall enough; otherwise a count.
  const stepsIn = st.length && showSteps() && b.cols === 1 && !compact && b.minutes >= 30;
  if (st.length && !stepsIn && status !== 'failed' && status !== 'partial') extra += `<span class="mini-badge">▤ ${status === 'done' ? st.length : st.filter((y) => y.state === 'done').length}/${st.length}</span>`;
  const stepsHtml = stepsIn ? `<div class="blk-steps">${st.map((y, i) => {
    const hpx = (y.end - y.start) * P;
    return `<div class="blk-step${i ? '' : ' first'}${hpx < 16 ? ' tight' : ''}${y.state ? ` ${y.state}` : status === 'done' ? ' done' : status === 'partial' ? ' later' : ''}" style="top:${(y.start - b.start) * P}px;height:${hpx}px">
      ${hpx >= 11 ? `${stepCheck(b, y)}<span class="st-title${y.travel && !y.known ? ' unknown' : ''}">${y.travel ? `${MODE_ICON[y.mode] || '🚌'} ` : ''}${y.travel && !y.known ? '? ' : ''}${esc(y.title)}</span><span class="st-time">${fmtTime(y.start)}</span>` : ''}</div>`;
  }).join('')}</div>` : '';
  const isEv = Boolean(b.taskId && isApptLike(get('tasks', b.taskId))); // (v87) also a task in an appointments category
  return `<div class="block${ui.flash === b.id ? ' flash' : ''}${stepsIn ? ' with-steps' : ''}${status ? ` ${status}` : ''}${status === 'failed' ? ' done' : ''}${short ? ' short' : ''}${conflict ? ' conflict' : ''}${b.kind ? ` k-${b.kind}` : ''}${isEv ? ' own-event' : ''}" data-id="${esc(b.id)}" data-start="${b.start}" data-minutes="${b.minutes}"
    style="--c:${esc(color)};top:${(b.start - startMin) * P}px;height:${Math.max(b.minutes * P, 16)}px;left:${left};width:${width}">
    ${status === 'partial' ? `<span class="blk-check part" aria-label="${esc(t('partlyDone'))}" title="${esc(t('partlyDone'))}">◐</span>` : `<input type="checkbox" class="blk-check" data-action="block-done" data-id="${esc(b.id)}" ${status === 'done' ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`}
    <div class="blk-body">
      <div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${KIND_ICON[b.kind] || ''}${isEv ? '📅 ' : ''}${esc(b.title)}${b.seriesId ? ' <span class="series-ico" title="' + esc(t('recurring')) + '">↻</span>' : ''} ${extra}</div>
      <div class="blk-time">${esc(blockTimeText(b))}${along ? ` ${along}` : ''}</div>
    </div>
    ${stepsHtml}
    <div class="resize" aria-hidden="true"></div>
  </div>`;
}

export function eventHtml(e, startMin, conflict) {
  const left = `calc(${(e.col / e.cols) * 100}% + 1px)`;
  const width = `calc(${100 / e.cols}% - 3px)`;
  return `<div class="block event${e.busy === false ? ' free' : ''}${e.skipped ? ' skipped' : ''}${e.minutes < 30 ? ' short' : ''}${conflict ? ' conflict' : ''}" data-id="${esc(e.id)}"
    style="--c:${esc(e.color || '#6b7280')};top:${(e.start - startMin) * P}px;height:${Math.max(e.minutes * P, 16)}px;left:${left};width:${width}">
    <div class="blk-body"><div class="blk-title">${conflict ? '<span class="warn-ico">⚠</span> ' : ''}${esc(e.title)}</div>
    <div class="blk-time">${range(e.start, e.minutes)} · ${esc(e.calendar)}</div></div></div>`;
}

// ---------- assign: the tray of tasks to plan ----------
// "⇢ Assign" on the plan opens a tray of unplanned to-dos that stays while you switch Day / Week /
// Month / List. Tap tasks to select them; press, hold and drag them onto a day (or a time, in the
// Day and Week views); or tap days to pick a range and "Spread" them over it (or over what's on
// screen). Each day shows a load bar: what's planned, and what the tray would add. Nothing is
// planned until you tap "Add": first the tasks appear as dashed previews you can tap away.

export function ghostsOn(date) { return (ui.assign?.ghosts || []).map((g, i) => ({ ...g, i })).filter((g) => g.date === date); }
export function loadBar(date, { text = true } = {}) {
  // Shown in every view (not only while assigning): how full each day is against your daily limit.
  if (date < today()) return '';
  const { now, add, limit } = loadOf(date);
  const pct = (v) => Math.min(100, (v / limit) * 100);
  const over = now + add > limit;
  return `<span class="load${over ? ' over' : ''}${now >= limit ? ' full' : ''}${now || add ? '' : ' empty'}" ${ui.assign ? `data-drop="${date}"` : ''} title="${esc(t('loadTitle', fmtDur(now), fmtDur(now + add), fmtDur(limit)))}">
    <span class="ld-track"><i class="ld-now" style="width:${pct(now)}%"></i><i class="ld-add" style="left:${pct(now)}%;width:${Math.max(0, pct(now + add) - pct(now))}%"></i></span>
    ${text ? `<small>${esc(add ? (now ? `${hoursShort(now)}→${hoursShort(now + add)}` : `+${hoursShort(add)}`) : hoursShort(now))}</small>` : ''}</span>`;
}
export function trayInfo(x) {
  const bits = [fmtDur(x.minutes || 30)];
  for (const y of (x.steps || []).filter((z) => z.travel && z.lookup !== false)) bits.push(`${MODE_ICON[y.mode] || '🚌'} ${y.known ? fmtDur(y.minutes) : '?'}`);
  if (x.repeat === 'times') bits.push(`×${timesLeft(x, today())}`);
  else if (splitsSteps(x)) bits.push(`▤ ${partsLeft(x).length}`);
  if (x.due) bits.push(x.due < today() ? t('late') : relDay(x.due));
  if (prereqsOf(x).some((p) => !p.block)) bits.push(`🔒 ${prereqsOf(x).find((p) => !p.block).task.title}`);
  if (x.windows?.length) bits.push(`🕒 ${windowsText(x.windows)}`);
  if (x.fromTitle) bits.push(`↪ ${x.fromTitle}`);
  return bits.join(' · ');
}
export function trayHtml() {
  const a = ui.assign;
  const all = trayTasks();
  const q = (a.q || '').trim();
  const list = q ? all.filter((x) => matchesQ(taskHay(x), q)) : all;
  const sel = all.filter((x) => a.sel.has(x.id));
  const selMin = sel.reduce((n, x) => n + (x.minutes || 30), 0);
  const mode = state.settings.traySort || 'smart';
  const planned = alreadyPlanned().filter((x) => !q || matchesQ(taskHay(x), q));
  const row = (x) => `<button type="button" class="tchip trow${a.sel.has(x.id) ? ' on' : ''}" data-id="${esc(x.id)}" style="--c:${esc(catColor(x.category) || 'var(--accent)')}" aria-pressed="${a.sel.has(x.id)}">
      <span class="trow-tick">${a.sel.has(x.id) ? '✓' : ''}</span>
      <span class="trow-text"><span class="chip-title">${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}${taskIssues(x).length ? ` <span class="iss-mark" title="${esc(issueText(x))}">⚠</span>` : ''}</span><small>${esc(trayInfo(x))}</small></span>
      <span class="trow-grip" aria-hidden="true">⠿</span></button>`;
  // "Now": straight into the next free slot of the day on screen (today: after now).
  const quick = (x) => (currentDate() >= today() ? `<button class="trow-add" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${currentDate()}" title="${esc(t('nextFreeSlot', relDay(currentDate())))}" aria-label="${esc(t('nextFreeSlot', relDay(currentDate())))}">↓</button>` : '');
  const rowQ = (x) => `<div class="trow-wrap">${row(x)}${quick(x)}</div>`;
  // Grouped by when it's due (like the Tasks tab) when sorted smartly or by due date; otherwise one list.
  let body;
  if (mode === 'smart' || mode === 'due') {
    const g = dateBuckets(list, (x) => x.due, today()); // the same date groups as the task list
    const label = (k) => (k === 'soon' ? t('grp_soonN', Number(taskGroupsCfg().soonDays) || 7) : k === 'nodate' ? t('grp_anytime') : t(`grp_${k}`));
    body = ['overdue', ...DATE_GROUPS, 'nodate'].filter((k) => g[k].length)
      .map((k) => `<div class="tray-grp">${esc(label(k))} <small>${g[k].length}</small></div>${sortTaskList(g[k], mode).map(rowQ).join('')}`).join('');
  } else body = list.map(rowQ).join('');
  const hint = a.range ? t('trayHintRange') : t('trayHint');
  const fixN = all.filter((x) => taskIssues(x).length).length;
  return `<div class="tray${a.open ? ' open' : ''}" role="region" aria-label="${esc(t('toPlan'))}">
    <div class="tray-head">
      <button class="tray-toggle" type="button" data-action="tray-toggle" aria-expanded="${Boolean(a.open)}"><span class="fold-ico">▴</span> <b>${esc(t('toPlan'))}</b>
        <small>${esc(sel.length ? t('nSelected', sel.length, fmtDur(selMin)) : a.ghosts.length ? t('nPreviews', a.ghosts.length) : String(all.length))}</small></button>
      ${sel.length ? `<button class="linkish" type="button" data-action="assign-none">${esc(t('selectNone'))}</button>` : all.length > 1 && a.open ? `<button class="linkish" type="button" data-action="assign-all">${esc(t('selectAll'))}</button>` : ''}
      ${fixN && !a.open ? `<button class="fchip warn" type="button" data-action="filter" data-id="fix" aria-pressed="${Boolean(taskFilter().fix)}">⚠ ${esc(t('f_fix'))} ${fixN}</button>` : ''}
      ${a.open ? `<button class="icon" type="button" data-action="assign-opts" aria-label="${esc(t('options'))}" aria-expanded="${Boolean(a.opts)}">⚙</button>` : ''}
      ${a.ghosts.length || sel.length ? `<button class="icon" type="button" data-action="assign-close" aria-label="${esc(t('close'))}">✕</button>` : ''}
    </div>
    ${a.opts ? `<form class="tray-opts" id="assign-opts">
      <label>${esc(t('maxLoad'))}<select name="maxLoad">${[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((h) => `<option value="${h}" ${h === Number(state.settings.maxLoad ?? 8) ? 'selected' : ''}>${h} h</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="freeWeekends" ${state.settings.freeWeekends ? 'checked' : ''}> <span>${esc(t('freeWeekends'))}</span></label>
      <small class="hint">${esc(t('autoHoursNow', fmtTime(autoHoursFor('2026-11-02')[0]), fmtTime(autoHoursFor('2026-11-02')[1]), fmtTime(autoHoursFor('2026-11-07')[0]), fmtTime(autoHoursFor('2026-11-07')[1])))}</small>
    </form>` : ''}
    ${a.open ? `
    <div class="tray-tools">${searchBox({ id: 'tray-q', value: a.q || '' })}${sortPicker('tray-sort', mode)}</div>
    ${filterBar()}
    ${list.length ? `<div class="tray-list">${body}</div>` : `<p class="hint tray-hint">${esc(q ? t('noMatch') : a.ghosts.length ? t('trayAllPlaced') : t('trayEmpty'))}</p>`}
    ${hint ? `<p class="hint tray-hint">${esc(hint)}</p>` : ''}
    ${plannedList(planned, 'tray-planned', a.showPlanned)}` : ''}
    ${a.ghosts.length ? `<details class="tray-planned tray-why"${a.showWhy ? ' open' : ''}><summary data-action="tray-why">✦ ${esc(t('previewList'))} <small>${a.ghosts.length}</small></summary>
      <div class="why-list">${previewListHtml(a.ghosts)}</div>
    </details>` : ''}
    <div class="tray-actions">
      ${all.length && !a.ghosts.length ? (sel.length ? `<button class="btn primary spread" type="button" data-action="assign-spread">✦ ${esc(t('spreadSel', spreadLabel()))}</button>` : `<button class="btn primary spread" type="button" data-action="auto">✦ ${esc(t('smartTitle'))}</button>`) : ''}
      ${a.ghosts.length && all.length ? `<button class="btn small" type="button" data-action="assign-spread">✦ ${esc(t('spreadMore'))}</button>` : ''}
      ${a.range ? `<button class="btn small ghost" type="button" data-action="assign-range-clear">${esc(t('clearRange'))}</button>` : ''}
      ${a.ghosts.length ? `<button class="btn small" type="button" data-action="assign-clear">${esc(t('cancel'))}</button>
        <button class="btn primary" type="button" data-action="assign-add">${esc(t('addN', a.ghosts.length))}</button>` : ''}
    </div>
  </div>`;
}
// The previews as a list, by day: a day's name opens it in the Day view; ✕ takes one back.
function previewListHtml(ghosts) {
  const byDay = new Map();
  ghosts.map((g, i) => ({ ...g, i })).sort((x, y) => (x.date === y.date ? x.start - y.start : x.date < y.date ? -1 : 1))
    .forEach((g) => { if (!byDay.has(g.date)) byDay.set(g.date, []); byDay.get(g.date).push(g); });
  return [...byDay].map(([date, gs]) => `<div class="why-day"><button type="button" class="linkish" data-action="why-day" data-id="${esc(date)}">${esc(relDay(date))}</button><small>${gs.length} · ${esc(fmtDur(gs.reduce((n, g) => n + g.minutes, 0)))}</small></div>
    ${gs.map((g) => `<div class="why-row" style="--c:${esc(catColor(get('tasks', g.taskId)?.category) || 'var(--accent)')}"><span class="why-time">${esc(fmtTime(g.start))}</span><span class="why-main"><span class="why-title">${esc(ghostTitle(g))}</span><small class="why-line">${esc([fmtDur(g.minutes), ghostWhy(g)].filter(Boolean).join(' · '))}</small></span><button type="button" class="icon why-x ok" data-action="ghost-keep" data-i="${g.i}" aria-label="${esc(t('propKeep'))}">✓</button><button type="button" class="icon why-x" data-action="ghost-rm" data-i="${g.i}" aria-label="${esc(t('takeBack', ghostTitle(g)))}">✕</button></div>`).join('')}`).join('');
}
export function ghostTitle(g) {
  const task = get('tasks', g.taskId);
  const step = g.stepId && (task?.steps || []).find((y) => y.id === g.stepId);
  return step ? `${task.title} · ${step.title}` : task?.title || '';
}
// A preview on a timeline (Day and Week views): tap to take it back.
// Why a suggestion was picked ("due today · very important"), from the planner's scores.
export function ghostWhy(g) { return g.reasons?.length ? reasonText(g.reasons) : ''; }
export function ghostTip(g) { return [ghostWhy(g), t('ghostTap')].filter(Boolean).join(' — '); }
export function assignGhostHtml(g, startMin) {
  const task = get('tasks', g.taskId);
  // Under 45 minutes: one line (title, time), the reason only in the list and the tooltip.
  const short = (g.minutes + (g.lead || 0)) * P < 54;
  return `<div class="block ghost assign${short ? ' short' : ''}${ui.flash === `g${g.i}` ? ' flash' : ''}" data-fk="g${g.i}" data-action="ghost-rm" data-i="${g.i}" data-start="${g.start - (g.lead || 0)}" data-minutes="${g.minutes + (g.lead || 0)}" title="${esc(ghostTip(g))}" style="--c:${esc(catColor(task?.category) || 'var(--accent)')};top:${(g.start - (g.lead || 0) - startMin) * P}px;height:${Math.max((g.minutes + (g.lead || 0)) * P, 16)}px;left:1px;right:3px">
    <div class="blk-body"><div class="blk-title">${esc(ghostTitle(g))} <span class="ghost-x">✕</span></div><div class="blk-time">${range(g.start, g.minutes)}</div>${ghostWhy(g) && !short ? `<div class="blk-why">✦ ${esc(ghostWhy(g))}</div>` : ''}</div></div>`;
}

// ---------- (v55) the agenda: the day as a list, with the free time between ----------
// Settings → Planner chooses it ("Agenda", the default) or the hour timeline. The old suites keep the timeline.
export function planStyle() {
  const s = state.settings.planStyle; if (['agenda', 'hours', 'scaletta', 'mappa'].includes(s)) return s; // (v96) + Scaletta, Mappa
  try { if (localStorage.getItem('everyday-classic') === '1') return 'hours'; } catch { /* no storage */ }
  return 'agenda';
}
const weekEndOf = (d) => addDays(weekStart(d), 6);
// The routines' proposals ("to set" this week), kept while the proposals are on screen.
export function fixProps() {
  const out = [];
  for (const r of ui.assign?.fix || []) {
    if (r.date && r.options?.[0]) out.push({ fix: true, taskId: r.x.id, title: r.x.title, date: r.date, start: r.options[0].start, minutes: r.x.minutes || 30, category: r.x.category });
    for (const p of r.placements || []) out.push({ fix: true, taskId: r.x.id, title: r.x.title, date: p.date, start: p.start, minutes: p.minutes, category: r.x.category });
  }
  return out;
}
// (v76) One proposal at a time: ✓ puts it on the plan now, ✕ takes it back; the others wait.
export function keepGhost(i) {
  const gs = ui.assign?.ghosts || []; if (!gs[i]) return;
  const [g] = gs.splice(i, 1);
  addGhostList([g]); ui.assign.kept = (ui.assign.kept || 0) + 1;
  toast(t('propKept', ghostTitle(g))); changed();
}
export function keepFix(taskId, date, start, keep = true) {
  const rows = ui.assign?.fix || [];
  for (const r of rows) {
    if (r.x.id !== taskId) continue;
    if (r.date === date && r.options?.[0]?.start === start) { if (keep) fixAll([{ ...r, placements: [] }]); r.options = []; }
    const pi = (r.placements || []).findIndex((p) => p.date === date && p.start === start);
    if (pi >= 0) { const [p] = r.placements.splice(pi, 1); if (keep) fixAll([{ x: r.x, placements: [p] }]); }
  }
  ui.assign.fix = rows.filter((r) => (r.date && r.options?.length) || (r.placements || []).length);
  if (keep) { ui.assign.kept = (ui.assign.kept || 0) + 1; toast(t('propKept', get('tasks', taskId)?.title || '')); }
  changed();
}
export function agendaPlan() {
  const td = today();
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  // (v81) with tasks to place, the routines' turns are proposed with them, for the days you choose
  if (trayTasks().length) { ui.assign.fix = null; ui.assign.fixWanted = true; openAutoPlanner(); return; }
  ui.assign.fix = cardRows(td, weekEndOf(td));
  render();
}
export function agendaAdd() {
  const n = addGhostList(ui.assign?.ghosts || []) + fixAll(ui.assign?.fix || []);
  ui.assign.ghosts = []; ui.assign.fix = null; ui.assign.kept = 0;
  toast(t('assignAdded', n)); changed();
}
// One card for both: what's still to plan and the routines still to set; then the proposals.
export function planCard() {
  const td = today();
  const props = (ui.assign?.ghosts?.length || 0) + fixProps().length;
  const wide = isWide();
  if (props) {
    const nDays = new Set([...(ui.assign?.ghosts || []).map((g) => g.date), ...fixProps().map((f) => f.date)]).size;
    const kept = ui.assign?.kept || 0; // (v76) proposals kept one by one
    return `<div class="ag-card-top on${wide ? '' : ' two-row'}"><span><b>✦ ${esc(t('agProposals', props))}</b><small>${esc([kept ? t('propsKeptN', kept) : '', t('propsDays', nDays)].filter(Boolean).join(' · '))}</small></span>${wide ? '' : `<button class="btn small" type="button" data-action="pv-list">${esc(t('propsList'))}</button>`}<button class="btn small" type="button" data-action="ag-cancel">${esc(t('cancel'))}</button><button class="btn small primary" type="button" data-action="ag-add">${esc(kept ? t('addTheRest') : t('add'))}</button></div>`;
  }
  // (v67) a task picked to place by hand: say what, and how to stop
  const pick = (ui.pickBlock && get('blocks', ui.pickBlock)) || (ui.pick && get('tasks', ui.pick));
  if (pick) return `<div class="ag-pick"><span>${esc(t('pickBanner', pick.title, fmtDur(pick.minutes || 30)))}<small>${esc(t('swapHint'))}</small></span><button class="icon" type="button" data-action="fd-unpick" aria-label="${esc(t('close'))}">✕</button></div>`;
  const nPlan = trayTasks().length; const nFix = toFix(td, weekEndOf(td)).length;
  // on a phone one button, Pianifica: a smart suggestion, or Scelgo io (find, pick, place; also to find what's planned)
  if (!wide) return `<div class="ag-card-top"><span><b>${esc(nPlan + nFix ? t('agToPlan', nPlan + nFix) : `✓ ${t('agAllPlanned')}`)}</b></span><button class="btn small primary" type="button" data-action="ag-choose">${esc(t('planChoose'))}</button></div>`;
  if (!nPlan && !nFix) return `<p class="ag-ok">✓ ${esc(t('agAllPlanned'))}</p>`;
  // (v66) one word for both: what's to plan and this week's routine turns without a time yet
  return `<div class="ag-card-top"><span><b>${esc(t('agToPlan', nPlan + nFix))}</b></span><button class="btn small primary" type="button" data-action="ag-plan">✦ ${esc(t('smartTitle'))}</button></div>`;
}
export function agItems(date) {
  const ghosts = ghostsOn(date).map((g) => ({ k: 'ghost', g, start: g.start, minutes: g.minutes || 30 }));
  const fixes = fixProps().filter((f) => f.date === date).map((f) => ({ k: 'fix', g: f, start: f.start, minutes: f.minutes }));
  return [...blocksOn(date).map((b) => ({ k: 'block', b, start: b.start, minutes: b.minutes || 0 })),
    ...timedEventsOn(date).map((e) => ({ k: 'event', e, start: e.start, minutes: e.minutes || 0 })), ...ghosts, ...fixes]
    .sort((a, b) => a.start - b.start);
}
// (v71) What you answered to an invitation.
export const invTag = (e) => (e.rsvp === 'accepted' ? `<span class="inv-tag yes">${esc(t('invYes'))}</span>` : `<span class="inv-tag">${esc(e.rsvp === 'tentative' ? t('invMaybe') : t('invPending'))}</span>`);
const lenBar = (m) => `<span class="ag-len"><i style="width:${Math.min(100, Math.round((m / 180) * 100))}%"></i><b>${esc(fmtDur(m))}</b></span>`;
function agRow(it) {
  const end = it.start + it.minutes;
  const time = `<span class="ag-time">${esc(fmtTime(it.start))}<small>${it.minutes ? esc(fmtTime(end)) : ''}</small></span>`;
  if (it.k === 'ghost' || it.k === 'fix') {
    const g = it.g;
    const fk = it.k === 'ghost' ? `g${g.i}` : `f${g.taskId}~${g.date}`;
    return `<li class="ag-row ghost${ui.flash === fk ? ' flash' : ''}" data-fk="${esc(fk)}" style="--c:${esc(catColor(g.category || get('tasks', g.taskId)?.category) || 'var(--accent)')}">${time}<span class="ag-c"><span class="ag-t">${esc(it.k === 'ghost' ? ghostTitle(g) : g.title)}</span><small>${esc(it.k === 'ghost' ? ghostWhy(g) : t('propRoutine'))}</small>${lenBar(it.minutes)}</span><span class="ag-keep">${it.k === 'ghost'
      ? `<button class="icon ok" type="button" data-action="ghost-keep" data-i="${g.i}" aria-label="${esc(t('propKeep'))}" title="${esc(t('propKeep'))}">✓</button><button class="icon" type="button" data-action="ghost-rm" data-i="${g.i}" aria-label="${esc(t('remove'))}">✕</button>`
      : `<button class="icon ok" type="button" data-action="fix-keep" data-id="${esc(g.taskId)}" data-date="${g.date}" data-start="${g.start}" aria-label="${esc(t('propKeep'))}" title="${esc(t('propKeep'))}">✓</button><button class="icon" type="button" data-action="fix-drop" data-id="${esc(g.taskId)}" data-date="${g.date}" data-start="${g.start}" aria-label="${esc(t('remove'))}">✕</button>`}</span></li>`;
  }
  const placing = Boolean(ui.pick || ui.pickBlock);
  if (it.k === 'event') {
    const e = it.e;
    // (v71) invitations say so, and while placing you can take their slot; your own events stay put
    const inv = isInvite(e) && !e.skipped; const swap = placing && !e.skipped; // (v76) any event: after it, together, or (an invitation) instead
    const tag = e.skipped ? `<span class="inv-tag no">${esc(t('invNotGoing'))}</span>` : inv ? invTag(e) : e.busy === false ? `<span class="inv-tag no">${esc(t('evFreeTag'))}</span>` : '';
    return `<li class="ag-row ev${e.skipped ? ' skipped' : e.busy === false ? ' free' : ''}${placing && !swap ? ' locked' : ''}"${!e.skipped ? ` data-ev="${esc(e.id)}"` : ''} style="--c:${esc(e.color || 'var(--muted)')}">${time}<button class="ag-c${swap ? ' swap' : ''}" type="button" data-action="${swap ? 'swap-event' : 'event'}" data-id="${esc(e.id)}">${swap ? `<span class="ag-swap">${esc(inv ? t('swapHere') : t('dropHereEv'))}</span>` : ''}<span class="ag-t">📅 ${esc(e.title)}</span>${tag}${e.location ? `<small>📍 ${esc(e.location)}</small>` : ''}${lenBar(it.minutes)}</button></li>`;
  }
  const b = it.b; const st = outcomeOf(b);
  const swap = placing && !st && b.id !== ui.pickBlock; // (v70) tap it to put what you're placing here instead
  // (v69) a block not yet done can be dragged to another free stretch or day (mouse)
  const steps = swap ? '' : agSteps(b, st);
  return `<li class="ag-row${st ? ` is-${st}` : isBehind(b) ? ' is-behind' : ''}${ui.flash === b.id ? ' flash' : ''}"${st ? '' : ` draggable="true" data-drag="block:${esc(b.id)}" data-min="${b.minutes || 30}"`} style="--c:${esc(catColor(b.category) || 'var(--accent)')}">${time}${steps ? '<div class="ag-cw">' : ''}<button class="ag-c${swap ? ' swap' : ''}" type="button" data-action="${swap ? 'swap-block' : 'open-block'}" data-id="${esc(b.id)}">${swap ? `<span class="ag-swap">${esc(t('swapHere'))}</span>` : ''}<span class="ag-t">${st === 'done' ? '✓ ' : ''}${b.taskId ? taskIcon(get('tasks', b.taskId)) : ''}${esc(b.title)}</span>${isBehind(b) ? `<span class="inv-tag behind">⏰ ${esc(t('behindTag'))}</span>` : ''}${b.palLive && !st ? `<span class="inv-tag live">● ${esc(t('palLiveTag'))}</span>` : ''}${b.place ? `<small>📍 ${esc(b.place)}</small>` : ''}${lenBar(it.minutes)}</button>${steps}${steps ? '</div>' : ''}${b.kind === 'meal' && !st && !swap && !mealRecipes(b).length && ricetteConfigured() ? `<button class="ag-addrec" type="button" data-action="meal-pick" data-id="${esc(b.id)}">＋ ${esc(t('recipeShort'))}</button>` : ''}</li>`; // (v87) a meal with nothing chosen: «＋ Ricetta» beside it
}
// (v93) A block's steps in the day list: a strip with one segment per step (tap to tick), «▤ 1/3 passaggi» to
// open the list (tick, time, length), and the block running now (or the next one) open by itself. What you open
// or close by hand stays so (ui.agOpen).
const stepName = (y) => y.title || t(y.travel === 'there' ? 'getThere' : y.travel === 'back' ? 'comeBack' : 'steps');
export function autoStepsBlock(date) {
  if (date !== today()) return null;
  const n = new Date(); const now = n.getHours() * 60 + n.getMinutes();
  return blocksOn(date).filter((b) => !outcomeOf(b) && !b.stepId && b.start + (b.minutes || 0) > now && stepTimes(b).length > 1).sort((a, b) => a.start - b.start)[0]?.id || null;
}
export function agSteps(b, st) {
  const ys = stepTimes(b); if (ys.length < 2) return '';
  const n = new Date(); const now = b.date === today() ? n.getHours() * 60 + n.getMinutes() : -1;
  const done = (y) => st === 'done' || y.state === 'done';
  const cur = ys.find((y) => !done(y) && y.start <= now && now < y.end);
  const auto = ui.agAuto === b.id;
  const open = ui.agOpen?.[b.id] ?? auto;
  const nDone = ys.filter(done).length;
  const strip = `<div class="ag-strip">${ys.map((y) => `<button type="button" class="ag-sg${done(y) ? ' done' : ''}${y.travel ? ' trv' : ''}${y === cur ? ' cur' : ''}" style="flex:${Math.max(1, y.end - y.start)}" data-action="ag-step" data-block="${esc(b.id)}" data-step="${esc(y.id)}" title="${esc(`${stepName(y)} · ${fmtTime(y.start)}`)}" aria-label="${esc(stepName(y))}" ${st ? 'disabled' : ''}></button>`).join('')}</div>`;
  const head = `<div class="ag-sh"><button type="button" class="ag-stog" data-action="ag-steps" data-id="${esc(b.id)}" aria-expanded="${open}">▤ ${esc(t('agStepsN', nDone, ys.length))} ${open ? '▾' : '›'}</button>${!open && cur ? `<span class="ag-scur">${esc(t('agStepNow', stepName(cur)))}</span>` : ''}${open && auto ? `<span class="ag-sauto">${esc(t('agStepsNowTag'))}</span>` : ''}</div>`;
  const list = open ? `<div class="ag-sl">${ys.map((y) => `<label class="ag-st${done(y) ? ' done' : ''}${y.travel ? ' trv' : ''}${y === cur ? ' cur' : ''}"><input type="checkbox" data-action="step-done" data-block="${esc(b.id)}" data-step="${esc(y.id)}" ${done(y) ? 'checked' : ''} ${st ? 'disabled' : ''}><span class="ag-stn">${y.travel ? (MODE_ICON[y.mode] || '🚶') + ' ' : ''}${esc(stepName(y))}</span><small>${esc(fmtTime(y.start))} · ${esc(fmtDur(y.end - y.start))}</small></label>`).join('')}</div>` : '';
  return `<div class="ag-steps">${strip}${head}${list}</div>`;
}
const gapRow = (date, start, min) => {
  const pick = (ui.pickBlock && get('blocks', ui.pickBlock)) || (ui.pick && get('tasks', ui.pick)); // (v56) something picked: where it fits lights up (v70: or a block being moved)
  const fits = pick && (pick.minutes || 30) <= min;
  return `<li class="ag-gap${pick ? (fits ? ' fits' : ' nofit') : ''}"><button type="button" data-action="ag-gap" data-date="${date}" data-start="${start}" data-min="${min}"><span class="ag-time">${esc(fmtTime(start))}</span><span>${esc(t('agFree', fmtDur(min)))} · <u>${esc(fits ? t('agHere') : pick ? t('agHereShort') : t('agFits'))}</u></span></button></li>`;
};
// (v78) For the Planner tab: how much is still to plan, and today's blocks left behind (their time is
// over and they have no Esito: not done, not "couldn't").
export function behindToday() {
  const td = today(); const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
  return blocksOn(td).filter((b) => !outcomeOf(b) && !b.stepId && !(b.kind === 'prep' && b.parentId) && !(b.startedAt && !b.endedAt) && b.start + (b.minutes || 0) <= nm)
    .sort((a, b) => a.start - b.start);
}
export function planCounts() {
  const td = today();
  // (v82) and the conflicts from today to the end of the week
  let conflicts = 0; for (let d = td; d <= weekEndOf(td); d = addDays(d, 1)) conflicts += conflictsOn(d).length;
  return { toPlan: trayTasks().length + toFix(td, weekEndOf(td)).length, behind: behindToday().length, conflicts };
}
// (v94) «Com'è andata?»: from 21:00, or once the last thing of the day is over, every block of today without an
// Esito (✓ / ✕ / domani, or all at once); once all are marked, «Tutto segnato» and what's tomorrow.
export function eveningMode(date = today()) {
  if (date !== today()) return false;
  const n = new Date(); const now = n.getHours() * 60 + n.getMinutes();
  const bl = blocksOn(date).filter((b) => !b.stepId && !(b.kind === 'prep' && b.parentId));
  if (!bl.length) return false;
  if (now >= 21 * 60) return true;
  return ![...bl, ...timedEventsOn(date).filter((e) => !e.skipped)].some((x) => x.start + (x.minutes || 0) > now);
}
export const unmarkedToday = () => blocksOn(today()).filter((b) => !outcomeOf(b) && !b.stepId && !(b.kind === 'prep' && b.parentId) && !(b.startedAt && !b.endedAt)).sort((a, b) => a.start - b.start);
function eveningCard(date) {
  const list = unmarkedToday();
  const tm = addDays(date, 1);
  const tmr = [...blocksOn(tm).filter((b) => !b.stepId && !(b.kind === 'prep' && b.parentId)), ...timedEventsOn(tm).filter((e) => !e.skipped)].sort((a, b) => a.start - b.start);
  const tLine = `<p class="ev-tmr">🌙 ${esc(t('evTomorrow'))} ${tmr.length ? `<b>${esc(fmtTime(tmr[0].start))} ${esc(tmr[0].title)}</b>${tmr.length > 1 ? ` · ${esc(t('evMore', tmr.length - 1))}` : ''}` : esc(t('evTmrFree'))}</p>`;
  if (!list.length) return `<div class="behind-card evening all"><b>✓ ${esc(t('evAllMarked'))}</b>${tLine}</div>`;
  return `<div class="behind-card evening"><b>🌙 ${esc(t('evTitle'))}</b><small>${esc(t('evSub', list.length))}</small><ul>${list.map((b) => `<li><span><b>${esc(fmtTime(b.start))}</b> ${esc(b.title)}</span><span class="behind-acts"><button class="icon ok" type="button" data-action="behind-done" data-id="${esc(b.id)}" aria-label="${esc(t('esDone'))}" title="${esc(t('esDone'))}">✓</button><button class="icon" type="button" data-action="behind-fail" data-id="${esc(b.id)}" aria-label="${esc(t('esFail'))}" title="${esc(t('esFail'))}">✕</button><button class="btn small" type="button" data-action="behind-tmr" data-id="${esc(b.id)}">→ ${esc(t('tomorrow'))}</button></span></li>`).join('')}</ul>
    <div class="ev-all"><button class="btn small" type="button" data-action="behind-all-done">✓ ${esc(t('evAllDone'))}</button><button class="btn small" type="button" data-action="behind-all-tmr">→ ${esc(t('evAllTmr'))}</button></div>${tLine}</div>`;
}
export const behindCard = (date) => { // (v81) also on Oggi
  if (date !== today()) return '';
  if (eveningMode(date)) return eveningCard(date);
  const list = behindToday(); if (!list.length) return '';
  return `<div class="behind-card"><b>⏰ ${esc(t('behindTitle', list.length))}</b><small>${esc(t('behindSub'))}</small><ul>${list.map((b) => `<li><span><b>${esc(fmtTime(b.start))}</b> ${esc(b.title)}</span><span class="behind-acts"><button class="icon ok" type="button" data-action="behind-done" data-id="${esc(b.id)}" aria-label="${esc(t('esDone'))}" title="${esc(t('esDone'))}">✓</button><button class="icon" type="button" data-action="behind-fail" data-id="${esc(b.id)}" aria-label="${esc(t('esFail'))}" title="${esc(t('esFail'))}">✕</button><button class="btn small" type="button" data-action="behind-later" data-id="${esc(b.id)}">→ ${esc(t('behindLater'))}</button></span></li>`).join('')}</ul></div>`;
};
// (v74–v76) What takes time on the agenda: an invitation you're not going to doesn't, nor an event shown as
// free in Google, nor a block that may overlap anything; a proposal does.
const isBehind = (b) => { if (b.date !== today() || outcomeOf(b) || (b.startedAt && !b.endedAt)) return false; const n = new Date(); return b.start + (b.minutes || 0) <= n.getHours() * 60 + n.getMinutes(); };
const takesTime = (it) => !(it.k === 'event' && (it.e.skipped || it.e.busy === false)) && !(it.k === 'block' && roomy(it.b));
// (v76) Boxes: a block or event of 2 hours or more holds the things that fall wholly inside it.
function boxItems(items) {
  const inner = new Set(); const out = [];
  for (const it of items) {
    if (inner.has(it)) continue;
    const end = it.start + it.minutes;
    if ((it.k === 'block' || it.k === 'event') && (it.minutes >= 120 || (it.k === 'block' && roomy(it.b)))) {
      const kids = items.filter((x) => x !== it && !inner.has(x) && x.start >= it.start && x.start + x.minutes <= end && x.minutes < it.minutes);
      if (kids.length || (it.k === 'block' && roomy(it.b))) { for (const k of kids) inner.add(k); out.push({ ...it, inner: kids }); continue; } // (v95) a roomy block is a box even when empty
    }
    out.push(it);
  }
  return out.filter((x) => !inner.has(x));
}
// The rows of a stretch of the day: its things in time order, and the free stretches between them.
function rowsFor(list, from, to, gaps, date, from0) {
  const rows = []; const free = []; let cur = from;
  for (const it of list) {
    if (!it.inner && !takesTime(it)) continue;
    if (gaps && it.start - cur >= 30 && cur < to) free.push({ start: cur, min: Math.min(it.start, to) - cur });
    cur = Math.max(cur, it.start + it.minutes);
  }
  if (gaps && to - cur >= 30) free.push({ start: cur, min: to - cur });
  let fi = 0;
  for (const it of list) {
    while (fi < free.length && free[fi].start <= it.start) { rows.push(gapRow(date, free[fi].start, free[fi].min)); fi++; }
    rows.push(it.inner ? boxHtml(it, gaps, date, from0) : agRow(it));
  }
  while (fi < free.length) { rows.push(gapRow(date, free[fi].start, free[fi].min)); fi++; }
  return rows;
}
function boxHtml(it, gaps, date, from0) {
  const id = it.k === 'block' ? it.b.id : it.e.id;
  const color = it.k === 'block' ? catColor(it.b.category) || 'var(--accent)' : it.e.color || 'var(--muted)';
  const end = it.start + it.minutes; const open = !ui.boxFold?.has(id);
  const room = it.k === 'block' && !outcomeOf(it.b) ? roomOf(it.b) : null;
  const head = agRow({ ...it, inner: null }) + (room ? `<li class="ag-room"><span>⊕ ${esc(room.max ? t('roomTagMax', fmtDur(roomUsed(it.b)) || '0m', fmtDur(room.max)) : t('roomTag'))}</span></li>` : '');
  const inner = open ? rowsFor(it.inner, from0(it.start), end, gaps && !takesTime(it), date, from0).join('') : '';
  const sum = it.inner.map((x) => `${x.k === 'block' ? x.b.title : x.k === 'event' ? x.e.title : x.k === 'ghost' ? ghostTitle(x.g) : x.g.title} ${fmtTime(x.start)}`).join(' · ');
  return `<li class="ag-box${open ? '' : ' shut'}${room ? ' roomy' : ''}" style="--c:${esc(color)}"><ul class="ag-box-l">${head}${inner}</ul>
    <div class="ag-box-end"><span>${esc(open ? t('boxEnd', fmtTime(end % 1440)) : sum)}</span><button type="button" class="link" data-action="box-fold" data-id="${esc(id)}" aria-expanded="${open}">${esc(open ? t('boxClose') : t('boxOpen', it.inner.length))}</button></div></li>`;
}
// (v92) What's set for «in giornata» on this day (on today also what was left from the days before) and isn't on
// the plan yet: a band on top, each with its first free time, and one tap to place them all.
export function onDayTasks(date) {
  const td = today(); const planned = plannedTaskIds();
  return openTasks().filter((x) => x.onDay && (x.onDay === date || (date === td && x.onDay < td)) && !planned.has(x.id) && !x.travelRole);
}
export function dayBand(date) {
  if (date < today()) return '';
  const list = onDayTasks(date); if (!list.length) return '';
  const tot = list.reduce((n, x) => n + (x.minutes || 30), 0);
  return `<section class="od-band" aria-label="${esc(t('odTitle', list.length))}"><div class="od-h"><b>📌 ${esc(t(date === today() ? 'odTitle' : 'odTitleOn', list.length, relDay(date)))}</b><span>${esc(fmtDur(tot))}</span></div>
    ${list.map((x) => { const o = slotOptions(x, date, 1)[0]; return `<div class="od-row"><span class="od-t"><b>${esc(x.title)}</b><small>${esc([fmtDur(x.minutes || 30), x.onDay < date ? t('odFrom', relDay(x.onDay)) : '', x.place ? `📍 ${x.place.split(',')[0]}` : ''].filter(Boolean).join(' · '))}</small></span>
      ${o ? `<button class="btn small primary" type="button" data-action="plan-task" data-id="${esc(x.id)}" data-date="${date}" data-start="${o.start - leadOf(x)}">${esc(fmtTime(o.start))}</button>` : `<small class="hint">${esc(t('noFreeSlotDay'))}</small>`}<button class="btn small" type="button" data-action="task-edit" data-id="${esc(x.id)}">${esc(t('otherTime'))}</button></div>`; }).join('')}
    ${list.length > 1 ? `<div class="button-row left"><button class="btn small primary" type="button" data-action="od-all" data-date="${date}">${esc(t('odAll'))}</button></div>` : ''}</section>`;
}
export function agendaDay(date) {
  prepareDays([date]);
  ui.agAuto = autoStepsBlock(date);
  const td = today();
  const allDay = eventsOn(date).filter((e) => e.allDay);
  const items = agItems(date);
  const [h0, h1] = autoHoursFor(date);
  const now = new Date(); const nowM = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
  const gaps = date >= td;
  const from0 = (st) => (date === td ? Math.max(st, nowM) : st);
  // (v76) a long block or event with other things inside is a box that holds them (its free time inside
  // too, when it lets other things happen); the rest of the day around it as before
  // (v97) today: what's done (and over) folds into one line, until you open it
  const nmin = now.getHours() * 60 + now.getMinutes();
  const doneIt = date === td && !ui.agDone ? items.filter((it) => it.k === 'block' && outcomeOf(it.b) === 'done' && it.start + it.minutes <= nmin) : [];
  const shown = items.filter((it) => !doneIt.includes(it));
  const top = boxItems(shown);
  const rows = rowsFor(top, from0(h0), h1, gaps, date, from0);
  const fold = doneIt.length ? `<button type="button" class="agn-fold" data-action="sc-agdone">✓ ${esc(t('agnDoneN', doneIt.length))} <small>${esc(doneIt.map((it) => it.b.title).join(' · '))}</small> ▸</button>`
    : date === td && ui.agDone ? `<button type="button" class="agn-fold" data-action="sc-agdone">${esc(t('agnFoldDone'))} ▴</button>` : '';
  return `${planCard()}${nowCard(date)}${dayBand(date)}${behindCard(date)}${conflictBanner(date)}
    ${allDay.length ? `<div class="allday">${allDay.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>` : ''}
    ${items.length ? '' : `<p class="empty ag-empty">${esc(t('agEmpty'))}</p>`}${fold}
    <ul class="agenda">${rows.join('')}</ul>`;
}
// (v97) The Agenda answers «what do I do now?»: on today, the thing running on top (time left, its checklist,
// ✓ / timer / +15 min / ✕) and what's next, with how long until it starts.
export function nowCard(date) {
  if (date !== today()) return '';
  const n = new Date(); const nm = n.getHours() * 60 + n.getMinutes();
  const bl = blocksOn(date).filter((b) => !b.stepId && !(b.kind === 'prep' && b.parentId) && !roomy(b) && !outcomeOf(b));
  const cur = bl.filter((b) => b.start <= nm && nm < b.start + b.minutes).sort((a, b) => b.start - a.start)[0];
  const nextB = [...bl.filter((b) => b.start > nm), ...timedEventsOn(date).filter((e) => !e.skipped && e.busy !== false && e.start > nm)].sort((a, b) => a.start - b.start)[0];
  if (!cur && !nextB) return '';
  const nx = nextB ? `<div class="agn-next"><span><small>${esc(t(cur ? 'agnThen' : 'agnNext', fmtTime(nextB.start)))}</small><b>${esc(nextB.title)}</b></span><span class="agn-in">${esc(t('agnIn', fmtDur(nextB.start - nm)))}</span></div>` : '';
  if (!cur) return `<div class="agn">${nx}</div>`;
  const end = cur.start + cur.minutes; const cl = checklistOf(cur); const ck = cur.checked || [];
  const running = cur.startedAt && !cur.endedAt;
  return `<div class="agn"><div class="agn-card" style="--c:${esc(catColor(cur.category) || 'var(--accent)')}"><div class="agn-k">${esc(t('agnNow', fmtTime(end)))}</div>
    <button type="button" class="agn-t" data-action="open-block" data-id="${esc(cur.id)}">${cur.taskId ? taskIcon(get('tasks', cur.taskId)) : ''}${esc(cur.title)}</button><small>${esc(t('agnLeft', fmtTime(cur.start), fmtDur(end - nm)))}</small>
    <div class="agn-bar"><i style="width:${Math.round(((nm - cur.start) / Math.max(1, cur.minutes)) * 100)}%"></i></div>
    ${cl.length ? `<div class="agn-cl">${cl.map((c, i) => `<label><input type="checkbox" data-ci="${i}" data-block="${esc(cur.id)}" ${ck[i] ? 'checked' : ''}> <span>${esc(c)}</span></label>`).join('')}</div>` : ''}
    <div class="agn-row"><button class="btn small primary" type="button" data-action="now-done" data-id="${esc(cur.id)}">✓ ${esc(t('esDone'))}</button>${running ? '' : `<button class="btn small" type="button" data-action="now-start" data-id="${esc(cur.id)}">⏱ ${esc(t('agnTimer'))}</button>`}<button class="btn small" type="button" data-action="sc-ext" data-id="${esc(cur.id)}">+15 min</button><button class="btn small ghost" type="button" data-action="block-fail" data-id="${esc(cur.id)}">✕ ${esc(t('esFail'))}</button></div></div>${nx}</div>`;
}
// (v97) For the side pane on a wide screen (all three looks): ✦ Pianifica and this day's warnings, each with its fix.
export function paneWarnings(date) {
  const td = today(); const conflicts = conflictsOn(date); const late = date === td ? behindToday() : [];
  const cf = conflicts.map((c, i) => `<li class="pw-item red"><span>⚠ ${esc(conflictText(c))}</span><span class="pw-acts">${(c.type !== 'late' || (get('tasks', get('blocks', c.ids[0])?.taskId)?.due || '') >= td) && !(c.type === 'closed' && isEvent(get('tasks', get('blocks', c.ids[0])?.taskId))) ? `<button class="btn small primary" type="button" data-action="fix" data-date="${date}" data-i="${i}">${esc(t('fix'))}</button>` : ''}${c.type === 'overlap' || c.type === 'closed' ? `<button class="btn small" type="button" data-action="allow" data-date="${date}" data-i="${i}">${esc(t('sc_leave'))}</button>` : ''}</span></li>`).join('');
  const lt = late.map((b) => `<li class="pw-item yel"><span>⏰ ${esc(t('pwLate', b.title, fmtTime(b.start)))}</span><span class="pw-acts"><button class="btn small primary" type="button" data-action="behind-done" data-id="${esc(b.id)}">✓</button><button class="btn small" type="button" data-action="behind-fail" data-id="${esc(b.id)}">✕</button><button class="btn small" type="button" data-action="behind-tmr" data-id="${esc(b.id)}">→ ${esc(t('tomorrow'))}</button></span></li>`).join('');
  const n = conflicts.length + late.length;
  return `<div class="pw"><button class="btn primary pw-plan" type="button" data-action="ag-plan">✦ ${esc(t('smartTitle'))}</button>
    <div class="field-label">${esc(t('pwTitle'))} <small>${n || ''}</small></div>${n ? `<ul class="pw-list">${cf}${lt}</ul>` : `<p class="hint">✓ ${esc(t('pwNone'))}</p>`}</div>`;
}
export function agendaWeek(date) {
  const td = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  prepareDays(days.filter((d) => d >= td).length ? days : [days[0]]);
  return `${planCard()}<ul class="ag-week">${days.map((d) => {
    const items = agItems(d); const ad = eventsOn(d).filter((e) => e.allDay);
    const chips = [...ad.map((e) => `<span class="ag-chip ev">${esc(e.title)}</span>`), ...items.slice(0, 5).map((it) => { const title = it.k === 'block' ? it.b.title : it.k === 'event' ? it.e.title : it.k === 'ghost' ? ghostTitle(it.g) : it.g.title; return `<span class="ag-chip${it.k === 'ghost' || it.k === 'fix' ? ' ghost' : ''}" style="--c:${esc(catColor(it.b?.category || it.g?.category) || 'var(--accent)')}"><b>${esc(fmtTime(it.start))}</b> ${esc(title)}</span>`; })];
    if (items.length > 5) chips.push(`<span class="ag-chip more">+${items.length - 5}</span>`);
    return `<li><button type="button" class="ag-day${d === td ? ' is-today' : ''}${d < td ? ' past' : ''}" data-action="view-day" data-id="${d}">
      <span class="ag-dn"><small>${esc(fmtDay(d, { weekday: 'short' }))}</small><b>${parseDate(d).getDate()}</b></span>
      <span class="ag-dc">${loadBar(d)}<span class="ag-chips">${chips.join('') || `<small class="hint">${esc(t('agWeekFree'))}</small>`}</span></span></button></li>`;
  }).join('')}</ul>`;
}
// "What fits?": the things still to plan that fit in a free stretch; one tap plans it there.
export function openGapFits(date, start, min) {
  const fits = (x) => (x.minutes || 30) <= min;
  const list = trayTasks().filter(fits);
  // (v70) routines too: this day's turns still without a time, then "N times a week" and "quando capita"
  const turns = toFix(date, date).filter((r) => r.date === date && fits(r.x)).map((r) => r.x);
  const tIds = new Set(turns.map((x) => x.id));
  const others = routines().filter((x) => !x.archived && !isMealTask(x) && fits(x) && !tIds.has(x.id) && (x.repeat === 'times' ? timesLeft(x, date) > 0 : !hasRhythm(x)));
  const opt = (value, title, sub) => `<button class="add-opt" value="${esc(value)}"><span class="item-text">${esc(title)}<small>${esc(sub)}</small></span></button>`;
  const any = list.length || turns.length || others.length;
  openModal(`<h2>${esc(t('agFitsTitle', fmtDur(min), fmtTime(start)))}</h2><p class="hint">${esc(relDay(date))}</p>
    ${list.length ? `<div class="field-label">${esc(t('fdGrpTasks'))}</div><div class="add-opts">${list.map((x) => opt(`t:${x.id}`, x.title, trayInfo(x))).join('')}</div>` : ''}
    ${turns.length ? `<div class="field-label">${esc(t('fitsToday'))}</div><div class="add-opts">${turns.map((x) => opt(`o:${x.id}`, `↻ ${x.title}`, `${fmtDur(x.minutes || 30)} · ${t('fitsTurn')}`)).join('')}</div>` : ''}
    ${others.length ? `<div class="field-label">${esc(t('fitsOther'))}</div><div class="add-opts">${others.map((x) => opt(`r:${x.id}`, `↻ ${x.title}`, `${fmtDur(x.minutes || 30)} · ${x.repeat === 'times' ? t('timesLeftN', timesLeft(x, date)) : t('wm_anytime')}`)).join('')}</div>` : ''}
    ${any ? '' : `<p class="hint">${esc(t('agNothingFits'))}</p>`}
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('close'))}</button></div>`, (form, action) => {
    const [k, id] = [action.slice(0, 1), action.slice(2)];
    const x = get('tasks', id); if (!x) return;
    setTimeout(() => placeItem(x, date, start, { occ: k === 'o' ? date : null }), 0);
  }, { cls: 'sheet' });
}
