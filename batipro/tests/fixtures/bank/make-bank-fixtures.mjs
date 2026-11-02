// Extraits bancaires 100 % FICTIFS pour les tests (aucune donnée réelle : noms, IBAN, montants inventés).
// Ils imitent la STRUCTURE des extraits Europabank (CODA), Belfius (PDF) et BNP Paribas Fortis (PDF).
// Usage : node tests/fixtures/bank/make-bank-fixtures.mjs   → écrit les fichiers à côté de ce script.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- IBAN et communications fictifs mais valides (clés justes)
const mod97 = (digits) => { let m = 0; for (const c of digits) m = (m * 10 + +c) % 97; return m; };
export function beIban(bank3, acc7) {
  const base = bank3 + acc7; const k = mod97(base) || 97; const bban = base + String(k).padStart(2, '0');
  const chk = 98 - mod97(bban + '111400'); // B=11 E=14 + 00
  return 'BE' + String(chk).padStart(2, '0') + bban;
}
export const comm = (ten) => { const k = mod97(ten) || 97; const d = ten + String(k).padStart(2, '0'); return `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}+++`; };
const sp = (iban) => iban.replace(/(.{4})/g, '$1 ').trim();

export const ACC = { europabank: beIban('671', '0000101'), belfius: beIban('068', '0000202'), bnp: beIban('001', '0000303') };
export const CP = { client: beIban('063', '1111111'), soustraitant: beIban('737', '2222222'), fournisseur: beIban('310', '3333333'), salarie: beIban('001', '4444444') };
export const COMM = { invoice: comm('0000012026'), expense: comm('0000099999') };

// ---------------------------------------------------------------- CODA (Europabank) – enregistrements de 128 caractères
const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
const num = (v, n) => String(v).padStart(n, '0').slice(-n);
const cents3 = (c) => num(Math.abs(c) * 10, 15); // 3 décimales
const sign = (c) => (c < 0 ? '1' : '0');
const d6 = (iso) => iso.slice(8, 10) + iso.slice(5, 7) + iso.slice(2, 4);
function codaStatement({ no, created, opening, openDate, closeDate, tx }) {
  const L = [];
  L.push(pad('0000' + '0' + d6(created) + '671' + '05' + pad('', 7) + pad('', 10) + pad('MADIBU TEST SRL', 26) + 'EURBBE99' + '   ' + '00000000000' + ' ' + '00000', 127) + '2');
  L.push(pad('12' + num(no, 3) + pad(ACC.europabank, 34) + 'EUR' + sign(opening) + cents3(opening) + d6(openDate) + pad('MADIBU TEST SRL', 26) + pad('COMPTE A VUE', 35) + num(no, 3), 128));
  tx.forEach((t, i) => {
    const seq = num(i + 1, 4);
    const commType = t.structured ? '1' : '0';
    const c = t.structured ? '101' + t.structured.replace(/\D/g, '') : t.text;
    L.push(pad('21' + seq + '0000' + pad('REF' + num(i + 1, 18), 21) + sign(t.amount) + cents3(t.amount) + d6(t.value || t.date) + num(t.code || '00101000', 8) + commType + pad(c, 53) + d6(t.date) + num(no, 3) + '0', 125) + '1 0');
    L.push(pad('22' + seq + '0000' + pad(t.text2 || '', 53), 125) + '1 0');
    L.push(pad('23' + seq + '0000' + pad(t.cp ? t.cp + ' EUR' : '', 37) + pad(t.name || '', 35) + pad('', 43), 125) + '0 0');
  });
  const closing = opening + tx.reduce((a, t) => a + t.amount, 0);
  L.push(pad('8' + num(no, 3) + pad(ACC.europabank, 34) + 'EUR' + sign(closing) + cents3(closing) + d6(closeDate), 127) + '0');
  const deb = -tx.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0); const cred = tx.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  L.push(pad('9' + pad('', 15) + num(L.length - 1, 6) + cents3(deb) + cents3(cred), 127) + '2');
  return { text: L.join('\r\n') + '\r\n', closing };
}
const winAnsi = (s) => Buffer.from(s, 'latin1');

