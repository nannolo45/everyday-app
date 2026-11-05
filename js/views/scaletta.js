// views/scaletta.js (v97): the Planner as a «scaletta» (Settings → Planner → Aspetto). Not the day by the clock
// (that's the Agenda) but your things as chains of steps: each project a ladder of steps, linked by ↓ Poi,
// 🔒 Prima serve, ⤷ Prepara or tied to an appointment, with the day of each step beside it, what can be done now
// and what's waiting. Tap a step to open it in place (checklist, notes, the 7 ports, Esito). Below, the things
// of the day / week / month on screen that aren't part of any chain.
import { catColor, catName, esc, fmtDay, relDay, toast, ui } from '../core.js';
import { t } from '../i18n.js';
import { blocksOn, checklistOf, isApptLike, isMealTask, leadOf, outcomeOf, planTask, roomy, taskIcon, timedEventsOn, trySetBlockDone } from '../model.js';
import { addDays, fmtDur, fmtTime, parseDate, today } from '../plan.js';
import { changed, render } from '../shell.js';
import { get, live, upsert } from '../store.js';
import { openPlus } from '../plus.js';
import { slotOptions } from '../weekpick.js';
import { ghostHtml, ghostOpen, LT, linkPill, linksFor, lname, node, pillMenuHtml, PORTS, previewHtml, when } from '../graph.js';
import { behindCard, conflictBanner, dayBand, planCard, weekStart } from './planner.js';

// ---------- what a day holds (also for the map) ----------
export function dayNodes(date) {
  const bl = blocksOn(date).filter((b) => !b.stepId).map((b) => node(b.id));
  const ev = timedEventsOn(date).filter((e) => !e.skipped).map((e) => ({ id:`ev:${e.id}`, raw:e.id, kind:'event', e, title:e.title, date, start:e.start, minutes:e.minutes, fixed:true, color:e.color }));
  return [...bl.filter(Boolean), ...ev].sort((a, b) => a.start - b.start || b.minutes - a.minutes);
}
export const rawId = (n) => (n.kind === 'event' ? n.raw : n.id);
export const loadMin = (date) => blocksOn(date).filter((b) => !b.stepId && !roomy(b) && outcomeOf(b) !== 'failed').reduce((s, b) => s + (b.minutes || 0), 0);
export const nodeColor = (n) => (n.kind === 'event' ? n.color : catColor(n.category)) || 'var(--accent)';
export const overlays = () => { const o = `${ui.gr?.pv ? previewHtml() : ''}${pillMenuHtml()}`; return o ? `<div class="gr-over">${o}</div>` : ''; };

// ---------- chains ----------
const blocksOf = (id) => live('blocks').filter((b) => b.taskId === id && !b.stepId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start));
export function isDoneT(x) { if (x.done) return true; const bs = blocksOf(x.id); return bs.length > 0 && bs.every((b) => outcomeOf(b) === 'done'); }
export function blockFor(x) { const bs = blocksOf(x.id); return bs.find((b) => !outcomeOf(b)) || bs[bs.length - 1] || null; }
// what has to come before a task (and how they're linked)
function preOf(x) {
  const out = (x.after || []).map((id) => ({ id, k:(x.afterNext || []).includes(id) ? 'poi' : 'req' }));
  for (const p of x.prep || []) out.push({ id:p.taskId, k:'prep' });
  if (x.eventId && (Number(x.eventOffset) || 0) > 0) out.push({ id:x.eventId, k:'tied' });
  for (const y of live('tasks')) if (y.eventId === x.id && (Number(y.eventOffset) || 0) <= 0 && !y.archived) out.push({ id:y.id, k:'tied' });
  return out.filter((q) => { const y = get('tasks', q.id); return y && !y.archived; });
}
const tKey = (x) => { const b = blockFor(x); return b && !isDoneT(x) ? `${b.date} ${String(b.start).padStart(4, '0')}` : isDoneT(x) ? '0' : '9'; };
export function chains() {
  // routines (meals and the like, repeating) aren't projects: they stay out, with what only they use
  const tasks = live('tasks').filter((x) => !x.archived && !x.repeat && x.kind !== 'saved' && !isMealTask(x));
  const ids = new Set(tasks.map((x) => x.id));
  const pre = new Map(tasks.map((x) => [x.id, preOf(x).filter((q) => ids.has(q.id))]));
  const nb = new Map(tasks.map((x) => [x.id, new Set()]));
  for (const [id, ps] of pre) for (const p of ps) { if (!nb.has(p.id)) continue; nb.get(id).add(p.id); nb.get(p.id).add(id); }
  const seen = new Set(); const out = [];
  for (const x of tasks) {
    if (seen.has(x.id) || !nb.get(x.id).size) continue;
    const comp = []; const st = [x.id]; seen.add(x.id);
    while (st.length) { const id = st.pop(); comp.push(id); for (const o of nb.get(id)) if (!seen.has(o)) { seen.add(o); st.push(o); } }
    // in order: what comes first first (ties: by when)
    const left = new Set(comp); const steps = [];
    while (left.size) {
      const free = [...left].filter((id) => !pre.get(id).some((p) => left.has(p.id))).map((id) => get('tasks', id)).sort((a, b) => (tKey(a) < tKey(b) ? -1 : 1));
      const pick = free[0] || get('tasks', [...left][0]); steps.push(pick); left.delete(pick.id);
    }
    if (steps.every(isDoneT)) continue;
    out.push({ steps, pre });
  }
  const nextOf = (c) => c.steps.find((x) => !isDoneT(x));
  return out.sort((a, b) => (tKey(nextOf(a)) < tKey(nextOf(b)) ? -1 : 1));
}
function stepState(x, pre) {
  if (isDoneT(x)) return { st:'done', txt:t('ch_done') };
  const ps = pre.get(x.id) || [];
  const wait = ps.map((p) => get('tasks', p.id)).find((y) => y && !isDoneT(y));
  const b = blockFor(x);
  if (wait && b) { const wb = blockFor(wait); if (wb && !outcomeOf(wb) && (wb.date > b.date || (wb.date === b.date && wb.start + wb.minutes > b.start))) return { st:'bad', txt:t('ch_order', wait.title, relDay(wb.date)) }; }
  if (wait) return { st:'wait', txt:t('ch_wait', wait.title) };
  return { st:'ready', txt:t('ch_ready') };
}

