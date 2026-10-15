(function () {
  let project = null;

  function render() {
    const box = document.getElementById('project');
    if (!project) {
      box.innerHTML = `<p class="empty">${App.esc(App.t('projects.notfound'))}</p>`;
      return;
    }
    const title = App.pick(project.title);
    document.title = title + (App.settings ? ` — ${App.settings.companyName}` : '');
    const meta = [App.t(`cat.${project.category}`), project.location, project.year].filter(Boolean);
    const liked = Journal.liked(project.id);
    box.innerHTML = `
      <h1>${App.esc(title)}</h1>
      <div class="project-meta">${meta.map(m => `<span>${App.esc(m)}</span>`).join('')}</div>
      <p class="project-desc">${App.esc(App.pick(project.description))}</p>
      <button type="button" class="like-btn" aria-pressed="${liked}">
        <span class="heart">${liked ? '♥' : '♡'}</span> ${App.esc(App.t('like.label'))}
        <span class="like-count">${project.likes || ''}</span>
      </button>`;
    box.querySelector('.like-btn').addEventListener('click', onLike);
    if (!project.photos.length) project.photos = [{ url: `/img/illustrations/${project.category}-1.svg`, caption: {} }];
    document.getElementById('gallery').innerHTML = project.photos.map((p, i) => `
      <button type="button" data-i="${i}" aria-label="${App.esc(App.pick(p.caption) || title)}">
        <img src="${App.esc(p.url)}" alt="${App.esc(App.pick(p.caption) || title)}" loading="${i < 4 ? 'eager' : 'lazy'}">
      </button>`).join('');
    document.querySelectorAll('#gallery button').forEach(b =>
      b.addEventListener('click', () => Lightbox.open(project.photos, Number(b.dataset.i), title)));
  }

  async function onLike(e) {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-pressed') === 'true') return;
    btn.setAttribute('aria-pressed', 'true');
    btn.querySelector('.heart').textContent = '♥';
    btn.classList.add('pop');
    const likes = await Journal.like(project.id).catch(() => null);
    if (likes !== null) {
      project.likes = likes;
      btn.querySelector('.like-count').textContent = likes;
    }
  }

  App.onLang(() => { if (project !== null) render(); });

  document.addEventListener('DOMContentLoaded', async () => {
    const id = new URLSearchParams(location.search).get('id');
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(id || '')}`);
      project = res.ok ? await res.json() : false;
    } catch (e) { project = false; }
    render();
  });
})();
