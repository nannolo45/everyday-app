// views/mappa.js (v96): the Planner as a map (Settings → Planner → Aspetto). Day: the hours down, a column per
// category, each thing as tall as it lasts. Week: seven day columns (morning · afternoon · evening). Month: a row
// per week with a box per category (Settimane) or a line per category like a metro map (Linee).
// Tap a thing: its 7 ports around it (⤷ Prepara on top, 🔒 Prima serve left, ↓ Poi below, ‖ In parallelo right,
// ✓ bottom-left, ✕ bottom-right, ⏰ top-right). Tap a port: the ghost node (a new thing or one you have);
// drag a port onto another thing: the preview, with the guardrails.
import { catColor, catName, categories, esc, fmtDay, planSettings, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { conflictsOn } from '../model.js';
import { addDays, fmtDur, fmtTime, nowMinutes, parseDate, today } from '../plan.js';
import { render } from '../shell.js';
import { get } from '../store.js';
import { dropOn, ghostHtml, LT, linkPill, linksFor, lname, node, PORT_POS, PORTS, when } from '../graph.js';
import { behindCard, planCard, weekStart } from './planner.js';
import { dayNodes, loadMin, nodeColor, overlays, rawId } from './scaletta.js';

const S = () => (ui.mp ||= { pan:{ x:0, y:0, k:1 }, sel:null, cl:null, mstyle:'weeks', key:'' });
const thread = (n) => (n.kind === 'event' ? '~ev' : n.category || '~none');
const threadName = (th) => (th === '~ev' ? t('mp_calendar') : th === '~none' ? t('mp_other') : catName(get('categories', th)));
const threadColor = (th) => (th === '~ev' ? 'var(--muted)' : catColor(th) || 'var(--accent)');
const orderThreads = (ths) => { const order = categories().map((c) => c.id); return [...ths].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)); };
const shortDay = (d) => fmtDay(d, { weekday:'short', day:'numeric' });

