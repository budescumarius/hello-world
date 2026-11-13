// Facture reprise d'un autre logiciel (créée validée puis numérotée) et suppression groupée d'une facture validée par l'administrateur,
// après l'avertissement légal (note de crédit conseillée). Données 100 % fictives.
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.goto(BASE + '/'); await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026'); await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 30000 });
  await p.goto(BASE + '/#/invoices'); await p.waitForTimeout(800);
  await p.evaluate(() => externalInvoice());
  await p.waitForSelector('.modal [name=number]');
  await p.fill('.modal [name=number]', 'REPRISE-2026-77');
  await p.evaluate(async () => { const c = await persist('contact', { data: { kind: 'client', company: 'Client reprise fictif' } }); const s = document.querySelector('.modal [name=clientId]'); if (s && s.tagName === 'SELECT') { s.insertAdjacentHTML('beforeend', `<option value="${c.id}">x</option>`); s.value = String(c.id); } else if (s) s.value = String(c.id); });
  await p.fill('.modal [name=ht]', '13817,61');
  await p.click('.modal .btn.primary:visible');
  await p.waitForTimeout(1500);
  const inv = await p.evaluate(async () => (await db.list('invoice')).filter((i) => i.data.external && (i.number === 'REPRISE-2026-77' || !i.number)));
  check('facture d\'un autre logiciel enregistrée avec son numéro d\'origine (une seule fiche)', inv.length === 1 && inv[0].number === 'REPRISE-2026-77', JSON.stringify(inv.map((i) => i.number)) + ' ' + errs.join(' | '));
  if (inv.length) {
    await p.goto(`${BASE}/#/invoice/${inv[0].id}`); await p.waitForTimeout(1200);
    const pg = await p.textContent('#page');
    check('fiche : « Reprise » et bandeau « pas envoyée au comptable », sans bouton Envoyer', (await p.$$eval('.badge', (l) => l.map((x) => x.textContent))).includes('Reprise') && pg.includes('Facture reprise d\'un autre logiciel') && !(await p.$('[data-send]')));
    await p.goto(`${BASE}/#/invoices`); await p.waitForTimeout(1200);
    check('liste des factures : étiquette « Reprise »', (await p.$$eval('.badge', (l) => l.map((x) => x.textContent))).includes('Reprise'));
    await p.check('[data-selall]'); await p.waitForTimeout(200);
    const before = (await p.textContent('[data-bulkgo]')).trim();
    await p.fill('.dt-tools .search input', 'REPRISE-2026-77'); await p.waitForTimeout(300);
    const after = (await p.textContent('[data-bulkgo]').catch(() => '')).trim();
    check('sélection : une recherche retire ce qu\'elle cache (compteur = lignes visibles)', /^1 sélectionné/.test(after) && !/^1 /.test(before), `${before} → ${after}`);
    await p.fill('.dt-tools .search input', ''); await p.waitForTimeout(200);
    const exp = await p.evaluate(async () => (await persist('expense', { data: { date: today(), category: 'mat', source: 'reprise', status: 'validee', external: true, desc: 'Reprise ancien logiciel – Matériaux', ref: 'REPRISE-ACHAT-9', amount: 321, vat: 0, ttc: 321, paid: true } })).id);
    await p.goto(`${BASE}/#/purchase/${exp}`); await p.waitForTimeout(1200);
    check('fiche achat repris : « Reprise » et bandeau', (await p.textContent('#page')).includes('Dépense reprise d\'un autre logiciel'));
    await p.goto(`${BASE}/#/export`); await p.waitForTimeout(1500);
    const ex = await p.textContent('#page');
    check('export comptable : facture et achat repris absents', !ex.includes('REPRISE-2026-77') && !ex.includes('REPRISE-ACHAT-9'));
    await p.evaluate((it) => deleteMany('invoice', [it]), inv[0]);
    await p.waitForTimeout(1200);
    const left = await p.evaluate(async (id) => (await db.list('invoice')).some((i) => i.id === id), inv[0].id);
    check('administrateur : avertissement légal (note de crédit conseillée) puis suppression', dialogs.some((m) => /note de crédit/.test(m)) && !left, dialogs.map((m) => m.slice(0, 60)).join(' / '));
  }
  // note de crédit fournisseur (montant négatif) : validée sans être liée à un chantier
  const nc = await p.evaluate(async () => { const s = await persist('contact', { data: { kind: 'fournisseur', company: 'Fournisseur NC fictif' } });
    return (await persist('expense', { data: { date: today(), category: 'mat', status: 'avalider', toCheck: true, ref: 'NC-FICTIF-1', supplierId: s.id, ttc: -130.96, amount: -108.23, vat: 21, vatLines: [{ rate: 21, amount: -108.23 }], desc: 'Note de crédit fictive' } })).id; });
  await p.goto(`${BASE}/#/purchase/${nc}`); await p.waitForSelector('[data-submit]'); await p.waitForTimeout(600);
  await p.click('[data-submit]'); await p.waitForTimeout(1500);
  const ncd = await p.evaluate(async (id) => (await db.get('expense', id)).data, nc);
  check('note de crédit (-108,23 € HT) validée sans chantier', ncd.status === 'validee' && !ncd.toCheck, `${ncd.status} ${(await p.textContent('#toasts, .toast').catch(() => '')) || ''}`);
  // facture fournisseur à 0 € (ex. Peppol, livraison gratuite) : soumise après confirmation
  const z = await p.evaluate(async () => { const c = await persist('contact', { data: { kind: 'fournisseur', company: 'Zéro Fictif SA' } });
    return (await persist('expense', { data: { date: today(), category: 'mat', status: 'avalider', toCheck: true, ref: 'ZERO-1', supplierId: c.id, amount: 0, vat: 21 } })).id; });
  await p.goto(`${BASE}/#/purchase/${z}`); await p.waitForSelector('[data-submit]'); await p.waitForTimeout(600);
  const nd = dialogs.length; await p.click('[data-submit]'); await p.waitForTimeout(1800);
  const zd = await p.evaluate(async (i) => (await db.get('expense', i)).data, z);
  check('facture fournisseur à 0 € : confirmation demandée puis validée', dialogs.length === nd + 1 && /0,00 €/.test(dialogs[dialogs.length - 1]) && zd.status === 'validee' && Number(String(zd.ttc).replace(',', '.')) === 0, JSON.stringify({ st: zd.status, ttc: zd.ttc, dlg: dialogs.slice(nd) }));
  // achats : colonne « Échéance » (retard en rouge, bientôt en orange)
  await p.evaluate(async () => { const c = await persist('contact', { data: { kind: 'fournisseur', company: 'Échéance Fictive SA' } });
    await persist('expense', { data: { date: '2026-10-01', due: addDays(today(), -5), category: 'mat', status: 'validee', ref: 'ECH-RETARD', supplierId: c.id, amount: 100, ttc: 121, vat: 21 } });
    await persist('expense', { data: { date: '2026-10-01', due: addDays(today(), 3), category: 'mat', status: 'validee', ref: 'ECH-BIENTOT', supplierId: c.id, amount: 100, ttc: 121, vat: 21 } }); });
  await p.goto(`${BASE}/#/expenses`); await p.waitForTimeout(1500);
  await p.fill('.dt-tools .search input', 'Échéance Fictive'); await p.waitForTimeout(500);
  const ech = (await p.textContent('#tbl')).replace(/\s+/g, ' ');
  check('achats : colonne « Échéance » avec retard (5 j) et bientôt (dans 3 j)', /Échéance/.test(ech) && /5 j de retard/.test(ech) && /dans 3 j/.test(ech), ech.slice(0, 300));
  await p.fill('.dt-tools .search input', ''); await p.waitForTimeout(200);
  // fiche d'un sous-traitant : ses factures reçues, les paiements, le reste à payer et ses chantiers
  const sc = await p.evaluate(async () => {
    const c = await persist('contact', { data: { kind: 'soustraitant', company: 'BIMG Fictif SRL' } });
    const pr = await persist('project', { data: { name: 'Chantier BIMG fictif', status: 'encours' } });
    await persist('expense', { project_id: pr.id, data: { date: '2026-10-01', due: '2026-10-31', category: 'st', status: 'validee', ref: 'BIMG-1', supplierId: c.id, amount: 1000, ttc: 1000, vat: 0, vatLines: [{ rate: 0, amount: 0 }], payments: [{ date: '2026-10-15', amount: 400, method: 'Virement' }] } });
    await persist('expense', { project_id: pr.id, data: { date: '2026-10-20', due: '2099-12-31', category: 'st', status: 'validee', ref: 'BIMG-2', supplierId: c.id, amount: 500, ttc: 500, vat: 0, vatLines: [{ rate: 0, amount: 0 }], payments: [{ date: '2026-10-25', amount: 500, method: 'Virement' }] } });
    return c.id; });
  await p.goto(`${BASE}/#/contact/${sc}`); await p.waitForTimeout(1500);
  const ct = (await p.textContent('#page')).replace(/\s+/g, ' ');
  check('sous-traitant : factures reçues, paiements, reste à payer, chantier (pas d\'« Opportunités » vides)', /Factures reçues/.test(ct) && /BIMG-1/.test(ct) && /BIMG-2/.test(ct) && /Paiements/.test(ct) && /1 500,00/.test(ct) && /900,00/.test(ct) && /600,00/.test(ct) && /Chantier BIMG fictif/.test(ct) && !/Opportunités/.test(ct) && /Dont en retard/.test(ct), ct.slice(0, 400));
  // accueil : « ✕ » masque un élément réglé autrement, « Tout réafficher » le remet
  await p.goto(`${BASE}/#/dashboard`); await p.waitForSelector('.todo-x', { timeout: 15000 }).catch(() => {});
  const n0 = (await p.$$('.todo')).length; const t0 = await p.textContent('.todo .todo-tx b').catch(() => '');
  if (n0) { await p.click('.todo .todo-x'); await p.waitForTimeout(1800); }
  const n1 = (await p.$$('.todo')).length; const txt = await p.textContent('#page');
  check('accueil : ✕ masque l\'élément', n0 > 0 && n1 === n0 - 1 && /élément\(s\) masqué\(s\)/.test(txt) && !(await p.$$eval('.todo .todo-tx b', (l, t) => l.some((x) => x.textContent === t), t0)), `${n0} → ${n1}`);
  await p.click('[data-unhide]').catch(() => {}); await p.waitForTimeout(1500);
  check('« Tout réafficher »', (await p.$$('.todo')).length === n0);
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nFactures validées : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
