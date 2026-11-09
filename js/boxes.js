// boxes.js (v121): things in boxes — «Riquadri». One box per category, per when (routines · with a due date ·
// planned · no date) or per length (≤ 15 min · 30 min · 45 min–1h · longer). Used by the Planner's pane (what's
// still to plan; a tap picks it and its free time lights up) and by Da fare's «Riquadri» view (a tap opens it).
// A box shows its first few; «+ altre n» opens it across the whole width. Per durata says how long the next free
// stretch is and lights the boxes that fit in it; «Altro buco ›» goes to the next one.
import { catColor, catName, categories, esc, relDay, ui } from './core.js';
import { t } from './i18n.js';
import { addDays, fmtDur, fmtTime, today } from './plan.js';
import { get, state } from './store.js';
import { freeStretches } from './views/planner.js';

export const BX_MODES = ['cat', 'when', 'len'];
// scope: the setting that keeps the choice (the pane and Da fare each keep their own)
export const bxMode = (scope) => (BX_MODES.includes(state.settings[scope]) ? state.settings[scope] : scope === 'paneBox' ? 'when' : 'cat');
const BANDS = [(m) => m <= 15, (m) => m > 15 && m <= 30, (m) => m > 30 && m <= 60, (m) => m > 60];

// An entry: { key, title, minutes, cat, kind: 'turn'|'due'|'planned'|'none', when, tag, rep, act, drag, on }
// act: the button's data attributes; drag: the row's (for dragging it onto the plan); cls: more classes (' fit').
function rowHtml(e, dot) {
  return `<li class="bx-r${e.on ? ' on' : ''}${e.cls || ''}"${e.drag || ''}><button type="button" class="bx-b" ${e.act}${e.on ? ' aria-pressed="true"' : ''}>${dot ? `<i class="bx-dot" style="--c:${esc(catColor(e.cat) || 'var(--line)')}" aria-hidden="true"></i>` : ''}<span class="bx-t">${esc(e.title)}</span><span class="bx-m">${e.rep ? '<b class="bx-rep" aria-hidden="true">↻</b>' : ''}${e.tag ? `<b class="bx-tag">${esc(e.tag)}</b>` : ''}<span>${esc(fmtDur(e.minutes || 30))}</span></span></button></li>`;
}
function boxHtml(key, title, color, list, { dot = true, max = 6, full = false, ring = false, dim = false, sub = null } = {}) {
  const open = Boolean(ui.bxOpen?.[key]); const shown = open ? list : list.slice(0, max);
  const tot = list.reduce((n, e) => n + (e.minutes || 30), 0);
  return `<section class="bx${open || full ? ' full' : ''}${ring ? ' ring' : ''}${dim ? ' dim' : ''}" style="--c:${esc(color)}"><header class="bx-h"><b>${esc(title)}</b><small>${esc(sub ?? `${list.length} · ${fmtDur(tot) || '0m'}`)}</small></header>
    ${list.length ? `<ul class="bx-l">${shown.map((e) => rowHtml(e, dot)).join('')}</ul>` : `<p class="bx-e">${esc(t('bx_empty'))}</p>`}
    ${list.length > max ? `<button type="button" class="bx-more" data-action="bx-open" data-id="${esc(key)}" aria-expanded="${open}">${esc(open ? t('bx_less') : t('bx_more', list.length - max))}</button>` : ''}</section>`;
}
// The free stretches of today and tomorrow, for Per durata.
function gaps() {
  const td = today(); const tm = addDays(td, 1);
  return [...freeStretches(td).map((g) => ({ ...g, date: td })), ...freeStretches(tm).map((g) => ({ ...g, date: tm }))].filter((g) => g.min >= 15);
}
export function boxesHtml(entries, { scope, max = 6 } = {}) {
  const mode = bxMode(scope);
  const seg = `<div class="bx-seg" role="tablist">${BX_MODES.map((k) => `<button type="button" role="tab" aria-selected="${mode === k}" class="${mode === k ? 'on' : ''}" data-action="bx-mode" data-id="${k}" data-scope="${esc(scope)}">${esc(t(`bx_${k}`))}</button>`).join('')}</div>`;
  let boxes = ''; let banner = '';
  if (mode === 'cat') {
    const order = categories().map((c) => c.id);
    const by = new Map(); for (const e of entries) { const c = e.cat || ''; if (!by.has(c)) by.set(c, []); by.get(c).push(e); }
    const keys = [...by.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    boxes = keys.map((c) => boxHtml(`${scope}:c:${c}`, c ? catName(get('categories', c)) : t('noCategory'), catColor(c) || 'var(--muted)', by.get(c), { dot: false, max })).join('');
  } else if (mode === 'when') {
    const g = { turn: [], due: [], planned: [], none: [] };
    for (const e of entries) (g[e.kind] || g.none).push(e);
    const byWhen = (a, b) => ((a.when || '9') < (b.when || '9') ? -1 : (a.when || '9') > (b.when || '9') ? 1 : 0);
    g.due.sort(byWhen); g.planned.sort(byWhen);
    boxes = [g.turn.length ? boxHtml(`${scope}:w:turn`, t('bx_rout'), 'var(--muted)', g.turn, { max: Math.min(max, 5) }) : '',
      g.due.length ? boxHtml(`${scope}:w:due`, t('bx_due'), 'var(--warn)', g.due, { max: Math.min(max, 5) }) : '',
      g.planned.length ? boxHtml(`${scope}:w:planned`, t('bx_planned'), 'var(--accent)', g.planned, { max: Math.min(max, 5) }) : '',
      boxHtml(`${scope}:w:none`, t('bx_nodate'), 'var(--muted)', g.none, { full: true, max: max + 2 })].join('');
  } else {
    const gs = gaps(); const gap = gs.length ? gs[(ui.bxGap || 0) % gs.length] : null;
    const room = gap ? gap.min : Infinity;
    const lists = BANDS.map((f) => entries.filter((e) => f(e.minutes || 30)));
    const fitIdx = gap ? lists.reduce((k, l, j) => (l.some((e) => (e.minutes || 30) <= room) ? j : k), -1) : -1;
    const nFit = gap ? entries.filter((e) => (e.minutes || 30) <= room).length : 0;
    banner = gap ? `<div class="bx-gap"><span><b>${esc(t('bx_gap', relDay(gap.date), fmtTime(gap.start), fmtDur(gap.min)))}</b><small>${esc(t('bx_gapSub', nFit))}</small></span>${gs.length > 1 ? `<button type="button" class="linkish" data-action="bx-gap">${esc(t('bx_nextGap'))}</button>` : ''}</div>` : `<p class="hint bx-nogap">${esc(t('bx_noGap'))}</p>`;
    const order = categories().map((c) => c.id); const byCat = (a, b) => (order.indexOf(a.cat) + 1 || 999) - (order.indexOf(b.cat) + 1 || 999);
    boxes = lists.map((l, j) => { const fits = !gap || l.some((e) => (e.minutes || 30) <= room);
      return boxHtml(`${scope}:l:${j}`, t(`bx_b${j}`), fits ? 'var(--accent)' : 'var(--muted)', [...l].sort(byCat), { max: Math.min(max, 5), ring: j === fitIdx, dim: !fits }); }).join('');
  }
  return `<div class="bx-wrap">${seg}${banner}<div class="bx-grid">${boxes}</div></div>`;
}
