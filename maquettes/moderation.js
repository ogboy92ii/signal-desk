// Modération (09/11, demande de Soufian) : rien ne s'efface d'une blockchain, donc le site
//  1. refuse à la saisie les textes injurieux, racistes ou haineux (nom, bio, étiquette, question, réponse Bluesky),
//  2. masque à l'affichage ceux qui sont passés quand même (écrits sans le site),
//  3. refuse au scellement les calls incohérents avec le marché (« calls débiles »).
// Le filtre normalise le texte (accents, majuscules, l33t, lettres répétées, séparateurs) avant de comparer.
(() => {
  const RULES = 'Règles : pas d’insulte, de racisme, de haine, de harcèlement, de contenu sexuel, de données personnelles, '
    + 'de lien ni d’arnaque. Un call crypto doit être cohérent avec le marché : entrée à moins de 10 % du prix, objectif et stop réalistes, '
    + 'échéance entre 1 h et 30 jours. Un call Finance / Politique nomme une source officielle de la liste, qui tranche son résultat. '
    + 'Un call libre se vend 10 TARI au plus et son résultat n’est pas vérifié. Ce qui enfreint ces règles est refusé ou masqué sur le site.';
  // Mots courts : comparés mot à mot (évite « con » dans « contrat »).
  const WORDS = new Set(['con', 'conne', 'connes', 'pute', 'putes', 'salope', 'salopes', 'encule', 'enculer', 'encules', 'enculee',
    'fdp', 'ntm', 'tg', 'batard', 'batards', 'pd', 'pede', 'pedes', 'tapette', 'gouine', 'bougnoule', 'bougnoul', 'negre', 'negres',
    'negro', 'bicot', 'youpin', 'youtre', 'chinetoque', 'bamboula', 'macaque', 'raton', 'sale arabe', 'cunt', 'fuck', 'fucker', 'fucking',
    'shit', 'bitch', 'bitches', 'whore', 'slut', 'fag', 'fags', 'faggot', 'dyke', 'retarded', 'nigger', 'niggers', 'nigga',
    'niggas', 'chink', 'chinks', 'spic', 'spics', 'kike', 'kikes', 'wetback', 'gook', 'tranny', 'nazi', 'nazis', 'hitler', 'kkk',
    'pedo', 'pedophile', 'rape', 'rapist', 'viol', 'violeur']);
  // Suites de lettres caractéristiques : cherchées dans le texte collé (contourne « n i g g e r », « f.u.c.k »).
  const STEMS = ['nigger', 'nigga', 'faggot', 'bougnoul', 'youpin', 'chinetoque', 'enculer', 'filsdepute', 'niquetamere', 'niquetamer',
    'sieg heil'.replace(' ', ''), 'heilhitler', 'whitepower', 'gaskike', 'fuck', 'killalljews', 'motherfucker', 'cocksucker'];
  const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '€': 'e', '!': 'i', '|': 'i' };
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$€!|]/g, c => LEET[c] || c).replace(/(.)\1{2,}/g, '$1$1');
  /** true si le texte contient un mot interdit. */
  function bad(text) {
    const n = norm(text);
    const words = n.split(/[^a-z]+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (WORDS.has(words[i]) || WORDS.has(words[i].replace(/(.)\1+/g, '$1'))) return true;
      if (i + 1 < words.length && WORDS.has(words[i] + ' ' + words[i + 1])) return true;
    }
    const glued = n.replace(/[^a-z]+/g, '');
    return STEMS.some(s => glued.includes(s));
  }
  /** Texte affiché à la place d'un contenu masqué. */
  const MASKED = '[contenu masqué]';
  const clean = (text, fallback = MASKED) => (bad(text) ? fallback : text);

  // ---- Calls crypto incohérents (« calls débiles ») : vérifiés au scellement, avant toute signature ----
  // c = résultat de sdChain.parseCall ; price = prix actuel de la paire (Binance), ou null si indisponible.
  // 10/11 (Soufian, remplace D3 du 09/11) : calls Finance / Politique autorisés si l'autorité qui fait foi est dans cette
  // liste (publique dès le scellement, le résultat est tranché sur sa publication officielle) ; calls libres autorisés,
  // sans verdict, prix plafonné puisque l'acheteur n'a aucun recours sur le fond.
  const SOURCES = { SEC: 'sec.gov', FED: 'federalreserve.gov', ECB: 'ecb.europa.eu', CFTC: 'cftc.gov',
    US: 'Résultat officiel, États-Unis', FR: 'Résultat officiel, France', BE: 'Résultat officiel, Belgique', EU: 'Résultat officiel, Union européenne', GB: 'Résultat officiel, Royaume-Uni' };
  const FREE_MAX_PRICE = 10;
  const LINK = /https?:|www\.|\.(com|org|net|io|xyz|gg|me|co|fr|be|ru|cn|app|link)\b|t\.me|discord\.gg|@[a-z0-9_]{3,}/i;
  // `tari` = prix de vente demandé (TARI), fourni par le formulaire de scellement.
  function callProblem(c, price, tari) {
    if (!c) return 'Call invalide : vérifiez les champs.';
    if (bad(c.label)) return 'Ce call contient un mot interdit par les règles.';
    if (c.cat === 'pol') {
      if (!Object.hasOwn(SOURCES, c.country)) return 'Source officielle inconnue : choisissez-en une dans la liste.';
      if (bad(c.choice)) return 'Ce call contient un mot interdit par les règles.';
      if (!(Date.parse(c.when) >= Date.now() + 3600e3)) return 'Échéance trop proche : au moins 1 h.';
      return null;
    }
    if (c.cat === 'free') {
      if (bad(c.text)) return 'Ce call contient un mot interdit par les règles.';
      if (LINK.test(c.text) || LINK.test(c.subject)) return 'Pas de lien ni de contact dans un call libre.';
      if (!(Date.parse(c.when) >= Date.now() + 3600e3)) return 'Échéance trop proche : au moins 1 h.';
      if (tari > FREE_MAX_PRICE) return 'Un call libre se vend {n} TARI au plus : son résultat n’est pas vérifié par le site.';
      return null;
    }
    if (c.cat === 'sport') {
      const S = window.sdSports, ok = S && S.VERIFIABLE[c.league] && S.VERIFIABLE[c.league].includes(c.pick[0]);
      if (!ok) return 'Ce type de pari ne peut pas être vérifié automatiquement : choisissez vainqueur, handicap ou total.';
      if (!(Date.parse(c.when) > Date.now() + 10 * 60e3)) return 'Le match commence dans moins de 10 minutes ou a déjà commencé.';
      return null;
    }
    const until = Date.parse(c.until), now = Date.now();
    if (!(until >= now + 3600e3)) return 'Échéance trop proche : au moins 1 h.';
    if (until > now + 30 * 864e5) return 'Échéance trop lointaine : 30 jours au plus.';
    const up = Math.abs(c.tp - c.entry) / c.entry, down = Math.abs(c.sl - c.entry) / c.entry;
    if (up < 0.02) return 'Objectif trop proche de l’entrée (moins de 2 %).';
    if (up > 0.5) return 'Objectif irréaliste (plus de 50 % de l’entrée).';
    if (down < 0.002) return 'Stop trop proche de l’entrée (moins de 0,2 %).';
    if (down > 0.3) return 'Stop trop loin (plus de 30 % de l’entrée).';
    // Audit I3 : un objectif minuscule avec un stop énorme gonfle le taux de réussite.
    if (up < down / 2) return 'Objectif trop petit par rapport au stop (il doit valoir au moins la moitié du stop).';
    if (price && Math.abs(c.entry - price) / price > 0.1) return 'Entrée trop éloignée du prix actuel (plus de 10 %).';
    return null;
  }

  window.sdMod = { RULES, bad, clean, MASKED, callProblem, SOURCES, FREE_MAX_PRICE };
})();
