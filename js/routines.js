// Routine (v53): the things that come back (chores, the school run, workouts, meals), read by the week.
// A routine is a saved task or meal type, or a to-do that repeats; the travel legs are not (they live
// in Settings → Travel). Each one shows its seven days: done, planned, to fix, skipped, paused, missed.
// Opening one shows its recent weeks and what you adjust from time to time: the rhythm, a period
// ("until 30 June"), pauses (the school holidays), skipping a day of this week.
import { catName, esc, fmtDay, relDay, toast, ui } from './core.js';
import { getLang, t } from './i18n.js';
import { isMealType, isSaved, isTodo } from './kinds.js';
import { countedOf, ensureSeries, isEnded, turnCounts } from './model.js';
import { setCounts } from './placing.js';
import { addDays, fmtDur, fmtTime, inPause, isOccurrence, parseDate, REPEATS, ruleAt, today } from './plan.js';
import { changed } from './shell.js';
import { get, live, remove, upsert } from './store.js';
import { ricetteConfigured } from './sync.js';
import { weekStart } from './views/planner.js';
import { dayShort, openModal, repeatText } from './widgets.js';
import { dayLenSummary, openPlanSaved, openTask } from './editors.js';
import { isPalestra, PALESTRA_APP } from './palestra.js';

export const isRoutine = (x) => Boolean(x && !x.deleted && !x.done && !x.travelRole && !x.palOut && (isSaved(x) || (isTodo(x) && x.repeat)) && !isEnded(x));
// (v69) Routines that have ended (a date or N turns): kept, listed apart as "Concluse".
export const endedRoutines = () => live('tasks').filter((x) => x && !x.deleted && !x.travelRole && (isSaved(x) || isTodo(x)) && isEnded(x));
// Workouts deleted in Palestra (v54): kept for their history, listed apart, never planned again.
export const isArchived = (x) => Boolean(x?.archived || x?.palOut); // (v74) or a workout outside Palestra's active plan
export const hasRhythm = (x) => Boolean((x?.repeat && (REPEATS.includes(x.repeat) || x.repeat === 'times')) || REPEATS.includes(x?.next?.repeat));
export const routines = () => live('tasks').filter(isRoutine);
const timesWeekly = (x) => x.repeat === 'times' && (x.timesPer || 'week') === 'week';

const outcomeOf = (b) => b.outcome || (b.done ? 'done' : null);
function blocksByDate(id) {
  const m = new Map();
  for (const b of live('blocks')) if (b.taskId === id && b.kind !== 'prep') { if (!m.has(b.date)) m.set(b.date, []); m.get(b.date).push(b); }
  return m;
}
// One day of a routine: done · part · planned · missed · fix · skip · pause · due ('' = nothing that day).
export function dayState(x, d, blocks = blocksByDate(x.id), td = today()) {
  const bs = blocks.get(d) || [];
  if (bs.length) {
    const o = bs.map(outcomeOf);
    if (o.includes('done')) return 'done';
    if (o.includes('partial')) return 'part';
    if (d < td || o.every(Boolean)) return 'missed';
    return 'planned';
  }
  const r = ruleAt(x, d);
  if (!REPEATS.includes(r.repeat) || !isOccurrence(x, d) || (x.repeatUntil && d > x.repeatUntil)) return '';
  if ((x.skipped || []).includes(d)) return 'skip';
  if (inPause(x, d)) return 'pause';
  if (d < td) return 'missed';
  return r.pickTime ? 'fix' : 'due';
}
export const weekStates = (x, ws, blocks = blocksByDate(x.id)) => [0, 1, 2, 3, 4, 5, 6].map((i) => dayState(x, addDays(ws, i), blocks));
const PLACED = ['done', 'part', 'planned'];

// How the week is going: what should happen, what is in place, what still needs a time.
export function weekInfo(list, ws) {
  let expected = 0; let placed = 0; let fix = 0;
  const td = today();
  for (const x of list) {
    if (!hasRhythm(x)) continue;
    const st = weekStates(x, ws);
    if (x.repeat === 'times') {
      if (!timesWeekly(x)) continue;
      const n = Math.max(1, Number(x.timesN) || 1); const have = st.filter((s) => PLACED.includes(s)).length;
      expected += n; placed += Math.min(n, have); if (addDays(ws, 6) >= td) fix += Math.max(0, n - have);
      continue;
    }
    for (const s of st) {
      if (!s || s === 'skip' || s === 'pause') continue;
      expected++;
      if (PLACED.includes(s)) placed++;
      if (s === 'fix') fix++;
    }
  }
  return { expected, placed, fix };
}

