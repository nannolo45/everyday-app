// timefield.js (v115): a time field (input.time24) selects the part you tap — the hours, or the minutes if you tap
// them — so you can type at once: «1» «9» → 19:00 and on to the minutes. ↑ ↓ change by 1 hour or 5 minutes,
// ← → or «:» move between the two; ⌫ empties the field (then it's typed as before, digits only).
// Works with phone keyboards too (beforeinput carries the digit where keydown doesn't).
const HM = /^(\d{1,2}):(\d{2})$/;
const fmt = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
function select(el, seg) {
  el.dataset.seg = seg; el.dataset.typed = '';
  const [a, b] = seg === 'm' ? [el.value.indexOf(':') + 1, el.value.length] : [0, el.value.indexOf(':')];
  const go = () => { try { el.setSelectionRange(a, b); } catch { /* gone */ } };
  go(); requestAnimationFrame(go); setTimeout(go, 30); // phones move the caret after focus
}
const smart = (el) => el?.classList?.contains('time24') && HM.test(el.value);
function tapped(el) {
  if (!smart(el)) { delete el.dataset.seg; return; }
  const p = el.selectionStart ?? 0; const colon = el.value.indexOf(':');
  select(el, p > colon && p < el.value.length ? 'm' : 'h'); // past the end counts as the hours: the first part first
}
document.addEventListener('pointerup', (e) => { const el = e.target; if (smart(el)) setTimeout(() => tapped(el), 0); }, true);
document.addEventListener('focusin', (e) => { const el = e.target; if (smart(el)) setTimeout(() => { if (document.activeElement === el && !el.dataset.seg) select(el, 'h'); }, 0); }, true);
// a value set by the keys isn't a «change» for the browser: tell the page once, when you leave the field
document.addEventListener('focusout', (e) => { const el = e.target; if (!el?.dataset) return; delete el.dataset.seg; if (el.dataset.touched) { delete el.dataset.touched; el.dispatchEvent(new Event('change', { bubbles: true })); } }, true);
function put(el, digit) {
  const [, hs, ms] = HM.exec(el.value); let h = Number(hs), m = Number(ms);
  const typed = (el.dataset.typed || '') + digit;
  if (el.dataset.seg === 'h') {
    h = Math.min(23, Number(typed)); el.value = fmt(h, m);
    if (typed.length >= 2 || Number(typed) > 2) { select(el, 'm'); } else { el.dataset.typed = typed; select(el, 'h'); el.dataset.typed = typed; }
  } else {
    m = Math.min(59, Number(typed)); el.value = fmt(h, m);
    if (typed.length >= 2 || Number(typed) > 5) { select(el, 'm'); } else { select(el, 'm'); el.dataset.typed = typed; }
  }
  el.dataset.touched = '1';
}
document.addEventListener('beforeinput', (e) => {
  const el = e.target; if (!el.dataset?.seg || !smart(el)) return;
  if (e.inputType === 'insertText' && /^\d$/.test(e.data || '')) { e.preventDefault(); put(el, e.data); return; }
  if (e.inputType === 'insertText' && /^[:.]$/.test(e.data || '')) { e.preventDefault(); select(el, 'm'); return; }
  if (e.inputType?.startsWith('delete')) { e.preventDefault(); el.value = ''; delete el.dataset.seg; el.dispatchEvent(new Event('input', { bubbles: true })); }
}, true);
document.addEventListener('keydown', (e) => {
  const el = e.target; if (!el.dataset?.seg || !smart(el) || e.ctrlKey || e.metaKey || e.altKey) return;
  const [, hs, ms] = HM.exec(el.value); let h = Number(hs), m = Number(ms); const seg = el.dataset.seg;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const d = e.key === 'ArrowUp' ? 1 : -1; if (seg === 'h') h = (h + d + 24) % 24; else m = (m + 5 * d + 60) % 60; el.value = fmt(h, m); select(el, seg); el.dataset.touched = '1'; }
  else if (e.key === 'ArrowRight' && seg === 'h') { e.preventDefault(); select(el, 'm'); }
  else if (e.key === 'ArrowLeft' && seg === 'm') { e.preventDefault(); select(el, 'h'); }
}, true);
