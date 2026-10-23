'use strict';
/* Espace terrain : ce que voit un ouvrier ou un sous-traitant connecté.
   Ses chantiers, ses heures du jour, ses rapports (remarques + photos), les rapports envoyés par le bureau,
   ses bons de commande avec leur statut de facturation, et son planning. Le serveur ne lui envoie rien d'autre. */

const T_DAY = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
const tProjects = () => db.list('project');
const tName = (projects, id) => ((byId(projects, id) || { data: {} }).data.name || '');
const isSub = () => S.me.role === 'soustraitant';
// rapports reçus du bureau et pas encore lus
const tUnread = (reports) => reports.filter((r) => (r.data.to || []).map(Number).includes(S.me.id) && !(r.data.readBy || []).map(Number).includes(S.me.id));

function installHelp() {
  modal(`${mhead('Installer sur le téléphone')}<div class="m-body s-dict">
    <p><b>iPhone</b> : dans Safari, touchez <b>Partager</b> (carré avec une flèche), puis <b>Sur l'écran d'accueil</b>.</p>
    <p><b>Android</b> : dans Chrome, touchez <b>⋮</b> puis <b>Installer l'application</b>.</p>
    <p class="muted">L'application s'ouvre ensuite comme les autres, sans la barre du navigateur.</p></div>`);
}

route('t', async (screen, a) => {
  if (!screen) return tHome();
  if (screen === 'chantier') return tSite(+a);
  if (screen === 'heures') return tHours(a);
  if (screen === 'rapports') return tReports(a);
  if (screen === 'rapport') return a === 'new' ? tReportNew() : tReport(+a);
  if (screen === 'photos') { location.hash = '#/t/rapport/new?kind=photos'; return; }
  if (screen === 'commandes') return tOrders();
  if (screen === 'planning') return tPlanning();
  return tHome();
});

// ---------------------------------------------------------------- Accueil : mes chantiers + gestes rapides
async function tHome() {
  const [projects, reports, sheets] = await Promise.all([tProjects(), db.list('report'), db.list('timesheet')]);
  const page = layout({ title: 'Mes chantiers', icon: 'crane' });
  const unread = tUnread(reports);
  const todayH = sheets.filter((t) => t.data.date === today()).reduce((x, t) => x + num(t.data.hours), 0);
  const active = projects.filter((p) => !['termine', 'annule'].includes(p.data.status));
  page.classList.add('s-page', 't-page');
  page.innerHTML = `<div class="today-hello"><b>Bonjour ${esc((S.me.name || '').split(' ')[0])}</b><span>${esc(T_DAY(today()))}${isSub() ? ' · espace sous-traitant' : ''}</span></div>
    ${pushState() !== 'on' && pushState() !== 'denied' ? `<button type="button" class="t-alert soft" data-push>${I.bell}<span><b>Activer les notifications</b><br><small>Rappel pour vos heures, nouveaux rapports et commandes</small></span>${I.chevron}</button>` : ''}
    ${unread.length ? `<a class="t-alert" href="#/t/rapports">${I.bell}<span><b>${unread.length} rapport${unread.length > 1 ? 's' : ''} du bureau</b> à lire</span>${I.chevron}</a>` : ''}
    <div class="t-acts">
      <a class="s-tile t1" href="#/t/heures">${I.clock}<b>Mes heures</b><small>${todayH ? `${fnum(todayH, 1)} h aujourd'hui` : 'pas encore encodées'}</small></a>
      <a class="s-tile t3" href="#/t/photos">${I.camera}<b>Envoyer des photos</b></a>
      <a class="s-tile t2" href="#/t/rapport/new">${I.fiche}<b>Faire un rapport</b><small>remarques</small></a>
      ${isSub() ? `<a class="s-tile t4" href="#/t/commandes">${I.truck}<b>Mes commandes</b></a>` : `<a class="s-tile t4" href="#/t/planning">${I.calendar}<b>Mon planning</b></a>`}
    </div>
    <h3 class="t-h">Mes chantiers</h3>
    <div class="s-list">${active.length ? active.map((p) => sBtn(`data-p="${p.id}"`, 'crane', esc(p.data.name), esc([p.data.address, p.data.city].filter(Boolean).join(', ') || st(PST, p.data.status).replace(/<[^>]+>/g, '')))).join('')
      : '<div class="todo-empty">' + I.crane + '<b>Aucun chantier pour l\'instant</b><span>Le bureau vous ajoutera à vos chantiers.</span></div>'}</div>`;
  $$('[data-p]', page).forEach((b) => { b.onclick = () => go(`#/t/chantier/${b.dataset.p}`); });
  const pb = $('[data-push]', page); if (pb) pb.onclick = () => pushEnable();
}

