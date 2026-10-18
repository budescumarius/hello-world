'use strict';
/* Noyau de l'application : API, routeur, mise en page, fenêtres, formulaires et tableaux. */

// ---------------------------------------------------------------- État global
const S = { me: null, users: [], settings: {}, ready: false };
const app = document.getElementById('app');

// ---------------------------------------------------------------- Utilitaires
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? 0 : x; };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const DAY = 864e5;
const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const dstr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (s, k) => dstr(dnum(s) + k);
const fmtDate = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const fmtDT = (s) => (s ? `${fmtDate(s)} ${String(s).slice(11, 16)}` : '');
const fnum = (x, d = 2) => (x || 0).toLocaleString('fr-BE', { maximumFractionDigits: d });
let _fmt; let _fmtCur;
function money(x) {
  const cur = (S.settings.company || {}).currency || 'EUR';
  if (_fmtCur !== cur) {
    _fmtCur = cur;
    try { _fmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: cur }); } catch (e) { _fmt = { format: (v) => `${fnum(v)} ${cur}` }; }
  }
  return _fmt.format(r2(x) || 0);
}
const isAdmin = () => S.me && (S.me.role === 'admin' || !!S.me.super);
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || '—';
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (id) => { const u = S.users.find((x) => x.id === id); return u ? `<span class="avatar" style="--c:${esc(u.color)}" title="${esc(u.name)}">${esc(initials(u.name))}</span>` : ''; };
function debounce(fn, ms = 500) {
  let t; let pending = false;
  const d = (...a) => { clearTimeout(t); pending = true; t = setTimeout(() => { pending = false; fn(...a); }, ms); };
  // flush : n'enregistre que s'il reste une modification en attente
  d.flush = () => { clearTimeout(t); if (!pending) return Promise.resolve(); pending = false; return fn(); };
  return d;
}

let toastTimer;
function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- API
async function api(method, path, body) {
  const opt = { method, headers: { 'X-Requested-With': 'batipro' }, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('api.php?r=' + path, opt); } catch (e) { throw new Error('Pas de connexion au serveur'); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse vide */ }
  if (res.status === 401 && S.ready) { S.ready = false; showLogin(); }
  if (!res.ok) { const err = new Error((data && data.error) || `Erreur ${res.status}`); err.status = res.status; err.conflict = data && data.conflict; throw err; }
  return data;
}
const db = {
  list: (type, opt = {}) => api('GET', `items/${type}${opt.project != null ? `&project=${opt.project}` : ''}${opt.parent != null ? `&parent=${opt.parent}` : ''}`),
  many: (types, project) => api('GET', `items&types=${types.join(',')}${project != null ? `&project=${project}` : ''}`),
  get: (type, id) => api('GET', `items/${type}/${id}`),
  async save(type, it, opt = {}) {
    try {
      if (it.id) return await api('PUT', `items/${type}/${it.id}`, { data: it.data, version: it.version, project_id: it.project_id ?? null, number: it.number, silent: opt.silent, force: opt.force });
      return await api('POST', `items/${type}`, { data: it.data, project_id: it.project_id ?? null, parent_id: it.parent_id ?? null });
    } catch (e) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nOK = écraser avec vos modifications\nAnnuler = recharger la version de l'autre utilisateur`)) return db.save(type, it, { ...opt, force: true });
        render();
      }
      throw e;
    }
  },
  del: (type, id) => api('DELETE', `items/${type}/${id}`),
};
// Sauvegarde d'un élément en place : met à jour id / version / numéro mais garde le même objet `data`,
// que les éditeurs ouverts continuent de modifier.
async function persist(type, it, opt) {
  const r = await db.save(type, it, opt);
  const { data, ...meta } = r;
  Object.assign(it, meta);
  if (!it.data) it.data = data;
  return it;
}

async function upload(file, projectId) {
  const fd = new FormData();
  fd.append('file', file);
  if (projectId) fd.append('project_id', projectId);
  return api('POST', 'files', fd);
}
const fileUrl = (id, dl) => `api.php?r=files/${id}${dl ? '&download=1' : ''}`;
const delFile = (id) => (id ? api('DELETE', `files/${id}`).catch(() => {}) : null);

