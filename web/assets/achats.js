'use strict';
/* Achats : répartition sur plusieurs chantiers, import de factures fournisseurs (PDF, XML Peppol, photo), réception Peppol automatique. */

// ---------------------------------------------------------------- Répartition d'un achat par chantier
// Un achat ventilé garde `data.alloc` = [{ pid, amount, category }] (project_id vide) ; sinon tout va à project_id
function expenseParts(e) {
  const a = e.data.alloc;
  if (Array.isArray(a) && a.length) return a.map((x) => ({ pid: x.pid ? +x.pid : null, amount: num(x.amount), category: x.category || e.data.category || 'divers' }));
  return [{ pid: e.project_id || null, amount: num(e.data.amount), category: e.data.category || 'divers' }];
}
const expenseFor = (e, pid) => expenseParts(e).filter((x) => x.pid === pid);
const expenseAmountFor = (e, pid) => expenseFor(e, pid).reduce((a, x) => a + x.amount, 0);
const isSplit = (e) => Array.isArray(e.data.alloc) && e.data.alloc.length > 1;

// ---------------------------------------------------------------- Import d'une facture fournisseur : PDF, XML (UBL / Peppol) ou photo
// Chaque fichier devient une facture « À valider » (comme une facture reçue via Peppol), puis s'ouvre pour vérification
async function importPurchase(projectId) {
  const files = await pickFile('.pdf,.xml,application/pdf,application/xml,text/xml,image/*', true);
  if (!files.length) return;
  const made = [];
  for (const [i, file] of files.entries()) {
    toast(`Lecture de la facture${files.length > 1 ? ` ${i + 1}/${files.length}` : ''}…`, 30000);
    try {
      const pr = await purchasePreset(file, projectId);
      const pid = pr.project_id ? +pr.project_id : null; delete pr.project_id;
      made.push(await persist('expense', { project_id: pid, data: { ...pr, status: 'avalider', toCheck: true } }));
    } catch (e) { console.error(e); toast(`${file.name} : lecture impossible (${e.message})`, 6000); }
  }
  if (!made.length) return;
  toast(made.length > 1 ? `${made.length} factures ajoutées « À valider »` : 'Facture lue – vérifiez et soumettez', 3000);
  if (made.length === 1) go(`#/purchase/${made[0].id}`); else render();
}

async function purchasePreset(file, projectId) {
  const base = { project_id: projectId || '', date: today(), category: 'mat', vat: defVat() };
  const isXml = /\.xml$/i.test(file.name) || /xml/.test(file.type);
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isXml) {
    const u = parseUBL(await file.text());
    return { ...base, ...(await presetFromUBL(u, null, projectId)), source: 'xml', readNote: `Facture électronique ${u.number} lue (Peppol / UBL).` };
  }
  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await upload(new File([bytes], file.name, { type: 'application/pdf' }), projectId);
    let text = '';
    try {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
      // PDF avec facture électronique intégrée (Factur-X, ZUGFeRD, PDF Peppol) : on lit le XML
      const atts = await doc.getAttachments().catch(() => null);
      for (const a of Object.values(atts || {})) {
        if (!/\.xml$/i.test(a.filename || '')) continue;
        try { const u = parseUBL(new TextDecoder().decode(a.content)); return { ...base, ...(await presetFromUBL(u, up, projectId)), readNote: `Facture électronique intégrée au PDF (${a.filename}) lue.` }; } catch (e) { /* pas de l'UBL */ }
      }
      text = await pdfDocText(doc);
    } catch (e) { console.warn('pdf', e); }
    const g = parseInvoiceText(text);
    const contacts = await db.list('contact');
    const sup = g.vat ? contacts.find((c) => digitsOf(c.data.vat) && digitsOf(c.data.vat) === g.vat) : null;
    const hasTxt = text.replace(/\s/g, '').length > 30;
    return { ...base, fileId: up.id, fileName: up.name, desc: g.ref ? `Facture ${g.ref}` : file.name.replace(/\.pdf$/i, ''), ref: g.ref || '', date: g.date || today(), due: g.due || '',
      ...(g.base != null ? { amount: g.base } : {}), ...(g.rate != null ? { vat: g.rate } : {}), ...(g.tax != null ? { vatAmount: g.tax } : {}),
      ...(g.total != null ? { ttc: g.total } : {}), ...(g.tax != null ? { vatLines: [{ rate: g.rate != null ? g.rate : defVat(), amount: g.tax }] } : {}),
      iban: g.iban || '', bic: g.bic || '', communication: g.comm || '', structured: !!g.comm && g.comm.length === 12, source: 'pdf',
      supplierId: sup ? sup.id : '', supplierGuess: !sup && (g.name || g.vat) ? supplierGuessOf(g) : null,
      readNote: hasTxt ? `Lu dans le PDF : ${[g.ref && 'n° ' + g.ref, g.date && 'date', g.total != null && 'total ' + money(g.total), g.vatRaw && 'TVA ' + g.vatRaw].filter(Boolean).join(' · ') || 'peu d\'informations reconnues'}. Vérifiez les montants.` : 'PDF scanné (image) : complétez les montants à la main.' };
  }
  const up = file.type.startsWith('image/') ? await uploadPhoto(file, projectId) : await upload(file, projectId);
  return { ...base, fileId: up.id, fileName: up.name, desc: file.name.replace(/\.\w+$/, ''), source: 'photo', readNote: '' };
}

