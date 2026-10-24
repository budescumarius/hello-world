'use strict';
/* Espace terrain : ce que voit un ouvrier ou un sous-traitant connecté. Volontairement très simple :
   l'accueil, ce sont ses chantiers. Dans un chantier : ses heures, un rapport avec photos, les plans avec ses points,
   les rapports que le bureau lui a envoyés et son planning ici. En plus, pour un sous-traitant : ses bons de commande.
   Le serveur ne lui envoie rien d'autre. */

const T_DAY = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
const tProjects = () => db.list('project');
const tName = (projects, id) => ((byId(projects, id) || { data: {} }).data.name || '');
const isSub = () => S.me.role === 'soustraitant';
const tActive = (projects) => projects.filter((p) => !['termine', 'annule'].includes(p.data.status));
const tAddr = (p) => [p.data.address, [p.data.zip, p.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const tHalf = (x) => (x.data.half === 'am' ? 'Matin' : x.data.half === 'pm' ? 'Après-midi' : 'Journée');
// rapports reçus du bureau (les siens exclus) et ceux pas encore lus
const tGot = (reports) => reports.filter((r) => +r.created_by !== S.me.id);
const tUnread = (reports) => tGot(reports).filter((r) => !(r.data.readBy || []).map(Number).includes(S.me.id));
// statut d'un point, dit simplement
const T_PTS = { open: ['À faire', '#e5484d'], progress: ['En cours', '#f08c00'], done: ['Fait – le bureau vérifie', '#2f9e44'], closed: ['Validé ✓', '#868e96'] };

function installHelp() {
  modal(`${mhead('Installer sur le téléphone')}<div class="m-body s-dict">
    <p><b>iPhone</b> : dans Safari, touchez <b>Partager</b> (carré avec une flèche), puis <b>Sur l'écran d'accueil</b>.</p>
    <p><b>Android</b> : dans Chrome, touchez <b>⋮</b> puis <b>Installer l'application</b>.</p>
    <p class="muted">L'application s'ouvre ensuite comme les autres, sans la barre du navigateur.</p></div>`);
}

route('t', async (screen, a) => {
  if (screen === 'chantier') return tSite(+a);
  if (screen === 'heures') return tHours();
  if (screen === 'rapports') return tReports();
  if (screen === 'rapport') return a === 'new' ? tReportNew() : tReport(+a);
  if (screen === 'photos') { location.hash = '#/t/rapport/new'; return; }
  if (screen === 'plans') return tPlans(+a);
  if (screen === 'plan') return tPlanView(+a);
  if (screen === 'point') return tPoint(+a);
  if (screen === 'commandes' && isSub()) return tOrders();
  if (screen === 'planning') return tPlanning();
  return tHome();
});
const tPage = (p) => { const page = layout(p); page.classList.add('s-page', 't-page'); return page; };

// ---------------------------------------------------------------- Accueil : mes chantiers (et c'est tout)
async function tHome() {
  const [projects, m] = await Promise.all([tProjects(), db.many(['report', 'assign', 'point', ...(isSub() ? ['order'] : [])])]);
  const page = tPage({ title: 'Mes chantiers', icon: 'crane' });
  const unread = tUnread(m.report); const todo = m.point.filter(isOpenPt);
  const next = m.assign.filter((x) => x.data.date >= today()).sort((x, y) => x.data.date.localeCompare(y.data.date));
  const here = new Set(next.filter((x) => x.data.date === today()).map((x) => +x.project_id));
  const list = tActive(projects).sort((a, b) => (here.has(b.id) - here.has(a.id)) || (a.data.name || '').localeCompare(b.data.name || ''));
  const loose = tGot(m.report).filter((r) => !r.project_id);
  const due = (m.order || []).filter((o) => !['facturee', 'annulee'].includes(o.data.status));
  page.innerHTML = `<div class="today-hello"><b>Bonjour ${esc((S.me.name || '').split(' ')[0])}</b><span>${esc(T_DAY(today()))}</span></div>
    ${pushState() !== 'on' && pushState() !== 'denied' ? `<button type="button" class="t-alert soft" data-push>${I.bell}<span><b>Activer les notifications</b><br><small>Pour ne rien rater du bureau</small></span>${I.chevron}</button>` : ''}
    <div class="t-sites">${list.map((p) => { const u = unread.filter((r) => +r.project_id === p.id).length; const n = todo.filter((x) => +x.project_id === p.id).length;
      return `<a class="t-site ${here.has(p.id) ? 'now' : ''}" href="#/t/chantier/${p.id}"><span class="t-site-ic">${I.crane}</span>
        <span class="t-site-tx"><b>${esc(p.data.name)}</b>${tAddr(p) ? `<small>${esc(tAddr(p))}</small>` : ''}
        ${here.has(p.id) || u || n ? `<span class="t-tags">${here.has(p.id) ? '<i class="tg now">Aujourd\'hui ici</i>' : ''}${u ? `<i class="tg new">${u} rapport${u > 1 ? 's' : ''} du bureau</i>` : ''}${n ? `<i class="tg pt">${n} point${n > 1 ? 's' : ''} à faire</i>` : ''}</span>` : ''}</span>
        <span class="t-site-go">${I.chevron}</span></a>`; }).join('')
      || `<div class="todo-empty">${I.crane}<b>Aucun chantier pour l'instant</b><span>Le bureau vous ajoutera à vos chantiers.</span></div>`}</div>
    <div class="s-list t-more">
      ${sBtn('data-go="#/t/planning"', 'calendar', 'Mon planning', next[0] ? esc(`${next[0].data.date === today() ? 'Aujourd\'hui' : T_DAY(next[0].data.date)} : ${tName(projects, next[0].project_id) || 'chantier'}`) : 'Rien de prévu pour l\'instant')}
      ${isSub() ? sBtn('data-go="#/t/commandes"', 'truck', 'Mes bons de commande', due.length ? `${due.length} pas encore facturé${due.length > 1 ? 's' : ''}` : (m.order || []).length ? 'Tous facturés ✓' : 'Aucun pour l\'instant') : ''}
      ${loose.length ? sBtn('data-go="#/t/rapports"', 'fiche', 'Messages du bureau', `${loose.length} message${loose.length > 1 ? 's' : ''}`) : ''}</div>`;
  $$('[data-go]', page).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  const pb = $('[data-push]', page); if (pb) pb.onclick = () => pushEnable();
}

// ---------------------------------------------------------------- Un chantier : 3 gestes + ce que le bureau m'a envoyé
async function tSite(id) {
  const [p, m] = await Promise.all([db.get('project', id), db.many(['report', 'assign', 'phase', 'point', 'timesheet', 'plan'], id)]);
  const page = tPage({ title: p.data.name, icon: 'crane', back: '#/t' });
  const F = S.field || {};
  const hToday = m.timesheet.filter((t) => t.data.date === today()).reduce((x, t) => x + num(t.data.hours), 0);
  const open = m.point.filter(isOpenPt).length;
  const mine = m.assign.filter((x) => x.data.date >= today()).sort((x, y) => x.data.date.localeCompare(y.data.date)).slice(0, 5);
  const ph = m.phase.filter((x) => (x.data.end || '') >= today() && ((F.employeeId && (x.data.staff || []).map(Number).includes(F.employeeId)) || (F.contactId && +x.data.companyId === F.contactId)));
  const byDate = (x, y) => (y.data.date || '').localeCompare(x.data.date || '') || y.id - x.id;
  const got = tGot(m.report).sort(byDate); const sent = m.report.filter((r) => +r.created_by === S.me.id).sort(byDate);
  const unread = (r) => !(r.data.readBy || []).map(Number).includes(S.me.id);
  page.innerHTML = `${tAddr(p) ? `<a class="s-note" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tAddr(p))}">${I.pin}<span>${esc(tAddr(p))}</span><b>Itinéraire</b></a>` : ''}
    ${p.data.access ? `<div class="s-note">${I.key}<span><small class="muted">Accès</small><br>${esc(p.data.access)}</span></div>` : ''}
    <div class="t-acts three">
      <a class="s-tile t1" href="#/t/heures?p=${id}">${I.clock}<b>Mes heures</b><small>${hToday ? `${fnum(hToday, 1)} h aujourd'hui` : 'à encoder'}</small></a>
      <a class="s-tile t3" href="#/t/rapport/new?p=${id}">${I.camera}<b>Rapport</b><small>photos, remarques</small></a>
      <a class="s-tile t2 ${open ? 'hot' : ''}" href="#/t/plans/${id}">${I.pin}<b>À faire</b><small>${open ? `${open} point${open > 1 ? 's' : ''} sur plan` : 'plans du chantier'}</small></a>
    </div>
    ${mine.length || ph.length ? `<h3 class="t-h">Mon planning ici</h3><div class="card t-plan">${mine.map((x) => `<div class="t-pl"><b>${x.data.date === today() ? 'Aujourd\'hui' : esc(T_DAY(x.data.date))}</b><span>${tHalf(x)}${x.data.note ? ` · ${esc(x.data.note)}` : ''}</span></div>`).join('')}
      ${ph.map((x) => `<div class="t-pl"><b>${esc(x.data.name)}</b><span>du ${fmtDate(x.data.start)} au ${fmtDate(x.data.end)}</span></div>`).join('')}</div>` : ''}
    <h3 class="t-h">Du bureau</h3>
    <div class="s-cards">${[...got.filter(unread), ...got.filter((r) => !unread(r))].map((r) => tReportCard(r)).join('') || '<p class="muted s-empty">Rien reçu du bureau pour ce chantier.</p>'}</div>
    ${sent.length ? `<h3 class="t-h">Mes rapports</h3><div class="s-cards">${sent.slice(0, 10).map((r) => tReportCard(r)).join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------- Mes heures (pointage du jour)
async function tHours() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const day = q.get('d') || today(); const pre = +q.get('p') || 0;
  const [projects, sheets] = await Promise.all([tProjects(), db.list('timesheet')]);
  const page = tPage({ title: 'Mes heures', icon: 'clock', back: pre ? `#/t/chantier/${pre}` : '#/t' });
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const sumDay = (d) => sheets.filter((t) => t.data.date === d).reduce((x, t) => x + num(t.data.hours), 0);
  const list = sheets.filter((t) => t.data.date === day);
  const active = tActive(projects);
  page.innerHTML = `<div class="t-days">${days.map((d) => `<a href="#/t/heures?d=${d}${pre ? `&p=${pre}` : ''}" class="${d === day ? 'on' : ''}"><small>${new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short' })}</small><b>${+d.slice(8)}</b><i>${sumDay(d) ? fnum(sumDay(d), 1) + ' h' : '·'}</i></a>`).join('')}</div>
    <div class="t-sum"><span>${day === today() ? 'Aujourd\'hui' : esc(T_DAY(day))}</span><b>${fnum(sumDay(day), 1)} h</b></div>
    <div class="s-cards">${list.map((t) => `<button type="button" class="s-card t-line" data-e="${t.id}"><span class="s-ct"><b>${esc(tName(projects, t.project_id) || 'Chantier')}</b><small>${esc(t.data.task || 'Travail non précisé')}</small></span><span class="s-ca"><b>${fnum(num(t.data.hours), 2)} h</b></span></button>`).join('') || '<p class="muted s-empty">Rien d\'encodé ce jour-là.</p>'}</div>
    ${active.length ? `<button class="s-big primary" data-add>${I.plus} Ajouter des heures</button>` : '<p class="muted">Aucun chantier attribué : le bureau doit d\'abord vous ajouter à un chantier.</p>'}`;
  const edit = (t) => {
    const d = t ? t.data : { hours: 8, task: '' };
    const m = modal(`${mhead(t ? 'Modifier mes heures' : 'Ajouter des heures')}<div class="m-body s-form">
      <label class="field"><span>Chantier</span><select name="pid">${active.map((p) => `<option value="${p.id}" ${(t ? t.project_id : pre || (active[0] || {}).id) === p.id ? 'selected' : ''}>${esc(p.data.name)}</option>`).join('')}</select></label>
      <div class="field"><span>Heures</span><div class="s-step"><button type="button" data-m="-0.5">−</button><input name="h" inputmode="decimal" value="${fnum(num(d.hours), 2)}"><button type="button" data-m="0.5">+</button></div></div>
      <label class="field"><span>Travail fait</span><div class="s-desc"><textarea name="task" rows="3" placeholder="Ex. : pose du carrelage salle de bain">${esc(d.task || '')}</textarea><button type="button" class="s-mic" data-mic aria-label="Dicter">🎤</button></div></label></div>
      <div class="m-foot">${t ? `<button class="btn danger ghost" data-del>${I.trash} Supprimer</button>` : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Enregistrer</button></div>`);
    const h = $('[name=h]', m.el);
    $$('[data-m]', m.el).forEach((b) => { b.onclick = () => { h.value = fnum(Math.max(0, Math.min(24, r2(num(h.value) + +b.dataset.m))), 2); }; });
    micFor($('[data-mic]', m.el), $('[name=task]', m.el));
    $('[data-ok]', m.el).onclick = async () => {
      const hours = num(h.value); if (!(hours > 0 && hours <= 24)) return toast('Indiquez les heures (entre 0,5 et 24)', 3000);
      const it = t || { data: { date: day } };
      it.project_id = +$('[name=pid]', m.el).value; Object.assign(it.data, { hours, task: $('[name=task]', m.el).value.trim(), date: it.data.date || day });
      try { await persist('timesheet', it, { silent: true }); m.close(); toast('Heures enregistrées ✓', 2000); render(); } catch (e) { toast('Erreur : ' + e.message, 4000); }
    };
    const del = $('[data-del]', m.el); if (del) del.onclick = async () => { if (!confirm('Supprimer ces heures ?')) return; await db.del('timesheet', t.id); m.close(); render(); };
  };
  const add = $('[data-add]', page); if (add) add.onclick = () => edit(null);
  $$('[data-e]', page).forEach((b) => { b.onclick = () => edit(list.find((x) => x.id === +b.dataset.e)); });
}

// ---------------------------------------------------------------- Rapports
function tReportCard(r) {
  const mine = +r.created_by === S.me.id;
  const unread = !mine && !(r.data.readBy || []).map(Number).includes(S.me.id);
  const from = mine ? 'Moi' : (S.users.find((u) => u.id === +r.created_by) || { name: 'Le bureau' }).name;
  const n = (r.data.photos || []).length + (r.data.files || []).length;
  return `<a class="s-card t-rep ${unread ? 'unread' : ''}" href="#/t/rapport/${r.id}"><span class="s-ct"><b>${unread ? '<i class="t-dot"></i>' : ''}${esc(r.data.title || (r.data.kind === 'photos' ? 'Photos du chantier' : 'Rapport'))}</b>
    <small>${fmtDate(r.data.date)} · ${esc(from)}</small>${r.data.text ? `<small class="t-ex">${esc(r.data.text.split('\n')[0])}</small>` : ''}</span>
    <span class="s-ca">${unread ? '<em style="--c:#e8590c">Nouveau</em>' : ''}${n ? `<em style="--c:#3f7a68">${I.camera} ${n}</em>` : ''}</span></a>`;
}
// messages du bureau (tous chantiers, et ceux sans chantier)
async function tReports() {
  const reports = tGot(await db.list('report')).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  const page = tPage({ title: 'Messages du bureau', icon: 'fiche', back: '#/t' });
  page.innerHTML = `<div class="s-cards">${reports.map((r) => tReportCard(r)).join('') || '<p class="muted s-empty">Aucun message pour l\'instant.</p>'}</div>`;
}
async function tReport(id) {
  const r = await db.get('report', id);
  const page = tPage({ title: r.data.title || (r.data.kind === 'photos' ? 'Photos du chantier' : 'Rapport'), icon: 'fiche', back: r.project_id ? `#/t/chantier/${r.project_id}` : '#/t/rapports' });
  const mine = +r.created_by === S.me.id;
  const from = mine ? 'Moi' : (S.users.find((u) => u.id === +r.created_by) || { name: 'Le bureau' }).name;
  page.innerHTML = `<div class="card t-repv"><div class="t-meta">${fmtDate(r.data.date)} · ${esc(from)}</div>
    ${r.data.text ? `<div class="pre t-txt">${esc(r.data.text)}</div>` : ''}
    ${(r.data.photos || []).length ? `<div class="t-photos">${r.data.photos.map((fid) => `<a href="${fileUrl(fid)}" target="_blank" rel="noopener"><img src="${fileUrl(fid)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    ${(r.data.files || []).length ? `<div class="s-list">${r.data.files.map((x) => sBtn(`data-f="${x.id}"`, 'file', esc(x.name || 'Document'), 'ouvrir')).join('')}</div>` : ''}</div>
    ${mine ? sBtn('data-del', 'trash', 'Supprimer ce rapport', '', 'danger') : ''}`;
  $$('[data-f]', page).forEach((b) => { b.onclick = () => window.open(fileUrl(+b.dataset.f), '_blank'); });
  const del = $('[data-del]', page); if (del) del.onclick = async () => { if (!confirm('Supprimer ce rapport et ses photos ?')) return; for (const fid of r.data.photos || []) await delFile(fid); await db.del('report', r.id); go(r.project_id ? `#/t/chantier/${r.project_id}` : '#/t'); };
  if (!mine && !(r.data.readBy || []).map(Number).includes(S.me.id)) api('POST', `seen/${r.id}`).catch(() => {});
}
// un seul formulaire : des photos et/ou des remarques
async function tReportNew() {
  const pre = +new URLSearchParams(location.hash.split('?')[1] || '').get('p') || 0;
  const projects = tActive(await tProjects());
  const page = tPage({ title: 'Rapport', icon: 'camera', back: pre ? `#/t/chantier/${pre}` : '#/t' });
  if (!projects.length) { page.innerHTML = `<div class="todo-empty">${I.crane}<b>Aucun chantier attribué</b><span>Le bureau doit d'abord vous ajouter à un chantier.</span></div>`; return; }
  const photos = [];
  const fixed = byId(projects, pre);
  page.innerHTML = `<div class="s-form">
    ${fixed ? `<div class="s-note">${I.crane}<span>${esc(fixed.data.name)}</span></div><input type="hidden" name="pid" value="${fixed.id}">` : `<label class="field"><span>Chantier</span><select name="pid">${projects.map((p) => `<option value="${p.id}">${esc(p.data.name)}</option>`).join('')}</select></label>`}
    <button type="button" class="s-huge" data-cam>${I.camera}<b>Prendre des photos</b></button>
    <div class="t-photos" data-ph></div>
    <label class="field"><span>Remarques</span><div class="s-desc"><textarea name="text" rows="5" placeholder="Ce qui a été fait, ce qui manque, les problèmes…"></textarea><button type="button" class="s-mic" data-mic aria-label="Dicter">🎤</button></div></label>
    <button class="s-big primary" data-send>${I.send} Envoyer au bureau</button></div>`;
  const ta = $('[name=text]', page); micFor($('[data-mic]', page), ta);
  const drawPh = () => { $('[data-ph]', page).innerHTML = photos.map((x, i) => `<span class="t-ph"><img src="${x.url}" alt=""><button type="button" data-x="${i}" aria-label="Retirer">${I.x}</button></span>`).join('');
    $$('[data-x]', page).forEach((b) => { b.onclick = () => { photos.splice(+b.dataset.x, 1); drawPh(); }; }); };
  $('[data-cam]', page).onclick = async () => {
    for (const f of (await pickFile('image/*', true)) || []) photos.push({ file: f, url: URL.createObjectURL(f) });
    drawPh();
  };
  $('[data-send]', page).onclick = async (e) => {
    const text = ta.value.trim(); const pid = +$('[name=pid]', page).value;
    if (!photos.length && !text) return toast('Ajoutez des photos ou écrivez vos remarques', 3500);
    const btn = e.currentTarget; btn.disabled = true; toast('Envoi…', 30000);
    try {
      const ids = [];
      for (const x of photos) ids.push((await uploadPhoto(x.file, pid)).id);
      const kind = text ? 'rapport' : 'photos';
      await persist('report', { project_id: pid, data: { kind, date: today(), title: `${kind === 'photos' ? 'Photos' : 'Rapport'} – ${tName(projects, pid)}`, text, photos: ids, to: [] } });
      toast('Envoyé au bureau ✓', 2500); go(`#/t/chantier/${pid}`);
    } catch (err) { toast('Envoi impossible : ' + err.message, 5000); btn.disabled = false; }
  };
}

// ---------------------------------------------------------------- Plans et points qui me sont attribués
const tPtCard = (x, plans) => { const [l, c] = T_PTS[x.data.status] || T_PTS.open; const late = x.data.due && x.data.due < today() && isOpenPt(x);
  return `<a class="s-card t-pt" href="#/t/point/${x.id}"><span class="t-pin" style="--c:${c}">${esc(x.number || '•')}</span><span class="s-ct"><b>${esc(x.data.title || 'Point')}</b>
    <small>${esc([(byId(plans, x.data.planId) || { data: {} }).data.name, x.data.location].filter(Boolean).join(' · ') || 'Sans plan')}${x.data.due ? ` · <span class="${late ? 'late' : ''}">pour le ${fmtDate(x.data.due)}</span>` : ''}</small></span>
    <span class="s-ca"><em style="--c:${c}">${esc(l)}</em></span></a>`; };
async function tPlans(pid) {
  const [p, plans, points] = await Promise.all([db.get('project', pid), db.list('plan', { project: pid }), db.list('point', { project: pid })]);
  plans.sort((a, b) => (a.data.order ?? a.id) - (b.data.order ?? b.id));
  const page = tPage({ title: 'À faire', icon: 'pin', back: `#/t/chantier/${pid}`, sub: esc(p.data.name) });
  const open = points.filter(isOpenPt).sort((a, b) => (a.data.due || '9').localeCompare(b.data.due || '9') || a.id - b.id);
  const other = points.filter((x) => !isOpenPt(x));
  page.innerHTML = `<div class="s-cards">${open.map((x) => tPtCard(x, plans)).join('') || `<div class="todo-empty">${I.check}<b>Rien à faire pour l'instant 👍</b><span>Le bureau vous préviendra s'il y a un point à traiter.</span></div>`}</div>
    <h3 class="t-h">Plans du chantier</h3>
    <div class="t-plans">${plans.map((pl) => { const n = open.filter((x) => +x.data.planId === pl.id).length; return `<a class="t-plan-c" href="#/t/plan/${pl.id}"><img src="${fileUrl(pl.data.thumbId || pl.data.fileId)}" alt="" loading="lazy"><span><b>${esc(pl.data.name)}</b>${n ? `<i class="tg pt">${n} point${n > 1 ? 's' : ''}</i>` : ''}</span></a>`; }).join('') || '<p class="muted s-empty">Aucun plan pour ce chantier.</p>'}</div>
    ${other.length ? `<h3 class="t-h">Terminés</h3><div class="s-cards">${other.map((x) => tPtCard(x, plans)).join('')}</div>` : ''}`;
}
async function tPlanView(planId) {
  const pl = await db.get('plan', planId);
  const p = await db.get('project', pl.project_id);
  return viewPlan(p, planId, { field: true, back: `#/t/plans/${p.id}`, onPin: (pt) => go(`#/t/point/${pt.id}`) });
}
async function tPoint(id) {
  const pt = await db.get('point', id);
  const [p, plans] = await Promise.all([db.get('project', pt.project_id), db.list('plan', { project: pt.project_id })]);
  const d = pt.data; d.photos = d.photos || []; d.history = d.history || [];
  const pl = byId(plans, d.planId);
  const page = tPage({ title: `Point n° ${pt.number}`, icon: 'pin', back: `#/t/plans/${p.id}`, sub: esc(p.data.name) });
  const [lab, col] = T_PTS[d.status] || T_PTS.open;
  const late = d.due && d.due < today() && isOpenPt(pt);
  page.innerHTML = `<div class="card t-ptv"><em class="t-st" style="--c:${col}">${esc(lab)}</em>${['high', 'urgent'].includes(d.priority) ? ` <em class="t-st" style="--c:${PRIO[d.priority][1]}">${esc(PRIO[d.priority][0])}</em>` : ''}
      <h2>${esc(d.title || 'Point')}</h2>
      ${d.desc ? `<div class="pre t-txt">${esc(d.desc)}</div>` : ''}
      ${d.location || d.due ? `<dl class="t-dl">${d.location ? `<dt>Où</dt><dd>${esc(d.location)}</dd>` : ''}${d.due ? `<dt>Pour le</dt><dd class="${late ? 'late' : ''}">${fmtDate(d.due)}</dd>` : ''}</dl>` : ''}
      ${pl && d.x != null ? `<a class="t-crop" href="#/t/plan/${pl.id}" data-show><img data-crop alt=""><span>${I.pin} Voir sur le plan · ${esc(pl.data.name)}</span></a>` : ''}
      ${d.photos.length ? `<div class="t-photos">${d.photos.map((fid) => `<a href="${fileUrl(fid)}" target="_blank" rel="noopener"><img src="${fileUrl(fid)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}</div>
    ${isOpenPt(pt) ? `<button class="s-big primary" data-st="done">${I.check} C'est fait</button>` : d.status === 'done' ? `<button class="s-big" data-st="open">Ce n'est pas encore fait</button>` : ''}
    <button class="s-big" data-photo>${I.camera} Ajouter une photo</button>
    <h3 class="t-h">Commentaires</h3>
    <div class="t-hist">${[...d.history].reverse().map((h) => `<div class="${h.kind === 'comment' ? '' : 'sys'}"><small>${fmtDT(h.t)} · ${esc(h.uid === S.me.id ? 'Moi' : userName(h.uid))}</small>${esc(h.text)}</div>`).join('') || '<p class="muted">Pas encore de commentaire.</p>'}</div>
    <div class="s-form"><div class="s-desc"><textarea name="c" rows="2" placeholder="Écrire un commentaire…"></textarea><button type="button" class="s-mic" data-mic aria-label="Dicter">🎤</button></div>
    <button class="s-big" data-send>${I.send} Envoyer le commentaire</button></div>`;
  if (pl && d.x != null) cropPlan(pl, pt).then((url) => { const im = $('[data-crop]', page); if (im) im.src = url; }).catch(() => {});
  const show = $('[data-show]', page); if (show) show.addEventListener('click', () => { planIntent = { highlight: pt.id }; });
  const save = async (msg) => { try { await persist('point', pt); toast(msg, 2500); render(); } catch (e) { toast('Erreur : ' + e.message, 4000); } };
  $$('[data-st]', page).forEach((b) => { b.onclick = () => { d.status = b.dataset.st; save(d.status === 'done' ? 'Merci ! Le bureau est prévenu ✓' : 'Point remis à faire'); }; });
  $('[data-photo]', page).onclick = async () => {
    const files = await pickFile('image/*', true); if (!files || !files.length) return;
    toast('Envoi de la photo…', 30000);
    try { for (const f of files) d.photos.push((await uploadPhoto(f, pt.project_id)).id); } catch (e) { return toast('Envoi impossible : ' + e.message, 5000); }
    save('Photo ajoutée ✓');
  };
  const ta = $('[name=c]', page); micFor($('[data-mic]', page), ta);
  $('[data-send]', page).onclick = () => {
    const text = ta.value.trim(); if (!text) return toast('Écrivez votre commentaire', 2500);
    d.history.push({ t: new Date().toISOString().slice(0, 19).replace('T', ' '), uid: S.me.id, kind: 'comment', text });
    save('Commentaire envoyé ✓');
  };
}

// ---------------------------------------------------------------- Bons de commande (sous-traitant)
async function tOrders() {
  const [orders, projects] = await Promise.all([db.list('order'), tProjects()]);
  const page = tPage({ title: 'Mes bons de commande', icon: 'truck', back: '#/t' });
  const billed = (o) => o.data.status === 'facturee';
  const list = orders.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  const due = list.filter((o) => !billed(o) && o.data.status !== 'annulee');
  page.innerHTML = `${due.length ? `<div class="t-sum"><span>Pas encore facturés</span><b>${money(due.reduce((x, o) => x + totals(o.data).base, 0))}</b><small>${due.length} bon(s) · HT</small></div>` : ''}
    <div class="s-cards">${list.map((o) => `<a class="s-card" href="#/print/order/${o.id}"><span class="s-ct"><b>${esc(o.number || 'Commande')}</b><small>${fmtDate(o.data.date)}${tName(projects, o.project_id) ? ` · ${esc(tName(projects, o.project_id))}` : ''}${o.data.deliveryDate ? ` · pour le ${fmtDate(o.data.deliveryDate)}` : ''}</small></span>
      <span class="s-ca"><b>${money(totals(o.data).base)}</b>${billed(o) ? '<em style="--c:#2f9e44">Facturé ✓</em>' : o.data.status === 'annulee' ? '<em style="--c:#868e96">Annulé</em>' : '<em style="--c:#e2a12b">Pas encore facturé</em>'}</span></a>`).join('') || '<p class="muted s-empty">Aucun bon de commande reçu pour l\'instant.</p>'}</div>`;
}

// ---------------------------------------------------------------- Mon planning
async function tPlanning() {
  const [projects, assigns, phases] = await Promise.all([tProjects(), db.list('assign'), db.list('phase')]);
  const page = tPage({ title: 'Mon planning', icon: 'calendar', back: '#/t' });
  const F = S.field || {};
  const ass = assigns.filter((x) => x.data.date >= today()).sort((a, b) => a.data.date.localeCompare(b.data.date));
  const ph = phases.filter((x) => (x.data.end || '') >= today() && ((F.employeeId && (x.data.staff || []).map(Number).includes(F.employeeId)) || (F.contactId && +x.data.companyId === F.contactId)))
    .sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const byDay = {}; ass.forEach((x) => { (byDay[x.data.date] = byDay[x.data.date] || []).push(x); });
  page.innerHTML = `${Object.entries(byDay).slice(0, 21).map(([d, l]) => `<div class="card t-plan"><div class="t-pd ${d === today() ? 'now' : ''}">${d === today() ? 'Aujourd\'hui' : esc(T_DAY(d))}</div>
      ${l.map((x) => `<a class="t-pl" href="#/t/chantier/${x.project_id}"><b>${esc(tName(projects, x.project_id) || 'Chantier')}</b><span>${tHalf(x)}${x.data.note ? ` · ${esc(x.data.note)}` : ''}</span></a>`).join('')}</div>`).join('')}
    ${ph.length ? `<h3 class="t-h">Mes travaux prévus</h3><div class="card t-plan">${ph.map((x) => `<a class="t-pl" href="#/t/chantier/${x.project_id}"><b>${esc(x.data.name)}</b><span>${esc(tName(projects, x.project_id))} · du ${fmtDate(x.data.start)} au ${fmtDate(x.data.end)}</span></a>`).join('')}</div>` : ''}
    ${!ass.length && !ph.length ? `<div class="todo-empty">${I.calendar}<b>Rien de planifié</b><span>Le bureau n'a pas encore prévu votre planning.</span></div>` : ''}`;
}

// ================================================================ Côté bureau : rapports de terrain
// Rapports envoyés par les ouvriers / sous-traitants (remarques, photos) et rapports envoyés par le bureau au terrain.
const fieldUsers = () => S.users.filter((u) => ['ouvrier', 'soustraitant'].includes(u.role) && u.active);
const ROLE_LABELS = { admin: ['Administrateur', '#7048e8'], user: ['Bureau', '#1c2550'], ouvrier: ['Ouvrier', '#3f7a68'], soustraitant: ['Sous-traitant', '#c98a17'] };
function reportRows(list, projects) {
  return list.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id).map((r) => {
    const u = S.users.find((x) => x.id === +r.created_by) || { name: '—', role: '' };
    const field = ['ouvrier', 'soustraitant'].includes(u.role);
    const unread = field && !(r.data.readBy || []).map(Number).includes(S.me.id);
    const to = (r.data.to || []).map((id) => (S.users.find((x) => x.id === +id) || {}).name).filter(Boolean);
    return `<a class="rep-row ${unread ? 'unread' : ''}" href="#/report/${r.id}"><span class="rep-ic ${field ? 'in' : 'out'}">${field ? I.download : I.send}</span>
      <span class="rep-tx"><b>${unread ? '<i class="t-dot"></i>' : ''}${esc(r.data.title || 'Rapport')}</b><small>${fmtDate(r.data.date)} · ${field ? `de ${esc(u.name)}` : `à ${esc(to.join(', ') || '—')}`}${tName(projects, r.project_id) ? ` · ${esc(tName(projects, r.project_id))}` : ''}</small>${r.data.text ? `<small class="t-ex">${esc(r.data.text.split('\n')[0])}</small>` : ''}</span>
      <span class="rep-n">${(r.data.photos || []).length ? `${I.camera}${r.data.photos.length}` : ''}</span></a>`;
  }).join('');
}
async function reportsPanel(el, projectId) {
  const [reports, projects] = await Promise.all([db.list('report', projectId ? { project: projectId } : undefined), db.list('project')]);
  el.innerHTML = `<div class="toolbar"><span class="muted grow">Remarques et photos envoyées par le terrain, rapports envoyés à vos ouvriers et sous-traitants.</span><button class="btn primary" data-act="nrep">${I.send} Envoyer un rapport</button></div>
    <div class="card rep-list">${reportRows(reports, projects) || '<p class="muted">Aucun rapport pour l\'instant.</p>'}</div>`;
  $('[data-act=nrep]', el).onclick = () => sendReport(projectId);
}
route('reports', async () => {
  const page = layout({ title: 'Rapports terrain', icon: 'fiche' });
  await reportsPanel(page, null);
});
route('report', async (id) => {
  const [r, projects] = await Promise.all([db.get('report', +id), db.list('project')]);
  const u = S.users.find((x) => x.id === +r.created_by) || { name: '—' };
  const page = layout({ title: r.data.title || 'Rapport', icon: 'fiche', back: r.project_id ? `#/project/${r.project_id}/reports` : '#/reports',
    sub: `${fmtDate(r.data.date)} · ${esc(u.name)}${tName(projects, r.project_id) ? ` · <a href="#/project/${r.project_id}">${esc(tName(projects, r.project_id))}</a>` : ''}`,
    actions: `<button class="btn danger ghost" data-act="del">${I.trash} Supprimer</button>` });
  const to = (r.data.to || []).map((x) => S.users.find((y) => y.id === +x)).filter(Boolean);
  page.innerHTML = `<div class="card">${r.data.text ? `<div class="pre t-txt">${esc(r.data.text)}</div>` : '<p class="muted">Pas de texte.</p>'}
    ${(r.data.photos || []).length ? `<div class="t-photos big">${r.data.photos.map((fid) => `<a href="${fileUrl(fid)}" target="_blank" rel="noopener"><img src="${fileUrl(fid)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    ${(r.data.files || []).length ? `<div class="chips">${r.data.files.map((x) => `<a class="chip" href="${fileUrl(x.id)}" target="_blank" rel="noopener">${I.file} ${esc(x.name || 'Document')}</a>`).join('')}</div>` : ''}
    ${to.length ? `<p class="muted" style="margin-top:12px">Envoyé à : ${to.map((x) => `${esc(x.name)} ${(r.data.readBy || []).map(Number).includes(x.id) ? badge('lu', '#2f9e44') : badge('pas encore lu', '#868e96')}`).join(' · ')}</p>` : ''}</div>`;
  $('[data-act=del]').onclick = async () => { if (!confirm('Supprimer ce rapport ?')) return; await db.del('report', r.id); go(r.project_id ? `#/project/${r.project_id}/reports` : '#/reports'); };
  if (!(r.data.readBy || []).map(Number).includes(S.me.id)) api('POST', `seen/${r.id}`).catch(() => {});
});
// Le bureau envoie un rapport (texte + photos / PDF) aux ouvriers et sous-traitants choisis
async function sendReport(projectId, toIds = []) {
  const [projects, staff, contacts] = await Promise.all([db.list('project'), db.list('employee'), db.list('contact')]);
  const fu = fieldUsers();
  if (!fu.length) return toast('Créez d\'abord un accès « Ouvrier » ou « Sous-traitant » (Paramètres → Utilisateurs)', 5000);
  const p = projectId ? byId(projects, projectId) : null;
  // destinataires proposés : l'équipe du chantier en premier
  const onSite = (u) => p && (((p.data.team || []).map(Number).includes(u.id)) || staff.some((e) => +e.data.userId === u.id) || contacts.some((c) => +c.data.userId === u.id && (p.data.subs || []).map(Number).includes(c.id)));
  const files = [];
  const m = modal(`${mhead('Envoyer un rapport au terrain')}<form class="m-body"><div class="grid-form">
    ${fieldHTML({ name: 'project_id', label: 'Chantier', type: 'select', options: [['', '— aucun —'], ...projects.map((x) => [x.id, `${x.number} · ${x.data.name}`])], cls: 'full' }, projectId || '')}
    ${fieldHTML({ name: 'title', label: 'Titre', cls: 'full', placeholder: 'Ex. : Consignes semaine 44, PV de réunion…' }, '')}
    <div class="field full"><span>Destinataires</span><div class="multi">${fu.map((u) => `<label class="chk"><input type="checkbox" value="${u.id}" ${toIds.includes(u.id) || (!toIds.length && onSite(u)) ? 'checked' : ''}>${esc(u.name)} <small class="muted">${esc((ROLE_LABELS[u.role] || [''])[0])}</small></label>`).join('')}</div></div>
    ${fieldHTML({ name: 'text', label: 'Message / remarques', type: 'textarea', rows: 6, cls: 'full' }, '')}
    <div class="field full"><span>Photos et documents (PDF…)</span><div class="chips" data-fl></div><button type="button" class="btn" data-pick>${I.upload} Joindre des fichiers</button></div></div></form>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>${I.send} Envoyer</button></div>`, { wide: true });
  const draw = () => { $('[data-fl]', m.el).innerHTML = files.map((f, i) => `<span class="chip">${esc(f.name)} <button type="button" class="link-btn" data-rm="${i}">×</button></span>`).join(''); $$('[data-rm]', m.el).forEach((b) => { b.onclick = () => { files.splice(+b.dataset.rm, 1); draw(); }; }); };
  $('[data-pick]', m.el).onclick = async () => { const l = await pickFile('image/*,application/pdf,.doc,.docx,.xls,.xlsx', true); files.push(...(l || [])); draw(); };
  $('[data-ok]', m.el).onclick = async (e) => {
    const to = $$('.multi input:checked', m.el).map((x) => +x.value);
    const text = $('[name=text]', m.el).value.trim(); const title = $('[name=title]', m.el).value.trim();
    const pid = +$('[name=project_id]', m.el).value || null;
    if (!to.length) return toast('Choisissez au moins un destinataire', 3000);
    if (!text && !files.length) return toast('Écrivez un message ou joignez un fichier', 3000);
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const photos = []; const docs = [];
      for (const f of files) { if (/^image\//.test(f.type)) photos.push((await uploadPhoto(f, pid)).id); else { const up = await upload(f, pid); docs.push({ id: up.id, name: up.name }); } }
      await persist('report', { project_id: pid, data: { kind: 'bureau', date: today(), title: title || `Rapport du ${fmtDate(today())}`, text, photos, files: docs, to, readBy: [S.me.id] } });
      m.close(); toast('Rapport envoyé ✓', 2500); render();
    } catch (err) { btn.disabled = false; toast('Erreur : ' + err.message, 4000); }
  };
}
