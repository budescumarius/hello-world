'use strict';
/* Chantiers : liste, fiche avec onglets (aperçu financier, devis, commandes, factures, achats, heures…). */

// Onglets d'un chantier, par famille : vue d'ensemble · l'argent du chantier · le terrain
const PTABS = [
  ['overview', 'Vue d\'ensemble', ''],
  ['quotes', 'Devis', 'Argent'], ['invoices', 'Factures', 'Argent'], ['progress', 'États d\'avancement', 'Argent'], ['expenses', 'Achats', 'Argent'], ['orders', 'Commandes', 'Argent'], ['hours', 'Heures', 'Argent'],
  ['planning', 'Planning', 'Terrain'], ['points', 'Points', 'Terrain'], ['plans', 'Plans', 'Terrain'], ['meetings', 'Réunions', 'Terrain'], ['forms', 'Formulaires', 'Terrain'], ['diary', 'Journal', 'Terrain'], ['reports', 'Rapports', 'Terrain'], ['contracts', 'Contrats', 'Terrain'], ['documents', 'Documents', 'Terrain'],
];

async function editProject(p, preset = {}) {
  const contacts = await db.list('contact');
  formModal({
    title: p ? `Chantier ${p.number}` : 'Nouveau chantier', wide: true,
    values: p ? { ...p.data, declNo: (p.data.decl30bis || {}).no || '', checkinNo: (p.data.checkin || {}).no || '' } : { status: 'preparation', managerId: S.me.id, start: today(), color: '#3b5bdb', ...preset },
    fields: [
      { name: 'name', label: 'Nom du chantier', required: true, cls: 'full' },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'prospect', 'architecte', 'autre'] },
      { name: 'status', label: 'Statut', type: 'select', options: optsOf(PST) },
      { name: 'address', label: 'Adresse', cls: 'full' }, { name: 'zip', label: 'Code postal' }, { name: 'city', label: 'Localité' },
      { name: 'start', label: 'Début', type: 'date' }, { name: 'end', label: 'Fin prévue', type: 'date' },
      { name: 'managerId', label: 'Conducteur de travaux', type: 'user' }, { name: 'team', label: 'Équipe', type: 'users', cls: 'full' },
      ...(isSimple() ? [] : [{ name: 'subs', label: 'Sous-traitants sur ce chantier (ils le verront dans leur espace)', type: 'multi', options: contacts.filter((c) => c.data.kind === 'soustraitant').map((c) => [c.id, contactName(c)]), cls: 'full' }]),
      { name: 'architectId', label: 'Architecte / BE', type: 'contact', contacts, kinds: ['architecte', 'autre'], allowNew: false },
      { name: 'color', label: 'Couleur (planning)', type: 'color' },
      { name: 'budget', label: 'Budget HT (si pas de devis)', type: 'money' }, { name: 'access', label: 'Accès / codes / clés' },
      // obligations sociales (aussi dans la carte « Obligations sociales » de la vue d'ensemble)
      { name: 'declNo', label: 'N° de déclaration de travaux (30bis)', placeholder: 'ex. 1234567890' }, { name: 'checkinNo', label: 'N° Checkin@Work (si chantier avec Checkin)', placeholder: 'ex. CHK-…' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) {
      await resolveContact(v, 'clientId', 'client');
      const it = p || { data: {} };
      const { declNo, checkinNo, ...rest } = v;
      it.data = { ...it.data, ...rest };
      for (const [k, no] of [['decl30bis', declNo], ['checkin', checkinNo]]) {
        const cur = it.data[k] || null; const n = String(no || '').trim();
        if (n) it.data[k] = { ...(cur || {}), no: n, date: (cur && cur.date) || today() };
        else if (cur && cur.no) it.data[k] = { ...cur, no: '' };
      }
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
  for (const e of all.expense.filter((x) => !x.data.refused)) for (const x of expenseFor(e, p.id)) realBy[x.category] = (realBy[x.category] || 0) + x.amount;
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
  const tabs = isSimple() ? PTABS.filter(([k]) => ['overview', 'quotes', 'invoices', 'expenses', 'contracts', 'documents'].includes(k)) : PTABS;
  if (!tabs.some(([k]) => k === tab)) tab = 'overview';
  const contacts = await db.list('contact');
  const c = byId(contacts, p.data.clientId);
  const page = layout({ active: 'projects', icon: 'crane', title: p.data.name, back: '#/projects',
    sub: `${esc(p.number)} · ${st(PST, p.data.status)}${c ? ` · <a href="#/contact/${c.id}">${esc(contactName(c))}</a>` : ''}${p.data.city ? ' · ' + esc(p.data.city) : ''}`,
    actions: `<button class="btn" data-act="sum">${I.print} Résumé</button><button class="btn" data-act="edit">${I.edit} Modifier</button><button class="btn primary" data-act="padd">${I.plus} Ajouter…</button>`,
    tabs: tabs.map(([k, l, g], i) => `${g && g !== (tabs[i - 1] || [])[2] ? `<span class="tab-g">${g}</span>` : ''}<a href="#/project/${p.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('') });
  $('[data-act=edit]').onclick = () => editProject(p);
  $('[data-act=sum]').onclick = () => menuSheet('Résumé du chantier (PDF)', [
    { label: 'Complet (avec finances, coûts et marge)', icon: 'coins', primary: true, run: () => go(`#/projectsummary/${p.id}`) },
    { label: 'Pour le client (sans coûts ni marge)', icon: 'people', run: () => go(`#/projectsummary/${p.id}/client`) },
  ]);
  if (isSimple()) $('[data-act=padd]').onclick = () => menuSheet('Ajouter au chantier', [
    { label: 'Achat : photo ou PDF de la facture', icon: 'camera', primary: true, run: () => importPurchase(p.id) },
    { label: 'Facture', icon: 'coins', run: () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name } }) },
    { label: 'Devis', icon: 'calc', run: () => newQuote({ projectId: p.id, clientId: p.data.clientId, title: p.data.name, siteAddress: [p.data.address, p.data.city].filter(Boolean).join(', ') }) },
  ]);
  else $('[data-act=padd]').onclick = () => menuSheet('Ajouter au chantier', [
    { label: 'Devis', icon: 'calc', run: () => newQuote({ projectId: p.id, clientId: p.data.clientId, title: p.data.name, siteAddress: [p.data.address, p.data.city].filter(Boolean).join(', ') }) },
    { label: 'Facture', icon: 'coins', run: () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name } }) },
    { label: 'Commande fournisseur', icon: 'truck', run: () => newOrder({ project_id: p.id, kind: 'fournisseur' }) },
    { label: 'Achat / dépense', icon: 'coins', run: () => editExpense(null, { project_id: p.id }) },
    { label: 'Heures prestées', icon: 'people', run: () => editTimesheet(null, { project_id: p.id }) },
    { label: 'Point (observation / réserve)', icon: 'pin', run: () => editPoint(p, null) },
    { label: 'PV de réunion', icon: 'fiche', run: () => editMeeting(p, null) },
    { label: 'Rapport au terrain (ouvriers, sous-traitants)', icon: 'send', run: () => sendReport(p.id) },
    { label: 'Tâche', icon: 'tasks', run: () => editTask(null, { project_id: p.id }) },
  ]);
  const T = {
    overview: tabOverview, quotes: tabPQuotes, orders: tabPOrders, invoices: tabPInvoices, expenses: tabPExpenses, hours: tabPHours,
    planning: tabPPlanning, plans: tabPlans, points: tabPoints, meetings: tabMeetings, forms: tabForms, diary: tabDiary, documents: tabDocuments, contracts: tabContracts, reports: (pp, el) => reportsPanel(el, pp.id), progress: (pp, el) => progressList(el, pp.id),
  };
  await T[tab](p, page, contacts);
});

