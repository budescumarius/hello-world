'use strict';
/* PILOTAGE – Briefing e-mails : boîtes Outlook (Microsoft 365) de l'utilisateur, triées et préparées par l'IA.
   L'IA prépare (catégorie, urgence, action, chantier, brouillon) ; rien ne part sans relecture et clic « Envoyer » de l'utilisateur. */

const PIL_MCAT = { client: ['Client', '#3b5bdb'], fournisseur: ['Fournisseur', '#0c8599'], architecte: ['Architecte / BE', '#7048e8'], administration: ['Administration', '#e8590c'], banque: ['Banque / assurance', '#5c940d'], interne: ['Interne', '#868e96'], publicite: ['Publicité', '#adb5bd'], autre: ['Autre', '#868e96'] };
const PIL_MURG = { haute: ['Urgent', '#e5484d'], normale: ['Normal', '#f08c00'], basse: ['Faible', '#868e96'] };
// pièces jointes : ouvertes dans BatiPro (PDF, photos) ou téléchargées ; relues à la demande sur la boîte, rien n'est copié
const pilAttSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const pilAttsHtml = (m) => ((m.atts || []).length ? `<div class="pm-atts">${m.atts.map((x, i) => `<span class="pm-att"><a href="api.php?r=pilot/mail/msgs/${m.id}/att/${i}" target="_blank" rel="noopener" title="Ouvrir">📎 ${esc(x.name || 'pièce jointe')}${x.size ? ` <small class="muted">${pilAttSize(x.size)}</small>` : ''}</a><a href="api.php?r=pilot/mail/msgs/${m.id}/att/${i}&download=1" class="pm-att-dl" title="Télécharger" aria-label="Télécharger ${esc(x.name || '')}">⬇</a></span>`).join('')}</div>` : '');
const pilRcptTxt = (l) => (l || []).map((r) => r.email).join(', ');
const pilRcptParse = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map((email) => ({ email }));

