// Two-way sync of local collections with JSON files in a private GitHub repository.
// Plain collections live in data/<name>.json, monthly ones in data/<name>/<YYYY-MM>.json.
import {
  state, COLLECTIONS, SHARDED, RICETTE, READ_ONLY, shardOf, mergeLists, purgeTombstones, serialize, replaceCollection, saveMeta,
} from './store.js';

export function pathFor(collection, shard = null) {
  return shard ? `data/${collection}/${shard}.json` : `data/${collection}.json`;
}

export function isConfigured() {
  const s = state.settings;
  return Boolean(s.owner && s.repo && s.token);
}

function branch() { return state.settings.branch || 'main'; }

export function ricetteConfigured() { return isConfigured() && Boolean(state.settings.ricetteRepo?.trim()); }

function api(path, init = {}, repo = state.settings.repo) {
  const s = state.settings;
  const url = `https://api.github.com/repos/${encodeURIComponent(s.owner.trim())}/${encodeURIComponent(repo.trim())}${path ? '/' + path : ''}`;
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${s.token.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

class SyncError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

function fail(res) {
  if (res.status === 401) return new SyncError('auth', 401);
  if (res.status === 403) return new SyncError('forbidden', 403);
  if (res.status === 404) return new SyncError('notfound', 404);
  return new SyncError('http', res.status);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function getFile(path, repo) {
  const ref = encodeURIComponent(branch());
  const res = await api(`contents/${path}?ref=${ref}`, {}, repo);
  if (res.status === 404) return { sha: null, data: [] };
  if (!res.ok) throw fail(res);
  const meta = await res.json();
  let text;
  if (meta.content) text = b64decode(meta.content);
  else {
    // Files over 1 MB come without inline content.
    const raw = await api(`contents/${path}?ref=${ref}`, { headers: { Accept: 'application/vnd.github.raw' } }, repo);
    if (!raw.ok) throw fail(raw);
    text = await raw.text();
  }
  let data = [];
  try { data = JSON.parse(text); } catch { data = []; }
  return { sha: meta.sha, data: Array.isArray(data) ? data : [] };
}

async function putFile(path, text, sha, repo) {
  const body = { message: `everyday: update ${path}`, content: b64encode(text), branch: branch() };
  if (sha) body.sha = sha;
  const res = await api(`contents/${path}`, {
    method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }, repo);
  if (res.status === 409 || res.status === 422) return false; // someone else wrote first
  if (!res.ok) throw fail(res);
  return true;
}

// Sync one file. For a monthly file only the records of that month are written to it,
// but the merge runs against the whole local collection, so a block moved to another
// month disappears from its old file instead of being pulled back.
async function syncFile(c, shard, repo = state.settings.repo, path = pathFor(c, shard)) {
  const inFile = (x) => shard == null || shardOf(c, x) === shard;
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await getFile(path, repo);
    if (READ_ONLY.has(c)) {
      const next = [...state[c].filter((x) => !inFile(x)), ...remote.data].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      await replaceCollection(c, next);
      return;
    }
    const merged = purgeTombstones(mergeLists(remote.data, state[c]));
    const content = merged.filter(inFile);
    const text = serialize(content);
    if (text !== serialize(remote.data)) {
      if (!(content.length === 0 && remote.sha == null)) { // don't create empty files
        const ok = await putFile(path, text, remote.sha, repo);
        if (!ok) continue;
      }
    }
    // Merge again with whatever changed locally while we were talking to GitHub.
    // Same order every time (by id), so an unchanged collection is recognised as unchanged.
    await replaceCollection(c, purgeTombstones(mergeLists(content, state[c])).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)));
    return;
  }
  throw new SyncError('conflict');
}

// Months kept in sync: last month, this month, next month, any month edited on this
// device, and any month the user is looking at.
const watched = new Set();
export function watchMonth(month) { watched.add(month); }

function monthOffset(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shardsToSync(c, now = new Date()) {
  const set = new Set([monthOffset(now, -1), monthOffset(now, 0), monthOffset(now, 1), ...watched]);
  for (const key of Object.keys(state.meta.dirtyShards || {})) {
    const [col, shard] = key.split('/');
    if (col === c) set.add(shard);
  }
  return [...set].sort();
}

let running = null;
let again = false;
export function requestAgain() { if (running) again = true; }

export function syncNow() {
  if (!isConfigured()) return Promise.resolve({ skipped: true });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve({ offline: true });
  // Already syncing: ask for another round. If that run had just finished its loop, start a new one.
  if (running) { again = true; return running.then(() => (again ? syncNow() : { ok: true })); }
  running = (async () => {
    try {
      do {
        again = false;
        for (const c of COLLECTIONS) {
          if (!SHARDED[c]) { await syncFile(c, null); continue; }
          for (const shard of shardsToSync(c)) {
            const key = `${c}/${shard}`;
            const before = state.meta.dirtyShards[key];
            await syncFile(c, shard);
            // Only clear the flag if nothing was edited in that month while syncing.
            const dirtyShards = { ...state.meta.dirtyShards };
            if (dirtyShards[key] === before) delete dirtyShards[key];
            await saveMeta({ dirtyShards, syncedShards: { ...state.meta.syncedShards, [key]: Date.now() } });
          }
        }
        if (ricetteConfigured()) {
          for (const [c, path] of Object.entries(RICETTE)) await syncFile(c, null, state.settings.ricetteRepo, path);
        }
        await saveMeta({ dirty: again, lastSync: Date.now(), lastError: null, ricetteSynced: ricetteConfigured() ? Date.now() : state.meta.ricetteSynced });
      } while (again);
      return { ok: true };
    } catch (e) {
      const code = e instanceof SyncError ? e.code : (e instanceof TypeError ? 'network' : 'unknown');
      await saveMeta({ lastError: code });
      return { error: code };
    } finally {
      running = null;
    }
  })();
  return running;
}

export function isSyncing() { return Boolean(running); }

// A photo from Ricette's repo (images/...), as a blob.
export async function fetchRicettePhoto(path) {
  if (!ricetteConfigured()) return null;
  try {
    const res = await api(`contents/${path}?ref=${encodeURIComponent(branch())}`, { headers: { Accept: 'application/vnd.github.raw' } }, state.settings.ricetteRepo);
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}

// Ask GitHub to run a workflow in the data repo now (the Google Calendar sync).
// Needs the token to have "Actions: Read and write"; returns 'ok', 'forbidden' or 'error'.
export async function runWorkflow(file) {
  if (!isConfigured()) return 'error';
  try {
    const res = await api(`actions/workflows/${file}/dispatches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: branch() }),
    });
    if (res.status === 204 || res.ok) return 'ok';
    return res.status === 403 || res.status === 404 ? 'forbidden' : 'error';
  } catch { return 'error'; }
}

export async function testConnection(repo = state.settings.repo) {
  if (!isConfigured()) return { error: 'missing' };
  try {
    const res = await api('', {}, repo);
    if (!res.ok) return { error: fail(res).code };
    const info = await res.json();
    if (!info.permissions?.push) return { error: 'readonly' };
    return { ok: true, private: info.private };
  } catch {
    return { error: 'network' };
  }
}
