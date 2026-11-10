// Social (D13) : badges de réputation et discussions Bluesky. Aucun serveur Signal Desk.
// - Badges : calculés depuis l'historique du caller (la chaîne une fois le contrat publié, les exemples
//   d'ici là) ; rien n'est déclaratif, donc rien ne s'achète ni ne se falsifie.
// - Discussions : les posts Bluesky qui contiennent le lien d'un call ou d'un profil, et leurs réponses,
//   lus sur l'API publique (api.bsky.app, sans compte, CORS ouvert). Répondre = ouvrir Bluesky.
(() => {
  const t = k => (window.sdT ? window.sdT(k) : k);
  const num = v => (window.sdFmt ? window.sdFmt(v, 0) : String(v));

  /** Badges d'un profil : { id, label, hint }. `p` = profil (calls, total, rate, never, age, rank, frauds?). */
  function badges(p) {
    const out = [], closed = p.calls.filter(c => c.res !== 'live');
    let streak = 0; for (const c of closed) { if (c.res === 'win') streak++; else break; }
    const add = (id, label, hint) => out.push({ id, label: t(label), hint: t(hint) });
    const won = closed.some(c => c.res === 'win'); // un rang sans aucun call gagné ne vaut pas un badge
    if (won && p.rank && p.rank <= 3) add('podium', 'Podium du mois', 'Dans les 3 premiers du classement sur 30 jours.');
    else if (won && p.rank && p.rank <= 10) add('top10', 'Top 10 du mois', 'Dans les 10 premiers du classement sur 30 jours.');
    if (streak >= 5) add('streak', 'Série de {n}'.replace('{n}', num(streak)), 'Ses {n} derniers calls ouverts ont atteint leur objectif.'.replace('{n}', num(streak)));
    if (p.total >= 100) add('c100', '100 calls scellés', 'Au moins 100 calls scellés et numérotés dans son desk.');
    else if (p.total >= 50) add('c50', '50 calls scellés', 'Au moins 50 calls scellés et numérotés dans son desk.');
    if (!p.never && p.total >= 20) add('open', 'Rien de caché', 'Aucun call jamais ouvert : tous ses calls ont été publiés à l\'échéance.');
    if (!(p.frauds > 0) && p.total >= 10) add('clean', 'Aucune fraude', 'Aucune livraison jugée frauduleuse par le contrat.');
    if (p.age >= 365) add('y1', '1 an de track record', 'Desk ouvert depuis plus d\'un an : son historique ne peut pas être rajeuni.');
    else if (p.age >= 180) add('m6', '6 mois de track record', 'Desk ouvert depuis plus de six mois.');
    if (p.rate >= 60 && closed.length >= 30) add('sharp', 'Précis', 'Au moins 60 % de réussite sur 30 calls ou plus.');
    return out;
  }

  // ---- Discussions Bluesky --------------------------------------------------------------------
  const API = 'https://api.bsky.app/xrpc/';
  // Cache 60 s et fusion des requêtes identiques : une discussion très vue ne multiplie pas les appels à Bluesky.
  const cache = new Map();
  const get = path => {
    const c = cache.get(path); if (c && Date.now() - c.t < 60000) return c.p;
    const p = fetch(API + path).then(r => { if (!r.ok) throw new Error('bluesky ' + r.status); return r.json(); });
    cache.set(path, { t: Date.now(), p }); p.catch(() => cache.delete(path)); return p;
  };
  const clean = s => String(s || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, ' ').slice(0, 600);
  /**
   * Posts qui partagent `url` (lien exact) et leurs réponses directes, du plus récent au plus ancien.
   * Chaque post : auteur, avatar, texte, lien partagé (aperçu de l'article si Bluesky en a un), compteurs, uri/cid (pour répondre).
   */
  async function discussion(url, limit = 10) {
    const s = await get('app.bsky.feed.searchPosts?q=*&sort=latest&limit=' + limit + '&url=' + encodeURIComponent(url));
    const posts = Array.isArray(s.posts) ? s.posts : [];
    const str = v => (typeof v === 'string' ? v : '');
    const int = v => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
    // Liens acceptés : https (images : cdn.bsky.app seulement), et le site local pendant les tests.
    const safe = (u, host) => { try { const x = new URL(str(u)); if (x.protocol === 'https:' && (!host || host.test(x.hostname))) return x.href; return !host && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(x.href) ? x.href : ''; } catch (e) { return ''; } };
    const CDN = /(^|\.)cdn\.bsky\.app$/;
    const view = p => {
      const a = (p && typeof p.author === 'object' && p.author) || {}, r = (p && typeof p.record === 'object' && p.record) || {}, handle = str(a.handle), uri = str(p && p.uri);
      // Lien partagé : la facette « link » du post (Bluesky raccourcit le texte) ; aperçu : l'embed « external » s'il existe.
      const facet = (Array.isArray(r.facets) ? r.facets : []).flatMap(f => (f && Array.isArray(f.features) ? f.features : [])).find(x => x && x.$type === 'app.bsky.richtext.facet#link');
      const ext = p && p.embed && p.embed.external && typeof p.embed.external === 'object' ? p.embed.external : null;
      return { author: clean(str(a.displayName) || handle), handle: clean(handle), avatar: safe(a.avatar, CDN), text: window.sdMod && window.sdMod.bad(str(r.text)) ? window.sdMod.MASKED : clean(str(r.text)), at: str(r.createdAt),
        likes: int(p && p.likeCount), replies: int(p && p.replyCount), uri, cid: str(p && p.cid), url: safe(facet && facet.uri),
        card: ext ? { url: safe(ext.uri), title: clean(str(ext.title)).slice(0, 160), desc: clean(str(ext.description)).slice(0, 280), thumb: safe(ext.thumb, CDN) } : null,
        link: handle && uri ? 'https://bsky.app/profile/' + encodeURIComponent(handle) + '/post/' + encodeURIComponent(uri.split('/').pop()) : null };
    };
    const out = [];
    for (const p of posts) {
      let item; try { item = { ...view(p), thread: [] }; } catch (e) { continue; }
      if (p.replyCount) {
        try {
          const th = await get('app.bsky.feed.getPostThread?depth=1&parentHeight=0&uri=' + encodeURIComponent(p.uri));
          item.thread = ((th.thread && th.thread.replies) || []).filter(r => r && r.post && typeof r.post === 'object').map(r => view(r.post)).slice(0, 20)
            .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
        } catch (e) {}
      }
      out.push(item);
    }
    return out;
  }
  /** Bloc HTML d'une discussion (textes insérés en textContent uniquement) : posts, réponses, et répondre depuis le site. */
  function discussionBox(url, shareText) {
    const mk = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
    const box = mk('div', 'sd-talk'), head = mk('div', 'sd-talk-h');
    const share = mk('button', 'btn-sm', t('Partager sur Bluesky')); share.type = 'button';
    share.addEventListener('click', () => window.sdBluesky && window.sdBluesky.share(shareText + ' ' + url));
    head.append(mk('h3', 'rk-h', t('Discussion sur Bluesky')), share);
    const list = mk('div', 'sd-talk-list', t('Chargement…'));
    box.append(head, list);
    const fmtAt = iso => { const d = Date.parse(iso); if (!d) return ''; return new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
    const face = p => { if (p.avatar) { const im = mk('img', 'sd-post-av'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = p.avatar; return im; } return mk('span', 'sd-post-av', (p.author || p.handle || '?').slice(0, 1).toUpperCase()); };
    // Zone de réponse : publiée avec le compte Bluesky connecté, seulement au clic sur « Publier ».
    function replyForm(root, parent, onDone) {
      const f = mk('form', 'sd-reply'); f.noValidate = true;
      const ta = mk('textarea'); ta.maxLength = 600; ta.rows = 3; ta.placeholder = t('Votre réponse, publiée sur Bluesky avec votre compte'); ta.setAttribute('aria-label', t('Votre réponse'));
      const foot = mk('div', 'sd-reply-f'), cnt = mk('small', 'sd-reply-n', '0 / 300');
      const go = mk('button', 'btn-sm sd-reply-go', t('Publier')); go.type = 'submit'; go.disabled = true;
      const cancel = mk('button', 'lnk', t('Annuler')); cancel.type = 'button'; cancel.addEventListener('click', () => f.remove());
      ta.addEventListener('input', () => { const n = [...ta.value.trim()].length; cnt.textContent = n + ' / 300'; cnt.classList.toggle('over', n > 300); go.disabled = !n || n > 300; });
      f.addEventListener('submit', async e => {
        e.preventDefault(); if (go.disabled) return;
        if (window.sdMod && window.sdMod.bad(ta.value)) { cnt.textContent = t('Réponse contraire aux règles du site.'); return; }
        go.disabled = true; go.textContent = t('Publication…');
        try { await window.sdBluesky.reply(root, parent, ta.value); onDone(ta.value.trim()); f.remove(); }
        catch (x) { console.warn('[signal-desk] réponse bluesky', x && x.message); go.disabled = false; go.textContent = t('Publier'); cnt.textContent = t('Bluesky a refusé la réponse. Réessayez.'); }
      });
      foot.append(cnt, cancel, go); f.append(ta, foot);
      setTimeout(() => ta.focus(), 0);
      return f;
    }
    // « Répondre » : formulaire si Bluesky est connecté avec le droit de publier, sinon proposition de (re)connexion.
    async function onReply(a, root, parent, thread) {
      const B = window.sdBluesky;
      if (a.querySelector('.sd-reply, .sd-reply-need')) return;
      const need = (msg, label) => { const n = mk('p', 'sd-reply-need'); const c = mk('button', 'btn-sm', t(label)); c.type = 'button'; c.addEventListener('click', () => B && B.connect()); n.append(document.createTextNode(t(msg) + ' '), c); a.appendChild(n); };
      if (!B || !B.me) return need('Connectez Bluesky pour répondre depuis le site.', 'Connecter Bluesky');
      if (!(await B.canPost())) return need('Votre connexion Bluesky date d’avant les réponses : reconnectez-la une fois.', 'Reconnecter Bluesky');
      a.appendChild(replyForm(root, parent, text => {
        // Affichée tout de suite ; Bluesky l'indexe en quelques secondes.
        thread.appendChild(card({ author: B.me.name || B.me.handle, handle: B.me.handle || '', avatar: B.me.avatar || '', text, at: new Date().toISOString(), likes: 0, replies: 0 }, true, root, thread));
        cache.clear();
      }));
    }
    function card(p, reply, root, thread) {
      const a = mk('article', 'sd-post' + (reply ? ' reply' : ''));
      const meta = mk('div', 'sd-post-m'), who = mk('div', 'sd-post-who');
      who.append(mk('b', '', p.author || p.handle), mk('span', '', p.handle ? '@' + p.handle : ''));
      meta.append(face(p), who, mk('time', '', fmtAt(p.at)));
      a.append(meta, mk('p', 'sd-post-t', p.text));
      // L'article partagé : aperçu si Bluesky en a un, sinon le lien complet.
      if (p.card && p.card.url) {
        const c = mk('a', 'sd-post-card'); c.href = p.card.url; c.target = '_blank'; c.rel = 'noopener noreferrer';
        if (p.card.thumb) { const im = mk('img'); im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = p.card.thumb; c.appendChild(im); }
        const tx = mk('span'); tx.append(mk('b', '', p.card.title || p.card.url), mk('small', '', p.card.desc || new URL(p.card.url).host)); c.appendChild(tx); a.appendChild(c);
      } else if (p.url) { const l = mk('a', 'sd-post-url', p.url); l.href = p.url; l.target = '_blank'; l.rel = 'noopener noreferrer'; a.appendChild(l); }
      const bar = mk('div', 'sd-post-b');
      bar.append(mk('span', '', '♥ ' + p.likes), mk('span', '', '💬 ' + p.replies));
      if (p.uri && p.cid) {
        const r = mk('button', 'lnk sd-post-r', t('Répondre')); r.type = 'button';
        r.addEventListener('click', () => onReply(a, root, { uri: p.uri, cid: p.cid }, thread));
        bar.appendChild(r);
      }
      if (p.link) { const l = mk('a', 'lnk', t('Voir sur Bluesky')); l.href = p.link; l.target = '_blank'; l.rel = 'noopener noreferrer'; bar.appendChild(l); }
      a.appendChild(bar);
      return a;
    }
    discussion(url).then(items => {
      list.replaceChildren();
      if (!items.length) { list.appendChild(mk('p', 'rk-empty', t('Personne n\'en parle encore sur Bluesky. Lancez la discussion.'))); return; }
      for (const it of items) {
        const root = { uri: it.uri, cid: it.cid }, th = mk('div', 'sd-thread');
        list.appendChild(card(it, false, root, th));
        it.thread.forEach(r => th.appendChild(card(r, true, root, th)));
        list.appendChild(th);
      }
    }).catch(() => { list.textContent = t('Bluesky ne répond pas pour le moment.'); });
    return box;
  }

  /** S2 (09/11) : nombre de messages sur une page (posts qui la citent + leurs réponses), en une seule recherche. */
  async function talkCount(url) {
    const s = await get('app.bsky.feed.searchPosts?q=*&sort=latest&limit=25&url=' + encodeURIComponent(url));
    return (Array.isArray(s.posts) ? s.posts : []).reduce((n, p) => n + 1 + (Number.isSafeInteger(p && p.replyCount) && p.replyCount > 0 ? p.replyCount : 0), 0);
  }
  window.sdSocial = { badges, discussion, discussionBox, talkCount };
})();
