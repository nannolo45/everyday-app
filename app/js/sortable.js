// Drag-and-drop reordering that works with a mouse, a finger or a pen (pointer events), plus arrow keys.
//
// Markup: a container with data-sortable="<kind>" (and optionally data-group="<key>"), whose direct
// children carry data-sort-key="<key>". Each child has a .drag-handle (best a <button>) to grab it.
// After a change the container fires a bubbling "sorted" event with
// detail = { kind, group, keys, moved }.

let drag = null;

export function isDragging() { return Boolean(drag); }

function itemsOf(container) {
  return [...container.children].filter((el) => el.dataset.sortKey != null);
}

function keysOf(container) { return itemsOf(container).map((el) => el.dataset.sortKey); }

function fire(container, moved, before) {
  const keys = keysOf(container);
  if (before && before.join('\u0000') === keys.join('\u0000')) return;
  container.dispatchEvent(new CustomEvent('sorted', {
    bubbles: true,
    detail: { kind: container.dataset.sortable, group: container.dataset.group || '', keys, moved },
  }));
}

function pageY(e) { return e.clientY + window.scrollY; }

function place() {
  const { item, container, startPageY, startTop, lastClientY } = drag;
  const y = lastClientY;
  // move past neighbours whose middle the pointer has crossed
  for (;;) {
    const sibs = itemsOf(container);
    const i = sibs.indexOf(item);
    const prev = sibs[i - 1];
    const next = sibs[i + 1];
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (y < r.top + r.height / 2) { container.insertBefore(item, prev); continue; }
    }
    if (next) {
      const r = next.getBoundingClientRect();
      if (y > r.top + r.height / 2) { container.insertBefore(item, next.nextSibling); continue; }
    }
    break;
  }
  const dy = (y + window.scrollY) - startPageY - (item.offsetTop - startTop);
  item.style.transform = `translateY(${dy}px)`;
}

function autoScroll() {
  if (!drag) return;
  const y = drag.lastClientY;
  const bottomEdge = window.innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 64) - 30;
  let step = 0;
  if (y < 80) step = -Math.ceil((80 - y) / 6);
  else if (y > bottomEdge) step = Math.ceil((y - bottomEdge) / 6);
  if (step) { window.scrollBy(0, step); place(); }
  drag.raf = requestAnimationFrame(autoScroll);
}

function end(commit = true) {
  if (!drag) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(d.raf);
  d.item.classList.remove('dragging');
  d.item.style.transform = '';
  d.container.classList.remove('sorting');
  document.body.classList.remove('is-sorting');
  try { d.handle.releasePointerCapture(d.pointerId); } catch { /* already released */ }
  if (commit) fire(d.container, d.item.dataset.sortKey, d.before);
  else {
    // put everything back where it was
    const byKey = new Map(itemsOf(d.container).map((el) => [el.dataset.sortKey, el]));
    for (const k of d.before) d.container.appendChild(byKey.get(k));
  }
}

document.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const item = handle.closest('[data-sort-key]');
  const container = item && item.parentElement;
  if (!container || container.dataset.sortable == null) return;
  e.preventDefault();
  drag = {
    handle, item, container, pointerId: e.pointerId,
    startPageY: pageY(e), startTop: item.offsetTop, lastClientY: e.clientY,
    before: keysOf(container), raf: 0,
  };
  try { handle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  item.classList.add('dragging');
  container.classList.add('sorting');
  document.body.classList.add('is-sorting');
  drag.raf = requestAnimationFrame(autoScroll);
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();
  drag.lastClientY = e.clientY;
  place();
}, { passive: false });

document.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.pointerId) end(true); });
document.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.pointerId) end(false); });
document.addEventListener('keydown', (e) => {
  if (drag && e.key === 'Escape') { end(false); return; }
  const handle = e.target.closest && e.target.closest('.drag-handle');
  if (!handle || drag || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const item = handle.closest('[data-sort-key]');
  const container = item && item.parentElement;
  if (!container || container.dataset.sortable == null) return;
  e.preventDefault();
  const before = keysOf(container);
  const sibs = itemsOf(container);
  const i = sibs.indexOf(item);
  if (e.key === 'ArrowUp' && i > 0) container.insertBefore(item, sibs[i - 1]);
  else if (e.key === 'ArrowDown' && i < sibs.length - 1) container.insertBefore(item, sibs[i + 1].nextSibling);
  handle.focus();
  fire(container, item.dataset.sortKey, before);
});

/** Put the keys of `subset` in the order given, keeping every other key of `full` where it was. */
export function reorderSubset(full, subset) {
  const set = new Set(subset);
  const all = [...full, ...subset.filter((k) => !full.includes(k))];
  const queue = [...subset];
  return all.map((k) => (set.has(k) ? queue.shift() : k));
}

/** Sort by a saved order; unknown keys go after the known ones, in their original order. */
export function byOrder(keys, saved) {
  const pos = new Map((saved || []).map((k, i) => [k, i]));
  return keys.map((k, i) => [k, i]).sort((a, b) => (pos.get(a[0]) ?? 1e6 + a[1]) - (pos.get(b[0]) ?? 1e6 + b[1])).map((x) => x[0]);
}
