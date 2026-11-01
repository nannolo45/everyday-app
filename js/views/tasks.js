// views/tasks.js: moved from app.js (v36). See app.js for how the modules fit together.
import { advancedOn, categories, catName, esc, hint, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isMealType, isSaved, isStep, isTodo } from '../kinds.js';
import { alreadyPlanned, eventOf, nextPlanned, offsetText, openTasks, prepOf, prereqsOf, savedGroups, savedInfo, taskIssues, templates, timesDone } from '../model.js';
import { addDays, fmtDur, fmtTime, groupTasks, importanceOf, sortTasks, today } from '../plan.js';
import { fold, matchesQ } from '../shoplist.js';
import { get, live, state } from '../store.js';
import { bufferOf, realSteps } from '../travel-plan.js';
import { MODE_ICON } from '../travel.js';
import { impBadge, issueBadge } from './planner.js';
import { SH, viewShop } from './shop.js';
import { grip, repeatText, searchBox, windowsText } from '../widgets.js';
import { daysLabel } from './settings.js';

// ---------- view: tasks ----------

// ---------- sorting tasks ----------
// "Smart" = overdue first, then importance, then due date (what the planner also weighs). "Manual" =
// your own order, dragged by hand; the auto-planner takes it into account as a preference.
export const TASK_SORTS = ['smart', 'manual', 'due', 'importance', 'length', 'category', 'added'];
export function manualOrder() {
  const open = sortTasks(openTasks(), today());
  return open.map((x, i) => ({ x, i })).sort((a, b) => (a.x.order ?? 1e9 + a.i) - (b.x.order ?? 1e9 + b.i)).map((y) => y.x);
}
export function sortTaskList(list, mode) {
  const td = today();
  const smart = sortTasks(list, td);
  const pos = new Map(smart.map((x, i) => [x.id, i]));
  const tie = (a, b) => pos.get(a.id) - pos.get(b.id);
  const by = {
    manual: (a, b) => (a.order ?? 1e9 + pos.get(a.id)) - (b.order ?? 1e9 + pos.get(b.id)),
    due: (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || tie(a, b),
    importance: (a, b) => importanceOf(b) - importanceOf(a) || tie(a, b),
    length: (a, b) => (a.minutes || 30) - (b.minutes || 30) || tie(a, b),
    category: (a, b) => (catName(get('categories', a.category)) || '~').localeCompare(catName(get('categories', b.category)) || '~') || tie(a, b),
    added: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || tie(a, b),
  }[mode];
  return by ? [...list].sort(by) : smart;
}
export function sortPicker(id, mode) {
  return `<label class="sort-pick">⇅ <select id="${id}" aria-label="${esc(t('sortBy'))}">${TASK_SORTS.map((m) => `<option value="${m}" ${m === mode ? 'selected' : ''}>${esc(t(`sort_${m}`))}</option>`).join('')}</select></label>`;
}

// Tasks tab: "To do" (your to-dos, in groups you can fold) and "Saved" (saved tasks, day templates
// and preparations: the things you set up once and reuse).
// Search: case and accents don't matter; every word must appear in the title, notes, place, category, steps,
// checklist or rule names.
export function taskHay(x) {
  const cat = get('categories', x.category);
  return fold([x.title, x.notes, x.place, cat ? catName(cat) : '', ...(x.steps || []).map((y) => y.title), ...(x.checklist || []).map((c) => c.text || c.title || c), ...(x.rules || []).map((r) => r.title)].join(' '));
}
// Groups by date in the task list (Settings → Task list): today, tomorrow and "soon" can be switched
// on or off; a group that's off hands its tasks to the next one that's on ("later" is always there).
export const DATE_GROUPS = ['today', 'tomorrow', 'soon', 'later'];
export function taskGroupsCfg() { return { today: true, tomorrow: false, soon: true, soonDays: 7, ...(state.settings.taskGroups || {}) }; }
export function dateBuckets(items, dateOf, td) {
  const cfg = taskGroupsCfg();
  const on = (k) => k === 'later' || cfg[k];
  const out = { overdue: [], today: [], tomorrow: [], soon: [], later: [], nodate: [] };
  const tmr = addDays(td, 1); const soonEnd = addDays(td, Number(cfg.soonDays) || 7);
  for (const x of items) {
    const d = dateOf(x);
    if (!d) { out.nodate.push(x); continue; }
    if (d < td) { out.overdue.push(x); continue; }
    const natural = d === td ? 'today' : d === tmr ? 'tomorrow' : d <= soonEnd ? 'soon' : 'later';
    out[DATE_GROUPS.slice(DATE_GROUPS.indexOf(natural)).find(on)].push(x);
  }
  return out;
}
// Filters for the task lists (Tasks tab, tray, tasks column): to fix = tasks the planner still
// needs details for; recurring; with a place; one category. Kept per device, off by default.
export const FILTER_KEYS = ['fix', 'recurring', 'place'];
export function taskFilter() { return { fix: false, recurring: false, place: false, cat: '', ...(state.settings.taskFilter || {}) }; }
export function filterActive() { const f = taskFilter(); return FILTER_KEYS.some((k) => f[k]) || Boolean(f.cat); }
export function passesFilter(x) {
  const f = taskFilter();
  if (f.fix && !taskIssues(x).length) return false;
  if (f.recurring && !(x.repeat)) return false;
  if (f.place && !x.place) return false;
  if (f.cat && (x.category || '') !== f.cat) return false;
  return true;
}
export function filterBar() {
  const f = taskFilter();
  const chip = (k, label, on) => `<button type="button" class="fchip${on ? ' on' : ''}" data-action="filter" data-id="${k}" aria-pressed="${on}">${label}</button>`;
  return `<div class="filters" role="group" aria-label="${esc(t('filters'))}">
    ${chip('fix', `⚠ ${esc(t('f_fix'))}`, f.fix)}${chip('recurring', `↻ ${esc(t('f_recurring'))}`, f.recurring)}${chip('place', `📍 ${esc(t('f_place'))}`, f.place)}
    ${categories().map((c) => `<button type="button" class="fchip cat${f.cat === c.id ? ' on' : ''}" data-action="filter-cat" data-id="${esc(c.id)}" style="--c:${esc(c.color)}" aria-pressed="${f.cat === c.id}"><span class="chip-dot"></span>${esc(catName(c))}</button>`).join('')}
    ${filterActive() ? `<button type="button" class="fchip clear" data-action="filter-clear">✕ ${esc(t('clearFilters'))}</button>` : ''}
  </div>`;
}
export function folded(key) { return (state.settings.folded ?? ['grp_done']).includes(key); }
export function foldBtn(key, label, n, { open = !folded(key) } = {}) {
  return `<button class="fold" type="button" data-action="fold" data-id="${esc(key)}" aria-expanded="${open}"><span class="fold-ico">▸</span> ${esc(label)} <small>${n}</small></button>`;
}
export function viewTasks(force = null) {
  const td = today();
  const all = live('tasks');
  const tab = force || ui.tasksTab || state.settings.tasksTab || 'todo'; // the part you used last is remembered
  const q = (ui.taskQ || '').trim();
  const hit = (x) => (!q || matchesQ(taskHay(x), q)) && passesFilter(x);
  const isFolded = (key) => !q && folded(key); // while searching, every group shows its matches
  const search = searchBox({ id: 'task-q', value: ui.taskQ || '' });
  const nShop = live(SH()).filter((i) => !i.checked).length;
  const switcher = `<div class="seg" role="tablist">${['todo', 'saved', 'shop'].map((k) => `<button type="button" role="tab" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}" data-action="tasks-tab" data-id="${k}">${esc(t(`tasksTab_${k}`))}${k === 'shop' && nShop ? ` <small>${nShop > 99 ? '99+' : nShop}</small>` : ''}</button>`).join('')}</div>`;
  if (tab === 'shop') return `${switcher}${viewShop()}`;
  if (tab === 'saved') {
    const helpers = all.filter((x) => isStep(x) && hit(x)).sort((a, b) => a.title.localeCompare(b.title));
    const tpls = templates().filter((tp) => !q || matchesQ(fold(tp.name), q));
    const groups = savedGroups().map(([cat, list]) => [cat, list.filter(hit)]).filter(([, list]) => list.length);
    const nSaved = groups.reduce((n, [, l]) => n + l.length, 0);
    return `${switcher}
    <div class="task-tools">${search}</div>
    ${filterBar()}
    ${q && !nSaved && !tpls.length && !helpers.length ? `<p class="empty">${esc(t('noMatch'))}</p>` : ''}
    <section class="fold-sec first">
      ${foldBtn('saved', t('savedTasks'), nSaved, { open: !isFolded('saved') })}
      ${isFolded('saved') ? '' : `${hint('savedHint')}
      ${groups.map(([cat, list]) => `<div class="sub">${esc(cat ? catName(cat) : t('noCategory'))}</div>
      <ul class="list saved">${list.map((tp) => `<li><button class="task-main" type="button" data-action="task-edit" data-id="${esc(tp.id)}"><span class="item-text">${isMealType(tp) ? '🍽 ' : ''}${impBadge(tp) ? `${impBadge(tp)} ` : ''}${esc(tp.title)}<small>${esc(savedInfo(tp))}</small></span></button></li>`).join('')}</ul>`).join('')}
      <button class="btn small" type="button" data-action="saved-new">+ ${esc(t('newSaved'))}</button>`}
    </section>
    ${advancedOn() ? `<section class="fold-sec">
      ${foldBtn('templates', t('templates'), tpls.length, { open: !isFolded('templates') })}
      ${isFolded('templates') ? '' : `${hint('templatesHint')}
      <ul class="list">${tpls.map((tp) => `<li><button class="task-main" type="button" data-action="tpl-edit" data-id="${esc(tp.id)}"><span class="item-text">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}${tp.days?.length ? ` · ${esc(t('autoOn', daysLabel(tp.days)))}` : ''}</small></span></button></li>`).join('') || `<li class="pad"><span class="hint">${esc(t('noTemplates'))}</span></li>`}</ul>
      <button class="btn small" type="button" data-action="tpl-new">+ ${esc(t('newTemplate'))}</button>`}
    </section>
    <section class="fold-sec">
      ${foldBtn('preps', t('preparations'), helpers.length, { open: !isFolded('preps') })}
      ${isFolded('preps') ? '' : `${hint('prepsHint')}${helpers.length ? `<ul class="list preps">${helpers.map(prepRow).join('')}</ul>` : `${hint('noPreps')}`}`}
    </section>` : ''}`;
  }
  const g = groupTasks(all.filter((x) => isTodo(x) && hit(x)), td);
  const mode = state.settings.taskSort || 'smart';
  const manual = mode === 'manual' && !q; // no dragging while the list is filtered
  // Two parts: to plan (grouped by due date) and already planned (grouped by the day they're on).
  const openList = [...g.overdue, ...g.today, ...g.upcoming, ...g.anytime];
  const plannedIds = new Set(alreadyPlanned().map((x) => x.id));
  const toPlan = openList.filter((x) => !plannedIds.has(x.id));
  const planned = openList.filter((x) => plannedIds.has(x.id));
  const whenOf = (x) => { const b = nextPlanned(x.id); return b ? b.date + String(b.start).padStart(4, '0') : ''; };
  const byWhen = (list) => (mode === 'smart' || mode === 'due' ? [...list].sort((a, b) => (whenOf(a) < whenOf(b) ? -1 : 1)) : sortTaskList(list, mode));
  const groupLabel = (k) => (k === 'soon' ? t('grp_soonN', Number(taskGroupsCfg().soonDays) || 7) : k === 'nodate' ? t('grp_anytime') : t(`grp_${k}`));
  const section = (key, label, items, sorted) => (items.length ? `<section class="fold-sec grp-sec">${foldBtn(key, label, items.length, { open: !isFolded(key) })}
    ${isFolded(key) ? '' : `<ul class="list tasks${manual ? ' sortable' : ''}" ${manual ? `data-sortable="tasks" data-group="${key}"` : ''}>${sorted.map((x) => taskRow(x, { drag: manual })).join('')}</ul>`}</section>` : '');
  const part = (key, label, items, buckets, sortFn, hint = '') => {
    if (!items.length) return '';
    const open = !isFolded(key);
    return `<section class="task-part">
      <h2 class="part-h">${foldBtn(key, label, items.length, { open })}</h2>
      ${open ? `${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${['overdue', ...DATE_GROUPS, 'nodate'].map((k) => section(`${key}_${k}`, groupLabel(k), buckets[k], sortFn(buckets[k]))).join('')}` : ''}
    </section>`;
  };
  const open = openList.length;
  return `${switcher}
  <form id="task-add" class="row">
    <input id="task-input" name="title" autocomplete="off" placeholder="${esc(t('addTaskPh'))}">
    <button class="btn primary">${esc(t('add'))}</button>
  </form>
  ${hint('quickHint')}
  <div class="task-tools">${search}${sortPicker('task-sort', mode)}<button class="btn small${state.settings.compact ? ' on' : ''}" type="button" data-action="compact" aria-pressed="${Boolean(state.settings.compact)}" title="${esc(t('compactHint'))}">≡ ${esc(t('compact'))}</button><button class="btn small" type="button" data-action="import">⤓ ${esc(t('importTasks'))}</button></div>
  ${filterBar()}
  ${manual && !q ? `${hint('manualHint')}` : ''}
  ${open || g.done.length ? '' : `<p class="empty">${esc(q || filterActive() ? t('noMatch') : t('noTasks'))}</p>`}
  ${part('part_toplan', t('partToPlan'), toPlan, dateBuckets(toPlan, (x) => x.due, td), (l) => sortTaskList(l, mode))}
  ${part('part_planned', t('partPlanned'), planned, dateBuckets(planned, (x) => nextPlanned(x.id)?.date, td), byWhen, t('partPlannedHint'))}
  ${g.done.length ? `<section class="fold-sec grp-sec">${foldBtn('grp_done', t('grp_done'), g.done.length, { open: !isFolded('grp_done') })}
    ${isFolded('grp_done') ? '' : `<ul class="list tasks done">${g.done.slice(0, 50).map(taskRow).join('')}</ul>
    <button class="btn small ghost" type="button" data-action="clear-done">${esc(t('clearDone'))}</button>`}</section>` : ''}`;
}

