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

// Éditeur de répartition dans la fiche d'achat
function allocEditor(form, { projects, alloc, amountField, projectField, category }) {
  const box = $('[data-alloc]', form);
  const pOpts = (sel) => `<option value="">— frais généraux —</option>${projects.map((p) => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(`${p.number} · ${p.data.name}`)}</option>`).join('')}`;
  const tOpts = (sel) => Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const total = () => num(amountField.value);
  const draw = () => {
    const on = $('[data-split]', box).checked;
    projectField.closest('.field').style.display = on ? 'none' : '';
    $('[data-rows]', box).innerHTML = on ? alloc.map((a, i) => `<div class="alloc-row" data-i="${i}">
      <select data-k="pid" aria-label="Chantier">${pOpts(a.pid)}</select>
      <input data-k="amount" inputmode="decimal" placeholder="Montant HT" value="${a.amount === '' || a.amount == null ? '' : fnum(num(a.amount))}" aria-label="Montant HT">
      <select data-k="category" aria-label="Type de coût">${tOpts(a.category || category())}</select>
      <button type="button" class="btn sm" data-rest="${i}" title="Mettre le reste ici">= reste</button>
      <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Retirer">✕</button></div>`).join('') : '';
    $('[data-addrow]', box).hidden = !on;
    rest();
    $$('.alloc-row', box).forEach((row) => {
      const i = +row.dataset.i;
      $$('[data-k]', row).forEach((inp) => { inp.oninput = inp.onchange = () => { alloc[i][inp.dataset.k] = inp.dataset.k === 'amount' ? inp.value : inp.value; rest(); }; });
      $('[data-rm]', row).onclick = () => { alloc.splice(i, 1); if (!alloc.length) $('[data-split]', box).checked = false; draw(); };
      $('[data-rest]', row).onclick = () => { const r = total() - alloc.reduce((s, a, j) => s + (j === i ? 0 : num(a.amount)), 0); alloc[i].amount = r2(r); draw(); };
    });
  };
  const rest = () => {
    const el = $('[data-restinfo]', box);
    if (!$('[data-split]', box).checked) { el.textContent = ''; return; }
    const r = r2(total() - alloc.reduce((s, a) => s + num(a.amount), 0));
    el.className = Math.abs(r) < 0.01 ? 'good' : 'late';
    el.textContent = Math.abs(r) < 0.01 ? `Réparti : ${money(total())} ✓` : `Reste à répartir : ${money(r)}`;
  };
  $('[data-split]', box).onchange = () => {
    if ($('[data-split]', box).checked && !alloc.length) alloc.push({ pid: projectField.value, amount: total() || '', category: category() }, { pid: '', amount: '', category: category() });
    draw();
  };
  $('[data-addrow]', box).onclick = () => { alloc.push({ pid: '', amount: '', category: category() }); draw(); };
  amountField.addEventListener('input', rest);
  draw();
  // valeur finale (lève une erreur si la répartition ne tombe pas juste)
  return () => {
    if (!$('[data-split]', box).checked) return null;
    const rows = alloc.filter((a) => num(a.amount) !== 0).map((a) => ({ pid: a.pid ? +a.pid : null, amount: r2(num(a.amount)), category: a.category || category() }));
    const r = r2(total() - rows.reduce((s, a) => s + a.amount, 0));
    if (Math.abs(r) >= 0.01) throw new Error(`la répartition ne correspond pas au montant HT (reste ${money(r)})`);
    return rows;
  };
}

// ---------------------------------------------------------------- Import d'une facture fournisseur : PDF, XML (UBL / Peppol) ou photo
async function importPurchase(projectId) {
  const [file] = await pickFile('.pdf,.xml,application/pdf,application/xml,text/xml,image/*');
  if (!file) return;
  toast('Lecture de la facture…', 20000);
  try {
    const preset = await purchasePreset(file, projectId);
    toast(preset.readNote ? 'Facture lue – vérifiez les montants' : 'Fichier joint', 2500);
    editExpense(null, preset);
  } catch (e) { console.error(e); toast('Lecture impossible : ' + e.message, 6000); }
}

