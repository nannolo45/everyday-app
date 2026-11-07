// pianifica.js (v114): «Pianifica» — one button for the period on screen, then how:
//   ✦ Automatico: the app fills the chosen schema with the things still to plan (proposals, ✓ / ✕ as before);
//   Manuale: the schema becomes places to fill; tap a thing to put it in the lit place, then «Metti nel giorno».
// The schema (how a day's time is shared out) is one row that opens the list of the ones switched on in
// Impostazioni › Planner. On a wide screen it's in the pane; on a phone it's a sheet from the bottom.
import { catsOf, esc, fmtDay, route, toast, ui } from './core.js';
import { t } from './i18n.js';
import { addDays, fmtDur, nowMinutes, parseDate, today } from './plan.js';
import { autoHoursFor, placeGhosts, trayTasks } from './planning.js';
import { pomodori, TPL_DEFAULT, TPL_ORDER, TPLS, tplAccepts, tplGroup } from './smart.js';
import { get, live, saveSettings, state } from './store.js';
import { render } from './shell.js';
import { cardRowsIn } from './weekpick.js';
import { scheduleTravelRefresh } from './travel-plan.js';
import { moveBlockTo } from './placing.js';
import { viewRange } from './finder.js';
import { isWide } from './views/wide.js';

export const tplOn = () => { const l = state.settings.planTpls; return Array.isArray(l) && l.length ? TPL_ORDER.filter((k) => l.includes(k)) : TPL_DEFAULT; };
const st = () => {
  if (!ui.pl) ui.pl = { open: false, mode: null, menu: false, day: null, slots: {}, step: 0, where: 'free', src: 'toplan', q: '', moves: {}, times: {} };
  return ui.pl;
};
export const plOpen = () => Boolean(ui.pl?.open);
export const curTpl = () => { const k = state.settings.dayRule || '135'; return TPLS[k] ? k : '135'; };
// the days of the period on screen, from today
export function periodDays() {
  const r = viewRange(); const td = today();
  const from = r.from > td ? r.from : td; const out = [];
  for (let d = from; d <= r.to; d = addDays(d, 1)) out.push(d);
  if (!out.length) return [];
  const weekend = (d) => [0, 6].includes(parseDate(d).getDay());
  return state.settings.freeWeekends && out.some((d) => !weekend(d)) ? out.filter((d) => !weekend(d)) : out;
}
export const periodLabel = () => { const r = viewRange(); return r.v === 'day' ? (r.from === today() ? t('today').toLowerCase() : fmtDay(r.from, { weekday: 'long', day: 'numeric' })) : t(`smartFor_${r.v}`); };
const dayOf = () => { const s = st(); const ds = periodDays(); return ds.includes(s.day) ? s.day : ds[0]; };

// a schema drawn small: long bars big things, short ones small; the frog's first one in colour
export function shape(k) {
  const W = { big: 26, med: 13, small: 5, deep: 30, any: 10, short: 10, maint: 5, theme: 10 };
  if (k === 'free') return '<span class="pf-shape" aria-hidden="true"><u class="dash"></u></span>';
  return `<span class="pf-shape" aria-hidden="true">${TPLS[k].g.map(([f, n], gi) => Array.from({ length: n }, () => `<u class="${k === 'frog' && gi === 0 ? 'hot' : ''}" style="width:${W[f]}px"></u>`).join('')).join('<i></i>')}</span>`;
}
const tName = (k) => t(`tpl_${k}`); const tLine = (k) => t(`tplL_${k}`);
const gName = (k, gi) => t(`tplG_${k}_${gi}`);

