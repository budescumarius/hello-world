'use strict';
/* Import de fichiers Excel / CSV / ODS : lignes de devis (chapitres, sous-chapitres, lignes) et liste de contacts. */

let xlsxP;
function loadXLSX() {
  if (!xlsxP) xlsxP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/xlsx-0.18.5.full.min.js';
    s.onload = () => res(window.XLSX);
    s.onerror = () => { xlsxP = null; rej(new Error('Impossible de charger le lecteur Excel')); };
    document.head.appendChild(s);
  });
  return xlsxP;
}
// Renvoie { feuille: lignes[][] }
// Lit le contenu du fichier tout de suite (avant tout chargement), avec FileReader en secours
function readBytes(file) {
  const viaReader = () => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
  return file.arrayBuffer().catch(viaReader).catch((e) => {
    const err = new Error("le navigateur n'a pas pu lire le fichier. Fermez-le dans Excel, ou s'il se trouve dans OneDrive / iCloud / Google Drive, copiez-le d'abord sur le Bureau (ou dans Téléchargements), puis réessayez.");
    err.cause = e; throw err;
  });
}
async function readSheets(file, bytes) {
  const buf = bytes || await readBytes(file);
  const X = await loadXLSX();
  const wb = X.read(buf, { type: 'array', cellDates: false });
  const out = {};
  for (const name of wb.SheetNames) {
    const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
    out[name] = rows.map((r) => r.map((c) => (typeof c === 'string' ? c.trim() : c)));
  }
  return out;
}
// Nombre au format belge / français / anglais : « 1.500,00 € », « 1 500.5 », « 6% »
function xnum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[€\s  %]/g, '').replace(/EUR/i, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  // « 27 euro/m² », « offre », « supprimé » : pas un nombre
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  return parseFloat(s);
}
const has = (v) => v !== '' && v != null && !(typeof v === 'number' && isNaN(v));

