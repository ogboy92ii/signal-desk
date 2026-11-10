// Fond de toutes les pages : halos de lumière diffuse (violet, indigo, cyan) et grain léger, derrière le contenu.
// Chaque halo dérive lentement (CSS), se décale en parallaxe avec le scroll et suit un peu la souris (JS,
// une écriture de transform par image au plus). Aucun shader, aucun flou : de simples dégradés radiaux,
// composités par la carte graphique. Figé si les animations sont réduites.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const box = document.createElement('div');
  box.className = 'sd-bg'; box.setAttribute('aria-hidden', 'true');
  // [classe, vitesse de parallaxe au scroll, sensibilité à la souris]
  const ORBS = [['o1', 0.18, 26], ['o2', -0.12, -34], ['o3', 0.3, 18], ['o4', -0.22, -22], ['o5', 0.08, 40]];
  const orbs = ORBS.map(([cls, sp, ms]) => {
    const outer = document.createElement('div'); outer.className = 'sd-orb ' + cls;
    outer.appendChild(document.createElement('i')); box.appendChild(outer);
    return { el: outer, sp, ms };
  });
  box.appendChild(Object.assign(document.createElement('div'), { className: 'sd-grain' }));
  document.body.prepend(box);
  // Accueil : tant que la scène 3D (opaque) couvre tout l'écran, le fond est invisible : on le met en pause.
  const hero = document.querySelector('.hero');
  if (hero) new IntersectionObserver(es => box.classList.toggle('off', es[0].intersectionRatio >= 0.98), { threshold: [0, 0.98, 1] }).observe(hero);
  if (reduce) return;

  // Audit P5 : si le navigateur sait lier une animation au défilement, la parallaxe est faite par le compositeur
  // (CSS, classe .sd-scroll) ; le JS ne garde que la souris et la teinte. Sinon, ancien chemin (transform par image).
  const css = CSS.supports('animation-timeline: scroll()');
  if (css) box.classList.add('sd-scroll');
  // Position cible (scroll, souris) et position lissée : le mouvement reste doux même sur une molette crantée.
  let mx = 0, my = 0, sx = 0, cx = 0, cy = 0, cs = scrollY, queued = false, lastHue = -1;
  // Hauteur de page mise en cache (lire scrollHeight à chaque image forcerait un recalcul de mise en page).
  let span = 1; const measure = () => { span = Math.max(1, document.documentElement.scrollHeight - innerHeight); };
  measure(); new ResizeObserver(measure).observe(document.body); addEventListener('resize', measure);
  function frame() {
    queued = false;
    sx = scrollY;
    cs = css ? sx : cs + (sx - cs) * 0.12; cx += (mx - cx) * 0.06; cy += (my - cy) * 0.06;
    const k = Math.min(1, cs / span); // avancée dans la page, de 0 à 1
    // Parallaxe bornée : sur toute la page, un halo parcourt au plus quelques hauteurs d'écran.
    if (!css || fine) for (const { el, sp, ms } of orbs) {
      el.style.transform = css ? `translate3d(${(cx * ms).toFixed(1)}px, ${(cy * ms).toFixed(1)}px, 0)`
        : `translate3d(${(cx * ms).toFixed(1)}px, ${(-k * innerHeight * sp * 3 + cy * ms).toFixed(1)}px, 0)`;
    }
    // La teinte glisse du violet vers l'indigo au fil de la page (par pas d'un degré : peu de repeints).
    const hue = Math.round(k * 40);
    if (hue !== lastHue) { lastHue = hue; box.style.setProperty('--hue', hue + 'deg'); }
    if (Math.abs(sx - cs) > 0.5 || Math.abs(mx - cx) > 0.002 || Math.abs(my - cy) > 0.002) tick();
  }
  const tick = () => { if (!queued && !box.classList.contains('off')) { queued = true; requestAnimationFrame(frame); } };
  // Avec la parallaxe en CSS, le défilement ne sert plus qu'à la teinte : on ne relance une image que si elle change d'un degré.
  addEventListener('scroll', css ? () => { if (Math.round(Math.min(1, scrollY / span) * 40) !== lastHue) tick(); } : tick, { passive: true });
  if (fine) addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; tick(); }, { passive: true });
  tick();
})();
