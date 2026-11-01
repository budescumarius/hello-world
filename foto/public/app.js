'use strict';
const APP_VERSION = '15'; // la fel ca VERSION din api.php / server.js
/* Foto Șantier – aplicația web pentru echipă */

// ============ utilitare ============
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// append/replaceChildren care ignoră null/false (altfel ar apărea textul „null” pe ecran)
{
  const clean = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false);
  const ap = Element.prototype.append, rc = Element.prototype.replaceChildren;
  Element.prototype.append = function (...k) { return ap.apply(this, clean(k)); };
  Element.prototype.replaceChildren = function (...k) { return rc.apply(this, clean(k)); };
}
// replaceChildren care ignoră null/false (altfel ar apărea textul „null”)
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

class HttpError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
  // Unele hostinguri blochează PATCH/DELETE: trimitem POST cu metoda în antet.
  if (o.method && !['GET', 'POST'].includes(o.method)) { o.headers['X-HTTP-Method-Override'] = o.method; o.method = 'POST'; }
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers['Content-Type'] = 'application/json'; delete o.json; }
  const r = await fetch(url, o);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('api/login')) { state.user = null; localStorage.removeItem('me'); route(); }
  if (!r.ok) throw new HttpError(data.error || 'Eroare ' + r.status, r.status);
  return data;
}

// Adresa pozei include codul unic al încărcării: o poză nouă nu poate fi confundată
// cu una ștearsă din memoria telefonului, chiar dacă ar avea același număr.
const fileUrl = (e, size) => `files/${e.id}/${size}?v=${encodeURIComponent(e.client_id || '')}`;
const ROLE_LABEL = { admin: 'Admin', responsabil: 'Responsabil', muncitor: 'Muncitor' };
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (iso) => new Date(iso).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const state = { user: null, sites: [], siteId: null };
const can = {
  manage: () => ['admin', 'responsabil'].includes(state.user?.role),
  admin: () => state.user?.role === 'admin',
};

// ============ coada de trimitere (IndexedDB) – nimic nu se pierde fără semnal ============
const idb = new Promise((res, rej) => {
  const r = indexedDB.open('foto-santier', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'clientId' });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
idb.catch(() => {}); // fără stocare în telefon: pozele se țin în memorie (vezi enqueue)
async function store(mode, fn) {
  const d = await idb;
  return new Promise((res, rej) => {
    const tx = d.transaction('queue', mode);
    const req = fn(tx.objectStore('queue'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
const Q = {
  items: [], // în memorie, pentru afișare
  add: (it) => store('readwrite', (s) => s.put(it)),
  del: (id) => store('readwrite', (s) => s.delete(id)),
  all: () => store('readonly', (s) => s.getAll()),
  mem: [],
  busy: false,
  offline: false,
  error: null,
};

// Pozele (miniaturi + mari) sunt ținute în telefon: o poză văzută o dată se deschide instant
// data viitoare. Adresele au codul unic al încărcării (?v=), deci nu se pot încurca.
const IMG_CACHE = 'foto-img';
async function cachePut(url, blob) {
  try {
    const c = await caches.open(IMG_CACHE);
    await c.put(new URL(url, location.href), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  } catch {}
}
async function cacheDrop(...urls) {
  try { const c = await caches.open(IMG_CACHE); await Promise.all(urls.map((u) => c.delete(new URL(u, location.href)))); } catch {}
}

const thumbUrls = new Map();
function localThumb(it) {
  const src = it.thumb || it.full;
  if (!src) return null;
  if (!thumbUrls.has(it.clientId)) thumbUrls.set(it.clientId, URL.createObjectURL(src));
  return thumbUrls.get(it.clientId);
}

async function enqueue(it) {
  try { await Q.add(it); } catch { Q.mem.push(it); } // fără stocare în telefon: ținem în memorie până se trimite
  Q.items.push(it);
  onQueueChange();
  pump();
}

async function pump() {
  if (Q.busy) return;
  Q.busy = true;
  try {
    Q.items = [...(await Q.all().catch(() => [])), ...Q.mem].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    onQueueChange();
    var sent = 0;
    while (Q.items.length) {
      const it = Q.items[0];
      try {
        let saved;
        if (it.kind === 'note') {
          saved = await api('api/entries/note', { method: 'POST', json: { clientId: it.clientId, siteId: it.siteId, comment: it.comment, takenAt: it.takenAt } });
        } else {
          const head = new Uint8Array(4);
          new DataView(head.buffer).setUint32(0, it.thumb ? it.thumb.size : 0);
          const meta = encodeURIComponent(JSON.stringify({ clientId: it.clientId, siteId: it.siteId, comment: it.comment, takenAt: it.takenAt }));
          saved = await api('api/entries/photo', { method: 'POST', headers: { 'X-Meta': meta, 'Content-Type': 'application/octet-stream' }, body: new Blob(it.thumb ? [head, it.thumb, it.full] : [head, it.full]) });
        }
        Q.offline = false; Q.error = null;
        if (it.siteId && saved.site_id == null) toast('Nu mai ai acces la șantierul ales – poza e la „Fără șantier”');
        await Q.del(it.clientId).catch(() => {}); Q.mem = Q.mem.filter((x) => x !== it);
        Q.items.shift();
        recent.unshift(saved);
        if (recent.length > 24) recent.length = 24;
        if (it.kind === 'photo') { cachePut(fileUrl(saved, 'thumb'), it.thumb || it.full); cachePut(fileUrl(saved, 'full'), it.full); }
        sent++;
        const u = thumbUrls.get(it.clientId);
        if (u) setTimeout(() => URL.revokeObjectURL(u), 60_000), thumbUrls.delete(it.clientId);
        onQueueChange();
      } catch (e) {
        if (e.status === 401) break; // reconectare, apoi reluăm
        if (e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
          // eroare definitivă (ex. fișier stricat) – îl scoatem ca să nu blocheze restul
          toast('O poză nu a putut fi salvată: ' + e.message);
          await Q.del(it.clientId).catch(() => {}); Q.mem = Q.mem.filter((x) => x !== it);
          Q.items.shift();
          onQueueChange();
          continue;
        }
        Q.offline = !e.status; Q.error = e.message;
        onQueueChange();
        setTimeout(pump, Q.offline ? 8000 : 15000);
        break;
      }
    }
  } finally {
    Q.busy = false;
    // copierea în Drive / NAS pornește separat, ca trimiterea pozelor să nu aștepte după ea
    if (sent) fetch('api/sync/kick', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {});
  }
}
window.addEventListener('online', pump);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pump(); });

let onQueueChange = () => {};

// ============ procesarea pozelor (micșorare în telefon = trimitere rapidă) ============
const MAX_SIDE = 2048, THUMB_SIDE = 300;
// Deschide poza. Pe iPhone/iPad încercăm mai multe metode, pentru că Safari
// refuză uneori pozele mari (24–48 MP) cu una sau alta dintre ele.
async function decode(file) {
  const errors = [];
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { errors.push(e); }
    try { return await createImageBitmap(file); } catch (e) { errors.push(e); }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('format necunoscut'));
      img.src = url;
    });
  } catch (e) {
    errors.push(e);
    throw new Error(errors.map((x) => x.message || x.name).filter(Boolean).join(' / ') || 'nu pot deschide imaginea');
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

// O singură pânză (canvas), golită după fiecare folosire: Safari are o limită
// de memorie pentru canvas și altfel, după câteva poze, nu mai poate micșora.
const canvas = document.createElement('canvas');
async function toJpeg(src, max, q) {
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) throw new Error('imagine goală');
  const k = Math.min(1, max / Math.max(w0, h0));
  canvas.width = Math.round(w0 * k);
  canvas.height = Math.round(h0 * k);
  try {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
    if (!blob || blob.size < 100) throw new Error('micșorarea a eșuat');
    return blob;
  } finally {
    canvas.width = 0; canvas.height = 0; // eliberează memoria
  }
}

// Pozele HEIC de pe iPhone (chiar și cu numele .jpeg) nu se deschid în Chrome/Firefox:
// le convertim în JPEG cu un convertor care se încarcă doar când e nevoie (≈1,3 MB, o singură dată).
const isHeicFile = async (file) => {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const t = String.fromCharCode(...b.slice(4, 12));
  return t.startsWith('ftyp') && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(t.slice(4));
};
let heicLib = null;
function loadHeic() {
  return heicLib || (heicLib = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/heic2any.min.js';
    sc.onload = () => res(window.heic2any);
    sc.onerror = () => { heicLib = null; rej(new Error('nu pot încărca convertorul HEIC')); };
    document.head.append(sc);
  }));
}
async function openImage(file) {
  try {
    return await decode(file);
  } catch (e) {
    if (!(await isHeicFile(file).catch(() => false))) throw e;
    toast('Convertesc poza HEIC…');
    const out = await (await loadHeic())({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return decode(Array.isArray(out) ? out[0] : out);
  }
}

const isJpegFile = async (file) => {
  const b = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
};

async function addPhotos(files, fromCamera) {
  const comment = ($('#comment')?.value || '').trim();
  const siteId = state.siteId;
  let n = 0;
  for (const file of files) {
    const takenAt = new Date(fromCamera ? Date.now() : file.lastModified || Date.now()).toISOString();
    let full, thumb;
    try {
      const img = await openImage(file);
      try {
        full = await toJpeg(img, MAX_SIDE, 0.82);
        thumb = await toJpeg(img, THUMB_SIDE, 0.62);
      } finally { img.close?.(); }
    } catch (e) {
      // Ultima variantă: trimitem poza originală, ca să nu se piardă.
      if (await isJpegFile(file).catch(() => false)) {
        full = file; thumb = null; // serverul folosește poza și ca miniatură
      } else {
        toast(`Nu pot deschide ${file.name || 'poza'} (${e.message || 'format necunoscut'}).`);
        continue;
      }
    }
    try {
      await enqueue({ clientId: uid(), kind: 'photo', siteId, comment, takenAt, full, thumb });
      n++;
    } catch (e) {
      toast('Nu am putut salva poza: ' + e.message);
    }
  }
  if (n) {
    if ($('#comment')) $('#comment').value = '';
    toast(n === 1 ? '✓ Poză salvată' : `✓ ${n} poze salvate`);
  }
}

$('#cam').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addPhotos(f, true); });
$('#gal').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; addPhotos(f, false); });

