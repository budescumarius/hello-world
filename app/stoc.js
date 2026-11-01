'use strict';
/* Stoc personal – evidența materialelor date din stocul propriu (cui, când – data și ora –, pe ce șantier, cu poze)
   și a retururilor. Se bazează pe utilitarele din app.js și gestiune.js. */

const MOVES = {
  out:    { label: 'Dat',     verb: 'Dau material',     color: '#e8590c', sign: -1 },
  return: { label: 'Retur',   verb: 'Primesc retur',    color: '#2f9e44', sign: 1 },
  in:     { label: 'Intrare', verb: 'Intrare în stoc',  color: '#1f4fd8', sign: 1 },
};
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fmtAt = (s) => (s ? `${fmtDate(s.slice(0, 10))}${s.length > 10 ? ' ' + s.slice(11, 16) : ''}` : '');
const qtyTxt = (q, unit) => `${fnum(num(q), 3)} ${unit || ''}`.trim();

// Calculează pentru fiecare material: stoc, dat, returnat și ce mai are de returnat fiecare persoană
function stockCalc(items, moves) {
  const by = {};
  for (const it of items) by[it.id] = { item: it, inQty: num(it.initial), out: 0, ret: 0, pending: {}, tracked: num(it.initial) > 0 };
  for (const m of moves) {
    const s = by[m.itemId];
    if (!s) continue;
    const q = num(m.qty);
    const who = (m.to || '').trim() || '—';
    if (m.type === 'in') { s.inQty += q; s.tracked = true; }
    if (m.type === 'out') { s.out += q; if (m.expectReturn) s.pending[who] = (s.pending[who] || 0) + q; }
    if (m.type === 'return') { s.ret += q; s.pending[who] = (s.pending[who] || 0) - q; }
  }
  for (const s of Object.values(by)) {
    s.stock = s.inQty - s.out + s.ret;
    for (const k of Object.keys(s.pending)) if (s.pending[k] <= 1e-9) delete s.pending[k];
    s.pendingQty = Object.values(s.pending).reduce((a, x) => a + x, 0);
  }
  return by;
}

async function stockData() {
  const [items, moves, projects] = await Promise.all([db.all('stock'), db.all('stockMoves'), db.all('projects')]);
  items.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  moves.sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.created - a.created);
  return { items, moves, projects, calc: stockCalc(items, moves) };
}

function moveRows(list, d, thumbs) {
  return list.map((m, i) => {
    const it = d.items.find((x) => x.id === m.itemId) || {};
    const pr = d.projects.find((p) => p.id === m.projectId);
    const t = MOVES[m.type];
    return `<button class="row" data-mv="${m.id}"><span class="dot" style="--c:${t.color}"></span>
      <span class="main"><div class="t">${esc(it.name || '(material șters)')}</div>
      <div class="s">${esc([fmtAt(m.at), t.label, m.to, pr && pr.name, m.expectReturn && m.type === 'out' ? 'de returnat' : '', m.note].filter(Boolean).join(' · '))}</div></span>
      ${thumbs[i] ? `<img class="thumb" src="${thumbs[i]}" alt="">` : ''}
      <span class="amt" style="color:${t.color}">${t.sign < 0 ? '−' : '+'}${esc(qtyTxt(m.qty, it.unit))}</span></button>`;
  }).join('');
}
const moveThumbs = (list) => Promise.all(list.map((m) => ((m.photos || [])[0] ? blobURL(m.photos[0]) : '')));

function bindMoves(el, d, onDone) {
  $$('[data-mv]', el).forEach((b) => { b.onclick = () => editMove(d.moves.find((m) => m.id === b.dataset.mv), {}, onDone); });
}

