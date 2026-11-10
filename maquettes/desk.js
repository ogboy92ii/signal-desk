// Mon desk (volet wallet, onglet Profil) : ouvrir son desk, sceller un call, l'ouvrir, retirer les gains.
// Tout passe par chain.js. Le call et sa clé (nonce) sont gardés dans ce navigateur ET chiffrés dans le
// wallet (mémo privé, chain.js backupMemo) : sans eux, le call ne s'ouvre jamais et ses acheteurs sont remboursés.
(() => {
  const $ = id => document.getElementById(id);
  if (!$('dk')) return;
  const C = () => window.sdChain, W = () => window.sdWallet;
  const t = k => (window.sdT ? window.sdT(k) : k);
  const fmt = n => (window.sdFmt ? window.sdFmt(n, 0) : String(n));
  const toast = $('toast'); let toastTimer = 0;
  const say = k => { toast.textContent = t(k); toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3200); };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } } };
  // Le lien compte → desk est rangé sous une empreinte (même principe que le pseudo).
  async function deskKey(net, acct) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('signal-desk:desk:' + net + ':' + acct)));
    return 'sd-desk-' + [...d.slice(0, 10)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const secKey = (desk, seq) => 'sd-sec-' + desk.slice(10, 26) + '-' + seq;
  const HEXN = /^[0-9a-f]{32,128}$/, COMP = /^component_[0-9a-f]{64}$/;
  function validSecret(s) {
    return s && s.v === 1 && COMP.test(s.desk) && Number.isSafeInteger(s.seq) && s.seq >= 0 && typeof s.payload === 'string' && C().isCanonical(s.payload)
      && s.payload.length > 0 && s.payload.length <= 1024 && HEXN.test(s.nonce) && s.nonce.length % 2 === 0 && /^[0-9a-f]{64}$/.test(s.commitment);
  }
  const loadSecret = (desk, seq) => { try { const s = JSON.parse(store.get(secKey(desk, seq)) || 'null'); return validSecret(s) && s.desk === desk && s.seq === seq ? s : null; } catch (e) { return null; } };
  // Sauvegardes privées du wallet (si l'accès en lecture est déjà accordé : aucune demande ici).
  // Retrouve le desk et les clés sur un autre appareil ; chaque clé est vérifiée par chain.js.
  async function syncBackups(net, acct) {
    const r = await C().privateSecrets(net, false).catch(() => null);
    if (!r) return null;
    for (const s of r.secrets) if (!loadSecret(s.desk, s.seq)) store.set(secKey(s.desk, s.seq), JSON.stringify(s));
    const k = window.sdWallet && window.sdWallet.key(), mine = r.desks.find(d => d.payout === acct && d.publisher === k);
    return mine ? mine.address : null;
  }
  // Le détail (raison du réseau, message du wallet) reste visible : sans lui, un échec ne se diagnostique pas.
  const err = e => (e && e.code === 4001 ? 'Signature refusée dans le wallet.'
    : e && (e.name === 'QuotaExceededError' || /storage/i.test(e.message || '')) ? 'Espace du navigateur plein : libérez de la place puis réessayez.' // audit K11
    : t('Transaction refusée par le réseau.') + (e && e.tx ? ' ' + (e.reason || '') + ' · tx ' + e.tx.slice(0, 12) : e && e.message ? ' (' + String(e.message).slice(0, 160) + ')' : ''));

  let cur = { key: '', desk: null, epoch: null }, busy = false;
  const ctx = () => { const w = W(), acct = w && w.account(), net = w && w.network(); return { acct, net, live: !!(acct && C() && C().published(net)) }; };
  // A1 (08/11) : sans desk, le formulaire reste affiché ; « Sceller » crée le desk au passage (plus de bouton séparé).
  const sum = () => $('dk').querySelector('.dk-sum');
  function off(msg, canSeal) {
    cur.desk = null; $('dk-off').hidden = false; $('dk-off-s').textContent = t(msg); $('dk-open').hidden = true;
    $('dk-on').hidden = !canSeal; sum().hidden = true; $('dk-withdraw').hidden = true;
  }
  const NO_DESK = 'Votre desk sera créé avec votre premier call : une signature de plus, une seule fois.';
  async function refresh() {
    const { acct, net, live } = ctx();
    if (!acct) return off('Connectez votre wallet pour gérer votre desk.', false);
    if (!live) return off('Ouvrir un desk sera possible dès la publication du contrat Signal Desk.', false);
    // Audit K13 : une lecture lancée pour un autre compte ou réseau ne doit rien écrire ici.
    const c = cur;
    let addr = store.get(await deskKey(net, acct));
    const found = await syncBackups(net, acct);
    if (cur !== c) return;
    if ((!addr || !COMP.test(addr)) && found) { addr = found; store.set(await deskKey(net, acct), addr); }
    // A3 (08/11) : sans mémo, le desk se retrouve par son événement desk_opened, depuis n'importe quel appareil.
    if (!addr || !COMP.test(addr)) {
      const mine = await C().findDesks(net, acct, window.sdWallet && window.sdWallet.key()).catch(() => []);
      if (cur !== c) return;
      if (mine.length) { addr = mine[0].address; store.set(await deskKey(net, acct), addr); }
    }
    if (!addr || !COMP.test(addr)) return off(NO_DESK, true);
    let read;
    try { read = await Promise.all([C().readDesk(net, addr), C().currentEpoch(net)]); }
    catch (e) {
      if (cur !== c) return;
      // Desk d'un template remplacé (ex. Ootle 0.50.1, 08/11) : il ne se charge plus, on en propose un nouveau.
      if (e && e.message === 'not a Signal Desk component') { store.set(await deskKey(net, acct), ''); return off(NO_DESK, true); }
      return off('Desk illisible pour le moment. Réessayez plus tard.', false);
    }
    if (cur !== c) return;
    // Audit F1 : un desk mémorisé qui n'a pas été publié avec ma clé n'est pas le mien (oublié ici).
    const k = window.sdWallet && window.sdWallet.key();
    if (k && read[0].publisher !== k) { store.set(await deskKey(net, acct), ''); return off(NO_DESK, true); }
    [c.desk, c.epoch] = read;
    render();
  }
  function render() {
    const d = cur.desk, e = cur.epoch, [n, o, l] = C().stats(d, e);
    $('dk-off').hidden = true; $('dk-on').hidden = false; sum().hidden = false;
    $('dk-n').textContent = fmt(n); $('dk-o').textContent = fmt(o); $('dk-l').textContent = fmt(l);
    $('dk-w').textContent = fmt(Number(d.withdrawable / 1000000n)) + ' TARI';
    $('dk-withdraw').hidden = d.withdrawable <= 0n;
    openInfo();
    // Les calls et leurs actions (livrer, ouvrir, régler, partager) sont sur le profil (profil.js privateCalls).
  }
  async function act(fn, ok) {
    if (busy) return; busy = true;
    try { await fn(); say(ok); } catch (e) { console.warn('[signal-desk]', e && e.message); say(err(e)); } finally { busy = false; refresh(); }
  }
  $('dk-open').addEventListener('click', () => act(async () => {
    const { acct, net } = ctx(), { desk } = await C().openDesk(net);
    store.set(await deskKey(net, acct), desk);
  }, 'Desk ouvert.'));
  $('dk-withdraw').addEventListener('click', () => cur.desk && act(() => C().withdraw(ctx().net, cur.desk.address, cur.desk.withdrawable), 'Gains versés sur votre compte.'));
  // Catégorie du call : seuls les champs de la catégorie (et du type de pronostic) sont affichés.
  // 09/11 (D3) : seulement les paris vérifiables automatiquement avec les scores ESPN (sports.js).
  const KINDS = { us: [['WIN', 'Vainqueur'], ['SPREAD', 'Écart (handicap)'], ['TOTAL', 'Total de points']], soccer: [['WIN', 'Vainqueur ou match nul'], ['TOTAL', 'Total de buts']], fight: [['WIN', 'Vainqueur']] };
  const SOCCER = ['UCL', 'EPL'], TEAM = ['NFL', 'NBA', 'UCL', 'EPL'];
  const EX = { NFL: ['KC', 'BUF'], NBA: ['OKC', 'DEN'], UCL: ['RMA', 'MCI'], EPL: ['ARS', 'LIV'], UFC: ['PEREIRA', 'ANKALAEV'] };
  const opts = (s, list) => { const keep = s.value; s.replaceChildren(...list.map(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = t(l); return o; })); if (list.some(x => x[0] === keep)) s.value = keep; };
  // Noms en majuscules ASCII (accents retirés) : le contenu scellé doit rester en ASCII imprimable.
  const up = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const when = x => (x ? x.slice(0, 16) + 'Z' : '');
  // Call libre (10/11) : le contrat n'accepte que l'ASCII imprimable. Accents retirés, apostrophes et guillemets
  // typographiques ramenés à leur forme simple, tout autre caractère hors ASCII et la barre « | » supprimés.
  const ascii = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/[^\x20-\x7e]|\|/g, '').replace(/\s+/g, ' ').trim();
  function form() {
    const cat = $('dk-cat').value, lg = $('dk-lg').value, team = TEAM.includes(lg);
    $('dk-form').querySelectorAll('.dk-g').forEach(g => { g.hidden = g.dataset.cat !== cat; });
    $('dk-a-l').textContent = t(team ? "Équipe à l'extérieur" : 'Combattant 1'); $('dk-b-l').textContent = t(team ? 'Équipe à domicile' : 'Combattant 2');
    $('dk-a').placeholder = (EX[lg] || EX.NFL)[0]; $('dk-b').placeholder = (EX[lg] || EX.NFL)[1];
    $('dk-pick').placeholder = SOCCER.includes(lg) ? t('Sigle ESPN ou DRAW') : (EX[lg] || EX.NFL)[0];
    opts($('dk-kind'), KINDS[SOCCER.includes(lg) ? 'soccer' : team ? 'us' : 'fight']);
    opts($('dk-stat'), lg === 'NFL' ? [['TD', 'Touchdowns'], ['YDS', 'Yards']] : [['PTS', 'Points'], ['REB', 'Rebonds'], ['AST', 'Passes décisives']]);
    // Finance / Politique : l'autorité qui fait foi se choisit dans la liste de la modération (publique dès le scellement).
    if (window.sdMod && $('dk-cc')) opts($('dk-cc'), Object.entries(window.sdMod.SOURCES).map(([k, v]) => [k, /\./.test(v) ? k + ' · ' + v : v]));
    opts($('dk-meth'), lg === 'UFC' ? [['KO', 'KO / TKO'], ['SUB', 'Soumission'], ['DEC', 'Décision']] : [['KO', 'KO / TKO'], ['DEC', 'Aux points']]);
    const kind = $('dk-kind').value;
    $('dk-form').querySelectorAll('[data-k]').forEach(l => { l.hidden = !l.dataset.k.split(' ').includes(kind); });
    const b = build(); $('dk-pub').textContent = b ? t('Public dès le scellement : {x}').replace('{x}', b.label.split('|').join(' · ')) : '';
  }
  function build() {
    const v = id => $(id).value.trim(), cat = $('dk-cat').value;
    let payload;
    if (cat === 'crypto') payload = ['v1', v('dk-asset').toUpperCase(), $('dk-side').value, v('dk-entry'), v('dk-tp'), v('dk-sl'), when(v('dk-until'))].join('|');
    else if (cat === 'sport') {
      const lg = $('dk-lg').value, team = TEAM.includes(lg), k = $('dk-kind').value, line = v('dk-line').replace(',', '.');
      const pick = { WIN: [up(v('dk-pick'))], SPREAD: [up(v('dk-pick')), (/^[+-]/.test(line) ? '' : '+') + line], TOTAL: [$('dk-ou').value, line],
        PROP: [up(v('dk-player')), $('dk-stat').value, $('dk-ou').value, line], METHOD: [up(v('dk-pick')), $('dk-meth').value], ROUNDS: [$('dk-ou').value, line] }[k];
      payload = ['v1', lg, up(v('dk-a')) + (team ? '@' : ' vs ') + up(v('dk-b')), when(v('dk-kick')), k, ...pick].join('|');
    } else if (cat === 'free') payload = ['v1', 'FREE', ascii(v('dk-fsubj')), when(v('dk-fwhen')), 'TEXT', ascii(v('dk-ftext'))].join('|');
    else payload = ['v1', 'POL', $('dk-cc').value, up(v('dk-subj')), when(v('dk-when')), 'CHOICE', up(v('dk-opt'))].join('|');
    const c = C().parseCall(payload);
    return c ? { payload, label: c.label } : null;
  }
  // ---- Dates : sélecteur maison, en heure locale (le call scellé garde l'UTC, comme avant) ----
  const loc = () => document.documentElement.lang || 'fr-FR';
  const shown = d => new Intl.DateTimeFormat(loc(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  const PRESETS = [[1, 'Dans 1 h'], [4, 'Dans 4 h'], [24, 'Demain'], [72, 'Dans 3 jours']]; // « 1 semaine » retiré (R2 : 4 j max)
  function picker(input) {
    const lab = input.closest('label'), field = document.createElement('div');
    field.className = 'dk-field'; while (lab.firstChild) field.appendChild(lab.firstChild); lab.replaceWith(field);
    input.type = 'hidden';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dk-dt';
    const pop = document.createElement('div'); pop.className = 'dtp'; pop.hidden = true;
    field.append(btn, pop);
    let sel = null, view = new Date();
    const paint = () => { btn.textContent = sel ? shown(sel) : t('Choisir une date'); btn.classList.toggle('empty', !sel); };
    const commit = d => { sel = d; input.value = d ? d.toISOString().slice(0, 16) : ''; paint(); input.dispatchEvent(new Event('input', { bubbles: true })); };
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    function draw() {
      const draft = sel ? new Date(sel) : (() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })();
      const quick = el('div', 'dtp-q');
      PRESETS.forEach(([h, l]) => { const b = el('button', '', t(l)); b.type = 'button'; b.addEventListener('click', () => { const d = new Date(Date.now() + h * 3600e3); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); commit(d); close(); }); quick.appendChild(b); });
      const head = el('div', 'dtp-h'), prev = el('button', 'dtp-nav', '‹'), next = el('button', 'dtp-nav', '›');
      prev.type = next.type = 'button'; prev.setAttribute('aria-label', t('Mois précédent')); next.setAttribute('aria-label', t('Mois suivant'));
      prev.addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); draw(); });
      next.addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); draw(); });
      head.append(prev, el('b', '', new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric' }).format(view)), next);
      const grid = el('div', 'dtp-g');
      for (let i = 0; i < 7; i++) grid.appendChild(el('span', 'dtp-wd', new Intl.DateTimeFormat(loc(), { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))));
      const first = new Date(view.getFullYear(), view.getMonth(), 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const b = el('button', 'dtp-d', String(d.getDate())); b.type = 'button';
        if (d.getMonth() !== view.getMonth()) b.classList.add('out');
        if (d.getTime() === today.getTime()) b.classList.add('today');
        if (sel && d.toDateString() === sel.toDateString()) b.classList.add('on');
        if (d < today) b.disabled = true;
        b.addEventListener('click', () => { const n = new Date(d); n.setHours(draft.getHours(), draft.getMinutes(), 0, 0); sel = n; draw(); paint(); });
        grid.appendChild(b);
      }
      const time = el('div', 'dtp-t'), hh = el('select'), mm = el('select');
      hh.setAttribute('aria-label', t('Heure')); mm.setAttribute('aria-label', t('Minutes'));
      for (let h = 0; h < 24; h++) { const o = el('option', '', String(h).padStart(2, '0')); o.value = h; hh.appendChild(o); }
      for (const m of [0, 15, 30, 45]) { const o = el('option', '', String(m).padStart(2, '0')); o.value = m; mm.appendChild(o); }
      hh.value = draft.getHours(); mm.value = Math.floor(draft.getMinutes() / 15) * 15;
      const setTime = () => { const n = sel ? new Date(sel) : draft; n.setHours(+hh.value, +mm.value, 0, 0); sel = n; paint(); };
      hh.addEventListener('change', setTime); mm.addEventListener('change', setTime);
      time.append(el('span', '', t('Heure locale')), hh, el('b', '', ':'), mm);
      const foot = el('div', 'dtp-f'), clear = el('button', 'lnk', t('Effacer')), ok = el('button', 'btn-sm', t('Valider'));
      clear.type = ok.type = 'button';
      clear.addEventListener('click', () => { commit(null); close(); });
      ok.addEventListener('click', () => { commit(sel || draft); close(); });
      foot.append(clear, ok);
      pop.replaceChildren(quick, head, grid, time, foot);
    }
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => { if (!pop.hidden) return close(); view = sel ? new Date(sel) : new Date(); draw(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); });
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); btn.focus(); } });
    // composedPath() est figé au clic : un jour cliqué puis redessiné compte toujours comme « dedans ».
    document.addEventListener('click', e => { if (!pop.hidden && !e.composedPath().includes(field)) close(); });
    paint();
    return { refresh: paint };
  }
  const pickers = ['dk-until', 'dk-kick', 'dk-when', 'dk-fwhen'].filter(id => $(id)).map(id => picker($(id)));

  // ---- Ouverture : en durée ou « à l'échéance », convertie en époques (le contrat ne connaît qu'elles) ----
  // Une époque = 80 blocs L1 ≈ 1 h sur esmeralda (mesuré le 03/11/2026 : 281 blocs en 3 h 30).
  const EPOCH_MS = 3600e3;
  let openAt = 'due';
  const dueDate = () => {
    const iso = $(dateId()).value;
    if (!iso) return null;
    return new Date(iso + 'Z'); // sport (10/11) : le call s'ouvre au coup d'envoi, plus personne n'achète un pronostic après
  };
  // 10/11 : un refus montre le champ fautif (liseré rouge + secousse) ; le premier reçoit le focus. Corriger le champ l'efface.
  const badEl = id => { const e = $(id), l = e && e.closest('.dk-field, label'); return (l && l.querySelector('.dk-dt')) || e; };
  const flag = ids => {
    const els = [...new Set(ids.map(badEl).filter(Boolean))];
    els.forEach(e => { e.classList.remove('dk-bad'); void e.offsetWidth; e.classList.add('dk-bad'); e.setAttribute('aria-invalid', 'true'); });
    if (els[0]) els[0].focus({ preventScroll: false });
  };
  const unflag = e => { const l = e && e.closest && e.closest('.dk-field, label'); [e, l && l.querySelector('.dk-dt')].forEach(x => { if (x && x.classList) { x.classList.remove('dk-bad'); x.removeAttribute('aria-invalid'); } }); };
  const unflagAll = () => $('dk-form').querySelectorAll('.dk-bad').forEach(x => { x.classList.remove('dk-bad'); x.removeAttribute('aria-invalid'); });
  const dateId = () => ({ crypto: 'dk-until', sport: 'dk-kick', free: 'dk-fwhen' }[$('dk-cat').value] || 'dk-when');
  /** Les champs que le format du call refuse (mêmes règles que chain.js parseCall), plus le prix. */
  function wrong() {
    const v = id => $(id).value.trim(), cat = $('dk-cat').value, bad = [], pos = x => /^\d+(\.\d+)?$/.test(x) && +x > 0;
    if (cat === 'crypto') {
      if (!/^[A-Za-z0-9]{2,20}$/.test(v('dk-asset'))) bad.push('dk-asset');
      ['dk-entry', 'dk-tp', 'dk-sl'].forEach(id => { if (!pos(v(id))) bad.push(id); });
      if (!bad.length) { const e = +v('dk-entry'), tp = +v('dk-tp'), sl = +v('dk-sl'), long = $('dk-side').value === 'LONG'; if (long ? !(tp > e) : !(tp < e)) bad.push('dk-tp'); if (long ? !(sl < e) : !(sl > e)) bad.push('dk-sl'); }
    } else if (cat === 'sport') {
      const name = /^[A-Z0-9][A-Z0-9 .'-]{0,23}$/, a = up(v('dk-a')), b = up(v('dk-b')), k = $('dk-kind').value, line = v('dk-line').replace(',', '.'), pick = up(v('dk-pick'));
      if (!name.test(a)) bad.push('dk-a');
      if (!name.test(b) || a === b) bad.push('dk-b');
      if (['WIN', 'SPREAD', 'METHOD'].includes(k) && !(pick && (pick === a || pick === b || (k === 'WIN' && SOCCER.includes($('dk-lg').value) && pick === 'DRAW')))) bad.push('dk-pick');
      if (k === 'SPREAD' ? !/^[+-]?\d{1,2}(\.5|\.0)?$/.test(line) : ['TOTAL', 'PROP', 'ROUNDS'].includes(k) && !/^\d{1,4}(\.5|\.0)?$/.test(line)) bad.push('dk-line');
      if (k === 'PROP' && !name.test(up(v('dk-player')))) bad.push('dk-player');
    } else if (cat === 'free') {
      if (!/^[A-Za-z0-9][A-Za-z0-9 .,'?!%:+-]{1,39}$/.test(ascii(v('dk-fsubj')))) bad.push('dk-fsubj');
      const txt = ascii(v('dk-ftext')); if (!txt || txt.length > 110) bad.push('dk-ftext');
    } else {
      if (!/^[A-Z0-9][A-Z0-9 .'-]{1,39}$/.test(up(v('dk-subj')))) bad.push('dk-subj');
      if (!/^[A-Z0-9][A-Z0-9 .,%'-]{0,39}$/.test(up(v('dk-opt')))) bad.push('dk-opt');
    }
    if (!v(dateId())) bad.push(dateId());
    if (!/^\d{1,6}$/.test(v('dk-price')) || +v('dk-price') < 1) bad.push('dk-price');
    return bad;
  }
  const tooFar = (target, max) => t('Match trop lointain : ce call pourra être scellé à partir du {d}.').replace('{d}', shown(new Date(target.getTime() - max * EPOCH_MS)));
  function openInfo() {
    const out = $('dk-epoch'), e = cur.epoch, max = C() ? C().MAX_CALL_HORIZON_EPOCHS : 100; // R2 : horizon borné par le verrou drand
    const target = openAt === 'due' ? dueDate() : new Date(Date.now() + openAt * 3600e3);
    if (!target) { $('dk-in').value = ''; out.textContent = t("Choisissez d'abord la date de l'échéance."); return; }
    const n = Math.max(1, Math.ceil((target - Date.now()) / EPOCH_MS));
    if (n > max) {
      $('dk-in').value = '';
      // Sport (10/11) : on dit à partir de quand ce match pourra être scellé, plutôt qu'une limite abstraite.
      out.textContent = $('dk-cat').value === 'sport' && openAt === 'due' ? tooFar(target, max) : t('Échéance trop lointaine : {d} jours au plus.').replace('{d}', fmt(Math.floor(max / 24)));
      return;
    }
    $('dk-in').value = String(n);
    const when = shown(new Date(Date.now() + n * EPOCH_MS));
    out.textContent = Number.isSafeInteger(e) ? t('Ouverture vers {d} (époque {e} ; une époque dure environ une heure).').replace('{d}', when).replace('{e}', fmt(e + n)) : t('Ouverture vers {d}.').replace('{d}', when);
  }
  $('dk-open-at').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    openAt = b.dataset.h === 'due' ? 'due' : +b.dataset.h;
    $('dk-open-at').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); openInfo();
  });
  $('dk-form').addEventListener('input', openInfo);
  $('dk-form').addEventListener('input', e => unflag(e.target));
  $('dk-form').addEventListener('change', e => unflag(e.target));
  // Sport (10/11) : l'ouverture suit le match (coup d'envoi), les durées libres ne sont proposées que pour les autres calls.
  const openChips = () => {
    const sport = $('dk-cat').value === 'sport';
    $('dk-open-at').querySelectorAll('button').forEach(b => {
      const due = b.dataset.h === 'due';
      if (due) b.textContent = t(sport ? "Au coup d'envoi" : "À l'échéance"); else b.hidden = sport;
      if (sport) b.setAttribute('aria-pressed', String(due));
    });
    if (sport) openAt = 'due';
  };
  $('dk-cat').addEventListener('change', unflagAll);
  $('dk-cat').addEventListener('change', openChips);
  $('dk-cat').addEventListener('change', openInfo);
  openChips();
  setInterval(() => { if (!document.hidden && cur.desk) openInfo(); }, 60000);

  ['dk-cat', 'dk-lg', 'dk-kind'].forEach(id => $(id).addEventListener('change', form));
  $('dk-form').addEventListener('input', () => { const b = build(); $('dk-pub').textContent = b ? t('Public dès le scellement : {x}').replace('{x}', b.label.split('|').join(' · ')) : ''; });
  form();
  // Règles du site (modération, 09/11) affichées sous le formulaire de scellement.
  if (window.sdMod) $('dk-form').appendChild((() => { const p = document.createElement('p'); p.className = 'sd-rules'; p.textContent = t(window.sdMod.RULES); return p; })());
  $('dk-form').addEventListener('submit', async e => {
    e.preventDefault(); if (!ctx().live) return;
    const v = id => $(id).value.trim(), call = build();
    const price = v('dk-price'), inN = v('dk-in');
    // 10/11 : chaque refus montre son champ. D'abord le format et le prix, puis la date d'ouverture.
    unflagAll(); const bad = wrong();
    if (bad.length) { flag(bad); return say('Call invalide : corrigez les champs en rouge.'); }
    if (!call || !/^\d{1,6}$/.test(price) || +price < 1) return say('Call invalide : vérifiez les champs.');
    if (!/^\d{1,5}$/.test(inN) || +inN < 1 || +inN > C().MAX_CALL_HORIZON_EPOCHS) {
      flag([dateId()]); const due = dueDate(), max = C().MAX_CALL_HORIZON_EPOCHS;
      return say($('dk-cat').value === 'sport' && due && (due - Date.now()) / EPOCH_MS > max ? tooFar(due, max) : 'Échéance trop lointaine ou absente : vérifiez la date.');
    }
    if (call.payload.length > C().MAX_BACKUP_PAYLOAD) return say('Call trop long : raccourcissez le sujet.');
    // Modération (09/11) : mots interdits et calls incohérents avec le marché refusés avant toute signature.
    const pc = C().parseCall(call.payload); let px = null;
    if (pc && pc.cat === 'crypto') {
      const sym = /USDT$/.test(pc.asset) ? pc.asset : pc.asset + 'USDT';
      try { const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + encodeURIComponent(sym), { signal: AbortSignal.timeout(8000) }); if (r.ok) px = +(await r.json()).price || null; } catch (x) {}
    }
    const problem = window.sdMod ? window.sdMod.callProblem(pc, px, +price) : null;
    if (problem) {
      // Le message de modération désigne son champ : échéance, objectif, stop, entrée, match ou type de pari.
      flag(/chéance|match commence/i.test(problem) ? [dateId()] : /Objectif/.test(problem) ? ['dk-tp'] : /Stop/i.test(problem) ? ['dk-sl'] : /ntrée/.test(problem) ? ['dk-entry'] : /type de pari/.test(problem) ? ['dk-kind']
        : /Source officielle/.test(problem) ? ['dk-cc'] : /lien/.test(problem) ? ['dk-ftext'] : /TARI au plus/.test(problem) ? ['dk-price'] : []);
      return say(t(problem).replace('{n}', window.sdMod.FREE_MAX_PRICE));
    }
    // Sport : le match doit exister sur ESPN avec ces sigles et cette heure, sinon le résultat ne pourra pas être vérifié.
    if (pc && pc.cat === 'sport' && window.sdSports && !(await window.sdSports.find(pc).catch(() => null)) && (flag(['dk-a', 'dk-b', 'dk-kick']), true))
      return say('Match introuvable sur ESPN : vérifiez les sigles des équipes (ex. ARS, LIV) et l’heure du coup d’envoi.');
    // A2 + A3 (08/11) : une seule signature par call ; le contenu est verrouillé jusqu'à l'ouverture (drand) et
    // le call s'ouvre tout seul, sans sauvegarde privée ni accès en lecture.
    act(async () => {
      const { acct, net } = ctx();
      let deskAddr = cur.desk && cur.desk.address;
      if (!deskAddr) {
        // A1 : premier call = création du desk puis scellement, dans le même clic.
        say('Étape 1/2 : création de votre desk. Signez dans le wallet.');
        deskAddr = (await C().openDesk(net)).desk;
        store.set(await deskKey(net, acct), deskAddr);
        // L'indexeur peut voir le nouveau desk avec un peu de retard : seal() le relit.
        for (let i = 0; ; i++) { try { await C().readDesk(net, deskAddr); break; } catch (e) { if (i >= 9) throw e; await new Promise(ok => setTimeout(ok, 3000)); } }
        say('Étape 2/2 : scellement du call. Signez dans le wallet.');
      }
      const epoch = await C().currentEpoch(net);
      const r = await C().seal(net, deskAddr, call.payload, epoch + +inN, BigInt(price) * 1000000n, async s => {
        if (!store.set(secKey(s.desk, s.seq), JSON.stringify(s))) throw new Error('storage full');
      }, undefined, call.label);
      sealedRow(r.secret);
    }, "Call scellé. Il s'ouvrira tout seul à l'heure prévue.");
  });
  // Le call qui vient d'être scellé, sur une seule ligne sous le formulaire : animation de scellement
  // (callanim.js), puis lien vers le profil, où se gèrent les calls. Pas de liste ici (Soufian, 03/11).
  function sealedRow(s) {
    const A = window.sdCallAnim; if (!A) return;
    let box = $('dk-sealed'); if (!box) { box = document.createElement('div'); box.id = 'dk-sealed'; box.className = 'dk-sealed'; $('dk-form').after(box); }
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    const c = C().parseCall(s.payload), row = el('div', 'rg-row'), mk = el('div', 'rg-mk');
    if (c && c.cat === 'crypto') mk.append(el('b', '', c.asset), el('span', 'rg-side ' + (c.side === 'LONG' ? 'rg-up' : 'rg-dn'), (c.side === 'LONG' ? '▲ ' : '▼ ') + c.side));
    else mk.appendChild(el('b', '', String(s.payload).split('|').slice(1, 3).join(' · ')));
    const plain = c && c.cat === 'crypto' ? A.levelsText({ sl: c.sl, e: c.entry, tp: c.tp }) : String(s.payload).split('|').slice(1).join(' · ');
    const det = el('div', 'rg-det'); det.appendChild(c && c.cat === 'crypto' ? A.levels({ sl: c.sl, e: c.entry, tp: c.tp }) : el('span', 'rg-txt', plain));
    row.append(el('span', 'rg-n', '#' + fmt(s.seq)), mk, det, el('span', 'rg-res rg-f3', '—'), el('div', 'rg-st'));
    const link = el('a', '', t('Voir mes calls')); link.href = 'profil.html';
    box.replaceChildren(row, link);
    A.seal(row, { plain, hex: s.commitment, after: t("s'ouvre vers l'époque {e}").replace('{e}', fmt(s.revealAtEpoch)) });
    sealPop(s, c, plain);
  }
  // Confirmation au centre de la fenêtre « Sceller un call » (demande de Soufian du 04/11) : cadenas qui se ferme,
  // numéro du call, résumé, ouverture prévue, empreinte ; reste affichée jusqu'au choix de l'utilisateur.
  function sealPop(s, c, plain) {
    document.querySelector('dialog.seal-pop')?.remove();
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
    const pop = el('dialog', 'seal-pop'); pop.setAttribute('aria-labelledby', 'seal-pop-h');
    const card = el('div', 'seal-pop-card');
    const ic = el('div', 'seal-pop-ic');
    ic.innerHTML = '<svg viewBox="0 0 40 44" fill="none" aria-hidden="true"><path class="sh" d="M11 19v-6a9 9 0 0 1 18 0v6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><rect x="6" y="19" width="28" height="21" rx="6" stroke="currentColor" stroke-width="2.6"/><circle cx="20" cy="29.5" r="2.6" fill="currentColor"/></svg>';
    const when = cur.epoch != null ? new Date(Date.now() + (s.revealAtEpoch - cur.epoch) * 3600e3) : null;
    const opens = when ? t("S'ouvre vers le {d}").replace('{d}', new Intl.DateTimeFormat(document.documentElement.lang || 'fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(when)) : t("s'ouvre vers l'époque {e}").replace('{e}', fmt(s.revealAtEpoch));
    const what = c && c.cat === 'crypto' ? c.asset + ' ' + (c.side === 'LONG' ? '▲ ' : '▼ ') + c.side : plain;
    const see = el('a', 'btn-sm seal-pop-go', t('Voir mes calls')); see.href = 'profil.html';
    const again = el('button', 'btn-sm', t('Sceller un autre call')); again.type = 'button';
    const close = () => { pop.classList.add('out'); setTimeout(() => { pop.close(); pop.remove(); }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240); };
    pop.addEventListener('cancel', e => { e.preventDefault(); close(); });
    again.addEventListener('click', close); pop.addEventListener('click', e => { if (e.target === pop) close(); });
    const acts = el('div', 'seal-pop-acts'); acts.append(see, again);
    const h = el('b', 'seal-pop-h', t('Call n°{n} scellé').replace('{n}', fmt(s.seq))); h.id = 'seal-pop-h';
    card.append(ic, h, el('p', 'seal-pop-w', what),
      c && c.cat === 'crypto' ? el('p', 'seal-pop-l', plain) : el('span', ''), el('p', 'seal-pop-o', opens), el('code', 'seal-pop-x', String(s.commitment).slice(0, 20) + '…'),
      el('p', 'seal-pop-n', t('Personne ne peut le lire avant son ouverture, pas même nous.')), acts);
    pop.appendChild(card); document.body.appendChild(pop); pop.showModal();
    again.focus({ preventScroll: true });
  }
  // Recharger quand le compte ou le réseau change, et à l'ouverture de l'onglet Profil.
  addEventListener('sd:me', () => { const { acct, net } = ctx(), k = (acct || '') + '|' + (net || ''); if (k !== cur.key) { cur = { key: k, desk: null, epoch: null }; refresh(); } });
  // Mon desk est sur la page Profil : rechargé après un achat et au retour sur l'onglet.
  addEventListener('sd:purchases', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  const prev = window.sdApplyLang;
  if (prev) window.sdApplyLang = l => { prev(l); pickers.forEach(p => p.refresh()); if (cur.desk) render(); else refresh(); };
  refresh();
})();
