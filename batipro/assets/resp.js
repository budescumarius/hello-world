/* Pilotage d'un responsable d'équipe / d'atelier (rôle « chef ») – vu aussi par le patron (Équipe → Responsables).
   Son équipe = fiches du personnel dont il est le « Responsable » ; ses projets = ceux qu'il conduit, où il est dans l'équipe
   ou où son équipe a pointé / est planifiée. Il ne fait pas les factures : il indique l'avancement et « demande une facture »
   (type billreq) au bureau, et envoie un rapport (type mgrreport, figé au moment de l'envoi). */

const RESP_PERIODS = [['sem', 'Cette semaine'], ['semp', 'La semaine passée'], ['mois', 'Ce mois'], ['moisp', 'Le mois passé'], ['an', 'Cette année']];
const BRQ_KIND = { acompte: 'Acompte', avancement: 'État d\'avancement', solde: 'Solde / facture finale', autre: 'Autre' };
const BRQ_ST = { demandee: ['À facturer', '#e8590c'], facturee: ['Facturée ✓', '#2f9e44'], annulee: ['Annulée', '#868e96'] };
const chefUsers = () => S.users.filter((u) => u.role === 'chef' && u.active);

function respRange(k) {
  const t = today(); const y = +t.slice(0, 4); const m = +t.slice(5, 7);
  const mon = addDays(t, -((new Date(t + 'T12:00:00').getDay() + 6) % 7));
  if (k === 'semp') return [addDays(mon, -7), addDays(mon, -1)];
  if (k === 'mois') return [t.slice(0, 8) + '01', t];
  if (k === 'moisp') return [`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`, addDays(t.slice(0, 8) + '01', -1)];
  if (k === 'an') return [`${y}-01-01`, t];
  return [mon, addDays(mon, 6)];
}
const isWorkday = (d) => { const w = new Date(d + 'T12:00:00').getDay(); return w !== 0 && w !== 6; };
const daysOf = (a, b) => { const r = []; for (let d = a; d <= b; d = addDays(d, 1)) r.push(d); return r; };

// Avancement d'un projet : indiqué par le responsable, sinon dernier état d'avancement, sinon part déjà facturée
function respPct(p, f, invs) {
  if (p.data.progress !== undefined && p.data.progress !== null && p.data.progress !== '') return { v: num(p.data.progress), src: 'indiqué' };
  if (p.data.status === 'termine') return { v: 100, src: 'terminé' };
  const sit = invs.filter((i) => i.data.kind === 'situation' && i.data.status === 'emise').sort((a, b) => num(b.data.situationNo) - num(a.data.situationNo))[0];
  const rows = sit ? (sit.data.progressRows || []).filter((r) => r.kind === 'item') : [];
  const market = rows.reduce((a, r) => a + num(r.qty) * num(r.price), 0);
  if (market) return { v: rows.reduce((a, r) => a + num(r.qty) * num(r.price) * num(r.cum) / 100, 0) / market * 100, src: 'état d\'avancement' };
  return { v: f.budget ? Math.min(100, f.invoiced / f.budget * 100) : 0, src: 'estimé (facturé)' };
}

// Toutes les données du tableau de bord pour un responsable (uid) ou toute l'entreprise (uid = 0), sur une période
async function respData(uid, period) {
  const m = await db.many(['employee', 'project', 'quote', 'invoice', 'order', 'expense', 'timesheet', 'assign', 'absence', 'intervention', 'task', 'billreq', 'contact', 'mgrreport', 'phase']);
  const [from, to] = respRange(period);
  const active = m.employee.filter((e) => e.data.active !== false);
  let team = uid ? active.filter((e) => +e.data.chefId === uid) : active;
  const noTeam = !!uid && !team.length; if (noTeam) team = active;
  const teamIds = new Set(team.map((e) => e.id));
  const inTeam = (x) => teamIds.has(+x.data.employeeId);
  const by = (list, pid) => list.filter((x) => x.project_id === pid);
  const inPer = (d) => d && d >= from && d <= to;
  const live = (p) => ['preparation', 'encours', 'reception'].includes(p.data.status);
  const projects = m.project.filter((p) => (uid
    ? +p.data.managerId === uid || (p.data.team || []).map(Number).includes(uid) || m.timesheet.some((t) => t.project_id === p.id && inTeam(t) && (live(p) || inPer(t.data.date))) || m.assign.some((a) => a.project_id === p.id && inTeam(a) && a.data.date >= from)
    : live(p) || m.timesheet.some((t) => t.project_id === p.id && inPer(t.data.date))) && p.data.status !== 'annule');
  const pids = new Set(projects.map((p) => p.id));
  const rows = projects.map((p) => {
    const invs = by(m.invoice, p.id);
    const f = projectFinance(p, { quote: by(m.quote, p.id), invoice: invs, order: by(m.order, p.id), expense: m.expense, timesheet: by(m.timesheet, p.id) });
    const pc = respPct(p, f, invs); const value = f.budget * pc.v / 100;
    const asked = by(m.billreq, p.id).filter((b) => b.data.status === 'demandee').reduce((a, b) => a + num(b.data.amount), 0);
    const buy = f.real - (f.realBy.mo || 0);
    const hPer = by(m.timesheet, p.id).filter((t) => inPer(t.data.date)).reduce((a, t) => a + num(t.data.hours), 0);
    return { p, f, pc, value, asked, toBill: Math.max(0, value - f.invoiced - asked), rest: Math.max(0, f.budget - f.invoiced), margin: value - f.real, hPer, perHour: f.hours ? (value - buy) / f.hours : 0, client: contactName(byId(m.contact, p.data.clientId)) };
  });
  const rowOf = (pid) => rows.find((r) => r.p.id === pid);
  // personnes : heures, coût, valeur produite (heures × valeur d'une heure sur le projet), présence attendue
  const hours = m.timesheet.filter((t) => inTeam(t) && inPer(t.data.date));
  const absent = (e, d) => m.absence.some((a) => +a.data.employeeId === e.id && a.data.from <= d && a.data.to >= d);
  // jours à pointer : jusqu'à hier (aujourd'hui n'est pas fini), aujourd'hui seulement s'il a déjà des heures
  const yday = addDays(today(), -1); const lastDay = to < yday ? to : yday;
  const people = team.map((e) => {
    // jours à pointer : à partir de son entrée (date d'entrée, sinon création de sa fiche)
    const since = (e.data.start || String(e.created_at || '').slice(0, 10) || from) > from ? (e.data.start || String(e.created_at).slice(0, 10)) : from;
    const hs = hours.filter((t) => +t.data.employeeId === e.id);
    const h = hs.reduce((a, t) => a + num(t.data.hours), 0);
    const cost = hs.reduce((a, t) => a + num(t.data.hours) * num(t.data.rate || e.data.costRate), 0);
    const prod = hs.reduce((a, t) => { const r = t.project_id && rowOf(t.project_id); return a + (r ? num(t.data.hours) * r.perHour : 0); }, 0);
    const loose = hs.filter((t) => !t.project_id).reduce((a, t) => a + num(t.data.hours), 0);
    const tday = today() >= from && today() <= to && hs.some((t) => t.data.date === today()) ? 1 : 0;
    const expected = (daysOf(since, lastDay).filter((d) => isWorkday(d) && !absent(e, d)).length + tday) * (num(e.data.dayHours) || 8);
    const missing = daysOf(since, lastDay).filter((d) => isWorkday(d) && !absent(e, d) && !hs.some((t) => t.data.date === d));
    const byP = {}; hs.forEach((t) => { const k = t.project_id || 0; byP[k] = (byP[k] || 0) + num(t.data.hours); });
    return { e, h, cost, prod, margin: prod - cost, loose, expected, missing, byP, since };
  });
  const sumBy = (l, k) => l.reduce((a, x) => a + x[k], 0);
  const sc = m.invoice.filter((i) => pids.has(i.project_id) && i.data.status === 'emise');
  const invoicedPer = sc.filter((i) => inPer(i.data.date)).reduce((a, i) => a + totals(i.data).base * (i.data.kind === 'avoir' && totals(i.data).base > 0 ? -1 : 1), 0);
  const cashedPer = sc.reduce((a, i) => a + (i.data.payments || []).filter((x) => inPer(x.date)).reduce((s, x) => s + num(x.amount), 0), 0);
  // agenda : rendez-vous / interventions, tâches, début et fin de projets, équipe planifiée (14 jours)
  const end = addDays(today(), 13); const soon = (d) => d && d >= today() && d <= end;
  const ag = [];
  m.intervention.filter((x) => soon(x.data.date) && (!uid || !x.project_id || pids.has(x.project_id) || +x.data.assigneeId === uid)).forEach((x) => ag.push({ d: x.data.date, t: x.data.time || '', icon: 'tool', l: x.data.title || 'Intervention', s: [x.project_id && (byId(m.project, x.project_id) || { data: {} }).data.name, contactName(byId(m.contact, x.data.clientId)) !== '—' && contactName(byId(m.contact, x.data.clientId))].filter(Boolean).join(' · '), h: `#/intervention/${x.id}` }));
  m.task.filter((x) => soon(x.data.due) && x.data.status !== 'done' && (!uid || +x.data.assigneeId === uid || pids.has(x.project_id))).forEach((x) => ag.push({ d: x.data.due, icon: 'tasks', l: x.data.title, s: 'Tâche à terminer', h: '#/tasks' }));
  projects.forEach((p) => { if (soon(p.data.start)) ag.push({ d: p.data.start, icon: 'crane', l: `Début : ${p.data.name}`, s: '', h: `#/project/${p.id}` }); if (soon(p.data.end)) ag.push({ d: p.data.end, icon: 'crane', l: `Fin prévue : ${p.data.name}`, s: '', h: `#/project/${p.id}` }); });
  const asg = {}; m.assign.filter((a) => soon(a.data.date) && inTeam(a)).forEach((a) => { const k = `${a.data.date}|${a.project_id}`; (asg[k] = asg[k] || []).push((byId(team, +a.data.employeeId) || { data: {} }).data.name); });
  Object.entries(asg).forEach(([k, names]) => { const [d, pid] = k.split('|'); ag.push({ d, icon: 'helmet', l: (byId(m.project, +pid) || { data: { name: 'Autre chantier' } }).data.name, s: names.filter(Boolean).join(', '), h: '#/planning/team' }); });
  ag.sort((a, b) => (a.d + (a.t || '')).localeCompare(b.d + (b.t || '')));
  const reqs = m.billreq.filter((b) => !uid || pids.has(b.project_id) || b.created_by === uid);
  return { uid, period, from, to, team, noTeam, projects, rows, people, hours, ag, reqs, m,
    k: { hours: sumBy(people, 'h'), cost: sumBy(people, 'cost'), prod: sumBy(people, 'prod'), toBill: sumBy(rows, 'toBill'), asked: sumBy(rows, 'asked'), rest: sumBy(rows, 'rest'), margin: sumBy(rows, 'margin'), invoicedPer, cashedPer, missing: people.reduce((a, x) => a + x.missing.length, 0) } };
}

