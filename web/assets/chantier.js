'use strict';
/* Chantiers : liste, fiche avec onglets (aperçu financier, devis, commandes, factures, achats, heures…). */

const PTABS = [
  ['overview', 'Aperçu'], ['quotes', 'Devis'], ['orders', 'Commandes'], ['invoices', 'Factures'], ['expenses', 'Achats'], ['hours', 'Heures'],
  ['planning', 'Planning'], ['plans', 'Plans'], ['points', 'Points'], ['meetings', 'PV de réunion'], ['forms', 'Formulaires'], ['diary', 'Journal'], ['documents', 'Documents'],
];

async function editProject(p, preset = {}) {
  const contacts = await db.list('contact');
  formModal({
    title: p ? `Chantier ${p.number}` : 'Nouveau chantier', wide: true,
    values: p ? p.data : { status: 'preparation', managerId: S.me.id, start: today(), color: '#3b5bdb', ...preset },
    fields: [
      { name: 'name', label: 'Nom du chantier', required: true, cls: 'full' },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'prospect', 'architecte', 'autre'] },
      { name: 'status', label: 'Statut', type: 'select', options: optsOf(PST) },
      { name: 'address', label: 'Adresse', cls: 'full' }, { name: 'zip', label: 'Code postal' }, { name: 'city', label: 'Localité' },
      { name: 'start', label: 'Début', type: 'date' }, { name: 'end', label: 'Fin prévue', type: 'date' },
      { name: 'managerId', label: 'Conducteur de travaux', type: 'user' }, { name: 'team', label: 'Équipe', type: 'users', cls: 'full' },
      { name: 'architectId', label: 'Architecte / BE', type: 'contact', contacts, kinds: ['architecte', 'autre'], allowNew: false },
      { name: 'color', label: 'Couleur (planning)', type: 'color' },
      { name: 'budget', label: 'Budget HT (si pas de devis)', type: 'money' }, { name: 'access', label: 'Accès / codes / clés' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) {
      await resolveContact(v, 'clientId', 'client');
      const it = p || { data: {} };
      it.data = { ...it.data, ...v };
      const r = await persist('project', it);
      if (!p) go(`#/project/${r.id}`); else render();
    },
    onDelete: p ? async () => {
      if (!confirm(`Supprimer DÉFINITIVEMENT le chantier « ${p.data.name} » et tout son contenu (devis, factures, plans, points, photos…) ?`)) return;
      await db.del('project', p.id); go('#/projects');
    } : null,
  });
}

route('projects', async () => {
  const [projects, contacts, quotes] = await Promise.all([db.list('project'), db.list('contact'), db.list('quote')]);
  const budget = (p) => { const acc = quotes.filter((q) => q.project_id === p.id && q.data.status === 'accepte'); return acc.length ? acc.reduce((a, q) => a + totals(q.data).base, 0) : num(p.data.budget); };
  const view = ui.projView || 'cards';
  const page = layout({ active: 'projects', icon: 'crane', title: 'Chantiers',
    actions: `<div class="seg-sm"><button class="${view === 'cards' ? 'on' : ''}" data-v="cards">Cartes</button><button class="${view === 'list' ? 'on' : ''}" data-v="list">Liste</button></div><button class="btn primary" data-act="new">${I.plus} Nouveau chantier</button>` });
  $$('[data-v]').forEach((b) => { b.onclick = () => { ui.projView = b.dataset.v; saveUi(); render(); }; });
  $('[data-act=new]').onclick = () => editProject();
  const filt = ui.projFilter ?? 'actifs';
  const match = (p, f) => (f === 'actifs' ? ['preparation', 'encours', 'reception'].includes(p.data.status) : p.data.status === f);
  if (view === 'list') {
    dataTable(page, {
      rows: projects, state: ui.tbl_proj || (ui.tbl_proj = { f: 'actifs' }),
      search: (p) => [p.number, p.data.name, p.data.city, contactName(byId(contacts, p.data.clientId))].join(' '),
      filters: { def: 'actifs', options: [['actifs', 'Actifs'], ...Object.entries(PST).map(([k, [l, c]]) => [k, l, c]), ['', 'Tous']], match },
      columns: [
        { l: 'N°', v: (p) => esc(p.number) }, { l: 'Chantier', v: (p) => `<i class="dot" style="--c:${esc(p.data.color || '#3b5bdb')}"></i> <b>${esc(p.data.name)}</b>` },
        { l: 'Client', v: (p) => esc(contactName(byId(contacts, p.data.clientId))) }, { l: 'Localité', v: (p) => esc(p.data.city || '') },
        { l: 'Statut', v: (p) => st(PST, p.data.status) }, { l: 'Début', v: (p) => fmtDate(p.data.start), sort: (p) => p.data.start },
        { l: 'Conducteur', v: (p) => avatar(+p.data.managerId) }, { l: 'Budget HT', cls: 'r', v: (p) => money(budget(p)), sort: budget },
      ],
      onRow: (p) => go(`#/project/${p.id}`), empty: 'Aucun chantier',
    });
    return;
  }
  const list = projects.filter((p) => !filt || match(p, filt)).sort((a, b) => b.id - a.id);
  page.innerHTML = `<div class="chips mb">${[['actifs', 'Actifs'], ...Object.entries(PST).map(([k, [l]]) => [k, l]), ['', 'Tous']].map(([k, l]) => `<button class="chip ${filt === k ? 'on' : ''}" data-f="${k}">${l} <span class="muted">${projects.filter((p) => !k || match(p, k)).length}</span></button>`).join('')}</div>
    ${list.length ? `<div class="pcards">${list.map((p) => `<a class="pcard" href="#/project/${p.id}" style="--c:${esc(p.data.color || '#3b5bdb')}">
      <div class="pc-top"><span class="muted">${esc(p.number)}</span>${st(PST, p.data.status)}</div>
      <b class="pc-name">${esc(p.data.name)}</b>
      <div class="muted">${esc(contactName(byId(contacts, p.data.clientId)))}${p.data.city ? ' · ' + esc(p.data.city) : ''}</div>
      <div class="pc-foot">${avatar(+p.data.managerId)}${(p.data.team || []).slice(0, 4).map((u) => avatar(+u)).join('')}<span class="grow"></span><b>${money(budget(p))}</b></div></a>`).join('')}</div>`
    : empty('Aucun chantier', 'Créez un chantier ou acceptez un devis pour en créer un automatiquement.')}`;
  $$('[data-f]', page).forEach((b) => { b.onclick = () => { ui.projFilter = b.dataset.f; saveUi(); render(); }; });
});

