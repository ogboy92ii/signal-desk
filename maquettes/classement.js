// Page Classement : callers (podium, records, tableau triable, en observation), pronostiqueurs, méthode.
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
// Classé à partir de 3 calls clos ; sans caller classé, la page affiche un état vide (jamais de chiffre inventé).
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loc = () => document.documentElement.lang || 'fr-FR';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const { period, avatar, follow } = window.SD_DATA, D = window.SD_DATA;
  const RANK_MIN = 3; // même seuil que data.js
  const CAT = { crypto: 'Crypto' };
  const chip = c => el('span', 'rk-cat ' + (c.style || 'crypto'), t(CAT[c.style || 'crypto']));
  // Courbe des calls clos du caller (variation cumulée) : un trait qui monte ou descend.
  const curve = (c, w = 160, h = 40) => {
    let s = 0; const pts = D.profile(c).calls.filter(x => x.res !== 'live').slice(0, 30).reverse().map(x => (s += x.move));
    if (!pts.length) pts.push(0);
    const min = Math.min(0, ...pts), max = Math.max(1, ...pts), n = Math.max(1, pts.length - 1);
    const d = pts.map((v, i) => (i ? 'L' : 'M') + (i / n * w).toFixed(1) + ' ' + (h - 3 - (v - min) / (max - min) * (h - 6)).toFixed(1)).join(' ');
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('class', 'rk-curve ' + (pts[pts.length - 1] >= 0 ? 'up' : 'dn')); svg.setAttribute('aria-hidden', 'true');
    const area = document.createElementNS(NS, 'path'); area.setAttribute('d', d + ` L${w} ${h} L0 ${h} Z`); area.setAttribute('class', 'a');
    const line = document.createElementNS(NS, 'path'); line.setAttribute('d', d); svg.append(area, line); return svg;
  };

  // Petits utilitaires de rendu (textes posés avec textContent : aucun HTML injecté).
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 100);
  const days = v => window.sdDays(v); // V11 : « aujourd'hui » au lieu de « 0 j »
  const tari = v => num(v) + ' TARI';
  const never = n => n ? '· ' + (n === 1 ? t('1 jamais ouvert') : t('{n} jamais ouverts').replace('{n}', num(n))) : '';
  const spark = last => { const s = el('div', 'pod-spark'); s.setAttribute('role', 'img'); const w = [...last].filter(x => x === '1').length; s.setAttribute('aria-label', `${w} / 10`); for (const x of last) s.appendChild(el('i', x === '1' ? '' : 'l')); return s; };

  // Suivre : préférence locale partagée (data.js), synchronisée entre podium, tableau et fiche.
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  // L'adresse du desk accompagne le nom : sans elle, l'abonnement n'est pas inscrit sur la chaîne.
  function followBtn(c) {
    const b = el('button', 'follow'); b.type = 'button'; b.dataset.name = c.name; b.dataset.desk = c.desk || ''; b.setAttribute('aria-pressed', String(follow.has(c.name)));
    b.innerHTML = BELL; b.append(el('span', 'off', t('Suivre')), el('span', 'on', t('Suivi'))); b.setAttribute('aria-label', `${t('Suivre')} ${c.display}`);
    return b;
  }
  document.addEventListener('click', e => { const b = e.target.closest('.follow[data-name]'); if (b) follow.toggle(b.dataset.name, b.dataset.desk); });
  addEventListener('sd:follow', () => document.querySelectorAll('.follow[data-name]').forEach(x => x.setAttribute('aria-pressed', String(follow.has(x.dataset.name)))));

  // État de la page.
  const qc = new URLSearchParams(location.search).get('c');
  const state = { p: '30', c: qc === 'crypto' ? qc : 'all', sort: 'rate', dir: -1, q: '', open: null };
  let rows = [];

  function render() {
    const all = period(state.p).filter(c => state.c === 'all' || c.style === state.c);
    const ranked = all.filter(c => c.ranked).sort((a, b) => b.rate - a.rate || b.calls - a.calls);
    ranked.forEach((c, i) => { c.rank = i + 1; });
    rows = ranked;
    // Chiffres clés (calls vérifiés = calls clos des callers classés).
    const rates = ranked.map(c => c.rate).sort((a, b) => a - b), mid = rates.length >> 1;
    $('k-callers').textContent = num(ranked.length);
    $('k-calls').textContent = num(ranked.reduce((s, c) => s + c.closed, 0));
    $('k-median').textContent = rates.length ? pct(rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2) : '—';
    $('k-never').textContent = num(ranked.reduce((s, c) => s + c.never, 0));
    // Sans caller classé : ni records ni tableau vide, le podium porte le message.
    // style.display : certaines classes (.list-head…) imposent leur display par-dessus l'attribut hidden.
    for (const e of [$('rk-records'), $('rk-q').closest('.list-head'), $('rk-table').closest('.rk-scroll')]) e.style.display = ranked.length ? '' : 'none';
    renderPodium(ranked.slice(0, 3)); renderRecords(ranked); renderTable(); renderWatch(all.filter(c => !c.ranked));
  }

  // Podium « scène » : le premier au centre et plus haut, anneau de réussite autour de l'avatar.
  function renderPodium(top) {
    const box = $('rk-podium'); box.replaceChildren();
    if (!top.length) {
      const e = el('div', 'rk-empty'); e.setAttribute('role', 'listitem'); e.style.gridColumn = '1 / -1';
      const go = el('a', 'lnk', t('Créer mon desk')); go.href = 'site-signal-desk.html#commencer';
      e.append(el('p', '', t('Aucun caller classé pour l’instant : il faut 3 calls clos.')), go); box.appendChild(e); return;
    }
    top.forEach((c, i) => {
      const art = el('article', `rkp p${i + 1}`); art.setAttribute('role', 'listitem');
      art.appendChild(el('span', 'rkp-n', String(i + 1))).setAttribute('aria-hidden', 'true');
      const ring = el('span', 'rkp-ring'); ring.style.setProperty('--p', Math.round(c.rate)); const av = el('span', 'rkp-av'); av.appendChild(avatar(c.name)); ring.appendChild(av);
      const h = el('h3', 'rkp-name'); const a = el('a', '', c.display); a.href = 'profil.html?c=' + encodeURIComponent(c.name); h.appendChild(a);
      const tags = el('div', 'rkp-tags'); tags.append(chip(c), el('span', 'rkp-age', days(c.age))); if (c.never) tags.appendChild(el('span', 'rkp-never', never(c.never).replace('· ', '')));
      const rate = el('p', 'rkp-rate num', pct(c.rate));
      const stats = el('dl', 'rkp-stats');
      for (const [k, v] of [['Calls', num(c.calls)], ['Ouverts', num(c.opened)], ['Prix moyen', tari(c.price)]]) { const d = el('div'); d.append(el('dt', '', t(k)), el('dd', 'num', v)); stats.appendChild(d); }
      const foot = el('div', 'rkp-foot'); const see = el('a', 'lnk', t('Voir le profil')); see.href = a.href; foot.append(followBtn(c), see);
      art.append(ring, h, tags, rate, el('p', 'rkp-lbl', t('Réussite vérifiée')), curve(c, 260, 54), spark(c.last), stats, foot);
      box.appendChild(art);
    });
  }

  function renderRecords(list) {
    if (!list.length) { $('rk-records').replaceChildren(); return; }
    const pick = f => list.reduce((a, b) => (f(b) > f(a) ? b : a));
    const streak = pick(c => c.best), active = pick(c => c.calls), oldest = pick(c => c.age), fans = pick(c => c.followers);
    const cards = [
      ['Meilleure série', streak.best > 0 ? `${num(streak.best)} ${window.sdPl(streak.best, 'call gagné de suite', 'calls gagnés de suite')}` : '—', streak.best > 0 ? streak.display : ''],
      ['Le plus actif', `${num(active.calls)} ${window.sdPl(active.calls, 'call', 'calls')}`, active.display],
      ['Le plus ancien', days(oldest.age), oldest.display],
      ['Le plus suivi', fans.followers > 0 ? `${num(fans.followers)} ${window.sdPl(fans.followers, 'abonné', 'abonnés')}` : '—', fans.followers > 0 ? fans.display : ''],
    ];
    $('rk-records').replaceChildren(...cards.map(([k, v, who]) => { const d = el('div', 'rk-rec'); d.append(el('span', 'k', t(k)), el('b', 'num', v), el('small', '', who)); return d; }));
  }

  function renderTable() {
    const q = state.q.trim().toLowerCase();
    const key = { calls: c => c.calls, rate: c => c.rate, age: c => c.age, price: c => c.price }[state.sort];
    const list = rows.filter(c => !q || c.name.includes(q) || c.display.toLowerCase().includes(q)).sort((a, b) => (key(a) - key(b)) * state.dir || a.rank - b.rank);
    const body = $('rk-rows'); body.replaceChildren();
    for (const c of list) {
      const tr = el('tr');
      const who = el('td'), cell = el('div', 'cell'), av = el('span', 'av'); av.appendChild(avatar(c.name));
      const nb = el('button', 'rk-name'); nb.type = 'button'; nb.setAttribute('aria-expanded', String(state.open === c.name)); nb.dataset.name = c.name;
      nb.append(el('span', '', c.display)); if (c.never) nb.appendChild(el('span', 'note hm', ' ' + never(c.never)));
      cell.append(av, nb, chip(c)); who.appendChild(cell);
      const rate = el('td', 'num' + (c.rate < 45 ? ' down' : '')); rate.append(el('span', '', pct(c.rate)), Object.assign(el('i', 'bar'), {})); rate.lastChild.style.setProperty('--w', Math.min(100, c.rate) + '%');
      const cv = el('td', 'hm rk-cv'); cv.appendChild(curve(c, 120, 32));
      const fw = el('td', 'fw'); fw.appendChild(followBtn(c));
      tr.append(el('td', 'num', String(c.rank).padStart(2, '0')), who, el('td', 'num', num(c.calls)), el('td', 'num hm', num(c.opened)), rate,
        cv, el('td', 'num hm', c.streak ? '×' + num(c.streak) : '—'), el('td', 'num hm', days(c.age)), el('td', 'num hm', tari(c.price)), fw);
      body.appendChild(tr);
      if (state.open === c.name) body.appendChild(detail(c));
    }
    $('rk-none').hidden = list.length > 0 || !rows.length;
    document.querySelectorAll('#rk-table th[aria-sort]').forEach(th => th.setAttribute('aria-sort', th.querySelector('.sort').dataset.k === state.sort ? (state.dir < 0 ? 'descending' : 'ascending') : 'none'));
  }

  function detail(c) {
    const tr = el('tr', 'rk-detail'), td = el('td'); td.colSpan = 10;
    const box = el('div', 'rk-det');
    const won = Math.round(c.closed * c.rate / 100); // la réussite porte sur les calls clos
    const left = el('div'); left.append(el('span', 'k', t('10 derniers calls')), spark(c.last));
    const dl = el('dl', 'pod-meta');
    for (const [k, v] of [['Gagnés', num(won)], ['Perdus', num(c.closed - won - c.never)], ['Jamais ouverts', num(c.never)], ['Série en cours', c.streak ? '×' + num(c.streak) : '—'], ['Meilleure série', '×' + num(c.best)], ['Prix moyen', tari(c.price)], ['Rendement moyen', c.avg === null ? '—' : (c.avg > 0 ? '+' : '') + num(c.avg, 1) + ' %']]) { const d = el('div'); d.append(el('dt', '', t(k)), el('dd', 'num', v)); dl.appendChild(d); }
    const go = el('a', 'btn-link rk-prof'); go.href = 'profil.html?c=' + encodeURIComponent(c.name); go.appendChild(el('span', 't', t('Voir le profil')));
    box.append(left, dl, go); td.appendChild(box); tr.appendChild(td);
    return tr;
  }

  // En observation : moins de 3 calls clos sur la période ; la barre montre le chemin jusqu'au classement.
  function renderWatch(list) {
    for (const e of [$('rk-watch'), $('rk-watch').previousElementSibling]) e.style.display = list.length ? '' : 'none';
    $('rk-watch').replaceChildren(...list.sort((a, b) => b.closed - a.closed || b.age - a.age).map(c => {
      const d = el('div', 'rk-w'), av = el('span', 'av'); av.appendChild(avatar(c.name));
      const nm = el('a', 'rk-wname', c.display); nm.href = 'profil.html?c=' + encodeURIComponent(c.name);
      const txt = el('div'); txt.append(nm, el('small', '', `${days(c.age)} · ${num(c.calls)} ${window.sdPl(c.calls, 'call', 'calls')}`));
      const bar = el('i', 'rk-prog'); bar.style.setProperty('--w', Math.round(c.closed / RANK_MIN * 100) + '%'); bar.setAttribute('aria-hidden', 'true');
      const left = el('small', 'rk-left', t('{n} sur 3 calls clos').replace('{n}', num(c.closed)));
      d.append(av, txt, left, bar); return d;
    }));
  }

  // Commandes.
  $('rk-period').addEventListener('click', e => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    state.p = b.dataset.p; state.open = null;
    $('rk-period').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });
  $('rk-cat').addEventListener('click', e => {
    const b = e.target.closest('button[data-c]'); if (!b) return;
    state.c = b.dataset.c; state.open = null;
    $('rk-cat').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const u = new URL(location.href); if (state.c === 'all') u.searchParams.delete('c'); else u.searchParams.set('c', state.c); history.replaceState(null, '', u);
    render();
  });
  $('rk-cat').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.c === state.c)));
  document.querySelectorAll('#rk-table .sort').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.k; state.dir = state.sort === k ? -state.dir : -1; state.sort = k; renderTable();
  }));
  $('rk-q').addEventListener('input', e => { state.q = e.target.value.slice(0, 24); renderTable(); });
  $('rk-rows').addEventListener('click', e => {
    const b = e.target.closest('.rk-name'); if (!b) return;
    state.open = state.open === b.dataset.name ? null : b.dataset.name; renderTable();
    const again = document.querySelector(`.rk-name[data-name="${b.dataset.name}"]`); if (again) again.focus();
  });

  // Onglets (motif ARIA : flèches, Début, Fin). La période ne concerne que les callers.
  const tabs = [...document.querySelectorAll('.rk-tabs [role="tab"]')];
  const select = tab => {
    tabs.forEach(x => { const on = x === tab; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; $(x.getAttribute('aria-controls')).hidden = !on; });
    $('rk-period').hidden = $('rk-cat').hidden = tab.id !== 't-callers'; $('rk-kpis').hidden = tab.id !== 't-callers';
    history.replaceState(null, '', tab.id === 't-callers' ? location.pathname + location.search : '#' + tab.getAttribute('aria-controls').slice(2));
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', e => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k === undefined) return; e.preventDefault(); const n = tabs[(k + tabs.length) % tabs.length]; select(n); n.focus();
    });
  });
  const fromHash = { '#prono': 't-prono', '#rules': 't-rules' }[location.hash];
  if (fromHash) select($(fromHash));

  // Barre de navigation, apparitions.
  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
  if (still) $('rk-podium').classList.add('in'); else io.observe($('rk-podium'));

  // Langue : les textes générés suivent.
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
});
