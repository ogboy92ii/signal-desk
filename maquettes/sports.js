// Résultats sportifs (09/11, décision D3 de Soufian) : les calls sport sont vérifiés avec les scores publics d'ESPN
// (site.api.espn.com, CORS ouvert, sans clé). Même code dans le site et dans les robots (window = global).
// Pris en charge : NFL, NBA, Ligue des champions (UCL), Premier League (EPL) : WIN (DRAW au foot), SPREAD, TOTAL ;
// UFC : WIN. Le reste (PROP, METHOD, ROUNDS, boxe) n'est pas vérifiable ici : refusé au scellement (moderation.js).
(() => {
  const PATH = { NFL: 'football/nfl', NBA: 'basketball/nba', UCL: 'soccer/uefa.champions', EPL: 'soccer/eng.1', UFC: 'mma/ufc' };
  const VERIFIABLE = { NFL: ['WIN', 'SPREAD', 'TOTAL'], NBA: ['WIN', 'SPREAD', 'TOTAL'], UCL: ['WIN', 'TOTAL'], EPL: ['WIN', 'TOTAL'], UFC: ['WIN'] };
  const FINAL = /STATUS_(FINAL|FULL_TIME|FINAL_OT|FINAL_PEN|FINAL_AET|END_OF_FIGHT)/, VOID = /STATUS_(POSTPONED|CANCELED|CANCELLED|ABANDONED|FORFEIT|SUSPENDED)/;
  const cache = new Map();
  const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  async function day(league, date) {
    const k = league + date, hit = cache.get(k);
    if (hit && Date.now() - hit.at < 5 * 60e3) return hit.v;
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${PATH[league]}/scoreboard?dates=${date}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('espn ' + r.status);
    const v = (await r.json()).events || [];
    cache.set(k, { at: Date.now(), v }); return v;
  }
  const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const abbr = x => norm(x.team && x.team.abbreviation);
  const fighter = (x, name) => { const n = norm(name), a = x.athlete || {}; return norm(a.displayName) === n || norm(a.lastName) === n || norm(a.shortName).endsWith(n); };
  /** La rencontre d'un call sport ({league, a, b, when}) : { comp, status } ou null. ESPN range les dates en heure US : on lit 3 jours. */
  async function find(c) {
    if (!PATH[c.league]) return null;
    const at = Date.parse(c.when); if (!at) return null;
    for (const d of [at, at - 864e5, at + 864e5]) {
      for (const ev of await day(c.league, ymd(d))) {
        for (const comp of ev.competitions || []) {
          if (Math.abs(Date.parse(comp.date || ev.date) - at) > 12 * 3600e3) continue;
          const cs = comp.competitors || [];
          const ok = c.league === 'UFC' ? cs.some(x => fighter(x, c.a)) && cs.some(x => fighter(x, c.b))
            : cs.some(x => x.homeAway === 'away' && abbr(x) === norm(c.a)) && cs.some(x => x.homeAway === 'home' && abbr(x) === norm(c.b));
          if (ok) return { comp, status: (comp.status && comp.status.type && comp.status.type.name) || (ev.status && ev.status.type && ev.status.type.name) || '' };
        }
      }
    }
    return null;
  }
  /**
   * Résultat d'un call sport (objet de sdChain.parseCall, cat 'sport') :
   * { state: 'win'|'loss'|'push'|'void'|'open'|'unknown', score, source }.
   */
  async function outcome(c) {
    if (!c || c.cat !== 'sport' || !VERIFIABLE[c.league] || !VERIFIABLE[c.league].includes(c.pick[0])) return { state: 'unknown', score: '', source: '' };
    const m = await find(c);
    if (!m) return { state: Date.now() < Date.parse(c.when) + 6 * 3600e3 ? 'open' : 'unknown', score: '', source: 'ESPN' };
    if (VOID.test(m.status)) return { state: 'void', score: '', source: 'ESPN' };
    if (!FINAL.test(m.status)) return { state: 'open', score: '', source: 'ESPN' };
    const cs = m.comp.competitors, [kind, x, line] = c.pick;
    if (c.league === 'UFC') {
      const w = cs.find(z => z.winner === true);
      if (!w) return { state: 'void', score: '', source: 'ESPN' };
      return { state: fighter(w, x) ? 'win' : 'loss', score: (w.athlete && w.athlete.displayName) || '', source: 'ESPN' };
    }
    const sc = z => Number(z.score), away = cs.find(z => z.homeAway === 'away'), home = cs.find(z => z.homeAway === 'home');
    const score = `${abbr(away)} ${sc(away)}-${sc(home)} ${abbr(home)}`;
    const cmp = v => (v > 0 ? 'win' : v < 0 ? 'loss' : 'push');
    if (kind === 'WIN') {
      if (x === 'DRAW') return { state: sc(away) === sc(home) ? 'win' : 'loss', score, source: 'ESPN' };
      const me = cs.find(z => abbr(z) === norm(x)), other = cs.find(z => z !== me);
      return { state: me && sc(me) > sc(other) ? 'win' : 'loss', score, source: 'ESPN' };
    }
    if (kind === 'SPREAD') { const me = cs.find(z => abbr(z) === norm(x)), other = cs.find(z => z !== me); return { state: cmp(sc(me) + Number(line) - sc(other)), score, source: 'ESPN' }; }
    if (kind === 'TOTAL') { const t = sc(away) + sc(home), d = t - Number(line); return { state: cmp(x === 'OVER' ? d : -d), score, source: 'ESPN' }; }
    return { state: 'unknown', score, source: 'ESPN' };
  }
  /** Rencontres des prochaines `hours` heures d'une ligue, avec cotes ESPN si présentes (pour le robot sport). */
  async function upcoming(league, hours) {
    const now = Date.now(), out = [];
    for (let d = now - 864e5; d <= now + hours * 3600e3 + 864e5; d += 864e5) {
      for (const ev of await day(league, ymd(d)).catch(() => [])) for (const comp of ev.competitions || []) {
        const at = Date.parse(comp.date || ev.date), st = comp.status && comp.status.type && comp.status.type.name;
        if (!(at > now && at < now + hours * 3600e3) || st !== 'STATUS_SCHEDULED' || out.some(o => o.id === comp.id)) continue;
        const cs = comp.competitors || [], away = cs.find(z => z.homeAway === 'away'), home = cs.find(z => z.homeAway === 'home');
        const od = (comp.odds || [])[0] || null;
        out.push({ id: comp.id, at, away: away && abbr(away), home: home && abbr(home), odds: od ? { details: od.details || '', overUnder: od.overUnder } : null });
      }
    }
    return out;
  }
  window.sdSports = { PATH, VERIFIABLE, find, outcome, upcoming };
})();