// ---------------------------------------------------------------- Tab global „Stoc”
async function gStock(el) {
  const d = await stockData();
  const f = state.sf || (state.sf = { view: 'items', q: '', type: '' });
  const pending = [];
  for (const s of Object.values(d.calc)) for (const [who, q] of Object.entries(s.pending)) pending.push({ who, q, s });
  const people = [...new Set(pending.map((p) => p.who))].sort((a, b) => a.localeCompare(b, 'ro'));
  const value = (k) => d.items.reduce((a, it) => a + num(it.price) * d.calc[it.id][k], 0);
  const anyPrice = d.items.some((it) => num(it.price) > 0);

  el.innerHTML = `<div class="kpis">
      <div class="kpi"><small>Materiale</small><b>${d.items.length}</b></div>
      <div class="kpi"><small>Mișcări înregistrate</small><b>${d.moves.length}</b></div>
      <div class="kpi ${pending.length ? 'bad' : ''}"><small>De primit înapoi</small><b>${pending.length} poziții · ${people.length} pers.</b></div>
      ${anyPrice ? `<div class="kpi"><small>Valoare dată (net de retur)</small><b>${money(value('out') - value('ret'))}</b></div>` : ''}
    </div>
    <div class="summary">${[['items', 'Materiale'], ['moves', 'Istoric'], ['pending', `De returnat (${pending.length})`]].map(([k, l]) => `<button class="chip ${f.view === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="toolbar"><input type="search" placeholder="Caută material, persoană, șantier…" value="${esc(f.q)}" data-q>
      ${f.view === 'moves' ? `<select data-type><option value="">Toate</option>${Object.entries(MOVES).map(([k, t]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>` : ''}
      <button class="btn" data-act="menu">${I.more}</button></div>
    <div id="sl"></div>
    <button class="fab" data-act="give">${I.minus}<span>Dau material</span></button>`;

  const draw = async () => {
    const q = norm(f.q);
    const box = $('#sl', el);
    if (f.view === 'items') {
      const list = d.items.filter((it) => !q || norm([it.name, it.category].join(' ')).includes(q));
      box.innerHTML = list.length ? `<div class="list">${list.map((it) => {
        const s = d.calc[it.id];
        return `<button class="row" data-it="${it.id}"><span class="main"><div class="t tw">${esc(it.name)}</div>
          <div class="s">${esc([it.category, `dat ${qtyTxt(s.out, it.unit)}`, s.ret ? `retur ${qtyTxt(s.ret, it.unit)}` : '', s.pendingQty ? `de primit ${qtyTxt(s.pendingQty, it.unit)}` : ''].filter(Boolean).join(' · '))}</div></span>
          ${s.tracked ? `<span class="amt ${s.stock < 0 ? 'overdue' : ''}">${esc(qtyTxt(s.stock, it.unit))}<br><small class="muted">în stoc</small></span>` : ''}</button>`;
      }).join('')}</div>` : empty(d.items.length ? 'Nimic găsit' : 'Niciun material încă', 'Apasă „Dau material” și scrie denumirea – materialul se creează automat. Data și ora se completează singure; poți adăuga și poze.');
      $$('[data-it]', box).forEach((b) => { b.onclick = () => itemSheet(b.dataset.it); });
    } else if (f.view === 'moves') {
      const list = d.moves.filter((m) => (!f.type || m.type === f.type) && (!q || norm([(d.items.find((x) => x.id === m.itemId) || {}).name, m.to, m.note, (d.projects.find((p) => p.id === m.projectId) || {}).name].join(' ')).includes(q)));
      box.innerHTML = list.length ? `<div class="list">${moveRows(list, d, await moveThumbs(list))}</div>` : empty('Nicio mișcare', 'Aici apare tot ce ai dat, primit înapoi sau adăugat în stoc, cu data și ora.');
      bindMoves(box, d, render);
    } else {
      const ppl = people.filter((p) => !q || norm(p).includes(q) || pending.some((x) => x.who === p && norm(x.s.item.name).includes(q)));
      box.innerHTML = ppl.length ? ppl.map((who) => `<div class="section-title">${esc(who)}</div><div class="list">${pending.filter((x) => x.who === who).map((x) => {
        const last = d.moves.find((m) => m.itemId === x.s.item.id && m.type === 'out' && (m.to || '').trim() === who);
        return `<button class="row" data-ret="${x.s.item.id}" data-who="${esc(who)}"><span class="dot" style="--c:${MOVES.out.color}"></span><span class="main"><div class="t tw">${esc(x.s.item.name)}</div>
          <div class="s">${last ? `ultima dată dat: ${esc(fmtAt(last.at))}` : ''} · atinge pentru retur</div></span>
          <span class="amt">${esc(qtyTxt(x.q, x.s.item.unit))}</span></button>`;
      }).join('')}</div>`).join('') : empty('Nimic de primit înapoi', 'Când dai un material, alege „Retur așteptat: Da” ca să apară aici până îl primești înapoi.');
      $$('[data-ret]', box).forEach((b) => {
        b.onclick = () => {
          const x = pending.find((p) => p.s.item.id === b.dataset.ret && p.who === b.dataset.who);
          editMove(null, { type: 'return', itemId: x.s.item.id, to: x.who, qty: x.q }, render);
        };
      });
    }
  };
  $$('[data-v]', el).forEach((b) => { b.onclick = () => { f.view = b.dataset.v; render(); }; });
  $('[data-q]', el).oninput = (e) => { f.q = e.target.value; draw(); };
  const ty = $('[data-type]', el); if (ty) ty.onchange = () => { f.type = ty.value; draw(); };
  $('[data-act=give]', el).onclick = () => editMove(null, { type: 'out' }, render);
  $('[data-act=menu]', el).onclick = () => actionSheet('Stoc personal', [
    { label: 'Dau material', run: () => editMove(null, { type: 'out' }, render) },
    { label: 'Primesc retur', run: () => editMove(null, { type: 'return' }, render) },
    { label: 'Intrare în stoc (am cumpărat / adus)', run: () => editMove(null, { type: 'in' }, render) },
    { label: 'Material nou', run: () => editItem(null, render) },
    { label: 'Exportă istoricul (CSV / Excel)', run: () => exportStock(d) },
  ]);
  draw();
}

// ---------------------------------------------------------------- Tab în proiect: ce am dat pe acest șantier
async function tabStock(pr, el) {
  const d = await stockData();
  const list = d.moves.filter((m) => m.projectId === pr.id);
  const per = {};
  for (const m of list) {
    const p = per[m.itemId] || (per[m.itemId] = { out: 0, ret: 0 });
    if (m.type === 'out') p.out += num(m.qty);
    if (m.type === 'return') p.ret += num(m.qty);
  }
  const rows = Object.entries(per).map(([id, p]) => ({ it: d.items.find((x) => x.id === id), ...p })).filter((r) => r.it);
  el.innerHTML = `${rows.length ? `<div class="section-title">Total pe șantier</div><div class="list">${rows.map((r) => `<div class="row" style="cursor:default"><span class="main"><div class="t tw">${esc(r.it.name)}</div>
      <div class="s">dat ${esc(qtyTxt(r.out, r.it.unit))}${r.ret ? ` · retur ${esc(qtyTxt(r.ret, r.it.unit))}` : ''}</div></span>
      <span class="amt">${esc(qtyTxt(r.out - r.ret, r.it.unit))}${num(r.it.price) ? `<br><small class="muted">${money((r.out - r.ret) * num(r.it.price))}</small>` : ''}</span></div>`).join('')}</div>` : ''}
    <div class="section-title">Istoric</div><div id="sl"></div>
    <button class="fab" data-act="give">${I.minus}<span>Dau material</span></button>`;
  $('#sl', el).innerHTML = list.length ? `<div class="list">${moveRows(list, d, await moveThumbs(list))}</div>` : empty('Nimic dat pe acest șantier', 'Materialele date din stocul personal pentru acest proiect apar aici, cu data, ora și poze.');
  bindMoves(el, d, render);
  $('[data-act=give]', el).onclick = () => editMove(null, { type: 'out', projectId: pr.id }, render);
}

// ---------------------------------------------------------------- Fișa unui material
async function itemSheet(id) {
  const d = await stockData();
  const it = d.items.find((x) => x.id === id);
  if (!it) return;
  const s = d.calc[id];
  const list = d.moves.filter((m) => m.itemId === id);
  const sh = sheet(`<div class="sheet-head"><button class="link" data-close>Închide</button><h2>${esc(it.name)}</h2><button class="link strong" data-edit>Editează</button></div>
    <div class="sheet-body">
      <div class="kpis">
        ${s.tracked ? `<div class="kpi ${s.stock < 0 ? 'bad' : ''}"><small>În stoc</small><b>${esc(qtyTxt(s.stock, it.unit))}</b></div>` : ''}
        <div class="kpi"><small>Dat total</small><b>${esc(qtyTxt(s.out, it.unit))}</b></div>
        <div class="kpi"><small>Returnat</small><b>${esc(qtyTxt(s.ret, it.unit))}</b></div>
        <div class="kpi ${s.pendingQty ? 'bad' : ''}"><small>De primit înapoi</small><b>${esc(qtyTxt(s.pendingQty, it.unit))}</b></div>
      </div>
      ${Object.keys(s.pending).length ? `<div class="section-title">La cine este</div><div class="list">${Object.entries(s.pending).map(([who, q]) => `<button class="row" data-ret="${esc(who)}"><span class="main"><div class="t">${esc(who)}</div><div class="s">atinge pentru retur</div></span><span class="amt">${esc(qtyTxt(q, it.unit))}</span></button>`).join('')}</div>` : ''}
      <div class="btns" style="margin-top:12px">${Object.entries(MOVES).map(([k, t]) => `<button class="btn" data-new="${k}">${t.verb}</button>`).join('')}</div>
      <div class="section-title">Istoric</div>
      <div id="ih">${list.length ? `<div class="list">${moveRows(list, d, await moveThumbs(list))}</div>` : '<div class="muted">Nicio mișcare.</div>'}</div>
    </div>`, { full: true });
  const again = async () => { await render(); itemSheet(id); };
  $('[data-edit]', sh.el).onclick = () => { sh.close(); editItem(it, again); };
  $$('[data-new]', sh.el).forEach((b) => { b.onclick = () => { sh.close(); editMove(null, { type: b.dataset.new, itemId: id }, again); }; });
  $$('[data-ret]', sh.el).forEach((b) => { b.onclick = () => { sh.close(); editMove(null, { type: 'return', itemId: id, to: b.dataset.ret, qty: s.pending[b.dataset.ret] }, again); }; });
  $$('[data-mv]', sh.el).forEach((b) => { b.onclick = () => { sh.close(); editMove(list.find((m) => m.id === b.dataset.mv), {}, again); }; });
}

function editItem(it, onDone) {
  formSheet({
    title: it ? 'Material' : 'Material nou',
    values: it || { unit: 'buc' },
    fields: [
      { name: 'name', label: 'Denumire', required: true, placeholder: 'ex. Ciment 40 kg, Prelungitor 25 m' },
      { name: 'unit', label: 'Unitate', list: 'units', half: true },
      { name: 'category', label: 'Categorie', placeholder: 'ex. Scule, Electrice', half: true },
      { name: 'initial', label: 'Stoc inițial (opțional)', mode: 'decimal', half: true },
      { name: 'price', label: `Preț unitar (${settings.currency}, opțional)`, mode: 'decimal', half: true },
      { name: 'note', label: 'Observații', type: 'textarea', rows: 2 },
    ],
    extra: `<datalist id="units">${UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>`,
    async onSave(v) {
      const o = Object.assign(it || { id: uid(), created: Date.now() }, v, { initial: v.initial === '' ? '' : num(v.initial), price: v.price === '' ? '' : num(v.price) });
      await db.put('stock', o);
      if (onDone) onDone(o);
    },
    onDelete: it ? async () => {
      const moves = (await db.all('stockMoves')).filter((m) => m.itemId === it.id);
      if (moves.length && !confirm(`Materialul are ${moves.length} mișcări în istoric. Se șterg și acestea (cu pozele lor). Continui?`)) return;
      for (const m of moves) { for (const p of m.photos || []) await delBlob(p); await db.del('stockMoves', m.id); }
      await db.del('stock', it.id);
      render();
    } : null,
  });
}

// ---------------------------------------------------------------- Mișcare: dat / retur / intrare
async function editMove(m, preset = {}, onDone) {
  const [items, projects, moves, companies] = await Promise.all([db.all('stock'), db.all('projects'), db.all('stockMoves'), db.all('companies')]);
  items.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  projects.sort((a, b) => b.created - a.created);
  const type = (m && m.type) || preset.type || 'out';
  const t = MOVES[type];
  const last = moves.filter((x) => x.type === 'out').sort((a, b) => b.created - a.created)[0];
  const item0 = items.find((x) => x.id === ((m && m.itemId) || preset.itemId));
  const v0 = m ? { ...m, material: item0 ? item0.name : '', unit: item0 ? item0.unit : '', expectReturn: m.expectReturn ? '1' : '' }
    : { at: nowLocal(), qty: preset.qty != null ? String(Math.round(num(preset.qty) * 1000) / 1000).replace('.', ',') : '', to: preset.to || '', material: item0 ? item0.name : '', unit: item0 ? item0.unit : 'buc',
      projectId: preset.projectId ?? (type === 'out' && last ? last.projectId || '' : ''), expectReturn: '' };
  if (!m && type === 'out' && item0) {
    const prevOut = moves.find((x) => x.itemId === item0.id && x.type === 'out');
    if (prevOut) v0.expectReturn = prevOut.expectReturn ? '1' : '';
  }
  let photos = [...((m && m.photos) || [])];
  const origPhotos = [...photos];
  const added = [];
  let saved = false;
  const people = [...new Set([...moves.map((x) => (x.to || '').trim()).filter(Boolean), ...companies.map((c) => c.name)])];
  const fields = [
    { name: 'material', label: 'Material', required: true, list: 'stitems', placeholder: 'scrie sau alege' },
    { name: 'qty', label: 'Cantitate', mode: 'decimal', required: true, half: true },
    { name: 'unit', label: 'Unitate', list: 'units', half: true },
    { name: 'at', label: 'Data și ora', type: 'datetime-local', required: true },
  ];
  if (type !== 'in') fields.push({ name: 'to', label: type === 'out' ? 'Cui am dat (persoană / firmă)' : 'De la cine am primit înapoi', list: 'people', required: type === 'return' });
  else fields.push({ name: 'to', label: 'Furnizor / de unde (opțional)', list: 'people' });
  fields.push({ name: 'projectId', label: 'Șantier / proiect', type: 'select', options: [['', '— fără proiect —'], ...projects.map((p) => [p.id, p.name])] });
  if (type === 'out') fields.push({ name: 'expectReturn', label: 'Retur așteptat?', type: 'select', options: [['', 'Nu (consumat / rămâne acolo)'], ['1', 'Da, trebuie să-l primesc înapoi']] });
  fields.push({ name: 'note', label: 'Notă', type: 'textarea', rows: 2 });

  const s = formSheet({
    title: m ? `${t.label} – editează` : t.verb,
    values: v0,
    fields,
    extra: `<datalist id="stitems">${items.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <datalist id="people">${people.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="units">${UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <div class="muted" id="stinfo" style="margin:-4px 2px 10px;font-size:13px"></div>
      <div class="field"><span>Poze (opțional)</span><div class="photos" id="mph"></div></div>`,
    onClose: () => { if (!saved) added.forEach(delBlob); },
    async onSave(v) {
      if (num(v.qty) <= 0) throw new Error('cantitatea trebuie să fie mai mare decât 0');
      let it = items.find((x) => norm(x.name) === norm(v.material));
      if (!it) { it = { id: uid(), created: Date.now(), name: v.material, unit: v.unit || 'buc', category: '', initial: '', price: '' }; await db.put('stock', it); }
      else if (v.unit && v.unit !== it.unit) { it.unit = v.unit; await db.put('stock', it); }
      const o = Object.assign(m || { id: uid(), type, created: Date.now() }, {
        itemId: it.id, qty: num(v.qty), at: v.at, to: v.to || '', projectId: v.projectId || '', note: v.note || '',
        expectReturn: type === 'out' && v.expectReturn === '1', photos, updated: Date.now(),
      });
      for (const p of origPhotos) if (!photos.includes(p)) await delBlob(p);
      saved = true;
      await db.put('stockMoves', o);
      toast(`${t.label}: ${qtyTxt(o.qty, it.unit)} ${it.name}`);
      if (onDone) onDone(o);
    },
    onDelete: m ? async () => { for (const p of m.photos || []) await delBlob(p); added.forEach(delBlob); saved = true; await db.del('stockMoves', m.id); if (onDone) onDone(); } : null,
  });
  const form = $('form', s.el);

  // Arată stocul / ce mai are de returnat persoana pentru materialul ales
  const calc = stockCalc(items, moves.filter((x) => !m || x.id !== m.id));
  const info = () => {
    const it = items.find((x) => norm(x.name) === norm(form.elements.material.value));
    const box = $('#stinfo', form);
    if (!it) { box.textContent = form.elements.material.value ? 'Material nou – va fi creat la salvare.' : ''; return; }
    const c = calc[it.id];
    const who = form.elements.to ? form.elements.to.value.trim() : '';
    box.textContent = [c.tracked ? `În stoc: ${qtyTxt(c.stock, it.unit)}` : '', c.pendingQty ? `De primit înapoi: ${qtyTxt(c.pendingQty, it.unit)}` : '',
      who && c.pending[who] ? `${who} are ${qtyTxt(c.pending[who], it.unit)}` : ''].filter(Boolean).join(' · ');
  };
  form.elements.material.addEventListener('input', () => {
    const it = items.find((x) => norm(x.name) === norm(form.elements.material.value));
    if (it && !m) form.elements.unit.value = it.unit || '';
    info();
  });
  if (form.elements.to) form.elements.to.addEventListener('input', info);
  info();

  const drawPh = async () => {
    const box = $('#mph', form);
    const urls = await Promise.all(photos.map(blobURL));
    box.innerHTML = urls.map((u, i) => `<img src="${u}" alt="Poză" data-ph="${i}">`).join('')
      + `<label class="add">${I.camera}<span>Poză</span><input type="file" accept="image/*" multiple></label>`;
    $$('[data-ph]', box).forEach((im) => {
      const i = +im.dataset.ph;
      im.onclick = () => photoViewer(photos[i], {
        onDelete() { photos.splice(i, 1); drawPh(); },
        onReplace(id) { added.push(id); photos[i] = id; drawPh(); },
      });
    });
    $('input', box).onchange = async (e) => {
      for (const file of e.target.files) {
        try {
          const r = await resizeImage(await blobToImg(file), 2000, 'image/jpeg', 0.85);
          const id = await saveBlob(r.blob); added.push(id); photos.push(id);
        } catch (err) { toast('Poza nu a putut fi citită'); }
      }
      drawPh();
    };
  };
  drawPh();
}

function exportStock(d) {
  const rows = [['Data', 'Ora', 'Tip', 'Material', 'Cantitate', 'Unitate', 'Persoană / firmă', 'Proiect', 'Retur așteptat', 'Notă', 'Poze']];
  for (const m of [...d.moves].reverse()) {
    const it = d.items.find((x) => x.id === m.itemId) || {};
    const pr = d.projects.find((p) => p.id === m.projectId);
    rows.push([fmtDate((m.at || '').slice(0, 10)), (m.at || '').slice(11, 16), MOVES[m.type].label, it.name || '', fnum(num(m.qty), 3), it.unit || '', m.to || '', pr ? pr.name : '',
      m.type === 'out' ? (m.expectReturn ? 'Da' : 'Nu') : '', m.note || '', (m.photos || []).length]);
  }
  shareOrDownload(csvBlob(rows), `stoc-personal-${today()}.csv`);
}
