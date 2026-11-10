// Signal Desk on the Tari Ootle: reads through the public indexer (no wallet needed), writes through
// the visitor's wallet (Sapient). Mirrors repo/src/lib.rs; any change there must be reflected here.
// Sources: Sapient integration guide (universe.tari.mw/integration/llms-full.txt) and the Crypt demo
// (tari-crypt/crypt/demo/web/src/wallet.ts), both checked on esmeralda.
(() => {
  // ---- Networks ------------------------------------------------------------------------------
  // `template` stays empty until Signal Desk is published on that network: every write is refused.
  const NETWORKS = {
    // `forecasts.board` : adresse du tableau de pronostics ouvert par l'organisateur (vide = exemples).
    esmeralda: { indexer: 'https://ootle-indexer-a.tari.com', template: 'template_a88bcb569681310009d9e33672d03c8299857211ad0ff5648752bce4bcdbc325', profiles: true, forecasts: { template: 'template_0035855954f95e2d51d486c75a712de004d16404d34c955e26795368c0c44f4f', v2: true, legacy: ['template_edf234c40754cf7ecd47d0b20ae0aa42c5f8c521b9a6f4ec694f137b80e63356', 'template_8b9724c7987bc35ae5caa1c52bfcea7f77d6a2f9d6568dc8a76fce8ece275816'], board: 'component_52c459f0c75989e45ecaec5d9ce39712ebc13ebd06dabf8f6005ed3813b5875a' }, follows: { template: 'template_4640483eff1282756f2b80ebec75cb60b45160666035154d085bddeff517efc2' },
      // Desks officiels (robots du projet) : marque ✓ ajoutée par le site, jamais déduite du nom (audit F2).
      // Desks masqués par le modérateur (règles enfreintes) : adresses ajoutées ici à la main.
      hidden: [],
      official: ['component_7642b21d9fbb21239d2307e57f3cf27a5baf80e4ec3874d28e702ac97585d294', 'component_a922eec776f6121d3c5924bb05b26e90acd8a6aa3a16c72d60257b86e2f8f950', 'component_2b40c60e3c492a4063a97308bf65b2944fa893735c027abc411f0284446a0f60', 'component_3b91a9d07afce478a710ebdc5324c267a505cda426cd2f385959ea04bc9a9885'] },
    mainnet: { indexer: '', template: '', forecasts: { template: '', board: '' }, follows: { template: '' } },
  };
  const TARI = 'resource_0101010101010101010101010101010101010101010101010101010101010101';
  const MAX_FEE = '200000';
  // Contract limits (lib.rs).
  const REVEAL_WINDOW_EPOCHS = 10, MAX_REVEAL_HORIZON_EPOCHS = 10000, NONCE_LEN = 32, MAX_TLOCK_LEN = 640;
  // A2 (08/11) : une époque d'esmeralda dure ~1 h en moyenne (12878 → 12950 en 72 h, 05-08/11), mais la cadence varie
  // à court terme (45 s/bloc le 03/11, 49,5 s le 09/11). R2 (09/11, audit F8) : le verrou drand vise le MILIEU de la
  // fenêtre d'ouverture (calls : 10 époques, pronostics : until - close), ce qui tolère une dérive dans les deux sens,
  // et l'horizon est borné pour qu'une dérive de TLOCK_DRIFT tienne dans la demi-fenêtre (calls : 100 époques ≈ 4 j).
  const EPOCH_MS = 3600e3, TLOCK_DRIFT = 0.05;
  const tlockMaxHorizon = window => Math.floor(Math.floor(window / 2) / TLOCK_DRIFT);
  const MAX_CALL_HORIZON_EPOCHS = tlockMaxHorizon(REVEAL_WINDOW_EPOCHS);
  const DOMAIN = new TextEncoder().encode('tari.ootle.signal_desk.commitment.v2');
  // SaleStatus (lib.rs), in the order of its #[n] variants.
  const SALE = ['Paid', 'Delivered', 'Upheld', 'Fraud', 'Refunded'];
  const COMPONENT = /^component_[0-9a-f]{64}$/, RESOURCE = /^resource_[0-9a-f]{64}$/, HEX = /^(?:[0-9a-f]{2})*$/;

  const hexOf = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const fromHex = h => { if (!HEX.test(h)) throw new TypeError('not lowercase hex'); return Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)); };
  const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const le64 = n => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };

  // ---- BLAKE2b-256 (RFC 7693), the hash of commitment_of ---------------------------------------
  const M64 = (1n << 64n) - 1n;
  const IV = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map(h => BigInt('0x' + h));
  const SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  ];
  const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;
  function blake2b256(data) {
    const h = IV.slice(); h[0] ^= 0x01010000n ^ 32n; // digest length 32, no key
    const blocks = Math.max(1, Math.ceil(data.length / 128));
    for (let b = 0; b < blocks; b++) {
      const chunk = new Uint8Array(128); chunk.set(data.subarray(b * 128, b * 128 + 128));
      const m = []; for (let i = 0; i < 16; i++) { let w = 0n; for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(chunk[i * 8 + j]); m.push(w); }
      const last = b === blocks - 1, t = BigInt(last ? data.length : (b + 1) * 128);
      const v = [...h, ...IV]; v[12] ^= t & M64; v[13] ^= t >> 64n; if (last) v[14] ^= M64;
      const G = (a, bb, c, d, x, y) => {
        v[a] = (v[a] + v[bb] + x) & M64; v[d] = rotr(v[d] ^ v[a], 32); v[c] = (v[c] + v[d]) & M64; v[bb] = rotr(v[bb] ^ v[c], 24);
        v[a] = (v[a] + v[bb] + y) & M64; v[d] = rotr(v[d] ^ v[a], 16); v[c] = (v[c] + v[d]) & M64; v[bb] = rotr(v[bb] ^ v[c], 63);
      };
      for (let r = 0; r < 12; r++) {
        const s = SIGMA[r % 10];
        G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]); G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
        G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]); G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
      }
      for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    const out = new Uint8Array(32); for (let i = 0; i < 4; i++) out.set(le64(h[i]), i * 8);
    return out;
  }

  // ---- Call format and commitment (lib.rs commitment_of / payload_is_canonical) -----------------
  const isCanonical = p => typeof p === 'string' && /^[\x20-\x7e]*$/.test(p);
  /** Hex of commitment_of(desk, publisher, seq, payload, nonce). `desk` is "component_<hex>". */
  function commitmentOf(desk, publisherHex, seq, payload, nonceHex) {
    const enc = new TextEncoder();
    const parts = [DOMAIN, enc.encode(desk), fromHex(publisherHex), le64(seq), enc.encode(payload), fromHex(nonceHex)];
    return hexOf(blake2b256(concat(parts.flatMap(p => [le64(p.length), p]))));
  }
  const newNonce = () => hexOf(crypto.getRandomValues(new Uint8Array(NONCE_LEN)));
  // v1|ACTIF|LONG|entrée|TP|SL|échéance (doc maître 5.2). Free text is allowed but never ranked.
  const V1 = /^v1\|[A-Z0-9]{2,20}\|(LONG|SHORT)\|\d+(\.\d+)?\|\d+(\.\d+)?\|\d+(\.\d+)?\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
  function parseV1(p) {
    if (!V1.test(p)) return null;
    const [, asset, side, entry, tp, sl, until] = p.split('|');
    const [e, t, s] = [entry, tp, sl].map(Number);
    // A long's target sits above its entry and its stop below; the reverse for a short.
    if (side === 'LONG' ? !(t > e && s < e) : !(t < e && s > e)) return null;
    return { asset, side, entry: e, tp: t, sl: s, until };
  }

  // Sport and politics calls (see maquettes/DOCUMENTATION.md): the label is public from the seal on, the
  // contract only opens a payload that starts with it. Names are upper-case ASCII so the payload stays canonical.
  const NAME = "[A-Z0-9][A-Z0-9 .'-]{0,23}", WHEN = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}Z', NUM = '\\d{1,4}(\\.5|\\.0)?';
  const SPORT = new RegExp('^v1\\|(NFL|NBA|UCL|EPL|UFC|BOX)\\|(' + NAME + ')(@| vs )(' + NAME + ')\\|(' + WHEN + ')\\|(.+)$');
  // 10/11 (Soufian) : Finance / Politique = question fermée dont l'autorité qui fait foi est publique dès le scellement
  // (1er champ : SEC, FED, ECB, CFTC, ou le code du pays pour un résultat officiel de vote). Call libre = sujet public,
  // texte secret jusqu'à l'ouverture, sans verdict. Les deux tiennent dans le format v1 du contrat, rien à republier.
  const POL = new RegExp('^v1\\|POL\\|([A-Z]{2,4})\\|([A-Z0-9][A-Z0-9 .\'-]{1,39})\\|(' + WHEN + ')\\|CHOICE\\|([A-Z0-9][A-Z0-9 .,%\'-]{0,39})$');
  const FREE = new RegExp('^v1\\|FREE\\|([A-Za-z0-9][A-Za-z0-9 .,\'?!%:+-]{1,39})\\|(' + WHEN + ')\\|TEXT\\|([\\x20-\\x7b\\x7d\\x7e]{1,110})$');
  function labelIsValid(l) { return l.length >= 2 && l.length <= 64 && isCanonical(l) && l.split('|').every(f => f.length > 0); }
  /** A call payload of any kind: { cat, label, ... } or null when it is malformed. */
  function parseCall(p) {
    if (typeof p !== 'string' || !isCanonical(p)) return null;
    const c = parseV1(p);
    if (c) return { cat: 'crypto', label: c.asset, ...c };
    let m = p.match(SPORT);
    if (m) {
      // UCL (Ligue des champions) et EPL (Premier League) ajoutés le 09/11 : sports d'équipe, match nul possible.
      const [, league, a, sep, b, when, pick] = m, us = league === 'NFL' || league === 'NBA', soccer = league === 'UCL' || league === 'EPL', team = us || soccer;
      if ((sep === '@') !== team || a === b) return null;
      const f = pick.split('|'), side = x => x === a || x === b, num = x => new RegExp('^' + NUM + '$').test(x), ou = x => x === 'OVER' || x === 'UNDER';
      const ok = f[0] === 'WIN' ? f.length === 2 && (side(f[1]) || (soccer && f[1] === 'DRAW'))
        : f[0] === 'SPREAD' ? us && f.length === 3 && side(f[1]) && /^[+-]\d{1,2}(\.5|\.0)?$/.test(f[2])
        : f[0] === 'TOTAL' ? team && f.length === 3 && ou(f[1]) && num(f[2])
        : f[0] === 'PROP' ? us && f.length === 5 && new RegExp('^' + NAME + '$').test(f[1]) && (league === 'NFL' ? ['TD', 'YDS'] : ['PTS', 'REB', 'AST']).includes(f[2]) && ou(f[3]) && num(f[4])
        : f[0] === 'METHOD' ? !team && f.length === 3 && side(f[1]) && (league === 'UFC' ? ['KO', 'SUB', 'DEC'] : ['KO', 'DEC']).includes(f[2])
        : f[0] === 'ROUNDS' ? !team && f.length === 3 && ou(f[1]) && num(f[2]) : false;
      const label = [league, a + sep + b, when].join('|');
      return ok && labelIsValid(label) ? { cat: 'sport', label, league, a, b, when, pick: f } : null;
    }
    m = p.match(POL);
    if (m) { const label = ['POL', m[1], m[2], m[3]].join('|'); return labelIsValid(label) ? { cat: 'pol', label, country: m[1], subject: m[2], when: m[3], choice: m[4] } : null; }
    m = p.match(FREE);
    if (m) { const label = ['FREE', m[1], m[2]].join('|'); return labelIsValid(label) ? { cat: 'free', label, subject: m[1], when: m[2], text: m[3] } : null; }
    return null;
  }

  // ---- Arguments: InstructionArg::Literal is the CBOR of the value, as hex ----------------------
  function head(major, n) {
    n = BigInt(n); const m = major << 5;
    if (n < 24n) return [m | Number(n)];
    for (const [info, len] of [[24, 1], [25, 2], [26, 4], [27, 8]]) if (n < 1n << BigInt(8 * len)) {
      const out = [m | info]; for (let i = len - 1; i >= 0; i--) out.push(Number((n >> BigInt(8 * i)) & 0xffn)); return out;
    }
    throw new RangeError('integer above 64 bits');
  }
  const lit = bytes => ({ Literal: hexOf(bytes) });
  const arg = {
    uint: n => { if (BigInt(n) < 0n) throw new RangeError('negative'); return lit(head(0, n)); }, // u64, and Amount
    bytes: h => { const b = fromHex(h); return lit([...head(2, b.length), ...b]); },          // Hash32, Bytes
    text: s => { const b = new TextEncoder().encode(s); return lit([...head(3, b.length), ...b]); }, // String
    // Addresses are CBOR tags around their 32 bytes (BinaryTag: component 128, resource 131).
    component: a => { if (!COMPONENT.test(a)) throw new TypeError('not a component address'); const b = fromHex(a.slice(10)); return lit([...head(6, 128), ...head(2, 32), ...b]); },
    resource: a => { if (!RESOURCE.test(a)) throw new TypeError('not a resource address'); const b = fromHex(a.slice(9)); return lit([...head(6, 131), ...head(2, 32), ...b]); },
    components: list => { const out = [...head(4, list.length)]; for (const a of list) { if (!COMPONENT.test(a)) throw new TypeError('not a component address'); out.push(...head(6, 128), ...head(2, 32), ...fromHex(a.slice(10))); } return lit(out); },
    ws: (id, offset = null) => ({ Workspace: { id, offset } }),
    bool: b => lit([b ? 0xf5 : 0xf4]),
    // Vec<RistrettoPublicKeyBytes> : chaque clé est une chaîne d'octets nue (comme `organizer` dans l'état).
    keys: list => { const out = [...head(4, list.length)]; for (const k of list) { if (!/^[0-9a-f]{64}$/.test(k)) throw new TypeError('not a public key'); out.push(...head(2, 32), ...fromHex(k)); } return lit(out); },
  };
  const method = (component, name, args) => ({ CallMethod: { call: { Address: component }, method: name, args } });

  // ---- Indexer reads -------------------------------------------------------------------------
  const net = name => NETWORKS[name] || null;
  // Beaucoup de visiteurs lisent les mêmes états : une lecture sert 15 s (mémoire, puis session pour la page
  // suivante), deux lectures identiques en vol n'en font qu'une, et l'indexeur saturé (429, 5xx) est réessayé
  // avec un délai croissant au lieu d'être martelé. Une transaction réussie vide le cache (état neuf).
  const TTL = 15000, inflight = new Map(), memo = new Map();
  const sget = k => { try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); return v && Date.now() - v.t < TTL ? v.b : null; } catch (e) { return null; } };
  const sset = (k, b) => { try { const s = JSON.stringify({ t: Date.now(), b }); if (s.length < 200000) sessionStorage.setItem(k, s); } catch (e) {} };
  const clearReads = () => { memo.clear(); try { Object.keys(sessionStorage).filter(k => k.startsWith('sd-ix|')).forEach(k => sessionStorage.removeItem(k)); } catch (e) {} };
  // From Ootle 0.48 the indexer serves engine values as their CBOR bytes, base64 in the JSON: a
  // substate under `substate`/`value`, a result under `execution_result`. Tari's own decoder
  // (vendor/ootle-wasm-bor, npm @tari-project/ootle-wasm-bor 0.49.2, files identical to the package)
  // turns them back into the JSON the parsers below read. Same rules as the Crypt demo (decode.ts).
  const KEYS = { substate: 'decodeSubstateValue', value: 'decodeSubstateValue', execution_result: 'decodeExecuteResult', execute_result: 'decodeExecuteResult' };
  const B64 = /^[A-Za-z0-9+/]{8,}={0,2}$/, HEXONLY = /^[0-9a-f]+$/;
  const encoded = (k, v) => k in KEYS && typeof v === 'string' && B64.test(v) && !HEXONLY.test(v);
  const needs = v => (Array.isArray(v) ? v.some(needs) : v !== null && typeof v === 'object' && Object.entries(v).some(([k, x]) => encoded(k, x) || needs(x)));
  let bor;
  const loadBor = () => (bor ??= (async () => {
    const glue = await import('./vendor/ootle-wasm-bor/ootle_wasm_bor_bg.js');
    const bin = await (await fetch('vendor/ootle-wasm-bor/ootle_wasm_bor_bg.wasm')).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bin, { './ootle_wasm_bor_bg.js': glue });
    glue.__wbg_set_wasm(instance.exports); instance.exports.__wbindgen_start();
    return glue;
  })().catch(e => { bor = undefined; throw e; })); // audit K2 : un échec de chargement ne reste pas en cache
  const decodeIn = (v, g) => (Array.isArray(v) ? v.map(x => decodeIn(x, g)) : v === null || typeof v !== 'object' ? v
    : Object.fromEntries(Object.entries(v).map(([k, x]) => { if (!encoded(k, x)) return [k, decodeIn(x, g)]; try { return [k, JSON.parse(g[KEYS[k]](x))]; } catch (e) { return [k, x]; } })));
  async function readable(v) { return needs(v) ? decodeIn(v, await loadBor()) : v; }
  // Événements de l'indexeur 0.49 : `events: [[tx, CBOR base64], …]`, CBOR = [substate, template, topic, payload].
  // Ni decodeIn (clés substate/value/execution_result) ni decodeEvent (refuse ce format) ne les lisent : avant ce
  // lecteur, aucune question de ligue ni livraison de call n'était vue (vérifié le 04/11 sur la 1re question réelle).
  // Données réseau non fiables (audit S1, 04/11) : chaque longueur annoncée est comparée aux octets restants avant
  // toute allocation (un en-tête « tableau de 4 milliards » gelait l'onglet), profondeur bornée, entrée bornée.
  const CBOR_MAX_DEPTH = 8;
  function cbor(b) {
    let i = 0;
    const need = n => { if (!(n >= 0) || i + n > b.length) throw new RangeError('cbor: truncated'); };
    const rd = depth => {
      if (depth > CBOR_MAX_DEPTH) throw new RangeError('cbor: too deep');
      need(1); const ib = b[i++], mt = ib >> 5, ai = ib & 31; let v = ai;
      if (ai === 24) { need(1); v = b[i++]; }
      else if (ai === 25) { need(2); v = b[i] * 256 + b[i + 1]; i += 2; }
      else if (ai === 26) { need(4); v = ((b[i] * 256 + b[i + 1]) * 256 + b[i + 2]) * 256 + b[i + 3]; i += 4; }
      else if (ai === 27) { need(8); v = 0; for (let k = 0; k < 8; k++) v = v * 256 + b[i++]; }
      else if (ai > 27) throw new Error('cbor: indefinite length');
      if (mt === 0) return v;
      if (mt === 1) return -1 - v;
      if (mt === 2) { need(v); const x = b.slice(i, i + v); i += v; return x; }
      if (mt === 3) { need(v); const x = new TextDecoder().decode(b.slice(i, i + v)); i += v; return x; }
      if (mt === 4) { need(v); const a = []; for (let k = 0; k < v; k++) a.push(rd(depth + 1)); return a; } // ≥ 1 octet par élément
      if (mt === 5) { need(2 * v); const o = Object.create(null); for (let k = 0; k < v; k++) { const key = rd(depth + 1); o[String(key)] = rd(depth + 1); } return o; }
      if (mt === 6) return rd(depth + 1); // étiquette : on garde la valeur
      return ai === 20 ? false : ai === 21 ? true : null;
    };
    return rd(0);
  }
  const evHex = x => (x instanceof Uint8Array ? [...x].map(c => c.toString(16).padStart(2, '0')).join('') : x);
  function eventOf(e) {
    if (!Array.isArray(e) || typeof e[1] !== 'string') return e;
    if (e[1].length > 8192) return null; // un événement fait au plus 2 Kio ; au-delà, donnée hostile
    try {
      const d = cbor(Uint8Array.from(atob(e[1]), c => c.charCodeAt(0)));
      if (!Array.isArray(d)) return null;
      const p = d[3] && typeof d[3] === 'object' && !(d[3] instanceof Uint8Array) && !Array.isArray(d[3]) ? d[3] : {};
      // `template` = template qui a émis l'événement (audit S2 : sans lui, un autre template pouvait forger des événements).
      return { tx: e[0], template: d[1] instanceof Uint8Array ? evHex(d[1]) : '', topic: String(d[2] || ''), payload: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, evHex(v)])) };
    } catch (x) { return null; }
  }
  async function indexer(network, path) {
    const n = net(network); if (!n || !n.indexer) throw new Error('no indexer for ' + network);
    const key = 'sd-ix|' + network + '|' + path, m = memo.get(key);
    if (m && Date.now() - m.t < TTL) return m.b;
    const s = sget(key); if (s) { memo.set(key, { t: Date.now(), b: s }); return s; }
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      for (let i = 0; ; i++) {
        // Audit K1 : sans délai maximal, un indexeur muet bloquait les fenêtres (« Vérification… ») indéfiniment.
        let r;
        try { r = await fetch(n.indexer + '/' + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) }); }
        catch (e) { if (i < 2 && (e.name === 'TimeoutError' || e.name === 'AbortError' || e.name === 'TypeError')) { await new Promise(ok => setTimeout(ok, 500 * 2 ** i)); continue; } throw new Error('indexer unreachable'); }
        if ((r.status === 429 || r.status >= 500) && i < 3) { await new Promise(ok => setTimeout(ok, 500 * 2 ** i + Math.random() * 400)); continue; }
        const raw = await r.json().catch(() => null);
        if (!r.ok || !raw) throw new Error((raw && raw.error) || 'indexer ' + r.status);
        const body = await readable(raw);
        memo.set(key, { t: Date.now(), b: body }); sset(key, body); return body;
      }
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }
  const currentEpoch = async network => { const s = await indexer(network, 'epoch-manager/stats'); if (!Number.isSafeInteger(s.current_epoch)) { clearReads(); throw new Error('bad epoch'); } /* audit K17 : un corps altéré ne sert pas 15 s */
    if (Number.isSafeInteger(s.current_block_height)) heights.set(network, { epoch: s.current_epoch, height: s.current_block_height }); return s.current_epoch; };
  // Recette V2 (09/11) : une époque = 80 blocs L1 d'environ 45 s (281 blocs en 3 h 30 mesurés le 03/11). La hauteur de bloc
  // donne la position dans l'époque en cours : les comptes à rebours ne sont plus arrondis à l'heure entière.
  const BLOCKS_PER_EPOCH = 80, BLOCK_MS = EPOCH_MS / BLOCKS_PER_EPOCH, heights = new Map();
  /** Heure estimée (ms) du début de l'époque `e`, vue depuis l'époque courante `epoch` (lue par currentEpoch). */
  const epochStart = (network, e, epoch) => {
    const h = heights.get(network), now = Date.now();
    if (h && h.epoch === epoch && Math.floor(h.height / BLOCKS_PER_EPOCH) === epoch) return now + (e * BLOCKS_PER_EPOCH - h.height) * BLOCK_MS;
    return now - (epoch - e) * EPOCH_MS;
  };
  // Decoded engine values: bytes are {"@cbor":"bytes",hex}, tags {"@cbor":"tag",tag,value}.
  const bytesHex = v => (v && v['@cbor'] === 'bytes' && HEX.test(v.hex) ? v.hex : null);
  const tagged = (v, tag) => (v && v['@cbor'] === 'tag' && v.tag === tag ? bytesHex(v.value) : null);
  const u64 = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const amount = v => (Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : typeof v === 'string' && /^\d{1,30}$/.test(v) ? BigInt(v) : null);
  /**
   * The desk's state, field by field in the order of `struct SignalDesk` (lib.rs). Anything that does
   * not have the expected shape throws: a desk the page cannot read is shown as unreadable, never guessed.
   */
  function parseDesk(address, substate, template) {
    const c = substate && substate.Component;
    if (!c || !c.header || !c.body || !Array.isArray(c.body.state)) throw new Error('not a component');
    if (template && c.header.template_address !== template.replace(/^template_/, '')) throw new Error('not a Signal Desk component');
    // struct SignalDesk / Call / Sale (palier 2), champs dans l'ordre du contrat.
    // `name`, `bio`, `picture` : carte publique du desk (contrat 4410a4b), absente des desks plus anciens.
    const [publisher, payout, opened, calls, salesCount, earnings, withdrawable, name, bio, picture] = c.body.state;
    // Ventes d'un call : enregistrements de 97 octets dans une seule chaîne d'octets (SALE_LEN, lib.rs) :
    // clé acheteur (32) || R (32, zéros avant livraison) || empreinte du chiffré (32) || statut (1).
    const ZERO = '0'.repeat(64);
    const unpack = blob => {
      const h = bytesHex(blob);
      if (h === null || h.length % 194) return null;
      return Array.from({ length: h.length / 194 }, (_, n) => {
        const r = h.slice(n * 194, n * 194 + 194), eph = r.slice(64, 128), ct = r.slice(128, 192);
        return { sale: n, buyerKey: r.slice(0, 64), ephemeral: eph === ZERO ? null : eph, ciphertextHash: ct === ZERO ? null : ct, status: SALE[parseInt(r.slice(192), 16)] || null };
      });
    };
    const desk = {
      address,
      publisher: bytesHex(publisher),
      payout: tagged(payout, 128) && 'component_' + tagged(payout, 128),
      openedAtEpoch: u64(opened),
      salesCount: u64(salesCount),
      earningsVault: tagged(earnings, 132),
      withdrawable: amount(withdrawable),
      name: typeof name === 'string' && name.length <= 96 && !modBad(name) ? name : '', bio: typeof bio === 'string' && bio.length <= 640 && !modBad(bio) ? bio : '',
      picture: picture === undefined ? '' : pictureUrl(bytesHex(picture)),
      calls: Array.isArray(calls) ? calls.map((x, seq) => {
        // `label` follows `commitment` since contract commit 4e22479 (the published templates include it).
        const [commitment, label, sealed, revealAt, price, badges, sales, refunded, frauds, settled, revealed] = Array.isArray(x) ? x : [];
        const list = unpack(sales);
        return { seq, commitment: bytesHex(commitment), label: typeof label === 'string' ? label : null, sealedAtEpoch: u64(sealed), revealAtEpoch: u64(revealAt), price: amount(price),
          badgeResource: tagged(badges, 131) && 'resource_' + tagged(badges, 131), sales: list, sold: list ? list.length : null,
          refunded: u64(refunded), frauds: u64(frauds), settled: settled === true, revealedAtEpoch: revealed === null ? null : u64(revealed), tlock: null };
      }) : null,
    };
    const bad = [desk.publisher && desk.publisher.length === 64, desk.payout, desk.openedAtEpoch !== null, desk.calls, desk.withdrawable !== null, desk.salesCount !== null]
      .some(ok => !ok) || desk.calls.some(k => !k.commitment || k.revealAtEpoch === null || k.price === null || !k.sales || k.frauds === null || k.revealedAtEpoch === undefined
        || k.sales.some(s => !s.buyerKey || !s.status || s.ephemeral === undefined || s.ciphertextHash === undefined));
    if (bad) throw new Error('unexpected desk state');
    return desk;
  }
  async function readDesk(network, address) {
    if (!COMPONENT.test(address)) throw new TypeError('not a component address');
    const s = await indexer(network, 'substates/' + encodeURIComponent(address));
    return parseDesk(address, s && s.state && s.state.up && s.state.up.substate, net(network).template);
  }
  // Modération (moderation.js, absent dans les robots) : texte interdit lu sur la chaîne = masqué.
  const modBad = x => !!(window.sdMod && window.sdMod.bad(x));
  /** Where a call stands at `epoch`, by the rules of buy / reveal / refund. */
  function phase(call, epoch) {
    if (call.revealedAtEpoch !== null) return 'revealed';
    if (epoch < call.revealAtEpoch) return 'on-sale';
    if (epoch < call.revealAtEpoch + REVEAL_WINDOW_EPOCHS) return 'revealing';
    return 'refunding';
  }
  /** (sealed, opened, never opened), the same count as `stats` on chain. */
  const stats = (desk, epoch) => [desk.calls.length, desk.calls.filter(c => c.revealedAtEpoch !== null).length, desk.calls.filter(c => phase(c, epoch) === 'refunding').length, desk.calls.filter(c => c.frauds > 0).length];
  /** Ce qu'une vente permet maintenant (règles de refund / dispute / settle du contrat). */
  function saleState(call, s, epoch) {
    const end = call.revealAtEpoch + REVEAL_WINDOW_EPOCHS, neverOpened = call.revealedAtEpoch === null && epoch >= end;
    const refundable = s.status === 'Fraud' || (s.status === 'Paid' && epoch >= call.revealAtEpoch) || ((s.status === 'Delivered' || s.status === 'Upheld') && neverOpened);
    return { refundable, disputable: s.status === 'Delivered' && epoch < end, deliverable: s.status === 'Paid' && call.revealedAtEpoch === null && epoch < call.revealAtEpoch };
  }
  const settleable = (call, epoch) => call.revealedAtEpoch !== null && !call.settled && epoch >= call.revealAtEpoch + REVEAL_WINDOW_EPOCHS;
  /**
   * Livraisons publiées pour ce desk (événements `call_delivered`, que l'indexeur range sous le desk).
   * Le chiffré n'est pas dans l'état : seul son Blake2b-256 y est, et il est vérifié ici.
   */
  async function deliveries(network, deskAddr) {
    // Sujet exact, émis par le template des desks, paginé (audit S2/S4).
    const tpl = template(network).replace(/^template_/, '');
    const out = new Map();
    for (const e of ownEvents(await eventsOf(network, deskAddr, 'SignalDesk.call_delivered'), tpl, 'SignalDesk.call_delivered')) {
      const p = e.payload || {};
      const get = k => (p instanceof Map ? p.get(k) : Array.isArray(p) ? (p.find(x => x[0] === k) || [])[1] : p[k]);
      const seq = +get('seq'), sale = +get('sale'), eph = String(get('ephemeral') || ''), ct = String(get('ciphertext') || '');
      if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(sale) || !/^[0-9a-f]{64}$/.test(eph) || !/^[0-9a-f]{1280}$/.test(ct)) continue;
      out.set(seq + ':' + sale, { ephemeral: eph, ciphertext: ct, hash: hexOf(blake2b256(fromHex(ct))) });
    }
    return out;
  }

  // ---- Wallet writes -------------------------------------------------------------------------
  const wallet = () => { const w = window.sdWallet; if (!w || !w.account()) throw Object.assign(new Error('not connected'), { code: 4100 }); return w; };
  function template(network) { const t = net(network) && net(network).template; if (!t) throw Object.assign(new Error('Signal Desk is not published on ' + network), { code: -10 }); return t; }
  // XTM withdrawals need the account's vaults declared as inputs (Crypt, checked on esmeralda).
  async function accountVaults(w) {
    const sub = await w.req('tari_getSubstate', { substateId: w.account() });
    return [...new Set([...JSON.stringify(sub).matchAll(/"tag":132,"value":\{"@cbor":"bytes","hex":"([0-9a-f]{64})"/g)].map(m => 'vault_' + m[1]))];
  }
  /** Opens the wallet's approval window, waits for the answer, submits. Returns {id, result}. */
  async function transact(operation, onWaiting) {
    const w = wallet();
    const { requestId } = await w.req('tari_createTransactionRequest', operation, 120000);
    const deadline = Date.now() + 600000;
    for (;;) {
      if (Date.now() > deadline) throw Object.assign(new Error('wallet did not answer in time'), { code: -3 });
      const r = await w.req('tari_getTransactionRequest', { requestId });
      if (r.status === 'pending') { if (onWaiting) onWaiting(r.note || ''); await new Promise(ok => setTimeout(ok, 1500)); continue; }
      if (r.status === 'rejected') throw Object.assign(new Error(r.error || 'rejected'), { code: 4001 });
      if (r.status === 'failed') throw Object.assign(new Error(r.error || 'failed'), { code: -32603 });
      const result = r.status === 'submitted' ? r.result : await w.req('tari_submitTransactionRequest', { requestId }, 120000);
      const id = result && result.transactionId;
      if (!id) throw new Error('no transaction id');
      if (/"Reject"\s*:/.test(JSON.stringify(result))) {
        // The network's own reason (e.g. SubstateNotFound …), kept for the console and the toast.
        const m = JSON.stringify(result).match(/"Reject"\s*:\s*\{"([A-Za-z]+)":"((?:[^"\\]|\\.){0,200})/);
        throw Object.assign(new Error('rejected by the network (tx ' + id + ')' + (m ? ': ' + m[1] + ' ' + m[2] : '')), { code: -32603, tx: id, reason: m ? m[1] : '' });
      }
      clearReads();
      return { id, result };
    }
  }
  // From Ootle 0.49 the network only finds a component the transaction declares, even one that is only
  // an argument: on esmeralda (3 Nov 2026) open_desk(payout) was rejected with SubstateNotFound for the
  // payout account. Every called component and every component argument is declared.
  const COMP_ARG = /^d8805820([0-9a-f]{64})$/;
  const referenced = instructions => [...new Set(instructions.flatMap(i => {
    const m = i.CallMethod, f = i.CallFunction, args = (m || f || {}).args || [];
    const fromArgs = args.map(a => a && typeof a.Literal === 'string' && COMP_ARG.exec(a.Literal)).filter(Boolean).map(x => 'component_' + x[1]);
    return [...(m && m.call && COMPONENT.test(m.call.Address) ? [m.call.Address] : []), ...fromArgs];
  }))];
  // `inputs` is the field Sapient documents for { kind: "instructions" } (SubstateRequirement, version
  // left to the wallet). Added after open_desk passed only with the fee paid from the public balance and
  // was refused with a private fee (3 Nov 2026); that it fixes the private-fee case is still to be confirmed.
  // A4 (08/11) : frais publics présélectionnés dans Sapient 0.8.0 (champ `feeType` de la demande), sans `enforceFeeType`,
  // pour ne pas bloquer un compte qui n'aurait qu'un solde privé.
  const plain = (instructions, onWaiting) => {
    const ids = referenced(instructions);
    return transact({ kind: 'instructions', instructions, inputs: ids.map(id => ({ substate_id: id, version: null })), relatedComponents: ids, maxFee: MAX_FEE, feeType: 'transparent' }, onWaiting);
  };

  /** open_desk, paying out into the connected account. Returns {id, desk}. */
  async function openDesk(network, onWaiting) {
    const w = wallet(), t = template(network);
    // CallFunction takes the template's bare hash (Crypt, Sapient 0.6.12).
    const { id, result } = await plain([{ CallFunction: { address: t.replace(/^template_/, ''), function: 'open_desk', args: [arg.component(w.account())] } }], onWaiting);
    return { id, desk: await findDesk(network, id, result, w.account()) };
  }
  // Every component the result names is a candidate; ours is the one of our template, paying our account.
  async function findDesk(network, id, result, account) {
    let text = JSON.stringify(result);
    if (!/component_[0-9a-f]{64}/.test(text)) text = JSON.stringify(await indexer(network, 'transactions/' + encodeURIComponent(id) + '/result').catch(() => null));
    for (const c of new Set(text.match(/component_[0-9a-f]{64}/g) || [])) {
      if (c === account) continue;
      const d = await readDesk(network, c).catch(() => null);
      if (d && d.payout === account) return d.address;
    }
    throw new Error('desk opened (transaction ' + id + ') but not found in the result');
  }
  /**
   * Desks of `account` on this template, newest first: found from their `desk_opened` events, on any device.
   * `publisher` (clé hex) : ne garder que les desks publiés avec cette clé (audit F1 : le payout se choisit librement).
   */
  async function findDesks(network, account, publisher) {
    const tpl = template(network).replace(/^template_/, ''), out = [];
    const evs = ownEvents(await eventsOf(network, '', 'SignalDesk.desk_opened'), tpl, 'SignalDesk.desk_opened').filter(e => !account || e.payload.payout === account);
    // L'événement nomme le desk (contrat A2) ; l'indexeur ne garde pas toujours la transaction d'ouverture.
    for (const e of evs) {
      const d = COMPONENT.test(e.payload.desk || '') ? e.payload.desk : await findDesk(network, e.tx, null, e.payload.payout).catch(() => null);
      if (d && !out.includes(d)) out.push(d);
    }
    // Un événement peut mentir sur son desk : seul compte un desk de ce template qui paie bien ce compte.
    // Audit F3 (09/11) : lecture 6 desks à la fois, et 200 desks au plus pour la liste publique (sans compte).
    const list = account ? out : out.slice(-200), read = [];
    for (let i = 0; i < list.length; i += 6)
      read.push(...await Promise.all(list.slice(i, i + 6).map(a => readDesk(network, a).then(d => withTlocks(network, d)).catch(() => null))));
    const desks = read.filter(d => d && (!account || d.payout === account) && (!publisher || d.publisher === publisher));
    return desks.sort((a, b) => b.openedAtEpoch - a.openedAtEpoch);
  }
  /**
   * Copies verrouillées des calls (A2) : publiées dans l'événement `call_sealed` (hex), jamais dans l'état (500 copies
   * y épuisaient la mémoire WASM du moteur). Seuls comptent les événements du template des desks pour ce desk.
   */
  async function withTlocks(network, desk) {
    const tpl = template(network).replace(/^template_/, '');
    const evs = ownEvents(await eventsOf(network, desk.address, 'SignalDesk.call_sealed'), tpl, 'SignalDesk.call_sealed');
    for (const e of evs) {
      const p = e.payload, seq = /^\d{1,6}$/.test(p.seq || '') ? +p.seq : -1, c = desk.calls[seq];
      if (c && p.desk === desk.address && p.commitment === c.commitment && /^(?:[0-9a-f]{2}){1,640}$/.test(p.tlock || '')) c.tlock = p.tlock;
    }
    return desk;
  }

  // ---- A2 : copie à ouverture programmée (drand quicknet, vendor/tlock.js) ----------------------
  // Texte verrouillé = nonce (64 hex) || payload. Stocké en binaire (fichier age sans armure) avec le call ;
  // le contrat ne peut pas le lire et le refuse au-delà de MAX_TLOCK_LEN.
  const QUICKNET = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
  // Bibliothèque chargée à la première utilisation seulement (170 Ko) ; le robot la charge avant chain.js.
  let tlLoad = null;
  const tl = () => window.sdTlock ? Promise.resolve(window.sdTlock) : tlLoad || (tlLoad = new Promise((ok, ko) => {
    const sc = document.createElement('script'); sc.src = 'vendor/tlock.js';
    sc.onload = () => (window.sdTlock ? ok(window.sdTlock) : ko(new Error('tlock library missing'))); sc.onerror = () => { tlLoad = null; ko(new Error('tlock library missing')); };
    document.head.appendChild(sc);
  }));
  // Tours quicknet : genèse 1692803367, un tour toutes les 3 s (tlock-js defaultChainInfo).
  const roundTime = r => (1692803367 + (r - 1) * 3) * 1000, roundAt = ms => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
  const unarmor = a => hexOf(Uint8Array.from(atob(a.split('\n').filter(l => l && !l.startsWith('-----')).join('')), c => c.charCodeAt(0)));
  const armor = hex => { let b = ''; for (const x of fromHex(hex)) b += String.fromCharCode(x); return ['-----BEGIN AGE ENCRYPTED FILE-----', ...btoa(b).match(/.{1,64}/g), '-----END AGE ENCRYPTED FILE-----', ''].join('\n'); };
  /** Tour drand d'une copie (en-tête age `-> tlock <tour> <chaîne>`), ou null si ce n'est pas une copie quicknet. */
  function tlockRound(hex) {
    if (!hex) return null;
    const head = new TextDecoder().decode(fromHex(hex.slice(0, Math.min(hex.length, 400))));
    const m = head.match(/^age-encryption\.org\/v1\n-> tlock (\d{1,12}) ([0-9a-f]{64})\n/);
    return m && m[2] === QUICKNET ? +m[1] : null;
  }
  /** Heure (ms) où la copie d'un call devient lisible par tous, ou null sans copie. */
  /** R2 : tour drand du milieu de la fenêtre [at, at + window[ ; refus si l'horizon dépasse ce que la dérive permet. */
  const tlockRoundFor = (network, epoch, at, window) => {
    if (!(window >= 2) || at - epoch > tlockMaxHorizon(window)) throw new RangeError('horizon too long for the time lock (max ' + tlockMaxHorizon(window) + ' epochs)');
    return roundAt(epochStart(network, at + Math.floor(window / 2), epoch) + EPOCH_MS / 2);
  };
  const tlockOpensAt = call => { const r = call && tlockRound(call.tlock); return r === null ? null : roundTime(r); };
  /**
   * Le call ouvert depuis sa copie, vérifié contre l'engagement : {payload, nonce}. null tant que le tour n'est
   * pas publié ou sans copie ; lève 'bad tlock' si la copie n'ouvre pas l'engagement (le call se remboursera).
   */
  async function openTlock(desk, call) {
    const at = tlockOpensAt(call);
    if (at === null || Date.now() < at) return null;
    const text = await (await tl()).decrypt(armor(call.tlock));
    const nonce = text.slice(0, 2 * NONCE_LEN), payload = text.slice(2 * NONCE_LEN);
    if (!/^[0-9a-f]{64}$/.test(nonce) || !payload || !isCanonical(payload) || commitmentOf(desk.address, desk.publisher, call.seq, payload, nonce) !== call.commitment) throw new Error('bad tlock');
    return { payload, nonce };
  }
  /** Ouvre le call `seq` depuis sa copie verrouillée : n'importe quel compte peut signer, le contrat vérifie. */
  async function revealFromTlock(network, deskAddr, seq, onWaiting) {
    template(network);
    const [desk, epoch] = await Promise.all([readDesk(network, deskAddr).then(d => withTlocks(network, d)), currentEpoch(network)]), call = desk.calls[seq];
    if (!call || phase(call, epoch) !== 'revealing') throw new Error('this call cannot be revealed now');
    const o = await openTlock(desk, call);
    if (!o) throw new Error('time lock not open yet');
    return (await plain([revealInstruction(deskAddr, seq, o)], onWaiting)).id;
  }
  // Aussi pour le robot d'ouverture (robot/ouvreur.cjs), qui signe avec le wallet daemon.
  const revealInstruction = (deskAddr, seq, o) => method(deskAddr, 'reveal', [arg.uint(seq), arg.text(o.payload), arg.bytes(o.nonce)]);
  /** C2 (10/11) : plusieurs calls ouverts ensemble, 5 par transaction (une signature par lot). `items` = [{desk, seq, payload, nonce}]. Renvoie les ids. */
  async function revealMany(network, items, onWaiting) {
    template(network);
    if (!items.length) throw new Error('nothing to reveal');
    const ids = [];
    for (let i = 0; i < items.length; i += DELIVER_BATCH) ids.push((await plain(items.slice(i, i + DELIVER_BATCH).map(x => revealInstruction(x.desk, x.seq, x)), onWaiting)).id);
    return ids;
  }
  /**
   * Seals `payload` as the desk's next call, with its time-locked copy (A2): the call opens without its
   * caller once the drand round is out. A3 (08/11): no private memo any more, one signature per call.
   */
  // `keep(secret)` runs BEFORE the wallet is asked to sign: if the page dies mid-transaction, the
  // secret of a call that did land is already saved (this device delivers from it). A secret whose seal never landed is harmless.
  // Ancienne sauvegarde privée (avant A3), encore lue sans demande pour les calls scellés avant le 08/11.
  // Private backup of a sealed call: a 1 µT shield to the caller's own wallet whose encrypted memo holds
  // `sd1|<desk>|<seq>|<nonce>|<payload>` (desk and nonce in base64url). Only that wallet can read it, from
  // any device (tari_getShieldedOutputs, after tari_requestViewAccess). Memo limit 255 bytes
  // (tari-ootle EncryptedData::MAX_MEMO_SIZE) : 240 kept, so the payload is capped at 144 characters.
  // Sapient spends its largest private outputs first: a 1 µT backup only goes when nearly the whole
  // private balance is spent; after the reveal it is no longer needed.
  const MAX_BACKUP_PAYLOAD = 144; // plus long call scellé (copie verrouillée : 567 octets, sous MAX_TLOCK_LEN)
  const b64u = hex => btoa(String.fromCharCode(...fromHex(hex))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => { if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null; return hexOf(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0))); };
  function parseMemo(memo) {
    const f = typeof memo === 'string' ? memo.split('|') : [];
    if (f[0] !== 'sd1' || f.length < 5 || !/^\d{1,6}$/.test(f[2])) return null;
    const desk = unb64u(f[1]), nonce = unb64u(f[3]), payload = f.slice(4).join('|');
    return desk && nonce && isCanonical(payload) && payload.length ? { desk: 'component_' + desk, seq: +f[2], nonce, payload } : null;
  }
  /** Private view access (needed to read the backups). `ask` = request it, with Sapient's approval. */
  async function viewAccess(ask) {
    const w = wallet(), g = await w.req('tari_getViewAccess').catch(() => null);
    if (g && g.granted === true) return true;
    if (!ask) return false;
    const r = await w.req('tari_requestViewAccess', undefined, 120000);
    if (!r || r.granted !== true) throw Object.assign(new Error('private view access refused'), { code: 4001 });
    return true;
  }
  /**
   * The connected wallet's call backups, each checked against its desk's on-chain commitment (a memo
   * that opens nothing is ignored). Returns null when view access is not granted and `ask` is false.
   */
  async function privateSecrets(network, ask) {
    if (!(await viewAccess(ask))) return null;
    const outs = await wallet().req('tari_getShieldedOutputs', { resourceAddress: TARI }, 30000);
    const found = (Array.isArray(outs) ? outs : []).map(o => o && parseMemo(o.memo)).filter(Boolean);
    const desks = new Map();
    for (const d of new Set(found.map(x => x.desk))) desks.set(d, await readDesk(network, d).catch(() => null));
    const secrets = [], seen = new Set();
    for (const x of found) {
      const d = desks.get(x.desk), c = d && d.calls[x.seq];
      if (!c || seen.has(x.desk + ':' + x.seq) || commitmentOf(x.desk, d.publisher, x.seq, x.payload, x.nonce) !== c.commitment) continue;
      seen.add(x.desk + ':' + x.seq);
      secrets.push({ v: 1, network, desk: x.desk, seq: x.seq, payload: x.payload, nonce: x.nonce, commitment: c.commitment, revealAtEpoch: c.revealAtEpoch, price: c.price.toString() });
    }
    return { secrets, desks: [...desks.values()].filter(Boolean) };
  }
  async function seal(network, deskAddr, payload, revealAtEpoch, priceMicro, keep, onWaiting, label = String(payload).split('|')[1]) {
    const { secret, instruction, lock } = await sealPrepare(network, deskAddr, payload, revealAtEpoch, priceMicro, label);
    await keep(secret);
    const { id } = await plain([instruction], onWaiting);
    return { id, secret, opensAt: roundTime(tlockRound(lock)) };
  }
  /** Prépare un scellé (secret + instruction `seal`) sans signer : aussi pour le robot SignalBot (wallet daemon). */
  async function sealPrepare(network, deskAddr, payload, revealAtEpoch, priceMicro, label = String(payload).split('|')[1]) {
    template(network);
    if (!isCanonical(payload) || !payload.length || payload.length > MAX_BACKUP_PAYLOAD) throw new RangeError('payload must be 1 to ' + MAX_BACKUP_PAYLOAD + ' printable ASCII characters');
    const [desk, epoch] = await Promise.all([readDesk(network, deskAddr), currentEpoch(network)]);
    if (!(revealAtEpoch > epoch && revealAtEpoch - epoch <= MAX_REVEAL_HORIZON_EPOCHS)) throw new RangeError('reveal epoch out of range');
    if (!(BigInt(priceMicro) > 0n)) throw new RangeError('price must be positive');
    const seq = desk.calls.length, nonce = newNonce(), commitment = commitmentOf(deskAddr, desk.publisher, seq, payload, nonce);
    const secret = { v: 1, network, desk: deskAddr, seq, payload, nonce, commitment, revealAtEpoch, price: String(priceMicro) };
    // Verrou (R2) : milieu de la fenêtre d'ouverture (drand injoignable = pas de scellement).
    const lock = unarmor(await (await tl()).encrypt(tlockRoundFor(network, epoch, revealAtEpoch, REVEAL_WINDOW_EPOCHS), nonce + payload));
    if (lock.length / 2 > MAX_TLOCK_LEN || tlockRound(lock) === null) throw new RangeError('call too long for its time lock');
    return { secret, lock, instruction: method(deskAddr, 'seal', [arg.uint(seq), arg.bytes(commitment), arg.uint(revealAtEpoch), arg.uint(priceMicro), arg.text(label), arg.bytes(lock)]) };
  }
  /** buy, paid from the wallet's balance; the badge is deposited in the connected account. */
  // `keep(purchase)` runs BEFORE signing: the sale key is the only way to read the delivery or dispute it.
  async function buy(network, deskAddr, seq, keep, onWaiting, expectedMicro) {
    const w = wallet(); template(network);
    if (!window.sdCrypto) throw new Error('crypto client missing');
    const desk = await readDesk(network, deskAddr).then(d => withTlocks(network, d)), call = desk.calls[seq];
    if (!call || phase(call, await currentEpoch(network)) !== 'on-sale') throw new Error('this call is not on sale');
    // Copie déjà lisible par tous (époques plus lentes que prévu) : plus rien à vendre.
    const opens = tlockOpensAt(call);
    if (opens !== null && Date.now() >= opens) throw new Error('this call is already public');
    // Jamais un autre montant que celui que l'acheteur a vu et validé.
    if (expectedMicro === undefined || call.price !== BigInt(expectedMicro)) throw new Error('price changed');
    const k = window.sdCrypto.newSaleKey(deskAddr, seq);
    await keep({ v: 1, kind: 'purchase', network, desk: deskAddr, seq, key: k.key, secret: k.secret, commitment: call.commitment, price: call.price.toString() });
    // 09/11 : paiement et frais pris sur le solde PUBLIC. L'ancien withdrawStealthAndExecute payait des frais privés et
    // échouait sans grosse pièce privée (« No single shielded … UTXO is large enough to cover a private fee »).
    // Le contrat exige de toute façon un montant révélé : le solde privé n'apportait aucune confidentialité ici.
    const ins = buyInstructions(deskAddr, seq, k, w.account(), call.price), ids = [...new Set([...referenced(ins), ...(await accountVaults(w))])];
    const op = { kind: 'instructions', instructions: ins, inputs: ids.map(id => ({ substate_id: id, version: null })), relatedComponents: ids, maxFee: MAX_FEE, feeType: 'transparent' };
    return { id: (await transact(op, onWaiting)).id, price: call.price };
  }
  /** Livre le call (secret du caller) à l'acheteur de `sale`. Publisher seulement, avant le reveal. */
  async function deliver(network, secret, sale, onWaiting) {
    template(network);
    const desk = await readDesk(network, secret.desk), call = desk.calls[secret.seq], s = call && call.sales[sale];
    if (!s || !saleState(call, s, await currentEpoch(network)).deliverable) throw new Error('this sale cannot be delivered now');
    const d = window.sdCrypto.deliver(secret.desk, secret.seq, sale, s.buyerKey, secret.payload, secret.nonce);
    if (!d) throw new RangeError('call too long to deliver');
    return (await plain([method(secret.desk, 'deliver', [arg.uint(secret.seq), arg.uint(sale), arg.bytes(d.ephemeral), arg.bytes(d.rc), arg.bytes(d.rz), arg.bytes(d.ciphertext)])], onWaiting)).id;
  }
  /** A5 (08/11) : toutes les ventes livrables d'un call, par lots de DELIVER_BATCH livraisons par transaction (1 signature par lot). */
  const DELIVER_BATCH = 5;
  async function deliverAll(network, secret, sales, onWaiting) {
    const ins = await deliverInstructions(network, secret, sales);
    if (!ins.length) throw new Error('nothing to deliver');
    const ids = [];
    for (let i = 0; i < ins.length; i += DELIVER_BATCH) ids.push((await plain(ins.slice(i, i + DELIVER_BATCH), onWaiting)).id);
    return ids;
  }
  /** P5 (09/11) : toutes les ventes en attente de plusieurs calls, par lots de DELIVER_BATCH (une signature par lot). */
  async function deliverMany(network, secrets, onWaiting) {
    const ins = [];
    for (const s of secrets) ins.push(...await deliverInstructions(network, s).catch(() => []));
    if (!ins.length) throw new Error('nothing to deliver');
    const ids = [];
    for (let i = 0; i < ins.length; i += DELIVER_BATCH) ids.push((await plain(ins.slice(i, i + DELIVER_BATCH), onWaiting)).id);
    return ids;
  }
  /** P7 (09/11) : tous les remboursements dus, 4 achats par transaction (une signature par lot). Renvoie les ids. */
  async function refundAll(network, purchases, onWaiting) {
    const w = wallet(); template(network);
    const epoch = await currentEpoch(network), due = [];
    for (const p of purchases) {
      const r = await readPurchase(network, p).catch(() => null);
      if (r && r.call && saleState(r.call, r.call.sales[r.sale], epoch).refundable) due.push({ p, call: r.call });
    }
    if (!due.length) throw new Error('nothing to refund now');
    const ids = [];
    for (let i = 0; i < due.length; i += 4) {
      const ins = [];
      due.slice(i, i + 4).forEach(({ p, call }, j) => ins.push(
        method(w.account(), 'withdraw', [arg.resource(call.badgeResource), arg.uint(1)]), { PutLastInstructionOutputOnWorkspace: { key: 2 * j } },
        method(p.desk, 'refund', [arg.uint(p.seq), arg.ws(2 * j)]), { PutLastInstructionOutputOnWorkspace: { key: 2 * j + 1 } },
        method(w.account(), 'deposit', [arg.ws(2 * j + 1)])));
      ids.push((await plain(ins, onWaiting)).id);
    }
    return ids;
  }
  /** Instructions `deliver` des ventes encore livrables (`sales` absent = toutes) : aussi pour la livraison automatique du robot. */
  async function deliverInstructions(network, secret, sales) {
    template(network);
    const desk = await readDesk(network, secret.desk), call = desk.calls[secret.seq], epoch = await currentEpoch(network);
    const ins = [];
    for (const sale of sales || (call ? call.sales.map((_, i) => i) : [])) {
      const s = call && call.sales[sale];
      if (!s || !saleState(call, s, epoch).deliverable) continue;
      const d = window.sdCrypto.deliver(secret.desk, secret.seq, sale, s.buyerKey, secret.payload, secret.nonce);
      if (!d) throw new RangeError('call too long to deliver');
      ins.push(method(secret.desk, 'deliver', [arg.uint(secret.seq), arg.uint(sale), arg.bytes(d.ephemeral), arg.bytes(d.rc), arg.bytes(d.rz), arg.bytes(d.ciphertext)]));
    }
    return ins;
  }
  // Pour le robot : ouverture d'un desk et carte publique, signées par le wallet daemon.
  const openDeskInstruction = (network, payout) => ({ CallFunction: { address: template(network).replace(/^template_/, ''), function: 'open_desk', args: [arg.component(payout)] } });
  const deskProfileInstruction = (deskAddr, name, bio) => method(deskAddr, 'set_profile', [arg.text(name), arg.text(bio)]);
  // Pour le robot de ligue : mêmes appels que openBoard / askQuestion / resolveQuestion, signés par le wallet daemon.
  const boardOpenInstruction = (network, name, image, open) => ({ CallFunction: { address: ftemplate(network).replace(/^template_/, ''), function: 'open_board',
    args: [arg.text(name), arg.text(image), arg.bool(open)] } });
  const askInstruction = (at, count, meta, close, until) => method(at, 'ask', [arg.uint(count), arg.text(JSON.stringify(meta)), arg.uint(close), arg.uint(until)]);
  const resolveInstruction = (at, question, outcome) => {
    if (!ANSWER.test(outcome)) throw new RangeError('outcome must be 1 to 64 printable ASCII characters');
    return method(at, 'resolve', [arg.uint(question), arg.text(outcome)]);
  };
  // Achat : retrait public du prix exact, buy, badge déposé (site via Sapient, et tests via le wallet daemon).
  const buyInstructions = (deskAddr, seq, k, account, priceMicro) => [method(account, 'withdraw', [arg.resource(TARI), arg.uint(priceMicro)]),
    { PutLastInstructionOutputOnWorkspace: { key: 1 } }, method(deskAddr, 'buy', [arg.uint(seq), arg.bytes(k.key), arg.bytes(k.c), arg.bytes(k.z), arg.ws(1)]),
    { PutLastInstructionOutputOnWorkspace: { key: 2 } }, method(account, 'deposit', [arg.ws(2, 0)])];
  /**
   * Ce que l'acheteur a reçu : {state: 'waiting'|'ok'|'bad'|'missing', call?}. 'bad' = illisible ou différent
   * du commitment scellé : à contester.
   */
  async function readPurchase(network, purchase) {
    const desk = await readDesk(network, purchase.desk), call = desk.calls[purchase.seq];
    const s = call && call.sales.find(x => x.buyerKey === purchase.key);
    if (!s) return { state: 'missing' };
    const base = { sale: s.sale, status: s.status, call, desk };
    if (!s.ephemeral) return { ...base, state: 'waiting' };
    const d = (await deliveries(network, purchase.desk)).get(purchase.seq + ':' + s.sale);
    if (!d || d.hash !== s.ciphertextHash) return { ...base, state: 'unfetched' };
    const o = window.sdCrypto.open(purchase.desk, purchase.seq, s.sale, purchase.secret, d.ephemeral, d.ciphertext);
    const ok = o && commitmentOf(purchase.desk, desk.publisher, purchase.seq, o.payload, o.nonce) === call.commitment;
    return { ...base, state: ok ? 'ok' : 'bad', opened: o, delivery: d };
  }
  /** Litige : le contrat déchiffre et juge. */
  async function dispute(network, purchase, onWaiting) {
    template(network);
    const r = await readPurchase(network, purchase);
    if (!r.delivery || !saleState(r.call, r.call.sales[r.sale], await currentEpoch(network)).disputable) throw new Error('nothing to dispute now');
    const p = window.sdCrypto.dispute(purchase.desk, purchase.seq, r.sale, purchase.secret, r.delivery.ephemeral);
    return (await plain([method(purchase.desk, 'dispute', [arg.uint(purchase.seq), arg.uint(r.sale), arg.bytes(p.shared), arg.bytes(p.c), arg.bytes(p.z), arg.bytes(r.delivery.ciphertext)])], onWaiting)).id;
  }
  /** settle : rend payables les ventes livrées d'un call ouvert, après la fenêtre. Ouvert à tous. */
  async function settle(network, deskAddr, seq, onWaiting) {
    template(network);
    return (await plain([method(deskAddr, 'settle', [arg.uint(seq)])], onWaiting)).id;
  }
  // ---- Pronostics (template SignalForecasts, repo/forecasts) ----------------------------------
  const FDOMAIN = new TextEncoder().encode('tari.ootle.signal_desk.forecast.v1');
  const FLEN = 65; // forecaster key (32) || commitment (32) || revealed (1)
  const board = network => { const n = net(network); return n && n.forecasts && n.forecasts.board ? n.forecasts.board : ''; };
  /** commitment_of du template de pronostics (même schéma à préfixes de longueur que les calls). */
  function forecastCommitment(boardAddr, question, keyHex, answer, nonceHex) {
    const enc = new TextEncoder();
    const parts = [FDOMAIN, enc.encode(boardAddr), le64(question), fromHex(keyHex), enc.encode(answer), fromHex(nonceHex)];
    return hexOf(blake2b256(concat(parts.flatMap(p => [le64(p.length), p]))));
  }
  const ANSWER = /^[\x20-\x7e]{1,64}$/;
  /**
   * Questions du tableau : texte (JSON {type, q, opts?, unit?, max?, close_utc?}) lu dans les événements
   * `question_asked`, époques et réponses lues dans l'état. Un texte illisible est ignoré.
   */
  // Événements d'un composant pour un sujet exact, filtrés par l'indexeur et paginés (audit S4 : au-delà de
  // 1 000 événements, les textes des questions disparaissaient). Plafond 5 000 par sujet.
  async function eventsOf(network, addr, topic, max = 5000) {
    const out = [];
    for (let off = 0; off < max; off += 1000) {
      // `addr` vide : événements du sujet sur tout le réseau (desk_opened, émis avant que le desk n'existe).
      const r = await indexer(network, 'transactions/events?' + (addr ? 'substate_id=' + encodeURIComponent(addr) + '&' : '') + 'topic=' + encodeURIComponent(topic) + '&limit=1000&offset=' + off);
      const ev = r && Array.isArray(r.events) ? r.events : [];
      out.push(...ev); if (ev.length < 1000) break;
    }
    return out;
  }
  // Ne garde que les événements de `topic` émis par le template `tpl` (audit S2 : un autre template forgeait textes et résultats).
  const ownEvents = (list, tpl, topic) => list.map(eventOf).filter(e => e && e.template === tpl && e.topic === topic);
  const hashHex = s => hexOf(blake2b256(new TextEncoder().encode(s)));
  // R1 (09/11) : une ligue contient 200 questions au plus (contrat). Le robot ouvre alors « <nom> 2 », « 3 »… Le site
  // suit sans redéploiement : au-delà de 180 questions, la ligue officielle devient la plus récente ligue du MÊME
  // organisateur portant le même nom suivi d'un numéro (un tiers ne peut pas s'y substituer).
  const successor = new Map();
  function officialBoard(network) {
    const base = board(network); if (!base) return Promise.resolve('');
    if (!successor.has(network)) successor.set(network, (async () => {
      try {
        if ((await readBoardRaw(network, base)).count < 180) return base;
        const b0 = await readBoard(network, base), stem = b0.name.replace(/ \d+$/, '');
        let best = base, bestN = 1;
        for (const a of await findBoards(network)) {
          if (a === base) continue;
          const b = await readBoard(network, a).catch(() => null), m = b && b.organizer === b0.organizer && stem && /^ (\d+)$/.exec(b.name.slice(stem.length));
          if (m && b.name.startsWith(stem) && +m[1] > bestN) { best = a; bestN = +m[1]; }
        }
        return best;
      } catch (e) { return base; }
    })());
    return successor.get(network);
  }
  async function readBoard(network, at) {
    const addr = at || await officialBoard(network); if (!addr) return null;
    if (!COMPONENT.test(addr)) throw new TypeError('not a component address');
    const [s, asked, opened, sealed] = await Promise.all([indexer(network, 'substates/' + encodeURIComponent(addr)),
      eventsOf(network, addr, 'SignalForecasts.question_asked', 1000), eventsOf(network, addr, 'SignalForecasts.forecast_revealed'),
      eventsOf(network, addr, 'SignalForecasts.forecast_sealed')]);
    const c = s && s.state && s.state.up && s.state.up.substate && s.state.up.substate.Component;
    // Ligues v1 (sans profil ni membres) et v2 : le template courant et les anciens (`legacy`) sont acceptés.
    if (!c || !c.header || !ftemplates(network).includes('template_' + c.header.template_address)) throw new Error('not a SignalForecasts board');
    if (!Array.isArray(c.body && c.body.state)) throw new Error('not a forecast board');
    const [organizer, , questions, , name, image, open, members, blocked, picture] = c.body.state;
    const v2 = c.body.state.length >= 10, tpl = c.header.template_address;
    const texts = new Map(), revealed = new Map();
    for (const e of ownEvents(asked, tpl, 'SignalForecasts.question_asked')) texts.set(+e.payload.question, String(e.payload.text || ''));
    for (const e of ownEvents(opened, tpl, 'SignalForecasts.forecast_revealed')) revealed.set(e.payload.question + ':' + e.payload.index, String(e.payload.answer || ''));
    // A4 : copie verrouillée de chaque pronostic (événement `forecast_sealed`), retenue si elle vise bien ce pronostic.
    const locks = new Map();
    for (const e of ownEvents(sealed, tpl, 'SignalForecasts.forecast_sealed')) if (e.payload.board === addr && /^(?:[0-9a-f]{2}){1,640}$/.test(e.payload.tlock || '')) locks.set(e.payload.question + ':' + e.payload.index, e.payload);
    const list = (Array.isArray(questions) ? questions : []).map((q, id) => {
      const [textHash, asked, close, until, blob, outcome] = Array.isArray(q) ? q : [];
      // Le texte n'est retenu que si son Blake2b-256 est celui que l'état garde ; le résultat vient de l'état.
      const txt = texts.get(id), okText = typeof txt === 'string' && bytesHex(textHash) === hashHex(txt);
      let meta = null; if (okText) try { meta = JSON.parse(txt); } catch (e) {}
      if (meta && (modBad(meta.q) || (Array.isArray(meta.opts) && meta.opts.some(modBad)))) meta = { ...meta, q: window.sdMod.MASKED, opts: Array.isArray(meta.opts) ? meta.opts.map(o => (modBad(o) ? '—' : o)) : meta.opts };
      const h = bytesHex(blob) || '', forecasts = [];
      for (let i = 0; i + FLEN * 2 <= h.length; i += FLEN * 2) {
        const isOpen = h.slice(i + 128, i + 130) === '01', index = i / (FLEN * 2), key = h.slice(i, i + 64), commitment = h.slice(i + 64, i + 128);
        const lk = locks.get(id + ':' + index), tlock = lk && lk.forecaster === key && lk.commitment === commitment ? lk.tlock : null;
        forecasts.push({ index, key, commitment, revealed: isOpen, answer: isOpen ? revealed.get(id + ':' + index) || null : null, tlock });
      }
      // Option<String> : selon le décodeur, la chaîne nue ou { Some: chaîne } (aucune question encore tranchée au 04/11 pour le voir).
      const out = typeof outcome === 'string' ? outcome : outcome && typeof outcome.Some === 'string' ? outcome.Some : null;
      return { id, askedAt: u64(asked), close: u64(close), until: u64(until), meta, forecasts, outcome: out !== null && ANSWER.test(out) ? out : null };
    }).filter(q => q.meta && typeof q.meta.q === 'string' && typeof q.meta.type === 'string' && q.close !== null && q.until !== null);
    // Sans robot (10/11) : une réponse dont le verrou temporel est tombé se lit ici, même si personne ne l'a ouverte sur la chaîne.
    await lockAnswers(addr, list);
    const keyList = v => (Array.isArray(v) ? v.map(bytesHex).filter(k => k && k.length === 64) : []);
    return {
      address: addr, organizer: bytesHex(organizer), questions: list, v2,
      name: v2 && typeof name === 'string' && !modBad(name) ? name : '', image: v2 && typeof image === 'string' && /^[a-z]{1,16}$/.test(image) ? image : '',
      open: v2 ? open !== false : true, members: v2 ? keyList(members) : [], blocked: v2 ? keyList(blocked) : [],
      picture: v2 ? pictureUrl(bytesHex(picture)) : '',
    };
  }
  /** La clé du signataire : appel `whoami` en dry run (aucune fenêtre, rien n'est dépensé). */
  // Clé publique du signataire = 32 premiers octets de l'adresse Ootle du wallet (bech32m, 64 octets : clé du compte + clé de vue).
  // Vérifié le 04/11 sur esmeralda : identique à l'organisateur enregistré par open_board. Le dry run Sapient ne renvoie pas
  // la valeur de retour de `whoami` (pas d'execution_results), d'où l'ancienne clé 0000… et le formulaire organisateur caché.
  function walletKey(address) {
    const CH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l', s = String(address || '').toLowerCase(), sep = s.lastIndexOf('1');
    if (sep < 1 || s.length - sep < 8) return null;
    const hrp = s.slice(0, sep), data = [...s.slice(sep + 1)].map(c => CH.indexOf(c)); if (data.some(v => v < 0)) return null;
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let chk = 1;
    for (const v of [...[...hrp].map(c => c.charCodeAt(0) >> 5), 0, ...[...hrp].map(c => c.charCodeAt(0) & 31), ...data]) {
      const top = chk >>> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
    }
    if (chk !== 0x2bc830a3) return null; // somme de contrôle bech32m
    let acc = 0, bits = 0; const out = [];
    for (const v of data.slice(0, -6)) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >>> bits) & 255); } acc &= 0xff; }
    if (out.length < 32) return null;
    return out.slice(0, 32).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function whoami(network, at) {
    const w = wallet(); const addr = at || await officialBoard(network); if (!addr) throw new Error('no board');
    const key = walletKey(await w.req('tari_getWalletAddress'));
    const valid = !!key && !/^0+$/.test(key) && !!window.sdCrypto && (() => { try { window.sdCrypto._.mul(fromHex(key), 1n); return true; } catch (e) { return false; } })();
    if (!valid) throw new Error('signer key not found in the wallet address');
    return key;
  }
  /** Scelle une réponse ; `keep(secret)` passe AVANT la signature (comme pour les calls). */
  const needBoard = network => { if (!board(network)) throw Object.assign(new Error('no forecast board on ' + network), { code: -10 }); };
  const ftemplate = network => { const n = net(network); const t = n && n.forecasts && n.forecasts.template; if (!t) throw Object.assign(new Error('forecasts template not published on ' + network), { code: -10 }); return t; };
  const ftemplates = network => { const n = net(network); return [ftemplate(network), ...((n && n.forecasts && n.forecasts.legacy) || [])]; };
  const forecastsV2 = network => { const n = net(network); return !!(n && n.forecasts && n.forecasts.v2); };
  // Photo de la ligue (octets de l'état) → URL data: ; type lu sur la signature du fichier, jamais SVG.
  function pictureUrl(hex) {
    if (!hex || hex.length > 24576 * 2) return ''; // borne du contrat (audit S10)
    const b = fromHex(hex), sig = (at, s) => [...s].every((ch, k) => b[at + k] === ch.charCodeAt(0));
    const mime = b.length > 12 && sig(0, 'RIFF') && sig(8, 'WEBP') ? 'image/webp' : b[0] === 0x89 && sig(1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : '';
    if (!mime) return '';
    let s = ''; for (const x of b) s += String.fromCharCode(x);
    return 'data:' + mime + ';base64,' + btoa(s);
  }
  /** Ligue v2 : nom, image de la galerie, ouverte ou fermée. Organisateur seul. */
  async function setProfile(network, at, name, image, open, onWaiting) {
    return (await plain([method(at, 'set_profile', [arg.text(name), arg.text(image), arg.bool(!!open)])], onWaiting)).id;
  }
  /** Ligue v2 : photo envoyée depuis l'appareil (hex d'un WebP/PNG/JPEG ≤ 24 Kio, vide = retirer). */
  async function setPicture(network, at, hex, onWaiting) {
    if (hex.length > 24576 * 2) throw new RangeError('picture too large');
    return (await plain([method(at, 'set_picture', [arg.bytes(hex)])], onWaiting)).id;
  }
  /** Ligue v2 : ajouter, retirer, bloquer, débloquer des clés en une signature (50 changements max). */
  async function updateMembers(network, at, add, remove, block, unblock, onWaiting) {
    return (await plain([method(at, 'update_members', [arg.keys(add), arg.keys(remove), arg.keys(block), arg.keys(unblock)])], onWaiting)).id;
  }
  async function sealForecast(network, question, answer, keep, onWaiting, at) {
    if (!at) needBoard(network);
    if (!ANSWER.test(answer)) throw new RangeError('answer must be 1 to 64 printable ASCII characters');
    const addr = at || await officialBoard(network), key = await whoami(network, addr), nonce = newNonce();
    const commitment = forecastCommitment(addr, question, key, answer, nonce);
    const secret = { v: 1, kind: 'forecast', network, board: addr, question, key, answer, nonce, commitment };
    // A4 : copie verrouillée (nonce || réponse) lisible au milieu de la fenêtre d'ouverture (R2), publiée
    // avec le scellement : le robot ou n'importe qui ouvre le pronostic ensuite. Une seule signature, plus de mémo.
    const [b, epoch] = await Promise.all([readBoard(network, addr), currentEpoch(network)]), q = b && b.questions.find(x => x.id === question);
    if (!q) throw new Error('no such question');
    const lock = unarmor(await (await tl()).encrypt(tlockRoundFor(network, epoch, q.close, q.until - q.close), nonce + answer));
    if (lock.length / 2 > MAX_TLOCK_LEN || tlockRound(lock) === null) throw new RangeError('answer too long for its time lock');
    await keep(secret);
    return (await plain([method(addr, 'seal', [arg.uint(question), arg.bytes(commitment), arg.bytes(lock)])], onWaiting)).id;
  }
  /** Le pronostic ouvert depuis sa copie, vérifié contre l'engagement : {answer, nonce}. null avant le tour drand ou sans copie. */
  async function openForecastTlock(boardAddr, question, f) {
    const r = f && tlockRound(f.tlock);
    if (r === null || r === undefined || Date.now() < roundTime(r)) return null;
    const text = await (await tl()).decrypt(armor(f.tlock));
    const nonce = text.slice(0, 2 * NONCE_LEN), answer = text.slice(2 * NONCE_LEN);
    if (!/^[0-9a-f]{64}$/.test(nonce) || !ANSWER.test(answer) || forecastCommitment(boardAddr, question, f.key, answer, nonce) !== f.commitment) throw new Error('bad tlock');
    return { answer, nonce };
  }
  // ---- Sans robot (10/11, Soufian) : la chaîne et l'horloge drand suffisent -------------------------------------
  // Un call ou un pronostic scellé porte sa copie verrouillée dans le temps. Dès que le tour drand est publié, tout
  // navigateur peut la lire et la vérifier contre l'engagement : le contenu est « ouvert » sans qu'aucune transaction
  // ne soit nécessaire. L'ouverture inscrite sur la chaîne ne sert plus qu'à régler les ventes (paiement du vendeur).
  // Le contenu lu est gardé dans le navigateur (il est public) et revérifié à chaque relecture.
  const lockMem = new Map(), lockBad = new Set(), inBrowser = typeof document !== 'undefined';
  const lockGet = (k, check) => { if (lockMem.has(k)) return lockMem.get(k); try { const o = JSON.parse(localStorage.getItem(k) || 'null'); if (o && check(o)) { lockMem.set(k, o); return o; } } catch (e) {} return null; };
  const lockPut = (k, o) => { lockMem.set(k, o); try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) {} return o; };
  /** Contenu d'un call lu depuis sa copie verrouillée (tour drand publié, engagement vérifié) : {payload, nonce}, sinon null. */
  async function lockedCall(desk, call) {
    const at = tlockOpensAt(call); if (at === null || Date.now() < at) return null;
    const k = 'sd-lock-' + desk.address.slice(10, 26) + ':' + call.seq; if (lockBad.has(k)) return null;
    const known = lockGet(k, o => typeof o.payload === 'string' && commitmentOf(desk.address, desk.publisher, call.seq, o.payload, o.nonce) === call.commitment);
    if (known) return known;
    try { const o = await openTlock(desk, call); return o ? lockPut(k, o) : null; }
    catch (e) { if (e && e.message === 'bad tlock') lockBad.add(k); return null; } // copie fausse : jamais ouverte ; drand injoignable : on réessaiera
  }
  /** Réponse d'un pronostic lue depuis sa copie verrouillée : {answer, nonce}, sinon null. */
  async function lockedForecast(boardAddr, question, f) {
    const r = f && tlockRound(f.tlock); if (r === null || r === undefined || Date.now() < roundTime(r)) return null;
    const k = 'sd-lockf-' + boardAddr.slice(10, 26) + ':' + question + ':' + f.index; if (lockBad.has(k)) return null;
    const known = lockGet(k, o => typeof o.answer === 'string' && forecastCommitment(boardAddr, question, f.key, o.answer, o.nonce) === f.commitment);
    if (known) return known;
    try { const o = await openForecastTlock(boardAddr, question, f); return o ? lockPut(k, o) : null; }
    catch (e) { if (e && e.message === 'bad tlock') lockBad.add(k); return null; }
  }
  // Dans le navigateur seulement : un robot qui relit la ligue doit continuer à voir ce qui n'est pas ouvert sur la chaîne.
  async function lockAnswers(boardAddr, questions) {
    if (!inBrowser) return;
    const todo = []; for (const q of questions) for (const f of q.forecasts) if (f.answer === null && f.tlock) todo.push([q, f]);
    await Promise.all(todo.map(async ([q, f]) => { const o = await lockedForecast(boardAddr, q.id, f); if (o) { f.answer = o.answer; f.viaLock = true; } }));
  }
  // Pour le robot d'ouverture : `reveal` est ouvert à tous, le contrat vérifie l'engagement.
  const forecastRevealInstruction = (boardAddr, question, index, o) => method(boardAddr, 'reveal', [arg.uint(question), arg.uint(index), arg.text(o.answer), arg.bytes(o.nonce)]);
  /** Ligues du template courant, trouvées par leurs événements `board_opened` (le contrat y nomme la ligue). */
  async function findBoards(network) {
    const tpl = ftemplate(network).replace(/^template_/, '');
    return [...new Set(ownEvents(await eventsOf(network, '', 'SignalForecasts.board_opened'), tpl, 'SignalForecasts.board_opened').map(e => e.payload.board).filter(a => COMPONENT.test(a || '')))];
  }
  // Mémo d'un pronostic : `sf1|<tableau>|<question>|<nonce>|<clé>|<réponse>` (tableau, nonce et clé en base64url),
  // 205 caractères au plus (réponse ≤ 64) : tient dans la limite de 240.
  function parseForecastMemo(memo, network) {
    const f = typeof memo === 'string' ? memo.split('|') : [];
    if (f[0] !== 'sf1' || f.length < 6 || !/^\d{1,9}$/.test(f[2])) return null;
    const board = unb64u(f[1]), nonce = unb64u(f[3]), key = unb64u(f[4]), answer = f.slice(5).join('|');
    if (!board || !nonce || !key || !ANSWER.test(answer)) return null;
    const s = { v: 1, kind: 'forecast', network, board: 'component_' + board, question: +f[2], key, answer, nonce };
    return { ...s, commitment: forecastCommitment(s.board, s.question, s.key, s.answer, s.nonce) };
  }
  /** Mes pronostics sauvegardés dans le wallet (null si la lecture privée n'est pas accordée et `ask` faux). */
  async function privateForecasts(network, ask) {
    if (!(await viewAccess(ask))) return null;
    const outs = await wallet().req('tari_getShieldedOutputs', { resourceAddress: TARI }, 30000);
    return (Array.isArray(outs) ? outs : []).map(o => o && parseForecastMemo(o.memo, network)).filter(Boolean);
  }
  async function revealForecast(network, secret, index, onWaiting) {
    return (await plain([method(secret.board, 'reveal', [arg.uint(secret.question), arg.uint(index), arg.text(secret.answer), arg.bytes(secret.nonce)])], onWaiting)).id;
  }
  /** Ligue = un tableau SignalForecasts ouvert par son créateur (organisateur). Renvoie son adresse. */
  async function openBoard(network, onWaiting, profile) {
    const t = ftemplate(network), w = wallet(), p = profile || {};
    // v2 : la ligue naît avec son nom, son image et son mode ; v1 : sans argument.
    const args = forecastsV2(network) ? [arg.text(p.name || ''), arg.text(p.image || 'league'), arg.bool(p.open !== false)] : [];
    const { id, result } = await plain([{ CallFunction: { address: t.replace(/^template_/, ''), function: 'open_board', args } }], onWaiting);
    let text = JSON.stringify(result);
    if (!/component_[0-9a-f]{64}/.test(text)) text = JSON.stringify(await indexer(network, 'transactions/' + encodeURIComponent(id) + '/result').catch(() => null));
    for (const c of new Set(text.match(/component_[0-9a-f]{64}/g) || [])) {
      if (c === w.account()) continue;
      const s = await indexer(network, 'substates/' + encodeURIComponent(c)).catch(() => null);
      const h = s && s.state && s.state.up && s.state.up.substate && s.state.up.substate.Component && s.state.up.substate.Component.header;
      if (h && h.template_address === t.replace(/^template_/, '')) return c;
    }
    throw new Error('board opened (transaction ' + id + ') but not found in the result');
  }
  // ---- Abonnements (SignalFollows) : une liste par personne, modifiable par sa seule clé ----
  const fltemplate = network => { const n = net(network); const t = n && n.follows && n.follows.template; if (!t) throw Object.assign(new Error('follows template not published on ' + network), { code: -10 }); return t; };
  /** Ouvre la liste d'abonnements du signataire ; renvoie son adresse. */
  async function openFollows(network, onWaiting) {
    const t = fltemplate(network), w = wallet();
    const { id, result } = await plain([{ CallFunction: { address: t.replace(/^template_/, ''), function: 'open', args: [] } }], onWaiting);
    let text = JSON.stringify(result);
    if (!/component_[0-9a-f]{64}/.test(text)) text = JSON.stringify(await indexer(network, 'transactions/' + encodeURIComponent(id) + '/result').catch(() => null));
    for (const c of new Set(text.match(/component_[0-9a-f]{64}/g) || [])) {
      if (c === w.account()) continue;
      const s = await indexer(network, 'substates/' + encodeURIComponent(c)).catch(() => null);
      const h = s && s.state && s.state.up && s.state.up.substate && s.state.up.substate.Component && s.state.up.substate.Component.header;
      // Sur un autre appareil, la liste se retrouve par son événement `follows_opened` (privateFollowsList).
      if (h && h.template_address === t.replace(/^template_/, '')) return c;
    }
    throw new Error('follow list opened (transaction ' + id + ') but not found in the result');
  }
  /**
   * Ma liste d'abonnements, retrouvée par son événement `follows_opened` (le contrat y nomme la liste et sa clé),
   * puis vérifiée sur la chaîne : seule compte une liste de ce template dont la clé est celle du wallet. null si aucune.
   */
  async function privateFollowsList(network) {
    const tpl = fltemplate(network).replace(/^template_/, ''), key = walletKey(await wallet().req('tari_getWalletAddress'));
    if (!key) return null;
    for (const e of ownEvents(await eventsOf(network, '', 'SignalFollows.follows_opened'), tpl, 'SignalFollows.follows_opened')) {
      if (e.payload.owner !== key || !COMPONENT.test(e.payload.list || '')) continue;
      if (await readFollows(network, e.payload.list).then(f => f.owner === key, () => false)) return e.payload.list;
    }
    return null;
  }
  /** Inscrit un lot de changements en UNE transaction (une seule signature) : `remove` puis `add`, 50 au plus. */
  async function applyFollows(network, list, add, remove, onWaiting) {
    fltemplate(network);
    if (!COMPONENT.test(list)) throw new TypeError('not a component address');
    if (add.length + remove.length > 50) throw new RangeError('at most 50 changes per batch');
    return (await plain([method(list, 'apply', [arg.components(add), arg.components(remove)])], onWaiting)).id;
  }
  /** Les desks suivis par une liste, lus sur l'indexeur (la liste doit être du template SignalFollows). */
  async function readFollows(network, list) {
    const t = fltemplate(network);
    if (!COMPONENT.test(list)) throw new TypeError('not a component address');
    const s = await indexer(network, 'substates/' + encodeURIComponent(list));
    const c = s && s.state && s.state.up && s.state.up.substate && s.state.up.substate.Component;
    if (!c || !c.header || c.header.template_address !== t.replace(/^template_/, '') || !Array.isArray(c.body && c.body.state)) throw new Error('not a SignalFollows list');
    const desks = Array.isArray(c.body.state[1]) ? c.body.state[1] : [];
    return { owner: bytesHex(c.body.state[0]), desks: desks.map(d => tagged(d, 128)).filter(Boolean).map(h => 'component_' + h) };
  }

  /** Pose une question sur un tableau dont on est l'organisateur. `meta` = {type, q, opts?, unit?, max?, close_utc?}. */
  async function askQuestion(network, at, meta, closeInEpochs, revealWindowEpochs, onWaiting) {
    const text = JSON.stringify(meta);
    if (new TextEncoder().encode(text).length > 512) throw new RangeError('question too long');
    const [b, epoch] = await Promise.all([readBoardRaw(network, at), currentEpoch(network)]);
    const close = epoch + closeInEpochs, until = close + revealWindowEpochs;
    return (await plain([method(at, 'ask', [arg.uint(b.count), arg.text(text), arg.uint(close), arg.uint(until)])], onWaiting)).id;
  }
  /** Publie le résultat officiel d'une question (contrat : organisateur seul, une fois, après la clôture). */
  async function resolveQuestion(network, at, question, outcome, onWaiting) {
    if (!ANSWER.test(outcome)) throw new RangeError('outcome must be 1 to 64 printable ASCII characters');
    return (await plain([method(at, 'resolve', [arg.uint(question), arg.text(outcome)])], onWaiting)).id;
  }
  async function readBoardRaw(network, at) {
    const s = await indexer(network, 'substates/' + encodeURIComponent(at));
    const st = s && s.state && s.state.up && s.state.up.substate && s.state.up.substate.Component && s.state.up.substate.Component.body.state;
    return { organizer: bytesHex(st && st[0]), count: Array.isArray(st && st[2]) ? st[2].length : 0 };
  }
  /**
   * Classement d'un tableau (règles de la page Pronostics) : un point par bonne réponse aux questions à
   * choix ; pour les nombres et prix, l'écart relatif moyen au résultat. Les réponses non ouvertes ne comptent pas.
   */
  // Audit S9 : passé la date limite d'ouverture (epoch ≥ until), un pronostic resté fermé compte comme raté
  // (0 point, plus grand écart de la question, au moins 100 %) : n'ouvrir que ses bons pronostics ne paie plus.
  // Les clés bloquées par l'organisateur sortent du classement.
  function boardScores(b, epoch) {
    const by = new Map(), blocked = new Set(b.blocked || []);
    const me = k => { if (!by.has(k)) by.set(k, { key: k, points: 0, gaps: [], answered: 0, firstSeal: Infinity }); return by.get(k); };
    for (const q of b.questions) {
      if (q.outcome === null) continue;
      const numeric = q.meta.type === 'number' || q.meta.type === 'price', late = epoch !== undefined && epoch >= q.until;
      const gapOf = f => { const o = +q.outcome, a = +f.answer; return isFinite(o) && isFinite(a) && o !== 0 ? Math.abs(a - o) / Math.abs(o) : null; };
      const worst = Math.max(1, ...q.forecasts.filter(f => f.answer !== null).map(gapOf).filter(g => g !== null));
      for (const f of q.forecasts) {
        if (blocked.has(f.key) || (f.answer === null && !late)) continue;
        const p = me(f.key); p.answered++; p.firstSeal = Math.min(p.firstSeal, q.id * 1e6 + f.index);
        if (f.answer === null) { if (numeric) p.gaps.push(worst); continue; }
        if (numeric) { const g = gapOf(f); if (g !== null) p.gaps.push(g); }
        else if (f.answer === q.outcome) p.points++;
      }
    }
    return [...by.values()].map(p => ({ ...p, avgGap: p.gaps.length ? p.gaps.reduce((x, y) => x + y, 0) / p.gaps.length : null }))
      .sort((a, b) => b.points - a.points || (a.avgGap ?? Infinity) - (b.avgGap ?? Infinity) || a.firstSeal - b.firstSeal);
  }
  /**
   * Contenus des calls ouverts d'un desk (événements `call_revealed` de son template), chacun vérifié contre
   * l'engagement scellé : Map seq → payload. Un contenu qui n'ouvre pas l'engagement est ignoré.
   */
  async function revealedPayloads(network, desk) {
    const tpl = template(network).replace(/^template_/, ''), out = new Map();
    for (const e of ownEvents(await eventsOf(network, desk.address, 'SignalDesk.call_revealed'), tpl, 'SignalDesk.call_revealed')) {
      const p = e.payload, seq = /^\d{1,6}$/.test(p.seq || '') ? +p.seq : -1, c = desk.calls[seq];
      if (!c || p.desk !== desk.address || typeof p.payload !== 'string' || !/^[0-9a-f]{64}$/.test(p.nonce || '')) continue;
      if (commitmentOf(desk.address, desk.publisher, seq, p.payload, p.nonce) === c.commitment) out.set(seq, p.payload);
    }
    return out;
  }
  /** Carte publique du desk (nom, bio). Publieur seul. */
  async function setDeskProfile(network, deskAddr, name, bio, onWaiting) {
    template(network);
    return (await plain([method(deskAddr, 'set_profile', [arg.text(name), arg.text(bio)])], onWaiting)).id;
  }
  /** Photo du desk (hex d'un WebP/PNG/JPEG ≤ 24 Kio, vide = retirer). Publieur seul. */
  async function setDeskPicture(network, deskAddr, hex, onWaiting) {
    if (hex.length > 24576 * 2) throw new RangeError('picture too large');
    return (await plain([method(deskAddr, 'set_picture', [arg.bytes(hex)])], onWaiting)).id;
  }
  /**
   * Abonnements lus sur la chaîne : chaque liste du template courant (événement `follows_opened`) relue dans son état.
   * Renvoie { followers: Map desk → nombre d'abonnés, following: Map clé → nombre de desks suivis }.
   */
  async function followGraph(network) {
    const followers = new Map(), following = new Map();
    const tpl = fltemplate(network).replace(/^template_/, '');
    const lists = [...new Set(ownEvents(await eventsOf(network, '', 'SignalFollows.follows_opened'), tpl, 'SignalFollows.follows_opened').map(e => e.payload.list).filter(a => COMPONENT.test(a || '')))];
    for (const f of await Promise.all(lists.map(l => readFollows(network, l).catch(() => null)))) {
      if (!f || following.has(f.owner)) continue; // une liste par clé : la première trouvée
      following.set(f.owner, f.desks.length);
      for (const d of f.desks) followers.set(d, (followers.get(d) || 0) + 1);
    }
    return { followers, following };
  }
  /** reveal from a kept secret. Anyone holding it may do it. */
  async function reveal(network, secret, onWaiting) {
    template(network);
    const desk = await readDesk(network, secret.desk), call = desk.calls[secret.seq];
    if (!call || commitmentOf(secret.desk, desk.publisher, secret.seq, secret.payload, secret.nonce) !== call.commitment) throw new Error('this secret does not open that call');
    if (phase(call, await currentEpoch(network)) !== 'revealing') throw new Error('this call cannot be revealed now');
    return (await plain([method(secret.desk, 'reveal', [arg.uint(secret.seq), arg.text(secret.payload), arg.bytes(secret.nonce)])], onWaiting)).id;
  }
  /** refund `count` badges of a call nobody opened; the TARI go back to the connected account. */
  // One badge per transaction: the account withdraws a badge of the call and the template reads its
  // sale. The site keeps one purchase per call and account, so the badge withdrawn is the right one.
  async function refund(network, purchase, onWaiting) {
    const w = wallet(); template(network);
    const deskAddr = purchase.desk, seq = purchase.seq, count = 1;
    const r = await readPurchase(network, purchase), call = r.call;
    if (!call || !saleState(call, call.sales[r.sale], await currentEpoch(network)).refundable) throw new Error('nothing to refund now');
    return (await plain([
      method(w.account(), 'withdraw', [arg.resource(call.badgeResource), arg.uint(count)]), { PutLastInstructionOutputOnWorkspace: { key: 0 } },
      method(deskAddr, 'refund', [arg.uint(seq), arg.ws(0)]), { PutLastInstructionOutputOnWorkspace: { key: 1 } },
      method(w.account(), 'deposit', [arg.ws(1)]),
    ], onWaiting)).id;
  }
  /** withdraw: pays opened calls' proceeds into the desk's payout account. Anyone may trigger it. */
  async function withdraw(network, deskAddr, amountMicro, onWaiting) {
    template(network);
    if (!(BigInt(amountMicro) > 0n)) throw new RangeError('amount must be positive');
    return (await plain([method(deskAddr, 'withdraw', [arg.uint(amountMicro)])], onWaiting)).id;
  }

  window.sdChain = {
    MAX_REVEAL_HORIZON_EPOCHS,
    published: network => !!(net(network) && net(network).template),
    isHidden: (network, addr) => !!(net(network) && (net(network).hidden || []).includes(addr)),
    isOfficial: (network, addr) => !!(net(network) && (net(network).official || []).includes(addr)),
    isCanonical, parseCall, phase, stats, saleState, settleable,
    MAX_BACKUP_PAYLOAD, privateSecrets, findDesks, tlockOpensAt, openTlock, lockedCall, revealFromTlock, revealInstruction, revealMany,
    revealedPayloads, setDeskProfile, setDeskPicture, followGraph, EPOCH_MS, epochStart, MAX_CALL_HORIZON_EPOCHS, tlockMaxHorizon,
    clearReads, sealPrepare, deliverInstructions, buyInstructions, openDeskInstruction, deskProfileInstruction, DELIVER_BATCH, deliverMany, refundAll,
    boardOpenInstruction, askInstruction, resolveInstruction, readBoardRaw,
    // Desks du template courant avec carte publique (set_profile / set_picture).
    deskProfiles: network => !!(net(network) && net(network).profiles),
    currentEpoch, readDesk, readPurchase, openDesk, seal, buy, deliver, deliverAll, dispute, settle, reveal, refund, withdraw,
    forecastsLive: network => !!board(network), officialBoard, readBoard, whoami, sealForecast, revealForecast, privateForecasts, openForecastTlock, forecastRevealInstruction, findBoards,
    leaguesLive: network => !!(net(network) && net(network).forecasts && net(network).forecasts.template), openBoard, askQuestion, resolveQuestion, setProfile, setPicture, updateMembers, walletKey, boardScores,
    followsLive: network => !!(net(network) && net(network).follows && net(network).follows.template), openFollows, applyFollows, privateFollowsList,
  };
})();
