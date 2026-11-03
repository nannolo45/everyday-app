// editors.js: moved from app.js (v36). See app.js for how the modules fit together.
import { isPalestra, PALESTRA_APP, palestraNote, startLink } from './palestra.js';
import { routines } from './routines.js';
import { classic, curView, RICETTE_APP, setView, setWhen, viewName, viewTokens, wouldShow } from './views/impegni.js';
import { openWeekGrid } from './weekgrid.js';
import { upcomingOf } from './finder.js';
import { countToast, rejoinEvent, setCounts, skipEvent, unskipEvent } from './placing.js';
import { advancedOn, catChips, catChipsMulti, catColor, catName, catsOf, categories, readCats, esc, findCategory, fmtDay, hint, kitchen, modal, PALETTE, planSettings, quickFields, range, reasonText, relDay, route, small, toast, ui, weekdayNames } from './core.js';
import { getLang, t } from './i18n.js';
import { isEvent, isMealType, isSaved, isStep, withKind } from './kinds.js';
import { alreadyPlanned, hasDayLen, learnHint, minutesOn, setDayMinutes, evSkipOf, isInvite, setEvSkip, countedOf, turnCounts, anchorIndex, anchorOffset, anchorTitle, applyTemplate, blocksOn, busyOn, checklistLeft, checklistOf, checkMealNow, deleteBlock, endSeries, ensureSeries, eventBlockOf, eventDate, eventOf, eventTasksOf, followParent, isCheckStep, isSeries, leadOf, mealRecipes, mealTitle, mealTypes, newBlock, nextBlockOf, nextPlanned, offsetDue, offsetText, openTasks, outcomeOf, plannedTaskIds, plannedWhen, planTask, PREP_PLACES, qtyText, readinessText, recipeOf, recipes, RULE_PLACES, RULE_WHEN, rulesOf, savedGroups, savedInfo, savedStart, saveEvent, savedTasks, seriesBlocks, setBlockDone, setOutcome, setStepOutcome, setTaskDone, shoppingItems, splitSeries, stepLen, stepsDoneOf, stepsOf, stepTimes, syncEventTasks, taskIssues, taskSpan, templates, travelTasks, trySetBlockDone, tryStep } from './model.js';
import { addDays, fmtDur, fmtTime, isoDay, formatTemplateLines, parseDuration, freeSlot, groupTasks, IMPORTANCE, importanceOf, isDate, nowMinutes, parseDate, parseTemplateLines, parseTime, quickAdd, REPEATS, sortTasks, today } from './plan.js';
import { AUTO_SPANS, partOfDay, placeGhosts, planEventTasks, planSoon, suggestSlot, trayTasks, tripItems, warnConflicts } from './planning.js';
import { pantryCoverage } from './recipe-tools.js';
import { ingredientsOf } from './kitchen.js';
import { filterRecipes, folderOfRecipe, folderTree, minutesOf, originLabel, STAGES, stageOf, tagCounts, tagLabel, tagsOf, timeParts } from './recipes.js';
import { changed, currentDate, render } from './shell.js';
import { fold, matchesQ } from './shoplist.js';
import { candidates, spareTime } from './smart.js';
import { get, has, kvGet, kvSet, live, remove, saveSettings, state, uid, upsert } from './store.js';
import { fetchRicettePhoto, ricetteConfigured } from './sync.js';
import { applyTravel, hereNow, isTravelStep, ownMinutes, realSteps, scheduleTravelRefresh, travelCfg, travelOf } from './travel-plan.js';
import { MODE_ICON, MODES as TRAVEL_MODES } from './travel.js';
import { impBadge, invTag } from './views/planner.js';
import { remindDefault, remindLabel, REMINDS } from './views/settings.js';
import { SHOPS, shopAdd, shopsList, tripRowsHtml } from './views/shop.js';
import { fixOcc, skipOcc, slotOptions } from './weekpick.js';
import { pullCandidate, pullUp, runningBlock, shiftAfter, startBlock, startTask, stopTimer, timeHistory, undoShift } from './timer.js';
import { cleanWindows, dateBox, dayShort, durField, lines, openModal, placeLink, plannedIso, readDur, readWindows, repeatText, searchBox, TIME24, windowsEditor, windowsText } from './widgets.js';

// "+ To do before / after": a task attached to an event, due so many days or weeks around it.
// How the planner treats the steps: on its own judgement, always in one block, or one block each.
function stepsPlanPills(x) {
  const v = x.splitSteps ? 'each' : x.keepTogether ? 'together' : 'auto';
  const pill = (k) => `<label class="day-pill"><input type="radio" name="stepsPlan" value="${k}" ${v === k ? 'checked' : ''}><span>${esc(t(`stepsPlan_${k}`))}</span></label>`;
  return `<div class="field-label">${esc(t('stepsPlan'))}</div><div class="pills steps-plan">${['auto', 'together', 'each'].map(pill).join('')}</div><small class="hint">${esc(t(`stepsPlanHint_${v}`))}</small>`;
}
export function openEventTaskAdd(ev, { back = false } = {}) {
  const d = eventDate(ev);
  openModal(`
    <h2>✓ ${esc(t('addEventTask'))}</h2>
    <p class="hint">📅 ${esc(ev.title)}${d ? ` · ${esc(relDay(d))}` : ''}</p>
    <label>${esc(t('title'))}<input name="title" required autocomplete="off" placeholder="${esc(t('eventTaskPh'))}"></label>
    <div class="offset-row">
      <input name="evDays" type="number" min="0" max="365" step="1" value="1" aria-label="${esc(t('offsetDays'))}">
      <select name="evUnit"><option value="days">${esc(t('daysUnit'))}</option><option value="weeks">${esc(t('weeksUnit'))}</option></select>
      <select name="evWhen"><option value="before">${esc(t('beforeIt'))}</option><option value="after">${esc(t('afterIt'))}</option></select>
    </div>
    ${small('eventTaskOffsetHint')}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('add'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form, action) => {
    if (action === 'ok') {
      const q = quickAdd(form.title.value);
      if (!q.title) return;
      const off = { days: Math.max(0, Number(form.evDays.value) || 0) * (form.evUnit.value === 'weeks' ? 7 : 1), when: form.evWhen.value };
      const base = quickFields(q);
      applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...base, category: base.category || (isEvent(ev) ? ev.category : null) || null, eventId: ev.id, eventOffset: off, due: d ? offsetDue(d, off) : null }, { silent: true }));
      toast(t('eventTaskAdded', ev.title));
      changed();
    }
    if (back) setTimeout(() => (isEvent(ev) ? openTask(get('tasks', ev.id)) : openEvent(get('events', ev.id))), 0);
  });
}
// A small choice: only this occurrence, or this and the following ones.
export function askScope({ title, thisLabel, followingLabel, onThis, onFollowing }) {
  openModal(`
    <h2>↻ ${esc(title)}</h2>
    <div class="add-opts">
      <button class="add-opt" value="this" formnovalidate><span class="add-ico">1</span><span class="item-text">${esc(thisLabel)}</span></button>
      <button class="add-opt" value="following" formnovalidate><span class="add-ico">↻</span><span class="item-text">${esc(followingLabel)}</span></button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (action === 'this') setTimeout(onThis, 0);
    if (action === 'following') setTimeout(onFollowing, 0);
  });
}

