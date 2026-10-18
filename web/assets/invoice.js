'use strict';
/* Factures clients : liste (statut de paiement et de facturation électronique) et page en onglets Informations / Encodage / Totaux / Visualisation. */

const INV_TYPE = { ...IKIND, facture: 'Facture simple' };
const PAY_TERMS = [[0, 'Paiement comptant'], [7, '7 jour(s) après date de facturation'], [10, '10 jour(s) après date de facturation'], [15, '15 jour(s) après date de facturation'], [30, '30 jour(s) après date de facturation'], [45, '45 jour(s) après date de facturation'], [60, '60 jour(s) après date de facturation']];

// Statut affiché (paiement / envoi)
function invDisp(i) {
  const s = invState(i); const d = i.data;
  const lastPay = (d.payments || []).map((p) => p.date).filter(Boolean).sort().pop();
  if (s.s === 'brouillon') return { k: 'brouillon', l: 'Brouillon', c: '#868e96' };
  if (s.s === 'avoir') return { k: 'avoir', l: 'Note de crédit', c: '#adb5bd' };
  if (s.s === 'payee') return { k: 'payee', l: 'Payé', c: '#2f9e44', sub: fmtDate(lastPay) };
  if (s.s === 'partielle') return { k: 'partielle', l: 'Part. payé', c: '#e8a10c', sub: fmtDate(lastPay) };
  if (s.s === 'retard') return { k: 'retard', l: 'En retard', c: '#e5484d', sub: `éch. ${fmtDate(d.due)}` };
  const sent = (d.sent || []).length || (d.peppol && d.peppol.sentAt);
  return sent ? { k: 'envoye', l: 'Envoyé', c: '#3b5bdb', sub: `éch. ${fmtDate(d.due)}` } : { k: 'aenvoyer', l: 'À envoyer', c: '#f08c00' };
}
const invDispHtml = (i) => { const x = invDisp(i); return `<span class="pst">${badge(x.l, x.c)}${x.sub ? `<small class="muted">${esc(x.sub)}</small>` : ''}</span>`; };
// Facturation électronique (Peppol)
function invEInv(i, contacts) {
  const d = i.data;
  if (d.status !== 'emise') return '<span class="muted">—</span>';
  if (d.peppol && d.peppol.sentAt) return `<span class="pst">${badge('Envoyé', '#3b5bdb')}<small class="muted">Peppol ${fmtDate(d.peppol.sentAt)}</small></span>`;
  const c = byId(contacts, d.clientId);
  return c && buyerInfo(c).peppolId && buyerInfo(c).isCompany ? badge('À envoyer', '#f08c00') : '<small class="muted">Hors Peppol</small>';
}

