// (v72) A block's time as "Inizio → Fine" with its length below. One side is fixed (the lit ring): tap
// Inizio or Fine to choose it, then a length counts from there (Fine fixed at 14:00 + 1h 30m → 12:30).
// Typing Inizio moves the block (the length stays); typing Fine changes the length. Below, the rest of
// that day ("la giornata"): your other blocks and calendar events, overlaps striped, "Sposta alle …" and
// dragging the block along it. The strip can be hidden (settings.dayStrip = false).
import { esc, planSettings } from './core.js';
import { t } from './i18n.js';
import { blocksOn, timedEventsOn } from './model.js';
import { fmtDur, fmtTime, freeSlot, parseTime } from './plan.js';
import { autoHoursFor } from './planning.js';
import { saveSettings, state } from './store.js';
import { durField, readDur, TIME24 } from './widgets.js';

export const LEN_CHIPS = [30, 45, 60, 90, 120, 180, 240];
const pad = (n) => String(n).padStart(2, '0');

// The fields. `start` is the time shown (the anchor step's time, `off` after the block's own start).
export function timePairHtml(b, off = 0, startLabel = '') {
  const shown = b.start + off;
  const endM = b.start + (b.minutes || 30);
  return `<div class="tpair" data-off="${off}">
      <div class="tp anchor" data-tp="start"><button type="button" class="tp-k" data-tpk="start">${esc(startLabel || t('start'))}<span class="tp-fixed"> · ${esc(t('tpFixed'))}</span></button><input name="start" ${TIME24} required value="${fmtTime(shown)}" aria-label="${esc(startLabel || t('start'))}"></div>
      <span class="tp-arrow" aria-hidden="true">→</span>
      <div class="tp" data-tp="end"><button type="button" class="tp-k" data-tpk="end">${esc(t('tpEnd'))}<span class="tp-fixed"> · ${esc(t('tpFixed'))}</span></button><input name="end" ${TIME24} value="${fmtTime(endM % 1440)}" aria-label="${esc(t('tpEnd'))}"></div>
    </div>
    <div class="field-label tp-len-h">${esc(t('duration'))}</div>
    <div class="tp-lens">${LEN_CHIPS.map((m) => `<button type="button" class="chip tp-len${m === b.minutes ? ' on' : ''}" data-len="${m}">${esc(fmtDur(m))}</button>`).join('')}<span class="tp-dur">${durField('minutes', b.minutes || 30)}</span></div>
    <p class="tp-note hint" aria-live="polite"></p>
    <div class="tp-day"></div>`;
}

