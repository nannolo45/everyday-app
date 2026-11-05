// views/giornata.js (v91): Today's «Giornata» page. What matters today at a glance, kept up to date all day:
// sections that fold to one line, a time column on the left, the red line for now, and what's done struck
// through. «Oggi in breve» (the key moments: appointments, going out, Palestra, a meal with recipes, each with
// its «esci» row), «Da preparare» (preparation blocks, checklists and to-dos tied to today's moments, missing
// ingredients), and optional ones chosen in «✎ Sezioni»: Scadenze, Spazi liberi, Routine da fissare,
// Spesa di oggi, Domani. The order and which are on: settings.giSecs; folded or open: on this device (ui).
import { esc, planSettings, relDay, ui } from '../core.js';
import { t } from '../i18n.js';
import { isEvent } from '../kinds.js';
import { blocksOn, checklistLeft, checklistOf, eventTasksOf, isApptLike, legTimes, mealRecipes, missingForMeal, openTasks, outcomeOf, plannedTaskIds, timedEventsOn, busyOn } from '../model.js';
import { isPalestra } from '../palestra.js';
import { addDays, fmtDur, fmtTime, nowMinutes, today } from '../plan.js';
import { get, live, saveSettings, state } from '../store.js';
import { todayRows, todayStripHtml } from '../weekpick.js';
import { openModal } from '../widgets.js';
import { SH } from './shop.js';

export const SECTIONS = ['brief', 'prep', 'due', 'free', 'rout', 'shop', 'tmr'];
const OFF_BY_DEFAULT = ['shop'];
export function giSecs() {
  const saved = (state.settings.giSecs || []).filter((s) => SECTIONS.includes(s?.id));
  const out = [...saved];
  for (const id of SECTIONS) if (!out.some((s) => s.id === id)) out.push({ id, on: !OFF_BY_DEFAULT.includes(id) });
  return out;
}
const secName = (id) => t(`gi_${id}`);