function curve(ax, ay, bx, by, tt, label, hz) {
  const st = LT[tt] || LT.poi;
  const d = hz ? `M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by} ${bx},${by}` : `M${ax},${ay} C${ax},${(ay + by) / 2} ${bx},${(ay + by) / 2} ${bx},${by}`;
  let h = tt === 'par' ? `<path d="${d}" stroke="${st.c}" stroke-width="6" opacity=".4" fill="none"/>` : `<path d="${d}" stroke="${st.c}" stroke-width="1.8" fill="none"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`;
  if (tt !== 'par') { const ang = hz ? (bx >= ax ? 0 : Math.PI) : (by >= ay ? Math.PI / 2 : -Math.PI / 2); const p = (r) => `${bx - Math.cos(ang + r) * 6},${by - Math.sin(ang + r) * 6}`; h += `<path d="M${p(0.5)} L${bx},${by} L${p(-0.5)}" stroke="${st.c}" stroke-width="2" fill="none"/>`; }
  if (label) h += `<text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 4}" fill="${st.c}" text-anchor="middle">${esc(label)}</text>`;
  return h;
}
const svgOf = (s) => `<svg class="mp-links" width="10" height="10">${s}</svg>`;
function nodeHtml(n, r, conf, links, extra = '') {
  const sel = S().sel; const near = sel && links.some((l) => (l.a === sel && l.b === n.id) || (l.b === sel && l.a === n.id));
  const cls = `mp-n${n.fixed ? ' appt' : ''}${n.kind === 'event' ? ' gcal' : ''}${n.out ? ` is-${n.out}` : ''}${conf.has(rawId(n)) ? ' conflict' : ''}${sel === n.id ? ' sel' : ''}${sel && sel !== n.id && !near ? ' dim' : ''}${extra}`;
  return `<button type="button" class="${cls}" data-action="mp-sel" data-id="${esc(n.id)}" data-mpn="${esc(n.id)}" style="--c:${esc(nodeColor(n))};left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><b>${n.fixed ? '📅 ' : ''}${n.out === 'done' ? '✓ ' : ''}${esc(n.title)}</b><small>${esc(fmtTime(n.start))}${r.h > 34 ? `–${esc(fmtTime(n.start + n.minutes))}` : ''}</small></button>`;
}
// the 7 ports around the selected thing (P4: Prepara top, Prima serve left, Poi bottom, In parallelo right,
// ✓ bottom-left, ✕ bottom-right, ⏰ top-right)
const PXY = { top:[0.5, 0], left:[0, 0.5], bottom:[0.5, 1], right:[1, 0.5], bl:[0, 1], br:[1, 1], tr:[1, 0] };
function portsHtml(n, r) {
  if (n.kind !== 'block' || !n.x) return '';
  return PORTS.map((k) => { const [fx, fy] = PXY[PORT_POS[k]]; return `<button type="button" class="mp-port" data-action="gr-port" data-id="${esc(`${n.id}~${k}`)}" data-port="${esc(`${n.id}~${k}`)}" style="--pc:${LT[k].c};left:${r.x + fx * r.w}px;top:${r.y + fy * r.h}px" title="${esc(lname(k))}" aria-label="${esc(lname(k))}">${LT[k].i}</button>`; }).join('');
}
// B3: the ghost node, out from the port it came from
function ghostNode(R) {
  const g = ui.gr; if (!g || g.pv) return ''; const r = R[g.from]; if (!r) return '';
  const pos = PORT_POS[g.k]; const [fx, fy] = PXY[pos]; const px = r.x + fx * r.w, py = r.y + fy * r.h;
  const dx = pos === 'left' || pos === 'bl' ? -1 : pos === 'right' || pos === 'br' || pos === 'tr' ? 1 : 0; const dy = pos === 'top' || pos === 'tr' ? -1 : pos === 'bottom' || pos === 'bl' || pos === 'br' ? 1 : 0;
  const gw = 120, gh = 40; const gx = px + dx * 70 - gw / 2 + (dx ? dx * gw / 2 : 0), gy = py + dy * 70 - gh / 2;
  return `<div class="mp-ghostn" style="--pc:${LT[g.k].c};left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px">${LT[g.k].i} ${esc(g.q || '…')}</div>${svgOf(`<path d="M${px},${py} L${gx + gw / 2},${gy + gh / 2}" stroke="${LT[g.k].c}" stroke-width="2" stroke-dasharray="4 4" fill="none"/>`)}`;
}
const confSet = (dates) => new Set(dates.flatMap((d) => conflictsOn(d).filter((c) => c.type === 'overlap' || c.type === 'order').flatMap((c) => c.ids)));

