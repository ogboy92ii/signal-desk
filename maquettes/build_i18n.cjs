// Découpe i18n.js (source unique des traductions) en fichiers servis : i18n/k.js (langues + clés françaises,
// chargé par toutes les pages) et i18n/<langue>.js (chargé seulement si cette langue est choisie).
// À relancer après chaque modification de i18n.js : node build_i18n.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const here = __dirname, out = path.join(here, 'i18n');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(here, 'i18n.js'), 'utf8'), ctx);
const { SD_LANGS, SD_K, SD_T } = ctx.window;
for (const [l, a] of Object.entries(SD_T)) if (a.length !== SD_K.length) throw new Error(`${l} : ${a.length} traductions pour ${SD_K.length} clés`);
fs.mkdirSync(out, { recursive: true });
const head = '// Généré par build_i18n.cjs depuis i18n.js : ne pas modifier à la main.\n';
fs.writeFileSync(path.join(out, 'k.js'), head + `window.SD_LANGS=${JSON.stringify(SD_LANGS)};\nwindow.SD_K=${JSON.stringify(SD_K)};\nwindow.SD_T={};\n`);
for (const [l, a] of Object.entries(SD_T)) fs.writeFileSync(path.join(out, l + '.js'), head + `window.SD_T[${JSON.stringify(l)}]=${JSON.stringify(a)};\n`);
const kb = f => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' Ko';
console.log(`${SD_K.length} clés · k.js ${kb('k.js')} · ` + Object.keys(SD_T).map(l => `${l} ${kb(l + '.js')}`).join(' · '));
