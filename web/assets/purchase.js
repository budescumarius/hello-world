'use strict';
/* Factures fournisseurs : liste avec statuts (À valider → À payer → Payée) et page de vérification avec la facture affichée à côté. */

const PURCH_ST = { avalider: ['À valider', '#f08c00'], apayer: ['À payer', '#3b5bdb'], retard: ['En retard', '#e5484d'], payee: ['Payée', '#2f9e44'] };
// montant saisi : toujours 2 décimales (« 883,30 »)
const famt = (x) => (num(x) || 0).toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PURCH_SRC = { peppol: 'Peppol', pdf: 'PDF importé', xml: 'XML importé', photo: 'Photo' };
function purchState(e) {
  const d = e.data;
  if (d.status === 'avalider' || d.toCheck) return 'avalider';
  if (d.paid) return 'payee';
  return d.due && d.due < today() ? 'retard' : 'apayer';
}
// TVA par taux (anciens achats : un seul taux)
function purchVat(d) {
  if (Array.isArray(d.vatLines) && d.vatLines.length) return d.vatLines.map((x) => ({ rate: num(x.rate), amount: num(x.amount) }));
  const amount = d.vatAmount != null && d.vatAmount !== '' ? num(d.vatAmount) : r2(num(d.amount) * num(d.vat ?? defVat()) / 100);
  return [{ rate: num(d.vat ?? defVat()), amount }];
}
const purchTtc = (d) => (d.ttc != null && d.ttc !== '' ? num(d.ttc) : r2(num(d.amount) + purchVat(d).reduce((a, x) => a + x.amount, 0)));
const purchStatusHtml = (e) => {
  const s = purchState(e); const d = e.data;
  const sub = s === 'payee' ? (d.paidDate ? fmtDate(d.paidDate) : '') : s === 'avalider' ? (PURCH_SRC[d.source] || (d.peppol ? 'Peppol' : '')) : (d.due ? `éch. ${fmtDate(d.due)}` : '');
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
  dataTable(el, {
    rows, state: ui[`exp_${pid || 'all'}`] || (ui[`exp_${pid || 'all'}`] = { sort: -1 }),
    search: (e) => [e.data.ref, e.data.desc, contactName(byId(contacts, e.data.supplierId)), fnum(num(e.data.amount)), String(e.data.amount)].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ...Object.entries(PURCH_ST).map(([k, [l, c]]) => [k, l, c])], match: (e, f) => purchState(e) === f },
    columns: [
      { l: 'Date', v: (e) => fmtDate(e.data.date), sort: (e) => e.data.date || '' },
      { l: 'Type', v: (e) => `<span class="nowrap"><i class="tdot" style="--c:${TYPE_COLORS[cat(e)] || '#999'}"></i>${esc(TYPES[cat(e)] || '')}</span>` },
      { l: 'Fournisseur', v: (e) => `<b>${esc(contactName(byId(contacts, e.data.supplierId)))}</b>`, sort: (e) => contactName(byId(contacts, e.data.supplierId)) },
      { l: 'Référence', v: (e) => `${esc(e.data.ref || '—')}${e.data.desc && e.data.desc !== `Facture ${e.data.ref}` ? `<br><small class="muted">${esc(e.data.desc.slice(0, 60))}</small>` : ''}` },
      ...(showProject ? [{ l: 'Chantier', v: where }] : []),
      { l: pid ? 'HT (part du chantier)' : 'Montant HT', cls: 'r', v: (e) => `<b>${money(amt(e))}</b>${pid && Array.isArray(e.data.alloc) && e.data.alloc.length ? `<br><small class="muted">sur ${money(e.data.amount)}</small>` : ''}`, sort: amt },
      { l: 'Statut', v: purchStatusHtml, sort: (e) => Object.keys(PURCH_ST).indexOf(purchState(e)) },
      { l: '', v: (e) => `<span class="row-acts"><button class="icon-btn sm" data-cm="${e.id}" title="Commentaires">${I.chat}${(e.data.comments || []).length ? `<i class="cnt">${e.data.comments.length}</i>` : ''}</button><button class="icon-btn sm" data-ed="${e.id}" title="Modifier">${I.edit}</button><button class="icon-btn sm" data-mo="${e.id}" title="Plus">${I.more}</button></span>` },
    ],
    onRow: (e) => go(`#/purchase/${e.id}`), empty: 'Aucune facture fournisseur',
    footer: (l) => `<tr><td colspan="${showProject ? 5 : 4}">Total</td><td class="r"><b>${money(l.reduce((a, e) => a + amt(e), 0))}</b></td><td colspan="2"></td></tr>`,
  });
  if (el.dataset.bound) return; el.dataset.bound = '1';
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cm],[data-ed],[data-mo]'); if (!b) return;
    const e = rows.find((x) => x.id === +(b.dataset.cm || b.dataset.ed || b.dataset.mo)); if (!e) return;
    if (b.dataset.ed) return go(`#/purchase/${e.id}`);
    if (b.dataset.cm) return purchComments(e);
    purchMenu(e);
  });
}

