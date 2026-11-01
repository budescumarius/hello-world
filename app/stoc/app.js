'use strict';
/* Stoc – evidența materialelor date din stocul personal: ce, cât, cui, pe ce șantier, data și ora, poze și retururi.
   Toate datele rămân pe dispozitiv (IndexedDB). Funcționează offline. */

// ---------------------------------------------------------------- Constante
const MOVES = {
  out:    { label: 'Dat',     verb: 'Dau material',    color: '#e8590c', sign: -1 },
  return: { label: 'Retur',   verb: 'Primesc retur',   color: '#2f9e44', sign: 1 },
  in:     { label: 'Intrare', verb: 'Intrare în stoc', color: '#1f4fd8', sign: 1 },
};
const UNITS = ['buc', 'm', 'm²', 'm³', 'kg', 't', 'l', 'sac', 'rolă', 'cutie', 'palet', 'set'];
const TABS = [['', 'Materiale'], ['istoric', 'Istoric'], ['retur', 'De returnat'], ['santiere', 'Șantiere'], ['persoane', 'Persoane']];

const I = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};

// ---------------------------------------------------------------- IndexedDB
const STORES = ['items', 'moves', 'blobs', 'meta'];
let _db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('stoc-personal', 1);
    r.onupgradeneeded = () => { STORES.forEach((s) => { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); }); };
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
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fmtAt = (s) => (s ? `${fmtDate(s.slice(0, 10))}${s.length > 10 ? ' ' + s.slice(11, 16) : ''}` : '');
const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? 0 : x; };
const fnum = (x, d = 3) => (x || 0).toLocaleString('ro-RO', { maximumFractionDigits: d });
const qtyTxt = (q, unit) => `${fnum(num(q))} ${unit || ''}`.trim();
const qtyInput = (q) => String(Math.round(num(q) * 1000) / 1000).replace('.', ',');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const money = (x) => `${(x || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${settings.currency || 'lei'}`;
let settings = { currency: 'lei' };

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
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imaginea nu poate fi citită')); i.src = src; });
}
async function blobToImg(blob) { const u = URL.createObjectURL(blob); try { return await loadImg(u); } finally { URL.revokeObjectURL(u); } }
function canvasToBlob(c, type = 'image/jpeg', q = 0.85) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Conversie eșuată'))), type, q));
}
async function resizeImage(img, max) {
  const w0 = img.naturalWidth || img.width; const h0 = img.naturalHeight || img.height;
  const r = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * r); c.height = Math.round(h0 * r);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c);
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
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}
function pickFile(accept) {
  return new Promise((res) => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.onchange = () => res([...inp.files]); inp.click(); });
}
function csvBlob(rows) {
  return new Blob(['﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv' });
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
      closed = true; openSheets.delete(api);
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
  if (f.type === 'textarea') input = `<textarea name="${f.name}" id="${id}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
  else if (f.type === 'select') input = `<select name="${f.name}" id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else input = `<input name="${f.name}" id="${id}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="${f.list}"` : ''} ${f.mode ? `inputmode="${f.mode}"` : ''} autocomplete="off">`;
  return `<label class="field"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}</label>`;
}
function formSheet({ title, fields, values = {}, onSave, onDelete, onClose, extra = '' }) {
  const parts = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]; const g = fields[i + 1];
    if (f.half && g && g.half) { parts.push(`<div class="row2">${field(f, values[f.name])}${field(g, values[g.name])}</div>`); i++; } else parts.push(field(f, values[f.name]));
  }
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>${esc(title)}</h2><button class="link strong" data-save>Salvează</button></div>
    <form class="sheet-body form">${parts.join('')}${extra}
    ${onDelete ? '<button type="button" class="btn danger block" data-del>Șterge</button>' : ''}<button type="submit" hidden></button></form>`, { onClose });
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
  if (onDelete) $('[data-del]', s.el).onclick = async () => { if (confirm('Sigur vrei să ștergi? Acțiunea nu poate fi anulată.')) { if (await onDelete() !== false) s.close(); } };
  return s;
}

