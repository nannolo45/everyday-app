// Everyday — the entry point: it wires the page up (clicks, forms, drag, swipe, the clock) and boots.
// The app is split by job (v36); each module's functions are exported for the others:
//   core.js           shared helpers, the ui object, categories, dates and times as text, APP_VERSION
//   widgets.js        form pieces: the dialog, durations, time windows, search box
//   model.js          tasks, events, series, steps, rules, readiness, meals, templates, conflicts
//   travel-plan.js    journey legs and travel-time lookups
//   planning.js       the Plan flow, placing tasks, the morning re-flow, grocery trips
//   shell.js          drawing the page, the sync schedule and badge
//   editors.js        every dialog: task/event editor, block, meal, add menu, pickers
//   connections.js    GitHub, Ricette and Calendar setup, backup, emptying the device
//   views/*.js        one per tab: today, events, tasks (and shop), planner, settings
// Pure logic with unit tests lives in plan.js, smart.js, kinds.js, travel.js, shops.js and friends;
// storage and sync in store.js and sync.js.
import { moveWeek, openRoutine } from './routines.js';
import { $, findCategory, hideToast, fmtDay, modal, PPM, quickFields, range, relDay, route, seedCategories, TAB_OF, TABS, toast, ui, view } from './core.js';
import { setupDrag } from './drag.js';
import { afterStart, openPalestra, doShift, finishTimer, openAddMenu, openPickSheet, openQuickTask, plusKind, openAutoPlanner, openBlock, openCategory, openEvent, openEventTaskAdd, openImport, openMeal, openPlanSaved, openSavedPicker, openShopRec, openSpare, openTask, openTaskChecklist, openTemplate, openTemplatesMenu } from './editors.js';
import { t } from './i18n.js';
import { isEvent } from './kinds.js';
import { noRhythm, repairRhythms, anchorOffset, autoChecks, leadOf, checklistLeft, checkMissed, conflictsOn, eventOf, followParent, migrateBlocksToEvents, normalizeKinds, planTask, saveEvent, seedMeals, setOutcome, setStepOutcome, setTaskDone, syncEventTasks, travelTasks, trySetBlockDone, tryStep } from './model.js';
import { fmtTime, isDate, parseTime, quickAdd, today } from './plan.js';
import { addGhosts, assignDrop, autoHoursFor, fixConflict, placeGhosts, planEventTasks, planGroceryTrips, spreadDays, trayTasks, undoReflow, warnConflicts } from './planning.js';
import { changed, currentDate, positionNow, released, render, renderIfSafe, renderShell, runSync, scheduleSync, scrollToGhost, syncScheduled, typing, updateSyncBadge } from './shell.js';
import { applySharedSettings, COLLECTIONS, get, live, load, onChange, remove, RICETTE, saveSettings, seedSharedSettings, state, uid, upsert } from './store.js';
import { isConfigured, isSyncing, removeCalendarData } from './sync.js';
import { applyTravel, ensureLegTasks, LEGS, legTemplate, pruneCache, scheduleTravelRefresh, setLegTask, travelBusy, travelCache, travelCfg, travelTimer } from './travel-plan.js';
import { setupTrayDrag } from './tray.js';
import { elapsedText, pauseTimer, resumeTimer, runningBlock, startBlock } from './timer.js';
import { fixAll, fixOcc, fixTimes, laterWeek, skipOcc } from './weekpick.js';
import { openEventFilters, prepareEvents } from './views/events.js';
import { placePicked, wideClick } from './views/wide.js';
import { applyTheme } from './theme.js';
applyTheme();
import { classic, curView, openFilters, openPick, openSort, openTriage, openViews, setView, setWeekly, setWhen, viewList } from './views/impegni.js';
import { openWeekGrid } from './weekgrid.js';
import { goToBlock, goToProposal, openChooser, openPropsList, resumeRoutine, sheetClick } from './finder.js';
import { setLowPref } from './lowstock.js';
import { countToast, firstFreeStart, moveBlockTo, openConflictChoice, openDropOn, placeItem, unplanToPane } from './placing.js';
import { agendaAdd, agendaPlan, keepFix, keepGhost, openGapFits, planStyle, showSteps } from './views/planner.js';
import { leaveShop, onSorted, openShopInfo, setListMode, shareShopList, shopAdd, shopChange, shopClick, shopName, SHOPS } from './views/shop.js';
import { openTaskTools, taskFilter } from './views/tasks.js';
import { clearSearch, syncDateText, tidyTime } from './widgets.js';
import { applyLang, exportData, gcalNow, handleShortcut, saveGithub, saveRicette, savePalestra, showUpdateBar, wipeLocalData } from './connections.js';

view.addEventListener('focusout', () => setTimeout(() => {
  if (ui.renderLater && !typing()) { ui.renderLater = false; renderIfSafe(); }
}, 0));
document.addEventListener('pointerdown', () => { ui.pressing = true; }, true);
document.addEventListener('pointerup', released, true);
document.addEventListener('pointercancel', released, true);

modal.addEventListener('close', () => render());
modal.addEventListener('change', (e) => { if (ui.modalSwap) e.stopImmediatePropagation(); }, true);
modal.addEventListener('input', (e) => { if (ui.modalSwap) e.stopImmediatePropagation(); }, true);
document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.search-clear')) e.preventDefault(); }, true); // keep the keyboard up
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.search-clear');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  clearSearch(b.parentElement.querySelector('input'));
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.closest?.('.search-box') && clearSearch(e.target)) { e.preventDefault(); e.stopPropagation(); }
}, true);
// A time window with a date: its weekdays don't count, so they fade as soon as a date is picked.
modal.addEventListener('change', (e) => {
  const row = e.target.closest?.('.win-row');
  if (row && e.target.type === 'date') row.querySelector('.days.mini')?.classList.toggle('off', Boolean(e.target.value));
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.classList?.contains('time24')) return;
  const digits = el.value.replace(/[^0-9]/g, '').slice(0, 4);
  if (e.inputType?.startsWith('delete')) return;
  el.value = digits.length > 2 ? `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}` : digits;
});
document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('time24')) tidyTime(e.target); }, true);
// Date fields show their date in the app's language (widgets.js dateBox): keep the text in step.
for (const type of ['input', 'change']) document.addEventListener(type, (e) => { if (e.target.parentElement?.classList.contains('date-field')) syncDateText(e.target); }, true);

