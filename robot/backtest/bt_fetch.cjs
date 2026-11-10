// Télécharge ~1 an de bougies 1 h Binance pour les paires des robots (cache JSON).
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'bt_data'); fs.mkdirSync(OUT, { recursive: true });
const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
(async () => {
  for (const p of PAIRS) {
    let end = Date.now(), all = [];
    for (let i = 0; i < 9; i++) {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${p}&interval=1h&limit=1000&endTime=${end}`);
      const k = await r.json(); if (!k.length) break;
      all = k.map(x => [x[0], +x[1], +x[2], +x[3], +x[4]]).concat(all); end = k[0][0] - 1;
    }
    fs.writeFileSync(path.join(OUT, p + '.json'), JSON.stringify(all)); console.log(p, all.length, new Date(all[0][0]).toISOString().slice(0, 10));
  }
})();
