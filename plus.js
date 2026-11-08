// plus.js (v82): the + sheet. The name (☆ keeps it among the Salvate), «È un appuntamento», then three
// tabs (v85; pills before) that open below: ⏱ Durata (a number and a unit, or «non so»), 🕒 Quando (Primo libero · Scelgo
// io · Da decidere; Scelgo io holds the day or the rhythm, the time with Inizio and Fine linked to the
// length, several times a day) and ● Categoria. A pill opened and closed again keeps its default as a
// choice. Then Altre opzioni (importance, deadline, place, steps, «prima serve», rules, notes) open in
// place, and one button that says what it will do.
import { catName, categories, esc, planSettings, relDay, toast, ui } from './core.js';
import { state } from './store.js';
import { t } from './i18n.js';
import { isEvent, isSaved, isTodo } from './kinds.js';
import { catFlag, anchorOffset, nextBlockOf, deleteBlock, ensureSeries, eventTasksOf, isSeries, outcomeOf, planTask, saveEvent, seriesBlocks } from './model.js';
import { upcomingOf } from './finder.js';
import { ownMinutes, realSteps, routeOf, travelOf } from './travel-plan.js';
import { tripHtml, tvAction, tvRead, tvRecord, tvState } from './tripui.js';
import { skipOcc } from './weekpick.js';
import { openWeekGrid } from './weekgrid.js';
import { changed } from './shell.js';
import { addDays, fmtDur, fmtTime, isoDay, nowMinutes, parseDate, parseTime, quickAdd, today } from './plan.js';
import { allPlaces, guessEmoji, hasHours, openState, parsePlaceText, PLACE_ICONS, placeAddress, placeById, placeByText, placeEmoji, quickPlace, recentPlaces, savePlace, searchPlaces } from './places.js';
import { norm, searchAddress, searchOnce } from './travel.js';
import { saveSettings } from './store.js';
import { travelCache, travelCfg } from './travel-plan.js';
import { getLang } from './i18n.js';
import { planSoon, suggestSlot } from './planning.js';
import { get, live, remove, uid, upsert } from './store.js';
import { afterAdd, openEventTaskAdd, openTask, rulesForEditor, saveTask } from './editors.js';
import { dateBox, dayShort, openModal, TIME24, windowsText } from './widgets.js';

const DAY = 1440;
const UNITS = [['min', 1], ['ore', 60], ['giorni', DAY], ['settimane', 7 * DAY], ['mesi', 30 * DAY]];
const unitOf = (k) => UNITS.find(([u]) => u === k)?.[1] || 1;
const ALL7 = [1, 2, 3, 4, 5, 6, 7];
const PER = ['giorno', 'settimana', 'mese', 'anno'];

// "45", "45 min", "2h30", "2,5 ore", "3 giorni", "2 settimane", "1 mese" → { m, u }
export function parseLen(v, unit = 'min') {
  const s = String(v || '').toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)h(\d{1,2})m?$/))) return { m: Math.round(Number(m[1]) * 60 + Number(m[2])), u: 'ore' };
  if ((m = s.match(/^(\d+):(\d{2})$/))) return { m: Number(m[1]) * 60 + Number(m[2]), u: 'ore' };
  if ((m = s.match(/^(\d+(?:\.\d+)?)(mes|sett|week|giorn|gg|day|tag|g$|d$|ore|ora|h|std|min|m$)?/))) {
    const n = Number(m[1]); const k = m[2] || '';
    const u = /^mes/.test(k) ? 'mesi' : /^(sett|week)/.test(k) ? 'settimane' : /^(giorn|gg|day|tag|g$|d$)/.test(k) ? 'giorni' : /^(ore|ora|h|std)/.test(k) ? 'ore' : /^(min|m$)/.test(k) ? 'min' : unit;
    return { m: Math.max(1, Math.round(n * unitOf(u))), u };
  }
  return null;
}
// the unit a length reads best in, and its number (2.5 ore, not 150 min)
export function lenParts(min, unit = null) {
  const u = unit || (min >= 30 * DAY && min % (30 * DAY) === 0 ? 'mesi' : min >= 7 * DAY && min % (7 * DAY) === 0 ? 'settimane' : min >= DAY && min % DAY === 0 ? 'giorni' : min >= 60 && min % 30 === 0 ? 'ore' : 'min');
  return { n: Math.round((min / unitOf(u)) * 100) / 100, u };
}
export function fmtLen(min) {
  const { n, u } = lenParts(min);
  if (u === 'min' || (u === 'ore' && Number.isInteger(n))) return fmtDur(min);
  return `${String(n).replace('.', t('decimalSep'))} ${t(`lu_${u}${n === 1 ? '1' : ''}`)}`;
}
// "3 al giorno", "1 anno", "2 volte al mese", "ogni settimana" → { n, per }
export function parseFreq(v) {
  const s = String(v || '').toLowerCase();
  const n = Number((s.match(/\d+/) || [])[0]) || (/\b(una|uno|ogni|once|every|ein|jede)\b/.test(s) ? 1 : null);
  const per = /(giorn|day|tag|\bdì\b)/.test(s) ? 'giorno' : /(sett|week|woche)/.test(s) ? 'settimana' : /(mes|month|monat)/.test(s) ? 'mese' : /(ann|year|jahr)/.test(s) ? 'anno' : null;
  return { n, per };
}

function fresh(text = '') {
  return {
    name: text, save: false, appt: false, pop: null, touched: {},
    len: 30, lenUnit: null, lenSet: false, unknown: false,
    wc: undefined, once: true, date: today(), dates: [], addOpen: false, mode: 'first', start: null, end: null, anchor: 'start',
    n: 1, per: 'settimana', days: [], until: 'always', times: [],
    cat: null, more: false, open: null, imp: 3, due: '', place: '', placeId: null, people: 2, tv: tvState(), tvOwn: false, legOv: null, steps: [], after: [], ok: [], ko: [], notes: '',
    // (v84) editing a task: its id, the Quando it had (to know if it changed), its steps, checklist, margin, other rules
    edit: null, orig: null, stepObjs: null, checklist: [], buffer: '', room: null, keepRules: [], ov: null, rk: 'ok', untilKeep: null, ovt: 'recent',
  };
}
let P = fresh();

const len = () => (P.unknown ? 60 : P.len);
// (v85) the chosen place's opening hours, for the first-free preview (the travel there not counted yet)
const hoursNow = () => { const p = placeById(P.placeId); return hasHours(p) ? { hours: p.hours, pre: 0, own: Math.min(len(), DAY) } : {}; };
const lenLabel = () => (P.unknown ? t('lenUnknownL') : fmtLen(P.len));
const span = (a) => `${fmtTime(a)}–${fmtTime(a + len())}`;
// the Quando choice in a few words
function whenWords(long = false) {
  if (P.wc === 'first') { const s = suggestSlot({ title: P.name, minutes: Math.min(len(), DAY), ...hoursNow() }); return s ? t('plFirstAt', relDay(s.date), fmtTime(s.start)) : t('plFirst'); }
  if (P.wc !== 'pick') return t('plLater');
  if (P.once) {
    const tm = P.mode === 'at' && P.start != null ? (long ? span(P.start) : fmtTime(P.start)) : P.appt ? t('allDay') : t('plWhereFreeShort');
    const ds = dts();
    return `${ds.length > 1 ? (long ? ds.map((d) => relDay(d)).join(', ') : t('plNDays', ds.length)) : relDay(P.date)} · ${tm}`;
  }
  const sortedDays = [...P.days].sort((x, y) => x - y);
  if (!long && P.per === 'settimana' && P.days.length && P.days.length === P.n) return `↻ ${sortedDays.map(dayShort).join(', ')}${P.mode === 'at' && P.start != null ? ` · ${fmtTime(P.start)}` : ''}`; // (v84) the days say more than «2× a settimana»
  const r = t('plFreq', P.n, P.per);
  const days = (P.per === 'settimana' || P.per === 'giorno') && P.days.length && P.days.length < 7 ? ` · ${[...P.days].sort().map(dayShort).join(', ')}` : '';
  const tms = P.per === 'giorno' && P.n > 1 ? P.times.filter((x) => x?.s != null).map((x) => fmtTime(x.s)).join(', ') : P.mode === 'at' && P.start != null ? fmtTime(P.start) : '';
  return `↻ ${r}${long ? days : ''}${long && tms ? ` · ${tms}` : ''}`;
}
function linkTimes(k) {
  const L = len();
  if (k === 'start' && P.start != null) { if (P.anchor === 'end' && P.end != null) { setLenFrom(P.start, P.end); } else { P.anchor = 'start'; P.end = (P.start + L) % 1440; } }
  if (k === 'end' && P.end != null) { if (P.anchor === 'start' && P.start != null) { setLenFrom(P.start, P.end); } else { P.anchor = 'end'; P.start = ((P.end - L) % 1440 + 1440) % 1440; } }
  if (k === 'len') {
    if (P.anchor === 'end' && P.end != null) P.start = ((P.end - L) % 1440 + 1440) % 1440; else if (P.start != null) P.end = (P.start + L) % 1440;
    P.times = P.times.map((x) => (!x ? x : P.anchor === 'end' && x.e != null ? { ...x, s: ((x.e - L) % 1440 + 1440) % 1440 } : x.s != null ? { ...x, e: (x.s + L) % 1440 } : x));
  }
}
// (v117) the days picked: one or more dates (Quando · Che giorno)
const dts = () => (P.dates.length ? [...P.dates].sort() : [P.date]);
function setDates(list) { const l = [...new Set(list.filter(Boolean))].sort(); P.dates = l.length > 1 ? l : []; P.date = l[0] || today(); }
function setLenFrom(a, b) { let d = b - a; if (d <= 0) d += 1440; P.len = d; P.lenUnit = null; P.lenSet = true; P.unknown = false; P.touched.len = true; }

