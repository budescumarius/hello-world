'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, PHOTO_DIR, hashPassword, checkPassword, getSetting, setSetting } = require('./db');
const drive = require('./drive');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const ROLES = ['admin', 'responsabil', 'muncitor'];
const VERSION = '15'; // la fel ca APP_VERSION din app.js

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use((req, res, next) => { // aplicația trimite PATCH/DELETE ca POST + antet
  const m = req.get('X-HTTP-Method-Override');
  if (req.method === 'POST' && ['PATCH', 'DELETE'].includes(m)) req.method = m;
  next();
});

// ---------- utilitare ----------
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const cleanStr = (s, max = 200) => String(s ?? '').trim().slice(0, max);
const isAdmin = (u) => u.role === 'admin';

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES (?, ?)').run(token, userId);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${3600 * 24 * 365}${secure}`);
}
function currentUser(req) {
  const sid = cookies(req).sid;
  if (!sid) return null;
  return db.prepare(`SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.active = 1`).get(sid) || null;
}
const auth = (...roles) => (req, res, next) => {
  const u = currentUser(req);
  if (!u) return fail(res, 401, 'Nu ești conectat');
  if (roles.length && !roles.includes(u.role)) return fail(res, 403, 'Nu ai acces');
  req.user = u;
  next();
};

const assignedSiteIds = (userId) =>
  new Set(db.prepare('SELECT site_id FROM site_users WHERE user_id = ?').all(userId).map((r) => r.site_id));
const canUseSite = (u, siteId) => isAdmin(u) || assignedSiteIds(u.id).has(Number(siteId));

// Vede: adminul tot; ceilalți pozele proprii + toate pozele de pe șantierele atribuite.
function canSeeEntry(u, e) {
  if (isAdmin(u) || e.user_id === u.id) return true;
  return e.site_id != null && assignedSiteIds(u.id).has(e.site_id);
}
// Comentariu / mutare: autorul, adminul și responsabilul șantierului.
const canEditEntry = (u, e) => isAdmin(u) || e.user_id === u.id || (u.role === 'responsabil' && canSeeEntry(u, e));
// Ștergere: doar autorul și adminul.
const canDeleteEntry = (u, e) => isAdmin(u) || e.user_id === u.id;