// ---------- events ----------

view.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.id === 'task-add' || form.id === 'side-add') {
    const q = quickAdd(form.title.value);
    if (!q.title) return;
    const x = applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...quickFields(q) }, { silent: true }));
    if (q.due && q.time != null && !q.repeat) planTask(x, q.due, Math.max(0, q.time - anchorOffset(null, x))); // "Call Marco tue 15:00": straight onto the plan
    form.title.value = '';
    changed();
    document.getElementById(form.id === 'task-add' ? 'task-input' : 'side-add-input')?.focus();
  } else if (form.id === 'event-add') {
    const q = quickAdd(form.title.value);
    if (!q.title) return;
    const draft = { kind: 'event', title: q.title, minutes: q.minutes || 120, category: findCategory(q.category), place: q.place || '', notes: '', done: false, planDate: q.due || '', planTime: q.time, allDay: q.time == null };
    form.title.value = '';
    if (!q.due) { openTask(null, null, { event: true, draft }); return; } // no date yet: the editor asks
    saveEvent(draft);
    toast(t('eventAdded', relDay(q.due)));
    changed();
    document.getElementById('event-input')?.focus();
  } else if (form.id === 'shop-add') {
    shopAdd(form.item.value);
    form.item.value = '';
    changed();
    $('#shop-add-input')?.focus();
  } else if (form.id === 'gh-form') saveGithub(form);
  else if (form.id === 'ric-form') saveRicette(form);
  else if (form.id === 'pal-form') savePalestra(form);
});

view.addEventListener('input', (e) => {
  if (e.target.id === 'tray-q' && ui.assign) { ui.assign.q = e.target.value; render(); }
  if (e.target.id === 'task-q') { ui.taskQ = e.target.value; render(); }
  if (e.target.id === 'fd-q') { ui.fdQ = e.target.value; render(); }
  if (e.target.id === 'event-q') { ui.eventQ = e.target.value; render(); }
  if (e.target.id === 'shop-q') { ui.shopQ = e.target.value; render(); }
});

view.addEventListener('change', (e) => {
  const el = e.target;
  const { action, id } = el.dataset;
  if (action === 'low-pref') { setLowPref(el.value); changed(); return; } // (v73) shared with Ricette
  if (action === 'task-done') {
    const task = get('tasks', id);
    if (el.checked && checklistLeft(task.checklist || [], task.checked) > 0) { el.checked = false; openTaskChecklist(task); return; }
    setTaskDone(task, el.checked);
    changed();
  }
  if (shopChange(el)) return; // the shopping list's checkboxes (shoplist-ui.js)
  if (action === 'step-done') {
    const ok = tryStep(get('blocks', el.dataset.block), el.dataset.step, el.checked);
    if (!ok) { el.checked = false; return; }
    changed();
    return;
  }
  if (action === 'block-done') {
    if (el.checked && runningBlock()?.id === id) { finishTimer(); return; } // ticking the running one stops its timer
    const ok = trySetBlockDone(get('blocks', id), el.checked);
    if (!ok) { el.checked = false; return; }
    changed();
    if (el.checked) countToast(id); // (v69) per N volte: counted, or not
  }
  if (el.dataset.ci != null && el.dataset.block) { // checklist inside an open row of the list view
    const cur = get('blocks', el.dataset.block);
    const next = [...(cur.checked || [])];
    next[Number(el.dataset.ci)] = el.checked;
    upsert('blocks', { ...cur, checked: next }, { silent: true });
    changed();
  }
  if (el.id === 'show-events') { saveSettings({ showEvents: el.checked }); }
  if (el.id === 'task-sort') { saveSettings({ taskSort: el.value }); render(); return; }
  if (el.id === 'tray-sort') { saveSettings({ traySort: el.value }); render(); return; }
  if (el.id === 'trip-mode') { upsert('config', { id: 'shopping', value: { ...(get('config', 'shopping')?.value || {}), tripMode: el.value } }); changed(); }
  if (el.id === 'remind-default') { upsert('config', { id: 'reminders', value: { ...(get('config', 'reminders')?.value || {}), default: Number(el.value) } }); changed(); }
  if (el.form?.id === 'assign-opts') {
    saveSettings({ maxLoad: Number(el.form.maxLoad.value) || 8, freeWeekends: el.form.freeWeekends.checked });
    render();
    return;
  }
  if (el.id === 'day-picker' && isDate(el.value)) location.hash = `#/plan/${el.value}`;
  if (el.form?.id === 'lang-form' && el.name === 'theme') { applyTheme(el.value); render(); return; } // (v62) per device
  if (el.form?.id === 'lang-form') {
    saveSettings({ lang: el.value });
    applyLang(el.value);
    renderShell();
    render();
  }
  if (el.form?.id === 'travel-form') {
    const f = el.form;
    for (const kind of LEGS) if (el.name === `leg_${kind}`) setLegTask(kind, f[`leg_${kind}`].value);
    saveSettings({ travel: { ...travelCfg(), home: f.home.value.trim(), mode: f.mode.value, startHere: f.startHere.checked, thereDefault: f.thereDefault.value, backDefault: f.backDefault.value } });
    if (el.name === 'home' || el.name === 'mode') saveSettings({ travelCache: { ...travelCache(), routes: {} } });
    for (const x of travelTasks()) applyTravel(x);
    changed();
    return;
  }
  if (el.form?.id === 'planner-form') {
    if (!el.form.elements.dayStart) { // (v62) the Planner page: its own fields only
      const g = Object.fromEntries(new FormData(el.form));
      const patch = {};
      for (const k of ['weekCardDay', 'weekCardHour', 'snap']) if (k in g) patch[k] = Number(g[k]);
      if ('planStyle' in g) patch.planStyle = g.planStyle;
      if ('defaultView' in g) patch.defaultView = g.defaultView;
      if ('clock12' in g) patch.clock12 = g.clock12 === '1';
      if (el.form.elements.badge_conflicts) patch.planBadges = { conflicts: el.form.badge_conflicts.checked, behind: el.form.badge_behind.checked, toPlan: el.form.badge_toPlan.checked };
      saveSettings(patch); changed();
      if (el.name === 'defaultView') ui.view = null;
      return;
    }
    const f = Object.fromEntries(new FormData(el.form));
    const dayStart = Number(f.dayStart); const dayEnd = Number(f.dayEnd);
    const hr = (a, b, d) => { const x = parseTime(f[a]); const y = parseTime(f[b]); return x != null && y != null && y > x ? [x, y] : d; };
    // "Breathing room" is one number: the margin after each task and the gap the planner keeps between blocks.
    const breath = Number(f.taskBuffer) || 0;
    saveSettings({
      dayStart, dayEnd: Math.max(dayEnd, dayStart + 1), buffer: Math.min(breath, 15), taskBuffer: breath, maxLoad: Number(f.maxLoad), splitOver: Number(f.splitOver ?? 4), weekCardDay: Number(f.weekCardDay ?? state.settings.weekCardDay ?? 0), weekCardHour: Number(f.weekCardHour ?? state.settings.weekCardHour ?? 18), defaultView: f.defaultView ?? state.settings.defaultView, planStyle: f.planStyle || planStyle(), freeWeekends: el.form.freeWeekends.checked, smartLearn: el.form.smartLearn ? el.form.smartLearn.checked : Boolean(state.settings.smartLearn),
      autoHours: { wd: hr('ahWdF', 'ahWdT', autoHoursFor('2026-11-02')), we: hr('ahWeF', 'ahWeT', autoHoursFor('2026-11-07')) },
    });
    if (el.name === 'defaultView') ui.view = null;
    if (el.name === 'taskBuffer') { for (const x of travelTasks()) applyTravel(x); changed(); return; }
  }
  if (el.form?.id === 'advanced-form' && !el.form.elements.snap) { // (v62) the pages of Avanzate: each its own fields
    const f = el.form; const fd = new FormData(f); const has = (k) => Boolean(f.elements[k]);
    const patch = {};
    if (has('longUnits')) patch.longUnits = f.longUnits.checked;
    if (has('advancedFeatures')) patch.advancedFeatures = f.advancedFeatures.checked;
    if (has('glance')) patch.glance = fd.getAll('glance');
    if (has('tg')) { const on = fd.getAll('tg'); patch.taskGroups = { today: on.includes('today'), tomorrow: on.includes('tomorrow'), soon: on.includes('soon'), soonDays: Number(f.soonDays?.value) || 7 }; }
    saveSettings(patch);
    if (has('travelBuffer') && (el.name === 'travelBuffer' || el.name === 'googleKey')) {
      saveSettings({ travel: { ...travelCfg(), buffer: Number(f.travelBuffer.value) || 0, googleKey: f.googleKey.value.trim() }, travelCache: { ...travelCache(), routes: {} } });
      for (const x of travelTasks()) applyTravel(x);
      changed();
    }
    render();
    return;
  }
  if (el.form?.id === 'advanced-form') {
    const f = el.form; const fd = new FormData(f); const on = fd.getAll('tg');
    saveSettings({ snap: Number(f.snap.value), longUnits: f.longUnits.checked, advancedFeatures: f.advancedFeatures.checked, glance: fd.getAll('glance'), taskGroups: { today: on.includes('today'), tomorrow: on.includes('tomorrow'), soon: on.includes('soon'), soonDays: Number(f.soonDays.value) || 7 } });
    if (el.name === 'travelBuffer' || el.name === 'googleKey') {
      saveSettings({ travel: { ...travelCfg(), buffer: Number(f.travelBuffer.value) || 0, googleKey: f.googleKey.value.trim() }, travelCache: { ...travelCache(), routes: {} } });
      for (const x of travelTasks()) applyTravel(x);
      changed();
    }
  }
});


