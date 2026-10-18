'use strict';
/* Bibliothèque, fiches techniques, devis, factures, paiements et commandes. */

// ---------------------------------------------------------------- Bibliothèque
const LIB_KINDS = { ...TYPES, ouvrage: 'Ouvrage (composé)' };

async function editArticle(a, preset = {}) {
  const [all, contacts, fiches] = await Promise.all([db.list('article'), db.list('contact'), db.list('fiche')]);
  const d = a ? JSON.parse(JSON.stringify(a.data)) : { kind: 'mat', unit: 'u', margin: 25, vat: defVat(), components: [], ...preset };
  d.components = d.components || [];
  const cats = [...new Set(all.map((x) => x.data.category).filter(Boolean))];
  const m = modal(`${mhead(a ? 'Article de bibliothèque' : 'Nouvel article')}<form class="m-body">
    ${fieldsGrid([
      { name: 'name', label: 'Désignation', required: true, cls: 'full' },
      { name: 'kind', label: 'Type', type: 'select', options: optsOf(LIB_KINDS) },
      { name: 'code', label: 'Code' },
      { name: 'category', label: 'Catégorie', list: 'cats' },
      { name: 'unit', label: 'Unité', list: 'units' },
      { name: 'desc', label: 'Description détaillée (reprise dans le devis)', type: 'textarea', cls: 'full' },
      { name: 'supplierId', label: 'Fournisseur / sous-traitant', type: 'contact', contacts, kinds: ['fournisseur', 'soustraitant'], allowNew: false },
      { name: 'ficheId', label: 'Fiche technique', type: 'select', options: [['', '—'], ...fiches.map((f) => [f.id, f.data.title])] },
    ], d)}
    <div class="ouv" ${d.kind === 'ouvrage' ? '' : 'hidden'}><div class="section-t">Composition de l'ouvrage (pour 1 ${esc(d.unit || 'u')})</div><div class="comp"></div>
      <button type="button" class="btn sm" data-addc>${I.plus} Ajouter un composant</button></div>
    ${fieldsGrid([
      { name: 'cost', label: 'Déboursé unitaire HT', type: 'money', hint: 'Coût d\'achat ou de revient' },
      { name: 'margin', label: 'Marge %', type: 'percent' },
      { name: 'price', label: 'Prix de vente HT', type: 'money' },
      { name: 'vat', label: 'TVA', type: 'select', options: vatOptions(d.vat) },
    ], d)}
    <datalist id="cats">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
  </form><div class="m-foot">${a ? `<button class="btn danger ghost" data-del>${I.trash} Supprimer</button>` : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button></div>`, { wide: true });
  const f = $('form', m.el); const E = f.elements;
  const others = all.filter((x) => !a || x.id !== a.id);
  const recalc = (from) => {
    if (E.kind.value === 'ouvrage') {
      const c = articleCost({ data: { kind: 'ouvrage', components: d.components } }, others);
      E.cost.value = c.cost; E.cost.readOnly = true;
    } else E.cost.readOnly = false;
    const cost = num(E.cost.value);
    if (from === 'price') E.margin.value = cost > 0 ? r2((num(E.price.value) / cost - 1) * 100) : '';
    else if (cost > 0) E.price.value = r2(cost * (1 + num(E.margin.value) / 100));
  };
  const drawComp = () => {
    $('.comp', m.el).innerHTML = d.components.map((c, i) => {
      const s = others.find((x) => x.id === +c.articleId);
      return `<div class="comp-row"><select data-ca="${i}"><option value="">— choisir —</option>${others.filter((x) => x.data.kind !== 'ouvrage').map((x) => `<option value="${x.id}" ${x.id === +c.articleId ? 'selected' : ''}>${esc((x.data.code ? x.data.code + ' · ' : '') + x.data.name)}</option>`).join('')}</select>
        <input data-cq="${i}" inputmode="decimal" value="${esc(c.qty)}" title="Quantité"><span class="muted">${esc(s ? s.data.unit : '')}</span><b>${s ? money(articleCost(s, others).cost * num(c.qty)) : ''}</b><button type="button" class="icon-btn sm" data-cd="${i}">✕</button></div>`;
    }).join('') || '<div class="muted sm">Ajoutez la main d\'œuvre, les matériaux… qui composent l\'ouvrage.</div>';
    $$('[data-ca]', m.el).forEach((s) => { s.onchange = () => { d.components[+s.dataset.ca].articleId = +s.value; drawComp(); recalc(); }; });
    $$('[data-cq]', m.el).forEach((s) => { s.oninput = () => { d.components[+s.dataset.cq].qty = num(s.value); recalc(); }; s.onblur = drawComp; });
    $$('[data-cd]', m.el).forEach((s) => { s.onclick = () => { d.components.splice(+s.dataset.cd, 1); drawComp(); recalc(); }; });
  };
  E.kind.onchange = () => { $('.ouv', m.el).hidden = E.kind.value !== 'ouvrage'; recalc(); };
  E.cost.oninput = () => recalc('cost'); E.margin.oninput = () => recalc('margin'); E.price.oninput = () => recalc('price');
  $('[data-addc]', m.el).onclick = () => { d.components.push({ articleId: '', qty: 1 }); drawComp(); };
  drawComp(); if (d.kind === 'ouvrage') recalc();
  if (E.cost.value && !E.price.value) recalc('cost');
  $('[data-save]', m.el).onclick = async () => {
    const fields = [{ name: 'name' }, { name: 'kind' }, { name: 'code' }, { name: 'category' }, { name: 'unit' }, { name: 'desc' }, { name: 'supplierId', type: 'contact' }, { name: 'ficheId' }, { name: 'cost', type: 'money' }, { name: 'margin', type: 'percent' }, { name: 'price', type: 'money' }, { name: 'vat', type: 'number' }];
    const v = readFields(f, fields);
    if (!v.name) return toast('Indiquez la désignation');
    const it = a || { data: {} };
    it.data = { ...it.data, ...v, components: v.kind === 'ouvrage' ? d.components.filter((c) => c.articleId) : [], priceMode: 'margin' };
    await persist('article', it); m.close(); toast('Article enregistré');
    if (location.hash.startsWith('#/library')) render();
  };
  if (a) $('[data-del]', m.el).onclick = async () => { if (confirm('Supprimer cet article ?')) { await db.del('article', a.id); m.close(); render(); } };
}

