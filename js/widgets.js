// widgets.js: moved from app.js (v36). See app.js for how the modules fit together.
import { esc, fmtDay, modal, relDay, ui } from './core.js';
import { getLang, t } from './i18n.js';
import { addDays, fmtDur, fmtTime, parseDate, parseTime, today } from './plan.js';
import { state } from './store.js';

export const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
export const grip = (id, label) => `<button type="button" class="drag-handle" id="${esc(id)}" aria-label="${esc(t('dragToMove', label))}">${GRIP}</button>`;
// A search field: magnifier in front, ✕ to clear once something is typed (shown by CSS, no redraw needed).
export const SEARCH_ICO = '<svg class="search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
export function searchBox({ id = '', cls = '', value = '', ph = t('searchTasks') } = {}) {
  return `<div class="search-box"${cls ? ` data-for="${cls}"` : ''}>${SEARCH_ICO}<input type="search" ${id ? `id="${id}"` : ''} class="${cls}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" enterkeyhint="search" aria-label="${esc(ph)}"><button type="button" class="search-clear" aria-label="${esc(t('clearSearch'))}" title="${esc(t('clearSearch'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button></div>`;
}

// ---------- dialogs ----------

export function openModal(html, onSubmit, { cls = '' } = {}) {
  modal.className = cls;
  // Replacing the dialog blurs the field you were in, which fires a late "change": ignore it (the
  // value was already read), so a dialog never redraws itself in the middle of being redrawn.
  ui.modalSwap = true;
  try { modal.innerHTML = `<form method="dialog" class="form">${html}</form>`; } finally { ui.modalSwap = false; }
  const form = modal.querySelector('form');
  form.addEventListener('submit', (e) => {
    const v = e.submitter?.value;
    if (v === 'cancel') return;
    onSubmit(form, v || 'ok', e);
  });
  if (!modal.open) modal.showModal();
}
// ✕ in a search field (and Esc while typing in one): empty it and search again, keeping the focus there.
export function clearSearch(input) {
  if (!input || !input.value) return false;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  (document.getElementById(input.id) || input).focus();
  return true;
}