// ---------------------------------------------------------------- Liste
route('invoices', async () => {
  const [invoices, contacts, projects] = await Promise.all([db.list('invoice'), db.list('contact'), db.list('project')]);
  const rows = invoices.map((i) => ({ ...i, st: invState(i) }));
  const y = String(new Date().getFullYear());
  const yr = rows.filter((r) => (r.data.date || '').startsWith(y) && r.st.s !== 'brouillon');
  const page = layout({ active: 'finances', icon: 'coins', title: 'Factures clients', actions: `<button class="btn" data-act="csv">Export comptable</button><button class="btn primary" data-act="new">${I.plus} Nouveau</button>` });
  page.innerHTML = `<div class="kpis">${kpi(`Facturé ${y} HT`, money(yr.reduce((a, r) => a + r.st.t.base, 0)))}${kpi('Brouillons', rows.filter((r) => r.st.s === 'brouillon').length, { sub: money(rows.filter((r) => r.st.s === 'brouillon').reduce((a, r) => a + r.st.t.total, 0)) + ' TTC' })}
    ${kpi('À recevoir TTC', money(rows.filter((r) => ['impayee', 'partielle', 'retard'].includes(r.st.s)).reduce((a, r) => a + r.st.rest, 0)))}${kpi('En retard', money(rows.filter((r) => r.st.s === 'retard').reduce((a, r) => a + r.st.rest, 0)), { cls: rows.some((r) => r.st.s === 'retard') ? 'bad' : '', sub: `${rows.filter((r) => r.st.s === 'retard').length} facture(s)` })}</div><div id="tbl"></div>`;
  const tbl = $('#tbl');
  dataTable(tbl, {
    rows, state: ui.tbl_inv2 || (ui.tbl_inv2 = { sort: -2 }), pageSize: 20,
    search: (i) => [i.number, i.data.title, i.data.ref, contactName(byId(contacts, i.data.clientId)), (byId(projects, i.project_id) || { data: {} }).data.name, fnum(i.st.t.total)].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ['brouillon', 'Brouillons', '#868e96'], ['aenvoyer', 'À envoyer', '#f08c00'], ['envoye', 'Envoyées', '#3b5bdb'], ['partielle', 'Part. payées', '#e8a10c'], ['payee', 'Payées', '#2f9e44'], ['retard', 'En retard', '#e5484d'], ['avoir', 'Notes de crédit', '#adb5bd']], match: (i, f) => invDisp(i).k === f },
    columns: [
      { l: 'N°', v: (i) => `<b class="nowrap">${esc(i.number || '—')}</b>`, sort: (i) => i.number || '' },
      { l: 'Date', v: (i) => fmtDate(i.data.date), sort: (i) => `${i.data.date || ''}${String(i.id).padStart(8, '0')}` },
      { l: 'Type', v: (i) => esc(INV_TYPE[i.data.kind] || 'Facture') },
      { l: 'Client', v: (i) => esc(contactName(byId(contacts, i.data.clientId))), sort: (i) => contactName(byId(contacts, i.data.clientId)) },
      { l: 'Référence', v: (i) => `${esc(i.data.title || i.data.ref || '—')}${i.project_id ? `<br><small class="muted">${esc((byId(projects, i.project_id) || { data: {} }).data.name || '')}</small>` : ''}` },
      { l: 'Total TTC', cls: 'r', v: (i) => `<b>${money(i.st.t.total)}</b>`, sort: (i) => i.st.t.total },
      { l: 'Fact. électronique', v: (i) => invEInv(i, contacts) },
      { l: 'Statut', v: invDispHtml, sort: (i) => invDisp(i).k },
      { l: '', v: (i) => `<span class="row-acts"><button class="icon-btn sm" data-cm="${i.id}" title="Commentaires">${I.chat}${(i.data.comments || []).length ? `<i class="cnt">${i.data.comments.length}</i>` : ''}</button><button class="icon-btn sm" data-ed="${i.id}" title="Modifier">${I.edit}</button><button class="icon-btn sm" data-mo="${i.id}" title="Plus">${I.more}</button></span>` },
    ],
    onRow: (i) => go(`#/invoice/${i.id}`), empty: 'Aucune facture',
    footer: (l) => {
      const f = l.filter((r) => r.st.s !== 'brouillon');
      const sum = (fn) => f.reduce((a, r) => a + fn(r), 0);
      return `<tr><td colspan="9"><div class="inv-tot"><div><small>Total HT</small><b>${money(sum((r) => r.st.t.base))}</b></div><div><small>Total TVA</small><b>${money(sum((r) => r.st.t.vat))}</b></div><div><small>Total TTC</small><b>${money(sum((r) => r.st.t.total))}</b></div><div><small>Montant à recevoir TTC</small><b>${money(sum((r) => (['impayee', 'partielle', 'retard'].includes(r.st.s) ? r.st.rest : 0)))}</b></div></div></td></tr>`;
    },
  });
  tbl.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cm],[data-ed],[data-mo]'); if (!b) return;
    const it = rows.find((x) => x.id === +(b.dataset.cm || b.dataset.ed || b.dataset.mo)); if (!it) return;
    if (b.dataset.ed) return go(`#/invoice/${it.id}`);
    if (b.dataset.cm) return invComments(it);
    invMenu(it);
  });
  $('[data-act=new]').onclick = () => menuSheet('Nouvelle facture', [
    { label: 'Facture simple', icon: 'file', primary: true, run: () => newInvoice({ data: { kind: 'facture' } }) },
    { label: 'Facture d\'acompte', icon: 'coins', run: () => newInvoice({ data: { kind: 'acompte' } }) },
    { label: 'Facture d\'avancement ou depuis un devis…', icon: 'calc', run: () => go('#/quotes') },
    { label: 'Note de crédit', icon: 'copy', run: () => newInvoice({ data: { kind: 'avoir' } }) },
  ]);
  $('[data-act=csv]').onclick = () => downloadCSV(`factures-${today()}.csv`, [['Numero', 'Type', 'Date', 'Echeance', 'Client', 'TVA client', 'Chantier', 'Reference', 'Base HT', 'TVA', 'Total TVAC', 'Paye', 'Reste', 'Statut', 'Peppol'],
    ...rows.filter((r) => r.st.s !== 'brouillon').map((r) => { const c = byId(contacts, r.data.clientId) || { data: {} }; return [r.number, INV_TYPE[r.data.kind], fmtDate(r.data.date), fmtDate(r.data.due), contactName(c), c.data.vat, (byId(projects, r.project_id) || { data: {} }).data.name, r.data.title || '', fnum(r.st.t.base), fnum(r.st.t.vat), fnum(r.st.t.total), fnum(r.st.paid), fnum(r.st.rest), invDisp(r).l, r.data.peppol && r.data.peppol.sentAt ? 'envoyée' : '']; })]);
});