route('library', async () => {
  const all = await db.list('article');
  const page = layout({ active: 'library', icon: 'book', title: 'Bibliothèque',
    actions: `<button class="btn" data-act="imp">Importer Excel / CSV</button><button class="btn" data-act="exp">Exporter CSV</button><button class="btn" data-act="bulk">Indexer les prix</button><button class="btn primary" data-act="new">${I.plus} Nouvel article</button>` });
  dataTable(page, {
    rows: all, state: ui.tbl_lib || (ui.tbl_lib = {}),
    search: (a) => [a.data.code, a.data.name, a.data.category].join(' '),
    filters: { def: '', options: [['', 'Tout'], ...Object.entries(LIB_KINDS).map(([k, l]) => [k, l, TYPE_COLORS[k]])], match: (a, f) => a.data.kind === f },
    columns: [
      { l: 'Code', v: (a) => esc(a.data.code || '') },
      { l: 'Désignation', v: (a) => `<i class="tdot" style="--c:${TYPE_COLORS[a.data.kind] || '#999'}"></i><b>${esc(a.data.name)}</b>${a.data.kind === 'ouvrage' ? ` <small class="muted">(${(a.data.components || []).length} composants)</small>` : ''}`, sort: (a) => a.data.name.toLowerCase() },
      { l: 'Catégorie', v: (a) => esc(a.data.category || '') },
      { l: 'Unité', v: (a) => esc(a.data.unit || '') },
      { l: 'Déboursé', cls: 'r', v: (a) => money(articleCost(a, all).cost), sort: (a) => articleCost(a, all).cost },
      { l: 'Marge', cls: 'r', v: (a) => `${fnum(num(a.data.margin), 1)} %` },
      { l: 'Prix HT', cls: 'r', v: (a) => `<b>${money(articlePrice(a, all))}</b>`, sort: (a) => articlePrice(a, all) },
    ],
    onRow: (a) => editArticle(a),
    empty: 'Bibliothèque vide – créez vos articles et ouvrages ou importez un fichier CSV',
  });
  $('[data-act=new]').onclick = () => editArticle();
  $('[data-act=exp]').onclick = () => downloadCSV('bibliotheque.csv', [['Code', 'Designation', 'Type', 'Categorie', 'Unite', 'Debourse', 'Marge', 'Prix', 'TVA', 'Description'],
    ...all.map((a) => [a.data.code, a.data.name, a.data.kind, a.data.category, a.data.unit, fnum(articleCost(a, all).cost, 4), fnum(num(a.data.margin)), fnum(articlePrice(a, all)), fnum(num(a.data.vat)), a.data.desc])]);
  $('[data-act=imp]').onclick = () => importLibrary(all);
  $('[data-act=bulk]').onclick = async () => {
    const v = await ask('Indexer les prix', [{ name: 'pct', label: 'Variation des déboursés en % (ex. 3 ou -2)', type: 'percent', required: true }, { name: 'kind', label: 'Types concernés', type: 'select', options: [['', 'Tous'], ...optsOf(TYPES)] }]);
    if (!v || !num(v.pct)) return;
    let n = 0;
    for (const a of all) { if (a.data.kind === 'ouvrage' || (v.kind && a.data.kind !== v.kind)) continue; a.data.cost = r2(num(a.data.cost) * (1 + num(v.pct) / 100) * 1e4) / 1e4; await persist('article', a, { silent: true }); n++; }
    toast(`${n} articles indexés`); render();
  };
});

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const normKey = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
async function importLibrary(existing) {
  const [file] = await pickFile('.csv,text/csv,.xlsx,.xls,.ods');
  if (!file) return;
  try {
    const bytes = await readBytes(file);
    const rows = /\.csv$/i.test(file.name) ? parseCSV(new TextDecoder().decode(bytes)) : Object.values(await readSheets(file, bytes))[0].map((r) => r.map((c) => String(c ?? '')));
    const h = rows[0].map(normKey);
    const col = (...n) => h.findIndex((x) => n.includes(x));
    const ix = { code: col('code', 'ref', 'reference'), name: col('designation', 'nom', 'libelle', 'name'), kind: col('type'), category: col('categorie', 'famille'), unit: col('unite', 'unit', 'u'),
      cost: col('debourse', 'cout', 'cost', 'prixachat'), margin: col('marge', 'margin'), price: col('prix', 'prixvente', 'pu', 'price'), vat: col('tva', 'vat'), desc: col('description', 'desc') };
    if (ix.name < 0) throw new Error('Colonne « Designation » introuvable');
    let n = 0;
    for (const r of rows.slice(1)) {
      const g = (k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
      if (!g('name')) continue;
      const kraw = normKey(g('kind'));
      const kind = Object.keys(LIB_KINDS).find((k) => k === kraw || normKey(LIB_KINDS[k]).startsWith(kraw) && kraw) || 'mat';
      const v = { code: g('code'), name: g('name'), kind: kind === 'ouvrage' ? 'mat' : kind, category: g('category'), unit: g('unit') || 'u', cost: num(g('cost')), margin: num(g('margin')), vat: g('vat') === '' ? defVat() : num(g('vat')), desc: g('desc') };
      if (!v.cost && num(g('price'))) { v.cost = num(g('price')); v.margin = 0; } else if (v.cost && !g('margin') && num(g('price'))) v.margin = r2((num(g('price')) / v.cost - 1) * 100);
      const same = existing.find((a) => (v.code && a.data.code === v.code) || (!v.code && a.data.name === v.name));
      const it = same || { data: {} };
      it.data = { ...it.data, ...v };
      await persist('article', it, { silent: true }); n++;
    }
    toast(`${n} articles importés`); render();
  } catch (e) { toast('Import impossible : ' + e.message, 5000); }
}

// ---------------------------------------------------------------- Fiches techniques
async function editFiche(f) {
  const d = f ? f.data : {};
  let fileId = d.fileId; let fileName = d.fileName;
  formModal({
    title: f ? 'Fiche technique' : 'Nouvelle fiche technique', values: d,
    fields: [
      { name: 'title', label: 'Titre', required: true, cls: 'full' },
      { name: 'brand', label: 'Marque / fabricant' }, { name: 'category', label: 'Catégorie' },
      { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
      { name: 'file', type: 'html', cls: 'full', html: `<span class="lbl">Document (PDF, image)</span><div class="file-pick"><span data-fn>${fileName ? `<a href="${fileUrl(fileId)}" target="_blank">${esc(fileName)}</a>` : '<span class="muted">Aucun fichier</span>'}</span><button type="button" class="btn sm" data-up>${I.file} Choisir un fichier</button></div>` },
    ],
    after: (form) => {
      $('[data-up]', form).onclick = async () => {
        const [file] = await pickFile('application/pdf,image/*');
        if (!file) return;
        toast('Envoi…', 10000);
        const r = await upload(file); fileId = r.id; fileName = r.name;
        $('[data-fn]', form).innerHTML = `<a href="${fileUrl(fileId)}" target="_blank">${esc(fileName)}</a>`; toast('Fichier envoyé');
      };
    },
    async onSave(v) { const it = f || { data: {} }; it.data = { ...it.data, ...v, fileId, fileName }; await persist('fiche', it); render(); },
    onDelete: f ? async () => { await delFile(d.fileId); await db.del('fiche', f.id); render(); } : null,
  });
}
route('fiches', async (sub) => {
  if (sub === 'dossiers') return viewDossiers();
  const list = await db.list('fiche');
  const page = layout({ active: 'fiches', icon: 'fiche', title: 'Fiches techniques', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle fiche</button>` });
  dataTable(page, {
    rows: list, state: ui.tbl_fiche || (ui.tbl_fiche = {}),
    search: (f) => [f.data.title, f.data.brand, f.data.category].join(' '),
    columns: [
      { l: 'Titre', v: (f) => `<b>${esc(f.data.title)}</b>` }, { l: 'Marque', v: (f) => esc(f.data.brand || '') }, { l: 'Catégorie', v: (f) => esc(f.data.category || '') },
      { l: 'Document', v: (f) => (f.data.fileId ? `<a href="${fileUrl(f.data.fileId)}" target="_blank">${I.file} ${esc(f.data.fileName)}</a>` : '') },
    ],
    onRow: (f) => editFiche(f), empty: 'Aucune fiche technique',
  });
  $('[data-act=new]').onclick = () => editFiche();
});
async function viewDossiers() {
  const [dossiers, projects, fiches] = await Promise.all([db.list('dossier'), db.list('project'), db.list('fiche')]);
  const page = layout({ active: 'fiches', icon: 'fiche', title: 'Dossiers de fin de chantier', actions: `<button class="btn primary" data-act="new">${I.plus} Nouveau dossier</button>` });
  const edit = (x) => formModal({
    title: x ? 'Dossier de fin de chantier' : 'Nouveau dossier', values: x ? x.data : { date: today() }, wide: true,
    fields: [
      { name: 'title', label: 'Titre', required: true, cls: 'full', placeholder: 'ex. Dossier d\'intervention ultérieure' },
      { name: 'projectId', label: 'Chantier', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, p.data.name])] }, { name: 'date', label: 'Date', type: 'date' },
      { name: 'ficheIds', label: 'Fiches techniques incluses', type: 'multi', options: fiches.map((f) => [f.id, f.data.title]), cls: 'full' },
      { name: 'notes', label: 'Introduction / remarques', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { const it = x || { data: {} }; it.data = { ...it.data, ...v }; await persist('dossier', it); render(); },
    onDelete: x ? async () => { await db.del('dossier', x.id); render(); } : null,
  });
  dataTable(page, {
    rows: dossiers,
    columns: [{ l: 'Titre', v: (x) => `<b>${esc(x.data.title)}</b>` }, { l: 'Chantier', v: (x) => esc((byId(projects, x.data.projectId) || { data: {} }).data.name || '') }, { l: 'Date', v: (x) => fmtDate(x.data.date) },
      { l: 'Fiches', v: (x) => (x.data.ficheIds || []).length }, { l: '', v: (x) => `<a class="btn sm" href="#/dossier/${x.id}">${I.print} Ouvrir</a>` }],
    onRow: edit, empty: 'Aucun dossier',
  });
  $('[data-act=new]').onclick = () => edit();
}
route('dossier', async (id) => {
  const x = await db.get('dossier', +id);
  const [fiches, project] = await Promise.all([db.list('fiche'), x.data.projectId ? db.get('project', +x.data.projectId).catch(() => null) : null]);
  const co = company();
  const list = (x.data.ficheIds || []).map((fid) => byId(fiches, fid)).filter(Boolean);
  printPage(x.data.title, `<div class="doc"><div class="d-head"><div class="d-from">${co.logoId ? `<img class="d-logo" src="${fileUrl(co.logoId)}">` : ''}<b class="d-co">${esc(co.name || '')}</b></div><div class="d-meta"><h1>${esc(x.data.title)}</h1><div>${fmtDate(x.data.date)}</div></div></div>
    ${project ? `<p><b>Chantier :</b> ${esc(project.data.name)} – ${esc([project.data.address, project.data.city].filter(Boolean).join(', '))}</p>` : ''}${x.data.notes ? `<p class="pre">${esc(x.data.notes)}</p>` : ''}
    <table class="d-lines"><thead><tr><th>#</th><th>Fiche technique</th><th>Marque</th><th>Document</th></tr></thead><tbody>${list.map((f, i) => `<tr><td>${i + 1}</td><td>${esc(f.data.title)}</td><td>${esc(f.data.brand || '')}</td><td>${f.data.fileId ? `<a href="${fileUrl(f.data.fileId)}" target="_blank">${esc(f.data.fileName)}</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`, '#/fiches/dossiers');
});

// ---------------------------------------------------------------- Devis
async function newQuote(preset = {}) {
  const co = company();
  const it = await persist('quote', { project_id: preset.projectId || null, data: { status: 'brouillon', date: today(), valid: addDays(today(), num(co.quoteValidity) || 30), ownerId: S.me.id, lines: [], discount: 0, reverse: false, notes: co.quoteNotes || '', ...preset } });
  go(`#/quote/${it.id}`);
}

route('quotes', async () => {
  const [quotes, contacts, projects] = await Promise.all([db.list('quote'), db.list('contact'), db.list('project')]);
  const sum = (s) => quotes.filter((q) => q.data.status === s).reduce((a, q) => a + totals(q.data).base, 0);
  const page = layout({ active: 'quotes', icon: 'calc', title: 'Devis', actions: `<button class="btn" data-act="xls">${I.file} Devis depuis Excel</button><button class="btn primary" data-act="new">${I.plus} Nouveau devis</button>` });
  $('[data-act=xls]').onclick = () => quoteFromExcel();
  page.innerHTML = `<div class="kpis">${kpi('À envoyer', money(sum('brouillon')), { sub: `${quotes.filter((q) => q.data.status === 'brouillon').length} devis` })}${kpi('En cours (envoyés)', money(sum('envoye')), { sub: `${quotes.filter((q) => q.data.status === 'envoye').length} devis` })}
    ${kpi('Acceptés', money(sum('accepte')), { cls: 'good', sub: `${quotes.filter((q) => q.data.status === 'accepte').length} devis` })}${kpi('Taux de transformation', `${quotes.filter((q) => ['accepte', 'refuse'].includes(q.data.status)).length ? Math.round(quotes.filter((q) => q.data.status === 'accepte').length / quotes.filter((q) => ['accepte', 'refuse'].includes(q.data.status)).length * 100) : 0} %`)}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows: quotes, state: ui.tbl_quotes || (ui.tbl_quotes = {}),
    search: (q) => [q.number, q.data.title, contactName(byId(contacts, q.data.clientId)), (byId(projects, q.project_id) || { data: {} }).data.name].join(' '),
    filters: { def: '', options: [['', 'Tous'], ...Object.entries(QST).map(([k, [l, c]]) => [k, l, c])], match: (q, f) => q.data.status === f },
    columns: [
      { l: 'N°', v: (q) => `<b>${esc(q.number)}</b>`, sort: (q) => q.number },
      { l: 'Objet', v: (q) => esc(q.data.title || '') },
      { l: 'Client', v: (q) => esc(contactName(byId(contacts, q.data.clientId))) },
      { l: 'Chantier', v: (q) => esc((byId(projects, q.project_id) || { data: {} }).data.name || '') },
      { l: 'Date', v: (q) => fmtDate(q.data.date), sort: (q) => q.data.date },
      { l: 'Statut', v: (q) => st(QST, q.data.status) },
      { l: '', v: (q) => avatar(+q.data.ownerId || q.created_by) },
      { l: 'Total HT', cls: 'r', v: (q) => `<b>${money(totals(q.data).base)}</b>`, sort: (q) => totals(q.data).base },
    ],
    onRow: (q) => go(`#/quote/${q.id}`), empty: 'Aucun devis',
    footer: (l) => `<tr><td colspan="7">Total</td><td class="r"><b>${money(l.reduce((a, q) => a + totals(q.data).base, 0))}</b></td></tr>`,
  });
  $('[data-act=new]').onclick = () => newQuote();
});

async function quoteHead(q, contacts, projects, onSaved) {
  formModal({
    title: `Devis ${q.number}`, wide: true, values: { ...q.data, project_id: q.project_id },
    fields: [
      { name: 'title', label: 'Objet du devis', cls: 'full', required: true },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'prospect', 'architecte', 'autre'] },
      { name: 'project_id', label: 'Chantier', type: 'select', options: [['', '— aucun (créé à l\'acceptation) —'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])] },
      { name: 'date', label: 'Date', type: 'date' }, { name: 'valid', label: 'Valable jusqu\'au', type: 'date' },
      { name: 'ownerId', label: 'Responsable', type: 'user' }, { name: 'ref', label: 'Votre référence' },
      { name: 'discount', label: 'Remise globale %', type: 'percent' },
      { name: 'reverse', label: 'Autoliquidation (TVA due par le client assujetti)', type: 'check' },
      { name: 'siteAddress', label: 'Adresse du chantier', cls: 'full' },
      { name: 'intro', label: 'Texte d\'introduction', type: 'textarea', cls: 'full' },
      { name: 'notes', label: 'Conditions / mentions en bas du devis', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) {
      await resolveContact(v, 'clientId', 'client');
      q.project_id = v.project_id ? +v.project_id : null; delete v.project_id;
      Object.assign(q.data, v, { discount: num(v.discount) });
      await persist('quote', q); onSaved();
    },
  });
}

