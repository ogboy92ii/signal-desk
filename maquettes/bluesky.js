// Connexion Bluesky (D11) : identité + publication (scope « atproto transition:generic », 09/11) pour répondre aux
// discussions depuis le site. Le site ne publie QUE les réponses que vous écrivez et validez vous-même ici.
// Partage d'un profil = lien officiel bsky.app/intent/compose, que vous validez dans Bluesky.
// Librairie : @atproto/oauth-client-browser 0.5.10 (équipe Bluesky), bundle vendor/atproto-oauth.js,
// paquets figés dans vendor/atproto-oauth.lock.json. En local (127.0.0.1) : client « loopback » prévu par
// Bluesky pour le développement ; en ligne : client-metadata.json servi par le site (à écrire au déploiement).
(() => {
  const $ = id => document.getElementById(id);
  // La librairie (218 Ko) n'est chargée qu'au besoin : connexion, retour de Bluesky, ou session déjà ouverte ici.
  const FLAG = 'sd-bsky';
  let libP = null;
  const lib = () => libP || (libP = new Promise((ok, ko) => {
    if (window.sdAtproto) return ok(window.sdAtproto);
    const s = document.createElement('script'); s.src = 'vendor/atproto-oauth.js';
    s.onload = () => (window.sdAtproto ? ok(window.sdAtproto) : ko(new Error('bluesky library missing')));
    s.onerror = () => { libP = null; ko(new Error('bluesky library missing')); };
    document.head.appendChild(s);
  }));
  const flag = on => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch (e) {} };
  const hadSession = () => { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } };
  const t = k => (window.sdT ? window.sdT(k) : k);
  const loopback = location.hostname === '127.0.0.1' || location.hostname === '[::1]';
  let client = null, me = null, session = null;
  const SCOPE = 'atproto transition:generic';
  const toast = $('toast'); let timer = 0;
  const say = k => { if (!toast) return; toast.textContent = t(k); toast.classList.add('show'); clearTimeout(timer); timer = setTimeout(() => toast.classList.remove('show'), 3200); };
  async function getClient() {
    if (client) return client;
    const A = await lib();
    // Local : client « loopback » sans chemin dans l'identifiant (sinon refusé), page de retour en paramètre.
    // Page de retour fixe (profil.html) : l'identifiant du client en dépend, et une session ouverte sous un autre
    // identifiant (autre page) était refusée puis effacée par la librairie au chargement suivant.
    // En ligne : client-metadata.json servi par le site (à écrire au déploiement).
    const clientId = loopback
      ? 'http://localhost?redirect_uri=' + encodeURIComponent(location.origin + location.pathname.replace(/[^/]*$/, 'profil.html')) + '&scope=' + encodeURIComponent(SCOPE)
      : location.origin + '/client-metadata.json';
    client = await A.BrowserOAuthClient.load({ clientId, handleResolver: 'https://bsky.social' });
    return client;
  }
  // Profil public (handle, nom, avatar) lu sur l'API publique à partir du DID de la session.
  async function loadProfile(did) {
    const r = await fetch('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(did));
    const p = r.ok ? await r.json() : null;
    if (!p || p.did !== did || typeof p.handle !== 'string') return { did, handle: null };
    return { did, handle: p.handle, name: typeof p.displayName === 'string' ? p.displayName.slice(0, 64) : '', avatar: /^https:\/\/cdn\.bsky\.app\//.test(p.avatar || '') ? p.avatar : null };
  }
  function render() {
    const off = $('bs-off'), on = $('bs-on');
    if (!off) return;
    off.hidden = !!me; on.hidden = !me;
    if (me) $('bs-handle').textContent = me.handle ? '@' + me.handle : me.did;
    window.sdBluesky.me = me;
    dispatchEvent(new Event('sd:bluesky'));
  }
  window.sdBluesky = {
    me: null,
    /** Ouvre le composeur Bluesky avec ce texte ; rien n'est publié sans votre validation. */
    share(text) { window.open('https://bsky.app/intent/compose?text=' + encodeURIComponent(String(text).slice(0, 300)), '_blank', 'noopener'); },
    /** Connexion (redirige vers Bluesky puis revient sur le profil). */
    connect: () => signIn(),
    /** La session permet-elle de publier ? (connexions d'avant le 09/11 : identité seulement) */
    async canPost() {
      if (!session) return false;
      try { const i = await session.getTokenInfo(); return String(i && i.scope || '').split(' ').includes('transition:generic'); } catch (e) { return false; }
    },
    /** Répond à un post : `root` et `parent` = { uri, cid }. Texte de 1 à 300 caractères, publié avec votre compte. */
    async reply(root, parent, text) {
      if (!session || !me) throw new Error('not connected');
      const body = String(text || '').trim();
      if (!body || [...body].length > 300) throw new RangeError('text length');
      const ok = x => x && /^at:\/\//.test(x.uri || '') && typeof x.cid === 'string';
      if (!ok(root) || !ok(parent)) throw new TypeError('bad post reference');
      const record = { $type: 'app.bsky.feed.post', text: body, createdAt: new Date().toISOString(), langs: [document.documentElement.lang || 'fr'],
        reply: { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } } };
      const r = await session.fetchHandler('/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repo: me.did, collection: 'app.bsky.feed.post', record }) });
      if (!r.ok) throw new Error('bluesky ' + r.status);
      return r.json();
    },
  };
  async function signIn(e) {
    if (e) e.preventDefault();
    // Direct sur Bluesky, qui demande lui-même le compte à connecter.
    try { await (await getClient()).signIn('https://bsky.social', { scope: SCOPE }); } // redirige vers Bluesky puis revient ici
    catch (x) { console.warn('[signal-desk] bluesky', x && x.message); say('Connexion Bluesky impossible.'); }
  }
  async function signOut() {
    try { if (me) await (await getClient()).revoke(me.did); } catch (x) {}
    me = null; session = null; flag(false); render(); say('Bluesky déconnecté.');
  }
  if ($('bs-form')) { $('bs-form').addEventListener('submit', signIn); $('bs-out').addEventListener('click', signOut); }
  // Au chargement : retour de Bluesky (paramètres dans l'URL) ou session déjà ouverte.
  const back = /[?&#](state|code|iss|error)=/.test(location.search + location.hash);
  (async () => {
    if (back || hadSession()) {
      try {
        const r = await (await getClient()).init();
        if (r && r.session) { session = r.session; me = await loadProfile(r.session.sub); flag(true); if (r.state !== undefined) say('Bluesky connecté.'); }
        else flag(false);
      } catch (x) { console.warn('[signal-desk] bluesky', x && x.message); }
    }
    render();
  })();
})();