const cell = (s, d) => `<span class="rt-c${s ? ` rt-${s}` : ''}" title="${esc(`${fmtDay(d, { weekday: 'short', day: 'numeric' })}${s ? `: ${t(`st_${s}`)}` : ''}`)}"></span>`;
function strip(x, ws, blocks) {
  const st = weekStates(x, ws, blocks);
  const said = st.map((s, i) => (s ? `${dayShort(i + 1)} ${t(`st_${s}`)}` : '')).filter(Boolean).join(', ');
  return `<span class="rt-strip" role="img" aria-label="${esc(said || t('rtNothingWeek'))}">${st.map((s, i) => cell(s, addDays(ws, i))).join('')}</span>`;
}
export function pausedUntil(x, d = today()) { const p = (x.pauses || []).find((q) => q.from <= d && (!q.to || d <= q.to)); return p ? (p.to || '') : null; }
function rhythmText(x) {
  if (x.repeat === 'times') return t('rtTimesN', Math.max(1, Number(x.timesN) || 1), x.timesPer || 'week');
  return repeatText(x);
}
function metaOf(x, ws) {
  const bits = [];
  const r = rhythmText(x); if (r) bits.push(r);
  const time = x.pickTime ? '' : x.seriesTime != null ? fmtTime(x.seriesTime) : x.defaultStart != null ? fmtTime(x.defaultStart) : x.when && x.when !== 'any' ? t(`when_${x.when}`) : '';
  if (time) bits.push(time);
  bits.push(fmtDur(x.minutes || 30));
  if (timesWeekly(x)) { const have = weekStates(x, ws).filter((s) => PLACED.includes(s)).length; bits.push(t('rtOfWeek', have, Math.max(1, Number(x.timesN) || 1))); }
  const p = pausedUntil(x);
  if (p !== null) bits.push(p ? t('rtPausedUntil', relDay(p)) : t('rtPausedOpen'));
  return bits.join(' · ');
}
const planBtn = (x) => `<button class="icon saved-plan" type="button" data-action="saved-plan" data-id="${esc(x.id)}" aria-label="${esc(t('planSaved', x.title))}" title="${esc(t('planSaved', x.title))}">▶</button>`;
export function routineRow(x, ws = ui.routineWeek || weekStart(today())) {
  if (x.archived) {
    const n = live('blocks').filter((b) => b.taskId === x.id && (b.outcome === 'done' || b.done)).length;
    return `<li class="rt-row archived"><button class="task-main" type="button" data-action="routine-open" data-id="${esc(x.id)}"><span class="item-text">${esc(x.title)}<small>${esc(t('rtArchivedMeta', n))}</small></span></button></li>`;
  }
  const rhythm = hasRhythm(x) || isMealType(x);
  const paused = pausedUntil(x) !== null;
  return `<li class="rt-row${paused ? ' paused' : ''}"><button class="task-main" type="button" data-action="routine-open" data-id="${esc(x.id)}"><span class="item-text">${isMealType(x) ? '🍽 ' : ''}${esc(x.title)}<small>${esc(metaOf(x, ws))}</small></span>${rhythm ? strip(x, ws, blocksByDate(x.id)) : ''}</button>${!hasRhythm(x) ? planBtn(x) : ''}</li>`;
}

