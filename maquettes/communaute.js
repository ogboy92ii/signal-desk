// Page Communauté : tous les desks réels, rangés en collections (swing BTC / ETH, altcoins, nouveaux…).
// Suivre une collection = suivre chacun de ses membres (avec l'adresse du desk, pour l'inscription on-chain).
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const D = window.SD_DATA;
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loc = () => document.documentElement.lang || 'fr-FR';
  const num = v => new Intl.NumberFormat(loc()).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const av = name => { const s = el('span', 'av'); s.appendChild(D.avatar(name)); return s; };
  const link = n => 'profil.html?c=' + encodeURIComponent(n);

  const people = D.base.map(c => D.profile(c));
  // Nombre de calls d'un caller sur des sous-catégories (NBA, UFC…) ou des paires (BTC, ETH…).
  const on = (p, keys) => p.calls.filter(x => keys.includes(x.sub) || keys.includes((x.pair || '').replace('USDT', ''))).length;
  const by = (list, f) => list.slice().sort((a, b) => f(b) - f(a));
  const pick = (style, keys) => by(people.filter(p => p.style === style && on(p, keys) >= 3), p => on(p, keys));

  const COLS = [
    { id: 'top', cat: 'all', name: 'Les plus suivis', desc: 'Ceux que la communauté suit le plus, toutes catégories.', members: () => by(people.filter(p => p.followers > 0), p => p.followers).slice(0, 10) },
    { id: 'swing', cat: 'crypto', name: 'Swing BTC / ETH', desc: 'Les deux grandes paires, horizons de quelques jours.', members: () => pick('crypto', ['BTC', 'ETH']) },
    { id: 'alts', cat: 'crypto', name: 'Altcoins', desc: 'SOL, XTM et les autres paires.', members: () => pick('crypto', ['SOL', 'XTM', 'XRP', 'BNB']) },
    { id: 'new', cat: 'all', name: 'Nouveaux talents', desc: 'Arrivés il y a moins de 90 jours.', members: () => by(people.filter(p => p.age < 90), p => p.rate) },
    { id: 'all', cat: 'all', name: 'Tous les callers', desc: 'Chaque profil de Signal Desk, par ordre alphabétique.', members: () => people.slice().sort((a, b) => a.display.localeCompare(b.display)) },
  ];
  const open = new Set();
  let query = '';

  function row(p) {
    const a = el('a', 'cm-row'); a.href = link(p.name);
    const who = el('span', 'cm-who'); who.append(el('b', '', p.display), el('small', '', num(p.followers) + ' ' + window.sdPl(p.followers, 'abonné', 'abonnés')));
    // Réussite seulement à partir d'un call clos (0 % sans call clos serait un faux chiffre).
    a.append(av(p.name), who, el('span', 'num cm-rate' + (p.closed && p.rate >= 45 ? ' up' : ''), p.closed ? pct(p.rate) : '—'));
    return a;
  }
  function card(col) {
    const list = col.members(); if (!list.length) return null;
    const art = el('article', 'cm-col ' + col.cat);
    const top = el('div', 'cm-top'); const big = el('div', 'cm-big'); list.slice(0, 3).forEach(p => big.appendChild(av(p.name)));
    top.append(big, el('span', 'num cm-n', num(list.length) + ' ' + window.sdPl(list.length, 'caller', 'callers')));
    const body = el('div', 'cm-b');
    const head = el('div', 'cm-h'); head.appendChild(el('h3', '', t(col.name)));
    const all = () => list.every(p => D.follow.has(p.name));
    const fol = el('button', 'btn-sm cm-fol'); fol.type = 'button';
    const paint = () => { const yes = all(); fol.textContent = t(yes ? 'Collection suivie' : 'Suivre la collection'); fol.classList.toggle('on', yes); fol.setAttribute('aria-pressed', String(yes)); };
    // Un par un avec l'adresse du desk : setMany ne la transmet pas, l'abonnement ne serait pas inscrit on-chain.
    fol.addEventListener('click', () => { const yes = !all(); list.filter(p => D.follow.has(p.name) !== yes).forEach(p => D.follow.toggle(p.name, p.desk)); render(); });
    paint(); head.appendChild(fol);
    const rows = el('div', 'cm-rows'); const shown = open.has(col.id) ? list : list.slice(0, 4); shown.forEach(p => rows.appendChild(row(p)));
    body.append(head, el('p', '', t(col.desc)), rows);
    if (list.length > 4) {
      const more = el('button', 'lnk cm-more', open.has(col.id) ? t('Réduire') : t('Voir les {n}').replace('{n}', num(list.length))); more.type = 'button';
      more.setAttribute('aria-expanded', String(open.has(col.id)));
      more.addEventListener('click', () => { open.has(col.id) ? open.delete(col.id) : open.add(col.id); render(); });
      body.appendChild(more);
    }
    art.append(top, body); return art;
  }
  // Recherche : les profils dont le nom contient le texte, à la place des collections.
  function results() {
    const q = query.toLowerCase(), list = people.filter(p => p.name.includes(q) || p.display.toLowerCase().includes(q)).sort((a, b) => b.followers - a.followers);
    const box = el('div', 'cm-found'); list.forEach(p => box.appendChild(row(p)));
    return { box, n: list.length };
  }
  function render() {
    const grid = $('cm-grid'); grid.replaceChildren();
    $('cm-count').textContent = t('{n} callers').replace('{n}', num(people.length));
    if (query) {
      const { box, n } = results(); if (n) grid.appendChild(box);
      $('cm-none').hidden = n > 0; $('cm-eyebrow').textContent = t('Recherche'); $('cm-h').textContent = t('{n} résultats').replace('{n}', num(n));
      grid.classList.add('found'); return;
    }
    grid.classList.remove('found'); $('cm-none').hidden = true;
    $('cm-eyebrow').textContent = t('Collections'); $('cm-h').textContent = t('Suivez par affinités');
    COLS.forEach(c => { const n = card(c); if (n) grid.appendChild(n); });
    if (!people.length) {
      const e = el('div', 'rk-empty'), go = el('a', 'lnk', t('Créer mon desk')); go.href = 'site-signal-desk.html#commencer';
      e.append(el('p', '', t('Aucun desk ouvert pour l’instant : le premier apparaîtra ici.')), go); grid.appendChild(e);
    }
  }

  $('cm-q').addEventListener('input', e => { query = e.target.value.trim(); render(); });
  addEventListener('sd:follow', render);
  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); if (dock) dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
});