// ---------- drawing ----------
const dl = (d) => relDay(d);
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
function stepHtml(x, i, pre, last) {
  const s = stepState(x, pre); const b = blockFor(x); const open = ui.scOpen === x.id;
  const cl = x.checklist || []; const ck = (b && b.checked) || [];
  const whenTxt = b && !isDoneT(x) ? `<a class="ch-when${b.date === today() ? ' today' : ''}" href="#/plan/${esc(b.date)}">${esc(relDay(b.date))}<br>${esc(fmtTime(b.start))}</a>` : b ? `<span class="ch-when">${esc(relDay(b.date))}</span>` : `<span class="ch-when">${esc(t('gr_unplanned'))}</span>`;
  const gFrom = ui.gr && !ui.gr.pv && (ui.gr.from === b?.id || ui.gr.from === `task:${x.id}`) && !last;
  let h = `<div class="ch-step is-${s.st}${open ? ' open' : ''}"><div class="ch-dot"><b>${s.st === 'done' ? '✓' : i + 1}</b></div>
    <div class="ch-main"><div class="ch-row"><button type="button" class="ch-tx" data-action="sc-step" data-id="${esc(x.id)}" aria-expanded="${open}"><b>${taskIcon(x)}${esc(x.title)}</b><small>${esc(s.txt)}${cl.length ? ` · ☑ ${ck.filter(Boolean).length}/${cl.length}` : ''}${b && !isDoneT(x) ? ` · ${esc(fmtDur(b.minutes))}` : ''}</small></button>${whenTxt}</div>`;
  if (open) {
    if (b && !isDoneT(x)) h += editInline(node(b.id), linksFor([b]));
    else if (!b) h += `<div class="sc-ie"><div class="sc-foot left"><button type="button" class="btn small primary" data-action="sc-auto" data-id="${esc(x.id)}">✦ ${esc(t('ch_findSlot'))}</button><button type="button" class="btn small" data-action="task-edit" data-id="${esc(x.id)}">${esc(t('sc_details'))} ›</button></div></div>`;
    else h += `<div class="sc-ie"><div class="sc-foot left"><button type="button" class="btn small" data-action="open-block" data-id="${esc(b.id)}">${esc(t('sc_details'))} ›</button></div></div>`;
  }
  if (gFrom) h += ghostHtml();
  return `${h}</div></div>`;
}
function chainHtml(c) {
  const { steps, pre } = c; const last = steps[steps.length - 1];
  const appt = steps.find((x) => isApptLike(x));
  const name = appt ? appt.title : last.title;
  const color = catColor(last.category || steps.find((x) => x.category)?.category) || 'var(--accent)';
  const nd = steps.filter(isDoneT).length; const nx = steps.find((x) => !isDoneT(x)); const nb = nx && blockFor(nx);
  const lastB = blockFor(last); const lastId = lastB && !isDoneT(last) ? lastB.id : `task:${last.id}`;
  const bad = steps.some((x) => stepState(x, pre).st === 'bad');
  return `<section class="ch" style="--c:${esc(color)}"><h4><i></i><span>${esc(name)}</span><small>${esc(t('ch_progress', nd, steps.length))} · ${esc(nb ? t('ch_nextOn', relDay(nb.date)) : t('ch_nextUnplanned'))}${bad ? ' · ⚠' : ''}</small></h4>
    <div class="ch-prog"><i style="width:${(nd / steps.length) * 100}%"></i></div>
    ${steps.map((x, i) => stepHtml(x, i, pre, x === last)).join('')}
    ${ui.gr && !ui.gr.pv && ui.gr.from === lastId ? ghostHtml() : `<button type="button" class="ch-add" data-action="sc-addafter" data-id="${esc(lastId)}">＋ ${esc(t('ch_addAfter', last.title))}</button>`}</section>`;
}
function range(v, date) {
  if (v === 'week') { const w = weekStart(date); return [w, addDays(w, 6)]; }
  if (v === 'month') { const d = parseDate(date); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return [`${date.slice(0, 7)}-01`, `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`]; }
  return [date, date];
}
export function viewScaletta(v, date) {
  const key = `${v}|${date}`; if (ui.scKey && ui.scKey !== key) { ui.gr = null; ui.grPill = null; } ui.scKey = key;
  const [d0, d1] = range(v, date);
  const cs = chains(); const inChain = new Set(cs.flatMap((c) => c.steps.map((x) => x.id)));
  const inRange = (c) => c.steps.some((x) => blocksOf(x.id).some((b) => b.date >= d0 && b.date <= d1));
  const here = cs.filter(inRange); const others = cs.filter((c) => !inRange(c));
  const loose = []; for (let d = d0; d <= d1; d = addDays(d, 1)) loose.push(...blocksOn(d).filter((b) => !b.stepId && !(b.kind === 'prep' && b.parentId) && !(b.taskId && inChain.has(b.taskId))));
  const periodTxt = t(`ch_in_${v}`);
  const looseHtml = loose.length ? `<div class="ch-lb">${esc(t('ch_loose'))} <small>${esc(periodTxt)} · ${loose.length}</small></div><div class="ch-loose">${loose.slice(0, 60).map((b) => `<button type="button" style="--c:${esc(catColor(b.category) || 'var(--accent)')}" class="${outcomeOf(b) ? 'is-done' : ''}" data-action="open-block" data-id="${esc(b.id)}">${v === 'day' ? '' : `${esc(fmtDay(b.date, { weekday:'short', day:'numeric' }))} `}${esc(fmtTime(b.start))} · ${esc(b.title)}</button>`).join('')}</div>` : '';
  const day = v === 'day' ? `${behindCard(date)}${conflictBanner(date)}${dayBand(date)}` : '';
  return `<section class="plan-main sc-main">${planCard()}${day}
    ${cs.length ? '' : `<div class="ch-empty"><b>${esc(t('ch_emptyT'))}</b><p class="hint">${esc(t('ch_emptyS'))}</p></div>`}
    ${here.length ? `<div class="ch-lb">${esc(t('ch_here'))} <small>${esc(periodTxt)} · ${here.length}</small></div>${here.map(chainHtml).join('')}` : ''}
    ${others.length ? `<div class="ch-lb">${esc(here.length ? t('ch_others') : t('ch_all'))} <small>${others.length}</small></div>${others.map(chainHtml).join('')}` : ''}
    <button type="button" class="btn ch-new" data-action="sc-new">＋ ${esc(t('ch_new'))}</button>
    ${looseHtml}</section>${overlays()}`;
}