function invMenu(it) {
  const d = it.data; const locked = d.status === 'emise';
  menuSheet(`${INV_TYPE[d.kind] || 'Facture'} ${it.number || '(brouillon)'}`, [
    { label: 'Ouvrir', icon: 'edit', run: () => go(`#/invoice/${it.id}`) },
    { label: 'PDF / Imprimer', icon: 'print', run: () => go(`#/print/invoice/${it.id}`) },
    ...(locked ? [{ label: 'Envoyer par email', icon: 'mail', run: () => go(`#/print/invoice/${it.id}?mail=1`) },
      { label: 'Peppol – facture électronique', icon: 'file', run: () => peppolInvoice(it) },
      ...(d.kind !== 'avoir' && invState(it).rest > 0.005 ? [{ label: 'Ajouter un paiement', icon: 'coins', run: () => invPayment(it, null) }] : [])] : []),
    { label: 'Commentaires', icon: 'chat', run: () => invComments(it) },
    ...(!locked ? [{ sep: true }, { label: 'Supprimer le brouillon', icon: 'trash', danger: true, run: async () => { if (confirm('Supprimer ce brouillon ?')) { await db.del('invoice', it.id); render(); } } }] : []),
  ]);
}

function invComments(it) {
  const d = it.data; d.comments = d.comments || [];
  const m = modal(`${mhead(`Commentaires – ${it.number || d.title || 'facture'}`)}<div class="m-body"><div class="feed">${d.comments.map((c) => `<div><b>${esc(userName(c.uid))}</b> ${esc(c.text)}<small class="muted">${fmtDT(c.t)}</small></div>`).join('') || '<p class="muted">Aucun commentaire.</p>'}</div>
    <label class="field"><span>Nouveau commentaire</span><textarea rows="3" data-txt placeholder="ex. client a demandé un report de paiement…"></textarea></label></div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-add>Ajouter</button></div>`);
  $$('[data-close]', m.el).forEach((b) => { b.onclick = () => m.close(); });
  $('[data-add]', m.el).onclick = async () => {
    const t = $('[data-txt]', m.el).value.trim(); if (!t) return;
    d.comments.push({ t: new Date().toISOString(), uid: S.me.id, text: t });
    await persist('invoice', it); m.close(); render();
  };
}

