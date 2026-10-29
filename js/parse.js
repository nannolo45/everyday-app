// Ingredient parsing, unit handling, scaling and formatting (IT / DE / EN).

const UNICODE_FRACTIONS = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5',
  '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

// canonical unit -> aliases (lowercase, without trailing dot)
const UNIT_ALIASES = {
  g: ['g', 'gr', 'grs', 'gram', 'grams', 'gramm', 'gramme', 'grammo', 'grammi', 'grammes'],
  kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramm', 'chilo', 'chili', 'chilogrammo', 'chilogrammi'],
  mg: ['mg', 'milligram', 'milligrams', 'milligramm', 'milligrammi'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'millilitro', 'millilitri'],
  cl: ['cl', 'centiliter', 'centilitro', 'centilitri'],
  dl: ['dl', 'deciliter', 'decilitro', 'decilitri'],
  l: ['l', 'lt', 'liter', 'liters', 'litre', 'litres', 'litro', 'litri'],
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't', 'tl', 'teelöffel', 'cucchiaino', 'cucchiaini', 'cucchiaino da tè', 'cucchiaini da tè'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons', 'el', 'esslöffel', 'cucchiaio', 'cucchiai'],
  cup: ['cup', 'cups', 'c', 'tazza', 'tazze', 'tasse', 'tassen'],
  floz: ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
  oz: ['oz', 'ounce', 'ounces', 'unze', 'unzen', 'oncia', 'once'],
  lb: ['lb', 'lbs', 'pound', 'pounds', 'pfund', 'libbra', 'libbre'],
  pinch: ['pinch', 'pinches', 'pizzico', 'pizzichi', 'prise', 'prisen', 'presa'],
  clove: ['clove', 'cloves', 'spicchio', 'spicchi', 'zehe', 'zehen'],
  can: ['can', 'cans', 'tin', 'tins', 'lattina', 'lattine', 'scatola', 'scatole', 'dose', 'dosen'],
  pcs: ['pc', 'pcs', 'piece', 'pieces', 'pz', 'pezzo', 'pezzi', 'stück', 'stk', 'st'],
  bunch: ['bunch', 'bunches', 'mazzo', 'mazzi', 'mazzetto', 'mazzetti', 'bund', 'bünde'],
  slice: ['slice', 'slices', 'fetta', 'fette', 'scheibe', 'scheiben'],
  packet: ['packet', 'packets', 'pack', 'packs', 'package', 'packages', 'pkg', 'confezione', 'confezioni', 'bustina', 'bustine', 'busta', 'päckchen', 'packung', 'packungen', 'pck', 'pkt'],
};

const ALIAS_TO_UNIT = new Map();
for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const a of aliases) ALIAS_TO_UNIT.set(a, unit);
}
// Longest aliases first so multi-word aliases win.
const ALIASES_SORTED = [...ALIAS_TO_UNIT.keys()].sort((a, b) => b.length - a.length);

export const UNITS = ['', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'pcs', 'can', 'packet', 'clove', 'bunch', 'slice', 'pinch', 'oz', 'lb', 'floz', 'mg', 'cl', 'dl'];

const DIMENSIONS = {
  mass: { g: 1, kg: 1000, mg: 0.001, oz: 28.3495, lb: 453.592 },
  volume: { ml: 1, l: 1000, dl: 100, cl: 10, tsp: 5, tbsp: 15, cup: 240, floz: 29.5735 },
  count: { '': 1, pcs: 1 },
};

function dimensionOf(unit) {
  for (const [dim, table] of Object.entries(DIMENSIONS)) if (unit in table) return dim;
  return null;
}

