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
    await p.evaluate((it) => deleteMany('invoice', [it]), inv[0]);
    await p.waitForTimeout(1200);
    const left = await p.evaluate(async (id) => (await db.list('invoice')).some((i) => i.id === id), inv[0].id);
    check('administrateur : avertissement légal (note de crédit conseillée) puis suppression', dialogs.some((m) => /note de crédit/.test(m)) && !left, dialogs.map((m) => m.slice(0, 60)).join(' / '));
  }
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nFactures validées : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