view.addEventListener('click', (e) => {
  // In-app links (‹ › and Today on the plan) change the address without the browser's own jump to the top.
  const link = e.target.closest('a[href^="#/"]');
  if (link && !link.dataset.action && !e.metaKey && !e.ctrlKey) { e.preventDefault(); location.hash = link.getAttribute('href'); return; }
  const btn = e.target.closest('[data-action]');
  if (btn && btn.tagName === 'INPUT') return; // checkboxes are handled on change
  if (!btn) {
    // Tap on an empty part of the timeline: new block at that time.
    const tl = e.target.closest('.timeline');
    if (tl && !e.target.closest('.block')) {
      const g = tl.getBoundingClientRect();
      const step = Math.max(Number(tl.dataset.snap) || 15, 15);
      const m = Number(tl.dataset.start) + (e.clientY - g.top) / (Number(tl.dataset.ppm) || PPM);
      openTask(null, null, { event: true, date: tl.dataset.date, start: Math.max(0, Math.floor(m / step) * step) });
      return;
    }
    const block = e.target.closest('.block:not(.ghost)');
    if (block?.classList.contains('event')) { const ev = eventOf(block.dataset.id); if (isEvent(ev)) openTask(ev); else if (ev) openEvent(ev); return; }
    if (block && !e.target.closest('.blk-check')) openBlock(get('blocks', block.dataset.id));
    return;
  }
  const { action, id } = btn.dataset;
  if (wideClick(btn)) return; // (v56) the pane on wide screens
  if (shopClick(btn, { planTrips: planTripsNow, shareList: shareShopList })) return; // the shopping list (views/shop.js)
  switch (action) {
    // (v66) the Planner's task list and search (finder.js), the week grid
    case 'fd-tab': ui.fdTab = id; render(); break;
    case 'ag-choose': openChooser(); break; // (v67) the phone's Pianifica
    case 'pv-list': openPropsList(); break;
    case 'pv-go': goToProposal(id, btn.dataset.date); break;
    case 'rh-week': { const x = get('tasks', id); if (x) { setWeekly(x); toast(t('rhDone', x.title)); } changed(); break; }
    case 'rh-ok': { const x = get('tasks', id); if (x) upsert('tasks', { ...x, rhythmOk: true }); changed(); break; }
    case 'rh-all': { for (const x of noRhythm()) setWeekly(x); saveSettings({ rhythmAsked: true }); toast(t('rhAllDone')); changed(); break; }
    case 'rh-none': saveSettings({ rhythmAsked: true }); changed(); break;
    case 'fd-unpick': { ui.pick = null; ui.pickOcc = null; ui.pickBlock = null; const ch = ui.chain; ui.chain = null; render(); if (ch) toast(t('chainStopped'), 7000, [{ label: t('undoAll'), run: () => { ch.undo(); changed(); toast(t('undone')); } }]); break; } // (v81)
    case 'swap-event': openDropOn('event', id); break;
    case 'box-fold': { ui.boxFold = ui.boxFold || new Set(); if (ui.boxFold.has(id)) ui.boxFold.delete(id); else ui.boxFold.add(id); render(); break; } // (v71) placing on an invitation: you won't go, it takes its slot
    case 'swap-block': openDropOn('block', id); break; // (v76) right after it, in its place, or together // (v70) placing something on a busy block: it takes that slot
    case 'conflict-choose': openConflictChoice(conflictsOn(btn.dataset.date || currentDate())[Number(btn.dataset.i)]); break;
    case 'fd-ended': ui.fdEnded = !ui.fdEnded; render(); break;
    case 'rt-resume': resumeRoutine(id); break;
    case 'fd-pick': { const occ = btn.dataset.occ || null; const same = ui.pick === id && (ui.pickOcc || null) === occ; ui.pick = same ? null : id; ui.pickOcc = same ? null : occ; ui.pickBlock = null; render(); break; }
    case 'fd-go': goToBlock(id); break;
    case 'fd-move': { const b = get('blocks', id); const x = b && get('tasks', b.taskId); if (x) openWeekGrid(x, { block: b, onClose: () => { modal.close(); render(); } }); break; }
    case 'fd-when': { const x = get('tasks', id); if (x) openWeekGrid(x, { onClose: (how, k) => { if (how === 'more') { openTask(get('tasks', id)); return; } if (how === 'quick') setWhen(get('tasks', id), k); modal.close(); render(); } }); break; }
    case 'plan-task': {
      const date = btn.dataset.date || currentDate();
      const b = planTask(get('tasks', id), date, btn.dataset.start ? Number(btn.dataset.start) : null);
      toast(t('plannedToast', relDay(date), fmtTime(b.start)));
      changed();
      warnConflicts(get('blocks', b.id));
      break;
    }
    case 'pick-date': {
      const p = $('#day-picker');
      try { p.showPicker(); } catch { p.focus(); p.click(); }
      break;
    }
    case 'new-meal': ui.mealDate = currentDate(); openMeal(null); break;
    case 'new-saved': openSavedPicker(currentDate()); break;
    case 'add-menu': openAddMenu(); break;
    case 'auto': openAutoPlanner(); break;
    case 'assign': if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: true, q: '' }; else ui.assign.open = !ui.assign.open; render(); break;
    case 'tray-toggle': ui.assign.open = !ui.assign.open; render(); break;
    case 'tray-planned': e.preventDefault(); ui.assign.showPlanned = !ui.assign.showPlanned; render(); break;
    case 'tray-why': e.preventDefault(); ui.assign.showWhy = !ui.assign.showWhy; render(); break;
    case 'why-day': ui.view = 'day'; ui.scrolledFor = null; location.hash = `#/plan/${id}`; requestAnimationFrame(() => requestAnimationFrame(scrollToGhost)); break;
    case 'filter': saveSettings({ taskFilter: { ...taskFilter(), [id]: !taskFilter()[id] } }); render(); break;
    case 'filter-cat': saveSettings({ taskFilter: { ...taskFilter(), cat: taskFilter().cat === id ? '' : id } }); render(); break;
    case 'wipe-local': if (confirm(t('wipeLocalConfirm'))) { wipeLocalData().then(() => { toast(t('wipedLocal')); changed(); }); } break;
    case 'filter-clear': saveSettings({ taskFilter: { fix: false, recurring: false, place: false, cat: '' } }); render(); break;
    case 'import': openImport(); break;
    case 'timer-pause': pauseTimer(runningBlock()); changed(); break;
    case 'timer-resume': resumeTimer(runningBlock()); changed(); break;
    case 'timer-stop': finishTimer(); break;
    case 'shift-rest': doShift(id); break;
    case 'shift-keep': ui.lateStart = null; changed(); break;
    case 'fix-occ': { const x = get('tasks', id); if (x) { const b = fixOcc(x, btn.dataset.date, Number(btn.dataset.start)); toast(t('plannedToast', relDay(b.date), fmtTime(b.start + anchorOffset(b)))); changed(); } break; }
    case 'fix-times': { const x = get('tasks', id); if (x) { fixTimes(x, { taskId: id, date: btn.dataset.date, start: Number(btn.dataset.start), minutes: Number(btn.dataset.minutes) }); changed(); } break; }
    case 'occ-skip': { const x = get('tasks', id); if (x) { skipOcc(x, btn.dataset.date); toast(t('skippedOcc', relDay(btn.dataset.date))); changed(); } break; }
    case 'occ-more': { const x = get('tasks', id); if (x) openPickSheet(x, btn.dataset.date); break; }
    case 'fix-week': { const n = fixAll(ui.weekRows || []); toast(t('fixedN', n)); changed(); break; }
    case 'week-later': laterWeek(id); render(); break;
    case 'task-tools': openTaskTools(id || 'todo'); break;
    case 'filter-off': saveSettings({ taskFilter: { ...taskFilter(), [id]: id === 'cat' ? '' : false } }); render(); break;
    case 'pal-start': { const b = get('blocks', id); const x = b && get('tasks', b.taskId); if (!x) break; const nb = startBlock(b); openPalestra(x, nb); afterStart(nb); break; }
    case 'routine-open': openRoutine(id); break;
    case 'routine-week': moveWeek(id); render(); break;
    case 'routine-review': ui.routineWeek = id; ui.tasksTab = 'saved'; saveSettings({ tasksTab: 'saved' }); location.hash = '#/tasks'; render(); window.scrollTo(0, 0); break;
    case 'saved-plan': { const x = get('tasks', id); if (x) openPlanSaved(x, today(), { stay: true }); break; }
    case 'shop-info': openShopInfo(); break;
    case 'assign-close': if (ui.assign) { ui.assign.ghosts = []; ui.assign.sel.clear(); ui.assign.open = false; } render(); break;
    case 'assign-opts': ui.assign.opts = !ui.assign.opts; render(); break;
    case 'assign-all': for (const x of trayTasks()) ui.assign.sel.add(x.id); render(); break;
    case 'assign-none': ui.assign.sel.clear(); render(); break;
    case 'assign-spread': {
      const days = spreadDays();
      if (!days.length) { toast(t('pastDay')); break; }
      const ids = ui.assign.sel.size ? trayTasks().filter((x) => ui.assign.sel.has(x.id)).map((x) => x.id) : trayTasks().map((x) => x.id);
      placeGhosts(ids, days);
      break;
    }
    case 'assign-range': {
      const r = ui.assign.range;
      if (!r || r.from !== r.to) ui.assign.range = { from: id, to: id };
      else if (r.from === id) ui.assign.range = null;
      else ui.assign.range = { from: id < r.from ? id : r.from, to: id > r.from ? id : r.from };
      render();
      break;
    }
    case 'assign-range-clear': ui.assign.range = null; render(); break;
    case 'ev-prep': prepareEvents(); break;
    case 'ev-prep-add': addGhosts(); ui.assign.evPrep = false; break;
    case 'ev-prep-cancel': ui.assign.ghosts = []; ui.assign.evPrep = false; render(); break;
    case 'ev-filters': openEventFilters(); break;
    case 'ev-new': openQuickTask({ kind: 'event' }); break;
    case 'ag-plan': agendaPlan(); break;
    case 'ag-add': agendaAdd(); break;
    case 'ag-cancel': ui.assign.ghosts = []; ui.assign.fix = null; ui.assign.kept = 0; render(); break; // (v76) what you kept stays
    case 'ghost-keep': keepGhost(Number(btn.dataset.i)); break;
    // (v78) today's blocks left behind: done, couldn't, or later today (Undo for each)
    case 'behind-done': case 'behind-fail': {
      const b = get('blocks', id); if (!b) break; const before = { ...b };
      if (action === 'behind-done') trySetBlockDone(b, true); else setOutcome(b, 'failed');
      changed(); toast(t(action === 'behind-done' ? 'esDoneToast' : 'markedCouldnt'), 5000, [{ label: t('undo'), run: () => { upsert('blocks', before, { silent: true }); changed(); } }]);
      break;
    }
    case 'behind-later': { const b = get('blocks', id); if (!b) break; const x = b.taskId && get('tasks', b.taskId); moveBlockTo(id, b.date, firstFreeStart({ ...(x || {}), minutes: b.minutes || 30 }, b.date)); break; }
    case 'fix-keep': keepFix(id, btn.dataset.date, Number(btn.dataset.start)); break;
    case 'fix-drop': keepFix(id, btn.dataset.date, Number(btn.dataset.start), false); break;
    case 'ag-gap': if (placePicked(btn.dataset.date, Number(btn.dataset.start), Number(btn.dataset.min))) break; openGapFits(btn.dataset.date, Number(btn.dataset.start), Number(btn.dataset.min)); break;
    case 'assign-clear': ui.assign.ghosts = []; render(); break;
    case 'assign-add': addGhosts(); break;
    case 'ghost-rm': ui.assign?.ghosts.splice(Number(btn.dataset.i), 1); render(); break;
    case 'toggle-steps': saveSettings({ showSteps: !showSteps() }); render(); break;
    case 'view': ui.view = id; ui.scrolledFor = null; render(); if (id !== 'day') window.scrollTo(0, 0); break;
    case 'view-day': ui.view = 'day'; ui.scrolledFor = null; if (currentDate() === id) render(); else location.hash = `#/plan/${id}`; break;
    case 'ag-toggle': if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id); render(); break;
    case 'block-edit': openBlock(get('blocks', id)); break;
    case 'block-fail': setOutcome(get('blocks', id), 'failed'); changed(); break;
    case 'block-reset': setOutcome(get('blocks', id), null); changed(); break;
    case 'meal-type-new': openTask(null, { title: '', minutes: 30, kind: 'meal', defaultStart: 12 * 60, category: 'meals', prep: [], rules: [], checklist: [], notes: '' }); break;
    case 'saved-new': openTask(null, { title: '', minutes: 30, kind: 'saved', defaultStart: null, when: '', category: null, importance: 3, prep: [], rules: [], steps: [], checklist: [], notes: '' }); break;
    case 'event': { const ev = eventOf(id); if (isEvent(ev)) openTask(ev); else if (ev) openEvent(ev); break; }
    case 'event-open': { const ev = eventOf(id); if (isEvent(ev)) openTask(ev); else if (ev) openEvent(ev); break; }
    case 'event-new': openTask(null, null, { event: true, date: btn.dataset.date || currentDate(), start: btn.dataset.start ? Number(btn.dataset.start) : null }); break;
    case 'event-task-add': { const ev = eventOf(id); if (ev) openEventTaskAdd(ev); break; }
    case 'event-plan': { const ev = eventOf(id); if (ev) planEventTasks(ev); break; }
    case 'open-block': { const b = get('blocks', id); if (b) openBlock(b); break; }
    case 'now-left': { const b = get('blocks', id); if (b) { setStepOutcome(b, btn.dataset.step, 'done'); toast(t('goodTrip')); changed(); } break; }
    case 'now-done': { const b = get('blocks', id); if (b && runningBlock()?.id === id) finishTimer(); else if (b) { if (trySetBlockDone(b, true)) { changed(); countToast(id); } else changed(); } break; }
    case 'now-move': { const b = get('blocks', id); const x = b && get('tasks', b.taskId); if (b && x && !classic()) openWeekGrid(x, { block: b, onClose: () => { modal.close(); render(); } }); else if (b) openBlock(b); break; } // (v81) the same Sposta everywhere
    case 'reflow-undo': undoReflow(); break;
    case 'reflow-ok': ui.reflow = null; render(); break;
    case 'templates': openTemplatesMenu(); break;
    case 'spare': openSpare(); break;
    case 'toggle-conflicts': ui.showConflicts = !ui.showConflicts; render(); break;
    case 'fix': fixConflict(conflictsOn(btn.dataset.date || currentDate())[Number(btn.dataset.i)]); break;
    case 'allow': {
      const c = conflictsOn(btn.dataset.date || currentDate())[Number(btn.dataset.i)];
      // (v72) only this pair: the other conflicts of the same block stay (calendar events can't be changed here)
      const b = get('blocks', c.ids[1]) || get('blocks', c.ids[0]);
      const other = b.id === c.ids[1] ? c.ids[0] : c.ids[1];
      upsert('blocks', { ...b, okWith: [...(b.okWith || []).filter((o) => o.id !== other), { id: other, date: b.date, start: b.start }] }, { silent: true });
      changed();
      break;
    }
    case 'task-edit': openTask(get('tasks', id)); break;
    case 'task-fix': { const x = get('tasks', id); if (!x) break; const sec = btn.dataset.sec; if (sec) saveSettings({ edSec: { ...(state.settings.edSec || {}), [sec]: true } }); openTask(x); break; }
    case 'use-location': {
      if (!navigator.geolocation) { toast(t('noGeo')); break; }
      navigator.geolocation.getCurrentPosition((pos) => {
        saveSettings({ here: { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lon: Math.round(pos.coords.longitude * 1e5) / 1e5, at: Date.now() }, travel: { ...travelCfg(), startHere: true } });
        toast(t('locationSet')); changed();
      }, () => toast(t('noGeo')), { timeout: 10000, maximumAge: 300000 });
      break;
    }
    case 'travel-refresh': saveSettings({ travelCache: { ...travelCache(), routes: {} } }); scheduleTravelRefresh(); toast(t('travelRefreshing')); break;
    case 'list-mode': setListMode(id); changed(); break;
    case 'plan-trips': planTripsNow(); break;
    case 'shop-new': openShopRec(null); break;
    case 'shop-rec': openShopRec(get(SHOPS(), id)); break;
    case 'toggle-done': ui.showDone = !ui.showDone; render(); break;
    case 'toggle-helpers': ui.showHelpers = !ui.showHelpers; render(); break;
    case 'toggle-saved': ui.showSaved = !ui.showSaved; render(); break;
    case 'tasks-tab': if (id !== 'shop') leaveShop(); ui.tasksTab = id; saveSettings({ tasksTab: id }); if (route().name === 'shop' && id !== 'shop') location.hash = '#/tasks'; else render(); window.scrollTo(0, 0); break;
    case 'vw-tab': { const v = viewList().find((y) => y.id === id); if (!v?.shop) leaveShop(); setView(id); if (route().name === 'shop' && !v?.shop) location.hash = '#/tasks'; else render(); window.scrollTo(0, 0); break; }
    case 'vw-views': openViews(); break;
    case 'vw-filters': openFilters(); break;
    case 'vw-sort': openSort(); break;
    case 'vw-triage': openTriage(); break;
    case 'vw-row': ui.openRow = ui.openRow === id ? null : id; render(); break;
    case 'vw-pick': openPick(id, btn.dataset.k); break;
    case 'prep-del': if (confirm(t('confirmDeleteTask'))) { remove('tasks', id); changed(); } break;
    case 'fold': {
      // Done tasks start folded; everything else starts open. The choice is remembered.
      const cur = state.settings.folded ?? ['grp_done'];
      saveSettings({ folded: cur.includes(id) ? cur.filter((k) => k !== id) : [...cur, id] });
      render();
      break;
    }
    case 'clear-done':
      for (const x of live('tasks').filter((y) => y.done)) remove('tasks', x.id);
      changed();
      break;
    case 'tpl-new': openTemplate(null); break;
    case 'tpl-edit': openTemplate(get('templates', id)); break;
    case 'cat-new': openCategory(null); break;
    case 'cat-edit': openCategory(get('categories', id)); break;
    case 'sync-now': runSync().then(() => { ui.connMsg = state.meta.lastError ? `err_${state.meta.lastError}` : 'connected'; render(); }); break;
    case 'gh-edit': ui.editGithub = true; ui.connMsg = ''; render(); break;
    case 'gh-cancel': ui.editGithub = false; render(); break;
    case 'gcal-now': gcalNow(); break;
    case 'leg-edit': { ensureLegTasks(); const x = legTemplate(btn.dataset.kind); if (x) openTask(x); break; }
    case 'gcal-remove': if (confirm(t('gcalRemoveConfirm'))) { removeCalendarData().then((n) => { toast(t('gcalRemoved', n)); changed(); }).catch(() => { toast(t('err_network')); }); } break;
    case 'pal-off': saveSettings({ palestraRepo: '' }).then(() => { ui.palMsg = ''; render(); }); break;
    case 'ric-off': saveSettings({ ricetteRepo: '' }).then(() => { ui.ricMsg = ''; render(); }); break;
    case 'export': exportData(); break;
    default: break;
  }
});

