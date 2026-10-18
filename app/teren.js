'use strict';
/* Teren (în stilul Aproplan): formulare / checklist-uri, jurnal de șantier, desen pe planuri și versiuni de plan,
   trimiterea punctelor către firme și pachete de proiect pentru colegi. Se încarcă după app.js și gestiune.js. */

// ---------------------------------------------------------------- Constante
const ANS = {
  ok:  { label: 'Conform',   short: 'Conform', color: '#2f9e44' },
  nok: { label: 'Neconform', short: 'Neconf.', color: '#e5484d' },
  na:  { label: 'N.A.',      short: 'N.A.',    color: '#868e96' },
};
const WEATHER = ['Însorit', 'Parțial noros', 'Noros', 'Ceață', 'Ploaie', 'Furtună', 'Ninsoare', 'Vânt puternic', 'Ger'];
// Un rând care începe cu „#” este un titlu de secțiune, unul care începe cu „text:” cere un răspuns liber.
const DEFAULT_TEMPLATES = [
  ['Recepție la terminarea lucrărilor', ['#Documente', 'Procese-verbale de lucrări ascunse semnate', 'Certificate de calitate pentru materiale', 'Planuri as-built predate',
    '#Finisaje', 'Pereți fără fisuri, planeitate corectă', 'Pardoseli fără denivelări sau plăci sparte', 'Tâmplărie funcțională, fără deteriorări', 'Curățenie finală efectuată',
    '#Instalații', 'Prize și întrerupătoare funcționale', 'Robinete și scurgeri fără pierderi', 'Încălzire / climatizare funcțională', 'text:Alte observații']],
  ['Inspecție securitate și sănătate (SSM)', ['#Organizare', 'Împrejmuire și panou de șantier', 'Căi de acces libere și marcate', 'Trusă de prim ajutor și stingătoare',
    '#Echipamente de protecție', 'Personalul poartă cască, vestă și bocanci', 'Ham de siguranță la lucrul la înălțime', 'Schele verificate, cu balustrade',
    '#Riscuri', 'Goluri și margini protejate', 'Instalație electrică provizorie protejată', 'Deșeuri depozitate corespunzător', 'text:Măsuri dispuse']],
  ['Verificare înainte de turnarea betonului', ['#Cofraj', 'Cote și dimensiuni conform proiectului', 'Cofraj etanș, curat, cu decofrol', 'Sprijiniri stabile',
    '#Armătură', 'Diametre și număr de bare conform proiectului', 'Acoperire cu beton asigurată (distanțieri)', 'Legături și înnădiri corecte',
    '#Diverse', 'Piese înglobate și goluri de trecere', 'Rost de lucru tratat', 'Clasa betonului comandată corect', 'text:Furnizor beton / nr. aviz']],
];
const MK_COLORS = ['#e5484d', '#f08c00', '#1f4fd8', '#2f9e44', '#111111'];
const MK_TOOLS = [['pen', '✎ Creion'], ['arrow', '↗ Săgeată'], ['rect', '▭ Dreptunghi'], ['cloud', '☁ Nor'], ['text', 'T Text'], ['erase', '⌫ Radieră']];

I.share = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/><path d="M16 6l-4-4-4 4M12 2v14"/></svg>';
I.pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3-1 5-3 7-5M14.5 4.5l5 5L9 20H4v-5z"/></svg>';

function debounce(fn, ms = 400) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = () => { clearTimeout(t); return fn(); };
  return d;
}
async function copyBlob(id) { const b = await getBlob(id); return b ? saveBlob(b) : null; }
async function addPhotoFiles(files) {
  const ids = [];
  for (const f of files) {
    try { const r = await resizeImage(await blobToImg(f), 1800, 'image/jpeg', 0.85); ids.push(await saveBlob(r.blob)); } catch (e) { toast(e.message); }
  }
  return ids;
}
// Afișează o grilă de fotografii cu buton de adăugare; fotografiile se pot șterge sau adnota
async function photoStrip(box, list, onChange) {
  const urls = await Promise.all(list.map(blobURL));
  box.innerHTML = urls.map((u, i) => `<img src="${u}" data-ph="${i}" alt="">`).join('') + `<label class="add">${I.camera}<span>Foto</span><input type="file" accept="image/*" multiple></label>`;
  $('input', box).onchange = async (e) => { list.push(...(await addPhotoFiles([...e.target.files]))); onChange(); photoStrip(box, list, onChange); };
  $$('[data-ph]', box).forEach((im) => {
    im.onclick = () => {
      const i = +im.dataset.ph;
      photoViewer(list[i], {
        onDelete() { delBlob(list[i]); list.splice(i, 1); onChange(); photoStrip(box, list, onChange); },
        onReplace(id) { delBlob(list[i]); list[i] = id; onChange(); photoStrip(box, list, onChange); },
      });
    };
  });
}
function docHead(pr, title) {
  return `<div class="head"><div><h1>${esc(title)}</h1><div><b>${esc(pr.name)}</b></div>
    <div class="muted">${esc([pr.client && 'Beneficiar: ' + pr.client, pr.address].filter(Boolean).join(' · '))}</div></div>
    <div class="muted" style="text-align:right">${esc(settings.name || '')}${settings.name ? '<br>' : ''}Generat: ${fmtTime(Date.now())}</div></div>`;
}

// ---------------------------------------------------------------- Șabloane de formulare
const parseItems = (text, old = []) => text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
  const kind = s.startsWith('#') ? 'section' : /^text:/i.test(s) ? 'text' : 'check';
  const label = s.replace(/^#\s*/, '').replace(/^text:\s*/i, '');
  const prev = old.find((o) => o.kind === kind && o.label === label);
  return { id: prev ? prev.id : uid(), kind, label };
});
const itemsText = (items) => items.map((i) => (i.kind === 'section' ? '#' : i.kind === 'text' ? 'text:' : '') + i.label).join('\n');

async function ensureTemplates() {
  if (settings.templatesSeeded) return;
  for (const [name, lines] of DEFAULT_TEMPLATES) await db.put('templates', { id: uid(), name, items: parseItems(lines.join('\n')), created: Date.now() });
  settings.templatesSeeded = true;
  await saveSettings();
}

