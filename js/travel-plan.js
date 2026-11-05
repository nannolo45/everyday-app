// travel-plan.js: moved from app.js (v36). See app.js for how the modules fit together.
import { t } from './i18n.js';
import { isSaved, isStep, withKind } from './kinds.js';
import { parseDate, today } from './plan.js';
import { get, live, remove, saveSettings, state, uid, upsert } from './store.js';
import { isConfigured } from './sync.js';
import { cachedMinutes, MODES as TRAVEL_MODES, travelMinutes, UNKNOWN_MINUTES } from './travel.js';
import { anchorIndex, busyOn, nextBlockOf, outcomeOf, travelTasks } from './model.js';
import { render, scheduleSync } from './shell.js';
import { placeAddress, placeById } from './places.js';

// ---------- travel ----------
// A task with a place gets travel steps: "Get there" before it (on unless switched off) and
// "Come back" after it (off unless switched on). They are real steps with fixed ids, so they show
// on the plan, can be ticked and count in the task's length; the editor keeps them out of the
// editable list. A task without steps of its own gets a hidden "main" step for its own length.
export const TRV = { there: 'trv_there', back: 'trv_back', main: 'trv_main', buffer: 'trv_buf' };
export const isTravelStep = (y) => Boolean(y?.travel) || Boolean(y?.main) || Boolean(y?.buffer);
export const realSteps = (task) => (task?.steps || []).filter((y) => y.title && !isTravelStep(y));
// The leg's step that carries the looked-up time (a leg built from a saved task with steps has more).
export const travelStep = (task, kind) => (task?.steps || []).find((y) => y.travel === kind && y.lookup !== false) || null;
export const legMinutes = (task, kind) => (task?.steps || []).filter((y) => y.travel === kind).reduce((n, y) => n + (Number(y.minutes) || 0), 0);
// "Get there" and "Come back" are saved tasks (`travelRole`): rename them, give them steps. The step
// marked ⚓ (else the first) gets the travel time; the other steps keep their own length.
export const LEGS = ['there', 'back'];
export function legTemplate(kind) { return live('tasks').filter((x) => x.travelRole === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null; }
export function ensureLegTasks() {
  let made = false;
  if (isConfigured() && !state.meta.lastSync) return false; // wait for the first sync: another device may have them
  for (const kind of LEGS) {
    // Two devices made one each before syncing: drop the newer one if it's still untouched.
    const dups = live('tasks').filter((x) => x.travelRole === kind).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(1);
    for (const d of dups) if (!realSteps(d).length && d.title === t(kind === 'there' ? 'getThere' : 'comeBack')) { remove('tasks', d.id); made = true; }
    if (legTemplate(kind)) continue;
    upsert('tasks', { id: uid(), title: t(kind === 'there' ? 'getThere' : 'comeBack'), kind: 'saved', travelRole: kind, minutes: 30, steps: [], checklist: [], notes: '', category: '', createdAt: Date.now() }, { silent: true });
    made = true;
  }
  return made;
}
export function setLegTask(kind, id) {
  for (const x of live('tasks').filter((y) => y.travelRole === kind && y.id !== id)) upsert('tasks', { ...x, travelRole: null }, { silent: true });
  const x = get('tasks', id);
  if (x && x.travelRole !== kind) upsert('tasks', withKind({ ...x, travelRole: kind }, 'saved'), { silent: true });
}
// Margin after a task: its own, or the default from Settings → Planner.
export function bufferOf(task) { const b = task?.buffer; return b == null || b === '' ? Number(state.settings.taskBuffer) || 0 : Number(b) || 0; }
// The task's own length, without travel.
export function ownMinutes(task) {
  const rs = realSteps(task);
  if (rs.length) return rs.reduce((n, y) => n + (Number(y.minutes) || 10), 0);
  const m = (task?.steps || []).find((y) => y.main);
  return Number(m?.minutes) || Number(task?.minutes) || 30;
}
export function travelCfg() { const s = state.settings.travel || {}; return { home: '', mode: 'transit', buffer: 5, googleKey: '', startHere: false, thereDefault: 'place', backDefault: s.back ? 'place' : 'off', ...s }; }
// (v90) A saved place can carry its own default (`travel` on the place); the task's own `travel` wins.
// `from` / `to`: 'auto' (where you'll be before / where you go next, else home), 'home', or a saved place's id;
// `thereMin` / `backMin`: fixed minutes (null = looked up). No outward leg or no return: `there` / `back` false.
export function travelOf(task) {
  const c = travelCfg(); const p = task?.placeId ? placeById(task.placeId) : null;
  return { there: c.thereDefault !== 'off', back: c.backDefault !== 'off', mode: 'default', from: 'auto', to: 'auto', thereMin: null, backMin: null, ...(p?.travel || {}), ...(task?.travel || {}) };
}
// An end chosen by hand: its address ('' for 'auto').
export const endAddress = (v) => (v === 'home' ? travelCfg().home : String(v || '').startsWith('addr:') ? v.slice(5) : v && v !== 'auto' && v !== 'none' ? placeAddress(placeById(v)) : ''); // (v94) 'addr:…' = an address not saved as a place
export const travelAffected = (x) => x.place || x.steps?.some((y) => y.travel || y.buffer) || travelCfg().thereDefault === 'always' || travelCfg().backDefault === 'always' || bufferOf(x) > 0;
export const travelMode = (task) => { const m = travelOf(task).mode; return TRAVEL_MODES.includes(m) ? m : travelCfg().mode; };
export const travelCache = () => state.settings.travelCache || {};
export function hereNow(date = today()) {
  const c = travelCfg(); const h = state.settings.here;
  return c.startHere && h && today(new Date(h.at)) === date ? `${h.lat},${h.lon}` : '';
}
// Where a trip starts: the place of the last planned task before it that day that doesn't come
// home again; otherwise where you are (today, if you let the app use your location) or home.
export function originFor(task, block = null) {
  const c = travelCfg();
  const own = endAddress(travelOf(task).from); if (own) return own;
  const date = block?.date || null;
  if (block) {
    const before = busyOn(date).filter((b) => b.id !== block.id && b.taskId && b.taskId !== task.id && b.start + b.minutes <= block.start + 1)
      .sort((a, b) => b.start - a.start);
    for (const b of before) {
      const tk = get('tasks', b.taskId);
      if (tk?.place) return travelOf(tk).back ? travelDest(tk, b) : tk.place; // (v90) where its return went
    }
  }
  return (date ? hereNow(date) : '') || c.home;
}
// Where the return goes: the end chosen by hand; else (v90) the place of what comes right after on that day
// (within an hour); else where you are, or home.
export function travelDest(task, block = null) {
  const own = endAddress(travelOf(task).to); if (own) return own;
  if (block) {
    const end = block.start + (block.minutes || 0);
    const nb = busyOn(block.date).filter((b) => b.id !== block.id && b.taskId && b.taskId !== task.id && b.start >= end - 1 && b.start - end <= 60).sort((a, b) => a.start - b.start)[0];
    const tk = nb && get('tasks', nb.taskId);
    if (tk?.place) return tk.place;
  }
  return hereNow() || travelCfg().home;
}
// (Re)build a task's steps around its travel, using what's cached; returns the task with
// `minutes` and `steps` updated, and marks what still needs fetching.
export function withTravel(task, { origin = null, block = null } = {}) {
  const tv = travelOf(task);
  const c = travelCfg();
  const rs = realSteps(task);
  const own = ownMinutes(task);
  const mode = travelMode(task);
  const core = rs.length ? rs : [{ id: TRV.main, title: task.title, minutes: own, main: true }];
  const total = (steps) => steps.reduce((n, y) => n + (Number(y.minutes) || 0), 0);
  if (isStep(task) || task.travelRole) return { ...task, steps: rs, minutes: own };
  const buf = bufferOf(task);
  const bufSteps = buf > 0 ? [{ id: TRV.buffer, title: t('bufferStep'), buffer: true, minutes: buf }] : [];
  // A leg: the saved task's title and steps, with the looked-up time on its ⚓ step (else its only step).
  const legOf = (kind, look) => {
    const tpl = legTemplate(kind);
    const name = tpl?.title || t(kind === 'there' ? 'getThere' : 'comeBack');
    const subs = realSteps(tpl);
    if (!subs.length) return [{ ...look, title: name }];
    const ai = Math.min(anchorIndex(subs, tpl.anchorStepId), subs.length - 1);
    return subs.map((y, i) => (i === ai ? { ...look, title: y.title || name }
      : { id: `${TRV[kind]}_${y.id}`, title: y.title, travel: kind, lookup: false, mode, from: '', to: '', minutes: Number(y.minutes) || 10, known: true, pending: false }));
  };
  const placeholder = (kind) => ({ id: TRV[kind], travel: kind, mode, from: '', to: '', minutes: UNKNOWN_MINUTES, known: false, pending: false, noPlace: true });
  if (!task.place) {
    // "Always": without a place the leg is a "?" reminder to account for the trip.
    const there = tv.there && c.thereDefault === 'always' && !isSaved(task) ? legOf('there', placeholder('there')) : [];
    const back = tv.back && c.backDefault === 'always' && !isSaved(task) ? legOf('back', placeholder('back')) : [];
    if (!there.length && !back.length && !bufSteps.length) return { ...task, steps: rs, minutes: own };
    const steps = [...there, ...core, ...back, ...bufSteps];
    return { ...task, steps, minutes: total(steps) };
  }
  if (!tv.there && !tv.back) {
    const steps = bufSteps.length ? [...core, ...bufSteps] : rs;
    return { ...task, steps, minutes: bufSteps.length ? total(steps) : own };
  }
  const from = origin ?? originFor(task, block);
  const mk = (kind, a, b, old) => {
    const to = kind === 'there' ? task.place : travelDest(task, block);
    const fixed = tv[kind === 'there' ? 'thereMin' : 'backMin'];
    if (fixed != null && fixed !== '' && Number.isFinite(Number(fixed))) return legOf(kind, { id: TRV[kind], travel: kind, mode, from: a, to, minutes: Number(fixed), known: true, pending: false, fixed: true });
    const m = cachedMinutes(travelCache(), mode, a, b);
    const known = m != null && m !== undefined;
    return legOf(kind, { id: TRV[kind], travel: kind, mode, from: a, to,
      minutes: known ? m + (m ? Number(c.buffer) || 0 : 0) : (old?.known ? old.minutes : UNKNOWN_MINUTES), known, pending: m === undefined });
  };
  const steps = [];
  if (tv.there) steps.push(...mk('there', from, task.place, travelStep(task, 'there')));
  steps.push(...core);
  if (tv.back) steps.push(...mk('back', task.place, travelDest(task, block), travelStep(task, 'back')));
  steps.push(...bufSteps);
  return { ...task, steps, minutes: total(steps) };
}
// Apply the travel steps to a saved task and move its blocks so the task itself stays at its time
// (travel grows or shrinks in front of it). Returns the stored task.
// (v90) The legs as they'd be now, for the route line: { there, back } (each a step or null).
export function routeOf(task, block = null) {
  const w = withTravel(task, { block });
  const st = (k) => (w.steps || []).find((y) => y.travel === k && y.lookup !== false) || null;
  return { there: st('there'), back: st('back') };
}
export function applyTravel(task, opts = {}) {
  const block = opts.block || nextBlockOf(task.id);
  const next = withTravel(task, { ...opts, block });
  const prev = opts.prev || task; // what the blocks were sized for
  const same = JSON.stringify(next.steps) === JSON.stringify(task.steps) && next.minutes === task.minutes && prev === task;
  if (same) return task;
  const oldThere = legMinutes(prev, 'there');
  const newThere = legMinutes(next, 'there');
  const saved = upsert('tasks', next, { silent: true });
  for (const b of live('blocks').filter((x) => x.taskId === task.id && !x.stepId && !outcomeOf(x) && x.date >= today() && x.kind !== 'prep')) {
    const delta = (next.minutes || 0) - (prev.minutes || 0);
    if (!delta && oldThere === newThere) continue;
    upsert('blocks', { ...b, start: Math.max(0, b.start - (newThere - oldThere)), minutes: Math.max(5, b.minutes + delta) }, { silent: true });
  }
  return saved;
}
// Fetch the travel times that are missing, one at a time (the free services ask for that), and
// apply them. Runs a moment after anything changes; does nothing when all is known.
export let travelTimer = null; export let travelBusy = false; export let travelAgain = false;
// Looked-up places and routes are kept two months, then looked up again (and the cache stays small).
export const CACHE_DAYS = 60;
export function pruneCache(c, now = Date.now()) {
  const keep = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v && now - (v.at || 0) < CACHE_DAYS * 864e5));
  return { ...c, geo: keep(c?.geo), routes: keep(c?.routes) };
}
export function scheduleTravelRefresh() { clearTimeout(travelTimer); travelTimer = setTimeout(refreshTravel, 1200); }
export async function refreshTravel() {
  travelTimer = null;
  if (typeof fetch !== 'function') return;
  if (travelBusy) { travelAgain = true; return; } // a change while looking things up: go again after
  travelBusy = true;
  try {
    const cache = { ...travelCache(), geo: { ...(travelCache().geo || {}) }, routes: { ...(travelCache().routes || {}) } };
    const ctx = { fetchFn: (u, i) => fetch(u, i), cache, now: Date.now(), googleKey: travelCfg().googleKey || '' };
    let changed = false; let n = 0;
    for (const task of travelTasks().filter((x) => x.place)) {
      const block = nextBlockOf(task.id);
      const planned = withTravel(task, { block });
      for (const y of planned.steps.filter((z) => z.travel && z.pending)) {
        if (n >= 12) break; // the rest next time
        const departAt = block ? parseDate(block.date).getTime() + (block.start + (y.travel === 'back' ? block.minutes : 0)) * 60000 : Date.now() + 3600000;
        await travelMinutes(y.from, y.to, y.mode, departAt, ctx);
        changed = true; n++;
        if (n < 12) await new Promise((r) => setTimeout(r, 1100));
      }
    }
    if (changed) saveSettings({ travelCache: pruneCache(cache) });
    // Apply what's known now (also when origins moved) to every task with a place.
    let any = false;
    for (const task of travelTasks().filter(travelAffected)) { const before = task.updatedAt; if (applyTravel(task).updatedAt !== before) any = true; }
    if (any || changed) { render(); scheduleSync(); }
  } finally { travelBusy = false; if (travelAgain) { travelAgain = false; scheduleTravelRefresh(); } }
}
