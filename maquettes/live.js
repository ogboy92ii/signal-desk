// Page « En direct » : le pouls de Signal Desk. Chiffres du moment, calls qui ferment bientôt, fil
// chronologique, tendances crypto. Uniquement les calls réels des desks lus sur la chaîne (aucune simulation).
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const t = k => (window.sdT ? window.sdT(k) : k);
  const D = window.SD_DATA;
  const loc = () => document.documentElement.lang || 'fr-FR';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);
  const clock = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), p = n => String(n).padStart(2, '0'); return (d ? d + t('j') + ' ' : '') + `${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`; };
  const t0 = Date.now(), left = s => s - (Date.now() - t0) / 1000;
  const av = n => { const s = el('span', 'av'); s.appendChild(D.avatar(n)); return s; };
  const link = (n, call) => 'profil.html?c=' + encodeURIComponent(n) + (call ? '&call=' + call : '');
  const CAT = D.CATS;

  // Filtres passés dans l'adresse : ?c=crypto, ?pair=BTC, ?f=follow (notifications). Crypto seulement pour l'instant.
  const qs = new URLSearchParams(location.search);
  const state = { f: ['sealed', 'opened', 'follow'].includes(qs.get('f')) ? qs.get('f') : 'all', pair: /^[A-Z]{2,6}$/.test(qs.get('pair') || '') ? qs.get('pair') : '', c: Object.hasOwn(CAT, qs.get('c') || '') ? qs.get('c') : 'all' };

  // Les calls réels de chaque desk : scellés (encore secrets) et ouverts ou clos, rangés du plus récent au plus ancien.
  const rank = new Map(D.period('30').filter(c => c.ranked).sort((a, b) => b.rate - a.rate || b.calls - a.calls).map((c, i) => [c.name, i + 1]));
  const items = [];
  for (const c of D.base) {
    for (const x of D.profile(c).calls) items.push(x.res === 'live' && !x.opened
      ? { kind: 'sealed', c, x, when: Math.max(0, (Date.now() - x.sealedAt) / 864e5) }
      : { kind: 'opened', c, x, when: x.ago });
  }
  items.sort((a, b) => a.when - b.when);
  const match = i => (state.c === 'all' || i.x.cat === state.c) && (!state.pair || i.x.sub === state.pair);
  // Aucun call sur la chaîne : message utile et lien pour sceller le premier.
  const empty = (p, msg) => {
    if (items.length) { p.textContent = t(msg); return; }
    const a = el('a', 'lnk', t('Sceller un call')); a.href = 'site-signal-desk.html#commencer';
    p.replaceChildren(t('Aucun call scellé pour l’instant.') + ' ', a);
  };
  // Achat d'un call encore en vente (prix et numéro lus sur la chaîne) ; sinon, l'ouverture est en cours.
  const buyBtn = (c, x) => {
    if (x.phase !== 'on-sale') return el('span', 'lv-kind', t('ouverture…'));
    if (!(x.price > 0)) return el('span');
    if (x.demo) return el('span', 'h2-demo', t('Démonstration'));
    const b = el('button', 'h2-mk-buy', num(x.price) + ' TARI'); b.type = 'button';
    b.addEventListener('click', () => window.sdBuy && window.sdBuy(c.name, x.price, c.desk, x.seq)); return b;
  };

  const teaser = x => {
    const b = el('div', 'h2-teaser ' + x.cat);
    if (x.cat === 'crypto') { const pair = el('span', 'h2-pair'); pair.append(el('b', '', x.pair.replace('USDT', '')), el('small', '', '/USDT')); b.appendChild(pair); if (x.hz) b.appendChild(el('span', 'h2-hz', t('horizon') + ' ' + x.hz)); }
    else b.append(el('span', 'h2-lg', t(D.subName(x.sub))), el('b', 'h2-subj', D.matchup(x)));
    return b;
  };

  // ---- Chiffres du moment ----
  function kpis() {
    const scope = items.filter(match);
    const sealed = scope.filter(i => i.kind === 'sealed'), day = scope.filter(i => i.kind === 'opened' && i.when <= 1);
    const won = day.filter(i => i.x.res === 'win').length, decided = day.filter(i => i.x.res === 'win' || i.x.res === 'loss').length;
    const box = $('lv-kpis');
    const vals = [sealed.length, day.length, decided ? won / decided * 100 : null, sealed.reduce((s, i) => s + (i.x.buyers || 0), 0)];
    if (box.children.length === 4) { [...box.children].forEach((d, i) => glide(d.querySelector('b'), vals[i], i === 2)); return; }
    box.replaceChildren();
    for (const [v, k, cls, go] of [[num(sealed.length), 'calls scellés en ce moment', 'live', '#lv-soon-s'], [num(day.length), 'ouverts ces dernières 24 h', '', '#lv-feed-h'], [decided ? pct(won / decided * 100) : '—', 'de calls gagnants sur 24 h', 'up', '#lv-feed-h'], [num(sealed.reduce((s, i) => s + (i.x.buyers || 0), 0)), 'acheteurs en attente d\'ouverture', '', '#lv-soon-s']]) {
      const d = el('div', 'lv-kpi ' + cls); d.dataset.go = go; d.append(el('b', 'num', v), el('span', '', t(k))); box.appendChild(d);
      d.querySelector('b').dataset.v = vals[box.children.length - 1] ?? '';
    }
  }

  // ---- Ça s'ouvre bientôt : le plus proche en grand (« À la une »), les 4 suivants à côté ----
  function soon() {
    const list = items.filter(i => i.kind === 'sealed' && i.x.phase === 'on-sale' && match(i)).sort((a, b) => a.x.left - b.x.left).slice(0, 5);
    const stats = new Map(D.period('all').map(c => [c.name, c]));
    const feat = $('lv-feat'), row = $('lv-soon'); feat.replaceChildren(); row.replaceChildren();
    list.forEach(({ c, x }, i) => {
      const card = i ? el('article', 'h2-mk lv-mk') : feat;
      const h = el('a', 'h2-mk-h'); h.href = link(c.name); h.append(av(c.name), el('span', 'h2-mk-n', c.display)); if (rank.get(c.name)) h.appendChild(el('span', 'h2-rank', '#' + rank.get(c.name))); // V16 : pas de « #– » pour un caller non classé
      if (!i) h.appendChild(el('span', 'h2-eyebrow lv-feat-k', t('À la une')));
      const clk = el('div', 'lv-clock'); clk.append(el('span', 'lbl', t("S'ouvre dans")), el('b', 'num h2-clock', clock(left(x.left)))); clk.lastChild.dataset.left = x.left;
      const urgency = el('i', 'lv-urg'); urgency.style.setProperty('--u', Math.max(4, 100 - x.left / 2160) + '%'); clk.appendChild(urgency);
      const foot = el('div', 'h2-mk-f');
      foot.append(el('span', '', num(x.buyers || 0) + ' ' + window.sdPl(x.buyers || 0, 'acheteur', 'acheteurs')), buyBtn(c, x));
      card.append(h, teaser(x), clk);
      if (!i) { // À la une : les chiffres du caller, pour juger avant d'acheter
        const s = stats.get(c.name), dl = el('dl', 'lv-feat-st');
        if (s) for (const [k, v] of [['Réussite', s.closed ? pct(s.rate) : '—'], ['Calls', num(s.calls)], ['Ancienneté', window.sdDays(s.age)]]) { const d = el('div'); d.append(el('dt', '', t(k)), el('dd', 'num', v)); dl.appendChild(d); }
        if (dl.children.length) card.appendChild(dl);
      }
      card.appendChild(foot); if (i) row.appendChild(card);
    });
    feat.hidden = !list.length; row.hidden = list.length < 2;
    // Le CSS (display) passe outre `hidden` : sans call en vente, le bloc entier disparaît.
    feat.parentElement.style.display = list.length ? '' : 'none';
    $('lv-soon-none').hidden = list.length > 0;
    empty($('lv-soon-none'), 'Aucun call en vente pour le moment.');
  }
  // Flèches gauche/droite d'une rangée horizontale (grisées aux extrémités, masquées si tout tient).
  function arrows(row, navId) {
    if (!row.sdSync) {
      const nav = $(navId), [prev, next] = nav.querySelectorAll('.lv-arw');
      const sync = () => { prev.disabled = row.scrollLeft <= 8; next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8; nav.hidden = row.scrollWidth <= row.clientWidth + 2; };
      for (const b of [prev, next]) {
        b.setAttribute('aria-label', t(b === prev ? 'Précédent' : 'Suivant'));
        b.addEventListener('click', () => row.scrollBy({ left: +b.dataset.d * row.clientWidth * 0.9, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
      }
      row.addEventListener('scroll', sync, { passive: true }); addEventListener('resize', sync);
      row.sdSync = sync;
    }
    row.sdSync();
  }

  // ---- Le fil : rangée horizontale, le plus récent à gauche ----
  function feed() {
    const follows = new Set(D.follow.list());
    const list = items.filter(i => match(i) && (state.f === 'all' || (state.f === 'follow' ? follows.has(i.c.name) : i.kind === state.f))).slice(0, 60);
    const box = $('lv-feed'); box.replaceChildren();
    $('lv-none').hidden = list.length > 0;
    empty($('lv-none'), !list.length && state.f === 'follow' ? 'Suivez des callers pour voir leurs calls ici.' : 'Rien pour ce filtre.');
    for (const ev of list) if (!stack(box.lastElementChild, ev)) box.appendChild(row(ev));
    box.scrollLeft = 0; arrows(box, 'lv-feed-nav');
  }
  // Deux événements identiques à la suite (même caller, même type, même sujet) = une carte « ×n ».
  const evKey = ({ kind, c, x }) => [kind, c.name, x.cat, x.pair || '', D.what(x)].join('|');
  function stack(li, ev) {
    if (!li || li.dataset.k !== evKey(ev)) return false;
    const n = (+li.dataset.n || 1) + 1; li.dataset.n = n;
    let b = li.querySelector('.lv-x'); if (!b) { b = el('span', 'num lv-x'); li.querySelector('.lv-who').after(b); }
    b.textContent = '×' + num(n); return true;
  }
  // Heure seule pour aujourd'hui, jour abrégé + heure au-delà.
  const hm = ev => new Intl.DateTimeFormat(loc(), ev.at || ev.when < 1 ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(ev.at || Date.now() - ev.when * 86400000);
  // Une carte par événement : caller · heure · sujet · action ou résultat.
  function row(ev) {
    const { kind, c, x } = ev;
    const li = el('li', 'lv-ev ' + (kind === 'sealed' ? 'sealed' : x.res)); li.dataset.k = evKey(ev);
    const tm = el('time', 'num lv-t', hm(ev));
    const who = el('div', 'lv-whobox'); const a = el('a', 'lv-who'); a.href = link(c.name); a.append(av(c.name), el('b', '', c.display));
    who.append(a, el('span', 'lv-kind', t(kind === 'sealed' || x.res === 'never' ? 'scellé' : 'ouvert')));
    const mid = el('div', 'lv-mid'); mid.appendChild(el('span', 'lv-cat ' + x.cat, t(CAT[x.cat] || x.cat)));
    if (kind === 'sealed') {
      mid.append(teaser(x), el('span', 'h2-secret', t('Sens et niveaux secrets')));
      li.append(tm, who, mid, buyBtn(c, x));
    } else {
      // Direction affichée seulement si le call a été ouvert (sinon elle n'est pas connue).
      mid.appendChild(el('span', 'lv-subj', D.what(x))); if (x.dir) mid.appendChild(el('b', 'lv-pick', D.pick(x)));
      const res = el('div', 'lv-res'), r = x.unknown ? '—' : D.result(x), rn = D.resName(x); res.appendChild(el('b', 'num', r));
      const talk = el('a', 'lnk lv-talk', rn && rn !== r ? rn + ' · ' + t('Discussion') : t('Discussion')); talk.href = link(c.name, x.n); res.appendChild(talk);
      li.append(tm, who, mid, res);
    }
    return li;
  }

  // ---- Colonne : tendances par catégorie et callers en forme ----
  function side() {
    const scope = items.filter(match);
    // Crypto : part de long parmi les calls ouverts récemment, par paire.
    const counts = {};
    for (const { x } of scope) if (x.cat === 'crypto' && x.dir) { const k = x.pair.replace('USDT', ''); counts[k] = counts[k] || { L: 0, S: 0 }; counts[k][x.dir === 'LONG' ? 'L' : 'S']++; }
    const tr = $('lv-trend'); tr.replaceChildren();
    Object.entries(counts).sort((a, b) => (b[1].L + b[1].S) - (a[1].L + a[1].S)).slice(0, 4).forEach(([k, v]) => {
      const tot = v.L + v.S, l = Math.round(v.L / tot * 100);
      const row = el('a', 'h2-tr'); row.href = 'en-direct.html?pair=' + k;
      const bar = el('span', 'h2-tr-bar'); bar.style.setProperty('--l', l + '%');
      row.append(el('b', '', k), bar, el('span', 'num', l + '% ' + t('long')), el('small', '', num(tot) + ' ' + window.sdPl(tot, 'call', 'calls'))); tr.appendChild(row);
    });
    $('lv-trend-box').hidden = !tr.children.length;
    // Sport : les matchs qui comptent le plus de calls scellés.
    const games = new Map();
    for (const { kind, x } of scope) if (x.cat === 'sport' && kind === 'sealed') { const k = x.sub + '|' + D.matchup(x); games.set(k, (games.get(k) || 0) + 1); }
    const sp = $('lv-sport'); sp.replaceChildren();
    [...games].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, n]) => {
      const [lg, m] = k.split('|'); const row = el('a', 'h2-tr'); row.href = 'marches.html?c=sport&s=' + lg;
      row.append(el('b', '', lg), el('span', 'lv-game', m), el('span', 'num', num(n) + ' ' + window.sdPl(n, 'call', 'calls'))); sp.appendChild(row);
    });
    $('lv-sport-box').hidden = !sp.children.length;
    // En forme : série de calls gagnants en cours (au moins un).
    const form = D.period('30').filter(c => c.streak > 0 && (state.c === 'all' || c.style === state.c)).sort((a, b) => b.streak - a.streak || b.rate - a.rate).slice(0, 5);
    const fo = $('lv-form'); fo.replaceChildren();
    form.forEach(c => { const li = el('li'); const a = el('a'); a.href = link(c.name); a.append(av(c.name), el('b', '', c.display), el('span', 'num lv-streak', '×' + num(c.streak))); li.appendChild(a); fo.appendChild(li); });
    $('lv-form-box').hidden = !fo.children.length;
    // Colonne vide (aucun call ouvert) : elle disparaît.
    $('lv-side').hidden = $('lv-trend-box').hidden && $('lv-sport-box').hidden && $('lv-form-box').hidden;
  }

  // Valeur affichée qui glisse en 600 ms vers la cible (immédiate si les animations sont réduites).
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('calm');
  function glide(b, to, isPct) {
    const show = v => { b.textContent = v === null ? '—' : isPct ? pct(v) : num(Math.round(v)); };
    const from = b._cur ?? (b.dataset.v === '' || b.dataset.v === undefined ? to : +b.dataset.v); b.dataset.v = to ?? ''; cancelAnimationFrame(b._raf);
    if (to === null || from === null || from === to || calm()) { show(to); return; }
    const t0 = performance.now(), run = now => { const k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 3); b._cur = from + (to - from) * e; show(b._cur); if (k < 1) b._raf = requestAnimationFrame(run); else { b._cur = null; b.classList.remove('bump'); } };
    b.classList.add('bump'); b._raf = requestAnimationFrame(run);
  }

  // ---- Flux : file d'événements traitée image par image ----
  const queue = []; let raf = 0, sideTimer = 0, kpiTimer = 0;
  function push(ev) { queue.push(ev); if (!raf) raf = requestAnimationFrame(flush); }
  function flush() {
    raf = 0;
    const batch = queue.splice(0, 8), follows = new Set(D.follow.list());
    for (const ev of batch) {
      items.unshift(ev);
      if (!(match(ev) && (state.f === 'all' || (state.f === 'follow' ? follows.has(ev.c.name) : ev.kind === state.f)))) continue;
      const box = $('lv-feed');
      if (stack(box.firstElementChild, ev)) { box.firstElementChild.querySelector('.lv-t').textContent = hm(ev); continue; }
      const li = row(ev), x0 = box.scrollLeft; if (!calm() && x0 <= 8) li.classList.add('lv-in'); box.prepend(li);
      if (x0 > 8) box.scrollLeft = x0 + li.offsetWidth + parseFloat(getComputedStyle(box).columnGap || 0); // le lecteur ne perd pas sa place
      $('lv-none').hidden = true;
    }
    // Liste plafonnée : au-delà de 60 cartes, les plus anciennes sortent du DOM.
    const all = $('lv-feed').querySelectorAll('.lv-ev'); for (let i = 60; i < all.length; i++) all[i].remove();
    if (batch.length) $('lv-feed').sdSync?.();
    if (items.length > 600) items.length = 600;
    if (batch.length) { if (!kpiTimer) kpiTimer = setTimeout(() => { kpiTimer = 0; kpis(); }, 250); clearTimeout(sideTimer); sideTimer = setTimeout(side, 1500); }
    if (queue.length) raf = requestAnimationFrame(flush);
  }
  // Aucune simulation : seuls des événements réels de la chaîne ({ kind, c, x, when, at }) passent par cette file.

  function render() { kpis(); soon(); feed(); side(); }
  const bind = (id, key, attr, after) => {
    $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state[key] = b.dataset[attr]; if (after) after(); $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); });
    $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset[attr] === state[key])));
  };
  bind('lv-filter', 'f', 'f');
  addEventListener('sd:follow', render);
  if (state.pair) { const h = document.querySelector('.rk-title'); if (h) h.textContent = t('En direct') + ' · ' + t(D.subName(state.pair)); }
  setInterval(() => { if (!document.hidden) document.querySelectorAll('.h2-clock[data-left]').forEach(e => { e.textContent = clock(left(+e.dataset.left)); }); }, 1000);

  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); if (dock) dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
});