// ---------- day ----------
function mapDay(date) {
  const ps = planSettings(); const ns = dayNodes(date); const td = today();
  const minS = Math.min(ps.dayStart, ...ns.map((n) => n.start)); const maxE = Math.max(ps.dayEnd, ...ns.map((n) => n.start + n.minutes));
  const h0 = Math.floor(minS / 60) * 60, h1 = Math.ceil(maxE / 60) * 60;
  const links = linksFor(ns.filter((n) => n.kind === 'block').map((n) => n.b)); const conf = confSet([date]);
  const TOP = 150; const Y = (m) => TOP + (m - h0) * 0.8; const NW = 130; let h = '', svg = ''; const R = {};
  for (let m = h0; m <= h1; m += 60) h += `<div class="mp-hline" style="top:${Y(m)}px"><span>${esc(fmtTime(m % 1440))}</span></div>`;
  if (date === td) h += `<div class="mp-hline mp-now" style="top:${Y(nowMinutes())}px"></div>`;
  const ths = orderThreads([...new Set(ns.map(thread))]); let x0 = 52;
  for (const th of ths) {
    const list = ns.filter((n) => thread(n) === th); const cols = [];
    for (const n of list) { const y = Y(n.start); let c = cols.findIndex((e) => e <= y); if (c < 0) { c = cols.length; cols.push(0); } const hh = Math.max(38, n.minutes * 0.8 - 2); cols[c] = y + hh + 4; R[n.id] = { x:x0 + c * (NW + 10), y, w:NW, h:hh, n }; }
    h += `<div class="mp-lane" style="left:${x0}px;top:${TOP - 26}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</div>`; x0 += Math.max(1, cols.length) * (NW + 10) + 14;
  }
  for (const r of Object.values(R)) h += nodeHtml(r.n, r, conf, links);
  // linked things on other days (above: before, below: after), unplanned ones and branches below
  let up = 0, dn = 0, side = 0, x1 = x0; const bottom = Y(h1) + 24;
  for (const l of links) {
    const ia = Boolean(R[l.a]), ib = Boolean(R[l.b]); if (ia === ib) continue;
    const here = R[ia ? l.a : l.b]; const oid = ia ? l.b : l.a; if (R[oid]) continue; const o = node(oid); if (!o) continue;
    // other days: above (before) or below (after) its column; branches and unplanned: a column on the right, level with it
    const before = o.date && o.date < date; let x = here.x, y;
    if (!o.date) { x = x0; y = here.y + side++ * 6; x1 = x0 + NW + 20; } else if (before) { y = TOP - 86; x = here.x + up++ * 8; } else y = bottom + dn++ * 50;
    R[oid] = { x, y, w:NW, h:42, n:o };
    const sub = o.kind === 'pot' ? t('sc_branchSub', lname(l.t)) : o.date ? `${relDay(o.date)} ${fmtTime(o.start)} · ${t('mp_go')}` : t('gr_unplanned');
    h += o.date ? `<a class="mp-n stub" href="#/plan/${esc(o.date)}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${y}px;width:${NW}px;height:42px"><b>${esc(o.title)}</b><small>${esc(sub)}</small></a>`
      : `<div class="mp-n stub${o.kind === 'pot' ? ' pot' : ''}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${y}px;width:${NW}px;height:42px"><b>${LT[l.t].i} ${esc(o.title)}</b><small>${esc(sub)}</small></div>`;
  }
  for (const l of links) { const a = R[l.a], b = R[l.b]; if (!a || !b) continue; const hz = l.t === 'par' || Math.abs(a.y - b.y) < 20; svg += hz ? curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, l.t, LT[l.t].i, true) : a.y <= b.y ? curve(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, l.t, LT[l.t].i + (l.l ? ` ${l.l}` : ''), false) : curve(a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h, l.t, LT[l.t].i, false); }
  const sel = R[S().sel];
  return { html:svgOf(svg) + h + (sel ? portsHtml(sel.n, sel) : '') + ghostNode(R), w:Math.max(x1 + 60, 340), h:bottom + dn * 50 + 40, R, links, focusY:ns.length ? Y(Math.max(h0, Math.min(...ns.map((n) => n.start)) - 30)) - (links.some((l) => R[l.a]?.y < TOP || R[l.b]?.y < TOP) ? 130 : 0) : Y(ps.dayStart) };
}

