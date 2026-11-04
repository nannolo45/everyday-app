// places.js (v85): Luoghi salvati. Every place you go to, with an address, a link and (if it has them)
// opening hours. A shop is a place where you buy things on the list (🛒): shops stay where they always
// were (Ricette's data/shops.json once it's connected, else Everyday's own `shops`), so Ricette sees
// only the shops; the other places are Everyday's own `places` (data/places.json). Both have the same
// fields: {id, name, place (the address), link, hours, minutes (a shop visit), em (an emoji), order}.
// Turning 🛒 on or off moves the record from one to the other, keeping its id.
// A task points at a saved place with `placeId`; its `place` text is kept equal to the place's address
// (the travel lookups read it), and stays as it is when the place is deleted.
import { openOn } from './shops.js';
import { get, live, remove, upsert } from './store.js';
import { legMinutes, ownMinutes } from './travel-plan.js';
import { SHOPS, shopsList } from './views/shop.js';

export const PLACES = 'places';
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Every saved place: shops first in their own order, then the others by name. `shop` says which is which.
export function allPlaces() {
  const others = live(PLACES).map((p) => ({ ...p, shop: false })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return [...shopsList().map((p) => ({ ...p, shop: true })), ...others];
}
export function placeById(id) {
  if (!id) return null;
  const p = get(PLACES, id); if (p && !p.deleted) return { ...p, shop: false };
  const s = get(SHOPS(), id); if (s && !s.deleted) return { ...s, shop: true };
  return null;
}
export const placeEmoji = (p) => p?.em || (p?.shop ? '🛒' : '📍');
export const placeAddress = (p) => (p?.place || '').trim() || p?.name || '';
export const placeOfTask = (x) => placeById(x?.placeId);
// A saved place by name or address ("@posta" in the quick add, or a place typed as text).
export function placeByText(text) {
  const q = fold(text); if (!q) return null;
  return allPlaces().find((p) => fold(p.name) === q || fold(p.place) === q) || null;
}
// Places matching a search, for the + sheet.
export function searchPlaces(text, n = 6) {
  const q = fold(text);
  return allPlaces().filter((p) => !q || fold(p.name).includes(q) || fold(p.place).includes(q)).slice(0, n);
}
// The places used most recently by tasks, then the rest.
export function recentPlaces(n = 5) {
  const seen = new Map();
  for (const x of live('tasks').filter((y) => y.placeId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) if (!seen.has(x.placeId)) seen.set(x.placeId, true);
  const ps = allPlaces();
  return [...[...seen.keys()].map((id) => ps.find((p) => p.id === id)).filter(Boolean), ...ps.filter((p) => !seen.has(p.id))].slice(0, n);
}

// ---------- opening hours ----------
export const hasHours = (p) => Boolean(p?.hours?.length);
// The hours of a task's place, in the planner's window format, or null (no place, or no hours: no limits).
export function placeHours(x) { const p = placeOfTask(x); return hasHours(p) ? p.hours : null; }
// What the planner needs to keep a task's time at its place inside the hours (nothing without them):
// the hours, the minutes before it gets there (`pre`, «Get there») and its own length there.
export function hoursFields(x) {
  const hours = placeHours(x); if (!hours) return {};
  return { hours, pre: legMinutes(x, 'there'), own: ownMinutes(x) };
}
// Open on that date: [[from, to], …] (empty = closed all day), or null when the place has no hours.
export function openRanges(p, date) { return hasHours(p) ? (openOn(p, date) || []) : null; }
// Where an interval [s, e] falls against the hours: null (fine, or no hours) or what's wrong:
// {k: 'day'} closed all day · {k: 'closes', at} open at the start but closes before the end ·
// {k: 'opens', at} starts before it opens · {k: 'out', ranges} closed then.
export function closedAt(p, date, s, e) {
  const r = openRanges(p, date); if (!r) return null;
  if (!r.length) return { k: 'day' };
  if (r.some(([a, b]) => a <= s && e <= b)) return null;
  const inside = r.find(([a, b]) => a <= s && s < b);
  if (inside) return { k: 'closes', at: inside[1] };
  const opens = r.find(([a]) => s < a && e > a);
  if (opens) return { k: 'opens', at: opens[0] };
  return { k: 'out', ranges: r };
}
// Open now / later today / next opening, for lists: {k: 'open', to} · {k: 'later', from} · {k: 'next', date, from} · {k: 'closed'} · null (no hours).
export function openState(p, date, minute, addDays) {
  const r = openRanges(p, date); if (!r) return null;
  const cur = r.find(([a, b]) => a <= minute && minute < b);
  if (cur) return { k: 'open', to: cur[1] };
  const later = r.find(([a]) => a > minute);
  if (later) return { k: 'later', from: later[0] };
  for (let i = 1; i <= 7; i++) { const d = addDays(date, i); const n = openRanges(p, d); if (n?.length) return { k: 'next', date: d, from: n[0][0] }; }
  return { k: 'closed' };
}

// ---------- saving ----------
// Saves a place as a shop or not, moving it between the two collections when 🛒 changed. Tasks that
// point at it get its new address. Returns the saved record (with `shop`).
export function savePlace(rec, shop) {
  const { shop: _s, ...fields } = rec;
  const was = placeById(rec.id);
  if (was && was.shop !== shop) remove(was.shop ? SHOPS() : PLACES, rec.id);
  const order = shop ? (was?.shop ? was.order : shopsList().length) : undefined;
  const saved = upsert(shop ? SHOPS() : PLACES, { minutes: 30, hours: [], place: '', link: '', ...fields, ...(shop ? { order: order ?? fields.order ?? shopsList().length } : {}) }, { silent: true });
  const addr = placeAddress(saved);
  for (const x of live('tasks').filter((y) => y.placeId === saved.id && y.place !== addr)) upsert('tasks', { ...x, place: addr }, { silent: true });
  return { ...saved, shop };
}
// Deletes a place: tasks keep its address as text (without the hours).
export function deletePlace(id) {
  const p = placeById(id); if (!p) return;
  for (const x of live('tasks').filter((y) => y.placeId === id)) upsert('tasks', { ...x, placeId: null, place: x.place || placeAddress(p) }, { silent: true });
  remove(p.shop ? SHOPS() : PLACES, id);
}
// A new place from what was typed (☆ Salva come luogo in the + sheet): no hours, not a shop.
export function quickPlace(text, uid) {
  const v = String(text || '').trim();
  return savePlace({ id: uid(), name: v, place: v, link: '', hours: [], em: '📍' }, false);
}
// What uses a place: tasks (not done) and the shopping-list items that name it.
export function placeUsers(id, items = []) {
  return { tasks: live('tasks').filter((x) => x.placeId === id && !x.done), items: items.filter((i) => (i.shops || []).includes(id)) };
}
