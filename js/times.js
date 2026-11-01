// Cooking times in Italian, German and English:
// - durations in text ("30 mins", "1 ora e 15 minuti", "1½ Stunden", "mezz'ora", "über Nacht")
// - labelled times ("Prep time: 20 min", "Cottura: 40 minuti", "Ruhezeit: 1 Std.")
// - an estimate from the steps, split into active work and waiting (oven, resting, rising, cooling…)
// Shared by the app and the GitHub job (scripts/lib/times.js is a verbatim copy).

const NUM = String.raw`(\d+(?:[.,]\d+)?(?:\s*½)?|½)`;
const UNIT = String.raw`(ore|ora|h|hrs?|hours?|std\.?|stunden?|minuti|minuto|minutes?|minuten|mins?\.?|min\.?|m|'|giorni|giorno|days?|tage?n?|secondi|secondo|seconds?|sekunden|secs?\.?)`;
const RANGE = String.raw`(?:\s*(?:-|–|—|a|to|bis|o|or|oder)\s*${NUM})?`;
const DUR = new RegExp(String.raw`(?:(?:da|from|von|ca\.?|circa|about|approx\.?|etwa|ungefähr|rund)\s+)?${NUM}${RANGE}\s*${UNIT}(?![a-zà-ü])`, 'gi');
// (?<!…)/(?!…) instead of \b: \b doesn't know letters like ü
const W = (body) => new RegExp(`(?<![a-zà-öø-ÿ])(?:${body})(?![a-zà-öø-ÿ])`, 'gi');
const WORDS = [
  [W(`mezz['’]?\\s?ora|half an hour|einer? halben? stunde`), 30],
  [W(`un['’]\\s?ora(?! e)|an hour|one hour|eine stunde|einer stunde`), 60],
  [W(`un quarto d['’]ora|a quarter of an hour|eine viertelstunde`), 15],
  [W(`tutta la notte|una notte|per una notte|overnight|über nacht|ueber nacht`), 480],
];

const num = (s) => (s === '½' ? 0.5 : parseFloat(String(s).replace(',', '.').replace(/\s*½/, '.5')));
function unitMinutes(u) {
  u = u.toLowerCase();
  if (/^(ore|ora|h|hr|hour|std|stund)/.test(u)) return 60;
  if (/^(giorn|day|tag)/.test(u)) return 1440;
  if (/^(second|sek|sec)/.test(u)) return 1 / 60;
  return 1;
}

/** Every duration in a text: [{min, index, end}] (ranges count as their upper end). */
export function durationsIn(text) {
  const s = String(text || '');
  const out = [];
  DUR.lastIndex = 0;
  let m;
  while ((m = DUR.exec(s))) {
    const n = num(m[2] || m[1]);
    if (!Number.isFinite(n)) continue;
    out.push({ min: n * unitMinutes(m[3]), index: m.index, end: m.index + m[0].length });
  }
  for (const [re, min] of WORDS) {
    re.lastIndex = 0;
    while ((m = re.exec(s))) out.push({ min, index: m.index, end: m.index + m[0].length });
  }
  // "1 ora e 15 minuti", "1 h 20 min", "2 Stunden und 10 Minuten": glue neighbours into one duration
  out.sort((a, b) => a.index - b.index);
  const merged = [];
  for (const d of out) {
    const prev = merged[merged.length - 1];
    // only whole hours take minutes ("1 h 15 m" + "6 m" are two times, as in a table)
    if (prev && !prev.glued && /^\s*(?:e|and|und|,)?\s*$/i.test(s.slice(prev.end, d.index)) && prev.min >= 60 && prev.min % 60 === 0 && d.min < 60) {
      prev.min += d.min; prev.end = d.end; prev.glued = true;
    } else merged.push({ ...d });
  }
  return merged.map(({ glued, ...d }) => ({ ...d, min: Math.round(d.min * 10) / 10 }));
}

/** Minutes in a short time text ("1 h 20 min", "30 mins", "mezz'ora"), or null. */
export function parseMinutes(text) {
  const d = durationsIn(text);
  if (!d.length) return null;
  return Math.round(d.reduce((a, x) => a + x.min, 0));
}

