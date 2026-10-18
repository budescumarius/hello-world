'use strict';
/* Suivi de chantier (Aproplan intégré) : plans, points sur plan, annotations, versions, PV de réunion, formulaires, journal, documents. */

const PTS = { open: ['Ouvert', '#e5484d'], progress: ['En cours', '#f08c00'], done: ['Levé', '#2f9e44'], closed: ['Clôturé', '#868e96'] };
const PT_CATS = ['Réserve', 'Observation', 'Défaut', 'Sécurité', 'Qualité', 'Question', 'Information'];
const isOpenPt = (x) => ['open', 'progress'].includes(x.data.status);
const isLatePt = (x) => isOpenPt(x) && x.data.due && x.data.due < today();

// ---------------------------------------------------------------- Import de plans (PDF → images)
let pdfjsP;
function loadPdfJs() {
  if (!pdfjsP) pdfjsP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfjsP = null; rej(new Error('Impossible de charger le lecteur PDF')); };
    document.head.appendChild(s);
  });
  return pdfjsP;
}
async function pdfPageImage(doc, i) {
  const page = await doc.getPage(i);
  const v1 = page.getViewport({ scale: 1 });
  let scale = 4000 / Math.max(v1.width, v1.height);
  scale = Math.min(scale, Math.sqrt(15e6 / (v1.width * v1.height)));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const out = { blob: await canvasToBlob(c, 'image/jpeg', 0.9), w: c.width, h: c.height };
  c.width = c.height = 0;
  return out;
}
// Envoie une image de plan + sa vignette ; renvoie { fileId, thumbId, w, h }
async function uploadPlanImage(blob, w, h, name, pid) {
  const th = await resizeImage(await blobToImg(blob), 480, 'image/jpeg', 0.8);
  const [f, t] = await Promise.all([upload(new File([blob], name + '.jpg', { type: 'image/jpeg' }), pid), upload(new File([th.blob], name + '-mini.jpg', { type: 'image/jpeg' }), pid)]);
  return { fileId: f.id, thumbId: t.id, w, h };
}
async function fileToPlanImages(file, onlyPage) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = onlyPage ? [onlyPage] : Array.from({ length: Math.min(doc.numPages, 60) }, (_, i) => i + 1);
    const out = [];
    for (const i of pages) { toast(`Conversion de la page ${i}/${doc.numPages}…`, 60000); out.push({ ...(await pdfPageImage(doc, i)), page: i, pages: doc.numPages }); }
    return out;
  }
  const r = await resizeImage(await blobToImg(file), 4096, 'image/jpeg', 0.9);
  return [{ blob: r.blob, w: r.w, h: r.h, page: 1, pages: 1 }];
}

async function tabPlans(p, el) {
  const [plans, points] = await Promise.all([db.list('plan', { project: p.id }), db.list('point', { project: p.id })]);
  plans.sort((a, b) => (a.data.order ?? a.id) - (b.data.order ?? b.id));
  el.innerHTML = `<div class="toolbar"><span class="muted">${plans.length} plan(s)</span><span class="grow"></span><button class="btn primary" data-act="add">${I.plus} Ajouter des plans (PDF / image)</button></div>
    ${plans.length ? `<div class="plans-grid">${plans.map((pl) => { const pts = points.filter((x) => +x.data.planId === pl.id); const op = pts.filter(isOpenPt).length; return `<div class="plan-card"><a href="#/project/${p.id}/plan/${pl.id}"><img src="${fileUrl(pl.data.thumbId || pl.data.fileId)}" alt="" loading="lazy"></a>
      <div class="pl-meta"><a class="grow" href="#/project/${p.id}/plan/${pl.id}"><b>${esc(pl.data.name)}</b><small class="muted">${esc(pl.data.level || '')}${(pl.data.version || 1) > 1 ? ` · v${pl.data.version}` : ''}</small></a>
        ${op ? badge(op, '#e5484d') : ''}<span class="badge" style="--c:#868e96">${pts.length}</span><button class="icon-btn sm" data-pl="${pl.id}">${I.more}</button></div></div>`; }).join('')}</div>`
    : empty('Aucun plan', 'Importez les plans du chantier (PDF multipages ou images). Vous pourrez y placer des points, dessiner et gérer les versions.')}`;
  $('[data-act=add]', el).onclick = async () => {
    const files = await pickFile('application/pdf,image/*', true);
    if (!files.length) return;
    let n = 0;
    try {
      for (const f of files) {
        const base = f.name.replace(/\.[^.]+$/, '');
        for (const img of await fileToPlanImages(f)) {
          toast(`Envoi du plan ${++n}…`, 60000);
          const name = img.pages > 1 ? `${base} – p.${img.page}` : base;
          const up = await uploadPlanImage(img.blob, img.w, img.h, name, p.id);
          await persist('plan', { project_id: p.id, data: { name, ...up, version: 1, versionDate: today(), markups: [] } }, { silent: true });
        }
      }
      toast(`${n} plan(s) ajouté(s)`);
    } catch (e) { toast('Import échoué : ' + e.message, 5000); }
    render();
  };
  $$('[data-pl]', el).forEach((b) => {
    const pl = plans.find((x) => x.id === +b.dataset.pl);
    b.onclick = () => menuSheet(pl.data.name, [
      { label: 'Renommer / niveau', icon: 'edit', run: () => formModal({ title: 'Plan', values: pl.data, fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'level', label: 'Niveau / zone' }], async onSave(v) { Object.assign(pl.data, v); await persist('plan', pl); render(); } }) },
      { label: `Nouvelle version (actuelle : v${pl.data.version || 1})`, icon: 'copy', run: () => newPlanVersion(p, pl) },
      { label: `Historique des versions (${(pl.data.versions || []).length})`, icon: 'calendar', run: () => planHistory(p, pl) },
      { sep: true },
      { label: 'Supprimer le plan', danger: true, icon: 'trash', run: async () => {
        if (!confirm('Supprimer ce plan ? Les points restent dans la liste mais ne seront plus positionnés.')) return;
        for (const v of [pl.data, ...(pl.data.versions || [])]) { await delFile(v.fileId); await delFile(v.thumbId); }
        await db.del('plan', pl.id); render();
      } },
    ]);
  });
}

async function newPlanVersion(p, pl) {
  const [file] = await pickFile('application/pdf,image/*');
  if (!file) return;
  try {
    let page;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      if (doc.numPages > 1) { const v = await ask('Page du PDF', [{ name: 'page', label: `Page à utiliser (1 à ${doc.numPages})`, type: 'number', required: true }], { page: 1 }); if (!v) return; page = Math.min(doc.numPages, Math.max(1, Math.round(num(v.page)))); }
    }
    const v = await ask('Nouvelle version', [{ name: 'note', label: 'Description de la modification', cls: 'full' }, { name: 'keep', label: 'Conserver les annotations de la version précédente', type: 'check' }], { note: file.name.replace(/\.[^.]+$/, ''), keep: true });
    if (!v) return;
    const [img] = await fileToPlanImages(file, page);
    toast('Envoi de la nouvelle version…', 60000);
    const up = await uploadPlanImage(img.blob, img.w, img.h, pl.data.name + ' v' + ((pl.data.version || 1) + 1), p.id);
    const d = pl.data;
    d.versions = d.versions || [];
    d.versions.push({ version: d.version || 1, fileId: d.fileId, thumbId: d.thumbId, w: d.w, h: d.h, date: d.versionDate, note: d.versionNote || '', markups: d.markups || [], by: S.me.id });
    Object.assign(d, up, { version: (d.version || 1) + 1, versionDate: today(), versionNote: v.note, markups: v.keep ? d.markups || [] : [] });
    await persist('plan', pl);
    toast(`Version ${d.version} enregistrée – les points restent à leur position`, 4000); render();
  } catch (e) { toast('Erreur : ' + e.message, 5000); }
}
function planHistory(p, pl) {
  const d = pl.data; const vs = [...(d.versions || [])].reverse();
  const m = modal(`${mhead(`Versions – ${d.name}`)}<div class="m-body"><div class="rows">
    <div class="row static"><img class="thumb" src="${fileUrl(d.thumbId)}" alt=""><span class="grow"><b>v${d.version || 1} (actuelle)</b><small class="muted">${fmtDate(d.versionDate)} ${esc(d.versionNote || '')}</small></span></div>
    ${vs.map((v, i) => `<div class="row static"><img class="thumb" src="${fileUrl(v.thumbId)}" alt=""><span class="grow"><b>v${v.version}</b><small class="muted">${fmtDate(v.date)} ${esc(v.note || '')}</small></span>
      <a class="btn sm" target="_blank" href="${fileUrl(v.fileId)}">Voir</a><button class="btn sm" data-restore="${i}">Rétablir</button></div>`).join('') || '<div class="empty sm">Aucune version précédente</div>'}
  </div></div>`);
  $$('[data-restore]', m.el).forEach((b) => {
    b.onclick = async () => {
      const v = vs[+b.dataset.restore];
      if (!confirm(`Rétablir la version v${v.version} comme version actuelle ?`)) return;
      d.versions = d.versions.filter((x) => x !== v);
      d.versions.push({ version: d.version || 1, fileId: d.fileId, thumbId: d.thumbId, w: d.w, h: d.h, date: d.versionDate, note: d.versionNote || '', markups: d.markups || [] });
      Object.assign(d, { fileId: v.fileId, thumbId: v.thumbId, w: v.w, h: v.h, version: v.version, versionDate: v.date, versionNote: v.note, markups: v.markups || [] });
      await persist('plan', pl); m.close(); render();
    };
  });
}

