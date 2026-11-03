// views/wide.js (v56): the layout for wide screens (1100px and more).
// A rail on the left (the four tabs, Impegni's views with their counts, this week's days with how full
// they are), the tab in the middle, and a pane on the right: what you tapped on Impegni and Eventi, the
// things to plan on the Planner (pick one and the free time it fits in lights up), what's waiting on Oggi.
// On a phone nothing changes.
import { planCounts } from './planner.js';
import { planBadge } from '../shell.js';
import { catName, catsOf, categories, esc, fmtDay, modal, relDay, route, ui } from '../core.js';
import { t } from '../i18n.js';
import { eventReadiness, eventTasksOf, leadOf, plannedWhen, setTaskDone } from '../model.js';
import { openEvent, openTask } from '../editors.js';
import { addDays, fmtDur, fmtTime, parseDate, today } from '../plan.js';
import { trayTasks } from '../planning.js';
import { repeatText } from '../widgets.js';
import { get, live, upsert } from '../store.js';
import { changed, render } from '../shell.js';
import { allItems, classic, curView, dateOf, LENS, matches, missing, openTriage, setLen, setView, setWhen, toPlanList, typeOf, viewList, viewName, WHEN_PICKS, whenPickOf } from './impegni.js';
import { finderHtml } from '../finder.js';
import { moveBlockTo, placeItem } from '../placing.js';
import { openWeekGrid } from '../weekgrid.js';
import { leaveShop, SH } from './shop.js';
import { eventItems } from './events.js';
import { loadBar, weekStart } from './planner.js';

const MQ = typeof matchMedia === 'function' ? matchMedia('(min-width: 1100px)') : null;
export const isWide = () => Boolean(MQ?.matches) && !classic();
MQ?.addEventListener?.('change', () => { ui.lastHtml = null; render(); });

const ICONS = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.8l3 1.8"/></svg>',
  events: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="m9.2 15.5 2 2 3.8-4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><path d="m4 6.5 1.8 1.8L9 5M4 12.5l1.8 1.8L9 11M4 18.5l1.8 1.8L9 17M12.5 7h7.5M12.5 13h7.5M12.5 19h7.5"/></svg>',
  plan: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h4M7.5 17h7"/></svg>',
};
const TAB_KEYS = { today: 'tabToday', events: 'tabEvents', tasks: 'tabTasks', plan: 'tabPlan' };
const tabOf = (name) => (name === 'shop' ? 'tasks' : name);

// ---------- the rail ----------
function rail() {
  const r = route(); const cur = tabOf(r.name);
  const nUn = toPlanList().length;
  const v = curView();
  const views = cur === 'tasks' ? `${viewList().filter((y) => y.pin || y.id === v.id).map((y) => {
    const n = y.shop ? live(SH()).filter((i) => !i.checked).length : allItems().filter((x) => !x.done && matches(x, y.f || {})).length;
    return `<button type="button" class="rl-sub${y.id === v.id ? ' on' : ''}" data-action="rail-view" data-id="${esc(y.id)}"><span>${esc(viewName(y))}</span>${y.fixed && nUn ? `<span class="nbadge">${nUn}</span>` : `<small>${n || ''}</small>`}</button>`;
  }).join('')}<button type="button" class="rl-sub rl-edit" data-action="vw-views">✎ ${esc(t('vwViews'))}</button>` : '';
  const td = today(); const end = addDays(weekStart(td), 6);
  const days = []; for (let d = td; d <= end; d = addDays(d, 1)) days.push(d);
  return `<aside class="rail" aria-label="${esc(t('railNav'))}">
    ${['today', 'events', 'tasks', 'plan'].map((k) => `<a class="rl-tab${cur === k ? ' on' : ''}" href="#/${k}"><span class="rl-ico">${ICONS[k]}</span><span>${esc(t(TAB_KEYS[k]))}</span>${k === 'tasks' && nUn && cur !== 'tasks' ? `<span class="nbadge">${nUn}</span>` : ''}${k === 'plan' ? (() => { const c = planCounts(); return c.toPlan || c.behind ? `<span class="plan-count rl">${planBadge(c)}</span>` : ''; })() : ''}</a>${k === 'tasks' ? views : ''}`).join('')}
    <div class="rl-sep"></div>
    <div class="rl-lab">${esc(t('vf_when_week'))}</div>
    ${days.map((d) => `<button type="button" class="rl-day${r.name === 'plan' && ui.shownDate === d ? ' on' : ''}" data-action="rail-day" data-id="${d}"><span>${esc(d === td ? t('today') : fmtDay(d, { weekday: 'short', day: 'numeric' }))}</span>${loadBar(d, { text: false })}</button>`).join('')}
  </aside>`;
}

