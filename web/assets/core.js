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

function pickFile(accept, multiple = false, capture = '') {
  return new Promise((res) => {
    // l'élément reste dans la page le temps de la lecture : certains navigateurs perdent l'accès au fichier sinon
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple; inp.hidden = true;
    if (capture) inp.setAttribute('capture', capture); // téléphone : ouvre directement l'appareil photo
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
  check: ic('<path d="M20 6L9 17l-5-5"/>'),
  x: ic('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'),
  hist: ic('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>'),
  eye: ic('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  percent: ic('<path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'),
  chat: ic('<path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1121 12z"/>'),
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
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  sun: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c.6-4 3.8-6.5 8-6.5s7.4 2.5 8 6.5"/>'),
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
// ---------------------------------------------------------------- Navigation par « espaces »
// Cinq espaces dans l'ordre de vie d'un chantier : ce qu'il faut faire aujourd'hui → trouver et chiffrer les affaires →
// réaliser les chantiers → encaisser et payer → les personnes. Mêmes espaces, même ordre sur ordinateur (barre du haut)
// et sur téléphone (barre du bas). Chaque espace a ses rubriques (pastilles sous la barre). « + Créer » est séparé de la navigation.
// Rubrique : [libellé, lien, ...autres débuts d'adresse qui appartiennent à la rubrique]
const SPACES = [
  { k: 'today', l: "Aujourd'hui", i: 'sun', h: '#/dashboard', sec: [["Aujourd'hui", '#/dashboard'], ['Tâches', '#/tasks'], ['Planning chantiers', '#/planning/projects'], ['Planning équipes', '#/planning/team']] },
  { k: 'deals', l: 'Affaires', i: 'target', h: '#/quotes', sec: [['Devis', '#/quotes', '#/quote/'], ['Opportunités', '#/opportunities'], ['Prix et ouvrages', '#/library']] },
  { k: 'works', l: 'Chantiers', i: 'crane', h: '#/projects', sec: [['Chantiers', '#/projects', '#/project/'], ['Interventions', '#/interventions', '#/intervention/'], ['Installations', '#/installations', '#/installation/'], ['Fiches techniques', '#/fiches', '#/fiche/'], ['Dossiers de fin', '#/fiches/dossiers', '#/dossier/'], ['Rapports terrain', '#/reports', '#/report/']] },
  { k: 'money', l: 'Argent', i: 'coins', h: '#/invoices', sec: [['Factures', '#/invoices', '#/invoice/'], ['États d\'avancement', '#/progress'], ['Paiements', '#/payments'], ['Achats', '#/expenses', '#/purchase/', '#/expense/'], ['Commandes', '#/orders/fournisseur', '#/order/'], ['Sous-traitance', '#/orders/soustraitant'], ['Chiffres', '#/stats']] },
  { k: 'people', l: 'Carnet', i: 'people', h: '#/contacts/client', sec: [['Clients', '#/contacts/client', '#/contact/'], ['Prospects', '#/contacts/prospect'], ['Fournisseurs', '#/contacts/fournisseur'], ['Sous-traitants', '#/contacts/soustraitant'], ['Tous', '#/contacts/all'], ['Équipe', '#/hr/staff'], ['Pointage', '#/hr/timesheets'], ['Absences', '#/hr/absences']] },
];
// « BâtiPro Simplifié » (indépendants) : devis, factures, achats par chantier, contacts – sans planning, commandes, RH, assistant…
const isSimple = () => S.edition === 'simple';
const SPACES_SIMPLE = [
  { k: 'home', l: 'Accueil', i: 'sun', h: '#/dashboard', sec: [] },
  { k: 'bill', l: 'Facturer', i: 'coins', h: '#/s/liste/factures', sec: [['Factures', '#/s/liste/factures', '#/s/facture', '#/s/doc/facture', '#/s/paye', '#/s/avoir', '#/invoice'], ['Devis', '#/s/liste/devis', '#/s/devis', '#/s/doc/devis', '#/quote']] },
  { k: 'buy', l: 'Achats', i: 'download', h: '#/s/liste/achats', sec: [['Achats', '#/s/liste/achats', '#/s/achat', '#/expenses', '#/purchase']] },
  { k: 'works', l: 'Chantiers', i: 'crane', h: '#/projects', sec: [['Chantiers', '#/projects', '#/project/'], ['Clients', '#/contacts/client', '#/contact/'], ['Fournisseurs', '#/contacts/fournisseur'], ['Mes prix', '#/library']] },
  { k: 'me', l: 'Moi', i: 'user', h: '#/s/moi', sec: [['Mes informations', '#/s/moi'], ['Peppol', '#/s/peppol']] },
];
// Espace terrain (ouvriers, sous-traitants) : uniquement leurs chantiers, heures, rapports, commandes et planning
const isField = () => !!(S.me && ['ouvrier', 'soustraitant'].includes(S.me.role) && !S.me.super);
const SPACES_FIELD = () => [
  { k: 'site', l: 'Chantiers', i: 'crane', h: '#/t', sec: [['Mes chantiers', '#/t', '#/t/chantier']] },
  { k: 'hours', l: 'Heures', i: 'clock', h: '#/t/heures', sec: [['Mes heures', '#/t/heures']] },
  { k: 'rep', l: 'Rapports', i: 'fiche', h: '#/t/rapports', sec: [['Rapports', '#/t/rapports', '#/t/rapport', '#/t/photos']] },
  ...(S.me.role === 'soustraitant' ? [{ k: 'orders', l: 'Commandes', i: 'truck', h: '#/t/commandes', sec: [['Bons de commande', '#/t/commandes', '#/print/order']] }] : []),
  { k: 'plan', l: 'Planning', i: 'calendar', h: '#/t/planning', sec: [['Mon planning', '#/t/planning']] },
];
const spaces = () => (isField() ? SPACES_FIELD() : isSimple() ? SPACES_SIMPLE : SPACES);
const ui = (() => { try { return JSON.parse(localStorage.getItem('bp-ui') || '{}'); } catch (e) { return {}; } })();
const saveUi = () => { try { localStorage.setItem('bp-ui', JSON.stringify(ui)); } catch (e) { /* stockage indisponible */ } };
// Espace et rubrique de l'adresse actuelle : la correspondance la plus longue gagne
function spaceOf(hash = location.hash) {
  const h = hash.split('?')[0] || '#/dashboard';
  let best = null;
  for (const sp of spaces()) {
    for (const sec of sp.sec.length ? sp.sec : [[sp.l, sp.h]]) {
      for (const pre of sec.slice(1)) {
        if ((h === pre || h.startsWith(pre.endsWith('/') ? pre : pre + '/') || (pre.endsWith('/') && h.startsWith(pre))) && (!best || pre.length > best.len)) best = { sp, sec, len: pre.length };
      }
    }
  }
  return best;
}
function dock(cur) {
  const company = S.settings.company || {};
  return `<header class="dock">
    <a class="dock-brand" href="#/dashboard">${company.logoId ? `<img src="${fileUrl(company.logoId)}" alt="">` : '<span class="brand-mark"></span>'}<span>${esc(company.appName || company.name || 'BâtiPro')}</span></a>
    <nav class="dock-tabs" aria-label="Espaces">${spaces().map((sp) => `<a class="dock-tab ${cur && cur.sp === sp ? 'on' : ''}" href="${sp.h}">${I[sp.i]}<span>${sp.l}</span></a>`).join('')}</nav>
    <div class="dock-tools">
      ${isField() ? '' : `<button class="dock-cmd" data-act="search" title="Rechercher ou faire une action">${I.search}<span>Rechercher ou faire…</span><kbd>⌘K</kbd></button>`}
      ${S.ai ? `<button class="dock-ai" data-act="ai" title="Assistant IA">${I.spark}</button>` : ''}
      <button class="dock-add" data-act="qadd">${I.plus}<span>Créer</span></button>
      <button class="dock-me" data-act="account" title="Mon compte">${avatar(S.me.id)}</button>
    </div></header>`;
}
function secBar(cur) {
  if (!cur || cur.sp.sec.length < 2) return '';
  return `<nav class="secbar" aria-label="${esc(cur.sp.l)}"><b class="secbar-t">${I[cur.sp.i]}${esc(cur.sp.l)}</b>${cur.sp.sec.map((sec) => `<a href="${sec[1]}" class="${sec === cur.sec ? 'on' : ''}">${esc(sec[0])}</a>`).join('')}</nav>`;
}
// Menu du compte (avatar) : profil, paramètres, plateforme, déconnexion
function accountMenu() {
  const items = [{ label: `Notifications${S.unread ? ` (${S.unread} nouvelle${S.unread > 1 ? 's' : ''})` : ''}`, icon: 'bell', primary: !!S.unread, run: () => notifList() },
    ...(pushState() === 'on' ? [] : [{ label: 'Activer les notifications sur cet appareil', icon: 'bell', run: () => pushEnable() }]),
    { label: 'Mon profil', icon: 'user', run: () => editProfile() }];
  if (isField()) items.push({ label: 'Installer l\'application sur le téléphone', icon: 'download', run: () => installHelp() });
  if (isAdmin()) items.push({ label: 'Paramètres', icon: 'gear', run: () => go('#/settings') });
  if (S.me.super) items.push({ label: 'Plateforme (firmes)', icon: 'people', run: () => go('#/platform') });
  if (S.firm && S.firm.own === false) items.push({ label: 'Revenir à ma firme', icon: 'back', run: () => switchFirm(0) });
  items.push({ sep: true }, { label: 'Se déconnecter', icon: 'logout', danger: true, run: async () => { await api('POST', 'auth/logout').catch(() => {}); S.ready = false; showLogin(); } });
  menuSheet(S.me.name || 'Mon compte', items);
}

// ---------------------------------------------------------------- Notifications (pastille sur l'avatar, liste, push sur cet appareil)
S.unread = 0;
const b64u8 = (b) => { const s = atob(b.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b.length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission === 'granted' && localStorage.getItem('bp-push') ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off';
}
async function pushEnable() {
  if (pushState() === 'unsupported') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    modal(`${mhead('Activer les notifications')}<div class="m-body s-dict">${ios ? '<p>Sur iPhone, les notifications marchent quand l\'application est <b>installée</b> :</p><p>1. Dans Safari, touchez <b>Partager</b> (carré avec une flèche) puis <b>Sur l\'écran d\'accueil</b>.</p><p>2. Ouvrez l\'application depuis la nouvelle icône, puis revenez ici.</p>' : '<p>Ce navigateur ne permet pas les notifications. Utilisez Chrome, Edge, Firefox ou Safari récent.</p>'}</div>`);
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications refusées : autorisez-les dans les réglages du téléphone (ou du navigateur)', 6000); return false; }
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('GET', 'push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(key) });
    await api('POST', 'push', { endpoint: sub.endpoint });
    try { localStorage.setItem('bp-push', '1'); } catch (e) { /* */ }
    await api('POST', 'notifs/test');
    toast('Notifications activées ✓', 3000); render();
    return true;
  } catch (e) { toast('Activation impossible : ' + e.message, 6000); return false; }
}
function notifBadge() { $$('.dock-me, .me-btn').forEach((b) => { if (S.unread) b.dataset.n = S.unread > 9 ? '9+' : S.unread; else delete b.dataset.n; }); }
let notifLast = 0;
async function notifRefresh() {
  if (!S.ready || document.hidden) return;
  try {
    const r = await api('GET', 'notifs');
    const top = (r.list[0] || {}).id || 0;
    if (notifLast && top > notifLast && r.unread && !r.list[0].read_at) toast(`🔔 ${r.list[0].title}`, 4000);
    notifLast = top; S.unread = r.unread; notifBadge();
  } catch (e) { /* hors connexion */ }
}
setInterval(notifRefresh, 90000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) notifRefresh(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.go) { location.hash = e.data.go; notifRefresh(); } });
async function notifList() {
  const r = await api('GET', 'notifs');
  const m = modal(`${mhead('Notifications')}<div class="m-body nf-list">
    ${pushState() !== 'on' ? `<button class="t-alert soft" data-push>${I.bell}<span><b>Recevoir les notifications sur cet appareil</b><br><small>Rappels des heures, rapports, photos, commandes</small></span>${I.chevron}</button>` : ''}
    ${r.list.map((n) => `<a class="nf ${n.read_at ? '' : 'new'}" href="${esc(n.href || '#/')}"><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ''}<i>${fmtDT(n.created_at)}</i></a>`).join('') || '<p class="muted">Aucune notification pour l\'instant.</p>'}</div>`);
  $$('.nf', m.el).forEach((a) => a.addEventListener('click', () => m.close()));
  const pb = $('[data-push]', m.el); if (pb) pb.onclick = () => { m.close(); pushEnable(); };
  if (r.unread) { api('POST', 'notifs/read').catch(() => {}); S.unread = 0; notifBadge(); }
}

// page = { active, title, icon, actions, body, back, sub, tabs }
function layout(p) {
  document.body.classList.remove('wiz'); document.body.classList.toggle('simple', isSimple());
  const cur = spaceOf();
  app.innerHTML = `<div class="shell">
    ${dock(cur)}
    <main class="main">
      ${S.firm && S.firm.own === false ? `<div class="firm-band">Vous travaillez dans la firme <b>${esc(S.firm.name)}</b><button class="btn sm" data-act="firmback">Revenir à ma firme</button></div>` : ''}
      ${secBar(cur)}
      <header class="top">
        ${p.back ? `<a class="icon-btn" href="${p.back}" aria-label="Retour">${I.back}</a>` : `<button class="icon-btn only-mobile me-btn" data-act="account" aria-label="Mon compte">${avatar(S.me.id)}</button>`}
        <div class="top-title">${p.icon ? `<span class="top-ic">${I[p.icon] || ''}</span>` : ''}<div><h1>${esc(p.title)}</h1>${p.sub ? `<div class="top-sub">${p.sub}</div>` : ''}</div></div>
        <div class="top-actions">${p.actions || ''}</div>
      </header>
      ${p.tabs ? `<nav class="tabs">${p.tabs}</nav>` : ''}
      <section class="page" id="page">${p.body || ''}</section>
    </main>
    ${bottomNav(cur)}
  </div>`;
  bindShell();
  notifBadge();
  mobileActions();
  tabSwitcher();
  const topEl = $('.top'); if (topEl) document.documentElement.style.setProperty('--top-h', `${topEl.offsetHeight}px`);
  const tOn = $('.tabs a.on'); if (tOn && isPhone()) tOn.scrollIntoView({ block: 'nearest', inline: 'center' });
  const sOn = $('.secbar a.on'); if (sOn && isPhone()) sOn.scrollIntoView({ block: 'nearest', inline: 'center' });
  setTimeout(installTip, 2500);
  return $('#page');
}
// Téléphone : les cinq espaces en bas de l'écran (comme une application), même ordre que sur ordinateur
function bottomNav(cur) {
  return `<nav class="bnav" aria-label="Espaces" style="grid-template-columns:repeat(${spaces().length},1fr)">${spaces().map((sp) => `<a class="bn-it ${cur && cur.sp === sp ? 'on' : ''}" href="${sp.h}">${I[sp.i]}<span>${sp.l}</span></a>`).join('')}</nav>`;
}
// Téléphone : plus de 4 onglets → un bouton « section actuelle ▾ » qui ouvre toutes les sections d'un coup (grille d'icônes)
const TAB_ICONS = { overview: 'dash', quotes: 'calc', orders: 'truck', invoices: 'coins', expenses: 'download', hours: 'people', planning: 'calendar', plans: 'file', points: 'pin', meetings: 'fiche', forms: 'tasks', diary: 'book', documents: 'file',
  company: 'gear', docs: 'file', templates: 'edit', peppol: 'send', mail: 'mail', ai: 'spark', users: 'people', activity: 'hist' };
function tabSwitcher() {
  const nav = $('.tabs'); if (!nav || !isPhone()) return;
  const tabs = [...nav.querySelectorAll('a')]; if (tabs.length <= 4) return;
  const cur = tabs.find((a) => a.classList.contains('on')) || tabs[0];
  const key = (a) => (a.getAttribute('href') || '').split('/').pop();
  const ic = (a) => I[TAB_ICONS[key(a)]] || I.file;
  nav.classList.add('tabs-sw');
  nav.innerHTML = `<button type="button" class="tsw-btn">${ic(cur)}<span>${esc(cur.textContent.trim())}</span><small>${tabs.indexOf(cur) + 1}/${tabs.length}</small>${I.chevron}</button>`;
  $('.tsw-btn', nav).onclick = () => {
    const m = modal(`${mhead('Sections')}<div class="m-body tsw-grid">${tabs.map((a, i) => `<a href="${a.getAttribute('href')}" class="tsw-it ${a === cur ? 'on' : ''}" data-i="${i}">${ic(a)}<span>${esc(a.textContent.trim())}</span></a>`).join('')}</div>`);
    $$('.tsw-it', m.el).forEach((x) => x.addEventListener('click', () => m.close()));
  };
}

// Téléphone : les boutons de l'en-tête passent dans un menu « ⋯ » (on garde le bouton principal)
const isPhone = () => window.matchMedia('(max-width: 860px)').matches;
function mobileActions() {
  const box = $('.top-actions'); if (!box || !isPhone()) return;
  let items = [...box.querySelectorAll('a, button')].filter((x) => !x.closest('label'));
  // pas de bouton principal sur la page : « + Créer » à sa place (en haut à droite, comme sur iPhone)
  if (!items.some((x) => x.classList.contains('primary'))) {
    box.insertAdjacentHTML('beforeend', `<button class="btn primary m-create" data-act="qadd">${I.plus}<span>Créer</span></button>`);
    $('.m-create', box).onclick = () => quickAddMenu();
    items = [...box.querySelectorAll('a, button')].filter((x) => !x.closest('label'));
  }
  // un seul bouton principal avec icône : bouton rond « + » (comme une application)
  if (items.length === 1 && items[0].classList.contains('primary') && items[0].querySelector('svg')) { items[0].classList.add('m-icon'); items[0].setAttribute('aria-label', items[0].textContent.trim()); }
  if (items.length < 2) return;
  const keep = [...items].reverse().find((x) => x.classList.contains('primary') && x.parentElement === box) || null;
  const extra = items.filter((x) => x !== keep);
  extra.forEach((x) => x.classList.add('m-hide'));
  if (keep && keep.querySelector('svg')) { keep.classList.add('m-icon'); keep.setAttribute('aria-label', keep.textContent.trim()); }
  // groupes de boutons (ex. Cartes / Liste) entièrement passés dans le menu
  [...box.children].forEach((g) => { if (!g.matches('a, button') && g.querySelector('a, button') && [...g.querySelectorAll('a, button')].every((x) => x.classList.contains('m-hide'))) g.classList.add('m-hide'); });
  box.insertAdjacentHTML('beforeend', `<button class="icon-btn m-more" aria-label="Plus d'actions">${I.more}</button>`);
  $('.m-more', box).onclick = () => menuSheet('Actions', extra.map((x) => ({ label: x.textContent.trim() || x.title || x.getAttribute('aria-label') || '…', icon: null, run: () => x.click() })));
}

function bindShell() {
  $$('[data-act=account]').forEach((b) => { b.onclick = () => accountMenu(); });
  const fb = $('[data-act=firmback]'); if (fb) fb.onclick = () => switchFirm(0);
  $$('[data-act=search]').forEach((b) => { b.onclick = () => quickSearch(); });
  $$('[data-act=qadd]').forEach((b) => { b.onclick = () => quickAddMenu(); });
  $$('[data-act=ai]').forEach((b) => { b.onclick = () => aiToggle(true); });
}
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.ready && !isField()) { e.preventDefault(); quickSearch(); } });

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
    if (onRow) $$('tbody tr', el).forEach((tr) => { tr.onclick = (e) => { if (!e.target.closest('a,button,input,label,td.sel')) onRow(list[+tr.dataset.r]); }; });
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
  // édition simplifiée : les modules absents renvoient au tableau de bord
  const SIMPLE_ROUTES = ['s', 'dashboard', 'quotes', 'quote', 'invoices', 'invoice', 'payments', 'expenses', 'purchase', 'projects', 'project', 'contacts', 'contact', 'library', 'print', 'contract', 'contractpdf', 'settings', 'platform'];
  if (isSimple() && parts[0] && !SIMPLE_ROUTES.includes(parts[0])) { location.hash = '#/dashboard'; return; }
  // compte terrain : uniquement son espace (et l'impression de ses bons de commande)
  if (isField() && !(parts[0] === 't' || (parts[0] === 'print' && parts[1] === 'order'))) { location.hash = '#/t'; return; }
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
    Object.assign(S, { me: b.user, users: b.users, settings: b.settings || {}, firm: b.firm || {}, edition: b.edition || 'avance', ai: !!b.ai, translate: !!b.translate, field: b.field || null, ready: true });
    document.title = (S.settings.company || {}).appName || (S.settings.company || {}).name || 'BâtiPro';
    if (!location.hash) location.hash = isField() ? '#/t' : '#/dashboard';
    render();
    // relève des factures reçues via Peppol (toutes les 10 min au plus)
    if (typeof peppolSync === 'function' && !isField()) setTimeout(() => peppolSync(), 1500);
    if (typeof aiMount === 'function') aiMount();
    notifRefresh();
  } catch (e) {
    if (e.status === 401) showLogin();
    else if (e.status === 503) app.innerHTML = `<div class="login"><div class="login-box"><h1>Installation requise</h1><p>${esc(e.message)}</p><a class="btn primary" href="install.php">Installer</a></div></div>`;
    else app.innerHTML = `<div class="login"><div class="login-box"><h1>Erreur</h1><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Réessayer</button></div></div>`;
  }
}

