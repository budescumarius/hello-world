// Dernière vérification de TOUT BatiPro dans un vrai navigateur : chaque page des menus (BatiPro et Pilotage) s'ouvre
// sans erreur JavaScript ni message « Erreur », pour l'administrateur et pour un compte « user ».
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch();
  for (const [email, pass] of [['admin@test.madibu.local', 'Admin-Test-2026'], ['user@test.madibu.local', 'Role-Test-2026']]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
    await p.goto(BASE + '/'); await p.fill('input[name=email]', email); await p.fill('input[name=password]', pass); await p.click('button[type=submit]');
    await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 20000 });
    await p.evaluate(() => (typeof pilLoadMe === 'function' && pilEnabled() ? pilLoadMe() : null));
    const links = await p.evaluate(() => [...new Set(spaces().flatMap((sp) => (sp.sec.length ? sp.sec : [[sp.l, sp.h]]).map((x) => x[1])))]);
    const bad = [];
    for (const h of links) {
      const before = errs.length;
      await p.goto(BASE + '/' + h); await p.waitForTimeout(1200);
      await p.waitForFunction(() => !document.body.classList.contains('loading'), null, { timeout: 15000 }).catch(() => {});
      const toast = await p.evaluate(() => { const t = document.querySelector('#toast.show'); return t ? t.textContent : ''; });
      if (errs.length > before || /^Erreur/.test(toast)) bad.push(`${h} : ${errs.slice(before).join(' | ') || toast}`);
    }
    check(`${email.split('@')[0]} : ${links.length} pages ouvertes sans erreur`, bad.length === 0, bad.join(' ; '));
    await p.close();
  }
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nBatiPro complet : aucune erreur');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
