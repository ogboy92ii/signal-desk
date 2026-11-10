// Barre de commande (navigation N1) : recherche, menu Créer, notifications, compteurs.
// Données : SD_DATA (desks réels lus sur la chaîne, après SD_READY). Rien n'est envoyé : la recherche
// et les notifications se calculent dans le navigateur.
(() => {
  const $ = id => document.getElementById(id);
  if (!$('cmd-q')) return;
  const t = k => (window.sdT ? window.sdT(k) : k);
  const D = () => window.SD_DATA;
  const loc = () => document.documentElement.lang || 'fr-FR';
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const home = /site-signal-desk\.html$|\/$/.test(location.pathname) ? '' : 'site-signal-desk.html';
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---- Menus déroulants : un seul ouvert à la fois, Échap et clic extérieur ferment ----
  const pops = [['cmd-cbtn', 'cmd-menu'], ['cmd-bell', 'cmd-panel']];
  function close(except) {
    for (const [b, p] of pops) if (b !== except) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
    if (except !== 'search') hideRes();
  }
  for (const [b, p] of pops) $(b).addEventListener('click', e => {
    e.stopPropagation(); const open = $(p).hidden; close(b); $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open));
    if (open && b === 'cmd-bell') seen();
    if (open && b === 'cmd-cbtn') { const f = $(p).querySelector('a'); if (f) f.focus(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.cmd-create,.cmd-notif,.cmd-search')) close(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); close('search'); $('cmd-q').focus(); $('cmd-q').select(); }
    else if (e.key === 'Escape') { const was = document.activeElement; close(); if (was && was.closest && was.closest('.cmd-menu,.cmd-panel')) was.closest('.cmd-create,.cmd-notif').querySelector('button').focus(); }
  });
  $('cmd-menu').addEventListener('keydown', e => {
    const items = [...$('cmd-menu').querySelectorAll('a')], i = items.indexOf(document.activeElement);
    const n = { ArrowDown: i + 1, ArrowUp: i - 1 }[e.key]; if (n === undefined) return; e.preventDefault(); items[(n + items.length) % items.length].focus();
  });

  // ---- Recherche : callers, paires, pages ----
  const PAGES = () => [
    ['Classement', 'classement.html', '#'], ['Pronostics', 'pronostics.html', '◎'], ['Ligues', 'ligues.html', '♛'],
    ['En direct', 'en-direct.html', '●'], ['Mon profil', 'profil.html', '☺'], ['Comment ça marche', home + '#comment', '?'],
    ['Vérifier un call', home + '#verifier', '✓'], ['FAQ', home + '#faq', '?'],
    // 10/11 : la communauté et les calls par catégorie (sortis de la barre du haut) restent à un mot de la recherche.
    ['Communauté', 'communaute.html', '☷'], ['Crypto', 'marches.html?c=crypto', '◆'], ['Sport', 'marches.html?c=sport', '◆'],
    ['Finance / Politique', 'marches.html?c=pol', '◆'], ['Libre', 'marches.html?c=free', '◆'],
  ];
  const PAIRS = ['BTC', 'ETH', 'SOL', 'XTM', 'BNB'];
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let sel = -1;
  // Lues une seule fois, à la première recherche ; la liste se complète dès que la chaîne a répondu.
  let fcQs = null;
  function loadQs() {
    if (fcQs) return; fcQs = [];
    const C = window.sdChain, net = (D() && D().network) || 'esmeralda';
    if (!C || !C.forecastsLive || !C.forecastsLive(net)) return;
    Promise.all([C.readBoard(net), C.currentEpoch(net)]).then(([b, ep]) => {
      fcQs = (b ? b.questions : []).filter(x => ep < x.close && x.meta && typeof x.meta.q === 'string').map(x => ({ id: x.id, q: x.meta.q }));
      if ($('cmd-q').value.trim()) search();
    }).catch(() => {});
  }
  function hideRes() { $('cmd-res').hidden = true; $('cmd-q').setAttribute('aria-expanded', 'false'); sel = -1; }
  function search() {
    const q = norm($('cmd-q').value.trim()), box = $('cmd-res'); box.replaceChildren(); sel = -1;
    if (!q) return hideRes();
    const groups = [];
    const data = D();
    if (data) {
      const callers = data.period('all').filter(c => norm(c.name).includes(q) || norm(c.display).includes(q)).sort((a, b) => b.rate - a.rate).slice(0, 6);
      if (callers.length) groups.push([t('Callers'), callers.map(c => { const a = el('a'); a.href = 'profil.html?c=' + encodeURIComponent(c.name);
        const av = el('span', 'av'); av.appendChild(data.avatar(c.name)); a.append(av, el('span', '', c.display), el('small', '', c.closed ? num(c.rate, 1) + ' %' : '—')); return a; })]);
    }
    const pairs = PAIRS.filter(p => norm(p + 'usdt').includes(q) || norm(p).includes(q));
    if (pairs.length) groups.push([t('Paires'), pairs.map(p => { const a = el('a'); a.href = 'en-direct.html?pair=' + p; a.append(el('i', '', p.slice(0, 1)), el('span', '', p + 'USDT'), el('small', '', t('En direct'))); return a; })]);
    // Questions de pronostics ouvertes (10/11) : on cherche un marché comme on cherche un caller.
    loadQs();
    const found = (fcQs || []).filter(x => norm(x.q).includes(q)).slice(0, 5);
    if (found.length) groups.push([t('Pronostics'), found.map(x => { const a = el('a'); a.href = 'pronostics.html#q-b' + x.id; a.append(el('i', '', '◎'), el('span', '', window.sdQ ? window.sdQ(x.q).title : x.q), el('small', '', t('Répondre'))); return a; })]);
    const league = $('cmd-q').value.match(/component_[0-9a-f]{64}/);
    if (league) groups.push([t('Ligues'), [(() => { const a = el('a'); a.href = 'ligues.html?ligue=' + league[0]; a.append(el('i', '', '♛'), el('span', '', t('Ouvrir la ligue')), el('small', '', league[0].slice(10, 16) + '…')); return a; })()]]);
    const pages = PAGES().filter(([n]) => norm(t(n)).includes(q) || norm(n).includes(q));
    if (pages.length) groups.push([t('Pages'), pages.map(([n, href, ic]) => { const a = el('a'); a.href = href; a.append(el('i', '', ic), el('span', '', t(n)), el('small', '')); return a; })]);
    if (!groups.length) box.appendChild(el('p', 'none', t('Aucun résultat.')));
    for (const [title, links] of groups) { box.appendChild(el('h3', '', title)); links.forEach(a => { a.setAttribute('role', 'option'); a.id = 'cmd-o' + box.querySelectorAll('a').length; box.appendChild(a); }); }
    box.hidden = false; $('cmd-q').setAttribute('aria-expanded', 'true');
  }
  function move(d) {
    const items = [...$('cmd-res').querySelectorAll('a')]; if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    items.forEach((a, i) => a.setAttribute('aria-selected', String(i === sel)));
    $('cmd-q').setAttribute('aria-activedescendant', items[sel].id); items[sel].scrollIntoView({ block: 'nearest' });
  }
  $('cmd-q').addEventListener('input', search);
  $('cmd-q').addEventListener('focus', () => { if ($('cmd-q').value.trim()) search(); });
  $('cmd-q').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { const items = [...$('cmd-res').querySelectorAll('a')]; const a = items[sel < 0 ? 0 : sel]; if (a) { e.preventDefault(); location.href = a.getAttribute('href'); } }
    else if (e.key === 'Escape') { $('cmd-q').value = ''; hideRes(); $('cmd-q').blur(); }
  });

  // ---- Notifications : calls des callers suivis avec cloche active ----
  const SEEN = 'sd-notif-seen';
  function events() {
    const data = D(); if (!data) return [];
    const out = [];
    for (const n of data.follow.list().filter(x => data.follow.bell(x) && data.byName(x))) {
      const p = data.profile(data.byName(n));
      p.calls.slice(0, 3).forEach(x => out.push({ n, x, days: x.res === 'live' ? Math.max(0, (Date.now() - x.sealedAt) / 86400000) : x.ago }));
    }
    return out.sort((a, b) => a.days - b.days).slice(0, 12);
  }
  function ago(d) { const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto', style: 'short' }); return d < 1 ? rtf.format(-Math.max(1, Math.round(d * 24)), 'hour') : rtf.format(-Math.round(d), 'day'); }
  function renderNotif() {
    const list = events(), since = +(store.get(SEEN) || 0), feed = $('cmd-feed'); feed.replaceChildren();
    const fresh = e => Date.now() - e.days * 86400000 > since;
    const unseen = list.filter(fresh).length;
    $('cmd-cnt').hidden = !unseen; $('cmd-cnt').textContent = unseen > 9 ? '9+' : String(unseen);
    $('cmd-bell').setAttribute('aria-label', unseen ? t('Notifications') + ' (' + unseen + ')' : t('Notifications'));
    // P4 (09/11) : actions qui attendent ce compte (portfolio.js, sd:alerts), toujours en tête et comptées comme nouvelles.
    const A = window.sdAlerts || {}, todo = [];
    if (A.dispute) todo.push(window.sdPl(A.dispute, '{n} livraison invalide à contester', '{n} livraisons invalides à contester').replace('{n}', num(A.dispute)));
    if (A.deliver) todo.push(window.sdPl(A.deliver, '{n} acheteur attend son call : livrez-le', '{n} acheteurs attendent leur call : livrez-les').replace('{n}', num(A.deliver)));
    if (A.refund) todo.push(window.sdPl(A.refund, '{n} remboursement à récupérer', '{n} remboursements à récupérer').replace('{n}', num(A.refund)));
    for (const msg of todo) {
      const li = el('li', 'new act'), b = el('button', '', msg); b.type = 'button';
      b.addEventListener('click', () => { close(); if (window.sdOpenDrawer) window.sdOpenDrawer(); });
      li.appendChild(b); feed.appendChild(li);
    }
    if (todo.length) { const n = unseen + todo.length; $('cmd-cnt').hidden = false; $('cmd-cnt').textContent = n > 9 ? '9+' : String(n); }
    if (!list.length) { if (!todo.length) feed.appendChild(el('li', 'none', t('Suivez des callers et activez leur cloche pour recevoir leurs calls ici.'))); return; }
    for (const ev of list) {
      // P6 (09/11) : un call encore en vente ouvre directement la fenêtre d'achat (mêmes vérifications, signature dans Sapient).
      const buy = ev.x.res === 'live' && ev.x.phase === 'on-sale' && ev.x.desk;
      const li = el('li', fresh(ev) ? 'new' : ''), a = el('a'); a.href = buy ? 'profil.html?c=' + encodeURIComponent(ev.n) + '&achat=' + ev.x.desk + '&n=' + ev.x.seq + '&r=' + D().network
        : 'profil.html?c=' + encodeURIComponent(ev.n) + (ev.x.res === 'live' ? '' : '&call=' + ev.x.n);
      const av = el('span', 'av'); av.appendChild(D().avatar(ev.n));
      const txt = el('span'); txt.append(el('b', '', (D().byName(ev.n) || {}).display || ev.n), document.createTextNode(' ' + (ev.x.res === 'live'
        ? t(buy ? 'a scellé un call {pair} : acheter' : 'a scellé un call {pair}').replace('{pair}', D().what(ev.x))
        : t('call {pair} ouvert : {res}').replace('{pair}', D().callText(ev.x)).replace('{res}', D().resName(ev.x)))), el('time', '', ago(ev.days)));
      a.append(av, txt); li.appendChild(a); feed.appendChild(li);
    }
  }
  function seen() { store.set(SEEN, String(Date.now())); setTimeout(renderNotif, 1200); }

  // ---- Compteurs des catégories ----
  function counts() {
    const data = D(); if (!data) return;
    let live = 0; for (const c of data.base) live += data.profile(c).calls.filter(x => x.res === 'live').length;
    const lc = document.querySelector('[data-cnt="live"]'); if (lc) lc.textContent = num(live);
  }

  addEventListener('sd:follow', renderNotif);
  addEventListener('sd:alerts', renderNotif);
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); renderNotif(); counts(); if (!$('cmd-res').hidden) search(); };
  renderNotif(); counts();
  // Les desks réels arrivent après la lecture de la chaîne (data.js) : compteurs et notifications recalculés.
  if (window.SD_READY) window.SD_READY.then(() => { renderNotif(); counts(); });
})();

// Toast au premier plan : une fenêtre <dialog> ouverte (Mon compte, Vérifier avant de signer) passe au-dessus de
// tout le reste et cachait les messages d'erreur. Quand le toast s'affiche pendant qu'une fenêtre est ouverte,
// il passe lui aussi au premier plan (popover), au-dessus d'elle.
(() => {
  const toast = document.getElementById('toast');
  if (!toast || !('showPopover' in toast)) return;
  toast.popover = 'manual';
  new MutationObserver(() => {
    const on = toast.classList.contains('show'), open = toast.matches(':popover-open');
    if (on && !open && document.querySelector('dialog[open]')) toast.showPopover();
    else if (!on && open) toast.hidePopover();
  }).observe(toast, { attributes: true, attributeFilter: ['class'] });
})();