// janvier : 1.000,00 → mouvements → solde
const jan = codaStatement({ no: 1, created: '2026-02-01', opening: 100000, openDate: '2025-12-31', closeDate: '2026-01-31', tx: [
  { date: '2026-01-02', amount: -700, text: 'Cotisation mensuelle pack' },
  { date: '2026-01-02', amount: -200, text: 'Cotisation mensuelle carte de débit no 9999****0001' },
  { date: '2026-01-15', amount: -10834, text: 'VOTRE PAIEMENT BANCONTACT D.D. 2026-01-15 07:03', text2: 'BRICO FICTIF 1000 BRUXELLES' },
  { date: '2026-01-21', amount: 100000, text: 'Virement entre comptes Madibu Test', cp: ACC.belfius, name: 'MADIBU TEST SRL' },
  { date: '2026-01-25', amount: 242000, structured: COMM.invoice, cp: CP.client, name: 'CLIENT FICTIF SA' },
] });
const feb = codaStatement({ no: 2, created: '2026-03-01', opening: jan.closing, openDate: '2026-01-31', closeDate: '2026-02-28', tx: [
  { date: '2026-02-02', amount: -700, text: 'Cotisation mensuelle pack' },
  { date: '2026-02-10', amount: -60500, structured: COMM.expense, cp: CP.fournisseur, name: 'FOURNISSEUR FICTIF SRL' },
] });
const mar = codaStatement({ no: 3, created: '2026-04-01', opening: feb.closing, openDate: '2026-02-28', closeDate: '2026-03-31', tx: [
  { date: '2026-03-02', amount: -700, text: 'Cotisation mensuelle pack' },
] });
writeFileSync(join(DIR, 'europabank-fictif-2026-01.cod'), winAnsi(jan.text));
writeFileSync(join(DIR, 'europabank-fictif-2026-02.cod'), winAnsi(feb.text));
writeFileSync(join(DIR, 'europabank-fictif-2026-03.cod'), winAnsi(mar.text));
// fichier altéré : un montant modifié sans toucher aux soldes → le contrôle des soldes doit bloquer l'import
writeFileSync(join(DIR, 'europabank-fictif-altere.cod'), winAnsi(jan.text.replace(cents3(-10834), cents3(-10934))));

