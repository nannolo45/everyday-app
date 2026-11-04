// tripui.js (v90): «Conta il viaggio» with its route line, shared by the + sheet (a task) and Luoghi salvati
// (a place's default). The switch stays one tap; under it one line shows where the trip starts, the place,
// and where it ends, with the minutes of each leg. Tapping an end or the minutes opens a small editor:
// Auto (where you'll be before / where you go next, else home), Casa, a saved place, or none; minutes
// looked up or fixed. State: { on, from, to, thereMin, backMin, open }.
import { esc } from './core.js';
import { t } from './i18n.js';
import { allPlaces, placeAddress, placeById, placeEmoji, recentPlaces } from './places.js';
import { travelCfg } from './travel-plan.js';

const LEG = { from: 'thereMin', to: 'backMin' };
export function tvState(tv = {}) {
  const there = tv.there !== false; const back = tv.back !== false;
  return { on: there || back, from: there ? tv.from || 'auto' : 'none', to: back ? tv.to || 'auto' : 'none', thereMin: tv.thereMin ?? null, backMin: tv.backMin ?? null, open: null };
}
// What is stored on the task (or the place).
export function tvRecord(st, mode = 'default') {
  const on = st.on && (st.from !== 'none' || st.to !== 'none');
  return { there: on && st.from !== 'none', back: on && st.to !== 'none', from: st.from === 'none' ? 'auto' : st.from, to: st.to === 'none' ? 'auto' : st.to,
    thereMin: st.thereMin ?? null, backMin: st.backMin ?? null, mode };
}
export const tvSame = (a, b) => JSON.stringify(tvRecord(a)) === JSON.stringify(tvRecord(b));

const homeLabel = () => `🏠 ${t('tvHome')}`;
const placeLabel = (p) => `${placeEmoji(p)} ${p.name}`;
// An address as a short label: Casa, a saved place's name, else the address's first part.
export function addrLabel(addr) {
  const a = String(addr || '').trim().toLowerCase();
  if (!a || a === String(travelCfg().home || '').trim().toLowerCase()) return homeLabel();
  const p = allPlaces().find((q) => placeAddress(q).trim().toLowerCase() === a || (q.name || '').toLowerCase() === a);
  return p ? placeLabel(p) : `📍 ${String(addr).split(',')[0]}`;
}
const endLabel = (v, step, k) => (v === 'home' ? homeLabel() : v !== 'auto' && placeById(v) ? placeLabel(placeById(v)) : step ? addrLabel(k === 'from' ? step.from : step.to) : t(k === 'from' ? 'tvAutoFrom' : 'tvAutoTo'));
const legMin = (st, k, step) => { const f = st[LEG[k]]; return f != null ? { m: Number(f), fixed: true, known: true } : step ? { m: Number(step.minutes) || 0, known: step.known !== false } : null; };
const minText = (lm) => (!lm ? t('tvAutoMin') : lm.known ? `${lm.m}m` : `~${lm.m}m`);

