// Liste les calls Finance / Politique ouverts qui attendent leur verdict (10/11).
// Usage : serveur local lancé (maquettes sur le port 8791), puis : node robot/verdicts-a-trancher.cjs
// Pour chaque call : la source officielle à lire, le sujet, le choix du caller et la ligne à ajouter dans
// maquettes/verdicts.json une fois le résultat officiel vérifié : "<desk>:<n°>": ["win" | "loss" | "void", "<adresse de la source>"].
// Rien n'est écrit par ce script : le verdict est validé par Soufian avant d'entrer dans verdicts.json.
// Playwright : installé à côté (npm i playwright) ou désigné par la variable PLAYWRIGHT_PATH (dossier du module).
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('sd-lang', 'fr'); } catch (e) {} });
  await p.goto(process.argv[2] || 'http://127.0.0.1:8791/classement.html', { waitUntil: 'load' });
  await p.evaluate(() => Promise.race([window.SD_READY, new Promise(r => setTimeout(r, 60000))]));
  const rows = await p.evaluate(() => { const D = window.SD_DATA, S = (window.sdMod && window.sdMod.SOURCES) || {}, out = [];
    for (const c of D.base) for (const x of c.allCalls) if (x.cat === 'pol' && x.opened) out.push({ cle: c.desk + ':' + x.seq, caller: c.display, source: x.sub + ' (' + (S[x.sub] || '?') + ')', sujet: x.pair, choix: x.pk && x.pk[1], echeance: x.until, etat: x.res === 'live' ? (x.pending ? 'À TRANCHER' : 'pas encore échu') : 'déjà tranché : ' + x.res });
    return out; });
  await b.close();
  const todo = rows.filter(r => r.etat === 'À TRANCHER');
  console.log(rows.length + ' call(s) Finance / Politique ouvert(s), ' + todo.length + ' à trancher.');
  for (const r of rows) console.log('- [' + r.etat + '] ' + r.caller + ' · ' + r.sujet + ' · choix « ' + r.choix + ' » · échéance ' + r.echeance + ' · source ' + r.source + (r.etat === 'À TRANCHER' ? '\n    à ajouter : "' + r.cle + '": ["win|loss|void", "<adresse de la publication officielle>"]' : ''));
})().catch(e => { console.log('ÉCHEC', e.message); process.exit(1); });
