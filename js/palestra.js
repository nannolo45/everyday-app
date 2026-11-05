// Palestra (v54): the workout app. Data contract v1 (the spec doc "Workout app: spec and data contract
// with Everyday", and "Palestra → Everyday: open questions"):
//   data/routines.json        {id, name, estMinutes, deleted?}                 read
//   data/sessions/YYYY-MM.json {id, routineId, start, end (ms), minutes, outcome, everydayBlockId?}   read
//   data/prefs.json  contract {value: 1}, activePlan {planId, name, from, days: [{routineId, weekday
//                    (0 = Monday … 6, null = any day), time?}], previous?}            read
//                    planned  [{blockId, routineId, date, start: "HH:MM"}]          written by Everyday
//                    moves    [{routineId, from, to: "YYYY-MM-DD", at (ms)}]            read (v60, Palestra v12)
// Each workout is a routine here (a saved task with `palestraId`). The active plan gives it its rhythm:
// fixed weekdays (at the plan's time, else picked each week on the Sunday card), or "N times a week" for
// days without a weekday. A plan that starts later ("from Monday") goes in `next` until then. A workout
// deleted in Palestra is archived: it keeps its history and is never planned again. Finished sessions
// give their block the real start, end and minutes; one started in Palestra alone finds that day's block
// for the same workout, or gets a new one. (v74) Only the active plan's workouts (and the next plan's) show
// in Everyday: the others are kept (`palOut`), out of the lists, and come back when a plan has them.
import { esc } from './core.js';
import { t } from './i18n.js';
import { busyOn, newBlock, planBusy } from './model.js';
import { autoHoursFor } from './planning.js';
import { addDays, dateStr, fmtTime, freeSlot, isOccurrence, parseTime, today } from './plan.js';
import { contractVersion, get, live, PAL_CONTRACT, remove, state, uid, upsert } from './store.js';
import { palestraConfigured } from './sync.js';

export const PALESTRA_APP = 'https://nannolo45.github.io/palestra-app/';
export const isPalestra = (x) => Boolean(x?.palestraId);
export const palestraTooNew = () => contractVersion(state.p_prefs) > PAL_CONTRACT;
const pref = (id) => live('p_prefs').find((x) => x.id === id);
export const startLink = (x, b) => `${PALESTRA_APP}#/start/${encodeURIComponent(x.palestraId)}?block=${encodeURIComponent(b.id)}`;
export const appLink = (x) => (x ? `${PALESTRA_APP}#/routine/${encodeURIComponent(x.palestraId)}` : PALESTRA_APP);
const outcomeOf = (b) => b.outcome || (b.done ? 'done' : null);

// The rhythm a plan gives one workout: the fields of its routine, or a routine without a rhythm.
export function rhythmFrom(plan, routineId) {
  const days = (plan?.days || []).filter((d) => d && d.routineId === routineId);
  const fixed = [...new Set(days.filter((d) => d.weekday != null && d.weekday >= 0 && d.weekday <= 6).map((d) => Number(d.weekday) + 1))].sort();
  const any = days.filter((d) => d.weekday == null).length;
  const times = [...new Set(days.filter((d) => d.weekday != null && d.time).map((d) => d.time))];
  if (fixed.length) {
    const tm = times.length === 1 ? parseTime(times[0]) : null;
    return { repeat: 'weekly', repeatDays: fixed, every: 1, timesN: null, pickTime: tm == null, seriesTime: tm, whenMode: 'repeat' };
  }
  if (any) return { repeat: 'times', repeatDays: [], timesN: any, timesPer: 'week', pickTime: true, seriesTime: null, whenMode: 'repeat' };
  return { repeat: null, repeatDays: [], timesN: null, pickTime: null, seriesTime: null, whenMode: 'anytime' };
}
// The plan in force today, and the one taking over later (if it was made active "from" a later day).
export function plansNow(td = today()) {
  const ap = pref('activePlan')?.value || null;
  if (ap && ap.from && ap.from > td) return { cur: ap.previous || null, next: ap };
  return { cur: ap, next: null };
}
function dropOpenBlocks(x, from) {
  for (const b of live('blocks')) if (b.taskId === x.id && b.kind !== 'prep' && !outcomeOf(b) && !b.startedAt && b.date >= from) remove('blocks', b.id);
}

