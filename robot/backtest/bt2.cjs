// Backtest des 3 robots crypto sous la règle du site : objectif >= 2 %, stop entre 0,2 % et 2 x objectif, échéance <= 72 h.
const SKIP = process.argv.includes("--skip");
// Règlement comme prices.js : stop testé avant l'objectif dans une même bougie, sinon dernier prix à l'échéance (> entrée = gagné).
// Un call à la fois par paire, signal évalué à chaque heure sur bougies closes (120 dernières), comme signalbot.cjs.
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, 'bt_data');
const ema = (xs, n) => { const k = 2 / (n + 1); let e = xs.slice(0, n).reduce((s, x) => s + x, 0) / n; for (const x of xs.slice(n)) e = x * k + e * (1 - k); return e; };
function atr(cs, n) { const tr = cs.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - cs[i].c), Math.abs(c.l - cs[i].c)));
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (const x of tr.slice(n)) a = (a * (n - 1) + x) / n; return a; }
function rsi(xs, n) { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }

const H = {}; for (const f of fs.readdirSync(D)) H[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(D, f))).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
// Bougies 4 h agrégées (alignées UTC), avec l'heure de clôture.
const agg4 = cs => { const out = []; for (const c of cs) { const b = Math.floor(c.t / 144e5) * 144e5, last = out[out.length - 1];
  if (last && last.t === b) { last.h = Math.max(last.h, c.h); last.l = Math.min(last.l, c.l); last.c = c.c; last.n++; } else out.push({ t: b, o: c.o, h: c.h, l: c.l, c: c.c, n: 1 }); } return out; };
const H4 = {}; for (const p in H) H4[p] = agg4(H[p]);

const BOTS = {
  trend: { iv: '1h', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], sig: (cs, cl, last) => { const e20 = ema(cl, 20), e50 = ema(cl, 50); return e20 > e50 && last > e20 ? 1 : e20 < e50 && last < e20 ? -1 : 0; } },
  range: { iv: '1h', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'], sig: (cs, cl) => { const r = rsi(cl, 14); return r < 35 ? 1 : r > 65 ? -1 : 0; } },
  breakout: { iv: '4h', pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'], sig: (cs, cl, last) => { const prev = cs.slice(-21, -1), hi = Math.max(...prev.map(c => c.h)), lo = Math.min(...prev.map(c => c.l)); return last > hi ? 1 : last < lo ? -1 : 0; } },
};

// Pré-calcul des signaux (indépendant des paramètres de sortie) : à chaque heure i, direction + ATR + prix.
function signals(bot, pair) {
  const B = BOTS[bot], h1 = H[pair], out = [];
  let j4 = 0; const h4 = H4[pair];
  for (let i = 200; i < h1.length - 1; i++) {
    const now = h1[i].t + 36e5; // fin de la bougie i : on décide sur les bougies closes
    let cs;
    if (B.iv === '1h') cs = h1.slice(i - 119, i + 1);
    else { while (j4 < h4.length && h4[j4].t + 144e5 <= now) j4++; if (j4 < 121) continue; cs = h4.slice(j4 - 120, j4); }
    const cl = cs.map(c => c.c), last = cl[cl.length - 1], s = B.sig(cs, cl, last);
    out.push(s ? { i, s, a: atr(cs, 14), px: h1[i].c } : null);
  }
  return out;
}
function run(bot, pair, sigs, { tpK, slK, hz }, from, to) {
  const h1 = H[pair], res = []; let busyUntil = -1;
  for (const g of sigs) {
    if (!g || g.i <= busyUntil || g.i < from || g.i >= to) continue;
    const e = g.px; if (SKIP && tpK * g.a / e < 0.02) continue; const up = Math.max(tpK * g.a / e, 0.02), down = Math.min(Math.max(slK * g.a / e, 0.002), 1.95 * up, 0.29);
    if (up > 0.5) continue;
    const tp = e * (1 + g.s * up), sl = e * (1 - g.s * down), end = g.i + hz;
    let r = null;
    for (let k = g.i + 1; k <= Math.min(end, h1.length - 1); k++) {
      const c = h1[k], stop = g.s > 0 ? c.l <= sl : c.h >= sl, tgt = g.s > 0 ? c.h >= tp : c.l <= tp;
      if (stop) { r = -down; busyUntil = k; break; } if (tgt) { r = up; busyUntil = k; break; }
    }
    if (r === null) { const k = Math.min(end, h1.length - 1); r = g.s * (h1[k].c - e) / e; busyUntil = k; }
    res.push(r);
  }
  return res;
}
const stat = rs => { const n = rs.length, w = rs.filter(r => r > 0).length; return { n, rate: n ? w / n : 0, avg: n ? rs.reduce((s, r) => s + r, 0) / n * 100 : 0 }; };
const grid = []; for (const tpK of [1, 1.5, 2, 3, 4]) for (const slK of [0.75, 1, 1.5, 2, 3, 4]) for (const hz of [12, 24, 48, 72]) grid.push({ tpK, slK, hz });
const CUR = { trend: { tpK: 2, slK: 1, hz: 12 }, range: { tpK: 1.5, slK: 1, hz: 8 }, breakout: { tpK: 3, slK: 1.5, hz: 24 } };
for (const bot of Object.keys(BOTS)) {
  const S = {}; for (const p of BOTS[bot].pairs) S[p] = signals(bot, p);
  const N = H.BTCUSDT.length, cut = Math.floor(N * 2 / 3);
  const evalP = (prm, a, b) => stat(BOTS[bot].pairs.flatMap(p => run(bot, p, S[p], prm, a, b)));
  const cur = evalP(CUR[bot], 0, N);
  // Choix sur les 2/3 anciens : meilleur taux parmi les réglages à espérance positive et assez de calls ; vérification sur le 1/3 récent.
  const scored = grid.map(prm => ({ prm, tr: evalP(prm, 0, cut) })).map(x => ({ ...x, te: evalP(x.prm, cut, N) })).filter(x => x.tr.avg > 0 && x.te.avg >= 0 && x.tr.n >= 40).sort((a, b) => Math.min(b.tr.rate, b.te.rate) - Math.min(a.tr.rate, a.te.rate));
  console.log(`\n== ${bot} — actuel (avec plancher 2 %) ${JSON.stringify(CUR[bot])} : ${cur.n} calls, ${(cur.rate * 100).toFixed(1)} %, moy ${cur.avg.toFixed(2)} %`);
  for (const x of scored.slice(0, 6)) { const te = evalP(x.prm, cut, N);
    console.log(`  ${JSON.stringify(x.prm)} entraînement ${x.tr.n} / ${(x.tr.rate * 100).toFixed(1)} % / ${x.tr.avg.toFixed(2)} %  ->  test ${te.n} / ${(te.rate * 100).toFixed(1)} % / ${te.avg.toFixed(2)} %`); }
}
