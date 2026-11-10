// Page Profil, façon réseau social : en-tête (avatar, abonnés, abonnements), raccourcis par paire,
// onglets Calls / Statistiques / Abonnements / Activité. profil.html?c=<caller> = profil public d'un caller ;
// sans paramètre = mon profil (wallet connecté). Données d'exemple tant que le contrat n'est pas publié.
// Après la lecture de la chaîne (data.js, SD_READY) : la page s'affiche avec les desks réels.
(window.SD_READY || Promise.resolve()).then(() => {
  const $ = id => document.getElementById(id);
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loc = () => document.documentElement.lang || 'fr-FR';
  const D = window.SD_DATA;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const compact = v => new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v / 100);
  const ago = d => { const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' }); return d < 1 ? rtf.format(-Math.max(1, Math.round(d * 24)), 'hour') : rtf.format(-Math.round(d), 'day'); };
  const dur = s => { const u = (v, unit) => new Intl.NumberFormat(loc(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(v).replace(/(d)(?=[^ds.,])/, '$1 '); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600); return d ? `${u(d, 'day')} ${u(h, 'hour')}` : u(Math.max(1, h), 'hour'); };
  const link = n => 'profil.html?c=' + encodeURIComponent(n);
  const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';

  const asked = new URLSearchParams(location.search).get('c');
  const mine = !asked;
  const askedCall = +new URLSearchParams(location.search).get('call') || 0;
  const state = { tab: askedCall ? 'calls' : 'profile', filter: 'all', hl: null, call: askedCall };
  const callUrl = n => location.origin + '/' + link(P.name) + '&call=' + n;
  let P = null, talkN; // talkN : compteur 💬 de l'onglet Discussion (S2)
  // Classement 30 jours : rang de chaque caller.
  const ranks = new Map(D.period('30').filter(c => c.ranked).sort((a, b) => b.rate - a.rate || b.calls - a.calls).map((c, i) => [c.name, i + 1]));

  // Visage d'un desk : sa photo on-chain, sinon l'avatar tiré de son nom.
  const faceOf = c => () => { if (c.picture) { const im = document.createElement('img'); im.alt = ''; im.src = c.picture; return im; } return D.avatar(c.name); };
  function load() {
    if (!mine) {
      const c = D.byName(String(asked).toLowerCase());
      if (!c) return null;
      // Mon propre desk ouvert par son lien public : ma vue (livrer, mes calls), pas celle d'un visiteur.
      const w = window.sdWallet, acct = w && w.account();
      if (acct && c.payout === acct && c.publisher === w.key()) { location.replace('profil.html'); return null; }
      return { ...D.profile(c), title: c.display, face: faceOf(c), rank: ranks.get(c.name) || 0, isMe: false };
    }
    const me = window.sdMe; if (!me) return null;
    // Mon desk : publié avec ma clé et qui paie ce compte (audit F1) ; sans desk, un profil vide (aucun chiffre inventé).
    const w = window.sdWallet, acct = w && w.account(), c = acct && D.base.find(x => x.payout === acct && x.publisher === w.key());
    if (c) return { ...D.profile(c), title: c.display || me.name, face: c.picture ? faceOf(c) : me.face, rank: ranks.get(c.name) || 0, isMe: true, following: D.follow.list().length };
    return { name: '', title: me.name, face: me.face, rank: 0, isMe: true, following: D.follow.list().length, followers: 0, total: 0, calls: [], closed: 0, rate: 0,
      never: 0, opened: 0, price: 0, age: 0, last: '', streak: 0, best: 0, bio: '', months: [], byPair: [], dirs: [], ranked: false };
  }

  function render() {
    P = load();
    const gate = mine && !window.sdMe, missing = !mine && !P;
    $('pf-gate').hidden = !gate; $('pf-missing').hidden = !missing;
    $('pf-head').hidden = $('pf-hl').hidden = $('pf-tabs').hidden = !P; $('pf-body').hidden = true; // les onglets s'affichent dans l'espace de la vitrine
    if (!P) { document.title = t(missing ? 'Profil introuvable' : 'Mon profil') + ' — Signal Desk'; return; }
    document.title = (P.isMe ? t('Mon profil') : P.title) + ' — Signal Desk';
    head(); highlights(); tabs(); panel();
  }

  // Texte de partage : nom affiché du desk ; un taux seulement quand des calls sont clos.
  const shareText = () => P.closed ? t('Les calls de {name} sur Signal Desk : {rate} de réussite vérifiée, scellés avant le marché.').replace('{name}', P.title || P.name).replace('{rate}', pct(P.rate))
    : t('Les calls de {name} sur Signal Desk, scellés avant le marché.').replace('{name}', P.title || P.name);
  function head() {
    const h = $('pf-head'); h.replaceChildren();
    h.className = 'pf-head pf-h3';
    const info = el('div', 'pf-info pf-stmt');
    const line = el('div', 'pf-line'); const name = el('h1', 'pf-name', P.title); line.appendChild(name);
    const kicker = el('span', 'pf-kicker', P.rank ? t('#{n} du classement · 30 jours').replace('{n}', num(P.rank)) : t(P.isMe ? 'Mon desk' : 'En observation'));
    // Mon @identifiant Bluesky, vérifié par la connexion OAuth (D11).
    const bs = P.isMe && window.sdBluesky && window.sdBluesky.me;
    if (bs && bs.handle) { const a = el('a', 'pf-bsky', '@' + bs.handle); a.href = 'https://bsky.app/profile/' + encodeURIComponent(bs.handle); a.target = '_blank'; a.rel = 'noopener noreferrer'; line.appendChild(a); }
    // Badges de réputation, calculés depuis l'historique (D13).
    const bl = window.sdSocial && !P.isMe ? window.sdSocial.badges(P) : [];
    const badgesRow = el('div', 'pf-badges');
    for (const b of bl) { const x = el('span', 'pf-bdg ' + b.id, b.label); x.title = b.hint; x.tabIndex = 0; x.setAttribute('aria-label', b.label + ' : ' + b.hint); badgesRow.appendChild(x); }
    const acts = el('div', 'pf-actions'); let expl = null;
    if (P.isMe) {
      const edit = el('button', 'btn-sm', t('Modifier le profil')); edit.type = 'button'; edit.addEventListener('click', () => window.sdOpenProfile && window.sdOpenProfile());
      acts.append(edit);
      // Pas encore de desk : le créer d'ici, en une signature.
      if (!P.desk) {
        const mk = el('button', 'buy', t('Créer mon desk')); mk.type = 'button';
        mk.addEventListener('click', async () => {
          const w = window.sdWallet, C = window.sdChain, net = w && w.network();
          if (!net || !C || !C.published(net)) return say('Connectez votre wallet.');
          mk.disabled = true; say('Signez dans Sapient pour créer votre desk.');
          try { await C.openDesk(net); say('Desk créé.'); setTimeout(() => location.reload(), 1500); }
          catch (x) { console.warn('[signal-desk] desk', x && x.message); mk.disabled = false; say(x && x.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); }
        });
        acts.append(mk);
        expl = el('p', 'pf-meta', t('Votre desk est votre boutique de calls sur la blockchain : il garde vos calls scellés, les vend en TARI et prouve votre historique. Une signature, une seule fois.'));
      }
    } else {
      const f = el('button', 'btn-sm pf-follow'); f.type = 'button'; f.dataset.name = P.name; f.setAttribute('aria-pressed', String(D.follow.has(P.name)));
      f.append(el('span', 'off', t('Suivre')), el('span', 'on', t('Suivi'))); f.addEventListener('click', () => D.follow.toggle(P.name, P.desk));
      const bell = el('button', 'ico pf-bell'); bell.type = 'button'; bell.innerHTML = BELL; bell.dataset.name = P.name;
      bell.hidden = !D.follow.has(P.name); bell.setAttribute('aria-pressed', String(D.follow.bell(P.name))); bell.setAttribute('aria-label', t('Notifications de ses calls'));
      bell.addEventListener('click', () => { const on = D.follow.toggleBell(P.name); bell.setAttribute('aria-pressed', String(on)); say(on ? 'Notifications activées.' : 'Notifications coupées.'); });
      // Le call en vente le plus récent de ce desk (adresse + numéro lus sur la chaîne) ; aucun : bouton désactivé.
      const sale = (P.calls || []).find(x => x.phase === 'on-sale' && x.price > 0);
      // Recette V9 : sans call en vente, un simple texte (le bouton violet désactivé ressemblait à un achat).
      const buy = sale ? el('button', 'buy', t('Acheter le prochain call')) : el('span', 'pf-nosale', t('Aucun call en vente pour le moment.')); if (sale) buy.type = 'button';
      if (sale) buy.addEventListener('click', () => window.sdBuy && window.sdBuy(P.name, sale.price, P.desk, sale.seq));
      // « Copier » retiré de l'en-tête (09/11) : l'onglet Copie du profil fait déjà ce travail.
      const share = el('button', 'btn-sm', t('Partager sur Bluesky')); share.type = 'button';
      share.addEventListener('click', () => window.sdBluesky && window.sdBluesky.share(shareText() + ' ' + location.origin + '/' + link(P.name)));
      acts.append(f, bell, buy, share);
    }
    line.appendChild(acts);
    const followers = P.followers || 0; // abonnés inscrits sur la chaîne
    const stats = el('ul', 'pf-stats');
    for (const [v, k, tab] of [[P.total, ['call', 'calls'], 'calls'], [followers, ['abonné', 'abonnés'], null], [P.following, ['abonnement', 'abonnements'], P.isMe ? 'follows' : null]]) {
      const li = el('li'); const inner = tab ? el('button', 'pf-stat') : el('span', 'pf-stat'); if (tab) { inner.type = 'button'; inner.addEventListener('click', () => { state.tab = tab; tabs(); panel(); $('pf-panels').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }); }
      inner.append(el('b', 'num', compact(v)), el('span', '', window.sdPl(v, k[0], k[1]))); li.appendChild(inner); stats.appendChild(li);
    }
    // Le chiffre qui compte, en grand : la réussite vérifiée.
    // Aucun call clos : 0.
    const huge = el('p', 'pf-huge'); const hv = el('span', 'num', P.closed ? num(P.rate, 1) : '0'); huge.append(hv, el('small', '', ' %'));
    const tag = el('p', 'pf-tag');
    tag.append(document.createTextNode(t('de réussite') + ' '), el('b', '', t('vérifiée sur la blockchain')), document.createTextNode(', ' + window.sdPl(P.total, 'sur {n} call scellé avant l\'événement.', 'sur {n} calls scellés avant l\'événement.').replace('{n}', num(P.total)) + ' '));
    tag.appendChild(P.never ? document.createTextNode(window.sdPl(P.never, '{n} jamais ouvert, compté perdu.', '{n} jamais ouverts, comptés perdus.').replace('{n}', num(P.never))) : el('b', '', t('Aucun call caché.')));
    const meta = el('p', 'pf-meta', [(P.age < 1 ? t('Caller depuis aujourd\'hui') : `${t('Caller depuis')} ${window.sdDays(P.age)}`), `${t('prix moyen')} ${num(P.price)} TARI`].concat(P.avg == null ? [] : [`${t('rendement moyen')} ${(P.avg > 0 ? '+' : '') + num(P.avg, 1)} %`]).join(' · '));
    const bio = el('p', 'pf-bio', P.bio || ''); // texte du caller, jamais traduit
    info.append(kicker, line, huge, tag, badgesRow, stats, meta, bio); if (expl) line.after(expl);
    // Compteur du grand chiffre (sauf animations réduites).
    if (P.closed && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t1 = performance.now(), go = now => { const k = Math.min(1, (now - t1) / 1100); hv.textContent = num(P.rate * (1 - Math.pow(1 - k, 3)), 1); if (k < 1 && hv.isConnected) requestAnimationFrame(go); };
      requestAnimationFrame(go);
    }

    // Scène : l'avatar au centre, anneau de réussite, meilleurs calls en orbite (cliquables vers leur discussion).
    const orbit = el('div', 'pf-orbit' + (P.calls.some(c => c.res === 'live') ? ' live' : '')); orbit.style.setProperty('--p', Math.round(P.rate));
    const ring = el('div', 'pf-o'), ring2 = el('div', 'pf-o pf-o2');
    const core = el('div', 'pf-core'); const ava = el('span', 'pf-ava'); ava.appendChild(P.face()); core.appendChild(ava);
    const best = P.calls.filter(x => x.res === 'win').sort((x, y) => y.move - x.move).slice(0, 6);
    best.forEach((x, i) => {
      const chip = el('div', 'pf-chip'); chip.style.setProperty('--a', (i * 360 / best.length) + 'deg');
      const card = el('a', 'pf-bc'); card.href = P.isMe ? '#' : link(P.name) + '&call=' + x.n;
      const t1 = el('span', 'pf-bc-t'); t1.append(el('b', '', D.what(x)), x.cat === 'crypto' ? el('span', 'pf-dir ' + (x.dir === 'LONG' ? 'up' : 'dn'), (x.dir === 'LONG' ? '▲ ' : '▼ ') + x.dir) : el('span', 'pf-dir pick', D.pick(x)));
      card.append(t1, el('span', 'pf-bc-m num', D.result(x)), el('small', '', '#' + num(x.n) + ' · ' + ago(x.ago)));
      card.setAttribute('aria-label', t('Meilleurs calls') + ' : ' + D.callText(x) + ', ' + D.result(x));
      card.addEventListener('click', e => { e.preventDefault(); if (P.isMe) return; state.call = x.n; state.tab = 'calls'; tabs(); panel(); scrollTo({ top: $('pf-panels').getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); });
      chip.appendChild(card); ring.appendChild(chip);
    });
    orbit.append(ring, ring2, core);
    h.append(info, orbit);
    // Rayon de l'orbite : le plus grand possible dans la zone, sans couper une carte.
    const fit = () => { const cards = [...orbit.querySelectorAll('.pf-bc')]; if (!cards.length) return;
      const half = Math.max(...cards.map(e => Math.max(e.offsetWidth, e.offsetHeight))) / 2;
      orbit.style.setProperty('--orb-r', Math.max(0, orbit.offsetWidth / 2 - half - 4) + 'px'); };
    requestAnimationFrame(fit);
    if (!window.__pfFit) { window.__pfFit = true; addEventListener('resize', () => { const o = document.querySelector('.pf-orbit'); if (o) o.dispatchEvent(new Event('fit')); }); }
    orbit.addEventListener('fit', fit);
  }

  // Raccourcis façon « stories » : un cercle par direction et par paire, l'anneau suit la réussite.
  function highlights() {
    const box = $('pf-hl'); box.replaceChildren();
    box.hidden = !P.closed; if (!P.closed) return;
    const items = [{ key: null, label: t('Tous'), rate: P.rate }, ...P.dirs.filter(d => d.n).map(d => ({ key: 'dir:' + d.dir, label: d.dir === 'LONG' ? 'Long' : 'Short', rate: d.rate })), ...P.byPair.map(p => ({ key: 'pair:' + p.pair, label: t(D.subName(p.pair.replace('USDT', ''))), rate: p.rate }))];
    for (const it of items) {
      const b = el('button', 'pf-story'); b.type = 'button'; b.setAttribute('aria-pressed', String(state.hl === it.key));
      const c = el('span', 'pf-circle'); c.style.setProperty('--p', Math.round(it.rate) + '%'); c.appendChild(el('b', 'num', Math.round(it.rate) + '%'));
      b.append(c, el('span', 'pf-slabel', it.label)); b.setAttribute('aria-label', `${it.label} : ${pct(it.rate)}`);
      b.addEventListener('click', () => { state.hl = it.key; state.tab = 'calls'; highlights(); tabs(); panel(); });
      box.appendChild(b);
    }
  }

  // Onglets collés juste sous la barre fixe du site (hauteur mesurée : elle change avec la largeur).
  const pinTabs = () => { const h = [...document.querySelectorAll('header, .sdnav, nav')].find(x => getComputedStyle(x).position === 'fixed'); if (h) document.documentElement.style.setProperty('--pf-tabs-top', Math.round(h.getBoundingClientRect().bottom) + 'px'); };
  pinTabs(); addEventListener('resize', pinTabs, { passive: true });
  function tabs() {
    const list = [['profile', 'Profil'], ['calls', 'Calls'], ['stats', 'Statistiques']]; if (P.isMe) list.push(['forecasts', 'Pronostics'], ['follows', 'Abonnements'], ['activity', 'Activité'], ...(P.name ? [['talk', 'Discussion']] : [])); else list.push(['copy', 'Copie'], ['talk', 'Discussion']);
    if (!list.some(x => x[0] === state.tab)) state.tab = 'profile';
    const box = $('pf-tabs'); box.replaceChildren(...list.map(([k, lbl], i) => {
      const b = el('button', '', t(lbl)); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'pt-' + k; b.setAttribute('aria-controls', 'pf-panels');
      const on = state.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      b.addEventListener('click', () => { state.tab = k; tabs(); panel(); $('pt-' + k).focus({ preventScroll: true }); }); // pas de défilement : la page reste où elle est (Soufian, 09/11)
      b.addEventListener('keydown', e => { const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key]; if (n === undefined) return; e.preventDefault(); state.tab = list[(n + list.length) % list.length][0]; tabs(); panel(); $('pt-' + state.tab).focus(); });
      return b;
    }));
    $('pf-panels').setAttribute('role', 'tabpanel'); $('pf-panels').setAttribute('aria-labelledby', 'pt-' + state.tab);
    // S2 (09/11) : 💬 nombre de messages Bluesky sur ce profil (posts + réponses), lu une fois, à côté de l'onglet Discussion.
    if (P.name && window.sdSocial && $('pt-talk')) {
      const put = n => { const b = $('pt-talk'); if (b && n > 0 && !b.querySelector('.pt-n')) b.appendChild(el('span', 'pt-n', ' 💬 ' + num(n))); };
      if (talkN === undefined) { talkN = null; window.sdSocial.talkCount(location.origin + '/' + link(P.name)).then(n => { talkN = n; put(n); }).catch(() => {}); }
      else if (talkN) put(talkN);
    }
  }

  function panel() {
    // Onglet Profil = la vitrine ; les autres onglets prennent sa place, dans le même espace sous les onglets.
    const vit = state.tab === 'profile', box = $('pf-panels'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('pf-head').hidden = $('pf-hl').hidden = !vit; box.hidden = vit;
    const enter = x => { if (still) return; x.classList.remove('pf-enter'); void x.offsetWidth; x.classList.add('pf-enter'); };
    if (vit) { box.replaceChildren(); enter($('pf-head')); return; }
    box.replaceChildren();
    ({ calls: calls, forecasts: myForecasts, stats: stats, follows: follows, activity: activity, copy: copyPanel, talk: talkPanel })[state.tab](box);
    // Entrée du panneau (site.css .pf-enter) : relancée à chaque onglet, sauf animations réduites.
    enter(box);
  }

  // ---- Calls : registre pleine largeur (direction O1 « Registre », choisie le 03/11 ; animations dans callanim.js) ----
  const A = () => window.sdCallAnim;
  const PICK = { WIN: 'Vainqueur', SPREAD: 'Écart (handicap)', TOTAL: 'Total de points', PROP: 'Stat de joueur', METHOD: 'Méthode de victoire', ROUNDS: 'Nombre de rounds' };
  const price = v => new Intl.NumberFormat(loc(), { maximumFractionDigits: 8 }).format(v);
  const date = iso => new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const sideEl = d => el('span', 'rg-side ' + (d === 'LONG' ? 'rg-up' : 'rg-dn'), (d === 'LONG' ? '▲ ' : '▼ ') + d);
  // Le call en clair, champ par champ avec son libellé (sport, politique, ou format inconnu).
  function callFields(payload) {
    const c = window.sdChain.parseCall(payload), box = el('span', 'rg-fields');
    const f = (label, value) => { const s = el('span', ''); if (label) s.appendChild(el('i', '', t(label))); s.appendChild(document.createTextNode(value)); box.appendChild(s); };
    if (!c) f('', payload.split('|').slice(1).join(' · '));
    else if (c.cat === 'crypto') { f('Entrée', price(c.entry)); f('Objectif', price(c.tp)); f('Stop', price(c.sl)); f('Échéance', date(c.until)); }
    else if (c.cat === 'sport') { f('Début du match', date(c.when)); f(PICK[c.pick[0]] || '', c.pick.slice(1).join(' ')); }
    else if (c.cat === 'free') { f('Texte', c.text); f('Échéance', date(c.when)); }
    else { f('Votre choix', c.choice); f('Source officielle', c.country); f('Résultat attendu', date(c.when)); }
    return box;
  }
  /** Contenu en clair d'un de mes calls : règle des niveaux en crypto, champs sinon. */
  function plainOf(payload) {
    const c = window.sdChain.parseCall(payload);
    if (c && c.cat === 'crypto') { const lv = { sl: c.sl, e: c.entry, tp: c.tp }; return { node: A().levels(lv), text: A().levelsText(lv) }; }
    const node = callFields(payload); return { node, text: node.textContent };
  }
  /** Marché lisible : depuis le contenu (le mien) ou, à défaut, l'étiquette publique de la chaîne. */
  function market(payload, label) {
    const c = payload && window.sdChain.parseCall(payload), box = el('div', 'rg-mk');
    if (c && c.cat === 'crypto') box.append(el('b', '', c.asset), sideEl(c.side));
    else if (c && c.cat === 'sport') box.append(el('b', '', c.a + (c.label.includes('@') ? ' @ ' : ' vs ') + c.b), el('small', '', c.league));
    else if (c) box.append(el('b', '', c.subject), el('small', '', c.cat === 'free' ? t('Libre') : c.country));
    else { const f = String(label || '').split('|'); box.append(el('b', '', f[0] === 'POL' ? f[2] || '' : f.length > 1 ? f[1] : f[0] || '—')); }
    return box;
  }
  function regHead(detLabel) {
    const h = el('div', 'rg-row rg-headrow');
    for (const k of ['N°', 'Marché', detLabel, 'Résultat', 'Acheteurs', 'État']) h.appendChild(el('span', '', t(k)));
    return h;
  }
  /** Une ligne : n°, marché, détail (règle, champs ou empreinte), résultat, acheteurs, état, actions. */
  function regRow(o) {
    const r = el('div', 'rg-row' + (o.sealed ? ' sealed' : ''));
    const det = el('div', 'rg-det'); if (o.det) det.appendChild(o.det);
    const st = el('div', 'rg-st');
    if (o.lock) st.insertAdjacentHTML('beforeend', '<span class="rg-li">' + A().LOCK + '</span>');
    if (o.check) st.insertAdjacentHTML('beforeend', '<span class="rg-up">' + A().CHK.replace('rg-chk', 'rg-chk on') + '</span>');
    st.appendChild(el('span', '', o.state));
    r.append(el('span', 'rg-n', '#' + num(o.n)), o.market, det, el('span', 'rg-res ' + (o.resCls || ''), o.res), el('span', 'rg-by', num(o.buyers) + ' ' + window.sdPl(o.buyers, 'acheteur', 'acheteurs')), st);
    if (o.actions && o.actions.childNodes.length) r.appendChild(o.actions);
    return r;
  }

  function calls(box) {
    const bar = el('div', 'rk-period pf-filter'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', t('Filtrer les calls'));
    for (const [k, lbl] of [['all', 'Tous'], ['win', 'Gagnés'], ['loss', 'Perdus'], ['live', 'En cours']]) {
      const b = el('button', '', t(lbl)); b.type = 'button'; b.setAttribute('aria-pressed', String(state.filter === k)); b.addEventListener('click', () => { state.filter = k; panel(); }); bar.appendChild(b);
    }
    box.appendChild(bar);
    // Mon profil : mes vrais calls (desk on-chain), plus aucun call d'exemple.
    if (P.isMe) return myCalls(box);
    const list = P.calls.filter(c => (state.filter === 'all' || (state.filter === 'loss' ? c.res === 'loss' || c.res === 'never' : c.res === state.filter))
      && (!state.hl || (state.hl.startsWith('dir:') ? c.dir === state.hl.slice(4) : c.pair === state.hl.slice(5) || c.sub === state.hl.slice(5))));
    if (!list.length) { box.appendChild(el('p', 'rk-empty', t('Aucun call pour ce filtre.'))); return; }
    const sel = state.call && P.calls.find(x => x.n === state.call);
    if (sel && window.sdSocial) {
      const d = el('div', 'pf-panel pf-calldet');
      const top = el('div', 'pf-ctop'); top.append(el('b', '', `#${num(sel.n)} · ${sel.res === 'live' ? D.what(sel) : D.callText(sel)}`), el('span', '', D.resName(sel)));
      const close = el('button', 'lnk', t('Fermer')); close.type = 'button'; close.addEventListener('click', () => { state.call = 0; panel(); });
      top.appendChild(close); d.appendChild(top);
      d.appendChild(window.sdSocial.discussionBox(callUrl(sel.n), t('Call #{n} de {name} sur Signal Desk : {call}.').replace('{n}', num(sel.n)).replace('{name}', P.name).replace('{call}', `${sel.res === 'live' ? D.what(sel) : D.callText(sel)}, ${D.resName(sel)}`)));
      box.appendChild(d);
    }
    const reg = el('div', 'rg'); reg.appendChild(regHead('Pronostic'));
    for (const c of list) {
      // Scellé = pas encore ouvert ; un call ouvert mais pas encore tranché reste « en cours » avec son sens public.
      const live = c.res === 'live' && !c.opened, mk = el('div', 'rg-mk');
      // Un call scellé ne montre jamais son sens : seul le sujet est public.
      mk.appendChild(el('b', '', D.what(c)));
      if (c.dir) mk.appendChild(sideEl(c.dir));
      // Call ouvert sans niveaux de prix (sport, Finance / Politique, libre) : le pronostic lui-même, en clair.
      const det = live ? A().hexNode(c.commitment) : el('span', 'rg-txt', c.hz || (c.pk && c.opened ? D.pick(c) : ''));
      // Call en vente : acheté depuis sa ligne (adresse du desk + numéro lus sur la chaîne).
      const acts = el('span', 'rg-act');
      if (c.phase === 'on-sale' && c.price > 0 && P.desk) {
        const b = el('button', 'btn-sm', t('Acheter') + ' · ' + num(c.price) + ' TARI'); b.type = 'button';
        b.addEventListener('click', e => { e.stopPropagation(); if (window.sdBuy) window.sdBuy(P.name, c.price, P.desk, c.seq); });
        acts.appendChild(b);
      }
      // C2 (10/11) : call arrivé à l'échéance dont la copie verrouillée est lisible = tout visiteur connecté peut l'ouvrir (le contrat vérifie).
      if (c.phase === 'revealing' && c.tlockAt && Date.now() >= c.tlockAt && P.desk && window.sdChain) {
        const b = el('button', 'btn-sm', t('Ouvrir ce call')); b.type = 'button';
        b.addEventListener('click', async e => {
          e.stopPropagation();
          const w = window.sdWallet;
          if (!w || !w.account()) return say('Connectez votre wallet.');
          b.disabled = true;
          try { await window.sdChain.revealFromTlock(w.network(), P.desk, c.seq); say('Call ouvert publiquement.'); setTimeout(() => location.reload(), 2500); }
          catch (err) { console.warn('[signal-desk]', err && err.message); say(err && err.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); b.disabled = false; }
        });
        acts.appendChild(b);
      }
      // Call Finance / Politique tranché : lien vers la publication officielle qui fait foi.
      if (c.source && c.source.startsWith('https://')) { const a = el('a', 'btn-sm', t('Source')); a.href = c.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.addEventListener('click', e => e.stopPropagation()); acts.appendChild(a); }
      const row = regRow({ n: c.n, market: mk, det, sealed: live, res: live ? t('Scellé') : D.result(c),
        resCls: live ? 'rg-li' : c.res === 'win' ? 'rg-up' : c.res === 'loss' ? 'rg-dn' : 'rg-f3',
        buyers: c.buyers, lock: live, state: live ? t("s'ouvre dans {x}").replace('{x}', dur(c.left)) : D.resName(c) + ' · ' + ago(c.ago), actions: acts });
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', t('Ouvrir la discussion du call #{n}').replace('{n}', num(c.n)));
      const open = () => { state.call = c.n; panel(); scrollTo({ top: $('pf-panels').getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); };
      row.addEventListener('click', open); row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      reg.appendChild(row);
    }
    box.appendChild(reg);
  }

  // Mes calls : tous ceux de mon desk, en clair pour moi seul (sauvegardes privées du wallet, chain.js
  // privateSecrets, vérifiées contre l'engagement on-chain), avec leurs actions. C'est le seul endroit où
  // on les gère (Soufian, 03/11 : pas de liste dans « Sceller un call »).
  let priv = null;
  const OUTCOME = { win: 'Objectif atteint', loss: 'Stop touché', expired: 'Échéance', open: 'En cours', invalid: 'Entrée invalide' };
  async function outcomeInto(row, pc, since, key) {
    const o = await window.sdPrices.outcome({ asset: pc.asset, side: pc.side, entry: pc.entry, tp: pc.tp, sl: pc.sl, until: pc.until }, since, key).catch(e => { console.warn('[signal-desk] prix', e && e.message); return null; });
    if (!o || !row.isConnected || !o.source) return;
    const res = row.querySelector('.rg-res'), det = row.querySelector('.rg-det'), st = row.querySelector('.rg-st > span:last-child');
    res.textContent = o.state === 'invalid' ? '—' : (o.pct > 0 ? '+' : '') + num(o.pct, 2) + ' %'; res.className = 'rg-res ' + (o.state === 'invalid' ? 'rg-f3' : o.pct > 0 ? 'rg-up' : o.pct < 0 ? 'rg-dn' : '');
    det.replaceChildren(A().levels({ sl: pc.sl, e: pc.entry, tp: pc.tp, end: o.exit }));
    if (st) st.textContent = t(OUTCOME[o.state]) + ' · ' + t('selon {s}').replace('{s}', o.source);
  }
  // Mes pronostics (compte connecté) : ceux de ce navigateur et ceux sauvegardés dans le wallet (mémo sf1, sans demande),
  // plus ceux scellés avec ma clé sur le tableau public. État lu sur la chaîne.
  let fcRun = 0;
  async function myForecasts(box) {
    const w = window.sdWallet, C = window.sdChain, net = w && w.network(), me = ++fcRun;
    const body = el('div', 'pf-fcs'); box.appendChild(body);
    const msg = k => body.replaceChildren(el('p', 'rk-empty', t(k)));
    if (!w || !w.account() || !C || !C.forecastsLive(net)) return msg('Aucun pronostic scellé.');
    msg('Chargement…');
    try {
      const key = await C.whoami(net), mine = new Map();
      const add = x => { if (x && x.kind === 'forecast' && x.key === key && x.network === net && /^component_[0-9a-f]{64}$/.test(x.board)) mine.set(x.board + '|' + x.question, x); };
      try { Object.keys(localStorage).filter(k => k.startsWith('sd-fc-')).forEach(k => { try { add(JSON.parse(localStorage.getItem(k))); } catch (e) {} }); } catch (e) {}
      ((await C.privateForecasts(net, false).catch(() => null)) || []).forEach(add);
      const addrs = [...new Set([C.readBoard && (await C.readBoard(net).then(b => b.address).catch(() => null)), ...[...mine.values()].map(x => x.board)].filter(Boolean))];
      const [boards, epoch] = await Promise.all([Promise.all(addrs.map(a => C.readBoard(net, a).catch(() => null))), C.currentEpoch(net)]);
      if (me !== fcRun) return;
      const LBL = { oui: 'Oui', non: 'Non', hausse: '▲ Hausse', baisse: '▼ Baisse' }, rows = [];
      for (const b of boards.filter(Boolean)) for (const q of b.questions) {
        const f = q.forecasts.find(x => x.key === key), s = mine.get(b.address + '|' + q.id);
        if (!f && !s) continue;
        const ans = s ? (LBL[s.answer] ? t(LBL[s.answer]) : s.answer) : t('Secrète (scellée depuis un autre appareil)');
        const st = !f ? t('Introuvable sur la chaîne') : f.revealed ? t('Ouvert') : epoch >= q.close ? t('Clos : à ouvrir') : t('Scellé');
        rows.push({ b, q, ans, st, open: !!(f && f.revealed) });
      }
      if (!rows.length) return msg('Aucun pronostic scellé.');
      body.replaceChildren(...rows.map(({ b, q, ans, st, open }) => {
        const r = el('div', 'pf-fc' + (open ? ' on' : ''));
        const a = el('a', 'pf-fc-q', window.sdBi(t(q.meta.q || ''))); a.href = 'ligues.html?ligue=' + b.address;
        const lg = el('small', '', (b.name || t('Ligue {id}').replace('{id}', b.address.slice(10, 14) + '…' + b.address.slice(-4))) + ' · #' + q.id);
        const left = el('div'); left.append(a, lg);
        const mid = el('div'); mid.append(el('small', '', t('Votre réponse')), el('b', '', ans));
        r.append(left, mid, el('span', 'pf-fc-st', st)); return r;
      }));
    } catch (e) { console.warn('[signal-desk] mes pronostics', e && e.message); if (me === fcRun) msg('Blockchain injoignable pour le moment : réessayez dans un instant.'); }
  }
  function myCalls(box) {
    const w = window.sdWallet, C = window.sdChain, acct = w && w.account(), net = w && w.network();
    const reg = el('div', 'rg'), body = el('div', 'rg-body'), note = el('p', 'rg-note'), bulk = el('div', 'rg-bulk');
    reg.append(regHead('Niveaux'), body); box.append(bulk, reg, note);
    const msg = k => body.replaceChildren(el('p', 'rk-empty', t(k)));
    if (!acct || !C || !C.published(net)) return msg('Vos calls apparaîtront ici dès que vous aurez scellé le premier.');
    note.textContent = t('Calls encore scellés : contenu visible par vous seul sur cet appareil. Les visiteurs voient l’empreinte, et le call s’ouvre tout seul à l’heure prévue.');
    const show = r => {
      const k = window.sdWallet && window.sdWallet.key(), desks = r.desks.filter(d => d.payout === acct && d.publisher === k);
      let own = desks.flatMap(d => d.calls.map(c => ({ d, c, s: r.secrets.find(x => x.desk === d.address && x.seq === c.seq), ph: C.phase(c, r.epoch) }))).sort((a, b) => b.c.seq - a.c.seq);
      // Pas encore de résultat sur la chaîne (source des prix à venir) : « En cours » = pas encore ouvert.
      // C2 (10/11) : plusieurs calls à l'échéance = un bandeau pour tous les ouvrir en une signature (par lot de 5).
      const due = own.filter(x => x.ph === 'revealing' && x.s);
      bulk.replaceChildren();
      if (due.length > 1) {
        const b = el('button', 'btn-sm', t('Tout ouvrir ({n})').replace('{n}', num(due.length))); b.type = 'button';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { await C.revealMany(net, due.map(x => x.s)); say('Calls ouverts publiquement.'); await A().wait(1600); priv = null; load(); }
          catch (err) { console.warn('[signal-desk]', err && err.message); say(err && err.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); b.disabled = false; }
        });
        bulk.append(el('span', '', t('{n} calls attendent leur ouverture.').replace('{n}', num(due.length))), b);
      }
      if (state.filter === 'live') own = own.filter(x => x.ph === 'on-sale' || x.ph === 'revealing'); else if (state.filter !== 'all') own = [];
      if (!own.length) {
        if (state.filter !== 'all') return msg('Aucun call pour ce filtre.');
        const b = el('button', 'btn-sm', t('Sceller un call')); b.type = 'button'; b.addEventListener('click', () => window.sdOpenSeal && window.sdOpenSeal());
        body.replaceChildren(el('p', 'rk-empty', t('Aucun call scellé pour l’instant.')), b); return;
      }
      body.replaceChildren(...own.map(({ d, c, s, ph }) => {
        const sealed = ph === 'on-sale' || ph === 'revealing', plain = s && plainOf(s.payload), acts = el('span', 'rg-act');
        const row = regRow({ n: c.seq + 1, market: market(s && s.payload, c.label), det: plain ? plain.node : A().hexNode(c.commitment), sealed,
          res: sealed ? t('Scellé') : ph === 'revealed' ? t('Ouvert') : t('jamais ouvert'), resCls: sealed ? 'rg-li' : ph === 'revealed' ? '' : 'rg-dn',
          buyers: c.sold, lock: sealed, check: ph === 'revealed',
          state: ph === 'on-sale' ? (C.tlockOpensAt(c) ? opensAt(c) : t("s'ouvre vers l'époque {e}").replace('{e}', num(c.revealAtEpoch))) : ph === 'revealing' ? (s ? t('à ouvrir') : opensAt(c)) : ph === 'revealed' ? t('engagement vérifié · ouvert') : t('acheteurs remboursés'),
          actions: acts });
        // Call crypto ouvert : résultat calculé sur les prix publics (prices.js), heure de scellement déduite des époques (≈ 1 h).
        if (ph === 'revealed' && s && window.sdPrices) { const pc = C.parseCall(s.payload); if (pc && pc.cat === 'crypto') outcomeInto(row, pc, Date.now() - (r.epoch - c.sealedAtEpoch) * 3600e3, d.address + ':' + c.seq); }
        const act = (label, fn, ok) => {
          const b = el('button', 'btn-sm', label); b.type = 'button';
          b.addEventListener('click', async () => {
            acts.querySelectorAll('button').forEach(x => { x.disabled = true; });
            try { await fn(); say(ok); await A().wait(1600); priv = null; load(); }
            catch (e) { console.warn('[signal-desk]', e && e.message); say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); acts.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
          });
          acts.appendChild(b);
        };
        // Call en vente : lien public d'achat (sujet + prix, jamais le contenu), à envoyer à l'acheteur.
        if (ph === 'on-sale') {
          const b = el('button', 'btn-sm', t("Copier le lien d'achat")); b.type = 'button';
          b.addEventListener('click', async () => {
            const url = location.origin + '/marches.html?achat=' + d.address + '&n=' + c.seq + '&r=' + net;
            try { await navigator.clipboard.writeText(url); say("Lien d'achat copié."); } catch (e) { prompt(t("Lien d'achat"), url); }
          });
          acts.appendChild(b);
        }
        // A5 : tous les acheteurs en attente livrés ensemble (1 signature par lot de 5, chain.js deliverAll).
        const pending = c.sales.filter(x => C.saleState(c, x, r.epoch).deliverable);
        if (pending.length && s) act(t('Livrer') + ' (' + num(pending.length) + ')', () => C.deliverAll(net, s, pending.map(x => x.sale)), 'Call livré à ses acheteurs.');
        // Ouvrir : la transaction, puis l'animation d'ouverture sur la ligne (empreinte → niveaux → coche).
        if (ph === 'revealing' && s) act(t('Ouvrir'), async () => {
          await C.reveal(net, s); acts.replaceChildren();
          const pl = plainOf(s.payload); await A().open(row, { hex: c.commitment, plain: pl.text, node: pl.node, res: t('Ouvert'), resCls: '' });
        }, 'Call ouvert publiquement.');
        if (C.settleable(c, r.epoch)) act(t('Régler'), () => C.settle(net, d.address, c.seq), 'Gains du call réglés.');
        // Call ouvert : le partager sur Bluesky (le composeur s'ouvre, vous validez).
        if (ph === 'revealed' && s && window.sdBluesky) {
          const b = el('button', 'btn-sm', t('Partager')); b.type = 'button';
          b.addEventListener('click', () => window.sdBluesky.share(t("Mon call #{n} sur Signal Desk : {call}. Scellé avant le marché, ouvert à l'échéance, vérifiable par tous.").replace('{n}', c.seq).replace('{call}', s.payload.split('|').slice(1, 6).join(' ')) + ' ' + location.origin));
          acts.appendChild(b);
        }
        // Les boutons sont ajoutés après regRow, qui n'accroche `actions` que s'il est déjà rempli :
        // sans cette ligne, Livrer / Ouvrir / Régler / Partager / lien d'achat n'apparaissaient jamais.
        if (acts.childNodes.length && !acts.isConnected) row.appendChild(acts);
        return row;
      }));
    };
    // A2/A3 (08/11) : mes desks (événements desk_opened), contenu de chaque call depuis ce navigateur, une ancienne
    // sauvegarde du wallet (lue sans demande), ou sa copie drand une fois l'heure passée. Plus d'accès en lecture à demander.
    const local = (desk, seq, c) => { try { const x = JSON.parse(localStorage.getItem('sd-sec-' + desk.slice(10, 26) + '-' + seq) || 'null'); return x && x.desk === desk && x.seq === seq && x.commitment === c.commitment && typeof x.payload === 'string' ? x : null; } catch (e) { return null; } };
    async function mine() {
      const [desks, epoch, old] = await Promise.all([C.findDesks(net, acct, window.sdWallet && window.sdWallet.key()), C.currentEpoch(net), C.privateSecrets(net, false).catch(() => null)]);
      const secrets = [];
      for (const d of desks) for (const c of d.calls) {
        let x = local(d.address, c.seq, c) || (old && old.secrets.find(y => y.desk === d.address && y.seq === c.seq));
        if (!x && c.revealedAtEpoch === null && c.tlock) {
          const o = await C.openTlock(d, c).catch(e => { console.warn('[signal-desk] copie du call #' + c.seq, e && e.message); return null; });
          if (o) x = { v: 1, network: net, desk: d.address, seq: c.seq, payload: o.payload, nonce: o.nonce, commitment: c.commitment, revealAtEpoch: c.revealAtEpoch, price: String(c.price) };
        }
        if (x) secrets.push(x);
      }
      return { desks, secrets, epoch };
    }
    const opensAt = c => { const at = C.tlockOpensAt(c); return at ? t("s'ouvre tout seul vers {h}").replace('{h}', new Intl.DateTimeFormat(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(at)) : t('à ouvrir'); };
    const load = () => {
      msg('Lecture de la blockchain…');
      if (!priv || priv.key !== net + acct) priv = { key: net + acct, p: mine() };
      // Le profil peut se redessiner pendant la lecture : on affiche dans la section encore à l'écran,
      // la lecture en cours est partagée (une seule lecture).
      const run = priv;
      run.p.then(r => { if (body.isConnected) show(r); })
        .catch(e => { console.warn('[signal-desk] mes calls', e && e.message); if (priv === run) priv = null; if (body.isConnected) msg('Blockchain injoignable pour le moment : réessayez dans un instant.'); });
    };
    load();
  }

  function stats(box) {
    const g = el('div', 'pf-stats-grid');
    const m = el('div', 'pf-panel'); m.appendChild(el('h3', 'rk-h', t('Réussite par mois')));
    const bars = el('div', 'pf-bars');
    const fmtM = new Intl.DateTimeFormat(loc(), { month: 'short' });
    P.months.forEach((v, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); const col = el('div', 'pf-col'); const bar = el('i'); bar.style.setProperty('--h', v + '%'); col.append(el('b', 'num', Math.round(v) + '%'), bar, el('span', '', fmtM.format(d))); bars.appendChild(col); });
    m.appendChild(bars);
    const p = el('div', 'pf-panel'); p.appendChild(el('h3', 'rk-h', t(P.style === 'sport' ? 'Par ligue' : P.style === 'pol' ? 'Par pays' : 'Par paire')));
    for (const x of [...P.byPair].sort((a, b) => b.n - a.n)) { const row = el('div', 'pr-drow' + (x.rate >= 50 ? ' win' : '')); const bar = el('i'); bar.style.setProperty('--w', x.rate + '%'); row.append(el('span', '', `${t(D.subName(x.pair))} · ${num(x.n)}`), bar, el('b', 'num', Math.round(x.rate) + '%')); p.appendChild(row); }
    const d = el('div', 'pf-panel'); d.appendChild(el('h3', 'rk-h', t('Long ou short')));
    for (const x of P.dirs) { const row = el('div', 'pr-drow' + (x.rate >= 50 ? ' win' : '')); const bar = el('i'); bar.style.setProperty('--w', x.rate + '%'); row.append(el('span', '', `${x.dir} · ${num(x.n)}`), bar, el('b', 'num', Math.round(x.rate) + '%')); d.appendChild(row); }
    const s = el('div', 'pf-panel'); s.appendChild(el('h3', 'rk-h', t('Derniers calls')));
    const sp = el('div', 'pod-spark'); for (const x of P.last) sp.appendChild(el('i', x === '1' ? '' : 'l')); s.appendChild(sp);
    let streak = 0; for (let i = P.last.length - 1; i >= 0 && P.last[i] === '1'; i--) streak++;
    s.appendChild(el('p', 'pf-meta', `${t('Série en cours')} : ${streak ? '×' + num(streak) : '—'}`));
    g.append(m, s, p); if (P.dirs.length) g.appendChild(d); box.appendChild(g);
  }

  const tari = v => (v > 0 ? '+' : '') + num(v, 2) + ' TARI';
  /** Résumé d'une simulation de copie. */
  function simBlock(title, sim) {
    const b = el('div', 'pf-panel pf-sim'); b.appendChild(el('h3', 'rk-h', title));
    if (!sim.count) { b.appendChild(el('p', 'rk-empty', t('Aucun call clos sur cette période.'))); return b; }
    const g = el('dl', 'pf-simgrid');
    for (const [k, v, cls] of [['Résultat', tari(sim.pnl), sim.pnl >= 0 ? 'up' : 'dn'], ['Rendement', pct(sim.roi), sim.roi >= 0 ? 'up' : 'dn'],
      ['Gagnés / perdus', num(sim.wins) + ' / ' + num(sim.losses), ''], ['Pire recul', tari(sim.drawdown), 'dn']]) {
      const d = el('div'); d.append(el('dt', '', t(k)), el('dd', 'num ' + cls, v)); g.appendChild(d);
    }
    b.appendChild(g);
    b.appendChild(el('small', '', t('{n} calls clos, dont {x} jamais ouverts (remboursés).').replace('{n}', num(sim.count)).replace('{x}', num(sim.never))));
    return b;
  }
  function talkPanel(box) {
    if (!window.sdSocial) return;
    box.appendChild(window.sdSocial.discussionBox(location.origin + '/' + link(P.name), shareText()));
  }
  function copyPanel(box) {
    const cur = D.copy.get(P.name);
    const form = el('form', 'pf-panel pf-copyform'); form.noValidate = true;
    form.appendChild(el('h3', 'rk-h', t('Copier {name}').replace('{name}', P.name)));
    form.appendChild(el('p', 'pf-note', t("Copie suivie, sans exécution : vous recevez une alerte à chaque call, et le site calcule ce qu'aurait donné chaque call avec le montant choisi. Aucun ordre n'est passé, aucune clé d'exchange n'est demandée.")));
    const lab = el('label', 'pf-amount'); lab.appendChild(el('span', '', t('Montant par call (TARI)')));
    const inp = el('input'); inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.value = cur ? String(cur.size) : '10'; lab.appendChild(inp);
    const go = el('button', 'btn-sm', t(cur ? 'Mettre à jour' : 'Copier ce caller')); go.type = 'submit';
    const row = el('div', 'pf-copyrow'); row.append(lab, go);
    if (cur) { const stop = el('button', 'btn-sm danger', t('Arrêter la copie')); stop.type = 'button'; stop.addEventListener('click', () => { D.copy.stop(P.name); say('Copie arrêtée.'); head(); panel(); }); row.appendChild(stop); }
    form.appendChild(row);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = +inp.value.replace(',', '.');
      if (!D.copy.set(P.name, v)) return say('Montant invalide.');
      say('Copie activée : alertes à chaque call.'); head(); panel();
    });
    box.appendChild(form);
    const size = cur ? cur.size : (+inp.value.replace(',', '.') || 10);
    box.appendChild(simBlock(t('Sur ses 30 derniers calls'), D.copySim(P, size)));
    if (cur) box.appendChild(simBlock(t('Depuis le début de votre copie'), D.copySim(P, cur.size, 1000, (Date.now() - cur.since) / 86400000)));
  }

  function follows(box) {
    const copied = D.copy.list().filter(n => D.byName(n));
    if (copied.length) {
      const cp = el('div', 'pf-panel'); cp.appendChild(el('h3', 'rk-h', t('Mes copies')));
      for (const n of copied) {
        const c = D.copy.get(n), p = D.profile(D.byName(n)), since = D.copySim(p, c.size, 1000, (Date.now() - c.since) / 86400000), last = D.copySim(p, c.size);
        const r = el('div', 'pf-frow'); const av = el('span', 'av'); av.appendChild(D.avatar(n));
        const txt = el('div'); const a = el('a', 'rk-wname', n); a.href = link(n);
        txt.append(a, el('small', '', t('{s} TARI par call · depuis le début : {a} · 30 derniers calls : {b}').replace('{s}', num(c.size, 2)).replace('{a}', tari(since.pnl)).replace('{b}', tari(last.pnl))));
        const edit = el('a', 'btn-sm', t('Gérer')); edit.href = link(n);
        r.append(av, txt, edit); cp.appendChild(r);
      }
      box.appendChild(cp);
    }
    const names = D.follow.list().filter(n => D.byName(n));
    const ch = el('div', 'pf-panel pf-channels'); ch.appendChild(el('h3', 'rk-h', t('Où recevoir les notifications')));
    for (const [name, status, on] of [['Sur ce site', "Onglet Activité, dès l'ouverture de la page", true], ['Bluesky', 'Le bot Signal Desk publiera chaque call scellé et chaque ouverture', false], ['Telegram', 'Ensuite', false]]) {
      const r = el('div', 'pf-chan'); r.append(el('b', '', t(name)), el('span', '', t(status)), el('em', on ? 'on' : '', t(on ? 'Actif' : 'Bientôt'))); ch.appendChild(r);
    }
    box.appendChild(ch);
    if (!names.length) { const e = el('div', 'empty'); e.append(el('p', '', t('Vous ne suivez encore personne.'))); const a = el('a', 'lnk', t('Voir le classement')); a.href = 'classement.html'; e.appendChild(a); box.appendChild(e); return; }
    const list = el('div', 'pf-follows');
    for (const n of names) {
      const c = D.profile(D.byName(n)), live = c.calls.find(x => x.res === 'live');
      const row = el('div', 'pf-frow'); const av = el('span', 'av'); av.appendChild(D.avatar(n));
      const txt = el('div'); const a = el('a', 'rk-wname', n); a.href = link(n); txt.append(a, el('small', '', `${pct(c.rate)} · ${live ? t('call scellé, ouverture dans {x}').replace('{x}', dur(live.left)) : t('pas de call en cours')}`));
      const bell = el('button', 'ico pf-bell'); bell.type = 'button'; bell.innerHTML = BELL; bell.setAttribute('aria-pressed', String(D.follow.bell(n))); bell.setAttribute('aria-label', `${t('Notifications de ses calls')} : ${n}`);
      bell.addEventListener('click', () => { const on = D.follow.toggleBell(n); bell.setAttribute('aria-pressed', String(on)); say(on ? 'Notifications activées.' : 'Notifications coupées.'); });
      const un = el('button', 'btn-sm', t('Ne plus suivre')); un.type = 'button'; un.addEventListener('click', () => { D.follow.toggle(n); render(); });
      row.append(av, txt, bell, un); list.appendChild(row);
    }
    box.appendChild(list);
  }

  function activity(box) {
    const names = D.follow.list().filter(n => D.byName(n) && D.follow.bell(n));
    const items = [];
    for (const n of names) {
      const c = D.profile(D.byName(n));
      c.calls.slice(0, 4).forEach(x => items.push({ n, x, when: x.res === 'live' ? 0.1 + (x.left % 7200) / 86400 : x.ago }));
    }
    items.sort((a, b) => a.when - b.when);
    if (!items.length) { const e = el('div', 'empty'); e.append(el('p', '', t(D.follow.list().length ? 'Activez la cloche d\'un caller pour suivre ses calls ici.' : 'Suivez des callers pour voir leurs calls ici.'))); const a = el('a', 'lnk', t('Voir le classement')); a.href = 'classement.html'; e.appendChild(a); box.appendChild(e); return; }
    const feed = el('ol', 'pf-feed');
    for (const { n, x, when } of items.slice(0, 30)) {
      const li = el('li', 'pf-item ' + x.res); const av = el('span', 'av'); av.appendChild(D.avatar(n));
      const txt = el('div'); const a = el('a', 'rk-wname', n); a.href = link(n);
      const what = x.res === 'live' ? t('a scellé le call #{n} · {pair}, ouverture dans {x}').replace('{x}', dur(x.left)).replace('{pair}', D.what(x)) : t('call #{n} ouvert · {pair} : {res}').replace('{res}', D.resName(x)).replace('{pair}', D.callText(x));
      txt.append(a, el('span', '', ' ' + what.replace('{n}', num(x.n))));
      li.append(av, txt, el('time', '', ago(when))); feed.appendChild(li);
    }
    box.appendChild(feed);
  }

  const toast = $('toast'); let tt = 0;
  const say = k => { toast.textContent = t(k); toast.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toast.classList.remove('show'), 3200); };
  $('pf-connect').addEventListener('click', () => window.sdOpenProfile && window.sdOpenProfile());
  // Section « Mon compte » (identité, adresse, Bluesky, Mon desk) : mon profil, wallet connecté.
  const account = () => {}; // « Mon compte » est une fenêtre flottante (wallet.js)
  // Le wallet peut s'être reconnecté avant le chargement de ce script : on lit aussi l'état présent.
  addEventListener('sd:me', account); account();
  addEventListener('sd:me', () => {
    if (mine) return render();
    // Wallet reconnu après le chargement : mon desk ouvert par son lien public bascule sur ma vue.
    const w = window.sdWallet, c = D.byName(String(asked).toLowerCase());
    if (w && w.account() && c && c.payout === w.account() && c.publisher === w.key()) location.replace('profil.html');
  });
  addEventListener('sd:bluesky', () => { if (P && P.isMe) head(); });
  // Mon profil : changement de compte (data.js relit ses abonnements) = tout redessiner pour le compte actif.
  addEventListener('sd:follow', () => { if (mine) return render(); if (P) { head(); if (state.tab === 'follows' || state.tab === 'activity') panel(); } });

  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); };
  render();
});