async function manageTemplates() {
  await ensureTemplates();
  const list = (await db.all('templates')).sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Șabloane de formulare</h2><button class="link" data-close>Gata</button></div>
    <div class="sheet-body"><div class="list">${list.map((t) => `<button class="row" data-t="${t.id}"><span class="main"><div class="t">${esc(t.name)}</div>
      <div class="s">${t.items.filter((i) => i.kind !== 'section').length} elemente de verificat</div></span></button>`).join('')}</div>
      <div class="btns" style="margin-top:12px"><button class="btn primary" data-new>${I.plus} Șablon nou</button></div></div>`);
  $('[data-new]', s.el).onclick = () => editTemplate();
  $$('[data-t]', s.el).forEach((b) => { b.onclick = () => editTemplate(list.find((t) => t.id === b.dataset.t)); });
}

function editTemplate(t) {
  formSheet({
    title: t ? 'Șablon' : 'Șablon nou',
    values: t ? { name: t.name, items: itemsText(t.items) } : { items: '#Secțiune\nElement de verificat\ntext:Observații' },
    fields: [
      { name: 'name', label: 'Denumire', required: true, placeholder: 'ex. Verificare hidroizolație' },
      { name: 'items', label: 'Elemente (câte unul pe rând)', type: 'textarea', rows: 14, required: true },
    ],
    extra: '<div class="muted">Un rând care începe cu <b>#</b> este titlu de secțiune. Un rând care începe cu <b>text:</b> cere un răspuns scris. Restul rândurilor se bifează Conform / Neconform / N.A.</div>',
    async onSave(v) {
      const o = Object.assign(t || { id: uid(), created: Date.now() }, { name: v.name, items: parseItems(v.items, t ? t.items : []) });
      await db.put('templates', o);
      closeAllSheets();
      manageTemplates();
    },
    onDelete: t ? async () => { await db.del('templates', t.id); closeAllSheets(); manageTemplates(); } : null,
  });
}

// ---------------------------------------------------------------- Formulare / checklist-uri
const formCounts = (f) => {
  const c = { ok: 0, nok: 0, na: 0, todo: 0 };
  for (const it of f.items) if (it.kind === 'check') { const a = (f.answers[it.id] || {}).v; c[a || 'todo']++; }
  return c;
};

async function tabForms(pr, el) {
  await ensureTemplates();
  const [forms, templates, companies] = await Promise.all([db.where('forms', pr.id), db.all('templates'), db.where('companies', pr.id)]);
  forms.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  el.innerHTML = `<div class="toolbar"><button class="btn" data-act="tpl">Gestionează șabloanele</button></div>
    ${forms.length ? `<div class="list">${forms.map((f) => {
      const c = formCounts(f);
      const co = companies.find((x) => x.id === f.companyId);
      return `<button class="row" data-f="${f.id}"><span class="dot" style="--c:${f.status === 'done' ? '#2f9e44' : '#f08c00'}"></span><span class="main">
        <div class="t">${esc(f.name)}</div><div class="s">${esc([fmtDate(f.date), f.status === 'done' ? 'Finalizat' : 'În lucru', co && co.name, f.location].filter(Boolean).join(' · '))}</div></span>
        <span class="chips" style="margin:0">${c.nok ? `<span class="chip red">${c.nok} neconf.</span>` : ''}<span class="chip">${c.ok + c.nok + c.na}/${c.ok + c.nok + c.na + c.todo}</span></span></button>`;
    }).join('')}</div>` : empty('Niciun formular', 'Completează checklist-uri de recepție, siguranță sau calitate direct pe șantier, cu poze și semnătură, apoi exportă-le PDF.')}
    <button class="fab" data-act="new">${I.plus}<span>Formular nou</span></button>`;
  $('[data-act=tpl]', el).onclick = manageTemplates;
  $('[data-act=new]', el).onclick = () => actionSheet('Alege șablonul', [
    ...templates.sort((a, b) => a.name.localeCompare(b.name, 'ro')).map((t) => ({ label: t.name, run: async () => {
      const f = { id: uid(), projectId: pr.id, templateId: t.id, name: t.name, date: today(), location: '', companyId: '', inspector: settings.name || '', status: 'draft',
        items: structuredClone(t.items), answers: {}, signatureId: '', signer: '', created: Date.now() };
      await db.put('forms', f);
      openForm(pr, f);
    } })),
    { label: '+ Șablon nou', run: () => editTemplate() },
  ]);
  $$('[data-f]', el).forEach((b) => { b.onclick = () => openForm(pr, forms.find((f) => f.id === b.dataset.f)); });
}

async function openForm(pr, f) {
  const companies = await db.where('companies', pr.id);
  const save = debounce(() => db.put('forms', f));
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Închide</button><h2>${esc(f.name)}</h2><button class="link strong" data-pdf>PDF</button></div>
    <div class="sheet-body form" id="fb"></div>`, { full: true, onClose: () => { save.flush(); render(); } });
  const body = $('#fb', s.el);
  let n = 0;
  body.innerHTML = `
    <div class="row2">${field({ name: 'date', label: 'Data', type: 'date' }, f.date)}${field({ name: 'location', label: 'Zonă / locație', placeholder: 'ex. Etaj 2, ap. 7' }, f.location)}</div>
    <div class="row2">${field({ name: 'companyId', label: 'Firmă verificată', type: 'select', options: [['', '—'], ...companies.map((c) => [c.id, c.name])] }, f.companyId)}${field({ name: 'inspector', label: 'Verificat de' }, f.inspector)}</div>
    <div class="summary" id="fsum"></div>
    ${f.items.map((it) => {
      if (it.kind === 'section') return `<div class="section-title" style="margin-bottom:0">${esc(it.label)}</div>`;
      const a = f.answers[it.id] || {};
      n++;
      if (it.kind === 'text') return `<div class="fi"><div class="fi-l"><span class="lno">${n}</span>${esc(it.label)}</div><textarea data-txt="${it.id}" rows="2">${esc(a.text || '')}</textarea></div>`;
      return `<div class="fi" data-it="${it.id}"><div class="fi-l"><span class="lno">${n}</span>${esc(it.label)}</div>
        <div class="seg seg3">${Object.entries(ANS).map(([k, v]) => `<button type="button" data-a="${k}" style="--c:${v.color}" class="${a.v === k ? 'on' : ''}">${v.short}</button>`).join('')}</div>
        <input type="text" data-note placeholder="Observație…" value="${esc(a.note || '')}">
        <div class="photos fi-ph"></div>
        <button type="button" class="btn small" data-pt ${a.v === 'nok' ? '' : 'hidden'}>→ Creează punct de remediere${a.pointId ? ' (încă unul)' : ''}</button></div>`;
    }).join('')}
    <div class="section-title">Semnătură</div>
    ${field({ name: 'signer', label: 'Nume semnatar' }, f.signer)}
    <div id="sig"></div>
    <div class="btns"><button type="button" class="btn primary" data-done></button><button type="button" class="btn danger" data-delf>Șterge formularul</button></div>`;
  const E = (name) => $(`[name=${name}]`, body);
  ['date', 'location', 'companyId', 'inspector', 'signer'].forEach((k) => { E(k).addEventListener(E(k).tagName === 'SELECT' ? 'change' : 'input', () => { f[k] = E(k).value; save(); }); });
  const ans = (id) => f.answers[id] || (f.answers[id] = {});
  const drawSum = () => {
    const c = formCounts(f);
    $('#fsum', body).innerHTML = `${Object.entries(ANS).map(([k, v]) => `<span class="chip"><span class="dot" style="--c:${v.color}"></span>${v.label}: ${c[k]}</span>`).join('')}<span class="chip">Necompletate: ${c.todo}</span>`;
    $('[data-done]', body).textContent = f.status === 'done' ? 'Redeschide formularul' : 'Finalizează formularul';
  };
  $$('[data-it]', body).forEach((box) => {
    const id = box.dataset.it;
    $$('[data-a]', box).forEach((b) => {
      b.onclick = () => {
        const a = ans(id);
        a.v = a.v === b.dataset.a ? '' : b.dataset.a;
        $$('[data-a]', box).forEach((x) => x.classList.toggle('on', x.dataset.a === a.v));
        $('[data-pt]', box).hidden = a.v !== 'nok';
        save(); drawSum();
      };
    });
    $('[data-note]', box).oninput = (e) => { ans(id).note = e.target.value; save(); };
    const a0 = ans(id);
    a0.photos = a0.photos || [];
    photoStrip($('.fi-ph', box), a0.photos, save);
    $('[data-pt]', box).onclick = async () => {
      const a = ans(id);
      const it = f.items.find((x) => x.id === id);
      const photos = [];
      for (const p of a.photos) { const c = await copyBlob(p); if (c) photos.push(c); }
      save.flush();
      editPoint({ projectId: pr.id, title: it.label, desc: [a.note, `Din formularul „${f.name}” din ${fmtDate(f.date)}${f.location ? ', ' + f.location : ''}.`].filter(Boolean).join('\n'),
        companyId: f.companyId, category: 'Neconformitate', priority: 'high', photos }, { onDone: () => { a.pointId = true; save(); toast('Punct creat – îl găsești în tabul Puncte'); } });
    };
  });
  $$('[data-txt]', body).forEach((t) => { t.oninput = () => { ans(t.dataset.txt).text = t.value; save(); }; });
  signaturePad($('#sig', body), f.signatureId, (id) => { if (f.signatureId && f.signatureId !== id) delBlob(f.signatureId); f.signatureId = id; save(); });
  $('[data-done]', body).onclick = () => {
    const c = formCounts(f);
    if (f.status !== 'done' && c.todo && !confirm(`Mai sunt ${c.todo} elemente necompletate. Finalizezi oricum?`)) return;
    f.status = f.status === 'done' ? 'draft' : 'done';
    save(); drawSum(); toast(f.status === 'done' ? 'Formular finalizat' : 'Formular redeschis');
  };
  $('[data-delf]', body).onclick = async () => {
    if (!confirm('Ștergi formularul?')) return;
    for (const a of Object.values(f.answers)) for (const p of a.photos || []) await delBlob(p);
    await delBlob(f.signatureId);
    await db.del('forms', f.id);
    save.flush = () => {}; // nu mai salvăm la închidere
    s.close();
  };
  $('[data-pdf]', s.el).onclick = async () => {
    await save.flush();
    printJob = { type: 'form', formId: f.id, back: `#/p/${pr.id}/forms` };
    s.close();
    go(`#/p/${pr.id}/print`);
  };
  drawSum();
}