function setSiteUsers(siteId, userIds) {
  db.prepare('DELETE FROM site_users WHERE site_id = ?').run(siteId);
  const ins = db.prepare('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT ?, id FROM users WHERE id = ?');
  for (const uid of new Set(userIds.map(Number))) ins.run(siteId, uid);
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// limită simplă pentru încercări de login
const loginTries = new Map();
function tooManyTries(key) {
  const now = Date.now();
  const t = (loginTries.get(key) || []).filter((x) => now - x < 10 * 60_000);
  loginTries.set(key, t);
  return t.length >= 10;
}

// ---------- autentificare ----------
const json = express.json({ limit: '100kb' });

app.get('/api/state', (req, res) => {
  const needsSetup = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  res.json({ needsSetup, user: needsSetup ? null : currentUser(req), version: VERSION });
});

app.post('/api/setup', json, (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return fail(res, 400, 'Aplicația este deja configurată');
  const name = cleanStr(req.body.name, 80), username = cleanStr(req.body.username, 40), password = String(req.body.password || '');
  if (!name || !username || password.length < 6) return fail(res, 400, 'Completează numele, utilizatorul și o parolă de minim 6 caractere');
  const r = db.prepare("INSERT INTO users(name, username, pass_hash, role) VALUES (?, ?, ?, 'admin')").run(name, username, hashPassword(password));
  setSession(req, res, Number(r.lastInsertRowid));
  res.json({ ok: true });
});

app.post('/api/login', json, (req, res) => {
  const username = cleanStr(req.body.username, 40);
  const key = req.ip + '|' + username.toLowerCase();
  if (tooManyTries(key)) return fail(res, 429, 'Prea multe încercări. Așteaptă 10 minute.');
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!u || !checkPassword(req.body.password || '', u.pass_hash)) {
    loginTries.get(key).push(Date.now());
    return fail(res, 401, 'Utilizator sau parolă greșită');
  }
  loginTries.delete(key);
  setSession(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const sid = cookies(req).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

// Datele pentru ecranul principal: utilizator + șantierele în care poate pune poze
app.get('/api/me', auth(), (req, res) => {
  const u = req.user;
  const sites = isAdmin(u)
    ? db.prepare('SELECT id, name, address FROM sites WHERE archived = 0 ORDER BY name COLLATE NOCASE').all()
    : db.prepare(`SELECT s.id, s.name, s.address FROM sites s JOIN site_users su ON su.site_id = s.id
        WHERE su.user_id = ? AND s.archived = 0 ORDER BY s.name COLLATE NOCASE`).all(u.id);
  res.json({ user: u, sites });
});

// ---------- șantiere ----------
app.get('/api/sites', auth('admin', 'responsabil'), (req, res) => {
  const u = req.user;
  const where = isAdmin(u) ? '' : 'WHERE s.id IN (SELECT site_id FROM site_users WHERE user_id = :uid)';
  const sites = db.prepare(`SELECT s.id, s.name, s.address, s.archived, s.created_at,
      (SELECT COUNT(*) FROM entries e WHERE e.site_id = s.id) AS count,
      (SELECT MAX(taken_at) FROM entries e WHERE e.site_id = s.id) AS last_at,
      (SELECT thumb FROM entries e WHERE e.site_id = s.id AND e.kind='photo' ORDER BY taken_at DESC LIMIT 1) IS NOT NULL AS has_photo,
      (SELECT id FROM entries e WHERE e.site_id = s.id AND e.kind='photo' ORDER BY taken_at DESC LIMIT 1) AS cover_id,
      (SELECT client_id FROM entries e WHERE e.site_id = s.id AND e.kind='photo' ORDER BY taken_at DESC LIMIT 1) AS cover_v
    FROM sites s ${where} ORDER BY s.archived, s.name COLLATE NOCASE`).all(isAdmin(u) ? {} : { uid: u.id });
  const members = db.prepare('SELECT su.site_id, u.id, u.name, u.role FROM site_users su JOIN users u ON u.id = su.user_id ORDER BY u.name').all();
  for (const s of sites) s.users = members.filter((m) => m.site_id === s.id).map(({ id, name, role }) => ({ id, name, role }));
  let unassigned = null;
  if (isAdmin(u)) unassigned = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE site_id IS NULL').get().n;
  res.json({ sites, unassigned });
});

app.post('/api/sites', auth('admin', 'responsabil'), json, (req, res) => {
  const name = cleanStr(req.body.name, 120);
  if (!name) return fail(res, 400, 'Scrie numele șantierului');
  const id = tx(() => {
    const r = db.prepare('INSERT INTO sites(name, address, created_by) VALUES (?, ?, ?)').run(name, cleanStr(req.body.address, 250), req.user.id);
    const id = Number(r.lastInsertRowid);
    const ids = Array.isArray(req.body.userIds) ? req.body.userIds : [];
    if (req.user.role === 'responsabil') ids.push(req.user.id); // cine creează e automat atribuit
    setSiteUsers(id, ids);
    return id;
  });
  res.json({ id });
});

app.patch('/api/sites/:id', auth('admin', 'responsabil'), json, (req, res) => {
  const id = Number(req.params.id);
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (!site) return fail(res, 404, 'Șantier inexistent');
  if (!canUseSite(req.user, id)) return fail(res, 403, 'Nu ai acces la acest șantier');
  const name = req.body.name !== undefined ? cleanStr(req.body.name, 120) : site.name;
  if (!name) return fail(res, 400, 'Scrie numele șantierului');
  const address = req.body.address !== undefined ? cleanStr(req.body.address, 250) : site.address;
  const archived = req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : site.archived;
  tx(() => {
    db.prepare('UPDATE sites SET name = ?, address = ?, archived = ? WHERE id = ?').run(name, address, archived, id);
    if (Array.isArray(req.body.userIds)) {
      const ids = [...req.body.userIds];
      if (req.user.role === 'responsabil') ids.push(req.user.id); // nu se poate scoate singur
      setSiteUsers(id, ids);
    }
  });
  if (name !== site.name) drive.renameSiteFolder(id, name);
  res.json({ ok: true });
});

app.delete('/api/sites/:id', auth('admin'), (req, res) => {
  db.prepare('DELETE FROM sites WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true }); // pozele rămân, la „Fără șantier”
});

// ---------- utilizatori ----------
app.get('/api/users', auth('admin', 'responsabil'), (req, res) => {
  if (!isAdmin(req.user)) {
    return res.json(db.prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE').all());
  }
  const users = db.prepare(`SELECT u.id, u.name, u.username, u.role, u.active,
      (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id) AS count
    FROM users u ORDER BY u.active DESC, u.name COLLATE NOCASE`).all();
  const links = db.prepare('SELECT user_id, site_id FROM site_users').all();
  for (const u of users) u.siteIds = links.filter((l) => l.user_id === u.id).map((l) => l.site_id);
  res.json(users);
});

app.post('/api/users', auth('admin'), json, (req, res) => {
  const name = cleanStr(req.body.name, 80), username = cleanStr(req.body.username, 40), password = String(req.body.password || '');
  const role = ROLES.includes(req.body.role) ? req.body.role : 'muncitor';
  if (!name || !username) return fail(res, 400, 'Completează numele și utilizatorul');
  if (password.length < 4) return fail(res, 400, 'Parola trebuie să aibă minim 4 caractere');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return fail(res, 400, 'Utilizatorul există deja');
  const id = tx(() => {
    const id = Number(db.prepare('INSERT INTO users(name, username, pass_hash, role) VALUES (?, ?, ?, ?)').run(name, username, hashPassword(password), role).lastInsertRowid);
    const ins = db.prepare('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT id, ? FROM sites WHERE id = ?');
    for (const sid of Array.isArray(req.body.siteIds) ? req.body.siteIds : []) ins.run(id, Number(sid));
    return id;
  });
  res.json({ id });
});

app.patch('/api/users/:id', auth('admin'), json, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return fail(res, 404, 'Utilizator inexistent');
  const b = req.body;
  const role = ROLES.includes(b.role) ? b.role : u.role;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : u.active;
  if (id === req.user.id && (role !== 'admin' || !active)) return fail(res, 400, 'Nu îți poți scoate singur drepturile de admin');
  const username = b.username !== undefined ? cleanStr(b.username, 40) : u.username;
  if (!username) return fail(res, 400, 'Utilizator gol');
  if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(username, id)) return fail(res, 400, 'Utilizatorul există deja');
  if (b.password && String(b.password).length < 4) return fail(res, 400, 'Parola trebuie să aibă minim 4 caractere');
  tx(() => {
    db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?')
      .run(b.name !== undefined ? cleanStr(b.name, 80) || u.name : u.name, username, role, active, id);
    if (b.password) {
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').run(id, req.user.id);
    }
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    if (Array.isArray(b.siteIds)) {
      db.prepare('DELETE FROM site_users WHERE user_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT id, ? FROM sites WHERE id = ?');
      for (const sid of b.siteIds) ins.run(id, Number(sid));
    }
  });
  res.json({ ok: true });
});

app.post('/api/password', auth(), json, (req, res) => {
  const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(req.body.old || '', u.pass_hash)) return fail(res, 400, 'Parola actuală e greșită');
  if (String(req.body.password || '').length < 4) return fail(res, 400, 'Parola nouă trebuie să aibă minim 4 caractere');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(req.body.password), req.user.id);
  res.json({ ok: true });
});

// ---------- poze și note ----------
const ENTRY_SELECT = `SELECT e.id, e.client_id, e.kind, e.site_id, e.user_id, e.comment, e.taken_at, e.size, e.drive_status,
  s.name AS site_name, u.name AS user_name
  FROM entries e LEFT JOIN sites s ON s.id = e.site_id LEFT JOIN users u ON u.id = e.user_id`;
const getEntry = (id) => db.prepare(ENTRY_SELECT + ' WHERE e.id = ?').get(id);

function parseMeta(req) {
  try { return JSON.parse(decodeURIComponent(req.get('X-Meta') || '{}')); } catch { return {}; }
}
function normDate(s) {
  const d = new Date(s);
  return isNaN(d) || d > Date.now() + 86400_000 ? new Date().toISOString() : d.toISOString();
}
function resolveSite(u, siteId) {
  if (siteId === null || siteId === undefined || siteId === '') return null;
  return canUseSite(u, siteId) && db.prepare('SELECT 1 FROM sites WHERE id = ?').get(Number(siteId)) ? Number(siteId) : null;
}
// Număr nou pentru fiecare poză, niciodată refolosit (vezi next_entry_id din api.php).
function nextEntryId() {
  const n = Math.max(db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM entries').get().m, Number(getSetting('entry_seq')) || 0) + 1;
  setSetting('entry_seq', n);
  return n;
}
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// Corp: [4 octeți lungime miniatură][miniatură JPEG][poza JPEG]
app.post('/api/entries/photo', auth(), express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  const meta = parseMeta(req);
  const clientId = cleanStr(meta.clientId, 64);
  if (!clientId) return fail(res, 400, 'Lipsește clientId');
  const existing = db.prepare('SELECT id, user_id FROM entries WHERE client_id = ?').get(clientId);
  if (existing) return existing.user_id === req.user.id ? res.json(getEntry(existing.id)) : fail(res, 409, 'Conflict');

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length < 8) return fail(res, 400, 'Fișier lipsă');
  const tlen = body.readUInt32BE(0);
  const full = body.subarray(4 + tlen);
  const thumb = tlen > 0 ? body.subarray(4, 4 + tlen) : full; // fără miniatură: folosim poza
  if (!isJpeg(thumb) || !isJpeg(full)) return fail(res, 400, 'Format invalid (doar JPEG)');

  const takenAt = normDate(meta.takenAt);
  const dir = takenAt.slice(0, 7);
  fs.mkdirSync(path.join(PHOTO_DIR, dir), { recursive: true });
  const base = `${dir}/${crypto.randomUUID()}`;
  fs.writeFileSync(path.join(PHOTO_DIR, base + '.jpg'), full);
  fs.writeFileSync(path.join(PHOTO_DIR, base + '_t.jpg'), thumb);

  const newId = nextEntryId();
  db.prepare(`INSERT INTO entries(id, client_id, kind, site_id, user_id, comment, file, thumb, size, taken_at)
    VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?)`).run(newId, clientId, resolveSite(req.user, meta.siteId), req.user.id,
    cleanStr(meta.comment, 2000), base + '.jpg', base + '_t.jpg', full.length, takenAt);
  drive.kick();
  res.json(getEntry(newId));
});

