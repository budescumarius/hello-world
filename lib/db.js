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
    notifyEmail: '',                     // where quote requests are e-mailed; set in admin
    // Thank-you e-mail sent to the visitor; {name} {company} {phone} {email} {ref} {estimate} are filled in.
    autoReply: {
      "enabled": true,
      "subject": {
        "fr": "Merci pour votre demande – {company}",
        "nl": "Bedankt voor uw aanvraag – {company}",
        "en": "Thank you for your request – {company}"
      },
      "body": {
        "fr": "Bonjour {name},\n\nMerci pour votre demande ! Nous l'avons bien reçue et nous revenons vers vous sous 24 à 48 heures.\n\n{estimate}\n\nVous pouvez aussi nous joindre directement au {phone} ou par e-mail à {email}.\n\nÀ bientôt,\nL'équipe {company}\nYour Space. Our Work. Your Way.",
        "nl": "Beste {name},\n\nBedankt voor uw aanvraag! We hebben ze goed ontvangen en nemen binnen 24 à 48 uur contact met u op.\n\n{estimate}\n\nU kunt ons ook rechtstreeks bereiken op {phone} of via {email}.\n\nTot binnenkort,\nHet team van {company}\nYour Space. Our Work. Your Way.",
        "en": "Hello {name},\n\nThank you for your request! We have received it and will get back to you within 24 to 48 hours.\n\n{estimate}\n\nYou can also reach us directly on {phone} or at {email}.\n\nSee you soon,\nThe {company} team\nYour Space. Our Work. Your Way."
      }
    }
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
