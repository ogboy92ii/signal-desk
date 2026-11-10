// Page de catégorie : Crypto seulement pour l'instant (?c=crypto, ?s=BTC… ; une autre catégorie retombe sur crypto).
// Calls réels des desks lus sur la chaîne (SD_DATA). Un call scellé ne montre que son sujet public ;
// le pronostic n'apparaît qu'une fois le call ouvert.
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const D = window.SD_DATA;
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loc = () => document.documentElement.lang || 'fr-FR';
  const num = v => new Intl.NumberFormat(loc()).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 100);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const av = name => { const s = el('span', 'av'); s.appendChild(D.avatar(name)); return s; };
  const link = (n, call) => 'profil.html?c=' + encodeURIComponent(n) + (call ? '&call=' + call : '');
  const ago = d => { const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' }); return d < 1 ? rtf.format(-Math.max(1, Math.round(d * 24)), 'hour') : rtf.format(-Math.round(d), 'day'); };
  const clock = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), p = n => String(n).padStart(2, '0'); return (d ? d + t('j') + ' ' : '') + `${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`; };
  const t0 = Date.now(), left = s => s - (Date.now() - t0) / 1000;

  const qs = new URLSearchParams(location.search);
  const cat = Object.hasOwn(D.CATS, qs.get('c') || '') ? qs.get('c') : 'crypto';
  let sub = D.SUBS[cat].includes(qs.get('s') || '') ? qs.get('s') : 'all';
  // Catégorie inconnue ou retirée (?c=sport, ?c=pol) : l'adresse retombe sur crypto.
  if (qs.get('c') !== cat) { const u = new URL(location.href); u.searchParams.set('c', cat); history.replaceState(null, '', u); }
  // Sous-onglets de Communauté (10/11) : la catégorie affichée est l'onglet actif.
  document.querySelectorAll('.pr-sub a[data-c]').forEach(a => { const on = a.dataset.c === cat; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  // Aucun call sur la chaîne : message utile et lien pour sceller le premier.
  const empty = (p, msg) => {
    if (D.base.some(c => c.allCalls.length)) { p.textContent = t(msg); return; }
    const a = el('a', 'lnk', t('Sceller un call')); a.href = 'site-signal-desk.html#commencer';
    p.replaceChildren(t('Aucun call scellé pour l’instant.') + ' ', a);
  };
  const LEAD = {
    crypto: 'La paire et l\'horizon sont publics. Le sens et les niveaux restent scellés jusqu\'à l\'échéance.',
    sport: 'Le match et l\'heure sont publics. Le pronostic reste scellé jusqu\'à la fin du match, puis il est vérifié avec le score ESPN.',
    pol: 'Le sujet, la date et la source officielle sont publics. Le choix reste scellé jusqu\'à l\'échéance, puis le résultat est tranché sur la publication officielle.',
    free: 'Le sujet est public, le texte reste scellé jusqu\'à l\'échéance. Un call libre prouve qu\'il a été écrit avant : son résultat n\'est pas vérifié par le site et il ne compte pas au classement.',
  };

  // Calls de la catégorie, chez tous les callers : encore scellés d'un côté, clos (résultat connu) de l'autre.
  const ranked = D.period('30').filter(c => c.ranked).sort((a, b) => b.rate - a.rate || b.calls - a.calls);
  const rank = new Map(ranked.map((c, i) => [c.name, i + 1]));
  // Réussite sur 30 jours, seulement pour un caller classé (sinon pas de chiffre).
  const rateOf = new Map(ranked.map(c => [c.name, c.rate]));
  const live = [], opened = [];
  for (const c of D.base) {
    const p = D.profile(c);
    for (const x of p.calls) if (x.cat === cat) { if (x.res === 'live' && !x.opened) live.push({ c, x }); else if (x.res !== 'live') opened.push({ c, x }); }
  }
  live.sort((a, b) => (rank.get(a.c.name) || 99) - (rank.get(b.c.name) || 99));
  opened.sort((a, b) => a.x.ago - b.x.ago);

  const teaser = x => {
    const b = el('div', 'h2-teaser ' + x.cat);
    if (x.cat === 'crypto') {
      const pair = el('span', 'h2-pair'); pair.append(el('b', '', x.pair.replace('USDT', '')), el('small', '', '/USDT'));
      b.appendChild(pair); if (x.hz) b.appendChild(el('span', 'h2-hz', t('horizon') + ' ' + x.hz)); b.appendChild(el('span', 'h2-secret', t('Sens et niveaux secrets')));
    } else b.append(el('span', 'h2-lg', t(x.cat === 'free' ? 'Libre' : D.subName(x.sub))), el('b', 'h2-subj', D.matchup(x)), el('span', 'h2-secret', t(x.cat === 'sport' ? 'Pronostic secret' : x.cat === 'free' ? 'Texte secret' : 'Choix secret')));
    // Finance / Politique : l'autorité qui fait foi est dite sur la carte, avant l'achat (comme les règles d'un marché de prédiction).
    if (x.cat === 'pol') { const v = ((window.sdMod && window.sdMod.SOURCES) || {})[x.sub]; if (v) b.appendChild(el('span', 'h2-src', v.includes('.') ? t('Source officielle') + ' : ' + v : t(v))); }
    return b;
  };
  const ring = p => { const r = el('span', 'h2-ring'); r.style.setProperty('--p', Math.round(p || 0)); r.appendChild(el('b', 'num', p === undefined ? '—' : Math.round(p) + '%')); return r; };

  function head() {
    document.title = t(D.CATS[cat]) + ' — Signal Desk';
    $('mk-title').textContent = t(D.CATS[cat]);
    const img = cat;
    $('mk-hero').style.setProperty('--img', `url(img/${img}.webp)`); $('mk-hero').style.setProperty('--img-m', `url(img/${img}-m.webp)`);
    $('mk-lead').textContent = t(LEAD[cat]);
    $('mk-n').textContent = num(live.length);
    const chips = $('mk-subs'); chips.replaceChildren();
    for (const s of ['all', ...D.SUBS[cat]]) {
      const b = el('button', '', s === 'all' ? t('Tous') : t(D.subName(s))); b.type = 'button'; b.dataset.s = s; b.setAttribute('aria-pressed', String(s === sub));
      chips.appendChild(b);
    }
    document.querySelectorAll('a.h2-more[href^="classement.html"]').forEach(a => { a.href = 'classement.html?c=' + cat; });
    // 10/11 : Crypto et Sport sont des sous-onglets de Communauté, c'est cet onglet qui reste actif dans la barre.
    document.querySelectorAll('.cmd-cats > a').forEach(a => { const on = a.getAttribute('href') === 'communaute.html'; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  // Carte d'un call scellé ; `card` donné = la carte « À la une » déjà présente dans la page.
  function fill(card, { c, x }, feat) {
    const h = el('a', 'h2-mk-h'); h.href = link(c.name); h.append(av(c.name), el('span', 'h2-mk-n', c.display)); if (rank.get(c.name)) h.appendChild(el('span', 'h2-rank', '#' + rank.get(c.name))); // V16 : pas de « #– » pour un caller non classé
    if (feat) h.appendChild(el('span', 'h2-eyebrow mk-feat-k', t('À la une')));
    const body = el('div', 'h2-mk-b'); body.appendChild(ring(rateOf.get(c.name)));
    const info = el('div'); info.appendChild(el('span', 'lbl', t('Call scellé') + ' #' + num(x.n)));
    // Compte à rebours tant que le call est en vente ; ensuite, « ouverture… » à la place d'un faux 00:00:00.
    if (x.phase === 'on-sale') { info.appendChild(el('b', 'num h2-clock', clock(left(x.left)))); info.lastChild.dataset.left = x.left; } else info.appendChild(el('b', '', t('ouverture…')));
    body.appendChild(info);
    const foot = el('div', 'h2-mk-f');
    // Achat possible seulement tant que le call est en vente ; ensuite, l'ouverture est en cours.
    let buy;
    if (x.phase !== 'on-sale') buy = el('span');
    else if (x.demo) buy = el('span', 'h2-demo', t('Démonstration')); // desk de démonstration : rien à acheter
    else if (x.price > 0) { buy = el('button', 'h2-mk-buy', num(x.price) + ' TARI'); buy.type = 'button'; buy.addEventListener('click', () => window.sdBuy && window.sdBuy(c.name, x.price, c.desk, x.seq)); }
    else buy = el('span');
    foot.append(el('span', '', num(x.buyers || 0) + ' ' + window.sdPl(x.buyers || 0, 'acheteur', 'acheteurs')), buy);
    card.append(h, teaser(x), body, foot); return card;
  }
  const SORT = { soon: (a, b) => left(a.x.left) - left(b.x.left), rate: (a, b) => (rateOf.get(b.c.name) ?? -1) - (rateOf.get(a.c.name) ?? -1), buyers: (a, b) => (b.x.buyers || 0) - (a.x.buyers || 0), price: (a, b) => a.x.price - b.x.price };
  let order = 'soon';
  // À la une = le call le plus acheté du filtre ; la grille montre les autres, dans l'ordre choisi.
  function grid() {
    const box = $('mk-grid'), feat = $('mk-feat'); box.replaceChildren(); feat.replaceChildren();
    const list = live.filter(({ x }) => sub === 'all' || x.sub === sub);
    const top1 = list.reduce((m, i) => (!m || (i.x.buyers || 0) > (m.x.buyers || 0) ? i : m), null);
    if (top1) fill(feat, top1, true);
    feat.hidden = !top1; feat.style.display = top1 ? '' : 'none'; // le CSS (display:flex) passe outre `hidden`
    for (const i of list.filter(i => i !== top1).sort(SORT[order])) box.appendChild(fill(el('article', 'h2-mk'), i));
    $('mk-none').hidden = list.length > 0;
    empty($('mk-none'), 'Aucun call scellé dans cette catégorie pour le moment.');
    hot(list);
  }
  // Sujets les plus annoncés du filtre : paires (crypto), matchs (sport), sujets (politique).
  function hot(list) {
    const m = new Map();
    for (const { x } of list) { const k = cat === 'crypto' ? 'crypto|' + x.pair.replace('USDT', '') : x.sub + '|' + D.matchup(x); m.set(k, (m.get(k) || 0) + 1); }
    const ol = $('mk-hot'); ol.replaceChildren();
    [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, n], i) => {
      const [s, what] = k.split('|'); const li = el('li');
      li.append(el('span', 'h2-lg', s === 'crypto' ? '#' + (i + 1) : t(D.subName(s))), el('b', '', s === 'crypto' ? what + '/USDT' : what), el('span', 'num', num(n) + ' ' + (n > 1 ? t('calls') : 'call'))); ol.appendChild(li);
    });
    $('mk-hot-h').textContent = t(cat === 'sport' ? 'Matchs les plus annoncés' : cat === 'crypto' ? 'Paires les plus annoncées' : 'Sujets les plus annoncés');
    $('mk-hot-box').hidden = !ol.children.length;
  }

  function results() {
    const ol = $('mk-feed'); ol.replaceChildren();
    for (const { c, x } of opened.filter(({ x }) => sub === 'all' || x.sub === sub).slice(0, 8)) {
      const li = el('li'); const a = el('a', 'h2-ev ' + x.res); a.href = link(c.name, x.n);
      // Direction affichée seulement pour un call ouvert (jamais ouvert : elle reste inconnue).
      const d = el('div'); d.append(el('b', '', c.display), el('span', '', ' · ' + (x.dir ? D.callText(x) : D.what(x))), el('time', '', ago(x.ago)));
      a.append(av(c.name), d, el('span', 'num h2-ev-v', D.result(x))); li.appendChild(a); ol.appendChild(li);
    }
    $('mk-feed-none').hidden = ol.children.length > 0; ol.style.display = ol.children.length ? '' : 'none'; // pas de réserve de hauteur vide
    empty($('mk-feed-none'), 'Aucun résultat.');
  }

  // Meilleurs callers de la catégorie : réussite sur leurs calls clos de cette catégorie (et du filtre).
  function top() {
    const ol = $('mk-top'); ol.replaceChildren();
    const rows = [];
    for (const c of D.base) {
      const done = D.profile(c).calls.filter(x => x.cat === cat && x.res !== 'live' && (sub === 'all' || x.sub === sub));
      if (done.length >= 3) rows.push({ c, n: done.length, rate: done.filter(x => x.res === 'win').length / done.length * 100 });
    }
    rows.sort((a, b) => b.rate - a.rate || b.n - a.n).slice(0, 8).forEach(({ c, n, rate }, i) => {
      const li = el('li'); const a = el('a'); a.href = link(c.name);
      const bar = el('i', 'h2-bar'); bar.style.setProperty('--w', rate + '%');
      a.append(el('span', 'num h2-pos', '#' + (i + 1)), av(c.name), el('b', '', c.display), bar, el('span', 'num', pct(rate)), el('small', '', num(n) + ' ' + window.sdPl(n, 'call', 'calls')));
      li.appendChild(a); ol.appendChild(li);
    });
    $('mk-top-none').hidden = ol.children.length > 0; ol.style.display = ol.children.length ? '' : 'none';
  }

  $('mk-subs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; sub = b.dataset.s;
    $('mk-subs').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const u = new URL(location.href); if (sub === 'all') u.searchParams.delete('s'); else u.searchParams.set('s', sub); history.replaceState(null, '', u);
    grid(); results(); top();
  });
  $('mk-sort').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; order = b.dataset.o;
    $('mk-sort').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    grid();
  });
  setInterval(() => { if (!document.hidden) document.querySelectorAll('.h2-clock[data-left]').forEach(e => { e.textContent = clock(left(+e.dataset.left)); }); }, 1000);

  function render() { head(); grid(); results(); top(); }
  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); if (dock) dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
});