app.post('/api/entries/note', auth(), json, (req, res) => {
  const clientId = cleanStr(req.body.clientId, 64) || crypto.randomUUID();
  const comment = cleanStr(req.body.comment, 2000);
  if (!comment) return fail(res, 400, 'Scrie ceva în notă');
  const existing = db.prepare('SELECT id, user_id FROM entries WHERE client_id = ?').get(clientId);
  if (existing) return existing.user_id === req.user.id ? res.json(getEntry(existing.id)) : fail(res, 409, 'Conflict');
  const newId = nextEntryId();
  db.prepare(`INSERT INTO entries(id, client_id, kind, site_id, user_id, comment, taken_at, drive_status)
    VALUES (?, ?, 'note', ?, ?, ?, ?, 'none')`).run(newId, clientId, resolveSite(req.user, req.body.siteId), req.user.id, comment, normDate(req.body.takenAt));
  res.json(getEntry(newId));
});

// ?site=<id>|none  &mine=1  &user=<id>  &before=<taken_at>|<id>  &limit=
app.get('/api/entries', auth(), (req, res) => {
  const u = req.user;
  const where = [], p = {};
  const site = req.query.site;
  if (site === 'none') where.push('e.site_id IS NULL');
  else if (site) {
    p.site = Number(site);
    where.push('e.site_id = :site');
  }
  if (req.query.mine) { where.push('e.user_id = :me'); p.me = u.id; }
  else if (!isAdmin(u)) {
    where.push('(e.user_id = :me OR e.site_id IN (SELECT site_id FROM site_users WHERE user_id = :me))');
    p.me = u.id;
  }
  if (req.query.user) { where.push('e.user_id = :uid'); p.uid = Number(req.query.user); }
  if (req.query.before) {
    const [t, id] = String(req.query.before).split('|');
    where.push('(e.taken_at < :bt OR (e.taken_at = :bt AND e.id < :bid))');
    p.bt = t; p.bid = Number(id) || 0;
  }
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const rows = db.prepare(`${ENTRY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.taken_at DESC, e.id DESC LIMIT ${limit}`).all(p);
  res.json(rows);
});

