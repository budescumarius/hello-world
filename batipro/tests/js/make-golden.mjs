// Génère fixtures/finance-golden.json : résultats des calculs ACTUELS sur les scénarios fictifs.
// Ce fichier est la référence d'équivalence du futur portage PHP (module PILOTAGE).
// À régénérer uniquement après une modification volontaire et vérifiée d'un calcul.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadFinance, sourceDigest } from './extract.mjs';

const SC = JSON.parse(readFileSync(new URL('../fixtures/finance-scenarios.json', import.meta.url), 'utf8'));
const F = loadFinance({ todayIso: SC.today });
const map = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fn(v)]));
const out = {
  _note: 'Généré par « npm run golden » à partir du code de assets/*.js. Ne pas modifier à la main.',
  today: SC.today,
  sourceDigest: createHash('sha256').update(sourceDigest()).digest('hex'),
  totals: map(SC.documents, (d) => F.totals(d)),
  invState: map(SC.invoices, (i) => { const s = F.invState(i); return { s: s.s, paid: s.paid, rest: s.rest, total: s.t.total }; }),
  purchases: map(SC.purchases, (p) => ({ ttc: F.purchTtc(p.data), paid: F.purchPaid(p.data), rest: F.purchRest(p.data), state: F.purchState(p) })),
  projectFinance: F.projectFinance(SC.project.p, SC.project.all),
};
writeFileSync(new URL('../fixtures/finance-golden.json', import.meta.url), JSON.stringify(JSON.parse(JSON.stringify(out)), null, 2) + '\n');
console.log('fixtures/finance-golden.json écrit');
