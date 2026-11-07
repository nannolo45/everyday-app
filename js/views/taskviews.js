// views/taskviews.js (v112): Da fare's other views, chosen in its view menu (viewmenu.js).
// Kanban: the things by state (to plan · planned · to mark · done) or by category. Matrice: importance (★) × urgency
// (the deadline). Abitudini: the routines as a grid, a square a day (only in a list of routines).
import { catColor, catName, catsOf, esc, relDay } from '../core.js';
import { t } from '../i18n.js';
import { outcomeOf } from '../model.js';
import { addDays, fmtDur, fmtTime, nowMinutes, parseDate, today } from '../plan.js';
import { get, live, state } from '../store.js';
import { vmSeg } from '../viewmenu.js';

export const TVIEWS = ['list', 'kanban', 'matrix', 'habit'];
const ICON = { list:'☰', kanban:'▥', matrix:'⊞', habit:'▦' };
export const taskView = () => (TVIEWS.includes(state.settings.taskView) ? state.settings.taskView : 'list');
export function tvItems(routineList) {
  return TVIEWS.map((k) => ({ k, icon:`<span class="pv-ic" aria-hidden="true">${ICON[k]}</span>`, label:t(`tv_${k}`), sub:t(`tv_${k}Sub`), off:k === 'habit' && !routineList ? t('tv_habitOff') : '' }));
}
export function tvOptions(k) {
  if (k === 'kanban') return vmSeg(t('tv_cols'), 'tv-kby', state.settings.kanbanBy === 'cat' ? 'cat' : 'state', [['state', t('tv_byState')], ['cat', t('tv_byCat')]]);
  if (k === 'matrix') return vmSeg(t('tv_urgent'), 'tv-urg', state.settings.urgDays === 7 ? 7 : 2, [[2, t('tv_2d')], [7, t('tv_1w')]]);
  if (k === 'habit') return vmSeg(t('tv_days'), 'tv-hdays', state.settings.habitDays === 14 ? 14 : 7, [[7, '7'], [14, '14']]);
  return '';
}

// ---------- the state of a thing, from its blocks ----------
const blocksOf = (x) => live('blocks').filter((b) => b.taskId === x.id && !b.deleted && !b.stepId && b.kind !== 'prep');
const isOver = (b, td = today()) => b.date < td || (b.date === td && b.start + (b.minutes || 0) <= nowMinutes());
export function stateOf(x) {
  if (x.done) return 'done';
  const bs = blocksOf(x); const td = today();
  if (bs.some((b) => !outcomeOf(b) && isOver(b, td))) return 'pend';
  if (bs.some((b) => !outcomeOf(b) && !isOver(b, td))) return 'planned';
  return 'toplan';
}
const pendBlock = (x) => blocksOf(x).filter((b) => !outcomeOf(b) && isOver(b)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
const nextBlock = (x) => blocksOf(x).filter((b) => !outcomeOf(b) && !isOver(b)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start))[0];
const colorOf = (x) => catColor(catsOf(x)[0]) || 'var(--line)';
function card(x, st) {
  const pb = st === 'pend' ? pendBlock(x) : null; const nb = st === 'planned' ? nextBlock(x) : null;
  const meta = [fmtDur(x.minutes || 30), pb ? `${relDay(pb.date)} ${fmtTime(pb.start)}` : nb ? `${relDay(nb.date)} ${fmtTime(nb.start)}` : x.due ? t('kbDue', relDay(x.due)) : '', catsOf(x)[0] ? catName(get('categories', catsOf(x)[0])) : ''].filter(Boolean).join(' · ');
  const acts = pb ? `<span class="kb-a"><button type="button" data-action="behind-done" data-id="${esc(pb.id)}">✓ ${esc(t('esDone'))}</button><button type="button" data-action="behind-fail" data-id="${esc(pb.id)}" title="${esc(t('esFail'))}" aria-label="${esc(t('esFail'))}">✕</button></span>` : '';
  return `<div class="kb-c${st === 'pend' ? ' pend' : ''}${st === 'done' ? ' done' : ''}" style="--c:${esc(colorOf(x))}"><button type="button" class="kb-t" data-action="task-view" data-id="${esc(x.id)}">${st === 'done' ? '✓ ' : ''}${esc(x.title)}<small>${esc(meta)}</small></button>${acts}</div>`;
}
const col = (title, list, st, extra = '') => `<section class="kb-col${extra}"><h4>${esc(title)}<span>${list.length}</span></h4>${list.slice(0, 40).map((x) => card(x, st || stateOf(x))).join('') || `<p class="kb-e">—</p>`}${list.length > 40 ? `<p class="kb-e">${esc(t('nMore', list.length - 40))}</p>` : ''}</section>`;