// ---------- the pane ----------
const chip = (action, k, v, label, on, miss = false) => `<button type="button" class="mchip${on ? ' set' : ''}${miss ? '' : ' plain'}" data-action="${action}" data-k="${k}" data-v="${esc(v)}">${esc(label)}</button>`;
function paneTask() {
  const x = ui.paneSel && get('tasks', ui.paneSel);
  if (!x || x.deleted) return `<p class="hint pn-empty">${esc(t('pnNone'))}</p>`;
  const mi = missing(x); const rep = typeOf(x) === 'repeat';
  const d = dateOf(x); const planned = plannedWhen(x);
  const kv = [
    [t('place'), x.place ? `📍 ${x.place}` : '—'],
    [t('importance'), t(`imp_${x.importance || 3}`)],
    x.eventId && get('tasks', x.eventId) ? [t('pnEvent'), `📅 ${get('tasks', x.eventId).title}`] : null,
    [t('pnPlanned'), planned || '—'],
    [t('steps'), String((x.steps || []).filter((y) => y.title && !y.travel).length || '—')],
  ].filter(Boolean);
  return `<div class="pn-task"><h2>${esc(x.title)}</h2>
    <div class="field-label">${esc(t('mGroup'))}</div><div class="vw-miss big">${categories().map((c) => chip('pn-set', 'cat', c.id, catName(c), catsOf(x).includes(c.id), mi.includes('cat'))).join('')}</div>
    <div class="field-label">${esc(t('mWhen'))}</div><div class="vw-miss big">${rep ? `<span class="mchip set">↻ ${esc(x.repeat ? repeatText(x) : t('kc_saved'))}</span>` : `${WHEN_PICKS.map((w) => chip('pn-set', 'when', w, t(`wp_${w}`), !planned && whenPickOf(x) === w, mi.includes('when'))).join('')}${chip('pn-grid', 'when', x.id, planned ? `✓ ${planned}` : t('rvChoose'), Boolean(planned), true)}${d ? `<span class="pn-now">${esc(relDay(d))}</span>` : x.noDate ? `<span class="pn-now">${esc(t('vf_when_none'))}</span>` : ''}`}</div>
    <div class="field-label">${esc(t('mLen'))}</div><div class="vw-miss big">${lensFor(x).map((m) => chip('pn-set', 'len', m, fmtDur(m), x.lenSet !== false && (x.minutes || 30) === m, mi.includes('len'))).join('')}</div>
    <dl class="pn-kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="button-row left">
      ${!rep && !planned && !x.done ? `<button class="btn primary" type="button" data-action="pn-plan" data-id="${esc(x.id)}">▶ ${esc(t('pnPlan'))}</button>` : ''}
      ${rep ? `<button class="btn primary" type="button" data-action="routine-open" data-id="${esc(x.id)}">${esc(t('pnOpenRoutine'))}</button>` : `<button class="btn" type="button" data-action="pn-done" data-id="${esc(x.id)}">${x.done ? '↺' : '✓'} ${esc(x.done ? t('pnUndone') : t('markDone'))}</button>`}
      <button class="btn" type="button" data-action="task-edit" data-id="${esc(x.id)}">${esc(t('pnAll'))}</button>
    </div>
    ${!rep && !planned && !x.done ? `<p class="hint">${esc(t('pnPlanHint'))}</p>` : ''}</div>`;
}
// (v66) the length it has always shows lit, also when it isn't one of the six
const lensFor = (x) => { const m = x.lenSet !== false ? x.minutes || 30 : null; return m && !LENS.includes(m) ? [...LENS, m].sort((a, b) => a - b) : LENS; };
// (v66) the Planner's pane: Da pianificare · Nel piano · Tutte, and the search (finder.js)
function panePlan() { return finderHtml({ props: true }); } // (v67) with the proposals on top
function paneEvent() {
  const items = eventItems();
  const e = items.find((y) => y.id === ui.evSel && (!ui.evDate || y.date === ui.evDate)) || items.find((y) => y.id === ui.evSel);
  if (!e) return `<p class="hint pn-empty">${esc(t('pnEvNone'))}</p>`;
  const when = e.allDay ? t('allDay') : e.start != null ? fmtTime(e.start) + (e.minutes ? `–${fmtTime(e.start + e.minutes)}` : '') : t('timeTbd');
  const tied = e.own ? eventTasksOf(e.id) : [];
  const r = e.own ? eventReadiness(e.id) : null;
  return `<div class="pn-task"><h2>${esc(e.title)}</h2>
    <dl class="pn-kv"><dt>${esc(t('mWhen'))}</dt><dd>${esc(`${fmtDay(e.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${when}`)}</dd>
    ${e.place ? `<dt>${esc(t('place'))}</dt><dd>📍 ${esc(e.place)}</dd>` : ''}<dt>${esc(t('pnCalendar'))}</dt><dd>${esc(e.own ? 'Everyday' : e.calendar || '')}</dd></dl>
    ${e.own ? `<div class="field-label">${esc(t('pnTied'))}</div>${tied.length ? `<ul class="list tasks">${tied.map((x) => `<li><input type="checkbox" data-action="task-done" data-id="${esc(x.id)}" ${x.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}"><button class="task-main" type="button" data-action="task-edit" data-id="${esc(x.id)}"><span class="item-text">${esc(x.title)}<small>${esc([x.due ? relDay(x.due) : '', plannedWhen(x) || (x.done ? '' : t('vf_state_toplan'))].filter(Boolean).join(' · '))}</small></span></button></li>`).join('')}</ul>` : `<p class="hint">${esc(t('pnNoTied'))}</p>`}` : ''}
    <div class="button-row left">
      ${r?.unplanned ? `<button class="btn primary" type="button" data-action="ev-prep">✦ ${esc(t('evPrepare'))}</button>` : ''}
      <button class="btn" type="button" data-action="pn-ev-open" data-id="${esc(e.id)}">${esc(t('pnAll'))}</button>
    </div></div>`;
}
function paneToday() {
  const nUn = toPlanList().length; const nPlan = trayTasks().length;
  const td = today();
  const next = eventItems().filter((e) => e.date >= td).slice(0, 4);
  return `<h2 class="pn-h">${esc(t('pnWaiting'))}</h2>
    ${nUn ? `<div class="vw-card"><b>${esc(t('nToSort', nUn))}</b><button class="btn small primary" type="button" data-action="pn-triage">${esc(t('sortNow'))}</button></div>` : ''}
    ${nPlan ? `<div class="ag-card-top"><span><b>${esc(t('agToPlan', nPlan))}</b></span><a class="btn small" href="#/plan">${esc(t('tabPlan'))} ›</a></div>` : ''}
    ${next.length ? `<div class="field-label">${esc(t('pnNextEvents'))}</div><ul class="ev2-list">${next.map((e) => `<li class="ev2"><span class="ev2-date"><small>${esc(fmtDay(e.date, { weekday: 'short' }))}</small><b>${parseDate(e.date).getDate()}</b></span><span class="ev2-col"><a class="ev2-card" href="#/events" style="--c:${esc(e.color || 'var(--accent)')}"><span class="ag-t">${esc(e.title)}</span><small>${esc(e.allDay ? t('allDay') : e.start != null ? fmtTime(e.start) : '')}</small></a></span></li>`).join('')}</ul>` : ''}`;
}
export function paneHtml() {
  const r = route();
  if (r.name === 'tasks' || r.name === 'shop') return curView().shop ? '' : paneTask();
  if (r.name === 'plan') return panePlan();
  if (r.name === 'events') return paneEvent();
  if (r.name === 'today') return paneToday();
  return '';
}
// The page on a wide screen: rail · tab · pane.
export function wideWrap(html) {
  const pane = paneHtml();
  // the row open in the pane stays marked in the list
  const r = route(); const sel = r.name === 'events' ? ui.evSel : ['tasks', 'shop'].includes(r.name) ? ui.paneSel : null;
  const mark = sel && /^[\w-]+$/.test(sel) ? `<style>.wide-main li:has(> [data-id="${sel}"]:not(input)), .wide-main .ev2:has([data-id="${sel}"]) .ev2-card { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }</style>` : '';
  return `${mark}<div class="wide${pane ? '' : ' no-pane'}">${rail()}<div class="wide-main">${html}</div>${pane ? `<aside class="pane" aria-label="${esc(t('pnLabel'))}">${pane}</aside>` : ''}</div>`;
}

// ---------- clicks that mean something else on a wide screen ----------
function toggleCat(x, id) {
  const cs = catsOf(x);
  if (cs.includes(id)) { const rest = cs.filter((c) => c !== id); return upsert('tasks', { ...x, category: rest[0] || null, moreCats: rest.slice(1) }); }
  return upsert('tasks', cs.length ? { ...x, moreCats: [...(x.moreCats || []), id] } : { ...x, category: id });
}
export function wideClick(btn) {
  if (!isWide()) return false;
  const { action, id } = btn.dataset;
  const inMain = Boolean(btn.closest('.wide-main'));
  const r = route();
  // Opening a row selects it into the pane instead of covering the list with a sheet.
  if (inMain && (r.name === 'tasks') && ['task-edit', 'vw-row', 'routine-open'].includes(action)) { ui.paneSel = id; render(); return true; }
  if (inMain && r.name === 'events' && action === 'event-open') { ui.evSel = id; render(); return true; }
  switch (action) {
    case 'rail-view': { const v = viewList().find((y) => y.id === id); if (!v?.shop) leaveShop(); setView(id); if (r.name === 'tasks') render(); else location.hash = '#/tasks'; return true; }
    case 'rail-day': ui.view = 'day'; ui.scrolledFor = null; location.hash = `#/plan/${id}`; return true;
    case 'pn-set': {
      const x = get('tasks', ui.paneSel); if (!x) return true;
      const v = btn.dataset.v; const k = btn.dataset.k;
      if (k === 'cat') toggleCat(x, v);
      if (k === 'len') setLen(x, Number(v));
      if (k === 'when') { if (whenPickOf(x) === v) upsert('tasks', { ...x, due: null, noDate: false }); else setWhen(x, v); }
      render(); return true;
    }
    case 'pn-grid': { const x = get('tasks', ui.paneSel || btn.dataset.v); if (x) openWeekGrid(x, { onClose: (how, k) => { if (how === 'quick') setWhen(get('tasks', x.id), k); if (how === 'more') { openTask(get('tasks', x.id)); return; } modal.close(); render(); } }); return true; }
    case 'pn-done': { const x = get('tasks', id); if (x) { setTaskDone(x, !x.done); changed(); } return true; }
    case 'pn-plan': ui.pick = id; ui.view = 'day'; location.hash = `#/plan/${today()}`; return true;
    case 'pn-pick': ui.pick = ui.pick === id ? null : id; render(); return true;
    case 'pn-triage': setView('overview'); location.hash = '#/tasks'; setTimeout(() => openTriage(), 50); return true;
    case 'pn-ev-open': { const own = get('tasks', id); if (own) openTask(own); else { const ev = live('events').find((e) => e.id === id); if (ev) openEvent(ev); } return true; }
    default: return false;
  }
}
// A free stretch tapped while something is picked: it goes there.
export function placePicked(date, start, min) {
  const pb = ui.pickBlock && get('blocks', ui.pickBlock);
  if (pb) { ui.pickBlock = null; moveBlockTo(pb.id, date, start); return true; } // (v70) a block being moved by hand
  const x = ui.pick && get('tasks', ui.pick);
  if (!x) return false;
  // (v75) a stretch too short takes it too: the toast warns of the overlap, or of the time it lacks
  const occ = ui.pickOcc; ui.pick = null; ui.pickOcc = null;
  const need = (x.minutes || 30) + leadOf(x);
  placeItem(x, date, start, { occ, short: need > min ? need - min : 0 }); // (v69) a routine follows its rhythm (one of N, a turn, instead of, one more)
  return true;
}