// (v67) the Planner's sheets on a phone (Scelgo io, the proposals): their rows act as in the pane
modal.addEventListener('click', (e) => {
  const btn = e.target.closest('.fd [data-action], .pv [data-action]');
  if (btn && sheetClick(btn)) e.preventDefault();
});
modal.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action=open-task], [data-action=task-fix]');
  if (!a) return;
  e.preventDefault();
  const task = get('tasks', a.dataset.id);
  if (a.dataset.sec) saveSettings({ edSec: { ...(state.settings.edSec || {}), [a.dataset.sec]: true } });
  modal.close();
  setTimeout(() => openTask(task), 0);
});

// 🛒 Plan the grocery trips (the shopping list's ⋯ menu).
function planTripsNow() {
  const { blocks, missing } = planGroceryTrips();
  if (blocks.length) toast(t('tripsPlanned', blocks.map((b) => `${b.title.replace(`${t('groceryTitle')}`, '').replace(/^[ ·:]+/, '') || t('groceryTitle')} ${relDay(b.date)} ${fmtTime(b.start)}`).join(' · ')), 7000);
  if (missing.length) toast(t('tripNoTime', missing.map(shopName).join(', ')), 7000);
  changed();
}

view.addEventListener('sorted', (e) => onSorted(e.detail));