// Convert qty from one unit to another; returns null when not convertible.
export function convert(qty, from, to) {
  from = from || ''; to = to || '';
  if (from === to) return qty;
  const d = dimensionOf(from);
  if (!d || d !== dimensionOf(to)) return null;
  return (qty * DIMENSIONS[d][from]) / DIMENSIONS[d][to];
}

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`;
const QTY_RE = new RegExp(String.raw`^${NUM}(?:\s*(?:-|–|—|to|a|bis|o|or|oder)\s*${NUM})?`, 'i');
const LEADING_WORDS_RE = /^(?:about|approx\.?|approximately|circa|ca\.?|etwa|ungefähr|rund)\s+/i;
const TO_TASTE_RE = /\s*[,(]?\s*\b(?:q\.?\s?b\.?|quanto basta|to taste|as needed|a piacere|nach belieben|nach geschmack|etwas)\b\.?\s*\)?\s*$/i;

function toNumber(t) {
  t = t.trim();
  let m;
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  return parseFloat(t.replace(',', '.'));
}

export function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parse a single ingredient line into {raw, qty, unit, name, note}.
export function parseIngredient(raw) {
  const original = (raw || '').trim();
  let s = original.replace(/^[\s\-–•*·▢□☐]+/, '');
  for (const [u, f] of Object.entries(UNICODE_FRACTIONS)) s = s.replaceAll(u, ` ${f}`);
  s = s.replace(/(\d)\s+(\d+\/\d+)/g, '$1 $2').replace(/\s+/g, ' ').trim();
  s = s.replace(LEADING_WORDS_RE, '');

  let note = '';
  const taste = s.match(TO_TASTE_RE);
  if (taste) { note = taste[0].replace(/^[\s,(]+|[\s)]+$/g, ''); s = s.slice(0, taste.index).trim(); }

  let qty = null;
  const m = s.match(QTY_RE);
  if (m) {
    qty = toNumber(m[2] || m[1]);
    s = s.slice(m[0].length).trim();
  }

  let unit = '';
  const lower = s.toLowerCase();
  for (const alias of ALIASES_SORTED) {
    if (!lower.startsWith(alias)) continue;
    const next = lower.charAt(alias.length);
    if (next === '' || next === ' ' || next === '.' || next === ')' || next === ',') {
      // single-letter aliases ("t", "c", "l") only count right after a number
      if (alias.length === 1 && qty == null) break;
      // "l" / "t" / "c" followed by a name start like "l'olio" are not units
      unit = ALIAS_TO_UNIT.get(alias);
      s = s.slice(alias.length).replace(/^\.\s*/, '').trim();
      break;
    }
  }

  // Drop "(240 ml)" style hints, connectors like "di", "d'", "of".
  s = s.replace(/^\(.*?\)\s*/, '').replace(/^(?:di|of|von)\s+/i, '').replace(/^d['’]\s*/i, '').trim();

  let name = s;
  const comma = s.indexOf(',');
  if (comma > 0) {
    const extra = s.slice(comma + 1).trim();
    name = s.slice(0, comma).trim();
    note = [extra, note].filter(Boolean).join(', ');
  }
  if (!name) name = original;
  return { raw: original, qty: Number.isFinite(qty) ? qty : null, unit, name, note };
}

export function scaleQty(qty, from, to) {
  if (qty == null || !from || !to) return qty;
  return (qty * to) / from;
}

const NICE_FRACTIONS = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
const FRACTION_UNITS = new Set(['', 'pcs', 'tsp', 'tbsp', 'cup', 'can', 'packet', 'clove', 'bunch', 'slice', 'pinch']);

export function formatQty(qty, unit = '') {
  if (qty == null || !Number.isFinite(qty)) return '';
  if (FRACTION_UNITS.has(unit)) {
    let whole = Math.floor(qty);
    const frac = qty - whole;
    let best = NICE_FRACTIONS[0];
    for (const f of NICE_FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
    if (best[0] === 1) { whole += 1; best = NICE_FRACTIONS[0]; }
    if (whole === 0 && !best[1]) return qty > 0 ? '⅛' : '0';
    return `${whole || ''}${best[1]}`;
  }
  let v;
  if (qty >= 100) v = Math.round(qty / 5) * 5;
  else if (qty >= 10) v = Math.round(qty);
  else v = Math.round(qty * 10) / 10;
  return String(v).replace('.', decimalSeparator());
}

let _decimal = '.';
export function setDecimalSeparator(sep) { _decimal = sep; }
function decimalSeparator() { return _decimal; }

// Bring a quantity to a friendlier unit (1500 g -> 1.5 kg).
export function tidy(qty, unit) {
  if (qty == null) return { qty, unit };
  if (unit === 'g' && qty >= 1000) return { qty: qty / 1000, unit: 'kg' };
  if (unit === 'ml' && qty >= 1000) return { qty: qty / 1000, unit: 'l' };
  if (unit === 'kg' && qty < 1) return { qty: qty * 1000, unit: 'g' };
  if (unit === 'l' && qty < 1) return { qty: qty * 1000, unit: 'ml' };
  return { qty, unit };
}

// Add b to a (same name). Returns {qty, unit} or null if units incompatible.
export function addQuantities(a, b) {
  if (a.qty == null && b.qty == null) return { qty: null, unit: a.unit || b.unit };
  if (a.qty == null) return { qty: b.qty, unit: b.unit };
  if (b.qty == null) return { qty: a.qty, unit: a.unit };
  if ((a.unit || '') === (b.unit || '')) return { qty: a.qty + b.qty, unit: a.unit };
  const conv = convert(b.qty, b.unit, a.unit);
  if (conv == null) return null;
  return tidy(a.qty + conv, a.unit);
}

// Loose name match: "farina" ~ "farina 00", "egg" ~ "eggs".
export function namesMatch(a, b) {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sing = (s) => s.replace(/(?:es|s)$/, '');
  if (sing(x) === sing(y)) return true;
  return x.startsWith(y + ' ') || y.startsWith(x + ' ');
}

export function stepFor(unit) {
  if (unit === 'g' || unit === 'ml') return 100;
  if (unit === 'mg') return 100;
  if (unit === 'cl' || unit === 'dl') return 1;
  if (unit === 'kg' || unit === 'l') return 0.5;
  return 1;
}
