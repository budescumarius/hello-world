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
  check('aucune erreur JavaScript dans la page', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nnavigateur : tout est conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
