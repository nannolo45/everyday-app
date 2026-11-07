// views/mappa.js (v96): the Planner as a map (Settings → Planner → Aspetto). (v109) The same axes in every view: the
// time down the side (the hours, the days, the weeks), a column per category across (or your lanes, in the day),
// and the columns share the whole width. Two shapes for each view: Riquadri (a card per thing; in the month a box
// per category and week) or Linee (a line per category like a metro map; things at the same time make one stop).
// Tap a thing: its 7 ports around it (⤷ Prepara on top, 🔒 Prima serve left, ↓ Poi below, ‖ In parallelo right,
// ✓ bottom-left, ✕ bottom-right, ⏰ top-right). Tap a port: the ghost node (a new thing or one you have);
// drag a port onto another thing: the preview, with the guardrails.
import { catColor, catName, categories, esc, fmtDay, planSettings, relDay, toast, ui } from '../core.js';
import { t } from '../i18n.js';
import { checklistOf, conflictsOn, conflictText, outcomeOf, roomy, stepTimes } from '../model.js';
import { addDays, fmtDur, fmtTime, nowMinutes, parseDate, today } from '../plan.js';
import { changed, render } from '../shell.js';
import { get, live, saveSettings, state, upsert } from '../store.js';
import { dropOn, ghostHtml, LT, linkPill, linksFor, lname, node, PORT_POS, PORTS, when } from '../graph.js';
import { agItems, behindCard, conflictBanner, currentView, dayBand, ghostTitle, ghostWhy, planCard, prepareDays, stepName, weekStart } from './planner.js';
import { isWide } from './wide.js';
import { moveBlockTo, unplanToPane } from '../placing.js';
import { dayNodes, loadMin, nodeColor, overlays, rawId } from './scaletta.js';

