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
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nFactures validées : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
