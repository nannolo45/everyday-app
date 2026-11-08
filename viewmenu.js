// js/viewmenu.js (v112): one header for every section, in the same order everywhere.
// 1 · the section's title, and where you are (‹ date › Oggi, or how many things)   — on the right: 3 · the view ▾
// 2 · the scope as tabs under it (Giorno · Settimana · Mese, or Da fare's lists)
// 4 · the actions, in a row under the tabs, only where there are some
// The view button opens the views as tabs and, under the one you're on, its options; «Usa …» switches, keys 1–n too.
import { esc, ui } from './core.js';
import { t } from './i18n.js';

// p: the prefix of the actions and of the state (pv = Planner, tv = Da fare, rv = Resoconto)
export function viewMenu({ p, cur, items, opts = () => '', extra = '', title = t('vm_title') }) {
  const open = Boolean(ui[`${p}Open`]); const tab = items.some((i) => i.k === ui[`${p}Tab`]) ? ui[`${p}Tab`] : cur;
  const T = items.find((i) => i.k === tab) || items[0]; const C = items.find((i) => i.k === cur) || items[0];
  return `<span class="pv-wrap"><button type="button" class="btn small pv-btn${open ? ' on' : ''}" data-action="${p}-open" aria-expanded="${open}" title="${esc(title)}">${C.icon} ${esc(C.label)}${extra} ▾</button>
    ${open ? `<div class="pv-pop" role="dialog" aria-label="${esc(title)}"><div class="pv-tabs" role="tablist" style="grid-template-columns:repeat(${items.length},1fr)">${items.map((it, i) => `<button type="button" role="tab" class="${tab === it.k ? 'on' : ''}${it.off ? ' off' : ''}" aria-selected="${tab === it.k}" data-action="${p}-tab" data-id="${it.k}" title="${esc(`${it.label} (${i + 1})`)}">${it.icon}<span>${esc(it.label)}</span>${cur === it.k ? '<i aria-hidden="true">●</i>' : ''}</button>`).join('')}</div>
      <p class="pv-sub">${esc(T.sub)}${cur === tab ? ` · <b>${esc(t('pv_inUse'))}</b>` : ''}${T.off ? ` · <b class="pv-offw">${esc(T.off)}</b>` : ''}</p>
      ${opts(tab) || `<p class="pv-note">${esc(t('pv_noOpts'))}</p>`}
      ${cur === tab || T.off ? '' : `<button type="button" class="btn primary pv-use" data-action="${p}-use" data-id="${tab}">${esc(t('pv_use', T.label))}</button>`}
      <small class="pv-note">${esc(t('vm_keys', items.length))}</small></div>` : ''}</span>`;
}
// a row of options inside the view menu: a label and a small segmented choice
export const vmSeg = (lab, act, cur, choices) => `<div class="pv-r"><span>${esc(lab)}</span><div class="mp-seg">${choices.map(([id, l]) => `<button type="button" class="${String(cur) === String(id) ? 'on' : ''}" data-action="${act}" data-id="${id}">${esc(l)}</button>`).join('')}</div></div>`;

// tabs: [{ label, n, on, action, id, cls, foot }]
// (v113) The tabs are no longer a strip that scrolls sideways: one button shows the one you're on (and, with pickSub,
// what it shows), and opens a sheet with all of them. «foot» ones (✎ Viste) go at the bottom of the sheet.
// (v117) titlePick: the title itself is the view you're on (▾ opens the views), and the view menu joins the actions' row.
export function pageHead({ title, where = '', menu = '', tabs = [], acts = '', after = '', pickSub = '', pickTitle = '', pickHint = '', titlePick = false }) {
  const items = tabs.filter((x) => !x.foot); const foot = tabs.filter((x) => x.foot);
  const cur = items.find((x) => x.on) || items[0]; const open = Boolean(ui.phOpen);
  const n = (x, on) => (x.n ? `<i class="${on ? 'on' : ''}">${esc(String(x.n))}</i>` : '');
  const pick = cur ? `<div class="ph-pickw"><button type="button" class="ph-pick${open ? ' on' : ''}" data-action="ph-open" aria-haspopup="dialog" aria-expanded="${open}">
      <span class="ph-pick-t"><b>${esc(cur.label)}${cur.n ? ` · ${esc(String(cur.n))}` : ''}</b>${pickSub ? `<small>${esc(pickSub)}</small>` : ''}</span>
      ${pickHint ? `<span class="ph-pick-h">${esc(pickHint)}</span>` : ''}<span class="ph-pick-c" aria-hidden="true">▾</span></button>
    ${open ? `<div class="ph-sheet-bg" data-action="ph-open"></div><div class="ph-sheet" role="dialog" aria-label="${esc(pickTitle || title)}"><div class="ph-grab" aria-hidden="true"></div>
      ${pickTitle ? `<div class="ph-sheet-t">${esc(pickTitle)}</div>` : ''}
      ${items.map((x) => `<button type="button" class="ph-opt${x.on ? ' on' : ''}${x.cls ? ` ${x.cls}` : ''}" aria-current="${Boolean(x.on)}" data-action="${x.action}" data-id="${esc(x.id)}"><span class="ph-opt-l">${esc(x.label)}</span>${n(x, x.on)}<span class="ph-opt-ck" aria-hidden="true">${x.on ? '✓' : ''}</span></button>`).join('')}
      ${foot.length ? `<div class="ph-sheet-sep"></div>${foot.map((x) => `<button type="button" class="ph-opt ph-foot" data-action="${x.action}" data-id="${esc(x.id)}">${esc(x.label)}</button>`).join('')}` : ''}</div>` : ''}</div>` : '';
  if (titlePick && cur) {
    const sheet = pick.slice(pick.indexOf('</button>') + 9, pick.lastIndexOf('</div>'));
    return `<header class="ph ph-tp"><div class="ph-row"><div class="ph-pickw"><h1 class="ph-t"><button type="button" class="ph-tbtn${open ? ' on' : ''}" data-action="ph-open" aria-haspopup="dialog" aria-expanded="${open}" title="${esc(pickSub)}">${esc(cur.label)} <span class="ph-tc" aria-hidden="true">▾</span></button></h1>${sheet}</div>${where ? `<span class="ph-where">${where}</span>` : ''}</div>
    <div class="ph-acts ph-tbar">${acts}${menu}</div>${after}</header>`;
  }
  return `<header class="ph"><div class="ph-row"><h1 class="ph-t">${esc(title)}</h1>${where ? `<span class="ph-where">${where}</span>` : ''}<span class="ph-sp"></span>${menu}</div>
    ${pick}
    ${acts ? `<div class="ph-acts">${acts}</div>` : ''}${after}</header>`;
}
