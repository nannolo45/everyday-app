// Shops and grocery trips. Pure functions (no DOM, no storage), shared with Ricette.
//
// A shop:            {id, name, minutes?, hours?: [{days: [1-7, Monday = 1] | date: 'YYYY-MM-DD', from, to}], place?, link?}
//                    `minutes` = how long a visit takes (default 30); `hours` = opening hours, in minutes
//                    from midnight (none = always open).
// A shopping item:   {..., shops?: [shopId]}: the shops it can be bought in. None (or only deleted
//                    shops) = any shop.
// Trip modes:        'perShop' = one trip per shop; 'oneTrip' = one trip visiting every shop needed.

export const SHOP_MINUTES = 30;

const isoDay = (date) => { const [y, m, d] = date.split('-').map(Number); return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1; };
const live = (list) => (list || []).filter((x) => x && !x.deleted);

// Opening hours on a date as [[from, to]], or null when the shop has no hours (always open).
export function openOn(shop, date) {
  const hours = live(shop.hours).filter((w) => w.from != null && w.to != null && w.to > w.from);
  if (!hours.length) return null;
  return hours.filter((w) => (w.date ? w.date === date : (w.days || []).includes(isoDay(date)))).map((w) => [w.from, w.to]).sort((a, b) => a[0] - b[0]);
}

// The shops an item can be bought in (ids of live shops; all of them when it names none).
export function shopsFor(item, shops) {
  const ids = live(shops).map((s) => s.id);
  const own = (item.shops || []).filter((id) => ids.includes(id));
  return own.length ? own : ids;
}

// Which shop each open item is bought in, visiting as few shops as possible:
// 1. the shops to visit: those that are the only place for some item, then, again and again, the shop
//    that covers the most items still uncovered;
// 2. each item goes to the first of its own shops that's visited; an item for any shop goes to the
//    visited shop highest in your list of shops (the list's order is your preference).
// Returns Map(shopId → items) in visiting priority (unavoidable shops first); null when there are no shops.
export function assignItems(items, shops) {
  const sh = live(shops);
  if (!sh.length) return null;
  const open = live(items).filter((i) => !i.checked);
  const cand = new Map(open.map((i) => [i.id, shopsFor(i, sh)]));
  const chosen = [];
  const covered = (id) => cand.get(id).some((s) => chosen.includes(s));
  const count = (sid) => open.filter((i) => !covered(i.id) && cand.get(i.id).includes(sid)).length;
  const musts = [...new Set(open.map((i) => cand.get(i.id)).filter((c) => c.length === 1).map((c) => c[0]))];
  musts.sort((a, b) => count(b) - count(a));
  for (const m of musts) if (!chosen.includes(m)) chosen.push(m);
  for (;;) {
    let best = null; let n = 0;
    for (const s of sh) { const k = chosen.includes(s.id) ? 0 : count(s.id); if (k > n) { best = s.id; n = k; } }
    if (!best) break;
    chosen.push(best);
  }
  const out = new Map(chosen.map((id) => [id, []]));
  const rank = (id) => sh.findIndex((s) => s.id === id);
  for (const i of open) {
    const own = (i.shops || []).filter((id) => chosen.includes(id));
    const pick = own[0] || [...chosen].filter((id) => cand.get(i.id).includes(id)).sort((a, b) => rank(a) - rank(b))[0];
    if (pick) out.get(pick).push(i);
  }
  for (const [id, list] of out) if (!list.length) out.delete(id);
  return out;
}

// Times for the trips.
//   shopIds:   the shops to visit (e.g. the keys of assignItems)
//   days:      dates to try, in order
//   busyOn:    date → [{start, minutes}] (what's already planned)
//   from:      {date, minute}: not before this (now)
//   deadline:  {date, minute} or null: be back by then (e.g. a meal); the trips then go as late as
//              possible before it (fresh food), otherwise as early as possible
//   hours:     date → [from, to]: the planner's own hours (e.g. not before 9:00). A trip is first
//              looked for inside both these and the shops' opening hours; only when nothing fits
//              anywhere does it fall back to the opening hours alone. Shops without opening hours
//              use these hours.
// Returns [{shopIds, date, start, minutes}] (date null = no time found).
export function planTrips({ shopIds, shops, mode = 'perShop', days, busyOn = () => [], from, deadline = null, hours = () => [480, 1260], snap = 15 }) {
  const byId = new Map(live(shops).map((s) => [s.id, s]));
  const mins = (id) => Number(byId.get(id)?.minutes) || SHOP_MINUTES;
  const placed = [];
  const busy = (d) => [...busyOn(d), ...placed.filter((p) => p.date === d)];
  const free = (d, a, b) => busy(d).every((x) => x.start >= b || x.start + x.minutes <= a);
  const ranges = (id, d) => openOn(byId.get(id) || {}, d) ?? [hours(d)];
  const inside = (id, d, a, b) => ranges(id, d).some(([f, t]) => a >= f && b <= t);
  const candidates = (d) => {
    if (deadline && d > deadline.date) return [];
    const lo = Math.ceil(Math.max(d === from.date ? from.minute : 0, 0) / snap) * snap;
    const hi = deadline && d === deadline.date ? deadline.minute : 1440;
    const out = [];
    for (let t = lo; t <= hi; t += snap) out.push(t);
    return deadline ? out.reverse() : out;
  };
  const order = deadline ? [...days].reverse() : days;
  // Visiting several shops in one go: the one closing first goes first.
  const closing = (id, d) => Math.max(...ranges(id, d).map((r) => r[1]));
  const groups = mode === 'oneTrip' ? [shopIds] : shopIds.map((id) => [id]);
  const search = (group, strict) => {
    let found = null;
    for (const d of order) {
      if (d < from.date) continue;
      const stops = [...group].sort((a, b) => closing(a, d) - closing(b, d));
      const total = stops.reduce((n, id) => n + mins(id), 0);
      for (const t of candidates(d)) {
        if (deadline && d === deadline.date && t + total > deadline.minute) continue;
        if (t + total > 1440 || !free(d, t, t + total)) continue;
        let at = t; let ok = true;
        if (strict) { const [hf, ht] = hours(d); if (t < hf || t + total > ht) continue; }
        for (const id of stops) { if (!inside(id, d, at, at + mins(id))) { ok = false; break; } at += mins(id); }
        if (ok) { found = { shopIds: stops, date: d, start: t, minutes: total }; break; }
      }
      if (found) break;
    }
    return found;
  };
  for (const group of groups) {
    const found = search(group, true) || search(group, false);
    const trip = found || { shopIds: group, date: null, start: null, minutes: group.reduce((n, id) => n + mins(id), 0) };
    placed.push(trip);
  }
  return placed.filter((p) => p.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start)).concat(placed.filter((p) => !p.date));
}