app.patch('/api/entries/:id', auth(), json, (req, res) => {
  const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(req.params.id));
  if (!e || !canSeeEntry(req.user, e)) return fail(res, 404, 'Nu există');
  if (!canEditEntry(req.user, e)) return fail(res, 403, 'Poți modifica doar pozele făcute de tine');
  let siteId = e.site_id;
  if (req.body.siteId !== undefined) {
    siteId = req.body.siteId === null ? null : resolveSite(req.user, req.body.siteId);
    if (req.body.siteId !== null && siteId === null) return fail(res, 403, 'Nu ai acces la acel șantier');
  }
  const comment = req.body.comment !== undefined ? cleanStr(req.body.comment, 2000) : e.comment;
  if (e.kind === 'note' && !comment) return fail(res, 400, 'Nota nu poate fi goală');
  db.prepare('UPDATE entries SET site_id = ?, comment = ? WHERE id = ?').run(siteId, comment, e.id);
  if (e.drive_file_id && (siteId !== e.site_id || comment !== e.comment)) drive.updateEntry(e.id);
  res.json(getEntry(e.id));
});

app.delete('/api/entries/:id', auth(), (req, res) => {
  const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(req.params.id));
  if (!e || !canSeeEntry(req.user, e)) return fail(res, 404, 'Nu există');
  if (!canDeleteEntry(req.user, e)) return fail(res, 403, 'Poți șterge doar pozele făcute de tine');
  db.prepare('DELETE FROM entries WHERE id = ?').run(e.id);
  for (const f of [e.file, e.thumb]) if (f) fs.rm(path.join(PHOTO_DIR, f), { force: true }, () => {});
  drive.deleteFile(e.drive_file_id);
  res.json({ ok: true });
});