// (v71) In the editor: "Durata diversa in certi giorni", a length for each day of a weekly routine.
function dayLenPart(x) {
  if (!hasDayLen(x) || x.steps.length) return '';
  const on = Boolean(x.dayMinutes);
  const days = [...x.repeatDays].sort((a, b) => a - b);
  const rows = on ? `<div class="daylen">${days.map((d) => `<span class="dl-d">${esc(dayShort(d))}</span>${durField(`dm_${d}`, x.dayMinutes[d] || x.minutes || 30, { label: `${t('duration')} ${dayShort(d)}` })}`).join('')}</div>` : '';
  return `<label class="check"><input type="checkbox" name="dayLen" data-rerender="1" ${on ? 'checked' : ''}> <span>${esc(t('dlSwitch'))}<small>${esc(on ? dayLenSummary(x) : t('dlSwitchOff'))}</small></span></label>${rows}`;
}
export function dayLenSummary(x) {
  if (!x?.dayMinutes) return '';
  const g = new Map();
  for (const d of [...(x.repeatDays || [])].sort((a, b) => a - b)) { const m = x.dayMinutes[d] || x.minutes || 30; g.set(m, [...(g.get(m) || []), dayShort(d)]); }
  return [...g].map(([m, ds]) => `${ds.join(', ')}: ${fmtDur(m)}`).join(' · ');
}
// (v71) A routine turn got a new length: every <Saturday> (that weekday only), only this one, or all from here on.
function askDayLen(task, b, rec, finish) {
  const iso = isoDay(b.date);
  const others = (task.repeatDays || []).filter((d) => d !== iso);
  const othersTxt = others.map((d) => `${dayShort(d)} ${fmtDur(minutesOn(task, nextOn(task, d) || b.date))}`).join(', ');
  const undoWith = (before, blocks) => () => { upsert('tasks', before, { silent: true }); for (const y of blocks) upsert('blocks', y, { silent: true }); changed(); toast(t('undone')); };
  openModal(`<h2>${esc(`${fmtDur(b.minutes)} → ${fmtDur(rec.minutes)}`)}</h2><p class="hint">${esc(t('dlWhich', task.title))}</p>
    <div class="choose">
      <button class="btn primary choose-opt" value="day"><b>${esc(t('dlEveryDay', iso))}</b><small>${esc(t('dlEveryDaySub', relDay(b.date), othersTxt))}</small></button>
      <button class="btn choose-opt" value="this"><b>${esc(t('onlyThisOcc', relDay(b.date)))}</b><small>${esc(t('dlThisSub', fmtDur(b.minutes)))}</small></button>
      <button class="btn choose-opt" value="all"><b>${esc(t('dlAll'))}</b><small>${esc(t('dlAllSub', fmtDur(rec.minutes)))}</small></button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (!['day', 'this', 'all'].includes(action)) return;
    const before = { ...get('tasks', task.id) };
    const blocks = live('blocks').filter((y) => y.taskId === task.id).map((y) => ({ ...y }));
    if (action === 'this') { finish({ ...rec, ...(b.seriesId ? { auto: false } : {}) }); toast(t('dlDoneThis', relDay(b.date), fmtDur(rec.minutes)), 5000, [{ label: t('undo'), run: undoWith(before, blocks) }]); return; }
    let tk = get('tasks', task.id);
    if (action === 'day') tk = setDayMinutes(tk, iso, rec.minutes);
    else tk = upsert('tasks', { ...tk, minutes: rec.minutes, dayMinutes: null }, { silent: true });
    // this turn and the later ones on that weekday (or all) take the new length (series turns follow it again)
    for (const y of live('blocks').filter((z) => z.taskId === tk.id && z.kind !== 'prep' && !z.stepId && z.date >= b.date && !outcomeOf(z) && (action === 'all' || isoDay(z.date) === iso))) upsert('blocks', { ...y, minutes: rec.minutes, ...(y.seriesId ? { auto: true } : {}) }, { silent: true });
    ensureSeries(get('tasks', tk.id));
    finish({ ...get('blocks', b.id), notes: rec.notes, allowOverlap: rec.allowOverlap, ...(b.seriesId ? { auto: true } : {}), minutes: rec.minutes });
    toast(action === 'day' ? t('dlDoneDay', iso, fmtDur(rec.minutes)) : t('dlDoneAll', task.title, fmtDur(rec.minutes)), 5000, [{ label: t('undo'), run: undoWith(before, blocks) }]);
  }, { cls: 'sheet choose-sheet' });
}
const nextOn = (task, iso) => { for (let i = 0; i < 7; i++) { const d = addDays(today(), i); if (isoDay(d) === iso) return d; } return null; };
// A step whose result matters ("Check the backpack": ready, or not?): ticking it asks how it went.
export function openOutcome(block, sid = null, { thenWhole = false } = {}) {
  const failRules = rulesOf(block, sid).filter((r) => r.when === 'failed');
  const title = sid ? stepsOf(block).find((x) => x.id === sid)?.title || block.title : block.title;
  const what = failRules.map((r) => (r.then === 'groceries' ? t('groceryTitle') : get('tasks', r.taskId)?.title || r.title)).filter(Boolean);
  setTimeout(() => openModal(`
    <h2>${esc(t('howDidItGo', title))}</h2>
    ${what.length ? `<p class="hint">${esc(t('ifNotThen', what.join(', ')))}</p>` : ''}
    <div class="outcome-choice">
      <button class="btn primary" value="done">✓ ${esc(t('wentOk'))}</button>
      <button class="btn" value="fail">✕ ${esc(t('couldntDo'))}</button>
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    if (sid) {
      setStepOutcome(get('blocks', block.id), sid, action === 'done' ? 'done' : 'failed');
      // You ticked the whole task: once this step is answered, the rest follow.
      if (thenWhole && action === 'done' && outcomeOf(get('blocks', block.id)) !== 'done' && trySetBlockDone(get('blocks', block.id), true)) changed();
      else changed();
      return;
    } else setOutcome(get('blocks', block.id), action === 'done' ? 'done' : 'failed');
    changed();
  }), 0);
}
export function openAutoPlanner() {
  // The guided flow: pick the span, fill the few details the planner is missing (inline, no editor),
  // then the previews appear on the plan and the drawer asks to add them.
  const td = today();
  const last = state.settings.autoSpan || { span: '7', n: 5 };
  const from0 = currentDate() > td ? currentDate() : td;
  const all = trayTasks();
  const sel = ui.assign?.sel?.size ? all.filter((x) => ui.assign.sel.has(x.id)) : all;
  const bad = sel.filter((x) => taskIssues(x).length).slice(0, 6);
  const noHome = bad.some((x) => taskIssues(x).includes('iss_home'));
  const LENS = [15, 30, 45, 60, 90, 120];
  const fix = (x) => {
    const iss = taskIssues(x);
    const rows = [];
    if (iss.includes('iss_len')) rows.push(`<div class="fix-row"><span>${esc(t('duration'))}</span><div class="pills">${LENS.map((m) => `<label class="day-pill"><input type="radio" name="len_${esc(x.id)}" value="${m}" ${m === 30 ? 'checked' : ''}><span>${esc(fmtDur(m))}</span></label>`).join('')}</div></div>`);
    if (iss.includes('iss_place') || iss.includes('iss_geo')) rows.push(`<div class="fix-row"><span>${esc(t('place'))}</span><input name="place_${esc(x.id)}" value="${esc(x.place || '')}" placeholder="${esc(t('placePh'))}" autocomplete="off"></div>${iss.includes('iss_geo') ? `<small class="hint warn-text">${esc(t('iss_geo'))}</small>` : ''}`);
    if (iss.includes('iss_long')) rows.push(`<div class="fix-row"><span>${esc(t('tooLongShort'))}</span><div class="pills"><label class="day-pill"><input type="radio" name="long_${esc(x.id)}" value="split" checked><span>${esc(t('splitIt'))}</span></label><label class="day-pill"><input type="radio" name="long_${esc(x.id)}" value="keep"><span>${esc(t('keepWhole'))}</span></label></div></div>`);
    if (iss.includes('iss_travel')) rows.push(`<small class="hint">${esc(t('iss_travel'))} · ${esc(t('travelCounted'))}</small>`);
    return rows.length ? `<div class="fix-card"><div class="fix-head"><b>${esc(x.title)}</b><small>${esc([x.due ? relDay(x.due) : '', x.minutes && x.lenSet ? fmtDur(x.minutes) : ''].filter(Boolean).join(' · '))}</small></div>${rows.join('')}</div>` : '';
  };
  const cards = bad.map(fix).filter(Boolean);
  openModal(`
    <h2>✦ ${esc(t('planBtn'))}</h2>
    <p class="hint">${esc(t('planFlowIntro', sel.length, cards.length))}</p>
    <div class="days spans">${AUTO_SPANS.map((k) => `<label class="day-pill"><input type="radio" name="span" value="${k}" ${k === last.span ? 'checked' : ''}><span>${esc(t(`span_${k}`))}</span></label>`).join('')}</div>
    <div class="two">
      <label>${esc(t('fromDay'))}${dateBox(`<input type="date" name="from" value="${esc(from0)}" min="${esc(td)}">`, from0)}</label>
      <label>${esc(t('spanN'))}<input type="number" name="n" min="1" max="90" value="${esc(last.n || 5)}"></label>
    </div>
    ${cards.length ? `<div class="field-label">${esc(t('fixFirstTitle'))}</div>${noHome ? `<label>${esc(t('homeAddress'))}<input name="home" value="${esc(travelCfg().home)}" placeholder="${esc(t('homePh'))}" autocomplete="street-address"></label>` : ''}${cards.join('')}<small class="hint">${esc(t('fixSkipHint'))}</small>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(cards.length ? t('showPreview') : t('autoGo'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form) => {
    // Apply the inline fixes.
    for (const x of bad) {
      const len = form[`len_${x.id}`]; const pl = form[`place_${x.id}`]; const lg = form[`long_${x.id}`];
      const patch = {};
      if (len) { const v = Number(form.querySelector(`input[name="len_${x.id}"]:checked`)?.value); if (v) { patch.minutes = v; patch.lenSet = true; } }
      if (pl && pl.value.trim() !== (x.place || '')) patch.place = pl.value.trim();
      if (lg) { patch.splitSteps = form.querySelector(`input[name="long_${x.id}"]:checked`)?.value === 'split' && (x.steps || []).filter((y) => y.title && !isTravelStep(y)).length > 1; patch.keepTogether = !patch.splitSteps; }
      if (Object.keys(patch).length) applyTravel(upsert('tasks', { ...x, ...patch }, { silent: true }), { prev: x });
    }
    if (form.home && form.home.value.trim() !== travelCfg().home) { saveSettings({ travel: { ...travelCfg(), home: form.home.value.trim() } }); for (const x of travelTasks()) applyTravel(x); }
    const span = form.querySelector('input[name=span]:checked')?.value || '7';
    const n = Math.max(1, Math.min(90, Number(form.n.value) || 5));
    saveSettings({ autoSpan: { span, n } });
    const from = isDate(form.from.value) && form.from.value >= td ? form.from.value : td;
    let days = [];
    if (span === 'month') { const m = from.slice(0, 7); for (let d = from; d.slice(0, 7) === m; d = addDays(d, 1)) days.push(d); } else {
      const k = span === 'n' ? n : Number(span);
      for (let i = 0; i < k; i++) days.push(addDays(from, i));
    }
    const weekend = (d) => [0, 6].includes(parseDate(d).getDay());
    if (state.settings.freeWeekends && days.some((d) => !weekend(d))) days = days.filter((d) => !weekend(d));
    if (!ui.assign) ui.assign = { sel: new Set(), ghosts: [], range: null, opts: false, open: false, q: '' };
    const ids = ui.assign.sel.size ? trayTasks().filter((x) => ui.assign.sel.has(x.id)).map((x) => x.id) : trayTasks().map((x) => x.id);
    if (!ids.length) { toast(t('trayEmpty')); render(); return; }
    if (route().name !== 'plan') { location.hash = span === '1' ? `#/plan/${from}` : '#/plan'; ui.view = span === '1' ? 'day' : span === 'month' ? 'month' : 'week'; }
    ui.assign.open = false; // the previews matter now; the list can be opened again
    placeGhosts(ids, days);
    scheduleTravelRefresh();
  });
  modal.querySelector('input[name=n]').addEventListener('input', () => { const r = modal.querySelector('input[name=span][value=n]'); if (r) r.checked = true; });
}

// Import tasks from pasted text: one per line (lists from messages, notes, emails). Bullets,
// numbers and checkboxes are dropped; "30m", "!1" and "#work" work as in quick add.
export function parseTaskLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·–—>]+|\d+[.)]|\[[ xX]?\]|[☐☑✓✔︎]+)\s*/u, '').trim())
    .filter((l) => l && !/^[-=_*]{3,}$/.test(l)).map((l) => ({ line: l, ...quickAdd(l) })).filter((q) => q.title);
}
export function openImport(draft = null) {
  const x = draft || { text: '', due: '', category: '' };
  const items = parseTaskLines(x.text);
  openModal(`
    <h2>⤓ ${esc(t('importTasks'))}</h2>
    ${hint('importHint')}
    <label><textarea name="text" rows="7" placeholder="${esc(t('importPh'))}" aria-label="${esc(t('importTasks'))}">${esc(x.text)}</textarea></label>
    <label>${esc(t('due'))}${dateBox(`<input type="date" name="due" value="${esc(x.due || '')}">`, x.due || '')}</label>
    <div class="field-label">${esc(t('category'))}</div>${catChips(x.category)}
    ${items.length ? `<div class="field-label">${esc(t('importPreview', items.length))}</div>
    <ul class="list import-list">${items.map((q, i) => `<li><label class="check"><input type="checkbox" name="pick" value="${i}" ${/:$/.test(q.title) ? '' : 'checked'}><span>${impBadge(q) ? `${impBadge(q)} ` : ''}${esc(q.title)}<small>${esc([q.minutes ? fmtDur(q.minutes) : '', q.category ? `#${q.category}` : ''].filter(Boolean).join(' · '))}</small></span></label></li>`).join('')}</ul>` : ''}
    <div class="button-row">
      <button class="btn primary" value="ok" ${items.length ? '' : 'disabled'}>${esc(t('importN', items.length))}</button>
      <button class="btn" value="preview" formnovalidate>${esc(t('importCheck'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form, action, e) => {
    x.text = form.text.value; x.due = form.due.value; x.category = form.category.value;
    if (action === 'preview') { e.preventDefault(); openImport(x); return; }
    const picked = new Set([...form.querySelectorAll('input[name=pick]:checked')].map((el) => Number(el.value)));
    const list = parseTaskLines(x.text).filter((_, i) => picked.has(i));
    let n = 0;
    for (const q of list) {
      upsert('tasks', {
        id: uid(), createdAt: Date.now() + n, kind: 'todo', title: q.title, minutes: q.minutes || 30, lenSet: Boolean(q.minutes), priority: q.priority, importance: q.importance || 3,
        category: findCategory(q.category) || x.category || null, due: x.due || null, repeat: null, notes: '', done: false,
      }, { silent: true });
      n++;
    }
    toast(t('imported', n));
    changed();
  });
  // The preview follows what you paste or type (after a short pause).
  let tmr = null;
  modal.querySelector('textarea[name=text]').addEventListener('input', (ev) => {
    clearTimeout(tmr);
    // (the dialog is drawn again: the cursor goes back where it was, not to the end of the text)
    tmr = setTimeout(() => {
      const old = ev.target; if (!old.isConnected || !modal.open || document.activeElement !== old) return;
      const f = old.form; const { selectionStart: a, selectionEnd: b, scrollTop } = old;
      openImport({ text: f.text.value, due: f.due.value, category: f.category.value });
      const ta = modal.querySelector('textarea[name=text]'); ta.focus(); ta.setSelectionRange(a, b); ta.scrollTop = scrollTop;
    }, 600);
  });
}

// A searchable list of tasks to pick from: to-dos by when they're due, then saved tasks and small steps.
export function taskPickList(selected = null) {
  const td = today();
  const done = new Set(alreadyPlanned().map((x) => x.id));
  const g = groupTasks(openTasks().filter((x) => !done.has(x.id)), td);
  const item = (x) => `<button type="button" class="tp-item${x.id === selected ? ' on' : ''}" data-tp="${esc(x.id)}" data-q="${esc(fold(x.title))}" ${done.has(x.id) ? `data-planned="${esc(plannedWhen(x))}"` : ''} style="--c:${esc(catColor(x.category) || 'var(--accent)')}">
      <span class="tp-dot"></span><span class="tp-text"><span>${impBadge(x) ? `${impBadge(x)} ` : ''}${esc(x.title)}</span><small>${esc([fmtDur(x.minutes || 30), x.due ? (x.due < td ? t('late') : relDay(x.due)) : '', isStep(x) ? t('stepLabel') : '', isSaved(x) ? t('savedLabel') : '', done.has(x.id) ? `📅 ${plannedWhen(x)}` : ''].filter(Boolean).join(' · '))}</small></span></button>`;
  const groups = [
    ...['overdue', 'today', 'upcoming', 'anytime'].map((k) => [t(`grp_${k}`), sortTasks(g[k], td)]),
    [t('savedTasks'), savedTasks().filter((x) => !isMealType(x))],
    [t('preparations'), live('tasks').filter((x) => isStep(x) && !x.check)],
    [t('grp_planned'), sortTasks(alreadyPlanned(), td), true],
  ].filter(([, l]) => l.length);
  return `${searchBox({ cls: 'tp-q' })}
    <div class="tp-list">${groups.map(([label, l, planned]) => `<div class="tp-grp${planned ? ' planned' : ''}"><div class="tp-h">${esc(label)} <small>${l.length}</small></div>${planned ? `<p class="hint tp-note">${esc(t('plannedNote'))}</p>` : ''}${l.map(item).join('')}</div>`).join('')}</div>`;
}
export function wirePicker(root, onPick) {
  const q = root.querySelector('.tp-q');
  q?.addEventListener('input', () => {
    const v = fold(q.value.trim());
    for (const el of root.querySelectorAll('.tp-item')) el.hidden = Boolean(v) && !el.dataset.q.includes(v);
    for (const gEl of root.querySelectorAll('.tp-grp')) gEl.hidden = ![...gEl.querySelectorAll('.tp-item')].some((el) => !el.hidden);
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tp]');
    if (!b) return;
    ev.preventDefault();
    // Already on the plan: only on purpose.
    if (b.dataset.planned && !confirm(t('planAgain', b.dataset.planned))) return;
    onPick(b.dataset.tp);
  });
}
// "+ Add → Task": an existing task (or a new one) on this day, at a time you confirm.
export function openTaskAdd(date) {
  openModal(`
    <h2>✓ ${esc(t('addTaskTitle', relDay(date)))}</h2>
    <div class="row tight"><input name="newTask" placeholder="${esc(t('addTaskNewPh'))}" autocomplete="off"><button class="btn primary" value="new">+</button></div>
    <div class="field-label">${esc(t('orPickTask'))}</div>
    <div class="task-pick open">${taskPickList()}</div>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (action !== 'new') return;
    e.preventDefault();
    const q = quickAdd(form.newTask.value);
    if (!q.title) return;
    const x = applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...quickFields(q), due: q.due || null }, { silent: true }));
    openPlanSaved(x, date);
  });
  wirePicker(modal, (id) => openPlanSaved(get('tasks', id), date));
}

// The + sheet: one field (the quick-add shortcuts), what it understood as chips, and three endings.
// Enter adds it and keeps the sheet open for the next one.
// (v52) What the + adds on each tab: a task on Today and To do, a saved task on Saved, an item on
// Shopping, an event on Events. The chips on top switch it (Meal opens the meal editor).
export function plusKind() {
  const r = route(); const sub = ui.tasksTab || state.settings.tasksTab || 'todo';
  if (r.name === 'events') return 'event';
  if (!classic() && r.name === 'tasks') return curView().shop ? 'shop' : (curView().f?.type || []).join() === 'repeat' ? 'saved' : 'todo';
  if (r.name === 'shop' || (r.name === 'tasks' && sub === 'shop')) return 'shop';
  if (r.name === 'tasks' && sub === 'saved') return 'saved';
  return 'todo';
}
// (v55) On To do, the + adds to the view you're on: its group and "when" are typed in for you (you can
// delete them), and it warns when what you typed wouldn't show there.
const inViews = () => !classic() && ['tasks', 'shop'].includes(route().name);
export function openQuickTask({ saved = false, kind = saved ? 'saved' : 'todo', text = null } = {}) {
  const isTask = kind === 'todo' || kind === 'saved';
  saved = kind === 'saved';
  const vw = inViews() ? curView() : null;
  if (text == null) text = vw && isTask ? viewTokens(vw) : '';
  const chip = (k) => `<button class="kind-chip${k === kind ? ' on' : ''}" value="kind:${k}" formnovalidate aria-pressed="${k === kind}">${esc(t(vw ? `kc_${k}` : `kind_${k}`))}</button>`;
  const app = vw && isTask && vw.app ? `<div class="vw-app">${vw.app === 'palestra'
    ? `<button class="btn" value="app-plan">▶ ${esc(t('appPlanWorkout'))}</button><a class="btn" href="${esc(PALESTRA_APP)}#/routines" target="_blank" rel="noopener">${esc(t('appNewIn', 'Palestra'))} ↗</a>`
    : `<button class="btn" value="app-plan">▶ ${esc(t('appPlanMeal'))}</button><a class="btn" href="${esc(RICETTE_APP)}" target="_blank" rel="noopener">${esc(t('appNewIn', 'Ricette'))} ↗</a>`}</div>
    <p class="hint">${esc(t('appStaysHint'))}</p>` : '';
  const ph = kind === 'shop' ? t('shopAddPh') : kind === 'event' ? t('addEventPh') : t('addTaskPh');
  const go = kind === 'shop' ? `<button class="btn primary big" value="shop-add"><b>+ ${esc(t('addToList'))}</b><small id="quick-slot">${esc(t('enterKeepsOpen'))}</small></button>`
    : kind === 'event' ? `<button class="btn primary big" value="event-add"><b>${esc(t('addEventBtn'))}</b><small id="quick-slot"></small></button>
      <button class="linkish" value="more">${esc(t('moreDetails'))}</button>`
    : saved ? `<button class="btn primary big" value="add"><b>${esc(t('addSavedBtn'))}</b><small id="quick-slot">${esc(t('addSavedSub'))}</small></button>
      <button class="linkish" value="more">${esc(t('moreDetails'))}</button>`
    : !classic() ? `<button class="btn primary big" value="add"><b>${esc(t('addBtnTask'))}</b><small>${esc(t('addBtnTaskSub'))}</small></button>
      <div class="two-btn"><button class="btn two-line" value="when"><b>🕒 ${esc(t('whenChip'))}</b><small>${esc(t('chooseWhenSub'))}</small></button><button class="btn two-line" value="plan"><b>✦ ${esc(t('planBtn'))}</b><small id="quick-slot"></small></button></div>
      <button class="linkish" value="more">${esc(t('moreDetails'))}</button>` // (v66) the week grid, or the app picks
    : `<button class="btn primary big" value="add"><b>${esc(t('addBtnTask'))}</b><small>${esc(t('addBtnTaskSub'))}</small></button>
      <div class="two-btn"><button class="btn two-line" value="plan"><b>${esc(t('addAndPlan'))}</b><small id="quick-slot"></small></button><button class="btn two-line" value="when"><b>${esc(t('chooseWhen'))}</b><small>${esc(t('chooseWhenSub'))}</small></button></div>
      <button class="linkish" value="more">${esc(t('moreDetails'))}</button>`; // (v63) Add first; planning is a choice
  openModal(`
    ${vw ? `<h2 class="quick-where">${esc(t('addToView', viewName(vw)))}</h2>` : ''}
    <div class="kind-chips" role="group" aria-label="${esc(t('addMenuFab'))}">${(vw ? ['todo', 'saved', 'shop'] : ['todo', 'event', 'saved', 'meal', 'shop']).map(chip).join('')}</div>
    ${app}
    <input id="quick-q" class="quick-q" name="q" autocomplete="off" enterkeyhint="done" placeholder="${esc(ph)}" aria-label="${esc(t(`kind_${kind}`))}" value="${esc(text)}">
    <div class="quick-chips" id="quick-chips"></div>
    ${isTask && !classic() ? `<div class="quick-pick"><button type="button" class="mchip" data-qp="cat">● ${esc(t('mGroup'))}</button><button type="button" class="mchip" data-qp="len">⏱ ${esc(t('mLen'))}</button></div><div class="quick-pop" id="quick-pop" hidden></div>` : ''}
    <p class="hint" id="quick-hint">${esc(kind === 'shop' ? t('shopQuickHint') : kind === 'event' ? t('eventQuickHint') : t('quickHint'))}</p>
    <p class="quick-done" id="quick-done" aria-live="polite"></p>
    <div class="quick-go">${go}</div>
    <div class="button-row"><button class="btn ghost" value="cancel" formnovalidate>${esc(t('close'))}</button></div>`, (form, action, e) => {
    if (action === 'app-plan') {
      if (vw.app === 'ricette') { setTimeout(() => { ui.mealDate = today(); openMeal(null); }, 0); return; }
      e.preventDefault(); openWorkoutPicker(); return;
    }
    if (action.startsWith('kind:')) {
      e.preventDefault();
      const k = action.slice(5); const txt = form.q.value;
      if (k === 'meal') { setTimeout(() => { ui.mealDate = today(); openMeal(null); }, 0); return; }
      openQuickTask({ kind: k, text: txt }); return;
    }
    if (kind === 'shop') { e.preventDefault(); addShopLine(); return; }
    if (kind === 'event') {
      if (action === 'more') { const d = eventDraft(form.q.value); setTimeout(() => openTask(null, null, { event: true, draft: d }), 0); return; }
      if (!addEvent(form.q.value)) { e.preventDefault(); form.q.focus(); }
      return;
    }
    if (action === 'more') { const q0 = quickAdd(form.q.value); setTimeout(() => openTask(null, { ...quickFields(q0), ...(saved ? { kind: 'saved' } : {}) }), 0); return; }
    const r = makeQuick(form.q.value, saved);
    if (!r) { e.preventDefault(); form.q.focus(); return; }
    const { x, q } = r;
    const timed = q.due && q.time != null && !q.repeat;
    if (action === 'when' && !classic()) {
      // (v66) the week grid; back takes the new task away again and the text comes back
      const txt = form.q.value;
      setTimeout(() => openWeekGrid(x, { onClose: (how, k) => {
        if (how === 'back') { remove('tasks', x.id); changed(); openQuickTask({ kind, text: txt }); return; }
        if (how === 'quick') setWhen(get('tasks', x.id), k);
        (ui.justAdded ||= new Set()).add(x.id); changed();
        if (how === 'more') { openTask(get('tasks', x.id)); return; }
        openQuickTask({ kind, text: vw && isTask ? viewTokens(vw) : '' });
        modal.querySelector('#quick-done').textContent = `✓ ${t('addedName', x.title)}`;
      } }), 0);
      return;
    }
    if (action === 'when') { (ui.justAdded ||= new Set()).add(x.id); setTimeout(() => openPlanSaved(x, x.due || today(), { stay: true }), 0); return; }
    const block = timed ? planTask(x, q.due, Math.max(0, q.time - anchorOffset(null, x))) : action === 'plan' ? planSoon(x) : null;
    afterAdd(x, block, { tried: action === 'plan' });
  }, { cls: 'sheet quick' });
  const input = modal.querySelector('#quick-q');
  const done = [];
  const showDone = (name) => { done.push(name); modal.querySelector('#quick-done').textContent = `✓ ${t('addedList', done.slice(-4).join(', '))}`; };
  const addShopLine = () => { const v = input.value.trim(); if (!v) return; shopAdd(v); showDone(v); input.value = ''; update(); changed(); input.focus(); };
  const update = () => {
    const q = quickAdd(input.value);
    const chips = [];
    if (isTask || kind === 'event') {
      if (q.minutes) chips.push(fmtDur(q.minutes));
      for (const c of [q.category, ...(q.moreCats || [])].map(findCategory).filter(Boolean)) chips.push(`<i style="--c:${esc(catColor(c))}"></i>${esc(catName(get('categories', c)))}`);
      if (q.due) chips.push(esc(q.time != null ? `${relDay(q.due)} ${fmtTime(q.time)}` : kind === 'event' ? relDay(q.due) : t('dueChip', relDay(q.due))));
      if (q.importance && isTask) chips.push(esc(t(`imp_${q.importance}`)));
      if (q.place) chips.push(`📍 ${esc(q.place)}`);
      if (q.repeat) chips.push('↻');
    }
    if (vw && isTask && q.title && !wouldShow(vw, quickFields(q))) chips.push(`<b class="qc-warn">${esc(t('notInView', viewName(vw)))}</b>`);
    modal.querySelector('#quick-chips').innerHTML = q.title ? chips.map((c) => (c.startsWith('<b') ? c : `<span class="qc">${c}</span>`)).join('') : '';
    modal.querySelector('#quick-hint').hidden = Boolean(input.value.trim());
    const slotEl = modal.querySelector('#quick-slot');
    if (kind === 'event') slotEl.textContent = q.title ? (q.due ? (q.time != null ? t('atTime', relDay(q.due), fmtTime(q.time)) : t('allDayOn', relDay(q.due))) : t('eventNoDate')) : '';
    if (kind !== 'todo') return;
    let slot = '';
    if (q.due && q.time != null && !q.repeat) slot = t('atTime', relDay(q.due), fmtTime(q.time));
    else if (q.title) { const s = suggestSlot({ title: q.title, minutes: q.minutes, due: q.due, importance: q.importance, priority: q.priority }); slot = s ? t('firstFree', relDay(s.date), fmtTime(s.start)) : t('noFreeWeek'); }
    slotEl.textContent = slot;
  };
  input.addEventListener('input', update);
  // (v66) Category and length as taps: they write the same shortcuts you could type (#casa, 45m).
  const pop = modal.querySelector('#quick-pop');
  const words = () => input.value.trim().split(/\s+/).filter(Boolean);
  const isLen = (w) => /^\d/.test(w) && /[hm]|min/i.test(w) && parseDuration(w) != null;
  const drawPop = (k) => {
    const q = quickAdd(input.value);
    const on = [q.category, ...(q.moreCats || [])].map(findCategory).filter(Boolean);
    pop.innerHTML = k === 'cat' ? categories().map((c) => `<button type="button" class="mchip${on.includes(c.id) ? ' set' : ''}" data-qc="${esc(c.id)}"><i class="cat-dot" style="--c:${esc(c.color || 'var(--line)')}"></i>${esc(catName(c))}</button>`).join('')
      : [15, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="mchip${q.minutes === m ? ' set' : ''}" data-ql="${m}">${esc(fmtDur(m))}</button>`).join('');
    pop.dataset.k = k; pop.hidden = false;
  };
  modal.querySelector('.quick-pick')?.addEventListener('click', (ev) => { const b = ev.target.closest('[data-qp]'); if (!b) return; if (!pop.hidden && pop.dataset.k === b.dataset.qp) { pop.hidden = true; return; } drawPop(b.dataset.qp); });
  pop?.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-qc]'); const l = ev.target.closest('[data-ql]');
    if (c) {
      const id = c.dataset.qc; const ws = words();
      const has = ws.filter((w) => w.startsWith('#') && findCategory(w.slice(1)) === id);
      input.value = has.length ? ws.filter((w) => !has.includes(w)).join(' ') : `${ws.join(' ')} #${catName(get('categories', id)).toLowerCase().replace(/\s+/g, '')}`.trim();
    }
    if (l) { const m = Number(l.dataset.ql); const ws = words().filter((w) => !isLen(w)); input.value = `${ws.join(' ')} ${m}m`.trim(); }
    update(); drawPop(pop.dataset.k); input.focus();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    if (kind === 'shop') { addShopLine(); return; }
    if (kind === 'event') { const v = input.value; if (addEvent(v, { keepOpen: true })) { showDone(quickAdd(v).title); input.value = ''; update(); } return; }
    const r = makeQuick(input.value, saved);
    if (!r) return;
    const { x, q } = r;
    if (q.due && q.time != null && !q.repeat) planTask(x, q.due, Math.max(0, q.time - anchorOffset(null, x)));
    (ui.justAdded ||= new Set()).add(x.id);
    input.value = ''; update();
    modal.querySelector('#quick-done').textContent = `✓ ${t('addedName', x.title)}`;
    changed();
  });
  update();
  input.focus();
  if (text) input.setSelectionRange(text.length, text.length);
}
// (v55) "Plan a workout" from the Workouts view: one of Palestra's workouts, then the day and a free slot.
function openWorkoutPicker() {
  const list = routines().filter(isPalestra);
  openModal(`<h2>▶ ${esc(t('appPlanWorkout'))}</h2>
    ${list.length ? `<div class="add-opts">${list.map((x) => `<button class="add-opt" value="${esc(x.id)}"><span class="item-text">${esc(x.title)}<small>${esc(fmtDur(x.minutes || 45))}</small></span></button>`).join('')}</div>` : `<p class="hint">${esc(t('noPalWorkouts'))}</p>`}
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('close'))}</button></div>`, (form, action) => {
    const x = get('tasks', action); if (x) setTimeout(() => openPlanSaved(x, today(), { stay: true }), 0);
  }, { cls: 'sheet' });
}
// An event from one line ("Concert 20 May 21:00 @Arena"); without a date the editor asks for it.
function eventDraft(text) {
  const q = quickAdd(text || '');
  return { kind: 'event', title: q.title, minutes: q.minutes || 120, category: findCategory(q.category), place: q.place || '', notes: '', done: false, planDate: q.due || '', planTime: q.time, allDay: q.time == null };
}
function addEvent(text, { keepOpen = false } = {}) {
  const d = eventDraft(text);
  if (!d.title) return false;
  if (!d.planDate) { setTimeout(() => openTask(null, null, { event: true, draft: d }), 0); if (keepOpen) modal.close(); return false; }
  saveEvent(d);
  toast(t('eventAdded', relDay(d.planDate)));
  changed();
  return true;
}
function makeQuick(text, saved = false) {
  const q = quickAdd(text || '');
  if (!q.title) return null;
  // a saved task keeps no due date (it's reused); a date and time typed in plan this one use
  const f = saved ? { ...quickFields(q), kind: 'saved', due: null, repeat: null } : quickFields(q);
  return { q, x: applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...f }, { silent: true })) };
}
// After adding from the sheet: it shows on top of Da fare, and a bar says where it went (Change, Undo).
export function afterAdd(x, block, { tried = false } = {}) {
  (ui.justAdded ||= new Set()).add(x.id);
  changed();
  const undo = { label: t('undo'), run: () => { for (const b of live('blocks').filter((y) => y.taskId === x.id)) remove('blocks', b.id); remove('tasks', x.id); ui.justAdded.delete(x.id); changed(); toast(t('undone')); } };
  const sv = x.kind === 'saved';
  const here = route().name === 'tasks' && (!classic() || (ui.tasksTab || state.settings.tasksTab) === (sv ? 'saved' : 'todo'));
  const show = here ? [] : [{ label: t('show'), run: () => { ui.tasksTab = sv ? 'saved' : 'todo'; if (!classic()) setView('overview'); location.hash = '#/tasks'; render(); } }];
  if (block) toast(t('addedPlanned', relDay(block.date), fmtTime(block.start)), 5000, [{ label: t('change'), run: () => openBlock(get('blocks', block.id)) }, undo]);
  else toast(sv ? t('addedSaved') : tried ? t('addedNoSlot') : t('addedToList'), 5000, [...show, undo]);
}

