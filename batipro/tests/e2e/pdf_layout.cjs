// Mise en page d'un PDF (lignes + morceaux de texte avec abscisse) avec le pdf.js de BatiPro – même calcul que assets/pilotage.js (pilPdfLayout).
// Usage : node tests/e2e/pdf_layout.cjs fichier.pdf sortie.json
const { chromium } = require('playwright'); const fs = require('fs');
const [,, pdfPath, outPath] = process.argv; const V = require('path').join(__dirname, '../../assets/vendor/');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ path: V + 'pdf-3.11.174.min.js' });
  const worker = fs.readFileSync(V + 'pdf.worker-3.11.174.min.js', 'utf8');
  const data = fs.readFileSync(pdfPath).toString('base64');
  const out = await p.evaluate(async ({ worker, data }) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([worker], { type: 'text/javascript' }));
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise; const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i); const tc = await pg.getTextContent(); const rows = [];
      for (const it of tc.items) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5]); let r = rows.find((q) => Math.abs(q.y - y) <= 2); if (!r) rows.push(r = { y, p: [] }); r.p.push([Math.round(it.transform[4] * 10) / 10, it.str]); }
      rows.sort((a, c) => c.y - a.y).forEach((r) => r.p.sort((a, c) => a[0] - c[0]));
      pages.push({ w: Math.round(pg.view[2]), rows });
    }
    return pages;
  }, { worker, data });
  fs.writeFileSync(outPath, JSON.stringify(out)); await b.close();
  console.log(outPath, out.length, 'pages', out.reduce((a, q) => a + q.rows.length, 0), 'lignes');
})();
