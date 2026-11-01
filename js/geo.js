// Where a recipe comes from: country (ISO code) and continent/region, from
//  1. the cuisine the source states (schema.org recipeCuisine, TheMealDB strArea)
//  2. words of origin in the title ("insalata greca", "Thai curry", "Wiener Schnitzel", "alla romana")
//  3. well-known dishes ("carbonara", "paella", "moussaka", "ramen")
// A nationality word beats a dish name ("Pizza alla messicana" → Mexico). Nothing found → nothing guessed.

export const CONTINENTS = ['eu', 'me', 'as', 'af', 'na', 'la', 'oc'];

// code: [continent, origin words (adjectives, regions, cities; `*` = any ending), dishes]
const C = {
  it: ['eu', 'ital*|romana|romano|alla romana|napoletan*|partenope*|genovese|sicilian*|alla norma|bolognese|milanese|toscan*|fiorentin*|livornese|pugliese|barese|sard[ao]|sardegna|ligure|piemontes*|veneta|veneto|venezian*|calabrese|emilian*|romagnol*|abruzzes*|lombard*|friulan*|trentin*|valdostan*|umbr[ao]|marchigian*|lucan[ao]|molisan[ao]|trapanese|palermitan*|sorrentina|amalfitan*|caprese|alla norcina|valtellin*',
    'carbonara|amatriciana|gricia|cacio e pepe|lasagn*|risott*|tiramis*|panna cotta|pizza|pizze|focacc*|bruschett*|caponata|arancin*|cannol*|ossobuc*|ossibuchi|saltimbocca|vitello tonnato|parmigiana|gnocch*|polenta|minestrone|ribollita|pesto|ragu|piadin*|frittata|pasta|spaghett*|penne|tagliatell*|fettuccin*|orecchiette|trofie|raviol*|tortellin*|tortelloni|cappellett*|pici|bucatini|paccheri|rigatoni|linguine|fusilli|farfalle|maccheroni|zabaion*|cantucci|panettone|pandoro|sfogliatell*|baba al rum|crostata|maritozz*|suppli|porchetta|carpaccio|gelato|granita|affogato|amaretti|ciambell*|castagnaccio|cassata|pastiera|struffoli|cotechino|bollito misto|peperonata|zuppa inglese|torta caprese|pasta e fagioli|pasta e ceci|panzanella|acquacotta|cotoletta|scaloppin*|spritz|negroni|bellini|limoncello|sbrisolona|bigoli|canederli|passatelli|tigelle|crescentin*|olive ascolane|frico|bagna cauda|vitel tonne'],
  es: ['eu', 'spagnol*|spanish|spanisch*|espanol*|andalus*|catalan*|valencian*|basc[ao]|basque|baskisch*|madrilen*|gallego|galizi*',
    'paella|gazpacho|tortilla espanola|tortilla de patatas|churros|crema catalana|patatas bravas|tapas|pisto|salmorejo|fabada|sangria|albondigas|pan con tomate|pimientos de padron|croquetas|jamon iberico'],
  pt: ['eu', 'portoghes*|portuguese|portugiesisch*', 'pastel de nata|pasteis de nata|bacalhau|caldo verde|francesinha'],
  fr: ['eu', 'frances*|french|franzosisch*|francais*|alsazian*|elsasser|alsatian|provenzal*|provencal*|parigin*|parisian|bretone|breton|normann*|lionese|lyonnaise|nicoise|nizzard*|bourguignon|bordolese',
    'ratatouille|quiche|patate alla parigina|crepe*|croissant*|souffle|bouillabaisse|coq au vin|boeuf bourguignon|tarte tatin|croque monsieur|creme brulee|gratin dauphinois|cassoulet|madeleine*|macaron*|eclair*|vichyssoise|clafoutis|galette*|brioche|tartiflette|flammkuchen|tarte flambee|blanquette|confit de canard|pot au feu|choucroute|financier*|mille feuille|millefoglie'],
  de: ['eu', 'tedesc*|german|deutsch*|bavares*|bavarian|bayerisch*|schwabisch*|swabian|berliner art|rheinisch*|thuringer|frankisch*|westfalisch*|hessisch*',
    'spatzle|kasespatzle|sauerbraten|bratwurst|currywurst|kartoffelsalat|sauerkraut|brezel*|brezn|rouladen|maultaschen|schwarzwalder|stollen|lebkuchen|eisbein|labskaus|frikadellen|konigsberger klopse|rote grutze|zwetschgenkuchen|bienenstich|weisswurst|leberkas*|obatzda|reibekuchen|kartoffelpuffer|himmel und erde|pumpernickel|gluhwein|kaiserbrotchen'],
  at: ['eu', 'austriac*|austrian|osterreich*|wiener|tiroler|salzburger|karntner|viennese',
    'apfelstrudel|strudel|kaiserschmarrn|sachertorte|tafelspitz|germknodel|palatschinken|linzer torte|kaspressknodel|marillenknodel|backhendl|topfenstrudel|vanillekipferl'],
  ch: ['eu', 'svizzer*|swiss|schweizer*|zurcher|bernese', 'rosti|fondue|raclette|geschnetzeltes|birchermuesli|bircher|alplermagronen|basler leckerli'],
  hu: ['eu', 'ungheres*|hungarian|ungarisch*', 'gulasch|goulash|gulyas|langos|paprikash|paprikas csirke|dobos'],
  pl: ['eu', 'polacc*|polish|polnisch*', 'pierogi|bigos|zurek|kielbasa|golabki'],
  ru: ['eu', 'russ[ao]|russe|russian|russisch*', 'blini|pelmeni|stroganoff|stroganov|insalata russa|russischer zupfkuchen|olivier|syrniki|kulebiaka|pirozhki|piroschki|solyanka|soljanka'],
  ua: ['eu', 'ucrain*|ukrainian|ukrainisch*', 'borscht|borsch|borschtsch|varenyky|holubtsi'],
  cz: ['eu', 'cec[ao]|ceche|czech|tschechisch*|boem*|bohemian|bohmisch*', 'svickova|trdelnik|knedliky|kolache|buchteln'],
  gr: ['eu', 'grec[ao]|greche|greci|greek|griechisch*|cretes*|cretan',
    'moussaka|mousaka|souvlaki|tzatziki|gyros|spanakopita|dolmades|melomakarona|kourabiedes|horiatiki|pastitsio|fasolada|stifado|loukoumades|galaktoboureko|keftedes|avgolemono|saganaki|tiropita|briam|gemista'],
  gb: ['eu', 'ingles*|english|englisch*|british|britannic*|britisch*|scozzes*|scottish|schottisch*|scotch|gallese|welsh|walisisch*|cornish',
    'fish and chips|shepherd s pie|shepherds pie|cottage pie|scones|crumble|trifle|yorkshire pudding|sunday roast|beef wellington|sticky toffee|bangers and mash|haggis|shortbread|welsh rarebit|eton mess|victoria sponge|mince pie*|christmas pudding|cornish pasty|bread and butter pudding|toad in the hole|kedgeree|full english|flapjack*|crumpets|cullen skink|bakewell'],
  ie: ['eu', 'irlandes*|irish|irisch*', 'irish stew|soda bread|colcannon|boxty|irish coffee|barmbrack'],
  nl: ['eu', 'olandes*|dutch|hollandisch*|niederlandisch*', 'stroopwafel*|poffertjes|bitterballen|stamppot|erwtensoep|hutspot|oliebollen'],
  be: ['eu', 'belg[ae]|belgi*|belgian', 'moules frites|carbonade flamande|speculoos|waterzooi|liege waffle*'],
  dk: ['eu', 'danes*|danish|danisch*', 'smorrebrod|aebleskiver|frikadeller|wienerbrod|risalamande'],
  se: ['eu', 'svedes*|swedish|schwedisch*', 'kottbullar|kanelbullar|gravlax|gravad lax|smorgasbord|janssons|semla|semlor|prinsesstarta|kladdkaka'],
  no: ['eu', 'norveges*|norwegian|norwegisch*', 'lefse|farikal|lutefisk|krumkake'],
  fi: ['eu', 'finlandes*|finnish|finnisch*', 'karjalanpiirakka|pulla|leipajuusto'],
  hr: ['eu', 'croat*|croatian|kroatisch*', 'peka|strukli|pasticada'],
  tr: ['me', 'turc[ao]|turchi|turkish|turkisch*|ottoman*|anatolic*', 'kebab|kebap|doner|baklava|kofte|kofta|lahmacun|pide|borek|menemen|ayran|simit|imam bayildi|iskender|manti|kunefe|lokum'],
  lb: ['me', 'libanes*|lebanese|libanesisch*', 'hummus|houmous|falafel|tabbouleh|tabule|baba ganoush|baba ghanoush|fattoush|shawarma|manakish|labneh|kibbeh|mutabal|muhammara'],
  il: ['me', 'israel*|ebraic*|jewish|judisch*|kosher', 'sabich|challah|hamantaschen|matzah|matzo|latkes|rugelach'],
  ir: ['me', 'persian*|persian|persisch*|iranian*|irani*', 'ghormeh sabzi|tahdig|fesenjan|kuku sabzi|joojeh|zereshk polo'],
  sy: ['me', 'sirian*|syrian|syrisch*', 'fatteh|kibbeh nayeh'],
  ma: ['af', 'marocchin*|moroccan|marokkanisch*|magrebin*|maghrebin*', 'tajine|tagine|couscous|cuscus|harira|pastilla|bastilla|msemen|chebakia|zaalouk'],
  tn: ['af', 'tunisin*|tunisian|tunesisch*', 'shakshuka|shakshouka|brik|harissa|lablabi'],
  eg: ['af', 'egizian*|egyptian|agyptisch*', 'koshari|kushari|ful medames|molokhia|basbousa'],
  et: ['af', 'etiop*|ethiopian|athiopisch*', 'injera|doro wat|kitfo|berbere'],
  za: ['af', 'sudafrican*|south african|sudafrikanisch*', 'bobotie|biltong|braai|bunny chow|malva pudding|koeksister*'],
  ng: ['af', 'nigerian*|nigerianisch*|westafrican*|west african', 'jollof|egusi|suya|puff puff'],
  sn: ['af', 'senegales*|senegalese|senegalesisch*', 'thieboudienne|yassa|mafe'],
  us: ['na', 'american*|americano|all americana|amerikanisch*|statunitens*|cajun|creole|kreolisch*|tex mex|texan*|texas|new york|hawaian*|hawaiian|hawaiianisch*|southern style|new england|californian*|kalifornisch*',
    'hamburger|burger*|cheeseburger|brownie*|cheesecake|mac and cheese|mac n cheese|buffalo wings|meatloaf|pulled pork|bbq ribs|barbecue ribs|cornbread|pecan pie|pumpkin pie|apple pie|clam chowder|cobbler|chocolate chip cookies|bagel*|hot dog*|jambalaya|gumbo|banana bread|s mores|smores|coleslaw|cinnamon roll*|key lime pie|red velvet|corn dog*|sloppy joe*|po boy|poke bowl|poke|cosmopolitan|manhattan|old fashioned|mai tai|whoopie pie*|grits|biscuits and gravy'],
  ca: ['na', 'canades*|canadian|kanadisch*|quebec*', 'poutine|butter tarts|nanaimo bar*|tourtiere|bannock'],
  mx: ['la', 'messican*|mexican|mexikanisch*|yucatec*', 'mexican wedding cookies|taco*|burrito*|quesadilla*|enchilada*|guacamole|chili con carne|nacho*|fajita*|mole poblano|mole|pozole|tamale*|tamales|huevos rancheros|chilaquiles|elote|sopes|tostada*|carnitas|al pastor|pico de gallo|margarita*|horchata|tres leches|churro*'],
  cu: ['la', 'cuban*|cubano|kubanisch*', 'ropa vieja|mojito*|daiquiri*|cuba libre|picadillo|moros y cristianos'],
  jm: ['la', 'giamaican*|jamaican|jamaikanisch*|caraib*|caribbean|karibisch*', 'jerk chicken|jerk|ackee|rice and peas'],
  pr: ['la', 'portoricen*|puerto rican', 'pina colada|mofongo|pastelon'],
  pe: ['la', 'peruvian*|peruviano|peruanisch*', 'ceviche|lomo saltado|causa limena|aji de gallina|pisco sour|anticuchos|papa a la huancaina'],
  ar: ['la', 'argentin*|argentinian|argentinisch*', 'empanada*|chimichurri|dulce de leche|alfajor*|asado|milanesa|locro|provoleta'],
  br: ['la', 'brasilian*|brazilian|brasilianisch*', 'feijoada|brigadeiro*|pao de queijo|moqueca|coxinha*|caipirinha*|acai bowl|picanha|farofa|quindim'],
  co: ['la', 'colombian*|kolumbianisch*', 'arepa*|bandeja paisa|ajiaco'],
  ve: ['la', 'venezuelan*|venezolanisch*', 'pabellon criollo|cachapa*'],
  cl: ['la', 'cilen*|chilean|chilenisch*', 'pastel de choclo|sopaipilla*|cazuela chilena'],
  jp: ['as', 'giappones*|japanese|japanisch*|okinawa*|nipponic*',
    'sushi|sashimi|ramen|tempura|teriyaki|miso soup|zuppa di miso|misosuppe|udon|soba|onigiri|gyoza|yakitori|katsu|tonkatsu|okonomiyaki|matcha|mochi|donburi|sukiyaki|takoyaki|edamame|karaage|nikujaga|oyakodon|katsudon|dorayaki|chawanmushi|shabu shabu|tamagoyaki|yakisoba|uramaki|nigiri|maki'],
  cn: ['as', 'cines*|chinese|chinesisch*|cantones*|cantonese|kantonesisch*|szechuan|sichuan|pechines*|peking|pekinese|hunan|shanghai*',
    'chow mein|kung pao|dim sum|wonton*|won ton|mapo tofu|anatra laccata|peking duck|pekingente|char siu|involtini primavera|spring roll*|fruhlingsrolle*|bao|baozi|hot pot|hotpot|jiaozi|xiaolongbao|congee|dan dan|lo mein|chop suey|mooncake*|riso alla cantonese|egg fried rice|zongzi|gong bao'],
  kr: ['as', 'corean*|korean|koreanisch*', 'kimchi|bibimbap|bulgogi|tteokbokki|japchae|gochujang|kimbap|gimbap|samgyeopsal|sundubu|dakgalbi|bingsu|korean fried chicken'],
  th: ['as', 'thai|tailandes*|thailandes*|thailandisch*|siames*',
    'pad thai|tom yum|tom yam|tom kha|green curry|curry verde|grunes curry|red curry|curry rosso|rotes curry|massaman|som tam|larb|laab|pad see ew|khao pad|mango sticky rice|pad kra pao|panang|tom kha gai'],
  vn: ['as', 'vietnamit*|vietnamese|vietnamesisch*', 'pho|banh mi|bun cha|goi cuon|bun bo|cha gio|nuoc cham|banh xeo|com tam|ca kho'],
  in: ['as', 'indian[ao]|indiani|indian|indisch*|bengal*|punjab*|kerala|goan[ao]?|goa|tamil|mughlai|tandoori',
    'curry|currys|tikka masala|tikka|biryani|biriyani|dal makhani|tarka dal|dhal|daal|dahl|samosa*|naan|chapati|paneer|korma|vindaloo|chutney|raita|lassi|masala|palak|aloo gobi|aloo|chana|pakora*|dosa|idli|butter chicken|murgh makhani|rogan josh|saag|bhaji|bhajis|kheer|gulab jamun|halwa|jalebi|chai|tarka|madras|jalfrezi|pulao|kofta curry|keema|rasam|sambar|uttapam'],
  pk: ['as', 'pakistan*|pakistanisch*', 'nihari|haleem|karahi|chapli kebab'],
  id: ['as', 'indonesian*|indonesisch*|balines*|balinese|giavanes*|javanese', 'nasi goreng|rendang|satay|sate ayam|gado gado|mie goreng|sambal|tempeh goreng|soto ayam|nasi uduk'],
  my: ['as', 'malaysian*|malese|malaysisch*', 'nasi lemak|laksa|roti canai|char kway teow|rendang daging'],
  sg: ['as', 'singapor*|singapurisch*', 'hainanese chicken rice|chilli crab|singapore noodles|kaya toast'],
  ph: ['as', 'filippin*|filipino|philippinisch*|philippine', 'adobo|lumpia|sinigang|pancit|lechon|halo halo|kare kare|sisig|leche flan'],
  ge: ['as', 'georgian[ao]?|georgisch*', 'khachapuri|khinkali|pkhali|chakhokhbili|churchkhela'],
  au: ['oc', 'australian*|australisch*', 'pavlova|lamington*|anzac biscuit*|anzac|vegemite|meat pie|damper|fairy bread|tim tam'],
  nz: ['oc', 'neozelandes*|new zealand|neuseelandisch*|maori', 'hangi|hokey pokey|afghan biscuit*'],
};
// continent-only words ("cucina asiatica", "orientalisch")
const CONT_WORDS = {
  as: 'asiatic*|asian|asiatisch*|orientale|orientali|oriental|orientalisch*|fernost*|far east*',
  me: 'mediorient*|middle eastern|middle east|nahost*|levantin*|arabic*|arab|arabisch*|arabian',
  af: 'african[ao]?|african|afrikanisch*|nordafrican*|north african|nordafrikanisch*',
  la: 'sudamerican*|south american|sudamerikanisch*|latinoamerican*|latin american|lateinamerikanisch*|tex mex',
  eu: 'europe[ao]|european|europaisch*|balcan*|balkan*|scandinav*|skandinavisch*|nordic|nordisch*',
};
// names that sound like a place but aren't from there
// (only ignored when looking for origin words; dish names still count, e.g. "zuppa inglese" is Italian)
const FALSE_FRIENDS = /(?<![a-z])(?:french toast|french fries|french dressing|swiss roll|swiss chard|english muffin|scotch bonnet|spanish onion|italian seasoning|chinese cabbage|cavolo cinese|chinakohl|danish blue|belgian endive|zuppa inglese|crema inglese|dutch oven|dutch baby|parisienne potatoes|wiener wurstchen|wiener wurstel|patate alla parigina|thai basil|basilico thai|thai basilikum|insalata russa|russischer zupfkuchen|mexican wedding cookies)(?![a-z])/g;

