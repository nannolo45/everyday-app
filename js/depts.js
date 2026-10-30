// Departments for Everyday's shopping list: Ricette's food departments (categories.js, copied
// from Ricette, in supermarket order) plus two for things that aren't food: household
// (cleaning supplies, paper, bags…) and personal care. Ricette doesn't know these two, so it
// shows such items under "Other".
import { CATEGORIES, categorize } from './categories.js';
import { normalizeName } from './parse.js';

const re = (list) => new RegExp(`(?:^|[^a-zà-öø-ÿ])(?:${list.join('|')})`, 'i');

const EXTRA = [
  ['household', '🧽', re(['detersiv', 'detergent', 'sgrassator', 'candeggin', 'ammorbident', 'anticalcare', 'brillantant', 'lavastoviglie', 'lavatrice', 'sapone (?:per i piatti|piatti|bucato)', 'spugn', 'panno', 'panni', 'stracc', 'scopa', 'carta igienica', 'carta da cucina', 'scottex', 'tovagliol', 'fazzolett', 'sacchett', 'sacchi (?:della|per la) spazzatura', 'pellicola', 'alluminio', 'carta forno', 'lampadin', 'pil(?:a|e)(?![a-z])', 'insetticid', 'deodorante per ambienti', 'guanti',
    'putzmittel', 'spülmittel', 'waschmittel', 'weichspüler', 'reiniger', 'entkalker', 'schwamm', 'lappen', 'besen', 'toilettenpapier', 'klopapier', 'küchenrolle', 'servietten', 'taschentücher', 'müllbeutel', 'frischhaltefolie', 'alufolie', 'backpapier', 'glühbirne', 'batterie', 'spülmaschine', 'spültabs', 'geschirrspül', 'regeneriersalz', 'klarspüler',
    'cleaner', 'detergent', 'bleach', 'softener', 'dish soap', 'washing up liquid', 'laundry', 'sponge', 'cloth', 'mop', 'broom', 'toilet paper', 'kitchen roll', 'paper towel', 'napkins', 'tissues', 'bin bags', 'trash bags', 'cling film', 'foil', 'baking paper', 'light bulb', 'batteries', 'dishwasher', 'rinse aid', 'washing machine'])],
  ['care', '🧴', re(['shampoo', 'balsamo', 'bagnoschiuma', 'docciaschiuma', 'sapone(?! (?:per i piatti|piatti|bucato))', 'dentifricio', 'spazzolin', 'filo interdentale', 'collutorio', 'deodorante(?! per ambienti)', 'crema (?:viso|mani|corpo|solare)', 'rasoi', 'lamette', 'schiuma da barba', 'assorbent', 'cotton fioc', 'dischetti', 'cerott', 'pannolin', 'salviettine', 'struccante', 'trucco',
    'duschgel', 'spülung', 'seife', 'zahnpasta', 'zahnbürste', 'zahnseide', 'mundspülung', 'deo', 'creme', 'rasierer', 'rasierschaum', 'binden', 'tampons', 'wattestäbchen', 'pflaster', 'windeln', 'feuchttücher',
    'shower gel', 'conditioner', 'soap', 'toothpaste', 'toothbrush', 'floss', 'mouthwash', 'deodorant', 'lotion', 'razor', 'shaving', 'pads', 'tampons', 'cotton buds', 'plasters', 'band-aid', 'nappies', 'diapers', 'wipes'])],
];

export const NONFOOD = EXTRA.map(([id]) => id);
// Food departments first, then household and personal care, then "other" last.
export const DEPTS = [...CATEGORIES.filter((c) => c.id !== 'other'), ...EXTRA.map(([id, icon]) => ({ id, icon })), CATEGORIES.find((c) => c.id === 'other')];
export const DEPT_IDS = DEPTS.map((c) => c.id);
export const deptIcon = (id) => (DEPTS.find((c) => c.id === id) || DEPTS.at(-1)).icon;

export function deptOf(item) {
  if (item.cat && DEPT_IDS.includes(item.cat)) return item.cat;
  const n = ` ${normalizeName(item.name || '')}`;
  for (const [id, , rx] of EXTRA) if (rx.test(n)) return id;
  return categorize(item.name || '');
}
