// Pages Pronostics et Ligues : questions et résultats lus sur la blockchain (tableaux SignalForecasts),
// filtres, scellement, ligues. Aucune donnée d'exemple : sans question réelle, un état vide.
(() => {
  const $ = id => document.getElementById(id);
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loc = () => document.documentElement.lang || 'fr-FR';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const num = (v, d = 0) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const pct = v => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: 0 }).format(v / 100);
  const toast = $('toast'); let toastTimer = 0;
  const say = k => { toast.textContent = t(k); toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3200); };

  const TYPES = { number: 'Nombre', price: 'Prix', yesno: 'Oui ou non', choice: 'Choix multiple', range: 'Fourchette', updown: 'Hausse ou baisse' };
  function left(iso) {
    const s = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 1000));
    if (!s) return t('Clos');
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    const u = (v, unit) => new Intl.NumberFormat(loc(), { style: 'unit', unit, unitDisplay: 'narrow' }).format(v).replace(/(d)(?=[^ds.,])/, '$1 ');
    return t('ferme dans {x}').replace('{x}', d ? `${u(d, 'day')} ${u(h, 'hour')}` : h ? `${u(h, 'hour')} ${u(m, 'minute')}` : u(m, 'minute'));
  }

  // Une rangée de boutons à choix unique (motif radio).
  function choices(p, opts, labels) {
    const g = el('div', 'pr-opts'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', t('Votre réponse'));
    opts.forEach((v, i) => {
      const b = el('button', 'pr-opt', window.sdOpt(labels ? t(labels[i]) : v)); b.type = 'button'; b.dataset.v = v; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false'); b.tabIndex = i === 0 ? 0 : -1;
      if (p.type === 'updown' || p.type === 'yesno') b.classList.add(i ? 'dn' : 'up');
      g.appendChild(b);
    });
    g.addEventListener('click', e => { const b = e.target.closest('.pr-opt'); if (b) pickOpt(g, b); });
    g.addEventListener('keydown', e => {
      const all = [...g.children], i = all.indexOf(document.activeElement); if (i < 0) return;
      const k = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1 }[e.key]; if (k === undefined) return;
      e.preventDefault(); const n = all[(k + all.length) % all.length]; pickOpt(g, n); n.focus();
    });
    return g;
  }
  function pickOpt(g, b) { [...g.children].forEach(x => { const on = x === b; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }); }

  function card(p) {
    const c = el('article', 'pr-card'); c.dataset.type = p.type;
    // Visuel : l'image de la ligue (galerie du site), sinon celle des pronostics ; temps restant avant la clôture.
    // 10/11 : sujet reconnu (crypto, match, politique) = fond de sa catégorie + pastilles du sujet (lang.js sdSubject).
    const sj = window.sdSubject && window.sdSubject(p.q, p.opts);
    const im = sj ? sj.cat : live && IMGS.includes(live.board.image) ? live.board.image : 'prono';
    const vis = el('div', 'pr-vis' + (sj ? ' ' + sj.cat : '')); vis.style.setProperty('--img', `url(img/${im}-m.webp)`); vis.setAttribute('aria-hidden', 'true');
    if (sj) vis.appendChild(window.sdSubjectEl(p.q, p.opts));
    const leftDays = Math.max(0, (Date.parse(p.close) - Date.now()) / 86400000);
    const bar = el('i', 'pr-time'); bar.style.setProperty('--t', Math.max(4, Math.min(100, 100 - leftDays / 30 * 100)) + '%'); vis.appendChild(bar);
    c.appendChild(vis);
    const head = el('div', 'pr-head');
    head.append(el('span', 'pr-type', t(TYPES[p.type])), el('span', 'pr-left', left(p.close)));
    // 10/11 : titre court + règle de résolution à part (lang.js sdQ), comme sur un marché de prédiction.
    const Q = window.sdQ(t(p.q)), q = el('h3', 'pr-q', Q.title); q.id = 'q-' + p.id;
    const rule = Q.rule ? el('p', 'pr-rule') : null; if (rule) rule.append(el('i', '', t('Résolution')), document.createTextNode(Q.rule));
    const form = el('form', 'pr-form'); form.noValidate = true; form.setAttribute('aria-labelledby', q.id);
    if (p.type === 'number' || p.type === 'price') {
      const wrap = el('label', 'pr-num'); const sr = el('span', 'sr', t('Votre réponse'));
      const inp = el('input'); inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.maxLength = 12; inp.placeholder = t('Votre réponse'); 
      wrap.append(sr, inp); if (p.unit) wrap.appendChild(el('span', 'pr-unit', p.unit)); form.appendChild(wrap);
    } else if (p.type === 'yesno') form.appendChild(choices(p, ['oui', 'non'], ['Oui', 'Non']));
    else if (p.type === 'updown') form.appendChild(choices(p, ['hausse', 'baisse'], ['▲ Hausse', '▼ Baisse']));
    else form.appendChild(choices(p, p.opts, p.opts));
    const go = el('button', 'btn-sm pr-go', t('Sceller ma réponse')); go.type = 'submit'; form.appendChild(go);
    form.addEventListener('submit', e => {
      e.preventDefault();
      let v;
      if (p.type === 'number' || p.type === 'price') {
        const raw = form.querySelector('input').value.replace(/[\s  ]/g, '').replace(',', '.');
        if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw) || +raw > p.max) return say('Entrez un nombre valide.');
        v = raw;
      } else {
        const b = form.querySelector('[aria-checked="true"]'); if (!b) return say('Choisissez une réponse.');
        v = b.dataset.v;
      }
      sealLive(p, v, go);
    });
    const foot = el('div', 'pr-foot'); foot.append(el('span', '', p.n ? `${num(p.n)} ${t(p.n > 1 ? 'pronostics scellés' : 'pronostic scellé')}` : t('Soyez le premier à sceller')));
    // Déjà scellé par le compte connecté (lu sur la chaîne) : plus de formulaire, sa réponse s'il l'a dans ce navigateur.
    if (p.chainId !== undefined && myKey && p.q_ && p.q_.forecasts.some(f => f.key === myKey)) {
      const s = live && mineOf(live.board.address).find(x => x.question === p.chainId);
      const LBL = { oui: 'Oui', non: 'Non', hausse: '▲ Hausse', baisse: '▼ Baisse' };
      const done = el('div', 'pr-done'); done.append(el('b', '', t('Scellé')));
      done.appendChild(el('span', '', s ? `${t('Votre réponse')} : ${LBL[s.answer] ? t(LBL[s.answer]) : s.answer}` : t("Scellés, numérotés, impossibles à cacher. Le sujet est public, le pronostic reste secret jusqu'à l'ouverture.")));
      c.append(head, q, ...(rule ? [rule] : []), done, foot);
      return c;
    }
    c.append(head, q, ...(rule ? [rule] : []), form, foot);
    return c;
  }

  function result(r) {
    const c = el('article', 'pr-card pr-done'); c.dataset.type = r.type; c.dataset.go = 'classement.html#prono';
    const head = el('div', 'pr-head'); head.append(el('span', 'pr-type', t(TYPES[r.type])), el('span', 'pr-left', t('Ouvert')));
    const ans = el('p', 'pr-ans'); ans.append(el('span', '', t('Résultat')), el('b', 'num', r.key ? window.sdOpt(t(r.key)) : num(r.value)));
    c.append(head, el('h3', 'pr-q', window.sdQ(t(r.q)).title), ans);
    if (r.best) c.appendChild(el('p', 'pr-best', t('Meilleure réponse : {who} ({v})').replace('{who}', r.best).replace('{v}', num(r.bestValue))));
    if (r.dist) {
      const d = el('div', 'pr-dist');
      for (const [k, v] of r.dist) { const row = el('div', 'pr-drow' + (k === r.key ? ' win' : '')); const bar = el('i'); bar.style.setProperty('--w', v + '%'); row.append(el('span', '', window.sdOpt(t(k))), bar, el('b', 'num', pct(v))); d.appendChild(row); }
      c.appendChild(d);
    }
    const foot = el('div', 'pr-foot'); foot.appendChild(el('span', '', `${num(r.n)} ${t(r.n > 1 ? 'pronostics scellés' : 'pronostic scellé')}`)); c.appendChild(foot);
    return c;
  }

  // ---- Tableau on-chain (SignalForecasts) : remplace les exemples dès qu'une adresse est configurée ----
  const C = () => window.sdChain, W = () => window.sdWallet;
  const netName = () => (W() && W().network()) || (C() && C().view) || 'mainnet';
  const EP = () => (C() && C().epochMs ? C().epochMs(netName()) : 3600e3); // 11/11 : époque ≈ 20 min sur mainnet, ≈ 1 h sur esmeralda
  let live = null; // { board, epoch, open, results, mine }
  // Ligue : ?ligue=<adresse du tableau>. Sans paramètre : le tableau public de Signal Desk.
  const PAGE_LG = document.body.classList.contains('page-lg');
  const LEAGUE = (() => { const v = new URLSearchParams(location.search).get('ligue') || ''; return /^component_[0-9a-f]{64}$/.test(v) ? v : ''; })();
  let myKey = null;
  // Une entrée par compte (clé du wallet) : deux comptes du même navigateur ne s'écrasent plus sur une même question.
  const SKEY = (b, q, k) => 'sd-fc-' + b.slice(10, 26) + '-' + q + '-' + String(k).slice(0, 16);
  const mineOf = b => { const out = []; let keys = []; try { keys = Object.keys(localStorage).filter(k => k.startsWith('sd-fc-' + b.slice(10, 26) + '-')); } catch (e) {} for (const k of keys) { try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.kind === 'forecast' && myKey && v.key === myKey) out.push(v); } catch (e) {} } return out; }; // audit K4 : une entrée corrompue n'arrête plus les autres
  // Heure de clôture d'une question : l'époque de la chaîne fait foi (≈ 1 h par époque) ; la date `close_utc` de
  // l'organisateur n'est retenue que si elle s'en écarte de moins de 2 h (audit S5 : sinon fausse clôture affichée).
  const closeMs = (q, ep) => { const est = Date.now() + (q.close - ep) * EP(), u = Date.parse(q.meta && q.meta.close_utc); return Number.isFinite(u) && Math.abs(u - est) <= 2 * 3600e3 ? u : est; };
  // Deux lectures simultanées n'en font qu'une (audit K3).
  // Une demande arrivée pendant une lecture en provoque une seconde à la fin (après une transaction, l'état est neuf).
  let liveRun = null, liveAgain = false;
  const loadLive = () => {
    if (liveRun) { liveAgain = true; return liveRun; }
    liveRun = loadLive0().finally(() => { liveRun = null; if (liveAgain) { liveAgain = false; loadLive(); } });
    return liveRun;
  };
  async function loadLive0() {
    const net = netName();
    if (!C() || !(LEAGUE ? C().leaguesLive(net) : C().forecastsLive(net))) { leagues(); return; }
    try {
      const [b, epoch] = await Promise.all([C().readBoard(net, LEAGUE || undefined), C().currentEpoch(net)]);
      if (W() && W().account() && !myKey) myKey = await C().whoami(net, b.address).catch(() => null);
      // Autre appareil ou navigateur vidé : mes pronostics de ce tableau, retrouvés dans le wallet (sans demande).
      if (W() && W().account()) {
        const saved = await C().privateForecasts(net, false).catch(() => null);
        (saved || []).filter(s => s.board === b.address).forEach(s => { try { if (!localStorage.getItem(SKEY(s.board, s.question, s.key))) localStorage.setItem(SKEY(s.board, s.question, s.key), JSON.stringify(s)); } catch (e) {} });
      }
      const item = q => ({ id: 'b' + q.id, chainId: q.id, type: TYPES[q.meta.type] ? q.meta.type : 'number', q: q.meta.q, opts: Array.isArray(q.meta.opts) ? q.meta.opts.filter(x => typeof x === 'string').slice(0, 8) : undefined,
        unit: typeof q.meta.unit === 'string' ? q.meta.unit.slice(0, 8) : undefined, max: +q.meta.max || 1e9, close: new Date(Math.max(Date.now(), closeMs(q, epoch))).toISOString(), n: q.forecasts.length, q_: q });
      const open = b.questions.filter(q => epoch < q.close).map(item);
      const results = b.questions.filter(q => q.outcome !== null).map(q => {
        const shown = q.forecasts.filter(f => f.answer !== null), dist = new Map();
        shown.forEach(f => { dist.set(f.answer, (dist.get(f.answer) || 0) + 1); });
        return { type: TYPES[q.meta.type] ? q.meta.type : 'number', q: q.meta.q, key: q.outcome, n: q.forecasts.length,
          dist: ['yesno', 'choice', 'range', 'updown'].includes(q.meta.type) && shown.length ? [...dist].map(([k, v]) => [k, Math.round(v * 100 / shown.length)]) : undefined,
          value: isFinite(+q.outcome) ? +q.outcome : undefined };
      });
      live = { board: b, epoch, open, results, net };
      // Nom : en v2 il vient de la chaîne seule ; en v1 le lien (&nom=) ne remplit qu'un nom encore vide (audit S7 : un lien piégé renommait la ligue).
      if (LEAGUE) { const had = myLeagues().find(x => x.a === LEAGUE); addLeague(LEAGUE, !!myKey && b.organizer === myKey, IMGP, !b.v2 && NAMEP && !(had && had.n) ? NAMEP : undefined); }
      render(); leagues();
    } catch (e) { console.warn('[signal-desk] pronostics', e && e.message); leagues(); const hs = document.querySelector('p.status'); if (hs && hs.lastChild) hs.lastChild.nodeValue = t('Blockchain injoignable pour le moment : réessayez dans un instant.'); } // audit K12
  }
  // Mes pronostics clos et pas encore ouverts : un bouton les ouvre (une transaction chacun).
  let revealing = false;
  function revealable() {
    if (!live) return [];
    return mineOf(live.board.address).map(s => {
      const q = live.board.questions.find(x => x.id === s.question), f = q && q.forecasts.find(x => x.key === s.key);
      return q && f && !f.revealed && live.epoch >= q.close && live.epoch < q.until ? { s, index: f.index } : null;
    }).filter(Boolean);
  }
  // Audit K11 : stockage plein = aucune transaction partie ; le dire au lieu de « refusée par le réseau ».
  const storageFull = e => !!e && (e.name === 'QuotaExceededError' || /storage/i.test(e.message || ''));
  async function sealLive(p, v, go) {
    if (!W() || !W().account()) return say('Connectez votre wallet pour sceller.');
    // Audit S8 : refuser AVANT toute signature ce que le contrat refuserait (la sauvegarde payante partait pour rien),
    // et juger le doublon sur la chaîne (un essai refusé ne bloque plus le suivant).
    const b = live.board, q = b.questions.find(x => x.id === p.chainId);
    if (myKey && b.blocked.includes(myKey)) return say("L'organisateur a bloqué votre clé dans cette ligue.");
    if (myKey && !b.open && myKey !== b.organizer && !b.members.includes(myKey)) return say("Ligue fermée : envoyez votre adresse Tari à l'organisateur pour qu'il vous ajoute.");
    if (myKey && q && q.forecasts.some(f => f.key === myKey)) return say('Vous avez déjà scellé ce pronostic.');
    // R2 (09/11) : le verrou drand ne tient pas sur un horizon trop long ; on répond à moins de N époques de la clôture.
    if (q && C().tlockMaxHorizon && q.close - live.epoch > C().tlockMaxHorizon(q.until - q.close)) {
      const from = new Date(C().epochStart(live.net, q.close - C().tlockMaxHorizon(q.until - q.close), live.epoch));
      return say(t('Réponses ouvertes à partir du {d}.').replace('{d}', new Intl.DateTimeFormat(loc(), { dateStyle: 'long' }).format(from)));
    }
    go.disabled = true;
    let kept = null;
    try {
      // Une signature : la réponse reste dans ce navigateur, et sa copie verrouillée part avec le scellement (A4).
      await C().sealForecast(live.net, p.chainId, v, s => {
        kept = SKEY(s.board, s.question, s.key); localStorage.setItem(kept, JSON.stringify(s));
      }, undefined, LEAGUE || undefined);
      say('Pronostic scellé. Il s’ouvrira tout seul après la clôture.'); loadLive();
    } catch (e) {
      // Échec : le brouillon local ne doit pas faire croire à un pronostic scellé.
      if (kept) try { localStorage.removeItem(kept); } catch (x) {}
      say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : storageFull(e) ? 'Espace du navigateur plein : libérez de la place puis réessayez.' : 'Transaction refusée par le réseau.');
    }
    finally { go.disabled = false; }
  }

  const short = k => k.slice(0, 6) + '…' + k.slice(-4);
  const pctg = v => new Intl.NumberFormat(loc(), { style: 'percent', maximumFractionDigits: 1 }).format(v);
  // Mes ligues : liste locale (ce navigateur) des ligues créées ou ouvertes, affichée à part des ligues publiques.
  // Une liste par compte connecté (sinon les ligues d'un compte s'affichaient sous un autre).
  const MYL = () => 'sd-my-leagues' + (W() && W().account() ? '-' + W().account().slice(10, 26) : '');
  const myLeagues = () => { try { const v = JSON.parse(localStorage.getItem(MYL()) || '[]'); return Array.isArray(v) ? v.filter(x => x && /^component_[0-9a-f]{64}$/.test(x.a)) : []; } catch (e) { return []; } };
  // Image de la ligue : choisie par l'organisateur dans la galerie du site, transmise par le lien d'invitation (&img=).
  // Le contrat ne stocke ni nom ni image ; seules ces valeurs sont acceptées (CSS .lgi-*, images du site).
  const IMGS = ['league', 'crypto', 'sport', 'pol', 'prono', 'rank', 'live'];
  const IMG_NAMES = { league: 'Ligues', crypto: 'Crypto', sport: 'Sport', pol: 'Politique', prono: 'Pronostics', rank: 'Classement', live: 'En direct' };
  const IMGP = (() => { const v = new URLSearchParams(location.search).get('img'); return IMGS.includes(v) ? v : ''; })();
  const leagueImg = x => (x && IMGS.includes(x.img) ? x.img : 'league');
  // Nom de la ligue (même voie que l'image, &nom=) : sans caractères de contrôle ni de direction, 40 caractères, affiché en texte.
  const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const NAMEP = cleanName(new URLSearchParams(location.search).get('nom'));
  const leagueTitle = x => (x && cleanName(x.n)) || t('Ligue {id}').replace('{id}', short(x.a.slice(10)));
  const inviteUrl = x => location.origin + '/ligues.html?ligue=' + x.a + (leagueImg(x) !== 'league' ? '&img=' + leagueImg(x) : '') + (cleanName(x.n) ? '&nom=' + encodeURIComponent(cleanName(x.n)) : '');
  const addLeague = (a, org, img, name, pic) => {
    try {
      const all = myLeagues(), old = all.find(x => x.a === a), im = IMGS.includes(img) ? img : old && IMGS.includes(old.img) ? old.img : '';
      const n = name !== undefined && name !== '' ? cleanName(name) : name === '' && org ? '' : old ? cleanName(old.n) : '';
      const pc = pic !== undefined ? (/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(pic) ? pic : '') : old && old.pic ? old.pic : '';
      localStorage.setItem(MYL(), JSON.stringify([{ a, org: !!(org || (old && old.org)), img: im, n, pic: pc, t: Date.now() }, ...all.filter(x => x.a !== a)].slice(0, 20)));
    } catch (e) {}
  };
  // Le tableau public du site appartient à son organisateur : retrouvé d'office dans « Mes ligues » quand son wallet est connecté.
  async function seedMine() {
    if (!PAGE_LG || LEAGUE || !C() || !W() || !W().account()) return;
    try {
      const net = netName(); if (!C().forecastsLive(net)) return;
      const b = await C().readBoard(net), k = await C().whoami(net, b.address);
      if (b.organizer === k && !myLeagues().some(x => x.a === b.address && x.org)) { addLeague(b.address, true); leagues(); }
    } catch (e) { console.warn('[signal-desk] mes ligues', e && e.message); }
  }
  function leagues() {
    const net = netName(), canCreate = C() && C().leaguesLive(net);
    // En-tête de la page : le contrat est publié, plus de « les ligues ouvrent avec la publication ».
    // Avant le test de #pr-lg-body : pronostics.html n'a pas cette section et gardait le bandeau « Exemple ».
    const hs = document.querySelector('p.status'); if (hs && canCreate && hs.lastChild) hs.lastChild.nodeValue = t(net === 'mainnet' ? 'En ligne sur le mainnet Tari' : 'En ligne sur le testnet Tari');
    const box = $('pr-lg-body'); if (!box) return; box.replaceChildren();
    if (LEAGUE) {
      // Tableau de bord de la ligue (variante O3 « Tableau », choix de Soufian du 04/11) : en-tête, chiffres,
      // podium, tableau des questions (Trancher pour l'organisateur), classement complet, formulaire de l'organisateur.
      const b = live && live.board, ep = live ? live.epoch : 0, qs = b ? b.questions : [];
      const isOrg = !!(b && myKey && b.organizer === myKey);
      const stOf = q => q.outcome !== null ? 'done' : ep < q.close ? 'open' : 'todo';
      const ST = { open: 'Ouverte', todo: 'À trancher', done: 'Tranchée' };
      const loc0 = myLeagues().find(x => x.a === LEAGUE) || { a: LEAGUE, img: IMGP, n: NAMEP };
      const me = b && b.v2 ? { ...loc0, n: b.name, img: b.image || loc0.img, pic: b.picture || '' } : loc0;
      const head = el('header', 'lgd-head'), idb = el('div', 'lgd-id');
      const ttl = el('div', 'lgd-tline'); ttl.appendChild(el('h3', 'lgd-title', leagueTitle(me)));
      // Organisateur : crayon « Modifier la ligue », comme celui du profil.
      if (isOrg) {
        const pen = el('button', 'lgd-pen'); pen.type = 'button'; pen.title = t('Modifier la ligue'); pen.setAttribute('aria-label', t('Modifier la ligue'));
        pen.innerHTML = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.5 5.5l3 3" stroke="currentColor" stroke-width="1.5"/></svg>';
        pen.addEventListener('click', () => editLeague(me, b));
        ttl.appendChild(pen);
      }
      idb.append(el('p', 'lgd-by', t('Organisée par {k}').replace('{k}', b ? short(b.organizer) : '…') + (isOrg ? ' ' + t('(vous)') : '')), ttl);
      const note = el('p', 'lgd-note'); note.append(el('span', 'lgd-live', t(netName() === 'mainnet' ? 'En ligne sur le mainnet Tari' : 'En ligne sur le testnet Tari')), document.createTextNode(' · ' + t('Tout est public sur la blockchain : la ligue est privée par son lien, pas secrète.')));
      idb.appendChild(note);
      const acts = el('div', 'lgd-acts');
      const copy = el('button', 'btn-sm', t("Copier le lien d'invitation")); copy.type = 'button';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl(me)); say('Lien copié.'); } catch (e) { say('Copie impossible.'); } });
      acts.appendChild(copy);
      if (isOrg) {
        const ask = el('button', 'btn-sm lgd-go', t('Poser une question')); ask.type = 'button';
        ask.addEventListener('click', () => { const f = $('lgd-ask'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); f.querySelector('textarea').focus({ preventScroll: true }); } });
        acts.appendChild(ask);
      }
      head.append(idb, acts); box.appendChild(head);
      // Chiffres, en ligne comme la bande de l'accueil (F6).
      const keys = new Set(); let sealed = 0; qs.forEach(q => q.forecasts.forEach(f => { keys.add(f.key); sealed++; }));
      const stats = el('div', 'lgd-stats');
      const stat = (v, k, cls) => { const d = el('div', cls || ''); d.append(el('b', '', num(v)), el('span', '', t(k))); stats.appendChild(d); };
      stat(qs.length, 'questions'); stat(qs.filter(q => stOf(q) === 'open').length, 'ouvertes'); stat(keys.size, 'participants'); stat(sealed, 'pronostics scellés');
      if (isOrg) stat(qs.filter(q => stOf(q) === 'todo').length, 'à trancher', 'todo');
      box.appendChild(stats);
      // Podium.
      const scores = live ? C().boardScores(b, ep) : [];
      const pod = el('div', 'lgd-pod');
      if (!scores.length) pod.appendChild(el('p', 'rk-empty', t('Le podium apparaît dès la première question tranchée.')));
      else scores.slice(0, 3).forEach((p, i) => { const d = el('div', i ? '' : 'first'); d.append(el('span', 'lgd-p', '#' + (i + 1)), el('b', '', p.key === myKey ? t('Vous') : short(p.key)), el('span', '', t('{p} pts').replace('{p}', num(p.points)))); pod.appendChild(d); });
      box.appendChild(pod);
      // Tableau des questions, la plus récente en haut.
      const tbl = el('div', 'lgd-tbl'), hr = el('div', 'lgd-tr lgd-th');
      ['Question', 'Type', 'Clôture (UTC)', 'Pronostics', 'État', ''].forEach(k => hr.appendChild(el('span', '', k ? t(k) : ''))); tbl.appendChild(hr);
      if (!qs.length) tbl.appendChild(el('p', 'rk-empty lgd-none', t("Aucune question pour l'instant.")));
      const fmt = new Intl.DateTimeFormat(loc(), { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });
      qs.slice().reverse().forEach(q => {
        const s = stOf(q), tr = el('div', 'lgd-tr');
        const when = new Date(closeMs(q, ep));
        const act = el('span', 'lgd-act');
        if (s === 'todo' && isOrg) {
          const go = el('button', 'btn-sm lgd-go', t('Trancher')); go.type = 'button';
          go.addEventListener('click', () => { const nx = tr.nextElementSibling; if (nx && nx.classList.contains('lgd-res')) nx.remove(); else tr.after(resolveForm(q)); });
          act.appendChild(go);
        } else if (s === 'open') { const a = el('a', 'lnk', t('Répondre')); a.href = '#q-b' + q.id; act.appendChild(a); }
        else if (s === 'done') act.appendChild(el('b', 'lgd-out', t('Résultat : {r}').replace('{r}', answerLabel(q, q.outcome))));
        tr.append(el('span', 'lgd-q', window.sdBi(q.meta.q)), el('span', 'lgd-m', t(TYPES[q.meta.type] || q.meta.type)), el('span', 'lgd-m', fmt.format(when)),
          el('span', '', num(q.forecasts.length)), el('span', '', ''), act);
        tr.children[4].appendChild(el('span', 'lgd-st ' + s, t(ST[s])));
        tbl.appendChild(tr);
      });
      box.appendChild(tbl);
      const two = el('div', 'lgd-two');
      const table = el('div', 'pf-panel'); table.appendChild(el('h3', 'rk-h', t('Classement complet')));
      if (!scores.length) table.appendChild(el('p', 'rk-empty', t('Le classement apparaît dès la première question tranchée.')));
      else {
        const ol = el('ol', 'pr-lg-rank');
        scores.slice(0, 50).forEach((p, i) => {
          const li = el('li', p.key === myKey ? 'me' : '');
          li.append(el('span', 'num', '#' + num(i + 1)), el('b', '', p.key === myKey ? t('Vous') : short(p.key)),
            el('span', '', t('{p} pts').replace('{p}', num(p.points))), el('span', '', p.avgGap === null ? '—' : t('écart {g}').replace('{g}', pctg(p.avgGap))));
          ol.appendChild(li);
        });
        table.appendChild(ol);
      }
      two.appendChild(table);
      if (isOrg) two.appendChild(askForm());
      box.appendChild(two);
      if (isOrg && b && b.v2) box.appendChild(membersPanel(b));
      return;
    }
    // Mes ligues (variante A1 « Carte image », choix de Soufian du 04/11) : au-dessus de « créer ou rejoindre », à part des ligues publiques.
    const mine = myLeagues();
    if (mine.length) {
      const sec = el('div', 'lgm'), list = el('div', 'lgm-list');
      sec.appendChild(el('h3', 'rk-h', t('Mes ligues')));
      mine.forEach(x => {
        const a = el('a', 'lgm-card'); a.href = inviteUrl(x).replace(location.origin + '/', '');
        const img = el('div', 'lgm-img lgi-' + leagueImg(x)); img.appendChild(el('span', 'lgm-role' + (x.org ? '' : ' mem'), t(x.org ? 'Organisateur' : 'Membre')));
        const setPic = u => { img.querySelector('.lgm-pic')?.remove(); if (u) { const im = el('img', 'lgm-pic'); im.alt = ''; im.src = u; img.prepend(im); } };
        setPic(DATA_IMG.test(x.pic || '') ? x.pic : '');
        const b = el('div', 'lgm-b'), stl = el('div', 'lgm-stl'), foot = el('div', 'lgm-f');
        const st = (v, k) => { const s = el('span'); s.append(el('b', '', v), document.createTextNode(t(k))); return s; };
        stl.append(st('…', 'questions'), st('…', 'ouvertes'), st('…', 'participants'));
        const info = el('span', '', ''); foot.append(info, el('span', 'lgm-go', t('Ouvrir la ligue')));
        const h3 = el('h3', '', leagueTitle(x)); b.append(h3, stl, foot);
        a.append(img, b); list.appendChild(a);
        // Chiffres lus sur la blockchain, après l'affichage de la carte.
        if (canCreate) Promise.all([C().readBoard(net, x.a), C().currentEpoch(net)]).then(([bd, ep]) => {
          if (bd.v2) { h3.textContent = cleanName(bd.name) || t('Ligue {id}').replace('{id}', short(x.a.slice(10))); if (bd.image) img.className = 'lgm-img lgi-' + (IMGS.includes(bd.image) ? bd.image : 'league'); setPic(bd.picture); }
          const open = bd.questions.filter(q => q.outcome === null && ep < q.close), keys = new Set();
          bd.questions.forEach(q => q.forecasts.forEach(f => keys.add(f.key)));
          stl.replaceChildren(st(num(bd.questions.length), 'questions'), st(num(open.length), 'ouvertes'), st(num(keys.size), 'participants'));
          const next = open.map(q => closeMs(q, ep)).sort((p, q) => p - q)[0];
          const todo = x.org && bd.questions.some(q => q.outcome === null && ep >= q.close);
          info.textContent = todo ? t('Une question attend votre résultat') : next ? t('Prochaine clôture {d}').replace('{d}', new Intl.DateTimeFormat(loc(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(next) + ' UTC')
            : t(bd.questions.length ? 'Aucune question ouverte' : "Aucune question pour l'instant");
          if (todo) info.className = 'lgm-todo';
        }).catch(() => { stl.replaceChildren(el('span', '', t('Chiffres indisponibles pour le moment'))); });
      });
      sec.append(list, el('p', 'lgd-hint', t("Les ligues que vous créez ou ouvrez sur cet appareil s'affichent ici.")));
      box.appendChild(sec);
    }
    // Créer ou rejoindre (variante B3 « Création guidée », choix de Soufian du 04/11).
    const grid = el('div', 'lgc');
    const create = el('div', 'lgc-card lgc-new');
    const steps = el('div', 'lgc-steps');
    [['1 · Créer', 'Une signature Sapient'], ['2 · Poser', 'Vos questions, vos dates'], ['3 · Partager', 'Le lien à vos amis']].forEach(([h, p]) => { const d = el('div'); d.append(el('b', '', t(h)), el('span', '', t(p))); steps.appendChild(d); });
    const go = el('button', 'btn-sm lgd-go lgc-arrow', t('Créer une ligue')); go.type = 'button';
    const end = el('div', 'lgc-end'); end.append(go, el('span', 'lgd-hint', t('Le classement se calcule seul depuis la blockchain.')));
    const wait = el('small', 'pr-lg-wait', t('Disponible dès la publication du contrat de pronostics.'));
    // Audit S3 : une ligue naît « sur invitation » (seuls ses membres scellent) ; ouverte à tous, un inconnu peut la remplir.
    let openNew = false;
    const modeNew = el('div', 'lgd-row');
    [[false, 'Sur invitation'], [true, 'Ouverte à tous']].forEach(([v, k]) => {
      const c = el('button', 'chip', t(k)); c.type = 'button'; c.setAttribute('aria-pressed', String(v === openNew));
      c.addEventListener('click', () => { openNew = v; modeNew.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); });
      modeNew.appendChild(c);
    });
    create.append(el('h3', 'rk-h', t('Créer ma ligue')), steps, modeNew, end); if (!canCreate) create.appendChild(wait);
    go.addEventListener('click', async () => {
      // Contrat pas encore publié : on le dit clairement au lieu d'un bouton muet.
      if (!canCreate) { say('Les ligues ouvriront dès la publication du contrat de pronostics sur le testnet.'); wait.classList.remove('flash'); void wait.offsetWidth; wait.classList.add('flash'); return; }
      if (!W() || !W().account()) { say('Connectez votre wallet pour créer une ligue.'); document.getElementById('walletbtn')?.click(); return; }
      go.disabled = true;
      try { const addr = await C().openBoard(netName(), undefined, { open: openNew }); addLeague(addr, true); say('Ligue créée.'); location.href = 'ligues.html?ligue=' + addr; }
      catch (e) { say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); go.disabled = false; }
    });
    const join = el('form', 'lgc-card'); join.noValidate = true;
    const inp = el('input', 'lgd-in'); inp.placeholder = t('Lien ou adresse de la ligue'); inp.autocomplete = 'off'; inp.spellcheck = false;
    const j = el('button', 'btn-sm lgc-arrow', t('Rejoindre')); j.type = 'submit';
    const jr = el('div'); jr.appendChild(j);
    join.append(el('h3', 'rk-h', t('Rejoindre une ligue')), el('p', 'lgd-hint lgc-p', t('Un ami vous a envoyé un lien ? Collez-le ici.')), inp, jr);
    join.addEventListener('submit', e => {
      e.preventDefault(); const m = inp.value.match(/component_[0-9a-f]{64}/); if (!m) return say('Lien de ligue invalide.');
      const im = inp.value.match(/[?&]img=([a-z]+)/); location.href = 'ligues.html?ligue=' + m[0] + (im && IMGS.includes(im[1]) ? '&img=' + im[1] : '');
    });
    grid.append(create, join); box.appendChild(grid);
  }
  // Toutes les ligues du contrat, lues sur la blockchain (C.findBoards + C.readBoard, en parallèle).
  // Une ligue illisible est ignorée ; les chiffres sont ceux de la chaîne, rien n'est inventé.
  let clubData = null; // { net, boards, epoch } : relu seulement si le réseau change
  async function clubs() {
    const box = $('lg-clubs'); if (!box) return;
    const net = netName(), msg = k => box.replaceChildren(el('p', 'rk-empty', t(k)));
    if (!C() || !C().leaguesLive(net)) return msg('Disponible dès la publication du contrat de pronostics.');
    if (!clubData || clubData.net !== net) {
      msg('Lecture des ligues sur la blockchain…');
      try {
        const [addrs, epoch] = await Promise.all([C().findBoards(net), C().currentEpoch(net)]);
        const got = await Promise.allSettled(addrs.map(a => C().readBoard(net, a)));
        clubData = { net, epoch, boards: got.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value) };
      } catch (e) { console.warn('[signal-desk] ligues', e && e.message); return msg('Blockchain injoignable pour le moment : réessayez dans un instant.'); }
    }
    const ep = clubData.epoch;
    const rows = clubData.boards.map(bd => {
      const keys = new Set(); bd.questions.forEach(q => q.forecasts.forEach(f => keys.add(f.key)));
      return { bd, n: keys.size, o: bd.questions.filter(q => q.outcome === null && ep < q.close).length };
    }).sort((x, y) => y.n - x.n || y.bd.questions.length - x.bd.questions.length);
    if (!rows.length) return msg("Aucune ligue sur la blockchain pour l'instant : créez la première.");
    box.replaceChildren();
    rows.forEach(({ bd, n, o }) => {
      const card = el('article', 'lg-club');
      const pic = DATA_IMG.test(bd.picture || '') ? bd.picture : 'img/' + (IMGS.includes(bd.image) ? bd.image : 'league') + '-m.webp';
      card.style.setProperty('--img', `url(${pic})`);
      const body = el('div', 'lg-club-b');
      const meta = el('div', 'lg-club-m'); meta.append(el('span', 'h2-lg', t(bd.open ? 'Ouverte à tous' : 'Sur invitation')), el('span', '', `${num(bd.questions.length)} ${t(bd.questions.length > 1 ? 'questions' : 'question')} · ${num(o)} ${t(o > 1 ? 'ouvertes' : 'ouverte')}`));
      const go = el('a', 'btn-sm lg-join', t('Ouvrir la ligue')); go.href = 'ligues.html?ligue=' + bd.address;
      body.append(meta, el('h3', '', cleanName(bd.name) || t('Ligue {id}').replace('{id}', short(bd.address.slice(10)))),
        el('p', '', t('Organisée par {k}').replace('{k}', short(bd.organizer))), el('p', '', !n ? t('Aucun participant') : n === 1 ? t('1 participant') : t('{n} participants').replace('{n}', num(n))), go);
      card.append(el('div', 'lg-club-img'), body); box.appendChild(card);
    });
  }

  // Image importée depuis l'appareil : recadrée au format de la carte (3:1), WebP, sous 16 Kio (le contrat accepte 24 Kio).
  async function shrinkPicture(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(file.type)) throw new Error('type');
    const bmp = await createImageBitmap(file);
    for (const [w, h] of [[720, 240], [600, 200], [480, 160]]) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const s = Math.max(w / bmp.width, h / bmp.height), dw = bmp.width * s, dh = bmp.height * s;
      cv.getContext('2d').drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
      for (const q of [0.82, 0.7, 0.58, 0.46]) {
        const blob = await new Promise(ok => cv.toBlob(ok, 'image/webp', q));
        if (blob && blob.type === 'image/webp' && blob.size <= 16384) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = ''; for (const x of bytes) bin += String.fromCharCode(x);
          return { hex: [...bytes].map(c => c.toString(16).padStart(2, '0')).join(''), url: 'data:image/webp;base64,' + btoa(bin), size: bytes.length };
        }
      }
    }
    throw new Error('size');
  }
  const DATA_IMG = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
  // Clé publique d'un membre : adresse Tari (otl_…, ses 32 premiers octets) ou clé hexadécimale de 64 caractères.
  const memberKey = s => { const v = String(s || '').trim(); if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase(); const k = C() && C().walletKey(v); return k && !/^0+$/.test(k) ? k : null; };

  // Panneau « Membres » du tableau de bord (ligue v2, organisateur) : chaque clic envoie aussitôt sa transaction.
  const LEAGUE_CAP = 1500; // MAX_FORECASTS du contrat SignalForecasts
  function membersPanel(bd) {
    const p = el('div', 'pf-panel lgd-mem'); p.id = 'lgd-mem';
    const head = el('div', 'lgd-mem-h'); head.append(el('h3', 'rk-h', t('Membres')), el('span', 'lgd-hint', t('1 clic = 1 signature Sapient')));
    const busy = new Set();
    const run = async (btn, fn, ok) => {
      if (busy.size) return; busy.add(btn); p.querySelectorAll('button,input').forEach(x => { x.disabled = true; });
      try { await fn(); say(ok); loadLive(); }
      catch (e) { say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); p.querySelectorAll('button,input').forEach(x => { x.disabled = false; }); }
      finally { busy.clear(); }
    };
    const one = (kind, k) => C().updateMembers(live.net, LEAGUE, kind === 'add' ? [k] : [], kind === 'remove' ? [k] : [], kind === 'block' ? [k] : [], kind === 'unblock' ? [k] : []);
    // Mode
    const mode = el('div', 'lgd-row');
    [[true, 'Ouverte : toute personne avec le lien'], [false, 'Fermée : membres seulement']].forEach(([v, k]) => {
      const c = el('button', 'chip', t(k)); c.type = 'button'; c.setAttribute('aria-pressed', String(bd.open === v));
      c.addEventListener('click', () => { if (bd.open !== v) run(c, () => C().setProfile(live.net, LEAGUE, bd.name, bd.image || 'league', v), v ? 'Ligue ouverte.' : 'Ligue fermée : seuls vos membres peuvent répondre.'); });
      mode.appendChild(c);
    });
    // Audit S3 : le contrat accepte au plus 1 500 pronostics par ligue. Ouverte, un inconnu peut la remplir :
    // l'organisateur voit la place prise et ferme la ligue en un clic avant qu'elle soit pleine.
    const used = bd.questions.reduce((n, q) => n + q.forecasts.length, 0);
    const capa = el('p', 'lgd-hint', t('Capacité : {n} / {m} pronostics').replace('{n}', num(used)).replace('{m}', num(LEAGUE_CAP)));
    const warn = bd.open && used >= LEAGUE_CAP * 0.8 ? el('p', 'guide-warn', t('Ligue ouverte presque pleine : fermez-la pour la réserver à vos membres.')) : null;
    // Ajout par adresse
    const inp = el('input', 'lgd-in'); inp.placeholder = t('Adresse Tari du membre (otl_…)'); inp.autocomplete = 'off'; inp.spellcheck = false;
    const addB = el('button', 'btn-sm lgd-go', t('Ajouter')); addB.type = 'button';
    const blkB = el('button', 'btn-sm', t('Bloquer')); blkB.type = 'button';
    const byAddr = (btn, kind, ok) => () => {
      const k = memberKey(inp.value); if (!k) return say('Adresse Tari invalide.'); if (k === bd.organizer) return say('C’est votre propre adresse.');
      run(btn, () => one(kind, k), ok);
    };
    addB.addEventListener('click', byAddr(addB, 'add', 'Membre ajouté.'));
    blkB.addEventListener('click', byAddr(blkB, 'block', 'Clé bloquée : elle ne peut plus répondre.'));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addB.click(); } });
    const addRow = el('div', 'lgedit-add'); addRow.append(inp, addB, blkB);
    // Liste : membres, bloqués, puis participants qui ne sont ni l'un ni l'autre
    const list = el('div', 'lgedit-list lgd-mem-list');
    const line = (k, tag, acts) => {
      const r = el('div', 'lgedit-li'); r.append(el('span', 'mono', short(k)), el('span', 'lgd-hint', t(tag)));
      const a = el('span', 'lgd-row');
      acts.forEach(([lab, kind, ok, main]) => { const b = el('button', 'btn-sm' + (main ? ' lgd-go' : ''), t(lab)); b.type = 'button'; b.addEventListener('click', () => run(b, () => one(kind, k), ok)); a.appendChild(b); });
      r.appendChild(a); list.appendChild(r);
    };
    bd.members.forEach(k => line(k, 'Membre', [['Retirer', 'remove', 'Membre retiré.'], ['Bloquer', 'block', 'Clé bloquée : elle ne peut plus répondre.']]));
    bd.blocked.forEach(k => line(k, 'Bloqué', [['Débloquer', 'unblock', 'Clé débloquée.']]));
    const parts = [...new Set(bd.questions.flatMap(q => q.forecasts.map(f => f.key)))].filter(k => k !== bd.organizer && !bd.members.includes(k) && !bd.blocked.includes(k));
    parts.forEach(k => line(k, 'Participant', [['Ajouter', 'add', 'Membre ajouté.', true], ['Bloquer', 'block', 'Clé bloquée : elle ne peut plus répondre.']]));
    if (!list.children.length) list.appendChild(el('p', 'lgd-hint', t('Aucun membre pour l’instant.')));
    const stat = el('p', 'lgd-hint', t('{m} membres · {b} bloqués').replace('{m}', num(bd.members.length)).replace('{b}', num(bd.blocked.length)));
    p.append(head, mode, capa, ...(warn ? [warn] : []), addRow, stat, list);
    return p;
  }
  // Fenêtre « Modifier la ligue » de l'organisateur. Ligue v2 : nom, image, photo, mode et membres sur la blockchain.
  // Ligue v1 : nom, image et photo gardés sur cet appareil (le nom et l'image de la galerie voyagent par le lien).
  function editLeague(x, bd) {
    const v2 = !!(bd && bd.v2);
    let dlg = $('lgedit');
    if (!dlg) { dlg = el('dialog', 'accdlg lgedit'); dlg.id = 'lgedit'; dlg.setAttribute('aria-labelledby', 'lgedit-h'); document.body.appendChild(dlg); }
    dlg.replaceChildren();
    const start = { name: v2 ? bd.name : cleanName(x.n), img: v2 ? (bd.image || 'league') : leagueImg(x), pic: v2 ? bd.picture : (DATA_IMG.test(x.pic || '') ? x.pic : ''), open: v2 ? bd.open : true };
    let img = start.img, pic = start.pic, picHex = null, open = start.open;
    const f = el('form', 'lgedit-f'); f.noValidate = true;
    const h = el('h3', 'rk-h', t('Modifier la ligue')); h.id = 'lgedit-h';
    const close = el('button', 'lgedit-x', '×'); close.type = 'button'; close.setAttribute('aria-label', t('Fermer')); close.addEventListener('click', () => dlg.close());
    const top = el('div', 'lgedit-top'); top.append(h, close);
    // Nom
    const name = el('input', 'lgd-in'); name.maxLength = 40; name.autocomplete = 'off'; name.value = start.name; name.placeholder = t('Ligue {id}').replace('{id}', short(x.a.slice(10)));
    const cnt = el('span', 'lgd-hint lgd-cnt', name.value.length + ' / 40'); name.addEventListener('input', () => { cnt.textContent = name.value.length + ' / 40'; });
    const nl = el('label', 'lgd-l'); nl.append(el('span', '', t('Nom de la ligue')), name, cnt);
    // Image : aperçu + galerie + import
    const prev = el('div', 'lgedit-prev lgm-img');
    const paint = () => { prev.className = 'lgedit-prev lgm-img lgi-' + img; prev.replaceChildren(); if (pic) { const im = el('img', 'lgm-pic'); im.alt = ''; im.src = pic; prev.appendChild(im); } };
    const row = el('div', 'lgi-row');
    IMGS.forEach(k => {
      const bt = el('button', 'lgi-th lgi-' + k); bt.type = 'button'; bt.title = t(IMG_NAMES[k]);
      bt.setAttribute('aria-label', t(IMG_NAMES[k])); bt.setAttribute('aria-pressed', String(!pic && k === img));
      bt.addEventListener('click', () => { img = k; pic = ''; picHex = ''; row.querySelectorAll('.lgi-th').forEach(y => y.setAttribute('aria-pressed', String(y === bt))); paint(); });
      row.appendChild(bt);
    });
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'; file.hidden = true;
    const up = el('button', 'btn-sm', t('Importer depuis mon PC')); up.type = 'button'; up.addEventListener('click', () => file.click());
    const upInfo = el('span', 'lgd-hint', '');
    file.addEventListener('change', async () => {
      const fl = file.files && file.files[0]; if (!fl) return;
      upInfo.textContent = t('Préparation de l’image…');
      try { const r = await shrinkPicture(fl); pic = r.url; picHex = r.hex; row.querySelectorAll('.lgi-th').forEach(y => y.setAttribute('aria-pressed', 'false')); paint(); upInfo.textContent = t('Image prête : {n} Ko').replace('{n}', num(r.size / 1024, 1)); }
      catch (e) { upInfo.textContent = ''; say(e && e.message === 'type' ? 'Choisissez une image PNG, JPEG, WebP, GIF ou AVIF.' : "Image impossible à réduire sous 16 Ko, essayez-en une autre."); }
      file.value = '';
    });
    const upRow = el('div', 'lgd-row'); upRow.append(up, upInfo, file);
    const il = el('div', 'lgd-l'); il.append(el('span', '', t('Image de la ligue')), prev, row, upRow);
    paint();
    // Mode et membres (v2)
    const mem = el('div', 'lgedit-mem');
    if (v2) {
      mem.append(el('b', '', t('Membres')), el('p', 'lgd-hint', t('Le mode et les membres se gèrent en un clic dans le tableau de bord de la ligue, sous le classement.')));
    } else {
      mem.append(el('b', '', t('Membres')), el('p', 'lgd-hint', t('Ajouter, bloquer ou retirer des membres demande une ligue v2. Cette ligue a été créée avec le premier contrat : créez une nouvelle ligue pour en profiter.')));
    }
    const save = el('button', 'btn-sm lgd-go', t('Enregistrer')); save.type = 'submit';
    const cancel = el('button', 'btn-sm', t('Annuler')); cancel.type = 'button'; cancel.addEventListener('click', () => dlg.close());
    const foot = el('div', 'lgd-row'); foot.append(save, cancel);
    const note = v2 ? t('Le nom et l’image importée demandent chacun une signature Sapient.') : t("Le nom et l'image de la galerie voyagent avec le lien d'invitation. Une image importée reste sur cet appareil tant que la ligue n'est pas en v2.");
    f.append(top, nl, il, mem, el('p', 'lgd-hint', note), foot);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const nm = cleanName(name.value);
      if (!v2) { addLeague(x.a, true, img, nm, picHex === null ? undefined : pic); dlg.close(); leagues(); say("Ligue mise à jour. Copiez le nouveau lien d'invitation pour la partager."); return; }
      save.disabled = true;
      // Audit K14 : le nom passé reste acquis même si l'image échoue ensuite, et le message le dit.
      let named = false;
      try {
        if (nm !== start.name || img !== start.img || open !== start.open) { await C().setProfile(netName(), x.a, nm, img, open); named = true; addLeague(x.a, true, img, nm); }
        if (picHex !== null && pic !== start.pic) await C().setPicture(netName(), x.a, picHex);
        addLeague(x.a, true, img, nm); dlg.close(); say('Ligue mise à jour sur la blockchain.'); loadLive();
      } catch (er) {
        say(er && er.code === 4001 ? (named ? 'Nom enregistré ; image refusée dans le wallet.' : 'Signature refusée dans le wallet.') : named ? "Nom enregistré ; l'image a été refusée par le réseau." : 'Transaction refusée par le réseau.');
        if (named) loadLive();
      }
      finally { save.disabled = false; }
    });
    dlg.appendChild(f); dlg.showModal(); name.focus();
  }
  // Valeurs scellées par type (mêmes chaînes que card() : un résultat publié doit être identique à la réponse scellée).
  const answerSet = q => q.meta.type === 'yesno' ? [['oui', 'Oui'], ['non', 'Non']] : q.meta.type === 'updown' ? [['hausse', '▲ Hausse'], ['baisse', '▼ Baisse']]
    : Array.isArray(q.meta.opts) ? q.meta.opts.filter(x => typeof x === 'string').map(o => [o, o]) : null;
  const answerLabel = (q, v) => { const m = (answerSet(q) || []).find(x => x[0] === v); return m ? t(m[1]) : String(v); };
  const NUMERIC = ['number', 'price'];
  // Formulaire de tranchage de l'organisateur, ouvert sous la ligne de la question.
  function resolveForm(q) {
    const f = el('form', 'lgd-res'); f.noValidate = true; f.appendChild(el('b', '', t('Résultat officiel')));
    const row = el('div', 'lgd-row'), vals = NUMERIC.includes(q.meta.type) ? null : answerSet(q);
    let pick = null, inp = null;
    if (vals) vals.forEach(([v, l]) => {
      const c = el('button', 'chip', t(l)); c.type = 'button'; c.setAttribute('aria-pressed', 'false');
      c.addEventListener('click', () => { pick = v; row.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); });
      row.appendChild(c);
    });
    else { inp = el('input', 'lgd-in lgd-num'); inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.placeholder = t('Valeur exacte'); row.appendChild(inp); }
    const go = el('button', 'btn-sm lgd-go', t('Publier le résultat')); go.type = 'submit';
    const no = el('button', 'btn-sm', t('Annuler')); no.type = 'button'; no.addEventListener('click', () => f.remove());
    const r2 = el('div', 'lgd-row'); r2.append(go, no, el('span', 'lgd-hint', t('1 signature Sapient · définitif')));
    f.append(row, r2);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      let v = pick;
      if (inp) { const raw = inp.value.replace(/[\s  ]/g, '').replace(',', '.'); if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) return say('Entrez un nombre valide.'); v = raw; }
      if (!v) return say('Indiquez le résultat.');
      go.disabled = true;
      try { await C().resolveQuestion(live.net, LEAGUE, q.id, v); say('Résultat publié.'); loadLive(); }
      catch (x) { say(x && x.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); go.disabled = false; }
    });
    return f;
  }
  // Formulaire de l'organisateur : une question = un JSON {type, q, opts?, unit?, close_utc} publié sur la chaîne.
  // Type en puces, champs selon le type (F6), clôture en puces ou date UTC convertie en époques d'environ 1 h (F7), largeur bornée (F8).
  function askForm() {
    const f = el('form', 'pf-panel lgd-ask'); f.noValidate = true; f.id = 'lgd-ask'; f.appendChild(el('h3', 'rk-h', t('Poser une question')));
    const lab = (txt, input, extra) => { const l = el('label', 'lgd-l'); l.append(el('span', '', t(txt)), input); if (extra) l.appendChild(extra); return l; };
    let type = 'yesno', hours = 24;
    const types = el('div', 'lgd-row'); types.setAttribute('role', 'group'); types.setAttribute('aria-label', t('Type'));
    const q = el('textarea', 'lgd-in lgd-ta'); q.maxLength = 200;
    const cnt = el('span', 'lgd-hint lgd-cnt', '0 / 200'); q.addEventListener('input', () => { cnt.textContent = q.value.length + ' / 200'; });
    const unit = el('input', 'lgd-in'); unit.maxLength = 8; unit.autocomplete = 'off'; unit.placeholder = '$, %…';
    const opts = el('input', 'lgd-in'); opts.autocomplete = 'off'; opts.placeholder = t('Séparés par des virgules');
    const unitL = lab('Unité (facultatif)', unit), optsL = lab('Choix', opts);
    const sync = () => { unitL.hidden = !NUMERIC.includes(type); optsL.hidden = !['choice', 'range'].includes(type); };
    Object.entries(TYPES).forEach(([k, v]) => {
      const c = el('button', 'chip', t(v)); c.type = 'button'; c.setAttribute('aria-pressed', String(k === type));
      c.addEventListener('click', () => { type = k; types.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); sync(); });
      types.appendChild(c);
    });
    const date = el('input', 'lgd-in lgd-date'); date.type = 'datetime-local'; date.hidden = true; date.setAttribute('aria-label', t('Date de clôture (UTC)'));
    const info = el('span', 'lgd-hint');
    const closeIso = () => hours ? new Date(Date.now() + hours * 3600e3).toISOString() : date.value ? new Date(date.value + ':00Z').toISOString() : '';
    const epochs = () => { const iso = closeIso(); return iso ? Math.ceil((Date.parse(iso) - Date.now()) / EP()) : 0; };
    const upd = () => { const n = epochs(); info.textContent = n > 0 ? t('≈ {n} époques · ouverture des réponses pendant 48 h ensuite').replace('{n}', num(n)) : ''; };
    const chips = el('div', 'lgd-row');
    [[24, 'Dans 24 h'], [72, '3 jours'], [168, '1 semaine'], [0, 'Date précise']].forEach(([h, k]) => {
      const c = el('button', 'chip', t(k)); c.type = 'button'; c.setAttribute('aria-pressed', String(h === hours));
      c.addEventListener('click', () => { hours = h; date.hidden = h !== 0; chips.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === c))); if (!h) date.focus(); upd(); });
      chips.appendChild(c);
    });
    date.addEventListener('input', upd);
    const closeBox = el('div', 'lgd-l'); closeBox.append(el('span', '', t('Les réponses ferment')), chips, date, info);
    const btn = el('button', 'btn-sm lgd-go', t('Publier la question')); btn.type = 'submit';
    const foot = el('div', 'lgd-row'); foot.append(btn, el('span', 'lgd-hint', t('1 signature Sapient')));
    f.append(types, lab('Question', q, cnt), unitL, optsL, closeBox, foot); sync(); upd();
    if (window.sdMod) f.appendChild((() => { const p = document.createElement('p'); p.className = 'sd-rules'; p.textContent = t(window.sdMod.RULES); return p; })());
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const meta = { type, q: q.value.trim() };
      if (meta.q.length < 5) return say('Question trop courte.');
      if (window.sdMod && window.sdMod.bad(meta.q + ' ' + opts.value)) return say('Question contraire aux règles du site.');
      if (NUMERIC.includes(type) && unit.value.trim()) meta.unit = unit.value.trim().slice(0, 8);
      if (['choice', 'range'].includes(type)) {
        meta.opts = opts.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 8);
        if (meta.opts.length < 2) return say('Indiquez au moins deux choix.');
        // Une réponse scellée doit être en ASCII imprimable (contrat) : un choix accentué ne pourrait jamais être choisi.
        if (!meta.opts.every(o => /^[\x20-\x7e]{1,64}$/.test(o))) return say('Les choix doivent être sans accents ni symboles spéciaux (64 caractères max).');
      }
      const n = epochs(); if (!(n >= 1 && n <= 5000)) return say('La clôture doit tomber entre 1 h et 200 jours.');
      meta.close_utc = closeIso();
      btn.disabled = true;
      try { await C().askQuestion(live.net, LEAGUE, meta, n, 48); say('Question publiée.'); loadLive(); }
      catch (x) { say(x && x.code === 4001 ? 'Signature refusée dans le wallet.' : x instanceof RangeError ? 'Question trop longue.' : 'Transaction refusée par le réseau.'); }
      finally { btn.disabled = false; }
    });
    return f;
  }

  const state = { type: 'all', sort: 'soon', cat: 'all' }; let hashDone = false;
  // Sous-onglets de sujet (10/11) : Crypto, Sport, Finance / Politique, d'après le texte de la question (lang.js sdSubject).
  const inCat = p => state.cat === 'all' || ((window.sdSubject && window.sdSubject(p.q, p.opts)) || {}).cat === state.cat;
  function render() {
    if (!$('pr-grid') || (PAGE_LG && !LEAGUE)) return; // page Ligues sans ligue ouverte : rien à lister
    const src = live ? live.open : [];
    const list = src.filter(p => Date.parse(p.close) > Date.now() && (state.type === 'all' || p.type === state.type) && inCat(p))
      .sort((a, b) => state.sort === 'hot' ? b.n - a.n : Date.parse(a.close) - Date.parse(b.close));
    // À la une : les deux plus joués du filtre, en grand ; les autres dans la grille.
    const feat = [...list].sort((a, b) => b.n - a.n).slice(0, list.length > 4 ? 2 : 0);
    $('pr-feat').replaceChildren(...feat.map(p => { const c = card(p); c.classList.add('feat'); return c; }));
    $('pr-feat-s').hidden = !feat.length;
    $('pr-grid').replaceChildren(...list.filter(p => !feat.includes(p)).map(card));
    $('pr-none').hidden = list.length > 0;
    // Arrivée par la recherche (pronostics.html#q-b<n°>) : la question est amenée à l'écran une fois les cartes rendues.
    if (!hashDone && /^#q-b\d+$/.test(location.hash) && list.length) {
      const h = document.getElementById(location.hash.slice(1)), card = h && h.closest('.pr-card');
      // Deux passes : la mise en page bouge encore juste après le premier rendu (images, cascade), la barre du haut est fixe.
      if (card) { hashDone = true; card.classList.add('pr-hit'); const go = () => card.isConnected && card.scrollIntoView({ block: 'start' }); requestAnimationFrame(go); setTimeout(go, 700); }
    }
    // Nombre de questions ouvertes par sujet, dans les sous-onglets.
    if ($('pr-subj')) { const open = src.filter(p => Date.parse(p.close) > Date.now()), catOf = p => ((window.sdSubject && window.sdSubject(p.q, p.opts)) || {}).cat;
      $('pr-subj').querySelectorAll('button').forEach(b => { let n = b.querySelector('.n'); if (!n) { n = el('span', 'n num'); b.appendChild(n); } n.textContent = num(b.dataset.c === 'all' ? open.length : open.filter(p => catOf(p) === b.dataset.c).length); }); }
    $('pr-count').textContent = `${num(list.length)} ${t(list.length > 1 ? 'pronostics ouverts' : 'pronostic ouvert')}`;
    const res = (live ? live.results : []).filter(inCat);
    $('pr-results').replaceChildren(...res.map(result));
    if ($('pr-res-none')) $('pr-res-none').hidden = res.length > 0;
    const todo = revealable(), head = $('pr-count');
    if (todo.length) {
      const b = el('button', 'btn-sm pr-reveal', t('Ouvrir mes pronostics') + ' (' + num(todo.length) + ')'); b.type = 'button';
      b.disabled = revealing; // audit K6 : un rendu pendant les ouvertures ne recrée pas un bouton actif
      b.addEventListener('click', async () => {
        if (revealing) return;
        revealing = true; b.disabled = true; let done = 0;
        try { for (const x of todo) { await C().revealForecast(live.net, x.s, x.index); done++; } say('Pronostics ouverts.'); }
        catch (e) { say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : done ? t('{n} pronostics ouverts, le suivant a été refusé : réessayez.').replace('{n}', done) : 'Transaction refusée par le réseau.'); }
        finally { revealing = false; loadLive(); }
      });
      head.appendChild(b);
    }
  }
  const group = (id, key, attr) => $(id) && $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state[key] = b.dataset[attr]; $(id).querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render();
  });
  group('pr-types', 'type', 't'); group('pr-sort', 'sort', 's'); group('pr-subj', 'cat', 'c');
  setInterval(() => document.querySelectorAll('#pr-grid .pr-card').forEach(c => { const p = (live ? live.open : []).find(x => 'q-' + x.id === c.querySelector('.pr-q').id); if (p) c.querySelector('.pr-left').textContent = left(p.close); }), 30000);

  const nav = document.querySelector('nav'), dock = $('langdock');
  const onScroll = () => { nav.classList.toggle('scrolled', scrollY > 40); dock.classList.toggle('scrolled', scrollY > 40); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('ready')));

  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); if (PAGE_LG && !LEAGUE) clubs(); };
  // Ancien lien de ligue sur la page Pronostics : la ligue a maintenant sa page.
  if (!PAGE_LG && LEAGUE) { location.replace('ligues.html?ligue=' + LEAGUE); return; }
  if (PAGE_LG) { $('lg-questions').hidden = !LEAGUE; $('lg-how').hidden = $('lg-examples').hidden = !!LEAGUE; $('pr-lg-h').textContent = t(LEAGUE ? 'Ma ligue' : 'Créer ou rejoindre'); $('pr-lg-h').classList.toggle('sr', !LEAGUE); }
  render(); leagues(); if (PAGE_LG && !LEAGUE) clubs(); if (!PAGE_LG || LEAGUE) loadLive(); seedMine();
  // Le wallet se reconnecte souvent APRÈS le premier chargement : on relit alors la ligue pour reconnaître l'organisateur
  // (avant : rechargement seulement si rien n'était chargé, d'où une vue visiteur pour l'organisateur lui-même).
  // Audit K3 : `sd:me` part à chaque rendu du wallet ; on ne relit que sur un vrai changement de compte ou de réseau.
  let meSeen = '';
  addEventListener('sd:me', () => {
    const k = ((W() && W().account()) || '') + '|' + ((W() && W().network()) || '');
    if (k === meSeen) return; meSeen = k; myKey = null;
    leagues(); if (W() && W().account()) loadLive(); seedMine(); if (PAGE_LG && !LEAGUE) clubs();
  });
})();
