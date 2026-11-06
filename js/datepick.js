// datepick.js (v99): the app's own calendar and date field.
// The browser's date field draws its own icon (two icons with ours) and won't open its calendar from a tap on the
// numbers, above all inside an embedded page; so dates are typed and picked here.
// · The field (widgets.js dateBox): one box, one 📅. A tap anywhere in it opens the calendar with the day already
//   selected: type at once («14» → the month → the year; ↑/↓ change the part selected, ←/→ or «/» move, Enter
//   confirms, Esc closes). A letter switches to free text: «sab», «14 dic», «domani».
//   The ISO value lives in the hidden input next to it (same name, same id): forms and listeners read it as before;
//   it sends «input» while you type a whole date and «change» when you confirm or leave.
// · The calendar: the days with a line under the busy ones (yellow: a full day), a row per week, or the months of a
//   year with their load. The Planner's title opens it too (day, week or month, as the view).
import { esc, fmtDay, planSettings } from './core.js';
import { getLang, t } from './i18n.js';
import { addDays, dateStr, fmtDur, parseDate, today } from './plan.js';
import { loadOf } from './planning.js';
import { live } from './store.js';
import { dpRel, dpText, isoOk } from './widgets.js';

const sep = () => (getLang() === 'de' ? '.' : '/');
const mondayOf = (d) => addDays(d, -((parseDate(d).getDay() + 6) % 7));
const firstOf = (d) => `${d.slice(0, 7)}-01`;
const shiftMonth = (d, k) => { const x = parseDate(firstOf(d)); return dateStr(new Date(x.getFullYear(), x.getMonth() + k, 1)); };
const loadCache = new Map();
function dayLoad(d) {
  if (!loadCache.has(d)) { let m = 0; try { m = loadOf(d).now; } catch { m = 0; } loadCache.set(d, m); }
  return loadCache.get(d);
}
const limit = () => planSettings().maxLoad || 480;
const mark = (d) => { const m = dayLoad(d); return m >= limit() ? '<i class="f"></i>' : m ? '<i></i>' : ''; };

