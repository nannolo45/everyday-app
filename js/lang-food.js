// Ingredient names in Italian, German and English (+ common variants), so that
// "uova" in the pantry matches "Eier" or "eggs" in a recipe, and a search can be
// sent to each site in its own language. Row: it | de | en | other names…

const ROWS = `
uova|Eier|eggs|uovo|ei|egg|free-range eggs|uova intere
tuorli|Eigelb|egg yolks|tuorlo|eidotter|egg yolk|yolks
albumi|Eiweiß|egg whites|albume|eiklar|egg white
latte|Milch|milk|latte intero|vollmilch|whole milk|semi-skimmed milk
panna|Sahne|cream|panna fresca|schlagsahne|double cream|heavy cream|single cream|panna da cucina
burro|Butter|butter|unsalted butter|salted butter|burro chiarificato
yogurt|Joghurt|yogurt|yoghurt|jogurt|greek yogurt|yogurt greco
mascarpone|Mascarpone|mascarpone
ricotta|Ricotta|ricotta
mozzarella|Mozzarella|mozzarella|mozzarella balls|fior di latte
parmigiano|Parmesan|parmesan|parmigiano reggiano|grana padano|grana|parmesan cheese|parmigiano-reggiano
pecorino|Pecorino|pecorino|pecorino romano
gorgonzola|Gorgonzola|gorgonzola
feta|Feta|feta|schafskäse|feta cheese
formaggio|Käse|cheese
formaggio spalmabile|Frischkäse|cream cheese|philadelphia
panna acida|saure Sahne|sour cream|schmand|sauerrahm
farina|Mehl|flour|plain flour|weizenmehl|farina 00|all-purpose flour|white flour
farina integrale|Vollkornmehl|wholemeal flour|whole wheat flour
zucchero|Zucker|sugar|caster sugar|granulated sugar|zucchero semolato
zucchero di canna|brauner Zucker|brown sugar|rohrzucker|demerara sugar|muscovado sugar
zucchero a velo|Puderzucker|icing sugar|powdered sugar
lievito|Hefe|yeast|lievito di birra|dry yeast|trockenhefe
lievito per dolci|Backpulver|baking powder|lievito vanigliato
bicarbonato|Natron|bicarbonate of soda|baking soda
sale|Salz|salt|sea salt|kosher salt
pepe|Pfeffer|pepper|black pepper|pepe nero|schwarzer pfeffer
olio d'oliva|Olivenöl|olive oil|olio extravergine|extra virgin olive oil|olio evo|olio
olio di semi|Sonnenblumenöl|sunflower oil|vegetable oil|rapsöl|rapeseed oil|pflanzenöl|öl|oil
aceto|Essig|vinegar|white wine vinegar|red wine vinegar|weinessig
aceto balsamico|Balsamico|balsamic vinegar|balsamessig
miele|Honig|honey
pasta|Nudeln|pasta|teigwaren
spaghetti|Spaghetti|spaghetti
penne|Penne|penne|penne rigate
fusilli|Fusilli|fusilli
rigatoni|Rigatoni|rigatoni
tagliatelle|Bandnudeln|tagliatelle|fettuccine
lasagne|Lasagneplatten|lasagne sheets|lasagna
gnocchi|Gnocchi|gnocchi
riso|Reis|rice|riso carnaroli|riso arborio|risottoreis|basmati rice|jasmine rice
couscous|Couscous|couscous
pane|Brot|bread|baguette|brötchen
pangrattato|Semmelbrösel|breadcrumbs|paniermehl
patate|Kartoffeln|potatoes|potato|patata|kartoffel|erdäpfel
patate dolci|Süßkartoffeln|sweet potatoes|sweet potato|süßkartoffel
pomodori|Tomaten|tomatoes|tomato|pomodoro|tomate
pomodorini|Kirschtomaten|cherry tomatoes|pomodori ciliegini|datterini|cocktailtomaten
pomodori pelati|Dosentomaten|canned tomatoes|chopped tomatoes|tinned tomatoes|pelati|polpa di pomodoro|stückige tomaten
passata|passierte Tomaten|passata|passata di pomodoro|tomato passata
concentrato di pomodoro|Tomatenmark|tomato puree|tomato paste
cipolle|Zwiebeln|onions|onion|cipolla|zwiebel|red onion|cipolla rossa
cipollotti|Frühlingszwiebeln|spring onions|cipollotto|scallions|green onions|lauchzwiebeln
scalogno|Schalotten|shallots|schalotte|scalogni
aglio|Knoblauch|garlic|spicchio d'aglio|garlic clove|knoblauchzehe
carote|Karotten|carrots|carota|möhren|karotte|carrot
sedano|Sellerie|celery|staudensellerie|costa di sedano
porri|Lauch|leek|porro|porree|leeks
zucchine|Zucchini|courgettes|zucchina|zucchini|courgette
melanzane|Auberginen|aubergine|melanzana|aubergine|eggplant|egg plants
peperoni|Paprika|peppers|peperone|paprikaschote|red pepper|bell pepper|yellow pepper|green pepper
peperoncino|Chili|chilli|peperoncini|chilischote|red chilli|green chilli|chili
spinaci|Spinat|spinach|baby spinach|babyspinat
bietole|Mangold|chard|bietola|swiss chard
cavolo|Kohl|cabbage|weißkohl|cavolo cappuccio|verza|wirsing|savoy cabbage
cavolo nero|Grünkohl|kale|cavolo riccio
cavolfiore|Blumenkohl|cauliflower
broccoli|Brokkoli|broccoli|broccolo
cavolini di bruxelles|Rosenkohl|brussels sprouts
lattuga|Salat|lettuce|insalata|kopfsalat|little gem lettuce|insalata verde
rucola|Rucola|rocket|arugula|rauke
radicchio|Radicchio|radicchio
finocchio|Fenchel|fennel|finocchi|fennel bulb
carciofi|Artischocken|artichokes|carciofo|artischocke|artichoke
asparagi|Spargel|asparagus
funghi|Pilze|mushrooms|champignon|champignons|funghi champignon|chestnut mushroom|wild mushrooms
funghi porcini|Steinpilze|porcini|porcini mushrooms
piselli|Erbsen|peas|frozen peas|pisellini
fagiolini|grüne Bohnen|green beans|prinzessbohnen
fave|Saubohnen|broad beans|dicke bohnen|fava beans
mais|Mais|sweetcorn|corn|zuckermais
cetrioli|Gurke|cucumber|cetriolo|salatgurke
zucca|Kürbis|pumpkin|squash|butternut squash|hokkaido
barbabietole|Rote Bete|beetroot|barbabietola|beets
ravanelli|Radieschen|radishes|ravanello|radish
avocado|Avocado|avocado
olive|Oliven|olives|black olives|green olives|olive nere|olive verdi
capperi|Kapern|capers
zenzero|Ingwer|ginger
ceci|Kichererbsen|chickpeas|chick peas
fagioli|Bohnen|beans|fagioli borlotti|borlotti beans|cannellini|cannellini beans|kidney beans|kidneybohnen|white beans|haricot beans
lenticchie|Linsen|lentils|red lentils|rote linsen
tofu|Tofu|tofu
pollo|Hähnchen|chicken|huhn|pollo intero|whole chicken
petto di pollo|Hähnchenbrust|chicken breast|petti di pollo|chicken breasts|hähnchenbrustfilet|hühnerbrust
cosce di pollo|Hähnchenschenkel|chicken thighs|chicken legs|sovracosce|hähnchenkeulen
tacchino|Pute|turkey|truthahn|fesa di tacchino|putenbrust|turkey breast
manzo|Rindfleisch|beef|rind|polpa di manzo|beef fillet|beef brisket
carne macinata|Hackfleisch|minced beef|macinato|ground beef|mince|rinderhack|lean minced beef|minced meat
vitello|Kalbfleisch|veal|kalb|kalbsschnitzel
maiale|Schweinefleisch|pork|schwein|lonza|schweinefilet|pork loin
salsiccia|Bratwurst|sausages|salsicce|sausage|wurst|italian fennel sausages
agnello|Lammfleisch|lamb|lamm|lamb leg|lamb shoulder
pancetta|Speck|bacon|pancetta tesa|bauchspeck|frühstücksspeck|lardons
guanciale|Guanciale|guanciale
prosciutto crudo|Rohschinken|prosciutto|parma ham|parmaschinken|serrano
prosciutto cotto|Kochschinken|ham|cooked ham|schinken
salame|Salami|salami
tonno|Thunfisch|tuna
salmone|Lachs|salmon|smoked salmon|salmone affumicato|räucherlachs
merluzzo|Kabeljau|cod|baccalà|salt cod|dorsch|haddock
pesce|Fisch|fish|white fish|white fish fillets|fischfilet|filetti di pesce
gamberi|Garnelen|prawns|gamberetti|shrimps|king prawns|tiger prawns|gamberoni|scampi
cozze|Miesmuscheln|mussels|muscheln
vongole|Venusmuscheln|clams
calamari|Tintenfisch|squid|baby squid|calamaro|seppie
acciughe|Sardellen|anchovies|alici|anchovy fillets
mele|Äpfel|apples|mela|apfel|apple|bramley apples|braeburn apples
pere|Birnen|pears|pera|birne|pear
banane|Bananen|bananas|banana|banane
limoni|Zitronen|lemons|limone|zitrone|lemon
succo di limone|Zitronensaft|lemon juice
scorza di limone|Zitronenschale|lemon zest|zitronenabrieb
lime|Limetten|lime|limes|limetta|limette
arance|Orangen|oranges|arancia|orange
fragole|Erdbeeren|strawberries|fragola|erdbeere
lamponi|Himbeeren|raspberries
mirtilli|Heidelbeeren|blueberries|blaubeeren
frutti di bosco|Beeren|berries|mixed berries|waldbeeren
pesche|Pfirsiche|peaches|pesca|pfirsich
albicocche|Aprikosen|apricots|albicocca|aprikose|marillen|apricot
ciliegie|Kirschen|cherries|ciliegia|kirsche|cherry
uva|Trauben|grapes|weintrauben
uvetta|Rosinen|raisins|sultanas|uva sultanina
noci|Walnüsse|walnuts|walnuss
mandorle|Mandeln|almonds|ground almonds|flaked almonds|farina di mandorle|gemahlene mandeln
nocciole|Haselnüsse|hazelnuts|hazlenuts|haselnuss
pinoli|Pinienkerne|pine nuts
pistacchi|Pistazien|pistachios
arachidi|Erdnüsse|peanuts
burro di arachidi|Erdnussbutter|peanut butter
cioccolato fondente|Zartbitterschokolade|dark chocolate|plain chocolate|bitterschokolade|cioccolato
cioccolato al latte|Vollmilchschokolade|milk chocolate
cacao|Kakao|cocoa|cocoa powder|cacao amaro|backkakao
vaniglia|Vanille|vanilla|vanilla extract|vanillezucker|vanillin
cannella|Zimt|cinnamon|cinnamon stick|zimtstange
noce moscata|Muskatnuss|nutmeg|muskat
basilico|Basilikum|basil|fresh basil|basil leaves
prezzemolo|Petersilie|parsley|chopped parsley
rosmarino|Rosmarin|rosemary
salvia|Salbei|sage
timo|Thymian|thyme|fresh thyme
origano|Oregano|oregano|dried oregano
menta|Minze|mint
erba cipollina|Schnittlauch|chives
aneto|Dill|dill
coriandolo|Koriander|coriander|cilantro|coriander leaves
alloro|Lorbeer|bay leaves|bay leaf|foglie di alloro|lorbeerblatt
paprika|Paprikapulver|paprika|smoked paprika|paprika dolce
curry|Curry|curry powder|currypulver
cumino|Kreuzkümmel|cumin|ground cumin
curcuma|Kurkuma|turmeric
brodo vegetale|Gemüsebrühe|vegetable stock|brodo|stock|brühe
brodo di pollo|Hühnerbrühe|chicken stock
brodo di carne|Rinderbrühe|beef stock
dado|Brühwürfel|stock cube|vegetable stock cube|chicken stock cube
vino bianco|Weißwein|white wine|dry white wine|vino
vino rosso|Rotwein|red wine
birra|Bier|beer
salsa di soia|Sojasauce|soy sauce|dark soy sauce
senape|Senf|mustard|dijon mustard|english mustard
maionese|Mayonnaise|mayonnaise|mayo
ketchup|Ketchup|tomato ketchup|ketchup
pesto|Pesto|pesto
latte di cocco|Kokosmilch|coconut milk
amido di mais|Speisestärke|cornstarch|maizena|corn flour|cornflour|fecola
gelatina|Gelatine|gelatine|gelatine leafs|colla di pesce|blattgelatine
pasta sfoglia|Blätterteig|puff pastry
pasta frolla|Mürbeteig|shortcrust pastry
savoiardi|Löffelbiskuits|ladyfingers|lady fingers
biscotti|Kekse|biscuits|digestive biscuits|cookies
caffè|Kaffee|coffee|espresso
acqua|Wasser|water
ghiaccio|Eiswürfel|ice|ice cubes
`;