// ---------- week ----------
function mapWeek(date) {
  const w0 = weekStart(date); const days = Array.from({ length:7 }, (_, i) => addDays(w0, i)); const td = today();
  const CW = 112, NW = 102, NH = 40, X0 = 74; let h = '', svg = ''; const R = {};
  const part = (m) => (m < 13 * 60 ? 'am' : m < 18 * 60 ? 'pm' : 'eve'); const PH = { am:0, pm:0, eve:0 };
  const byDay = days.map((d) => dayNodes(d).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep')));
  for (const ns of byDay) for (const p of Object.keys(PH)) PH[p] = Math.max(PH[p], ns.filter((n) => part(n.start) === p).length);
  let y = 54; const PY = {}; for (const p of ['am', 'pm', 'eve']) { PY[p] = y; y += Math.max(1, PH[p]) * (NH + 8) + 16; }
  const H = y + 10; const all = byDay.flat(); const links = linksFor(all.filter((n) => n.kind === 'block').map((n) => n.b)); const conf = confSet(days);
  for (const p of ['am', 'pm', 'eve']) h += `<div class="mp-part" style="top:${PY[p] - 14}px;width:${X0 + 7 * CW + 140}px">${esc(t(`mp_${p}`))}</div>`;
  const max = planSettings().maxLoad;
  days.forEach((d, i) => {
    const x = X0 + i * CW; const ld = loadMin(d);
    h += `<div class="mp-colbg${d === td ? ' is-today' : ''}${i > 4 ? ' we' : ''}" style="left:${x - 4}px;width:${CW}px;height:${H}px"></div><button type="button" class="mp-colh${d === td ? ' is-today' : ''}" data-action="view-day" data-id="${d}" style="left:${x - 4}px;width:${CW}px">${esc(fmtDay(d, { weekday:'short' }))}<b>${parseDate(d).getDate()}</b><i><u style="width:${Math.min(100, (ld / max) * 100)}%" class="${ld > max ? 'over' : ''}"></u></i></button>`;
    const cnt = { am:0, pm:0, eve:0 };
    for (const n of byDay[i]) { const p = part(n.start); const ny = PY[p] + cnt[p]++ * (NH + 8); R[n.id] = { x, y:ny, w:NW, h:NH, n }; }
  });
  for (const r of Object.values(R)) h += nodeHtml(r.n, r, conf, links);
  let lb = 0, rb = 0;
  for (const l of links) {
    const ia = Boolean(R[l.a]), ib = Boolean(R[l.b]); if (ia === ib) continue; const oid = ia ? l.b : l.a; if (R[oid]) continue; const o = node(oid); if (!o) continue;
    const left = o.date && o.date < w0; const pot = !o.date; const here = R[ia ? l.a : l.b];
    const x = pot ? here.x : left ? 4 : X0 + 7 * CW + 6; const yy = pot ? H + 6 + rb * 0 : 54 + (left ? lb++ : rb++) * 48; const ww = pot ? NW : 64;
    R[oid] = { x, y:yy, w:ww, h:40, n:o };
    h += o.date ? `<a class="mp-n stub" href="#/plan/${esc(o.date)}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${yy}px;width:${ww}px;height:40px"><b>${esc(o.title)}</b><small>${esc(shortDay(o.date))}</small></a>`
      : `<div class="mp-n stub pot" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${yy}px;width:${ww}px;height:40px"><b>${LT[l.t].i} ${esc(o.title)}</b><small>${esc(o.kind === 'pot' ? lname(l.t) : t('gr_unplanned'))}</small></div>`;
  }
  for (const l of links) { const a = R[l.a], b = R[l.b]; if (!a || !b) continue; const hz = Math.abs(a.x - b.x) > 20; svg += hz ? (a.x < b.x ? curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, l.t, LT[l.t].i, true) : curve(a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, l.t, LT[l.t].i, true)) : curve(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, l.t, LT[l.t].i, false); }
  const sel = R[S().sel];
  return { html:svgOf(svg) + h + (sel ? portsHtml(sel.n, sel) : '') + ghostNode(R), w:X0 + 7 * CW + 80, h:H + 60, R, links };
}