// After each sync: workouts, the plan, the sessions. Returns how many records changed.
export function applyPalestra() {
  if (!palestraConfigured()) return 0;
  let n = 0;
  const td = today();
  const mine = new Map(live('tasks').filter(isPalestra).map((x) => [x.palestraId, x]));
  const health = get('categories', 'health') ? 'health' : null;
  // 1. the workouts
  for (const r of state.p_routines || []) {
    if (!r?.id) continue;
    const x = mine.get(r.id);
    if (r.deleted) {
      if (x && !x.archived) { dropOpenBlocks(x, td); mine.set(r.id, upsert('tasks', { ...x, archived: true, repeat: null, next: null, pickTime: null, seriesTime: null }, { silent: true })); n++; }
      continue;
    }
    const name = r.name || t('palWorkout'); const min = Math.max(5, Math.round(Number(r.estMinutes) || 45));
    if (!x) {
      mine.set(r.id, upsert('tasks', { id: uid(), kind: 'saved', palestraId: r.id, title: name, minutes: min, lenSet: true, palName: name, palMin: min, category: health, steps: [], checklist: [], notes: '', importance: 3, createdAt: Date.now(), whenMode: 'anytime' }, { silent: true }));
      n++; continue;
    }
    // Palestra owns the name and the length: they follow it when they change there.
    const ch = {};
    if (x.palName !== name) { ch.palName = name; ch.title = name; }
    if (x.palMin !== min) { ch.palMin = min; ch.minutes = min; }
    if (x.archived) ch.archived = false;
    if (Object.keys(ch).length) { mine.set(r.id, upsert('tasks', { ...x, ...ch }, { silent: true })); n++; }
  }
  // 2. the plan: each workout's rhythm, changed only when the plan changed (your own edits stay otherwise)
  const { cur, next } = plansNow(td);
  for (let x of mine.values()) {
    if (x.archived || x.deleted) continue;
    const now = rhythmFrom(cur, x.palestraId);
    const later = next ? { from: next.from, ...rhythmFrom(next, x.palestraId) } : null;
    // (v74) a workout in neither the active plan nor the next one stays out of Everyday's lists
    const out = !now.repeat && !(later && later.repeat);
    if (Boolean(x.palOut) !== out) { x = upsert('tasks', { ...x, palOut: out || null }, { silent: true }); mine.set(x.palestraId, x); n++; }
    const sig = JSON.stringify([cur?.planId || null, cur?.from || null, now, later]);
    if (x.palSig === sig) continue;
    const old = x.palSig ? JSON.parse(x.palSig) : null;
    const nowChanged = !old || JSON.stringify(old[2]) !== JSON.stringify(now) || old[0] !== (cur?.planId || null);
    // What the old plan had put on the plan comes off from the day the change takes effect; done ones stay.
    if (old) dropOpenBlocks(x, nowChanged ? td : (later?.from || old[3]?.from || td));
    const from = cur?.from && cur.from <= td ? cur.from : td;
    upsert('tasks', { ...x, ...now, seriesFrom: now.repeat ? (nowChanged ? from : x.seriesFrom || from) : x.seriesFrom, due: now.repeat ? (x.due && x.due >= td ? x.due : td) : x.due, next: later, palSig: sig }, { silent: true });
    n++;
  }
  // 3. the sessions
  n += applySessions(mine);
  // 4. (v60) "Sposta a domani" in Palestra
  n += applyMoves();
  // 5. (v79, Palestra v22) the workout in progress
  n += applyLive(mine);
  return n;
}

