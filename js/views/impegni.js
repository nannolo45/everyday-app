// views/impegni.js (v55): the To do tab ("Impegni") as saved views.
// Everything you keep lives in one place: one-off things, things that come back (routines) and, in its
// own view, the shopping list. A view is a set of filters with a name; the ones you pin are the tabs at
// the top (three to a row). Overview is always first: everything, newest first, with what isn't sorted
// yet tagged "to sort". Views and their order are kept on this device (Settings).
import { catName, catsOf, categories, esc, modal, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isTodo } from '../kinds.js';
import { countedOf, nextPlanned } from '../model.js';
import { addDays, fmtDur, fmtTime, sortTasks, today } from '../plan.js';
import { endedRoutines, isArchived, isRoutine, legend, routineRow, weekHeader } from '../routines.js';
import { matchesQ } from '../shoplist.js';
import { get, live, remove, saveSettings, state, upsert } from '../store.js';
import { render } from '../shell.js';
import { durField, openModal, readDur, searchBox } from '../widgets.js';
import { openWeekGrid } from '../weekgrid.js';
import { weekStart } from './planner.js';
import { SH, viewShop } from './shop.js';
import { foldBtn, folded, taskHay, taskRow } from './tasks.js';

// The older layouts stay reachable for the older test suites (a switch kept on the device, not a setting).
export const classic = () => { try { return localStorage.getItem('everyday-classic') === '1'; } catch { return false; } };

export const RICETTE_APP = 'https://nannolo45.github.io/ricette-app/';
export const TYPES = ['once', 'repeat'];
export const STATES = ['toplan', 'planned', 'done'];
export const WHENS = ['today', 'week', 'later', 'none'];
export const SORTS = ['added', 'when', 'cat', 'type'];