route('quote', async (id) => {
  const q = await db.get('quote', +id);
  const [contacts, projects, invoices] = await Promise.all([db.list('contact'), db.list('project'), db.list('invoice')]);
  const d = q.data;
  const c = byId(contacts, d.clientId);
  const pr = byId(projects, q.project_id);
  const save = debounce(async () => { try { await persist('quote', q, { silent: true }); $('[data-saved]').textContent = 'Enregistré'; } catch (e) { toast('Erreur : ' + e.message); } }, 800);
  const page = layout({ active: 'quotes', icon: 'calc', title: `Devis ${q.number}`, back: pr ? `#/project/${pr.id}/quotes` : '#/quotes',
    sub: `${st(QST, d.status)} <span class="muted" data-saved></span>`,
    actions: `<a class="btn" href="#/print/quote/${q.id}">${I.print} PDF</a><button class="btn" data-act="more">${I.more} Actions</button>` });
  const inv = invoices.filter((i) => +i.data.quoteId === q.id);
  page.innerHTML = `<div class="card doc-head" data-act="head">
      <div><small class="muted">Objet</small><b>${esc(d.title || '—')}</b></div>
      <div><small class="muted">Client</small><b>${c ? `<a href="#/contact/${c.id}">${esc(contactName(c))}</a>` : '<span class="late">À définir</span>'}</b></div>
      <div><small class="muted">Chantier</small><b>${pr ? `<a href="#/project/${pr.id}">${esc(pr.data.name)}</a>` : '—'}</b></div>
      <div><small class="muted">Date · validité</small><b>${fmtDate(d.date)} → ${fmtDate(d.valid)}</b></div>
      <div><small class="muted">Responsable</small><b>${esc(userName(+d.ownerId))}</b></div>
      <button class="btn sm">${I.edit} Modifier</button></div>
    <div class="status-bar">${Object.entries(QST).map(([k, [l, col]]) => `<button class="${d.status === k ? 'on' : ''}" data-st="${k}" style="--c:${col}">${l}</button>`).join('')}</div>
    <div id="lines"></div>
    <div class="cols-2"><div>${inv.length ? `<div class="card"><div class="card-h"><h3>Factures liées</h3></div><div class="rows">${inv.map((i) => { const s = invState(i); return `<a class="row" href="#/invoice/${i.id}"><span class="grow"><b>${esc(i.number || 'Brouillon')}</b> · ${esc(IKIND[i.data.kind])}</span>${st(IST, s.s)}<b>${money(s.t.base)}</b></a>`; }).join('')}</div></div>` : ''}</div><div id="tot"></div></div>`;
  const drawTot = () => { $('#tot').innerHTML = totalsBox(totals(d), d, true); };
  linesEditor($('#lines'), d, { showCost: true, onChange: () => { drawTot(); $('[data-saved]').textContent = 'Modification…'; save(); } });
  drawTot();
  $('[data-act=head]').onclick = (e) => { if (!e.target.closest('a')) quoteHead(q, contacts, projects, render); };
  $$('[data-st]').forEach((b) => {
    b.onclick = async () => {
      await save.flush();
      d.status = b.dataset.st;
      if (d.status === 'envoye' && !d.sentAt) d.sentAt = today();
      if (d.status === 'accepte') d.acceptedAt = today();
      await persist('quote', q);
      if (d.status === 'accepte') {
        if (d.opportunityId) { try { const o = await db.get('opportunity', +d.opportunityId); o.data.stage = 'gagne'; o.data.wonAt = today(); await persist('opportunity', o); } catch (e) { /* opportunité supprimée */ } }
        if (!q.project_id && confirm('Devis accepté !\n\nCréer le chantier correspondant maintenant ?')) return createProjectFromQuote(q);
      }
      render();
    };
  });
  $('[data-act=more]').onclick = () => menuSheet(`Devis ${q.number}`, [
    { label: 'Modifier l\'en-tête', icon: 'edit', run: () => quoteHead(q, contacts, projects, render) },
    { label: 'Créer une facture…', icon: 'coins', run: async () => { await save.flush(); invoiceFromQuote(q); } },
    { label: 'Créer les commandes fournisseurs / sous-traitants', icon: 'truck', run: async () => { await save.flush(); ordersFromQuote(q); } },
    ...(!q.project_id ? [{ label: 'Créer le chantier', icon: 'crane', run: async () => { await save.flush(); createProjectFromQuote(q); } }] : []),
    { label: 'Envoyer par email', icon: 'mail', run: () => { const cd = c ? c.data : {}; location.href = `mailto:${encodeURIComponent(cd.email || '')}?subject=${encodeURIComponent(`Devis ${q.number} – ${d.title || ''}`)}&body=${encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint notre devis ${q.number} d'un montant de ${money(totals(d).total)} TVAC.\n\nNous restons à votre disposition pour toute question.\n\nCordialement,\n${S.me.name}\n${company().name || ''}`)}`; if (d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); persist('quote', q); } } },
    { label: 'Dupliquer (nouvelle version)', icon: 'copy', run: async () => { await save.flush(); const n = await persist('quote', { project_id: q.project_id, data: { ...JSON.parse(JSON.stringify(d)), status: 'brouillon', date: today(), valid: addDays(today(), num(company().quoteValidity) || 30), acceptedAt: null, sentAt: null, title: d.title } }); go(`#/quote/${n.id}`); } },
    { sep: true },
    { label: 'Supprimer le devis', danger: true, icon: 'trash', run: async () => { if (confirm(`Supprimer le devis ${q.number} ?`)) { await db.del('quote', q.id); go('#/quotes'); } } },
  ]);
  cleanupView = () => save.flush();
});

