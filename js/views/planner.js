// views/planner.js: moved from app.js (v36). See app.js for how the modules fit together.
import { catColor, esc, fmtDay, hint, PPM, range, reasonText, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isEvent } from '../kinds.js';
import { alreadyPlanned, autoApply, autoChecks, blocksOn, blockTimeText, checklistLeft, checklistOf, checkMissed, conflictsOn, conflictText, eventsOn, ISSUE_SEC, issueText, linkFor, nextPlanned, outcomeOf, partsLeft, plannedWhen, prereqsOf, splitsSteps, stepTimes, taskDayOf, taskIssues, timedEventsOn, timesLeft } from '../model.js';
import { addDays, dateStr, dayTotals, fmtDur, fmtTime, importanceOf, layoutBlocks, parseDate, sortTasks, today, weekday } from '../plan.js';
import { autoHoursFor, hoursShort, inRange, loadOf, selecting, spreadLabel, trayTasks } from '../planning.js';
import { currentDate } from '../shell.js';
import { matchesQ } from '../shoplist.js';
import { get, live, state } from '../store.js';
import { watchMonth } from '../sync.js';
import { MODE_ICON } from '../travel.js';
import { searchBox, windowsText } from '../widgets.js';
import { DATE_GROUPS, dateBuckets, filterBar, sortPicker, sortTaskList, taskFilter, taskGroupsCfg, taskHay } from './tasks.js';

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
    const totals = dayTotals(blocksOn(date));
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
  const head = `
  <div class="plan-top">
    <div class="view-switch" role="tablist">${VIEWS.map((k) => `<button type="button" role="tab" class="${k === v ? 'on' : ''}" data-action="view" data-id="${k}" aria-selected="${k === v}">${esc(t(`v_${k}`))}</button>`).join('')}</div>
    ${v === 'day' ? `<button class="steps-switch" type="button" role="switch" data-action="toggle-steps" aria-checked="${showSteps()}" aria-pressed="${showSteps()}" title="${esc(t(showSteps() ? 'hideSteps' : 'showSteps'))}"><span class="sw" aria-hidden="true"></span>${esc(t('steps'))}</button>` : ''}
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
  <div class="day-actions">
    ${showToday ? `<a class="btn small" href="#/plan/${td}">${esc(t('today'))}</a>` : ''}
    <button class="btn small primary" type="button" data-action="auto">✦ ${esc(t('planBtn'))}</button>
    <button class="btn small" type="button" data-action="add-menu">＋ ${esc(t('addMenu'))}</button>
  </div>`;
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
      ${c.type !== 'late' || (get('tasks', get('blocks', c.ids[0])?.taskId)?.due || '') >= td ? `<button class="btn small" type="button" data-action="fix" data-date="${date}" data-i="${i}">${esc(t('fix'))}</button>` : ''}
      ${c.type === 'overlap' ? `<button class="btn small ghost" type="button" data-action="allow" data-date="${date}" data-i="${i}">${esc(t('fine'))}</button>` : ''}</li>`).join('')}</ul>` : ''}
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
  return `
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
  const isEv = Boolean(b.taskId && isEvent(get('tasks', b.taskId)));
  return `<div class="block${stepsIn ? ' with-steps' : ''}${status ? ` ${status}` : ''}${status === 'failed' ? ' done' : ''}${short ? ' short' : ''}${conflict ? ' conflict' : ''}${b.kind ? ` k-${b.kind}` : ''}${isEv ? ' own-event' : ''}" data-id="${esc(b.id)}" data-start="${b.start}" data-minutes="${b.minutes}"
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
  return `<div class="block event${e.busy === false ? ' free' : ''}${e.minutes < 30 ? ' short' : ''}${conflict ? ' conflict' : ''}" data-id="${esc(e.id)}"
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
      ${all.length && !a.ghosts.length ? (sel.length ? `<button class="btn primary spread" type="button" data-action="assign-spread">✦ ${esc(t('spreadSel', spreadLabel()))}</button>` : `<button class="btn primary spread" type="button" data-action="auto">✦ ${esc(t('planBtn'))}</button>`) : ''}
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
    ${gs.map((g) => `<div class="why-row" style="--c:${esc(catColor(get('tasks', g.taskId)?.category) || 'var(--accent)')}"><span class="why-time">${esc(fmtTime(g.start))}</span><span class="why-main"><span class="why-title">${esc(ghostTitle(g))}</span><small class="why-line">${esc([fmtDur(g.minutes), ghostWhy(g)].filter(Boolean).join(' · '))}</small></span><button type="button" class="icon why-x" data-action="ghost-rm" data-i="${g.i}" aria-label="${esc(t('takeBack', ghostTitle(g)))}">✕</button></div>`).join('')}`).join('');
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
  return `<div class="block ghost assign${short ? ' short' : ''}" data-action="ghost-rm" data-i="${g.i}" data-start="${g.start - (g.lead || 0)}" data-minutes="${g.minutes + (g.lead || 0)}" title="${esc(ghostTip(g))}" style="--c:${esc(catColor(task?.category) || 'var(--accent)')};top:${(g.start - (g.lead || 0) - startMin) * P}px;height:${Math.max((g.minutes + (g.lead || 0)) * P, 16)}px;left:1px;right:3px">
    <div class="blk-body"><div class="blk-title">${esc(ghostTitle(g))} <span class="ghost-x">✕</span></div><div class="blk-time">${range(g.start, g.minutes)}</div>${ghostWhy(g) && !short ? `<div class="blk-why">✦ ${esc(ghostWhy(g))}</div>` : ''}</div></div>`;
}