// "+ Add": things you put on the plan by hand.
// From the + button (any tab): the same menu, about today; "Task" opens the quick sheet.
export function openAddMenu({ fab = false } = {}) {
  const date = fab ? today() : currentDate();
  const savedTab = fab && route().name === 'tasks' && (ui.tasksTab || state.settings.tasksTab) === 'saved'; // + on Saved: a saved task first
  const opt = (v, icon, label, hint) => `<button class="add-opt" value="${v}" formnovalidate><span class="add-ico">${icon}</span><span class="item-text">${esc(label)}<small>${esc(hint)}</small></span></button>`;
  openModal(`
    <h2>${esc(fab ? t('addMenuFab') : t('addMenuTitle', relDay(date)))}</h2>
    <div class="add-opts">
      ${savedTab ? opt('saved-quick', '★', t('newSaved'), t('newSavedHint')) : ''}
      ${opt('task', '✓', t('addTaskOpt'), fab ? t('addTaskHintFab') : t('addTaskHint'))}
      ${opt('event', '📅', t('eventOpt'), t('addEventHint'))}
      ${opt('saved', '★', t('fromSaved'), t('addSavedHint'))}
      ${opt('meal', '🍽', t('meal'), t('addMealHint'))}
      ${advancedOn() ? opt('templates', '▦', t('templates'), t('addTplHint')) : ''}
      ${fab ? opt('import', '⤓', t('importOpt'), t('importOptHint')) : ''}
    </div>
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action) => {
    setTimeout(() => {
      if (action === 'saved') openSavedPicker(date);
      if (action === 'task') { if (fab) openQuickTask(); else openTaskAdd(date); }
      if (action === 'import') openImport();
      if (action === 'saved-quick') openQuickTask({ saved: true });
      if (action === 'meal') { ui.mealDate = date; openMeal(null); }
      if (action === 'templates') openTemplatesMenu();
      if (action === 'event') {
        const s = planSettings();
        const from = date === today() ? nowMinutes() : 9 * 60;
        openTask(null, null, { event: true, date, start: freeSlot(busyOn(date), 60, { from, dayStart: s.dayStart, dayEnd: s.dayEnd, snap: s.snap }) ?? from });
      }
    }, 0);
  });
}

export function openSavedPicker(date) {
  const groups = savedGroups();
  openModal(`
    <h2>${esc(t('pickSaved'))}</h2>
    <p class="hint">${esc(fmtDay(date))}</p>
    ${groups.length ? groups.map(([cat, list]) => `<div class="sub">${esc(cat ? catName(cat) : t('noCategory'))}</div>
      <ul class="list saved-pick">${list.map((x) => `<li><button class="task-main" value="pick:${esc(x.id)}" formnovalidate><span class="item-text">${isMealType(x) ? '🍽 ' : ''}${esc(x.title)}<small>${esc(savedInfo(x))}</small></span></button></li>`).join('')}</ul>`).join('')
    : `${hint('noSaved')}`}
    <div class="button-row"><button class="btn ghost" value="cancel">${esc(t('cancel'))}</button></div>`, (form, action, e) => {
    if (!action.startsWith('pick:')) return;
    e.preventDefault();
    const x = get('tasks', action.slice(5));
    if (isMealType(x)) { ui.mealDate = date; openMeal(null, { kind: 'meal', date, typeId: x.id, start: savedStart(x, date), minutes: x.minutes || 45, recipes: [], people: 2, notes: '' }); return; }
    openPlanSaved(x, date);
  });
}
export function openPlanSaved(x, date, { stay = false } = {}) {
  openModal(`
    <h2>${esc(t('planSaved', x.title))}</h2>
    ${(x.steps || []).length ? `<p class="hint">▤ ${esc(x.steps.map((y) => `${y.title} ${fmtDur(y.minutes)}`).join(' → '))}</p>` : ''}
    <div class="three">
      <label>${esc(t('date'))}${dateBox(`<input name="date" type="date" required value="${esc(date)}">`, date)}</label>
      <label>${esc(anchorTitle(x) ? t('anchorAt', anchorTitle(x)) : t('start'))}<input name="start" ${TIME24} required value="${fmtTime(savedStart(x, date) + anchorOffset(null, x))}"></label>
      <label>${esc(t('duration'))}${durField('minutes', x.minutes || 30)}</label>
    </div>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('planIt'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form) => {
    const d = form.date.value || date;
    const shown = parseTime(form.start.value);
    const b = planTask(x, d, shown != null ? Math.max(0, shown - anchorOffset(null, x)) : null, { minutes: readDur(form, 'minutes', x.minutes || 30) });
    toast(t('plannedToast', relDay(d), fmtTime(b.start)));
    if (d !== currentDate() && !stay) location.hash = `#/plan/${d}`;
    changed();
    warnConflicts(get('blocks', b.id));
  });
  // A different day can mean a different free slot.
  modal.querySelector('input[name=date]').addEventListener('change', (ev) => {
    if (isDate(ev.target.value)) ev.target.form.start.value = fmtTime(savedStart(x, ev.target.value) + anchorOffset(null, x));
  });
}

// (v71) An invitation: who from, your answer, and "Non ci vado" (or, once skipped, "Ci vado di nuovo").
function inviteBox(e) {
  const sk = evSkipOf(e.id);
  if (sk) {
    const took = sk.took && get('blocks', sk.took);
    return `<div class="inv-box skipped"><p><span class="inv-tag no">${esc(t('invNotGoing'))}</span>${took ? ` <small>${esc(t('invTookBy', took.title))}</small>` : ''}${sk.google ? ` <small>· ${esc(t('invGoogleNo'))}</small>` : ''}</p>
      <div class="button-row left"><button class="btn small primary" value="ev-rejoin" formnovalidate>${esc(t('invRejoin'))}</button><button class="btn small" value="ev-hide" formnovalidate>${esc(t('invHide'))}</button></div>
      <small class="hint">${esc(took ? t('invRejoinSub', took.title) : t('invHideSub'))}</small></div>`;
  }
  if (!isInvite(e)) return '';
  return `<div class="inv-box"><p>${e.from ? `${esc(t('invFrom', e.from))} · ` : ''}${esc(t('invYourAnswer'))} ${invTag(e)}</p>
    ${e.rsvp === 'accepted' ? `<p class="notice warn-amber">${esc(t('invSaidYes'))}</p>` : ''}
    ${e.gcal ? `<label class="check inv-google"><input type="checkbox" name="google"> <span>${esc(t('invAlsoGoogle'))}<small>${esc(t('invAlsoGoogleSub', e.from || '…'))}</small></span></label>` : ''}
    <div class="button-row left"><button class="btn small" value="ev-skip" formnovalidate>${esc(t('invSkip'))}</button></div></div>`;
}
// An imported (Google Calendar) event: read-only, but tasks can be attached to it like to your own.
export function openEvent(e) {
  const list = eventTasksOf(e.id);
  openModal(`
    <h2>${esc(e.title)}</h2>
    <p class="hint"><span class="cat" style="--c:${esc(e.color)}">${esc(e.calendar)}</span> · ${esc(fmtDay(e.date))}${e.allDay ? '' : ` · ${range(e.start, e.minutes)}`}</p>
    ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ''}
    ${inviteBox(e)}
    ${hint('eventReadOnly')}
    <div class="field-label">✓ ${esc(t('secEventTasks'))}${list.length ? ` <small>${esc(readinessText(e.id))}</small>` : ''}</div>
    ${list.length ? `<ul class="list ev-tasks">${list.map((y) => { const nb = nextPlanned(y.id); return `<li class="${y.done ? 'done' : ''}"><button class="task-main" value="ev-task:${esc(y.id)}" formnovalidate><span class="item-text">${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc([offsetText(y.eventOffset), y.due ? relDay(y.due) : ''].filter(Boolean).join(' · '))}</small><small class="${y.done ? '' : nb ? 'ok' : 'warn'}">${esc(y.done ? t('doneLabel') : nb ? t('plannedAt', relDay(nb.date), fmtTime(nb.start)) : t('toPlanLabel'))}</small></span></button></li>`; }).join('')}</ul>` : ''}
    <div class="button-row left">
      <button class="btn small" value="add-task" formnovalidate>+ ${esc(t('addEventTask'))}</button>
      ${list.some((y) => !y.done && !nextPlanned(y.id)) ? `<button class="btn small primary-ghost" value="plan-tasks" formnovalidate>✦ ${esc(t('planThese'))}</button>` : ''}
    </div>
    <div class="button-row">
      ${e.link ? `<a class="btn" href="${esc(e.link)}" target="_blank" rel="noopener">${esc(t('openInGoogle'))}</a>` : ''}
      <button class="btn" value="cancel">${esc(t('close'))}</button>
    </div>`, (form, action) => {
    if (action === 'ev-skip') { // (v71) not going, nothing in its place
      skipEvent(e, { google: Boolean(form.google?.checked) }); changed();
      toast(t('invSkipped'), 5000, [{ label: t('undo'), run: () => { unskipEvent(e.id); changed(); toast(t('undone')); } }]);
    }
    if (action === 'ev-rejoin') rejoinEvent(e.id);
    if (action === 'ev-hide') { const sk = evSkipOf(e.id); setEvSkip(e.id, { ...sk, hidden: true }); changed(); toast(t('invHidden'), 5000, [{ label: t('undo'), run: () => { setEvSkip(e.id, sk); changed(); } }]); }
    if (action === 'add-task') setTimeout(() => openEventTaskAdd(e, { back: true }), 0);
    if (action === 'plan-tasks') { planEventTasks(e); setTimeout(() => openEvent(get('events', e.id)), 0); }
    if (action.startsWith('ev-task:')) setTimeout(() => openTask(get('tasks', action.slice(8))), 0);
  });
}


// ---------- meals: the meal dialog and the recipe picker ----------

// "Can I cook it?" exactly as Ricette answers it (salt, pepper, oil and water count as always there).
export const coverage = (r, people) => pantryCoverage(r, live('r_pantry'), { servings: people || r.servings || 2 });
export const tagDefs = () => live('r_tagdefs');
export const pinnedTags = () => { const v = get('r_prefs', 'pinnedTags')?.value; return Array.isArray(v) ? v : []; };
export const tagName = (tg) => tagLabel(tg, tagDefs(), (id) => originLabel(id, getLang(), (c) => t(`cont_${c}`)) ?? t(`tag_${id}`));
export const coverOf = (r) => (r?.photos && r.photos[0]) || r?.image || '';

