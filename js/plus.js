// plus.js (v82): the + sheet. The name (☆ keeps it among the Salvate), «È un appuntamento», then three
// pills that open below: ⏱ Durata (a number and a unit, or «non so»), 🕒 Quando (Primo libero · Scelgo
// io · Da decidere; Scelgo io holds the day or the rhythm, the time with Inizio and Fine linked to the
// length, several times a day) and ● Categoria. A pill opened and closed again keeps its default as a
// choice. Then Altre opzioni (importance, deadline, place, steps, «prima serve», rules, notes) open in
// place, and one button that says what it will do.
import { catName, categories, esc, planSettings, relDay, toast, ui } from './core.js';
import { state } from './store.js';
import { t } from './i18n.js';
import { isEvent, isSaved, isTodo } from './kinds.js';
import { anchorOffset, deleteBlock, ensureSeries, eventTasksOf, isSeries, outcomeOf, planTask, saveEvent, seriesBlocks } from './model.js';
import { upcomingOf } from './finder.js';
import { ownMinutes, realSteps, travelOf } from './travel-plan.js';
import { skipOcc } from './weekpick.js';
import { openWeekGrid } from './weekgrid.js';
import { changed } from './shell.js';
import { addDays, fmtDur, fmtTime, isoDay, parseDate, parseTime, quickAdd, today } from './plan.js';
import { planSoon, suggestSlot } from './planning.js';
import { get, live, remove, uid, upsert } from './store.js';
import { afterAdd, openEventTaskAdd, openTask, rulesForEditor, saveTask } from './editors.js';
import { dateBox, dayShort, openModal, TIME24 } from './widgets.js';

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
    wc: undefined, once: true, date: today(), mode: 'first', start: null, end: null, anchor: 'start',
    n: 1, per: 'settimana', days: [], until: 'always', times: [],
    cat: null, more: false, open: null, imp: 3, due: '', place: '', travel: true, steps: [], after: [], ok: [], ko: [], notes: '',
    // (v84) editing a task: its id, the Quando it had (to know if it changed), its steps, checklist, margin, other rules
    edit: null, orig: null, stepObjs: null, checklist: [], buffer: '', keepRules: [], ov: null, rk: 'ok', untilKeep: null,
  };
}
let P = fresh();