function photoViewer(blobId, { onDelete }) {
  const ov = document.createElement('div');
  ov.className = 'photo-view';
  document.body.appendChild(ov);
  blobURL(blobId).then((u) => {
    ov.innerHTML = `<div class="ptools"><button class="btn" data-x>Închide</button><button class="btn danger" data-del>Șterge poza</button></div>
      <div class="stage"><img src="${u}" alt=""></div>`;
    $('[data-x]', ov).onclick = () => ov.remove();
    $('[data-del]', ov).onclick = () => { if (confirm('Ștergi poza?')) { onDelete(); ov.remove(); } };
  });
}

// ---------------------------------------------------------------- Calcule
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
async function loadData() {
  const [items, moves] = await Promise.all([db.all('items'), db.all('moves')]);
  items.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  moves.sort((a, b) => (b.at || '').localeCompare(a.at || '') || b.created - a.created);
  return { items, moves, calc: stockCalc(items, moves) };
}
const itemOf = (d, id) => d.items.find((x) => x.id === id) || {};

function moveRows(list, d, thumbs) {
  return list.map((m, i) => {
    const it = itemOf(d, m.itemId);
    const t = MOVES[m.type];
    return `<button class="row" data-mv="${m.id}"><span class="dot" style="--c:${t.color}"></span>
      <span class="main"><div class="t">${esc(it.name || '(material șters)')}</div>
      <div class="s">${esc([fmtAt(m.at), t.label, m.to, m.site, m.type === 'out' && m.expectReturn ? 'de returnat' : '', m.note].filter(Boolean).join(' · '))}</div></span>
      ${thumbs[i] ? `<img class="thumb" src="${thumbs[i]}" alt="">` : ''}
      <span class="amt" style="color:${t.color}">${t.sign < 0 ? '−' : '+'}${esc(qtyTxt(m.qty, it.unit))}</span></button>`;
  }).join('');
}
const moveThumbs = (list) => Promise.all(list.map((m) => ((m.photos || [])[0] ? blobURL(m.photos[0]) : '')));
async function moveList(box, list, d, emptyHtml) {
  box.innerHTML = list.length ? `<div class="list">${moveRows(list, d, await moveThumbs(list))}</div>` : emptyHtml;
  $$('[data-mv]', box).forEach((b) => { b.onclick = () => editMove(d.moves.find((m) => m.id === b.dataset.mv), {}, render); });
}

// Totaluri pe un grup de mișcări (o persoană sau un șantier)
function groupTotals(d, list) {
  const per = {};
  for (const m of list) {
    const p = per[m.itemId] || (per[m.itemId] = { out: 0, ret: 0, pend: 0 });
    if (m.type === 'out') { p.out += num(m.qty); if (m.expectReturn) p.pend += num(m.qty); }
    if (m.type === 'return') { p.ret += num(m.qty); p.pend -= num(m.qty); }
  }
  return Object.entries(per).map(([id, p]) => ({ it: itemOf(d, id), ...p })).filter((r) => r.it.id && (r.out || r.ret));
}

// ---------------------------------------------------------------- Router
const state = { q: '', type: '' };
async function render() {
  closeAllSheets();
  const p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    const meta = await db.get('meta', 'settings');
    if (meta) settings = Object.assign(settings, meta);
    if ((p[0] === 'santier' || p[0] === 'persoana') && p[1] != null) return await viewGroup(p[0], p[1]);
    return await viewMain(TABS.some(([k]) => k === p[0]) ? p[0] : '');
  } catch (e) { console.error(e); toast('Eroare: ' + e.message, 4000); }
}
window.addEventListener('hashchange', render);