async function createProjectFromQuote(q) {
  const t = totals(q.data);
  const p = await persist('project', { data: { name: q.data.title || `Chantier ${q.number}`, clientId: q.data.clientId, address: q.data.siteAddress || '', status: 'preparation', managerId: q.data.ownerId || S.me.id, start: today(), color: '#3b5bdb', budget: t.base } });
  q.project_id = p.id;
  await persist('quote', q);
  toast(`Chantier ${p.number} créé`);
  go(`#/project/${p.id}`);
}

// ---------------------------------------------------------------- Factures
const structComm = (n) => {
  const digits = String(n).replace(/\D/g, '').slice(-10).padStart(10, '0');
  const chk = (Number(BigInt(digits) % 97n) || 97).toString().padStart(2, '0');
  const s = digits + chk;
  return `+++${s.slice(0, 3)}/${s.slice(3, 7)}/${s.slice(7)}+++`;
};
async function newInvoice(preset) {
  const co = company();
  const it = await persist('invoice', { project_id: preset.project_id || null, data: { kind: 'facture', status: 'brouillon', date: today(), due: addDays(today(), num(co.paymentDays) || 30), lines: [], payments: [], discount: 0, reverse: false, notes: co.invoiceNotes || '', ...preset.data } });
  go(`#/invoice/${it.id}`);
}
async function invoiceFromQuote(q) {
  const prev = (await db.list('invoice')).filter((i) => +i.data.quoteId === q.id);
  const d = q.data; const disc = num(d.discount) / 100; const qt = totals(d);
  const base = { project_id: q.project_id, data: { quoteId: q.id, clientId: d.clientId, reverse: !!d.reverse, title: d.title } };
  const many = qt.vats.length > 1;
  const prevBase = (list) => { const m = {}; for (const i of list) for (const v of totals(i.data).vats) m[v.rate] = r2((m[v.rate] || 0) + v.base * (i.data.kind === 'avoir' ? 1 : 1)); return m; };
  const disco = (l) => (l.kind === 'item' ? { ...l, id: lid(), price: r2(num(l.price) * (1 - disc)) } : { ...l, id: lid() });
  const mk = (data) => newInvoice({ ...base, data: { ...base.data, ...data } });
  menuSheet(`Facturer le devis ${q.number}${prev.length ? ` (${prev.length} facture(s) existante(s))` : ''}`, [
    { label: `Facture totale (${money(qt.base)} HT)`, run: () => mk({ kind: 'facture', discount: num(d.discount), lines: d.lines.filter((l) => !l.option).map((l) => ({ ...l, id: lid() })) }) },
    { label: "Facture d'acompte (%)", run: async () => {
      const v = await ask("Facture d'acompte", [{ name: 'pct', label: 'Pourcentage du devis', type: 'percent', required: true }], { pct: 30 });
      if (!v) return;
      mk({ kind: 'acompte', lines: qt.vats.map((x) => ({ id: lid(), kind: 'item', desc: `Acompte de ${fnum(num(v.pct))} % sur devis ${q.number}${many ? ` (TVA ${fnum(x.rate)} %)` : ''}`, unit: 'forfait', qty: 1, price: r2(x.base * num(v.pct) / 100), vat: x.rate, type: 'divers' })) });
    } },
    { label: "Facture d'avancement (état des travaux)", run: () => progressInvoice(q, prev, base) },
    { label: 'Facture de solde (reste à facturer)', run: () => {
      const pb = prevBase(prev);
      const lines = d.lines.filter((l) => !l.option).map(disco);
      for (const [rate, b] of Object.entries(pb)) if (Math.abs(b) > 0.005) lines.push({ id: lid(), kind: 'item', deduction: 'previous', desc: `Déjà facturé (${prev.map((i) => i.number || 'brouillon').join(', ')})${many ? ` – TVA ${fnum(+rate)} %` : ''}`, unit: 'forfait', qty: 1, price: -b, vat: +rate, type: 'divers' });
      mk({ kind: 'finale', lines });
    } },
  ]);
}
// ---------------------------------------------------------------- États d'avancement
// Pourcentage cumulé déjà facturé pour chaque ligne du devis (hors facture `exceptId`)
function prevProgress(list, lineId, exceptId) {
  let m = 0;
  for (const i of list) {
    if (i.id === exceptId || i.data.kind !== 'situation') continue;
    const r = (i.data.progressRows || []).find((x) => x.lineId === lineId);
    m = Math.max(m, r ? num(r.cum) : num((i.data.progress || {})[lineId]));
  }
  return m;
}
// Acomptes du devis et montants déjà déduits par taux (hors facture `exceptId`)
function acompteState(list, exceptId) {
  const adv = {}; const done = {};
  for (const i of list) {
    if (i.id === exceptId) continue;
    if (i.data.kind === 'acompte') for (const v of totals(i.data).vats) adv[v.rate] = r2((adv[v.rate] || 0) + v.base);
    if (i.data.kind === 'situation') for (const l of i.data.lines || []) if (l.kind === 'item' && l.deduction === 'acompte') done[num(l.vat)] = r2((done[num(l.vat)] || 0) - r2(num(l.qty) * num(l.price)));
  }
  return { adv, done, advTotal: r2(Object.values(adv).reduce((a, v) => a + v, 0)), doneTotal: r2(Object.values(done).reduce((a, v) => a + v, 0)) };
}