const S = () => (ui.mp ||= { pan:{ x:0, y:0, k:1 }, sel:null, cl:null, mstyle:'weeks', key:'', ctx:null });
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
  const cls = `mp-n${n.fixed ? ' appt' : ''}${n.kind === 'event' ? ' gcal' : ''}${stCls(pastOf(n))}${conf.has(rawId(n)) ? ' conflict' : ''}${sel === n.id ? ' sel' : ''}${sel && sel !== n.id && !near ? ' dim' : ''}${r.h < 34 ? ' short' : ''}${r.h >= 90 ? ' tall' : ''}${extra}`;
  return `<div role="button" tabindex="0" class="${cls}" data-action="mp-sel" data-id="${esc(n.id)}" data-mpn="${esc(n.id)}" style="--c:${esc(nodeColor(n))};left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><b>${n.fixed ? '📅 ' : ''}${n.out === 'done' ? '✓ ' : ''}${esc(n.title)}</b><small>${esc(fmtTime(n.start))}${r.h > 34 ? `–${esc(fmtTime(n.start + n.minutes))}` : ''}</small>${fullCard(n)}</div>`;
}
// (v99) on hover the whole card comes forward: the full title, the time, the checklist and three quick actions
// (v109) a past thing says so: «Passato · fatto» muted (solid, nothing shows through), «Passato · da segnare» dashed
// and bright, with «Com'è andata?». The same card floats beside a stop of the Linee (o.float).
function fullCard(n, inside = '', o = {}) {
  const b = n.kind === 'block' ? n.b : null; const cl = b ? checklistOf(b) : []; const ps = pastOf(n); const id = b ? esc(b.id) : '';
  const acts = b && ps === 'pend' ? `<span class="mp-ask"><i>${esc(t('mp_howWent'))}</i><span class="mp-qa mp-qaw"><span role="button" data-action="behind-done" data-id="${id}">✓ ${esc(t('esDone'))}</span><span role="button" data-action="behind-fail" data-id="${id}">✕ ${esc(t('esFail'))}</span><span role="button" data-action="mp-unplan" data-id="${id}" title="${esc(t('mp_unplan'))}">↩ ${esc(t('mp_later'))}</span></span></span>`
    : b && n.out ? `<span class="mp-qa mp-qaw"><span role="button" data-action="block-reset" data-id="${id}">↺ ${esc(t('mp_reopen'))}</span></span>`
    : b && !ps ? `<span class="mp-qa"><span role="button" data-action="sc-done" data-id="${id}" title="${esc(t('esDone'))}">✓</span><span role="button" data-action="now-move" data-id="${id}" title="${esc(t('moveBtn'))}">🕒</span><span role="button" data-action="mp-unplan" data-id="${id}" title="${esc(t('mp_unplan'))}">↩</span>${inside !== '' && n.date ? `<span role="button" data-action="mp-addin" data-date="${esc(n.date)}" data-start="${n.start}" title="${esc(t('mp_addInside'))}">＋</span>` : ''}</span>` : '';
  const style = o.float ? ` style="--c:${esc(nodeColor(n))};${o.style || ''}"` : '';
  return `<span class="mp-full${ps ? ` is-past${ps === 'pend' ? ' pend' : ''}` : ''}${o.float ? ' mp-float' : ''}${o.cls || ''}"${style}${o.float ? '' : ' aria-hidden="true"'}>${ps ? `<em class="mp-pt">${esc(t(`mp_past_${ps}`))}</em>` : ''}<b>${n.fixed ? '📅 ' : ''}${n.out === 'done' ? '✓ ' : ''}${esc(n.title)}</b><small>${o.day ? `${esc(o.day)} · ` : ''}${esc(fmtTime(n.start))}–${esc(fmtTime(n.start + n.minutes))} · ${esc(fmtDur(n.minutes))}</small>${cl.length ? `<small>☑ ${esc(cl.slice(0, 4).join(' · '))}${cl.length > 4 ? ' …' : ''}</small>` : ''}${inside.trim() ? `<small>${esc(t('mp_inside', inside))}</small>` : ''}${acts}</span>`;
}
// (v102) «Il blocco fiorisce»: one ＋ beside the selected block instead of the seven ports; it opens the menu of the
// kinds of link (tap one, then the other thing; or drag the item onto it). Its steps come out to the right as petals.
const PXY = { top:[0.5, 0], left:[0, 0.5], bottom:[0.5, 1], right:[1, 0.5], bl:[0, 1], br:[1, 1], tr:[1, 0] };
function plusHtml(n, r) {
  if (n.kind !== 'block' || !n.x || n.out) return '';
  const x = r.x + r.w + 8, y = r.y + Math.min(r.h, 60) / 2 - 14; const open = S().plus === n.id;
  return `<button type="button" class="mp-plus${open ? ' on' : ''}" data-action="mp-plus" data-id="${esc(n.id)}" style="left:${x}px;top:${y}px" title="${esc(t('mp_link'))}" aria-label="${esc(t('mp_link'))}" aria-expanded="${open}">＋</button>${open ? `<div class="mp-plusm" style="left:${x + 36}px;top:${y}px" role="menu">${PORTS.map((k) => `<button type="button" data-action="gr-port" data-id="${esc(`${n.id}~${k}`)}" data-port="${esc(`${n.id}~${k}`)}" style="--pc:${LT[k].c}"><i>${LT[k].i}</i>${esc(lname(k))}</button>`).join('')}<hr><button type="button" data-action="block-edit" data-id="${esc(n.b.id)}"><i>▤</i>${esc(t('mp_editSteps'))}</button></div>` : ''}`;
}
function petalsHtml(n, r) {
  if (n.kind !== 'block') return { html:'', svg:'', right:0 };
  const ys = stepTimes(n.b); if (ys.length < 2) return { html:'', svg:'', right:0 };
  const cy = r.y + Math.min(r.h, 60) / 2; const x0 = r.x + r.w; const px = x0 + 52; let html = '', svg = '';
  ys.forEach((y, i) => {
    const py = cy + (i - (ys.length - 1) / 2) * 30 - 12; const dn = y.state === 'done' || n.out === 'done';
    svg += `<path d="M${x0},${cy} C${x0 + 26},${cy} ${px - 26},${py + 12} ${px},${py + 12}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3 4" fill="none" opacity=".8"/>`;
    html += `<button type="button" class="mp-pet${dn ? ' done' : ''}${y.travel ? ' trv' : ''}" data-action="ag-step" data-block="${esc(n.b.id)}" data-step="${esc(y.id)}" style="left:${px}px;top:${py}px" ${n.out ? 'disabled' : ''}><span class="ck" aria-hidden="true">${dn ? '✓' : ''}</span>${esc(stepName(y))}<small>${esc(fmtTime(y.start))}</small></button>`;
  });
  return { html, svg, right:px + 190 };
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
// (v109) where a thing stands once its time is over: its outcome (done · failed · partial), «over» (an event or an
// appointment: nothing to mark) or «pend» (a past block still without an outcome: «Com'è andata?»)
export function pastOf(n) {
  if (!n || !n.date || n.prop) return null; if (n.out) return n.out;
  const td = today(); if (n.date > td || (n.date === td && n.start + (n.minutes || 0) > nowMinutes())) return null;
  return n.kind === 'block' && !n.fixed ? 'pend' : 'over';
}
const stCls = (ps) => (ps === 'pend' ? ' pend' : ps ? ` is-${ps}` : '');
const isRt = (n) => n.kind === 'block' && (n.b.kind === 'meal' || Boolean(n.x?.repeat)); // routines: a dashed rhythm in Linee
// (v109) the map fills the width: its columns share what's there at the current zoom
function availW() { const m = document.getElementById('mp-main'); const w = m?.clientWidth || ((document.getElementById('view')?.clientWidth || window.innerWidth) - 24); S().lastW = w; return (w - 14) / (S().pan.k || 1); }

// ---------- day: the hours down, and lanes you choose (v97) ----------
// The lanes are only guides: their names are yours (Settings keeps them: mapLanes), or none, or numbers. A block
// keeps the lane you drag it to (block.lane); one you never moved goes in the first lane where it fits.
// Dragging a block up or down moves it in time (15-minute steps), sideways into another lane.
export const lanes = () => { const l = state.settings.mapLanes; return Array.isArray(l) && l.length ? l : ['', '', '']; };
const laneMode = () => state.settings.mapLaneLabels || 'custom';
export const lanesBy = () => (state.settings.mapLanesBy === 'cat' ? 'cat' : 'mine'); // (v102) your lanes, or one per category
let LW = 170; const LX0 = 56, TOP = 92, PPMD = 0.8; // (v109) LW: the lanes share the width
function placeLanes(list, n) {
  const used = Array.from({ length:n }, () => []); const at = new Map(); let extra = n;
  const fits = (l, it) => !(used[l] || []).some((o) => Boolean(o.room) === Boolean(it.room) && o.start < it.start + it.minutes && it.start < o.start + o.minutes); // (v99) side by side: a block with room inside is a background
  for (const it of list.filter((q) => q.lane != null && q.lane < n)) { used[it.lane].push(it); at.set(it.id, it.lane); }
  for (const it of list.filter((q) => !at.has(q.id))) { let l = 0; while (l < extra && !fits(l, it)) l++; if (l >= extra) extra = l + 1; (used[l] ||= []).push(it); at.set(it.id, l); }
  return { at, total:Math.max(n, extra) };
}
// the proposals of a day (from ✦ Pianifica and the routines' turns): dashed, with ✓ ✕, the same ones the Agenda lists
const propNodes = (date) => agItems(date).filter((it) => it.k === 'ghost' || it.k === 'fix').map((it) => ({ id:it.k === 'ghost' ? `g${it.g.i}` : `f${it.g.taskId}~${it.g.date}`, prop:it, date, title:it.k === 'ghost' ? ghostTitle(it.g) : it.g.title, why:it.k === 'ghost' ? ghostWhy(it.g) : t('propRoutine'), start:it.start, minutes:it.minutes, category:it.g.category || get('tasks', it.g.taskId)?.category }));
function propHtml(n, r) {
  const p = n.prop; const at = p.k === 'ghost' ? `data-i="${p.g.i}"` : `data-id="${esc(p.g.taskId)}" data-date="${p.g.date}" data-start="${p.g.start}"`;
  return `<div class="mp-n prop" style="--c:${esc(catColor(n.category) || 'var(--accent)')};left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px" title="${esc(n.why || '')}"><b>✦ ${esc(n.title)}</b><small>${esc(fmtTime(n.start))}${r.h > 40 ? `–${esc(fmtTime(n.start + n.minutes))}` : ''}${n.why ? ` · ${esc(n.why)}` : ''}</small><span class="mp-pk"><button type="button" class="ok" data-action="${p.k === 'ghost' ? 'ghost-keep' : 'fix-keep'}" ${at} aria-label="${esc(t('propKeep'))}" title="${esc(t('propKeep'))}">✓</button><button type="button" data-action="${p.k === 'ghost' ? 'ghost-rm' : 'fix-drop'}" ${at} aria-label="${esc(t('remove'))}" title="${esc(t('remove'))}">✕</button></span></div>`;
}
// (v99) things at the same time: «Sovrapposte» (as they are; hover brings one forward, whole) or «Affiancate» (they
// share the lane's width; a block with room inside becomes a dashed background with a tab, what's inside set in).
// Either way a 5px gap between one thing and the next.
const GAP = 5;
export const ovMode = () => (state.settings.mapOverlap === 'side' ? 'side' : 'over');
function layLane(mine, l, isRoom, Y, R) {
  const rooms = mine.filter(isRoom); const rest = mine.filter((n) => !isRoom(n)).sort((a, b) => a.start - b.start || b.minutes - a.minutes);
  for (const n of rooms) R[n.id] = { x:LX0 + l * LW + 5, y:Y(n.start), w:LW - 10, h:Math.max(38, n.minutes * PPMD - GAP), n, room:true };
  // columns only for things that really overlap in time; short ones that touch only through their minimum height move down a little
  const groups = []; for (const n of rest) { const g = groups.find((gr) => gr.some((o) => n.start < o.start + o.minutes && o.start < n.start + n.minutes)); if (g) g.push(n); else groups.push([n]); }
  let floor = 0;
  for (const g of groups) {
    const cols = []; const col = new Map(); for (const n of g) { let c = cols.findIndex((end) => end <= n.start); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = n.start + n.minutes; col.set(n, c); }
    let gb = 0; const top = Math.max(Y(g[0].start), floor);
    for (const n of g) {
      const nest = rooms.some((o) => n.start >= o.start && n.start < o.start + o.minutes); const L0 = nest ? 32 : 8, R0 = nest ? 11 : 8;
      const w = (LW - L0 - R0 - (cols.length - 1) * 6) / cols.length; const y = Math.max(Y(n.start), top, floor); const hh = Math.max(30, n.minutes * PPMD - GAP);
      R[n.id] = { x:LX0 + l * LW + L0 + col.get(n) * (w + 6), y, w, h:hh, n }; gb = Math.max(gb, y + hh);
    }
    floor = gb + GAP;
  }
}
function roomHtml(n, r, conf, inside) {
  const sel = S().sel;
  return `<div class="mp-n mp-room${n.out ? ` is-${n.out}` : ''}${conf.has(rawId(n)) ? ' conflict' : ''}${sel === n.id ? ' sel' : ''}${!n.out ? ' drag' : ''}" data-id="${esc(n.id)}" data-mpn="${esc(n.id)}" style="--c:${esc(nodeColor(n))};left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><div role="button" tabindex="0" class="mp-rtab" data-action="mp-sel" data-id="${esc(n.id)}" title="${esc(n.title)}">⊕ ${esc(n.title)}</div><small class="mp-rsub">${esc(fmtTime(n.start))}–${esc(fmtTime(n.start + n.minutes))} · ${esc(t('mp_room'))}</small>${fullCard(n, inside || ' ')}</div>`;
}
function mapDay(date) {
  const ps = planSettings(); const ns = dayNodes(date); const td = today();
  const props = propNodes(date);
  const all = [...ns, ...props];
  const minS = Math.min(ps.dayStart, ...all.map((n) => n.start)); const maxE = Math.max(ps.dayEnd, ...all.map((n) => n.start + n.minutes));
  const h0 = Math.floor(minS / 60) * 60, h1 = Math.ceil(maxE / 60) * 60;
  const links = linksFor(ns.filter((n) => n.kind === 'block').map((n) => n.b)); const conf = confSet([date]);
  const confTxt = {}; for (const c of conflictsOn(date)) for (const id of c.ids) (confTxt[id] ||= []).push(conflictText(c));
  const Y = (m) => TOP + (m - h0) * PPMD; const byCat = lanesBy() === 'cat';
  const TH = byCat ? orderThreads(new Set(all.map((n) => thread(n)))) : null;
  const L = byCat ? TH.map(threadName) : lanes(); const mode = byCat ? 'cat' : laneMode();
  const sideBy = ovMode() === 'side'; const isRoom = (n) => sideBy && n.kind === 'block' && roomy(n.b);
  const { at, total } = placeLanes(all.map((n) => ({ id:n.id, start:n.start, minutes:n.minutes, lane:byCat ? TH.indexOf(thread(n)) : n.kind === 'block' ? n.b.lane : null, room:isRoom(n) })), L.length);
  LW = Math.max(150, Math.floor((availW() - LX0 - (byCat ? 16 : 130)) / Math.max(1, total)));
  let h = '', svg = ''; const R = {};
  const H = Y(h1) + 30;
  for (let i = 0; i < total; i++) {
    h += `<div class="mp-lanebg${i % 2 ? ' alt' : ''}${i >= L.length ? ' over' : ''}" style="left:${LX0 + i * LW}px;width:${LW}px;height:${H}px"></div>`;
    if (byCat) h += `<div class="mp-lanel bycat" style="left:${LX0 + i * LW}px;width:${LW}px;--c:${esc(threadColor(TH[i]))}"><span>${esc(L[i])}</span></div>`;
    else if (i < L.length && mode !== 'none') h += `<div class="mp-lanel" style="left:${LX0 + i * LW}px;width:${LW}px">${mode === 'num' ? `<span>${i + 1}</span>` : `<input data-lanename="${i}" value="${esc(L[i])}" placeholder="${esc(t('mp_laneN', i + 1))}" aria-label="${esc(t('mp_laneName'))}">`}${L.length > 1 ? `<button type="button" data-action="mp-lrm" data-id="${i}" title="${esc(t('mp_laneRm'))}" aria-label="${esc(t('mp_laneRm'))}">✕</button>` : ''}</div>`;
  }
  if (!byCat) h += `<button type="button" class="mp-laneadd" data-action="mp-ladd" style="left:${LX0 + total * LW + 8}px">＋ ${esc(t('mp_laneAdd'))}</button>`;
  for (let m = h0; m <= h1; m += 60) h += `<div class="mp-hline" style="top:${Y(m)}px"><span>${esc(fmtTime(m % 1440))}</span></div>`;
  if (date === td) h += `<div class="mp-hline mp-now" style="top:${Y(nowMinutes())}px"></div>`;
  const NW = LW - 16;
  if (!sideBy) for (const n of all) { const l = at.get(n.id); R[n.id] = { x:LX0 + l * LW + 8, y:Y(n.start), w:NW, h:Math.max(38, n.minutes * PPMD - GAP), n }; }
  else for (let l = 0; l < total; l++) layLane(all.filter((n) => at.get(n.id) === l), l, isRoom, Y, R);
  for (const r of Object.values(R)) {
    const n = r.n;
    if (n.prop) { h += propHtml(n, r); continue; }
    if (r.room) { h += roomHtml(n, r, conf, all.filter((o) => o !== n && !isRoom(o) && o.start >= n.start && o.start < n.start + n.minutes).map((o) => o.title).join(' · ')); continue; }
    const msgs = confTxt[rawId(n)] || [];
    h += nodeHtml(n, r, conf, links, `${n.kind === 'block' && !n.out ? ' drag' : ''}${total === 1 ? ' edge-in' : at.get(n.id) === total - 1 ? ' edge-r' : ''}`).replace('<b>', `${msgs.length ? `<span class="mp-bdg" title="${esc(msgs.join('\n'))}">!</span>` : ''}<b>`).replace('data-action="mp-sel"', `data-action="mp-sel"${msgs.length ? ` title="${esc(msgs.join(' · '))}"` : ''}`);
  }
  // (v102) linked things: with a block selected, only its links, labelled, and what's on other days (or unplanned)
  // as dashed cards out to its right; with nothing selected, the links stay as faint lines
  const sid = S().sel; const selR = sid ? R[sid] : null; const bottom = H + 10;
  const pet = selR ? petalsHtml(selR.n, selR) : { html:'', svg:'', right:0 };
  const mine = sid ? links.filter((l) => l.a === sid || l.b === sid) : links;
  let gi = 0, sr = 0;
  for (const l of mine) {
    if (!selR) break;
    const oid = l.a === sid ? l.b : l.a; if (R[oid]) continue; const o = node(oid); if (!o) continue;
    const x = (pet.right || selR.x + selR.w + 52) + 16; const y = selR.y - 30 + gi * 52; gi++;
    R[oid] = { x, y, w:NW, h:42, n:o, stub:true }; sr = Math.max(sr, x + NW);
    const sub = o.kind === 'pot' ? t('sc_branchSub', lname(l.t)) : o.date ? `${relDay(o.date)} ${fmtTime(o.start)} · ${t('mp_go')}` : t('gr_unplanned');
    h += o.date ? `<a class="mp-n stub bloom" href="#/plan/${esc(o.date)}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${y}px;width:${NW}px;height:42px"><b>${LT[l.t].i} ${esc(o.title)}</b><small>${esc(sub)}</small></a>`
      : `<div class="mp-n stub bloom${o.kind === 'pot' ? ' pot' : ''}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${x}px;top:${y}px;width:${NW}px;height:42px"><b>${LT[l.t].i} ${esc(o.title)}</b><small>${esc(sub)}</small></div>`;
  }
  let faint = '';
  for (const l of mine) { const a = R[l.a], b = R[l.b]; if (!a || !b) continue; const hz = l.t === 'par' || Math.abs(a.y - b.y) < 20 || a.stub || b.stub; const bad = l.t !== 'par' && a.n.date && b.n.date && (a.n.date > b.n.date || (a.n.date === b.n.date && a.n.start + a.n.minutes > b.n.start)) && !l.b.startsWith('pot:');
    const tt = bad ? 'ko' : l.t; const lab = selR ? `${LT[l.t].i}${bad ? ' ⚠' : ''}${l.l ? ` ${l.l}` : ''} ${lname(l.t)}` : '';
    const stb = a.stub ? a : b.stub ? b : null; const ra = stb ? R[sid] : a; const rb = stb || b;
    const c = stb ? curve(ra.x + ra.w, ra.y + Math.min(ra.h, 60) / 2 - 8, rb.x, rb.y + 21, tt, lab, true) : hz ? curve(ra.x + ra.w, ra.y + Math.min(ra.h, 60) / 2, rb.x, rb.y + Math.min(rb.h, 42) / 2, tt, lab, true) : ra.y <= rb.y ? curve(ra.x + ra.w / 2, ra.y + ra.h, rb.x + rb.w / 2, rb.y, tt, lab, false) : curve(ra.x + ra.w / 2, ra.y, rb.x + rb.w / 2, rb.y + rb.h, tt, lab, false);
    if (selR) svg += c; else faint += c; }
  svg += pet.svg;
  const sel = R[S().sel];
  geo = { Y, h0, total, date, cat:byCat };
  return { html:(faint ? `<svg class="mp-links faint" width="10" height="10">${faint}</svg>` : '') + svgOf(svg) + h + pet.html + (sel && !sel.n.prop ? plusHtml(sel.n, sel) : '') + ghostNode(R), w:Math.max(LX0 + total * LW + (byCat ? 16 : 130), pet.right + 40, sr + 20, 340), h:bottom + 40, R, links, geo:{ Y, h0, LW, LX0, total, date }, focusY:all.length ? Y(Math.max(h0, Math.min(...all.map((n) => n.start)) - 30)) : Y(ps.dayStart) };
}

// ---------- week (v109): a row per day, a column per category ----------
function mapWeek(date) {
  const w0 = weekStart(date); const days = Array.from({ length:7 }, (_, i) => addDays(w0, i)); const td = today();
  const byDay = days.map((d) => [...dayNodes(d).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep')), ...propNodes(d)].sort((a, b) => a.start - b.start));
  const all = byDay.flat(); const TH = orderThreads(new Set(all.map(thread)));
  const X0 = 104, Y0 = 34, NH = 40, G = 6; const CW = Math.max(118, (availW() - X0 - 8) / Math.max(1, TH.length)); const NW = CW - 12; const right = X0 + TH.length * CW;
  let h = '', svg = ''; const R = {}; const links = linksFor(all.filter((n) => n.kind === 'block').map((n) => n.b)); const conf = confSet(days); const max = planSettings().maxLoad;
  TH.forEach((th, j) => { h += `<div class="mp-thh" style="left:${X0 + j * CW}px;width:${CW}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</div>`; });
  let y = Y0;
  days.forEach((d, i) => {
    const cells = TH.map((th) => byDay[i].filter((n) => thread(n) === th)); const RH = Math.max(1, ...cells.map((c) => c.length)) * (NH + G) + 12; const ld = loadMin(d);
    h += `<div class="mp-wrow${d === td ? ' cur' : ''}${i > 4 ? ' we' : ''}" style="top:${y}px;height:${RH}px;width:${right + 4}px"></div><button type="button" class="mp-wlab mp-dlab${d === td ? ' is-today' : ''}" data-action="view-day" data-id="${d}" style="top:${y + 8}px"><b>${esc(fmtDay(d, { weekday:'short' }))} ${parseDate(d).getDate()}</b><small>${esc(fmtDur(ld) || '—')}${d === td ? ` · ${esc(t('today').toLowerCase())}` : ''}</small><i><u class="${ld > max ? 'veryfull' : ''}" style="width:${Math.min(100, (ld / max) * 100)}%"></u></i></button>`;
    cells.forEach((c, j) => c.forEach((n, k) => { R[n.id] = { x:X0 + j * CW + 6, y:y + 6 + k * (NH + G), w:NW, h:NH, n, j }; }));
    y += RH;
  });
  const H = y;
  for (const r of Object.values(R)) h += r.n.prop ? propHtml(r.n, r) : nodeHtml(r.n, r, conf, links, TH.length === 1 ? ' edge-in' : r.j === TH.length - 1 || (TH.length > 3 && r.j === TH.length - 2) ? ' edge-r' : '');
  // linked things outside the week: a row of stubs under it
  let sx = X0;
  for (const l of links) {
    const ia = Boolean(R[l.a]), ib = Boolean(R[l.b]); if (ia === ib) continue; const oid = ia ? l.b : l.a; if (R[oid]) continue; const o = node(oid); if (!o) continue;
    const yy = H + 14; R[oid] = { x:sx, y:yy, w:NW, h:40, n:o }; sx += CW;
    h += o.date ? `<a class="mp-n stub" href="#/plan/${esc(o.date)}" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${R[oid].x}px;top:${yy}px;width:${NW}px;height:40px"><b>${esc(o.title)}</b><small>${esc(shortDay(o.date))}</small></a>`
      : `<div class="mp-n stub pot" data-mpn="${esc(oid)}" style="--c:${esc(nodeColor(o))};left:${R[oid].x}px;top:${yy}px;width:${NW}px;height:40px"><b>${LT[l.t].i} ${esc(o.title)}</b><small>${esc(o.kind === 'pot' ? lname(l.t) : t('gr_unplanned'))}</small></div>`;
  }
  for (const l of links) { const a = R[l.a], b = R[l.b]; if (!a || !b) continue; const hz = Math.abs(a.y - b.y) < NH; svg += hz ? (a.x < b.x ? curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2, l.t, LT[l.t].i, true) : curve(a.x, a.y + a.h / 2, b.x + b.w, b.y + b.h / 2, l.t, LT[l.t].i, true)) : a.y < b.y ? curve(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, l.t, LT[l.t].i, false) : curve(a.x + a.w / 2, a.y, b.x + b.w / 2, b.y + b.h, l.t, LT[l.t].i, false); }
  const sel = R[S().sel];
  return { html:svgOf(svg) + h + (sel ? plusHtml(sel.n, sel) : '') + ghostNode(R), w:Math.max(right + 10, sx), h:H + (sx > X0 ? 80 : 30), R, links };
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
const weekLab = (w, y, extra = '') => { const td = today(); const L = weekLoad(w); return `<button type="button" class="mp-wlab" data-action="mp-week" data-id="${w}" style="top:${y}px" title="${esc(t('sc_openWeek'))}"><b>${parseDate(w).getDate()}–${parseDate(addDays(w, 6)).getDate()}</b><small>${esc(fmtDur(L) || '—')} · ${esc(t(`sc_wl_${wlevel(L)}`))}${extra}</small><i><u class="${wlevel(L)}" style="width:${Math.min(100, (L / (30 * 60)) * 100)}%"></u></i></button>${weekStart(td) === w ? '' : ''}`; };
function mapMonthWeeks(date) {
  const { ws, items, ths, links } = monthData(date); const td = today(); const LW0 = 112, RH = 84, Y0 = 30; const CW = Math.max(100, (availW() - LW0 - 8) / Math.max(1, ths.length)); const BW = CW - 8, BH = RH - 16;
  let h = '', svg = ''; const C = {};
  const conf = confSet(items.map((n) => n.date).filter((d, i, a) => a.indexOf(d) === i));
  ths.forEach((th, j) => { h += `<div class="mp-thh" style="left:${LW0 + j * CW}px;width:${BW}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</div>`; });
  ws.forEach((w, r) => {
    const y = Y0 + r * RH; const cur = weekStart(td) === w; const cf = items.some((n) => n.date >= w && n.date <= addDays(w, 6) && conf.has(rawId(n)));
    h += `<div class="mp-wrow${cur ? ' cur' : ''}" style="top:${y - 4}px;height:${RH}px;width:${LW0 + Math.max(1, ths.length) * CW + 4}px"></div>${weekLab(w, y + 6, cf ? ' · <em>⚠</em>' : '')}`;
    ths.forEach((th, j) => {
      const its = items.filter((n) => thread(n) === th && n.date >= w && n.date <= addDays(w, 6)); if (!its.length) return;
      const x = LW0 + j * CW; const key = `${w}|${th}`; C[key] = { x, y, w:BW, h:BH };
      const ap = its.filter((n) => n.fixed).length; const warn = its.some((n) => conf.has(rawId(n))); const inner = links.filter((l) => its.some((n) => n.id === l.a) && its.some((n) => n.id === l.b)).length;
      const pss = its.map(pastOf); const anyPend = pss.includes('pend'); const allPast = pss.every(Boolean);
      const tt = its.length > 1 && BW >= 140 ? [...new Set(its.filter((n) => !isRt(n)).map((n) => n.title))].slice(0, 3).join(', ') : '';
      const card = listCard([...its].sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : p.start - q.start)), { th, byDay:true, max:12, title:`${threadName(th)} · ${parseDate(w).getDate()}–${parseDate(addDays(w, 6)).getDate()}`, sub:t('mp_things', its.length), foot:`<span role="button" class="mp-go" data-action="mp-week" data-id="${w}">${esc(t('sc_openWeek'))} ›</span>` });
      const edge = j === ths.length - 1 || (ths.length > 3 && j === ths.length - 2) ? ' edge-r' : '';
      h += `<div role="button" tabindex="0" class="mp-cl${S().cl === key ? ' sel' : ''}${warn ? ' warn' : ''}${anyPend ? ' pend' : allPast ? ' is-past' : ''}${edge}" data-action="mp-cl" data-id="${esc(key)}" style="--c:${esc(threadColor(th))};left:${x}px;top:${y}px;width:${BW}px;height:${BH}px">${card}<b>${its.length === 1 ? esc(its[0].title) : esc(t('mp_things', its.length))}</b><small>${ap ? `📅 ${ap} · ` : ''}${esc(fmtDur(its.reduce((s2, n) => s2 + n.minutes, 0)))}${inner ? ` · ${esc(t('mp_links', inner))}` : ''}</small>${tt ? `<small class="tt">${esc(tt)}</small>` : ''}<span class="dots">${Array.from({ length:7 }, (_, i) => { const q = its.filter((n) => n.date === addDays(w, i)); return `<span class="${q.length ? (q.some((n) => n.fixed) ? 'ap' : 'on') : ''}"></span>`; }).join('')}</span></div>`;
    });
  });
  const agg = {};
  for (const l of links) { const a = node(l.a), b = node(l.b); if (!a?.date || !b?.date) continue; const wa = weekStart(a.date), wb = weekStart(b.date); if (wa === wb && thread(a) === thread(b)) continue; const k = `${wa}|${thread(a)}>${wb}|${thread(b)}`; (agg[k] ||= { from:`${wa}|${thread(a)}`, to:`${wb}|${thread(b)}`, n:0, t:l.t }).n++; }
  for (const g of Object.values(agg)) { const A = C[g.from], B = C[g.to]; if (!A || !B) continue; svg += A.y === B.y ? curve(A.x + A.w, A.y + 30, B.x, B.y + 30, g.t, g.n > 1 ? `${g.n}` : LT[g.t].i, true) : curve(A.x + A.w / 2, A.y + A.h, B.x + B.w / 2, B.y, g.t, g.n > 1 ? t('mp_links', g.n) : LT[g.t].i, false); }
  return { html:svgOf(svg) + h, w:LW0 + Math.max(1, ths.length) * CW + 10, h:Y0 + ws.length * RH + 10 };
}

// ---------- (v109) Linee, in every view: the time down the side, a line per category ----------
// Things in the same day (the same few minutes, in the day view) make one stop with their number; routines are a thin
// dashed rhythm; a stop opens its card on hover (a tap pins it); links show only for the pinned stop.
let STN = {};
function linesMap(v, date) {
  const s = S(); const td = today(); const HEAD = 34, DH = 22, RH = 80; STN = {}; // (v111) bigger stops, taller day rows in the month
  let items = [], yOf, H, days = [], ws = [], h0 = 0, P = 0.9;
  if (v === 'day') {
    items = dayNodes(date).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep'));
    const ps = planSettings(); h0 = Math.floor(Math.min(ps.dayStart, ...items.map((n) => n.start)) / 60) * 60; const h1 = Math.ceil(Math.max(ps.dayEnd, ...items.map((n) => n.start + n.minutes)) / 60) * 60;
    yOf = (n) => HEAD + 14 + (n.start - h0) * P; H = HEAD + 14 + (h1 - h0) * P + 24; days = [date];
  } else if (v === 'week') {
    const w0 = weekStart(date); days = Array.from({ length:7 }, (_, i) => addDays(w0, i));
    items = days.flatMap((d) => dayNodes(d).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep')));
    yOf = (n) => HEAD + days.indexOf(n.date) * RH + RH / 2; H = HEAD + 7 * RH + 16;
  } else { const md = monthData(date); ws = md.ws; days = md.days; items = md.items; yOf = (n) => HEAD + days.indexOf(n.date) * DH + DH / 2; H = HEAD + days.length * DH + 16; }
  const TH = orderThreads(new Set(items.map(thread))); const X0 = v === 'month' ? 116 : v === 'week' ? 104 : 60;
  const CW = Math.max(110, (availW() - X0 - 8) / Math.max(1, TH.length)); const WW = X0 + Math.max(1, TH.length) * CW + 8;
  s.worldW = WW; s.worldH = H;
  let h = '', svg = '';
  TH.forEach((th, j) => { h += `<div class="mp-thh" style="left:${X0 + j * CW}px;width:${CW}px;color:${esc(threadColor(th))}">${esc(threadName(th))}</div>`; });
  // the time down the side
  if (v === 'day') {
    const h1 = h0 + (H - HEAD - 38) / P;
    for (let m = h0; m <= h1 + 1; m += 60) h += `<div class="mp-hline" style="top:${HEAD + 14 + (m - h0) * P}px"><span>${esc(fmtTime(m % 1440))}</span></div>`;
    if (date === td) h += `<div class="mp-hline mp-now" style="top:${HEAD + 14 + (nowMinutes() - h0) * P}px"></div>`;
  } else if (v === 'week') {
    const max = planSettings().maxLoad;
    days.forEach((d, i) => { const ld = loadMin(d); h += `<div class="mp-wrow${d === td ? ' cur' : ''}${i > 4 ? ' we' : ''}" style="top:${HEAD + i * RH}px;height:${RH}px;width:${WW}px"></div><button type="button" class="mp-wlab mp-dlab${d === td ? ' is-today' : ''}" data-action="view-day" data-id="${d}" style="top:${HEAD + i * RH + 10}px"><b>${esc(fmtDay(d, { weekday:'short' }))} ${parseDate(d).getDate()}</b><small>${esc(fmtDur(ld) || '—')}</small><i><u class="${ld > max ? 'veryfull' : ''}" style="width:${Math.min(100, (ld / max) * 100)}%"></u></i></button>`; });
    const ti = days.indexOf(td); if (ti >= 0) { const ps = planSettings(); const f = Math.max(0, Math.min(1, (nowMinutes() - ps.dayStart) / Math.max(60, ps.dayEnd - ps.dayStart))); h += `<div class="mp-hline mp-now" style="top:${HEAD + ti * RH + 8 + f * (RH - 16)}px;left:${X0 - 8}px"></div>`; }
  } else {
    ws.forEach((w, r) => { h += `<div class="mp-wrow${weekStart(td) === w ? ' cur' : ''}" style="top:${HEAD + r * 7 * DH}px;height:${7 * DH}px;width:${WW}px"></div>${weekLab(w, HEAD + r * 7 * DH + 6)}`; });
    days.forEach((d, i) => { h += `<button type="button" class="mp-dtk${d === td ? ' is-today' : ''}" data-action="view-day" data-id="${d}" style="top:${HEAD + i * DH}px;left:${X0 - 30}px;height:${DH}px">${parseDate(d).getDate()}</button>`; });
    const ti = days.indexOf(td); if (ti >= 0) h += `<div class="mp-hline mp-now" style="top:${HEAD + ti * DH + DH / 2}px;left:${X0 - 6}px"></div>`;
  }
  const conf = confSet(days); const pos = {}; const pin = s.pin;
  TH.forEach((th, j) => {
    const x = X0 + j * CW + 26; const c = threadColor(th);
    const its = items.filter((n) => thread(n) === th).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
    const groups = [];
    for (const n of its) { const y = yOf(n); const g = groups[groups.length - 1]; if (g && (v === 'day' ? y - g.y < 22 : g.date === n.date)) g.ns.push(n); else groups.push({ y, date:n.date, ns:[n] }); }
    const full = groups.filter((g) => !g.ns.every(isRt)); const rt = groups.filter((g) => g.ns.every(isRt));
    if (full.length > 1) h += `<div class="mp-trk" style="--c:${esc(c)};left:${x}px;top:${full[0].y}px;height:${full[full.length - 1].y - full[0].y}px"></div>`;
    if (rt.length > 1) h += `<div class="mp-rhy" style="--c:${esc(c)};left:${x}px;top:${rt[0].y}px;height:${rt[rt.length - 1].y - rt[0].y}px"></div>`;
    let lastL = -1e9;
    groups.forEach((g, gi) => {
      const key = `${th}|${g.date}|${gi}`; const n = g.ns.length; const tiny = g.ns.every(isRt);
      const pss = g.ns.map(pastOf); const pend = pss.includes('pend'); const done = !pend && pss.every(Boolean); const fx = g.ns.find((q) => q.fixed); const cf = g.ns.some((q) => conf.has(rawId(q)));
      const sz = v === 'month' ? (tiny ? 10 : n === 1 ? 18 : Math.min(24, 19 + n)) : tiny ? 12 : n === 1 ? (fx ? 26 : 24) : Math.min(40, 28 + n * 2);
      STN[key] = { ids:g.ns.map((q) => q.id), date:g.date, x, y:g.y, th, sz }; for (const q of g.ns) pos[q.id] = key;
      h += `<button type="button" class="mp-sta${tiny ? ' rt' : ''}${fx ? ' appt' : ''}${done ? ' is-past' : ''}${pend ? ' pend' : ''}${cf ? ' conf' : ''}${pin === key ? ' sel' : ''}" data-action="mp-stn" data-id="${esc(key)}" data-mpk="${esc(key)}" style="--c:${esc(c)};left:${x}px;top:${g.y}px;width:${sz}px;height:${sz}px" aria-label="${esc(g.ns.map((q) => q.title).join(', '))}">${n > 1 && !tiny ? n : ''}</button>`;
      const f = g.ns[0]; let lab = '';
      if (v === 'month') { if (fx && g.y - lastL >= DH * 3) lab = `${esc(fx.title)}${n > 1 ? ` <small>+${n - 1}</small>` : ''}`; }
      else if (!tiny) lab = n === 1 ? `${esc(f.title)} <small>· ${esc(fmtTime(f.start))}</small>` : `${esc((fx || f).title)} <small>+${n - 1}${v === 'day' ? ` · ${esc(fmtTime(f.start))}` : ''}</small>`;
      if (lab) { lastL = g.y; h += `<span class="mp-stal${done ? ' is-past' : ''}" style="left:${x + sz / 2 + 7}px;top:${g.y}px;max-width:${Math.max(40, CW - sz / 2 - 36)}px">${lab}</span>`; }
    });
  });
  if (pin && STN[pin]) {
    const g = STN[pin]; const ls = linksFor(g.ids.map(node).filter((q) => q?.kind === 'block').map((q) => q.b));
    for (const l of ls) { const mine = g.ids.includes(l.a) ? l.a : g.ids.includes(l.b) ? l.b : null; if (!mine) continue; const ok = pos[mine === l.a ? l.b : l.a]; const o = ok && STN[ok]; if (!o || ok === pin) continue; svg += curve(g.x, g.y, o.x, o.y, l.t, LT[l.t].i, Math.abs(g.y - o.y) < 20); }
    h += stnCard(pin, true);
  } else if (pin) s.pin = null;
  return { html:svgOf(svg) + h, w:WW, h:H, R:items.length ? { any:1 } : {} };
}
// the card of a stop: one thing → its card; more → the list (✓ ✕ ↺ on each row), «Apri il giorno»
function stnCard(key, pin = false) {
  const g = STN[key]; if (!g) return ''; const ns = g.ids.map(node).filter(Boolean); if (!ns.length) return '';
  const s = S(); const v = currentView(); const day = v === 'day' ? '' : shortDay(g.date);
  const fx = g.x + 310 > (s.worldW || 9999); const fy = g.y + 230 > (s.worldH || 9999) && g.y > 230;
  const o2 = (g.sz || 18) / 2 + 10; const style = `left:${fx ? g.x - o2 : g.x + o2}px;top:${fy ? g.y + 14 : g.y - 16}px;${fx || fy ? `transform:${fx ? 'translateX(-100%)' : ''} ${fy ? 'translateY(-100%)' : ''};` : ''}`;
  const cls = pin ? ' pin' : '';
  if (ns.length === 1) return fullCard(ns[0], '', { float:true, style, day, cls });
  return listCard(ns, { th:g.th, cls:` mp-float${cls}`, style, title:`${t('mp_things', ns.length)}${day ? ` · ${day}` : ''}`, foot:v !== 'day' ? `<span role="button" class="mp-go" data-action="view-day" data-id="${g.date}">${esc(t('mp_openDay'))} ›</span>` : '' });
}
// (v111) a row of a list card: its time and title (a tap opens it) and, on hover, ✓ 🕒 · ✓ ✕ (to mark) · ↺ (done)
function rowHtml(q) {
  const ps = pastOf(q); const b = q.kind === 'block' ? q.b : null; const id = b ? esc(b.id) : '';
  const qa = !b ? '' : ps === 'pend' ? `<span role="button" data-action="behind-done" data-id="${id}" title="${esc(t('esDone'))}">✓</span><span role="button" data-action="behind-fail" data-id="${id}" title="${esc(t('esFail'))}">✕</span>`
    : q.out ? `<span role="button" data-action="block-reset" data-id="${id}" title="${esc(t('mp_reopen'))}">↺</span>` : ps ? '' : `<span role="button" data-action="sc-done" data-id="${id}" title="${esc(t('esDone'))}">✓</span><span role="button" data-action="now-move" data-id="${id}" title="${esc(t('moveBtn'))}">🕒</span>`;
  const open = b ? `data-action="open-block" data-id="${id}"` : q.kind === 'event' ? `data-action="event" data-id="${esc(q.raw)}"` : '';
  return `<span class="mp-hr${ps === 'pend' ? ' pend' : ps ? ' is-past' : ''}"><span role="button" class="mp-hro" ${open}><i>${esc(fmtTime(q.start))}</i><em>${q.fixed ? '📅 ' : ''}${q.out === 'done' ? '✓ ' : ''}${esc(q.title)}</em></span>${qa ? `<span class="mp-hq">${qa}</span>` : ''}</span>`;
}
// a list card: a stop with more things, a box of the month (by day, with o.byDay)
function listCard(ns, o) {
  const pss = ns.map(pastOf); const allPast = pss.every(Boolean); const np = pss.filter((p) => p === 'pend').length; const tot = ns.reduce((a, q) => a + (q.minutes || 0), 0);
  let rows = ''; let last = ''; const shown = ns.slice(0, o.max || 99);
  for (const q of shown) { if (o.byDay && q.date !== last) { rows += `<span class="mp-dh">${esc(shortDay(q.date))}</span>`; last = q.date; } rows += rowHtml(q); }
  if (ns.length > shown.length) rows += `<span class="mp-dh">${esc(t('mp_more', ns.length - shown.length))}</span>`;
  return `<span class="mp-full mp-multi${allPast ? ` is-past${np ? ' pend' : ''}` : ''}${o.cls || ''}" style="--c:${esc(threadColor(o.th))};${o.style || ''}"${o.cls?.includes('mp-float') ? '' : ' aria-hidden="true"'}>${allPast ? `<em class="mp-pt">${esc(t(np ? 'mp_past_pend' : 'mp_past_over'))}</em>` : ''}<b>${esc(o.title)}</b><small>${o.sub ? `${esc(o.sub)} · ` : `${esc(threadName(o.th))} · `}${esc(fmtDur(tot))}${np ? ` · <span class="mp-np">${esc(t('mp_nPend', np))}</span>` : ''}</small><span class="mp-rows">${rows}</span>${o.foot || ''}</span>`;
}
// hover (a mouse): the card of the stop under the pointer; it stays while the pointer moves into it
let hovT = 0;
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (e.target.closest?.('#mp-hov')) { clearTimeout(hovT); return; }
  const st = e.target.closest?.('#mp-world .mp-sta'); if (!st) return;
  const key = st.dataset.mpk; clearTimeout(hovT); if (S().pin === key) return;
  const old = document.getElementById('mp-hov'); if (old?.dataset.k === key) return; old?.remove();
  const html = stnCard(key); const w = document.getElementById('mp-world'); if (!html || !w) return;
  w.insertAdjacentHTML('beforeend', html); const el = w.lastElementChild; el.id = 'mp-hov'; el.dataset.k = key;
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const from = e.target.closest?.('#mp-world .mp-sta, #mp-hov'); if (!from) return;
  const to = e.relatedTarget; if (to && (to.closest?.('#mp-hov') || from.contains(to))) return;
  clearTimeout(hovT); hovT = setTimeout(() => document.getElementById('mp-hov')?.remove(), 160);
});

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
  return `<div class="mp-info"><h4>${n.fixed ? '📅 ' : ''}${esc(n.title)}<button type="button" class="icon mp-ix" data-action="mp-x" aria-label="${esc(t('close'))}">✕</button></h4><small>${esc(n.date ? `${relDay(n.date)} · ${fmtTime(n.start)}–${fmtTime(n.start + n.minutes)} · ${fmtDur(n.minutes)}` : t('gr_unplanned'))}${conf.length ? ` · ⚠ ${esc(t('nConflicts', conf.length))}` : ''}</small>
    ${links.length ? `<div class="mp-ls">${links.map((l) => { const o = node(l.a === n.id ? l.b : l.a); return o ? `<div class="mp-lk">${linkPill(l)}<span>${l.a === n.id ? '→' : '←'} ${esc(o.title)} <small>${esc(o.kind === 'pot' ? t('sc_branchSub', lname(l.t)) : when(o))}</small></span></div>` : ''; }).join('')}</div>` : ''}
    ${n.kind === 'block' ? blockExtras(n) : ''}
    <div class="mp-row">${v !== 'day' && n.date ? `<button type="button" class="btn small primary" data-action="view-day" data-id="${n.date}">${esc(t('mp_openDay'))} ›</button>` : ''}${n.kind === 'block' ? `<button type="button" class="btn small ghost" data-action="open-block" data-id="${esc(n.id)}">${esc(t('sc_details'))} ›</button>` : n.kind === 'event' ? `<button type="button" class="btn small" data-action="event" data-id="${esc(n.raw)}">${esc(t('sc_details'))} ›</button>` : ''}</div></div>`;
}
// (v98) a block's details (in the side pane on a wide screen, in a sheet on the phone): checklist, the 7 ports as
// buttons, and the Esito / Sposta
function blockExtras(n) {
  const b = n.b; const st = outcomeOf(b); const cl = checklistOf(b); const ck = b.checked || []; const ys = stepTimes(b);
  return `${ys.length > 1 ? `<div class="mp-chk">${ys.map((y) => `<label><input type="checkbox" data-action="step-done" data-block="${esc(b.id)}" data-step="${esc(y.id)}" ${y.state === 'done' || st === 'done' ? 'checked' : ''} ${st ? 'disabled' : ''}> <span>${esc(stepName(y))} <small>${esc(fmtTime(y.start))}</small></span></label>`).join('')}</div>` : ''}
    ${cl.length ? `<div class="mp-chk">${cl.map((c, i) => `<label><input type="checkbox" data-ci="${i}" data-block="${esc(b.id)}" ${ck[i] ? 'checked' : ''} ${st ? 'disabled' : ''}> <span>${esc(c)}</span></label>`).join('')}</div>` : ''}
    <div class="mp-row mp-acts">${!st ? `<button type="button" class="btn small primary" data-action="sc-done" data-id="${esc(b.id)}">✓ ${esc(t('esDone'))}</button><button type="button" class="btn small" data-action="block-fail" data-id="${esc(b.id)}" title="${esc(t('esFail'))}" aria-label="${esc(t('esFail'))}">✕</button><button type="button" class="btn small" data-action="now-move" data-id="${esc(b.id)}" title="${esc(t('moveBtn'))}" aria-label="${esc(t('moveBtn'))}">🕒</button><button type="button" class="btn small" data-action="mp-unplan" data-id="${esc(b.id)}" title="${esc(t('mp_unplanKey'))}" aria-label="${esc(t('mp_unplan'))}">↩</button>` : `<button type="button" class="btn small" data-action="block-reset" data-id="${esc(b.id)}">↺ ${esc(t('sc_undo'))}</button>`}</div>
    ${n.x && !st ? `<div class="mp-row"><button type="button" class="btn small" data-action="mp-plus" data-id="${esc(n.id)}">＋ ${esc(t('mp_link'))}</button></div>` : ''}`;
}
// (v99) right click (a long press on the phone) on a block: what you can do with it
function ctxHtml() {
  const c = S().ctx; const b = c && get('blocks', c.id); if (!b) return '';
  const st = outcomeOf(b); const id = esc(b.id);
  return `<div class="mp-ctx" style="left:${c.x}px;top:${c.y}px" role="menu"><b>${esc(b.title)}</b>${!st ? `<button type="button" data-action="sc-done" data-id="${id}">✓ ${esc(t('esDone'))}</button><button type="button" data-action="now-move" data-id="${id}">🕒 ${esc(t('moveBtn'))}…</button><button type="button" data-action="mp-unplan" data-id="${id}">↩ ${esc(t('mp_unplan'))} <kbd>⌫</kbd></button>` : ''}<button type="button" data-action="open-block" data-id="${id}">${esc(t('sc_details'))} ›</button></div>`;
}
export const mapPaneHtml = () => { const h = infoHtml(currentView()); return h ? `<div class="mp-pane"><div class="field-label">${esc(t('mp_selected'))}</div>${h}</div>` : ''; };
// (v102) above the map: ⚠ (to the warnings in the pane), your lanes ↔ by category, and ⚙ Vista with the rest
function dayTools() { return ''; } // (v106) the view's options live in the Planner's view button (planner.js pvRow)
export function viewMappa(v, date) {
  const s = S(); const form = state.settings.mapForm === 'lines' ? 'lines' : 'boxes';
  const key = `${v}|${v === 'day' ? date : v === 'week' ? weekStart(date) : date.slice(0, 7)}|${form}`;
  const fresh = s.key !== key; if (fresh && s.key) { s.sel = null; s.cl = null; s.pin = null; ui.gr = null; ui.grPill = null; }
  if (ui.mpSelNext) { if (v === 'day') s.sel = ui.mpSelNext; ui.mpSelNext = null; }
  if (v === 'day') prepareDays([date]); else if (v === 'week') prepareDays(Array.from({ length:7 }, (_, i) => addDays(weekStart(date), i)).filter((d) => d >= today()));
  if (fresh) { // (v109) from the top left; the columns fill the width at this zoom (a phone starts a little smaller)
    const narrow = (document.getElementById('view')?.clientWidth || window.innerWidth) < 700;
    s.pan = { k:narrow ? (v === 'day' && form === 'boxes' ? 0.8 : 0.7) : (v === 'day' && form === 'boxes' ? 0.85 : 1), x:6, y:4 }; s.key = key;
  }
  const m = form === 'lines' ? linesMap(v, date) : v === 'day' ? mapDay(date) : v === 'week' ? mapWeek(date) : mapMonthWeeks(date);
  if (m.w * s.pan.k <= (s.lastW || 0) + 2) s.pan.x = 6; // it fits: no sideways pan to keep
  const usedW = s.lastW; setTimeout(() => { const el = document.getElementById('mp-main'); if (el && usedW && Math.abs(el.clientWidth - usedW) > 24 && S().key === key) render(); }, 0); // the first guess of the width was off
  return `<section class="plan-main mp-mainw">${planCard()}${v === 'day' ? behindCard(date) + (isWide() ? '' : conflictBanner(date)) + dayBand(date) : ''}
    <div class="mp-main" id="mp-main"><div class="mp-world" id="mp-world" style="transform:translate(${s.pan.x}px,${s.pan.y}px) scale(${s.pan.k});width:${m.w}px;height:${m.h}px">${m.html}</div>
    <div class="mp-zoom"><button type="button" data-action="mp-z" data-id="1" aria-label="${esc(t('mp_zoomIn'))}">＋</button><button type="button" data-action="mp-z" data-id="-1" aria-label="${esc(t('mp_zoomOut'))}">－</button><button type="button" data-action="mp-fit" aria-label="${esc(t('mp_fit'))}" title="${esc(t('mp_fit'))} (0)">⤢</button><button type="button" data-action="mp-fs" aria-label="${esc(t(document.body.classList.contains('plan-fs') ? 'mp_fsOff' : 'mp_fs'))}" title="${esc(t(document.body.classList.contains('plan-fs') ? 'mp_fsOff' : 'mp_fs'))} (F)">${document.body.classList.contains('plan-fs') ? '✕' : '⛶'}</button><span class="mp-pct" id="mp-pct">${Math.round(s.pan.k * 100)}%</span></div>
    ${m.R && !Object.keys(m.R).length ? `<p class="mp-empty">${esc(t('agEmpty'))}</p>` : ''}${ctxHtml()}</div>
    ${isWide() ? '' : infoHtml(v)}</section>${overlays()}`;
}

