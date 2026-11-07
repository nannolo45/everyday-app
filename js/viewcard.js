// viewcard.js (v100): the card for looking at a task, as opposed to the editor for planning and fine-tuning it.
// Tap something (Oggi, the Planner, the map, Impegni): this sheet opens. Step by step: the step you're on first
// (‹ › for the others), with the route on a map for the travel steps; the focus timer suggested for its size; the
// checklist to tick and the notes. At the bottom ✓ Fatto · 🕒 Sposta · ✎ Modifica (the editor, as before).
import { catColor, catName, catsOf, esc, modal, relDay } from './core.js';
import { t } from './i18n.js';
import { isEvent } from './kinds.js';
import { checklistOf, isApptLike, outcomeOf, stepTimes } from './model.js';
import { fmtDur, fmtTime, nowMinutes, today } from './plan.js';
import { changed } from './shell.js';
import { get, live, upsert } from './store.js';
import { geocode, MODE_ICON } from './travel.js';
import { originFor, realSteps, travelCache, travelDest, travelMode } from './travel-plan.js';
import { runningBlock, sizeOfMinutes } from './timer.js';
import { focusMiniHtml, planFor, planWords, sizeOf, sizeWord, workMinutes } from './focus.js';
import { stepName } from './views/planner.js';
import { openModal } from './widgets.js';

let V = null; // { kind:'block'|'task', id, page }
const act = (action, id, extra = {}) => { // run one of the app's actions (the same as tapping it in the page)
  const view = document.getElementById('view'); if (!view) return;
  const b = document.createElement('button'); b.type = 'button'; b.hidden = true; b.dataset.action = action; if (id) b.dataset.id = id;
  for (const [k, v] of Object.entries(extra)) b.dataset[k] = v;
  view.appendChild(b); b.click(); b.remove();
};
export const viewOpen = () => Boolean(V && modal.open && modal.querySelector('.vc'));