async function viewMain(tab) {
  const d = await loadData();
  const pending = [];
  for (const s of Object.values(d.calc)) for (const [who, q] of Object.entries(s.pending)) pending.push({ who, q, s });
  const tabLabel = (k, l) => (k === 'retur' && pending.length ? `${l} (${pending.length})` : l);
  app.innerHTML = `${bar({ title: 'Stoc', sub: 'Materiale date din stocul personal', right: `<button class="icon-btn" data-act="menu" aria-label="Meniu">${I.more}</button>` })}
    <nav class="tabs">${TABS.map(([k, l]) => `<a href="#/${k}" class="${k === tab ? 'on' : ''}">${esc(tabLabel(k, l))}</a>`).join('')}</nav>
    <main class="content">
      ${tab === 'retur' ? '' : `<div class="toolbar"><input type="search" placeholder="Caută…" value="${esc(state.q)}" data-q>
        ${tab === 'istoric' ? `<select data-type><option value="">Toate</option>${Object.entries(MOVES).map(([k, t]) => `<option value="${k}" ${state.type === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>` : ''}</div>`}
      <div id="box"></div>
    </main>
    <button class="fab" data-act="give">${I.minus}<span>Dau material</span></button>`;
  $('[data-act=menu]').onclick = () => mainMenu(d);
  $('[data-act=give]').onclick = () => editMove(null, { type: 'out' }, render);
  const box = $('#box');
  const draw = async () => {
    const q = norm(state.q);
    if (tab === '') {
      const list = d.items.filter((it) => !q || norm([it.name, it.category].join(' ')).includes(q));
      box.innerHTML = list.length ? `<div class="list">${list.map((it) => {
        const s = d.calc[it.id];
        return `<button class="row" data-it="${it.id}"><span class="main"><div class="t tw">${esc(it.name)}</div>
          <div class="s">${esc([it.category, `dat ${qtyTxt(s.out, it.unit)}`, s.ret ? `retur ${qtyTxt(s.ret, it.unit)}` : '', s.pendingQty ? `de primit ${qtyTxt(s.pendingQty, it.unit)}` : ''].filter(Boolean).join(' · '))}</div></span>
          ${s.tracked ? `<span class="amt ${s.stock < 0 ? 'overdue' : ''}">${esc(qtyTxt(s.stock, it.unit))}<br><small class="muted">în stoc</small></span>` : ''}</button>`;
      }).join('')}</div>` : (d.items.length ? empty('Nimic găsit', 'Încearcă alt cuvânt.') : `${empty('Niciun material încă', 'Apasă „Dau material” și scrie denumirea – materialul se creează automat. Data și ora se completează singure; poți adăuga și poze.')}
        <div class="btns" style="max-width:420px;margin:0 auto"><button class="btn" data-act="newitem">+ Adaugă materiale în stoc</button></div>`);
      $$('[data-it]', box).forEach((b) => { b.onclick = () => itemSheet(b.dataset.it); });
      const ni = $('[data-act=newitem]', box); if (ni) ni.onclick = () => editMove(null, { type: 'in' }, render);
    } else if (tab === 'istoric') {
      const list = d.moves.filter((m) => (!state.type || m.type === state.type) && (!q || norm([itemOf(d, m.itemId).name, m.to, m.site, m.note].join(' ')).includes(q)));
      await moveList(box, list, d, empty('Nicio mișcare', 'Aici apare tot ce ai dat, primit înapoi sau adăugat în stoc, cu data și ora.'));
    } else if (tab === 'retur') {
      const people = [...new Set(pending.map((x) => x.who))].sort((a, b) => a.localeCompare(b, 'ro'));
      box.innerHTML = people.length ? people.map((who) => `<div class="section-title">${esc(who)}</div><div class="list">${pending.filter((x) => x.who === who).map((x) => {
        const last = d.moves.find((m) => m.itemId === x.s.item.id && m.type === 'out' && (m.to || '').trim() === who);
        return `<button class="row" data-ret="${x.s.item.id}" data-who="${esc(who)}"><span class="dot" style="--c:${MOVES.out.color}"></span><span class="main"><div class="t tw">${esc(x.s.item.name)}</div>
          <div class="s">${last ? `dat pe ${esc(fmtAt(last.at))}${last.site ? ' · ' + esc(last.site) : ''} · ` : ''}atinge pentru retur</div></span>
          <span class="amt">${esc(qtyTxt(x.q, x.s.item.unit))}</span></button>`;
      }).join('')}</div>`).join('') : empty('Nimic de primit înapoi', 'Când dai un material, alege „Retur așteptat: Da” ca să apară aici până îl primești înapoi.');
      $$('[data-ret]', box).forEach((b) => {
        b.onclick = () => {
          const x = pending.find((y) => y.s.item.id === b.dataset.ret && y.who === b.dataset.who);
          editMove(null, { type: 'return', itemId: x.s.item.id, to: x.who, qty: x.q }, render);
        };
      });
    } else {
      const key = tab === 'santiere' ? 'site' : 'to';
      const groups = {};
      for (const m of d.moves) { const g = (m[key] || '').trim(); if (g && m.type !== 'in') (groups[g] || (groups[g] = [])).push(m); }
      const names = Object.keys(groups).filter((g) => !q || norm(g).includes(q)).sort((a, b) => a.localeCompare(b, 'ro'));
      box.innerHTML = names.length ? `<div class="list">${names.map((g) => {
        const l = groups[g];
        const pend = groupTotals(d, l).filter((r) => r.pend > 1e-9).length;
        return `<a class="row" href="#/${tab === 'santiere' ? 'santier' : 'persoana'}/${encodeURIComponent(g)}"><span class="main"><div class="t tw">${esc(g)}</div>
          <div class="s">${l.length} mișcări · ultima ${esc(fmtAt(l[0].at))}</div></span>${pend ? `<span class="chip red">${pend} de returnat</span>` : ''}</a>`;
      }).join('')}</div>` : empty(tab === 'santiere' ? 'Niciun șantier' : 'Nicio persoană', tab === 'santiere' ? 'Completează câmpul „Șantier” când dai materiale și le vei vedea grupate aici.' : 'Persoanele cărora le dai materiale apar aici, cu tot ce au primit.');
    }
  };
  const qi = $('[data-q]'); if (qi) qi.oninput = (e) => { state.q = e.target.value; draw(); };
  const ty = $('[data-type]'); if (ty) ty.onchange = () => { state.type = ty.value; draw(); };
  await draw();
}

// Pagina unui șantier sau a unei persoane
async function viewGroup(kind, name) {
  const d = await loadData();
  const key = kind === 'santier' ? 'site' : 'to';
  const list = d.moves.filter((m) => (m[key] || '').trim() === name);
  const rows = groupTotals(d, list);
  const anyPrice = rows.some((r) => num(r.it.price));
  const value = rows.reduce((a, r) => a + (r.out - r.ret) * num(r.it.price), 0);
  app.innerHTML = `${bar({ back: kind === 'santier' ? '#/santiere' : '#/persoane', title: name, sub: kind === 'santier' ? 'Șantier' : 'Persoană / firmă', right: `<button class="icon-btn" data-act="csv" aria-label="Export">${I.more}</button>` })}
    <main class="content">
      ${anyPrice ? `<div class="kpis"><div class="kpi"><small>Valoare dată (net de retur)</small><b>${money(value)}</b></div></div>` : ''}
      ${rows.length ? `<div class="section-title">Total</div><div class="list">${rows.map((r) => `<div class="row" style="cursor:default"><span class="main"><div class="t tw">${esc(r.it.name)}</div>
        <div class="s">dat ${esc(qtyTxt(r.out, r.it.unit))}${r.ret ? ` · retur ${esc(qtyTxt(r.ret, r.it.unit))}` : ''}${r.pend > 1e-9 ? ` · <span class="overdue">de primit ${esc(qtyTxt(r.pend, r.it.unit))}</span>` : ''}</div></span>
        <span class="amt">${esc(qtyTxt(r.out - r.ret, r.it.unit))}</span></div>`).join('')}</div>` : ''}
      <div class="section-title">Istoric</div><div id="box"></div>
    </main>
    <button class="fab" data-act="give">${I.minus}<span>Dau material</span></button>`;
  await moveList($('#box'), list, d, empty('Nicio mișcare', ''));
  $('[data-act=give]').onclick = () => editMove(null, { type: 'out', [key]: name }, render);
  $('[data-act=csv]').onclick = () => actionSheet(name, [{ label: 'Exportă CSV (Excel)', run: () => exportCSV(d, list, name) }]);
}

// ---------------------------------------------------------------- Fișa unui material
async function itemSheet(id) {
  const d = await loadData();
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
      await db.put('items', o);
      if (onDone) onDone(o);
    },
    onDelete: it ? async () => {
      const moves = (await db.all('moves')).filter((m) => m.itemId === it.id);
      if (moves.length && !confirm(`Materialul are ${moves.length} mișcări în istoric. Se șterg și acestea (cu pozele lor). Continui?`)) return false;
      for (const m of moves) { for (const p of m.photos || []) await delBlob(p); await db.del('moves', m.id); }
      await db.del('items', it.id);
      render();
    } : null,
  });
}

// ---------------------------------------------------------------- Mișcare: dat / retur / intrare
async function editMove(m, preset = {}, onDone) {
  const [items, moves] = await Promise.all([db.all('items'), db.all('moves')]);
  items.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  moves.sort((a, b) => b.created - a.created);
  const type = (m && m.type) || preset.type || 'out';
  const t = MOVES[type];
  const lastOut = moves.find((x) => x.type === 'out');
  const item0 = items.find((x) => x.id === ((m && m.itemId) || preset.itemId));
  const v0 = m ? { ...m, material: item0 ? item0.name : '', unit: item0 ? item0.unit : '', qty: qtyInput(m.qty), expectReturn: m.expectReturn ? '1' : '' }
    : { at: nowLocal(), qty: preset.qty != null ? qtyInput(preset.qty) : '', to: preset.to || '', material: item0 ? item0.name : '', unit: item0 ? item0.unit : 'buc',
      site: preset.site ?? (type === 'out' && lastOut ? lastOut.site || '' : ''), expectReturn: '' };
  if (!m && type === 'out' && item0) {
    const prev = moves.find((x) => x.itemId === item0.id && x.type === 'out');
    if (prev) v0.expectReturn = prev.expectReturn ? '1' : '';
  }
  if (!m && type === 'return' && preset.itemId && preset.to) {
    const prev = moves.find((x) => x.itemId === preset.itemId && x.type === 'out' && (x.to || '').trim() === preset.to);
    if (prev) v0.site = prev.site || '';
  }
  const photos = [...((m && m.photos) || [])];
  const origPhotos = [...photos];
  const added = [];
  let saved = false;
  const people = [...new Set(moves.map((x) => (x.to || '').trim()).filter(Boolean))];
  const sites = [...new Set(moves.map((x) => (x.site || '').trim()).filter(Boolean))];
  const fields = [
    { name: 'material', label: 'Material', required: true, list: 'stitems', placeholder: 'scrie sau alege' },
    { name: 'qty', label: 'Cantitate', mode: 'decimal', required: true, half: true },
    { name: 'unit', label: 'Unitate', list: 'units', half: true },
    { name: 'at', label: 'Data și ora', type: 'datetime-local', required: true },
    { name: 'to', label: type === 'out' ? 'Cui am dat (persoană / firmă)' : type === 'return' ? 'De la cine am primit înapoi' : 'Furnizor / de unde (opțional)', list: 'people', required: type !== 'in' },
  ];
  if (type !== 'in') fields.push({ name: 'site', label: 'Șantier (opțional)', list: 'sites', placeholder: 'ex. Str. Florilor 12' });
  if (type === 'out') fields.push({ name: 'expectReturn', label: 'Retur așteptat?', type: 'select', options: [['', 'Nu (consumat / rămâne acolo)'], ['1', 'Da, trebuie să-l primesc înapoi']] });
  fields.push({ name: 'note', label: 'Notă', type: 'textarea', rows: 2 });

  const s = formSheet({
    title: m ? `${t.label} – editează` : t.verb,
    values: v0,
    fields,
    extra: `<datalist id="stitems">${items.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>
      <datalist id="people">${people.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="sites">${sites.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="units">${UNITS.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
      <div class="muted" id="stinfo" style="margin:-4px 2px 10px;font-size:13px"></div>
      <div class="field"><span>Poze (opțional)</span><div class="photos" id="mph"></div></div>`,
    onClose: () => { if (!saved) added.forEach(delBlob); },
    async onSave(v) {
      if (num(v.qty) <= 0) throw new Error('cantitatea trebuie să fie mai mare decât 0');
      let it = items.find((x) => norm(x.name) === norm(v.material));
      if (!it) { it = { id: uid(), created: Date.now(), name: v.material, unit: v.unit || 'buc', category: '', initial: '', price: '' }; await db.put('items', it); }
      else if (v.unit && v.unit !== it.unit) { it.unit = v.unit; await db.put('items', it); }
      const o = Object.assign(m || { id: uid(), type, created: Date.now() }, {
        itemId: it.id, qty: num(v.qty), at: v.at, to: v.to || '', site: v.site || '', note: v.note || '',
        expectReturn: type === 'out' && v.expectReturn === '1', photos, updated: Date.now(),
      });
      for (const p of origPhotos) if (!photos.includes(p)) await delBlob(p);
      saved = true;
      await db.put('moves', o);
      toast(`${t.label}: ${qtyTxt(o.qty, it.unit)} ${it.name}`);
      if (onDone) onDone(o);
    },
    onDelete: m ? async () => { for (const p of origPhotos) await delBlob(p); added.forEach(delBlob); saved = true; await db.del('moves', m.id); if (onDone) onDone(); } : null,
  });
  const form = $('form', s.el);

  // Informații live: stoc disponibil și ce mai are persoana de returnat
  const calc = stockCalc(items, moves.filter((x) => !m || x.id !== m.id));
  const info = () => {
    const it = items.find((x) => norm(x.name) === norm(form.elements.material.value));
    const box = $('#stinfo', form);
    if (!it) { box.textContent = form.elements.material.value ? 'Material nou – va fi creat la salvare.' : ''; return; }
    const c = calc[it.id];
    const who = form.elements.to.value.trim();
    box.textContent = [c.tracked ? `În stoc: ${qtyTxt(c.stock, it.unit)}` : '', c.pendingQty ? `De primit înapoi: ${qtyTxt(c.pendingQty, it.unit)}` : '',
      who && c.pending[who] ? `${who} are ${qtyTxt(c.pending[who], it.unit)}` : ''].filter(Boolean).join(' · ');
  };
  form.elements.material.addEventListener('input', () => {
    const it = items.find((x) => norm(x.name) === norm(form.elements.material.value));
    if (it && !m) {
      form.elements.unit.value = it.unit || '';
      if (type === 'out') { const prev = moves.find((x) => x.itemId === it.id && x.type === 'out'); if (prev) form.elements.expectReturn.value = prev.expectReturn ? '1' : ''; }
    }
    info();
  });
  form.elements.to.addEventListener('input', info);
  info();

  const drawPh = async () => {
    const box = $('#mph', form);
    const urls = await Promise.all(photos.map(blobURL));
    box.innerHTML = urls.map((u, i) => `<img src="${u}" alt="Poză" data-ph="${i}">`).join('')
      + `<label class="add">${I.camera}<span>Poză</span><input type="file" accept="image/*" multiple></label>`;
    $$('[data-ph]', box).forEach((im) => {
      im.onclick = () => photoViewer(photos[+im.dataset.ph], { onDelete() { photos.splice(+im.dataset.ph, 1); drawPh(); } });
    });
    $('input', box).onchange = async (e) => {
      for (const file of e.target.files) {
        try { const id = await saveBlob(await resizeImage(await blobToImg(file), 2000)); added.push(id); photos.push(id); } catch (err) { toast('Poza nu a putut fi citită'); }
      }
      drawPh();
    };
  };
  drawPh();
}

// ---------------------------------------------------------------- Meniu, export, backup
function mainMenu(d) {
  actionSheet('Meniu', [
    { label: 'Dau material', run: () => editMove(null, { type: 'out' }, render) },
    { label: 'Primesc retur', run: () => editMove(null, { type: 'return' }, render) },
    { label: 'Intrare în stoc (am cumpărat / adus)', run: () => editMove(null, { type: 'in' }, render) },
    { label: 'Material nou', run: () => editItem(null, render) },
    { label: 'Exportă istoricul (CSV / Excel)', run: () => exportCSV(d, d.moves, 'tot') },
    { label: 'Exportă backup (toate datele + poze)', run: exportBackup },
    { label: 'Importă backup', run: importBackup },
    { label: 'Monedă', run: editCurrency },
    { label: 'Cum instalez pe iPhone / iPad', run: installHelp },
  ]);
}
function editCurrency() {
  formSheet({
    title: 'Monedă', values: settings, fields: [{ name: 'currency', label: 'Moneda pentru prețuri', required: true }],
    async onSave(v) { settings.currency = v.currency; await db.put('meta', { id: 'settings', ...settings }); render(); },
  });
}
function exportCSV(d, moves, label) {
  const rows = [['Data', 'Ora', 'Tip', 'Material', 'Cantitate', 'Unitate', 'Persoană / firmă', 'Șantier', 'Retur așteptat', 'Notă', 'Poze']];
  for (const m of [...moves].reverse()) {
    const it = itemOf(d, m.itemId);
    rows.push([fmtDate((m.at || '').slice(0, 10)), (m.at || '').slice(11, 16), MOVES[m.type].label, it.name || '', fnum(num(m.qty)), it.unit || '', m.to || '', m.site || '',
      m.type === 'out' ? (m.expectReturn ? 'Da' : 'Nu') : '', m.note || '', (m.photos || []).length]);
  }
  shareOrDownload(csvBlob(rows), `stoc-${norm(label) || 'export'}-${today()}.csv`);
}
async function exportBackup() {
  toast('Se pregătește backup-ul…', 10000);
  const data = {};
  for (const s of STORES.filter((x) => x !== 'blobs')) data[s] = await db.all(s);
  const blobs = [];
  for (const b of await db.all('blobs')) blobs.push({ id: b.id, data: await blobToDataURL(b.blob) });
  const json = JSON.stringify({ app: 'stoc-personal', version: 1, exported: new Date().toISOString(), data, blobs });
  toast('Backup gata');
  await shareOrDownload(new Blob([json], { type: 'application/json' }), `stoc-backup-${today()}.json`);
}
async function importBackup() {
  const [file] = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (obj.app !== 'stoc-personal' || !obj.data) throw new Error('Fișierul nu este un backup Stoc');
    const replace = confirm('Înlocuiești TOATE datele existente cu cele din backup?\n\nOK = înlocuiește\nAnulează = adaugă peste datele existente');
    toast('Se importă…', 20000);
    if (replace) { for (const s of STORES) await db.clear(s); urlCache.clear(); }
    for (const s of Object.keys(obj.data)) if (STORES.includes(s)) for (const o of obj.data[s]) await db.put(s, o);
    for (const b of obj.blobs || []) await db.put('blobs', { id: b.id, blob: await dataURLToBlob(b.data) });
    toast('Backup importat cu succes');
    go('#/');
  } catch (e) { toast('Import eșuat: ' + e.message, 4000); }
}
function installHelp() {
  sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Instalare pe iPhone / iPad</h2><button class="link" data-close>Gata</button></div>
  <div class="sheet-body"><ol style="padding-left:20px;line-height:1.7">
    <li>Deschide această pagină în <b>Safari</b>.</li>
    <li>Apasă <b>Partajează</b> (pătratul cu săgeată în sus).</li>
    <li>Alege <b>Adaugă pe ecranul principal</b>.</li>
    <li>Pornește aplicația din iconița <b>Stoc</b> – merge și fără internet.</li>
  </ol>
  <p class="muted">Datele se salvează doar pe acest telefon. Fă din când în când un <b>backup</b> din meniu (îl poți salva în Fișiere / iCloud Drive).</p></div>`);
}

// ---------------------------------------------------------------- Pornire
(async function start() {
  try { await openDB(); } catch (e) {
    app.innerHTML = empty('Stocarea nu este disponibilă', 'Browserul blochează baza de date locală (mod privat?). Deschide aplicația în Safari normal.');
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
}());