function signaturePad(box, current, onSave) {
  const draw = async () => {
    if (current) {
      box.innerHTML = `<div class="sig-box"><img src="${await blobURL(current)}" alt="Semnătură"></div><div class="btns"><button type="button" class="btn small" data-re>Semnează din nou</button></div>`;
      $('[data-re]', box).onclick = () => { current = ''; draw(); };
      return;
    }
    box.innerHTML = `<div class="sig-box"><canvas width="900" height="300"></canvas><span class="sig-hint">Semnează aici cu degetul</span></div>
      <div class="btns"><button type="button" class="btn small" data-clr>Șterge</button><button type="button" class="btn small primary" data-ok>Salvează semnătura</button></div>`;
    const cv = $('canvas', box); const ctx = cv.getContext('2d');
    ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let drawing = false; let dirty = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.style.touchAction = 'none';
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); drawing = true; dirty = true; $('.sig-hint', box).hidden = true; ctx.beginPath(); ctx.moveTo(...pos(e)); ctx.lineTo(...pos(e)); ctx.stroke(); };
    cv.onpointermove = (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); };
    cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
    $('[data-clr]', box).onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; $('.sig-hint', box).hidden = false; };
    $('[data-ok]', box).onclick = async () => {
      if (!dirty) return toast('Semnează mai întâi');
      current = await saveBlob(await canvasToBlob(cv, 'image/png'));
      onSave(current);
      toast('Semnătură salvată');
      draw();
    };
  };
  draw();
}

// ---------------------------------------------------------------- Jurnal de șantier
const wfTotal = (d) => Object.values(d.workforce || {}).reduce((a, x) => a + num(x), 0);

