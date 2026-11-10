// Robot de ligue (09/11) : tient la ligue publique « Signal Desk — Marchés », à la manière de Polymarket / Kalshi.
// Il pose des questions crypto calculées sur les prix du moment, et les tranche lui-même à la clôture avec les prix
// Binance (règle écrite dans chaque question). Signé par le wallet daemon local (compte SD_ACCOUNT, « signaldesk »).
//
//   node robot/ligue.cjs          boucle (tranchage chaque 5 min, nouvelle vague chaque jour)
//   node robot/ligue.cjs --dry    un passage : affiche ce qu'il ferait, n'envoie rien
'use strict';
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..', 'maquettes');
global.window = global;
const netFetch = global.fetch;
global.fetch = (url, opts) => (typeof url === 'string' && url.startsWith('vendor/')
  ? Promise.resolve(new Response(fs.readFileSync(path.join(SITE, url)), { headers: { 'content-type': url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }))
  : netFetch(url, opts));
require(path.join(SITE, 'vendor', 'tlock.js'));
require(path.join(SITE, 'chain.js'));
require(path.join(SITE, 'sports.js'));
const C = window.sdChain, SP = window.sdSports;

const NET = process.env.SD_NETWORK || 'esmeralda';
const RPC = process.env.SD_WALLETD || 'http://127.0.0.1:5100/json_rpc';
const ACCOUNT = process.env.SD_ACCOUNT || 'signaldesk';
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8')); } catch { return {}; } })();
const KEY_FILE = process.env.SD_WALLETD_KEY_FILE || LOCAL.walletdKeyFile || '';
const DRY = process.argv.includes('--dry');
const NAME = 'Signal Desk — Marchés', IMAGE = 'crypto';
const STATE = path.join(__dirname, 'ligue.state.json');
// Questions d'actualité (politique...) écrites après recherche web, et leurs résultats officiels vérifiés (décision D3).
const MANUAL_Q = path.join(__dirname, 'questions-manuelles.json'), MANUAL_R = path.join(__dirname, 'resultats-manuels.json');
const MAX_FEE = 200000, REVEAL_WINDOW = 48, WAVE_MS = 24 * 3600e3;
const REJECTED = /"Reject"\s*:|AcceptFeeRejectRest|OnlyFeeAccepted/;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19) + 'Z', ...a);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const key = () => (process.env.SD_WALLETD_KEY || fs.readFileSync(KEY_FILE, 'utf8')).trim();
let id = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key() },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(180000) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.code + ' ' + String(j.error.message).slice(0, 300));
  return j.result;
}
async function send(what, instructions, inputs) {
  const sub = await rpc('transactions.submit_instruction', { instructions, fee_account: ACCOUNT, max_fee: MAX_FEE,
    inputs: inputs.map(s => ({ substate_id: s, version: null, is_write: true })), override_inputs: true, new_outputs: null, proof_ids: [], min_epoch: null, max_epoch: null });
  const txId = sub && (sub.transaction_id || sub.id);
  const res = await rpc('transactions.wait_result', { transaction_id: txId, timeout_secs: 120 });
  const text = JSON.stringify(res);
  if (REJECTED.test(text)) throw new Error(what + ' rejeté (tx ' + txId + ')');
  log(what, 'tx', txId);
  return text;
}