// (v69) Drag and drop (mouse): rows of the Planner's pane (tasks, routine turns, routines on the shelf) and
// blocks in the agenda, onto a free stretch (where it fits lights up), a day of the week, or a day in the rail.
let dnd = null;
const dropTarget = (el) => el?.closest?.('.ag-gap, .ag-day, .rl-day, .ag-row[data-drag^="block:"], .ag-row[data-ev]') || (dnd?.v.startsWith('block:') ? el?.closest?.('.pane') : null); // (v82) a block onto the panel: off the plan
document.addEventListener('dragstart', (e) => {
  const src = e.target.closest?.('[data-drag]'); if (!src) return;
  dnd = { v: src.dataset.drag, min: Number(src.dataset.min) || 30 };
  e.dataTransfer.setData('text/plain', dnd.v); e.dataTransfer.effectAllowed = 'move';
  document.body.classList.add('dnd');
  for (const g of document.querySelectorAll('.ag-gap button[data-min]')) g.parentElement.classList.toggle(Number(g.dataset.min) >= dnd.min ? 'dnd-fits' : 'dnd-nofit', true);
  ui.dragging = true;
});
const dndEnd = () => {
  dnd = null; ui.dragging = false; document.body.classList.remove('dnd');
  for (const el of document.querySelectorAll('.dnd-fits, .dnd-nofit, .dnd-over')) el.classList.remove('dnd-fits', 'dnd-nofit', 'dnd-over');
};
document.addEventListener('dragend', () => { if (dnd) dndEnd(); });
document.addEventListener('dragover', (e) => {
  if (!dnd) return;
  const tg = dropTarget(e.target); if (!tg) return; // (v74) a stretch too short takes it too: the overlap shows as a conflict
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  for (const el of document.querySelectorAll('.dnd-over')) if (el !== tg) el.classList.remove('dnd-over');
  tg.classList.add('dnd-over');
});
document.addEventListener('drop', (e) => {
  if (!dnd) return;
  const tg = dropTarget(e.target); if (!tg) return;
  e.preventDefault();
  const v = dnd.v; dndEnd();
  if (tg.classList.contains('pane')) { unplanToPane(v.slice(6)); return; }
  if (tg.classList.contains('ag-row')) { // (v70) onto a block: it takes that slot, you say where the other goes (v71: or onto an invitation)
    const yId = tg.dataset.ev ? null : tg.dataset.drag.slice(6); const [k0, id0, occ0] = v.split(':');
    if (k0 === 'block') { if (id0 === yId) return; ui.pickBlock = id0; ui.pick = null; } else { ui.pick = id0; ui.pickOcc = k0 === 'turn' && occ0 ? occ0 : null; ui.pickBlock = null; }
    if (tg.dataset.ev) openDropOn('event', tg.dataset.ev); else openDropOn('block', yId); return;
  }
  const btn = tg.querySelector('button[data-date]') || tg;
  const date = btn.dataset.date || tg.dataset.id || tg.querySelector('[data-id]')?.dataset.id;
  if (!date) return;
  const [kind, id, occ] = v.split(':');
  // (v75) a stretch too short takes it too: the bar warns of the overlap, or of the time it lacks
  const room = btn.dataset.min ? Number(btn.dataset.min) : null;
  if (kind === 'block') { const b = get('blocks', id); if (!b) return; moveBlockTo(id, date, btn.dataset.start != null ? Number(btn.dataset.start) : firstFreeStart({ ...b, minutes: b.minutes }, date), { short: room != null ? Math.max(0, (b.minutes || 30) - room) : 0 }); return; }
  const x = get('tasks', id); if (!x) return;
  const start = btn.dataset.start != null ? Number(btn.dataset.start) : firstFreeStart(x, date);
  placeItem(x, date, start, { occ: kind === 'turn' && occ ? occ : null, short: room != null ? Math.max(0, (x.minutes || 30) + leadOf(x) - room) : 0 });
});

