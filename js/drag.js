// Dragging on the day timeline, with mouse, pen or finger.
// - Mouse/pen: press and move.
// - Finger: press and hold for a moment, then move (so normal scrolling still works).
//   The resize handle at the bottom of a block reacts immediately.
// Kinds: 'move' a block, 'resize' a block, 'task' = drop a task chip onto the timeline.

const HOLD_MS = 320;

export function setupDrag(root, hooks) {
  let d = null; // current gesture
  let suppressClick = false;

  // Every day column on screen (one in the day view, seven in the week view).
  const columns = () => [...root.querySelectorAll('.timeline')].map((tl) => {
    const r = tl.getBoundingClientRect();
    return { tl, date: tl.dataset.date, top: r.top + window.scrollY, left: r.left, right: r.right, rangeStart: Number(tl.dataset.start), ppm: Number(tl.dataset.ppm), snap: Number(tl.dataset.snap) || 15 };
  });
  const columnAt = (cols, x, fallback) => cols.find((c) => x >= c.left && x <= c.right) || fallback;

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || d) return;
    if (e.target.closest('input, button.blk-btn, a')) return;
    const handle = e.target.closest('.resize');
    const block = e.target.closest('.block:not(.event)'); // calendar events can't be moved here
    const chip = e.target.closest('.chip[data-task]');
    if (!handle && !block && !chip) return;
    const el = handle ? handle.closest('.block') : (block || chip);
    d = {
      kind: handle ? 'resize' : block ? 'move' : 'task',
      el, id: el.dataset.id, pointerId: e.pointerId, touch: e.pointerType === 'touch',
      x0: e.clientX, y0: e.clientY, sy0: window.scrollY, x: e.clientX, y: e.clientY,
      armed: !(e.pointerType === 'touch') || Boolean(handle), started: false,
      start: Number(el.dataset.start), minutes: Number(el.dataset.minutes),
    };
    if (d.touch && !d.armed) {
      d.timer = setTimeout(() => {
        if (!d) return;
        d.armed = true;
        el.classList.add('lifted');
        navigator.vibrate?.(12);
      }, HOLD_MS);
    }
    el.dataset.date0 = el.closest('.timeline')?.dataset.date || '';
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  root.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX; d.y = e.clientY;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.armed) { if (dist > 8) cancel(); return; } // finger moved first: it's a scroll
    if (!d.started && dist < 4 && !d.touch) return;
    if (!d.started) begin();
    update();
  });

  // While a finger drag is active, stop the page from scrolling under it.
  document.addEventListener('touchmove', (e) => { if (d && d.armed && e.cancelable) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.block, .chip[data-task]')) e.preventDefault(); });

  root.addEventListener('pointerup', (e) => {
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.started) { finish(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); } else cancel();
  });
  root.addEventListener('pointercancel', () => { if (d) { const was = d.started; cancel(); if (was) hooks.redraw(); } });
  root.addEventListener('click', (e) => { if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; } }, true);

  function begin() {
    d.started = true;
    d.cols = columns();
    d.g = d.cols.find((c) => c.tl.contains(d.el)) || d.cols[0];
    d.date = d.g?.date;
    if (!d.g) { d.started = false; return; }
    hooks.dragging(true);
    d.el.classList.add('dragging');
    if (d.kind === 'task') {
      d.ghost = document.createElement('div');
      d.ghost.className = 'block ghost';
      d.ghost.style.setProperty('--c', d.el.style.getPropertyValue('--c') || 'var(--accent)');
      d.ghost.innerHTML = `<div class="blk-body"><div class="blk-title"></div><div class="blk-time"></div></div>`;
      d.ghost.querySelector('.blk-title').textContent = d.el.dataset.title || '';
      d.ghost.style.height = `${Math.max(d.minutes, 15) * d.g.ppm}px`;
      d.ghost.hidden = true;
      d.g.tl.appendChild(d.ghost);
      d.ghost.style.left = '1px'; d.ghost.style.right = '3px';
    }
    tickScroll();
  }

  function minuteAt(clientY) {
    const g = d.g;
    return g.rangeStart + (clientY + window.scrollY - g.top) / g.ppm;
  }

  function update() {
    if (!d || !d.started) return;
    if (d.kind !== 'resize') {
      // Moving sideways in the week view: switch day column.
      const col = columnAt(d.cols, d.x, d.kind === 'task' ? null : d.g);
      if (col && col !== d.g) {
        d.g = col; d.date = col.date;
        if (d.kind === 'move') { col.tl.appendChild(d.el); d.el.style.left = '1px'; d.el.style.width = 'calc(100% - 4px)'; }
        else if (d.ghost) col.tl.appendChild(d.ghost);
      }
    }
    const g = d.g; const snap = g.snap;
    const dy = (d.y + window.scrollY) - (d.y0 + d.sy0);
    if (d.kind === 'move') {
      d.newStart = clamp(Math.round((d.start + dy / g.ppm) / snap) * snap, 0, 1440 - d.minutes);
      d.el.style.top = `${(d.newStart - g.rangeStart) * g.ppm}px`;
      d.el.querySelector('.blk-time').textContent = hooks.label(d.newStart, d.minutes);
    } else if (d.kind === 'resize') {
      d.newMinutes = clamp(Math.round((d.minutes + dy / g.ppm) / snap) * snap, snap, 1440 - d.start);
      d.el.style.height = `${d.newMinutes * g.ppm}px`;
      d.el.querySelector('.blk-time').textContent = hooks.label(d.start, d.newMinutes);
    } else {
      const over = Boolean(columnAt(d.cols, d.x, null)) && minuteAt(d.y) >= g.rangeStart - 30;
      d.ghost.hidden = !over;
      d.el.classList.toggle('dropping', over);
      if (over) {
        const m = Math.max(d.minutes, 15);
        d.newStart = clamp(Math.round((minuteAt(d.y) - m / 2) / snap) * snap, 0, 1440 - m);
        d.ghost.style.top = `${(d.newStart - g.rangeStart) * g.ppm}px`;
        d.ghost.querySelector('.blk-time').textContent = hooks.label(d.newStart, m);
      } else d.newStart = null;
    }
  }

  // Scroll the page while dragging near the top or bottom edge.
  function tickScroll() {
    if (!d || !d.started) return;
    const edge = 70; const h = window.innerHeight;
    let v = 0;
    if (d.y < edge) v = -Math.ceil((edge - d.y) / 6);
    else if (d.y > h - edge - 64) v = Math.ceil((d.y - (h - edge - 64)) / 6);
    if (v) { window.scrollBy(0, v); update(); }
    d.raf = requestAnimationFrame(tickScroll);
  }

  function finish() {
    const g = d;
    end();
    const movedDay = g.date && g.date !== g.el.dataset.date0;
    if (g.kind === 'move' && g.newStart != null && (g.newStart !== g.start || movedDay)) hooks.move(g.id, g.newStart, g.date);
    else if (g.kind === 'resize' && g.newMinutes != null && g.newMinutes !== g.minutes) hooks.resize(g.id, g.newMinutes);
    else if (g.kind === 'task' && g.newStart != null) hooks.dropTask(g.id, g.newStart, g.date);
    else hooks.redraw();
  }

  function cancel() { end(); }

  function end() {
    if (!d) return;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.el.classList.remove('lifted', 'dragging', 'dropping');
    d.ghost?.remove();
    const was = d.started;
    d = null;
    if (was) hooks.dragging(false);
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