app.get('/files/:id/:size(full|thumb)', auth(), (req, res) => {
  const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(req.params.id));
  if (!e || e.kind !== 'photo' || !canSeeEntry(req.user, e)) return res.sendStatus(404);
  if (req.query.dl) res.attachment(`poza_${e.taken_at.slice(0, 10)}_${e.id}.jpg`);
  res.sendFile(path.join(PHOTO_DIR, req.params.size === 'full' ? e.file : e.thumb), {
    headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
});

// ---------- Google Drive ----------
const redirectUri = (req) => (PUBLIC_URL || `${req.protocol}://${req.get('host')}`) + '/api/drive/callback';
const oauthStates = new Map();

app.get('/api/drive', auth('admin'), (req, res) => res.json({ ...drive.status(), redirectUri: redirectUri(req) }));

app.get('/api/drive/connect', auth('admin'), (req, res) => {
  if (!drive.configured()) return fail(res, 400, 'Lipsesc GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET');
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());
  res.redirect(drive.authUrl(redirectUri(req), state));
});

app.get('/api/drive/callback', auth('admin'), async (req, res) => {
  const ok = oauthStates.delete(String(req.query.state));
  try {
    if (!ok) throw new Error('Cerere expirată, încearcă din nou');
    if (req.query.error) throw new Error(String(req.query.error));
    await drive.handleCallback(String(req.query.code), redirectUri(req));
    res.redirect('/#cont?drive=ok');
  } catch (e) {
    res.redirect('/#cont?drive=' + encodeURIComponent(e.message));
  }
});

app.post('/api/drive/disconnect', auth('admin'), (req, res) => { drive.disconnect(); res.json({ ok: true }); });
app.post('/api/drive/sync', auth('admin'), (req, res) => { drive.kick(); res.json({ ok: true }); });
app.post('/api/sync/kick', auth(), (req, res) => { drive.kick(); res.json({ ok: true }); });

// ---------- aplicația web ----------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/api', (req, res) => fail(res, 404, 'Nu există'));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return fail(res, 413, 'Fișier prea mare');
  fail(res, 500, 'Eroare pe server');
});

app.listen(PORT, () => {
  console.log(`Foto Șantier pornit pe http://localhost:${PORT}`);
  console.log(drive.connected() ? 'Google Drive: conectat' : drive.configured() ? 'Google Drive: neconectat (conectează din Setări)' : 'Google Drive: dezactivat');
  drive.kick();
});
