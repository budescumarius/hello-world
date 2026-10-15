(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pick = o => (o && (o.fr || o.nl || o.en)) || '(fără titlu)';
  const CAT = { kitchen: 'Bucătărie', furniture: 'Mobilier', bathroom: 'Baie', stairs: 'Scări / amenajări', parquet: 'Parchet', exterior: 'Placaj / exterior', restoration: 'Restaurare' };
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
    const tab = { 'album-edit': 'albums', 'post-edit': 'posts' }[name] || name;
    $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    view(b.dataset.tab);
    if (b.dataset.tab === 'albums') loadAlbums();
    if (b.dataset.tab === 'messages') loadMessages();
    if (b.dataset.tab === 'settings') { loadSettings(); loadAutoReply(); }
    if (b.dataset.tab === 'posts') loadPosts();
    if (b.dataset.tab === 'subscribers') loadSubscribers();
    if (b.dataset.tab === 'content') loadContent();
    if (b.dataset.tab === 'pricing') loadPricing();
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

  // Language tabs switch only the fields of the form they belong to.
  function setLangTab(l, root = $('#album-form')) {
    root.querySelectorAll('.lang-tabs button').forEach(b => b.classList.toggle('active', b.dataset.l === l));
    root.querySelectorAll('[data-lf]').forEach(d => { d.hidden = d.dataset.lf !== l; });
  }
  $$('.lang-tabs button').forEach(b => b.addEventListener('click', () => setLangTab(b.dataset.l, b.closest('form'))));

  function fillAlbumForm(a) {
    const f = $('#album-form');
    for (const l of ['nl', 'fr', 'en']) {
      f.elements[`title.${l}`].value = (a && a.title[l]) || '';
      f.elements[`description.${l}`].value = (a && a.description[l]) || '';
    }
    f.elements.category.value = (a && a.category) || 'kitchen';
    f.elements.location.value = (a && a.location) || '';
    f.elements.year.value = (a && a.year) || String(new Date().getFullYear());
    f.elements.published.checked = a ? a.published : true;
    f.elements.featured.checked = a ? a.featured : false;
    $('#album-form-title').textContent = a ? 'Editează proiect' : 'Proiect nou';
    $('#delete-album').hidden = !a;
    $('#photos-panel').hidden = !a;
    $('#album-status').textContent = '';
    setLangTab('fr');
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
        ${m.estimate ? `<div class="estimate-box"><strong>Calculator buget: ${m.estimate.min.toLocaleString('fr-BE')} – ${m.estimate.max.toLocaleString('fr-BE')} €</strong><p>${esc(m.estimate.summary)}</p>${m.estimate.config ? `<a class="btn small-btn" href="/api/admin/messages/${m.id}/pdf" target="_blank">📄 Descarcă PDF (${esc(m.estimate.ref)})</a>` : ''}</div>` : ''}
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
    const data = { tagline: {}, hours: {} };
    for (const el of e.target.elements) {
      if (!el.name) continue;
      const [k, l] = el.name.split('.');
      if (l) data[k][l] = el.value; else data[k] = el.value;
    }
    try { await api('/api/admin/settings', { method: 'PUT', json: data }); setStatus($('#settings-status'), 'Salvat ✓'); }
    catch (err) { setStatus($('#settings-status'), err.message, false); }
  });
  $('#test-email').addEventListener('click', async () => {
    const st = $('#test-email-status');
    const ERR_MAIL = { no_notify_email: 'Completează și salvează întâi adresa.', sendmail_unavailable: 'Serverul nu poate trimite e-mailuri (sendmail lipsește).' };
    try {
      await api('/api/admin/test-email', { json: {} });
      setStatus(st, 'Trimis ✓ — verifică inboxul (și Spam).');
    } catch (err) { setStatus(st, ERR_MAIL[err.message] || err.message, false); }
  });

  // ---------- thank-you e-mail ----------
  async function loadAutoReply() {
    const s = await api('/api/admin/settings');
    const a = s.autoReply || { enabled: false, subject: {}, body: {} };
    const f = $('#autoreply-form');
    f.elements.enabled.checked = Boolean(a.enabled);
    for (const l of ['fr', 'nl', 'en']) {
      f.elements[`subject.${l}`].value = (a.subject || {})[l] || '';
      f.elements[`body.${l}`].value = (a.body || {})[l] || '';
    }
    setLangTab('fr', f);
  }
  function readAutoReply() {
    const f = $('#autoreply-form');
    const out = { enabled: f.elements.enabled.checked, subject: {}, body: {} };
    for (const l of ['fr', 'nl', 'en']) {
      out.subject[l] = f.elements[`subject.${l}`].value;
      out.body[l] = f.elements[`body.${l}`].value;
    }
    return out;
  }
  $('#autoreply-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', json: { autoReply: readAutoReply() } });
      setStatus($('#autoreply-status'), 'Mesaj salvat ✓');
    } catch (err) { setStatus($('#autoreply-status'), err.message, false); }
  });
  $('#autoreply-test').addEventListener('click', async () => {
    const st = $('#autoreply-status');
    const lang = $('#autoreply-form .lang-tabs button.active').dataset.l;
    try {
      // save first so the example shows exactly what is on screen
      await api('/api/admin/settings', { method: 'PUT', json: { autoReply: readAutoReply() } });
      await api('/api/admin/test-thank-you', { json: { lang } });
      setStatus(st, `Exemplu ${lang.toUpperCase()} trimis la adresa de notificări ✓`);
    } catch (err) {
      setStatus(st, { no_notify_email: 'Completează întâi adresa la „Notificări” (mai sus) și salvează.', sendmail_unavailable: 'Serverul nu poate trimite e-mailuri.' }[err.message] || err.message, false);
    }
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

  // ---------- journal ----------
  const POST_CAT = { tips: 'Sfaturi', worksite: 'Pe șantier', news: 'Noutăți' };
  let posts = [];
  let currentPost = null;

  async function loadPosts() {
    posts = await api('/api/admin/posts');
    const list = $('#post-list');
    if (!posts.length) { list.innerHTML = '<p class="muted">Niciun articol încă. Apasă „+ Articol nou”.</p>'; return; }
    list.innerHTML = posts.map(p => `
      <button class="album-item" data-id="${p.id}">
        ${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
        <div class="info">
          <strong>${esc(pick(p.title))}</strong>
          <span class="tag">${esc(POST_CAT[p.category] || p.category)}</span><span class="tag">${new Date(p.date).toLocaleDateString('ro-RO')}</span>
          ${p.published ? '' : '<span class="tag draft">ciornă</span>'}
        </div>
      </button>`).join('');
    $$('#post-list .album-item').forEach(b => b.addEventListener('click', () => editPost(b.dataset.id)));
  }

  function fillPostForm(p) {
    const f = $('#post-form');
    for (const l of ['fr', 'nl', 'en']) {
      for (const k of ['title', 'excerpt', 'body']) f.elements[`${k}.${l}`].value = (p && p[k][l]) || '';
    }
    f.elements.category.value = (p && p.category) || 'tips';
    f.elements.published.checked = p ? p.published : true;
    $('#post-form-title').textContent = p ? 'Editează articol' : 'Articol nou';
    $('#delete-post').hidden = !p;
    $('#post-photos-panel').hidden = !p;
    $('#post-status').textContent = '';
    setLangTab('fr', f);
    renderPostPhotos();
  }

  function readPostForm() {
    const f = $('#post-form');
    const out = { title: {}, excerpt: {}, body: {}, category: f.elements.category.value, published: f.elements.published.checked };
    for (const l of ['fr', 'nl', 'en']) for (const k of ['title', 'excerpt', 'body']) out[k][l] = f.elements[`${k}.${l}`].value;
    return out;
  }

  function editPost(id) {
    currentPost = posts.find(p => p.id === id) || null;
    fillPostForm(currentPost);
    view('post-edit');
  }
  $('#new-post').addEventListener('click', () => { currentPost = null; fillPostForm(null); view('post-edit'); });
  $('#back-to-posts').addEventListener('click', () => { view('posts'); loadPosts(); });

  $('#post-form').addEventListener('submit', async e => {
    e.preventDefault();
    const status = $('#post-status');
    try {
      if (currentPost) {
        currentPost = await api(`/api/admin/posts/${currentPost.id}`, { method: 'PUT', json: readPostForm() });
        setStatus(status, 'Salvat ✓');
      } else {
        currentPost = await api('/api/admin/posts', { json: readPostForm() });
        fillPostForm(currentPost);
        setStatus(status, 'Articol creat ✓ — acum adaugă poze mai jos.');
        $('#post-photos-panel').scrollIntoView({ behavior: 'smooth' });
      }
    } catch (err) { setStatus(status, err.message, false); }
  });

  $('#delete-post').addEventListener('click', async () => {
    if (!currentPost || !confirm('Ștergi acest articol și pozele lui?')) return;
    await api(`/api/admin/posts/${currentPost.id}`, { method: 'DELETE' });
    currentPost = null;
    view('posts');
    loadPosts();
  });

  function renderPostPhotos() {
    const photos = (currentPost && currentPost.photos) || [];
    $('#post-photo-count').textContent = `(${photos.length})`;
    $('#post-photo-grid').innerHTML = photos.map(p => `
      <div class="photo ${p.id === currentPost.coverId ? 'cover' : ''}" data-id="${p.id}">
        ${p.id === currentPost.coverId ? '<div class="badge">Copertă</div>' : ''}
        <img src="${esc(p.url)}" alt="" loading="lazy">
        <div class="actions">
          <button type="button" data-act="cover" ${p.id === currentPost.coverId ? 'disabled' : ''}>★ Copertă</button>
          <button type="button" data-act="delete">🗑</button>
        </div>
      </div>`).join('');
  }

  async function refreshPost() {
    posts = await api('/api/admin/posts');
    currentPost = posts.find(p => p.id === currentPost.id) || null;
    renderPostPhotos();
  }

  $('#post-photo-grid').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.photo').dataset.id;
    if (btn.dataset.act === 'delete') {
      if (!confirm('Ștergi poza?')) return;
      await api(`/api/admin/posts/${currentPost.id}/photos/${id}`, { method: 'DELETE' });
    } else {
      await api(`/api/admin/posts/${currentPost.id}/photos/${id}`, { method: 'PUT', json: {} });
    }
    refreshPost();
  });

  async function uploadPostFiles(files) {
    files = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!files.length || !currentPost) return;
    const bar = $('#post-upload-progress');
    const fill = bar.querySelector('div');
    const label = bar.querySelector('span');
    bar.hidden = false;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      label.textContent = `Se încarcă ${i + 1} din ${files.length}…`;
      fill.style.width = `${(i / files.length) * 100}%`;
      const fd = new FormData();
      fd.append('photos', await resize(files[i]));
      try { await api(`/api/admin/posts/${currentPost.id}/photos`, { method: 'POST', body: fd }); } catch (err) { failed++; }
    }
    fill.style.width = '100%';
    label.textContent = failed ? `Gata — ${failed} poze nu s-au putut încărca.` : 'Gata ✓';
    setTimeout(() => { bar.hidden = true; fill.style.width = '0'; }, 2500);
    $('#post-photo-input').value = '';
    refreshPost();
  }
  $('#post-photo-input').addEventListener('change', e => uploadPostFiles(e.target.files));
  const pdz = $('#post-dropzone');
  ['dragenter', 'dragover'].forEach(ev => pdz.addEventListener(ev, e => { e.preventDefault(); pdz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => pdz.addEventListener(ev, () => pdz.classList.remove('over')));
  pdz.addEventListener('drop', e => { e.preventDefault(); uploadPostFiles(e.dataTransfer.files); });

  // ---------- subscribers ----------
  async function loadSubscribers() {
    const subs = await api('/api/admin/subscribers');
    $('#sub-count').textContent = `(${subs.length})`;
    $('#sub-list').innerHTML = subs.length ? subs.map(s => `
      <div class="sub-row" data-email="${esc(s.email)}">
        <strong>${esc(s.email)}</strong>
        <span>${esc(s.lang.toUpperCase())} · ${new Date(s.createdAt).toLocaleDateString('ro-RO')}</span>
        <button class="btn small-btn danger" data-act="delete">Șterge</button>
      </div>`).join('') : '<p class="muted">Niciun abonat încă.</p>';
  }
  $('#sub-list').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !confirm('Ștergi acest abonat?')) return;
    await api(`/api/admin/subscribers/${encodeURIComponent(btn.closest('.sub-row').dataset.email)}`, { method: 'DELETE' });
    loadSubscribers();
  });

  // ---------- look: logo, colours, texts ----------
  const DEFAULT_COLORS = { primary: '#8a5a33', dark: '#2b1d12' };
  const GROUPS = {
    nav: 'Meniu', cta: 'Butoane', hero: 'Prima imagine (sus)', facts: 'Cifre sub titlu', services: 'Servicii — titlu', svc: 'Servicii — carduri',
    why: 'Angajament', projects: 'Realizări', process: 'Metodă', about: 'Despre noi', faq: 'Întrebări frecvente', contact: 'Contact',
    form: 'Formular de contact', journal: 'Jurnal', news: 'Newsletter', like: 'Aprecieri', footer: 'Subsol', cat: 'Categorii'
  };
  let settingsCache = null;

  async function loadContent() {
    settingsCache = await api('/api/admin/settings');
    const s = settingsCache;
    $('#logo-preview').src = s.logo ? `/uploads/${s.logo}` : '/img/logo.svg';
    const cf = $('#colors-form');
    cf.elements.primary.value = (s.colors && s.colors.primary) || DEFAULT_COLORS.primary;
    cf.elements.dark.value = (s.colors && s.colors.dark) || DEFAULT_COLORS.dark;
    renderTexts();
  }

  $('#logo-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const r = await api('/api/admin/logo', { method: 'POST', body: fd });
      $('#logo-preview').src = r.logo;
      setStatus($('#logo-status'), 'Logo salvat ✓');
    } catch (err) { setStatus($('#logo-status'), err.message, false); }
    e.target.value = '';
  });
  $('#logo-reset').addEventListener('click', async () => {
    await api('/api/admin/logo', { method: 'DELETE' });
    $('#logo-preview').src = '/img/logo.svg';
    setStatus($('#logo-status'), 'Logo implicit ✓');
  });

  async function saveColors(colors) {
    try {
      await api('/api/admin/settings', { method: 'PUT', json: { colors } });
      setStatus($('#colors-status'), 'Culori salvate ✓');
    } catch (err) { setStatus($('#colors-status'), err.message, false); }
  }
  $('#colors-form').addEventListener('submit', e => {
    e.preventDefault();
    saveColors({ primary: e.target.elements.primary.value, dark: e.target.elements.dark.value });
  });
  $('#colors-reset').addEventListener('click', () => {
    const cf = $('#colors-form');
    cf.elements.primary.value = DEFAULT_COLORS.primary;
    cf.elements.dark.value = DEFAULT_COLORS.dark;
    saveColors({ primary: '', dark: '' });
  });

  function renderTexts() {
    const custom = (settingsCache && settingsCache.texts) || {};
    const keys = Object.keys(window.I18N.fr);
    const byGroup = {};
    keys.forEach(k => { const g = k.split('.')[0]; (byGroup[g] = byGroup[g] || []).push(k); });
    $('#texts-list').innerHTML = Object.entries(byGroup).map(([g, ks]) => `
      <details class="text-group" data-group="${g}">
        <summary>${esc(GROUPS[g] || g)} <span class="muted">(${ks.length})</span></summary>
        ${ks.map(k => `
          <div class="text-row" data-key="${esc(k)}">
            <div class="key">${esc(k)}</div>
            ${['fr', 'nl', 'en'].map(l => `
              <label>${l.toUpperCase()}<textarea rows="1" data-lang="${l}" placeholder="${esc(window.I18N[l][k] || '')}">${esc((custom[l] || {})[k] || '')}</textarea></label>`).join('')}
          </div>`).join('')}
      </details>`).join('');
  }

  $('#texts-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('.text-row').forEach(row => {
      const hay = row.dataset.key + ' ' + Array.from(row.querySelectorAll('textarea')).map(t => t.placeholder + ' ' + t.value).join(' ');
      row.hidden = q && !hay.toLowerCase().includes(q);
    });
    $$('.text-group').forEach(g => {
      const visible = g.querySelectorAll('.text-row:not([hidden])').length;
      g.hidden = !visible;
      g.open = Boolean(q) && visible > 0;
    });
  });

  $('#texts-form').addEventListener('submit', async e => {
    e.preventDefault();
    const texts = { fr: {}, nl: {}, en: {} };
    $$('.text-row textarea').forEach(t => {
      const v = t.value.trim();
      if (v && v !== t.placeholder) texts[t.dataset.lang][t.closest('.text-row').dataset.key] = v;
    });
    try {
      settingsCache = await api('/api/admin/settings', { method: 'PUT', json: { texts } });
      setStatus($('#texts-status'), 'Texte salvate ✓');
    } catch (err) { setStatus($('#texts-status'), err.message, false); }
  });

  // ---------- price grid & catalogue ----------
  const PT = { kitchen: 'Bucătărie', wardrobe: 'Dressing', bookcase: 'Bibliotecă/TV', vanity: 'Baie', stairs: 'Scară', parquet: 'Parchet' };
  const PT_UNIT = { kitchen: '€ / metru liniar', wardrobe: '€ / m² față', bookcase: '€ / m² față', vanity: '€ / metru liniar', stairs: '€ / treaptă', parquet: '€ / m² (montaj)' };
  const UNIT_LABEL = { fixed: '€ fix', per_m: '€ / metru', per_m2: '€ / m²', per_step: '€ / treaptă' };
  const EFFECT_LABEL = { '': 'Niciun efect (doar preț)', led: 'LED (bandă luminoasă)', drawer: 'Sertare', glass: 'Uși din sticlă', island: 'Insulă bucătărie', handrail: 'Balustradă scară' };
  const PRICE_ERR = { no_worktop: 'Păstrează cel puțin un blat de bucătărie.' };
  let pricingDefaults = null;
  let catalog = null;

  const newId = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const nameInputs = n => ['fr', 'nl', 'en'].map(l => `<label>Nume ${l.toUpperCase()}<input data-f="name.${l}" value="${esc((n || {})[l] || '')}" ${l === 'fr' ? 'required' : ''}></label>`).join('');
  const typeChecks = types => `<div class="type-checks">${Object.entries(PT).map(([k, v]) => `<label class="check"><input type="checkbox" data-type="${k}" ${types.includes(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div>`;

  function materialCard(m) {
    return `<div class="cat-item" data-kind="materials" data-id="${esc(m.id)}">
      <div class="cat-head"><span class="swatch-mini" style="background:${esc(m.color)}"></span><strong>${esc(m.name.fr || 'Material nou')}</strong><button type="button" class="btn small-btn danger" data-remove>Șterge</button></div>
      <div class="grid3">${nameInputs(m.name)}</div>
      <div class="grid3">
        <label>Culoare (3D și PDF)<input type="color" data-f="color" value="${esc(m.color)}"></label>
        <label>Coeficient preț<input type="number" step="0.05" min="0" data-f="mult" value="${m.mult}"></label>
        <label class="check" style="align-self:end"><input type="checkbox" data-f="grain" ${m.grain ? 'checked' : ''}> Aspect de lemn (fibră)</label>
      </div>
      <p class="hint">Apare la:</p>${typeChecks(m.types)}
    </div>`;
  }
  function worktopCard(w) {
    return `<div class="cat-item" data-kind="worktops" data-id="${esc(w.id)}">
      <div class="cat-head"><span class="swatch-mini" style="background:${esc(w.color)}"></span><strong>${esc(w.name.fr || 'Blat nou')}</strong><button type="button" class="btn small-btn danger" data-remove>Șterge</button></div>
      <div class="grid3">${nameInputs(w.name)}</div>
      <div class="grid3">
        <label>Culoare<input type="color" data-f="color" value="${esc(w.color)}"></label>
        <label>Preț (€ / metru)<input type="number" min="0" step="1" data-f="price" value="${w.price}"></label>
      </div>
    </div>`;
  }
  function optionCard(o) {
    return `<div class="cat-item" data-kind="options" data-id="${esc(o.id)}">
      <div class="cat-head"><strong>${esc(o.name.fr || 'Accesoriu nou')}</strong>${o.effect ? `<span class="tag">${esc(EFFECT_LABEL[o.effect])}</span>` : ''}<button type="button" class="btn small-btn danger" data-remove>Șterge</button></div>
      <div class="grid3">${nameInputs(o.name)}</div>
      <div class="grid3">
        <label>Tip<select data-f="kind"><option value="check" ${o.kind === 'check' ? 'selected' : ''}>Bifă (da / nu)</option><option value="count" ${o.kind === 'count' ? 'selected' : ''}>Cantitate (clientul alege nr. de bucăți)</option></select></label>
        <label>Preț<span class="price-input"><input type="number" min="0" step="1" data-f="price" value="${o.price}">
          <select data-f="unit" ${o.kind === 'count' ? 'hidden' : ''}>${Object.entries(UNIT_LABEL).map(([k, v]) => `<option value="${k}" ${o.unit === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <small ${o.kind === 'count' ? '' : 'hidden'}>€ / buc.</small></span></label>
        <label>Efect în 3D și PDF<select data-f="effect">${Object.entries(EFFECT_LABEL).map(([k, v]) => `<option value="${k}" ${o.effect === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="grid3">
        <label class="check" ${o.kind === 'count' ? 'hidden' : ''}><input type="checkbox" data-f="on" ${o.on ? 'checked' : ''}> Bifat implicit</label>
        <label ${o.kind === 'count' ? '' : 'hidden'}>Cantitate implicită<input type="number" min="0" max="99" data-f="def" value="${o.def}"></label>
        <label ${o.kind === 'count' ? '' : 'hidden'}>Cantitate maximă<input type="number" min="1" max="99" data-f="max" value="${o.max}"></label>
      </div>
      <p class="hint">Apare la:</p>${typeChecks(o.types)}
    </div>`;
  }

  function renderPricing(current) {
    catalog = JSON.parse(JSON.stringify(current));
    const c = catalog;
    $('#pricing-fields').innerHTML = `
      <h3>General</h3>
      <div class="price-grid">
        <label>Marjă interval (±)<span class="price-input"><input type="number" min="0" max="90" data-g="margin" value="${c.margin}"><small>%</small></span></label>
        <label>Montaj<span class="price-input"><input type="number" min="0" max="100" data-g="installPct" value="${c.installPct}"><small>% din total</small></span></label>
      </div>
      <h3>Preț de bază pe tip de proiect</h3>
      <div class="price-grid">${Object.entries(PT).map(([k, v]) => `<label>${v}<span class="price-input"><input type="number" min="0" data-t="${k}" value="${c.types[k]}"><small>${PT_UNIT[k]}</small></span></label>`).join('')}</div>

      <details class="cat-section" open><summary>Materiale <span class="muted">(${c.materials.length})</span></summary>
        <p class="hint">Coeficientul înmulțește prețul de bază (1 = preț de bază, 1,5 = cu 50% mai scump). Culoarea se vede în 3D și în PDF.</p>
        <div id="cat-materials">${c.materials.map(materialCard).join('')}</div>
        <button type="button" class="btn" data-add="materials">+ Adaugă material</button>
      </details>
      <details class="cat-section"><summary>Blaturi bucătărie <span class="muted">(${c.worktops.length})</span></summary>
        <div id="cat-worktops">${c.worktops.map(worktopCard).join('')}</div>
        <button type="button" class="btn" data-add="worktops">+ Adaugă blat</button>
      </details>
      <details class="cat-section" open><summary>Accesorii și opțiuni <span class="muted">(${c.options.length})</span></summary>
        <p class="hint">„Efect” decide ce se desenează: un accesoriu cu efect LED apare ca bandă luminoasă în 3D și în PDF, la orice tip de proiect bifat mai jos.</p>
        <div id="cat-options">${c.options.map(optionCard).join('')}</div>
        <button type="button" class="btn" data-add="options">+ Adaugă accesoriu</button>
      </details>`;
  }

  // Read the whole form back into a catalogue object.
  function readCatalog() {
    const out = { types: {}, materials: [], worktops: [], options: [] };
    $$('#pricing-fields [data-g]').forEach(i => { out[i.dataset.g] = Number(i.value); });
    $$('#pricing-fields [data-t]').forEach(i => { out.types[i.dataset.t] = Number(i.value); });
    $$('#pricing-fields .cat-item').forEach(card => {
      const item = { id: card.dataset.id, name: {} };
      card.querySelectorAll('[data-f]').forEach(i => {
        const f = i.dataset.f;
        if (f.startsWith('name.')) item.name[f.slice(5)] = i.value;
        else if (i.type === 'checkbox') item[f] = i.checked;
        else if (i.type === 'number') item[f] = Number(i.value);
        else item[f] = i.value;
      });
      if (card.dataset.kind !== 'worktops') item.types = Array.from(card.querySelectorAll('[data-type]:checked')).map(i => i.dataset.type);
      out[card.dataset.kind].push(item);
    });
    return out;
  }

  async function loadPricing() {
    const r = await api('/api/admin/pricing');
    pricingDefaults = r.defaults;
    renderPricing(r.current);
  }

  $('#pricing-fields').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    const remove = e.target.closest('[data-remove]');
    if (add) {
      const kind = add.dataset.add;
      const blank = {
        materials: () => materialCard({ id: newId('mat'), name: {}, color: '#c79c66', grain: true, mult: 1, types: [] }),
        worktops: () => worktopCard({ id: newId('worktop'), name: {}, color: '#8a8580', price: 0 }),
        options: () => optionCard({ id: newId('opt'), name: {}, kind: 'check', unit: 'fixed', price: 0, types: [], effect: '', on: false, def: 0, max: 10 })
      }[kind]();
      $(`#cat-${kind}`).insertAdjacentHTML('beforeend', blank);
      const card = $(`#cat-${kind}`).lastElementChild;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.querySelector('input').focus();
    }
    if (remove && confirm('Ștergi acest element din calculator? (apasă apoi „Salvează prețurile”)')) remove.closest('.cat-item').remove();
  });
  // Live feedback in the card header and show the right fields for "check" vs "count".
  $('#pricing-fields').addEventListener('input', e => {
    const card = e.target.closest('.cat-item');
    if (!card) return;
    if (e.target.dataset.f === 'name.fr') card.querySelector('.cat-head strong').textContent = e.target.value || '…';
    if (e.target.dataset.f === 'color') { const sw = card.querySelector('.swatch-mini'); if (sw) sw.style.background = e.target.value; }
    if (e.target.dataset.f === 'kind') {
      const count = e.target.value === 'count';
      card.querySelector('[data-f=unit]').hidden = count;
      card.querySelector('.price-input small').hidden = !count;
      card.querySelector('[data-f=on]').closest('label').hidden = count;
      card.querySelector('[data-f=def]').closest('label').hidden = !count;
      card.querySelector('[data-f=max]').closest('label').hidden = !count;
    }
  });

  $('#pricing-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      renderPricing(await api('/api/admin/pricing', { method: 'PUT', json: readCatalog() }));
      setStatus($('#pricing-status'), 'Prețuri salvate ✓');
    } catch (err) {
      const m = err.message.startsWith('type_without_material:')
        ? `Fiecare tip de proiect are nevoie de cel puțin un material. Lipsește la: ${err.message.split(':')[1].split(',').map(k => PT[k]).join(', ')}.`
        : PRICE_ERR[err.message] || err.message;
      setStatus($('#pricing-status'), m, false);
    }
  });
  $('#pricing-reset').addEventListener('click', () => {
    if (pricingDefaults && confirm('Revii la catalogul și prețurile implicite? (apasă apoi „Salvează prețurile”)')) renderPricing(pricingDefaults);
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
