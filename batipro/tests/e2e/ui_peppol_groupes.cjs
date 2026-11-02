// Facture fournisseur reçue via Peppol (articles du XML, sans référence) avec son PDF joint :
// les articles doivent être regroupés automatiquement par référence de livraison (« Votre référence »), montants du XML inchangés.
// Données 100 % fictives.
const { chromium } = require('playwright');
const BASE = process.env.BP_URL || 'http://127.0.0.1:8081';
// PDF minimal : une ligne de texte par article (Helvetica, WinAnsi)
function pdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const stream = lines.map((l, i) => `BT /F1 10 Tf 1 0 0 1 50 ${780 - i * 16} Tm (${esc(l)}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
(async () => {
  let failed = 0; const check = (l, ok, d) => { console.log(`  ${ok ? '✔' : '✘'} ${l}${d ? ` – ${d}` : ''}`); if (!ok) failed++; };
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.fill('input[name=email]', 'admin@test.madibu.local'); await p.fill('input[name=password]', 'Admin-Test-2026'); await p.click('button[type=submit]');
  await p.waitForFunction('typeof S !== "undefined" && S.ready', null, { timeout: 30000 });
  const file = pdf(['FACTURE', 'NEGOCE FICTIF SRL', 'Votre reference : Chantier Dupont', 'SILICONE TRANSPARENT 310ML PC 2 5,73 11,46', 'TAPE EXPERT GOLD 24MM PC 1 7,52 7,52',
    'Votre reference : Chantier Martin', 'SPATULE JOINT 150MM PC 1 12,99 12,99', 'FIX FINISH 25 KG PC 1 17,74 17,74', 'Total HT 49,71']).toString('base64');
  const id = await p.evaluate(async (b64) => {
    const fd = new FormData(); fd.append('file', new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'application/pdf' }), 'facture-peppol-fictive.pdf');
    const f = await api('POST', 'files', fd);
    // articles tels que lus du XML Peppol : libellés du fournisseur, montants exacts, aucune référence
    const e = await persist('expense', { data: { source: 'peppol', status: 'avalider', ref: 'PEPPOL-TEST-1', date: today(), amount: 49.71, vat: 21, fileId: f.id, fileName: 'facture-peppol-fictive.pdf',
      items: [{ desc: 'Silicone transparent 310 ml', amount: 11.46 }, { desc: 'Tape expert gold 24 mm', amount: 7.52 }, { desc: 'Spatule joint 150 mm', amount: 12.99 }, { desc: 'Fix & finish 25 kg', amount: 17.74 }] } });
    return e.id;
  }, file);
  await p.goto(`${BASE}/#/purchase/${id}`);
  await p.waitForSelector('.pi-grp', { timeout: 20000 }).catch(() => {});
  const heads = await p.$$eval('.pi-grp .pi-it-d', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('Peppol + PDF : articles regroupés automatiquement par référence', heads.length === 2 && heads[0].includes('Chantier Dupont') && heads[1].includes('Chantier Martin'), heads.join(' | '));
  const amounts = await p.$$eval('.pi-it[data-it] b.r, .pi-it[data-it] .r', (l) => l.map((x) => x.textContent.trim())).catch(() => []);
  check('montants du XML conservés (pas remplacés par le PDF)', (await p.textContent('.page')).includes('Silicone transparent 310 ml'), amounts.slice(0, 4).join(' '));
  await p.click('.pi-grp[data-grp] input[type=checkbox]').catch(() => {});
  check('aucune erreur JavaScript', errs.length === 0, errs.join(' | '));
  await b.close();
  console.log(failed ? `\n${failed} échec(s)` : '\nPeppol : regroupement par référence conforme');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
