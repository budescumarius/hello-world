(function () {
  let post = null;

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
      .map(p => `<p>${App.esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  }

  function render() {
    const box = document.getElementById('article');
    if (!post) {
      box.innerHTML = `<p class="empty">${App.esc(App.t('journal.notfound'))}</p>`;
      return;
    }
    const title = App.pick(post.title);
    document.title = title + (App.settings ? ` — ${App.settings.companyName}` : '');
    box.innerHTML = `
      <div class="project-meta"><span>${App.esc(App.t('journal.cat.' + post.category))}</span><span>${App.esc(Journal.date(post.date))}</span></div>
      <h1>${App.esc(title)}</h1>
      ${post.cover ? `<img class="article-cover" src="${App.esc(post.cover)}" alt="">` : ''}
      <p class="article-lead">${App.esc(App.pick(post.excerpt))}</p>
      <div class="article-body">${paragraphs(App.pick(post.body))}</div>`;
    const extra = post.photos.filter(p => p.url !== post.cover);
    document.getElementById('gallery').innerHTML = extra.map((p, i) => `
      <button type="button" data-i="${i}" aria-label="${App.esc(title)}"><img src="${App.esc(p.url)}" alt="" loading="lazy"></button>`).join('');
    document.querySelectorAll('#gallery button').forEach(b =>
      b.addEventListener('click', () => Lightbox.open(extra, Number(b.dataset.i), title)));
  }

  App.onLang(() => { if (post !== null) render(); });

  document.addEventListener('DOMContentLoaded', async () => {
    const id = new URLSearchParams(location.search).get('id');
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(id || '')}`);
      post = res.ok ? await res.json() : false;
    } catch (e) { post = false; }
    render();
  });
})();