// ---------------------------------------------------------------- Annotations
const MK_COLORS = ['#e5484d', '#f08c00', '#3b5bdb', '#2f9e44', '#111111'];
const MK_TOOLS = [['pen', '✎ Crayon'], ['arrow', '↗ Flèche'], ['rect', '▭ Rectangle'], ['cloud', '☁ Nuage'], ['text', 'T Texte'], ['erase', '⌫ Gomme']];
const mkW = (pl) => Math.max(pl.w, pl.h) / 320;
const mkFont = (pl) => Math.max(pl.w, pl.h) / 28;
function mkPath(m, pl) {
  const P = ([x, y]) => [x * pl.w, y * pl.h]; const sw = mkW(pl);
  if (m.type === 'pen') return m.pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).map((v) => v.toFixed(1)).join(' ')}`).join('');
  const [a, b] = [P(m.pts[0]), P(m.pts[1])];
  if (m.type === 'arrow') { const g = Math.atan2(b[1] - a[1], b[0] - a[0]); const h = sw * 7; return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}M${b[0] - h * Math.cos(g - 0.45)} ${b[1] - h * Math.sin(g - 0.45)}L${b[0]} ${b[1]}L${b[0] - h * Math.cos(g + 0.45)} ${b[1] - h * Math.sin(g + 0.45)}`; }
  const x1 = Math.min(a[0], b[0]); const x2 = Math.max(a[0], b[0]); const y1 = Math.min(a[1], b[1]); const y2 = Math.max(a[1], b[1]);
  if (m.type === 'rect') return `M${x1} ${y1}H${x2}V${y2}H${x1}Z`;
  const tg = Math.min(Math.max(sw * 5, Math.min(x2 - x1, y2 - y1) / 5), Math.max(pl.w, pl.h) / 35);
  const cs = [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]; let d = `M${x1} ${y1}`;
  for (let i = 0; i < 4; i++) { const [p, q] = [cs[i], cs[i + 1]]; const len = Math.hypot(q[0] - p[0], q[1] - p[1]); const k = Math.max(1, Math.round(len / (tg * 2))); const r = len / k / 2; for (let j = 1; j <= k; j++) d += `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${(p[0] + (q[0] - p[0]) * j / k).toFixed(1)} ${(p[1] + (q[1] - p[1]) * j / k).toFixed(1)}`; }
  return d;
}
function mkSVG(m, pl) {
  if (m.type === 'text') { const fs = mkFont(pl); return `<text x="${m.pts[0][0] * pl.w}" y="${m.pts[0][1] * pl.h}" font-size="${fs}" fill="${m.color}" stroke="#fff" stroke-width="${fs / 6}" paint-order="stroke" font-weight="700" font-family="Helvetica, Arial, sans-serif">${esc(m.text)}</text>`; }
  return `<path d="${mkPath(m, pl)}" fill="none" stroke="${m.color}" stroke-width="${mkW(pl)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function drawMarkups(ctx, pl) {
  for (const m of pl.markups || []) {
    ctx.save();
    if (m.type === 'text') { const fs = mkFont(pl); ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`; ctx.lineWidth = fs / 6; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.strokeText(m.text, m.pts[0][0] * pl.w, m.pts[0][1] * pl.h); ctx.fillStyle = m.color; ctx.fillText(m.text, m.pts[0][0] * pl.w, m.pts[0][1] * pl.h); } else { ctx.strokeStyle = m.color; ctx.lineWidth = mkW(pl); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(new Path2D(mkPath(m, pl))); }
    ctx.restore();
  }
}
function mkDist(m, pl, x, y) {
  const P = ([px, py]) => [px * pl.w, py * pl.h];
  const seg = (a, b) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0; return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)); };
  let pts = m.pts.map(P);
  if (m.type === 'text') { const fs = mkFont(pl); const w = m.text.length * fs * 0.55; const [tx, ty] = pts[0]; return x >= tx && x <= tx + w && y >= ty - fs && y <= ty + fs * 0.3 ? 0 : seg([tx, ty - fs / 2], [tx + w, ty - fs / 2]); }
  if (m.type === 'rect' || m.type === 'cloud') { const [a, b] = pts; pts = [a, [b[0], a[1]], b, [a[0], b[1]], a]; }
  let best = Infinity; for (let i = 1; i < pts.length; i++) best = Math.min(best, seg(pts[i - 1], pts[i]));
  return best;
}

// ---------------------------------------------------------------- Visionneuse de plan
const PIN = (c) => `<svg viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8 1 16.6 1 28.4 17 43 17 43s16-14.6 16-26.4C33 8 25.8 1 17 1z" fill="${c}" stroke="#fff" stroke-width="2"/></svg>`;
let planIntent = null;
async function viewPlan(p, planId) {
  const pl = await db.get('plan', planId);
  const d = pl.data; d.markups = d.markups || [];
  let points = (await db.list('point', { project: p.id })).filter((x) => +x.data.planId === pl.id);
  const intent = planIntent; planIntent = null;
  const vis = ui.pinStatus || (ui.pinStatus = Object.keys(PTS).filter((k) => k !== 'closed'));
  app.innerHTML = `<div class="viewer-wrap">
    <header class="top"><a class="icon-btn" href="#/project/${p.id}/plans">${I.back}</a><div class="top-title"><div><h1>${esc(d.name)}</h1><div class="top-sub">${esc(p.data.name)} · v${d.version || 1}</div></div></div>
      <div class="top-actions"><button class="btn" data-act="filter">${I.filter} Filtres</button><button class="btn" data-act="draw">${I.pencil} Annoter</button><button class="btn primary" data-act="add">${I.plus} Point</button></div></header>
    <div class="viewer" id="vp"><div class="plan-inner" id="inner" style="width:${d.w}px;height:${d.h}px"><img src="${fileUrl(d.fileId)}" alt="" draggable="false">
      <svg class="markups" id="mk" viewBox="0 0 ${d.w} ${d.h}" preserveAspectRatio="none"></svg><div id="pins"></div></div>
      <div class="banner" id="banner" hidden></div>
      <div class="viewer-tools"><button class="icon-btn" data-z="in">${I.plus}</button><button class="icon-btn" data-z="out">${I.minus}</button><button class="icon-btn" data-z="fit">${I.fit}</button></div>
    </div></div>`;
  const vp = $('#vp'); const inner = $('#inner'); const pinsEl = $('#pins'); const svg = $('#mk'); const banner = $('#banner');
  let scale = 1; let tx = 0; let ty = 0; let minS = 0.05; let maxS = 8; let mode = intent && intent.move ? 'move' : 'view';
  const apply = () => { inner.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; inner.style.setProperty('--inv', 1 / scale); };
  const fit = () => { const r = vp.getBoundingClientRect(); const s = Math.min(r.width / d.w, r.height / d.h) * 0.96; minS = s * 0.5; maxS = Math.max(s * 16, 3); scale = s; tx = (r.width - d.w * s) / 2; ty = (r.height - d.h * s) / 2; apply(); };
  const zoomAt = (cx, cy, ns) => { ns = Math.min(maxS, Math.max(minS, ns)); tx = cx - (cx - tx) * ns / scale; ty = cy - (cy - ty) * ns / scale; scale = ns; apply(); };
  const drawPins = (hl) => { pinsEl.innerHTML = points.filter((x) => x.data.x != null && vis.includes(x.data.status)).sort((a, b) => a.data.y - b.data.y).map((x) => `<div class="pin ${x.id === hl ? 'hl' : ''}" data-id="${x.id}" style="left:${x.data.x * 100}%;top:${x.data.y * 100}%">${PIN(PTS[x.data.status][1])}<span>${esc(x.number)}</span></div>`).join(''); };
  const drawMk = (preview) => { svg.innerHTML = d.markups.map((m) => mkSVG(m, d)).join('') + (preview ? mkSVG(preview, d) : ''); };
  const reload = async (hl) => { points = (await db.list('point', { project: p.id })).filter((x) => +x.data.planId === pl.id); drawPins(hl); };
  const setMode = (m, txt) => { mode = m; vp.classList.toggle('adding', m !== 'view'); banner.hidden = m === 'view'; if (m !== 'view') { banner.innerHTML = `<span>${txt}</span><button>Annuler</button>`; $('button', banner).onclick = () => setMode('view'); } };
  const rel = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const norm = (e) => { const r = inner.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  async function onTap(e, target) {
    const [x, y] = norm(e); const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    const pinEl = target && target.closest && target.closest('.pin');
    if (mode === 'add' && inside) { setMode('view'); editPoint(p, null, { planId: pl.id, x, y }, () => reload()); } else if (mode === 'move' && inside) {
      const pt = await db.get('point', intent.move); pt.data.planId = pl.id; pt.data.x = x; pt.data.y = y; await persist('point', pt); toast(`Point ${pt.number} positionné`); setMode('view'); reload(pt.id);
    } else if (mode === 'view' && pinEl) { const pt = points.find((q) => q.id === +pinEl.dataset.id); if (pt) editPoint(p, pt, null, () => reload()); }
  }
  // gestes : un doigt = déplacer, deux doigts = zoom, toucher court = action
  const ptrs = new Map(); let g = null;
  const pinch = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.viewer-tools,.banner,.draw-layer')) return;
    vp.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e));
    if (ptrs.size === 1) { const q = rel(e); g = { k: 'pan', sx: q.x, sy: q.y, tx, ty, t: Date.now(), moved: false, target: e.target }; } else if (ptrs.size === 2) { const pi = pinch(); g = { k: 'pinch', d0: pi.d, s0: scale, cx: (pi.mx - tx) / scale, cy: (pi.my - ty) / scale }; }
  });
  vp.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, rel(e));
    if (g.k === 'pan' && ptrs.size === 1) { const q = rel(e); const dx = q.x - g.sx; const dy = q.y - g.sy; if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true; if (g.moved) { tx = g.tx + dx; ty = g.ty + dy; apply(); } } else if (g.k === 'pinch' && ptrs.size >= 2) { const pi = pinch(); scale = Math.min(maxS, Math.max(minS, g.s0 * pi.d / g.d0)); tx = pi.mx - g.cx * scale; ty = pi.my - g.cy * scale; apply(); }
  });
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (g && g.k === 'pan' && !g.moved && e.type === 'pointerup' && Date.now() - g.t < 600) onTap(e, g.target);
    if (ptrs.size === 1) { const q = [...ptrs.values()][0]; g = { k: 'pan', sx: q.x, sy: q.y, tx, ty, t: 0, moved: true }; } else if (!ptrs.size) g = null;
  };
  vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
  vp.addEventListener('wheel', (e) => { e.preventDefault(); const q = rel(e); zoomAt(q.x, q.y, scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))); }, { passive: false });
  vp.addEventListener('dblclick', (e) => { if (e.target.closest('.viewer-tools,.draw-layer')) return; const q = rel(e); zoomAt(q.x, q.y, scale * 2); });
  $$('[data-z]').forEach((b) => { b.onclick = () => { const r = vp.getBoundingClientRect(); if (b.dataset.z === 'fit') fit(); else zoomAt(r.width / 2, r.height / 2, scale * (b.dataset.z === 'in' ? 1.6 : 1 / 1.6)); }; });
  $('[data-act=add]').onclick = () => setMode(mode === 'add' ? 'view' : 'add', 'Touchez le plan à l\'endroit du nouveau point');
  $('[data-act=filter]').onclick = () => {
    const m = modal(`${mhead('Afficher sur le plan')}<div class="m-body">${Object.entries(PTS).map(([k, [l, c]]) => `<label class="chk"><input type="checkbox" value="${k}" ${vis.includes(k) ? 'checked' : ''}><i class="dot" style="--c:${c}"></i>${l} (${points.filter((x) => x.data.status === k && x.data.x != null).length})</label>`).join('')}</div>`);
    $$('input', m.el).forEach((i) => { i.onchange = () => { if (i.checked) vis.push(i.value); else vis.splice(vis.indexOf(i.value), 1); saveUi(); drawPins(); }; });
  };
  // mode annotation
  let layer = null; let barEl = null; const added = [];
  const mkSt = ui.mk || (ui.mk = { tool: 'pen', color: MK_COLORS[0] });
  const savePlan = debounce(() => persist('plan', pl, { silent: true }).catch((e) => toast('Erreur : ' + e.message)), 600);
  const closeDraw = () => { if (layer) layer.remove(); if (barEl) barEl.remove(); layer = barEl = null; savePlan.flush(); };
  $('[data-act=draw]').onclick = () => {
    if (layer) return closeDraw();
    layer = document.createElement('div'); layer.className = 'draw-layer'; vp.appendChild(layer);
    barEl = document.createElement('div'); barEl.className = 'draw-bar';
    const drawBar = () => {
      barEl.innerHTML = `<div class="db-row">${MK_TOOLS.map(([k, l]) => `<button class="chip ${mkSt.tool === k ? 'on' : ''}" data-tool="${k}">${l}</button>`).join('')}<span class="grow"></span>
        ${MK_COLORS.map((c) => `<button class="swatch ${mkSt.color === c ? 'on' : ''}" data-col="${c}" style="--c:${c}"></button>`).join('')}
        <button class="btn sm" data-undo>↶ Annuler</button><button class="btn sm" data-clear>Tout effacer</button><button class="btn sm primary" data-done>Terminer</button></div>`;
      $$('[data-tool]', barEl).forEach((b) => { b.onclick = () => { mkSt.tool = b.dataset.tool; saveUi(); drawBar(); }; });
      $$('[data-col]', barEl).forEach((b) => { b.onclick = () => { mkSt.color = b.dataset.col; saveUi(); drawBar(); }; });
      $('[data-undo]', barEl).onclick = () => { const id = added.pop(); if (!id) return; d.markups = d.markups.filter((m) => m.id !== id); drawMk(); savePlan(); };
      $('[data-clear]', barEl).onclick = () => { if (d.markups.length && confirm('Effacer toutes les annotations de ce plan ?')) { d.markups = []; drawMk(); savePlan(); } };
      $('[data-done]', barEl).onclick = closeDraw;
    };
    drawBar(); $('.viewer-wrap').appendChild(barEl);
    let cur = null;
    ['pointermove', 'pointerup', 'pointercancel', 'dblclick'].forEach((t) => layer.addEventListener(t, (e) => e.stopPropagation()));
    layer.onpointerdown = async (e) => {
      e.stopPropagation(); layer.setPointerCapture(e.pointerId); const q = norm(e);
      if (mkSt.tool === 'text') { const v = await ask('Texte sur le plan', [{ name: 't', label: 'Texte', required: true, cls: 'full' }]); if (v) { const m = { id: lid(), type: 'text', color: mkSt.color, pts: [q], text: v.t }; d.markups.push(m); added.push(m.id); drawMk(); savePlan(); } return; }
      if (mkSt.tool === 'erase') { const r = inner.getBoundingClientRect(); let best = null; let bd = Infinity; for (const m of d.markups) { const dd = mkDist(m, d, q[0] * d.w, q[1] * d.h); if (dd < bd) { bd = dd; best = m; } } if (best && bd <= 26 * d.w / r.width) { d.markups = d.markups.filter((m) => m !== best); drawMk(); savePlan(); } return; }
      cur = { id: lid(), type: mkSt.tool, color: mkSt.color, pts: mkSt.tool === 'pen' ? [q] : [q, q] };
    };
    layer.onpointermove = (e) => { if (!cur) return; const q = norm(e); if (cur.type === 'pen') cur.pts.push(q); else cur.pts[1] = q; drawMk(cur); };
    layer.onpointerup = layer.onpointercancel = () => {
      if (!cur) return; const m = cur; cur = null; const r = inner.getBoundingClientRect();
      const [a, b] = [m.pts[0], m.pts[m.pts.length - 1]];
      if (m.type === 'pen' ? m.pts.length > 1 : Math.hypot((b[0] - a[0]) * r.width, (b[1] - a[1]) * r.height) > 8) { if (m.type === 'pen') m.pts = m.pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]); d.markups.push(m); added.push(m.id); savePlan(); }
      drawMk();
    };
  };
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  cleanupView = () => { window.removeEventListener('resize', onResize); if (layer) layer.remove(); if (barEl) barEl.remove(); savePlan.flush(); };
  fit(); drawMk(); drawPins(intent && intent.highlight);
  if (intent && intent.highlight) { const pt = points.find((q) => q.id === intent.highlight); if (pt && pt.data.x != null) { const r = vp.getBoundingClientRect(); scale = Math.min(maxS, scale * 3); tx = r.width / 2 - pt.data.x * d.w * scale; ty = r.height / 2 - pt.data.y * d.h * scale; apply(); } }
  if (mode === 'move') setMode('move', 'Touchez le plan pour positionner le point');
}

