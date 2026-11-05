// graph.js (v96): the links between things, for the Scaletta and the Map (Settings → Planner → Vista).
// Nothing new is stored for most links: they are read from, and written to, what the app already keeps.
//   ↓ Poi           task.after + task.afterNext (new: «right after»)      🔒 Prima serve   task.after
//   ⤷ Prepara       task.prep ([{taskId, when}], blocks kind 'prep')      ‖ In parallelo  block.par (new) + okWith
//   ✓ ✕ ⏰ rules    task.rules (when done | failed | missed)               📅 Legata a     task.eventId + eventOffset
// A rule that hasn't fired yet is a «branch» (a node with id `pot:<block>:<rule>`). Every link but ‖
// means «a comes before b». The guardrails (validate) say whether a new link is possible.
import { catColor, esc, planSettings, relDay, toast, ui } from './core.js';
import { t } from './i18n.js';
import { isEvent } from './kinds.js';
import { blocksOn, followParent, isApptLike, linkFor, outcomeOf, planTask, roomy } from './model.js';
import { addDays, fmtTime, nowMinutes, parseDate, today } from './plan.js';
import { changed, render } from './shell.js';
import { get, live, remove, uid, upsert } from './store.js';

export const LT = {
  prep: { i:'⤷', c:'var(--warn)', dash:'2 4' }, req: { i:'🔒', c:'var(--ink)', dash:'' }, poi: { i:'↓', c:'var(--muted)', dash:'' },
  par: { i:'‖', c:'var(--accent)', dash:'' }, ok: { i:'✓', c:'var(--green)', dash:'5 4' }, ko: { i:'✕', c:'var(--danger)', dash:'5 4' },
  miss: { i:'⏰', c:'var(--warn)', dash:'5 4' }, tied: { i:'📅', c:'#9b6fd0', dash:'6 4' },
};
export const PORTS = ['prep', 'req', 'poi', 'par', 'ok', 'ko', 'miss'];
// Where each port sits on a block (Settings: the layout chosen in the lab, P4 modified)
export const PORT_POS = { prep:'top', req:'left', poi:'bottom', par:'right', ok:'bl', ko:'br', miss:'tr' };
const WHEN_OF = { ok:'done', ko:'failed', miss:'missed' }; const TYPE_OF = { done:'ok', failed:'ko', missed:'miss' };
export const isBack = (k) => k === 'req' || k === 'prep' || k === 'tied';
export const lname = (k) => t(`gr_${k}`);

// ---------- nodes ----------
const dn = (date) => Math.round(parseDate(date) / 864e5);
export const T0 = (n) => dn(n.date) * 1440 + n.start; export const T1 = (n) => dn(n.date) * 1440 + n.start + n.minutes;
export function node(id) {
  if (!id) return null;
  if (id.startsWith('pot:')) { const [, bid, rid] = id.split(':'); const b = get('blocks', bid); const x = b && get('tasks', b.taskId); const r = (x?.rules || []).find((q) => q.id === rid); if (!r) return null;
    return { id, kind:'pot', b, rule:r, when:TYPE_OF[r.when], title: potTitle(x, r), category: b.category, date:null }; }
  if (id.startsWith('task:')) { const x = get('tasks', id.slice(5)); return x && { id, kind:'task', x, title:x.title, category:x.category, minutes:x.minutes || 30, date:null, done:x.done }; }
  if (id.startsWith('ev:')) { const e = live('events').find((q) => q.id === id.slice(3)); return e && { id, kind:'event', e, title:e.title, date:e.date, start:e.start, minutes:e.minutes, fixed:true, color:e.color }; }
  const b = get('blocks', id); if (!b) return null; const x = b.taskId && get('tasks', b.taskId);
  return { id, kind:'block', b, x, title:b.title, category:b.category || x?.category, date:b.date, start:b.start, minutes:b.minutes, fixed:Boolean(x && (isEvent(x) || isApptLike(x))), out:outcomeOf(b) };
}
export const planned = (n) => Boolean(n && n.date);
export const isPast = (n) => Boolean(n && (n.out === 'done' || n.done || (planned(n) && (n.date < today() || (n.date === today() && n.start + n.minutes <= nowMinutes())))));
export const colorOf = (n) => (n?.kind === 'event' ? n.color : catColor(n?.category)) || 'var(--accent)';
function potTitle(x, r) {
  if (r.then === 'groceries') return t('groceryTitle');
  const lk = r.taskId && get('tasks', r.taskId);
  if (lk && x && lk.id === x.id) return t('gr_retryOf', x.title);
  return lk?.title || r.title || t('followUp');
}
// the block of a task that a link points at: the last one ending before `near`, else the next one, else the last
export function blockOfTask(taskId, near = null) {
  const bs = live('blocks').filter((b) => b.taskId === taskId && b.kind !== 'prep' && !b.stepId).sort((a, b) => T0(a) - T0(b));
  if (!bs.length) return null;
  if (near) { const before = bs.filter((b) => T1(b) <= T0(near)); if (before.length) return before[before.length - 1]; }
  const td = today(); return bs.find((b) => !outcomeOf(b) && b.date >= td) || bs[bs.length - 1];
}
const okPairOn = (a, b) => upsert('blocks', { ...get('blocks', a.id), okWith:[...(get('blocks', a.id).okWith || []).filter((o) => o.id !== b.id), { id:b.id, date:a.date, start:a.start }] }, { silent:true });

