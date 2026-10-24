'use strict';
/* Équipe (bureau) : les ouvriers et sous-traitants qui travaillent pour vous. Pour chacun : ses chantiers,
   ses heures, les bons de commande émis à son nom, son planning, ses rapports et les points qu'il doit traiter.
   Les chantiers sont calculés comme dans son espace terrain (équipe, sous-traitants du chantier, phases, planning, commandes). */

const CREW_KIND = { e: ['Ouvrier', '#3f7a68'], c: ['Sous-traitant', '#c98a17'] };
const crewData = () => db.many(['employee', 'contact', 'project', 'phase', 'assign', 'order', 'timesheet', 'point', 'report']);
const crewUser = (x) => S.users.find((u) => u.id === +x.data.userId && u.active);
const crewActive = (p) => p && !['termine', 'annule'].includes(p.data.status);
// chantiers d'une personne et pourquoi elle y est : { idChantier: Set(raisons) }
function crewSites(k, x, m) {
  const uid = +x.data.userId || 0; const why = {};
  const add = (pid, w) => { if (pid) (why[+pid] = why[+pid] || new Set()).add(w); };
  m.project.forEach((p) => {
    if (uid && (p.data.team || []).map(Number).includes(uid)) add(p.id, 'équipe du chantier');
    if (k === 'c' && (p.data.subs || []).map(Number).includes(x.id)) add(p.id, 'sous-traitant du chantier');
  });
  m.phase.forEach((ph) => { if ((k === 'e' && (ph.data.staff || []).map(Number).includes(x.id)) || (k === 'c' && +ph.data.companyId === x.id)) add(ph.project_id, `phase « ${ph.data.name} »`); });
  if (k === 'e') m.assign.forEach((a) => { if (+a.data.employeeId === x.id) add(a.project_id, 'planning'); });
  if (k === 'c') m.order.forEach((o) => { if (+o.data.supplierId === x.id && o.data.status !== 'annulee') add(o.project_id, 'bon de commande'); });
  return why;
}
const crewHours = (k, x, m) => m.timesheet.filter((t) => (k === 'e' ? +t.data.employeeId === x.id : +t.data.contactId === x.id));
// bons de commande émis à son nom (les brouillons ne sont pas encore partis)
const crewOrders = (k, x, m) => (k === 'c' ? m.order.filter((o) => +o.data.supplierId === x.id && o.data.status !== 'brouillon') : []);
const crewDue = (orders) => orders.filter((o) => !['facturee', 'annulee'].includes(o.data.status)).reduce((s, o) => s + totals(o.data).base, 0);
const crewPoints = (k, x, m) => { const uid = +x.data.userId || 0; return m.point.filter((p) => (k === 'c' && +p.data.companyId === x.id) || (uid && +p.data.assigneeId === uid)); };
// où il travaille aujourd'hui (planning pour un ouvrier, phases en cours pour un sous-traitant)
function crewToday(k, x, m) {
  const d = today();
  const pids = k === 'e' ? m.assign.filter((a) => +a.data.employeeId === x.id && a.data.date === d).map((a) => +a.project_id)
    : m.phase.filter((ph) => +ph.data.companyId === x.id && (ph.data.start || '') <= d && (ph.data.end || '') >= d).map((ph) => +ph.project_id);
  return [...new Set(pids)].map((id) => (byId(m.project, id) || { data: {} }).data.name).filter(Boolean);
}

