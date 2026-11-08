// views/impegni.js (v55): the To do tab ("Impegni") as saved views.
// Everything you keep lives in one place: one-off things, things that come back (routines) and, in its
// own view, the shopping list. A view is a set of filters with a name; the ones you pin are the tabs at
// the top (three to a row). Overview is always first: everything, newest first, with what isn't sorted
// yet tagged "to sort". Views and their order are kept on this device (Settings).
import { catName, catsOf, categories, esc, modal, relDay, ui } from '../core.js';
import { sizeBars, sizeOf, sizeWord } from '../focus.js';
import { realSteps } from '../travel-plan.js';
import { t } from '../i18n.js';
import { isTodo } from '../kinds.js';
import { countedOf, nextPlanned, noRhythm, outcomeOf, taskIcon } from '../model.js';
import { addDays, fmtDur, fmtTime, sortTasks, today } from '../plan.js';
import { endedRoutines, isArchived, isRoutine, legend, routineRow, weekHeader } from '../routines.js';
import { matchesQ } from '../shoplist.js';
import { get, live, remove, saveSettings, state, upsert } from '../store.js';
import { palestraConfigured, ricetteConfigured } from '../sync.js';
import { render } from '../shell.js';
import { isPalestra } from '../palestra.js';
import { durField, openModal, readDur, searchBox } from '../widgets.js';
import { openWeekGrid } from '../weekgrid.js';
import { weekStart } from './planner.js';
import { SH, shopReader, viewShop } from './shop.js';
import { foldBtn, folded, taskHay, taskRow } from './tasks.js';
import { pageHead, viewMenu } from '../viewmenu.js';
import { habitHtml, kanbanHtml, matrixHtml, taskView, tvItems, tvOptions } from './taskviews.js';

// The older layouts stay reachable for the older test suites (a switch kept on the device, not a setting).
export const classic = () => { try { return localStorage.getItem('everyday-classic') === '1'; } catch { return false; } };

export const RICETTE_APP = 'https://nannolo45.github.io/ricette-app/';
export const TYPES = ['once', 'repeat'];
export const STATES = ['toplan', 'planned', 'done'];
export const WHENS = ['today', 'week', 'later', 'none'];
export const SORTS = ['due', 'added', 'when', 'cat', 'type'];

export function defaultViews() {
  return [
    { id: 'overview', fixed: true, pin: true, f: {}, by: classic() ? 'added' : 'due', dir: classic() ? -1 : 1 }, // (v100) by deadline
    { id: 'done', pin: true, f: { state: ['done'] }, by: 'added', dir: -1 }, // (v117) ✓ Fatte: what's done, to archive
    { id: 'rtn', pin: true, f: { type: ['repeat'] }, by: 'cat', dir: 1 }, // (v117) ↻ Routine: what repeats, this week
    { id: 'week', pin: false, f: { when: ['today', 'week'] }, by: 'when', dir: 1 },
    { id: 'shop', pin: true, shop: true, f: {} },
    { id: 'workout', pin: true, f: { src: ['palestra'] }, app: 'palestra', by: 'when', dir: 1 }, // (v102) Palestra's workouts, not all of Salute
    { id: 'home', pin: true, f: { cat: ['home'] }, by: 'when', dir: 1 },
    { id: 'routine', pin: true, f: { type: ['repeat'] }, by: 'cat', dir: 1 }, // (v81) the routines' week, ready
    { id: 'toplan', pin: false, f: { state: ['toplan'] }, by: 'when', dir: 1 },
    { id: 'meals', pin: false, f: { cat: ['meals'] }, app: 'ricette', by: 'when', dir: 1 },
    { id: 'work', pin: false, f: { cat: ['work'] }, by: 'when', dir: 1 },
    { id: 'personal', pin: false, f: { cat: ['personal'] }, by: 'when', dir: 1 },
  ];
}
// (v91) Views that come with the app: ★ Salvate and 🛒 Spesa always (Everyday keeps its own list without Ricette),
// 🏋 Palestra with Palestra connected. Their name and icon are fixed; untick them (no tab) or take them away («Togli»): a
// taken-away one waits under «Viste di serie tolte» (settings.viewsGone) to be put back. Without its app a
// view hides by itself, keeping its place for when the app is back.
export const BUILTIN = { done: { ic: '✓', app: null }, rtn: { ic: '↻', app: null }, routine: { ic: '★', app: null }, shop: { ic: '🛒', app: null }, workout: { ic: '🏋', app: 'palestra' } };
const appOn = (a) => !a || (a === 'ricette' ? ricetteConfigured() : palestraConfigured());
export const goneViews = () => [...new Set([...(state.settings.viewsGone || []), ...(state.settings.rtViewGone ? ['routine'] : [])])].filter((id) => BUILTIN[id]);
function allViews() {
  const list = (state.settings.views || defaultViews()).filter(Boolean).map((v) => (BUILTIN[v.id] ? { ...v, name: undefined } : v))
    .map((v) => (v.id === 'workout' && JSON.stringify(v.f || {}) === JSON.stringify({ cat: ['health'] }) ? { ...v, f: { src: ['palestra'] } } : v)); // (v102) the old «Salute» filter becomes «Palestra»
  if (!list.some((v) => v.id === 'overview')) list.unshift(defaultViews()[0]);
  const gone = goneViews();
  for (const id of Object.keys(BUILTIN)) if (!gone.includes(id) && !list.some((v) => v.id === id)) { const v = { ...defaultViews().find((y) => y.id === id), pin: true }; if (id === 'done' || id === 'rtn') list.splice(Math.min(list.length, id === 'done' ? 1 : 2), 0, v); else list.push(v); } // (v117) Fatte and Routine right after Da fare
  return list.filter((v) => !gone.includes(v.id));
}
export function viewList() { return allViews().filter((v) => appOn(BUILTIN[v.id]?.app)); }
// Saving keeps the views whose app is away where they were.
function saveViewsAll(shown) {
  const all = allViews(); const hidden = all.filter((v) => !shown.some((y) => y.id === v.id));
  const out = [...shown];
  for (const h of hidden) { const i = all.indexOf(h); const prev = all.slice(0, i).reverse().find((v) => out.some((y) => y.id === v.id)); out.splice(prev ? out.findIndex((y) => y.id === prev.id) + 1 : out.length, 0, h); }
  saveSettings({ views: out });
}
export function takeAwayView(id) { saveSettings({ viewsGone: [...new Set([...(state.settings.viewsGone || []), id])] }); }
export function restoreView(id) { saveSettings({ viewsGone: (state.settings.viewsGone || []).filter((x) => x !== id), ...(id === 'routine' ? { rtViewGone: false } : {}) }); }
const saveViews = (list) => saveViewsAll(list);
export const viewName = (v) => (BUILTIN[v.id] && !classic() ? `${BUILTIN[v.id].ic} ${t(v.id === 'routine' ? 'vw_saved' : v.id === 'done' ? 'vw_doneV' : v.id === 'rtn' ? 'vw_rtn' : `vw_${v.id}`)}` : v.name || (v.id === 'routine' && !classic() ? t('vw_saved') : t(`vw_${v.id}`))); // (v83) Routine → Salvate; (v91) with its icon
export function curView() { const l = viewList(); return l.find((v) => v.id === (ui.view2 || state.settings.curView)) || l[0]; }
export function setView(id) { ui.view2 = id; ui.vTemp = null; ui.openRow = null; saveSettings({ curView: id }); }
function patchView(id, patch) { saveViews(viewList().map((v) => (v.id === id ? { ...v, ...patch } : v))); }