// ---------- the pieces ----------
// (v85) Durata · Quando · Categoria are tabs: each says its value; the open one is filled, one open at a time.
const tab = (k, cap, label, on) => `<button class="pl-tab${on ? ' set' : ''}${P.pop === k ? ' open' : ''}" value="pop:${k}" formnovalidate role="tab" aria-selected="${P.pop === k}" aria-expanded="${P.pop === k}"><small>${cap}</small><span>${label}</span></button>`;
const stepSum = () => (P.stepObjs || []).reduce((n, y) => n + (Number(y.minutes) || 10), 0);
function lenPanel() {
  if (P.stepObjs?.length) return `<p class="pl-hint">${esc(t('durationFromSteps', fmtDur(stepSum())))}</p><button class="pl-chip" value="row:steps" formnovalidate>${esc(t('steps'))} ›</button>`;
  const { n, u } = lenParts(P.len, P.lenUnit);
  const shown = P.lenSet && !P.unknown;
  const long = shown && P.len >= DAY;
  return `<div class="pl-row"><input id="pl-len" class="pl-num" inputmode="decimal" value="${shown ? String(n).replace('.', t('decimalSep')) : ''}" placeholder="${P.unknown ? '?' : '30'}" aria-label="${esc(t('duration'))}" ${P.unknown ? 'disabled' : ''}>
    <select id="pl-lenu" class="pl-sel" aria-label="${esc(t('plUnit'))}" ${P.unknown ? 'disabled' : ''}>${UNITS.map(([k]) => `<option value="${k}" ${k === (shown ? u : P.lenUnit || 'min') ? 'selected' : ''}>${esc(t(`lu_${k}`))}</option>`).join('')}</select>
    <button class="pl-chip${P.unknown ? ' on' : ''}" value="unknown" formnovalidate>${esc(t('lenUnknownL'))}</button></div>
    <p class="pl-hint">${esc(P.unknown ? t('plUnknownHint') : long ? (P.appt ? t('plLongAppt', fmtLen(P.len)) : t('plLongTask', fmtLen(P.len))) : t('plLenHint'))}</p>`;
}
const timeBox = (k, label, v, id, small = false) => `<label class="pl-tbox${small ? ' sm' : ''}${P.anchor === k ? ' anchor' : ''}${v != null ? ' set' : ''}"><span data-anchor="${k}">${esc(label)}</span><input id="${id}" ${TIME24} value="${v != null ? fmtTime(v) : ''}" aria-label="${esc(label)}"></label>`;
// (v117) Quando in one card: «Che giorno» (one or more days, or a rhythm; none = the planner or later),
// «A che ora» (at a time, or wherever there's room) and the length, which comes from the times when there are some.
function whenPanel() {
  const rows = P.wc === 'pick';
  const auto = P.wc === 'first';
  const multi = rows && !P.once && P.per === 'giorno' && P.n > 1;
  let body = `<div class="pl-lbl pl-lblr"><span>${esc(t('plDayQ'))}</span>${rows ? `<button class="linkish" value="wc:${P.appt ? 'pick' : 'later'}" formnovalidate ${P.appt ? 'hidden' : ''}>${esc(t('plClearDays'))}</button>` : ''}</div>`;
  if (rows && P.once) {
    const ds = dts();
    body += ds.map((d, i) => `<div class="pl-drow"><span class="pl-dic" aria-hidden="true">📅</span><label class="pl-date">${dateBox(`<input id="pl-d${i}" data-di="${i}" type="date" value="${esc(d)}" min="${today()}" aria-label="${esc(t('whichDay'))}">`, d)}</label>${ds.length > 1 || !P.appt ? `<button class="pl-x" value="drm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button>` : ''}</div>`).join('');
  } else if (rows) {
    body += `<div class="pl-drow rh"><span class="pl-dic" aria-hidden="true">↻</span><input id="pl-n" class="pl-num" value="${P.n}" inputmode="text" aria-label="${esc(t('plHowOften'))}"><select id="pl-per" class="pl-sel" aria-label="${esc(t('plUnit'))}">${PER.map((k) => `<option value="${k}" ${P.per === k ? 'selected' : ''}>${esc(t(`per2_${k}`))}</option>`).join('')}</select><button class="pl-x" value="wc:${P.appt ? 'pick' : 'later'}" formnovalidate aria-label="${esc(t('remove'))}" ${P.appt ? 'hidden' : ''}>✕</button></div>`;
    let more = '';
    if (P.per === 'settimana' || P.per === 'giorno') {
      more += `<div class="pl-days">${ALL7.map((d) => `<button class="${P.days.includes(d) ? 'on' : ''}" value="wd:${d}" formnovalidate>${esc(dayShort(d).slice(0, 1).toUpperCase())}</button>`).join('')}</div>`;
      if (P.per === 'settimana') more += `<p class="pl-hint">${esc(P.days.length === P.n ? t('plDaysExact') : P.days.length ? t('plDaysFewer', P.n) : t('plDaysNone', P.n))}</p>`;
    } else more += `<div class="pl-row"><span class="pl-mid">${esc(t('plFrom'))}</span><label class="pl-date">${dateBox(`<input id="pl-date" type="date" required value="${esc(P.date)}" min="${today()}">`, P.date)}</label></div><p class="pl-hint">${esc(t(P.per === 'mese' ? 'plMonthly' : 'plYearly', parseDate(P.date).getDate()))}</p>`;
    more += `<div class="pl-chips">${['always', 'w4', 'n10'].map((k) => `<button class="pl-chip${P.until === k ? ' on' : ''}" value="until:${k}" formnovalidate>${esc(t(`plU_${k}`))}</button>`).join('')}</div>`;
    body += `<div class="pl-rhmore">${more}</div>`;
  } else {
    body += `<div class="pl-drow none"><span class="pl-dic" aria-hidden="true">—</span><span><b>${esc(t('plNoDay'))}</b><small>${esc(P.appt ? t('plApptNeedsDay') : auto ? t('plNoDayAuto') : t('plNoDayLater'))}</small></span></div>`;
  }
  const canDay = !(rows && !P.once);
  body += P.addOpen
    ? `<div class="pl-addopts"><button class="pl-addopt" value="add-day" formnovalidate ${canDay ? '' : 'disabled'}><span aria-hidden="true">📅</span><span><b>${esc(t('plAddOneDay'))}</b><small>${esc(canDay ? t('plAddOneDaySub') : t('plRhythmOnly'))}</small></span></button><button class="pl-addopt" value="add-rh" formnovalidate><span aria-hidden="true">↻</span><span><b>${esc(t('plAddRhythm'))}</b><small>${esc(rows && P.once ? t('plRhythmReplaces') : t('plAddRhythmSub'))}</small></span></button></div>`
    : `<button class="pl-add" value="add-open" formnovalidate>＋ ${esc(t('plAddDay'))}</button>`;
  if (rows) {
    body += `<div class="pl-lbl">${esc(multi ? t('plTimesDay', P.n) : t('plTimeQ'))}</div>`;
    if (multi) {
      body += Array.from({ length: P.n }, (_, i) => { const x = P.times[i] || {}; return `<div class="pl-se"><span class="pl-k">${i + 1}ª</span>${timeBox('start', t('start'), x.s ?? null, `pl-ts${i}`, true)}<span class="pl-arrow">→</span>${timeBox('end', t('tpEnd'), x.e ?? null, `pl-te${i}`, true)}</div>`; }).join('');
      body += `<p class="pl-hint">${esc(t('plAnchorHint', P.anchor === 'start'))} ${esc(t('plEmptyTimes'))}</p>${lenPanel()}`;
    } else {
      const at = P.mode === 'at';
      body += `<div class="pl-seg"><button class="${at ? 'on' : ''}" value="mode:at" formnovalidate>🕘 ${esc(t('plAt'))}</button><button class="${at ? '' : 'on'}" value="mode:free" formnovalidate>${P.appt ? `☀ ${esc(t('allDay'))}` : `✦ ${esc(t('plFreeOpt'))}`}</button></div>`;
      if (at) body += `<div class="pl-se">${timeBox('start', t('start'), P.start, 'pl-s')}<span class="pl-arrow">→</span>${timeBox('end', t('tpEnd'), P.end, 'pl-e')}</div><p class="pl-hint">${esc(P.start != null && P.end != null ? t('plDurFromTimes', lenLabel()) : P.start != null || P.end != null ? t('plAnchorHint', P.anchor === 'start') : t('plTimeHint'))}</p>`;
      else body += `${P.appt ? '' : lenPanel()}<p class="pl-hint">${esc(P.appt ? t('plAllDayHint') : P.once ? t(dts().length > 1 ? 'plFreeHintN' : 'plFreeHint') : t('plFreeHintRh'))}</p>`;
    }
  } else {
    if (!P.appt) body += `<button class="pl-tog${auto ? ' on' : ''}" value="wc:${auto ? 'later' : 'first'}" formnovalidate><span>${esc(t('plAutoTog'))}<small>${esc(auto ? t('plFirstHint', whenWords()) : t('plAutoTogOff'))}</small></span><i></i></button>`;
    body += lenPanel();
  }
  return body;
}
function catPanel() {
  return `<div class="pl-chips">${categories().map((c) => `<button class="pl-chip${P.cat === c.id ? ' on' : ''}" value="cat:${esc(c.id)}" formnovalidate><i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>${esc(catName(c))}</button>`).join('')}<button class="pl-chip${!P.cat ? ' on' : ''}" value="cat:" formnovalidate>${esc(t('noCategory'))}</button></div>`;
}
// (v85) Luogo e spostamenti: a saved place (search, or ☰ Tutte), or an address typed for this task only.
// (v90) the trip as it would be: a draft of the task with this sheet's place and travel
function draftRoute() {
  if (!P.place) return null;
  const x0 = (P.edit && get('tasks', P.edit)) || {};
  try { return routeOf({ ...x0, id: P.edit || 'pl-draft', title: P.name || '…', kind: x0.kind || 'todo', place: P.place, placeId: P.placeId, travel: tvRecord(P.tv), steps: [], minutes: len() }, P.edit ? nextBlockOf(P.edit) : null); } catch { return null; }
}
// a place was chosen: its own travel default, unless you set the trip by hand in this sheet
function placeChosen() { if (P.tvOwn) return; const d = placeById(P.placeId)?.travel; P.tv = tvState(d || {}); }
// what the task stores: nothing (the place's default applies) unless you changed it here or the place has none
const tvFor = (pid = P.placeId) => (P.tvOwn || !placeById(pid)?.travel ? tvRecord(P.tv) : null);
function placeLabel() { const p = placeById(P.placeId); return p ? `${placeEmoji(p)} ${p.name}` : P.place ? `📍 ${P.place}` : ''; }
function placeBody() {
  const p = placeById(P.placeId);
  const travel = tripHtml(P.tv, { here: placeLabel(), route: draftRoute(), skip: P.placeId });
  if (p) return `<div class="pl-chips"><span class="pl-chip on">${esc(placeEmoji(p))} ${esc(p.name)}<button class="pl-x" value="plc-rm" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span></div>
    <p class="pl-hint">${esc([p.place && p.place !== p.name ? p.place : '', hasHours(p) ? `🕒 ${windowsText(p.hours)}` : t('plcNoLimits')].filter(Boolean).join(' · '))}</p>${travel}`;
  if (P.place) return `<div class="pl-chips"><span class="pl-chip on">📍 ${esc(P.place)}<button class="pl-x" value="plc-rm" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span><button class="pl-chip" value="plc-save" formnovalidate>☆ ${esc(t('plcSaveAs'))}</button></div>
    <p class="pl-hint">${esc(t('plcOnlyHere'))}</p>${travel}`;
  if (P.np) return newPlaceBox();
  return `<div class="pl-lirow"><input id="pl-place" class="pl-in" value="${esc(P.pq || '')}" placeholder="${esc(t('npPh'))}" autocomplete="off"><button class="pl-chip pl-all" value="ov:place" formnovalidate title="${esc(t('plAllTitle'))}">☰ ${esc(t('plAll'))}</button></div>
    <p class="np-fmt">${t('npFormat')}</p><div class="pl-sugg" id="pl-sg-place">${P.pq ? placeSuggest() : ''}</div>`;
}
// (v92) A new place: what you typed («nome, indirizzo» works too), your places, then the map's suggestions
// (Photon) as you type; picking one asks only for a name. The point picked is kept for the travel times.
let geoTimer = null;
function placeSuggest() {
  const q = (P.pq || '').trim(); if (!q) return '';
  const pp = parsePlaceText(q);
  const hits = searchPlaces(pp.name || q, 5);
  return `${pp.name ? `<div class="np-parsed">✎ ${t('npParsed', esc(pp.name), esc(pp.addr))}</div>` : ''}
    ${hits.length ? `<div class="np-grp">${esc(t('npYours'))}</div>${hits.map((p) => placeOpt(p, `plc:${esc(p.id)}`)).join('')}` : ''}
    ${mapGroup()}
    ${P.legOv ? '' : `<button class="pl-sopt new" value="plc-asis" formnovalidate>✎ ${esc(t('npAsIs', pp.addr))}<small>${esc(t('npAsIsSub'))}</small></button>`}`;
}
// (v94) the map's part: searching, the suggestions, «nothing found», or «the map doesn't answer» with one search on demand
function mapGroup() {
  const addr = parsePlaceText(P.pq || '').addr; if (addr.length < 3) return '';
  const body = P.geoQ !== addr ? `<p class="pl-hint">${esc(t('npSearching'))}</p>`
    : P.geoDown ? `<div class="np-down">⚠ ${esc(t(P.geoDown === 'again' ? 'npDownAgain' : 'npDown'))}<small>${esc(t('npDownSub'))}</small><button class="btn small" value="plc-once" formnovalidate>🔎 ${esc(t('npSearchOnce'))}</button></div>`
    : (P.geo || []).length ? (P.geo || []).map((g, i) => `<button class="pl-sopt map" value="plc-geo:${i}" formnovalidate><span aria-hidden="true">${g.name ? esc(guessEmoji(g.name)) : '📍'}</span><span>${g.name ? `<b>${esc(g.name)}</b> · ` : ''}${esc(g.main === g.name ? '' : g.main)}<small>${esc([g.sub, g.km != null ? (g.km < 100 ? `${g.km} km` : t('npFar')) : ''].filter(Boolean).join(' · '))}</small></span></button>`).join('')
    : `<p class="pl-hint">${esc(t('npNoMap'))}</p>`;
  return `<div class="np-grp">${esc(t('npOnMap'))}<small>OpenStreetMap</small></div>${body}`;
}
function homePoint() { const h = travelCfg().home; const g = h && travelCache().geo?.[norm(h)]; return g?.lat != null ? { lat: g.lat, lon: g.lon } : null; }
function lookUp(form, sel = '#pl-sg-place', html = placeSuggest) {
  clearTimeout(geoTimer);
  const addr = parsePlaceText(P.pq || '').addr;
  if (addr.length < 3 || typeof fetch !== 'function') return;
  geoTimer = setTimeout(async () => {
    const res = await searchAddress(addr, { fetchFn: (u, i) => fetch(u, i), near: homePoint(), lang: getLang() });
    if (parsePlaceText(P.pq || '').addr !== addr) return; // typed on meanwhile
    P.geo = res || []; P.geoQ = addr; P.geoDown = res ? false : 'down';
    const box = form.querySelector(sel); if (box) box.innerHTML = html();
  }, 350);
}
// «🔎 Cerca sulla mappa»: when Photon doesn't answer, one search on OpenStreetMap's own service (allowed on demand)
async function searchOnceNow() {
  const addr = parsePlaceText(P.pq || '').addr;
  const res = await searchOnce(addr, { fetchFn: (u, i) => fetch(u, i), near: homePoint() });
  if (parsePlaceText(P.pq || '').addr !== addr) return;
  P.geo = res || []; P.geoQ = addr; P.geoDown = res ? false : 'again';
  for (const sel of ['#pl-sg-place', '#pl-ovmap']) { const box = document.querySelector(`dialog[open] ${sel}`); if (box) box.innerHTML = sel === '#pl-ovmap' ? mapGroup() : placeSuggest(); }
}
function newPlaceBox() {
  const n = P.np; const em = n.em || (n.shop ? '🛒' : guessEmoji(n.name));
  return `<div class="np-box"><div class="np-addr">${n.checked ? '✓' : '⚠'} ${esc(n.addr)} <button class="linkish" value="plc-np-back" formnovalidate>${esc(t('npChange'))}</button><small>${esc(t(n.checked ? 'npChecked' : 'npUnchecked'))}</small></div>
    <div class="np-name"><button class="np-em" value="plc-np-emo" formnovalidate aria-label="${esc(t('plcIcon'))}">${esc(em)}</button><input id="pl-npname" class="pl-in" value="${esc(n.name)}" placeholder="${esc(t('npNamePh'))}" autocomplete="off" enterkeyhint="done"></div>
    ${n.emOpen ? `<div class="np-ems">${PLACE_ICONS.map((e) => `<button class="${e === em ? 'on' : ''}" value="plc-np-em:${e}" formnovalidate>${e}</button>`).join('')}</div>` : ''}
    <div class="np-row"><button class="pl-chip${n.shop ? ' on' : ''}" value="plc-np-shop" formnovalidate>🛒 ${esc(t(n.shop ? 'npShopOn' : 'npShop'))}</button><small>${esc(t('npHoursLater'))}</small></div>
    <div class="np-row"><button class="btn primary" value="plc-np-ok" formnovalidate ${n.name.trim() ? '' : 'disabled'}>☆ ${esc(n.name.trim() ? t('npSaveN', n.name.trim()) : t('npSave'))}</button><button class="btn" value="plc-np-once" formnovalidate>${esc(t('npOnce'))}</button></div></div>`;
}
const startNew = (text, checked = false, extra = {}) => { const pp = parsePlaceText(text); P.np = { addr: pp.addr, name: pp.name, checked, em: null, emOpen: false, shop: false, lat: null, lon: null, ...extra }; };
function saveNew() {
  const n = P.np; const name = n.name.trim(); if (!name) return false;
  const rec = savePlace({ id: uid(), name, place: n.addr, link: '', hours: [], em: n.shop ? '🛒' : n.em || guessEmoji(name), ...(n.lat != null ? { lat: n.lat, lon: n.lon } : {}) }, n.shop);
  // the point picked on the map: travel times won't need to look the address up
  if (n.lat != null) { const c = travelCache(); saveSettings({ travelCache: { ...c, geo: { ...(c.geo || {}), [norm(n.addr)]: { lat: n.lat, lon: n.lon, name: n.addr, at: Date.now() } } } }); }
  P.placeId = rec.id; P.place = placeAddress(rec); P.np = null; P.pq = ''; placeChosen(); toast(t('plcSaved', name));
  return true;
}
const openText = (p) => {
  const o = openState(p, today(), nowMinutes(), addDays);
  return !o ? (p.shop ? t('alwaysOpen') : '') : o.k === 'open' ? t('plcOpenTo', fmtTime(o.to)) : o.k === 'later' ? t('plcOpensAt', fmtTime(o.from)) : o.k === 'next' ? t('plcOpensOn', relDay(o.date), fmtTime(o.from)) : t('plcClosed');
};
const placeOpt = (p, value) => `<button class="pl-sopt" value="${value}" formnovalidate>${esc(placeEmoji(p))} ${esc(p.name)}<small>${esc(openText(p) || p.place || '')}</small></button>`;
// (v95) «Altre cose possono starci dentro»: on/off, and how much of other things at most (0 = no limit).
const ROOM_DEFAULT = 180;
const roomVal = () => (!P.room ? '' : P.room.max ? t('roomUpTo', fmtDur(P.room.max)) : t('roomNoLimit'));
function roomBody() {
  const on = Boolean(P.room); const max = P.room?.max || 0;
  return `<button class="pl-tog${on ? ' on' : ''}" value="room" formnovalidate role="switch" aria-checked="${on}"><span>${esc(t(on ? 'roomOnHint' : 'roomOffHint'))}</span><i></i></button>
    ${on ? `<div class="pl-lbl">${esc(t('roomMax'))}</div><div class="pl-row pl-roommax"><span class="pl-step"><button class="pl-chip" value="room-max:-30" formnovalidate aria-label="−30 min" ${max && max > 30 ? '' : 'disabled'}>−</button><b>${esc(max ? fmtDur(max) : t('roomNoLimit'))}</b><button class="pl-chip" value="room-max:30" formnovalidate aria-label="+30 min">+</button></span>
      <button class="pl-chip${max ? '' : ' on'}" value="room-max:0" formnovalidate>${esc(t('roomNoLimit'))}</button></div><p class="pl-hint">${esc(t('roomMaxHint'))}</p>` : ''}`;
}
// Altre opzioni: rows that open in place
const candidates = () => live('tasks').filter((x) => !x.done && !x.deleted && (isTodo(x) || isSaved(x)) && !x.travelRole);
const listEd = (key, ph) => `<div class="pl-chips">${P[key].map((a, i) => `<span class="pl-chip on">${a.isNew ? '✚ ' : ''}${esc(a.title)}<button class="pl-x" value="li-rm:${key}:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span>`).join('')}</div>
  <div class="pl-lirow"><input id="pl-li-${key}" class="pl-in" data-li="${key}" placeholder="${esc(ph)}" autocomplete="off"><button class="pl-chip pl-all" value="ov:${key}" formnovalidate title="${esc(t('plAllTitle'))}">☰ ${esc(t('plAll'))}</button></div><div class="pl-sugg" id="pl-sg-${key}"></div>`;
function optRows() {
  const row = (k, label, val, body) => `<div class="pl-orow${P.open === k ? ' open' : ''}"><button class="pl-ohead" value="row:${k}" formnovalidate><span>${esc(label)}</span><span class="pl-oval">${esc(val || '—')} ${P.open === k ? '▾' : '›'}</span></button>${P.open === k ? `<div class="pl-obody">${body}</div>` : ''}</div>`;
  const nm = (l) => l.map((a) => a.title).join(', ');
  return [
    row('imp', t('importance'), '★'.repeat(P.imp), `<div class="pl-stars">${[1, 2, 3, 4, 5].map((i) => `<button class="${i <= P.imp ? 'on' : ''}" value="imp:${i}" formnovalidate aria-label="${i}">★</button>`).join('')}</div><p class="pl-hint">${esc(t(`imp_${P.imp}`))}</p>`),
    row('due', t('due'), P.due ? relDay(P.due) : '', `<div class="pl-row"><label class="pl-date">${dateBox(`<input id="pl-due" type="date" value="${esc(P.due)}">`, P.due)}</label>${P.due ? `<button class="pl-chip" value="due:" formnovalidate>${esc(t('none'))}</button>` : ''}</div>`),
    row('room', t('roomL'), roomVal(), roomBody()), // (v95) other things may go inside it
    P.stepObjs ? row('steps', t('steps'), P.stepObjs.length ? `${P.stepObjs.length} · ${fmtDur(stepSum())}` : '', `${P.stepObjs.map((y, i) => `<div class="pl-srow"><span>${i + 1}. ${esc(y.title)}</span><input id="pl-sm${i}" class="pl-num sm" data-sm="${i}" inputmode="numeric" value="${Number(y.minutes) || 10}" aria-label="${esc(t('duration'))}"><span class="pl-mid">min</span><button class="pl-x" value="step-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-step" class="pl-in" placeholder="${esc(t('plStepPh'))}" autocomplete="off">${P.stepObjs.length ? `<p class="pl-hint">${esc(t('plStepsLen'))}</p>` : ''}`)
    : row('steps', t('steps'), P.steps.length ? String(P.steps.length) : '', `${P.steps.map((s, i) => `<div class="pl-srow"><span>${i + 1}. ${esc(s)}</span><button class="pl-x" value="step-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-step" class="pl-in" placeholder="${esc(t('plStepPh'))}" autocomplete="off">`),
    row('after', t('needsFirst'), nm(P.after), `${listEd('after', t('plSearchPh'))}<p class="pl-hint">${esc(t('plAfterHint'))}</p>`),
    row('rules', t('plRules'), [P.ok.length && t('plOkN', P.ok.length), P.ko.length && t('plKoN', P.ko.length)].filter(Boolean).join(' · '), `<div class="pl-lbl">${esc(t('plIfDone'))}</div>${listEd('ok', t('plSearchPh'))}<div class="pl-lbl">${esc(t('plIfFail'))}</div>${listEd('ko', t('plSearchPh'))}<p class="pl-hint">${esc(t('plRulesHint'))}</p>`),
    row('check', t('checklist'), P.checklist.length ? String(P.checklist.length) : '', `${P.checklist.map((c, i) => `<div class="pl-srow"><span>☐ ${esc(c)}</span><button class="pl-x" value="cl-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-cl" class="pl-in" placeholder="${esc(t('plCheckPh'))}" autocomplete="off">`),
    P.edit ? row('buffer', t('bufferAfter'), P.buffer === '' ? t('bufferDefault', Number(state.settings.taskBuffer) || 0) : Number(P.buffer) ? fmtDur(Number(P.buffer)) : t('none'), `<div class="pl-chips">${['', 0, 5, 10, 15, 30, 60].map((m) => `<button class="pl-chip${String(P.buffer) === String(m) ? ' on' : ''}" value="buf:${m}" formnovalidate>${esc(m === '' ? t('bufferDefault', Number(state.settings.taskBuffer) || 0) : m ? fmtDur(m) : t('none'))}</button>`).join('')}</div>`) : '',
    P.edit && P.appt ? row('evt', t('secEventTasks'), eventTasksOf(P.edit).length ? String(eventTasksOf(P.edit).length) : '', `${eventTasksOf(P.edit).map((y) => `<button class="pl-sopt" value="evt:${esc(y.id)}" formnovalidate>${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc(y.due ? relDay(y.due) : '')}</small></button>`).join('')}<button class="pl-chip" value="evt-add" formnovalidate>+ ${esc(t('addEventTask'))}</button>`) : '',
    catFlag(P.cat, 'meal') ? row('ppl', t('mealPeople'), String(P.people), `<div class="pl-chips">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="pl-chip${P.people === n ? ' on' : ''}" value="ppl:${n}" formnovalidate>${n}</button>`).join('')}</div><p class="pl-hint">${esc(t('mealPeopleHint'))}</p>`) : '', // (v87) a meal: for how many, by default
    row('notes', t('notes'), P.notes ? '✎' : '', `<textarea id="pl-notes" class="pl-in" rows="3">${esc(P.notes)}</textarea>`),
  ].join('');
}
// (v117) under Quando: Categoria, Luogo and Altro, each a row that opens in place
function secRows() {
  const c = P.cat && get('categories', P.cat);
  const head = (k, ic, label, val, open, action) => `<button class="pl-ohead pl-sec${open ? ' on' : ''}" value="${action}" formnovalidate aria-expanded="${open}"><span class="pl-sic" aria-hidden="true">${ic}</span><span class="pl-sl">${esc(label)}</span><span class="pl-oval">${val} ${open ? '▾' : '›'}</span></button>`;
  const os = optSummary(true);
  return `<div class="pl-orow${P.open === 'cat' ? ' open' : ''}">${head('cat', c ? `<i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>` : '●', t('category'), esc(c ? catName(c) : t('noCategory')), P.open === 'cat', 'row:cat')}${P.open === 'cat' ? `<div class="pl-obody">${catPanel()}</div>` : ''}</div>
    <div class="pl-orow${P.open === 'place' ? ' open' : ''}">${head('place', '📍', t('plLuogo'), esc(placeLabel() || '—'), P.open === 'place', 'row:place')}${P.open === 'place' ? `<div class="pl-obody">${placeBody()}</div>` : ''}</div>
    <div class="pl-orow${P.more ? ' open' : ''}">${head('more', '⋯', t('plMoreTab'), esc(os || '—'), Boolean(P.more), 'more')}${P.more ? `<div class="pl-obody pl-more">${optRows()}</div>` : ''}</div>`;
}
const optSummary = (noPlace = false) => [P.imp !== 3 && '★'.repeat(P.imp), P.due && t('dueOn', relDay(P.due)), !noPlace && P.place && placeLabel(), P.steps.length && t('plStepsN', P.steps.length), P.after.length && `🔒 ${P.after.length}`, (P.ok.length + P.ko.length) && t('plRulesN', P.ok.length + P.ko.length), P.notes && '✎', P.checklist.length && `☑ ${P.checklist.length}`, P.room && `⊕ ${roomVal()}`].filter(Boolean).join(' · ');
// what the name says by itself ("Cena ogni giorno 20:30", "Dentista ven 10:00"), while Quando is untouched
function typedWhen() {
  if (P.wc !== undefined) return null;
  const q = quickAdd(P.name);
  if (q.repeat === 'times') return [t('plGoRoutine'), `↻ ${t('plFreq', q.timesN || 1, ({ day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' })[q.timesPer] || 'settimana')}`];
  if (q.repeat) { const d = q.repeatDays || []; return [t('plGoRoutine'), `↻ ${q.repeat === 'monthly' ? t('qwMonthly') : d.length === 7 ? t('qwAll') : d.map(dayShort).join(', ')}${q.time != null ? ` · ${fmtTime(q.time)}` : ''}${q.minutes ? ` · ${fmtLen(q.minutes)}` : ''}`]; }
  if (q.due && q.time != null) return [t('plGoPlan'), `${relDay(q.due)} · ${fmtTime(q.time)}${q.minutes ? ` · ${fmtLen(q.minutes)}` : ''}`];
  return null;
}
function goLabel() {
  const typed = typedWhen(); if (typed) return typed;
  if (P.wc === 'first') return [t('plGoPlan'), `${whenWords()} · ${lenLabel()}`];
  if (P.wc === 'pick') return [P.once ? t('plGoPlan') : t('plGoRoutine'), `${whenWords(true)} · ${lenLabel()}`];
  return [t('addBtnTask'), t('plGoLater')];
}
const needsTime = () => P.appt && (P.wc !== 'pick' || (P.mode === 'at' && P.start == null && !(P.once && len() >= DAY)));

// ---------- (v84) editing: what's on the plan, and the list to choose from ----------
const wideNow = () => window.matchMedia?.('(min-width: 900px)').matches;
function planBox() {
  const ups = upcomingOf(P.edit);
  const x = get('tasks', P.edit);
  const row = (b) => `<div class="pl-turn"><span><b>${esc(relDay(b.date))} · ${esc(fmtTime(b.start))}–${esc(fmtTime(b.start + (b.minutes || 0)))}</b>${b.stepId ? `<small>${esc(b.title)}</small>` : ''}</span><button class="pl-chip" value="mv:${esc(b.id)}" formnovalidate>${esc(t('moveBtn'))}</button><button class="pl-chip" value="skip:${esc(b.id)}" formnovalidate>${esc(t(b.seriesId ? 'plSkip' : 'plUnplan'))}</button></div>`;
  return `<div class="pl-plan"><div class="pl-ph"><span>${esc(t('inPlan'))}</span>${ups.length ? `<span>${esc(t('plTurnsN', ups.length))}</span>` : ''}</div>
    ${ups.length ? ups.slice(0, 2).map(row).join('') : `<p class="pl-hint pl-pad">${esc(t('plNotPlanned'))}</p>`}
    ${ups.length > 2 || (x && isSeries(x)) ? `<div class="pl-pf">${ups.length > 2 ? `<button class="linkish" value="turns" formnovalidate>${esc(t('plAllTurns', ups.length))} ›</button>` : '<span></span>'}${x && isSeries(x) ? `<button class="linkish" value="plan-more" formnovalidate>+ ${esc(t('planOneMore'))}</button>` : ''}</div>` : ''}</div>`;
}
function turnsOverlay() {
  const ups = upcomingOf(P.edit);
  return `<div class="pl-ov"><div class="pl-ovc"><div class="pl-ovh"><b>${esc(t('plAllTurnsT'))}</b><button class="pl-x" value="ov-close" formnovalidate aria-label="${esc(t('close'))}">✕</button></div>
    <p class="pl-hint">${esc(t('plTurnsN', ups.length))}</p>
    ${ups.slice(0, 60).map((b) => `<div class="pl-turn"><span><b>${esc(relDay(b.date))} · ${esc(fmtTime(b.start))}–${esc(fmtTime(b.start + (b.minutes || 0)))}</b></span><button class="pl-chip" value="mv:${esc(b.id)}" formnovalidate>${esc(t('moveBtn'))}</button><button class="pl-chip" value="skip:${esc(b.id)}" formnovalidate>${esc(t(b.seriesId ? 'plSkip' : 'plUnplan'))}</button></div>`).join('')}
    <div class="pl-ovf"><button class="btn primary" value="ov-close" formnovalidate>${esc(t('plOvDone'))}</button></div></div></div>`;
}
// The whole list for «Prima serve…» and the rules: already added, a search, then (v85) in tabs: Recenti,
// one per category, Tutte A–Z. The search looks through all of them. For the place: Recenti, 🛒 Negozi,
// Con orari, Tutti, one choice.
const pickTitle = (k) => t(k === 'after' ? 'needsFirst' : k === 'place' ? 'plLuogo' : k === 'ok' ? 'plIfDone' : 'plIfFail');
const ctabs = (tabs, cls = '') => `<div class="pl-ctabs ${cls}${P.ovq ? ' dim' : ''}" role="tablist">${tabs.map(([k, l, n]) => `<button class="${P.ovt === k ? 'on' : ''}" value="ovt:${esc(k)}" formnovalidate role="tab" aria-selected="${P.ovt === k}">${esc(l)}${n != null ? `<small>${n}</small>` : ''}</button>`).join('')}</div>`;
const grp = (k, label, html, extra = '') => `<div class="pl-pgrp" data-tab="${esc(k)}" ${extra} ${P.ovt === k ? '' : 'hidden'}><div class="pl-lbl">${esc(label)}</div>${html}</div>`;
function placePickerHtml() {
  const all = allPlaces();
  const item = (p) => `<button class="pl-pick${P.placeId === p.id ? ' on' : ''}" value="plc:${esc(p.id)}" formnovalidate data-name="${esc(p.name.toLowerCase())}" data-hay="${esc(`${p.name} ${p.place || ''}`.toLowerCase())}"><span class="pl-ck" aria-hidden="true">${esc(placeEmoji(p))}</span><span>${esc(p.name)}<small>${esc([p.place, openText(p)].filter(Boolean).join(' · '))}</small></span></button>`;
  const lists = [['recent', t('plcRecent'), recentPlaces(6)], ['shop', `🛒 ${t('plcShopsTab')}`, all.filter((p) => p.shop)], ['hours', t('plcWithHours'), all.filter(hasHours)], ['all', t('plcAllTab'), [...all].sort((a, b) => a.name.localeCompare(b.name))]];
  return `<div class="pl-ov"><div class="pl-ovc"><div class="pl-ovh"><b>${esc(t('plLuogo'))}</b><button class="pl-x" value="ov-close" formnovalidate aria-label="${esc(t('close'))}">✕</button></div>
    <p class="pl-hint">${esc(t('plcPickHint'))}</p>
    <input id="pl-ovq" class="pl-in" placeholder="${esc(t('plcSearchPh'))}" autocomplete="off">
    <button class="pl-sopt new" id="pl-ovnew" value="ov-new:place:" formnovalidate hidden></button>
    <div class="pl-sugg" id="pl-ovmap"></div>
    ${ctabs(lists.map(([k, l, ps]) => [k, k === 'recent' ? t('plcRecentTab') : l, k === 'recent' ? null : ps.length]), 'four')}
    ${lists.map(([k, l, ps]) => grp(k, l, ps.length ? ps.map(item).join('') : `<p class="pl-hint">${esc(t('plcNone'))}</p>`, k === 'all' ? 'data-all="1"' : '')).join('')}
    <div class="pl-ovf"><button class="btn" value="ov-close" formnovalidate>${esc(t('close'))}</button></div></div></div>`;
}
function pickerHtml(key) {
  if (key === 'place') return placePickerHtml();
  const used = new Set(P[key].map((a) => a.id).filter(Boolean));
  const all = candidates().filter((x) => x.id !== P.edit);
  const recent = [...all].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 6);
  const groups = new Map();
  const catOf = (x) => (x.category && get('categories', x.category) && !get('categories', x.category).deleted ? x.category : '');
  for (const x of [...all].sort((a, b) => a.title.localeCompare(b.title))) { const c = catOf(x); if (!groups.has(c)) groups.set(c, []); groups.get(c).push(x); }
  const cname = (c) => (c ? catName(get('categories', c)) : t('noCategory'));
  const item = (x, showCat = false) => `<button class="pl-pick${used.has(x.id) ? ' on' : ''}" value="ov-tog:${key}:${esc(x.id)}" formnovalidate data-hay="${esc(x.title.toLowerCase())}"><span class="pl-ck" aria-hidden="true">${used.has(x.id) ? '✓' : ''}</span><span>${esc(x.title)}<small>${esc([fmtDur(ownMinutes(x)), showCat ? cname(catOf(x)) : ''].filter(Boolean).join(' · '))}</small></span></button>`;
  const cats = [...groups].sort(([a], [b]) => (!a ? 1 : !b ? -1 : cname(a).localeCompare(cname(b))));
  if (!['recent', 'all', ...cats.map(([c]) => c || 'none')].includes(P.ovt)) P.ovt = 'recent';
  const tabs = [['recent', t('plcRecentTab'), null], ...cats.map(([c, l]) => [c || 'none', cname(c), l.length]), ['all', t('plcAllAZ'), all.length]];
  return `<div class="pl-ov"><div class="pl-ovc"><div class="pl-ovh"><b>${esc(pickTitle(key))}</b><button class="pl-x" value="ov-close" formnovalidate aria-label="${esc(t('close'))}">✕</button></div>
    <p class="pl-hint">${esc(t(key === 'after' ? 'plAfterHint' : 'plRulesHint'))}</p>
    ${key !== 'after' ? `<div class="pl-seg"><button class="${key === 'ok' ? 'on' : ''}" value="ovk:ok" formnovalidate>${esc(t('plIfDone'))}</button><button class="${key === 'ko' ? 'on' : ''}" value="ovk:ko" formnovalidate>${esc(t('plIfFail'))}</button></div>` : ''}
    <div class="pl-lbl">${esc(t('plAdded', P[key].length))}</div>
    ${P[key].length ? `<div class="pl-chips">${P[key].map((a, i) => `<span class="pl-chip on">${a.isNew ? '✚ ' : ''}${esc(a.title)}<button class="pl-x" value="li-rm:${key}:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span>`).join('')}</div>` : `<p class="pl-hint">${esc(t('plNoneYet'))}</p>`}
    <input id="pl-ovq" class="pl-in" placeholder="${esc(t('plSearchPh'))}" autocomplete="off">
    <button class="pl-sopt new" id="pl-ovnew" value="ov-new:${key}:" formnovalidate hidden></button>
    ${ctabs(tabs)}
    ${grp('recent', t('plRecent'), recent.map((x) => item(x, true)).join('') || `<p class="pl-hint">${esc(t('plNoneYet'))}</p>`, 'data-recent="1"')}
    ${cats.map(([c, l]) => grp(c || 'none', cname(c), l.map((x) => item(x)).join(''))).join('')}
    ${grp('all', t('plcAllAZ'), [...all].sort((a, b) => a.title.localeCompare(b.title)).map((x) => item(x, true)).join(''), 'data-all="1"')}
    <div class="pl-ovf"><button class="btn primary" value="ov-close" formnovalidate>${esc(t('plDoneN', P[key].length))}</button></div></div></div>`;
}

let scrollKeep = null;
function keepScroll() { const f = document.querySelector('dialog[open] form'); const o = document.querySelector('dialog[open] .pl-ovc'); scrollKeep = f ? [f.scrollTop, o ? o.scrollTop : 0] : null; }
function restoreScroll() {
  const f = document.querySelector('dialog[open] form'); const o = document.querySelector('dialog[open] .pl-ovc');
  if (scrollKeep && f) { f.scrollTop = scrollKeep[0]; if (o) o.scrollTop = scrollKeep[1]; }
  const q = document.querySelector('#pl-ovq'); if (q && P.ovq) { q.value = P.ovq; q.dispatchEvent(new Event('input')); }
  scrollKeep = null;
}
function draw(focus = null) {
  if (document.querySelector('dialog[open] .plus-sheet, dialog[open].plus-sheet')) keepScroll();
  const lenOn = P.lenSet || P.unknown || P.touched.len;
  const whenOn = P.wc !== undefined || P.touched.when;
  const catOn = Boolean(P.cat) || P.touched.cat;
  const c = P.cat && get('categories', P.cat);
  const [g1, g2] = goLabel();
  const os = optSummary();
  const side = P.ov && P.ov !== 'turns' && wideNow();
  openModal(`<div class="pl-wrap${side ? ' side' : ''}"><div class="pl">
    <div class="pl-name"><input id="pl-name" value="${esc(P.name)}" placeholder="${esc(t('addTaskPh'))}" autocomplete="off" enterkeyhint="done" aria-label="${esc(t('title'))}"><button class="pl-star${P.save ? ' on' : ''}" value="save" formnovalidate aria-pressed="${P.save}" aria-label="${esc(t('plSave'))}" title="${esc(t('plSave'))}">${P.save ? '★' : '☆'}</button></div>
    ${P.save ? `<p class="pl-hint">${esc(t('plSaveHint'))}</p>` : ''}
    <button class="pl-tog${P.appt ? ' on' : ''}" value="appt" formnovalidate><span>📅 ${esc(t('plAppt'))}<small>${esc(t(P.appt ? 'plApptOn' : 'plApptOff'))}</small></span><i></i></button>
    <div class="pl-panel pl-when">${whenPanel()}</div>
    <div class="pl-panel pl-secs">${secRows()}</div>
    ${P.edit ? planBox() : ''}
    ${P.edit ? `<div class="pl-foot"><button class="btn primary" value="go" ${!P.name.trim() || needsTime() ? 'disabled' : ''}>${esc(t('save'))}</button><button class="btn" value="cancel" formnovalidate>${esc(t('close'))}</button>
      <details class="bk-more pl-dots"><summary class="btn" aria-label="${esc(t('options'))}">⋯</summary><div class="bk-menu"><button class="btn ghost" value="full" formnovalidate>▤ ${esc(t('plFull'))}</button><button class="btn ghost danger" value="del" formnovalidate>🗑 ${esc(t('delete'))}</button></div></details></div>
      ${needsTime() ? `<p class="pl-hint">${esc(t('plNeedTime'))}</p>` : ''}`
    : `<button class="btn primary big pl-go" value="go" ${!P.name.trim() || needsTime() ? 'disabled' : ''}><b>${esc(g1)}</b><small>${esc(!P.name.trim() ? t('plNeedName') : needsTime() ? t('plNeedTime') : g2)}</small></button>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('close'))}</button></div>`}</div>
    ${P.ov === 'turns' ? turnsOverlay() : P.ov ? pickerHtml(P.ov) : ''}</div>`, onSubmit, { cls: `sheet plus-sheet${P.edit ? ' plus-edit' : ''}` });
  wire();
  restoreScroll();
  const f = focus && document.querySelector(`dialog[open] ${focus}`);
  if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
}
function onSubmit(form, action, e) {
  collect(form);
  if (action === 'go') { e.preventDefault(); if (P.edit) saveEdit(); else save(); return; }
  e.preventDefault();
  const [a, b, c] = action.split(':');
  let focus = null;
  // (v90) the trip's route line
  const tr = tvAction(P.tv, action);
  if (tr) { P.tvOwn = true; if (typeof tr === 'string') { P.legOv = tr.slice(4); P.ov = 'place'; P.ovq = ''; P.ovt = 'recent'; } draw(tr === true ? null : '#pl-ovq'); return; }
  if (P.edit && editAction(a, b, c, action)) return;
  if (a === 'pop') { const was = P.pop; if (was) P.touched[was] = true; P.pop = was === b ? null : b; if (P.pop) P.more = false; if (b === 'when' && P.pop === 'when' && P.wc === undefined) P.wc = undefined; }
  else if (a === 'save') P.save = !P.save;
  else if (a === 'appt') { P.appt = !P.appt; if (P.appt) { if (P.wc !== 'pick') { P.wc = 'pick'; P.once = true; } P.mode = 'at'; } else if (P.mode === 'any') P.mode = 'first'; }
  else if (a === 'unknown') { P.unknown = !P.unknown; P.touched.len = true; linkTimes('len'); }
  else if (a === 'wc') { P.wc = b === 'later' ? 'later' : b; P.touched.when = true; P.addOpen = false; if (b === 'pick') { P.once = true; P.dates = []; P.date = P.date < today() ? today() : P.date; } }
  else if (a === 'add-open') P.addOpen = true;
  else if (a === 'add-day') { const ds = P.wc === 'pick' && P.once ? dts() : []; const last = ds[ds.length - 1]; setDates([...ds, last ? addDays(last, 1) : (P.date < today() ? today() : P.date)]); P.wc = 'pick'; P.once = true; P.addOpen = false; P.touched.when = true; if (!P.appt && P.mode === 'any') P.mode = 'first'; }
  else if (a === 'add-rh') { P.wc = 'pick'; P.once = false; P.dates = []; P.addOpen = false; P.touched.when = true; if (P.mode === 'any') P.mode = 'first'; if (!P.days.length) P.days = [isoDay(P.date)]; if (P.per === 'settimana' && P.days.length) P.n = P.days.length; }
  else if (a === 'drm') { const ds = dts(); ds.splice(Number(b), 1); if (ds.length) setDates(ds); else { P.wc = P.appt ? 'pick' : 'later'; P.dates = []; } }
  else if (a === 'once') { P.once = b === '1'; if (!P.once) { if (P.mode === 'any') P.mode = 'first'; if (!P.days.length) P.days = [isoDay(P.date)]; } }
  else if (a === 'mode') { P.mode = b === 'free' ? (P.appt && P.once ? 'any' : 'first') : b; if (b === 'at') focus = '#pl-s'; }
  else if (a === 'wd') { const d = Number(b); P.days = P.days.includes(d) ? P.days.filter((x) => x !== d) : [...P.days, d]; if (P.per === 'settimana' && P.days.length) P.n = P.days.length; }
  else if (a === 'until') P.until = b;
  else if (a === 'cat') { P.cat = b || null; P.touched.cat = true; P.open = null; }
  else if (a === 'more') { P.more = !P.more; if (P.more && (P.open === 'cat' || P.open === 'place')) P.open = null; } // (v92) a tab like the other three
  else if (a === 'row') { P.open = P.open === b ? null : b; if (P.open && b !== 'cat' && b !== 'place') P.more = true; if (P.open === 'cat' || P.open === 'place') P.more = false; }
  else if (a === 'ov') { P.ov = b; P.ovq = ''; P.ovt = 'recent'; focus = '#pl-ovq'; }
  else if (a === 'ovt') { P.ovt = b; P.ovq = ''; }
  else if (a === 'plc' && P.legOv) { if (placeById(b)) { P.tv[P.legOv] = b; P.tvOwn = true; } P.legOv = null; P.ov = null; P.ovq = ''; }
  else if (a === 'plc') { const p = placeById(b); if (p) { P.placeId = p.id; P.place = placeAddress(p); placeChosen(); } P.ov = null; P.ovq = ''; }
  else if (a === 'plc-geo') {
    const g = (P.geo || [])[Number(b)];
    if (g && P.legOv) { P.tv[P.legOv] = `addr:${g.address}`; P.tvOwn = true; P.legOv = null; } // (v94) a trip's end: any address, not only a saved place
    else if (g) { startNew(P.pq || '', true, { addr: g.address, lat: g.lat, lon: g.lon, name: parsePlaceText(P.pq || '').name || g.name || '' }); focus = '#pl-npname'; }
    P.ov = null; P.ovq = '';
  }
  else if (a === 'plc-once') { searchOnceNow(); return; }
  else if (a === 'plc-asis') { startNew(P.pq || ''); focus = '#pl-npname'; }
  else if (a === 'plc-np-back') { P.np = null; focus = '#pl-place'; }
  else if (a === 'plc-np-emo') P.np.emOpen = !P.np.emOpen;
  else if (a === 'plc-np-em') { P.np.em = action.slice('plc-np-em:'.length); P.np.emOpen = false; }
  else if (a === 'plc-np-shop') P.np.shop = !P.np.shop;
  else if (a === 'plc-np-ok') { if (!saveNew()) focus = '#pl-npname'; }
  else if (a === 'plc-np-once') { P.placeId = null; P.place = P.np.addr; P.np = null; P.pq = ''; }
  else if (a === 'plc-txt') { P.placeId = null; P.place = decodeURIComponent(action.slice('plc-txt:'.length)).trim(); }
  else if (a === 'plc-rm') { P.placeId = null; P.place = ''; P.pq = ''; focus = '#pl-place'; }
  else if (a === 'plc-save' || (a === 'ov-new' && b === 'place') || a === 'plc-new') {
    const v = a === 'plc-save' ? P.place : decodeURIComponent(action.slice(`${a}:${a === 'ov-new' ? 'place:' : ''}`.length)).trim();
    if (v && P.legOv && a !== 'plc-save') { const p = placeByText(v) || quickPlace(v, uid); P.tv[P.legOv] = p.id; P.tvOwn = true; P.legOv = null; }
    else if (v) { const p = placeByText(v); if (p) { P.placeId = p.id; P.place = placeAddress(p); placeChosen(); } else { if (a === 'plc-save') P.place = ''; startNew(v); focus = '#pl-npname'; } } // (v92) a new one asks for its name
    P.ov = null; P.ovq = '';
  }
  else if (a === 'ovk') { P.ov = b; P.ovq = ''; }
  else if (a === 'ov-close') { P.ov = null; P.ovq = ''; P.legOv = null; }
  else if (a === 'turns') P.ov = 'turns';
  else if (a === 'ov-tog') { const i = P[b].findIndex((x) => x.id === c); if (i >= 0) P[b].splice(i, 1); else { const x = get('tasks', c); if (x) P[b].push({ id: x.id, title: x.title }); } }
  else if (a === 'ov-new') { const n = decodeURIComponent(action.slice(`ov-new:${b}:`.length)).trim(); if (n) P[b].push({ title: n, isNew: true }); P.ovq = ''; focus = '#pl-ovq'; }
  else if (a === 'cl-rm') P.checklist.splice(Number(b), 1);
  else if (a === 'buf') P.buffer = b === '' ? '' : Number(b);
  else if (a === 'room') P.room = P.room ? null : { max: ROOM_DEFAULT };
  else if (a === 'room-max' && P.room) P.room = { max: b === '0' ? 0 : Math.min(720, Math.max(30, (P.room.max || ROOM_DEFAULT) + Number(b))) };
  else if (a === 'imp') P.imp = Number(b);
  else if (a === 'ppl') P.people = Number(b);
  else if (a === 'due') P.due = '';
  else if (a === 'step-rm') { if (P.stepObjs) { P.stepObjs.splice(Number(b), 1); if (P.stepObjs.length) P.len = stepSum(); } else P.steps.splice(Number(b), 1); }
  else if (a === 'li-rm') P[b].splice(Number(c), 1);
  else if (a === 'li-add') { const x = get('tasks', c); if (x) P[b].push({ id: x.id, title: x.title }); focus = `#pl-li-${b}`; }
  else if (a === 'li-new') { P[b].push({ title: decodeURIComponent(action.slice(`li-new:${b}:`.length)), isNew: true }); focus = `#pl-li-${b}`; }
  else if (a === 'anchor') P.anchor = b;
  draw(focus);
}
// Reads the fields typed in (they don't redraw the sheet while you type).
function collect(form) {
  const v = (id) => form.querySelector(`#${id}`);
  if (v('pl-name')) P.name = v('pl-name').value;
  if (v('pl-notes')) P.notes = v('pl-notes').value;
  if (v('pl-npname') && P.np) P.np.name = v('pl-npname').value;
  if (v('pl-place')) P.pq = v('pl-place').value;
  const tv0 = JSON.stringify(P.tv); tvRead(form, P.tv); if (JSON.stringify(P.tv) !== tv0) P.tvOwn = true;
  // (v85) the place is chosen from the suggestions (Enter: a saved place by that name, else the text as typed)
}
// (v86) A field's late "change" (it fires when you tap a button) redraws the sheet afterwards. That redraw
// must never reopen a sheet that was saved or closed meanwhile (it made a second routine), and must not swap
// the buttons while a finger is still on one (the tap got lost): it waits for the finger to lift.
let pressing = false; let pending;
function laterDraw(focus) {
  if (pressing) { pending = focus ?? null; return; }
  const p0 = P;
  setTimeout(() => { if (P === p0 && !P.closed && document.querySelector('dialog[open] .pl')) draw(focus); }, 0);
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (ev) => { if (ev.target?.closest?.('dialog[open] .pl button, dialog[open] .pl-ov button')) pressing = true; }, true);
  const lift = () => { if (!pressing) return; pressing = false; if (pending !== undefined) { const f = pending; pending = undefined; laterDraw(f); } };
  document.addEventListener('pointerup', lift, true);
  document.addEventListener('pointercancel', lift, true);
}
function wire() {
  const form = document.querySelector('dialog[open] form'); if (!form) return;
  const v = (id) => form.querySelector(`#${id}`);
  const redraw = (focus) => laterDraw(focus);
  v('pl-name')?.addEventListener('input', (ev) => { P.name = ev.target.value; const go = form.querySelector('.pl-go'); if (go) { const off = !P.name.trim() || needsTime(); go.disabled = off; const [g1, g2] = goLabel(); go.querySelector('b').textContent = g1; go.querySelector('small').textContent = !P.name.trim() ? t('plNeedName') : needsTime() ? t('plNeedTime') : g2; } });
  v('pl-name')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); if (P.name.trim() && !needsTime()) { if (P.edit) saveEdit(); else save(); } } });
  // the length: a number and a unit; "2h30", "3 giorni" move the unit
  const ln = v('pl-len'); const lu = v('pl-lenu');
  const applyLen = () => { const r = parseLen(ln.value, lu.value); if (!r) return; P.len = r.m; P.lenUnit = r.u; P.lenSet = true; P.unknown = false; P.touched.len = true; linkTimes('len'); redraw(); };
  ln?.addEventListener('input', () => { const m = ln.value.toLowerCase().match(/[a-z]/); if (m) { const r = parseLen(ln.value, lu.value); if (r) lu.value = r.u; } });
  ln?.addEventListener('change', applyLen);
  ln?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ln.blur(); } });
  lu?.addEventListener('change', () => { P.lenUnit = lu.value; if (ln.value.trim()) applyLen(); else redraw(); });
  v('pl-date')?.addEventListener('change', (ev) => { if (ev.target.value) { P.date = ev.target.value < today() ? today() : ev.target.value; redraw(); } });
  form.querySelectorAll('[data-di]').forEach((inp) => inp.addEventListener('change', () => { if (!inp.value) return; const ds = dts(); ds[Number(inp.dataset.di)] = inp.value < today() ? today() : inp.value; setDates(ds); redraw(); }));
  v('pl-due')?.addEventListener('change', (ev) => { P.due = ev.target.value || ''; redraw(); });
  const nn = v('pl-n'); const per = v('pl-per');
  nn?.addEventListener('input', () => { const r = parseFreq(nn.value); if (r.per) per.value = r.per; });
  nn?.addEventListener('change', () => { const r = parseFreq(nn.value); const was = P.per; if (r.n) P.n = Math.min(12, r.n); if (r.per) P.per = r.per; if (P.per === 'giorno' && was !== 'giorno') P.days = [...ALL7]; redraw(); });
  per?.addEventListener('change', () => { const was = P.per; P.per = per.value; if (P.per === 'giorno' && was !== 'giorno') P.days = [...ALL7]; redraw(); });
  const time = (id, fn) => v(id)?.addEventListener('change', (ev) => { const m = parseTime(ev.target.value); if (m != null) { fn(m); redraw(); } });
  time('pl-s', (m) => { P.start = m; linkTimes('start'); });
  time('pl-e', (m) => { P.end = m; linkTimes('end'); });
  for (let i = 0; i < 12; i++) {
    time(`pl-ts${i}`, (m) => { const x = P.times[i] = { ...(P.times[i] || {}) }; x.s = m; if (P.anchor === 'end' && x.e != null) setLenFrom(m, x.e); else x.e = (m + len()) % 1440; });
    time(`pl-te${i}`, (m) => { const x = P.times[i] = { ...(P.times[i] || {}) }; x.e = m; if (P.anchor === 'start' && x.s != null) setLenFrom(x.s, m); else x.s = ((m - len()) % 1440 + 1440) % 1440; });
  }
  // tapping the name of a time box makes it the one that stays put
  form.querySelectorAll('[data-anchor]').forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); P.anchor = el.dataset.anchor; redraw(); }));
  v('pl-step')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.value.trim()) { ev.preventDefault(); if (P.stepObjs) { P.stepObjs.push({ id: uid(), title: ev.target.value.trim(), minutes: 15 }); P.len = stepSum(); } else P.steps.push(ev.target.value.trim()); redraw('#pl-step'); } });
  form.querySelectorAll('[data-sm]').forEach((inp) => inp.addEventListener('change', () => { const y = P.stepObjs[Number(inp.dataset.sm)]; const m = parseInt(inp.value, 10); if (y && m > 0) { y.minutes = m; P.len = stepSum(); redraw(); } }));
  v('pl-cl')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.value.trim()) { ev.preventDefault(); P.checklist.push(ev.target.value.trim()); redraw('#pl-cl'); } });
  // (v84) the whole list: the search filters what's there; a name that isn't there can be made
  const oq = v('pl-ovq');
  if (oq) {
    const nb = v('pl-ovnew');
    oq.addEventListener('input', () => {
      const q = oq.value.trim().toLowerCase(); P.ovq = oq.value;
      let exact = false;
      // (v85) searching looks through every tab (the «Tutte» list); an empty search shows the open tab again
      form.querySelectorAll('.pl-pick').forEach((el) => { const hit = !q || el.dataset.hay.includes(q); el.hidden = !hit; if ((el.dataset.name ?? el.dataset.hay) === q) exact = true; });
      form.querySelectorAll('.pl-pgrp').forEach((g) => { g.hidden = q ? !g.dataset.all || ![...g.querySelectorAll('.pl-pick')].some((el) => !el.hidden) : g.dataset.tab !== P.ovt; });
      form.querySelector('.pl-ctabs')?.classList.toggle('dim', Boolean(q));
      nb.hidden = !q || exact || Boolean(P.legOv); nb.value = `ov-new:${P.ov}:${encodeURIComponent(oq.value.trim())}`;
      if (P.ov === 'place') { P.pq = oq.value; const mb = form.querySelector('#pl-ovmap'); if (mb) mb.innerHTML = mapGroup(); lookUp(form, '#pl-ovmap', mapGroup); } // (v94) the map here too
      nb.innerHTML = P.ov === 'place' ? `☆ ${esc(t('plcSaveNew', oq.value.trim()))}<small>${esc(t('plcSaveNewSub'))}</small>` : `✚ ${esc(t('plNew', oq.value.trim()))}<small>${esc(t('plNewSub'))}</small>`;
    });
    oq.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !oq.value.trim()) return;
      ev.preventDefault();
      const q = oq.value.trim();
      if (P.ov === 'place') { const known = placeByText(q); if (P.legOv) { const p = known || quickPlace(q, uid); P.tv[P.legOv] = p.id; P.tvOwn = true; P.legOv = null; } else if (known) { P.placeId = known.id; P.place = placeAddress(known); placeChosen(); } else startNew(q); P.ov = null; P.ovq = ''; redraw(P.np ? '#pl-npname' : undefined); return; }
      const hit = candidates().find((x) => x.title.toLowerCase() === q.toLowerCase());
      if (hit && !P[P.ov].some((a) => a.id === hit.id)) P[P.ov].push({ id: hit.id, title: hit.title }); else if (!hit) P[P.ov].push({ title: q, isNew: true });
      P.ovq = ''; redraw('#pl-ovq');
    });
  }
  const npn = v('pl-npname');
  if (npn && P.np) {
    npn.addEventListener('input', () => {
      P.np.name = npn.value; const ok = form.querySelector('button[value="plc-np-ok"]'); const nm = P.np.name.trim();
      if (ok) { ok.disabled = !nm; ok.textContent = `☆ ${nm ? t('npSaveN', nm) : t('npSave')}`; }
      const eb = form.querySelector('.np-em'); if (eb && !P.np.em && !P.np.shop) eb.textContent = guessEmoji(P.np.name);
    });
    npn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); form.querySelector('button[value="plc-np-ok"]:not([disabled])')?.click(); } });
  }
  const pin = v('pl-place');
  if (pin) {
    const box = v('pl-sg-place');
    pin.addEventListener('input', () => { P.pq = pin.value; box.innerHTML = placeSuggest(); lookUp(form); });
    if (P.pq && P.geoQ !== parsePlaceText(P.pq).addr) lookUp(form);
    pin.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !pin.value.trim()) return;
      ev.preventDefault();
      const p = placeByText(pin.value); if (p) { P.placeId = p.id; P.place = placeAddress(p); } else { P.placeId = null; P.place = pin.value.trim(); }
      redraw();
    });
  }
  form.querySelectorAll('[data-li]').forEach((inp) => {
    const key = inp.dataset.li; const box = v(`pl-sg-${key}`);
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase(); if (!q) { box.innerHTML = ''; return; }
      const used = new Set(P[key].map((a) => a.id).filter(Boolean));
      const hits = candidates().filter((x) => !used.has(x.id) && x.title.toLowerCase().includes(q)).slice(0, 4);
      const exact = hits.some((x) => x.title.toLowerCase() === q);
      box.innerHTML = hits.map((x) => `<button class="pl-sopt" value="li-add:${key}:${esc(x.id)}" formnovalidate>${esc(x.title)}<small>${esc(t('plHave'))}</small></button>`).join('')
        + (exact ? '' : `<button class="pl-sopt new" value="li-new:${key}:${encodeURIComponent(inp.value.trim())}" formnovalidate>✚ ${esc(t('plNew', inp.value.trim()))}<small>${esc(t('plNewSub'))}</small></button>`);
    });
    inp.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !inp.value.trim()) return;
      ev.preventDefault();
      const q = inp.value.trim(); const hit = candidates().find((x) => x.title.toLowerCase() === q.toLowerCase());
      P[key].push(hit ? { id: hit.id, title: hit.title } : { title: q, isNew: true }); redraw(`#pl-li-${key}`);
    });
  });
}

