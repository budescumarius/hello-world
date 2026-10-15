(function () {
  const LANGS = ['fr', 'nl', 'en'];

  function detectLang() {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem('lang');
      if (LANGS.includes(saved)) return saved;
    } catch (e) { /* storage blocked */ }
    const nav = (navigator.languages || [navigator.language || 'nl']).map(l => l.slice(0, 2).toLowerCase());
    return nav.find(l => LANGS.includes(l)) || 'fr';
  }

  const App = {
    lang: detectLang(),
    settings: null,
    listeners: [],
    t(key) { return (I18N[App.lang] && I18N[App.lang][key]) || I18N.fr[key] || key; },
    // Pick the current language from an {nl, fr, en} object, falling back to any filled-in language.
    pick(obj) {
      if (!obj) return '';
      return obj[App.lang] || obj.fr || obj.nl || obj.en || '';
    },
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    onLang(fn) { App.listeners.push(fn); },
    setLang(lang) {
      if (!LANGS.includes(lang)) return;
      App.lang = lang;
      try { localStorage.setItem('lang', lang); } catch (e) { /* ignore */ }
      const url = new URL(location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url);
      App.apply();
    },
    apply() {
      document.documentElement.lang = App.lang;
      document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = App.t(el.dataset.i18n); });
      document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = App.t(el.dataset.i18nHtml); });
      document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = App.t(el.dataset.i18nPh); });
      document.querySelectorAll('.lang-switch button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === App.lang)));
      // keep internal links in the chosen language
      document.querySelectorAll('a[data-keep-lang]').forEach(a => {
        const u = new URL(a.getAttribute('href'), location.href);
        u.searchParams.set('lang', App.lang);
        a.href = u.pathname + u.search + u.hash;
      });
      App.renderSettings();
      App.listeners.forEach(fn => fn(App.lang));
    },
    renderSettings() {
      const s = App.settings;
      if (!s) return;
      document.querySelectorAll('[data-setting]').forEach(el => {
        const v = s[el.dataset.setting];
        el.textContent = typeof v === 'object' ? App.pick(v) : (v || '');
      });
      const tel = 'tel:' + String(s.phone || '').replace(/[^\d+]/g, '');
      document.querySelectorAll('[data-tel]').forEach(a => { a.href = tel; });
      document.querySelectorAll('[data-mailto]').forEach(a => { a.href = 'mailto:' + (s.email || ''); });
      const wa = String(s.whatsapp || '').replace(/[^\d]/g, '');
      document.querySelectorAll('[data-wa]').forEach(a => {
        a.hidden = !wa;
        if (wa) a.href = 'https://wa.me/' + wa;
      });
      const bar = document.querySelector('.action-bar');
      if (bar) bar.classList.toggle('three', Boolean(wa));
      ['facebook', 'instagram'].forEach(k => document.querySelectorAll(`[data-social="${k}"]`).forEach(a => {
        a.hidden = !s[k];
        if (s[k]) a.href = s[k];
      }));
      document.querySelectorAll('[data-if]').forEach(el => { el.hidden = !s[el.dataset.if]; });
      document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
      if (document.body.dataset.page === 'home') document.title = `${s.companyName} — ${App.pick(s.tagline)}`;
    },
    async init() {
      document.querySelectorAll('.lang-switch button').forEach(b => b.addEventListener('click', () => App.setLang(b.dataset.lang)));

      const menuBtn = document.querySelector('.menu-btn');
      if (menuBtn) {
        const toggle = open => {
          document.body.classList.toggle('menu-open', open);
          menuBtn.setAttribute('aria-expanded', String(open));
        };
        menuBtn.addEventListener('click', () => toggle(!document.body.classList.contains('menu-open')));
        document.querySelectorAll('.mobile-menu a').forEach(a => a.addEventListener('click', () => toggle(false)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape') toggle(false); });
      }

      App.apply();
      try {
        App.settings = await fetch('/api/settings').then(r => r.json());
      } catch (e) { App.settings = null; }
      App.renderSettings();

      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        }), { threshold: 0.12 });
        document.querySelectorAll('.reveal').forEach(el => io.observe(el));
      } else {
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
      }
    }
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => App.init());
})();
