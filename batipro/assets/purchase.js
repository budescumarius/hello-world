'use strict';
/* Factures fournisseurs : liste avec statuts (À valider → À payer → Payée) et page de vérification avec la facture affichée à côté. */

const PURCH_ST = { avalider: ['À valider', '#f08c00'], retard: ['En retard', '#e5484d'], partiel: ['Part. payée', '#0c8599'], apayer: ['À payer', '#3b5bdb'], payee: ['Payée', '#2f9e44'], refusee: ['Refusée', '#868e96'] };
// montant saisi : toujours 2 décimales (« 883,30 »)
const famt = (x) => (num(x) || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PURCH_SRC = { reprise: 'Reprise ancien logiciel', peppol: 'Peppol', pdf: 'PDF importé', xml: 'XML importé', photo: 'Photo' };
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
// échéance d'une facture fournisseur : en retard (rouge), bientôt (orange, 7 jours), payée (grisée)
function purchDueHtml(e) {
  const d = e.data.due; if (!d) return '<span class="muted">—</span>';
  const s = purchState(e); const days = dnum(d) - dnum(today());
  if (s === 'payee' || s === 'refusee') return `<span class="muted nowrap">${fmtDate(d)}</span>`;
  if (days < 0) return `<b class="late nowrap">${fmtDate(d)}</b><br><small class="late nowrap">${-days} j de retard</small>`;
  if (days <= 7) return `<b class="rest-due nowrap">${fmtDate(d)}</b><br><small class="rest-due nowrap">${days === 0 ? 'aujourd\'hui' : `dans ${days} j`}</small>`;
  return `<span class="nowrap">${fmtDate(d)}</span>`;
}
// Détail du « Reste à payer » : chaque facture qui le compose, par fournisseur, avec les points à vérifier
// (doublon possible, TTC différent de HT + TVA, TVA facturée par un sous-traitant, note de crédit, montant payé supérieur)
function purchRestDetail(unpaid, all, contacts) {
  const name = (e) => contactName(byId(contacts, e.data.supplierId));
  const flags = (e) => {
    const d = e.data; const f = [];
    const same = all.filter((x) => x.id !== e.id && purchState(x) !== 'refusee' && +x.data.supplierId === +d.supplierId
      && ((d.ref && String(x.data.ref || '').trim().toLowerCase() === String(d.ref).trim().toLowerCase()) || (Math.abs(purchTtc(x.data) - purchTtc(d)) < 0.01 && x.data.date === d.date)));
    if (same.length) f.push(['Doublon possible', `même fournisseur et ${same.some((x) => String(x.data.ref || '').trim().toLowerCase() === String(d.ref || '').trim().toLowerCase()) ? 'même référence' : 'même montant et même date'}`]);
    const calc = r2(num(d.amount) + purchVat(d).reduce((a, x) => a + x.amount, 0));
    if (d.ttc != null && d.ttc !== '' && Math.abs(calc - num(d.ttc)) > 0.05) f.push(['TTC ≠ HT + TVA', `encodé ${money(num(d.ttc))}, calculé ${money(calc)}`]);
    const sup = byId(contacts, d.supplierId); const vatAmt = purchVat(d).reduce((a, x) => a + x.amount, 0);
    if ((d.category === 'st' || (sup && sup.data.kind === 'soustraitant')) && vatAmt > 0.005) f.push(['TVA d\'un sous-traitant', `${money(vatAmt)} de TVA comptée : travaux en autoliquidation (0 %) ?`]);
    if (purchTtc(d) < 0) f.push(['Note de crédit', 'montant négatif, déduit du total']);
    if (purchPaid(d) - purchTtc(d) > 0.01) f.push(['Payé plus que la facture', `payé ${money(purchPaid(d))}`]);
    return f;
  };
  const list = [...unpaid].sort((a, b) => name(a).localeCompare(name(b)) || (a.data.date || '').localeCompare(b.data.date || ''));
  const total = r2(list.reduce((a, e) => a + purchRest(e.data), 0));
  const part = (s) => r2(list.filter((e) => purchState(e) === s).reduce((a, e) => a + purchRest(e.data), 0));
  const credits = r2(list.filter((e) => purchRest(e.data) < 0).reduce((a, e) => a + purchRest(e.data), 0));
  const flagged = list.map((e) => [e, flags(e)]).filter(([, f]) => f.length);
  const groups = []; for (const e of list) { const n = name(e); const g = groups.find((x) => x.n === n) || (groups.push({ n, l: [] }), groups[groups.length - 1]); g.l.push(e); }
  const m = modal(`${mhead('Détail du reste à payer')}<div class="m-body rd">
    <div class="pay-rest"><div><span>À payer (non échues)</span><b>${money(part('apayer'))}</b></div><div><span>En retard</span><b>${money(part('retard'))}</b></div><div><span>Partiellement payées (reste)</span><b>${money(part('partiel'))}</b></div>
      ${credits ? `<div><span>dont notes de crédit (déduites)</span><b>${money(credits)}</b></div>` : ''}<div class="big due"><span>Reste à payer TVAC (${list.length} facture(s))</span><b>${money(total)}</b></div></div>
    <p class="muted sm">Seules les factures validées comptent (pas celles « À valider » ni « Refusées »). Le reste = TTC − paiements enregistrés (y compris ceux du rapprochement bancaire).</p>
    ${flagged.length ? `<div class="alert warn"><b>${flagged.length} facture(s) à vérifier</b> – c'est souvent là que se trouve un écart avec un calcul à la main :<ul class="rd-flags">${flagged.map(([e, f]) => `<li><a href="#/purchase/${e.id}">${esc(name(e))} · ${esc(e.data.ref || '—')}</a> (${money(purchRest(e.data))}) : ${f.map(([t, x]) => `<b>${esc(t)}</b> – ${esc(x)}`).join(' ; ')}</li>`).join('')}</ul></div>` : '<p class="good">✓ Aucun doublon ni montant incohérent détecté.</p>'}
    <table class="dt rd-t"><thead><tr><th>Fournisseur / référence</th><th>Date</th><th>Échéance</th><th class="r">TTC</th><th class="r">Payé</th><th class="r">Reste</th></tr></thead><tbody>
      ${groups.map((g) => `<tr class="rd-g"><td colspan="5"><b>${esc(g.n)}</b> <small class="muted">${g.l.length} facture(s)</small></td><td class="r"><b>${money(r2(g.l.reduce((a, e) => a + purchRest(e.data), 0)))}</b></td></tr>
        ${g.l.map((e) => `<tr><td><a href="#/purchase/${e.id}">${esc(e.data.ref || '—')}</a>${flags(e).length ? ' <span class="late" title="À vérifier">⚠</span>' : ''}</td><td class="nowrap">${fmtDate(e.data.date)}</td><td>${purchDueHtml(e)}</td><td class="r nowrap">${money(purchTtc(e.data))}</td><td class="r nowrap">${money(purchPaid(e.data))}</td><td class="r nowrap"><b>${money(purchRest(e.data))}</b></td></tr>`).join('')}`).join('')}
      <tr class="rd-g"><td colspan="5"><b>Total</b></td><td class="r"><b>${money(total)}</b></td></tr></tbody></table></div>
    <div class="m-foot"><button class="btn" data-csv>${I.download || ''} Export CSV</button><span class="grow"></span><button class="btn primary" data-close>Fermer</button></div>`, { wide: true });
  $$('a[href^="#/purchase/"]', m.el).forEach((a) => { a.addEventListener('click', () => m.close()); });
  $('[data-csv]', m.el).onclick = () => downloadCSV('reste-a-payer.csv', [['Fournisseur', 'Référence', 'Date', 'Échéance', 'TTC', 'Payé', 'Reste', 'À vérifier'],
    ...list.map((e) => [name(e), e.data.ref, fmtDate(e.data.date), fmtDate(e.data.due), fnum(purchTtc(e.data)), fnum(purchPaid(e.data)), fnum(purchRest(e.data)), flags(e).map(([t, x]) => `${t} : ${x}`).join(' | ')])]);
}
function expensesTable(el, rows, contacts, projects, showProject, pid) {
  const amt = (e) => (pid ? expenseAmountFor(e, pid) : num(e.data.amount));
  const cat = (e) => (pid ? (expenseFor(e, pid)[0] || {}).category : e.data.category);
  const where = (e) => {
    if (isSplit(e) || (Array.isArray(e.data.alloc) && e.data.alloc.length)) return `${badge('Ventilé', '#7048e8')} <small class="muted">${expenseParts(e).map((x) => esc(x.pid ? (byId(projects, x.pid) || { data: { name: '?' } }).data.name : 'Frais généraux')).join(', ')}</small>`;
    return e.project_id ? esc((byId(projects, e.project_id) || { data: { name: '?' } }).data.name) : '<span class="muted">—</span>';
  };
  S.purchSupKind = Object.fromEntries(contacts.map((c) => [c.id, c.data.kind]));
  const key = `exp_${pid || 'all'}`;
  const st = ui[key] || (ui[key] = { sort: 7 });
  if (!(st.sel instanceof Set)) st.sel = new Set(); // la sélection n'est pas gardée d'une visite à l'autre
  const sel = st.sel;
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
      { l: 'Référence', v: (e) => `${esc(e.data.ref || '—')}${e.data.external ? ` ${repriseBadge('achat')}` : ''}${e.data.desc && e.data.desc !== `Facture ${e.data.ref}` ? `<br><small class="muted">${esc(e.data.desc.slice(0, 60))}</small>` : ''}` },
      ...(showProject ? [{ l: 'Chantier', v: where }] : []),
      { l: pid ? 'HT (part du chantier)' : 'Montant HT', cls: 'r', v: (e) => `<b>${money(amt(e))}</b>${pid && Array.isArray(e.data.alloc) && e.data.alloc.length ? `<br><small class="muted">sur ${money(e.data.amount)}</small>` : ''}`, sort: amt },
      { l: 'Échéance', v: purchDueHtml, sort: (e) => e.data.due || '9999' },
      { l: 'Statut', v: purchStatusHtml, sort: (e) => Object.keys(PURCH_ST).indexOf(purchState(e)) },
      { l: '', v: (e) => `<span class="row-acts">${purchState(e) === 'avalider' ? `<button class="icon-btn sm good" data-ok="${e.id}" title="Valider">✓</button>` : open(e) && purchState(e) !== 'payee' ? `<button class="icon-btn sm" data-pay="${e.id}" title="Ajouter le paiement">€</button>` : ''}<button class="icon-btn sm" data-cm="${e.id}" title="Commentaires">${I.chat}${(e.data.comments || []).length ? `<i class="cnt">${e.data.comments.length}</i>` : ''}</button><button class="icon-btn sm" data-ed="${e.id}" title="Modifier">${I.edit}</button><button class="icon-btn sm" data-mo="${e.id}" title="Plus">${I.more}</button></span>` },
    ],
    onRow: (e) => go(`#/purchase/${e.id}`), empty: 'Aucune facture fournisseur',
    footer: (l) => { const o = l.filter(open); return `<tr><td colspan="${showProject ? 10 : 9}"><div class="inv-tot"><div><small>Total HT</small><b>${money(sum(l, amt))}</b></div>${pid ? '' : `<div><small>Total TVA</small><b>${money(sum(l, (e) => purchTtc(e.data) - num(e.data.amount)))}</b></div><div><small>Total TTC</small><b>${money(sum(l, (e) => purchTtc(e.data)))}</b></div><div><small>Déjà payé</small><b>${money(sum(o, (e) => purchPaid(e.data)))}</b></div><div><small>Total à payer</small><b>${money(sum(o, (e) => purchRest(e.data)))}</b></div>`}</div></td></tr>`; },
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
  // sous-traitant : retenues ONSS / SPF Finances et vérification du jour
  const rt = d.retention || {}; const rk = typeof retentionCalc === 'function' ? retentionCalc(d) : null;
  const retPaid = (m) => (d.payments || []).filter((x) => x.method === m).reduce((a, x) => a + num(x.amount), 0);
  const retChips = rk && rt.result && rt.result !== 'none' ? [
    ...(rk.social && !retPaid('Retenue ONSS') ? [['Retenue ONSS', rk.social]] : []), ...(rk.fiscal && !retPaid('Retenue SPF Finances') ? [['Retenue SPF Finances', rk.fiscal]] : []),
    ['Virement', Math.min(rest, r2(rk.toSupplier - (d.payments || []).filter((x) => !/^Retenue/.test(x.method)).reduce((a, x) => a + num(x.amount), 0)))]].filter(([, v]) => v > 0.009) : [];
  const retWarn = d.retention !== undefined || (S.purchSupKind && S.purchSupKind[d.supplierId] === 'soustraitant')
    ? (!rt.result ? 'Sous-traitant : vérifiez l\'obligation de retenue avant de payer.' : rt.date !== today() ? `Obligation de retenue vérifiée le ${fmtDate(rt.date)} : à refaire le jour du paiement.` : '') : '';
  const p = i == null ? { date: today(), amount: famt(rest), method: 'Virement' } : { ...d.payments[i], amount: famt(d.payments[i].amount) };
  formModal({
    title: i == null ? `Ajouter un paiement – ${d.ref || 'facture'}` : 'Paiement', values: p, saveLabel: 'Enregistrer le paiement',
    extra: `<div class="pay-info"><div><span>Montant TTC</span><b>${money(purchTtc(d))}</b></div><div><span>Déjà payé</span><b>${money(purchPaid(d) - (i == null ? 0 : num(d.payments[i].amount)))}</b></div><div class="dark"><span>Reste à payer</span><b>${money(i == null ? rest : rest + num(d.payments[i].amount))}</b></div></div>
      <div class="pay-quick">${i == null ? (retChips.length ? retChips.map(([m, v], j) => `<button type="button" class="chip" data-rc="${j}">${esc(m === 'Virement' ? 'Au sous-traitant' : m)} (${money(v)})</button>`).join('') : `<button type="button" class="chip" data-pq="1">Tout (${money(rest)})</button><button type="button" class="chip" data-pq="0.5">50 %</button>`) : ''}</div>
      ${retWarn && i == null ? `<div class="hint-box warn">${esc(retWarn)}</div>` : ''}`,
    fields: [{ name: 'amount', label: 'Montant payé', required: true }, { name: 'date', label: 'Date du paiement', type: 'date', required: true }, { name: 'method', label: 'Mode', type: 'select', options: [...PAY_METHODS, 'Retenue ONSS', 'Retenue SPF Finances'].map((x) => [x, x]) }, { name: 'note', label: 'Remarque', cls: 'full', placeholder: 'ex. 2e tranche' }],
    after: (form) => { $$('[data-rc]', form).forEach((b) => { b.onclick = () => { const [m, v] = retChips[+b.dataset.rc]; form.elements.amount.value = famt(v); form.elements.method.value = m; }; }); $$('[data-pq]', form).forEach((b) => { b.onclick = () => { form.elements.amount.value = famt(r2(rest * +b.dataset.pq)); }; }); },
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
  S.purchSupKind = Object.fromEntries(contacts.map((c) => [c.id, c.data.kind]));
  // même fournisseur et même n° de facture déjà encodé : probablement un doublon
  const dup = d.ref && d.supplierId ? all.find((x) => x.id !== e.id && x.data.ref === d.ref && +x.data.supplierId === +d.supplierId) : null;
  const vat = purchVat(d); let ttc = purchTtc(d); let manualVat = vat.length > 1;
  // TVA lue de travers à l'import (ex. le total pris pour la TVA) : recalculée depuis le TTC
  if (vat.length === 1 && ttc && Math.abs(vat[0].amount) >= Math.abs(ttc) * 0.5) vat[0].amount = r2(ttc - ttc / (1 + num(vat[0].rate) / 100));
  const alloc = Array.isArray(d.alloc) && d.alloc.length ? d.alloc.map((x) => ({ pid: x.pid || '', amount: num(x.amount), category: x.category || d.category, ...(x.fromItems ? { fromItems: true } : {}) }))
    : e.project_id ? [{ pid: e.project_id, amount: num(d.amount), category: d.category || 'mat' }] : [];
  let fileId = d.fileId; let fileName = d.fileName;
  let guess = !d.supplierId ? d.supplierGuess : null;
  const st = isNew ? 'avalider' : purchState(e);
  const page = layout({ active: 'finances', icon: 'coins', back: '#/expenses',
    title: `${isNew ? 'Nouvelle facture fournisseur' : 'Facture fournisseur'}${d.ref ? ' – ' + d.ref : ''}`,
    sub: `${badge(PURCH_ST[st][0], PURCH_ST[st][1])}${d.external ? ` ${repriseBadge('achat')}` : ''}${d.source || d.peppol ? ` <span class="muted">${esc(PURCH_SRC[d.source] || 'Peppol')}</span>` : ''}` });
  const supOpts = contacts.filter((c) => ['fournisseur', 'soustraitant', 'autre'].includes(c.data.kind) || c.id === +d.supplierId);
  const vatOpts = (r) => [...new Set([...vatList(), num(r)])].sort((a, b) => b - a).map((x) => `<option value="${x}" ${num(r) === x ? 'selected' : ''}>${fnum(x)} %</option>`).join('');
  page.innerHTML = `${d.external ? '<div class="alert info"><b>Dépense reprise d\'un autre logiciel.</b> Elle sert uniquement au suivi du chantier (rentabilité) : elle n\'est pas envoyée au comptable (export comptable).</div>' : ''}<div class="pi">
    <section class="card"><div class="card-h"><h3>Informations générales</h3></div>
      ${d.refused ? `<div class="hint-box warn">Facture refusée${d.refuseReason ? ' : ' + esc(d.refuseReason) : ''}.</div>` : ''}
      ${d.readNote && st === 'avalider' ? `<div class="hint-box">${esc(d.readNote)}${/\.pdf$/i.test(d.fileName || '') ? ` <button type="button" class="link-btn" data-reread>Relire la facture</button>` : ''}</div>` : ''}
      ${dup ? `<div class="hint-box warn">⚠ Doublon probable : la facture ${esc(d.ref)} de ce fournisseur existe déjà (${fmtDate(dup.data.date)}, ${money(dup.data.amount)} HT). <a href="#/purchase/${dup.id}">Ouvrir l'autre</a></div>` : ''}
      <div class="pi-grid">
        <form class="pi-form" autocomplete="off" data-nosubmit>
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
            <label class="field"><span>Montant TTC *</span><input name="ttc" inputmode="decimal" class="r" value="${ttc || (d.ttc !== undefined && d.ttc !== null && d.ttc !== '' && e.id) ? famt(ttc) : ''}"></label>
            <label class="field"><span>Montant HT</span><input name="ht" class="r" readonly tabindex="-1"></label>
          </div>
          <div data-vat></div>
          <div class="pi-vatfoot"><button type="button" class="link-btn" data-addvat>${I.plus} Ajouter une TVA</button><span class="grow"></span><b data-vattot></b></div>
          <div class="section-t">Coordonnées de paiement</div>
          ${fieldsGrid([{ name: 'iban', label: 'IBAN' }, { name: 'bic', label: 'BIC / Swift' }], d)}
          <div class="field full pi-comm"><span class="pi-comm-h">Communication <label class="toggle"><input type="checkbox" name="structured" ${d.structured ? 'checked' : ''}><i></i> Structurée</label></span>
            <input name="communication" value="${esc(d.structured ? commFmt(d.communication || '') : (d.communication || ''))}" placeholder="+++123/4567/89012+++"><small class="muted" data-commok></small></div>
          ${purchRest(d) > 0.009 || !(d.payments || []).length ? `<div class="pi-prepaid"><label class="toggle"><input type="checkbox" name="prepaid" ${d.prepaid ? 'checked' : ''}><i></i> <b>Déjà payée</b></label><small class="muted" data-pphint>la facture est réglée (acquittée, payée par carte, domiciliation…)</small>
            <div class="pi-pp-f" ${d.prepaid ? '' : 'hidden'}>${fieldsGrid([{ name: 'ppdate', label: 'Payée le', type: 'date' }, { name: 'ppmethod', label: 'Mode', type: 'select', options: PAY_METHODS.map((x) => [x, x]) }], { ppdate: (d.prepaid || {}).date || d.date || today(), ppmethod: (d.prepaid || {}).method || 'Virement' })}</div></div>` : ''}
          ${fieldsGrid([{ name: 'desc', label: 'Libellé (facultatif)', cls: 'full', placeholder: 'ex. Matériaux toiture' }], d)}
        </form>
        <div class="pi-view" data-view></div>
      </div>
    </section>
    <section class="card"><div class="card-h"><h3>Lier la facture à un chantier</h3></div><div class="pi-items" data-items></div><div class="pi-alloc" data-alloc></div></section>
    ${isNew ? '' : '<section class="card" data-ret hidden></section><section class="card" data-pays></section>'}
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
  // « Déjà payée » : date et mode ; cochée d'office si la facture se dit acquittée / payée
  const ppBox = F('prepaid');
  if (ppBox) {
    ppBox.onchange = () => { $('.pi-pp-f', page).hidden = !ppBox.checked; };
    const paidHint = async () => {
      if (ppBox.checked || (d.payments || []).length || !(e.data.status === 'avalider' || isNew)) return;
      const txt = isPdfFile() ? await readPdf() : '';
      if (/\bacquitt[ée]e?s?\b|\b(d[ée]j[aà] )?pay[ée]e? (le|par|en|via|comptant)\b|\bbetaald\b|\bvoldaan\b|\bpaid\b/i.test(txt)) {
        ppBox.checked = true; $('.pi-pp-f', page).hidden = false;
        const pm = /carte|card|bancontact|maestro|visa/i.test(txt) ? 'Carte' : /esp[èe]ces|cash|contant/i.test(txt) ? 'Espèces' : /domicili/i.test(txt) ? 'Domiciliation' : 'Virement';
        F('ppmethod').value = pm; $('[data-pphint]', page).innerHTML = '<b>La facture indique qu\'elle est acquittée / payée</b> – décochez si ce n\'est pas le cas';
      }
    };
    paidHint();
  }
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
    $('[data-add]', box).onclick = () => { alloc.push({ pid: '', amount: r2(ht() >= 0 ? Math.max(0, ht() - linked()) : Math.min(0, ht() - linked())), category: F('category').value }); drawAlloc(); };
    drawAllocSummary();
  };

  // --- article par article : chaque ligne de la facture attribuée à un chantier ; les liaisons se calculent toutes seules
  let items = Array.isArray(d.items) ? d.items.map((x) => ({ ...x, desc: x.desc || '', amount: num(x.amount), pid: x.pid || '' })) : [];
  const picked = new Set(); let doneOpen = false;
  const syncAlloc = () => {
    if (!items.some((x) => x.pid)) { if (alloc.length && alloc.every((a) => a.fromItems)) { alloc.length = 0; d.items = items; drawAlloc(); } return; }
    const cat = Object.fromEntries(alloc.map((a) => [a.pid, a.category]));
    const by = {}; items.forEach((x) => { if (x.pid) by[x.pid] = r2((by[x.pid] || 0) + x.amount); });
    alloc.length = 0; Object.entries(by).forEach(([pid, amount]) => alloc.push({ pid: +pid, amount, category: cat[pid] || F('category').value, fromItems: true }));
    d.items = items; drawAlloc();
  };
  const pName = (pid) => { const pp = byId(projects, pid); return pp ? `${pp.number} · ${pp.data.name}` : '?'; };
  // lecture des articles du PDF (relecture : les attributions déjà faites sont reprises pour les articles identiques)
  const readItems = async (btn) => {
    btn.disabled = true; toast('Lecture des articles…', 8000);
    let txt = ''; try { txt = await pdfFileText(fileId, 20); } catch (err) { /* PDF illisible */ }
    const old = items;
    const got = invoiceItemsFromText(txt).map((x, i) => ({ ...x, pid: (old[i] && old[i].desc === x.desc && old[i].pid) || '' }));
    if (!got.length) { btn.disabled = false; return toast('Aucun article reconnu dans ce PDF (facture scannée ?) : liez les montants ci-dessous.', 5000); }
    items = got; picked.clear(); toast(`${items.length} article(s) lu(s)`, 2000); d.items = items; syncAlloc(); drawItems();
  };
  // Facture Peppol : les articles viennent du XML (montants exacts) mais sans la référence de livraison / chantier.
  // On lit le PDF joint, on reconnaît chaque article (même montant, dans l'ordre) et on reprend seulement sa référence (« V/réf. », « BL »…).
  const isPeppol = () => d.source === 'peppol' || !!d.peppol;
  const applyPdfGroups = async (quiet) => {
    let txt = ''; try { txt = await pdfFileText(fileId, 20); } catch (err) { /* PDF illisible */ }
    const pdf = invoiceItemsFromText(txt);
    if (!pdf.some((x) => x.grp)) { if (!quiet) toast('Aucune référence de livraison trouvée dans le PDF.', 4000); return false; }
    let j = 0; let hit = 0; const grp = new Array(items.length).fill('');
    items.forEach((it, i) => {
      for (let k = j; k < Math.min(pdf.length, j + 8); k++) if (Math.abs(Math.abs(pdf[k].amount) - Math.abs(it.amount)) < 0.011) { grp[i] = pdf[k].grp || ''; j = k + 1; hit++; break; }
    });
    if (hit < Math.max(1, items.length * 0.6)) { if (!quiet) toast('Les articles du PDF ne correspondent pas assez à ceux de la facture Peppol : regroupement non appliqué.', 5000); return false; }
    // article non retrouvé : même référence que l'article précédent (même bon de livraison)
    let last = ''; items.forEach((it, i) => { if (grp[i]) last = grp[i]; if (last) it.grp = grp[i] || last; });
    d.items = items; if (!quiet) toast(`Articles regroupés par référence (${hit}/${items.length} reconnus dans le PDF)`, 3000);
    return true;
  };
  const drawItems = () => {
    const box = $('[data-items]', page);
    if (!items.length) {
      box.innerHTML = fileId && isPdfFile() ? `<div class="pi-items-empty"><button type="button" class="btn" data-readitems>${I.list || I.file} Répartir article par article</button><small class="muted">Lit les articles de la facture pour les attribuer un par un aux chantiers.</small></div>` : '';
      const rb = $('[data-readitems]', box); if (rb) rb.onclick = () => readItems(rb);
      return;
    }
    // groupe : articles consécutifs d'un même bon de livraison / référence (qui a pris, pour quel chantier)
    // à attribuer : groupes = articles non attribués consécutifs d'un même bon de livraison / référence (qui a pris, pour quel chantier)
    const todo = items.map((x, i) => i).filter((i) => !items[i].pid);
    const gmap = {}; let gk = null;
    todo.forEach((i, k) => { if (items[i].grp && (k === 0 || items[todo[k - 1]].grp !== items[i].grp)) { gk = i; gmap[gk] = []; } if (items[i].grp) gmap[gk].push(i); });
    const grpHead = (i0) => {
      const ids = gmap[i0]; const all = ids.every((i) => picked.has(i));
      return `<div class="pi-grp ${all ? 'on' : ''}" data-grp="${i0}"><input type="checkbox" ${all ? 'checked' : ''} aria-label="Sélectionner le groupe"><span class="pi-it-d">${esc(items[i0].grp)} <small>${ids.length} article(s)</small></span>
        <b class="r">${money(r2(ids.reduce((a, i) => a + items[i].amount, 0)))}</b><select>${pOpts('')}</select></div>`;
    };
    // attribués : liste à part, par chantier (on peut encore changer ou retirer)
    const byP = {}; items.forEach((x, i) => { if (x.pid) (byP[x.pid] = byP[x.pid] || []).push(i); });
    const doneN = items.length - todo.length;
    const tot = r2(items.reduce((a, x) => a + x.amount, 0)); const per = {}; let none = 0;
    items.forEach((x) => { if (x.pid) per[x.pid] = r2((per[x.pid] || 0) + x.amount); else none = r2(none + x.amount); });
    const gap = r2(ht() - tot);
    const oldList = $('.pi-it-list', box); const keepTop = oldList ? oldList.scrollTop : 0; const keepY = window.scrollY; // on reste où l'on était après une coche
    box.innerHTML = `<div class="pi-it-bar"><b>Articles à attribuer</b><span class="muted">${todo.length} / ${items.length} article(s) · cochez des articles (ou touchez-les), puis</span>
        <select data-bulkpid>${pOpts('')}</select><button type="button" class="btn sm primary" data-bulk>Attribuer la sélection</button><span class="grow"></span>
        ${fileId && isPdfFile() && !items.some((x) => x.grp) ? '<button type="button" class="link-btn" data-reread title="Relit le PDF pour grouper les articles par bon de livraison / référence">Grouper par référence</button>' : ''}${todo.length ? `<button type="button" class="link-btn" data-all>${todo.length && todo.every((i) => picked.has(i)) ? 'Tout désélectionner' : 'Tout sélectionner'}</button>` : ''}</div>
      ${todo.length ? `<div class="pi-it-list">${todo.map((i) => `${gmap[i] ? grpHead(i) : ''}<div class="pi-it ${picked.has(i) ? 'on' : ''}" data-it="${i}">
        <input type="checkbox" ${picked.has(i) ? 'checked' : ''} aria-label="Sélectionner"><span class="pi-it-d">${esc(items[i].desc)}</span><b class="r">${money(items[i].amount)}</b>
        <select data-pid="${i}">${pOpts('')}</select></div>`).join('')}</div>` : '<div class="pi-it-alldone">✓ Tous les articles sont attribués</div>'}
      ${doneN ? `<details class="pi-done" ${doneOpen ? 'open' : ''}><summary>Articles attribués <small>${doneN} article(s)</small></summary>${Object.entries(byP).map(([pid, ids]) => `<div class="pi-done-p"><b>${esc(pName(pid))}</b><b class="r">${money(r2(ids.reduce((a, i) => a + items[i].amount, 0)))}</b></div>
        ${ids.map((i) => `<div class="pi-it pi-it-done" data-it="${i}"><span></span><span class="pi-it-d">${esc(items[i].desc)}${items[i].grp ? `<small>${esc(items[i].grp)}</small>` : ''}</span><b class="r">${money(items[i].amount)}</b>
        <select data-pid="${i}"><option value="">↩ Retirer (à attribuer)</option>${pOpts(items[i].pid).replace(/^<option value="">[^<]*<\/option>/, '')}</select></div>`).join('')}`).join('')}</details>` : ''}
      <div class="pi-it-sum">${Object.entries(per).map(([pid, v]) => `<div><span>${esc(pName(pid))}</span><b>${money(v)}</b></div>`).join('')}
        <div class="${none ? 'warn' : 'ok'}"><span>Reste à attribuer</span><b>${money(none)}</b></div>
        ${Math.abs(gap) >= 0.01 ? `<div class="muted"><span>Écart entre les articles et le HT (frais, remises, articles non lus)</span><b>${money(gap)}</b></div>` : ''}</div>`;
    if ($('.pi-it-list', box)) $('.pi-it-list', box).scrollTop = keepTop;
    const det = $('.pi-done', box); if (det) det.ontoggle = () => { doneOpen = det.open; }; if (window.scrollY !== keepY) window.scrollTo(0, keepY);
    $$('[data-grp]', box).forEach((row) => {
      const ids = gmap[+row.dataset.grp];
      row.onclick = (ev) => { if (ev.target.tagName === 'SELECT' || ev.target.tagName === 'OPTION') return; const all = ids.every((i) => picked.has(i)); ids.forEach((i) => (all ? picked.delete(i) : picked.add(i))); drawItems(); };
      $('select', row).onchange = (ev) => { if (!ev.target.value) return; ids.forEach((i) => { items[i].pid = +ev.target.value; picked.delete(i); }); syncAlloc(); drawItems(); };
    });
    const rr = $('[data-reread]', box); if (rr) rr.onclick = () => (isPeppol() ? applyPdfGroups(false).then((ok) => { if (ok) drawItems(); }) : readItems(rr));
    $$('[data-it]', box).forEach((row) => {
      const i = +row.dataset.it;
      if (items[i].pid) { $('select', row).onchange = (ev) => { items[i].pid = ev.target.value ? +ev.target.value : ''; syncAlloc(); drawItems(); }; return; }
      row.onclick = (ev) => { if (ev.target.tagName === 'SELECT' || ev.target.tagName === 'OPTION') return; if (picked.has(i)) picked.delete(i); else picked.add(i); drawItems(); };
      $('select', row).onchange = (ev) => { items[i].pid = ev.target.value ? +ev.target.value : ''; syncAlloc(); drawItems(); };
    });
    const ab = $('[data-all]', box); if (ab) ab.onclick = () => { if (todo.every((i) => picked.has(i))) picked.clear(); else todo.forEach((i) => picked.add(i)); drawItems(); };
    $('[data-bulk]', box).onclick = () => {
      const pid = $('[data-bulkpid]', box).value; if (!pid) return toast('Choisissez le chantier', 2500); if (!picked.size) return toast('Cochez au moins un article', 2500);
      picked.forEach((i) => { items[i].pid = +pid; }); picked.clear(); syncAlloc(); drawItems();
    };
  };
  drawItems();
  // Peppol avec PDF joint : regroupement automatique à l'ouverture (comme pour une facture PDF importée)
  if (isPeppol() && fileId && isPdfFile() && items.length && !items.some((x) => x.grp)) applyPdfGroups(true).then((ok) => { if (ok) drawItems(); });

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
  // --- sous-traitant : obligation de retenue
  const drawRet = () => {
    const box = $('[data-ret]', page); if (!box) return;
    const sup = byId(contacts, F('supplierId').value);
    const show = (sup && sup.data.kind === 'soustraitant') || F('category').value === 'st' || alloc.some((a) => a.category === 'st');
    box.hidden = !show; if (show) retentionBox(box, e, sup, drawPays);
  };
  drawRet(); F('supplierId').addEventListener('change', drawRet); F('category').addEventListener('change', drawRet);

  drawVat(); drawAlloc();

  // --- enregistrement
  const save = async (mode) => {
    const v = readFields(form, [{ name: 'category' }, { name: 'ref' }, { name: 'date' }, { name: 'due' }, { name: 'supplierId', type: 'contact' }, { name: 'iban' }, { name: 'bic' }, { name: 'desc' }, { name: 'communication' }]);
    const t = num(F('ttc').value);
    if (mode !== 'draft') {
      const miss = [!v.category && 'type de facture', !v.ref && 'référence', !v.date && 'date', !v.supplierId && 'fournisseur'].filter(Boolean);
      if (miss.length) return toast('À compléter : ' + miss.join(', '), 4000);
      // facture à 0 € (avoir déjà déduit, livraison gratuite, facture d'information) : acceptée après confirmation
      if (!F('ttc').value.trim()) { if (!confirm('Montant TTC vide : enregistrer cette facture à 0,00 € ?')) { F('ttc').focus(); return; } F('ttc').value = famt(0); }
    }
    const rows = alloc.filter((a) => num(a.amount) !== 0);
    if (rows.some((a) => !a.pid)) return toast('Choisissez le chantier de chaque liaison', 4000);
    // note de crédit (montant négatif) : aucune liaison obligatoire ; si liée, même signe et pas plus que le montant
    if (Math.abs(linked()) - Math.abs(ht()) > 0.01 || (Math.abs(linked()) > 0.005 && Math.sign(linked()) !== Math.sign(ht()))) return toast(`Les liaisons (${money(linked())}) dépassent le montant HT (${money(ht())})`, 5000);
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
    // « Déjà payée » cochée : paiement enregistré à la validation (gardé tant que la facture reste à valider)
    const pp = F('prepaid') && F('prepaid').checked ? { date: F('ppdate').value || v.date || today(), method: F('ppmethod').value || 'Virement' } : null;
    if (pp && mode !== 'draft' && purchRest(e.data) > 0.009) { const r = purchRest(e.data); (e.data.payments = e.data.payments || []).push({ date: pp.date, amount: r, method: pp.method }); purchLog(e.data, `Paiement de ${money(r)} le ${fmtDate(pp.date)} (${pp.method})`); purchSyncPaid(e.data); delete e.data.prepaid; }
    else if (pp && mode === 'draft') e.data.prepaid = pp; else delete e.data.prepaid;
    if (mode === 'paid' && purchRest(e.data) > 0.009) { const r = purchRest(e.data); (e.data.payments = e.data.payments || []).push({ date: today(), amount: r, method: 'Virement' }); purchLog(e.data, `Paiement de ${money(r)} le ${fmtDate(today())}`); purchSyncPaid(e.data); }
    ['readNote', 'supplierGuess', 'project_id'].forEach((k) => delete e.data[k]);
    if (rows.length === 1 && Math.abs(num(rows[0].amount) - ht()) < 0.01) { e.project_id = +rows[0].pid; e.data.category = rows[0].category || e.data.category; delete e.data.alloc; }
    else if (rows.length) { e.project_id = null; e.data.alloc = rows.map((a) => ({ pid: +a.pid, amount: r2(num(a.amount)), category: a.category || e.data.category, ...(a.fromItems ? { fromItems: true } : {}) })); }
    else { e.project_id = null; delete e.data.alloc; }
    await persist('expense', e);
    toast(mode === 'draft' ? 'Enregistrée (à valider)' : mode === 'paid' || pp ? 'Facture soumise et marquée payée' : 'Facture soumise', 2500);
    go('#/expenses');
    // facture validée : ses prix d'achat alimentent la bibliothèque (en arrière-plan)
    if (mode !== 'draft') learnPrices(e).catch(() => {});
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
// Facture électronique Peppol (UBL) reçue sans PDF : rendue comme une facture lisible
function ublHtml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML illisible');
  const kids = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
  const one = (el, ...path) => { let c = el; for (const n of path) { c = kids(c, n)[0]; if (!c) return null; } return c; };
  const tx = (el, ...path) => { const c = one(el, ...path); return c ? c.textContent.trim() : ''; };
  const root = doc.documentElement; const credit = root.localName === 'CreditNote';
  const cur = tx(root, 'DocumentCurrencyCode') || 'EUR';
  const m = (v) => (v === '' || v == null ? '' : `${num(v).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${cur === 'EUR' ? '€' : esc(cur)}`);
  const UC = { C62: 'pc', H87: 'pc', EA: 'pc', XPP: 'pc', MTR: 'm', MTK: 'm²', MTQ: 'm³', KGM: 'kg', TNE: 't', LTR: 'l', HUR: 'h', DAY: 'j', SET: 'ens', XBX: 'bte', PK: 'paq', LS: 'forfait' };
  const hasDisc = [...kids(root, 'InvoiceLine'), ...kids(root, 'CreditNoteLine')].some((l) => kids(l, 'AllowanceCharge').length);
  const party = (p) => {
    const pp = one(p, 'Party'); if (!pp) return '';
    const name = tx(pp, 'PartyLegalEntity', 'RegistrationName') || tx(pp, 'PartyName', 'Name');
    const ad = one(pp, 'PostalAddress');
    const vat = tx(pp, 'PartyTaxScheme', 'CompanyID') || tx(pp, 'PartyLegalEntity', 'CompanyID');
    return `<b style="font-size:15px">${esc(name)}</b><br>${esc([tx(ad, 'StreetName'), tx(ad, 'AdditionalStreetName')].filter(Boolean).join(', '))}<br>${esc([tx(ad, 'PostalZone'), tx(ad, 'CityName')].filter(Boolean).join(' '))}${tx(ad, 'Country', 'IdentificationCode') ? ` (${esc(tx(ad, 'Country', 'IdentificationCode'))})` : ''}
      ${vat ? `<br>TVA ${esc(vat)}` : ''}${tx(pp, 'Contact', 'ElectronicMail') ? `<br>${esc(tx(pp, 'Contact', 'ElectronicMail'))}` : ''}${tx(pp, 'Contact', 'Telephone') ? `<br>${esc(tx(pp, 'Contact', 'Telephone'))}` : ''}`;
  };
  const lines = [...kids(root, 'InvoiceLine'), ...kids(root, 'CreditNoteLine')].map((l) => {
    const q = one(l, 'InvoicedQuantity') || one(l, 'CreditedQuantity');
    const it = one(l, 'Item'); const desc = tx(it, 'Description');
    const disc = kids(l, 'AllowanceCharge').filter((a) => tx(a, 'ChargeIndicator') === 'false').reduce((t, a) => t + num(tx(a, 'Amount')), 0);
    // ligne de texte (n° de commande, référence, livraison…) : sans quantité ni montant
    if (!num(tx(l, 'LineExtensionAmount')) && !(q && num(q.textContent))) {
      const t = [tx(it, 'Name'), desc, tx(l, 'Note')].filter((x) => x && x !== '_' && x !== '-').join(' – ');
      return t ? `<tr><td></td><td colspan="${hasDisc ? 6 : 5}" style="color:#556;font-style:italic">${esc(t)}</td></tr>` : '';
    }
    return `<tr><td style="color:#667">${esc(tx(it, 'SellersItemIdentification', 'ID'))}</td><td><b>${esc(tx(it, 'Name'))}</b>${desc && desc !== tx(it, 'Name') ? `<br><small>${esc(desc)}</small>` : ''}${tx(l, 'Note') ? `<br><small>${esc(tx(l, 'Note'))}</small>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${q ? `${fnum(num(q.textContent), 3)} ${esc(UC[q.getAttribute('unitCode')] || q.getAttribute('unitCode') || '')}` : ''}</td><td style="text-align:right;white-space:nowrap">${m(tx(l, 'Price', 'PriceAmount'))}</td>
      ${hasDisc ? `<td style="text-align:right">${disc ? `-${m(disc)}` : ''}</td>` : ''}<td style="text-align:right">${tx(it, 'ClassifiedTaxCategory', 'Percent') ? `${fnum(num(tx(it, 'ClassifiedTaxCategory', 'Percent')))} %` : ''}</td><td style="text-align:right;white-space:nowrap"><b>${m(tx(l, 'LineExtensionAmount'))}</b></td></tr>`;
  }).join('');
  const docAc = kids(root, 'AllowanceCharge').map((a) => `<tr><td>${tx(a, 'ChargeIndicator') === 'true' ? 'Frais' : 'Remise'} ${esc(tx(a, 'AllowanceChargeReason'))}</td><td style="text-align:right">${tx(a, 'ChargeIndicator') === 'true' ? '' : '-'}${m(tx(a, 'Amount'))}</td></tr>`).join('');
  const tot = one(root, 'LegalMonetaryTotal');
  const vats = kids(one(root, 'TaxTotal'), 'TaxSubtotal').map((t) => `<tr><td>TVA ${fnum(num(tx(t, 'TaxCategory', 'Percent')))} % sur ${m(tx(t, 'TaxableAmount'))}</td><td style="text-align:right">${m(tx(t, 'TaxAmount'))}</td></tr>`).join('');
  const pm = kids(root, 'PaymentMeans')[0];
  const notes = kids(root, 'Note').map((n) => esc(n.textContent.trim())).filter(Boolean).join('<br>');
  const th = 'style="text-align:left;padding:6px;border-bottom:2px solid #1c2550;font-size:11px;text-transform:uppercase;color:#1c2550"';
  return `<div class="ubl-doc" style="background:#fff;color:#1c2550;font:13px/1.45 Helvetica,Arial,sans-serif;padding:24px 26px;width:760px;box-sizing:border-box"><style>.ubl-doc td{padding:6px;border-bottom:1px solid #eef0f5;vertical-align:top}</style>
    <div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap"><div>${party(one(root, 'AccountingSupplierParty'))}</div>
      <div style="text-align:right"><div style="font-size:22px;font-weight:800">${credit ? 'Note de crédit' : 'Facture'}</div><div style="font-size:15px"><b>${esc(tx(root, 'ID'))}</b></div>
      <div>Date : ${esc(dateFr(tx(root, 'IssueDate')) || tx(root, 'IssueDate'))}</div>${tx(root, 'DueDate') || tx(pm, 'PaymentDueDate') ? `<div>Échéance : ${esc(dateFr(tx(root, 'DueDate') || tx(pm, 'PaymentDueDate')))}</div>` : ''}
      ${tx(root, 'OrderReference', 'ID') ? `<div>Commande : ${esc(tx(root, 'OrderReference', 'ID'))}</div>` : ''}${tx(root, 'BuyerReference') ? `<div>Votre réf. : ${esc(tx(root, 'BuyerReference'))}</div>` : ''}</div></div>
    <div style="margin:18px 0 14px;padding:10px 14px;border-radius:10px;background:#f4f6fb"><small style="text-transform:uppercase;color:#667">Client</small><br>${party(one(root, 'AccountingCustomerParty'))}</div>
    ${notes ? `<p style="color:#445">${notes}</p>` : ''}
    <table style="width:100%;border-collapse:collapse"><thead><tr><th ${th}>Réf.</th><th ${th}>Désignation</th><th ${th}>Qté</th><th ${th}>Prix u.</th>${hasDisc ? `<th ${th}>Remise</th>` : ''}<th ${th}>TVA</th><th ${th}>Total HT</th></tr></thead>
      <tbody>${lines}</tbody></table>
    <table style="margin:14px 0 0 auto;min-width:300px;border-collapse:collapse">${docAc}
      <tr><td>Total HT</td><td style="text-align:right"><b>${m(tx(tot, 'TaxExclusiveAmount') || tx(tot, 'LineExtensionAmount'))}</b></td></tr>${vats}
      <tr><td style="padding-top:6px;font-size:16px"><b>Total TVAC</b></td><td style="text-align:right;padding-top:6px;font-size:16px"><b>${m(tx(tot, 'TaxInclusiveAmount'))}</b></td></tr>
      ${num(tx(tot, 'PrepaidAmount')) ? `<tr><td>Déjà payé</td><td style="text-align:right">-${m(tx(tot, 'PrepaidAmount'))}</td></tr>` : ''}
      <tr><td style="background:#e8a33d;padding:6px 8px"><b>À payer</b></td><td style="text-align:right;background:#e8a33d;padding:6px 8px"><b>${m(tx(tot, 'PayableAmount'))}</b></td></tr></table>
    ${pm ? `<div style="margin-top:16px;padding:10px 14px;border:1px solid #dde;border-radius:10px"><b>Paiement</b>${tx(pm, 'PayeeFinancialAccount', 'ID') ? `<br>IBAN : <b>${esc(tx(pm, 'PayeeFinancialAccount', 'ID'))}</b>` : ''}${tx(pm, 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID') ? ` · BIC ${esc(tx(pm, 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID'))}` : ''}${tx(pm, 'PaymentID') ? `<br>Communication : <b>${esc(tx(pm, 'PaymentID'))}</b>` : ''}${tx(root, 'PaymentTerms', 'Note') ? `<br>${esc(tx(root, 'PaymentTerms', 'Note'))}` : ''}</div>` : ''}
    <p style="margin-top:14px;font-size:11px;color:#889">Facture électronique reçue par Peppol – affichage généré par BâtiPro à partir du fichier UBL.</p></div>`;
}
// articles d'une facture UBL : référence, désignation, quantité, prix unitaire net, unité
function ublItems(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const kids = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
  const tx = (el, ...path) => { let c = el; for (const n of path) { c = kids(c, n)[0]; if (!c) return ''; } return c.textContent.trim(); };
  const UC = { C62: 'pc', H87: 'pc', EA: 'pc', XPP: 'pc', MTR: 'm', MTK: 'm²', MTQ: 'm³', KGM: 'kg', TNE: 't', LTR: 'l', HUR: 'h', SET: 'ens', XBX: 'bte', PK: 'paq' };
  const r = doc.documentElement;
  return [...kids(r, 'InvoiceLine'), ...kids(r, 'CreditNoteLine')].map((l) => {
    const q = kids(l, 'InvoicedQuantity')[0] || kids(l, 'CreditedQuantity')[0];
    const bq = num(tx(l, 'Price', 'BaseQuantity')) || 1;
    return { name: tx(l, 'Item', 'Name'), desc: tx(l, 'Item', 'Name'), ref: tx(l, 'Item', 'SellersItemIdentification', 'ID'), qty: q ? num(q.textContent) : 0, price: r2(num(tx(l, 'Price', 'PriceAmount')) / bq * 1e4) / 1e4, unit: q ? UC[q.getAttribute('unitCode')] || '' : '', amount: num(tx(l, 'LineExtensionAmount')) };
  }).filter((x) => x.name && x.qty > 0 && x.price > 0 && r.localName !== 'CreditNote');
}
function purchViewer(box, getFile, onAction) {
  let zoom = 1; let seq = 0;
  const draw = async () => {
    const { fileId, fileName } = getFile(); const my = ++seq;
    if (!fileId) {
      box.innerHTML = `<div class="pi-drop"><div class="pi-empty-ic">${I.file}</div><b>Aucune facture jointe</b><p class="muted">Ajoutez le PDF ou une photo de la facture.</p><button type="button" class="btn primary" data-up>${I.plus} Ajouter la facture</button></div>`;
      $('[data-up]', box).onclick = () => onAction('upload'); return;
    }
    const isPdf = /\.pdf$/i.test(fileName || ''); const isImg = /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName || ''); const isXml = /\.xml$/i.test(fileName || '');
    box.innerHTML = `<div class="pi-vbar"><button type="button" class="icon-btn" data-z="-" aria-label="Zoom arrière">−</button><span class="pi-zoom">${Math.round(zoom * 100)} %</span><button type="button" class="icon-btn" data-z="+" aria-label="Zoom avant">+</button>
      <span class="pi-fname" title="${esc(fileName || '')}">${esc(fileName || 'facture')}</span>
      <button type="button" class="icon-btn" data-up title="Remplacer">${I.upload}</button><button type="button" class="icon-btn" data-rm title="Retirer">${I.trash}</button><a class="icon-btn" href="${fileUrl(fileId, true)}" title="Télécharger">${I.download}</a></div>
      <div class="pi-doc" data-doc>${isImg ? `<img src="${fileUrl(fileId)}" alt="" style="width:${zoom * 100}%">` : isPdf || isXml ? '<p class="muted pi-load">Chargement de la facture…</p>' : `<p class="muted pi-load">Aperçu indisponible pour ce fichier. <a href="${fileUrl(fileId)}" target="_blank">Ouvrir</a></p>`}</div>`;
    $$('[data-z]', box).forEach((b) => { b.onclick = () => { zoom = Math.min(3, Math.max(0.5, r2(zoom + (b.dataset.z === '+' ? 0.25 : -0.25)))); draw(); }; });
    $('[data-up]', box).onclick = () => onAction('upload'); $('[data-rm]', box).onclick = () => onAction('remove');
    if (isXml) {
      try {
        const html = ublHtml(await (await fetch(fileUrl(fileId), { credentials: 'same-origin' })).text()); if (my !== seq) return;
        const h = $('[data-doc]', box);
        // largeur A4 réduite à la largeur de l'écran (comme une page PDF), puis zoom de l'utilisateur
        const fit = Math.min(1.4, Math.max(0.3, (h.clientWidth - 8) / 760)) * zoom;
        h.innerHTML = `<div class="ubl-wrap" style="zoom:${fit}">${html}</div><div class="ubl-acts"><button type="button" class="btn sm" data-ublpdf>${I.download || I.file} Enregistrer en PDF</button></div>`;
        $('[data-ublpdf]', h).onclick = async (ev) => {
          ev.target.disabled = true; toast('Création du PDF…', 20000);
          try { const blob = await makePdf(html); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = String(fileName).replace(/\.xml$/i, '.pdf'); a.click(); toast('PDF prêt', 1500); } catch (err) { toast('PDF impossible : ' + err.message, 4000); }
          ev.target.disabled = false;
        };
      } catch (err) { const h = $('[data-doc]', box); if (h) h.innerHTML = `<p class="muted pi-load">Aperçu impossible (${esc(err.message)}). <a href="${fileUrl(fileId)}" target="_blank">Ouvrir le fichier</a></p>`; }
      return;
    }
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

// ---------------------------------------------------------------- Bibliothèque de prix tenue à jour par les factures d'achat
// Chaque article acheté (quantité × prix unitaire net, remise déduite) crée ou met à jour un article « Matériaux » :
// dernier prix payé, fournisseur, référence, historique ; les ouvrages qui l'utilisent sont recalculés d'office.
const BUY_UNITS = { pc: 'pc', pce: 'pc', pcs: 'pc', st: 'pc', stk: 'pc', u: 'u', un: 'u', bte: 'bte', box: 'bte', paq: 'paq', pak: 'paq', m: 'm', ml: 'ml', m2: 'm²', 'm²': 'm²', m3: 'm³', 'm³': 'm³', kg: 'kg', t: 't', l: 'l', lt: 'l', h: 'h', rl: 'rl', sac: 'sac', zak: 'sac' };
// skipDone : facture déjà lue (« Remplir depuis achats et devis ») → ignorée, sans relire le PDF
async function learnPrices(e, { quiet = false, skipDone = false } = {}) {
  const d = e.data;
  if (skipDone && d.libDone) return { n: 0, skipped: true };
  let items = (d.items || []).filter((x) => num(x.qty) > 0 && num(x.price) > 0);
  // articles pas encore lus, ou lus avant la v96 (sans quantité ni prix unitaire) : lecture du PDF de la facture
  if (!items.length && d.fileId && /\.pdf$/i.test(d.fileName || '')) {
    try { items = invoiceItemsFromText(await pdfFileText(d.fileId, 20)).filter((x) => num(x.qty) > 0 && num(x.price) > 0); } catch (err) { items = []; }
  }
  // facture Peppol (UBL) importée avant la v96 : quantités et prix relus dans le XML
  const xmlId = d.xmlFileId || (/\.xml$/i.test(d.fileName || '') ? d.fileId : null);
  if (!items.length && xmlId) {
    try { items = ublItems(await (await fetch(fileUrl(xmlId), { credentials: 'same-origin' })).text()); } catch (err) { items = []; }
  }
  // marquée comme lue (même sans prix trouvé : PDF scanné) pour ne plus la relire
  const done = async () => { try { const fresh = await db.get('expense', e.id); fresh.data.libDone = today(); await persist('expense', fresh, { silent: true }); d.libDone = fresh.data.libDone; } catch (err) { /* hors ligne : relue la prochaine fois */ } };
  if (!items.length) { await done(); return { n: 0 }; }
  const all = await db.list('article'); const contacts = await db.list('contact');
  const sup = byId(contacts, d.supplierId); const supName = sup ? sup.data.company || sup.data.name || '' : '';
  const date = d.date || today(); const changed = new Set(); let created = 0; let updated = 0; let up = 0;
  for (const x of items) {
    const name = String(x.name || x.desc || '').split('\n')[0].trim(); if (name.length < 3) continue;
    const ref = String(x.ref || '').trim(); const price = r2(num(x.price) * 1e4) / 1e4;
    const unit = BUY_UNITS[String(x.unit || '').toLowerCase()] || (x.unit ? String(x.unit).toLowerCase() : 'u');
    let a = all.find((y) => y.data.kind !== 'ouvrage' && ref && y.data.supplierRef === ref && +y.data.supplierId === +d.supplierId)
      || all.find((y) => y.data.kind !== 'ouvrage' && normKey(y.data.name) === normKey(name) && (!y.data.supplierId || +y.data.supplierId === +d.supplierId));
    const h = { d: date, p: price, s: d.supplierId || null, e: e.id };
    if (!a) {
      a = { data: { name, code: ref, kind: 'mat', category: supName, unit, cost: price, margin: 25, vat: defVat(), supplierId: d.supplierId || null, supplierRef: ref, buy: h, priceHist: [h], auto: true } };
      all.push(a); changed.add(a); created++; continue;
    }
    const hist = a.data.priceHist || (a.data.priceHist = []);
    if (hist.some((y) => y.e === e.id && Math.abs(y.p - price) < 0.0001)) continue; // facture déjà apprise
    hist.push(h); hist.sort((p, q) => (p.d < q.d ? -1 : 1)); if (hist.length > 24) hist.splice(0, hist.length - 24);
    // prix le plus récent (une ancienne facture encodée après coup ne remplace pas un prix plus récent)
    if (!a.data.buy || a.data.buy.d <= date) {
      const old = num(a.data.cost);
      if (old > 0 && price > old * 1.05) up++;
      a.data.prevCost = old || null; a.data.cost = price; a.data.buy = h;
      if (!a.data.supplierId && d.supplierId) a.data.supplierId = d.supplierId;
      if (!a.data.supplierRef && ref) a.data.supplierRef = ref;
    }
    changed.add(a); updated++;
  }
  for (const a of changed) await persist('article', a, { silent: true });
  await done();
  if (!quiet && (created || updated)) toast(`Bibliothèque de prix : ${created ? `${created} nouvel(s) article(s)` : ''}${created && updated ? ', ' : ''}${updated ? `${updated} prix mis à jour` : ''}${up ? ` (⚠ ${up} en hausse de plus de 5 %)` : ''}`, 6000);
  return { n: created + updated, created, updated, up };
}