function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    // l'élément reste dans la page le temps de la lecture : certains navigateurs perdent l'accès au fichier sinon
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple; inp.hidden = true;
    document.body.appendChild(inp);
    inp.onchange = () => { res([...inp.files]); setTimeout(() => inp.remove(), 120000); };
    inp.click();
  });
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image illisible')); i.src = src; }); }
async function blobToImg(blob) { const u = URL.createObjectURL(blob); try { return await loadImg(u); } finally { URL.revokeObjectURL(u); } }
function canvasToBlob(c, type = 'image/jpeg', q = 0.88) { return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Conversion échouée'))), type, q)); }
async function resizeImage(img, max, type = 'image/jpeg', q = 0.86) {
  const r = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * r); c.height = Math.round((img.naturalHeight || img.height) * r);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
  return { blob: await canvasToBlob(c, type, q), w: c.width, h: c.height };
}
// Photo : réduite côté navigateur avant l'envoi
async function uploadPhoto(file, projectId, max = 1800) {
  try {
    const r = await resizeImage(await blobToImg(file), max);
    return upload(new File([r.blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), projectId);
  } catch (e) { return upload(file, projectId); }
}

// ---------------------------------------------------------------- Icônes
const ic = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  spark: ic('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  hist: ic('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  eye: ic('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  percent: ic('<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  chat: ic('<path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1121 12z"/>'),
  more: ic('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  upload: ic('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: ic('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  send: ic('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>'),
  dash: ic('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  contacts: ic('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17c.8-2 2.2-3 4-3s3.2 1 4 3"/>'),
  target: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  calc: ic('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2M12 11h2M16 11v6M8 15h2M12 15h2M8 19h6"/>'),
  book: ic('<path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22.5z"/><path d="M8 7h8M8 11h6"/>'),
  fiche: ic('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'),
  truck: ic('<path d="M1 4h14v12H1zM15 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'),
  crane: ic('<path d="M3 21h8M7 21V4M7 4h13M7 8l5-4M17 4v6M15 10h4v3h-4z"/>'),
  tool: ic('<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'),
  install: ic('<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 9v6M11 9v6M15 9v6M19 9v6"/>'),
  tasks: ic('<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  calendar: ic('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2"/>'),
  coins: ic('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  people: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.4 3.6-5 7-5s6.2 1.6 7 5M16 4.5a3.5 3.5 0 010 7M18 15c2 .6 3.4 2.2 4 5"/>'),
  chart: ic('<path d="M12 3v9l7 4"/><path d="M21 12A9 9 0 1112 3"/>'),
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  minus: ic('<path d="M5 12h14"/>', 'stroke-width="2.4"'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  chevron: ic('<path d="M6 9l6 6 6-6"/>'),
  back: ic('<path d="M15 18l-6-6 6-6"/>'),
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  print: ic('<path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v8H6z"/>'),
  edit: ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  trash: ic('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  camera: ic('<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>'),
  file: ic('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>'),
  menu: ic('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  logout: ic('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'),
  fit: ic('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  pencil: ic('<path d="M3 21c3-1 5-3 7-5M14.5 4.5l5 5L9 20H4v-5z"/>'),
  filter: ic('<path d="M3 5h18l-7 8v6l-4-2v-4z"/>'),
  mail: ic('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'),
  pin: ic('<path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  copy: ic('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
  bell: ic('<path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/>'),
  collapse: ic('<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>'),
};

// ---------------------------------------------------------------- Menu latéral
const MENU = [
  { k: 'dashboard', l: 'Tableau de bord', i: 'dash', h: '#/dashboard' },
  { k: 'contacts', l: 'Contacts', i: 'contacts', sub: [['Clients', '#/contacts/client'], ['Prospects', '#/contacts/prospect'], ['Fournisseurs', '#/contacts/fournisseur'], ['Sous-traitants', '#/contacts/soustraitant'], ['Tous les contacts', '#/contacts/all']] },
  { k: 'opportunities', l: 'Opportunités', i: 'target', h: '#/opportunities' },
  { k: 'quotes', l: 'Devis', i: 'calc', h: '#/quotes' },
  { k: 'library', l: 'Bibliothèque', i: 'book', h: '#/library' },
  { k: 'fiches', l: 'Fiches Tech.', i: 'fiche', sub: [['Fiches techniques', '#/fiches'], ['Dossiers de fin de chantier', '#/fiches/dossiers']] },
  { k: 'orders', l: 'Commandes', i: 'truck', sub: [['Commandes fournisseurs', '#/orders/fournisseur'], ['Commandes sous-traitants', '#/orders/soustraitant']] },
  { k: 'projects', l: 'Chantiers', i: 'crane', h: '#/projects' },
  { k: 'interventions', l: 'Intervention', i: 'tool', h: '#/interventions' },
  { k: 'installations', l: 'Installations', i: 'install', h: '#/installations' },
  { k: 'tasks', l: 'Tâches', i: 'tasks', h: '#/tasks' },
  { k: 'planning', l: 'Plannings', i: 'calendar', sub: [['Planning des chantiers', '#/planning/projects'], ['Planning des équipes', '#/planning/team']] },
  { k: 'finances', l: 'Finances', i: 'coins', sub: [['Factures clients', '#/invoices'], ['Paiements reçus', '#/payments'], ['Factures fournisseurs', '#/expenses']] },
  { k: 'hr', l: 'RH', i: 'people', sub: [['Personnel', '#/hr/staff'], ['Pointage', '#/hr/timesheets'], ['Absences', '#/hr/absences']] },
  { k: 'stats', l: 'Statistiques', i: 'chart', h: '#/stats' },
];
const ui = (() => { try { return JSON.parse(localStorage.getItem('bp-ui') || '{}'); } catch (e) { return {}; } })();
const saveUi = () => { try { localStorage.setItem('bp-ui', JSON.stringify(ui)); } catch (e) { /* stockage indisponible */ } };

function sidebar(active) {
  const company = S.settings.company || {};
  const hash = location.hash;
  return `<aside class="side ${ui.collapsed ? 'collapsed' : ''}" id="side">
    <div class="side-head"><a class="brand" href="#/dashboard">${company.logoId ? `<img src="${fileUrl(company.logoId)}" alt="">` : '<span class="brand-mark"></span>'}<span>${esc(company.appName || company.name || 'BâtiPro')}</span></a>
      <button class="side-toggle" data-act="collapse" title="Réduire le menu">${I.collapse}</button></div>
    <button class="side-search" data-act="search">${I.search}<span>Actions</span><kbd>⌘</kbd><kbd>K</kbd></button>
    <nav class="side-nav">${MENU.map((m) => {
      const open = m.k === active || (ui.open || {})[m.k];
      if (!m.sub) return `<a class="nav ${m.k === active ? 'on' : ''}" href="${m.h}" title="${esc(m.l)}">${I[m.i]}<span>${m.l}</span></a>`;
      return `<div class="nav-group ${open ? 'open' : ''}"><button class="nav ${m.k === active ? 'on' : ''}" data-grp="${m.k}" title="${esc(m.l)}">${I[m.i]}<span>${m.l}</span><i class="chev">${I.chevron}</i></button>
        <div class="nav-sub">${m.sub.map(([l, h]) => `<a href="${h}" class="${hash === h || (hash.startsWith(h + '/') && h !== '#/fiches') ? 'on' : ''}">${l}</a>`).join('')}</div></div>`;
    }).join('')}</nav>
    <div class="side-foot">
      <button class="icon-btn" data-act="profile" title="Mon profil">${avatar(S.me.id)}</button>
      ${isAdmin() ? `<a class="icon-btn" href="#/settings" title="Paramètres">${I.gear}</a>` : ''}
      ${S.me.super ? `<a class="icon-btn" href="#/platform" title="Plateforme (firmes)">${I.people}</a>` : ''}
      <button class="icon-btn" data-act="logout" title="Se déconnecter">${I.logout}</button>
    </div>
  </aside>`;
}

// page = { active, title, icon, actions, body, back, sub, tabs }
function layout(p) {
  app.innerHTML = `<div class="shell">
    ${sidebar(p.active)}
    <div class="side-scrim" data-act="closeside"></div>
    <main class="main">
      ${S.firm && S.firm.own === false ? `<div class="firm-band">Vous travaillez dans la firme <b>${esc(S.firm.name)}</b><button class="btn sm" data-act="firmback">Revenir à ma firme</button></div>` : ''}
      <header class="top">
        <button class="icon-btn only-mobile" data-act="openside" aria-label="Menu">${I.menu}</button>
        ${p.back ? `<a class="icon-btn" href="${p.back}" aria-label="Retour">${I.back}</a>` : ''}
        <div class="top-title">${p.icon ? `<span class="top-ic">${I[p.icon] || ''}</span>` : ''}<div><h1>${esc(p.title)}</h1>${p.sub ? `<div class="top-sub">${p.sub}</div>` : ''}</div></div>
        <div class="top-actions">${p.actions || ''}</div>
      </header>
      ${p.tabs ? `<nav class="tabs">${p.tabs}</nav>` : ''}
      <section class="page" id="page">${p.body || ''}</section>
    </main>
  </div>`;
  bindShell();
  return $('#page');
}
function bindShell() {
  const side = $('#side');
  $('[data-act=collapse]').onclick = () => { ui.collapsed = !ui.collapsed; saveUi(); side.classList.toggle('collapsed', ui.collapsed); };
  $$('[data-grp]').forEach((b) => {
    b.onclick = () => {
      const g = b.parentNode; g.classList.toggle('open');
      ui.open = ui.open || {}; ui.open[b.dataset.grp] = g.classList.contains('open'); saveUi();
      if (side.classList.contains('collapsed')) { ui.collapsed = false; saveUi(); side.classList.remove('collapsed'); }
    };
  });
  $('[data-act=logout]').onclick = async () => { await api('POST', 'auth/logout').catch(() => {}); S.ready = false; showLogin(); };
  $('[data-act=profile]').onclick = () => editProfile();
  const fb = $('[data-act=firmback]'); if (fb) fb.onclick = () => switchFirm(0);
  $('[data-act=search]').onclick = () => quickSearch();
  $('[data-act=openside]').onclick = () => document.body.classList.add('side-open');
  $('[data-act=closeside]').onclick = () => document.body.classList.remove('side-open');
  $$('.side a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('side-open')));
}
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.ready) { e.preventDefault(); quickSearch(); } });

// ---------------------------------------------------------------- Fenêtres modales
const openModals = new Set();
function modal(html, { wide = false, full = false, split = false, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${full ? 'full' : ''} ${split ? 'split' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  let closed = false;
  const m = {
    el: ov.querySelector('.modal'),
    close() {
      if (closed) return; closed = true; openModals.delete(m);
      ov.classList.remove('show'); setTimeout(() => ov.remove(), 180);
      if (onClose) onClose();
    },
  };
  openModals.add(m);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
  $$('[data-close]', ov).forEach((b) => { b.onclick = () => m.close(); });
  return m;
}
const closeModals = () => [...openModals].forEach((m) => m.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openModals.size) [...openModals].pop().close(); });
const mhead = (title, right = '') => `<div class="m-head"><h2>${esc(title)}</h2><div class="m-actions">${right}</div><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>`;

function menuSheet(title, items) {
  const m = modal(`${mhead(title)}<div class="m-body actions">${items.map((it, i) => (it.sep ? '<hr>' : `<button class="btn ${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''}" data-i="${i}">${it.icon ? I[it.icon] : ''}${esc(it.label)}</button>`)).join('')}</div>`);
  $$('[data-i]', m.el).forEach((b) => { b.onclick = () => { m.close(); items[+b.dataset.i].run(); }; });
  return m;
}
function ask(title, fields, values = {}) {
  return new Promise((res) => {
    let done = false;
    formModal({ title, fields, values, saveLabel: 'Valider', async onSave(v) { done = true; res(v); }, onClose: () => { if (!done) res(null); } });
  });
}

// ---------------------------------------------------------------- Formulaires
// Types de champ : text, textarea, select, number, money, percent, date, time, email, tel, check, color, contact, user, users, html
function fieldHTML(f, val) {
  const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
  let input;
  const ph = esc(f.placeholder || '');
  switch (f.type) {
    case 'html': return `<div class="field ${f.cls || ''}">${f.html}</div>`;
    case 'textarea': input = `<textarea name="${f.name}" id="${id}" rows="${f.rows || 3}" placeholder="${ph}">${esc(val)}</textarea>`; break;
    case 'select': {
      const opts = typeof f.options === 'function' ? f.options() : f.options;
      input = `<select name="${f.name}" id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      break;
    }
    case 'contact': {
      const opts = (f.contacts || []).filter((c) => !f.kinds || f.kinds.includes(c.data.kind));
      input = `<select name="${f.name}" id="${id}"><option value="">—</option>${opts.map((c) => `<option value="${c.id}" ${String(c.id) === String(val ?? '') ? 'selected' : ''}>${esc(contactName(c))}</option>`).join('')}${f.allowNew !== false ? '<option value="__new">+ Nouveau contact…</option>' : ''}</select>`;
      break;
    }
    case 'user':
      input = `<select name="${f.name}" id="${id}"><option value="">—</option>${S.users.filter((u) => u.active || u.id === +val).map((u) => `<option value="${u.id}" ${String(u.id) === String(val ?? '') ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
      break;
    case 'users': case 'multi': {
      const opts = f.type === 'users' ? S.users.filter((u) => u.active).map((u) => [u.id, u.name]) : (typeof f.options === 'function' ? f.options() : f.options);
      const sel = (val || []).map(String);
      input = `<div class="multi" data-multi="${f.name}">${opts.map(([v, l]) => `<label class="chk"><input type="checkbox" value="${esc(v)}" ${sel.includes(String(v)) ? 'checked' : ''}>${esc(l)}</label>`).join('') || '<span class="muted">—</span>'}</div>`;
      break;
    }
    case 'check': return `<label class="field chk ${f.cls || ''}"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
    case 'number': case 'money': case 'percent':
      input = `<input name="${f.name}" id="${id}" type="text" inputmode="decimal" value="${esc(val ?? '')}" placeholder="${ph}">`; break;
    default:
      input = `<input name="${f.name}" id="${id}" type="${f.type || 'text'}" value="${esc(val ?? '')}" placeholder="${ph}" ${f.list ? `list="${f.list}"` : ''} autocomplete="off">`;
  }
  return `<label class="field ${f.cls || ''}" for="${id}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${f.hint ? `<small class="muted">${f.hint}</small>` : ''}</label>`;
}
function readFields(root, fields) {
  const v = {};
  for (const f of fields) {
    if (f.type === 'html') continue;
    if (f.type === 'users' || f.type === 'multi') {
      const vals = $$(`[data-multi="${f.name}"] input:checked`, root).map((x) => x.value);
      v[f.name] = f.type === 'users' ? vals.map(Number) : vals;
      continue;
    }
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'check') v[f.name] = el.checked;
    else if (f.type === 'number' || f.type === 'money' || f.type === 'percent') v[f.name] = el.value.trim() === '' ? '' : num(el.value);
    else if (f.type === 'user' || f.type === 'contact') v[f.name] = el.value === '__new' ? '__new' : (el.value ? +el.value : null);
    else v[f.name] = el.value.trim();
  }
  return v;
}
// Un champ `row: true` s'aligne à côté du suivant ; `cls: 'full'` occupe toute la largeur
function fieldsGrid(fields, values) {
  return `<div class="grid-form">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</div>`;
}
// side : panneau à côté du formulaire (ex. la facture à recopier), rempli dans after(form, m) via $('[data-side]', m.el)
function formModal({ title, fields, values = {}, onSave, onDelete, onClose, extra = '', wide = false, saveLabel = 'Enregistrer', after, side = false }) {
  const body = `<form class="m-body">${fieldsGrid(fields, values)}${extra}<button type="submit" hidden></button></form>`;
  const m = modal(`${mhead(title)}${side ? `<div class="m-split"><aside class="m-side" data-side></aside>${body}</div>` : body}
    <div class="m-foot">${onDelete ? `<button class="btn danger ghost" data-del>${I.trash} Supprimer</button>` : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-save>${esc(saveLabel)}</button></div>`, { wide, split: side, onClose });
  const form = $('form', m.el);
  $$('[data-close]', m.el).forEach((b) => { b.onclick = () => m.close(); });
  const submit = async () => {
    const v = readFields(form, fields);
    const missing = fields.find((f) => f.required && (v[f.name] === '' || v[f.name] == null));
    if (missing) { toast(`Champ obligatoire : ${missing.label}`); const el = form.querySelector(`[name="${missing.name}"]`); if (el) el.focus(); return; }
    const btn = $('[data-save]', m.el); btn.disabled = true;
    try { await onSave(v, m); m.close(); } catch (e) { toast('Erreur : ' + e.message, 4000); } finally { btn.disabled = false; }
  };
  $('[data-save]', m.el).onclick = submit;
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  if (onDelete) $('[data-del]', m.el).onclick = async () => { if (confirm('Supprimer définitivement ?')) { try { await onDelete(); m.close(); } catch (e) { toast('Erreur : ' + e.message); } } };
  if (after) after(form, m);
  setTimeout(() => { const f = form.querySelector('input:not([type=checkbox]),textarea'); if (f && !('ontouchstart' in window)) f.focus(); }, 150);
  return m;
}

// ---------------------------------------------------------------- Tableaux
// columns: [{ l: 'Titre', v: (row) => html, sort: (row) => valeur, cls }]
// pageSize : pagination (« Afficher 20 éléments ») ; le pied de tableau reçoit toute la liste filtrée
function dataTable(el, { columns, rows, onRow, empty: emptyMsg = 'Aucun élément', search, filters, state: st = {}, toolbar = '', footer, pageSize }) {
  st.q = st.q || ''; st.f = st.f ?? (filters ? filters.def ?? '' : ''); st.pg = st.pg || 1; if (pageSize) st.ps = st.ps || pageSize;
  const draw = () => {
    const q = st.q.toLowerCase();
    let list = rows.filter((r) => (!filters || !st.f || filters.match(r, st.f)) && (!q || !search || search(r).toLowerCase().includes(q)));
    if (st.sort != null) {
      const c = columns[Math.abs(st.sort) - 1];
      const key = c.sort || ((r) => String(c.v(r)).replace(/<[^>]+>/g, ''));
      list = [...list].sort((a, b) => { const x = key(a); const y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * Math.sign(st.sort); });
    }
    const pages = st.ps ? Math.max(1, Math.ceil(list.length / st.ps)) : 1;
    if (st.pg > pages) st.pg = pages;
    const shown = st.ps ? list.slice((st.pg - 1) * st.ps, st.pg * st.ps) : list;
    const off = st.ps ? (st.pg - 1) * st.ps : 0;
    $('.dt-body', el).innerHTML = list.length
      ? `<table class="dt"><thead><tr>${columns.map((c, i) => `<th class="${c.cls || ''}" data-s="${i + 1}">${esc(c.l)}${Math.abs(st.sort) === i + 1 ? (st.sort > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${shown.map((r, i) => `<tr data-r="${i + off}">${columns.map((c) => `<td class="${c.cls || ''}" data-l="${esc(c.l)}">${c.v(r) ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        ${footer ? `<tfoot>${footer(list)}</tfoot>` : ''}</table>
        ${st.ps ? `<div class="dt-pager"><label>Afficher <select data-ps>${[10, 20, 50, 100].map((n) => `<option ${n === st.ps ? 'selected' : ''}>${n}</option>`).join('')}</select> éléments</label><span class="grow"></span>
          ${pages > 1 ? `<button class="btn sm" data-pg="${st.pg - 1}" ${st.pg <= 1 ? 'disabled' : ''} aria-label="Page précédente">←</button>${Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - st.pg) <= 2).map((n, i, a) => `${i && n - a[i - 1] > 1 ? '<span class="muted">…</span>' : ''}<button class="btn sm ${n === st.pg ? 'primary' : ''}" data-pg="${n}">${n}</button>`).join('')}<button class="btn sm" data-pg="${st.pg + 1}" ${st.pg >= pages ? 'disabled' : ''} aria-label="Page suivante">→</button>` : ''}</div>` : ''}`
      : `<div class="empty">${esc(emptyMsg)}</div>`;
    $$('[data-pg]', el).forEach((b) => { b.onclick = () => { st.pg = +b.dataset.pg; draw(); }; });
    const ps = $('[data-ps]', el); if (ps) ps.onchange = () => { st.ps = +ps.value; st.pg = 1; draw(); };
    $$('[data-s]', el).forEach((th) => { th.onclick = () => { const k = +th.dataset.s; st.sort = st.sort === k ? -k : k; draw(); }; });
    if (onRow) $$('tbody tr', el).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a,button,input')) onRow(list[+tr.dataset.r]); }; });
    const cnt = $('.dt-count', el); if (cnt) cnt.textContent = `${list.length} élément${list.length > 1 ? 's' : ''}`;
  };
  el.innerHTML = `<div class="card dt-card"><div class="dt-tools">
      ${search ? `<label class="search">${I.search}<input type="search" placeholder="Rechercher…" value="${esc(st.q)}"></label>` : ''}
      ${filters ? `<div class="chips">${filters.options.map(([k, l, c]) => `<button class="chip ${st.f === k ? 'on' : ''}" data-f="${esc(k)}" ${c ? `style="--c:${c}"` : ''}>${c ? '<i class="dot"></i>' : ''}${esc(l)}</button>`).join('')}</div>` : ''}
      <span class="grow"></span>${toolbar}<span class="dt-count muted"></span></div>
    <div class="dt-body"></div></div>`;
  const s = $('.search input', el); if (s) s.oninput = () => { st.q = s.value; st.pg = 1; draw(); };
  $$('[data-f]', el).forEach((b) => { b.onclick = () => { st.f = b.dataset.f; st.pg = 1; $$('[data-f]', el).forEach((x) => x.classList.toggle('on', x === b)); draw(); }; });
  draw();
}
const badge = (label, color) => `<span class="badge" style="--c:${color}">${esc(label)}</span>`;
const empty = (title, text = '', action = '') => `<div class="empty-big"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
const kpi = (label, value, opt = {}) => `<div class="kpi ${opt.cls || ''}" ${opt.href ? `data-href="${opt.href}"` : ''}><small>${esc(label)}</small><b>${value}</b>${opt.sub ? `<span class="muted">${opt.sub}</span>` : ''}${opt.meter != null ? `<div class="meter"><i style="width:${Math.max(0, Math.min(100, opt.meter))}%;${opt.meterColor ? `--c:${opt.meterColor}` : ''}"></i></div>` : ''}</div>`;
function bindKpis(root) { $$('[data-href]', root).forEach((k) => { k.onclick = () => { location.hash = k.dataset.href; }; }); }

// ---------------------------------------------------------------- Routeur
const ROUTES = {};
let cleanupView = null;
let renderSeq = 0;
function route(name, fn) { ROUTES[name] = fn; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
async function render() {
  if (!S.ready) return;
  closeModals();
  if (cleanupView) { try { await cleanupView(); } catch (e) { /* vue déjà détruite */ } cleanupView = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const fn = ROUTES[parts[0] || 'dashboard'] || ROUTES.dashboard;
  const seq = ++renderSeq;
  try { await fn(...parts.slice(1)); } catch (e) {
    console.error(e);
    if (seq === renderSeq) toast('Erreur : ' + e.message, 5000);
  }
  if (seq === renderSeq) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- Connexion
function showLogin(msg = '') {
  closeModals();
  const company = S.settings.company || {};
  app.innerHTML = `<div class="login"><form class="login-box">
    <div class="brand big"><span class="brand-mark"></span><span>${esc(company.appName || company.name || 'BâtiPro')}</span></div>
    <h1>Connexion</h1>
    ${msg ? `<div class="alert">${esc(msg)}</div>` : ''}
    <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
    <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary block" type="submit">Se connecter</button>
    <p class="muted">Pas de compte ? Demandez à l'administrateur de votre entreprise de vous en créer un.</p>
  </form></div>`;
  const f = $('form', app);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button', f); btn.disabled = true;
    try {
      await api('POST', 'auth/login', { email: f.email.value, password: f.password.value });
      await boot();
    } catch (err) { showLogin(err.message); }
  };
  setTimeout(() => f.email.focus(), 50);
}

// super-administrateur : entrer dans une firme cliente (0 = revenir à la sienne)
async function switchFirm(id) {
  await api('POST', 'platform/switch', { company_id: id });
  location.hash = id ? '#/dashboard' : '#/platform';
  location.reload();
}
async function boot() {
  try {
    const b = await api('GET', 'bootstrap');
    Object.assign(S, { me: b.user, users: b.users, settings: b.settings || {}, firm: b.firm || {}, ai: !!b.ai, ready: true });
    document.title = (S.settings.company || {}).appName || (S.settings.company || {}).name || 'BâtiPro';
    if (!location.hash) location.hash = '#/dashboard';
    render();
    // relève des factures reçues via Peppol (toutes les 10 min au plus)
    if (typeof peppolSync === 'function') setTimeout(() => peppolSync(), 1500);
    if (typeof aiMount === 'function') aiMount();
  } catch (e) {
    if (e.status === 401) showLogin();
    else if (e.status === 503) app.innerHTML = `<div class="login"><div class="login-box"><h1>Installation requise</h1><p>${esc(e.message)}</p><a class="btn primary" href="install.php">Installer</a></div></div>`;
    else app.innerHTML = `<div class="login"><div class="login-box"><h1>Erreur</h1><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Réessayer</button></div></div>`;
  }
}