// ---------- the slots (Manuale) ----------
const slotsOf = (d) => { const s = st(); if (!s.slots[d]) s.slots[d] = {}; return s.slots[d]; };
const usedIn = (d) => { const k = curTpl(); const u = []; for (const [key, id] of Object.entries(slotsOf(d))) { const gi = Number(key.split('-')[0]); const x = get('tasks', id); u[gi] = (u[gi] || 0) + (TPLS[k].pomo ? pomodori(x?.minutes) : 1); } return u; };
const allSlotted = () => new Set(Object.values(st().slots).flatMap((m) => Object.values(m)));
const itemOf = (x) => ({ minutes: x.minutes || 30, cats: catsOf(x) });
export const manualOn = () => Boolean(ui.pl?.open && ui.pl.mode === 'manual');
export const slottedIds = () => (st().open && st().mode === 'manual' ? allSlotted() : new Set());
// Does a thing fit the next lit place? (for ↑ in the list)
export function fitsNext(x) {
  const s = st(); if (!s.open || s.mode !== 'manual') return false;
  const k = curTpl(); if (k === 'free') return true;
  return tplGroup(k, usedIn(dayOf()), itemOf(x), dayOf(), state.settings.planThemes || {}) >= 0;
}
function fill(id) {
  const x = get('tasks', id); if (!x) return;
  if (allSlotted().has(id)) { toast(t('plAlready')); return; }
  const d = dayOf(); const k = curTpl(); const m = slotsOf(d);
  if (k === 'free') { const n = Object.keys(m).length; m[`0-${n}`] = id; return; }
  const T = TPLS[k];
  const gi = tplGroup(k, usedIn(d), itemOf(x), d, state.settings.planThemes || {});
  if (gi < 0) { toast(T.pomo ? t('plNoPomo') : t('plNoRoom', x.title)); return; }
  let i = 0; while (m[`${gi}-${i}`]) i++;
  m[`${gi}-${i}`] = id;
}
const catColor = (x) => { const c = catsOf(x)[0]; return (c && get('categories', c)?.color) || 'var(--muted)'; };

// ---------- (v115) the steps: Come → Schema → Dove (Manuale) → Scegli ----------
// One question a screen; a choice slides to the next, ← goes back, the dots say where you are. In «Scegli» the
// choices made stay on top as small buttons (a tap goes back to that step), a search over everything, a menu
// for which list (to plan · routines · already planned · saved · all), and a tray «Nel giorno · n di N» at the
// bottom with the places, their times (All'ora che dico io: anything, overlaps too) and «Metti nel giorno».
const STEPS = () => (st().mode === 'auto' ? ['how', 'tpl'] : ['how', 'tpl', 'where', 'pick']);
const stepNow = () => { const s = st(); const l = STEPS(); return l[Math.min(s.step || 0, l.length - 1)]; };
export const pickStep = () => plOpen() && st().mode === 'manual' && stepNow() === 'pick';
const SRC = ['toplan', 'routine', 'planned', 'saved', 'all'];
const live_ = (c) => live(c);
function srcList(k, d) {
  const td = today();
  const toplan = () => trayTasks();
  const routine = () => live_('tasks').filter((x) => x.repeat && !x.archived && !x.palOut && !x.done);
  const planned = () => { const seen = new Map();
    for (const b of live_('blocks').filter((y) => y.taskId && !y.stepId && y.kind !== 'prep' && y.date >= td && y.date !== d && !y.outcome && !y.done).sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : p.start - q.start))) {
      const x = get('tasks', b.taskId); if (x && !x.repeat && !seen.has(x.id)) seen.set(x.id, { x, b }); }
    return [...seen.values()]; };
  const saved = () => live_('tasks').filter((x) => x.kind === 'saved' && !x.repeat && !x.archived);
  const wrap = (l) => l.map((x) => (x.x ? x : { x }));
  if (k === 'toplan') return wrap(toplan()); if (k === 'routine') return wrap(routine()); if (k === 'planned') return planned(); if (k === 'saved') return wrap(saved());
  const all = new Map(); for (const it of [...wrap(toplan()), ...planned(), ...wrap(routine()), ...wrap(saved())]) if (!all.has(it.x.id)) all.set(it.x.id, it);
  return [...all.values()];
}
const srcName = (k) => t(`plSrc_${k}`);
// the places in order, with their times: «spazi liberi» one after another in the free time; «all'ora che dico io»
// the time you wrote (or, until you do, the next free one)
function orderedKeys(d) { const k = curTpl(); const m = slotsOf(d); let keys = Object.keys(m).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); if (TPLS[k].long) keys = keys.sort((a, b) => (get('tasks', m[b])?.minutes || 30) - (get('tasks', m[a])?.minutes || 30)); return keys; }
function busyOf(d) {
  const moving = new Set(Object.values(st().moves || {}));
  const bl = live_('blocks').filter((b) => b.date === d && !b.stepId && !moving.has(b.id) && b.outcome !== 'failed').map((b) => ({ s:b.start, e:b.start + (b.minutes || 0), t:b.title }));
  const ev = live_('events').filter((e) => e.date === d && !e.allDay && !e.skipped && e.busy !== false).map((e) => ({ s:e.start, e:e.start + (e.minutes || 0), t:e.title }));
  return [...bl, ...ev];
}
function slotTimes(d) {
  const s = st(); const m = slotsOf(d); const times = (s.times ||= {})[d] ||= {};
  const td = today(); let from = Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0);
  const busy = busyOf(d); const out = [];
  for (const key of orderedKeys(d)) {
    const x = get('tasks', m[key]); const min = x?.minutes || 30; let at;
    if (s.where === 'pick' && times[key] != null) at = times[key];
    else { at = from; const taken = [...busy, ...out]; let guard = 0; while (guard++ < 200) { const hit = taken.find((o) => at < o.e && o.s < at + min); if (!hit) break; at = hit.e; } if (at + min > 1440) at = Math.max(0, 1440 - min); from = at + min; } // no room left: by the end of the day (it shows as an overlap)
    out.push({ key, id:m[key], s:at, e:at + min, t:x?.title || '' });
  }
  for (const o of out) o.over = [...busy, ...out.filter((q) => q !== o)].find((q) => o.s < q.e && q.s < o.e) || null;
  return out;
}
const fmtHM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function tplTotal(k, d) { const T = TPLS[k]; if (k === 'free') return Math.max(1, Object.keys(slotsOf(d)).length); if (T.pomo) return 8; return T.g.reduce((n, [, c]) => n + c, 0); }