// ============ căutare în liste lungi ============
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// rows: [{ el, text }] – ascunde rândurile care nu conțin toate cuvintele căutate. Apare doar la liste lungi.
function searchBox(rows, placeholder, min = 8) {
  if (rows.length < min) return null;
  const idx = rows.map((r) => [r.el, norm(r.text)]);
  const inp = h('input', { type: 'search', class: 'search', placeholder: '🔍 ' + placeholder, autocomplete: 'off', enterkeyhint: 'search',
    oninput: () => {
      const words = norm(inp.value).split(/\s+/).filter(Boolean);
      for (const [el, t] of idx) el.hidden = words.length > 0 && !words.every((w) => t.includes(w));
    } });
  return inp;
}

// ============ foi (sheet) ============
function sheet(build) {
  const close = () => { ov.remove(); };
  const box = h('div', { class: 'sheet' }, h('div', { class: 'grab' }));
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } }, box);
  build(box, close);
  document.body.append(ov);
  return close;
}

function pickSite(onPick, current, { allowNone = true, sites = state.sites } = {}) {
  sheet((box, close) => {
    box.append(h('h2', {}, 'Alege șantierul'));
    const list = h('div', { class: 'pick-list' });
    const rows = [];
    for (const s of sites) {
      const el = h('button', { class: s.id === current ? 'on' : '', onclick: () => { close(); onPick(s.id); } },
        s.name, s.address ? h('small', {}, s.address) : null);
      rows.push({ el, text: s.name + ' ' + (s.address || '') });
      list.append(el);
    }
    box.append(searchBox(rows, 'Caută șantierul…'));
    if (allowNone) list.append(h('button', { class: current == null ? 'on' : '', onclick: () => { close(); onPick(null); } },
      'Fără șantier', h('small', {}, 'Poza se salvează, se poate atribui mai târziu')));
    if (can.manage()) {
      // admin / responsabil: șantier nou direct de aici
      list.append(h('button', { class: 'new', onclick: () => { close(); quickNewSite(onPick); } },
        '+ Șantier nou', h('small', {}, 'Îl creezi acum și se alege automat')));
    }
    if (!sites.length) box.append(h('p', { class: 'muted' }, can.manage() ? 'Nu există încă niciun șantier. Creează unul mai jos.' : 'Nu ai încă niciun șantier atribuit. Cere-i responsabilului să te adauge.'));
    box.append(list);
  });
}

function quickNewSite(onPick) {
  sheet((box, close) => {
    const name = h('input', { placeholder: 'Ex: Vila Popescu, Str. Lalelelor 4' });
    const addr = h('input', { placeholder: 'Opțional' });
    const err = h('div', { class: 'error' });
    const save = async () => {
      err.textContent = '';
      try {
        const r = await api('api/sites', { method: 'POST', json: { name: name.value, address: addr.value } });
        close();
        await refreshMe();
        onPick(r.id);
        toast('✓ Șantier creat');
      } catch (e) { err.textContent = e.message; }
    };
    box.append(h('h2', {}, 'Șantier nou'),
      h('label', { class: 'f' }, h('span', {}, 'Nume'), name),
      h('label', { class: 'f' }, h('span', {}, 'Adresă'), addr), err,
      h('p', { class: 'muted small' }, 'Oamenii care lucrează aici îi adaugi apoi din Șantiere → Editează.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: close }, 'Renunță'),
        h('button', { class: 'btn primary grow', onclick: save }, 'Creează')));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    setTimeout(() => name.focus(), 50);
  });
}