setupDrag(view, {
  dragging: (on) => { ui.dragging = on; document.body.classList.toggle('is-dragging', on); },
  label: (start, minutes) => range(start, minutes),
  move: (id, start, date) => {
    const b = get('blocks', id);
    if (b) { const m = upsert('blocks', { ...b, start, date: date || b.date, auto: false }, { silent: true }); followParent(m); }
    changed();
    warnConflicts(get('blocks', id));
  },
  resize: (id, minutes) => {
    const b = get('blocks', id);
    if (b) upsert('blocks', { ...b, minutes }, { silent: true });
    changed();
    warnConflicts(get('blocks', id));
  },
  dropTask: (id, start, date) => {
    const task = get('tasks', id);
    let b = null;
    const d = date || currentDate();
    if (task) { b = planTask(task, d, start); toast(t('plannedToast', relDay(d), fmtTime(start))); }
    changed();
    if (b) warnConflicts(get('blocks', b.id));
  },
  // A preview moved by hand: it keeps its lead time before it, and says it was you.
  moveGhost: (i, start, date) => {
    const g = ui.assign?.ghosts[i];
    if (g) Object.assign(g, { date: date || g.date, start: start + (g.lead || 0), reasons: [{ k: 'r_byHand' }] });
    render();
  },
  redraw: () => render(),
});

