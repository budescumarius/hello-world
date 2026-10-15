(function () {
  const CATS = ['kitchen', 'furniture', 'bathroom', 'stairs', 'parquet', 'restoration'];
  const ICONS = {
    'kitchen': '<rect x="3" y="11" width="18" height="9" rx="1"/><path d="M3 15h18M9 11v9M15 11v9"/><path d="M6 7h4M14 4v4M12 4h4"/>',
    'furniture': '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M10 11v2M14 11v2M4 17h16"/>',
    'bathroom': '<path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M7 12V6a2 2 0 0 1 4 0M8 19l-1 2M16 19l1 2"/>',
    'stairs': '<path d="M3 21h5v-5h5v-5h5V6h3"/><path d="M3 21V9"/>',
    'parquet': '<path d="M3 3l6 6-6 6M9 3l6 6-6 6M15 3l6 6-6 6M3 15l6 6M9 15l6 6M15 15l6 6"/>',
    'restoration': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'
  };

  let projects = [];
  let filter = 'all';

  function renderServices() {
    document.getElementById('services-grid').innerHTML = CATS.map(c => `
      <article class="card service-card reveal in">
        <div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[c]}</svg></div>
        <div><h3>${App.esc(App.t(`svc.${c}.t`))}</h3><p>${App.esc(App.t(`svc.${c}.d`))}</p></div>
      </article>`).join('');
  }

  function renderFilters() {
    const used = CATS.filter(c => projects.some(p => p.category === c));
    const box = document.getElementById('filters');
    if (used.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = ['all', ...used].map(c => `
      <button type="button" class="chip" data-cat="${c}" aria-pressed="${c === filter}">${App.esc(c === 'all' ? App.t('projects.all') : App.t(`cat.${c}`))}</button>`).join('');
    box.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { filter = b.dataset.cat; renderProjects(); renderFilters(); }));
  }

  function renderProjects() {
    const grid = document.getElementById('projects-grid');
    const list = projects.filter(p => filter === 'all' || p.category === filter);
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${App.esc(App.t('projects.empty'))}</div>`;
      return;
    }
    grid.innerHTML = list.map(p => {
      const meta = [p.location, p.year, `${p.photoCount} ${App.t(p.photoCount === 1 ? 'projects.photo' : 'projects.photos')}`].filter(Boolean).join(' · ');
      return `
      <a class="project-card" href="/project?id=${encodeURIComponent(p.id)}&lang=${App.lang}">
        <img src="${App.esc(p.cover || `/img/illustrations/${p.category}-1.svg`)}" alt="${App.esc(App.pick(p.title))}" loading="lazy">
        <span class="badge">${App.esc(App.t(`cat.${p.category}`))}</span>
        <div class="overlay"><h3>${App.esc(App.pick(p.title))}</h3><div class="meta">${App.esc(meta)}</div></div>
      </a>`;
    }).join('');
  }

  function renderServiceOptions() {
    const sel = document.getElementById('f-service');
    const current = sel.value;
    sel.innerHTML = `<option value="">${App.esc(App.t('form.choose'))}</option>` +
      CATS.map(c => `<option value="${c}">${App.esc(App.t(`svc.${c}.t`))}</option>`).join('') +
      `<option value="other">${App.esc(App.t('form.other'))}</option>`;
    sel.value = current;
  }

  function useProjectPhotos() {
    // Featured projects give the hero and about section a real photo; illustrations fill in until there are some.
    const withCover = projects.filter(p => p.cover);
    const hero = withCover[0] ? withCover[0].cover : '/img/illustrations/kitchen-1.svg';
    const about = (withCover[1] || withCover[0] || {}).cover || '/img/illustrations/furniture-1.svg';
    document.getElementById('hero-bg').style.setProperty('--hero-img', `url("${hero}")`);
    document.getElementById('about-visual').innerHTML = `<img src="${App.esc(about)}" alt="" loading="lazy">`;
  }

  function renderAll() {
    renderServices();
    renderFilters();
    renderProjects();
    renderServiceOptions();
  }

  App.onLang(renderAll);

  document.addEventListener('DOMContentLoaded', async () => {
    try { projects = await fetch('/api/albums').then(r => r.json()); } catch (e) { projects = []; }
    renderAll();
    useProjectPhotos();

    const form = document.getElementById('contact-form');
    const status = document.getElementById('form-status');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.lang = App.lang;
      status.className = 'form-status';
      if (!data.name.trim() || !(data.email.trim() || data.phone.trim()) || !data.message.trim()) {
        status.textContent = App.t('form.missing');
        status.classList.add('err');
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error();
        form.reset();
        status.textContent = App.t('form.ok');
        status.classList.add('ok');
      } catch (err) {
        status.textContent = App.t('form.err');
        status.classList.add('err');
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