// The groups: areas (the first category) for routines with a rhythm, then meals, then the ones without.
export function routineGroups(list) {
  const areas = new Map(); const meals = []; const loose = []; const gym = []; const arch = [];
  for (const x of list) {
    if (x.archived) arch.push(x);
    else if (isPalestra(x)) gym.push(x);
    else if (isMealType(x)) meals.push(x);
    else if (!hasRhythm(x)) loose.push(x);
    else { const c = get('categories', x.category) ? x.category : ''; if (!areas.has(c)) areas.set(c, []); areas.get(c).push(x); }
  }
  const byTime = (a, b) => (a.seriesTime ?? a.defaultStart ?? 9999) - (b.seriesTime ?? b.defaultStart ?? 9999) || a.title.localeCompare(b.title);
  const out = [...areas.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || catName(get('categories', a[0])).localeCompare(catName(get('categories', b[0]))))
    .map(([c, l]) => ({ key: `rt_${c || 'none'}`, label: c ? catName(get('categories', c)) : t('noCategory'), list: l.sort(byTime) }));
  if (gym.length) out.push({ key: 'rt_pal', label: t('rtWorkouts'), from: t('rtFromPalestra'), href: PALESTRA_APP, list: gym.sort(byTime) });
  if (meals.length) out.push({ key: 'rt_meals', label: t('rtMeals'), from: ricetteConfigured() ? t('rtFromRicette') : '', list: meals.sort(byTime) });
  if (loose.length) out.push({ key: 'rt_loose', label: t('rtNoRhythm'), list: loose.sort((a, b) => a.title.localeCompare(b.title)) });
  if (arch.length) out.push({ key: 'rt_arch', label: t('rtArchived'), list: arch.sort((a, b) => a.title.localeCompare(b.title)) });
  return out;
}
// "Nov 2–8" in English, "2–8 nov" in Italian and German; across months "Oct 26 – Nov 1", "26 ott – 1 nov".
export function weekLabel(ws) {
  const we = addDays(ws, 6); const lang = getLang();
  const d = (x) => String(parseDate(x).getDate());
  const m = (x) => new Intl.DateTimeFormat(lang, { month: 'short' }).format(parseDate(x));
  const same = ws.slice(5, 7) === we.slice(5, 7);
  const r = lang === 'en' ? (same ? `${m(ws)} ${d(ws)}–${d(we)}` : `${m(ws)} ${d(ws)} – ${m(we)} ${d(we)}`)
    : (same ? `${d(ws)}–${d(we)} ${m(we)}` : `${d(ws)} ${m(ws)} – ${d(we)} ${m(we)}`);
  return t('rtWeek', r);
}
export function weekHeader(list, ws) {
  const { expected, placed, fix } = weekInfo(list, ws);
  const cur = weekStart(today());
  const sum = [expected ? t('rtSum', placed, expected) : '', fix ? t('rtFix', fix) : ''].filter(Boolean).join(' · ');
  return `<div class="rt-week">
    <button class="icon" type="button" data-action="routine-week" data-id="-1" aria-label="${esc(t('rtPrevWeek'))}">‹</button>
    <button class="rt-week-mid" type="button" data-action="routine-week" data-id="0" ${ws === cur ? 'disabled' : ''}><b>${esc(weekLabel(ws))}</b><small>${esc(sum || t('rtNothingWeek'))}${ws !== cur ? ` · ${esc(t('rtBackToThis'))}` : ''}</small></button>
    <button class="icon" type="button" data-action="routine-week" data-id="1" aria-label="${esc(t('rtNextWeek'))}">›</button>
  </div>
  <div class="rt-days" aria-hidden="true"><span></span><span class="rt-strip">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<span>${esc(dayShort(i).slice(0, 1).toUpperCase())}</span>`).join('')}</span></div>`;
}
export const legend = () => `<p class="rt-legend">${['done', 'planned', 'fix', 'skip', 'missed'].map((s) => `<span><span class="rt-c rt-${s}"></span>${esc(t(`st_${s}`))}</span>`).join('')}</p>`;
export function moveWeek(d) {
  const cur = weekStart(today());
  ui.routineWeek = Number(d) === 0 ? cur : addDays(ui.routineWeek || cur, 7 * Number(d));
}

// ---------- one routine ----------
function removeOpenBlocks(x, from, to = '9999-12-31') {
  const td = today();
  for (const b of live('blocks')) if (b.taskId === x.id && b.kind !== 'prep' && !outcomeOf(b) && !b.startedAt && b.date >= td && b.date >= from && b.date <= to) remove('blocks', b.id);
}
export function skipDay(x, d) {
  removeOpenBlocks(x, d, d);
  if (REPEATS.includes(x.repeat)) upsert('tasks', { ...x, skipped: [...new Set([...(x.skipped || []), d])] });
  toast(t('rtSkipped', relDay(d)));
  changed();
}
export function openRoutine(id) {
  const x = get('tasks', id); if (!x) return;
  const td = today(); const ws = weekStart(td);
  const blocks = blocksByDate(x.id);
  const weeks = [-3, -2, -1, 0].map((k) => addDays(ws, 7 * k));
  let done = 0; let due = 0;
  for (const w of weeks) for (const s of weekStates(x, w, blocks)) { if (s && s !== 'skip' && s !== 'pause' && s !== 'fix' && s !== 'due' && s !== 'planned') due++; if (s === 'done' || s === 'part') done++; }
  const grid = weeks.map((w, i) => `<div class="rt-hrow"><span>${esc(i === 3 ? t('rtThisWeek') : weekLabel(w))}</span>${strip(x, w, blocks)}</div>`).join('');
  const left = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(ws, i)).filter((d) => d >= td && ['planned', 'fix', 'due'].includes(dayState(x, d, blocks)));
  const from = x.seriesFrom || x.due || '';
  const p = (x.pauses || []).filter((q) => !q.to || q.to >= td);
  const rhythm = hasRhythm(x) && !x.archived;
  const row = (value, label, val) => `<button class="rt-set" value="${value}" formnovalidate><span>${esc(label)}</span><small>${esc(val)} ›</small></button>`;
  const cat = get('categories', x.category);
  openModal(`
    <h2>${isMealType(x) ? '🍽 ' : ''}${esc(x.title)}${isPalestra(x) ? ` <small class="rt-area">${esc(t('rtFromPalestra'))}</small>` : cat ? ` <small class="rt-area">${esc(catName(cat))}</small>` : ''}</h2>
    <div class="rt-hist">
      <div class="rt-hist-h"><b>${esc(t('rtLastWeeks'))}</b>${due ? `<small>${esc(t('rtDoneOf', done, due))}</small>` : ''}</div>
      <div class="rt-days" aria-hidden="true"><span></span><span class="rt-strip">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<span>${esc(dayShort(i).slice(0, 1).toUpperCase())}</span>`).join('')}</span></div>
      ${grid}
    </div>
    ${x.archived ? `<p class="hint">${esc(t('palArchivedNote'))}</p>` : `<div class="field-label">${esc(t('rtRhythm'))}</div>
    <div class="rt-sets">
      ${row('when', t('rtWhen'), [rhythmText(x) || t('wm_anytime'), x.pickTime ? t('rtPicked') : x.seriesTime != null ? fmtTime(x.seriesTime) : '', x.dayMinutes && Object.keys(x.dayMinutes).length ? dayLenSummary(x) : fmtDur(x.minutes || 30)].filter(Boolean).join(' · '))}
      ${rhythm ? row('period', t('rtPeriod'), x.repeatUntil ? t('rtFromTo', from ? relDay(from) : '…', relDay(x.repeatUntil)) : from ? t('rtFromOn', relDay(from)) : '') : ''}
      ${rhythm ? row('pause', t('rtPauses'), p.length ? p.map((q) => (q.to ? t('rtFromTo', relDay(q.from), relDay(q.to)) : t('rtFromOn', relDay(q.from)))).join(', ') : t('rtNoPause')) : ''}
    </div>`}
    ${x.repeatCount ? countsSection(x) : ''}
    ${left.length ? `<div class="field-label">${esc(t('rtSkipThisWeek'))}</div>
    <div class="occ-chips">${left.map((d) => `<button class="occ-chip" value="skip:${d}" formnovalidate>${esc(relDay(d))}</button>`).join('')}</div>` : ''}
    <div class="button-row">
      <button class="btn primary" value="cancel" formnovalidate>${esc(t('doneBtn'))}</button>
      ${(!rhythm || isMealType(x)) && !x.archived ? `<button class="btn" value="plan" formnovalidate>▶ ${esc(t('planIt'))}</button>` : ''}
      <button class="btn" value="more" formnovalidate>${esc(t('moreDetails'))}</button>
    </div>`, (form, action, e) => {
    const cur = get('tasks', x.id);
    if (action.startsWith('skip:')) { e.preventDefault(); skipDay(cur, action.slice(5)); openRoutine(x.id); return; }
    if (action.startsWith('cnt:')) { e.preventDefault(); const b = get('blocks', action.slice(4)); if (b) setCounts(b.id, !turnCounts(b)); openRoutine(x.id); return; }
    if (action === 'period') { e.preventDefault(); openPeriod(cur); return; }
    if (action === 'pause') { e.preventDefault(); openPause(cur); return; }
    if (action === 'when' || action === 'more') { setTimeout(() => openTask(cur), 0); return; }
    if (action === 'plan') setTimeout(() => openPlanSaved(cur, td, { stay: true }), 0);
  }, { cls: 'sheet routine' });
}
// (v69) "Per N volte": how many count so far, and every recorded turn with a pill to count it or not.
function countsSection(x) {
  const n = countedOf(x); const N = Number(x.repeatCount);
  const rec = live('blocks').filter((b) => b.taskId === x.id && b.kind !== 'prep' && !b.stepId && outcomeOf(b)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const mark = (b) => (outcomeOf(b) === 'done' ? '✓' : outcomeOf(b) === 'partial' ? '◐' : '✕');
  return `<div class="field-label">${esc(t('turnsHistory'))} <small>${esc(t('turnsOf', n, N))}${n < N ? ` · ${esc(t('turnsLeftN', N - n))}` : ''}</small></div>
    <div class="tly rt-tly">${Array.from({ length: Math.min(N, 30) }, (_, i) => `<i class="${i < n ? 'done' : ''}"></i>`).join('')}</div>
    ${rec.length ? `<ul class="rt-turns">${rec.slice(0, 30).map((b) => `<li><span class="rt-o">${mark(b)}</span><span>${esc(relDay(b.date))}</span><button class="mchip${turnCounts(b) ? ' set' : ''}" value="cnt:${esc(b.id)}" formnovalidate>${esc(turnCounts(b) ? t('countsPill') : t('notCountsPill'))}</button></li>`).join('')}</ul>` : ''}`;
}
// The period: from when, until when (optional).
function openPeriod(x) {
  openModal(`
    <h2>${esc(t('rtPeriod'))} · ${esc(x.title)}</h2>
    <div class="row tight">
      <label>${esc(t('rtStart'))}<input type="date" name="from" value="${esc(x.seriesFrom || x.due || today())}"></label>
      <label>${esc(t('repeatUntil'))}<input type="date" name="until" value="${esc(x.repeatUntil || '')}"></label>
    </div>
    <div class="button-row"><button class="btn primary" value="ok">${esc(t('save'))}</button><button class="btn ghost" value="back" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (action !== 'ok') { setTimeout(() => openRoutine(x.id), 0); return; }
    const from = form.from.value || x.seriesFrom || x.due || today(); const until = form.until.value || null;
    const nu = upsert('tasks', { ...x, seriesFrom: from, due: !x.due || x.due < from ? from : x.due, repeatUntil: until && until >= from ? until : null });
    if (nu.repeatUntil) removeOpenBlocks(nu, addDays(nu.repeatUntil, 1));
    removeOpenBlocks(nu, '0000-01-01', addDays(from, -1));
    ensureSeries(nu); changed();
    setTimeout(() => openRoutine(x.id), 0);
  }, { cls: 'sheet' });
}
// Pauses: for a few weeks, until a date, or until you resume.
function openPause(x) {
  const td = today();
  const list = (x.pauses || []).filter((q) => !q.to || q.to >= td);
  openModal(`
    <h2>${esc(t('rtPauseTitle', x.title))}</h2>
    ${list.length ? `<ul class="list">${list.map((q, i) => `<li class="pad rt-prow"><span>${esc(q.to ? t('rtFromTo', relDay(q.from), relDay(q.to)) : t('rtFromOn', relDay(q.from)))}</span><button class="btn small ghost" value="del:${i}" formnovalidate>${esc(t('rtPauseRemove'))}</button></li>`).join('')}</ul>` : ''}
    <div class="row tight">
      <label>${esc(t('rtStart'))}<input type="date" name="from" value="${td}"></label>
      <label>${esc(t('repeatUntil'))}<input type="date" name="to" value=""></label>
    </div>
    <div class="occ-chips">${[1, 2, 4].map((n) => `<button class="occ-chip" value="weeks:${n}" formnovalidate>${esc(t('rtWeeksN', n))}</button>`).join('')}</div>
    <p class="hint">${esc(t('rtPauseHint'))}</p>
    <div class="button-row"><button class="btn primary" value="ok">${esc(t('rtPauseAdd'))}</button><button class="btn ghost" value="back" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (action === 'back') { setTimeout(() => openRoutine(x.id), 0); return; }
    const all = (x.pauses || []);
    if (action.startsWith('del:')) {
      const q = list[Number(action.slice(4))];
      const nu = upsert('tasks', { ...x, pauses: all.filter((p) => p !== q) });
      ensureSeries(nu); changed(); e.preventDefault(); openPause(nu); return;
    }
    if (action.startsWith('weeks:')) { const f = form.from.value || td; form.to.value = addDays(f, 7 * Number(action.slice(6)) - 1); e.preventDefault(); return; }
    const from = form.from.value || td; const to = form.to.value && form.to.value >= from ? form.to.value : null;
    const nu = upsert('tasks', { ...x, pauses: [...all.filter((p) => !p.to || p.to >= addDays(td, -365)), { from, to }] });
    removeOpenBlocks(nu, from, to || undefined);
    ensureSeries(nu); changed();
    toast(to ? t('rtPausedUntil', relDay(to)) : t('rtPausedOpen'));
    setTimeout(() => openRoutine(x.id), 0);
  }, { cls: 'sheet' });
}
