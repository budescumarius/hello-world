'use strict';
/* Șantier – aplicație PWA pentru gestionarea șantierelor: planuri, puncte, fotografii, firme, ședințe, rapoarte.
   Toate datele sunt stocate local pe dispozitiv (IndexedDB). */

// ---------------------------------------------------------------- Constante
const STATUS = {
  open:     { label: 'Deschis',  color: '#e5484d' },
  progress: { label: 'În lucru', color: '#f08c00' },
  done:     { label: 'Rezolvat', color: '#2f9e44' },
  closed:   { label: 'Închis',   color: '#868e96' },
};
const PRIORITY = { low: 'Scăzută', normal: 'Normală', high: 'Ridicată', urgent: 'Urgentă' };
const DEFAULT_CATS = ['Defect', 'Observație', 'Siguranță', 'Calitate', 'Recepție', 'Neconformitate', 'Altele'];

const I = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
};

// ---------------------------------------------------------------- IndexedDB
const STORES = ['projects', 'plans', 'points', 'companies', 'meetings', 'blobs'];
let _db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('santier', 1);
    r.onupgradeneeded = () => {
      STORES.forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = _db.transaction(store, mode);
    let out;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Tranzacție anulată (spațiu insuficient?)'));
  });
}
const db = {
  get: (s, id) => tx(s, 'readonly', (st) => st.get(id)),
  put: (s, o) => tx(s, 'readwrite', (st) => st.put(o)).then(() => o),
  del: (s, id) => tx(s, 'readwrite', (st) => st.delete(id)),
  all: (s) => tx(s, 'readonly', (st) => st.getAll()),
  clear: (s) => tx(s, 'readwrite', (st) => st.clear()),
  async where(s, pid) { return (await db.all(s)).filter((o) => o.projectId === pid); },
};

const urlCache = new Map();
async function blobURL(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const r = await db.get('blobs', id);
  if (!r) return '';
  const u = URL.createObjectURL(r.blob);
  urlCache.set(id, u);
  return u;
}
async function getBlob(id) { const r = await db.get('blobs', id); return r && r.blob; }
async function saveBlob(blob) { const id = uid(); await db.put('blobs', { id, blob }); return id; }
async function delBlob(id) {
  if (!id) return;
  await db.del('blobs', id);
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}

// ---------------------------------------------------------------- Utilitare
const app = document.getElementById('app');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };
const fmtTime = (t) => new Date(t).toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isOverdue = (p) => p.due && p.due < today() && (p.status === 'open' || p.status === 'progress');
const isActive = (p) => p.status === 'open' || p.status === 'progress';

function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

let toastTimer;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function bar({ back, title, sub, right = '' }) {
  return `<header class="bar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Înapoi">${I.back}</a>` : ''}
    <div class="titles"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
    <div class="right">${right}</div>
  </header>`;
}
const empty = (title, text) => `<div class="empty"><h3>${esc(title)}</h3><div>${esc(text)}</div></div>`;

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Imaginea nu poate fi citită'));
    i.src = src;
  });
}
async function blobToImg(blob) {
  const u = URL.createObjectURL(blob);
  try { return await loadImg(u); } finally { URL.revokeObjectURL(u); }
}
function canvasToBlob(c, type = 'image/jpeg', q = 0.88) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Conversie eșuată'))), type, q));
}
async function resizeImage(img, max, type = 'image/jpeg', q = 0.88) {
  const r = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * r);
  c.height = Math.round((img.naturalHeight || img.height) * r);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { blob: await canvasToBlob(c, type, q), w: c.width, h: c.height };
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function dataURLToBlob(d) { return (await fetch(d)).blob(); }

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res([...inp.files]);
    inp.click();
  });
}

// ---------------------------------------------------------------- Sheets / formulare
const openSheets = new Set();
function sheet(html, { full = false, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  let closed = false;
  const api = {
    el: ov.querySelector('.sheet'),
    close() {
      if (closed) return;
      closed = true;
      openSheets.delete(api);
      ov.classList.remove('show');
      setTimeout(() => ov.remove(), 200);
      if (onClose) onClose();
    },
  };
  openSheets.add(api);
  ov.addEventListener('click', (e) => { if (e.target === ov) api.close(); });
  $$('[data-close]', ov).forEach((b) => { b.onclick = () => api.close(); });
  return api;
}
function closeAllSheets() { [...openSheets].forEach((s) => s.close()); }

function actionSheet(title, items) {
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>${esc(title)}</h2><button class="link" data-close>Închide</button></div>
    <div class="actions">${items.map((it, i) => `<button class="btn ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>`);
  $$('[data-i]', s.el).forEach((b) => { b.onclick = () => { s.close(); items[+b.dataset.i].run(); }; });
}

function field(f, val = '') {
  const id = 'f_' + f.name;
  let input;
  if (f.type === 'textarea') input = `<textarea name="${f.name}" id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
  else if (f.type === 'select') input = `<select name="${f.name}" id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else input = `<input name="${f.name}" id="${id}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="${f.list}"` : ''} autocomplete="off">`;
  return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}</label>`;
}

function formSheet({ title, fields, values = {}, onSave, onDelete, extra = '' }) {
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>${esc(title)}</h2><button class="link strong" data-save>Salvează</button></div>
    <form class="sheet-body form">${fields.map((f) => field(f, values[f.name])).join('')}${extra}
    ${onDelete ? '<button type="button" class="btn danger block" data-del>Șterge</button>' : ''}<button type="submit" hidden></button></form>`);
  const form = $('form', s.el);
  const submit = async () => {
    const v = {};
    fields.forEach((f) => { v[f.name] = form.elements[f.name].value.trim(); });
    const missing = fields.find((f) => f.required && !v[f.name]);
    if (missing) { toast(`Completează: ${missing.label}`); form.elements[missing.name].focus(); return; }
    try { await onSave(v); s.close(); } catch (e) { toast('Eroare: ' + e.message); }
  };
  $('[data-save]', s.el).onclick = submit;
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  if (onDelete) $('[data-del]', s.el).onclick = async () => { if (confirm('Sigur vrei să ștergi? Acțiunea nu poate fi anulată.')) { await onDelete(); s.close(); } };
  return s;
}

// ---------------------------------------------------------------- Router
const state = { filters: {}, viewerStatus: new Set(Object.keys(STATUS)) };
let viewerIntent = null;
let printJob = null;
let cleanupView = null;

async function render() {
  closeAllSheets();
  if (cleanupView) { cleanupView(); cleanupView = null; }
  const p = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (p[0] === 'p' && p[1]) {
      const project = await db.get('projects', p[1]);
      if (!project) return go('#/');
      if (p[2] === 'plan' && p[3]) return await viewPlan(project, p[3]);
      if (p[2] === 'print') return await viewPrint(project);
      return await viewProject(project, p[2] || 'plans');
    }
    return await viewProjects();
  } catch (e) {
    console.error(e);
    toast('Eroare: ' + e.message, 4000);
  }
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- Proiecte
async function viewProjects() {
  const projects = (await db.all('projects')).sort((a, b) => b.created - a.created);
  const points = await db.all('points');
  app.innerHTML = `${bar({ title: 'Șantier', sub: 'Proiectele mele', right: `<button class="icon-btn" data-act="menu" aria-label="Meniu">${I.more}</button>` })}
  <main class="content">
    ${projects.length ? `<div class="cards">${projects.map((pr) => {
      const pts = points.filter((x) => x.projectId === pr.id);
      const open = pts.filter(isActive).length;
      const late = pts.filter(isOverdue).length;
      return `<a class="card" href="#/p/${pr.id}/plans">
        <div class="card-title">${esc(pr.name)}</div>
        <div class="muted">${esc([pr.client, pr.address].filter(Boolean).join(' · ') || '—')}</div>
        <div class="chips"><span class="chip">${pts.length} puncte</span>
          ${open ? `<span class="chip"><span class="dot" style="--c:${STATUS.open.color}"></span>${open} active</span>` : ''}
          ${late ? `<span class="chip red">${late} întârziate</span>` : ''}</div>
      </a>`;
    }).join('')}</div>` : empty('Niciun proiect încă', 'Creează primul proiect de șantier pentru a începe. Apoi adaugă planuri (PDF sau imagine) și plasează puncte direct pe ele.')}
  </main>
  <button class="fab" data-act="new">${I.plus}<span>Proiect nou</span></button>`;
  $('[data-act=new]').onclick = () => editProject();
  $('[data-act=menu]').onclick = appMenu;
}

function editProject(pr) {
  formSheet({
    title: pr ? 'Editează proiectul' : 'Proiect nou',
    values: pr || {},
    fields: [
      { name: 'name', label: 'Nume proiect', required: true, placeholder: 'ex. Bloc rezidențial A' },
      { name: 'client', label: 'Beneficiar' },
      { name: 'address', label: 'Adresă șantier' },
      { name: 'manager', label: 'Responsabil / diriginte' },
      { name: 'start', label: 'Data începerii', type: 'date' },
    ],
    async onSave(v) {
      const isNew = !pr;
      const o = Object.assign(pr || { id: uid(), created: Date.now() }, v);
      await db.put('projects', o);
      if (isNew) go(`#/p/${o.id}/plans`); else render();
    },
    onDelete: pr ? async () => { await deleteProject(pr.id); go('#/'); } : null,
  });
}

