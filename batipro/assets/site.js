'use strict';
/* « Sur le chantier » : un seul écran pour le terrain (bureau et responsables).
   Le plan en plein écran avec ses points, un point en 3 gestes (photo, une phrase, qui), la réunion = une visite
   dont le PV se remplit tout seul, la signature des présents. Fonctionne aussi SANS RÉSEAU :
   - à chaque ouverture avec réseau, le chantier (plans, points, réunion en cours, intervenants) est gardé dans le téléphone ;
   - sans réseau, tout ce qu'on fait (points, photos, statuts, commentaires, réunion, signatures) est mis en file d'attente
     dans le téléphone et envoyé dès que le réseau revient, dans l'ordre, sans écraser le travail des autres
     (chaque envoi relit l'élément sur le serveur et n'y ajoute que la modification). */

// ---------------------------------------------------------------- Stockage local (IndexedDB) : instantanés, file d'attente, photos
const SITE_DB = 'batipro-site';
let siteDbP = null;
function siteDb() {
  if (!siteDbP) siteDbP = new Promise((res, rej) => {
    const r = indexedDB.open(SITE_DB, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('snap'); d.createObjectStore('ops', { keyPath: 'k', autoIncrement: true }); d.createObjectStore('blob'); };
    r.onsuccess = () => res(r.result); r.onerror = () => { siteDbP = null; rej(r.error); };
  });
  return siteDbP;
}
async function sIdb(store, mode, fn) {
  const d = await siteDb();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode); const st = tx.objectStore(store); let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
const sReq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const siteKey = (pid) => `${(S.firm && S.firm.id) || 0}:${S.me.id}:${pid}`;
const snapGet = (pid) => sIdb('snap', 'readonly', (st) => sReq(st.get(siteKey(pid)))).catch(() => null);
const snapPut = (pid, v) => sIdb('snap', 'readwrite', (st) => { st.put(v, siteKey(pid)); }).catch(() => {});
const snapAll = () => sIdb('snap', 'readonly', async (st) => { const keys = await sReq(st.getAllKeys()); const vals = await sReq(st.getAll()); return keys.map((k, i) => [k, vals[i]]); }).catch(() => []);
const blobPut = (k, b) => sIdb('blob', 'readwrite', (st) => { st.put(b, k); });
const blobGet = (k) => sIdb('blob', 'readonly', (st) => sReq(st.get(k))).catch(() => null);
const blobDel = (k) => sIdb('blob', 'readwrite', (st) => { st.delete(k); }).catch(() => {});
const opsAll = () => sIdb('ops', 'readonly', (st) => sReq(st.getAll())).then((l) => l.filter((o) => o.firm === ((S.firm && S.firm.id) || 0) && o.uid === S.me.id)).catch(() => []);
const opAdd = (o) => sIdb('ops', 'readwrite', (st) => { st.add({ ...o, firm: (S.firm && S.firm.id) || 0, uid: S.me.id, at: new Date().toISOString().slice(0, 19).replace('T', ' ') }); });
const opDel = (k) => sIdb('ops', 'readwrite', (st) => { st.delete(k); });
const opPut = (o) => sIdb('ops', 'readwrite', (st) => { st.put(o); });
// identifiants provisoires (créés sans réseau) → identifiants du serveur, une fois envoyés
const idMapGet = () => sIdb('snap', 'readonly', (st) => sReq(st.get('idmap'))).then((m) => m || {}).catch(() => ({}));
const idMapSet = (m) => sIdb('snap', 'readwrite', (st) => { st.put(m, 'idmap'); });

// ---------------------------------------------------------------- Images (plans, photos) gardées pour le hors-ligne
const SITE_FILES = 'batipro-site-files';
const blobUrls = new Map();
async function fileCache(id) {
  if (!id || !('caches' in window)) return;
  try { const c = await caches.open(SITE_FILES); const u = fileUrl(id); if (!(await c.match(u))) { const r = await fetch(u, { credentials: 'same-origin' }); if (r.ok) await c.put(u, r); } } catch (e) { /* hors ligne */ }
}
// adresse affichable d'une photo : fichier du serveur (gardé dans le téléphone) ou photo pas encore envoyée (« b:… »)
async function siteSrc(ref) {
  if (!ref) return '';
  if (blobUrls.has(ref)) return blobUrls.get(ref);
  let b = null;
  if (String(ref).startsWith('b:')) b = await blobGet(String(ref).slice(2));
  else if ('caches' in window) { try { const r = await (await caches.open(SITE_FILES)).match(fileUrl(ref)); if (r) b = await r.blob(); } catch (e) { /* */ } }
  if (!b) { if (!String(ref).startsWith('b:')) fileCache(ref); return String(ref).startsWith('b:') ? '' : fileUrl(ref); }
  const u = URL.createObjectURL(b); blobUrls.set(ref, u); return u;
}
// remplit les <img data-src> d'un bloc
function siteImgs(box) { $$('img[data-src]', box).forEach(async (im) => { const s = await siteSrc(im.dataset.src); if (s) im.src = s; im.removeAttribute('data-src'); }); }

// ---------------------------------------------------------------- Démarrage sans réseau : dernière session gardée
function siteBootSave(b) {
  try { localStorage.setItem('bp-boot', JSON.stringify({ user: b.user, users: (b.users || []).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active })), company: (b.settings || {}).company || {}, firm: b.firm || {}, edition: b.edition, field: b.field || null, testMode: !!b.testMode })); } catch (e) { /* stockage plein ou bloqué */ }
}
function siteBootOffline() {
  let b = null; try { b = JSON.parse(localStorage.getItem('bp-boot') || 'null'); } catch (e) { /* */ }
  if (!b || !b.user) return false;
  Object.assign(S, { me: b.user, users: b.users || [], settings: { company: b.company || {} }, firm: b.firm || {}, edition: b.edition || 'avance', field: b.field, testMode: b.testMode, sub: { status: 'free' }, ai: false, ready: true, offline: true });
  if (!/^#\/site/.test(location.hash)) location.hash = '#/site';
  render();
  window.addEventListener('online', () => { toast('Réseau revenu : reconnexion…', 2500); setTimeout(() => location.reload(), 1200); }, { once: true });
  return true;
}
const siteNet = () => navigator.onLine !== false && !S.offline;
const isNetErr = (e) => e && !e.status;

// ---------------------------------------------------------------- Données du chantier : serveur (et copie locale) ou copie locale seule
const SITE_CONTACT_KINDS = ['soustraitant', 'fournisseur', 'architecte', 'autre', 'client'];
async function siteFetch(pid) {
  const [p, all, contacts] = await Promise.all([db.get('project', pid), db.many(['plan', 'point', 'meeting'], pid), db.list('contact')]);
  const plans = (all.plan || []).sort((a, b) => (a.data.order ?? a.id) - (b.data.order ?? b.id));
  const snap = {
    at: new Date().toISOString(), project: p, plans, points: all.point || [],
    meetings: (all.meeting || []).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '')).slice(0, 12),
    contacts: contacts.filter((c) => SITE_CONTACT_KINDS.includes(c.data.kind)).map((c) => ({ id: c.id, data: { kind: c.data.kind, name: c.data.name, company: c.data.company, firstname: c.data.firstname, trade: c.data.trade, email: c.data.email } })),
  };
  await snapPut(pid, snap);
  // plans et vignettes gardés dans le téléphone (en arrière-plan) ; photos des points ouverts aussi
  setTimeout(() => { plans.forEach((pl) => { fileCache(pl.data.fileId); fileCache(pl.data.thumbId); }); snap.points.filter(isOpenPt).forEach((x) => (x.data.photos || []).slice(0, 2).forEach(fileCache)); }, 300);
  return snap;
}
async function siteLoad(pid) {
  let snap = null; let off = false;
  if (siteNet()) { try { await siteSync(); snap = await siteFetch(pid); } catch (e) { if (!isNetErr(e)) throw e; off = true; } } else off = true;
  if (!snap) snap = await snapGet(pid);
  if (!snap) return null;
  snap.off = off;
  // les modifications pas encore envoyées sont appliquées à la copie
  const ops = (await opsAll()).filter((o) => +o.pid === +pid);
  const map = await idMapGet();
  for (const o of ops) siteApply(snap, o, map);
  snap.pending = ops.length;
  return snap;
}

