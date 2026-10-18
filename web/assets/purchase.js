'use strict';
/* Factures fournisseurs : liste avec statuts (À valider → À payer → Payée) et page de vérification avec la facture affichée à côté. */

const PURCH_ST = { avalider: ['À valider', '#f08c00'], retard: ['En retard', '#e5484d'], partiel: ['Part. payée', '#0c8599'], apayer: ['À payer', '#3b5bdb'], payee: ['Payée', '#2f9e44'], refusee: ['Refusée', '#868e96'] };
// montant saisi : toujours 2 décimales (« 883,30 »)
const famt = (x) => (num(x) || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PURCH_SRC = { peppol: 'Peppol', pdf: 'PDF importé', xml: 'XML importé', photo: 'Photo' };
// TVA par taux (anciens achats : un seul taux)
function purchVat(d) {
  if (Array.isArray(d.vatLines) && d.vatLines.length) return d.vatLines.map((x) => ({ rate: num(x.rate), amount: num(x.amount) }));
  const amount = d.vatAmount != null && d.vatAmount !== '' ? num(d.vatAmount) : r2(num(d.amount) * num(d.vat ?? defVat()) / 100);
  return [{ rate: num(d.vat ?? defVat()), amount }];
}
const purchTtc = (d) => (d.ttc != null && d.ttc !== '' ? num(d.ttc) : r2(num(d.amount) + purchVat(d).reduce((a, x) => a + x.amount, 0)));
// paiements (plusieurs tranches possibles) ; anciens achats : « paid » = payée en une fois
const purchPaid = (d) => (Array.isArray(d.payments) && d.payments.length ? r2(d.payments.reduce((a, p) => a + num(p.amount), 0)) : d.paid ? purchTtc(d) : 0);
const purchRest = (d) => r2(purchTtc(d) - purchPaid(d));
function purchState(e) {
  const d = e.data;
  if (d.refused) return 'refusee';
  if (d.status === 'avalider' || d.toCheck) return 'avalider';
  const paid = purchPaid(d);
  if ((paid !== 0 || d.paid || !purchTtc(d)) && Math.abs(purchRest(d)) < 0.01) return 'payee';
  if (d.due && d.due < today()) return 'retard';
  return paid ? 'partiel' : 'apayer';
}
const purchLog = (d, txt) => { (d.history = d.history || []).push({ t: new Date().toISOString(), uid: S.me.id, txt }); };
// recalcule « paid » / « paidDate » après un changement de paiements
function purchSyncPaid(d) {
  d.payments = d.payments || [];
  const full = d.payments.length && Math.abs(purchRest({ ...d, paid: false })) < 0.01;
  d.paid = !!full; d.paidDate = full ? d.payments.map((p) => p.date).sort().pop() : null;
}
const purchStatusHtml = (e) => {
  const s = purchState(e); const d = e.data; const paid = purchPaid(d);
  const sub = s === 'payee' ? (d.paidDate ? fmtDate(d.paidDate) : '') : s === 'avalider' ? (PURCH_SRC[d.source] || (d.peppol ? 'Peppol' : ''))
    : s === 'refusee' ? '' : paid && s !== 'payee' ? `reste ${money(purchRest(d))}` : (d.due ? `éch. ${fmtDate(d.due)}` : '');
  return `<span class="pst">${badge(PURCH_ST[s][0], PURCH_ST[s][1])}${sub ? `<small class="muted">${esc(sub)}</small>` : ''}</span>`;
};
// Communication structurée belge : 10 chiffres + clé modulo 97
const commOk = (v) => { const dg = String(v).replace(/\D/g, ''); if (dg.length !== 12) return false; const m = Number(BigInt(dg.slice(0, 10)) % 97n) || 97; return m === +dg.slice(10); };
const commFmt = (v) => { const dg = String(v).replace(/\D/g, ''); return dg.length === 12 ? `+++${dg.slice(0, 3)}/${dg.slice(3, 7)}/${dg.slice(7)}+++` : v; };

// Ouvre une facture fournisseur (ou une nouvelle, pré-remplie)
function editExpense(e, preset = {}) {
  if (e && e.id) return go(`#/purchase/${e.id}`);
  S.purchaseDraft = preset; go('#/purchase/new');
}

// ---------------------------------------------------------------- Liste
function expensesTable(el, rows, contacts, projects, showProject, pid) {
  const amt = (e) => (pid ? expenseAmountFor(e, pid) : num(e.data.amount));
  const cat = (e) => (pid ? (expenseFor(e, pid)[0] || {}).category : e.data.category);
  const where = (e) => {
    if (isSplit(e) || (Array.isArray(e.data.alloc) && e.data.alloc.length)) return `${badge('Ventilé', '#7048e8')} <small class="muted">${expenseParts(e).map((x) => esc(x.pid ? (byId(projects, x.pid) || { data: { name: '?' } }).data.name : 'Frais généraux')).join(', ')}</small>`;
    return e.project_id ? esc((byId(projects, e.project_id) || { data: { name: '?' } }).data.name) : '<span class="muted">—</span>';
  };
  const key = `exp_${pid || 'all'}`;
  const st = ui[key] || (ui[key] = { sort: 7 });
  const sel = st.sel || (st.sel = new Set());
  [...sel].forEach((id) => { if (!rows.some((r) => r.id === id)) sel.delete(id); });
  const search = (e) => [e.data.ref, e.data.desc, contactName(byId(contacts, e.data.supplierId)), fnum(num(e.data.amount)), String(e.data.amount)].join(' ');
  const filters = { def: '', options: [['', 'Toutes'], ...Object.entries(PURCH_ST).map(([k, [l, c]]) => [k, l, c])], match: (e, f) => purchState(e) === f };
  // lignes visibles avec le filtre et la recherche en cours (pour « tout sélectionner »)
  const visible = () => rows.filter((e) => (!st.f || filters.match(e, st.f)) && (!st.q || search(e).toLowerCase().includes(st.q.toLowerCase())));
  const sum = (l, f) => l.reduce((a, e) => a + f(e), 0);
  const open = (e) => !['avalider', 'refusee'].includes(purchState(e));
  dataTable(el, {
    rows, state: st, search, filters, pageSize: 20,
    toolbar: `<div class="bulk" data-bulk></div>`,
    columns: [
      { l: '✓', cls: 'sel', v: (e) => `<input type="checkbox" class="selbox" data-sel="${e.id}" ${sel.has(e.id) ? 'checked' : ''} aria-label="Sélectionner">` },
      { l: 'Date', v: (e) => fmtDate(e.data.date), sort: (e) => e.data.date || '' },
      { l: 'Type', v: (e) => `<span class="nowrap"><i class="tdot" style="--c:${TYPE_COLORS[cat(e)] || '#999'}"></i>${esc(TYPES[cat(e)] || '')}</span>` },
      { l: 'Fournisseur', v: (e) => `<b>${esc(contactName(byId(contacts, e.data.supplierId)))}</b>`, sort: (e) => contactName(byId(contacts, e.data.supplierId)) },
      { l: 'Référence', v: (e) => `${esc(e.data.ref || '—')}${e.data.desc && e.data.desc !== `Facture ${e.data.ref}` ? `<br><small class="muted">${esc(e.data.desc.slice(0, 60))}</small>` : ''}` },
      ...(showProject ? [{ l: 'Chantier', v: where }] : []),
      { l: pid ? 'HT (part du chantier)' : 'Montant HT', cls: 'r', v: (e) => `<b>${money(amt(e))}</b>${pid && Array.isArray(e.data.alloc) && e.data.alloc.length ? `<br><small class="muted">sur ${money(e.data.amount)}</small>` : ''}`, sort: amt },
      { l: 'Statut', v: purchStatusHtml, sort: (e) => Object.keys(PURCH_ST).indexOf(purchState(e)) },
      { l: '', v: (e) => `<span class="row-acts">${purchState(e) === 'avalider' ? `<button class="icon-btn sm good" data-ok="${e.id}" title="Valider">✓</button>` : open(e) && purchState(e) !== 'payee' ? `<button class="icon-btn sm" data-pay="${e.id}" title="Ajouter le paiement">€</button>` : ''}<button class="icon-btn sm" data-cm="${e.id}" title="Commentaires">${I.chat}${(e.data.comments || []).length ? `<i class="cnt">${e.data.comments.length}</i>` : ''}</button><button class="icon-btn sm" data-ed="${e.id}" title="Modifier">${I.edit}</button><button class="icon-btn sm" data-mo="${e.id}" title="Plus">${I.more}</button></span>` },
    ],
    onRow: (e) => go(`#/purchase/${e.id}`), empty: 'Aucune facture fournisseur',
    footer: (l) => { const o = l.filter(open); return `<tr><td colspan="${showProject ? 9 : 8}"><div class="inv-tot"><div><small>Total HT</small><b>${money(sum(l, amt))}</b></div>${pid ? '' : `<div><small>Total TVA</small><b>${money(sum(l, (e) => purchTtc(e.data) - num(e.data.amount)))}</b></div><div><small>Total TTC</small><b>${money(sum(l, (e) => purchTtc(e.data)))}</b></div><div><small>Déjà payé</small><b>${money(sum(o, (e) => purchPaid(e.data)))}</b></div><div><small>Total à payer</small><b>${money(sum(o, (e) => purchRest(e.data)))}</b></div>`}</div></td></tr>`; },
  });
  const drawBulk = () => {
    const box = $('[data-bulk]', el); if (!box) return;
    const vis = visible(); const all = vis.length && vis.every((e) => sel.has(e.id));
    box.innerHTML = `<label class="bulk-all"><input type="checkbox" data-selall ${all ? 'checked' : ''}> Tout</label>${sel.size ? `<button class="btn sm" data-bulkgo>Actions groupées ${I.chevron}</button><span class="muted">${sel.size} élément${sel.size > 1 ? 's' : ''} sélectionné${sel.size > 1 ? 's' : ''}</span>` : ''}`;
    $('[data-selall]', box).onchange = (ev) => { vis.forEach((e) => (ev.target.checked ? sel.add(e.id) : sel.delete(e.id))); $$('[data-sel]', el).forEach((c) => { c.checked = sel.has(+c.dataset.sel); }); drawBulk(); };
    const bg = $('[data-bulkgo]', box); if (bg) bg.onclick = () => purchBulk(rows.filter((e) => sel.has(e.id)), contacts, projects, () => { sel.clear(); render(); });
  };
  drawBulk();
  // la barre de filtres/recherche redessine le tableau : on garde la case « Tout » à jour
  $$('[data-f]', el).forEach((b) => b.addEventListener('click', drawBulk));
  const q = $('.search input', el); if (q) q.addEventListener('input', drawBulk);
  if (el.dataset.bound) return; el.dataset.bound = '1';
  el.addEventListener('change', (ev) => {
    const c = ev.target.closest('[data-sel]'); if (!c) return;
    if (c.checked) sel.add(+c.dataset.sel); else sel.delete(+c.dataset.sel);
    drawBulk();
  });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cm],[data-ed],[data-mo],[data-ok],[data-pay]'); if (!b) return;
    const e = rows.find((x) => x.id === +(b.dataset.cm || b.dataset.ed || b.dataset.mo || b.dataset.ok || b.dataset.pay)); if (!e) return;
    if (b.dataset.ed) return go(`#/purchase/${e.id}`);
    if (b.dataset.cm) return purchComments(e);
    if (b.dataset.ok) return purchApprove(e);
    if (b.dataset.pay) return purchPayment(e);
    purchMenu(e);
  });
}

