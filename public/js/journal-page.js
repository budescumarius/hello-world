(function () {
  const CATS = ['tips', 'worksite', 'news'];
  let posts = [];
  let filter = 'all';

  function render() {
    const used = CATS.filter(c => posts.some(p => p.category === c));
    const filters = document.getElementById('filters');
    filters.innerHTML = used.length < 2 ? '' : ['all', ...used].map(c => `
      <button type="button" class="chip" data-cat="${c}" aria-pressed="${c === filter}">${App.esc(App.t('journal.cat.' + c))}</button>`).join('');
    filters.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { filter = b.dataset.cat; render(); }));

    const list = posts.filter(p => filter === 'all' || p.category === filter);
    document.getElementById('posts').innerHTML = list.length
      ? list.map(Journal.card).join('')
      : `<div class="empty" style="grid-column:1/-1">${App.esc(App.t('journal.empty'))}</div>`;
  }

  App.onLang(() => { document.title = `${App.t('journal.kicker')} — ${App.settings ? App.settings.companyName : 'Timberway'}`; render(); });

  document.addEventListener('DOMContentLoaded', async () => {
    posts = await fetch('/api/posts').then(r => r.json()).catch(() => []);
    render();
  });
})();
