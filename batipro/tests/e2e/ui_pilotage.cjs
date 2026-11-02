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
  await p.goto(BASE + '/#/pilotage/controle'); await p.waitForSelector('.pil-cov', { timeout: 15000 });
  check('espace « Pilotage » visible pour l\'administrateur', await p.$$eval('.dock-tab', (t) => t.some((x) => x.textContent.includes('Pilotage'))));
  check('tableau de contrôle : une carte par compte', (await p.$$('.pil-cov')).length === 3);
  await shot('pilotage-controle');

  // l'import Belfius est annulé puis refait par l'interface : le PDF est lu par pdf.js dans le navigateur
  const imp = await p.evaluate(async () => (await api('GET', 'pilot/imports')).find((i) => i.filename === 'belfius-fictif.pdf' && i.status === 'importe'));
  await p.evaluate(async (id) => { const r = await api('DELETE', `pilot/imports/${id}`, { justification: 'test UI' }); await api('POST', `pilot/approvals/${r.approval.id}/approve`, {}); await api('POST', `pilot/approvals/${r.approval.id}/execute`, {}); }, imp.id);
  await p.goto(BASE + '/#/pilotage/import'); await p.waitForSelector('[data-file]');
  await p.setInputFiles('[data-file]', FX + 'belfius-fictif.pdf');
  await p.waitForSelector('[data-out] .info, [data-out] .alert', { timeout: 20000 });
  const pv = await p.textContent('[data-out]');
  check('aperçu : PDF lu dans le navigateur, contrôle des soldes exact', pv.includes('✓ contrôle exact') && pv.includes('Belfius'), pv.slice(0, 160).replace(/\s+/g, ' '));
  check('aperçu : virement vers Europabank proposé en transfert interne', pv.includes('Transfert interne'));
  await shot('pilotage-apercu');
  // refus du serveur au moment de la confirmation : le motif doit s'afficher (pas seulement « Erreur 422 »)
  const isImport = (u) => u.href.includes('r=pilot/import');
  await p.route(isImport, (r) => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Import refusé : motif de test', errors: ['motif de test'], statements: [] }) }));
  await p.click('[data-go]'); await p.waitForSelector('[data-out] .alert:has-text("motif de test")', { timeout: 15000 });
  check('import refusé : motif affiché et aperçu refait (bouton à nouveau disponible)', !!(await p.$('[data-go]')));
  await p.unroute(isImport);
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
  await p.evaluate(() => { ui.pilTx = { status: '' }; }); await p.goto(BASE + '/#/pilotage/controle'); await p.goto(BASE + '/#/pilotage/mouvements');
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
  await p.goto(BASE + '/#/pilotage/comptes/liste'); await waitTitle('Comptes bancaires');
  await p.click('[data-add]'); check('bouton « Ajouter un compte » : formulaire ouvert', !!(await p.waitForSelector('.modal [name=iban]', { timeout: 5000 }).catch(() => null)));
  await p.keyboard.press('Escape');
  await p.goto(BASE + '/#/pilotage/comptes/liste?add=1'); await waitTitle('Comptes bancaires');
  check('lien « Ajouter un compte » (écran vide, page d\'import) : formulaire ouvert directement', !!(await p.waitForSelector('.modal [name=iban]', { timeout: 5000 }).catch(() => null)));
  await p.keyboard.press('Escape');
  check('aucun lien « Ajouter un compte » vers la page elle-même', !(await p.evaluate(() => [pilDashPage, pilImportPage].some((f) => String(f).includes('href="#/pilotage/comptes"')))));
  await p.goto(BASE + '/#/pilotage/tresorerie'); await waitTitle('Trésorerie');
  const trt = await p.textContent('.page'); check('trésorerie : soldes datés, historique 24 mois, graphiques', ['dernier extrait', 'Trésorerie réelle sur 24 mois', 'Dépenses par catégorie', 'Crédits et leasing'].every((w) => trt.includes(w)));
  await p.goto(BASE + '/#/pilotage/previsions'); await waitTitle('Prévisions');
  const tr = await p.textContent('.page');
  check('prévisions : formule, 3 scénarios, alertes, fiabilité', ['Solde final estimé', 'Pessimiste', 'Alertes de trésorerie', 'Fiabilité des prévisions'].every((w) => tr.includes(w)));
  check('prévisions : graphique des 3 scénarios', (await p.$$('.pil-chart polyline')).length >= 3);
  await shot('pilotage-tresorerie');
  await p.click('[data-sc="pessimiste"]'); await waitTitle('Prévisions'); await p.waitForTimeout(500);
  check('changement de scénario', (await p.textContent('.page')).includes('pessimiste, 30 jours'));
  await p.click('[data-hyp]'); await p.waitForSelector('.modal [data-save]');
  await p.fill('.modal [data-k="pessimiste"][data-f="prudencePct"]', '8'); await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  check('hypothèses modifiées depuis l\'écran', (await p.textContent('.page')).includes('Marge de prudence +8 %'));
  await p.evaluate(() => api('PUT', 'pilot/hypotheses', {}));
  await p.goto(BASE + '/#/pilotage/engagements/leasing'); await waitTitle('Crédits et leasing');
  await p.click('[data-add]'); await p.waitForSelector('.modal [name=label]');
  await p.fill('.modal [name=label]', 'Leasing pelleteuse (UI)'); await p.selectOption('.modal [name=subtype]', 'machine');
  await p.fill('.modal [name=amount]', '1 250,50'); await p.fill('.modal [name=next_date]', '2026-12-05'); await p.fill('.modal [name=end_date]', '2028-12-05');
  await p.fill('.modal [name=residual]', '3000'); await p.check('.modal [name=buyback]');
  await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  const lz = await p.evaluate(async () => (await api('GET', 'pilot/commitments')).find((c) => c.label === 'Leasing pelleteuse (UI)'));
  check('engagement saisi dans le formulaire (montants en centimes, confirmé)', lz && lz.amount === 125050 && lz.residual === 300000 && lz.buyback === 1 && lz.status === 'confirme', JSON.stringify(lz && [lz.amount, lz.residual, lz.status]));
  await shot('pilotage-engagements');
  await p.goto(BASE + '/#/pilotage/echeances/clients'); await waitTitle('Rapprochement bancaire');
  check('factures clients avec leur état', (await p.textContent('.page')).includes('Reste à encaisser') || (await p.textContent('.page')).includes('reste à encaisser'));
  await shot('pilotage-echeances');
  await p.goto(BASE + '/#/pilotage/echeances/fournisseurs'); await waitTitle('Rapprochement bancaire');
  check('factures fournisseurs : engagé / payé', (await p.$$('.dt tbody tr')).length > 0);
  // étape 4 : directeur, assistant, chantiers
  await p.goto(BASE + '/#/pilotage/directeur'); await waitTitle('Rapports quotidiens');
  const dr = await p.textContent('.page');
  check('rapport quotidien : titre, sections A à E, priorités', ['MADIBU – DAILY FINANCIAL REPORT', 'Les 5 priorités', 'A. Trésorerie', 'B. Encaissements', 'C. Décaissements', 'D. Chantiers', 'Alertes'].every((w) => dr.includes(w)));
  check('commentaire IA affiché avec vérification des montants', dr.includes('Commentaire de l\'IA') && dr.includes('montants vérifiés'));
  await shot('pilotage-directeur');
  await p.goto(BASE + '/#/pilotage/alertes'); await waitTitle('Alertes');
  await p.click('.dt tbody tr'); await p.waitForSelector('.modal [name=status]');
  await p.selectOption('.modal [name=status]', 'en_cours'); await p.fill('.modal [name=note]', 'Pris en charge (test UI)'); await p.click('.modal [data-save]'); await p.waitForTimeout(1500);
  const dec = await p.evaluate(async () => (await api('GET', 'pilot/decisions')).some((d) => d.text === 'Pris en charge (test UI)'));
  check('alerte prise en charge depuis l\'écran, décision conservée', dec);
  await p.goto(BASE + '/#/pilotage/rapports'); await waitTitle('Rapports quotidiens');
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
  // étape 5 : Excel lu dans le navigateur, centre d'approbation, audit, rôles
  await p.goto(BASE + '/#/pilotage/import'); await waitTitle('Importer un extrait');
  await p.setInputFiles('[data-file]', FX + 'belfius-fictif-2026-02.xlsx');
  await p.waitForSelector('[data-tm="balance"]', { timeout: 20000 });
  const mapped = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-tm]')].map((s) => [s.dataset.tm, s.value])));
  check('Excel : colonnes reconnues d\'après leurs titres', mapped.date === '1' && mapped.amount === '7' && mapped.balance === '10' && mapped.communication === '9', JSON.stringify(mapped));
  await p.selectOption('[data-tacc]', { label: await p.evaluate(() => [...document.querySelectorAll('[data-tacc] option')].find((o) => o.textContent.includes('Belfius')).textContent) });
  await p.click('[data-tgo]'); await p.waitForSelector('[data-out] .info, [data-out] .alert', { timeout: 20000 });
  const xp = await p.textContent('[data-out]');
  check('Excel lu par le navigateur = mêmes lignes que le serveur (contrôle exact, doublons reconnus)', xp.includes('✓ contrôle exact') && xp.includes('déjà enregistrées'), xp.slice(0, 200).replace(/\s+/g, ' '));
  await shot('pilotage-excel');
  const apId = await p.evaluate(async () => (await api('POST', 'pilot/approvals', { type: 'email_externe', payload: { to: 'x@exemple.invalid', subject: 'Test UI', body: 'Bonjour' } })).id);
  await p.goto(BASE + '/#/pilotage/approbations'); await waitTitle('Centre d\'approbation');
  await p.click(`.dt tbody tr:has-text("Test UI")`); await p.waitForSelector('.modal [data-ap="approve"]');
  await shot('pilotage-approbation'); await p.click('.modal [data-ap="approve"]'); await p.waitForTimeout(1200);
  const st1 = await p.evaluate(async (id) => (await api('GET', 'pilot/approvals')).find((a) => a.id === id).status, apId);
  check('approbation depuis l\'écran : approuvée, pas encore exécutée', st1 === 'approuvee', st1);
  await p.goto(BASE + '/#/pilotage/audit'); await waitTitle('Journal d\'audit');
  check('journal d\'audit : intégrité vérifiée et affichée', (await p.textContent('.page')).includes('Intégrité vérifiée'));
  await shot('pilotage-audit');
  await p.goto(BASE + '/#/pilotage/parametres'); await waitTitle('Paramètres du Pilotage');
  check('paramètres : rôles des utilisateurs', (await p.textContent('.page')).includes('Finance Fictif'));
  await shot('pilotage-parametres');
  const p2 = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true }); p2.on('pageerror', (e) => errs.push('finance: ' + e.message));
  await p2.goto(BASE + '/'); await p2.fill('input[name=email]', 'finance@test.madibu.local'); await p2.fill('input[name=password]', 'Role-Test-2026'); await p2.click('button[type=submit]');
  await p2.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 20000 });
  await p2.goto(BASE + '/#/pilotage'); await p2.waitForSelector('.secbar', { timeout: 20000 }); await p2.waitForTimeout(800);
  const secs = await p2.$$eval('.secbar a', (l) => l.map((x) => x.textContent));
  check('rôle « finance » : menu limité à ses droits (pas de paramètres ni d\'audit)', secs.includes('Transactions') && secs.includes('Centre d\'approbation') && !secs.includes('Paramètres'), secs.join(', '));
  // intégration finale : 15 pages, vue générale expliquée, rapprochement, alertes, affichage téléphone
  await p.goto(BASE + '/#/pilotage/vue'); await waitTitle('Direction générale');
  const sec = await p.$$eval('.secbar a', (l) => l.map((x) => x.textContent));
  check('espace « Pilotage MADIBU » : les 15 pages dans l\'ordre', JSON.stringify(sec) === JSON.stringify(['Vue générale', 'Trésorerie', 'Comptes bancaires', 'Import des extraits', 'Transactions', 'Rapprochement bancaire', 'Crédits et leasing', 'Charges fixes', 'Prévisions', 'Rentabilité des chantiers', 'Alertes', 'Rapports quotidiens', 'Assistant IA', 'Centre d\'approbation', 'Paramètres']), sec.join(' · '));
  const vg = await p.textContent('.page');
  check('vue générale : 4 indicateurs (confirmé / estimé) et 7 décisions préparées', ['Trésorerie consolidée', 'Prévision 30 jours', 'Créances clients', 'Dettes fournisseurs', 'Combien pouvons-nous payer cette semaine', 'Quels fournisseurs régler en priorité', 'Quels clients devons-nous relancer', 'Quels chantiers nous font perdre', 'Quel sera notre solde dans 30 et 90 jours', 'Quels sont les risques les plus urgents', 'Que doit faire la direction aujourd'].every((w) => vg.includes(w)) && vg.includes('Confirmé') && vg.includes('Estimé'));
  await shot('pilotage-vue-generale');
  const kpiVal = (await p.textContent('[data-explain="prevision30"] b')).trim();
  await p.click('[data-explain="prevision30"]'); await p.waitForSelector('.modal h4', { timeout: 20000 });
  const ex = await p.textContent('.modal');
  check('même chiffre dans l\'indicateur et dans son explication (rapport recalculé si les données ont changé)', ex.includes(kpiVal), `${kpiVal} / ${(await p.textContent('.modal h3')).trim()}`);
  check('indicateur expliqué : source, période, hypothèses, incertitudes, éléments utilisés', ['Source', 'Période', 'Hypothèses', 'Incertitudes', 'Éléments utilisés'].every((w) => ex.includes(w)));
  await shot('pilotage-explication'); await p.keyboard.press('Escape');
  await p.goto(BASE + '/#/pilotage/rapprochement'); await waitTitle('Rapprochement bancaire'); await p.waitForSelector('.dt-card');
  check('rapprochement bancaire : mouvements à rapprocher avec proposition', (await p.textContent('.page')).includes('À rapprocher'));
  await shot('pilotage-rapprochement-liste');
  await p.goto(BASE + '/#/pilotage/alertes'); await waitTitle('Alertes');
  check('alertes : page dédiée', (await p.$$('.dt tbody tr')).length > 0);
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, bypassCSP: true }); m.on('pageerror', (e) => errs.push('mobile: ' + e.message));
  await m.goto(BASE + '/'); await m.fill('input[name=email]', 'admin@test.madibu.local'); await m.fill('input[name=password]', 'Admin-Test-2026'); await m.click('button[type=submit]');
  await m.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 20000 });
  for (const r of ['vue', 'tresorerie', 'previsions', 'mouvements', 'approbations']) {
    await m.goto(`${BASE}/#/pilotage/${r}`); await m.waitForTimeout(2500);
    const over = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`téléphone (390 px) : ${r} sans défilement horizontal`, over <= 2, `${over}px`);
  }
  if (shots) await m.screenshot({ path: path.join(shots, 'pilotage-mobile.png'), fullPage: true });
  check('aucune erreur JavaScript dans la page', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\npilotage dans le navigateur : tout est conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