// (v79, Palestra v22) The workout in progress: prefs `live` {sessionId, routineId, start, pausedAt, pausedMs,
// blockId?, at}, written by Palestra on start, pause, resume and end (null). Its block shows as running
// (the block it was started from, else that day's open block of the workout closest to the start, else a
// temporary one); the finished session then gives it the real times, as before. A record older than 6 hours,
// or whose session is already in, is ignored; a workout gone without a session puts the block back.
export const LIVE_STALE = 6 * 3600e3;
export function liveWorkout(now = Date.now()) {
  const v = pref('live')?.value || null;
  if (!v || !v.sessionId || !v.routineId || !Number(v.start)) return null;
  if (now - Number(v.at || v.start) > LIVE_STALE) return null;
  if ((state.p_sessions || []).some((s) => s?.id === v.sessionId && s.end)) return null;
  return v;
}
function applyLive(mine) {
  let n = 0;
  const cur = liveWorkout();
  for (const b of live('blocks').filter((y) => y.palLive)) {
    if (cur && b.palLive === cur.sessionId) continue;
    if (b.palSession || outcomeOf(b)) { const { palLive, palBefore, palLiveTemp, ...rest } = b; upsert('blocks', rest, { silent: true }); n++; continue; } // the session is in
    if (b.palLiveTemp) remove('blocks', b.id);
    else { const { palLive, palBefore, ...rest } = b; upsert('blocks', { ...rest, ...(palBefore || { startedAt: null, pausedAt: null, pausedMs: 0, endedAt: null }) }, { silent: true }); }
    n++;
  }
  if (!cur) return n;
  const x = mine.get(cur.routineId); if (!x || x.archived) return n;
  const st = new Date(Number(cur.start)); const date = dateStr(st); const at = st.getHours() * 60 + st.getMinutes();
  let b = live('blocks').find((y) => y.palLive === cur.sessionId) || (cur.blockId ? get('blocks', cur.blockId) : null);
  if (!b || b.deleted || outcomeOf(b)) {
    const cands = live('blocks').filter((y) => y.taskId === x.id && y.date === date && y.kind !== 'prep' && !y.stepId && !outcomeOf(y) && !y.palSession);
    b = cands.sort((a, c) => Math.abs(a.start - at) - Math.abs(c.start - at))[0] || null;
  }
  const run = { date, start: at, startedAt: Number(cur.start), pausedAt: cur.pausedAt ? Number(cur.pausedAt) : null, pausedMs: Math.max(0, Number(cur.pausedMs) || 0), endedAt: null, palLive: cur.sessionId, auto: false };
  if (b) {
    const same = b.palLive === cur.sessionId && b.startedAt === run.startedAt && (b.pausedAt || null) === run.pausedAt && (b.pausedMs || 0) === run.pausedMs && b.date === date && b.start === at;
    if (same) return n;
    const before = b.palLive ? b.palBefore : { date: b.date, start: b.start, startedAt: b.startedAt ?? null, pausedAt: b.pausedAt ?? null, pausedMs: b.pausedMs ?? 0, endedAt: b.endedAt ?? null, auto: b.auto ?? false };
    upsert('blocks', { ...b, plannedMinutes: b.plannedMinutes || b.minutes, ...run, palBefore: before }, { silent: true });
  } else newBlock({ taskId: x.id, title: x.title, category: x.category || null, minutes: x.minutes || 45, palLiveTemp: true, ...run });
  return n + 1;
}

// (v60) Moves made in Palestra (prefs `moves`, Palestra v12): each step {routineId, from, to, at} takes the
// workout's open block on `from` to `to`, at the same time when that's free, else the first free slot that
// day. Steps go in `at` order, so a second move (Tue→Wed) finds the block where the first (Mon→Tue) left
// it, and an undo after a sync is a step back (Tue→Mon). A block already done or started stays put.
// An undo puts the block back at the time it had there. No block on `from` at all (a time still to pick): that day is skipped and a block goes on `to`, unless the
// workout already has one there. Each step is applied once: its key is kept on the workout (`palMoves`,
// synced, so a second device doesn't apply it again). The moved block goes back to Palestra in `planned`.
export const moveKey = (m) => `${m.at}|${m.from}|${m.to}`;
const openOn = (x, d) => live('blocks').filter((b) => b.taskId === x.id && b.date === d && b.kind !== 'prep' && !outcomeOf(b) && !b.startedAt && !b.endedAt).sort((a, b) => a.start - b.start);
function slotOn(d, minutes, want, skipId) {
  const busy = planBusy(d, (b) => b.id !== skipId);
  const [h0, h1] = autoHoursFor(d);
  if (want != null && !busy.some((b) => b.start < want + minutes && b.start + b.minutes > want)) return want;
  const now = new Date(); const nowM = d === today() ? now.getHours() * 60 + now.getMinutes() : 0;
  return freeSlot(busy, minutes, { from: nowM, dayStart: h0, dayEnd: h1 }) ?? want ?? h0;
}
export function applyMoves() {
  const list = (pref('moves')?.value || []).filter((m) => m && m.routineId && m.from && m.to && m.from !== m.to)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  if (!list.length) return 0;
  const td = today(); let n = 0;
  for (const m of list) {
    let x = live('tasks').find((y) => isPalestra(y) && y.palestraId === m.routineId);
    if (!x || x.archived) continue;
    const key = moveKey(m);
    if ((x.palMoves || []).includes(key)) continue;
    if (m.to >= td) {
      const b = openOn(x, m.from)[0];
      const any = live('blocks').some((y) => y.taskId === x.id && y.date === m.from && y.kind !== 'prep');
      if (b) {
        // back where it came from (an undo): its time there; otherwise the time it has now
        const want = b.palPrev?.date === m.to ? b.palPrev.start : b.start;
        upsert('blocks', { ...b, date: m.to, start: slotOn(m.to, b.minutes || x.minutes || 45, want, b.id), auto: false, palMoved: true, palPrev: { date: m.from, start: b.start } }, { silent: true });
        // the day it left is done with (no "to fix" for it); a day it comes back to is on again
        const left = !live('blocks').some((y) => y.taskId === x.id && y.date === m.from && y.kind !== 'prep');
        const sk = new Set(x.skipped || []); sk.delete(m.to); if (left && x.repeat && isOccurrence(x, m.from)) sk.add(m.from);
        x = upsert('tasks', { ...x, skipped: [...sk] }, { silent: true });
      } else if (!any && !openOn(x, m.to).length && !live('blocks').some((y) => y.taskId === x.id && y.date === m.to && y.kind !== 'prep')) {
        // nothing planned on `from` yet: that day is off, the new day gets the workout
        if (isOccurrence(x, m.from)) x = upsert('tasks', { ...x, skipped: [...new Set([...(x.skipped || []), m.from])] }, { silent: true });
        const minutes = x.minutes || 45;
        newBlock({ taskId: x.id, title: x.title, category: x.category || null, date: m.to, start: slotOn(m.to, minutes, x.seriesTime ?? null, null), minutes, auto: false, palMoved: true, ...(x.repeat ? { pickOcc: true } : {}) });
      }
    }
    const keep = (x.palMoves || []).filter((k) => list.some((y) => moveKey(y) === k)); // Palestra keeps only this week's moves
    upsert('tasks', { ...get('tasks', x.id), palMoves: [...keep, key] }, { silent: true });
    n++;
  }
  return n;
}