async function deleteProject(pid) {
  for (const pl of await db.where('plans', pid)) { await delBlob(pl.blobId); await delBlob(pl.thumbId); await db.del('plans', pl.id); }
  for (const pt of await db.where('points', pid)) { for (const b of pt.photos || []) await delBlob(b); await db.del('points', pt.id); }
  for (const c of await db.where('companies', pid)) await db.del('companies', c.id);
  for (const m of await db.where('meetings', pid)) await db.del('meetings', m.id);
  await db.del('projects', pid);
}

function appMenu() {
  actionSheet('Meniu', [
    { label: 'Exportă backup (toate datele)', run: exportBackup },
    { label: 'Importă backup', run: importBackup },
    { label: 'Spațiu de stocare', run: storageInfo },
    { label: 'Cum instalez pe iPhone / iPad', run: installHelp },
  ]);
}

function installHelp() {
  sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Instalare pe iPhone / iPad</h2><button class="link" data-close>Gata</button></div>
  <div class="sheet-body"><ol style="padding-left:20px;line-height:1.7">
    <li>Deschide această pagină în <b>Safari</b>.</li>
    <li>Apasă butonul <b>Partajează</b> (pătratul cu săgeată în sus).</li>
    <li>Alege <b>Adaugă pe ecranul principal</b> („Add to Home Screen”).</li>
    <li>Pornește aplicația din iconița <b>Șantier</b> – funcționează și fără internet.</li>
  </ol>
  <p class="muted">Datele se salvează doar pe acest dispozitiv. Fă periodic un <b>backup</b> din meniu (îl poți salva în Fișiere / iCloud Drive) și importă-l pe alt dispozitiv pentru a muta datele.</p></div>`);
}

async function storageInfo() {
  let txt = 'Informații indisponibile pe acest dispozitiv.';
  if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    txt = `Folosit: ${(e.usage / 1048576).toFixed(1)} MB din ~${(e.quota / 1048576).toFixed(0)} MB disponibili.\nStocare persistentă: ${persisted ? 'da' : 'nu'}`;
  }
  alert(txt);
}

async function exportBackup() {
  toast('Se pregătește backup-ul…', 10000);
  const data = {};
  for (const s of STORES.filter((x) => x !== 'blobs')) data[s] = await db.all(s);
  const blobs = [];
  for (const b of await db.all('blobs')) blobs.push({ id: b.id, data: await blobToDataURL(b.blob) });
  const json = JSON.stringify({ app: 'santier', version: 1, exported: new Date().toISOString(), data, blobs });
  toast('Backup gata');
  await shareOrDownload(new Blob([json], { type: 'application/json' }), `santier-backup-${today()}.json`);
}

async function importBackup() {
  const [file] = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (obj.app !== 'santier' || !obj.data) throw new Error('Fișierul nu este un backup Șantier');
    const mode = confirm('Înlocuiești TOATE datele existente cu cele din backup?\n\nOK = înlocuiește\nAnulează = adaugă/actualizează peste datele existente');
    toast('Se importă…', 20000);
    if (mode) { for (const s of STORES) await db.clear(s); urlCache.clear(); }
    for (const s of Object.keys(obj.data)) if (STORES.includes(s)) for (const o of obj.data[s]) await db.put(s, o);
    for (const b of obj.blobs || []) await db.put('blobs', { id: b.id, blob: await dataURLToBlob(b.data) });
    toast('Backup importat cu succes');
    go('#/');
  } catch (e) {
    toast('Import eșuat: ' + e.message, 4000);
  }
}

// ---------------------------------------------------------------- Proiect (taburi)
const TABS = [['plans', 'Planuri'], ['points', 'Puncte'], ['companies', 'Firme'], ['meetings', 'Ședințe'], ['reports', 'Rapoarte']];

async function viewProject(pr, tab) {
  if (!TABS.some(([k]) => k === tab)) tab = 'plans';
  app.innerHTML = `${bar({ back: '#/', title: pr.name, sub: [pr.client, pr.address].filter(Boolean).join(' · '), right: `<button class="icon-btn" data-act="edit" aria-label="Editează proiectul">${I.edit}</button>` })}
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/p/${pr.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <main class="content" id="tab"></main>`;
  $('[data-act=edit]').onclick = () => editProject(pr);
  const el = $('#tab');
  await ({ plans: tabPlans, points: tabPoints, companies: tabCompanies, meetings: tabMeetings, reports: tabReports })[tab](pr, el);
}

// ---- Planuri
async function tabPlans(pr, el) {
  const plans = (await db.where('plans', pr.id)).sort((a, b) => (a.order ?? a.created) - (b.order ?? b.created));
  const points = await db.where('points', pr.id);
  const thumbs = await Promise.all(plans.map((p) => blobURL(p.thumbId || p.blobId)));
  el.innerHTML = plans.length ? `<div class="plans-grid">${plans.map((p, i) => {
    const pts = points.filter((x) => x.planId === p.id);
    const act = pts.filter(isActive).length;
    return `<div class="plan-card"><a href="#/p/${pr.id}/plan/${p.id}"><img src="${thumbs[i]}" alt="" loading="lazy">
      <div class="meta"><span class="name">${esc(p.name)}</span>${act ? `<span class="chip"><span class="dot" style="--c:${STATUS.open.color}"></span>${act}</span>` : ''}<span class="chip">${pts.length}</span></div></a>
      <button class="icon-btn more" data-plan="${p.id}" aria-label="Opțiuni plan">${I.more}</button></div>`;
  }).join('')}</div>` : empty('Niciun plan', 'Adaugă planuri ale clădirii (PDF – toate paginile – sau fotografii/imagini). Apoi atinge planul pentru a plasa puncte.');
  el.insertAdjacentHTML('beforeend', `<button class="fab" data-act="addplan">${I.plus}<span>Adaugă plan</span></button>`);
  $('[data-act=addplan]', el).onclick = () => addPlans(pr);
  $$('[data-plan]', el).forEach((b) => {
    b.onclick = () => {
      const p = plans.find((x) => x.id === b.dataset.plan);
      formSheet({
        title: 'Plan', values: p,
        fields: [{ name: 'name', label: 'Nume plan', required: true }, { name: 'level', label: 'Nivel / zonă', placeholder: 'ex. Parter, Etaj 1, Fațadă N' }],
        async onSave(v) { Object.assign(p, v); await db.put('plans', p); render(); },
        async onDelete() {
          await delBlob(p.blobId); await delBlob(p.thumbId); await db.del('plans', p.id);
          for (const pt of points.filter((x) => x.planId === p.id)) { pt.planId = null; pt.x = pt.y = null; await db.put('points', pt); }
          render();
        },
      });
    };
  });
}

let pdfjsPromise;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(window.pdfjsLib);
      };
      s.onerror = () => { pdfjsPromise = null; rej(new Error('Biblioteca PDF nu s-a putut încărca (e nevoie de internet la primul import PDF)')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

async function addPlans(pr) {
  const files = await pickFile('image/*,application/pdf,.pdf', true);
  if (!files.length) return;
  let count = 0;
  try {
    for (const f of files) {
      const base = f.name.replace(/\.[^.]+$/, '');
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        toast('Se încarcă PDF-ul…', 30000);
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
        const n = Math.min(doc.numPages, 50);
        for (let i = 1; i <= n; i++) {
          toast(`Se importă pagina ${i} din ${n}…`, 30000);
          const page = await doc.getPage(i);
          const vp1 = page.getViewport({ scale: 1 });
          // max ~3600px pe latura lungă și sub limita de suprafață canvas din iOS
          let scale = 3600 / Math.max(vp1.width, vp1.height);
          scale = Math.min(scale, Math.sqrt(14e6 / (vp1.width * vp1.height)));
          const vp = page.getViewport({ scale });
          const c = document.createElement('canvas');
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
          await savePlan(pr.id, n > 1 ? `${base} – p. ${i}` : base, blob, c.width, c.height);
          c.width = c.height = 0;
          count++;
        }
      } else {
        toast('Se importă imaginea…', 30000);
        const img = await blobToImg(f);
        const r = await resizeImage(img, 4096, 'image/jpeg', 0.9);
        await savePlan(pr.id, base, r.blob, r.w, r.h);
        count++;
      }
    }
    toast(`${count} plan(uri) adăugat(e)`);
  } catch (e) {
    console.error(e);
    toast('Import eșuat: ' + e.message, 5000);
  }
  render();
}

async function savePlan(pid, name, blob, w, h) {
  const img = await blobToImg(blob);
  const th = await resizeImage(img, 480, 'image/jpeg', 0.8);
  const blobId = await saveBlob(blob);
  const thumbId = await saveBlob(th.blob);
  await db.put('plans', { id: uid(), projectId: pid, name, blobId, thumbId, w, h, created: Date.now() });
}

// ---- Puncte (listă)
function pointFilter(pr, plans, companies, points) {
  const f = state.filters[pr.id] || (state.filters[pr.id] = { q: '', status: 'active', company: '', plan: '' });
  return {
    f,
    apply: (list) => list.filter((p) => {
      if (f.status === 'active' && !isActive(p)) return false;
      if (f.status === 'overdue' && !isOverdue(p)) return false;
      if (STATUS[f.status] && p.status !== f.status) return false;
      if (f.company && (p.companyId || '') !== (f.company === '-' ? '' : f.company)) return false;
      if (f.plan && (p.planId || '') !== (f.plan === '-' ? '' : f.plan)) return false;
      if (f.q) {
        const q = f.q.toLowerCase();
        const comp = companies.find((c) => c.id === p.companyId);
        const hay = [p.number, p.title, p.desc, p.category, comp && comp.name].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
  };
}

async function pointRows(points, companies, plans) {
  const thumbs = await Promise.all(points.map((p) => (p.photos && p.photos[0] ? blobURL(p.photos[0]) : '')));
  return points.map((p, i) => {
    const c = companies.find((x) => x.id === p.companyId);
    const pl = plans.find((x) => x.id === p.planId);
    const sub = [STATUS[p.status].label, c && c.name, pl && pl.name, p.category].filter(Boolean).map(esc).join(' · ');
    return `<button class="row" data-pt="${p.id}">
      <span class="num" style="--c:${STATUS[p.status].color}">${p.number}</span>
      <span class="main"><div class="t">${esc(p.title)}</div><div class="s">${sub}${p.due ? ` · <span class="${isOverdue(p) ? 'overdue' : ''}">termen ${fmtDate(p.due)}</span>` : ''}</div></span>
      ${thumbs[i] ? `<img class="thumb" src="${thumbs[i]}" alt="">` : ''}
    </button>`;
  }).join('');
}

async function tabPoints(pr, el) {
  const [points, plans, companies] = await Promise.all([db.where('points', pr.id), db.where('plans', pr.id), db.where('companies', pr.id)]);
  const { f, apply } = pointFilter(pr, plans, companies, points);
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, points.filter((p) => p.status === k).length]));
  const late = points.filter(isOverdue).length;
  el.innerHTML = `
    <div class="summary">
      ${Object.entries(STATUS).map(([k, s]) => `<button class="chip ${f.status === k ? 'on' : ''}" data-st="${k}" style="--c:${s.color}"><span class="dot"></span>${s.label}: ${counts[k]}</button>`).join('')}
      ${late ? `<button class="chip red ${f.status === 'overdue' ? 'on' : ''}" data-st="overdue" style="--c:#d92d20">Întârziate: ${late}</button>` : ''}
    </div>
    <div class="toolbar">
      <input type="search" placeholder="Caută (nr., titlu, firmă…)" value="${esc(f.q)}" data-f="q">
      <select data-f="status">
        <option value="active">Active (deschise + în lucru)</option><option value="">Toate statusurile</option>
        ${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}<option value="overdue">Întârziate</option>
      </select>
      <select data-f="company"><option value="">Toate firmele</option><option value="-">— Nealocate —</option>${companies.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <select data-f="plan"><option value="">Toate planurile</option><option value="-">— Fără plan —</option>${plans.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
    </div>
    <div id="plist"></div>
    <button class="fab" data-act="addpt">${I.plus}<span>Punct nou</span></button>`;
  $$('[data-f]', el).forEach((inp) => {
    inp.value = f[inp.dataset.f];
    inp.addEventListener(inp.tagName === 'INPUT' ? 'input' : 'change', () => { f[inp.dataset.f] = inp.value; drawList(); });
  });
  $$('[data-st]', el).forEach((b) => { b.onclick = () => { f.status = f.status === b.dataset.st ? '' : b.dataset.st; render(); }; });
  $('[data-act=addpt]', el).onclick = () => editPoint({ projectId: pr.id }, { onDone: render });
  async function drawList() {
    const list = apply(points).sort((a, b) => b.number - a.number);
    const box = $('#plist', el);
    box.innerHTML = list.length
      ? `<div class="muted" style="margin:0 4px 8px">${list.length} puncte</div><div class="list">${await pointRows(list, companies, plans)}</div>`
      : empty(points.length ? 'Niciun punct pentru filtrul ales' : 'Niciun punct încă', points.length ? 'Modifică filtrele de mai sus.' : 'Deschide un plan și atinge „+ Punct”, sau adaugă un punct fără plan.');
    $$('[data-pt]', box).forEach((b) => { b.onclick = () => editPoint(points.find((p) => p.id === b.dataset.pt), { onDone: render }); });
  }
  await drawList();
}

// ---- Firme
async function tabCompanies(pr, el) {
  const [companies, points] = await Promise.all([db.where('companies', pr.id), db.where('points', pr.id)]);
  companies.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  el.innerHTML = (companies.length ? `<div class="list">${companies.map((c) => {
    const pts = points.filter((p) => p.companyId === c.id);
    const act = pts.filter(isActive).length;
    return `<button class="row" data-c="${c.id}"><span class="main"><div class="t">${esc(c.name)}</div>
      <div class="s">${[c.trade, c.contact, c.phone, c.email].filter(Boolean).map(esc).join(' · ') || '—'}</div></span>
      <span class="chip">${act} active / ${pts.length}</span></button>`;
  }).join('')}</div>` : empty('Nicio firmă', 'Adaugă firmele și subcontractorii implicați pentru a le aloca puncte și a-i trece în procesele-verbale.'))
    + `<button class="fab" data-act="addc">${I.plus}<span>Firmă nouă</span></button>`;
  const edit = (c) => formSheet({
    title: c ? 'Editează firma' : 'Firmă nouă', values: c || {},
    fields: [
      { name: 'name', label: 'Denumire', required: true },
      { name: 'trade', label: 'Specialitate', placeholder: 'ex. Instalații electrice', list: 'trades' },
      { name: 'contact', label: 'Persoană de contact' },
      { name: 'phone', label: 'Telefon', type: 'tel' },
      { name: 'email', label: 'Email', type: 'email' },
    ],
    extra: `<datalist id="trades">${['Antreprenor general', 'Structură', 'Zidărie', 'Instalații electrice', 'Instalații sanitare', 'HVAC', 'Finisaje', 'Tâmplărie', 'Acoperiș', 'Fațadă', 'Amenajări exterioare', 'Proiectant', 'Beneficiar', 'Diriginte de șantier'].map((t) => `<option value="${t}">`).join('')}</datalist>`,
    async onSave(v) { await db.put('companies', Object.assign(c || { id: uid(), projectId: pr.id, created: Date.now() }, v)); render(); },
    onDelete: c ? async () => {
      await db.del('companies', c.id);
      for (const p of points.filter((x) => x.companyId === c.id)) { p.companyId = ''; await db.put('points', p); }
      render();
    } : null,
  });
  $('[data-act=addc]', el).onclick = () => edit();
  $$('[data-c]', el).forEach((b) => { b.onclick = () => edit(companies.find((c) => c.id === b.dataset.c)); });
}

// ---- Ședințe
async function tabMeetings(pr, el) {
  const meetings = (await db.where('meetings', pr.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  el.innerHTML = (meetings.length ? `<div class="list">${meetings.map((m) => `<button class="row" data-m="${m.id}"><span class="main">
      <div class="t">${esc(m.title)}</div><div class="s">${fmtDate(m.date)}${m.location ? ' · ' + esc(m.location) : ''} · ${(m.pointIds || []).length} puncte · ${(m.attendees || []).length} firme</div></span></button>`).join('')}</div>`
    : empty('Nicio ședință', 'Creează procese-verbale de ședință de șantier cu participanții, notițele și punctele discutate, apoi exportă-le PDF.'))
    + `<button class="fab" data-act="addm">${I.plus}<span>Ședință nouă</span></button>`;
  $('[data-act=addm]', el).onclick = () => editMeeting(pr, null, meetings.length + 1);
  $$('[data-m]', el).forEach((b) => { b.onclick = () => editMeeting(pr, meetings.find((m) => m.id === b.dataset.m)); });
}

async function editMeeting(pr, m, n) {
  const [companies, points] = await Promise.all([db.where('companies', pr.id), db.where('points', pr.id)]);
  const isNew = !m;
  m = m || { id: uid(), projectId: pr.id, created: Date.now(), title: `Ședință de șantier nr. ${n}`, date: today(), location: pr.address || '', attendees: [], extra: '', notes: '', pointIds: points.filter(isActive).map((p) => p.id), next: '' };
  const sorted = [...points].sort((a, b) => (isActive(b) - isActive(a)) || a.number - b.number);
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>${isNew ? 'Ședință nouă' : 'Ședință'}</h2><button class="link strong" data-save>Salvează</button></div>
  <form class="sheet-body form">
    ${field({ name: 'title', label: 'Titlu', required: true }, m.title)}
    <div class="row2">${field({ name: 'date', label: 'Data', type: 'date' }, m.date)}${field({ name: 'next', label: 'Următoarea ședință', type: 'date' }, m.next)}</div>
    ${field({ name: 'location', label: 'Locație' }, m.location)}
    <div class="field"><span>Firme participante</span>${companies.length ? `<div class="checks">${companies.map((c) => `<label><input type="checkbox" name="att" value="${c.id}" ${m.attendees.includes(c.id) ? 'checked' : ''}><span>${esc(c.name)}${c.contact ? ` <span class="muted">(${esc(c.contact)})</span>` : ''}</span></label>`).join('')}</div>` : '<div class="muted">Adaugă firme în tabul „Firme”.</div>'}</div>
    ${field({ name: 'extra', label: 'Alți participanți (nume, funcție)', type: 'textarea', rows: 2 }, m.extra)}
    ${field({ name: 'notes', label: 'Discuții / decizii', type: 'textarea', rows: 6 }, m.notes)}
    <div class="field"><span>Puncte discutate</span>${sorted.length ? `<div class="checks">${sorted.map((p) => `<label><input type="checkbox" name="pts" value="${p.id}" ${m.pointIds.includes(p.id) ? 'checked' : ''}><span class="num" style="--c:${STATUS[p.status].color};min-width:30px;height:26px">${p.number}</span><span>${esc(p.title)}</span></label>`).join('')}</div>` : '<div class="muted">Nu există puncte în proiect.</div>'}</div>
    <div class="btns"><button type="button" class="btn primary" data-pv>${I.print} Proces-verbal PDF</button>${!isNew ? '<button type="button" class="btn danger" data-del>Șterge</button>' : ''}</div>
  </form>`, { full: true });
  const form = $('form', s.el);
  const collect = () => {
    const v = form.elements;
    Object.assign(m, {
      title: v.title.value.trim() || 'Ședință', date: v.date.value, next: v.next.value, location: v.location.value.trim(),
      extra: v.extra.value.trim(), notes: v.notes.value,
      attendees: $$('input[name=att]:checked', form).map((x) => x.value), pointIds: $$('input[name=pts]:checked', form).map((x) => x.value),
    });
  };
  $('[data-save]', s.el).onclick = async () => { collect(); await db.put('meetings', m); s.close(); render(); };
  $('[data-pv]', s.el).onclick = async () => {
    collect(); await db.put('meetings', m);
    printJob = { type: 'meeting', meetingId: m.id, back: `#/p/${pr.id}/meetings` };
    go(`#/p/${pr.id}/print`);
  };
  const del = $('[data-del]', s.el);
  if (del) del.onclick = async () => { if (confirm('Ștergi această ședință?')) { await db.del('meetings', m.id); s.close(); render(); } };
}

// ---- Rapoarte
async function tabReports(pr, el) {
  const [plans, companies, points] = await Promise.all([db.where('plans', pr.id), db.where('companies', pr.id), db.where('points', pr.id)]);
  el.innerHTML = `<div class="card form">
    <div class="card-title">Raport de puncte (PDF)</div>
    ${field({ name: 'title', label: 'Titlu raport' }, 'Raport puncte de șantier')}
    <div class="field"><span>Statusuri incluse</span><div class="inline-checks">${Object.entries(STATUS).map(([k, s]) => `<label><input type="checkbox" name="st" value="${k}" ${k !== 'closed' ? 'checked' : ''}><span class="dot" style="--c:${s.color}"></span>${s.label}</label>`).join('')}</div></div>
    <div class="row2">
      ${field({ name: 'company', label: 'Firmă', type: 'select', options: [['', 'Toate firmele'], ...companies.map((c) => [c.id, c.name])] })}
      ${field({ name: 'plan', label: 'Plan', type: 'select', options: [['', 'Toate planurile'], ...plans.map((p) => [p.id, p.name])] })}
    </div>
    <div class="field"><span>Conținut</span><div class="inline-checks">
      <label><input type="checkbox" name="optPlans" checked>Planuri cu poziția punctelor</label>
      <label><input type="checkbox" name="optCrop" checked>Extras de plan la fiecare punct</label>
      <label><input type="checkbox" name="optPhotos" checked>Fotografii</label>
      <label><input type="checkbox" name="optHist">Istoric / comentarii</label>
      <label><input type="checkbox" name="optOverdue">Doar întârziate</label>
    </div></div>
    <div class="btns"><button class="btn primary" data-act="pdf">${I.print} Generează raport PDF</button><button class="btn" data-act="csv">Export Excel (CSV)</button></div>
    <div class="muted">Pe iPhone/iPad: în ecranul de raport apasă „PDF”, apoi în meniul de tipărire folosește Partajează → Salvează în Fișiere sau trimite pe email/WhatsApp.</div>
  </div>
  <div class="section-title">Statistici pe firme</div>
  ${companies.length ? `<div class="list">${companies.map((c) => {
    const pts = points.filter((p) => p.companyId === c.id);
    return `<div class="row" style="cursor:default"><span class="main"><div class="t">${esc(c.name)}</div><div class="s">${Object.entries(STATUS).map(([k, s]) => `${s.label}: ${pts.filter((p) => p.status === k).length}`).join(' · ')} · Întârziate: ${pts.filter(isOverdue).length}</div></span></div>`;
  }).join('')}</div>` : '<div class="muted" style="margin:0 4px">Nu există firme.</div>'}`;
  const opts = () => ({
    title: $('[name=title]', el).value.trim() || 'Raport',
    statuses: $$('input[name=st]:checked', el).map((x) => x.value),
    company: $('[name=company]', el).value, plan: $('[name=plan]', el).value,
    plans: $('[name=optPlans]', el).checked, crop: $('[name=optCrop]', el).checked,
    photos: $('[name=optPhotos]', el).checked, hist: $('[name=optHist]', el).checked, overdue: $('[name=optOverdue]', el).checked,
  });
  $('[data-act=pdf]', el).onclick = () => { printJob = { type: 'report', opts: opts(), back: `#/p/${pr.id}/reports` }; go(`#/p/${pr.id}/print`); };
  $('[data-act=csv]', el).onclick = () => {
    const o = opts();
    const list = filterReport(points, o).sort((a, b) => a.number - b.number);
    const rows = [['Nr', 'Titlu', 'Descriere', 'Status', 'Prioritate', 'Categorie', 'Firmă', 'Plan', 'Termen', 'Creat', 'Actualizat']];
    for (const p of list) {
      rows.push([p.number, p.title, p.desc, STATUS[p.status].label, PRIORITY[p.priority] || '', p.category,
        (companies.find((c) => c.id === p.companyId) || {}).name || '', (plans.find((x) => x.id === p.planId) || {}).name || '',
        fmtDate(p.due), fmtTime(p.created), fmtTime(p.updated)]);
    }
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    shareOrDownload(new Blob([csv], { type: 'text/csv' }), `${pr.name.replace(/[^\w\- ]+/g, '')}-puncte-${today()}.csv`);
  };
}

function filterReport(points, o) {
  return points.filter((p) => o.statuses.includes(p.status) && (!o.company || p.companyId === o.company) && (!o.plan || p.planId === o.plan) && (!o.overdue || isOverdue(p)));
}

// ---------------------------------------------------------------- Editor punct
async function editPoint(pt, { onDone } = {}) {
  const isNew = !pt.id;
  const pid = pt.projectId;
  const [companies, plans, allPts] = await Promise.all([db.where('companies', pid), db.where('plans', pid), db.where('points', pid)]);
  const d = Object.assign({ title: '', desc: '', status: 'open', priority: 'normal', category: '', companyId: '', due: '', photos: [], history: [], planId: null, x: null, y: null }, structuredClone(pt));
  const origStatus = d.status;
  const added = []; const removed = [];
  let saved = false;
  const cats = [...new Set([...DEFAULT_CATS, ...allPts.map((p) => p.category).filter(Boolean)])];
  companies.sort((a, b) => a.name.localeCompare(b.name, 'ro'));

  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>${isNew ? 'Punct nou' : 'Punctul #' + d.number}</h2><button class="link strong" data-save>Salvează</button></div>
  <form class="sheet-body form" autocomplete="off">
    ${field({ name: 'title', label: 'Titlu', required: true, placeholder: 'ex. Fisură perete casa scării' }, d.title)}
    <div class="field"><span>Status</span><div class="seg">${Object.entries(STATUS).map(([k, v]) => `<button type="button" data-status="${k}" style="--c:${v.color}" class="${d.status === k ? 'on' : ''}">${v.label}</button>`).join('')}</div></div>
    ${field({ name: 'desc', label: 'Descriere', type: 'textarea', rows: 3, placeholder: 'Detalii, cerințe de remediere…' }, d.desc)}
    <div class="row2">
      ${field({ name: 'companyId', label: 'Firmă responsabilă', type: 'select', options: [['', '— nealocat —'], ...companies.map((c) => [c.id, c.name])] }, d.companyId)}
      ${field({ name: 'due', label: 'Termen', type: 'date' }, d.due)}
    </div>
    <div class="row2">
      ${field({ name: 'priority', label: 'Prioritate', type: 'select', options: Object.entries(PRIORITY) }, d.priority)}
      ${field({ name: 'category', label: 'Categorie', list: 'cats' }, d.category)}
    </div>
    <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="field"><span>Fotografii</span><div class="photos" id="photos"></div></div>
    <div class="field"><span>Localizare pe plan</span>
      ${plans.length ? `<select name="planId"><option value="">— fără plan —</option>${plans.map((p) => `<option value="${p.id}" ${p.id === d.planId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div id="mini"></div>
      <div class="btns"><button type="button" class="btn small" data-place>Plasează / mută pe plan</button><button type="button" class="btn small" data-show>Vezi pe plan</button></div>`
        : '<div class="muted">Nu există planuri în proiect.</div>'}
    </div>
    <div class="field"><span>Istoric și comentarii</span><div class="history" id="hist"></div>
      <div class="comment-row"><input type="text" id="cmt" placeholder="Adaugă un comentariu…" enterkeyhint="send"><button type="button" class="btn small" data-cmt>Adaugă</button></div></div>
    ${!isNew ? `<div class="muted">Creat: ${fmtTime(d.created)} · Actualizat: ${fmtTime(d.updated)}</div><button type="button" class="btn danger block" data-del>Șterge punctul</button>` : ''}
  </form>`, { full: true, onClose: () => { if (!saved) added.forEach(delBlob); } });
  const form = $('form', s.el);
  form.onsubmit = (e) => e.preventDefault();

  $$('[data-status]', form).forEach((b) => {
    b.onclick = () => { d.status = b.dataset.status; $$('[data-status]', form).forEach((x) => x.classList.toggle('on', x === b)); };
  });

  async function drawPhotos() {
    const box = $('#photos', form);
    const urls = await Promise.all(d.photos.map(blobURL));
    box.innerHTML = urls.map((u, i) => `<img src="${u}" data-ph="${i}" alt="Foto ${i + 1}">`).join('')
      + `<label class="add">${I.camera}<span>Adaugă</span><input type="file" accept="image/*" multiple></label>`;
    $('input', box).onchange = async (e) => {
      const files = [...e.target.files];
      for (const f of files) {
        try {
          const img = await blobToImg(f);
          const r = await resizeImage(img, 1800, 'image/jpeg', 0.85);
          const id = await saveBlob(r.blob);
          added.push(id); d.photos.push(id);
        } catch (err) { toast(err.message); }
      }
      drawPhotos();
    };
    $$('[data-ph]', box).forEach((im) => {
      im.onclick = () => {
        const i = +im.dataset.ph;
        photoViewer(d.photos[i], {
          onDelete() { removePhoto(d.photos[i]); d.photos.splice(i, 1); drawPhotos(); },
          onReplace(newId) { added.push(newId); removePhoto(d.photos[i]); d.photos[i] = newId; drawPhotos(); },
        });
      };
    });
  }
  function removePhoto(id) {
    const ai = added.indexOf(id);
    if (ai >= 0) { added.splice(ai, 1); delBlob(id); } else removed.push(id);
  }

  function drawHist() {
    $('#hist', form).innerHTML = d.history.length
      ? [...d.history].reverse().map((h) => `<div class="h ${h.kind !== 'comment' ? 'sys' : ''}"><small>${fmtTime(h.t)}</small>${esc(h.text)}</div>`).join('')
      : '<div class="muted">Niciun comentariu.</div>';
  }
  const addComment = () => {
    const inp = $('#cmt', form);
    const t = inp.value.trim();
    if (!t) return;
    d.history.push({ t: Date.now(), kind: 'comment', text: t });
    inp.value = '';
    drawHist();
  };
  $('[data-cmt]', form).onclick = addComment;
  $('#cmt', form).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addComment(); } };

  async function drawMini() {
    const box = $('#mini', form);
    if (!box) return;
    const pl = plans.find((p) => p.id === d.planId);
    if (!pl || d.x == null) { box.innerHTML = pl ? '<div class="muted">Punctul nu are încă o poziție pe acest plan.</div>' : ''; return; }
    const u = await cropPlan(pl, { ...d, number: d.number || '•' }, 600, 300);
    box.innerHTML = u ? `<div class="mini-plan" data-show><img src="${u}" alt="Poziție pe plan"></div>` : '';
    const m = $('[data-show]', box);
    if (m) m.onclick = showOnPlan;
  }

  function collect() {
    const v = form.elements;
    d.title = v.title.value.trim();
    d.desc = v.desc.value.trim();
    d.companyId = v.companyId.value;
    d.due = v.due.value;
    d.priority = v.priority.value;
    d.category = v.category.value.trim();
    if (v.planId) {
      const np = v.planId.value || null;
      if (np !== d.planId) { d.planId = np; d.x = d.y = null; }
    }
  }
  async function save({ silent } = {}) {
    collect();
    if (!d.title) { toast('Completează titlul punctului'); form.elements.title.focus(); return false; }
    const now = Date.now();
    if (isNew && !d.id) {
      d.id = uid();
      d.created = now;
      const fresh = await db.where('points', pid);
      d.number = fresh.reduce((m, p) => Math.max(m, p.number || 0), 0) + 1;
      d.history.unshift({ t: now, kind: 'sys', text: 'Punct creat' });
    }
    if (d.status !== origStatus && !isNew) d.history.push({ t: now, kind: 'sys', text: `Status: ${STATUS[origStatus].label} → ${STATUS[d.status].label}` });
    d.updated = now;
    await db.put('points', d);
    for (const id of removed) await delBlob(id);
    saved = true;
    if (!silent) toast(isNew ? `Punctul #${d.number} a fost creat` : 'Salvat');
    return true;
  }
  $('[data-save]', s.el).onclick = async () => { if (await save()) { s.close(); onDone && onDone(); } };

  async function showOnPlan() {
    collect();
    if (!d.planId || d.x == null) return toast('Punctul nu e plasat pe un plan');
    if (!(await save({ silent: true }))) return;
    viewerIntent = { highlight: d.id };
    s.close();
    go(`#/p/${pid}/plan/${d.planId}`);
  }
  const place = $('[data-place]', form);
  if (place) {
    place.onclick = async () => {
      collect();
      if (!d.planId) return toast('Alege mai întâi planul');
      if (!(await save({ silent: true }))) return;
      viewerIntent = { move: d.id };
      s.close();
      go(`#/p/${pid}/plan/${d.planId}`);
    };
    $('[data-show]', form).onclick = showOnPlan;
    form.elements.planId.onchange = () => { collect(); drawMini(); };
  }
  const del = $('[data-del]', form);
  if (del) {
    del.onclick = async () => {
      if (!confirm(`Ștergi punctul #${d.number}?`)) return;
      for (const id of [...d.photos, ...removed]) await delBlob(id);
      added.length = 0;
      await db.del('points', d.id);
      for (const m of await db.where('meetings', pid)) {
        if ((m.pointIds || []).includes(d.id)) { m.pointIds = m.pointIds.filter((x) => x !== d.id); await db.put('meetings', m); }
      }
      saved = true;
      s.close();
      onDone && onDone();
    };
  }

  drawPhotos(); drawHist(); drawMini();
  if (isNew) setTimeout(() => form.elements.title.focus(), 250);
}

// ---------------------------------------------------------------- Vizualizare foto + adnotare
function photoViewer(blobId, { onDelete, onReplace }) {
  const ov = document.createElement('div');
  ov.className = 'photo-view';
  document.body.appendChild(ov);
  const close = () => ov.remove();

  async function showView() {
    const u = await blobURL(blobId);
    ov.innerHTML = `<div class="ptools"><button class="btn" data-x>Închide</button><div class="btns"><button class="btn" data-ann>${I.edit} Adnotează</button><button class="btn danger" data-del>Șterge</button></div></div>
      <div class="stage"><img src="${u}" alt=""></div>`;
    $('[data-x]', ov).onclick = close;
    $('[data-del]', ov).onclick = () => { if (confirm('Ștergi fotografia?')) { onDelete(); close(); } };
    $('[data-ann]', ov).onclick = annotate;
  }

  async function annotate() {
    const img = await blobToImg(await getBlob(blobId));
    ov.innerHTML = `<div class="ptools"><button class="btn" data-cancel>Renunță</button>
      <div class="colors">${['#ff2d2d', '#ffd400', '#00d26a', '#2d8cff', '#ffffff'].map((c, i) => `<button style="--c:${c}" data-c="${c}" class="${i === 0 ? 'on' : ''}" aria-label="Culoare"></button>`).join('')}</div>
      <button class="btn" data-ok>Salvează</button></div>
      <div class="stage"><canvas></canvas></div>
      <div class="ptools bottom"><button class="btn" data-undo>Anulează ultima linie</button><button class="btn" data-clear>Șterge tot</button></div>`;
    const cv = $('canvas', ov);
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext('2d');
    const strokes = [];
    let color = '#ff2d2d';
    let cur = null;
    const lw = Math.max(4, Math.round(cv.width / 180));
    const redraw = () => {
      ctx.drawImage(img, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const st of strokes) {
        ctx.strokeStyle = st.c; ctx.lineWidth = lw;
        ctx.beginPath();
        st.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (st.p.length === 1) ctx.lineTo(st.p[0][0] + 0.1, st.p[0][1]);
        ctx.stroke();
      }
    };
    redraw();
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.style.touchAction = 'none';
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); cur = { c: color, p: [pos(e)] }; strokes.push(cur); redraw(); };
    cv.onpointermove = (e) => { if (!cur) return; cur.p.push(pos(e)); redraw(); };
    cv.onpointerup = cv.onpointercancel = () => { cur = null; };
    $$('[data-c]', ov).forEach((b) => { b.onclick = () => { color = b.dataset.c; $$('[data-c]', ov).forEach((x) => x.classList.toggle('on', x === b)); }; });
    $('[data-undo]', ov).onclick = () => { strokes.pop(); redraw(); };
    $('[data-clear]', ov).onclick = () => { strokes.length = 0; redraw(); };
    $('[data-cancel]', ov).onclick = showView;
    $('[data-ok]', ov).onclick = async () => {
      if (!strokes.length) return showView();
      const id = await saveBlob(await canvasToBlob(cv, 'image/jpeg', 0.88));
      onReplace(id);
      blobId = id;
      showView();
    };
  }
  showView();
}