const simple = (s) => String(s || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/['’`]/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

// lexicon words are plain ascii: `*` = any ending, `[ao]` / `?` are regex as written
function pattern(list) {
  const alts = list.split('|').map((w) => w.trim().replace(/\*/g, '[a-z]*'));
  return new RegExp(`(?<![a-z])(?:${alts.join('|')})(?![a-z])`);
}

const TABLE = Object.entries(C).map(([code, [cont, adj, dish]]) => ({ code, cont, adj: pattern(adj), dish: pattern(dish) }));
const CONT_TABLE = Object.entries(CONT_WORDS).map(([cont, words]) => ({ cont, re: pattern(words) }));
export const COUNTRY_CONTINENT = Object.fromEntries(Object.entries(C).map(([code, [cont]]) => [code, cont]));

// "Italian", "Italiana", "italienisch", "Mediterranean" … as a stated cuisine
const CUISINE_EXTRA_RAW = {
  it: 'italia|italy|italien', es: 'spagna|spain|spanien', fr: 'francia|france|frankreich', de: 'germania|germany|deutschland',
  gr: 'grecia|greece|griechenland', jp: 'giappone|japan', cn: 'cina|china', in: 'india|indien', mx: 'messico|mexico|mexiko',
  th: 'thailandia|thailand', us: 'usa|stati uniti|united states|vereinigte staaten', gb: 'regno unito|uk|united kingdom|england|inghilterra|gross britannien|grossbritannien',
  tr: 'turchia|turkey|turkei|turkiye', ma: 'marocco|morocco|marokko', at: 'austria|osterreich', ch: 'svizzera|switzerland|schweiz',
};

const CUISINE_EXTRA = Object.entries(CUISINE_EXTRA_RAW).map(([code, words]) => [code, pattern(words)]);

// country names in it/de/en ("Perù", "Japan", "Marokko") for a cuisine field typed by hand
let NAMES = null;
function countryByName(s) {
  if (!NAMES) {
    NAMES = [];
    try {
      for (const lang of ['it', 'de', 'en']) {
        const dn = new Intl.DisplayNames([lang], { type: 'region' });
        for (const code of Object.keys(C)) { const n = simple(dn.of(code.toUpperCase())); if (n && n !== code) NAMES.push([code, new RegExp(`(?<![a-z])${n}(?![a-z])`)]); }
      }
    } catch { /* no Intl names: the word lists still work */ }
  }
  const hit = NAMES.find(([, re]) => re.test(s));
  return hit ? hit[0] : null;
}

function findCountry(text, { dishes = true } = {}) {
  const full = ` ${simple(text)} `;
  if (!full.trim()) return null;
  const s = full.replace(FALSE_FRIENDS, (m) => ' '.repeat(m.length));
  // origin words first, earliest in the text; then dishes
  let best = null;
  for (const row of TABLE) {
    const m = s.match(row.adj);
    if (m && (!best || m.index < best.index)) best = { code: row.code, cont: row.cont, index: m.index, by: 'word' };
  }
  if (best) return best;
  if (!dishes) return null;
  for (const row of TABLE) {
    const m = full.match(row.dish);
    // the longest dish name wins ("riso alla cantonese" over "riso"), then the earliest
    if (m && (!best || m[0].length > best.len || (m[0].length === best.len && m.index < best.index))) best = { code: row.code, cont: row.cont, index: m.index, len: m[0].length, by: 'dish' };
  }
  return best;
}

function findContinent(text) {
  const s = ` ${simple(text)} `;
  for (const row of CONT_TABLE) if (row.re.test(s)) return row.cont;
  return null;
}

/** → { country: 'it' | null, continent: 'eu' | null, by: 'cuisine' | 'word' | 'dish' } or null */
export function originOf(r) {
  const cuisine = [].concat(r.cuisine || []).join(' ');
  if (cuisine) {
    const s = simple(cuisine);
    let hit = findCountry(s, { dishes: false });
    if (!hit) {
      for (const [code, re] of CUISINE_EXTRA) if (re.test(` ${s} `)) { hit = { code, cont: COUNTRY_CONTINENT[code] }; break; }
    }
    if (!hit) { const code = countryByName(s); if (code) hit = { code, cont: COUNTRY_CONTINENT[code] }; }
    if (hit) return { country: hit.code, continent: hit.cont, by: 'cuisine' };
  }
  const hit = findCountry(r.title || '');
  if (hit) return { country: hit.code, continent: hit.cont, by: hit.by };
  const cont = findContinent(`${r.title || ''} ${cuisine}`);
  return cont ? { country: null, continent: cont, by: 'word' } : null;
}

/** 🇮🇹 from "it" */
export function flagOf(code) {
  if (!/^[a-z]{2}$/.test(code || '')) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
export const CONTINENT_ICON = { eu: '🌍', af: '🌍', me: '🌍', as: '🌏', oc: '🌏', na: '🌎', la: '🌎' };