// Validation depuis la liste : il faut au moins le fournisseur, la référence et le montant
async function purchApprove(e, quiet) {
  const d = e.data;
  const miss = [!d.supplierId && 'fournisseur', !d.ref && 'référence', !purchTtc(d) && 'montant'].filter(Boolean);
  if (miss.length) { if (!quiet) { toast(`À compléter avant validation : ${miss.join(', ')}`, 4000); go(`#/purchase/${e.id}`); } return false; }
  d.status = 'validee'; d.toCheck = false; delete d.readNote; delete d.supplierGuess; purchLog(d, 'Facture validée');
  await persist('expense', e, { silent: quiet });
  if (!quiet) { toast('Facture validée – à payer', 2000); render(); }
  return true;
}
async function purchRefuse(e) {
  const v = await ask('Refuser la facture', [{ name: 'reason', label: 'Motif (facultatif)', type: 'textarea', cls: 'full', placeholder: 'ex. montant erroné, marchandise non livrée…' }]);
  if (!v) return;
  e.data.refused = true; e.data.refuseReason = v.reason || ''; purchLog(e.data, `Facture refusée${v.reason ? ' : ' + v.reason : ''}`);
  await persist('expense', e); render();
}

// Paiement (total ou partiel) ; i = index pour modifier / supprimer une tranche
function purchPayment(e, i = null, after) {
  const d = e.data; d.payments = Array.isArray(d.payments) ? d.payments : [];
  // ancien achat marqué « payé » sans détail : la tranche est reconstituée
  if (d.paid && !d.payments.length) d.payments.push({ date: d.paidDate || today(), amount: purchTtc(d), method: 'Virement' });
  if (purchState(e) === 'avalider') return toast('Validez d\'abord la facture', 3000);
  const rest = purchRest(d);
  const p = i == null ? { date: today(), amount: famt(rest), method: 'Virement' } : { ...d.payments[i], amount: famt(d.payments[i].amount) };
  formModal({
    title: i == null ? `Ajouter un paiement – ${d.ref || 'facture'}` : 'Paiement', values: p, saveLabel: 'Enregistrer le paiement',
    extra: `<div class="pay-info"><div><span>Montant TTC</span><b>${money(purchTtc(d))}</b></div><div><span>Déjà payé</span><b>${money(purchPaid(d) - (i == null ? 0 : num(d.payments[i].amount)))}</b></div><div class="dark"><span>Reste à payer</span><b>${money(i == null ? rest : rest + num(d.payments[i].amount))}</b></div></div>
      <div class="pay-quick">${i == null ? `<button type="button" class="chip" data-pq="1">Tout (${money(rest)})</button><button type="button" class="chip" data-pq="0.5">50 %</button>` : ''}</div>`,
    fields: [{ name: 'amount', label: 'Montant payé', required: true }, { name: 'date', label: 'Date du paiement', type: 'date', required: true }, { name: 'method', label: 'Mode', type: 'select', options: PAY_METHODS.map((x) => [x, x]) }, { name: 'note', label: 'Remarque', cls: 'full', placeholder: 'ex. 2e tranche' }],
    after: (form) => { $$('[data-pq]', form).forEach((b) => { b.onclick = () => { form.elements.amount.value = famt(r2(rest * +b.dataset.pq)); }; }); },
    async onSave(v) {
      const amount = r2(num(v.amount)); const max = i == null ? rest : r2(rest + num(d.payments[i].amount));
      if (!amount) throw new Error('Indiquez le montant payé');
      if (Math.abs(amount) - Math.abs(max) > 0.01) throw new Error(`Le paiement dépasse le reste à payer (${money(max)})`);
      const row = { date: v.date, amount, method: v.method, note: v.note };
      if (i == null) { d.payments.push(row); purchLog(d, `Paiement de ${money(amount)} (${v.method}) le ${fmtDate(v.date)}`); } else { d.payments[i] = row; purchLog(d, `Paiement modifié : ${money(amount)} le ${fmtDate(v.date)}`); }
      purchSyncPaid(d); await persist('expense', e);
      toast(d.paid ? 'Facture entièrement payée' : `Paiement enregistré – reste ${money(purchRest(d))}`, 2500);
      if (after) after(); else render();
    },
    onDelete: i == null ? null : async () => { const x = d.payments.splice(i, 1)[0]; purchLog(d, `Paiement supprimé : ${money(x.amount)} du ${fmtDate(x.date)}`); purchSyncPaid(d); await persist('expense', e); if (after) after(); else render(); },
  });
}