// ---------------------------------------------------------------- Page « E-mails » organisée comme Outlook :
// à gauche les dossiers (Briefing, puis chaque boîte : réception, envoyés, publicité), au milieu la liste par jour, à droite l'e-mail ouvert.
// Téléphone : liste puis e-mail en plein écran (bouton « Retour »).
const PM_COLORS = ['#3b5bdb', '#0c8599', '#e8590c', '#7048e8', '#2f9e44', '#c2255c'];
let pmAutoAt = 0; // relève automatique à l'ouverture (au plus toutes les 5 minutes)
let pmDelKey = null; // touche « Suppr » : supprime l'e-mail ouvert (après confirmation)
document.addEventListener('keydown', (e) => { if ((e.key === 'Delete') && pmDelKey && location.hash.startsWith('#/pilotage/emails') && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') && document.querySelector('.pm-read [data-del]')) { e.preventDefault(); pmDelKey(); } });
let pmTimer = null; // page ouverte : relève discrète chaque minute
const pmTime = (s) => { const d = String(s || ''); if (d.slice(0, 10) === today()) return d.slice(11, 16); const days = (Date.parse(today()) - Date.parse(d.slice(0, 10))) / 864e5; return days < 7 ? new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short' }) + ' ' + d.slice(11, 16) : fmtDate(d.slice(0, 10)); };
const pmDay = (s) => { const d = String(s || '').slice(0, 10); if (d === today()) return 'Aujourd\'hui'; if (d === addDays(today(), -1)) return 'Hier'; const t = new Date(d + 'T12:00:00'); return (Date.parse(today()) - Date.parse(d)) / 864e5 < 7 ? t.toLocaleDateString('fr-BE', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase()) : t.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }); };
const PM_FOLDERS = { advice: 'Conseiller du jour', todo: 'À faire', drafts: 'Réponses préparées', waiting: 'Sans réponse > 2 jours', new: 'Pas encore triés', in: 'Boîte de réception', sent: 'Envoyés', trash: 'Corbeille', pub: 'Publicité', info: 'Pour info' };

async function pilMailPage() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('connected')) { toast(`Boîte ${q.get('connected')} connectée : première relève en cours…`, 4000); history.replaceState(null, '', '#/pilotage/emails'); pmAutoAt = 0; }
  if (q.get('err')) { toast(q.get('err'), 8000); history.replaceState(null, '', '#/pilotage/emails'); }
  const [b, projects] = await Promise.all([api('GET', 'pilot/mail/brief'), db.list('project').catch(() => [])]);
  const last = b.accounts.map((a) => a.last_sync).filter(Boolean).sort().pop();
  const page = layout({ icon: 'mail', title: 'E-mails', sub: `${b.accounts.length ? `Dernière relève : ${last ? fmtDT(last) : 'jamais'} · ` : ''}rien ne part sans votre relecture`,
    actions: b.accounts.length ? '<button class="btn primary" data-compose>✎ Nouveau message</button><button class="btn" data-sync>Relever maintenant</button><button class="btn" data-conns>⚙ Connexions</button>'
      : `${b.configured ? '<button class="btn primary" data-connect>+ Boîte Microsoft 365</button>' : ''}<button class="btn ${b.configured ? '' : 'primary'}" data-imap>+ Boîte ${b.configured ? 'Hostico' : '(Hostico / cPanel)'}</button>` });
  const pname = (id) => { const p = byId(projects, id); return p ? p.data.name : ''; };
  const accColor = (id) => PM_COLORS[Math.max(0, b.accounts.findIndex((a) => a.id === id)) % PM_COLORS.length];
  const accTag = (m) => { const a = b.accounts.find((x) => x.id === m.account_id); return `<span class="pm-acc" style="--c:${accColor(m.account_id)}" title="${esc(a ? a.email : '')}">${esc(a ? a.email.split('@')[0] : '?')}</span>`; };
  const bindTop = () => {
    const im = $('[data-imap]'); if (im) im.onclick = () => pilImapConnect();
    const cn = $('[data-connect]'); if (cn) cn.onclick = async () => { pilMsConnect(); };
    const cs = $('[data-conns]'); if (cs) cs.onclick = () => pilMailConnections(b);
    const sy = $('[data-sync]'); if (sy) sy.onclick = () => pilMailSync(sy);
    const cp = $('[data-compose]'); if (cp) cp.onclick = () => pilCompose(b.accounts);
  };
  const msConf = () => { if (!pilCan('settings.write')) return; page.insertAdjacentHTML('beforeend', `<details class="card pm-conf"><summary><b>Microsoft 365</b> <span class="muted">connexion des boîtes hébergées chez Microsoft ${b.configured ? '· configuré ✓' : '(à configurer une fois)'}</span></summary><div data-conf></div></details>`); const det = $('.pm-conf', page); det.addEventListener('toggle', () => { const d = $('[data-conf]', det); if (!d.childElementCount) pilMailConfig(d); }, { once: true }); };
  if (!b.accounts.length) {
    page.innerHTML = `<div class="card"><div class="card-h"><h3>Aucune boîte connectée</h3></div><p class="muted">${b.configured ? 'Cliquez « + Boîte Microsoft 365 » (en haut), puis choisissez « Compte professionnel ou scolaire ». Une fois par adresse. Chaque boîte n\'est visible que par vous.' : 'Connectez vos boîtes une par une. Chaque boîte n\'est visible que par vous.'}</p></div>`;
    bindTop(); msConf(); return;
  }
  if (!b.ai) page.insertAdjacentHTML('afterbegin', '<div class="alert warn">Assistant IA non configuré : les e-mails sont relevés mais pas triés ni préparés (Paramètres → Assistant IA : clé API Claude).</div>');
  // boîte qui n'est plus relevée : la cause et quoi faire, en permanence (pas seulement dans un message éphémère)
  const newestOf = (id) => ((b.folders || []).find((f) => f.id === id) || {}).newest;
  b.accounts.filter((a) => a.kind === 'imap' && a.status === 'ok' && !a.last_error && (!newestOf(a.id) || Date.now() - Date.parse(String(newestOf(a.id)).replace(' ', 'T')) > 24 * 3600000)).forEach((a) => page.insertAdjacentHTML('afterbegin', `<div class="alert bad pm-stale"><b>⚠ ${esc(a.email)} est connectée par Hostico (IMAP) et n'a reçu aucun e-mail depuis ${newestOf(a.id) ? fmtDT(newestOf(a.id)) : 'la connexion'}.</b><br><small>Si vos e-mails arrivent dans Outlook (Microsoft 365), reconnectez cette boîte avec Microsoft : elle passera sur Microsoft 365.</small>
    <div class="btns">${b.configured ? '<button class="btn sm primary" data-tomsft>Connecter avec Microsoft 365</button>' : ''}<button class="btn sm" data-diag="${a.id}">Diagnostic</button></div></div>`));
  $$('[data-tomsft]', page).forEach((x) => { x.onclick = () => pilMsConnect(); });
  const stale = b.accounts.filter((a) => a.status !== 'ok' || a.last_error || !a.last_sync || Date.now() - Date.parse(String(a.last_sync).replace(' ', 'T')) > 30 * 60000);
  stale.forEach((a) => page.insertAdjacentHTML('afterbegin', `<div class="alert bad pm-stale"><b>⚠ ${esc(a.email)} : ${a.status !== 'ok' ? 'la connexion doit être refaite' : a.last_error ? 'la dernière relève a échoué' : `pas relevée depuis ${a.last_sync ? fmtDT(a.last_sync) : 'la connexion'}`}.</b>${a.last_error ? `<br><small>${esc(a.last_error)}</small>` : ''}
    <div class="btns"><button class="btn sm primary" data-recon="${a.id}">Reconnecter</button><button class="btn sm" data-diag="${a.id}">Diagnostic</button><button class="btn sm" data-sync2>Relever maintenant</button></div></div>`));
  const reconnect = async (a) => { if (a.kind === 'imap') return pilImapConnect(a.email); pilMsConnect(); };
  $$('[data-recon]', page).forEach((x) => { x.onclick = () => reconnect(b.accounts.find((a) => a.id === +x.dataset.recon)); });
  $$('[data-diag]', page).forEach((x) => { x.onclick = () => pilMailCheck(+x.dataset.diag); });
  $$('[data-sync2]', page).forEach((x) => { x.onclick = () => pilMailSync(x); });
  const st = ui.pm || (ui.pm = { box: 'all', folder: 'advice' });
  if (st.box !== 'all' && !b.accounts.some((a) => a.id === +st.box)) { st.box = 'all'; st.folder = 'in'; }
  const fold = (box, folder, label, n, cls = '') => `<button type="button" class="pm-f ${String(st.box) === String(box) && st.folder === folder ? 'on' : ''} ${cls}" data-box="${box}" data-folder="${folder}"><span class="grow">${label}</span>${n ? `<span class="pm-n">${n}</span>` : ''}</button>`;
  const fs = b.folders || [];
  const unreadAll = fs.reduce((a, f) => a + f.unread, 0);
  const navHtml = `<div class="pm-sec">Briefing</div>
      ${fold('all', 'advice', '💡 Conseiller du jour', 0)}${fold('all', 'todo', '⚑ À faire', b.counts.todo, b.counts.urgent ? 'urgent' : '')}${fold('all', 'drafts', '✎ Réponses préparées', b.counts.drafts)}${fold('all', 'waiting', '⏱ Sans réponse > 2 j', b.counts.waiting)}${b.counts.new ? fold('all', 'new', 'Pas encore triés', b.counts.new) : ''}${fold('all', 'info', 'Pour info', 0)}
      <div class="pm-sec">Toutes les boîtes</div>${fold('all', 'in', 'Boîte de réception', unreadAll)}${fold('all', 'sent', 'Envoyés', 0)}${fold('all', 'trash', '🗑 Corbeille', 0)}
      ${fs.map((f) => { const a = b.accounts.find((x) => x.id === f.id) || {}; return `<div class="pm-sec pm-acc-h" style="--c:${accColor(f.id)}"><span class="grow" title="${esc(f.email)}">${esc(f.email)}<small class="pm-kind">${f.kind === 'imap' ? 'Hostico (IMAP)' : 'Microsoft 365'}</small></span>${a.status && a.status !== 'ok' ? '<span class="late" title="' + esc(a.last_error || '') + '">⚠</span>' : ''}<button type="button" class="icon-btn sm" data-acc="${f.id}" aria-label="Options de la boîte">${I.more}</button></div>
        ${fold(f.id, 'in', 'Boîte de réception', f.unread)}${fold(f.id, 'sent', 'Envoyés', 0)}${f.pub ? fold(f.id, 'pub', 'Publicité', f.pub) : ''}${fold(f.id, 'trash', '🗑 Corbeille', 0)}`; }).join('')}`;
  const selOpts = [...[['all', 'advice'], ['all', 'todo'], ['all', 'drafts'], ['all', 'waiting'], ...(b.counts.new ? [['all', 'new']] : []), ['all', 'info'], ['all', 'in'], ['all', 'sent'], ['all', 'trash']].map(([bx, f]) => [`${bx}|${f}`, `${bx === 'all' && ['in', 'sent', 'trash'].includes(f) ? 'Toutes les boîtes – ' : ''}${PM_FOLDERS[f]}`]),
    ...fs.flatMap((f) => [[`${f.id}|in`, `${f.email} – Boîte de réception${f.unread ? ` (${f.unread})` : ''}`], [`${f.id}|sent`, `${f.email} – Envoyés`], ...(f.pub ? [[`${f.id}|pub`, `${f.email} – Publicité`]] : []), [`${f.id}|trash`, `${f.email} – Corbeille`]])];
  page.insertAdjacentHTML('beforeend', `<div class="pm ${st.sel ? 'reading' : ''} ${st.folder === 'advice' ? 'adv' : ''}">
      <nav class="pm-nav">${navHtml}</nav>
      <section class="pm-list"><div class="pm-lh"><select class="pm-sel" data-sel aria-label="Dossier">${selOpts.map(([v, l]) => `<option value="${v}" ${v === `${st.box}|${st.folder}` ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <b class="pm-title">${esc(PM_FOLDERS[st.folder] || '')}${st.box !== 'all' ? ` <small class="muted">${esc((b.accounts.find((a) => a.id === +st.box) || {}).email || '')}</small>` : ''}</b>
        <label class="search sm">${I.search}<input type="search" data-q placeholder="Rechercher" value="${esc(st.q || '')}"></label>
        ${st.folder === 'todo' ? `<select data-grp aria-label="Regrouper">${[['', 'Urgent d\'abord'], ['cat', 'Par catégorie'], ['proj', 'Par chantier'], ['from', 'Par expéditeur']].map(([k, l]) => `<option value="${k}" ${(ui.pilMailGrp || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>
        <div class="pm-rows" data-rows><p class="muted pm-pad">Chargement…</p></div></section>
      <section class="pm-read" data-read><div class="pm-empty muted">Sélectionnez un e-mail pour le lire.</div></section></div>`);
  msConf(); bindTop();
  const wrap = $('.pm', page); const rowsEl = $('[data-rows]', page); const readEl = $('[data-read]', page);
  const go2 = (box, folder) => { st.box = box; st.folder = folder; st.sel = null; st.q = ''; saveUi(); render(); };
  $$('.pm-f', page).forEach((x) => { x.onclick = () => go2(x.dataset.box === 'all' ? 'all' : +x.dataset.box, x.dataset.folder); });
  $('[data-sel]', page).onchange = (e) => { const [bx, f] = e.target.value.split('|'); go2(bx === 'all' ? 'all' : +bx, f); };
  const gs = $('[data-grp]', page); if (gs) gs.onchange = () => { ui.pilMailGrp = gs.value; saveUi(); load(); };
  let qT = null; $('[data-q]', page).oninput = (e) => { clearTimeout(qT); qT = setTimeout(() => { st.q = e.target.value; saveUi(); load(); }, 300); };
  $$('[data-acc]', page).forEach((x) => { x.onclick = (e) => { e.stopPropagation(); const a = b.accounts.find((y) => y.id === +x.dataset.acc); menuSheet(a.email, [
    { label: `Dernière relève : ${a.last_sync ? fmtDT(a.last_sync) : 'jamais'}${a.last_error ? ` – ${a.last_error}` : ''}`, icon: 'clock', run: () => {} },
    a.kind === 'imap' ? { label: 'Reconnecter (nouveau mot de passe…)', icon: 'key', run: () => pilImapConnect(a.email) } : { label: 'Reconnecter (Microsoft)', icon: 'key', run: async () => { pilMsConnect(); } },
    { label: 'Diagnostic (comparer avec la boîte)', icon: 'search', run: () => pilMailCheck(a.id) },
    { label: 'Relire les 14 derniers jours', icon: 'download', run: () => pilMailSync(null, true) },
    { label: a.autoPub ? '✓ Ranger les publicités dans « Publicité » (activé – désactiver)' : 'Ranger les publicités dans « Publicité » (désactivé – activer)', icon: 'check', run: async () => { await api('PUT', `pilot/mail/accounts/${a.id}`, { autoPub: !a.autoPub }); toast(a.autoPub ? 'Rangement automatique désactivé' : 'Rangement automatique activé'); render(); } },
    { label: 'Déconnecter cette boîte', icon: 'trash', danger: true, run: async () => { if (!confirm(`Déconnecter ${a.email} ? Les e-mails relevés et les brouillons de cette boîte sont effacés de BatiPro (rien n'est effacé dans Outlook).`)) return; await api('DELETE', `pilot/mail/accounts/${a.id}`); toast('Boîte déconnectée'); render(); } },
  ]); }; });

  // ---- liste
  let items = [];
  const row = (m) => { const a = m.analysis || {}; const cat = PIL_MCAT[a.categorie]; const sent = m.folder === 'sent';
    return `<button type="button" class="pm-row ${!m.is_read && !sent ? 'unread' : ''} ${st.sel === m.id ? 'on' : ''}" data-id="${m.id}">
      <span class="pm-r1">${a.urgence === 'haute' ? '<i class="pm-urg" title="Urgent"></i>' : ''}<b class="grow">${esc(sent ? `À : ${(m.to || []).map((x) => x.name || x.email).join(', ') || '—'}` : (m.from_name || m.from_email || '?'))}</b><small class="muted">${pmTime(m.at)}</small></span>
      <span class="pm-r2">${esc(m.subject || '(sans objet)')}${(m.atts || []).length ? ' <span title="Pièce jointe">📎</span>' : ''}</span>
      <span class="pm-r3 muted">${esc(a.action ? `➜ ${a.action}` : (a.resume || m.preview || ''))}</span>
      <span class="pm-r4">${st.box === 'all' ? accTag(m) : ''}${cat && st.folder !== 'sent' ? badge(cat[0], cat[1]) : ''}${m.state === 'repondu' ? '<small class="muted">↩ répondu</small>' : m.state === 'fait' ? '<small class="good">✓ fait</small>' : ''}${m.moved ? `<small class="muted">📁 ${esc(m.moved)}</small>` : ''}${m.project_id ? `<small>🏗 ${esc(pname(m.project_id))}</small>` : ''}</span></button>`; };
  const draftRow = (d) => `<button type="button" class="pm-row draft" data-draft="${d.id}"><span class="pm-r1"><b class="grow">À : ${esc(pilRcptTxt(d.to))}</b>${d.origin === 'ia' ? badge('Préparé par l\'IA', '#7048e8') : badge('Votre brouillon', '#3b5bdb')}</span>
      <span class="pm-r2">${esc(d.subject)}</span><span class="pm-r3 muted">${esc((d.body || '').slice(0, 160))}</span>${(d.check.non_verifie || []).length ? `<span class="pm-r4 late">⚠ Montant à vérifier : ${d.check.non_verifie.map(esc).join(', ')}</span>` : ''}</button>`;
  const groupKey = (m) => { const g = st.folder === 'todo' ? (ui.pilMailGrp || '') : 'day'; return g === 'day' ? pmDay(m.at) : g === 'cat' ? (PIL_MCAT[(m.analysis || {}).categorie] || PIL_MCAT.autre)[0] : g === 'proj' ? (m.project_id ? pname(m.project_id) || 'Chantier' : 'Sans chantier') : g === 'from' ? (m.from_name || m.from_email || '?') : ''; };
  const drawRows = (more) => {
    if (st.folder === 'drafts') { rowsEl.innerHTML = b.drafts.map(draftRow).join('') || '<p class="muted pm-pad">Aucune réponse en attente.</p>'; }
    else {
      let list = items; if (st.folder === 'todo' && !ui.pilMailGrp) list = [...items].sort((x, y) => ((x.analysis || {}).urgence === 'haute' ? 0 : 1) - ((y.analysis || {}).urgence === 'haute' ? 0 : 1) || y.at.localeCompare(x.at));
      let cur = null; let html = '';
      const keyed = st.folder === 'todo' && ui.pilMailGrp ? [...list].sort((x, y) => groupKey(x).localeCompare(groupKey(y))) : list;
      for (const m of keyed) { const k = groupKey(m); if (k && k !== cur) { cur = k; html += `<div class="pm-day">${esc(k)}</div>`; } html += row(m); }
      rowsEl.innerHTML = (html || `<p class="muted pm-pad">${st.q ? 'Aucun e-mail ne correspond.' : st.folder === 'todo' ? 'Rien à faire. 👍' : 'Aucun e-mail.'}</p>`) + (more ? '<button type="button" class="btn sm pm-more" data-more>Afficher les plus anciens</button>' : '');
    }
    $$('[data-id]', rowsEl).forEach((x) => { x.onclick = () => openMsg(+x.dataset.id); });
    $$('[data-draft]', rowsEl).forEach((x) => { x.onclick = () => { const d = b.drafts.find((y) => y.id === +x.dataset.draft); pilDraftEdit(d, null, b.accounts); }; });
    const mo = $('[data-more]', rowsEl); if (mo) mo.onclick = () => load(items[items.length - 1].at);
  };
  async function load(before) {
    if (st.folder === 'drafts') { drawRows(false); return; }
    if (st.folder === 'advice') { pilAdviceLoad(rowsEl, { open: openMsg, go: go2, b }); return; }
    const r = await api('GET', `pilot/mail/list&box=${st.box}&folder=${st.folder}${st.q ? `&q=${encodeURIComponent(st.q)}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    items = before ? [...items, ...r.items] : r.items; drawRows(r.more);
  }
  // ---- lecture
  async function openMsg(id) {
    st.sel = id; saveUi(); wrap.classList.add('reading');
    $$('.pm-row', rowsEl).forEach((x) => x.classList.toggle('on', +x.dataset.id === id));
    readEl.innerHTML = '<p class="muted pm-pad">Chargement…</p>';
    let m; try { m = await api('GET', `pilot/mail/msgs/${id}`); } catch (e) { st.sel = null; saveUi(); readEl.innerHTML = `<p class="muted pm-pad">${esc(e.message)}</p>`; return; }
    const a = m.analysis || {}; const acc = b.accounts.find((x) => x.id === m.account_id) || {}; const it = items.find((x) => x.id === id) || {}; const trash = it.folder === 'trash'; const sentF = it.folder === 'sent'; const sent = sentF || trash;
    const setRead = (read) => {
      if (sent || !!it.is_read === read) return; it.is_read = read;
      const r = $(`.pm-row[data-id="${id}"]`, rowsEl); if (r) r.classList.toggle('unread', !read);
      [`.pm-f[data-box="all"][data-folder="in"]`, `.pm-f[data-box="${m.account_id}"][data-folder="in"]`].forEach((sel) => { const f = $(sel, page); if (!f) return; let n = $('.pm-n', f);
        const v = Math.max(0, (n ? +n.textContent : 0) + (read ? -1 : 1)); if (!n && v) { f.insertAdjacentHTML('beforeend', '<span class="pm-n"></span>'); n = $('.pm-n', f); } if (n) { if (v) n.textContent = v; else n.remove(); } });
    };
    setRead(true);
    const draft = (m.drafts || []).find((x) => x.status === 'brouillon');
    readEl.innerHTML = `<div class="pm-rh"><button type="button" class="btn sm pm-back" data-back>← Retour</button>
        <h2>${esc(m.subject || '(sans objet)')}</h2>
        <div class="pm-meta"><b>${esc(sentF ? (acc.email || '') : (m.from_name || m.from_email || ''))}</b> ${sentF ? '' : `&lt;${esc(m.from_email || '')}&gt;`}<br><small class="muted">À : ${esc(pilRcptTxt(m.to))} · ${fmtDT(m.at)}</small><br>
          <small>${sentF ? 'Envoyé depuis' : 'Reçu sur'} <span class="pm-acc" style="--c:${accColor(m.account_id)}">${esc(acc.email || '')}</span></small></div>
        ${trash ? '<div class="alert warn pm-trash">🗑 Dans la corbeille. Vous pouvez le restaurer, ou le supprimer définitivement.</div>' : ''}
        <div class="btns">${trash ? '<button class="btn sm primary" data-restore>↩ Restaurer</button><button class="btn sm ghost danger" data-del>Supprimer définitivement</button>' : ''}${sent ? '' : `<button class="btn sm primary" data-reply>${draft ? 'Relire la réponse préparée…' : 'Répondre'}</button>`}${m.state === 'a_faire' || m.state === 'nouveau' ? '<button class="btn sm good" data-done>✓ Fait</button><button class="btn sm ghost" data-ign>Ignorer</button>' : ''}${sent ? '' : '<button class="btn sm ghost" data-unread>Marquer comme non lu</button>'}${trash ? '' : '<button class="btn sm ghost danger" data-del title="Supprimer (touche Suppr)">🗑 Supprimer</button>'}${m.moved ? '<button class="btn sm" data-unmove>Remettre dans la boîte de réception</button>' : ''}${m.web_link ? `<a class="btn sm ghost" href="${esc(m.web_link)}" target="_blank" rel="noopener">Ouvrir dans Outlook ↗</a>` : ''}</div></div>
      ${a.resume || a.action ? `<div class="alert info">${a.resume ? `<b>Résumé :</b> ${esc(a.resume)}` : ''}${a.action ? `<br><b>À faire :</b> ${esc(a.action)}${a.echeance ? ` (avant le ${fmtDate(a.echeance)})` : ''}` : ''}${a.pieces ? `<br><b>Pièces jointes :</b> ${esc(a.pieces)}` : ''}${(a.non_verifie || []).length ? `<br><span class="late">⚠ Montant à vérifier : ${a.non_verifie.map(esc).join(', ')}</span>` : ''}</div>` : ''}
      ${pilAttsHtml(m)}
      <div class="pre pm-body">${esc(m.body || m.preview || '')}</div>
      ${sent || trash ? '' : `<label class="field"><span>Chantier</span><select data-p><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === m.project_id ? 'selected' : ''}>${esc(p.data.name)}</option>`).join('')}</select></label>`}`;
    $('[data-back]', readEl).onclick = () => { st.sel = null; saveUi(); wrap.classList.remove('reading'); $$('.pm-row', rowsEl).forEach((x) => x.classList.remove('on')); };
    const done = async (state) => { await api('PUT', `pilot/mail/msgs/${id}`, { state }); toast(state === 'fait' ? 'Marqué fait' : 'Ignoré'); render(); };
    const d1 = $('[data-done]', readEl); if (d1) d1.onclick = () => done('fait');
    // supprimer : vers « Éléments supprimés » d'Outlook (ou la corbeille), puis l'e-mail suivant s'ouvre
    const del = async () => {
      if (!confirm(trash ? `Supprimer DÉFINITIVEMENT « ${m.subject || '(sans objet)'} » ?\n\nIl ne pourra plus être restauré.` : `Supprimer « ${m.subject || '(sans objet)'} » ?\n\nIl va dans la Corbeille (ici et dans ${acc.kind === 'imap' ? 'votre messagerie' : '« Éléments supprimés » d\'Outlook'}) : vous pouvez le restaurer.`)) return;
      try { await api('DELETE', `pilot/mail/msgs/${id}`); } catch (e) { toast(e.message, 6000); return; }
      leave(trash ? 'E-mail supprimé définitivement' : 'Mis dans la corbeille');
    };
    const leave = (msg) => {
      setRead(true); const i = items.findIndex((x) => x.id === id); items = items.filter((x) => x.id !== id); toast(msg);
      const next = items[i] || items[i - 1]; drawRows(false);
      if (next && wrap.offsetWidth > 760) openMsg(next.id); else { st.sel = null; saveUi(); wrap.classList.remove('reading'); readEl.innerHTML = '<div class="pm-empty muted">Sélectionnez un e-mail pour le lire.</div>'; }
    };
    $('[data-del]', readEl).onclick = del; pmDelKey = del;
    const rs = $('[data-restore]', readEl); if (rs) rs.onclick = async () => { try { await api('POST', `pilot/mail/msgs/${id}/restore`, {}); } catch (e) { toast(e.message, 6000); return; } leave('Restauré'); };
    const ur = $('[data-unread]', readEl); if (ur) ur.onclick = async () => { await api('POST', `pilot/mail/msgs/${id}/unread`, {}); setRead(false); toast('Marqué comme non lu'); st.sel = null; saveUi(); wrap.classList.remove('reading'); readEl.innerHTML = '<div class="pm-empty muted">Sélectionnez un e-mail pour le lire.</div>'; $$('.pm-row', rowsEl).forEach((x) => x.classList.remove('on')); };
    const d2 = $('[data-ign]', readEl); if (d2) d2.onclick = () => done('ignore');
    const um = $('[data-unmove]', readEl); if (um) um.onclick = async () => { um.disabled = true; try { await api('POST', `pilot/mail/msgs/${id}/unmove`); toast('Remis dans la boîte de réception (il ne sera plus rangé)'); render(); } catch (e) { um.disabled = false; toast(e.message, 6000); } };
    const rp = $('[data-reply]', readEl); if (rp) rp.onclick = async () => { const d = draft || await api('POST', `pilot/mail/msgs/${id}/draft`); pilDraftEdit(d, m, b.accounts); };
    const ps = $('[data-p]', readEl); if (ps) ps.onchange = async (e) => { await api('PUT', `pilot/mail/msgs/${id}`, { state: m.state === 'nouveau' ? 'a_faire' : m.state === 'repondu' ? 'fait' : m.state, project_id: e.target.value ? +e.target.value : null }); toast('Chantier enregistré'); };
  }
  await load();
  if (st.sel && items.some((x) => x.id === st.sel)) openMsg(st.sel); else { st.sel = null; wrap.classList.remove('reading'); }
  // relève automatique à l'ouverture si la dernière date de plus de 5 minutes
  if (Date.now() - pmAutoAt > 5 * 60000 && (!last || Date.now() - Date.parse(last.replace(' ', 'T')) > 5 * 60000)) { pmAutoAt = Date.now(); pilMailSync(null, false, true); }
  if (!pmTimer) pmTimer = setInterval(() => { if (document.hidden || !location.hash.startsWith('#/pilotage/emails')) return; pilMailSync(null, false, true); }, 60000);
}
async function pilMailSync(btn, deep = false, quiet = false) {
  if (btn) { btn.disabled = true; btn.textContent = 'Relève en cours…'; }
  if (!quiet) toast('Relève et tri des e-mails… (jusqu\'à une minute)', 60000);
  if (quiet) { // relève automatique à l'ouverture : discrète, la page se met à jour s'il y a du nouveau
    try { const r = await api('POST', 'pilot/mail/sync', { deep }); const n = r.results.reduce((a, x) => a + x.new, 0); if (n) toast(`${n} nouvel(s) e-mail(s)`, 2500); if (n || r.errors.length) { if (r.errors.length) toast(r.errors.join(' · '), 8000); if (location.hash.startsWith('#/pilotage/emails') && !document.querySelector('.overlay')) render(); } } catch (e) { /* hors ligne : on garde la liste */ }
    return;
  }
  try { const r = await api('POST', 'pilot/mail/sync', { deep }); const n = r.results.reduce((a, x) => a + x.new, 0); const rg = r.results.reduce((a, x) => a + (x.ranges || 0), 0); toast(`${n} nouvel(s) e-mail(s)${rg ? ` · ${rg} publicité(s) rangée(s)` : ''}${r.results.some((x) => x.analyzed) ? ` · ${r.results.reduce((a, x) => a + (x.analyzed || 0), 0)} trié(s) par l'IA` : ''}${r.errors.length ? ` · ${r.errors.join(' · ')}` : ''}`, r.errors.length ? 8000 : 3500); }
  catch (e) { toast(e.message, 7000); }
  render();
}
// lecture complète d'un e-mail
async function pilMailOpen(id, projects) {
  const m = await api('GET', `pilot/mail/msgs/${id}`); const a = m.analysis || {};
  const md = modal(`${mhead(m.subject || '(sans objet)')}<div class="m-body">
    <p><b>${esc(m.from_name || '')}</b> &lt;${esc(m.from_email || '')}&gt; · ${fmtDT(m.at)}<br><small class="muted">À : ${esc(pilRcptTxt(m.to))}</small></p>
    ${a.resume ? `<div class="alert info"><b>Résumé :</b> ${esc(a.resume)}${a.action ? `<br><b>À faire :</b> ${esc(a.action)}` : ''}${a.pieces ? `<br><b>Pièces jointes :</b> ${esc(a.pieces)}` : ''}</div>` : ''}
    ${pilAttsHtml(m)}
    <div class="pre pil-mail-full">${esc(m.body || m.preview || '')}</div>
    <label class="field"><span>Chantier</span><select data-p><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === m.project_id ? 'selected' : ''}>${esc(p.data.name)}</option>`).join('')}</select></label></div>
    <div class="m-foot">${m.web_link ? `<a class="btn ghost" href="${esc(m.web_link)}" target="_blank" rel="noopener">Ouvrir dans Outlook ↗</a>` : ''}<span class="grow"></span><button class="btn" data-done>✓ Fait</button><button class="btn primary" data-reply>Répondre</button></div>`, { wide: true });
  $('[data-p]', md.el).onchange = async (e) => { await api('PUT', `pilot/mail/msgs/${id}`, { state: m.state === 'nouveau' ? 'a_faire' : m.state === 'repondu' ? 'fait' : m.state, project_id: e.target.value ? +e.target.value : null }); toast('Chantier enregistré'); };
  $('[data-done]', md.el).onclick = async () => { await api('PUT', `pilot/mail/msgs/${id}`, { state: 'fait' }); md.close(); render(); };
  $('[data-reply]', md.el).onclick = async () => { const d = (m.drafts || []).find((x) => x.status === 'brouillon') || await api('POST', `pilot/mail/msgs/${id}/draft`); md.close(); pilDraftEdit(d, m, null); };
}
// relecture d'un brouillon, puis envoi CONFIRMÉ par l'utilisateur
function pilDraftEdit(d, msg, accounts) {
  const acc = (accounts || []).find((x) => x.id === d.account_id);
  const md = modal(`${mhead(d.origin === 'ia' ? 'Réponse préparée par l\'IA – à relire' : d.msg_id ? 'Votre réponse' : `Nouveau message${(accounts || []).find((x) => x.id === d.account_id) ? ` – depuis ${(accounts || []).find((x) => x.id === d.account_id).email}` : ''}`)}<form class="m-body">
    ${d.origin === 'ia' ? '<div class="alert warn">Relisez et corrigez si besoin : l\'IA ne connaît que l\'e-mail reçu. Rien n\'est envoyé tant que vous ne confirmez pas.</div>' : ''}
    ${(d.check.non_verifie || []).length ? `<div class="alert warn">⚠ Montant(s) cité(s) qui ne figurent pas dans l'e-mail reçu : <b>${d.check.non_verifie.map(esc).join(', ')}</b> – vérifiez-les.</div>` : ''}
    ${msg ? `<details><summary class="muted">E-mail reçu : ${esc(msg.subject || '')}</summary><div class="pre pil-mail-full">${esc(msg.body || msg.preview || '')}</div></details>` : ''}
    <label class="field full"><span>À</span><input name="to" value="${esc(pilRcptTxt(d.to))}"></label>
    <label class="field full"><span>Cc</span><input name="cc" value="${esc(pilRcptTxt(d.cc))}"></label>
    <label class="field full"><span>Objet</span><input name="subject" value="${esc(d.subject)}"></label>
    <label class="field full"><span>Message</span><textarea name="body" rows="12">${esc(d.body)}</textarea></label>
    <div class="pil-confirm" data-conf hidden></div></form>
    <div class="m-foot"><button class="btn ghost" data-save>Enregistrer le brouillon</button><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-send>Envoyer…</button></div>`, { wide: true });
  const f = $('form', md.el);
  const val = () => ({ to: pilRcptParse(f.to.value), cc: pilRcptParse(f.cc.value), subject: f.subject.value, body: f.body.value });
  $('[data-save]', md.el).onclick = async () => { await api('PUT', `pilot/mail/drafts/${d.id}`, val()); toast('Brouillon enregistré (non envoyé)'); md.close(); render(); };
  $('[data-send]', md.el).onclick = () => {
    const v = val(); if (!v.to.length) return toast('Ajoutez un destinataire');
    const box = $('[data-conf]', md.el); box.hidden = false;
    box.innerHTML = `<div class="alert info"><b>Envoyer maintenant${acc ? ` depuis ${esc(acc.email)}` : ''} ?</b><br>À : ${esc(pilRcptTxt(v.to))}${v.cc.length ? ` · Cc : ${esc(pilRcptTxt(v.cc))}` : ''}<br>Objet : ${esc(v.subject)}
      <div class="btns"><button type="button" class="btn primary" data-yes>Oui, envoyer</button><button type="button" class="btn" data-no>Non, revenir</button></div></div>`;
    box.scrollIntoView({ block: 'nearest' });
    $('[data-no]', box).onclick = () => { box.hidden = true; };
    $('[data-yes]', box).onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api('POST', `pilot/mail/drafts/${d.id}/send`, { ...val(), confirm: true }); md.close(); toast(r.note || 'E-mail envoyé', 4000); render(); }
      catch (err) { e.target.disabled = false; toast(err.message, 7000); }
    };
  };
}
// configuration de l'application Microsoft (propriétaire), avec la marche à suivre
async function pilMailConfig(box) {
  const c = await api('GET', 'pilot/mail/config');
  box.innerHTML = `<div class="card"><div class="card-h"><h3>Configurer la connexion Outlook (une seule fois)</h3></div>
    <ol class="steps"><li>Ouvrez <b>entra.microsoft.com</b> avec un compte administrateur Microsoft 365 de l'entreprise → <b>Applications</b> → <b>Inscriptions d'applications</b> → <b>Nouvelle inscription</b>.</li>
      <li>Nom : <b>BatiPro</b> · Types de comptes : <b>Comptes dans cet annuaire d'organisation uniquement</b>.</li>
      <li>URI de redirection : <b>Web</b> → collez exactement : <code class="pil-copy" data-copy>${esc(c.redirect)}</code></li>
      <li>Après création : copiez <b>ID d'application (client)</b> et <b>ID de l'annuaire (locataire)</b> ci-dessous.</li>
      <li><b>Certificats et secrets</b> → <b>Nouveau secret client</b> (24 mois) → copiez la <b>Valeur</b> ci-dessous.</li>
      <li><b>Autorisations des API</b> → Microsoft Graph → <b>Autorisations déléguées</b> : <b>Mail.ReadWrite</b>, <b>Mail.Send</b>, <b>User.Read</b>, <b>offline_access</b> → <b>Accorder un consentement d'administrateur</b>.</li></ol>
    <div class="grid-form"><label class="field"><span>ID d'application (client)</span><input name="clientId" value="${esc(c.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <label class="field"><span>ID de l'annuaire (locataire)</span><input name="tenant" value="${esc(c.tenant)}" placeholder="xxxxxxxx-… ou madibugroup.be"></label>
      <label class="field full"><span>Secret client (valeur)</span><input name="secret" type="password" placeholder="${c.hasSecret ? '•••••••• (enregistré – laisser vide pour le garder)' : ''}" autocomplete="off"></label></div>
    <div class="btns"><button class="btn primary" data-saveconf>Enregistrer</button></div>
    <p class="muted">Le secret est chiffré. Chaque utilisateur connecte ensuite ses propres boîtes avec « Se connecter avec Microsoft » (aucun mot de passe n'est donné à BatiPro).</p></div>`;
  const cp = $('[data-copy]', box); cp.onclick = () => { navigator.clipboard.writeText(c.redirect).then(() => toast('Adresse copiée')).catch(() => {}); };
  $('[data-saveconf]', box).onclick = async (e) => {
    const btn = e.target; btn.disabled = true;
    try { await api('PUT', 'pilot/mail/config', { clientId: $('[name=clientId]', box).value, tenant: $('[name=tenant]', box).value, secret: $('[name=secret]', box).value }); }
    catch (err) { btn.disabled = false; return toast(err.message, 8000); }
    toast('Microsoft 365 configuré ✓ – cliquez maintenant « + Connecter une boîte Microsoft 365 » (en haut)', 7000); window.scrollTo({ top: 0, behavior: 'smooth' }); render(); };
}

// boîte hébergée (Hostico / cPanel) : adresse + mot de passe de la boîte ; serveurs proposés d'après le domaine
function pilImapConnect(email = '') {
  const md = modal(`${mhead('Connecter une boîte e-mail')}<form class="m-body">
    <p class="muted">Les mêmes informations que dans Outlook (compte IMAP). BatiPro vérifie la connexion avant de l'enregistrer ; le mot de passe est chiffré et n'est jamais affiché.</p>
    <label class="field full"><span>Adresse e-mail</span><input name="email" type="email" value="${esc(email)}" placeholder="marius@madibugroup.be" autocomplete="off"></label>
    <label class="field full"><span>Mot de passe de la boîte</span><input name="password" type="password" autocomplete="new-password"></label>
    <details><summary class="muted">Serveurs (si l'hébergeur donne d'autres réglages)</summary><div class="grid-form">
      <label class="field"><span>Serveur de réception (IMAP)</span><input name="imap_host" placeholder="mail.votredomaine.be"></label><label class="field"><span>Port</span><select name="imap_port"><option>993</option><option>143</option></select></label>
      <label class="field"><span>Serveur d'envoi (SMTP)</span><input name="smtp_host" placeholder="mail.votredomaine.be"></label><label class="field"><span>Port</span><select name="smtp_port"><option>465</option><option>587</option></select></label></div>
      <small class="muted">Hostico / cPanel : « Comptes de messagerie » → « Connecter les appareils » donne ces réglages (en général mail.votredomaine.be, 993 et 465, SSL).</small></details>
  </form><div class="m-foot"><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-go>Vérifier et connecter</button></div>`);
  const f = $('form', md.el);
  const dom = () => (f.email.value.split('@')[1] || '').trim();
  f.email.oninput = () => { const d = dom(); f.imap_host.placeholder = d ? `mail.${d}` : 'mail.votredomaine.be'; f.smtp_host.placeholder = f.imap_host.placeholder; };
  f.email.oninput();
  $('[data-go]', md.el).onclick = async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Vérification…';
    try {
      const r = await api('POST', 'pilot/mail/imap', { email: f.email.value, password: f.password.value, imap_host: f.imap_host.value, imap_port: +f.imap_port.value, smtp_host: f.smtp_host.value, smtp_port: +f.smtp_port.value });
      md.close(); toast(`Boîte ${r.email} connectée${r.sent_folder ? '' : ' (dossier « Envoyés » introuvable : les réponses partent quand même)'} – première relève…`, 4000); pilMailSync();
    } catch (err) { btn.disabled = false; btn.textContent = 'Vérifier et connecter'; toast(err.message, 8000); }
  };
}

// diagnostic d'une boîte : derniers e-mails du serveur (Microsoft / IMAP) et présence dans BatiPro
async function pilMailCheck(id) {
  const md = modal(`${mhead('Diagnostic de la boîte')}<div class="m-body"><p class="muted">Lecture des 10 derniers e-mails directement sur le serveur de messagerie…</p></div>`, { wide: true });
  let r; try { r = await api('GET', `pilot/mail/accounts/${id}/check`); } catch (e) { $('.m-body', md.el).innerHTML = `<div class="alert warn">${esc(e.message)}</div>`; return; }
  const missing = r.server.filter((x) => !x.in_batipro).length;
  $('.m-body', md.el).innerHTML = `<p><b>${esc(r.email)}</b> (${r.kind === 'imap' ? 'IMAP' : 'Microsoft 365'}) · version ${esc(r.version)}<br>
    <small class="muted">Dernière relève : ${esc(r.last_sync || 'jamais')} · statut ${esc(r.status)} · heure du serveur ${esc(r.server_time)} (UTC ${esc(r.utc)}, ${esc(r.php_tz)})</small></p>
    ${r.last_error ? `<div class="alert warn"><b>Dernière erreur :</b> ${esc(r.last_error)}</div>` : ''}
    ${r.error ? `<div class="alert warn"><b>Lecture du serveur impossible :</b> ${esc(r.error)}</div>` : ''}
    <p>${missing ? `<b class="late">${missing} e-mail(s) récent(s) pas encore dans BatiPro</b>` : '<b class="good">✓ Les 10 derniers e-mails sont dans BatiPro</b>'} · BatiPro : ${r.in_batipro} e-mail(s) relevé(s), le plus récent du ${esc(r.newest_batipro || '—')}</p>
    <table class="dt"><thead><tr><th>Reçu</th><th>De</th><th>Objet</th><th>Dans BatiPro</th></tr></thead><tbody>${r.server.map((x) => `<tr><td class="nowrap">${esc(x.at || '')}</td><td>${esc(x.from)}</td><td>${esc(x.subject)}</td><td>${x.in_batipro ? '✓' : x.stored ? `<b class="late">confondu</b><br><small class="muted">enregistré : ${esc(x.stored.at)} · ${esc(x.stored.subject || '')}</small>` : '<b class="late">non</b>'}</td></tr>`).join('')}</tbody></table>
    <div class="btns" style="margin-top:10px"><button class="btn primary" data-now>Relever maintenant</button></div>`;
  $('[data-now]', md.el).onclick = () => { md.close(); pilMailSync(null, false); };
}

// nouveau message (pas une réponse) : choix de la boîte d'envoi, puis le même écran de relecture et de confirmation
async function pilCompose(accounts) {
  const ok = accounts.filter((a) => a.status === 'ok');
  if (!ok.length) return toast('Aucune boîte connectée en état d\'envoyer : reconnectez-la d\'abord.', 5000);
  const start = async (a) => { const d = await api('POST', 'pilot/mail/drafts', { account_id: a.id, to: [], subject: '', body: `\n\n${mailSign()}` }); pilDraftEdit(d, null, accounts); };
  if (ok.length === 1) return start(ok[0]);
  menuSheet('Envoyer depuis…', ok.map((a) => ({ label: a.email, icon: 'mail', run: () => start(a) })));
}

// connexion Microsoft dans une fenêtre séparée : BatiPro reste ouvert dessous ; fermer la fenêtre = annuler
let pmPopupWatch = null;
async function pilMsConnect() {
  let r; try { r = await api('POST', 'pilot/mail/connect'); } catch (e) { return toast(e.message, 6000); }
  const w = window.open(r.url, 'bp-microsoft', 'popup,width=520,height=720');
  if (!w) { if (confirm('Votre navigateur bloque la fenêtre Microsoft. Continuer dans cette page ? (« Retour à BatiPro » sera proposé à la fin)')) location.href = r.url; return; }
  toast('Fenêtre Microsoft ouverte : choisissez « Compte professionnel ou scolaire ». Fermez-la pour annuler.', 6000);
  clearInterval(pmPopupWatch);
  pmPopupWatch = setInterval(() => { if (w.closed) { clearInterval(pmPopupWatch); pmPopupWatch = null; if (location.hash.startsWith('#/pilotage/emails')) render(); } }, 800);
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || e.data.bp !== 'mail') return;
  if (e.data.ok) { toast(`Boîte ${e.data.email} connectée : première relève en cours…`, 4000); pmAutoAt = 0; render(); setTimeout(() => pilMailSync(null, false), 400); }
  else toast(e.data.msg || 'Connexion non faite', 8000);
});

