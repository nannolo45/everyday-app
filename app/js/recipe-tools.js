// Automatic tags, cooking time in minutes, and "what can I cook with my pantry?".
import { parseIngredient, namesMatch, convert, normalizeName } from './parse.js';

const words = (list) => new RegExp(`(?:^|[^a-zà-öø-ÿ])(?:${list.join('|')})`, 'i');

const MEAT = words(['manzo', 'maiale', 'vitell', 'pollo', 'tacchin', 'agnell', 'salsicc', 'pancetta', 'prosciutt', 'guanciale', 'speck', 'salam', 'carne', 'macinat[ao] di', 'mortadella', 'bresaola', 'lardo', 'cotechino', 'coniglio', 'anatra', 'ragù di carne',
  'rinder', 'rindfleisch', 'schwein', 'kalb', 'huhn', 'hähnchen', 'hühner', 'pute', 'lamm', 'wurst', 'speck', 'schinken', 'hackfleisch', 'fleisch', 'würstchen', 'ente',
  'beef', 'pork', 'veal', 'chicken', 'turkey', 'lamb', 'sausage', 'bacon', 'ham', 'mince', 'meat', 'duck', 'chorizo', 'pepperoni']);
const FISH = words(['pesce', 'tonno', 'salmone', 'merluzzo', 'baccalà', 'acciugh', 'alici', 'gamber', 'cozze', 'vongole', 'calamar', 'polpo', 'seppi', 'branzino', 'orata', 'sgombr', 'scamp', 'frutti di mare', 'bottarga',
  'fisch', 'thunfisch', 'lachs', 'kabeljau', 'sardell', 'garnele', 'muschel', 'tintenfisch', 'forelle', 'hering',
  'fish', 'tuna', 'salmon', 'cod', 'anchov', 'shrimp', 'prawn', 'mussel', 'clam', 'squid', 'octopus', 'seafood', 'trout']);
const ANIMAL = words(['uov[ao]', 'tuorl', 'album', 'latte(?! di (?:cocco|soia|mandorl|riso|avena))', 'burro(?! di arachidi)', 'panna', 'formagg', 'parmigian', 'grana', 'pecorino', 'mozzarell', 'ricotta', 'mascarpone', 'yogurt', 'miele', 'gelatina', 'stracchino', 'gorgonzola', 'fontina', 'besciamella',
  'ei(?:er)?(?![a-z])', 'eigelb', 'eiweiß', 'milch(?!\\s*\\(?(?:hafer|soja|mandel))', 'butter(?!milch)', 'sahne', 'käse', 'quark', 'joghurt', 'honig', 'schmand', 'crème fraîche', 'mascarpone',
  'eggs?(?![a-z])', 'yolk', 'milk(?! \\(?(?:oat|soy|almond|coconut))', 'butter(?!nut)', 'cream(?! of tartar)', 'cheese', 'parmesan', 'yogurt', 'honey', 'gelatin']);
const PASTA = words(['[a-zäöüß]*spätzle', '[a-zäöüß]*nudeln', 'spaghett', 'penne', 'rigaton', 'fusill', 'tagliatell', 'lasagn', 'linguine', 'farfalle', 'orecchiette', 'pasta(?! (?:frolla|sfoglia|brisé|matta|madre|di (?:mandorl|pistacch|nocciol)))', 'maccheron', 'bucatin', 'paccheri', 'tortellin', 'ravioli', 'fettuccine', 'pappardelle', 'tagliolin', 'ditalin', 'gnocchi', 'trofie', 'mezze maniche',
  'nudeln', 'spätzle', 'maultaschen', 'noodle', 'macaroni']);