// A finished session on its block: the real start and end, the minutes trained (without pauses).
export function applySessions(mine = new Map(live('tasks').filter(isPalestra).map((x) => [x.palestraId, x]))) {
  let n = 0;
  const seen = new Set(live('blocks').map((b) => b.palSession).filter(Boolean));
  for (const s of state.p_sessions || []) {
    if (!s?.id || s.deleted || seen.has(s.id) || !s.start || !s.end) continue;
    const x = mine.get(s.routineId); if (!x) continue;
    const st = new Date(Number(s.start)); const date = dateStr(st); const at = st.getHours() * 60 + st.getMinutes();
    const span = Math.max(1, Math.round((Number(s.end) - Number(s.start)) / 60000));
    const worked = Math.max(1, Math.round(Number(s.minutes) || span));
    const outcome = s.outcome === 'partial' ? 'partial' : 'done';
    let b = s.everydayBlockId ? get('blocks', s.everydayBlockId) : null;
    if (!b || b.deleted) {
      const cands = live('blocks').filter((y) => y.taskId === x.id && y.date === date && y.kind !== 'prep' && !outcomeOf(y) && !y.palSession);
      b = cands.sort((a, c) => Math.abs(a.start - at) - Math.abs(c.start - at))[0] || null;
    }
    const real = { date, start: at, minutes: worked, startedAt: Number(s.start), endedAt: Number(s.end), pausedAt: null, pausedMs: Math.max(0, (span - worked) * 60000), outcome, done: outcome === 'done', palSession: s.id, auto: false };
    if (b) upsert('blocks', { ...b, plannedMinutes: b.plannedMinutes || b.minutes, ...real }, { silent: true });
    else newBlock({ taskId: x.id, title: x.title, category: x.category || null, palAdded: true, ...real });
    seen.add(s.id); n++;
  }
  return n;
}

// What Palestra shows as "next": the open blocks of the workouts, now to 14 days ahead.
export function publishPlanned() {
  if (!palestraConfigured() || palestraTooNew()) return false;
  const td = today(); const end = addDays(td, 14);
  const byId = new Map(live('tasks').filter((x) => isPalestra(x) && !x.archived).map((x) => [x.id, x]));
  const value = live('blocks').filter((b) => byId.has(b.taskId) && b.kind !== 'prep' && b.date >= td && b.date <= end && !outcomeOf(b) && !b.endedAt && !b.preview)
    .sort((a, b) => (a.date + String(a.start).padStart(4, '0') < b.date + String(b.start).padStart(4, '0') ? -1 : 1))
    .map((b) => ({ blockId: b.id, routineId: byId.get(b.taskId).palestraId, date: b.date, start: fmtTime(b.start) }));
  const cur = pref('planned');
  if (JSON.stringify(cur?.value || []) === JSON.stringify(value) && (cur || !value.length)) return false;
  upsert('p_prefs', { ...(cur || {}), id: 'planned', value }, { silent: true });
  return true;
}

// The note in a workout's editor: Palestra owns the name, the length and the exercises.
export function palestraNote(x) {
  if (!isPalestra(x)) return '';
  return `<div class="pal-note"><div><b>${esc(t('palFrom'))}</b><small>${esc(x.archived ? t('palArchivedNote') : t('palOwns'))}</small></div><a class="btn small" href="${esc(appLink(x))}" target="_blank" rel="noopener">${esc(t('palChangeThere'))} ↗</a></div>`;
}
export function lastSessionAt() {
  const s = (state.p_sessions || []).filter((y) => y && !y.deleted && y.end).sort((a, b) => b.end - a.end)[0];
  return s ? Number(s.end) : null;
}