function progressiveImg(e) {
  const img = h('img', { src: fileUrl(e, 'thumb'), alt: '', class: 'loading' });
  const full = new Image();
  full.onload = () => { img.src = full.src; img.classList.remove('loading'); };
  full.src = fileUrl(e, 'full');
  return img;
}

// ============ vizualizare poză ============
function openViewer(list, index, onChange) {
  let i = index;
  const ov = h('div', { class: 'viewer' });
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  const go = (d) => { if (list[i + d]) { i += d; render(); } };
  document.addEventListener('keydown', key);

  function render() {
    const e = list[i];
    ov.replaceChildren();
    const mine = e.user_id === state.user.id;
    // aceleași reguli ca pe server: modifică autorul, adminul și responsabilul; șterge doar autorul și adminul
    const canEdit = mine || can.manage();
    const canDelete = mine || can.admin();
    const imgBox = h('div', { class: 'img' },
      e.kind === 'photo' ? progressiveImg(e) : h('div', { class: 'note-big' }, e.comment));
    for (const n of [list[i + 1], list[i - 1]]) if (n && n.kind === 'photo') new Image().src = fileUrl(n, 'full');
    let x0 = null;
    imgBox.addEventListener('touchstart', (ev) => { x0 = ev.touches.length === 1 ? ev.touches[0].clientX : null; }, { passive: true });
    imgBox.addEventListener('touchend', (ev) => {
      if (x0 == null) return;
      const dx = ev.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    });
    ov.append(
      h('div', { class: 'bar' },
        h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Închide' }, '✕'),
        h('div', { class: 'spacer' }),
        h('span', { class: 'small', style: 'color:#a1a1aa' }, `${i + 1} / ${list.length}`),
        h('div', { class: 'spacer' }),
        h('button', { class: 'icon-btn', onclick: () => go(-1), disabled: i === 0, 'aria-label': 'Anterior' }, '‹'),
        h('button', { class: 'icon-btn', onclick: () => go(1), disabled: i === list.length - 1, 'aria-label': 'Următor' }, '›')),
      imgBox,
      h('div', { class: 'info' },
        h('div', { class: 'meta' }, `${e.site_name || 'Fără șantier'} · ${e.user_name || '—'} · ${fmtShort(e.taken_at)}`),
        e.kind === 'photo' && e.comment ? h('p', { class: 'cm' }, e.comment) : null,
        h('div', { class: 'btns' },
          canEdit ? h('button', { class: 'btn sm', onclick: () => editComment(e) }, '💬 Comentariu') : null,
          canEdit ? h('button', { class: 'btn sm', onclick: () => moveSite(e) }, '🏗 Șantier') : null,
          e.kind === 'photo' ? h('a', { class: 'btn sm', href: fileUrl(e, 'full') + '&dl=1', download: '' }, '⬇') : null,
          canDelete ? h('button', { class: 'btn sm danger', onclick: () => del(e) }, '🗑') : null)));
  }

  async function patch(e, body) {
    try {
      const u = await api('api/entries/' + e.id, { method: 'PATCH', json: body });
      Object.assign(e, u);
      render();
      onChange?.();
    } catch (err) { toast(err.message); }
  }
  function editComment(e) {
    sheet((box, closeS) => {
      const ta = h('textarea', { rows: 4, placeholder: 'Ce se vede în poză, ce trebuie făcut…' });
      ta.value = e.comment;
      box.append(h('h2', {}, 'Comentariu'), ta,
        h('div', { class: 'row', style: 'margin-top:12px' },
          h('button', { class: 'btn grow', onclick: closeS }, 'Renunță'),
          h('button', { class: 'btn primary grow', onclick: () => { closeS(); patch(e, { comment: ta.value }); } }, 'Salvează')));
      setTimeout(() => ta.focus(), 50);
    });
  }
  async function moveSite(e) {
    let sites = state.sites;
    if (can.manage()) sites = (await api('api/sites?lite=1')).sites.filter((s) => !s.archived);
    pickSite((sid) => patch(e, { siteId: sid }), e.site_id, { sites });
  }
  async function del(e) {
    if (!confirm(e.kind === 'photo' ? 'Ștergi poza definitiv?' : 'Ștergi nota?')) return;
    try {
      await api('api/entries/' + e.id, { method: 'DELETE' });
      list.splice(i, 1);
      cacheDrop(fileUrl(e, 'thumb'), fileUrl(e, 'full'));
      const r = recent.findIndex((x) => x.id === e.id); // scoate-o și din „Ultimele”
      if (r >= 0) recent.splice(r, 1);
      onChange?.();
      if (!list.length) return close();
      if (i >= list.length) i = list.length - 1;
      render();
    } catch (err) { toast(err.message); }
  }

  render();
  document.body.append(ov);
}

// ============ galerie ============
// Miniaturile se descarcă doar când ajung aproape de ecran: cele vizibile primesc toată viteza.
const lazyIO = 'IntersectionObserver' in window ? new IntersectionObserver((list) => {
  for (const en of list) if (en.isIntersecting) { en.target.src = en.target.dataset.src; lazyIO.unobserve(en.target); }
}, { rootMargin: '300px 0px' }) : null;
function lazyImg(src, alt) {
  const img = h('img', { alt: alt || '', decoding: 'async' });
  if (lazyIO) { img.dataset.src = src; lazyIO.observe(img); } else img.src = src;
  return img;
}
function gallery(entries, { onChange, pending = [] } = {}) {
  const wrap = h('div');
  wrap.addMore = () => {};
  if (!entries.length && !pending.length) {
    wrap.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, '📷'), 'Nicio poză încă'));
    return wrap;
  }
  if (pending.length) {
    wrap.append(h('div', { class: 'day' }, 'Se trimit'),
      h('div', { class: 'grid' }, pending.map((it) => h('div', { class: 'tile' + (it.kind === 'note' ? ' note' : '') },
        it.kind === 'note' ? [h('b', {}, '📝'), h('span', {}, it.comment)] : h('img', { src: localThumb(it), alt: '' }),
        h('span', { class: 'q' }, '⏳')))));
  }
  let day = null, grid;
  // Adaugă doar pozele noi (de la poziția „from”), fără să redeseneze ce e deja pe ecran.
  function addTiles(from) {
    for (let idx = from; idx < entries.length; idx++) {
      const e = entries[idx];
      const d = new Date(e.taken_at).toDateString();
      if (d !== day) {
        day = d;
        wrap.append(h('div', { class: 'day' }, fmtDate(e.taken_at)));
        grid = h('div', { class: 'grid' });
        wrap.append(grid);
      }
      const open = () => openViewer(entries, Math.max(0, entries.indexOf(e)), onChange);
      grid.append(e.kind === 'photo'
        ? h('button', { class: 'tile', onclick: open },
            lazyImg(fileUrl(e, 'thumb'), e.comment),
            e.comment ? h('span', { class: 'c' }, '💬') : null)
        : h('button', { class: 'tile note', onclick: open }, h('b', {}, '📝'), h('span', {}, e.comment)));
    }
  }
  addTiles(0);
  wrap.addMore = addTiles;
  return wrap;
}

