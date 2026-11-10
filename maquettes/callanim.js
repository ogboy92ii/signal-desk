// Registre des calls : règle des niveaux et animations de scellement / d'ouverture (direction O1 « Registre »,
// choisie par Soufian le 03/11 sur demo-animations.html). Utilisé par profil.js (ouverture) et desk.js (scellement).
// Animations réduites : états finaux directs, aucune boucle.
(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HEX = '0123456789abcdef';
  const loc = () => document.documentElement.lang || 'fr-FR';
  const t = k => (window.sdT ? window.sdT(k) : k);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const price = v => new Intl.NumberFormat(loc(), { maximumFractionDigits: 8 }).format(v);
  const LOCK = '<svg class="rg-lock" viewBox="0 0 18 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path class="sh" d="M4.5 9V6.5a4.5 4.5 0 0 1 9 0V9"/><rect x="2" y="9" width="14" height="10" rx="2.5"/></svg>';
  const CHK = '<svg class="rg-chk" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>';
  const wait = ms => new Promise(r => setTimeout(r, RM ? 0 : ms));
  const anim = (node, kf, o = {}) => (RM || !node ? Promise.resolve() : node.animate(kf, { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both', ...o }).finished.catch(() => {}));

  /** Remplace `from` par `to` caractère par caractère, en passant par des chiffres hexadécimaux. */
  function scramble(node, from, to, ms = 900) {
    if (RM) { node.textContent = to; return Promise.resolve(); }
    const len = Math.max(from.length, to.length), t0 = performance.now(), at = Array.from({ length: len }, (_, i) => (i / len) * ms * 0.75 + Math.random() * ms * 0.25);
    return new Promise(ok => {
      const step = now => {
        const dt = now - t0; let s = '';
        for (let i = 0; i < len; i++) s += dt >= at[i] ? (to[i] || '') : dt >= at[i] - 160 ? (from[i] === ' ' && to[i] === ' ' ? ' ' : HEX[(Math.random() * 16) | 0]) : (from[i] || '');
        node.textContent = s;
        if (dt < ms + 40) requestAnimationFrame(step); else { node.textContent = to; ok(); }
      };
      requestAnimationFrame(step);
    });
  }
  /** Texte des niveaux, tel que chiffré puis déchiffré par les animations. */
  const levelsText = c => `${t('Stop')} ${price(c.sl)}   ${t('Entrée')} ${price(c.e)}   ${t('Objectif')} ${price(c.tp)}`;
  /** Règle stop · entrée · objectif : zones de gain (vert) et de perte (rouge), point au prix final si connu. */
  function levels(c) {
    const box = el('div', 'rg-lv'), vals = el('div', 'rg-vals');
    for (const [k, v] of [['Stop', c.sl], ['Entrée', c.e], ['Objectif', c.tp]]) { const s = el('span'); s.append(el('i', '', t(k)), document.createTextNode(price(v))); vals.appendChild(s); }
    const lo = Math.min(c.sl, c.tp), hi = Math.max(c.sl, c.tp), pad = (hi - lo) * 0.06, L = lo - pad, H = hi + pad, x = v => ((v - L) / (H - L) * 100) + '%';
    const rail = el('div', 'rg-rail'), g = el('div', 'rg-zn g'), r = el('div', 'rg-zn r');
    const [g1, g2] = [c.e, c.tp].sort((a, b) => a - b), [r1, r2] = [c.e, c.sl].sort((a, b) => a - b);
    g.style.left = x(g1); g.style.width = `calc(${x(g2)} - ${x(g1)})`; r.style.left = x(r1); r.style.width = `calc(${x(r2)} - ${x(r1)})`;
    if (c.tp < c.e) g.style.transformOrigin = 'right'; if (c.sl < c.e) r.style.transformOrigin = 'right';
    const tk = el('div', 'rg-tk'); tk.style.left = x(c.e); rail.append(g, r, tk);
    if (Number.isFinite(c.end)) { const p = el('div', 'rg-px'); p.style.left = x(c.end); rail.appendChild(p); }
    box.append(vals, rail);
    return box;
  }
  const hexNode = text => { const h = el('span', 'rg-hex'); h.textContent = text; return h; };

  /**
   * Scellement, sur une ligne du registre (`.rg-det`, `.rg-res`, `.rg-st`) : le contenu se chiffre en
   * empreinte, le cadenas se ferme, l'état passe à « scellé ». `o` = { plain, hex, after }.
   */
  async function seal(row, o) {
    const det = row.querySelector('.rg-det'), res = row.querySelector('.rg-res'), st = row.querySelector('.rg-st');
    st.innerHTML = '<span>' + t('chiffrement…') + '</span>';
    const h = hexNode(o.plain); det.replaceChildren(h);
    await scramble(h, o.plain, o.hex.slice(0, Math.max(o.plain.length, 24)), 1300);
    row.classList.add('sealed');
    st.innerHTML = '<span class="rg-li">' + LOCK + '</span><span>' + t('engagement envoyé') + '</span>';
    st.querySelector('.rg-lock').classList.add('open'); await wait(450);
    st.querySelector('.rg-lock').classList.remove('open'); await wait(380);
    st.lastChild.textContent = o.after; res.textContent = t('Scellé'); res.className = 'rg-res rg-li';
    await anim(row, [{ background: 'rgba(129,59,245,.10)' }, { background: 'rgba(129,59,245,0)' }], { duration: 900 });
  }
  /**
   * Ouverture : le cadenas s'ouvre, l'empreinte se déchiffre, le contenu en clair (`o.node`) apparaît
   * (zones de la règle dessinées depuis l'entrée), puis la coche « engagement vérifié ». `o` = { hex, plain, node, res, resCls }.
   */
  async function open(row, o) {
    const det = row.querySelector('.rg-det'), res = row.querySelector('.rg-res'), st = row.querySelector('.rg-st');
    st.innerHTML = '<span class="rg-li">' + LOCK + '</span><span>' + t('ouverture…') + '</span>';
    st.querySelector('.rg-lock').classList.add('open'); await wait(420);
    const h = hexNode(o.hex.slice(0, Math.max(o.plain.length, 24))); det.replaceChildren(h);
    await scramble(h, h.textContent, o.plain, 1100);
    det.replaceChildren(o.node);
    o.node.querySelectorAll('.rg-zn').forEach(z => anim(z, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 700 }));
    row.classList.remove('sealed');
    if (o.res !== undefined) { res.className = 'rg-res ' + (o.resCls || ''); await scramble(res, res.textContent, o.res, 500); }
    st.innerHTML = '<span class="rg-up">' + CHK + '</span><span>' + t('engagement vérifié · ouvert') + '</span>';
    requestAnimationFrame(() => { const c = st.querySelector('.rg-chk'); if (c) c.classList.add('on'); });
  }
  window.sdCallAnim = { RM, LOCK, CHK, scramble, levels, levelsText, hexNode, seal, open, wait };
})();