function purchHistory(e) {
  const d = e.data;
  const h = [...(d.history || [])].reverse();
  modal(`${mhead(`Historique – ${d.ref || 'facture'}`)}<div class="m-body"><div class="feed">${h.map((x) => `<div><b>${esc(userName(x.uid))}</b> ${esc(x.txt)}<small class="muted">${fmtDT(x.t)}</small></div>`).join('') || '<p class="muted">Aucun événement enregistré.</p>'}
    <div><span class="muted">Facture reçue ${esc(PURCH_SRC[d.source] ? '(' + PURCH_SRC[d.source] + ')' : '')} – ${fmtDate(d.date)}</span></div></div></div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Fermer</button></div>`);
}

function purchMenu(e) {
  const d = e.data; const s = purchState(e);
  menuSheet(`Facture ${d.ref || ''}`.trim(), [
    { label: 'Ouvrir', icon: 'edit', run: () => go(`#/purchase/${e.id}`) },
    ...(s === 'avalider' ? [{ label: 'Valider la facture', icon: 'check', primary: true, run: () => purchApprove(e) }] : []),
    ...(!['avalider', 'refusee', 'payee'].includes(s) ? [{ label: 'Ajouter le paiement', icon: 'coins', primary: true, run: () => purchPayment(e) }] : []),
    ...((d.payments || []).length ? [{ label: `Paiements (${d.payments.length})`, icon: 'coins', run: () => purchPayList(e) }] : d.paid ? [{ label: 'Annuler le paiement', icon: 'coins', run: async () => { d.paid = false; d.paidDate = null; purchLog(d, 'Paiement annulé'); await persist('expense', e); render(); } }] : []),
    ...(d.fileId ? [{ label: 'Télécharger la facture (PDF)', icon: 'download', run: () => { location.href = fileUrl(d.fileId, true); } }] : []),
    s === 'refusee' ? { label: 'Annuler le refus', icon: 'check', run: async () => { d.refused = false; purchLog(d, 'Refus annulé'); await persist('expense', e); render(); } } : { label: 'Refuser', icon: 'x', run: () => purchRefuse(e) },
    { label: 'Afficher l\'historique', icon: 'hist', run: () => purchHistory(e) },
    { label: 'Commentaires', icon: 'chat', run: () => purchComments(e) },
    { sep: true },
    { label: 'Supprimer', icon: 'trash', danger: true, run: async () => { if (!confirm('Supprimer cette facture fournisseur ?')) return; await delFile(d.fileId); if (d.xmlFileId) await delFile(d.xmlFileId); await db.del('expense', e.id); render(); } },
  ]);
}
function purchPayList(e) {
  const d = e.data;
  menuSheet(`Paiements – reste ${money(purchRest(d))}`, [
    ...d.payments.map((p, i) => ({ label: `${fmtDate(p.date)} · ${money(p.amount)} · ${p.method || ''}${p.note ? ' · ' + p.note : ''}`, icon: 'coins', run: () => purchPayment(e, i) })),
    ...(purchRest(d) > 0.009 ? [{ sep: true }, { label: 'Ajouter un paiement', icon: 'plus', primary: true, run: () => purchPayment(e) }] : []),
  ]);
}

