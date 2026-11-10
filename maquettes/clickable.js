// Cartes entièrement cliquables : un clic n'importe où sur une carte suit son lien principal (ou data-go),
// sauf sur un vrai contrôle (lien, bouton, champ) ou pendant une sélection de texte. Le clavier garde les liens
// d'origine : rien n'est ajouté à l'ordre de tabulation.
(() => {
  const CARDS = '[data-go], .h2-mk, .h2-feat, .lv-mk, .lv-ev, .rkp, .h2-fc, .pr-done, .lv-kpi, .h2-ev, .pf-best-i';
  const CONTROLS = 'a, button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="radio"], [contenteditable]';
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.target.closest(CONTROLS)) return;
    const card = e.target.closest(CARDS);
    if (!card || (getSelection && String(getSelection()).length)) return;
    const go = card.dataset.go;
    if (go && go.startsWith('#')) {
      const t = document.querySelector(go); if (!t) return;
      t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      const f = t.querySelector('button:not([disabled]), input, a[href]'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 450);
      return;
    }
    if (go) { location.href = go; return; }
    const a = card.querySelector('a[href]'); if (a) a.click();
  });
})();
