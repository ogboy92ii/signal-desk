// Portfolio réel (volet wallet) : les achats faits depuis ce navigateur, leur clé de vente, le call
// reçu (déchiffré ici, vérifié contre le commitment scellé), le litige et le remboursement.
// La clé de vente reste dans ce navigateur et dans la sauvegarde téléchargée ; rien n'est envoyé.
(() => {
  const $ = id => document.getElementById(id);
  const C = () => window.sdChain, W = () => window.sdWallet;
  const t = k => (window.sdT ? window.sdT(k) : k);
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    keys: () => { try { return Object.keys(localStorage); } catch (e) { return []; } } };
  const COMP = /^component_[0-9a-f]{64}$/, H64 = /^[0-9a-f]{64}$/;
  const keyOf = (desk, seq) => 'sd-buy-' + desk.slice(10, 26) + '-' + seq;
  const valid = p => p && p.v === 1 && p.kind === 'purchase' && typeof p.network === 'string' && COMP.test(p.desk) && Number.isSafeInteger(p.seq) && p.seq >= 0
    && H64.test(p.key) && H64.test(p.secret) && H64.test(p.commitment) && typeof p.price === 'string' && /^\d{1,30}$/.test(p.price);
  const load = k => { try { const p = JSON.parse(store.get(k) || 'null'); return valid(p) ? p : null; } catch (e) { return null; } };
  // Sauvegarde à la demande (bouton « Sauvegarder mes achats ») : plus de fenêtre d'enregistrement à chaque achat.
  function download(list) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 1)], { type: 'application/json' }));
    a.download = 'signal-desk-achats.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  window.sdPurchases = {
    has: (desk, seq) => !!load(keyOf(desk, seq)),
    get: (desk, seq) => load(keyOf(desk, seq)),
    // Clé gardée pour un achat jamais signé (signature annulée ou refusée) : effacée pour pouvoir racheter.
    drop: (desk, seq) => { try { localStorage.removeItem(keyOf(desk, seq)); } catch (e) {} },
    /** Appelé par chain.buy AVANT la signature. Échec = pas de signature. */
    // L'achat est rangé avec le compte acheteur : un autre compte du même navigateur ne le voit pas.
    keep(p) { const a = W() && W().account(); if (a) p.account = a; p.at = Date.now(); if (!valid(p) || !store.set(keyOf(p.desk, p.seq), JSON.stringify(p))) throw new Error('storage'); },
    list: (network, account) => store.keys().filter(k => k.startsWith('sd-buy-')).map(load).filter(p => p && p.network === network && (!p.account || p.account === account)),
  };

  const toast = $('toast'); let timer = 0;
  const say = k => { toast.textContent = t(k); toast.classList.add('show'); clearTimeout(timer); timer = setTimeout(() => toast.classList.remove('show'), 3200); };
  const short = a => a.slice(10, 14) + '…' + a.slice(-4);
  const fmt = n => (window.sdFmt ? window.sdFmt(n, 0) : String(n));
  let busy = false;
  async function act(fn, ok) {
    if (busy) return; busy = true;
    try { await fn(); say(ok); } catch (e) { console.warn('[signal-desk]', e && e.message); say(e && e.code === 4001 ? 'Signature refusée dans le wallet.' : 'Transaction refusée par le réseau.'); }
    finally { busy = false; render(); }
  }
  // Un achat : desk (nom on-chain), n° public du call, état de la livraison, puis le call lui-même, lisible.
  const el = (tag, cls, txt) => { const x = document.createElement(tag); if (cls) x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
  const num = v => new Intl.NumberFormat(document.documentElement.lang || 'fr', { maximumFractionDigits: 8 }).format(v);
  const deskOf = addr => { const D = window.SD_DATA, c = D && D.base.find(x => x.desk === addr); return c ? { name: c.display, href: 'profil.html?c=' + encodeURIComponent(c.name) } : { name: 'Desk ' + short(addr), href: '' }; };
  function row(p, r, epoch) {
    const box = el('div', 'pf-row real pf-buy'), d = deskOf(p.desk);
    const s = r.call && r.call.sales[r.sale], can = s ? C().saleState(r.call, s, epoch) : {};
    const pc = r.state === 'ok' ? C().parseCall(r.opened.payload) : null, pair = (pc && pc.asset) || (r.call && r.call.label) || '';
    // En-tête : desk + état
    const top = el('div', 'pb-top'), who = el(d.href ? 'a' : 'b', 'pb-desk', d.name); if (d.href) who.href = d.href;
    const st = el('span', 'pb-st');
    if (r.state === 'missing') st.textContent = t('Achat introuvable sur la chaîne');
    else if (r.status === 'Refunded') { st.classList.add('ref'); st.textContent = t('Remboursé'); }
    else if (r.status === 'Fraud') { st.classList.add('ko'); st.textContent = t('Fraude constatée par le contrat'); }
    else if (r.state === 'waiting') { st.classList.add('wait'); st.textContent = t('En attente de livraison'); }
    else if (r.state === 'ok') { st.classList.add('ok'); st.textContent = t('Livré'); }
    else if (r.state === 'bad') { st.classList.add('ko'); st.textContent = t('Livraison invalide : contestez-la'); }
    else { st.classList.add('wait'); st.textContent = t('Livraison publiée, lecture en attente'); }
    top.append(who, st);
    // Numéro public (comme sur le profil), paire, prix payé
    const sub = el('div', 'pb-sub', ['Call #' + (p.seq + 1), pair, fmt(Number(BigInt(p.price) / 1000000n)) + ' TARI'].filter(Boolean).join(' · '));
    box.append(top, sub);
    // Le call livré : sens, entrée / objectif / stop, échéance. Texte libre tel quel.
    if (r.state === 'ok') {
      const callBox = el('div', 'pb-call');
      if (pc && pc.cat === 'crypto') {
        const head = el('div', 'pb-head'); head.append(el('span', 'pb-side ' + (pc.side === 'LONG' ? 'up' : 'dn'), pc.side), el('b', '', pair));
        const grid = el('dl', 'pb-lv');
        for (const [k, v] of [['Entrée', pc.entry], ['Objectif', pc.tp], ['Stop', pc.sl]]) { const g = el('div'); g.append(el('dt', '', t(k)), el('dd', 'num', num(v))); grid.appendChild(g); }
        const until = Date.parse(pc.until);
        callBox.append(head, grid);
        if (until) callBox.appendChild(el('small', 'pb-until', t('Jusqu’au {d}').replace('{d}', new Intl.DateTimeFormat(document.documentElement.lang || 'fr', { dateStyle: 'medium', timeStyle: 'short' }).format(until))));
      } else callBox.appendChild(el('p', 'pb-txt', r.opened.payload));
      // P3 (09/11) : le call était-il encore valable à l'heure de l'achat ? (échéance, objectif ou stop déjà touché)
      if (pc && pc.cat === 'crypto' && p.at && r.call && window.sdPrices) {
        const warn = el('p', 'pb-warn'); warn.hidden = true; callBox.appendChild(warn);
        const until = Date.parse(pc.until), sealedAt = Date.now() - (epoch - r.call.sealedAtEpoch) * C().EPOCH_MS;
        if (until && until <= p.at) { warn.textContent = t('Call déjà terminé à l’achat : son échéance était passée.'); warn.hidden = false; }
        else window.sdPrices.outcome(pc, sealedAt, p.desk.slice(10, 26) + ':' + p.seq).then(o => {
          if (o && ['win', 'loss', 'invalid'].includes(o.state) && o.at <= p.at) { warn.textContent = t('Call déjà joué à l’achat : objectif ou stop touché avant votre paiement.'); warn.hidden = false; }
        }).catch(() => {});
      }
      box.appendChild(callBox);
    }
    const acts = el('div', 'pb-acts');
    const btn = (label, fn, ok) => { const x = el('button', 'btn-sm pf-act', t(label)); x.type = 'button'; x.addEventListener('click', () => act(fn, ok)); acts.appendChild(x); };
    if (r.state === 'bad' && can.disputable) btn('Contester', () => C().dispute(p.network, p), 'Litige envoyé : le contrat a jugé.');
    if (can.refundable) btn('Rembourser', () => C().refund(p.network, p), 'Remboursé sur votre compte.');
    if (acts.childNodes.length) box.appendChild(acts);
    // P4 (09/11) : ce que l'acheteur doit faire, remonté à la cloche et au bandeau du volet.
    const disputeLeft = r.state === 'bad' && can.disputable ? r.call.revealAtEpoch + 10 - epoch : null;
    return { el: box, at: p.at || 0, tab: r.status === 'Refunded' ? 'c' : r.call && r.call.revealedAtEpoch !== null ? 'b' : 'a', p, refundable: !!can.refundable, disputeLeft };
  }
  // Mes pronostics (onglet Pronostics) : ceux de ce navigateur scellés avec la clé de ce compte.
  function forecastRows(net, key) {
    const out = [];
    for (const k of store.keys().filter(x => x.startsWith('sd-fc-'))) {
      let v = null; try { v = JSON.parse(store.get(k)); } catch (e) {}
      if (!v || v.kind !== 'forecast' || v.network !== net || v.key !== key || !COMP.test(v.board) || out.some(o => o.board === v.board && o.question === v.question)) continue;
      out.push(v);
    }
    return out.map(v => {
      const el = document.createElement('div'); el.className = 'pf-row real';
      const a = document.createElement('div'), b = document.createElement('div');
      const name = document.createElement('a'); name.href = 'ligues.html?ligue=' + v.board; name.textContent = t('Ligue {id}').replace('{id}', short(v.board));
      const sub = document.createElement('small'); sub.textContent = 'Question #' + v.question; a.append(name, sub);
      const sm = document.createElement('small'); sm.textContent = t('Votre réponse'); const ans = document.createElement('b'); ans.className = 'num'; ans.textContent = String(v.answer).slice(0, 64); b.append(sm, ans);
      el.append(a, b, document.createElement('div')); return el;
    });
  }
  function ownRow(c, ph) {
    const el = document.createElement('div'); el.className = 'pf-row real';
    const a = document.createElement('div'), b = document.createElement('div'), x = document.createElement('div');
    const name = document.createElement('a'); name.href = 'profil.html'; name.textContent = 'Call #' + (c.seq + 1);
    const sub = document.createElement('small'); sub.textContent = c.label || ''; a.append(name, sub);
    const st = document.createElement('span');
    st.textContent = ph === 'on-sale' ? t("s'ouvre vers l'époque {e}").replace('{e}', fmt(c.revealAtEpoch)) : ph === 'revealing' ? t('à ouvrir')
      : ph === 'revealed' ? t('engagement vérifié · ouvert') : t('acheteurs remboursés');
    if (ph === 'revealed') st.className = 'ok'; else if (ph === 'refunding') st.className = 'ref';
    b.appendChild(st);
    const small = document.createElement('small'); small.textContent = t('Prix');
    const price = document.createElement('b'); price.className = 'num'; price.textContent = c.price === null ? '—' : fmt(Number(c.price / 1000000n)) + ' TARI';
    x.append(small, price); el.append(a, b, x);
    return { el, at: (c.seq + 1) / 1e6, tab: ph === 'revealed' ? 'b' : ph === 'refunding' ? 'c' : 'a' };
  }
  // P4/P5/P7 (09/11) : bandeau d'actions groupées en haut du volet, et alertes pour la cloche (nav.js, sd:alerts).
  function autoBar(net, refunds, disputes, deliveries) {
    let bar = $('pf-auto');
    if (!bar) { bar = el('div', 'pf-auto'); bar.id = 'pf-auto'; const sec = $('sec-pf'); sec.insertBefore(bar, sec.querySelector('[role="tablist"]') || sec.firstChild); }
    bar.replaceChildren();
    const nDel = deliveries.reduce((a, x) => a + x.n, 0);
    if (nDel) { const b = el('button', 'btn-sm', t('Tout livrer ({n})').replace('{n}', fmt(nDel))); b.type = 'button'; b.addEventListener('click', () => act(() => C().deliverMany(net, deliveries.map(x => x.s)), 'Calls livrés à leurs acheteurs.')); bar.appendChild(b); }
    if (refunds.length) { const b = el('button', 'btn-sm', t('Tout rembourser ({n})').replace('{n}', fmt(refunds.length))); b.type = 'button'; b.addEventListener('click', () => act(() => C().refundAll(net, refunds), 'Remboursé sur votre compte.')); bar.appendChild(b); }
    for (const d of disputes) bar.appendChild(el('p', 'pf-alert', t('Livraison invalide : contestez-la avant {h} h, sinon le vendeur garde le paiement.').replace('{h}', fmt(Math.max(0, d.disputeLeft)))));
    bar.hidden = !bar.childNodes.length;
    window.sdAlerts = { deliver: nDel, refund: refunds.length, dispute: disputes.length };
    dispatchEvent(new Event('sd:alerts'));
  }
  let token = 0;
  async function render() {
    const w = W(), net = w && w.network(), acct = w && w.account();
    if (!acct || !net || !C() || !C().published(net)) return; // sans wallet : rien à lire, le volet garde ses états vides
    const mine = window.sdPurchases.list(net, acct);
    const me = ++token;
    // Chaque onglet ne montre que ce compte.
    let key = null; try { if (C().forecastsLive(net)) key = await C().whoami(net); } catch (e) {}
    if (me !== token) return;
    const pd = $('pan-d'); pd.querySelectorAll('.pf-row').forEach(x => x.remove());
    if (key) forecastRows(net, key).forEach(x => pd.insertBefore(x, pd.querySelector('.empty')));
    if (window.sdRender) window.sdRender();
    let epoch; try { epoch = await C().currentEpoch(net); } catch (e) { return; }
    const [rows, own] = await Promise.all([
      Promise.all(mine.map(p => C().readPurchase(net, p).then(r => row(p, r, epoch)).catch(() => null))),
      C().findDesks(net, acct, w.key()).catch(() => [])]);
    if (me !== token) return;
    // Mes calls scellés (desks dont ce compte reçoit les ventes), rangés comme les achats.
    for (const d of own) for (const c of d.calls) rows.push(ownRow(c, C().phase(c, epoch)));
    // P5 (09/11) : ventes de mes calls en attente de livraison, avec le secret gardé dans ce navigateur.
    const toDeliver = [];
    for (const d of own) for (const c of d.calls) {
      if (C().phase(c, epoch) !== 'on-sale' || !c.sales.some(s => C().saleState(c, s, epoch).deliverable)) continue;
      let s = null; try { s = JSON.parse(store.get('sd-sec-' + d.address.slice(10, 26) + '-' + c.seq) || 'null'); } catch (e) {}
      if (s && s.desk === d.address && s.seq === c.seq && s.commitment === c.commitment) toDeliver.push({ s, n: c.sales.filter(x => C().saleState(c, x, epoch).deliverable).length });
    }
    autoBar(net, rows.filter(x => x && x.refundable).map(x => x.p), rows.filter(x => x && x.disputeLeft != null), toDeliver); // != null : mes calls (ownRow) n'ont pas de disputeLeft
    for (const k of ['a', 'b', 'c']) {
      const pan = $('pan-' + k); pan.querySelectorAll('.pf-row').forEach(x => x.remove());
      const empty = pan.querySelector('.empty');
      // Les plus récents d'abord : achats par date d'achat, mes calls par numéro.
      rows.filter(x => x && x.tab === k).sort((x, y) => (y.at || 0) - (x.at || 0)).forEach(x => pan.insertBefore(x.el, empty));
    }
    if (window.sdRender) window.sdRender();
  }
  $('pf-import').addEventListener('click', () => $('pf-file').click());
  $('pf-file').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    let j = null; try { if (f && f.size < 1048576) j = JSON.parse(await f.text()); } catch (x) {}
    // Un achat (ancienne sauvegarde) ou la liste de « Sauvegarder mes achats ».
    const list = (Array.isArray(j) ? j : [j]).slice(0, 1000);
    if (!list.length || !list.every(valid)) return say('Sauvegarde illisible.');
    for (const p of list) {
      // La clé importée doit être celle d'une vente enregistrée sur la chaîne.
      try { const r = await C().readPurchase(p.network, p); if (r.state === 'missing') return say('Cet achat est introuvable sur la chaîne.'); } catch (x) { return say('Sauvegarde illisible.'); }
      if (W() && W().account()) p.account = W().account();
      store.set(keyOf(p.desk, p.seq), JSON.stringify(p));
    }
    say('Sauvegarde importée.'); render();
  });
  // Bouton ajouté ici (le volet est commun aux pages) : toutes les clés d'achat de ce compte dans un seul fichier.
  const save = document.createElement('button'); save.type = 'button'; save.className = 'lnk pf-imp'; save.textContent = t('Sauvegarder mes achats');
  $('pf-import').after(save);
  save.addEventListener('click', () => {
    const w = W(), list = w && w.account() ? window.sdPurchases.list(w.network(), w.account()) : [];
    if (!list.length) return say('Aucun achat à sauvegarder.');
    download(list);
  });
  addEventListener('sd:purchases', render);
  $('sec-t1').addEventListener('click', render);
  // sd:me part à chaque rendu du wallet : ne relire qu'au changement de compte ou de réseau.
  let who = '';
  addEventListener('sd:me', () => { const w = W(), k = w ? (w.account() || '') + '|' + (w.network() || '') : ''; if (k !== who) { who = k; if (w && w.account()) render(); } });
  render(); // wallet déjà reconnu au chargement : pas d'exemples, même avant le prochain sd:me
})();