// Which tasks use a small step (preparation or rule follow-up), and how.
export function ownersOf(x) {
  const out = [];
  for (const y of live('tasks')) {
    if (y.id === x.id) continue;
    for (const p of y.prep || []) if (p.taskId === x.id) out.push({ task: y, how: t('ownerPrep', t(`pw_${p.when || 'before'}`)) });
    for (const r of y.rules || []) {
      if (r.taskId !== x.id) continue;
      const step = r.stepId && (y.steps || []).find((z) => z.id === r.stepId);
      out.push({ task: y, how: step ? t('ownerStepRule', step.title, t(`rws_${r.when}`)) : t('ownerRule', t(`rw_${r.when}`)) });
    }
  }
  return out;
}
export function prepRow(x) {
  const own = ownersOf(x);
  const bits = [fmtDur(x.minutes || 10)];
  if (x.checklist?.length) bits.push(`☑ ${x.checklist.length}`);
  if (x.steps?.length) bits.push(`▤ ${x.steps.length}`);
  if (x.rules?.length) bits.push(`⚙ ${x.rules.length}`);
  return `<li class="prep-row">
    <button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}"><span class="item-text">↳ ${esc(x.title)}<small>${esc(bits.join(' · '))}</small></span></button>
    <div class="prep-owners">${own.length ? own.map((o) => `<button class="owner" type="button" data-action="task-edit" data-id="${esc(o.task.id)}" title="${esc(t('openTask', o.task.title))}">
      <span class="owner-t">${isMealType(o.task) ? '🍽 ' : isSaved(o.task) ? '★ ' : ''}${esc(o.task.title)} ↗</span><small>${esc(o.how)}</small></button>`).join('')
    : `<span class="hint">${esc(t('prepUnused'))}</span><button class="btn small ghost" type="button" data-action="prep-del" data-id="${esc(x.id)}">${esc(t('delete'))}</button>`}</div>
  </li>`;
}

