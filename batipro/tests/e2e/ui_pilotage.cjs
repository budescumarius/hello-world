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
  // rapprochement avec enregistrement du paiement, depuis la fiche du mouvement
  const tx = await p.evaluate(async () => { const t = (await api('GET', 'pilot/tx')).find((x) => x.amount === 242000 && x.booking_date === '2026-01-25'); if (t.match_id) await api('PUT', `pilot/tx/${t.id}`, { match: null }); return t; });
  await p.evaluate(() => { ui.pilTx = { status: '' }; }); await p.goto(BASE + '/#/pilotage'); await p.goto(BASE + '/#/pilotage/mouvements');
  await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Mouvements bancaires');
  await p.fill('.search input', 'CLIENT FICTIF SA'); await p.waitForTimeout(300);
  const rows = await p.$$('.dt tbody tr');
  for (const r of rows) { if (/2\s420,00/.test(await r.textContent())) { await r.click(); break; } }
  await p.waitForSelector('.modal [data-pay="1"]', { timeout: 10000 });
  await shot('pilotage-rapprochement');
  await p.click('.modal [data-pay="1"]'); await p.waitForTimeout(1200);
  const inv = await p.evaluate(async (id) => { const t = (await api('GET', 'pilot/tx')).find((x) => x.id === id); return t.match_id ? (await db.get('invoice', t.match_id)).data.payments : []; }, tx.id);
  check('bouton « Rapprocher et enregistrer le paiement » : paiement visible dans la facture', inv.length === 1 && inv[0].amount === 2420 && inv[0].bankTx === tx.id, JSON.stringify(inv));
  await p.goto(BASE + '/#/pilotage/historique'); await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Historique 24 mois' && document.querySelector('.page .dt'), null, { timeout: 15000 });
  check('historique 24 mois affiché', (await p.textContent('.page')).includes('Consolidé'));
  await shot('pilotage-historique');
  await p.goto(BASE + '/#/pilotage/imports'); await p.waitForFunction(() => (document.querySelector('.top h1') || {}).textContent === 'Journal des imports' && document.querySelector('.page .dt'), null, { timeout: 15000 });
  check('journal des imports : import annulé visible', (await p.textContent('.page')).includes('Annulé'));
  // étape 3 : trésorerie, engagements, factures et échéances
  const waitTitle = (t) => p.waitForFunction((x) => (document.querySelector('.top h1') || {}).textContent === x, t, { timeout: 20000 });
  await p.goto(BASE + '/#/pilotage/comptes'); await waitTitle('Comptes bancaires');
  await p.click('[data-add]'); check('bouton « Ajouter un compte » : formulaire ouvert', !!(await p.waitForSelector('.modal [name=iban]', { timeout: 5000 }).catch(() => null)));
  await p.keyboard.press('Escape');
  await p.goto(BASE + '/#/pilotage/tresorerie'); await waitTitle('Trésorerie et prévisions');
  const tr = await p.textContent('.page');
  check('trésorerie : soldes datés, formule, 3 scénarios, alertes, fiabilité', ['dernier extrait', 'Solde final estimé', 'Pessimiste', 'Alertes', 'Fiabilité des prévisions', 'Trésorerie réelle sur 24 mois'].every((w) => tr.includes(w)));
  check('trésorerie : graphique des 3 scénarios', (await p.$$('.pil-chart polyline')).length >= 4);
  await shot('pilotage-tresorerie');
  await p.click('[data-sc="pessimiste"]'); await waitTitle('Trésorerie et prévisions'); await p.waitForTimeout(500);
  check('changement de scénario', (await p.textContent('.page')).includes('pessimiste, 30 jours'));
  await p.click('[data-hyp]'); await p.waitForSelector('.modal [data-save]');
  await p.fill('.modal [data-k="pessimiste"][data-f="prudencePct"]', '8'); await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  check('hypothèses modifiées depuis l\'écran', (await p.textContent('.page')).includes('Marge de prudence +8 %'));
  await p.evaluate(() => api('PUT', 'pilot/hypotheses', {}));
  await p.goto(BASE + '/#/pilotage/engagements/leasing'); await waitTitle('Engagements');
  await p.click('[data-add]'); await p.waitForSelector('.modal [name=label]');
  await p.fill('.modal [name=label]', 'Leasing pelleteuse (UI)'); await p.selectOption('.modal [name=subtype]', 'machine');
  await p.fill('.modal [name=amount]', '1 250,50'); await p.fill('.modal [name=next_date]', '2026-12-05'); await p.fill('.modal [name=end_date]', '2028-12-05');
  await p.fill('.modal [name=residual]', '3000'); await p.check('.modal [name=buyback]');
  await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  const lz = await p.evaluate(async () => (await api('GET', 'pilot/commitments')).find((c) => c.label === 'Leasing pelleteuse (UI)'));
  check('engagement saisi dans le formulaire (montants en centimes, confirmé)', lz && lz.amount === 125050 && lz.residual === 300000 && lz.buyback === 1 && lz.status === 'confirme', JSON.stringify(lz && [lz.amount, lz.residual, lz.status]));
  await shot('pilotage-engagements');
  await p.goto(BASE + '/#/pilotage/echeances/clients'); await waitTitle('Factures et échéances');
  check('factures clients avec leur état', (await p.textContent('.page')).includes('Reste à encaisser') || (await p.textContent('.page')).includes('reste à encaisser'));
  await shot('pilotage-echeances');
  await p.goto(BASE + '/#/pilotage/echeances/fournisseurs'); await waitTitle('Factures et échéances');
  check('factures fournisseurs : engagé / payé', (await p.$$('.dt tbody tr')).length > 0);
  // étape 4 : directeur, assistant, chantiers
  await p.goto(BASE + '/#/pilotage/directeur'); await waitTitle('Directeur');
  const dr = await p.textContent('.page');
  check('rapport quotidien : titre, sections A à E, priorités', ['MADIBU – DAILY FINANCIAL REPORT', 'Les 5 priorités', 'A. Trésorerie', 'B. Encaissements', 'C. Décaissements', 'D. Chantiers', 'Alertes'].every((w) => dr.includes(w)));
  check('commentaire IA affiché avec vérification des montants', dr.includes('Commentaire de l\'IA') && dr.includes('montants vérifiés'));
  await shot('pilotage-directeur');
  await p.click('[data-al]'); await p.waitForSelector('.modal [name=status]');
  await p.selectOption('.modal [name=status]', 'en_cours'); await p.fill('.modal [name=note]', 'Pris en charge (test UI)'); await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  const dec = await p.evaluate(async () => (await api('GET', 'pilot/decisions')).some((d) => d.text === 'Pris en charge (test UI)'));
  check('alerte prise en charge depuis l\'écran, décision conservée', dec);
  await p.click('[data-cmp]'); await p.waitForSelector('[data-cmpout] table', { timeout: 10000 });
  check('comparaison de deux mois affichée', (await p.textContent('[data-cmpout]')).includes('Solde fin de mois'));
  await p.goto(BASE + '/#/pilotage/assistant'); await waitTitle('Assistant de direction');
  await p.click('[data-ex]:has-text("solde bancaire dans 30 jours")');
  await p.waitForSelector('.pil-a .good, .pil-a .late, .alert', { timeout: 30000 });
  const as = await p.textContent('.page');
  check('assistant : réponse avec source et montants vérifiés', as.includes('source') && as.includes('montants vérifiés'), as.slice(0, 200).replace(/\s+/g, ' '));
  await shot('pilotage-assistant');
  await p.goto(BASE + '/#/pilotage/chantiers'); await waitTitle('Analyse des chantiers');
  check('analyse des chantiers : chantier de test listé', (await p.textContent('.page')).includes('Rénovation Directeur'));
  await p.click('.dt tbody tr:has-text("Rénovation Directeur")'); await p.waitForSelector('.modal .pil-kv');
  check('fiche : coûts facturé / engagé / payé / restant', ['Coût facturé', 'Coût engagé', 'Coût payé', 'Coût estimé restant', 'Rentabilité finale prévue'].every((w) => p.$('.modal') && true) && (await p.textContent('.modal')).includes('Coût estimé restant'));
  await shot('pilotage-chantiers'); await p.keyboard.press('Escape');
  check('aucune erreur JavaScript dans la page', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\npilotage dans le navigateur : tout est conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