// ---------- what the day is made of ----------
const iconOf = (b, x) => (b.isEvent ? '📅' : isPalestra(x) ? '🏋' : b.kind === 'meal' ? '🍽' : isApptLike(x) ? '📅' : x?.place ? '📍' : '•');
// The key moments: calendar appointments, your appointments, anything with a place or a trip, Palestra, meals with recipes.
export function keyMoments(date, now = date === today() ? nowMinutes() : -1) {
  const evs = timedEventsOn(date).filter((e) => !e.skipped).map((e) => ({ id: e.id, ev: true, start: e.start, end: e.start + (e.minutes || 0), leave: null, title: e.title, ic: '📅', sub: e.location || '', done: e.start + (e.minutes || 0) <= now, noOut: false }));
  const own = blocksOn(date).filter((b) => b.kind !== 'prep' && !b.stepId).flatMap((b) => {
    const x = b.taskId ? get('tasks', b.taskId) : null;
    const lg = legTimes(b);
    const key = isApptLike(x) || Boolean(x?.place) || isPalestra(x) || (b.kind === 'meal' && mealRecipes(b).length > 0) || (lg && lg.trip > 0);
    if (!key) return [];
    const st = lg && lg.trip > 0 ? lg.start : b.start; const out = outcomeOf(b);
    return [{ id: b.id, b, x, start: st, end: b.start + (b.minutes || 0), leave: lg && lg.trip > 0 ? lg.leave : null, title: b.title, ic: iconOf(b, x), sub: x?.place && !isPalestra(x) ? x.place.split(',')[0] : '', done: Boolean(out), failed: out === 'failed', noOut: !out && b.start + (b.minutes || 0) <= now }];
  });
  return [...evs, ...own].sort((a, b) => (a.leave ?? a.start) - (b.leave ?? b.start));
}
// Everything else of the day: how much is done, how long is left.
function otherBlocks(date, keys) {
  const ids = new Set(keys.map((k) => k.id));
  return blocksOn(date).filter((b) => b.kind !== 'prep' && !b.stepId && !ids.has(b.id));
}
// What to get ready, each by when it's needed.
export function prepItems(date, keys) {
  const out = [];
  for (const b of blocksOn(date).filter((y) => y.kind === 'prep')) out.push({ id: `pb_${b.id}`, by: b.start, ic: '🧾', title: b.title, sub: '', done: outcomeOf(b) === 'done', tick: { action: 'now-done', id: b.id } });
  for (const k of keys.filter((y) => y.b)) {
    const by = k.leave ?? k.start;
    const cl = checklistOf(k.b);
    if (cl.length) {
      const left = cl.filter((_, i) => !(k.b.checked || [])[i]);
      out.push({ id: `cl_${k.id}`, by, ic: '☑', title: t('giChecklist', k.title), sub: left.length ? left.join(', ') : t('giAllChecked'), done: checklistLeft(cl, k.b.checked) === 0, tick: { action: 'gi-cl', id: k.b.id } });
    }
    if (k.x && isEvent(k.x)) for (const y of eventTasksOf(k.x.id).filter((z) => !z.done || (z.doneAt && today(new Date(z.doneAt)) === date)).filter((z) => !z.due || z.due <= date)) {
      out.push({ id: `et_${y.id}`, by, ic: '•', title: y.title, sub: t('giFor', k.title), done: Boolean(y.done), check: y.id });
    }
    if (k.b.kind === 'meal' && !k.done) {
      const miss = missingForMeal(k.b);
      if (miss.length) out.push({ id: `mm_${k.id}`, by: k.b.start, ic: '🧺', title: t('giMissing', miss.slice(0, 3).map((m) => m.name).join(', ') + (miss.length > 3 ? ` +${miss.length - 3}` : '')), sub: t('giFor', k.title), done: false, open: k.b.id });
    }
  }
  return out.sort((a, b) => a.by - b.by);
}
// Due today or tomorrow (or late) and not on the plan.
function dueItems(td, skip = new Set()) {
  const tm = addDays(td, 1); const planned = plannedTaskIds();
  return openTasks().filter((x) => x.due && x.due <= tm && !planned.has(x.id) && !x.travelRole && !skip.has(x.id)).sort((a, b) => a.due.localeCompare(b.due));
}
// The free gaps left today (15 minutes or more).
function freeGaps(td, now) {
  const s = planSettings(); let from = Math.max(s.dayStart, Math.ceil(now / 5) * 5); const out = [];
  const busy = busyOn(td).map((b) => [b.start, b.start + (b.minutes || 0)]).sort((a, b) => a[0] - b[0]);
  for (const [a, z] of busy) { if (a - from >= 15) out.push([from, a]); from = Math.max(from, z); }
  if (s.dayEnd - from >= 15) out.push([from, s.dayEnd]);
  return out;
}

