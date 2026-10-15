(function () {
  const CATS = ['timber-frame', 'extension', 'roof-carport', 'terrace-cladding', 'interior', 'renovation'];
  const ICONS = {
    'timber-frame': '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6M5 14h14M12 10v4"/>',
    'extension': '<rect x="2" y="9" width="11" height="11"/><path d="M2 9l5.5-5L13 9"/><rect x="13" y="13" width="9" height="7" stroke-dasharray="2 2"/>',
    'roof-carport': '<path d="M2 9h20L12 4z"/><path d="M5 9v11M19 9v11"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
    'terrace-cladding': '<path d="M3 6h18M3 10h18M3 14h18M3 18h18"/><path d="M7 6v4M14 10v4M9 14v4M17 6v4"/>',
    'interior': '<path d="M4 21V9h4V5h4v4h4V5h4v16"/><path d="M4 15h16"/>',
    'renovation': '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'
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
      const meta = [p.location, p.year, `${p.photoCount} ${App.t('projects.photos')}`].filter(Boolean).join(' · ');
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
    const hero = withCover[0] ? withCover[0].cover : '/img/illustrations/extension-2.svg';
    const about = (withCover[1] || withCover[0] || {}).cover || '/img/illustrations/interior-1.svg';
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