const digitsOf = (v) => String(v || '').replace(/\D/g, '').replace(/^0+(?=\d{9}$)/, '');
async function presetFromUBL(u, uploaded, projectId) {
  const contacts = await db.list('contact');
  const sup = contacts.find((c) => (u.supplier.vat && digitsOf(c.data.vat) && digitsOf(c.data.vat) === digitsOf(u.supplier.vat)) || (u.supplier.endpoint && c.data.peppolId === u.supplier.endpoint));
  let fileId; let fileName;
  if (uploaded) { fileId = uploaded.id; fileName = uploaded.name; } else {
    const att = u.attachments.find((a) => /pdf/i.test(a.mime)) || u.attachments[0];
    if (att) {
      const bin = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
      const r = await upload(new File([bin], /\.\w+$/.test(att.name) ? att.name : att.name + '.pdf', { type: att.mime }), projectId);
      fileId = r.id; fileName = r.name;
    }
  }
  const rate = u.base ? r2((u.tax / u.base) * 100) : 0;
  const near = vatList().reduce((best, x) => (Math.abs(x - rate) < Math.abs(best - rate) ? x : best), vatList()[0]);
  return {
    desc: `${u.kind === 'CreditNote' ? 'Note de crédit' : 'Facture'} ${u.number}${u.lines[0] ? ' – ' + u.lines[0] : ''}`, ref: u.number, date: u.date || today(), due: u.due || '',
    amount: r2(u.base), vat: Math.abs(near - rate) < 0.3 ? near : rate, vatAmount: r2(u.tax), peppol: true, fileId, fileName, ttc: r2(u.total),
    vatLines: (u.vatLines || []).length ? u.vatLines.map((x) => ({ rate: x.rate, amount: r2(x.amount) })) : [{ rate: Math.abs(near - rate) < 0.3 ? near : rate, amount: r2(u.tax) }],
    iban: u.iban || '', bic: u.bic || '', communication: (u.payId || '').replace(/\D/g, '').length === 12 ? u.payId.replace(/\D/g, '') : (u.payId || ''), structured: (u.payId || '').replace(/\D/g, '').length === 12,
    supplierId: sup ? sup.id : '',
    supplierGuess: sup ? null : { name: u.supplier.name, vat: u.supplier.vat, peppolId: u.supplier.endpoint, address: u.supplier.street, zip: u.supplier.zip, city: u.supplier.city, email: u.supplier.email },
  };
}

// Texte d'une page PDF reconstitué ligne par ligne
function pdfLines(tc) {
  const rows = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]); const x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, w: it.width || 0, fs: Math.hypot(it.transform[0], it.transform[1]) || 10, s: it.str });
  }
  // morceaux collés quand l'écart est faible (texte espacé « 2 0 2 6 » ou découpé « 202 » + « 6 »)
  return rows.sort((a, b) => b.y - a.y).map((r) => {
    const ps = r.parts.sort((a, b) => a.x - b.x); let out = ''; let end = null;
    for (const p of ps) { out += end == null ? p.s : (p.x - end < p.fs * 0.2 ? '' : ' ') + p.s; end = p.x + p.w; }
    return out.replace(/\s+/g, ' ').trim();
  }).join('\n');
}