const LABELS = [
  ['total', /(?:tempo\s+totale|tempo\s+complessivo|total(?:e)?(?:\s+time)?|ready\s+in|pronto\s+in|gesamtzeit|gesamt|insgesamt|zeit\s+gesamt)/i],
  ['rest', /(?:tempo\s+di\s+riposo|riposo|lievitazione|marinatura|refrigerazione|in\s+frigo(?:rifero)?|rest(?:ing)?(?:\s+time)?|chill(?:ing)?(?:\s+time)?|standing\s+time|proving(?:\s+time)?|rising(?:\s+time)?|marinating(?:\s+time)?|ruhezeit|gehzeit|kühlzeit|wartezeit|marinierzeit|ruhen\s+lassen)/i],
  ['cook', /(?:tempo\s+di\s+cottura|cottura|cook(?:ing)?(?:\s+time)?|bak(?:e|ing)(?:\s+time)?|kochzeit|backzeit|garzeit|koch-?\s*(?:\/|und)?\s*backzeit|backen)/i],
  ['prep', /(?:tempo\s+di\s+preparazione|preparazione|prep(?:aration)?(?:\s+time)?|zubereitungszeit|zubereitung|arbeitszeit|vorbereitung(?:szeit)?|active\s+time|hands[- ]on(?:\s+time)?|tempo\s+attivo)/i],
];

/**
 * Labelled times anywhere in a text ("Prep time: 30 mins · Cook time: 20 mins").
 * → {prep, cook, rest, total} in minutes (only the ones found).
 */
export function extractTimes(text) {
  const s = String(text || '');
  const out = {};
  for (const [key, re] of LABELS) {
    const g = new RegExp(`${re.source}\\s*[:\\-–=]?\\s*(?:ca\\.?|circa|about|approx\\.?|etwa|ungefähr|rund)?\\s*`, 'gi');
    let m;
    while ((m = g.exec(s))) {
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 40);
      // the duration must come right after the label ("Cottura: 40 minuti", not "a fine cottura aggiungete…")
      const d = durationsIn(after).filter((x) => x.index <= 2);
      if (!d.length) continue;
      let min = d[0].min;
      // "1 h 20 min" right after it
      const rest = durationsIn(after.slice(d[0].end)).filter((x) => x.index <= 3);
      if (rest.length && min >= 60 && rest[0].min < 60) min += rest[0].min;
      if (out[key] == null) out[key] = Math.round(min);
      break;
    }
  }
  // "Preparazione: 20 min" is prep; the bare word "Preparazione" (method heading) has no duration, so it's skipped above
  return out;
}

export function hasTimes(t) { return Boolean(t && ['prep', 'cook', 'rest', 'total'].some((k) => Number.isFinite(t[k]))); }

// ---------- estimate from the steps ----------

const WAIT = /(?:forn[oi]|in forno|oven|ofen|backen|back(?:t|e)|bake|baking|roast|arrosti|riposa|riposo|rest(?:ing)?\b|ruhen|lievit|rise|rising|prove|proof|gehen lassen|aufgehen|raffredd|intiepid|cool(?:ed|ing)?\b|abkühl|auskühl|erkalt|frigo|fridge|refrigerat|kühlschrank|kalt stellen|chill|marin|freez|congel|gefrier|ammoll|soak|einweich|sobboll|simmer|köchel|kochen lassen|stufat|stew|schmor|brasa|braise|lasciate?|lascia|leave|let (?:it|them|the)|lassen|infus|steep|ziehen lassen|ziehen|cuocere a fuoco (?:basso|dolce)|on low heat|bei schwacher hitze)/i;
const ACTIVE = /(?:impast|knead|knet|mescol|girate|stir(?:ring)?|rühr|mont[ai]|whisk|whip|schlag|frigg|fry|frying|brat(?:en)?|anbrat|rosol|soffrigg|saut|scotta|sear|trit[ai]|chop|hack|tagli|slice|dice|cut\b|schneid|grattugi|grate|reib|sbatt|beat|spalm|spread|stend|roll out|ausroll|form[ai]|shape|forme|frull|blend|püri|mix|lavor[ai]|amalgam|incorpor|pela|peel|schäl|sfoglia)/i;
const PREHEAT = /(?:preriscald|pre-?heat|vorheiz|vorgeheizt|accendete il forno)/i;
const CHOP = /(?:trit[ai]|tagli|a cubetti|a dadini|a fettine|a rondelle|chop|dice|slice|mince|julienne|schneid|würfel|hack|in scheiben|in streifen|grattugi|grate|reib|pela|peel|schäl)/gi;