function pageHow() {
  const s = st(); const days = periodDays();
  return `<p class="pf-q">${esc(t('plHow'))}</p><p class="pf-qs">${esc(t('plFor', periodLabel()))}</p>${!days.length ? `<p class="hint">${esc(t('plPast'))}</p>` : ''}
    ${[['auto', '✦', t('plAuto'), t('plAutoSub')], ['manual', '✎', t('plManual'), t('plManualSub2')]].map(([k, i, l, d]) => `<button type="button" class="pf-big${s.mode === k ? ' on' : ''}" data-action="pl-mode" data-id="${k}" ${days.length ? '' : 'disabled'}><span class="pf-bi">${i}</span><span class="pf-mt"><b>${esc(l)}</b><small>${esc(d)}</small></span><span class="pf-car">›</span></button>`).join('')}`;
}
function pageTpl() {
  const k = curTpl(); const list = tplOn().includes(k) ? tplOn() : [...tplOn(), k];
  const theme = k === 'theme' && !Object.keys(state.settings.planThemes || {}).length ? `<p class="hint pf-warn">${esc(t('plNoThemes'))} <a href="#/settings/planner">${esc(t('plSetThemes'))} ›</a></p>` : '';
  return `<p class="pf-q">${esc(t('plDistr'))}?</p><p class="pf-qs">${esc(t('plDistrSub'))}</p>
    <div class="pf-tpls">${list.map((id) => `<button type="button" class="pf-tpl${id === k && st().tplSet ? ' on' : ''}" data-action="pl-tpl" data-id="${id}"><span class="pf-mt"><b>${esc(tName(id))}</b><small>${esc(tLine(id))}</small></span>${shape(id)}</button>`).join('')}</div>${theme}
    <a class="pf-more" href="#/settings/planner">${esc(t('plMore'))} ›</a>`;
}
function pageWhere() {
  const s = st();
  return `<p class="pf-q">${esc(t('plWhereQ'))}</p><p class="pf-qs">${esc(t('plWhereSub'))}</p>
    ${[['free', '▤', t('plWhereFree'), t('plWhereFreeSub')], ['pick', '⧉', t('plWherePick'), t('plWherePickSub')]].map(([k, i, l, d]) => `<button type="button" class="pf-big${s.where === k ? ' on' : ''}" data-action="pl-where" data-id="${k}"><span class="pf-bi">${i}</span><span class="pf-mt"><b>${esc(l)}</b><small>${esc(d)}</small></span><span class="pf-car">›</span></button>`).join('')}`;
}
function pagePick() {
  const s = st(); const d = dayOf(); const days = periodDays(); const used = allSlotted(); const q = (s.q || '').trim().toLowerCase();
  const sum = `<div class="pf-sum"><button type="button" data-action="pl-step" data-id="0">✎ ${esc(t('plManual'))}</button><button type="button" data-action="pl-step" data-id="1">${esc(tName(curTpl()))}</button><button type="button" data-action="pl-step" data-id="2">${esc(s.where === 'pick' ? t('plWherePick') : t('plWhereFree'))}</button></div>`;
  const chips = days.length > 1 ? `<div class="pf-days">${days.map((x) => `<button type="button" class="${x === d ? 'on' : ''}" data-action="pl-day" data-id="${x}"><b>${esc(fmtDay(x, { weekday:'short', day:'numeric' }))}</b><small>${esc(t('plNIn', Object.keys(slotsOf(x)).length))}</small></button>`).join('')}</div>` : '';
  const src = SRC.includes(s.src) ? s.src : 'toplan';
  const list = q ? srcList('all', d).filter(({ x }) => (x.title || '').toLowerCase().includes(q)) : srcList(src, d);
  const counts = Object.fromEntries(SRC.map((k) => [k, srcList(k, d).length]));
  const hl = (title) => { if (!q) return esc(title); const i = title.toLowerCase().indexOf(q); return i < 0 ? esc(title) : `${esc(title.slice(0, i))}<mark>${esc(title.slice(i, i + q.length))}</mark>${esc(title.slice(i + q.length))}`; };
  const row = ({ x, b }) => { const on = used.has(x.id); const fit = !on && fitsNext(x);
    const meta = b ? t('plMovesHere', `${fmtDay(b.date, { weekday:'short', day:'numeric' })} · ${fmtHM(b.start)}`) : x.repeat ? t('plSrc_routine') : x.kind === 'saved' ? t('plSavedOne') : '';
    return `<button type="button" class="pf-it${on ? ' on' : ''}${fit ? ' fit' : ''}" data-action="pl-pick" data-id="${esc(x.id)}"${b ? ` data-block="${esc(b.id)}"` : ''}><span class="pf-dot" style="background:${catColor(x)}"></span><span class="pf-mt"><b>${hl(x.title || '')}</b>${meta ? `<small>${esc(meta)}</small>` : ''}</span><small class="pf-len">${esc(fmtDur(x.minutes || 30))}</small><span class="pf-add" aria-hidden="true">${on ? '✓' : '＋'}</span></button>`; };
  return `${sum}${chips}
    <label class="pf-search"><span aria-hidden="true">🔍</span><input id="pf-q" type="search" autocomplete="off" placeholder="${esc(t('plSearchAll'))}" value="${esc(s.q || '')}"></label>
    ${q ? `<div class="pf-lh"><span>${esc(t('plNFound', list.length))}</span></div>` : `<div class="pf-srow"><button type="button" class="pf-dd${s.srcMenu ? ' on' : ''}" data-action="pl-srcmenu" aria-expanded="${Boolean(s.srcMenu)}">${esc(srcName(src))} · ${counts[src]} ▾</button><span class="pf-lh">${esc(t('plTapAdd'))}</span>
      ${s.srcMenu ? `<div class="pf-srcm" role="menu">${SRC.map((k, i) => `${i === 4 ? '<hr>' : ''}<button type="button" role="menuitem" class="${k === src ? 'on' : ''}" data-action="pl-src" data-id="${k}">${esc(srcName(k))}<small>${counts[k]}</small></button>`).join('')}</div>` : ''}</div>`}
    <div class="pf-items">${list.slice(0, 80).map(row).join('') || `<p class="hint">${esc(q ? t('noMatch') : t('trayEmpty'))}</p>`}</div>`;
}
function trayHtml() {
  const s = st(); const d = dayOf(); const k = curTpl(); const T = TPLS[k]; const m = slotsOf(d);
  const tm = slotTimes(d); const byKey = Object.fromEntries(tm.map((o) => [o.key, o])); const nC = tm.filter((o) => o.over).length;
  const n = T.pomo ? (usedIn(d)[0] || 0) : Object.keys(m).length; const N = tplTotal(k, d);
  const row = (key, i, ranked) => { const x = get('tasks', m[key]); if (!x) return ''; const o = byKey[key];
    const time = s.where === 'pick' ? `<input class="time24 pf-tm" data-pltime="${esc(key)}" value="${fmtHM(o.s)}" type="text" inputmode="numeric" maxlength="5" aria-label="${esc(t('start'))}">` : `<span class="pf-tmr">${fmtHM(o.s)}</span>`;
    return `<div class="pf-slot f${o.over ? ' conf' : ''}"><span class="pf-dot" style="background:${catColor(x)}"></span>${ranked ? `<span class="pf-n">${i}</span>` : ''}${time}<span class="pf-st">${esc(x.title)}${s.moves?.[x.id] ? ` <em class="pf-mv">${esc(t('plMoved'))}</em>` : ''}</span><small>${esc(T.pomo ? `🍅×${pomodori(x.minutes)}` : fmtDur(x.minutes || 30))}</small><button type="button" class="pf-x" data-action="pl-un" data-id="${esc(key)}" aria-label="${esc(t('remove'))}">✕</button></div>${o.over ? `<div class="pf-cw">⚠ ${esc(t('plOverlaps', o.over.t))}</div>` : ''}`; };
  let body = '';
  if (s.tray) {
    if (k === 'free' || T.pomo) body = orderedKeys(d).map((key, i) => row(key, i + 1)).join('');
    else body = T.g.map(([, cnt], gi) => { const keys = Object.keys(m).filter((key) => key.startsWith(`${gi}-`)).sort((a, b) => a.localeCompare(b, undefined, { numeric:true }));
      return `<div class="pf-gh">${esc(gName(k, gi))}<span>${keys.length}/${cnt}</span></div>${keys.map((key, i) => row(key, i + 1, T.ranked)).join('')}${keys.length < cnt ? `<div class="pf-slot">${esc(t('plFreePlaces', cnt - keys.length))}</div>` : ''}`; }).join('');
  }
  return `<div class="pf-tray"><button type="button" class="pf-trh" data-action="pl-tray" aria-expanded="${Boolean(s.tray)}"><b>${esc(t('plInDay', n, T.pomo ? '8 🍅' : N))}</b>${nC ? `<span class="pf-trc">⚠ ${nC}</span>` : ''}<span class="pf-car">${s.tray ? `▾ ${esc(t('close'))}` : `▴ ${esc(t('plSee'))}`}</span></button>
    <div class="pf-bar">${Array.from({ length:Math.min(N, 20) }, (_, i) => `<span class="${i < n ? 'f' : ''}"></span>`).join('')}</div>
    ${s.tray ? `<div class="pf-trb">${body || `<p class="hint">${esc(t('plTapHint2'))}</p>`}</div>` : ''}
    <div class="pf-foot"><button type="button" class="btn" data-action="pl-clear">${esc(t('plClear'))}</button><button type="button" class="btn primary" data-action="pl-place" ${n ? '' : 'disabled'}>${esc(t('plPlace'))}${nC ? ` · ⚠ ${nC}` : ''} →</button></div></div>`;
}
function stepsHtml(withHead) {
  const s = st(); const l = STEPS(); const i = Math.min(s.step || 0, l.length - 1); const k = l[i];
  const page = { how:pageHow, tpl:pageTpl, where:pageWhere, pick:pagePick }[k]();
  const head = `<div class="pf-sh">${i ? `<button type="button" class="icon pf-back" data-action="pl-back" aria-label="${esc(t('previous'))}">←</button>` : '<span class="pf-back"></span>'}<b>${esc(t('planChoose'))} · ${esc(periodLabel())}</b><button type="button" class="icon" data-action="pl-open" aria-label="${esc(t('close'))}">✕</button></div>`;
  const dots = `<div class="pf-dots" aria-hidden="true">${l.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>`;
  return { top:`${withHead ? head : ''}${dots}`, page:`<div class="pf-page pf-in-${s.dir || 'r'}" data-step="${k}">${page}</div>`, tray:k === 'pick' ? trayHtml() : '' };
}
export function plPanel() {
  const x = stepsHtml(true);
  return `<div class="pf pf-wide">${x.top}${x.page}${x.tray}</div>`;
}
// the button (pane and phone card) — the period on screen, no ✦
export const plButton = (cls = '') => `<button class="btn primary pf-btn ${cls}" type="button" data-action="pl-open" aria-expanded="${plOpen()}">${esc(t('planChoose'))} <span>· ${esc(periodLabel())}</span><i aria-hidden="true">${plOpen() ? '▴' : '▾'}</i></button>`;
// The phone's sheet
export function plSheet() {
  if (isWide() || !plOpen() || route().name !== 'plan') return '';
  const x = stepsHtml(true);
  return `<div class="pf-bg" data-action="pl-open"></div><div class="pf-sheet" role="dialog" aria-label="${esc(t('planChoose'))}"><div class="pf-grab" aria-hidden="true"></div>${x.top}<div class="pf-scroll">${x.page}</div>${x.tray}</div>`;
}

