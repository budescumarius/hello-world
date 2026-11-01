'use strict';
/* Plusieurs documents à la fois : impression, PDF (un seul fichier, séparés ou zip), suppression depuis les listes ;
   export comptable : factures émises, notes de crédit et factures d'achat d'une période en un seul ZIP (PDF + journaux CSV). */

const MULTI_KIND = { quote: 'Devis', invoice: 'Factures', order: 'Bons de commande' };

// Tous les documents cochés sur une seule page : un document par page à l'impression
async function printMany(kind, picked) {
  toast('Préparation…', 30000);
  const parts = [];
  for (const it of picked) parts.push(`<div class="pm-doc">${(await docHtml(kind, it.id)).html}</div>`);
  printPage(`${picked.length} ${MULTI_KIND[kind].toLowerCase()}`, parts.join(''), location.hash, null);
  const b = $('[data-act=pdf]'); if (b) { b.innerHTML = `${I.file} PDF`; b.onclick = () => docsOnePdf(kind, picked); }
  const dl = $('[data-act=dl]'); if (dl) dl.onclick = () => docsOnePdf(kind, picked);
  toast('Prêt : Imprimer ou télécharger en PDF', 2500);
}
// Un PDF par document, tous dans un ZIP
async function docsPdfFiles(kind, picked, folder = '', light = false) {
  const files = [];
  for (const [i, it] of picked.entries()) {
    toast(`PDF ${i + 1} / ${picked.length}…`, 60000);
    const r = await docHtml(kind, it.id);
    const blob = await makePdf(r.html, { light });
    files.push({ name: `${folder}${r.fname || fileTitle(r.title || it.number || String(it.id))}.pdf`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return files;
}
// Tous les documents cochés dans un seul PDF (chacun commence sur une nouvelle page, avec sa propre numérotation)
async function docsOnePdf(kind, picked) {
  try {
    if (picked.length === 1) { const r = await docHtml(kind, picked[0].id); downloadBlob(await makePdf(r.html), `${r.fname}.pdf`); return toast('PDF téléchargé ✓', 2500); }
    await loadScript('assets/vendor/jspdf-2.5.1.umd.min.js');
    let pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (const [i, it] of picked.entries()) { toast(`PDF ${i + 1} / ${picked.length}…`, 60000); pdf = await makePdf((await docHtml(kind, it.id)).html, { into: pdf }); }
    downloadBlob(pdf.output('blob'), `${fileTitle(MULTI_KIND[kind])}_${picked.length}-documents_${today()}.pdf`);
    toast(`${picked.length} documents dans un seul PDF ✓`, 3000);
  } catch (e) { console.error(e); toast('PDF impossible : ' + e.message, 5000); }
}
// Un fichier PDF par document (téléchargés l'un après l'autre)
async function docsSeparatePdfs(kind, picked) {
  try {
    const files = await docsPdfFiles(kind, picked);
    for (const f of files) { downloadBlob(new Blob([f.data], { type: 'application/pdf' }), f.name); await new Promise((r) => setTimeout(r, 400)); }
    toast(`${files.length} PDF téléchargé(s) ✓ (autorisez les téléchargements multiples si le navigateur le demande)`, 5000);
  } catch (e) { console.error(e); toast('PDF impossible : ' + e.message, 5000); }
}
async function docsZip(kind, picked) {
  try {
    const files = await docsPdfFiles(kind, picked);
    downloadBlob(makeZip(files), `${fileTitle(MULTI_KIND[kind])}-${today()}.zip`);
    toast(`${files.length} PDF téléchargé(s) ✓`, 3000);
  } catch (e) { console.error(e); toast('PDF impossible : ' + e.message, 5000); }
}
// Actions groupées des listes (devis, factures, commandes)
function multiActions(kind, picked) {
  return [
    { label: 'Imprimer', icon: 'print', primary: true, run: () => printMany(kind, picked) },
    { label: picked.length > 1 ? 'Télécharger en PDF (un seul fichier)' : 'Télécharger en PDF', icon: 'download', run: () => docsOnePdf(kind, picked) },
    ...(picked.length > 1 ? [{ label: 'Télécharger un PDF par document', icon: 'file', run: () => docsSeparatePdfs(kind, picked) },
      { label: 'Télécharger en ZIP', icon: 'download', run: () => docsZip(kind, picked) }] : []),
    ...(kind === 'invoice' ? [{ label: 'Envoyer au comptable', icon: 'mail', run: async () => { const contacts = await db.list('contact'); const ok = picked.filter((i) => i.data.status === 'emise' && i.data.kind !== 'proforma'); if (!ok.length) return toast('Choisissez des factures validées (pas des brouillons)', 4000); sendToAccountant(ok.map((i) => invRow(i, contacts)), `${ok.length} facture(s)`); } }] : []),
    ...(kind === 'invoice' ? [{ label: 'Marquer comme envoyées (envoi manuel)…', icon: 'check', run: () => invMarkSent(picked) }] : []),
    { sep: true },
    { label: `Supprimer (${picked.length})`, icon: 'trash', danger: true, run: () => deleteMany(kind, picked) },
  ];
}
async function deleteMany(kind, picked) {
  // une facture émise ne se supprime pas : elle se corrige par une note de crédit
  const ok = kind === 'invoice' ? picked.filter((i) => i.data.status !== 'emise') : picked;
  const kept = picked.length - ok.length;
  if (!ok.length) return toast('Ces factures sont validées : elles ne se suppriment pas, faites une note de crédit.', 5000);
  if (!confirm(`Supprimer définitivement ${ok.length} ${MULTI_KIND[kind].toLowerCase()} ?${kept ? `\n\n${kept} facture(s) validée(s) seront gardées : une facture émise se corrige par une note de crédit.` : ''}`)) return;
  for (const it of ok) await db.del(kind, it.id);
  toast(`${ok.length} supprimé(s)${kept ? ` · ${kept} facture(s) validée(s) gardée(s)` : ''}`, 3500);
  render();
}

// ---------------------------------------------------------------- Export comptable (trimestre)
const invRow = (i, contacts) => { const t = invState(i).t; return { id: i.id, it: i, typ: i.data.kind === 'avoir' ? 'avoir' : 'vente', n: i.number, date: i.data.date, who: contactName(byId(contacts, i.data.clientId)), ht: t.base, tva: t.vat, ttc: t.total, piece: 'PDF généré' }; };
const purchRow = (e, contacts) => { const d = e.data; const ttc = purchTtc(d); return { id: e.id, it: e, typ: 'achat', n: d.ref || '', date: d.date, who: contactName(byId(contacts, d.supplierId)), ht: num(d.amount), tva: r2(ttc - num(d.amount)), ttc, piece: d.fileId ? (d.fileName || 'pièce jointe') : '' }; };
route('export', async () => {
  const [invoices, expenses, contacts] = await Promise.all([db.list('invoice', { lite: true }), db.list('expense'), db.list('contact')]);
  const now = new Date(); const y = now.getFullYear(); const qNow = Math.floor(now.getMonth() / 3) + 1;
  // par défaut : le trimestre qui vient de se terminer si on est dans le 1er mois d'un trimestre, sinon le trimestre en cours
  const def = now.getMonth() % 3 === 0 ? (qNow === 1 ? { y: y - 1, q: 4 } : { y, q: qNow - 1 }) : { y, q: qNow };
  const P = ui.exp || (ui.exp = { y: def.y, q: def.q });
  const range = () => (P.q === 'x' ? [P.from || `${y}-01-01`, P.to || today()] : [`${P.y}-${String((P.q - 1) * 3 + 1).padStart(2, '0')}-01`, addDays(`${P.q === 4 ? +P.y + 1 : P.y}-${String(P.q === 4 ? 1 : P.q * 3 + 1).padStart(2, '0')}-01`, -1)]);
  const [from, to] = range();
  const inP = (d) => d && d >= from && d <= to;
  const perLabel = P.q === 'x' ? `du ${fmtDate(from)} au ${fmtDate(to)}` : `T${P.q} ${P.y}`;
  const rows = [
    // factures et dépenses reprises d'un autre logiciel : le comptable les a déjà
    ...invoices.filter((i) => i.data.status === 'emise' && !i.data.external && inP(i.data.date)).map((i) => invRow(i, contacts)),
    ...expenses.filter((e) => purchState(e) !== 'refusee' && !e.data.external && inP(e.data.date)).map((e) => purchRow(e, contacts)),
  ].sort((a, b) => a.typ.localeCompare(b.typ) || (a.date || '').localeCompare(b.date || '') || String(a.n).localeCompare(String(b.n)));
  const TYP = { vente: ['Facture émise', '#3b5bdb'], avoir: ['Note de crédit', '#7048e8'], achat: ['Facture d\'achat', '#e8590c'] };
  const page = layout({ title: 'Envoyer au comptable', icon: 'mail', back: isSimple() ? '#/dashboard' : null, sub: `Du ${fmtDate(from)} au ${fmtDate(to)}`, actions: `<button class="btn" data-zip2>${I.download} ZIP</button><button class="btn primary" data-send2>${I.mail} Envoyer au comptable</button>` });
  const years = [y, y - 1, y - 2];
  page.innerHTML = `<div class="card exp-per"><div class="card-h"><h3>Période</h3></div>
      <div class="chips">${years.map((yy) => `<button class="chip ${+P.y === yy && P.q !== 'x' ? 'on' : ''}" data-y="${yy}">${yy}</button>`).join('')}</div>
      <div class="chips">${[1, 2, 3, 4].map((q) => `<button class="chip ${P.q === q ? 'on' : ''}" data-q="${q}">T${q} <small>${['janv.–mars', 'avr.–juin', 'juil.–sept.', 'oct.–déc.'][q - 1]}</small></button>`).join('')}<button class="chip ${P.q === 'x' ? 'on' : ''}" data-q="x">Autres dates</button></div>
      ${P.q === 'x' ? `<div class="grid-form">${fieldHTML({ name: 'from', label: 'Du', type: 'date' }, from)}${fieldHTML({ name: 'to', label: 'Au', type: 'date' }, to)}</div>` : ''}
      <p class="muted">Tout est coché : décochez ce que vous ne voulez pas envoyer. Le ZIP contient un PDF par facture (ventes, notes de crédit), les pièces des achats et les journaux CSV.</p></div>
    <div class="kpis" data-k></div><div id="tbl"></div>
    <div class="exp-go"><button class="btn" data-zip>${I.download} Télécharger le ZIP</button><button class="btn primary" data-send>${I.mail} Envoyer au comptable</button></div>`;
  const st = { sel: null };
  const sum = () => {
    const sel = rows.filter((r) => st.sel.has(r.id)); const by = (t) => sel.filter((r) => r.typ === t);
    $('[data-k]', page).innerHTML = kpi('Factures émises', String(by('vente').length), { sub: `${money(by('vente').reduce((a, r) => a + r.ttc, 0))} TVAC` })
      + kpi('Notes de crédit', String(by('avoir').length), { sub: `${money(by('avoir').reduce((a, r) => a + r.ttc, 0))} TVAC` })
      + kpi('Factures d\'achat', String(by('achat').length), { sub: `${money(by('achat').reduce((a, r) => a + r.ttc, 0))} TVAC${by('achat').some((r) => !r.piece) ? ` · ${by('achat').filter((r) => !r.piece).length} sans pièce` : ''}`, cls: by('achat').some((r) => !r.piece) ? 'warn' : '' });
    $('[data-zip]', page).disabled = !sel.length; $('[data-send]', page).disabled = !sel.length;
  };
  dataTable($('#tbl', page), {
    rows, state: st, search: (r) => [r.n, r.who, r.piece].join(' '),
    filters: { def: '', options: [['', 'Tout'], ...Object.entries(TYP).map(([k, [l, c]]) => [k, l, c])], match: (r, f) => r.typ === f },
    select: { all: true, onChange: sum, actions: (picked) => [{ label: 'Envoyer au comptable', icon: 'mail', primary: true, run: () => sendToAccountant(picked, perLabel) }, { label: 'Télécharger le ZIP', icon: 'download', run: () => exportZip(picked, from, to) }] },
    columns: [
      { l: 'Type', v: (r) => badge(...TYP[r.typ]) }, { l: 'N° / réf.', v: (r) => `<b>${esc(r.n || '—')}</b>` }, { l: 'Date', v: (r) => fmtDate(r.date), sort: (r) => r.date },
      { l: 'Client / fournisseur', v: (r) => esc(r.who) }, { l: 'HT', cls: 'r', v: (r) => money(r.ht), sort: (r) => r.ht }, { l: 'TVA', cls: 'r', v: (r) => money(r.tva) }, { l: 'TVAC', cls: 'r', v: (r) => `<b>${money(r.ttc)}</b>`, sort: (r) => r.ttc },
      { l: 'Pièce', v: (r) => (r.piece ? `<small class="muted">${esc(r.piece)}</small>` : badge('sans pièce', '#e5484d')) },
    ],
    onRow: (r) => go(r.typ === 'achat' ? `#/purchase/${r.id}` : `#/invoice/${r.id}`), empty: 'Aucune facture sur cette période',
  });
  sum();
  $('[data-zip]', page).onclick = () => exportZip(rows.filter((r) => st.sel.has(r.id)), from, to);
  $('[data-zip2]').onclick = () => $('[data-zip]', page).click(); $('[data-send2]').onclick = () => $('[data-send]', page).click();
  $('[data-send]', page).onclick = () => sendToAccountant(rows.filter((r) => st.sel.has(r.id)), perLabel);
  $$('[data-y]', page).forEach((b) => { b.onclick = () => { P.y = +b.dataset.y; if (P.q === 'x') P.q = 1; saveUi(); render(); }; });
  $$('[data-q]', page).forEach((b) => { b.onclick = () => { P.q = b.dataset.q === 'x' ? 'x' : +b.dataset.q; saveUi(); render(); }; });
  $$('[name=from],[name=to]', page).forEach((i) => { i.onchange = () => { P[i.name] = i.value; saveUi(); render(); }; });
});
// Fichiers pour le comptable : PDF des ventes et notes de crédit, pièces des achats, journaux CSV
async function exportFiles(picked, light = false) {
  const files = [];
  const ventes = picked.filter((r) => r.typ === 'vente').map((r) => r.it); const avoirs = picked.filter((r) => r.typ === 'avoir').map((r) => r.it);
  files.push(...await docsPdfFiles('invoice', ventes, 'Ventes/', light), ...await docsPdfFiles('invoice', avoirs, 'Notes de credit/', light));
  const achats = picked.filter((r) => r.typ === 'achat');
  for (const [i, r] of achats.entries()) {
    if (!r.it.data.fileId) continue;
    toast(`Pièces d'achat ${i + 1} / ${achats.length}…`, 60000);
    const res = await fetch(fileUrl(r.it.data.fileId), { credentials: 'same-origin' }); if (!res.ok) continue;
    const ext = ((r.it.data.fileName || '').match(/\.(\w{2,5})$/) || [, 'pdf'])[1];
    files.push({ name: `Achats/${r.date || ''}_${fileTitle(r.who)}_${fileTitle(r.n || String(r.id))}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) });
  }
  const head = ['Type', 'Numero / reference', 'Date', 'Client / fournisseur', 'HT', 'TVA', 'TVAC', 'Piece'];
  const line = (r) => [r.typ === 'vente' ? 'Facture' : r.typ === 'avoir' ? 'Note de credit' : 'Achat', r.n, fmtDate(r.date), r.who, fnum(r.ht), fnum(r.tva), fnum(r.ttc), r.piece || 'sans piece'];
  if (picked.some((r) => r.typ !== 'achat')) files.push({ name: 'Journal des ventes.csv', data: csvBytes([head, ...picked.filter((r) => r.typ !== 'achat').map(line)]) });
  if (picked.some((r) => r.typ === 'achat')) files.push({ name: 'Journal des achats.csv', data: csvBytes([head, ...picked.filter((r) => r.typ === 'achat').map(line)]) });
  return files;
}
async function exportZip(picked, from, to) {
  if (!picked.length) return;
  const btn = $('[data-zip]'); if (btn) btn.disabled = true;
  try {
    const files = await exportFiles(picked, true);
    downloadBlob(makeZip(files), `${fileTitle(company().name || 'export')}-comptabilite-${from}-${to}.zip`);
    toast(`ZIP prêt : ${files.length} fichiers ✓`, 3500);
  } catch (e) { console.error(e); toast('Export impossible : ' + e.message, 5000); } finally { if (btn) btn.disabled = false; }
}

// Envoi direct au comptable : un e-mail avec le ZIP ; découpé en plusieurs e-mails si c'est trop lourd
async function sendToAccountant(picked, label) {
  if (!picked.length) return;
  const co = company();
  formModal({
    title: 'Envoyer au comptable', saveLabel: 'Préparer et envoyer',
    values: { to: co.accountantEmail || '', cc: true, subject: `Comptabilité ${label} – ${co.name || ''}`.trim(), body: `Bonjour,\n\nVeuillez trouver ci-joint les documents comptables ${/^T\d/.test(label) ? 'du ' : ''}${label} : ${picked.filter((r) => r.typ === 'vente').length} facture(s) émise(s), ${picked.filter((r) => r.typ === 'avoir').length} note(s) de crédit et ${picked.filter((r) => r.typ === 'achat').length} facture(s) d'achat, avec les journaux des ventes et des achats (CSV).\n\n${mailSign()}` },
    fields: [{ name: 'to', label: 'E-mail du comptable', type: 'email', required: true, cls: 'full' }, { name: 'cc', label: `Recevoir une copie (${S.me.email})`, type: 'check', cls: 'full' },
      { name: 'subject', label: 'Objet', required: true, cls: 'full' }, { name: 'body', label: 'Message', type: 'textarea', rows: 7, cls: 'full' }],
    async onSave(v) {
      const to = v.to.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Adresse e-mail invalide');
      // l'adresse est retenue pour la prochaine fois
      if (to !== co.accountantEmail && isAdmin()) { const c2 = { ...company(), accountantEmail: to }; api('PUT', 'settings', { company: c2 }).then(() => { S.settings.company = c2; }).catch(() => {}); }
      setTimeout(() => sendAccountantMail(picked, { to, cc: v.cc, subject: v.subject, body: v.body }), 50);
    },
  });
}
async function sendAccountantMail(picked, m) {
  try {
    const files = await exportFiles(picked, true);
    // paquets à la taille maximale acceptée par l'hébergement (limites PHP), 15 Mo au plus par e-mail
    const lim = await api('GET', 'mail/limit').then((r) => Math.min(15e6, r.max * 0.9 - 200e3)).catch(() => 7e6);
    const packs = []; let cur = []; let size = 0;
    for (const f of files) { if (cur.length && size + f.data.length > lim) { packs.push(cur); cur = []; size = 0; } cur.push(f); size += f.data.length; }
    if (cur.length) packs.push(cur);
    for (const [k, pack] of packs.entries()) {
      toast(`Envoi de l'e-mail ${packs.length > 1 ? `${k + 1} / ${packs.length}` : ''}…`, 120000);
      const part = packs.length > 1 ? ` (partie ${k + 1}/${packs.length})` : '';
      const fd = new FormData();
      fd.append('to', JSON.stringify([{ email: m.to }])); fd.append('cc', JSON.stringify(m.cc ? [{ email: S.me.email, name: S.me.name }] : []));
      fd.append('subject', m.subject + part); fd.append('body', m.body); fd.append('ref_type', 'export');
      fd.append('att', makeZip(pack), `${fileTitle(m.subject)}${part ? `-partie-${k + 1}` : ''}.zip`);
      await api('POST', 'mail', fd);
    }
    toast(`Envoyé au comptable ✓ (${files.length} fichiers${packs.length > 1 ? `, ${packs.length} e-mails` : ''})`, 5000);
  } catch (e) { console.error(e); toast('Envoi impossible : ' + e.message, 6000); }
}