// Wires the fields inside `form`. `self` is the block (its own id, steps and preps are left out of the strip).
export function wireTimePair(form, self) {
  const box = form.querySelector('.tpair'); if (!box) return;
  const off = Number(box.dataset.off) || 0;
  const startIn = form.elements.namedItem('start'); const endIn = form.elements.namedItem('end');
  const dateIn = form.elements.namedItem('date');
  const note = form.querySelector('.tp-note'); const dayBox = form.querySelector('.tp-day');
  let anchor = 'start';
  let start = (parseTime(startIn.value) ?? self.start + off) - off; // the block's own start
  let minutes = self.minutes || 30;
  const endOf = () => start + minutes;
  const setAnchor = (k) => { anchor = k; for (const el of box.querySelectorAll('.tp')) el.classList.toggle('anchor', el.dataset.tp === k); };
  const flash = (el) => { el.classList.remove('moved'); void el.offsetWidth; el.classList.add('moved'); };
  const writeDur = () => {
    const n = form.elements.namedItem('minutes'); const u = form.elements.namedItem('minutes_u');
    const h = minutes % 60 === 0 || (minutes >= 120 && minutes % 30 === 0);
    if (u && [...u.options].some((o) => o.value === 'h')) { u.value = h ? 'h' : 'min'; n.value = h ? String(+(minutes / 60).toFixed(2)) : String(minutes); } else n.value = String(minutes);
    for (const c of form.querySelectorAll('.tp-len')) c.classList.toggle('on', Number(c.dataset.len) === minutes);
  };
  const show = (moved, msg) => {
    startIn.value = fmtTime(((start + off) % 1440 + 1440) % 1440);
    endIn.value = fmtTime((endOf() % 1440 + 1440) % 1440);
    writeDur();
    if (moved) flash(box.querySelector(`[data-tp="${moved}"]`));
    note.innerHTML = msg || '';
    drawDay();
  };
  const setLen = (m) => {
    if (!(m > 0)) return;
    if (anchor === 'end') { const e = endOf(); minutes = m; start = e - m; if (start < 0) start = 0; show('start', t('tpEndFixed', fmtTime(endOf() % 1440), fmtTime(start + off))); }
    else { minutes = m; show('end', t('tpStartFixed', fmtTime(start + off), fmtTime(endOf() % 1440))); }
  };
  box.addEventListener('click', (e) => { const k = e.target.closest('[data-tpk]'); if (k) { setAnchor(k.dataset.tpk); note.textContent = ''; } });
  startIn.addEventListener('focus', () => setAnchor('start'));
  endIn.addEventListener('focus', () => setAnchor('end'));
  startIn.addEventListener('change', () => { const v = parseTime(startIn.value); if (v == null) { show(); return; } start = Math.max(0, v - off); show('end', t('tpEndFollows', fmtTime(endOf() % 1440), fmtDur(minutes))); });
  endIn.addEventListener('change', () => {
    const v = parseTime(endIn.value); if (v == null) { show(); return; }
    let m = v - start; let msg = '';
    if (m <= 0) { m += 1440; msg = t('tpNextDay'); }
    minutes = m; show('', msg || t('tpLenFollows', fmtDur(minutes)));
  });
  form.querySelector('.tp-lens').addEventListener('click', (e) => { const c = e.target.closest('[data-len]'); if (c) setLen(Number(c.dataset.len)); });
  const durIn = form.elements.namedItem('minutes'); const durU = form.elements.namedItem('minutes_u');
  const fromDur = () => { const m = readDur(form, 'minutes', null); if (m && m !== minutes) setLen(m); };
  durIn.addEventListener('change', fromDur); if (durU) durU.addEventListener('change', fromDur);
  if (dateIn) dateIn.addEventListener('change', () => drawDay());

  // ---- la giornata
  function others() {
    const d = dateIn?.value || self.date;
    const mine = (x) => x.id === self.id || x.parentId === self.id || (self.id && x.stepOf === self.id);
    return [...blocksOn(d).filter((x) => !mine(x) && x.kind !== 'prep'), ...timedEventsOn(d).filter((e) => !e.skipped)]
      .filter((x) => x.minutes > 0).map((x) => ({ id: x.id, title: x.title, s: x.start, m: x.minutes, ev: Boolean(x.isEvent), c: x.color || '' }));
  }
  function drawDay() {
    if (state.settings.dayStrip === false) { dayBox.innerHTML = `<button type="button" class="link tp-day-tg" data-daytg="on">${esc(t('dayShow'))}</button>`; return; }
    const d = dateIn?.value || self.date;
    const list = others();
    let lo = Math.floor((start - 90) / 60) * 60; let hi = Math.ceil((endOf() + 90) / 60) * 60;
    if (hi - lo < 360) { const c = (lo + hi) / 2; lo = Math.floor((c - 180) / 60) * 60; hi = lo + 360; }
    lo = Math.max(0, lo); hi = Math.min(1440 + 360, Math.max(hi, lo + 360));
    const x = (m) => `${(((m - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const w = (a, b) => `${(((Math.min(b, hi) - Math.max(a, lo)) / (hi - lo)) * 100).toFixed(2)}%`;
    const step = hi - lo > 600 ? 120 : 60; const ticks = [];
    for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) ticks.push(`<i class="dt-tick" style="left:${x(h)}"><span>${pad((h / 60) % 24)}</span></i>`);
    const seen = list.filter((o) => o.s + o.m > lo && o.s < hi);
    const clash = list.filter((o) => o.s < endOf() && start < o.s + o.m);
    const hatch = clash.map((o) => { const a = Math.max(o.s, start); const b2 = Math.min(o.s + o.m, endOf()); return `<i class="dt-clash" style="left:${x(a)};width:${w(a, b2)}"></i>`; }).join('');
    let fix = null;
    if (clash.length) {
      const s = planSettings(); const [h0, h1] = autoHoursFor(d);
      fix = freeSlot(list.map((o) => ({ start: o.s, minutes: o.m })), minutes, { from: Math.max(h0, s.dayStart, start), dayStart: Math.max(h0, s.dayStart), dayEnd: h1, snap: s.snap || 15 });
      if (fix == null) fix = freeSlot(list.map((o) => ({ start: o.s, minutes: o.m })), minutes, { from: Math.max(h0, s.dayStart), dayStart: Math.max(h0, s.dayStart), dayEnd: h1, snap: s.snap || 15 });
    }
    const line = clash.length
      ? `<p class="dt-line warn">⚠ ${esc(t('dayClash', clash.map((o) => `${o.title} (${fmtTime(o.s)}–${fmtTime(o.s + o.m)})`).join(', ')))}${fix != null && fix !== start ? ` <button type="button" class="chip dt-fix" data-fix="${fix}">${esc(t('dayMoveTo', fmtTime(fix + off)))}</button>` : ''}</p>`
      : `<p class="dt-line ok">✓ ${esc(t('dayFree'))}</p>`;
    dayBox.innerHTML = `<div class="dt-h"><span>${esc(t('dayRest'))}</span><button type="button" class="link tp-day-tg" data-daytg="off">${esc(t('dayHide'))}</button></div>
      <div class="dt-track" data-lo="${lo}" data-hi="${hi}">${ticks.join('')}
        ${seen.map((o) => `<i class="dt-o${o.ev ? ' ev' : ''}" style="left:${x(Math.max(o.s, lo))};width:${w(o.s, o.s + o.m)};--oc:${esc(o.c || 'var(--muted)')}" title="${esc(`${o.title} ${fmtTime(o.s)}–${fmtTime(o.s + o.m)}`)}">${o.ev ? '📅 ' : ''}${esc(o.title)}</i>`).join('')}
        ${hatch}<i class="dt-me" style="left:${x(Math.max(start, lo))};width:${w(start, endOf())}" title="${esc(t('dayDrag'))}"></i></div>${line}`;
  }
  dayBox.addEventListener('click', (e) => {
    const tg = e.target.closest('[data-daytg]');
    if (tg) { saveSettings({ dayStrip: tg.dataset.daytg === 'on' }); drawDay(); return; }
    const f = e.target.closest('[data-fix]');
    if (f) { start = Number(f.dataset.fix); show('start', t('dayMoved', fmtTime(start + off), fmtTime(endOf() % 1440))); flash(box.querySelector('[data-tp="end"]')); }
  });
  dayBox.addEventListener('pointerdown', (e) => {
    const me = e.target.closest('.dt-me'); if (!me) return;
    e.preventDefault();
    const tr = dayBox.querySelector('.dt-track'); const r = tr.getBoundingClientRect();
    const lo = Number(tr.dataset.lo); const hi = Number(tr.dataset.hi); const x0 = e.clientX; const s0 = start;
    const snap = planSettings().snap || 15;
    const mv = (ev) => { const dm = Math.round((((ev.clientX - x0) / r.width) * (hi - lo)) / snap) * snap; start = Math.max(0, Math.min(1440 - snap, s0 + dm)); show('', t('dayMoved', fmtTime(start + off), fmtTime(endOf() % 1440))); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  drawDay();
}