// The switch's small line: what counts, and how long.
export function tvSummary(st, route = null) {
  if (!st.on || (st.from === 'none' && st.to === 'none')) return t('tvOff');
  const a = st.from !== 'none' ? legMin(st, 'from', route?.there) : null; const b = st.to !== 'none' ? legMin(st, 'to', route?.back) : null;
  const known = [a, b].filter(Boolean); const m = known.every((x) => x) && route ? known.reduce((n, x) => n + x.m, 0) : null;
  const what = st.from === 'none' ? t('tvSumBack') : st.to === 'none' ? t('tvSumThere') : t('tvSumBoth');
  return m != null ? `${what} · ${m}m` : what;
}
// here: the task's place label; route: routeOf(…) for a task, null for a place's default; skip: the place's own id.
export function tripHtml(st, { here = '', route = null, skip = null } = {}) {
  const tog = `<button class="pl-tog${st.on ? ' on' : ''}" value="tv-on" formnovalidate><span>${esc(t('plTravel'))}<small>${esc(tvSummary(st, route))}</small></span><i></i></button>`;
  if (!st.on) return tog;
  const end = (k) => (st[k] === 'none'
    ? `<button class="tv-node off" value="tv-add:${k}" formnovalidate>${esc(t(k === 'from' ? 'tvAddThere' : 'tvAddBack'))}</button>`
    : `<button class="tv-node${st.open === k ? ' on' : ''}" value="tv-open:${k}" formnovalidate>${esc(endLabel(st[k], k === 'from' ? route?.there : route?.back, k))}</button>`);
  const leg = (k) => { const lm = legMin(st, k, k === 'from' ? route?.there : route?.back); return `<button class="tv-leg${lm?.fixed ? ' fixed' : ''}" value="tv-open:${k}" formnovalidate>${esc(minText(lm))}${lm?.fixed ? ' ✎' : ''}</button>`; };
  const ar = '<span class="tv-ar" aria-hidden="true">→</span>';
  const line = `<div class="tv-route">${st.from === 'none' ? end('from') : `${end('from')}${ar}${leg('from')}${ar}`}<span class="tv-node here">${esc(here)}</span>${st.to === 'none' ? end('to') : `${ar}${leg('to')}${ar}${end('to')}`}</div>`;
  return `${tog}${line}<p class="pl-hint">${esc(t('tvHint'))}</p>${st.open ? editor(st, st.open, route, skip) : ''}`;
}
function editor(st, k, route, skip) {
  const step = k === 'from' ? route?.there : route?.back;
  const autoL = st[k] === 'auto' && step ? endLabel('auto', step, k) : t(k === 'from' ? 'tvAutoFrom' : 'tvAutoTo');
  const all = st.all === k; // (place editor) the whole list in place of the recent three
  const places = (all ? allPlaces() : recentPlaces(8)).filter((p) => p.id !== skip && p.id !== st[k]).slice(0, all ? 200 : 3);
  const cur = st[k] !== 'auto' && st[k] !== 'home' && st[k] !== 'none' ? placeById(st[k]) : null;
  const chip = (v, label) => `<button class="pl-chip${st[k] === v ? ' on' : ''}" value="tv-end:${k}:${esc(v)}" formnovalidate>${esc(label)}</button>`;
  const lm = legMin({ ...st, [LEG[k]]: null }, k, step);
  const fixed = st[LEG[k]];
  return `<div class="tv-box"><div class="tv-bh"><b>${esc(t(k === 'from' ? 'tvFrom' : 'tvTo'))}</b><button class="pl-x" value="tv-close" formnovalidate aria-label="${esc(t('close'))}">✕</button></div>
    <div class="pl-chips">${chip('auto', t('tvAuto', autoL.replace(/^\S+ /, '')))}${chip('home', homeLabel())}${cur ? chip(cur.id, placeLabel(cur)) : ''}${places.map((p) => chip(p.id, placeLabel(p))).join('')}${all ? '' : `<button class="pl-chip pl-all" value="tv-all:${k}" formnovalidate>☰ ${esc(t('plAll'))}</button>`}${chip('none', t(k === 'from' ? 'tvNoThere' : 'tvNoBack'))}</div>
    ${st[k] === 'none' ? '' : `<div class="tv-mins"><span>${esc(t('tvLen'))}</span><button class="pl-chip${fixed == null ? ' on' : ''}" value="tv-auto:${k}" formnovalidate>${esc(lm ? t('tvCalc', minText(lm)) : t('tvCalcNone'))}</button><input class="pl-num sm" data-tvmin="${k}" inputmode="numeric" value="${fixed ?? ''}" placeholder="—" aria-label="${esc(t('tvFixedMin'))}"><small>${esc(t('tvFixedMin'))}</small></div>`}
    ${st[k] === 'auto' ? `<p class="pl-hint">${esc(t('tvAutoWhy'))}</p>` : ''}</div>`;
}
// Fixed minutes typed in the editor.
export function tvRead(form, st) {
  form.querySelectorAll('[data-tvmin]').forEach((el) => { const n = parseInt(el.value, 10); st[LEG[el.dataset.tvmin]] = Number.isFinite(n) && n >= 0 ? n : null; });
}
// A tap: returns 'all:from' / 'all:to' when the whole list of places should open, true when handled.
export function tvAction(st, action) {
  const [a, k, ...rest] = action.split(':'); const v = rest.join(':');
  if (a === 'tv-on') { st.on = !st.on; st.open = null; if (st.on && st.from === 'none' && st.to === 'none') { st.from = 'auto'; st.to = 'auto'; } return true; }
  if (a === 'tv-open') { st.open = st.open === k ? null : k; st.all = null; return true; }
  if (a === 'tv-close') { st.open = null; return true; }
  if (a === 'tv-add') { st[k] = 'auto'; return true; }
  if (a === 'tv-end') { st[k] = v; if (v === 'none') { st.open = null; if (st.from === 'none' && st.to === 'none') { st.on = false; st.from = 'auto'; st.to = 'auto'; } } return true; }
  if (a === 'tv-auto') { st[LEG[k]] = null; return true; }
  if (a === 'tv-all') return `all:${k}`;
  return false;
}