// Actions groupées sur la sélection
function purchBulk(list, contacts, projects, done) {
  const n = list.length;
  menuSheet(`${n} facture${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`, [
    { label: 'Valider', icon: 'check', run: async () => {
      let ok = 0; const todo = list.filter((e) => purchState(e) === 'avalider');
      for (const e of todo) if (await purchApprove(e, true)) ok++;
      toast(`${ok} facture(s) validée(s)${todo.length - ok ? ` · ${todo.length - ok} incomplète(s) à ouvrir` : ''}`, 4000); done();
    } },
    { label: 'Marquer comme payées (solde total)', icon: 'coins', run: async () => {
      const todo = list.filter((e) => !['avalider', 'refusee', 'payee'].includes(purchState(e)));
      if (!todo.length) return toast('Aucune facture validée à payer dans la sélection', 3000);
      const v = await ask(`Paiement de ${todo.length} facture(s) – ${money(todo.reduce((a, e) => a + purchRest(e.data), 0))}`, [{ name: 'date', label: 'Date du paiement', type: 'date' }, { name: 'method', label: 'Mode', type: 'select', options: PAY_METHODS.map((x) => [x, x]) }], { date: today(), method: 'Virement' });
      if (!v) return;
      for (const e of todo) { const d = e.data; d.payments = d.payments || []; const r = purchRest(d); d.payments.push({ date: v.date || today(), amount: r, method: v.method }); purchLog(d, `Paiement de ${money(r)} (${v.method}) le ${fmtDate(v.date)}`); purchSyncPaid(d); await persist('expense', e, { silent: true }); }
      toast(`${todo.length} facture(s) payée(s)`, 2500); done();
    } },
    { label: 'Exporter en CSV', icon: 'download', run: () => downloadCSV('factures-fournisseurs-selection.csv', [['Date', 'Reference', 'Fournisseur', 'HT', 'TTC', 'Paye', 'Reste', 'Echeance', 'Statut', 'IBAN', 'Communication'],
      ...list.map((e) => [fmtDate(e.data.date), e.data.ref, contactName(byId(contacts, e.data.supplierId)), fnum(num(e.data.amount)), fnum(purchTtc(e.data)), fnum(purchPaid(e.data)), fnum(purchRest(e.data)), fmtDate(e.data.due), PURCH_ST[purchState(e)][0], e.data.iban || '', e.data.structured ? commFmt(e.data.communication || '') : (e.data.communication || '')])]) },
    { label: 'Refuser', icon: 'x', run: async () => { if (!confirm(`Refuser ${n} facture(s) ?`)) return; for (const e of list) { e.data.refused = true; purchLog(e.data, 'Facture refusée'); await persist('expense', e, { silent: true }); } done(); } },
    { sep: true },
    { label: 'Supprimer', icon: 'trash', danger: true, run: async () => { if (!confirm(`Supprimer définitivement ${n} facture(s) fournisseur ?`)) return; for (const e of list) { await delFile(e.data.fileId); if (e.data.xmlFileId) await delFile(e.data.xmlFileId); await db.del('expense', e.id); } done(); } },
  ]);
}

function purchComments(e) {
  const d = e.data; d.comments = d.comments || [];
  const m = modal(`${mhead(`Commentaires – ${d.ref || 'facture'}`)}<div class="m-body"><div class="feed" data-list>${d.comments.map((c) => `<div><b>${esc(userName(c.uid))}</b> ${esc(c.text)}<small class="muted">${fmtDT(c.t)}</small></div>`).join('') || '<p class="muted">Aucun commentaire.</p>'}</div>
    <label class="field"><span>Nouveau commentaire</span><textarea rows="3" data-txt placeholder="ex. livraison incomplète, attendre la note de crédit…"></textarea></label></div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-add>Ajouter</button></div>`);
  $$('[data-close]', m.el).forEach((b) => { b.onclick = () => m.close(); });
  $('[data-add]', m.el).onclick = async () => {
    const t = $('[data-txt]', m.el).value.trim(); if (!t) return;
    d.comments.push({ t: new Date().toISOString(), uid: S.me.id, text: t });
    await persist('expense', e); m.close(); render();
  };
}

