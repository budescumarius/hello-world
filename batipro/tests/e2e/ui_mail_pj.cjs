// Envoi par email : pièces jointes ajoutées à la main (fichier de l'appareil + document du chantier). Envoi intercepté : rien ne part. Données fictives.
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026'); await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 30000 });
  const pid = await p.evaluate(async () => {
    const pr = await persist('project', { data: { name: 'Chantier pièces jointes (fictif)', status: 'encours' } });
    const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 fictif'], { type: 'application/pdf' }), 'permis-fictif.pdf');
    const f = await api('POST', 'files', fd);
    await persist('document', { project_id: pr.id, data: { name: 'permis-fictif.pdf', fileId: f.id, folder: 'Administratif', size: 15, mime: 'application/pdf' } });
    return pr.id;
  });
  let body = null;
  await p.route((u) => /[?&]r=mail$/.test(u.toString()), async (route) => { body = route.request().postDataBuffer().toString('latin1'); await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"sent":1}' }); });
  await p.evaluate((id) => sendMailDialog({ subject: 'Test pièces jointes', body: 'Bonjour', recipients: [{ name: 'Client fictif', email: 'client@example.test', checked: true }], projectId: id }), pid);
  await p.setInputFiles('.modal [data-addf]', { name: 'photo-chantier.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg-fictif') });
  await p.click('.modal [data-docs]'); await p.waitForTimeout(600);
  const dm = p.locator('.modal').last(); console.log('   modale documents :', (await dm.textContent()).slice(0, 80)); await dm.locator('input[type=checkbox]').first().check(); await dm.locator('[data-ok]').click(); await p.waitForTimeout(300);
  const listed = await p.$$eval('.mail-att .att .grow', (l) => l.map((x) => x.textContent));
  check('deux pièces jointes listées (appareil + document du chantier)', listed.length === 2 && listed.includes('photo-chantier.jpg') && listed.includes('permis-fictif.pdf'), listed.join(', '));
  await p.click('.modal [data-send]'); await p.waitForTimeout(1500);
  check('les deux fichiers partent avec l\'email', !!body && body.includes('filename="photo-chantier.jpg"') && body.includes('filename="permis-fictif.pdf"') && body.includes('%PDF-1.4 fictif'));
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nPièces jointes : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
