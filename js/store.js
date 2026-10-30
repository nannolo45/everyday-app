// Local storage (IndexedDB) and conflict-free merging of collections.
// Same approach as Ricette: every record is {id, updatedAt, deleted?} and, when two
// versions meet, the newest updatedAt wins per id.
//
// Some collections grow forever (planned blocks, later time entries and workout logs).
// Those are "sharded": stored on GitHub as one file per month, e.g. data/blocks/2026-10.json,
// so each sync only moves a few small files.

// `shopping` is Everyday's own shopping list, used only while Ricette isn't connected.
// `shops` likewise (Ricette's data/shops.json once connected); `config` = settings every device and the
// Google Calendar sync share (e.g. reminders), one record per setting: {id, value}.
export const COLLECTIONS = ['tasks', 'blocks', 'templates', 'categories', 'events', 'gcal', 'shopping', 'shops', 'config'];
export const SHARDED = { blocks: 'date', events: 'date' }; // collection -> field holding a YYYY-MM-DD date
// Local copies of Ricette's data (its private repo), kept in sync the same way.
// Recipes are only read; the pantry and the shopping list are shared both ways.
export const RICETTE = {
  r_recipes: 'data/recipes.json', r_folders: 'data/folders.json', r_tagdefs: 'data/tags.json', r_prefs: 'data/prefs.json',
  r_pantry: 'data/pantry.json', r_shopping: 'data/shopping.json', r_shops: 'data/shops.json',
};
// Written only by others: Ricette's recipes, and the Google Calendar sync (events + its status).
// (Ricette's prefs are shared both ways: list view and department order, one record per setting.)
export const READ_ONLY = new Set(['r_recipes', 'r_folders', 'r_tagdefs', 'events', 'gcal']);
const ALL = [...COLLECTIONS, ...Object.keys(RICETTE)];
const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000;

const DB_NAME = 'everyday';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function db() { return (dbPromise ||= openDb()); }

export async function kvGet(key) {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve, reject) => {
    const r = d.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function kvSet(key, value) {
  const d = await db();
  if (!d) return;
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const state = {
  tasks: [], blocks: [], templates: [], categories: [], events: [], gcal: [], shopping: [], shops: [], config: [], r_recipes: [], r_folders: [], r_tagdefs: [], r_prefs: [], r_pantry: [], r_shopping: [], r_shops: [],
  settings: {
    lang: '', owner: '', repo: '', branch: 'main', token: '',
    dayStart: 6, dayEnd: 23, snap: 15, buffer: 5, maxLoad: 8, ricetteRepo: '',
  },
  // dirtyShards: {"blocks/2026-10": stamp} = months edited here and not yet uploaded
  // syncedShards: {"blocks/2026-10": time} = months this device has downloaded at least once
  meta: { dirty: false, lastSync: null, lastError: null, dirtyShards: {}, syncedShards: {} },
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { for (const fn of listeners) fn(kind); }

export async function load() {
  for (const c of ALL) state[c] = (await kvGet(c)) || [];
  Object.assign(state.settings, (await kvGet('settings')) || {});
  Object.assign(state.meta, (await kvGet('meta')) || {});
  state.meta.dirtyShards ||= {};
  state.meta.syncedShards ||= {};
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function live(collection) { return state[collection].filter((x) => !x.deleted); }
export function get(collection, id) { return state[collection].find((x) => x.id === id && !x.deleted); }
export function has(collection, id) { return state[collection].some((x) => x.id === id); } // tombstones count

export function shardOf(collection, rec) {
  const field = SHARDED[collection];
  if (!field) return null;
  const v = rec?.[field];
  return typeof v === 'string' && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : 'undated';
}

let lastStamp = 0;
function stamp() { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp; }

// `at` lets callers write a record with a deliberately old timestamp (see plan.js
// autoApply): any real edit or deletion made on another device then always wins.
export function upsert(collection, item, { silent = false, at = null } = {}) {
  const rec = { ...item, updatedAt: at ?? stamp() };
  const list = state[collection];
  const i = list.findIndex((x) => x.id === rec.id);
  const prev = i >= 0 ? list[i] : null;
  if (i >= 0) list[i] = rec; else list.push(rec);
  touch(collection, prev);
  touch(collection, rec);
  persist(collection, silent);
  return rec;
}

export function remove(collection, id) {
  const list = state[collection];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return;
  const field = SHARDED[collection];
  // A tombstone keeps its date so it lands in (and deletes from) the right monthly file.
  const tomb = { id, deleted: true, updatedAt: stamp() };
  if (field && list[i][field]) tomb[field] = list[i][field];
  list[i] = tomb;
  touch(collection, tomb);
  persist(collection);
}

function touch(collection, rec) {
  if (!rec || !SHARDED[collection]) return;
  state.meta.dirtyShards[`${collection}/${shardOf(collection, rec)}`] = stamp();
}

function persist(collection, silent) {
  kvSet(collection, state[collection]);
  state.meta.dirty = true;
  kvSet('meta', state.meta);
  if (!silent) emit(collection);
}

export async function replaceCollection(collection, items) {
  // After a sync most files come back unchanged: then there's nothing to save or redraw.
  if (JSON.stringify(items) === JSON.stringify(state[collection])) return;
  state[collection] = items;
  await kvSet(collection, items);
  emit(collection);
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await kvSet('settings', state.settings);
  emit('settings');
}

export async function saveMeta(patch) {
  Object.assign(state.meta, patch);
  await kvSet('meta', state.meta);
  emit('meta');
}

export function mergeLists(a = [], b = []) {
  const map = new Map();
  for (const x of [...a, ...b]) {
    if (!x || !x.id) continue;
    const y = map.get(x.id);
    if (!y || (x.updatedAt || 0) > (y.updatedAt || 0)) map.set(x.id, x);
  }
  return [...map.values()];
}

export function purgeTombstones(list, now = Date.now()) {
  return list.filter((x) => !x.deleted || now - (x.updatedAt || 0) < TOMBSTONE_TTL);
}

export function serialize(list) {
  const sorted = [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(sorted, null, 1) + '\n';
}