function invPayment(it, i) {
  const d = it.data; d.payments = d.payments || [];
  const s = invState(it);
  const p = i == null ? { date: today(), amount: Math.max(0, s.rest), method: 'Virement' } : d.payments[i];
  formModal({
    title: i == null ? 'Nouveau paiement' : 'Paiement', values: p,
    fields: [{ name: 'amount', label: 'Montant', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date' }, { name: 'method', label: 'Mode', type: 'select', options: PAY_METHODS.map((x) => [x, x]) }, { name: 'note', label: 'Remarque', cls: 'full' }],
    async onSave(v) { Object.assign(p, v, { amount: num(v.amount) }); if (i == null) d.payments.push(p); await persist('invoice', it); render(); },
    onDelete: i == null ? null : async () => { d.payments.splice(i, 1); await persist('invoice', it); render(); },
  });
}

// ---------------------------------------------------------------- Page facture (onglets)
route('invoice', async (id, tab = 'informations') => {
  const it = await db.get('invoice', +id);
  const [contacts, projects, installs] = await Promise.all([db.list('contact'), db.list('project'), db.list('installation').catch(() => [])]);
  const d = it.data; d.payments = d.payments || [];
  const locked = d.status === 'emise';
  const prog = d.kind === 'situation' && !!d.quoteId;
  const TABS = [['informations', 'Informations', 'file'], ['encodage', 'Encodage', 'edit'], ['totaux', 'Totaux', 'percent'], ['visualisation', 'Visualisation', 'eye']];
  if (!TABS.some(([k]) => k === tab)) tab = 'informations';
  const type = INV_TYPE[d.kind] || 'Facture';
  const disp = invDisp(it);
  const save = debounce(async () => { try { await persist('invoice', it, { silent: true }); const el = $('[data-saved]'); if (el) el.textContent = 'Enregistré'; } catch (e) { toast('Erreur : ' + e.message); } }, 700);
  const changed = () => { const el = $('[data-saved]'); if (el) el.textContent = 'Modification…'; save(); };
  const page = layout({ active: 'finances', icon: 'coins', back: '#/invoices',
    title: `${locked ? type : `Modifier une ${type.toLowerCase()}`}${it.number ? ` ${it.number}` : ''}${d.title ? ` – ${d.title}` : ''}`,
    sub: `${badge(disp.l, disp.c)}${d.peppol && d.peppol.sentAt ? ` ${badge('Peppol ✓', '#0c8599')}` : ''} <span class="muted" data-saved></span>`,
    tabs: TABS.map(([k, l, ic]) => `<a href="#/invoice/${it.id}/${k}" class="${k === tab ? 'on' : ''}">${I[ic] || ''} ${l}</a>`).join('') });
  page.innerHTML = `<div class="inv-page" data-body></div>
    <div class="pi-bar">${locked ? `<button class="btn" data-back>Retour</button><span class="grow"></span><a class="btn" href="#/print/invoice/${it.id}">${I.print} PDF</a><span class="btn-split"><button class="btn primary" data-send>${I.mail} Envoyer</button><button class="btn primary" data-more aria-label="Autres actions">${I.chevron}</button></span>`
      : `<span class="grow"></span><button class="btn" data-back>Annuler</button><span class="btn-split"><button class="btn primary" data-submit>Soumettre</button><button class="btn primary" data-more aria-label="Autres actions">${I.chevron}</button></span>`}</div>`;
  const body = $('[data-body]', page);
  const dis = locked ? 'disabled' : '';
  const c = byId(contacts, d.clientId);

  if (tab === 'informations') {
    const clientOpts = contacts.filter((x) => ['client', 'prospect', 'architecte', 'autre'].includes(x.data.kind) || x.id === +d.clientId);
    const addr = (x) => { const cd = (x && x.data) || {}; const l = [cd.address, [cd.zip, cd.city].filter(Boolean).join(' '), cd.country].filter(Boolean); return l.length ? `${I.pin || ''}<div>${l.map(esc).join('<br>')}${cd.vat ? `<br><small class="muted">TVA : ${esc(cd.vat)}</small>` : ''}</div>` : '<span class="muted">Adresse non renseignée sur la fiche du client.</span>'; };
    if (d.billSame == null) d.billSame = true;
    if (d.payDays == null && d.date && d.due) d.payDays = Math.max(0, Math.round((new Date(d.due) - new Date(d.date)) / 864e5));
    body.innerHTML = `<section class="card"><div class="card-h"><h3>Informations générales</h3></div>
      <div class="inv-2col"><div>
        <div class="section-t">Détails de la facture</div>
        ${fieldsGrid([{ name: 'title', label: 'Référence *', cls: 'full', placeholder: 'ex. EA1 – Hippodrome' }, { name: 'ownerId', label: 'Responsable', type: 'user' }, { name: 'kind', label: 'Type de facture', type: 'select', options: optsOf(INV_TYPE) },
          { name: 'date', label: 'Date *', type: 'date' }, { name: 'number', label: 'Numéro', placeholder: 'attribué à la validation' }], { ...d, number: it.number || '' })}
        <div class="section-t">Lié à un chantier / installation</div>
        ${fieldsGrid([{ name: 'project_id', label: 'Chantier', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])], cls: 'full' },
          { name: 'installId', label: 'Installation', type: 'select', options: [['', '—'], ...installs.map((x) => [x.id, x.data.name || x.data.title || `Installation ${x.id}`])], cls: 'full' }], { ...d, project_id: it.project_id || '' })}
      </div><div>
        <div class="section-t">Coordonnées du client</div>
        ${fieldsGrid([{ name: 'clientId', label: 'Client *', type: 'contact', contacts: clientOpts, cls: 'full' }], d)}
        <div class="field full"><span>Adresse du client</span><div class="addr-box" data-addr>${addr(c)}</div></div>
      </div></div></section>
      <section class="card"><div class="card-h"><h3>Informations de facturation</h3></div>
      <div class="inv-2col"><div>
        <div class="section-t">Détails de facturation</div>
        ${fieldsGrid([{ name: 'defaultVat', label: 'Taux de TVA par défaut *', type: 'select', options: vatList().map((r) => [r, `${fnum(r)} %${r === 6 ? ' (taux réduit)' : r === 21 ? ' (taux normal)' : ''}`]) },
          { name: 'payDays', label: 'Conditions de paiement *', type: 'select', options: PAY_TERMS.some(([k]) => k === num(d.payDays)) || d.payDays == null ? PAY_TERMS : [...PAY_TERMS, [num(d.payDays), `${d.payDays} jour(s) après date de facturation`]] },
          { name: 'due', label: 'Date d\'échéance', type: 'date' }, { name: 'communication', label: 'Communication structurée', placeholder: 'générée à la validation' },
          { name: 'reverse', label: 'Autoliquidation (TVA due par le client)', type: 'check', cls: 'full' }],
          { ...d, defaultVat: d.defaultVat ?? defVat(), payDays: d.payDays ?? (num(company().paymentDays) || 30), communication: d.communication ? commFmt(d.communication) : '' })}
        ${!locked ? '<button type="button" class="link-btn" data-applyvat>Appliquer ce taux à toutes les lignes</button>' : ''}
      </div><div>
        <div class="section-t">Coordonnées de facturation</div>
        <label class="toggle"><input type="checkbox" name="billSame" ${d.billSame !== false ? 'checked' : ''} ${dis}><i></i> Coordonnées de facturation identiques à celles du client</label>
        <div data-bill ${d.billSame !== false ? 'hidden' : ''}>${fieldsGrid([{ name: 'billName', label: 'Nom / société facturée', cls: 'full' }, { name: 'billAddress', label: 'Adresse de facturation', type: 'textarea', rows: 3, cls: 'full' }, { name: 'billVat', label: 'N° TVA', cls: 'full' }], { billName: d.billName || (c ? contactName(c) : ''), billAddress: d.billAddress || '', billVat: d.billVat || '' })}</div>
        <div class="section-t">Facturation électronique</div>
        ${fieldsGrid([{ name: 'orderRef', label: 'Référence du bon de commande (fournie par l\'acheteur)', cls: 'full', placeholder: 'Entrer la référence' },
          { name: 'contractRef', label: 'Engagement juridique / n° de contrat', cls: 'full', placeholder: 'Entrer la référence' },
          { name: 'buyerRef', label: 'Référence acheteur (service, personne de contact)', cls: 'full', placeholder: 'par défaut : la référence de la facture' }], d)}
      </div></div></section>`;
    if (locked) $$('input,select,textarea', body).forEach((x) => { x.disabled = true; });
    const val = (n) => { const el = body.querySelector(`[name="${n}"]`); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
    body.addEventListener('change', async (ev) => {
      const n = ev.target.name; if (!n || locked) return;
      if (n === 'clientId') {
        const v = { clientId: val('clientId') === '__new' ? '__new' : (val('clientId') ? +val('clientId') : null) };
        await resolveContact(v, 'clientId', 'client');
        if (v.clientId && val('clientId') === '__new') return render();
        d.clientId = v.clientId; $('[data-addr]', body).innerHTML = addr(byId(contacts, d.clientId));
      } else if (n === 'project_id') { it.project_id = val('project_id') ? +val('project_id') : null; }
      else if (n === 'installId') { d.installId = val('installId') ? +val('installId') : null; }
      else if (n === 'ownerId') { d.ownerId = val('ownerId') ? +val('ownerId') : null; }
      else if (n === 'payDays' || n === 'date') { d[n] = n === 'payDays' ? num(val(n)) : val(n); if (d.date) { d.due = addDays(d.date, num(d.payDays ?? val('payDays'))); body.querySelector('[name=due]').value = d.due; } }
      else if (n === 'billSame') { d.billSame = val('billSame'); $('[data-bill]', body).hidden = d.billSame; }
      else if (n === 'reverse') d.reverse = val('reverse');
      else if (n === 'defaultVat') d.defaultVat = num(val('defaultVat'));
      else if (n === 'communication') d.communication = val('communication').replace(/\D/g, '').length === 12 ? val('communication').replace(/\D/g, '') : val('communication');
      else if (n === 'number') return;
      else d[n] = val(n);
      changed();
    });
    body.addEventListener('input', (ev) => { const n = ev.target.name; if (!locked && ['title', 'billName', 'billAddress', 'billVat', 'orderRef', 'contractRef', 'buyerRef'].includes(n)) { d[n] = ev.target.value; changed(); } });
    if (!locked) vatAutofill($('[data-bill]', body), { name: 'billName' }, { field: 'billVat', address: 'billAddress' });
    const num0 = body.querySelector('[name=number]'); if (num0) num0.readOnly = true;
    const av = $('[data-applyvat]', body);
    if (av) av.onclick = () => { const r = num(val('defaultVat')); d.defaultVat = r; d.lines.forEach((l) => { if (l.kind === 'item') l.vat = r; }); changed(); toast(`TVA ${fnum(r)} % appliquée à toutes les lignes`); };
  }

  if (tab === 'encodage') {
    body.innerHTML = `${prog ? `<div class="alert info">État d'avancement EA${d.situationNo || ''} : les lignes sont calculées depuis l'avancement du devis. ${!locked ? '<button class="btn sm" data-prog>Modifier l\'avancement</button>' : ''}</div>` : ''}
      ${locked ? '<div class="alert info">Facture validée : les lignes ne sont plus modifiables. Pour corriger, créez une note de crédit.</div>' : ''}
      <section class="card inv-enc"><div id="lines"></div><div class="inv-enc-foot"><span class="grow"></span><div data-marge></div><div><small class="muted">Total HT</small><b data-ht></b></div></div></section>`;
    const foot = () => { const t = totals(d); $('[data-ht]', body).textContent = money(t.base); const m = $('[data-marge]', body); m.innerHTML = t.cost > 0 ? `<small class="muted">Marge bénéficiaire</small><b>${fnum(t.base ? ((t.base - t.cost) / t.base) * 100 : 0, 1)} % / ${money(t.base - t.cost)}</b>` : ''; };
    linesEditor($('#lines', body), d, { showCost: false, defVat: d.defaultVat, readOnly: locked || prog, onChange: () => { foot(); changed(); } });
    foot();
    const pg = $('[data-prog]', body);
    if (pg) pg.onclick = async () => { const q = await db.get('quote', +d.quoteId); const others = (await db.list('invoice')).filter((x) => +x.data.quoteId === q.id && x.id !== it.id); progressInvoice(q, others, { project_id: it.project_id, data: {} }, it); };
  }

  if (tab === 'totaux') {
    const s = invState(it);
    body.innerHTML = `<div class="cols-2"><div>
      <section class="card"><div class="card-h"><h3>Remise et mentions</h3></div>
        ${fieldsGrid([{ name: 'discount', label: 'Remise globale %', type: 'percent' }, { name: 'reverse', label: 'Autoliquidation', type: 'check' },
          { name: 'notes', label: 'Mentions / remarques imprimées sur la facture', type: 'textarea', rows: 4, cls: 'full' }], { discount: d.discount || '', reverse: d.reverse, notes: d.notes || '' })}</section>
      ${locked && d.kind !== 'avoir' ? `<section class="card"><div class="card-h"><h3>Paiements reçus</h3>${s.rest > 0.005 ? `<button class="btn sm primary" data-pay>${I.plus} Paiement</button>` : ''}</div>
        <div class="rows">${d.payments.map((p, i) => `<button class="row" data-payi="${i}"><span class="grow"><b>${money(p.amount)}</b><small class="muted">${fmtDate(p.date)} · ${esc(p.method || '')}${p.note ? ' · ' + esc(p.note) : ''}</small></span></button>`).join('') || '<div class="empty sm">Aucun paiement</div>'}</div>
        <div class="totals flat"><div class="tr"><span>Payé</span><b>${money(s.paid)}</b></div><div class="tr big"><span>Reste à payer</span><span class="${s.s === 'retard' ? 'late' : ''}">${money(s.rest)}</span></div></div></section>` : ''}
      </div><div><section class="card"><div class="card-h"><h3>Totaux</h3></div><div data-tot></div></section></div></div>`;
    if (locked) $$('input,select,textarea', body).forEach((x) => { x.disabled = true; });
    const drawTot = () => { $('[data-tot]', body).innerHTML = totalsBox(totals(d), d, false); };
    drawTot();
    body.addEventListener('input', (ev) => { const n = ev.target.name; if (locked || !n) return; d[n] = n === 'discount' ? num(ev.target.value) : n === 'reverse' ? ev.target.checked : ev.target.value; drawTot(); changed(); });
    body.addEventListener('change', (ev) => { if (ev.target.name === 'reverse' && !locked) { d.reverse = ev.target.checked; drawTot(); changed(); } });
    const pb = $('[data-pay]', body); if (pb) pb.onclick = () => invPayment(it, null);
    $$('[data-payi]', body).forEach((b) => { b.onclick = () => invPayment(it, +b.dataset.payi); });
  }

  if (tab === 'visualisation') {
    await save.flush();
    body.innerHTML = `<div class="inv-vis"><section class="card inv-vis-side"><h3>Affiner la présentation de votre document</h3>
        <p class="muted sm">Le modèle définit l'apparence de la facture (couleurs, colonnes, mentions) et ce que voit votre client lors de l'envoi.</p>
        <label class="field"><span>Modèle</span><select disabled><option>Modèle de l'entreprise</option></select></label>
        ${isAdmin() ? `<a class="btn" href="#/settings/templates">${I.edit} Modifier le modèle</a>` : ''}
        <div class="inv-vis-acts"><a class="btn" href="#/print/invoice/${it.id}">${I.print} PDF / Imprimer</a>${locked ? `<a class="btn" href="#/print/invoice/${it.id}?mail=1">${I.mail} Envoyer par email</a>` : ''}</div></section>
      <div class="inv-vis-doc"><div class="print-page" data-doc><p class="muted">Chargement de l'aperçu…</p></div></div></div>`;
    try { const r = await docHtml('invoice', it.id); const el = $('[data-doc]', body); if (el) el.innerHTML = r.html; } catch (e) { $('[data-doc]', body).innerHTML = `<p class="late">${esc(e.message)}</p>`; }
  }

  // --- barre du bas
  const back = () => go(it.project_id && location.hash.includes('from=project') ? `#/project/${it.project_id}/invoices` : '#/invoices');
  $('[data-back]', page).onclick = async () => { await save.flush(); back(); };
  const c2 = () => byId(contacts, d.clientId);
  const emit = async (after) => {
    await save.flush();
    if (!d.clientId) { toast('Choisissez d\'abord le client (onglet Informations)', 4000); return go(`#/invoice/${it.id}/informations`); }
    if (!(d.title || '').trim()) { toast('Indiquez la référence de la facture', 4000); return go(`#/invoice/${it.id}/informations`); }
    if (!d.lines.some((l) => l.kind === 'item')) { toast('La facture ne contient aucune ligne (onglet Encodage)', 4000); return go(`#/invoice/${it.id}/encodage`); }
    if (d.reverse && !(c2() && c2().data.vat)) return toast('Autoliquidation : indiquez d\'abord le n° de TVA du client (obligatoire sur la facture)', 5000);
    if (!confirm('Soumettre la facture ? Elle reçoit son numéro définitif et ne sera plus modifiable.')) return;
    const r = await api('POST', `number/${d.kind === 'avoir' ? 'avoir' : 'invoice'}`);
    it.number = r.number; d.status = 'emise'; d.emittedAt = today();
    if (!d.communication && company().country !== 'FR') d.communication = structComm(r.number.replace(/\D/g, ''));
    await persist('invoice', it); toast(`Facture ${it.number} soumise`);
    if (after === 'mail') return go(`#/print/invoice/${it.id}?mail=1`);
    if (after === 'peppol') { go(`#/invoice/${it.id}/visualisation`); return setTimeout(() => peppolInvoice(it), 600); }
    go(`#/invoice/${it.id}/visualisation`);
  };
  const sub = $('[data-submit]', page); if (sub) sub.onclick = () => emit();
  const snd = $('[data-send]', page); if (snd) snd.onclick = () => go(`#/print/invoice/${it.id}?mail=1`);
  $('[data-more]', page).onclick = () => menuSheet(locked ? 'Facture' : 'Soumettre', locked ? [
    { label: 'Envoyer par email', icon: 'mail', run: () => go(`#/print/invoice/${it.id}?mail=1`) },
    { label: 'Peppol – facture électronique', icon: 'file', primary: true, run: () => peppolInvoice(it) },
    ...(d.kind !== 'avoir' && invState(it).rest > 0.005 ? [{ label: 'Ajouter un paiement', icon: 'coins', run: () => invPayment(it, null) }] : []),
    ...(d.kind !== 'avoir' ? [{ label: 'Créer une note de crédit', icon: 'copy', run: () => newInvoice({ project_id: it.project_id, data: { kind: 'avoir', clientId: d.clientId, quoteId: d.quoteId, reverse: d.reverse, discount: d.discount, defaultVat: d.defaultVat, title: `Annulation facture ${it.number}`, refInvoice: it.number, lines: d.lines.map((l) => (l.kind === 'item' ? { ...l, id: lid(), qty: -num(l.qty) } : { ...l, id: lid() })) } }) }] : []),
    ...(d.quoteId ? [{ label: 'Ouvrir le devis', icon: 'calc', run: () => go(`#/quote/${d.quoteId}`) }] : []),
    { label: 'Commentaires', icon: 'chat', run: () => invComments(it) },
  ] : [
    { label: 'Soumettre et envoyer par email', icon: 'mail', run: () => emit('mail') },
    ...(peppolApOn() ? [{ label: 'Soumettre et envoyer via Peppol', icon: 'file', run: () => emit('peppol') }] : []),
    { label: 'Enregistrer le brouillon', icon: 'file', run: async () => { await save.flush(); toast('Brouillon enregistré'); } },
    ...(d.quoteId ? [{ label: 'Ouvrir le devis', icon: 'calc', run: () => go(`#/quote/${d.quoteId}`) }] : []),
    { sep: true },
    { label: 'Supprimer le brouillon', danger: true, icon: 'trash', run: async () => { if (confirm('Supprimer ce brouillon ?')) { await db.del('invoice', it.id); go('#/invoices'); } } },
  ]);
  cleanupView = () => save.flush();
});
