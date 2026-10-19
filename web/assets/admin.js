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
route('dashboard', async () => {
  if (isSimple()) return dashboardSimple();
  const all = await db.many(['opportunity', 'quote', 'invoice', 'project', 'task', 'point', 'intervention', 'expense']);
  const page = layout({ active: 'dashboard', icon: 'dash', title: 'Tableau de bord', actions: `<label class="chk"><input type="checkbox" data-mine ${ui.dashAll ? '' : 'checked'}>Uniquement mes éléments</label>` });
  $('[data-mine]').onchange = (e) => { ui.dashAll = !e.target.checked; saveUi(); render(); };
  const mine = (x, key = 'ownerId') => ui.dashAll || +x.data[key] === S.me.id || (!x.data[key] && x.created_by === S.me.id);
  const opps = all.opportunity.filter((o) => mine(o)); const oOpen = opps.filter((o) => OPP_OPEN.includes(o.data.stage));
  const quotes = all.quote.filter((q) => mine(q)); const qSent = quotes.filter((q) => q.data.status === 'envoye'); const qDraft = quotes.filter((q) => q.data.status === 'brouillon');
  const inv = all.invoice.filter((i) => ui.dashAll || i.created_by === S.me.id).map((i) => ({ i, s: invState(i) }));
  const late = inv.filter((x) => x.s.s === 'retard'); const draftI = inv.filter((x) => x.s.s === 'brouillon'); const toCash = inv.filter((x) => ['impayee', 'partielle'].includes(x.s.s));
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const tasks = all.task.filter((t) => t.data.status !== 'done' && (t.data.assignees || []).includes(S.me.id)).sort((a, b) => (a.data.due || '9').localeCompare(b.data.due || '9'));
  const projects = all.project.filter((p) => ['preparation', 'encours', 'reception'].includes(p.data.status) && (ui.dashAll || +p.data.managerId === S.me.id || (p.data.team || []).includes(S.me.id)));
  const pLate = all.point.filter(isLatePt);
  const relances = oOpen.filter((o) => o.data.nextDate && o.data.nextDate <= today());
  const inter = all.intervention.filter((x) => x.data.date === today() && !['terminee', 'facturee', 'annulee'].includes(x.data.status));
  const block = (icon, title, href, main, rows) => `<div class="card dash"><div class="card-h"><h3>${I[icon]} ${title}</h3><a class="muted" href="${href}">Voir tout ›</a></div><div class="dash-b">${main}</div>${rows ? `<div class="dash-rows">${rows}</div>` : ''}</div>`;
  const line = (label, n, amount, href, cls = '') => `<a class="dash-line" href="${href}"><span>${label} <span class="muted">(${n})</span></span><b class="${cls}">${amount}</b></a>`;
  page.innerHTML = `<div class="dash-grid">
    ${block('target', 'Mes opportunités', '#/opportunities', `${badge('En cours', '#3b5bdb')} <span class="muted">(${oOpen.length})</span><div class="big">${money(sum(oOpen, (o) => num(o.data.amount)))}</div>`,
      line('À relancer aujourd\'hui', relances.length, '', '#/opportunities', relances.length ? 'late' : '') + line('Gagnées ce mois-ci', opps.filter((o) => o.data.stage === 'gagne' && (o.data.wonAt || '').startsWith(today().slice(0, 7))).length, money(sum(opps.filter((o) => o.data.stage === 'gagne' && (o.data.wonAt || '').startsWith(today().slice(0, 7))), (o) => num(o.data.amount))), '#/opportunities'))}
    ${block('calc', 'Mes devis', '#/quotes', `${badge('En cours', '#3b5bdb')} <span class="muted">(${qSent.length})</span><div class="big">${money(sum(qSent, (q) => totals(q.data).base))}</div>`,
      line('À envoyer', qDraft.length, money(sum(qDraft, (q) => totals(q.data).base)), '#/quotes') + line('Acceptés ce mois-ci', quotes.filter((q) => q.data.status === 'accepte' && (q.data.acceptedAt || '').startsWith(today().slice(0, 7))).length, money(sum(quotes.filter((q) => q.data.status === 'accepte' && (q.data.acceptedAt || '').startsWith(today().slice(0, 7))), (q) => totals(q.data).base)), '#/quotes'))}
    ${block('coins', 'Mes factures', '#/invoices', `${badge('En retard', '#e5484d')} <span class="muted">(${late.length})</span><div class="big">${money(sum(late, (x) => x.s.rest))}</div>`,
      line('À envoyer', draftI.length, money(sum(draftI, (x) => x.s.t.total)), '#/invoices') + line('À encaisser', toCash.length, money(sum(toCash, (x) => x.s.rest)), '#/invoices'))}
    ${block('crane', 'Mes chantiers en cours', '#/projects', `<div class="big">${projects.length}</div>`, projects.slice(0, 5).map((p) => `<a class="dash-line" href="#/project/${p.id}"><span><i class="dot" style="--c:${esc(p.data.color || '#3b5bdb')}"></i> ${esc(p.data.name)}</span>${st(PST, p.data.status)}</a>`).join(''))}
    ${block('tasks', 'Mes tâches', '#/tasks', `<div class="big">${tasks.length}</div>`, tasks.slice(0, 5).map((t) => `<a class="dash-line" href="#/tasks"><span>${esc(t.data.title)}</span><small class="${t.data.due && t.data.due < today() ? 'late' : 'muted'}">${fmtDate(t.data.due)}</small></a>`).join('') || '<div class="muted sm">Rien à faire 🎉</div>')}
    ${block('pin', 'Suivi de chantier', '#/projects', `${badge('Points en retard', '#e5484d')} <div class="big">${pLate.length}</div>`, line("Interventions aujourd'hui", inter.length, '', '#/interventions') + line('Points ouverts (tous chantiers)', all.point.filter(isOpenPt).length, '', '#/projects'))}
  </div>`;
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
  const page = layout({ active: '', icon: 'gear', title: 'Paramètres', tabs: [['company', 'Entreprise'], ['docs', 'Documents & numérotation'], ['templates', 'Modèles de documents'], ['peppol', 'Peppol'], ['mail', 'Email'], ['ai', 'Assistant IA'], ['users', 'Utilisateurs'], ['activity', 'Journal d\'activité']].filter(([k]) => !(isSimple() && k === 'ai')).map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('') });
  const co = { ...company() };
  if (tab === 'users') return settingsUsers(page);
  if (tab === 'peppol') return peppolSettings(page);
  if (tab === 'mail') return mailSettings(page);
  if (tab === 'ai') return aiSettings(page);
  if (tab === 'templates') return templateSettings(page);
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
  const b = await api('GET', 'bootstrap'); S.users = b.users;
  const edit = (u) => formModal({
    title: u ? u.name : 'Nouvel utilisateur', values: u ? { ...u, active: !!u.active } : { role: 'user', color: '#' + Math.floor(Math.random() * 0xbbbbbb + 0x222222).toString(16).padStart(6, '0'), active: true },
    fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'email', label: 'Email (identifiant)', type: 'email', required: true },
      { name: 'role', label: 'Rôle', type: 'select', options: [['user', 'Utilisateur'], ['admin', 'Administrateur']] }, { name: 'color', label: 'Couleur', type: 'color' },
      { name: 'password', label: u ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe (8 caractères min.)', type: 'password', required: !u },
      ...(u && u.id !== S.me.id ? [{ name: 'active', label: 'Compte actif', type: 'check' }] : [])],
    async onSave(v) { if (u) await api('PUT', `users/${u.id}`, v); else await api('POST', 'users', v); toast(u ? 'Utilisateur modifié' : 'Utilisateur créé – communiquez-lui son email et son mot de passe'); render(); },
  });
  dataTable(page, {
    rows: S.users.filter((u) => S.firm.own !== false || u.id !== S.me.id), toolbar: `<button class="btn primary" data-act="new">${I.plus} Nouvel utilisateur</button>`,
    columns: [{ l: '', v: (u) => avatar(u.id) }, { l: 'Nom', v: (u) => `<b>${esc(u.name)}</b>` }, { l: 'Email', v: (u) => esc(u.email) }, { l: 'Rôle', v: (u) => (u.role === 'admin' ? badge('Administrateur', '#7048e8') : badge('Utilisateur', '#3b5bdb')) },
      { l: 'Statut', v: (u) => (u.active ? badge('Actif', '#2f9e44') : badge('Désactivé', '#868e96')) }, { l: 'Dernière connexion', v: (u) => fmtDT(u.last_login) }],
    onRow: edit,
  });
  $('[data-act=new]', page).onclick = () => edit();
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
const quickActionsSimple = () => [['Photo / PDF d\'un achat', 'camera', () => importPurchase()], ['Nouvelle facture', 'coins', () => newInvoice({ data: {} })], ['Nouveau devis', 'calc', () => newQuote()],
  ['Nouveau chantier', 'crane', () => editProject()], ['Nouveau contact', 'contacts', () => editContact().then((c) => c && go(`#/contact/${c.id}`))]];
function quickAddMenu() {
  if (isSimple()) return menuSheet('Créer', quickActionsSimple().map(([label, icon, run], i) => ({ label, icon, run, primary: i === 0 })));
  menuSheet('Créer', quickActions().map(([label, run], i) => ({ label, icon: QA_ICONS[i] || 'plus', run })));
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