// ---------- running ----------
function runAuto() {
  const days = periodDays(); if (!days.length) return;
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  ui.assign.ghosts = []; ui.assign.fix = null; ui.assign.kept = 0;
  const ids = trayTasks().map((x) => x.id);
  const busy = []; ui.assign.fix = cardRowsIn(days, busy);
  const more = (ui.assign.fix || []).reduce((n, r) => n + (r.date ? (r.options?.length ? 1 : 0) : (r.placements || []).length), 0);
  if (!ids.length && !more) { toast(t('trayEmpty')); render(); return; }
  ui.planRule = curTpl() === 'free' ? '' : curTpl();
  try { placeGhosts(ids, days, null, { busy, more }); } finally { ui.planRule = ''; }
  scheduleTravelRefresh();
}
function placeDay() {
  const s = st(); const d = dayOf(); const m = slotsOf(d); const tm = slotTimes(d);
  if (!tm.length) return;
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  const moves = s.moves || {};
  // things already planned on another day move here (their block moves); the rest become proposals to keep
  for (const o of tm) { const bid = moves[o.id]; if (bid && get('blocks', bid)) moveBlockTo(bid, d, o.s); }
  const rest = tm.filter((o) => !moves[o.id]);
  if (s.where === 'pick') {
    ui.assign.ghosts.push(...rest.map((o) => ({ taskId:o.id, stepId:null, date:d, start:o.s, minutes:o.e - o.s, lead:0, reasons:[] })));
    if (rest.length) toast(t('spreadPreview', rest.length));
  }
  s.slots[d] = {}; if (s.times) s.times[d] = {}; for (const o of tm) delete moves[o.id];
  if (!isWide()) s.open = false;
  if (s.where !== 'pick' && rest.length) { const td = today(); const from = Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0); placeGhosts(rest.map((o) => o.id), [d], from); }
  else render();
}
const go = (step, dir = 'r') => { const s = st(); s.step = step; s.dir = dir; s.srcMenu = false; render(); };
// Taps; true when handled.
export function plClick(btn) {
  const { action, id } = btn.dataset; const s = st();
  switch (action) {
    case 'pl-open': s.open = !s.open; s.srcMenu = false; if (s.open && !s.mode) s.step = 0; render(); return true;
    case 'pl-back': go(Math.max(0, (s.step || 0) - 1), 'l'); return true;
    case 'pl-step': go(Number(id), 'l'); return true;
    case 'pl-mode': s.mode = id; s.slots = {}; s.moves = {}; s.times = {}; if (ui.assign) { ui.assign.ghosts = []; ui.assign.fix = null; } go(1); return true;
    case 'pl-tpl': saveSettings({ dayRule: id }); s.tplSet = true; s.slots = {}; s.times = {};
      if (s.mode === 'auto') { if (!isWide()) s.open = false; runAuto(); return true; }
      go(2); return true;
    case 'pl-where': s.where = id; s.times = {}; go(3); return true;
    case 'pl-day': s.day = id; render(); return true;
    case 'pl-srcmenu': s.srcMenu = !s.srcMenu; render(); return true;
    case 'pl-src': s.src = id; s.srcMenu = false; render(); return true;
    case 'pl-tray': s.tray = !s.tray; render(); return true;
    case 'pl-pick': {
      const d = dayOf(); const m = slotsOf(d); const key = Object.keys(m).find((k2) => m[k2] === id);
      if (key) { delete m[key]; if (s.moves) delete s.moves[id]; render(); return true; }
      fill(id); if (btn.dataset.block && Object.values(m).includes(id)) (s.moves ||= {})[id] = btn.dataset.block;
      render(); return true;
    }
    case 'pl-un': { const m = slotsOf(dayOf()); if (s.moves) delete s.moves[m[id]]; delete m[id]; render(); return true; }
    case 'pl-clear': s.slots[dayOf()] = {}; if (s.times) s.times[dayOf()] = {}; s.moves = {}; render(); return true;
    case 'pl-place': placeDay(); return true;
    case 'pl-ton': {
      const on = tplOn(); const next = on.includes(id) ? on.filter((k) => k !== id) : [...on, id];
      if (!next.length) { toast(t('plOneAtLeast')); return true; }
      saveSettings({ planTpls: TPL_ORDER.filter((k) => next.includes(k)), ...(next.includes(curTpl()) ? {} : { dayRule: next[0] }) }); render(); return true;
    }
    case 'fd-pick': if (s.open && s.mode === 'manual') { fill(id); render(); return true; } return false;
    default: return false;
  }
}
// the search and the times in the tray
document.addEventListener('input', (e) => { if (e.target.id !== 'pf-q') return; st().q = e.target.value; st().srcMenu = false; render(); });
document.addEventListener('change', (e) => {
  const key = e.target.dataset?.pltime; if (!key) return;
  const mm = /^(\d{1,2})[:.]?(\d{2})$/.exec(e.target.value.trim()); if (!mm) return;
  const d = dayOf(); ((st().times ||= {})[d] ||= {})[key] = Math.min(23, Number(mm[1])) * 60 + Math.min(59, Number(mm[2])); render();
});
document.addEventListener('click', (e) => { const s = ui.pl; if (s?.srcMenu && !e.target.closest?.('.pf-srcm, [data-action=pl-srcmenu]')) { s.srcMenu = false; if (!e.target.closest?.('[data-action]')) render(); } }, true);
// Impostazioni › Planner: the schemi and the week's themes.
export function plSettingsHtml(categories, catName) {
  const on = tplOn(); const th = state.settings.planThemes || {};
  const days = [1, 2, 3, 4, 5, 6, 7];
  return `<div class="field-label">${esc(t('plSetTitle'))}</div><p class="hint">${esc(t('plSetHint'))}</p>
    <div class="pf-set">${TPL_ORDER.map((k) => `<button type="button" class="pf-srow" data-action="pl-ton" data-id="${k}" aria-pressed="${on.includes(k)}"><span class="pf-mt"><b>${esc(tName(k))}</b><small>${esc(tLine(k))}</small></span>${shape(k)}<span class="pf-sw${on.includes(k) ? ' on' : ''}" aria-hidden="true"></span></button>`).join('')}</div>
    <div class="field-label">${esc(t('plThemes'))}</div><p class="hint">${esc(t('plThemesHint'))}</p>
    <div class="pf-themes">${days.map((d) => `<label>${esc(fmtDay(addDays('2026-11-01', d), { weekday: 'long' }))}<select name="theme_${d}"><option value="">—</option>${categories().map((c) => `<option value="${esc(c.id)}" ${th[d] === c.id ? 'selected' : ''}>${esc(catName(c))}</option>`).join('')}</select></label>`).join('')}</div>`;
}
export { tplAccepts };