// Reconnaissance des informations principales d'une facture (FR / NL / EN)
// texte des premières pages d'un PDF (document pdf.js ou fichier stocké)
async function pdfDocText(doc) {
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 4); i++) text += pdfLines(await (await doc.getPage(i)).getTextContent()) + '\n';
  return text;
}
async function pdfFileText(fileId) {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await (await fetch(fileUrl(fileId), { credentials: 'same-origin' })).arrayBuffer());
  return pdfDocText(await pdfjs.getDocument({ data: bytes }).promise);
}
const supplierGuessOf = (g) => ({ name: g.name || '', vat: g.vatRaw || '', address: g.address || '', zip: g.zip || '', city: g.city || '', email: g.email || '', phone: g.phone || '', iban: g.iban || '', bic: g.bic || '' });

// lignes du texte d'une facture, nettoyées
const invoiceTextLines = (text) => String(text || '').replace(/ | /g, ' ')
  .replace(/\b((?:19|20)\d) (\d)\b/g, '$1$2') // « 202 6 » → « 2026 »
  .split('\n').map((s) => s.trim()).filter(Boolean)
  // texte espacé lettre par lettre (« B r u x e l l e s , 6 j a n v i e r ») : on recolle (les espaces doubles séparent les mots)
  .map((l) => { const tk = l.split(' '); return tk.length >= 6 && tk.filter((x) => x.length === 1).length >= tk.length * 0.7 ? l.split(/\s{2,}/).map((w) => w.replace(/ /g, '').replace(/([,;:])(?=\S)/g, '$1 ').replace(/(\d)(?=[A-Za-zÀ-ÿ])|([A-Za-zÀ-ÿ])(?=\d)/g, '$1$2 ')).join(' ') : l; });

