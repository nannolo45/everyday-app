// Departments for the pantry and the shopping list (roughly in supermarket order).
import { normalizeName } from './parse.js';

export const CATEGORIES = [
  { id: 'produce', icon: '🥕' },
  { id: 'bakery', icon: '🥖' },
  { id: 'meatfish', icon: '🥩' },
  { id: 'dairy', icon: '🧀' },
  { id: 'grains', icon: '🍝' },
  { id: 'staples', icon: '🥫' },
  { id: 'condiments', icon: '🧂' },
  { id: 'sweets', icon: '🍫' },
  { id: 'drinks', icon: '🧃' },
  { id: 'frozen', icon: '🧊' },
  { id: 'other', icon: '📦' },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const categoryIcon = (id) => (CATEGORIES.find((c) => c.id === id) || CATEGORIES.at(-1)).icon;

const re = (list) => new RegExp(`(?:^|[^a-zà-öø-ÿ])(?:${list.join('|')})`, 'i');

// Checked in this order: the first match wins ("pomodori pelati" = staples, not produce).
const RULES = [
  ['frozen', re(['surgelat', 'congelat', 'gelato', 'ghiacciol', 'bastoncini di pesce', 'tiefkühl', 'tk-', 'gefroren', 'speiseeis', 'frozen', 'ice cream', 'fish fingers'])],
  ['condiments', re(['[a-zäöüß]*öl(?![a-zäöüß])', '[a-zäöüß]*essig(?![a-zäöüß])', '[a-zäöüß]*gewürz(?![a-zäöüß])', 'olio', 'aceto', 'sale(?! e )', 'sale$', 'pepe(?!r)', 'spezi', 'origano', 'cannella', 'noce moscata', 'curry', 'paprika', 'curcuma', 'zafferano', 'cumino', 'senape', 'ketchup', 'maionese', 'salsa di soia', 'dado', 'brodo', 'capperi', 'tabasco', 'pesto',
    'öl(?![a-z])', 'olivenöl', 'essig', 'salz', 'pfeffer', 'gewürz', 'zimt', 'muskat', 'senf', 'mayonnaise', 'sojasoße', 'sojasauce', 'brühe', 'kapern',
    'oil(?![a-z])', 'olive oil', 'vinegar', 'salt(?![a-z])', 'pepper(?!s? \\(bell\\))(?!mint)', 'spice', 'oregano', 'cinnamon', 'nutmeg', 'turmeric', 'saffron', 'cumin', 'mustard', 'mayo', 'soy sauce', 'stock cube', 'bouillon', 'peperoncino secco', 'chili flakes'])],
  ['drinks', re(['[a-zäöüß]*saft(?![a-zäöüß])', '[a-zäöüß]*wasser(?![a-zäöüß])', '[a-zäöüß]*tee(?![a-zäöüß])', '[a-zäöüß]*wein(?![a-zäöüß])', '[a-zäöüß]*bier(?![a-zäöüß])', 'acqua', 'vino', 'birra', 'succo', 'bibit', 'aranciata', 'caffè', 'caffe', 'tè(?![a-z])', 'tisana', 'spremut', 'prosecco', 'liquore',
    'wasser(?![a-zäöüß])', 'wein(?![a-zäöüß])', 'bier(?![a-zäöüß])', 'saft(?![a-zäöüß])', 'limonade', 'kaffee', 'tee(?![a-z])', 'sprudel', 'water', 'wine', 'beer', 'juice', 'coffee', 'tea(?![a-z])', 'soda', 'lemonade'])],
  ['meatfish', re(['[a-zäöüß]*wurst(?![a-zäöüß])', '[a-zäöüß]*fleisch(?![a-zäöüß])', '[a-zäöüß]*schinken(?![a-zäöüß])', '[a-zäöüß]*fisch(?![a-zäöüß])', '[a-zäöüß]*filet(?![a-zäöüß])', 'manzo', 'maiale', 'vitell', 'pollo', 'petto di', 'tacchin', 'agnell', 'salsicc', 'pancetta', 'prosciutt', 'guanciale', 'speck', 'salam', 'carne', 'macinat', 'mortadella', 'bresaola', 'würstel', 'wurstel', 'coniglio',
    'pesce', 'tonno', 'salmone', 'merluzzo', 'baccalà', 'acciugh', 'alici', 'gamber', 'cozze', 'vongole', 'calamar', 'polpo', 'branzino', 'orata', 'sgombr',
    'rind', 'schwein', 'kalb', 'hähnchen', 'huhn', 'pute', 'lamm', 'wurst', 'schinken', 'hackfleisch', 'fleisch', 'fisch', 'lachs', 'thunfisch', 'garnele', 'kabeljau',
    'beef', 'pork', 'veal', 'chicken', 'turkey', 'lamb', 'sausage', 'bacon', 'ham(?![a-z])', 'mince', 'meat', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'cod(?![a-z])'])],
  ['dairy', re(['[a-zäöüß]*käse(?![a-zäöüß])', '[a-zäöüß]*milch(?![a-zäöüß])', '[a-zäöüß]*joghurt(?![a-zäöüß])', '[a-zäöüß]*sahne(?![a-zäöüß])', '[a-zäöüß]*butter(?![a-zäöüß])', 'latte(?! di (?:cocco|soia|mandorl|riso|avena))', 'burro', 'panna', 'yogurt', 'yoghurt', 'formagg', 'parmigian', 'grana', 'pecorino', 'mozzarell', 'ricotta', 'mascarpone', 'stracchino', 'gorgonzola', 'fontina', 'scamorza', 'provola', 'uov', 'tuorl',
    'milch', 'butter', 'sahne', 'joghurt', 'käse', 'quark', 'schmand', 'eier', 'ei(?![a-z])', 'frischkäse',
    'milk', 'butter', 'cream(?! of)', 'yogurt', 'cheese', 'eggs?(?![a-z])', 'parmesan'])],
  ['bakery', re(['[a-zäöüß]*brot(?![a-zäöüß])', '[a-zäöüß]*brötchen(?![a-zäöüß])', 'pane', 'panin', 'pancarr', 'grissin', 'fette biscottate', 'cracker', 'piadin', 'focacc', 'pangrattato', 'friselle', 'taralli',
    'brot', 'brötchen', 'toast', 'zwieback', 'knäcke', 'semmel', 'bread', 'roll(?:s)?(?![a-z])', 'bun(?:s)?(?![a-z])', 'tortilla', 'breadcrumbs', 'bagel'])],
  ['grains', re(['[a-zäöüß]*nudeln(?![a-zäöüß])', '[a-zäöüß]*reis(?![a-zäöüß])', '[a-zäöüß]*flocken(?![a-zäöüß])', 'pasta(?! (?:frolla|sfoglia|brisé))', 'spaghett', 'penne', 'rigaton', 'fusill', 'tagliatell', 'lasagn', 'linguine', 'farfalle', 'orecchiette', 'maccheron', 'bucatin', 'paccheri', 'tortellin', 'ravioli', 'gnocchi', 'riso', 'risotto', 'couscous', 'farro', 'orzo', 'quinoa', 'polenta', 'avena', 'fiocchi', 'muesli', 'cereali', 'corn flakes', 'bulgur',
    'nudeln', 'spätzle', 'reis', 'haferflocken', 'müsli', 'grieß', 'hirse', 'noodle', 'rice', 'oats', 'oatmeal', 'cereal', 'granola'])],
  ['sweets', re(['[a-zäöüß]*schokolade(?![a-zäöüß])', '[a-zäöüß]*kekse?(?![a-zäöüß])', 'cioccolat', 'biscott', 'merendin', 'caramell', 'patatin', 'snack', 'nutella', 'crema spalmabile', 'savoiardi', 'wafer', 'gelatin', 'caramelle', 'torrone', 'panettone', 'pandoro',
    'schokolade', 'keks', 'chips', 'gummibär', 'süßigkeit', 'riegel', 'chocolate', 'cookie', 'biscuit', 'crisps', 'candy', 'sweets'])],
  ['staples', re(['[a-zäöüß]*mehl(?![a-zäöüß])', '[a-zäöüß]*zucker(?![a-zäöüß])', 'farina', 'zucchero', 'lievito', 'cacao', 'fagiol', 'ceci', 'lenticch', 'piselli secchi', 'legumi', 'pelati', 'passata', 'polpa di pomodoro', 'concentrato', 'pomodori in scatola', 'conserv', 'marmellat', 'confettur', 'miele', 'zucchero a velo', 'amido', 'maizena', 'bicarbonato', 'mandorl', 'nocciol', 'noci', 'pinoli', 'uvetta', 'frutta secca', 'olive', 'sottaceti', 'sottolio', 'in scatola', 'latte di cocco',
    'mehl', 'zucker', 'hefe', 'backpulver', 'kakao', 'bohnen', 'kichererbsen', 'linsen', 'passierte', 'tomatenmark', 'dosentomaten', 'konserve', 'marmelade', 'konfitüre', 'honig', 'stärke', 'mandeln', 'nüsse', 'rosinen', 'oliven',
    'flour', 'sugar', 'yeast', 'baking powder', 'baking soda', 'cocoa', 'beans', 'chickpeas', 'lentils', 'canned', 'tinned', 'tomato paste', 'passata', 'jam', 'honey', 'cornstarch', 'almonds', 'nuts', 'raisins', 'olives'])],
  ['produce', re(['[a-zäöüß]*melone', '[a-zäöüß]*salat(?![a-zäöüß])', '[a-zäöüß]*kartoffeln?(?![a-zäöüß])', '[a-zäöüß]*zwiebeln?(?![a-zäöüß])', '[a-zäöüß]*äpfel(?![a-zäöüß])', 'mel[ae](?![a-z])', 'pere(?![a-z])', 'banan', 'arance?', 'arancia', 'limon', 'lime', 'fragol', 'uva(?![a-z])', 'pesch', 'albicocc', 'kiwi', 'ananas', 'mirtill', 'lampon', 'frutti di bosco', 'melone', 'anguria', 'avocado', 'insalat', 'lattuga', 'rucola', 'spinaci', 'pomodor', 'pomodorini', 'carot', 'zucchin', 'melanzan', 'peperon', 'cipoll', 'scalogn', 'aglio', 'patat', 'sedano', 'finocch', 'cavol', 'broccol', 'verza', 'funghi', 'champignon', 'porri', 'zucca', 'cetriol', 'basilico', 'prezzemolo', 'rosmarino', 'salvia', 'menta', 'timo', 'erba cipollina', 'zenzero', 'asparag', 'carciof', 'radicch', 'fagiolini',
    'apfel', 'äpfel', 'birne', 'banane', 'orange', 'zitrone', 'erdbeer', 'traube', 'pfirsich', 'salat', 'spinat', 'tomate', 'karotte', 'möhre', 'zucchini', 'aubergine', 'paprikaschote', 'zwiebel', 'knoblauch', 'kartoffel', 'sellerie', 'kohl', 'brokkoli', 'pilz', 'lauch', 'kürbis', 'gurke', 'petersilie', 'basilikum', 'schnittlauch', 'ingwer', 'spargel',
    'apple', 'pear', 'banana', 'orange', 'lemon', 'berr', 'grape', 'peach', 'lettuce', 'spinach', 'tomato', 'carrot', 'courgette', 'eggplant', 'bell pepper', 'onion', 'garlic', 'potato', 'celery', 'cabbage', 'broccoli', 'mushroom', 'leek', 'pumpkin', 'cucumber', 'parsley', 'basil', 'ginger', 'asparagus', 'herbs'])],
];

export function categorize(name, offCategory) {
  if (offCategory && CATEGORY_IDS.includes(offCategory) && offCategory !== 'other') return offCategory;
  const n = ` ${normalizeName(name)}`;
  for (const [id, rx] of RULES) if (rx.test(n)) return id;
  return 'other';
}

export const categoryOf = (item) => (item.cat && CATEGORY_IDS.includes(item.cat) ? item.cat : categorize(item.name));

// Open Food Facts categories_tags → department
const OFF_MAP = [
  ['frozen', ['en:frozen-foods', 'en:ice-creams']],
  ['drinks', ['en:beverages', 'en:waters', 'en:wines', 'en:beers', 'en:juices', 'en:coffees', 'en:teas']],
  ['staples', ['en:canned-foods', 'en:flours', 'en:sugars', 'en:legumes', 'en:jams', 'en:honeys', 'en:tomato-sauces', 'en:dried-products-to-be-rehydrated', 'en:nuts']],
  ['condiments', ['en:condiments', 'en:sauces', 'en:spices', 'en:vegetable-oils', 'en:olive-oils', 'en:vinegars', 'en:salts', 'en:broths']],
  ['meatfish', ['en:meats', 'en:fishes', 'en:seafood', 'en:hams', 'en:sausages', 'en:prepared-meats']],
  ['dairy', ['en:dairies', 'en:milks', 'en:cheeses', 'en:yogurts', 'en:eggs', 'en:butters', 'en:creams']],
  ['bakery', ['en:breads', 'en:crackers', 'en:rusks', 'en:breadsticks']],
  ['grains', ['en:pastas', 'en:rices', 'en:breakfast-cereals', 'en:cereal-grains', 'en:semolinas', 'en:couscous']],
  ['sweets', ['en:snacks', 'en:sweet-snacks', 'en:chocolates', 'en:biscuits', 'en:confectioneries', 'en:salty-snacks', 'en:cakes']],
  ['produce', ['en:fresh-vegetables', 'en:fresh-fruits', 'en:fresh-plant-based-foods', 'en:vegetables', 'en:fruits']],
];

export function offCategory(tags) {
  const set = new Set(tags || []);
  for (const [id, list] of OFF_MAP) if (list.some((t) => set.has(t))) return id;
  return null;
}
