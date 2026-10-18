'use strict';
/* Tâches, plannings (Gantt des chantiers, planning des équipes), interventions et installations. */

// ---------------------------------------------------------------- Tâches
async function editTask(t, preset = {}) {
  const projects = await db.list('project');
  formModal({
    title: t ? 'Tâche' : 'Nouvelle tâche', wide: true, values: t ? { ...t.data, project_id: t.project_id } : { status: 'todo', priority: 'normal', assignees: [S.me.id], due: today(), ...preset },
    fields: [
      { name: 'title', label: 'Tâche', required: true, cls: 'full' },
      { name: 'project_id', label: 'Chantier', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])] },
      { name: 'due', label: 'Échéance', type: 'date' }, { name: 'status', label: 'Statut', type: 'select', options: optsOf(TST) }, { name: 'priority', label: 'Priorité', type: 'select', options: optsOf(PRIO) },
      { name: 'assignees', label: 'Assignée à', type: 'users', cls: 'full' }, { name: 'notes', label: 'Détails', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { const it = t || { data: {} }; it.project_id = v.project_id ? +v.project_id : null; delete v.project_id; it.data = { ...it.data, ...v }; if (v.status === 'done' && !it.data.doneAt) it.data.doneAt = today(); await persist('task', it); render(); },
    onDelete: t ? async () => { await db.del('task', t.id); render(); } : null,
  });
}
route('tasks', async () => {
  const [tasks, projects] = await Promise.all([db.list('task'), db.list('project')]);
  const page = layout({ active: 'tasks', icon: 'tasks', title: 'Tâches', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle tâche</button>` });
  const stt = ui.tbl_tasks || (ui.tbl_tasks = { f: 'mine', sort: 4 });
  dataTable(page, {
    rows: tasks, state: stt,
    search: (t) => [t.data.title, t.data.notes, (byId(projects, t.project_id) || { data: {} }).data.name].join(' '),
    filters: { def: 'mine', options: [['mine', 'Mes tâches'], ['open', 'Toutes à faire'], ['late', 'En retard', '#e5484d'], ['done', 'Terminées', '#2f9e44'], ['', 'Toutes']],
      match: (t, f) => (f === 'mine' ? (t.data.assignees || []).includes(S.me.id) && t.data.status !== 'done' : f === 'open' ? t.data.status !== 'done' : f === 'late' ? t.data.status !== 'done' && t.data.due && t.data.due < today() : t.data.status === f) },
    columns: [
      { l: '', v: (t) => `<input type="checkbox" data-done="${t.id}" ${t.data.status === 'done' ? 'checked' : ''}>` },
      { l: 'Tâche', v: (t) => `<b class="${t.data.status === 'done' ? 'strike' : ''}">${esc(t.data.title)}</b>${t.data.notes ? `<br><small class="muted">${esc(t.data.notes.split('\n')[0])}</small>` : ''}` },
      { l: 'Chantier', v: (t) => (t.project_id ? `<a href="#/project/${t.project_id}">${esc((byId(projects, t.project_id) || { data: {} }).data.name || '')}</a>` : '') },
      { l: 'Échéance', v: (t) => `<span class="${t.data.status !== 'done' && t.data.due && t.data.due < today() ? 'late' : ''}">${fmtDate(t.data.due)}</span>`, sort: (t) => t.data.due || '9' },
      { l: 'Priorité', v: (t) => st(PRIO, t.data.priority), sort: (t) => Object.keys(PRIO).indexOf(t.data.priority) * -1 },
      { l: 'Statut', v: (t) => st(TST, t.data.status) },
      { l: 'Assignée', v: (t) => (t.data.assignees || []).map((u) => avatar(+u)).join('') },
    ],
    onRow: (t) => editTask(t), empty: 'Aucune tâche',
  });
  const bind = () => $$('[data-done]', page).forEach((c) => { c.onclick = async (e) => { e.stopPropagation(); const t = tasks.find((x) => x.id === +c.dataset.done); t.data.status = c.checked ? 'done' : 'todo'; t.data.doneAt = c.checked ? today() : null; await persist('task', t); render(); }; });
  bind(); new MutationObserver(bind).observe(page, { childList: true, subtree: true });
  $('[data-act=new]').onclick = () => editTask();
});

// ---------------------------------------------------------------- Gantt
const ZOOMS = { day: ['Jours', 32], week: ['Semaines', 13], month: ['Mois', 5] };
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const phaseColor = (t, fallback) => (num(t.data.progress) >= 100 ? '#2f9e44' : t.data.end < today() ? '#e5484d' : fallback || '#3b5bdb');
function ganttHTML(rows) {
  const tasks = rows.filter((r) => r.item).map((r) => r.item.data);
  if (!tasks.length) return '';
  const zoom = ZOOMS[ui.gzoom] ? ui.gzoom : 'week'; const dw = ZOOMS[zoom][1];
  const t0 = dnum(today());
  let a = Math.min(t0, ...tasks.map((t) => dnum(t.start))) - 3; a -= (new Date(a * DAY).getUTCDay() + 6) % 7;
  const b = Math.max(t0, ...tasks.map((t) => dnum(t.end))) + (zoom === 'month' ? 30 : 10);
  const days = b - a + 1; const W = days * dw;
  let months = ''; let ticks = ''; let we = '';
  for (let i = 0; i < days; i++) {
    const dt = new Date((a + i) * DAY); const dd = dt.getUTCDate(); const wd = dt.getUTCDay();
    if (dd === 1 || i === 0) { let len = 0; while (i + len < days && (len === 0 || new Date((a + i + len) * DAY).getUTCDate() !== 1)) len++; months += `<div class="g-m" style="left:${i * dw}px;width:${len * dw}px">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`; }
    if (zoom === 'day') ticks += `<div class="g-d ${wd === 0 || wd === 6 ? 'we' : ''}" style="left:${i * dw}px;width:${dw}px">${dd}</div>`;
    else if (zoom === 'week' && wd === 1) ticks += `<div class="g-d" style="left:${i * dw}px;width:${7 * dw}px;text-align:left;padding-left:3px">${dd}</div>`;
    if (wd === 6 && zoom !== 'month') we += `<div class="g-we" style="left:${i * dw}px;width:${2 * dw}px"></div>`;
  }
  return `<div class="gantt" data-today="${(t0 - a) * dw}"><div class="g-inner" style="width:calc(var(--nw) + ${W}px)">
    <div class="g-over" style="width:${W}px">${we}<div class="g-today" style="left:${(t0 - a) * dw + dw / 2}px"></div></div>
    <div class="g-row g-head"><div class="g-name"><small>Phase</small></div><div class="g-track" style="width:${W}px">${months}${ticks}</div></div>
    ${rows.map((r) => {
      if (!r.item) return `<div class="g-row g-group"><a class="g-name" href="${r.href || '#'}"><b><i class="dot" style="--c:${esc(r.color || '#3b5bdb')}"></i> ${esc(r.label)}</b></a><div class="g-track" style="width:${W}px"></div></div>`;
      const t = r.item.data; const x = (dnum(t.start) - a) * dw; const w = (dnum(t.end) - dnum(t.start) + 1) * dw; const pg = Math.min(100, Math.max(0, num(t.progress)));
      return `<div class="g-row"><button class="g-name" data-task="${r.item.id}"><b>${esc(t.name)}</b><small>${fmtDate(t.start).slice(0, 5)} – ${fmtDate(t.end).slice(0, 5)}${r.sub ? ' · ' + esc(r.sub) : ''}</small></button>
        <div class="g-track" style="width:${W}px"><button class="g-bar" data-task="${r.item.id}" style="left:${x}px;width:${w}px;--c:${phaseColor(r.item, r.color)}"><span class="g-fill" style="width:${pg}%"></span><span class="g-lbl">${pg} %${w > 120 ? ' · ' + esc(t.name) : ''}</span></button></div></div>`;
    }).join('')}</div></div>`;
}
function bindGantt(el, onTask) {
  $$('[data-z]', el).forEach((b) => { b.onclick = () => { ui.gzoom = b.dataset.z; saveUi(); render(); }; });
  $$('[data-task]', el).forEach((b) => { b.onclick = () => onTask(+b.dataset.task); });
  const g = $('.gantt', el); if (g) g.scrollLeft = Math.max(0, +g.dataset.today - 80);
}
const zoomChips = () => `<div class="chips">${Object.entries(ZOOMS).map(([k, [l]]) => `<button class="chip ${(ZOOMS[ui.gzoom] ? ui.gzoom : 'week') === k ? 'on' : ''}" data-z="${k}">${l}</button>`).join('')}
  <span class="chip"><i class="dot" style="--c:#3b5bdb"></i>Planifié</span><span class="chip"><i class="dot" style="--c:#e5484d"></i>En retard</span><span class="chip"><i class="dot" style="--c:#2f9e44"></i>Terminé</span></div>`;

async function editPhase(p, ph) {
  const [contacts, staff] = await Promise.all([db.list('contact'), db.list('employee')]);
  const start = ph ? ph.data.start : today();
  formModal({
    title: ph ? 'Phase' : 'Nouvelle phase', wide: true, values: ph ? ph.data : { start, end: addDays(start, 4), progress: 0 },
    fields: [
      { name: 'name', label: 'Phase', required: true, cls: 'full', placeholder: 'ex. Gros œuvre' },
      { name: 'start', label: 'Début', type: 'date', required: true }, { name: 'end', label: 'Fin', type: 'date', required: true },
      { name: 'progress', label: 'Avancement', type: 'select', options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((x) => [x, x + ' %']) },
      { name: 'companyId', label: 'Sous-traitant', type: 'select', options: [['', '— nos équipes —'], ...contacts.filter((c) => c.data.kind === 'soustraitant').map((c) => [c.id, contactName(c)])] },
      { name: 'staff', label: 'Ouvriers', type: 'multi', options: staff.filter((s) => s.data.active !== false).map((s) => [s.id, s.data.name]), cls: 'full' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { if (v.end < v.start) [v.start, v.end] = [v.end, v.start]; const it = ph || { project_id: p.id, data: {} }; it.data = { ...it.data, ...v, progress: num(v.progress), staff: v.staff.map(Number) }; await persist('phase', it); render(); },
    onDelete: ph ? async () => { await db.del('phase', ph.id); render(); } : null,
  });
}
async function tabPPlanning(p, el) {
  const [phases, contacts, quotes] = await Promise.all([db.list('phase', { project: p.id }), db.list('contact'), db.list('quote', { project: p.id })]);
  phases.sort((a, b) => a.data.start.localeCompare(b.data.start));
  el.innerHTML = `<div class="toolbar">${phases.length ? zoomChips() : ''}<span class="grow"></span>${quotes.length ? '<button class="btn" data-act="gen">Générer depuis un devis</button>' : ''}<button class="btn primary" data-act="new">${I.plus} Nouvelle phase</button></div>
    ${phases.length ? ganttHTML(phases.map((x) => ({ item: x, color: p.data.color, sub: (byId(contacts, x.data.companyId) || { data: {} }).data.company }))) : empty('Aucune phase planifiée', 'Ajoutez les phases du chantier ou générez-les depuis les chapitres d\'un devis.')}`;
  bindGantt(el, (id) => editPhase(p, phases.find((x) => x.id === id)));
  $('[data-act=new]', el).onclick = () => editPhase(p, null);
  const gen = $('[data-act=gen]', el);
  if (gen) gen.onclick = () => menuSheet('Générer depuis le devis…', quotes.map((q) => ({ label: `${q.number} · ${q.data.title || ''}`, run: async () => {
    const titles = q.data.lines.filter((l) => l.kind === 'title');
    if (!titles.length) return toast('Ce devis n\'a pas de chapitres');
    const v = await ask('Générer les phases', [{ name: 'start', label: 'Début', type: 'date' }, { name: 'days', label: 'Durée par phase (jours)', type: 'number' }], { start: p.data.start && p.data.start > today() ? p.data.start : today(), days: 5 });
    if (!v) return;
    let s = v.start;
    for (const l of titles) { const e = addDays(s, Math.max(1, num(v.days)) - 1); await persist('phase', { project_id: p.id, data: { name: l.desc, start: s, end: e, progress: 0 } }, { silent: true }); s = addDays(e, 1); }
    toast(`${titles.length} phases créées`); render();
  } })));
}

route('planning', async (sub = 'projects') => {
  if (sub === 'team') return teamPlanning();
  const [phases, projects] = await Promise.all([db.list('phase'), db.list('project')]);
  const page = layout({ active: 'planning', icon: 'calendar', title: 'Planning des chantiers' });
  const rows = [];
  for (const p of projects.filter((x) => !['termine', 'annule'].includes(x.data.status)).sort((a, b) => (a.data.start || '').localeCompare(b.data.start || ''))) {
    const ph = phases.filter((x) => x.project_id === p.id).sort((a, b) => a.data.start.localeCompare(b.data.start));
    if (!ph.length) continue;
    rows.push({ label: p.data.name, href: `#/project/${p.id}/planning`, color: p.data.color });
    ph.forEach((x) => rows.push({ item: x, color: p.data.color }));
  }
  page.innerHTML = rows.length ? `${zoomChips()}${ganttHTML(rows)}` : empty('Aucune phase planifiée', 'Ouvrez un chantier → onglet Planning pour ajouter ses phases.');
  bindGantt(page, (id) => { const ph = phases.find((x) => x.id === id); editPhase(byId(projects, ph.project_id), ph); });
});

// Planning des équipes : ouvriers × jours de la semaine
async function teamPlanning() {
  const wk = ui.week && /^\d{4}-\d\d-\d\d$/.test(ui.week) ? ui.week : (() => { const t = dnum(today()); return dstr(t - ((new Date(t * DAY).getUTCDay() + 6) % 7)); })();
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  const [staff, assigns, projects, inters, absences] = await Promise.all([db.list('employee'), db.list('assign'), db.list('project'), db.list('intervention'), db.list('absence')]);
  const people = staff.filter((s) => s.data.active !== false).sort((a, b) => a.data.name.localeCompare(b.data.name));
  const week = assigns.filter((x) => x.data.date >= days[0] && x.data.date <= days[6]);
  const page = layout({ active: 'planning', icon: 'calendar', title: 'Planning des équipes',
    actions: `<button class="btn" data-w="-7">‹ Semaine préc.</button><button class="btn" data-w="0">Cette semaine</button><button class="btn" data-w="7">Semaine suiv. ›</button><button class="btn" data-act="copy">Copier la semaine précédente</button>` });
  const DN = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  page.innerHTML = people.length ? `<div class="team"><table class="team-t"><thead><tr><th>Ouvrier</th>${days.map((d, i) => `<th class="${d === today() ? 'today' : ''} ${i > 4 ? 'we' : ''}">${DN[i]} ${fmtDate(d).slice(0, 5)}</th>`).join('')}</tr></thead><tbody>
    ${people.map((s) => `<tr><th><b>${esc(s.data.name)}</b><small class="muted">${esc(s.data.role || '')}</small></th>${days.map((d, i) => {
      const abs = absences.find((a) => +a.data.employeeId === s.id && a.data.from <= d && a.data.to >= d);
      const cell = week.filter((x) => +x.data.employeeId === s.id && x.data.date === d);
      const it = inters.filter((x) => x.data.date === d && (x.data.staff || []).map(Number).includes(s.id));
      return `<td class="${i > 4 ? 'we' : ''}" data-cell="${s.id}|${d}">${abs ? `<div class="abs">${esc(ABS_KINDS[abs.data.kind] || 'Absent')}</div>` : ''}
        ${cell.map((x) => { const p = byId(projects, x.project_id); return `<div class="asg" draggable="true" data-asg="${x.id}" style="--c:${esc((p && p.data.color) || '#3b5bdb')}">${esc(p ? p.data.name : x.data.note || '—')}${x.data.half && x.data.half !== 'day' ? ` <small>${x.data.half === 'am' ? 'matin' : 'après-midi'}</small>` : ''}</div>`; }).join('')}
        ${it.map((x) => `<a class="asg int" href="#/intervention/${x.id}">${I.tool} ${esc(x.data.title || x.number)}</a>`).join('')}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">Cliquez sur une case pour affecter un ouvrier à un chantier · glissez une affectation pour la déplacer.</p>`
    : empty('Aucun ouvrier', 'Ajoutez votre personnel dans RH → Personnel pour planifier les équipes.', '<a class="btn primary" href="#/hr/staff">Ajouter du personnel</a>');
  $$('[data-w]').forEach((b) => { b.onclick = () => { ui.week = +b.dataset.w ? addDays(wk, +b.dataset.w) : ''; saveUi(); render(); }; });
  const active = projects.filter((p) => !['termine', 'annule'].includes(p.data.status));
  const addAt = (sid, d) => formModal({
    title: `${(byId(staff, sid) || { data: {} }).data.name} – ${fmtDate(d)}`, values: { half: 'day', until: d },
    fields: [{ name: 'project_id', label: 'Chantier', type: 'select', options: active.map((p) => [p.id, p.data.name]), required: true }, { name: 'half', label: 'Période', type: 'select', options: [['day', 'Journée'], ['am', 'Matin'], ['pm', 'Après-midi']] }, { name: 'until', label: 'Répéter jusqu\'au (jours ouvrables)', type: 'date' }, { name: 'note', label: 'Remarque', cls: 'full' }],
    async onSave(v) {
      let cur = d; const end = v.until && v.until > d ? v.until : d;
      while (cur <= end) { const wd = new Date(dnum(cur) * DAY).getUTCDay(); if (cur === d || (wd !== 0 && wd !== 6)) await persist('assign', { project_id: +v.project_id, data: { employeeId: sid, date: cur, half: v.half, note: v.note } }, { silent: true }); cur = addDays(cur, 1); }
      render();
    },
  });
  $$('[data-cell]', page).forEach((td) => {
    const [sid, d] = td.dataset.cell.split('|');
    td.onclick = (e) => { if (!e.target.closest('.asg')) addAt(+sid, d); };
    td.ondragover = (e) => { e.preventDefault(); td.classList.add('over'); };
    td.ondragleave = () => td.classList.remove('over');
    td.ondrop = async (e) => { e.preventDefault(); td.classList.remove('over'); const x = week.find((y) => y.id === +e.dataTransfer.getData('text')); if (!x) return; x.data.employeeId = +sid; x.data.date = d; await persist('assign', x, { silent: true }); render(); };
  });
  $$('[data-asg]', page).forEach((el) => {
    el.ondragstart = (e) => e.dataTransfer.setData('text', el.dataset.asg);
    el.onclick = () => { const x = week.find((y) => y.id === +el.dataset.asg); menuSheet('Affectation', [{ label: 'Ouvrir le chantier', run: () => go(`#/project/${x.project_id}`) }, { label: 'Supprimer l\'affectation', danger: true, run: async () => { await db.del('assign', x.id); render(); } }]); };
  });
  $('[data-act=copy]').onclick = async () => {
    const prev = assigns.filter((x) => x.data.date >= addDays(days[0], -7) && x.data.date <= addDays(days[6], -7));
    if (!prev.length) return toast('Rien à copier');
    if (!confirm(`Copier ${prev.length} affectation(s) de la semaine précédente ?`)) return;
    for (const x of prev) await persist('assign', { project_id: x.project_id, data: { ...x.data, date: addDays(x.data.date, 7) } }, { silent: true });
    render();
  };
}

// ---------------------------------------------------------------- Interventions
async function editIntervention(x, preset = {}) {
  const [contacts, installs, staff, projects] = await Promise.all([db.list('contact'), db.list('installation'), db.list('employee'), db.list('project')]);
  formModal({
    title: x ? `Intervention ${x.number}` : 'Nouvelle intervention', wide: true, values: x ? { ...x.data, project_id: x.project_id } : { status: 'aplanifier', kind: 'depannage', date: today(), time: '08:00', duration: 2, ...preset },
    fields: [
      { name: 'title', label: 'Objet', required: true, cls: 'full', placeholder: 'ex. Chaudière en panne' },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'prospect', 'autre'] },
      { name: 'kind', label: 'Type', type: 'select', options: optsOf(INTKIND) },
      { name: 'installationId', label: 'Installation', type: 'select', options: [['', '—'], ...installs.map((i) => [i.id, `${i.data.name} (${contactName(byId(contacts, i.data.clientId))})`])] },
      { name: 'project_id', label: 'Chantier lié', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, p.data.name])] },
      { name: 'date', label: 'Date', type: 'date' }, { name: 'time', label: 'Heure', type: 'time' }, { name: 'duration', label: 'Durée prévue (h)', type: 'number' },
      { name: 'status', label: 'Statut', type: 'select', options: optsOf(INTST) },
      { name: 'staff', label: 'Techniciens', type: 'multi', options: staff.filter((s) => s.data.active !== false).map((s) => [s.id, s.data.name]), cls: 'full' },
      { name: 'address', label: 'Adresse d\'intervention', cls: 'full' },
      { name: 'request', label: 'Demande du client', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) {
      await resolveContact(v, 'clientId', 'client');
      if (!v.address && v.clientId) { const c = byId(contacts, v.clientId); if (c) v.address = [c.data.address, c.data.zip, c.data.city].filter(Boolean).join(' '); }
      const it = x || { data: {} }; it.project_id = v.project_id ? +v.project_id : null; delete v.project_id;
      it.data = { ...it.data, ...v, staff: v.staff.map(Number) };
      if (it.data.status === 'aplanifier' && it.data.staff.length && it.data.date) it.data.status = 'planifiee';
      const r = await persist('intervention', it);
      if (!x) go(`#/intervention/${r.id}`); else render();
    },
    onDelete: x ? async () => { await db.del('intervention', x.id); go('#/interventions'); } : null,
  });
}
route('interventions', async () => {
  const [list, contacts, staff] = await Promise.all([db.list('intervention'), db.list('contact'), db.list('employee')]);
  const page = layout({ active: 'interventions', icon: 'tool', title: 'Interventions', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle intervention</button>` });
  const todayN = list.filter((x) => x.data.date === today() && !['terminee', 'facturee', 'annulee'].includes(x.data.status)).length;
  page.innerHTML = `<div class="kpis">${kpi('À planifier', list.filter((x) => x.data.status === 'aplanifier').length)}${kpi("Aujourd'hui", todayN)}${kpi('À facturer', list.filter((x) => x.data.status === 'terminee').length, { cls: 'warn' })}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows: list, state: ui.tbl_int || (ui.tbl_int = { f: 'open', sort: 3 }),
    search: (x) => [x.number, x.data.title, contactName(byId(contacts, x.data.clientId)), x.data.address].join(' '),
    filters: { def: 'open', options: [['open', 'En cours'], ...Object.entries(INTST).map(([k, [l, c]]) => [k, l, c]), ['', 'Toutes']], match: (x, f) => (f === 'open' ? !['terminee', 'facturee', 'annulee'].includes(x.data.status) : x.data.status === f) },
    columns: [
      { l: 'N°', v: (x) => `<b>${esc(x.number)}</b>` }, { l: 'Objet', v: (x) => `<b>${esc(x.data.title)}</b><br><small class="muted">${esc(INTKIND[x.data.kind] || '')}</small>` },
      { l: 'Date', v: (x) => `${fmtDate(x.data.date)} ${esc(x.data.time || '')}`, sort: (x) => (x.data.date || '') + (x.data.time || '') },
      { l: 'Client', v: (x) => esc(contactName(byId(contacts, x.data.clientId))) }, { l: 'Techniciens', v: (x) => esc((x.data.staff || []).map((s) => (byId(staff, s) || { data: {} }).data.name).filter(Boolean).join(', ')) },
      { l: 'Statut', v: (x) => st(INTST, x.data.status) },
    ],
    onRow: (x) => go(`#/intervention/${x.id}`), empty: 'Aucune intervention',
  });
  $('[data-act=new]').onclick = () => editIntervention();
});
route('intervention', async (id) => {
  const x = await db.get('intervention', +id);
  const [contacts, staff, installs] = await Promise.all([db.list('contact'), db.list('employee'), db.list('installation')]);
  const d = x.data; d.lines = d.lines || []; d.photos = d.photos || [];
  const c = byId(contacts, d.clientId); const inst = byId(installs, d.installationId);
  const save = debounce(() => persist('intervention', x, { silent: true }).then(() => { $('[data-saved]').textContent = 'Enregistré'; }).catch((e) => toast('Erreur : ' + e.message)), 800);
  const page = layout({ active: 'interventions', icon: 'tool', title: `${x.number} · ${d.title}`, back: '#/interventions', sub: `${st(INTST, d.status)} <span class="muted" data-saved></span>`,
    actions: `<a class="btn" href="#/interventionpdf/${x.id}">${I.print} Bon d'intervention</a><button class="btn" data-act="edit">${I.edit} Modifier</button><button class="btn primary" data-act="inv">Facturer</button>` });
  page.innerHTML = `<div class="cols"><div class="col-main">
      <div class="status-bar">${Object.entries(INTST).map(([k, [l, col]]) => `<button class="${d.status === k ? 'on' : ''}" data-st="${k}" style="--c:${col}">${l}</button>`).join('')}</div>
      <div class="card"><div class="card-h"><h3>Rapport d'intervention</h3></div>${fieldsGrid([{ name: 'arrival', label: 'Arrivée', type: 'time' }, { name: 'departure', label: 'Départ', type: 'time' }, { name: 'report', label: 'Travaux effectués / constatations', type: 'textarea', rows: 6, cls: 'full' }], d)}
        <div class="section-t">Photos</div><div class="photos" data-ph></div></div>
      <div class="card"><div class="card-h"><h3>Fournitures et prestations</h3></div><div id="lines"></div></div>
      <div class="card"><div class="card-h"><h3>Signature du client</h3></div>${fieldsGrid([{ name: 'signer', label: 'Nom du signataire' }], d)}<div data-sig></div></div>
    </div><div class="col-side"><div class="card info">
      <div class="kv"><span>Client</span><div>${c ? `<a href="#/contact/${c.id}">${esc(contactName(c))}</a><br>${esc(c.data.mobile || c.data.phone || '')}` : '—'}</div></div>
      <div class="kv"><span>Date</span><div>${fmtDate(d.date)} ${esc(d.time || '')} (${fnum(num(d.duration), 1)} h)</div></div>
      <div class="kv"><span>Type</span><div>${esc(INTKIND[d.kind] || '')}</div></div>
      ${d.address ? `<div class="kv"><span>Adresse</span><div>${esc(d.address)}<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}">Itinéraire</a></div></div>` : ''}
      ${inst ? `<div class="kv"><span>Installation</span><div>${esc(inst.data.name)}<br><small class="muted">${esc([inst.data.brand, inst.data.model, inst.data.serial && 'S/N ' + inst.data.serial].filter(Boolean).join(' · '))}</small></div></div>` : ''}
      <div class="kv"><span>Techniciens</span><div>${esc((d.staff || []).map((s) => (byId(staff, s) || { data: {} }).data.name).filter(Boolean).join(', ') || '—')}</div></div>
      ${d.request ? `<div class="kv"><span>Demande</span><div class="pre">${esc(d.request)}</div></div>` : ''}</div>
      <div id="tot"></div></div></div>`;
  ['arrival', 'departure', 'report', 'signer'].forEach((k) => { const e = $(`[name=${k}]`, page); e.oninput = () => { d[k] = e.value; save(); }; });
  const drawTot = () => { $('#tot').innerHTML = totalsBox(totals(d), d, false); };
  linesEditor($('#lines'), d, { showCost: false, onChange: () => { drawTot(); save(); } }); drawTot();
  const drawPh = () => {
    const box = $('[data-ph]', page);
    box.innerHTML = d.photos.map((fid, i) => `<div class="ph"><a href="${fileUrl(fid)}" target="_blank"><img src="${fileUrl(fid)}"></a><button type="button" data-rm="${i}">✕</button></div>`).join('') + `<label class="add">${I.camera}<span>Photo</span><input type="file" accept="image/*" multiple hidden></label>`;
    $('input', box).onchange = async (e) => { for (const f of e.target.files) { toast('Envoi…', 20000); d.photos.push((await uploadPhoto(f, x.project_id)).id); } toast('Photo ajoutée'); save(); drawPh(); };
    $$('[data-rm]', box).forEach((b) => { b.onclick = () => { delFile(d.photos[+b.dataset.rm]); d.photos.splice(+b.dataset.rm, 1); save(); drawPh(); }; });
  };
  drawPh();
  signaturePad($('[data-sig]', page), d.signatureId, x.project_id, (fid) => { d.signatureId = fid; save(); });
  $$('[data-st]').forEach((b) => { b.onclick = async () => { await save.flush(); d.status = b.dataset.st; await persist('intervention', x); render(); }; });
  $('[data-act=edit]').onclick = async () => { await save.flush(); editIntervention(x); };
  $('[data-act=inv]').onclick = async () => {
    await save.flush();
    if (!d.lines.some((l) => l.kind === 'item')) return toast('Ajoutez d\'abord les fournitures / prestations à facturer');
    d.status = 'facturee'; await persist('intervention', x);
    newInvoice({ project_id: x.project_id, data: { clientId: d.clientId, title: `Intervention ${x.number} – ${d.title}`, interventionId: x.id, lines: d.lines.map((l) => ({ ...l, id: lid() })) } });
  };
  cleanupView = () => save.flush();
});
route('interventionpdf', async (id) => {
  const x = await db.get('intervention', +id);
  const [contacts, staff] = await Promise.all([db.list('contact'), db.list('employee')]);
  const d = x.data; const c = byId(contacts, d.clientId) || { data: {} }; const co = company();
  printPage(`Bon d'intervention ${x.number}`, `<div class="doc"><div class="d-head"><div class="d-from">${co.logoId ? `<img class="d-logo" src="${fileUrl(co.logoId)}">` : ''}<b class="d-co">${esc(co.name || '')}</b><div>${nl2br(co.address || '')}</div><div>${esc([co.phone, co.email].filter(Boolean).join(' · '))}</div></div>
    <div class="d-meta"><h1>Bon d'intervention</h1><div>N° <b>${esc(x.number)}</b></div><div>Date : <b>${fmtDate(d.date)}</b></div><div>${esc(INTKIND[d.kind] || '')}</div></div></div>
    <div class="d-parties"><div class="d-box"><small>Client</small><b>${esc(contactName(c))}</b><div>${esc(d.address || '')}</div></div><div class="d-box"><small>Intervenants</small>${esc((d.staff || []).map((s) => (byId(staff, s) || { data: {} }).data.name).filter(Boolean).join(', '))}<div>Arrivée ${esc(d.arrival || '—')} · Départ ${esc(d.departure || '—')}</div></div></div>
    <p><b>Objet :</b> ${esc(d.title)}</p>${d.request ? `<p><b>Demande :</b></p><div class="pre">${esc(d.request)}</div>` : ''}${d.report ? `<p><b>Travaux effectués :</b></p><div class="pre">${esc(d.report)}</div>` : ''}
    ${(d.lines || []).some((l) => l.kind === 'item') ? `<table class="d-lines"><thead><tr><th>Désignation</th><th>Unité</th><th class="r">Qté</th><th class="r">PU HT</th><th class="r">Total HT</th></tr></thead><tbody>${d.lines.filter((l) => l.kind === 'item').map((l) => `<tr><td class="pre">${esc(l.desc)}</td><td>${esc(l.unit)}</td><td class="r">${fnum(num(l.qty), 2)}</td><td class="r">${money(l.price)}</td><td class="r">${money(num(l.qty) * num(l.price))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${(d.photos || []).length ? `<div class="d-photos">${d.photos.map((f) => `<img src="${fileUrl(f)}">`).join('')}</div>` : ''}
    <div class="d-sign"><div>Le technicien</div><div>${d.signatureId ? `<img src="${fileUrl(d.signatureId)}" style="max-height:70px;display:block">` : ''}Le client : ${esc(d.signer || '')}</div></div></div>`, `#/intervention/${id}`);
});

// ---------------------------------------------------------------- Installations
async function editInstallation(x, preset = {}) {
  const contacts = await db.list('contact');
  formModal({
    title: x ? x.data.name : 'Nouvelle installation', wide: true, values: x ? x.data : { installDate: today(), frequency: 12, ...preset },
    fields: [
      { name: 'name', label: 'Installation', required: true, cls: 'full', placeholder: 'ex. Chaudière gaz à condensation' },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'autre'] }, { name: 'category', label: 'Catégorie', list: 'icats' },
      { name: 'brand', label: 'Marque' }, { name: 'model', label: 'Modèle' }, { name: 'serial', label: 'N° de série' },
      { name: 'installDate', label: 'Date d\'installation', type: 'date' }, { name: 'warrantyEnd', label: 'Fin de garantie', type: 'date' },
      { name: 'address', label: 'Adresse', cls: 'full' },
      { name: 'contract', label: 'Contrat d\'entretien', type: 'check' }, { name: 'frequency', label: 'Fréquence d\'entretien (mois)', type: 'number' },
      { name: 'contractPrice', label: 'Prix du contrat HT / an', type: 'money' }, { name: 'nextService', label: 'Prochain entretien', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
    ],
    extra: `<datalist id="icats">${['Chauffage', 'Climatisation', 'Pompe à chaleur', 'Photovoltaïque', 'Ventilation', 'Sanitaire', 'Électricité', 'Piscine', 'Porte / portail'].map((t) => `<option value="${t}">`).join('')}</datalist>`,
    async onSave(v) {
      await resolveContact(v, 'clientId', 'client');
      if (v.contract && !v.nextService && v.installDate) v.nextService = dstr(dnum(v.installDate) + Math.round(num(v.frequency || 12) * 30.4));
      const it = x || { data: {} }; it.data = { ...it.data, ...v }; await persist('installation', it); render();
    },
    onDelete: x ? async () => { await db.del('installation', x.id); render(); } : null,
  });
}
route('installations', async () => {
  const [list, contacts] = await Promise.all([db.list('installation'), db.list('contact')]);
  const soon = addDays(today(), 30);
  const page = layout({ active: 'installations', icon: 'install', title: 'Installations', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle installation</button>` });
  page.innerHTML = `<div class="kpis">${kpi('Installations', list.length)}${kpi('Sous contrat', list.filter((x) => x.data.contract).length)}${kpi('Entretiens dans les 30 jours', list.filter((x) => x.data.contract && x.data.nextService && x.data.nextService <= soon).length, { cls: 'warn' })}
    ${kpi('Contrats / an', money(list.filter((x) => x.data.contract).reduce((a, x) => a + num(x.data.contractPrice), 0)))}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows: list, state: ui.tbl_inst || (ui.tbl_inst = {}),
    search: (x) => [x.data.name, x.data.brand, x.data.model, x.data.serial, contactName(byId(contacts, x.data.clientId))].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ['contract', 'Sous contrat'], ['due', 'Entretien à prévoir', '#f08c00']], match: (x, f) => (f === 'contract' ? x.data.contract : x.data.contract && x.data.nextService && x.data.nextService <= soon) },
    columns: [
      { l: 'Installation', v: (x) => `<b>${esc(x.data.name)}</b><br><small class="muted">${esc([x.data.brand, x.data.model].filter(Boolean).join(' '))}</small>` },
      { l: 'Client', v: (x) => esc(contactName(byId(contacts, x.data.clientId))) }, { l: 'N° série', v: (x) => esc(x.data.serial || '') },
      { l: 'Garantie', v: (x) => (x.data.warrantyEnd ? `<span class="${x.data.warrantyEnd < today() ? 'muted' : ''}">${fmtDate(x.data.warrantyEnd)}</span>` : '') },
      { l: 'Prochain entretien', v: (x) => (x.data.contract ? `<span class="${x.data.nextService && x.data.nextService <= soon ? 'late' : ''}">${fmtDate(x.data.nextService)}</span>` : '<span class="muted">—</span>'), sort: (x) => x.data.nextService || '9' },
      { l: '', v: (x) => (x.data.contract ? `<button class="btn sm" data-plan="${x.id}">Planifier</button>` : '') },
    ],
    onRow: (x) => editInstallation(x), empty: 'Aucune installation',
  });
  $('[data-act=new]').onclick = () => editInstallation();
  page.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-plan]'); if (!b) return; e.stopPropagation();
    const x = list.find((y) => y.id === +b.dataset.plan);
    editIntervention(null, { title: `Entretien ${x.data.name}`, kind: 'entretien', clientId: x.data.clientId, installationId: x.id, date: x.data.nextService || today(), address: x.data.address });
    x.data.lastPlanned = today(); x.data.nextService = dstr(dnum(x.data.nextService || today()) + Math.round(num(x.data.frequency || 12) * 30.4)); persist('installation', x, { silent: true });
  }, true);
  const focus = new URLSearchParams(location.hash.split('?')[1] || '').get('i'); if (focus) { const x = list.find((y) => y.id === +focus); if (x) editInstallation(x); }
});
