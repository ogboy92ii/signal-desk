// Anti-encadrement, valable sur tout hébergeur : sur Vercel, l'en-tête frame-ancestors suffit ; ailleurs, une
// page affichée dans le cadre d'un autre site se masque et reprend toute la fenêtre (clic détourné impossible).
if (window.top !== window.self) { document.documentElement.style.display = 'none'; try { window.top.location.replace(location.href); } catch (e) {} }
// Langues : sélecteur, traduction des textes de la page, formats des nombres. Partagé par toutes les pages.
document.querySelectorAll('form.field').forEach(f => f.addEventListener('submit', e => e.preventDefault()));
(() => {
  const K = window.SD_K, T = window.SD_T, LANGS = window.SD_LANGS;
  const idx = new Map(K.map((k, i) => [k, i]));
  const loc = code => (LANGS.find(l => l[0] === code) || LANGS[0])[2];
  const skip = el => el.closest('script,style,svg,#langdock,[data-n]');
  const texts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim() && !skip(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  // 11/11 : réseau affiché (même règle que chain.js VIEW) ; le bandeau « En ligne sur le testnet Tari » des pages suit ce réseau.
  window.SD_NET = (() => { let n = null; try { n = new URLSearchParams(location.search).get('net') || localStorage.getItem('sd-net'); } catch (e) {} return n === 'esmeralda' ? 'esmeralda' : 'mainnet'; })();
  for (let n; (n = walk.nextNode());) {
    if (window.SD_NET === 'mainnet' && n.nodeValue.trim() === 'En ligne sur le testnet Tari') n.nodeValue = n.nodeValue.replace('testnet', 'mainnet');
    texts.push({ n, fr: n.nodeValue, key: n.nodeValue.trim() });
  }
  const attrs = [...document.querySelectorAll('[placeholder],[aria-label="Langue"]')].map(el => ({ el, ph: el.getAttribute('placeholder'), aria: el.getAttribute('aria-label') }));
  const frTitle = document.title;
  // Nombres français affichés en dur (« 1 284 », « 54,2 % ») : reformatés pour la langue choisie.
  const NUM = /^(\d{1,3}(?:[   ]\d{3})*)(?:,(\d+))?(\s?%)?$/;
  const fmt = (v, d, pct, l) => new Intl.NumberFormat(loc(l), pct ? { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d } : { minimumFractionDigits: d, maximumFractionDigits: d }).format(pct ? v / 100 : v);
  window.SD_LANG = 'fr';
  window.sdFmt = (v, d, pct) => fmt(v, d, pct, window.SD_LANG);
  // Recette V10/V11 (09/11) : pluriel selon la langue (français : 0 et 1 au singulier) et âge en jours (« aujourd'hui » pour 0).
  window.sdPl = (n, one, many) => window.sdT((window.SD_LANG === 'fr' ? n < 2 : n === 1) ? one : many);
  window.sdDays = v => (v < 1 ? window.sdT("aujourd'hui") : new Intl.NumberFormat(loc(window.SD_LANG), { style: 'unit', unit: 'day', unitDisplay: 'short' }).format(v));
  window.sdT = k => (window.SD_LANG === 'fr' ? k : ((window.SD_T[window.SD_LANG] || [])[idx.get(k)] || k));
  // Questions bilingues des ligues (« français ? / English? (règle / rule) ») : on n'affiche que la moitié de la
  // langue choisie (anglais pour toute langue autre que le français). Texte d'une autre forme : rendu tel quel.
  const cut = s => { const at = []; let d = 0; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '(') d++; else if (ch === ')') d--; else if (!d && s.startsWith(' / ', i)) at.push(i); } return at.length === 1 ? [s.slice(0, at[0]), s.slice(at[0] + 3)] : null; };
  window.sdBi = s => {
    const h = typeof s === 'string' && cut(s); if (!h || !h[0].includes('?') || !h[1].includes('?')) return s;
    let [fr, en] = h; const m = /^(.*\S) \(([^()]*)\)$/.exec(en);
    const r = m && cut(m[2]);
    if (r) { en = m[1] + ' (' + r[1] + ')'; fr += ' (' + r[0] + ')'; } else if (m && !fr.endsWith(')')) fr += ' (' + m[2] + ')';
    return window.SD_LANG === 'fr' ? fr : en;
  };
  // Titre et règle d'une question (10/11) : la règle de résolution écrite entre parenthèses en fin de question
  // (« (Binance, prix à l'heure dite) », « (source : CEC Taiwan) ») s'affiche à part, comme sur un marché de prédiction.
  window.sdQ = s => {
    let title = String(window.sdBi(s) || ''); const rules = [];
    for (let m; (m = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(title)) && m[1].includes('?');) { rules.unshift(m[2].replace(/^source\s*:\s*/i, '').trim()); title = m[1]; }
    return { title, rule: rules.join(' · ') };
  };
  // Choix écrits dans les deux langues par l'organisateur : seul le libellé change, la valeur scellée reste la chaîne entière.
  const OPTS = { 'Other / Autre': ['Autre', 'Other'], 'Tie / Ex aequo': ['Ex aequo', 'Tie'], 'Nul / Draw': ['Nul', 'Draw'] };
  window.sdOpt = o => (Object.hasOwn(OPTS, o) ? OPTS[o][window.SD_LANG === 'fr' ? 0 : 1] : o);
  // Images du sujet d'une question (10/11) : logos crypto (cryptocurrency-icons, CC0), drapeaux (flag-icons, MIT),
  // sigles des deux équipes en écusson pour un match. Le sujet se lit dans le texte de la question (rien de plus sur la chaîne).
  const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'];
  const FLAGS = [['tw', /Ta[iï]wan|Taipei/i], ['us', /R[ée]serve f[ée]d[ée]rale|Federal Reserve|\bFed\b/i], ['fr', /fran[cç]aise?\b|\bFrance\b|\bFrench\b/i]];
  const LEAGUES = { NBA: 'NBA', NFL: 'NFL', 'Premier League': 'EPL', 'Ligue des champions': 'UCL', 'Champions League': 'UCL' };
  window.sdSubject = (q, opts) => {
    const s = String(q || ''), m = /^\s*([^:]{2,30}?)\s*:\s*([A-Z0-9]{2,5}) (?:à|at) ([A-Z0-9]{2,5}),/.exec(s);
    // Match : logo de chaque équipe (img/equipes/<ligue>/<sigle>.png, logos ESPN 96 px), sigle en secours si l'image manque.
    if (m) { const lg = LEAGUES[m[1].trim()], logo = x => (lg ? { src: 'img/equipes/' + lg + '/' + x.toLowerCase() + '.png', txt: x, logo: true } : { txt: x }); return { cat: 'sport', icons: [logo(m[2]), logo(m[3])] }; }
    const all = s + ' ' + (Array.isArray(opts) ? opts.join(' ') : ''), coins = COINS.filter(c => new RegExp('\\b' + c + '\\b').test(all));
    if (coins.length) return { cat: 'crypto', icons: coins.slice(0, 3).map(c => ({ src: 'img/sujets/' + c.toLowerCase() + '.svg' })) };
    const f = FLAGS.find(x => x[1].test(s));
    return f ? { cat: 'pol', icons: [{ src: 'img/sujets/flag-' + f[0] + '.svg' }] } : null;
  };
  /** Les pastilles du sujet (élément décoratif), ou null si le sujet n'est pas reconnu. */
  window.sdSubjectEl = (q, opts) => {
    const sj = window.sdSubject(q, opts); if (!sj) return null;
    const box = document.createElement('span'); box.className = 'pr-sj ' + sj.cat; box.setAttribute('aria-hidden', 'true');
    const badge = x => { const b = document.createElement('b'); b.textContent = x; return b; };
    for (const i of sj.icons) {
      if (!i.src) { box.appendChild(badge(i.txt)); continue; }
      const im = new Image(); im.alt = ''; im.width = im.height = 40; im.decoding = 'async'; if (i.logo) im.className = 'lg';
      if (i.txt) im.addEventListener('error', () => im.replaceWith(badge(i.txt)), { once: true });
      im.src = i.src; box.appendChild(im);
    }
    return box;
  };
  const btn = document.getElementById('langbtn'), list = document.getElementById('langlist'), cur = document.getElementById('langcur');
  for (const [code, name] of LANGS) { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.tabIndex = -1; li.dataset.lang = code; li.innerHTML = '<span></span><small></small>'; li.firstChild.textContent = name; li.lastChild.textContent = code.toUpperCase(); list.appendChild(li); }
  const close = () => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => { list.hidden = false; btn.setAttribute('aria-expanded', 'true'); (list.querySelector('[aria-selected="true"]') || list.firstChild).focus(); };
  btn.addEventListener('click', e => { e.stopPropagation(); list.hidden ? open() : close(); });
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) { window.sdApplyLang(li.dataset.lang); close(); btn.focus(); } });
  list.addEventListener('keydown', e => {
    const items = [...list.children], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
    if (e.key === 'Escape') { close(); btn.focus(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('#langdock')) close(); });
  const tr = (key, l) => { if (l === 'fr') return null; const i = idx.get(key); return i === undefined ? null : (T[l] || [])[i] || null; };
  // Les traductions d'une langue (i18n/<langue>.js) ne sont chargées que si on la choisit.
  const loading = {};
  window.sdApplyLang = l => {
    if (l !== 'fr' && !LANGS.some(x => x[0] === l)) l = 'en';
    if (l !== 'fr' && !T[l]) {
      if (!loading[l]) {
        loading[l] = true;
        const sc = document.createElement('script'); sc.src = 'i18n/' + l + '.js';
        sc.onload = () => { if (T[l]) window.sdApplyLang(l); }; // l'appel global : les pages y ajoutent leur rendu
        sc.onerror = () => { loading[l] = false; };
        document.head.appendChild(sc);
      }
      return;
    }
    window.SD_LANG = l;
    document.documentElement.lang = loc(l);
    for (const t of texts) {
      const m = t.key.match(NUM);
      if (m) { const v = +(m[1].replace(/\D/g, '') + (m[2] ? '.' + m[2] : '')); { const out = fmt(v, m[2] ? m[2].length : 0, !!m[3], l); t.n.nodeValue = t.fr.replace(t.key, () => out); } continue; }
      const x = tr(t.key, l); t.n.nodeValue = x ? t.fr.replace(t.key, () => x) : t.fr;
    }
    for (const a of attrs) {
      if (a.ph) a.el.setAttribute('placeholder', tr(a.ph, l) || tr('@placeholder', l) || a.ph);
      if (a.aria) a.el.setAttribute('aria-label', tr('@aria', l) || a.aria);
    }
    // Titre : traduit par sa propre clé ; « @title » est celui de l'accueil.
    document.title = tr(frTitle, l) || (document.body.classList.contains('page-rk') ? frTitle : tr('@title', l) || frTitle);
    cur.textContent = l.toUpperCase(); list.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', String(li.dataset.lang === l)));
    document.querySelectorAll('[data-n]').forEach(el => { if (el.dataset.done) el.textContent = window.sdFmt(+el.dataset.n, +(el.dataset.d || 0), (el.dataset.s || '').includes('%')); });
    try { localStorage.setItem('sd-lang', l); } catch (e) {}
  };
  // 10/11 (Soufian) : anglais par défaut pour tout nouveau visiteur, quelle que soit la langue de son navigateur ;
  // la langue choisie dans le sélecteur reste mémorisée. Valeur mémorisée corrompue (audit K16) → anglais.
  let start; try { start = localStorage.getItem('sd-lang'); } catch (e) {}
  window.sdApplyLang(LANGS.some(l => l[0] === start) ? start : 'en');
})();