// ---------- clicks, panning, dragging a port ----------
export function mpClick(btn) {
  const { action, id } = btn.dataset; if (!action?.startsWith('mp-')) return false;
  const s = S();
  switch (action) {
    case 'mp-sel': s.sel = s.sel === id ? null : id; s.plus = null; s.cl = null; if (ui.gr && ui.gr.from !== id) ui.gr = null; render(); return true;
    case 'mp-x': s.sel = null; s.plus = null; s.cl = null; ui.gr = null; render(); return true;
    case 'mp-plus': if (s.sel !== id) s.sel = id; s.plus = s.plus === id ? null : id; render(); return true;
    case 'mp-lby': saveSettings({ mapLanesBy:id }); render(); return true;
    case 'mp-warn': { const el = document.querySelector('.pane .pw-list'); if (el) { el.scrollIntoView({ block:'center', behavior:'smooth' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } return true; }
    case 'mp-cl': s.cl = s.cl === id ? null : id; s.sel = null; render(); return true;
    case 'mp-form': saveSettings({ mapForm:id === 'lines' ? 'lines' : 'boxes' }); s.pin = null; render(); return true;
    case 'mp-stn': s.pin = s.pin === id ? null : id; document.getElementById('mp-hov')?.remove(); render(); return true;
    case 'mp-week': ui.view = 'week'; location.hash = `#/plan/${id}`; render(); return true;
    case 'mp-z': { const mn = document.getElementById('mp-main'); const r = mn?.getBoundingClientRect(); const cx = r ? r.width / 2 : 180, cy = r ? r.height / 2 : 200; const k0 = s.pan.k; const k = Math.max(0.3, Math.min(1.6, k0 + Number(id) * 0.12)); s.pan.x = cx - ((cx - s.pan.x) / k0) * k; s.pan.y = cy - ((cy - s.pan.y) / k0) * k; s.pan.k = k; render(); return true; }
    case 'mp-fit': s.key = `fit${s.key}`; render(); return true;
    case 'mp-fs': toggleFs(); return true;
    case 'mp-time': ui.mpTime = id === '1'; render(); return true;
    case 'mp-ov': saveSettings({ mapOverlap:id }); render(); return true;
    case 'mp-unplan': { const b = get('blocks', id); if (!b) return true; s.ctx = null; if (s.sel === id) s.sel = null; if (!unplanToPane(id)) render(); return true; }
    case 'mp-ctx-x': s.ctx = null; render(); return true;
    case 'mp-lab': saveSettings({ mapLaneLabels:id }); render(); return true;
    case 'mp-ladd': saveSettings({ mapLanes:[...lanes(), ''] }); render(); return true;
    case 'mp-lrm': {
      const i = Number(id); const L = lanes().filter((_, j) => j !== i); saveSettings({ mapLanes:L.length ? L : [''] });
      for (const b of live('blocks').filter((q) => q.lane != null && q.lane >= i)) upsert('blocks', { ...b, lane:b.lane === i ? null : b.lane - 1 }, { silent:true });
      changed(); return true;
    }
    default: return false;
  }
}
const drag = { pan:null, port:null, node:null, moved:false, dot:null };
let geo = null; // the day map's geometry, for dragging a block
// a click right after dragging the map or a port isn't a tap
export function mpDragged() { if (!drag.moved) return false; drag.moved = false; return true; }
const applyPan = () => { const w = document.getElementById('mp-world'); const s = S(); if (w) w.style.transform = `translate(${s.pan.x}px,${s.pan.y}px) scale(${s.pan.k})`; };
document.addEventListener('pointerdown', (e) => {
  const main = e.target.closest?.('#mp-main'); if (!main) return;
  drag.moved = false;
  const port = e.target.closest('[data-port]');
  if (port) { drag.port = { id:port.dataset.port, sx:e.clientX, sy:e.clientY }; e.preventDefault(); return; }
  const nd = e.target.closest('.mp-n.drag');
  if (nd && geo && e.button === 0 && !e.target.closest('.mp-full [data-action], .mp-rtab')) {
    drag.node = { id:nd.dataset.id, el:nd, sx:e.clientX, sy:e.clientY, x0:parseFloat(nd.style.left), y0:parseFloat(nd.style.top) };
    if (e.pointerType === 'touch') { const id = nd.dataset.id, x = e.clientX, y = e.clientY; clearTimeout(drag.hold); drag.hold = setTimeout(() => { if (drag.node?.id === id && !drag.moved) { drag.node = null; drag.moved = true; openCtx(id, x, y); } }, 550); } // a long press: the menu
    return;
  }
  if (e.target.closest('button,a,.mp-n,.mp-zoom,input,.mp-full')) return;
  const s = S(); drag.pan = { sx:e.clientX, sy:e.clientY, ox:s.pan.x, oy:s.pan.y };
});
document.addEventListener('pointermove', (e) => {
  if (drag.pan) { const s = S(); const dx = e.clientX - drag.pan.sx, dy = e.clientY - drag.pan.sy; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; s.pan.x = drag.pan.ox + dx; s.pan.y = drag.pan.oy + dy; applyPan(); e.preventDefault(); return; }
  if (drag.node) {
    const d = drag.node; const k = S().pan.k; const dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 8) return;
    drag.moved = true; clearTimeout(drag.hold); d.el.classList.add('dragging'); d.el.style.left = `${d.x0 + dx}px`; d.el.style.top = `${d.y0 + dy}px`;
    // (v99) on into the side pane: off the map, a card under the pointer; let go there and it's back in «Da pianificare»
    const pane = document.querySelector('.pane'); const pr = pane?.getBoundingClientRect();
    d.over = Boolean(pr && e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom);
    pane?.classList.toggle('dnd-over', d.over);
    if (d.over) {
      d.el.style.visibility = 'hidden'; document.querySelector('#mp-world .mp-snap')?.remove();
      if (!d.chip) { const b = get('blocks', d.id); d.chip = document.createElement('div'); d.chip.className = 'mp-chipdrag'; d.chip.style.setProperty('--c', d.el.style.getPropertyValue('--c')); d.chip.innerHTML = `<b>${esc(b?.title || '')}</b><small>↩ ${esc(t('mp_dropHere'))}</small>`; document.body.appendChild(d.chip); }
      d.chip.hidden = false; d.chip.style.left = `${e.clientX + 10}px`; d.chip.style.top = `${e.clientY + 10}px`; e.preventDefault(); return;
    }
    d.el.style.visibility = ''; if (d.chip) d.chip.hidden = true;
    // (v98) dragging moves a block between lanes and keeps its time; with Ctrl (or the «⇅ also the time» switch) the time moves too
    const time = e.ctrlKey || e.metaKey || ui.mpTime; const b0 = get('blocks', d.id);
    if (!time) d.el.style.top = `${d.y0}px`;
    const lane = Math.max(0, Math.min(geo.total - 1, Math.round((d.x0 + dx - LX0 - 8) / LW))); const start = time ? Math.max(0, Math.round((geo.h0 + (d.y0 + dy - TOP) / PPMD) / 15) * 15) : b0.start;
    d.lane = lane; d.start = start;
    const w = document.getElementById('mp-world'); let g = w?.querySelector('.mp-snap'); if (w && !g) { g = document.createElement('div'); g.className = 'mp-snap'; w.appendChild(g); }
    if (g) { g.classList.toggle('time', start !== b0.start); Object.assign(g.style, { left:`${LX0 + lane * LW + 8}px`, top:`${geo.Y(start)}px`, width:`${LW - 16}px`, height:d.el.style.height });
      g.innerHTML = time ? `⇅ ${esc(fmtTime(start))} · ${esc(lanes()[lane] || t('mp_laneN', lane + 1))}${start !== b0.start ? `<small>${esc(t('mp_was', fmtTime(b0.start)))}</small>` : ''}` : `↔ ${esc(lanes()[lane] || t('mp_laneN', lane + 1))} · ${esc(t('mp_keeps', fmtTime(b0.start)))}<small>${esc(t('mp_ctrlHint'))}</small>`; }
    e.preventDefault(); return;
  }
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
  if (drag.pan) { const moved = drag.moved; drag.pan = null; setTimeout(() => { drag.moved = false; }, 0); const s = S(); if (!moved && (s.sel || s.plus || s.pin || ui.gr)) { s.sel = null; s.plus = null; s.pin = null; ui.gr = null; render(); } return; } // (v102) a tap on the empty map closes the selection
  if (drag.node) {
    const d = drag.node; drag.node = null; clearTimeout(drag.hold); d.chip?.remove(); document.querySelector('.pane.dnd-over')?.classList.remove('dnd-over'); if (!drag.moved) return;
    setTimeout(() => { drag.moved = false; }, 0);
    if (d.over) { if (S().sel === d.id) S().sel = null; if (!unplanToPane(d.id)) render(); return; }
    const b = get('blocks', d.id); if (!b || d.lane == null) { render(); return; }
    if (geo.cat) d.lane = b.lane; // (v102) lanes by category: dragging only moves the time
    if (d.lane !== b.lane) upsert('blocks', { ...b, lane:d.lane }, { silent:true });
    ui.mpTime = false; // the phone's switch is for one move
    if (d.start !== b.start) moveBlockTo(b.id, b.date, d.start); else { if (d.lane !== b.lane) toast(t('mp_laneMoved', b.title, lanes()[d.lane] || t('mp_laneN', d.lane + 1), fmtTime(b.start))); changed(); }
    return;
  }
  if (!drag.port) return;
  const p = drag.port; drag.port = null;
  if (drag.dot) {
    drag.dot.hidden = true; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-mpn]'); drag.dot.remove(); drag.dot = null;
    const [from, k] = p.id.split('~');
    if (over && over.dataset.mpn !== from) dropOn(from, k, over.dataset.mpn);
    setTimeout(() => { drag.moved = false; }, 0);
  }
});

