// Travel times between places, with no key by default:
//   - addresses → coordinates: OpenStreetMap's Nominatim;
//   - walking, cycling, driving: OSRM (OpenStreetMap routing);
//   - public transport: VBB's open API (Berlin-Brandenburg; elsewhere it answers "unknown").
// With a Google key (Settings → Travel), Google's Routes API is used for everything instead.
// Pure: no DOM, no storage. The caller gives `fetchFn`, `cache` (an object it keeps) and `now`.

export const MODES = ['walk', 'bike', 'transit', 'car'];
export const MODE_ICON = { walk: '🚶', bike: '🚲', transit: '🚌', car: '🚗' };
export const UNKNOWN_MINUTES = 30; // what the planner uses until a time is known
const RETRY_MS = 10 * 60 * 1000; // a failed lookup is tried again after this

const ENDPOINTS = {
  nominatim: 'https://nominatim.openstreetmap.org/search',
  osrm: 'https://router.project-osrm.org/route/v1',
  vbb: 'https://v6.vbb.transport.rest/journeys',
  google: 'https://routes.googleapis.com/directions/v2:computeRoutes',
};
const OSRM_PROFILE = { walk: 'foot', bike: 'bike', car: 'driving' };
const GOOGLE_MODE = { walk: 'WALK', bike: 'BICYCLE', transit: 'TRANSIT', car: 'DRIVE' };

export const keyOf = (mode, from, to) => `${mode}|${norm(from)}|${norm(to)}`;
export const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const isCoord = (s) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(s || '').trim());
const coordOf = (s) => { const [lat, lon] = String(s).split(',').map((v) => Number(v.trim())); return { lat, lon }; };

async function getJson(fetchFn, url, init = {}, ms = 12000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetchFn(url, { ...init, signal: ctrl?.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

// An address → {lat, lon}, or null when it can't be found. Cached under cache.geo[address].
export async function geocode(address, { fetchFn, cache, now = Date.now() }) {
  if (isCoord(address)) return coordOf(address);
  cache.geo = cache.geo || {};
  const k = norm(address);
  const hit = cache.geo[k];
  if (hit && (hit.lat != null || now - (hit.at || 0) < RETRY_MS)) return hit.lat != null ? { lat: hit.lat, lon: hit.lon } : null;
  const url = `${ENDPOINTS.nominatim}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const data = await getJson(fetchFn, url, { headers: { Accept: 'application/json' } });
  const r = Array.isArray(data) && data[0];
  cache.geo[k] = r ? { lat: Number(r.lat), lon: Number(r.lon), name: r.display_name, at: now } : { at: now };
  return r ? { lat: Number(r.lat), lon: Number(r.lon) } : null;
}

async function osrm(from, to, mode, ctx) {
  const url = `${ENDPOINTS.osrm}/${OSRM_PROFILE[mode]}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const data = await getJson(ctx.fetchFn, url);
  const sec = data?.routes?.[0]?.duration;
  return Number.isFinite(sec) ? Math.ceil(sec / 60) : null;
}

async function vbb(from, to, departAt, ctx) {
  const q = new URLSearchParams({
    'from.latitude': from.lat, 'from.longitude': from.lon, 'from.address': 'from',
    'to.latitude': to.lat, 'to.longitude': to.lon, 'to.address': 'to',
    departure: new Date(departAt).toISOString(), results: '1', stopovers: 'false', remarks: 'false',
  });
  const data = await getJson(ctx.fetchFn, `${ENDPOINTS.vbb}?${q}`);
  const legs = data?.journeys?.[0]?.legs;
  if (!legs?.length) return null;
  const dep = new Date(legs[0].departure || legs[0].plannedDeparture).getTime();
  const arr = new Date(legs.at(-1).arrival || legs.at(-1).plannedArrival).getTime();
  if (!dep || !arr || arr <= dep) return null;
  // The journey may start later than asked: waiting for it counts too.
  return Math.ceil((arr - Math.min(dep, departAt)) / 60000);
}

async function google(from, to, mode, departAt, ctx) {
  const place = (p) => (isCoord(p) ? { location: { latLng: { latitude: coordOf(p).lat, longitude: coordOf(p).lon } } } : { address: p });
  const body = { origin: place(from), destination: place(to), travelMode: GOOGLE_MODE[mode] };
  if (mode === 'transit' || mode === 'car') body.departureTime = new Date(Math.max(departAt, ctx.now + 60000)).toISOString();
  const data = await getJson(ctx.fetchFn, ENDPOINTS.google, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': ctx.googleKey, 'X-Goog-FieldMask': 'routes.duration' },
  });
  const dur = data?.routes?.[0]?.duration; // "1234s"
  const sec = dur ? Number(String(dur).replace(/s$/, '')) : NaN;
  return Number.isFinite(sec) ? Math.ceil(sec / 60) : null;
}

// Minutes from `from` to `to` by `mode`, leaving at `departAt` (ms). Cached under cache.routes[key];
// a failure is remembered for a while so the network isn't hit again and again. Null = unknown.
export async function travelMinutes(from, to, mode, departAt, ctx) {
  const { cache, now = Date.now() } = ctx;
  if (!from || !to || !MODES.includes(mode)) return null;
  if (norm(from) === norm(to)) return 0;
  cache.routes = cache.routes || {};
  const k = keyOf(mode, from, to);
  const hit = cache.routes[k];
  if (hit && (hit.minutes != null || now - (hit.at || 0) < RETRY_MS)) return hit.minutes ?? null;
  let minutes = null;
  if (ctx.googleKey) minutes = await google(from, to, mode, departAt, { ...ctx, now });
  else {
    const a = await geocode(from, { ...ctx, now }); const b = a && await geocode(to, { ...ctx, now });
    if (a && b) minutes = mode === 'transit' ? await vbb(a, b, departAt, ctx) : await osrm(a, b, mode, ctx);
  }
  cache.routes[k] = { minutes, at: now };
  return minutes;
}

// A cached answer without any network: minutes, null (known to be unknown) or undefined (never asked).
export function cachedMinutes(cache, mode, from, to) {
  if (!from || !to) return undefined;
  if (norm(from) === norm(to)) return 0;
  const hit = cache?.routes?.[keyOf(mode, from, to)];
  return hit ? hit.minutes ?? null : undefined;
}
// Was the address looked up and not found?
export function placeNotFound(cache, address) {
  if (!address || isCoord(address)) return false;
  const hit = cache?.geo?.[norm(address)];
  return Boolean(hit && hit.lat == null);
}