// ---------------------------------------------------------------- Modifications : appliquées tout de suite à l'écran, envoyées au serveur (maintenant ou au retour du réseau)
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const tmpId = () => `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const realId = (id, map) => (String(id).startsWith('tmp-') ? map[id] || id : id);
const findPt = (snap, id, map) => snap.points.find((x) => String(x.id) === String(id) || String(x.id) === String(realId(id, map)) || x.tmp === id);
const findMt = (snap, id, map) => snap.meetings.find((x) => String(x.id) === String(id) || String(x.id) === String(realId(id, map)) || x.tmp === id);
// une modification appliquée à la copie locale (pour l'affichage avant envoi)
function siteApply(snap, o, map) {
  const by = S.me.id;
  if (o.t === 'pt-new') { if (!findPt(snap, o.id, map)) snap.points.push({ id: o.id, tmp: o.id, number: '…', project_id: o.pid, data: { ...o.data, photos: (o.photos || []).map((k) => `b:${k}`) } }); return; }
  const pt = o.t.startsWith('pt-') ? findPt(snap, o.id, map) : null;
  if (o.t === 'pt-status' && pt) { const old = pt.data.status; pt.data.status = o.status; (pt.data.history = pt.data.history || []).push({ t: o.at, uid: by, kind: 'sys', text: `Statut : ${PTS[old] ? PTS[old][0] : old} → ${PTS[o.status][0]}` }); }
  if (o.t === 'pt-photo' && pt) { (pt.data.photos = pt.data.photos || []).push(`b:${o.blob}`); if (o.after) (pt.data.after = pt.data.after || []).push(`b:${o.blob}`); }
  if (o.t === 'pt-comment' && pt) (pt.data.history = pt.data.history || []).push({ t: o.at, uid: by, kind: 'comment', text: o.text });
  if (o.t === 'mt-new' && !findMt(snap, o.id, map)) snap.meetings.unshift({ id: o.id, tmp: o.id, project_id: o.pid, data: { ...o.data } });
  const mt = o.t.startsWith('mt-') ? findMt(snap, o.id, map) : null;
  if (o.t === 'mt-set' && mt) Object.assign(mt.data, o.patch);
  if (o.t === 'mt-point' && mt) mtNote(mt.data, o.point, o.kind);
  if (o.t === 'mt-sign' && mt) mt.data.signatures = [...(mt.data.signatures || []).filter((s) => s.who !== o.who), { who: o.who, name: o.name, fileId: `b:${o.blob}`, at: o.at }];
  if (o.t === 'mt-end' && mt) Object.assign(mt.data, { status: 'terminee', endedAt: o.at });
}
// un point traité pendant la réunion : suivi dans le PV (« nouveaux », « levés pendant la réunion »)
function mtNote(md, point, kind) {
  const ids = (md.pointIds || []).map(String);
  if (!ids.includes(String(point))) md.pointIds = [...(md.pointIds || []), point];
  md.during = md.during || { created: [], done: [], reopened: [] };
  const key = kind === 'new' ? 'created' : kind === 'done' ? 'done' : 'reopened';
  if (!md.during[key].map(String).includes(String(point))) md.during[key].push(point);
}
let siteState = null; // { pid, snap, redraw }
async function siteDo(o, blobs = {}) {
  for (const [k, b] of Object.entries(blobs)) await blobPut(k, b);
  await opAdd({ ...o, pid: o.pid || (siteState && siteState.pid) });
  if (siteState && siteState.snap) { siteApply(siteState.snap, { ...o, at: nowTs() }, await idMapGet()); siteState.snap.pending = (siteState.snap.pending || 0) + 1; }
  const cur = siteState;
  siteSync().then((r) => { if (!cur || siteState !== cur) return; if (r && r.done) cur.reload(); else if (cur.redraw) cur.redraw(); });
}

// ---------------------------------------------------------------- Envoi de la file d'attente au serveur (dans l'ordre, une modification à la fois)
let siteSyncP = null;
function siteSync() {
  if (siteSyncP) return siteSyncP;
  siteSyncP = (async () => {
    if (!siteNet()) return { left: (await opsAll()).length };
    const ops = (await opsAll()).sort((a, b) => a.k - b.k);
    let done = 0; let failed = 0;
    for (const o of ops) {
      if (o.failed) { failed++; continue; }
      try { await siteRun(o); await opDel(o.k); done++; } catch (e) {
        if (isNetErr(e)) break; // réseau coupé : on reprendra plus tard, dans le même ordre
        o.failed = e.message || 'refusé'; await opPut(o); failed++;
        toast(`Une modification n'a pas pu être enregistrée : ${o.failed}`, 6000);
      }
    }
    const left = (await opsAll()).length;
    if (done) { dbcClear(); if (siteState) siteState.synced = new Date(); }
    return { done, failed, left };
  })().finally(() => { siteSyncP = null; });
  return siteSyncP;
}
window.addEventListener('online', () => { if (S.ready && !S.offline) siteSync().then((r) => { if (r && r.done) { toast(`${r.done} modification(s) du chantier envoyée(s)`, 3000); if (siteState && siteState.redraw) siteState.reload(); } }); });
setInterval(() => { if (S.ready && !S.offline && navigator.onLine) siteSync(); }, 60000);