// existing : facture d'avancement en brouillon à modifier
async function progressInvoice(q, prev, base, existing) {
  const d = q.data; const disc = num(d.discount) / 100;
  const src = d.lines.filter((l) => l.kind === 'title' || (l.kind === 'item' && !l.option));
  const old = existing ? existing.data.progressRows || [] : [];
  const rows = src.map((l) => (l.kind === 'title' ? { lineId: l.id, kind: 'title', level: tlevel(l), desc: l.desc } : {
    lineId: l.id, kind: 'item', desc: l.desc, unit: l.unit, vat: num(l.vat), type: l.type, qty: num(l.qty), price: r2(num(l.price) * (1 - disc)),
    prev: prevProgress(prev, l.id, existing && existing.id),
  }));
  rows.forEach((r) => { if (r.kind === 'item') { const o = old.find((x) => x.lineId === r.lineId); r.cum = o ? num(o.cum) : r.prev; } });
  const n = existing ? existing.data.situationNo : prev.filter((i) => i.data.kind === 'situation').length + 1;
  const ac = acompteState(prev, existing && existing.id);
  const nos = numbering(rows);
  const amt = (r, pct) => r2(r.qty * r.price * pct / 100);
  const m = modal(`${mhead(`État d'avancement n° ${n} (EA${n}) – devis ${q.number}`)}<div class="m-body">
    <p class="muted">Encodez l'avancement <b>cumulé</b> de chaque poste, en % ou en quantité. La facture reprend uniquement la différence avec les états précédents. Sur un chapitre, le % s'applique à toutes ses lignes.</p>
    <div class="btns"><button class="btn sm" data-all="100">Tout à 100 %</button><button class="btn sm" data-all="prev">Revenir à l'état précédent</button></div>
    <div class="dt-body"><table class="dt prog"><thead><tr><th>N°</th><th>Désignation</th><th class="r">Qté prévue</th><th>U</th><th class="r">PU HT</th><th class="r">Montant HT</th><th class="r">Préc.</th><th class="r">Cumul %</th><th class="r">Cumul qté</th><th class="r">Cet état</th></tr></thead><tbody>
    ${rows.map((r, i) => (r.kind === 'title'
    ? `<tr class="sec ${r.level === 2 ? 'lv2' : ''}"><td>${nos[i]}</td><td colspan="6"><b>${esc(r.desc)}</b></td><td class="r"><input class="pct" data-ch="${i}" inputmode="decimal" placeholder="%"></td><td></td><td class="r" data-ct="${i}"></td></tr>`
    : `<tr data-r="${i}"><td>${nos[i]}</td><td>${esc(r.desc.split('\n')[0])}</td><td class="r">${fnum(r.qty, 3)}</td><td>${esc(r.unit)}</td><td class="r">${money(r.price)}</td><td class="r">${money(amt(r, 100))}</td><td class="r">${fnum(r.prev, 1)} %</td>
       <td class="r"><input class="pct" data-p="${i}" inputmode="decimal" value="${r2(r.cum)}"></td><td class="r"><input class="pct" data-q="${i}" inputmode="decimal" value="${r2(r.qty * r.cum / 100)}"></td><td class="r" data-per="${i}"></td></tr>`)).join('')}
    </tbody></table></div>
    ${ac.advTotal ? `<div class="card flat"><b>Acomptes facturés : ${money(ac.advTotal)} HT</b> · déjà déduits ${money(ac.doneTotal)} · reste ${money(ac.advTotal - ac.doneTotal)}
      <div class="grid-form" style="margin-top:8px">${fieldHTML({ name: 'dmode', label: 'Déduction de l\'acompte', type: 'select', options: [['prorata', 'Au prorata de l\'avancement (recommandé)'], ['manual', 'Montant libre HT'], ['none', 'Pas de déduction sur cet état']] }, existing ? existing.data.deductMode || 'prorata' : 'prorata')}${fieldHTML({ name: 'damount', label: 'Montant HT à déduire', type: 'money' }, existing ? existing.data.deductAmount || '' : '')}</div></div>` : ''}
    <div class="totals"><div class="tr"><span>Sous-total n°1 (travaux de cet état)</span><b data-t1></b></div>${ac.advTotal ? '<div class="tr"><span>Déduction acompte</span><b data-t2></b></div>' : ''}<div class="tr big"><span>Sous-total n°2 (HT facturé)</span><span data-t3></span></div><div class="tr int"><span>Avancement global cumulé</span><span data-t4></span></div></div></div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>${existing ? 'Mettre à jour la facture' : 'Créer la facture'}</button></div>`, { wide: true });
  const items = rows.filter((r) => r.kind === 'item');
  const clamp = (x) => Math.min(100, Math.max(0, x));
  const deduction = () => {
    if (!ac.advTotal) return {};
    const mode = $('[name=dmode]', m.el).value;
    $('[name=damount]', m.el).closest('.field').hidden = mode !== 'manual';
    const remain = {}; for (const [rate, v] of Object.entries(ac.adv)) remain[rate] = r2(v - (ac.done[rate] || 0));
    const out = {};
    if (mode === 'none') return out;
    const period = {}; const market = {};
    for (const r of items) { period[r.vat] = (period[r.vat] || 0) + amt(r, r.cum - r.prev); market[r.vat] = (market[r.vat] || 0) + amt(r, 100); }
    const allDone = items.every((r) => r.cum >= 100);
    if (mode === 'manual') {
      const want = num($('[name=damount]', m.el).value); const totRemain = Object.values(remain).reduce((a, v) => a + Math.max(0, v), 0);
      for (const [rate, v] of Object.entries(remain)) if (v > 0 && totRemain) out[rate] = r2(Math.min(v, want * v / totRemain));
      return out;
    }
    for (const [rate, v] of Object.entries(remain)) {
      if (v <= 0) continue;
      out[rate] = allDone ? v : r2(Math.min(v, Math.max(0, ac.adv[rate] * (period[rate] || 0) / (market[rate] || 1))));
    }
    return out;
  };
  const upd = () => {
    let t1 = 0;
    rows.forEach((r, i) => {
      if (r.kind !== 'item') return;
      const p = amt(r, r.cum - r.prev); t1 += p;
      $(`[data-per="${i}"]`, m.el).textContent = money(p);
      $(`[data-r="${i}"]`, m.el).classList.toggle('neg', r.cum < r.prev);
    });
    rows.forEach((r, i) => { if (r.kind === 'title') { const end = blockEnd(rows, i); $(`[data-ct="${i}"]`, m.el).textContent = money(rows.slice(i + 1, end).filter((x) => x.kind === 'item').reduce((a, x) => a + amt(x, x.cum - x.prev), 0)); } });
    const ded = Object.values(deduction()).reduce((a, v) => a + v, 0);
    const market = items.reduce((a, r) => a + amt(r, 100), 0); const cum = items.reduce((a, r) => a + amt(r, r.cum), 0);
    $('[data-t1]', m.el).textContent = money(t1);
    if ($('[data-t2]', m.el)) $('[data-t2]', m.el).textContent = money(-ded);
    $('[data-t3]', m.el).textContent = money(t1 - ded);
    $('[data-t4]', m.el).textContent = `${fnum(market ? (cum / market) * 100 : 0, 1)} % – ${money(cum)} / ${money(market)}`;
  };
  $$('[data-p]', m.el).forEach((inp) => { inp.oninput = () => { const r = rows[+inp.dataset.p]; r.cum = clamp(num(inp.value)); $(`[data-q="${inp.dataset.p}"]`, m.el).value = r2(r.qty * r.cum / 100); upd(); }; });
  $$('[data-q]', m.el).forEach((inp) => { inp.oninput = () => { const r = rows[+inp.dataset.q]; r.cum = r.qty ? clamp(num(inp.value) / r.qty * 100) : 0; $(`[data-p="${inp.dataset.q}"]`, m.el).value = r2(r.cum); upd(); }; });
  $$('[data-ch]', m.el).forEach((inp) => {
    inp.onchange = () => {
      if (inp.value.trim() === '') return;
      const i = +inp.dataset.ch; const v = clamp(num(inp.value));
      rows.slice(i + 1, blockEnd(rows, i)).forEach((r, k) => { if (r.kind !== 'item') return; r.cum = v; const j = i + 1 + k; $(`[data-p="${j}"]`, m.el).value = r2(v); $(`[data-q="${j}"]`, m.el).value = r2(r.qty * v / 100); });
      upd();
    };
  });
  $$('[data-all]', m.el).forEach((b) => { b.onclick = () => { rows.forEach((r, i) => { if (r.kind !== 'item') return; r.cum = b.dataset.all === 'prev' ? r.prev : 100; $(`[data-p="${i}"]`, m.el).value = r2(r.cum); $(`[data-q="${i}"]`, m.el).value = r2(r.qty * r.cum / 100); }); upd(); }; });
  ['dmode', 'damount'].forEach((k) => { const e = $(`[name=${k}]`, m.el); if (e) e.addEventListener(k === 'dmode' ? 'change' : 'input', upd); });
  upd();
  $('[data-ok]', m.el).onclick = async () => {
    const lines = []; let pending = [];
    rows.forEach((r) => {
      if (r.kind === 'title') { pending = pending.filter((x) => tlevel(x) < r.level); pending.push({ id: lid(), kind: 'title', level: r.level === 2 ? 2 : undefined, desc: r.desc }); return; }
      const delta = r.cum - r.prev;
      if (Math.abs(delta) < 1e-6) return;
      lines.push(...pending); pending = [];
      lines.push({ id: lid(), kind: 'item', srcId: r.lineId, desc: r.desc, unit: r.unit, qty: Math.round(r.qty * delta / 100 * 10000) / 10000, price: r.price, vat: r.vat, type: r.type });
    });
    if (!lines.some((l) => l.kind === 'item')) return toast('Aucun avancement nouveau à facturer');
    const ded = deduction();
    const dedLines = Object.entries(ded).filter(([, v]) => v > 0).map(([rate, v]) => ({ id: lid(), kind: 'item', deduction: 'acompte', desc: `Déduction acompte${Object.keys(ded).length > 1 ? ` (TVA ${fnum(+rate)} %)` : ''}`, unit: 'forfait', qty: 1, price: -v, vat: +rate, type: 'divers' }));
    lines.push(...dedLines);
    const dedNow = dedLines.reduce((a, l) => a - l.price, 0);
    const restPct = ac.advTotal ? Math.max(0, Math.round(((ac.advTotal - ac.doneTotal - dedNow) / ac.advTotal) * 100)) : 0;
    const extra = {
      kind: 'situation', situationNo: n, ref: `EA${n}`, progressRows: rows.map((r) => ({ ...r })), lines,
      deductMode: ac.advTotal ? $('[name=dmode]', m.el).value : null, deductAmount: ac.advTotal ? num($('[name=damount]', m.el).value) : null,
      docNote: ac.advTotal ? `Acompte - reste à déduire ${restPct}%` : (existing ? existing.data.docNote : ''),
    };
    m.close();
    if (existing) { Object.assign(existing.data, extra); await persist('invoice', existing); toast('État d\'avancement mis à jour'); render(); } else newInvoice({ ...base, data: { ...base.data, ...extra } });
  };
}

route('invoices', async () => {
  const [invoices, contacts, projects] = await Promise.all([db.list('invoice'), db.list('contact'), db.list('project')]);
  const rows = invoices.map((i) => ({ ...i, st: invState(i) }));
  const y = String(new Date().getFullYear());
  const yr = rows.filter((r) => (r.data.date || '').startsWith(y) && r.st.s !== 'brouillon');
  const page = layout({ active: 'finances', icon: 'coins', title: 'Factures', actions: `<button class="btn" data-act="csv">Export comptable</button><button class="btn primary" data-act="new">${I.plus} Nouvelle facture</button>` });
  page.innerHTML = `<div class="kpis">${kpi(`Facturé ${y} HT`, money(yr.reduce((a, r) => a + r.st.t.base, 0)))}${kpi('À envoyer', money(rows.filter((r) => r.st.s === 'brouillon').reduce((a, r) => a + r.st.t.total, 0)), { sub: `${rows.filter((r) => r.st.s === 'brouillon').length} brouillon(s)` })}
    ${kpi('À encaisser', money(rows.filter((r) => ['impayee', 'partielle'].includes(r.st.s)).reduce((a, r) => a + r.st.rest, 0)))}${kpi('En retard', money(rows.filter((r) => r.st.s === 'retard').reduce((a, r) => a + r.st.rest, 0)), { cls: 'bad', sub: `${rows.filter((r) => r.st.s === 'retard').length} facture(s)` })}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows, state: ui.tbl_inv || (ui.tbl_inv = {}),
    search: (i) => [i.number, i.data.title, contactName(byId(contacts, i.data.clientId)), (byId(projects, i.project_id) || { data: {} }).data.name].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ...Object.entries(IST).map(([k, [l, c]]) => [k, l, c])], match: (i, f) => i.st.s === f },
    columns: [
      { l: 'N°', v: (i) => `<b>${esc(i.number || 'Brouillon')}</b>`, sort: (i) => i.number || '' },
      { l: 'Type', v: (i) => esc(IKIND[i.data.kind] || 'Facture') },
      { l: 'Client', v: (i) => esc(contactName(byId(contacts, i.data.clientId))) },
      { l: 'Chantier', v: (i) => esc((byId(projects, i.project_id) || { data: {} }).data.name || '') },
      { l: 'Date', v: (i) => fmtDate(i.data.date), sort: (i) => i.data.date },
      { l: 'Échéance', v: (i) => `<span class="${i.st.s === 'retard' ? 'late' : ''}">${fmtDate(i.data.due)}</span>`, sort: (i) => i.data.due },
      { l: 'Statut', v: (i) => st(IST, i.st.s) },
      { l: 'Total TVAC', cls: 'r', v: (i) => `<b>${money(i.st.t.total)}</b>`, sort: (i) => i.st.t.total },
      { l: 'Reste', cls: 'r', v: (i) => (i.st.s === 'brouillon' || i.st.s === 'avoir' ? '' : money(i.st.rest)), sort: (i) => i.st.rest },
    ],
    onRow: (i) => go(`#/invoice/${i.id}`), empty: 'Aucune facture',
  });
  $('[data-act=new]').onclick = () => newInvoice({ data: {} });
  $('[data-act=csv]').onclick = () => downloadCSV(`factures-${today()}.csv`, [['Numero', 'Type', 'Date', 'Echeance', 'Client', 'TVA client', 'Chantier', 'Base HT', 'TVA', 'Total TVAC', 'Paye', 'Reste', 'Statut'],
    ...rows.filter((r) => r.st.s !== 'brouillon').map((r) => { const c = byId(contacts, r.data.clientId) || { data: {} }; return [r.number, IKIND[r.data.kind], fmtDate(r.data.date), fmtDate(r.data.due), contactName(c), c.data.vat, (byId(projects, r.project_id) || { data: {} }).data.name, fnum(r.st.t.base), fnum(r.st.t.vat), fnum(r.st.t.total), fnum(r.st.paid), fnum(r.st.rest), IST[r.st.s][0]]; })]);
});

