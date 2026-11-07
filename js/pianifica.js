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
import { get, saveSettings, state } from './store.js';
import { render } from './shell.js';
import { cardRowsIn } from './weekpick.js';
import { scheduleTravelRefresh } from './travel-plan.js';
import { viewRange } from './finder.js';
import { isWide } from './views/wide.js';

export const tplOn = () => { const l = state.settings.planTpls; return Array.isArray(l) && l.length ? TPL_ORDER.filter((k) => l.includes(k)) : TPL_DEFAULT; };
const st = () => {
  if (!ui.pl) ui.pl = { open: false, mode: null, menu: false, day: null, slots: {} };
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
function slotsHtml() {
  const d = dayOf(); const k = curTpl(); const T = TPLS[k]; const m = slotsOf(d);
  const row = (key, i, ranked) => { const x = get('tasks', m[key]);
    return x ? `<div class="pf-slot f"><span class="pf-dot" style="background:${catColor(x)}"></span>${ranked ? `<span class="pf-n">${i}</span>` : ''}<span class="pf-st">${esc(x.title)}</span><small>${esc(T.pomo ? `🍅×${pomodori(x.minutes)}` : fmtDur(x.minutes || 30))}</small><button type="button" class="pf-x" data-action="pl-un" data-id="${esc(key)}" aria-label="${esc(t('remove'))}">✕</button></div>` : ''; };
  if (k === 'free' || T.pomo) {
    const keys = Object.keys(m).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
    const used = T.pomo ? (usedIn(d)[0] || 0) : keys.length;
    return `<div class="pf-gh">${esc(T.pomo ? t('tplG_pomo_0') : t('tplG_free_0'))}<span>${T.pomo ? `${used}/8 🍅` : keys.length}</span></div>${keys.map((key, i) => row(key, i + 1)).join('')}<div class="pf-slot next">${esc(t('plTapHint'))}</div>`;
  }
  let lit = false; let n = 0;
  return T.g.map(([, cnt], gi) => {
    const have = Object.keys(m).filter((key) => key.startsWith(`${gi}-`)).length;
    const rows = Array.from({ length: cnt }, (_, i) => { n += 1; const key = `${gi}-${i}`;
      if (m[key]) return row(key, n, T.ranked);
      const on = !lit; lit = true;
      return `<div class="pf-slot${on ? ' next' : ''}">${T.ranked ? `<span class="pf-n">${n}</span>` : ''}${on ? esc(t('plTapHint')) : '…'}</div>`; }).join('');
    return `<div class="pf-gh">${esc(gName(k, gi))}<span>${have}/${cnt}</span></div>${rows}`;
  }).join('');
}
const catColor = (x) => { const c = catsOf(x)[0]; return (c && get('categories', c)?.color) || 'var(--muted)'; };

// ---------- the panel ----------
export function plPanel({ withFoot = true } = {}) {
  const s = st(); const k = curTpl(); const days = periodDays();
  const list = tplOn().includes(k) ? tplOn() : [...tplOn(), k];
  const menu = `<button type="button" class="pf-menu${s.menu ? ' on' : ''}" data-action="pl-menu" aria-expanded="${s.menu}"><span class="pf-mt"><b>${esc(tName(k))}</b><small>${esc(tLine(k))}</small></span>${shape(k)}<span class="pf-car" aria-hidden="true">▾</span></button>
    ${s.menu ? `<div class="pf-list">${list.map((id) => `<button type="button" class="${id === k ? 'on' : ''}" data-action="pl-tpl" data-id="${id}"><span class="pf-mt"><b>${esc(tName(id))}</b><small>${esc(tLine(id))}</small></span>${shape(id)}<span class="pf-ck" aria-hidden="true">${id === k ? '✓' : ''}</span></button>`).join('')}
      <a class="pf-more" href="#/settings/planner">${esc(t('plMore'))} ›</a></div>` : ''}`;
  const chips = s.mode === 'manual' && days.length > 1 ? `<div class="pf-days">${days.map((d) => { const n = Object.keys(slotsOf(d)).length; return `<button type="button" class="${d === dayOf() ? 'on' : ''}" data-action="pl-day" data-id="${d}"><b>${esc(fmtDay(d, { weekday: 'short', day: 'numeric' }))}</b><small>${esc(t('plNIn', n))}</small></button>`; }).join('')}</div>` : '';
  const empty = !days.length ? `<p class="hint">${esc(t('plPast'))}</p>` : '';
  const theme = k === 'theme' && !Object.keys(state.settings.planThemes || {}).length ? `<p class="hint pf-warn">${esc(t('plNoThemes'))} <a href="#/settings/planner">${esc(t('plSetThemes'))} ›</a></p>` : '';
  const foot = plFoot();
  return `<div class="pf">
    <div class="pf-h">${esc(t('plHow'))}</div>
    <div class="pf-opts"><button type="button" class="pf-opt${s.mode === 'auto' ? ' on' : ''}" data-action="pl-mode" data-id="auto" ${days.length ? '' : 'disabled'}><b>✦ ${esc(t('plAuto'))}</b><small>${esc(t('plAutoSub'))}</small></button>
      <button type="button" class="pf-opt${s.mode === 'manual' ? ' on' : ''}" data-action="pl-mode" data-id="manual" ${days.length ? '' : 'disabled'}><b>${esc(t('plManual'))}</b><small>${esc(t('plManualSub'))}</small></button></div>
    <div class="pf-h">${esc(t('plDistr'))}</div>${menu}${theme}${empty}${chips}
    ${s.mode === 'manual' && days.length ? `<div class="pf-slots">${slotsHtml()}</div>` : ''}${withFoot ? foot : ''}</div>`;
}
function plFoot() {
  const s = st(); const days = periodDays();
  return s.mode === 'manual' && days.length ? `<div class="pf-foot"><button type="button" class="btn" data-action="pl-clear">${esc(t('plClear'))}</button><button type="button" class="btn primary" data-action="pl-place" ${Object.keys(slotsOf(dayOf())).length ? '' : 'disabled'}>${esc(t('plPlace'))} →</button></div>` : '';
}
// the button (pane and phone card) — the period on screen, no ✦
export const plButton = (cls = '') => `<button class="btn primary pf-btn ${cls}" type="button" data-action="pl-open" aria-expanded="${plOpen()}">${esc(t('planChoose'))} <span>· ${esc(periodLabel())}</span><i aria-hidden="true">${plOpen() ? '▴' : '▾'}</i></button>`;
// The phone's sheet: the panel and, for Manuale, the things to plan.
export function plSheet() {
  if (isWide() || !plOpen() || route().name !== 'plan') return '';
  const s = st(); const used = allSlotted();
  const list = s.mode === 'manual' ? trayTasks().map((x) => { const u = used.has(x.id); const fit = !u && fitsNext(x); return `<button type="button" class="pf-pt${u ? ' used' : ''}${fit ? ' fit' : ''}" data-action="fd-pick" data-id="${esc(x.id)}"><span class="pf-dot" style="background:${catColor(x)}"></span><span class="pf-st">${esc(x.title)}</span><small>${esc(fmtDur(x.minutes || 30))}</small></button>`; }).join('') : '';
  return `<div class="pf-bg" data-action="pl-open"></div><div class="pf-sheet" role="dialog" aria-label="${esc(t('planChoose'))}"><div class="pf-grab" aria-hidden="true"></div>
    <div class="pf-sh"><b>${esc(t('planChoose'))} · ${esc(periodLabel())}</b><button type="button" class="icon" data-action="pl-open" aria-label="${esc(t('close'))}">✕</button></div>
    <div class="pf-scroll">${plPanel({ withFoot: false })}${list ? `<div class="pf-h">${esc(t('pnTabTodo'))} <small>${esc(t('plFitHint'))}</small></div>${list}` : ''}</div>${plFoot()}</div>`;
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
  const d = dayOf(); const k = curTpl(); const T = TPLS[k]; const m = slotsOf(d);
  let keys = Object.keys(m).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (T.long) keys = keys.sort((a, b) => (get('tasks', m[b])?.minutes || 30) - (get('tasks', m[a])?.minutes || 30));
  const ids = keys.map((key) => m[key]).filter((id) => get('tasks', id));
  if (!ids.length) return;
  if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
  const td = today(); const from = Math.max(autoHoursFor(d)[0], d === td ? Math.ceil((nowMinutes() + 5) / 5) * 5 : 0);
  st().slots[d] = {};
  if (!isWide()) st().open = false;
  placeGhosts(ids, [d], from);
}
// Taps; true when handled.
export function plClick(btn) {
  const { action, id } = btn.dataset; const s = st();
  switch (action) {
    case 'pl-open': s.open = !s.open; s.menu = false; render(); return true;
    case 'pl-menu': s.menu = !s.menu; render(); return true;
    case 'pl-tpl': saveSettings({ dayRule: id }); s.menu = false; s.slots = {}; if (s.mode === 'auto') runAuto(); else render(); return true;
    case 'pl-mode': s.mode = id; s.slots = {}; if (id === 'auto') { if (!isWide()) s.open = false; runAuto(); } else { if (ui.assign) { ui.assign.ghosts = []; ui.assign.fix = null; } render(); } return true;
    case 'pl-day': s.day = id; render(); return true;
    case 'pl-un': delete slotsOf(dayOf())[id]; render(); return true;
    case 'pl-clear': s.slots[dayOf()] = {}; render(); return true;
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