// relit l'élément sur le serveur, applique la modification, enregistre (réessaie si quelqu'un l'a modifié entre-temps)
async function siteUpdate(type, id, fn) {
  for (let a = 0; a < 3; a++) {
    const it = await db.get(type, id);
    fn(it.data);
    try { return await api('PUT', `items/${type}/${id}`, { data: it.data, version: it.version, project_id: it.project_id ?? null }); } catch (e) { if (e.status !== 409) throw e; }
  }
  throw new Error('Élément modifié en même temps par quelqu\'un d\'autre : réessayez');
}
async function siteUpload(key, pid, name) {
  const b = await blobGet(key);
  if (!b) return null;
  const r = await upload(new File([b], name || `${key}.jpg`, { type: b.type || 'image/jpeg' }), pid);
  await blobDel(key);
  return r.id;
}
async function siteRun(o) {
  const map = await idMapGet();
  const rid = (id) => { const r = realId(id, map); if (String(r).startsWith('tmp-')) throw Object.assign(new Error('Élément pas encore enregistré'), { status: 0 }); return +r; };
  if (o.t === 'pt-new') {
    if (map[o.id]) return; // déjà créé (envoi interrompu juste après)
    const photos = [];
    for (const k of o.photos || []) { const f = await siteUpload(k, o.pid, 'photo.jpg'); if (f) photos.push(f); }
    const r = await api('POST', 'items/point', { project_id: o.pid, data: { ...o.data, photos, history: [{ t: o.at, uid: S.me.id, kind: 'sys', text: 'Point créé sur le chantier' }] } });
    map[o.id] = r.id; await idMapSet(map); return;
  }
  if (o.t === 'pt-status') {
    await siteUpdate('point', rid(o.id), (d) => { const old = d.status; if (old === o.status) return; d.status = o.status; (d.history = d.history || []).push({ t: o.at, uid: S.me.id, kind: 'sys', text: `Statut : ${PTS[old] ? PTS[old][0] : old} → ${PTS[o.status][0]}` }); });
    return;
  }
  if (o.t === 'pt-photo') {
    const id = rid(o.id);
    const f = o.fileId || await siteUpload(o.blob, o.pid, o.after ? 'photo-apres.jpg' : 'photo.jpg');
    if (!f) return;
    if (!o.fileId) { o.fileId = f; await opPut(o); }
    await siteUpdate('point', id, (d) => { d.photos = [...(d.photos || []), f]; if (o.after) d.after = [...(d.after || []), f]; });
    return;
  }
  if (o.t === 'pt-comment') { await siteUpdate('point', rid(o.id), (d) => { (d.history = d.history || []).push({ t: o.at, uid: S.me.id, kind: 'comment', text: o.text }); }); return; }
  if (o.t === 'mt-new') {
    if (map[o.id]) return;
    const pointIds = (o.data.pointIds || []).map((x) => realId(x, map)).filter((x) => !String(x).startsWith('tmp-')).map(Number);
    const r = await api('POST', 'items/meeting', { project_id: o.pid, data: { ...o.data, pointIds } });
    map[o.id] = r.id; await idMapSet(map); return;
  }
  if (o.t === 'mt-set') { await siteUpdate('meeting', rid(o.id), (d) => Object.assign(d, o.patch)); return; }
  if (o.t === 'mt-point') { const pt = rid(o.point); await siteUpdate('meeting', rid(o.id), (d) => mtNote(d, pt, o.kind)); return; }
  if (o.t === 'mt-sign') {
    const id = rid(o.id);
    const f = o.fileId || await siteUpload(o.blob, o.pid, 'signature.png');
    if (!f) return;
    if (!o.fileId) { o.fileId = f; await opPut(o); }
    await siteUpdate('meeting', id, (d) => { d.signatures = [...(d.signatures || []).filter((s) => s.who !== o.who), { who: o.who, name: o.name, fileId: f, at: o.at }]; });
    return;
  }
  if (o.t === 'mt-end') { await siteUpdate('meeting', rid(o.id), (d) => { d.status = 'terminee'; d.endedAt = o.at; }); }
}