// ---------------------------------------------------------------- PDF minimal (texte positionné, Helvetica, WinAnsi)
function pdf(pages) {
  const objs = []; const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const pagesId = objs.length + 1 + pages.length * 2; const kids = [];
  for (const items of pages) {
    const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
    const stream = items.map(([x, y, s, size = 8]) => `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(s)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
// une ligne de mots séparés (comme Belfius : un objet texte par mot)
const words = (x0, y, s, step = 5.4) => { const out = []; let x = x0; for (const w of s.split(' ')) { out.push([x, y, w]); x += w.length * step + 6; } return out; };

// ---------------------------------------------------------------- Belfius (fictif)
const BELF_HEAD = [...words(88.7, 811, 'Belfius Banque SA'), ...words(88.7, 806, 'Place Charles Rogier 11 - 1210 Bruxelles'), ...words(88.7, 801, 'IBAN: BE23 0529 0064 6991 - BIC: GKCCBEBB'),
  ...words(88.7, 796, 'RPM Bruxelles TVA BE 0403.201.185'), ...words(88.7, 786, 'Belfius Connect 02 222 12 01')];
const fmtA = (c, plus = true) => (c < 0 ? '-' : plus ? '+' : '') + (Math.abs(c) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 });
const belfTx = [
  { n: '0012', d: '06-01-2026', v: '05-01-2026', a: 242000, lines: [`VERSEMENT INSTANTANE DE ${sp(CP.client)} Client Fictif SA`, `${COMM.invoice} VERS ${sp(ACC.belfius)}`] },
  { n: '0013', d: '08-01-2026', v: '08-01-2026', a: -150000, split: true, lines: ['VIREMENT INSTANTANE BELFIUS MOBILE VERS', `${sp(CP.soustraitant)} Sous-Traitant Fictif Facture ST-2026-01`] },
  { n: '0014', d: '20-01-2026', v: '20-01-2026', a: -100000, lines: ['VIREMENT INSTANTANE BELFIUS MOBILE VERS', `${sp(ACC.europabank)} Madibu Test Virement entre comptes`] },
  { n: '0015', d: '20-01-2026', v: '20-01-2026', a: -2000, split: true, lines: ["FRAIS DE DOSSIER POUR LA LIVRAISON D'UNE ATTESTATION"] },
  { n: '0016', d: '20-01-2026', v: '20-01-2026', a: -50000, lines: ['VOTRE STRAIGHT LOAN DU 20/12/2025 AU 20/01/2026 - VOIR ANNEXE'] },
];
const belfOpen = 1000000; const belfClose = belfOpen + belfTx.reduce((a, t) => a + t.a, 0);
const belfP1 = [...BELF_HEAD, ...words(379.9, 744, 'BELFIUS BUSINESS ACCOUNT'), ...words(87.9, 709, 'MADIBU TEST SRL'), [385.8, 697, 'DATE'], [415.6, 697, ':'], [463.3, 697, '20-01-2026'],
  [385.8, 673, 'PAGE'], [415.6, 673, ':'], [499.1, 673, '12/1'],
  [87.9, 590, '-----------------'], ...words(201.1, 590, `${sp(ACC.belfius)} BIC: GKCCBEBB`), [415.6, 590, '------------------'],
  [87.9, 566, 'SOLDE'], [123.6, 566, 'AU'], [153.4, 566, '05-01-2026'], [332.2, 566, 'EUR'], [463.3, 566, fmtA(belfOpen)]];
let y = 542;
for (const t of belfTx) {
  belfP1.push([87.9, y, t.n], [123.6, y, t.d], [195.1, y, '(VAL.'], [230.9, y, t.v + ')']);
  if (t.split) belfP1.push([469.3, y, '-'], [487.2, y, fmtA(-t.a, false)]); else belfP1.push([463.3, y, fmtA(t.a)]);
  for (const l of t.lines) { y -= 12; belfP1.push(...words(99.8, y, l)); }
  y -= 24;
}
const belfP2 = [...BELF_HEAD, [272.6, 744, '20-01-2026'], [499.1, 744, '12/2'],
  [87.9, 91, 'SOLDE'], [123.6, 91, 'AU'], [153.4, 91, '20-01-2026'], [219, 91, '20:48'], [332.2, 91, 'EUR'], [457.4, 91, fmtA(belfClose)],
  ...words(87.9, 79, "TAUX D'INTERET DEBITEUR ANNUEL: 13,000%")];
const belfP3 = [...BELF_HEAD, [272.6, 744, '20-01-2026'], [499.1, 744, '12/3'], ...words(87.9, 709, 'ANNEXE AU MOUVEMENT 0016'), ...words(105.7, 566, 'MONTANT EN INTERETS : 500,00 EUR')];
writeFileSync(join(DIR, 'belfius-fictif.pdf'), pdf([belfP1, belfP2, belfP3]));

// ---------------------------------------------------------------- BNP Paribas Fortis (fictif) – opérations de la plus récente à la plus ancienne
const fmtB = (c) => (Math.abs(c) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + (c < 0 ? ' -' : '+');
const BNP_HEAD = (n, total) => [[42.5, 694, 'SRL MADIBU TEST'], [428.7, 677, `${sp(ACC.bnp)} EUR`], [475.5, 662, 'BIC GEBABEBB'], [42.5, 646, 'Flex Pro'], [457, 646, 'Extrait N° 2026 - 003'],
  [42.5, 30, 'P.DOC1.TEST.20260101'], [175.7, 30, 'BNP Paribas Fortis SA, Montagne du Parc 3, B-1000 Bruxelles'], [516, 30, `${n} / ${total}`], [175.7, 24, 'RPM Bruxelles - TVA BE0403.199.702.']];
const COLS = (yy) => [[442.2, yy + 9, 'Date'], [44.7, yy, 'N°'], [73.7, yy, "Type d'opération / description"], [305.4, yy, 'Contrepartie'], [442.2, yy, 'Valeur'], [497.2, yy, 'Montant (EUR)']];
const bnpTx = [ // du plus récent au plus ancien
  { day: '30-01-2026', n: '0031', type: 'Paiement par carte de débit', val: '30-01', a: -2420, desc: ['Numéro 9999 99XX XXXX 0001', 'QUINCAILLERIE FICTIVE', 'BRUXELLES', '30-01-2026 11:26', 'Bancontact', 'Référence banque : 2601301147000001'] },
  { day: '30-01-2026', n: '0030', type: 'Virement européen instantané via Easy Banking Business', val: '30-01', a: -50000, cp: [`${sp(ACC.belfius)} EUR`, 'GKCCBEBBXXX', 'Madibu Test'], desc: ["Date d'exécution : 30-01-2026", 'Communication : Virement entre comptes', 'Référence banque : 2601301215000002'] },
  { day: '27-01-2026', n: '0029', type: 'Virement en euros', val: '27-01', a: 1060000, cp: [`${sp(CP.client)} EUR`, 'GEBABEBB', 'CLIENT FICTIF SA', 'RUE DU TEST 1', '1000 BRUXELLES'], desc: ['Communication : Solde chantier rue du Test', 'Référence banque : 2601271101000003'] },
  { day: '27-01-2026', n: '0028', type: 'Remboursement crédit 245-0000000-01', val: '27-01', a: -78236, desc: ['De SRL MADIBU TEST', 'Référence banque : 2601270303000004'] },
  { day: '02-01-2026', n: '0027', type: 'Domiciliation européenne', val: '02-01', a: -25099, cp: ['TELECOM FICTIF'], desc: ['Numéro de mandat : B000000001', 'Référence : 4000000001', 'Communication : 000000000001', 'Référence banque : 2601020652000005'] },
  { day: '02-01-2026', n: '0026', type: 'Frais de gestion pour votre crédit 245-0000000-02', val: '01-01', a: -1500, desc: ['Référence banque : 2601020513000006'] },
];
const bnpOpen = 15532; const bnpClose = bnpOpen + bnpTx.reduce((a, t) => a + t.a, 0);
const bnpPages = [[], []];
const p1 = bnpPages[0]; p1.push(...BNP_HEAD(1, 3), [268.6, 615, 'Solde actuel au 30-01-2026'], [491.9, 615, fmtB(bnpClose)], [268.6, 594, 'Solde précédent au 31-12-2025'], [505.8, 594, fmtB(bnpOpen)], ...COLS(540));
let pg = p1; y = 511; let day = null; let page = 0;
for (const t of bnpTx) {
  if (y < 200 && page === 0) { page = 1; pg = bnpPages[1]; pg.push(...BNP_HEAD(2, 3), ...COLS(596)); y = 566; day = null; }
  if (t.day !== day) { pg.push([44.7, y, t.day]); y -= 19; day = t.day; }
  pg.push([44.7, y, t.n], [73.7, y, t.type], ...(t.cp ? [[305.4, y, t.cp[0]]] : []), [442.2, y, t.val], [t.a <= -100000 || t.a >= 100000 ? 511.5 : 522.6, y, fmtB(t.a)]);
  const n = Math.max(t.desc.length, (t.cp || []).length - 1);
  for (let i = 0; i < n; i++) { y -= 10; if (t.desc[i]) pg.push([73.7, y, t.desc[i]]); if (t.cp && t.cp[i + 1]) pg.push([305.4, y, t.cp[i + 1]]); }
  y -= 10; pg.push([42.7, y, '.'.repeat(120)]); y -= 14;
}
bnpPages[1].push([268.6, y - 20, 'Solde précédent au 31-12-2025'], [505.8, y - 20, fmtB(bnpOpen)]);
bnpPages.push([...BNP_HEAD(3, 3), [75.9, 614, 'AVIS DE DEBIT'], [232.5, 614, 'DETAIL DE VIREMENT EN EUROS'], [478.5, 614, '30-01-2026'], [75.9, 594, 'Montant'], [165.8, 594, ': EUR'], [198.4, 594, '-500,00'],
  [75.9, 585, 'Compte bénéficiaire'], [165.8, 585, `: ${ACC.belfius} EUR`]]);
writeFileSync(join(DIR, 'bnp-fictif.pdf'), pdf(bnpPages));

// ---------------------------------------------------------------- Tableurs (fictifs) : CSV façon export BNP, Excel façon export Belfius
// mêmes lignes « normalisées » que celles produites par le navigateur (assets/pilotage.js : pilSheetRows)
import { createRequire } from 'node:module';
const XLSX = createRequire(import.meta.url)('../../../assets/vendor/xlsx-0.18.5.full.min.js');
export const normCell = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '').trim());
const bnpCsvTx = [ // du plus récent au plus ancien, comme l'export de la banque en ligne
  ['0036', '27/02/2026', '27/02/2026', '-1.200,00', 'EUR', ACC.bnp, 'Virement en euros', sp(CP.salarie), 'OUVRIER FICTIF', 'Salaire février', 'Accepté'],
  ['0035', '20/02/2026', '20/02/2026', '4.840,00', 'EUR', ACC.bnp, 'Virement en euros', sp(CP.client), 'CLIENT FICTIF SA', COMM.invoice, 'Accepté'],
  ['0034', '05/02/2026', '05/02/2026', '-782,36', 'EUR', ACC.bnp, 'Remboursement crédit', '', '', 'Remboursement crédit 245-0000000-01', 'Accepté'],
];
const csvHead = ['Numéro de séquence', "Date d'exécution", 'Date valeur', 'Montant', 'Devise du compte', 'Numéro de compte', 'Type de transaction', 'Contrepartie', 'Nom de la contrepartie', 'Communication', 'Statut'];
writeFileSync(join(DIR, 'bnp-fictif-2026-02.csv'), Buffer.from([csvHead, ...bnpCsvTx].map((r) => r.map((c) => (/[;"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n') + '\r\n', 'latin1'));
const bnpFeb = { opening: bnpClose, closing: bnpClose - 120000 + 484000 - 78236, n: 3 };
const belfX = [['Compte', 'Date de comptabilisation', 'Numéro de transaction', 'Compte contrepartie', 'Nom contrepartie contient', 'Transaction', 'Date valeur', 'Montant', 'Devise', 'Communications', 'Solde']];
let solde = belfClose;
for (const [d, n, cp, name, label, amt, comm] of [
  [new Date(2026, 0, 26), 17, CP.fournisseur, 'FOURNISSEUR FICTIF SRL', 'VIREMENT', -605, COMM.expense],
  [new Date(2026, 1, 3), 18, CP.client, 'CLIENT FICTIF SA', 'VERSEMENT', 1815, 'Acompte chantier rue du Test'],
  [new Date(2026, 1, 12), 19, '', '', 'FRAIS', -12.5, 'FRAIS DE TENUE DE COMPTE'],
]) { solde += Math.round(amt * 100); belfX.push([sp(ACC.belfius), d, n, cp ? sp(cp) : '', name, label, d, amt, 'EUR', comm, solde / 100]); }
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(belfX, { cellDates: true }), 'Mouvements');
const xbuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync(join(DIR, 'belfius-fictif-2026-02.xlsx'), xbuf);
const rb = XLSX.read(xbuf, { type: 'buffer', cellDates: true });
writeFileSync(join(DIR, 'belfius-fictif-2026-02.rows.json'), JSON.stringify(XLSX.utils.sheet_to_json(rb.Sheets[rb.SheetNames[0]], { header: 1, raw: true, defval: '' }).map((r) => r.map(normCell))));
const belfFeb = { opening: belfClose, closing: solde, n: 3 };

writeFileSync(join(DIR, 'expected.json'), JSON.stringify({ ACC, CP, COMM, bnpFeb, belfFeb,
  europabank: { jan: { opening: 100000, closing: jan.closing, n: 5 }, feb: { opening: jan.closing, closing: feb.closing, n: 2 }, mar: { opening: feb.closing, closing: mar.closing, n: 1 } },
  belfius: { number: 12, opening: belfOpen, closing: belfClose, n: belfTx.length },
  bnp: { number: 3, opening: bnpOpen, closing: bnpClose, n: bnpTx.length } }, null, 2) + '\n');
console.log('Extraits fictifs écrits dans', DIR);
