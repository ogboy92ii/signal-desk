// SignalBot (09/11) : desk automatique, marqué comme tel, qui scelle des calls crypto selon une règle publique et
// livre chaque acheteur dans la minute. Signé par le wallet daemon local (compte SD_ACCOUNT, « signaldesk »).
//
// Règle publique (aussi dans la bio du desk) : bougies 1 h Binance. Tendance = EMA 20 contre EMA 50.
//   LONG  si EMA20 > EMA50 et clôture > EMA20 ; SHORT si EMA20 < EMA50 et clôture < EMA20 ; sinon rien.
//   Objectif = entrée ± 2 ATR(14), stop = entrée ∓ 1 ATR(14), échéance 12 h. Un seul call en cours par paire.
// Ses résultats sont vérifiés comme ceux de tout le monde : il ne peut ni cacher ni modifier un call.
//
//   node robot/signalbot.cjs           boucle (livraisons chaque minute, nouveaux calls chaque heure)
//   node robot/signalbot.cjs --dry     un passage : affiche les signaux, n'envoie rien
// Variables : SD_NETWORK (esmeralda), SD_WALLETD, SD_ACCOUNT (signaldesk), SD_ACCOUNT_ADDR, SD_WALLETD_KEY_FILE.
'use strict';
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'maquettes');
global.window = global;
const netFetch = global.fetch;
global.fetch = (url, opts) => (typeof url === 'string' && url.startsWith('vendor/')
  ? Promise.resolve(new Response(fs.readFileSync(path.join(SITE, url)), { headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }))
  : netFetch(url, opts));
require(path.join(SITE, 'vendor', 'tlock.js'));
// noble.js déclare `var sdNoble` (script de page) : exécuté comme un script, pas comme un module.
require('vm').runInThisContext(fs.readFileSync(path.join(SITE, 'vendor', 'noble.js'), 'utf8'));
if (!window.sdCrypto && (require(path.join(SITE, 'crypto.js')), !window.sdCrypto)) throw new Error('crypto.js non chargé');
require(path.join(SITE, 'chain.js'));
require(path.join(SITE, 'sports.js')); // profil sport : matchs et cotes ESPN
const C = window.sdChain;

