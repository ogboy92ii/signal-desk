// Robot d'ouverture Signal Desk (A2, 08/11). Toutes les 5 minutes : liste les desks du template (événements
// desk_opened), et pour chaque call dans sa fenêtre d'ouverture dont la copie drand est lisible, la déchiffre,
// la vérifie contre l'engagement et envoie `reveal`, signé par le wallet daemon local. Même chose pour les
// pronostics des ligues (A4, événements board_opened) : clos, pas encore ouverts, copie lisible.
//
// Le robot ne peut rien falsifier : le contrat refuse tout contenu qui n'ouvre pas l'engagement scellé, il ne
// peut pas ouvrir avant le tour drand, et `reveal` ne déplace aucun fonds. Il ne paie que les frais.
//
// Lancement (wallet daemon en marche, compte qui paie les frais = SD_ACCOUNT) :
//   node robot/ouvreur.cjs            boucle
//   node robot/ouvreur.cjs --once     un seul passage
//   node robot/ouvreur.cjs --dry      un passage, n'envoie rien
// Variables : SD_NETWORK (esmeralda), SD_WALLETD (http://127.0.0.1:5100/json_rpc), SD_ACCOUNT (signaldesk),
// SD_WALLETD_KEY ou SD_WALLETD_KEY_FILE (cookie du daemon ; jamais affiché).
'use strict';
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'maquettes');
global.window = global;
// chain.js charge son décodeur wasm par une URL relative au site : servie ici depuis les fichiers locaux.
const netFetch = global.fetch;
global.fetch = (url, opts) => (typeof url === 'string' && url.startsWith('vendor/')
  ? Promise.resolve(new Response(fs.readFileSync(path.join(SITE, url)), { headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }))
  : netFetch(url, opts));
require(path.join(SITE, 'vendor', 'tlock.js'));
require(path.join(SITE, 'chain.js'));
const C = window.sdChain;

const NET = process.env.SD_NETWORK || 'esmeralda';
const RPC = process.env.SD_WALLETD || 'http://127.0.0.1:5100/json_rpc';
const ACCOUNT = process.env.SD_ACCOUNT || 'signaldesk';
// Chemin du cookie : variable SD_WALLETD_KEY_FILE, sinon robot/local.json { "walletdKeyFile": "…" } (hors git).
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8')); } catch { return {}; } })();
const KEY_FILE = process.env.SD_WALLETD_KEY_FILE || LOCAL.walletdKeyFile || '';
const DRY = process.argv.includes('--dry'), ONCE = DRY || process.argv.includes('--once');
const EVERY_MS = 5 * 60e3, MAX_FEE = 200000;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19) + 'Z', ...a);
const key = () => (process.env.SD_WALLETD_KEY || fs.readFileSync(KEY_FILE, 'utf8')).trim();
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key() },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(180000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.code + ' ' + String(j.error.message).slice(0, 300));
  return j.result;
}

// Un call raté (copie fausse, rejet du réseau) n'est retenté qu'au passage suivant, une fois par heure au plus.
const failed = new Map();
// Envoie une instruction `reveal` sur `addr` ; renvoie true si le réseau l'accepte.
async function send(k, addr, instruction) {
  try {
    const sub = await rpc('transactions.submit_instruction', { instructions: [instruction], fee_account: ACCOUNT, max_fee: MAX_FEE,
      inputs: [{ substate_id: addr, version: null, is_write: true }], override_inputs: true, new_outputs: null, proof_ids: [], min_epoch: null, max_epoch: null });
    const txId = sub && (sub.transaction_id || sub.id);
    const res = await rpc('transactions.wait_result', { transaction_id: txId, timeout_secs: 120 });
    const rejected = /"Reject"\s*:|AcceptFeeRejectRest|OnlyFeeAccepted/.test(JSON.stringify(res)); // frais seuls acceptés = refusé
    log(rejected ? 'REJETÉ' : 'ouvert', k, 'tx', txId);
    if (rejected) failed.set(k, Date.now());
    return !rejected;
  } catch (e) { log('échec', k, e.message); failed.set(k, Date.now()); return false; }
}
const skip = k => failed.has(k) && Date.now() - failed.get(k) < 3600e3;
async function pass() {
  const epoch = await C.currentEpoch(NET), desks = await C.findDesks(NET, null);
  let due = 0, done = 0;
  for (const desk of desks) for (const call of desk.calls) {
    if (C.phase(call, epoch) !== 'revealing' || !call.tlock) continue;
    const k = desk.address + ':' + call.seq;
    if (skip(k)) continue;
    let o;
    try { o = await C.openTlock(desk, call); } catch (e) { log('copie inutilisable', k, e.message); failed.set(k, Date.now()); continue; }
    if (!o) { log('pas encore lisible', k, 'tour à', new Date(C.tlockOpensAt(call)).toISOString()); continue; }
    due++;
    if (DRY) { log('à ouvrir', k, o.payload); continue; }
    if (await send(k, desk.address, C.revealInstruction(desk.address, call.seq, o))) done++;
  }
  // Pronostics des ligues : clos, avant la date limite, pas encore ouverts, avec une copie.
  const boards = C.leaguesLive(NET) ? await C.findBoards(NET) : [];
  for (const addr of boards) {
    const b = await C.readBoard(NET, addr).catch(e => { log('ligue illisible', addr, e.message); return null; });
    if (!b) continue;
    for (const q of b.questions) {
      if (epoch < q.close || epoch >= q.until) continue;
      for (const f of q.forecasts) {
        if (f.revealed || !f.tlock) continue;
        const k = addr + ':q' + q.id + ':' + f.index;
        if (skip(k)) continue;
        let o;
        try { o = await C.openForecastTlock(addr, q.id, f); } catch (e) { log('copie inutilisable', k, e.message); failed.set(k, Date.now()); continue; }
        if (!o) continue;
        due++;
        if (DRY) { log('à ouvrir', k, o.answer); continue; }
        if (await send(k, addr, C.forecastRevealInstruction(addr, q.id, f.index, o))) done++;
      }
    }
  }
  log(`passage : époque ${epoch}, ${desks.length} desk(s), ${boards.length} ligue(s), ${due} à ouvrir, ${done} ouvert(s)`);
}

(async () => {
  for (;;) {
    try { await pass(); } catch (e) { log('passage interrompu :', e.message); }
    if (ONCE) break;
    await new Promise(ok => setTimeout(ok, EVERY_MS));
  }
})();
