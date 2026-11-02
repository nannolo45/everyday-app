// shell.js: moved from app.js (v36). See app.js for how the modules fit together.
import { applyPalestra, publishPlanned } from './palestra.js';
import { $, modal, PPM, route, TAB_OF, ui, view } from './core.js';
import { t } from './i18n.js';
import { ensureAllSeries, migrateBlocksToEvents, normalizeKinds } from './model.js';
import { isDate, nowMinutes, today } from './plan.js';
import { isDragging } from './sortable.js';
import { applySharedSettings, get, live, seedSharedSettings, state } from './store.js';
import { isConfigured, isSyncing, ricetteConfigured, syncNow } from './sync.js';
import { setUserFoods } from './foods.js';
import { scheduleTravelRefresh } from './travel-plan.js';
import { SH } from './views/shop.js';
import { gcalNow } from './connections.js';
import { hydratePhotos } from './editors.js';
import { lateBannerHtml, timerBarHtml } from './timer.js';
import { todayRows, weekCardHtml } from './weekpick.js';
import { viewSettings } from './views/settings.js';
import { viewTasks } from './views/tasks.js';
import { currentView, planStyle, viewPlan } from './views/planner.js';
import { viewEvents } from './views/events.js';
import { isWide, wideWrap } from './views/wide.js';
import { viewToday } from './views/today.js';

// ---------- sync scheduling ----------

export let syncTimer = null;
// A sync a moment from now (changes come in bursts: one sync for all of them), or none.
export function scheduleSync(ms = 2500) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); }
export function cancelScheduledSync() { clearTimeout(syncTimer); syncTimer = null; }
export function syncScheduled() { return Boolean(syncTimer); }
export function changed() {
  ensureAllSeries();
  render();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2500);
  scheduleTravelRefresh();
}

export async function runSync() {
  syncTimer = null;
  if (!isConfigured()) { updateSyncBadge(); return; }
  updateSyncBadge(true);
  const planChanged = Object.keys(state.meta.dirtyShards || {}).some((k) => k.startsWith('blocks/'));
  await syncNow();
  // Settings: what other devices changed comes in; settings from before they were shared go up once.
  if (!state.meta.lastError) { seedSharedSettings(); await applySharedSettings(); normalizeKinds(); }
  // Plan changed and Google Calendar is set up: push it there soon (at most every 10 minutes).
  if (planChanged && !state.meta.lastError && get('gcal', 'status') && Date.now() - (ui.lastDispatch || 0) > 600_000) gcalNow(true);
  migrateBlocksToEvents();
  if (!state.meta.lastError) applyPalestra();
  ensureAllSeries();
  publishPlanned();
  updateSyncBadge();
  renderIfSafe();
  scheduleTravelRefresh();
  if (state.meta.dirty) scheduleSync();
}

// Number of things still to buy, on the Shopping tab.
export function updateShopCount() {
  const el = $('#shop-count');
  if (!el) return;
  const n = live(SH()).filter((i) => !i.checked).length;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
}

export function updateSyncBadge(syncing = isSyncing()) {
  const b = $('#sync');
  let st;
  if (!isConfigured()) st = 'local';
  else if (syncing) st = 'syncing';
  else if (!navigator.onLine) st = 'offline';
  else if (state.meta.lastError && state.meta.lastError !== 'network') st = 'error';
  else if (state.meta.lastError === 'network') st = 'offline';
  else if (state.meta.dirty) st = 'pending';
  else st = 'synced';
  b.className = `sync ${st}`;
  b.title = t(`st_${st}`);
  b.setAttribute('aria-label', b.title);
  $('#sync-label').textContent = t(`st_${st}`);
}

// ---------- rendering ----------

export function renderShell() {
  document.title = t('appName');
  $('#app-title').textContent = t('appName');
  $('#app-title').title = t('tabToday');
  for (const a of document.querySelectorAll('nav a')) {
    a.querySelector('.label').textContent = t(`tab${a.dataset.tab.charAt(0).toUpperCase()}${a.dataset.tab.slice(1)}`);
  }
  const gear = $('#gear'); if (gear) { gear.setAttribute('aria-label', t('gearSettings')); gear.title = t('gearSettings'); const gl = $('#gear-label'); if (gl) gl.textContent = t('gearSettings'); }
  updateSyncBadge();
}

export function currentDate() {
  const r = route();
  return r.name === 'plan' && isDate(r.id) ? r.id : today();
}

// Ricette's corrections (data/foods.json: the user's own foods, extra names): the dictionary takes them in at
// start and whenever a sync brings a new copy. Without Ricette connected there are none.
const NO_FOODS = [];
let foodsSeen = null;
export function applyUserFoods() {
  const list = ricetteConfigured() ? state.r_foods : NO_FOODS;
  if (list === foodsSeen) return;
  foodsSeen = list;
  setUserFoods(list);
}