// ---------- the items and their facts ----------
export function allItems() {
  return live('tasks').filter((x) => !x.deleted && !x.travelRole && !isArchived(x) && ((isTodo(x) && !x.repeat) || isRoutine(x)));
}
const weekEnd = (td = today()) => addDays(weekStart(td), 6);
export const typeOf = (x) => (isRoutine(x) ? 'repeat' : 'once');
export const stateOf = (x) => (x.done ? 'done' : nextPlanned(x.id) ? 'planned' : 'toplan');
export const dateOf = (x) => nextPlanned(x.id)?.date || x.due || null;
export function whenOf(x, td = today()) {
  const d = dateOf(x);
  if (!d) return 'none';
  return d <= td ? 'today' : d <= weekEnd(td) ? 'week' : 'later';
}
// What a thing still misses to be "sorted": a group, a when (one-off things only) and a length.
export function missing(x) {
  if (x.done) return [];
  const out = [];
  if (!catsOf(x).length) out.push('cat');
  if (typeOf(x) === 'once' && !dateOf(x) && !x.noDate) out.push('when');
  if (x.lenSet === false) out.push('len');
  return out;
}
export const unsorted = (x) => missing(x).length > 0;
export const unsortedList = () => allItems().filter(unsorted).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
// (v66) Nothing is "unsorted" any more: what Rivedi goes through, and the badge counts, is what's still to plan:
// one-off things with no open block from today on (newest first). A missing category or length is fine.
// (v91) What the Overview flags: things missing the minimum the planner needs, a length and a category.
export const lacks = (x) => (x.done ? [] : [x.lenSet === false && 'len', !catsOf(x).length && 'cat'].filter(Boolean));
export const incompleteList = () => allItems().filter((x) => lacks(x).length).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
export const flagCount = () => (classic() ? unsortedList() : incompleteList()).length;
export const toPlanList = () => allItems().filter((x) => !x.done && typeOf(x) === 'once' && !nextPlanned(x.id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
export function matches(x, f = {}) {
  if (f.type?.length && !f.type.includes(typeOf(x))) return false;
  if (f.state?.length && !f.state.includes(stateOf(x))) return false;
  if (f.when?.length && !f.when.includes(whenOf(x))) return false;
  if (f.src?.includes('palestra') && !isPalestra(x)) return false;
  if (f.cat?.length) { const cs = catsOf(x); if (!(cs.length ? cs.some((c) => f.cat.includes(c)) : f.cat.includes(''))) return false; }
  return true;
}
const filterOf = (v) => (ui.vTemp && ui.vTemp.id === v.id ? ui.vTemp.f : v.f) || {};
const nOf = (f) => Object.values(f || {}).reduce((n, l) => n + (l?.length || 0), 0);
const sameF = (a, b) => JSON.stringify(Object.entries(a || {}).filter(([, l]) => l?.length).map(([k, l]) => [k, [...l].sort()]).sort()) === JSON.stringify(Object.entries(b || {}).filter(([, l]) => l?.length).map(([k, l]) => [k, [...l].sort()]).sort());
const valLabel = (k, v) => (k === 'cat' ? (v ? catName(get('categories', v)) : t('noGroup')) : t(`vf_${k}_${v}`));
export function showsText(v) {
  const f = filterOf(v);
  if (v.shop) return t('vwShowsShop');
  const parts = ['type', 'state', 'when', 'cat', 'src'].filter((k) => f[k]?.length).map((k) => f[k].map((x) => valLabel(k, x)).join(t('orWord')));
  return t('vwShows', parts.length ? parts.join(' · ') : t('vwEverything'));
}

// ---------- grouping and order ----------
function addedKey(x, td) {
  const d = x.createdAt ? new Date(x.createdAt) : null;
  if (!d) return 'earlier';
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return s === td ? 'today' : s === addDays(td, -1) ? 'yesterday' : s >= addDays(td, -6) ? 'week' : 'earlier';
}
const DUE_GROUPS = ['late', 'soon', 'week', 'later', 'none'];
export function groupsOf(list, by, dir = 1) {
  const td = today();
  const cats = categories().map((c) => c.id);
  if (by === 'saved') { // (v83) Salvate: what repeats, then what you keep to do again whenever
    const rep = list.filter((x) => x.repeat); const any = list.filter((x) => !x.repeat);
    const az = (a, b) => (a.title || '').localeCompare(b.title || '');
    return [['rep', rep], ['any', any]].filter(([, l]) => l.length).map(([k, l]) => ({ key: k, label: t(`gs_${k}`), list: l.sort(az) }));
  }
  if (by === 'due') { // (v100) by deadline: late, today and tomorrow, this week, later, whenever
    const kRep = (x) => { const d = nextPlanned(x.id)?.date; if (!d) return 'none'; return d <= addDays(td, 1) ? 'soon' : d <= addDays(td, 7) ? 'week' : 'later'; };
    const k = (x) => { const d = x.due || dateOf(x); if (!d) return 'none'; if (x.due && x.due < td) return 'late'; if (d < td) return 'soon'; if (d <= addDays(td, 1)) return 'soon'; if (d <= addDays(td, 7)) return 'week'; return 'later'; };
    const smart = sortTasks(list, td); const pos = new Map(smart.map((x, i) => [x.id, i]));
    const m = new Map(); for (const x of list) { const g = typeOf(x) === 'repeat' ? kRep(x) : k(x); /* (v101) a routine is never late: its next turn decides */ if (!m.has(g)) m.set(g, []); m.get(g).push(x); }
    const kd = (x) => (typeOf(x) === 'repeat' ? nextPlanned(x.id)?.date : x.due || dateOf(x)) || '9999';
    return DUE_GROUPS.filter((g) => m.has(g)).map((g) => ({ key: g, label: t(`gd_${g}`), list: m.get(g).sort((a, b) => kd(a).localeCompare(kd(b)) || pos.get(a.id) - pos.get(b.id)) }));
  }
  const key = (x) => (by === 'added' ? addedKey(x, td) : by === 'when' ? (typeOf(x) === 'repeat' && whenOf(x) !== 'today' ? 'rep' : whenOf(x)) : by === 'cat' ? (catsOf(x)[0] || '') : typeOf(x));
  const order = by === 'added' ? ['today', 'yesterday', 'week', 'earlier'] : by === 'when' ? ['today', 'week', 'rep', 'later', 'none'] : by === 'cat' ? ['', ...cats] : TYPES;
  const label = (k) => (by === 'added' ? t(`ga_${k}`) : by === 'when' ? t(`gw_${k}`) : by === 'cat' ? (k ? catName(get('categories', k)) : t('noGroup')) : t(`vf_type_${k}`));
  const m = new Map();
  for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  const smart = sortTasks(list, td); const pos = new Map(smart.map((x, i) => [x.id, i]));
  const within = by === 'added' ? (a, b) => (b.createdAt || 0) - (a.createdAt || 0) : (a, b) => (dateOf(a) || '9999').localeCompare(dateOf(b) || '9999') || pos.get(a.id) - pos.get(b.id);
  const sign = by === 'added' ? -dir : dir; // "added" lists newest first when dir is -1
  return [...m.keys()].sort((a, b) => sign * ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)))
    .map((k) => ({ key: k, label: label(k), list: m.get(k).sort((a, b) => sign * within(a, b)) }));
}
export function sortLabel(v) {
  const by = v.by || 'when'; const dir = v.dir ?? 1;
  if (by === 'added') return dir < 0 ? t('srtNewest') : t('srtOldest');
  return `${t(`srt_${by}`)} ${dir < 0 ? '↓' : '↑'}`;
}