// (v97) the mouse wheel: Ctrl + wheel (or a pinch on a trackpad) zooms where the pointer is; the wheel alone scrolls
document.addEventListener('wheel', (e) => {
  const m = e.target.closest?.('#mp-main'); if (!m) return;
  if (e.target.closest?.('.mp-rows')) return; // a stop's list scrolls
  e.preventDefault(); const s = S(); const r = m.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; const k0 = s.pan.k; const k = Math.max(0.3, Math.min(2.2, k0 * Math.exp(-d * (Math.abs(d) < 20 ? 0.01 : 0.0015))));
    const cx = e.clientX - r.left, cy = e.clientY - r.top; s.pan.x = cx - ((cx - s.pan.x) / k0) * k; s.pan.y = cy - ((cy - s.pan.y) / k0) * k; s.pan.k = k;
  } else { s.pan.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; s.pan.y -= e.shiftKey ? 0 : e.deltaY; }
  applyPan(); const p = document.getElementById('mp-pct'); if (p) p.textContent = `${Math.round(s.pan.k * 100)}%`;
  if (e.ctrlKey || e.metaKey) relayout();
}, { passive:false });
// (v109) after a zoom or a resize the columns share the width again
let zT = 0;
function relayout() { clearTimeout(zT); zT = setTimeout(() => { if (document.getElementById('mp-main')) render(); }, 220); }
window.addEventListener('resize', () => { if (document.getElementById('mp-main')) relayout(); });
// full screen: the map and the side pane fill the screen (the header, the tabs and the rail go away); Esc leaves
export function toggleFs(on = !document.body.classList.contains('plan-fs')) {
  document.body.classList.toggle('plan-fs', on);
  try { if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch?.(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen?.(); } catch { /* not allowed here */ }
  S().key = `fs${S().key}`; render();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('plan-fs')) { document.body.classList.remove('plan-fs'); render(); } });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('#mp-main [role="button"][data-action]')) { e.preventDefault(); e.target.click(); return; }
  if (!document.getElementById('mp-main') || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = S(); const m = document.getElementById('mp-main').getBoundingClientRect(); const z = (f) => { const k0 = s.pan.k; const k = Math.max(0.3, Math.min(2.2, k0 * f)); s.pan.x = m.width / 2 - ((m.width / 2 - s.pan.x) / k0) * k; s.pan.y = m.height / 2 - ((m.height / 2 - s.pan.y) / k0) * k; s.pan.k = k; applyPan(); relayout(); };
  if (e.key === 'Escape' && s.ctx) { s.ctx = null; render(); return; }
  if (e.key === 'Escape' && s.pin) { s.pin = null; render(); return; }
  if (e.key === 'Escape' && (s.plus || s.vopts)) { s.plus = null; s.vopts = false; render(); return; }
  if (e.key === 'Escape' && s.sel && !ui.gr && !ui.grPill) { s.sel = null; render(); return; } // (v102) Esc closes the selection first
  if ((e.key === 'Delete' || e.key === 'Backspace') && s.sel) { const n = node(s.sel); if (n?.kind === 'block') { e.preventDefault(); s.sel = null; s.ctx = null; if (!unplanToPane(n.b.id)) render(); } return; } // (v99) off the plan
  if (e.key === 'f' || e.key === 'F') toggleFs();
  else if (e.key === 'Escape' && document.body.classList.contains('plan-fs') && !ui.gr && !ui.grPill) toggleFs(false);
  else if (e.key === '+' || e.key === '=') z(1.2); else if (e.key === '-') z(1 / 1.2); else if (e.key === '0') { s.key = `fit${s.key}`; render(); }
});
// renaming a lane (Enter or leaving the field)
document.addEventListener('change', (e) => { const i = e.target.dataset?.lanename; if (i == null) return; const L = [...lanes()]; L[Number(i)] = e.target.value.trim(); saveSettings({ mapLanes:L }); });
// (v99) the menu on a block: right click, or a long press on the phone
function openCtx(id, cx, cy) {
  const b = get('blocks', id); const m = document.getElementById('mp-main'); if (!b || !m) return;
  const r = m.getBoundingClientRect(); const s = S(); s.sel = id; s.ctx = { id, x:Math.max(4, Math.min(r.width - 230, cx - r.left)), y:Math.max(4, Math.min(Math.min(r.height, window.innerHeight - r.top) - 200, cy - r.top)) }; render();
}
document.addEventListener('contextmenu', (e) => {
  const n = e.target.closest?.('#mp-main [data-mpn]'); if (!n) return; const id = n.dataset.mpn; if (!get('blocks', id)) return;
  e.preventDefault(); clearTimeout(drag.hold); openCtx(id, e.clientX, e.clientY);
});
document.addEventListener('click', (e) => {
  const v = ui.mp; if (v?.vopts && !e.target.closest?.('.mp-vpop, [data-action=mp-vopts]')) { v.vopts = false; if (!e.target.closest?.('[data-action]')) render(); }
  if (v?.plus && !e.target.closest?.('.mp-plusm, [data-action=mp-plus]')) { v.plus = null; if (!e.target.closest?.('[data-action]')) render(); }
}, true);
document.addEventListener('click', (e) => {
  const s = ui.mp; if (!s?.ctx) return;
  const inMenu = e.target.closest?.('.mp-ctx'); if (inMenu && !e.target.closest('[data-action]')) return;
  s.ctx = null; if (!e.target.closest?.('[data-action]')) render();
}, true);
