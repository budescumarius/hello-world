const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const store = require('./lib/db');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const LANGS = ['nl', 'fr', 'en'];
const CATEGORIES = ['kitchen', 'furniture', 'bathroom', 'stairs', 'parquet', 'exterior', 'restoration'];
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = store.load();

// ---------- sessions (HMAC-signed cookie, secret persisted on disk) ----------
const secretFile = path.join(store.DATA_DIR, 'secret.key');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = process.env.SESSION_SECRET || fs.readFileSync(secretFile, 'utf8').trim();

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}
function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.e < Date.now()) return null;
    return db.users.find(u => u.id === data.u) || null;
  } catch {
    return null;
  }
}
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setSessionCookie(req, res, value, maxAgeMs) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`);
}
function requireAdmin(req, res, next) {
  const user = readToken(getCookie(req, 'sid'));
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// Simple in-memory rate limiter for login and contact form
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  hits.set(key, entry);
  return entry.count <= max;
}

// ---------- helpers ----------
function str(v, max = 5000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function i18nField(v, max) {
  const out = {};
  for (const l of LANGS) out[l] = str(v && v[l], max);
  return out;
}
function cleanAlbum(input, existing = {}) {
  return {
    ...existing,
    title: i18nField(input.title, 200),
    description: i18nField(input.description, 5000),
    category: CATEGORIES.includes(input.category) ? input.category : CATEGORIES[0],
    location: str(input.location, 120),
    year: str(String(input.year ?? ''), 4),
    published: Boolean(input.published),
    featured: Boolean(input.featured)
  };
}
function publicAlbum(a) {
  const cover = a.photos.find(p => p.id === a.coverId) || a.photos[0] || null;
  return {
    id: a.id, title: a.title, description: a.description, category: a.category,
    location: a.location, year: a.year, featured: a.featured,
    cover: cover ? `/uploads/${cover.file}` : null,
    photoCount: a.photos.length,
    photos: a.photos.map(p => ({ id: p.id, url: `/uploads/${p.file}`, caption: p.caption })),
    createdAt: a.createdAt
  };
}
function findAlbum(req, res) {
  const album = db.albums.find(a => a.id === req.params.id);
  if (!album) res.status(404).json({ error: 'not_found' });
  return album;
}
function removeFile(file) {
  fs.rm(path.join(UPLOAD_DIR, path.basename(file)), { force: true }, () => {});
}

// ---------- uploads ----------
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[file.mimetype]}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype]))
});

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use(express.json({ limit: '200kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Public API
app.get('/api/settings', (req, res) => {
  res.json({ ...db.settings, categories: CATEGORIES });
});

app.get('/api/albums', (req, res) => {
  const list = db.albums.filter(a => a.published)
    .sort((a, b) => (b.featured - a.featured) || b.createdAt.localeCompare(a.createdAt))
    .map(a => { const p = publicAlbum(a); delete p.photos; return p; });
  res.json(list);
});

app.get('/api/albums/:id', (req, res) => {
  const album = db.albums.find(a => a.id === req.params.id && a.published);
  if (!album) return res.status(404).json({ error: 'not_found' });
  res.json(publicAlbum(album));
});

app.post('/api/contact', (req, res) => {
  if (!rateLimit(`contact:${req.ip}`, 5, 60 * 60 * 1000)) return res.status(429).json({ error: 'too_many' });
  const b = req.body || {};
  if (str(b.website)) return res.json({ ok: true }); // honeypot
  const msg = {
    id: store.id(), name: str(b.name, 120), email: str(b.email, 200), phone: str(b.phone, 40),
    service: str(b.service, 60), message: str(b.message, 4000), lang: LANGS.includes(b.lang) ? b.lang : 'nl',
    createdAt: new Date().toISOString(), read: false
  };
  if (!msg.name || (!msg.email && !msg.phone) || !msg.message) return res.status(400).json({ error: 'missing_fields' });
  db.messages.unshift(msg);
  store.save();
  res.json({ ok: true });
});

// Auth
app.post('/api/login', (req, res) => {
  if (!rateLimit(`login:${req.ip}`, 10, 15 * 60 * 1000)) return res.status(429).json({ error: 'too_many' });
  const { username, password } = req.body || {};
  const user = db.users.find(u => u.username === str(username, 100));
  if (!user || !store.verifyPassword(String(password || ''), user.password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  setSessionCookie(req, res, makeToken(user.id), SESSION_TTL_MS);
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', requireAdmin, (req, res) => res.json({ username: req.user.username }));

// Admin API
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/albums', (req, res) => {
  res.json(db.albums.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(a => ({ ...publicAlbum(a), published: a.published, coverId: a.coverId })));
});

admin.post('/albums', (req, res) => {
  const album = { id: store.id(), ...cleanAlbum(req.body || {}), photos: [], coverId: null, createdAt: new Date().toISOString() };
  if (!album.title.nl && !album.title.fr && !album.title.en) return res.status(400).json({ error: 'title_required' });
  db.albums.push(album);
  store.save();
  res.status(201).json({ ...publicAlbum(album), published: album.published });
});

admin.put('/albums/:id', (req, res) => {
  const album = findAlbum(req, res);
  if (!album) return;
  Object.assign(album, cleanAlbum(req.body || {}, album), { updatedAt: new Date().toISOString() });
  store.save();
  res.json({ ...publicAlbum(album), published: album.published, coverId: album.coverId });
});

admin.delete('/albums/:id', (req, res) => {
  const album = findAlbum(req, res);
  if (!album) return;
  album.photos.forEach(p => removeFile(p.file));
  db.albums = db.albums.filter(a => a.id !== album.id);
  store.save();
  res.json({ ok: true });
});

admin.post('/albums/:id/photos', upload.array('photos', 40), (req, res) => {
  const album = db.albums.find(a => a.id === req.params.id);
  if (!album) {
    (req.files || []).forEach(f => removeFile(f.filename));
    return res.status(404).json({ error: 'not_found' });
  }
  const added = (req.files || []).map(f => ({ id: store.id(), file: f.filename, caption: { nl: '', fr: '', en: '' } }));
  album.photos.push(...added);
  if (!album.coverId && album.photos.length) album.coverId = album.photos[0].id;
  store.save();
  res.json({ added: added.length });
});

admin.put('/albums/:id/photos/:photoId', (req, res) => {
  const album = findAlbum(req, res);
  if (!album) return;
  const photo = album.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'not_found' });
  if (req.body.caption) photo.caption = i18nField(req.body.caption, 300);
  if (req.body.cover) album.coverId = photo.id;
  store.save();
  res.json({ ok: true });
});

admin.put('/albums/:id/order', (req, res) => {
  const album = findAlbum(req, res);
  if (!album) return;
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const byId = new Map(album.photos.map(p => [p.id, p]));
  const sorted = order.map(i => byId.get(i)).filter(Boolean);
  album.photos = [...sorted, ...album.photos.filter(p => !order.includes(p.id))];
  store.save();
  res.json({ ok: true });
});

admin.delete('/albums/:id/photos/:photoId', (req, res) => {
  const album = findAlbum(req, res);
  if (!album) return;
  const photo = album.photos.find(p => p.id === req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'not_found' });
  removeFile(photo.file);
  album.photos = album.photos.filter(p => p.id !== photo.id);
  if (album.coverId === photo.id) album.coverId = album.photos[0] ? album.photos[0].id : null;
  store.save();
  res.json({ ok: true });
});

admin.get('/settings', (req, res) => res.json(db.settings));
admin.put('/settings', (req, res) => {
  const b = req.body || {};
  const s = db.settings;
  for (const k of ['companyName', 'phone', 'whatsapp', 'email', 'address', 'vat', 'founder', 'facebook', 'instagram']) {
    if (k in b) s[k] = str(b[k], 300);
  }
  if (b.tagline) s.tagline = i18nField(b.tagline, 200);
  if (b.hours) s.hours = i18nField(b.hours, 200);
  store.save();
  res.json(s);
});

admin.get('/messages', (req, res) => res.json(db.messages));
admin.put('/messages/:id/read', (req, res) => {
  const m = db.messages.find(x => x.id === req.params.id);
  if (m) { m.read = true; store.save(); }
  res.json({ ok: true });
});
admin.delete('/messages/:id', (req, res) => {
  db.messages = db.messages.filter(x => x.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

admin.post('/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!store.verifyPassword(String(current || ''), req.user.password)) return res.status(400).json({ error: 'wrong_password' });
  if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ error: 'too_short' });
  req.user.password = store.hashPassword(next);
  store.save();
  res.json({ ok: true });
});

app.use('/api/admin', admin);

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code || 'server_error' });
});

// First start on a fresh server: create the admin from env vars and import the projects once.
if (!db.users.length && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 10) console.warn('ADMIN_PASSWORD must be at least 10 characters; admin not created.');
  else {
    store.upsertUser(process.env.ADMIN_USER || 'admin', process.env.ADMIN_PASSWORD);
    console.log(`Admin account "${process.env.ADMIN_USER || 'admin'}" created from environment.`);
  }
}
if (!db.seededAt && !db.albums.length) {
  require('./scripts/seed').seed({ log: () => {} });
  console.log(`Imported ${db.albums.length} projects.`);
}
if (!db.users.length) {
  console.warn('\n⚠  No admin account yet. Set ADMIN_PASSWORD, or run:  npm run create-admin -- <username> <password>\n');
}

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => console.log(`Site running on http://localhost:${PORT}  (admin: /admin)`));
