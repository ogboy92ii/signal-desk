// Boutons : aimant (souris seulement), éclat qui suit le curseur, onde de lumière au clic.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, fine = matchMedia('(pointer: fine)').matches;
  document.querySelectorAll('.btn-main,.btn-link,.langbtn').forEach(b => {
    let r = null;
    b.addEventListener('pointerenter', () => { b.style.transform = ''; r = b.getBoundingClientRect(); });
    b.addEventListener('pointermove', e => {
      if (!r) r = b.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      b.style.setProperty('--mx', x + 'px'); b.style.setProperty('--my', y + 'px');
      if (fine && !still) b.style.transform = `translate(${(x / r.width - .5) * 10}px, ${(y / r.height - .5) * 8}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; r = null; });
  });
  if (!still) document.querySelectorAll('.btn-main').forEach(b => b.addEventListener('pointerdown', e => {
    const r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'burst';
    s.style.left = (e.clientX - r.left) + 'px'; s.style.top = (e.clientY - r.top) + 'px';
    b.appendChild(s); s.addEventListener('animationend', () => s.remove());
  }));
})();