// Photos: from Ricette's repo (images/...) via GitHub, cached on the device; web images directly.
export const photoUrls = new Map();
export const photoReady = new Map();
export function photoTag(src, cls = '') {
  if (String(src).startsWith('images/')) return `<img class="${cls}" data-photo="${esc(src)}" alt="">`;
  return `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
export async function photoUrl(path) {
  if (photoUrls.has(path)) return photoUrls.get(path);
  const p = (async () => {
    let blob = await kvGet(`rimg:${path}`);
    if (!blob) { blob = await fetchRicettePhoto(path); if (blob) await kvSet(`rimg:${path}`, blob); }
    return blob ? URL.createObjectURL(blob) : null;
  })();
  photoUrls.set(path, p);
  return p;
}
export function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const path = img.dataset.photo;
    if (photoReady.has(path)) { img.src = photoReady.get(path); continue; }
    photoUrl(path).then((url) => { if (url) { photoReady.set(path, url); img.src = url; } else img.remove(); });
  }
}

// A meal: its type (Breakfast, Lunch…), when, for how many people, and the recipes in it.
export function openMeal(block, draft = null) {
  const types = mealTypes();
  if (!types.length) { toast(t('noMealTypes')); return; }
  const isNew = !block;
  const x = draft || (block
    ? { ...block, typeId: block.taskId || types.find((tp) => block.title?.startsWith(tp.title))?.id || types[0].id, recipes: mealRecipes(block).map((r) => ({ ...r })), people: block.servings || mealRecipes(block)[0]?.servings || 2, stepMinutes: { ...(block.stepMinutes || {}) } }
    : (() => {
      const now = nowMinutes(); const date = ui.mealDate || currentDate();
      // The next meal of the day by default.
      const tp = (date === today() && types.find((y) => (y.defaultStart ?? 0) > now)) || types.find((y) => y.id === 'meal_dinner') || types[0];
      return { kind: 'meal', date, typeId: tp.id, start: tp.defaultStart ?? 1170, minutes: tp.minutes || 45, recipes: [], people: 2, notes: '' };
    })());
  const type = get('tasks', x.typeId) || types[0];
  // A meal type split into steps: you set when you eat (or whichever step its usual time refers
  // to); the steps before it, prep from the recipes among them, are laid out backwards from there.
  const steps = (type.steps || []).filter((y) => y.title);
  x.stepMinutes = x.stepMinutes || {};
  if (steps.length && x.anchorAt == null) {
    const ai = anchorIndex(steps, type.anchorStepId);
    if (block && block.taskId === type.id) {
      const st = stepTimes(block);
      x.anchorAt = ai < st.length ? st[ai].start : block.start + block.minutes;
    } else x.anchorAt = type.defaultStart ?? x.start ?? 1170;
  }
  const plan = steps.length ? mealPlan(x, type) : null;
  // A step's own length for this meal: empty means automatic (from the recipes, or its usual length).
  const readStepOwn = (f) => {
    for (const el of f.querySelectorAll('[data-sm]')) {
      const m = readDur(f, `sm_${el.dataset.sm}`, null);
      if (m) x.stepMinutes[el.dataset.sm] = m; else delete x.stepMinutes[el.dataset.sm];
    }
  };
  const rows = x.recipes.map((r, i) => {
    const rec = recipeOf(r.recipeId);
    const m = rec && minutesOf(rec);
    return `<li>${rec && coverOf(rec) ? photoTag(coverOf(rec), 'mr-photo') : `<span class="mr-photo ph">${esc((rec?.title || '?').charAt(0))}</span>`}
      <span class="mr-text">${esc(rec?.title || t('unknownRecipe'))}<small>${[m ? fmtDur(m) : '', t('nPeople', x.people)].filter(Boolean).map(esc).join(' · ')}</small></span>
      <button class="icon" value="rm-rec:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></li>`;
  }).join('');
  openModal(`
    <h2>🍽 ${esc(isNew ? t('newMeal') : t('meal'))}</h2>
    <div class="days meal-types">${types.map((tp) => `<label class="day-pill"><input type="radio" name="type" value="${esc(tp.id)}" ${tp.id === type.id ? 'checked' : ''}><span>${esc(tp.title)}</span></label>`).join('')}</div>
    ${plan ? `
    <div class="two">
      <label>${esc(t('date'))}${dateBox(`<input name="date" type="date" required value="${esc(x.date)}">`, x.date)}</label>
      <label>${esc(plan.anchorTitle ? t('anchorAt', plan.anchorTitle) : t('endsAt'))}<input name="start" ${TIME24} required value="${fmtTime(x.anchorAt)}"></label>
    </div>` : `
    <div class="three">
      <label>${esc(t('date'))}${dateBox(`<input name="date" type="date" required value="${esc(x.date)}">`, x.date)}</label>
      <label>${esc(t('start'))}<input name="start" ${TIME24} required value="${fmtTime(x.start)}"></label>
      <label>${esc(t('duration'))}${durField('minutes', x.minutes)}</label>
    </div>`}
    <label>${esc(t('servings'))}<input name="people" type="number" min="1" max="30" step="1" value="${esc(x.people)}"></label>
    <div class="field-label">${esc(t('recipesInMeal'))}</div>
    ${rows ? `<ul class="meal-recipes">${rows}</ul>` : `<p class="hint">${esc(ricetteConfigured() ? t('noRecipeYet') : t('ricetteNeeded'))}</p>`}
    ${ricetteConfigured() ? `<button class="btn add-recipe" value="pick" formnovalidate>＋ ${esc(t('addRecipe'))}</button>` : ''}
    ${plan ? mealStepsHtml(plan, block) : stepsSection(block)}
    <button class="btn small edit-task" value="edit-type" formnovalidate>▤ ${esc(t('editTaskSteps', type.title))}</button>
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${!isNew && x.recipes.length && ricetteConfigured() ? `<button class="btn" value="check">🛒 ${esc(t('checkIngredients'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    const collect = () => {
      x.typeId = form.querySelector('input[name=type]:checked')?.value || x.typeId;
      x.date = form.date.value || x.date;
      if (plan) {
        x.anchorAt = parseTime(form.start.value) ?? x.anchorAt;
        readStepOwn(form);
      } else {
        x.start = parseTime(form.start.value) ?? x.start;
        x.minutes = readDur(form, 'minutes', x.minutes);
      }
      x.people = Math.max(1, Number(form.people.value) || 2);
      x.notes = form.notes.value.trim();
      x.recipes = x.recipes.map((r) => ({ ...r, servings: x.people }));
    };
    collect();
    if (block && stepAction(block, action, e, (nb) => openMeal(nb))) return;
    if (action === 'edit-type') { setTimeout(() => openTask(get('tasks', x.typeId)), 0); return; }
    if (action === 'delete') { deleteBlock(block); changed(); return; }
    if (action === 'pick') {
      e.preventDefault();
      openPicker({
        people: x.people, selected: x.recipes.map((r) => r.recipeId),
        onDone: (ids) => {
          x.recipes = ids.map((id) => ({ recipeId: id, servings: x.people }));
          // A meal takes at least as long as its longest recipe (with steps, the prep step follows the recipes).
          const longest = Math.max(0, ...ids.map((id) => minutesOf(recipeOf(id)) || 0));
          if (!plan && longest > x.minutes) x.minutes = Math.ceil(longest / 5) * 5;
          openMeal(block, x);
        },
        onBack: () => openMeal(block, x),
      });
      return;
    }
    if (action.startsWith('rm-rec:')) { e.preventDefault(); x.recipes.splice(Number(action.slice(7)), 1); openMeal(block, x); return; }
    const tp = get('tasks', x.typeId);
    const before = JSON.stringify(mealRecipes(block || {}));
    if ((tp.steps || []).some((y) => y.title)) {
      const p = mealPlan(x, tp);
      x.start = Math.max(0, x.anchorAt - p.before);
      x.minutes = p.total;
    }
    const { typeId, people, anchorAt, ...rest } = x;
    void typeId; void anchorAt;
    const saved = upsert('blocks', {
      ...rest, id: x.id || uid(), kind: 'meal', taskId: tp.id, servings: people, recipes: x.recipes, recipeId: undefined,
      title: mealTitle(tp.title, x.recipes), category: 'meals', auto: block && (block.date !== x.date || block.start !== x.start) ? false : rest.auto,
      done: block?.done || false,
    }, { silent: true });
    // Different recipes: the ingredient check starts over.
    if (block && before !== JSON.stringify(x.recipes)) {
      for (const st of live('blocks').filter((b) => b.parentId === saved.id && isCheckStep(b) && outcomeOf(b))) setOutcome(st, null);
    }
    followParent(saved);
    if (saved.date !== currentDate()) location.hash = `#/plan/${saved.date}`;
    changed();
    warnConflicts(get('blocks', saved.id));
    if (action === 'check') checkMealNow(get('blocks', saved.id));
  });
  hydratePhotos(modal);
  if (block) wireSteps(block, (nb) => openMeal(nb));
  // Picking a type moves a new meal to that type's usual time (and its steps); changing a step's
  // length or the time updates the steps' times.
  modal.querySelector('form').addEventListener('change', (ev) => {
    const f = ev.target.form;
    if (ev.target.name === 'type') {
      x.typeId = ev.target.value;
      const tp = get('tasks', x.typeId);
      x.stepMinutes = {};
      if (isNew) { x.anchorAt = null; x.start = tp?.defaultStart ?? x.start; x.minutes = Math.max(tp?.minutes || 30, ...x.recipes.map((r) => minutesOf(recipeOf(r.recipeId)) || 0)); }
      else if (x.anchorAt == null && f.start) x.anchorAt = parseTime(f.start.value);
      x.date = f.date.value || x.date; x.people = Math.max(1, Number(f.people.value) || 2); x.notes = f.notes.value.trim();
      openMeal(block, x);
      return;
    }
    if (plan && (ev.target.closest('[data-sm]') || ev.target.name === 'start')) {
      x.anchorAt = parseTime(f.start.value) ?? x.anchorAt;
      readStepOwn(f);
      x.date = f.date.value || x.date; x.people = Math.max(1, Number(f.people.value) || 2); x.notes = f.notes.value.trim();
      openMeal(block, x);
    }
  });
}

// A meal's steps laid out around the time its usual time refers to: what each takes and why.
export function mealPlan(x, type) {
  const steps = (type.steps || []).filter((y) => y.title);
  const fake = { kind: 'meal', recipes: x.recipes, stepMinutes: x.stepMinutes || {} };
  const recs = x.recipes.map((r) => recipeOf(r.recipeId)).filter(Boolean);
  const auto = (y) => stepLen({ ...fake, stepMinutes: {} }, y);
  const rows = steps.map((y) => ({ ...y, len: stepLen(fake, y), auto: auto(y), own: Boolean(fake.stepMinutes[y.id]) }));
  const ai = anchorIndex(steps, type.anchorStepId);
  const before = rows.slice(0, ai).reduce((n, y) => n + y.len, 0);
  let at = (x.anchorAt ?? 0) - before;
  for (const y of rows) { y.start = at; at += y.len; }
  const timed = recs.filter((r) => timeParts(r.time)?.active);
  const waiting = recs.reduce((n, r) => n + (timeParts(r.time)?.waiting || 0), 0);
  return {
    steps: rows, before, total: rows.reduce((n, y) => n + y.len, 0), start: (x.anchorAt ?? 0) - before,
    anchorTitle: ai < steps.length ? steps[ai].title : null,
    source: timed.length ? (recs.length > 1 ? t('prepFromMany', timed.map((r) => r.title).join(', ')) : t('prepFrom', timed[0].title)) : recs.length ? t('prepNoTime') : t('prepNoRecipe'),
    waiting,
  };
}
export function mealStepsHtml(plan, block) {
  const st = block ? Object.fromEntries(stepTimes(block).map((y) => [y.id, y.state])) : {};
  const whole = block && outcomeOf(block) === 'done';
  return `<div class="field-label">▤ ${esc(t('steps'))} <small>${esc(range(plan.start, plan.total))}</small></div>
    <ul class="meal-steps">${plan.steps.map((y) => `<li class="${st[y.id] || (whole ? 'done' : '')}">
      ${block ? `<input type="checkbox" data-sstep="${esc(y.id)}" ${st[y.id] === 'done' || whole ? 'checked' : ''} aria-label="${esc(y.title)}">` : ''}
      <span class="ms-time">${fmtTime(y.start)}</span>
      <span class="ms-title">${esc(y.title)}${y.from === 'recipes' ? `<small>${esc(y.own ? t('ownLength') : plan.source)}</small>` : ''}${st[y.id] === 'failed' ? `<small class="late">${esc(t('couldnt'))}</small>` : ''}</span>
      <span data-sm="${esc(y.id)}">${durField(`sm_${y.id}`, y.own ? y.len : 0, { placeholder: `${y.auto}${y.from === 'recipes' ? ' ⟲' : ''}` })}</span>
    </li>`).join('')}</ul>
    ${plan.waiting ? `<p class="hint">⏳ ${esc(t('waitingNotCounted', fmtDur(plan.waiting)))}</p>` : ''}`;
}

// The recipe picker: a full sheet with photos, search, folders, tags and quick filters.
// Tap cards to select one or more recipes; ⓘ shows the recipe with what's in the pantry.
export function openPicker({ people = 2, selected = [], onDone, onBack }) {
  const st = { q: '', folder: '', tags: new Set(), canCook: false, quick: false, sort: 'cooked', sel: [...selected], preview: null };
  const folders = live('r_folders');
  const defs = tagDefs();
  // Archived recipes never come up (unless already chosen for this meal).
  const all = recipes().filter((r) => stageOf(r) !== 'archived' || selected.includes(r.id));
  const tree = folderTree(folders);
  const fname = (id) => tree.find((f) => f.id === id)?.name || '';
  const tags = tagCounts(all, defs, pinnedTags());
  const unfiled = all.some((r) => !folderOfRecipe(r, folders));
  const canCook = (r) => coverage(r, people).missing.length === 0;

  const list = () => filterRecipes(all, { q: st.q, folder: st.folder, tags: st.tags, canCook: st.canCook ? canCook : null, maxMinutes: st.quick ? 30 : null, sort: st.sort },
    { folders, defs, label: tagName });
  const card = (r) => {
    const on = st.sel.includes(r.id);
    const miss = coverage(r, people).missing.length;
    const m = minutesOf(r);
    const folder = fname(folderOfRecipe(r, folders));
    return `<div class="pk-card${on ? ' on' : ''}">
      <button class="pk-pick" value="tog:${esc(r.id)}" formnovalidate aria-pressed="${on}">
        <span class="pk-photo">${coverOf(r) ? photoTag(coverOf(r)) : ''}<span class="pk-letter">${esc((r.title || '?').charAt(0))}</span>
          <span class="stock ${miss ? 'miss' : 'ok'}">${miss ? esc(t('nMissing', miss)) : `✓ ${esc(t('inPantryShort'))}`}</span>
          <span class="pk-tick">${on ? st.sel.indexOf(r.id) + 1 : ''}</span></span>
        <span class="pk-body"><b>${esc(r.title)}</b>
          <small>${[m ? `⏱ ${fmtDur(m)}` : '', folder ? `📁 ${folder}` : ''].filter(Boolean).map(esc).join(' · ')}</small>
          ${tagsOf(r, defs).length ? `<span class="card-tags">${tagsOf(r, defs).slice(0, 3).map((x) => `<span>${esc(tagName(x))}</span>`).join('')}</span>` : ''}</span>
      </button>
      <button class="pk-info" value="info:${esc(r.id)}" formnovalidate aria-label="${esc(t('details'))}">i</button>
    </div>`;
  };
  // Grouped as in Ricette: Preferite, then Provate, then Da provare (a new recipe is a choice, not an accident).
  const STAGE_ICON = { fav: '★', tried: '✓', try: '✦', archived: '🗄' };
  const grid = () => {
    const l = list();
    if (!l.length) return `<p class="empty">${esc(t('noMatches'))}</p>`;
    const groups = STAGES.map((s) => [s, l.filter((r) => stageOf(r) === s)]).filter(([, g]) => g.length);
    if (groups.length < 2) return l.map(card).join('');
    return groups.map(([s, g]) => `<h3 class="pk-group" data-stage="${s}">${STAGE_ICON[s]} ${esc(t(`stage_${s}`))} <small>${g.length}</small></h3>${g.map(card).join('')}`).join('');
  };
  const pill = (value, label, on) => `<button class="pill${on ? ' on' : ''}" value="${esc(value)}" formnovalidate>${esc(label)}</button>`;

  const draw = () => {
    if (st.preview) return drawPreview(recipeOf(st.preview));
    const n = st.sel.length;
    openModal(`
      <div class="pk-head">
        <button class="icon" value="back" formnovalidate aria-label="${esc(t('back'))}">‹</button>
        <h2>${esc(t('chooseRecipes'))}</h2>
        <span class="pk-count">${esc(t('forPeople', people))}</span>
      </div>
      <input type="search" id="pk-q" value="${esc(st.q)}" placeholder="${esc(t('recSearch'))}" autocomplete="off">
      ${tree.length ? `<div class="pills">${pill('folder:', t('allFolders'), !st.folder)}${tree.map((f) => pill(`folder:${f.id}`, `${f.depth ? '· '.repeat(f.depth) : '📁 '}${f.name}`, st.folder === f.id)).join('')}${unfiled ? pill('folder:__none', t('noFolder'), st.folder === '__none') : ''}</div>` : ''}
      <div class="pills">${pill('cook', `✓ ${t('canCookNow')}`, st.canCook)}${pill('quick', `⏱ ${t('underMin', 30)}`, st.quick)}${pill('sort', st.sort === 'cooked' ? `↕ ${t('sortCooked')}` : `↕ ${t('sortAZ')}`, st.sort === 'cooked')}</div>
      ${tags.length ? `<div class="pills">${tags.map((x) => pill(`tag:${x.tag}`, `${x.pinned ? '📌 ' : ''}${tagName(x.tag)}`, st.tags.has(x.tag))).join('')}</div>` : ''}
      <div class="pk-grid" id="pk-grid">${grid()}</div>
      <div class="pk-foot">
        <button class="btn primary" value="done" ${n ? '' : 'disabled'}>${esc(n ? t('addNRecipes', n) : t('pickSome'))}</button>
      </div>`, onSubmit, { cls: 'sheet' });
    hydratePhotos(modal);
    const q = modal.querySelector('#pk-q');
    q.addEventListener('input', () => { st.q = q.value; const g = modal.querySelector('#pk-grid'); g.innerHTML = grid(); hydratePhotos(g); });
  };

  const drawPreview = (r) => {
    const plan = kitchen.planForRecipe(r, people, live('r_pantry'));
    // ingredient groups (Ricette v41): a heading wherever the group changes
    const ings = ingredientsOf(r);
    const groupOf = (p) => (p ? String(ings[p.idx]?.group || '').trim() : '');
    const groupHead = (p, prev) => (groupOf(p) && groupOf(p) !== groupOf(prev) ? `<li class="ing-group">${esc(groupOf(p))}</li>` : '');
    const m = minutesOf(r);
    const steps = (r.steps || []).map((x) => (typeof x === 'string' ? x : x.text || '')).filter(Boolean);
    const on = st.sel.includes(r.id);
    openModal(`
      <div class="pk-head">
        <button class="icon" value="list" formnovalidate aria-label="${esc(t('back'))}">‹</button>
        <h2>${esc(r.title)}</h2><span></span>
      </div>
      ${coverOf(r) ? `<div class="rec-hero">${photoTag(coverOf(r))}</div>` : ''}
      <p class="hint">${[m ? `⏱ ${fmtDur(m)}` : '', t('forPeople', people), fname(folderOfRecipe(r, folders)) ? `📁 ${fname(folderOfRecipe(r, folders))}` : '', ...tagsOf(r, defs).map(tagName)].filter(Boolean).map(esc).join(' · ')}</p>
      <ul class="list ing">${plan.map((p, i) => `${groupHead(p, plan[i - 1])}<li class="${p.covered ? 'have' : p.need == null && !p.tracked ? '' : 'need'}"><span class="q">${esc(qtyText(p.need, p.unit))}</span><span class="item-text">${esc(p.name)}${!p.covered && p.buy ? `<small>${esc(t('buyAmount', qtyText(p.buy, p.unit)))}</small>` : ''}</span><span class="mark">${p.covered ? '✓' : p.need == null && !p.tracked ? '' : '✕'}</span></li>`).join('')}</ul>
      ${steps.length ? `<details class="steps-box"><summary>${esc(t('stepsN', steps.length))}</summary><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
      <div class="pk-foot">
        <button class="btn ${on ? '' : 'primary'}" value="tog:${esc(r.id)}" formnovalidate>${esc(on ? t('unselect') : t('select'))}</button>
        ${r.url ? `<a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(t('source'))}</a>` : ''}
      </div>`, onSubmit, { cls: 'sheet' });
    hydratePhotos(modal);
  };

  function onSubmit(form, action, e) {
    e.preventDefault(); // stay in the dialog: the picker hands back to the meal
    if (action === 'done') { onDone(st.sel); return; }
    if (action === 'back') { onBack(); return; }
    if (action === 'list') { st.preview = null; draw(); return; }
    if (action.startsWith('tog:')) {
      const id = action.slice(4);
      st.sel = st.sel.includes(id) ? st.sel.filter((y) => y !== id) : [...st.sel, id];
      if (st.preview) st.preview = null;
    } else if (action.startsWith('info:')) st.preview = action.slice(5);
    else if (action.startsWith('folder:')) st.folder = action.slice(7);
    else if (action.startsWith('tag:')) { const tg = action.slice(4); if (st.tags.has(tg)) st.tags.delete(tg); else st.tags.add(tg); }
    else if (action === 'cook') st.canCook = !st.canCook;
    else if (action === 'quick') st.quick = !st.quick;
    else if (action === 'sort') st.sort = st.sort === 'cooked' ? 'name' : 'cooked';
    const scroll = modal.querySelector('form')?.scrollTop;
    draw();
    if (scroll) modal.querySelector('form').scrollTop = scroll;
  }
  draw();
}
export function openShopRec(shop = null) {
  const x = shop ? { ...shop, hours: (shop.hours || []).map((w) => ({ ...w })) } : { name: '', minutes: 30, hours: [], place: '', link: '' };
  const draw = () => openModal(`
    <h2>🏪 ${esc(shop ? x.name : t('newShop'))}</h2>
    <label>${esc(t('name'))}<input name="name" required value="${esc(x.name)}" autocomplete="off"></label>
    <label>${esc(t('shopVisit'))}${durField('minutes', x.minutes || 30)}</label>
    <div class="field-label">🕒 ${esc(t('openingHours'))}</div>
    ${windowsEditor('w_', x.hours)}
    ${hint('openingHoursHint')}
    <label>${esc(t('place'))}<input name="place" value="${esc(x.place || '')}" autocomplete="off"></label>
    <label>${esc(t('placeLink'))}<input name="link" type="url" value="${esc(x.link || '')}" autocomplete="off"></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${shop ? `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>` : ''}
    </div>`, (form, action, e) => {
    x.name = form.elements.namedItem('name').value.trim();
    x.minutes = readDur(form, 'minutes', 30);
    x.hours = readWindows(form, 'w_', x.hours.length);
    x.place = form.place.value.trim(); x.link = form.link.value.trim();
    const wm = action.match(/^w_(add|rm:(\d+))$/);
    if (wm) { e.preventDefault(); if (wm[1] === 'add') x.hours.push({ days: x.hours.length ? [6] : [1, 2, 3, 4, 5], from: 480, to: 1200 }); else x.hours.splice(Number(wm[2]), 1); draw(); return; }
    if (action === 'delete') { if (confirm(t('confirmDeleteShop'))) remove(SHOPS(), shop.id); render(); return; }
    if (!x.name) { e.preventDefault(); return; }
    upsert(SHOPS(), { ...(shop || {}), id: shop?.id || uid(), name: x.name, minutes: x.minutes, hours: cleanWindows(x.hours), place: x.place, link: x.link, order: shop?.order ?? shopsList().length }, { silent: true });
    changed();
    render();
  });
  draw();
}

// Task editor. Used for to-dos, for preparation steps (small tasks of their own, planned
// automatically before the task they belong to) and for saved tasks (Settings → Saved tasks, meals
// among them). Any task can be split into steps, and can have rules: "when this is planned / done /
// couldn't be done / was missed → …". "When it's planned" rules are its preparations (task.prep).
export function rulesForEditor(task) {
  const preps = (task.prep || []).map((p, i) => {
    const pt = get('tasks', p.taskId);
    return { id: `prep${i}`, when: 'planned', then: 'task', taskId: p.taskId, title: pt?.title || '', minutes: pt?.minutes || 10, place: p.when || 'before', stepId: null };
  });
  return [...preps, ...(task.rules || []).map((r) => ({ ...r }))];
}
// The one editor for tasks and events (`opts.event`, or a task of kind 'event'): the same sections
// in the same order; an event's "When" is a fixed date (a time is optional) and it has a section for
// the tasks to do around it instead of due date, importance and prerequisites.
// The "When" part of a task (v51): one choice first (once · repeats · whenever), then only what it needs.
// A repeating task either goes on the plan at the same time every time, or you pick the time each week
// (`pickTime`: the weekly "to fix" card on Today proposes free slots).
// Reads the When part back (v51), for the mode chosen; fields of the other modes are left as they were.
function collectWhen(form, x) {
  const val = (n) => form.querySelector(`input[name="${n}"]:checked`)?.value;
  const mode = val('whenMode') || whenModeOf(x);
  const td = today();
  x.whenMode = mode;
  if (form.due) x.due = form.due.value || null;
  if (mode === 'once') {
    x.repeat = null; x.pickTime = null;
    if (form.planDate) x.planDate = form.planDate.value || '';
    if (form.planTime) x.planTime = form.planTime.value ? parseTime(form.planTime.value) : null;
  } else if (mode === 'repeat') {
    x.repeat = val('repeat') || (x.repeat === 'weekdays' ? 'weekly' : x.repeat) || 'weekly';
    if (x.repeat === 'times') { if (form.timesN) { x.timesN = Math.max(1, Number(form.timesN.value) || 1); x.timesPer = form.timesPer.value || 'week'; } x.timesN ||= 3; x.timesPer ||= 'week'; }
    if (form.every) x.every = Math.max(1, Number(form.every.value) || 1);
    if (form.querySelector('input[name=repeatDays]')) x.repeatDays = [...form.querySelectorAll('input[name=repeatDays]:checked')].map((el) => Number(el.value));
    else if (x.repeat === 'weekly' && !(x.repeatDays || []).length) x.repeatDays = [plannedIso(x)];
    if (form.repeatUntil) x.repeatUntil = form.repeatUntil.value || null;
    if (form.repeatCount) x.repeatCount = Math.max(0, Number(form.repeatCount.value) || 0) || null; // (v69) per N volte
    if (form.scope) x.scope = form.querySelector('input[name=scope]:checked')?.value || 'following';
    const tm = val('timeMode') || (x.pickTime || (x.pickTime == null && x.planTime == null) ? 'pick' : 'fixed');
    x.pickTime = x.repeat === 'times' || tm === 'pick';
    if (x.pickTime) { x.planTime = null; x.planDate = ''; } else {
      if (form.planTime) x.planTime = form.planTime.value ? parseTime(form.planTime.value) : null;
      x.planDate = x.planTime != null ? (form.planDate?.value || x.planDate || td) : ''; // no time yet: not on the plan
    }
    if (!x.due) x.due = td; // where the repeats start counting from
  } else {
    x.repeat = null; x.pickTime = null; x.planDate = ''; x.planTime = null;
  }
  if (x.slotTimes && (mode !== 'repeat' || x.repeat !== 'weekly' || x.pickTime)) x.slotTimes = null; // (v66)
  if (x.dayMinutes && (mode !== 'repeat' || x.repeat !== 'weekly')) x.dayMinutes = null; // (v71)
}
export const whenModeOf = (x) => x.whenMode || (x.repeat ? 'repeat' : isSaved(x) && !x.planDate && !x.due ? 'anytime' : 'once');
function whenEditor(x, { routine, linkedEvent, evLine, timeLabel, anchorLabel, noTabs = false }) {
  const mode = whenModeOf(x);
  const td = today();
  const pill = (name, value, label, on, re = true) => `<label class="day-pill"><input type="radio" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''} ${re ? 'data-rerender="1"' : ''}><span>${esc(label)}</span></label>`;
  const whenPills = (labelKey) => `<div class="field-label">${esc(t(labelKey))}</div><div class="pills when-pills">${['', 'morning', 'afternoon', 'evening'].map((w) => pill('when', w, t(w ? `when_${w}` : (labelKey === 'atWhatTime' ? 'whenFirstFree' : 'when_any')), (x.when || '') === w, false)).join('')}</div>`;
  const dueField = linkedEvent ? `<label>${esc(t('due'))}<span class="static">${esc(x.due ? relDay(x.due) : '—')}</span></label>`
    : x.due || x.showDue ? `<label>${esc(t('dueBy'))}${dateBox(`<input name="due" type="date" value="${esc(x.due || '')}">`, x.due || '')}</label>`
    : `<button class="linkish add-due" value="show-due" formnovalidate>+ ${esc(t('addDue'))}</button>`;
  const tabs = noTabs ? '' : `<div class="seg when-mode" role="radiogroup" aria-label="${esc(t('secWhen'))}">${['once', 'repeat', 'anytime'].map((m) => `<label class="${m === mode ? 'on' : ''}"><input type="radio" name="whenMode" value="${m}" ${m === mode ? 'checked' : ''} data-rerender="1"><span>${esc(t(`wm_${m}`))}</span></label>`).join('')}</div>`;
  if (mode === 'once') {
    const chips = [[td, t('today')], [addDays(td, 1), t('tomorrow')]];
    return `${tabs}
    <div class="field-label">${esc(t('whichDay'))}</div>
    <div class="pills day-chips">${chips.map(([d, l]) => `<button class="day-chip${x.planDate === d ? ' on' : ''}" value="day:${d}" formnovalidate>${esc(l)}</button>`).join('')}
      <label class="day-other${x.planDate && !chips.some(([d]) => d === x.planDate) ? ' on' : ''}">${dateBox(`<input name="planDate" type="date" value="${esc(x.planDate || '')}" aria-label="${esc(t('otherDay'))}">`, x.planDate || '')}</label></div>
    ${whenPills('atWhatTime')}
    <label class="at-time">${esc(timeLabel === t('startTime') ? t('atExact') : timeLabel)}<input name="planTime" ${TIME24} value="${x.planTime != null ? fmtTime(x.planTime) : ''}" aria-label="${esc(timeLabel)}"></label>
    <small class="hint">${esc(t(x.planBlockId ? 'whenPlannedHint' : 'whenHint'))}</small>
    ${evLine}
    ${dueField}`;
  }
  if (mode === 'repeat') {
    const rep = x.repeat === 'weekdays' ? 'weekly' : (x.repeat || 'weekly');
    const days = x.repeat === 'weekdays' ? [1, 2, 3, 4, 5] : ((x.repeatDays || []).length ? x.repeatDays : [plannedIso(x)]);
    const pick = rep === 'times' || x.pickTime || (x.pickTime == null && x.planTime == null);
    return `${tabs}
    <div class="pills rep-pills">${[['daily', 'rf_daily'], ['weekly', 'rf_days'], ['times', 'rf_times'], ['monthly', 'rf_monthly']].map(([v, k]) => pill('repeat', v, t(k), rep === v)).join('')}</div>
    ${rep === 'weekly' ? `<div class="days week-days">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="repeatDays" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>` : ''}
    ${rep !== 'times' ? `<div class="times-row"><span>${esc(t('every'))}</span><input name="every" type="number" min="1" max="52" step="1" value="${esc(x.every || 1)}" aria-label="${esc(t('every'))}"><span>${esc(t(`unit_${rep}`, Number(x.every) || 1))}</span></div>`
    : `<div class="times-row"><input name="timesN" type="number" min="1" max="99" step="1" value="${esc(x.timesN || 3)}" aria-label="${esc(t('timesN'))}"><span>${esc(t('timesPer'))}</span>
      <select name="timesPer">${['day', 'week', 'month', 'year'].map((u) => `<option value="${u}" ${u === (x.timesPer || 'week') ? 'selected' : ''}>${esc(t(`per_${u}`))}</option>`).join('')}</select></div>`}
    ${rep === 'weekly' && x.slotTimes ? `<p class="hint">${esc(t('slotTimesHint'))}</p>` : rep === 'times' ? `${hint('timesHint')}${whenPills('usuallyWhen')}` : `<div class="field-label">${esc(t('andTime'))}</div>
    <label class="choice${!pick ? ' on' : ''}"><input type="radio" name="timeMode" value="fixed" ${!pick ? 'checked' : ''} data-rerender="1"><span><b>${esc(t('tmFixed'))}</b><small>${esc(t('tmFixedHint'))}</small>
      ${!pick ? `<span class="row tight"><input name="planTime" ${TIME24} value="${x.planTime != null ? fmtTime(x.planTime) : ''}" aria-label="${esc(timeLabel)}">${dateBox(`<input name="planDate" type="date" value="${esc(x.planDate || td)}" aria-label="${esc(t('fromDay'))}">`, x.planDate || td)}</span>` : ''}</span></label>
    <label class="choice${pick ? ' on' : ''}"><input type="radio" name="timeMode" value="pick" ${pick ? 'checked' : ''} data-rerender="1"><span><b>${esc(t('tmPick'))}</b><small>${esc(t('tmPickHint'))}</small></span></label>
    ${pick ? whenPills('usuallyWhen') : ''}`}
    <label>${esc(t('repeatUntil'))}${dateBox(`<input name="repeatUntil" type="date" value="${esc(x.repeatUntil || '')}">`, x.repeatUntil || '')}</label>
    ${classic() ? '' : `<label>${esc(t('repeatCount'))}<input name="repeatCount" type="number" min="1" max="500" step="1" value="${esc(x.repeatCount || '')}" placeholder="—"></label>`}
    ${x.fromOcc && (x.seriesFrom || x.due) && x.fromOcc > (x.seriesFrom || x.due) ? `<div class="field-label">${esc(t('applyTo'))}</div>
    <div class="days"><label class="day-pill"><input type="radio" name="scope" value="following" ${x.scope !== 'all' ? 'checked' : ''}><span>${esc(t('scopeFollowing', relDay(x.fromOcc)))}</span></label>
    <label class="day-pill"><input type="radio" name="scope" value="all" ${x.scope === 'all' ? 'checked' : ''}><span>${esc(t('scopeAll'))}</span></label></div>` : ''}`;
  }
  return `${tabs}
    <small class="hint">${esc(t(routine ? 'anytimeHintSaved' : 'anytimeHint'))}</small>
    ${whenPills('usuallyWhen')}
    ${routine ? `<label>${esc(anchorLabel)}<input name="defaultStart" ${TIME24} value="${x.defaultStart != null ? fmtTime(x.defaultStart) : ''}"></label>${hint('usualTimeHint')}` : ''}
    ${dueField}`;
}
// (v51) "At what time, Monday?": the free slots with why, or any time; or skip the day. "Every time at
// this time" turns the task into a fixed series from that day on.
export function openPickSheet(x, date) {
  const opts = slotOptions(x, date, 4);
  const lead = leadOf(x);
  const why = (o) => [t(`when_${o.part}`).toLowerCase(), o.part === x.when ? t('asUsual') : '', lead ? t('leaveAt', fmtTime(o.start - lead)) : t('slotFreeUntil', fmtTime(o.until))].filter(Boolean).join(' · ');
  openModal(`
    <h2>${esc(x.title)} · ${esc(relDay(date))}</h2>
    <p class="hint">${esc(fmtDur(x.minutes || 30))}${lead ? ` · ${esc(t('plusTravel', fmtDur(lead)))}` : ''}</p>
    ${opts.length ? `<div class="field-label">${esc(t('freeSlots'))}</div>
    <div class="slot-opts">${opts.map((o, i) => `<label class="slot-opt"><input type="radio" name="slot" value="${o.start}" ${i === 0 ? 'checked' : ''}><span><b>${fmtTime(o.start)} – ${fmtTime(o.start + (x.minutes || 30))}</b><small>${esc(why(o))}</small></span></label>`).join('')}</div>` : `<p class="hint">${esc(t('noFreeSlotDay'))}</p>`}
    <label class="at-time">${esc(t('orAt'))}<input name="other" ${TIME24} aria-label="${esc(t('orAt'))}"></label>
    <label class="check"><input type="checkbox" name="always"> <span>${esc(t('alwaysThisTime'))}<small>${esc(t('alwaysThisTimeHint'))}</small></span></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('fixIt'))}</button>
      <button class="btn" value="skip" formnovalidate>${esc(t('skipDay'))}</button>
      <button class="btn ghost" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
    </div>`, (form, action) => {
    if (action === 'skip') { skipOcc(x, date); toast(t('skippedOcc', relDay(date))); changed(); return; }
    const typed = form.other.value ? parseTime(form.other.value) : null;
    const start = typed ?? (form.querySelector('input[name=slot]:checked') ? Number(form.querySelector('input[name=slot]:checked').value) : null);
    if (start == null) return;
    let b;
    if (form.always.checked) {
      const tk = upsert('tasks', { ...get('tasks', x.id), pickTime: false, whenMode: 'repeat' }, { silent: true });
      b = planTask(tk, date, Math.max(0, start - lead)); // a series from this day, at this time
    } else b = fixOcc(get('tasks', x.id), date, start);
    toast(t('plannedToast', relDay(date), fmtTime(b.start + lead)));
    changed();
  });
}
// "Start now" in a task (v49): today's block moves to now, or one is made; and what it really took before.
function startBox(x) {
  const td = today(); const now = Math.floor(nowMinutes() / 5) * 5;
  const own = blocksOn(td).filter((b) => b.taskId === x.id && !outcomeOf(b) && b.kind !== 'prep').sort((a, b) => a.start - b.start)[0];
  const running = runningBlock()?.taskId === x.id;
  const h = timeHistory(x);
  return `<div class="start-box">
    ${running ? `<p class="hint">⏱ ${esc(t('timerRunning'))}</p>` : `<button class="btn primary start-now" value="start-now">▶ ${esc(t(isPalestra(x) ? 'palStart' : 'startNow'))}</button>
    <small class="hint">${esc(own ? t('startMoves', fmtTime(own.start), fmtTime(now)) : t('startNew', fmtTime(now)))}</small>`}
    ${h ? `<div class="time-hist"><div class="th-head"><b>${esc(t('realTime'))}</b><small>${esc(t('usuallyTakes', fmtDur(h.usual)))}</small></div>
      <ul>${h.entries.map((e) => { const d = e.minutes - e.planned; return `<li><span>${esc(relDay(e.date))}</span><span>${esc(fmtDur(e.minutes))}${e.planned && d ? ` <small class="${d < 0 ? 'ok' : 'warn'}">${d < 0 ? '−' : '+'}${esc(fmtDur(Math.abs(d)))}</small>` : ''}</span></li>`; }).join('')}</ul>
      ${(x.steps || []).length || h.usual === x.minutes ? '' : `<button class="btn small" value="use-usual">${esc(t('useUsual', fmtDur(h.usual)))}</button>`}</div>` : ''}
  </div>`;
}
// After a start: if it now runs into what comes next, say so and offer to move it.
// A workout starts in Palestra (on that workout and this block); Everyday's timer runs alongside.
export function openPalestra(x, b) { window.open(startLink(x, b), '_blank', 'noopener'); }
export function afterStart(b) {
  changed();
  const ls = ui.lateStart;
  if (ls?.id === b.id) toast(t('lateOverlap', ls.n), 9000, [{ label: t('shiftRest'), run: () => doShift(b.id) }, { label: t('leaveAsIs'), run: () => { ui.lateStart = null; changed(); } }]);
  else toast(t('timerStarted', b.title));
}
export function doShift(id) {
  const r = shiftAfter(get('blocks', id));
  changed();
  if (!r) return;
  const moved = r.added.map((x) => `${x.title} → ${x.date === today() ? fmtTime(x.start) : `${relDay(x.date)} ${fmtTime(x.start)}`}`);
  toast(t('shifted', moved.length, moved.slice(0, 3).join(' · ')), 9000, [{ label: t('undo'), run: () => { undoShift(r); changed(); toast(t('undone')); } }]);
}
// Fine: the real time on the block; if it ended early, offer the freed time to the next task.
export function finishTimer() {
  const b = runningBlock(); if (!b) return;
  const { block, minutes, planned } = stopTimer(b);
  changed();
  const c = pullCandidate(block);
  const msg = t('doneIn', fmtDur(minutes), planned);
  if (c) toast(`${msg} · ${t('pullOffer', fmtDur(c.free), c.block.title, fmtTime(c.start))}`, 9000, [{ label: t('pullUp'), run: () => { pullUp(c); changed(); } }, { label: t('leaveAsIs'), run: () => {} }]);
  else toast(msg);
}
// (v66) The short task sheet: which top chip is open (category · length · importance), kept while it redraws.
let edPop = null;
export function openTask(task, draft = null, opts = {}) {
  if (!draft) edPop = null;
  const isNew = !task;
  const evMode = Boolean(isEvent(task) || isEvent(draft) || opts.event || isEvent(opts.draft));
  const base = task || (evMode ? { title: '', minutes: 120, importance: 3, category: '', due: '', repeat: '', notes: '', when: '', kind: 'event' }
    : { title: '', minutes: 30, importance: 3, category: '', due: '', repeat: '', notes: '', when: '', kind: 'todo' });
  const src = draft || opts.draft || base;
  const x = draft?.allRules ? draft : { ...src, importance: importanceOf(src), minutes: ownMinutes(src), steps: realSteps(src).map((y) => ({ ...y })), checklist: [...(src.checklist || [])], allRules: rulesForEditor(src), travel: travelOf(src) };
  if (!x.travel) x.travel = travelOf(src);
  if (opts.fromOcc) x.fromOcc = opts.fromOcc;
  const helper = isStep(x);
  const routine = isSaved(x);
  void routine; // saved tasks get the same editor as to-dos (they only live in another list)
  // When a to-do is on the plan, its date and time show here and can be changed (or cleared to unplan).
  if (!helper && x.planDate === undefined) {
    // (an event with no time to come still has its block: the one it happened in)
    const nb = x.id ? (evMode && !x.repeat ? eventBlockOf(x.id) : nextBlockOf(x.id)) : null;
    x.planDate = nb?.date || '';
    x.planTime = nb ? nb.start + anchorOffset(nb) : null;
    x.planBlockId = nb?.id || null;
    if (evMode) {
      if (isNew && !x.planDate) { x.planDate = opts.date || ''; x.planTime = opts.start ?? null; }
      if (!x.planDate) x.planDate = x.due || '';
      if (x.planTime == null && !x.allDay && x.eventTime != null) x.planTime = x.eventTime;
    }
  }
  const linkedEvent = !evMode && x.eventId ? eventOf(x.eventId) : null;
  const lenOf = (y) => Number(y.minutes) || 10;
  const stepTotal = x.steps.reduce((n, y) => n + lenOf(y), 0);
  const fromRecipes = x.steps.some((y) => y.from === 'recipes');
  const ai = anchorIndex(x.steps.filter((y) => y.title || true), x.anchorStepId);
  const anchor = x.steps[ai];
  const WHEN_TASK = helper ? ['done', 'failed', 'missed'] : RULE_WHEN;
  const WHEN_STEP = ['done', 'failed'];
  const short = !classic() && !evMode && !helper && !opts.full;
  const opened = (short ? state.settings.edSec2 : state.settings.edSec) || {};
  // A collapsible section of the editor; whether it's open is remembered.
  const sec = (key, title, summary, body, defOpen) => `<details class="ed-sec" data-sec="${key}" ${opts.openSec === key || (opened[key] ?? defOpen) ? 'open' : ''}>
      <summary><span class="sec-t">${title}</span>${summary ? `<small>${esc(summary)}</small>` : ''}</summary>
      <div class="sec-b">${body}</div></details>`;

  const ruleCard = (r, i) => {
    const onStep = Boolean(r.stepId);
    const planned = r.when === 'planned';
    const places = planned ? PREP_PLACES : RULE_PLACES;
    const linked = r.taskId && get('tasks', r.taskId);
    return `
    <div class="rule ${r.then === 'groceries' ? 'is-groceries' : ''}">
      <input type="hidden" name="rs_${i}" value="${esc(r.stepId || '')}">
      <div class="rule-line"><span>${esc(t('ruleWhenGen'))} ${esc(onStep ? t('ruleThisStep') : t('ruleSubjectTask'))}</span>
        <select name="rw_${i}" data-rerender="1">${(onStep ? WHEN_STEP : WHEN_TASK).map((w) => `<option value="${w}" ${w === r.when ? 'selected' : ''}>${esc(t(onStep ? `rws_${w}` : `rw_${w}`))}</option>`).join('')}</select>
        <button class="icon" value="rm-rule:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></div>
      <div class="rule-line"><span>→</span>
        ${planned ? `<span class="rule-subj">${esc(t('rt_task'))}</span><input type="hidden" name="rt_${i}" value="task">`
    : `<select name="rt_${i}" data-rule="${i}"><option value="task" ${r.then !== 'groceries' ? 'selected' : ''}>${esc(t('rt_task'))}</option><option value="groceries" ${r.then === 'groceries' ? 'selected' : ''}>${esc(t('rt_groceries'))}</option></select>`}</div>
      <div class="rule-line rt-task">
        <select name="rk_${i}" data-rulekind="${i}"><option value="">${esc(t('ruleNewTask'))}</option>${ruleTargets(x).map((y) => `<option value="${esc(y.id)}" ${y.id === r.taskId ? 'selected' : ''}>${isStep(y) ? '↳ ' : ''}${esc(y.title)}</option>`).join('')}</select>
        <input class="rule-title${r.taskId ? ' hide' : ''}" name="rti_${i}" value="${esc(r.taskId ? '' : r.title || '')}" placeholder="${esc(t(planned ? 'prepPh' : 'rulePh'))}" autocomplete="off">
        ${durField(`rm_${i}`, Number(r.minutes) || linked?.minutes || 30)}
        <select name="rp_${i}" data-rerender="1">${places.map((p) => `<option value="${p}" ${p === (r.place || places[0]) ? 'selected' : ''}>${esc(t(`${planned ? 'pw' : 'rp'}_${p}`))}</option>`).join('')}</select>
        <button class="btn small ghost" value="edit-rule:${i}" formnovalidate title="${esc(t('editRuleTask'))}">${esc(t('edit'))}${linked?.steps?.length ? ` · ▤ ${linked.steps.length}` : ''}${linked?.checklist?.length ? ` · ☑ ${linked.checklist.length}` : ''}${linked?.rules?.length ? ` · ⚙ ${linked.rules.length}` : ''}</button>
      </div>
      ${!planned && ['slots', 'pool'].includes(r.place) && r.then !== 'groceries' ? `<div class="rule-wins"><p class="hint">${esc(t(r.place === 'slots' ? 'rpSlotsHint' : 'rpPoolHint'))}</p>${windowsEditor(`r${i}w_`, r.windows || [])}</div>` : ''}
    </div>`;
  };
  const rulesFor = (sid) => x.allRules.map((r, i) => [r, i]).filter(([r]) => (r.stepId || null) === sid);

  // Steps already done on earlier days (the task is spread over several days).
  const doneSteps = stepsDoneOf(x);
  const span = x.id && !isNew ? taskSpan(x) : null;
  const doneN = x.steps.filter((y) => y.title && doneSteps.has(y.id)).length;
  const progressLine = doneN || (span && span.days > 1) ? `<p class="hint progress-line">${esc([doneN ? t('stepsProgress', doneN, x.steps.filter((y) => y.title).length) : '', span && span.days > 1 ? t('onPlateSince', fmtDay(span.first, { weekday: 'short', day: 'numeric', month: 'short' }), span.days) : ''].filter(Boolean).join(' · '))}</p>` : '';
  const stepCards = x.steps.map((y, i) => {
    const mine = rulesFor(y.id);
    const isAnchor = i === ai && x.steps.length > 1;
    return `<li class="step-card${isAnchor ? ' anchor' : ''}">
      <div class="step-row">
        <span class="step-n${doneSteps.has(y.id) ? ' done' : ''}" ${doneSteps.has(y.id) ? `title="${esc(t('stepDoneBefore'))}"` : ''}>${doneSteps.has(y.id) ? '✓' : i + 1}</span>
        <input name="st_t_${i}" value="${esc(y.title)}" placeholder="${esc(t('stepPh'))}" autocomplete="off" aria-label="${esc(t('title'))}">
        ${durField(`st_m_${i}`, lenOf(y))}
        <button class="icon anchor-btn${isAnchor ? ' on' : ''}" value="anchor:${i}" formnovalidate title="${esc(t('anchorBtn'))}" aria-pressed="${isAnchor}">⚓</button>
        ${i ? `<button class="icon" value="up-step:${i}" formnovalidate aria-label="↑">↑</button>` : '<span class="icon-sp"></span>'}
        <button class="icon" value="rm-step:${i}" formnovalidate aria-label="${esc(t('remove'))}">✕</button>
      </div>
      ${isMealType(x) || y.from === 'recipes' ? `<label class="check step-sub"><input type="checkbox" name="st_r_${i}" data-rerender="1" ${y.from === 'recipes' ? 'checked' : ''}> <span>⟲ ${esc(t(y.from === 'recipes' ? 'stepRecipesOn' : 'stepRecipesOff'))}</span></label>` : ''}
      ${mine.map(([r, k]) => ruleCard(r, k)).join('')}
      <button class="btn small ghost step-rule-add" value="add-rule:${esc(y.id)}" formnovalidate>⚙ + ${esc(t('addStepRule'))}</button>
    </li>`;
  }).join('');
  const taskRules = rulesFor(null);
  const timeLabel = x.steps.length > 1 && ai > 0 && anchor ? t('anchorAt', anchor.title || '…') : t('startTime');
  const heading = evMode ? (isNew ? t('newEvent') : t('editEvent')) : routine ? (isMealType(x) ? (isNew ? t('newMealType') : t('mealType')) : (isNew ? t('newSaved') : t('savedTask'))) : helper ? t('editPrep') : isNew ? t('newTask') : t('editTask');
  const catName0 = catsOf(x).map((c) => catName(get('categories', c))).join(', ');

  const basics = `
    <div class="two">
      ${x.steps.length ? `<label>${esc(t('duration'))}<span class="static">${esc(fromRecipes ? t('durationRecipes', fmtDur(stepTotal)) : t('durationFromSteps', fmtDur(stepTotal)))}</span></label>`
    : `<label>${esc(t('duration'))}${durField('minutes', x.minutes || 30)}</label>`}
      ${helper || x.travelRole ? '' : `<label>${esc(t('bufferAfter'))}<select name="buffer"><option value="" ${x.buffer == null || x.buffer === '' ? 'selected' : ''}>${esc(t('bufferDefault', Number(state.settings.taskBuffer) || 0))}</option>${[0, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${x.buffer != null && x.buffer !== '' && Number(x.buffer) === m ? 'selected' : ''}>${m ? esc(fmtDur(m)) : esc(t('none'))}</option>`).join('')}</select></label>`}
      ${helper || evMode ? '' : `<label>${esc(t('importance'))}<select name="importance">${IMPORTANCE.map((n) => `<option value="${n}" ${n === x.importance ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${esc(t(`imp_${n}`))}</option>`).join('')}</select></label>`}
    </div>
    ${dayLenPart(x)}
    ${helper ? '' : `<div class="field-label">${esc(t('categories'))}</div>${catChipsMulti(x)}`}
    ${helper || isMealType(x) || evMode ? '' : `<label class="check"><input type="checkbox" name="routine" ${routine ? 'checked' : ''}> <span>★ ${esc(t('keepSaved'))}${small('keepSavedHint')}</span></label>`}
    ${routine ? `<label class="check"><input type="checkbox" name="meal" data-rerender="1" ${isMealType(x) ? 'checked' : ''}> <span>${esc(t('isMeal'))}</span></label>` : ''}`;
  const off = x.eventOffset || { days: 0, when: 'before' };
  const offWeeks = off.days > 0 && off.days % 7 === 0;
  const evLine = linkedEvent ? `
    <div class="ev-link">
      <div class="field-label">📅 ${esc(t('forEvent', linkedEvent.title))} <small>${esc(eventDate(linkedEvent) ? relDay(eventDate(linkedEvent)) : '')}</small></div>
      <div class="offset-row">
        <input name="evDays" type="number" min="0" max="365" step="1" value="${esc(offWeeks ? off.days / 7 : off.days)}" aria-label="${esc(t('offsetDays'))}">
        <select name="evUnit"><option value="days" ${offWeeks ? '' : 'selected'}>${esc(t('daysUnit'))}</option><option value="weeks" ${offWeeks ? 'selected' : ''}>${esc(t('weeksUnit'))}</option></select>
        <select name="evWhen"><option value="before" ${off.when !== 'after' ? 'selected' : ''}>${esc(t('beforeIt'))}</option><option value="after" ${off.when === 'after' ? 'selected' : ''}>${esc(t('afterIt'))}</option><option value="none">${esc(t('detachEvent'))}</option></select>
      </div>
      <button class="btn small ghost" value="open-event" formnovalidate>${esc(t('openEvent'))} ↗</button>
    </div>` : '';
  const whenBody = evMode ? `
    <div class="two">
      <label>${esc(t('date'))}${dateBox(`<input name="planDate" type="date" required value="${esc(x.planDate || '')}">`, x.planDate || '')}</label>
      <label>${esc(timeLabel)}<input name="planTime" ${TIME24} value="${x.planTime != null ? fmtTime(x.planTime) : ''}"></label>
    </div>
    <small class="hint">${esc(t('eventWhenHint'))}</small>
    <div class="two">
      <label>${esc(t('repeat'))}<select name="repeat" data-rerender="1"><option value="">${esc(t('rep_none'))}</option>${REPEATS.map((r) => `<option value="${r}" ${r === x.repeat ? 'selected' : ''}>${esc(t(`rep_${r}`))}</option>`).join('')}</select></label>
    </div>
    ${REPEATS.includes(x.repeat) ? `<div class="recur-box">
      ${x.repeat !== 'weekdays' ? `<div class="times-row"><span>${esc(t('every'))}</span><input name="every" type="number" min="1" max="52" step="1" value="${esc(x.every || 1)}" aria-label="${esc(t('every'))}"><span>${esc(t(`unit_${x.repeat}`, Number(x.every) || 1))}</span></div>` : ''}
      ${x.repeat === 'weekly' ? `<div class="days mini">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="day-pill"><input type="checkbox" name="repeatDays" value="${d}" ${((x.repeatDays || []).length ? x.repeatDays : [plannedIso(x)]).includes(d) ? 'checked' : ''}><span>${esc(dayShort(d))}</span></label>`).join('')}</div>` : ''}
      <label>${esc(t('repeatUntil'))}${dateBox(`<input name="repeatUntil" type="date" value="${esc(x.repeatUntil || '')}">`, x.repeatUntil || '')}</label>
      ${x.planTime == null ? `<small class="hint">${esc(t('repeatNeedsTime'))}</small>` : ''}
      ${x.fromOcc && (x.seriesFrom || x.due) && x.fromOcc > (x.seriesFrom || x.due) ? `<div class="field-label">${esc(t('applyTo'))}</div>
      <div class="days"><label class="day-pill"><input type="radio" name="scope" value="following" ${x.scope !== 'all' ? 'checked' : ''}><span>${esc(t('scopeFollowing', relDay(x.fromOcc)))}</span></label>
      <label class="day-pill"><input type="radio" name="scope" value="all" ${x.scope === 'all' ? 'checked' : ''}><span>${esc(t('scopeAll'))}</span></label></div>` : ''}
    </div>` : ''}
    ${remindField(x)}` : !helper ? whenEditor(x, { routine, linkedEvent, evLine, timeLabel, noTabs: short, anchorLabel: x.steps.length > 1 && ai > 0 && anchor ? t('anchorAt', anchor.title || '…') : t('usualTimeOpt') }) + `
    ${remindField(x)}` : '';
  // Tasks it needs done first (not itself, not meals, not ones that already need it: no loops).
  const needCandidates = live('tasks').filter((y) => y.id !== x.id && !isMealType(y) && !y.check && !y.done && !(y.after || []).includes(x.id) && !(x.after || []).includes(y.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const needsBody = helper || evMode ? '' : `
    <div class="field-label">🔒 ${esc(t('needsFirst'))}</div>
    ${(x.after || []).length ? `<div class="needs">${(x.after || []).map((id, k) => { const y = get('tasks', id); return `<span class="need-chip${y?.done ? ' done' : ''}">${y?.done ? '✓ ' : ''}${esc(y?.title || '?')}<button class="icon" value="rm-after:${k}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></span>`; }).join('')}</div>` : ''}
    <div class="need-pick"><input type="search" id="need-q" placeholder="+ ${esc(t('needSearchPh'))}" autocomplete="off" enterkeyhint="done" aria-label="${esc(t('addNeed'))}"><div class="need-list" id="need-list" role="listbox"></div></div>
    ${hint('needsHint')}
    <div class="field-label">🕒 ${esc(t('windowsTitle'))}</div>
    ${windowsEditor('w_', x.windows || [])}
    ${hint('windowsHint')}`;
  const whenSummary = evMode ? [x.planDate ? `${relDay(x.planDate)} ${x.planTime != null ? fmtTime(x.planTime) : t('allDay')}` : t('dateMissing'), x.repeat ? `↻ ${repeatText(x)}` : ''].filter(Boolean).join(' · ')
    : !helper ? [x.planDate ? `${relDay(x.planDate)}${x.planTime != null ? ` ${fmtTime(x.planTime)}` : ''}` : '', x.due ? t('dueOn', relDay(x.due)) : '', x.repeat ? `↻ ${x.repeat === 'times' ? t('timesShort', x.timesN || 3, t(`per_${x.timesPer || 'week'}`)) : repeatText(x)}` : '', routine && x.defaultStart != null ? t('usually', fmtTime(x.defaultStart)) : ''].filter(Boolean).join(' · ') : '';
  // Events: the tasks to do around them, with how far before or after, and whether each is planned.
  const evTasks = evMode && x.id ? eventTasksOf(x.id) : [];
  const evTasksBody = evMode ? `
    ${hint('eventTasksHint')}
    ${evTasks.length ? `<ul class="list ev-tasks">${evTasks.map((y) => { const nb = nextPlanned(y.id); const late = !y.done && y.due && y.due < today(); return `<li class="${y.done ? 'done' : ''}">
      <button class="task-main" value="ev-task:${esc(y.id)}" formnovalidate><span class="item-text">${y.done ? '✓ ' : ''}${esc(y.title)}<small>${esc([offsetText(y.eventOffset), y.due ? relDay(y.due) : '', fmtDur(y.minutes || 30)].filter(Boolean).join(' · '))}</small>
      <small class="${y.done ? '' : nb ? 'ok' : late ? 'late' : 'warn'}">${esc(y.done ? t('doneLabel') : nb ? t('plannedAt', relDay(nb.date), fmtTime(nb.start)) : late ? t('lateLabel') : t('toPlanLabel'))}</small></span></button>
    </li>`; }).join('')}</ul>` : ''}
    <div class="button-row left">
      <button class="btn small" value="add-evtask" formnovalidate>+ ${esc(t('addEventTask'))}</button>
      ${evTasks.some((y) => !y.done && !nextPlanned(y.id)) ? `<button class="btn small primary-ghost" value="plan-evtasks" formnovalidate>✦ ${esc(t('planThese'))}</button>` : ''}
    </div>` : '';
  const stepsBody = `
    ${hint(isMealType(x) ? 'stepsHintMeal' : 'stepsHint')}
    ${progressLine}
    ${stepCards ? `<ol class="steps-edit">${stepCards}</ol>` : ''}
    ${x.steps.length > 1 && ai > 0 && anchor ? `<p class="hint anchor-hint">⚓ ${esc(t('anchorHintGen', anchor.title || '…', x.steps.slice(0, ai).map((y) => y.title).filter(Boolean).join(', ')))}</p>` : ''}
    <button class="btn small" value="add-step" formnovalidate>+ ${esc(t('addStep'))}</button>
    ${x.steps.length > 1 && !isMealType(x) && !helper ? stepsPlanPills(x) : ''}`;
  const rulesBody = `
    <p class="hint">${esc(t(helper ? 'rulesHint' : 'rulesHintPrep'))}</p>
    ${taskRules.map(([r, i]) => ruleCard(r, i)).join('')}
    <button class="btn small" value="add-rule:" formnovalidate>+ ${esc(t('addRule'))}</button>`;
  const placeBody = `
    <label>${esc(t('place'))}<input name="place" value="${esc(x.place || '')}" placeholder="${esc(t('placePh'))}" autocomplete="off"></label>
    <label>${esc(t('placeLink'))}<input name="link" type="url" inputmode="url" value="${esc(x.link || '')}" placeholder="https://maps.app.goo.gl/…" autocomplete="off"></label>
    ${x.place || x.link ? `<p class="hint">${placeLink(x)}</p>` : `${hint('placeHint')}`}
    ${!helper && !x.travelRole ? `<div class="field-label">${esc(t('travelTitle'))}</div>
    <div class="travel-opts">
      <label class="check"><input type="checkbox" name="tvThere" ${x.travel.there ? 'checked' : ''}> <span>${esc(t('getThere'))}</span></label>
      <label class="check"><input type="checkbox" name="tvBack" ${x.travel.back ? 'checked' : ''}> <span>${esc(t('comeBack'))}</span></label>
      <label>${esc(t('travelMode'))}<select name="tvMode"><option value="default" ${x.travel.mode === 'default' ? 'selected' : ''}>${esc(t('tvDefault', t(`tm_${travelCfg().mode}`)))}</option>${TRAVEL_MODES.map((m) => `<option value="${m}" ${x.travel.mode === m ? 'selected' : ''}>${MODE_ICON[m]} ${esc(t(`tm_${m}`))}</option>`).join('')}</select></label>
    </div>
    ${(src.steps || []).filter((y) => y.travel).map((y) => `<p class="hint">${MODE_ICON[y.mode] || ''} ${esc(y.title)}: ${y.known ? esc(fmtDur(y.minutes)) : '?'} · ${esc(t('fromPlace', y.from || t('home')))}${y.known ? '' : ` · ${esc(t('travelPending'))}`}</p>`).join('')}
    ${!travelCfg().home && !hereNow() ? `<p class="hint warn-text">⚠ ${esc(t('homeUnset'))} <a href="#/settings/travel">${esc(t('travelSettings'))}</a></p>` : ''}
    ${hint('travelHint')}` : ''}`;
  // (v66) the short sheet: four chips on top, what's on the plan, then everything else under "Altro"
  const ups = short && x.id ? upcomingOf(x.id) : [];
  const lenNow = x.steps.length ? stepTotal : x.minutes || 30;
  const slotLine = x.slotTimes && x.repeat === 'weekly' ? `${(x.repeatDays || []).map((d) => `${dayShort(d)} ${fmtTime((x.slotTimes[d] ?? x.seriesTime ?? 0) + leadOf(x))}`).join(' · ')}${Number(x.every) === 2 ? ` · ${t('wg2w').toLowerCase()}` : ''}` : '';
  const whenChip = slotLine || (x.repeat ? `↻ ${x.repeat === 'times' ? t('timesShort', x.timesN || 3, t(`per_${x.timesPer || 'week'}`)) : repeatText(x)}` : ups.length ? `${relDay(ups[0].date)} ${fmtTime(ups[0].start)}${ups.length > 1 ? ` +${ups.length - 1}` : ''}` : x.due ? t('dueOn', relDay(x.due)) : t('whenChip'));
  const c0 = catsOf(x)[0];
  const wm = whenModeOf(x);
  const modeSeg = short && !isMealType(x) ? `<div class="seg when-mode ed-wm" role="radiogroup" aria-label="${esc(t('secWhen'))}">${['once', 'repeat', 'anytime'].map((m) => `<label class="${m === wm ? 'on' : ''}"><input type="radio" name="whenMode" value="${m}" ${m === wm ? 'checked' : ''} data-rerender="1"><span>${esc(t(`wm_${m}`))}</span></label>`).join('')}</div><p class="hint ed-wm-what">${esc(t(`wmWhat_${wm}`))}</p>` : '';
  const shortTop = short ? `${modeSeg}<div class="ed-chips">
      <button class="mchip ed-chip${c0 ? ' set' : ''}" value="pop:cat" formnovalidate aria-expanded="${edPop === 'cat'}">${c0 ? `<i class="cat-dot" style="--c:${esc(catColor(c0))}"></i>` : ''}${esc(catName0 || t('mGroup'))}</button>
      <button class="mchip ed-chip set" value="pop:len" formnovalidate aria-expanded="${edPop === 'len'}">⏱ ${esc(x.dayMinutes && Object.keys(x.dayMinutes).length ? dayLenSummary(x) : fmtDur(lenNow))}</button>
      <button class="mchip ed-chip${ups.length || x.repeat || x.due ? ' set' : ''}" value="when" formnovalidate>🕒 ${esc(whenChip)}</button>
      <button class="mchip ed-chip set" value="pop:imp" formnovalidate aria-expanded="${edPop === 'imp'}" aria-label="${esc(t('importance'))}">${'★'.repeat(x.importance || 3)}</button>
    </div>
    ${edPop === 'cat' ? `<div class="ed-pop">${catChipsMulti(x)}</div>` : ''}
    ${edPop === 'len' ? `<div class="ed-pop">${x.steps.length ? `<p class="hint">${esc(fromRecipes ? t('durationRecipes', fmtDur(stepTotal)) : t('durationFromSteps', fmtDur(stepTotal)))}</p>` : `<label>${esc(t('duration'))}${durField('minutes', x.minutes || 30)}</label>${dayLenPart(x)}`}</div>` : ''}
    ${edPop === 'imp' ? `<div class="ed-pop"><label>${esc(t('importance'))}<select name="importance">${IMPORTANCE.map((n) => `<option value="${n}" ${n === x.importance ? 'selected' : ''}>${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${esc(t(`imp_${n}`))}</option>`).join('')}</select></label></div>` : ''}
    <div class="field-label">${esc(t('inPlan'))}</div>
    ${ups.length ? `<ul class="ed-plan">${ups.slice(0, 6).map((b) => `<li><span><b>${esc(relDay(b.date))} · ${esc(fmtTime(b.start))}–${esc(fmtTime(b.start + (b.minutes || 0)))}</b>${b.stepId ? `<small>${esc(b.title)}</small>` : ''}</span><button class="btn small" value="mv:${esc(b.id)}" formnovalidate>${esc(t('moveBtn'))}</button><button class="icon" value="unplan:${esc(b.id)}" formnovalidate aria-label="${esc(t('remove'))}">✕</button></li>`).join('')}</ul>${ups.length > 6 ? `<p class="hint">${esc(t('findMoreN', ups.length - 6))}</p>` : ''}` : `<p class="hint">${esc(t('inPlanNone'))}</p>`}` : '';
  const optsBody = `${helper || x.travelRole ? '' : `<label>${esc(t('bufferAfter'))}<select name="buffer"><option value="" ${x.buffer == null || x.buffer === '' ? 'selected' : ''}>${esc(t('bufferDefault', Number(state.settings.taskBuffer) || 0))}</option>${[0, 5, 10, 15, 30, 60].map((m) => `<option value="${m}" ${x.buffer != null && x.buffer !== '' && Number(x.buffer) === m ? 'selected' : ''}>${m ? esc(fmtDur(m)) : esc(t('none'))}</option>`).join('')}</select></label>`}
    ${routine ? `<label class="check"><input type="checkbox" name="meal" data-rerender="1" ${isMealType(x) ? 'checked' : ''}> <span>${esc(t('isMeal'))}</span></label>` : ''}`;
  const shortMore = short ? `<div class="field-label ed-more-h">${esc(t('moreSec'))}</div><div class="ed-more">
    ${sec('when', `↻ ${esc(t('secRepeat'))}`, [x.repeat ? (slotLine || repeatText(x)) : '', x.due ? t('dueOn', relDay(x.due)) : ''].filter(Boolean).join(' · ') || '—', whenBody, false)}
    ${sec('needs', `🔒 ${esc(t('secNeeds'))}`, [(x.after || []).length ? `🔒 ${(x.after || []).length}` : '', cleanWindows(x.windows).length ? windowsText(cleanWindows(x.windows)) : ''].filter(Boolean).join(' · ') || '—', needsBody, false)}
    ${sec('place', `📍 ${esc(t('secPlace'))}`, x.place || (x.link ? t('link') : '—'), placeBody, false)}
    ${sec('steps', `▤ ${esc(t('steps'))}`, x.steps.length ? `${doneN ? `◐ ${doneN}/` : ''}${x.steps.length} · ${fmtDur(stepTotal)}` : '—', stepsBody, false)}
    ${x.check ? '' : sec('checklist', `☑ ${esc(t('checklist'))}`, x.checklist.length ? String(x.checklist.length) : '—', `<label><textarea name="checklist" rows="3" placeholder="${esc(t('checklistPh'))}" aria-label="${esc(t('checklist'))}">${esc((x.checklist || []).join('\n'))}</textarea>
      ${small('checklistHint')}</label>`, false)}
    ${advancedOn() || taskRules.length || isMealType(x) ? sec('rules', `⚙ ${esc(t(x.steps.length ? 'rulesWhole' : 'rules'))}`, taskRules.length ? String(taskRules.length) : '—', rulesBody, false) : ''}
    ${sec('opts', `◦ ${esc(t('secOptions'))}`, [x.buffer ? fmtDur(Number(x.buffer)) : ''].filter(Boolean).join(' · ') || '—', optsBody, false)}
    ${sec('notes', `✎ ${esc(t('notes'))}`, x.notes ? x.notes.slice(0, 30) : '—', `<label><textarea name="notes" rows="2" aria-label="${esc(t('notes'))}">${esc(x.notes || '')}</textarea></label>`, false)}
  </div>` : '';
  openModal(`
    <h2>${esc(heading)}</h2>
    ${x.check === 'ingredients' ? `${hint('checkStepHint')}` : ''}
    ${x.travelRole ? `<p class="hint">${esc(t('legTaskHint', t(x.travelRole === 'there' ? 'getThere' : 'comeBack')))}</p>` : ''}
    ${palestraNote(x)}
    <label>${esc(t('title'))}<input name="title" required value="${esc(x.title)}" autocomplete="off"></label>
    ${!isNew && !helper && !evMode && !x.done && !x.archived && x.id !== 'meal_check' ? startBox(x) : ''}
    ${short ? `${shortTop}${shortMore}` : `${evMode ? sec('when', `📅 ${esc(t('secWhen'))}`, whenSummary, whenBody, true) : ''}
    ${evMode ? sec('evtasks', `✓ ${esc(t('secEventTasks'))}`, evTasks.length ? readinessText(x.id) : '', evTasksBody, true) : ''}
    ${sec('basics', esc(t(evMode ? 'secBasicsEvent' : 'secBasics')), [fmtDur(x.steps.length ? stepTotal : x.minutes || 30), helper || evMode ? '' : t(`imp_${x.importance}`), catName0].filter(Boolean).join(' · '), basics, !evMode)}
    ${whenBody && !evMode ? sec('when', `🕒 ${esc(t('secWhen'))}`, [whenSummary, (x.after || []).length ? `🔒 ${(x.after || []).length}` : '', cleanWindows(x.windows).length ? windowsText(cleanWindows(x.windows)) : ''].filter(Boolean).join(' · '), whenBody + needsBody, true) : ''}
    ${helper ? '' : sec('place', `📍 ${esc(t('secPlace'))}`, x.place || (x.link ? t('link') : ''), placeBody, Boolean(x.place || x.link))}
    ${sec('steps', `▤ ${esc(t('steps'))}`, x.steps.length ? `${doneN ? `◐ ${doneN}/` : ''}${x.steps.length} · ${fmtDur(stepTotal)}` : '', stepsBody, true)}
    ${x.check ? '' : sec('checklist', `☑ ${esc(t('checklist'))}`, x.checklist.length ? String(x.checklist.length) : '', `<label><textarea name="checklist" rows="3" placeholder="${esc(t('checklistPh'))}" aria-label="${esc(t('checklist'))}">${esc((x.checklist || []).join('\n'))}</textarea>
      ${small('checklistHint')}</label>`, x.checklist.length > 0)}
    ${advancedOn() || taskRules.length || isMealType(x) ? sec('rules', `⚙ ${esc(t(x.steps.length ? 'rulesWhole' : 'rules'))}`, taskRules.length ? String(taskRules.length) : '', rulesBody, true) : ''}
    ${sec('notes', esc(t('notes')), x.notes ? x.notes.slice(0, 30) : '', `<label><textarea name="notes" rows="2" aria-label="${esc(t('notes'))}">${esc(x.notes || '')}</textarea></label>`, Boolean(x.notes))}`}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${!short && !helper && !evMode && !x.planBlockId ? `<button class="btn" value="plan">${esc(t('planIt'))}</button>` : ''}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew || x.id === 'meal_check' ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action, e) => {
    collect(form);
    const again = (focus) => { e.preventDefault(); openTask(task, x, opts); if (focus) modal.querySelector(focus)?.focus(); };
    if (action.startsWith('pop:')) { const k = action.slice(4); edPop = edPop === k ? null : k; again(); return; }
    if (action.startsWith('unplan:')) {
      const b = get('blocks', action.slice(7));
      if (b) { deleteBlock(b); if (x.planBlockId === b.id) { x.planBlockId = null; x.planDate = ''; x.planTime = null; } changed(); }
      again(); return;
    }
    if (action.startsWith('day:')) { x.planDate = action.slice(4); again(); return; }
    if (action === 'show-due') { x.showDue = true; again('input[name=due]'); return; }
    if (action === 'add-step') {
      x.steps.push({ id: uid().slice(0, 6), title: '', minutes: 10 });
      again(`input[name=st_t_${x.steps.length - 1}]`);
      return;
    }
    if (action.startsWith('rm-step:')) {
      const [gone] = x.steps.splice(Number(action.slice(8)), 1);
      x.allRules = x.allRules.filter((r) => r.stepId !== gone.id); // its rules go with it
      if (x.anchorStepId === gone.id) x.anchorStepId = null;
      again(); return;
    }
    if (action.startsWith('up-step:')) {
      const i = Number(action.slice(8));
      [x.steps[i - 1], x.steps[i]] = [x.steps[i], x.steps[i - 1]];
      again(); return;
    }
    // "Needs first": a task picked from the search, or a new one made from what you typed
    if (action.startsWith('add-after:')) { x.after = [...new Set([...(x.after || []), action.slice(10)])]; again('#need-q'); return; }
    if (action === 'new-after') {
      const q = quickAdd(form.querySelector('#need-q')?.value || '');
      if (q.title) {
        const y = applyTravel(upsert('tasks', { id: uid(), createdAt: Date.now(), ...quickFields(q) }, { silent: true }));
        x.after = [...(x.after || []), y.id];
        toast(t('needCreated', y.title));
      }
      again('#need-q'); return;
    }
    if (action.startsWith('rm-after:')) { x.after = (x.after || []).filter((_, k) => k !== Number(action.slice(9))); again(); return; }
    if (action === 'open-event' && linkedEvent) { if (isEvent(linkedEvent)) setTimeout(() => openTask(linkedEvent), 0); else setTimeout(() => openEvent(linkedEvent), 0); }
    if (evMode && !x.planDate && (action === 'ok' || action === 'add-evtask' || action === 'plan-evtasks' || action.startsWith('ev-task:'))) { e.preventDefault(); modal.querySelector('input[name=planDate]')?.focus(); return; }
    const wm = action.match(/^(w_|r(\d+)w_)(add|rm:(\d+))$/);
    if (wm) {
      const list = wm[2] != null ? (x.allRules[Number(wm[2])].windows = x.allRules[Number(wm[2])].windows || []) : (x.windows = x.windows || []);
      if (wm[3] === 'add') list.push({ days: list.length ? [] : [1, 2, 3, 4, 5], from: 540, to: 1020 }); else list.splice(Number(wm[4]), 1);
      again(); return;
    }
    if (action.startsWith('anchor:')) {
      const y = x.steps[Number(action.slice(7))];
      x.anchorStepId = x.anchorStepId === y.id ? null : y.id;
      again(); return;
    }
    if (action.startsWith('add-rule:')) {
      const stepId = action.slice(9) || null;
      x.allRules.push({ id: uid().slice(0, 6), when: stepId || helper ? 'failed' : 'planned', then: 'task', title: '', minutes: helper ? 15 : 10, place: stepId ? 'after' : 'before', stepId });
      again(`input[name=rti_${x.allRules.length - 1}]`); return;
    }
    if (action.startsWith('rm-rule:')) { x.allRules.splice(Number(action.slice(8)), 1); again(); return; }
    if (action === 'delete') {
      if (!confirm(t('confirmDeleteTask'))) { e.preventDefault(); return; }
      remove('tasks', x.id);
      // A one-off event goes from the plan entirely (past days too); a task keeps what was done.
      const oneOffEvent = evMode && !x.repeat;
      for (const b of live('blocks').filter((y) => y.taskId === x.id && (oneOffEvent || (!y.done && y.date >= today())))) deleteBlock(b);
      changed();
      return;
    }
    if (!x.title) { e.preventDefault(); return; }
    if (evMode) { x.due = x.planDate; x.allDay = x.planTime == null; x.eventTime = x.planTime; x.kind = 'event'; if (x.allDay) x.repeat = null; }
    const before = task ? Number(task.minutes) : null;
    const prevTask = task && get('tasks', task.id);
    let rec; let split = false;
    if (prevTask && isSeries(prevTask) && x.fromOcc && x.scope !== 'all' && x.fromOcc > (prevTask.seriesFrom || prevTask.due)) {
      split = true;
      // From this occurrence on: the series splits here.
      const { fromOcc, scope, planDate, planTime, planBlockId, allRules, ...fields } = x; void fromOcc; void scope; void planDate; void planTime; void planBlockId; void allRules;
      const tmp = saveTask({ ...x, id: prevTask.id }); // computes rules, steps and travel the usual way…
      const changes = { ...tmp }; delete changes.id; delete changes.createdAt;
      upsert('tasks', prevTask, { silent: true }); // …then the old series is put back and split
      rec = splitSeries(prevTask, changes, x.fromOcc);
      toast(t('seriesSplit', relDay(x.fromOcc)));
      void fields;
    } else {
      // A changed rule: the series restarts from the (new) due date.
      if (prevTask && isSeries(prevTask) && (prevTask.repeat !== x.repeat || (prevTask.every || 1) !== (x.every || 1) || JSON.stringify(prevTask.repeatDays || []) !== JSON.stringify(x.repeatDays || []) || prevTask.due !== x.due)) x.seriesFrom = x.due || today();
      rec = saveTask(x);
      // "I pick the time each week": no fixed series any more (occurrences already on the plan, or done, stay).
      if (rec.pickTime && rec.seriesTime != null) {
        for (const b of seriesBlocks(rec.id).filter((y) => !outcomeOf(y) && y.auto && y.date >= today())) remove('blocks', b.id);
        rec = upsert('tasks', { ...rec, seriesTime: null }, { silent: true });
      }
      if (isSeries(rec)) ensureSeries(rec);
    }
    // The "When" section: plan it, move it, change its length, or take it off the plan.
    if (!helper && !split && isSeries(rec) && rec.slotTimes && rec.repeat === 'weekly') {
      // (v66) a time for each day: only the week grid changes them; nothing to move here
    } else if (!helper && !split && isSeries(rec) && rec.seriesTime != null && x.planTime != null && x.planTime !== rec.seriesTime) {
      // A new time for a recurring task on the plan: the whole series moves (occurrences changed by hand keep theirs).
      rec = upsert('tasks', { ...rec, seriesTime: x.planTime }, { silent: true });
      ensureSeries(rec);
    } else if (evMode && x.allDay) {
      const cur = x.planBlockId && get('blocks', x.planBlockId);
      if (cur) deleteBlock(cur); // no time any more: the day's all-day row shows it
    } else if (!helper && !split) {
      const cur = x.planBlockId && get('blocks', x.planBlockId);
      if (x.planDate) {
        const off = anchorOffset(cur || null, rec);
        const at = x.planTime != null ? Math.max(0, x.planTime - off) : null;
        if (cur) {
          const moved = upsert('blocks', { ...cur, date: x.planDate, start: at ?? cur.start, minutes: rec.minutes !== before ? rec.minutes : cur.minutes, title: rec.title, auto: false }, { silent: true });
          followParent(moved);
          warnConflicts(get('blocks', moved.id));
        } else if (action !== 'plan') {
          const b = planTask(rec, x.planDate, at);
          toast(t('plannedToast', relDay(x.planDate), fmtTime(b.start + anchorOffset(b))));
          warnConflicts(get('blocks', b.id));
        }
      } else if (cur) deleteBlock(cur);
    }
    if (action.startsWith('edit-rule:')) {
      const r = x.allRules[Number(action.slice(10))];
      if (r?.taskId) setTimeout(() => openTask(get('tasks', r.taskId)), 0);
    }
    if (action.startsWith('ev-task:')) setTimeout(() => openTask(get('tasks', action.slice(8))), 0);
    if (action === 'add-evtask') setTimeout(() => openEventTaskAdd(get('tasks', rec.id), { back: true }), 0);
    if (action === 'plan-evtasks') { syncEventTasks(); planEventTasks(get('tasks', rec.id)); setTimeout(() => openTask(get('tasks', rec.id)), 0); }
    if (action === 'start-now') { const b = startTask(get('tasks', rec.id)); if (isPalestra(rec)) openPalestra(rec, b); afterStart(b); }
    if (action === 'use-usual') { const h = timeHistory(rec); if (h) { upsert('tasks', { ...get('tasks', rec.id), minutes: h.usual, lenSet: true }); setTimeout(() => openTask(get('tasks', rec.id)), 0); } }
    // (v66) "Quando…" and "Sposta": saved first, then the week grid; back to this sheet afterwards
    if (action === 'when' || action.startsWith('mv:')) {
      const id = rec.id; const blk = action.startsWith('mv:') ? get('blocks', action.slice(3)) : null;
      setTimeout(() => openWeekGrid(get('tasks', id), { block: blk, onClose: (how, k) => { if (how === 'quick') setWhen(get('tasks', id), k); openTask(get('tasks', id), null, how === 'more' ? { openSec: 'when' } : {}); } }), 0);
    }
    if (action === 'plan') {
      const date = x.planDate || (rec.due && rec.due > today() ? rec.due : today());
      const b = planTask(rec, date, x.planTime != null ? Math.max(0, x.planTime - anchorOffset(null, rec)) : null);
      toast(t('plannedToast', relDay(date), fmtTime(b.start)));
      location.hash = `#/plan/${date}`;
    }
    changed();
  });

  function collect(form) {
    x.title = form.elements.namedItem('title').value.trim();
    x.steps = x.steps.map((y, i) => {
      const minutes = readDur(form, `st_m_${i}`, lenOf(y));
      const rec = form[`st_r_${i}`]?.checked;
      const { from, ...rest } = y; void from;
      return { ...rest, title: form[`st_t_${i}`].value.trim(), minutes, ...(rec ? { from: 'recipes' } : {}) };
    });
    x.minutes = x.steps.length ? x.steps.reduce((n, y) => n + lenOf(y), 0) || 30 : readDur(form, 'minutes', x.minutes || 30);
    if (form.dayLen) { // (v71) a length for each day (only the ones that differ are kept)
      if (!form.dayLen.checked) x.dayMinutes = null;
      else { const dm = {}; for (const d of x.repeatDays || []) { const m = readDur(form, `dm_${d}`, (x.dayMinutes || {})[d] || x.minutes); if (m !== x.minutes) dm[d] = m; } x.dayMinutes = dm; }
    }
    if (form.checklist) x.checklist = lines(form.checklist.value);
    x.notes = form.notes.value.trim();
    if (form.importance) x.importance = Number(form.importance.value) || 3;
    if (form.place) { x.place = form.place.value.trim(); x.link = form.link.value.trim(); }
    if (form.tvThere) x.travel = { there: form.tvThere.checked, back: form.tvBack.checked, mode: form.tvMode.value || 'default' };
    if (form.buffer) x.buffer = form.buffer.value === '' ? null : Number(form.buffer.value) || 0;
    if (form.querySelector('[value="w_add"]')) x.windows = readWindows(form, 'w_', (x.windows || []).length);
    if (form.stepsPlan) { const v = form.stepsPlan.value; x.splitSteps = v === 'each'; x.keepTogether = v === 'together'; }
    if (form.routine) x.kind = form.routine.checked ? (isMealType(x) ? 'meal' : 'saved') : 'todo';
    if (form.evDays) {
      const when = form.evWhen.value;
      if (when === 'none') { x.eventId = null; x.eventOffset = null; } else {
        x.eventOffset = { days: Math.max(0, Number(form.evDays.value) || 0) * (form.evUnit.value === 'weeks' ? 7 : 1), when };
        const d = eventDate(linkedEvent); if (d) x.due = offsetDue(d, x.eventOffset);
      }
    }
    if (!helper && !evMode) collectWhen(form, x);
    // (v69) the short sheet: whether it's a routine follows the Quando choice (no separate switch any more)
    if (short && !isMealType(x) && ['todo', 'saved'].includes(x.kind || 'todo')) x.kind = x.whenMode === 'anytime' ? 'saved' : x.whenMode === 'once' ? 'todo' : x.kind || 'todo';
    if (!helper && evMode) {
      if (form.due) x.due = form.due.value || null;
      x.repeat = form.repeat.value || null;
      if (x.repeat === 'times' && form.timesN) { x.timesN = Math.max(1, Number(form.timesN.value) || 1); x.timesPer = form.timesPer.value || 'week'; }
      if (form.every) x.every = Math.max(1, Number(form.every.value) || 1);
      if (form.querySelector('input[name=repeatDays]')) x.repeatDays = [...form.querySelectorAll('input[name=repeatDays]:checked')].map((el) => Number(el.value));
      if (form.repeatUntil) x.repeatUntil = form.repeatUntil.value || null;
      if (form.scope) x.scope = form.querySelector('input[name=scope]:checked')?.value || 'following';
      x.planDate = form.planDate.value || '';
      x.planTime = form.planTime.value ? parseTime(form.planTime.value) : null;
    }
    if (form.elements.namedItem('when')) x.when = form.elements.namedItem('when').value || '';
    if (form.remind) { if (form.remind.value === '') delete x.remind; else x.remind = Number(form.remind.value); }
    if (form.querySelector('input[name="cats"]')) Object.assign(x, readCats(form, x));
    if (form.defaultStart) x.defaultStart = form.defaultStart.value ? parseTime(form.defaultStart.value) : null;
    if (form.meal && isSaved(x)) x.kind = form.meal.checked ? 'meal' : 'saved';
    x.allRules = x.allRules.map((r, i) => {
      const stepId = form[`rs_${i}`]?.value || null;
      const when = form[`rw_${i}`].value;
      const then = when === 'planned' ? 'task' : form[`rt_${i}`].value;
      if (then === 'groceries') return { id: r.id, when, then, stepId };
      const kind = form[`rk_${i}`].value;
      const places = when === 'planned' ? PREP_PLACES : RULE_PLACES;
      const place = places.includes(form[`rp_${i}`].value) ? form[`rp_${i}`].value : (when === 'planned' || r.when === 'planned' ? 'before' : 'next');
      const windows = form.querySelector(`[value="r${i}w_add"]`) ? readWindows(form, `r${i}w_`, (r.windows || []).length) : (r.windows || []);
      return { id: r.id, when, then, stepId, taskId: kind || null, title: kind ? get('tasks', kind)?.title : form[`rti_${i}`].value.trim(), minutes: readDur(form, `rm_${i}`, 30), place, windows };
    });
  }
  const form = modal.querySelector('form');
  form.addEventListener('change', (ev) => {
    if (ev.target.dataset.rerender) { collect(form); openTask(task, x, opts); return; }
    // Setting a time sets the best time of day to match.
    if (ev.target.name === 'planTime' || ev.target.name === 'defaultStart') {
      const m = parseTime(ev.target.value);
      const w = form.elements.namedItem('when');
      if (m != null && w) w.value = partOfDay(m);
    }
    if (ev.target.dataset.rule != null) ev.target.closest('.rule').classList.toggle('is-groceries', ev.target.value === 'groceries');
    if (ev.target.dataset.rulekind != null) ev.target.closest('.rule').querySelector('.rule-title').classList.toggle('hide', Boolean(ev.target.value));
  });
  // "Needs first": type to find a task (or make a new one) instead of scrolling a list of all of them.
  const needQ = form.querySelector('#need-q');
  if (needQ) {
    const box = form.querySelector('#need-list');
    const draw = () => {
      const q = needQ.value.trim();
      if (!q) { box.innerHTML = ''; return; }
      const hits = needCandidates.filter((y) => matchesQ(fold(y.title), q)).slice(0, 8);
      const exact = hits.some((y) => fold(y.title).trim() === fold(q));
      box.innerHTML = hits.map((y) => `<button class="need-opt" role="option" value="add-after:${esc(y.id)}" formnovalidate>${isStep(y) ? '↳ ' : ''}${esc(y.title)}</button>`).join('')
        + (exact ? '' : `<button class="need-opt new" role="option" value="new-after" formnovalidate>+ ${esc(t('newNeed', q))}</button>`);
    };
    needQ.addEventListener('input', draw);
    // Enter takes the first suggestion (and never saves the whole task by accident).
    needQ.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); box.querySelector('button')?.click(); } });
  }
  // Folding a section is remembered for next time.
  for (const d of form.querySelectorAll('details.ed-sec')) {
    d.addEventListener('toggle', () => { const k = short ? 'edSec2' : 'edSec'; saveSettings({ [k]: { ...(state.settings[k] || {}), [d.dataset.sec]: d.open } }); });
  }
}