// ---------- the route ----------
const GMODE = { walk: 'walking', bike: 'bicycling', transit: 'transit', car: 'driving' };
export const mapsDir = (from, to, mode) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from || '')}&destination=${encodeURIComponent(to || '')}&travelmode=${GMODE[mode] || 'transit'}`;
const routeMem = new Map();
async function routePoints(from, to, mode) {
  const k = `${mode}|${from}|${to}`; if (routeMem.has(k)) return routeMem.get(k);
  const p = (async () => {
    const cache = { geo: { ...(travelCache().geo || {}) } }; const ctx = { fetchFn: (...a) => fetch(...a), cache };
    const a = await geocode(from, ctx); const b = a && await geocode(to, ctx); if (!a || !b) return null;
    if (mode !== 'transit') {
      try {
        const prof = { walk: 'foot', bike: 'bike', car: 'driving' }[mode] || 'foot';
        const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(`https://router.project-osrm.org/route/v1/${prof}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=simplified&geometries=geojson`, { signal: ctrl.signal }); clearTimeout(tm);
        const j = r.ok ? await r.json() : null; const c = j?.routes?.[0]?.geometry?.coordinates;
        if (c?.length > 1) return { pts: c.map(([lon, lat]) => ({ lat, lon })), line: true };
      } catch { /* the straight line will do */ }
    }
    return { pts: [a, b], line: false };
  })();
  routeMem.set(k, p); return p;
}
const wp = (lat, lon, z) => { const s = 256 * 2 ** z; const r = (lat * Math.PI) / 180; return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s]; };
function drawMap(el, route) {
  const W = el.clientWidth || 320; const H = el.clientHeight || 160; const { pts } = route;
  let z = 17; let P;
  for (; z >= 2; z--) { P = pts.map((p) => wp(p.lat, p.lon, z)); const xs = P.map((q) => q[0]); const ys = P.map((q) => q[1]); if (Math.max(...xs) - Math.min(...xs) <= W - 56 && Math.max(...ys) - Math.min(...ys) <= H - 56) break; }
  const xs = P.map((q) => q[0]); const ys = P.map((q) => q[1]);
  const ox = (Math.max(...xs) + Math.min(...xs)) / 2 - W / 2; const oy = (Math.max(...ys) + Math.min(...ys)) / 2 - H / 2; const n = 2 ** z;
  let tiles = '';
  for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++) for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) {
    if (ty < 0 || ty >= n) continue; tiles += `<img alt="" draggable="false" onerror="this.style.visibility='hidden'" src="https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png" style="left:${Math.round(tx * 256 - ox)}px;top:${Math.round(ty * 256 - oy)}px">`;
  }
  const pl = P.map(([x, y]) => `${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`).join(' '); const [sx, sy] = [P[0][0] - ox, P[0][1] - oy]; const [ex, ey] = [P[P.length - 1][0] - ox, P[P.length - 1][1] - oy];
  el.innerHTML = `${tiles}<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pl}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/><polyline points="${pl}" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"${route.line ? '' : ' stroke-dasharray="2 9"'}/><circle cx="${sx}" cy="${sy}" r="7" fill="#fff" stroke="#333" stroke-width="2.5"/><circle cx="${ex}" cy="${ey}" r="9" fill="var(--accent)" stroke="#fff" stroke-width="2.5"/><circle cx="${ex}" cy="${ey}" r="3" fill="#fff"/></svg><span class="vc-osm">© OpenStreetMap</span>`;
  el.classList.add('ready');
}
export async function fillMaps(root = document) {
  for (const el of root.querySelectorAll('.vc-map:not(.ready):not(.busy)')) {
    el.classList.add('busy');
    routePoints(el.dataset.from, el.dataset.to, el.dataset.mode).then((r) => { if (r && el.isConnected) drawMap(el, r); else if (el.isConnected) el.classList.add('none'); }).catch(() => el.classList.add('none')).finally(() => el.classList.remove('busy'));
  }
}
function routeHtml({ from, to, mode, mins, leave, arrive }) {
  if (!from || !to) return '';
  return `<div class="vc-route"><div class="vc-map" data-from="${esc(from)}" data-to="${esc(to)}" data-mode="${esc(mode)}"><span class="vc-mapwait">${esc(t('vc_mapLoading'))}</span></div>
    <div class="vc-rt"><div><b>${MODE_ICON[mode] || '🚌'} ${leave != null ? esc(t('leaveAt', fmtTime(leave))) : ''}${mins ? ` · ${esc(fmtDur(mins))}` : ''}</b><small>${esc(t('vc_fromTo', short(from), short(to)))}${arrive != null ? ` · ${esc(t('vc_arrive', fmtTime(arrive)))}` : ''}</small></div><a class="btn small" href="${esc(mapsDir(from, to, mode))}" target="_blank" rel="noopener">${esc(t('vc_maps'))} ↗</a></div></div>`;
}
const short = (a) => String(a || '').split(',')[0];

