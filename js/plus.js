// plus.js (v82): the + sheet. The name (☆ keeps it among the Salvate), «È un appuntamento», then three
// pills that open below: ⏱ Durata (a number and a unit, or «non so»), 🕒 Quando (Primo libero · Scelgo
// io · Da decidere; Scelgo io holds the day or the rhythm, the time with Inizio and Fine linked to the
// length, several times a day) and ● Categoria. A pill opened and closed again keeps its default as a
// choice. Then Altre opzioni (importance, deadline, place, steps, «prima serve», rules, notes) open in
// place, and one button that says what it will do.
import { catName, categories, esc, planSettings, relDay, toast, ui } from './core.js';
import { t } from './i18n.js';
import { isSaved, isTodo } from './kinds.js';
import { anchorOffset, planTask, saveEvent } from './model.js';
import { addDays, fmtDur, fmtTime, isoDay, parseDate, parseTime, quickAdd, today } from './plan.js';
import { planSoon, suggestSlot } from './planning.js';
import { get, live, uid, upsert } from './store.js';
import { afterAdd, saveTask } from './editors.js';
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
function lenPanel() {
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
  <input id="pl-li-${key}" class="pl-in" data-li="${key}" placeholder="${esc(ph)}" autocomplete="off"><div class="pl-sugg" id="pl-sg-${key}"></div>`;
function optRows() {
  const row = (k, label, val, body) => `<div class="pl-orow${P.open === k ? ' open' : ''}"><button class="pl-ohead" value="row:${k}" formnovalidate><span>${esc(label)}</span><span class="pl-oval">${esc(val || '—')} ${P.open === k ? '▾' : '›'}</span></button>${P.open === k ? `<div class="pl-obody">${body}</div>` : ''}</div>`;
  const nm = (l) => l.map((a) => a.title).join(', ');
  return [
    row('imp', t('importance'), '★'.repeat(P.imp), `<div class="pl-stars">${[1, 2, 3, 4, 5].map((i) => `<button class="${i <= P.imp ? 'on' : ''}" value="imp:${i}" formnovalidate aria-label="${i}">★</button>`).join('')}</div><p class="pl-hint">${esc(t(`imp_${P.imp}`))}</p>`),
    row('due', t('due'), P.due ? relDay(P.due) : '', `<div class="pl-row"><label class="pl-date">📅 ${dateBox(`<input id="pl-due" type="date" value="${esc(P.due)}">`, P.due)}</label>${P.due ? `<button class="pl-chip" value="due:" formnovalidate>${esc(t('none'))}</button>` : ''}</div>`),
    row('place', t('plPlace'), P.place, `<input id="pl-place" class="pl-in" value="${esc(P.place)}" placeholder="${esc(t('placePh'))}" autocomplete="off"><button class="pl-tog${P.travel ? ' on' : ''}" value="travel" formnovalidate><span>${esc(t('plTravel'))}<small>${esc(t('plTravelSub'))}</small></span><i></i></button>`),
    row('steps', t('steps'), P.steps.length ? String(P.steps.length) : '', `${P.steps.map((s, i) => `<div class="pl-srow"><span>${i + 1}. ${esc(s)}</span><button class="pl-x" value="step-rm:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>`).join('')}<input id="pl-step" class="pl-in" placeholder="${esc(t('plStepPh'))}" autocomplete="off">`),
    row('after', t('needsFirst'), nm(P.after), `${listEd('after', t('plSearchPh'))}<p class="pl-hint">${esc(t('plAfterHint'))}</p>`),
    row('rules', t('plRules'), [P.ok.length && t('plOkN', P.ok.length), P.ko.length && t('plKoN', P.ko.length)].filter(Boolean).join(' · '), `<div class="pl-lbl">${esc(t('plIfDone'))}</div>${listEd('ok', t('plSearchPh'))}<div class="pl-lbl">${esc(t('plIfFail'))}</div>${listEd('ko', t('plSearchPh'))}<p class="pl-hint">${esc(t('plRulesHint'))}</p>`),
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

function draw(focus = null) {
  const lenOn = P.lenSet || P.unknown || P.touched.len;
  const whenOn = P.wc !== undefined || P.touched.when;
  const catOn = Boolean(P.cat) || P.touched.cat;
  const c = P.cat && get('categories', P.cat);
  const [g1, g2] = goLabel();
  const os = optSummary();
  openModal(`<div class="pl">
    <div class="pl-name"><input id="pl-name" value="${esc(P.name)}" placeholder="${esc(t('addTaskPh'))}" autocomplete="off" enterkeyhint="done" aria-label="${esc(t('title'))}"><button class="pl-star${P.save ? ' on' : ''}" value="save" formnovalidate aria-pressed="${P.save}" aria-label="${esc(t('plSave'))}" title="${esc(t('plSave'))}">${P.save ? '★' : '☆'}</button></div>
    ${P.save ? `<p class="pl-hint">${esc(t('plSaveHint'))}</p>` : ''}
    <button class="pl-tog${P.appt ? ' on' : ''}" value="appt" formnovalidate><span>📅 ${esc(t('plAppt'))}<small>${esc(t(P.appt ? 'plApptOn' : 'plApptOff'))}</small></span><i></i></button>
    <div class="pl-pills">${pill('len', `⏱ ${esc(lenOn ? lenLabel() : t('duration'))}`, lenOn)}${pill('when', `🕒 ${esc(whenOn ? whenWords() : t('whenChip').replace('…', ''))}`, whenOn)}${pill('cat', c ? `<i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>${esc(catName(c))}` : `● ${esc(catOn ? t('noCategory') : t('category'))}`, catOn)}</div>
    ${P.pop ? `<div class="pl-panel">${P.pop === 'len' ? lenPanel() : P.pop === 'when' ? whenPanel() : catPanel()}</div>` : ''}
    <div class="pl-more"><button class="pl-ohead top" value="more" formnovalidate><span>${esc(t('plMoreOpts'))}${os && !P.more ? `<small>${esc(os)}</small>` : ''}</span><span class="pl-oval">${P.more ? '▾' : '›'}</span></button>${P.more ? optRows() : ''}</div>
    <button class="btn primary big pl-go" value="go" ${!P.name.trim() || needsTime() ? 'disabled' : ''}><b>${esc(g1)}</b><small>${esc(!P.name.trim() ? t('plNeedName') : needsTime() ? t('plNeedTime') : g2)}</small></button>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('close'))}</button></div></div>`, onSubmit, { cls: 'sheet plus-sheet' });
  wire();
  const f = focus && document.querySelector(`dialog[open] ${focus}`);
  if (f) { f.focus(); if (f.setSelectionRange && f.value) f.setSelectionRange(f.value.length, f.value.length); }
}
function onSubmit(form, action, e) {
  collect(form);
  if (action === 'go') { e.preventDefault(); save(); return; }
  e.preventDefault();
  const [a, b, c] = action.split(':');
  let focus = null;
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
  else if (a === 'row') P.open = P.open === b ? null : b;
  else if (a === 'imp') P.imp = Number(b);
  else if (a === 'due') P.due = '';
  else if (a === 'travel') P.travel = !P.travel;
  else if (a === 'step-rm') P.steps.splice(Number(b), 1);
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
  v('pl-name')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); if (P.name.trim() && !needsTime()) save(); } });
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
  v('pl-step')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.value.trim()) { ev.preventDefault(); P.steps.push(ev.target.value.trim()); redraw('#pl-step'); } });
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
