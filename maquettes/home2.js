// Accueil v2 : vitrine des sujets de chaque onglet (calls, pronostics, classement, en direct, ligues).
// Desks, calls et pronostics réels lus sur la blockchain (data.js, chain.js) ; sans donnée, un état vide
// invite à sceller le premier call. Un call scellé ne montre jamais son sens avant l'ouverture : c'est le principe du scellement.
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const D = window.SD_DATA;
  if (!D || !$('h2-hero')) return;
  const t = k => (window.sdT ? window.sdT(k) : k);
  // Recette V3 (09/11) : plus aucun exemple. Section « preuve » = le desk qui a le plus de calls terminés ;
  // carte de partage = le dernier vrai call ouvert (lu par le script de la carte via window.sdShareCall).
  (() => {
    const profs = D.base.map(c => D.profile(c)), best = profs.filter(p => p.closed > 0).sort((a, b) => b.closed - a.closed)[0];
    const card = $('pv-name') && $('pv-name').closest('.rv');
    if (card) card.style.display = best ? '' : 'none';
    if (best) {
      $('pv-name').textContent = best.display; $('pv-av').replaceChildren(D.avatar(best.name));
      const pct = v => new Intl.NumberFormat(document.documentElement.lang || 'fr', { maximumFractionDigits: 1 }).format(v) + ' %';
      $('pv-n').textContent = String(best.closed); $('pv-rate').textContent = pct(best.rate); $('pv-never').textContent = best.never + ' / ' + best.closed;
      $('pv-nb').style.width = '100%'; $('pv-rb').style.width = best.rate + '%'; $('pv-vb').style.width = (best.never / best.closed * 100) + '%';
    }
    const last = profs.flatMap(p => p.calls.filter(x => x.opened && !x.unknown && x.res !== 'live').map(x => ({ x, p })))
      .sort((a, b) => a.x.ago - b.x.ago)[0];
    window.sdShareCall = last ? { n: last.x.n, pair: last.x.pair, dir: last.x.dir, entry: last.x.entry, tp: last.x.tp, sl: last.x.sl, res: last.x.res,
      sealedAt: last.x.sealedAt, desk: last.p.display, slug: last.p.name, addr: last.p.desk } : null;
    if (window.sdRedrawCard) window.sdRedrawCard();
  })();
  const loc = () => document.documentElement.lang || 'fr-FR';
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 100);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const av = name => { const s = el('span', 'av'); s.appendChild(D.avatar(name)); return s; };
  const link = (n, call) => 'profil.html?c=' + encodeURIComponent(n) + (call ? '&call=' + call : '');
  const ago = d => { const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' }); return d < 1 ? rtf.format(-Math.max(1, Math.round(d * 24)), 'hour') : rtf.format(-Math.round(d), 'day'); };
  const clock = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), p = n => String(n).padStart(2, '0'); return (d ? d + t('j') + ' ' : '') + `${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`; };
  const t0 = Date.now(), left = s => s - (Date.now() - t0) / 1000;
  // État vide : un message et l'invitation à sceller le premier call.
  const empty = (tag, msg) => { const e = el(tag, 'rk-empty'); const a = el('a', 'lnk', t('Soyez le premier caller')); a.href = '#commencer'; a.style.display = 'inline-block'; e.append(el('p', '', t(msg)), a); return e; };

  // ---- Données (réelles) ----
  const p30 = new Map(D.period('30').map(c => [c.name, c]));
  const ranked = [...p30.values()].filter(c => c.ranked).sort((a, b) => b.rate - a.rate || b.calls - a.calls);
  const rank = new Map(ranked.map((c, i) => [c.name, i + 1]));
  const profiles = new Map(D.base.map(c => [c.name, D.profile(c)]));
  // Calls encore scellés (pas encore ouverts) : en vente d'abord, puis ceux dont l'ouverture est en cours.
  const live = [];
  for (const c of D.base) for (const x of profiles.get(c.name).calls) if (x.res === 'live' && !x.opened) live.push({ c, x });
  live.sort((a, b) => (a.x.phase === 'on-sale' ? 0 : 1) - (b.x.phase === 'on-sale' ? 0 : 1) || (rank.get(a.c.name) || 99) - (rank.get(b.c.name) || 99) || a.x.left - b.x.left);
  const opened = [];
  for (const c of D.base) profiles.get(c.name).calls.filter(x => x.res !== 'live').slice(0, 4).forEach(x => opened.push({ c, x }));
  opened.sort((a, b) => a.x.ago - b.x.ago);
  // Libellé d'un call clos : sujet + pronostic, ou le sujet seul s'il n'a jamais été ouvert.
  const callText = x => (x.dir ? D.callText(x) : D.what(x));
  const rateOf = name => { const s = p30.get(name); return s && s.closed ? s.rate : null; };
  const curve = name => { let s = 0; return profiles.get(name).calls.filter(x => x.res !== 'live').slice(0, 24).reverse().map(x => (s += x.move)); };
  const spark = (pts, w = 120, h = 34) => {
    if (pts.length < 2) return el('span', 'h2-spark');
    const min = Math.min(0, ...pts), max = Math.max(1, ...pts), n = Math.max(1, pts.length - 1);
    const d = pts.map((v, i) => (i ? 'L' : 'M') + (i / n * w).toFixed(1) + ' ' + (h - 3 - (v - min) / (max - min) * (h - 6)).toFixed(1)).join(' ');
    const up = pts[pts.length - 1] >= 0;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('class', 'h2-spark ' + (up ? 'up' : 'dn')); s.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); s.appendChild(path); return s;
  };
  // Public avant l'ouverture : la paire et l'horizon. Secret jusqu'à l'ouverture : le sens et les niveaux.
  const teaser = x => {
    const b = el('div', 'h2-teaser ' + x.cat);
    const pair = el('span', 'h2-pair'); pair.append(el('b', '', x.pair.replace('USDT', '')), el('small', '', '/USDT'));
    b.appendChild(pair); if (x.hz) b.appendChild(el('span', 'h2-hz', t('horizon') + ' ' + x.hz));
    b.appendChild(el('span', 'h2-secret', t('Sens et niveaux secrets')));
    return b;
  };
  const ring = (p, label) => { const r = el('span', 'h2-ring'); r.style.setProperty('--p', Math.round(p)); r.appendChild(el('b', 'num', label)); return r; };
  // Rang sur 30 jours, ou le chemin qui reste avant d'être classé.
  const rankLabel = name => (rank.has(name) ? '#' + rank.get(name) + ' · ' + t('30 jours') : t('{n} sur 3 calls clos').replace('{n}', num((p30.get(name) || {}).closed || 0)));
  // Compte à rebours jusqu'à l'ouverture ; à zéro, l'ouverture est en cours.
  const timer = x => { const b = el('b', 'num h2-clock'); if (x.phase === 'on-sale' && x.left > 0) { b.dataset.left = x.left; b.textContent = clock(left(x.left)); } else b.textContent = t('ouverture…'); return b; };
  // Achat d'un call encore en vente (prix et numéro lus sur la chaîne).
  const buyBtn = (c, x, cls, label) => {
    if (x.phase !== 'on-sale' || !(x.price > 0)) return null;
    const b = el('button', cls, label); b.type = 'button';
    b.addEventListener('click', () => window.sdBuy && window.sdBuy(c.name, x.price, c.desk, x.seq)); return b;
  };

  // ---- Bandeau du haut : chiffres réels de tous les desks ----
  function heroStats() {
    const all = D.period('all'), closed = all.reduce((s, c) => s + c.closed, 0);
    const wins = all.reduce((s, c) => s + Math.round(c.rate * c.closed / 100), 0);
    $('hs-calls').textContent = num(all.reduce((s, c) => s + c.calls, 0));
    $('hs-rate').textContent = closed ? pct(wins / closed * 100) : '—';
    $('hs-never').textContent = num(all.reduce((s, c) => s + c.never, 0));
  }

  // ---- Hero : chiffres en direct + pile de calls à la une ----
  function hero() {
    $('h2-live').textContent = num(live.length);
    $('h2-callers').textContent = num(D.base.length);
    $('h2-calls').textContent = num(D.base.reduce((s, c) => s + profiles.get(c.name).total, 0));
    const stack = $('h2-stack'); stack.replaceChildren();
    stack.style.height = live.length ? '' : 'auto';
    if (!live.length) stack.appendChild(empty('div', 'Aucun call scellé pour l’instant.'));
    live.slice(0, 3).reverse().forEach(({ c, x }, i, arr) => {
      const depth = arr.length - 1 - i, card = el('article', 'h2-feat');
      card.style.setProperty('--d', depth);
      const top = el('div', 'h2-feat-top'); const who = el('a', 'h2-who'); who.href = link(c.name); who.append(av(c.name), el('span', '', c.display));
      top.append(who, el('span', 'h2-rank', rankLabel(c.name)));
      const mid = el('div', 'h2-feat-mid');
      const lock = el('div', 'h2-lock'); lock.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
      const txt = el('div'); txt.append(el('span', 'lbl', t('Call scellé') + ' #' + num(x.n)), timer(x)); mid.append(lock, txt);
      const stats = el('dl', 'h2-feat-stats'), r = rateOf(c.name);
      for (const [k, v] of [[t('Réussite'), r === null ? '—' : pct(r)], [t('Acheteurs'), num(x.buyers || 0)], [t('Prix'), x.price > 0 ? num(x.price) + ' TARI' : '—']]) { const d = el('div'); d.append(el('dt', '', k), el('dd', 'num', v)); stats.appendChild(d); }
      card.append(top, teaser(x), mid, stats);
      const buy = buyBtn(c, x, 'btn-main sm h2-buy', '');
      if (buy) { buy.appendChild(el('span', 't', t('Acheter le call'))); card.appendChild(buy); }
      stack.appendChild(card);
    });
    // Profondeur à la souris (désactivée si les animations sont réduites).
    const box = $('h2-stage');
    if (!box.dataset.tilt && !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(pointer: fine)').matches) {
      box.dataset.tilt = '1'; // audit K15 : render() est rappelé à chaque changement de langue
      box.addEventListener('pointermove', e => { const r = box.getBoundingClientRect(); box.style.setProperty('--rx', ((e.clientY - r.top) / r.height - .5) * -8 + 'deg'); box.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 10 + 'deg'); });
      box.addEventListener('pointerleave', () => { box.style.setProperty('--rx', '0deg'); box.style.setProperty('--ry', '0deg'); });
    }
  }

  // ---- Bandeau en direct (masqué tant qu'aucun call n'est clos) ----
  function tape() {
    const items = opened.slice(0, 18).map(({ c, x }) => {
      const s = el('a', 'h2-tick'); s.href = link(c.name, x.n);
      s.append(el('b', '', c.display), el('span', '', callText(x)), el('em', x.res === 'win' ? 'up' : 'dn', D.result(x)));
      return s;
    });
    const tr = $('h2-tape'); tr.closest('.h2-band').hidden = !items.length;
    tr.replaceChildren(...items, ...items.map(n => { const c = n.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1; return c; }));
  }

  // ---- Calls à la une (crypto seulement dans cette version) ----
  function calls() {
    const grid = $('h2-calls-grid'); grid.replaceChildren();
    const list = live.slice(0, 8);
    for (const { c, x } of list) {
      const card = el('article', 'h2-mk'), r = rateOf(c.name);
      const head = el('a', 'h2-mk-h'); head.href = link(c.name); head.append(av(c.name), el('span', 'h2-mk-n', c.display)); if (rank.has(c.name)) head.appendChild(el('span', 'h2-rank', '#' + rank.get(c.name))); // V16
      const body = el('div', 'h2-mk-b');
      body.append(ring(r || 0, r === null ? '—' : Math.round(r) + '%'));
      const info = el('div'); info.append(el('span', 'lbl', t('Call scellé') + ' #' + num(x.n)), timer(x)); body.appendChild(info);
      const foot = el('div', 'h2-mk-f');
      foot.append(el('span', '', num(x.buyers || 0) + ' ' + window.sdPl(x.buyers || 0, 'acheteur', 'acheteurs')), buyBtn(c, x, 'h2-mk-buy', num(x.price) + ' TARI') || el('span', 'lv-kind', t('ouverture…')));
      card.append(head, teaser(x), body, spark(curve(c.name), 240, 40), foot);
      grid.appendChild(card);
    }
    if (!list.length) { const e = empty('div', 'Aucun call scellé pour l’instant.'); e.style.gridColumn = '1 / -1'; grid.appendChild(e); }
  }

  // ---- Pronostics ouverts : questions réelles du tableau de pronostics (chain.js) ----
  let board = [];
  const TYPES = { number: 'Nombre', price: 'Prix', yesno: 'Oui ou non', choice: 'Choix multiple', range: 'Fourchette', updown: 'Hausse ou baisse' };
  const optsOf = m => (m.type === 'yesno' ? ['Oui', 'Non'] : m.type === 'updown' ? ['▲ Hausse', '▼ Baisse']
    : m.type === 'choice' && Array.isArray(m.opts) ? m.opts.filter(x => typeof x === 'string').slice(0, 8) : ['Répondre']);
  async function loadBoard() {
    const C = window.sdChain, net = 'esmeralda';
    if (!C || !C.forecastsLive || !C.forecastsLive(net)) return;
    const [b, ep] = await Promise.all([C.readBoard(net), C.currentEpoch(net)]);
    // Heure de clôture : l'époque de la chaîne fait foi (≈ 1 h par époque), la date `close_utc` si elle concorde.
    const closeMs = q => { const est = Date.now() + (q.close - ep) * 3600e3, u = Date.parse(q.meta.close_utc); return Number.isFinite(u) && Math.abs(u - est) <= 2 * 3600e3 ? u : est; };
    board = (b ? b.questions : []).filter(q => ep < q.close).map(q => ({ q: q.meta.q, type: q.meta.type, opts: optsOf(q.meta), n: q.forecasts.length, close: closeMs(q) }));
    forecasts();
  }
  // 10/11 : filtre par sujet au-dessus de la grille (Tous, Crypto, Sport, Finance / Politique), avec le nombre de questions.
  let fcCat = 'all';
  const catOf = f => ((window.sdSubject && window.sdSubject(f.q, f.opts)) || {}).cat || '';
  function fcCats(grid) {
    let bar = $('h2-fc-cats');
    if (!bar) { bar = el('div', 'pr-sub'); bar.id = 'h2-fc-cats'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', t('Sujet')); grid.before(bar);
      bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { fcCat = b.dataset.c; forecasts(); } }); }
    const list = [['all', 'Tous'], ['crypto', 'Crypto'], ['sport', 'Sport'], ['pol', 'Finance / Politique']].map(([k, l]) => [k, l, k === 'all' ? board.length : board.filter(f => catOf(f) === k).length]).filter(([k, , n]) => k === 'all' || n);
    if (!list.some(x => x[0] === fcCat)) fcCat = 'all';
    bar.hidden = list.length < 3;
    bar.replaceChildren(...list.map(([k, l, n]) => { const b = el('button', '', t(l)); b.type = 'button'; b.dataset.c = k; b.setAttribute('aria-pressed', String(k === fcCat)); b.appendChild(el('span', 'n num', num(n))); return b; }));
  }
  function forecasts() {
    const hero = $('h2-fc-hero'); hero.replaceChildren();
    [...board].sort((a, b) => b.n - a.n).slice(0, 2).forEach(f => hero.appendChild(fcCard(f, true)));
    const grid = $('h2-fc-grid'); grid.replaceChildren(); fcCats(grid);
    for (const f of board) if (fcCat === 'all' || catOf(f) === fcCat) grid.appendChild(fcCard(f, false));
    if (!board.length) {
      const msg = () => { const e = el('div', 'rk-empty'); const a = el('a', 'lnk', t('Créer une ligue')); a.href = 'ligues.html'; e.append(el('p', '', t('Aucun pronostic ouvert pour le moment.')), a); return e; };
      hero.appendChild(msg()); const e = msg(); e.style.gridColumn = '1 / -1'; grid.appendChild(e);
    }
  }
  function fcCard(f, compact) {
    const card = el('article', 'h2-fc'); card.dataset.go = 'pronostics.html';
    // Le texte de la question est celui de l'organisateur : jamais traduit.
    const top = el('div', 'h2-fc-top'), sj = window.sdSubjectEl && window.sdSubjectEl(f.q, f.opts); if (sj) top.appendChild(sj);
    top.appendChild(el('span', 'h2-tag', t(TYPES[f.type] || 'Nombre'))); const Q = window.sdQ(f.q); card.append(top, el('h3', '', Q.title)); if (Q.rule) card.appendChild(el('p', 'h2-fc-r', Q.rule));
    const opts = el('div', 'h2-fc-o' + (f.opts.length > 2 ? ' many' : ''));
    f.opts.forEach((o, i) => { const b = el('a', 'h2-opt ' + (f.opts.length === 2 ? (i ? 'no' : 'yes') : ''), f.type === 'choice' ? window.sdOpt(o) : t(o)); b.href = 'pronostics.html'; opts.appendChild(b); });
    // Recette V7 : moins d'un jour = en heures (« ferme dans 1 j » pour 5 h était faux).
    const left = f.close - Date.now(), hrs = Math.max(1, Math.round(left / 36e5)), days = Math.ceil(left / 864e5);
    const foot = el('div', 'h2-fc-f'); foot.append(el('span', '', f.n ? num(f.n) + ' ' + window.sdPl(f.n, 'pronostic scellé', 'pronostics scellés') : t('Soyez le premier à sceller')),
      el('span', '', left < 864e5 ? t('ferme dans {x} h').replace('{x}', num(hrs)) : t('ferme dans {x} j').replace('{x}', num(days))));
    card.append(opts, foot); if (compact) card.classList.add('sm'); return card;
  }

  // ---- Classement : podium + 4 à 10 (classé dès 3 calls clos) ----
  function leaderboard() {
    const NONE = 'Aucun caller classé pour l’instant : il faut 3 calls clos.';
    const mini = $('h2-rk-hero'); mini.replaceChildren();
    ranked.slice(0, 5).forEach((c, i) => { const li = el('li'); const a = el('a'); a.href = link(c.name); a.append(el('span', 'num h2-pos', '#' + (i + 1)), av(c.name), el('b', '', c.display), spark(curve(c.name), 70, 22), el('span', 'num', pct(c.rate))); li.appendChild(a); mini.appendChild(li); });
    if (!ranked.length) mini.appendChild(empty('li', NONE));
    const pod = $('h2-podium'); pod.replaceChildren();
    ranked.slice(0, 3).forEach((c, i) => {
      const card = el('a', 'h2-pod p' + (i + 1)); card.href = link(c.name);
      card.append(el('span', 'h2-pod-r', '#' + (i + 1)), av(c.name), el('b', '', c.display), el('span', 'num h2-pod-v', pct(c.rate)), el('small', '', num(c.calls) + ' ' + t('calls · 30 j')), spark(curve(c.name), 160, 36));
      pod.appendChild(card);
    });
    if (!ranked.length) { const e = empty('div', NONE); e.style.gridColumn = '1 / -1'; pod.appendChild(e); }
    const ol = $('h2-top'); ol.replaceChildren();
    ranked.slice(3, 10).forEach((c, i) => {
      const li = el('li'); const a = el('a'); a.href = link(c.name);
      const bar = el('i', 'h2-bar'); bar.style.setProperty('--w', c.rate + '%');
      a.append(el('span', 'num h2-pos', '#' + (i + 4)), av(c.name), el('b', '', c.display), bar, el('span', 'num', pct(c.rate)), spark(curve(c.name), 90, 26));
      li.appendChild(a); ol.appendChild(li);
    });
  }

  // ---- En direct : résultats récents + tendances par paire (calls ouverts seulement) ----
  function feed() {
    const ol = $('h2-feed'); ol.replaceChildren();
    for (const { c, x } of opened.slice(0, 7)) {
      const li = el('li'); const a = el('a', 'h2-ev ' + x.res); a.href = link(c.name, x.n);
      a.append(av(c.name), (() => { const d = el('div'); d.append(el('b', '', c.display), el('span', '', ' · ' + callText(x)), el('time', '', ago(x.ago))); return d; })(),
        el('span', 'num h2-ev-v', D.result(x)));
      li.appendChild(a); ol.appendChild(li);
    }
    if (!opened.length) ol.appendChild(empty('li', 'Aucun call ouvert pour l\'instant.'));
    const counts = {};
    for (const c of D.base) for (const x of profiles.get(c.name).calls.slice(0, 20)) { if (x.cat !== 'crypto' || !x.dir) continue; const k = x.pair.replace('USDT', ''); counts[k] = counts[k] || { L: 0, S: 0 }; counts[k][x.dir === 'LONG' ? 'L' : 'S']++; }
    const box = $('h2-trend'); box.replaceChildren(); const boxH = $('h2-trend-hero'); boxH.replaceChildren();
    const rows = Object.entries(counts).sort((a, b) => (b[1].L + b[1].S) - (a[1].L + a[1].S)).slice(0, 5);
    rows.forEach(([k, v]) => {
      const tot = v.L + v.S, l = Math.round(v.L / tot * 100);
      const row = el('a', 'h2-tr'); row.href = 'en-direct.html?pair=' + k;
      const bar = el('span', 'h2-tr-bar'); bar.style.setProperty('--l', l + '%');
      row.append(el('b', '', k), bar, el('span', 'num', l + '% ' + t('long')), el('small', '', num(tot) + ' ' + window.sdPl(tot, 'call', 'calls')));
      box.appendChild(row); if (boxH.children.length < 3) boxH.appendChild(row.cloneNode(true));
    });
    // Sans call ouvert, pas de tendance : la case du haut se tait, l'encadré le dit.
    boxH.hidden = !rows.length; boxH.previousElementSibling.style.display = rows.length ? '' : 'none';
    if (!rows.length) box.appendChild(el('p', 'rk-empty', t('Les tendances apparaîtront avec les premiers calls ouverts.')));
  }

  // Comptes à rebours vivants.
  setInterval(() => { if (!document.hidden) document.querySelectorAll('.h2-clock[data-left]').forEach(e => { e.textContent = clock(left(+e.dataset.left)); }); }, 1000);

  // ---- Arène crypto : nombre de calls scellés en ce moment ----
  function arenas() {
    // Une seule arène dans cette version : la carte prend toute la largeur.
    const g = document.querySelector('.h2-ar-grid'); if (g && g.children.length === 1) g.style.gridTemplateColumns = '1fr';
    document.querySelectorAll('[data-ar]').forEach(e => { const n = live.filter(({ x }) => x.cat === e.dataset.ar).length; e.textContent = num(n) + ' ' + t('calls scellés en ce moment'); }); }

  function render() { heroStats(); hero(); tape(); arenas(); calls(); forecasts(); leaderboard(); feed(); }
  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); if (dock) dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
  loadBoard().catch(e => console.warn('[signal-desk] pronostics', e && e.message));
});