// ---------------------------------------------------------------- Un chantier : adresse, mon planning, gestes, rapports
async function tSite(id) {
  const [p, reports, phases, assigns] = await Promise.all([db.get('project', id), db.list('report', { project: id }), db.list('phase', { project: id }), db.list('assign')]);
  const page = layout({ title: p.data.name, icon: 'crane', back: '#/t', sub: esc([p.number, p.data.city].filter(Boolean).join(' · ')) });
  page.classList.add('s-page', 't-page');
  const addr = [p.data.address, [p.data.zip, p.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const mine = assigns.filter((x) => +x.project_id === id && x.data.date >= today()).sort((x, y) => x.data.date.localeCompare(y.data.date)).slice(0, 6);
  const ph = phases.filter((x) => (x.data.end || '') >= today()).sort((x, y) => (x.data.start || '').localeCompare(y.data.start || ''));
  const rs = reports.sort((x, y) => (y.data.date || '').localeCompare(x.data.date || '') || y.id - x.id);
  page.innerHTML = `${addr ? `<a class="s-note" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">${I.pin}<span>${esc(addr)}</span><b>Itinéraire</b></a>` : ''}
    <div class="t-acts three">
      <a class="s-tile t1" href="#/t/heures?p=${id}">${I.clock}<b>Heures</b></a>
      <a class="s-tile t3" href="#/t/rapport/new?kind=photos&p=${id}">${I.camera}<b>Photos</b></a>
      <a class="s-tile t2" href="#/t/rapport/new?p=${id}">${I.fiche}<b>Rapport</b></a>
    </div>
    ${mine.length || ph.length ? `<h3 class="t-h">Mon planning ici</h3><div class="card t-plan">${mine.map((x) => `<div class="t-pl"><b>${esc(T_DAY(x.data.date))}</b><span>${x.data.half === 'am' ? 'Matin' : x.data.half === 'pm' ? 'Après-midi' : 'Journée'}${x.data.note ? ` · ${esc(x.data.note)}` : ''}</span></div>`).join('')}
      ${ph.map((x) => `<div class="t-pl"><b>${esc(x.data.name)}</b><span>du ${fmtDate(x.data.start)} au ${fmtDate(x.data.end)}${x.data.progress ? ` · ${x.data.progress} %` : ''}</span></div>`).join('')}</div>` : ''}
    <h3 class="t-h">Rapports de ce chantier</h3>
    <div class="s-cards">${rs.map((r) => tReportCard(r, [p])).join('') || '<p class="muted s-empty">Aucun rapport pour l\'instant.</p>'}</div>`;
}

// ---------------------------------------------------------------- Mes heures (pointage du jour)
async function tHours() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const day = q.get('d') || today(); const pre = +q.get('p') || 0;
  const [projects, sheets] = await Promise.all([tProjects(), db.list('timesheet')]);
  const page = layout({ title: 'Mes heures', icon: 'clock' });
  page.classList.add('s-page', 't-page');
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const sumDay = (d) => sheets.filter((t) => t.data.date === d).reduce((x, t) => x + num(t.data.hours), 0);
  const week = days.reduce((x, d) => x + sumDay(d), 0);
  const list = sheets.filter((t) => t.data.date === day);
  const active = projects.filter((p) => !['termine', 'annule'].includes(p.data.status));
  page.innerHTML = `<div class="t-days">${days.map((d) => `<a href="#/t/heures?d=${d}" class="${d === day ? 'on' : ''}"><small>${new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short' })}</small><b>${+d.slice(8)}</b><i>${sumDay(d) ? fnum(sumDay(d), 1) + ' h' : '·'}</i></a>`).join('')}</div>
    <div class="t-sum"><span>${esc(T_DAY(day))}</span><b>${fnum(sumDay(day), 1)} h</b><small>Semaine : ${fnum(week, 1)} h</small></div>
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
function tReportCard(r, projects) {
  const mine = +r.created_by === S.me.id;
  const unread = !mine && !(r.data.readBy || []).map(Number).includes(S.me.id);
  const from = mine ? 'Moi' : (S.users.find((u) => u.id === +r.created_by) || { name: 'Le bureau' }).name;
  const n = (r.data.photos || []).length + (r.data.files || []).length;
  return `<a class="s-card t-rep ${unread ? 'unread' : ''}" href="#/t/rapport/${r.id}"><span class="s-ct"><b>${unread ? '<i class="t-dot"></i>' : ''}${esc(r.data.title || (r.data.kind === 'photos' ? 'Photos du chantier' : 'Rapport'))}</b>
    <small>${fmtDate(r.data.date)} · ${esc(from)}${tName(projects, r.project_id) ? ` · ${esc(tName(projects, r.project_id))}` : ''}</small>${r.data.text ? `<small class="t-ex">${esc(r.data.text.split('\n')[0])}</small>` : ''}</span>
    <span class="s-ca">${n ? `<em style="--c:#3f7a68">${I.camera} ${n}</em>` : ''}</span></a>`;
}
async function tReports() {
  const f = new URLSearchParams(location.hash.split('?')[1] || '').get('f') || 'recus';
  const [reports, projects] = await Promise.all([db.list('report'), tProjects()]);
  const page = layout({ title: 'Rapports', icon: 'fiche' });
  page.classList.add('s-page', 't-page');
  const got = reports.filter((r) => +r.created_by !== S.me.id); const sent = reports.filter((r) => +r.created_by === S.me.id);
  const list = (f === 'envoyes' ? sent : got).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  const un = tUnread(reports).length;
  page.innerHTML = `<button class="s-big primary" data-new>${I.plus} Faire un rapport</button>
    <div class="s-chips s-filter"><a href="#/t/rapports?f=recus" class="${f === 'recus' ? 'on' : ''}">Reçus du bureau${un ? ` (${un})` : ''}</a><a href="#/t/rapports?f=envoyes" class="${f === 'envoyes' ? 'on' : ''}">Mes rapports</a></div>
    <div class="s-cards">${list.map((r) => tReportCard(r, projects)).join('') || `<p class="muted s-empty">${f === 'envoyes' ? 'Vous n\'avez pas encore envoyé de rapport.' : 'Aucun rapport reçu pour l\'instant.'}</p>`}</div>`;
  $('[data-new]', page).onclick = () => go('#/t/rapport/new');
}
async function tReport(id) {
  const [r, projects] = await Promise.all([db.get('report', id), tProjects()]);
  const page = layout({ title: r.data.title || (r.data.kind === 'photos' ? 'Photos du chantier' : 'Rapport'), icon: 'fiche', back: '#/t/rapports' + (+r.created_by === S.me.id ? '?f=envoyes' : '') });
  page.classList.add('s-page', 't-page');
  const from = +r.created_by === S.me.id ? 'Moi' : (S.users.find((u) => u.id === +r.created_by) || { name: 'Le bureau' }).name;
  page.innerHTML = `<div class="card t-repv"><div class="t-meta">${fmtDate(r.data.date)} · ${esc(from)}${tName(projects, r.project_id) ? ` · <a href="#/t/chantier/${r.project_id}">${esc(tName(projects, r.project_id))}</a>` : ''}</div>
    ${r.data.text ? `<div class="pre t-txt">${esc(r.data.text)}</div>` : ''}
    ${(r.data.photos || []).length ? `<div class="t-photos">${r.data.photos.map((fid) => `<a href="${fileUrl(fid)}" target="_blank" rel="noopener"><img src="${fileUrl(fid)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    ${(r.data.files || []).length ? `<div class="s-list">${r.data.files.map((x) => sBtn(`data-f="${x.id}"`, 'file', esc(x.name || 'Document'), 'ouvrir')).join('')}</div>` : ''}</div>
    ${+r.created_by === S.me.id ? sBtn('data-del', 'trash', 'Supprimer ce rapport', '', 'danger') : ''}`;
  $$('[data-f]', page).forEach((b) => { b.onclick = () => window.open(fileUrl(+b.dataset.f), '_blank'); });
  const del = $('[data-del]', page); if (del) del.onclick = async () => { if (!confirm('Supprimer ce rapport et ses photos ?')) return; for (const fid of r.data.photos || []) await delFile(fid); await db.del('report', r.id); go('#/t/rapports?f=envoyes'); };
  if (+r.created_by !== S.me.id && !(r.data.readBy || []).map(Number).includes(S.me.id)) api('POST', `seen/${r.id}`).catch(() => {});
}
async function tReportNew() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const kind = q.get('kind') === 'photos' ? 'photos' : 'rapport';
  const projects = (await tProjects()).filter((p) => !['termine', 'annule'].includes(p.data.status));
  const page = layout({ title: kind === 'photos' ? 'Envoyer des photos' : 'Nouveau rapport', icon: kind === 'photos' ? 'camera' : 'fiche', back: '#/t/rapports' });
  page.classList.add('s-page', 't-page');
  const photos = [];
  page.innerHTML = `<div class="s-form">
    <label class="field"><span>Chantier</span><select name="pid">${projects.map((p) => `<option value="${p.id}" ${+q.get('p') === p.id ? 'selected' : ''}>${esc(p.data.name)}</option>`).join('')}</select></label>
    <button type="button" class="s-huge" data-cam>${I.camera}<b>${kind === 'photos' ? 'Prendre des photos' : 'Ajouter des photos'}</b></button>
    <div class="t-photos" data-ph></div>
    <label class="field"><span>${kind === 'photos' ? 'Un mot (facultatif)' : 'Remarques'}</span><div class="s-desc"><textarea name="text" rows="${kind === 'photos' ? 2 : 6}" placeholder="${kind === 'photos' ? 'Ex. : fin de la chape, étage 1' : 'Ce qui a été fait, ce qui manque, les problèmes…'}"></textarea><button type="button" class="s-mic" data-mic aria-label="Dicter">🎤</button></div></label>
    <button class="s-big primary" data-send>${I.send} Envoyer au bureau</button></div>`;
  if (!projects.length) { page.innerHTML = '<div class="todo-empty">' + I.crane + '<b>Aucun chantier attribué</b><span>Le bureau doit d\'abord vous ajouter à un chantier.</span></div>'; return; }
  const ta = $('[name=text]', page); micFor($('[data-mic]', page), ta);
  const drawPh = () => { $('[data-ph]', page).innerHTML = photos.map((x, i) => `<span class="t-ph"><img src="${x.url}" alt=""><button type="button" data-x="${i}" aria-label="Retirer">${I.x}</button></span>`).join('');
    $$('[data-x]', page).forEach((b) => { b.onclick = () => { photos.splice(+b.dataset.x, 1); drawPh(); }; }); };
  $('[data-cam]', page).onclick = async () => {
    const files = await pickFile('image/*', true, kind === 'photos' ? 'environment' : '');
    for (const f of files || []) photos.push({ file: f, url: URL.createObjectURL(f) });
    drawPh();
  };
  $('[data-send]', page).onclick = async (e) => {
    const text = ta.value.trim(); const pid = +$('[name=pid]', page).value;
    if (!photos.length && !text) return toast(kind === 'photos' ? 'Ajoutez au moins une photo' : 'Écrivez vos remarques ou ajoutez des photos', 3500);
    const btn = e.currentTarget; btn.disabled = true; toast('Envoi…', 30000);
    try {
      const ids = [];
      for (const x of photos) ids.push((await uploadPhoto(x.file, pid)).id);
      await persist('report', { project_id: pid, data: { kind, date: today(), title: kind === 'photos' ? `Photos – ${tName(projects, pid)}` : `Rapport – ${tName(projects, pid)}`, text, photos: ids, to: [] } });
      toast('Envoyé au bureau ✓', 2500); go('#/t/rapports?f=envoyes');
    } catch (err) { toast('Envoi impossible : ' + err.message, 5000); btn.disabled = false; }
  };
}

// ---------------------------------------------------------------- Bons de commande (sous-traitant)
async function tOrders() {
  const [orders, projects] = await Promise.all([db.list('order'), tProjects()]);
  const page = layout({ title: 'Mes bons de commande', icon: 'truck' });
  page.classList.add('s-page', 't-page');
  const billed = (o) => o.data.status === 'facturee';
  const list = orders.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  const due = list.filter((o) => !billed(o) && o.data.status !== 'annulee');
  page.innerHTML = `${due.length ? `<div class="t-sum"><span>Pas encore facturées</span><b>${money(due.reduce((x, o) => x + totals(o.data).base, 0))}</b><small>${due.length} commande(s) · HT</small></div>` : ''}
    <div class="s-cards">${list.map((o) => `<a class="s-card" href="#/print/order/${o.id}"><span class="s-ct"><b>${esc(o.number || 'Commande')}</b><small>${fmtDate(o.data.date)}${tName(projects, o.project_id) ? ` · ${esc(tName(projects, o.project_id))}` : ''}${o.data.deliveryDate ? ` · pour le ${fmtDate(o.data.deliveryDate)}` : ''}</small></span>
      <span class="s-ca"><b>${money(totals(o.data).base)}</b>${billed(o) ? '<em style="--c:#2f9e44">Facturée ✓</em>' : o.data.status === 'annulee' ? '<em style="--c:#868e96">Annulée</em>' : `<em style="--c:#e2a12b">Pas encore facturée</em>`}</span></a>`).join('') || '<p class="muted s-empty">Aucun bon de commande reçu pour l\'instant.</p>'}</div>`;
}

// ---------------------------------------------------------------- Mon planning
async function tPlanning() {
  const [projects, assigns, phases] = await Promise.all([tProjects(), db.list('assign'), db.list('phase')]);
  const page = layout({ title: 'Mon planning', icon: 'calendar' });
  page.classList.add('s-page', 't-page');
  const F = S.field || {};
  const from = addDays(today(), -1);
  const ass = assigns.filter((x) => x.data.date >= today()).sort((a, b) => a.data.date.localeCompare(b.data.date));
  const ph = phases.filter((x) => (x.data.end || '') >= from && ((F.employeeId && (x.data.staff || []).map(Number).includes(F.employeeId)) || (F.contactId && +x.data.companyId === F.contactId)))
    .sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''));
  const byDay = {}; ass.forEach((x) => { (byDay[x.data.date] = byDay[x.data.date] || []).push(x); });
  page.innerHTML = `${Object.keys(byDay).length ? `<h3 class="t-h">Où je travaille</h3>${Object.entries(byDay).slice(0, 21).map(([d, l]) => `<div class="card t-plan"><div class="t-pd ${d === today() ? 'now' : ''}">${d === today() ? 'Aujourd\'hui' : esc(T_DAY(d))}</div>
      ${l.map((x) => `<a class="t-pl" href="#/t/chantier/${x.project_id}"><b>${esc(tName(projects, x.project_id) || 'Chantier')}</b><span>${x.data.half === 'am' ? 'Matin' : x.data.half === 'pm' ? 'Après-midi' : 'Journée'}${x.data.note ? ` · ${esc(x.data.note)}` : ''}</span></a>`).join('')}</div>`).join('')}` : ''}
    ${ph.length ? `<h3 class="t-h">Mes phases de travaux</h3><div class="card t-plan">${ph.map((x) => `<a class="t-pl" href="#/t/chantier/${x.project_id}"><b>${esc(x.data.name)}</b><span>${esc(tName(projects, x.project_id))} · du ${fmtDate(x.data.start)} au ${fmtDate(x.data.end)}</span>${x.data.progress ? `<i class="wk-bar"><i style="width:${num(x.data.progress)}%"></i></i>` : ''}</a>`).join('')}</div>` : ''}
    ${!Object.keys(byDay).length && !ph.length ? '<div class="todo-empty">' + I.calendar + '<b>Rien de planifié</b><span>Le bureau n\'a pas encore prévu votre planning.</span></div>' : ''}`;
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
async function sendReport(projectId) {
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
    <div class="field full"><span>Destinataires</span><div class="multi">${fu.map((u) => `<label class="chk"><input type="checkbox" value="${u.id}" ${onSite(u) ? 'checked' : ''}>${esc(u.name)} <small class="muted">${esc((ROLE_LABELS[u.role] || [''])[0])}</small></label>`).join('')}</div></div>
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