// Calcul financier d'un chantier
function projectFinance(p, all) {
  const acc = all.quote.filter((q) => q.data.status === 'accepte');
  const qt = acc.map((q) => totals(q.data));
  const budget = acc.length ? qt.reduce((a, t) => a + t.base, 0) : num(p.data.budget);
  const est = qt.reduce((a, t) => a + t.cost, 0);
  const estBy = {}; qt.forEach((t) => Object.entries(t.costBy).forEach(([k, v]) => { const kk = k === 'ouvrage' ? 'divers' : k; estBy[kk] = (estBy[kk] || 0) + v; }));
  const realBy = {};
  for (const e of all.expense) for (const x of expenseFor(e, p.id)) realBy[x.category] = (realBy[x.category] || 0) + x.amount;
  for (const h of all.timesheet) realBy.mo = (realBy.mo || 0) + num(h.data.hours) * num(h.data.rate);
  const real = Object.values(realBy).reduce((a, v) => a + v, 0);
  const engaged = all.order.filter((o) => !['facturee', 'annulee'].includes(o.data.status)).reduce((a, o) => a + totals(o.data).base, 0);
  const ist = all.invoice.map(invState).filter((s) => s.s !== 'brouillon');
  const invoiced = ist.reduce((a, s) => a + s.t.base, 0);
  const cashed = ist.reduce((a, s) => a + s.paid, 0);
  const due = ist.reduce((a, s) => a + (s.s === 'avoir' ? 0 : Math.max(0, s.rest)), 0);
  const hours = all.timesheet.reduce((a, h) => a + num(h.data.hours), 0);
  return { budget, est, estBy, real, realBy, engaged, invoiced, cashed, due, hours, margin: budget - Math.max(est, real + engaged) };
}

