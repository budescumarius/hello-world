// Module Pilotage dans un vrai navigateur (instance de test, extraits FICTIFS) : lancé après tests/php/bank_test.php.
// Vérifie surtout la lecture des PDF par le pdf.js de BatiPro dans le navigateur, puis l'aperçu et la confirmation de l'import.
// Usage : node tests/e2e/ui_pilotage.cjs [dossier-captures]
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
const FX = path.join(__dirname, '../fixtures/bank/');
const shots = process.argv[2];
(async () => {
  let failed = 0;
  const check = (label, ok, detail) => { console.log(`  ${ok ? '✔' : '✘'} ${label}${detail ? ` – ${detail}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  const shot = async (n) => { if (shots) await p.screenshot({ path: path.join(shots, n + '.png'), fullPage: true }); };
  await p.goto(BASE + '/');
  await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026');
  await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 20000 });

  // l'espace « Pilotage » apparaît dans la barre (module activé par bank_test.php)
  await p.goto(BASE + '/#/pilotage'); await p.waitForSelector('.kpis', { timeout: 15000 });
  check('espace « Pilotage » visible pour l\'administrateur', await p.$$eval('.dock-tab', (t) => t.some((x) => x.textContent.includes('Pilotage'))));
  check('tableau de contrôle : une carte par compte', (await p.$$('.pil-cov')).length === 3);
  await shot('pilotage-controle');

  // l'import Belfius est annulé puis refait par l'interface : le PDF est lu par pdf.js dans le navigateur
  const imp = await p.evaluate(async () => (await api('GET', 'pilot/imports')).find((i) => i.filename === 'belfius-fictif.pdf' && i.status === 'importe'));
  await p.evaluate(async (id) => api('DELETE', `pilot/imports/${id}`), imp.id);
  await p.goto(BASE + '/#/pilotage/import'); await p.waitForSelector('[data-file]');
  await p.setInputFiles('[data-file]', FX + 'belfius-fictif.pdf');
  await p.waitForSelector('[data-out] .info, [data-out] .alert', { timeout: 20000 });
  const pv = await p.textContent('[data-out]');
  check('aperçu : PDF lu dans le navigateur, contrôle des soldes exact', pv.includes('✓ contrôle exact') && pv.includes('Belfius'), pv.slice(0, 160).replace(/\s+/g, ' '));
  check('aperçu : virement vers Europabank proposé en transfert interne', pv.includes('Transfert interne'));
  await shot('pilotage-apercu');
  await p.click('[data-go]'); await p.waitForSelector('[data-out] .alert.ok', { timeout: 15000 });
  check('confirmation : import enregistré', (await p.textContent('[data-out]')).includes('Import enregistré : 5 mouvement(s)'));
  const paired = await p.evaluate(async () => (await api('GET', 'pilot/tx')).filter((t) => t.category === 'transfert_interne' && t.transfer_tx_id).length);
  check('transfert interne Belfius ↔ Europabank de nouveau apparié', paired >= 2, `${paired} mouvements appariés`);

  // mouvements : ouverture d'un mouvement, choix de la catégorie et validation
  await p.goto(BASE + '/#/pilotage/mouvements'); await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Mouvements bancaires', null, { timeout: 15000 });
  await p.click('.chip[data-f=""]'); await p.waitForTimeout(300);
  const row = await p.$('.dt tbody tr:has-text("Sous-Traitant Fictif")');
  check('mouvement Belfius listé', !!row);
  if (row) {
    await row.click(); await p.waitForSelector('.modal [name=category]');
    await p.selectOption('.modal [name=category]', 'sous_traitance');
    await shot('pilotage-mouvement');
    await p.click('.modal [data-save="valide"]'); await p.waitForTimeout(1200);
    const t = await p.evaluate(async () => (await api('GET', 'pilot/tx')).find((x) => x.cp_name.startsWith('Sous-Traitant Fictif')));
    check('catégorie choisie et mouvement validé', t.category === 'sous_traitance' && t.status === 'valide' && t.cat_source === 'manuel');
    const rule = await p.evaluate(async () => (await api('POST', 'pilot/preview', { name: 'x.pdf', content: btoa('%PDF-x'), layout: null })).errors.length > 0);
    check('aperçu d\'un PDF illisible : refusé proprement', rule);
  }
  await shot('pilotage-mouvements');
  await p.goto(BASE + '/#/pilotage/historique'); await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Historique 24 mois' && document.querySelector('.page .dt'), null, { timeout: 15000 });
  check('historique 24 mois affiché', (await p.textContent('.page')).includes('Consolidé'));
  await shot('pilotage-historique');
  await p.goto(BASE + '/#/pilotage/imports'); await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Journal des imports' && document.querySelector('.page .dt'), null, { timeout: 15000 });
  check('journal des imports : import annulé visible', (await p.textContent('.page')).includes('Annulé'));
  check('aucune erreur JavaScript dans la page', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\npilotage dans le navigateur : tout est conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