// ---------- the page ----------
const row = (time, ic, title, sub = '', { cls = '', right = '', action = '', id = '' } = {}) => {
  const inner = `<span class="gi-t">${time}</span><span class="gi-c">${ic ? `<span class="gi-i" aria-hidden="true">${ic}</span>` : ''}<span class="gi-x"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></span>${right ? `<span class="gi-r">${right}</span>` : ''}`;
  return action ? `<button type="button" class="gi-row ${cls}" data-action="${action}" data-id="${esc(id)}">${inner}</button>` : `<div class="gi-row ${cls}">${inner}</div>`;
};
const nowLine = (now) => `<div class="gi-now" aria-label="${esc(t('nowLabel'))}"><span>${fmtTime(now)}</span></div>`;
function section(id, { count = '', summary = '', body = '' }) {
  const def = id === 'tmr' ? nowMinutes() >= 19 * 60 : ['brief', 'prep'].includes(id);
  const open = ui.giOpen?.[id] ?? def;
  return `<section class="card gi-sec${open ? ' open' : ''}" data-sec="${id}"><button type="button" class="gi-sh" data-action="gi-sec" data-id="${id}" aria-expanded="${open}"><span>${esc(secName(id))}</span><span class="gi-cnt">${count}</span><span class="gi-chev" aria-hidden="true">${open ? '▾' : '›'}</span></button>${open ? `<div class="gi-sb">${body}</div>` : `<p class="gi-sum">${summary}</p>`}</section>`;
}
function briefSec(td, now, keys, others) {
  const rows = []; let lined = false;
  for (const k of keys) {
    if (!lined && (k.leave ?? k.start) > now) { rows.push(nowLine(now)); lined = true; }
    if (k.leave != null) rows.push(row(fmtTime(k.leave), '🚶', esc(t('giLeave', k.title)), '', { cls: `gl${now >= k.leave || k.done ? ' done' : ''}` }));
    const sub = [k.noOut ? `<span class="gi-warn">${esc(t('giNoOutcome'))}</span>` : '', k.failed ? esc(t('couldnt')) : '', esc(k.sub)].filter(Boolean).join(' · ');
    rows.push(row(fmtTime(k.start), k.ic, esc(k.title), sub, { cls: `${k.done ? 'done' : ''}${!k.done && k.start <= now && now < k.end ? ' cur' : ''}`, right: k.done ? '✓' : fmtDur(k.end - k.start), action: k.ev ? 'event' : 'open-block', id: k.id }));
  }
  if (!lined) rows.push(nowLine(now));
  const oDone = others.filter((b) => outcomeOf(b)).length;
  // (v92) what's left from now: a long block already running counts only its rest
  const rest = (a, z) => Math.max(0, z - Math.max(a, now));
  const left = [...keys.filter((k) => !k.done && !k.ev).map((k) => rest(k.start, k.end)), ...others.filter((b) => !outcomeOf(b)).map((b) => rest(b.start, b.start + (b.minutes || 0)))].reduce((a, b) => a + b, 0);
  rows.push(row('', '⏳', esc(left ? t('giLeft', fmtDur(left)) : t('giNothingLeft')), `${others.length ? `${esc(t('giOthersDone', oDone, others.length))} · ` : ''}<a href="#/plan">${esc(t('tabPlan'))} ›</a>`, { cls: 'sum' }));
  const nx = keys.find((k) => !k.done && (k.leave ?? k.start) > now) || keys.find((k) => !k.done);
  return section('brief', { count: keys.length ? `${keys.filter((k) => k.done).length}/${keys.length}` : '', summary: nx ? `${esc(t('giNext'))} <b>${fmtTime(nx.start)} ${esc(nx.title)}</b>${nx.leave != null && now < nx.leave ? ` · <span class="leave">${esc(t('leaveAt', fmtTime(nx.leave)))}</span>` : ''}` : esc(keys.length ? t('giAllDone') : t('giNoKey')), body: rows.join('') });
}
function prepSec(now, preps) {
  if (!preps.length) return '';
  const rows = []; let lined = false;
  for (const p of preps) {
    if (!lined && p.by > now) { rows.push(nowLine(now)); lined = true; }
    const late = !p.done && p.by <= now;
    const tick = p.check ? `<input type="checkbox" class="gi-ck" data-action="task-done" data-id="${esc(p.check)}" ${p.done ? 'checked' : ''} aria-label="${esc(t('markDone'))}">`
      : p.tick ? `<button type="button" class="gi-ck${p.done ? ' on' : ''}" data-action="${p.tick.action}" data-id="${esc(p.tick.id)}" aria-label="${esc(t('markDone'))}" ${p.done && p.tick.action === 'now-done' ? 'disabled' : ''}>${p.done ? '✓' : ''}</button>`
      : `<button type="button" class="gi-ck open" data-action="open-block" data-id="${esc(p.open)}" aria-label="${esc(p.title)}">›</button>`;
    rows.push(`<div class="gi-row${p.done ? ' done' : ''}"><span class="gi-t${late ? ' late' : ''}">${fmtTime(p.by)}</span><span class="gi-c">${tick}<span class="gi-x"><b>${p.ic} ${esc(p.title)}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span></span></div>`);
  }
  if (!lined) rows.push(nowLine(now));
  const nx = preps.find((p) => !p.done);
  return section('prep', { count: `${preps.filter((p) => p.done).length}/${preps.length}`, summary: nx ? `${esc(t('giNext'))} <b>${esc(nx.title)}</b> · ${esc(t('giBy', fmtTime(nx.by)))}` : esc(t('giReady')), body: rows.join('') });
}
function dueSec(td, preps = []) {
  const list = dueItems(td, new Set(preps.map((p) => p.check).filter(Boolean))); // not twice: already in Da preparare
  if (!list.length) return '';
  const day = (d) => (d < td ? t('giLate') : relDay(d));
  return section('due', { count: String(list.length), summary: `<b>${esc(list[0].title)}</b> · ${esc(day(list[0].due))}`,
    body: list.map((x) => row(esc(day(x.due)), x.onDay ? '📌' : '⏳', esc(x.title), esc(fmtDur(x.minutes || 30)), { right: `<button type="button" class="btn small" data-action="plan-task" data-id="${esc(x.id)}" data-date="${td}">${esc(t('today'))}</button>`, cls: x.due < td ? 'late' : '' })).join('') });
}
function freeSec(td, now) {
  const gaps = freeGaps(td, now); if (!gaps.length) return '';
  const tot = gaps.reduce((s, [a, z]) => s + z - a, 0);
  return section('free', { count: String(gaps.length), summary: `<b>${esc(fmtDur(tot))}</b> · ${esc(t('giFreeNext', fmtTime(gaps[0][0])))}`,
    body: gaps.map(([a, z]) => row(fmtTime(a), '⏱', esc(t('freeUntil', fmtDur(z - a), fmtTime(z))), '', { right: `<button type="button" class="btn small" data-action="spare">${esc(t('giUse'))}</button>` })).join('') });
}
function shopSec() {
  const items = live(SH()).filter((i) => !i.checked); if (!items.length) return '';
  return section('shop', { count: String(items.length), summary: `<b>${esc(t('giToBuy', items.length))}</b>`,
    body: `${row('', '🛒', esc(t('giToBuy', items.length)), esc(items.slice(0, 4).map((i) => i.name).join(', ') + (items.length > 4 ? ' …' : '')))}<a class="gi-link" href="#/shop">${esc(t('vw_shop'))} ›</a>` });
}
function tmrSec(td) {
  const tm = addDays(td, 1); const keys = keyMoments(tm, -1);
  const rows = keys.flatMap((k) => [...(k.leave != null ? [row(fmtTime(k.leave), '🚶', esc(t('giLeave', k.title)), '', { cls: 'gl' })] : []), row(fmtTime(k.start), k.ic, esc(k.title), esc(k.sub), { action: k.ev ? 'event' : 'open-block', id: k.id })]);
  const preps = prepItems(tm, keys).filter((p) => !p.done);
  if (preps.length) rows.push(row('', '🌙', esc(t('giTonight')), esc(preps.map((p) => p.title).join(' · ')), { cls: 'sum' }));
  const first = keys[0];
  return section('tmr', { count: keys.length ? String(keys.length) : '', summary: first ? `${esc(t('giFirst'))} <b>${fmtTime(first.start)} ${esc(first.title)}</b>${first.leave != null ? ` · <span class="leave">${esc(t('leaveAt', fmtTime(first.leave)))}</span>` : ''}` : esc(t('giNoKey')), body: rows.length ? rows.join('') : `<p class="gi-sum">${esc(t('giNoKey'))}</p>` });
}
function routSec() { const { rows, weekOn } = todayRows(); ui.weekRows = rows; ui.weekOn = weekOn; return todayStripHtml({ rows, weekOn }); }
// The whole Giornata page; also what the progress bar counts.
export function giornataHtml(td = today()) {
  const now = nowMinutes();
  const keys = keyMoments(td, now); const others = otherBlocks(td, keys); const preps = prepItems(td, keys);
  const n = keys.length + others.length + preps.length;
  const d = keys.filter((k) => k.done).length + others.filter((b) => outcomeOf(b)).length + preps.filter((p) => p.done).length;
  const mk = { brief: () => briefSec(td, now, keys, others), prep: () => prepSec(now, preps), due: () => dueSec(td, preps), free: () => freeSec(td, now), rout: routSec, shop: shopSec, tmr: () => tmrSec(td) };
  return `<div class="gi-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${d}"><i style="width:${n ? Math.round((d / n) * 100) : 0}%"></i></div>
    ${giSecs().filter((s) => s.on).map((s) => mk[s.id]()).join('')}
    <button type="button" class="linkish gi-edit" data-action="gi-secs">✎ ${esc(t('giSections'))}</button>`;
}
export const dayCount = (td = today()) => { const now = nowMinutes(); const keys = keyMoments(td, now); const others = otherBlocks(td, keys); const preps = prepItems(td, keys); return { n: keys.length + others.length + preps.length, d: keys.filter((k) => k.done).length + others.filter((b) => outcomeOf(b)).length + preps.filter((p) => p.done).length }; };
// For Adesso: the next thing to prepare, and tomorrow once today is over.
export function nextPrep(td = today()) { const now = nowMinutes(); return prepItems(td, keyMoments(td, now)).find((p) => !p.done && p.by >= now - 60) || null; }
export const tomorrowHtml = (td = today()) => tmrSec(td);
export function nextPrepHtml(td = today()) {
  const p = nextPrep(td); if (!p) return '';
  const tick = p.check ? `<input type="checkbox" class="gi-ck" data-action="task-done" data-id="${esc(p.check)}" aria-label="${esc(t('markDone'))}">` : p.tick ? `<button type="button" class="gi-ck" data-action="${p.tick.action}" data-id="${esc(p.tick.id)}" aria-label="${esc(t('markDone'))}"></button>` : `<button type="button" class="gi-ck open" data-action="open-block" data-id="${esc(p.open)}" aria-label="${esc(p.title)}">›</button>`;
  return `<div class="gi-strip"><span class="gi-i" aria-hidden="true">${p.ic}</span><span class="gi-x"><b>${esc(t('giPrepBy', fmtTime(p.by), p.title))}</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span>${tick}</div>`;
}

