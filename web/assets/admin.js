'use strict';
/* RH, tableau de bord, statistiques, paramètres, utilisateurs, profil et recherche rapide. */

// ---------------------------------------------------------------- RH
route('hr', async (sub = 'staff') => {
  if (sub === 'timesheets') return hrTimesheets();
  if (sub === 'absences') return hrAbsences();
  const staff = await db.list('employee');
  const page = layout({ active: 'hr', icon: 'people', title: 'Personnel', actions: `<button class="btn primary" data-act="new">${I.plus} Nouveau membre</button>` });
  const edit = (s) => formModal({
    title: s ? s.data.name : 'Nouveau membre du personnel', wide: true, values: s ? s.data : { active: true, contract: 'ouvrier', costRate: 35 },
    fields: [
      { name: 'name', label: 'Nom et prénom', required: true }, { name: 'role', label: 'Fonction', placeholder: 'ex. Maçon, chef d\'équipe' },
      { name: 'contract', label: 'Statut', type: 'select', options: [['ouvrier', 'Ouvrier'], ['employe', 'Employé'], ['interim', 'Intérimaire'], ['independant', 'Indépendant']] },
      { name: 'costRate', label: 'Coût horaire chargé', type: 'money', hint: 'Utilisé pour calculer le coût réel des chantiers' },
      { name: 'phone', label: 'Téléphone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'start', label: 'Date d\'entrée', type: 'date' }, { name: 'userId', label: 'Compte utilisateur lié', type: 'user' },
      { name: 'skills', label: 'Compétences / certificats (VCA, permis…)', cls: 'full' },
      { name: 'active', label: 'Actif', type: 'check' }, { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { const it = s || { data: {} }; it.data = { ...it.data, ...v }; await persist('employee', it); render(); },
    onDelete: s ? async () => { await db.del('employee', s.id); render(); } : null,
  });
  dataTable(page, {
    rows: staff, state: ui.tbl_staff || (ui.tbl_staff = { f: 'active' }),
    search: (s) => [s.data.name, s.data.role, s.data.skills].join(' '),
    filters: { def: 'active', options: [['active', 'Actifs'], ['inactive', 'Inactifs'], ['', 'Tous']], match: (s, f) => (f === 'active' ? s.data.active !== false : s.data.active === false) },
    columns: [{ l: 'Nom', v: (s) => `<b>${esc(s.data.name)}</b>` }, { l: 'Fonction', v: (s) => esc(s.data.role || '') }, { l: 'Téléphone', v: (s) => esc(s.data.phone || '') },
      { l: 'Compétences', v: (s) => esc(s.data.skills || '') }, { l: 'Coût horaire', cls: 'r', v: (s) => money(s.data.costRate) }],
    onRow: edit, empty: 'Aucun membre du personnel',
  });
  $('[data-act=new]').onclick = () => edit();
});
async function hrTimesheets() {
  const [rows, staff, projects] = await Promise.all([db.list('timesheet'), db.list('employee'), db.list('project')]);
  const month = ui.tsMonth || today().slice(0, 7);
  const list = rows.filter((t) => (t.data.date || '').startsWith(month));
  const page = layout({ active: 'hr', icon: 'people', title: 'Pointage', actions: `<input type="month" class="in-month" value="${month}"><button class="btn" data-act="csv">Export (secrétariat social)</button><button class="btn primary" data-act="new">${I.plus} Encoder des heures</button>` });
  const per = new Map(); list.forEach((t) => per.set(+t.data.employeeId, (per.get(+t.data.employeeId) || 0) + num(t.data.hours)));
  page.innerHTML = `<div class="kpis">${kpi('Heures du mois', fnum(list.reduce((a, t) => a + num(t.data.hours), 0), 1) + ' h')}${kpi('Coût main d\'œuvre', money(list.reduce((a, t) => a + num(t.data.hours) * num(t.data.rate), 0)))}
    ${[...per].slice(0, 6).map(([id, h]) => kpi((byId(staff, id) || { data: { name: '—' } }).data.name, fnum(h, 1) + ' h')).join('')}</div><div id="tbl"></div>`;
  hoursTable($('#tbl'), list, staff, projects, true);
  $('.in-month').onchange = (e) => { ui.tsMonth = e.target.value; saveUi(); render(); };
  $('[data-act=new]').onclick = () => editTimesheet();
  $('[data-act=csv]').onclick = () => downloadCSV(`pointage-${month}.csv`, [['Date', 'Ouvrier', 'Chantier', 'Heures', 'Travail'], ...list.sort((a, b) => a.data.date.localeCompare(b.data.date)).map((t) => [fmtDate(t.data.date), (byId(staff, t.data.employeeId) || { data: {} }).data.name, (byId(projects, t.project_id) || { data: {} }).data.name, fnum(num(t.data.hours), 2), t.data.task])]);
}
async function hrAbsences() {
  const [rows, staff] = await Promise.all([db.list('absence'), db.list('employee')]);
  const page = layout({ active: 'hr', icon: 'people', title: 'Absences', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle absence</button>` });
  const edit = (a) => formModal({
    title: a ? 'Absence' : 'Nouvelle absence', values: a ? a.data : { kind: 'conge', from: today(), to: today() },
    fields: [{ name: 'employeeId', label: 'Membre du personnel', type: 'select', options: staff.map((s) => [s.id, s.data.name]), required: true }, { name: 'kind', label: 'Type', type: 'select', options: optsOf(ABS_KINDS) },
      { name: 'from', label: 'Du', type: 'date' }, { name: 'to', label: 'Au', type: 'date' }, { name: 'note', label: 'Remarque', cls: 'full' }],
    async onSave(v) { if (v.to < v.from) [v.from, v.to] = [v.to, v.from]; const it = a || { data: {} }; it.data = { ...it.data, ...v, employeeId: +v.employeeId }; await persist('absence', it); render(); },
    onDelete: a ? async () => { await db.del('absence', a.id); render(); } : null,
  });
  const days = (a) => { let n = 0; for (let d = dnum(a.data.from); d <= dnum(a.data.to); d++) { const w = new Date(d * DAY).getUTCDay(); if (w && w !== 6) n++; } return n; };
  dataTable(page, {
    rows, state: { sort: -3 }, search: (a) => (byId(staff, a.data.employeeId) || { data: {} }).data.name || '',
    filters: { def: 'cur', options: [['cur', 'En cours et à venir'], ['', 'Toutes']], match: (a) => a.data.to >= today() },
    columns: [{ l: 'Membre', v: (a) => `<b>${esc((byId(staff, a.data.employeeId) || { data: { name: '—' } }).data.name)}</b>` }, { l: 'Type', v: (a) => esc(ABS_KINDS[a.data.kind] || '') },
      { l: 'Du', v: (a) => fmtDate(a.data.from), sort: (a) => a.data.from }, { l: 'Au', v: (a) => fmtDate(a.data.to) }, { l: 'Jours ouvrables', cls: 'r', v: (a) => days(a) }, { l: 'Remarque', v: (a) => esc(a.data.note || '') }],
    onRow: edit, empty: 'Aucune absence',
  });
  $('[data-act=new]').onclick = () => edit();
}

// ---------------------------------------------------------------- Tableau de bord
// « Aujourd'hui » : une seule liste de ce qu'il faut faire maintenant, du plus urgent au moins urgent,
// chaque ligne avec son action (relancer, payer, facturer, c'est fait) ; à côté, l'argent et les chantiers en cours.
route('dashboard', async () => {
  if (isSimple()) return homeSimple();
  const all = await db.many(['opportunity', 'quote', 'invoice', 'project', 'task', 'point', 'intervention', 'expense', 'contact', 'report']);
  const team = !!ui.dashAll;
  const page = layout({ active: 'dashboard', icon: 'sun', title: 'Aujourd\'hui', sub: esc(longDate(today())),
    actions: `<div class="tseg" role="group" aria-label="Afficher"><button type="button" data-team="0" class="${team ? '' : 'on'}">Moi</button><button type="button" data-team="1" class="${team ? 'on' : ''}">Toute l'équipe</button></div>` });
  $$('[data-team]').forEach((b) => { b.onclick = () => { ui.dashAll = b.dataset.team === '1'; saveUi(); render(); }; });
  const mine = (x, key = 'ownerId') => team || +x.data[key] === S.me.id || (!x.data[key] && x.created_by === S.me.id);
  const cname = (id) => { const c = byId(all.contact, id); return c ? contactName(c) : ''; };
  const days = (d) => (d ? dnum(today()) - dnum(d) : 0);
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const inv = all.invoice.filter((i) => team || i.created_by === S.me.id).map((i) => ({ i, s: invState(i) }));
  const items = [];
  const add = (rank, o) => items.push({ rank, ...o });
  // trop d'éléments du même genre : une seule ligne qui renvoie à la liste
  const many = (list, n, rank, one, group) => { if (list.length > n) add(rank, group(list)); else list.forEach((x) => add(rank, one(x))); };
  many(inv.filter((x) => x.s.s === 'retard').sort((a, b) => (a.i.data.due || '').localeCompare(b.i.data.due || '')), 5, 0,
    (x) => ({ tone: 'late', icon: 'coins', title: `${cname(x.i.data.clientId) || 'Client'} ne vous a pas payé`, sub: `Facture ${x.i.number || ''} · en retard de ${days(x.i.data.due)} jour(s)`, amount: x.s.rest, href: `#/invoice/${x.i.id}`, act: ['Relancer', `#/print/invoice/${x.i.id}?mail=1`] }),
    (l) => ({ tone: 'late', icon: 'coins', title: `${l.length} factures en retard de paiement`, sub: 'Vos clients vous doivent de l\'argent', amount: sum(l, (x) => x.s.rest), href: '#/invoices', act: ['Voir', '#/invoices'] }));
  const tasks = all.task.filter((t) => t.data.status !== 'done' && (team || (t.data.assignees || []).includes(S.me.id)) && t.data.due && t.data.due <= today());
  many(tasks, 6, 1, (t) => ({ tone: t.data.due < today() ? 'late' : 'todo', icon: 'tasks', title: t.data.title, sub: t.data.due < today() ? `Tâche en retard de ${days(t.data.due)} jour(s)` : 'Tâche à faire aujourd\'hui', done: t.id, href: '#/tasks' }),
    (l) => ({ tone: 'todo', icon: 'tasks', title: `${l.length} tâches à faire`, sub: 'Aujourd\'hui ou en retard', href: '#/tasks', act: ['Voir', '#/tasks'] }));
  all.intervention.filter((x) => x.data.date === today() && !['terminee', 'facturee', 'annulee'].includes(x.data.status))
    .forEach((x) => add(1, { tone: 'todo', icon: 'tool', title: `Intervention${x.data.time ? ` à ${x.data.time}` : ''} – ${cname(x.data.clientId) || x.number || ''}`, sub: x.data.title || x.data.desc || 'Intervention du jour', href: `#/intervention/${x.id}`, act: ['Ouvrir', `#/intervention/${x.id}`] }));
  const exp = all.expense.filter((e) => !e.data.refused);
  many(exp.filter((e) => purchState(e) === 'retard' && purchRest(e.data) > 0.005), 4, 1,
    (e) => ({ tone: 'late', icon: 'download', title: `Payer ${cname(e.data.supplierId) || e.data.desc || 'le fournisseur'}`, sub: `Facture fournisseur en retard de ${days(e.data.due)} jour(s)`, amount: purchRest(e.data), href: `#/purchase/${e.id}`, act: ['Payer', `#/purchase/${e.id}`] }),
    (l) => ({ tone: 'late', icon: 'download', title: `${l.length} factures fournisseurs en retard`, sub: 'À payer', amount: sum(l, (e) => purchRest(e.data)), href: '#/expenses', act: ['Voir', '#/expenses'] }));
  many(exp.filter((e) => purchState(e) === 'avalider'), 3, 3,
    (e) => ({ tone: 'todo', icon: 'download', title: `Vérifier l'achat ${cname(e.data.supplierId) || e.data.desc || ''}`.trim(), sub: 'Reçu ou photo à contrôler', amount: purchTtc(e.data), href: `#/purchase/${e.id}`, act: ['Vérifier', `#/purchase/${e.id}`] }),
    (l) => ({ tone: 'todo', icon: 'download', title: `${l.length} achats à vérifier`, sub: 'Reçus, photos et factures Peppol', href: '#/expenses', act: ['Vérifier', '#/expenses'] }));
  const quotes = all.quote.filter((q) => mine(q));
  const billed = new Set(all.invoice.map((i) => +i.data.quoteId).filter(Boolean));
  many(quotes.filter((q) => q.data.status === 'accepte' && !billed.has(q.id)), 4, 2,
    (q) => ({ tone: 'go', icon: 'calc', title: `Devis accepté : ${cname(q.data.clientId) || q.data.title || ''}`, sub: `${q.number} · pas encore facturé`, amount: totals(q.data).total, href: `#/quote/${q.id}`, act: ['Facturer', `#/quote/${q.id}`] }),
    (l) => ({ tone: 'go', icon: 'calc', title: `${l.length} devis acceptés à facturer`, sub: 'Acompte ou facture', href: '#/quotes', act: ['Voir', '#/quotes'] }));
  many(quotes.filter((q) => q.data.status === 'envoye' && days(q.data.sentAt || q.data.date) >= 7), 4, 3,
    (q) => ({ tone: 'todo', icon: 'calc', title: `Pas de réponse de ${cname(q.data.clientId) || 'votre client'}`, sub: `Devis ${q.number} envoyé il y a ${days(q.data.sentAt || q.data.date)} jours`, amount: totals(q.data).total, href: `#/quote/${q.id}`, act: ['Relancer', `#/print/quote/${q.id}?mail=1`] }),
    (l) => ({ tone: 'todo', icon: 'calc', title: `${l.length} devis sans réponse depuis une semaine`, sub: 'Un petit rappel fait souvent signer', href: '#/quotes', act: ['Voir', '#/quotes'] }));
  const opp = all.opportunity.filter((o) => mine(o) && OPP_OPEN.includes(o.data.stage) && o.data.nextDate && o.data.nextDate <= today());
  many(opp, 3, 3, (o) => ({ tone: 'todo', icon: 'target', title: `Rappeler : ${o.data.title || cname(o.data.contactId) || 'opportunité'}`, sub: 'Relance prévue aujourd\'hui', href: '#/opportunities', act: ['Ouvrir', `#/opportunities?o=${o.id}`] }),
    (l) => ({ tone: 'todo', icon: 'target', title: `${l.length} opportunités à relancer`, sub: 'Prévu aujourd\'hui ou avant', href: '#/opportunities', act: ['Voir', '#/opportunities'] }));
  // états d'avancement : approuvés ou délai passé → à facturer ; contestés → à corriger
  inv.filter((x) => isEA(x.i)).forEach((x) => { const e = eaState(x.i); const who = cname(x.i.data.clientId) || x.i.data.title || '';
    if (e.k === 'approuve' || e.late) add(2, { tone: 'go', icon: 'percent', title: `${e.late ? 'Délai d\'approbation passé' : 'État approuvé'} : EA${x.i.data.situationNo || ''} ${who}`, sub: e.late ? `Sans réponse depuis le ${fmtDate(e.approveBy)} : considéré comme accepté` : `Approuvé le ${fmtDate(e.approvedAt)}`, amount: x.s.t.total, href: `#/invoice/${x.i.id}`, act: ['Facturer', `#/invoice/${x.i.id}`] });
    else if (e.k === 'conteste') add(1, { tone: 'late', icon: 'percent', title: `État EA${x.i.data.situationNo || ''} contesté par ${who}`, sub: e.note || 'À corriger puis renvoyer', href: `#/invoice/${x.i.id}`, act: ['Corriger', `#/invoice/${x.i.id}/encodage`] }); });
  const drafts = inv.filter((x) => x.s.s === 'brouillon' && !isEA(x.i) && (x.i.data.lines || []).some((l) => l.kind === 'item'));
  if (drafts.length) add(4, drafts.length === 1 ? { tone: 'info', icon: 'edit', title: `Facture à terminer : ${cname(drafts[0].i.data.clientId) || drafts[0].i.data.title || ''}`, sub: 'Brouillon pas encore envoyé', amount: drafts[0].s.t.total, href: `#/invoice/${drafts[0].i.id}`, act: ['Terminer', `#/invoice/${drafts[0].i.id}`] }
    : { tone: 'info', icon: 'edit', title: `${drafts.length} factures en brouillon`, sub: 'Pas encore envoyées', amount: sum(drafts, (x) => x.s.t.total), href: '#/invoices', act: ['Voir', '#/invoices'] });
  // rapports envoyés par le terrain, pas encore lus
  const fieldIds = S.users.filter((u) => ['ouvrier', 'soustraitant'].includes(u.role)).map((u) => u.id);
  const newRep = all.report.filter((r) => fieldIds.includes(+r.created_by) && !(r.data.readBy || []).map(Number).includes(S.me.id));
  many(newRep, 3, 1, (r) => ({ tone: 'todo', icon: r.data.kind === 'photos' ? 'camera' : 'fiche', title: `${(S.users.find((u) => u.id === +r.created_by) || {}).name || 'Terrain'} : ${r.data.kind === 'photos' ? `${(r.data.photos || []).length} photo(s)` : 'nouveau rapport'}`, sub: `${byId(all.project, r.project_id) ? byId(all.project, r.project_id).data.name + ' · ' : ''}${(r.data.text || '').split('\n')[0] || fmtDate(r.data.date)}`, href: `#/report/${r.id}`, act: ['Lire', `#/report/${r.id}`] }),
    (l) => ({ tone: 'todo', icon: 'fiche', title: `${l.length} rapports du terrain à lire`, sub: 'Remarques et photos de vos équipes', href: '#/reports', act: ['Lire', '#/reports'] }));
  const pLate = all.point.filter(isLatePt);
  if (pLate.length) add(4, { tone: 'info', icon: 'pin', title: `${pLate.length} point(s) de chantier en retard`, sub: 'Réserves et remarques à lever', href: '#/projects', act: ['Voir', '#/projects'] });
  items.sort((a, b) => a.rank - b.rank);
  // l'argent : à recevoir, en retard, à payer, en attente de signature
  const toCash = inv.filter((x) => ['impayee', 'partielle', 'retard'].includes(x.s.s)); const late = inv.filter((x) => x.s.s === 'retard');
  const toPay = exp.filter((e) => ['apayer', 'partiel', 'retard'].includes(purchState(e)) && purchRest(e.data) > 0.005);
  const qSent = quotes.filter((q) => q.data.status === 'envoye');
  const projects = all.project.filter((p) => ['preparation', 'encours', 'reception'].includes(p.data.status) && (team || +p.data.managerId === S.me.id || (p.data.team || []).includes(S.me.id)));
  const prog = (p) => { if (!p.data.start || !p.data.end) return null; const t0 = dnum(p.data.start); const t1 = dnum(p.data.end); return t1 > t0 ? Math.max(0, Math.min(100, Math.round(((dnum(today()) - t0) / (t1 - t0)) * 100))) : null; };
  const n = items.length;
  page.innerHTML = `<div class="today">
    <section class="today-feed">
      <div class="today-hello"><b>Bonjour ${esc((S.me.name || '').split(' ')[0])}</b><span>${n ? `${n} chose${n > 1 ? 's' : ''} demande${n > 1 ? 'nt' : ''} votre attention` : 'Rien d\'urgent : tout est à jour'}</span></div>
      ${n ? `<ol class="todo-list">${items.map((x, k) => `<li class="todo tl-${x.tone}" data-k="${k}">
        <span class="todo-ic">${I[x.icon] || I.check}</span>
        <a class="todo-tx" href="${x.href}"><b>${esc(x.title)}</b><small>${esc(x.sub || '')}</small></a>
        ${x.amount ? `<span class="todo-amt">${money(x.amount)}</span>` : ''}
        ${x.done ? `<button type="button" class="todo-go" data-done="${x.done}">${I.check}<span>C'est fait</span></button>` : x.act ? `<a class="todo-go" href="${x.act[1]}">${esc(x.act[0])}</a>` : ''}</li>`).join('')}</ol>`
        : `<div class="todo-empty">${I.check}<b>Tout est à jour</b><span>Aucune facture en retard, aucune tâche en attente. Bon chantier !</span></div>`}
    </section>
    <aside class="today-side">
      <div class="card money-card"><div class="card-h"><h3>Votre argent</h3></div>
        <a class="mc-row" href="#/invoices"><span>À recevoir des clients</span><b>${money(sum(toCash, (x) => x.s.rest))}</b><small>${toCash.length} facture(s)</small></a>
        <a class="mc-row ${late.length ? 'late' : ''}" href="#/invoices"><span>Dont en retard</span><b>${money(sum(late, (x) => x.s.rest))}</b><small>${late.length} facture(s)</small></a>
        <a class="mc-row" href="#/expenses"><span>À payer aux fournisseurs</span><b>${money(sum(toPay, (e) => purchRest(e.data)))}</b><small>${toPay.length} facture(s)</small></a>
        <a class="mc-row" href="#/quotes"><span>Devis en attente de signature</span><b>${money(sum(qSent, (q) => totals(q.data).base))}</b><small>${qSent.length} devis · HT</small></a></div>
      <div class="card works-card"><div class="card-h"><h3>Chantiers en cours</h3><a class="muted" href="#/projects">Tous ›</a></div>
        ${projects.length ? projects.slice(0, 6).map((p) => { const pc = prog(p); return `<a class="wk" href="#/project/${p.id}"><span class="wk-dot" style="--c:${esc(p.data.color || '#1c2550')}"></span><span class="wk-tx"><b>${esc(p.data.name)}</b><small>${esc([st(PST, p.data.status).replace(/<[^>]+>/g, ''), p.data.city].filter(Boolean).join(' · '))}</small>${pc != null ? `<i class="wk-bar"><i style="width:${pc}%"></i></i>` : ''}</span></a>`; }).join('') : '<p class="muted">Aucun chantier en cours.</p>'}</div>
    </aside></div>`;
  $$('[data-done]', page).forEach((b) => { b.onclick = async () => {
    const t = all.task.find((x) => x.id === +b.dataset.done); if (!t) return;
    t.data.status = 'done'; b.closest('.todo').classList.add('gone'); await persist('task', t, { silent: true });
    toast('Bravo, une chose de moins ✓', 2000); setTimeout(render, 450);
  }; });
});

// Tableau de bord de l'édition simplifiée : devis, factures, achats, chantiers
async function dashboardSimple() {
  const all = await db.many(['quote', 'invoice', 'project', 'expense']);
  const page = layout({ active: 'dashboard', icon: 'dash', title: 'Tableau de bord' });
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const month = today().slice(0, 7);
  const inv = all.invoice.map((i) => ({ i, s: invState(i) }));
  const late = inv.filter((x) => x.s.s === 'retard'); const toCash = inv.filter((x) => ['impayee', 'partielle', 'retard'].includes(x.s.s)); const draftI = inv.filter((x) => x.s.s === 'brouillon');
  const qSent = all.quote.filter((q) => q.data.status === 'envoye'); const qDraft = all.quote.filter((q) => q.data.status === 'brouillon');
  const exp = all.expense.filter((e) => !e.data.refused);
  const eCheck = exp.filter((e) => purchState(e) === 'avalider'); const eToPay = exp.filter((e) => ['apayer', 'partiel', 'retard'].includes(purchState(e)));
  const projects = all.project.filter((p) => ['preparation', 'encours', 'reception'].includes(p.data.status));
  const line = (label, n, amount, href, cls = '') => `<a class="dash-line" href="${href}"><span>${label} <span class="muted">(${n})</span></span><b class="${cls}">${amount}</b></a>`;
  const block = (icon, title, href, main, rows) => `<div class="card dash"><div class="card-h"><h3>${I[icon]} ${title}</h3><a class="muted" href="${href}">Voir tout ›</a></div><div class="dash-b">${main}</div>${rows ? `<div class="dash-rows">${rows}</div>` : ''}</div>`;
  page.innerHTML = `<div class="quick-row">
      <button class="quick" data-q="buy">${I.camera}<span>Photo d'un achat</span></button>
      <button class="quick" data-q="inv">${I.coins}<span>Nouvelle facture</span></button>
      <button class="quick" data-q="quote">${I.calc}<span>Nouveau devis</span></button></div>
    <div class="kpis">${kpi('À encaisser TVAC', money(sum(toCash, (x) => x.s.rest)), { href: '#/invoices', sub: `${toCash.length} facture(s)` })}${kpi('Clients en retard', money(sum(late, (x) => x.s.rest)), { cls: late.length ? 'bad' : '', href: '#/invoices', sub: `${late.length} facture(s)` })}
      ${kpi('Achats à payer', money(sum(eToPay, (e) => purchRest(e.data))), { href: '#/expenses', sub: `${eToPay.length} facture(s)` })}${kpi('Facturé ce mois HT', money(sum(inv.filter((x) => (x.i.data.date || '').startsWith(month) && x.s.s !== 'brouillon'), (x) => x.s.t.base)), { cls: 'good', href: '#/invoices' })}</div>
    <div class="dash-grid">
    ${block('coins', 'Factures clients', '#/invoices', `${badge('À encaisser', '#3b5bdb')} <span class="muted">(${toCash.length})</span><div class="big">${money(sum(toCash, (x) => x.s.rest))}</div>`,
      line('À envoyer', draftI.length, money(sum(draftI, (x) => x.s.t.total)), '#/invoices') + line('En retard', late.length, money(sum(late, (x) => x.s.rest)), '#/invoices', late.length ? 'late' : ''))}
    ${block('calc', 'Devis', '#/quotes', `${badge('Envoyés, en attente', '#3b5bdb')} <span class="muted">(${qSent.length})</span><div class="big">${money(sum(qSent, (q) => totals(q.data).base))}</div>`,
      line('À envoyer', qDraft.length, money(sum(qDraft, (q) => totals(q.data).base)), '#/quotes') + line('Acceptés ce mois-ci', all.quote.filter((q) => q.data.status === 'accepte' && (q.data.acceptedAt || '').startsWith(month)).length, money(sum(all.quote.filter((q) => q.data.status === 'accepte' && (q.data.acceptedAt || '').startsWith(month)), (q) => totals(q.data).base)), '#/quotes'))}
    ${block('download', 'Achats', '#/expenses', `${badge('À payer', '#f08c00')} <span class="muted">(${eToPay.length})</span><div class="big">${money(sum(eToPay, (e) => purchRest(e.data)))}</div>`,
      line('À valider (reçus / photos)', eCheck.length, '', '#/expenses', eCheck.length ? 'late' : '') + line('Achats ce mois HT', exp.filter((e) => (e.data.date || '').startsWith(month)).length, money(sum(exp.filter((e) => (e.data.date || '').startsWith(month)), (e) => num(e.data.amount))), '#/expenses'))}
    ${block('crane', 'Chantiers en cours', '#/projects', `<div class="big">${projects.length}</div>`, projects.slice(0, 6).map((p) => { const cost = sum(exp, (e) => expenseAmountFor(e, p.id)); return `<a class="dash-line" href="#/project/${p.id}"><span><i class="dot" style="--c:${esc(p.data.color || '#3b5bdb')}"></i> ${esc(p.data.name)}</span><small class="muted">achats ${money(cost)}</small></a>`; }).join('') || '<div class="muted sm">Aucun chantier en cours</div>')}
  </div>`;
  bindKpis(page);
  $('[data-q=buy]').onclick = () => importPurchase();
  $('[data-q=inv]').onclick = () => newInvoice({ data: {} });
  $('[data-q=quote]').onclick = () => newQuote();
}

// ---------------------------------------------------------------- Statistiques
function barChart(series, { h = 200, color = '#3b5bdb', fmt = money } = {}) {
  const max = Math.max(1, ...series.map((s) => Math.abs(s.v)));
  return `<div class="bars" style="height:${h}px">${series.map((s) => `<div class="bar-c" title="${esc(s.l)} : ${esc(fmt(s.v))}"><div class="bar-v"><i style="height:${(Math.abs(s.v) / max) * 100}%;background:${s.c || color}"></i></div><small>${esc(s.l)}</small></div>`).join('')}</div>`;
}
route('stats', async () => {
  const all = await db.many(['invoice', 'quote', 'opportunity', 'project', 'expense', 'timesheet', 'order']);
  const year = +(ui.statYear || new Date().getFullYear());
  const page = layout({ active: 'stats', icon: 'chart', title: 'Statistiques', actions: `<select data-y>${[0, 1, 2, 3].map((k) => new Date().getFullYear() - k).map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>` });
  $('[data-y]').onchange = (e) => { ui.statYear = e.target.value; saveUi(); render(); };
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const inv = all.invoice.map((i) => ({ i, s: invState(i) })).filter((x) => x.s.s !== 'brouillon');
  const ca = months.map((m) => inv.filter((x) => (x.i.data.date || '').startsWith(m)).reduce((a, x) => a + x.s.t.base, 0));
  const cash = months.map((m) => all.invoice.reduce((a, i) => a + (i.data.payments || []).filter((p) => (p.date || '').startsWith(m)).reduce((b, p) => b + num(p.amount), 0), 0));
  const costs = months.map((m) => all.expense.filter((e) => !e.data.refused && (e.data.date || '').startsWith(m)).reduce((a, e) => a + num(e.data.amount), 0) + all.timesheet.filter((t) => (t.data.date || '').startsWith(m)).reduce((a, t) => a + num(t.data.hours) * num(t.data.rate), 0));
  const qY = all.quote.filter((q) => (q.data.date || '').startsWith(String(year)));
  const decided = qY.filter((q) => ['accepte', 'refuse'].includes(q.data.status));
  const conv = decided.length ? Math.round(qY.filter((q) => q.data.status === 'accepte').length / decided.length * 100) : 0;
  const ML = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const projRows = all.project.map((p) => {
    const by = (t) => all[t].filter((x) => x.project_id === p.id);
    const f = projectFinance(p, { quote: by('quote'), invoice: by('invoice'), order: by('order'), expense: all.expense, timesheet: by('timesheet') });
    return { p, f };
  }).filter((r) => r.f.budget || r.f.real);
  const funnel = OPP_STAGES.map(([k, l, c]) => ({ l, c, n: all.opportunity.filter((o) => o.data.stage === k).length, v: all.opportunity.filter((o) => o.data.stage === k).reduce((a, o) => a + num(o.data.amount), 0) }));
  page.innerHTML = `<div class="kpis">${kpi(`Chiffre d'affaires ${year} HT`, money(ca.reduce((a, v) => a + v, 0)))}${kpi('Encaissé', money(cash.reduce((a, v) => a + v, 0)), { cls: 'good' })}${kpi('Coûts directs', money(costs.reduce((a, v) => a + v, 0)))}
    ${kpi('Devis émis', `${qY.length}`, { sub: money(qY.reduce((a, q) => a + totals(q.data).base, 0)) })}${kpi('Taux de transformation', conv + ' %', { meter: conv })}</div>
    <div class="cols-2"><div class="card"><div class="card-h"><h3>Chiffre d'affaires facturé par mois (HT)</h3></div>${barChart(ca.map((v, i) => ({ l: ML[i], v })))}</div>
      <div class="card"><div class="card-h"><h3>Encaissements par mois</h3></div>${barChart(cash.map((v, i) => ({ l: ML[i], v })), { color: '#2f9e44' })}</div></div>
    <div class="cols-2"><div class="card"><div class="card-h"><h3>Coûts directs par mois (achats + main d'œuvre)</h3></div>${barChart(costs.map((v, i) => ({ l: ML[i], v })), { color: '#f08c00' })}</div>
      <div class="card"><div class="card-h"><h3>Pipeline des opportunités</h3></div><div class="rows">${funnel.map((x) => `<div class="row static"><i class="dot" style="--c:${x.c}"></i><span class="grow">${x.l} <span class="muted">(${x.n})</span></span><b>${money(x.v)}</b></div>`).join('')}</div></div></div>
    <div class="card"><div class="card-h"><h3>Rentabilité des chantiers</h3></div><div id="ptbl"></div></div>`;
  dataTable($('#ptbl'), {
    rows: projRows, state: { sort: -6 },
    columns: [{ l: 'Chantier', v: (r) => `<a href="#/project/${r.p.id}">${esc(r.p.data.name)}</a>` }, { l: 'Statut', v: (r) => st(PST, r.p.data.status) }, { l: 'Budget HT', cls: 'r', v: (r) => money(r.f.budget), sort: (r) => r.f.budget },
      { l: 'Prévu', cls: 'r', v: (r) => money(r.f.est), sort: (r) => r.f.est }, { l: 'Réel', cls: 'r', v: (r) => `<span class="${r.f.est && r.f.real > r.f.est ? 'late' : ''}">${money(r.f.real)}</span>`, sort: (r) => r.f.real },
      { l: 'Marge estimée', cls: 'r', v: (r) => `<b class="${r.f.margin < 0 ? 'late' : ''}">${money(r.f.margin)}</b>${r.f.budget ? ` <small class="muted">${fnum((r.f.margin / r.f.budget) * 100, 1)} %</small>` : ''}`, sort: (r) => r.f.margin },
      { l: 'Facturé', cls: 'r', v: (r) => money(r.f.invoiced), sort: (r) => r.f.invoiced }],
    empty: 'Aucune donnée',
  });
});

// ---------------------------------------------------------------- Paramètres
route('settings', async (tab = 'company') => {
  if (!isAdmin()) return go('#/dashboard');
  const page = layout({ active: '', icon: 'gear', title: 'Paramètres', tabs: [['company', 'Entreprise'], ['docs', 'Documents & numérotation'], ['templates', 'Modèles de documents'], ['contracts', 'Contrats types'], ['peppol', 'Peppol'], ['mail', 'Email'], ['ai', 'Assistant IA'], ['users', 'Utilisateurs'], ['notifs', 'Notifications'], ['activity', 'Journal d\'activité']].filter(([k]) => !(isSimple() && k === 'ai')).map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('') });
  const co = { ...company() };
  if (tab === 'users') return settingsUsers(page);
  if (tab === 'notifs') return settingsNotifs(page);
  if (tab === 'peppol') return peppolSettings(page);
  if (tab === 'mail') return mailSettings(page);
  if (tab === 'ai') return aiSettings(page);
  if (tab === 'templates') return templateSettings(page);
  if (tab === 'contracts') return settingsContracts(page);
  if (tab === 'activity') {
    const act = await api('GET', 'activity&limit=200');
    page.innerHTML = `<div class="card"><div class="feed">${act.map((a) => `<div><b>${esc(a.user_name || '')}</b> ${{ create: 'a créé', update: 'a modifié', delete: 'a supprimé', mail: 'a envoyé par email' }[a.action] || a.action} <span class="muted">${esc(TYPE_LABELS[a.type] || a.type)}</span> ${esc(a.label || '')}<small class="muted">${fmtDT(a.created_at)}</small></div>`).join('')}</div></div>`;
    return;
  }
  const fields = tab === 'company' ? [
    { name: 'name', label: 'Raison sociale', required: true }, { name: 'appName', label: 'Nom affiché dans l\'application' },
    { name: 'vat', label: 'N° TVA' }, { name: 'rpm', label: 'RPM / RCS / registre' },
    { name: 'street', label: 'Rue et numéro', cls: 'full' }, { name: 'zip', label: 'Code postal' }, { name: 'city', label: 'Localité' },
    { name: 'phone', label: 'Téléphone' }, { name: 'email', label: 'Email' }, { name: 'website', label: 'Site web' },
    { name: 'iban', label: 'IBAN' }, { name: 'bic', label: 'BIC' },
    { name: 'country', label: 'Pays', type: 'select', options: [['BE', 'Belgique'], ['FR', 'France'], ['LU', 'Luxembourg'], ['CH', 'Suisse'], ['RO', 'Roumanie']] },
    { name: 'currency', label: 'Devise', type: 'select', options: [['EUR', 'EUR €'], ['CHF', 'CHF'], ['RON', 'RON lei']] },
    { name: 'logo', type: 'html', cls: 'full', html: `<span class="lbl">Logo (devis, factures, rapports)</span><div class="file-pick"><span data-logo>${co.logoId ? `<img src="${fileUrl(co.logoId)}" style="max-height:60px">` : '<span class="muted">Aucun logo</span>'}</span><button type="button" class="btn sm" data-uplogo>Choisir une image</button></div>` },
  ] : [
    { name: 'vatRates', label: 'Taux de TVA (séparés par ;)', hint: 'Belgique : 21; 12; 6; 0 · France : 20; 10; 5,5; 0' }, { name: 'defaultVat', label: 'Taux par défaut', type: 'number' },
    { name: 'quoteValidity', label: 'Validité des devis (jours)', type: 'number' }, { name: 'paymentDays', label: 'Délai de paiement (jours)', type: 'number' },
    { name: 'p_quote', label: 'Préfixe devis' }, { name: 'p_invoice', label: 'Préfixe factures' }, { name: 'p_avoir', label: 'Préfixe notes de crédit' }, { name: 'p_order', label: 'Préfixe commandes' },
    { name: 'p_project', label: 'Préfixe chantiers' }, { name: 'p_intervention', label: 'Préfixe interventions' },
    { name: 'quoteNotes', label: 'Mentions par défaut sur les devis', type: 'textarea', cls: 'full' }, { name: 'terms', label: 'Conditions générales', type: 'textarea', rows: 6, cls: 'full', hint: 'Imprimées sur une page à part (page 2) des devis et factures : choix dans Paramètres → Modèles de documents.' },
    { name: 'invoiceNotes', label: 'Mentions par défaut sur les factures', type: 'textarea', cls: 'full' },
    { name: 'footer', label: 'Pied de page des documents', cls: 'full' },
  ];
  const pre = S.settings.prefixes || {};
  // ancienne adresse sur plusieurs lignes : découpée en rue / code postal / localité
  const a0 = splitAddress(co.address);
  const values = { ...co, street: co.street || a0.street, zip: co.zip || a0.zip, city: co.city || a0.city, vatRates: vatList().join('; '), defaultVat: defVat(), p_quote: pre.quote ?? 'DEV', p_invoice: pre.invoice ?? 'FAC', p_avoir: pre.avoir ?? 'NC', p_order: pre.order ?? 'BC', p_project: pre.project ?? 'CH', p_intervention: pre.intervention ?? 'INT' };
  page.innerHTML = `<div class="card"><form>${fieldsGrid(fields, values)}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div></form></div>`;
  const form = $('form', page);
  const up = $('[data-uplogo]', form);
  if (up) up.onclick = async () => { const [f] = await pickFile('image/*'); if (!f) return; const r = await resizeImage(await blobToImg(f), 600, 'image/png'); const res = await upload(new File([r.blob], 'logo.png', { type: 'image/png' })); co.logoId = res.id; $('[data-logo]', form).innerHTML = `<img src="${fileUrl(res.id)}" style="max-height:60px">`; };
  if (tab === 'company') vatAutofill(form, { name: 'name', street: 'street', zip: 'zip', city: 'city', country: 'country', phone: 'phone', email: 'email', website: 'website' }, { countryCode: true });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = readFields(form, fields);
    if (tab === 'company') { Object.assign(co, v); delete co.logo; co.address = [v.street, [v.zip, v.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'); await api('PUT', 'settings', { company: co }); S.settings.company = co; } else {
      const rates = String(v.vatRates).split(/[;\s]+/).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => !isNaN(x));
      Object.assign(co, { vatRates: rates.length ? rates : [21, 6, 0], defaultVat: num(v.defaultVat), quoteValidity: num(v.quoteValidity), paymentDays: num(v.paymentDays), quoteNotes: v.quoteNotes, terms: v.terms, invoiceNotes: v.invoiceNotes, footer: v.footer });
      const prefixes = { quote: v.p_quote, invoice: v.p_invoice, avoir: v.p_avoir, order: v.p_order, project: v.p_project, intervention: v.p_intervention };
      await api('PUT', 'settings', { company: co, prefixes }); S.settings.company = co; S.settings.prefixes = prefixes;
    }
    toast('Paramètres enregistrés'); render();
  };
});
async function settingsUsers(page) {
  const [b, staff, contacts] = await Promise.all([api('GET', 'bootstrap'), db.list('employee'), db.list('contact')]);
  S.users = b.users;
  const subs = contacts.filter((c) => c.data.kind === 'soustraitant');
  const linkOf = (u) => ({ employeeId: (staff.find((e) => +e.data.userId === u.id) || {}).id || '', contactId: (subs.find((c) => +c.data.userId === u.id) || {}).id || '' });
  const edit = (u) => {
    const m = formModal({
      title: u ? u.name : 'Nouvel accès', values: u ? { ...u, active: !!u.active, ...linkOf(u) } : { role: 'user', color: '#' + Math.floor(Math.random() * 0xbbbbbb + 0x222222).toString(16).padStart(6, '0'), active: true },
      fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'email', label: 'Email (identifiant)', type: 'email', required: true },
        { name: 'role', label: 'Rôle', type: 'select', options: [['user', 'Bureau (accès complet)'], ['admin', 'Administrateur'], ['ouvrier', 'Ouvrier / employé (espace terrain)'], ['soustraitant', 'Sous-traitant (espace terrain)']] }, { name: 'color', label: 'Couleur', type: 'color' },
        { name: 'employeeId', label: 'Fiche du personnel (RH)', type: 'select', options: [['', staff.length ? '— choisir —' : '— ajoutez-le d\'abord dans RH → Personnel —'], ...staff.map((e) => [e.id, e.data.name])], cls: 'full', hint: 'Ses heures, ses affectations et les phases où il est prévu viennent de cette fiche.' },
        { name: 'contactId', label: 'Fiche du sous-traitant (Carnet)', type: 'select', options: [['', subs.length ? '— choisir —' : '— ajoutez-le d\'abord dans Carnet → Sous-traitants —'], ...subs.map((c) => [c.id, contactName(c)])], cls: 'full', hint: 'Il voit les chantiers où il est prévu, ses bons de commande (envoyés) et leur statut de facturation.' },
        { name: 'info', type: 'html', cls: 'full', html: '<div class="s-info" data-fi>Espace terrain : il voit uniquement ses chantiers, encode ses heures, envoie des rapports et des photos, lit les rapports que vous lui envoyez et son planning. Il ne voit ni prix, ni devis, ni factures, ni clients.</div>' },
        { name: 'password', label: u ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe (8 caractères min.)', type: 'password', required: !u },
        ...(u && u.id !== S.me.id ? [{ name: 'active', label: 'Compte actif', type: 'check' }] : [])],
      async onSave(v) {
        if (v.role === 'ouvrier' && !v.employeeId) throw new Error('Choisissez sa fiche du personnel (RH → Personnel)');
        if (v.role === 'soustraitant' && !v.contactId) throw new Error('Choisissez la fiche du sous-traitant');
        const body = { ...v, link: { employeeId: +v.employeeId || 0, contactId: +v.contactId || 0 } }; delete body.employeeId; delete body.contactId; delete body.info;
        if (u) await api('PUT', `users/${u.id}`, body); else await api('POST', 'users', body);
        toast(u ? 'Accès modifié' : 'Accès créé – communiquez-lui son email et son mot de passe', 4000); render();
      },
    });
    const form = $('form', m.el); const role = $('[name=role]', form);
    const sync = () => { const r = role.value; $('[name=employeeId]', form).closest('.field').hidden = r !== 'ouvrier'; $('[name=contactId]', form).closest('.field').hidden = r !== 'soustraitant'; $('[data-fi]', form).closest('.field').hidden = !['ouvrier', 'soustraitant'].includes(r); };
    role.addEventListener('change', sync); sync();
    // nom et email repris de la fiche choisie
    const fill = (sel, list, name, email) => { $(sel, form).addEventListener('change', (e) => { const x = byId(list, +e.target.value); if (!x) return; const n = $('[name=name]', form); const em = $('[name=email]', form); if (!n.value) n.value = name(x); if (!em.value && email(x)) em.value = email(x); }); };
    fill('[name=employeeId]', staff, (x) => x.data.name || '', (x) => x.data.email || '');
    fill('[name=contactId]', subs, (x) => contactName(x), (x) => x.data.email || '');
  };
  dataTable(page, {
    rows: S.users.filter((u) => S.firm.own !== false || u.id !== S.me.id), toolbar: `<button class="btn primary" data-act="new">${I.plus} Nouvel accès</button>`,
    columns: [{ l: '', v: (u) => avatar(u.id) }, { l: 'Nom', v: (u) => `<b>${esc(u.name)}</b>` }, { l: 'Email', v: (u) => esc(u.email) }, { l: 'Rôle', v: (u) => badge(...(ROLE_LABELS[u.role] || ROLE_LABELS.user)) },
      { l: 'Statut', v: (u) => (u.active ? badge('Actif', '#2f9e44') : badge('Désactivé', '#868e96')) }, { l: 'Dernière connexion', v: (u) => fmtDT(u.last_login) }],
    onRow: edit,
  });
  $('[data-act=new]', page).onclick = () => edit();
}
// Paramètres → Notifications : rappel de fin de journée, nouvelles du terrain, e-mail
function settingsNotifs(page) {
  const v = { hour: '17:30', remind: true, summary: true, events: true, emailRemind: true, emailSummary: true, emailEvents: false, ...(S.settings.notif || {}) };
  const fields = [
    { name: 'h1', type: 'html', cls: 'full', html: '<div class="section-t">Fin de journée (jours ouvrables)</div>' },
    { name: 'hour', label: 'Heure du rappel', type: 'time' },
    { name: 'remind', label: 'Rappeler aux ouvriers et sous-traitants d\'encoder leurs heures s\'ils ne l\'ont pas fait', type: 'check', cls: 'full' },
    { name: 'summary', label: 'M\'envoyer la liste de ceux qui n\'ont pas encodé leurs heures', type: 'check', cls: 'full' },
    { name: 'h2', type: 'html', cls: 'full', html: '<div class="section-t">Pendant la journée</div>' },
    { name: 'events', label: 'Me prévenir à chaque ajout du terrain (heures, rapport, photos)', type: 'check', cls: 'full' },
    { name: 'h3', type: 'html', cls: 'full', html: '<div class="section-t">Copie par e-mail</div><small class="muted">Les notifications arrivent toujours dans l\'application (et sur le téléphone si elles y sont activées). L\'e-mail est en plus.</small>' },
    { name: 'emailRemind', label: 'Rappel des heures aussi par e-mail', type: 'check' }, { name: 'emailSummary', label: 'Liste du soir aussi par e-mail', type: 'check' },
    { name: 'emailEvents', label: 'Chaque ajout du terrain aussi par e-mail', type: 'check' },
  ];
  const st = pushState();
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Cet appareil</h3></div>
      <p>${st === 'on' ? '✓ Les notifications sont activées sur cet appareil.' : st === 'denied' ? 'Les notifications sont bloquées dans les réglages de ce navigateur.' : st === 'unsupported' ? 'Ce navigateur ne reçoit pas les notifications (sur iPhone : installez d\'abord l\'application sur l\'écran d\'accueil).' : 'Les notifications ne sont pas encore activées sur cet appareil.'}</p>
      <div class="btns"><button class="btn primary" data-act="push">${I.bell} ${st === 'on' ? 'Envoyer une notification de test' : 'Activer sur cet appareil'}</button></div></div>
    <div class="card"><form>${fieldsGrid(fields, v)}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" data-act="now">Vérifier les heures maintenant</button></div></form>
      <p class="muted">Le rappel part à l'heure choisie dès qu'une personne utilise l'application. Pour qu'il parte toujours à l'heure exacte, ajoutez la tâche planifiée <code>cron.php</code> (voir README, toutes les 15 minutes).</p></div>`;
  const form = $('form', page);
  form.onsubmit = async (e) => { e.preventDefault(); const nv = readFields(form, fields); S.settings.notif = nv; await api('PUT', 'settings', { notif: nv }); toast('Notifications enregistrées'); };
  $('[data-act=push]', page).onclick = async () => { if (pushState() === 'on') { await api('POST', 'notifs/test'); toast('Notification de test envoyée', 2500); notifRefresh(); } else pushEnable(); };
  $('[data-act=now]', page).onclick = async () => { const r = await api('POST', 'notifs/remind'); toast(r.missing.length ? `Rappel envoyé à : ${r.missing.join(', ')}` : 'Tout le monde a encodé ses heures aujourd\'hui ✓', 5000); notifRefresh(); };
}
function editProfile() {
  formModal({
    title: 'Mon profil', values: { name: S.me.name, color: S.me.color },
    fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'color', label: 'Couleur', type: 'color' }, { name: 'old', label: 'Mot de passe actuel', type: 'password', hint: 'Uniquement pour changer de mot de passe' }, { name: 'new', label: 'Nouveau mot de passe', type: 'password' }],
    async onSave(v) {
      await api('PUT', `users/${S.me.id}`, { name: v.name, color: v.color });
      if (v.new) await api('POST', 'auth/password', { old: v.old, new: v.new });
      Object.assign(S.me, { name: v.name, color: v.color }); const u = S.users.find((x) => x.id === S.me.id); if (u) Object.assign(u, { name: v.name, color: v.color });
      toast('Profil enregistré'); render();
    },
  });
}

const EDITIONS = [['simple', 'BâtiPro Simplifié (indépendants)'], ['avance', 'BâtiPro Avancé (complet)']];
// Actions de création (recherche rapide et bouton « + » de la barre mobile)
const quickActions = () => [['Nouveau devis', () => newQuote()], ['Nouveau chantier', () => editProject()], ['Nouveau contact', () => editContact().then((c) => c && go(`#/contact/${c.id}`))], ['Nouvelle opportunité', () => editOpportunity()], ['Nouvelle intervention', () => editIntervention()], ['Nouvelle tâche', () => editTask()], ['Encoder des heures', () => editTimesheet()], ['Nouvel achat', () => editExpense()]];
const QA_ICONS = ['calc', 'crane', 'contacts', 'target', 'tool', 'tasks', 'people', 'coins'];
const quickActionsSimple = () => [['Faire une facture', 'coins', () => go('#/s/facture/new')], ['Faire un devis', 'calc', () => go('#/s/devis/new')], ['J\'ai acheté (photo du ticket)', 'camera', () => go('#/s/achat')],
  ['On m\'a payé', 'check', () => go('#/s/paye')], ['Note de crédit', 'copy', () => go('#/s/avoir')], ['Nouveau chantier', 'crane', () => editProject()], ['Nouveau client', 'contacts', () => sNewClient().then((c) => c && go(`#/contact/${c.id}`))]];
function quickAddMenu() {
  if (isField()) return menuSheet('Créer', [{ label: 'Encoder mes heures', icon: 'clock', primary: true, run: () => go('#/t/heures') }, { label: 'Envoyer des photos', icon: 'camera', run: () => go('#/t/photos') }, { label: 'Faire un rapport', icon: 'fiche', run: () => go('#/t/rapport/new') }]);
  if (isSimple()) return menuSheet('Créer', quickActionsSimple().map(([label, icon, run], i) => ({ label, icon, run, primary: i === 0 })));
  menuSheet('Créer', [...quickActions().map(([label, run], i) => ({ label, icon: QA_ICONS[i] || 'plus', run })),
    ...(S.ai ? [{ sep: true }, { label: 'Demander à l\'assistant IA', icon: 'spark', run: () => aiToggle(true) }] : [])]);
}

// ---------------------------------------------------------------- Recherche rapide (⌘K)
async function quickSearch() {
  const m = modal(`<div class="qs"><label class="search big">${I.search}<input placeholder="Rechercher un chantier, contact, devis, facture… ou une action" autofocus></label><div class="qs-res"></div></div>`, { wide: true });
  const all = await db.many(['project', 'contact', 'quote', 'invoice', 'opportunity', 'order', 'intervention']);
  const actions = isSimple() ? quickActionsSimple().map(([l, , run]) => [l, run]) : quickActions();
  const items = [
    ...actions.map(([l, run]) => ({ l, s: 'Action', run })),
    ...all.project.map((x) => ({ l: x.data.name, s: `Chantier ${x.number}`, h: `#/project/${x.id}` })),
    ...all.contact.map((x) => ({ l: contactName(x), s: CONTACT_KINDS[x.data.kind] || 'Contact', h: `#/contact/${x.id}`, x: [x.data.email, x.data.city].join(' ') })),
    ...all.quote.map((x) => ({ l: `${x.number} · ${x.data.title || ''}`, s: 'Devis', h: `#/quote/${x.id}` })),
    ...all.invoice.map((x) => ({ l: `${x.number || 'Brouillon'} · ${x.data.title || ''}`, s: IKIND[x.data.kind] || 'Facture', h: `#/invoice/${x.id}` })),
    ...all.opportunity.map((x) => ({ l: x.data.title, s: 'Opportunité', h: `#/opportunities?o=${x.id}` })),
    ...all.order.map((x) => ({ l: x.number, s: 'Commande', h: `#/order/${x.id}` })),
    ...all.intervention.map((x) => ({ l: `${x.number} · ${x.data.title || ''}`, s: 'Intervention', h: `#/intervention/${x.id}` })),
  ];
  const inp = $('input', m.el); let sel = 0; let res = [];
  const draw = () => {
    const q = inp.value.toLowerCase().trim();
    res = (q ? items.filter((i) => `${i.l} ${i.s} ${i.x || ''}`.toLowerCase().includes(q)) : items.slice(0, 8)).slice(0, 30);
    sel = Math.min(sel, Math.max(0, res.length - 1));
    $('.qs-res', m.el).innerHTML = res.map((r, i) => `<button class="qs-item ${i === sel ? 'on' : ''}" data-i="${i}"><b>${esc(r.l)}</b><small class="muted">${esc(r.s)}</small></button>`).join('') || '<div class="empty sm">Aucun résultat</div>';
    $$('[data-i]', m.el).forEach((b) => { b.onclick = () => open(res[+b.dataset.i]); });
  };
  const open = (r) => { if (!r) return; m.close(); if (r.run) r.run(); else go(r.h); };
  inp.oninput = () => { sel = 0; draw(); };
  inp.onkeydown = (e) => { if (e.key === 'ArrowDown') { sel = Math.min(res.length - 1, sel + 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') open(res[sel]); };
  draw(); inp.focus();
}


// ---------------------------------------------------------------- Plateforme : firmes clientes (super-administrateur)
route('platform', async () => {
  if (!S.me.super) return go('#/dashboard');
  const rows = await api('GET', 'platform/companies');
  const page = layout({ active: '', icon: 'people', title: 'Plateforme – firmes', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle firme</button>` });
  page.innerHTML = `<div class="kpis">${kpi('Firmes', rows.length, { sub: `${rows.filter((c) => c.active).length} active(s)` })}${kpi('Utilisateurs', rows.reduce((a, c) => a + c.users_active, 0))}${kpi('Chantiers', rows.reduce((a, c) => a + c.projects, 0))}</div>
    <div id="tbl"></div>
    <div class="card"><div class="card-h"><h3>Comment ça marche</h3></div><ol class="steps">
      <li>Chaque firme a ses propres données (clients, devis, factures, chantiers, achats, paramètres, Peppol) : les autres firmes ne les voient jamais.</li>
      <li>« Nouvelle firme » crée la firme et son premier <b>administrateur</b>. Communiquez-lui l'adresse de l'application, son email et son mot de passe.</li>
      <li>L'administrateur d'une firme crée lui-même ses collègues dans <b>Paramètres › Utilisateurs</b> (rôle Administrateur ou Utilisateur). Vous pouvez aussi le faire : « Entrer » dans la firme, puis Paramètres › Utilisateurs.</li>
      <li>Une firme suspendue ne peut plus se connecter ; ses données sont conservées. La corbeille la supprime définitivement avec toutes ses données.</li>
    </ol></div>`;
  const edit = (c) => formModal({
    title: c ? c.name : 'Nouvelle firme', values: c ? { name: c.name, edition: c.edition } : { country: 'BE', edition: 'simple' },
    fields: c ? [{ name: 'name', label: 'Nom de la firme', required: true, cls: 'full' }, { name: 'edition', label: 'Version', type: 'select', options: EDITIONS, cls: 'full', hint: 'Simplifié : devis, factures, achats par chantier, Peppol (indépendants). Avancé : tous les modules.' }] : [
      { name: 'vat', label: 'N° TVA', placeholder: 'BE0123456789', hint: 'Vérifié automatiquement : nom et adresse remplis' }, { name: 'name', label: 'Nom de la firme', required: true },
      { name: 'country', label: 'Pays', type: 'select', options: [['BE', 'Belgique'], ['FR', 'France'], ['LU', 'Luxembourg'], ['CH', 'Suisse'], ['RO', 'Roumanie']] },
      { name: 'edition', label: 'Version', type: 'select', options: EDITIONS },
      { name: 'street', label: 'Rue et numéro' }, { name: 'zip', label: 'Code postal' }, { name: 'city', label: 'Localité' },
      { name: 'html', type: 'html', cls: 'full', html: '<div class="section-t">Premier administrateur de la firme</div>' },
      { name: 'admin', label: 'Nom', required: true }, { name: 'email', label: 'Email (identifiant)', type: 'email', required: true },
      { name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'text', required: true, hint: 'Communiquez-le à l\'administrateur ; il pourra le changer dans son profil.' },
    ],
    saveLabel: c ? 'Enregistrer' : 'Créer la firme',
    after: (form) => { if (!c) vatAutofill(form, { name: 'name', street: 'street', zip: 'zip', city: 'city', country: 'country' }, { countryCode: true }); },
    async onSave(v) {
      if (c) { await api('PUT', `platform/companies/${c.id}`, { name: v.name, edition: v.edition }); if (c.id === S.firm.id) { location.reload(); return; } }
      else { await api('POST', 'platform/companies', v); toast(`Firme créée – ${v.email} peut se connecter`, 4000); }
      render();
    },
  });
  dataTable($('#tbl', page), {
    rows,
    search: (c) => [c.name, c.admins].join(' '),
    columns: [
      { l: 'Firme', v: (c) => `<b>${esc(c.name)}</b>${c.id === S.me.company_id ? ` ${badge('Votre firme', '#3b5bdb')}` : ''}<br><small class="muted">${esc(c.admins || '')}</small>` },
      { l: 'Version', v: (c) => (c.edition === 'simple' ? badge('Simplifié', '#0c8599') : badge('Avancé', '#7048e8')), sort: (c) => c.edition },
      { l: 'Utilisateurs', cls: 'r', v: (c) => `${c.users_active}${c.users !== c.users_active ? ` <small class="muted">/ ${c.users}</small>` : ''}` },
      { l: 'Chantiers', cls: 'r', v: (c) => c.projects },
      { l: 'Dernière connexion', v: (c) => fmtDT(c.last_login) },
      { l: 'Statut', v: (c) => (c.active ? badge('Active', '#2f9e44') : badge('Suspendue', '#e5484d')) },
      { l: '', v: (c) => `<span class="nowrap"><button class="btn sm primary" data-in="${c.id}">Entrer</button> <button class="btn sm" data-ed="${c.id}">${I.edit}</button>${c.id === S.me.company_id ? '' : ` <button class="btn sm" data-tg="${c.id}">${c.active ? 'Suspendre' : 'Réactiver'}</button> <button class="btn sm danger ghost" data-del="${c.id}" title="Supprimer la firme">${I.trash}</button>`}</span>` },
    ],
    empty: 'Aucune firme',
  });
  const byC = (id) => rows.find((c) => c.id === +id);
  page.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-in],[data-ed],[data-tg],[data-del]'); if (!b) return;
    if (b.dataset.del) {
      const c = byC(b.dataset.del);
      return formModal({
        title: `Supprimer « ${c.name} »`, saveLabel: 'Supprimer définitivement',
        fields: [{ name: 'w', type: 'html', cls: 'full', html: `<div class="hint-box warn">Suppression <b>définitive</b> de la firme, de ses ${c.users} utilisateur(s), de ses ${c.projects} chantier(s) et de toutes ses données (clients, devis, factures, achats, fichiers, paramètres, Peppol). Impossible d'annuler.<br>Pour garder les données, utilisez plutôt « Suspendre ».</div>` },
          { name: 'confirm', label: `Tapez le nom de la firme pour confirmer : ${c.name}`, required: true, cls: 'full' }],
        async onSave(v) {
          if (v.confirm.trim().toLowerCase() !== c.name.trim().toLowerCase()) throw new Error('Le nom ne correspond pas');
          await api('DELETE', `platform/companies/${c.id}`, { confirm: v.confirm }); toast(`Firme « ${c.name} » supprimée`, 3000); render();
        },
      });
    }
    if (b.dataset.in) return switchFirm(+b.dataset.in === S.me.company_id ? 0 : +b.dataset.in);
    if (b.dataset.ed) return edit(byC(b.dataset.ed));
    const c = byC(b.dataset.tg);
    if (c.active && !confirm(`Suspendre « ${c.name} » ? Ses utilisateurs ne pourront plus se connecter (les données sont conservées).`)) return;
    await api('PUT', `platform/companies/${c.id}`, { active: !c.active }); render();
  });
  $('[data-act=new]').onclick = () => edit(null);
});
boot();