route('project', async (id, tab = 'overview', sub) => {
  const p = await db.get('project', +id);
  if (tab === 'plan' && sub) return viewPlan(p, +sub);
  if (!PTABS.some(([k]) => k === tab)) tab = 'overview';
  const contacts = await db.list('contact');
  const c = byId(contacts, p.data.clientId);
  const page = layout({ active: 'projects', icon: 'crane', title: p.data.name, back: '#/projects',
    sub: `${esc(p.number)} · ${st(PST, p.data.status)}${c ? ` · <a href="#/contact/${c.id}">${esc(contactName(c))}</a>` : ''}${p.data.city ? ' · ' + esc(p.data.city) : ''}`,
    actions: `<button class="btn" data-act="edit">${I.edit} Modifier</button><button class="btn primary" data-act="padd">${I.plus} Ajouter…</button>`,
    tabs: PTABS.map(([k, l]) => `<a href="#/project/${p.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('') });
  $('[data-act=edit]').onclick = () => editProject(p);
  $('[data-act=padd]').onclick = () => menuSheet('Ajouter au chantier', [
    { label: 'Devis', icon: 'calc', run: () => newQuote({ projectId: p.id, clientId: p.data.clientId, title: p.data.name, siteAddress: [p.data.address, p.data.city].filter(Boolean).join(', ') }) },
    { label: 'Facture', icon: 'coins', run: () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name } }) },
    { label: 'Commande fournisseur', icon: 'truck', run: () => newOrder({ project_id: p.id, kind: 'fournisseur' }) },
    { label: 'Achat / dépense', icon: 'coins', run: () => editExpense(null, { project_id: p.id }) },
    { label: 'Heures prestées', icon: 'people', run: () => editTimesheet(null, { project_id: p.id }) },
    { label: 'Point (observation / réserve)', icon: 'pin', run: () => editPoint(p, null) },
    { label: 'PV de réunion', icon: 'fiche', run: () => editMeeting(p, null) },
    { label: 'Tâche', icon: 'tasks', run: () => editTask(null, { project_id: p.id }) },
  ]);
  const T = {
    overview: tabOverview, quotes: tabPQuotes, orders: tabPOrders, invoices: tabPInvoices, expenses: tabPExpenses, hours: tabPHours,
    planning: tabPPlanning, plans: tabPlans, points: tabPoints, meetings: tabMeetings, forms: tabForms, diary: tabDiary, documents: tabDocuments,
  };
  await T[tab](p, page, contacts);
});

async function tabOverview(p, el, contacts) {
  const all = await db.many(['quote', 'invoice', 'order', 'timesheet', 'point', 'phase', 'task'], p.id);
  all.expense = await db.list('expense'); // achats ventilés sur plusieurs chantiers inclus
  const f = projectFinance(p, all);
  const act = await api('GET', `activity&project=${p.id}&limit=15`).catch(() => []);
  const openPts = all.point.filter((x) => ['open', 'progress'].includes(x.data.status));
  const latePts = openPts.filter((x) => x.data.due && x.data.due < today());
  const phases = all.phase.sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const progress = phases.length ? Math.round(phases.reduce((a, x) => a + num(x.data.progress) * (dnum(x.data.end) - dnum(x.data.start) + 1), 0) / phases.reduce((a, x) => a + (dnum(x.data.end) - dnum(x.data.start) + 1), 0)) : null;
  const d = p.data;
  const used = f.est ? Math.round((f.real / f.est) * 100) : 0;
  el.innerHTML = `<div class="kpis">
      ${kpi('Budget HT (devis acceptés)', money(f.budget))}
      ${kpi('Déboursé prévu', money(f.est), { sub: f.budget ? `marge prévue ${fnum((1 - f.est / f.budget) * 100, 1)} %` : '' })}
      ${kpi('Coût réel', money(f.real), { cls: f.est && f.real > f.est ? 'bad' : '', meter: f.est ? used : null, meterColor: f.real > f.est ? '#e5484d' : '#2f9e44', sub: f.est ? `${used} % du prévu` : '' })}
      ${kpi('Engagé (commandes ouvertes)', money(f.engaged))}
      ${kpi('Facturé HT', money(f.invoiced), { meter: f.budget ? (f.invoiced / f.budget) * 100 : null, sub: f.budget ? `${Math.round((f.invoiced / f.budget) * 100)} % du budget` : '' })}
      ${kpi('Encaissé TVAC', money(f.cashed), { cls: 'good' })}
      ${kpi('Reste à encaisser', money(f.due), { cls: f.due > 0 ? 'warn' : '' })}
      ${kpi('Marge estimée', money(f.margin), { cls: f.margin < 0 ? 'bad' : 'good', sub: f.budget ? `${fnum((f.margin / f.budget) * 100, 1)} %` : '' })}
    </div>
    <div class="cols">
      <div class="col-main">
        <div class="card"><div class="card-h"><h3>Prévu / réel par type de déboursé</h3></div><div class="rows">
          ${Object.entries(TYPES).filter(([k]) => f.estBy[k] || f.realBy[k]).map(([k, l]) => { const e = f.estBy[k] || 0; const r = f.realBy[k] || 0; return `<div class="row static"><i class="tdot" style="--c:${TYPE_COLORS[k]}"></i><span class="grow"><b>${l}</b><small class="muted">Prévu ${money(e)} · Réel ${money(r)}</small><div class="meter"><i style="width:${e ? Math.min(100, (r / e) * 100) : 100}%;--c:${r > e ? '#e5484d' : TYPE_COLORS[k]}"></i></div></span><b class="${r > e ? 'late' : ''}">${r > e ? '+' : ''}${money(r - e)}</b></div>`; }).join('') || '<div class="empty sm">Aucun coût prévu ni réel pour le moment</div>'}
        </div></div>
        <div class="card"><div class="card-h"><h3>Suivi de chantier</h3><a class="btn sm" href="#/project/${p.id}/points">Voir les points</a></div>
          <div class="kpis inner">${kpi('Points ouverts', openPts.length, { href: `#/project/${p.id}/points` })}${kpi('Points en retard', latePts.length, { cls: latePts.length ? 'bad' : '', href: `#/project/${p.id}/points` })}${kpi('Avancement', progress == null ? '—' : progress + ' %', { meter: progress, href: `#/project/${p.id}/planning` })}${kpi('Heures prestées', fnum(f.hours, 1) + ' h', { href: `#/project/${p.id}/hours` })}</div>
          ${phases.length ? `<div class="rows">${phases.slice(0, 6).map((x) => `<div class="row static"><span class="grow"><b>${esc(x.data.name)}</b><small class="muted">${fmtDate(x.data.start)} → ${fmtDate(x.data.end)}</small><div class="meter"><i style="width:${num(x.data.progress)}%"></i></div></span><b>${num(x.data.progress)} %</b></div>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="col-side">
        <div class="card info">
          ${[['Adresse', [d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Début', fmtDate(d.start)], ['Fin prévue', fmtDate(d.end)], ['Accès', d.access]].filter(([, v]) => v).map(([k, v]) => `<div class="kv"><span>${k}</span><div>${esc(v)}</div></div>`).join('')}
          ${d.address ? `<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address, d.zip, d.city].filter(Boolean).join(' '))}">${I.pin} Itinéraire</a>` : ''}
          <div class="kv"><span>Conducteur</span><div>${avatar(+d.managerId)} ${esc(userName(+d.managerId))}</div></div>
          ${(d.team || []).length ? `<div class="kv"><span>Équipe</span><div>${d.team.map((u) => avatar(+u)).join('')}</div></div>` : ''}
          ${d.architectId ? `<div class="kv"><span>Architecte</span><div>${esc(contactName(byId(contacts, d.architectId)))}</div></div>` : ''}
          ${d.notes ? `<div class="kv"><span>Notes</span><div class="pre">${esc(d.notes)}</div></div>` : ''}
        </div>
        <div class="card"><div class="card-h"><h3>Activité récente</h3></div><div class="feed">${act.map((a) => `<div><b>${esc(a.user_name || '')}</b> ${{ create: 'a créé', update: 'a modifié', delete: 'a supprimé', mail: 'a envoyé par email' }[a.action] || a.action} <span class="muted">${esc(TYPE_LABELS[a.type] || a.type)}</span> ${esc(a.label || '')}<small class="muted">${fmtDT(a.created_at)}</small></div>`).join('') || '<div class="empty sm">Aucune activité</div>'}</div></div>
      </div></div>`;
  bindKpis(el);
}
const TYPE_LABELS = { project: 'chantier', quote: 'devis', invoice: 'facture', order: 'commande', expense: 'achat', timesheet: 'heures', point: 'point', meeting: 'PV', form: 'formulaire', diary: 'journal', plan: 'plan', phase: 'phase', task: 'tâche', document: 'document', contact: 'contact', opportunity: 'opportunité', intervention: 'intervention' };

async function tabPQuotes(p, el, contacts) {
  const quotes = await db.list('quote', { project: p.id });
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="nq">${I.plus} Nouveau devis</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: quotes, columns: [{ l: 'N°', v: (q) => `<b>${esc(q.number)}</b>` }, { l: 'Objet', v: (q) => esc(q.data.title || '') }, { l: 'Date', v: (q) => fmtDate(q.data.date) }, { l: 'Statut', v: (q) => st(QST, q.data.status) },
      { l: 'Déboursé', cls: 'r', v: (q) => money(totals(q.data).cost) }, { l: 'Total HT', cls: 'r', v: (q) => `<b>${money(totals(q.data).base)}</b>` }],
    onRow: (q) => go(`#/quote/${q.id}`), empty: 'Aucun devis pour ce chantier',
  });
  $('[data-act=nq]', el).onclick = () => newQuote({ projectId: p.id, clientId: p.data.clientId, title: p.data.name, siteAddress: [p.data.address, p.data.city].filter(Boolean).join(', ') });
}
async function tabPOrders(p, el, contacts) {
  const [orders, quotes] = await Promise.all([db.list('order', { project: p.id }), db.list('quote', { project: p.id })]);
  el.innerHTML = `<div class="toolbar"><span class="grow"></span>${quotes.length ? '<button class="btn" data-act="fq">Depuis un devis…</button>' : ''}<button class="btn primary" data-act="no">${I.plus} Nouvelle commande</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: orders, columns: [{ l: 'N°', v: (o) => `<b>${esc(o.number)}</b>` }, { l: 'Type', v: (o) => (o.data.kind === 'soustraitant' ? 'Sous-traitant' : 'Fournisseur') }, { l: 'Fournisseur', v: (o) => esc(contactName(byId(contacts, o.data.supplierId))) },
      { l: 'Date', v: (o) => fmtDate(o.data.date) }, { l: 'Livraison', v: (o) => fmtDate(o.data.deliveryDate) }, { l: 'Statut', v: (o) => st(OST, o.data.status) }, { l: 'Total HT', cls: 'r', v: (o) => `<b>${money(totals(o.data).base)}</b>` }],
    onRow: (o) => go(`#/order/${o.id}`), empty: 'Aucune commande',
    footer: (l) => `<tr><td colspan="6">Total</td><td class="r"><b>${money(l.reduce((a, o) => a + totals(o.data).base, 0))}</b></td></tr>`,
  });
  $('[data-act=no]', el).onclick = () => newOrder({ project_id: p.id });
  const fq = $('[data-act=fq]', el); if (fq) fq.onclick = () => (quotes.length === 1 ? ordersFromQuote(quotes[0]) : menuSheet('Quel devis ?', quotes.map((q) => ({ label: `${q.number} · ${q.data.title || ''}`, run: () => ordersFromQuote(q) }))));
}
async function tabPInvoices(p, el, contacts) {
  const [invoices, quotes] = await Promise.all([db.list('invoice', { project: p.id }), db.list('quote', { project: p.id })]);
  const acc = quotes.filter((q) => q.data.status === 'accepte');
  el.innerHTML = `<div class="toolbar"><span class="grow"></span>${acc.length ? '<button class="btn" data-act="fq">Facturer un devis…</button>' : ''}<button class="btn primary" data-act="ni">${I.plus} Facture libre</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: invoices.map((i) => ({ ...i, st: invState(i) })),
    columns: [{ l: 'N°', v: (i) => `<b>${esc(i.number || 'Brouillon')}</b>` }, { l: 'Type', v: (i) => esc(IKIND[i.data.kind]) }, { l: 'Date', v: (i) => fmtDate(i.data.date) }, { l: 'Échéance', v: (i) => fmtDate(i.data.due) },
      { l: 'Statut', v: (i) => st(IST, i.st.s) }, { l: 'Total HT', cls: 'r', v: (i) => money(i.st.t.base) }, { l: 'Total TVAC', cls: 'r', v: (i) => `<b>${money(i.st.t.total)}</b>` }, { l: 'Reste', cls: 'r', v: (i) => (['brouillon', 'avoir'].includes(i.st.s) ? '' : money(i.st.rest)) }],
    onRow: (i) => go(`#/invoice/${i.id}`), empty: 'Aucune facture',
  });
  $('[data-act=ni]', el).onclick = () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name } });
  const fq = $('[data-act=fq]', el); if (fq) fq.onclick = () => (acc.length === 1 ? invoiceFromQuote(acc[0]) : menuSheet('Quel devis ?', acc.map((q) => ({ label: `${q.number} · ${q.data.title || ''}`, run: () => invoiceFromQuote(q) }))));
}