async function tabDiary(pr, el) {
  const [days, companies] = await Promise.all([db.where('diary', pr.id), db.where('companies', pr.id)]);
  days.sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = `<div class="card form" style="margin-bottom:12px">
      <div class="card-title">Raport jurnal (PDF)</div>
      <div class="row2">${field({ name: 'from', label: 'De la', type: 'date' }, days.length ? days[days.length - 1].date : today())}${field({ name: 'to', label: 'Până la', type: 'date' }, today())}</div>
      <div class="btns"><button class="btn" data-act="pdf">${I.print} Generează PDF</button></div>
    </div>
    ${days.length ? `<div class="list">${days.map((d) => `<button class="row" data-d="${d.id}"><span class="main">
      <div class="t">${fmtDate(d.date)} · ${esc(d.weather || '—')}${d.tMax !== '' && d.tMax != null ? ` · ${esc(d.tMin)}…${esc(d.tMax)}°C` : ''}</div>
      <div class="s">${wfTotal(d)} persoane${d.works ? ' · ' + esc(d.works.split('\n')[0]) : ''}</div></span>
      ${d.incidents ? '<span class="chip red">incident</span>' : ''}${(d.photos || []).length ? `<span class="chip">${d.photos.length} foto</span>` : ''}</button>`).join('')}</div>`
    : empty('Jurnalul este gol', 'Notează zilnic vremea, efectivele pe firme, lucrările executate, livrările și incidentele.')}
    <button class="fab" data-act="today">${I.plus}<span>Jurnal azi</span></button>`;
  $('[data-act=today]', el).onclick = () => openDiary(pr, days.find((d) => d.date === today()) || null, companies);
  $$('[data-d]', el).forEach((b) => { b.onclick = () => openDiary(pr, days.find((d) => d.id === b.dataset.d), companies); });
  $('[data-act=pdf]', el).onclick = () => {
    const from = $('[name=from]', el).value; const to = $('[name=to]', el).value;
    printJob = { type: 'diary', from: from <= to ? from : to, to: from <= to ? to : from, back: `#/p/${pr.id}/diary` };
    go(`#/p/${pr.id}/print`);
  };
}