// ---------------------------------------------------------------- Page de vérification / saisie
route('purchase', async (id) => {
  const isNew = id === 'new';
  const draft = isNew ? { ...(S.purchaseDraft || {}) } : null;
  const e = isNew ? { project_id: draft.project_id ? +draft.project_id : null, data: { date: today(), category: 'mat', ...draft, project_id: undefined } } : await db.get('expense', +id);
  S.purchaseDraft = null;
  const [contacts, projects, all] = await Promise.all([db.list('contact'), db.list('project'), db.list('expense')]);
  const d = JSON.parse(JSON.stringify(e.data));
  // même fournisseur et même n° de facture déjà encodé : probablement un doublon
  const dup = d.ref && d.supplierId ? all.find((x) => x.id !== e.id && x.data.ref === d.ref && +x.data.supplierId === +d.supplierId) : null;
  const vat = purchVat(d); let ttc = purchTtc(d); let manualVat = vat.length > 1;
  // TVA lue de travers à l'import (ex. le total pris pour la TVA) : recalculée depuis le TTC
  if (vat.length === 1 && ttc && Math.abs(vat[0].amount) >= Math.abs(ttc) * 0.5) vat[0].amount = r2(ttc - ttc / (1 + num(vat[0].rate) / 100));
  const alloc = Array.isArray(d.alloc) && d.alloc.length ? d.alloc.map((x) => ({ pid: x.pid || '', amount: num(x.amount), category: x.category || d.category }))
    : e.project_id ? [{ pid: e.project_id, amount: num(d.amount), category: d.category || 'mat' }] : [];
  let fileId = d.fileId; let fileName = d.fileName;
  let guess = !d.supplierId ? d.supplierGuess : null;
  const st = isNew ? 'avalider' : purchState(e);
  const page = layout({ active: 'finances', icon: 'coins', back: '#/expenses',
    title: `${isNew ? 'Nouvelle facture fournisseur' : 'Facture fournisseur'}${d.ref ? ' – ' + d.ref : ''}`,
    sub: `${badge(PURCH_ST[st][0], PURCH_ST[st][1])}${d.source || d.peppol ? ` <span class="muted">${esc(PURCH_SRC[d.source] || 'Peppol')}</span>` : ''}` });
  const supOpts = contacts.filter((c) => ['fournisseur', 'soustraitant', 'autre'].includes(c.data.kind) || c.id === +d.supplierId);
  const vatOpts = (r) => [...new Set([...vatList(), num(r)])].sort((a, b) => b - a).map((x) => `<option value="${x}" ${num(r) === x ? 'selected' : ''}>${fnum(x)} %</option>`).join('');
  page.innerHTML = `<div class="pi">
    <section class="card"><div class="card-h"><h3>Informations générales</h3></div>
      ${d.refused ? `<div class="hint-box warn">Facture refusée${d.refuseReason ? ' : ' + esc(d.refuseReason) : ''}.</div>` : ''}
      ${d.readNote && st === 'avalider' ? `<div class="hint-box">${esc(d.readNote)}${/\.pdf$/i.test(d.fileName || '') ? ` <button type="button" class="link-btn" data-reread>Relire la facture</button>` : ''}</div>` : ''}
      ${dup ? `<div class="hint-box warn">⚠ Doublon probable : la facture ${esc(d.ref)} de ce fournisseur existe déjà (${fmtDate(dup.data.date)}, ${money(dup.data.amount)} HT). <a href="#/purchase/${dup.id}">Ouvrir l'autre</a></div>` : ''}
      <div class="pi-grid">
        <form class="pi-form" autocomplete="off" onsubmit="return false">
          <div class="section-t">Détails de la facture</div>
          ${fieldsGrid([
            { name: 'category', label: 'Type de facture *', type: 'select', options: optsOf(TYPES), cls: 'full' },
            { name: 'ref', label: 'Référence (n° de facture) *', cls: 'full' },
            { name: 'date', label: 'Date *', type: 'date' }, { name: 'due', label: 'Date d\'échéance', type: 'date' },
          ], d)}
          <div class="section-t">Coordonnées du fournisseur</div>
          ${fieldsGrid([{ name: 'supplierId', label: 'Fournisseur *', type: 'contact', contacts: supOpts, cls: 'full' }], d)}
          <div data-guessbox></div>
          <div class="pi-amt">
            <label class="field"><span>Montant TTC *</span><input name="ttc" inputmode="decimal" class="r" value="${ttc ? famt(ttc) : ''}"></label>
            <label class="field"><span>Montant HT</span><input name="ht" class="r" readonly tabindex="-1"></label>
          </div>
          <div data-vat></div>
          <div class="pi-vatfoot"><button type="button" class="link-btn" data-addvat>${I.plus} Ajouter une TVA</button><span class="grow"></span><b data-vattot></b></div>
          <div class="section-t">Coordonnées de paiement</div>
          ${fieldsGrid([{ name: 'iban', label: 'IBAN' }, { name: 'bic', label: 'BIC / Swift' }], d)}
          <div class="field full pi-comm"><span class="pi-comm-h">Communication <label class="toggle"><input type="checkbox" name="structured" ${d.structured ? 'checked' : ''}><i></i> Structurée</label></span>
            <input name="communication" value="${esc(d.structured ? commFmt(d.communication || '') : (d.communication || ''))}" placeholder="+++123/4567/89012+++"><small class="muted" data-commok></small></div>
          ${fieldsGrid([{ name: 'desc', label: 'Libellé (facultatif)', cls: 'full', placeholder: 'ex. Matériaux toiture' }], d)}
        </form>
        <div class="pi-view" data-view></div>
      </div>
    </section>
    <section class="card"><div class="card-h"><h3>Lier la facture à un chantier</h3></div><div class="pi-alloc" data-alloc></div></section>
    ${isNew ? '' : '<section class="card" data-pays></section>'}
  </div>
  <div class="pi-bar"><span class="grow"></span><button class="btn" data-cancel>Annuler</button><span class="btn-split"><button class="btn primary" data-submit>Soumettre</button><button class="btn primary" data-moresub aria-label="Autres actions">${I.chevron}</button></span></div>`;
  const form = $('.pi-form', page);
  const F = (n) => form.elements[n];

  // --- montants : HT = TTC − TVA ; avec un seul taux, la TVA se calcule depuis le TTC
  const totalVat = () => r2(vat.reduce((a, x) => a + num(x.amount), 0));
  const ht = () => r2(num(F('ttc').value) - totalVat());
  const drawAmounts = () => { F('ht').value = famt(ht()); $('[data-vattot]', page).textContent = `Total TVA : ${money(totalVat())}`; drawAllocSummary(); };
  const autoVat = () => { if (vat.length === 1 && !manualVat) { const t = num(F('ttc').value); vat[0].amount = r2(t - t / (1 + num(vat[0].rate) / 100)); } };
  const drawVat = () => {
    $('[data-vat]', page).innerHTML = vat.map((x, i) => `<div class="pi-vat"><label class="field"><span>Taux TVA *</span><select data-vr="${i}">${vatOpts(x.rate)}</select></label>
      <label class="field"><span>Montant TVA *</span><input data-va="${i}" inputmode="decimal" class="r" value="${famt(num(x.amount))}"></label>
      ${vat.length > 1 ? `<button type="button" class="icon-btn" data-vd="${i}" aria-label="Retirer">${I.trash}</button>` : '<span></span>'}</div>`).join('');
    $$('[data-vr]', page).forEach((s) => { s.onchange = () => { vat[+s.dataset.vr].rate = num(s.value); autoVat(); drawVat(); }; });
    $$('[data-va]', page).forEach((inp) => { inp.oninput = () => { vat[+inp.dataset.va].amount = num(inp.value); manualVat = true; drawAmounts(); }; });
    $$('[data-vd]', page).forEach((b) => { b.onclick = () => { vat.splice(+b.dataset.vd, 1); drawVat(); }; });
    drawAmounts();
  };
  F('ttc').addEventListener('input', () => { autoVat(); $$('[data-va]', page).forEach((inp, i) => { if (document.activeElement !== inp) inp.value = famt(num(vat[i].amount)); }); drawAmounts(); });
  $('[data-addvat]', page).onclick = () => { manualVat = true; vat.push({ rate: vatList().find((r) => !vat.some((x) => x.rate === r)) ?? 0, amount: 0 }); drawVat(); };

  // --- communication structurée
  const commCheck = () => {
    const c = F('communication').value; const el = $('[data-commok]', page);
    if (!F('structured').checked || !c.trim()) { el.textContent = ''; return; }
    el.textContent = commOk(c) ? '✓ communication valide' : '✗ communication structurée invalide (vérifiez les chiffres)';
    el.className = commOk(c) ? 'good' : 'late';
  };
  F('communication').addEventListener('blur', () => { if (F('structured').checked && F('communication').value.replace(/\D/g, '').length === 12) F('communication').value = commFmt(F('communication').value); commCheck(); });
  F('communication').addEventListener('input', commCheck); F('structured').onchange = commCheck; commCheck();

  // --- fournisseur détecté : relu dans le PDF (les anciens imports gardaient une lecture erronée)
  const isPdfFile = () => /\.pdf$/i.test(fileName || '');
  let pdfText = null;
  const readPdf = async () => { if (pdfText == null && fileId && isPdfFile()) { try { pdfText = await pdfFileText(fileId); } catch (err) { pdfText = ''; } } return pdfText || ''; };
  const drawGuess = () => {
    const box = $('[data-guessbox]', page);
    box.innerHTML = guess && !F('supplierId').value ? `<div class="hint-box" data-guess>Fournisseur lu sur la facture : <b>${esc(guess.name || '?')}</b>${guess.vat ? ` (TVA ${esc(guess.vat)})` : ''} <button type="button" class="btn sm" data-mksup>${I.plus} Créer ce fournisseur</button></div>` : '';
    const mk = $('[data-mksup]', box); if (mk) mk.onclick = createSupplier;
  };
  // fournisseur déjà connu (même n° de TVA) : sélectionné directement
  const applyGuess = (g) => {
    const dg = digitsOf(g.vat || '');
    const known = dg ? contacts.find((c) => digitsOf(c.data.vat) === dg) : null;
    if (known && !F('supplierId').value) {
      if (!$(`option[value="${known.id}"]`, F('supplierId'))) F('supplierId').insertAdjacentHTML('afterbegin', `<option value="${known.id}">${esc(contactName(known))}</option>`);
      F('supplierId').value = known.id; guess = null;
    } else if (!known) guess = g;
    drawGuess();
  };
  const refreshGuess = async () => {
    if (F('supplierId').value || !isPdfFile()) return;
    const g = parseInvoiceText(await readPdf());
    if (g.name || g.vat) applyGuess(supplierGuessOf(g));
  };
  F('supplierId').addEventListener('change', drawGuess);
  async function createSupplier() {
    const g = guess || {};
    const c = await editContact(null, { kind: 'fournisseur', company: g.name || '', vat: g.vat || '', peppolId: g.peppolId || '', address: g.address || '', zip: g.zip || '', city: g.city || '', email: g.email || '', phone: g.phone || '', iban: F('iban').value || g.iban || '' },
      { side: fileId ? (box, cform) => invoiceSide(box, cform, () => ({ fileId, fileName }), readPdf) : null });
    if (!c) return;
    F('supplierId').insertAdjacentHTML('afterbegin', `<option value="${c.id}">${esc(contactName(c))}</option>`); F('supplierId').value = c.id;
    contacts.push(c); guess = null; drawGuess();
  }
  drawGuess(); refreshGuess();
  // relecture complète du PDF (factures importées avant une amélioration de la lecture)
  const reread = async () => {
    if (!fileId || !isPdfFile()) return toast('Pas de PDF joint');
    toast('Lecture de la facture…', 8000); pdfText = null;
    const g = parseInvoiceText(await readPdf());
    if (g.ref) F('ref').value = g.ref; if (g.date) F('date').value = g.date; if (g.due) F('due').value = g.due;
    if (g.iban) F('iban').value = g.iban; if (g.bic) F('bic').value = g.bic;
    if (g.comm) { F('communication').value = commFmt(g.comm); F('structured').checked = g.comm.length === 12; commCheck(); }
    if (g.total != null) {
      F('ttc').value = famt(g.total);
      vat.length = 0; vat.push({ rate: g.rate != null ? g.rate : defVat(), amount: g.tax != null ? g.tax : 0 }); manualVat = g.tax != null; if (!manualVat) autoVat(); drawVat();
    }
    if (g.name || g.vat) { if (!F('supplierId').value) applyGuess(supplierGuessOf(g)); }
    toast(`Relu : ${[g.ref && 'n° ' + g.ref, g.date && fmtDate(g.date), g.total != null && 'total ' + money(g.total), g.name].filter(Boolean).join(' · ') || 'peu d\'informations reconnues'}`, 4000);
  };
  const rr = $('[data-reread]', page); if (rr) rr.onclick = reread;

  // --- liaison aux chantiers
  const pOpts = (sel) => `<option value="">— choisir un chantier —</option>${projects.map((p) => `<option value="${p.id}" ${+sel === p.id ? 'selected' : ''}>${esc(`${p.number} · ${p.data.name}`)}</option>`).join('')}`;
  const tOpts = (sel) => Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const linked = () => r2(alloc.reduce((a, x) => a + num(x.amount), 0));
  function drawAllocSummary() {
    const box = $('[data-sum]', page); if (!box) return;
    const rest = r2(ht() - linked());
    box.innerHTML = `<div><span>Montant HT de la facture</span><b>${money(ht())}</b></div><div><span>Montant total lié</span><b>- ${money(linked())}</b></div><div class="dark ${Math.abs(rest) < 0.01 ? 'ok' : rest < 0 ? 'neg' : ''}"><span>Montant restant à lier</span><b>${money(rest)}</b></div>`;
  }
  const drawAlloc = () => {
    const box = $('[data-alloc]', page);
    box.innerHTML = `${alloc.length ? `<div class="pi-rows">${alloc.map((a, i) => `<div class="pi-row" data-i="${i}">
        <label class="field"><span>Chantier</span><select data-k="pid">${pOpts(a.pid)}</select></label>
        <label class="field"><span>Montant HT</span><input data-k="amount" inputmode="decimal" class="r" value="${a.amount === '' ? '' : famt(num(a.amount))}"></label>
        <label class="field"><span>Type de coût</span><select data-k="category">${tOpts(a.category || F('category').value)}</select></label>
        <div class="pi-row-b"><button type="button" class="btn sm" data-rest="${i}">= reste</button><button type="button" class="icon-btn" data-rm="${i}" aria-label="Retirer">${I.trash}</button></div></div>`).join('')}</div>
        <button type="button" class="btn" data-add>${I.plus} Ajouter</button>`
      : `<div class="empty pi-empty"><div class="pi-empty-ic">${I.crane}</div><b>Aucune liaison pour l'instant</b><p class="muted">Liez la facture à un ou plusieurs chantiers : chaque part s'ajoute au suivi financier du chantier.</p><button type="button" class="btn primary" data-add>${I.plus} Ajouter</button></div>`}
      <div class="pi-sum" data-sum></div>`;
    $$('.pi-row', box).forEach((row) => {
      const i = +row.dataset.i;
      $$('[data-k]', row).forEach((inp) => { inp.oninput = inp.onchange = () => { alloc[i][inp.dataset.k] = inp.dataset.k === 'amount' ? num(inp.value) : inp.value; drawAllocSummary(); }; });
      $('[data-rm]', row).onclick = () => { alloc.splice(i, 1); drawAlloc(); };
      $('[data-rest]', row).onclick = () => { alloc[i].amount = r2(ht() - alloc.reduce((s, a, j) => s + (j === i ? 0 : num(a.amount)), 0)); drawAlloc(); };
    });
    $('[data-add]', box).onclick = () => { alloc.push({ pid: '', amount: r2(Math.max(0, ht() - linked())), category: F('category').value }); drawAlloc(); };
    drawAllocSummary();
  };

  // --- facture affichée à droite
  const view = $('[data-view]', page);
  const viewer = purchViewer(view, () => ({ fileId, fileName }), async (act) => {
    if (act === 'remove') { if (!confirm('Retirer la facture jointe ?')) return; fileId = null; fileName = null; viewer.draw(); return; }
    const [file] = await pickFile('application/pdf,image/*'); if (!file) return;
    toast('Envoi…', 15000);
    const r = file.type.startsWith('image/') ? await uploadPhoto(file) : await upload(file);
    fileId = r.id; fileName = r.name; pdfText = null; toast('Facture jointe', 1500); viewer.draw();
  });

  // --- paiements (en plusieurs tranches) : enregistrés tout de suite sur la facture
  const drawPays = () => {
    const box = $('[data-pays]', page); if (!box) return;
    const ed = e.data; const s2 = purchState(e); const pays = ed.payments || [];
    const tt = purchTtc(ed); const paid = purchPaid(ed);
    box.innerHTML = `<div class="card-h"><h3>Paiements</h3>${badge(PURCH_ST[s2][0], PURCH_ST[s2][1])}<span class="grow"></span>${!['avalider', 'refusee', 'payee'].includes(s2) ? `<button type="button" class="btn sm primary" data-addpay>${I.plus} Ajouter un paiement</button>` : ''}</div>
      ${s2 === 'avalider' ? '<p class="muted">Soumettez (validez) la facture pour pouvoir enregistrer les paiements.</p>' : ''}
      ${pays.length ? `<table class="dt pay-tbl"><thead><tr><th>Date</th><th>Mode</th><th>Remarque</th><th class="r">Montant</th></tr></thead><tbody>${pays.map((x, i) => `<tr data-pi="${i}"><td>${fmtDate(x.date)}</td><td>${esc(x.method || '')}</td><td>${esc(x.note || '')}</td><td class="r"><b>${money(x.amount)}</b></td></tr>`).join('')}</tbody></table>`
        : ed.paid ? `<p>Payée le ${fmtDate(ed.paidDate)}.</p>` : s2 !== 'avalider' ? '<p class="muted">Aucun paiement enregistré.</p>' : ''}
      <div class="pay-info"><div><span>Montant TTC</span><b>${money(tt)}</b></div><div><span>Déjà payé</span><b>${money(paid)}</b></div><div class="dark ${s2 === 'retard' ? 'neg' : purchRest(ed) === 0 ? 'ok' : ''}"><span>Reste à payer${ed.due ? ` · échéance ${fmtDate(ed.due)}` : ''}</span><b>${money(purchRest(ed))}</b></div></div>`;
    const ap = $('[data-addpay]', box); if (ap) ap.onclick = () => purchPayment(e, null, drawPays);
    $$('[data-pi]', box).forEach((tr) => { tr.onclick = () => purchPayment(e, +tr.dataset.pi, drawPays); });
  };
  drawPays();

  drawVat(); drawAlloc();

  // --- enregistrement
  const save = async (mode) => {
    const v = readFields(form, [{ name: 'category' }, { name: 'ref' }, { name: 'date' }, { name: 'due' }, { name: 'supplierId', type: 'contact' }, { name: 'iban' }, { name: 'bic' }, { name: 'desc' }, { name: 'communication' }]);
    const t = num(F('ttc').value);
    if (mode !== 'draft') {
      const miss = [!v.category && 'type de facture', !v.ref && 'référence', !v.date && 'date', !v.supplierId && 'fournisseur', !F('ttc').value.trim() && 'montant TTC'].filter(Boolean);
      if (miss.length) return toast('À compléter : ' + miss.join(', '), 4000);
    }
    const rows = alloc.filter((a) => num(a.amount) !== 0);
    if (rows.some((a) => !a.pid)) return toast('Choisissez le chantier de chaque liaison', 4000);
    if (linked() - ht() > 0.01) return toast(`Les liaisons (${money(linked())}) dépassent le montant HT (${money(ht())})`, 5000);
    await resolveContact(v, 'supplierId', 'fournisseur');
    const lines = vat.filter((x) => num(x.amount) !== 0 || vat.length === 1).map((x) => ({ rate: num(x.rate), amount: r2(num(x.amount)) }));
    const main = [...lines].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0] || { rate: defVat() };
    const structured = F('structured').checked;
    // paiements, historique et refus : modifiés directement sur la facture, on garde leur état actuel
    const keep = { payments: e.data.payments, paid: e.data.paid, paidDate: e.data.paidDate, history: e.data.history, refused: e.data.refused, refuseReason: e.data.refuseReason, comments: e.data.comments };
    const wasOpen = e.data.status !== 'avalider' && !e.data.toCheck;
    Object.assign(e.data, d, keep, {
      category: v.category, ref: v.ref, date: v.date, due: v.due, supplierId: v.supplierId ? +v.supplierId : null, iban: v.iban.replace(/\s/g, '').toUpperCase(), bic: v.bic.toUpperCase(),
      communication: structured ? v.communication.replace(/\D/g, '') : v.communication, structured,
      desc: v.desc || `Facture ${v.ref || ''}`.trim(), ttc: r2(t), vatLines: lines, vatAmount: totalVat(), vat: main.rate, amount: ht(), fileId, fileName,
      status: mode === 'draft' ? 'avalider' : 'validee', toCheck: mode === 'draft',
    });
    if (mode !== 'draft' && !wasOpen) purchLog(e.data, 'Facture validée');
    if (mode === 'paid' && purchRest(e.data) > 0.009) { const r = purchRest(e.data); (e.data.payments = e.data.payments || []).push({ date: today(), amount: r, method: 'Virement' }); purchLog(e.data, `Paiement de ${money(r)} le ${fmtDate(today())}`); purchSyncPaid(e.data); }
    ['readNote', 'supplierGuess', 'project_id'].forEach((k) => delete e.data[k]);
    if (rows.length === 1 && Math.abs(num(rows[0].amount) - ht()) < 0.01) { e.project_id = +rows[0].pid; e.data.category = rows[0].category || e.data.category; delete e.data.alloc; }
    else if (rows.length) { e.project_id = null; e.data.alloc = rows.map((a) => ({ pid: +a.pid, amount: r2(num(a.amount)), category: a.category || e.data.category })); }
    else { e.project_id = null; delete e.data.alloc; }
    await persist('expense', e);
    toast(mode === 'draft' ? 'Enregistrée (à valider)' : mode === 'paid' ? 'Facture soumise et marquée payée' : 'Facture soumise', 2500);
    go('#/expenses');
  };
  $('[data-submit]', page).onclick = () => save('submit');
  $('[data-cancel]', page).onclick = () => (history.length > 1 ? history.back() : go('#/expenses'));
  $('[data-moresub]', page).onclick = () => menuSheet('Enregistrer', [
    { label: 'Soumettre et marquer payée', icon: 'coins', run: () => save('paid') },
    { label: 'Enregistrer sans valider (reste « À valider »)', icon: 'file', run: () => save('draft') },
    ...(fileId && isPdfFile() ? [{ label: 'Relire la facture (PDF)', icon: 'eye', run: reread }] : []),
    ...(isNew ? [] : [e.data.refused ? { label: 'Annuler le refus', icon: 'check', run: async () => { e.data.refused = false; purchLog(e.data, 'Refus annulé'); await persist('expense', e); render(); } } : { label: 'Refuser la facture', icon: 'x', run: () => purchRefuse(e) },
      { label: 'Afficher l\'historique', icon: 'hist', run: () => purchHistory(e) }]),
    ...(isNew ? [] : [{ sep: true }, { label: 'Supprimer la facture', icon: 'trash', danger: true, run: async () => { if (!confirm('Supprimer cette facture fournisseur ?')) return; await delFile(d.fileId); if (d.xmlFileId) await delFile(d.xmlFileId); await db.del('expense', e.id); go('#/expenses'); } }]),
  ]);
});

// Panneau « facture » à côté d'une fiche : aperçu + texte du PDF ; un rang du texte se copie dans le champ actif
function invoiceSide(box, form, getFile, readText) {
  let field = form.elements.company; let tab = 'doc';
  form.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=checkbox]),textarea')) field = e.target; });
  const labelOf = (el) => { const l = el.closest('label'); return l ? ($('span', l) || l).textContent.trim() : el.name; };
  box.innerHTML = `<div class="m-side-tabs"><button type="button" class="on" data-t="doc">Facture</button><button type="button" data-t="txt">Texte à copier</button></div><div class="m-side-body" data-sb></div>`;
  const sb = $('[data-sb]', box);
  const draw = async () => {
    $$('[data-t]', box).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'doc') { sb.innerHTML = ''; purchViewer(sb, getFile, () => {}); return; }
    sb.innerHTML = '<p class="muted pi-load">Lecture…</p>';
    const lines = invoiceTextLines(await readText());
    if (tab !== 'txt') return;
    sb.innerHTML = lines.length ? `<p class="muted m-side-hint">Touchez un champ de la fiche, puis une ligne : elle y est copiée. Le texte peut aussi être sélectionné.</p>
      <div class="m-lines">${lines.map((l, i) => `<div class="m-line"><span>${esc(l)}</span><button type="button" class="link-btn" data-l="${i}">→ champ</button></div>`).join('')}</div>`
      : '<p class="muted pi-load">Aucun texte dans ce PDF (document scanné).</p>';
    $$('[data-l]', sb).forEach((b) => { b.onclick = () => {
      const v = lines[+b.dataset.l];
      if (!field) return navigator.clipboard && navigator.clipboard.writeText(v).then(() => toast('Copié'));
      field.value = field.value && field.tagName === 'TEXTAREA' ? `${field.value}\n${v}` : v;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      toast(`Copié dans « ${labelOf(field)} »`, 1500);
    }; });
  };
  $$('[data-t]', box).forEach((b) => { b.onclick = () => { tab = b.dataset.t; draw(); }; });
  draw();
}

// Visionneuse de la facture : PDF (toutes les pages) ou photo, avec zoom, remplacement, retrait et téléchargement
function purchViewer(box, getFile, onAction) {
  let zoom = 1; let seq = 0;
  const draw = async () => {
    const { fileId, fileName } = getFile(); const my = ++seq;
    if (!fileId) {
      box.innerHTML = `<div class="pi-drop"><div class="pi-empty-ic">${I.file}</div><b>Aucune facture jointe</b><p class="muted">Ajoutez le PDF ou une photo de la facture.</p><button type="button" class="btn primary" data-up>${I.plus} Ajouter la facture</button></div>`;
      $('[data-up]', box).onclick = () => onAction('upload'); return;
    }
    const isPdf = /\.pdf$/i.test(fileName || ''); const isImg = /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || '');
    box.innerHTML = `<div class="pi-vbar"><button type="button" class="icon-btn" data-z="-" aria-label="Zoom arrière">−</button><span class="pi-zoom">${Math.round(zoom * 100)} %</span><button type="button" class="icon-btn" data-z="+" aria-label="Zoom avant">+</button>
      <span class="pi-fname" title="${esc(fileName || '')}">${esc(fileName || 'facture')}</span>
      <button type="button" class="icon-btn" data-up title="Remplacer">${I.upload}</button><button type="button" class="icon-btn" data-rm title="Retirer">${I.trash}</button><a class="icon-btn" href="${fileUrl(fileId, true)}" title="Télécharger">${I.download}</a></div>
      <div class="pi-doc" data-doc>${isImg ? `<img src="${fileUrl(fileId)}" alt="" style="width:${zoom * 100}%">` : isPdf ? '<p class="muted pi-load">Chargement de la facture…</p>' : `<p class="muted pi-load">Aperçu indisponible pour ce fichier. <a href="${fileUrl(fileId)}" target="_blank">Ouvrir</a></p>`}</div>`;
    $$('[data-z]', box).forEach((b) => { b.onclick = () => { zoom = Math.min(3, Math.max(0.5, r2(zoom + (b.dataset.z === '+' ? 0.25 : -0.25)))); draw(); }; });
    $('[data-up]', box).onclick = () => onAction('upload'); $('[data-rm]', box).onclick = () => onAction('remove');
    if (!isPdf) return;
    try {
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await (await fetch(fileUrl(fileId), { credentials: 'same-origin' })).arrayBuffer());
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      if (my !== seq) return;
      const holder = $('[data-doc]', box); holder.innerHTML = '';
      const w = Math.max(280, holder.clientWidth - 16) * zoom; const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (let i = 1; i <= Math.min(doc.numPages, 15); i++) {
        const pg = await doc.getPage(i); if (my !== seq) return;
        const v1 = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: (w / v1.width) * dpr });
        const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height); c.style.width = `${Math.floor(vp.width / dpr)}px`;
        holder.appendChild(c);
        await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } catch (err) { const h = $('[data-doc]', box); if (h) h.innerHTML = `<p class="muted pi-load">Aperçu impossible (${esc(err.message)}). <a href="${fileUrl(fileId)}" target="_blank">Ouvrir le PDF</a></p>`; }
  };
  draw();
  return { draw };
}
