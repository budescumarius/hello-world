// Server-side access to the site's translations (public/js/i18n.js) plus the admin's text overrides.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'i18n.js'), 'utf8'), sandbox);
const I18N = sandbox.window.I18N;
const LOCALES = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-IE' };

function translator(lang, overrides = {}) {
  const l = I18N[lang] ? lang : 'fr';
  const custom = overrides[l] || {};
  const t = key => custom[key] || I18N[l][key] || I18N.fr[key] || key;
  const num = (n, digits = 2) => new Intl.NumberFormat(LOCALES[l], { maximumFractionDigits: digits }).format(n);
  const money = n => new Intl.NumberFormat(LOCALES[l], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const date = d => new Date(d).toLocaleDateString(LOCALES[l], { day: 'numeric', month: 'long', year: 'numeric' });
  return { lang: l, t, num, money, date };
}

module.exports = { translator };