// ---------- the card ----------
function pagesOf(b, x) {
  const ys = stepTimes(b); if (ys.length > 1) return ys;
  return [{ id: '_one', title: b.title, start: b.start, end: b.start + b.minutes, one: true, state: outcomeOf(b) ? 'done' : null }];
}
function curPage(b, pages) {
  const now = b.date === today() ? nowMinutes() : -1;
  const i = pages.findIndex((y) => y.state !== 'done' && y.start <= now && now < y.end); if (i >= 0) return i;
  const j = pages.findIndex((y) => y.state !== 'done'); return j >= 0 ? j : 0;
}
function focusBox(b, x) {
  if (outcomeOf(b) || isEvent(x) || isApptLike(x) || b.kind === 'groceries') return '';
  const run = runningBlock()?.id === b.id ? runningBlock() : null;
  if (run?.focus) return `<div class="vc-focus">${focusMiniHtml(run)}<button type="button" class="btn primary" data-vc="focus-open">${esc(t('vc_openTimer'))}</button></div>`;
  if (run) return `<div class="vc-focus col"><b>⏱ ${esc(t('vc_running'))}</b><button type="button" class="btn primary" data-vc="focus-start" data-id="${esc(b.id)}">▶ ${esc(t('vc_toFocus'))}</button></div>`;
  const plan = planFor(b);
  return `<div class="vc-focus col"><span class="vc-k">${esc(t('vc_focusSug'))}</span><b>${esc(planWords(plan))}</b><button type="button" class="btn primary" data-vc="focus-start" data-id="${esc(b.id)}">▶ ${esc(t('vc_startFocus'))}</button>${b.date === today() ? `<button type="button" class="linkish" data-vc="now-start" data-id="${esc(b.id)}">${esc(t('vc_noTimer'))}</button>` : ''}</div>`;
}
function headHtml(color, cat, title, line, chip) {
  return `<div class="vc-head"><span class="vc-dot" style="--c:${esc(color)}"></span><div class="vc-hx"><small>${esc(cat)}</small><h2>${esc(title)}</h2><small>${line}</small>${chip}</div><button type="button" class="icon vc-x" data-vc="close" aria-label="${esc(t('close'))}" title="${esc(t('close'))}">✕</button></div>`;
}
function extrasHtml(x, cl, checked, blockId, notes) {
  const after = x ? live('tasks').filter((q) => (q.after || []).includes(x.id) && !q.done && !q.deleted) : [];
  return `${cl.length ? `<div class="vc-card"><h3>${esc(t('vc_bring'))} <small>${checked.filter(Boolean).length}/${cl.length}</small></h3>${cl.map((c, i) => `<label class="check"><input type="checkbox" data-vci="${i}" ${blockId ? `data-vcb="${esc(blockId)}"` : ''} ${checked[i] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>` : ''}
    ${notes || x?.link ? `<div class="vc-card"><h3>${esc(t('notes'))}</h3>${notes ? `<p class="vc-note">${esc(notes)}</p>` : ''}${x?.link ? `<a class="vc-link" href="${esc(x.link)}" target="_blank" rel="noopener">🔗 ${esc(short(x.link.replace(/^https?:\/\//, '')))} ↗</a>` : ''}</div>` : ''}
    ${after.length ? `<div class="vc-card"><h3>${esc(t('vc_after'))}</h3>${after.map((q) => `<div class="vc-after">↪ <b>${esc(q.title)}</b></div>`).join('')}</div>` : ''}`;
}
function blockCard(b) {
  const x = b.taskId ? get('tasks', b.taskId) : null; const out = outcomeOf(b); const pages = pagesOf(b, x);
  if (V.page == null || V.page >= pages.length) V.page = curPage(b, pages);
  const y = pages[V.page]; const now = b.date === today() ? nowMinutes() : -1;
  const running = runningBlock()?.id === b.id;
  const cat = catsOf(x || b)[0]; const color = catColor(b.category || cat) || 'var(--accent)';
  const catLine = [cat ? catName(get('categories', cat)) : '', x ? sizeWord(sizeOfMinutes(workMinutes(b), realSteps(x).length)) : ''].filter(Boolean).join(' · ');
  const line = `${esc(relDay(b.date))} · ${fmtTime(b.start)}–${fmtTime(b.start + b.minutes)} · ${esc(fmtDur(b.minutes))}`;
  const chip = out === 'done' ? `<span class="vc-chip done">✓ ${esc(t('doneLabel'))}</span>` : out === 'failed' ? `<span class="vc-chip fail">✕ ${esc(t('couldnt'))}</span>`
    : running ? `<span class="vc-chip live">● ${esc(t('inProgress'))}</span>` : b.date === today() && b.start <= now && now < b.start + b.minutes ? `<span class="vc-chip live">● ${esc(t('vc_nowLeft', fmtDur(b.start + b.minutes - now)))}</span>` : '';
  const isLeg = Boolean(y.travel) && x;
  const mode = y.mode || (x ? travelMode(x) : 'transit');
  const from = isLeg ? (y.travel === 'there' ? originFor(x, b) : x.place) : ''; const to = isLeg ? (y.travel === 'there' ? x.place : travelDest(x, b)) : '';
  const st = y.state === 'done' || out === 'done';
  const k = st ? t('doneLabel') : y.start <= now && now < y.end ? t('vc_now') : y.one ? t('vc_when') : t('vc_step');
  const route = isLeg ? routeHtml({ from, to, mode, mins: y.end - y.start, leave: y.start, arrive: y.end })
    : pages.length === 1 && x?.place ? routeHtml({ from: originFor(x, b), to: x.place, mode: travelMode(x) }) : '';
  const page = pages.length === 1 && !route ? '' : `<div class="vc-page"><span class="vc-k${st ? ' dn' : ''}">${esc(k)}${pages.length > 1 ? ` · ${esc(t('vc_ofN', V.page + 1, pages.length))}` : ''}</span>
    <b class="vc-big">${isLeg ? `${MODE_ICON[mode] || '🚌'} ` : ''}${esc(y.one ? b.title : stepName(y))}</b><small>${fmtTime(y.start)}–${fmtTime(y.end)}${!isLeg && x?.place ? ` · 📍 ${esc(short(x.place))}` : ''}</small>
    ${route}
    ${!out && !y.one ? `<button type="button" class="btn${st ? '' : ' primary'} vc-stepbtn" data-vc="step" data-id="${esc(b.id)}" data-step="${esc(y.id)}">${st ? `↺ ${esc(t('vc_stepUndo'))}` : `✓ ${esc(t('vc_stepDone'))}`}</button>` : ''}
    ${pages.length > 1 ? `<div class="vc-pager"><button type="button" class="icon" data-vc="pg" data-d="-1" ${V.page ? '' : 'disabled'} aria-label="${esc(t('previous'))}">‹</button><span class="vc-dots">${pages.map((p, i) => `<i class="${i === V.page ? 'on' : ''}${p.state === 'done' ? ' dn' : ''}"></i>`).join('')}</span><button type="button" class="icon" data-vc="pg" data-d="1" ${V.page < pages.length - 1 ? '' : 'disabled'} aria-label="${esc(t('next'))}">›</button></div>` : ''}</div>`;
  return `<div class="vc">${headHtml(color, catLine, `${isApptLike(x) ? '📅 ' : ''}${b.title}`, line, chip)}${page}${focusBox(b, x)}${extrasHtml(x, checklistOf(b), b.checked || [], b.id, b.notes || x?.notes || '')}</div>
    <div class="vc-foot">${out ? `<button type="button" class="btn" data-vc="reset" data-id="${esc(b.id)}">↺ ${esc(t('reset'))}</button>` : `<button type="button" class="btn primary" data-vc="done" data-id="${esc(b.id)}">✓ ${esc(t('esDone'))}</button><button type="button" class="btn" data-vc="move" data-id="${esc(b.id)}">🕒 ${esc(t('moveBtn'))}</button>`}<button type="button" class="btn vc-ed" data-vc="edit">✎ ${esc(t('vc_edit'))}</button></div>`;
}
function taskCard(x) {
  const cat = catsOf(x)[0]; const color = catColor(cat) || 'var(--accent)';
  const catLine = [cat ? catName(get('categories', cat)) : '', sizeWord(sizeOf(x))].filter(Boolean).join(' · ');
  const planned = live('blocks').filter((b) => b.taskId === x.id && !outcomeOf(b) && b.date >= today() && b.kind !== 'prep').sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1))[0];
  const line = [planned ? esc(t('plannedAt', relDay(planned.date), fmtTime(planned.start))) : esc(t('vc_toPlan')), esc(fmtDur(x.minutes || 30)), x.due ? `<span class="${x.due < today() ? 'late' : ''}">${esc(t('dueOn', relDay(x.due)))}</span>` : ''].filter(Boolean).join(' · ');
  const steps = realSteps(x);
  const plan = planFor({ minutes: x.minutes || 30, taskId: x.id });
  return `<div class="vc">${headHtml(color, catLine, x.title, line, x.done ? `<span class="vc-chip done">✓ ${esc(t('doneLabel'))}</span>` : '')}
    ${x.place ? `<div class="vc-page"><span class="vc-k">${esc(t('place'))}</span><b class="vc-big">📍 ${esc(short(x.place))}</b>${routeHtml({ from: originFor(x), to: x.place, mode: travelMode(x) })}</div>` : ''}
    ${steps.length ? `<div class="vc-card"><h3>${esc(t('steps'))} <small>${steps.length}</small></h3>${steps.map((s, i) => `<div class="vc-st"><span>${i + 1}</span>${esc(s.title)}${s.minutes ? ` <small>${esc(fmtDur(s.minutes))}</small>` : ''}</div>`).join('')}</div>` : ''}
    ${x.done || isEvent(x) ? '' : `<div class="vc-focus col"><span class="vc-k">${esc(t('vc_focusSug'))}</span><b>${esc(planWords(plan))}</b><button type="button" class="btn primary" data-vc="focus-task" data-id="${esc(x.id)}">▶ ${esc(t('vc_startFocus'))}</button></div>`}
    ${extrasHtml(x, x.checklist || [], [], null, x.notes || '')}</div>
    <div class="vc-foot">${x.done ? '' : `<button type="button" class="btn primary" data-vc="task-done" data-id="${esc(x.id)}">✓ ${esc(t('esDone'))}</button>${planned ? '' : `<button type="button" class="btn" data-vc="plan" data-id="${esc(x.id)}">📅 ${esc(t('vc_plan'))}</button>`}`}<button type="button" class="btn vc-ed" data-vc="edit">✎ ${esc(t('vc_edit'))}</button></div>`;
}
function draw() {
  const b = V.kind === 'block' ? get('blocks', V.id) : null; const x = V.kind === 'task' ? get('tasks', V.id) : null;
  if (!b && !x) { V = null; if (modal.open) modal.close(); return; }
  openModal(b ? blockCard(b) : taskCard(x), () => {}, { cls: 'sheet vc-sheet' });
  fillMaps(modal);
}
// (v101) closing: ✕, a tap outside the card, Esc, or the phone's Back (the card adds a step to the history)
const pushStep = () => { if (!viewOpen()) try { history.pushState({ vc: 1 }, ''); } catch { /* none */ } };
export function openView(b, page = null) { pushStep(); V = { kind: 'block', id: b.id, page }; draw(); }
export function openTaskView(x) { pushStep(); V = { kind: 'task', id: x.id, page: null }; draw(); }
window.addEventListener('popstate', () => { if (viewOpen()) { V = null; modal.close(); } });
modal.addEventListener('close', () => { setTimeout(() => { if (history.state?.vc && !(modal.open && modal.querySelector('.vc'))) history.back(); }, 0); });
modal.addEventListener('click', (e) => { if (e.target === modal && modal.classList.contains('vc-sheet')) { V = null; modal.close(); } }); // the backdrop
export function redrawView() { if (viewOpen()) draw(); }

modal.addEventListener('click', (e) => {
  const el = e.target.closest('.vc [data-vc], .vc-foot [data-vc]'); if (!el || !V) return;
  e.preventDefault(); const a = el.dataset.vc; const id = el.dataset.id;
  const close = () => { modal.close(); };
  switch (a) {
    case 'close': V = null; close(); return;
    case 'pg': V.page += Number(el.dataset.d); draw(); return;
    case 'step': act('ag-step', null, { block: id, step: el.dataset.step }); setTimeout(() => { if (V) { V.page = null; draw(); } }, 0); return;
    case 'edit': { const kind = V.kind; const vid = V.id; close(); V = null; setTimeout(() => act(kind === 'block' ? 'block-edit' : 'task-edit', vid), 0); return; }
    case 'done': { const b = get('blocks', id); close(); V = null; if (runningBlock()?.id === id) act('timer-stop'); else if (b) act('now-done', id); return; }
    case 'reset': close(); V = null; act('block-reset', id); return;
    case 'move': close(); V = null; setTimeout(() => act('now-move', id), 0); return;
    case 'focus-start': close(); V = null; act('focus-start', id); return;
    case 'focus-task': close(); V = null; act('focus-task', id); return;
    case 'focus-open': close(); V = null; act('focus-open'); return;
    case 'now-start': close(); V = null; act('now-start', id); return;
    case 'task-done': close(); V = null; act('task-done-x', id); return;
    case 'plan': close(); V = null; setTimeout(() => act('plan-task', id, { date: today() }), 0); return;
    default:
  }
});
modal.addEventListener('change', (e) => {
  const el = e.target; if (!V || el.dataset.vci == null) return;
  if (el.dataset.vcb) { const cur = get('blocks', el.dataset.vcb); if (!cur) return; const next = [...(cur.checked || [])]; next[Number(el.dataset.vci)] = el.checked; upsert('blocks', { ...cur, checked: next }, { silent: true }); changed(); }
});