// ---------------------------------------------------------------- Achats & dépenses
async function editExpense(e, preset = {}) {
  const [contacts, projects] = await Promise.all([db.list('contact'), db.list('project')]);
  const d = e ? e.data : { date: today(), category: 'mat', vat: defVat(), ...preset };
  let fileId = d.fileId; let fileName = d.fileName;
  const alloc = (d.alloc || []).map((x) => ({ ...x }));
  let guess = !d.supplierId ? d.supplierGuess : null;
  let getAlloc = () => null;
  const note = e ? (d.toCheck ? (d.peppol ? 'Reçue via Peppol : choisissez le chantier puis enregistrez.' : 'À vérifier.') : '') : d.readNote;
  formModal({
    title: e ? 'Achat / dépense' : 'Nouvel achat', wide: true, values: { ...d, project_id: e ? e.project_id : preset.project_id },
    fields: [
      ...(note ? [{ name: 'note', type: 'html', cls: 'full', html: `<div class="hint-box">${esc(note)}</div>` }] : []),
      { name: 'desc', label: 'Description', required: true, cls: 'full', placeholder: 'ex. Facture blocs béton' },
      { name: 'supplierId', label: 'Fournisseur', type: 'contact', contacts, kinds: ['fournisseur', 'soustraitant', 'autre'] },
      ...(guess ? [{ name: 'guess', type: 'html', cls: 'full', html: `<div class="hint-box" data-guess>Fournisseur lu sur la facture : <b>${esc(guess.name || '?')}</b>${guess.vat ? ` (TVA ${esc(guess.vat)})` : ''} <button type="button" class="btn sm" data-mksup>${I.plus} Créer ce fournisseur</button></div>` }] : []),
      { name: 'date', label: 'Date', type: 'date' }, { name: 'ref', label: 'N° facture fournisseur' },
      { name: 'amount', label: 'Montant HT', type: 'money', required: true }, { name: 'vat', label: 'TVA', type: 'select', options: vatOptions(d.vat) },
      { name: 'due', label: 'Échéance', type: 'date' }, { name: 'paid', label: 'Payée', type: 'check' },
      { name: 'project_id', label: 'Chantier', type: 'select', options: [['', '— frais généraux —'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])] },
      { name: 'category', label: 'Type de coût', type: 'select', options: optsOf(TYPES) },
      { name: 'alloc', type: 'html', cls: 'full', html: `<div class="alloc" data-alloc><label class="chk"><input type="checkbox" data-split ${alloc.length > 1 ? 'checked' : ''}><span>Répartir sur plusieurs chantiers (suivi de chaque chantier)</span></label><div data-rows></div><div class="alloc-foot"><button type="button" class="btn sm" data-addrow>${I.plus} Chantier</button><span class="grow"></span><b data-restinfo></b></div></div>` },
      { name: 'file', type: 'html', cls: 'full', html: `<span class="lbl">Pièce jointe (photo ou PDF)</span><div class="file-pick"><span data-fn>${fileId ? `<a href="${fileUrl(fileId)}" target="_blank">${esc(fileName)}</a>` : '<span class="muted">Aucune</span>'}</span><button type="button" class="btn sm" data-up>${I.camera} Joindre</button></div>` },
    ],
    after: (form) => {
      getAlloc = allocEditor(form, { projects, alloc, amountField: form.elements.amount, projectField: form.elements.project_id, category: () => form.elements.category.value });
      const mk = $('[data-mksup]', form);
      if (mk) mk.onclick = async () => {
        const c = await editContact(null, { kind: 'fournisseur', company: guess.name || '', vat: guess.vat || '', peppolId: guess.peppolId || '', address: guess.address || '', zip: guess.zip || '', city: guess.city || '', email: guess.email || '' });
        if (!c) return;
        const sel = form.elements.supplierId;
        sel.insertAdjacentHTML('afterbegin', `<option value="${c.id}">${esc(contactName(c))}</option>`); sel.value = c.id;
        $('[data-guess]', form).remove(); guess = null;
      };
      $('[data-up]', form).onclick = async () => {
        const [file] = await pickFile('image/*,application/pdf'); if (!file) return;
        toast('Envoi…', 10000);
        const pid = form.elements.project_id.value;
        const r = file.type.startsWith('image/') ? await uploadPhoto(file, pid) : await upload(file, pid);
        fileId = r.id; fileName = r.name; $('[data-fn]', form).innerHTML = `<a href="${fileUrl(fileId)}" target="_blank">${esc(fileName)}</a>`; toast('Fichier joint');
      };
    },
    async onSave(v) {
      const rows = getAlloc();
      await resolveContact(v, 'supplierId', 'fournisseur');
      const it = e || { data: {} };
      delete v.note; delete v.guess; delete v.alloc; delete v.file;
      if (rows && rows.length > 1) { it.project_id = null; v.alloc = rows; v.category = rows[0].category; }
      else if (rows && rows.length === 1) { it.project_id = rows[0].pid; v.category = rows[0].category; v.alloc = null; }
      else { it.project_id = v.project_id ? +v.project_id : null; v.alloc = null; }
      delete v.project_id;
      it.data = { ...it.data, ...v, amount: num(v.amount), vat: num(v.vat), fileId, fileName, toCheck: false };
      delete it.data.readNote; delete it.data.supplierGuess;
      if (!it.data.alloc) delete it.data.alloc;
      await persist('expense', it); render();
    },
    onDelete: e ? async () => { await delFile(d.fileId); if (d.xmlFileId) await delFile(d.xmlFileId); await db.del('expense', e.id); render(); } : null,
  });
}
// pid : tableau d'un chantier (montants = part de ce chantier)
function expensesTable(el, rows, contacts, projects, showProject, pid) {
  const amt = (e) => (pid ? expenseAmountFor(e, pid) : num(e.data.amount));
  const cat = (e) => (pid ? (expenseFor(e, pid)[0] || {}).category : e.data.category);
  const where = (e) => {
    if (isSplit(e)) return `${badge('Ventilé', '#7048e8')} <small class="muted">${expenseParts(e).map((x) => esc(x.pid ? (byId(projects, x.pid) || { data: { name: '?' } }).data.name : 'Frais généraux')).join(', ')}</small>`;
    return esc((byId(projects, e.project_id) || { data: { name: 'Frais généraux' } }).data.name);
  };
  dataTable(el, {
    rows, state: { sort: -1 },
    search: (e) => [e.data.desc, e.data.ref, contactName(byId(contacts, e.data.supplierId))].join(' '),
    filters: { def: '', options: [['', 'Tout'], ['check', 'À vérifier', '#e8590c'], ...Object.entries(TYPES).map(([k, l]) => [k, l, TYPE_COLORS[k]])], match: (e, f) => (f === 'check' ? !!e.data.toCheck : cat(e) === f) },
    columns: [
      { l: 'Date', v: (e) => fmtDate(e.data.date), sort: (e) => e.data.date }, { l: 'Description', v: (e) => `<b>${esc(e.data.desc)}</b>${e.data.peppol ? ` ${badge('Peppol', '#0c8599')}` : ''}${e.data.toCheck ? ` ${badge('À vérifier', '#e8590c')}` : ''}${pid && isSplit(e) ? ` ${badge('Ventilé', '#7048e8')}` : ''}${e.data.ref ? `<br><small class="muted">${esc(e.data.ref)}</small>` : ''}` },
      { l: 'Fournisseur', v: (e) => esc(contactName(byId(contacts, e.data.supplierId))) },
      ...(showProject ? [{ l: 'Chantier', v: where }] : []),
      { l: 'Type', v: (e) => `<i class="tdot" style="--c:${TYPE_COLORS[cat(e)] || '#999'}"></i>${esc(TYPES[cat(e)] || '')}` },
      { l: 'Pièce', v: (e) => (e.data.fileId ? `<a href="${fileUrl(e.data.fileId)}" target="_blank">${I.file}</a>` : '') },
      { l: 'Payée', v: (e) => (e.data.paid ? badge('Payée', '#2f9e44') : (e.data.due && e.data.due < today() ? badge('En retard', '#e5484d') : badge('À payer', '#f08c00'))) },
      { l: pid ? 'HT (part du chantier)' : 'HT', cls: 'r', v: (e) => `<b>${money(amt(e))}</b>${pid && isSplit(e) ? `<br><small class="muted">sur ${money(e.data.amount)}</small>` : ''}`, sort: amt },
    ],
    onRow: (e) => editExpense(e), empty: 'Aucun achat enregistré',
    footer: (l) => `<tr><td colspan="${showProject ? 7 : 6}">Total</td><td class="r"><b>${money(l.reduce((a, e) => a + amt(e), 0))}</b></td></tr>`,
  });
}
async function tabPExpenses(p, el, contacts) {
  const [all, projects] = await Promise.all([db.list('expense'), db.list('project')]);
  const rows = all.filter((e) => expenseFor(e, p.id).length);
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn" data-act="imp">${I.file} Importer une facture (PDF / XML)</button><button class="btn primary" data-act="ne">${I.plus} Nouvel achat</button></div><div id="tbl"></div>`;
  $('[data-act=imp]', el).onclick = () => importPurchase(p.id);
  expensesTable($('#tbl', el), rows, contacts, projects, false, p.id);
  $('[data-act=ne]', el).onclick = () => editExpense(null, { project_id: p.id });
}
route('expenses', async () => {
  const [rows, contacts, projects] = await Promise.all([db.list('expense'), db.list('contact'), db.list('project')]);
  const page = layout({ active: 'finances', icon: 'coins', title: 'Achats & dépenses', actions: `<button class="btn" data-act="csv">Export CSV</button>${peppolApOn() ? `<button class="btn" data-act="sync">Recevoir (Peppol)</button>` : ''}<button class="btn" data-act="imp">${I.file} Importer une facture</button><button class="btn primary" data-act="ne">${I.plus} Nouvel achat</button>` });
  $('[data-act=imp]').onclick = () => importPurchase();
  const sy = $('[data-act=sync]'); if (sy) sy.onclick = async () => { sy.disabled = true; const r = await peppolSync({ force: true, quiet: false }); sy.disabled = false; if (r && r.created.length) render(); };
  const unpaid = rows.filter((e) => !e.data.paid);
  const toCheck = rows.filter((e) => e.data.toCheck);
  page.innerHTML = `${toCheck.length ? `<div class="hint-box warn">${toCheck.length} facture(s) reçue(s) à vérifier : choisissez le chantier (ou répartissez entre plusieurs) puis enregistrez. <a href="#" data-chk>Afficher</a></div>` : ''}
    <div class="kpis">${kpi('Achats ce mois-ci HT', money(rows.filter((e) => (e.data.date || '').startsWith(today().slice(0, 7))).reduce((a, e) => a + num(e.data.amount), 0)))}${kpi('Factures fournisseurs à payer', money(unpaid.reduce((a, e) => a + num(e.data.amount) + (e.data.vatAmount != null ? num(e.data.vatAmount) : num(e.data.amount) * num(e.data.vat) / 100), 0)), { sub: `${unpaid.length} facture(s) TVAC`, cls: unpaid.some((e) => e.data.due && e.data.due < today()) ? 'bad' : '' })}</div><div id="tbl"></div>`;
  expensesTable($('#tbl'), rows, contacts, projects, true);
  const ck = $('[data-chk]'); if (ck) ck.onclick = (ev) => { ev.preventDefault(); const chip = $('#tbl [data-f="check"]'); if (chip) chip.click(); };
  $('[data-act=ne]').onclick = () => editExpense();
  $('[data-act=csv]').onclick = () => downloadCSV('achats.csv', [['Date', 'Description', 'Ref', 'Fournisseur', 'Chantier', 'Type', 'HT', 'TVA %', 'Payee'],
    ...rows.flatMap((e) => expenseParts(e).map((x) => [fmtDate(e.data.date), e.data.desc, e.data.ref, contactName(byId(contacts, e.data.supplierId)), x.pid ? (byId(projects, x.pid) || { data: {} }).data.name : 'Frais généraux', TYPES[x.category], fnum(x.amount), e.data.vat, e.data.paid ? 'oui' : 'non']))]);
  if (peppolApOn()) peppolSync().then((r) => { if (r && r.created.length && location.hash.startsWith('#/expenses')) render(); });
});