// ---------- rows ----------
const tag = (x) => (classic() && unsorted(x) ? `<span class="vw-tag">${esc(t('toSort'))}</span>` : ''); // (v66) no "to sort" tag
function missChips(x) {
  const mi = missing(x);
  const lab = { cat: catsOf(x).length ? catName(get('categories', catsOf(x)[0])) : `+ ${t('mGroup')}`, when: dateOf(x) ? relDay(dateOf(x)) : x.noDate ? t('vf_when_none') : `+ ${t('mWhen')}`, len: x.lenSet === false ? `+ ${t('mLen')}` : fmtDur(x.minutes || 30) };
  return `<div class="vw-miss">${['cat', ...(typeOf(x) === 'once' ? ['when'] : []), 'len'].map((k) => `<button type="button" class="mchip${mi.includes(k) ? '' : ' set'}" data-action="vw-pick" data-id="${esc(x.id)}" data-k="${k}">${esc(lab[k])}</button>`).join('')}
    <button type="button" class="mchip more" data-action="task-edit" data-id="${esc(x.id)}">${esc(t('detailsBtn'))} ›</button></div>`;
}
export function plainRow(x) {
  if (!classic() && typeOf(x) !== 'repeat') return richRow(x);
  const open = ui.openRow === x.id;
  const meta = [dateOf(x) ? relDay(dateOf(x)) : '', x.lenSet === false ? '' : fmtDur(x.minutes || 30), ...catsOf(x).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · ');
  const box = typeOf(x) === 'repeat' ? '<span class="vw-rep" aria-hidden="true">↻</span>' : `<input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`;
  return `<li class="vw-row${open ? ' open' : ''}${x.done ? ' done' : ''}">${box}
    <button class="task-main" type="button" data-action="${typeOf(x) === 'repeat' && !classic() ? 'routine-open' : 'vw-row'}" data-id="${esc(x.id)}" aria-expanded="${open}"><span class="item-text">${taskIcon(x)}${esc(x.title)}${meta ? `<small>${esc(meta)}</small>` : ''}</span></button>${tag(x)}
    ${open ? missChips(x) : ''}</li>`;
}
// (v100) a row you take in at a glance: the category's colour on its edge, the deadline as a label (red when late,
// yellow today or tomorrow) and its weight as three little bars (quick · medium · big). Tap: the card to look at it
// (something still missing its details opens the chips to fill them in, as before).
export function dueBadge(x) {
  if (!x.due || x.done) return '';
  const td = today(); const late = x.due < td; const soon = !late && x.due <= addDays(td, 1);
  return `<span class="due-b${late ? ' late' : soon ? ' soon' : ''}">${esc(late ? t('dueLateShort', relDay(x.due)) : relDay(x.due))}</span>`;
}
export function richRow(x) {
  const open = ui.openRow === x.id; const un = unsorted(x) && !classic();
  const c = catsOf(x)[0]; const color = (c && get('categories', c)?.color) || 'var(--line)';
  const nSt = realSteps(x).length; const np = nextPlanned(x.id);
  const meta = [x.lenSet === false ? '' : fmtDur(x.minutes || 30), sizeWord(sizeOf(x)), nSt ? t('ox_nSteps', nSt) : '', c ? catName(get('categories', c)) : '', np && !x.done ? t('plannedAt', relDay(np.date), fmtTime(np.start)) : ''].filter(Boolean).join(' · ');
  return `<li class="vw-row rr${open ? ' open' : ''}${x.done ? ' done' : ''}" style="--c:${esc(color)}"><input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">
    <button class="task-main" type="button" data-action="${un ? 'vw-row' : 'task-view'}" data-id="${esc(x.id)}"${un ? ` aria-expanded="${open}"` : ''}><span class="item-text">${taskIcon(x)}${esc(x.title)}${meta ? `<small>${esc(meta)}</small>` : ''}</span></button>
    <span class="rr-r">${dueBadge(x)}${sizeBars(x, color)}</span>
    ${open && un ? missChips(x) : ''}</li>`;
}
// (v83) A saved thing with no rhythm, in Salvate: its length, when you last did it, ▶ to plan it.
function lastDone(x) { return live('blocks').filter((b) => b.taskId === x.id && !b.deleted && outcomeOf(b) === 'done').map((b) => b.date).sort().pop() || null; }
function anyRow(x) {
  const last = lastDone(x);
  return `<li class="vw-row sv-any"><button class="task-main" type="button" data-action="routine-open" data-id="${esc(x.id)}"><span class="item-text">${taskIcon(x)}${esc(x.title)}<small>${esc(`${fmtDur(x.minutes || 30)} · ${last ? t('svLast', relDay(last)) : t('svNever')}`)}</small></span></button><button class="btn small sv-plan" type="button" data-action="saved-plan" data-id="${esc(x.id)}" aria-label="${esc(t('svPlan', x.title))}" title="${esc(t('svPlan', x.title))}">▶</button></li>`;
}
export const isSalvate = (v) => !classic() && v.id === 'routine' && (!v.by || v.by === 'cat');
function fullRow(x, ws, sv = false) {
  if (sv && !x.repeat) return anyRow(x);
  if (typeOf(x) === 'repeat') return routineRow(x, ws);
  if (!classic()) return richRow(x);
  if (!unsorted(x)) return taskRow(x);
  return plainRow(x);
}

// ---------- the tab ----------
// (v112) Da fare's lists as tabs under the title (on every screen), each with how many open things it has
function tabList(cur) {
  const nUn = flagCount(); const nShop = live(SH()).filter((i) => !i.checked).length; const items = allItems();
  const l = viewList(); const shown = [...l.filter((v) => v.pin), ...(cur.pin ? [] : [cur])];
  return [...shown.map((v) => ({ label:viewName(v), on:v.id === cur.id, action:'vw-tab', id:v.id, cls:v.pin ? '' : 'loose',
    n:v.id === 'done' ? items.filter((x) => x.done).length || '' : v.shop ? nShop || '' : items.filter((x) => !x.done && matches(x, v.f || {})).length || '' })),
  { label:`＋ ${t('vwNew')}`, action:'vw-new', id:'', foot:true }, { label:`✎ ${t('vwEdit')}`, action:'vw-views', id:'', foot:true }];
}
const isRoutineList = (v) => { const f = filterOf(v); return (f.type || []).length === 1 && f.type[0] === 'repeat'; };
function head(v, acts = '') {
  const rt = isRoutineList(v); const tv = taskView() === 'habit' && !rt ? 'list' : taskView();
  const nV = viewList().filter((y) => y.pin || y.id === v.id).length;
  return pageHead({ title:t('tabTasks'), pickSub:showsText(v), pickTitle:t('vwViews'), pickHint:t('ph_nViews', nV), menu:v.shop || v.id === 'done' ? '' : viewMenu({ p:'tv', cur:tv, title:t('tv_title'), items:tvItems(rt), opts:tvOptions }), tabs:tabList(v), acts, titlePick:!classic() });
}
// (v82) Routines without a rhythm (often «ogni …» lost by the + before v81): set it with one tap, or leave them.
function rhythmCard() {
  const list = noRhythm(); if (!list.length) return '';
  return `<div class="vw-card rh-card"><b>${esc(t('rhTitle', list.length))}</b><small>${esc(t('rhSub'))}</small>
    <ul>${list.map((x) => `<li><span>${esc(x.title)}<small>${esc(fmtDur(x.minutes || 30))} · ${esc(t('wm_anytime'))}</small></span><button class="btn small" type="button" data-action="rh-week" data-id="${esc(x.id)}">${esc(t('rhWeek'))}</button><button class="icon" type="button" data-action="rh-ok" data-id="${esc(x.id)}" aria-label="${esc(t('rhOk'))}" title="${esc(t('rhOk'))}">✕</button></li>`).join('')}</ul>
    <div class="button-row left"><button class="btn small primary" type="button" data-action="rh-all">${esc(t('rhAll'))}</button><button class="btn small" type="button" data-action="rh-none">${esc(t('rhNone'))}</button></div></div>`;
}
export function setWeekly(x) { upsert('tasks', { ...x, repeat: 'times', timesN: 1, timesPer: 'week', pickTime: true, whenMode: 'repeat', due: null }); }
export function viewImpegni() {
  if (!state.settings.dueMig && !classic()) { const vs = state.settings.views; saveSettings({ dueMig: true, ...(vs ? { views: vs.map((x) => (x?.id === 'overview' && (x.by || 'added') === 'added' ? { ...x, by: 'due', dir: 1 } : x)) } : {}) }); } // (v100) Overview by deadline, once
  const v = curView();
  if (v.shop) return `${head(v)}${viewShop()}`; // (v83) the reader says where the list is
  const f = filterOf(v);
  const q = (ui.taskQ || '').trim();
  const ws = ui.routineWeek || weekStart(today());
  const showDone = f.state?.includes('done');
  const pool = allItems().filter((x) => matches(x, f) && (!q || matchesQ(taskHay(x), q)));
  const quickN = pool.filter((x) => !x.done && typeOf(x) !== 'repeat' && sizeOf(x) === 's').length;
  const list = (showDone ? pool : pool.filter((x) => !x.done)).filter((x) => !ui.impQuick || (typeOf(x) !== 'repeat' && sizeOf(x) === 's')); // (v100) ⚡ only the quick ones
  const done = showDone || (!classic() && viewList().some((y) => y.id === 'done')) ? [] : pool.filter((x) => x.done); // (v117) the done ones live in ✓ Fatte
  const n = nOf(f);
  const changedF = ui.vTemp?.id === v.id && !sameF(ui.vTemp.f, v.f);
  const tools = classic() ? `<div class="task-tools ph-tools">${searchBox({ id: 'task-q', value: ui.taskQ || '' })}
    <button class="btn small tools-btn${n ? ' on' : ''}" type="button" data-action="vw-filters">⇅ ${esc(t('filters'))}${n ? ` · ${n}` : ''}</button>
    <button class="btn small tools-btn" type="button" data-action="vw-sort" aria-label="${esc(t('sortGroup'))}">▤ ${esc(sortLabel(v))}</button></div>`
    : `${searchBox({ id: 'task-q', value: ui.taskQ || '', ph: t('searchIn', BUILTIN[v.id] ? viewName(v).replace(/^\S+\s/, '') : viewName(v)) })}<button class="btn small tools-btn${n || ui.impQuick ? ' on' : ''}" type="button" data-action="vw-filters">⇅ ${esc(t('filters'))}${n + (ui.impQuick ? 1 : 0) ? ` · ${n + (ui.impQuick ? 1 : 0)}` : ''}</button>`; // (v117) one row: search · Filtri · the view ▾ (order and ⚡ are in Filtri)
  void quickN;
  if (v.id === 'done' && !classic()) return `${head(v, searchBox({ id: 'task-q', value: ui.taskQ || '', ph: t('searchIn', t('vw_doneV')) }))}${doneHtml(pool.filter((x) => x.done))}`;
  const nUn = flagCount();
  const card = !v.fixed || q ? '' : classic() ? (nUn ? `<div class="vw-card"><b>${esc(t('nToSort', nUn))}</b><button class="btn small primary" type="button" data-action="vw-triage">${esc(t('sortNow'))}</button></div>` : '') : overviewCards();
  const sv = isSalvate(v);
  const groups = groupsOf(list, sv ? 'saved' : v.by || 'when', v.dir ?? 1);
  const hasRep = !v.fixed && list.some((x) => typeOf(x) === 'repeat' && (!sv || x.repeat));
  const row = v.fixed ? plainRow : (x) => fullRow(x, ws, sv);
  const fresh = !v.fixed ? [...(ui.justAdded || [])].map((id) => get('tasks', id)).filter((x) => x && list.includes(x)) : [];
  const freshSet = new Set(fresh);
  const body = groups.map((g) => { const l = g.list.filter((x) => !freshSet.has(x)); return l.length ? `<section class="vw-grp"><h3 class="vw-gh${g.key === 'late' && (v.by || '') === 'due' ? ' late' : ''}">${esc(g.label)} <small>${l.length}${(() => { const m = classic() ? 0 : l.filter((x) => typeOf(x) !== 'repeat').reduce((n, x) => n + (x.minutes || 30), 0); return m ? ` · ${esc(fmtDur(m))}` : ''; })()}</small></h3><ul class="list tasks${v.fixed ? ' plain' : ' saved routines'}">${l.map(row).join('')}</ul></section>` : ''; }).join('');
  // (v112) Kanban · Matrice · Abitudini instead of the list (the lists, the filters and the search stay)
  const tv = taskView() === 'habit' && !isRoutineList(v) ? 'list' : taskView();
  if (tv !== 'list') return `${head(v, tools)}${changedF ? `<p class="vw-shows"><span class="vw-changed">${esc(t('vwChanged'))}</span></p>` : ''}${tv === 'kanban' ? kanbanHtml(list, done) : tv === 'matrix' ? matrixHtml(list) : habitHtml(list)}`;
  return `${head(v, tools)}
  ${changedF ? `<p class="vw-shows"><span class="vw-changed">${esc(t('vwChanged'))}</span></p>` : ''}
  ${card}
  ${fresh.length ? `<section class="just-added"><h2 class="part-h ja-h">${esc(t('justAdded'))} <small>${fresh.length}</small></h2><ul class="list tasks fresh">${fresh.map(row).join('')}</ul></section>` : ''}
  ${(hasRep || sv) && !q && !state.settings.rhythmAsked && (v.f?.type || []).join() === 'repeat' ? rhythmCard() : ''}
  ${sv ? `<p class="hint sv-hint">${esc(t('svHint'))}</p>` : ''}
  ${hasRep ? weekHeader(list.filter((x) => typeOf(x) === 'repeat' && (!sv || x.repeat)), ws) : ''}
  ${list.length ? body : `<p class="empty">${esc(q || n ? t('noMatch') : t('vwEmpty'))}</p>`}
  ${hasRep ? legend() : ''}
  ${endedHtml(v)}
  ${done.length ? `<section class="fold-sec grp-sec">${foldBtn('grp_done', t('grp_done'), done.length)}
    ${folded('grp_done') ? '' : `<ul class="list tasks done">${done.slice(0, 50).map((x) => taskRow(x)).join('')}</ul>
    <button class="btn small ghost" type="button" data-action="clear-done">${esc(t('clearDone'))}</button>`}</section>` : ''}`;
}

// (v117) ✓ Fatte: what's done, newest first; ↺ opens it again; 📦 Archivia tutte moves them to the data repo
// (archive/AAAA-MM.json), out of the app; Impostazioni › Archivio brings them back.
function doneHtml(list) {
  const q = (ui.taskQ || '').trim();
  const l = [...list].sort((a, b) => (b.doneAt || b.updatedAt || 0) - (a.doneAt || a.updatedAt || 0));
  const when = (x) => (x.doneAt ? relDay(localDay(x.doneAt)) : '');
  if (!l.length) return `<p class="empty">${esc(q ? t('noMatch') : t('doneEmpty'))}</p><p class="hint dn-hint">${esc(t('doneEmptyHint'))}</p>`;
  return `<div class="dn-head"><small>${esc(t('doneN', l.length))}</small><button class="btn small" type="button" data-action="vw-archive">📦 ${esc(t('archiveAll'))}</button></div>
    <ul class="list tasks done dn-list">${l.slice(0, 200).map((x) => { const c = catsOf(x)[0]; const color = (c && get('categories', c)?.color) || 'var(--line)'; return `<li class="vw-row rr done" style="--c:${esc(color)}"><button class="task-main" type="button" data-action="task-view" data-id="${esc(x.id)}"><span class="item-text">${taskIcon(x)}${esc(x.title)}<small>${esc([when(x), c ? catName(get('categories', c)) : ''].filter(Boolean).join(' · '))}</small></span></button><button class="icon dn-re" type="button" data-action="task-reopen" data-id="${esc(x.id)}" aria-label="${esc(t("reopen"))}" title="${esc(t('reopen'))}">↺</button></li>`; }).join('')}</ul>
    ${l.length > 200 ? `<p class="hint">${esc(t('nMore', l.length - 200))}</p>` : ''}
    <p class="hint dn-hint">${esc(t('archiveHint'))}</p>`;
}
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// (v117) ＋ Nuova vista: a name, what it shows, how it groups
export function openNewView(draft = { name: '', f: { state: ['toplan', 'planned'] }, by: 'due' }) {
  const f = draft.f;
  const ch = (k, val) => { const on = (f[k] || []).includes(val); return `<button class="fchip${on ? ' on' : ''}" value="f:${k}:${esc(val)}" aria-pressed="${on}" formnovalidate>${esc(valLabel(k, val))}</button>`; };
  const sec = (k, vals) => `<div class="field-label">${esc(t(`vfh_${k}`))}</div><div class="filters">${vals.map((x) => ch(k, x)).join('')}</div>`;
  const n = allItems().filter((x) => matches(x, f) && (f.state?.includes('done') || !x.done)).length;
  openModal(`<h2>＋ ${esc(t('vwNew'))}</h2>
    <label>${esc(t('vwName'))}<input name="vname" value="${esc(draft.name)}" placeholder="${esc(t('vwNamePh'))}" autocomplete="off"></label>
    ${sec('type', TYPES)}${sec('state', STATES)}${sec('when', WHENS)}${sec('cat', ['', ...categories().map((c) => c.id)])}
    <div class="field-label">${esc(t('sortGroup'))}</div><div class="filters">${SORTS.map((k) => `<button class="fchip${draft.by === k ? ' on' : ''}" value="by:${k}" formnovalidate>${esc(t(`srt_${k}`))}</button>`).join('')}</div>
    <p class="hint">${esc(t('vwMatchN', n))}</p>
    <div class="button-row"><button class="btn primary" value="save">${esc(t('vwSaveView'))}</button><button class="btn ghost" value="cancel" formnovalidate>${esc(t('close'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    const name = form.vname.value;
    if (action.startsWith('f:')) { const [, k, val] = action.split(':'); const l = f[k] || []; openNewView({ ...draft, name, f: { ...f, [k]: l.includes(val) ? l.filter((y) => y !== val) : [...l, val] } }); return; }
    if (action.startsWith('by:')) { openNewView({ ...draft, name, by: action.slice(3) }); return; }
    if (action === 'save') {
      if (!name.trim()) { form.vname.focus(); return; }
      const id = `v${Date.now().toString(36)}`;
      saveViews([...viewList(), { id, name: name.trim(), pin: true, f, by: draft.by, dir: draft.by === 'added' ? -1 : 1 }]);
      setView(id); modal.close(); render(); return;
    }
    modal.close();
  }, { cls: 'sheet' });
}

// (v69) Routines that have ended, folded at the bottom of views that show routines: kept, with Riprendi.
function endedHtml(v) {
  const f = filterOf(v);
  if (f.type?.length && !f.type.includes('repeat')) return '';
  const list = endedRoutines().filter((x) => !f.cat?.length || catsOf(x).some((c) => f.cat.includes(c)));
  if (!list.length) return '';
  return `<section class="fold-sec grp-sec">${foldBtn('grp_ended', t('grpEnded'), list.length)}
    ${folded('grp_ended') ? '' : `<ul class="list tasks ended">${list.map((x) => `<li class="vw-row"><span class="vw-rep" aria-hidden="true">↻</span><button class="task-main" type="button" data-action="routine-open" data-id="${esc(x.id)}"><span class="item-text">${esc(x.title)}<small>${esc(x.repeatUntil && (!x.repeatCount || countedOf(x) < x.repeatCount) ? t('endedInfo', relDay(x.repeatUntil), countedOf(x)) : t('endedN', countedOf(x)))}</small></span></button><button class="btn small" type="button" data-action="rt-resume" data-id="${esc(x.id)}">${esc(t('resumeBtn'))}</button></li>`).join('')}</ul>`}</section>`;
}

// ---------- sorting things in place ----------
// (v66) The "when" picks set the due date (no date clears it), and the one already set shows lit.
export const whenDue = (k, td = today()) => (k === 'today' ? td : k === 'tomorrow' ? addDays(td, 1) : k === 'week' ? weekEnd(td) : k === 'next' ? addDays(weekEnd(td), 7) : null);
export function setWhen(x, k) {
  const due = whenDue(k);
  upsert('tasks', k === 'none' ? { ...x, due: null, noDate: true } : { ...x, due: due || x.due || null, noDate: false });
}
export function whenPickOf(x) {
  if (x.noDate && !x.due) return 'none';
  return WHEN_PICKS.find((k) => k !== 'none' && x.due && whenDue(k) === x.due) || null;
}
// A category tapped again comes off (the first one left gives the colour).
export function setCat(x, id) {
  const cs = catsOf(x);
  if (cs.includes(id)) { const rest = cs.filter((c) => c !== id); return upsert('tasks', { ...x, category: rest[0] || null, moreCats: rest.slice(1) }); }
  return upsert('tasks', cs.length ? { ...x, moreCats: [...new Set([...(x.moreCats || []), id])] } : { ...x, category: id });
}
export const setLen = (x, m) => upsert('tasks', { ...x, minutes: m, lenSet: true });
export const LENS = [15, 30, 45, 60, 90, 120];
export const WHEN_PICKS = ['today', 'tomorrow', 'week', 'next', 'none'];
function pickChips(x, k) {
  const ch = (val, label, on) => `<button class="mchip${on ? ' set' : ''}" value="${k}:${esc(val)}">${esc(label)}</button>`;
  if (k === 'cat') return categories().map((c) => ch(c.id, catName(c), catsOf(x).includes(c.id))).join('');
  // (v66) the length it has is always lit, also when it isn't one of the six (20m, 4h…)
  if (k === 'len') { const has = x.lenSet !== false ? x.minutes || 30 : null; const l = has && !LENS.includes(has) ? [...LENS, has].sort((a, b) => a - b) : LENS; return l.map((m) => ch(m, fmtDur(m), has === m)).join('') + (classic() ? '' : ch('other', t('rvOther'), false)); }
  if (classic()) return `${WHEN_PICKS.map((w) => ch(w, t(`wp_${w}`), false)).join('')}${ch('repeat', `↻ ${t('wp_repeat')}`, false)}`;
  const nb = nextPlanned(x.id); const wp = nb ? null : whenPickOf(x);
  return `${WHEN_PICKS.map((w) => ch(w, t(`wp_${w}`), wp === w)).join('')}${ch('grid', nb ? `✓ ${relDay(nb.date)} ${fmtTime(nb.start)}` : t('rvChoose'), Boolean(nb))}`;
}
function applyPick(x, action) {
  const [k, val] = action.split(':');
  if (k === 'cat') setCat(x, val);
  if (k === 'len') { if (val === 'other') return 'other'; setLen(x, Number(val)); }
  if (k === 'when') {
    if (val === 'repeat') return 'repeat';
    if (val === 'grid') return 'grid';
    if (!classic() && whenPickOf(x) === val) upsert('tasks', { ...x, due: null, noDate: false }); // tapped again: off
    else setWhen(x, val);
  }
  return k;
}
// Back from the week grid: a quick pick sets the date; "Altre ripetizioni" opens the task sheet.
async function gridBack(id, how, k, then) {
  if (how === 'quick') setWhen(get('tasks', id), k);
  render();
  if (how === 'more') { const { openTask } = await import('../editors.js'); openTask(get('tasks', id)); return; }
  then();
}
// "Altro…" for the length: a field and OK.
function lenOther(x, back) {
  openModal(`<h2>${esc(x.title)}</h2><label>${esc(t('mLen'))}${durField('rv_len', x.minutes || 30)}</label>
    <div class="button-row"><button class="btn primary" value="ok">${esc(t('rvOk'))}</button><button class="btn ghost" value="back" formnovalidate>${esc(t('back'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    if (action === 'ok') setLen(get('tasks', x.id), readDur(form, 'rv_len', x.minutes || 30));
    render(); back();
  }, { cls: 'sheet' });
}
export function openPick(id, k) {
  const x = get('tasks', id); if (!x) return;
  openModal(`<h2>${esc(x.title)}</h2><div class="field-label">${esc(t(k === 'cat' ? 'mGroup' : k === 'len' ? 'mLen' : 'mWhen'))}</div>
    <div class="vw-miss big">${pickChips(x, k)}</div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('close'))}</button></div>`, async (form, action) => {
    const r = applyPick(get('tasks', id), action);
    if (r === 'repeat') { const { openTask } = await import('../editors.js'); setTimeout(() => openTask(get('tasks', id)), 0); }
    if (r === 'grid') { setTimeout(() => openWeekGrid(get('tasks', id), { onClose: (how, k) => gridBack(id, how, k, () => modal.close()) }), 0); }
    if (r === 'other') { setTimeout(() => lenOther(get('tasks', id), () => modal.close()), 0); }
    render();
  }, { cls: 'sheet' });
}
// (v66) "Rivedi": what's still to plan, one at a time, full screen. Every tap saves; tapping again takes it
// off; the length and the when it has are always lit; "Scegli…" opens the week grid.
export function openReview(ids = toPlanList().map((x) => x.id), i = 0) {
  const all = ids.map((id) => get('tasks', id)).filter((x) => x && !x.deleted);
  const x = all[i];
  if (!x) {
    const left = all.filter((y) => !y.done && !nextPlanned(y.id));
    openModal(`<h2>${esc(t('triDone'))}</h2><p class="hint">${esc(t('rvDoneHint', all.length - left.length, left.length))}</p>
      <div class="button-row">${left.length ? `<button class="btn primary" value="auto">✦ ${esc(t('smartTitle'))} (${left.length})</button>` : ''}<button class="btn${left.length ? '' : ' primary'}" value="cancel">${esc(t('close'))}</button></div>`, async (form, action) => {
      if (action === 'auto') { const { openAutoPlanner } = await import('../editors.js'); location.hash = '#/plan'; setTimeout(() => openAutoPlanner(), 50); }
    }, { cls: 'sheet full tri rv' });
    return;
  }
  const nb = nextPlanned(x.id);
  const sec = (k) => `<div class="field-label">${esc(t(k === 'cat' ? 'mGroup' : k === 'len' ? 'mLen' : 'mWhen'))}</div><div class="vw-miss big">${pickChips(x, k)}</div>`;
  openModal(`<p class="hint tri-n">${esc(t('rvN', i + 1, all.length))}</p>
    <div class="rv-dots" aria-hidden="true">${all.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>
    <h2 class="tri-t">${esc(x.title)}</h2>
    ${sec('cat')}${sec('len')}${sec('when')}
    ${nb ? `<p class="hint ok-text">${esc(t('rvInPlan', `${relDay(nb.date)} ${fmtTime(nb.start)}`))}</p>` : ''}
    <div class="button-row tri-go"><button class="btn primary" value="next">${esc(t('triNext'))}</button><button class="btn ghost" value="cancel">${esc(t('triStop'))}</button></div>
    <button class="linkish danger-text rv-del" value="del" formnovalidate>${esc(t('rvDel'))}</button>`, (form, action, e) => {
    e.preventDefault();
    if (action === 'next') { openReview(ids, i + 1); render(); return; }
    if (action === 'del') { remove('tasks', x.id); render(); openReview(ids.filter((y) => y !== x.id), i); return; }
    const r = applyPick(get('tasks', x.id), action);
    if (r === 'grid') { openWeekGrid(get('tasks', x.id), { onClose: (how, k) => gridBack(x.id, how, k, () => openReview(ids, i)) }); return; }
    if (r === 'other') { lenOther(get('tasks', x.id), () => openReview(ids, i)); return; }
    render(); openReview(ids, i);
  }, { cls: 'sheet full tri rv' });
}
// "Sort now": what's not sorted, one at a time, full screen (classic; v66 has Rivedi).
export function openTriage(ids, i = 0) {
  if (!classic()) { openReview(ids, i); return; }
  ids ||= unsortedList().map((x) => x.id);
  const live1 = ids.map((id) => get('tasks', id)).filter((x) => x && !x.deleted);
  const x = live1[i];
  if (!x) {
    openModal(`<h2>${esc(t('triDone'))}</h2><p class="hint">${esc(t('triDoneHint'))}</p><div class="button-row"><button class="btn primary" value="cancel">${esc(t('close'))}</button></div>`, () => {}, { cls: 'sheet full tri' });
    return;
  }
  const mi = missing(x);
  const sec = (k) => `<div class="field-label">${esc(t(k === 'cat' ? 'mGroup' : k === 'len' ? 'mLen' : 'mWhen'))}${mi.includes(k) ? '' : ' ✓'}</div><div class="vw-miss big">${pickChips(x, k)}</div>`;
  openModal(`<p class="hint tri-n">${esc(t('triN', i + 1, live1.length))}</p><h2 class="tri-t">${esc(x.title)}</h2>
    ${mi.length ? `<p class="hint">${esc(t('triMissing', mi.map((k) => t(k === 'cat' ? 'mGroup' : k === 'len' ? 'mLen' : 'mWhen').toLowerCase()).join(', ')))}</p>` : `<p class="hint ok-text">✓ ${esc(t('triSorted'))}</p>`}
    ${sec('cat')}${typeOf(x) === 'once' ? sec('when') : ''}${sec('len')}
    <div class="button-row tri-go"><button class="btn primary" value="next">${esc(t('triNext'))}</button><button class="btn" value="del">${esc(t('delete'))}</button></div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('triStop'))}</button></div>`, async (form, action, e) => {
    e.preventDefault();
    if (action === 'next') { openTriage(ids, i + 1); render(); return; }
    if (action === 'del') { remove('tasks', x.id); render(); openTriage(ids.filter((y) => y !== x.id), i); return; }
    const r = applyPick(get('tasks', x.id), action);
    if (r === 'repeat') { modal.close(); const { openTask } = await import('../editors.js'); setTimeout(() => openTask(get('tasks', x.id)), 0); render(); return; }
    render(); openTriage(ids, i);
  }, { cls: 'sheet full tri' });
}

// (v91) Overview: «N da completare» (a length or a category missing) with «Completa»; what's still to plan is a
// plain card that goes to the Planner, without a badge.
export function overviewCards({ pane = false } = {}) {
  const nIn = incompleteList().length; const nPl = toPlanList().length;
  return `${nIn ? `<div class="vw-card"><span><b>${esc(t('nToComplete', nIn))}</b><small>${esc(t('toCompleteSub'))}</small></span><button class="btn small primary" type="button" data-action="vw-complete">${esc(t('completeBtn'))}</button></div>` : ''}
    ${nPl ? `<div class="vw-card plain"><b>${esc(t('nToSort', nPl))}</b><a class="btn small" href="#/plan">${esc(t('tabPlan'))} ›</a></div>` : ''}`;
}
// «Completa»: one at a time, asking only for what's missing; it moves on by itself once nothing is.
export function openComplete(ids = incompleteList().map((x) => x.id), i = 0) {
  const list = ids.map((id) => get('tasks', id)).filter((x) => x && !x.deleted);
  const x = list[i];
  if (!x) { modal.close?.(); render(); return; }
  const mi = lacks(x);
  if (!mi.length) { openComplete(ids, i + 1); return; }
  const sec = (k) => `<div class="field-label">${esc(t(k === 'cat' ? 'mGroup' : 'mLen'))}</div><div class="vw-miss big">${pickChips(x, k)}</div>`;
  openModal(`<p class="hint tri-n">${esc(t('cpN', list.slice(i).filter((y) => lacks(y).length).length))}</p><h2 class="tri-t">${esc(x.title)}</h2>
    ${mi.includes('len') ? sec('len') : ''}${mi.includes('cat') ? sec('cat') : ''}
    <p class="hint">${esc(t('cpHint'))}</p>
    <div class="button-row"><button class="btn" value="skip">${esc(t('cpSkip'))}</button><button class="btn ghost" value="stop">${esc(t('close'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    if (action === 'stop') { modal.close(); render(); return; }
    if (action === 'skip') { openComplete(ids, i + 1); return; }
    const r = applyPick(get('tasks', x.id), action);
    if (r === 'other') { lenOther(get('tasks', x.id), () => openComplete(ids, i)); return; }
    render(); openComplete(ids, i);
  }, { cls: 'sheet tri cp' });
}

// ---------- the sheets: views, filters, order ----------
export function openViews() {
  const l = viewList();
  const row = (v) => `<li class="vw-li" ${v.fixed ? '' : `data-sort-key="${esc(v.id)}"`}>${v.fixed ? '<span class="vw-grip off"></span>' : `<button type="button" class="drag-handle vw-grip" aria-label="${esc(t('dragToMove'))}">⠿</button>`}<label class="check"><input type="checkbox" data-pin="${esc(v.id)}" ${v.pin ? 'checked' : ''} ${v.fixed ? 'disabled' : ''}><span>${esc(viewName(v))}${BUILTIN[v.id] ? ` <small class="vw-builtin">${esc(t('vwBuiltin'))}</small>` : ''}</span></label>
    <span class="vw-li-btns">${v.fixed ? `<small class="hint">${esc(t('vwFixed'))}</small>` : `<button class="icon" value="more:${esc(v.id)}" aria-label="${esc(t('options'))}">⋯</button>`}</span></li>`;
  const gone = goneViews().filter((id) => appOn(BUILTIN[id].app));
  const away = allViews().filter((v) => !appOn(BUILTIN[v.id]?.app));
  openModal(`<h2>✎ ${esc(t('vwViews'))}</h2><p class="hint">${esc(t('vwViewsHint2'))}</p>
    <ul class="list vw-ul">${row(l[0])}</ul><ul class="list vw-ul vw-sort" data-sortable="views">${l.slice(1).map(row).join('')}</ul>
    ${gone.length ? `<div class="field-label">${esc(t('vwGone'))}</div><ul class="list vw-ul">${gone.map((id) => `<li class="vw-li gone"><span>${esc(viewName({ id }))}</span><button class="btn small" value="back:${id}">↺ ${esc(t('vwRestore'))}</button></li>`).join('')}</ul>` : ''}
    ${away.length ? `<p class="hint">${esc(t('vwAway', away.map((v) => viewName(v)).join(', ')))}</p>` : ''}
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('doneBtn'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    const [a, id] = action.split(':');
    if (a === 'more') { setTimeout(() => openViewMenu(id), 0); return; }
    if (a === 'back') restoreView(id);
    render(); openViews();
  }, { cls: 'sheet' });
  const form = modal.querySelector('form');
  form.addEventListener('change', (e) => {
    const id = e.target.dataset.pin; if (!id) return;
    patchView(id, { pin: e.target.checked }); render();
  });
  form.addEventListener('sorted', (e) => {
    const keys = e.detail.keys; const cur = viewList();
    saveViews([cur[0], ...keys.map((k) => cur.find((v) => v.id === k)).filter(Boolean)]); render();
  });
}
function openViewMenu(id) {
  const v = viewList().find((y) => y.id === id); if (!v) return;
  const bi = Boolean(BUILTIN[id]);
  openModal(`<h2>${esc(viewName(v))}</h2>
    ${bi ? '' : `<label>${esc(t('vwName'))}<input name="name" value="${esc(viewName(v))}" autocomplete="off"></label>`}
    <p class="hint">${esc(t(bi ? 'vwTakeAwayHint' : 'vwDelHint'))}</p>
    <div class="button-row">${bi ? '' : `<button class="btn primary" value="save">${esc(t('save'))}</button>`}<button class="btn danger" value="del">${esc(t(bi ? 'vwTakeAway' : 'vwDelete'))}</button><button class="btn ghost" value="back">${esc(t('back'))}</button></div>`, (form, action) => {
    if (action === 'save' && form.name?.value.trim()) patchView(id, { name: form.name.value.trim() });
    if (action === 'del') { if (bi) takeAwayView(id); else saveViews(viewList().filter((y) => y.id !== id)); if (curView().id === id) setView('overview'); }
    render(); setTimeout(openViews, 0);
  }, { cls: 'sheet' });
}
export function openFilters() {
  const v = curView();
  const f = filterOf(v);
  const ch = (k, val) => { const on = (f[k] || []).includes(val); return `<button class="fchip${on ? ' on' : ''}" value="f:${k}:${esc(val)}" aria-pressed="${on}">${esc(valLabel(k, val))}</button>`; };
  const sec = (k, vals) => `<div class="field-label">${esc(t(`vfh_${k}`))}</div><div class="filters">${vals.map((x) => ch(k, x)).join('')}</div>`;
  const changedF = !sameF(f, v.f);
  const by = v.by || 'when';
  const top = classic() ? '' : `<div class="field-label">${esc(t('sortGroup'))}</div><div class="filters">${SORTS.map((k) => `<button class="fchip${k === by ? ' on' : ''}" value="by:${k}">${esc(t(`srt_${k}`))}${k === by ? ` ${(v.dir ?? 1) < 0 ? '↓' : '↑'}` : ''}</button>`).join('')}</div>
    <div class="filters"><button class="fchip${ui.impQuick ? ' on' : ''}" value="quick" aria-pressed="${Boolean(ui.impQuick)}">⚡ ${esc(t('impQuick'))}</button></div>`;
  openModal(`<h2>⇅ ${esc(t('filters'))} · ${esc(viewName(v))}</h2>
    ${top}${sec('type', TYPES)}${sec('state', STATES)}${sec('when', WHENS)}${sec('cat', ['', ...categories().map((c) => c.id)])}
    <label class="vw-save">${esc(t('vwSaveAs'))}<span class="row"><input name="vname" placeholder="${esc(t('vwNamePh'))}" autocomplete="off"><button class="btn small" value="saveas">＋ ${esc(t('vwSave'))}</button></span></label>
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('vwShow'))}</button>${changedF ? `<button class="btn" value="reset">${esc(t('vwAsBefore'))}</button>` : ''}${changedF && !v.fixed ? `<button class="btn" value="keep">${esc(t('vwKeep'))}</button>` : ''}</div>`, (form, action, e) => {
    e.preventDefault();
    if (action.startsWith('f:')) {
      const [, k, val] = action.split(':');
      const cur = filterOf(v); const l = cur[k] || [];
      ui.vTemp = { id: v.id, f: { ...cur, [k]: l.includes(val) ? l.filter((y) => y !== val) : [...l, val] } };
    }
    if (action.startsWith('by:')) { const k = action.slice(3); patchView(v.id, k === by ? { dir: -(v.dir ?? 1) } : { by: k, dir: k === 'added' ? -1 : 1 }); }
    if (action === 'quick') ui.impQuick = !ui.impQuick;
    if (action === 'reset') ui.vTemp = null;
    if (action === 'keep') { patchView(v.id, { f: filterOf(v) }); ui.vTemp = null; }
    if (action === 'saveas') {
      const name = form.vname.value.trim(); if (!name) { form.vname.focus(); return; }
      const id = `v${Date.now().toString(36)}`;
      saveViews([...viewList(), { id, name, pin: true, f: filterOf(v), by: v.by || 'when', dir: v.dir ?? 1 }]);
      ui.vTemp = null; setView(id); modal.close(); render(); return;
    }
    render(); openFilters();
  }, { cls: 'sheet' });
}
export function openSort() {
  const v = curView(); const by = v.by || 'when'; const dir = v.dir ?? 1;
  openModal(`<h2>▤ ${esc(t('sortGroup'))}</h2><p class="hint">${esc(t('sortAgainHint'))}</p>
    <div class="add-opts">${SORTS.map((k) => `<button class="add-opt${k === by ? ' on' : ''}" value="${k}"><span class="item-text">${esc(t(`srt_${k}`))}${k === by ? ` · ${esc(by === 'added' ? sortLabel(v) : dir < 0 ? '↓' : '↑')}` : ''}<small>${esc(t(`srtH_${k}`))}</small></span></button>`).join('')}</div>
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('doneBtn'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    patchView(v.id, action === by ? { dir: -dir } : { by: action, dir: action === 'added' ? -1 : 1 });
    render(); openSort();
  }, { cls: 'sheet' });
}

// ---------- what the + knows about the view you're on ----------
export const catToken = (id) => `#${catName(get('categories', id)).toLowerCase().replace(/\s+/g, '')}`;
export function viewTokens(v = curView()) {
  if (v.shop || v.fixed) return '';
  const f = v.f || {};
  const bits = [...(f.cat || []).filter(Boolean).slice(0, 2).map(catToken)];
  if (f.when?.length && !f.when.includes('none')) bits.push(f.when.includes('today') && f.when.length === 1 ? t('tokToday') : t('tokWeek'));
  return bits.length ? `${bits.join(' ')} ` : '';
}
// Would a thing with these fields show in the view? (the + warns when it wouldn't)
export function wouldShow(v, fields) {
  const f = v.f || {};
  const x = { ...fields, id: '_new', createdAt: Date.now() };
  if (f.cat?.length && !catsOf(x).some((c) => f.cat.includes(c))) return false;
  if (f.when?.length) { const d = x.due; const w = !d ? 'none' : d <= today() ? 'today' : d <= weekEnd() ? 'week' : 'later'; if (!f.when.includes(w)) return false; }
  return true;
}