async function openDiary(pr, d, companies) {
  if (!d) {
    const prev = (await db.where('diary', pr.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
    d = { id: uid(), projectId: pr.id, date: today(), weather: '', tMin: '', tMax: '', workforce: prev ? { ...prev.workforce } : {}, works: '', deliveries: '', visitors: '', incidents: '', photos: [], created: Date.now() };
    await db.put('diary', d);
  }
  d.photos = d.photos || [];
  d.workforce = d.workforce || {};
  const save = debounce(() => db.put('diary', d));
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Închide</button><h2>Jurnal ${fmtDate(d.date)}</h2><button class="link strong" data-pdf>PDF</button></div>
    <div class="sheet-body form" id="db">
      <div class="row2">${field({ name: 'date', label: 'Data', type: 'date' }, d.date)}${field({ name: 'weather', label: 'Vremea', type: 'select', options: [['', '—'], ...WEATHER.map((w) => [w, w])] }, d.weather)}</div>
      <div class="row2">${field({ name: 'tMin', label: 'Temp. minimă °C', mode: 'decimal' }, d.tMin)}${field({ name: 'tMax', label: 'Temp. maximă °C', mode: 'decimal' }, d.tMax)}</div>
      <button type="button" class="btn small" data-wx>☀ Preia vremea pentru locația curentă</button>
      <div class="field"><span>Efective pe șantier (persoane)</span><div class="checks">
        <label><span style="flex:1">Echipa proprie</span><input class="wf" data-wf="own" inputmode="numeric" value="${esc(d.workforce.own || '')}"></label>
        ${companies.map((c) => `<label><span style="flex:1">${esc(c.name)}</span><input class="wf" data-wf="${c.id}" inputmode="numeric" value="${esc(d.workforce[c.id] || '')}"></label>`).join('')}
      </div><div class="muted" id="wft"></div></div>
      ${field({ name: 'works', label: 'Lucrări executate', type: 'textarea', rows: 4 }, d.works)}
      ${field({ name: 'deliveries', label: 'Livrări / utilaje', type: 'textarea', rows: 2 }, d.deliveries)}
      ${field({ name: 'visitors', label: 'Vizitatori / dispoziții de șantier', type: 'textarea', rows: 2 }, d.visitors)}
      ${field({ name: 'incidents', label: 'Incidente / întârzieri / probleme', type: 'textarea', rows: 2 }, d.incidents)}
      <div class="field"><span>Fotografii</span><div class="photos" id="dph"></div></div>
      <button type="button" class="btn danger block" data-deld>Șterge ziua</button>
    </div>`, { full: true, onClose: () => { save.flush(); render(); } });
  const body = $('#db', s.el);
  const wft = () => { $('#wft', body).textContent = `Total: ${wfTotal(d)} persoane`; };
  ['date', 'weather', 'tMin', 'tMax', 'works', 'deliveries', 'visitors', 'incidents'].forEach((k) => {
    const inp = $(`[name=${k}]`, body);
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => { d[k] = inp.value; save(); });
  });
  $$('[data-wf]', body).forEach((inp) => { inp.oninput = () => { d.workforce[inp.dataset.wf] = inp.value; save(); wft(); }; });
  photoStrip($('#dph', body), d.photos, save);
  $('[data-wx]', body).onclick = async () => {
    try {
      toast('Se preia vremea…', 10000);
      const w = await fetchWeather(d.date);
      Object.assign(d, w);
      $('[name=weather]', body).value = w.weather; $('[name=tMin]', body).value = w.tMin; $('[name=tMax]', body).value = w.tMax;
      save(); toast(`${w.weather}, ${w.tMin}…${w.tMax}°C`);
    } catch (e) { toast('Vremea nu a putut fi preluată: ' + (e.message || 'fără acces la locație'), 4000); }
  };
  $('[data-deld]', body).onclick = async () => {
    if (!confirm('Ștergi această zi din jurnal?')) return;
    for (const p of d.photos) await delBlob(p);
    await db.del('diary', d.id);
    save.flush = () => {};
    s.close();
  };
  $('[data-pdf]', s.el).onclick = async () => {
    await save.flush();
    printJob = { type: 'diary', from: d.date, to: d.date, back: `#/p/${pr.id}/diary` };
    s.close();
    go(`#/p/${pr.id}/print`);
  };
  wft();
}

async function fetchWeather(date) {
  if (!navigator.geolocation) throw new Error('locația nu este disponibilă');
  const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000, maximumAge: 600000 }));
  const { latitude: la, longitude: lo } = pos.coords;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}&longitude=${lo.toFixed(3)}&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`);
  const j = await r.json();
  if (!j.daily) throw new Error(j.reason || 'date indisponibile pentru această zi');
  const code = j.daily.weather_code[0]; const wind = j.daily.wind_speed_10m_max[0];
  const tMin = Math.round(j.daily.temperature_2m_min[0]); const tMax = Math.round(j.daily.temperature_2m_max[0]);
  let weather = code === 0 ? 'Însorit' : code <= 2 ? 'Parțial noros' : code === 3 ? 'Noros' : code <= 48 ? 'Ceață' : code <= 67 || (code >= 80 && code <= 82) ? 'Ploaie' : code <= 86 ? 'Ninsoare' : 'Furtună';
  if (wind >= 50 && weather !== 'Furtună') weather = 'Vânt puternic';
  if (tMax < 0 && weather === 'Însorit') weather = 'Ger';
  return { weather, tMin: String(tMin), tMax: String(tMax) };
}

// ---------------------------------------------------------------- PDF formular / jurnal
async function printField(pr, job) {
  app.innerHTML = `${bar({ back: job.back, title: job.type === 'form' ? 'Formular' : 'Jurnal de șantier', sub: pr.name, right: `<button class="btn small primary" data-act="print" disabled>${I.print} PDF</button>` })}
    <main class="content"><div class="doc" id="doc"><p>Se generează documentul…</p></div></main>`;
  const companies = await db.where('companies', pr.id);
  const comp = (id) => companies.find((c) => c.id === id);
  let html = '';
  if (job.type === 'form') {
    const f = await db.get('forms', job.formId);
    if (!f) return go(job.back);
    const c = formCounts(f);
    html += docHead(pr, f.name);
    html += `<p><b>Data:</b> ${fmtDate(f.date)}${f.location ? ` &nbsp; <b>Zonă:</b> ${esc(f.location)}` : ''}${comp(f.companyId) ? ` &nbsp; <b>Firmă:</b> ${esc(comp(f.companyId).name)}` : ''}${f.inspector ? ` &nbsp; <b>Verificat de:</b> ${esc(f.inspector)}` : ''}
      &nbsp; <b>Status:</b> ${f.status === 'done' ? 'Finalizat' : 'În lucru'}</p>`;
    html += `<table><tr>${Object.values(ANS).map((a) => `<th>${a.label}</th>`).join('')}<th>Necompletate</th></tr><tr>${Object.keys(ANS).map((k) => `<td>${c[k]}</td>`).join('')}<td>${c.todo}</td></tr></table>`;
    html += '<table style="margin-top:12px"><tr><th>Nr.</th><th>Element verificat</th><th>Rezultat</th><th>Observații</th></tr>';
    let n = 0;
    for (const it of f.items) {
      if (it.kind === 'section') { html += `<tr class="sec"><td colspan="4"><b>${esc(it.label)}</b></td></tr>`; continue; }
      n++;
      const a = f.answers[it.id] || {};
      const photos = await Promise.all((a.photos || []).map(blobURL));
      const res = it.kind === 'text' ? '' : a.v ? `<span class="badge" style="--c:${ANS[a.v].color}">${ANS[a.v].label}</span>` : '—';
      html += `<tr><td>${n}</td><td>${esc(it.label)}</td><td>${res}</td><td><div class="pre">${esc(it.kind === 'text' ? a.text : a.note)}</div>
        ${photos.length ? `<div class="ph">${photos.map((u) => `<img src="${u}" alt="">`).join('')}</div>` : ''}</td></tr>`;
    }
    html += '</table>';
    const sig = f.signatureId ? await blobURL(f.signatureId) : '';
    html += `<div class="sign"><div>${sig ? `<img src="${sig}" alt="" style="max-height:70px;display:block">` : '<br><br>'}${esc(f.signer || 'Semnătura')}</div></div>`;
  } else {
    const days = (await db.where('diary', pr.id)).filter((d) => d.date >= job.from && d.date <= job.to).sort((a, b) => a.date.localeCompare(b.date));
    html += docHead(pr, job.from === job.to ? `Jurnal de șantier – ${fmtDate(job.from)}` : `Jurnal de șantier ${fmtDate(job.from)} – ${fmtDate(job.to)}`);
    if (!days.length) html += '<p>Nicio zi înregistrată în această perioadă.</p>';
    for (const d of days) {
      const photos = await Promise.all((d.photos || []).map(blobURL));
      const wf = Object.entries(d.workforce || {}).filter(([, v]) => num(v) > 0).map(([k, v]) => [k === 'own' ? 'Echipa proprie' : (comp(k) || {}).name || '—', num(v)]);
      html += `<div class="section"><h2>${fmtDate(d.date)} – ${esc(d.weather || 'vreme nespecificată')}${d.tMax !== '' && d.tMax != null ? `, ${esc(d.tMin)}…${esc(d.tMax)}°C` : ''}</h2>
        ${wf.length ? `<table><tr>${wf.map(([n]) => `<th>${esc(n)}</th>`).join('')}<th>Total</th></tr><tr>${wf.map(([, v]) => `<td>${v}</td>`).join('')}<td><b>${wfTotal(d)}</b></td></tr></table>` : ''}
        ${[['Lucrări executate', d.works], ['Livrări / utilaje', d.deliveries], ['Vizitatori / dispoziții', d.visitors], ['Incidente / probleme', d.incidents]].filter(([, v]) => v).map(([l, v]) => `<p><b>${l}:</b></p><div class="pre">${esc(v)}</div>`).join('')}
        ${photos.length ? `<div class="pt" style="border:0;padding:0"><div class="ph">${photos.map((u) => `<img src="${u}" alt="">`).join('')}</div></div>` : ''}</div>`;
    }
    html += `<div class="sign"><div>${esc(pr.manager || 'Responsabil')}<br>Semnătura</div></div>`;
  }
  $('#doc').innerHTML = html;
  const btn = $('[data-act=print]');
  btn.disabled = false;
  btn.onclick = () => window.print();
}

// ---------------------------------------------------------------- Desen pe plan (adnotări)
const mkWidth = (plan) => Math.max(plan.w, plan.h) / 320;
function mkPath(m, plan) {
  const P = ([x, y]) => [x * plan.w, y * plan.h];
  const sw = mkWidth(plan);
  if (m.type === 'pen') return m.pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).map((v) => v.toFixed(1)).join(' ')}`).join('');
  const [a, b] = [P(m.pts[0]), P(m.pts[1])];
  if (m.type === 'arrow') {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); const h = sw * 7;
    const l = [b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45)]; const r = [b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45)];
    return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${l[0]} ${l[1]}L${b[0]} ${b[1]}L${r[0]} ${r[1]}`;
  }
  const x1 = Math.min(a[0], b[0]); const x2 = Math.max(a[0], b[0]); const y1 = Math.min(a[1], b[1]); const y2 = Math.max(a[1], b[1]);
  if (m.type === 'rect') return `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
  // nor de revizie: arce de-a lungul conturului, în sensul acelor de ceasornic
  const target = Math.min(Math.max(sw * 5, Math.min(x2 - x1, y2 - y1) / 5), Math.max(plan.w, plan.h) / 35);
  const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
  let d = `M${x1} ${y1}`;
  for (let i = 0; i < 4; i++) {
    const [p, q] = [corners[i], corners[i + 1]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]); const k = Math.max(1, Math.round(len / (target * 2)));
    const r = len / k / 2;
    for (let j = 1; j <= k; j++) d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(p[0] + (q[0] - p[0]) * j / k).toFixed(1)} ${(p[1] + (q[1] - p[1]) * j / k).toFixed(1)}`;
  }
  return d;
}
const mkFont = (plan) => Math.max(plan.w, plan.h) / 28;
function mkSVG(m, plan) {
  if (m.type === 'text') {
    const fs = mkFont(plan);
    return `<text data-mk="${m.id}" x="${m.pts[0][0] * plan.w}" y="${m.pts[0][1] * plan.h}" font-size="${fs}" fill="${m.color}" stroke="#fff" stroke-width="${fs / 6}" paint-order="stroke" font-weight="700" font-family="-apple-system, Helvetica, Arial, sans-serif">${esc(m.text)}</text>`;
  }
  return `<path data-mk="${m.id}" d="${mkPath(m, plan)}" fill="none" stroke="${m.color}" stroke-width="${mkWidth(plan)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// Desenează adnotările pe un canvas al cărui sistem de coordonate este cel al planului (pixeli)