// listă paginată de la server
// Ultima listă văzută pentru fiecare filtru: galeria apare instant, apoi se actualizează în fundal.
const FEEDS_KEY = 'feeds';
const feedMem = new Map(Object.entries(JSON.parse(localStorage.getItem(FEEDS_KEY) || '{}')));
function feedSave(key, rows) {
  feedMem.delete(key);
  feedMem.set(key, rows);
  while (feedMem.size > 8) feedMem.delete(feedMem.keys().next().value); // păstrăm doar ultimele 8 filtre
  try { localStorage.setItem(FEEDS_KEY, JSON.stringify(Object.fromEntries(feedMem))); } catch {}
}

const PAGE = 60;
function feed(params, { onChange } = {}) {
  const key = (state.user?.id || 0) + ':' + new URLSearchParams(params);
  const cached = feedMem.get(key);
  const box = h('div', {}, cached ? '' : h('p', { class: 'muted' }, 'Se încarcă…'));
  let items = cached ? [...cached] : [], done = !cached, loading = false, g = null;
  // Derulare automată: când capătul listei se apropie de ecran, vine pagina următoare.
  const moreBtn = h('button', { class: 'btn block', style: 'margin-top:16px', onclick: () => load(false) }, 'Mai multe');
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    if (!box.isConnected) return io.disconnect();
    if (es.some((x) => x.isIntersecting)) load(false);
  }, { rootMargin: '800px 0px' }) : null;
  io?.observe(moreBtn);

  async function load(first) {
    if (loading || (!first && done)) return;
    loading = true;
    moreBtn.textContent = 'Se încarcă…';
    const q = new URLSearchParams(params);
    const last = items[items.length - 1];
    if (!first && last) q.set('before', `${last.taken_at}|${last.id}`);
    try {
      const rows = await api('api/entries?' + q);
      if (first) {
        feedSave(key, rows);
        const same = items.length === rows.length && JSON.stringify(items) === JSON.stringify(rows);
        if (!same || !cached) { items = rows; done = rows.length < PAGE; draw(); } // redesenăm doar dacă s-a schimbat ceva
      } else {
        const from = items.length;
        items.push(...rows);
        done = rows.length < PAGE;
        g.addMore(from);
        if (done) { moreBtn.remove(); io?.disconnect(); }
      }
    } catch (e) { if (first && !cached) fill(box, h('p', { class: 'error' }, e.message)); }
    finally {
      loading = false;
      moreBtn.textContent = 'Mai multe';
      // dacă ecranul e încă gol jos (telefon înalt / poze puține), mai cerem o pagină
      if (!done && io && box.isConnected && moreBtn.getBoundingClientRect().top < innerHeight + 800) setTimeout(() => load(false), 0);
    }
  }
  function draw() {
    g = gallery(items, { onChange: () => { draw(); onChange?.(); } });
    fill(box, g);
    if (!done) box.append(moreBtn);
  }
  if (cached) { done = cached.length < PAGE; draw(); }
  load(true);
  return box;
}

// ============ ecrane ============
const recent = []; // ultimele trimise în această sesiune

function screenLogin(setup) {
  document.body.classList.add('no-tabs');
  $('#tabs').hidden = true;
  const err = h('div', { class: 'error' });
  const name = h('input', { autocomplete: 'name', placeholder: 'Ex: Ion Popescu' });
  const user = h('input', { autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
  const pass = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, setup ? 'Creează contul de admin' : 'Intră');
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; err.textContent = '';
    try {
      await api(setup ? 'api/setup' : 'api/login', { method: 'POST', json: { name: name.value, username: user.value, password: pass.value } });
      history.replaceState(null, '', location.pathname); // după logare: direct la ecranul Foto
      await boot();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  } },
    h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
    h('h1', { class: 'center' }, 'Foto Șantier'),
    setup ? h('p', { class: 'muted center' }, 'Prima pornire: creează contul de administrator.') : null,
    setup ? h('label', { class: 'f' }, h('span', {}, 'Numele tău'), name) : null,
    h('label', { class: 'f' }, h('span', {}, 'Utilizator'), user),
    h('label', { class: 'f' }, h('span', {}, 'Parolă'), pass),
    err, btn);
  fill(view, form);
  (setup ? name : user).focus();
}

function screenFoto() {
  const site = state.sites.find((s) => s.id === state.siteId);
  const status = h('div');
  const pendingBox = h('div');
  const recentBox = h('div');

  onQueueChange = () => {
    const n = Q.items.length;
    fill(status, 
      n === 0 ? (recent.length ? h('div', { class: 'status ok' }, '✓ Totul e salvat pe server') : '')
        : Q.offline ? h('div', { class: 'status warn' }, `📶 Fără semnal – ${n} în așteptare. Se trimit singure când revine internetul.`)
        : Q.error ? h('div', { class: 'status warn' }, `⏳ ${n} în așteptare – ${Q.error}`)
        : h('div', { class: 'status busy' }, `⏳ Se trimit ${n}…`));
    pendingBox.replaceChildren();
    recentBox.replaceChildren();
    if (n || recent.length) {
      recentBox.append(h('h2', {}, 'Ultimele'),
        gallery(recent, { pending: Q.items, onChange: () => onQueueChange() }));
    }
  };

  fill(view, 
    h('div', { class: 'hello' }, `Salut, ${state.user.name.split(' ')[0]} 👋`),
    h('button', { class: 'site-pick' + (site ? '' : ' none'), onclick: () => pickSite((id) => {
        state.siteId = id;
        localStorage.setItem('siteId', id ?? '');
        screenFoto();
      }, state.siteId) },
      h('div', { class: 'grow', style: 'flex:1;min-width:0' },
        h('div', { class: 'lbl' }, 'Șantier'),
        h('div', { class: 'nm' }, site ? site.name : 'Fără șantier')),
      h('span', { class: 'chev' }, '›')),
    h('button', { class: 'shoot', onclick: () => $('#cam').click() }, h('span', { class: 'ic' }, '📷'), 'Fă poză'),
    h('div', { class: 'actions2' },
      h('button', { class: 'btn', onclick: () => $('#gal').click() }, '🖼 Din galerie'),
      h('button', { class: 'btn', onclick: noteSheet }, '📝 Doar notă')),
    h('div', { class: 'comment-box' },
      h('textarea', { id: 'comment', rows: 1, placeholder: '💬 Comentariu (opțional)' })),
    status, pendingBox, recentBox);
  onQueueChange();
}

