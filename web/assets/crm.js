'use strict';
/* CRM : contacts (clients, prospects, fournisseurs, sous-traitants) et opportunités (Kanban). */

const contactFields = (kind) => [
  { name: 'kind', label: 'Type', type: 'select', options: optsOf(CONTACT_KINDS) },
  { name: 'company', label: 'Société', placeholder: 'Laisser vide pour un particulier' },
  { name: 'civility', label: 'Civilité', type: 'select', options: [['', '—'], ['M.', 'M.'], ['Mme.', 'Mme.'], ['M. et Mme.', 'M. et Mme.'], ['Me', 'Me'], ['Dr', 'Dr']] },
  { name: 'firstname', label: 'Prénom' },
  { name: 'name', label: 'Nom' },
  { name: 'vat', label: 'N° TVA / entreprise' },
  { name: 'peppolId', label: 'Identifiant Peppol', placeholder: 'auto : 0208 + n° d\'entreprise', hint: '<button type="button" class="link-btn" data-peppol>Vérifier sur Peppol</button><span data-peppolres></span>' },
  { name: 'trade', label: 'Corps de métier', list: 'trades', hint: kind === 'client' ? '' : 'Pour fournisseurs et sous-traitants' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Téléphone', type: 'tel' },
  { name: 'mobile', label: 'GSM', type: 'tel' },
  { name: 'iban', label: 'IBAN' },
  { name: 'address', label: 'Adresse', cls: 'full' },
  { name: 'zip', label: 'Code postal' },
  { name: 'city', label: 'Localité' },
  { name: 'country', label: 'Pays' },
  { name: 'source', label: 'Origine', list: 'sources' },
  { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
];
const TRADES = ['Gros œuvre', 'Maçonnerie', 'Charpente', 'Toiture', 'Menuiserie', 'Électricité', 'Plomberie', 'Chauffage', 'HVAC', 'Plafonnage', 'Carrelage', 'Peinture', 'Isolation', 'Façade', 'Terrassement', 'Matériaux', 'Location de matériel'];

// Ouvre la fiche d'édition ; renvoie le contact enregistré (ou null)
// opts.side(box, form) : panneau affiché à côté de la fiche (ex. la facture du fournisseur)
function editContact(c, preset = {}, opts = {}) {
  return new Promise((res) => {
    let saved = null;
    const values = c ? c.data : { kind: 'client', country: company().country === 'FR' ? 'France' : 'Belgique', ...preset };
    formModal({
      title: c ? contactName(c) : 'Nouveau contact', values, fields: contactFields(values.kind), wide: true, side: !!opts.side,
      extra: `<datalist id="trades">${TRADES.map((t) => `<option value="${t}">`).join('')}</datalist><datalist id="sources">${['Site web', 'Bouche-à-oreille', 'Recommandation', 'Salon', 'Réseaux sociaux', 'Architecte', 'Ancien client'].map((t) => `<option value="${t}">`).join('')}</datalist>`,
      async onSave(v, m) {
        if (!v.company && !v.name) throw new Error('Indiquez une société ou un nom');
        const it = c || { data: {} };
        it.data = { ...it.data, ...v };
        const form = $('form', m.el); // dernier contrôle TVA (VIES) gardé sur la fiche
        try { const vc = form && form.dataset.vatcheck && JSON.parse(form.dataset.vatcheck); if (vc && vc.vat.replace(/\D/g, '') === String(v.vat || '').replace(/\D/g, '')) it.data.vatCheck = vc; } catch (e) { /* pas de contrôle */ }
        saved = await persist('contact', it);
      },
      onDelete: c ? async () => { await db.del('contact', c.id); saved = null; go('#/contacts/all'); } : null,
      onClose: () => res(saved),
      after: (form, m) => {
        if (opts.side) opts.side($('[data-side]', m.el), form);
        vatAutofill(form, { name: 'company', street: 'address', zip: 'zip', city: 'city', country: 'country' });
        $('[data-peppol]', form).onclick = () => {
          const d = { vat: form.elements.vat.value, peppolId: form.elements.peppolId.value };
          const id = peppolIdOf(d, countryCode(form.elements.country.value));
          if (!id) return toast('Indiquez le n° de TVA ou l\'identifiant Peppol');
          if (!d.peppolId) form.elements.peppolId.placeholder = id;
          peppolLookupInto($('[data-peppolres]', form), id);
        };
      },
    });
  });
}
// Champ « contact » avec « + Nouveau contact… » : crée le contact si nécessaire
async function resolveContact(v, key, kind) {
  if (v[key] !== '__new') return v[key];
  const c = await editContact(null, { kind });
  v[key] = c ? c.id : null;
  return v[key];
}

route('contacts', async (kind = 'client') => {
  const list = await db.list('contact');
  const labels = { client: 'Clients', prospect: 'Prospects', fournisseur: 'Fournisseurs', soustraitant: 'Sous-traitants', all: 'Tous les contacts' };
  const page = layout({ active: 'contacts', icon: 'contacts', title: labels[kind] || 'Contacts',
    actions: `<button class="btn" data-act="imp">Importer (Excel, CSV, vCard)</button><button class="btn" data-act="csv">Export CSV</button><button class="btn primary" data-act="new">${I.plus} Nouveau contact</button>` });
  $('[data-act=imp]').onclick = () => importContacts(kind === 'all' ? 'client' : kind);
  const rows = list.filter((c) => kind === 'all' || c.data.kind === kind);
  dataTable(page, {
    rows, state: ui.tbl_contacts || (ui.tbl_contacts = {}),
    search: (c) => [contactName(c), c.data.email, c.data.phone, c.data.mobile, c.data.city, c.data.vat, c.data.trade].join(' '),
    columns: [
      { l: 'Nom', v: (c) => `<b>${esc(contactName(c))}</b>${c.data.company && c.data.name ? `<br><small class="muted">${esc([c.data.firstname, c.data.name].filter(Boolean).join(' '))}</small>` : ''}`, sort: (c) => contactName(c).toLowerCase() },
      ...(kind === 'all' ? [{ l: 'Type', v: (c) => badge(CONTACT_KINDS[c.data.kind] || '—', CONTACT_COLORS[c.data.kind] || '#999') }] : []),
      ...(kind === 'fournisseur' || kind === 'soustraitant' ? [{ l: 'Métier', v: (c) => esc(c.data.trade || '') }] : []),
      { l: 'Localité', v: (c) => esc([c.data.zip, c.data.city].filter(Boolean).join(' ')) },
      { l: 'Téléphone', v: (c) => esc(c.data.mobile || c.data.phone || '') },
      { l: 'Email', v: (c) => (c.data.email ? `<a href="mailto:${esc(c.data.email)}">${esc(c.data.email)}</a>` : '') },
    ],
    onRow: (c) => go(`#/contact/${c.id}`),
    empty: 'Aucun contact',
  });
  $('[data-act=new]').onclick = async () => { const c = await editContact(null, { kind: kind === 'all' ? 'client' : kind }); if (c) go(`#/contact/${c.id}`); };
  $('[data-act=csv]').onclick = () => downloadCSV(`contacts-${kind}.csv`, [['Type', 'Société', 'Prénom', 'Nom', 'TVA', 'Email', 'Téléphone', 'GSM', 'Adresse', 'CP', 'Localité', 'Pays'],
    ...rows.map((c) => [CONTACT_KINDS[c.data.kind], c.data.company, c.data.firstname, c.data.name, c.data.vat, c.data.email, c.data.phone, c.data.mobile, c.data.address, c.data.zip, c.data.city, c.data.country])]);
});

route('contact', async (id) => {
  const c = await db.get('contact', +id);
  const all = await db.many(['opportunity', 'quote', 'project', 'invoice', 'order', 'installation', 'intervention']);
  const mine = (t, key = 'clientId') => all[t].filter((x) => +x.data[key] === c.id);
  const opps = mine('opportunity'); const quotes = mine('quote'); const projects = mine('project'); const invoices = mine('invoice');
  const orders = mine('order', 'supplierId'); const inst = mine('installation'); const inter = mine('intervention');
  const sales = invoices.reduce((a, i) => { const s = invState(i); return s.s === 'brouillon' ? a : a + s.t.base * (i.data.kind === 'avoir' ? 1 : 1); }, 0);
  const due = invoices.reduce((a, i) => { const s = invState(i); return ['impayee', 'partielle', 'retard'].includes(s.s) ? a + s.rest : a; }, 0);
  const d = c.data;
  const page = layout({ active: 'contacts', icon: 'contacts', title: contactName(c), back: `#/contacts/${d.kind || 'all'}`,
    sub: badge(CONTACT_KINDS[d.kind] || '—', CONTACT_COLORS[d.kind] || '#999'),
    actions: `<button class="btn" data-act="edit">${I.edit} Modifier</button><button class="btn primary" data-act="new">${I.plus} Créer…</button>` });
  const sect = (title, rows, fn, emptyTxt) => `<div class="card"><div class="card-h"><h3>${title}</h3><span class="muted">${rows.length}</span></div>${rows.length ? `<div class="rows">${rows.map(fn).join('')}</div>` : `<div class="empty sm">${emptyTxt}</div>`}</div>`;
  page.innerHTML = `<div class="cols">
    <div class="col-side"><div class="card info">
      ${[['Société', d.company], ['Contact', [d.firstname, d.name].filter(Boolean).join(' ')], ['TVA', d.vat], ['Métier', d.trade],
        ['Email', d.email && `<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`], ['Téléphone', d.phone && `<a href="tel:${esc(d.phone)}">${esc(d.phone)}</a>`],
        ['GSM', d.mobile && `<a href="tel:${esc(d.mobile)}">${esc(d.mobile)}</a>`], ['Adresse', [d.address, [d.zip, d.city].filter(Boolean).join(' '), d.country].filter(Boolean).map(esc).join('<br>')],
        ['IBAN', d.iban], ['Origine', d.source]].filter(([, v]) => v).map(([k, v]) => `<div class="kv"><span>${k}</span><div>${k === 'Email' || k === 'Téléphone' || k === 'GSM' || k === 'Adresse' ? v : esc(v)}</div></div>`).join('')}
      ${d.notes ? `<div class="kv"><span>Notes</span><div class="pre">${esc(d.notes)}</div></div>` : ''}
      <div class="muted sm">Créé par ${esc(userName(c.created_by))} le ${fmtDT(c.created_at)}</div></div>
      ${d.kind === 'client' || invoices.length ? `<div class="kpis">${kpi('Chiffre d\'affaires HT', money(sales))}${kpi('Reste à encaisser', money(due), { cls: due > 0 ? 'warn' : '' })}</div>` : ''}
    </div>
    <div class="col-main">
      ${sect('Opportunités', opps, (o) => `<a class="row" href="#/opportunities?o=${o.id}"><span class="grow"><b>${esc(o.data.title)}</b><small class="muted">${esc(o.number || '')}</small></span>${stageBadge(o.data.stage)}<b>${money(o.data.amount)}</b></a>`, 'Aucune opportunité')}
      ${sect('Devis', quotes, (q) => `<a class="row" href="#/quote/${q.id}"><span class="grow"><b>${esc(q.number)} · ${esc(q.data.title || '')}</b><small class="muted">${fmtDate(q.data.date)}</small></span>${st(QST, q.data.status)}<b>${money(totals(q.data).base)}</b></a>`, 'Aucun devis')}
      ${sect('Chantiers', projects, (p) => `<a class="row" href="#/project/${p.id}"><span class="grow"><b>${esc(p.data.name)}</b><small class="muted">${esc(p.number || '')} · ${esc(p.data.city || '')}</small></span>${st(PST, p.data.status)}</a>`, 'Aucun chantier')}
      ${sect('Factures', invoices, (i) => { const s = invState(i); return `<a class="row" href="#/invoice/${i.id}"><span class="grow"><b>${esc(i.number || 'Brouillon')} · ${esc(IKIND[i.data.kind] || 'Facture')}</b><small class="muted">${fmtDate(i.data.date)}</small></span>${st(IST, s.s)}<b>${money(s.t.total)}</b></a>`; }, 'Aucune facture')}
      ${orders.length ? sect('Commandes', orders, (o) => `<a class="row" href="#/order/${o.id}"><span class="grow"><b>${esc(o.number)}</b><small class="muted">${fmtDate(o.data.date)}</small></span>${st(OST, o.data.status)}<b>${money(totals(o.data).base)}</b></a>`, '') : ''}
      ${inst.length ? sect('Installations', inst, (x) => `<a class="row" href="#/installations?i=${x.id}"><span class="grow"><b>${esc(x.data.name)}</b><small class="muted">${esc([x.data.brand, x.data.model].filter(Boolean).join(' '))}</small></span></a>`, '') : ''}
      ${inter.length ? sect('Interventions', inter, (x) => `<a class="row" href="#/intervention/${x.id}"><span class="grow"><b>${esc(x.number)} · ${esc(x.data.title || '')}</b><small class="muted">${fmtDate(x.data.date)}</small></span>${st(INTST, x.data.status)}</a>`, '') : ''}
    </div></div>`;
  $('[data-act=edit]').onclick = async () => { await editContact(c); render(); };
  $('[data-act=new]').onclick = () => menuSheet('Créer pour ' + contactName(c), [
    { label: 'Opportunité', run: () => editOpportunity(null, { clientId: c.id }) },
    { label: 'Devis', run: () => newQuote({ clientId: c.id }) },
    { label: 'Chantier', run: () => editProject(null, { clientId: c.id }) },
    { label: 'Intervention', run: () => editIntervention(null, { clientId: c.id }) },
    { label: 'Installation', run: () => editInstallation(null, { clientId: c.id }) },
    ...(d.kind === 'fournisseur' || d.kind === 'soustraitant' ? [{ label: 'Commande', run: () => newOrder({ supplierId: c.id, kind: d.kind }) }] : []),
  ]);
});

function downloadCSV(name, rows) {
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------------------------------------------------------------- Opportunités
const stageBadge = (k) => { const s = OPP_STAGES.find((x) => x[0] === k) || OPP_STAGES[0]; return badge(s[1], s[2]); };

async function editOpportunity(o, preset = {}) {
  const contacts = await db.list('contact');
  formModal({
    title: o ? `Opportunité ${o.number}` : 'Nouvelle opportunité', wide: true,
    values: o ? o.data : { stage: 'nouveau', ownerId: S.me.id, probability: 50, date: today(), ...preset },
    fields: [
      { name: 'title', label: 'Titre', required: true, cls: 'full', placeholder: 'ex. Rénovation salle de bain' },
      { name: 'clientId', label: 'Client / prospect', type: 'contact', contacts, kinds: ['client', 'prospect', 'architecte', 'autre'] },
      { name: 'stage', label: 'Étape', type: 'select', options: OPP_STAGES.map(([k, l]) => [k, l]) },
      { name: 'amount', label: 'Montant estimé HT', type: 'money' },
      { name: 'probability', label: 'Probabilité %', type: 'percent' },
      { name: 'expected', label: 'Signature prévue', type: 'date' },
      { name: 'ownerId', label: 'Responsable', type: 'user' },
      { name: 'source', label: 'Origine', list: 'sources' },
      { name: 'nextDate', label: 'Prochaine relance', type: 'date' },
      { name: 'nextAction', label: 'Action à faire', cls: 'full', placeholder: 'ex. Rappeler pour fixer la visite' },
      { name: 'siteAddress', label: 'Adresse du chantier', cls: 'full' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
      ...(o && o.data.stage === 'perdu' ? [{ name: 'lostReason', label: 'Raison de la perte', cls: 'full' }] : []),
    ],
    extra: `<datalist id="sources">${['Site web', 'Bouche-à-oreille', 'Recommandation', 'Salon', 'Réseaux sociaux', 'Architecte', 'Ancien client'].map((t) => `<option value="${t}">`).join('')}</datalist>
      ${o ? `<div class="btns"><button type="button" class="btn" data-q>${I.calc} Créer un devis</button></div>` : ''}`,
    async onSave(v) {
      await resolveContact(v, 'clientId', 'prospect');
      const it = o || { data: {} };
      it.data = { ...it.data, ...v };
      await persist('opportunity', it);
      render();
    },
    onDelete: o ? async () => { await db.del('opportunity', o.id); render(); } : null,
    after: (form, m) => { const b = $('[data-q]', form); if (b) b.onclick = () => { m.close(); newQuote({ clientId: o.data.clientId, opportunityId: o.id, title: o.data.title, siteAddress: o.data.siteAddress }); }; },
  });
}

route('opportunities', async () => {
  const [opps, contacts] = await Promise.all([db.list('opportunity'), db.list('contact')]);
  const view = ui.oppView || 'kanban';
  const mineOnly = ui.oppMine;
  const list = opps.filter((o) => !mineOnly || +o.data.ownerId === S.me.id);
  const open = list.filter((o) => OPP_OPEN.includes(o.data.stage));
  const page = layout({ active: 'opportunities', icon: 'target', title: 'Opportunités',
    sub: `${open.length} en cours · ${money(open.reduce((a, o) => a + num(o.data.amount), 0))} · pondéré ${money(open.reduce((a, o) => a + num(o.data.amount) * num(o.data.probability) / 100, 0))}`,
    actions: `<label class="chk"><input type="checkbox" data-mine ${mineOnly ? 'checked' : ''}>Mes opportunités</label>
      <div class="seg-sm"><button class="${view === 'kanban' ? 'on' : ''}" data-v="kanban">Kanban</button><button class="${view === 'list' ? 'on' : ''}" data-v="list">Liste</button></div>
      <button class="btn primary" data-act="new">${I.plus} Nouvelle opportunité</button>` });
  $$('[data-v]').forEach((b) => { b.onclick = () => { ui.oppView = b.dataset.v; saveUi(); render(); }; });
  $('[data-mine]').onchange = (e) => { ui.oppMine = e.target.checked; saveUi(); render(); };
  $('[data-act=new]').onclick = () => editOpportunity();
  const cname = (o) => contactName(byId(contacts, o.data.clientId));
  if (view === 'list') {
    dataTable(page, {
      rows: list, state: ui.tbl_opp || (ui.tbl_opp = {}),
      search: (o) => [o.number, o.data.title, cname(o)].join(' '),
      filters: { def: 'open', options: [['open', 'En cours'], ['gagne', 'Gagnées'], ['perdu', 'Perdues'], ['', 'Toutes']], match: (o, f) => (f === 'open' ? OPP_OPEN.includes(o.data.stage) : o.data.stage === f) },
      columns: [
        { l: 'Opportunité', v: (o) => `<b>${esc(o.data.title)}</b><br><small class="muted">${esc(o.number)}</small>` },
        { l: 'Client', v: (o) => esc(cname(o)) },
        { l: 'Étape', v: (o) => stageBadge(o.data.stage), sort: (o) => OPP_STAGES.findIndex((s) => s[0] === o.data.stage) },
        { l: 'Relance', v: (o) => (o.data.nextDate ? `<span class="${o.data.nextDate < today() ? 'late' : ''}">${fmtDate(o.data.nextDate)}</span>` : ''), sort: (o) => o.data.nextDate || '9' },
        { l: 'Responsable', v: (o) => avatar(+o.data.ownerId) },
        { l: 'Montant HT', cls: 'r', v: (o) => money(o.data.amount), sort: (o) => num(o.data.amount) },
      ],
      onRow: (o) => editOpportunity(o),
    });
    return;
  }
  page.innerHTML = `<div class="kanban">${OPP_STAGES.map(([k, l, c]) => {
    const col = list.filter((o) => (o.data.stage || 'nouveau') === k).sort((a, b) => (a.data.nextDate || '9').localeCompare(b.data.nextDate || '9'));
    return `<div class="k-col" data-stage="${k}"><div class="k-head" style="--c:${c}"><i class="dot"></i><b>${l}</b><span class="muted">${col.length}</span><span class="grow"></span><small>${money(col.reduce((a, o) => a + num(o.data.amount), 0))}</small></div>
      <div class="k-list">${col.map((o) => `<div class="k-card" draggable="true" data-o="${o.id}"><b>${esc(o.data.title)}</b><small class="muted">${esc(cname(o))}</small>
        <div class="k-foot">${avatar(+o.data.ownerId)}${o.data.nextDate ? `<small class="${o.data.nextDate < today() ? 'late' : 'muted'}">${I.bell} ${fmtDate(o.data.nextDate)}</small>` : ''}<span class="grow"></span><b>${money(o.data.amount)}</b></div></div>`).join('')}</div></div>`;
  }).join('')}</div>`;
  let dragId = null;
  $$('.k-card', page).forEach((card) => {
    card.onclick = () => editOpportunity(opps.find((o) => o.id === +card.dataset.o));
    card.ondragstart = (e) => { dragId = +card.dataset.o; e.dataTransfer.effectAllowed = 'move'; card.classList.add('drag'); };
    card.ondragend = () => card.classList.remove('drag');
  });
  $$('.k-col', page).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
    col.ondragleave = () => col.classList.remove('over');
    col.ondrop = async (e) => {
      e.preventDefault(); col.classList.remove('over');
      const o = opps.find((x) => x.id === dragId); if (!o || o.data.stage === col.dataset.stage) return;
      o.data.stage = col.dataset.stage;
      if (o.data.stage === 'gagne') o.data.wonAt = today();
      await persist('opportunity', o); render();
    };
  });
  const focus = new URLSearchParams(location.hash.split('?')[1] || '').get('o');
  if (focus) { const o = opps.find((x) => x.id === +focus); if (o) editOpportunity(o); }
});