function drawMarkups(ctx, plan) {
  for (const m of plan.markups || []) {
    ctx.save();
    if (m.type === 'text') {
      const fs = mkFont(plan);
      ctx.font = `bold ${fs}px -apple-system, Helvetica, Arial, sans-serif`;
      ctx.lineWidth = fs / 6; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
      ctx.strokeText(m.text, m.pts[0][0] * plan.w, m.pts[0][1] * plan.h);
      ctx.fillStyle = m.color; ctx.fillText(m.text, m.pts[0][0] * plan.w, m.pts[0][1] * plan.h);
    } else {
      ctx.strokeStyle = m.color; ctx.lineWidth = mkWidth(plan); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(mkPath(m, plan)));
    }
    ctx.restore();
  }
}
function mkDistance(m, plan, x, y) {
  const P = ([px, py]) => [px * plan.w, py * plan.h];
  const segDist = (a, b) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
  };
  let pts = m.pts.map(P);
  if (m.type === 'text') { const fs = mkFont(plan); const w = m.text.length * fs * 0.55; const [tx, ty] = pts[0]; return x >= tx && x <= tx + w && y >= ty - fs && y <= ty + fs * 0.3 ? 0 : segDist([tx, ty - fs / 2], [tx + w, ty - fs / 2]); }
  if (m.type === 'rect' || m.type === 'cloud') { const [a, b] = pts; pts = [a, [b[0], a[1]], b, [a[0], b[1]], a]; }
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(pts[i - 1], pts[i]));
  return pts.length === 1 ? Math.hypot(x - pts[0][0], y - pts[0][1]) : best;
}

// Conectat din viewPlan(): stratul SVG cu adnotări și modul de desen
function initMarkup({ plan, vp, inner, svg, button }) {
  plan.markups = plan.markups || [];
  const st = state.mk || (state.mk = { tool: 'pen', color: MK_COLORS[0], show: true });
  const redraw = (preview) => { svg.innerHTML = (st.show ? plan.markups.map((m) => mkSVG(m, plan)).join('') : '') + (preview ? mkSVG(preview, plan) : ''); };
  const persist = () => db.put('plans', plan);
  const added = [];
  let layer = null; let barEl = null;
  const norm2 = (e) => { const r = inner.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };

  function open() {
    st.show = true; redraw();
    const fab = $('#addbtn'); if (fab) fab.hidden = true;
    layer = document.createElement('div');
    layer.className = 'draw-layer';
    vp.appendChild(layer);
    barEl = document.createElement('div');
    barEl.className = 'draw-bar';
    const drawBar = () => {
      barEl.innerHTML = `<div class="db-row">${MK_TOOLS.map(([k, l]) => `<button class="chip ${st.tool === k ? 'on' : ''}" data-tool="${k}">${l}</button>`).join('')}</div>
        <div class="db-row">${MK_COLORS.map((c) => `<button class="swatch ${st.color === c ? 'on' : ''}" data-col="${c}" style="--c:${c}" aria-label="Culoare"></button>`).join('')}
          <span style="flex:1"></span><button class="btn small" data-undo>↶ Anulează</button><button class="btn small" data-clear>Șterge tot</button><button class="btn small primary" data-donew>Gata</button></div>`;
      $$('[data-tool]', barEl).forEach((b) => { b.onclick = () => { st.tool = b.dataset.tool; drawBar(); }; });
      $$('[data-col]', barEl).forEach((b) => { b.onclick = () => { st.color = b.dataset.col; drawBar(); }; });
      $('[data-undo]', barEl).onclick = () => {
        const id = added.pop();
        if (!id) return toast('Nimic de anulat');
        plan.markups = plan.markups.filter((m) => m.id !== id); redraw(); persist();
      };
      $('[data-clear]', barEl).onclick = () => { if (plan.markups.length && confirm('Ștergi toate desenele de pe acest plan?')) { plan.markups = []; added.length = 0; redraw(); persist(); } };
      $('[data-donew]', barEl).onclick = close;
    };
    drawBar();
    vp.parentNode.appendChild(barEl);
    let cur = null;
    // atingerile din modul desen nu ajung la vizualizator (nu mută / nu măresc planul)
    ['pointermove', 'pointerup', 'pointercancel', 'touchend', 'dblclick'].forEach((t) => layer.addEventListener(t, (e) => e.stopPropagation()));
    layer.onpointerdown = (e) => {
      e.stopPropagation();
      layer.setPointerCapture(e.pointerId);
      const p = norm2(e);
      if (st.tool === 'text') {
        const t = prompt('Text pe plan:');
        if (t && t.trim()) { const m = { id: uid(), type: 'text', color: st.color, pts: [p], text: t.trim() }; plan.markups.push(m); added.push(m.id); redraw(); persist(); }
        return;
      }
      if (st.tool === 'erase') {
        const r = inner.getBoundingClientRect();
        const px = p[0] * plan.w; const py = p[1] * plan.h; const tol = 26 * plan.w / r.width;
        let best = null; let bd = Infinity;
        for (const m of plan.markups) { const d = mkDistance(m, plan, px, py); if (d < bd) { bd = d; best = m; } }
        if (best && bd <= tol) { plan.markups = plan.markups.filter((m) => m !== best); redraw(); persist(); } else toast('Atinge exact un desen pentru a-l șterge', 1500);
        return;
      }
      cur = { id: uid(), type: st.tool, color: st.color, pts: st.tool === 'pen' ? [p] : [p, p] };
    };
    layer.onpointermove = (e) => {
      if (!cur) return;
      const p = norm2(e);
      if (cur.type === 'pen') cur.pts.push(p); else cur.pts[1] = p;
      redraw(cur);
    };
    layer.onpointerup = layer.onpointercancel = () => {
      if (!cur) return;
      const m = cur; cur = null;
      const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
      const r = inner.getBoundingClientRect();
      const moved = Math.hypot((b[0] - a[0]) * r.width, (b[1] - a[1]) * r.height);
      if (m.type === 'pen' ? m.pts.length > 1 : moved > 8) {
        if (m.type === 'pen') m.pts = m.pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
        plan.markups.push(m); added.push(m.id); persist();
      }
      redraw();
    };
  }
  function close() {
    if (layer) layer.remove();
    if (barEl) barEl.remove();
    layer = barEl = null;
    const fab = $('#addbtn'); if (fab) fab.hidden = false;
  }
  button.onclick = () => (layer ? close() : open());
  redraw();
  return { toggleShow() { st.show = !st.show; redraw(); return st.show; }, close };
}