function noteSheet() {
  sheet((box, close) => {
    const site = state.sites.find((s) => s.id === state.siteId);
    const ta = h('textarea', { rows: 5, placeholder: 'Ex: Lipsește material, betonul vine mâine la 8…' });
    box.append(h('h2', {}, '📝 Notă'), h('p', { class: 'muted small' }, 'Șantier: ' + (site ? site.name : 'Fără șantier')), ta,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn grow', onclick: close }, 'Renunță'),
        h('button', { class: 'btn primary grow', onclick: async () => {
          const t = ta.value.trim();
          if (!t) return ta.focus();
          close();
          await enqueue({ clientId: uid(), kind: 'note', siteId: state.siteId, comment: t, takenAt: new Date().toISOString() });
          toast('✓ Notă trimisă');
        } }, 'Trimite')));
    setTimeout(() => ta.focus(), 50);
  });
}

async function screenPoze() {
  const params = {};
  const content = h('div');
  const filters = h('div', { class: 'filters' });
  fill(view, h('h1', {}, 'Poze'), filters, content);
  const draw = () => fill(content, feed({ ...params }));
  draw(); // pozele încep să se încarce imediat
  {
    // muncitorul vede doar șantierele lui (din /api/me); adminul/responsabilul și pe cele arhivate
    const sites = can.manage() ? (await api('api/sites?lite=1').catch(() => ({ sites: state.sites }))).sites : state.sites;
    const sel = h('select', { onchange: () => { if (sel.value) params.site = sel.value; else delete params.site; draw(); } },
      h('option', { value: '' }, 'Toate șantierele'),
      sites.map((s) => h('option', { value: s.id }, s.name + (s.archived ? ' (arhivat)' : ''))),
      h('option', { value: 'none' }, 'Fără șantier'));
    const me = h('select', { onchange: () => { if (me.value) params.mine = 1; else delete params.mine; draw(); } },
      h('option', { value: '' }, 'Toată echipa'), h('option', { value: '1' }, 'Doar ale mele'));
    filters.append(sel, me);
  }
}

async function screenSantiere() {
  fill(view, h('div', { class: 'top' }, h('h1', {}, 'Șantiere'),
    h('button', { class: 'btn primary sm', onclick: () => editSite(null) }, '+ Nou')), h('p', { class: 'muted' }, 'Se încarcă…'));
  const { sites, unassigned } = await api('api/sites');
  const active = sites.filter((s) => !s.archived), archived = sites.filter((s) => s.archived);
  const rows = [];
  const card = (s) => { const el = h('button', { class: 'item', onclick: () => { location.hash = 'santier/' + s.id; } },
    h('div', { class: 'cover' }, s.cover_id ? lazyImg(fileUrl({ id: s.cover_id, client_id: s.cover_v }, 'thumb')) : '🏗'),
    h('div', { class: 'txt' },
      h('div', { class: 't' }, s.name),
      h('div', { class: 's' }, [s.address, `${s.count} ${s.count === 1 ? 'poză' : 'poze'}`, s.last_at ? 'ultima ' + fmtShort(s.last_at) : null].filter(Boolean).join(' · ')),
      h('div', { class: 's' }, s.users.length ? '👷 ' + s.users.map((u) => u.name.split(' ')[0]).join(', ') : 'Nimeni atribuit')),
    h('span', { class: 'chev muted' }, '›'));
    rows.push({ el, text: [s.name, s.address, ...s.users.map((u) => u.name)].join(' ') });
    return el; };
  const activeCards = active.map(card), archivedCards = archived.map(card);
  view.lastChild.replaceWith(h('div', {},
    searchBox(rows, 'Caută șantier, adresă sau persoană…'),
    !sites.length ? h('div', { class: 'empty' }, h('div', { class: 'big' }, '🏗'), 'Niciun șantier. Apasă „+ Nou”.') : null,
    h('div', { class: 'list' }, activeCards,
      unassigned ? h('button', { class: 'item', onclick: () => { location.hash = 'santier/none'; } },
        h('div', { class: 'cover' }, '❓'), h('div', { class: 'txt' }, h('div', { class: 't' }, 'Fără șantier'),
          h('div', { class: 's' }, `${unassigned} de atribuit`))) : null),
    archived.length ? [h('h2', {}, 'Arhivate'), h('div', { class: 'list' }, archivedCards)] : null));
}

async function screenSantier(id) {
  if (id === 'none') {
    fill(view, h('div', { class: 'top' }, h('button', { class: 'icon-btn', onclick: () => history.back() }, '‹'), h('h1', {}, 'Fără șantier')),
      h('p', { class: 'muted small' }, 'Deschide o poză și apasă „🏗 Șantier” ca s-o muți.'), feed({ site: 'none' }));
    return;
  }
  const { sites } = await api('api/sites?id=' + Number(id));
  const s = sites.find((x) => x.id === Number(id));
  if (!s) { location.hash = 'santiere'; return; }
  fill(view, 
    h('div', { class: 'top' },
      h('button', { class: 'icon-btn', onclick: () => { location.hash = 'santiere'; } }, '‹'),
      h('h1', {}, s.name),
      h('button', { class: 'btn sm', onclick: () => editSite(s) }, '✏️ Editează')),
    s.address ? h('p', { class: 'muted', style: 'margin-top:-8px' }, '📍 ', s.address) : null,
    h('p', { class: 'muted small' }, '👷 ', s.users.length ? s.users.map((u) => u.name).join(', ') : 'Nimeni atribuit'),
    h('button', { class: 'btn primary block', onclick: () => { state.siteId = s.id; localStorage.setItem('siteId', s.id); $('#cam').click(); location.hash = ''; } }, '📷 Fă poză aici'),
    h('div', { style: 'margin-top:8px' }, feed({ site: s.id })));
}

async function editSite(s) {
  const users = await api('api/users');
  const sel = new Set((s?.users || []).map((u) => u.id));
  sheet((box, close) => {
    const name = h('input', { value: s?.name || '', placeholder: 'Ex: Vila Popescu, Str. Lalelelor 4' });
    const addr = h('input', { value: s?.address || '', placeholder: 'Opțional' });
    const err = h('div', { class: 'error' });
    const peopleRows = [];
    const checks = h('div', { class: 'checks' }, users.filter((u) => u.id !== state.user.id || can.admin()).filter((u) => u.active !== 0)
      .sort((a, b) => sel.has(b.id) - sel.has(a.id)) // cei deja atribuiți primii
      .map((u) => { const el = h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: sel.has(u.id), onchange: (e) => (e.target.checked ? sel.add(u.id) : sel.delete(u.id)) }),
        h('span', { style: 'flex:1' }, u.name), h('span', { class: 'badge ' + u.role }, ROLE_LABEL[u.role]));
        peopleRows.push({ el, text: u.name + ' ' + ROLE_LABEL[u.role] }); return el; }));
    const save = async () => {
      err.textContent = '';
      try {
        const body = { name: name.value, address: addr.value, userIds: [...sel] };
        if (s) await api('api/sites/' + s.id, { method: 'PATCH', json: body });
        else {
          const r = await api('api/sites', { method: 'POST', json: body });
          location.hash = 'santier/' + r.id;
        }
        close();
        await refreshMe();
        route();
        toast('✓ Salvat');
      } catch (e) { err.textContent = e.message; }
    };
    box.append(h('h2', {}, s ? 'Editează șantierul' : 'Șantier nou'),
      h('label', { class: 'f' }, h('span', {}, 'Nume'), name),
      h('label', { class: 'f' }, h('span', {}, 'Adresă'), addr),
      h('div', { class: 'f' }, h('span', {}, 'Cine lucrează aici'), searchBox(peopleRows, 'Caută persoana…'), checks),
      err,
      h('button', { class: 'btn primary block', onclick: save }, 'Salvează'),
      s ? h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { class: 'btn grow', onclick: async () => {
          await api('api/sites/' + s.id, { method: 'PATCH', json: { archived: !s.archived } });
          close(); await refreshMe(); location.hash = 'santiere'; toast(s.archived ? 'Șantier reactivat' : 'Șantier arhivat');
        } }, s.archived ? '♻️ Reactivează' : '📦 Arhivează'),
        can.admin() ? h('button', { class: 'btn danger grow', onclick: async () => {
          if (!confirm(`Ștergi șantierul „${s.name}”? Pozele rămân, la „Fără șantier”.`)) return;
          await api('api/sites/' + s.id, { method: 'DELETE' });
          close(); await refreshMe(); location.hash = 'santiere';
        } }, '🗑 Șterge') : null) : null);
    if (!s) setTimeout(() => name.focus(), 50);
  });
}

