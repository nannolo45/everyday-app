// views/scaletta.js (v96): the Planner as a «scaletta» (Settings → Planner → Aspetto): the day in a row, with the
// links between things shown where they join (↓ Poi, 🔒 Prima serve, ‖ In parallelo, ✕ Se non riesce…), each card
// opening in place (checklist, notes, the 7 ports to add a linked thing). Week: the days with what crosses them.
// Month: the month at a glance (a square per day, a bar per week) and the weeks as an agenda, to zoom in.
import { catColor, catName, esc, fmtDay, planSettings, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { blocksOn, checklistOf, conflictsOn, eventsOn, outcomeOf, roomy, taskIcon, timedEventsOn, trySetBlockDone } from '../model.js';
import { addDays, fmtDur, fmtTime, nowMinutes, parseDate, today } from '../plan.js';
import { changed, render } from '../shell.js';
import { get } from '../store.js';
import { openPlus } from '../plus.js';
import { dropOn, ghostHtml, LT, linkPill, linksFor, lname, node, pillMenuHtml, PORTS, previewHtml, when } from '../graph.js';
import { behindCard, conflictBanner, loadBar, planCard, weekStart } from './planner.js';

// ---------- what a day holds ----------
export function dayNodes(date) {
  const bl = blocksOn(date).filter((b) => !b.stepId).map((b) => node(b.id));
  const ev = timedEventsOn(date).filter((e) => !e.skipped).map((e) => ({ id:`ev:${e.id}`, raw:e.id, kind:'event', e, title:e.title, date, start:e.start, minutes:e.minutes, fixed:true, color:e.color }));
  return [...bl.filter(Boolean), ...ev].sort((a, b) => a.start - b.start || b.minutes - a.minutes);
}
export const rawId = (n) => (n.kind === 'event' ? n.raw : n.id);
export const loadMin = (date) => blocksOn(date).filter((b) => !b.stepId && !roomy(b) && outcomeOf(b) !== 'failed').reduce((s, b) => s + (b.minutes || 0), 0);
export const nodeColor = (n) => (n.kind === 'event' ? n.color : catColor(n.category)) || 'var(--accent)';
const icon = (n) => (n.kind === 'event' ? '🗓 ' : n.x ? taskIcon(n.x) : '');
const dl = (d) => relDay(d);
const level = (m) => (m === 0 ? 0 : m < 120 ? 1 : m < 240 ? 2 : m < 360 ? 3 : 4);
const wlevel = (m) => (m < 360 ? 'light' : m < 840 ? 'normal' : m < 1320 ? 'full' : 'veryfull');
const isParKid = (b, sameDay) => sameDay.some((o) => o.kind === 'block' && o.id !== b.id && (o.b.par || []).includes(b.id) && !(b.b?.par || []).includes(o.id));

// ---------- the day ----------
function card(n, links, near) {
  if (n.kind === 'event') {
    return `<div class="sc-card ev" style="--c:${esc(nodeColor(n))}"><button type="button" class="sc-b" data-action="event" data-id="${esc(n.raw)}"><b>🗓 ${esc(n.title)}</b><small>${esc(fmtTime(n.start))}–${esc(fmtTime(n.start + n.minutes))} · ${esc(t('sc_gcal'))}</small></button>${crossLines(n, links, near)}</div>`;
  }
  const b = n.b; const st = outcomeOf(b); const open = ui.scOpen === b.id; const cl = checklistOf(b); const ck = b.checked || [];
  const sub = [`${fmtTime(b.start)}–${fmtTime(b.start + b.minutes)}`, fmtDur(b.minutes), cl.length ? `☑ ${ck.filter(Boolean).length}/${cl.length}` : '', n.x?.place ? `📍 ${n.x.place.split(',')[0]}` : '', b.kind === 'prep' ? t('sc_prepTag') : ''].filter(Boolean).join(' · ');
  return `<div class="sc-card${st ? ` is-${st}` : ''}${open ? ' open' : ''}${ui.gr?.from === b.id ? ' ghosting' : ''}" style="--c:${esc(nodeColor(n))}">
    <div class="sc-top"><input type="checkbox" class="sc-tick" data-action="block-done" data-id="${esc(b.id)}" ${st === 'done' ? 'checked' : ''} aria-label="${esc(t('esDone'))}">
    <button type="button" class="sc-b" data-action="sc-open" data-id="${esc(b.id)}" aria-expanded="${open}"><b>${st === 'failed' ? '✕ ' : ''}${icon(n)}${esc(b.title)}</b><small>${esc(sub)}</small></button></div>
    ${open ? editInline(n, links) : crossLines(n, links, near)}
  </div>${ui.gr?.from === b.id && !ui.gr.pv ? ghostHtml() : ''}`;
}
// links to things that aren't the card just above or below: a line each, to go there
function crossLines(n, links, near) {
  const mine = links.filter((l) => (l.a === n.id || l.b === n.id) && !l.b.startsWith('pot:') && l.t !== 'par');
  const out = mine.filter((l) => !near.has(l.a === n.id ? l.b : l.a));
  if (!out.length) return '';
  return `<div class="sc-xs">${out.map((l) => { const o = node(l.a === n.id ? l.b : l.a); if (!o) return ''; const inc = l.b === n.id; const txt = `${inc ? '↩' : '↪'} ${LT[l.t].i} ${lname(l.t)} · ${o.title} · ${o.date === n.date ? fmtTime(o.start) : when(o)}`;
    return o.date ? `<a class="sc-x" href="#/plan/${esc(o.date)}" style="--jc:${LT[l.t].c}">${esc(txt)}</a>` : `<span class="sc-x" style="--jc:${LT[l.t].c}">${esc(txt)}</span>`; }).join('')}</div>`;
}
function editInline(n, links) {
  const b = n.b; const x = n.x; const st = outcomeOf(b); const cl = checklistOf(b); const ck = b.checked || [];
  const mine = links.filter((l) => l.a === n.id || l.b === n.id);
  return `<div class="sc-ie">
    <div class="sc-ier"><button type="button" class="sc-pill" data-action="now-move" data-id="${esc(b.id)}">🕒 ${esc(dl(b.date))} · ${esc(fmtTime(b.start))}–${esc(fmtTime(b.start + b.minutes))}</button><span class="sc-pill">⏱ ${esc(fmtDur(b.minutes))}</span>${x?.category ? `<span class="sc-pill" style="color:${esc(nodeColor(n))}">● ${esc(catName(get('categories', x.category)))}</span>` : ''}</div>
    ${cl.length ? `<div class="sc-cl">${cl.map((c, i) => `<label><input type="checkbox" data-ci="${i}" data-block="${esc(b.id)}" ${ck[i] ? 'checked' : ''}> <span>${esc(typeof c === 'string' ? c : c.text || c.title || '')}</span></label>`).join('')}</div>` : ''}
    ${x?.notes ? `<p class="sc-notes">${esc(x.notes)}</p>` : ''}
    <div class="sc-lb">${esc(t('sc_links'))} <small>${esc(t('sc_linksHint'))}</small></div>
    ${mine.length ? `<div class="sc-mine">${mine.map((l) => { const o = node(l.a === n.id ? l.b : l.a); return o ? `<div class="sc-ml">${linkPill(l)}<span>${esc(o.title)}<small>${esc(o.kind === 'pot' ? t('sc_branchSub', lname(l.t)) : when(o))}</small></span></div>` : ''; }).join('')}</div>` : ''}
    ${x ? `<div class="sc-ports">${PORTS.map((k) => `<button type="button" class="sc-port" data-action="gr-port" data-id="${esc(`${b.id}~${k}`)}" style="--pc:${LT[k].c}">${LT[k].i} ${esc(lname(k))}</button>`).join('')}</div>` : ''}
    <div class="sc-foot">${!st ? `<button type="button" class="btn small" data-action="block-fail" data-id="${esc(b.id)}">✕ ${esc(t('esFail'))}</button><button type="button" class="btn small primary" data-action="sc-done" data-id="${esc(b.id)}">✓ ${esc(t('esDone'))}</button>` : `<button type="button" class="btn small" data-action="block-reset" data-id="${esc(b.id)}">↺ ${esc(t('sc_undo'))}</button>`}<button type="button" class="btn small" data-action="open-block" data-id="${esc(b.id)}">${esc(t('sc_details'))} ›</button></div>
  </div>`;
}
function branches(n, links) {
  return links.filter((l) => l.a === n.id && l.b.startsWith('pot:')).map((l) => { const p = node(l.b); if (!p) return '';
    return `<div class="sc-branch" style="--jc:${LT[l.t].c}">${linkPill(l)}<div class="sc-card pot" style="--c:${esc(nodeColor(n))}"><div class="sc-b"><b>${LT[l.t].i} ${esc(p.title)}</b><small>${esc(t('sc_branchSub', lname(l.t)))}</small></div></div></div>`; }).join('');
}
function joint(prev, cur, links, date, conflicts) {
  const ab = links.filter((l) => l.t !== 'par' && ((l.a === prev.id && l.b === cur.id) || (l.a === cur.id && l.b === prev.id)));
  const pe = prev.start + prev.minutes; const gap = cur.start - pe;
  const ci = conflicts.findIndex((c) => c.type === 'overlap' && c.ids.includes(rawId(prev)) && c.ids.includes(rawId(cur)));
  if (ci >= 0) {
    const mv = conflicts[ci].ids.map((i) => get('blocks', i)).find((b) => b && !outcomeOf(b));
    return `<div class="sc-joint bad"><span class="sc-jp bad">⚠ ${esc(t('sc_overlap', fmtDur(Math.min(pe, cur.start + cur.minutes) - cur.start)))}</span>${mv ? `<button type="button" class="sc-mini" data-action="fix" data-date="${date}" data-i="${ci}">${esc(t('sc_moveIt', mv.title))}</button>` : ''}<button type="button" class="sc-mini" data-action="allow" data-date="${date}" data-i="${ci}">${esc(t('sc_leave'))}</button></div>`;
  }
  const free = gap >= 30 && date >= today() ? `<button type="button" class="sc-free" data-action="ag-gap" data-date="${date}" data-start="${pe}" data-min="${gap}">${esc(t('sc_free', fmtDur(gap)))} · ＋</button>` : '';
  if (ab.length) return `<div class="sc-joint" style="--jc:${LT[ab[0].t].c}">${ab.map(linkPill).join('')}${free}</div>`;
  const can = prev.kind === 'block' && prev.x && cur.kind !== 'pot';
  return `<div class="sc-joint">${free || (can ? `<button type="button" class="sc-jp empty" data-action="sc-link" data-id="${esc(`${prev.id}|${cur.id}`)}">＋ ${esc(t('sc_link'))}</button>` : '')}</div>`;
}
function scDay(date) {
  const ns = dayNodes(date); const links = linksFor(ns.filter((n) => n.kind === 'block').map((n) => n.b));
  const conflicts = conflictsOn(date);
  const kids = new Set(); const groups = new Map();
  for (const n of ns) if (n.kind === 'block' && isParKid(n, ns)) kids.add(n.id);
  for (const n of ns) if (n.kind === 'block' && !kids.has(n.id)) {
    const par = ns.filter((o) => kids.has(o.id) && links.some((l) => l.t === 'par' && ((l.a === n.id && l.b === o.id) || (l.b === n.id && l.a === o.id))));
    const inside = roomy(n.b) ? ns.filter((o) => o.id !== n.id && !kids.has(o.id) && o.kind === 'block' && !roomy(o.b) && o.start >= n.start && o.start + o.minutes <= n.start + n.minutes) : [];
    for (const o of inside) kids.add(o.id);
    if (par.length || inside.length || roomy(n.b)) groups.set(n.id, { par, inside });
  }
  const top = ns.filter((n) => !kids.has(n.id));
  const td = today(); const nowM = date === td ? nowMinutes() : -1;
  let h = '';
  const [h0] = [planSettings().dayStart];
  if (date >= td && top.length && top[0].start - Math.max(h0, nowM) >= 30) { const s = Math.max(h0, Math.ceil(nowM / 15) * 15); h += `<div class="sc-joint first"><button type="button" class="sc-free" data-action="ag-gap" data-date="${date}" data-start="${s}" data-min="${top[0].start - s}">${esc(t('sc_free', fmtDur(top[0].start - s)))} · ＋</button></div>`; }
  top.forEach((n, i) => {
    if (i) h += joint(top[i - 1], n, links, date, conflicts);
    const near = new Set([top[i - 1]?.id, top[i + 1]?.id].filter(Boolean));
    const g = groups.get(n.id); const isNow = nowM >= n.start && nowM < n.start + n.minutes;
    const body = g ? `<div class="sc-grp${roomy(n.b) ? ' room' : ''}"><span class="sc-gbar">${esc(roomy(n.b) ? t('sc_inside') : `‖ ${lname('par')}`)}</span>${card(n, links, near)}<div class="sc-kids">${[...g.par, ...g.inside].map((o) => card(o, links, new Set([n.id]))).join('')}</div></div>` : card(n, links, near);
    h += `<div class="sc-it"><div class="sc-rail">${esc(fmtTime(n.start))}${isNow ? `<em>${esc(t('sc_now'))}</em>` : ''}</div><div class="sc-col">${body}${branches(n, links)}</div></div>`;
  });
  if (date >= td && top.length) { const last = top.reduce((m, n) => Math.max(m, n.start + n.minutes), 0); const end = planSettings().dayEnd; if (end - last >= 30) h += `<div class="sc-joint"><button type="button" class="sc-free" data-action="ag-gap" data-date="${date}" data-start="${last}" data-min="${end - last}">${esc(t('sc_free', fmtDur(end - last)))} · ＋</button></div>`; }
  const allDay = eventsOn(date).filter((e) => e.allDay);
  return `${planCard()}${behindCard(date)}${conflictBanner(date)}
    ${allDay.length ? `<div class="allday">${allDay.map((e) => `<button class="allday-chip" type="button" data-action="event" data-id="${esc(e.id)}" style="--c:${esc(e.color)}">${esc(e.title)}</button>`).join('')}</div>` : ''}
    ${top.length ? `<div class="sc-day">${h}</div>` : `<p class="empty ag-empty">${esc(t('agEmpty'))}</p>${date >= td ? `<div class="sc-joint"><button type="button" class="sc-free" data-action="sc-add" data-id="${date}">＋ ${esc(t('sc_addHere'))}</button></div>` : ''}`}`;
}

// ---------- the week, the month ----------
function dayRow(d, big) {
  const td = today(); const ns = dayNodes(d).filter((n) => !(n.kind === 'block' && n.b.kind === 'prep' && !big));
  const cross = linksFor(ns.filter((n) => n.kind === 'block').map((n) => n.b)).filter((l) => l.t !== 'par' && !l.b.startsWith('pot:')).map((l) => { const a = node(l.a), b = node(l.b); if (!a || !b) return null; const mine = a.date === d ? a : b.date === d ? b : null; const o = mine === a ? b : a; return mine && o.date !== d ? { l, o, out:mine === a } : null; }).filter(Boolean);
  const conf = new Set(conflictsOn(d).flatMap((c) => c.ids));
  const ld = loadMin(d); const max = planSettings().maxLoad;
  return `<div class="sc-drow${d === td ? ' is-today' : ''}${d < td ? ' past' : ''}${big ? ' big' : ''}"><button type="button" class="sc-dd" data-action="view-day" data-id="${d}">${esc(fmtDay(d, { weekday:'short' }))}<b>${parseDate(d).getDate()}</b><i><u style="width:${Math.min(100, (ld / max) * 100)}%" class="${ld > max ? 'over' : ''}"></u></i></button>
    <button type="button" class="sc-dits" data-action="view-day" data-id="${d}">${ns.length ? ns.map((n) => { const cl = n.kind === 'block' ? checklistOf(n.b) : []; return `<i class="${n.out ? 'done' : ''}${conf.has(rawId(n)) ? ' bad' : ''}${n.fixed ? ' ap' : ''}" style="--c:${esc(nodeColor(n))}">${esc(fmtTime(n.start))} ${icon(n)}${esc(n.title)}${big && cl.length ? ` · ☑${(n.b.checked || []).filter(Boolean).length}/${cl.length}` : ''}</i>`; }).join('') : `<span class="sc-free0">${esc(t('sc_dayFree'))}</span>`}
    ${cross.map(({ l, o, out }) => `<i class="xl" style="--c:${LT[l.t].c}">${out ? '↪' : '↩'} ${LT[l.t].i} ${esc(o.title)} · ${esc(o.date ? fmtDay(o.date, { weekday:'short', day:'numeric' }) : t('gr_unplanned'))}</i>`).join('')}</button>
    ${d >= td ? `<button type="button" class="sc-dadd" data-action="sc-add" data-id="${d}" aria-label="${esc(t('addMenu'))}">＋</button>` : ''}</div>`;
}
const weekLoad = (w) => Array.from({ length:7 }, (_, i) => loadMin(addDays(w, i))).reduce((a, b) => a + b, 0);
const weekConf = (w) => Array.from({ length:7 }, (_, i) => conflictsOn(addDays(w, i)).length).reduce((a, b) => a + b, 0);
function square(d, month) {
  const ns = dayNodes(d); const ld = loadMin(d); const td = today();
  let fill;
  if ((ui.scColor || 'load') === 'load') fill = `<i class="lv lv${level(ld)}"></i>`;
  else { const by = {}; for (const n of ns) if (n.kind === 'block') by[n.category || '-'] = (by[n.category || '-'] || 0) + n.minutes; fill = `<i class="cats" style="height:${Math.min(100, (ld / planSettings().maxLoad) * 100)}%">${Object.entries(by).map(([c, m]) => `<u style="flex:${m};background:${esc(catColor(c) || 'var(--accent)')}"></u>`).join('')}</i>`; }
  return `<button type="button" class="sc-sq${d.slice(0, 7) === month ? '' : ' out'}${d === td ? ' is-today' : ''}${d < td ? ' past' : ''}" data-action="view-day" data-id="${d}" title="${esc(`${relDay(d)} · ${fmtDur(ld)}`)}">${fill}<span>${parseDate(d).getDate()}</span>${ns.some((n) => n.fixed) ? '<b class="ap"></b>' : ''}${conflictsOn(d).length ? '<b class="cf"></b>' : ''}</button>`;
}
const wkLabel = (w) => `${fmtDay(w, { day:'numeric', month:'short' })} – ${fmtDay(addDays(w, 6), { day:'numeric', month:'short' })}`;
function monthWeeks(date) {
  const first = `${date.slice(0, 7)}-01`; const ws = []; for (let w = weekStart(first); w.slice(0, 7) <= date.slice(0, 7); w = addDays(w, 7)) ws.push(w);
  return ws;
}
function scMonth(date) {
  const month = date.slice(0, 7); const ws = monthWeeks(date); const td = today();
  const maxW = Math.max(...ws.map(weekLoad), 1);
  if (!ui.scWeeks) ui.scWeeks = new Set([weekStart(td)]);
  const heads = Array.from({ length:7 }, (_, i) => fmtDay(addDays(ws[0], i), { weekday:'narrow' }));
  const ov = `<div class="sc-ov"><div class="sc-ovh"><b>${esc(t('sc_glance'))}</b><div class="sc-seg">${['load', 'cat'].map((k) => `<button type="button" class="${(ui.scColor || 'load') === k ? 'on' : ''}" data-action="sc-color" data-id="${k}">${esc(t(`sc_col_${k}`))}</button>`).join('')}</div></div>
    <div class="sc-ovg"><span></span>${heads.map((x) => `<span class="sc-ovd">${esc(x)}</span>`).join('')}<span class="sc-ovd">${esc(t('sc_week'))}</span>
    ${ws.map((w) => { const L = weekLoad(w); const c = weekConf(w); const cur = weekStart(td) === w; return `<button type="button" class="sc-ovl${cur ? ' cur' : ''}" data-action="sc-wk" data-id="${w}">${parseDate(w).getDate()}</button>${Array.from({ length:7 }, (_, i) => square(addDays(w, i), month)).join('')}<button type="button" class="sc-wbar${cur ? ' cur' : ''}" data-action="sc-wk" data-id="${w}"><i style="width:${(L / maxW) * 100}%" class="${wlevel(L)}"></i><span>${esc(fmtDur(L) || '—')}${c ? ` · <em>⚠${c}</em>` : ''}</span></button>`; }).join('')}</div>
    <div class="sc-leg">${(ui.scColor || 'load') === 'load' ? `<i class="lv lv1"></i> ${esc(t('sc_little'))} <i class="lv lv2"></i><i class="lv lv3"></i><i class="lv lv4"></i> ${esc(t('sc_lot'))}` : esc(t('sc_catLeg'))} · <b class="ap"></b> ${esc(t('sc_appt'))} · <b class="cf"></b> ${esc(t('sc_conflict'))}</div></div>`;
  const cards = ws.map((w) => {
    const open = ui.scWeeks.has(w); const L = weekLoad(w); const c = weekConf(w); const cur = weekStart(td) === w;
    const days = Array.from({ length:7 }, (_, i) => addDays(w, i));
    const appts = days.flatMap((d) => dayNodes(d).filter((n) => n.fixed));
    const busiest = [...days].sort((a, b) => loadMin(b) - loadMin(a))[0];
    let h = `<div class="sc-wk${open ? ' open' : ''}${cur ? ' cur' : ''}"><button type="button" class="sc-wkh" data-action="sc-wtog" data-id="${w}" aria-expanded="${open}"><span><b>${esc(wkLabel(w))}</b><small>${esc([fmtDur(L) || t('sc_nothing'), t(`sc_wl_${wlevel(L)}`), loadMin(busiest) ? t('sc_busiest', fmtDay(busiest, { weekday:'short', day:'numeric' })) : ''].filter(Boolean).join(' · '))}${c ? ` · <em>⚠ ${esc(t('nConflicts', c))}</em>` : ''}</small></span><span>${open ? '▾' : '▸'}</span></button>`;
    if (!open) h += appts.length ? `<div class="sc-wkap">${appts.map((n) => `<button type="button" style="--c:${esc(nodeColor(n))}" data-action="view-day" data-id="${n.date}">${n.kind === 'event' ? '🗓' : '📅'} ${esc(n.title)} · ${esc(fmtDay(n.date, { weekday:'short', day:'numeric' }))}</button>`).join('')}</div>` : '';
    else h += `<div class="sc-wkb">${days.map((d) => dayRow(d, false)).join('')}<button type="button" class="sc-wkzoom" data-action="sc-wk" data-id="${w}">${esc(t('sc_openWeek'))} ›</button></div>`;
    return h + '</div>';
  }).join('');
  return `${planCard()}${ov}<div class="sc-agenda">${cards}</div>`;
}
function scWeek(date) {
  const w = weekStart(date); const L = weekLoad(w); const c = weekConf(w);
  return `${planCard()}<div class="sc-wkhead"><div class="sc-strip">${Array.from({ length:7 }, (_, i) => square(addDays(w, i), date.slice(0, 7))).join('')}</div><small>${esc([fmtDur(L) || t('sc_nothing'), t(`sc_wl_${wlevel(L)}`)].join(' · '))}${c ? ` · ⚠ ${c}` : ''}</small></div>
    <div class="sc-agenda">${Array.from({ length:7 }, (_, i) => dayRow(addDays(w, i), true)).join('')}</div>`;
}
export function viewScaletta(v, date) {
  const key = `${v}|${date}`; if (ui.scKey && ui.scKey !== key) { ui.gr = null; ui.grPill = null; ui.scOpen = null; } ui.scKey = key;
  const body = v === 'week' ? scWeek(date) : v === 'month' ? scMonth(date) : scDay(date);
  return `<section class="plan-main sc-main">${body}</section>${overlays()}`;
}
export const overlays = () => { const o = `${ui.gr?.pv ? previewHtml() : ''}${pillMenuHtml()}`; return o ? `<div class="gr-over">${o}</div>` : ''; };

// ---------- clicks ----------
export function scClick(btn) {
  const { action, id } = btn.dataset; if (!action?.startsWith('sc-')) return false;
  switch (action) {
    case 'sc-open': ui.scOpen = ui.scOpen === id ? null : id; if (ui.gr && ui.gr.from !== id) ui.gr = null; render(); return true;
    case 'sc-done': { const b = get('blocks', id); if (b && trySetBlockDone(b, true)) changed(); return true; }
    case 'sc-add': openPlus({ date:id }); return true;
    case 'sc-link': { const [a, b] = id.split('|'); dropOn(a, 'poi', b); return true; }
    case 'sc-color': ui.scColor = id; render(); return true;
    case 'sc-wtog': { if (!ui.scWeeks) ui.scWeeks = new Set(); if (ui.scWeeks.has(id)) ui.scWeeks.delete(id); else ui.scWeeks.add(id); render(); return true; }
    case 'sc-wk': ui.view = 'week'; location.hash = `#/plan/${id}`; render(); return true;
    default: return false;
  }
}