const RICE = words(['riso(?! soffiato)', 'risotto', 'reis', 'rice', 'arborio', 'carnaroli']);
const SWEET_TITLE = words(['torta(?! salata)', 'crostata', 'biscott', 'tiramis', 'dolce', 'budino', 'gelato', 'mousse', 'muffin', 'cake', 'kuchen', 'torte', 'keks', 'plätzchen', 'dessert', 'pudding', 'cookie', 'brownie', 'strudel', 'panna cotta', 'semifreddo', 'crêpe', 'pancake', 'pfannkuchen', 'cheesecake', 'ciambell', 'cantucci', 'meringh', 'zabaione', 'sorbett', 'waffel', 'krapfen', 'zuccotto', 'cannoli', 'babà', 'sfogliatell']);
const SWEET_ING = words(['zucchero', 'zucker', 'sugar', 'cioccolat', 'schokolade', 'chocolate', 'cacao', 'kakao', 'cocoa', 'zucchero a velo', 'puderzucker', 'icing sugar', 'vaniglia', 'vanille', 'vanilla']);
const SAVORY = words(['cipoll', 'aglio', 'zwiebel', 'knoblauch', 'onion', 'garlic', 'pepe', 'pfeffer', 'pepper(?!mint)', 'brodo', 'brühe', 'stock', 'broth']);
const SOUP_TITLE = words(['[a-zäöüß]*suppe', '[a-zäöüß]*eintopf', 'zupp', 'minestr', 'vellutat', 'brodo', 'passato di', 'suppe', 'eintopf', 'brühe', 'soup', 'stew', 'chowder', 'gazpacho']);
const SALAD_TITLE = words(['[a-zäöüß]*salat(?![a-zäöüß])', 'insalat', 'salat(?!e)', 'salad']);
const OVEN = words(['forno', 'inforn', 'gratin', 'backofen', 'ofen', 'backen', 'überbacken', 'oven', 'bake', 'roast']);