// ---------- links of some blocks (plus the ends outside them) ----------
export function linksFor(blocks) {
  const out = []; const seen = new Set();
  const add = (l) => { const k = `${l.a}|${l.b}|${l.t}`; if (seen.has(k) || l.a === l.b) return; seen.add(k); out.push(l); };
  for (const b of blocks) {
    if (!b || b.deleted) continue;
    const x = b.taskId && get('tasks', b.taskId);
    if (x && b.kind !== 'prep' && b.kind !== 'followup') for (const pid of x.after || []) { if (!get('tasks', pid)) continue; const pb = blockOfTask(pid, b); add({ a: pb ? pb.id : `task:${pid}`, b:b.id, t:(x.afterNext || []).includes(pid) ? 'poi' : 'req', task:x.id, pre:pid }); }
    // the other side: tasks that need this one
    if (x && b.kind !== 'prep') for (const y of live('tasks').filter((q) => (q.after || []).includes(x.id) && !q.done)) { const yb = blockOfTask(y.id); if (yb && blockOfTask(x.id, yb)?.id !== b.id) continue; add({ a:b.id, b: yb ? yb.id : `task:${y.id}`, t:(y.afterNext || []).includes(x.id) ? 'poi' : 'req', task:y.id, pre:x.id }); }
    if (b.kind === 'prep' && b.parentId) { const par = get('blocks', b.parentId); const p = (get('tasks', par?.taskId)?.prep || []).find((q) => q.taskId === b.taskId); add({ a:b.id, b:b.parentId, t:'prep', l: p?.when === 'daybefore' ? t('pw_daybefore') : '', task:par?.taskId, prepTask:b.taskId }); }
    for (const c of live('blocks').filter((q) => q.parentId === b.id && q.kind === 'prep')) { const p = (x?.prep || []).find((q) => q.taskId === c.taskId); add({ a:c.id, b:b.id, t:'prep', l: p?.when === 'daybefore' ? t('pw_daybefore') : '', task:x?.id, prepTask:c.taskId }); }
    if (b.kind === 'followup' && b.sourceId) { const src = get('blocks', b.sourceId); const rid = b.id.split('_r_')[1]; const r = (get('tasks', src?.taskId)?.rules || []).find((q) => q.id === rid); if (src) add({ a:src.id, b:b.id, t:TYPE_OF[r?.when] || 'ok', fired:true }); }
    for (const [rid, tid] of Object.entries(b.ruleTasks || {})) { const r = (x?.rules || []).find((q) => q.id === rid); const tb = blockOfTask(tid); if (get('tasks', tid)) add({ a:b.id, b: tb ? tb.id : `task:${tid}`, t:TYPE_OF[r?.when] || 'ko', fired:true }); }
    if (x && !outcomeOf(b) && b.kind !== 'prep' && !b.stepId) for (const r of x.rules || []) {
      if (!WHEN_OF[TYPE_OF[r.when]] || r.stepId || get('blocks', `${b.id}_r_${r.id}`) || (b.ruleTasks || {})[r.id]) continue;
      add({ a:b.id, b:`pot:${b.id}:${r.id}`, t:TYPE_OF[r.when], task:x.id, rule:r.id });
    }
    if (x?.eventId) { const eb = blockOfTask(x.eventId); const off = Number(x.eventOffset) || 0; if (eb) add(off <= 0 ? { a:b.id, b:eb.id, t:'tied', l: off ? `−${-off} g` : '' } : { a:eb.id, b:b.id, t:'tied', l:`+${off} g` }); }
    if (x && isEvent(x)) for (const y of live('tasks').filter((q) => q.eventId === x.id && !q.done)) { const yb = blockOfTask(y.id); const off = Number(y.eventOffset) || 0; if (yb) add(off <= 0 ? { a:yb.id, b:b.id, t:'tied', l: off ? `−${-off} g` : '' } : { a:b.id, b:yb.id, t:'tied', l:`+${off} g` }); }
    for (const pid of b.par || []) if (get('blocks', pid)) add({ a:b.id, b:pid, t:'par' });
    for (const o of live('blocks').filter((q) => (q.par || []).includes(b.id))) add({ a:o.id, b:b.id, t:'par' });
    if (roomy(b)) for (const o of blocksOn(b.date)) if (o.id !== b.id && !roomy(o) && o.start < b.start + b.minutes && b.start < o.start + o.minutes) add({ a:b.id, b:o.id, t:'par', l:t('gr_inside') });
  }
  return out;
}