async function screenEchipa() {
  fill(view, h('div', { class: 'top' }, h('h1', {}, 'Echipa'),
    h('button', { class: 'btn primary sm', onclick: () => editUser(null) }, '+ Persoană')), h('p', { class: 'muted' }, 'Se încarcă…'));
  const [users, { sites }] = await Promise.all([api('api/users'), api('api/sites?lite=1')]);
  const rows = [];
  const list = h('div', { class: 'list' }, users.map((u) => { const el = h('button', { class: 'item', onclick: () => editUser(u, sites) },
    h('div', { class: 'cover', style: 'border-radius:50%;background:#e0e7ff;font-weight:800;font-size:20px;color:#1f4fd8' }, u.name.slice(0, 1).toUpperCase()),
    h('div', { class: 'txt' },
      h('div', { class: 't' }, u.name),
      h('div', { class: 's' }, `@${u.username} · ${u.count} poze · ${u.role === 'admin' ? 'toate șantierele' : u.siteIds.length + ' șantiere'}`)),
    h('span', { class: 'badge ' + (u.active ? u.role : 'off') }, u.active ? ROLE_LABEL[u.role] : 'Dezactivat'));
    rows.push({ el, text: [u.name, u.username, ROLE_LABEL[u.role]].join(' ') });
    return el; }));
  view.lastChild.replaceWith(h('div', {}, searchBox(rows, 'Caută după nume, utilizator sau rol…'), list));
}

async function editUser(u, sites) {
  sites = sites || (await api('api/sites?lite=1')).sites;
  const sel = new Set(u?.siteIds || []);
  let role = u?.role || 'muncitor';
  sheet((box, close) => {
    const name = h('input', { value: u?.name || '', placeholder: 'Ex: Ion Popescu' });
    const user = h('input', { value: u?.username || '', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: 'Ex: ion' });
    const pass = h('input', { type: 'text', autocomplete: 'off', placeholder: u ? 'Lasă gol ca să nu schimbi' : 'Minim 4 caractere' });
    const err = h('div', { class: 'error' });
    const seg = h('div', { class: 'seg' });
    const siteRows = [];
    const siteChecks = h('div', { class: 'checks' }, sites.filter((s) => !s.archived)
      .sort((a, b) => sel.has(b.id) - sel.has(a.id)) // cele deja atribuite primele
      .map((s) => { const el = h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: sel.has(s.id), onchange: (e) => (e.target.checked ? sel.add(s.id) : sel.delete(s.id)) }),
        h('span', {}, s.name));
        siteRows.push({ el, text: s.name + ' ' + (s.address || '') }); return el; }));
    const siteBox = h('div', { class: 'f' }, h('span', {}, 'Șantiere atribuite'), searchBox(siteRows, 'Caută șantierul…'), siteChecks);
    const help = h('p', { class: 'muted small' });
    const drawSeg = () => {
      seg.replaceChildren(...['muncitor', 'responsabil', 'admin'].map((r) => h('button', { type: 'button', class: role === r ? 'on' : '', onclick: () => { role = r; drawSeg(); } }, ROLE_LABEL[r])));
      siteBox.hidden = role === 'admin';
      help.textContent = {
        muncitor: 'Face poze pe șantierele atribuite (sau fără șantier). Vede pozele lui și pe cele de pe șantierele lui. Șterge doar pozele lui.',
        responsabil: 'Vede pozele de pe șantierele lui, poate crea șantiere și atribui oameni. Șterge doar pozele lui.',
        admin: 'Acces la tot: toate șantierele, echipa și Google Drive.',
      }[role];
    };
    drawSeg();
    const save = async () => {
      err.textContent = '';
      try {
        const body = { name: name.value, username: user.value, role, siteIds: [...sel] };
        if (pass.value) body.password = pass.value;
        if (u) await api('api/users/' + u.id, { method: 'PATCH', json: body });
        else await api('api/users', { method: 'POST', json: { ...body, password: pass.value } });
        close();
        if (u?.id === state.user.id || sel.size) await refreshMe();
        screenEchipa();
        toast(u ? '✓ Salvat' : `✓ Cont creat. Dă-i lui ${name.value.split(' ')[0]} utilizatorul și parola.`);
      } catch (e) { err.textContent = e.message; }
    };
    box.append(h('h2', {}, u ? 'Editează persoana' : 'Persoană nouă'),
      h('label', { class: 'f' }, h('span', {}, 'Nume'), name),
      h('label', { class: 'f' }, h('span', {}, 'Utilizator (pentru logare)'), user),
      h('label', { class: 'f' }, h('span', {}, u ? 'Parolă nouă' : 'Parolă'), pass),
      h('label', { class: 'f' }, h('span', {}, 'Rol'), seg), help,
      siteBox, err,
      h('button', { class: 'btn primary block', onclick: save }, 'Salvează'),
      u && u.id !== state.user.id ? h('button', { class: 'btn block ' + (u.active ? 'danger' : ''), style: 'margin-top:10px', onclick: async () => {
        await api('api/users/' + u.id, { method: 'PATCH', json: { active: !u.active } });
        close(); screenEchipa(); toast(u.active ? 'Cont dezactivat' : 'Cont reactivat');
      } }, u.active ? '🚫 Dezactivează contul' : '✅ Reactivează contul') : null);
    if (!u) setTimeout(() => name.focus(), 50);
  });
}

