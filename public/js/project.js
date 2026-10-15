(function () {
  let project = null;
  let index = 0;

  function render() {
    const box = document.getElementById('project');
    if (!project) {
      box.innerHTML = `<p class="empty">${App.esc(App.t('projects.notfound'))}</p>`;
      return;
    }
    const title = App.pick(project.title);
    document.title = title + (App.settings ? ` — ${App.settings.companyName}` : '');
    const meta = [App.t(`cat.${project.category}`), project.location, project.year].filter(Boolean);
    box.innerHTML = `
      <h1>${App.esc(title)}</h1>
      <div class="project-meta">${meta.map(m => `<span>${App.esc(m)}</span>`).join('')}</div>
      <p class="project-desc">${App.esc(App.pick(project.description))}</p>`;
    if (!project.photos.length) project.photos = [{ url: `/img/illustrations/${project.category}-1.svg`, caption: {} }];
    document.getElementById('gallery').innerHTML = project.photos.map((p, i) => `
      <button type="button" data-i="${i}" aria-label="${App.esc(App.pick(p.caption) || title)}">
        <img src="${App.esc(p.url)}" alt="${App.esc(App.pick(p.caption) || title)}" loading="${i < 4 ? 'eager' : 'lazy'}">
      </button>`).join('');
    document.querySelectorAll('#gallery button').forEach(b => b.addEventListener('click', () => open(Number(b.dataset.i))));
  }

  // ----- lightbox with keyboard + swipe -----
  const lb = document.getElementById('lightbox');
  const img = lb.querySelector('img');
  const caption = lb.querySelector('.lightbox-caption');
  let lastFocus = null;

  function show(i) {
    const n = project.photos.length;
    index = (i + n) % n;
    const p = project.photos[index];
    img.src = p.url;
    img.alt = App.pick(p.caption) || App.pick(project.title);
    caption.textContent = `${App.pick(p.caption) ? App.pick(p.caption) + ' · ' : ''}${index + 1} / ${n}`;
  }
  function open(i) {
    lastFocus = document.activeElement;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    show(i);
    lb.querySelector('.close').focus();
  }
  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }
  lb.querySelector('.close').addEventListener('click', close);
  lb.querySelector('.prev').addEventListener('click', () => show(index - 1));
  lb.querySelector('.next').addEventListener('click', () => show(index + 1));
  lb.addEventListener('click', e => { if (e.target.classList.contains('lightbox-img')) close(); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
  let startX = null;
  lb.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

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
