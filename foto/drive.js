'use strict';
// Copiere automată a pozelor în Google Drive (opțional).
// Folosește OAuth cu scope "drive.file": aplicația vede doar fișierele create de ea.
const fs = require('fs');
const path = require('path');
const { db, PHOTO_DIR, getSetting, setSetting } = require('./db');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_NAME = process.env.DRIVE_FOLDER_NAME || 'Poze Șantier';
const NO_SITE = 'Fără șantier';

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);
const connected = () => configured() && Boolean(getSetting('drive_refresh_token'));

function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPE, access_type: 'offline', prompt: 'consent', state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Eroare Google');
  return j;
}

async function handleCallback(code, redirectUri) {
  const j = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!j.refresh_token) throw new Error('Google nu a trimis refresh_token');
  setSetting('drive_refresh_token', j.refresh_token);
  setSetting('drive_root_id', null);
  db.prepare('UPDATE sites SET drive_folder_id = NULL').run();
  setSetting('drive_nosite_id', null);
  db.prepare("UPDATE entries SET drive_status='pending', drive_file_id=NULL WHERE kind='photo'").run();
  cachedToken = null;
  kick();
}

function disconnect() {
  setSetting('drive_refresh_token', null);
  cachedToken = null;
}

let cachedToken = null; // { token, exp }
async function accessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const j = await tokenRequest({ refresh_token: getSetting('drive_refresh_token'), grant_type: 'refresh_token' });
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cachedToken.token;
}

async function api(url, opts = {}) {
  const token = await accessToken();
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error?.message || 'Drive HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  return j;
}

async function folderExists(id) {
  try {
    const f = await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`);
    return !f.trashed;
  } catch (e) { if (e.status === 404) return false; throw e; }
}

async function createFolder(name, parent) {
  const f = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }),
  });
  return f.id;
}

async function rootFolder() {
  let id = getSetting('drive_root_id');
  if (id && await folderExists(id)) return id;
  id = await createFolder(ROOT_NAME);
  setSetting('drive_root_id', id);
  return id;
}

async function siteFolder(siteId) {
  if (!siteId) {
    let id = getSetting('drive_nosite_id');
    if (id && await folderExists(id)) return id;
    id = await createFolder(NO_SITE, await rootFolder());
    setSetting('drive_nosite_id', id);
    return id;
  }
  const site = db.prepare('SELECT id, name, drive_folder_id FROM sites WHERE id = ?').get(siteId);
  if (!site) return siteFolder(null);
  if (site.drive_folder_id && await folderExists(site.drive_folder_id)) return site.drive_folder_id;
  const id = await createFolder(site.name, await rootFolder());
  db.prepare('UPDATE sites SET drive_folder_id = ? WHERE id = ?').run(id, site.id);
  return id;
}

async function renameSiteFolder(siteId, name) {
  const site = db.prepare('SELECT drive_folder_id FROM sites WHERE id = ?').get(siteId);
  if (!connected() || !site?.drive_folder_id) return;
  try {
    await api(`https://www.googleapis.com/drive/v3/files/${site.drive_folder_id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
  } catch (e) { console.warn('Drive rename:', e.message); }
}

function fileName(e) {
  const d = e.taken_at.replace('T', '_').replace(/:/g, '-').slice(0, 19);
  const who = (e.user_name || 'necunoscut').replace(/[^\p{L}\p{N}]+/gu, '_');
  return `${d}_${who}_${e.id}.jpg`;
}

async function uploadEntry(e) {
  const parent = await siteFolder(e.site_id);
  const meta = { name: fileName(e), parents: [parent], description: e.comment || undefined };
  const data = fs.readFileSync(path.join(PHOTO_DIR, e.file));
  const boundary = 'b' + Date.now().toString(36);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const f = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return f.id;
}

// Când se schimbă șantierul sau comentariul unei poze deja trimise.
async function updateEntry(entryId) {
  const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(entryId);
  if (!connected() || !e?.drive_file_id) return;
  try {
    const cur = await api(`https://www.googleapis.com/drive/v3/files/${e.drive_file_id}?fields=parents`);
    const parent = await siteFolder(e.site_id);
    const q = new URLSearchParams({ addParents: parent, removeParents: (cur.parents || []).join(',') });
    await api(`https://www.googleapis.com/drive/v3/files/${e.drive_file_id}?${q}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: e.comment }),
    });
  } catch (err) { console.warn('Drive update:', err.message); }
}

async function deleteFile(fileId) {
  if (!connected() || !fileId) return;
  try { await api(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' }); }
  catch (e) { if (e.status !== 404) console.warn('Drive delete:', e.message); }
}

let running = false;
let lastError = null;
async function work() {
  if (running || !connected()) return;
  running = true;
  try {
    for (;;) {
      const e = db.prepare(`SELECT e.*, u.name AS user_name FROM entries e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.kind='photo' AND e.drive_status='pending' ORDER BY e.id LIMIT 1`).get();
      if (!e) break;
      const id = await uploadEntry(e);
      db.prepare("UPDATE entries SET drive_status='done', drive_file_id=? WHERE id=?").run(id, e.id);
      // Dacă a fost mutată/comentată între timp, sincronizăm.
      const now = db.prepare('SELECT site_id, comment FROM entries WHERE id=?').get(e.id);
      if (now && (now.site_id !== e.site_id || now.comment !== e.comment)) await updateEntry(e.id);
    }
    lastError = null;
  } catch (err) {
    lastError = err.message;
    console.warn('Drive:', err.message);
  } finally {
    running = false;
  }
}
const kick = () => { setImmediate(work); };
setInterval(work, 30_000).unref();

function status() {
  const pending = db.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind='photo' AND drive_status='pending'").get().n;
  return { configured: configured(), connected: connected(), pending, lastError, folder: ROOT_NAME };
}

module.exports = { configured, connected, authUrl, handleCallback, disconnect, kick, status, updateEntry, deleteFile, renameSiteFolder };