// ---------------------------------------------------------------- Vizualizare plan (pan/zoom + puncte)
const PIN_SVG = (c) => `<svg viewBox="0 0 34 44"><path d="M17 1C8.2 1 1 8 1 16.6 1 28.4 17 43 17 43s16-14.6 16-26.4C33 8 25.8 1 17 1z" fill="${c}" stroke="#fff" stroke-width="2"/></svg>`;

async function viewPlan(pr, planId) {
  const plan = await db.get('plans', planId);
  if (!plan) return go(`#/p/${pr.id}/plans`);
  const [src, companies] = await Promise.all([blobURL(plan.blobId), db.where('companies', pr.id)]);
  let points = (await db.where('points', pr.id)).filter((p) => p.planId === plan.id);
  const intent = viewerIntent; viewerIntent = null;
  let mode = intent && intent.move ? 'move' : 'view';
  let moveId = intent && intent.move;

  app.innerHTML = `<div class="viewer-wrap">
    ${bar({ back: `#/p/${pr.id}/plans`, title: plan.name, sub: pr.name, right: `<button class="icon-btn" data-act="filter" aria-label="Filtru">${I.filter}</button>` })}
    <div class="viewer" id="vp">
      <div class="plan-inner" id="inner" style="width:${plan.w}px;height:${plan.h}px"><img src="${src}" alt="" draggable="false"><div id="pins"></div></div>
      <div class="banner" id="banner" hidden></div>
      <div class="viewer-tools">
        <button class="icon-btn" data-z="in" aria-label="Mărește">${I.plus}</button>
        <button class="icon-btn" data-z="out" aria-label="Micșorează">${I.minus}</button>
        <button class="icon-btn" data-z="fit" aria-label="Încadrează">${I.fit}</button>
      </div>
    </div>
    <button class="fab" id="addbtn">${I.plus}<span>Punct</span></button>
  </div>`;

  const vp = $('#vp'); const inner = $('#inner'); const pinsEl = $('#pins'); const banner = $('#banner'); const addBtn = $('#addbtn');
  let scale = 1, tx = 0, ty = 0, minS = 0.1, maxS = 8;

  const apply = () => {
    inner.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    inner.style.setProperty('--inv', 1 / scale);
  };
  const fit = () => {
    const r = vp.getBoundingClientRect();
    const s = Math.min(r.width / plan.w, r.height / plan.h) * 0.96;
    minS = s * 0.5; maxS = Math.max(s * 16, 3);
    scale = s; tx = (r.width - plan.w * s) / 2; ty = (r.height - plan.h * s) / 2;
    apply();
  };
  const zoomAt = (cx, cy, ns) => {
    ns = Math.min(maxS, Math.max(minS, ns));
    tx = cx - (cx - tx) * ns / scale; ty = cy - (cy - ty) * ns / scale; scale = ns;
    apply();
  };
  const center = (x, y, ns) => {
    const r = vp.getBoundingClientRect();
    scale = Math.min(maxS, Math.max(minS, ns));
    tx = r.width / 2 - x * plan.w * scale; ty = r.height / 2 - y * plan.h * scale;
    apply();
  };

  function drawPins(hl) {
    pinsEl.innerHTML = points.filter((p) => p.x != null && state.viewerStatus.has(p.status)).sort((a, b) => a.y - b.y)
      .map((p) => `<div class="pin ${p.id === hl ? 'hl' : ''}" data-id="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%">${PIN_SVG(STATUS[p.status].color)}<span>${p.number}</span></div>`).join('');
  }
  function setMode(m) {
    mode = m;
    vp.classList.toggle('adding', m !== 'view');
    addBtn.classList.toggle('on', m === 'add');
    $('span', addBtn).textContent = m === 'add' ? 'Anulează' : 'Punct';
    if (m === 'view') { banner.hidden = true; return; }
    const mp = points.find((p) => p.id === moveId);
    banner.hidden = false;
    banner.innerHTML = `<span>${m === 'add' ? 'Atinge planul unde vrei punctul nou' : `Atinge planul pentru a plasa punctul #${mp ? mp.number : ''}`}</span><button data-cancel>Renunță</button>`;
    $('[data-cancel]', banner).onclick = () => setMode('view');
  }
  const reload = async (hl) => { points = (await db.where('points', pr.id)).filter((p) => p.planId === plan.id); drawPins(hl); };

  async function onTap(e, target) {
    const pinEl = target && target.closest && target.closest('.pin');
    const r = inner.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    if (mode === 'add' && inside) {
      setMode('view');
      editPoint({ projectId: pr.id, planId: plan.id, x, y }, { onDone: () => reload() });
    } else if (mode === 'move' && inside) {
      const p = (await db.get('points', moveId));
      if (p) {
        Object.assign(p, { planId: plan.id, x, y, updated: Date.now() });
        await db.put('points', p);
        toast(`Punctul #${p.number} a fost plasat`);
      }
      setMode('view');
      reload(moveId);
    } else if (mode === 'view' && pinEl) {
      const p = points.find((q) => q.id === pinEl.dataset.id);
      if (p) editPoint(p, { onDone: () => reload() });
    }
  }

  // Gesturi: un deget = deplasare, două degete = zoom, atingere scurtă = acțiune
  const ptrs = new Map();
  let g = null;
  const rel = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchInfo = () => {
    const [a, b] = [...ptrs.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.viewer-tools, .banner')) return;
    vp.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, rel(e));
    if (ptrs.size === 1) {
      const p = rel(e);
      g = { kind: 'pan', sx: p.x, sy: p.y, tx, ty, t: Date.now(), moved: false, target: e.target };
    } else if (ptrs.size === 2) {
      const pi = pinchInfo();
      g = { kind: 'pinch', d0: pi.d, s0: scale, cx: (pi.mx - tx) / scale, cy: (pi.my - ty) / scale, moved: true };
    }
  });
  vp.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !g) return;
    ptrs.set(e.pointerId, rel(e));
    if (g.kind === 'pan' && ptrs.size === 1) {
      const p = rel(e);
      const dx = p.x - g.sx, dy = p.y - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true;
      if (g.moved) { tx = g.tx + dx; ty = g.ty + dy; apply(); }
    } else if (g.kind === 'pinch' && ptrs.size >= 2) {
      const pi = pinchInfo();
      scale = Math.min(maxS, Math.max(minS, g.s0 * pi.d / g.d0));
      tx = pi.mx - g.cx * scale; ty = pi.my - g.cy * scale;
      apply();
    }
  });
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (g && g.kind === 'pan' && !g.moved && e.type === 'pointerup' && Date.now() - g.t < 600) onTap(e, g.target);
    if (ptrs.size === 1) {
      const p = [...ptrs.values()][0];
      g = { kind: 'pan', sx: p.x, sy: p.y, tx, ty, t: 0, moved: true };
    } else if (ptrs.size === 0) g = null;
  };
  vp.addEventListener('pointerup', end);
  vp.addEventListener('pointercancel', end);
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = rel(e);
    zoomAt(p.x, p.y, scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
  }, { passive: false });
  let lastTap = 0;
  vp.addEventListener('dblclick', (e) => { const p = rel(e); zoomAt(p.x, p.y, scale * 2); });
  vp.addEventListener('touchend', (e) => {
    // dublă atingere = zoom (iOS nu trimite dblclick cu touch-action:none)
    if (e.changedTouches.length !== 1 || mode !== 'view') return;
    const now = Date.now();
    if (now - lastTap < 300) { const t = e.changedTouches[0]; const p = rel(t); zoomAt(p.x, p.y, scale * 2); lastTap = 0; } else lastTap = now;
  });

  $$('[data-z]', vp).forEach((b) => {
    b.onclick = () => {
      const r = vp.getBoundingClientRect();
      if (b.dataset.z === 'fit') fit(); else zoomAt(r.width / 2, r.height / 2, scale * (b.dataset.z === 'in' ? 1.6 : 1 / 1.6));
    };
  });
  addBtn.onclick = () => { moveId = null; setMode(mode === 'add' ? 'view' : 'add'); };
  $('[data-act=filter]').onclick = () => {
    const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Afișează pe plan</h2><button class="link" data-close>Gata</button></div>
      <div class="sheet-body"><div class="checks">${Object.entries(STATUS).map(([k, v]) => `<label><input type="checkbox" value="${k}" ${state.viewerStatus.has(k) ? 'checked' : ''}><span class="dot" style="--c:${v.color}"></span>${v.label} (${points.filter((p) => p.status === k && p.x != null).length})</label>`).join('')}</div>
      <div class="section-title">Firme</div><div class="muted">${companies.map((c) => `${esc(c.name)}: ${points.filter((p) => p.companyId === c.id && isActive(p)).length} active`).join('<br>') || '—'}</div></div>`);
    $$('input', s.el).forEach((i) => { i.onchange = () => { if (i.checked) state.viewerStatus.add(i.value); else state.viewerStatus.delete(i.value); drawPins(); }; });
  };

  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  const noGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart', noGesture);
  cleanupView = () => { window.removeEventListener('resize', onResize); document.removeEventListener('gesturestart', noGesture); };

  fit();
  drawPins(intent && intent.highlight);
  if (intent && intent.highlight) {
    const p = points.find((q) => q.id === intent.highlight);
    if (p && p.x != null) center(p.x, p.y, scale * 3);
  }
  setMode(mode);
}

// ---------------------------------------------------------------- Imagini pentru rapoarte
const planImgCache = new Map();
async function planImage(plan) {
  if (!planImgCache.has(plan.id)) planImgCache.set(plan.id, getBlob(plan.blobId).then((b) => blobToImg(b)));
  return planImgCache.get(plan.id);
}
function drawPin(ctx, x, y, r, color, label) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - r * 0.4, y - r * 0.9, x - r, y - r * 1.3, x - r, y - r * 1.9);
  ctx.arc(x, y - r * 1.9, r, Math.PI, 0);
  ctx.bezierCurveTo(x + r, y - r * 1.3, x + r * 0.4, y - r * 0.9, x, y);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = Math.max(1.5, r / 7); ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(r * (String(label).length > 2 ? 0.8 : 1.05))}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y - r * 1.9);
  ctx.restore();
}
async function planWithPins(plan, pts, maxW = 2000) {
  const img = await planImage(plan);
  const k = Math.min(1, maxW / plan.w);
  const c = document.createElement('canvas');
  c.width = Math.round(plan.w * k); c.height = Math.round(plan.h * k);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const r = Math.max(10, Math.min(c.width, c.height) / 55);
  [...pts].sort((a, b) => a.y - b.y).forEach((p) => drawPin(ctx, p.x * c.width, p.y * c.height, r, STATUS[p.status].color, p.number));
  return c.toDataURL('image/jpeg', 0.85);
}
async function cropPlan(plan, p, outW = 300, outH = 300) {
  if (p.x == null) return '';
  const img = await planImage(plan);
  const span = Math.min(plan.w, plan.h) * 0.22; // zona vizibilă în jurul punctului
  const sw = span * (outW / outH) > plan.w ? plan.w : span * (outW / outH);
  const sh = Math.min(plan.h, span);
  const sx = Math.min(Math.max(0, p.x * plan.w - sw / 2), plan.w - sw);
  const sy = Math.min(Math.max(0, p.y * plan.h - sh / 2), plan.h - sh);
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
  drawPin(ctx, (p.x * plan.w - sx) * outW / sw, (p.y * plan.h - sy) * outH / sh, Math.max(10, outW / 22), STATUS[p.status].color, p.number);
  return c.toDataURL('image/jpeg', 0.85);
}

// ---------------------------------------------------------------- Raport / proces-verbal (print → PDF)
async function viewPrint(pr) {
  const job = printJob;
  if (!job) return go(`#/p/${pr.id}/reports`);
  app.innerHTML = `${bar({ back: job.back, title: job.type === 'meeting' ? 'Proces-verbal' : 'Raport', sub: pr.name, right: `<button class="btn small primary" data-act="print" disabled>${I.print} PDF</button>` })}
    <main class="content"><div class="doc" id="doc"><p>Se generează documentul…</p></div></main>`;
  const [plans, points, companies] = await Promise.all([db.where('plans', pr.id), db.where('points', pr.id), db.where('companies', pr.id)]);
  const comp = (id) => companies.find((c) => c.id === id);
  const planOf = (id) => plans.find((p) => p.id === id);
  const head = (title) => `<div class="head"><div><h1>${esc(title)}</h1><div><b>${esc(pr.name)}</b></div>
      <div class="muted">${esc([pr.client && 'Beneficiar: ' + pr.client, pr.address].filter(Boolean).join(' · '))}</div></div>
      <div class="muted" style="text-align:right">Generat: ${fmtTime(Date.now())}${pr.manager ? `<br>Responsabil: ${esc(pr.manager)}` : ''}</div></div>`;
  const badge = (p) => `<span class="badge" style="--c:${STATUS[p.status].color}">${STATUS[p.status].label}</span>`;

  async function pointBlock(p, o) {
    const pl = planOf(p.planId);
    const crop = o.crop && pl && p.x != null ? await cropPlan(pl, p) : '';
    const photos = o.photos ? await Promise.all((p.photos || []).map(blobURL)) : [];
    const c = comp(p.companyId);
    return `<div class="pt">${crop ? `<img class="crop" src="${crop}" alt="">` : ''}<div class="body">
      <div class="title"><span class="badge" style="--c:${STATUS[p.status].color}">#${p.number}</span>${esc(p.title)}</div>
      <div class="kv">${badge(p)} · Prioritate: ${PRIORITY[p.priority] || '-'}${p.category ? ' · ' + esc(p.category) : ''}</div>
      <div class="kv">Firmă: <b>${c ? esc(c.name) : '—'}</b>${p.due ? ` · Termen: <b ${isOverdue(p) ? 'style="color:#d92d20"' : ''}>${fmtDate(p.due)}${isOverdue(p) ? ' (depășit)' : ''}</b>` : ''}${pl ? ` · Plan: ${esc(pl.name)}` : ''}</div>
      ${p.desc ? `<div class="pre" style="margin-top:4px">${esc(p.desc)}</div>` : ''}
      ${o.hist && p.history && p.history.length ? `<div class="kv" style="margin-top:6px">${p.history.map((h) => `<div><small>${fmtTime(h.t)}</small> – ${esc(h.text)}</div>`).join('')}</div>` : ''}
      ${photos.length ? `<div class="ph">${photos.map((u) => `<img src="${u}" alt="">`).join('')}</div>` : ''}
    </div></div>`;
  }

  let html = '';
  if (job.type === 'meeting') {
    const m = await db.get('meetings', job.meetingId);
    if (!m) return go(job.back);
    const pts = m.pointIds.map((id) => points.find((p) => p.id === id)).filter(Boolean).sort((a, b) => a.number - b.number);
    html += head(`Proces-verbal – ${m.title}`);
    html += `<div class="section"><p><b>Data:</b> ${fmtDate(m.date)}${m.location ? ` &nbsp; <b>Locația:</b> ${esc(m.location)}` : ''}</p></div>`;
    html += `<h2>Participanți</h2><table><tr><th>Firmă</th><th>Specialitate</th><th>Reprezentant</th><th>Contact</th></tr>${m.attendees.map(comp).filter(Boolean).map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.trade || '')}</td><td>${esc(c.contact || '')}</td><td>${esc([c.phone, c.email].filter(Boolean).join(', '))}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}</table>`;
    if (m.extra) html += `<p class="pre"><b>Alți participanți:</b> ${esc(m.extra)}</p>`;
    if (m.notes) html += `<h2>Discuții și decizii</h2><div class="pre">${esc(m.notes)}</div>`;
    html += `<h2>Puncte urmărite (${pts.length})</h2>`;
    html += pts.length ? `<table><tr><th>Nr.</th><th>Descriere</th><th>Firmă</th><th>Status</th><th>Termen</th><th>Ultimul comentariu</th></tr>${pts.map((p) => {
      const lastC = [...(p.history || [])].reverse().find((h) => h.kind === 'comment');
      return `<tr><td><b>${p.number}</b></td><td><b>${esc(p.title)}</b>${p.desc ? `<br>${esc(p.desc)}` : ''}</td><td>${esc((comp(p.companyId) || {}).name || '—')}</td><td>${badge(p)}</td><td>${fmtDate(p.due)}</td><td>${lastC ? esc(lastC.text) : ''}</td></tr>`;
    }).join('')}</table>` : '<p>—</p>';
    if (m.next) html += `<p style="margin-top:16px"><b>Următoarea ședință:</b> ${fmtDate(m.next)}</p>`;
    html += `<div class="sign">${(m.attendees.map(comp).filter(Boolean).map((c) => `<div>${esc(c.name)}<br>Semnătura</div>`).join('')) || '<div>Semnătura</div>'}</div>`;
  } else {
    const o = job.opts;
    const list = filterReport(points, o).sort((a, b) => a.number - b.number);
    html += head(o.title);
    const filt = [o.company && 'Firmă: ' + ((comp(o.company) || {}).name || ''), o.plan && 'Plan: ' + ((planOf(o.plan) || {}).name || ''), 'Statusuri: ' + o.statuses.map((s) => STATUS[s].label).join(', '), o.overdue && 'doar întârziate'].filter(Boolean).join(' · ');
    html += `<p class="muted">${esc(filt)}</p>`;
    html += `<table><tr><th>Total</th>${Object.values(STATUS).map((s) => `<th>${s.label}</th>`).join('')}<th>Întârziate</th></tr>
      <tr><td><b>${list.length}</b></td>${Object.keys(STATUS).map((k) => `<td>${list.filter((p) => p.status === k).length}</td>`).join('')}<td>${list.filter(isOverdue).length}</td></tr></table>`;
    if (o.plans) {
      for (const pl of plans) {
        const pts = list.filter((p) => p.planId === pl.id && p.x != null);
        if (!pts.length) continue;
        html += `<div class="section"><h2>Plan: ${esc(pl.name)} (${pts.length} puncte)</h2><img class="plan-img" src="${await planWithPins(pl, pts)}" alt=""></div>`;
      }
    }
    html += `<h2>Puncte (${list.length})</h2>`;
    for (const p of list) html += await pointBlock(p, o);
    if (!list.length) html += '<p>Niciun punct pentru criteriile alese.</p>';
  }
  $('#doc').innerHTML = html;
  const btn = $('[data-act=print]');
  btn.disabled = false;
  btn.onclick = () => window.print();
}

// ---------------------------------------------------------------- Pornire
(async function start() {
  try {
    await openDB();
  } catch (e) {
    app.innerHTML = empty('Stocarea nu este disponibilă', 'Browserul blochează baza de date locală (mod privat?). Deschide aplicația în Safari normal.');
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
}());
