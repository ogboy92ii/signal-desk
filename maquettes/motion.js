// Mouvement du site (polish 03/11) : une seule personnalité, « Silk » (courbe .22,1,.36,1 déjà utilisée partout).
// - onglet actif qui glisse dans les groupes de filtres (.rk-period) et les onglets du profil (.pf-tabs) ;
// - pression des boutons (scale, Web Animations : n'écrase aucune transition existante) ;
// - listes qui apparaissent en cascade, une seule fois : sous la ligne de flottaison au défilement, ou juste
//   après un geste de l'utilisateur (filtre, onglet). Jamais sur un simple rafraîchissement de données.
// Rien ne bouge si l'utilisateur a demandé moins d'animations. Seuls transform / opacity sont animés.
(() => {
  // Barres qui défilent horizontalement (filtres, onglets, catégories de la nav) : fondu sur le bord qui cache
  // encore des onglets, pour signaler qu'on peut défiler (aide de lecture, active même sans animations).
  const SCROLLERS = '.rk-period, .rk-tabs, .pf-tabs, .tabs-pf, .cmd-cats';
  const fade = el => { const max = el.scrollWidth - el.clientWidth; el.classList.toggle('m-fade-l', max > 2 && el.scrollLeft > 2); el.classList.toggle('m-fade-r', max > 2 && el.scrollLeft < max - 2); };
  const fadeAll = () => document.querySelectorAll(SCROLLERS).forEach(el => { if (!el.dataset.mFade) { el.dataset.mFade = '1'; el.addEventListener('scroll', () => fade(el), { passive: true }); } fade(el); });
  const fadeSoon = (() => { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fadeAll(); }); }; })();
  addEventListener('resize', fadeSoon, { passive: true });
  // Audit P6 : un simple changement de texte (compte à rebours, horloge) ne change aucune barre : ignoré.
  const hasEl = m => [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1);
  new MutationObserver(list => { if (list.some(hasEl)) fadeSoon(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fadeSoon); else fadeSoon();
  if (document.fonts) document.fonts.ready.then(fadeSoon);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  const loaded = performance.now();
  let lastGesture = -1e9;
  for (const ev of ['pointerdown', 'keydown', 'input']) addEventListener(ev, () => { lastGesture = performance.now(); }, { capture: true, passive: true });
  const recent = () => performance.now() - lastGesture < 1500 || performance.now() - loaded < 4000;

  // ---- Onglet actif qui glisse ----
  // Pilule : filtres et onglets en segments. Filet : onglets du profil (haut) et du volet (bas).
  // Les puces .h2-chips passent à la ligne : elles gardent leur fondu de couleur, sans indicateur.
  const GROUPS = '.rk-period, .rk-tabs, .dr-nav, .pf-tabs, .tabs-pf';
  const LINE = g => g.classList.contains('pf-tabs') || g.classList.contains('tabs-pf');
  const last = new Map();
  const keyOf = g => g.getAttribute('aria-label') || g.id || g.className;
  function place(g) {
    if (!g.isConnected || !g.offsetParent) return;
    const act = g.querySelector('[aria-pressed="true"], [aria-selected="true"]');
    let ind = g.querySelector(':scope > .m-ind');
    if (!act) { if (ind) ind.hidden = true; return; }
    g.classList.add(LINE(g) ? 'm-line' : 'm-pill');
    const x = act.offsetLeft, w = act.offsetWidth, k = keyOf(g), prev = last.get(k);
    if (!ind) {
      ind = document.createElement('i'); ind.className = 'm-ind'; ind.setAttribute('aria-hidden', 'true'); g.prepend(ind);
      // Groupe redessiné (le profil reconstruit sa barre à chaque clic) : on repart de l'ancienne position.
      if (prev) { ind.style.width = prev.w + 'px'; ind.style.translate = prev.x + 'px 0'; ind.getBoundingClientRect(); }
    }
    ind.hidden = false; ind.style.width = w + 'px'; ind.style.translate = x + 'px 0';
    last.set(k, { x, w });
  }
  let queued = false;
  const placeAll = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; document.querySelectorAll(GROUPS).forEach(place); }); };

  // ---- Pression des boutons ----
  const PRESS = '.btn-main, .btn-sm, .btn-link, .rk-period button, .chip, .ico, .dr-close, .h2-mk-buy, .wallet-btn, .langbtn, .cm-fol, .pf-tabs button, .lnk';
  addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest(PRESS); if (!b || b.disabled) return;
    const down = b.animate([{ scale: 1 }, { scale: 0.965 }], { duration: 110, easing: 'ease-out', fill: 'forwards' });
    const up = () => { removeEventListener('pointerup', up, true); removeEventListener('pointercancel', up, true);
      b.animate([{ scale: 0.965 }, { scale: 1.01, offset: 0.55 }, { scale: 1 }], { duration: 320, easing: EASE }).finished.then(() => down.cancel(), () => down.cancel()); };
    addEventListener('pointerup', up, true); addEventListener('pointercancel', up, true);
  }, { passive: true });

  // ---- Apparition des listes ----
  const ITEMS = '.rg-row:not(.rg-headrow), .h2-mk, .pr-card, .lg-club, .cm-col, .cm-row, .rkp, .pr-drow';
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const rise = (els, step = 26, max = 12) => els.slice(0, 40).forEach((el, i) => {
    el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 520, delay: Math.min(i, max) * step, easing: EASE, fill: 'backwards' });
  });
  const io = new IntersectionObserver(entries => {
    const show = entries.filter(e => e.isIntersecting).map(e => e.target);
    show.forEach(el => { io.unobserve(el); el.classList.remove('m-pre'); });
    rise(show, 40, 8);
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  // Sous la ligne de flottaison : masqué jusqu'au défilement (une seule fois). À l'écran : cascade si geste récent.
  function handle(nodes) {
    const now = [], below = [];
    for (const el of nodes) (inView(el) ? now : below).push(el);
    below.forEach(el => { el.classList.add('m-pre'); io.observe(el); });
    if (now.length && recent()) rise(now);
  }
  const collect = root => { const out = []; if (root.nodeType !== 1) return out; if (root.matches(ITEMS)) out.push(root); root.querySelectorAll(ITEMS).forEach(x => out.push(x)); return out; };

  const mo = new MutationObserver(list => {
    const added = []; let place = false;
    for (const m of list) {
      if (m.type === 'childList') { m.addedNodes.forEach(n => added.push(...collect(n))); if (hasEl(m)) place = true; }
      else place = true;
    }
    // Audit P6 : un changement de texte seul ne déplace aucun onglet actif.
    if (place) placeAll();
    if (added.length) handle([...new Set(added)]);
  });
  const start = () => {
    handle(collect(document.body));
    placeAll();
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected', 'hidden'] });
    addEventListener('resize', placeAll, { passive: true });
    if (document.fonts) document.fonts.ready.then(placeAll);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