async function screenCont(query) {
  const u = state.user;
  const versionInfo = h('span', {}, 'aplicație v' + APP_VERSION);
  api('api/state').then((st) => {
    if (st.version === APP_VERSION) versionInfo.append(' · server v' + st.version + ' ✓');
    else versionInfo.append(h('b', { style: 'color:var(--red)' }, ` · server ${st.version ? 'v' + st.version : 'vechi'} – urcă api.php nou!`));
  }).catch(() => {});
  const box = h('div', {},
    h('h1', {}, 'Cont'),
    h('div', { class: 'card' }, h('div', { class: 'kv' },
      h('b', {}, 'Nume'), h('span', {}, u.name),
      h('b', {}, 'Utilizator'), h('span', {}, '@' + u.username),
      h('b', {}, 'Rol'), h('span', {}, ROLE_LABEL[u.role]),
      h('b', {}, 'Șantiere'), h('span', {}, can.admin() ? 'toate' : state.sites.map((s) => s.name).join(', ') || '—'),
      h('b', {}, 'Versiune'), versionInfo)),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn grow', onclick: changePassword }, '🔑 Schimbă parola'),
      h('button', { class: 'btn grow danger', onclick: async () => {
        if (Q.items.length && !confirm(`Mai ai ${Q.items.length} poze netrimise. Ieși oricum? (rămân în telefon)`)) return;
        await api('api/logout', { method: 'POST' }); caches.delete(IMG_CACHE).catch(() => {}); localStorage.removeItem('me'); localStorage.removeItem(FEEDS_KEY); feedMem.clear(); state.user = null; route();
      } }, 'Ieșire')));
  fill(view, box);
  if (can.admin()) box.append(await driveCard(query));
}

async function driveCard(query) {
  const d = await api('api/drive');
  const res = new URLSearchParams(query).get('drive');
  if (res) { toast(res === 'ok' ? '✓ Google Drive conectat' : 'Google Drive: ' + res); history.replaceState(null, '', '#cont'); }
  const card = h('div', { class: 'card' });
  card.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, '☁️ Google Drive'),
    h('span', { class: 'badge ' + (d.connected ? 'responsabil' : 'off') }, d.connected ? 'Conectat' : 'Neconectat')));
  const redirect = h('p', { class: 'small' }, 'Adresa de redirecționare (pentru Google Cloud): ',
    h('code', { style: 'word-break:break-all;user-select:all;-webkit-user-select:all' }, d.redirectUri),
    ' ', h('button', { class: 'btn sm', onclick: () => navigator.clipboard?.writeText(d.redirectUri).then(() => toast('✓ Copiat')) }, '📋 Copiază'));
  if (!d.configured && d.editable) {
    const id = h('input', { placeholder: '….apps.googleusercontent.com', autocapitalize: 'none', spellcheck: 'false' });
    const sec = h('input', { placeholder: 'GOCSPX-…', autocapitalize: 'none', spellcheck: 'false' });
    const err = h('div', { class: 'error' });
    card.append(h('p', { class: 'muted small' }, 'Pozele se salvează pe server. Pentru copie automată în Google Drive, creează un „OAuth client” în Google Cloud (pașii sunt în README) și pune datele aici.'),
      redirect,
      h('label', { class: 'f' }, h('span', {}, 'Client ID'), id),
      h('label', { class: 'f' }, h('span', {}, 'Client secret'), sec), err,
      h('button', { class: 'btn primary block', onclick: async () => {
        try { await api('api/drive/config', { method: 'POST', json: { clientId: id.value, clientSecret: sec.value } }); screenCont(); }
        catch (e) { err.textContent = e.message; }
      } }, 'Salvează'));
  } else if (!d.configured) {
    card.append(h('p', { class: 'muted small' }, 'Pozele se salvează pe server. Pentru copie automată în Google Drive, setează pe server GOOGLE_CLIENT_ID și GOOGLE_CLIENT_SECRET (vezi README).'), redirect);
  } else if (!d.connected) {
    card.append(h('p', { class: 'muted small' }, `Fiecare poză va fi copiată automat în Drive, în folderul „${d.folder}”, cu un subfolder pentru fiecare șantier.`),
      redirect,
      h('p', { class: 'muted small' }, 'Adresa de mai sus trebuie pusă exact la fel în Google Cloud → Clients → clientul tău → Authorized redirect URIs.'),
      h('a', { class: 'btn primary block', href: 'api/drive/connect' }, 'Conectează Google Drive'),
      d.editable ? h('button', { class: 'btn block', style: 'margin-top:8px', onclick: async () => {
        await api('api/drive/config', { method: 'POST', json: { clientId: '', clientSecret: '' } }); screenCont();
      } }, 'Schimbă Client ID / secret') : null);
  } else {
    card.append(
      d.enabled !== undefined ? toggleRow('Copiază automat pozele în Google Drive', d.enabled, 'api/drive/enabled') : null,
      h('p', { class: 'small' }, `Folder: „${d.folder}” / <șantier>. `, d.enabled === false ? '⏸ În pauză.' : d.pending ? `⏳ ${d.pending} poze de copiat.` : '✓ Toate pozele sunt copiate.'),
      d.lastError ? h('p', { class: 'error small' }, 'Ultima eroare: ' + d.lastError) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: async () => { await api('api/drive/sync', { method: 'POST' }); toast('Sincronizare pornită'); } }, '🔄 Sincronizează'),
        h('button', { class: 'btn grow danger', onclick: async () => {
          if (!confirm('Deconectezi Google Drive? Pozele rămân pe server și în Drive.')) return;
          await api('api/drive/disconnect', { method: 'POST' }); screenCont();
        } }, 'Deconectează')));
  }
  return h('div', {}, h('h2', {}, 'Stocare'),
    h('p', { class: 'muted small' }, 'Pozele se salvează mereu pe server. Alege unde să fie copiate automat: Google Drive, NAS sau ambele.'),
    card, d.nas ? nasCard(d.nas) : null);
}

function toggleRow(label, on, url) {
  const cb = h('input', { type: 'checkbox', checked: on, onchange: async () => {
    try { await api(url, { method: 'POST', json: { enabled: cb.checked } }); toast(cb.checked ? '✓ Pornit' : '⏸ Pus pe pauză'); screenCont(); }
    catch (e) { cb.checked = !cb.checked; toast(e.message); }
  } });
  return h('label', { class: 'check', style: 'margin:10px 0' }, cb, h('span', { style: 'flex:1;font-weight:600' }, label));
}

