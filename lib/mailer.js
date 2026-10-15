// Sends plain-text e-mails through the server's sendmail (available on cPanel hosting),
// so no SMTP password or extra package is needed.
const fs = require('fs');
const { spawn } = require('child_process');

const SENDMAIL = process.env.SENDMAIL_PATH || ['/usr/sbin/sendmail', '/usr/lib/sendmail'].find(p => fs.existsSync(p));

// Header values must never contain line breaks (header injection).
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const encodeWord = s => `=?UTF-8?B?${Buffer.from(clean(s)).toString('base64')}?=`;
const isEmail = s => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(clean(s));

function available() {
  return Boolean(SENDMAIL);
}

function send({ to, subject, text, fromName = 'Site', fromAddress, replyTo }) {
  return new Promise((resolve, reject) => {
    if (!SENDMAIL) return reject(new Error('sendmail_unavailable'));
    if (!isEmail(to)) return reject(new Error('invalid_recipient'));
    const from = isEmail(fromAddress) ? clean(fromAddress) : clean(to);
    const headers = [
      `From: ${encodeWord(fromName)} <${from}>`,
      `To: <${clean(to)}>`,
      `Subject: ${encodeWord(subject)}`,
      isEmail(replyTo) ? `Reply-To: <${clean(replyTo)}>` : null,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64'
    ].filter(Boolean);
    const body = Buffer.from(String(text)).toString('base64').replace(/.{76}/g, '$&\r\n');
    const child = spawn(SENDMAIL, ['-t', '-i', '-f', from]);
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(err || `sendmail exited with ${code}`))));
    child.stdin.end(headers.join('\r\n') + '\r\n\r\n' + body + '\r\n');
  });
}

module.exports = { send, available, isEmail };
