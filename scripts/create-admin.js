// Usage: npm run create-admin -- <username> [password]
// Without a password, a strong random one is generated and printed once.
const crypto = require('crypto');
const store = require('../lib/db');

const username = process.argv[2] || 'admin';
let password = process.argv[3];
if (!password) password = crypto.randomBytes(12).toString('base64url');
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

store.upsertUser(username, password);
console.log(`Admin account ready.\n  username: ${username}\n  password: ${password}\nLog in at /admin and change the password under "Setări".`);