export function remindField(x) {
  return `<label>🔔 ${esc(t('remind'))}<select name="remind"><option value="">${esc(t('remindUseDefault', remindLabel(remindDefault())))}</option>${REMINDS.map((m) => `<option value="${m}" ${x.remind === m ? 'selected' : ''}>${esc(remindLabel(m))}</option>`).join('')}</select>
    <small>${esc(get('gcal', 'status') ? t('remindViaGcal') : t('remindNeedsGcal'))}</small></label>`;
}

// Tasks a rule can add: your to-dos and small steps, not meal types, and not the task itself.
export function ruleTargets(x) {
  const used = new Set((x.allRules || []).map((r) => r.taskId).filter(Boolean));
  return live('tasks').filter((y) => used.has(y.id) || (y.id !== x.id && !isMealType(y) && !y.check && (!y.done || y.repeat)))
    .sort((a, b) => Number(isStep(b)) - Number(isStep(a)) || a.title.localeCompare(b.title));
}

export function saveTask(x) {
  const newStep = (title, minutes) => upsert('tasks', {
    id: uid(), createdAt: Date.now(), kind: 'step', title, minutes,
    category: x.category || null, checklist: [], rules: [], notes: '', done: false,
  }, { silent: true }).id;
  // A rule that adds a task needs one: drop the empty ones. A new name becomes a small task of its
  // own (listed under Preparations), so it can get a checklist and rules too: rules can chain.
  const all = (x.allRules || rulesForEditor(x)).filter((r) => r.then === 'groceries' || r.taskId || r.title);
  for (const r of all) if (r.then !== 'groceries' && !r.taskId) r.taskId = newStep(r.title, r.minutes || 10);
  for (const r of all) {
    // The length chosen here is the step's own length (for small steps, not for your to-dos).
    const tk = r.taskId && get('tasks', r.taskId);
    if (isStep(tk) && r.minutes && tk.minutes !== r.minutes && !(tk.steps || []).length) upsert('tasks', { ...tk, minutes: r.minutes }, { silent: true });
  }
  const prep = all.filter((r) => r.when === 'planned').map((r) => ({ taskId: r.taskId, when: r.place || 'before' }));
  const rules = all.filter((r) => r.when !== 'planned').map((r) => (r.then === 'groceries'
    ? { id: r.id, when: r.when, then: r.then, stepId: r.stepId || null }
    : { id: r.id, when: r.when, then: 'task', stepId: r.stepId || null, taskId: r.taskId, title: get('tasks', r.taskId)?.title || r.title, minutes: r.minutes, place: r.place, ...(['slots', 'pool'].includes(r.place) ? { windows: cleanWindows(r.windows) } : {}) }));
  x.allRules = all;
  let due = x.due || null;
  if (x.repeat && x.repeat !== 'times' && !due) due = today(); // "X times per…" counts per period, without a due date
  if (x.repeat === 'times') due = null;
  const seriesFrom = REPEATS.includes(x.repeat) ? (x.seriesFrom && x.seriesFrom <= due ? x.seriesFrom : due) : null;
  const { allRules, newTask, planDate, planTime, planBlockId, ...clean } = x;
  void allRules; void newTask; void planDate; void planTime; void planBlockId;
  const steps = (x.steps || []).filter((y) => y.title && !isTravelStep(y));
  const prevTask = x.id ? get('tasks', x.id) : null;
  const saved = upsert('tasks', withKind({
    ...clean, id: x.id || uid(), createdAt: x.createdAt || Date.now(), due, seriesFrom, prep, rules, steps, windows: cleanWindows(x.windows), after: (x.after || []).filter((id) => has('tasks', id)),
    minutes: steps.length ? steps.reduce((n, y) => n + (Number(y.minutes) || 0), 0) : x.minutes,
    priority: 0, done: Boolean(x.done), lenSet: true, // you saw the length: it counts as set
  }), { silent: true });
  return applyTravel(saved, { prev: prevTask || saved });
}

