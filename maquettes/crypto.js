// Signal Desk, palier 2 côté navigateur : clés de vente, preuves Schnorr / DLEQ et chiffrement de la
// livraison. Doit rester identique octet pour octet à repo/src/lib.rs (contrat) et à
// repo/tests/common/mod.rs (client de test, vérifié en CI). Courbe et SHA-512 : vendor/noble.js
// (@noble/curves 1.9.7 + @noble/hashes 1.8.0, paquets npm vérifiés par leur empreinte).
(() => {
  const N = window.sdNoble;
  if (!N) return;
  const P = N.RistrettoPoint, L = N.ed25519.CURVE.n;
  const enc = new TextEncoder();
  const D = { auth: 'tari.ootle.signal_desk.auth.v1', dleq: 'tari.ootle.signal_desk.dleq.v1', key: 'tari.ootle.signal_desk.key.v1', stream: 'tari.ootle.signal_desk.stream.v1' };
  const BLOCK_LEN = 640;
  const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = h => { if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new TypeError('not hex'); return Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16)); };
  const cat = parts => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const le64 = n => { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
  const lp = b => le64(b.length);
  const sha512 = parts => N.sha512(cat(parts));
  // Scalaires : entiers modulo l, encodés en 32 octets little-endian (Scalar32Bytes).
  const fromLE = b => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; };
  const toLE32 = v => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(v & 255n); v >>= 8n; } return b; };
  const wide = b64 => fromLE(b64) % L; // = Scalar::from_bytes_mod_order_wide = scalar_from_uniform_bytes
  const mod = v => ((v % L) + L) % L;
  const random = () => { for (;;) { const s = wide(crypto.getRandomValues(new Uint8Array(64))); if (s) return s; } };
  const pub = x => P.BASE.multiply(x).toRawBytes();
  const point = b => P.fromHex(b); // refuse les encodages non canoniques
  const mul = (b, x) => point(b).multiply(x).toRawBytes();

  /** Contexte d'une preuve : 32 octets de l'adresse du desk || seq || n° de vente (absent à l'achat). */
  function context(desk, seq, sale) {
    if (!/^component_[0-9a-f]{64}$/.test(desk)) throw new TypeError('not a component address');
    return cat([unhex(desk.slice(10)), le64(seq), ...(sale === undefined || sale === null ? [] : [le64(sale)])]);
  }
  function challenge(domain, ctx, msg, points) {
    const d = enc.encode(domain);
    return wide(sha512([lp(d), d, lp(ctx), ctx, lp(msg), msg, ...points]));
  }
  /** Preuve Schnorr compacte (c, z) de la connaissance de x, sur `msg`, liée à `ctx`. */
  function proveKnows(ctx, x, msg) {
    const m = enc.encode(msg), k = random();
    const c = challenge(D.auth, ctx, m, [pub(x), pub(k)]);
    return { c: hex(toLE32(c)), z: hex(toLE32(mod(k + c * x))) };
  }
  function verifyKnows(ctx, keyHex, msg, cHex, zHex) {
    const c = fromLE(unhex(cHex)), z = fromLE(unhex(zHex)), key = point(unhex(keyHex));
    const a = P.BASE.multiply(z).subtract(key.multiply(c)).toRawBytes();
    return challenge(D.auth, ctx, enc.encode(msg), [unhex(keyHex), a]) === c;
  }
  /** S = b·R et la preuve DLEQ log_G(B) = log_R(S), pour un litige. */
  function proveShared(ctx, b, ephemeralHex) {
    const R = unhex(ephemeralHex), S = mul(R, b), k = random();
    const c = challenge(D.dleq, ctx, new Uint8Array(0), [pub(b), R, S, pub(k), mul(R, k)]);
    return { shared: hex(S), c: hex(toLE32(c)), z: hex(toLE32(mod(k + c * b))) };
  }
  function keystream(ctx, B, R, S) {
    const kd = enc.encode(D.key), sd = enc.encode(D.stream);
    const k = sha512([lp(kd), kd, lp(ctx), ctx, B, R, S]);
    return cat(Array.from({ length: BLOCK_LEN / 64 }, (_, i) => sha512([lp(sd), sd, k, Uint8Array.of(i)])));
  }
  const xor = (a, b) => a.map((x, i) => x ^ b[i]);
  /** len (u16 LE) || payload || len (u8) || nonce || zéros : 640 octets. Null si ça ne tient pas. */
  function block(payload, nonceHex) {
    const p = enc.encode(payload), n = unhex(nonceHex);
    if (3 + p.length + n.length > BLOCK_LEN) return null;
    const b = new Uint8Array(BLOCK_LEN); b[0] = p.length & 255; b[1] = p.length >> 8; b.set(p, 2); b[2 + p.length] = n.length; b.set(n, 3 + p.length);
    return b;
  }
  /** Lecture d'un bloc, avec les mêmes règles que `open_block` du contrat. */
  function openBlock(b) {
    if (b.length !== BLOCK_LEN) return null;
    const pl = b[0] | (b[1] << 8); if (3 + pl > BLOCK_LEN) return null;
    const nl = b[2 + pl]; if (nl < 16 || nl > 64 || 3 + pl + nl > BLOCK_LEN) return null;
    if (b.subarray(3 + pl + nl).some(x => x)) return null;
    const p = b.subarray(2, 2 + pl); if (p.some(x => x < 0x20 || x > 0x7e)) return null;
    return { payload: new TextDecoder().decode(p), nonce: hex(b.subarray(3 + pl, 3 + pl + nl)) };
  }

  window.sdCrypto = {
    BLOCK_LEN,
    /** Nouvelle clé de vente pour l'achat du call `seq` : à garder (sans elle, ni lecture ni litige). */
    newSaleKey(desk, seq) {
      const b = random(), key = hex(pub(b)), proof = proveKnows(context(desk, seq), b, 'buy');
      return { secret: hex(toLE32(b)), key, ...proof };
    },
    /** Livraison par le caller : R, preuve de r, chiffré. Null si le call ne tient pas dans un bloc. */
    deliver(desk, seq, sale, buyerKeyHex, payload, nonceHex) {
      const plain = block(payload, nonceHex); if (!plain) return null;
      const ctx = context(desk, seq, sale), r = random(), R = pub(r), B = unhex(buyerKeyHex), S = mul(B, r);
      const proof = proveKnows(ctx, r, 'ephemeral');
      return { ephemeral: hex(R), rc: proof.c, rz: proof.z, ciphertext: hex(xor(plain, keystream(ctx, B, R, S))) };
    },
    /** Lecture par l'acheteur : le call déchiffré, ou null si le bloc est illisible (cas de litige). */
    open(desk, seq, sale, secretHex, ephemeralHex, ciphertextHex) {
      const b = fromLE(unhex(secretHex)), ctx = context(desk, seq, sale), R = unhex(ephemeralHex);
      const ks = keystream(ctx, pub(b), R, mul(R, b));
      return openBlock(xor(unhex(ciphertextHex), ks));
    },
    /** Arguments d'un litige. */
    dispute(desk, seq, sale, secretHex, ephemeralHex) { return proveShared(context(desk, seq, sale), fromLE(unhex(secretHex)), ephemeralHex); },
    // Exposés pour les tests et la vérification locale.
    _: { context, proveKnows, verifyKnows, proveShared, keystream, block, openBlock, hex, unhex, fromLE, toLE32, pub, mul },
  };
})();