// ---------------------------------------------------------------- Versiuni de plan
async function fileToImage(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    toast('Se încarcă PDF-ul…', 30000);
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let page = 1;
    if (doc.numPages > 1) {
      page = Math.round(num(prompt(`PDF-ul are ${doc.numPages} pagini. Ce pagină folosești pentru această versiune?`, '1')));
      if (!page || page < 1 || page > doc.numPages) throw new Error('pagină invalidă');
    }
    return pdfPageImage(doc, page);
  }
  const r = await resizeImage(await blobToImg(file), 4096, 'image/jpeg', 0.9);
  return { blob: r.blob, w: r.w, h: r.h };
}

async function newPlanVersion(plan) {
  const [file] = await pickFile('image/*,application/pdf,.pdf');
  if (!file) return;
  try {
    const img = await fileToImage(file);
    const note = prompt('Descrierea modificării (opțional):', file.name.replace(/\.[^.]+$/, '')) || '';
    const keep = (plan.markups || []).length ? confirm('Păstrezi desenele de pe versiunea anterioară și pe cea nouă?\n\nOK = da\nAnulează = noua versiune pornește fără desene') : false;
    const th = await resizeImage(await blobToImg(img.blob), 480, 'image/jpeg', 0.8);
    plan.versions = plan.versions || [];
    plan.versions.push({ id: uid(), version: plan.version || 1, blobId: plan.blobId, thumbId: plan.thumbId, w: plan.w, h: plan.h, date: plan.versionDate || plan.created, note: plan.versionNote || '', markups: plan.markups || [] });
    Object.assign(plan, { blobId: await saveBlob(img.blob), thumbId: await saveBlob(th.blob), w: img.w, h: img.h, version: (plan.version || 1) + 1, versionDate: Date.now(), versionNote: note, markups: keep ? structuredClone(plan.markups || []) : [] });
    await db.put('plans', plan);
    planImgCache.delete(plan.id);
    toast(`Versiunea ${plan.version} a fost încărcată. Punctele au rămas pe poziții – verifică-le.`, 4000);
    render();
  } catch (e) { toast('Import eșuat: ' + e.message, 4000); render(); }
}

