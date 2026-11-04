// « Où est passé l'argent ? » dans le navigateur : période, analyse, chiffres, répartitions, détail, export. Extraits 100 % fictifs (tests bancaires).
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 900 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026'); await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 45000 });
  await p.goto(`${BASE}/#/pilotage/argent`); await p.waitForSelector('[data-f]');
  check('menu : « Où est passé l\'argent ? » après le rapprochement bancaire', await p.evaluate(() => { const l = PIL_SPACE.sec.map((x) => x[0]); return l.indexOf('Où est passé l\'argent ?') === l.indexOf('Rapprochement bancaire') + 1; }));
  await p.fill('[name=from]', '2026-01-01'); await p.fill('[name=to]', '2026-01-31'); await p.fill('[name=until]', '2026-03-31');
  await p.click('[data-f] button[type=submit]'); await p.waitForSelector('[data-out] .kpis', { timeout: 20000 });
  const t = await p.textContent('[data-out]');
  check('résultat : encaissé, dépensé, encore en banque, solde avant', /Encaissé sur la période/.test(t) && /Dépensé à ce jour/.test(t) && /Encore en banque/.test(t) && /Solde avant la période/.test(t));
  check('répartitions : nature, chantier, fournisseurs, mois + détail des dépenses', /Par nature de dépense/.test(t) && /Par chantier/.test(t) && /Principaux fournisseurs/.test(t) && /Par mois/.test(t) && /Dépenses payées avec cet argent/.test(t));
  check('méthode et source affichées ; export CSV', /Méthode/.test(t) && !!(await p.$('[data-csv]')));
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  await m.goto(BASE + '/'); await m.fill('input[name=email]', 'admin@test.madibu.local'); await m.fill('input[name=password]', 'Admin-Test-2026'); await m.click('button[type=submit]');
  await m.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 45000 });
  await m.goto(`${BASE}/#/pilotage/argent`); await m.waitForSelector('[data-f]'); await m.click('[data-f] button[type=submit]'); await m.waitForSelector('[data-out] .kpis', { timeout: 20000 });
  check('téléphone : sans défilement horizontal', (await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 2);
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nOù est passé l\'argent : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
