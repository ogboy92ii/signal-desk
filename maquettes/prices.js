// Résultat d'un call crypto ouvert, à partir de prix publics (A7, 03/11) : aucun oracle sur l'Ootle, donc le
// calcul est refait par chaque visiteur et vérifiable par tous.
// Sources : Binance (bougies 15 min, ou 1 h au-delà de 10 jours) ; XTM : CoinGecko (prix horaire, pas de bougies).
// Règle : le call est actif depuis son scellement au prix d'entrée ; le premier niveau touché décide
// (objectif = gagné, stop = perdu ; les deux dans la même bougie = stop, par prudence). Rien de touché :
// « en cours » avant l'échéance, « échéance » après, avec la variation au dernier prix connu.
(() => {
  const H = 3600e3, CACHE = 'sd-res-';
  const json = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); return r.json(); };
  // Bougies [t, haut, bas, clôture] entre from et to (ms).
  async function binance(symbol, from, to) {
    const iv = to - from > 10 * 24 * H ? ['1h', H] : ['15m', H / 4], out = [];
    for (let t = from; t < to && out.length < 20000;) {
      const k = await json(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${iv[0]}&startTime=${Math.floor(t)}&endTime=${Math.floor(to)}&limit=1000`);
      if (!Array.isArray(k) || !k.length) break;
      for (const c of k) out.push([+c[0], +c[2], +c[3], +c[4]]);
      t = +k[k.length - 1][0] + iv[1];
      if (k.length < 1000) break;
    }
    return { source: 'Binance', candles: out };
  }
  async function coingecko(id, from, to) {
    const r = await json(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(from / 1000)}&to=${Math.ceil(to / 1000)}`);
    return { source: 'CoinGecko', candles: (r && Array.isArray(r.prices) ? r.prices : []).map(([t, p]) => [t, p, p, p]) };
  }
  // Une paire saisie sans devise de cotation (« BTC », « SOL ») est cotée en USDT sur Binance ; « ETHBTC » ou « BTCUSDT » restent tels quels.
  const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];
  const symbolOf = a => { const s = String(a || '').toUpperCase(); return QUOTES.some(q => s.length > q.length && s.endsWith(q)) ? s : s + 'USDT'; };
  // XTM seul (ou XTMUSDT) : CoinGecko en USD ; « XTMBTC » n'est pas coté en USD (audit S6).
  const series = (asset, from, to) => /^XTM(USDT)?$/i.test(asset) ? coingecko('minotari', from, to) : binance(symbolOf(asset), from, to);

  /**
   * c = { asset, side, entry, tp, sl, until } (contenu du call ouvert), since = heure du scellement (ms).
   * Renvoie { state: 'win'|'loss'|'expired'|'open', exit, pct, at, source }.
   */
  async function outcome(c, since, key) {
    if (key) { try { const v = JSON.parse(localStorage.getItem(CACHE + key) || 'null'); if (v && v.state !== 'open') return v; } catch (e) {} }
    const until = Date.parse(c.until), end = Math.min(Date.now(), until);
    if (!(end > since)) return { state: 'open', exit: c.entry, pct: 0, at: since, source: '' };
    const { source, candles } = await series(c.asset, since, end);
    const long = c.side === 'LONG', pct = x => (long ? x - c.entry : c.entry - x) / c.entry * 100;
    // Audit S6 : une entrée hors de la première bougie après le scellement (± 2 %) n'est pas un vrai call (ex. « entrée 1 » sur BTC = +100 %).
    const f = candles[0];
    if (f && !(c.entry >= f[2] * 0.98 && c.entry <= f[1] * 1.02)) {
      const v = { state: 'invalid', exit: c.entry, pct: 0, at: f[0], source };
      if (key) { try { localStorage.setItem(CACHE + key, JSON.stringify(v)); } catch (e) {} }
      return v;
    }
    let res = null;
    for (const [t, hi, lo] of candles) {
      if (t > end) break;
      const stop = long ? lo <= c.sl : hi >= c.sl, target = long ? hi >= c.tp : lo <= c.tp;
      if (stop) { res = { state: 'loss', exit: c.sl, at: t }; break; }
      if (target) { res = { state: 'win', exit: c.tp, at: t }; break; }
    }
    if (!res) { const last = candles[candles.length - 1]; const px = last ? last[3] : c.entry; res = { state: Date.now() >= until ? 'expired' : 'open', exit: px, at: last ? last[0] : since }; }
    const v = { ...res, pct: Math.round(pct(res.exit) * 100) / 100, source };
    if (key && v.state !== 'open') { try { localStorage.setItem(CACHE + key, JSON.stringify(v)); } catch (e) {} }
    return v;
  }
  window.sdPrices = { outcome };
})();