// Résumé imprimable d'un chantier : infos, finances, facturation, avancement, heures, points ouverts, derniers rapports.
// Version « client » : sans coûts, déboursés ni marge.
route('projectsummary', async (pid, mode) => {
  const forClient = mode === 'client';
  const p = await db.get('project', +pid);
  const [contacts, all] = await Promise.all([db.list('contact'), db.many(['quote', 'invoice', 'order', 'timesheet', 'point', 'phase', 'report'], p.id)]);
  all.expense = await db.list('expense');
  const f = projectFinance(p, all); const d = p.data; const c = byId(contacts, d.clientId);
  const pc = (a, b) => (b ? `${fnum((a / b) * 100, 1)} %` : '—');
  // avancement facturé : dernier cumul des états d'avancement
  const sits = all.invoice.filter((i) => i.data.kind === 'situation' && i.data.status === 'emise').sort((a, b) => num(b.data.situationNo) - num(a.data.situationNo));
  const rows = sits.length ? (sits[0].data.progressRows || []).filter((r) => r.kind === 'item') : [];
  const market = rows.reduce((a, r) => a + num(r.qty) * num(r.price), 0); const done = rows.reduce((a, r) => a + num(r.qty) * num(r.price) * num(r.cum) / 100, 0);
  const phases = all.phase.sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const openPts = all.point.filter((x) => ['open', 'progress'].includes(x.data.status)); const late = openPts.filter((x) => x.data.due && x.data.due < today());
  const months = {}; const people = {};
  all.timesheet.forEach((t) => { const m = (t.data.date || '').slice(0, 7); months[m] = (months[m] || 0) + num(t.data.hours); const w = t.data.who || '—'; people[w] = (people[w] || 0) + num(t.data.hours); });
  const totH = Object.values(months).reduce((a, v) => a + v, 0);
  const invs = all.invoice.filter((i) => i.data.status === 'emise').sort((a, b) => (a.data.date || '').localeCompare(b.data.date || ''));
  const subs = (d.subs || []).map((id) => contactName(byId(contacts, id))).filter(Boolean);
  const reps = all.report.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '')).slice(0, 5);
  const kv = (l, v) => (v ? `<tr><td class="muted">${l}</td><td>${v}</td></tr>` : '');
  const html = `<div class="doc">${fieldHead(p, forClient ? 'Rapport de chantier' : 'Résumé du chantier')}
    <div class="d-sec"><h2>Informations</h2><table class="d-lines"><tbody>
      ${kv('N° chantier', esc(p.number || ''))}${kv('Client', esc(c ? contactName(c) : ''))}${kv('Adresse', esc([d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')))}
      ${kv('Statut', esc((PST[d.status] || [d.status])[0] || ''))}${kv('Période', [d.start && `du ${fmtDate(d.start)}`, d.end && `au ${fmtDate(d.end)}`].filter(Boolean).join(' '))}
      ${kv('Déclaration de travaux (30bis)', esc((d.decl30bis || {}).no || ''))}${kv('Checkin@Work', esc((d.checkin || {}).no || ''))}
      ${kv('Conducteur', esc(userName(+d.managerId)))}${kv('Équipe', esc((d.team || []).map((u) => userName(+u)).join(', ')))}${kv('Sous-traitants', esc(subs.join(', ')))}</tbody></table></div>
    <div class="d-sec"><h2>${forClient ? 'Montants' : 'Finances'}</h2><table class="d-lines"><tbody>
      ${kv('Montant des travaux HT (devis acceptés)', money(f.budget))}
      ${forClient ? '' : `${kv('Déboursé prévu', `${money(f.est)}${f.budget ? ` · marge prévue ${pc(f.budget - f.est, f.budget)}` : ''}`)}${kv('Coût réel à ce jour', `${money(f.real)}${f.est ? ` · ${pc(f.real, f.est)} du prévu` : ''}`)}${kv('Engagé (commandes ouvertes)', money(f.engaged))}`}
      ${kv('Facturé HT', `${money(f.invoiced)}${f.budget ? ` · ${pc(f.invoiced, f.budget)} du montant` : ''}`)}${kv('Encaissé TVAC', money(f.cashed))}${kv('Reste à encaisser TVAC', money(f.due))}
      ${forClient ? '' : kv('<b>Marge estimée</b>', `<b>${money(f.margin)}</b>${f.budget ? ` (${pc(f.margin, f.budget)})` : ''}`)}</tbody></table>
      ${forClient ? '' : `<table class="d-lines"><thead><tr><th>Type de coût</th><th class="r">Prévu</th><th class="r">Réel</th><th class="r">Écart</th></tr></thead><tbody>${Object.entries(TYPES).filter(([k]) => f.estBy[k] || f.realBy[k]).map(([k, l]) => `<tr><td>${l}</td><td class="r">${money(f.estBy[k] || 0)}</td><td class="r">${money(f.realBy[k] || 0)}</td><td class="r">${money((f.estBy[k] || 0) - (f.realBy[k] || 0))}</td></tr>`).join('')}</tbody></table>`}</div>
    ${invs.length ? `<div class="d-sec"><h2>Facturation</h2><table class="d-lines"><thead><tr><th>N°</th><th>Date</th><th>Type</th><th class="r">HT</th><th class="r">TVAC</th><th class="r">Payé</th></tr></thead><tbody>
      ${invs.map((i) => { const t = totals(i.data); return `<tr><td>${esc(i.number || '')}</td><td>${fmtDate(i.data.date)}</td><td>${esc(IKIND[i.data.kind] || 'Facture')}${i.data.ref ? ` ${esc(i.data.ref)}` : ''}</td><td class="r">${money(t.base)}</td><td class="r">${money(t.total)}</td><td class="r">${money(invState(i).paid)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
    <div class="d-sec"><h2>Avancement</h2><table class="d-lines"><tbody>
      ${market ? kv(`Travaux réalisés (dernier état ${esc(sits[0].data.ref || '')})`, `<b>${pc(done, market)}</b> · ${money(done)} sur ${money(market)}`) : kv('États d\'avancement', 'aucun pour l\'instant')}
      ${phases.map((x) => kv(esc(x.data.name), `${fnum(num(x.data.progress), 0)} % · ${fmtDate(x.data.start)} → ${fmtDate(x.data.end)}`)).join('')}</tbody></table></div>
    ${!forClient && totH ? `<div class="d-sec"><h2>Heures prestées : ${fnum(totH, 1)} h</h2><table class="d-lines"><thead><tr><th>Mois</th><th class="r">Heures</th></tr></thead><tbody>${Object.keys(months).sort().map((m) => `<tr><td>${esc(monthLabel(m))}</td><td class="r">${fnum(months[m], 1)} h</td></tr>`).join('')}</tbody></table>
      <p class="muted sm">${Object.entries(people).sort((a, b) => b[1] - a[1]).map(([w, h]) => `${esc(w)} ${fnum(h, 1)} h`).join(' · ')}</p></div>` : ''}
    <div class="d-sec"><h2>Points ouverts : ${openPts.length}${late.length ? ` (dont ${late.length} en retard)` : ''}</h2>${openPts.length ? `<table class="d-lines"><thead><tr><th>N°</th><th>Point</th><th>Échéance</th></tr></thead><tbody>${openPts.slice(0, 15).map((x) => `<tr><td>${esc(x.number || '')}</td><td>${esc(x.data.title || '')}</td><td>${x.data.due ? fmtDate(x.data.due) : ''}</td></tr>`).join('')}</tbody></table>${openPts.length > 15 ? `<p class="muted sm">… et ${openPts.length - 15} autre(s)</p>` : ''}` : '<p class="muted">Aucun point ouvert.</p>'}</div>
    ${reps.length ? `<div class="d-sec"><h2>Derniers rapports</h2><table class="d-lines"><tbody>${reps.map((r) => `<tr><td>${fmtDate(r.data.date)}</td><td><b>${esc(r.data.title || 'Rapport')}</b>${r.data.text ? `<br><span class="muted">${esc(String(r.data.text).slice(0, 160))}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
  printPage(forClient ? `Rapport de chantier – ${d.name}` : `Résumé – ${d.name}`, html, `#/project/${p.id}/overview`);
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
  if (isSimple()) return overviewSimple(p, el, contacts, f, d);
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
        ${socialProjectCard(p, f.budget, all.quote)}
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
  bindSocialProject(el, p, byId(contacts, d.clientId), f.budget, all.quote, () => render());
}
// Chantier (édition simplifiée) : ce qui est facturé, encaissé et dépensé (achats) sur ce chantier
async function overviewSimple(p, el, contacts, f, d) {
  const exp = (await db.list('expense')).filter((e) => !e.data.refused && expenseFor(e, p.id).length);
  const byType = {}; exp.forEach((e) => expenseFor(e, p.id).forEach((x) => { byType[x.category] = (byType[x.category] || 0) + x.amount; }));
  const recent = exp.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '')).slice(0, 6);
  el.innerHTML = `<div class="kpis">
      ${kpi('Devis acceptés HT', money(f.budget))}
      ${kpi('Facturé HT', money(f.invoiced), { meter: f.budget ? (f.invoiced / f.budget) * 100 : null, sub: f.budget ? `${Math.round((f.invoiced / f.budget) * 100)} % des devis` : '' })}
      ${kpi('Encaissé TVAC', money(f.cashed), { cls: 'good' })}
      ${kpi('Reste à encaisser', money(f.due), { cls: f.due > 0 ? 'warn' : '' })}
      ${kpi('Achats (consommé) HT', money(f.real), { cls: 'bad' })}
      ${kpi('Résultat HT', money((f.invoiced || f.budget) - f.real), { cls: (f.invoiced || f.budget) - f.real < 0 ? 'bad' : 'good', sub: f.invoiced ? 'facturé − achats' : 'devis − achats' })}
    </div>
    <div class="cols"><div class="col-main">
      <div class="card"><div class="card-h"><h3>Achats du chantier</h3><button class="btn sm primary" data-act="buy">${I.camera} Ajouter un achat</button></div>
        <div class="rows">${Object.entries(byType).map(([k, v]) => `<div class="row static"><i class="tdot" style="--c:${TYPE_COLORS[k] || '#999'}"></i><span class="grow"><b>${esc(TYPES[k] || k)}</b></span><b>${money(v)}</b></div>`).join('') || '<div class="empty sm">Aucun achat encodé pour ce chantier</div>'}</div>
        ${recent.length ? `<div class="rows">${recent.map((e) => `<a class="row" href="#/purchase/${e.id}"><span class="grow"><b>${esc(contactName(byId(contacts, e.data.supplierId)))}</b><small class="muted">${fmtDate(e.data.date)} · ${esc(e.data.ref || e.data.desc || '')}</small></span><b>${money(expenseAmountFor(e, p.id))}</b></a>`).join('')}</div><a class="btn sm" href="#/project/${p.id}/expenses">Voir tous les achats</a>` : ''}
      </div></div>
      <div class="col-side"><div class="card info">
        ${[['Client', contactName(byId(contacts, d.clientId))], ['Adresse', [d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Début', fmtDate(d.start)], ['Fin prévue', fmtDate(d.end)]].filter(([, v]) => v && v !== '—').map(([k, v]) => `<div class="kv"><span>${k}</span><div>${esc(v)}</div></div>`).join('')}
        ${d.address ? `<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address, d.zip, d.city].filter(Boolean).join(' '))}">Itinéraire</a>` : ''}
        ${d.notes ? `<div class="kv"><span>Notes</span><div class="pre">${esc(d.notes)}</div></div>` : ''}
      </div></div></div>`;
  $('[data-act=buy]', el).onclick = () => importPurchase(p.id);
  bindKpis(el);
}
const TYPE_LABELS = { project: 'chantier', quote: 'devis', invoice: 'facture', order: 'commande', expense: 'achat', timesheet: 'heures', point: 'point', meeting: 'PV', form: 'formulaire', diary: 'journal', plan: 'plan', phase: 'phase', task: 'tâche', document: 'document', contact: 'contact', opportunity: 'opportunité', intervention: 'intervention' };

async function tabPQuotes(p, el, contacts) {
  const quotes = await db.list('quote', { project: p.id });
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="nq">${I.plus} Nouveau devis</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: quotes, select: { actions: (x) => multiActions('quote', x) }, columns: [{ l: 'N°', v: (q) => `<b>${esc(q.number)}</b>` }, { l: 'Objet', v: (q) => `${q.data.avenantOf ? `<small class="badge-av">Avenant ${esc(q.data.avenantNo)} · ${esc(q.data.parentNumber || '')}</small> ` : ''}${esc(q.data.title || '')}` }, { l: 'Date', v: (q) => fmtDate(q.data.date) }, { l: 'Statut', v: (q) => st(QST, q.data.status) },
      { l: 'Déboursé', cls: 'r', v: (q) => money(totals(q.data).cost) }, { l: 'Total HT', cls: 'r', v: (q) => `<b>${money(totals(q.data).base)}</b>` }],
    onRow: (q) => go(`#/quote/${q.id}`), empty: 'Aucun devis pour ce chantier',
  });
  $('[data-act=nq]', el).onclick = () => newQuote({ projectId: p.id, clientId: p.data.clientId, title: p.data.name, siteAddress: [p.data.address, p.data.city].filter(Boolean).join(', ') });
}
async function tabPOrders(p, el, contacts) {
  const [orders, quotes] = await Promise.all([db.list('order', { project: p.id }), db.list('quote', { project: p.id })]);
  el.innerHTML = `<div class="toolbar"><span class="grow"></span>${quotes.length ? '<button class="btn" data-act="fq">Depuis un devis…</button>' : ''}<button class="btn primary" data-act="no">${I.plus} Nouvelle commande</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: orders, select: { actions: (x) => multiActions('order', x) }, columns: [{ l: 'N°', v: (o) => `<b>${esc(o.number)}</b>` }, { l: 'Type', v: (o) => (o.data.kind === 'soustraitant' ? 'Sous-traitant' : 'Fournisseur') }, { l: 'Fournisseur', v: (o) => esc(contactName(byId(contacts, o.data.supplierId))) },
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
    rows: invoices.map((i) => ({ ...i, st: invState(i) })), select: { actions: (x) => multiActions('invoice', x) },
    columns: [{ l: 'N°', v: (i) => `<b>${esc(i.number || 'Brouillon')}</b>` }, { l: 'Type', v: (i) => esc(IKIND[i.data.kind]) }, { l: 'Date', v: (i) => fmtDate(i.data.date) }, { l: 'Échéance', v: (i) => fmtDate(i.data.due) },
      { l: 'Statut', v: (i) => st(IST, i.st.s) }, { l: 'Total HT', cls: 'r', v: (i) => money(i.st.t.base) }, { l: 'Total TVAC', cls: 'r', v: (i) => `<b>${money(i.st.t.total)}</b>` }, { l: 'Reste', cls: 'r', v: (i) => (['brouillon', 'avoir'].includes(i.st.s) ? '' : money(i.st.rest)) }],
    onRow: (i) => go(`#/invoice/${i.id}`), empty: 'Aucune facture',
  });
  $('[data-act=ni]', el).onclick = () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name } });
  const fq = $('[data-act=fq]', el); if (fq) fq.onclick = () => (acc.length === 1 ? invoiceFromQuote(acc[0]) : menuSheet('Quel devis ?', acc.map((q) => ({ label: `${q.number} · ${q.data.title || ''}`, run: () => invoiceFromQuote(q) }))));
}