// ---------------------------------------------------------------- Images pour rapports
const planImgCache = new Map();
const planImage = (pl) => { if (!planImgCache.has(pl.data.fileId)) planImgCache.set(pl.data.fileId, loadImg(fileUrl(pl.data.fileId))); return planImgCache.get(pl.data.fileId); };
function drawPin(ctx, x, y, r, color, label) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.4, y - r * 0.9, x - r, y - r * 1.3, x - r, y - r * 1.9); ctx.arc(x, y - r * 1.9, r, Math.PI, 0); ctx.bezierCurveTo(x + r, y - r * 1.3, x + r * 0.4, y - r * 0.9, x, y);
  ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = Math.max(1.5, r / 7); ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(r * (String(label).length > 2 ? 0.8 : 1.05))}px Helvetica, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y - r * 1.9);
  ctx.restore();
}
async function planWithPins(pl, pts, maxW = 2000) {
  const d = pl.data; const img = await planImage(pl); const k = Math.min(1, maxW / d.w);
  const c = document.createElement('canvas'); c.width = Math.round(d.w * k); c.height = Math.round(d.h * k);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  ctx.save(); ctx.scale(k, k); drawMarkups(ctx, d); ctx.restore();
  const r = Math.max(10, Math.min(c.width, c.height) / 55);
  [...pts].sort((a, b) => a.data.y - b.data.y).forEach((x) => drawPin(ctx, x.data.x * c.width, x.data.y * c.height, r, PTS[x.data.status][1], x.number));
  return c.toDataURL('image/jpeg', 0.85);
}
async function cropPlan(pl, pt, outW = 320, outH = 320) {
  const d = pl.data; const img = await planImage(pl);
  const span = Math.min(d.w, d.h) * 0.22; const sw = Math.min(d.w, span * (outW / outH)); const sh = Math.min(d.h, span);
  const sx = Math.min(Math.max(0, pt.data.x * d.w - sw / 2), d.w - sw); const sy = Math.min(Math.max(0, pt.data.y * d.h - sh / 2), d.h - sh);
  const c = document.createElement('canvas'); c.width = outW; c.height = outH; const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  ctx.save(); ctx.setTransform(outW / sw, 0, 0, outH / sh, -sx * outW / sw, -sy * outH / sh); drawMarkups(ctx, d); ctx.restore();
  drawPin(ctx, (pt.data.x * d.w - sx) * outW / sw, (pt.data.y * d.h - sy) * outH / sh, Math.max(10, outW / 22), PTS[pt.data.status][1], pt.number);
  return c.toDataURL('image/jpeg', 0.85);
}