// ---------- month ----------
const monthWeeks = (date) => { const ws = []; for (let w = weekStart(`${date.slice(0, 7)}-01`); w.slice(0, 7) <= date.slice(0, 7); w = addDays(w, 7)) ws.push(w); return ws; };
const wlevel = (m) => (m < 360 ? 'light' : m < 840 ? 'normal' : m < 1320 ? 'full' : 'veryfull');
function monthData(date) {
  const ws = monthWeeks(date); const days = []; for (let d = ws[0]; d < addDays(ws[ws.length - 1], 7); d = addDays(d, 1)) days.push(d);
  const items = days.flatMap((d) => dayNodes(d).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep')));
  return { ws, days, items, ths:orderThreads([...new Set(items.map(thread))]), links:linksFor(items.filter((n) => n.kind === 'block').map((n) => n.b)).filter((l) => !l.b.startsWith('pot:')) };
}
const weekLoad = (w) => Array.from({ length:7 }, (_, i) => loadMin(addDays(w, i))).reduce((a, b) => a + b, 0);
function mapMonthWeeks(date) {
  const { ws, items, ths, links } = monthData(date); const td = today(); const LW = 82, CW = 82, RH = 80, Y0 = 28; let h = '', svg = ''; const C = {};
  const conf = confSet(items.map((n) => n.date).filter((d, i, a) => a.indexOf(d) === i));
  ths.forEach((th, j) => { h += `<div class="mp-thh" style="left:${LW + j * CW}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</div>`; });
  ws.forEach((w, r) => {
    const y = Y0 + r * RH; const L = weekLoad(w); const cur = weekStart(td) === w; const cf = items.some((n) => n.date >= w && n.date <= addDays(w, 6) && conf.has(rawId(n)));
    h += `<div class="mp-wrow${cur ? ' cur' : ''}" style="top:${y - 4}px;height:${RH}px;width:${LW + Math.max(1, ths.length) * CW + 10}px"></div>
      <button type="button" class="mp-wlab" data-action="mp-week" data-id="${w}" style="top:${y + 6}px"><b>${parseDate(w).getDate()}–${parseDate(addDays(w, 6)).getDate()}</b><small>${esc(fmtDur(L) || '—')} · ${esc(t(`sc_wl_${wlevel(L)}`))}${cf ? ' · <em>⚠</em>' : ''}</small><i><u class="${wlevel(L)}" style="width:${Math.min(100, (L / (30 * 60)) * 100)}%"></u></i></button>`;
    ths.forEach((th, j) => {
      const its = items.filter((n) => thread(n) === th && n.date >= w && n.date <= addDays(w, 6)); if (!its.length) return;
      const x = LW + j * CW; const key = `${w}|${th}`; C[key] = { x, y, w:76, h:64 };
      const ap = its.filter((n) => n.fixed).length; const warn = its.some((n) => conf.has(rawId(n))); const inner = links.filter((l) => its.some((n) => n.id === l.a) && its.some((n) => n.id === l.b)).length;
      h += `<button type="button" class="mp-cl${S().cl === key ? ' sel' : ''}${warn ? ' warn' : ''}" data-action="mp-cl" data-id="${esc(key)}" style="--c:${esc(threadColor(th))};left:${x}px;top:${y}px"><b>${its.length === 1 ? esc(its[0].title) : esc(t('mp_things', its.length))}</b><small>${ap ? `📅 ${ap} · ` : ''}${esc(fmtDur(its.reduce((s, n) => s + n.minutes, 0)))}${inner ? ` · ${esc(t('mp_links', inner))}` : ''}</small><span class="dots">${Array.from({ length:7 }, (_, i) => { const q = its.filter((n) => n.date === addDays(w, i)); return `<span class="${q.length ? (q.some((n) => n.fixed) ? 'ap' : 'on') : ''}"></span>`; }).join('')}</span></button>`;
    });
  });
  const agg = {};
  for (const l of links) { const a = node(l.a), b = node(l.b); if (!a?.date || !b?.date) continue; const wa = weekStart(a.date), wb = weekStart(b.date); if (wa === wb && thread(a) === thread(b)) continue; const k = `${wa}|${thread(a)}>${wb}|${thread(b)}`; (agg[k] ||= { from:`${wa}|${thread(a)}`, to:`${wb}|${thread(b)}`, n:0, t:l.t }).n++; }
  for (const g of Object.values(agg)) { const A = C[g.from], B = C[g.to]; if (!A || !B) continue; svg += A.y === B.y ? curve(A.x + A.w, A.y + 30, B.x, B.y + 30, g.t, g.n > 1 ? `${g.n}` : LT[g.t].i, true) : curve(A.x + A.w / 2, A.y + A.h, B.x + B.w / 2, B.y, g.t, g.n > 1 ? t('mp_links', g.n) : LT[g.t].i, false); }
  return { html:svgOf(svg) + h, w:LW + Math.max(1, ths.length) * CW + 20, h:Y0 + ws.length * RH + 10 };
}
function mapMonthLines(date) {
  const { ws, days, items, ths, links } = monthData(date); const td = today(); const DX = 17, X0 = 70, Y0 = 74, LH = 52;
  const idx = (d) => days.indexOf(d); const xOf = (d) => X0 + idx(d) * DX; let h = '', svg = ''; const P = {};
  const conf = confSet(days.filter((d) => d >= addDays(td, -7)));
  for (const w of ws) { const L = weekLoad(w); const cur = weekStart(td) === w; h += `<button type="button" class="mp-wk${cur ? ' cur' : ''}" data-action="mp-week" data-id="${w}" style="left:${xOf(w) - DX / 2}px;width:${7 * DX}px"><b>${parseDate(w).getDate()}–${parseDate(addDays(w, 6)).getDate()}</b><small>${esc(fmtDur(L) || '—')}</small><span class="bar"><u class="${wlevel(L)}" style="width:${Math.min(100, (L / (30 * 60)) * 100)}%"></u></span></button>`; }
  for (const d of days) h += `<span class="mp-dtick" style="left:${xOf(d)}px;top:${Y0 - 12}px">${parseDate(d).getDate()}</span>`;
  if (idx(td) >= 0) h += `<div class="mp-todayv" style="left:${xOf(td)}px;top:${Y0 - 4}px;height:${ths.length * LH + 10}px"></div>`;
  ths.forEach((th, j) => {
    const y = Y0 + 14 + j * LH; const its = items.filter((n) => thread(n) === th).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
    if (its.length) svg += `<path d="M${xOf(its[0].date)},${y} L${xOf(its[its.length - 1].date)},${y}" stroke="${esc(threadColor(th))}" stroke-width="5" stroke-linecap="round" opacity=".75"/>`;
    h += `<span class="mp-lname" style="top:${y - 24}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</span>`;
    const seen = {};
    for (const n of its) { const off = (seen[n.date] = (seen[n.date] || 0) + 1) - 1; const px = xOf(n.date) + off * 8; P[n.id] = { x:px, y };
      h += `<button type="button" class="mp-st${n.fixed ? ' appt' : ''}${n.out ? ' done' : ''}${conf.has(rawId(n)) ? ' conf' : ''}${S().sel === n.id ? ' sel' : ''}" data-action="mp-sel" data-id="${esc(n.id)}" data-mpn="${esc(n.id)}" style="--c:${esc(threadColor(th))};left:${px}px;top:${y}px" title="${esc(`${n.title} · ${shortDay(n.date)} ${fmtTime(n.start)}`)}" aria-label="${esc(n.title)}"></button>`;
      if (n.fixed) h += `<span class="mp-stl" style="left:${px}px;top:${y + 12}px">${esc(n.title.split(' ').slice(0, 2).join(' '))}</span>`; }
  });
  for (const l of links) { const a = P[l.a], b = P[l.b]; if (!a || !b || a.y === b.y) continue; svg += curve(a.x, a.y + 9, b.x, b.y - 9, l.t, LT[l.t].i, false); }
  return { html:svgOf(svg) + h, w:X0 + days.length * DX + 40, h:Y0 + ths.length * LH + 40 };
}

// ---------- what's selected ----------
function infoHtml(v) {
  const s = S();
  if (ui.gr && !ui.gr.pv && node(ui.gr.from)) return `<div class="mp-info ghost">${ghostHtml()}</div>`;
  if (s.cl) {
    const [w, th] = s.cl.split('|'); const its = Array.from({ length:7 }, (_, i) => dayNodes(addDays(w, i))).flat().filter((n) => thread(n) === th && !(n.kind === 'block' && n.b.kind === 'prep'));
    return `<div class="mp-info"><h4 style="color:${esc(threadColor(th))}">${esc(threadName(th))} · ${esc(fmtDay(w, { day:'numeric', month:'short' }))} – ${esc(fmtDay(addDays(w, 6), { day:'numeric', month:'short' }))}</h4><div class="mp-ls">${its.map((n) => `<button type="button" style="--c:${esc(nodeColor(n))}" data-action="view-day" data-id="${n.date}">${esc(shortDay(n.date))} ${esc(fmtTime(n.start))} · ${n.fixed ? '📅 ' : ''}${esc(n.title)}</button>`).join('')}</div>
      <div class="mp-row"><button type="button" class="btn small primary" data-action="mp-week" data-id="${w}">${esc(t('sc_openWeek'))} ›</button><button type="button" class="btn small" data-action="mp-x">${esc(t('close'))}</button></div></div>`;
  }
  const n = s.sel && node(s.sel); if (!n) return '';
  const links = n.kind === 'block' ? linksFor([n.b]).filter((l) => l.a === n.id || l.b === n.id) : [];
  const conf = n.date ? conflictsOn(n.date).filter((c) => c.ids.includes(rawId(n))) : [];
  return `<div class="mp-info"><h4>${n.fixed ? '📅 ' : ''}${esc(n.title)}</h4><small>${esc(n.date ? `${relDay(n.date)} · ${fmtTime(n.start)}–${fmtTime(n.start + n.minutes)} · ${fmtDur(n.minutes)}` : t('gr_unplanned'))}${conf.length ? ` · ⚠ ${esc(t('nConflicts', conf.length))}` : ''}</small>
    ${links.length ? `<div class="mp-ls">${links.map((l) => { const o = node(l.a === n.id ? l.b : l.a); return o ? `<div class="mp-lk">${linkPill(l)}<span>${l.a === n.id ? '→' : '←'} ${esc(o.title)} <small>${esc(o.kind === 'pot' ? t('sc_branchSub', lname(l.t)) : when(o))}</small></span></div>` : ''; }).join('')}</div>` : ''}
    ${n.kind === 'block' && n.x && v === 'day' ? `<p class="hint mp-hint">${esc(t('mp_portsHint'))}</p>` : ''}
    <div class="mp-row">${v !== 'day' && n.date ? `<button type="button" class="btn small primary" data-action="view-day" data-id="${n.date}">${esc(t('mp_openDay'))} ›</button>` : ''}${n.kind === 'block' ? `<button type="button" class="btn small" data-action="open-block" data-id="${esc(n.id)}">${esc(t('sc_details'))} ›</button>` : n.kind === 'event' ? `<button type="button" class="btn small" data-action="event" data-id="${esc(n.raw)}">${esc(t('sc_details'))} ›</button>` : ''}<button type="button" class="btn small" data-action="mp-x">${esc(t('close'))}</button></div></div>`;
}
export function viewMappa(v, date) {
  const s = S(); const ms = v === 'month' ? s.mstyle : v;
  const key = `${v}|${v === 'day' ? date : v === 'week' ? weekStart(date) : date.slice(0, 7)}|${ms}`;
  const fresh = s.key !== key; if (fresh && s.key) { s.sel = null; s.cl = null; ui.gr = null; ui.grPill = null; }
  const m = v === 'day' ? mapDay(date) : v === 'week' ? mapWeek(date) : s.mstyle === 'lines' ? mapMonthLines(date) : mapMonthWeeks(date);
  if (fresh) {
    const vw = Math.min(window.innerWidth || 390, document.getElementById('view')?.clientWidth || 9999) - 20;
    const k = v === 'day' ? 0.8 : v === 'week' ? 0.7 : Math.min(1, Math.max(0.55, vw / m.w));
    s.pan = { k, x:6, y:v === 'day' ? -Math.max(0, (m.focusY || 0) - 10) * k : 4 }; s.key = key;
  }
  const sub = v === 'month' ? `<div class="mp-seg">${['weeks', 'lines'].map((k) => `<button type="button" class="${s.mstyle === k ? 'on' : ''}" data-action="mp-ms" data-id="${k}">${esc(t(`mp_ms_${k}`))}</button>`).join('')}</div>` : '';
  return `<section class="plan-main mp-mainw">${v === 'day' ? planCard() + behindCard(date) : planCard()}${sub}
    <div class="mp-main" id="mp-main"><div class="mp-world" id="mp-world" style="transform:translate(${s.pan.x}px,${s.pan.y}px) scale(${s.pan.k});width:${m.w}px;height:${m.h}px">${m.html}</div>
    <div class="mp-zoom"><button type="button" data-action="mp-z" data-id="1" aria-label="${esc(t('mp_zoomIn'))}">＋</button><button type="button" data-action="mp-z" data-id="-1" aria-label="${esc(t('mp_zoomOut'))}">－</button><button type="button" data-action="mp-fit" aria-label="${esc(t('mp_fit'))}">⤢</button></div>
    ${m.R && !Object.keys(m.R).length ? `<p class="mp-empty">${esc(t('agEmpty'))}</p>` : ''}</div>
    ${infoHtml(v)}</section>${overlays()}`;
}

// ---------- clicks, panning, dragging a port ----------
export function mpClick(btn) {
  const { action, id } = btn.dataset; if (!action?.startsWith('mp-')) return false;
  const s = S();
  switch (action) {
    case 'mp-sel': s.sel = s.sel === id ? null : id; s.cl = null; if (ui.gr && ui.gr.from !== id) ui.gr = null; render(); return true;
    case 'mp-x': s.sel = null; s.cl = null; ui.gr = null; render(); return true;
    case 'mp-cl': s.cl = s.cl === id ? null : id; s.sel = null; render(); return true;
    case 'mp-ms': s.mstyle = id; render(); return true;
    case 'mp-week': ui.view = 'week'; location.hash = `#/plan/${id}`; render(); return true;
    case 'mp-z': { const mn = document.getElementById('mp-main'); const r = mn?.getBoundingClientRect(); const cx = r ? r.width / 2 : 180, cy = r ? r.height / 2 : 200; const k0 = s.pan.k; const k = Math.max(0.3, Math.min(1.6, k0 + Number(id) * 0.12)); s.pan.x = cx - ((cx - s.pan.x) / k0) * k; s.pan.y = cy - ((cy - s.pan.y) / k0) * k; s.pan.k = k; render(); return true; }
    case 'mp-fit': s.key = `fit${s.key}`; render(); return true;
    default: return false;
  }
}
const drag = { pan:null, port:null, moved:false, dot:null };
// a click right after dragging the map or a port isn't a tap
export function mpDragged() { if (!drag.moved) return false; drag.moved = false; return true; }
const applyPan = () => { const w = document.getElementById('mp-world'); const s = S(); if (w) w.style.transform = `translate(${s.pan.x}px,${s.pan.y}px) scale(${s.pan.k})`; };
document.addEventListener('pointerdown', (e) => {
  const main = e.target.closest?.('#mp-main'); if (!main) return;
  drag.moved = false;
  const port = e.target.closest('[data-port]');
  if (port) { drag.port = { id:port.dataset.port, sx:e.clientX, sy:e.clientY }; e.preventDefault(); return; }
  if (e.target.closest('button,a,.mp-n,.mp-zoom')) return;
  const s = S(); drag.pan = { sx:e.clientX, sy:e.clientY, ox:s.pan.x, oy:s.pan.y };
});
document.addEventListener('pointermove', (e) => {
  if (drag.pan) { const s = S(); const dx = e.clientX - drag.pan.sx, dy = e.clientY - drag.pan.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; s.pan.x = drag.pan.ox + dx; s.pan.y = drag.pan.oy + dy; applyPan(); e.preventDefault(); return; }
  if (drag.port) {
    if (Math.abs(e.clientX - drag.port.sx) + Math.abs(e.clientY - drag.port.sy) < 8 && !drag.dot) return;
    drag.moved = true; const [, k] = drag.port.id.split('~');
    if (!drag.dot) { drag.dot = document.createElement('div'); drag.dot.className = 'mp-dragdot'; drag.dot.textContent = LT[k].i; drag.dot.style.setProperty('--pc', LT[k].c); document.body.appendChild(drag.dot); }
    drag.dot.style.left = `${e.clientX}px`; drag.dot.style.top = `${e.clientY}px`;
    for (const el of document.querySelectorAll('.mp-n.drop')) el.classList.remove('drop');
    drag.dot.hidden = true; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mpn]'); drag.dot.hidden = false;
    if (over && over.dataset.mpn !== drag.port.id.split('~')[0]) over.classList.add('drop');
    e.preventDefault();
  }
}, { passive:false });
document.addEventListener('pointerup', (e) => {
  if (drag.pan) { drag.pan = null; setTimeout(() => { drag.moved = false; }, 0); return; }
  if (!drag.port) return;
  const p = drag.port; drag.port = null;
  if (drag.dot) {
    drag.dot.hidden = true; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mpn]'); drag.dot.remove(); drag.dot = null;
    const [from, k] = p.id.split('~');
    if (over && over.dataset.mpn !== from) dropOn(from, k, over.dataset.mpn);
    setTimeout(() => { drag.moved = false; }, 0);
  }
});