// ---------------------------------------------------------------- Heures prestées (pointage)
async function editTimesheet(t, preset = {}) {
  const [staff, projects] = await Promise.all([db.list('employee'), db.list('project')]);
  const active = staff.filter((s) => s.data.active !== false);
  if (!active.length) { toast('Ajoutez d\'abord votre personnel dans RH → Personnel', 4000); return; }
  const d = t ? t.data : { date: today(), hours: 8, ...preset };
  formModal({
    title: t ? 'Heures prestées' : 'Encoder des heures', values: { ...d, project_id: t ? t.project_id : preset.project_id, employees: t ? [d.employeeId] : [] },
    fields: [
      t ? { name: 'employeeId', label: 'Ouvrier', type: 'select', options: active.map((s) => [s.id, s.data.name]) } : { name: 'employees', label: 'Ouvriers', type: 'multi', options: active.map((s) => [s.id, s.data.name]), cls: 'full' },
      { name: 'project_id', label: 'Chantier', type: 'select', options: projects.map((p) => [p.id, `${p.number} · ${p.data.name}`]) },
      { name: 'date', label: 'Date', type: 'date' }, { name: 'hours', label: 'Heures', type: 'number' },
      { name: 'task', label: 'Travail effectué', cls: 'full' },
    ],
    async onSave(v) {
      if (!v.project_id) throw new Error('Choisissez le chantier');
      const ids = t ? [+v.employeeId] : v.employees.map(Number);
      if (!ids.length) throw new Error('Choisissez au moins un ouvrier');
      for (const eid of ids) {
        const emp = byId(staff, eid);
        const it = t || { data: {} };
        it.project_id = +v.project_id;
        it.data = { ...it.data, employeeId: eid, date: v.date, hours: num(v.hours), task: v.task, rate: t && +d.employeeId === eid ? d.rate : num(emp.data.costRate) };
        await persist('timesheet', it, { silent: !t && ids.length > 1 });
      }
      render();
    },
    onDelete: t ? async () => { await db.del('timesheet', t.id); render(); } : null,
  });
}
function hoursTable(el, rows, staff, projects, showProject) {
  dataTable(el, {
    rows, state: { sort: -1 },
    search: (t) => [(byId(staff, t.data.employeeId) || { data: {} }).data.name, t.data.task].join(' '),
    columns: [
      { l: 'Date', v: (t) => fmtDate(t.data.date), sort: (t) => t.data.date }, { l: 'Ouvrier', v: (t) => esc((byId(staff, t.data.employeeId) || { data: { name: '—' } }).data.name) },
      ...(showProject ? [{ l: 'Chantier', v: (t) => esc((byId(projects, t.project_id) || { data: {} }).data.name || '') }] : []),
      { l: 'Travail', v: (t) => esc(t.data.task || '') }, { l: 'Heures', cls: 'r', v: (t) => fnum(num(t.data.hours), 2), sort: (t) => num(t.data.hours) },
      { l: 'Coût', cls: 'r', v: (t) => money(num(t.data.hours) * num(t.data.rate)), sort: (t) => num(t.data.hours) * num(t.data.rate) },
    ],
    onRow: (t) => editTimesheet(t), empty: 'Aucune heure encodée',
    footer: (l) => `<tr><td colspan="${showProject ? 4 : 3}">Total</td><td class="r"><b>${fnum(l.reduce((a, t) => a + num(t.data.hours), 0), 2)} h</b></td><td class="r"><b>${money(l.reduce((a, t) => a + num(t.data.hours) * num(t.data.rate), 0))}</b></td></tr>`,
  });
}
async function tabPHours(p, el) {
  const [rows, staff] = await Promise.all([db.list('timesheet', { project: p.id }), db.list('employee')]);
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="nh">${I.plus} Encoder des heures</button></div><div id="tbl"></div>`;
  hoursTable($('#tbl', el), rows, staff, [], false);
  $('[data-act=nh]', el).onclick = () => editTimesheet(null, { project_id: p.id });
}