// ---------------------------------------------------------------- Points (réserves / observations)
async function editPoint(p, pt, preset = {}, onDone) {
  const [contacts, plans] = await Promise.all([db.list('contact'), db.list('plan', { project: p.id })]);
  const isNew = !pt;
  const d = isNew ? { status: 'open', priority: 'normal', category: 'Réserve', photos: [], history: [], ...preset } : JSON.parse(JSON.stringify(pt.data));
  d.photos = d.photos || []; d.history = d.history || [];
  const orig = d.status;
  const added = []; let saved = false;
  const subs = contacts.filter((c) => ['soustraitant', 'fournisseur', 'architecte', 'autre'].includes(c.data.kind));
  const m = modal(`${mhead(isNew ? 'Nouveau point' : `Point n° ${pt.number}`)}<form class="m-body">
    ${fieldsGrid([
      { name: 'title', label: 'Titre', required: true, cls: 'full', placeholder: 'ex. Fissure mur cage d\'escalier' },
      { name: 'desc', label: 'Description', type: 'textarea', cls: 'full' },
      { name: 'companyId', label: 'Intervenant responsable', type: 'select', options: [['', '— non attribué —'], ...subs.map((c) => [c.id, contactName(c)])] },
      { name: 'assigneeId', label: 'Suivi par', type: 'user' },
      { name: 'due', label: 'Échéance', type: 'date' }, { name: 'priority', label: 'Priorité', type: 'select', options: optsOf(PRIO) },
      { name: 'category', label: 'Catégorie', list: 'ptcats' }, { name: 'location', label: 'Localisation', placeholder: 'ex. Étage 2, app. 7' },
    ], d)}
    <div class="field full"><span class="lbl">Statut</span><div class="status-bar">${Object.entries(PTS).map(([k, [l, c]]) => `<button type="button" data-st="${k}" style="--c:${c}" class="${d.status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field full"><span class="lbl">Photos</span><div class="photos" data-ph></div></div>
    <div class="field full"><span class="lbl">Plan</span>${plans.length ? `<select name="planId"><option value="">— aucun —</option>${plans.map((pl) => `<option value="${pl.id}" ${pl.id === +d.planId ? 'selected' : ''}>${esc(pl.data.name)}</option>`).join('')}</select>
      <div class="btns">${!isNew ? '<button type="button" class="btn sm" data-place>Positionner sur le plan</button>' : ''}${d.planId && d.x != null ? '<button type="button" class="btn sm" data-show>Voir sur le plan</button>' : ''}</div>` : '<span class="muted">Aucun plan dans ce chantier</span>'}</div>
    <div class="field full"><span class="lbl">Historique et commentaires</span><div class="history" data-h></div><div class="comment-row"><input data-cmt placeholder="Ajouter un commentaire…"><button type="button" class="btn sm" data-addc>Ajouter</button></div></div>
    <datalist id="ptcats">${PT_CATS.map((x) => `<option value="${x}">`).join('')}</datalist>
  </form><div class="m-foot">${!isNew ? `<button class="btn danger ghost" data-del>${I.trash}</button><button class="btn" data-share>${I.mail} Envoyer</button>` : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button></div>`,
  { wide: true, onClose: () => { if (!saved) added.forEach(delFile); } });
  const form = $('form', m.el);
  $$('[data-st]', m.el).forEach((b) => { b.onclick = () => { d.status = b.dataset.st; $$('[data-st]', m.el).forEach((x) => x.classList.toggle('on', x === b)); }; });
  const drawPh = () => {
    const box = $('[data-ph]', m.el);
    box.innerHTML = d.photos.map((id, i) => `<div class="ph"><a href="${fileUrl(id)}" target="_blank"><img src="${fileUrl(id)}" alt=""></a><button type="button" data-rm="${i}">✕</button></div>`).join('') + `<label class="add">${I.camera}<span>Photo</span><input type="file" accept="image/*" multiple hidden></label>`;
    $('input', box).onchange = async (e) => { for (const f of e.target.files) { toast('Envoi de la photo…', 20000); const r = await uploadPhoto(f, p.id); d.photos.push(r.id); added.push(r.id); } toast('Photo ajoutée'); drawPh(); };
    $$('[data-rm]', box).forEach((b) => { b.onclick = () => { d.photos.splice(+b.dataset.rm, 1); drawPh(); }; });
  };
  const drawHist = () => { $('[data-h]', m.el).innerHTML = [...d.history].reverse().map((h) => `<div class="h ${h.kind === 'comment' ? '' : 'sys'}"><small>${fmtDT(h.t)} · ${esc(userName(h.uid))}</small>${esc(h.text)}</div>`).join('') || '<div class="muted sm">Aucun commentaire</div>'; };
  const addC = () => { const inp = $('[data-cmt]', m.el); if (!inp.value.trim()) return; d.history.push({ t: new Date().toISOString().slice(0, 19).replace('T', ' '), uid: S.me.id, kind: 'comment', text: inp.value.trim() }); inp.value = ''; drawHist(); };
  $('[data-addc]', m.el).onclick = addC; $('[data-cmt]', m.el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addC(); } };
  drawPh(); drawHist();
  const fields = [{ name: 'title' }, { name: 'desc' }, { name: 'companyId' }, { name: 'assigneeId', type: 'user' }, { name: 'due' }, { name: 'priority' }, { name: 'category' }, { name: 'location' }];
  const save = async () => {
    Object.assign(d, readFields(form, fields));
    if (!d.title) { toast('Indiquez un titre'); return null; }
    const pid = form.elements.planId ? form.elements.planId.value : '';
    if (String(pid) !== String(d.planId || '')) { d.planId = pid ? +pid : null; d.x = d.y = null; }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (isNew) d.history.unshift({ t: now, uid: S.me.id, kind: 'sys', text: 'Point créé' });
    else if (d.status !== orig) d.history.push({ t: now, uid: S.me.id, kind: 'sys', text: `Statut : ${PTS[orig][0]} → ${PTS[d.status][0]}` });
    const it = pt || { project_id: p.id };
    it.data = d;
    const r = await persist('point', it); saved = true;
    return r;
  };
  $('[data-save]', m.el).onclick = async () => { const r = await save(); if (r) { m.close(); toast(isNew ? `Point n° ${r.number} créé` : 'Enregistré'); if (onDone) onDone(); else render(); } };
  const place = $('[data-place]', m.el); if (place) place.onclick = async () => { const r = await save(); if (!r) return; if (!r.data.planId) return toast('Choisissez d\'abord un plan'); planIntent = { move: r.id }; m.close(); go(`#/project/${p.id}/plan/${r.data.planId}`); };
  const show = $('[data-show]', m.el); if (show) show.onclick = () => { planIntent = { highlight: pt.id }; m.close(); go(`#/project/${p.id}/plan/${d.planId}`); };
  const del = $('[data-del]', m.el); if (del) del.onclick = async () => { if (!confirm(`Supprimer le point n° ${pt.number} ?`)) return; for (const f of d.photos) await delFile(f); await db.del('point', pt.id); saved = true; m.close(); if (onDone) onDone(); else render(); };
  const share = $('[data-share]', m.el); if (share) share.onclick = () => { const c = byId(contacts, d.companyId); location.href = `mailto:${encodeURIComponent((c && c.data.email) || '')}?subject=${encodeURIComponent(`${p.data.name} – point n° ${pt.number} : ${d.title}`)}&body=${encodeURIComponent(pointText([pt], plans, p))}`; };
}
function pointText(pts, plans, p) {
  return `Bonjour,\n\nChantier : ${p.data.name}${p.data.address ? ' (' + [p.data.address, p.data.city].filter(Boolean).join(', ') + ')' : ''}\n\n` + pts.map((x) => {
    const pl = byId(plans, x.data.planId);
    return `N° ${x.number} – ${x.data.title}\n   ${[PTS[x.data.status][0], pl && 'Plan : ' + pl.data.name, x.data.location, x.data.due && 'Échéance : ' + fmtDate(x.data.due)].filter(Boolean).join(' · ')}${x.data.desc ? '\n   ' + x.data.desc.replace(/\n/g, '\n   ') : ''}`;
  }).join('\n\n') + `\n\nMerci de nous confirmer la levée de ces points.\n\nCordialement,\n${S.me.name}\n${company().name || ''}`;
}

async function tabPoints(p, el) {
  const [points, contacts, plans] = await Promise.all([db.list('point', { project: p.id }), db.list('contact'), db.list('plan', { project: p.id })]);
  const stt = ui['pts_' + p.id] || (ui['pts_' + p.id] = { f: 'actifs' });
  const counts = Object.fromEntries(Object.keys(PTS).map((k) => [k, points.filter((x) => x.data.status === k).length]));
  el.innerHTML = `<div class="kpis">${Object.entries(PTS).map(([k, [l, c]]) => kpi(l, counts[k], { cls: '', sub: `<i class="dot" style="--c:${c}"></i>` })).join('')}${kpi('En retard', points.filter(isLatePt).length, { cls: points.some(isLatePt) ? 'bad' : '' })}</div>
    <div class="toolbar"><span class="grow"></span><button class="btn" data-act="send">${I.mail} Envoyer aux intervenants</button><button class="btn" data-act="rep">${I.print} Rapport PDF</button><button class="btn primary" data-act="new">${I.plus} Nouveau point</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: points, state: stt,
    search: (x) => [x.number, x.data.title, x.data.desc, x.data.location, x.data.category, contactName(byId(contacts, x.data.companyId))].join(' '),
    filters: { def: 'actifs', options: [['actifs', 'Ouverts + en cours'], ...Object.entries(PTS).map(([k, [l, c]]) => [k, l, c]), ['late', 'En retard', '#e5484d'], ['', 'Tous']], match: (x, f) => (f === 'actifs' ? isOpenPt(x) : f === 'late' ? isLatePt(x) : x.data.status === f) },
    columns: [
      { l: 'N°', v: (x) => `<span class="num" style="--c:${PTS[x.data.status][1]}">${esc(x.number)}</span>`, sort: (x) => +x.number },
      { l: 'Point', v: (x) => `<b>${esc(x.data.title)}</b><br><small class="muted">${esc([x.data.category, x.data.location].filter(Boolean).join(' · '))}</small>` },
      { l: 'Intervenant', v: (x) => esc(contactName(byId(contacts, x.data.companyId))) },
      { l: 'Plan', v: (x) => esc((byId(plans, x.data.planId) || { data: {} }).data.name || '') },
      { l: 'Échéance', v: (x) => `<span class="${isLatePt(x) ? 'late' : ''}">${fmtDate(x.data.due)}</span>`, sort: (x) => x.data.due || '9' },
      { l: 'Statut', v: (x) => st(PTS, x.data.status) },
      { l: 'Photos', v: (x) => ((x.data.photos || []).length ? `<img class="thumb" src="${fileUrl(x.data.photos[0])}" alt="">` : '') },
    ],
    onRow: (x) => editPoint(p, x), empty: 'Aucun point',
  });
  $('[data-act=new]', el).onclick = () => editPoint(p, null);
  $('[data-act=rep]', el).onclick = () => pointsReportDialog(p, contacts, plans);
  $('[data-act=send]', el).onclick = () => {
    const byCo = new Map();
    points.filter(isOpenPt).forEach((x) => { if (x.data.companyId) { if (!byCo.has(+x.data.companyId)) byCo.set(+x.data.companyId, []); byCo.get(+x.data.companyId).push(x); } });
    if (!byCo.size) return toast('Aucun point ouvert attribué à un intervenant');
    menuSheet('Envoyer les points ouverts à…', [...byCo].map(([cid, list]) => { const c = byId(contacts, cid); return { label: `${contactName(c)} (${list.length} point(s))${c && c.data.email ? '' : ' – sans email'}`, run: () => { location.href = `mailto:${encodeURIComponent((c && c.data.email) || '')}?subject=${encodeURIComponent(`${p.data.name} – ${list.length} point(s) à lever`)}&body=${encodeURIComponent(pointText(list, plans, p))}`; } }; }));
  };
}

function pointsReportDialog(p, contacts, plans) {
  formModal({
    title: 'Rapport de points', saveLabel: 'Générer', values: { title: 'Rapport de suivi de chantier', statuses: ['open', 'progress', 'done'], plans: true, crop: true, photos: true },
    fields: [
      { name: 'title', label: 'Titre', cls: 'full' },
      { name: 'statuses', label: 'Statuts', type: 'multi', options: optsOf(PTS), cls: 'full' },
      { name: 'companyId', label: 'Intervenant', type: 'select', options: [['', 'Tous'], ...contacts.filter((c) => c.data.kind !== 'client').map((c) => [c.id, contactName(c)])] },
      { name: 'planId', label: 'Plan', type: 'select', options: [['', 'Tous'], ...plans.map((pl) => [pl.id, pl.data.name])] },
      { name: 'plans', label: 'Plans avec la position des points', type: 'check' }, { name: 'crop', label: 'Extrait de plan par point', type: 'check' },
      { name: 'photos', label: 'Photos', type: 'check' }, { name: 'hist', label: 'Historique / commentaires', type: 'check' },
    ],
    async onSave(v) { setTimeout(() => pointsReport(p, v), 0); },
  });
}
async function pointsReport(p, o) {
  const [points, contacts, plans] = await Promise.all([db.list('point', { project: p.id }), db.list('contact'), db.list('plan', { project: p.id })]);
  printPage(o.title, '<p>Génération du rapport…</p>', `#/project/${p.id}/points`);
  const list = points.filter((x) => o.statuses.includes(x.data.status) && (!o.companyId || +x.data.companyId === +o.companyId) && (!o.planId || +x.data.planId === +o.planId)).sort((a, b) => +a.number - +b.number);
  let html = `${fieldHead(p, o.title)}<table class="d-lines"><tr><th>Total</th>${Object.values(PTS).map(([l]) => `<th>${l}</th>`).join('')}<th>En retard</th></tr><tr><td><b>${list.length}</b></td>${Object.keys(PTS).map((k) => `<td>${list.filter((x) => x.data.status === k).length}</td>`).join('')}<td>${list.filter(isLatePt).length}</td></tr></table>`;
  if (o.plans) for (const pl of plans) { const pts = list.filter((x) => +x.data.planId === pl.id && x.data.x != null); if (pts.length) html += `<div class="d-sec"><h2>Plan : ${esc(pl.data.name)} (${pts.length})</h2><img class="d-plan" src="${await planWithPins(pl, pts)}" alt=""></div>`; }
  html += `<h2>Points (${list.length})</h2>`;
  for (const x of list) {
    const pl = byId(plans, x.data.planId); const c = byId(contacts, x.data.companyId);
    const crop = o.crop && pl && x.data.x != null ? await cropPlan(pl, x) : '';
    html += `<div class="d-pt">${crop ? `<img class="d-crop" src="${crop}" alt="">` : ''}<div class="grow"><div class="d-pt-t">${badge('N° ' + x.number, PTS[x.data.status][1])} <b>${esc(x.data.title)}</b></div>
      <div class="muted">${esc([PTS[x.data.status][0], x.data.category, x.data.location, PRIO[x.data.priority] && 'Priorité ' + PRIO[x.data.priority][0].toLowerCase()].filter(Boolean).join(' · '))}</div>
      <div>Intervenant : <b>${esc(contactName(c))}</b>${x.data.due ? ` · Échéance : <b class="${isLatePt(x) ? 'late' : ''}">${fmtDate(x.data.due)}</b>` : ''}${pl ? ` · Plan : ${esc(pl.data.name)}` : ''}</div>
      ${x.data.desc ? `<div class="pre">${esc(x.data.desc)}</div>` : ''}
      ${o.hist ? `<div class="sm">${(x.data.history || []).map((h) => `<div>${fmtDT(h.t)} – ${esc(userName(h.uid))} : ${esc(h.text)}</div>`).join('')}</div>` : ''}
      ${o.photos && (x.data.photos || []).length ? `<div class="d-photos">${x.data.photos.map((f) => `<img src="${fileUrl(f)}" alt="">`).join('')}</div>` : ''}</div></div>`;
  }
  $('.print-page').innerHTML = `<div class="doc">${html}</div>`;
}
function fieldHead(p, title) {
  const co = company();
  return `<div class="d-head"><div class="d-from">${co.logoId ? `<img class="d-logo" src="${fileUrl(co.logoId)}" alt="">` : ''}<b class="d-co">${esc(co.name || '')}</b></div>
    <div class="d-meta"><h1>${esc(title)}</h1><div><b>${esc(p.data.name)}</b></div><div>${esc([p.data.address, p.data.city].filter(Boolean).join(', '))}</div><div class="muted">Édité le ${fmtDate(today())} par ${esc(S.me.name)}</div></div></div>`;
}

// ---------------------------------------------------------------- PV de réunion
async function editMeeting(p, mt) {
  const [contacts, points] = await Promise.all([db.list('contact'), db.list('point', { project: p.id })]);
  const meetings = mt ? [] : await db.list('meeting', { project: p.id });
  const d = mt ? mt.data : { title: `Réunion de chantier n° ${meetings.length + 1}`, date: today(), location: [p.data.address, p.data.city].filter(Boolean).join(', '), attendees: [], users: [S.me.id], pointIds: points.filter(isOpenPt).map((x) => x.id), notes: '', next: '' };
  const people = contacts.filter((c) => c.data.kind !== 'fournisseur');
  const sorted = [...points].sort((a, b) => (isOpenPt(b) - isOpenPt(a)) || +a.number - +b.number);
  formModal({
    title: mt ? d.title : 'Nouveau PV de réunion', wide: true, values: d,
    fields: [
      { name: 'title', label: 'Titre', required: true, cls: 'full' }, { name: 'date', label: 'Date', type: 'date' }, { name: 'next', label: 'Prochaine réunion', type: 'date' },
      { name: 'location', label: 'Lieu', cls: 'full' },
      { name: 'users', label: 'Présents (notre équipe)', type: 'users', cls: 'full' },
      { name: 'attendees', label: 'Présents (intervenants)', type: 'multi', options: people.map((c) => [c.id, contactName(c)]), cls: 'full' },
      { name: 'absents', label: 'Absents / excusés', cls: 'full' },
      { name: 'notes', label: 'Discussions et décisions', type: 'textarea', rows: 8, cls: 'full' },
      { name: 'pointIds', label: 'Points suivis', type: 'multi', options: sorted.map((x) => [x.id, `N° ${x.number} – ${x.data.title} (${PTS[x.data.status][0]})`]), cls: 'full scroll' },
    ],
    async onSave(v) { const it = mt || { project_id: p.id, data: {} }; it.data = { ...it.data, ...v, pointIds: v.pointIds.map(Number), attendees: v.attendees.map(Number) }; await persist('meeting', it); render(); },
    onDelete: mt ? async () => { await db.del('meeting', mt.id); render(); } : null,
  });
}
async function tabMeetings(p, el) {
  const meetings = (await db.list('meeting', { project: p.id })).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  el.innerHTML = `<div class="toolbar"><span class="grow"></span><button class="btn primary" data-act="new">${I.plus} Nouveau PV</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: meetings, columns: [{ l: 'Réunion', v: (x) => `<b>${esc(x.data.title)}</b>` }, { l: 'Date', v: (x) => fmtDate(x.data.date) }, { l: 'Présents', v: (x) => (x.data.users || []).length + (x.data.attendees || []).length },
      { l: 'Points', v: (x) => (x.data.pointIds || []).length }, { l: '', v: (x) => `<a class="btn sm" href="#/pv/${x.id}">${I.print} PV</a>` }],
    onRow: (x) => editMeeting(p, x), empty: 'Aucun PV de réunion',
  });
  $('[data-act=new]', el).onclick = () => editMeeting(p, null);
}
route('pv', async (id) => {
  const mt = await db.get('meeting', +id);
  const [p, contacts, points, plans] = await Promise.all([db.get('project', mt.project_id), db.list('contact'), db.list('point', { project: mt.project_id }), db.list('plan', { project: mt.project_id })]);
  const d = mt.data;
  const pts = (d.pointIds || []).map((x) => byId(points, x)).filter(Boolean).sort((a, b) => +a.number - +b.number);
  const att = (d.attendees || []).map((x) => byId(contacts, x)).filter(Boolean);
  const html = `<div class="doc">${fieldHead(p, `Procès-verbal – ${d.title}`)}
    <p><b>Date :</b> ${fmtDate(d.date)}${d.location ? ` &nbsp; <b>Lieu :</b> ${esc(d.location)}` : ''}</p>
    <h2>Présents</h2><table class="d-lines"><tr><th>Nom</th><th>Société / rôle</th><th>Contact</th></tr>
      ${(d.users || []).map((u) => { const x = S.users.find((y) => y.id === +u); return x ? `<tr><td>${esc(x.name)}</td><td>${esc(company().name || '')}</td><td>${esc(x.email)}</td></tr>` : ''; }).join('')}
      ${att.map((c) => `<tr><td>${esc([c.data.firstname, c.data.name].filter(Boolean).join(' ') || contactName(c))}</td><td>${esc([c.data.company, CONTACT_KINDS[c.data.kind], c.data.trade].filter(Boolean).join(' · '))}</td><td>${esc([c.data.phone || c.data.mobile, c.data.email].filter(Boolean).join(', '))}</td></tr>`).join('')}</table>
    ${d.absents ? `<p><b>Absents / excusés :</b> ${esc(d.absents)}</p>` : ''}
    ${d.notes ? `<h2>Discussions et décisions</h2><div class="pre">${esc(d.notes)}</div>` : ''}
    <h2>Suivi des points (${pts.length})</h2>${pts.length ? `<table class="d-lines"><tr><th>N°</th><th>Description</th><th>Intervenant</th><th>Statut</th><th>Échéance</th><th>Dernier commentaire</th></tr>${pts.map((x) => { const lc = [...(x.data.history || [])].reverse().find((h) => h.kind === 'comment'); return `<tr><td><b>${esc(x.number)}</b></td><td><b>${esc(x.data.title)}</b>${x.data.desc ? `<br>${esc(x.data.desc)}` : ''}${byId(plans, x.data.planId) ? `<br><small>Plan : ${esc(byId(plans, x.data.planId).data.name)}</small>` : ''}</td><td>${esc(contactName(byId(contacts, x.data.companyId)))}</td><td>${st(PTS, x.data.status)}</td><td>${fmtDate(x.data.due)}</td><td>${lc ? esc(lc.text) : ''}</td></tr>`; }).join('')}</table>` : '<p>—</p>'}
    ${d.next ? `<p><b>Prochaine réunion :</b> ${fmtDate(d.next)}</p>` : ''}
    <p class="muted sm">Sans remarque écrite dans les 8 jours, le présent procès-verbal est considéré comme approuvé.</p>
    <div class="d-sign">${att.slice(0, 6).map((c) => `<div>${esc(contactName(c))}</div>`).join('')}<div>${esc(company().name || '')}</div></div></div>`;
  printPage(`PV – ${d.title}`, html, `#/project/${p.id}/meetings`);
});

// ---------------------------------------------------------------- Formulaires (checklists)
const ANS = { ok: ['Conforme', '#2f9e44'], nok: ['Non conforme', '#e5484d'], na: ['N.A.', '#868e96'] };
const DEF_TPL = [
  ['Réception des travaux', '#Documents\nPV de travaux cachés signés\nFiches techniques et attestations remises\nPlans as-built remis\n#Finitions\nMurs sans fissures, planéité correcte\nSols sans défauts ni carreaux cassés\nMenuiseries fonctionnelles, sans dégâts\nNettoyage final effectué\n#Techniques\nPrises et interrupteurs fonctionnels\nSanitaires sans fuite\nChauffage / ventilation fonctionnels\ntext:Remarques'],
  ['Inspection sécurité chantier', '#Organisation\nClôture et panneau de chantier\nAccès dégagés et balisés\nTrousse de secours et extincteurs\n#EPI\nCasque, gilet et chaussures portés\nHarnais pour travaux en hauteur\nÉchafaudages contrôlés avec garde-corps\n#Risques\nTrémies et bords protégés\nInstallation électrique provisoire conforme\nDéchets triés et évacués\ntext:Mesures décidées'],
  ['Contrôle avant bétonnage', '#Coffrage\nCotes et dimensions conformes aux plans\nCoffrage étanche, propre, huilé\nÉtaiements stables\n#Armatures\nDiamètres et nombre de barres conformes\nEnrobage assuré (distanciers)\nLigatures et recouvrements corrects\n#Divers\nRéservations et inserts en place\nReprise de bétonnage traitée\nClasse de béton commandée correcte\ntext:Centrale à béton / n° bon'],
];
const parseTpl = (text, old = []) => text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
  const kind = s.startsWith('#') ? 'section' : /^text:/i.test(s) ? 'text' : 'check';
  const label = s.replace(/^#\s*/, '').replace(/^text:\s*/i, '');
  const prev = old.find((o) => o.kind === kind && o.label === label);
  return { id: prev ? prev.id : lid(), kind, label };
});
const tplText = (items) => items.map((i) => (i.kind === 'section' ? '#' : i.kind === 'text' ? 'text:' : '') + i.label).join('\n');
async function templates() {
  let list = await db.list('formtpl');
  if (!list.length && !(S.settings.flags || {}).tplSeeded) {
    for (const [name, txt] of DEF_TPL) list.push(await persist('formtpl', { data: { name, items: parseTpl(txt) } }, { silent: true }));
    if (S.me.role === 'admin') { S.settings.flags = { ...(S.settings.flags || {}), tplSeeded: true }; api('PUT', 'settings', { flags: S.settings.flags }).catch(() => {}); }
  }
  return list;
}
function editTemplate(t) {
  formModal({
    title: t ? 'Modèle de formulaire' : 'Nouveau modèle', wide: true, values: t ? { name: t.data.name, items: tplText(t.data.items) } : { items: '#Section\nPoint à contrôler\ntext:Remarques' },
    fields: [{ name: 'name', label: 'Nom', required: true, cls: 'full' }, { name: 'items', label: 'Éléments (un par ligne)', type: 'textarea', rows: 14, required: true, cls: 'full', hint: '« # » = titre de section · « text: » = réponse libre · les autres lignes = Conforme / Non conforme / N.A.' }],
    async onSave(v) { const it = t || { data: {} }; it.data = { name: v.name, items: parseTpl(v.items, t ? t.data.items : []) }; await persist('formtpl', it); render(); },
    onDelete: t ? async () => { await db.del('formtpl', t.id); render(); } : null,
  });
}
const formCounts = (f) => { const c = { ok: 0, nok: 0, na: 0, todo: 0 }; for (const it of f.items) if (it.kind === 'check') c[(f.answers[it.id] || {}).v || 'todo']++; return c; };
async function tabForms(p, el) {
  const [forms, tpls, contacts] = await Promise.all([db.list('form', { project: p.id }), templates(), db.list('contact')]);
  el.innerHTML = `<div class="toolbar"><button class="btn" data-act="tpl">Modèles…</button><span class="grow"></span><button class="btn primary" data-act="new">${I.plus} Nouveau formulaire</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: forms, state: { sort: -3 },
    columns: [{ l: 'Formulaire', v: (f) => `<b>${esc(f.data.name)}</b><br><small class="muted">${esc(f.data.location || '')}</small>` }, { l: 'Intervenant', v: (f) => esc(contactName(byId(contacts, f.data.companyId))) },
      { l: 'Date', v: (f) => fmtDate(f.data.date), sort: (f) => f.data.date }, { l: 'Statut', v: (f) => (f.data.status === 'done' ? badge('Clôturé', '#2f9e44') : badge('En cours', '#f08c00')) },
      { l: 'Résultat', v: (f) => { const c = formCounts(f.data); return `${c.nok ? badge(c.nok + ' NC', '#e5484d') : ''} <small class="muted">${c.ok + c.nok + c.na}/${c.ok + c.nok + c.na + c.todo}</small>`; } },
      { l: '', v: (f) => `<a class="btn sm" href="#/formpdf/${f.id}">${I.print}</a>` }],
    onRow: (f) => openForm(p, f), empty: 'Aucun formulaire',
  });
  $('[data-act=tpl]', el).onclick = () => menuSheet('Modèles de formulaires', [...tpls.map((t) => ({ label: t.data.name, run: () => editTemplate(t) })), { label: '+ Nouveau modèle', primary: true, run: () => editTemplate() }]);
  $('[data-act=new]', el).onclick = () => menuSheet('Choisir un modèle', tpls.map((t) => ({ label: t.data.name, run: async () => {
    const f = await persist('form', { project_id: p.id, data: { name: t.data.name, date: today(), status: 'draft', inspector: S.me.name, items: JSON.parse(JSON.stringify(t.data.items)), answers: {} } });
    openForm(p, f);
  } })));
}
async function openForm(p, f) {
  const contacts = await db.list('contact');
  const d = f.data; d.answers = d.answers || {};
  const save = debounce(() => persist('form', f, { silent: true }).catch((e) => toast('Erreur : ' + e.message)), 700);
  const ans = (id) => d.answers[id] || (d.answers[id] = {});
  let n = 0;
  const m = modal(`${mhead(d.name, `<a class="btn sm" href="#/formpdf/${f.id}">${I.print} PDF</a>`)}<div class="m-body">
    ${fieldsGrid([{ name: 'date', label: 'Date', type: 'date' }, { name: 'location', label: 'Zone / localisation' }, { name: 'companyId', label: 'Intervenant contrôlé', type: 'select', options: [['', '—'], ...contacts.filter((c) => c.data.kind !== 'client').map((c) => [c.id, contactName(c)])] }, { name: 'inspector', label: 'Contrôlé par' }], d)}
    <div class="chips" data-sum></div>
    ${d.items.map((it) => {
      if (it.kind === 'section') return `<div class="section-t">${esc(it.label)}</div>`;
      const a = d.answers[it.id] || {}; n++;
      if (it.kind === 'text') return `<div class="fi"><div class="fi-l"><b>${n}.</b> ${esc(it.label)}</div><textarea data-txt="${it.id}" rows="2">${esc(a.text || '')}</textarea></div>`;
      return `<div class="fi" data-it="${it.id}"><div class="fi-l"><b>${n}.</b> ${esc(it.label)}</div>
        <div class="status-bar sm">${Object.entries(ANS).map(([k, [l, c]]) => `<button type="button" data-a="${k}" style="--c:${c}" class="${a.v === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input data-note placeholder="Observation…" value="${esc(a.note || '')}"><div class="photos sm" data-ph></div>
        <button type="button" class="btn sm" data-pt ${a.v === 'nok' ? '' : 'hidden'}>→ Créer un point de réserve</button></div>`;
    }).join('')}
    <div class="section-t">Signature</div>${fieldsGrid([{ name: 'signer', label: 'Nom du signataire' }], d)}<div data-sig></div>
    <div class="btns"><button class="btn primary" data-done></button><button class="btn danger ghost" data-delf>${I.trash} Supprimer</button></div></div>`, { wide: true, onClose: () => { save.flush(); render(); } });
  ['date', 'location', 'companyId', 'inspector', 'signer'].forEach((k) => { const e = $(`[name=${k}]`, m.el); e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', () => { d[k] = e.value; save(); }); });
  const sum = () => { const c = formCounts(d); $('[data-sum]', m.el).innerHTML = Object.entries(ANS).map(([k, [l, col]]) => `<span class="chip"><i class="dot" style="--c:${col}"></i>${l} : ${c[k]}</span>`).join('') + `<span class="chip">À compléter : ${c.todo}</span>`; $('[data-done]', m.el).textContent = d.status === 'done' ? 'Rouvrir' : 'Clôturer le formulaire'; };
  $$('[data-it]', m.el).forEach((box) => {
    const id = box.dataset.it; const a0 = ans(id); a0.photos = a0.photos || [];
    $$('[data-a]', box).forEach((b) => { b.onclick = () => { const a = ans(id); a.v = a.v === b.dataset.a ? '' : b.dataset.a; $$('[data-a]', box).forEach((x) => x.classList.toggle('on', x.dataset.a === a.v)); $('[data-pt]', box).hidden = a.v !== 'nok'; save(); sum(); }; });
    $('[data-note]', box).oninput = (e) => { ans(id).note = e.target.value; save(); };
    const drawPh = () => {
      const ph = $('[data-ph]', box);
      ph.innerHTML = a0.photos.map((fid, i) => `<div class="ph"><a href="${fileUrl(fid)}" target="_blank"><img src="${fileUrl(fid)}"></a><button type="button" data-rm="${i}">✕</button></div>`).join('') + `<label class="add">${I.camera}<input type="file" accept="image/*" multiple hidden></label>`;
      $('input', ph).onchange = async (e) => { for (const file of e.target.files) { toast('Envoi…', 20000); a0.photos.push((await uploadPhoto(file, p.id)).id); } toast('Photo ajoutée'); save(); drawPh(); };
      $$('[data-rm]', ph).forEach((b) => { b.onclick = () => { delFile(a0.photos[+b.dataset.rm]); a0.photos.splice(+b.dataset.rm, 1); save(); drawPh(); }; });
    };
    drawPh();
    $('[data-pt]', box).onclick = async () => { await save.flush(); const it = d.items.find((x) => x.id === id); editPoint(p, null, { title: it.label, desc: [a0.note, `Formulaire « ${d.name} » du ${fmtDate(d.date)}${d.location ? ', ' + d.location : ''}`].filter(Boolean).join('\n'), companyId: d.companyId, category: 'Réserve', priority: 'high', photos: [...a0.photos] }, () => toast('Point créé')); };
  });
  $$('[data-txt]', m.el).forEach((t) => { t.oninput = () => { ans(t.dataset.txt).text = t.value; save(); }; });
  signaturePad($('[data-sig]', m.el), d.signatureId, p.id, (fid) => { d.signatureId = fid; save(); });
  $('[data-done]', m.el).onclick = () => { const c = formCounts(d); if (d.status !== 'done' && c.todo && !confirm(`${c.todo} élément(s) non complété(s). Clôturer quand même ?`)) return; d.status = d.status === 'done' ? 'draft' : 'done'; save(); sum(); };
  $('[data-delf]', m.el).onclick = async () => { if (!confirm('Supprimer ce formulaire ?')) return; await db.del('form', f.id); save.flush = () => {}; m.close(); };
  sum();
}
function signaturePad(box, current, pid, onSave) {
  const draw = () => {
    if (current) { box.innerHTML = `<div class="sig"><img src="${fileUrl(current)}" alt=""></div><button type="button" class="btn sm" data-re>Signer à nouveau</button>`; $('[data-re]', box).onclick = () => { current = ''; draw(); }; return; }
    box.innerHTML = `<div class="sig"><canvas width="900" height="260"></canvas><span class="sig-hint">Signez ici</span></div><div class="btns"><button type="button" class="btn sm" data-clr>Effacer</button><button type="button" class="btn sm primary" data-ok>Enregistrer la signature</button></div>`;
    const cv = $('canvas', box); const ctx = cv.getContext('2d'); ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let on = false; let dirty = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.style.touchAction = 'none';
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); on = true; dirty = true; $('.sig-hint', box).hidden = true; ctx.beginPath(); ctx.moveTo(...pos(e)); ctx.lineTo(...pos(e)); ctx.stroke(); };
    cv.onpointermove = (e) => { if (on) { ctx.lineTo(...pos(e)); ctx.stroke(); } };
    cv.onpointerup = cv.onpointercancel = () => { on = false; };
    $('[data-clr]', box).onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); dirty = false; $('.sig-hint', box).hidden = false; };
    $('[data-ok]', box).onclick = async () => { if (!dirty) return toast('Signez d\'abord'); const r = await upload(new File([await canvasToBlob(cv, 'image/png')], 'signature.png', { type: 'image/png' }), pid); current = r.id; onSave(r.id); toast('Signature enregistrée'); draw(); };
  };
  draw();
}
route('formpdf', async (id) => {
  const f = await db.get('form', +id);
  const [p, contacts] = await Promise.all([db.get('project', f.project_id), db.list('contact')]);
  const d = f.data; const c = formCounts(d); let n = 0;
  const html = `<div class="doc">${fieldHead(p, d.name)}
    <p><b>Date :</b> ${fmtDate(d.date)}${d.location ? ` · <b>Zone :</b> ${esc(d.location)}` : ''}${d.companyId ? ` · <b>Intervenant :</b> ${esc(contactName(byId(contacts, d.companyId)))}` : ''}${d.inspector ? ` · <b>Contrôlé par :</b> ${esc(d.inspector)}` : ''} · <b>Statut :</b> ${d.status === 'done' ? 'Clôturé' : 'En cours'}</p>
    <table class="d-lines"><tr>${Object.values(ANS).map(([l]) => `<th>${l}</th>`).join('')}<th>Non complétés</th></tr><tr>${Object.keys(ANS).map((k) => `<td>${c[k]}</td>`).join('')}<td>${c.todo}</td></tr></table>
    <table class="d-lines"><thead><tr><th>N°</th><th>Point de contrôle</th><th>Résultat</th><th>Observations</th></tr></thead><tbody>
    ${d.items.map((it) => { if (it.kind === 'section') return `<tr class="sec"><td colspan="4"><b>${esc(it.label)}</b></td></tr>`; n++; const a = d.answers[it.id] || {};
      return `<tr><td>${n}</td><td>${esc(it.label)}</td><td>${it.kind === 'text' ? '' : a.v ? badge(ANS[a.v][0], ANS[a.v][1]) : '—'}</td><td><div class="pre">${esc(it.kind === 'text' ? a.text : a.note)}</div>${(a.photos || []).length ? `<div class="d-photos sm">${a.photos.map((x) => `<img src="${fileUrl(x)}">`).join('')}</div>` : ''}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="d-sign"><div>${d.signatureId ? `<img src="${fileUrl(d.signatureId)}" style="max-height:70px;display:block">` : ''}${esc(d.signer || 'Signature')}</div></div></div>`;
  printPage(d.name, html, `#/project/${p.id}/forms`);
});