function parseInvoiceText(text) {
  const lines = invoiceTextLines(text);
  const RE_TOTAL = /(total|totaal|montant|net)\s*(t\.?t\.?c|tvac|t\.v\.a\.c|incl|à\s*payer|a\s*payer|te\s*betalen|g[ée]n[ée]ral|due|ttc)|net\s*à\s*payer|à\s*payer|a\s*payer|te\s*betalen|amount\s*due|total\s*due|^\s*total\s*:?\s*[\d€]|^\s*total\s*$/i;
  const RE_BASE = /(total|totaal|montant|sous[- ]?total|subtotaal|subtotal|base|maatstaf|net)\s*(h\.?\s?t\.?\s?v?\.?a?\.?\b|hors\s*t|htva|excl|imposable|van\s*heffing|maatstaf|net\b)|sous[- ]?total|subtotaal|subtotal|total\s*net/i;
  const RE_TAX = /\b(t\.?v\.?a\.?|btw|vat|mwst)\b(?!\s*(n[°º]|nr|num|number|nummer|:?\s*[a-z]{2}\s?[.\-]?\s?\d{3}))/i;
  // montants : « 1.234,56 », « 1 234,56 », « 1,234.56 », ou sans décimales s'ils sont suivis/précédés de € / EUR (« 336 EUR »)
  const toNum = (s) => {
    s = s.replace(/[\s']/g, '');
    if (/[.,]\d{2}$/.test(s)) return parseFloat(`${s.slice(0, -3).replace(/[.,]/g, '')}.${s.slice(-2)}`);
    if (/,\d$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    return parseFloat(s.replace(/[.,]/g, ''));
  };
  const amounts = (s) => {
    const found = [];
    for (const m of s.matchAll(/(?<![\d.,])(-?\d{1,3}(?:[ .,']?\d{3})*[.,]\d{2})(?![\d])/g)) found.push({ i: m.index, v: toNum(m[1]) });
    for (const m of s.matchAll(/(?<![\d.,])(-?\d{1,3}(?:[ .']\d{3})+|-?\d+)(?:,\d)?\s*(?:€|EUR\b)/gi)) if (!found.some((f) => Math.abs(f.i - m.index) < 4)) found.push({ i: m.index, v: toNum(m[0].replace(/\s*(€|EUR)$/i, '')) });
    for (const m of s.matchAll(/(?:€|EUR)\s*(-?\d{1,3}(?:[ .']\d{3})+|-?\d+)(?:[.,]\d{1,2})?(?![\d])/gi)) if (!found.some((f) => Math.abs(f.i - m.index) < 6)) found.push({ i: m.index, v: toNum(m[0].replace(/^(€|EUR)\s*/i, '')) });
    return found.sort((a, b) => a.i - b.i).map((f) => f.v).filter((v) => !Number.isNaN(v));
  };
  const isLabel = (l) => RE_TOTAL.test(l) || RE_BASE.test(l) || RE_TAX.test(l);
  const pick = (re, not = []) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!re.test(l) || not.some((n) => n.test(l))) continue;
      let a = amounts(l);
      // montant sur la ligne suivante, seulement si celle-ci ne porte pas elle-même un autre libellé (ex. « TOTAL »)
      if (!a.length && lines[i + 1] && !isLabel(lines[i + 1])) a = amounts(lines[i + 1]);
      if (a.length) return Math.abs(a[a.length - 1]);
    }
    return null;
  };
  // taux écrit sur la facture (« TVA 21 % »)
  let rateTxt = null;
  for (const l of lines) { const m = l.match(/\b(?:t\.?v\.?a\.?|btw|vat)\b[^%\d]{0,12}(\d{1,2}(?:[.,]\d+)?)\s*%/i) || l.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:t\.?v\.?a|btw|vat)\b/i); if (m) { rateTxt = num(m[1]); break; } }
  let total = pick(RE_TOTAL); let base = pick(RE_BASE, [RE_TOTAL]); let tax = pick(RE_TAX, [RE_TOTAL, RE_BASE]);
  if (base != null && total != null && base > total) [base, total] = [total, base];
  if (tax != null && total != null && tax >= total * 0.5) tax = null; // une TVA ne fait jamais la moitié du total : c'était un autre montant
  if (total != null && base != null && (tax == null || Math.abs(base + tax - total) > 0.05)) tax = r2(total - base);
  else if (total != null && tax != null && base == null) base = r2(total - tax);
  else if (base != null && tax != null && total == null) total = r2(base + tax);
  else if (total != null && base == null) { const v = rateTxt != null ? rateTxt : defVat(); base = r2(total / (1 + v / 100)); tax = r2(total - base); }
  let rate = null;
  if (base && tax != null) { const r = (tax / base) * 100; const near = vatList().reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), vatList()[0]); rate = Math.abs(near - r) < 0.6 ? near : r2(r); }
  // dates
  const MONTHS = { janv: 1, jan: 1, janvier: 1, januari: 1, fevr: 2, févr: 2, fév: 2, feb: 2, février: 2, februari: 2, mars: 3, maart: 3, mar: 3, avr: 4, avril: 4, april: 4, apr: 4, mai: 5, mei: 5, may: 5, juin: 6, juni: 6, jun: 6, juil: 7, juillet: 7, juli: 7, jul: 7, août: 8, aout: 8, augustus: 8, aug: 8, sept: 9, septembre: 9, september: 9, sep: 9, oct: 10, octobre: 10, oktober: 10, okt: 10, nov: 11, novembre: 11, november: 11, déc: 12, dec: 12, décembre: 12, decembre: 12, december: 12 };
  const dateIn = (s) => {
    let m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
    m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.toLowerCase().match(/(?:^|[^\d])(\d{1,2})(?:er)?\s*([a-zéûô]{3,9})\.?\s*(\d{4})(?!\d)/); if (m && MONTHS[m[2]]) return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return null;
  };
  const RE_DUE = /[ée]ch[ée]ance|vervaldag|vervaldatum|due\s*date|payable\s*(avant|le)|à\s*payer\s*(avant|pour)|uiterste|betaaldatum/i;
  const RE_PERIOD = /\(\s*\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\s*(au|-|–|tot|to)\s*\d/i; // période (« du 07/01 au 06/02 »)
  let due = null; let date = null;
  for (let i = 0; i < lines.length; i++) {
    if (RE_PERIOD.test(lines[i])) continue;
    const d = dateIn(lines[i]) || (/(date|datum)\s*:?\s*$/i.test(lines[i]) && lines[i + 1] ? dateIn(lines[i + 1]) : null);
    if (!d) continue;
    if (RE_DUE.test(lines[i])) { if (!due) due = d; } else if (/date|datum|le\s|du\s|,\s*(le\s*)?\d{1,2}(er)?\s*[a-zéû]{3,9}\s*\d{4}/i.test(lines[i]) && !date) date = d;
  }
  if (!date) for (const l of lines) { const d = dateIn(l); if (d && !RE_DUE.test(l) && !RE_PERIOD.test(l)) { date = d; break; } }
  // numéro de facture
  let ref = null;
  for (let i = 0; i < lines.length && !ref; i++) {
    const m = lines[i].match(/(?:facture|factuur|invoice|rechnung|note\s+de\s+cr[ée]dit|creditnota)\s*(?:n[°ºo]\.?|nr\.?|no\.?|num[ée]ro|nummer|number|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-\/._]{2,30})/i);
    if (m && /\d/.test(m[1])) ref = m[1].replace(/[.]$/, '');
    else if (/^(facture|factuur|invoice)?\s*(n[°º]|nr|num[ée]ro|nummer)\.?\s*:?\s*$/i.test(lines[i]) && lines[i + 1] && /^[A-Z0-9][A-Z0-9\-\/._]{2,30}$/i.test(lines[i + 1]) && /\d/.test(lines[i + 1])) ref = lines[i + 1];
  }
  // n° de TVA du fournisseur : jamais le nôtre (dans tous ses formats), ni ceux du bloc « client » (notre nom et adresse)
  const co = company();
  const own = new Set([co.vat, co.enterprise, (co.peppolId || '').split(':')[1], typeof sellerInfo === 'function' ? sellerInfo().enterprise : ''].map(digitsOf).filter((x) => x.length >= 8));
  const coName = (co.name || '').toLowerCase().replace(/\b(srl|sprl|sa|nv|bv|bvba)\b/g, '').trim();
  const coStreet = (co.address || co.street || '').split('\n')[0].toLowerCase().slice(0, 14);
  const ownBlock = new Set();
  lines.forEach((l, i) => { const ll = l.toLowerCase(); if ((coName && coName.length > 3 && ll.includes(coName)) || (coStreet.length > 6 && ll.includes(coStreet))) for (let k = i - 2; k <= i + 4; k++) ownBlock.add(k); });
  const LEGAL = /\b(SRL|SPRL|SA|NV|BV|BVBA|SCS|SCRL|SC|SNC|SCOMM|COMMV|CV|ASBL|VZW|GMBH|SARL|SAS|LTD|LLC)\b/i;
  const cands = [];
  lines.forEach((l, i) => { for (const m of l.matchAll(/\b(BE|LU|NL|FR|DE)\s?[-.:]?\s?(\d[\d .]{7,14}\d)\b/gi)) { const dg = digitsOf(m[2]); if (dg.length >= 8 && !own.has(dg) && !ownBlock.has(i)) cands.push({ dg, raw: (m[1] + m[2].replace(/\D/g, '')).toUpperCase(), i, score: (LEGAL.test(l) ? 2 : 0) + (i > lines.length * 0.6 ? 1 : 0) }); } });
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  const vat = cands[0] ? cands[0].dg : null; const vatRaw = cands[0] ? cands[0].raw : null; const vatLine = cands[0] ? cands[0].i : -1;
  // nom du fournisseur : sur la ligne de son n° de TVA (pied de page) ou juste au-dessus, sinon une ligne « société » de l'en-tête
  const clean = (l) => l.split(/\s[·•|–]\s|\s-\s/)[0].replace(/\b(TVA|BTW|VAT|N°\s*TVA|BCE|KBO|RPM|RPR)\b.*$/i, '').replace(/[\s,:;·•\-–]+$/, '').trim();
  const okName = (l) => l && /[a-z]{3}/i.test(l) && l.length <= 70 && !dateIn(l) && !/factu|invoice|page|tél|tel\b|@|www|iban|swift|bic|rue |straat|avenue|chaussée|place |^\d|^n[°º]/i.test(l) && (!coName || !l.toLowerCase().includes(coName));
  let name = '';
  if (vatLine >= 0) { const a = clean(lines[vatLine]); if (okName(a)) name = a; else if (vatLine > 0 && okName(clean(lines[vatLine - 1]))) name = clean(lines[vatLine - 1]); }
  if (!name) name = (lines.slice(0, 15).find((l, i) => !ownBlock.has(i) && okName(l) && LEGAL.test(l)) || lines.slice(0, 12).find((l, i) => !ownBlock.has(i) && okName(l)) || '').trim();
  // IBAN du fournisseur (pas le nôtre) et communication structurée +++123/4567/89012+++
  const ownIban = String(co.iban || '').replace(/\s/g, '').toUpperCase();
  let iban = null;
  for (const m of String(text).toUpperCase().matchAll(/\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)\b/g)) { const v = m[1].replace(/\s/g, ''); if (/^(BE\d{14}|LU\d{18}|NL\d{2}[A-Z]{4}\d{10}|FR\d{12}[A-Z0-9]{11}\d{2}|DE\d{20})$/.test(v) && v !== ownIban) { iban = v; break; } }
  const cm = String(text).match(/\+{3}\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*\+{3}/) || String(text).match(/\*{3}\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*\*{3}/);
  const comm = cm ? cm[1] + cm[2] + cm[3] : null;
  const bicM = String(text).match(/\b(?:BIC|SWIFT)\s*:?\s*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i);
  // coordonnées du fournisseur : au plus près de sa ligne TVA, jamais dans notre bloc « client »
  const order = lines.map((l, i) => i).filter((i) => !ownBlock.has(i)).sort((a, b) => (vatLine >= 0 ? Math.abs(a - vatLine) - Math.abs(b - vatLine) : a - b));
  const near = (fn) => { for (const i of order) { const r = fn(lines[i], i); if (r) return r; } return null; };
  const ownMail = String(co.email || '').toLowerCase();
  const email = near((l) => { const m = l.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/); return m && m[0].toLowerCase() !== ownMail ? m[0] : null; });
  const phone = near((l) => { const m = l.match(/(?:t[ée]l(?:[ée]phone)?|tel|phone|gsm|mobile|t)\.?\s*:?\s*(\+?\d[\d\s\/.()-]{7,17}\d)/i); return m && !/iban|tva|btw|vat/i.test(l.slice(0, m.index)) ? m[1].trim() : null; });
  const STREET = /\b(rue|avenue|av\.|chauss[ée]e|place|boulevard|bd|chemin|all[ée]e|quai|square|route|impasse|straat|laan|lei|steenweg|weg|plein|dreef|kaai|str\.)\b|straat\b|laan\b/i;
  const where = near((l, i) => {
    if (/€|\beur\b|total|tva\s*\d|%/i.test(l)) return null;
    const m = l.match(/(?:^|[\s,·•|–-])(?:[A-Z]{1,2}-)?(\d{4,5})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. -]{2,28}?)(?=$|\s*[·•|–,]|\s-\s|\s{2}|\s+(?:TVA|BTW|VAT|T[ée]l|Tel|T\b|GSM|www|E-?mail|IBAN|BCE|RPM))/);
    if (!m || /^(eur|pcs|x|tva|btw)\b/i.test(m[2])) return null;
    const before = l.slice(0, m.index).split(/\s[·•|–-](?:\s|$)/).map((x) => x.replace(/[\s,;·•\-–]+$/, '').trim()).filter(Boolean);
    let street = before.reverse().find((x) => STREET.test(x) || (/\d/.test(x) && /[a-z]{3}/i.test(x) && !/tva|btw|vat|iban/i.test(x))) || '';
    if (!street && i > 0 && !ownBlock.has(i - 1) && (STREET.test(lines[i - 1]) || /^[A-Za-zÀ-ÿ' .-]{4,} \d+\w?\b/.test(lines[i - 1])) && !dateIn(lines[i - 1])) street = lines[i - 1].split(/\s[·•|–]\s|\s-\s/).pop().trim();
    return { zip: m[1], city: m[2].trim(), address: street.replace(/[\s,;\-–]+$/, '') };
  }) || {};
  return { total, base, tax, rate, date, due, ref, vat, vatRaw, name, vatLine, iban, comm, bic: bicM ? bicM[1].toUpperCase() : null, email, phone, address: where.address || '', zip: where.zip || '', city: where.city || '' };
}

// ---------------------------------------------------------------- Réception Peppol automatique (point d'accès Peppyrus)
const peppolApOn = () => !!(S.settings.peppolap && S.settings.peppolap.hasKey);
let peppolSyncP = null;
async function peppolSync({ force = false, quiet = true } = {}) {
  if (!peppolApOn()) return null;
  const last = S.settings.peppol_sync && S.settings.peppol_sync.at;
  if (!force && last && Date.now() - new Date(last.replace(' ', 'T')).getTime() < 10 * 60 * 1000) return null;
  if (!peppolSyncP) peppolSyncP = api('POST', 'peppol/sync').then((r) => {
    S.settings.peppol_sync = { at: new Date().toISOString().slice(0, 19).replace('T', ' '), created: r.created.length };
    if (r.created.length) toast(`${r.created.length} facture(s) reçue(s) via Peppol ajoutée(s) aux achats`, 4000);
    else if (!quiet) toast(r.busy ? 'Relève déjà en cours' : 'Aucune nouvelle facture Peppol', 2500);
    if (r.errors && r.errors.length && !quiet) toast('Peppol : ' + r.errors[0], 6000);
    return r;
  }).catch((e) => { if (!quiet) toast(e.message, 6000); return null; }).finally(() => { peppolSyncP = null; });
  return peppolSyncP;
}
