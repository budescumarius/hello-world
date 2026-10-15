// Minimal JSON-file store. Good enough for a small company site with one admin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  users: [],
  settings: {
    companyName: 'Timberway',
    tagline: { nl: 'Your Space. Our Work. Your Way.', fr: 'Your Space. Our Work. Your Way.', en: 'Your Space. Our Work. Your Way.' },
    phone: '+32 470 70 08 02',
    whatsapp: '',
    email: 'info@timberway.be',
    address: '1730 Asse',
    vat: '',
    hours: { nl: 'Ma–vr 8u–18u · Za 9u–13u', fr: 'Lun–Ven 8h–18h · Sam 9h–13h', en: 'Mon–Fri 8am–6pm · Sat 9am–1pm' },
    founder: 'Marius Budescu',
    facebook: 'https://www.facebook.com/profile.php?id=61581153301581',
    instagram: 'https://www.instagram.com/_timberway_/',
    texts: { fr: {}, nl: {}, en: {} },   // admin overrides of page texts, per language
    colors: { primary: '', dark: '' },   // empty = default palette
    logo: '',                            // uploaded logo file name, empty = default logo
    notifyEmail: ''                      // where quote requests are e-mailed; set in admin
  },
  albums: [],
  posts: [],
  subscribers: [],
  messages: []
};

let db = null;

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...DEFAULT_DB.settings, ...(db.settings || {}) };
    for (const key of ['users', 'albums', 'posts', 'subscribers', 'messages']) db[key] = db[key] || [];
    // One-time: fill in the social links on sites created before they were known.
    if (!db.socialDefaultsApplied) {
      for (const k of ['facebook', 'instagram']) if (!db.settings[k]) db.settings[k] = DEFAULT_DB.settings[k];
      db.socialDefaultsApplied = true;
      save();
    }
  } else {
    db = JSON.parse(JSON.stringify(DEFAULT_DB));
    save();
  }
  return db;
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function upsertUser(username, password) {
  load();
  const existing = db.users.find(u => u.username === username);
  if (existing) existing.password = hashPassword(password);
  else db.users.push({ id: id(), username, password: hashPassword(password), createdAt: new Date().toISOString() });
  save();
}

module.exports = { load, save, id, hashPassword, verifyPassword, upsertUser, DATA_DIR };