async function purchasePreset(file, projectId) {
  const base = { project_id: projectId || '', date: today(), category: 'mat', vat: defVat() };
  const isXml = /\.xml$/i.test(file.name) || /xml/.test(file.type);
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (isXml) {
    const u = parseUBL(await file.text());
    return { ...base, ...(await presetFromUBL(u, null, projectId)), readNote: `Facture électronique ${u.number} lue (Peppol / UBL).` };
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
      for (let i = 1; i <= Math.min(doc.numPages, 4); i++) text += pdfLines(await (await doc.getPage(i)).getTextContent()) + '\n';
    } catch (e) { console.warn('pdf', e); }
    const g = parseInvoiceText(text);
    const contacts = await db.list('contact');
    const sup = g.vat ? contacts.find((c) => digitsOf(c.data.vat) && digitsOf(c.data.vat) === g.vat) : null;
    const hasTxt = text.replace(/\s/g, '').length > 30;
    return { ...base, fileId: up.id, fileName: up.name, desc: g.ref ? `Facture ${g.ref}` : file.name.replace(/\.pdf$/i, ''), ref: g.ref || '', date: g.date || today(), due: g.due || '',
      ...(g.base != null ? { amount: g.base } : {}), ...(g.rate != null ? { vat: g.rate } : {}), ...(g.tax != null ? { vatAmount: g.tax } : {}),
      supplierId: sup ? sup.id : '', supplierGuess: !sup && (g.name || g.vat) ? { name: g.name, vat: g.vatRaw } : null,
      readNote: hasTxt ? `Lu dans le PDF : ${[g.ref && 'n° ' + g.ref, g.date && 'date', g.total != null && 'total ' + money(g.total), g.vatRaw && 'TVA ' + g.vatRaw].filter(Boolean).join(' · ') || 'peu d\'informations reconnues'}. Vérifiez les montants.` : 'PDF scanné (image) : complétez les montants à la main.' };
  }
  const up = file.type.startsWith('image/') ? await uploadPhoto(file, projectId) : await upload(file, projectId);
  return { ...base, fileId: up.id, fileName: up.name, desc: '', readNote: '' };
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
    amount: r2(u.base), vat: Math.abs(near - rate) < 0.3 ? near : rate, vatAmount: r2(u.tax), peppol: true, fileId, fileName,
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
    row.parts.push({ x, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n');
}

// Reconnaissance des informations principales d'une facture (FR / NL / EN)
function parseInvoiceText(text) {
  const lines = String(text || '').replace(/ | /g, ' ').split('\n').map((s) => s.trim()).filter(Boolean);
  const AM = /(?<![\d.,])(-?\d{1,3}(?:[ .,']?\d{3})*[.,]\d{2})(?![\d])/g;
  // « 1.234,56 », « 1 234,56 », « 1,234.56 » : les 2 derniers chiffres sont toujours les décimales
  const amt = (s) => { s = s.replace(/[\s']/g, ''); return parseFloat(`${s.slice(0, -3).replace(/[.,]/g, '')}.${s.slice(-2)}`); };
  const amounts = (s) => [...s.matchAll(AM)].map((m) => amt(m[1]));
  const RE_TOTAL = /(total|totaal|montant|net)\s*(t\.?t\.?c|tvac|t\.v\.a\.c|incl|à\s*payer|a\s*payer|te\s*betalen|g[ée]n[ée]ral|due|ttc)|net\s*à\s*payer|à\s*payer|a\s*payer|te\s*betalen|amount\s*due|total\s*due/i;
  const RE_BASE = /(total|totaal|montant|sous[- ]?total|subtotaal|subtotal|base|maatstaf|net)\s*(h\.?\s?t\.?\s?v?\.?a?\.?\b|hors\s*t|htva|excl|imposable|van\s*heffing|maatstaf|net\b)|sous[- ]?total|subtotaal|subtotal|total\s*net/i;
  const RE_TAX = /\b(t\.?v\.?a\.?|btw|vat|mwst)\b(?!\s*(n[°º]|nr|num|number|nummer|:?\s*[a-z]{2}\s?\d{4}))/i;
  const pick = (re, not = []) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!re.test(l) || not.some((n) => n.test(l))) continue;
      let a = amounts(l); if (!a.length && lines[i + 1]) a = amounts(lines[i + 1]);
      if (a.length) return Math.abs(a[a.length - 1]);
    }
    return null;
  };
  let total = pick(RE_TOTAL); let base = pick(RE_BASE, [RE_TOTAL]); let tax = pick(RE_TAX, [RE_TOTAL, RE_BASE]);
  if (base != null && total != null && base > total) [base, total] = [total, base];
  if (total != null && base != null && (tax == null || Math.abs(base + tax - total) > 0.05)) tax = r2(total - base);
  else if (total != null && tax != null && base == null) base = r2(total - tax);
  else if (base != null && tax != null && total == null) total = r2(base + tax);
  else if (total != null && base == null) { const v = defVat(); base = r2(total / (1 + v / 100)); tax = r2(total - base); }
  let rate = null;
  if (base && tax != null) { const r = (tax / base) * 100; const near = vatList().reduce((best, x) => (Math.abs(x - r) < Math.abs(best - r) ? x : best), vatList()[0]); rate = Math.abs(near - r) < 0.6 ? near : r2(r); }
  // dates
  const MONTHS = { janv: 1, jan: 1, janvier: 1, januari: 1, fevr: 2, févr: 2, fév: 2, feb: 2, février: 2, februari: 2, mars: 3, maart: 3, mar: 3, avr: 4, avril: 4, april: 4, apr: 4, mai: 5, mei: 5, may: 5, juin: 6, juni: 6, jun: 6, juil: 7, juillet: 7, juli: 7, jul: 7, août: 8, aout: 8, augustus: 8, aug: 8, sept: 9, septembre: 9, september: 9, sep: 9, oct: 10, octobre: 10, oktober: 10, okt: 10, nov: 11, novembre: 11, november: 11, déc: 12, dec: 12, décembre: 12, decembre: 12, december: 12 };
  const dateIn = (s) => {
    let m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/);
    if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
    m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.toLowerCase().match(/\b(\d{1,2})\s+([a-zéûô]{3,9})\.?\s+(\d{4})\b/); if (m && MONTHS[m[2]]) return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    return null;
  };
  const RE_DUE = /[ée]ch[ée]ance|vervaldag|vervaldatum|due\s*date|payable\s*(avant|le)|à\s*payer\s*(avant|pour)|uiterste|betaaldatum/i;
  let due = null; let date = null;
  for (let i = 0; i < lines.length; i++) {
    const d = dateIn(lines[i]) || (/(date|datum)\s*:?\s*$/i.test(lines[i]) && lines[i + 1] ? dateIn(lines[i + 1]) : null);
    if (!d) continue;
    if (RE_DUE.test(lines[i])) { if (!due) due = d; } else if (/date|datum|le\s|du\s/i.test(lines[i]) && !date) date = d;
  }
  if (!date) for (const l of lines) { const d = dateIn(l); if (d && !RE_DUE.test(l)) { date = d; break; } }
  // numéro de facture
  let ref = null;
  for (let i = 0; i < lines.length && !ref; i++) {
    const m = lines[i].match(/(?:facture|factuur|invoice|rechnung|note\s+de\s+cr[ée]dit|creditnota)\s*(?:n[°ºo]\.?|nr\.?|no\.?|num[ée]ro|nummer|number|#)?\s*:?\s*([A-Z0-9][A-Z0-9\-\/._]{2,30})/i);
    if (m && /\d/.test(m[1])) ref = m[1];
    else if (/^(facture|factuur|invoice)?\s*(n[°º]|nr|num[ée]ro|nummer)\.?\s*:?\s*$/i.test(lines[i]) && lines[i + 1] && /^[A-Z0-9][A-Z0-9\-\/._]{2,30}$/i.test(lines[i + 1]) && /\d/.test(lines[i + 1])) ref = lines[i + 1];
  }
  // n° de TVA du fournisseur (différent du nôtre)
  const own = digitsOf(company().vat);
  let vat = null; let vatRaw = null; let vatLine = -1;
  lines.forEach((l, i) => { for (const m of l.matchAll(/\b(BE|LU|NL|FR|DE)\s?[-.]?\s?(\d[\d .]{7,14}\d)\b/gi)) { const dg = digitsOf(m[2]); if (!vat && dg.length >= 8 && dg !== own) { vat = dg; vatRaw = (m[1] + m[2].replace(/\D/g, '')).toUpperCase(); vatLine = i; } } });
  // nom probable du fournisseur : première ligne « société » du document
  const coName = (company().name || '').toLowerCase();
  const name = lines.slice(0, 12).find((l) => /[a-z]{3}/i.test(l) && l.length <= 60 && !/factu|invoice|date|page|tél|tel\b|@|www|^\d|iban|tva|btw|vat|rue|straat|avenue|chaussée|^n[°º]/i.test(l) && (!coName || !l.toLowerCase().includes(coName))) || '';
  return { total, base, tax, rate, date, due, ref, vat, vatRaw, name, vatLine };
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