export function taskRow(x, { drag = false } = {}) {
  const td = today();
  const bits = [];
  if (isStep(x)) {
    const parents = live('tasks').filter((p) => (p.prep || []).some((q) => q.taskId === x.id)).map((p) => p.title);
    if (parents.length) bits.push(esc(t('prepFor', parents.join(', '))));
  }
  if (x.due) bits.push(`<span class="${x.due < td && !x.done ? 'late' : ''}">${esc(relDay(x.due))}</span>`);
  if (x.minutes) bits.push(esc(fmtDur(x.minutes)));
  if (x.repeat === 'times') bits.push(`↻ ${esc(t('timesShort', x.timesN || 1, t(`per_${x.timesPer || 'week'}`)))} · ${timesDone(x, td)}/${x.timesN || 1}`);
  else if (x.repeat) bits.push(`↻ ${esc(repeatText(x))}`);
  if (x.fromTitle) bits.push(`↪ ${esc(t('fromTask', x.fromTitle))}`);
  if (x.eventId && eventOf(x.eventId)) bits.push(`📅 ${esc(eventOf(x.eventId).title)} · ${esc(offsetText(x.eventOffset))}`);
  const pre = prereqsOf(x);
  if (pre.length) bits.push(`🔒 ${esc(t('afterTask', pre.map((p) => p.task.title).join(', ')))}`);
  if (x.windows?.length) bits.push(`🕒 ${esc(windowsText(x.windows))}`);
  if (x.when) bits.push(esc(t(`when_${x.when}`)));
  if (x.checklist?.length) bits.push(`☑ ${x.checklist.length}`);
  if (realSteps(x).length) bits.push(`▤ ${realSteps(x).length}`);
  if (x.place) bits.push(`📍 ${esc(x.place)}`);
  for (const y of (x.steps || []).filter((z) => z.travel && z.lookup !== false)) bits.push(`${MODE_ICON[y.mode] || '🚌'} ${y.known ? esc(fmtDur(y.minutes)) : '?'}`);
  if (bufferOf(x) > 0 && (x.steps || []).some((z) => z.buffer)) bits.push(`⏳ ${esc(fmtDur(bufferOf(x)))}`);
  if (x.prep?.length) bits.push(`↳ ${esc(prepOf(x).map((p) => p.task.title).join(', '))}`);
  const cat = get('categories', x.category);
  if (cat) bits.push(`<span class="cat" style="--c:${esc(cat.color)}">${esc(catName(cat))}</span>`);
  const planned = live('blocks').filter((b) => b.taskId === x.id && !b.done && b.date >= td && b.kind !== 'prep').sort((a, b) => ((a.date + a.start) < (b.date + b.start) ? -1 : 1))[0];
  if (planned && !x.done) bits.push(`<span class="badge">${esc(t('plannedAt', relDay(planned.date), fmtTime(planned.start)))}</span>`);
  return `<li class="imp-${importanceOf(x)}${taskIssues(x).length ? ' has-iss' : ''}" ${drag ? `data-sort-key="${esc(x.id)}"` : ''}>
    ${drag ? grip(`th-${x.id}`, x.title) : ''}
    ${isStep(x) ? '<span class="helper-dot">↳</span>' : `<input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done || (x.repeat === 'times' && timesDone(x, td) >= (x.timesN || 1)) ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`}
    <button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}">
      <span class="item-text">${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}<small>${bits.join(' · ')}</small></span>
    </button>
    ${issueBadge(x)}
  </li>`;
}