const respName = (uid) => (uid ? `Équipe de ${userName(uid)}` : 'Toute l\'entreprise');
const pctTxt = (v) => `${fnum(v, 0)} %`;
const signMoney = (v) => `<span style="color:${v < -0.5 ? '#e5484d' : v > 0.5 ? '#2f9e44' : 'inherit'}">${money(v)}</span>`;

// ---------------------------------------------------------------- Tableau de bord
route('resp', async (sub, id) => {
  if (isChef() && sub === 'proiecte') return respProjects();
  if (isChef() && sub === 'p' && id) return respProject(+id);
  if (isChef() && sub === 'estimative') return respEstimates();
  if (isChef() && sub === 'echipa') return respTeam();
  if (isChef() && sub === 'trimise') return respSent();
  if (sub === 'demandes') return respRequests();
  if (sub === 'rapports') return respReports();
  if (sub === 'rapport' && id) return respReportView(+id);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const chefs = chefUsers();
  const uid = isChef() ? S.me.id : (q.has('u') ? +q.get('u') : (ui.respU != null ? +ui.respU : (chefs[0] || {}).id || 0));
  if (!isChef() && q.has('u')) { ui.respU = uid; saveUi(); }
  const period = ui.respP && ui.respP !== 'an' ? ui.respP : 'sem';
  if (isChef()) {
    const page = layout({ title: `${rz('hello')} ${(S.me.name || '').split(' ')[0]}`, icon: 'sun', sub: esc(rzDate(today(), { weekday: 'long', day: 'numeric', month: 'long' })) });
    page.innerHTML = '<div class="empty">Un instant…</div>';
    const [D, ests] = await Promise.all([respData(S.me.id, 'sem'), db.list('quote', { estimate: true }).then((l) => l.filter((x) => x.data.estimate))]);
    return respSimple(page, D, ests);
  }
  const page = layout({ title: isChef() ? 'Mon tableau de bord' : 'Responsables', icon: 'chart', sub: esc(respName(uid)),
    actions: `<button class="btn" data-act="rep">${I.send} ${isChef() ? "Rapport au patron" : "Préparer un rapport"}</button>${isChef() ? `<button class="btn primary" data-act="breq">${I.coins} Demander une facture</button>` : `<a class="btn" href="#/resp/demandes">${I.coins} Demandes de facture</a>`}` });
  page.innerHTML = '<div class="empty">Calcul en cours…</div>';
  const [D, ests] = await Promise.all([respData(uid, period), db.list('quote', { estimate: true }).then((l) => l.filter((q) => q.data.estimate))]);
  const k = D.k; const [from, to] = [D.from, D.to];
  const lastDay = addDays(today(), -1);
  const gridDays = ['sem', 'semp'].includes(period) ? daysOf(from, to).filter((d) => isWorkday(d) || D.hours.some((t) => t.data.date === d)) : [];
  // ce qu'il faut faire maintenant, en clair
  const todo = [];
  const late = D.people.filter((x) => x.missing.length);
  late.forEach((x) => todo.push({ tone: 'late', icon: 'clock', t: `${x.e.data.name} n'a pas encodé ses heures`, s: x.missing.map((d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric' })).join(', '), btn: ['Voir le pointage', 'href', '#/hr/timesheets'] }));
  D.rows.filter((r) => r.toBill > 0.5).forEach((r) => todo.push({ tone: 'money', icon: 'coins', t: `${r.p.data.name} : ${money(r.toBill)} à facturer`, s: `${pctTxt(r.pc.v)} du travail fait, ${money(r.f.invoiced)} déjà facturé`, btn: isChef() ? ['Demander la facture', 'breq', r.p.id] : ['Facturer', 'bill', r.p.id] }));
  D.rows.filter((r) => ['preparation', 'encours', 'reception'].includes(r.p.data.status) && (!r.p.data.progressAt || r.p.data.progressAt < addDays(today(), -7))).forEach((r) => todo.push({ tone: 'todo', icon: 'percent', t: `Où en est « ${r.p.data.name} » ?`, s: r.p.data.progressAt ? `Avancement indiqué le ${fmtDate(r.p.data.progressAt)} : mettez-le à jour` : 'Indiquez le % de travail fait (pour savoir quoi facturer)', btn: ['Indiquer le %', 'pct', r.p.id] }));
  D.rows.filter((r) => r.p.data.end && r.p.data.end < today() && !['termine', 'annule'].includes(r.p.data.status)).forEach((r) => todo.push({ tone: 'late', icon: 'calendar', t: `« ${r.p.data.name} » devait finir le ${fmtDate(r.p.data.end)}`, s: 'Terminé ? Changez son statut. Sinon, donnez une nouvelle date de fin.', btn: ['Ouvrir', 'href', `#/project/${r.p.id}`] }));
  D.people.filter((x) => x.h && x.margin < -0.5).forEach((x) => todo.push({ tone: 'late', icon: 'helmet', t: `${x.e.data.name} n'est pas rentable sur la période`, s: `rapporte ${money(x.prod / x.h)}/h mais coûte ${money(x.cost / x.h)}/h`, btn: ['Voir ses heures', 'href', `#/crew/e/${x.e.id}`] }));
  ests.filter((q) => (isChef() ? q.created_by === S.me.id && q.data.estStatus === 'a_revoir' : q.data.estStatus === 'soumis' && (!uid || q.created_by === uid))).forEach((q) => todo.push({ tone: 'todo', icon: 'calc', t: isChef() ? `Estimatif à revoir : ${q.data.title || q.number}` : `Estimatif à vérifier : ${q.data.title || q.number}`, s: isChef() ? (q.data.estNote || 'Le bureau a une remarque') : `de ${userName(q.created_by)} · ${money(totals(q.data).base)} HT`, btn: [isChef() ? 'Ouvrir' : 'Vérifier', 'href', `#/quote/${q.id}`] }));
  if (isChef() && !D.m.mgrreport.some((r) => r.created_by === S.me.id && r.data.date >= from)) todo.push({ tone: 'todo', icon: 'send', t: 'Envoyez votre rapport au patron', s: 'Un clic : il reçoit tous ces chiffres en PDF', btn: ['Envoyer le rapport', 'rep', 0] });
  const gain = k.prod - k.cost;
  const verdict = (x) => (!x.h ? ['Pas d\'heures', '#868e96'] : x.margin < -0.5 ? ['Pas rentable', '#e5484d'] : x.prod < x.cost * 1.15 ? ['Juste', '#e8590c'] : ['Rentable', '#2f9e44']);
  const bar = (v, c) => `<div class="meter" style="--c:${c}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
  page.innerHTML = `
    ${isChef() ? '' : `<div class="chips" style="margin-bottom:10px">${[[0, 'Toute l\'entreprise'], ...chefs.map((u) => [u.id, u.name])].map(([v, l]) => `<button class="chip ${v === uid ? 'on' : ''}" data-u="${v}">${esc(l)}</button>`).join('')}
      ${!chefs.length ? '<small class="muted">Aucun responsable : créez son accès dans Paramètres → Utilisateurs (rôle « Responsable d\'équipe / d\'atelier »).</small>' : ''}</div>`}
    <div class="chips" style="margin-bottom:12px">${RESP_PERIODS.filter(([v]) => !['an', 'moisp'].includes(v)).map(([v, l]) => `<button class="chip ${v === period ? 'on' : ''}" data-p="${v}">${l}</button>`).join('')}</div>
    ${ui.respHelp ? '' : `<div class="hint-box rs-help"><b>Comment ça marche ?</b><ol><li>L'équipe encode ses heures sur le téléphone (2 touches). Quelqu'un n'y arrive pas ? Touchez « ＋ Heures » à côté de son nom et pointez pour lui.</li><li>${isChef() ? 'Vous indiquez' : 'Le responsable indique'} le <b>%</b> de travail fait sur chaque projet.</li><li>L'application calcule ce qu'il faut facturer et qui est rentable. ${isChef() ? 'Vous demandez la facture au bureau et envoyez votre rapport.' : 'Vous recevez ses demandes de facture et ses rapports.'}</li></ol><button class="btn sm" data-act="helpok">J'ai compris</button></div>`}
    ${D.noTeam ? `<div class="hint-box" style="margin-bottom:12px">Aucune personne n'est encore rattachée à ${isChef() ? 'vous' : 'ce responsable'} : tout le personnel est affiché. ${isChef() ? 'Demandez au bureau de vous attribuer votre équipe.' : '<button class="btn sm" data-act="team">Choisir son équipe</button>'}</div>` : (!isChef() && uid ? '<div style="margin:-4px 0 10px"><button class="btn sm" data-act="team">Modifier son équipe</button></div>' : '')}
    <div class="rs-big">
      <div class="rs-n"><small>Heures travaillées</small><b>${fnum(k.hours, 1)} h</b><span>${k.missing ? `<em class="bad">${k.missing} jour(s) sans heures</em>` : 'tout le monde a pointé ✓'}</span></div>
      <div class="rs-n"><small>À facturer maintenant</small><b style="color:${k.toBill > 0.5 ? '#e8590c' : 'inherit'}">${money(k.toBill)}</b><span>${k.toBill > 0.5 ? 'travail fait, pas encore facturé' : k.asked ? `${money(k.asked)} déjà demandé au bureau` : 'rien en attente ✓'}</span></div>
      <div class="rs-n"><small>${gain < -0.5 ? 'Perdu' : 'Gagné'} ${esc(RESP_PERIODS.find(([v]) => v === period)[1].toLowerCase())}</small><b style="color:${gain < -0.5 ? '#e5484d' : '#2f9e44'}">${money(Math.abs(gain))}</b><span>l'équipe a produit ${money(k.prod)} et coûté ${money(k.cost)}</span></div>
    </div>
    <div class="card"><div class="card-h"><h3>${todo.length ? `À faire (${todo.length})` : 'À faire'}</h3></div>
      ${todo.length ? `<div class="rs-todo">${todo.map((x, i) => `<div class="rs-t rs-k-${x.tone}"><span class="rs-ic">${I[x.icon] || ''}</span><span class="grow"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span><button class="btn sm ${x.tone === 'money' ? 'primary' : ''}" data-todo="${i}">${esc(x.btn[0])}</button></div>`).join('')}</div>` : '<div class="empty sm">Tout est en ordre 👍</div>'}</div>
    <div class="card"><div class="card-h"><h3>Projets</h3></div>
      ${D.rows.length ? `<div class="rs-cards">${D.rows.sort((a, b) => b.toBill - a.toBill).map((r) => `<div class="rs-card">
        <a href="#/project/${r.p.id}" class="rs-ct"><b>${esc(r.p.data.name)}</b><small>${esc(r.client !== '—' ? r.client : '')}${r.p.data.end ? ` · fin ${fmtDate(r.p.data.end)}` : ''}</small></a>
        <div class="rs-line"><span>Travail fait</span><button class="btn sm" data-pct="${r.p.id}">${pctTxt(r.pc.v)} ${I.edit}</button></div>${bar(r.pc.v, '#1c2550')}
        ${r.f.budget ? `<div class="rs-line"><span>Facturé</span><b>${money(r.f.invoiced)} <small class="muted">sur ${money(r.f.budget)}</small></b></div>${bar(r.f.invoiced / r.f.budget * 100, '#2f9e44')}
        <div class="rs-line"><span>Dépensé</span><small>achats ${money(r.f.real - (r.f.realBy.mo || 0))} · main d'œuvre ${money(r.f.realBy.mo || 0)}</small></div>
        <div class="rs-line"><span>${r.margin < -0.5 ? 'Perte' : 'Bénéfice'} à ce jour</span><b style="color:${r.margin < -0.5 ? '#e5484d' : '#2f9e44'}">${money(Math.abs(r.margin))}</b></div>`
    : `<div class="rs-line"><small class="muted">Pas encore de devis accepté : le bénéfice sera calculé dès qu'il y en a un. Dépensé : ${money(r.f.real)} · ${fnum(r.f.hours, 1)} h</small></div>`}
        ${r.toBill > 0.5 ? `<button class="btn primary rs-go" data-${isChef() ? 'breq' : 'bill'}="${r.p.id}">${isChef() ? `Demander la facture : ${money(r.toBill)}` : `Facturer ${money(r.toBill)}`}</button>` : r.asked ? `<div class="rs-line"><small class="muted">${money(r.asked)} demandé au bureau, en attente</small></div>` : ''}
      </div>`).join('')}</div>` : '<div class="empty sm">Aucun projet en cours.</div>'}</div>
    <div class="card"><div class="card-h"><h3>L'équipe</h3><a class="btn sm" href="#/hr/timesheets">Toutes les heures</a></div>
      ${D.people.length ? `<div class="rs-people">${D.people.sort((a, b) => b.margin - a.margin).map((x) => { const v = verdict(x); return `<div class="rs-p"><a class="grow rs-pn" href="#/crew/e/${x.e.id}"><span><b>${esc(x.e.data.name)}</b><small>${fnum(x.h, 1)} h${x.h ? ` · rapporte ${money(x.prod / x.h)}/h, coûte ${money(x.cost / x.h)}/h` : ''}</small></span></a>${badge(v[0], v[1])}<button class="btn sm" data-ptr="${x.e.id}">＋ Heures</button></div>`; }).join('')}</div>` : '<div class="empty sm">Personne dans l\'équipe.</div>'}
      ${gridDays.length ? `<div class="dt-body rs-grid" style="margin-top:12px"><table class="dt resp-grid"><thead><tr><th>Heures par jour</th>${gridDays.map((d) => `<th class="r">${new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric' })}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
      ${D.people.map((x) => `<tr><td data-l="Personne"><b>${esc(x.e.data.name)}</b></td>${gridDays.map((d) => { const h = D.hours.filter((t) => +t.data.employeeId === x.e.id && t.data.date === d).reduce((a, t) => a + num(t.data.hours), 0); const abs = D.m.absence.some((a) => +a.data.employeeId === x.e.id && a.data.from <= d && a.data.to >= d);
        return `<td class="r rs-cell" data-cell="${x.e.id}|${d}" title="Pointer pour ${esc(x.e.data.name)}" data-l="${fmtDate(d)}">${h ? `<b>${fnum(h, 1)}</b>` : abs ? '<small class="muted">absent</small>' : d <= lastDay && d >= x.since && isWorkday(d) ? '<b style="color:#e5484d">✗</b>' : '<span class="muted">·</span>'}</td>`; }).join('')}<td class="r" data-l="Total"><b>${fnum(x.h, 1)} h</b></td></tr>`).join('')}</tbody></table></div>` : ''}</div>
    <div class="card"><div class="card-h"><h3>Les 14 prochains jours</h3><a class="btn sm" href="#/planning/team">Planning</a></div>
      ${D.ag.length ? `<div class="rows">${D.ag.map((x, i) => `${i === 0 || D.ag[i - 1].d !== x.d ? `<div class="mo-h" style="margin:10px 0 2px"><b>${esc(new Date(x.d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }))}</b></div>` : ''}<a class="row" href="${x.h}"><span>${I[x.icon] || ''}</span><span class="grow"><b>${x.t ? `${esc(x.t)} · ` : ''}${esc(x.l)}</b>${x.s ? `<small class="muted">${esc(x.s)}</small>` : ''}</span></a>`).join('')}</div>` : '<div class="empty sm">Rien de planifié.</div>'}</div>
    <details class="card rs-more"${ui.respMore ? ' open' : ''}><summary><b>Voir tous les chiffres</b> <small class="muted">tableaux détaillés : montants, encaissé, coûts, heures</small></summary>
      <div class="kpis" style="margin-top:12px">${kpi('Reste à facturer', money(k.rest), { sub: 'sur les projets en cours' })}${kpi('Facturé sur la période', money(k.invoicedPer), { sub: `encaissé ${money(k.cashedPer)}` })}${kpi('Bénéfice des projets', signMoney(k.margin), { sub: 'à ce jour' })}</div>
    <h3 class="mo-h">Projets</h3>
      ${D.rows.length ? `<div class="dt-body"><table class="dt"><thead><tr><th>Projet</th><th>Période</th><th class="r">Avancement</th><th class="r">Montant HT</th><th class="r">Facturé HT</th><th class="r">Encaissé</th><th class="r">À facturer</th><th class="r">Heures</th><th class="r">Coûts</th><th class="r">Marge</th><th></th></tr></thead><tbody>
        ${D.rows.sort((a, b) => b.toBill - a.toBill).map((r) => `<tr><td data-l="Projet"><a href="#/project/${r.p.id}"><b>${esc(r.p.data.name)}</b></a><br><small class="muted">${esc(r.client !== '—' ? r.client : '')} ${st(PST, r.p.data.status)}</small></td>
          <td data-l="Période"><small>${r.p.data.start ? fmtDate(r.p.data.start) : '—'} → ${r.p.data.end ? `<span style="color:${r.p.data.end < today() && r.p.data.status !== 'termine' ? '#e5484d' : 'inherit'}">${fmtDate(r.p.data.end)}</span>` : '—'}</small></td>
          <td data-l="Avancement" class="r"><button class="btn sm" data-pct="${r.p.id}" title="${esc(r.pc.src)}">${pctTxt(r.pc.v)}</button><br><small class="muted">${esc(r.pc.src)}</small></td>
          <td data-l="Montant HT" class="r">${money(r.f.budget)}</td><td data-l="Facturé HT" class="r">${money(r.f.invoiced)}</td><td data-l="Encaissé" class="r">${money(r.f.cashed)}</td>
          <td data-l="À facturer" class="r">${r.toBill > 0.5 ? `<b style="color:#e8590c">${money(r.toBill)}</b>` : '—'}${r.asked ? `<br><small class="muted">${money(r.asked)} demandé</small>` : ''}</td>
          <td data-l="Heures" class="r">${fnum(r.f.hours, 1)} h${r.hPer ? `<br><small class="muted">${fnum(r.hPer, 1)} h période</small>` : ''}</td><td data-l="Coûts" class="r">${money(r.f.real)}</td><td data-l="Marge" class="r">${signMoney(r.margin)}</td>
          <td>${r.toBill > 0.5 && isChef() ? `<button class="btn sm primary" data-breq="${r.p.id}">Demander</button>` : r.toBill > 0.5 ? `<button class="btn sm primary" data-bill="${r.p.id}">Facturer</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h3 class="mo-h">Rentabilité par personne</h3>
      ${D.people.length ? `<div class="dt-body"><table class="dt"><thead><tr><th>Personne</th><th class="r">Heures</th><th class="r">Occupation</th><th class="r">Coût</th><th class="r">Produit</th><th class="r">Marge</th><th class="r">Produit / h</th><th>Projets</th></tr></thead><tbody>
        ${D.people.sort((a, b) => b.margin - a.margin).map((x) => `<tr><td data-l="Personne"><a href="#/crew/e/${x.e.id}"><b>${esc(x.e.data.name)}</b></a>${x.missing.length ? `<br><small style="color:#e5484d">${x.missing.length} jour(s) sans heures</small>` : ''}</td>
          <td data-l="Heures" class="r">${fnum(x.h, 1)} h${x.loose ? `<br><small class="muted">${fnum(x.loose, 1)} h hors projet</small>` : ''}</td><td data-l="Occupation" class="r">${x.expected ? pctTxt(x.h / x.expected * 100) : '—'}</td>
          <td data-l="Coût" class="r">${money(x.cost)}</td><td data-l="Produit" class="r">${money(x.prod)}</td><td data-l="Marge" class="r"><b>${signMoney(x.margin)}</b></td><td data-l="Produit / h" class="r">${x.h ? `${money(x.prod / x.h)}<br><small class="muted">coût ${money(x.cost / x.h)}</small>` : '—'}</td>
          <td data-l="Projets"><small>${Object.entries(x.byP).sort((a, b) => b[1] - a[1]).map(([pid, h]) => `${esc(+pid ? (byId(D.m.project, +pid) || { data: { name: '?' } }).data.name : 'autre chantier / hors projet')} ${fnum(h, 1)} h`).join(' · ') || '—'}</small></td></tr>`).join('')}</tbody></table></div>
        <p class="muted sm" style="margin-top:8px">Produit = heures × valeur d'une heure sur chaque projet (montant réalisé selon l'avancement, moins les achats, divisé par toutes les heures du projet). Coût = heures × coût horaire chargé de la fiche. Une marge négative : le projet consomme plus d'heures que prévu.</p>` : '<div class="empty sm">Personne dans l\'équipe.</div>'}
    </details>`;
  // le responsable pointe pour quelqu'un (pas de téléphone, pas à l'aise) : le jour, puis chantier et heures en grands boutons
  const pointFor = (eid, day) => respPointFor(D, eid, day);
  $$('[data-ptr]', page).forEach((b) => { b.onclick = () => pointFor(+b.dataset.ptr); });
  $$('[data-cell]', page).forEach((c) => { c.onclick = () => { const [eid, d2] = c.dataset.cell.split('|'); pointFor(+eid, d2); }; });
  const td = $('[data-act=helpok]', page); if (td) td.onclick = () => { ui.respHelp = 1; saveUi(); render(); };
  const more = $('.rs-more', page); if (more) more.ontoggle = () => { ui.respMore = more.open; saveUi(); };
  $$('[data-todo]', page).forEach((b) => { b.onclick = () => { const [, a, v] = todo[+b.dataset.todo].btn; if (a === 'href') go(v); if (a === 'pct') respSetPct(byId(D.projects, v)); if (a === 'rep') respNewReport(uid);
    if (a === 'breq') { const r = D.rows.find((x) => x.p.id === v); billRequest(r.p, { amount: r2(r.toBill), pct: r2(r.pc.v), budget: r.f.budget, invoiced: r.f.invoiced + r.asked }); }
    if (a === 'bill') respBill(D.rows.find((x) => x.p.id === v)); }; });
  $$('[data-u]', page).forEach((b) => { b.onclick = () => go(`#/resp?u=${b.dataset.u}`); });
  $$('[data-p]', page).forEach((b) => { b.onclick = () => { ui.respP = b.dataset.p; saveUi(); render(); }; });
  $$('[data-pct]', page).forEach((b) => { b.onclick = () => respSetPct(byId(D.projects, +b.dataset.pct)); });
  $$('[data-breq]', page).forEach((b) => { b.onclick = () => { const r = D.rows.find((x) => x.p.id === +b.dataset.breq); billRequest(r.p, { amount: r2(r.toBill), pct: r2(r.pc.v), budget: r.f.budget, invoiced: r.f.invoiced + r.asked }); }; });
  $$('[data-bill]', page).forEach((b) => { b.onclick = () => respBill(D.rows.find((x) => x.p.id === +b.dataset.bill)); });
  $('[data-act=rep]').onclick = () => respNewReport(uid);
  const br = $('[data-act=breq]'); if (br) br.onclick = () => billRequest();
  const tm = $('[data-act=team]', page); if (tm) tm.onclick = () => respTeamPicker(uid, D.m.employee);
});

// le responsable pointe pour quelqu'un (pas de téléphone, pas à l'aise) : le jour, puis chantier et heures en grands boutons
async function respPointFor(D, eid, day) {
  const e = D.people.find((x) => x.e.id === eid).e;
  if (!day) {
    const days = daysOf(addDays(today(), -6), today()).filter((d2) => isWorkday(d2) || d2 === today()).reverse();
    return menuSheet(rz('whichDay').replace('{n}', e.data.name), days.map((d2) => ({ label: `${rzDate(d2, { weekday: 'long', day: 'numeric', month: 'long' })}${D.hours.some((t) => +t.data.employeeId === eid && t.data.date === d2) ? ' ✓' : ''}`, primary: d2 === today(), run: () => respPointFor(D, eid, d2) })));
  }
  const r = await pointPick({ title: `${e.data.name} – ${rzDate(day, { weekday: 'long', day: 'numeric' })} : ${rz('where')}`, projects: D.projects.filter((p) => !['termine', 'annule'].includes(p.data.status)), lang: rzLang(), def: num(e.data.dayHours) || 8 });
  if (!r) return;
  await persist('timesheet', { project_id: r.pid, data: { employeeId: e.id, who: e.data.name, date: day, hours: r.hours, rate: num(e.data.costRate), task: '', byChef: S.me.id, ...(r.pid ? {} : { site: r.site }) } }, { silent: true });
  toast(`${fnum(r.hours, 1)} h ${rz('hSaved')} ${e.data.name} ✓`, 3000); render();
}
// ---------------------------------------------------------------- Textes de l'accueil du responsable : français ou roumain (bouton 🌐)
const RZ = {
  hello: ['Bonjour', 'Bună'], team: ["Mon équipe aujourd'hui", 'Echipa mea azi'], hToday: ["h aujourd'hui", 'ore azi'], week: ['cette semaine', 'săptămâna asta'],
  absent: ['absent', 'absent'], notYet: ['pas encore pointé', 'n-a pontat încă'], missDay: ['rien pointé', 'nimic pontat'], moreDays: ['jour(s)', 'zi(le)'],
  addH: ['＋ Heures', '＋ Ore'], noTeam: ["Personne dans votre équipe : demandez au bureau de vous l'attribuer.", 'Nimeni în echipa ta: cere biroului să ți-o atribuie.'],
  projects: ['Mes projets et planning', 'Proiectele mele și planningul'], done: ['fait', 'gata'], change: ['changer', 'schimbă'],
  bill: ['Demander la facture', 'Cere factura'], asked: ['✓ Facture demandée au bureau', '✓ Factură cerută la birou'],
  loses: ["⚠ Ce projet perd de l'argent : trop d'heures ou d'achats", '⚠ Proiectul pierde bani: prea multe ore sau achiziții'],
  noProj: ["Aucun projet pour l'instant.", 'Niciun proiect deocamdată.'], send: ['Envoyer', 'Trimite'],
  report: ['Envoyer mon rapport de la semaine au patron', 'Trimite raportul săptămânii la patron'], reportSent: ['✓ Rapport envoyé cette semaine — en renvoyer un', '✓ Raport trimis săptămâna asta — trimite din nou'],
  est: ['＋ Faire un estimatif', '＋ Fă un estimativ'], estBack: ['Estimatif à revoir', 'Estimativ de revăzut'], estNote: ['Le bureau a une remarque', 'Biroul are o observație'],
  from: ['du', 'de la'], to: ['au', 'până la'], endIn: ['fin dans {n} jour(s)', 'se termină în {n} zi(le)'], endToday: ["fin prévue aujourd'hui", 'se termină azi'],
  endPassed: ['⚠ date de fin dépassée', '⚠ termenul de final a trecut'], late: ['⚠ en retard sur le planning', '⚠ în urmă față de planning'], notStarted: ['commence le', 'începe pe'],
  thisWeek: ['Cette semaine', 'Săptămâna asta'],
  myProjects: ['Mes projets', 'Proiectele mele'], finishedP: ['Terminé', 'Terminat'], toBill: ['à facturer :', 'de facturat:'], noProjT: ['Aucun projet pour vous', 'Niciun proiect pentru tine'],
  noProjS: ['Le bureau vous attribue vos projets. Ils apparaîtront ici.', 'Biroul îți atribuie proiectele. Vor apărea aici.'], hoursHere: ['Heures ici cette semaine', 'Ore aici săptămâna asta'],
  noHoursHere: ['Pas encore d\'heures cette semaine.', 'Încă nicio oră săptămâna asta.'], total: ['Depuis le début', 'De la început'], plans: ['Plans', 'Planuri'], photos: ['Photos et rapports', 'Poze și rapoarte'],
  docs: ['Documents', 'Documente'], estHere: ['Estimatif pour ce projet', 'Estimativ pentru acest proiect'], myEst: ['Mes estimatifs', 'Estimativele mele'],
  estDone: ['Devenu le devis', 'A devenit devizul'], estSent: ['Envoyé au bureau – en attente', 'Trimis la birou – în așteptare'], estDraft: ['En préparation', 'În lucru'], noEst: ['Pas encore d\'estimatif.', 'Încă niciun estimativ.'],
  myTeam: ['Mon équipe', 'Echipa mea'], teamPlan: ['Planning de l\'équipe', 'Planningul echipei'], sentT: ['Factures et rapports', 'Facturi și rapoarte'], reqs: ['Factures demandées', 'Facturi cerute'],
  billed: ['Facturée', 'Facturată'], waiting: ['En attente au bureau', 'În așteptare la birou'], noReqs: ['Aucune demande pour l\'instant.', 'Nicio cerere deocamdată.'], reps: ['Rapports envoyés', 'Rapoarte trimise'],
  open: ['ouvrir', 'deschide'], noReps: ['Aucun rapport envoyé.', 'Niciun raport trimis.'], now: ['En cours', 'Acum se lucrează la'], nobody: ['personne de prévu', 'nimeni planificat'], next: ['Prochaine étape', 'Următoarea etapă'], noDates: ['dates pas encore fixées', 'date încă nefixate'],
  diagram: ['Voir le planning en diagramme', 'Vezi planningul ca diagramă'],
  howMuch: ['Combien du travail est fait ?', 'Cât din lucrare e gata?'], finished: ['✓ Terminé : 100 %', '✓ Terminat: 100 %'], pctSaved: ['Avancement enregistré ✓', 'Avans salvat ✓'],
  whichDay: ['Heures de {n} : quel jour ?', 'Orele lui {n}: ce zi?'], where: ['où ?', 'unde?'], hSaved: ['h enregistrées pour', 'ore salvate pentru'],
  billT: ['Demander une facture', 'Cere o factură'], amount: ['Montant à facturer (hors TVA)', 'Suma de facturat (fără TVA)'], what: ["Qu'est-ce qui a été fait ? (facultatif)", 'Ce s-a făcut? (opțional)'],
  calc: ['Calcul : {a} de {b} = {c}, moins {d} déjà facturé.', 'Calcul: {a} din {b} = {c}, minus {d} deja facturat.'], reqSent: ['Demande envoyée au bureau ✓', 'Cerere trimisă la birou ✓'],
  repT: ['Rapport de la semaine', 'Raportul săptămânii'], msg: ['Un message pour le patron ? (facultatif)', 'Un mesaj pentru patron? (opțional)'], msgPh: ['Problèmes, retards, matériel à commander…', 'Probleme, întârzieri, material de comandat…'],
  repHint: ["Le rapport contient tout seul les heures, les projets, ce qu'il faut facturer et le planning.", 'Raportul conține singur orele, proiectele, ce e de facturat și planningul.'], repSent: ['Rapport envoyé au patron ✓', 'Raport trimis la patron ✓'],
  nav: [['Accueil', 'Projets', 'Équipe', 'Factures et rapports', 'Estimatifs', 'Heures', 'Planning', 'Absences', 'Demandes de facture', 'Rapports au patron', 'Tâches'], ['Acasă', 'Proiecte', 'Echipa', 'Facturi și rapoarte', 'Estimative', 'Ore', 'Planning', 'Absențe', 'Cereri de factură', 'Rapoarte la patron', 'Sarcini']],
};
const rzBtns = (send) => (rzLang() === 'ro' ? { ok: send ? 'Trimite' : 'Trimite cererea', cancel: 'Anulează' } : { ok: send ? 'Envoyer' : 'Envoyer la demande', cancel: 'Annuler' });
const rzLang = () => (tLang() === 'ro' ? 'ro' : 'fr');
const rz = (k) => (RZ[k] || [k, k])[rzLang() === 'ro' ? 1 : 0];
const rzDate = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString(rzLang() === 'ro' ? 'ro-RO' : 'fr-BE', o);
// avancement en grands boutons (10 % … 100 %)
function respSetPct(p) {
  const cur = p.data.progress;
  const m = modal(`<div class="pp"><div class="pp-top"><button class="pp-x" data-x>✕</button><b class="pp-where">${esc(p.data.name)}</b></div><h2 class="pp-q">${rz('howMuch')}</h2>
    <div class="pp-hours">${[10, 20, 30, 40, 50, 60, 70, 80, 90].map((v) => `<button class="pp-h ${+cur === v ? 'def' : ''}" data-v="${v}">${v} %</button>`).join('')}</div>
    <button class="pp-ok" data-v="100">${rz('finished')}</button></div>`, { full: true }); m.el.classList.add('pp-modal');
  $('[data-x]', m.el).onclick = () => m.close();
  $$('[data-v]', m.el).forEach((b) => { b.onclick = async () => {
    p.data.progress = +b.dataset.v; p.data.progressAt = today(); p.data.progressBy = S.me.id;
    await persist('project', p, { silent: true }); m.close(); toast(rz('pctSaved')); render();
  }; });
}
// planning d'un projet en quelques lignes : dates, retard, qui cette semaine, étape en cours et suivante
function respPlan(D, r) {
  const ename = (eid) => (byId(D.m.employee, eid) || { data: {} }).data.name;
  const d = r.p.data; const t = today(); const out = [];
  if (d.start && d.end) {
    const left = Math.round(dnum(d.end) - dnum(t)); const tp = Math.max(0, Math.min(100, (dnum(t) - dnum(d.start)) / Math.max(1, dnum(d.end) - dnum(d.start)) * 100));
    out.push(`<div class="rz-dates">📅 ${rz('from')} <b>${esc(rzDate(d.start, { day: 'numeric', month: 'short' }))}</b> ${rz('to')} <b>${esc(rzDate(d.end, { day: 'numeric', month: 'short' }))}</b> · ${d.start > t ? `${rz('notStarted')} ${esc(rzDate(d.start, { weekday: 'long', day: 'numeric' }))}` : left > 0 ? rz('endIn').replace('{n}', left) : left === 0 ? rz('endToday') : ''}</div>`);
    if (left < 0) out.push(`<div class="rz-bad">${rz('endPassed')}</div>`);
    else if (d.start <= t && tp - r.pc.v > 15) out.push(`<div class="rz-bad">${rz('late')}</div>`);
  } else out.push(`<div class="rz-dates muted">📅 ${rz('noDates')}</div>`);
  const wk = (a, b) => a <= D.to && b >= D.from;
  const who = [...new Set([
    ...D.m.assign.filter((a) => a.project_id === r.p.id && wk(a.data.date, a.data.date)).map((a) => +a.data.employeeId),
    ...D.m.phase.filter((x) => x.project_id === r.p.id && x.data.start && x.data.end && wk(x.data.start, x.data.end)).flatMap((x) => (x.data.staff || []).map(Number)),
    ...D.hours.filter((h) => h.project_id === r.p.id).map((h) => +h.data.employeeId),
  ].map(ename).filter(Boolean))];
  out.push(`<div class="rz-who">👷 ${rz('thisWeek')} : ${who.length ? esc(who.join(', ')) : `<span class="muted">${rz('nobody')}</span>`}</div>`);
  const phs = D.m.phase.filter((x) => x.project_id === r.p.id && num(x.data.progress) < 100).sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const now = phs.filter((x) => x.data.start && x.data.start <= t && (x.data.end || '9') >= t);
  const nxt = phs.find((x) => x.data.start && x.data.start > t);
  if (now.length) out.push(`<div class="rz-who">🔨 ${rz('now')} : <b>${esc(now.map((x) => x.data.name).join(', '))}</b></div>`);
  if (nxt) out.push(`<div class="rz-who">➜ ${rz('next')} : <b>${esc(nxt.data.name)}</b> (${esc(rzDate(nxt.data.start, { weekday: 'short', day: 'numeric', month: 'short' }))})</div>`);
  return out.join('');
}
// ---------------------------------------------------------------- Accueil du responsable : 3 blocs, rien d'autre
// 1) mon équipe aujourd'hui  2) mes projets et leur planning (% fait → demander la facture)  3) envoyer
function respSimple(page, D, ests) {
  const wd = (d) => rzDate(d, { weekday: 'long' });
  const hOf = (eid, d) => D.hours.filter((t) => +t.data.employeeId === eid && t.data.date === d).reduce((a, t) => a + num(t.data.hours), 0);
  const abs = (eid, d) => D.m.absence.some((a) => +a.data.employeeId === eid && a.data.from <= d && a.data.to >= d);
  let tmw = addDays(today(), 1); while (!isWorkday(tmw)) tmw = addDays(tmw, 1);
  const pname = (pid) => (byId(D.m.project, pid) || { data: { name: 'Autre chantier' } }).data.name;
  const ename = (eid) => (byId(D.m.employee, eid) || { data: {} }).data.name;
  const tomorrow = D.people.map((x) => ({ x, a: D.m.assign.filter((a) => +a.data.employeeId === x.e.id && a.data.date === tmw) })).filter((y) => y.a.length);
  const back = ests.filter((q) => q.created_by === S.me.id && q.data.estStatus === 'a_revoir');
  const live = D.rows.filter((r) => !['termine', 'annule'].includes(r.p.data.status)).sort((a, b) => b.toBill - a.toBill);
  const sent = D.m.mgrreport.some((r) => r.created_by === S.me.id && r.data.date >= D.from);
  // planning d'un projet : dates, retard, qui cette semaine, prochaine étape
  const plan = (r) => respPlan(D, r);
  page.innerHTML = `
    <div class="rz-lang"><button class="pp-lang" data-lang>🌐 ${rzLang() === 'ro' ? 'Română' : 'Français'}</button></div>
    ${back.map((q) => `<a class="pp-miss" href="#/quote/${q.id}"><b>⚠ ${rz('estBack')} : ${esc(q.data.title || q.number)}</b><small>${esc(q.data.estNote || rz('estNote'))}</small></a>`).join('')}
    <section class="rz"><h2 class="rz-h">${I.helmet} ${rz('team')}</h2>
      ${D.people.length ? D.people.map((x) => { const h = hOf(x.e.id, today()); const a = abs(x.e.id, today()); const miss = x.missing;
        return `<div class="rz-p"><span class="rz-st ${h ? 'ok' : a ? 'off' : 'no'}">${h ? '✓' : a ? '–' : '?'}</span>
          <span class="grow"><b>${esc(x.e.data.name)}</b><small>${h ? `${fnum(h, 1)} ${rz('hToday')}` : a ? rz('absent') : rz('notYet')} · ${fnum(x.h, 1)} h ${rz('week')}</small>
          ${miss.length ? `<button class="rz-miss" data-pt="${x.e.id}|${miss[0]}">⚠ ${rz('missDay')} ${esc(wd(miss[0]))}${miss.length > 1 ? ` (+${miss.length - 1} ${rz('moreDays')})` : ''}</button>` : ''}</span>
          ${a ? '' : `<button class="rz-btn" data-pt="${x.e.id}|${today()}">${rz('addH')}</button>`}</div>`; }).join('') : `<p class="muted">${rz('noTeam')}</p>`}
      ${tomorrow.length ? `<div class="rz-tmw"><b>${esc(wd(tmw).replace(/^./, (c) => c.toUpperCase()))} :</b> ${tomorrow.map((y) => `${esc(y.x.e.data.name)} → ${esc([...new Set(y.a.map((a) => pname(a.project_id)))].join(', '))}`).join(' · ')}</div>` : ''}
    </section>
    <section class="rz"><h2 class="rz-h">${I.crane} ${rz('projects')}</h2>
      ${live.length ? live.map((r) => `<div class="rz-c">
        <a class="rz-t" href="#/project/${r.p.id}"><b>${esc(r.p.data.name)}</b>${r.client !== '—' ? `<small>${esc(r.client)}</small>` : ''}</a>
        ${plan(r)}
        <button class="rz-pct" data-pct="${r.p.id}"><span class="rz-bar"><i style="width:${Math.max(0, Math.min(100, r.pc.v))}%"></i></span><span class="rz-pv">${pctTxt(r.pc.v)} ${rz('done')}</span><span class="rz-ch">${rz('change')}</span></button>
        ${r.toBill > 0.5 ? `<button class="rz-bill" data-breq="${r.p.id}">${rz('bill')} · ${money(r.toBill)}</button>` : r.asked ? `<div class="rz-ok">${rz('asked')}</div>` : ''}
        ${r.f.budget && r.margin < -0.5 ? `<div class="rz-bad">${rz('loses')}</div>` : ''}
      </div>`).join('') : `<p class="muted">${rz('noProj')}</p>`}
      ${live.length ? `<a class="rz-link" href="#/planning/projects">📊 ${rz('diagram')}</a>` : ''}
    </section>
    <section class="rz"><h2 class="rz-h">${I.send} ${rz('send')}</h2>
      <button class="rz-big" data-act="rep2">${sent ? rz('reportSent') : rz('report')}</button>
      <button class="rz-big alt" data-act="est">${rz('est')}</button>
    </section>`;
  $('[data-lang]', page).onclick = () => menuSheet('Langue / Limba', [['fr', 'Français'], ['ro', 'Română']].map(([k, l]) => ({ label: l, primary: k === rzLang(), run: () => { try { localStorage.setItem('bp-tlang', k); } catch (e) { /* */ } render(); } })));
  $$('[data-pt]', page).forEach((b) => { b.onclick = () => { const [eid, d] = b.dataset.pt.split('|'); respPointFor(D, +eid, d); }; });
  $$('[data-pct]', page).forEach((b) => { b.onclick = () => respSetPct(byId(D.projects, +b.dataset.pct)); });
  $$('[data-breq]', page).forEach((b) => { b.onclick = () => { const r = D.rows.find((x) => x.p.id === +b.dataset.breq); billRequest(r.p, { amount: r2(r.toBill), pct: r2(r.pc.v), budget: r.f.budget, invoiced: r.f.invoiced + r.asked }); }; });
  $('[data-act=rep2]', page).onclick = () => respNewReport(S.me.id);
  $('[data-act=est]', page).onclick = () => newQuote();
}
// ---------------------------------------------------------------- Pages simples du responsable (cartes, grands boutons, FR / RO)
const respLoad = () => Promise.all([respData(S.me.id, 'sem'), db.list('quote', { estimate: true })]);
const rzPage = (title, icon) => { const page = layout({ title, icon }); page.innerHTML = `<div class="empty">${rzLang() === 'ro' ? 'Un moment…' : 'Un instant…'}</div>`; return page; };
const rzBar = (v) => `<span class="rz-bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>`;
// Mes projets : une carte par projet, on touche pour l'ouvrir
async function respProjects() {
  const page = rzPage(rz('myProjects'), 'crane');
  const [D] = await respLoad();
  const live = D.rows.filter((r) => r.p.data.status !== 'annule').sort((a, b) => (a.p.data.status === 'termine') - (b.p.data.status === 'termine') || b.toBill - a.toBill);
  page.innerHTML = live.length ? live.map((r) => `<a class="rz-c rz-link-c" href="#/resp/p/${r.p.id}">
      <span class="rz-t"><b>${esc(r.p.data.name)}</b><small>${esc([r.client !== '—' ? r.client : '', r.p.data.city].filter(Boolean).join(' · '))}</small></span>
      ${r.p.data.status === 'termine' ? `<span class="rz-ok">✓ ${rz('finishedP')}</span>` : respPlan(D, r)}
      <span class="rz-pct">${rzBar(r.pc.v)}<span class="rz-pv">${pctTxt(r.pc.v)} ${rz('done')}</span></span>
      ${r.toBill > 0.5 ? `<span class="rz-tag-bill">💶 ${rz('toBill')} ${money(r.toBill)}</span>` : ''}
    </a>`).join('') : `<div class="rz rz-empty"><b>${rz('noProjT')}</b><p>${rz('noProjS')}</p></div>`;
}
// Un projet : tout ce qu'il faut, rien de plus
async function respProject(pid) {
  const page = rzPage('…', 'crane');
  const [D] = await respLoad();
  const r = D.rows.find((x) => x.p.id === pid);
  if (!r) { page.innerHTML = `<div class="rz rz-empty"><b>${rz('noProjT')}</b></div>`; return; }
  const p = r.p; const d = p.data; const addr = [d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  $('.top-title h1').textContent = d.name;
  const wk = D.hours.filter((h) => h.project_id === p.id); const by = {}; wk.forEach((h) => { const n = (byId(D.m.employee, +h.data.employeeId) || { data: { name: h.data.who || '?' } }).data.name; by[n] = (by[n] || 0) + num(h.data.hours); });
  page.innerHTML = `<section class="rz">
      <a class="btn primary site-go" href="#/site/${p.id}">📍 Sur le chantier</a>
      ${r.client !== '—' ? `<div class="rz-who">👤 <b>${esc(r.client)}</b></div>` : ''}
      ${addr ? `<a class="rz-who" href="https://maps.google.com/?q=${encodeURIComponent(addr)}" target="_blank" rel="noopener">📍 ${esc(addr)}</a>` : ''}
      ${respPlan(D, r)}
      <button class="rz-pct" data-pct="${p.id}">${rzBar(r.pc.v)}<span class="rz-pv">${pctTxt(r.pc.v)} ${rz('done')}</span><span class="rz-ch">${rz('change')}</span></button>
      ${r.toBill > 0.5 ? `<button class="rz-bill" data-breq="${p.id}">${rz('bill')} · ${money(r.toBill)}</button>` : r.asked ? `<div class="rz-ok">${rz('asked')}</div>` : ''}
      ${r.f.budget && r.margin < -0.5 ? `<div class="rz-bad">${rz('loses')}</div>` : ''}
    </section>
    <section class="rz"><h2 class="rz-h">${I.clock} ${rz('hoursHere')}</h2>
      ${Object.keys(by).length ? Object.entries(by).map(([n, h]) => `<div class="rz-line"><span>${esc(n)}</span><b>${fnum(h, 1)} h</b></div>`).join('') : `<p class="muted">${rz('noHoursHere')}</p>`}
      <div class="rz-line muted"><span>${rz('total')}</span><span>${fnum(r.f.hours, 1)} h</span></div></section>
    <section class="rz rz-btns">
      <a class="rz-big alt" href="#/project/${p.id}/plans">📐 ${rz('plans')}</a>
      <a class="rz-big alt" href="#/project/${p.id}/reports">📷 ${rz('photos')}</a>
      <a class="rz-big alt" href="#/project/${p.id}/documents">📎 ${rz('docs')}</a>
      <button class="rz-big alt" data-est>＋ ${rz('estHere')}</button>
    </section>`;
  $('[data-pct]', page).onclick = () => respSetPct(p);
  const b = $('[data-breq]', page); if (b) b.onclick = () => billRequest(p, { amount: r2(r.toBill), pct: r2(r.pc.v), budget: r.f.budget, invoiced: r.f.invoiced + r.asked });
  $('[data-est]', page).onclick = () => newQuote({ projectId: p.id, clientId: d.clientId, title: d.name, siteAddress: addr });
}
// Mes estimatifs : où en est chacun
async function respEstimates() {
  const page = rzPage(rz('myEst'), 'calc');
  const all = await db.list('quote', { estimate: true });
  const mine = all.filter((q) => q.created_by === S.me.id && (q.data.estimate || q.data.fromEstimate)).sort((a, b) => b.id - a.id);
  const st = (q) => (!q.data.estimate ? [`✓ ${rz('estDone')} ${q.number}`, 'ok'] : q.data.estStatus === 'soumis' ? [rz('estSent'), 'wait'] : q.data.estStatus === 'a_revoir' ? [`⚠ ${rz('estBack')}`, 'bad'] : [rz('estDraft'), 'draft']);
  page.innerHTML = `<button class="rz-big" data-new>${rz('est')}</button>
    ${mine.length ? mine.map((q) => { const [l, c] = st(q); return `<a class="rz-c rz-link-c" href="#/quote/${q.id}"><span class="rz-t"><b>${esc(q.data.title || q.number)}</b><small>${esc(q.data.estimate ? q.number : q.data.fromEstimate.number)} · ${money(totals(q.data).base)} HT</small></span>
      <span class="rz-st2 ${c}">${l}</span>${q.data.estimate && q.data.estStatus === 'a_revoir' && q.data.estNote ? `<span class="rz-who">💬 ${esc(q.data.estNote)}</span>` : ''}</a>`; }).join('') : `<div class="rz rz-empty"><p>${rz('noEst')}</p></div>`}`;
  $('[data-new]', page).onclick = () => newQuote();
}
// Mon équipe : la semaine de chacun, case par case ; toucher une case = pointer pour lui
async function respTeam() {
  const page = rzPage(rz('myTeam'), 'helmet');
  const [D] = await respLoad();
  const days = daysOf(D.from, D.to).filter((d) => isWorkday(d));
  const abs = (eid, d) => D.m.absence.some((a) => +a.data.employeeId === eid && a.data.from <= d && a.data.to >= d);
  page.innerHTML = D.people.length ? D.people.map((x) => `<div class="rz">
      <div class="rz-p"><span class="grow"><b>${esc(x.e.data.name)}</b><small>${fnum(x.h, 1)} h ${rz('week')}</small></span><button class="rz-btn" data-pt="${x.e.id}|${today()}">${rz('addH')}</button></div>
      <div class="rz-days">${days.map((d) => { const h = D.hours.filter((t) => +t.data.employeeId === x.e.id && t.data.date === d).reduce((a, t) => a + num(t.data.hours), 0); const fut = d > today() || d < x.since; const a = abs(x.e.id, d);
        return `<button class="rz-day ${h ? 'ok' : a ? 'off' : fut || d === today() ? 'fut' : 'no'}" ${fut ? 'disabled' : `data-pt="${x.e.id}|${d}"`}><small>${esc(rzDate(d, { weekday: 'short' }))}</small><b>${h ? fnum(h, 1) : a ? '–' : fut ? '' : d === today() ? '?' : '✗'}</b></button>`; }).join('')}</div>
    </div>`).join('') + `<a class="rz-big alt" href="#/planning/team">📅 ${rz('teamPlan')}</a>` : `<div class="rz rz-empty"><p>${rz('noTeam')}</p></div>`;
  $$('[data-pt]', page).forEach((b) => { b.onclick = () => { const [eid, d] = b.dataset.pt.split('|'); respPointFor(D, +eid, d); }; });
}
// Ce que j'ai envoyé : demandes de facture et rapports
async function respSent() {
  const page = rzPage(rz('sentT'), 'send');
  const [reqs, reps, projects] = await Promise.all([db.list('billreq'), db.list('mgrreport'), db.list('project')]);
  const rq = reqs.filter((r) => r.created_by === S.me.id && r.data.status !== 'annulee').sort((a, b) => b.id - a.id);
  const rp = reps.filter((r) => r.created_by === S.me.id).sort((a, b) => b.id - a.id).slice(0, 10);
  page.innerHTML = `<section class="rz"><h2 class="rz-h">${I.coins} ${rz('reqs')}</h2>
      ${rq.length ? rq.map((r) => `<div class="rz-line"><span><b>${esc((byId(projects, r.project_id) || { data: { name: '—' } }).data.name)}</b><small class="muted"> · ${fmtDate(r.data.date)}</small><br><span class="rz-st2 ${r.data.status === 'facturee' ? 'ok' : 'wait'}">${r.data.status === 'facturee' ? `✓ ${rz('billed')} ${esc(r.data.invoiceNumber || '')}` : rz('waiting')}</span></span><b>${money(num(r.data.amount))}</b></div>`).join('') : `<p class="muted">${rz('noReqs')}</p>`}
    </section>
    <section class="rz"><h2 class="rz-h">${I.send} ${rz('reps')}</h2>
      ${rp.length ? rp.map((r) => `<a class="rz-line" href="#/resp/rapport/${r.id}"><span>${fmtDate(r.data.date)}</span><span class="rz-ch">${rz('open')}</span></a>`).join('') : `<p class="muted">${rz('noReps')}</p>`}
      <button class="rz-big" data-rep>${rz('report')}</button>
    </section>`;
  $('[data-rep]', page).onclick = () => respNewReport(S.me.id);
}
// patron : rattacher des personnes à un responsable
function respTeamPicker(uid, employees) {
  const act = employees.filter((e) => e.data.active !== false);
  formModal({ title: `Équipe de ${userName(uid)}`, values: { ids: act.filter((e) => +e.data.chefId === uid).map((e) => e.id) },
    fields: [{ name: 'ids', label: 'Personnes dont il est responsable', type: 'multi', options: act.map((e) => [e.id, `${e.data.name}${e.data.chefId && +e.data.chefId !== uid ? ` (actuellement : ${userName(+e.data.chefId)})` : ''}`]), cls: 'full' }],
    async onSave(v) {
      const ids = (v.ids || []).map(Number);
      for (const e of act) {
        const want = ids.includes(e.id); const has = +e.data.chefId === uid;
        if (want && !has) { e.data.chefId = uid; await persist('employee', e, { silent: true }); }
        if (!want && has) { delete e.data.chefId; await persist('employee', e, { silent: true }); }
      }
      toast('Équipe enregistrée'); render();
    } });
}

// ---------------------------------------------------------------- Demandes de facture (responsable → bureau)
async function billRequest(p, pre = {}) {
  const projects = p ? [p] : (await db.list('project')).filter((x) => ['preparation', 'encours', 'reception', 'termine'].includes(x.data.status));
  const calc = pre.budget ? rz('calc').replace('{a}', pctTxt(pre.pct)).replace('{b}', money(pre.budget)).replace('{c}', money(pre.budget * pre.pct / 100)).replace('{d}', money(pre.invoiced)) : '';
  const v = await ask(p ? `${rz('billT')} – ${p.data.name}` : rz('billT'), [
    ...(p ? [] : [{ name: 'pid', label: 'Quel projet ?', type: 'select', required: true, options: [['', '— choisir —'], ...projects.map((x) => [x.id, x.data.name])] }]),
    { name: 'amount', label: rz('amount'), type: 'money', required: true, hint: calc },
    { name: 'note', label: rz('what'), type: 'textarea', placeholder: rzLang() === 'ro' ? 'Ex.: mobila de bucătărie montată, rămâne blatul' : 'Ex. : meubles de cuisine posés, reste le plan de travail' },
  ], pre, rzBtns());
  if (!v) return;
  const pid = p ? p.id : +v.pid; if (!pid) return toast('Choisissez le projet', 3000);
  if (!(num(v.amount) > 0)) return toast('Indiquez le montant à facturer', 3000);
  const pct = pre.pct != null ? num(pre.pct) : null;
  await persist('billreq', { project_id: pid, data: { date: today(), kind: pct != null && pct >= 99.5 ? 'solde' : pct != null ? 'avancement' : 'autre', amount: r2(num(v.amount)), pct, note: v.note || '', status: 'demandee', by: S.me.id } });
  toast(rz('reqSent'), 3000); render();
}
// bureau : faire la facture demandée (liée à la demande : elle passe « facturée » quand la facture est soumise)
async function respBill(r, req) {
  const p = r ? r.p : await db.get('project', req.project_id);
  const quotes = (await db.list('quote', { project: p.id })).filter((q) => q.data.status === 'accepte' && !q.data.avenantOf);
  const amount = req ? num(req.data.amount) : r2(r.toBill);
  const free = () => newInvoice({ project_id: p.id, data: { clientId: p.data.clientId, title: p.data.name, kind: req && req.data.kind === 'acompte' ? 'acompte' : 'facture', billreqId: req ? req.id : undefined,
    lines: [{ id: lid(), kind: 'item', desc: `${req ? BRQ_KIND[req.data.kind] || 'Travaux' : 'Travaux'} – ${p.data.name}${req && req.data.note ? `\n${req.data.note}` : ''}`, unit: 'forfait', qty: 1, price: amount, vat: defVat(), type: 'divers' }] } });
  menuSheet(`Facturer ${money(amount)} HT – ${p.data.name}`, [
    ...quotes.map((q) => ({ label: `Depuis le devis ${q.number} (état d'avancement, acompte, solde…)`, icon: 'calc', primary: true, run: () => { if (req) { S.billreqPending = req.id; } invoiceFromQuote(q); } })),
    { label: 'Facture libre avec ce montant', icon: 'coins', primary: !quotes.length, run: free },
    ...(req ? [{ label: 'Marquer comme facturée (déjà faite)…', icon: 'check', run: () => respMarkBilled(req) }, { label: 'Annuler la demande', icon: 'x', run: async () => { req.data.status = 'annulee'; await persist('billreq', req); render(); } }] : []),
  ]);
}
async function respMarkBilled(req, inv) {
  if (!inv) {
    const invs = (await db.list('invoice', { project: req.project_id })).filter((i) => i.data.status === 'emise');
    const v = await ask('Facture faite', [{ name: 'iid', label: 'Quelle facture ?', type: 'select', options: [['', '— (pas dans la liste) —'], ...invs.map((i) => [i.id, `${i.number} · ${fmtDate(i.data.date)} · ${money(totals(i.data).base)} HT`])] }]);
    if (!v) return; inv = byId(invs, +v.iid);
  }
  Object.assign(req.data, { status: 'facturee', billedAt: today(), invoiceId: inv ? inv.id : null, invoiceNumber: inv ? inv.number : '' });
  await persist('billreq', req); toast('Demande marquée facturée ✓'); if (location.hash.startsWith('#/resp')) render();
}
// appelé quand une facture est soumise (invoice.js)
async function billreqDone(inv) {
  const id = +inv.data.billreqId; if (!id) return;
  const req = await db.get('billreq', id).catch(() => null);
  if (req && req.data.status === 'demandee') { Object.assign(req.data, { status: 'facturee', billedAt: today(), invoiceId: inv.id, invoiceNumber: inv.number }); await persist('billreq', req, { silent: true }); }
}

async function respRequests() {
  const [reqs, projects] = await Promise.all([db.list('billreq'), db.list('project')]);
  const mine = isChef() ? reqs.filter((r) => r.created_by === S.me.id) : reqs;
  const page = layout({ title: 'Demandes de facture', icon: 'coins', sub: isChef() ? 'Ce que vous avez demandé au bureau de facturer' : 'Envoyées par les responsables d\'équipe',
    actions: isChef() ? `<button class="btn primary" data-act="new">${I.plus} Demander une facture</button>` : '' });
  const open = mine.filter((r) => r.data.status === 'demandee');
  dataTable(page, {
    rows: mine.sort((a, b) => (a.data.status === 'demandee' ? 0 : 1) - (b.data.status === 'demandee' ? 0 : 1) || (b.data.date || '').localeCompare(a.data.date || '')),
    toolbar: open.length ? `<b>${open.length} à facturer · ${money(open.reduce((a, r) => a + num(r.data.amount), 0))} HT</b>` : '',
    columns: [{ l: 'Date', v: (r) => fmtDate(r.data.date) }, { l: 'Projet', v: (r) => `<b>${esc((byId(projects, r.project_id) || { data: { name: '—' } }).data.name)}</b>` },
      { l: 'Type', v: (r) => esc(BRQ_KIND[r.data.kind] || '') }, { l: 'Avancement', cls: 'r', v: (r) => (r.data.pct != null ? pctTxt(num(r.data.pct)) : '') },
      { l: 'Montant HT', cls: 'r', v: (r) => `<b>${money(num(r.data.amount))}</b>` }, { l: 'Précisions', v: (r) => `<small>${esc(String(r.data.note || '').slice(0, 140))}</small>` },
      { l: 'Demandé par', v: (r) => esc(userName(r.created_by)) },
      { l: 'Statut', v: (r) => `${st(BRQ_ST, r.data.status)}${r.data.invoiceNumber ? `<br><small class="muted">${esc(r.data.invoiceNumber)}</small>` : ''}` }],
    onRow: (r) => (isChef() ? (r.data.status === 'demandee' ? menuSheet('Demande de facture', [{ label: 'Ouvrir le projet', icon: 'crane', run: () => go(`#/project/${r.project_id}`) }, { label: 'Annuler la demande', icon: 'x', danger: true, run: async () => { r.data.status = 'annulee'; await persist('billreq', r); render(); } }]) : go(`#/project/${r.project_id}`))
      : r.data.status === 'demandee' ? respBill(null, r) : r.data.invoiceId ? go(`#/invoice/${r.data.invoiceId}`) : go(`#/project/${r.project_id}`)),
    empty: isChef() ? 'Aucune demande : quand un travail est fait, « Demander une facture »' : 'Aucune demande des responsables',
  });
  const n = $('[data-act=new]'); if (n) n.onclick = () => billRequest();
}

// ---------------------------------------------------------------- Rapport au patron (figé à l'envoi)
async function respNewReport(uid) {
  const per = isChef() ? (new Date().getDay() === 1 ? 'semp' : 'sem') : ui.respP && ui.respP !== 'an' ? ui.respP : 'sem';
  const v = await ask(isChef() ? rz('repT') : `Rapport – ${RESP_PERIODS.find(([x]) => x === per)[1].toLowerCase()}`, [
    { name: 'comment', label: rz('msg'), type: 'textarea', placeholder: rz('msgPh'), hint: rz('repHint') },
  ], {}, isChef() ? rzBtns(true) : {});
  if (v) v.period = per;
  if (!v) return;
  const D = await respData(uid, v.period);
  const title = `${respName(uid)} – ${RESP_PERIODS.find(([x]) => x === v.period)[1].toLowerCase()} (${fmtDate(D.from)} → ${fmtDate(D.to)})`;
  const it = await persist('mgrreport', { data: { title, uid, period: v.period, from: D.from, to: D.to, comment: v.comment || '', date: today(), html: respReportHtml(D, title, v.comment || '') } });
  if (isChef()) { toast(rz('repSent'), 3000); return render(); }
  toast('Rapport enregistré', 3000); go(`#/resp/rapport/${it.id}`);
}
function respReportHtml(D, title, comment) {
  const k = D.k; const kv = (l, v) => `<tr><td class="muted">${l}</td><td class="r"><b>${v}</b></td></tr>`;
  return `<div class="doc">${fieldHead({ data: { name: title } }, 'Rapport d\'activité')}
    ${comment ? `<div class="d-sec"><h2>Commentaire du responsable</h2><p class="pre">${esc(comment)}</p></div>` : ''}
    <div class="d-sec"><h2>Résumé</h2><table class="d-lines"><tbody>
      ${kv('Heures de l\'équipe', `${fnum(k.hours, 1)} h${k.missing ? ` · ${k.missing} jour(s) non pointé(s)` : ''}`)}${kv('Coût de la main d\'œuvre', money(k.cost))}${kv('Produit par l\'équipe', money(k.prod))}${kv('Marge de la période', money(k.prod - k.cost))}
      ${kv('<b>À facturer maintenant</b>', money(k.toBill))}${kv('Déjà demandé au bureau, pas encore facturé', money(k.asked))}${kv('Reste à facturer (projets en cours)', money(k.rest))}
      ${kv('Facturé sur la période (HT)', money(k.invoicedPer))}${kv('Encaissé sur la période', money(k.cashedPer))}${kv('Marge des projets à ce jour', money(k.margin))}</tbody></table></div>
    <div class="d-sec"><h2>Projets : avancement et facturation</h2><table class="d-lines"><thead><tr><th>Projet</th><th>Fin prévue</th><th class="r">Avanc.</th><th class="r">Montant HT</th><th class="r">Facturé</th><th class="r">Encaissé</th><th class="r">À facturer</th><th class="r">Heures</th><th class="r">Marge</th></tr></thead><tbody>
      ${D.rows.map((r) => `<tr><td><b>${esc(r.p.data.name)}</b><br><small class="muted">${esc(r.client !== '—' ? r.client : '')} · ${esc((PST[r.p.data.status] || [''])[0])}</small></td><td>${r.p.data.end ? fmtDate(r.p.data.end) : '—'}</td><td class="r">${pctTxt(r.pc.v)}</td><td class="r">${money(r.f.budget)}</td><td class="r">${money(r.f.invoiced)}</td><td class="r">${money(r.f.cashed)}</td><td class="r"><b>${r.toBill > 0.5 ? money(r.toBill) : '—'}</b></td><td class="r">${fnum(r.f.hours, 1)} h</td><td class="r">${money(r.margin)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Aucun projet</td></tr>'}</tbody></table></div>
    <div class="d-sec"><h2>Équipe : heures et rentabilité</h2><table class="d-lines"><thead><tr><th>Personne</th><th class="r">Heures</th><th class="r">Occupation</th><th class="r">Coût</th><th class="r">Produit</th><th class="r">Marge</th><th>Jours sans heures</th></tr></thead><tbody>
      ${D.people.map((x) => `<tr><td><b>${esc(x.e.data.name)}</b></td><td class="r">${fnum(x.h, 1)} h</td><td class="r">${x.expected ? pctTxt(x.h / x.expected * 100) : '—'}</td><td class="r">${money(x.cost)}</td><td class="r">${money(x.prod)}</td><td class="r"><b>${money(x.margin)}</b></td><td><small>${x.missing.map((d) => fmtDate(d)).join(', ') || '—'}</small></td></tr>`).join('')}</tbody></table></div>
    ${D.reqs.filter((r) => r.data.status === 'demandee').length ? `<div class="d-sec"><h2>Demandes de facture en attente</h2><table class="d-lines"><tbody>${D.reqs.filter((r) => r.data.status === 'demandee').map((r) => `<tr><td>${fmtDate(r.data.date)}</td><td><b>${esc((byId(D.m.project, r.project_id) || { data: { name: '' } }).data.name)}</b> – ${esc(BRQ_KIND[r.data.kind] || '')}${r.data.note ? `<br><small class="muted">${esc(r.data.note)}</small>` : ''}</td><td class="r"><b>${money(num(r.data.amount))}</b></td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="d-sec"><h2>Planning – 14 prochains jours</h2>${D.ag.length ? `<table class="d-lines"><tbody>${D.ag.map((x) => `<tr><td style="white-space:nowrap">${fmtDate(x.d)}${x.t ? ` ${esc(x.t)}` : ''}</td><td><b>${esc(x.l)}</b>${x.s ? ` <span class="muted">– ${esc(x.s)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Rien de planifié.</p>'}</div>
  </div>`;
}
async function respReports() {
  const reps = await db.list('mgrreport');
  const mine = isChef() ? reps.filter((r) => r.created_by === S.me.id) : reps;
  const page = layout({ title: isChef() ? 'Rapports au patron' : 'Rapports des responsables', icon: 'send', actions: `<button class="btn primary" data-act="new">${I.plus} ${isChef() ? 'Envoyer un rapport' : 'Préparer un rapport'}</button>` });
  dataTable(page, { rows: mine.sort((a, b) => b.id - a.id),
    columns: [{ l: 'Date', v: (r) => fmtDate(r.data.date) }, { l: 'Rapport', v: (r) => `<b>${esc(r.data.title)}</b>${r.data.comment ? `<br><small class="muted">${esc(String(r.data.comment).slice(0, 120))}</small>` : ''}` }, { l: 'Par', v: (r) => esc(userName(r.created_by)) }],
    onRow: (r) => go(`#/resp/rapport/${r.id}`), empty: 'Aucun rapport' });
  $('[data-act=new]').onclick = () => respNewReport(isChef() ? S.me.id : (ui.respU != null ? +ui.respU : 0));
}
async function respReportView(id) {
  const r = await db.get('mgrreport', id);
  printPage(r.data.title, r.data.html || '<p>Rapport vide</p>', '#/resp/rapports', null, fileTitle(`Rapport ${r.data.title}`));
}