// waiting nobody timed: "leave it to cool down completely", "let it rise until doubled", "cook the pasta"
const IMPLICIT = [
  ['rest', 60, /(?:raffredd\w* (?:completamente|del tutto)|far(?:e|la|lo)? raffreddare|cool(?:ed)? (?:down )?completely|completely cool|let (?:it |them )?cool|(?:vollständig|ganz|komplett) (?:ab|aus)kühl|abkühlen lassen|auskühlen lassen)/i],
  ['rest', 90, /(?:fino al raddoppio|raddoppi\w* (?:di |il )?volume|until (?:it has )?doubled|doubled in size|bis (?:sich )?(?:das volumen|der teig) (?:sich )?verdoppelt)/i],
  ['rest', 30, /(?:lascia\w* (?:lievitare|riposare|insaporire|marinare)|let (?:it |them |the dough )?(?:rise|rest|prove|proof|marinate)|gehen lassen|ruhen lassen|ziehen lassen|marinieren lassen)/i],
  ['rest', 60, /(?:in frigo(?:rifero)?|refrigerat|chill(?:ed)?\b|in den kühlschrank|kalt stellen|kühl stellen)/i],
  ['cook', 10, /(?:cuoc\w* (?:la pasta|gli spaghetti|le penne|i rigatoni|le linguine|le tagliatelle|i fusilli)|lessa\w* la pasta|cook the (?:pasta|spaghetti|noodles)|boil the (?:pasta|spaghetti)|(?:nudeln|spaghetti|pasta) (?:al dente )?kochen)/i],
];
const REST_WORDS = /(?:riposa|riposo|rest(?:ing)?\b|ruhen|lievit|rise|rising|prove|proof|gehen lassen|aufgehen|raffredd|intiepid|cool|abkühl|auskühl|erkalt|frigo|fridge|refrigerat|kühlschrank|kalt stellen|chill|marin|freez|congel|gefrier|ammoll|soak|einweich|infus|steep|ziehen)/i;