// ---------- clicks ----------
export function scClick(btn) {
  const { action, id } = btn.dataset; if (!action?.startsWith('sc-')) return false;
  switch (action) {
    case 'sc-step': ui.scOpen = ui.scOpen === id ? null : id; if (ui.gr) ui.gr = null; render(); return true;
    case 'sc-done': { const b = get('blocks', id); if (b && trySetBlockDone(b, true)) changed(); return true; }
    case 'sc-new': openPlus({}); toast(t('ch_newHint'), 5000); return true;
    case 'sc-addafter': ghostOpen(id, 'poi'); return true;
    case 'sc-agdone': ui.agDone = !ui.agDone; render(); return true;
    case 'sc-ext': { const b = get('blocks', id); if (b) { upsert('blocks', { ...b, minutes:(b.minutes || 30) + 15, auto:false }, { silent:true }); toast(t('agnExtended', fmtTime(b.start + b.minutes + 15))); changed(); } return true; }
    case 'sc-auto': {
      const x = get('tasks', id); if (!x) return true;
      const after = preOf(x).map((p) => get('tasks', p.id)).map((y) => y && blockFor(y)).filter(Boolean).map((b) => b.date).sort().pop();
      const from = after && after > today() ? after : today();
      for (let i = 0; i < 21; i++) { const d = addDays(from, i); const o = slotOptions(x, d, 1)[0]; if (o) { planTask(x, d, o.start - leadOf(x)); toast(t('ch_planned', x.title, relDay(d), fmtTime(o.start))); changed(); return true; } }
      toast(t('noFreeSlotDay')); return true;
    }
    default: return false;
  }
}