// ---------------------------------------------------------------- Achats & dépenses
// Chantier commencé avec un autre logiciel : dépenses déjà payées encodées en totaux par type (sans recharger chaque facture).
// Comptées dans le suivi du chantier, payées, exclues de l'envoi au comptable.
async function oldExpenses(p) {
  const v = await ask('Dépenses déjà faites (ancien logiciel)', [
    { name: 'info', type: 'html', cls: 'full', html: '<p class="muted">Totaux <b>HT</b> déjà dépensés sur ce chantier, par type de coût. Ils comptent dans le budget et la marge du chantier, sont marqués payés et ne partent pas chez le comptable (il a déjà ces factures).</p>' },
    { name: 'date', label: 'Jusqu\'au (date)', type: 'date', required: true },
    ...Object.entries(TYPES).filter(([k]) => k !== 'ouvrage').map(([k, l]) => ({ name: 't_' + k, label: `${l} (HT)`, type: 'money' })),
  ], { date: today() });
  if (!v) return;
  let n = 0;
  for (const [k, l] of Object.entries(TYPES)) {
    const ht = r2(num(v['t_' + k])); if (!ht) continue;
    await persist('expense', { project_id: p.id, data: { date: v.date, category: k, source: 'reprise', status: 'validee', external: true, desc: `Reprise ancien logiciel – ${l}`, ref: `Reprise ${fmtDate(v.date)}`,
      amount: ht, vat: 0, vatAmount: 0, ttc: ht, vatLines: [{ rate: 0, amount: 0 }], paid: true, paidDate: v.date, payments: [{ date: v.date, amount: ht, method: 'Reprise' }], toCheck: false } }, { silent: true });
    n++;
  }
  toast(n ? `${n} total(s) repris dans le suivi du chantier` : 'Aucun montant', 3500); if (n) render();
}
async function tabPExpenses(p, el, contacts) {
  const [all, projects] = await Promise.all([db.list('expense'), db.list('project')]);
  const rows = all.filter((e) => expenseFor(e, p.id).length);
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn" data-act="old">Reprendre les dépenses déjà faites…</button><button class="btn" data-act="imp">${I.upload} Importer une facture</button><button class="btn primary" data-act="ne">${I.plus} Saisie manuelle</button></div><div id="tbl"></div>`;
  $('[data-act=imp]', el).onclick = () => importPurchase(p.id);
  $('[data-act=old]', el).onclick = () => oldExpenses(p);
  expensesTable($('#tbl', el), rows, contacts, projects, false, p.id);
  $('[data-act=ne]', el).onclick = () => editExpense(null, { project_id: p.id });
}
route('expenses', async () => {
  const [rows, contacts, projects] = await Promise.all([db.list('expense'), db.list('contact'), db.list('project')]);
  const page = layout({ active: 'finances', icon: 'coins', title: 'Factures fournisseurs', actions: `<button class="btn" data-act="csv">Export CSV</button>${peppolApOn() ? `<button class="btn" data-act="sync">Recevoir (Peppol)</button>` : ''}<button class="btn primary" data-act="new">${I.plus} Nouveau</button>` });
  const sy = $('[data-act=sync]'); if (sy) sy.onclick = async () => { sy.disabled = true; const r = await peppolSync({ force: true, quiet: false }); sy.disabled = false; if (r && r.created.length) render(); };
  $('[data-act=new]').onclick = () => menuSheet('Nouvelle facture fournisseur', [
    { label: 'Importer la facture (PDF, XML, photo)', icon: 'upload', primary: true, run: () => importPurchase() },
    { label: 'Saisie manuelle', icon: 'edit', run: () => editExpense() },
  ]);
  const by = (s) => rows.filter((e) => purchState(e) === s);
  const restSum = (l) => l.reduce((a, e) => a + purchRest(e.data), 0);
  const unpaid = rows.filter((e) => ['apayer', 'partiel', 'retard'].includes(purchState(e)));
  page.innerHTML = `${by('avalider').length ? `<div class="hint-box warn">${by('avalider').length} facture(s) à valider : vérifiez les montants, liez-les aux chantiers puis « Soumettre ». <a href="#" data-chk>Afficher</a></div>` : ''}
    <div class="kpis">${kpi('À valider', by('avalider').length, { cls: by('avalider').length ? 'warn' : '' })}${kpi('Reste à payer TVAC', money(restSum(unpaid)), { sub: `${unpaid.length} facture(s)${by('partiel').length ? ` dont ${by('partiel').length} part. payée(s)` : ''}` })}
      ${kpi('En retard', money(restSum(by('retard'))), { cls: by('retard').length ? 'bad' : '', sub: `${by('retard').length} facture(s)` })}${kpi('Achats ce mois-ci HT', money(rows.filter((e) => (e.data.date || '').startsWith(today().slice(0, 7))).reduce((a, e) => a + num(e.data.amount), 0)))}</div><div id="tbl"></div>`;
  expensesTable($('#tbl'), rows, contacts, projects, true);
  const ck = $('[data-chk]'); if (ck) ck.onclick = (ev) => { ev.preventDefault(); const chip = $('#tbl [data-f="avalider"]'); if (chip) chip.click(); };
  $('[data-act=csv]').onclick = () => downloadCSV('factures-fournisseurs.csv', [['Date', 'Reference', 'Fournisseur', 'Chantier', 'Type', 'HT', 'TVA', 'TTC', 'Paye', 'Echeance', 'Statut', 'IBAN', 'Communication'],
    ...rows.flatMap((e) => expenseParts(e).map((x) => [fmtDate(e.data.date), e.data.ref, contactName(byId(contacts, e.data.supplierId)), x.pid ? (byId(projects, x.pid) || { data: {} }).data.name : 'Frais généraux', TYPES[x.category], fnum(x.amount), fnum(num(e.data.vatAmount)), fnum(purchTtc(e.data)), fnum(purchPaid(e.data)), fmtDate(e.data.due), PURCH_ST[purchState(e)][0], e.data.iban || '', e.data.structured ? commFmt(e.data.communication || '') : (e.data.communication || '')]))]);
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
// ---------------------------------------------------------------- Heures par mois
// Chaque mois repart de zéro ; les mois passés restent consultables (archives) avec leur total, et le total général en bas.
const monthLabel = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
const sumHours = (l) => l.reduce((a, t) => a + num(t.data.hours), 0);
const sumCost = (l) => l.reduce((a, t) => a + num(t.data.hours) * num(t.data.rate), 0);
function monthRows(rows, sel, cost = true) {
  const cur = today().slice(0, 7);
  const g = { [cur]: [] }; rows.forEach((t) => { const k = (t.data.date || '').slice(0, 7); if (k) (g[k] = g[k] || []).push(t); });
  return `<div class="rows mo-list">${Object.keys(g).sort().reverse().map((k) => `<button type="button" class="row mo ${k === sel ? 'on' : ''}" data-mo="${k}">
      <span class="grow"><b>${esc(monthLabel(k))}</b><small class="muted">${k === cur ? 'mois en cours' : k > cur ? 'à venir' : 'archivé'}</small></span>
      <b>${fnum(sumHours(g[k]), 1)} h</b>${cost ? `<span class="mo-c muted">${money(sumCost(g[k]))}</span>` : ''}</button>`).join('')}
    <div class="row static mo-tot"><span class="grow"><b>Total</b></span><b>${fnum(sumHours(rows), 1)} h</b>${cost ? `<span class="mo-c"><b>${money(sumCost(rows))}</b></span>` : ''}</div></div>`;
}
function hoursTable(el, rows, staff, projects, showProject) {
  dataTable(el, {
    rows, state: { sort: -1 },
    search: (t) => [(byId(staff, t.data.employeeId) || { data: {} }).data.name || t.data.who, t.data.task].join(' '),
    columns: [
      { l: 'Date', v: (t) => fmtDate(t.data.date), sort: (t) => t.data.date }, { l: 'Ouvrier', v: (t) => `${esc((byId(staff, t.data.employeeId) || { data: { name: t.data.who || '—' } }).data.name)}${t.data.contactId ? ' <small class="muted">(sous-traitant)</small>' : ''}` },
      ...(showProject ? [{ l: 'Chantier', v: (t) => (t.project_id ? esc((byId(projects, t.project_id) || { data: {} }).data.name || '') : t.data.site ? `${badge('à créer', '#e8590c')} ${esc(t.data.site)}` : '') }] : []),
      { l: 'Travail', v: (t) => esc(t.data.task || '') }, { l: 'Heures', cls: 'r', v: (t) => fnum(num(t.data.hours), 2), sort: (t) => num(t.data.hours) },
      { l: 'Coût', cls: 'r', v: (t) => money(num(t.data.hours) * num(t.data.rate)), sort: (t) => num(t.data.hours) * num(t.data.rate) },
    ],
    onRow: (t) => (!t.project_id && t.data.site ? attachSite(t) : t.data.employeeId ? editTimesheet(t) : menuSheet(`${t.data.who || 'Sous-traitant'} – ${fnum(num(t.data.hours), 2)} h`, [{ label: 'Supprimer ces heures', icon: 'trash', danger: true, run: async () => { await db.del('timesheet', t.id); render(); } }])), empty: 'Aucune heure encodée',
    footer: (l) => `<tr><td colspan="${showProject ? 4 : 3}">Total</td><td class="r"><b>${fnum(l.reduce((a, t) => a + num(t.data.hours), 0), 2)} h</b></td><td class="r"><b>${money(l.reduce((a, t) => a + num(t.data.hours) * num(t.data.rate), 0))}</b></td></tr>`,
  });
}
// Heures encodées par le terrain sur un chantier pas encore créé (nom écrit par l'ouvrier ou le sous-traitant) :
// créer ce chantier ou rattacher les heures à un chantier existant ; il rejoint alors l'équipe du chantier.
async function attachSite(t) {
  const [rows, projects] = await Promise.all([db.list('timesheet'), db.list('project')]);
  const key = (x) => String(x || '').trim().toLowerCase();
  const same = rows.filter((x) => !x.project_id && key(x.data.site) === key(t.data.site));
  const who = [...new Set(same.map((x) => x.data.who).filter(Boolean))].join(', ') || 'le terrain';
  const days = [...new Set(same.map((x) => x.data.date))].sort();
  formModal({
    title: `Chantier « ${t.data.site} »`, saveLabel: 'Valider',
    extra: `<p class="muted">${same.length} ligne(s) · <b>${fnum(same.reduce((a, x) => a + num(x.data.hours), 0), 2)} h</b> encodées par ${esc(who)} (${days.map(fmtDate).join(', ')}) sur un chantier qui n'existe pas encore dans l'application.</p>`,
    values: { mode: 'new', name: t.data.site, project_id: '' },
    fields: [
      { name: 'mode', label: 'Que faire ?', type: 'select', options: [['new', 'Créer ce chantier'], ['link', 'Rattacher à un chantier existant']], cls: 'full' },
      { name: 'name', label: 'Nom du nouveau chantier', cls: 'full', hint: 'Vous compléterez ensuite le client, l\'adresse et les dates.' },
      { name: 'project_id', label: 'Chantier existant', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, `${p.number || ''} · ${p.data.name}`])], cls: 'full' },
    ],
    after(form) { const sync = () => { const n = form.elements.mode.value === 'new'; form.elements.name.closest('.field').style.display = n ? '' : 'none'; form.elements.project_id.closest('.field').style.display = n ? 'none' : ''; }; form.elements.mode.onchange = sync; sync(); },
    async onSave(v) {
      // ceux qui ont encodé ces heures voient ensuite le chantier dans leur espace
      const users = [...new Set(same.map((x) => +x.created_by).filter((id) => S.users.some((u) => u.id === id && ['ouvrier', 'soustraitant'].includes(u.role))))];
      const subs = [...new Set(same.map((x) => +x.data.contactId).filter(Boolean))];
      let p;
      if (v.mode === 'new') {
        if (!v.name.trim()) throw new Error('Indiquez le nom du chantier');
        p = await persist('project', { data: { name: v.name.trim(), status: 'encours', start: days[0] || today(), managerId: S.me.id, team: users, subs, color: '#3b5bdb' } });
      } else {
        p = byId(projects, v.project_id); if (!p) throw new Error('Choisissez le chantier');
        p.data.team = [...new Set([...(p.data.team || []).map(Number), ...users])]; p.data.subs = [...new Set([...(p.data.subs || []).map(Number), ...subs])];
        await persist('project', p, { silent: true });
      }
      for (const x of same) { x.project_id = p.id; delete x.data.site; await persist('timesheet', x, { silent: true }); }
      toast(v.mode === 'new' ? 'Chantier créé, heures rattachées ✓' : 'Heures rattachées au chantier ✓', 3000);
      go(`#/project/${p.id}/hours`);
    },
  });
}
async function tabPHours(p, el) {
  const [rows, staff] = await Promise.all([db.list('timesheet', { project: p.id }), db.list('employee')]);
  const cur = today().slice(0, 7); const key = `phm_${p.id}`; const sel = ui[key] || cur;
  const now = rows.filter((t) => (t.data.date || '').startsWith(cur));
  const list = sel === 'all' ? rows : rows.filter((t) => (t.data.date || '').startsWith(sel));
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="nh">${I.plus} Encoder des heures</button></div>
    <div class="kpis">${kpi(`Ce mois-ci (${monthLabel(cur)})`, `${fnum(sumHours(now), 1)} h`, { sub: money(sumCost(now)) })}${kpi('Total du chantier', `${fnum(sumHours(rows), 1)} h`, { sub: `${money(sumCost(rows))} · depuis le début` })}</div>
    <div class="mo-split"><div class="card"><div class="card-h"><h3>Par mois</h3><button class="btn sm ${sel === 'all' ? 'primary' : ''}" data-mo="all">Tout voir</button></div>${monthRows(rows, sel)}</div>
      <div><h3 class="mo-h">${sel === 'all' ? 'Toutes les heures du chantier' : `${esc(monthLabel(sel))}${sel < cur ? ' <small class="muted">archivé</small>' : ''}`}</h3><div id="tbl"></div></div></div>`;
  hoursTable($('#tbl', el), list, staff, [], false);
  $$('[data-mo]', el).forEach((b) => { b.onclick = () => { ui[key] = b.dataset.mo; saveUi(); render(); }; });
  $('[data-act=nh]', el).onclick = () => editTimesheet(null, { project_id: p.id });
}