export const durOptions = (sel, list = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240]) => {
  const opts = [...list];
  if (sel && !opts.includes(sel)) opts.push(sel);
  return opts.sort((a, b) => a - b).map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtDur(m)}</option>`).join('');
};

// Times are typed as 24-hour hh:mm whatever the phone's language (the browser's own time picker
// would show AM/PM on an English phone). "1900", "930" and "9" work too.
// (v99) The app's own date field (datepick.js does the typing and the calendar): the ISO value in a hidden input that
// keeps the name and id the forms read, the date as dd/mm/yyyy (dd.mm.yyyy in German) in a text box, the weekday and
// how far it is, and one 📅. No browser date field: its icon doubled ours and its calendar wouldn't open from the numbers.
export const dateText = (v) => (v ? fmtDay(v, { weekday: 'short', day: 'numeric', month: 'short', ...(v.slice(0, 4) !== today().slice(0, 4) ? { year: 'numeric' } : {}) }) : '—');
export const isoOk = (v) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false; const d = parseDate(v); return !Number.isNaN(d.getTime()) && d.getDate() === Number(v.slice(8)) && d.getMonth() + 1 === Number(v.slice(5, 7)); };
export const dpText = (v) => (isoOk(v) ? [v.slice(8), v.slice(5, 7), v.slice(0, 4)].join(getLang() === 'de' ? '.' : '/') : '');
export function dpRel(v) {
  if (!isoOk(v)) return '';
  const n = Math.round((parseDate(v) - parseDate(today())) / 864e5);
  const when = n === 0 ? t('today') : n === 1 ? t('tomorrow') : n === -1 ? t('yesterday') : n > 0 ? t('dp_inDays', n) : t('dp_daysAgo', -n);
  return `${fmtDay(v, { weekday: 'short' })} · ${when}`;
}
export const dateBox = (input, v) => {
  const req = /\srequired\b/.test(input);
  const label = (input.match(/aria-label="([^"]*)"/) || [])[1];
  const hidden = input.replace(/type="date"/, 'type="hidden" data-dpv').replace(/\srequired\b/, '');
  return `<span class="date-field${v ? '' : ' empty'}" data-dp>${hidden}<input class="dp-in" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="24" value="${esc(dpText(v))}" placeholder="${esc(t('dp_ph'))}"${label ? ` aria-label="${label}"` : ''}${req ? ' data-req' : ''}><span class="dp-rel" aria-hidden="true">${esc(dpRel(v))}</span><span class="dp-ic" aria-hidden="true">📅</span></span>`;
};
// a hidden date set from code: the text in step
export function syncDateText(input) {
  const f = input.closest?.('.date-field'); const inp = f?.querySelector('.dp-in'); if (!inp || document.activeElement === inp) return;
  inp.value = dpText(input.value); f.classList.toggle('empty', !input.value); const r = f.querySelector('.dp-rel'); if (r) r.textContent = dpRel(input.value);
}
export const TIME24 = 'type="text" inputmode="numeric" class="time24" maxlength="8" placeholder="hh:mm" autocomplete="off" pattern="(([01]?[0-9]|2[0-3])[:.]?[0-5][0-9]|[0-9]{1,2})( ?[aApP]\\.?[mM]?\\.?)?"'; // (v82) "3:30 pm" too
export function tidyTime(el) {
  const v = el.value.trim();
  if (!v) return;
  const m = parseTime(v);
  if (m != null) el.value = fmtTime(m);
}

export const lines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

// A length: a number and a unit. Minutes and hours; with "longer units" (Settings → Planner) also
// days, weeks, months and years (calendar time: 1 d = 24 h), for big tasks made of many steps.
export const UNITS = { min: 1, h: 60, d: 1440, wk: 10080, mo: 43200, y: 525600 };
export function durField(name, minutes, { required = false, placeholder = '', label = t('duration') } = {}) {
  const m = Number(minutes) || 0;
  const long = state.settings.longUnits || m >= 1440;
  const units = long ? Object.keys(UNITS) : ['min', 'h'];
  const unit = [...units].reverse().find((u) => (u === 'h' ? m >= 60 && m % 30 === 0 : u !== 'min' && m >= UNITS[u] && m % (UNITS[u] / 2) === 0)) || 'min';
  const val = m ? +(m / UNITS[unit]).toFixed(2) : '';
  return `<span class="dur-field"><input name="${esc(name)}" type="number" inputmode="decimal" min="0" step="any" value="${val}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}" aria-label="${esc(label)}"><select name="${esc(name)}_u" aria-label="${esc(t('unit'))}">${units.map((u) => `<option value="${u}" ${u === unit ? 'selected' : ''}>${esc(t(`u_${u}`))}</option>`).join('')}</select></span>`;
}
// Minutes from a length field, or `fallback` when it's empty.
export function readDur(form, name, fallback = null) {
  const el = form.elements.namedItem(name);
  if (!el) return fallback;
  const n = parseFloat(String(el.value).replace(',', '.'));
  if (!(n > 0)) return fallback;
  return Math.max(1, Math.round(n * (UNITS[form.elements.namedItem(`${name}_u`)?.value] || 1)));
}

// Time windows: when something can happen at all (office hours, opening times). [{days: [1-7], from, to}]
export function dayShort(d) { return fmtDay(addDays('2026-11-02', d - 1), { weekday: 'short' }); } // 2026-11-02 is a Monday
export function windowsText(wins) {
  return (wins || []).map((w) => `${w.date ? fmtDay(w.date, { weekday: 'short', day: 'numeric', month: 'short' }) : (w.days || []).length === 7 ? t('everyDay') : (w.days || []).map(dayShort).join(' ')} ${fmtTime(w.from)}–${fmtTime(w.to)}`).join(', ');
}
export function windowsEditor(prefix, wins) {
  return `<div class="wins">${(wins || []).map((w, k) => `<div class="win-row">
      <div class="days mini${w.date ? ' off' : ''}">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="${prefix}d${k}" value="${d}" ${(w.days || []).includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>
      <label class="win-date">${esc(t('orOnDate'))}${dateBox(`<input type="date" name="${prefix}x${k}" value="${esc(w.date || '')}">`, w.date || '')}</label>
      <span class="win-times"><input name="${prefix}f${k}" ${TIME24} value="${w.from != null ? fmtTime(w.from) : ''}" aria-label="${esc(t('from'))}"> – <input name="${prefix}t${k}" ${TIME24} value="${w.to != null ? fmtTime(w.to) : ''}" aria-label="${esc(t('to'))}">
      <button class="icon" value="${prefix}rm:${k}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span></div>`).join('')}
    <button class="btn small ghost" value="${prefix}add" formnovalidate>+ ${esc(t('addWindow'))}</button></div>`;
}
// Rows as typed (kept while editing); `clean` drops the unfinished ones.
export function readWindows(form, prefix, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      days: [...form.querySelectorAll(`input[name="${prefix}d${k}"]:checked`)].map((el) => Number(el.value)),
      date: form.elements.namedItem(`${prefix}x${k}`)?.value || null,
      from: parseTime(form.elements.namedItem(`${prefix}f${k}`)?.value), to: parseTime(form.elements.namedItem(`${prefix}t${k}`)?.value),
    });
  }
  return out;
}
export const cleanWindows = (wins) => (wins || []).filter((w) => (w.date || w.days?.length) && w.from != null && w.to != null && w.to > w.from)
  .map((w) => (w.date ? { date: w.date, from: w.from, to: w.to } : { days: w.days, from: w.from, to: w.to }));

// Where a task happens: a place, and a link (a map, a booking…). Without a link, the place opens in Maps.
export function placeLink(x, { short = false } = {}) {
  if (!x?.place && !x?.link) return '';
  const href = x.link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.place)}`;
  const text = x.place || (short ? t('link') : x.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40));
  return `<a class="place-link" href="${esc(href)}" target="_blank" rel="noopener">📍 ${esc(text)}</a>`;
}

// The weekday of a task's date (planned, else due, else today), Monday = 1.
// "Every 2 weeks on Mon, Wed", "Every day", "Weekdays until 20 Dec".
export function repeatText(x) {
  if (!x.repeat || x.repeat === 'times') return '';
  const n = Math.max(1, Number(x.every) || 1);
  let s = x.repeat === 'weekdays' ? t('rep_weekdays') : n === 1 ? t(`rep_${x.repeat}`) : t('everyN', n, t(`unit_${x.repeat}`, n));
  const dk = [...(x.repeatDays || [])].sort().join();
  // (v81) the seven days are "every day", Mon–Fri "weekdays", Sat–Sun "weekend"
  if (x.repeat === 'weekly' && n === 1 && ['1,2,3,4,5,6,7', '1,2,3,4,5', '6,7'].includes(dk)) s = t(dk === '6,7' ? 'qwWe' : dk === '1,2,3,4,5' ? 'rep_weekdays' : 'rep_daily');
  else if (x.repeat === 'weekly' && (x.repeatDays || []).length) s += ` ${t('onDays', [...x.repeatDays].sort().map(dayShort).join(', '))}`;
  if (x.repeatUntil) s += ` ${t('untilDay', relDay(x.repeatUntil))}`;
  return s;
}
export function plannedIso(x) { const d = x.planDate || x.due || today(); return ((parseDate(d).getDay() + 6) % 7) + 1; }