// ---------------------------------------------------------------- Écran « Sur le chantier »
const siteContactName = (c) => (c ? contactName(c) : '');
const siteBadge = (k) => st(PTS, k); // st() global (badge de statut) : masqué plus bas par l'état local « st »
const siteOpen = (snap) => snap.points.filter(isOpenPt);
const siteLive = (snap) => snap.meetings.find((m) => m.data.status === 'encours');
const siteVis = () => ui.siteF || 'todo';
// chantiers gardés dans le téléphone (accueil sans réseau)
async function siteList() {
  const all = (await snapAll()).filter(([k]) => typeof k === 'string' && k.startsWith(`${(S.firm && S.firm.id) || 0}:${S.me.id}:`)).map(([, v]) => v).filter((v) => v && v.project);
  const ops = await opsAll();
  app.innerHTML = `<div class="site-wrap"><header class="site-top"><a class="icon-btn" href="#/projects" ${S.offline ? 'hidden' : ''}>${I.back}</a><div class="grow"><b>Sur le chantier</b><small>${S.offline ? 'Hors connexion' : 'Chantiers gardés dans ce téléphone'}</small></div></header>
    <div class="site-pad">${S.offline ? '<div class="alert warn">Pas de réseau : vous pouvez travailler sur les chantiers gardés dans ce téléphone. Tout sera envoyé au retour du réseau.</div>' : ''}
    ${ops.length ? `<div class="alert info">${ops.length} modification(s) en attente d'envoi.</div>` : ''}
    ${all.length ? all.map((v) => `<a class="site-tile" href="#/site/${v.project.id}"><b>${esc(v.project.data.name)}</b><small class="muted">${siteOpen(v).length} point(s) à faire · gardé le ${fmtDT(v.at.slice(0, 19).replace('T', ' '))}</small></a>`).join('')
    : '<p class="muted">Aucun chantier gardé dans ce téléphone. Ouvrez « Sur le chantier » une fois avec du réseau : il restera disponible sans réseau.</p>'}</div></div>`;
}
route('site', async (pid, sub) => {
  if (!pid) return siteList();
  pid = +pid;
  const pending = siteState && siteState.pid === pid ? siteState : null;
  siteState = { pid, plan: pending ? pending.plan : null, adding: false };
  const st = siteState;
  app.innerHTML = '<div class="site-wrap"><div class="site-pad muted">Chargement du chantier…</div></div>';
  let snap;
  try { snap = await siteLoad(pid); } catch (e) { if (e.status === 403 || e.status === 404) { app.innerHTML = `<div class="site-wrap"><div class="site-pad"><p>${esc(e.message)}</p><a class="btn" href="#/projects">Retour</a></div></div>`; return; } throw e; }
  if (!snap) { app.innerHTML = '<div class="site-wrap"><div class="site-pad"><div class="alert warn">Pas de réseau et ce chantier n\'est pas encore gardé dans ce téléphone. Ouvrez-le une fois avec du réseau.</div><a class="btn" href="#/site">Chantiers gardés</a></div></div>'; return; }
  st.snap = snap;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (sub === 'sansplan') st.plan = 'none'; else if (sub) st.plan = +sub;
  if (!st.plan || (st.plan !== 'none' && !snap.plans.some((x) => x.id === st.plan))) st.plan = snap.plans.length ? (snap.plans.find((pl) => snap.points.some((x) => isOpenPt(x) && +x.data.planId === pl.id)) || snap.plans[0]).id : 'none';
  st.reload = async () => { const s2 = await siteLoad(pid).catch(() => null); if (s2 && siteState === st) { const same = s2.plans.map((x) => x.id).join() === st.snap.plans.map((x) => x.id).join(); st.snap = s2; if (same) st.soft(); else draw(); } };
  st.redraw = () => { if (alive()) { opsAll().then((l) => { if (!alive()) return; st.snap.pending = l.filter((o) => +o.pid === pid).length; drawHead(); drawSheet(); drawPins(); }); } };
  const p = snap.project;
  app.innerHTML = `<div class="site-wrap">
    <header class="site-top"><a class="icon-btn" href="${S.offline ? '#/site' : isChef() ? `#/resp/p/${pid}` : `#/project/${pid}`}" aria-label="Retour">${I.back}</a><div class="grow"><b>Sur le chantier</b><small>${esc(p.data.name)}</small></div><span data-net></span><button class="btn sm" data-mt>Réunion</button></header>
    <div data-live></div>
    <div class="site-planbar" data-chips></div>
    <div class="site-main" data-main></div>
    <div class="site-banner" data-banner hidden><span>Touchez le plan à l'endroit du point</span><button type="button" data-cancel>Annuler</button></div>
    <button class="site-fab" data-add aria-label="Nouveau point">+</button>
    <section class="site-sheet" data-sheet></section></div>`;
  const main = $('[data-main]'); const sheet = $('[data-sheet]'); const root = $('.site-wrap');
  const alive = () => root.isConnected && siteState === st; // l'écran est toujours affiché (sinon : on ne redessine rien)
  // en-tête : réseau / modifications en attente, réunion en cours
  const drawHead = () => {
    const s = st.snap; const n = s.pending || 0;
    $('[data-net]').innerHTML = s.off || !siteNet() ? `<span class="site-net off" title="Pas de réseau : tout est gardé dans le téléphone">Hors ligne${n ? ` · ${n} en attente` : ''}</span>` : n ? `<span class="site-net wait">${n} en attente</span>` : '<span class="site-net ok" title="Gardé dans ce téléphone : disponible sans réseau">✓ Hors ligne prêt</span>';
    const live = siteLive(s);
    $('[data-live]').innerHTML = live ? `<button class="site-live" data-mt><span><i></i>Réunion en cours · ${esc(live.data.title)}</span><b>Ouvrir</b></button>` : '';
    $$('[data-mt]').forEach((b) => { b.onclick = () => siteMeeting(st); });
  };
  // choix du plan : un seul bouton (nom du plan) + précédent / suivant ; la liste complète s'ouvre avec recherche (100 plans et plus)
  const planOrder = () => [...st.snap.plans.map((pl) => pl.id), 'none'];
  const nbOpen = (id) => st.snap.points.filter((x) => isOpenPt(x) && (id === 'none' ? !x.data.planId || !st.snap.plans.some((pl) => pl.id === +x.data.planId) : +x.data.planId === id)).length;
  const planName = (id) => (id === 'none' ? 'Sans plan' : (st.snap.plans.find((pl) => pl.id === id) || { data: { name: '?' } }).data.name);
  const setPlan = (id) => { st.plan = id; st.adding = false; const r = ui.siteRecent || (ui.siteRecent = {}); r[pid] = [id, ...(r[pid] || []).filter((x) => x !== id)].slice(0, 4); saveUi(); draw(); };
  const drawChips = () => {
    const ord = planOrder(); const i = ord.indexOf(st.plan); const n = nbOpen(st.plan);
    $('[data-chips]').innerHTML = `<button class="icon-btn" data-prev ${i <= 0 ? 'disabled' : ''} aria-label="Plan précédent">‹</button>
      <button class="site-plansel" data-pick><span class="grow"><b>${esc(planName(st.plan))}</b><small class="muted">${st.plan === 'none' ? 'façade, toiture, extérieur…' : `plan ${i + 1} / ${ord.length - 1}`}${n ? ` · <span class="late">${n} à faire</span>` : ''}</small></span><span aria-hidden="true">▾</span></button>
      <button class="icon-btn" data-next ${i >= ord.length - 1 ? 'disabled' : ''} aria-label="Plan suivant">›</button>`;
    $('[data-prev]').onclick = () => { if (i > 0) setPlan(ord[i - 1]); };
    $('[data-next]').onclick = () => { if (i < ord.length - 1) setPlan(ord[i + 1]); };
    $('[data-pick]').onclick = () => sitePlanPicker(st, pid, nbOpen, setPlan);
  };
  const ptsHere = () => st.snap.points.filter((x) => (st.plan === 'none' ? !x.data.planId || !st.snap.plans.some((pl) => pl.id === +x.data.planId) : +x.data.planId === st.plan));
  const visible = (x) => { const f = siteVis(); return f === 'all' || (f === 'todo' ? isOpenPt(x) : !isOpenPt(x)); };
  // liste des points (feuille du bas ; plein écran pour « Sans plan »)
  const drawSheet = () => {
    const list = ptsHere().filter(visible).sort((a, b) => (isOpenPt(b) - isOpenPt(a)) || (+a.number || 1e9) - (+b.number || 1e9));
    const open = ptsHere().filter(isOpenPt).length;
    sheet.classList.toggle('full', st.plan === 'none' || !!st.sheetOpen);
    sheet.innerHTML = `<button class="site-grab" data-grab aria-label="Afficher la liste"><span></span></button>
      <div class="site-sh"><b class="grow">${open} point${open > 1 ? 's' : ''} à faire</b><div class="site-seg">${[['todo', 'À faire'], ['done', 'Faits'], ['all', 'Tous']].map(([k, l]) => `<a href="#" data-f="${k}" class="${siteVis() === k ? 'on' : ''}">${l}</a>`).join('')}</div></div>
      <div class="site-list">${list.map((x) => { const c = byId(st.snap.contacts, x.data.companyId); const ph = (x.data.photos || [])[0];
        return `<button class="site-pt" data-pt="${x.id}">${ph ? `<img data-src="${esc(ph)}" alt="">` : '<span class="site-noph">📷</span>'}<span class="grow"><b><span class="num" style="--c:${PTS[x.data.status][1]}">${esc(x.number)}</span> ${esc(x.data.title)}</b><small class="muted">${esc([c ? siteContactName(c) : 'Notre équipe', x.data.due && `avant le ${fmtDate(x.data.due)}`, String(x.id).startsWith('tmp-') && 'pas encore envoyé'].filter(Boolean).join(' · '))}</small></span>${siteBadge(x.data.status)}</button>`; }).join('') || `<p class="muted">${siteVis() === 'todo' ? 'Rien à faire ici.' : 'Aucun point.'}</p>`}</div>`;
    $('[data-grab]', sheet).onclick = () => { st.sheetOpen = !st.sheetOpen; drawSheet(); };
    $$('[data-f]', sheet).forEach((a) => { a.onclick = (e) => { e.preventDefault(); ui.siteF = a.dataset.f; saveUi(); drawSheet(); drawPins(); }; });
    $$('[data-pt]', sheet).forEach((b) => { b.onclick = () => { const x = st.snap.points.find((y) => String(y.id) === b.dataset.pt); if (x) sitePoint(st, x); }; });
    siteImgs(sheet);
  };
  // plan : déplacer avec un doigt, zoomer avec deux doigts (ou la molette), toucher un point pour l'ouvrir
  let view = null;
  const drawPins = () => { if (view) view.pins(); };
  const drawMain = () => {
    view = null;
    const pl = st.plan === 'none' ? null : st.snap.plans.find((x) => x.id === st.plan);
    main.classList.toggle('noplan', !pl);
    if (!pl) { main.innerHTML = ''; return; }
    main.innerHTML = `<div class="viewer site-viewer" data-vp><div class="plan-inner" data-inner style="width:${pl.data.w}px;height:${pl.data.h}px"><img data-src="${pl.data.fileId}" alt="" draggable="false"><div data-pins></div></div></div>`;
    siteImgs(main);
    const vp = $('[data-vp]', main); const inner = $('[data-inner]', main); const pinsEl = $('[data-pins]', main);
    let scale = 1; let tx = 0; let ty = 0; let minS = 0.05; let maxS = 8;
    const apply = () => { inner.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; inner.style.setProperty('--inv', 1 / scale); };
    const fit = () => { const r = vp.getBoundingClientRect(); const s = Math.min(r.width / pl.data.w, r.height / pl.data.h) * 0.98; minS = s * 0.6; maxS = Math.max(s * 16, 3); scale = s; tx = (r.width - pl.data.w * s) / 2; ty = (r.height - pl.data.h * s) / 2; apply(); };
    const zoomAt = (cx, cy, ns) => { ns = Math.min(maxS, Math.max(minS, ns)); tx = cx - (cx - tx) * ns / scale; ty = cy - (cy - ty) * ns / scale; scale = ns; apply(); };
    const rel = (e) => { const r = vp.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const norm = (e) => { const r = inner.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    const ptrs = new Map(); let g = null;
    const pinch = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    vp.addEventListener('pointerdown', (e) => { vp.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e)); if (ptrs.size === 1) { const q = rel(e); g = { k: 'pan', sx: q.x, sy: q.y, tx, ty, t: Date.now(), moved: false, target: e.target }; } else if (ptrs.size === 2) { const pi = pinch(); g = { k: 'pinch', d0: pi.d, s0: scale, cx: (pi.mx - tx) / scale, cy: (pi.my - ty) / scale }; } });
    vp.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !g) return; ptrs.set(e.pointerId, rel(e));
      if (g.k === 'pan' && ptrs.size === 1) { const q = rel(e); const dx = q.x - g.sx; const dy = q.y - g.sy; if (Math.abs(dx) + Math.abs(dy) > 8) g.moved = true; if (g.moved) { tx = g.tx + dx; ty = g.ty + dy; apply(); } } else if (g.k === 'pinch' && ptrs.size >= 2) { const pi = pinch(); const ns = Math.min(maxS, Math.max(minS, g.s0 * pi.d / g.d0)); scale = ns; tx = pi.mx - g.cx * ns; ty = pi.my - g.cy * ns; apply(); }
    });
    const end = (e) => {
      if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
      if (g && g.k === 'pan' && !g.moved && e.type === 'pointerup' && Date.now() - g.t < 600) {
        const pin = g.target && g.target.closest && g.target.closest('.pin');
        const [x, y] = norm(e);
        if (st.adding && x >= 0 && x <= 1 && y >= 0 && y <= 1) { setAdding(false); siteNewPoint(st, { planId: pl.id, x, y }); } else if (pin) { const pt = st.snap.points.find((q2) => String(q2.id) === pin.dataset.id); if (pt) sitePoint(st, pt); }
      }
      if (ptrs.size === 1) { const q = [...ptrs.values()][0]; g = { k: 'pan', sx: q.x, sy: q.y, tx, ty, t: 0, moved: true }; } else if (!ptrs.size) g = null;
    };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', (e) => { e.preventDefault(); const q = rel(e); zoomAt(q.x, q.y, scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))); }, { passive: false });
    view = {
      pins() { pinsEl.innerHTML = ptsHere().filter((x) => x.data.x != null && visible(x)).sort((a, b) => a.data.y - b.data.y).map((x) => `<div class="pin ${String(x.id) === String(st.hl) ? 'hl' : ''}" data-id="${x.id}" style="left:${x.data.x * 100}%;top:${x.data.y * 100}%">${PIN(PTS[x.data.status][1])}<span>${esc(String(x.number).replace('…', '•'))}</span></div>`).join(''); },
      focus(x) { const r = vp.getBoundingClientRect(); scale = Math.min(maxS, scale * 2.5); tx = r.width / 2 - x.data.x * pl.data.w * scale; ty = r.height / 3 - x.data.y * pl.data.h * scale; apply(); },
    };
    requestAnimationFrame(fit); view.pins();
    const onResize = () => fit(); window.addEventListener('resize', onResize);
    cleanupView = () => { window.removeEventListener('resize', onResize); window.removeEventListener('offline', onNet); window.removeEventListener('online', onNet); };
  };
  const setAdding = (on) => { st.adding = on; $('[data-banner]').hidden = !on; $('[data-add]').classList.toggle('on', on); };
  $('[data-add]').onclick = () => { if (st.plan === 'none') return siteNewPoint(st, {}); setAdding(!st.adding); };
  $('[data-cancel]').onclick = () => setAdding(false);
  const draw = () => { if (!alive()) return; drawHead(); drawChips(); drawMain(); drawSheet(); };
  const onNet = () => { if (alive()) drawHead(); };
  window.addEventListener('offline', onNet); window.addEventListener('online', onNet);
  st.soft = () => { if (!alive()) return; drawHead(); drawChips(); drawSheet(); drawPins(); };
  st.draw = draw; st.focus = (x) => { st.hl = x.id; if (view) { view.pins(); if (x.data.x != null) view.focus(x); } };
  draw();
  if (q.has('meeting')) siteMeeting(st);
});

// ---------------------------------------------------------------- Liste des plans : recherche, récents, « avec points à faire »
function sitePlanPicker(st, pid, nbOpen, setPlan) {
  const plans = st.snap.plans; const recent = ((ui.siteRecent || {})[pid] || []).filter((id) => id === 'none' || plans.some((pl) => pl.id === id));
  let q = ''; let onlyTodo = false;
  const m = modal(`${mhead(`Plans (${plans.length})`)}<div class="m-body site-pick">
    <label class="search big">${I.search}<input type="search" placeholder="Chercher un plan (nom, niveau…)" autocomplete="off" data-q></label>
    <label class="chk"><input type="checkbox" data-todo> Seulement les plans avec des points à faire</label>
    <div data-list></div></div>`, { wide: true });
  const row = (id) => {
    const pl = id === 'none' ? null : plans.find((x) => x.id === id); const n = nbOpen(id);
    return `<button class="site-prow ${st.plan === id ? 'on' : ''}" data-id="${id}">${pl && pl.data.thumbId ? `<img data-src="${pl.data.thumbId}" alt="">` : '<span class="site-noph">📐</span>'}
      <span class="grow"><b>${esc(pl ? pl.data.name : 'Sans plan')}</b><small class="muted">${esc(pl ? [pl.data.level, (pl.data.version || 1) > 1 && `v${pl.data.version}`].filter(Boolean).join(' · ') : 'façade, toiture, extérieur…')}</small></span>${n ? `<span class="badge" style="--c:#e5484d">${n} à faire</span>` : ''}</button>`;
  };
  const norm = (t) => spNorm(t || '');
  const draw = () => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (id) => { const pl = plans.find((x) => x.id === id); const t = norm(pl ? `${pl.data.name} ${pl.data.level || ''}` : 'sans plan'); return words.every((w) => t.includes(w)) && (!onlyTodo || nbOpen(id) > 0); };
    const all = [...plans.map((pl) => pl.id), 'none'].filter(hit);
    const rec = !q && !onlyTodo ? recent.filter(hit) : [];
    $('[data-list]', m.el).innerHTML = (rec.length ? `<div class="section-t">Récents</div>${rec.map(row).join('')}<div class="section-t">Tous les plans</div>` : '')
      + (all.map(row).join('') || '<p class="muted">Aucun plan ne correspond.</p>');
    $$('[data-id]', m.el).forEach((b) => { b.onclick = () => { m.close(); setPlan(b.dataset.id === 'none' ? 'none' : +b.dataset.id); }; });
    siteImgs(m.el);
  };
  $('[data-q]', m.el).oninput = (e) => { q = e.target.value; draw(); };
  $('[data-todo]', m.el).onchange = (e) => { onlyTodo = e.target.checked; draw(); };
  draw();
  if (!isPhone()) $('[data-q]', m.el).focus();
}

// ---------------------------------------------------------------- Point rapide : photo, une phrase, qui, pour quand
function siteWho(snap) {
  const p = snap.project.data; const ids = new Set([...(p.subs || []).map(Number), ...snap.points.map((x) => +x.data.companyId).filter(Boolean), +p.architectId || 0].filter(Boolean));
  const near = snap.contacts.filter((c) => ids.has(c.id));
  const others = snap.contacts.filter((c) => !ids.has(c.id) && ['soustraitant', 'fournisseur', 'architecte', 'autre'].includes(c.data.kind)).sort((a, b) => contactName(a).localeCompare(contactName(b)));
  return { near, others };
}
const siteNextMeeting = (snap) => { const m = snap.meetings.find((x) => x.data.next && x.data.next >= today()); return m ? m.data.next : ''; };
async function sitePhoto(file) {
  try { const r = await resizeImage(await blobToImg(file), 1600); return r.blob; } catch (e) { return file; }
}
function siteNewPoint(st, pos) {
  const snap = st.snap; const who = siteWho(snap); const nextMt = siteNextMeeting(snap);
  const photos = []; // { key, url }
  let companyId = ''; let due = '';
  const m = modal(`${mhead('Nouveau point')}<form class="m-body site-form">
    <label class="field full"><span>Que faut-il faire ?</span><textarea name="title" rows="2" required placeholder="ex. Fissure au-dessus de la porte (🎤 du clavier pour dicter)"></textarea></label>
    <div class="site-photos" data-ph></div>
    <label class="site-cam btn"><input type="file" accept="image/*" capture="environment" hidden data-cam>📷 Ajouter une photo (facultatif)</label>
    <div class="field full"><span>Qui doit le faire ?</span><div class="chips" data-who>
      <button type="button" class="chip on" data-c="">Notre équipe</button>${who.near.map((c) => `<button type="button" class="chip" data-c="${c.id}">${esc(contactName(c))}</button>`).join('')}
      ${who.others.length ? `<select data-other aria-label="Autre intervenant"><option value="">Autre…</option>${who.others.map((c) => `<option value="${c.id}">${esc(contactName(c))}</option>`).join('')}</select>` : ''}</div></div>
    <div class="field full"><span>Pour quand ?</span><div class="chips" data-due>
      <button type="button" class="chip on" data-d="">Pas de date</button><button type="button" class="chip" data-d="${addDays(today(), 7)}">Cette semaine</button>
      ${nextMt ? `<button type="button" class="chip" data-d="${nextMt}">Prochaine réunion (${fmtDate(nextMt)})</button>` : `<button type="button" class="chip" data-d="${addDays(today(), 14)}">Dans 2 semaines</button>`}
      <input type="date" data-date aria-label="Date"></div></div>
    <details class="site-more"><summary>Plus de détails</summary><div class="grid2">
      <label class="field full"><span>Description</span><textarea name="desc" rows="3"></textarea></label>
      <label class="field"><span>Priorité</span><select name="priority">${Object.entries(PRIO).map(([k, [l]]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Catégorie</span><input name="category" list="site-cats" value="Réserve"></label>
      <label class="field full"><span>Localisation</span><input name="location" placeholder="ex. Étage 2, app. 7"></label></div>
      <datalist id="site-cats">${PT_CATS.map((x) => `<option value="${x}">`).join('')}</datalist></details>
  </form><div class="m-foot"><span class="grow muted" data-hint>${pos.planId ? '' : 'Point sans plan'}</span><button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button></div>`, { onClose: () => photos.forEach((x) => URL.revokeObjectURL(x.url)) });
  const form = $('form', m.el);
  const drawPh = () => { $('[data-ph]', m.el).innerHTML = photos.map((x, i) => `<div class="ph"><img src="${x.url}" alt=""><button type="button" data-rm="${i}">✕</button></div>`).join(''); $$('[data-rm]', m.el).forEach((b) => { b.onclick = () => { photos.splice(+b.dataset.rm, 1); drawPh(); }; }); };
  const cam = $('[data-cam]', m.el);
  cam.onchange = async () => { for (const f of cam.files) { const b = await sitePhoto(f); photos.push({ key: lid() + lid(), blob: b, url: URL.createObjectURL(b) }); } cam.value = ''; drawPh(); };
  const pick = (box, attr, set) => { $$(`[${attr}]`, box).forEach((b) => { b.onclick = () => { $$(`[${attr}]`, box).forEach((x) => x.classList.toggle('on', x === b)); set(b.getAttribute(attr)); const sel = $('select', box); if (sel) sel.value = ''; const dt = $('input[type=date]', box); if (dt) dt.value = ''; }; }); };
  pick($('[data-who]', m.el), 'data-c', (v) => { companyId = v; });
  pick($('[data-due]', m.el), 'data-d', (v) => { due = v; });
  const oth = $('[data-other]', m.el); if (oth) oth.onchange = () => { companyId = oth.value; $$('[data-c]', m.el).forEach((x) => x.classList.toggle('on', !oth.value && x.dataset.c === '')); };
  $('[data-date]', m.el).onchange = (e) => { due = e.target.value; $$('[data-d]', m.el).forEach((x) => x.classList.remove('on')); };
  // pas d'appareil photo automatique : on peut juste noter quelque chose ; la photo reste à un bouton
  if (!isPhone()) form.title.focus();
  $('[data-save]', m.el).onclick = async () => {
    const title = form.title.value.trim();
    if (!title) { toast('Écrivez en une phrase ce qu\'il faut faire'); form.title.focus(); return; }
    const id = tmpId(); const live = siteLive(st.snap);
    const data = { title, desc: form.desc.value.trim(), status: 'open', priority: form.priority.value, category: form.category.value.trim(), location: form.location.value.trim(),
      companyId: companyId ? +companyId : null, assigneeId: null, due, planId: pos.planId || null, x: pos.x ?? null, y: pos.y ?? null };
    const blobs = Object.fromEntries(photos.map((x) => [x.key, x.blob]));
    m.close();
    await siteDo({ t: 'pt-new', pid: st.pid, id, data, photos: photos.map((x) => x.key) }, blobs);
    if (live) await siteDo({ t: 'mt-point', pid: st.pid, id: live.tmp || live.id, point: id, kind: 'new' });
    toast(siteNet() ? 'Point enregistré' : 'Point gardé dans le téléphone : envoyé au retour du réseau', 3000);
    st.soft();
  };
}

// ---------------------------------------------------------------- Fiche d'un point : Fait / Rouvrir, photo « après », commentaire
function sitePoint(st, x) {
  const c = byId(st.snap.contacts, x.data.companyId); const live = siteLive(st.snap);
  const after = (x.data.after || []).map(String);
  const open = isOpenPt(x);
  const m = modal(`${mhead(`N° ${x.number} · ${x.data.title}`)}<div class="m-body site-card">
    <div class="muted">${esc([c ? siteContactName(c) : 'Notre équipe', x.data.due && `avant le ${fmtDate(x.data.due)}`, x.data.location].filter(Boolean).join(' · '))} ${siteBadge(x.data.status)}</div>
    ${x.data.desc ? `<p class="pre">${esc(x.data.desc)}</p>` : ''}
    <div class="site-photos big">${(x.data.photos || []).map((f) => `<figure><img data-src="${esc(f)}" alt=""><figcaption>${after.includes(String(f)) ? 'après' : 'avant'}</figcaption></figure>`).join('') || '<span class="muted">Pas de photo</span>'}</div>
    <div class="site-acts">${open ? '<button class="btn big good" data-st="done">✓ Fait</button>' : '<button class="btn big" data-st="open">Rouvrir</button>'}
      <label class="btn big"><input type="file" accept="image/*" capture="environment" hidden data-cam>📷 Photo</label></div>
    <div class="comment-row"><input data-cmt placeholder="Commentaire… (🎤 du clavier pour dicter)"><button type="button" class="btn" data-addc>Ajouter</button></div>
    <div class="history">${[...(x.data.history || [])].reverse().map((h) => `<div class="h ${h.kind === 'comment' ? '' : 'sys'}"><small>${fmtDT(h.t)} · ${esc(userName(h.uid))}</small>${esc(h.text)}</div>`).join('')}</div>
  </div><div class="m-foot">${x.data.planId && x.data.planId !== st.plan ? '<button class="btn" data-goplan>Voir sur le plan</button>' : ''}<span class="grow"></span>${!S.offline && !String(x.id).startsWith('tmp-') && siteNet() && typeof editPoint === 'function' ? '<button class="btn" data-full>Tout modifier</button>' : ''}<button class="btn" data-close>Fermer</button></div>`);
  siteImgs(m.el);
  const id = x.tmp || x.id;
  const stb = $('[data-st]', m.el);
  stb.onclick = async () => {
    const s2 = stb.dataset.st; m.close();
    await siteDo({ t: 'pt-status', pid: st.pid, id, status: s2 });
    if (live) await siteDo({ t: 'mt-point', pid: st.pid, id: live.tmp || live.id, point: id, kind: s2 === 'done' ? 'done' : 'reopen' });
    toast(s2 === 'done' ? `Point ${x.number} fait` : `Point ${x.number} rouvert`, 2500); st.soft();
  };
  const cam = $('[data-cam]', m.el);
  cam.onchange = async () => { const f = cam.files[0]; if (!f) return; const b = await sitePhoto(f); const k = lid() + lid(); m.close(); await siteDo({ t: 'pt-photo', pid: st.pid, id, blob: k, after: true }, { [k]: b }); toast('Photo ajoutée', 2000); st.soft(); };
  const addC = async () => { const inp = $('[data-cmt]', m.el); const t = inp.value.trim(); if (!t) return; m.close(); await siteDo({ t: 'pt-comment', pid: st.pid, id, text: t }); toast('Commentaire ajouté', 2000); };
  $('[data-addc]', m.el).onclick = addC; $('[data-cmt]', m.el).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addC(); } };
  const gp = $('[data-goplan]', m.el); if (gp) gp.onclick = () => { m.close(); st.plan = +x.data.planId; st.draw(); setTimeout(() => st.focus(x), 120); };
  const full = $('[data-full]', m.el); if (full) full.onclick = async () => { m.close(); const pt = await db.get('point', +x.id); editPoint(st.snap.project, pt, null, () => st.reload()); };
}

// ---------------------------------------------------------------- Réunion = une visite : présents, notes, points traités, signatures, PV
function sitePeople(snap) {
  const p = snap.project.data;
  const users = S.users.filter((u) => u.active !== false && (u.id === S.me.id || +p.managerId === u.id || (p.team || []).map(Number).includes(u.id)));
  const ids = new Set([+p.clientId || 0, +p.architectId || 0, ...(p.subs || []).map(Number), ...snap.points.filter(isOpenPt).map((x) => +x.data.companyId)].filter(Boolean));
  return { users, contacts: snap.contacts.filter((c) => ids.has(c.id)), all: snap.contacts };
}
function siteMeeting(st) {
  const snap = st.snap; const live = siteLive(snap);
  if (!live) {
    const n = snap.meetings.length + 1;
    const m = modal(`${mhead('Réunion de chantier')}<div class="m-body"><p>Commencez la réunion, puis faites le tour du chantier comme d'habitude : les points créés, faits ou rouverts pendant la réunion vont <b>tout seuls</b> dans le PV, avec tous les points encore ouverts.</p>
      <div class="rows">${snap.meetings.slice(0, 5).map((x) => `<a class="row" href="${String(x.id).startsWith('tmp-') ? '#' : `#/pv/${x.id}`}"><span class="grow"><b>${esc(x.data.title)}</b><small class="muted">${fmtDate(x.data.date)}${x.data.signatures && x.data.signatures.length ? ` · ${x.data.signatures.length} signature(s)` : ''}</small></span><span class="muted">PV ›</span></a>`).join('')}</div></div>
      <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-start>Commencer la réunion n° ${n}</button></div>`);
    $('[data-start]', m.el).onclick = async () => {
      m.close();
      const id = tmpId(); const p = snap.project.data;
      await siteDo({ t: 'mt-new', pid: st.pid, id, data: { title: `Réunion de chantier n° ${n}`, date: today(), status: 'encours', startedAt: nowTs(), location: [p.address, p.city].filter(Boolean).join(', '), users: [S.me.id], attendees: [], absents: '', notes: '', next: '', pointIds: siteOpen(snap).map((x) => x.id), during: { created: [], done: [], reopened: [] } } });
      toast('Réunion commencée : faites le tour du chantier', 3000); st.soft();
    };
    return;
  }
  const ppl = sitePeople(snap); const d = live.data; const mid = live.tmp || live.id;
  const users = new Set((d.users || []).map(Number)); const att = new Set((d.attendees || []).map(Number));
  const du = d.during || { created: [], done: [], reopened: [] };
  const extra = att.size ? [...att].filter((id) => !ppl.contacts.some((c) => c.id === id)).map((id) => byId(ppl.all, id)).filter(Boolean) : [];
  const m = modal(`${mhead(d.title)}<form class="m-body site-form">
    <div class="field full"><span>Présents (touchez pour cocher)</span><div class="chips" data-pres>
      ${ppl.users.map((u) => `<button type="button" class="chip ${users.has(u.id) ? 'on' : ''}" data-u="${u.id}">${esc(u.name)}</button>`).join('')}
      ${[...ppl.contacts, ...extra].map((c) => `<button type="button" class="chip ${att.has(c.id) ? 'on' : ''}" data-a="${c.id}">${esc(contactName(c))}</button>`).join('')}
      <select data-other aria-label="Autre présent"><option value="">+ Autre…</option>${ppl.all.filter((c) => !ppl.contacts.some((x) => x.id === c.id)).map((c) => `<option value="${c.id}">${esc(contactName(c))}</option>`).join('')}</select></div></div>
    <label class="field full"><span>Absents / excusés</span><input name="absents" value="${esc(d.absents || '')}"></label>
    <label class="field full"><span>Notes et décisions</span><textarea name="notes" rows="6" placeholder="(🎤 du clavier pour dicter)">${esc(d.notes || '')}</textarea></label>
    <label class="field"><span>Prochaine réunion</span><input type="date" name="next" value="${esc(d.next || '')}"></label>
    <div class="tile"><b>Pendant cette réunion</b><span class="muted">${du.created.length} nouveau(x) point(s) · ${du.done.length} fait(s) · ${siteOpen(snap).length} encore ouvert(s)</span></div>
  </form><div class="m-foot"><button class="btn" data-save>Enregistrer</button><span class="grow"></span><button class="btn primary" data-end>Terminer et signer…</button></div>`, { wide: true });
  const form = $('form', m.el);
  $$('[data-u],[data-a]', m.el).forEach((b) => { b.onclick = () => { b.classList.toggle('on'); }; });
  $('[data-other]', m.el).onchange = (e) => { const c = byId(ppl.all, +e.target.value); if (!c) return; e.target.insertAdjacentHTML('beforebegin', `<button type="button" class="chip on" data-a="${c.id}">${esc(contactName(c))}</button>`); const nb = e.target.previousElementSibling; nb.onclick = () => nb.classList.toggle('on'); e.target.value = ''; };
  const patch = () => ({ users: $$('[data-u].on', m.el).map((b) => +b.dataset.u), attendees: $$('[data-a].on', m.el).map((b) => +b.dataset.a), absents: form.absents.value.trim(), notes: form.notes.value, next: form.next.value });
  $('[data-save]', m.el).onclick = async () => { await siteDo({ t: 'mt-set', pid: st.pid, id: mid, patch: patch() }); m.close(); toast('Réunion enregistrée', 2000); st.soft(); };
  $('[data-end]', m.el).onclick = async () => { const pa = patch(); await siteDo({ t: 'mt-set', pid: st.pid, id: mid, patch: pa }); m.close(); siteSign(st, live, pa, ppl); };
}
// signatures des présents sur l'écran, puis fin de la réunion et PV
function siteSign(st, live, pa, ppl) {
  const mid = live.tmp || live.id;
  const who = [...pa.users.map((id) => ({ who: `u${id}`, name: userName(id) })), ...pa.attendees.map((id) => ({ who: `c${id}`, name: contactName(byId(ppl.all, id)) }))];
  const signed = new Map((live.data.signatures || []).map((s) => [s.who, s]));
  const m = modal(`${mhead('Signatures du PV')}<div class="m-body"><p class="muted">Chaque présent signe avec le doigt (facultatif : « Passer » pour ceux qui ne signent pas).</p>
    ${who.map((w, i) => `<div class="site-sig" data-w="${i}"><b>${esc(w.name)}</b><div data-pad></div></div>`).join('') || '<p class="muted">Aucun présent coché.</p>'}</div>
    <div class="m-foot"><span class="grow"></span><button class="btn" data-close>Plus tard</button><button class="btn primary" data-fin>Terminer la réunion</button></div>`, { wide: true });
  const pads = [];
  $$('[data-w]', m.el).forEach((row) => {
    const w = who[+row.dataset.w]; const box = $('[data-pad]', row);
    if (signed.has(w.who)) { box.innerHTML = '<span class="good">✓ Signé</span>'; return; }
    box.innerHTML = '<div class="sig"><canvas width="900" height="240"></canvas><span class="sig-hint">Signez ici</span></div><button type="button" class="btn sm" data-clr>Effacer</button>';
    const cv = $('canvas', box); const ctx = cv.getContext('2d'); ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    let on = false; const pad = { w, cv, dirty: false }; pads.push(pad);
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.style.touchAction = 'none';
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); on = true; pad.dirty = true; $('.sig-hint', box).hidden = true; ctx.beginPath(); ctx.moveTo(...pos(e)); ctx.lineTo(...pos(e)); ctx.stroke(); };
    cv.onpointermove = (e) => { if (on) { ctx.lineTo(...pos(e)); ctx.stroke(); } };
    cv.onpointerup = cv.onpointercancel = () => { on = false; };
    $('[data-clr]', box).onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); pad.dirty = false; $('.sig-hint', box).hidden = false; };
  });
  $('[data-fin]', m.el).onclick = async () => {
    const btn = $('[data-fin]', m.el); btn.disabled = true;
    for (const pd of pads.filter((x) => x.dirty)) { const k = lid() + lid(); await siteDo({ t: 'mt-sign', pid: st.pid, id: mid, who: pd.w.who, name: pd.w.name, blob: k }, { [k]: await canvasToBlob(pd.cv, 'image/png') }); }
    await siteDo({ t: 'mt-end', pid: st.pid, id: mid });
    m.close();
    let r = null; for (let i = 0; i < 6; i++) { r = await siteSync(); if (!r || !r.left || !siteNet()) break; }
    const map = await idMapGet(); const real = realId(mid, map);
    if (r && !r.left && !String(real).startsWith('tmp-')) { toast('Réunion terminée : voici le PV', 3000); go(`#/pv/${real}?mail=1`); } else { toast('Réunion terminée. Le PV sera prêt dès le retour du réseau (onglet Suivi › Réunions).', 6000); st.soft(); }
  };
}

// ---------------------------------------------------------------- Onglet « Suivi » du chantier (téléphone) : remplace Plans, Points et Réunions
async function tabSuivi(p, el) {
  const [all] = await Promise.all([db.many(['plan', 'point', 'meeting'], p.id)]);
  const plans = (all.plan || []).sort((a, b) => (a.data.order ?? a.id) - (b.data.order ?? b.id)); const points = all.point || [];
  const mts = (all.meeting || []).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || ''));
  const snap = await snapGet(p.id); const ops = (await opsAll()).filter((o) => +o.pid === p.id);
  const open = points.filter(isOpenPt); const late = points.filter(isLatePt); const live = mts.find((m) => m.data.status === 'encours');
  const nb = (id) => open.filter((x) => (id ? +x.data.planId === id : !x.data.planId)).length;
  el.innerHTML = `<div class="site-entry">
    <a class="btn primary site-go" href="#/site/${p.id}">📍 Sur le chantier</a>
    <small class="muted">${snap ? `✓ Disponible sans réseau (gardé le ${fmtDT(snap.at.slice(0, 19).replace('T', ' '))})` : 'Ouvrez « Sur le chantier » une fois avec du réseau : il restera disponible sans réseau.'}${ops.length ? ` · ${ops.length} modification(s) en attente d'envoi` : ''}</small>
    ${live ? `<a class="site-live" href="#/site/${p.id}?meeting=1"><span><i></i>Réunion en cours · ${esc(live.data.title)}</span><b>Ouvrir</b></a>` : ''}
    <div class="two"><a class="tile" href="#/site/${p.id}"><b>${open.length} à faire</b><span class="muted">${late.length ? `dont ${late.length} en retard` : 'aucun en retard'}</span></a>
      <a class="tile" href="#/site/${p.id}?meeting=1"><b>Réunion</b><span class="muted">${mts[0] ? `dernière : ${fmtDate(mts[0].data.date)}` : 'aucune pour l\'instant'}</span></a></div>
    <h3>Plans</h3>
    <div class="site-tiles">${plans.map((pl) => `<a class="site-tile" href="#/site/${p.id}/${pl.id}">${pl.data.thumbId ? `<img src="${fileUrl(pl.data.thumbId)}" alt="" loading="lazy">` : ''}<span><b>${esc(pl.data.name)}</b><small class="muted">${nb(pl.id)} point(s) à faire</small></span></a>`).join('')}
      <a class="site-tile" href="#/site/${p.id}/sansplan"><span><b>Sans plan</b><small class="muted">${nb(0)} point(s) à faire · façade, toiture, extérieur…</small></span></a></div>
    <h3>Réunions</h3>
    <div class="rows">${mts.slice(0, 6).map((x) => `<a class="row" href="#/pv/${x.id}"><span class="grow"><b>${esc(x.data.title)}</b><small class="muted">${fmtDate(x.data.date)}${x.data.status === 'encours' ? ' · en cours' : ''}${(x.data.signatures || []).length ? ` · ${x.data.signatures.length} signature(s)` : ''}</small></span><span class="muted">PV ›</span></a>`).join('') || '<p class="muted">Aucune réunion.</p>'}</div>
    <div class="btns"><a class="btn sm" href="#/project/${p.id}/points/liste">Liste des points et rapport PDF</a><a class="btn sm" href="#/project/${p.id}/plans/liste">Gérer les plans</a><a class="btn sm" href="#/project/${p.id}/meetings/liste">Tous les PV</a></div></div>`;
}
