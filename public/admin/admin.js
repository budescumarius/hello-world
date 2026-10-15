(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pick = o => (o && (o.nl || o.fr || o.en)) || '(fără titlu)';
  const CAT = { 'timber-frame': 'Casă lemn', 'extension': 'Extindere', 'roof-carport': 'Acoperiș/carport', 'terrace-cladding': 'Terasă/fațadă', 'interior': 'Interior', 'renovation': 'Renovare' };
  const ERR = { invalid_credentials: 'Utilizator sau parolă greșită.', too_many: 'Prea multe încercări. Încearcă mai târziu.', title_required: 'Completează titlul în cel puțin o limbă.', wrong_password: 'Parola actuală e greșită.', too_short: 'Parola nouă trebuie să aibă minim 10 caractere.' };

  let albums = [];
  let current = null; // album being edited

  async function api(url, opts = {}) {
    const init = { credentials: 'same-origin', ...opts };
    if (opts.json !== undefined) {
      init.method = init.method || 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.json);
    }
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('unauthorized'); }
    if (!res.ok) throw new Error(ERR[data.error] || data.error || 'Eroare');
    return data;
  }
  function setStatus(el, msg, ok = true) {
    el.textContent = msg;
    el.className = 'status ' + (ok ? 'ok' : 'err');
    if (ok) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
  }

  // ---------- auth ----------
  function showLogin() { $('#login-view').hidden = false; $('#app-view').hidden = true; }
  function showApp() { $('#login-view').hidden = true; $('#app-view').hidden = false; }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/login', { json: { username: f.get('username'), password: f.get('password') } });
      e.target.reset();
      $('#login-error').textContent = '';
      start();
    } catch (err) { $('#login-error').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/logout', { json: {} }); showLogin(); });

  // ---------- navigation ----------
  function view(name) {
    $$('[data-view]').forEach(s => { s.hidden = s.dataset.view !== name; });
    const tab = name === 'album-edit' ? 'albums' : name;
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    view(b.dataset.tab);
    if (b.dataset.tab === 'albums') loadAlbums();
    if (b.dataset.tab === 'messages') loadMessages();
    if (b.dataset.tab === 'settings') loadSettings();
  }));

  // ---------- albums ----------
  async function loadAlbums() {
    albums = await api('/api/admin/albums');
    const list = $('#album-list');
    if (!albums.length) { list.innerHTML = '<p class="muted">Niciun proiect încă. Apasă „+ Proiect nou”.</p>'; return; }
    list.innerHTML = albums.map(a => `
      <button class="album-item" data-id="${a.id}">
        ${a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
        <div class="info">
          <strong>${esc(pick(a.title))}</strong>
          <span class="tag">${esc(CAT[a.category] || a.category)}</span><span class="tag">${a.photoCount} poze</span>
          ${a.published ? '' : '<span class="tag draft">ciornă</span>'}${a.featured ? '<span class="tag feat">evidențiat</span>' : ''}
        </div>
      </button>`).join('');
    $$('.album-item').forEach(b => b.addEventListener('click', () => editAlbum(b.dataset.id)));
  }

  function setLangTab(l) {
    $$('.lang-tabs button').forEach(b => b.classList.toggle('active', b.dataset.l === l));
    $$('[data-lf]').forEach(d => { d.hidden = d.dataset.lf !== l; });
  }
  $$('.lang-tabs button').forEach(b => b.addEventListener('click', () => setLangTab(b.dataset.l)));

  function fillAlbumForm(a) {
    const f = $('#album-form');
    for (const l of ['nl', 'fr', 'en']) {
      f.elements[`title.${l}`].value = (a && a.title[l]) || '';
      f.elements[`description.${l}`].value = (a && a.description[l]) || '';
    }
    f.elements.category.value = (a && a.category) || 'timber-frame';
    f.elements.location.value = (a && a.location) || '';
    f.elements.year.value = (a && a.year) || String(new Date().getFullYear());
    f.elements.published.checked = a ? a.published : true;
    f.elements.featured.checked = a ? a.featured : false;
    $('#album-form-title').textContent = a ? 'Editează proiect' : 'Proiect nou';
    $('#delete-album').hidden = !a;
    $('#photos-panel').hidden = !a;
    $('#album-status').textContent = '';
    setLangTab('nl');
  }

  function readAlbumForm() {
    const f = $('#album-form');
    const out = { title: {}, description: {} };
    for (const l of ['nl', 'fr', 'en']) {
      out.title[l] = f.elements[`title.${l}`].value;
      out.description[l] = f.elements[`description.${l}`].value;
    }
    out.category = f.elements.category.value;
    out.location = f.elements.location.value;
    out.year = f.elements.year.value;
    out.published = f.elements.published.checked;
    out.featured = f.elements.featured.checked;
    return out;
  }

  $('#new-album').addEventListener('click', () => { current = null; fillAlbumForm(null); view('album-edit'); });
  $('#back-to-list').addEventListener('click', () => { view('albums'); loadAlbums(); });

  async function editAlbum(id) {
    current = albums.find(a => a.id === id);
    if (!current) return;
    fillAlbumForm(current);
    renderPhotos();
    view('album-edit');
  }

  async function refreshCurrent() {
    albums = await api('/api/admin/albums');
    current = albums.find(a => a.id === current.id) || null;
    renderPhotos();
  }

  $('#album-form').addEventListener('submit', async e => {
    e.preventDefault();
    const status = $('#album-status');
    try {
      const data = readAlbumForm();
      if (current) {
        current = await api(`/api/admin/albums/${current.id}`, { method: 'PUT', json: data });
        setStatus(status, 'Salvat ✓');
      } else {
        current = await api('/api/admin/albums', { json: data });
        fillAlbumForm(current);
        renderPhotos();
        setStatus(status, 'Proiect creat ✓ — acum adaugă poze mai jos.');
        $('#photos-panel').scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) { setStatus(status, err.message, false); }
  });

  $('#delete-album').addEventListener('click', async () => {
    if (!current || !confirm('Ștergi acest proiect și toate pozele lui? Nu se poate anula.')) return;
    await api(`/api/admin/albums/${current.id}`, { method: 'DELETE' });
    current = null;
    view('albums');
    loadAlbums();
  });

  // ---------- photos ----------
  function renderPhotos() {
    if (!current) return;
    const photos = current.photos || [];
    $('#photo-count').textContent = `(${photos.length})`;
    $('#photo-grid').innerHTML = photos.map((p, i) => `
      <div class="photo ${p.id === current.coverId ? 'cover' : ''}" data-id="${p.id}">
        ${p.id === current.coverId ? '<div class="badge">Copertă</div>' : ''}
        <img src="${esc(p.url)}" alt="" loading="lazy">
        <div class="actions">
          <button type="button" data-act="left" ${i === 0 ? 'disabled' : ''} aria-label="Mută stânga">←</button>
          <button type="button" data-act="right" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Mută dreapta">→</button>
          <button type="button" data-act="cover" ${p.id === current.coverId ? 'disabled' : ''}>★ Copertă</button>
          <button type="button" data-act="delete">🗑</button>
        </div>
        <details>
          <summary>Descriere poză</summary>
          <input data-cap="nl" placeholder="NL" value="${esc(p.caption.nl)}">
          <input data-cap="fr" placeholder="FR" value="${esc(p.caption.fr)}">
          <input data-cap="en" placeholder="EN" value="${esc(p.caption.en)}">
        </details>
      </div>`).join('');
  }

  $('#photo-grid').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.photo').dataset.id;
    const base = `/api/admin/albums/${current.id}`;
    const ids = current.photos.map(p => p.id);
    const i = ids.indexOf(id);
    const act = btn.dataset.act;
    if (act === 'delete') {
      if (!confirm('Ștergi poza?')) return;
      await api(`${base}/photos/${id}`, { method: 'DELETE' });
    } else if (act === 'cover') {
      await api(`${base}/photos/${id}`, { method: 'PUT', json: { cover: true } });
    } else {
      const j = act === 'left' ? i - 1 : i + 1;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api(`${base}/order`, { method: 'PUT', json: { order: ids } });
    }
    refreshCurrent();
  });

  // Save captions when leaving a caption field
  $('#photo-grid').addEventListener('change', async e => {
    if (!e.target.dataset.cap) return;
    const box = e.target.closest('.photo');
    const caption = {};
    box.querySelectorAll('[data-cap]').forEach(inp => { caption[inp.dataset.cap] = inp.value; });
    await api(`/api/admin/albums/${current.id}/photos/${box.dataset.id}`, { method: 'PUT', json: { caption } });
    const p = current.photos.find(x => x.id === box.dataset.id);
    if (p) p.caption = caption;
  });

  // Shrink large phone photos in the browser before upload: faster on mobile data and lighter pages.
  function resize(file, max = 2200, quality = 0.85) {
    return new Promise(resolve => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function uploadFiles(files) {
    files = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!files.length || !current) return;
    const bar = $('#upload-progress');
    const fill = bar.querySelector('div');
    const label = bar.querySelector('span');
    bar.hidden = false;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      label.textContent = `Se încarcă ${i + 1} din ${files.length}…`;
      fill.style.width = `${(i / files.length) * 100}%`;
      const fd = new FormData();
      fd.append('photos', await resize(files[i]));
      try {
        await api(`/api/admin/albums/${current.id}/photos`, { method: 'POST', body: fd });
      } catch (err) { failed++; }
    }
    fill.style.width = '100%';
    label.textContent = failed ? `Gata — ${failed} poze nu s-au putut încărca.` : 'Gata ✓';
    setTimeout(() => { bar.hidden = true; fill.style.width = '0'; }, 2500);
    $('#photo-input').value = '';
    refreshCurrent();
  }

  $('#photo-input').addEventListener('change', e => uploadFiles(e.target.files));
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); });

  // ---------- messages ----------
  async function loadMessages() {
    const msgs = await api('/api/admin/messages');
    updateUnread(msgs);
    const box = $('#message-list');
    if (!msgs.length) { box.innerHTML = '<p class="muted">Niciun mesaj încă.</p>'; return; }
    box.innerHTML = msgs.map(m => `
      <article class="msg ${m.read ? '' : 'unread'}" data-id="${m.id}">
        <header><strong>${esc(m.name)}</strong><span>${new Date(m.createdAt).toLocaleString('ro-RO')} · ${m.lang.toUpperCase()}${m.service ? ' · ' + esc(CAT[m.service] || m.service) : ''}</span></header>
        <div class="contact">${m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : ''}${m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : ''}</div>
        <p>${esc(m.message)}</p>
        <div class="row-between" style="margin:0">
          ${m.read ? '<span></span>' : '<button class="btn small-btn" data-act="read">Marchează citit</button>'}
          <button class="btn small-btn danger" data-act="delete">Șterge</button>
        </div>
      </article>`).join('');
  }
  $('#message-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.msg').dataset.id;
    if (btn.dataset.act === 'delete') {
      if (!confirm('Ștergi mesajul?')) return;
      await api(`/api/admin/messages/${id}`, { method: 'DELETE' });
    } else {
      await api(`/api/admin/messages/${id}/read`, { method: 'PUT', json: {} });
    }
    loadMessages();
  });
  function updateUnread(msgs) {
    const n = msgs.filter(m => !m.read).length;
    $('#unread').hidden = !n;
    $('#unread').textContent = n;
  }

  // ---------- settings ----------
  async function loadSettings() {
    const s = await api('/api/admin/settings');
    const f = $('#settings-form');
    for (const el of f.elements) {
      if (!el.name) continue;
      const [k, l] = el.name.split('.');
      el.value = l ? ((s[k] || {})[l] || '') : (s[k] || '');
    }
  }
  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = { tagline: {}, region: {} };
    for (const el of e.target.elements) {
      if (!el.name) continue;
      const [k, l] = el.name.split('.');
      if (l) data[k][l] = el.value; else data[k] = el.value;
    }
    try { await api('/api/admin/settings', { method: 'PUT', json: data }); setStatus($('#settings-status'), 'Salvat ✓'); }
    catch (err) { setStatus($('#settings-status'), err.message, false); }
  });
  $('#password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/admin/password', { json: { current: f.get('current'), next: f.get('next') } });
      e.target.reset();
      setStatus($('#password-status'), 'Parola a fost schimbată ✓');
    } catch (err) { setStatus($('#password-status'), err.message, false); }
  });

  // ---------- boot ----------
  async function start() {
    showApp();
    view('albums');
    await loadAlbums();
    api('/api/admin/messages').then(updateUnread).catch(() => {});
  }

  fetch('/api/me', { credentials: 'same-origin' }).then(r => (r.ok ? start() : showLogin())).catch(showLogin);
})();