export function render() {
  applyUserFoods();
  const r = route();
  const active = document.activeElement;
  const focusId = active && active.id;
  const typed = focusId && ['INPUT', 'TEXTAREA'].includes(active.tagName) ? active.value : null;
  let sel = null; try { sel = typed != null ? [active.selectionStart, active.selectionEnd] : null; } catch { /* not a text field */ }
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.dataset.tab === (TAB_OF[r.name] || 'today'));
  $('#gear')?.classList.toggle('active', r.name === 'settings');
  document.body.classList.remove('compact'); // (v54) Compact is gone: rows are one line of facts anyway
  document.body.dataset.route = r.name === 'shop' ? 'tasks' : r.name; // (v52) list styles shared by To do, Saved, Shopping
  // The + button: on Oggi, Eventi and Attività (the shopping list and the Planner have their own).
  const fab = $('#fab');
  if (fab) {
    fab.hidden = !['today', 'events', 'tasks', 'shop', 'plan'].includes(r.name) || (r.name === 'plan' && planStyle() === 'hours'); // (v55) the agenda Planner has the + too
    fab.setAttribute('aria-label', t('addMenuFab')); fab.title = t('addMenuFab');
  }
  updateShopCount();
  let html;
  switch (r.name) {
    case 'tasks': html = viewTasks(); break;
    case 'shop': html = viewTasks('shop'); break;
    case 'events': html = viewEvents(); break;
    case 'settings': html = viewSettings(); break;
    case 'plan': html = viewPlan(currentDate()); break;
    default: html = viewToday();
  }
  // A running timer shows on every tab (not Settings); a late start's offer on Today.
  if (r.name !== 'settings') html = timerBarHtml() + (r.name === 'today' ? lateBannerHtml() + todayFixCard() : '') + html;
  // (v56) Wide screens: a rail on the left and a pane on the right (views/wide.js).
  const wide = isWide(); document.body.classList.toggle('is-wide', wide);
  if (wide) html = wideWrap(html);
  document.body.classList.toggle('wide-pane', wide && !html.includes('<div class="wide no-pane'));
  // Nothing changed (e.g. a sync that found no news): leave the page alone. Replacing it
  // anyway is what made the screen flicker and fields lose what you were typing.
  if (html === ui.lastHtml && view.childElementCount) { positionNow(); settleScroll(r); return; }
  ui.lastHtml = html;
  view.innerHTML = html;
  document.body.classList.toggle('has-tray', Boolean(view.querySelector('.tray')));
  hydratePhotos(view);
  positionNow();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (typed != null && ['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        el.value = typed;
        // the cursor stays where it was (not at the end: you may be typing in the middle)
        try { el.setSelectionRange(sel?.[0] ?? typed.length, sel?.[1] ?? typed.length); } catch { /* not a text field */ }
      }
    }
  }
  settleScroll(r);
}

// Opening the plan (or switching to the Day view) shows today's "now"; another day starts at the
// top. Moving between days with ‹ › keeps where you are on the page.
export function settleScroll(r) {
  if (r.name !== 'plan' && TAB_OF[r.name]) return;
  if (ui.scrolledFor == null) {
    ui.scrolledFor = currentDate();
    if (currentView() === 'day' && currentDate() === today()) scrollTimeline(); else window.scrollTo(0, 0);
  }
  ui.shownDate = currentDate();
}

// (v51) Repeats that need a time: today's, and from the weekly moment the week's (see weekpick.js).
function todayFixCard() {
  const { rows, weekOn, key } = todayRows();
  ui.weekRows = rows;
  return weekCardHtml({ rows, title: t(weekOn ? 'toFixWeek' : 'toFixToday'), key: weekOn ? key : null });
}
// The red "now" line moves on its own every minute, without redrawing the day.
export function positionNow() {
  const line = $('#now-line');
  const tl = line?.closest('.timeline');
  if (!line || !tl) return;
  const start = Number(tl.dataset.start); const ppm = Number(tl.dataset.ppm) || PPM;
  const end = start + tl.offsetHeight / ppm;
  const now = nowMinutes();
  line.hidden = now < start || now > end;
  line.style.top = `${(now - start) * ppm}px`;
}

// Previews just placed: bring the first one on screen into view (above the drawer).
export function scrollToGhost() {
  const g = [...document.querySelectorAll('.timeline .block.ghost.assign')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  if (!g) return;
  const y = g.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.25;
  window.scrollTo(0, Math.max(0, y));
}
// On opening a day: scroll to "now" (today) or the first block (other days).
export function scrollTimeline() {
  const nowLine = $('#now-line');
  const target = (nowLine && !nowLine.hidden && nowLine) || $('.timeline .block');
  if (!target) return;
  const y = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
  window.scrollTo(0, Math.max(0, y));
}

// Background updates (sync, the clock) re-render only when it can't get in the way:
// not on settings, not under an open dialog, and not while a finger or mouse is pressed.
export function renderIfSafe() {
  const r = route();
  if (r.name === 'settings' || modal.open || ui.dragging) return;
  if (ui.pressing || typing() || isDragging()) { ui.renderLater = true; return; }
  // Several changes in a row (one per synced file) make a single redraw.
  if (ui.renderQueued) return;
  ui.renderQueued = true;
  requestAnimationFrame(() => { ui.renderQueued = false; if (!ui.pressing && !typing() && !modal.open && !ui.dragging) render(); else ui.renderLater = true; });
}

// A text field on the page has the cursor: background updates wait until you leave it.
export function typing() {
  const a = document.activeElement;
  if (!a || !view.contains(a)) return false;
  return a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'
    || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(a.type));
}
export const released = () => {
  ui.pressing = false;
  if (ui.renderLater) { ui.renderLater = false; setTimeout(renderIfSafe, 0); } // after the click is handled
};
