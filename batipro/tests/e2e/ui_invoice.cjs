// Vérification dans un vrai navigateur, avec l'interface BatiPro (instance de test, données fictives).
// Facultatif : nécessite Playwright (require('playwright')). Lancé par tests/run.sh s'il est disponible.
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
(async () => {
  let failed = 0;
  const check = (label, ok, detail) => { console.log(`  ${ok ? '✔' : '✘'} ${label}${detail ? ` – ${detail}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch();
  // bypassCSP : uniquement pour appeler les fonctions de l'application depuis le test (la CSP de BatiPro interdit eval)
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); if (/^(Soumettre|Valider)/.test(d.message())) d.accept(); else d.dismiss(); });
  await p.goto(BASE + '/');
  await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026');
  await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 20000 });
  const id = await p.evaluate(async () => {
    const c = await persist('contact', { data: { kind: 'client', company: 'Client UI SA', vat: 'BE0123456789' } });
    const pr = await persist('project', { data: { name: 'Chantier UI', clientId: c.id, status: 'encours' } });
    const it = await persist('invoice', { project_id: pr.id, data: { kind: 'facture', status: 'brouillon', clientId: c.id, title: 'Travaux UI', date: today(), due: today(), defaultVat: 21,
      lines: [{ id: lid(), kind: 'item', desc: 'Maçonnerie', unit: 'm²', qty: 10, price: 100, vat: 21 }] } });
    window.__pid = pr.id; return it.id;
  });
  await p.goto(`${BASE}/#/invoice/${id}`); await p.waitForSelector('[data-submit]', { timeout: 15000 });
  await p.click('[data-submit]'); await p.waitForTimeout(2500);
  let inv = await p.evaluate(async (i) => db.get('invoice', i), id);
  check('validation par le bouton « Soumettre »', inv.data.status === 'emise' && !!inv.number, `${inv.data.status} n° ${inv.number}`);
  const pay = await p.evaluate(async (i) => { const it = await db.get('invoice', i); it.data.payments = [...(it.data.payments || []), { date: today(), amount: 400, method: 'virement' }]; try { await persist('invoice', it); return invState(it); } catch (e) { return { err: e.message }; } }, id);
  check('paiement partiel enregistré sur la facture validée', !pay.err && pay.s === 'partielle', pay.err || `payé ${pay.paid}, reste ${pay.rest}`);
  const before = dialogs.length;
  const edit = await Promise.race([
    p.evaluate(async (i) => { const it = await db.get('invoice', i); it.data.lines[0].price = 90; try { await persist('invoice', it); return { ok: true }; } catch (e) { return { status: e.status, msg: e.message }; } }, id),
    new Promise((r) => setTimeout(() => r({ timeout: true }), 15000)),
  ]);
  check('modification du prix refusée, message clair, sans boîte « écraser »', edit.status === 403 && dialogs.length === before, edit.msg || JSON.stringify(edit));
  const del = await p.evaluate(async () => { try { await db.del('project', window.__pid); return { ok: true }; } catch (e) { return { status: e.status, msg: e.message }; } });
  check('suppression du chantier facturé refusée', del.status === 403, del.msg);
  await p.goto(`${BASE}/#/invoice/${id}`); await p.waitForTimeout(1500);
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });
  // reste à encaisser : dans la fenêtre de paiement (en direct), après l'enregistrement, dans la liste et dans « Paiements »
  await p.evaluate(async (i) => invPayment(await db.get('invoice', i), null), id); await p.waitForSelector('.modal .pay-rest');
  const pr0 = (await p.textContent('.modal .pay-rest')).replace(/\s+/g, ' ');
  await p.fill('.modal [name=amount]', '300'); await p.waitForTimeout(200);
  const pr1 = (await p.textContent('.modal .pay-rest')).replace(/\s+/g, ' ');
  check('paiement : reste avant (810) et après la saisie (300 → 510) affichés', /Reste avant ce paiement ?810,00/.test(pr0) && /Reste à encaisser après ?510,00/.test(pr1), pr1);
  await p.click('.modal [data-save], .modal .btn.primary'); await p.waitForTimeout(1500);
  check('après l\'enregistrement : « reste à encaisser : 510 » annoncé', /reste à encaisser : 510,00/.test(await p.textContent('body')));
  await p.goto(`${BASE}/#/invoices`); await p.waitForTimeout(1500);
  const rowTxt = (await p.textContent('#page')).replace(/\s+/g, ' ');
  check('liste des factures : colonne « Reste à encaisser » (510 restants, payé 700)', /Reste à encaisser/.test(rowTxt) && /510,00 € ?payé 700,00/.test(rowTxt), rowTxt.slice(0, 200));
  await p.goto(`${BASE}/#/payments`); await p.waitForTimeout(1500);
  check('« Paiements » : reste à encaisser de la facture à côté de chaque paiement', /Reste à encaisser \(facture\)/.test(await p.textContent('#page')) && /510,00/.test(await p.textContent('#page')));
  await p.evaluate(async (i) => { const it = await db.get('invoice', i); it.data.payments.pop(); await persist('invoice', it); }, id); // retour à 810 pour la suite
  // rappels de paiement : niveau suivant proposé ; document « 2e rappel » avec reste à payer ; rappel noté sur la facture validée
  await p.evaluate(async (i) => invRappel(await db.get('invoice', i)), id); await p.waitForSelector('.modal .rap-opt');
  check('rappel : 1er rappel proposé, 3 niveaux (mise en demeure)', (await p.$eval('.modal [name=rap]:checked', (x) => x.value)) === '1' && (await p.$$('.modal .rap-opt')).length === 3 && /Mise en demeure/.test(await p.textContent('.modal')));
  await p.evaluate(() => closeModals());
  const rs = await p.evaluate(async (i) => { const it = await db.get('invoice', i); it.data.reminders = [{ level: 1, date: '2026-11-01', to: [{ email: 'client@ui.test' }], by: S.me.id, rest: 810 }]; try { await persist('invoice', it); return 'ok'; } catch (e) { return e.message; } }, id);
  check('rappel noté sur une facture validée (pas bloqué par la protection fiscale)', rs === 'ok', rs);
  await p.evaluate(async (i) => invRappel(await db.get('invoice', i)), id); await p.waitForSelector('.modal .rap-opt');
  check('après un 1er rappel : 2e rappel proposé, historique affiché', (await p.$eval('.modal [name=rap]:checked', (x) => x.value)) === '2' && /1er rappel/.test(await p.textContent('.modal .rows')));
  await p.evaluate(() => closeModals());
  await p.goto(`${BASE}/#/print/invoice/${id}?rappel=2`); await p.waitForTimeout(2500);
  const rp = (await p.textContent('.doc')).replace(/\s+/g, ' ');
  check('document : « 2e rappel – facture », reste à payer 810, texte (premier rappel du 01/11/2026, 8 jours)', /2e rappel – facture/i.test(rp) && /Reste à payer : 810,00/.test(rp) && /premier rappel du 01\/11\/2026/.test(rp) && /8 jours/.test(rp), rp.slice(0, 400));
  await p.goto(`${BASE}/#/invoices`); await p.waitForTimeout(1500);
  check('liste des factures : dernier rappel affiché sous le statut', /1er rappel · 01\/11\/2026/.test(await p.textContent('#page')));
  // facture simple sans fiche chantier : nom + adresse du chantier et remarque générale, imprimés sur la facture
  const id2 = await p.evaluate(async () => { const c = await persist('contact', { data: { kind: 'client', company: 'Client sans chantier SA' } });
    return (await persist('invoice', { data: { kind: 'facture', status: 'brouillon', clientId: c.id, title: 'Isolation sol', date: today(), due: today(), defaultVat: 21, lines: [{ id: lid(), kind: 'item', desc: 'Isolation', unit: 'm²', qty: 5, price: 40, vat: 21 }] } })).id; });
  await p.goto(`${BASE}/#/invoice/${id2}/informations`); await p.waitForSelector('[name=siteAddress]', { timeout: 15000 });
  check('facture sans chantier : champs « Nom / adresse du chantier » et « Remarque générale » visibles', await p.isVisible('[name=siteName]') && await p.isVisible('[name=siteAddress]') && await p.isVisible('#page [name=notes]'));
  await p.fill('[name=siteName]', 'Rénovation Vandenbogaert'); await p.fill('[name=siteAddress]', 'Rue de la Station 12\n3080 Tervuren');
  await p.fill('#page [name=notes]', 'Travaux réalisés conformément au devis.'); await p.waitForTimeout(2500);
  const saved = await p.evaluate(async (i) => (await db.get('invoice', i)).data, id2);
  check('enregistré', saved.siteName === 'Rénovation Vandenbogaert' && /Tervuren/.test(saved.siteAddress) && /conformément/.test(saved.notes), JSON.stringify({ n: saved.siteName, a: saved.siteAddress, r: saved.notes }));
  await p.goto(`${BASE}/#/invoice/${id2}/visualisation`); await p.waitForTimeout(2000);
  const vis = (await p.textContent('#page')).replace(/\s+/g, ' ');
  check('imprimé sur la facture : chantier (nom + adresse) et remarque', /Chantier ?Rénovation Vandenbogaert/.test(vis) && /Rue de la Station 12/.test(vis) && /Tervuren/.test(vis) && /Travaux réalisés conformément au devis/.test(vis), vis.slice(0, 300));
  // chantier choisi : les champs manuels disparaissent (l'adresse vient de la fiche chantier)
  await p.goto(`${BASE}/#/invoice/${id2}/informations`); await p.waitForSelector('[name=project_id]');
  await p.selectOption('[name=project_id]', String(await p.evaluate(() => window.__pid))); await p.waitForTimeout(400);
  check('chantier choisi : champs manuels masqués', !(await p.isVisible('[name=siteAddress]')));
  const cv = await p.evaluate(() => [clientLabel({ data: { civility: 'CIVILITE_MONSIEUR', name: 'Vandenbogaert', firstname: 'Jan' } }), clientLabel({ data: { civility: 'M.', name: 'Dupont' } }), clientLabel({ data: { name: 'Martin' } })]);
  check('civilité non remplie (code d\'un autre logiciel) : seulement le nom ; remplie : affichée', JSON.stringify(cv) === JSON.stringify(['Vandenbogaert Jan', 'M. Dupont', 'Martin']), JSON.stringify(cv));
  // poste : calcul du prix (matériaux + temps + marge), option, remarque
  const id3 = await p.evaluate(async () => { const c = await persist('contact', { data: { kind: 'client', company: 'Client calcul SA' } });
    return (await persist('invoice', { data: { kind: 'facture', status: 'brouillon', clientId: c.id, title: 'Carrelage', date: today(), due: today(), defaultVat: 21,
      lines: [{ id: lid(), kind: 'item', desc: 'Pose de carrelage', unit: 'm²', qty: 10, price: 0, vat: 21 }, { id: lid(), kind: 'item', desc: 'Plinthes', unit: 'm', qty: 5, price: 10, vat: 21 }] } })).id; });
  await p.goto(`${BASE}/#/invoice/${id3}/encodage`); await p.waitForSelector('[data-lcalc]', { timeout: 15000 });
  check('poste : boutons « Option », « Calculer le prix », « Remarque » sur la ligne', !!(await p.$('[data-lopt]')) && !!(await p.$('[data-lnote]')));
  await p.click('tr[data-i="0"] [data-k=unit]'); await p.waitForSelector('.unit-pop', { timeout: 5000 }).catch(() => {});
  const nu = (await p.$$('.unit-pop [data-u]')).length; await p.click('.unit-pop [data-u="ml"]').catch(() => {}); await p.waitForTimeout(300);
  check('unité : la liste complète s\'ouvre (même si une unité est déjà écrite) et le choix s\'applique', nu === 13 && (await p.inputValue('tr[data-i="0"] [data-k=unit]')) === 'ml', `${nu} unités`);
  await p.fill('tr[data-i="0"] [data-k=unit]', 'm²'); await p.keyboard.press('Escape');
  await p.click('[data-lcalc="0"]'); await p.waitForSelector('.modal .pc');
  await p.fill('.modal [data-f=name]', 'Colle carrelage'); await p.fill('.modal [data-f=qty]', '2'); await p.fill('.modal [data-f=price]', '10'); await p.fill('.modal [data-f=loss]', '10');
  await p.fill('.modal [data-c=hours]', '0,5'); await p.fill('.modal [data-c=rate]', '40'); await p.fill('.modal [data-c=margin]', '25');
  const pcTxt = (await p.textContent('.modal [data-res]')).replace(/\s+/g, ' ');
  check('calcul : matériaux 22 (pertes 10 %) + 0,5 h × 40 = 42 déboursé → 52,50 HT avec 25 %', /22,00/.test(pcTxt) && /42,00/.test(pcTxt) && /52,50/.test(pcTxt), pcTxt);
  await p.click('.modal [data-ok]'); await p.waitForTimeout(600);
  await p.click('[data-lopt="1"]'); await p.waitForTimeout(300);
  await p.click('[data-lnote="0"]'); await p.fill('tr[data-i="0"] [data-k=note]', 'Carrelage fourni par le client'); await p.waitForTimeout(2500);
  const d3 = await p.evaluate(async (i) => (await db.get('invoice', i)).data, id3);
  const t3 = await p.evaluate((d) => totals(d).base, d3);
  check('appliqué : prix 52,50, déboursé 42, détail gardé ; plinthes en option hors total ; remarque', d3.lines[0].price === 52.5 && d3.lines[0].cost === 42 && d3.lines[0].calc && d3.lines[1].option === true && d3.lines[0].note === 'Carrelage fourni par le client' && t3 === 525, JSON.stringify({ p: d3.lines[0].price, c: d3.lines[0].cost, o: d3.lines[1].option, n: d3.lines[0].note, t: t3 }));
  await p.goto(`${BASE}/#/invoice/${id3}/visualisation`); await p.waitForTimeout(2000);
  const v3 = (await p.textContent('#page')).replace(/\s+/g, ' ');
  check('facture : remarque du poste et « Option » imprimées', /Carrelage fourni par le client/.test(v3) && /Option/.test(v3), v3.slice(0, 200));
  // remises : sur un poste (% puis montant), puis globale en montant ; document et totaux
  await p.goto(`${BASE}/#/invoice/${id3}/encodage`); await p.waitForSelector('[data-ldisc="0"]', { timeout: 15000 });
  await p.click('[data-ldisc="0"]'); await p.waitForSelector('.modal [data-dv]');
  await p.fill('.modal [data-dv]', '10'); await p.waitForTimeout(150);
  const dr = (await p.textContent('.modal [data-dres]')).replace(/\s+/g, ' ');
  check('remise poste 10 % : avant 525, remise 52,50, après 472,50 (aperçu)', /525,00/.test(dr) && /52,50/.test(dr) && /472,50/.test(dr), dr);
  await p.click('.modal [data-dok]'); await p.waitForTimeout(400);
  await p.click('[data-ldisc="0"]'); await p.waitForSelector('.modal [data-dv]');
  await p.click('.modal [data-dm=amt]'); await p.fill('.modal [data-dv]', '25'); await p.click('.modal [data-dok]'); await p.waitForTimeout(400);
  await p.click('[data-gdisc]'); await p.waitForSelector('.modal [data-dv]');
  await p.click('.modal [data-dm=amt]'); await p.fill('.modal [data-dv]', '100'); await p.click('.modal [data-dok]'); await p.waitForTimeout(2500);
  const d4 = await p.evaluate(async (i) => (await db.get('invoice', i)).data, id3);
  const t4 = await p.evaluate((d) => totals(d), d4);
  check('remise poste 25 € : prix 50 (avant 52,50), ligne 500 ; remise globale 100 € exacte ; total HT 400', d4.lines[0].price === 50 && d4.lines[0].listPrice === 52.5 && d4.lines[0].disc.mode === 'amt' && t4.net === 500 && t4.discount === 100 && t4.base === 400 && d4.discountMode === 'amt', JSON.stringify({ p: d4.lines[0].price, lp: d4.lines[0].listPrice, net: t4.net, disc: t4.discount, base: t4.base }));
  await p.goto(`${BASE}/#/invoice/${id3}/visualisation`); await p.waitForTimeout(2000);
  const v4 = (await p.textContent('#page')).replace(/\s+/g, ' ');
  check('document : remise du poste expliquée, ligne « Remise » −100, total HT net 400', /Remise de 25,00 € sur ce poste/.test(v4) && /avant remise : 52,50/.test(v4) && /Remise ?-100,00|Remise ?−100,00|Remise ?- ?100,00/.test(v4) && /400,00/.test(v4), v4.slice(v4.indexOf('Total HT'), v4.indexOf('Total HT') + 200));
  check('aucune erreur JavaScript dans la page', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nnavigateur : tout est conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