// "30 min + 4 ore di riposo" → 270, "1 h 15 min" → 75, "45 Minuten" → 45, "20-30 min" → 30
export function minutesOf(time) {
  const s = String(time || '').toLowerCase().replace(',', '.');
  if (!s) return null;
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(ore|ora|stunden|stunde|std\.?|hours?|hrs?|h|minuti|minuten|minutes|mins?|min|')(?![a-z])/g;
  let m;
  while ((m = re.exec(s))) {
    const n = parseFloat(m[2] || m[1]);
    total += /^(ore|ora|stund|std|hour|hr|h)/.test(m[3]) ? n * 60 : n;
    found = true;
  }
  return found ? Math.round(total) : null;
}

function ingredientNames(r) {
  return (r.ingredients || []).map((i) => (i.name != null ? `${i.name} ${i.note || ''}` : parseIngredient(i.raw || '').name)).join(' \n ');
}

// Courses first (one per recipe), then diet, main ingredient and other properties.
export const COURSE_TAGS = ['antipasto', 'primo', 'secondo', 'contorno', 'dessert', 'drinks'];
export const AUTO_TAGS = [...COURSE_TAGS, 'salad', 'soup', 'pasta', 'rice', 'meat', 'fish', 'veg', 'vegan', 'quick', 'oven'];

const DRINK_TITLE = words(['cocktail', 'spritz', 'smoothie', 'frullat', 'centrifugat', 'estratto di', 'limonat', 'tisana', 'infuso', 'tè freddo', 'the freddo', 'caffè', 'cappuccino', 'liquore', 'limoncello', 'nocino', 'sangria', 'punch', 'mojito', 'negroni', 'americano', 'bellini', 'margarita', 'daiquiri', 'bevanda', 'drink', 'aperitivo analcolico', 'cioccolata calda', 'frappè', 'frappe', 'milkshake', 'shake', 'sciroppo', 'vin brulè', 'eggnog',
  'getränk', 'bowle', 'glühwein', 'saft', 'limonade', 'eistee', 'kakao', 'heiße schokolade', 'lassi', 'juice', 'lemonade', 'iced tea', 'hot chocolate', 'mulled wine', 'tea', 'coffee', 'latte macchiato']);
const ALCOHOL = words(['gin', 'vodka', 'rum', 'tequila', 'whisky', 'whiskey', 'prosecco', 'aperol', 'campari', 'vermouth', 'martini', 'champagne', 'brandy', 'cognac', 'triple sec', 'cointreau', 'amaretto', 'sambuca', 'bitter']);
const ICE = words(['ghiaccio', 'cubetti di ghiaccio', 'eiswürfel', 'eis', 'ice', 'ice cubes', 'acqua tonica', 'tonic', 'soda']);
const STARTER_TITLE = words(['antipast', 'bruschett', 'crostin', 'tartin', 'stuzzichin', 'finger food', 'carpaccio', 'tartare', 'vitello tonnato', 'crocchett', 'arancin', 'olive ascolane', 'sformatin', 'frittelle di', 'pinzimonio', 'hummus', 'tzatziki', 'guacamole', 'paté', 'pâté', 'mousse di (?:tonno|salmone|prosciutto|formaggio)', 'dip(?![a-z])', 'tagliere', 'sfogliatine', 'polpettine', 'involtini di (?:zucchin|melanzan|bresaola|prosciutto)', 'caprese', 'panzanella', 'prosciutto e melone', 'insalata di mare', 'cocktail di gamberi', 'salmone affumicato',
  'vorspeise', 'fingerfood', 'häppchen', 'antipasti', 'canapé', 'starter', 'appetizer', 'canape', 'nibbles', 'deviled eggs', 'spring rolls', 'bruschetta']);
const PRIMO_TITLE = words(['[a-zäöüß]*spätzle', '[a-zäöüß]*suppe', '[a-zäöüß]*eintopf', '[a-zäöüß]*knödel', '[a-zäöüß]*nudeln', 'risott', 'lasagn', 'gnocch', 'zupp', 'minestr', 'vellutat', 'passato di', 'crema di (?:zucca|piselli|ceci|patate|funghi|asparagi|carote|porri|cavolfiore|lenticchie)', 'pasta', 'spaghett', 'tagliatell', 'cannellon', 'ravioli', 'tortellin', 'agnolotti', 'cappelletti', 'crespelle', 'pappardelle', 'orecchiette', 'carbonara', 'amatriciana', 'gricia', 'cacio e pepe', 'pasta e fagioli', 'ribollita', 'pappa al pomodoro', 'polenta concia', 'paella', 'pho', 'ramen', 'couscous',
  'nudeln', 'spätzle', 'maultaschen', 'suppe', 'eintopf', 'knödel', 'noodle', 'soup', 'risotto', 'pasta']);
const SECONDO_TITLE = words(['[a-zäöüß]*schnitzel', '[a-zäöüß]*braten', '[a-zäöüß]*gulasch', 'arrost', 'brasat', 'spezzatin', 'stracotto', 'bollito', 'polpett[ae](?! di (?:zucchin|melanzan|verdur|ceci|lenticchie))', 'cotolett', 'scaloppin', 'filett', 'bistecc', 'tagliata', 'involtini', 'frittata', 'omelette', 'uova (?:strapazzate|in camicia|al tegamino|sode)', 'saltimbocca', 'ossobuco', 'pollo', 'tacchino', 'coniglio', 'agnello', 'maiale', 'vitello', 'manzo', 'salmone', 'merluzzo', 'baccalà', 'orata', 'branzino', 'gamberoni', 'calamari', 'polpo', 'pesce', 'hamburger', 'burger', 'parmigiana', 'cordon bleu', 'stinco', 'peposo', 'cacciatora', 'impanat',
  'braten', 'schnitzel', 'gulasch', 'frikadelle', 'bulette', 'steak', 'roulade', 'hähnchen', 'filet', 'geschnetzeltes', 'fischfilet', 'roast', 'meatball', 'meatloaf', 'fillet', 'chicken', 'pork chop', 'stew', 'curry', 'chili con carne', 'lasagne']);
const SIDE_TITLE = words(['[a-zäöüß]*kartoffeln', '[a-zäöüß]*gemüse', 'contorn', 'verdure', 'patate (?:al forno|arrosto|fritte|in padella|duchessa|al rosmarino|sabbiose)', 'purè', 'pure di', 'funghi trifolati', 'spinaci', 'zucchine (?:trifolate|grigliate|in padella|al forno)', 'melanzane (?:grigliate|a funghetto|al forno)', 'peperonata', 'caponata', 'ratatouille', 'fagiolini', 'cavolfiore', 'broccoli', 'carote (?:glassate|al forno)', 'cipolle (?:caramellate|in agrodolce)', 'piselli', 'insalata (?:mista|verde)', 'cicoria', 'friarielli', 'scarola', 'puntarelle', 'finocchi (?:gratinati|al forno)',
  'beilage', 'kartoffel', 'bratkartoffeln', 'pommes', 'püree', 'rotkohl', 'sauerkraut', 'gemüse', 'kartoffelsalat', 'side dish', 'mashed', 'roasted vegetables', 'fries', 'coleslaw', 'potatoes', 'vegetables']);
const EGG_MAIN = words(['uov[ao]', 'eier', 'eggs?(?![a-z])']);

// Course: drinks > dessert > antipasto > primo > secondo > contorno.
export function courseOf(r, { meat, fish, sweet, pastaRice, soup }) {
  const title = String(r.title || '').toLowerCase();
  const ing = ingredientNames(r).toLowerCase();
  if (DRINK_TITLE.test(title) || (ALCOHOL.test(ing) && ICE.test(ing))) return 'drinks';
  if (sweet) return 'dessert';
  if (STARTER_TITLE.test(title)) return 'antipasto';
  if (PRIMO_TITLE.test(title) || pastaRice || soup) return 'primo';
  if (SECONDO_TITLE.test(title)) return 'secondo';
  if (SIDE_TITLE.test(title)) return 'contorno';
  if (meat || fish) return 'secondo';
  // eggs as the main thing, few other ingredients → secondo; mostly vegetables → contorno
  const n = (r.ingredients || []).length;
  if (EGG_MAIN.test(ing) && n <= 6 && !SALAD_TITLE.test(title)) return 'secondo';
  if (SALAD_TITLE.test(title)) return 'contorno';
  return null;
}

const normWords = (s) => ` ${normalizeName(s)} `;

// Extra keywords from the tag settings: "risotto, crespelle" → also tag these recipes.
function keywordHit(r, keywords) {
  if (!keywords || !keywords.length) return false;
  const hay = normWords(`${r.title || ''} ${ingredientNames(r)}`);
  return keywords.some((k) => { const w = normalizeName(k); return w && hay.includes(` ${w}`); });
}

/**
 * Automatic tags. defs (from Settings, synced) can switch a tag off (enabled:false),
 * add keywords to it, or define new keyword tags (custom:true).
 */
export function autoTags(r, defs = []) {
  const ing = ingredientNames(r).toLowerCase();
  const title = String(r.title || '').toLowerCase();
  const steps = (r.steps || []).join(' ').toLowerCase();
  const tags = new Set();
  const def = new Map(defs.filter((d) => d && !d.deleted).map((d) => [d.id, d]));
  if (ing.trim()) {
    const meat = MEAT.test(ing) || MEAT.test(title);
    const fish = FISH.test(ing) || FISH.test(title);
    if (meat) tags.add('meat');
    if (fish) tags.add('fish');
    if (!meat && !fish) { tags.add('veg'); if (!ANIMAL.test(ing)) tags.add('vegan'); }
    const sweet = SWEET_TITLE.test(title) || (SWEET_ING.test(ing) && !SAVORY.test(ing) && !meat && !fish);
    if (!sweet && (PASTA.test(ing) || PASTA.test(title))) tags.add('pasta');
    if (!sweet && (RICE.test(ing) || RICE.test(title))) tags.add('rice');
    if (SOUP_TITLE.test(title)) tags.add('soup');
    if (SALAD_TITLE.test(title)) tags.add('salad');
    const course = courseOf(r, { meat, fish, sweet, pastaRice: tags.has('pasta') || tags.has('rice'), soup: tags.has('soup') });
    if (course) tags.add(course);
    if (course === 'drinks') { tags.delete('veg'); tags.delete('vegan'); }
    const min = minutesOf(r.time);
    if (min != null && min <= 30) tags.add('quick');
    if (OVEN.test(steps) || OVEN.test(title)) tags.add('oven');
  }
  // keywords added in Settings
  for (const id of AUTO_TAGS) if (keywordHit(r, def.get(id)?.keywords)) tags.add(id);
  // only one course: a keyword course wins over the guessed one
  const kwCourse = COURSE_TAGS.find((c) => keywordHit(r, def.get(c)?.keywords));
  if (kwCourse) for (const c of COURSE_TAGS) if (c !== kwCourse) tags.delete(c);
  const out = AUTO_TAGS.filter((t) => tags.has(t) && def.get(t)?.enabled !== false);
  for (const d of def.values()) if (d.custom && d.enabled !== false && keywordHit(r, d.keywords)) out.push(d.id);
  return out;
}

// Manual tags plus automatic ones the user hasn't hidden. Auto tags are returned as "auto:<id>".
export function tagsOf(r, defs = []) {
  const hidden = new Set(r.hiddenTags || []);
  const auto = autoTags(r, defs).filter((t) => !hidden.has(t)).map((t) => `auto:${t}`);
  const manual = (r.tags || []).filter(Boolean);
  return [...auto, ...manual.filter((t) => !auto.includes(t))];
}

// ---------- what can I cook? ----------

const BASICS = /^(?:sale|sale fino|sale grosso|pepe|pepe nero|acqua|olio|olio (?:extra ?vergine|evo|d'oliva|di oliva|di semi)(?: d'oliva)?|salz|pfeffer|wasser|öl|olivenöl|salt|pepper|black pepper|water|oil|olive oil|ghiaccio|eis|ice)$/i;
const TO_TASTE = /\b(?:q\.?\s?b\.?|quanto basta|to taste|nach belieben|nach geschmack|a piacere|etwas)\b/i;

export function isBasic(name) { return BASICS.test(normalizeName(name).replace(/\s+/g, ' ')); }

function findPantryItem(name, pantry) {
  const n = normalizeName(name);
  return pantry.find((p) => normalizeName(p.name) === n) || pantry.find((p) => namesMatch(p.name, name));
}

/**
 * For one recipe: which ingredients are at home, which are missing (or not enough).
 * opts.basics: salt, pepper, oil, water count as always available.
 * opts.expiringIds: pantry ids that expire soon (bonus for using them up).
 */
export function pantryCoverage(r, pantry, { servings, basics = true, expiringIds = new Set() } = {}) {
  const base = r.servings || 4;
  const n = servings || base;
  const have = [];
  const missing = [];
  const optional = [];
  const uses = [];
  const matched = [];
  for (const raw of r.ingredients || []) {
    const ing = raw.name != null ? raw : parseIngredient(raw.raw || '');
    if (!ing.name) continue;
    const need = ing.qty == null ? null : (ing.qty * n) / base;
    const p = findPantryItem(ing.name, pantry);
    const stock = p ? (Number(p.qty) || 0) : 0;
    const usable = p && stock > 0;
    if (usable) {
      if (!matched.includes(p)) matched.push(p);
      const avail = need == null ? null : convert(stock, p.unit || '', ing.unit || '');
      if (need == null || avail == null || avail + 1e-9 >= need) {
        have.push(ing.name);
        if (expiringIds.has(p.id)) uses.push(p);
        continue;
      }
      // some, not enough
      if (expiringIds.has(p.id)) uses.push(p);
      missing.push({ name: ing.name, unit: ing.unit, need, short: need - avail, have: avail });
      continue;
    }
    if ((basics && isBasic(ing.name)) || (ing.qty == null && TO_TASTE.test(`${ing.raw || ''} ${ing.note || ''}`))) { optional.push(ing.name); continue; }
    missing.push({ name: ing.name, unit: ing.unit, need, short: need, have: 0 });
  }
  const counted = have.length + missing.length;
  return { have, missing, optional, uses, matched, ratio: counted ? have.length / counted : 0, total: counted };
}

/**
 * Recipes ranked against the pantry.
 * opts.by: 'have'     → the biggest share of ingredients already at home first (default)
 *          'missing'  → fewest missing ingredients first
 *          'expiring' → recipes that use what goes bad soonest first; opts.daysLeft(p) gives the days
 *                       until a pantry item expires (null when it has no date)
 * Each result gets c.soonest: the fewest days left among the pantry items the recipe uses.
 */
export function rankByPantry(recipes, pantry, opts = {}) {
  const by = opts.by || 'have';
  const daysLeft = opts.daysLeft || (() => null);
  const title = (x) => String(x.r.title || '');
  const tie = (a, b) => (b.r.cookedCount || 0) - (a.r.cookedCount || 0) || title(a).localeCompare(title(b));
  const sorters = {
    have: (a, b) => b.c.ratio - a.c.ratio || a.c.missing.length - b.c.missing.length || b.c.uses.length - a.c.uses.length || tie(a, b),
    missing: (a, b) => a.c.missing.length - b.c.missing.length || b.c.uses.length - a.c.uses.length || b.c.ratio - a.c.ratio || tie(a, b),
    expiring: (a, b) => (a.c.soonest ?? Infinity) - (b.c.soonest ?? Infinity)
      || b.c.dated - a.c.dated || b.c.ratio - a.c.ratio || a.c.missing.length - b.c.missing.length || tie(a, b),
  };
  return recipes
    .map((r) => {
      const c = pantryCoverage(r, pantry, opts);
      const days = c.matched.map(daysLeft).filter((d) => d != null);
      c.soonest = days.length ? Math.min(...days) : null;
      c.dated = days.length;
      return { r, c };
    })
    .filter((x) => x.c.total > 0)
    .sort(sorters[by] || sorters.have);
}