route('crew', async (k, id) => {
  if (CREW_KIND[k] && id) return crewPerson(k, +id);
  const m = await crewData();
  const month = today().slice(0, 7);
  const people = [
    ...m.employee.filter((e) => e.data.active !== false).map((x) => ({ k: 'e', x, name: x.data.name || '—', sub: x.data.role || '' })),
    ...m.contact.filter((c) => c.data.kind === 'soustraitant').map((x) => ({ k: 'c', x, name: contactName(x), sub: x.data.trade || '' })),
  ].map((p) => {
    const sites = Object.keys(crewSites(p.k, p.x, m)).map(Number).filter((pid) => crewActive(byId(m.project, pid)));
    const orders = crewOrders(p.k, p.x, m);
    return { ...p, sites, orders, user: crewUser(p.x), hours: crewHours(p.k, p.x, m).filter((t) => (t.data.date || '').startsWith(month)).reduce((s, t) => s + num(t.data.hours), 0),
      due: crewDue(orders), todo: crewPoints(p.k, p.x, m).filter(isOpenPt).length, now: crewToday(p.k, p.x, m) };
  // les sous-traitants sans chantier, sans commande ni accès restent dans le Carnet
  }).filter((p) => p.k === 'e' || p.user || p.sites.length || p.orders.length)
    .sort((a, b) => (b.now.length - a.now.length) || (b.sites.length - a.sites.length) || a.name.localeCompare(b.name));
  const f = ui.crewF || ''; const q = ui.crewQ || '';
  const page = layout({ title: 'Équipe', icon: 'helmet', actions: `<button class="btn" data-act="rep">${I.send} Envoyer un rapport</button>${isAdmin() ? `<a class="btn primary" href="#/settings/users">${I.plus} Accès à l'application</a>` : ''}` });
  const n = (kk) => people.filter((p) => !kk || p.k === kk).length;
  page.innerHTML = `<div class="toolbar"><div class="chips">${[['', 'Tous'], ['e', 'Ouvriers'], ['c', 'Sous-traitants']].map(([kk, l]) => `<button class="chip ${f === kk ? 'on' : ''}" data-f="${kk}">${l} (${n(kk)})</button>`).join('')}</div>
      <span class="grow"></span><label class="search">${I.search}<input type="search" placeholder="Rechercher…" value="${esc(q)}"></label></div>
    <div class="crew-grid" data-list></div>
    <p class="muted crew-foot">Les autres sous-traitants (sans chantier ni commande) sont dans Carnet → Sous-traitants. Un ouvrier ou un sous-traitant apparaît sur un chantier quand vous l'ajoutez à l'équipe du chantier, à une phase, au planning ou à un bon de commande.</p>`;
  const draw = () => {
    const qq = (ui.crewQ || '').toLowerCase();
    const list = people.filter((p) => (!ui.crewF || p.k === ui.crewF) && (!qq || `${p.name} ${p.sub}`.toLowerCase().includes(qq)));
    $('[data-list]', page).innerHTML = list.map((p) => `<a class="crew-card" href="#/crew/${p.k}/${p.x.id}">
        <span class="crew-av" style="--c:${CREW_KIND[p.k][1]}">${esc(monoOf(p.name))}</span>
        <span class="crew-tx"><b>${esc(p.name)}</b><small>${esc(CREW_KIND[p.k][0])}${p.sub ? ` · ${esc(p.sub)}` : ''}</small></span>
        <span class="crew-acc ${p.user ? 'on' : ''}">${p.user ? 'Accès app ✓' : 'Sans accès'}</span>
        ${p.now.length ? `<span class="crew-now">${I.pin} Aujourd'hui : ${esc(p.now.join(', '))}</span>` : ''}
        <span class="crew-stats"><span><b>${p.sites.length}</b> chantier${p.sites.length > 1 ? 's' : ''}</span><span><b>${fnum(p.hours, 1)} h</b> ce mois</span>
          ${p.k === 'c' ? `<span><b>${p.orders.length}</b> bon${p.orders.length > 1 ? 's' : ''}${p.due ? ` · <b class="warn">${money(p.due)}</b> à facturer` : ''}</span>` : ''}${p.todo ? `<span class="late"><b>${p.todo}</b> point${p.todo > 1 ? 's' : ''} à traiter</span>` : ''}</span></a>`).join('')
      || `<div class="empty">${people.length ? 'Aucun résultat' : 'Ajoutez votre personnel (Équipe → Personnel) ou un sous-traitant à un chantier.'}</div>`;
  };
  $$('[data-f]', page).forEach((b) => { b.onclick = () => { ui.crewF = b.dataset.f; saveUi(); $$('[data-f]', page).forEach((y) => y.classList.toggle('on', y === b)); draw(); }; });
  $('.search input', page).oninput = (e) => { ui.crewQ = e.target.value; draw(); };
  $('[data-act=rep]').onclick = () => sendReport(null);
  draw();
});

// ---------------------------------------------------------------- Fiche d'une personne
async function crewPerson(k, id) {
  const m = await crewData();
  const x = (k === 'e' ? m.employee : m.contact).find((y) => y.id === id);
  if (!x) { toast('Personne introuvable'); return go('#/crew'); }
  const name = k === 'e' ? x.data.name || '—' : contactName(x);
  const user = crewUser(x); const month = today().slice(0, 7);
  const why = crewSites(k, x, m);
  const hours = crewHours(k, x, m).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  const orders = crewOrders(k, x, m).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  const pts = crewPoints(k, x, m); const openPts = pts.filter(isOpenPt);
  const sumH = (l) => l.reduce((s, t) => s + num(t.data.hours), 0);
  const sites = Object.keys(why).map(Number).map((pid) => byId(m.project, pid)).filter(Boolean)
    .sort((a, b) => (crewActive(b) - crewActive(a)) || (a.data.name || '').localeCompare(b.data.name || ''));
  const active = sites.filter(crewActive);
  const assigns = k === 'e' ? m.assign.filter((a) => +a.data.employeeId === id && a.data.date >= today()).sort((a, b) => a.data.date.localeCompare(b.data.date)).slice(0, 12) : [];
  const phases = m.phase.filter((ph) => (ph.data.end || '') >= today() && ((k === 'e' && (ph.data.staff || []).map(Number).includes(id)) || (k === 'c' && +ph.data.companyId === id))).sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const reports = user ? m.report.filter((r) => +r.created_by === user.id || (r.data.to || []).map(Number).includes(user.id)) : [];
  const pname = (pid) => (byId(m.project, pid) || { data: {} }).data.name || '—';
  const issued = orders.filter((o) => o.data.status !== 'annulee');
  const page = layout({ title: name, icon: 'helmet', back: '#/crew',
    sub: `${badge(...CREW_KIND[k])} ${user ? badge('Accès à l\'application ✓', '#2f9e44') : badge('Sans accès à l\'application', '#868e96')}`,
    actions: `${user ? `<button class="btn" data-act="rep">${I.send} Envoyer un rapport</button>` : isAdmin() ? `<a class="btn" href="#/settings/users">${I.plus} Donner l'accès</a>` : ''}${k === 'c' ? `<a class="btn" href="#/contact/${id}">${I.user} Fiche contact</a>` : `<a class="btn" href="#/hr/staff">${I.user} Fiche du personnel</a>`}` });
  const phone = x.data.phone || x.data.mobile; const email = x.data.email;
  page.innerHTML = `${phone || email ? `<div class="chips crew-contact">${phone ? `<a class="chip" href="tel:${esc(String(phone).replace(/\s/g, ''))}">${I.phone} ${esc(phone)}</a>` : ''}${email ? `<a class="chip" href="mailto:${esc(email)}">${I.mail} ${esc(email)}</a>` : ''}</div>` : ''}
    <div class="kpis">${kpi('Chantiers en cours', String(active.length), { sub: sites.length > active.length ? `${sites.length} au total` : '' })}
      ${kpi('Heures ce mois', `${fnum(sumH(hours.filter((t) => (t.data.date || '').startsWith(month))), 1)} h`, { sub: `${fnum(sumH(hours), 1)} h au total` })}
      ${k === 'c' ? kpi('Bons de commande émis', money(issued.reduce((s, o) => s + totals(o.data).base, 0)), { sub: `${issued.length} bon(s) · HT` }) + kpi('Pas encore facturé', money(crewDue(orders)), { cls: crewDue(orders) ? 'warn' : '' })
    : kpi('Points à traiter', String(openPts.length))}</div>
    <div class="cols-2">
      <div class="card"><div class="card-h"><h3>Chantiers attribués</h3></div><div class="rows">${sites.map((p) => { const h = sumH(hours.filter((t) => +t.project_id === p.id)); const bc = orders.filter((o) => +o.project_id === p.id && o.data.status !== 'annulee').reduce((s, o) => s + totals(o.data).base, 0);
        return `<a class="row" href="#/project/${p.id}"><span class="grow"><b>${esc(p.data.name)}</b><small class="muted">${esc([...why[p.id]].join(' · '))}</small></span>${st(PST, p.data.status)}<span class="crew-num">${h ? `${fnum(h, 1)} h` : ''}${h && bc ? '<br>' : ''}${bc ? money(bc) : ''}</span></a>`; }).join('')
        || '<div class="empty sm">Aucun chantier. Ajoutez-le à l\'équipe d\'un chantier, à une phase ou au planning.</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>Planning à venir</h3><a class="btn sm" href="${k === 'e' ? '#/planning/team' : '#/planning/projects'}">Planning</a></div><div class="rows">
        ${assigns.map((a) => `<a class="row" href="#/project/${a.project_id}"><span class="grow"><b>${a.data.date === today() ? 'Aujourd\'hui' : esc(new Date(a.data.date + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }))}</b><small class="muted">${esc(pname(a.project_id))}${a.data.note ? ` · ${esc(a.data.note)}` : ''}</small></span><span class="muted">${a.data.half === 'am' ? 'Matin' : a.data.half === 'pm' ? 'Après-midi' : 'Journée'}</span></a>`).join('')}
        ${phases.map((ph) => `<a class="row" href="#/project/${ph.project_id}/planning"><span class="grow"><b>${esc(ph.data.name)}</b><small class="muted">${esc(pname(ph.project_id))} · du ${fmtDate(ph.data.start)} au ${fmtDate(ph.data.end)}</small></span><span class="muted">${num(ph.data.progress)} %</span></a>`).join('')}
        ${!assigns.length && !phases.length ? '<div class="empty sm">Rien de planifié.</div>' : ''}</div></div>
    </div>
    ${k === 'c' ? `<div class="card"><div class="card-h"><h3>Bons de commande émis</h3></div>${orders.length ? `<div class="dt-body"><table class="dt"><thead><tr><th>N°</th><th>Date</th><th>Chantier</th><th>Statut</th><th class="r">Total HT</th></tr></thead><tbody>
      ${orders.map((o) => `<tr data-href="#/order/${o.id}"><td data-l="N°"><b>${esc(o.number || '')}</b></td><td data-l="Date">${fmtDate(o.data.date)}</td><td data-l="Chantier">${esc(pname(o.project_id))}</td>
        <td data-l="Statut">${o.data.status === 'facturee' ? badge('Facturé ✓', '#2f9e44') : o.data.status === 'annulee' ? badge('Annulé', '#868e96') : badge('Pas encore facturé', '#e2a12b')}</td><td data-l="Total HT" class="r"><b>${money(totals(o.data).base)}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty sm">Aucun bon de commande envoyé à ce sous-traitant.</div>'}</div>` : ''}
    <div class="card"><div class="card-h"><h3>Heures encodées</h3><a class="btn sm" href="#/hr/timesheets">Tout le pointage</a></div>${hours.length ? `<div class="dt-body"><table class="dt"><thead><tr><th>Date</th><th>Chantier</th><th>Travail</th><th class="r">Heures</th></tr></thead><tbody>
      ${hours.slice(0, 40).map((t) => `<tr><td data-l="Date">${fmtDate(t.data.date)}</td><td data-l="Chantier">${t.project_id ? esc(pname(t.project_id)) : `${badge('à créer', '#e8590c')} ${esc(t.data.site || '')}`}</td><td data-l="Travail">${esc(t.data.task || '')}</td><td data-l="Heures" class="r"><b>${fnum(num(t.data.hours), 2)} h</b></td></tr>`).join('')}</tbody></table></div>${hours.length > 40 ? `<p class="muted">… et ${hours.length - 40} autres lignes dans le pointage.</p>` : ''}` : '<div class="empty sm">Aucune heure encodée.</div>'}</div>
    ${pts.length ? `<div class="card"><div class="card-h"><h3>Points sur plan attribués</h3></div><div class="rows">${[...openPts, ...pts.filter((p) => !isOpenPt(p))].map((p) => `<a class="row" href="#/project/${p.project_id}/points"><span class="grow"><b>n° ${esc(p.number || '')} – ${esc(p.data.title || '')}</b><small class="muted">${esc(pname(p.project_id))}${p.data.due ? ` · pour le ${fmtDate(p.data.due)}` : ''}</small></span>${st(PTS, p.data.status)}</a>`).join('')}</div></div>` : ''}
    ${user ? `<div class="card"><div class="card-h"><h3>Rapports</h3></div><div class="rep-list">${reportRows(reports, m.project) || '<p class="muted">Aucun rapport échangé.</p>'}</div></div>` : ''}`;
  $$('[data-href]', page).forEach((tr) => { tr.style.cursor = 'pointer'; tr.onclick = () => go(tr.dataset.href); });
  const rep = $('[data-act=rep]'); if (rep && user) rep.onclick = () => sendReport(null, [user.id]);
}