// ---------- guardrails ----------
function recheck(v) {
  if (!v.fix || v.fix.unplan) return v;
  const b = get('blocks', v.fix.id); const keep = { date:b.date, start:b.start };
  Object.assign(b, { date:v.fix.date, start:v.fix.start }); let bad = null;
  for (const l of linksFor([b]).filter((q) => q.t !== 'par' && !q.b.startsWith('pot:'))) { const a = node(l.a), c = node(l.b); if (!planned(a) || !planned(c)) continue; if (T1(a) > T0(c)) { const o = a.id === b.id ? c : a; if (o.fixed || isPast(o)) { bad = o; break; } } }
  Object.assign(b, keep);
  if (bad) return { lvl:'block', msg:t('gr_chain', b.title, bad.title, bad.fixed ? t('gr_fixedL') : t('gr_doneL'), when(bad)) };
  return { ...v, fixLabel:t('gr_linkMove', b.title, relDay(v.fix.date), fmtTime(v.fix.start)) };
}
export const when = (n) => (planned(n) ? `${relDay(n.date)} ${fmtTime(n.start)}` : t('gr_unplanned'));
function hasPath(a, b, seen = new Set()) {
  if (a === b) return true; if (seen.has(a)) return false; seen.add(a);
  const n = node(a); if (!n || n.kind !== 'block') return false;
  return linksFor([n.b]).some((l) => l.t !== 'par' && l.a === a && hasPath(l.b, b, seen));
}
function afterSlot(pre, len) { const s = planSettings(); let d = pre.date, st = pre.start + pre.minutes + (s.buffer || 5); if (st + len > s.dayEnd) { d = addDays(d, 1); st = s.dayStart; } return { date:d, start:Math.ceil(st / 5) * 5 }; }
export function validate(fromId, k, toId) {
  const F = node(fromId), T = node(toId);
  if (!F || !T) return { lvl:'block', msg:'—' };
  if (fromId === toId) return { lvl:'block', msg:t('gr_self') };
  const dup = linksFor([F.b].filter(Boolean)).find((l) => (l.a === fromId && l.b === toId) || (l.a === toId && l.b === fromId));
  if (dup) return { lvl:'block', msg:t('gr_dup', `${LT[dup.t].i} ${lname(dup.t)}`) };
  if (T.kind === 'event' && k !== 'req' && k !== 'par') return { lvl:'block', msg:t('gr_gcal') };
  if (k === 'par') {
    if (T.kind === 'task') return { lvl:'ok', msg:t('gr_parTo', T.title, F.title, when(F)), plan:{ taskId:T.x.id, date:F.date, start:F.start } };
    if (F.date === T.date && T0(F) < T1(T) && T0(T) < T1(F)) return { lvl:'ok', msg:t('gr_parSame') };
    const mv = !T.fixed && !isPast(T) && T.kind === 'block' ? T : !F.fixed && !isPast(F) ? F : null;
    if (!mv) return { lvl:'block', msg:t('gr_parNo', when(F), when(T)) };
    const o = mv === T ? F : T;
    return recheck({ lvl:'warn', msg:t('gr_parWarn', T.title, when(T)), fix:{ id:mv.id, date:o.date, start:o.start } });
  }
  const [pre, post] = isBack(k) ? [T, F] : [F, T];
  if (hasPath(post.id, pre.id)) return { lvl:'block', msg:t('gr_cycle', post.title, pre.title) };
  if (k === 'ok' || k === 'ko' || k === 'miss') {
    if (T.kind === 'event') return { lvl:'block', msg:t('gr_gcal') };
    if (planned(T)) return { lvl:'warn', msg:t('gr_branchPlanned', T.title, when(T)), fix:{ id:T.id, unplan:true }, fixLabel:t('gr_branchFix') };
    return { lvl:'ok', msg:t('gr_branchOk', T.title) };
  }
  if (k === 'prep' && T.kind !== 'task' && T.x && T.x.kind !== 'step') return { lvl:'warn', msg:t('gr_prepAsReq', T.title), asReq:true, fixLabel:t('gr_linkAsReq') };
  if (!planned(pre) || !planned(post)) return { lvl:'ok', msg:t('gr_orderLater', pre.title, post.title) };
  if (T1(pre) <= T0(post)) return { lvl:'ok', msg:t('gr_inOrder', pre.title, when(pre), post.title, when(post)) };
  if (isPast(post)) return { lvl:'block', msg:t('gr_past', post.title, when(post), pre.title) };
  if (!post.fixed && post.kind === 'block') return recheck({ lvl:'warn', msg:t('gr_wrongOrder', pre.title, when(pre), post.title, when(post)), fix:{ id:post.id, ...afterSlot(pre, post.minutes) } });
  if (!pre.fixed && !isPast(pre) && pre.kind === 'block') return recheck({ lvl:'warn', msg:t('gr_wrongOrderFixed', pre.title, post.title), fix:{ id:pre.id, date:post.date, start:Math.max(planSettings().dayStart, post.start - pre.minutes - 30) } });
  return { lvl:'block', msg:t('gr_twoFixed', when(pre), when(post)) };
}

