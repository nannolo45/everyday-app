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

// tabs: [{ label, n, on, action, id, cls }]
export function pageHead({ title, where = '', menu = '', tabs = [], acts = '', after = '' }) {
  return `<header class="ph"><div class="ph-row"><h1 class="ph-t">${esc(title)}</h1>${where ? `<span class="ph-where">${where}</span>` : ''}<span class="ph-sp"></span>${menu}</div>
    ${tabs.length ? `<div class="ph-tabs" role="tablist">${tabs.map((x) => `<button type="button" role="tab" class="${x.on ? 'on' : ''}${x.cls ? ` ${x.cls}` : ''}" aria-selected="${Boolean(x.on)}" data-action="${x.action}" data-id="${esc(x.id)}">${esc(x.label)}${x.n ? `<i>${esc(String(x.n))}</i>` : ''}${x.badge || ''}</button>`).join('')}</div>` : ''}
    ${acts ? `<div class="ph-acts">${acts}</div>` : ''}${after}</header>`;
}
