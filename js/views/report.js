// views/report.js (v112): Resoconto — how the time went, for a day, a week or a month. Riepilogo: the numbers, the
// day on one line or the days as bars, where the time went (a donut and a mosaic), the month as squares, and
// «Com'è andata?» for what's still to mark. Elenco: everything in the period with how it went.
import { catColor, catName, esc, fmtDay, planSettings, ui } from '../core.js';
import { t } from '../i18n.js';
import { addDays, dateStr, fmtDur, fmtTime, nowMinutes, parseDate, today } from '../plan.js';
import { get, state } from '../store.js';
import { pageHead, viewMenu, vmSeg } from '../viewmenu.js';
import { pastOf } from './mappa.js';
import { weekStart } from './planner.js';
import { dayNodes, loadMin } from './scaletta.js';

const SCOPES = ['day', 'week', 'month'];
const scope = () => (SCOPES.includes(ui.repScope) ? ui.repScope : 'week');
const repDate = () => ui.repDate || today();
const repView = () => (state.settings.reportView === 'table' ? 'table' : 'summary');
const thread = (n) => (n.kind === 'event' ? '~ev' : n.category || '~none');
const thName = (th) => (th === '~ev' ? t('mp_calendar') : th === '~none' ? t('mp_other') : catName(get('categories', th)));
const thColor = (th) => (th === '~ev' ? 'var(--muted)' : catColor(th) || 'var(--accent)');
const isRt = (n) => n.kind === 'block' && (n.b.kind === 'meal' || Boolean(n.x?.repeat));
function daysOf(sc, d) {
  if (sc === 'day') return [d];
  if (sc === 'week') { const w = weekStart(d); return Array.from({ length:7 }, (_, i) => addDays(w, i)); }
  const p = parseDate(d); const first = dateStr(new Date(p.getFullYear(), p.getMonth(), 1)); const last = dateStr(new Date(p.getFullYear(), p.getMonth() + 1, 0));
  const out = []; for (let x = first; x <= last; x = addDays(x, 1)) out.push(x); return out;
}
const minsOf = (n) => Math.min(n.minutes || 0, 600);
const blockish = (n) => n.kind === 'block' && n.b.kind !== 'prep';

export function viewReport() {
  const sc = scope(); const d = repDate(); const td = today(); const days = daysOf(sc, d);
  const nodes = days.flatMap((x) => dayNodes(x).filter((n) => n.kind !== 'block' || n.b.kind !== 'prep'));
  const prev = sc === 'day' ? addDays(d, -1) : sc === 'week' ? addDays(d, -7) : dateStr(new Date(parseDate(d).getFullYear(), parseDate(d).getMonth() - 1, 1));
  const next = sc === 'day' ? addDays(d, 1) : sc === 'week' ? addDays(d, 7) : dateStr(new Date(parseDate(d).getFullYear(), parseDate(d).getMonth() + 1, 1));
  const label = sc === 'day' ? fmtDay(d) : sc === 'week' ? `${fmtDay(days[0], { day:'numeric', month:'short' })} – ${fmtDay(days[6], { day:'numeric', month:'short' })}` : fmtDay(d, { month:'long', year:'numeric' });
  const isNow = days.includes(td);
  const where = `<button type="button" class="round sm" data-action="rep-go" data-id="${prev}" aria-label="${esc(t('previous'))}">‹</button><span class="ph-date"><span class="day-name">${esc(label)}</span></span><button type="button" class="round sm" data-action="rep-go" data-id="${next}" aria-label="${esc(t('next'))}">›</button>${isNow ? '' : `<button type="button" class="linkish ph-today" data-action="rep-go" data-id="${td}">${esc(t('today'))}</button>`}`;
  const menu = viewMenu({ p:'rv', cur:repView(), title:t('rv_title'), items:[{ k:'summary', icon:'<span class="pv-ic" aria-hidden="true">📊</span>', label:t('rv_summary'), sub:t('rv_summarySub') }, { k:'table', icon:'<span class="pv-ic" aria-hidden="true">☰</span>', label:t('rv_table'), sub:t('rv_tableSub') }],
    opts:(k) => (k === 'table' ? vmSeg(t('rv_show'), 'rv-pend', state.settings.repOnlyPend ? '1' : '0', [['0', t('rv_all')], ['1', t('rv_onlyPend')]]) : '') });
  const head = pageHead({ title:t('tabReport'), where, menu, tabs:SCOPES.map((k) => ({ label:t(`v_${k}`), on:k === sc, action:'rep-scope', id:k })), pickTitle:t('ph_period') });
  const body = repView() === 'table' ? tableHtml(nodes) : summaryHtml(sc, days, nodes);
  return `${head}<section class="rp">${body}</section>`;
}

