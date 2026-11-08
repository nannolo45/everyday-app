// js/kbdrag.js (v118): Kanban cards dragged between columns, with a mouse (press and move) or a finger (hold for a
// moment, then move, so scrolling still works). Dropped in «Pianificate» a thing goes to the first free time; in «Da
// pianificare» its open turns come off the plan; in «Fatte» it's marked done. By category: it takes that category.
import { relDay, toast } from './core.js';
import { t } from './i18n.js';
import { deleteBlock, outcomeOf, setTaskDone } from './model.js';
import { fmtTime, nowMinutes, today } from './plan.js';
import { planSoon } from './planning.js';
import { changed } from './shell.js';
import { get, live, upsert } from './store.js';

const HOLD_MS = 320;
let d = null; let suppressClick = false;

const isOver = (b, td) => b.date < td || (b.date === td && b.start + (b.minutes || 0) <= nowMinutes());
const openBlocks = (id) => { const td = today(); return live('blocks').filter((b) => b.taskId === id && !b.deleted && !b.stepId && b.kind !== 'prep' && !outcomeOf(b) && !isOver(b, td)); };
const canDrop = (from, to) => Boolean(to) && to !== from && to !== 'pend' && from.startsWith('cat:') === to.startsWith('cat:');

export function dropCard(id, from, to) {
  let x = get('tasks', id); if (!x || !canDrop(from, to)) return false;
  if (to.startsWith('cat:')) { upsert('tasks', { ...x, category: to.slice(4) || null }); toast(t('kbMovedCat')); changed(); return true; }
  if (from === 'done' && to !== 'done') { setTaskDone(x, false); x = get('tasks', id); }
  if (to === 'done') {
    setTaskDone(x, true);
    toast(t('kbDoneT', x.title), 5000, [{ label: t('undo'), run: () => { setTaskDone(get('tasks', id), false); changed(); } }]);
  } else if (to === 'toplan') {
    const bs = openBlocks(id); for (const b of bs) deleteBlock(b);
    toast(t('kbUnplannedT', x.title));
  } else if (to === 'planned') {
    const b = planSoon(get('tasks', id));
    toast(b ? t('kbPlannedT', relDay(b.date), fmtTime(b.start)) : t('noFreeSlotWeek'));
  }
  changed();
  return true;
}

function colAt(x, y) {
  if (d?.ghost) d.ghost.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  if (d?.ghost) d.ghost.style.display = '';
  return el?.closest?.('.kb-col[data-kcol]') || null;
}
function lift() {
  if (!d || d.lifted) return;
  d.lifted = true; navigator.vibrate?.(12);
  const r = d.el.getBoundingClientRect();
  const g = d.el.cloneNode(true); g.classList.add('kb-ghost'); g.style.width = `${r.width}px`;
  d.dx = d.x0 - r.left; d.dy = d.y0 - r.top;
  document.body.appendChild(g); d.ghost = g; d.el.classList.add('kb-from');
  document.body.classList.add('kb-dragging');
  move(d.x0, d.y0);
}
function move(x, y) {
  d.x = x; d.y = y;
  d.ghost.style.transform = `translate(${x - d.dx}px, ${y - d.dy}px) rotate(-2deg)`;
  const c = colAt(x, y); const key = c?.dataset.kcol;
  const ok = canDrop(d.from, key);
  if (c !== d.over) { d.over?.classList.remove('kb-drop', 'kb-no'); d.over = c; }
  c?.classList.toggle('kb-drop', ok); c?.classList.toggle('kb-no', Boolean(c) && !ok && key !== d.from);
  // near the top or bottom edge: the page scrolls
  const m = 70; const v = y < m ? -12 : y > innerHeight - m ? 12 : 0;
  d.scroll = v;
  if (v && !d.raf) { const step = () => { if (!d || !d.scroll) { if (d) d.raf = 0; return; } window.scrollBy(0, d.scroll); document.querySelector('.main, main')?.scrollBy?.(0, d.scroll); move(d.x, d.y); d.raf = requestAnimationFrame(step); }; d.raf = requestAnimationFrame(step); }
}
function end(drop) {
  if (!d) return;
  clearTimeout(d.timer);
  const was = d; d = null;
  if (!was.lifted) return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
  was.ghost?.remove(); was.el.classList.remove('kb-from'); was.over?.classList.remove('kb-drop', 'kb-no');
  document.body.classList.remove('kb-dragging');
  if (drop) { const key = was.over?.dataset.kcol; if (canDrop(was.from, key)) dropCard(was.id, was.from, key); }
}

export function setupKbDrag() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.kb-c[data-kid]'); if (!el || e.target.closest('.kb-a')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const col = el.closest('.kb-col[data-kcol]'); if (!col) return;
    if (el.dataset.krep && !col.dataset.kcol.startsWith('cat:')) return; // a routine's turns are planned by its rhythm
    d = { el, id: el.dataset.kid, from: col.dataset.kcol, x0: e.clientX, y0: e.clientY, touch: e.pointerType !== 'mouse', lifted: false };
    if (d.touch) d.timer = setTimeout(lift, HOLD_MS);
  });
  document.addEventListener('pointermove', (e) => {
    if (!d) return;
    const far = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.lifted) { if (d.touch) { if (far > 8) { clearTimeout(d.timer); d = null; } return; } if (far > 6) lift(); else return; }
    e.preventDefault(); move(e.clientX, e.clientY);
  });
  document.addEventListener('pointerup', () => end(true));
  document.addEventListener('pointercancel', () => end(false));
  document.addEventListener('touchmove', (e) => { if (d?.lifted && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest?.('.kb-c[data-kid]')) e.preventDefault(); });
  document.addEventListener('click', (e) => { if (suppressClick && e.target.closest?.('.kb-c')) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d?.lifted) { d.over?.classList.remove('kb-drop', 'kb-no'); d.over = null; end(false); } });
}