// A checklist that must be finished before something counts as done.
export function openChecklist(block) {
  const items = checklistOf(block);
  const draw = () => {
    const b = get('blocks', block.id);
    const checked = b.checked || [];
    const left = checklistLeft(items, checked);
    openModal(`
      <h2>☑ ${esc(b.title)}</h2>
      <p class="hint">${esc(left ? t('checklistFirst', left) : t('checklistReady'))}</p>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${checked[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>
      <div class="button-row">
        <button class="btn primary" value="done" ${left ? 'disabled' : ''}>${esc(t('markDone'))}</button>
        ${left ? `<button class="btn" value="all" formnovalidate>${esc(t('checkAll'))}</button>` : ''}
        <button class="btn" value="fail" formnovalidate>${esc(t('couldntDo'))}</button>
        <button class="btn" value="cancel">${esc(t('close'))}</button>
      </div>`, (form, action, e) => {
      if (action === 'all') { e.preventDefault(); upsert('blocks', { ...get('blocks', block.id), checked: items.map(() => true) }, { silent: true }); draw(); return; }
      if (action === 'fail') { setOutcome(get('blocks', block.id), 'failed'); changed(); return; }
      if (action === 'done') { setBlockDone(get('blocks', block.id), true); changed(); }
    });
    modal.querySelector('form').addEventListener('change', (ev) => {
      const i = ev.target.dataset.ci;
      if (i == null) return;
      const cur = get('blocks', block.id);
      const next = [...(cur.checked || [])];
      next[Number(i)] = ev.target.checked;
      upsert('blocks', { ...cur, checked: next }, { silent: true });
      draw();
    });
  };
  draw();
}

