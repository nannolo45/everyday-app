// Dragging tasks from the planner's tray onto days, with mouse, pen or finger.
// - Mouse/pen: press and move. Finger: press and hold for a moment, then move (scrolling still works).
// - A tap (no drag) selects/unselects the task.
// Drop targets: a day timeline (Day and Week views: drops at that time) or anything marked
// data-drop="YYYY-MM-DD" (month cells, list days, load bars).

const HOLD_MS = 260;

export function setupTrayDrag({ onTap, onDrop, label, onDragging = () => {} }) {
  let d = null;
  const clear = () => document.querySelectorAll('.drop-on').forEach((el) => el.classList.remove('drop-on'));

  function targetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('.tray')) return null;
    const tl = el.closest('.timeline[data-date]');
    if (tl) {
      const r = tl.getBoundingClientRect();
      const snap = Math.max(Number(tl.dataset.snap) || 15, 15);
      const minute = Number(tl.dataset.start) + (y - r.top) / Number(tl.dataset.ppm || 1.2);
      return { el: tl, date: tl.dataset.date, minute: Math.max(0, Math.round(minute / snap) * snap) };
    }
    const dz = el.closest('[data-drop]');
    return dz ? { el: dz, date: dz.dataset.drop, minute: null } : null;
  }

  document.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.tchip');
    if (!chip || e.button !== 0 || d) return;
    const touch = e.pointerType === 'touch';
    d = { id: chip.dataset.id, chip, pid: e.pointerId, x0: e.clientX, y0: e.clientY, touch, armed: !touch, started: false, moved: false };
    if (touch) {
      d.timer = setTimeout(() => { if (!d) return; d.armed = true; chip.classList.add('lifted'); navigator.vibrate?.(12); }, HOLD_MS);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pid) return;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (dist > 6) d.moved = true;
    if (!d.armed) { if (dist > 8) end(); return; } // the finger moved first: it's a scroll
    if (!d.started && dist < 5) return;
    if (!d.started) {
      d.started = true;
      onDragging(true);
      d.float = document.createElement('div');
      d.float.className = 'tdrag-float';
      document.body.append(d.float);
    }
    const tgt = targetAt(e.clientX, e.clientY);
    clear();
    if (tgt) tgt.el.classList.add('drop-on');
    d.float.textContent = label(d.id, tgt);
    d.float.style.transform = `translate(${e.clientX + 12}px, ${e.clientY - 44}px)`;
  });

  // While a finger drag is active, stop the page from scrolling under it.
  document.addEventListener('touchmove', (e) => { if (d && d.armed && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (e.target.closest('.tchip')) e.preventDefault(); });

  document.addEventListener('pointerup', (e) => {
    if (!d || e.pointerId !== d.pid) return;
    const cur = d;
    const tgt = cur.started ? targetAt(e.clientX, e.clientY) : null;
    end();
    if (cur.started) { if (tgt) onDrop(cur.id, tgt); } else if (!cur.moved) onTap(cur.id);
  });
  document.addEventListener('pointercancel', () => end());

  function end() {
    if (!d) return;
    clearTimeout(d.timer);
    d.chip.classList.remove('lifted');
    d.float?.remove();
    if (d.started) onDragging(false);
    clear();
    d = null;
  }
}
