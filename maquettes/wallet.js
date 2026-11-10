// Wallet (provider window.tari injecté par Sapient, même API que la démo Crypt) + portfolio.
// L'adresse du compte reste en mémoire seulement : rien n'est écrit dans le navigateur.
(() => {
  const TARI_RESOURCE = 'resource_0101010101010101010101010101010101010101010101010101010101010101';
  const t = k => (window.sdT ? window.sdT(k) : k);
  const btn = document.getElementById('walletbtn'), acctEl = document.getElementById('acct');
  const nowallet = document.getElementById('nowallet'), toast = document.getElementById('toast');
  const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
  const outside = [document.querySelector('nav'), document.getElementById('contenu'), document.querySelector('footer'), document.getElementById('hero')];
  let state = null, lastFocus = null, toastTimer = 0;
  addEventListener('sd:toast', e => say(String(e.detail || '')));
  const say = k => { toast.textContent = t(k); toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3200); };
  // Détection : Sapient pose window.tari, s'inscrit dans window.tariProviders et annonce
  // « tari:announceProvider ». L'injection peut arriver après ce script (extension qui se réveille,
  // autre navigateur) : on écoute l'annonce et on revérifie au clic. Sapient est préféré s'il y a
  // plusieurs wallets. Une fois connecté, le provider ne change plus.
  const SAPIENT = 'mw.tari.sapient';
  const usable = p => !!p && typeof p === 'object' && typeof p.request === 'function';
  const isSapient = p => { try { return !!p.info && p.info.rdns === SAPIENT; } catch (e) { return false; } };
  let provider = null;
  function adopt(p) {
    if (state || busy || !usable(p)) return;
    if (!provider || (isSapient(p) && !isSapient(provider))) {
      const first = !provider; provider = p; nowallet.hidden = true;
      try { if (typeof p.on === 'function') p.on('accountsChanged', () => checkAccount()); } catch (e) {} // si Sapient l'annonce : immédiat
      // Audit K10 : wallet injecté tard (après le dernier scan) : la session ouverte est reprise quand même.
      if (first) setTimeout(autoReconnect, 0);
    }
  }
  function scan() {
    try { if (Array.isArray(window.tariProviders)) window.tariProviders.forEach(adopt); } catch (e) {}
    try { adopt(window.tari); } catch (e) {}
    return provider;
  }
  addEventListener('tari:announceProvider', e => adopt(e.detail));
  addEventListener('tari#initialized', scan);
  [0, 300, 1000, 2500, 5000, 10000].forEach(ms => setTimeout(scan, ms)); // audit K10 : wallets lents à s'injecter
  const waitProvider = () => scan() ? Promise.resolve(provider) : new Promise(res => {
    const end = Date.now() + 1200; const iv = setInterval(() => { if (scan() || Date.now() >= end) { clearInterval(iv); res(provider); } }, 150);
  });
  // Pourquoi aucun wallet n'est visible : la page ouverte comme fichier est le cas le plus courant.
  function showNoWallet() {
    const proto = location.protocol, host = location.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
    const [title, why] = proto === 'file:'
      ? ["Page ouverte comme fichier : les extensions n'y ont pas accès.", 'Ouvrez-la par http://127.0.0.1 ou depuis le site en ligne.']
      : proto === 'http:' && !loopback
        ? ['Aucun wallet Tari détecté sur cette page.', "Sapient ne se connecte qu'aux sites en https."]
        : ['Aucun wallet Tari détecté sur cette page.', "Installez l'extension Sapient, puis rechargez la page."];
    document.getElementById('nw-title').textContent = t(title);
    document.getElementById('nw-why').textContent = t(why);
    document.getElementById('nw-hint').textContent = t('Sapient fonctionne sur Chrome, Brave, Edge et Opera.');
    nowallet.hidden = false;
  }
  // Erreurs renvoyées par Sapient (texte anglais fixe) traduites en message utile.
  function walletError(e) {
    const m = String((e && e.message) || '');
    if (e && e.code === 4001 || /reject|denied|declin|cancel/i.test(m)) return 'Connexion refusée dans le wallet.';
    if (e && e.code === -3) return 'Le wallet ne répond pas. Réessayez.';
    if (e && e.code === -2) return 'Adresse de compte inattendue renvoyée par le wallet.';
    if (/no wallet set up/i.test(m)) return "Créez d'abord un compte dans Sapient.";
    if (/locked/i.test(m)) return 'Déverrouillez Sapient, puis réessayez.';
    if (/https/i.test(m)) return "Sapient ne se connecte qu'aux sites en https.";
    return 'Erreur du wallet.';
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('timeout'), { code: -3 })), ms))]);
  const req = (method, params, ms) => withTimeout(provider.request(params === undefined ? { method } : { method, params }), ms || (method === 'tari_requestAccounts' ? 120000 : 15000));
  // Valeurs renvoyées par le wallet : jamais crues sur parole.
  const ACCOUNT = /^component_[0-9a-f]{64}$/;
  const NETWORKS = new Set(['mainnet', 'esmeralda', 'igor', 'localnet']);
  const MICRO = /^\d{1,30}$/;
  const WALLET = /^otl_(?:(?:loc|esm|igr|nxt|stg)_)?1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,300}$/;
  let busy = false;
  // Pour chain.js : signer via le wallet connecté. Aucune autre page ne touche au provider.
  // key() : clé publique du wallet connecté. Audit F1 (09/11) : « mon desk » = desk publié avec cette clé, jamais
  // un desk qui se contente de payer ce compte (n'importe qui peut en ouvrir un vers l'adresse d'un autre).
  window.sdWallet = { req: (m, p, ms) => req(m, p, ms), account: () => state && state.account, network: () => state && state.network,
    key: () => (state && state.wallet && chain() && chain().walletKey(state.wallet)) || null };
  window.sdRender = () => render();
  const SESSION = 'sd-session';
  const session = { on: () => { try { sessionStorage.setItem(SESSION, '1'); } catch (e) {} }, off: () => { try { sessionStorage.removeItem(SESSION); } catch (e) {} },
    has: () => { try { return sessionStorage.getItem(SESSION) === '1'; } catch (e) { return false; } } };

  // Compte validé : réseau, adresse de wallet, solde, puis profil local.
  async function hydrate(account) {
    // Les deux lectures partent ensemble, et le solde n'est plus attendu pour afficher « connecté » :
    // trois allers-retours avec le wallet à la suite rendaient la connexion lente.
    const [rawNet, rawW, nick, pic] = await Promise.all([req('tari_getNetwork').catch(() => ''), req('tari_getWalletAddress').catch(() => null), loadNick(account), loadPic(account)]);
    const network = typeof rawNet === 'string' && NETWORKS.has(rawNet) ? rawNet : '';
    const wallet = typeof rawW === 'string' && WALLET.test(rawW) ? rawW : null;
    state = { account, network, wallet, micro: null, nick, pic };
    btn.classList.add('on'); session.on(); armIdle(); render();
    state.balP = refreshBalance(true);
  }
  async function refreshBalance(quiet) {
    if (!state) return;
    const mine = state, r = $('pf-refresh'); r.classList.add('spin');
    const balances = await req('tari_getBalances').catch(() => null);
    r.classList.remove('spin');
    if (state !== mine) return; // compte changé pendant la lecture : ce solde n'est pas le sien
    if (Array.isArray(balances)) {
      const x = balances.find(b => b && b.resourceAddress === TARI_RESOURCE);
      state.micro = x && MICRO.test(String(x.amount)) ? BigInt(String(x.amount)) : null;
    }
    render(); if (!quiet) say(Array.isArray(balances) ? 'Solde actualisé.' : 'Erreur du wallet.');
  }
  async function connect() {
    if (busy) return;
    if (!(await waitProvider())) { if (nowallet.hidden) showNoWallet(); else nowallet.hidden = true; return; }
    busy = true;
    btn.classList.add('ing');
    try {
      // Extension endormie ou plantée : elle ne répond même pas à une lecture sans autorisation et n'ouvre aucune
      // fenêtre. On le dit au bout de 6 s, sans annuler la demande (une fenêtre lente à valider reste possible).
      req('tari_getNetwork', undefined, 6000).catch(() => { if (busy && !state) say('Sapient ne répond pas : cliquez sur son icône pour le réveiller, puis réessayez.'); });
      const accounts = await req('tari_requestAccounts');
      const account = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof account !== 'string' || !ACCOUNT.test(account)) throw Object.assign(new Error('bad account'), { code: -2 });
      await hydrate(account); openDrawer();
    } catch (e) {
      say(walletError(e));
    } finally { btn.classList.remove('ing'); busy = false; }
  }
  // Reconnexion automatique : tari_getAccounts ne demande rien et renvoie [] si le site n'est plus autorisé.
  async function autoReconnect() {
    if (!(prefs.auto || session.has()) || state || busy || !(await waitProvider())) return;
    busy = true; btn.classList.add('ing'); // Audit K9 : un clic pendant la reconnexion voit qu'elle est en cours.
    try {
      const a = await req('tari_getAccounts'); const account = Array.isArray(a) ? a[0] : null;
      if (typeof account === 'string' && ACCOUNT.test(account)) await hydrate(account);
    } catch (e) {} finally { busy = false; btn.classList.remove('ing'); }
  }
  // Changement de compte (ou de réseau) dans Sapient : le site suit le compte actif. Sapient n'annonce pas toujours
  // ce changement : on relit le compte autorisé à chaque retour sur l'onglet et toutes les 4 s tant qu'il est visible.
  // Nouveau compte = hydrate() complet, puis sd:me : chaque page relit ce qui concerne ce compte.
  let checking = false;
  async function checkAccount() {
    if (!state || busy || checking || !provider || document.hidden) return;
    checking = true;
    try {
      const a = await req('tari_getAccounts', undefined, 8000), net = await req('tari_getNetwork', undefined, 8000).catch(() => state && state.network);
      if (!state || busy) return;
      const account = Array.isArray(a) ? a[0] : undefined;
      if (Array.isArray(a) && !a.length) { disconnect('Compte changé dans Sapient : reconnectez-vous pour ce compte.'); return; }
      if (typeof account !== 'string' || !ACCOUNT.test(account)) return;
      if (account === state.account && (!NETWORKS.has(net) || net === state.network)) return;
      busy = true; btn.classList.add('ing');
      if (acc && acc.open) acc.close();
      await hydrate(account);
      say(t('Compte actif : {n}').replace('{n}', displayName()));
    } catch (e) {} finally { checking = false; if (busy && state) { busy = false; btn.classList.remove('ing'); } }
  }
  ['tari:accountsChanged', 'tari#accountsChanged', 'focus'].forEach(ev => addEventListener(ev, () => checkAccount()));
  document.addEventListener('visibilitychange', () => checkAccount());
  setInterval(checkAccount, 4000);
  // Déconnexion : le site oublie le compte et retire son autorisation dans Sapient.
  let idleTimer = 0;
  function disconnect(msg) {
    const had = !!state; state = null; clearTimeout(idleTimer); session.off();
    btn.classList.remove('on'); acctEl.textContent = ''; $('acct-av').replaceChildren(); $('acct-net').textContent = '';
    btn.setAttribute('aria-label', t('Connecter le wallet'));
    if (!drawer.hidden) closeDrawer();
    if (had && provider) req('tari_disconnect').catch(() => {});
    render();
    if (msg) say(msg);
  }
  function armIdle() { clearTimeout(idleTimer); if (state && prefs.idle > 0) idleTimer = setTimeout(() => disconnect('Déconnecté après inactivité.'), prefs.idle * 60000); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (state && prefs.idle) armIdle(); }, { passive: true }));
  // ---- Profil : avatar dérivé de l'adresse, pseudo local, réglages ----
  const $ = id => document.getElementById(id);
  const hexOf = a => a.replace(/^[a-z]+_/, '').toLowerCase();
  const shortHex = a => { const h = hexOf(a); return h.slice(0, 4) + '…' + h.slice(-4); };
  const NICK = /^[\p{L}\p{N}_.-]{2,24}$/u;
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  // Le pseudo est rangé sous une empreinte de l'adresse : l'adresse elle-même n'est jamais écrite.
  async function nickKey(a) {
    try { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('signal-desk:nick:' + hexOf(a))));
      return 'sd-nick-' + [...d.slice(0, 10)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return null; }
  }
  async function loadNick(a) { const k = await nickKey(a); const v = k && store.get(k); return v && NICK.test(v) ? v : null; }
  // Photo de profil : recadrée en carré 256 px et ré-encodée ici même (les métadonnées EXIF, dont le GPS,
  // ne survivent pas au canvas). Rangée sous une empreinte de l'adresse, jamais envoyée.
  const PIC = /^data:image\/(?:webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
  async function picKey(a) { const k = await nickKey(a); return k && k.replace('sd-nick-', 'sd-pic-'); }
  async function loadPic(a) { const k = await picKey(a); const v = k && store.get(k); return v && v.length < 400000 && PIC.test(v) ? v : null; }
  async function squareFrom(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      const url = URL.createObjectURL(file);
      try { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
      finally { URL.revokeObjectURL(url); }
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight, side = Math.min(w, h);
    if (!side) throw new Error('empty');
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 256, 256);
    if (bmp.close) bmp.close();
    let out = c.toDataURL('image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.86);
    return out;
  }
  const face = () => { if (state.pic) { const im = document.createElement('img'); im.alt = ''; im.src = state.pic; return im; } return avatar(state.account); };
  // Réglages : valeurs relues et bornées, jamais crues sur parole.
  const readPrefs = () => { let p = {}; try { p = JSON.parse(store.get('sd-prefs') || '{}') || {}; } catch (e) {}
    return { hide: p.hide === true, mask: p.mask === true, calm: p.calm === true, no3d: p.no3d === true, auto: p.auto === true,
      warn: p.warn !== false, dec: p.dec === 6 ? 6 : 2, idle: [15, 60].includes(p.idle) ? p.idle : 0 }; };
  const prefs = readPrefs();
  const savePrefs = () => store.set('sd-prefs', JSON.stringify(prefs));
  const applyCalm = () => document.documentElement.classList.toggle('calm', prefs.calm);
  // Scène 3D coupée : repli fixe, la boucle de rendu s'arrête (écouteur « sd:3d » dans le module).
  const apply3d = () => { const h = $('hero'); if (!h) return; if (prefs.no3d) h.classList.add('nogl'); else if (window.__sealReady) h.classList.remove('nogl'); dispatchEvent(new Event('sd:3d')); };
  applyCalm(); apply3d();
  // Avatar : grille 5×5 symétrique dans le cercle, teintes violettes Tari tirées de l'adresse
  // (empreinte FNV : même adresse = même avatar, toujours au moins 8 cases pleines).
  const SVGNS = 'http://www.w3.org/2000/svg';
  function avatar(a) {
    let x = 2166136261; const bytes = [];
    for (let i = 0; i < 20; i++) { for (const c of hexOf(a) + i) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } bytes.push(x & 255); }
    const hue = 258 + bytes[0] % 34, hue2 = (hue + 40 + bytes[1] % 40) % 360;
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', '0 0 10 10');
    const rect = (x, y, w, hh, fill) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hh); r.setAttribute('fill', fill); svg.appendChild(r); };
    rect(0, 0, 10, 10, `hsl(${hue} 48% 20%)`);
    const on = []; for (let i = 0; i < 15; i++) on.push(bytes[2 + i] % 4 !== 0);
    for (let i = 0; on.filter(Boolean).length < 8; i++) on[(bytes[17] + i * 7) % 15] = true;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      if (!on[y * 3 + x]) continue;
      const v = bytes[2 + y * 3 + x], fill = v % 5 === 0 ? `hsl(${hue2} 80% 74%)` : `hsl(${hue} 78% ${60 + v % 16}%)`;
      rect(2 + x * 1.2, 2 + y * 1.2, 1.2, 1.2, fill); if (x < 2) rect(2 + (4 - x) * 1.2, 2 + y * 1.2, 1.2, 1.2, fill);
    }
    return svg;
  }
  // Forme courte de l'adresse de wallet, comme Sapient la montre : préfixe réseau, début, fin.
  const shortWallet = w => { const i = w.lastIndexOf('1'); return w.slice(0, i + 5) + '…' + w.slice(-4); };
  const shortId = () => state.wallet ? shortWallet(state.wallet) : shortHex(state.account);
  const masked = v => prefs.mask ? '••••' : v;
  const displayName = () => state.nick || (prefs.mask ? t('Mon compte') : shortId());
  // Solde exact en BigInt, tronqué au nombre de décimales choisi.
  function fmtTari(m) {
    const loc = document.documentElement.lang, sep = (1.5).toLocaleString(loc).charAt(1);
    const frac = (m % 1000000n).toString().padStart(6, '0').slice(0, prefs.dec);
    return new Intl.NumberFormat(loc).format(m / 1000000n) + (prefs.dec ? sep + frac : '') + ' TARI';
  }
  function render() {
    // Réglages : toujours à jour, même déconnecté.
    const SW = { 'st-hide': 'hide', 'st-mask': 'mask', 'st-calm': 'calm', 'st-auto': 'auto', 'st-warn': 'warn' };
    for (const [id, k] of Object.entries(SW)) $(id).setAttribute('aria-checked', String(prefs[k]));
    $('st-3d').setAttribute('aria-checked', String(!prefs.no3d));
    const sel = $('st-lang');
    if (!sel.options.length) document.querySelectorAll('#langlist li').forEach(li => { const o = document.createElement('option'); o.value = li.dataset.lang; o.textContent = li.firstChild.textContent; sel.appendChild(o); });
    sel.value = window.SD_LANG || 'fr'; $('st-dec').value = String(prefs.dec); $('st-idle').value = String(prefs.idle);
    for (const [id, k] of [['pf-refresh', 'Actualiser le solde'], ['pr-pick', 'Choisir une photo'], ['pr-copy', "Copier l'adresse"], ['pf-acct', "Copier l'adresse"]]) if ($(id)) $(id).setAttribute('aria-label', t(k));
    ['a', 'b', 'c', 'd'].forEach(k => { const n = drawer.querySelectorAll(`#pan-${k} .pf-row`).length; $('cnt-' + k).textContent = n ? (window.sdFmt ? window.sdFmt(n, 0) : n) : ''; drawer.querySelector(`#pan-${k} .empty`).hidden = n > 0; });
    // Compte connecté, en lecture seule, pour les autres scripts de la page (profil). Jamais l'adresse complète.
    window.sdMe = state ? { key: hexOf(state.account), name: displayName(), nick: state.nick, face, masked: prefs.mask } : null;
    dispatchEvent(new Event('sd:me'));
    if (!state) return;
    const net = state.network;
    $('pf-bal').textContent = state.micro === null ? '—' : prefs.hide ? '••••' : fmtTari(state.micro);
    for (const c of [$('acct-net'), $('pf-net')]) { c.textContent = !net ? '' : net === 'mainnet' ? 'mainnet' : 'testnet'; c.classList.toggle('test', net !== 'mainnet'); }
    $('pf-net').title = net;
    const w = !prefs.warn || net === 'mainnet' ? '' : net ? "Testnet : ces TARI n'ont aucune valeur." : 'Réseau inconnu : vérifiez Sapient avant toute transaction.';
    $('pf-warn').hidden = !w; $('pf-warn').textContent = w ? t(w) : '';
    // Bouton, en-tête, profil.
    $('acct-av').replaceChildren(face()); acctEl.textContent = displayName();
    btn.setAttribute('aria-label', `${t('Compte connecté')} : ${displayName()}`);
    $('pf-av').replaceChildren(face()); $('pf-title').textContent = state.nick || t('Mon compte');
    $('pf-acct-t').textContent = masked(shortId());
    if (!$('pr-form')) return;
    $('pr-pic').replaceChildren(face()); $('pr-unpic').hidden = !state.pic;
    $('pr-addrs').hidden = !state.wallet; $('pr-waddr').textContent = state.wallet ? masked(shortWallet(state.wallet)) : '';
    // Pas d'écrasement d'une saisie en cours ; le focus seul ne bloque plus (la fenêtre le met sur ce champ
    // à l'ouverture, parfois avant la reconnexion : le pseudo enregistré n'apparaissait alors jamais).
    const nick = $('pr-nick'); if (!nick.dataset.edit) nick.value = state.nick || ''; nick.placeholder = t('Votre pseudo');
    const bioEl = $('pr-bio'), dk = myDesk();
    if (bioEl) { bioEl.hidden = !dk; bioEl.placeholder = t('Bio publique (160 caractères)'); bioEl.setAttribute('aria-label', t('Bio publique (160 caractères)')); if (dk && !bioEl.dataset.edit) bioEl.value = dk.bio || ''; }
  }
  async function copyText(v) {
    try { await navigator.clipboard.writeText(v); } catch (e) { const ta = document.createElement('textarea'); ta.value = v; drawer.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    say('Adresse copiée.');
  }
  const copyAddress = () => state && copyText(state.wallet || state.account);
  // Identité, adresse : sur la page Profil seulement (section « Mon compte »).
  const hasId = !!$('pr-form');
  $('pf-acct').addEventListener('click', copyAddress);
  if (hasId) $('pr-copy').addEventListener('click', copyAddress);
  // Mon desk (contrat publié, desks avec carte publique) : nom, bio et photo s'inscrivent sur la chaîne, lisibles partout.
  const myDesk = () => { const C = chain(), D = window.SD_DATA; return state && C && C.deskProfiles && C.deskProfiles(state.network) && D ? D.base.find(c => c.payout === state.account && c.publisher === window.sdWallet.key()) || null : null; };
  // Bio : champ ajouté ici (le formulaire est commun aux pages), seulement pour un compte qui a un desk.
  if (hasId && !$('pr-bio')) {
    const b = document.createElement('input'); b.id = 'pr-bio'; b.maxLength = 160; b.autocomplete = 'off'; b.hidden = true;
    $('pr-form').classList.add('has-bio'); $('pr-form').appendChild(b);
    b.addEventListener('input', () => { b.dataset.edit = '1'; });
  }
  if (hasId) $('pr-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!state) return;
    const v = $('pr-nick').value.trim(), k = await nickKey(state.account);
    if (v && !NICK.test(v)) return say('Pseudo invalide.');
    if (k) v ? store.set(k, v) : store.del(k);
    delete $('pr-nick').dataset.edit;
    state.nick = v || null; render();
    const d = myDesk(), bio = $('pr-bio') ? $('pr-bio').value.trim() : '';
    if (!d || !v) return say('Pseudo enregistré.');
    if (window.sdMod && window.sdMod.bad(v + ' ' + bio)) return say('Nom ou bio contraire aux règles du site.');
    if ([...bio].length > 160 || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u061c\u00ad]/.test(bio)) return say('Bio invalide (160 caractères maximum).');
    try { say('Signez dans Sapient pour inscrire votre nom sur la blockchain.'); await chain().setDeskProfile(state.network, d.desk, v, bio); d.display = v; d.bio = bio; if ($('pr-bio')) delete $('pr-bio').dataset.edit; say('Nom et bio inscrits sur la blockchain.'); }
    catch (x) { console.warn('[signal-desk] profil', x && x.message); say(x && x.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); }
  });
  if (hasId) $('pr-nick').addEventListener('input', e => { e.target.dataset.edit = '1'; });
  for (const [id, k] of Object.entries({ 'st-hide': 'hide', 'st-mask': 'mask', 'st-calm': 'calm', 'st-3d': 'no3d', 'st-auto': 'auto', 'st-warn': 'warn' }))
    $(id).addEventListener('click', () => { prefs[k] = !prefs[k]; savePrefs(); if (k === 'calm') applyCalm(); if (k === 'no3d') apply3d(); render(); });
  $('st-lang').addEventListener('change', e => window.sdApplyLang && window.sdApplyLang(e.target.value));
  $('st-dec').addEventListener('change', e => { prefs.dec = e.target.value === '6' ? 6 : 2; savePrefs(); render(); });
  $('st-idle').addEventListener('change', e => { const v = +e.target.value; prefs.idle = [15, 60].includes(v) ? v : 0; savePrefs(); armIdle(); render(); });
  $('pf-refresh').addEventListener('click', () => refreshBalance(false));
  $('st-erase').addEventListener('click', async () => {
    try { Object.keys(localStorage).filter(k => k.startsWith('sd-nick-') || k.startsWith('sd-pic-')).forEach(store.del); } catch (e) {}
    store.del('sd-prefs'); Object.assign(prefs, readPrefs()); applyCalm(); apply3d(); armIdle();
    if (state) { state.nick = null; state.pic = null; } render(); say('Pseudo, photo et réglages effacés.');
  });
  const OK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  async function usePhoto(file) {
    if (!state || !file) return;
    if (!OK_TYPES.has(file.type)) return say('Image illisible. Essayez un JPEG ou un PNG.');
    if (file.size > 10 * 1024 * 1024) return say('Image trop lourde (10 Mo maximum).');
    let data;
    try { data = await squareFrom(file); } catch (e) { return say('Image illisible. Essayez un JPEG ou un PNG.'); }
    if (!PIC.test(data)) return say('Image illisible. Essayez un JPEG ou un PNG.');
    const k = await picKey(state.account);
    try { if (k) localStorage.setItem(k, data); } catch (e) { return say('Espace du navigateur plein : photo non enregistrée.'); }
    state.pic = data; render(); say('Photo enregistrée.');
    const d = myDesk(); if (!d) return;
    try { const hex = await chainPicture(data); say('Signez dans Sapient pour inscrire la photo sur la blockchain.'); await chain().setDeskPicture(state.network, d.desk, hex); say('Photo inscrite sur la blockchain.'); }
    catch (x) { console.warn('[signal-desk] photo', x && x.message); say(x && x.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); }
  }
  // Photo pour la chaîne : 160 px en WebP (JPEG si le navigateur n'encode pas le WebP), sous la limite du contrat (24 Kio).
  async function chainPicture(dataUrl) {
    const im = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = dataUrl; });
    const c = document.createElement('canvas'); c.width = c.height = 160; c.getContext('2d').drawImage(im, 0, 0, 160, 160);
    for (const q of [0.82, 0.65, 0.5, 0.35]) {
      let u = c.toDataURL('image/webp', q); if (!u.startsWith('data:image/webp')) u = c.toDataURL('image/jpeg', q);
      const bin = atob(u.slice(u.indexOf(',') + 1));
      if (bin.length <= 24576) return [...bin].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    }
    throw new Error('picture too large');
  }
  if (hasId) {
  $('pr-pick').addEventListener('click', () => $('pr-file').click());
  $('pr-file').addEventListener('change', e => { usePhoto(e.target.files && e.target.files[0]); e.target.value = ''; });
  $('pr-unpic').addEventListener('click', async () => { const k = state && await picKey(state.account); if (k) store.del(k); if (state) state.pic = null; render(); say('Photo retirée.'); $('pr-pick').focus(); });
  const drop = $('pr-drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { if (![...(e.dataTransfer && e.dataTransfer.types || [])].includes('Files')) return; e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', e => { e.preventDefault(); usePhoto(e.dataTransfer.files && e.dataTransfer.files[0]); });
  }
  // Une image lâchée à côté de la zone ne doit pas ouvrir le fichier à la place du site.
  ['dragover', 'drop'].forEach(ev => drawer.addEventListener(ev, e => e.preventDefault()));
  window.sdOpenDrawer = () => { if (state) openDrawer(); }; // alertes de la cloche (nav.js)
  function openDrawer() {
    if (state && drawer.hidden) refreshBalance(true);
    lastFocus = document.activeElement;
    drawer.hidden = false; scrim.hidden = false;
    outside.forEach(el => el && (el.inert = true));
    document.getElementById('drclose').focus();
  }
  function closeDrawer() {
    drawer.hidden = true; scrim.hidden = true;
    outside.forEach(el => el && (el.inert = false));
    (lastFocus && lastFocus.focus ? lastFocus : btn).focus();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); state ? openDrawer() : connect(); });
  // « Mon compte » : fenêtre flottante (crayon du volet, « Modifier le profil »).
  const acc = $('accdlg');
  if (acc && window.sdMod) acc.appendChild((() => { const p = document.createElement('p'); p.className = 'sd-rules'; p.textContent = t(window.sdMod.RULES); return p; })());
  // Fenêtre fermée sans « Enregistrer » : la saisie non enregistrée est abandonnée.
  if (acc) acc.addEventListener('close', () => { const n = $('pr-nick'); if (n) delete n.dataset.edit; if (state) render(); });
  window.sdOpenProfile = () => {
    if (!state) return connect();
    if (!acc) { location.href = 'profil.html#compte'; return; }
    if (!drawer.hidden) closeDrawer();
    if (!acc.open) { renderFollows(); acc.showModal(); }
    const n = $('pr-nick'); if (n) n.focus();
  };
  // Liste d'abonnements on-chain (contrat SignalFollows) : ouverte une fois, son adresse est gardée ici.
  const flKey = () => state && 'sd-follows-list-' + state.account.slice(10, 26);
  const flMem = {};
  function renderFollows() {
    const txt = $('fl-txt'); if (!txt) return;
    // Fenêtre ouverte avant le chargement de data.js (file des changements) : redessinée une fois la page chargée.
    if (!window.SD_DATA) addEventListener('load', renderFollows, { once: true });
    const C = chain(), net = state && state.network, live = !!(C && net && C.followsLive(net));
    let list = state && flMem[flKey()] || null; try { list = list || (state && localStorage.getItem(flKey())); } catch (e) {}
    // Liste inconnue de ce navigateur : on la cherche une fois par son événement d'ouverture (clé du wallet).
    if (!list && live && state && renderFollows.tried !== flKey()) {
      renderFollows.tried = flKey();
      C.privateFollowsList(net).then(l => { if (l && state) { try { localStorage.setItem(flKey(), l); } catch (e) {} renderFollows(); } }).catch(() => {});
    }
    txt.textContent = list ? t('Liste ouverte : {a}').replace('{a}', list.slice(0, 18) + '…' + list.slice(-6))
      : live ? t('Vos abonnements seront inscrits sur la blockchain dès votre premier enregistrement : la liste s\'ouvre toute seule.')
      : t('Disponible dès la publication du contrat d\'abonnements. En attendant, vos abonnements restent dans ce navigateur.');
    // File des changements : une seule signature pour tout inscrire (la première fois, la liste s'ouvre avant).
    const D = window.SD_DATA, s = $('fl-sync'), p = D && D.follow.pending ? D.follow.pending() : { add: [], remove: [] }, n = p.add.length + p.remove.length;
    s.hidden = !live || !n;
    if (live && n) txt.textContent = t(list ? '{n} changements à enregistrer : une seule signature pour tout inscrire.' : '{n} changements à enregistrer : la première fois, Sapient ouvre aussi votre liste (deux signatures).').replace('{n}', n);
  }
  addEventListener('sd:follow-pending', () => { if (acc && acc.open) renderFollows(); });
  // Abonnement direct (09/11) : chaque « Suivre » / « Ne plus suivre » s'inscrit tout de suite (Sapient s'ouvre).
  // Le bouton « Enregistrer » reste pour ce qui n'a pas pu être signé (signature refusée, wallet fermé).
  let flBusy = false, flAgain = false;
  window.sdFollowSync = async () => {
    if (!state || !published(state.network) || !chain() || !chain().followsLive(state.network)) return;
    if (flBusy) { flAgain = true; return; }
    flBusy = true;
    try { do { flAgain = false; await syncFollowsNow(); } while (flAgain && state); } finally { flBusy = false; }
  };
  async function syncFollowsNow() {
    const s = $('fl-sync') || {}, st = state; if (!st) return; s.disabled = true;
    const key = 'sd-follows-list-' + st.account.slice(10, 26);
    let list = flMem[key] || null; try { list = list || localStorage.getItem(key); } catch (e) {}
    try {
      // Pas encore de liste : elle s'ouvre ici, sans bouton à part. Gardée en mémoire même si le stockage est plein (audit K5).
      if (!list) { list = flMem[key] = await chain().openFollows(st.network); try { localStorage.setItem(key, list); } catch (e) {} }
      if (!state || state.account !== st.account) return;
      const n = await window.SD_DATA.follow.sync(list); if (n) say(t('{n} changements inscrits sur la blockchain.').replace('{n}', n));
    }
    catch (e) { console.warn('[signal-desk] abonnements', e && e.message); say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); }
    finally { s.disabled = false; if (state) renderFollows(); }
  }
  if ($('fl-sync')) $('fl-sync').addEventListener('click', () => window.sdFollowSync());
  if (acc) {
    acc.addEventListener('toggle', () => { if (acc.open) renderFollows(); });
    $('pf-edit').addEventListener('click', e => { e.stopPropagation(); window.sdOpenProfile(); });
    $('acc-x').addEventListener('click', () => acc.close());
    acc.addEventListener('click', e => { if (e.target === acc) acc.close(); }); // clic sur le fond
    // Arrivée par profil.html#compte : ouverte dès que le wallet est reconnu.
    const fromHash = () => { if (location.hash === '#compte' && state && !acc.open) { history.replaceState(null, '', location.pathname + location.search); window.sdOpenProfile(); } };
    addEventListener('sd:me', fromHash); addEventListener('hashchange', fromHash); setTimeout(fromHash, 0);
  }
  // « Sceller un call » : fenêtre à part, ouverte par le menu Créer (#sceller). Le desk n'est pas le compte.
  const seal = $('sealdlg');
  window.sdOpenSeal = () => {
    if (!state) return connect();
    if (!seal) { location.href = 'site-signal-desk.html#sceller'; return; }
    if (!drawer.hidden) closeDrawer();
    if (acc && acc.open) acc.close();
    if (!seal.open) seal.showModal();
  };
  if (seal) {
    $('seal-x').addEventListener('click', () => seal.close());
    seal.addEventListener('click', e => { if (e.target === seal) seal.close(); }); // clic sur le fond
    // Sans wallet : une seule demande de connexion (connect() bascule l'invite, un 2e appel la refermait) ;
    // la fenêtre s'ouvre dès que le wallet est reconnu (sd:me).
    let asked = false;
    const fromHash = () => {
      if (location.hash !== '#sceller') return;
      if (!state) { if (!asked) { asked = true; connect(); } return; }
      asked = false; history.replaceState(null, '', location.pathname + location.search); window.sdOpenSeal();
    };
    addEventListener('sd:me', fromHash); addEventListener('hashchange', fromHash); setTimeout(fromHash, 0);
  }
  document.querySelectorAll('.wallet-open').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); if (state) return openDrawer(); if (!scan()) scrollTo({ top: 0 }); connect(); }));
  document.addEventListener('click', e => { if (!e.target.closest('.walletdock')) nowallet.hidden = true; });
  document.getElementById('drclose').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.getElementById('disconnect').addEventListener('click', () => disconnect('Déconnecté.'));
  drawer.querySelectorAll('.empty a').forEach(a => a.addEventListener('click', closeDrawer));
  // Piège de focus + Échap dans le panneau.
  drawer.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const f = [...drawer.querySelectorAll('button:not([tabindex="-1"]),a[href],input,select,[tabindex="0"]')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  // Onglets (motif ARIA complet : flèches, Début, Fin).
  drawer.querySelectorAll('[role="tablist"]').forEach(list => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = tab => tabs.forEach(x => { const on = x === tab; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', e => {
        const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (k === undefined) return;
        e.preventDefault(); const n = tabs[(k + tabs.length) % tabs.length]; select(n); n.focus();
      });
    });
  });
  // ---- Achat d'un call : tout est vérifié et dit en clair avant que Sapient ne demande de signer ----
  // Achat réel seulement si la commande vise un vrai desk (adresse + numéro) sur un réseau où le contrat
  // Signal Desk est publié (chain.js) ; sinon la fenêtre explique et la signature reste bloquée.
  const chain = () => window.sdChain;
  const published = net => !!(chain() && net && chain().published(net));
  const dlg = $('buydlg'); let order = null, buying = false, checkGen = 0;
  const tari = n => (window.sdFmt ? window.sdFmt(n, 0) : n) + ' TARI';
  // Mouvement (%) d'une paire crypto depuis `since` (prix publics Binance), ou null si illisible.
  async function pairMove(label, since) {
    const s = String(label || '').toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(s)) return null;
    const sym = /(USDT|USDC|FDUSD|BTC|ETH|BNB|EUR|TRY)$/.test(s) && s.length > 4 ? s : s + 'USDT';
    try {
      const [k, p] = await Promise.all([fetch('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=1m&limit=1&endTime=' + Math.floor(since)).then(r => r.json()),
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + sym).then(r => r.json())]);
      const a = +(k && k[0] && k[0][1]), b = +(p && p.price);
      return a > 0 && b > 0 ? (b / a - 1) * 100 : null;
    } catch (e) { return null; }
  }
  async function checkOrder() {
    // Audit K7 : une seule vérification compte, la dernière lancée ; ses données viennent toutes de la même commande.
    const o = order, g = ++checkGen, go = $('bd-go'), items = []; let info = null;
    const stale = () => !dlg.open || g !== checkGen;
    $('bd-sub').textContent = t('Le prochain call de {d}').replace('{d}', o.desk); $('bd-price').textContent = tari(o.price);
    $('bd-what').textContent = t('Un seul paiement de {p} au contrat Signal Desk, pour le desk {d}. Aucune autorisation permanente, aucun autre transfert.').replace('{p}', tari(o.price)).replace('{d}', o.desk);
    if (state) {
      // Réseau relu à l'instant dans Sapient, jamais pris dans le cache : il a pu changer depuis la connexion.
      const raw = await req('tari_getNetwork').catch(() => '');
      if (!state || stale()) return;
      state.network = typeof raw === 'string' && NETWORKS.has(raw) ? raw : '';
      await refreshBalance(true);
      if (!state || stale()) return;
    }
    // Audit K8 : un prix non entier faisait lever BigInt hors de tout catch et figeait la fenêtre.
    const net = state && state.network, need = /^\d{1,9}$/.test(String(o.price)) ? BigInt(o.price) * 1000000n : 0n;
    $('bd-from').textContent = state ? masked(shortId()) : '—';
    $('bd-net').textContent = net || '—';
    if (!need) items.push([false, 'Prix du call illisible : achat impossible.']);
    items.push([!!state, state ? 'Wallet connecté' : 'Wallet non connecté']);
    if (state) {
      items.push([!!net, net === 'mainnet' ? 'Réseau vérifié : mainnet' : net ? "Réseau vérifié : testnet (ces TARI n'ont aucune valeur)" : 'Réseau inconnu : vérifiez Sapient.']);
      items.push([state.micro !== null && state.micro >= need, state.micro === null ? 'Solde illisible : actualisez-le dans le volet wallet.' : state.micro >= need ? 'Solde suffisant'
        // 10/11 : le refus dit les deux montants. Le prix est retiré du solde public du compte : des TARI privés ne le paient pas.
        : t('Solde insuffisant : {a} disponibles, {b} nécessaires. Un call se paie avec des TARI publics, pas avec des TARI privés.').replace('{a}', tari(Number(state.micro / 1000000n))).replace('{b}', tari(o.price))]);
    }
    const live = state ? published(net) : false;
    items.push([live, live ? 'Contrat Signal Desk publié sur ce réseau' : 'Achat disponible dès la publication du contrat Signal Desk.']);
    if (live) {
      // Lecture réelle du call : en vente, et au prix affiché. Le montant signé sera exactement celui-ci.
      let ok = false, msg = "Ce desk d'exemple n'existe pas sur la chaîne.";
      if (o.addr) {
        try {
          const [d, ep] = await Promise.all([chain().readDesk(net, o.addr), chain().currentEpoch(net)]);
          const c = d.calls[o.seq];
          if (c && chain().phase(c, ep) === 'on-sale') {
            o.micro = c.price; ok = c.price === BigInt(o.price) * 1000000n; msg = ok ? 'Desk et prix vérifiés sur la chaîne' : 'Prix sur la chaîne différent du prix affiché.';
            // Avant de payer : l'âge du call et le mouvement de la paire depuis le scellé (le résultat se mesure depuis là).
            const age = Math.max(0, (ep - c.sealedAtEpoch) * chain().EPOCH_MS), move = await pairMove(c.label, Date.now() - age);
            if (!state || stale()) return;
            const h = new Intl.NumberFormat(document.documentElement.lang || 'fr', { maximumFractionDigits: 0 }).format(age / 3600e3);
            info = move === null ? t('Scellé il y a {h} h.').replace('{h}', h)
              : t('Scellé il y a {h} h : {p} a bougé de {m} depuis.').replace('{h}', h).replace('{p}', c.label).replace('{m}', (move > 0 ? '+' : '') + (window.sdFmt ? window.sdFmt(move, 1) : move.toFixed(1)) + ' %');
            // P2 (09/11) : on n'achète pas un call déjà à moitié joué, ni un call qui s'ouvre dans moins de 2 h.
            const span = c.revealAtEpoch - c.sealedAtEpoch, gone = ep - c.sealedAtEpoch, left = c.revealAtEpoch - ep;
            if (ok && span > 0 && gone / span > 0.5) { ok = false; msg = 'Plus de la moitié de la durée de ce call est écoulée : achat bloqué pour vous protéger.'; }
            else if (ok && left < 2) { ok = false; msg = "Ce call s'ouvre dans moins de 2 h : achat bloqué pour vous protéger."; }
            if (ok && move !== null && Math.abs(move) > 2) info = '⚠ ' + info + ' ' + t('Le call a pu être déjà entamé.');
            // Call libre (10/11) : dit avant de payer que personne ne vérifiera son résultat.
            if (String(c.label).startsWith('FREE|')) info = '⚠ ' + t('Call libre : son résultat n’est pas vérifié par le site et il ne compte pas au classement.') + ' ' + info;
          }
          else msg = "Ce call n'est plus en vente.";
        } catch (e) { msg = 'Desk illisible sur la chaîne.'; }
        if (!state || stale()) return;
      }
      items.push([ok, msg]);
      // Information, pas une condition : livraison et remboursement rappelés avant de signer.
      if (ok) { if (info) items.push([true, info]); items.push([true, "Livré par le caller avant l'ouverture ; sinon remboursable depuis votre portfolio (bouton Rembourser)."]); }
    }
    if (stale()) return;
    $('bd-checks').replaceChildren(...items.map(([ok, k]) => { const li = document.createElement('li'); li.className = ok ? 'ok' : ''; li.textContent = t(k); return li; }));
    $('bd-get').hidden = !state || (state.micro !== null && state.micro >= need);
    go.textContent = t(state ? 'Signer dans Sapient' : 'Connecter le wallet');
    go.disabled = !!state && !items.every(([ok]) => ok);
  }
  function openOrder(b) {
    const price = +b.dataset.price;
    if (!/^[a-z0-9_.-]{2,24}$/.test(b.dataset.desk) || !(price > 0 && price < 1e6)) return;
    // Vrai desk : adresse du composant et numéro du call, lus sur la chaîne par l'appelant.
    const addr = /^component_[0-9a-f]{64}$/.test(b.dataset.addr || '') && /^\d{1,4}$/.test(b.dataset.seq || '') ? b.dataset.addr : null;
    order = { desk: b.dataset.desk, price, addr, seq: addr ? +b.dataset.seq : null };
    $('bd-checks').replaceChildren(); $('bd-get').hidden = true; $('bd-go').disabled = true; $('bd-go').textContent = t('Vérification…');
    dlg.showModal(); checkOrder();
  }
  document.querySelectorAll('.buy').forEach(b => b.addEventListener('click', () => openOrder(b)));
  // Boutons d'achat créés après le chargement (profils) : même fenêtre, mêmes vérifications.
  window.sdBuy = (desk, price, addr, seq) => openOrder({ dataset: { desk: String(desk), price: String(price), addr: addr || '', seq: seq === undefined ? '' : String(seq) } });
  // Lien d'achat d'un vrai call (?achat=<desk>&n=<numéro>&r=<réseau>), copié depuis « Mes calls » du vendeur :
  // le call est relu sur la chaîne (en vente, prix), puis la fenêtre d'achat habituelle s'ouvre.
  (async () => {
    const q = new URLSearchParams(location.search), addr = q.get('achat') || '', seq = q.get('n') || '', net = q.get('r') || '';
    if (!/^component_[0-9a-f]{64}$/.test(addr) || !/^\d{1,4}$/.test(seq) || !NETWORKS.has(net)) return;
    for (let i = 0; i < 50 && !chain(); i++) await new Promise(r => setTimeout(r, 100));
    const C = chain(); if (!C || !C.published(net)) return say("Lien d'achat invalide.");
    try {
      const [desk, epoch] = await Promise.all([C.readDesk(net, addr), C.currentEpoch(net)]), call = desk.calls[+seq];
      if (!call || C.phase(call, epoch) !== 'on-sale') return say("Ce call n'est plus en vente.");
      const micro = call.price; if (micro % 1000000n) return say('Prix du call illisible : achat impossible.');
      window.sdBuy('desk-' + addr.slice(10, 16), Number(micro / 1000000n), addr, +seq);
    } catch (e) { console.warn('[signal-desk] lien achat', e && e.message); say('Blockchain injoignable pour le moment : réessayez dans un instant.'); }
  })();
  $('bd-go').addEventListener('click', async () => {
    if (!state) {
      dlg.close(); await connect();
      if (state && order) { if (!drawer.hidden) closeDrawer(); dlg.showModal(); checkOrder(); }
      return;
    }
    if (buying || !order || !order.addr || !published(state.network)) return;
    // chain.js relit le call sur la chaîne (en vente, prix) avant de demander la signature.
    // Un seul achat par call depuis ce navigateur : le remboursement retire « un » badge du call.
    if (window.sdPurchases && window.sdPurchases.has(order.addr, order.seq)) {
      // La clé est gardée AVANT la signature : si la chaîne ne connaît pas cet achat après 2 min, il n'a jamais été signé.
      const p = window.sdPurchases.get(order.addr, order.seq), r = await chain().readPurchase(state.network, p).catch(() => null);
      if (!r || r.state !== 'missing') return say('Vous avez déjà acheté ce call.');
      if (Date.now() - (p.at || 0) < 120e3) return say('Achat précédent en attente sur la chaîne : réessayez dans 2 minutes.');
      window.sdPurchases.drop(order.addr, order.seq);
    }
    buying = true; const go = $('bd-go'); go.disabled = true; go.textContent = t('Signature dans Sapient…');
    try {
      // La clé de vente est enregistrée dans ce navigateur AVANT la signature : sans elle, ni lecture ni litige.
      const { id } = await chain().buy(state.network, order.addr, order.seq, p => window.sdPurchases.keep(p), undefined, order.micro);
      dlg.close(); say('Achat confirmé. Badge déposé dans votre compte.'); console.info('[signal-desk] achat', id);
      refreshBalance(true); dispatchEvent(new Event('sd:purchases'));
    } catch (e) {
      say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : e && (e.name === 'QuotaExceededError' || /^storage/.test(e.message || '')) ? 'Espace du navigateur plein : libérez de la place puis réessayez.' : e && /not on sale/.test(e.message) ? "Ce call n'est plus en vente." : e && /price changed/.test(e.message) ? 'Le prix a changé : vérifiez de nouveau avant de signer.'
        // La raison du réseau ou du wallet reste visible : sans elle, un échec ne se diagnostique pas.
        : t('Achat refusé par le réseau.') + (e && e.tx ? ' ' + (e.reason || '') + ' · tx ' + e.tx.slice(0, 16) : e && e.message ? ' (' + String(e.message).slice(0, 200) + ')' : ''));
      console.warn('[signal-desk] achat', e && e.message);
      if (dlg.open) checkOrder();
    } finally { buying = false; }
  });
  [$('bd-x'), $('bd-cancel'), $('bd-get')].forEach(b => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  // Comptes à rebours du portfolio.
  // Audit P9 : échéance fixe (le temps restant se recalcule) et horloge arrêtée volet fermé ou onglet caché.
  const t0 = Date.now(), ticks = [...drawer.querySelectorAll('.pf-tick')].map(el => ({ el, end: t0 + 1000 * +el.dataset.tick }));
  const fmt = s => { const d = Math.floor(s / 86400), p = n => String(n).padStart(2, '0'), hms = `${p(Math.floor(s % 86400 / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
    return d ? new Intl.NumberFormat(document.documentElement.lang, { style: 'unit', unit: 'day', unitDisplay: 'short' }).format(d) + ' ' + hms : hms; };
  const tick = () => ticks.forEach(x => { x.el.textContent = fmt(Math.max(0, Math.round((x.end - Date.now()) / 1000))); });
  let tickIv = 0;
  const clock = () => { const on = ticks.length && !drawer.hidden && !document.hidden; if (on && !tickIv) { tick(); tickIv = setInterval(tick, 1000); } else if (!on && tickIv) { clearInterval(tickIv); tickIv = 0; } };
  tick(); clock();
  document.addEventListener('visibilitychange', clock);
  new MutationObserver(clock).observe(drawer, { attributes: true, attributeFilter: ['hidden'] });
  // Changement de langue : les textes dynamiques suivent.
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); render(); if (!state) btn.setAttribute('aria-label', t('Connecter le wallet')); if (dlg.open) checkOrder(); };
  render(); autoReconnect();
})();