async function planHistory(plan) {
  const vs = [...(plan.versions || [])].reverse();
  const thumbs = await Promise.all([plan.thumbId, ...vs.map((v) => v.thumbId)].map(blobURL));
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Versiuni – ${esc(plan.name)}</h2><button class="link" data-close>Gata</button></div>
    <div class="sheet-body"><div class="list">
      <div class="row" style="cursor:default"><img class="thumb" src="${thumbs[0]}" alt=""><span class="main"><div class="t">v${plan.version || 1} · curentă</div><div class="s">${fmtTime(plan.versionDate || plan.created)}${plan.versionNote ? ' · ' + esc(plan.versionNote) : ''}</div></span></div>
      ${vs.map((v, i) => `<button class="row" data-v="${v.id}"><img class="thumb" src="${thumbs[i + 1]}" alt=""><span class="main"><div class="t">v${v.version}</div><div class="s">${fmtTime(v.date)}${v.note ? ' · ' + esc(v.note) : ''}</div></span></button>`).join('')}
    </div>${vs.length ? '' : '<p class="muted">Nu există versiuni anterioare. Încarcă o versiune nouă din meniul planului.</p>'}</div>`);
  $$('[data-v]', s.el).forEach((b) => {
    b.onclick = () => {
      const v = plan.versions.find((x) => x.id === b.dataset.v);
      actionSheet(`Versiunea v${v.version}`, [
        { label: 'Vezi planul', run: async () => {
          const ov = document.createElement('div');
          ov.className = 'photo-view';
          ov.innerHTML = `<div class="ptools"><button class="btn" data-x>Închide</button><span style="color:#fff;align-self:center">v${v.version} – ${fmtTime(v.date)}</span></div><div class="stage"><img src="${await blobURL(v.blobId)}" alt=""></div>`;
          document.body.appendChild(ov);
          $('[data-x]', ov).onclick = () => ov.remove();
        } },
        { label: 'Fă-o versiunea curentă', run: async () => {
          const curV = { id: uid(), version: plan.version || 1, blobId: plan.blobId, thumbId: plan.thumbId, w: plan.w, h: plan.h, date: plan.versionDate || plan.created, note: plan.versionNote || '', markups: plan.markups || [] };
          plan.versions = plan.versions.filter((x) => x !== v).concat(curV);
          Object.assign(plan, { blobId: v.blobId, thumbId: v.thumbId, w: v.w, h: v.h, version: v.version, versionDate: v.date, versionNote: v.note, markups: v.markups || [] });
          await db.put('plans', plan); planImgCache.delete(plan.id);
          toast(`v${v.version} este acum versiunea curentă`); render();
        } },
        { label: 'Șterge această versiune', danger: true, run: async () => {
          if (!confirm(`Ștergi definitiv versiunea v${v.version}?`)) return;
          await delBlob(v.blobId); await delBlob(v.thumbId);
          plan.versions = plan.versions.filter((x) => x !== v);
          await db.put('plans', plan); render();
        } },
      ]);
    };
  });
}

// ---------------------------------------------------------------- Trimitere către firme
function pointsText(pts, plans) {
  return pts.map((p) => {
    const pl = plans.find((x) => x.id === p.planId);
    return `#${p.number} – ${p.title}\n   ${[STATUS[p.status].label, pl && 'Plan: ' + pl.name, p.due && 'Termen: ' + fmtDate(p.due)].filter(Boolean).join(' · ')}${p.desc ? `\n   ${p.desc.replace(/\n/g, '\n   ')}` : ''}`;
  }).join('\n\n');
}
async function sendToCompany(pr, c, via) {
  const [points, plans] = await Promise.all([db.where('points', pr.id), db.where('plans', pr.id)]);
  const pts = points.filter((p) => p.companyId === c.id && isActive(p)).sort((a, b) => a.number - b.number);
  if (!pts.length) return toast(`${c.name} nu are puncte deschise`);
  const subject = `${pr.name} – ${pts.length} puncte de remediat (${c.name})`;
  const text = `Bună ziua${c.contact ? ', ' + c.contact : ''},\n\nVă transmitem punctele deschise care vă revin pe șantierul „${pr.name}”${pr.address ? ' (' + pr.address + ')' : ''}:\n\n${pointsText(pts, plans)}\n\nVă rugăm să ne confirmați termenele de remediere.\n\nCu stimă,\n${pr.manager || settings.name || ''}`;
  if (via === 'mail') {
    if (!c.email) toast('Firma nu are email – completează-l la Firme', 3000);
    location.href = `mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  } else await shareText(subject, text);
}
async function shareText(title, text, files = []) {
  if (navigator.share) {
    const data = { title, text };
    if (files.length && navigator.canShare && navigator.canShare({ files })) data.files = files;
    try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Text copiat – lipește-l în aplicația dorită'); } catch (e) { alert(text); }
}
async function sharePoint(d, companies, plans) {
  const c = companies.find((x) => x.id === d.companyId);
  const pr = await db.get('projects', d.projectId);
  const files = [];
  for (const [i, id] of (d.photos || []).entries()) { const b = await getBlob(id); if (b) files.push(new File([b], `punct-${d.number || 'nou'}-${i + 1}.jpg`, { type: 'image/jpeg' })); }
  const text = `${pr ? pr.name + '\n' : ''}${pointsText([{ ...d, number: d.number || '' }], plans)}${c ? `\nFirmă responsabilă: ${c.name}` : ''}`;
  await shareText(`Punctul #${d.number || ''} – ${d.title}`, text, files);
}
function companyActions(pr, c, edit) {
  actionSheet(c.name, [
    { label: 'Trimite punctele deschise pe email', run: () => sendToCompany(pr, c, 'mail') },
    { label: 'Trimite pe WhatsApp / altă aplicație', run: () => sendToCompany(pr, c, 'share') },
    { label: 'Raport PDF cu punctele firmei', run: () => {
      printJob = { type: 'report', back: `#/p/${pr.id}/companies`, opts: { title: `Puncte de remediat – ${c.name}`, statuses: ['open', 'progress'], company: c.id, plan: '', plans: true, crop: true, photos: true, hist: false, overdue: false } };
      go(`#/p/${pr.id}/print`);
    } },
    { label: 'Editează firma', run: () => edit(c) },
  ]);
}

// ---------------------------------------------------------------- Pachet de proiect (lucru în echipă fără server)
const PKG_FIELD = ['plans', 'points', 'companies', 'meetings', 'forms', 'diary', 'tasks'];
const PKG_MONEY = ['quotes', 'invoices', 'costs'];
async function exportProjectPackage(pr) {
  const money = confirm('Trimiți proiectul unui coleg.\n\nIncluzi și devizele, facturile și costurile?\n\nOK = da\nAnulează = doar datele de teren (planuri, puncte, formulare, jurnal, ședințe, planning)');
  toast('Se pregătește pachetul…', 20000);
  const data = { projects: [pr] };
  for (const s of [...PKG_FIELD, ...(money ? PKG_MONEY : [])]) data[s] = await db.where(s, pr.id);
  if (pr.clientId) { const c = await db.get('clients', pr.clientId); if (c) data.clients = [c]; }
  const json = JSON.stringify(data);
  const keys = await tx('blobs', 'readonly', (st) => st.getAllKeys());
  const blobs = [];
  for (const k of keys) {
    if (!json.includes(`"${k}"`)) continue;
    const b = await db.get('blobs', k);
    if (b) blobs.push({ id: k, data: await blobToDataURL(b.blob) });
  }
  const out = JSON.stringify({ app: 'santier-proiect', version: 1, exported: new Date().toISOString(), from: settings.name || '', data, blobs });
  toast('Pachet gata');
  await shareOrDownload(new Blob([out], { type: 'application/json' }), `${pr.name.replace(/[^\w\- ]+/g, '').trim() || 'proiect'}-${today()}.santier.json`);
}

async function importProjectPackage() {
  const [file] = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (obj.app !== 'santier-proiect' || !obj.data) throw new Error('Fișierul nu este un pachet de proiect Șantier');
    toast('Se unesc datele…', 30000);
    const ts = (o) => o.updated || o.created || 0;
    let added = 0; let updated = 0;
    db.raw = true;
    try {
      for (const b of obj.blobs || []) if (!(await db.get('blobs', b.id))) await db.put('blobs', { id: b.id, blob: await dataURLToBlob(b.data) });
      for (const s of Object.keys(obj.data)) {
        if (!STORES.includes(s) || s === 'blobs' || s === 'meta') continue;
        for (const o of obj.data[s]) {
          const ex = await db.get(s, o.id);
          if (ex && ts(ex) >= ts(o)) continue;
          if (s === 'points' && !ex) {
            // același număr creat în paralel de doi colegi → primește următorul număr liber
            const same = (await db.where('points', o.projectId)).filter((p) => p.number === o.number);
            if (same.length) {
              const max = (await db.where('points', o.projectId)).reduce((m, p) => Math.max(m, p.number || 0), 0);
              (o.history = o.history || []).push({ t: Date.now(), kind: 'sys', text: `Renumerotat din #${o.number} în #${max + 1} la import` });
              o.number = max + 1;
            }
          }
          await db.put(s, o);
          if (ex) updated++; else added++;
        }
      }
    } finally { db.raw = false; }
    planImgCache.clear();
    toast(`Pachet importat: ${added} elemente noi, ${updated} actualizate`, 4000);
    const pid = obj.data.projects && obj.data.projects[0] && obj.data.projects[0].id;
    go(pid ? `#/p/${pid}/plans` : '#/');
  } catch (e) { db.raw = false; toast('Import eșuat: ' + e.message, 4000); }
}
