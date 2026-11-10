// Données partagées (classement, profils, en direct, marchés, communauté, accueil) : les desks réels lus sur la
// blockchain (chain.js), leurs calls ouverts vérifiés contre l'engagement, et le résultat de chaque call crypto
// recalculé ici sur les prix publics (prices.js). Les pages attendent `SD_READY` avant de s'afficher.
(() => {
  const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const rng = seed => { let a = hash(seed); return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };

  // Desks réels : remplis par loadReal(), dans ce tableau (les pages gardent la même référence).
  const base = [];
  const NETWORK = 'esmeralda';
  // Classé : au moins RANK_MIN calls clos (un seul bon call ne fait pas un classement).
  const RANK_MIN = 3;
  const DAY = 864e5;
  const horizon = ms => (ms <= 1.5 * DAY ? '24 h' : ms <= 4 * DAY ? '3 j' : '1 sem.');
  // Identifiant d'URL et d'abonnement : le nom on-chain en minuscules (lettres, chiffres, _ . -) suivi de 6 caractères
  // de l'adresse du desk. Audit F2 (09/11) : un autre desk (plus ancien, même nom, homoglyphe) ne peut plus le prendre.
  const slug = (name, address, used) => {
    let s = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9_.-]/g, '').slice(0, 17);
    s = (s.length < 2 ? 'desk' : s) + '-' + address.slice(10, 16);
    used.add(s); return s;
  };

  async function loadReal() {
    const C = window.sdChain, P = window.sdPrices;
    if (!C || !C.published(NETWORK)) return;
    const [desks, epoch, graph, verdicts] = await Promise.all([C.findDesks(NETWORK, null), C.currentEpoch(NETWORK),
      C.followGraph(NETWORK).catch(() => ({ followers: new Map(), following: new Map() })),
      // Verdicts des calls Finance / Politique, publiés avec le site : { "<desk>:<n° on-chain>": ["win"|"loss"|"void", "adresse de la source"] }.
      fetch('verdicts.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : {})).then(o => (o && typeof o === 'object' ? o : {})).catch(() => ({}))]);
    const now = Date.now(), msAt = e => C.epochStart(NETWORK, e, epoch), // V2 : à la minute près (hauteur de bloc)
      used = new Set(), out = [];
    // Recette V1 (09/11) : desks traités 6 à la fois (la boucle en série dépassait 20 s), ordre d'origine conservé.
    // Modération : desks masqués par le modérateur (NETWORKS.<réseau>.hidden) jamais affichés.
    const sorted = [...desks].filter(d => !C.isHidden(NETWORK, d.address)).sort((a, b) => a.openedAtEpoch - b.openedAtEpoch);
    const one = async d => {
      const opened = await C.revealedPayloads(NETWORK, d).catch(() => new Map());
      const calls = await Promise.all(d.calls.map(async k => {
        const ph = C.phase(k, epoch), parts = String(k.label || '').split('|'), sym = parts[0];
        // Étiquette publique : « NFL|BUF@MIN|… » = sport (catégorie visible avant l'ouverture), sinon la paire crypto.
        const sport = ['NFL', 'NBA', 'UCL', 'EPL', 'UFC', 'BOX'].includes(sym) && parts[1];
        // 10/11 : « POL|<autorité>|<sujet>|<date> » = Finance / Politique ; « FREE|<sujet>|<date> » = call libre.
        const pol = sym === 'POL' && parts.length === 4, free = sym === 'FREE' && parts.length === 3;
        const x = { n: k.seq + 1, seq: k.seq, desk: d.address, cat: sport ? 'sport' : pol ? 'pol' : free ? 'free' : 'crypto', sub: pol ? parts[1] : free ? '' : sport ? sym : sym.replace(/USDT$/, ''),
          pair: pol ? parts[2] : free ? parts[1] : sport ? sym + ' ' + parts[1].replace('@', ' @ ') : sym, dir: null, pk: null, hz: '', res: 'live', ago: 0,
          left: Math.max(0, Math.round((msAt(k.revealAtEpoch) - now) / 1000)), buyers: k.sold || 0, price: k.price === null ? 0 : Number(k.price / 1000000n), move: 0,
          sealedAt: msAt(k.sealedAtEpoch), phase: ph, commitment: k.commitment, tlockAt: C.tlockOpensAt(k) };
        // Sans robot (10/11) : un call dont le verrou temporel est tombé est ouvert pour tout le monde, même si personne n'a
        // inscrit son ouverture sur la chaîne. Le site lit sa copie verrouillée (vérifiée contre l'engagement, chain.js lockedCall).
        const lock = ph !== 'revealed' && x.tlockAt && now >= x.tlockAt ? await C.lockedCall(d, k).catch(() => null) : null;
        if (!lock && ph === 'refunding') { x.res = 'never'; x.ago = Math.max(0, (now - msAt(k.revealAtEpoch)) / DAY); return x; }
        if (!lock && ph !== 'revealed') return x;
        const pl = lock ? lock.payload : opened.get(k.seq), c = pl ? C.parseCall(pl) : null;
        x.ago = Math.max(0, (now - (lock ? x.tlockAt : msAt(k.revealedAtEpoch))) / DAY); x.payload = pl || null; if (lock) x.viaLock = true;
        if (c && c.cat === 'sport' && window.sdSports) {
          // Sport (09/11) : résultat lu sur ESPN ; égalité au handicap ou match annulé = « void », ni gagné ni perdu.
          const [kind, who, line] = c.pick, pk = kind === 'WIN' ? (who === 'DRAW' ? ['txt', 'Match nul'] : ['win', who]) : kind === 'SPREAD' ? ['spr', who, Number(line)]
            : kind === 'TOTAL' ? ['tot', who === 'OVER' ? 'O' : 'U', Number(line)] : ['txt', c.pick.join(' ')];
          Object.assign(x, { cat: 'sport', sub: c.league, pair: c.league + ' ' + c.a + (c.league === 'UFC' ? ' vs ' : ' @ ') + c.b, pk, dir: null, opened: true, until: c.when });
          const o = await window.sdSports.outcome(c).catch(() => ({ state: 'unknown' }));
          if (o.state === 'win' || o.state === 'loss') return Object.assign(x, { res: o.state, score: o.score });
          if (o.state === 'push' || o.state === 'void') return Object.assign(x, { res: 'void', score: o.score });
          return Object.assign(x, { res: 'live', unknown: o.state === 'unknown' });
        }
        if (c && c.cat === 'pol') {
          // Finance / Politique : tranché par la plateforme sur la publication officielle (verdicts.json) ; sans verdict, en attente.
          const v = verdicts[d.address + ':' + k.seq];
          Object.assign(x, { cat: 'pol', sub: c.country, pair: c.subject, pk: ['txt', c.choice], opened: true, until: c.when });
          if (v && ['win', 'loss', 'void'].includes(v[0])) return Object.assign(x, { res: v[0], source: typeof v[1] === 'string' ? v[1] : '' });
          return Object.assign(x, { res: 'live', pending: Date.parse(c.when) <= now });
        }
        // Call libre : scellé puis ouvert = preuve d'antériorité ; pas de gagné / perdu, donc hors chiffres et hors classement.
        if (c && c.cat === 'free') return Object.assign(x, { cat: 'free', sub: '', pair: c.subject, pk: ['txt', c.text], opened: true, until: c.when, res: 'free' });
        if (!c || c.cat !== 'crypto') return Object.assign(x, { res: 'live', opened: true, unknown: true });
        Object.assign(x, { dir: c.side, entry: c.entry, tp: c.tp, sl: c.sl, until: c.until, hz: horizon(Date.parse(c.until) - x.sealedAt), opened: true });
        const o = P ? await P.outcome(c, x.sealedAt, d.address.slice(10, 26) + ':' + k.seq).catch(() => null) : null;
        if (!o || o.state === 'open') return Object.assign(x, { res: 'live', left: Math.max(0, Math.round((Date.parse(c.until) - now) / 1000)), move: o ? o.pct : 0 });
        return Object.assign(x, { res: o.state === 'win' ? 'win' : o.state === 'loss' || o.state === 'invalid' ? 'loss' : o.pct > 0 ? 'win' : 'loss', move: o.pct, outcome: o });
      }));
      calls.sort((a, b) => b.n - a.n);
      // ✓ = desk officiel (liste d'adresses de chain.js) : le contrat refuse ce caractère dans un nom, il ne s'imite pas.
      const display = (d.name || ('Desk ' + d.address.slice(10, 14) + '…' + d.address.slice(-4))) + (C.isOfficial(NETWORK, d.address) ? ' ✓' : '');
      return { name: slug(d.name, d.address, used), display, desk: d.address, publisher: d.publisher, payout: d.payout, bio: d.bio, picture: d.picture,
        style: calls.filter(x => x.cat === 'sport').length > calls.length / 2 ? 'sport' : 'crypto', age: Math.max(0, Math.floor((epoch - d.openedAtEpoch) * C.EPOCH_MS / DAY)), openedAtEpoch: d.openedAtEpoch,
        followers: graph.followers.get(d.address) || 0, following: graph.following.get(d.publisher) || 0, allCalls: calls };
    };
    for (let i = 0; i < sorted.length; i += 6) out.push(...await Promise.all(sorted.slice(i, i + 6).map(one)));
    base.splice(0, base.length, ...out);
    memo.clear();
  }
  // Prêt quand la page a chargé ses scripts (chain.js, prices.js) et lu la chaîne ; jamais plus de 60 s d'attente.
  // Une barre « Lecture de la blockchain… » est affichée pendant l'attente (recette V1 : « 0 call » faisait croire à un site vide).
  const bar = document.createElement('div'); bar.className = 'sd-loadbar'; bar.setAttribute('role', 'status');
  bar.textContent = 'Lecture de la blockchain…';
  const showBar = () => { if (window.sdT) bar.textContent = window.sdT(bar.textContent); document.body.appendChild(bar); };
  const SD_READY = new Promise(ok => {
    const go = () => { showBar(); return Promise.race([loadReal(), new Promise(r => setTimeout(r, 60000))]).catch(e => console.warn('[signal-desk] données', e && e.message)).finally(() => { bar.remove(); ok(); }); };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', go, { once: true }); else go();
  });
  window.SD_READY = SD_READY;

  // Chiffres d'une période (7, 30, 90 jours ou 'all') : calls scellés sur la période, réussite sur les calls clos.
  // Un call jamais ouvert compte comme perdu.
  const SPAN = { 7: 7, 30: 30, 90: 90 };
  function stat(c, p) {
    const since = p === 'all' ? 0 : Date.now() - SPAN[p] * DAY;
    const calls = c.allCalls.filter(x => x.sealedAt >= since), closed = calls.filter(x => x.res !== 'live' && x.res !== 'void' && x.res !== 'free');
    const wins = closed.filter(x => x.res === 'win').length, never = closed.filter(x => x.res === 'never').length;
    const last = [...closed].sort((a, b) => a.n - b.n).slice(-10).map(x => (x.res === 'win' ? '1' : '0')).join('');
    let streak = 0; for (let i = last.length - 1; i >= 0 && last[i] === '1'; i--) streak++;
    let best = 0, run = 0; for (const x of last) { run = x === '1' ? run + 1 : 0; best = Math.max(best, run); }
    const prices = calls.map(x => x.price).filter(v => v > 0);
    const moves = closed.filter(x => x.cat === 'crypto' && x.res !== 'never' && Number.isFinite(x.move)).map(x => x.move);
    return { calls: calls.length, closed: closed.length, rate: closed.length ? +(wins / closed.length * 100).toFixed(1) : 0, never, opened: closed.length - never,
      price: prices.length ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : 0, last, streak, best, move: 0, avg: moves.length ? moves.reduce((s, v) => s + v, 0) / moves.length : null, ranked: closed.length >= RANK_MIN };
  }
  const period = p => base.map(c => ({ ...c, ...stat(c, p) }));

  // Profil public d'un caller : son historique réel, réussite par mois, par paire et par direction.
  const memo = new Map();
  function profile(c) {
    if (!memo.has(c.name)) memo.set(c.name, build(c));
    return memo.get(c.name);
  }
  function build(c) {
    const s = stat(c, 'all'), calls = c.allCalls, closed = calls.filter(x => x.res !== 'live' && x.res !== 'free');
    const rate = list => { const d = list.filter(x => x.res !== 'live' && x.res !== 'free'); return d.length ? d.filter(x => x.res === 'win').length / d.length * 100 : 0; };
    const months = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() - (5 - i)); const end = new Date(m); end.setMonth(end.getMonth() + 1);
      return +rate(closed.filter(x => x.sealedAt >= m.getTime() && x.sealedAt < end.getTime())).toFixed(1);
    });
    const pairs = [...new Set(calls.map(x => x.pair))];
    const byPair = pairs.map(p => { const d = closed.filter(x => x.pair === p); return { pair: p, n: d.length, rate: rate(d) }; }).filter(x => x.n);
    const dirs = ['LONG', 'SHORT'].map(dir => { const d = closed.filter(x => x.dir === dir); return { dir, n: d.length, rate: rate(d) }; });
    return { ...c, ...s, total: calls.length, calls, months, byPair, dirs };
  }

  // Avatar : grille 5×5 tirée du nom (même nom = même avatar).
  const NS = 'http://www.w3.org/2000/svg';
  function avatar(seed) {
    let h = 2166136261; const bytes = [];
    for (let i = 0; i < 32; i++) { for (const c of seed + i) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } bytes.push(h & 255); }
    const hue = 190 + bytes[0] % 90, hue2 = (hue + 35 + bytes[1] % 50) % 360;
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 10 10'); svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, w, hh, fill) => { const r = document.createElementNS(NS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hh); r.setAttribute('fill', fill); svg.appendChild(r); };
    rect(0, 0, 10, 10, `hsl(${hue} 40% 13%)`);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      const v = bytes[2 + y * 3 + x]; if (v % 3 === 0) continue;
      const fill = v % 5 === 0 ? `hsl(${hue2} 75% 70%)` : `hsl(${hue} 70% ${52 + v % 18}%)`;
      rect(1 + x * 1.6, 1 + y * 1.6, 1.6, 1.6, fill); if (x < 2) rect(1 + (4 - x) * 1.6, 1 + y * 1.6, 1.6, 1.6, fill);
    }
    return svg;
  }

  // Abonnements : préférence locale (liste de noms) et cloche de notification par caller.
  const NAME = /^[a-z0-9_.-]{2,24}$/;
  // Rangées par compte connecté (suffixe = adresse du compte) : un 2e compte du même navigateur ne voit plus
  // les abonnements, cloches, changements en attente et copies du 1er. Sans wallet : liste du navigateur.
  const acctOf = () => { const w = window.sdWallet, a = w && w.account && w.account(); return a ? '-' + a.slice(10, 26) : ''; };
  let sfx = acctOf();
  const sk = k => k + sfx;
  const read = k => { try { return (localStorage.getItem(sk(k)) || '').split(',').filter(n => NAME.test(n)); } catch (e) { return []; } };
  const write = (k, set) => { try { localStorage.setItem(sk(k), [...set].join(',')); } catch (e) {} };
  let follows = new Set(read('sd-follow')), bells = new Set(read('sd-bell'));
  const follow = {
    has: n => follows.has(n), list: () => [...follows],
    toggle: (n, desk) => { if (!NAME.test(n)) return false; if (follows.has(n)) { follows.delete(n); bells.delete(n); } else { follows.add(n); bells.add(n); } write('sd-follow', follows); write('sd-bell', bells); dispatchEvent(new CustomEvent('sd:follow', { detail: n })); onChain(n, desk, follows.has(n)); return follows.has(n); },
    bell: n => bells.has(n),
    // Audit P2 : suivre ou quitter une collection entière en une écriture et un seul événement (avant : un par membre, jusqu'à 1,5 s).
    setMany: (names, on) => {
      const ch = names.filter(n => NAME.test(n) && follows.has(n) !== on); if (!ch.length) return 0;
      ch.forEach(n => { if (on) { follows.add(n); bells.add(n); } else { follows.delete(n); bells.delete(n); } });
      write('sd-follow', follows); write('sd-bell', bells); dispatchEvent(new CustomEvent('sd:follow', { detail: null }));
      ch.forEach(n => { const c = base.find(x => x.name === n); onChain(n, c && c.desk, on); }); return ch.length;
    },
    toggleBell: n => { if (!follows.has(n)) return false; bells.has(n) ? bells.delete(n) : bells.add(n); write('sd-bell', bells); return bells.has(n); },
  };

  // Abonnements on-chain (D9, contrat SignalFollows) : seulement pour un desk réel et une fois la liste ouverte.
  // Le choix s'affiche tout de suite ; si la signature échoue, il est annulé et l'utilisateur prévenu.
  const COMP = /^component_[0-9a-f]{64}$/;
  const readPending = () => { try { const o = JSON.parse(localStorage.getItem(sk('sd-follow-pending')) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  function onChain(n, desk, on) {
    if (!desk || !COMP.test(desk)) return;
    const p = readPending();
    if (p[desk] !== undefined && p[desk] !== on) delete p[desk]; else p[desk] = on; // aller-retour = rien à inscrire
    try { localStorage.setItem(sk('sd-follow-pending'), JSON.stringify(p)); } catch (e) {}
    dispatchEvent(new Event('sd:follow-pending'));
    if (window.sdFollowSync) window.sdFollowSync(); // abonnement direct : inscrit tout de suite sur la chaîne
  }
  /** Changements en attente d'inscription : { add: [...], remove: [...] }. */
  const pending = () => { const p = readPending(), add = [], remove = []; for (const [d, on] of Object.entries(p)) if (COMP.test(d)) (on === true ? add : on === false ? remove : []).push(d); return { add, remove }; };
  /** Inscrit jusqu'à 50 changements en une signature ; les suivants restent en attente. */
  async function syncFollows(known) {
    const C = window.sdChain, W = window.sdWallet, net = W && W.network();
    if (!C || !net || !C.followsLive(net) || !W.account()) throw Object.assign(new Error('follows not live'), { code: -10 });
    let list = known || null; try { list = list || localStorage.getItem('sd-follows-list-' + W.account().slice(10, 26)); } catch (e) {} if (!list) throw Object.assign(new Error('no list'), { code: -11 });
    const { add, remove } = pending(), r = remove.slice(0, 50), a = add.slice(0, 50 - r.length);
    if (!a.length && !r.length) return 0;
    await C.applyFollows(net, list, a, r);
    const p = readPending(); for (const d of [...a, ...r]) delete p[d];
    try { localStorage.setItem(sk('sd-follow-pending'), JSON.stringify(p)); } catch (e) {}
    dispatchEvent(new Event('sd:follow-pending'));
    return a.length + r.length;
  }

  // Copie suivie (D12) : montant par call et date de début, gardés dans ce navigateur. Aucun ordre n'est passé.
  const readCopies = () => { try { const o = JSON.parse(localStorage.getItem(sk('sd-copy')) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  let copies = readCopies();
  // Changement de compte : relire les listes de ce compte et prévenir les pages.
  addEventListener('sd:me', () => { const x = acctOf(); if (x === sfx) return; sfx = x;
    follows = new Set(read('sd-follow')); bells = new Set(read('sd-bell')); copies = readCopies();
    dispatchEvent(new CustomEvent('sd:follow', { detail: null })); dispatchEvent(new Event('sd:follow-pending')); });
  const copy = {
    get: n => (copies[n] && copies[n].size > 0 ? copies[n] : null), list: () => Object.keys(copies).filter(n => NAME.test(n) && copies[n] && copies[n].size > 0),
    set: (n, size) => { if (!NAME.test(n) || !(size > 0 && size <= 100000)) return false; copies[n] = { size: Math.round(size * 100) / 100, since: (copies[n] && copies[n].since) || Date.now() };
      try { localStorage.setItem(sk('sd-copy'), JSON.stringify(copies)); } catch (e) {} if (!follows.has(n)) follow.toggle(n); dispatchEvent(new Event('sd:follow')); return true; },
    stop: n => { delete copies[n]; try { localStorage.setItem(sk('sd-copy'), JSON.stringify(copies)); } catch (e) {} dispatchEvent(new Event('sd:follow')); },
  };
  /** Ce qu'auraient donné les `n` derniers calls clos d'un profil, `size` TARI par call. */
  function copySim(p, size, n = 30, sinceDays = Infinity) {
    const done = p.calls.filter(x => x.res !== 'live' && x.res !== 'free' && x.ago <= sinceDays).slice(0, n);
    let pnl = 0, peak = 0, dd = 0;
    [...done].reverse().forEach(x => { pnl += size * x.move / 100; peak = Math.max(peak, pnl); dd = Math.min(dd, pnl - peak); });
    const opened = done.filter(x => x.res !== 'never').length;
    return { count: done.length, wins: done.filter(x => x.res === 'win').length, losses: done.filter(x => x.res === 'loss').length, never: done.length - opened,
      pnl: Math.round(pnl * 100) / 100, roi: opened ? pnl / (size * opened) * 100 : 0, drawdown: Math.round(dd * 100) / 100 };
  }

  // Première version publique : crypto seulement (seule catégorie dont le résultat se vérifie sur des prix publics).
  const CATS = { crypto: 'Crypto', sport: 'Sport', pol: 'Finance / Politique', free: 'Libre' };
  const SUBS = { crypto: ['BTC', 'ETH', 'SOL', 'XTM'], sport: ['NFL', 'NBA', 'UCL', 'EPL', 'UFC'], pol: ['SEC', 'FED', 'ECB', 'US', 'FR', 'EU'], free: [] };
  const subName = s => ({ BOX: 'Boxe', UCL: 'Ligue des champions', EPL: 'Premier League', US: 'États-Unis', FR: 'France', BE: 'Belgique', EU: 'Union européenne', GB: 'Royaume-Uni' }[s] || s);
  const T = k => (window.sdT ? window.sdT(k) : k);
  const fmt = v => new Intl.NumberFormat(document.documentElement.lang || 'fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
  /** Ce qui est public avant l'ouverture : la paire, le match ou le sujet. */
  const what = x => x.pair;
  /** Le pronostic scellé, lisible (à n'afficher qu'une fois le call ouvert, ou à son acheteur). */
  function pick(x) {
    const p = x.pk; if (!p) return x.dir;
    const n = v => fmt(Math.abs(v));
    switch (p[0]) {
      case 'win': return T('{x} gagne').replace('{x}', p[1]);
      case 'spr': return p[1] + ' ' + (p[2] < 0 ? '−' : '+') + n(p[2]);
      case 'tot': return T(p[1] === 'O' ? 'Plus de {n} pts' : 'Moins de {n} pts').replace('{n}', n(p[2]));
      case 'prop': return p[1] + ' : ' + p[2] + '+ ' + p[3];
      case 'ko': return T('{x} par KO').replace('{x}', p[1]);
      case 'subm': return T('{x} par soumission').replace('{x}', p[1]);
      case 'dec': return T('{x} aux points').replace('{x}', p[1]);
      case 'rnd': return T(p[1] === 'O' ? 'Plus de {n} rounds' : 'Moins de {n} rounds').replace('{n}', n(p[2]));
      // Texte écrit par le caller (choix d'un call Finance / Politique, call libre) : jamais traduit, masqué s'il enfreint les règles.
      default: return x.cat === 'pol' || x.cat === 'free' ? (window.sdMod ? window.sdMod.clean(p[1]) : p[1]) : T(p[1]);
    }
  }
  /** Résultat d'un call ouvert : variation en crypto, gagné ou perdu ailleurs. */
  const result = x => (x.res === 'never' ? T('jamais ouvert') : x.res === 'free' ? T('Non vérifié') : x.cat === 'pol' && x.res === 'void' ? T('Annulé') : x.cat === 'pol' && x.res === 'live' ? T(x.pending ? 'En attente' : 'En cours') : x.cat === 'crypto' ? (x.move > 0 ? '+' : '') + fmt(x.move) + ' %' : T(x.res === 'win' ? 'Gagné' : 'Perdu'));

  /** Nom du résultat : vocabulaire de trading en crypto, gagné / perdu ailleurs. */
  const resName = x => T(x.cat && x.cat !== 'crypto' && (x.res === 'win' || x.res === 'loss') ? (x.res === 'win' ? 'Gagné' : 'Perdu')
    : x.res === 'live' && x.pending ? 'Résultat officiel attendu'
    : { win: 'Objectif atteint', loss: 'Stop touché', never: 'Jamais ouvert', live: 'En cours', void: 'Annulé ou égalité', free: 'Résultat non vérifié par le site' }[x.res]);
  /** Libellé complet d'un call ouvert : sujet + pronostic. */
  const matchup = x => (x.sub && x.pair.startsWith(x.sub + ' ') ? x.pair.slice(x.sub.length + 1) : what(x));
  const callText = x => what(x) + ' · ' + pick(x);

  follow.pending = pending; follow.sync = syncFollows;
  window.SD_DATA = { network: NETWORK, CATS, SUBS, subName, what, matchup, pick, result, resName, callText, rng, hash, base, period, profile, avatar, follow, copy, copySim, byName: n => base.find(c => c.name === n) || (/-[0-9a-f]{6}$/.test(n) ? null : (m => (m.length === 1 ? m[0] : null))(base.filter(c => c.name.replace(/-[0-9a-f]{6}$/, '') === n))) };
})();
