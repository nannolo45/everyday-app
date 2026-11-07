// focus.js (v100): focus with a pomodoro rhythm sized to the task, and the weight of a task.
// · sizeOf(task): quick (≤30m), medium (≤1h30) or big (longer, or 4+ steps); shown as three little bars.
// · startFocus: starts the task's timer (timer.js) with a plan of focus blocks and breaks (focusPlan):
//   quick = one block (10–30′), medium = 25′ + 5′ breaks, big = 50′ + 10′ breaks (15′ after the first).
// · The focus screen: the ring, the block you're in, the run of blocks and breaks, the step you're on; pause, skip
//   the block, done. When a block or a break ends: a sound, a vibration, a toast (a notification if the app is hidden).
import { esc, toast, ui } from './core.js';
import { t } from './i18n.js';
import { checklistOf, stepTimes } from './model.js';
import { fmtDur } from './plan.js';
import { get, upsert } from './store.js';
import { render } from './shell.js';
import { elapsedText, focusLabel, focusPhase, focusPlan, runningBlock, sizeOfMinutes, startBlock, startTask } from './timer.js';
import { realSteps } from './travel-plan.js';
import { stepName } from './views/planner.js';

export const sizeOf = (x) => sizeOfMinutes(Number(x?.minutes) || 30, realSteps(x).length);
export const sizeWord = (z) => t(`sz_${z}`);
export const sizeBars = (x, color = '') => { const z = typeof x === 'string' ? x : sizeOf(x); return `<span class="szb ${z}" title="${esc(sizeWord(z))}" aria-label="${esc(sizeWord(z))}"${color ? ` style="--c:${esc(color)}"` : ''}><i></i><i></i><i></i></span>`; };
// a block's own length without its travel legs
export function workMinutes(b) {
  const ys = stepTimes(b); const work = ys.filter((y) => !y.travel && !y.buffer);
  return ys.length > 1 && work.length ? work.reduce((n, y) => n + (y.end - y.start), 0) : b.minutes || 30;
}
export function planFor(b) { const x = b.taskId ? get('tasks', b.taskId) : null; const m = workMinutes(b); return focusPlan(m, sizeOfMinutes(m, realSteps(x).length)); }
export const planLabel = (b) => focusLabel(planFor(b));
export const planWords = (plan) => { const f = plan.filter((p) => p.k === 'f'); const br = plan.find((p) => p.k === 'b'); return f.length === 1 ? t('fx_one', f[0].m) : t('fx_many', f.length, f[0].m, br ? br.m : 5); };

export function startFocus(b) {
  const r = b.startedAt && !b.endedAt ? b : startBlock(b);
  upsert('blocks', { ...get('blocks', r.id), focus: { plan: planFor(r), skipMs: 0 } });
  ui.focusOpen = true; lastPhase = null; askNotify();
  return get('blocks', r.id);
}
export function startFocusTask(task) { const b = startTask(task); return startFocus(b); }