// Same for a task ticked off in the task list.
export function openTaskChecklist(task) {
  const draw = () => {
    const x = get('tasks', task.id);
    const items = x.checklist || [];
    const checked = x.checked || [];
    const left = checklistLeft(items, checked);
    openModal(`
      <h2>☑ ${esc(x.title)}</h2>
      <p class="hint">${esc(left ? t('checklistFirst', left) : t('checklistReady'))}</p>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${checked[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>
      <div class="button-row">
        <button class="btn primary" value="done" ${left ? 'disabled' : ''}>${esc(t('markDone'))}</button>
        ${left ? `<button class="btn" value="all">${esc(t('checkAll'))}</button>` : ''}
        <button class="btn" value="cancel">${esc(t('close'))}</button>
      </div>`, (form, action, e) => {
      if (action === 'all') { e.preventDefault(); upsert('tasks', { ...get('tasks', task.id), checked: items.map(() => true) }, { silent: true }); draw(); return; }
      if (action === 'done') { setTaskDone(get('tasks', task.id), true); changed(); }
    });
    modal.querySelector('form').addEventListener('change', (ev) => {
      const i = ev.target.dataset.ci;
      if (i == null) return;
      const cur = get('tasks', task.id);
      const next = [...(cur.checked || [])];
      next[Number(i)] = ev.target.checked;
      upsert('tasks', { ...cur, checked: next }, { silent: true });
      draw();
    });
  };
  draw();
}