function nasCard(n, editing = false) {
  const card = h('div', { class: 'card', style: 'margin-top:12px' });
  card.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, '🗄 NAS (Synology, QNAP…)'),
    h('span', { class: 'badge ' + (n.configured ? (n.enabled ? 'responsabil' : 'off') : 'off') }, n.configured ? (n.enabled ? 'Activ' : 'Pauză') : 'Neconfigurat')));
  if (n.configured && !editing) {
    card.append(
      toggleRow('Copiază automat pozele pe NAS', n.enabled, 'api/nas/enabled'),
      h('p', { class: 'small', style: 'word-break:break-all' }, `${n.url} / ${n.folder} / <șantier>`, h('br'), `Utilizator: ${n.user}. `,
        !n.enabled ? '⏸ În pauză.' : n.pending ? `⏳ ${n.pending} poze de copiat.` : '✓ Toate pozele sunt copiate.'),
      n.lastError ? h('p', { class: 'error small' }, 'Ultima eroare: ' + n.lastError) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onclick: async () => { await api('api/drive/sync', { method: 'POST' }); toast('Sincronizare pornită'); setTimeout(screenCont, 1500); } }, '🔄 Sincronizează'),
        h('button', { class: 'btn grow', onclick: () => card.replaceWith(nasCard(n, true)) }, '✏️ Modifică'),
        h('button', { class: 'btn grow danger', onclick: async () => {
          if (!confirm('Elimini NAS-ul din aplicație? Pozele rămân pe server și pe NAS.')) return;
          await api('api/nas/remove', { method: 'POST' }); screenCont();
        } }, 'Elimină')));
    return card;
  }
  const url = h('input', { value: n.url, placeholder: 'https://numele-tau.synology.me:5006/photo', autocapitalize: 'none', spellcheck: 'false', inputmode: 'url' });
  const user = h('input', { value: n.user, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'off' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: n.configured ? 'Lasă gol ca să rămână aceeași' : '' });
  const insecure = h('input', { type: 'checkbox', checked: n.insecure });
  const err = h('div', { class: 'error' });
  const btn = h('button', { class: 'btn primary block', onclick: async () => {
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Se testează conexiunea…';
    try {
      await api('api/nas/config', { method: 'POST', json: { url: url.value, user: user.value, password: pass.value, insecure: insecure.checked } });
      toast('✓ NAS conectat. Pozele se copiază.'); screenCont();
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Testează și salvează'; }
  } }, 'Testează și salvează');
  card.append(
    h('p', { class: 'muted small' }, 'Pe NAS pornește WebDAV (Synology: Centru de pachete → WebDAV Server, port HTTPS 5006). Adresa e a unui folder partajat. Pașii sunt în README.'),
    h('label', { class: 'f' }, h('span', {}, 'Adresa WebDAV (cu folderul)'), url),
    h('label', { class: 'f' }, h('span', {}, 'Utilizator NAS'), user),
    h('label', { class: 'f' }, h('span', {}, 'Parolă NAS'), pass),
    h('label', { class: 'check', style: 'margin-bottom:12px' }, insecure, h('span', { class: 'small' }, 'NAS-ul are certificat propriu (self-signed). Bifează doar dacă testul dă eroare de certificat.')),
    err, btn,
    editing ? h('button', { class: 'btn block', style: 'margin-top:8px', onclick: () => card.replaceWith(nasCard(n)) }, 'Renunță') : null);
  return card;
}

function changePassword() {
  sheet((box, close) => {
    const old = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'error' });
    box.append(h('h2', {}, 'Schimbă parola'),
      h('label', { class: 'f' }, h('span', {}, 'Parola actuală'), old),
      h('label', { class: 'f' }, h('span', {}, 'Parola nouă'), nw), err,
      h('button', { class: 'btn primary block', onclick: async () => {
        try { await api('api/password', { method: 'POST', json: { old: old.value, password: nw.value } }); close(); toast('✓ Parola a fost schimbată'); }
        catch (e) { err.textContent = e.message; }
      } }, 'Salvează'));
  });
}

// ============ navigare ============
function tabs() {
  const t = [['', '📷', 'Foto'], ['poze', '🖼', 'Poze']];
  if (can.manage()) t.push(['santiere', '🏗', 'Șantiere']);
  if (can.admin()) t.push(['echipa', '👷', 'Echipa']);
  t.push(['cont', '⚙️', 'Cont']);
  const cur = location.hash.slice(1).split(/[/?]/)[0];
  const active = cur === 'santier' ? 'santiere' : cur;
  const nav = $('#tabs');
  nav.hidden = false;
  document.body.classList.remove('no-tabs');
  nav.replaceChildren(...t.map(([k, i, l]) => h('a', { href: '#' + k, class: active === k ? 'on' : '' }, h('span', { class: 'i' }, i), l)));
}

async function route() {
  if (!state.user) {
    const s = await api('api/state').catch(() => ({}));
    return screenLogin(s.needsSetup);
  }
  document.querySelectorAll('.viewer, .overlay').forEach((el) => el.remove());
  // oprește descărcările neterminate ale ecranului vechi, ca să nu încetinească ecranul nou
  for (const img of view.querySelectorAll('img')) {
    if (img.dataset.src) lazyIO?.unobserve(img);
    if (!img.complete) img.removeAttribute('src');
  }
  tabs();
  const [path, query] = location.hash.slice(1).split('?');
  const [page, arg] = path.split('/');
  window.scrollTo(0, 0);
  try {
    if (page === 'poze') await screenPoze();
    else if (page === 'santiere' && can.manage()) await screenSantiere();
    else if (page === 'santier' && can.manage()) await screenSantier(arg);
    else if (page === 'echipa' && can.admin()) await screenEchipa();
    else if (page === 'cont' || page === 'setari') await screenCont(query);
    else screenFoto();
  } catch (e) {
    if (e.status !== 401) fill(view, h('div', { class: 'empty' }, h('div', { class: 'big' }, '📶'), e.message === 'Failed to fetch' ? 'Fără internet. Poți face poze în continuare din ecranul Foto.' : e.message));
  }
}
window.addEventListener('hashchange', route);

async function refreshMe() {
  const me = await api('api/me');
  state.user = me.user;
  state.sites = me.sites;
  localStorage.setItem('me', JSON.stringify(me));
  if (state.siteId != null && !state.sites.some((s) => s.id === state.siteId)) state.siteId = null;
}

async function boot() {
  const saved = localStorage.getItem('siteId');
  state.siteId = saved ? Number(saved) : null;
  const cached = JSON.parse(localStorage.getItem('me') || 'null');
  if (cached?.user) {
    // Pornire instantanee cu ultimele date știute; le verificăm cu serverul în fundal.
    state.user = cached.user; state.sites = cached.sites;
    if (state.siteId != null && !state.sites.some((x) => x.id === state.siteId)) state.siteId = null;
    await route();
    pump();
    const before = JSON.stringify(cached);
    refreshMe().then(() => {
      if (JSON.stringify({ user: state.user, sites: state.sites }) === before) return; // nimic nou
      const c = $('#comment')?.value;
      route().then(() => { if (c && $('#comment')) $('#comment').value = c; });
    }).catch(() => {});
    return;
  }
  try {
    await refreshMe();
  } catch (e) {
    if (e.status === 401) { state.user = null; localStorage.removeItem('me'); }
    else {
      // fără internet: pornim cu ultimele date știute, ca să se poată face poze
      const cached = JSON.parse(localStorage.getItem('me') || 'null');
      if (cached) { state.user = cached.user; state.sites = cached.sites; }
    }
  }
  await route();
  if (state.user) pump();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
boot();
