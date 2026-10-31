// Two-way sync between Everyday and Google Calendar. Runs in a GitHub Action (see
// .github/workflows/google-calendar.yml), so your Google credentials live only in this
// repository's secrets and never on your devices.
//
// From Google:  every calendar you have ticked (visible) in Google Calendar is copied into
//               data/events/YYYY-MM.json. The app shows these as fixed busy time.
// To Google:    every planned block goes onto a calendar named "Everyday" (created for you),
//               so Google's own reminders and widgets work for your plan.
// Both ways:    move or rename an Everyday event in Google Calendar and the block follows;
//               delete it there and the block is deleted too.
//
// Needs the secrets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = 'https://www.googleapis.com/calendar/v3';
const CAL_NAME = process.env.GCAL_CALENDAR_NAME || 'Everyday';
const ICON = { prep: '↳ ', meal: '🍽 ', groceries: '🛒 ' };

// ---------- small helpers ----------

const pad = (n) => String(n).padStart(2, '0');
const monthKey = (y, m) => `${y}-${pad(m)}`;

export function monthsAround(now = new Date()) {
  // Last month, this month and the next two: always whole months, so files can be rewritten whole.
  const out = [];
  for (let i = -1; i <= 2; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    out.push(monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return out;
}

// Local date and minutes-from-midnight of an instant, in a time zone.
export function localParts(instant, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

const localDateTime = (date, min) => `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;

// Google event ids may only use the characters 0-9 and a-v: encode the block id in base32hex.
export function eventIdFor(blockId) {
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  const bytes = Buffer.from(`ev${blockId}`, 'utf8');
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

const short = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const blockHash = (b, remind = null) => short(JSON.stringify([b.title, b.date, b.start, b.minutes, Boolean(b.done), b.notes || '', b.kind || '', remind]));
const serialize = (list) => `${JSON.stringify([...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), null, 1)}\n`;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function writeIfChanged(path, text) {
  const old = existsSync(path) ? await readFile(path, 'utf8') : null;
  if (old === text) return false;
  await mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true });
  await writeFile(path, text);
  return true;
}

// ---------- Google API ----------

export function google({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  let token = null;
  async function auth() {
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Google sign-in failed: ${json.error_description || json.error || res.status}`);
    token = json.access_token;
  }
  async function call(method, path, { query, body } = {}) {
    if (!token) await auth();
    const url = new URL(API + path);
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`${method} ${path}: ${json.error?.message || res.status}`); e.status = res.status; throw e; }
    return json;
  }
  async function all(path, query) {
    const items = []; let pageToken;
    do {
      const r = await call('GET', path, { query: { ...query, pageToken } });
      items.push(...(r.items || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return items;
  }
  return { call, all };
}

// ---------- the sync ----------

export async function run({ dir = '.', g, now = new Date(), log = console.log }) {
  const months = monthsAround(now);
  const timeMin = `${months[0]}-01T00:00:00Z`;
  const [ly, lm] = months[months.length - 1].split('-').map(Number);
  const timeMax = new Date(Date.UTC(ly, lm, 1)).toISOString();

  // Calendars: your time zone, the "Everyday" calendar (created if missing), and the ones to import.
  const calendars = await g.all('/users/me/calendarList', { minAccessRole: 'reader' });
  const primary = calendars.find((c) => c.primary) || calendars[0];
  const tz = primary?.timeZone || 'UTC';
  let mine = calendars.find((c) => (c.summary === CAL_NAME) && c.accessRole === 'owner');
  if (!mine) {
    mine = await g.call('POST', '/calendars', { body: { summary: CAL_NAME, timeZone: tz, description: 'Planned with Everyday. Changes here sync back to the app.' } });
    log(`Created the "${CAL_NAME}" calendar`);
  }
  const sources = calendars.filter((c) => c.selected && c.id !== mine.id && !c.deleted);

  // ---- 1. Google → Everyday: other calendars become read-only busy time.
  const byMonth = Object.fromEntries(months.map((m) => [m, []]));
  let imported = 0;
  for (const cal of sources) {
    const events = await g.all(`/calendars/${encodeURIComponent(cal.id)}/events`, { timeMin, timeMax, singleEvents: 'true', maxResults: '2500' });
    const calName = cal.summaryOverride || cal.summary;
    const calKey = short(cal.id).slice(0, 6);
    for (const ev of events) {
      if (ev.status === 'cancelled') continue;
      if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
      const base = {
        title: ev.summary || '(busy)', calendar: calName, color: cal.backgroundColor || '#6b7280',
        location: ev.location || '', link: ev.htmlLink || '', busy: ev.transparency !== 'transparent', updatedAt: Date.parse(ev.updated) || 0,
      };
      const parts = [];
      if (ev.start?.date) {
        for (let d = ev.start.date; d < ev.end.date; d = addDays(d, 1)) parts.push({ date: d, allDay: true, busy: false });
      } else if (ev.start?.dateTime) {
        const s = localParts(ev.start.dateTime, tz); const e = localParts(ev.end.dateTime, tz);
        for (let d = s.date; d <= e.date; d = addDays(d, 1)) {
          const from = d === s.date ? s.min : 0; const to = d === e.date ? e.min : 1440;
          if (to > from) parts.push({ date: d, start: from, minutes: to - from });
        }
      }
      for (const p of parts) {
        const rec = { ...base, ...p, id: `e${calKey}_${short(ev.id)}_${p.date.replace(/-/g, '')}` };
        const m = p.date.slice(0, 7);
        if (byMonth[m]) { byMonth[m].push(rec); imported++; }
      }
    }
  }
  for (const m of months) await writeIfChanged(`${dir}/data/events/${m}.json`, serialize(byMonth[m]));

  // ---- 2. Everyday ↔ the "Everyday" calendar.
  const statePath = `${dir}/data/gcal-state.json`;
  const state = await readJson(statePath, { pushed: {} });
  const blocksByMonth = {};
  for (const m of months) blocksByMonth[m] = await readJson(`${dir}/data/blocks/${m}.json`, []);
  const blocks = Object.values(blocksByMonth).flat();
  const existing = new Map((await g.all(`/calendars/${encodeURIComponent(mine.id)}/events`, { timeMin, timeMax, singleEvents: 'true', showDeleted: 'true', maxResults: '2500' }))
    .map((e) => [e.id, e]));
  const nowMs = now.getTime();
  const changedBlocks = new Set();
  let pushed = 0; let pulled = 0; let removed = 0;
  // Reminders: the task's own (task.remind, minutes before; -1 = none), else the default the app
  // keeps in data/config.json ({id: 'reminders', value: {default}}), else 10 minutes. None once done.
  const tasks = new Map((await readJson(`${dir}/data/tasks.json`, [])).filter((x) => !x.deleted).map((x) => [x.id, x]));
  const cfg = (await readJson(`${dir}/data/config.json`, [])).find((x) => x.id === 'reminders' && !x.deleted)?.value || {};
  const remindOf = (b) => {
    if (b.done || b.outcome) return -1;
    const own = b.remind ?? tasks.get(b.taskId)?.remind;
    const m = own ?? cfg.default ?? 10;
    return Number.isFinite(Number(m)) ? Number(m) : 10;
  };

  const toEvent = (b) => ({
    id: eventIdFor(b.id),
    summary: `${b.done ? '✓ ' : ''}${ICON[b.kind] || ''}${b.title}`,
    description: b.notes || undefined,
    start: { dateTime: localDateTime(b.date, b.start), timeZone: tz },
    end: b.start + b.minutes >= 1440
      ? { dateTime: localDateTime(addDays(b.date, 1), b.start + b.minutes - 1440), timeZone: tz }
      : { dateTime: localDateTime(b.date, b.start + b.minutes), timeZone: tz },
    status: 'confirmed',
    reminders: remindOf(b) >= 0 ? { useDefault: false, overrides: [{ method: 'popup', minutes: remindOf(b) }] } : { useDefault: false, overrides: [] },
    extendedProperties: { private: { everyday: b.id, h: blockHash(b, remindOf(b)) } },
  });
  const save = async (b, ev) => {
    const body = toEvent(b);
    const path = `/calendars/${encodeURIComponent(mine.id)}/events`;
    const out = ev ? await g.call('PUT', `${path}/${body.id}`, { body }) : await g.call('POST', path, { body });
    state.pushed[b.id] = { at: nowMs, updated: Date.parse(out?.updated) || nowMs };
    pushed++;
  };
  const setBlock = (b, patch) => {
    const list = blocksByMonth[b.date.slice(0, 7)];
    const i = list.findIndex((x) => x.id === b.id);
    const next = { ...b, ...patch, updatedAt: nowMs };
    // A block moved to another month leaves its old file and joins the new one.
    if (next.date && next.date.slice(0, 7) !== b.date.slice(0, 7)) {
      list.splice(i, 1);
      (blocksByMonth[next.date.slice(0, 7)] ||= []).push(next);
      changedBlocks.add(next.date.slice(0, 7));
    } else list[i] = next;
    changedBlocks.add(b.date.slice(0, 7));
    return next;
  };

  const liveIds = new Set();
  for (const b of blocks) {
    if (b.deleted || !b.date || b.start == null) continue;
    liveIds.add(b.id);
    const ev = existing.get(eventIdFor(b.id));
    const last = state.pushed[b.id];
    const editedInApp = !last || (b.updatedAt || 0) > last.at;
    if (ev && ev.status === 'cancelled') {
      if (last && !editedInApp) { setBlock(b, { deleted: true }); delete state.pushed[b.id]; removed++; continue; } // deleted in Google
      await save(b, ev); continue;
    }
    if (ev && last && !editedInApp && Date.parse(ev.updated) > last.updated + 2000) {
      // Changed in Google Calendar since we last wrote it: bring the time and title back.
      const s = localParts(ev.start.dateTime || `${ev.start.date}T00:00:00Z`, tz);
      const e = localParts(ev.end.dateTime || `${ev.end.date}T00:00:00Z`, tz);
      const minutes = e.date > s.date ? 1440 - s.min + e.min : e.min - s.min;
      const title = String(ev.summary || b.title).replace(/^✓ /, '').replace(/^(↳|🍽|🛒) /u, '');
      const nb = setBlock(b, { date: s.date, start: s.min, minutes: Math.max(5, minutes), title, notes: ev.description || b.notes || '' });
      state.pushed[b.id] = { at: nb.updatedAt, updated: Date.parse(ev.updated) };
      if (ev.extendedProperties?.private?.h !== blockHash(nb, remindOf(nb))) await save(nb, ev);
      pulled++;
      continue;
    }
    if (!ev || ev.extendedProperties?.private?.h !== blockHash(b, remindOf(b))) await save(b, ev);
  }
  // Events whose block is gone (deleted in the app, or out of the synced months).
  for (const ev of existing.values()) {
    const id = ev.extendedProperties?.private?.everyday;
    if (ev.status === 'cancelled' || !id || liveIds.has(id)) continue;
    await g.call('DELETE', `/calendars/${encodeURIComponent(mine.id)}/events/${ev.id}`);
    delete state.pushed[id];
    removed++;
  }

  for (const m of changedBlocks) await writeIfChanged(`${dir}/data/blocks/${m}.json`, serialize(blocksByMonth[m]));
  await writeIfChanged(statePath, `${JSON.stringify(state, null, 1)}\n`);
  const status = {
    id: 'status', updatedAt: nowMs, lastRun: now.toISOString(), timeZone: tz, calendar: CAL_NAME,
    imported: sources.map((c) => c.summaryOverride || c.summary), events: imported, blocks: liveIds.size, error: null,
  };
  await writeStatus(dir, status);
  log(`Imported ${imported} events from ${sources.length} calendars; pushed ${pushed}, pulled back ${pulled}, removed ${removed}.`);
  return { imported, pushed, pulled, removed };
}

async function writeStatus(dir, status) {
  // Keep the run time out of the comparison, so an unchanged sync doesn't make a commit.
  const path = `${dir}/data/gcal.json`;
  const old = (await readJson(path, []))[0];
  if (old && JSON.stringify({ ...old, updatedAt: 0, lastRun: '' }) === JSON.stringify({ ...status, updatedAt: 0, lastRun: '' })
    && Date.now() - Date.parse(old.lastRun) < 2 * 3600e3) return;
  await writeIfChanged(path, `${JSON.stringify([status], null, 1)}\n`);
}

// ---------- entry point ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REFRESH_TOKEN: refreshToken } = process.env;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log('Google Calendar is not set up (missing secrets): nothing to do.');
    process.exit(0);
  }
  try {
    await run({ g: google({ clientId, clientSecret, refreshToken }) });
  } catch (e) {
    console.error(e.message);
    await writeStatus('.', { id: 'status', updatedAt: Date.now(), lastRun: new Date().toISOString(), error: e.message });
    process.exitCode = 1;
  }
}