export function openBlock(block, defaults = {}) {
  if ((block || defaults).kind === 'meal') { openMeal(block); return; }
  const isNew = !block;
  const b = block || { title: '', date: currentDate(), start: 9 * 60, minutes: 30, category: '', notes: '', done: false, ...defaults };
  const task = b.taskId && get('tasks', b.taskId);
  const parent = b.parentId && get('blocks', b.parentId);
  const items = checklistOf(b);
  const isShop = b.kind === 'groceries';
  const status = outcomeOf(b);
  // With steps, the time shown is when the anchor step starts (e.g. "Workout at 19:00"; getting there starts earlier).
  const off = !isNew && task ? anchorOffset(b, task) : 0;
  const anchorName = off ? anchorTitle(task) : null;
  // (v67) No "Blocco" heading, and how it went (Esito: Inizia · Fatto · Non riuscito) sits at the bottom
  // apart from editing it (Salva · Annulla · ⋯ with Duplica and Elimina). The classic layout keeps the old row.
  const esNew = !classic();
  const running = Boolean(b.startedAt && !b.endedAt);
  const nTimes = task?.repeatCount && status ? Number(task.repeatCount) : 0;
  // (v71) Apprendimento intelligente: this weekday keeps taking longer (or shorter): use that length?
  const lh = !isNew && !b.learnSeen && (status === 'done') ? learnHint(b) : null;
  const learn = lh ? `<div class="es-learn"><b>${esc(t(lh.longer ? 'lrLonger' : 'lrShorter', lh.iso))}</b><small>${esc(t('lrLast', lh.iso, lh.real.map((m) => fmtDur(m)).join(', ')))}</small>
    <button class="btn primary small" value="learn-yes" formnovalidate>${esc(t('lrUse', fmtDur(lh.minutes), lh.iso))}</button>
    <div class="es-row"><button class="btn small" value="learn-no" formnovalidate>${esc(t('lrKeep'))}</button><button class="btn small ghost" value="learn-never" formnovalidate>${esc(t('lrNever'))}</button></div></div>` : '';
  const cnt = nTimes ? (() => { const on = turnCounts(b); const n = countedOf(task); return `<div class="es-count"><span>${esc(t('countsFor', nTimes))}<small>${esc(on ? t('countsWill', n, nTimes) : t('countsStays', n, nTimes))}</small></span><button class="sw-btn${on ? ' on' : ''}" value="count-toggle" formnovalidate aria-pressed="${on}" aria-label="${esc(t('countsFor', nTimes))}"></button></div>`; })() : '';
  const esito = !esNew || isNew ? '' : `<div class="esito"><div class="es-q">${esc(t('esito'))}</div>${status === 'done' || status === 'partial'
    ? `<div class="es-state done"><span>✓ ${esc(b.endedAt ? `${t('esDoneLine')} · ${t('realOf', fmtDur(b.minutes), fmtDur(b.plannedMinutes || b.minutes))}` : t('esDoneLine'))}</span><button class="btn small" value="reset" formnovalidate>${esc(t('undo'))}</button></div>`
    : status === 'failed' ? `<div class="es-state fail"><span>✕ ${esc(t('esFailLine'))}</span><button class="btn small" value="reset" formnovalidate>${esc(t('undo'))}</button></div>`
    : running ? `<div class="es-state run"><span>⏱ ${esc(t('esRunning', Math.max(1, Math.round((Date.now() - b.startedAt) / 60000))))}</span></div><div class="es-row"><button class="btn primary" value="finish" formnovalidate>■ ${esc(t('esFinish'))}</button><button class="btn" value="fail" formnovalidate>✕ ${esc(t('esFail'))}</button></div>`
    : `<div class="es-row">${b.date === today() && !isShop ? `<button class="btn" value="block-start" formnovalidate>▶ ${esc(t(isPalestra(task) ? 'palStart' : 'esStart'))}</button>` : ''}<button class="btn primary" value="done" formnovalidate>✓ ${esc(t('esDone'))}</button><button class="btn" value="fail" formnovalidate>✕ ${esc(t('esFail'))}</button></div>`}${cnt}${learn}</div>`;
  openModal(`
    ${!esNew || isShop ? `<h2>${esc(isShop ? `🛒 ${t('groceryTitle')}` : isNew ? t('newBlock') : t('editBlock'))}</h2>` : ''}
    ${parent ? `<p class="hint">↳ ${esc(t('prepForBlock', parent.title, fmtTime(parent.start)))}</p>` : ''}
    ${status === 'failed' ? `<p class="conn bad">✕ ${esc(t('markedCouldnt'))}${b.missing?.length ? ` ${esc(t('missingWere', b.missing.join(', ')))}` : ''}</p>` : ''}
    ${isCheckStep(b) && !status ? `${hint('checkStepHint')}` : ''}
    ${isShop ? '' : `
      ${b.kind === 'prep' || isEvent(task) ? `<input type="hidden" name="taskId" value="${esc(b.taskId || '')}">` : `<input type="hidden" name="taskId" value="${esc(b.taskId || '')}">
      <details class="task-pick" ${isNew && !b.taskId ? 'open' : ''}><summary><span class="field-label">${esc(t('linkTask'))}</span> <span class="tp-cur">${esc(task ? task.title : t('noTaskLinked'))}</span></summary>
        ${taskPickList(b.taskId)}
        <button type="button" class="tp-item none" data-tp="" data-q="">${esc(t('noTaskLinked'))}</button></details>`}
      <label>${esc(t('title'))}<input name="title" value="${esc(b.title)}" autocomplete="off"></label>`}
      ${isEvent(task) ? `<p class="hint">📅 ${esc(t('blockOfEvent'))}</p>` : ''}
    <div class="three">
      <label>${esc(t('date'))}${dateBox(`<input name="date" type="date" required value="${esc(b.date)}">`, b.date)}</label>
      <label>${esc(anchorName ? t('anchorAt', anchorName) : t('start'))}<input name="start" ${TIME24} required value="${fmtTime(b.start + off)}"></label>
      <label>${esc(t('duration'))}${durField('minutes', b.minutes)}</label>
    </div>
    ${anchorName ? `<p class="hint">⚓ ${esc(t('blockAnchorHint', fmtTime(b.start), fmtTime(b.start + b.minutes)))}</p>` : ''}
    ${task?.place || task?.link ? `<p class="hint">${placeLink(task)}</p>` : ''}
    ${isShop ? shoppingSection(b) : ''}
    ${items.length && !isNew ? `<div class="field-label">${esc(t('checklist'))}</div>
      <ul class="list checklist">${items.map((it, i) => `<li><label><input type="checkbox" data-ci="${i}" ${(b.checked || [])[i] ? 'checked' : ''}><span class="item-text">${esc(it)}</span></label></li>`).join('')}</ul>` : ''}
    ${stepsSection(b)}
    ${isShop ? '' : `<div class="field-label">${esc(t('category'))}</div>${catChips(b.category)}`}
    <label>${esc(t('notes'))}<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
    <label class="check"><input type="checkbox" name="allowOverlap" ${b.allowOverlap ? 'checked' : ''}> ${esc(t('allowOverlap'))}</label>
    ${!esNew && !isNew && !status && !b.startedAt && b.date >= today() && !isShop ? `<button class="btn primary start-now" value="block-start" formnovalidate>▶ ${esc(t(isPalestra(task) ? 'palStart' : 'startNow'))}</button>` : ''}
    ${esNew ? '' : b.startedAt && !b.endedAt ? `<p class="hint">⏱ ${esc(t('timerRunning'))}</p>` : b.endedAt ? `<p class="hint">⏱ ${esc(t('realOf', fmtDur(b.minutes), fmtDur(b.plannedMinutes || b.minutes)))}</p>` : ''}
    ${isShop || isNew ? '' : task ? `<button class="btn small edit-task" value="edit-task" formnovalidate>${isEvent(task) ? '📅' : '▤'} ${esc(t(isEvent(task) ? 'editEventBtn' : 'editTaskSteps', task.title))}</button>`
    : `<button class="btn small edit-task" value="to-task" formnovalidate>▤ ${esc(t('makeTask'))}</button>`}
    ${esNew ? `<div class="bk-foot">${esito}<div class="button-row bk-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<details class="bk-more"><summary class="btn" aria-label="${esc(t('options'))}">⋯</summary><div class="bk-menu"><button class="btn ghost" value="dup" formnovalidate>⧉ ${esc(t('duplicate'))}</button><button class="btn ghost danger" value="delete" formnovalidate>🗑 ${esc(t('delete'))}</button></div></details>`}
    </div></div>` : `<div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      ${isNew ? '' : status ? `<button class="btn" value="reset" formnovalidate>${esc(t('reset'))}</button>` : `<button class="btn" value="fail" formnovalidate>${esc(t('couldntDo'))}</button>`}
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn" value="dup" formnovalidate>${esc(t('duplicate'))}</button>
      <button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`}`, (form, action, e) => {
    if (stepAction(b, action, e, openBlock)) return;
    // (v67) Esito: Fatto (a checklist or a rule may ask first) and Fine of a running timer
    if (action === 'done') {
      setTimeout(() => { const ok = trySetBlockDone(get('blocks', b.id), true); changed(); if (ok && !countToast(b.id)) toast(t('esDoneToast'), 5000, [{ label: t('undo'), run: () => { setOutcome(get('blocks', b.id), null); changed(); } }]); }, 0);
      return;
    }
    if (action === 'finish') { setTimeout(() => finishTimer(), 0); return; }
    if (action === 'learn-yes' || action === 'learn-no' || action === 'learn-never') {
      e.preventDefault();
      const h = learnHint(get('blocks', b.id));
      upsert('blocks', { ...get('blocks', b.id), learnSeen: true }, { silent: true });
      if (h && action === 'learn-yes') {
        const before = { ...h.task }; const blocks = live('blocks').filter((y) => y.taskId === h.task.id).map((y) => ({ ...y }));
        for (const y of live('blocks').filter((z) => z.taskId === h.task.id && !z.seriesId && z.kind !== 'prep' && !z.stepId && z.date > b.date && !outcomeOf(z) && isoDay(z.date) === h.iso)) upsert('blocks', { ...y, minutes: h.minutes }, { silent: true });
        ensureSeries(setDayMinutes(h.task, h.iso, h.minutes));
        changed();
        toast(t('dlDoneDay', h.iso, fmtDur(h.minutes)), 5000, [{ label: t('undo'), run: () => { upsert('tasks', before, { silent: true }); for (const y of blocks) upsert('blocks', y, { silent: true }); changed(); toast(t('undone')); } }]);
      }
      if (h && action === 'learn-never') upsert('tasks', { ...get('tasks', h.task.id), learnOff: [...(h.task.learnOff || []), 'all'] }, { silent: true });
      openBlock(get('blocks', b.id)); return;
    }
    if (action === 'count-toggle') { e.preventDefault(); setCounts(b.id, !turnCounts(get('blocks', b.id))); openBlock(get('blocks', b.id)); return; }
    if (action === 'block-start') { const nb = startBlock(get('blocks', b.id)); if (isPalestra(task)) openPalestra(task, nb); afterStart(nb); return; }
    if (action === 'edit-task') { setTimeout(() => openTask(get('tasks', task.id), null, { fromOcc: b.occ || null }), 0); return; }
    if (action === 'to-task') {
      // A plain block becomes a task (same title, length, category), so it can get steps and rules.
      const tk = upsert('tasks', { id: uid(), createdAt: Date.now(), kind: 'todo', title: b.title, minutes: b.minutes, category: b.category || null, importance: 3, due: null, repeat: null, notes: b.notes || '', done: false, checklist: [], rules: [], steps: [] }, { silent: true });
      upsert('blocks', { ...get('blocks', b.id), taskId: tk.id }, { silent: true });
      changed();
      setTimeout(() => openTask(tk, { ...tk, importance: 3, steps: [{ id: uid().slice(0, 6), title: '', minutes: 10 }], checklist: [], allRules: [] }), 0);
      return;
    }
    if (action === 'delete') {
      if (b.seriesId && task) {
        setTimeout(() => askScope({
          title: t('deleteWhich'), thisLabel: t('onlyThisOcc', relDay(b.occ)), followingLabel: t('thisAndFollowing'),
          onThis: () => { deleteBlock(b); upsert('tasks', { ...get('tasks', task.id), skipped: [...new Set([...(task.skipped || []), b.occ])] }, { silent: true }); changed(); },
          onFollowing: () => { endSeries(get('tasks', task.id), b.occ); changed(); },
        }), 0);
        return;
      }
      deleteBlock(b); changed(); return;
    }
    if (action === 'fail') { setOutcome(get('blocks', b.id), 'failed'); changed(); return; }
    if (action === 'reset') { setOutcome(get('blocks', b.id), null); changed(); return; }
    if (action === 'dup') {
      const at = Math.min(b.start + b.minutes, 1440 - b.minutes);
      // A one-off event is one block: its copy is an event of its own (same details, its own tasks later).
      const evTask = b.taskId && get('tasks', b.taskId);
      const copyOf = isEvent(evTask) && !evTask.repeat && !evTask.allDay
        ? upsert('tasks', { ...evTask, id: uid(), createdAt: Date.now(), due: b.date, eventTime: at + anchorOffset(b), done: false, doneAt: null }, { silent: true }) : null;
      newBlock({ ...b, id: uid(), start: at, done: false, outcome: null, templateId: null, checked: [], groceryId: null, sourceId: null, ...(copyOf ? { taskId: copyOf.id, stepState: {} } : {}) });
      changed();
      return;
    }
    const picked = form.taskId?.value ? get('tasks', form.taskId.value) : null;
    const titleInput = form.elements.namedItem('title'); // (form.title is the form's own title attribute)
    let title = titleInput ? titleInput.value.trim() : '';
    let category = form.category?.value || null;
    const minutes = readDur(form, 'minutes', b.minutes || 30);
    const shown = parseTime(form.start.value);
    // Back from "anchor time" to the block's start, with the new length (steps scale with it).
    const off2 = off && b.minutes ? Math.round(off * (minutes / b.minutes)) : 0;
    const rec = { ...b, id: b.id || uid(), date: form.date.value || b.date, start: shown != null ? Math.max(0, shown - off2) : b.start,
      minutes, notes: form.notes.value.trim(), allowOverlap: form.allowOverlap.checked };
    if (!isShop) {
      if (!title && picked) title = picked.title;
      if (!title) { e.preventDefault(); titleInput.focus(); return; }
      if (!category && picked) category = picked.category || null;
      Object.assign(rec, { title, category });
      if (form.taskId) rec.taskId = picked ? picked.id : null;
    }
    const finish = (r) => {
      const saved = upsert('blocks', r, { silent: true });
      followParent(saved);
      if (r.date !== currentDate()) location.hash = `#/plan/${r.date}`;
      changed();
      warnConflicts(get('blocks', saved.id));
    };
    const seriesChange = b.seriesId && task && !isNew && (rec.start !== b.start || rec.minutes !== b.minutes || rec.title !== b.title || (rec.category || null) !== (b.category || null));
    // (v71) only the length changed, on a routine of a few weekdays: all those weekdays, only this one, or all
    const onlyLen = (seriesChange || (b.pickOcc && task && !isNew)) && rec.minutes !== b.minutes && rec.start === b.start && rec.title === b.title && (rec.category || null) === (b.category || null) && rec.date === b.date && hasDayLen(task) && !realSteps(task).length;
    if (onlyLen) {
      e.preventDefault();
      setTimeout(() => askDayLen(task, b, rec, finish), 0);
      return;
    }
    if (seriesChange) {
      e.preventDefault();
      const occ = b.occ;
      setTimeout(() => askScope({
        title: t('changeWhich'), thisLabel: t('onlyThisOcc', relDay(occ)), followingLabel: t('thisAndFollowing'),
        onThis: () => finish({ ...rec, auto: false }),
        onFollowing: () => {
          const tk = get('tasks', task.id);
          const own = realSteps(tk).length ? ownMinutes(tk) : Math.max(5, rec.minutes - (tk.minutes - ownMinutes(tk)));
          const main = (tk.steps || []).map((y) => (y.main ? { ...y, minutes: own } : y));
          const upd = upsert('tasks', { ...tk, ...(rec.minutes !== b.minutes ? { dayMinutes: null } : {}), title: rec.title, category: rec.category || null, seriesTime: rec.start + off2, steps: main, minutes: realSteps(tk).length ? tk.minutes : main.reduce((n, y) => n + (Number(y.minutes) || 0), 0) || own }, { silent: true });
          // Earlier occurrences keep their time; this one and the later ones follow the series.
          for (const sb of seriesBlocks(tk.id).filter((y) => y.occ < occ && y.auto)) upsert('blocks', { ...sb, auto: false }, { silent: true });
          for (const sb of seriesBlocks(tk.id).filter((y) => y.occ >= occ && !outcomeOf(y))) upsert('blocks', { ...sb, auto: true }, { silent: true });
          ensureSeries(get('tasks', upd.id));
          finish({ ...get('blocks', rec.id), date: rec.date, notes: rec.notes, allowOverlap: rec.allowOverlap, auto: rec.date === b.date });
        },
      }), 0);
      return;
    }
    if (rec.date !== b.date || rec.start !== b.start) rec.auto = false;
    finish(rec);
  });
  wireSteps(b, openBlock);
  const form = modal.querySelector('form');
  // Picking a task fills in the hidden field and tells the form (title, length and category follow).
  const pickBox = form.querySelector('.task-pick');
  if (pickBox) {
    wirePicker(pickBox, (id) => {
      form.taskId.value = id;
      for (const el of pickBox.querySelectorAll('.tp-item')) el.classList.toggle('on', el.dataset.tp === id);
      pickBox.querySelector('.tp-cur').textContent = id ? get('tasks', id)?.title || '' : t('noTaskLinked');
      pickBox.open = false;
      form.taskId.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  // A trip's list: tapping an item's name ticks it too (at the shop, one tap either way).
  form.addEventListener('click', (ev) => {
    const nm = ev.target.closest('[data-action="sl-open"]');
    if (!nm) return;
    ev.preventDefault();
    const box = nm.closest('li')?.querySelector('[data-action="sl-toggle"]');
    if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  // Checklist items and shopping items are saved as you tick them.
  form.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.ci != null && !isNew) {
      const cur = get('blocks', b.id);
      const next = [...(cur.checked || [])];
      next[Number(el.dataset.ci)] = el.checked;
      upsert('blocks', { ...cur, checked: next }, { silent: true });
    }
    if (el.dataset.action === 'sl-toggle') { kitchen.setChecked(el.dataset.id, el.checked); el.closest('li').classList.toggle('checked', el.checked); }
    if (el.name === 'taskId') {
      const x = get('tasks', el.value);
      if (!x) return;
      form.querySelector('.tp-cur').textContent = x.title;
      const ti = form.elements.namedItem('title');
      if (ti && (!ti.value.trim() || isNew)) ti.value = x.title;
      if (isNew && x.minutes) { const inH = x.minutes >= 60 && x.minutes % 30 === 0; form.minutes.value = inH ? x.minutes / 60 : x.minutes; form.minutes_u.value = inH ? 'h' : 'min'; }
      if (x.category) form.category.value = x.category;
    }
  });
}

// Steps inside the block dialog: tick them, or mark one "couldn't do it".
export function stepsSection(b) {
  if (!b?.id || !has('blocks', b.id)) return '';
  const st = stepTimes(b);
  if (!st.length) return '';
  const whole = outcomeOf(b) === 'done';
  return `<div class="field-label">▤ ${esc(t('steps'))}</div>
    <ul class="list checklist steps-dlg">${st.map((y) => `<li class="${y.state || (whole ? 'done' : '')}"><label><input type="checkbox" data-sstep="${esc(y.id)}" ${y.state === 'done' || whole ? 'checked' : ''}>
      <span class="item-text">${esc(y.title)}<small>${esc(range(y.start, y.end - y.start))}${y.state === 'failed' ? ` · ${esc(t('couldnt'))}` : ''}</small></span></label>
      ${y.state === 'failed' ? `<button class="btn small ghost" value="step-reset:${esc(y.id)}" formnovalidate>${esc(t('reset'))}</button>`
    : y.state || whole ? '' : `<button class="btn small ghost" value="step-fail:${esc(y.id)}" formnovalidate title="${esc(t('couldntDo'))}">✕ ${esc(t('couldnt'))}</button>`}</li>`).join('')}</ul>`;
}
export function stepAction(b, action, e, reopen) {
  if (!/^step-(fail|reset):/.test(action)) return false;
  e.preventDefault();
  const [kind, sid] = action.split(':');
  setStepOutcome(get('blocks', b.id), sid, kind === 'step-fail' ? 'failed' : null);
  changed();
  if (modal.querySelector('[data-sstep]')) reopen(get('blocks', b.id));
  return true;
}
export function wireSteps(b, reopen) {
  if (!b?.id) return;
  modal.querySelector('form').addEventListener('change', (ev) => {
    const sid = ev.target.dataset.sstep;
    if (!sid) return;
    const ok = tryStep(get('blocks', b.id), sid, ev.target.checked);
    changed();
    if (ok) reopen(get('blocks', b.id));
  });
}

export function shoppingSection(b = null) {
  if (!ricetteConfigured() && !live('shopping').length) return '';
  const items = (b ? tripItems(b) : shoppingItems()).sort((x, y) => Number(x.checked) - Number(y.checked) || (x.name || '').localeCompare(y.name || ''));
  if (!items.length) return `${hint('listEmpty')}`;
  return `<div class="field-label">${esc(t('shoppingList'))}</div>
    <div class="trip-list">${tripRowsHtml(items)}</div>
    ${hint('shopHint')}`;
}

export function openTemplatesMenu() {
  const date = currentDate();
  const list = templates();
  openModal(`
    <h2>${esc(t('templates'))}</h2>
    <p class="hint">${esc(t('templatesMenuHint', fmtDay(date)))}</p>
    ${list.length ? `<ul class="list">${list.map((tp) => `<li><span class="item-text pad">${esc(tp.name)}<small>${esc(t('nBlocks', (tp.blocks || []).length))}</small></span>
      <button class="btn small" value="apply:${esc(tp.id)}">${esc(t('apply'))}</button></li>`).join('')}</ul>` : `${hint('noTemplates')}`}
    <div class="button-row">
      ${blocksOn(date).length ? `<button class="btn" value="save-day">${esc(t('saveDayAsTemplate'))}</button>` : ''}
      <button class="btn" value="new">+ ${esc(t('newTemplate'))}</button>
      <button class="btn ghost" value="cancel">${esc(t('close'))}</button>
    </div>`, (form, action) => {
    if (action.startsWith('apply:')) {
      const tp = get('templates', action.slice(6));
      const n = applyTemplate(tp, date);
      toast(t('appliedN', n));
      changed();
    } else if (action === 'save-day') {
      const blocks = blocksOn(date).filter((b) => !b.kind || b.kind === 'meal').map((b) => ({
        start: b.start, minutes: b.minutes, title: b.title, category: b.category || null, ...(b.taskId ? { taskId: b.taskId } : {}),
        ...(b.kind === 'meal' ? { kind: 'meal', servings: b.servings, recipes: mealRecipes(b) } : {}),
      }));
      setTimeout(() => openTemplate(null, { name: fmtDay(date, { weekday: 'long' }), blocks }), 0);
    } else if (action === 'new') setTimeout(() => openTemplate(null), 0);
  });
}

export function openTemplate(tpl, preset = {}) {
  const isNew = !tpl;
  const x = tpl || { name: '', blocks: [], days: [], ...preset };
  const nameOf = (id) => catName(get('categories', id)) || id;
  openModal(`
    <h2>${esc(isNew ? t('newTemplate') : t('editTemplate'))}</h2>
    <label>${esc(t('name'))}<input name="name" required value="${esc(x.name)}" autocomplete="off" placeholder="${esc(t('templateNamePh'))}"></label>
    <label>${esc(t('templateBlocks'))}<textarea name="lines" rows="9" spellcheck="false" placeholder="07:00-07:30 ${esc(t('exampleBlock'))} #${esc(nameOf('health'))}">${esc(formatTemplateLines(x.blocks || [], nameOf))}</textarea>
      ${small('templateLinesHint')}</label>
    <div class="field-label">${esc(t('autoApply'))}</div>
    <div class="days">${weekdayNames().map(([wd, n]) => `<label class="day-pill"><input type="checkbox" name="day" value="${wd}" ${(x.days || []).includes(wd) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    ${hint('autoApplyHint')}
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action) => {
    if (action === 'delete') { if (confirm(t('confirmDeleteTemplate'))) { remove('templates', x.id); changed(); } return; }
    // Keep links (to a task, or a recipe) for lines whose title didn't change. Lines named
    // exactly like a task with preparations or a checklist get linked to it.
    const prev = x.blocks || [];
    const blocks = parseTemplateLines(form.lines.value).map((b) => {
      const was = prev.find((p) => p.title === b.title && (p.taskId || p.kind));
      const named = !was && openTasks().concat(live('tasks').filter((y) => y.repeat)).find((y) => y.title.toLowerCase() === b.title.toLowerCase() && (y.prep?.length || y.checklist?.length));
      const out = { ...b, category: findCategory(b.category) };
      if (was?.taskId) out.taskId = was.taskId;
      else if (named) out.taskId = named.id;
      if (was?.kind === 'meal') Object.assign(out, { kind: 'meal', servings: was.servings, recipes: mealRecipes(was) });
      return out;
    });
    const days = [...form.querySelectorAll('input[name=day]:checked')].map((i) => Number(i.value));
    upsert('templates', { ...x, id: x.id || uid(), name: form.name.value.trim(), blocks, days }, { silent: true });
    changed();
  });
}

export function openCategory(cat) {
  const isNew = !cat;
  const used = new Set(live('categories').map((c) => c.color));
  const c = cat || { name: '', color: PALETTE.find((p) => !used.has(p)) || PALETTE[0] };
  openModal(`
    <h2>${esc(isNew ? t('newCategory') : t('editCategory'))}</h2>
    <label>${esc(t('name'))}<input name="name" ${isNew ? 'required' : ''} value="${esc(c.name || '')}" placeholder="${esc(catName(c))}" autocomplete="off"></label>
    <label>${esc(t('color'))}<input name="color" type="color" value="${esc(c.color)}"></label>
    <div class="button-row">
      <button class="btn primary" value="ok">${esc(t('save'))}</button>
      <button class="btn" value="cancel" formnovalidate>${esc(t('cancel'))}</button>
      ${isNew ? '' : `<button class="btn danger" value="delete" formnovalidate>${esc(t('delete'))}</button>`}
    </div>`, (form, action) => {
    if (action === 'delete') { if (confirm(t('confirmDeleteCategory'))) { remove('categories', c.id); changed(); } return; }
    upsert('categories', { ...c, id: c.id || uid(), name: form.name.value.trim(), color: form.color.value, order: c.order ?? 50 }, { silent: true });
    changed();
  });
}

// ---------- smart: suggest a plan / I have some time ----------

export function openSpare(minutes = null) {
  const date = today();
  const now = nowMinutes();
  const next = busyOn(date).filter((b) => !b.done && b.start > now).sort((a, b) => a.start - b.start)[0];
  const untilNext = next ? Math.floor((next.start - now) / 5) * 5 : null;
  const X = minutes || (untilNext && untilNext >= 10 ? Math.min(untilNext, 240) : 30);
  const tasks = candidates(live('tasks'), plannedTaskIds(), date);
  const res = spareTime({ tasks, minutes: X, date, leadOf });
  const name = (id) => esc(get('tasks', id)?.title);
  const choices = [...new Set([15, 30, 45, 60, 90, 120, ...(untilNext && untilNext >= 10 && untilNext <= 240 ? [untilNext] : [])])].sort((a, b) => a - b);
  openModal(`
    <h2>⏱ ${esc(t('haveTimeTitle'))}</h2>
    ${next && untilNext >= 10 ? `<p class="hint">${esc(t('untilNext', fmtDur(untilNext), next.title, fmtTime(next.start)))}</p>` : ''}
    <div class="days">${choices.map((m) => `<button class="pill ${m === X ? 'on' : ''}" value="min:${m}" formnovalidate>${fmtDur(m)}</button>`).join('')}</div>
    ${res.singles.length ? `<ul class="list sugg">${res.singles.map((x) => `<li><span class="item-text pad">${name(x.taskId)}<small>${esc(fmtDur(x.minutes))}${x.reasons.length ? ` · ${esc(reasonText(x.reasons))}` : ''}</small></span>
      <button class="btn small primary" value="do:${esc(x.taskId)}">${esc(t('doIt'))}</button></li>`).join('')}</ul>` : `<p class="empty">${esc(t('nothingFits'))}</p>`}
    ${res.combo ? `<div class="field-label">${esc(t('orCombo'))}</div>
      <ul class="list sugg"><li><span class="item-text pad">${res.combo.map((x) => name(x.taskId)).join(' + ')}<small>${esc(fmtDur(res.combo.reduce((s, x) => s + x.minutes, 0)))}</small></span>
      <button class="btn small" value="combo">${esc(t('doAll'))}</button></li></ul>` : ''}
    ${res.starts.length ? `<div class="field-label">${esc(t('makeStart'))}</div>
      <ul class="list sugg">${res.starts.map((x) => `<li><span class="item-text pad">${name(x.taskId)}<small>${esc(t('ofTotal', fmtDur(X), fmtDur(x.minutes)))}${x.reasons.length ? ` · ${esc(reasonText(x.reasons))}` : ''}</small></span>
      <button class="btn small" value="start:${esc(x.taskId)}">${esc(t('start'))}</button></li>`).join('')}</ul>` : ''}
    <div class="button-row"><button class="btn" value="cancel">${esc(t('close'))}</button></div>`, (form, action, e) => {
    if (action.startsWith('min:')) { e.preventDefault(); openSpare(Number(action.slice(4))); return; }
    const at = Math.ceil(nowMinutes() / 5) * 5;
    const doTask = (id, from, extra = {}) => {
      const task = get('tasks', id);
      const b = planTask(task, date, from + (extra.partial ? 0 : leadOf(task)), extra);
      return b.start + b.minutes;
    };
    if (action.startsWith('do:')) doTask(action.slice(3), at);
    else if (action === 'combo') { let from = at; for (const x of res.combo) from = doTask(x.taskId, from); }
    else if (action.startsWith('start:')) doTask(action.slice(6), at, { minutes: X, partial: true });
    location.hash = '#/plan';
    changed();
  });
}