export function kanbanHtml(list, done) {
  const open = list.filter((x) => !x.done);
  if (state.settings.kanbanBy === 'cat') {
    const by = new Map(); for (const x of open) { const c = catsOf(x)[0] || ''; if (!by.has(c)) by.set(c, []); by.get(c).push(x); }
    return `<div class="kb">${[...by.entries()].map(([c, l]) => col(c ? catName(get('categories', c)) : t('noCategory'), l, null)).join('')}</div>`;
  }
  const g = { toplan:[], planned:[], pend:[] }; for (const x of open) g[stateOf(x)]?.push(x);
  const fin = [...done, ...list.filter((x) => x.done)].slice(0, 30);
  return `<div class="kb">${col(t('kb_toplan'), g.toplan, 'toplan')}${col(t('kb_planned'), g.planned, 'planned')}${col(t('kb_pend'), g.pend, 'pend', ' warn')}${col(t('kb_done'), fin, 'done')}</div><p class="hint kb-hint">${esc(t('kb_hint'))}</p>`;
}

export function matrixHtml(list) {
  const td = today(); const days = state.settings.urgDays === 7 ? 7 : 2;
  const urgent = (x) => Boolean(x.due && x.due <= addDays(td, days)); const imp = (x) => (x.importance || 3) >= 4;
  const open = list.filter((x) => !x.done);
  const Q = [['m_do', open.filter((x) => imp(x) && urgent(x))], ['m_plan', open.filter((x) => imp(x) && !urgent(x))], ['m_quick', open.filter((x) => !imp(x) && urgent(x))], ['m_drop', open.filter((x) => !imp(x) && !urgent(x))]];
  const q = ([k, l]) => `<section class="mx-q mx-${k}"><h4>${esc(t(k))}<span>${l.length}</span></h4><p>${esc(t(`${k}Sub`))}</p>${l.slice(0, 30).map((x) => card(x, stateOf(x))).join('') || '<p class="kb-e">—</p>'}</section>`;
  return `<div class="mx"><span></span><span class="mx-ax">${esc(t('m_urgent'))}</span><span class="mx-ax">${esc(t('m_notUrgent'))}</span><span class="mx-ax v">${esc(t('m_important'))}</span>${q(Q[0])}${q(Q[1])}<span class="mx-ax v">${esc(t('m_less'))}</span>${q(Q[2])}${q(Q[3])}</div><p class="hint kb-hint">${esc(t('m_hint', days))}</p>`;
}

export function habitHtml(list) {
  const rts = list.filter((x) => x.repeat && !x.archived).slice(0, 12); if (!rts.length) return `<p class="empty">${esc(t('vwEmpty'))}</p>`;
  const N = state.settings.habitDays === 14 ? 14 : 7; const td = today(); const days = Array.from({ length:N }, (_, i) => addDays(td, i - N + 2)); // up to tomorrow
  const by = new Map(rts.map((x) => [x.id, blocksOf(x)]));
  const cell = (x, d) => {
    const bs = by.get(x.id).filter((b) => b.date === d); if (!bs.length) return '<span class="hb-k n"></span>';
    const o = bs.map(outcomeOf); const c = esc(colorOf(x));
    if (o.includes('done')) return `<span class="hb-k y" style="--c:${c}">✓</span>`;
    if (o.includes('failed')) return `<span class="hb-k x" style="--c:${c}">✕</span>`;
    const pb = bs.find((b) => !outcomeOf(b) && isOver(b));
    if (pb) return `<button type="button" class="hb-k p" style="--c:${c}" data-action="behind-done" data-id="${esc(pb.id)}" title="${esc(t('hb_mark'))}">?</button>`;
    return `<span class="hb-k f" style="--c:${c}">·</span>`;
  };
  const streak = (x) => { let n = 0; for (let d = addDays(td, -1); n < 365; d = addDays(d, -1)) { const bs = by.get(x.id).filter((b) => b.date === d); if (!bs.length) { if (n || d < addDays(td, -14)) break; continue; } if (bs.some((b) => outcomeOf(b) === 'done')) n++; else break; } if (by.get(x.id).some((b) => b.date === td && outcomeOf(b) === 'done')) n++; return n; };
  return `<div class="hb" style="grid-template-columns:76px repeat(${rts.length},minmax(44px,1fr))"><span></span>${rts.map((x) => `<button type="button" class="hb-h" data-action="routine-open" data-id="${esc(x.id)}" style="color:${esc(colorOf(x))}">${esc(x.title)}<small>🔥 ${streak(x)}</small></button>`).join('')}
    ${days.map((d) => `<span class="hb-d${d === td ? ' td' : ''}">${esc(parseDate(d).toLocaleDateString(undefined, { weekday:'short', day:'numeric' }))}</span>${rts.map((x) => cell(x, d)).join('')}`).join('')}</div>
    <p class="hint kb-hint">${esc(t('hb_hint'))}</p>`;
}
