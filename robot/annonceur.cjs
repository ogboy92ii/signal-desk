// Annonceur Bluesky Signal Desk (09/11). Toutes les 5 minutes : lit les desks sur la blockchain et prépare un post
// pour chaque call scellé et chaque call ouvert pas encore annoncé.
//
// PAR DÉFAUT IL NE PUBLIE RIEN : les posts sont écrits dans robot/annonceur-brouillons.jsonl.
// Publication réelle seulement avec --publier ET le fichier robot/bluesky.secret.json, créé par Soufian lui-même :
//   { "identifier": "compte.bsky.social", "appPassword": "xxxx-xxxx-xxxx-xxxx" }   (mot de passe d'application Bluesky)
//
//   node robot/annonceur.cjs             boucle, brouillons seulement
//   node robot/annonceur.cjs --once      un passage, brouillons seulement
//   node robot/annonceur.cjs --publier   boucle, publie sur Bluesky
// Variables : SD_NETWORK (esmeralda), SD_SITE_URL (adresse publique du site, ajoutée aux posts si définie).
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
const C = window.sdChain;

const NET = process.env.SD_NETWORK || 'esmeralda';
const SITE_URL = (process.env.SD_SITE_URL || '').replace(/\/$/, '');
const PUBLISH = process.argv.includes('--publier'), ONCE = process.argv.includes('--once');
const STATE = path.join(__dirname, 'annonceur.state.json');
const DRAFTS = path.join(__dirname, 'annonceur-brouillons.jsonl');
const SECRET = path.join(__dirname, 'bluesky.secret.json');
const EVERY_MS = 5 * 60e3;

const log = (...a) => console.log(new Date().toISOString().slice(0, 19) + 'Z', ...a);
const done = new Set(fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : []);
const save = () => fs.writeFileSync(STATE, JSON.stringify([...done]));

// Bluesky : session ouverte avec le mot de passe d'application (jamais affiché), puis un post par annonce.
let session = null;
async function xrpc(method, body, auth) {
  const r = await fetch('https://bsky.social/xrpc/' + method, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(method + ' ' + r.status + ' ' + (j.error || ''));
  return j;
}
async function post(text) {
  if (!session) { const s = JSON.parse(fs.readFileSync(SECRET, 'utf8')); session = await xrpc('com.atproto.server.createSession', { identifier: s.identifier, password: s.appPassword }); }
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), langs: ['fr'] };
  // Lien cliquable : facette sur l'URL du site (positions en octets UTF-8).
  if (SITE_URL && text.includes(SITE_URL)) {
    const start = Buffer.byteLength(text.slice(0, text.indexOf(SITE_URL))), end = start + Buffer.byteLength(SITE_URL);
    record.facets = [{ index: { byteStart: start, byteEnd: end }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: SITE_URL }] }];
  }
  try { return await xrpc('com.atproto.repo.createRecord', { repo: session.did, collection: 'app.bsky.feed.post', record }, session.accessJwt); }
  catch (e) { session = null; throw e; }
}

const when = ms => new Date(ms).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const link = () => (SITE_URL ? '\n' + SITE_URL : '');
const cut = s => ([...s].length > 300 ? [...s].slice(0, 299).join('') + '…' : s);

async function pass() {
  const [desks, epoch] = await Promise.all([C.findDesks(NET, null), C.currentEpoch(NET)]);
  const now = Date.now(), msAt = e => now - (epoch - e) * C.EPOCH_MS, out = [];
  for (const d of desks) {
    const who = d.name || 'Desk ' + d.address.slice(10, 14) + '…' + d.address.slice(-4);
    let opened = null;
    for (const k of d.calls) {
      const id = d.address + ':' + k.seq, pair = String(k.label || '').split('|')[0] || 'crypto';
      const price = k.price === null ? 0 : Number(k.price / 1000000n);
      if (!done.has(id + ':scelle') && C.phase(k, epoch) === 'on-sale') {
        out.push([id + ':scelle', `🔒 Nouveau call scellé par ${who} sur ${pair}.\nPersonne ne peut le lire ni le modifier. Il s'ouvre tout seul vers le ${when(msAt(k.revealAtEpoch))}.` + (price ? `\nPrix : ${price} TARI.` : '') + link()]);
      }
      if (C.phase(k, epoch) === 'revealed' && !done.has(id + ':ouvert')) {
        opened = opened || await C.revealedPayloads(NET, d).catch(() => new Map());
        const c = opened.has(k.seq) ? C.parseCall(opened.get(k.seq)) : null;
        const body = c && c.cat === 'crypto' ? `${c.side} ${pair} · entrée ${c.entry} · objectif ${c.tp} · stop ${c.sl}` : 'contenu vérifié contre l\'engagement scellé';
        out.push([id + ':ouvert', `🔓 Call ouvert : ${who}\n${body}\nScellé le ${when(msAt(k.sealedAtEpoch))}, vérifiable par tous sur la blockchain.` + link()]);
      }
    }
  }
  for (const [id, text0] of out) {
    const text = cut(text0);
    if (PUBLISH) {
      try { const r = await post(text); log('publié', id, r.uri); }
      catch (e) { log('échec', id, e.message); continue; }
    } else {
      fs.appendFileSync(DRAFTS, JSON.stringify({ at: new Date().toISOString(), id, text }) + '\n');
      log('brouillon', id);
    }
    done.add(id); save();
  }
  log('passage fini :', desks.length, 'desk(s),', out.length, 'annonce(s)', PUBLISH ? 'publiée(s)' : 'en brouillon');
}

(async () => {
  if (PUBLISH && !fs.existsSync(SECRET)) { log('robot/bluesky.secret.json absent : publication impossible.'); process.exit(1); }
  for (;;) {
    try { await pass(); } catch (e) { log('erreur', e.message); }
    if (ONCE) break;
    await new Promise(r => setTimeout(r, EVERY_MS));
  }
})();