// ---------- the screen ----------
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function ring(size, stroke, frac, cls = '') { const r = (size - stroke) / 2; const L = 2 * Math.PI * r; return `<svg class="fx-ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/><circle class="fx-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${L.toFixed(1)}" stroke-dashoffset="${(L * (1 - frac)).toFixed(1)}" data-l="${L.toFixed(1)}"/></svg>`; }
const phaseText = (ph) => (ph.over ? t('fx_over') : ph.k === 'b' ? t('fx_break', ph.m) : t('fx_block', ph.nth, ph.n));
const afterText = (ph) => (ph.over ? '' : ph.next ? (ph.next.k === 'b' ? t('fx_thenBreak', ph.next.m) : t('fx_thenBlock')) : t('fx_thenEnd'));
export function focusScreenHtml() {
  const b = runningBlock(); if (!ui.focusOpen || !b?.focus) return '';
  const ph = focusPhase(b); const x = b.taskId ? get('tasks', b.taskId) : null;
  const ys = stepTimes(b); const cur = ys.length > 1 ? ys.find((y) => b.stepState?.[y.id] !== 'done' && !y.travel) : null;
  const frac = ph.over ? 1 : ph.left / (ph.m * 60);
  const cl = checklistOf(b);
  return `<div class="fx-screen${b.pausedAt ? ' paused' : ''}${ph.k === 'b' ? ' brk' : ''}" role="dialog" aria-label="${esc(t('fx_title'))}">
    <div class="fx-top"><span>${esc(t('fx_title'))} · ${esc(sizeWord(sizeOf(x || b)))}</span><button type="button" class="icon" data-action="focus-close" aria-label="${esc(t('close'))}">✕</button></div>
    <h2>${esc(b.title)}</h2>
    ${cur ? `<p class="fx-step">${esc(t('fx_step', ys.indexOf(cur) + 1, ys.length))}: <b>${esc(stepName(cur))}</b> <button type="button" class="btn small" data-action="ag-step" data-block="${esc(b.id)}" data-step="${esc(cur.id)}">✓</button></p>` : ''}
    <div class="fx-ringbox">${ring(240, 12, frac)}<div class="fx-c"><b id="fx-time">${ph.over ? elapsedText(b) : mmss(ph.left)}</b><small id="fx-sub">${esc(phaseText(ph))}${afterText(ph) ? ` · ${esc(afterText(ph))}` : ''}</small></div></div>
    <div class="fx-plan">${b.focus.plan.map((p, i) => `<i class="${p.k}${i === ph.i ? ' cur' : i < ph.i ? ' dn' : ''}" style="flex:${p.m}" title="${esc(p.k === 'f' ? t('fx_focusN', p.m) : t('fx_break', p.m))}"></i>`).join('')}</div>
    <small class="fx-planw">${esc(b.focus.plan.map((p) => (p.k === 'f' ? `${p.m}′` : `${p.m}′ ${t('fx_pause')}`)).join(' · '))}</small>
    <div class="fx-ctrls"><button type="button" class="btn primary" data-action="${b.pausedAt ? 'timer-resume' : 'timer-pause'}">${b.pausedAt ? `▶ ${esc(t('timerResume'))}` : `❚❚ ${esc(t('timerPause'))}`}</button>${ph.over ? '' : `<button type="button" class="btn" data-action="focus-skip" title="${esc(t('fx_skip'))}" aria-label="${esc(t('fx_skip'))}">⏭</button>`}<button type="button" class="btn" data-action="timer-stop">✓ ${esc(t('esDone'))}</button></div>
    ${cl.length ? `<div class="fx-cl">${cl.map((c, i) => `<label class="check"><input type="checkbox" data-ci="${i}" data-block="${esc(b.id)}" ${(b.checked || [])[i] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>` : ''}
    <p class="fx-hint">${esc(t('fx_hint'))}</p></div>`;
}
// the small timer (Oggi's card)
export function focusMiniHtml(b) {
  const ph = focusPhase(b); if (!ph) return '';
  return `<div class="fx-mini${ph.k === 'b' ? ' brk' : ''}">${ring(64, 6, ph.over ? 1 : ph.left / (ph.m * 60), 'mini')}<div><b id="fx-mtime">${ph.over ? elapsedText(b) : mmss(ph.left)}</b><small id="fx-msub">${esc(phaseText(ph))}${afterText(ph) ? ` · ${esc(afterText(ph))}` : ''}</small></div></div>`;
}

// ---------- the tick: the numbers, and the end of a block or a break ----------
let lastPhase = null;
function beep() {
  try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; const ac = beep.ac ||= new A(); [0, 0.25].forEach((d) => { const o = ac.createOscillator(); const g = ac.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d + 0.2); o.connect(g).connect(ac.destination); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.22); }); } catch { /* no sound */ }
}
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* not here */ } }
function alertPhase(b, ph) {
  const msg = ph.over ? t('fx_doneAll', b.title) : ph.k === 'b' ? t('fx_nowBreak', ph.m) : t('fx_nowBlock', ph.nth, ph.n);
  beep(); try { navigator.vibrate?.([200, 100, 200]); } catch { /* none */ }
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Everyday', { body: msg, tag: 'everyday-focus' }); } catch { /* none */ }
  toast(msg, 5000); render();
}
setInterval(() => {
  const b = runningBlock(); if (!b?.focus) { lastPhase = null; return; }
  const ph = focusPhase(b); const key = `${b.id}:${ph.i}`;
  if (lastPhase && lastPhase !== key && !b.pausedAt) alertPhase(b, ph);
  lastPhase = key;
  const txt = ph.over ? elapsedText(b) : mmss(ph.left); const frac = ph.over ? 1 : ph.left / (ph.m * 60);
  for (const id of ['fx-time', 'fx-mtime']) { const el = document.getElementById(id); if (el) el.textContent = txt; }
  for (const arc of document.querySelectorAll('.fx-arc')) arc.setAttribute('stroke-dashoffset', (Number(arc.dataset.l) * (1 - frac)).toFixed(1));
}, 1000);