// ---------------------------------------------------------------- Application installable (écran d'accueil du téléphone)
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
function installTip() {
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (standalone || !isPhone() || $('.install-tip')) return;
  try { if (localStorage.getItem('bp-install-tip')) return; } catch (e) { return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios && !installEvt) return;
  const el = document.createElement('div'); el.className = 'install-tip';
  el.innerHTML = `<img src="assets/apple-touch-icon.png" alt=""><div class="grow"><b>Installer BâtiPro sur votre téléphone</b><br>${ios ? 'Touchez <b>Partager</b> (carré avec une flèche) puis <b>« Sur l\'écran d\'accueil »</b>.' : 'S\'ouvre en plein écran, comme une application.'}</div>${ios ? '' : '<button class="btn" data-i>Installer</button>'}<button data-x aria-label="Fermer">✕</button>`;
  document.body.appendChild(el);
  const done = () => { try { localStorage.setItem('bp-install-tip', '1'); } catch (e) { /* */ } el.remove(); };
  $('[data-x]', el).onclick = done;
  const ib = $('[data-i]', el); if (ib) ib.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; done(); };
}

// ---------------------------------------------------------------- Listes longues : recherche en tapant
// Tout <select> de plus de 10 choix (clients, chantiers, fournisseurs…) s'ouvre dans une fenêtre avec un champ
// de recherche au lieu de la liste native à faire défiler. data-native sur le select pour garder la liste du système.
const SP_MIN = 10;
const spNorm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function selectPicker(sel) {
  const host = sel.closest('label, .field');
  const lab = host ? ($('span', host) || {}).textContent || '' : '';
  const opts = [...sel.options].map((o) => ({ v: o.value, t: o.textContent.trim(), g: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '', dis: o.disabled }));
  const m = modal(`${mhead(lab.replace(/\s*\*$/, '') || 'Choisir')}<div class="m-body sp"><label class="search big">${I.search}<input type="search" placeholder="Tapez quelques lettres…" autocomplete="off" enterkeyhint="search"></label><div class="sp-list" role="listbox"></div></div>`);
  m.el.classList.add('sp-modal');
  const inp = $('input', m.el); const list = $('.sp-list', m.el);
  const draw = () => {
    const words = spNorm(inp.value).split(/\s+/).filter(Boolean);
    const hit = opts.filter((o) => !words.length || words.every((w) => spNorm(`${o.t} ${o.g}`).includes(w)));
    let g = null;
    list.innerHTML = hit.slice(0, 300).map((o) => { const head = o.g !== g ? `<div class="sp-g">${esc(o.g)}</div>` : ''; g = o.g;
      return `${o.g ? head : ''}<button type="button" class="sp-o ${o.v === sel.value ? 'on' : ''} ${o.v === '' ? 'empty' : ''}" data-v="${esc(o.v)}" ${o.dis ? 'disabled' : ''}>${esc(o.t || '—')}${o.v === sel.value ? ` ${I.check}` : ''}</button>`; }).join('')
      || `<p class="muted sp-none">Aucun résultat pour « ${esc(inp.value)} »</p>`;
  };
  const pick = (v) => { if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } m.close(); };
  list.onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) pick(b.dataset.v); };
  inp.oninput = draw;
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const b = $('.sp-o:not([disabled]):not(.empty)', list) || $('.sp-o:not([disabled])', list); if (b) pick(b.dataset.v); } };
  draw();
  const cur = $('.sp-o.on', list); if (cur) cur.scrollIntoView({ block: 'center' });
  // ordinateur : on tape directement ; téléphone : le clavier s'ouvre en touchant le champ (la liste reste visible)
  if (!('ontouchstart' in window)) setTimeout(() => inp.focus(), 50);
}
function spEnhance(sel) {
  if (!sel || sel.dataset.sp || sel.multiple || sel.dataset.native != null || sel.options.length <= SP_MIN) return;
  sel.dataset.sp = '1';
  const wrap = document.createElement('span');
  wrap.className = 'sp-wrap'; wrap.style.display = sel.closest('.field, label') || getComputedStyle(sel).display === 'block' ? 'block' : 'inline-block';
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'sp-hit'; b.setAttribute('aria-label', 'Rechercher dans la liste');
  b.onclick = (e) => { e.preventDefault(); if (!sel.disabled) selectPicker(sel); };
  wrap.appendChild(b);
}
new MutationObserver((muts) => {
  for (const mu of muts) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'SELECT') spEnhance(n);
    else if (n.tagName === 'OPTION' || n.tagName === 'OPTGROUP') spEnhance(n.closest('select'));
    else if (n.querySelectorAll) n.querySelectorAll('select').forEach(spEnhance);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