// ---------- the calendars ----------
function weekdays() { const mon = mondayOf(today()); return Array.from({ length:7 }, (_, i) => fmtDay(addDays(mon, i), { weekday:'narrow' })); }
function weeksOf(view) { const out = []; let w = mondayOf(firstOf(view)); for (let i = 0; i < 6; i++) { out.push(w); w = addDays(w, 7); } return out; }
function head(label, a = '') { return `<div class="dp-h"><button type="button" class="dp-nav" data-dpnav="-1" aria-label="${esc(t('previous'))}">‹</button><b>${esc(label)}</b><button type="button" class="dp-nav" data-dpnav="1" aria-label="${esc(t('next'))}">›</button>${a}</div>`; }
function dayCal(P) {
  const td = today(); const mo = P.view.slice(0, 7);
  return `${head(fmtDay(P.view, { month:'long', year:'numeric' }))}<div class="dp-g"><span class="dp-wd"></span>${weekdays().map((w) => `<span class="dp-wd">${esc(w)}</span>`).join('')}${weeksOf(P.view).map((w) => `<span class="dp-wn">${isoWeekOf(w)}</span>${Array.from({ length:7 }, (_, i) => { const d = addDays(w, i); const off = P.min && d < P.min;
    return `<button type="button" class="dp-d${d.slice(0, 7) !== mo ? ' o' : ''}${d === td ? ' t' : ''}${d === P.sel ? ' s' : ''}" ${off ? 'disabled' : `data-dpd="${d}"`} title="${esc(dayLoad(d) ? fmtDur(dayLoad(d)) : '')}">${parseDate(d).getDate()}${mark(d)}</button>`; }).join('')}`).join('')}</div>`;
}
function weekCal(P) {
  const td = today(); const mo = P.view.slice(0, 7); const lim = limit() * 5;
  return `${head(fmtDay(P.view, { month:'long', year:'numeric' }))}<div class="dp-g wk"><span class="dp-wd"></span>${weekdays().map((w) => `<span class="dp-wd">${esc(w)}</span>`).join('')}<span class="dp-wd"></span></div>
    ${weeksOf(P.view).map((w) => { const m = Array.from({ length:7 }, (_, i) => dayLoad(addDays(w, i))).reduce((a, b) => a + b, 0);
      return `<button type="button" class="dp-row${w === P.sel ? ' s' : ''}" data-dpd="${w}"><span class="dp-wn">${isoWeekOf(w)}</span>${Array.from({ length:7 }, (_, i) => { const d = addDays(w, i); return `<span class="${d.slice(0, 7) !== mo ? 'o' : ''}${d === td ? ' t' : ''}">${parseDate(d).getDate()}${mark(d)}</span>`; }).join('')}<em class="${m >= lim ? 'f' : ''}" style="--w:${Math.min(100, (m / lim) * 100)}%">${m ? esc(fmtDur(m)) : '–'}</em></button>`; }).join('')}`;
}
function monthCal(P) {
  const y = Number(P.view.slice(0, 4)); const per = {};
  for (const b of live('blocks')) { if (!b.date || b.date.slice(0, 4) !== String(y) || b.outcome) continue; const k = b.date.slice(0, 7); per[k] = (per[k] || 0) + (b.minutes || 0); }
  const lim = limit() * 22; const tm = today().slice(0, 7);
  return `${head(String(y))}<div class="dp-mg">${Array.from({ length:12 }, (_, i) => { const k = `${y}-${String(i + 1).padStart(2, '0')}`; const m = per[k] || 0;
    return `<button type="button" class="${P.sel?.slice(0, 7) === k ? 's' : ''}${k === tm ? ' t' : ''}" data-dpd="${k}-01"><b>${esc(fmtDay(`${k}-01`, { month:'short' }))}</b><em class="${m >= lim ? 'f' : ''}"><u style="width:${Math.min(100, (m / lim) * 100)}%"></u></em><small>${m ? esc(fmtDur(m)) : ''}</small></button>`; }).join('')}</div>`;
}
function isoWeekOf(date) {
  const d = parseDate(date); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

// ---------- the popover ----------
let P = null; // { el, anchor, mode, view, sel, min, onPick, none, center }
export const calOpen = () => Boolean(P);
export function closeCal() { if (!P) return; P.el.remove(); P.anchor?.classList.remove('dp-open'); const done = P.onClose; P = null; done?.(); }
export function openCal(anchor, { mode = 'day', sel = today(), min = '', onPick, onClose, none = false, center = false } = {}) {
  closeCal(); loadCache.clear();
  const el = document.createElement('div'); el.className = `dp-pop dp-${mode}`; el.setAttribute('role', 'dialog');
  (anchor.closest('dialog') || document.body).appendChild(el);
  if (mode === 'week' && sel) sel = mondayOf(sel);
  P = { el, anchor, mode, view:mode === 'month' ? `${(sel || today()).slice(0, 4)}-01-01` : firstOf(sel || today()), sel, min, onPick, onClose, none, center };
  anchor.classList.add('dp-open');
  drawCal(); return P;
}
export function calShow(sel) { if (!P || !isoOk(sel)) return; P.sel = P.mode === 'week' ? mondayOf(sel) : sel; P.view = P.mode === 'month' ? `${sel.slice(0, 4)}-01-01` : firstOf(sel); drawCal(); }
function drawCal() {
  const body = P.mode === 'week' ? weekCal(P) : P.mode === 'month' ? monthCal(P) : dayCal(P);
  const now = P.mode === 'week' ? mondayOf(today()) : P.mode === 'month' ? firstOf(today()) : today();
  P.el.innerHTML = `${body}<div class="dp-ft"><button type="button" class="btn small" data-dpd="${now}">${esc(t(P.mode === 'week' ? 'dp_thisWeek' : P.mode === 'month' ? 'dp_thisMonth' : 'today'))}</button>${P.none ? `<button type="button" class="btn small ghost" data-dpnone="1">${esc(t('dp_none'))}</button>` : ''}${P.mode !== 'month' ? `<span class="dp-leg"><i class="f"></i> ${esc(t('dp_full'))} · <i></i> ${esc(t('dp_some'))}</span>` : ''}</div>`;
  place();
}
function place() {
  if (!P) return; const a = P.anchor.getBoundingClientRect(); const el = P.el; el.style.left = '0px'; el.style.top = '0px';
  const r0 = el.getBoundingClientRect(); // where (0,0) really lands (a dialog may move «fixed»)
  const w = r0.width, h = r0.height; const vw = window.innerWidth, vh = window.innerHeight;
  let x = P.center ? a.left + a.width / 2 - w / 2 : a.left; x = Math.max(8, Math.min(vw - w - 8, x));
  let y = a.bottom + 6; if (y + h > vh - 8 && a.top - h - 6 > 8) y = a.top - h - 6;
  el.style.left = `${x - r0.left}px`; el.style.top = `${y - r0.top}px`;
}
function pick(d) {
  if (!P) return; const f = P.onPick; const v = P.mode === 'week' ? mondayOf(d) : d; closeCal(); f?.(v);
}
document.addEventListener('pointerdown', (e) => {
  if (!P) return;
  if (e.target.closest?.('.dp-pop')) { e.preventDefault(); return; } // the field keeps the caret
  if (P.anchor.contains(e.target)) return;
  closeCal();
}, true);
document.addEventListener('click', (e) => {
  if (!P || !e.target.closest?.('.dp-pop')) return;
  e.preventDefault(); e.stopPropagation();
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.dpnav) { const k = Number(b.dataset.dpnav); P.view = P.mode === 'month' ? `${Number(P.view.slice(0, 4)) + k}-01-01` : shiftMonth(P.view, k); drawCal(); return; }
  if (b.dataset.dpnone) { const f = P.onPick; closeCal(); f?.(''); return; }
  if (b.dataset.dpd) pick(b.dataset.dpd);
}, true);
window.addEventListener('resize', () => place());
document.addEventListener('scroll', (e) => { if (P && !e.target.closest?.('.dp-pop')) place(); }, true);