route('invoice', async (id) => {
  const it = await db.get('invoice', +id);
  const [contacts, projects] = await Promise.all([db.list('contact'), db.list('project')]);
  const d = it.data; d.payments = d.payments || [];
  const c = byId(contacts, d.clientId); const pr = byId(projects, it.project_id);
  const s = invState(it);
  const locked = d.status === 'emise';
  const save = debounce(async () => { try { await persist('invoice', it, { silent: true }); $('[data-saved]').textContent = 'Enregistré'; } catch (e) { toast('Erreur : ' + e.message); } }, 800);
  const page = layout({ active: 'finances', icon: 'coins', title: `${IKIND[d.kind] || 'Facture'} ${it.number || '(brouillon)'}`, back: pr ? `#/project/${pr.id}/invoices` : '#/invoices',
    sub: `${st(IST, s.s)}${d.peppol && d.peppol.sentAt ? ` ${badge('Peppol ✓', '#0c8599')}` : ''} <span class="muted" data-saved></span>`,
    actions: `<a class="btn" href="#/print/invoice/${it.id}">${I.print} PDF</a>${locked ? `<button class="btn" data-act="peppol">Peppol</button>` : ''}${!locked ? `<button class="btn primary" data-act="emit">Valider et numéroter</button>` : ''}<button class="btn" data-act="more">${I.more} Actions</button>` });
  page.innerHTML = `<div class="card doc-head" data-act="head">
      <div><small class="muted">Client</small><b>${c ? `<a href="#/contact/${c.id}">${esc(contactName(c))}</a>` : '<span class="late">À définir</span>'}</b></div>
      <div><small class="muted">Chantier</small><b>${pr ? `<a href="#/project/${pr.id}">${esc(pr.data.name)}</a>` : '—'}</b></div>
      <div><small class="muted">Date · échéance</small><b>${fmtDate(d.date)} → ${fmtDate(d.due)}</b></div>
      <div><small class="muted">Communication</small><b>${esc(d.communication || '—')}</b></div>
      ${!locked ? `<button class="btn sm">${I.edit} Modifier</button>` : '<span class="badge" style="--c:#2f9e44">Validée</span>'}</div>
    ${locked ? '<div class="alert info">Facture validée : les lignes ne sont plus modifiables. Pour corriger, créez une note de crédit.</div>' : ''}
    ${!locked && d.kind === 'situation' && d.quoteId ? `<div class="alert info">État d'avancement EA${d.situationNo || ''} : les lignes sont calculées depuis l'avancement. <button class="btn sm" data-act="prog">Modifier l'avancement</button></div>` : ''}
    <div id="lines"></div>
    <div class="cols-2"><div>${d.kind === 'avoir' || !locked ? '' : `<div class="card"><div class="card-h"><h3>Paiements reçus</h3><button class="btn sm primary" data-act="pay">${I.plus} Paiement</button></div>
      <div class="rows">${d.payments.map((p, i) => `<button class="row" data-pay="${i}"><span class="grow"><b>${money(p.amount)}</b><small class="muted">${fmtDate(p.date)} · ${esc(p.method || '')}${p.note ? ' · ' + esc(p.note) : ''}</small></span></button>`).join('') || '<div class="empty sm">Aucun paiement</div>'}</div>
      <div class="totals flat"><div class="tr"><span>Payé</span><b>${money(s.paid)}</b></div><div class="tr big"><span>Reste à payer</span><span class="${s.s === 'retard' ? 'late' : ''}">${money(s.rest)}</span></div></div></div>`}</div><div id="tot"></div></div>`;
  const drawTot = () => { $('#tot').innerHTML = totalsBox(totals(d), d, false); };
  linesEditor($('#lines'), d, { showCost: false, readOnly: locked || (d.kind === 'situation' && !!d.quoteId), onChange: () => { drawTot(); $('[data-saved]').textContent = 'Modification…'; save(); } });
  drawTot();
  const head = () => formModal({
    title: 'En-tête de la facture', wide: true, values: { ...d, project_id: it.project_id },
    fields: [
      { name: 'kind', label: 'Type', type: 'select', options: optsOf(IKIND) },
      { name: 'clientId', label: 'Client', type: 'contact', contacts, kinds: ['client', 'prospect', 'architecte', 'autre'] },
      { name: 'project_id', label: 'Chantier', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])] },
      { name: 'date', label: 'Date', type: 'date' }, { name: 'due', label: 'Échéance', type: 'date' },
      { name: 'title', label: 'Objet', cls: 'full' },
      { name: 'discount', label: 'Remise globale %', type: 'percent' },
      { name: 'reverse', label: 'Autoliquidation', type: 'check' },
      { name: 'notes', label: 'Mentions', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { await resolveContact(v, 'clientId', 'client'); it.project_id = v.project_id ? +v.project_id : null; delete v.project_id; Object.assign(d, v, { discount: num(v.discount) }); await persist('invoice', it); render(); },
  });
  $('[data-act=head]').onclick = (e) => { if (!locked && !e.target.closest('a')) head(); };
  const emit = $('[data-act=emit]');
  if (emit) emit.onclick = async () => {
    await save.flush();
    if (!d.clientId) return toast('Choisissez d\'abord le client');
    if (!d.lines.some((l) => l.kind === 'item')) return toast('La facture ne contient aucune ligne');
    if (d.reverse && !(c && c.data.vat)) return toast('Autoliquidation : indiquez d\'abord le n° de TVA du client (obligatoire sur la facture)', 5000);
    if (!confirm('Valider la facture ? Elle recevra son numéro définitif et ne sera plus modifiable.')) return;
    const r = await api('POST', `number/${d.kind === 'avoir' ? 'avoir' : 'invoice'}`);
    it.number = r.number; d.status = 'emise'; d.emittedAt = today();
    if (!d.communication && company().country !== 'FR') d.communication = structComm(r.number.replace(/\D/g, ''));
    await persist('invoice', it); toast(`Facture ${it.number} validée`); render();
  };
  const editPay = (i) => {
    const p = i == null ? { date: today(), amount: Math.max(0, s.rest), method: 'Virement' } : d.payments[i];
    formModal({
      title: i == null ? 'Nouveau paiement' : 'Paiement', values: p,
      fields: [{ name: 'amount', label: 'Montant', type: 'money', required: true }, { name: 'date', label: 'Date', type: 'date' }, { name: 'method', label: 'Mode', type: 'select', options: PAY_METHODS.map((x) => [x, x]) }, { name: 'note', label: 'Remarque', cls: 'full' }],
      async onSave(v) { Object.assign(p, v, { amount: num(v.amount) }); if (i == null) d.payments.push(p); await persist('invoice', it); render(); },
      onDelete: i == null ? null : async () => { d.payments.splice(i, 1); await persist('invoice', it); render(); },
    });
  };
  const pb = $('[data-act=pay]'); if (pb) pb.onclick = () => editPay(null);
  const pp = $('[data-act=peppol]'); if (pp) pp.onclick = () => peppolInvoice(it);
  const editProg = async () => {
    const q = await db.get('quote', +d.quoteId);
    const others = (await db.list('invoice')).filter((i) => +i.data.quoteId === q.id && i.id !== it.id);
    progressInvoice(q, others, { project_id: it.project_id, data: {} }, it);
  };
  const pg = $('[data-act=prog]'); if (pg) pg.onclick = editProg;
  $$('[data-pay]').forEach((b) => { b.onclick = () => editPay(+b.dataset.pay); });
  $('[data-act=more]').onclick = () => menuSheet('Facture', [
    ...(!locked ? [{ label: 'Modifier l\'en-tête', icon: 'edit', run: head }] : []),
    { label: 'Envoyer par email', icon: 'mail', run: () => { location.href = `mailto:${encodeURIComponent((c && c.data.email) || '')}?subject=${encodeURIComponent(`${IKIND[d.kind]} ${it.number || ''}`)}&body=${encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint notre ${(IKIND[d.kind] || 'facture').toLowerCase()} ${it.number || ''} d'un montant de ${money(s.t.total)} TVAC, payable avant le ${fmtDate(d.due)}${company().iban ? ` sur le compte ${company().iban} avec la communication ${d.communication || it.number}` : ''}.\n\nCordialement,\n${S.me.name}\n${company().name || ''}`)}`; } },
    ...(!locked && d.kind === 'situation' && d.quoteId ? [{ label: 'Modifier l\'état d\'avancement', icon: 'edit', run: editProg }] : []),
    ...(locked ? [{ label: 'Peppol – facture électronique', icon: 'file', primary: true, run: () => peppolInvoice(it) }] : []),
    ...(locked && d.kind !== 'avoir' ? [{ label: 'Créer une note de crédit', icon: 'copy', run: () => newInvoice({ project_id: it.project_id, data: { kind: 'avoir', clientId: d.clientId, quoteId: d.quoteId, reverse: d.reverse, discount: d.discount, title: `Annulation facture ${it.number}`, refInvoice: it.number, lines: d.lines.map((l) => (l.kind === 'item' ? { ...l, id: lid(), qty: -num(l.qty) } : { ...l, id: lid() })) } }) }] : []),
    ...(d.quoteId ? [{ label: 'Ouvrir le devis', icon: 'calc', run: () => go(`#/quote/${d.quoteId}`) }] : []),
    ...(!locked ? [{ sep: true }, { label: 'Supprimer le brouillon', danger: true, icon: 'trash', run: async () => { if (confirm('Supprimer ce brouillon ?')) { await db.del('invoice', it.id); go(pr ? `#/project/${pr.id}/invoices` : '#/invoices'); } } }] : []),
  ]);
  cleanupView = () => save.flush();
});