const NET = process.env.SD_NETWORK || 'esmeralda';
const RPC = process.env.SD_WALLETD || 'http://127.0.0.1:5100/json_rpc';
const ACCOUNT = process.env.SD_ACCOUNT || 'signaldesk';
const ACCOUNT_ADDR = process.env.SD_ACCOUNT_ADDR || 'component_9fee0994d303c4cce1d72b4212eff7795164fdd4945943b28e803a0383dd9aad';
// Chemin du cookie : variable SD_WALLETD_KEY_FILE, sinon robot/local.json { "walletdKeyFile": "…" } (hors git).
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8')); } catch { return {}; } })();
const KEY_FILE = process.env.SD_WALLETD_KEY_FILE || LOCAL.walletdKeyFile || '';
const DRY = process.argv.includes('--dry');
const PRICE_MICRO = 1000000n; // 1 TARI
// Profils (SD_BOT) : chaque robot a son compte, son desk, sa règle publique (dans sa bio) et ses fichiers.
// 10/11 : bios en anglais (langue par défaut du site pour les visiteurs) ; le robot republie sa bio quand elle change.
const PROFILES = {
  // Réglages du 09/11 (règle du site : objectif >= 2 %) choisis par backtest d'un an sur Binance 1 h, validés sur les 4 derniers mois.
  // minOnly : un signal dont l'objectif naturel (tpK ATR) fait moins de 2 % est sauté ; sinon l'objectif est relevé à 2 %.
  trend: { name: 'SignalBot', interval: '1h', horizonH: 12, tpK: 4, slK: 1.5, pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    bio: 'Bot. Public rule: 1h candles, EMA20/EMA50, target 4 ATR (2% at least), stop 1.5 ATR, 12h. Delivered within a minute.' },
  range: { name: 'SignalBot-Range', interval: '1h', horizonH: 48, tpK: 2, slK: 3, minOnly: true, pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
    bio: 'Bot. Public rule: 1h candles, RSI14 < 35 = LONG, > 65 = SHORT, target 2 ATR if >= 2% (else no call), stop 3 ATR (max 2x the target), 48h.' },
  sport: { name: 'SignalBot-Sport', interval: '1h', horizonH: 0, pairs: [],
    bio: 'Bot. Public rule: NFL, NBA, Champions League, Premier League games within 36h; it seals "the favorite wins" based on ESPN odds.' },
  breakout: { name: 'SignalBot-Breakout', interval: '4h', horizonH: 48, tpK: 1, slK: 1.5, minOnly: true, pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'],
    bio: 'Bot. Public rule: 4h candles, break of the 20-candle high or low, target 1 ATR if >= 2% (else no call), stop 1.5 ATR, 48h.' },
};
const BOT = process.env.SD_BOT || 'trend', P = PROFILES[BOT];
if (!P) throw new Error('SD_BOT inconnu : ' + BOT);
if ([...P.bio].length > 160) throw new Error('bio trop longue pour le contrat (160 caractères au plus) : ' + BOT);
const MIN_TP = 0.0205; // 2 % + marge d'arrondi du prix affiché
const PAIRS = P.pairs, HORIZON_MS = P.horizonH * 3600e3, NAME = P.name, BIO = P.bio;
const SUFFIX = BOT === 'trend' ? '' : '-' + BOT; // SignalBot d'origine : fichiers inchangés
const STATE = path.join(__dirname, `signalbot${SUFFIX}.state.json`);     // adresse du desk
const SECRETS = path.join(__dirname, `signalbot${SUFFIX}.secrets.json`); // contenus des calls pas encore ouverts : ne quitte jamais le PC
const MAX_FEE = 200000;
// Refus du réseau, y compris « frais seuls acceptés » (AcceptFeeRejectRest / OnlyFeeAccepted).
const REJECTED = /"Reject"\s*:|AcceptFeeRejectRest|OnlyFeeAccepted/;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19) + 'Z', ...a);
// Audit F10 : fichier absent = valeur par défaut ; fichier présent mais illisible = arrêt (jamais d'effacement des secrets).
const read = (f, d) => {
  if (!fs.existsSync(f)) return d;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error('fichier illisible, robot arrêté pour ne rien effacer : ' + path.basename(f)); }
};
// Écriture atomique : fichier temporaire puis renommage.
const write = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
const key = () => (process.env.SD_WALLETD_KEY || fs.readFileSync(KEY_FILE, 'utf8')).trim();
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key() },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(180000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.code + ' ' + String(j.error.message).slice(0, 300));
  return j.result;
}
// Envoie des instructions signées par le compte du robot ; lève une erreur si le réseau les rejette.
async function send(what, instructions, inputs) {
  const sub = await rpc('transactions.submit_instruction', { instructions, fee_account: ACCOUNT, max_fee: MAX_FEE,
    inputs: inputs.map(s => ({ substate_id: s, version: null, is_write: true })), override_inputs: true, new_outputs: null, proof_ids: [], min_epoch: null, max_epoch: null });
  const txId = sub && (sub.transaction_id || sub.id);
  const res = await rpc('transactions.wait_result', { transaction_id: txId, timeout_secs: 120 });
  const text = JSON.stringify(res);
  if (REJECTED.test(text)) throw new Error(what + ' rejeté (tx ' + txId + ') ' + (text.match(/"Reject"\s*:\s*\{"([A-Za-z]+)":"((?:[^"\\]|\\.){0,160})/) || []).slice(1).join(' '));
  log(what, 'tx', txId);
  return { txId, text };
}

// ---- Le desk du bot -------------------------------------------------------------------------
let bioSent = false;
async function myDesk() {
  const st = read(STATE, {});
  const known = st.desk ? (await C.readDesk(NET, st.desk).catch(() => null)) || { salesCount: 0 } : null;
  if (known && known.salesCount < 950) {
    // Règle publique modifiée : la bio du desk est republiée (une fois, la relecture suivante la trouve à jour).
    if (known.bio !== undefined && known.bio !== BIO && !DRY && !bioSent) { bioSent = true; await send('profil mis à jour', [C.deskProfileInstruction(st.desk, NAME, BIO)], [st.desk]).catch(e => log('échec profil', e.message)); }
    return st.desk;
  }
  // Audit F1 : n'importe qui peut ouvrir un desk qui paie ce compte. Seul compte un desk publié avec la clé du robot.
  const me = C.walletKey((await rpc('accounts.create_or_get', { account: { Name: ACCOUNT } })).address);
  if (!me) throw new Error('clé du compte ' + ACCOUNT + ' illisible');
  // Audit F9 : un desk plein (1 000 ventes à vie) n'est plus utilisable, on en ouvre un neuf.
  const usable = async () => (await C.findDesks(NET, ACCOUNT_ADDR)).filter(d => d.publisher === me && d.salesCount < 950);
  let desks = await usable();
  if (!desks.length) {
    if (DRY) return null;
    await send('desk ouvert', [C.openDeskInstruction(NET, ACCOUNT_ADDR)], [ACCOUNT_ADDR]);
    for (let i = 0; i < 20 && !desks.length; i++) { await new Promise(r => setTimeout(r, 5000)); desks = await usable(); }
    if (!desks.length) throw new Error('desk ouvert mais pas encore visible');
  }
  const d = desks[0];
  if ((d.name !== NAME || d.bio !== BIO) && !DRY) await send('profil inscrit', [C.deskProfileInstruction(d.address, NAME, BIO)], [d.address]);
  write(STATE, { desk: d.address });
  return d.address;
}