// ---------- the pieces ----------
function tiles(nodes, sc) {
  const bl = nodes.filter(blockish); const planned = bl.filter((n) => !isRt(n)).reduce((s, n) => s + minsOf(n), 0);
  const pss = bl.map(pastOf); const done = pss.filter((p) => p === 'done').length; const fail = pss.filter((p) => p === 'failed').length; const pend = pss.filter((p) => p === 'pend').length;
  const free = sc === 'day' ? Math.max(0, (planSettings().dayEnd - planSettings().dayStart) - loadMin(nodes[0]?.date || today())) : 0;
  const tile = (n, l, sub, cls = '') => `<div class="rp-tile${cls}"><b>${esc(n)}</b><small>${esc(l)}</small>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  return `<div class="rp-tiles">${tile(fmtDur(planned) || '0m', t('rp_planned'), '')}${tile(`${done}/${bl.length}`, t('rp_done'), bl.length ? `${Math.round((done / bl.length) * 100)}%` : '')}${tile(String(pend), t('rp_pend'), pend ? t('rp_pendSub') : '', pend ? ' warn' : '')}${sc === 'day' ? tile(fmtDur(free) || '0m', t('rp_free'), '') : tile(String(fail), t('rp_failed'), '', fail ? ' bad' : '')}</div>`;
}
const card = (title, sub, inner, cls = '') => `<div class="rp-card${cls}"><h4>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h4>${inner}</div>`;
function askList(nodes) {
  const pend = nodes.filter((n) => blockish(n) && pastOf(n) === 'pend').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  if (!pend.length) return `<p class="hint">${esc(t('rp_allMarked'))}</p>`;
  return pend.slice(0, 12).map((n) => `<div class="rp-ask" style="--c:${esc(thColor(thread(n)))}"><i></i><button type="button" class="rp-askt" data-action="open-block" data-id="${esc(n.id)}">${esc(n.title)}<small>${esc(`${fmtDay(n.date, { weekday:'short', day:'numeric' })} · ${fmtTime(n.start)} · ${fmtDur(n.minutes)}`)}</small></button><span class="rp-askb"><button type="button" data-action="behind-done" data-id="${esc(n.id)}" title="${esc(t('esDone'))}" aria-label="${esc(t('esDone'))}">✓</button><button type="button" data-action="behind-fail" data-id="${esc(n.id)}" title="${esc(t('esFail'))}" aria-label="${esc(t('esFail'))}">✕</button><button type="button" data-action="mp-unplan" data-id="${esc(n.id)}" title="${esc(t('mp_unplan'))}" aria-label="${esc(t('mp_unplan'))}">↩</button></span></div>`).join('') + (pend.length > 12 ? `<p class="hint">${esc(t('nMore', pend.length - 12))}</p>` : '');
}
const stCls = (n) => { const p = pastOf(n); return p === 'pend' ? ' pend' : p ? ' is-past' : ''; };
function dayStrip(nodes) {
  const ps = planSettings(); const h0 = Math.floor(Math.min(ps.dayStart, ...nodes.map((n) => n.start)) / 60) * 60; const h1 = Math.ceil(Math.max(ps.dayEnd, ...nodes.map((n) => n.start + n.minutes)) / 60) * 60;
  const X = (m) => ((Math.max(h0, Math.min(h1, m)) - h0) / (h1 - h0)) * 100; let lastEnd = -1, lane = 0;
  const hrs = []; for (let m = h0; m <= h1; m += 60) hrs.push(m);
  return `<div class="rp-strip">${hrs.map((m, i) => `<span class="rp-g" style="left:${X(m)}%"></span>${i % 2 ? '' : `<span class="rp-h" style="left:${X(m)}%">${esc(fmtTime(m % 1440))}</span>`}`).join('')}
    ${nodes[0]?.date === today() ? `<span class="rp-now" style="left:${X(nowMinutes())}%"></span>` : ''}
    ${nodes.map((n) => { const l = X(n.start); const r = Math.max(X(n.start + n.minutes), l + 3.2); lane = l < lastEnd ? (lane + 1) % 2 : 0; if (!lane) lastEnd = r; else lastEnd = Math.max(lastEnd, r);
      return `<button type="button" class="rp-bk${stCls(n)}${lane ? ' lo' : ''}" ${n.kind === 'block' ? `data-action="open-block" data-id="${esc(n.id)}"` : `data-action="event" data-id="${esc(n.raw)}"`} title="${esc(`${n.title} · ${fmtTime(n.start)}`)}" style="--c:${esc(thColor(thread(n)))};left:${l}%;width:calc(${r - l}% - 2px)">${n.out === 'done' ? '✓ ' : ''}${esc(n.title)}</button>`; }).join('')}</div>`;
}
function perCat(nodes) {
  const by = new Map(); for (const n of nodes.filter((q) => !isRt(q))) { const th = thread(n); const o = by.get(th) || { m:0, d:0 }; o.m += minsOf(n); if (pastOf(n) === 'done' || pastOf(n) === 'over') o.d += minsOf(n); by.set(th, o); }
  const rows = [...by.entries()].sort((a, b) => b[1].m - a[1].m); const mx = Math.max(1, ...rows.map(([, o]) => o.m));
  return rows.map(([th, o]) => `<div class="rp-cat"><span style="color:${esc(thColor(th))}">${esc(thName(th))}</span><span class="rp-ct"><i class="pl" style="width:${(o.m / mx) * 100}%;--c:${esc(thColor(th))}"></i><i style="width:${(o.d / mx) * 100}%;background:${esc(thColor(th))}"></i></span><small>${esc(`${fmtDur(o.d) || '0m'} / ${fmtDur(o.m)}`)}</small></div>`).join('') || `<p class="hint">${esc(t('agEmpty'))}</p>`;
}
function routinesOf(nodes) {
  const rts = nodes.filter((n) => blockish(n) && isRt(n)); if (!rts.length) return '';
  const done = rts.filter((n) => pastOf(n) === 'done').length;
  return card(t('rp_routines'), `${done}/${rts.length}`, rts.map((n) => { const p = pastOf(n); return `<div class="rp-ck" style="--c:${esc(thColor(thread(n)))}">${p === 'pend' ? `<button type="button" class="bx p" data-action="behind-done" data-id="${esc(n.id)}" aria-label="${esc(t('esDone'))}">?</button>` : `<span class="bx${p === 'done' ? ' y' : p === 'failed' ? ' x' : ''}">${p === 'done' ? '✓' : p === 'failed' ? '✕' : ''}</span>`}<span>${esc(n.title)}</span><small>${esc(p === 'done' ? t('esDoneLine') : p === 'failed' ? t('esFailLine') : p === 'pend' ? t('rp_toMark') : fmtTime(n.start))}</small></div>`; }).join(''));
}
function bars(days, nodes) {
  const max = planSettings().maxLoad || 480; const td = today(); const scale = Math.max(max * 1.5, ...days.map((d) => nodes.filter((n) => n.date === d).reduce((s, n) => s + minsOf(n), 0)));
  return `<div class="rp-bars">${days.map((d) => { const ns = nodes.filter((n) => n.date === d && !isRt(n)); const by = new Map(); for (const n of ns) by.set(thread(n), (by.get(thread(n)) || 0) + minsOf(n)); const tot = [...by.values()].reduce((a, b) => a + b, 0);
    return `<button type="button" class="rp-bl${d === td ? ' td' : ''}" data-action="rep-day" data-id="${d}">${esc(fmtDay(d, { weekday:'short', day:'numeric' }))}</button><span class="rp-tr">${[...by.entries()].map(([th, m]) => `<i title="${esc(`${thName(th)} · ${fmtDur(m)}`)}" style="width:${(m / scale) * 100}%;background:${esc(thColor(th))}"></i>`).join('')}<b class="rp-lim" style="left:${(max / scale) * 100}%"></b></span><small class="${tot > max ? 'over' : ''}">${esc(fmtDur(tot) || '—')}</small>`; }).join('')}</div>`;
}
function donut(nodes) {
  const by = new Map(); for (const n of nodes.filter((q) => !isRt(q))) by.set(thread(n), (by.get(thread(n)) || 0) + minsOf(n));
  const rows = [...by.entries()].filter(([, m]) => m).sort((a, b) => b[1] - a[1]); const T = rows.reduce((s, [, m]) => s + m, 0); if (!T) return `<p class="hint">${esc(t('agEmpty'))}</p>`;
  let a0 = -Math.PI / 2, arcs = ''; const R = 80, r = 50, c = 90; const P = (an, rd) => `${(c + Math.cos(an) * rd).toFixed(1)},${(c + Math.sin(an) * rd).toFixed(1)}`;
  for (const [th, m] of rows) { const a1 = a0 + (m / T) * Math.PI * 2 - 0.0001; const lg = a1 - a0 > Math.PI ? 1 : 0; arcs += `<path d="M${P(a0, R)} A${R},${R} 0 ${lg} 1 ${P(a1, R)} L${P(a1, r)} A${r},${r} 0 ${lg} 0 ${P(a0, r)} Z" fill="${thColor(th)}" stroke="var(--surface)" stroke-width="2"/>`; a0 = a1; }
  return `<div class="rp-dn"><svg viewBox="0 0 180 180" width="170" height="170">${arcs}<text x="90" y="96" text-anchor="middle" class="rp-dt">${esc(fmtDur(T))}</text></svg><div class="rp-lg">${rows.map(([th, m]) => `<span><i style="background:${esc(thColor(th))}"></i>${esc(thName(th))} · ${esc(fmtDur(m))} · ${Math.round((m / T) * 100)}%</span>`).join('')}</div></div>`;
}
function mosaic(nodes) {
  const by = new Map(); for (const n of nodes.filter((q) => !isRt(q))) { const th = thread(n); if (!by.has(th)) by.set(th, new Map()); const g = by.get(th); g.set(n.title, (g.get(n.title) || 0) + minsOf(n)); }
  const cols = [...by.entries()].map(([th, g]) => [th, [...g.entries()].sort((a, b) => b[1] - a[1]), [...g.values()].reduce((a, b) => a + b, 0)]).filter(([, , m]) => m).sort((a, b) => b[2] - a[2]);
  if (!cols.length) return '';
  return `<div class="rp-mos">${cols.map(([th, items, m]) => `<div class="rp-mc" style="flex:${m}"><b style="color:${esc(thColor(th))}">${esc(thName(th))}</b>${items.slice(0, 5).map(([ti, mm]) => `<span style="flex:${mm};background:color-mix(in srgb, ${thColor(th)} 70%, #000)">${esc(ti)}<small>${esc(fmtDur(mm))}</small></span>`).join('')}</div>`).join('')}</div>`;
}
function heat(days) {
  const td = today(); const first = days[0]; const pad = (parseDate(first).getDay() + 6) % 7; const cells = [...Array(pad).fill(null), ...days];
  const lv = (m) => (m < 60 ? 0 : m < 180 ? 1 : m < 300 ? 2 : m < 420 ? 3 : 4);
  const heads = Array.from({ length:7 }, (_, i) => fmtDay(addDays(weekStart(first), i), { weekday:'narrow' }));
  return `<div class="rp-cal">${heads.map((h) => `<span class="rp-ch">${esc(h)}</span>`).join('')}${cells.map((d) => { if (!d) return '<span></span>'; const pend = dayNodes(d).some((n) => blockish(n) && pastOf(n) === 'pend');
    return `<button type="button" class="rp-c l${lv(loadMin(d))}${d === td ? ' td' : ''}${pend ? ' pend' : ''}" data-action="rep-day" data-id="${d}" title="${esc(fmtDur(loadMin(d)) || '—')}">${parseDate(d).getDate()}</button>`; }).join('')}</div>
    <div class="rp-lgd">${esc(t('rp_less'))}${[0, 1, 2, 3, 4].map((k) => `<i class="rp-c l${k}"></i>`).join('')}${esc(t('rp_more'))} · <i class="rp-c pend"></i>${esc(t('rp_toMark'))}</div>`;
}
function summaryHtml(sc, days, nodes) {
  if (sc === 'day') return `${tiles(nodes, sc)}${card(t('rp_theDay'), t('rp_dayLeg'), dayStrip(nodes), ' rp-w')}<div class="rp-cols">${card(t('rp_byCat'), t('rp_byCatSub'), perCat(nodes))}<div>${card(t('rp_ask'), '', askList(nodes))}${routinesOf(nodes)}</div></div>`;
  if (sc === 'week') return `${tiles(nodes, sc)}${card(t('rp_balance'), t('rp_balanceSub'), bars(days, nodes), ' rp-w')}<div class="rp-cols">${card(t('rp_where'), '', donut(nodes))}${card(t('rp_ask'), '', askList(nodes))}</div>${card(t('rp_inside'), t('rp_insideSub'), mosaic(nodes), ' rp-w')}`;
  const weeks = []; for (let w = weekStart(days[0]); w <= days[days.length - 1]; w = addDays(w, 7)) weeks.push(w);
  return `${tiles(nodes, sc)}<div class="rp-cols">${card(t('rp_squares'), t('rp_squaresSub'), heat(days))}${card(t('rp_where'), '', donut(nodes))}</div>${card(t('rp_balance'), t('rp_weeksSub'), bars(weeks.map((w) => w), weeks.flatMap((w) => Array.from({ length:7 }, (_, i) => addDays(w, i))).flatMap((d) => dayNodes(d).map((n) => ({ ...n, date:weekStart(d) })))), ' rp-w')}${card(t('rp_inside'), t('rp_insideSub'), mosaic(nodes), ' rp-w')}`;
}
function tableHtml(nodes) {
  const only = state.settings.repOnlyPend; const list = nodes.filter((n) => !only || pastOf(n) === 'pend').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
  if (!list.length) return `<p class="empty">${esc(t(only ? 'rp_allMarked' : 'agEmpty'))}</p>`;
  let last = ''; let h = '';
  for (const n of list) { if (n.date !== last) { h += `<h3 class="vw-gh">${esc(fmtDay(n.date))}</h3>`; last = n.date; } const p = pastOf(n);
    h += `<div class="rp-row${stCls(n)}" style="--c:${esc(thColor(thread(n)))}"><i>${esc(fmtTime(n.start))}</i><button type="button" class="rp-rt" ${n.kind === 'block' ? `data-action="open-block" data-id="${esc(n.id)}"` : `data-action="event" data-id="${esc(n.raw)}"`}>${n.fixed ? '📅 ' : ''}${esc(n.title)}<small>${esc(`${thName(thread(n))} · ${fmtDur(n.minutes)}`)}</small></button><span class="rp-st ${p || 'next'}">${esc(p ? t(`rp_st_${p}`) : t('rp_st_next'))}</span>${p === 'pend' ? `<span class="rp-askb"><button type="button" data-action="behind-done" data-id="${esc(n.id)}" aria-label="${esc(t('esDone'))}">✓</button><button type="button" data-action="behind-fail" data-id="${esc(n.id)}" aria-label="${esc(t('esFail'))}">✕</button></span>` : ''}</div>`; }
  return h;
}