const len = () => (P.unknown ? 60 : P.len);
const lenLabel = () => (P.unknown ? t('lenUnknownL') : fmtLen(P.len));
const span = (a) => `${fmtTime(a)}–${fmtTime(a + len())}`;
// the Quando choice in a few words
function whenWords(long = false) {
  if (P.wc === 'first') { const s = suggestSlot({ title: P.name, minutes: Math.min(len(), DAY) }); return s ? t('plFirstAt', relDay(s.date), fmtTime(s.start)) : t('plFirst'); }
  if (P.wc !== 'pick') return t('plLater');
  if (P.once) {
    const tm = P.mode === 'at' && P.start != null ? (long ? span(P.start) : fmtTime(P.start)) : P.mode === 'any' ? t('plAnyShort') : t('plFirst');
    return `${relDay(P.date)} · ${tm}`;
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
function setLenFrom(a, b) { let d = b - a; if (d <= 0) d += 1440; P.len = d; P.lenUnit = null; P.lenSet = true; P.unknown = false; P.touched.len = true; }

// ---------- the pieces ----------
const pill = (k, label, on) => `<button class="pl-pill${on ? ' on' : ''}${P.pop === k ? ' open' : ''}" value="pop:${k}" formnovalidate aria-expanded="${P.pop === k}">${label}<span aria-hidden="true">${P.pop === k ? '▴' : '▾'}</span></button>`;
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
function whenPanel() {
  const opts = [['first', `✦ ${t('plFirst')}`], ['pick', `📅 ${t('plPick')}`], ['later', t('plLater')]];
  const cur = P.wc === undefined ? 'later' : P.wc;
  let body = '';
  if (P.wc === 'pick') {
    const multi = !P.once && P.per === 'giorno' && P.n > 1;
    const dayIn = `<label class="pl-date">📅 ${dateBox(`<input id="pl-date" type="date" value="${esc(P.date)}" min="${today()}">`, P.date)}</label>`;
    body = `<div class="pl-seg">${[[1, 'wm_once'], [0, 'plMore']].map(([v, k]) => `<button class="${Number(P.once) === v ? 'on' : ''}" value="once:${v}" formnovalidate>${esc(t(k))}</button>`).join('')}</div>`;
    if (P.once) body += `<div class="pl-lbl">${esc(t('whichDay'))}</div>${dayIn}`;
    else {
      body += `<div class="pl-lbl">${esc(t('plHowOften'))}</div><div class="pl-row"><input id="pl-n" class="pl-num" value="${P.n}" inputmode="text" aria-label="${esc(t('plHowOften'))}"><span class="pl-mid">${esc(t(P.n === 1 ? 'plTime1' : 'plTimesW'))}</span>
        <select id="pl-per" class="pl-sel">${PER.map((k) => `<option value="${k}" ${P.per === k ? 'selected' : ''}>${esc(t(`per2_${k}`))}</option>`).join('')}</select></div>
        <p class="pl-hint">${esc(t('plFreqHint'))}</p>`;
      if (P.per === 'settimana' || P.per === 'giorno') {
        body += `<div class="pl-lbl">${esc(t(P.per === 'giorno' ? 'plWhichDays' : 'qwDays'))}</div><div class="pl-days">${ALL7.map((d) => `<button class="${P.days.includes(d) ? 'on' : ''}" value="wd:${d}" formnovalidate>${esc(dayShort(d).slice(0, 1).toUpperCase())}</button>`).join('')}</div>`;
        if (P.per === 'settimana') body += `<p class="pl-hint">${esc(P.days.length === P.n ? t('plDaysExact') : P.days.length ? t('plDaysFewer', P.n) : t('plDaysNone', P.n))}</p>`;
      } else body += `<div class="pl-lbl">${esc(t('plFrom'))}</div>${dayIn}<p class="pl-hint">${esc(t(P.per === 'mese' ? 'plMonthly' : 'plYearly', parseDate(P.date).getDate()))}</p>`;
      body += `<div class="pl-lbl">${esc(t('plUntil'))}</div><div class="pl-chips">${['always', 'w4', 'n10'].map((k) => `<button class="pl-chip${P.until === k ? ' on' : ''}" value="until:${k}" formnovalidate>${esc(t(`plU_${k}`))}</button>`).join('')}</div>`;
    }
    body += `<div class="pl-lbl">${esc(multi ? t('plTimesDay', P.n) : t('qwAt'))}</div>`;
    if (multi) {
      body += Array.from({ length: P.n }, (_, i) => { const x = P.times[i] || {}; return `<div class="pl-se"><span class="pl-k">${i + 1}ª</span>${timeBox('start', t('start'), x.s ?? null, `pl-ts${i}`, true)}<span class="pl-arrow">→</span>${timeBox('end', t('tpEnd'), x.e ?? null, `pl-te${i}`, true)}</div>`; }).join('');
      body += `<p class="pl-hint">${esc(t('plAnchorHint', P.anchor === 'start'))} ${esc(t('plEmptyTimes'))}</p>`;
    } else {
      const modes = P.once ? [['at', 'plAt'], ['first', 'plFirst'], ['any', 'plAny']] : [['at', 'plAlways'], ['first', 'plIPick']];
      body += `<div class="pl-seg">${modes.map(([k, l]) => `<button class="${P.mode === k ? 'on' : ''}" value="mode:${k}" formnovalidate>${esc(t(l))}</button>`).join('')}</div>`;
      if (P.mode === 'at') body += `<div class="pl-se">${timeBox('start', t('start'), P.start, 'pl-s')}<span class="pl-arrow">→</span>${timeBox('end', t('tpEnd'), P.end, 'pl-e')}</div><p class="pl-hint">${esc(P.start != null || P.end != null ? t('plAnchorHint', P.anchor === 'start') : t('plTimeHint'))}</p>`;
    }
    body = `<div class="pl-inner">${body}</div>`;
  } else body = `<p class="pl-hint">${esc(P.wc === 'first' ? t('plFirstHint', whenWords()) : t('plLaterHint'))}</p>`;
  return `<div class="pl-seg">${opts.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" value="wc:${k}" formnovalidate ${k === 'first' && P.appt ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>${body}`;
}
function catPanel() {
  return `<div class="pl-chips">${categories().map((c) => `<button class="pl-chip${P.cat === c.id ? ' on' : ''}" value="cat:${esc(c.id)}" formnovalidate><i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>${esc(catName(c))}</button>`).join('')}<button class="pl-chip${!P.cat ? ' on' : ''}" value="cat:" formnovalidate>${esc(t('noCategory'))}</button></div>`;
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
    row('due', t('due'), P.due ? relDay(P.due) : '', `<div class="pl-row"><label class="pl-date">📅 ${dateBox(`<input id="pl-due" type="date" value="${esc(P.due)}">`, P.due)}</label>${P.due ? `<button class="pl-chip" value="due:" formnovalidate>${esc(t('none'))}</button>` : ''}</div>`),
    row('place', t('plPlace'), P.place, `<input id="pl-place" class="pl-in" value="${esc(P.place)}" placeholder="${esc(t('placePh'))}" autocomplete="off"><button class="pl-tog${P.travel ? ' on' : ''}" value="travel" formnovalidate><span>${esc(t('plTravel'))}<small>${esc(t('plTravelSub'))}</small></span><i></i></button>`),
    P.stepObjs ? row('steps', t('steps'), P.stepObjs.length ? `${P.stepObjs.length} · ${fmtDur(stepSum())}` : '', `${P.stepObjs.map((y, i) => `<div class="pl-srow"><span>${i + 1}. ${esc(y.title)}</span><input id="pl-sm${i}" class="pl-num sm" data-sm="${i}" inputmode="numeric" value="${Number(y.minutes) || 10}" aria-label="${esc(t('duration'))}"><span class="pl-mid">min</span><button class="pl-x" value="step-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-step" class="pl-in" placeholder="${esc(t('plStepPh'))}" autocomplete="off">${P.stepObjs.length ? `<p class="pl-hint">${esc(t('plStepsLen'))}</p>` : ''}`)
    : row('steps', t('steps'), P.steps.length ? String(P.steps.length) : '', `${P.steps.map((s, i) => `<div class="pl-srow"><span>${i + 1}. ${esc(s)}</span><button class="pl-x" value="step-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-step" class="pl-in" placeholder="${esc(t('plStepPh'))}" autocomplete="off">`),
    row('after', t('needsFirst'), nm(P.after), `${listEd('after', t('plSearchPh'))}<p class="pl-hint">${esc(t('plAfterHint'))}</p>`),
    row('rules', t('plRules'), [P.ok.length && t('plOkN', P.ok.length), P.ko.length && t('plKoN', P.ko.length)].filter(Boolean).join(' · '), `<div class="pl-lbl">${esc(t('plIfDone'))}</div>${listEd('ok', t('plSearchPh'))}<div class="pl-lbl">${esc(t('plIfFail'))}</div>${listEd('ko', t('plSearchPh'))}<p class="pl-hint">${esc(t('plRulesHint'))}</p>`),
    P.edit ? row('check', t('checklist'), P.checklist.length ? String(P.checklist.length) : '', `${P.checklist.map((c, i) => `<div class="pl-srow"><span>☐ ${esc(c)}</span><button class="pl-x" value="cl-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-cl" class="pl-in" placeholder="${esc(t('plCheckPh'))}" autocomplete="off">`) : '',
    P.edit ? row('buffer', t('bufferAfter'), P.buffer === '' ? t('bufferDefault', Number(state.settings.taskBuffer) || 0) : Number(P.buffer) ? fmtDur(Number(P.buffer)) : t('none'), `<div class="pl-chips">${['', 0, 5, 10, 15, 30, 60].map((m) => `<button class="pl-chip${String(P.buffer) === String(m) ? ' on' : ''}" value="buf:${m}" formnovalidate>${esc(m === '' ? t('bufferDefault', Number(state.settings.taskBuffer) || 0) : m ? fmtDur(m) : t('none'))}</button>`).join('')}</div>`) : '',
    P.edit && P.appt ? row('evt', t('secEventTasks'), eventTasksOf(P.edit).length ? String(eventTasksOf(P.edit).length) : '', `${eventTasksOf(P.edit).map((y) => `<button class="pl-sopt" value="evt:${esc(y.id)}" formnovalidate>${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc(y.due ? relDay(y.due) : '')}</small></button>`).join('')}<button class="pl-chip" value="evt-add" formnovalidate>+ ${esc(t('addEventTask'))}</button>`) : '',
    row('notes', t('notes'), P.notes ? '✎' : '', `<textarea id="pl-notes" class="pl-in" rows="3">${esc(P.notes)}</textarea>`),
  ].join('');
}
const optSummary = () => [P.imp !== 3 && '★'.repeat(P.imp), P.due && t('dueOn', relDay(P.due)), P.place && `📍 ${P.place}`, P.steps.length && t('plStepsN', P.steps.length), P.after.length && `🔒 ${P.after.length}`, (P.ok.length + P.ko.length) && t('plRulesN', P.ok.length + P.ko.length), P.notes && '✎'].filter(Boolean).join(' · ');
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
const needsTime = () => P.appt && !(P.wc === 'pick' && P.once && (P.start != null || len() >= DAY));

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
// The whole list for «Prima serve…» and the rules: already added, a search, recently used, then by category.
const pickTitle = (k) => t(k === 'after' ? 'needsFirst' : k === 'ok' ? 'plIfDone' : 'plIfFail');
function pickerHtml(key) {
  const used = new Set(P[key].map((a) => a.id).filter(Boolean));
  const all = candidates().filter((x) => x.id !== P.edit);
  const recent = [...all].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)).slice(0, 5);
  const groups = new Map();
  for (const x of [...all].sort((a, b) => a.title.localeCompare(b.title))) { const c = x.category || ''; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(x); }
  const item = (x) => `<button class="pl-pick${used.has(x.id) ? ' on' : ''}" value="ov-tog:${key}:${esc(x.id)}" formnovalidate data-hay="${esc(x.title.toLowerCase())}"><span class="pl-ck" aria-hidden="true">${used.has(x.id) ? '✓' : ''}</span><span>${esc(x.title)}<small>${esc(fmtDur(ownMinutes(x)))}</small></span></button>`;
  return `<div class="pl-ov"><div class="pl-ovc"><div class="pl-ovh"><b>${esc(pickTitle(key))}</b><button class="pl-x" value="ov-close" formnovalidate aria-label="${esc(t('close'))}">✕</button></div>
    <p class="pl-hint">${esc(t(key === 'after' ? 'plAfterHint' : 'plRulesHint'))}</p>
    ${key !== 'after' ? `<div class="pl-seg"><button class="${key === 'ok' ? 'on' : ''}" value="ovk:ok" formnovalidate>${esc(t('plIfDone'))}</button><button class="${key === 'ko' ? 'on' : ''}" value="ovk:ko" formnovalidate>${esc(t('plIfFail'))}</button></div>` : ''}
    <div class="pl-lbl">${esc(t('plAdded', P[key].length))}</div>
    ${P[key].length ? `<div class="pl-chips">${P[key].map((a, i) => `<span class="pl-chip on">${a.isNew ? '✚ ' : ''}${esc(a.title)}<button class="pl-x" value="li-rm:${key}:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span>`).join('')}</div>` : `<p class="pl-hint">${esc(t('plNoneYet'))}</p>`}
    <input id="pl-ovq" class="pl-in" placeholder="${esc(t('plSearchPh'))}" autocomplete="off">
    <button class="pl-sopt new" id="pl-ovnew" value="ov-new:${key}:" formnovalidate hidden></button>
    <div class="pl-pgrp" data-recent="1"><div class="pl-lbl">${esc(t('plRecent'))}</div>${recent.map(item).join('')}</div>
    ${[...groups].map(([c, l]) => `<div class="pl-pgrp"><div class="pl-lbl">${esc(c ? catName(get('categories', c)) : t('noCategory'))}</div>${l.map(item).join('')}</div>`).join('')}
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
    <div class="pl-pills">${pill('len', `⏱ ${esc(lenOn ? lenLabel() : t('duration'))}`, lenOn)}${pill('when', `🕒 ${esc(whenOn ? whenWords() : t('whenChip').replace('…', ''))}`, whenOn)}${pill('cat', c ? `<i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>${esc(catName(c))}` : `● ${esc(catOn ? t('noCategory') : t('category'))}`, catOn)}</div>
    ${P.pop ? `<div class="pl-panel">${P.pop === 'len' ? lenPanel() : P.pop === 'when' ? whenPanel() : catPanel()}</div>` : ''}
    ${P.edit ? planBox() : ''}
    <div class="pl-more"><button class="pl-ohead top" value="more" formnovalidate><span>${esc(t('plMoreOpts'))}${os && !P.more ? `<small>${esc(os)}</small>` : ''}</span><span class="pl-oval">${P.more ? '▾' : '›'}</span></button>${P.more ? optRows() : ''}</div>
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
  if (P.edit && editAction(a, b, c, action)) return;
  if (a === 'pop') { const was = P.pop; if (was) P.touched[was] = true; P.pop = was === b ? null : b; if (b === 'when' && P.pop === 'when' && P.wc === undefined) P.wc = undefined; }
  else if (a === 'save') P.save = !P.save;
  else if (a === 'appt') { P.appt = !P.appt; if (P.appt) { if (P.wc !== 'pick') P.wc = 'pick'; P.once = true; P.mode = 'at'; P.pop = 'when'; } }
  else if (a === 'unknown') { P.unknown = !P.unknown; P.touched.len = true; linkTimes('len'); }
  else if (a === 'wc') { P.wc = b === 'later' ? 'later' : b; P.touched.when = true; if (b === 'pick' && !P.once && !P.days.length) P.days = [isoDay(P.date)]; }
  else if (a === 'once') { P.once = b === '1'; if (!P.once) { if (P.mode === 'any') P.mode = 'first'; if (!P.days.length) P.days = [isoDay(P.date)]; } }
  else if (a === 'mode') { P.mode = b; if (b === 'at') focus = '#pl-s'; }
  else if (a === 'wd') { const d = Number(b); P.days = P.days.includes(d) ? P.days.filter((x) => x !== d) : [...P.days, d]; if (P.per === 'settimana' && P.days.length) P.n = P.days.length; }
  else if (a === 'until') P.until = b;
  else if (a === 'cat') { P.cat = b || null; P.touched.cat = true; P.pop = null; }
  else if (a === 'more') P.more = !P.more;
  else if (a === 'row') { P.open = P.open === b ? null : b; if (P.open) { P.more = true; P.pop = null; } }
  else if (a === 'ov') { P.ov = b; P.ovq = ''; focus = '#pl-ovq'; }
  else if (a === 'ovk') { P.ov = b; P.ovq = ''; }
  else if (a === 'ov-close') { P.ov = null; P.ovq = ''; }
  else if (a === 'turns') P.ov = 'turns';
  else if (a === 'ov-tog') { const i = P[b].findIndex((x) => x.id === c); if (i >= 0) P[b].splice(i, 1); else { const x = get('tasks', c); if (x) P[b].push({ id: x.id, title: x.title }); } }
  else if (a === 'ov-new') { const n = decodeURIComponent(action.slice(`ov-new:${b}:`.length)).trim(); if (n) P[b].push({ title: n, isNew: true }); P.ovq = ''; focus = '#pl-ovq'; }
  else if (a === 'cl-rm') P.checklist.splice(Number(b), 1);
  else if (a === 'buf') P.buffer = b === '' ? '' : Number(b);
  else if (a === 'imp') P.imp = Number(b);
  else if (a === 'due') P.due = '';
  else if (a === 'travel') P.travel = !P.travel;
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
  if (v('pl-place')) P.place = v('pl-place').value.trim();
}
function wire() {
  const form = document.querySelector('dialog[open] form'); if (!form) return;
  const v = (id) => form.querySelector(`#${id}`);
  const redraw = (focus) => setTimeout(() => draw(focus), 0);
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
      form.querySelectorAll('.pl-pick').forEach((el) => { const hit = !q || el.dataset.hay.includes(q); el.hidden = !hit; if (el.dataset.hay === q) exact = true; });
      form.querySelectorAll('.pl-pgrp').forEach((g) => { g.hidden = (q && g.dataset.recent) || ![...g.querySelectorAll('.pl-pick')].some((el) => !el.hidden); });
      nb.hidden = !q || exact; nb.value = `ov-new:${P.ov}:${encodeURIComponent(oq.value.trim())}`; nb.innerHTML = `✚ ${esc(t('plNew', oq.value.trim()))}<small>${esc(t('plNewSub'))}</small>`;
    });
    oq.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || !oq.value.trim()) return;
      ev.preventDefault();
      const q = oq.value.trim(); const hit = candidates().find((x) => x.title.toLowerCase() === q.toLowerCase());
      if (hit && !P[P.ov].some((a) => a.id === hit.id)) P[P.ov].push({ id: hit.id, title: hit.title }); else if (!hit) P[P.ov].push({ title: q, isNew: true });
      P.ovq = ''; redraw('#pl-ovq');
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
    category: cat, moreCats: [], due: P.due || (P.wc === undefined ? q.due : null) || null, place: P.place || q.place || '', notes: P.notes, done: false, checklist: [],
    steps, splitSteps: steps.length > 1 && !P.steps.length, after: newIds(P.after), allRules: rules, windows: [],
    ...(P.place ? { travel: { there: P.travel, back: P.travel, mode: 'default' } } : {}),
  };
  ui.justAdded ||= new Set();
  // an appointment: fixed, at its day and time (all day, or several days)
  if (P.appt) {
    const days = L >= DAY ? Math.max(1, Math.round(L / DAY)) : 0;
    const rec = saveEvent({ ...x, kind: 'event', minutes: days ? 60 : L, planDate: P.date, planTime: days ? null : P.start, ...(days > 1 ? { days } : {}) });
    finish(rec, null, t('plApptSaved', relDay(P.date), days ? fmtLen(L) : fmtTime(P.start)));
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
  const rec = saveTask(x);
  let b = null;
  if (P.wc === 'first') b = planSoon(rec);
  else if (P.wc === 'pick') {
    if (P.mode === 'at' && P.start != null) b = planTask(rec, P.date, Math.max(0, P.start - anchorOffset(null, rec)));
    else if (P.mode === 'first') b = planTask(rec, P.date, null);
    else upsert('tasks', { ...get('tasks', rec.id), due: P.due && P.due < P.date ? P.due : P.date }, { silent: true });
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
  (ui.justAdded ||= new Set()).add(rec.id);
  document.querySelector('dialog[open]')?.close();
  if (msg) { afterAdd(rec, block); toast(msg); return; }
  afterAdd(rec, block, { tried });
}

// ---------- (v84) the same sheet for a task you already have ----------
const PER_OF = { day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' };
const whenKey = () => JSON.stringify([P.appt, P.wc, P.once, P.date, P.mode, P.start, P.end, P.n, P.per, [...P.days].sort(), P.until, P.times.map((x) => x?.s ?? null)]);
function fromTask(x) {
  const p = fresh(x.title || '');
  Object.assign(p, {
    edit: x.id, save: isSaved(x), appt: isEvent(x), len: ownMinutes(x), lenSet: x.lenSet !== false, unknown: Boolean(x.lenUnknown),
    cat: x.category || null, imp: x.importance || 3, place: x.place || '', travel: travelOf(x).there !== false, notes: x.notes || '',
    stepObjs: realSteps(x).map((y) => ({ ...y })), checklist: [...(x.checklist || [])], buffer: x.buffer == null ? '' : x.buffer,
    after: (x.after || []).map((id) => get('tasks', id)).filter(Boolean).map((y) => ({ id: y.id, title: y.title })),
    touched: { len: true, when: true, cat: true }, more: true,
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
  } else if (isEvent(x)) {
    Object.assign(p, { wc: 'pick', once: true, date: x.due || today(), mode: x.allDay || x.eventTime == null ? 'any' : 'at', start: x.allDay ? null : x.eventTime ?? null });
    if (p.start != null) p.end = (p.start + p.len) % 1440;
  } else if (nb) {
    const st = nb.start + anchorOffset(nb, x);
    Object.assign(p, { wc: 'pick', once: true, date: nb.date, mode: 'at', start: st, end: (st + p.len) % 1440 });
    p.due = x.due || '';
  } else { p.wc = 'later'; p.due = x.due || ''; }
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
    place: P.place, travel: { ...travelOf(x0), there: P.travel, back: P.travel }, notes: P.notes, checklist: P.checklist, buffer: P.buffer === '' ? null : Number(P.buffer),
    steps: (P.stepObjs || []).filter((y) => y.title), after: newIds(P.after),
    allRules: [...P.keepRules, ...P.ok.map((a) => rule(a, 'done')), ...P.ko.map((a) => rule(a, 'failed'))],
    kind: P.appt ? 'event' : P.save || routine ? 'saved' : isEvent(x0) || isSaved(x0) ? 'todo' : x0.kind,
  };
  if (!routine && !P.appt) x.due = P.due || null;
  const changedWhen = whenKey() !== P.orig;
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
    else if (P.wc === 'pick') { if (cur) deleteBlock(cur); upsert('tasks', { ...fresh1, due: P.due && P.due < P.date ? P.due : P.date }, { silent: true }); }
    else if (cur && !was) deleteBlock(cur); // Da decidere: off the plan
  }
  changed();
  if (stay) { P.orig = whenKey(); return get('tasks', rec.id); }
  document.querySelector('dialog[open]')?.close();
  toast(t('savedTitle', title));
  return get('tasks', rec.id);
}
export function openPlusEdit(task) {
  P = fromTask(task);
  P.orig = whenKey();
  draw();
}

export function openPlus({ text = '', cat = null, save = false, appt = false, date = null } = {}) {
  P = fresh(text || '');
  if (cat) P.cat = cat;
  if (save) P.save = true;
  if (date) P.date = date;
  if (appt) Object.assign(P, { appt: true, wc: 'pick', once: true, mode: 'at', pop: 'when' }); // (v83) an appointment: the + with the toggle on
  draw('#pl-name');
}
// for tests
export const plusState = () => P;
void addDays; void fmtDur;