// ---- La règle -------------------------------------------------------------------------------
async function candles(symbol) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${P.interval}&limit=120`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('binance ' + r.status);
  // Dernière bougie en cours exclue : on ne décide que sur des bougies closes.
  return (await r.json()).slice(0, -1).map(k => ({ h: +k[2], l: +k[3], c: +k[4] }));
}
const ema = (xs, n) => { const k = 2 / (n + 1); let e = xs.slice(0, n).reduce((s, x) => s + x, 0) / n; for (const x of xs.slice(n)) e = x * k + e * (1 - k); return e; };
function atr(cs, n) {
  const tr = cs.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - cs[i].c), Math.abs(c.l - cs[i].c)));
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; for (const x of tr.slice(n)) a = (a * (n - 1) + x) / n; return a;
}
// RSI de Wilder.
function rsi(xs, n) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const fmt = (x, ref) => { const d = ref >= 1000 ? 1 : ref >= 10 ? 2 : ref >= 1 ? 4 : 5; return x.toFixed(d); };
async function signal(symbol) {
  const cs = await candles(symbol), closes = cs.map(c => c.c), last = closes[closes.length - 1];
  const a = atr(cs, 14);
  let side = null;
  if (BOT === 'trend') {
    const e20 = ema(closes, 20), e50 = ema(closes, 50);
    side = e20 > e50 && last > e20 ? 'LONG' : e20 < e50 && last < e20 ? 'SHORT' : null;
  } else if (BOT === 'range') {
    const r = rsi(closes, 14); side = r < 35 ? 'LONG' : r > 65 ? 'SHORT' : null;
  } else if (BOT === 'breakout') {
    const prev = cs.slice(-21, -1), hi = Math.max(...prev.map(c => c.h)), lo = Math.min(...prev.map(c => c.l));
    side = last > hi ? 'LONG' : last < lo ? 'SHORT' : null;
  }
  if (!side) return null;
  // Règle du site (moderation.js) : objectif >= 2 %, stop entre 0,2 % et 2 fois l'objectif (et 30 % au plus).
  const natural = P.tpK * a / last;
  if (P.minOnly && natural < MIN_TP) return null;
  const up = Math.max(natural, MIN_TP), down = Math.min(Math.max(P.slK * a / last, 0.0025), 1.95 * up, 0.29);
  if (up > 0.49) return null;
  const s = side === 'LONG' ? 1 : -1, until = new Date(Date.now() + HORIZON_MS);
  until.setUTCMinutes(0, 0, 0);
  return { side, entry: fmt(last, last), tp: fmt(last * (1 + s * up), last), sl: fmt(last * (1 - s * down), last), until: until.toISOString().slice(0, 16) + 'Z' };
}

// ---- Un passage -----------------------------------------------------------------------------
let lastSeal = 0;
async function pass() {
  const desk = await myDesk();
  C.clearReads();
  const secrets = read(SECRETS, []);
  const [epoch, d] = desk ? await Promise.all([C.currentEpoch(NET), C.readDesk(NET, desk)]) : [await C.currentEpoch(NET), null];
  // 1. Livraison : chaque vente payée et pas encore livrée, tant que le call n'est pas ouvert.
  for (const s of secrets) {
    const call = d && d.calls[s.seq];
    if (!call || C.phase(call, epoch) !== 'on-sale') continue;
    const ins = await C.deliverInstructions(NET, s).catch(e => { log('livraison impossible', s.seq, e.message); return []; });
    for (let i = 0; i < ins.length && !DRY; i += C.DELIVER_BATCH) {
      try { await send(`livré (call ${s.seq}, ${Math.min(C.DELIVER_BATCH, ins.length - i)} vente(s))`, ins.slice(i, i + C.DELIVER_BATCH), [desk]); }
      catch (e) { log('échec livraison', s.seq, e.message); }
    }
    if (DRY && ins.length) log('à livrer', s.seq, ins.length);
  }
  // Audit F4 : le robot ouvre lui-même ses calls dès l'heure venue (il a le contenu) ; l'ouvreur reste le filet de sécurité.
  for (const s of secrets) {
    const call = d && d.calls[s.seq];
    if (!call || C.phase(call, epoch) !== 'revealing') continue;
    if (DRY) { log('à ouvrir', s.seq); continue; }
    try { await send(`ouvert (call ${s.seq})`, [C.revealInstruction(desk, s.seq, s)], [desk]); call.revealedAtEpoch = epoch; }
    catch (e) { log('échec ouverture', s.seq, e.message); }
  }
  // Les secrets des calls ouverts ne servent plus : retirés du fichier.
  const keep = secrets.filter(s => { const call = d && d.calls[s.seq]; return !call || call.revealedAtEpoch === null; });
  if (keep.length !== secrets.length) write(SECRETS, keep);

  // 2. Nouveaux calls, une fois par heure : une paire sans call en cours et avec un signal.
  if (Date.now() - lastSeal < 3600e3 && !DRY) return;
  lastSeal = Date.now();
  // Profil sport : un call « le favori gagne » par match à venir qui a une cote ESPN (« BUF -3 » : BUF favori).
  if (BOT === 'sport') {
    for (const lg of ['NFL', 'NBA', 'UCL', 'EPL']) {
      let evs = []; try { evs = await window.sdSports.upcoming(lg, 36); } catch (e) { log('scores indisponibles', lg, e.message); continue; }
      for (const ev of evs) {
        const fav = ev.odds && /^([A-Z0-9]{2,5})\s+-\d/.exec(ev.odds.details || '');
        if (!fav || !ev.away || !ev.home) continue;
        const when = new Date(ev.at).toISOString().slice(0, 16) + 'Z', match = ev.away + '@' + ev.home;
        if (keep.some(s => s.payload.split('|')[2] === match && s.payload.split('|')[3] === when)) continue;
        const payload = ['v1', lg, match, when, 'WIN', fav[1]].join('|');
        if (!C.parseCall(payload)) { log('call invalide', payload); continue; }
        if (DRY || !desk) { log('signal', payload); continue; }
        await sealOne(desk, payload, new Date(ev.at + 4 * 3600e3).toISOString(), `${lg} ${match} WIN ${fav[1]}`);
      }
    }
    return;
  }
  for (const pair of PAIRS) {
    const live = keep.some(s => s.payload.split('|')[1] === pair && Date.parse(s.payload.split('|')[6]) > Date.now());
    if (live) continue;
    let sg;
    try { sg = await signal(pair); } catch (e) { log('prix indisponibles', pair, e.message); continue; }
    if (!sg) { log('pas de signal', pair); continue; }
    const payload = ['v1', pair, sg.side, sg.entry, sg.tp, sg.sl, sg.until].join('|');
    if (!C.parseCall(payload)) { log('call invalide', payload); continue; }
    if (DRY || !desk) { log('signal', payload); continue; }
    await sealOne(desk, payload, sg.until, `${pair} ${sg.side}`);
  }
}

// Scelle un call (commun crypto / sport). Ouverture une époque après `untilIso` (fin du call ou fin du match).
async function sealOne(desk, payload, untilIso, what) {
  let secret = null;
  try {
    const ep = await C.currentEpoch(NET), revealAt = ep + Math.ceil((Date.parse(untilIso) - Date.now()) / C.EPOCH_MS) + 1;
    C.clearReads(); // le desk relu à neuf : sinon le numéro du call précédent est repris
    const p = await C.sealPrepare(NET, desk, payload, revealAt, PRICE_MICRO, C.parseCall(payload).label); secret = p.secret;
    write(SECRETS, [...read(SECRETS, []), secret]); // gardé AVANT l'envoi : sans lui, impossible de livrer
    await send(`scellé ${what} (call ${secret.seq})`, [p.instruction], [desk]);
    // Attendre que l'indexeur voie ce call avant d'en sceller un autre (sinon même numéro, refusé).
    for (let i = 0; i < 30; i++) { C.clearReads(); if ((await C.readDesk(NET, desk).catch(() => ({ calls: [] }))).calls.length > secret.seq) break; await new Promise(r => setTimeout(r, 3000)); }
  } catch (e) {
    log('échec scellé', what, e.message);
    // Rejeté par le réseau : ce secret ne correspond à aucun call (une transaction en attente de réponse le garde).
    if (secret && / rejeté /.test(e.message)) write(SECRETS, read(SECRETS, []).filter(s => s.commitment !== secret.commitment));
  }
}

(async () => {
  for (;;) {
    try { await pass(); } catch (e) { log('passage interrompu :', e.message); }
    if (DRY) break;
    await new Promise(r => setTimeout(r, 60e3));
  }
})();