route('payments', async () => {
  const [invoices, contacts] = await Promise.all([db.list('invoice'), db.list('contact')]);
  const rows = [];
  for (const i of invoices) for (const p of i.data.payments || []) rows.push({ i, p });
  const page = layout({ active: 'finances', icon: 'coins', title: 'Paiements reçus' });
  const y = String(new Date().getFullYear());
  page.innerHTML = `<div class="kpis">${kpi(`Encaissé ${y}`, money(rows.filter((r) => (r.p.date || '').startsWith(y)).reduce((a, r) => a + num(r.p.amount), 0)), { cls: 'good' })}${kpi('Ce mois-ci', money(rows.filter((r) => (r.p.date || '').startsWith(today().slice(0, 7))).reduce((a, r) => a + num(r.p.amount), 0)))}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows, state: { sort: -1 }, search: (r) => [r.i.number, contactName(byId(contacts, r.i.data.clientId)), r.p.method].join(' '),
    columns: [{ l: 'Date', v: (r) => fmtDate(r.p.date), sort: (r) => r.p.date }, { l: 'Facture', v: (r) => `<a href="#/invoice/${r.i.id}">${esc(r.i.number || '')}</a>` },
      { l: 'Client', v: (r) => esc(contactName(byId(contacts, r.i.data.clientId))) }, { l: 'Mode', v: (r) => esc(r.p.method || '') }, { l: 'Montant', cls: 'r', v: (r) => `<b>${money(r.p.amount)}</b>`, sort: (r) => num(r.p.amount) }],
    empty: 'Aucun paiement enregistré',
  });
});

// ---------------------------------------------------------------- Commandes
async function newOrder(preset = {}) {
  const it = await persist('order', { project_id: preset.project_id || null, data: { kind: 'fournisseur', status: 'brouillon', date: today(), lines: [], ...preset, project_id: undefined } });
  go(`#/order/${it.id}`);
}
async function ordersFromQuote(q) {
  const [contacts, articles] = await Promise.all([db.list('contact'), db.list('article')]);
  const sups = contacts.filter((c) => ['fournisseur', 'soustraitant'].includes(c.data.kind));
  if (!sups.length) return toast('Ajoutez d\'abord vos fournisseurs et sous-traitants dans Contacts', 4000);
  const lines = q.data.lines.filter((l) => l.kind === 'item' && !l.option && ['mat', 'materiel', 'st', 'ouvrage'].includes(l.type));
  if (!lines.length) return toast('Aucune ligne de type matériaux, matériel ou sous-traitance dans ce devis', 4000);
  const defSup = (l) => l.supplierId || (byId(articles, l.articleId) || { data: {} }).data.supplierId || '';
  const m = modal(`${mhead(`Commandes depuis le devis ${q.number}`)}<div class="m-body"><p class="muted">Cochez les lignes à commander et choisissez le fournisseur ou sous-traitant. Une commande est créée par fournisseur, au prix de déboursé.</p>
    <table class="dt"><thead><tr><th></th><th>Désignation</th><th class="r">Qté</th><th>Fournisseur</th></tr></thead><tbody>
    ${lines.map((l, i) => `<tr><td><input type="checkbox" data-c="${i}" checked></td><td>${esc(l.desc.split('\n')[0])}<br><small class="muted">${esc(TYPES[l.type] || 'Ouvrage')} · déboursé ${money(l.cost)}</small></td><td class="r">${fnum(num(l.qty), 3)} ${esc(l.unit)}</td>
      <td><select data-s="${i}"><option value="">—</option>${sups.map((s) => `<option value="${s.id}" ${s.id === +defSup(l) ? 'selected' : ''}>${esc(contactName(s))}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Créer les commandes</button></div>`, { wide: true });
  $('[data-ok]', m.el).onclick = async () => {
    const groups = new Map();
    lines.forEach((l, i) => {
      if (!$(`[data-c="${i}"]`, m.el).checked) return;
      const sid = +$(`[data-s="${i}"]`, m.el).value; if (!sid) return;
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push({ id: lid(), kind: 'item', desc: l.desc, unit: l.unit, qty: l.qty, price: num(l.cost), vat: l.vat, type: l.type });
    });
    if (!groups.size) return toast('Choisissez au moins un fournisseur');
    let n = 0;
    for (const [sid, ls] of groups) {
      const sup = byId(sups, sid);
      await persist('order', { project_id: q.project_id, data: { kind: sup.data.kind === 'soustraitant' ? 'soustraitant' : 'fournisseur', supplierId: sid, status: 'brouillon', date: today(), quoteId: q.id, lines: ls } });
      n++;
    }
    m.close(); toast(`${n} commande(s) créée(s)`);
    go(q.project_id ? `#/project/${q.project_id}/orders` : '#/orders/fournisseur');
  };
}

route('orders', async (kind = 'fournisseur') => {
  const [orders, contacts, projects] = await Promise.all([db.list('order'), db.list('contact'), db.list('project')]);
  const rows = orders.filter((o) => (o.data.kind || 'fournisseur') === kind);
  const page = layout({ active: 'orders', icon: 'truck', title: kind === 'soustraitant' ? 'Commandes sous-traitants' : 'Commandes fournisseurs', actions: `<button class="btn primary" data-act="new">${I.plus} Nouvelle commande</button>` });
  dataTable(page, {
    rows, state: ui.tbl_ord || (ui.tbl_ord = {}),
    search: (o) => [o.number, contactName(byId(contacts, o.data.supplierId)), (byId(projects, o.project_id) || { data: {} }).data.name].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ...Object.entries(OST).map(([k, [l, c]]) => [k, l, c])], match: (o, f) => o.data.status === f },
    columns: [
      { l: 'N°', v: (o) => `<b>${esc(o.number)}</b>` }, { l: 'Fournisseur', v: (o) => esc(contactName(byId(contacts, o.data.supplierId))) },
      { l: 'Chantier', v: (o) => esc((byId(projects, o.project_id) || { data: {} }).data.name || '') }, { l: 'Date', v: (o) => fmtDate(o.data.date), sort: (o) => o.data.date },
      { l: 'Livraison', v: (o) => fmtDate(o.data.deliveryDate) }, { l: 'Statut', v: (o) => st(OST, o.data.status) }, { l: 'Total HT', cls: 'r', v: (o) => `<b>${money(totals(o.data).base)}</b>`, sort: (o) => totals(o.data).base },
    ],
    onRow: (o) => go(`#/order/${o.id}`), empty: 'Aucune commande',
  });
  $('[data-act=new]').onclick = () => newOrder({ kind });
});

route('order', async (id) => {
  const it = await db.get('order', +id);
  const [contacts, projects] = await Promise.all([db.list('contact'), db.list('project')]);
  const d = it.data;
  const sup = byId(contacts, d.supplierId); const pr = byId(projects, it.project_id);
  const save = debounce(async () => { try { await persist('order', it, { silent: true }); $('[data-saved]').textContent = 'Enregistré'; } catch (e) { toast('Erreur : ' + e.message); } }, 800);
  const page = layout({ active: 'orders', icon: 'truck', title: `Commande ${it.number}`, back: pr ? `#/project/${pr.id}/orders` : `#/orders/${d.kind || 'fournisseur'}`,
    sub: `${st(OST, d.status)} <span class="muted" data-saved></span>`, actions: `<a class="btn" href="#/print/order/${it.id}">${I.print} PDF</a><button class="btn" data-act="more">${I.more} Actions</button>` });
  page.innerHTML = `<div class="card doc-head" data-act="head">
      <div><small class="muted">${d.kind === 'soustraitant' ? 'Sous-traitant' : 'Fournisseur'}</small><b>${sup ? `<a href="#/contact/${sup.id}">${esc(contactName(sup))}</a>` : '<span class="late">À définir</span>'}</b></div>
      <div><small class="muted">Chantier</small><b>${pr ? `<a href="#/project/${pr.id}">${esc(pr.data.name)}</a>` : '—'}</b></div>
      <div><small class="muted">Date · livraison</small><b>${fmtDate(d.date)} → ${fmtDate(d.deliveryDate) || '—'}</b></div>
      <button class="btn sm">${I.edit} Modifier</button></div>
    <div class="status-bar">${Object.entries(OST).map(([k, [l, col]]) => `<button class="${d.status === k ? 'on' : ''}" data-st="${k}" style="--c:${col}">${l}</button>`).join('')}</div>
    <div id="lines"></div><div class="cols-2"><div></div><div id="tot"></div></div>`;
  const drawTot = () => { $('#tot').innerHTML = totalsBox(totals(d), d, false); };
  linesEditor($('#lines'), d, { showCost: false, onChange: () => { drawTot(); $('[data-saved]').textContent = 'Modification…'; save(); } });
  drawTot();
  const head = () => formModal({
    title: 'Commande', wide: true, values: { ...d, project_id: it.project_id },
    fields: [
      { name: 'kind', label: 'Type', type: 'select', options: [['fournisseur', 'Fournisseur'], ['soustraitant', 'Sous-traitant']] },
      { name: 'supplierId', label: 'Fournisseur / sous-traitant', type: 'contact', contacts, kinds: ['fournisseur', 'soustraitant'] },
      { name: 'project_id', label: 'Chantier', type: 'select', options: [['', '—'], ...projects.map((p) => [p.id, `${p.number} · ${p.data.name}`])] },
      { name: 'date', label: 'Date', type: 'date' }, { name: 'deliveryDate', label: 'Livraison souhaitée', type: 'date' }, { name: 'ref', label: 'Référence' },
      { name: 'notes', label: 'Remarques (livraison, accès…)', type: 'textarea', cls: 'full' },
    ],
    async onSave(v) { await resolveContact(v, 'supplierId', v.kind); it.project_id = v.project_id ? +v.project_id : null; delete v.project_id; Object.assign(d, v); await persist('order', it); render(); },
  });
  $('[data-act=head]').onclick = (e) => { if (!e.target.closest('a')) head(); };
  $$('[data-st]').forEach((b) => { b.onclick = async () => { await save.flush(); d.status = b.dataset.st; await persist('order', it); render(); }; });
  $('[data-act=more]').onclick = () => menuSheet('Commande', [
    { label: 'Envoyer par email', icon: 'mail', run: () => { location.href = `mailto:${encodeURIComponent((sup && sup.data.email) || '')}?subject=${encodeURIComponent(`Commande ${it.number}${pr ? ' – ' + pr.data.name : ''}`)}&body=${encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande ${it.number}${d.deliveryDate ? `, livraison souhaitée le ${fmtDate(d.deliveryDate)}` : ''}${pr ? ` sur le chantier ${pr.data.name} (${[pr.data.address, pr.data.city].filter(Boolean).join(', ')})` : ''}.\n\nMerci de nous confirmer la bonne réception.\n\nCordialement,\n${S.me.name}`)}`; if (d.status === 'brouillon') { d.status = 'envoyee'; persist('order', it); } } },
    { label: 'Enregistrer la facture fournisseur (achat)', icon: 'coins', run: () => editExpense(null, { project_id: it.project_id, supplierId: d.supplierId, orderId: it.id, amount: totals(d).base, category: d.kind === 'soustraitant' ? 'st' : 'mat', desc: `Commande ${it.number}` }) },
    { sep: true },
    { label: 'Supprimer', danger: true, icon: 'trash', run: async () => { if (confirm('Supprimer cette commande ?')) { await db.del('order', it.id); go(pr ? `#/project/${pr.id}/orders` : '#/orders/fournisseur'); } } },
  ]);
  cleanupView = () => save.flush();
});