// ---------- making links ----------
const taskOfNode = (n) => (n.kind === 'block' ? n.x : n.kind === 'task' ? n.x : null);
function addAfter(post, pre, next = false) {
  const p = get('tasks', post.id);
  upsert('tasks', { ...p, after:[...new Set([...(p.after || []), pre.id])], afterNext: next ? [...new Set([...(p.afterNext || []), pre.id])] : (p.afterNext || []).filter((i) => i !== pre.id) }, { silent:true });
}
function newTodo(title, from, minutes = 30) {
  return upsert('tasks', { id:uid(), createdAt:Date.now(), kind:'todo', title, minutes, category:from?.category || null, importance:from?.importance || 3, due:null, repeat:null, notes:'', done:false, checklist:[], rules:[], steps:[], lenSet:true }, { silent:true });
}
// A new thing from a port of a block.
export function createFrom(fromId, k, title, ready = null) {
  const F = node(fromId); if (!F || F.kind !== 'block') return null; const x = F.x; const b = F.b; const s = planSettings();
  if (!x) { toast(t('gr_needTask')); return null; }
  if (k === 'ok' || k === 'ko' || k === 'miss') {
    const rule = ready?.retry ? { id:uid().slice(0, 6), when:WHEN_OF[k], then:'task', taskId:x.id, place:ready.place || 'pool' } : ready?.groceries ? { id:uid().slice(0, 6), when:WHEN_OF[k], then:'groceries', place:'before' } : { id:uid().slice(0, 6), when:WHEN_OF[k], then:'task', title, minutes:30, place:'pool' };
    upsert('tasks', { ...get('tasks', x.id), rules:[...(get('tasks', x.id).rules || []), rule] }, { silent:true });
    toast(t('gr_madeBranch', `${LT[k].i} ${lname(k)}`, potTitle(x, rule))); changed(); return null;
  }
  if (k === 'prep') {
    const pt = upsert('tasks', { id:uid(), createdAt:Date.now(), kind:'step', title, minutes:10, category:x.category || null, checklist:[], rules:[], steps:[], done:false }, { silent:true });
    const whenP = b.start < 12 * 60 ? 'daybefore' : 'before';
    upsert('tasks', { ...get('tasks', x.id), prep:[...(get('tasks', x.id).prep || []), { taskId:pt.id, when:whenP }] }, { silent:true });
    linkFor(get('blocks', b.id)); toast(t('gr_made', `${LT[k].i} ${lname(k)}`, title)); changed(); return pt;
  }
  const n = newTodo(title, x, ready?.minutes || 30);
  if (k === 'poi') { addAfter(n, x, true); planTask(get('tasks', n.id), b.date, b.start + b.minutes); }
  if (k === 'req') { addAfter(x, n, false); const st = b.start - (n.minutes || 30) - (s.buffer || 5); if (st >= s.dayStart && b.date >= today()) planTask(get('tasks', n.id), b.date, Math.floor(st / 5) * 5); }
  if (k === 'par') { const nb = planTask(get('tasks', n.id), b.date, b.start); upsert('blocks', { ...get('blocks', b.id), par:[...new Set([...(get('blocks', b.id).par || []), nb.id])] }, { silent:true }); okPairOn(get('blocks', b.id), nb); okPairOn(nb, get('blocks', b.id)); }
  toast(t('gr_made', `${LT[k].i} ${lname(k)}`, title)); changed(); return n;
}
// Link a block to something that exists; `fix` = apply the move the guardrail proposed.
export function linkExisting(fromId, k, toId, v, fix = true) {
  const F = node(fromId), T = node(toId); if (!F || !T) return;
  if (fix && v?.fix) {
    if (v.fix.unplan) { for (const q of live('blocks').filter((z) => z.taskId === T.x?.id && !outcomeOf(z) && z.date >= today())) remove('blocks', q.id); }
    else { const m = upsert('blocks', { ...get('blocks', v.fix.id), date:v.fix.date, start:v.fix.start, auto:false }, { silent:true }); followParent(m); }
  }
  const fx = taskOfNode(F), tx = taskOfNode(T);
  let kk = k; if (k === 'prep' && v?.asReq) kk = 'req';
  if (kk === 'par') {
    if (T.kind === 'task') { const nb = planTask(get('tasks', T.x.id), F.date, F.start); upsert('blocks', { ...get('blocks', F.id), par:[...new Set([...(get('blocks', F.id).par || []), nb.id])] }, { silent:true }); okPairOn(get('blocks', F.id), nb); okPairOn(nb, get('blocks', F.id)); }
    else if (T.kind === 'block') { upsert('blocks', { ...get('blocks', F.id), par:[...new Set([...(get('blocks', F.id).par || []), T.id])] }, { silent:true }); okPairOn(get('blocks', F.id), get('blocks', T.id)); okPairOn(get('blocks', T.id), get('blocks', F.id)); }
  } else if (kk === 'ok' || kk === 'ko' || kk === 'miss') {
    if (fx && tx) upsert('tasks', { ...get('tasks', fx.id), rules:[...(get('tasks', fx.id).rules || []), { id:uid().slice(0, 6), when:WHEN_OF[kk], then:'task', taskId:tx.id, place:'pool' }] }, { silent:true });
  } else if (kk === 'prep' && fx && tx) {
    upsert('tasks', { ...get('tasks', fx.id), prep:[...(get('tasks', fx.id).prep || []), { taskId:tx.id, when:'before' }] }, { silent:true }); linkFor(get('blocks', F.id));
  } else if (fx && tx) {
    if (isBack(kk)) addAfter(fx, tx, false); else addAfter(tx, fx, kk === 'poi');
  } else if (T.kind === 'event') { toast(t('gr_gcal')); return; }
  toast(t('gr_linked', `${LT[k].i} ${lname(k)}`, T.title)); changed();
}
export function unlink(l) {
  if (l.t === 'req' || l.t === 'poi') { const p = get('tasks', l.task); if (p) upsert('tasks', { ...p, after:(p.after || []).filter((i) => i !== l.pre), afterNext:(p.afterNext || []).filter((i) => i !== l.pre) }, { silent:true }); }
  else if (l.t === 'prep') { const p = get('tasks', l.task); if (p) upsert('tasks', { ...p, prep:(p.prep || []).filter((q) => q.taskId !== l.prepTask) }, { silent:true }); const pb = get('blocks', l.a); if (pb?.kind === 'prep' && !outcomeOf(pb)) remove('blocks', pb.id); }
  else if (l.rule) { const p = get('tasks', l.task); if (p) upsert('tasks', { ...p, rules:(p.rules || []).filter((r) => r.id !== l.rule) }, { silent:true }); }
  else if (l.t === 'par') { for (const [a, b] of [[l.a, l.b], [l.b, l.a]]) { const x = get('blocks', a); if (x) upsert('blocks', { ...x, par:(x.par || []).filter((i) => i !== b), okWith:(x.okWith || []).filter((o) => o.id !== b) }, { silent:true }); } }
  else { toast(t('gr_cantUnlink')); return; }
  toast(t('gr_unlinked')); changed();
}
// «Poi» ↔ «Prima serve»: the only change of type that keeps its meaning
export function flip(l) { if (l.t !== 'req' && l.t !== 'poi') return; const p = get('tasks', l.task); if (!p) return; const nx = new Set(p.afterNext || []); if (l.t === 'req') nx.add(l.pre); else nx.delete(l.pre); upsert('tasks', { ...p, afterNext:[...nx] }, { silent:true }); changed(); }

