// Bundle vendor/tlock.js : tlock-js 0.9.0 (drand quicknet), exposé en window.sdTlock.
import { timelockEncrypt, timelockDecrypt, mainnetClient, roundAt, roundTime, defaultChainInfo, Buffer } from 'tlock-js';
let client = null;
const c = () => client || (client = mainnetClient());
window.sdTlock = Object.freeze({
  info: defaultChainInfo,
  roundAt: ms => roundAt(ms, defaultChainInfo),
  roundTime: r => roundTime(defaultChainInfo, r),
  encrypt: async (round, text) => timelockEncrypt(round, Buffer.from(text, 'utf8'), c()),
  decrypt: async armored => (await timelockDecrypt(armored, c())).toString('utf8'),
});