// ---------- saving ----------
function save() {
  const form = document.querySelector('dialog[open] form'); if (form) collect(form);
  const q = quickAdd(P.name);
  const title = (q.title || P.name).trim(); if (!title) return;
  // what was typed in the name counts where the pills weren't used ("Cena ogni giorno 20:30", "1h", "#casa")
  if (!P.lenSet && !P.unknown && q.minutes) { P.len = q.minutes; P.lenSet = true; }
  const cat = P.cat || q.category && categories().find((c) => c.id === q.category || catName(c).toLowerCase().replace(/\s+/g, '') === String(q.category).toLowerCase())?.id || null;
  if (P.wc === undefined && q.repeat) { P.wc = 'pick'; P.once = false; if (q.repeat === 'times') { P.per = ({ day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' })[q.timesPer] || 'settimana'; P.n = q.timesN || 1; } else { P.per = 'settimana'; P.days = q.repeatDays || []; P.n = P.days.length || 1; } if (q.time != null) { P.mode = 'at'; P.start = q.time; } }
  else if (P.wc === undefined && q.due && q.time != null) { P.wc = 'pick'; P.once = true; P.date = q.due; P.mode = 'at'; P.start = q.time; }
  const L = len(); const s = planSettings();
  // "@posta" in the name: a saved place by that name, else the text as typed
  const qp = !P.place && q.place ? placeByText(q.place) : null;
  const qPlace = P.place ? null : qp ? { id: qp.id, addr: placeAddress(qp) } : q.place ? { id: null, addr: q.place } : null;
  const newIds = (list) => list.map((a) => a.id || upsert('tasks', { id: uid(), createdAt: Date.now(), kind: 'todo', title: a.title, minutes: 30, lenSet: false, importance: 3, category: cat, moreCats: [], due: null, done: false, steps: [], checklist: [], notes: '' }, { silent: true }).id);
  const rules = [...P.ok.map((a) => ({ a, when: 'done' })), ...P.ko.map((a) => ({ a, when: 'failed' }))].map(({ a, when }) => ({ id: uid(), when, then: 'task', taskId: a.id || null, title: a.title, minutes: 30, place: 'pool', stepId: null }));
  let steps = P.steps.map((tt) => ({ id: uid(), title: tt, minutes: Math.max(5, Math.round(L / Math.max(1, P.steps.length))) }));
  // a task of days or weeks: parts of a day's work each, that the planner spreads out
  if (!P.appt && L >= DAY && !steps.length) {
    const day = (Number(s.maxLoad) || 8) * 60; const nDays = L >= 30 * DAY ? Math.round(L / (30 * DAY)) * 20 : L >= 7 * DAY ? Math.round(L / (7 * DAY)) * 5 : Math.round(L / DAY);
    const k = Math.min(30, Math.max(1, nDays));
    steps = Array.from({ length: k }, (_, i) => ({ id: uid(), title: t('plPart', i + 1, k), minutes: day }));
  }
  const x = {
    id: uid(), createdAt: Date.now(), kind: P.save || P.wc === 'pick' && !P.once ? 'saved' : 'todo', title, minutes: steps.length && !P.steps.length ? steps.reduce((n, y) => n + y.minutes, 0) : L,
    lenSet: P.lenSet || P.unknown ? !P.unknown : Boolean(P.touched.len), lenUnknown: P.unknown || undefined, importance: P.imp !== 3 ? P.imp : q.importance || 3, priority: q.priority || 0,
    category: cat, moreCats: [], due: P.due || (P.wc === undefined ? q.due : null) || null, place: P.place || qPlace?.addr || '', placeId: P.placeId || qPlace?.id || null, ...(catFlag(cat, 'meal') ? { people: P.people } : {}), notes: P.notes, done: false, checklist: [],
    steps, splitSteps: steps.length > 1 && !P.steps.length, after: newIds(P.after), allRules: rules, windows: [], checklist: [...P.checklist], room: P.room || null,
    ...((P.place || qPlace) && tvFor(P.placeId || qPlace?.id) ? { travel: tvFor(P.placeId || qPlace?.id) } : {}),
  };
  ui.justAdded ||= new Set();
  // an appointment: fixed, at its day and time (all day, or several days)
  if (P.appt) {
    const days = L >= DAY ? Math.max(1, Math.round(L / DAY)) : 0;
    const ds = dts(); const at = days || P.mode !== 'at' ? null : P.start;
    const rec = saveEvent({ ...x, kind: 'event', minutes: days ? 60 : L, planDate: ds[0], planTime: at, ...(days > 1 ? { days } : {}), ...(ds.length > 1 ? { dates: ds } : {}) });
    if (at != null) for (const d of ds.slice(1)) planTask(rec, d, Math.max(0, at - anchorOffset(null, rec))); // (v117) the other days
    finish(rec, null, t('plApptSaved', ds.length > 1 ? ds.map((d) => relDay(d)).join(', ') : relDay(P.date), days ? fmtLen(L) : at != null ? fmtTime(at) : t('allDay')));
    return;
  }
  if (P.wc === 'pick' && !P.once) {
    const r = rhythm(); Object.assign(x, r.fields);
    const rec = saveTask(x);
    let b = null;
    if (r.at != null) b = planTask(get('tasks', rec.id), r.first, Math.max(0, r.at - anchorOffset(null, rec)));
    finish(get('tasks', rec.id), b, t('plRoutineSaved', whenWords(true)));
    return;
  }
  if (P.wc === 'pick' && dts().length > 1) {
    // (v117) one thing on several days: a turn on each, at the time or in the first free gap that day
    const ds = dts(); const rec = saveTask({ ...x, dates: ds, datesAt: P.mode === 'at' ? P.start : null, due: P.due || null });
    let b = null;
    for (const d of ds) { const nb = planTask(get('tasks', rec.id), d, P.mode === 'at' && P.start != null ? Math.max(0, P.start - anchorOffset(null, rec)) : null); b ||= nb; }
    finish(get('tasks', rec.id), b, t('plDaysSaved', ds.length));
    return;
  }
  const rec = saveTask(x);
  let b = null;
  if (P.wc === 'first') b = planSoon(rec);
  else if (P.wc === 'pick') {
    if (P.mode === 'at' && P.start != null) b = planTask(rec, P.date, Math.max(0, P.start - anchorOffset(null, rec)));
    else if (P.mode === 'first') b = planTask(rec, P.date, null);
    else upsert('tasks', { ...get('tasks', rec.id), due: P.due && P.due < P.date ? P.due : P.date, onDay: P.date }, { silent: true }); // (v92) «in giornata»: to do that day
  }
  finish(get('tasks', rec.id), b, null, P.wc === 'first');
}
// The rhythm as the task's fields: weekly days, N times a period, several times a day, monthly, yearly.
function rhythm() {
  const td = today(); const fields = { whenMode: 'repeat' }; let at = null; let first = P.date;
  const fixed = P.mode === 'at' && P.start != null;
  const days = P.days.length ? [...P.days].sort((a, b) => a - b) : null;
  if (P.per === 'settimana' && days && days.length === P.n) Object.assign(fields, { repeat: 'weekly', repeatDays: days, every: 1, pickTime: !fixed });
  else if (P.per === 'settimana') Object.assign(fields, { repeat: 'times', timesN: P.n, timesPer: 'week', pickTime: true });
  else if (P.per === 'giorno') {
    const ds = days || [...ALL7];
    Object.assign(fields, { repeat: 'weekly', repeatDays: ds, every: 1 });
    if (P.n > 1) {
      // several times a day: the times given, the others spread over the day
      const s = planSettings(); const gap = Math.floor((s.dayEnd - s.dayStart) / P.n);
      const tms = Array.from({ length: P.n }, (_, i) => P.times[i]?.s ?? s.dayStart + gap * i + Math.round(gap / 4)).sort((a, b) => a - b);
      Object.assign(fields, { dayTimes: tms, pickTime: false }); at = tms[0];
    } else Object.assign(fields, { pickTime: !fixed });
  } else if (P.per === 'mese' || P.per === 'anno') {
    if (P.n === 1) Object.assign(fields, { repeat: 'monthly', every: P.per === 'anno' ? 12 : 1, pickTime: !fixed });
    else Object.assign(fields, { repeat: 'times', timesN: P.n, timesPer: P.per === 'mese' ? 'month' : 'year', pickTime: true });
  }
  if (fields.repeat !== 'times') {
    // the first turn from today on
    for (let i = 0; i < 400; i++) { const d = addDays(td >= P.date ? td : P.date, i); if (fields.repeat === 'monthly' || fields.repeatDays?.includes(isoDay(d))) { first = d; break; } }
    fields.due = first; fields.seriesFrom = first;
    if (fixed && !fields.dayTimes) at = P.start;
  } else fields.due = null;
  if (P.until === 'w4') fields.repeatUntil = addDays(first || td, 27);
  if (P.until === 'n10') fields.repeatCount = 10;
  return { fields, at: fields.repeat === 'times' ? null : at, first };
}
function finish(rec, block, msg = null, tried = false) {
  P.closed = true;
  (ui.justAdded ||= new Set()).add(rec.id);
  document.querySelector('dialog[open]')?.close();
  if (msg) { afterAdd(rec, block); toast(msg); return; }
  afterAdd(rec, block, { tried });
}

// ---------- (v84) the same sheet for a task you already have ----------
const PER_OF = { day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' };
const whenKey = () => JSON.stringify([P.appt, P.wc, P.once, P.date, P.dates, P.mode, P.start, P.end, P.n, P.per, [...P.days].sort(), P.until, P.times.map((x) => x?.s ?? null)]);
function fromTask(x) {
  const p = fresh(x.title || '');
  Object.assign(p, {
    edit: x.id, save: isSaved(x), appt: isEvent(x), len: ownMinutes(x), lenSet: x.lenSet !== false, unknown: Boolean(x.lenUnknown),
    cat: x.category || null, imp: x.importance || 3, people: x.people || 2, place: x.place || '', placeId: placeById(x.placeId) ? x.placeId : null, tv: tvState(travelOf(x)), tvOwn: Boolean(x.travel && ('from' in x.travel || !placeById(x.placeId)?.travel)), notes: x.notes || '',
    stepObjs: realSteps(x).map((y) => ({ ...y })), checklist: [...(x.checklist || [])], buffer: x.buffer == null ? '' : x.buffer, room: x.room && typeof x.room === 'object' ? { ...x.room } : null,
    after: (x.after || []).map((id) => get('tasks', id)).filter(Boolean).map((y) => ({ id: y.id, title: y.title })),
    touched: { len: true, when: true, cat: true }, more: false,
  });
  // rules: "if done / if it fails → a task" are edited here; the others (preparations, missed, groceries) are kept as they are
  for (const r of rulesForEditor(x)) {
    const tk = r.then === 'task' && r.taskId && get('tasks', r.taskId);
    if (tk && (r.when === 'done' || r.when === 'failed')) p[r.when === 'done' ? 'ok' : 'ko'].push({ id: tk.id, title: tk.title, rule: r });
    else p.keepRules.push(r);
  }
  // Quando, as it is now
  const nb = upcomingOf(x.id)[0];
  if (x.repeat) {
    Object.assign(p, { wc: 'pick', once: false, date: x.seriesFrom || x.due || today() });
    if (x.repeat === 'times') Object.assign(p, { per: PER_OF[x.timesPer] || 'settimana', n: x.timesN || 1, mode: 'first' });
    else if (x.repeat === 'monthly') Object.assign(p, { per: Number(x.every) === 12 ? 'anno' : 'mese', n: 1 });
    else {
      const days = [...(x.repeatDays || [])];
      if (x.repeat === 'daily' || x.repeat === 'weekdays') days.splice(0, days.length, ...(x.repeat === 'daily' ? ALL7 : [1, 2, 3, 4, 5]));
      if ((x.dayTimes || []).length > 1) Object.assign(p, { per: 'giorno', n: x.dayTimes.length, days, times: x.dayTimes.map((m) => ({ s: m, e: (m + p.len) % 1440 })) });
      else Object.assign(p, { per: days.length === 7 ? 'giorno' : 'settimana', n: days.length === 7 ? 1 : days.length || 1, days });
    }
    const at = isEvent(x) ? x.eventTime : x.pickTime ? null : x.seriesTime;
    if (at != null && !((x.dayTimes || []).length > 1)) Object.assign(p, { mode: 'at', start: at, end: (at + p.len) % 1440 }); else if (p.mode !== 'first') p.mode = 'first';
    p.until = x.repeatCount === 10 && !x.repeatUntil ? 'n10' : x.repeatCount || x.repeatUntil ? 'keep' : 'always';
    p.untilKeep = { repeatUntil: x.repeatUntil || null, repeatCount: x.repeatCount || null };
  } else if ((x.dates || []).length > 1) {
    // (v117) several days: the days still to come (the first kept if all are past)
    const fut = x.dates.filter((d) => d >= today()); const ds = fut.length ? fut : [x.dates[x.dates.length - 1]];
    const tm = isEvent(x) ? (x.allDay ? null : x.eventTime ?? null) : x.datesAt ?? null;
    Object.assign(p, { wc: 'pick', once: true, dates: ds.length > 1 ? ds : [], date: ds[0], mode: tm != null ? 'at' : isEvent(x) ? 'any' : 'first', start: tm });
    if (tm != null) p.end = (tm + p.len) % 1440;
    p.due = isEvent(x) ? '' : x.due || '';
  } else if (isEvent(x)) {
    Object.assign(p, { wc: 'pick', once: true, date: x.due || today(), mode: x.allDay || x.eventTime == null ? 'any' : 'at', start: x.allDay ? null : x.eventTime ?? null });
    if (p.start != null) p.end = (p.start + p.len) % 1440;
  } else if (nb) {
    const st = nb.start + anchorOffset(nb, x);
    Object.assign(p, { wc: 'pick', once: true, date: nb.date, mode: 'at', start: st, end: (st + p.len) % 1440 });
    p.due = x.due || '';
  } else if (x.onDay) { Object.assign(p, { wc: 'pick', once: true, date: x.onDay, mode: 'any' }); p.due = x.due && x.due !== x.onDay ? x.due : ''; }
  else { p.wc = 'later'; p.due = x.due || ''; }
  return p;
}
const REPEAT_OFF = { repeat: null, repeatDays: [], timesN: null, timesPer: null, dayTimes: null, slotTimes: null, seriesTime: null, every: 1, pickTime: null, repeatUntil: null, repeatCount: null, whenMode: 'once' };
// Sposta, Salta, the turns, the tasks around an appointment, the full editor, delete: true when handled
function editAction(a, b, c, action) {
  const id = P.edit;
  const reopen = () => openPlusEdit(get('tasks', id));
  if (a === 'mv') { const blk = get('blocks', b); const rec = saveEdit({ stay: true }); const bb = blk && get('blocks', blk.id); if (rec && bb && !bb.deleted) setTimeout(() => openWeekGrid(rec, { block: bb, onClose: reopen }), 0); else setTimeout(reopen, 0); return true; }
  if (a === 'skip') {
    const blk = get('blocks', b); if (!blk) return false;
    const tk = get('tasks', id); const occ = blk.occ || blk.date;
    if (blk.seriesId && tk) skipOcc(tk, occ);
    deleteBlock(blk); changed();
    toast(t('unplanned', relDay(blk.date)), 5000, [{ label: t('undo'), run: () => { upsert('blocks', { ...blk, deleted: false }, { silent: true }); const k = get('tasks', id); if (blk.seriesId && k) upsert('tasks', { ...k, skipped: (k.skipped || []).filter((d) => d !== occ) }, { silent: true }); changed(); } }]);
    draw(); return true;
  }
  if (a === 'plan-more') { const rec = saveEdit({ stay: true }); document.querySelector('dialog[open]')?.close(); ui.pick = rec?.id || id; ui.pickOcc = null; ui.pickBlock = null; location.hash = `#/plan/${today()}`; changed(); return true; }
  if (a === 'evt') { saveEdit({ stay: true }); setTimeout(() => openTask(get('tasks', b)), 0); return true; }
  if (a === 'evt-add') { const rec = saveEdit({ stay: true }); setTimeout(() => openEventTaskAdd(rec || get('tasks', id), { back: true }), 0); return true; }
  if (a === 'full') { document.querySelector('dialog[open]')?.close(); setTimeout(() => openTask(get('tasks', id), null, { full: true }), 0); return true; }
  if (a === 'del') {
    const x = get('tasks', id); if (!x || !confirm(t('confirmDeleteTask'))) return true;
    remove('tasks', x.id);
    const oneOffEvent = isEvent(x) && !x.repeat; // a one-off appointment goes entirely (past days too); a task keeps what was done
    for (const y of live('blocks').filter((z) => z.taskId === x.id && (oneOffEvent || (!z.done && z.date >= today())))) deleteBlock(y);
    document.querySelector('dialog[open]')?.close(); changed(); return true;
  }
  void c; void action;
  return false;
}
// Saves the changes; the plan moves only if Quando changed.
function saveEdit({ stay = false } = {}) {
  const form = document.querySelector('dialog[open] form'); if (form) collect(form);
  const x0 = get('tasks', P.edit); if (!x0) return null;
  const title = P.name.trim(); if (!title) return null;
  const td = today(); const L = P.stepObjs?.length ? stepSum() : len();
  const routine = P.wc === 'pick' && !P.once;
  const newIds = (list) => list.map((a) => a.id || upsert('tasks', { id: uid(), createdAt: Date.now(), kind: 'todo', title: a.title, minutes: 30, lenSet: false, importance: 3, category: P.cat, moreCats: [], due: null, done: false, steps: [], checklist: [], notes: '' }, { silent: true }).id);
  const rule = (a, when) => (a.rule ? { ...a.rule, when } : { id: uid(), when, then: 'task', taskId: a.id || null, title: a.title, minutes: 30, place: 'pool', stepId: null });
  const x = {
    ...x0, title, minutes: L, lenSet: !P.unknown, lenUnknown: P.unknown || undefined, category: P.cat, importance: P.imp,
    place: P.place, placeId: P.placeId || null, ...(catFlag(P.cat, 'meal') ? { people: P.people } : {}), travel: P.place ? tvFor() && { ...tvFor(), mode: travelOf(x0).mode } : x0.travel ?? null, notes: P.notes, checklist: P.checklist, buffer: P.buffer === '' ? null : Number(P.buffer), room: P.room || null,
    steps: (P.stepObjs || []).filter((y) => y.title), after: newIds(P.after),
    allRules: [...P.keepRules, ...P.ok.map((a) => rule(a, 'done')), ...P.ko.map((a) => rule(a, 'failed'))],
    kind: P.appt ? 'event' : P.save || routine ? 'saved' : isEvent(x0) || isSaved(x0) ? 'todo' : x0.kind,
  };
  const anyDay = P.wc === 'pick' && P.once && P.mode === 'any' && !P.appt;
  if (!routine && !P.appt) x.due = P.due || (anyDay ? P.date : null);
  const changedWhen = whenKey() !== P.orig;
  if (changedWhen && !anyDay) x.onDay = null;
  const was = isSeries(x0) || Boolean(x0.repeat);
  const openSeries = (tid) => seriesBlocks(tid).filter((y) => !outcomeOf(y) && y.date >= td);
  let rec;
  if (!changedWhen) {
    rec = saveTask(x);
    if (Number(L) !== Number(ownMinutes(x0))) for (const y of upcomingOf(rec.id)) if (Number(y.minutes) === Number(ownMinutes(x0))) upsert('blocks', { ...y, minutes: get('tasks', rec.id).minutes }, { silent: true });
  } else if (routine) {
    const r = rhythm();
    Object.assign(x, REPEAT_OFF, r.fields);
    if (P.until === 'keep') Object.assign(x, P.untilKeep);
    if (r.fields.repeat !== 'times' && !r.fields.dayTimes && P.mode === 'at' && P.start != null) Object.assign(x, { seriesTime: P.start, pickTime: false });
    if (P.appt) Object.assign(x, { eventTime: P.mode === 'at' ? P.start : null, allDay: P.mode !== 'at' });
    for (const y of openSeries(x0.id).filter((z) => z.auto !== false)) deleteBlock(y);
    rec = saveTask(x);
    if (isSeries(get('tasks', rec.id))) ensureSeries(get('tasks', rec.id));
  } else {
    if (was) { for (const y of openSeries(x0.id)) deleteBlock(y); Object.assign(x, REPEAT_OFF); }
    // (v117) one or several days
    const ds = P.wc === 'pick' && P.once ? dts() : [];
    const hadDates = (x0.dates || []).length > 1;
    x.dates = ds.length > 1 ? ds : null; x.datesAt = ds.length > 1 && P.mode === 'at' ? P.start : null;
    if (ds.length > 1 || hadDates) for (const y of upcomingOf(x0.id).filter((z) => !outcomeOf(z))) deleteBlock(y);
    if (ds.length > 1) {
      if (P.appt) Object.assign(x, { due: ds[0], allDay: P.mode !== 'at' || P.start == null, eventTime: P.mode === 'at' ? P.start : null });
      rec = saveTask(x); const f1 = get('tasks', rec.id);
      if (!(P.appt && f1.allDay)) for (const d of ds) planTask(f1, d, P.mode === 'at' && P.start != null ? Math.max(0, P.start - anchorOffset(null, f1)) : null);
    } else {
    if (P.appt) Object.assign(x, { due: P.date, allDay: P.mode !== 'at' || P.start == null, eventTime: P.mode === 'at' ? P.start : null });
    rec = saveTask(x);
    const fresh1 = get('tasks', rec.id);
    const cur = upcomingOf(rec.id)[0];
    const place = (date, at) => {
      const off = anchorOffset(cur || null, fresh1);
      if (cur) upsert('blocks', { ...cur, date, start: at != null ? Math.max(0, at - off) : cur.start, minutes: fresh1.minutes, title: fresh1.title, auto: false }, { silent: true });
      else planTask(fresh1, date, at != null ? Math.max(0, at - off) : null);
    };
    if (P.appt) { if (fresh1.allDay) { if (cur) deleteBlock(cur); } else place(P.date, P.start); }
    else if (P.wc === 'first') { if (cur) deleteBlock(cur); planSoon(fresh1); }
    else if (P.wc === 'pick' && P.mode === 'at' && P.start != null) place(P.date, P.start);
    else if (P.wc === 'pick' && P.mode === 'first') { if (cur) deleteBlock(cur); planTask(fresh1, P.date, null); }
    else if (P.wc === 'pick') { if (cur) deleteBlock(cur); upsert('tasks', { ...fresh1, due: P.due && P.due < P.date ? P.due : P.date, onDay: P.date }, { silent: true }); }
    else if (cur && !was) deleteBlock(cur); // Da decidere: off the plan
    }
  }
  changed();
  if (stay) { P.orig = whenKey(); return get('tasks', rec.id); }
  P.closed = true;
  document.querySelector('dialog[open]')?.close();
  toast(t('savedTitle', title));
  return get('tasks', rec.id);
}
export function openPlusEdit(task) {
  P = fromTask(task);
  P.orig = whenKey();
  draw();
}

export function openPlus({ text = '', cat = null, save = false, appt = false, date = null, today: forToday = false } = {}) {
  P = fresh(text || '');
  if (cat) P.cat = cat;
  if (save) P.save = true;
  if (date) P.date = date;
  if (forToday) Object.assign(P, { wc: 'pick', once: true, mode: 'first', touched: { ...P.touched, when: true } }); // (v94) «＋ Per oggi…»: Quando = today
  if (appt) Object.assign(P, { appt: true, wc: 'pick', once: true, mode: 'at', pop: 'when' }); // (v83) an appointment: the + with the toggle on
  draw('#pl-name');
}
// for tests
export const plusState = () => P;
void addDays; void fmtDur;