// The app name in the corner takes you back to the plan.
// The + : a tap adds what fits the tab (v52); holding it (or a right click) opens the menu of every kind.
{
  const fab = $('#fab'); let hold = null; let held = false;
  fab.addEventListener('pointerdown', () => { held = false; hold = setTimeout(() => { held = true; navigator.vibrate?.(12); openAddMenu({ fab: true }); }, 500); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) fab.addEventListener(ev, () => clearTimeout(hold));
  fab.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!held) openAddMenu({ fab: true }); held = true; });
  fab.addEventListener('click', () => { if (held) { held = false; return; } hideToast(); openQuickTask({ kind: plusKind() }); });
}
$('#app-title').addEventListener('click', () => {
  if (route().name === 'today') window.scrollTo({ top: 0, behavior: 'smooth' }); else location.hash = '#/today';
});
$('#app-title').setAttribute('role', 'link');
$('#app-title').tabIndex = 0;
$('#app-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = '#/today'; });
// Phones: swipe left / right on the page switches tabs (not from a block, chip or the timeline, which drag).
(() => {
  let sx = 0; let sy = 0; let at = 0; let ok = false;
  document.addEventListener('touchstart', (e) => {
    const tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY; at = Date.now();
    ok = !e.target.closest('.block, .chip, .tchip, .timeline, .week, .tray, dialog, input, textarea, select, .sl-handle, [draggable], .month, .wk-grid');
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!ok || document.body.classList.contains('is-dragging') || $('#modal')?.open) return;
    const tch = e.changedTouches[0]; const dx = tch.clientX - sx; const dy = tch.clientY - sy;
    if (Date.now() - at > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const i = TABS.indexOf(TAB_OF[route().name] || 'today'); if (i < 0) return;
    const j = i + (dx < 0 ? 1 : -1);
    if (j < 0 || j >= TABS.length) return;
    location.hash = `#/${TABS[j]}`;
  }, { passive: true });
})();

setupTrayDrag({
  onTap: (id, chip) => {
    if (ui.assign && !chip?.closest('.to-plan')) { if (ui.assign.sel.has(id)) ui.assign.sel.delete(id); else ui.assign.sel.add(id); render(); return; }
    const x = get('tasks', id); if (x) openPlanSaved(x, currentDate() < today() ? today() : currentDate());
  },
  onDrop: (id, tgt, chip) => {
    if (ui.assign && !chip?.closest('.to-plan')) { assignDrop(id, tgt); return; }
    if (!tgt?.date) return;
    if (tgt.date < today()) { toast(t('pastDay')); return; }
    const b = planTask(get('tasks', id), tgt.date, tgt.minute ?? undefined);
    toast(t('plannedToast', relDay(tgt.date), fmtTime(b.start)));
    changed();
    warnConflicts(get('blocks', b.id));
  },
  onDragging: (on) => {
    // Folding the tray while dragging must not move the page under the finger: keep its old height as margin.
    const tray = document.querySelector('.tray'), h = tray?.offsetHeight || 0;
    ui.dragging = on; document.body.classList.toggle('is-dragging', on);
    if (tray) tray.style.marginBottom = on ? `${Math.max(0, h - tray.offsetHeight)}px` : '';
  },
  label: (id, tgt) => {
    const n = ui.assign?.sel.has(id) ? ui.assign.sel.size : 1;
    const what = n > 1 ? t('nTasks', n) : get('tasks', id)?.title || '';
    if (!tgt) return what;
    return `${what} → ${fmtDay(tgt.date, { weekday: 'short', day: 'numeric' })}${tgt.minute != null ? ` ${fmtTime(tgt.minute)}` : ''}`;
  },
});

// ---------- start ----------

// For the tests: what the app is still busy with. Empty = settled (no redraw queued, no sync running or
// queued, no travel lookup running or queued). Read-only, and nothing in the app depends on it.
window.__everyday = {
  busy: () => [
    ...(ui.renderQueued ? ['render'] : []),
    ...(isSyncing() || (syncScheduled() && isConfigured()) ? ['sync'] : []),
    ...(travelBusy || travelTimer ? ['travel'] : []),
  ],
};

async function boot() {
  await load();
  applyLang(state.settings.lang);
  seedCategories();
  seedMeals();
  if (!isConfigured()) seedSharedSettings();
  await applySharedSettings();
  normalizeKinds();
  repairRhythms(); // (v82)
  saveSettings({ travelCache: pruneCache(travelCache()) });
  migrateBlocksToEvents();
  syncEventTasks();
  renderShell();
  render();
  const kinds = new Set([...COLLECTIONS, ...Object.keys(RICETTE)]);
  onChange((kind) => {
    updateSyncBadge();
    if (kind === 'config' && state.meta.dirty && isConfigured()) { scheduleSync(); } // a shared setting changed
    if (kind !== 'meta' && kinds.has(kind)) renderIfSafe(); // sync bookkeeping alone never redraws the page
  });
  let lastTab = TAB_OF[route().name] || 'today';
  window.addEventListener('hashchange', () => {
    if (!(route().name === 'shop' || (route().name === 'tasks' && (classic() ? ui.tasksTab === 'shop' : curView().shop)))) leaveShop(); // leaving the list ends Reorder and Select
    const tab = TAB_OF[route().name] || 'today';
    if (tab === 'plan' && lastTab !== 'plan') ui.scrolledFor = null; // back on the planner: jump to now again
    // Back to today from another day (the "Today" button): show now again.
    if (tab === 'plan' && currentDate() === today() && ui.shownDate && ui.shownDate !== today()) ui.scrolledFor = null;
    if (lastTab === 'tasks' && tab !== 'tasks') ui.justAdded?.clear(); // "Just added" lasts until you leave the tab
    lastTab = tab;
    render();
    if (tab !== 'plan') window.scrollTo(0, 0);
  });
  window.addEventListener('online', runSync);
  window.addEventListener('offline', () => updateSyncBadge());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { runSync(); renderIfSafe(); } });
  $('#sync').addEventListener('click', runSync);
  handleShortcut();
  runSync();
  // A running timer's clock, between redraws.
  setInterval(() => { const el = document.getElementById('run-time'); const b = runningBlock(); if (el && b) el.textContent = elapsedText(b); }, 15000);
  // Every minute: move the "now" line, and pick up changes from other devices.
  let day = today();
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    positionNow();
    if (today() !== day) { day = today(); renderIfSafe(); } // past midnight: "today" moved on
    // Steps whose time has come (ingredient checks) and blocks that were missed.
    const n = state.blocks.length; const stamp = JSON.stringify(state.blocks.map((b) => b.outcome || b.missedAt || ''));
    autoChecks(today()); checkMissed(today());
    if (state.blocks.length !== n || stamp !== JSON.stringify(state.blocks.slice(0, n).map((b) => b.outcome || b.missedAt || ''))) changed();
    runSync();
  }, 60_000);
  // New versions: the service worker installs them in the background; then a bar offers to reload.
  if ('serviceWorker' in navigator) {
    const had = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdateBar(); });
    navigator.serviceWorker.register('sw.js').then((reg) => {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  }
}

boot();