// ✎ Sezioni: which sections, in which order (drag ⠿).
export function openSections(redraw) {
  const draw = () => {
    const l = giSecs();
    openModal(`<h2>✎ ${esc(t('giSections'))}</h2><p class="hint">${esc(t('giSectionsHint'))}</p>
      <ul class="list vw-ul" data-sortable="gisecs">${l.map((s) => `<li class="vw-li" data-sort-key="${s.id}"><button type="button" class="drag-handle vw-grip" aria-label="${esc(t('dragToMove'))}">⠿</button><label class="check"><input type="checkbox" data-sec="${s.id}" ${s.on ? 'checked' : ''}><span>${esc(secName(s.id))}</span></label></li>`).join('')}</ul>
      <div class="button-row"><button class="btn primary" value="cancel">${esc(t('doneBtn'))}</button></div>`, () => {}, { cls: 'sheet' });
    const form = document.querySelector('dialog[open] form');
    form.addEventListener('change', (e) => { const id = e.target.dataset.sec; if (!id) return; saveSettings({ giSecs: giSecs().map((s) => (s.id === id ? { ...s, on: e.target.checked } : s)) }); redraw(); });
    form.addEventListener('sorted', (e) => { const cur = giSecs(); saveSettings({ giSecs: e.detail.keys.map((k) => cur.find((s) => s.id === k)).filter(Boolean) }); redraw(); });
  };
  draw();
}