const sentences = (text) => String(text || '').split(/(?<=[.!?;])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/** {active, waiting, timed}: minutes from the steps; timed = how many durations were found. */
export function estimateFromSteps(r) {
  const steps = (r.steps || []).map(String);
  const ingredients = (r.ingredients || []).length;
  let active = 0;
  let waiting = 0;
  let timed = 0;
  let untimedSteps = 0;
  let cookWaitShare = { wait: 0, active: 0 };
  let restWait = 0;
  let cookWait = 0;
  for (const step of steps) {
    let stepTimed = false;
    for (const sen of sentences(step)) {
      if (PREHEAT.test(sen)) continue; // the oven heats up while you work
      const ds = durationsIn(sen).filter((d) => d.min >= 0.5 && d.min <= 4320);
      if (!ds.length) {
        const imp = IMPLICIT.find(([, , re]) => re.test(sen));
        if (imp) { waiting += imp[1]; if (imp[0] === 'rest') restWait += imp[1]; else cookWait += imp[1]; }
        continue;
      }
      // a range of options ("20-25 minutes", "or 1 hour") already counts as its upper end: take the longest
      const min = Math.max(...ds.map((d) => d.min));
      const isWait = WAIT.test(sen);
      const isActive = ACTIVE.test(sen);
      if ((isWait && !(isActive && min <= 10)) || (!isActive && min >= 15)) {
        waiting += min;
        if (REST_WORDS.test(sen) && !/(?:forn|oven|ofen|bake|backen|inforn)/i.test(sen)) restWait += min;
        else { cookWait += min; cookWaitShare.wait += min; }
      }
      else { active += min; cookWaitShare.active += min; }
      timed++;
      stepTimed = true;
    }
    if (!stepTimed) untimedSteps++;
    // chopping, peeling, grating: a couple of minutes each
    active += Math.min(10, (step.match(CHOP) || []).length * 2);
  }
  // measuring and handling the ingredients, plus the steps nobody timed
  active += Math.min(25, ingredients * 1.5) + Math.min(20, untimedSteps * 2);
  return { active: Math.max(5, Math.round(active)), waiting: Math.round(waiting), restWait: Math.round(restWait), cookWait: Math.round(cookWait), timed, cookWaitShare };
}

/**
 * Active and waiting minutes for a recipe:
 *  1. your own numbers (prepMin / waitMin, set while editing)
 *  2. times stated by the recipe (r.times from the import, labels in the notes, the total in r.time)
 *  3. an estimate from the steps
 * → {active, waiting, total, estimated, source}
 */
export function recipeTimes(r, { minutesOfTotal = parseMinutes } = {}) {
  const manualA = Number.isFinite(r.prepMin) ? r.prepMin : null;
  const manualW = Number.isFinite(r.waitMin) ? r.waitMin : null;
  const est = estimateFromSteps(r);
  if (manualA != null && manualW != null) return { active: manualA, waiting: manualW, total: manualA + manualW, estimated: false, source: 'manual' };
  const stated = { ...extractTimes(r.notes || ''), ...(r.times || {}) };
  const total = minutesOfTotal(r.time) ?? stated.total ?? null;
  let active;
  let waiting;
  let estimated = false;
  if (stated.prep != null && (stated.cook != null || stated.rest != null || total != null)) {
    // cooking time: waiting if the steps say it's oven/simmering/resting work, otherwise hands-on
    const cookIsWait = est.cookWaitShare.wait >= est.cookWaitShare.active;
    active = stated.prep + (stated.cook != null && !cookIsWait ? stated.cook : 0);
    waiting = (stated.rest ?? est.restWait) + (stated.cook != null && cookIsWait ? stated.cook : 0);
    if (total != null && stated.cook == null && stated.rest == null) waiting = Math.max(0, total - stated.prep);
    // "Total 9 h 40" with 1 h 30 work and 10 min cooking: the rest is waiting nobody listed (marinating overnight…)
    if (total != null && active + waiting < total) waiting = total - active;
  } else if (total != null) {
    // only the total: keep it, split it the way the steps suggest
    waiting = Math.min(est.waiting, Math.max(0, total - 5));
    active = Math.max(0, total - waiting);
    estimated = true;
  } else if (stated.cook != null || stated.rest != null) {
    const cookIsWait = est.cookWaitShare.wait >= est.cookWaitShare.active;
    active = est.active + (stated.cook != null && !cookIsWait ? stated.cook : 0);
    waiting = (stated.rest ?? est.restWait) + (stated.cook != null && cookIsWait ? stated.cook : est.cookWait);
    estimated = true;
  } else {
    active = est.active;
    waiting = est.waiting;
    estimated = true;
  }
  if (manualA != null) { active = manualA; }
  if (manualW != null) { waiting = manualW; }
  active = Math.round(active);
  waiting = Math.round(waiting);
  return { active, waiting, total: active + waiting, estimated: estimated && manualA == null && manualW == null, source: estimated ? 'estimate' : 'recipe', timed: est.timed };
}

/** "45 min", "1 h 10 min", "2 h", "1 g 2 h" */
export function formatMinutes(min, { day = 'g' } = {}) {
  min = Math.round(min || 0);
  if (min < 60) return `${min} min`;
  if (min >= 1440) { const d = Math.floor(min / 1440); const h = Math.round((min % 1440) / 60); return `${d} ${day}${h ? ` ${h} h` : ''}`; }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
