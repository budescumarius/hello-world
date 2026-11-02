// « Sur le chantier » sur téléphone : point rapide (photo, phrase, qui), « Fait », travail SANS RÉSEAU (y compris
// rouvrir l'application hors ligne) puis envoi au retour du réseau, réunion avec signature et PV. Données 100 % fictives.
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, bypassCSP: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  let choosers = 0; p.on('filechooser', () => { choosers++; });
  await p.goto(BASE + '/'); await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026'); await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 30000 });
  const ids = await p.evaluate(async () => {
    const sub = await persist('contact', { data: { kind: 'soustraitant', company: 'Plafonnage Fictif SRL' } });
    const pr = await persist('project', { data: { name: 'Maison test terrain (fictif)', status: 'encours', subs: [sub.id], city: 'Forest' } });
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 800); x.strokeStyle = '#222'; x.lineWidth = 10; x.strokeRect(40, 40, 1120, 720); x.beginPath(); x.moveTo(600, 40); x.lineTo(600, 760); x.stroke();
    const up = await uploadPlanImage(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)), 1200, 800, 'rez', pr.id);
    const pl = await persist('plan', { project_id: pr.id, data: { name: 'Rez-de-chaussée', version: 1, ...up } });
    const pt = await persist('point', { project_id: pr.id, data: { title: 'Prise manquante cuisine', planId: pl.id, x: 0.7, y: 0.3, status: 'open', priority: 'normal', photos: [], history: [] } });
    // beaucoup de plans (le choix doit rester rapide)
    for (let i = 2; i <= 40; i++) await persist('plan', { project_id: pr.id, data: { ...pl.data, name: `Plan fictif ${String(i).padStart(3, '0')}`, level: i % 2 ? 'Étage 1' : 'Rez' } });
    return { pid: pr.id, plan: pl.id, sub: sub.id, pt: pt.id };
  });
  const pts = () => p.evaluate(async (pid) => (await api('GET', `items/point&project=${pid}`)), ids.pid);
  const ptByTitle = async (t) => (await pts()).find((x) => x.data.title === t);

  // onglet unique « Suivi » sur téléphone
  await p.goto(`${BASE}/#/project/${ids.pid}`); await p.waitForTimeout(1200);
  const tabs = await p.textContent('nav.tabs');
  check('téléphone : onglet « Suivi » à la place de Plans / Points / Réunions (14 onglets au lieu de 16)', /\/14/.test(tabs), tabs.replace(/\s+/g, ' ').trim());
  check('bouton « Sur le chantier » sur la fiche du chantier', !!(await p.$(`a[href="#/site/${ids.pid}"]`)));

  // écran « Sur le chantier »
  await p.goto(`${BASE}/#/site/${ids.pid}`); await p.waitForSelector('.site-viewer .pin', { timeout: 15000 });
  await p.waitForTimeout(1500);
  check('plan plein écran avec le point existant et « hors ligne prêt »', (await p.$$('.site-viewer .pin')).length === 1 && /Hors ligne prêt/.test(await p.textContent('[data-net]')));
  // choix du plan : un bouton + précédent / suivant + liste avec recherche
  check('un seul bouton de plan (pas une longue rangée)', !(await p.$('.site-chips')) && /Rez-de-chaussée/.test(await p.textContent('.site-plansel')) && /1 \/ 40/.test(await p.textContent('.site-plansel')), (await p.textContent('.site-plansel')).trim());
  await p.click('[data-next]'); await p.waitForTimeout(400);
  check('plan suivant d\'un geste', /Plan fictif 002/.test(await p.textContent('.site-plansel')));
  await p.click('[data-pick]'); await p.fill('.modal [data-q]', '037'); await p.waitForTimeout(200);
  const found = await p.$$eval('.modal .site-prow b', (l) => l.map((x) => x.textContent));
  check('recherche dans 40 plans', found.length === 1 && found[0] === 'Plan fictif 037', found.join(','));
  await p.click('.modal .site-prow'); await p.waitForTimeout(400);
  check('plan choisi depuis la liste', /Plan fictif 037/.test(await p.textContent('.site-plansel')));
  await p.click('[data-pick]'); await p.waitForTimeout(200);
  check('« Récents » en tête de liste', /Récents/.test(await p.textContent('.modal .site-pick')));
  await p.check('.modal [data-todo]'); await p.waitForTimeout(200);
  const todo = await p.$$eval('.modal .site-prow b', (l) => l.map((x) => x.textContent));
  check('filtre « avec points à faire »', todo.length === 1 && todo[0] === 'Rez-de-chaussée', todo.join(','));
  await p.click('.modal .site-prow'); await p.waitForSelector('.site-viewer .pin');
  // point rapide : + puis toucher le plan
  await p.click('[data-add]'); await p.waitForTimeout(200);
  const box = await p.$eval('.site-viewer', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 }; });
  await p.mouse.click(box.x, box.y); await p.waitForSelector('.modal [data-cam]', { state: 'attached' });
  await p.waitForTimeout(600);
  check('nouveau point : l\'appareil photo ne s\'ouvre pas tout seul (photo facultative)', choosers === 0 && await p.isVisible('.modal textarea[name=title]'));
  await p.setInputFiles('.modal [data-cam]', { name: 'photo.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(500);
  await p.fill('.modal textarea[name=title]', 'Fissure mur séjour');
  await p.click(`.modal [data-c="${ids.sub}"]`);
  await p.click('.modal [data-save]'); await p.waitForTimeout(2500);
  let np = await ptByTitle('Fissure mur séjour');
  check('point rapide enregistré : photo, intervenant, position sur le plan', np && np.data.photos.length === 1 && +np.data.companyId === ids.sub && +np.data.planId === ids.plan && np.data.x > 0.1 && np.data.x < 0.5, np && JSON.stringify({ ph: np.data.photos.length, c: np.data.companyId, x: np.data.x }));
  // « Fait » depuis la liste
  await p.click(`.site-pt[data-pt="${ids.pt}"]`); await p.click('.modal [data-st="done"]'); await p.waitForTimeout(2000);
  check('« ✓ Fait » : point levé avec son historique', (await p.evaluate(async (id) => (await api('GET', `items/point/${id}`)).data, ids.pt)).status === 'done');

  // ----- SANS RÉSEAU
  await p.reload(); await p.waitForSelector('.site-viewer .pin', { timeout: 15000 }); await p.waitForTimeout(2500); // l'application est gardée dans le téléphone
  await ctx.setOffline(true);
  await p.click('[data-add]'); await p.mouse.click(box.x + 60, box.y + 40); await p.waitForSelector('.modal [data-cam]', { state: 'attached' });
  await p.setInputFiles('.modal [data-cam]', { name: 'photo2.png', mimeType: 'image/png', buffer: PNG }); await p.waitForTimeout(400);
  await p.fill('.modal textarea[name=title]', 'Joint douche à refaire (hors ligne)'); await p.click('.modal [data-save]'); await p.waitForTimeout(800);
  np = await p.evaluate(() => siteState.snap.points.find((x) => x.data.title.includes('hors ligne')));
  await p.click(`.site-pt[data-pt="${np.id}"]`); await p.fill('.modal [data-cmt]', 'Silicone blanc demandé'); await p.click('.modal [data-addc]'); await p.waitForTimeout(500);
  const net = await p.textContent('[data-net]');
  check('sans réseau : point et commentaire gardés dans le téléphone (« en attente »)', /Hors ligne/.test(net) && /2 en attente/.test(net), net);
  // rouvrir l'application sans réseau
  await p.goto(`${BASE}/#/site/${ids.pid}`).catch(() => {}); await p.reload().catch(() => {});
  await p.waitForSelector('.site-viewer .pin', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const offPins = await p.$$eval('.site-viewer .pin', (l) => l.length).catch(() => 0);
  const offImg = await p.$eval('.site-viewer img', (i) => i.complete && i.naturalWidth > 0).catch(() => false);
  check('application rouverte SANS réseau : plan affiché, point hors ligne visible', offPins >= 2 && offImg && await p.evaluate(() => S.offline === true), `pins=${offPins} img=${offImg}`);
  // ----- RETOUR DU RÉSEAU
  await ctx.setOffline(false);
  await p.waitForTimeout(6000);
  await p.waitForSelector('.site-viewer', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(3000);
  np = await ptByTitle('Joint douche à refaire (hors ligne)');
  check('retour du réseau : point créé hors ligne envoyé avec sa photo et son commentaire', np && np.data.photos.length === 1 && np.data.history.some((h) => h.text === 'Silicone blanc demandé'), np && JSON.stringify(np.data.history.map((h) => h.text)));
  check('file d\'attente vide', (await p.evaluate(async () => (await opsAll()).length)) === 0);

  // ----- RÉUNION = VISITE
  await p.goto(`${BASE}/#/site/${ids.pid}`); await p.waitForSelector('.site-viewer .pin'); await p.waitForTimeout(800);
  await p.click('.site-top [data-mt]'); await p.click('.modal [data-start]'); await p.waitForTimeout(2000);
  check('réunion commencée : bandeau rouge', !!(await p.$('.site-live')));
  await p.click('[data-add]'); await p.mouse.click(box.x + 100, box.y - 60); await p.waitForSelector('.modal textarea[name=title]');
  await p.fill('.modal textarea[name=title]', 'Plinthe abîmée (réunion)'); await p.click('.modal [data-save]'); await p.waitForTimeout(2500);
  await p.click('.site-live'); await p.waitForSelector('.modal [data-end]');
  await p.click(`.modal [data-a="${ids.sub}"]`);
  await p.fill('.modal textarea[name=notes]', 'Carrelage SDB livré le 12/11.');
  await p.click('.modal [data-end]'); await p.waitForSelector('.modal .site-sig canvas');
  const cv = await p.$eval('.modal .site-sig canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.move(cv.x + 20, cv.y + cv.h / 2); await p.mouse.down(); await p.mouse.move(cv.x + cv.w / 2, cv.y + 10, { steps: 5 }); await p.mouse.move(cv.x + cv.w - 20, cv.y + cv.h - 10, { steps: 5 }); await p.mouse.up();
  await p.click('.modal [data-fin]'); await p.waitForTimeout(4000);
  const mt = (await p.evaluate(async (pid) => api('GET', `items/meeting&project=${pid}`), ids.pid))[0];
  check('réunion terminée : présents, notes, signature, point nouveau suivi', mt && mt.data.status === 'terminee' && (mt.data.signatures || []).length >= 1 && mt.data.attendees.includes(ids.sub) && mt.data.during.created.length === 1 && /Carrelage/.test(mt.data.notes), mt && JSON.stringify({ s: mt.data.status, sig: (mt.data.signatures || []).length, du: mt.data.during }));
  const pv = await p.textContent('body');
  check('PV affiché avec « Pendant la visite » et les signatures', /Pendant la visite/.test(pv) && /Signatures/.test(pv));
  await p.evaluate(() => closeModals());

  // ordinateur : les onglets restent
  const d = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true }); d.on('pageerror', (e) => errs.push(e.message));
  await d.goto(BASE + '/'); await d.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 30000 }).catch(async () => { await d.fill('input[name=email]', 'admin@test.madibu.local'); await d.fill('input[name=password]', 'Admin-Test-2026'); await d.click('button[type=submit]'); await d.waitForFunction('typeof S !== "undefined" && S.ready'); });
  await d.goto(`${BASE}/#/project/${ids.pid}/points`); await d.waitForTimeout(1200);
  const dt = await d.evaluate(() => [...document.querySelectorAll('nav.tabs a[href*="#/project/"]')].map((a) => a.getAttribute('href').split('/')[3]));
  check('ordinateur : onglets Plans, Points et Réunions inchangés', dt.includes('points') && dt.includes('plans') && dt.includes('meetings') && !dt.includes('suivi'));
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nSur le chantier : conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