// ---------------------------------------------------------------- Journal de chantier
const WEATHER = ['Ensoleillé', 'Partiellement nuageux', 'Nuageux', 'Brouillard', 'Pluie', 'Orage', 'Neige', 'Vent fort', 'Gel'];
async function tabDiary(p, el) {
  const [days, contacts] = await Promise.all([db.list('diary', { project: p.id }), db.list('contact')]);
  days.sort((a, b) => b.data.date.localeCompare(a.data.date));
  const tot = (d) => Object.values(d.data.workforce || {}).reduce((a, x) => a + num(x), 0);
  el.innerHTML = `<div class="toolbar"><label class="field inline"><span>Du</span><input type="date" data-from value="${days.length ? days[days.length - 1].data.date : today()}"></label><label class="field inline"><span>au</span><input type="date" data-to value="${today()}"></label><button class="btn" data-act="pdf">${I.print} Rapport</button><span class="grow"></span><button class="btn primary" data-act="today">${I.plus} Journal du jour</button></div><div id="tbl"></div>`;
  dataTable($('#tbl', el), {
    rows: days, columns: [{ l: 'Date', v: (x) => `<b>${fmtDate(x.data.date)}</b>`, sort: (x) => x.data.date }, { l: 'Météo', v: (x) => esc([x.data.weather, x.data.tMin !== '' && x.data.tMin != null ? `${x.data.tMin}…${x.data.tMax} °C` : ''].filter(Boolean).join(' · ')) },
      { l: 'Effectif', v: (x) => tot(x) }, { l: 'Travaux', v: (x) => esc((x.data.works || '').split('\n')[0]) }, { l: '', v: (x) => (x.data.incidents ? badge('Incident', '#e5484d') : '') + ((x.data.photos || []).length ? ` <small class="muted">${x.data.photos.length} photo(s)</small>` : '') }, { l: 'Rédigé par', v: (x) => avatar(x.created_by) }],
    onRow: (x) => openDiary(p, x, contacts), empty: 'Journal vide',
  });
  $('[data-act=today]', el).onclick = () => openDiary(p, days.find((x) => x.data.date === today()) || null, contacts, days[0]);
  $('[data-act=pdf]', el).onclick = () => go(`#/diarypdf/${p.id}/${$('[data-from]', el).value}/${$('[data-to]', el).value}`);
}
async function openDiary(p, x, contacts, prev) {
  if (!x) x = await persist('diary', { project_id: p.id, data: { date: today(), weather: '', workforce: prev ? { ...prev.data.workforce } : {}, photos: [] } });
  const d = x.data; d.workforce = d.workforce || {}; d.photos = d.photos || [];
  const save = debounce(() => persist('diary', x, { silent: true }).catch((e) => toast('Erreur : ' + e.message)), 700);
  const subs = contacts.filter((c) => c.data.kind === 'soustraitant');
  const m = modal(`${mhead(`Journal du ${fmtDate(d.date)}`)}<div class="m-body">
    ${fieldsGrid([{ name: 'date', label: 'Date', type: 'date' }, { name: 'weather', label: 'Météo', type: 'select', options: [['', '—'], ...WEATHER.map((w) => [w, w])] }, { name: 'tMin', label: 'T° min', type: 'number' }, { name: 'tMax', label: 'T° max', type: 'number' }], d)}
    <button class="btn sm" data-wx>☀ Météo automatique (position actuelle)</button>
    <div class="section-t">Effectif présent</div><div class="wf"><label><span>Notre équipe</span><input data-wf="own" inputmode="numeric" value="${esc(d.workforce.own || '')}"></label>${subs.map((c) => `<label><span>${esc(contactName(c))}</span><input data-wf="${c.id}" inputmode="numeric" value="${esc(d.workforce[c.id] || '')}"></label>`).join('')}</div>
    ${fieldsGrid([{ name: 'works', label: 'Travaux réalisés', type: 'textarea', rows: 4, cls: 'full' }, { name: 'deliveries', label: 'Livraisons / matériel', type: 'textarea', cls: 'full' }, { name: 'visitors', label: 'Visites / instructions', type: 'textarea', cls: 'full' }, { name: 'incidents', label: 'Incidents / retards / problèmes', type: 'textarea', cls: 'full' }], d)}
    <div class="section-t">Photos</div><div class="photos" data-ph></div>
    <div class="btns"><a class="btn" href="#/diarypdf/${p.id}/${d.date}/${d.date}">${I.print} PDF du jour</a><button class="btn danger ghost" data-deld>${I.trash} Supprimer</button></div></div>`, { wide: true, onClose: () => { save.flush(); render(); } });
  ['date', 'weather', 'tMin', 'tMax', 'works', 'deliveries', 'visitors', 'incidents'].forEach((k) => { const e = $(`[name=${k}]`, m.el); e.addEventListener(e.tagName === 'SELECT' ? 'change' : 'input', () => { d[k] = e.value; save(); }); });
  $$('[data-wf]', m.el).forEach((i) => { i.oninput = () => { d.workforce[i.dataset.wf] = i.value; save(); }; });
  const drawPh = () => {
    const box = $('[data-ph]', m.el);
    box.innerHTML = d.photos.map((fid, i) => `<div class="ph"><a href="${fileUrl(fid)}" target="_blank"><img src="${fileUrl(fid)}"></a><button type="button" data-rm="${i}">✕</button></div>`).join('') + `<label class="add">${I.camera}<span>Photo</span><input type="file" accept="image/*" multiple hidden></label>`;
    $('input', box).onchange = async (e) => { for (const f of e.target.files) { toast('Envoi…', 20000); d.photos.push((await uploadPhoto(f, p.id)).id); } toast('Photo ajoutée'); save(); drawPh(); };
    $$('[data-rm]', box).forEach((b) => { b.onclick = () => { delFile(d.photos[+b.dataset.rm]); d.photos.splice(+b.dataset.rm, 1); save(); drawPh(); }; });
  };
  drawPh();
  $('[data-wx]', m.el).onclick = async () => {
    try {
      toast('Récupération de la météo…', 10000);
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 15000 }));
      const r = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.coords.latitude.toFixed(3)}&longitude=${pos.coords.longitude.toFixed(3)}&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${d.date}&end_date=${d.date}`)).json();
      const code = r.daily.weather_code[0];
      d.weather = code === 0 ? 'Ensoleillé' : code <= 2 ? 'Partiellement nuageux' : code === 3 ? 'Nuageux' : code <= 48 ? 'Brouillard' : code <= 67 || (code >= 80 && code <= 82) ? 'Pluie' : code <= 86 ? 'Neige' : 'Orage';
      d.tMin = String(Math.round(r.daily.temperature_2m_min[0])); d.tMax = String(Math.round(r.daily.temperature_2m_max[0]));
      $('[name=weather]', m.el).value = d.weather; $('[name=tMin]', m.el).value = d.tMin; $('[name=tMax]', m.el).value = d.tMax; save(); toast(`${d.weather}, ${d.tMin}…${d.tMax} °C`);
    } catch (e) { toast('Météo indisponible (autorisez la localisation)', 4000); }
  };
  $('[data-deld]', m.el).onclick = async () => { if (!confirm('Supprimer ce jour du journal ?')) return; for (const f of d.photos) await delFile(f); await db.del('diary', x.id); save.flush = () => {}; m.close(); };
}
route('diarypdf', async (pid, from, to) => {
  const [p, days, contacts] = await Promise.all([db.get('project', +pid), db.list('diary', { project: +pid }), db.list('contact')]);
  const list = days.filter((x) => x.data.date >= from && x.data.date <= to).sort((a, b) => a.data.date.localeCompare(b.data.date));
  const html = `<div class="doc">${fieldHead(p, from === to ? `Journal de chantier – ${fmtDate(from)}` : `Journal de chantier ${fmtDate(from)} – ${fmtDate(to)}`)}
    ${list.map((x) => { const d = x.data; const wf = Object.entries(d.workforce || {}).filter(([, v]) => num(v) > 0).map(([k, v]) => [k === 'own' ? (company().name || 'Notre équipe') : contactName(byId(contacts, k)), num(v)]);
      return `<div class="d-sec"><h2>${fmtDate(d.date)} – ${esc(d.weather || 'météo non renseignée')}${d.tMax !== '' && d.tMax != null ? `, ${esc(d.tMin)}…${esc(d.tMax)} °C` : ''}</h2>
        ${wf.length ? `<table class="d-lines"><tr>${wf.map(([n]) => `<th>${esc(n)}</th>`).join('')}<th>Total</th></tr><tr>${wf.map(([, v]) => `<td>${v}</td>`).join('')}<td><b>${wf.reduce((a, [, v]) => a + v, 0)}</b></td></tr></table>` : ''}
        ${[['Travaux réalisés', d.works], ['Livraisons / matériel', d.deliveries], ['Visites / instructions', d.visitors], ['Incidents / problèmes', d.incidents]].filter(([, v]) => v).map(([l, v]) => `<p><b>${l} :</b></p><div class="pre">${esc(v)}</div>`).join('')}
        ${(d.photos || []).length ? `<div class="d-photos">${d.photos.map((f) => `<img src="${fileUrl(f)}">`).join('')}</div>` : ''}<p class="muted sm">Rédigé par ${esc(userName(x.created_by))}</p></div>`; }).join('') || '<p>Aucun jour enregistré sur cette période.</p>'}</div>`;
  printPage('Journal de chantier', html, `#/project/${pid}/diary`);
});