// ---- Prix Binance --------------------------------------------------------------------------------
const SYM = s => s + 'USDT';
async function spot(s) {
  const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + SYM(s), { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('binance ' + r.status); return +(await r.json()).price;
}
// Prix à une heure donnée = ouverture de la bougie 1 min qui commence à cette heure (règle écrite dans la question).
async function priceAt(s, ms) {
  const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${SYM(s)}&interval=1m&startTime=${ms}&limit=1`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('binance ' + r.status);
  const k = (await r.json())[0]; if (!k || k[0] !== ms) throw new Error('bougie absente ' + s + ' ' + new Date(ms).toISOString());
  return +k[1];
}

// ---- Les questions --------------------------------------------------------------------------------
const STEP = { BTC: 1000, ETH: 50, SOL: 5, BNB: 10, XRP: 0.05, DOGE: 0.01 };
const roundTo = (x, s) => +(Math.round(x / s) * s).toFixed(4);
const money = x => x >= 100 ? x.toLocaleString('en-US') : String(x);
const hourUtc = h => { const d = new Date(Date.now() + h * 3600e3); d.setUTCMinutes(0, 0, 0); return d; };
const dayFr = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} à ${d.getUTCHours()}h UTC`;
const dayEn = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + `, ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
const RULE = ' (Binance, prix à l\'heure dite / Binance price at that time)';

// Chaque modèle renvoie { meta, rule } : meta va sur la chaîne, rule (dans l'état local) dit comment trancher.
const MODELS = {
  above: async (s, h, pct) => {
    const p = await spot(s), x = roundTo(p * (1 + pct), STEP[s]), d = hourUtc(h);
    return { h, meta: { type: 'yesno', q: `${s} au-dessus de ${money(x)} $ le ${dayFr(d)} ? / ${s} above $${money(x)} on ${dayEn(d)}?` + RULE },
      rule: { kind: 'above', s, x, at: d.getTime() } };
  },
  updown: async (s, h) => {
    const p = await spot(s), d = hourUtc(h);
    return { h, meta: { type: 'updown', q: `${s} : hausse ou baisse d'ici le ${dayFr(d)} ? / ${s}: up or down by ${dayEn(d)}?` + RULE },
      rule: { kind: 'updown', s, ref: p, at: d.getTime() } };
  },
  best: async (list, h) => {
    const ref = {}; for (const s of list) ref[s] = await spot(s);
    const d = hourUtc(h);
    return { h, meta: { type: 'choice', opts: list, q: `Quelle crypto fera le mieux d'ici le ${dayFr(d)} ? / Which coin performs best by ${dayEn(d)}?` + RULE },
      rule: { kind: 'best', list, ref, at: d.getTime() } };
  },
  price: async (s, h) => {
    const d = hourUtc(h);
    return { h, meta: { type: 'price', unit: '$', q: `Prix du ${s} le ${dayFr(d)} ? / ${s} price on ${dayEn(d)}?` + RULE },
      rule: { kind: 'price', s, at: d.getTime() } };
  },
  range: async (s, h) => {
    const p = await spot(s), w = STEP[s] * 4, c = roundTo(p, STEP[s]), d = hourUtc(h);
    const cuts = [c - w, c, c + w], opts = [`<${cuts[0]}`, `${cuts[0]}-${cuts[1]}`, `${cuts[1]}-${cuts[2]}`, `>${cuts[2]}`];
    return { h, meta: { type: 'range', opts, unit: '$', q: `${s} le ${dayFr(d)} : quelle fourchette ? / ${s} on ${dayEn(d)}: which range?` + RULE },
      rule: { kind: 'range', s, cuts, opts, at: d.getTime() } };
  },
};
// Sport (D3, 09/11) : vrai match ESPN à venir, « qui gagne ? », fermé au coup d'envoi, tranché sur le score final ESPN.
// null si aucun match (la vague passe à la suite). Un match déjà posé (id ESPN) n'est jamais reposé.
const SOCCER = ['UCL', 'EPL'], DRAW = 'Nul / Draw', LEAGUE_FR = { NBA: 'NBA', NFL: 'NFL', UCL: 'Ligue des champions', EPL: 'Premier League' };
const LEAGUE_EN = { NBA: 'NBA', NFL: 'NFL', UCL: 'Champions League', EPL: 'Premier League' };
let asked = new Set();
// Coup d'envoi à la minute (dayFr/dayEn arrondissent à l'heure).
const hm = d => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
const kickFr = d => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} à ${hm(d)} UTC`;
const kickEn = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + `, ${hm(d)} UTC`;
MODELS.match = async (leagues, hours) => {
  for (const lg of leagues) {
    const games = (await SP.upcoming(lg, hours)).filter(g => g.away && g.home && g.at - Date.now() > 2 * 3600e3 && !asked.has(lg + ':' + g.id));
    // Les matchs avec cotes ESPN d'abord (les plus suivis).
    const g = games.sort((x, y) => (!!y.odds - !!x.odds) || x.at - y.at)[0];
    if (!g) continue;
    const d = new Date(g.at), opts = SOCCER.includes(lg) ? [g.away, DRAW, g.home] : [g.away, g.home];
    return { h: 0, meta: { type: 'choice', opts, q: `${LEAGUE_FR[lg]} : ${g.away} à ${g.home}, qui gagne ? (coup d'envoi le ${kickFr(d)}) / ${LEAGUE_EN[lg]}: ${g.away} at ${g.home}, who wins? (kickoff ${kickEn(d)}) (score final ESPN / ESPN final score)` },
      rule: { kind: 'match', league: lg, id: g.id, a: g.away, b: g.home, when: d.toISOString(), at: g.at } };
  }
  return null;
};
// Vague de départ, puis une petite vague chaque jour.
const FIRST_WAVE = [() => MODELS.above('BTC', 72, 0.02), () => MODELS.above('ETH', 48, -0.02), () => MODELS.updown('SOL', 24),
  () => MODELS.best(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'], 168), () => MODELS.price('BTC', 96), () => MODELS.range('ETH', 120),
  () => MODELS.updown('BTC', 6), () => MODELS.above('DOGE', 48, 0.03)];
const DAILY_WAVE = [() => MODELS.updown('BTC', 24), () => MODELS.updown('ETH', 24), () => MODELS.above('SOL', 48, 0.03),
  () => MODELS.match(['NBA'], 72), () => MODELS.match(['NFL'], 96), () => MODELS.match(['EPL', 'UCL'], 96)];

async function outcomeOf(rule) {
  if (rule.kind === 'above') return (await priceAt(rule.s, rule.at)) > rule.x ? 'oui' : 'non';
  if (rule.kind === 'updown') return (await priceAt(rule.s, rule.at)) >= rule.ref ? 'hausse' : 'baisse';
  if (rule.kind === 'price') return String(Math.round(await priceAt(rule.s, rule.at)));
  if (rule.kind === 'range') { const p = await priceAt(rule.s, rule.at), i = rule.cuts.filter(c => p >= c).length; return rule.opts[i]; }
  if (rule.kind === 'best') {
    let best = null, bp = -Infinity;
    for (const s of rule.list) { const g = (await priceAt(s, rule.at)) / rule.ref[s]; if (g > bp) { bp = g; best = s; } }
    return best;
  }
  if (rule.kind === 'match') {
    const m = await SP.find({ league: rule.league, a: rule.a, b: rule.b, when: rule.when });
    if (!m) throw new Error('match introuvable sur ESPN');
    if (/POSTPONED|CANCEL|ABANDONED|FORFEIT|SUSPENDED/.test(m.status)) throw new Error('match annulé ou reporté (' + m.status + ') : à trancher à la main');
    if (!/STATUS_(FINAL|FULL_TIME|FINAL_OT|FINAL_PEN|FINAL_AET)/.test(m.status)) throw new Error('pas encore terminé (' + m.status + ')');
    const cs = m.comp.competitors || [], sc = x => Number(x && x.score), away = cs.find(z => z.homeAway === 'away'), home = cs.find(z => z.homeAway === 'home');
    if (!Number.isFinite(sc(away)) || !Number.isFinite(sc(home))) throw new Error('score illisible');
    // Foot : le temps réglementaire (penalties/prolongation comptent pour ESPN comme score final : seul un score égal donne Nul).
    return sc(away) > sc(home) ? rule.a : sc(home) > sc(away) ? rule.b : SOCCER.includes(rule.league) ? DRAW : (() => { throw new Error('égalité sans nul possible'); })();
  }
  if (rule.kind === 'manual') {
    const r = read(MANUAL_R, {})[rule.slug];
    if (typeof r !== 'string' || !r) throw new Error('résultat manuel absent (' + rule.slug + ')');
    return r;
  }
  throw new Error('règle inconnue ' + rule.kind);
}

// ---- La ligue -------------------------------------------------------------------------------------
// R1 (09/11) : 200 questions au plus par ligue (contrat). À ROLL_AT, le robot ouvre « <NAME> 2 », « 3 »… ; le site suit
// tout seul (chain.js officialBoard). Chaque question garde sa ligue pour être tranchée même après la bascule.
const ROLL_AT = 195, nameOf = gen => (gen > 1 ? NAME + ' ' + gen : NAME);
async function myBoard(st) {
  if (st.board) {
    C.clearReads();
    if ((await C.readBoardRaw(NET, st.board)).count < ROLL_AT) return st.board;
    if (DRY) { log('ouvrirait la ligue', nameOf((st.gen || 1) + 1)); return null; }
    for (const q of st.questions) if (!q.board) q.board = st.board;
    st.gen = (st.gen || 1) + 1; st.board = null; write(STATE, st); log('ligue pleine : bascule vers', nameOf(st.gen));
  }
  const name = nameOf(st.gen || 1), before = new Set(await C.findBoards(NET));
  if (DRY) { log('ouvrirait la ligue', name); return null; }
  await send('ligue ouverte', [C.boardOpenInstruction(NET, name, IMAGE, true)], []);
  for (let i = 0; i < 30; i++) {
    for (const a of await C.findBoards(NET)) {
      if (before.has(a)) continue;
      const b = await C.readBoard(NET, a).catch(() => null);
      if (b && b.name === name) { st.board = a; write(STATE, st); log('ligue', a); return a; }
    }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('ligue ouverte mais pas encore visible');
}
async function ask(st, board, model) {
  const m = await model(); if (!m) { log('pas de question (rien de disponible)'); return; }
  const epoch = await C.currentEpoch(NET);
  const close = epoch + Math.max(1, Math.round((m.rule.at - Date.now()) / C.EPOCH_MS)), until = close + REVEAL_WINDOW;
  m.meta.close_utc = new Date(m.rule.at).toISOString();
  if (DRY) { log('poserait', JSON.stringify(m.meta)); return; }
  C.clearReads();
  const count = (await C.readBoardRaw(NET, board)).count;
  if (count >= ROLL_AT) throw new Error('ligue pleine : bascule au prochain passage');
  await send(`question #${count} posée`, [C.askInstruction(board, count, m.meta, close, until)], [board]);
  st.questions.push({ id: count, board, rule: m.rule }); write(STATE, st);
  // Attendre que l'indexeur voie cette question : sinon la suivante reprend le même numéro (refusée).
  for (let i = 0; i < 30; i++) { C.clearReads(); if ((await C.readBoardRaw(NET, board)).count > count) return; await new Promise(r => setTimeout(r, 3000)); }
  throw new Error('question posée mais pas encore visible');
}
async function pass() {
  const st = read(STATE, { questions: [], lastWave: 0 });
  asked = new Set(st.questions.filter(q => q.rule.kind === 'match').map(q => q.rule.league + ':' + q.rule.id));
  const board = await myBoard(st);
  // 1. Trancher : question close (heure passée de 5 min), pas encore tranchée sur la chaîne.
  const epoch = await C.currentEpoch(NET);
  for (const at of new Set(st.questions.filter(q => !q.done).map(q => q.board || board).filter(Boolean))) {
    const b = await C.readBoard(NET, at).catch(e => { log('ligue illisible', at, e.message); return null; }); if (!b) continue;
    for (const q of st.questions.filter(x => (x.board || board) === at)) {
      const onChain = b.questions.find(x => x.id === q.id);
      if (!onChain || onChain.outcome !== null || q.done || epoch < onChain.close || Date.now() < q.rule.at + 5 * 60e3) continue;
      let out; try { out = await outcomeOf(q.rule); } catch (e) { log('résultat indisponible', q.id, e.message); continue; }
      if (DRY) { log('trancherait', q.id, out); continue; }
      try { await send(`question #${q.id} tranchée : ${out}`, [C.resolveInstruction(at, q.id, out)], [at]); q.done = true; write(STATE, st); }
      catch (e) { log('échec tranchage', q.id, e.message); }
    }
  }
  // 2. Vagues : la première tout de suite, puis une par jour. La position dans la vague est gardée (reprise après échec).
  const waveOf = () => (st.wave === 'daily' ? DAILY_WAVE : FIRST_WAVE);
  if ((st.next === undefined || st.next >= waveOf().length) && Date.now() - (st.lastWave || 0) >= WAVE_MS) {
    st.wave = st.lastWave ? 'daily' : 'first'; st.next = 0; st.lastWave = Date.now();
    if (!DRY) write(STATE, st);
  }
  while (st.next !== undefined && st.next < waveOf().length) {
    try { await ask(st, board, waveOf()[st.next]); } catch (e) { log('échec question', e.message); break; }
    st.next++; if (!DRY) write(STATE, st);
  }
  // 3. Questions manuelles : posées dès qu'elles apparaissent dans le fichier (si la clôture est à plus de 2 h).
  for (const mq of read(MANUAL_Q, [])) {
    const at = Date.parse(mq.close_utc);
    if (!mq.slug || !at || at - Date.now() < 2 * 3600e3 || st.questions.some(q => q.rule.kind === 'manual' && q.rule.slug === mq.slug)) continue;
    const meta = { type: mq.type, q: mq.q + (mq.source ? ` (source : ${mq.source})` : '') }; if (mq.opts) meta.opts = mq.opts;
    try { await ask(st, board, async () => ({ h: 0, meta, rule: { kind: 'manual', slug: mq.slug, at } })); } catch (e) { log('échec question manuelle', mq.slug, e.message); break; }
  }
}

(async () => {
  for (;;) {
    try { await pass(); } catch (e) { log('passage interrompu :', e.message); }
    if (DRY) break;
    await new Promise(r => setTimeout(r, 5 * 60e3));
  }
})();