const simple = (s) => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/\(.*?\)/g, ' ').replace(/['’`-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const variants = (w) => [w, w.replace(/(?:es|en|s|e|i|n)$/, ''), w.replace(/i$/, 'o'), w.replace(/e$/, 'a'), w.replace(/i$/, 'e')];

export const FOOD_ROWS = ROWS.trim().split('\n').map((line) => line.split('|').map((x) => x.trim()).filter(Boolean));

// every name → row index
const INDEX = new Map();
FOOD_ROWS.forEach((row, i) => {
  for (const name of row) {
    const k = simple(name);
    if (k && !INDEX.has(k)) INDEX.set(k, i);
  }
});
const KEYS = [...INDEX.keys()].sort((a, b) => b.length - a.length);
const memo = new Map();

/** Which food (row index) an ingredient name is, or -1. Tolerates plurals and extra words ("2 large eggs, beaten"). */
export function foodKey(name) {
  const s = simple(name);
  if (!s) return -1;
  if (memo.has(s)) return memo.get(s);
  let out = INDEX.has(s) ? INDEX.get(s) : -1;
  if (out < 0) {
    const ws = s.split(' ');
    // the whole name with singular/plural variants of the last word
    for (const v of variants(ws[ws.length - 1])) {
      const k = [...ws.slice(0, -1), v].join(' ');
      if (INDEX.has(k)) { out = INDEX.get(k); break; }
    }
  }
  if (out < 0) {
    // the longest known name inside it, as whole words ("fresh basil leaves" → basil)
    const padded = ` ${s} `;
    for (const k of KEYS) {
      if (k.length < 3) continue;
      if (padded.includes(` ${k} `) || padded.includes(` ${k}s `) || padded.includes(` ${k}es `)) { out = INDEX.get(k); break; }
    }
  }
  if (memo.size > 5000) memo.clear();
  memo.set(s, out);
  return out;
}

const COL = { it: 0, de: 1, en: 2 };
/** The name of an ingredient in another language (it/de/en); the original when unknown. */
export function translateFood(name, lang) {
  const i = foodKey(name);
  if (i < 0 || !(lang in COL)) return String(name || '').trim();
  return FOOD_ROWS[i][COL[lang]];
}

/** Same food, in any of the three languages? */
export function sameFood(a, b) {
  const i = foodKey(a);
  return i >= 0 && i === foodKey(b);
}