export function defaultViews() {
  return [
    { id: 'overview', fixed: true, pin: true, f: {}, by: 'added', dir: -1 },
    { id: 'week', pin: true, f: { when: ['today', 'week'] }, by: 'when', dir: 1 },
    { id: 'shop', pin: true, shop: true, f: {} },
    { id: 'workout', pin: true, f: { cat: ['health'] }, app: 'palestra', by: 'when', dir: 1 },
    { id: 'home', pin: true, f: { cat: ['home'] }, by: 'when', dir: 1 },
    { id: 'routine', pin: true, f: { type: ['repeat'] }, by: 'cat', dir: 1 }, // (v81) the routines' week, ready
    { id: 'toplan', pin: false, f: { state: ['toplan'] }, by: 'when', dir: 1 },
    { id: 'meals', pin: false, f: { cat: ['meals'] }, app: 'ricette', by: 'when', dir: 1 },
    { id: 'work', pin: false, f: { cat: ['work'] }, by: 'when', dir: 1 },
    { id: 'personal', pin: false, f: { cat: ['personal'] }, by: 'when', dir: 1 },
  ];
}
export function viewList() {
  const list = (state.settings.views || defaultViews()).filter(Boolean);
  if (!list.some((v) => v.id === 'overview')) list.unshift(defaultViews()[0]);
  // (v81) views saved before the Routine view existed get it once (unless you deleted it)
  if (state.settings.views && !state.settings.rtViewGone && !list.some((v) => v.id === 'routine' || (!v.fixed && (v.f?.type || []).join() === 'repeat' && !v.f?.cat?.length))) list.push(defaultViews().find((v) => v.id === 'routine'));
  return list;
}
const saveViews = (list) => saveSettings({ views: list });
export const viewName = (v) => v.name || t(`vw_${v.id}`);
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
export const toPlanList = () => allItems().filter((x) => !x.done && typeOf(x) === 'once' && !nextPlanned(x.id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
export function matches(x, f = {}) {
  if (f.type?.length && !f.type.includes(typeOf(x))) return false;
  if (f.state?.length && !f.state.includes(stateOf(x))) return false;
  if (f.when?.length && !f.when.includes(whenOf(x))) return false;
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
  const parts = ['type', 'state', 'when', 'cat'].filter((k) => f[k]?.length).map((k) => f[k].map((x) => valLabel(k, x)).join(t('orWord')));
  return t('vwShows', parts.length ? parts.join(' · ') : t('vwEverything'));
}

// ---------- grouping and order ----------
function addedKey(x, td) {
  const d = x.createdAt ? new Date(x.createdAt) : null;
  if (!d) return 'earlier';
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return s === td ? 'today' : s === addDays(td, -1) ? 'yesterday' : s >= addDays(td, -6) ? 'week' : 'earlier';
}
export function groupsOf(list, by, dir = 1) {
  const td = today();
  const cats = categories().map((c) => c.id);
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
  const open = ui.openRow === x.id;
  const meta = [dateOf(x) ? relDay(dateOf(x)) : '', x.lenSet === false ? '' : fmtDur(x.minutes || 30), ...catsOf(x).map((c) => catName(get('categories', c)))].filter(Boolean).join(' · ');
  const box = typeOf(x) === 'repeat' ? '<span class="vw-rep" aria-hidden="true">↻</span>' : `<input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`;
  return `<li class="vw-row${open ? ' open' : ''}${x.done ? ' done' : ''}">${box}
    <button class="task-main" type="button" data-action="${typeOf(x) === 'repeat' && !classic() ? 'routine-open' : 'vw-row'}" data-id="${esc(x.id)}" aria-expanded="${open}"><span class="item-text">${esc(x.title)}${meta ? `<small>${esc(meta)}</small>` : ''}</span></button>${tag(x)}
    ${open ? missChips(x) : ''}</li>`;
}
function fullRow(x, ws) {
  if (typeOf(x) === 'repeat') return routineRow(x, ws);
  if (!unsorted(x)) return taskRow(x);
  return plainRow(x);
}

// ---------- the tab ----------
function tabs(cur) {
  const l = viewList();
  const nUn = (classic() ? unsortedList() : toPlanList()).length;
  const nShop = live(SH()).filter((i) => !i.checked).length;
  const btn = (v) => `<button type="button" role="tab" class="${v.id === cur.id ? 'on' : ''}${v.pin ? '' : ' loose'}" aria-selected="${v.id === cur.id}" data-action="vw-tab" data-id="${esc(v.id)}">${esc(viewName(v))}${v.fixed && nUn ? ` <span class="nbadge">${nUn > 99 ? '99+' : nUn}</span>` : v.shop && nShop ? ` <small>${nShop > 99 ? '99+' : nShop}</small>` : ''}</button>`;
  return `<div class="seg vw-tabs" role="tablist">${l.filter((v) => v.pin).map(btn).join('')}${cur.pin ? '' : btn(cur)}<button type="button" class="vw-edit" data-action="vw-views">✎ ${esc(t('vwViews'))}</button></div>`;
}
export function viewImpegni() {
  const v = curView();
  const top = tabs(v);
  if (v.shop) return `${top}<p class="vw-shows">${esc(showsText(v))}</p>${viewShop()}`;
  const f = filterOf(v);
  const q = (ui.taskQ || '').trim();
  const ws = ui.routineWeek || weekStart(today());
  const showDone = f.state?.includes('done');
  const pool = allItems().filter((x) => matches(x, f) && (!q || matchesQ(taskHay(x), q)));
  const list = showDone ? pool : pool.filter((x) => !x.done);
  const done = showDone ? [] : pool.filter((x) => x.done);
  const n = nOf(f);
  const changedF = ui.vTemp?.id === v.id && !sameF(ui.vTemp.f, v.f);
  const tools = `<div class="task-tools">${searchBox({ id: 'task-q', value: ui.taskQ || '' })}
    <button class="btn small tools-btn${n ? ' on' : ''}" type="button" data-action="vw-filters">⇅ ${esc(t('filters'))}${n ? ` · ${n}` : ''}</button>
    <button class="btn small tools-btn" type="button" data-action="vw-sort" aria-label="${esc(t('sortGroup'))}">▤ ${esc(sortLabel(v))}</button></div>`;
  const nUn = (classic() ? unsortedList() : toPlanList()).length;
  const card = v.fixed && nUn && !q ? `<div class="vw-card"><b>${esc(t('nToSort', nUn))}</b><button class="btn small primary" type="button" data-action="vw-triage">${esc(t('sortNow'))}</button></div>` : '';
  const groups = groupsOf(list, v.by || 'when', v.dir ?? 1);
  const hasRep = !v.fixed && list.some((x) => typeOf(x) === 'repeat');
  const row = v.fixed ? plainRow : (x) => fullRow(x, ws);
  const fresh = !v.fixed ? [...(ui.justAdded || [])].map((id) => get('tasks', id)).filter((x) => x && list.includes(x)) : [];
  const freshSet = new Set(fresh);
  const body = groups.map((g) => { const l = g.list.filter((x) => !freshSet.has(x)); return l.length ? `<section class="vw-grp"><h3 class="vw-gh">${esc(g.label)} <small>${l.length}</small></h3><ul class="list tasks${v.fixed ? ' plain' : ' saved routines'}">${l.map(row).join('')}</ul></section>` : ''; }).join('');
  return `${top}
  <p class="vw-shows">${esc(showsText(v))}${changedF ? ` <span class="vw-changed">· ${esc(t('vwChanged'))}</span>` : ''}</p>
  ${tools}
  ${card}
  ${fresh.length ? `<section class="just-added"><h2 class="part-h ja-h">${esc(t('justAdded'))} <small>${fresh.length}</small></h2><ul class="list tasks fresh">${fresh.map(row).join('')}</ul></section>` : ''}
  ${hasRep ? weekHeader(list.filter((x) => typeOf(x) === 'repeat'), ws) : ''}
  ${list.length ? body : `<p class="empty">${esc(q || n ? t('noMatch') : t('vwEmpty'))}</p>`}
  ${hasRep ? legend() : ''}
  ${endedHtml(v)}
  ${done.length ? `<section class="fold-sec grp-sec">${foldBtn('grp_done', t('grp_done'), done.length)}
    ${folded('grp_done') ? '' : `<ul class="list tasks done">${done.slice(0, 50).map((x) => taskRow(x)).join('')}</ul>
    <button class="btn small ghost" type="button" data-action="clear-done">${esc(t('clearDone'))}</button>`}</section>` : ''}`;
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

// ---------- the sheets: views, filters, order ----------
export function openViews() {
  const l = viewList();
  const row = (v, i) => `<li class="vw-li"><label class="check"><input type="checkbox" data-pin="${esc(v.id)}" ${v.pin ? 'checked' : ''} ${v.fixed ? 'disabled' : ''}><span>${esc(viewName(v))}</span></label>
    <span class="vw-li-btns">${v.fixed ? `<small class="hint">${esc(t('vwFixed'))}</small>` : `<button class="icon" value="up:${esc(v.id)}" ${i <= 1 ? 'disabled' : ''} aria-label="${esc(t('moveUp'))}">▲</button><button class="icon" value="down:${esc(v.id)}" ${i === l.length - 1 ? 'disabled' : ''} aria-label="${esc(t('moveDown'))}">▼</button><button class="icon" value="more:${esc(v.id)}" aria-label="${esc(t('options'))}">⋯</button>`}</span></li>`;
  openModal(`<h2>✎ ${esc(t('vwViews'))}</h2><p class="hint">${esc(t('vwViewsHint'))}</p>
    <ul class="list vw-ul">${l.map(row).join('')}</ul>
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('doneBtn'))}</button></div>`, (form, action, e) => {
    e.preventDefault();
    const [a, id] = action.split(':');
    const cur = viewList(); const i = cur.findIndex((v) => v.id === id);
    if ((a === 'up' && i > 1) || (a === 'down' && i < cur.length - 1)) { const j = a === 'up' ? i - 1 : i + 1; [cur[i], cur[j]] = [cur[j], cur[i]]; saveViews(cur); }
    if (a === 'more') { setTimeout(() => openViewMenu(id), 0); return; }
    render(); openViews();
  }, { cls: 'sheet' });
  modal.querySelector('form').addEventListener('change', (e) => {
    const id = e.target.dataset.pin; if (!id) return;
    patchView(id, { pin: e.target.checked }); render();
  });
}
function openViewMenu(id) {
  const v = viewList().find((y) => y.id === id); if (!v) return;
  openModal(`<h2>${esc(viewName(v))}</h2>
    <label>${esc(t('vwName'))}<input name="name" value="${esc(viewName(v))}" autocomplete="off"></label>
    <p class="hint">${esc(t('vwDelHint'))}</p>
    <div class="button-row"><button class="btn primary" value="save">${esc(t('save'))}</button><button class="btn danger" value="del">${esc(t('vwDelete'))}</button><button class="btn ghost" value="back">${esc(t('back'))}</button></div>`, (form, action) => {
    if (action === 'save' && form.name.value.trim()) patchView(id, { name: form.name.value.trim() });
    if (action === 'del') { saveViews(viewList().filter((y) => y.id !== id)); if (id === 'routine') saveSettings({ rtViewGone: true }); if (curView().id === id) setView('overview'); }
    render(); setTimeout(openViews, 0);
  }, { cls: 'sheet' });
}
export function openFilters() {
  const v = curView();
  const f = filterOf(v);
  const ch = (k, val) => { const on = (f[k] || []).includes(val); return `<button class="fchip${on ? ' on' : ''}" value="f:${k}:${esc(val)}" aria-pressed="${on}">${esc(valLabel(k, val))}</button>`; };
  const sec = (k, vals) => `<div class="field-label">${esc(t(`vfh_${k}`))}</div><div class="filters">${vals.map((x) => ch(k, x)).join('')}</div>`;
  const changedF = !sameF(f, v.f);
  openModal(`<h2>⇅ ${esc(t('filters'))} · ${esc(viewName(v))}</h2>
    ${sec('type', TYPES)}${sec('state', STATES)}${sec('when', WHENS)}${sec('cat', ['', ...categories().map((c) => c.id)])}
    <label class="vw-save">${esc(t('vwSaveAs'))}<span class="row"><input name="vname" placeholder="${esc(t('vwNamePh'))}" autocomplete="off"><button class="btn small" value="saveas">＋ ${esc(t('vwSave'))}</button></span></label>
    <div class="button-row"><button class="btn primary" value="cancel">${esc(t('vwShow'))}</button>${changedF ? `<button class="btn" value="reset">${esc(t('vwAsBefore'))}</button>` : ''}${changedF && !v.fixed ? `<button class="btn" value="keep">${esc(t('vwKeep'))}</button>` : ''}</div>`, (form, action, e) => {
    e.preventDefault();
    if (action.startsWith('f:')) {
      const [, k, val] = action.split(':');
      const cur = filterOf(v); const l = cur[k] || [];
      ui.vTemp = { id: v.id, f: { ...cur, [k]: l.includes(val) ? l.filter((y) => y !== val) : [...l, val] } };
    }
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