// Assistant : choix de la feuille, de la ligne d'en-tête et des colonnes. fields : [{ key, label, syn: [...] }]
async function importWizard({ title, fields, file, bytes }) {
  const bytesP = bytes || readBytes(file);
  let sheets;
  try { toast('Lecture du fichier…', 15000); sheets = await readSheets(file, await bytesP); toast('Fichier lu', 800); } catch (e) { toast('Lecture impossible : ' + e.message, 9000); return null; }
  const names = Object.keys(sheets).filter((n) => sheets[n].length);
  if (!names.length) { toast('Le fichier est vide'); return null; }
  const score = (row) => fields.reduce((a, f) => a + (row.some((c) => f.syn.includes(normKey(c))) ? 1 : 0), 0);
  const guessHeader = (rows) => { let best = 0; let bi = 0; rows.slice(0, 30).forEach((r, i) => { const s = score(r); if (s > best) { best = s; bi = i; } }); return best >= 2 ? bi : -1; };
  return new Promise((resolve) => {
    let done = false;
    const st = { sheet: names[0], header: guessHeader(sheets[names[0]]), map: {} };
    const m = modal(`${mhead(title)}<div class="m-body" data-b></div><div class="m-foot"><span class="muted" data-info></span><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Continuer</button></div>`, { wide: true, onClose: () => { if (!done) resolve(null); } });
    const autoMap = () => {
      const hdr = st.header >= 0 ? sheets[st.sheet][st.header] : [];
      st.map = {};
      fields.forEach((f) => { const i = hdr.findIndex((c) => f.syn.length && f.syn.includes(normKey(c)) && !Object.values(st.map).includes(hdr.indexOf(c))); st.map[f.key] = i; });
      if (fields.some((f) => f.key === 'desc2')) guessText();
    };
    // métrés sans en-tête sur les colonnes de texte : N° (1., 1.1…) et colonnes de désignation devinés d'après le contenu
    const guessText = () => {
      const data = sheets[st.sheet].slice(st.header + 1, st.header + 300);
      const used = new Set(Object.values(st.map).filter((i) => i >= 0));
      const ncol = Math.max(...data.map((r) => r.length), 0);
      const cnt = (i, re) => data.filter((r) => re.test(String(r[i] ?? '').trim())).length;
      if (st.map.no < 0) { for (let i = 0; i < ncol; i++) if (!used.has(i) && cnt(i, /^\d+(\.\d+)*\.?$/) >= 3) { st.map.no = i; used.add(i); break; } }
      if (st.map.unit < 0) { for (let i = 0; i < ncol; i++) if (!used.has(i) && cnt(i, /^(m|m2|m²|m3|m³|ml|mct|pce|pc|pcs|p|u|un|h|kg|t|l|ff|fft|forfait|ens|st|stuk)$/i) >= 3) { st.map.unit = i; used.add(i); break; } }
      const text = []; for (let i = 0; i < ncol; i++) if (!used.has(i)) { const n = cnt(i, /^(?=.{8,})(?=.*[A-Za-zÀ-ÿ]{3})/); if (n >= 3) text.push([i, n]); }
      if (st.map.desc >= 0) { used.delete(st.map.desc); text.push([st.map.desc, Infinity]); }
      const best = Math.max(0, ...text.map((x) => (x[1] === Infinity ? 0 : x[1])));
      const cols = text.filter((x) => x[1] === Infinity || x[1] >= Math.max(3, best * 0.15)).map((x) => x[0]).sort((a, b) => a - b).slice(0, 3);
      if (cols.length) { st.map.desc = cols[0]; st.map.desc2 = cols[1] ?? -1; st.map.desc3 = cols[2] ?? -1; }
    };
    const draw = () => {
      const rows = sheets[st.sheet];
      const hdr = st.header >= 0 ? rows[st.header] : [];
      const ncol = Math.max(...rows.slice(0, 50).map((r) => r.length), 1);
      const colName = (i) => `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}${hdr[i] ? ' – ' + String(hdr[i]).slice(0, 30) : ''}`;
      const body = rows.slice(st.header + 1, st.header + 9);
      $('[data-b]', m.el).innerHTML = `<div class="grid-form">
          ${names.length > 1 ? fieldHTML({ name: 'sheet', label: 'Feuille', type: 'select', options: names.map((n) => [n, n]) }, st.sheet) : ''}
          ${fieldHTML({ name: 'header', label: 'Ligne des en-têtes', type: 'select', options: [[-1, 'Aucune (pas d\'en-têtes)'], ...rows.slice(0, 30).map((r, i) => [i, `Ligne ${i + 1} : ${r.filter(has).slice(0, 5).join(' | ').slice(0, 70)}`])] }, st.header)}
        </div>
        <div class="section-t">Correspondance des colonnes</div>
        <div class="grid-form map-grid">${fields.map((f) => fieldHTML({ name: 'm_' + f.key, label: f.label, type: 'select', options: [[-1, '— ignorer —'], ...Array.from({ length: ncol }, (_, i) => [i, colName(i)])] }, st.map[f.key] ?? -1)).join('')}</div>
        <div class="section-t">Aperçu</div>
        <div class="dt-body"><table class="dt"><thead><tr>${fields.filter((f) => st.map[f.key] >= 0).map((f) => `<th>${esc(f.label)}</th>`).join('')}</tr></thead>
          <tbody>${body.map((r) => `<tr>${fields.filter((f) => st.map[f.key] >= 0).map((f) => `<td>${esc(String(r[st.map[f.key]] ?? '').slice(0, 60))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $('[data-info]', m.el).textContent = `${rows.length - st.header - 1} ligne(s) de données`;
      const sh = $('[name=sheet]', m.el); if (sh) sh.onchange = () => { st.sheet = sh.value; st.header = guessHeader(sheets[st.sheet]); autoMap(); draw(); };
      $('[name=header]', m.el).onchange = (e) => { st.header = +e.target.value; autoMap(); draw(); };
      fields.forEach((f) => { $(`[name=m_${f.key}]`, m.el).onchange = (e) => { st.map[f.key] = +e.target.value; draw(); }; });
    };
    autoMap(); draw();
    $('[data-ok]', m.el).onclick = () => {
      const rows = sheets[st.sheet].slice(st.header + 1);
      const objs = rows.map((r) => Object.fromEntries(fields.map((f) => [f.key, st.map[f.key] >= 0 ? r[st.map[f.key]] : ''])));
      done = true; m.close(); resolve({ rows: objs, fileName: file.name });
    };
  });
}

// ---------------------------------------------------------------- Lignes de devis depuis Excel
const QUOTE_FIELDS = [
  { key: 'no', label: 'N°', syn: ['n', 'no', 'num', 'numero', 'nr', 'pos', 'poste', 'ref', 'reference', 'art', 'article'] },
  { key: 'desc', label: 'Désignation', syn: ['description', 'designation', 'libelle', 'intitule', 'omschrijving', 'denumire', 'descriere', 'travaux', 'prestation', 'objet'] },
  { key: 'desc2', label: 'Désignation – 2e colonne', syn: ['detail', 'details', 'precision', 'sousposte', 'complement'] },
  { key: 'desc3', label: 'Désignation – 3e colonne', syn: [] },
  { key: 'tm', label: 'Type de marché (QF, QP, FT…)', syn: ['code', 'tm', 'typemarche', 'typedemarche', 'marche', 'nature', 'aard', 'type'] },
  { key: 'qty', label: 'Quantité', syn: ['qte', 'qt', 'qty', 'quantite', 'quantity', 'hoeveelheid', 'aantal', 'cantitate', 'cant', 'qteprevu'] },
  { key: 'unit', label: 'Unité', syn: ['u', 'un', 'unite', 'unit', 'eenheid', 'um'] },
  { key: 'price', label: 'Prix unitaire HT', syn: ['pu', 'pue', 'puht', 'prixunitaire', 'prixunitaireht', 'prix', 'eenheidsprijs', 'pret', 'pretunitar', 'unitprice', 'puhtva'] },
  { key: 'total', label: 'Total HT', syn: ['total', 'totalht', 'montant', 'montantht', 'totaal', 'valoare', 'prixtotal', 'prix', 'bedrag'] },
  { key: 'chap', label: 'Sous-total des chapitres (contrôle)', syn: ['soustotal', 'totalchapitre', 'subtotal', 'subtotaal'] },
  { key: 'vat', label: 'TVA %', syn: ['tva', 'btw', 'vat', 'tauxtva', 'tvaht'] },
  { key: 'cost', label: 'Déboursé unitaire', syn: ['debourse', 'cout', 'coutunitaire', 'prixachat', 'cost', 'kost'] },
];
// Classe chaque ligne : chapitre (1), sous-chapitre (2), ligne, texte ou ignorée
function classifyRows(rows) {
  // avec une colonne N° remplie, une ligne sans numéro ni prix continue le texte de la ligne précédente
  const numbered = rows.some((r) => String(r.no ?? '').trim());
  return rows.map((r) => {
    const desc = [r.desc, r.desc2, r.desc3].map((v) => String(v ?? '').trim()).filter(Boolean).join(' – ');
    const no = String(r.no ?? '').trim();
    const qty = xnum(r.qty); const price = xnum(r.price); const total = xnum(r.total);
    if (!desc && !has(qty) && !has(price)) return { kind: 'skip', desc, no };
    if (/^(sous[- ]?)?total|^tva\b|^total\s*(ht|ttc|tvac)|^montant total|^remise|^acompte/i.test(desc) && !has(qty)) return { kind: 'skip', desc, no };
    const isItem = (has(qty) && qty !== 0) || has(price);
    if (isItem) return { kind: 'item', desc, no, qty, price, total, unit: String(r.unit ?? '').trim(), vat: xnum(r.vat), cost: xnum(r.cost), tm: String(r.tm ?? '').trim().toUpperCase().slice(0, 6) };
    if (numbered && !no && !has(total)) return { kind: 'cont', desc, no };
    const parts = no.split(/[.\s]/).filter((x) => x !== '');
    while (parts.length > 1 && /^0+$/.test(parts[parts.length - 1])) parts.pop();
    if (/^\d+(\.\d+)*[a-z]?\.?$/i.test(no) && parts.length) return { kind: parts.length >= 2 ? 'sub' : 'title', desc, no, total, chap: xnum(r.chap) };
    if (desc.length <= 70 && !/[.;:]$/.test(desc)) return { kind: 'title', desc, no, total };
    return { kind: 'text', desc, no };
  });
}
async function importLinesExcel(onLines) {
  const [file] = await pickFile('.xlsx,.xls,.xlsm,.ods,.csv');
  if (!file) return;
  const bytes = readBytes(file);
  bytes.catch(() => {});
  const res = await importWizard({ title: `Importer des lignes – ${file.name}`, fields: QUOTE_FIELDS, file, bytes });
  if (!res) return;
  const cls = classifyRows(res.rows).filter((x) => x.kind !== 'skip' || x.desc);
  if (!cls.length) return toast('Aucune ligne reconnue');
  const KL = [['title', 'Chapitre'], ['sub', 'Sous-chapitre'], ['item', 'Ligne'], ['cont', 'Suite du texte'], ['text', 'Texte'], ['skip', 'Ignorer']];
  const m = modal(`${mhead('Vérifier l\'import')}<div class="m-body">
    <p class="muted">Vérifiez la nature de chaque ligne (chapitre, sous-chapitre, ligne chiffrée, texte) avant l'import. « Suite du texte » est ajouté à la description de la ligne au-dessus. Les lignes de totaux sont ignorées automatiquement.</p>
    <div class="grid-form">${fieldHTML({ name: 'vat', label: 'TVA si la colonne est absente ou vide', type: 'select', options: vatOptions(defVat()) }, defVat())}${fieldHTML({ name: 'type', label: 'Type de déboursé par défaut', type: 'select', options: optsOf(TYPES) }, 'divers')}</div>
    <div data-warn></div>
    <div class="dt-body"><table class="dt imp"><thead><tr><th>Type</th><th>N°</th><th>Désignation</th><th>TM</th><th class="r">Qté</th><th>U</th><th class="r">PU HT</th><th class="r">Total HT</th><th class="r">Calculé</th></tr></thead><tbody>
    ${cls.map((x, i) => `<tr class="k-${x.kind}" data-row="${i}"><td><select data-k="${i}">${KL.map(([k, l]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td>${esc(x.no)}</td><td>${esc(x.desc.slice(0, 120))}</td><td>${esc(x.tm || '')}</td>
      <td class="r">${has(x.qty) ? fnum(x.qty, 3) : ''}</td><td>${esc(x.unit || '')}</td><td class="r">${has(x.price) ? money(x.price) : ''}</td><td class="r">${has(x.total) ? money(x.total) : ''}</td><td class="r" data-calc="${i}"></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="m-foot"><span class="muted" data-sum></span><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Importer</button></div>`, { wide: true });
  const build = () => {
    const vat = num($('[name=vat]', m.el).value); const type = $('[name=type]', m.el).value;
    const lines = [];
    const fill = $('[data-fill]', m.el); const addFill = fill && fill.checked;
    // chapitre dont le sous-total Excel n'est pas couvert par ses lignes (ex. « estimation » saisie directement) : ligne forfaitaire de l'écart
    const closeChap = () => { const c = curChap; if (!c || !addFill || !(c.gap > 0.05)) return; lines.push({ id: lid(), kind: 'item', desc: `${c.desc} – montant repris du métré (forfait)`, unit: 'forfait', qty: 1, price: r2(c.gap), cost: '', vat: num($('[name=vat]', m.el).value), type: $('[name=type]', m.el).value }); };
    let curChap = null;
    for (const x of cls) {
      if (x.kind === 'title') { closeChap(); curChap = chapGaps.find((g) => g.x === x) || null; }
      if (x.kind === 'skip') continue;
      // suite : ajoutée à la ligne ou au texte précédent (après un chapitre : nouveau texte)
      if (x.kind === 'cont') {
        const prev = lines[lines.length - 1];
        if (prev && (prev.kind === 'item' || prev.kind === 'text')) prev.desc += '\n' + x.desc;
        else lines.push({ id: lid(), kind: 'text', desc: x.desc });
        continue;
      }
      if (x.kind === 'title' || x.kind === 'sub') { lines.push({ id: lid(), kind: 'title', ...(x.kind === 'sub' ? { level: 2 } : {}), desc: x.desc }); continue; }
      if (x.kind === 'text') { lines.push({ id: lid(), kind: 'text', desc: x.desc }); continue; }
      // sans quantité : déduite du total Excel (total 0 = ligne barrée / supprimée → quantité 0)
      let qty = has(x.qty) ? x.qty : (has(x.total) && has(x.price) ? (x.price ? r2(x.total / x.price * 1000) / 1000 : 0) : 1); let price = has(x.price) ? x.price : NaN;
      if (!has(price) && has(x.total)) price = qty ? r2(x.total / qty * 10000) / 10000 : x.total;
      let v = has(x.vat) ? x.vat : vat; if (v > 0 && v < 1) v = r2(v * 100);
      lines.push({ id: lid(), _src: cls.indexOf(x), kind: 'item', desc: x.desc, ...(x.tm ? { tm: x.tm } : {}), unit: x.unit || 'u', qty, price: has(price) ? price : 0, cost: has(x.cost) ? x.cost : '', vat: v, type });
    }
    closeChap();
    return lines;
  };
  // écarts par chapitre entre le sous-total Excel et les lignes importées
  let chapGaps = [];
  const checkChaps = () => {
    chapGaps = []; let cur = null;
    cls.forEach((x) => {
      if (x.kind === 'title') { cur = has(x.chap) ? { x, desc: x.desc, excel: x.chap, got: 0 } : null; if (cur) chapGaps.push(cur); return; }
      if (cur && x.kind === 'item') {
        const q = has(x.qty) ? x.qty : (has(x.total) && has(x.price) ? (x.price ? x.total / x.price : 0) : 1);
        const pr = has(x.price) ? x.price : (has(x.total) && q ? x.total / q : 0);
        cur.got += r2(q * pr);
      }
    });
    chapGaps.forEach((g) => { g.gap = r2(g.excel - g.got); });
    const bad = chapGaps.filter((g) => Math.abs(g.gap) > 0.05);
    const w = $('[data-warn]', m.el); const was = $('[data-fill]', m.el); const on = was ? was.checked : false;
    w.innerHTML = bad.length ? `<div class="hint-box warn"><span><b>Sous-totaux de chapitre différents du métré :</b><br>${bad.map((g) => `${esc(g.desc)} : ${money(g.excel)} dans Excel, ${money(g.got)} en lignes (écart ${money(g.gap)})`).join('<br>')}
      ${bad.some((g) => g.gap > 0) ? `<br><label class="chk"><input type="checkbox" data-fill ${on ? 'checked' : ''}> Ajouter une ligne forfaitaire de l'écart dans ces chapitres</label>` : ''}</span></div>` : '';
    const f = $('[data-fill]', m.el); if (f) f.onchange = sum;
  };
  // contrôle : chaque ligne recalculée (quantité × prix) comparée au total de la colonne Excel
  const sum = () => {
    const ls = build(); let xl = 0; let bad = 0;
    cls.forEach((x, i) => {
      const td = $(`[data-calc="${i}"]`, m.el); if (!td) return;
      if (x.kind !== 'item') { td.textContent = ''; td.className = 'r'; return; }
      const l = ls.find((y) => y._src === i); const calc = l ? r2(num(l.qty) * num(l.price)) : 0;
      if (has(x.total)) xl += x.total;
      const diff = has(x.total) && Math.abs(calc - x.total) > 0.01;
      if (diff) bad++;
      td.textContent = money(calc); td.className = 'r' + (diff ? ' late' : ''); td.title = diff ? `Différent du total Excel (${money(x.total)})` : '';
    });
    const net = totals({ lines: ls }).net;
    if (chapGaps.length) xl = chapGaps.reduce((t, g) => t + g.excel, 0); // total du métré = somme des sous-totaux de chapitre
    $('[data-sum]', m.el).innerHTML = `${ls.filter((l) => l.kind === 'title').length} chapitre(s) · ${ls.filter((l) => l.kind === 'item').length} ligne(s) · <b>${money(net)} HT</b>${xl ? ` · Excel : ${money(r2(xl))}${Math.abs(net - xl) > Math.max(0.01, ls.filter((l) => l.kind === 'item').length * 0.005) ? ` <b class="late">(écart ${money(r2(net - xl))}${bad ? `, ${bad} ligne(s) en rouge` : ''})</b>` : ` ✓${Math.abs(net - xl) >= 0.01 ? ` (arrondis ${money(r2(net - xl))})` : ''}`}` : ''}`;
  };
  $$('[data-k]', m.el).forEach((s) => { s.onchange = () => { cls[+s.dataset.k].kind = s.value; s.closest('tr').className = 'k-' + s.value; checkChaps(); sum(); }; });
  checkChaps();
  $('[name=vat]', m.el).onchange = sum; sum();
  $('[data-ok]', m.el).onclick = () => { const ls = build().map(({ _src, ...l }) => l); m.close(); onLines(ls, res.fileName); toast(`${ls.filter((l) => l.kind === 'item').length} ligne(s) importée(s)`); };
}
// Nouveau devis directement depuis un fichier Excel
function quoteFromExcel(preset = {}) {
  importLinesExcel((lines, fileName) => newQuote({ ...preset, title: preset.title || fileName.replace(/\.[^.]+$/, ''), lines }));
}

// ---------------------------------------------------------------- Contacts depuis Excel / CSV
const CONTACT_IMPORT = [
  { key: 'company', label: 'Société', syn: ['societe', 'entreprise', 'company', 'firma', 'bedrijf', 'raisonsociale', 'denumire', 'nomsociete', 'bedrijfsnaam'] },
  { key: 'civility', label: 'Civilité', syn: ['civilite', 'titre', 'aanspreking', 'title', 'salutation'] },
  { key: 'name', label: 'Nom', syn: ['nom', 'name', 'lastname', 'naam', 'achternaam', 'nume', 'nomdefamille', 'nomclient', 'client', 'nomcomplet', 'fullname', 'klant', 'klantnaam'] },
  { key: 'firstname', label: 'Prénom', syn: ['prenom', 'firstname', 'voornaam', 'prenume'] },
  { key: 'vat', label: 'N° TVA / entreprise', syn: ['tva', 'ntva', 'numerotva', 'btw', 'btwnummer', 'vat', 'vatnumber', 'cui', 'cif', 'numeroentreprise', 'bce', 'kbo', 'ondernemingsnummer'] },
  { key: 'email', label: 'Email', syn: ['email', 'mail', 'courriel', 'emailadres', 'adresseemail', 'adressemail'] },
  { key: 'phone', label: 'Téléphone', syn: ['tel', 'telephone', 'phone', 'telefoon', 'telefon', 'fixe'] },
  { key: 'mobile', label: 'GSM', syn: ['gsm', 'mobile', 'portable', 'mobiel', 'gsmnummer', 'cellulaire'] },
  { key: 'address', label: 'Adresse (rue et n°)', syn: ['adresse', 'address', 'rue', 'straat', 'adres', 'adresa', 'street'] },
  { key: 'zip', label: 'Code postal', syn: ['cp', 'codepostal', 'zip', 'postcode', 'postalcode', 'codpostal', 'npa'] },
  { key: 'city', label: 'Localité', syn: ['ville', 'localite', 'city', 'gemeente', 'stad', 'oras', 'commune', 'plaats'] },
  { key: 'country', label: 'Pays', syn: ['pays', 'country', 'land', 'tara'] },
  { key: 'kind', label: 'Type (client, fournisseur…)', syn: ['type', 'categorie', 'category', 'soort', 'tip'] },
  { key: 'iban', label: 'IBAN', syn: ['iban', 'compte', 'rekening', 'rekeningnummer', 'cont'] },
  { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'remarque', 'remarques', 'commentaire', 'opmerking', 'observatii'] },
];
async function importContacts(defKind = 'client') {
  const [file] = await pickFile('.xlsx,.xls,.ods,.csv,.vcf');
  if (!file) return;
  let rows;
  if (/\.vcf$/i.test(file.name)) { try { rows = parseVCards(new TextDecoder().decode(await readBytes(file))); } catch (e) { return toast('Lecture impossible : ' + e.message, 9000); } }
  else { const bytes = readBytes(file); bytes.catch(() => {}); const res = await importWizard({ title: `Importer des contacts – ${file.name}`, fields: CONTACT_IMPORT, file, bytes }); if (!res) return; rows = res.rows; }
  const existing = await db.list('contact');
  const clean = (s) => String(s ?? '').trim();
  const kindOf = (s) => { const k = normKey(s); if (!k) return defKind; return Object.keys(CONTACT_KINDS).find((x) => k.startsWith(normKey(x).slice(0, 5)) || normKey(CONTACT_KINDS[x]).startsWith(k.slice(0, 5))) || ({ leverancier: 'fournisseur', supplier: 'fournisseur', furnizor: 'fournisseur', klant: 'client', customer: 'client', onderaannemer: 'soustraitant' }[k]) || defKind; };
  const list = [];
  for (const r of rows) {
    const d = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clean(v)]));
    if (!d.company && !d.name && !d.firstname) continue;
    // une forme juridique dans le nom = une société
    if (!d.company && !d.firstname && /\b(SA|SRL|SPRL|SPRLU|BV|NV|BVBA|CV|ACP|VME|ASBL|VZW|SC|SCS|SNC|SCRL|SAS|SARL|EURL|GmbH|Ltd|SCI)\b/i.test(d.name)) { d.company = d.name; d.name = ''; }
    // « Nom » contenant « Prénom Nom » sans colonne prénom : laissé tel quel ; adresse « rue 12, 1190 Forest » éclatée si besoin
    if (d.address && !d.zip && !d.city) { const mm = d.address.match(/^(.*?)[,\s]+(?:[A-Z]{1,2}-)?(\d{4,5})\s+([^,\d][^,]*)$/); if (mm) { d.address = mm[1]; d.zip = mm[2]; d.city = mm[3]; } }
    if (d.zip && /^\d+\.0$/.test(d.zip)) d.zip = d.zip.replace(/\.0$/, '');
    d.kind = kindOf(d.kind);
    if (!d.country) d.country = company().country === 'FR' ? 'France' : 'Belgique';
    const vatN = (v) => String(v || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().replace(/^BE/, '');
    const dup = existing.find((c) => (d.vat && vatN(c.data.vat) && vatN(c.data.vat) === vatN(d.vat)) || (d.email && c.data.email && c.data.email.toLowerCase() === d.email.toLowerCase())
      || (contactName(c).toLowerCase() === contactName({ data: d }).toLowerCase()));
    list.push({ d, dup });
  }
  if (!list.length) return toast('Aucun contact reconnu dans le fichier');
  const nDup = list.filter((x) => x.dup).length;
  const v = await ask(`Importer ${list.length} contact(s)`, [
    { name: 'info', type: 'html', cls: 'full', html: `<div class="dt-body"><table class="dt"><thead><tr><th>Nom</th><th>Type</th><th>TVA</th><th>Email</th><th>Localité</th><th></th></tr></thead><tbody>${list.slice(0, 12).map((x) => `<tr><td>${esc(contactName({ data: x.d }))}</td><td>${esc(CONTACT_KINDS[x.d.kind])}</td><td>${esc(x.d.vat || '')}</td><td>${esc(x.d.email || '')}</td><td>${esc([x.d.zip, x.d.city].filter(Boolean).join(' '))}</td><td>${x.dup ? badge('Existe déjà', '#f08c00') : badge('Nouveau', '#2f9e44')}</td></tr>`).join('')}</tbody></table></div>${list.length > 12 ? `<small class="muted">… et ${list.length - 12} autre(s)</small>` : ''}` },
    ...(nDup ? [{ name: 'dups', label: `${nDup} contact(s) existent déjà`, type: 'select', options: [['update', 'Compléter les fiches existantes'], ['skip', 'Les ignorer'], ['create', 'Les créer quand même (doublons)']], cls: 'full' }] : []),
  ], { dups: 'update' });
  if (!v) return;
  let created = 0; let updated = 0; let i = 0;
  for (const x of list) {
    i++; if (i % 10 === 0) toast(`Import… ${i}/${list.length}`, 20000);
    if (x.dup && v.dups === 'skip') continue;
    if (x.dup && v.dups === 'update') {
      const fillIn = Object.fromEntries(Object.entries(x.d).filter(([k, val]) => val && !x.dup.data[k]));
      if (Object.keys(fillIn).length) { x.dup.data = { ...x.dup.data, ...fillIn }; await persist('contact', x.dup, { silent: true }); updated++; }
      continue;
    }
    await persist('contact', { data: x.d }, { silent: true }); created++;
  }
  toast(`${created} contact(s) créé(s), ${updated} complété(s)`, 4000);
  render();
}
// Cartes de visite (.vcf) exportées depuis le téléphone / Outlook / Gmail
function parseVCards(text) {
  return text.split(/END:VCARD/i).map((card) => {
    const get = (re) => { const mm = card.match(re); return mm ? mm[1].trim() : ''; };
    const n = get(/^N(?:;[^:]*)?:(.*)$/mi).split(';');
    const adr = get(/^ADR(?:;[^:]*)?:(.*)$/mi).split(';');
    return { company: get(/^ORG(?:;[^:]*)?:(.*)$/mi).replace(/;+$/, ''), name: n[0] || get(/^FN(?:;[^:]*)?:(.*)$/mi), firstname: n[1] || '', email: get(/^EMAIL(?:;[^:]*)?:(.*)$/mi),
      mobile: get(/^TEL;[^:]*(?:CELL|MOBILE)[^:]*:(.*)$/mi), phone: get(/^TEL(?:;[^:]*)?:(.*)$/mi), address: adr[2] || '', city: adr[3] || '', zip: adr[5] || '', country: adr[6] || '', vat: '', notes: get(/^NOTE(?:;[^:]*)?:(.*)$/mi) };
  }).filter((c) => c.company || c.name);
}