// « Connexions » : chaque boîte (type, état, dernière relève, dernier e-mail reçu) et ses actions ; ajouter une boîte ; Microsoft 365 (propriétaire)
function pilMailConnections(b) {
  const fs = b.folders || [];
  const row = (a) => { const f = fs.find((x) => x.id === a.id) || {};
    return `<div class="pm-conn"><div class="grow"><b>${esc(a.email)}</b> ${badge(a.kind === 'imap' ? 'Hostico (IMAP)' : 'Microsoft 365', a.kind === 'imap' ? '#e8590c' : '#3b5bdb')} ${a.status === 'ok' && !a.last_error ? badge('OK', '#2f9e44') : badge(a.status === 'ok' ? 'Erreur' : 'À reconnecter', '#e5484d')}
      <br><small class="muted">Dernière relève : ${a.last_sync ? fmtDT(a.last_sync) : 'jamais'} · dernier e-mail reçu : ${f.newest ? fmtDT(f.newest) : '—'}</small>${a.last_error ? `<br><small class="late">${esc(a.last_error)}</small>` : ''}</div>
      <div class="btns">${b.configured ? `<button class="btn sm ${a.kind === 'imap' ? 'primary' : ''}" data-cms>${a.kind === 'imap' ? 'Passer sur Microsoft 365' : 'Reconnecter (Microsoft)'}</button>` : ''}${a.kind === 'imap' ? `<button class="btn sm" data-cimap="${esc(a.email)}">Mot de passe Hostico…</button>` : ''}<button class="btn sm" data-cdiag="${a.id}">Diagnostic</button><button class="btn sm ghost" data-cdel="${a.id}">Déconnecter</button></div></div>`; };
  const md = modal(`${mhead('Connexions des boîtes e-mail')}<div class="m-body">
    <div class="pm-conns">${b.accounts.map(row).join('')}</div>
    <div class="btns" style="margin-top:12px">${b.configured ? '<button class="btn primary" data-cadd-ms>+ Boîte Microsoft 365</button>' : ''}<button class="btn" data-cadd-imap>+ Boîte Hostico / cPanel</button></div>
    <p class="muted sm">Vos e-mails arrivent dans Outlook avec un abonnement Microsoft 365 : connectez les boîtes avec « Microsoft 365 » (« Compte professionnel ou scolaire »). « Hostico » seulement pour des boîtes qui reçoivent encore leurs e-mails chez Hostico.</p>
    ${pilCan('settings.write') ? `<details class="pm-conf"><summary><b>Microsoft 365 – réglage de l'application</b> <span class="muted">${b.configured ? 'configuré ✓' : 'à configurer une fois'}</span></summary><div data-conf></div></details>` : ''}</div>`, { wide: true });
  $$('[data-cms]', md.el).forEach((x) => { x.onclick = () => { md.close(); pilMsConnect(); }; });
  $$('[data-cimap]', md.el).forEach((x) => { x.onclick = () => { md.close(); pilImapConnect(x.dataset.cimap); }; });
  $$('[data-cdiag]', md.el).forEach((x) => { x.onclick = () => { md.close(); pilMailCheck(+x.dataset.cdiag); }; });
  $$('[data-cdel]', md.el).forEach((x) => { x.onclick = async () => { const a = b.accounts.find((y) => y.id === +x.dataset.cdel); if (!confirm(`Déconnecter ${a.email} ? Les e-mails relevés et les brouillons de cette boîte sont effacés de BatiPro (rien n'est effacé dans Outlook).`)) return; await api('DELETE', `pilot/mail/accounts/${a.id}`); md.close(); toast('Boîte déconnectée'); render(); }; });
  const am = $('[data-cadd-ms]', md.el); if (am) am.onclick = () => { md.close(); pilMsConnect(); };
  $('[data-cadd-imap]', md.el).onclick = () => { md.close(); pilImapConnect(); };
  const det = $('.pm-conf', md.el); if (det) det.addEventListener('toggle', () => { const d = $('[data-conf]', det); if (!d.childElementCount) pilMailConfig(d); }, { once: true });
}

// ---------------------------------------------------------------- Conseiller du jour : signaux calculés par BatiPro + conseil de l'IA (montants vérifiés)
const PM_LVL = { haute: ['Prioritaire', '#e5484d'], normale: ['À faire', '#f08c00'], info: ['Info', '#868e96'] };
async function pilAdviceLoad(el, ctx) {
  el.innerHTML = '<p class="muted pm-pad">Analyse de vos e-mails…</p>';
  let r; try { r = await api('GET', 'pilot/mail/advice'); } catch (e) { el.innerHTML = `<p class="muted pm-pad">${esc(e.message)}</p>`; return; }
  const s = r.stats || {};
  const aiCard = () => {
    const c = r.conseil && r.conseil.date === today() ? r.conseil : null;
    if (!r.ai) return '<div class="alert warn"><b>Conseil personnalisé de l\'IA : désactivé.</b> Pour que BatiPro lise vos e-mails, les classe, prépare les réponses et vous conseille chaque jour, ajoutez la clé API Claude dans <a href="#/settings/ai">Paramètres → Assistant IA</a>. Les signaux ci-dessous fonctionnent déjà sans IA.</div>';
    return `<div class="card pm-adv-ai"><div class="card-h"><h3>✦ Conseil du jour</h3>${c ? (c.verification.ok ? badge('Montants vérifiés', '#2f9e44') : badge('Montant(s) à vérifier', '#e5484d')) : ''}</div>
      ${c ? `<div class="pre">${esc(c.texte)}</div>${c.verification.ok ? '' : `<p class="late">Montant(s) absent(s) des données : ${c.verification.unverified.map(esc).join(', ')}</p>`}<p class="muted sm">Rédigé à ${esc(String(c.at).slice(11, 16))} à partir des signaux ci-dessous. L'IA conseille, vous décidez : rien n'est envoyé ni exécuté.</p>`
        : '<p class="muted">L\'IA lit vos e-mails ouverts (résumés), les signaux et les factures en retard, et vous dit quoi faire en premier, quoi déléguer et à quoi faire attention.</p>'}
      <div class="btns"><button class="btn ${c ? '' : 'primary'}" data-adv-ai>${c ? 'Actualiser le conseil' : 'Me conseiller maintenant'}</button></div></div>`;
  };
  const draw = () => {
    el.innerHTML = `<div class="pm-adv">
      <div class="pm-adv-k"><span><b>${s.recus_aujourdhui || 0}</b> reçus aujourd'hui</span><span><b>${s.ouverts || 0}</b> à traiter</span><span class="${s.urgents ? 'late' : ''}"><b>${s.urgents || 0}</b> urgents</span><span><b>${s.attente || 0}</b> vous attendent</span><span><b>${s.brouillons || 0}</b> réponses prêtes</span></div>
      ${aiCard()}
      <h3 class="pm-adv-h">Ce que BatiPro a repéré</h3>
      ${(r.conseils || []).map((c) => `<div class="card pm-adv-c lvl-${c.level}" data-kind="${esc(c.kind)}"><div class="pm-adv-t">${badge(PM_LVL[c.level][0], PM_LVL[c.level][1])}<b class="grow">${esc(c.titre)}</b></div>
        <p>${esc(c.detail)}</p>${(c.emails || []).length ? `<div class="pm-adv-m">${c.emails.map((m) => `<button type="button" class="pt-mail" data-m="${m.id}">✉ ${esc(m.de || '')} – ${esc((m.objet || '(sans objet)').slice(0, 60))} <small class="muted">${esc(pmTime(m.recu))}</small></button>`).join('')}</div>` : ''}
        ${c.href ? `<div class="btns"><button class="btn sm" data-go="${esc(c.href)}">${c.href === 'drafts' ? 'Relire les réponses' : c.href === 'new' ? 'Voir' : 'Ouvrir'}</button></div>` : ''}</div>`).join('') || '<div class="card"><p class="good">✓ Rien d\'important à signaler : vos e-mails sont à jour.</p></div>'}
      <p class="muted sm">Source : ${esc(r._source || '')}.</p></div>`;
    $$('[data-m]', el).forEach((x) => { x.onclick = () => ctx.open(+x.dataset.m); });
    $$('[data-go]', el).forEach((x) => { x.onclick = () => { const h = x.dataset.go; if (h.startsWith('#')) location.hash = h; else ctx.go('all', h); }; });
    const ai = $('[data-adv-ai]', el); if (ai) ai.onclick = async () => {
      ai.disabled = true; ai.textContent = 'Analyse en cours…';
      try { r.conseil = await api('POST', 'pilot/mail/advice', {}); draw(); } catch (e) { toast(e.message, 6000); ai.disabled = false; ai.textContent = 'Me conseiller maintenant'; }
    };
  };
  draw();
}
