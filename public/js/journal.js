// Shared bits for the journal (blog), newsletter form and project likes.
(function () {
  const LOCALES = { fr: 'fr-BE', nl: 'nl-BE', en: 'en-GB' };

  const Journal = {
    date(iso) {
      try {
        return new Date(iso).toLocaleDateString(LOCALES[App.lang] || 'fr-BE', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) { return ''; }
    },
    card(post) {
      const cover = post.cover || '/img/illustrations/furniture-1.svg';
      return `
        <a class="post-card" href="/article?id=${encodeURIComponent(post.id)}&lang=${App.lang}">
          <div class="post-img"><img src="${App.esc(cover)}" alt="" loading="lazy"><span class="badge">${App.esc(App.t('journal.cat.' + post.category))}</span></div>
          <div class="post-body">
            <time datetime="${App.esc(post.date)}">${App.esc(Journal.date(post.date))}</time>
            <h3>${App.esc(App.pick(post.title))}</h3>
            <p>${App.esc(App.pick(post.excerpt))}</p>
            <span class="post-more">${App.esc(App.t('journal.read'))} →</span>
          </div>
        </a>`;
    },
    // Likes are remembered in the browser so a visitor's heart stays filled on later visits.
    liked(id) {
      try { return JSON.parse(localStorage.getItem('liked') || '[]').includes(id); } catch (e) { return false; }
    },
    async like(id) {
      try {
        const list = JSON.parse(localStorage.getItem('liked') || '[]');
        if (!list.includes(id)) localStorage.setItem('liked', JSON.stringify([...list, id]));
      } catch (e) { /* storage blocked */ }
      const res = await fetch(`/api/albums/${encodeURIComponent(id)}/like`, { method: 'POST' });
      return res.ok ? (await res.json()).likes : null;
    }
  };

  function bindNewsletter(form) {
    const status = form.querySelector('.form-status');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.lang = App.lang;
      status.className = 'form-status';
      try {
        const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error();
        form.reset();
        status.textContent = App.t('news.ok');
        status.classList.add('ok');
      } catch (err) {
        status.textContent = App.t('news.err');
        status.classList.add('err');
      }
    });
  }

  window.Journal = Journal;
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('[data-newsletter]').forEach(bindNewsletter));
})();