// ---------- shared UI: the ghost node, the preview bar ----------
const READY = { poi:['gr_r_shower','gr_r_send','gr_r_home'], par:['gr_r_music','gr_r_wash','gr_r_mail'], ko:['gr_r_retry','gr_r_groceries','gr_r_tell'], req:['gr_r_buy','gr_r_book'], prep:['gr_r_bag','gr_r_print','gr_r_check'], ok:['gr_r_progress','gr_r_pay'], miss:['gr_r_tomorrow'] };
const READY_X = { gr_r_retry:{ retry:true }, gr_r_tomorrow:{ retry:true, place:'tomorrow' }, gr_r_groceries:{ groceries:true } };
export function ghostOpen(fromId, k) { ui.gr = { from:fromId, k, q:'', pv:null }; render(); setTimeout(() => document.getElementById('gr-q')?.focus(), 30); }
function suggestions(F, k, q) {
  const near = (n) => (n.category === F.category ? 0 : 1e7) + Math.abs((planned(n) ? T0(n) : 1e9) - T0(F));
  const td = today(); const from = addDays(td, -7), to = addDays(td, 35);
  const bl = live('blocks').filter((b) => b.id !== F.id && b.kind !== 'prep' && !b.stepId && b.date >= from && b.date <= to && !(b.seriesId && b.seriesId === F.b?.seriesId)).map((b) => node(b.id));
  const tk = live('tasks').filter((x) => !x.done && x.kind === 'todo' && !live('blocks').some((b) => b.taskId === x.id)).map((x) => node(`task:${x.id}`));
  const ql = q.toLowerCase();
  return [...bl, ...tk].filter((n) => n && (!q || n.title.toLowerCase().includes(ql))).sort((a, b) => near(a) - near(b)).slice(0, q ? 8 : 5);
}
export function ghostHtml() {
  const g = ui.gr; if (!g) return ''; const F = node(g.from); if (!F) return ''; const k = g.k; const q = g.q.trim();
  const ready = (READY[k] || []).filter((key) => !q || t(key).toLowerCase().includes(q.toLowerCase()));
  return `<div class="gr-ghost" style="--pc:${LT[k].c}"><div class="gr-gk">${LT[k].i} ${esc(lname(k))} · ${esc(F.title)}</div>
    <input id="gr-q" class="gr-in" placeholder="${esc(t(`gr_ph_${k}`))}" value="${esc(g.q)}" autocomplete="off" enterkeyhint="done">
    <div class="gr-chips">${q ? `<button type="button" class="gr-chip new" data-action="gr-create" data-id="${esc(q)}">＋ ${esc(t('gr_create', q))}</button>` : ''}${ready.map((key) => `<button type="button" class="gr-chip" data-action="gr-ready" data-id="${key}">${esc(key === 'gr_r_retry' ? t('gr_retryOf', F.title) : t(key))}</button>`).join('')}</div>
    <div class="gr-lb">${esc(t('gr_existing'))}</div><div class="gr-chips col">${suggestions(F, k, q).map((n) => { const v = validate(F.id, k, n.id); return `<button type="button" class="gr-chip ex lv-${v.lvl}" data-action="gr-ex" data-id="${esc(n.id)}" title="${esc(v.msg)}"><span>${v.lvl === 'block' ? '⛔' : v.lvl === 'warn' ? '⚠' : '↗'} ${esc(n.title)}</span><small>${esc(when(n))}</small></button>`; }).join('')}</div>
    <div class="gr-chips"><button type="button" class="gr-chip" data-action="gr-cancel">${esc(t('cancel'))}</button></div></div>`;
}
function miniTimeline(v, F, T) {
  const ns = [F, T].filter(planned); if (!ns.length) return '';
  const all = [...ns.map(T0), ...ns.map(T1), v.fix && !v.fix.unplan ? dn(v.fix.date) * 1440 + v.fix.start : null].filter((q) => q != null);
  const d0 = Math.floor(Math.min(...all) / 1440), d1 = Math.max(d0 + 2, Math.ceil(Math.max(...all) / 1440)); const span = (d1 - d0) * 1440;
  const pos = (m) => ((m - d0 * 1440) / span) * 100;
  const row = (lab, after) => `<div class="gr-mt-row"><span class="gr-mt-l">${esc(lab)}</span><div class="gr-mt-tr">${Array.from({ length:d1 - d0 }, (_, i) => `<i style="left:${(i / (d1 - d0)) * 100}%">${esc(relDay(addDays(today(), d0 + i - dn(today()))).split(' ')[0])}</i>`).join('')}
    ${[F, T].map((n, i) => { if (!planned(n)) return `<em class="un" style="--c:${colorOf(n)}">${esc(n.title)} · ?</em>`; const moved = after && v.fix && !v.fix.unplan && v.fix.id === n.id; const m = moved ? dn(v.fix.date) * 1440 + v.fix.start : T0(n); return `<em class="${moved ? 'moved' : ''}" style="--c:${colorOf(n)};left:${pos(m)}%;top:${3 + i * 15}px">${esc(n.title)}</em>`; }).join('')}</div></div>`;
  return `<div class="gr-mt">${row(t('gr_now'), false)}${v.fix && !v.fix.unplan ? row(t('gr_after'), true) : ''}</div>`;
}
export function previewHtml() {
  const g = ui.gr; if (!g?.pv) return ''; const v = g.pv.v; const F = node(g.from), T = node(g.pv.to); if (!F || !T) return '';
  return `<div class="gr-pv lv-${v.lvl}"><b>${esc(t(`gr_lvl_${v.lvl}`))}</b><small>${LT[g.k].i} ${esc(lname(g.k))} · ${esc(F.title)} ↔ ${esc(T.title)}</small><p>${esc(v.msg)}</p>${miniTimeline(v, F, T)}
    <div class="gr-pvb">${v.lvl === 'block' ? `<button type="button" class="btn small primary" data-action="gr-pv-x">${esc(t('gr_gotIt'))}</button>`
    : v.lvl === 'warn' ? `<button type="button" class="btn small primary" data-action="gr-pv-fix">${esc(v.fixLabel || t('gr_link'))}</button>${!v.fix?.unplan && !v.asReq && g.k !== 'par' ? `<button type="button" class="btn small" data-action="gr-pv-any">${esc(t('gr_linkAnyway'))}</button>` : ''}<button type="button" class="btn small" data-action="gr-pv-x">${esc(t('cancel'))}</button>`
    : `<button type="button" class="btn small primary" data-action="gr-pv-fix">${esc(t('gr_link'))}</button><button type="button" class="btn small" data-action="gr-pv-x">${esc(t('cancel'))}</button>`}</div></div>`;
}
export function linkPill(l) { return `<button type="button" class="gr-pill" style="--jc:${LT[l.t].c}" data-action="gr-pill" data-id="${esc(`${l.a}|${l.b}|${l.t}`)}">${LT[l.t].i} ${esc(lname(l.t))}${l.l ? ' · ' + esc(l.l) : ''}</button>`; }
// Tapping a link: Poi ↔ Prima serve, or unlink
function openPill(key) {
  const [a, b, tt] = key.split('|'); const n = node(a) || node(b); if (!n) return;
  const l = linksFor([n.b].filter(Boolean)).find((q) => q.a === a && q.b === b && q.t === tt) || linksFor([node(b)?.b].filter(Boolean)).find((q) => q.a === a && q.b === b && q.t === tt); if (!l) return;
  ui.grPill = l; render();
}
export function pillMenuHtml() {
  const l = ui.grPill; if (!l) return ''; const A = node(l.a), B = node(l.b);
  return `<div class="gr-menu"><b>${LT[l.t].i} ${esc(lname(l.t))}</b><small>${esc(A?.title || '')} → ${esc(B?.title || '')}</small>
    <div class="gr-pvb">${l.t === 'req' || l.t === 'poi' ? `<button type="button" class="btn small" data-action="gr-flip">${esc(t(l.t === 'req' ? 'gr_toPoi' : 'gr_toReq'))}</button>` : ''}${l.t !== 'tied' && !l.fired ? `<button type="button" class="btn small" data-action="gr-unlink">${esc(t('gr_unlink'))}</button>` : ''}<button type="button" class="btn small primary" data-action="gr-menu-x">${esc(t('close'))}</button></div></div>`;
}
// clicks for everything above; true when handled
export function graphClick(btn) {
  const { action, id } = btn.dataset; if (!action?.startsWith('gr-')) return false;
  const g = ui.gr;
  switch (action) {
    case 'gr-port': { const [nid, k] = id.split('~'); ghostOpen(nid, k); return true; }
    case 'gr-cancel': ui.gr = null; render(); return true;
    case 'gr-create': { if (!g) return true; createFrom(g.from, g.k, id); ui.gr = null; render(); return true; }
    case 'gr-ready': { if (!g) return true; const F = node(g.from); const x = READY_X[id] || {}; createFrom(g.from, g.k, id === 'gr_r_retry' ? t('gr_retryOf', F?.title || '') : t(id), x); ui.gr = null; render(); return true; }
    case 'gr-ex': { if (!g) return true; g.pv = { to:id, v:validate(g.from, g.k, id) }; render(); return true; }
    case 'gr-pv-x': if (g) g.pv = null; render(); return true;
    case 'gr-pv-fix': { if (!g?.pv) return true; const { to, v } = g.pv; ui.gr = null; linkExisting(g.from, g.k, to, v, true); return true; }
    case 'gr-pv-any': { if (!g?.pv) return true; const { to, v } = g.pv; ui.gr = null; linkExisting(g.from, g.k, to, v, false); return true; }
    case 'gr-pill': openPill(id); return true;
    case 'gr-menu-x': ui.grPill = null; render(); return true;
    case 'gr-flip': if (ui.grPill) flip(ui.grPill); ui.grPill = null; render(); return true;
    case 'gr-unlink': if (ui.grPill) unlink(ui.grPill); ui.grPill = null; render(); return true;
    default: return false;
  }
}
// drop a port on a node (the map): ok links straight away, otherwise the preview
export function dropOn(fromId, k, toId) {
  const v = validate(fromId, k, toId);
  ui.gr = { from:fromId, k, q:'', pv:{ to:toId, v } }; render();
}
document.addEventListener('input', (e) => { if (e.target.id === 'gr-q' && ui.gr) { ui.gr.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.getElementById('gr-q'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* */ } } } });
document.addEventListener('keydown', (e) => { if (e.target.id === 'gr-q' && e.key === 'Enter' && ui.gr?.q.trim()) { e.preventDefault(); const g = ui.gr; createFrom(g.from, g.k, g.q.trim()); ui.gr = null; render(); } if (e.key === 'Escape' && (ui.gr || ui.grPill)) { ui.gr = null; ui.grPill = null; render(); } });
