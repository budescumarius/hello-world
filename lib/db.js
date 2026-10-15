// Minimal JSON-file store. Good enough for a small company site with one admin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = {
  users: [],
  settings: {
    companyName: 'Houtbouw',
    tagline: { nl: 'Bouwen met hout, met vakmanschap', fr: 'Construire en bois, avec savoir-faire', en: 'Building with timber, built with care' },
    phone: '+32 000 00 00 00',
    whatsapp: '',
    email: 'info@example.be',
    address: 'Straat 1, 0000 Gemeente, België',
    vat: 'BE 0000.000.000',
    region: { nl: 'Vlaanderen, Brussel en Wallonië', fr: 'Flandre, Bruxelles et Wallonie', en: 'Flanders, Brussels and Wallonia' },
    facebook: '',
    instagram: '',
    statYears: '15',
    statProjects: '200',
    statWeeks: '3'
  },
  albums: [],
  messages: []
};

let db = null;

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...DEFAULT_DB.settings, ...(db.settings || {}) };
    for (const key of ['users', 'albums', 'messages']) db[key] = db[key] || [];
  } else {
    db = structuredClone(DEFAULT_DB);
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