// ---------- the field ----------
const SEG = [[0, 2], [3, 5], [6, 10]];
const F = { inp:null, seg:0, buf:'', free:false, start:'' };
const hiddenOf = (inp) => inp.parentElement.querySelector('input[data-dpv]');
function setVal(inp, v, { change = false } = {}) {
  const hid = hiddenOf(inp); const min = hid.getAttribute('min');
  if (v && min && v < min) v = min;
  const was = hid.value; hid.value = v;
  inp.parentElement.classList.toggle('empty', !v);
  const rel = inp.parentElement.querySelector('.dp-rel'); if (rel) rel.textContent = dpRel(v);
  if (v !== was) hid.dispatchEvent(new Event('input', { bubbles:true }));
  if (change && v !== F.start) { F.start = v; hid.dispatchEvent(new Event('change', { bubbles:true })); }
}
function selSeg(inp, k) { F.seg = k; F.buf = ''; const [a, b] = SEG[k]; try { inp.setSelectionRange(a, b); } catch { /* not focused */ } }
function begin(inp) {
  const hid = hiddenOf(inp); F.inp = inp; F.free = false; F.buf = ''; F.start = hid.value;
  const min = hid.getAttribute('min'); inp.value = dpText(hid.value || (min && min > today() ? min : today())); // an empty field starts from today
  selSeg(inp, 0);
  if (!calOpen() || P.anchor !== inp.parentElement) {
    openCal(inp.parentElement, { sel:hid.value || today(), min:hid.getAttribute('min') || '', none:!inp.hasAttribute('data-req'),
      onPick:(v) => { setVal(inp, v, { change:true }); inp.value = dpText(v); if (document.activeElement === inp) inp.blur(); } });
  }
}
function finish(inp, { close = true } = {}) {
  if (F.free) { const v = parseFree(inp.value); if (v) setVal(inp, v); F.free = false; }
  const hid = hiddenOf(inp); inp.value = dpText(hid.value);
  setVal(inp, hid.value, { change:true });
  if (close && P?.anchor === inp.parentElement) closeCal();
}
const partsOf = (inp) => inp.value.split(/[./]/);
function typed(inp) {
  const [d, m, y] = partsOf(inp); const v = `${y}-${m}-${d}`;
  if (isoOk(v)) { setVal(inp, v); calShow(v); }
}
function parseFree(s) {
  s = s.trim().toLowerCase(); if (!s) return '';
  const td = today();
  if (/^(oggi|today|heute)$/.test(s)) return td;
  if (/^(domani|tomorrow|morgen)$/.test(s)) return addDays(td, 1);
  for (let i = 1; i <= 7; i++) { const d = addDays(td, i); const names = [fmtDay(d, { weekday:'long' }), fmtDay(d, { weekday:'short' })].map((x) => x.toLowerCase().replace('.', '')); if (names.some((n) => n.startsWith(s.slice(0, 3)) && s.length >= 2 && n.startsWith(s.slice(0, Math.min(s.length, n.length))))) return d; }
  const m = s.match(/^(\d{1,2})(?:[\s./-]+(\d{1,2}|[a-zà-ü]{3,}))?(?:[\s./-]+(\d{2,4}))?$/); if (!m) return '';
  let mo = Number(parseDate(td).getMonth() + 1); let y = Number(td.slice(0, 4));
  if (m[2]) { if (/^\d+$/.test(m[2])) mo = Number(m[2]); else { mo = 0; for (let i = 0; i < 12; i++) { const n = fmtDay(`2026-${String(i + 1).padStart(2, '0')}-15`, { month:'long' }).toLowerCase(); if (n.startsWith(m[2].slice(0, 3))) { mo = i + 1; break; } } if (!mo) return ''; } }
  if (m[3]) y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  else if (!m[2] && Number(m[1]) < parseDate(td).getDate()) { mo += 1; if (mo > 12) { mo = 1; y += 1; } } // «9» on the 20th: the 9th of next month
  const v = `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; return isoOk(v) ? v : '';
}
document.addEventListener('mousedown', (e) => {
  const f = e.target.closest?.('.date-field[data-dp]'); if (!f) return;
  const inp = f.querySelector('.dp-in'); if (!inp || inp.disabled) return;
  e.preventDefault(); // wherever you click (the numbers, the words, the icon): the day is selected
  if (document.activeElement !== inp) inp.focus(); else begin(inp);
});
document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('dp-in')) begin(e.target); });
document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('dp-in')) finish(e.target); });
document.addEventListener('keydown', (e) => {
  const inp = e.target; if (!inp.classList?.contains('dp-in')) return;
  if (e.key === 'Escape') { if (calOpen()) { e.preventDefault(); e.stopPropagation(); inp.value = dpText(F.start); setVal(inp, F.start); closeCal(); } return; }
  if (e.key === 'Enter') { e.preventDefault(); finish(inp); return; }
  if (e.key === 'Tab') return; // leaves: focusout confirms
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (F.free) { setTimeout(() => { const v = parseFree(inp.value); if (v) calShow(v); }, 0); return; }
  const len = F.seg === 2 ? 4 : 2;
  if (/^\d$/.test(e.key)) {
    e.preventDefault(); F.buf += e.key; const p = partsOf(inp); p[F.seg] = F.buf.padStart(len, '0'); inp.value = p.join(sep());
    const done = F.buf.length >= len || (F.seg === 0 && Number(F.buf) > 3) || (F.seg === 1 && Number(F.buf) > 1);
    typed(inp);
    if (done && F.seg < 2) selSeg(inp, F.seg + 1); else { const k = F.seg; const b = F.buf; const [a, z] = SEG[k]; inp.setSelectionRange(a, z); F.buf = done ? '' : b; }
    return;
  }
  if (['/', '.', '-', ' ', 'ArrowRight'].includes(e.key)) { e.preventDefault(); selSeg(inp, Math.min(2, F.seg + 1)); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); selSeg(inp, Math.max(0, F.seg - 1)); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault(); const [d0, m0, y0] = partsOf(inp); const base = isoOk(`${y0}-${m0}-${d0}`) ? parseDate(`${y0}-${m0}-${d0}`) : parseDate(today()); const k = e.key === 'ArrowUp' ? 1 : -1;
    if (F.seg === 0) base.setDate(base.getDate() + k); else if (F.seg === 1) base.setMonth(base.getMonth() + k); else base.setFullYear(base.getFullYear() + k);
    const v = dateStr(base); inp.value = dpText(v); setVal(inp, v); calShow(v); selSeg(inp, F.seg); return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    if (!inp.hasAttribute('data-req') && (e.key === 'Delete' || (F.seg === 0 && !F.buf))) { setVal(inp, ''); inp.value = ''; closeCal(); return; }
    F.buf = ''; selSeg(inp, F.seg); return;
  }
  if (/^\p{L}$/u.test(e.key)) { F.free = true; inp.value = ''; setTimeout(() => { const v = parseFree(inp.value); if (v) calShow(v); }, 0); }
});