function purchMenu(e) {
  const d = e.data;
  menuSheet(`Facture ${d.ref || ''}`.trim(), [
    { label: 'Ouvrir', icon: 'edit', run: () => go(`#/purchase/${e.id}`) },
    ...(purchState(e) !== 'avalider' ? [d.paid ? { label: 'Annuler le paiement', icon: 'coins', run: async () => { d.paid = false; d.paidDate = null; await persist('expense', e); render(); } }
      : { label: 'Marquer comme payée', icon: 'coins', run: async () => { const v = await ask('Paiement', [{ name: 'paidDate', label: 'Date du paiement', type: 'date' }], { paidDate: today() }); if (!v) return; d.paid = true; d.paidDate = v.paidDate || today(); await persist('expense', e); render(); } }] : []),
    ...(d.fileId ? [{ label: 'Télécharger la facture', icon: 'file', run: () => { location.href = fileUrl(d.fileId, true); } }] : []),
    { label: 'Commentaires', icon: 'chat', run: () => purchComments(e) },
    { sep: true },
    { label: 'Supprimer', icon: 'trash', danger: true, run: async () => { if (!confirm('Supprimer cette facture fournisseur ?')) return; await delFile(d.fileId); if (d.xmlFileId) await delFile(d.xmlFileId); await db.del('expense', e.id); render(); } },
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
      ${d.readNote && st === 'avalider' ? `<div class="hint-box">${esc(d.readNote)}</div>` : ''}
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
          ${guess ? `<div class="hint-box" data-guess>Fournisseur lu sur la facture : <b>${esc(guess.name || '?')}</b>${guess.vat ? ` (TVA ${esc(guess.vat)})` : ''} <button type="button" class="btn sm" data-mksup>${I.plus} Créer ce fournisseur</button></div>` : ''}
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

  // --- fournisseur détecté
  const mk = $('[data-mksup]', page);
  if (mk) mk.onclick = async () => {
    const c = await editContact(null, { kind: 'fournisseur', company: guess.name || '', vat: guess.vat || '', peppolId: guess.peppolId || '', address: guess.address || '', zip: guess.zip || '', city: guess.city || '', email: guess.email || '', iban: F('iban').value });
    if (!c) return;
    F('supplierId').insertAdjacentHTML('afterbegin', `<option value="${c.id}">${esc(contactName(c))}</option>`); F('supplierId').value = c.id;
    $('[data-guess]', page).remove(); guess = null;
  };

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
    fileId = r.id; fileName = r.name; toast('Facture jointe', 1500); viewer.draw();
  });

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
    Object.assign(e.data, d, {
      category: v.category, ref: v.ref, date: v.date, due: v.due, supplierId: v.supplierId ? +v.supplierId : null, iban: v.iban.replace(/\s/g, '').toUpperCase(), bic: v.bic.toUpperCase(),
      communication: structured ? v.communication.replace(/\D/g, '') : v.communication, structured,
      desc: v.desc || `Facture ${v.ref || ''}`.trim(), ttc: r2(t), vatLines: lines, vatAmount: totalVat(), vat: main.rate, amount: ht(), fileId, fileName,
      status: mode === 'draft' ? 'avalider' : 'validee', toCheck: mode === 'draft',
      ...(mode === 'paid' ? { paid: true, paidDate: today() } : {}),
    });
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
    ...(isNew ? [] : [{ sep: true }, { label: 'Supprimer la facture', icon: 'trash', danger: true, run: async () => { if (!confirm('Supprimer cette facture fournisseur ?')) return; await delFile(d.fileId); if (d.xmlFileId) await delFile(d.xmlFileId); await db.del('expense', e.id); go('#/expenses'); } }]),
  ]);
});

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