// ---------------------------------------------------------------- Documents
async function tabDocuments(p, el) {
  const docs = await db.list('document', { project: p.id });
  const folders = [...new Set(['Plans', 'Administratif', 'Photos', 'Contrats', 'Fiches techniques', ...docs.map((x) => x.data.folder).filter(Boolean)])];
  const cur = ui['docf_' + p.id] || '';
  const list = docs.filter((x) => !cur || x.data.folder === cur).sort((a, b) => b.id - a.id);
  el.innerHTML = `<div class="toolbar"><div class="chips"><button class="chip ${!cur ? 'on' : ''}" data-f="">Tous (${docs.length})</button>${folders.map((f) => `<button class="chip ${cur === f ? 'on' : ''}" data-f="${esc(f)}">${esc(f)} (${docs.filter((x) => x.data.folder === f).length})</button>`).join('')}</div><span class="grow"></span><button class="btn primary" data-act="up">${I.plus} Ajouter des fichiers</button></div>
    <div class="drop" data-drop>Glissez des fichiers ici</div>
    ${list.length ? `<div class="docs">${list.map((x) => `<div class="doc-card"><a href="${fileUrl(x.data.fileId)}" target="_blank">${/^image\//.test(x.data.mime) ? `<img src="${fileUrl(x.data.fileId)}" alt="" loading="lazy">` : `<span class="doc-ic">${I.file}<b>${esc((x.data.name.split('.').pop() || '').toUpperCase())}</b></span>`}</a>
      <div class="dc-meta"><b title="${esc(x.data.name)}">${esc(x.data.name)}</b><small class="muted">${esc(x.data.folder || '')} · ${fnum((x.data.size || 0) / 1048576, 1)} Mo · ${esc(userName(x.created_by))}</small></div>
      <button class="icon-btn sm" data-doc="${x.id}">${I.more}</button></div>`).join('')}</div>` : empty('Aucun document', 'Ajoutez contrats, permis, fiches techniques, photos…')}`;
  $$('[data-f]', el).forEach((b) => { b.onclick = () => { ui['docf_' + p.id] = b.dataset.f; saveUi(); render(); }; });
  const doUpload = async (files) => {
    if (!files.length) return;
    const v = await ask('Classer dans', [{ name: 'folder', label: 'Dossier', list: 'folders', required: true }], { folder: cur || 'Administratif' });
    if (!v) return;
    let n = 0;
    for (const f of files) {
      try { toast(`Envoi ${++n}/${files.length}…`, 60000); const r = await upload(f, p.id); await persist('document', { project_id: p.id, data: { name: r.name, fileId: r.id, mime: r.mime, size: r.size, folder: v.folder } }, { silent: true }); } catch (e) { toast(`${f.name} : ${e.message}`, 5000); }
    }
    toast('Fichiers ajoutés'); render();
  };
  document.body.insertAdjacentHTML('beforeend', `<datalist id="folders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>`);
  $('[data-act=up]', el).onclick = async () => doUpload(await pickFile('*/*', true));
  const drop = $('[data-drop]', el);
  el.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  el.ondragleave = () => drop.classList.remove('on');
  el.ondrop = (e) => { e.preventDefault(); drop.classList.remove('on'); doUpload([...e.dataTransfer.files]); };
  $$('[data-doc]', el).forEach((b) => {
    const x = docs.find((y) => y.id === +b.dataset.doc);
    b.onclick = () => menuSheet(x.data.name, [
      { label: 'Télécharger', run: () => { location.href = fileUrl(x.data.fileId, true); } },
      { label: 'Renommer / déplacer', run: () => formModal({ title: 'Document', values: x.data, fields: [{ name: 'name', label: 'Nom', required: true }, { name: 'folder', label: 'Dossier', list: 'folders' }], async onSave(v) { Object.assign(x.data, v); await persist('document', x); render(); } }) },
      { label: 'Supprimer', danger: true, run: async () => { if (confirm('Supprimer ce document ?')) { await delFile(x.data.fileId); await db.del('document', x.id); render(); } } },
    ]);
  });
}
