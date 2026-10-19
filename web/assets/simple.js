'use strict';
/* BâtiPro Simplifié : écrans « une question à la fois » pour les indépendants qui n'aiment pas l'informatique.
   Principes : gros boutons avec icône + mot simple, une seule chose par écran, pas de jargon (« sans TVA » au lieu de HT),
   tout est enregistré tout seul, dictée vocale pour décrire le travail, retour à l'accueil toujours visible.
   Les données sont les mêmes que dans l'édition complète (devis, factures, achats, chantiers, contacts). */

const S_UNITS = [['pc', 'pièce'], ['m²', 'm²'], ['m', 'mètre'], ['h', 'heure'], ['j', 'jour'], ['forfait', 'forfait']];
const sMoney = (x) => money(x);
const sName = (c) => (c ? contactName(c) : '—');

// Page « simple » : grand titre, bouton retour, pas de barre du bas pendant un parcours (body.wiz)
function sPage(title, back, { wiz = false, step = null } = {}) {
  const page = layout({ active: 's', title, back });
  document.body.classList.toggle('wiz', wiz);
  if (step) page.insertAdjacentHTML('beforebegin', `<div class="s-steps" aria-label="Étape ${step[0]} sur ${step[1]}">${Array.from({ length: step[1] }, (_, i) => `<i class="${i < step[0] ? 'on' : ''}"></i>`).join('')}<span>Étape ${step[0]} sur ${step[1]}</span></div>`);
  page.classList.add('s-page');
  return page;
}
// Grand bouton (tuile ou ligne)
const sBtn = (attrs, icon, label, sub = '', cls = '') => `<button type="button" class="s-btn ${cls}" ${attrs}>${icon ? `<span class="s-ic">${I[icon] || icon}</span>` : ''}<span class="s-tx"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="s-go">${I.chevron}</span></button>`;
// Barre fixe en bas : retour + suivant
function sFoot(page, next, nextLabel = 'Suivant', back = null) {
  page.insertAdjacentHTML('beforeend', `<div class="s-foot">${back ? `<button type="button" class="s-back" data-sback>${I.back} Retour</button>` : ''}<button type="button" class="s-next" data-snext>${nextLabel} ${I.chevron}</button></div>`);
  $('[data-snext]', page).onclick = next;
  if (back) $('[data-sback]', page).onclick = back;
}
// Dictée vocale (Chrome / Safari récents) : ajoute le texte dicté à la zone de texte
const speechOk = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
function micFor(btn, ta) {
  if (!speechOk()) { btn.remove(); return; }
  btn.onclick = () => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; const rec = new R();
    rec.lang = 'fr-BE'; rec.interimResults = false; rec.maxAlternatives = 1;
    btn.classList.add('on'); toast('Parlez… (le texte s\'écrit tout seul)', 4000);
    rec.onresult = (e) => { const t = e.results[0][0].transcript; ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1); ta.dispatchEvent(new Event('input', { bubbles: true })); };
    rec.onerror = () => toast('Je n\'ai pas entendu, réessayez', 2500);
    rec.onend = () => btn.classList.remove('on');
    rec.start();
  };
}
const grow = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };

// ---------------------------------------------------------------- Accueil
async function homeSimple() {
  const all = await db.many(['quote', 'invoice', 'project', 'expense']);
  const page = sPage('Accueil');
  const co = company(); const s = sellerInfo();
  const inv = all.invoice.map((i) => ({ i, s: invState(i) }));
  const owed = inv.filter((x) => ['impayee', 'partielle', 'retard'].includes(x.s.s)); const late = owed.filter((x) => x.s.s === 'retard');
  const drafts = inv.filter((x) => x.s.s === 'brouillon' && (x.i.data.lines || []).length);
  const qWait = all.quote.filter((q) => q.data.status === 'envoye');
  const sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const missing = !co.vat || !co.iban || !s.street || !s.city;
  const hour = new Date().getHours();
  page.innerHTML = `<h2 class="s-hello">${hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'} ${esc((S.me.name || '').split(' ')[0])} 👋</h2>
    ${missing ? `<a class="s-alert" href="#/s/moi">${I.edit}<span><b>Commencez ici : vos informations</b><small>Nom, adresse, n° de TVA et compte bancaire pour vos factures (2 minutes)</small></span>${I.chevron}</a>` : ''}
    <a class="s-owed ${late.length ? 'late' : ''}" href="#/s/liste/factures">
      <small>Vos clients vous doivent</small><b>${sMoney(sum(owed, (x) => x.s.rest))}</b>
      <span>${owed.length ? `${owed.length} facture${owed.length > 1 ? 's' : ''} pas encore payée${owed.length > 1 ? 's' : ''}` : 'Tout est payé 👍'}${late.length ? ` · <em>${late.length} en retard</em>` : ''}</span></a>
    <div class="s-tiles">
      <button class="s-tile t1" data-go="#/s/facture/new">${I.coins}<b>Faire une facture</b></button>
      <button class="s-tile t2" data-go="#/s/devis/new">${I.calc}<b>Faire un devis</b></button>
      <button class="s-tile t3" data-go="#/s/achat">${I.camera}<b>J'ai acheté</b><small>photo du ticket</small></button>
      <button class="s-tile t4" data-go="#/s/paye">${I.check}<b>On m'a payé</b></button>
    </div>
    ${drafts.length ? `<div class="s-note">${I.edit}<span>${drafts.length} facture${drafts.length > 1 ? 's' : ''} pas encore envoyée${drafts.length > 1 ? 's' : ''}</span><a href="#/s/liste/factures?f=brouillon">Voir</a></div>` : ''}
    ${qWait.length ? `<div class="s-note">${I.calc}<span>${qWait.length} devis en attente de réponse du client</span><a href="#/s/liste/devis">Voir</a></div>` : ''}
    <div class="s-list">
      ${sBtn('data-go="#/s/liste/factures"', 'coins', 'Mes factures', `${all.invoice.length} facture(s)`)}
      ${sBtn('data-go="#/s/liste/devis"', 'calc', 'Mes devis', `${all.quote.length} devis`)}
      ${sBtn('data-go="#/s/liste/achats"', 'download', 'Mes achats', `${all.expense.length} achat(s)`)}
      ${sBtn('data-go="#/projects"', 'crane', 'Mes chantiers', `${all.project.filter((p) => !['termine', 'annule'].includes(p.data.status)).length} en cours`)}
      ${sBtn('data-go="#/contacts/client"', 'contacts', 'Mes clients')}
      ${sBtn('data-go="#/s/moi"', 'gear', 'Mes informations', 'nom, adresse, TVA, banque, logo')}
    </div>`;
  $$('[data-go]', page).forEach((b) => { b.onclick = () => go(b.dataset.go); });
}

// ---------------------------------------------------------------- Facture / devis : parcours en 5 étapes
const DOC_STEPS = ['client', 'chantier', 'tva', 'travail', 'fini'];
async function docWizard(kind, id, step) {
  const typ = kind === 'devis' ? 'quote' : 'invoice'; const word = kind === 'devis' ? 'devis' : 'facture';
  if (id === 'new') {
    const co = company();
    const base = kind === 'devis'
      ? { status: 'brouillon', date: today(), valid: addDays(today(), num(co.quoteValidity) || 30), ownerId: S.me.id, lines: [], discount: 0, reverse: false, notes: co.quoteNotes || '', simple: true }
      : { kind: 'facture', status: 'brouillon', date: today(), due: addDays(today(), num(co.paymentDays) || 30), payDays: num(co.paymentDays) || 30, defaultVat: defVat(), ownerId: S.me.id, billSame: true, lines: [], payments: [], discount: 0, reverse: false, notes: co.invoiceNotes || '', simple: true };
    const it = await persist(typ, { project_id: null, data: base });
    location.replace(`#/s/${kind}/${it.id}/client`); return;
  }
  const it = await db.get(typ, +id);
  const d = it.data; d.lines = d.lines || [];
  if (typ === 'invoice' && d.status === 'emise') return go(`#/s/doc/facture/${it.id}`);
  step = DOC_STEPS.includes(step) ? step : 'client';
  const n = DOC_STEPS.indexOf(step) + 1;
  const goStep = (k) => go(`#/s/${kind}/${it.id}/${k}`);
  const save = () => persist(typ, it, { silent: true });
  const titles = { client: `Pour quel client ?`, chantier: 'Pour quel chantier ?', tva: 'Quelle TVA ?', travail: 'Qu\'avez-vous fait ?', fini: kind === 'devis' ? 'Votre devis est prêt' : 'Votre facture est prête' };
  const page = sPage(titles[step], n > 1 ? `#/s/${kind}/${it.id}/${DOC_STEPS[n - 2]}` : '#/dashboard', { wiz: true, step: [n, 5] });
  const contacts = await db.list('contact');

  if (step === 'client') {
    const list = contacts.filter((c) => ['client', 'prospect', 'architecte', 'autre'].includes(c.data.kind) || !c.data.kind).sort((a, b) => b.id - a.id);
    page.innerHTML = `<p class="s-lead">Choisissez le client${kind === 'devis' ? ' qui recevra le devis' : ' à qui vous envoyez la facture'}.</p>
      <button class="s-big primary" data-new>${I.plus} Nouveau client</button>
      ${list.length > 5 ? `<label class="s-search">${I.search}<input type="search" placeholder="Chercher un nom…" autocomplete="off"></label>` : ''}
      <div class="s-list" data-l>${list.map((c) => sBtn(`data-c="${c.id}"`, 'contacts', esc(sName(c)), esc([c.data.city, c.data.phone].filter(Boolean).join(' · ')), +d.clientId === c.id ? 'sel' : '')).join('') || '<p class="muted">Aucun client pour l\'instant.</p>'}</div>`;
    const q = $('input[type=search]', page);
    if (q) q.oninput = () => { const v = q.value.toLowerCase(); $$('[data-c]', page).forEach((b) => { b.hidden = !b.textContent.toLowerCase().includes(v); }); };
    const pick = async (cid) => { d.clientId = cid; await save(); goStep('chantier'); };
    $$('[data-c]', page).forEach((b) => { b.onclick = () => pick(+b.dataset.c); });
    $('[data-new]', page).onclick = async () => { const c = await sNewClient(); if (c) pick(c.id); };
    return;
  }
  const client = byId(contacts, d.clientId);
  if (!client) return goStep('client');

  if (step === 'chantier') {
    const projects = (await db.list('project')).filter((p) => !['termine', 'annule'].includes(p.data.status));
    const mine = projects.filter((p) => +p.data.clientId === client.id); const others = projects.filter((p) => +p.data.clientId !== client.id);
    const row = (p) => sBtn(`data-p="${p.id}"`, 'crane', esc(p.data.name), esc([p.data.address, p.data.city].filter(Boolean).join(', ')), it.project_id === p.id ? 'sel' : '');
    page.innerHTML = `<p class="s-lead">Le chantier sert à voir ce que vous gagnez et dépensez à cet endroit.</p>
      <button class="s-big primary" data-new>${I.plus} Nouveau chantier</button>
      <div class="s-list">${mine.map(row).join('')}</div>
      <button class="s-big" data-none>Pas de chantier</button>
      ${others.length ? `<details class="s-more"><summary>Autres chantiers (${others.length})</summary><div class="s-list">${others.map(row).join('')}</div></details>` : ''}`;
    const pick = async (pid) => {
      it.project_id = pid || null;
      const p = pid ? projects.find((x) => x.id === pid) || await db.get('project', pid) : null;
      if (p) { d.title = d.title || p.data.name; if (typ === 'quote') d.siteAddress = [p.data.address, [p.data.zip, p.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', '); }
      if (!d.title) d.title = `Travaux ${sName(client)}`;
      await save(); goStep('tva');
    };
    $$('[data-p]', page).forEach((b) => { b.onclick = () => pick(+b.dataset.p); });
    $('[data-none]', page).onclick = () => pick(null);
    $('[data-new]', page).onclick = async () => { const p = await sNewProject(client); if (p) pick(p.id); };
    return;
  }

  if (step === 'tva') {
    const rates = vatList();
    const be = rates.includes(6) && rates.includes(21);
    const opts = be ? [
      ['6', '6 %', 'Rénovation d\'une maison de plus de 10 ans, pour un particulier qui y habite'],
      ['21', '21 %', 'Construction neuve, maison de moins de 10 ans, magasin, bureau, ou autre travail'],
      ['al', 'Autoliquidation', 'Vous travaillez pour une autre entreprise de construction : c\'est elle qui paie la TVA (0 % sur la facture)'],
      ...rates.filter((r) => ![6, 21, 0].includes(r)).map((r) => [String(r), `${fnum(r)} %`, '']),
    ] : [...rates.map((r) => [String(r), `${fnum(r)} %`, '']), ['al', 'Autoliquidation', 'TVA payée par le client professionnel']];
    const cur = d.reverse ? 'al' : String(d.defaultVat ?? (d.lines.find((l) => l.kind === 'item') || {}).vat ?? defVat());
    const isCo = !!(client.data.company || client.data.vat);
    page.innerHTML = `<p class="s-lead">Choisissez ce qui correspond au travail. ${isCo ? '' : 'Pour un particulier, c\'est souvent 6 % (rénovation).'}</p>
      <div class="s-list">${opts.map(([k, l, sub]) => sBtn(`data-v="${k}"`, k === 'al' ? 'percent' : 'percent', l, sub, cur === k ? 'sel' : '')).join('')}</div>
      <p class="s-help">Pas sûr ? Demandez à votre comptable. Vous pourrez changer plus tard.</p>`;
    $$('[data-v]', page).forEach((b) => {
      b.onclick = async () => {
        const v = b.dataset.v;
        if (v === 'al' && !client.data.vat) { toast('Pour l\'autoliquidation, le client doit avoir un n° de TVA : ajoutez-le dans sa fiche', 5000); }
        d.reverse = v === 'al'; const rate = v === 'al' ? 21 : num(v); d.defaultVat = rate;
        d.lines.forEach((l) => { if (l.kind === 'item') l.vat = rate; });
        await save(); goStep('travail');
      };
    });
    return;
  }

  if (step === 'travail') {
    const rate = d.defaultVat ?? defVat();
    if (!d.lines.some((l) => l.kind === 'item')) d.lines.push({ id: lid(), kind: 'item', desc: '', unit: 'forfait', qty: 1, price: '', vat: rate });
    page.innerHTML = `<p class="s-lead">Écrivez ou dites (🎤) le travail, la quantité et le prix.</p><div data-lines></div>
      <div class="s-row2"><button class="s-big" data-add>${I.plus} Ajouter une ligne</button><button class="s-big" data-lib>${I.book} Mes prix</button></div>
      <div class="s-total" data-tot></div>`;
    const box = $('[data-lines]', page);
    const drawTot = () => {
      const t = totals(d);
      $('[data-tot]', page).innerHTML = `<div><span>Sans TVA</span><b>${sMoney(t.base)}</b></div><div><span>${d.reverse ? 'TVA (autoliquidation)' : 'TVA'}</span><b>${sMoney(t.vat)}</b></div><div class="big"><span>Total ${kind === 'devis' ? 'du devis' : 'à payer'}</span><b>${sMoney(t.total)}</b></div>`;
    };
    let tmr = 0; const later = () => { clearTimeout(tmr); tmr = setTimeout(() => save().catch(() => {}), 600); drawTot(); };
    const draw = () => {
      const items = d.lines.filter((l) => l.kind === 'item');
      box.innerHTML = items.map((l, i) => `<div class="s-line" data-i="${l.id}">
        <div class="s-line-h"><b>Ligne ${i + 1}</b>${items.length > 1 ? `<button type="button" class="s-del" data-del aria-label="Supprimer la ligne">${I.trash}</button>` : ''}</div>
        <div class="s-desc"><textarea data-k="desc" rows="2" placeholder="Ex. : Pose de carrelage dans la salle de bain">${esc(l.desc || '')}</textarea><button type="button" class="s-mic" data-mic aria-label="Dicter">🎤</button></div>
        <div class="s-qty"><span>Quantité</span><div class="s-step"><button type="button" data-m="-1" aria-label="Moins">−</button><input data-k="qty" inputmode="decimal" value="${esc(l.qty)}"><button type="button" data-m="1" aria-label="Plus">+</button></div>
          <select data-k="unit" aria-label="Unité">${S_UNITS.map(([u, lb]) => `<option value="${u}" ${l.unit === u ? 'selected' : ''}>${lb}</option>`).join('')}${S_UNITS.some(([u]) => u === l.unit) || !l.unit ? '' : `<option selected>${esc(l.unit)}</option>`}</select></div>
        <label class="s-price"><span>Prix pour 1 ${esc((S_UNITS.find(([u]) => u === l.unit) || [0, l.unit || ''])[1])} <small>(sans TVA)</small></span><input data-k="price" inputmode="decimal" placeholder="0,00" value="${esc(l.price === '' || l.price == null ? '' : fnum(num(l.price)))}"><em>€</em></label>
        <div class="s-ltot">= <b>${sMoney(num(l.qty) * num(l.price))}</b></div></div>`).join('');
      $$('.s-line', box).forEach((row) => {
        const l = d.lines.find((x) => x.id === row.dataset.i);
        const ta = $('textarea', row); grow(ta); ta.oninput = () => { l.desc = ta.value; grow(ta); later(); };
        micFor($('[data-mic]', row), ta);
        const q = $('[data-k=qty]', row); const pr = $('[data-k=price]', row); const lt = $('.s-ltot b', row);
        const upd = () => { lt.textContent = sMoney(num(l.qty) * num(l.price)); later(); };
        q.oninput = () => { l.qty = num(q.value); upd(); };
        $$('[data-m]', row).forEach((b) => { b.onclick = () => { l.qty = Math.max(0, r2(num(l.qty) + +b.dataset.m)); q.value = fnum(l.qty); upd(); }; });
        pr.oninput = () => { l.price = num(pr.value); upd(); };
        $('[data-k=unit]', row).onchange = (e) => { l.unit = e.target.value; later(); draw(); };
        const del = $('[data-del]', row); if (del) del.onclick = () => { const k = d.lines.indexOf(l); const removed = d.lines.splice(k, 1)[0]; draw(); later(); undoToast('Ligne supprimée', () => { d.lines.splice(k, 0, removed); draw(); later(); }); };
      });
    };
    draw(); drawTot();
    $('[data-add]', page).onclick = () => { d.lines.push({ id: lid(), kind: 'item', desc: '', unit: 'pc', qty: 1, price: '', vat: rate }); draw(); later(); setTimeout(() => { const t = $$('.s-line textarea', box).pop(); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.focus(); } }, 50); };
    $('[data-lib]', page).onclick = () => pickArticles((items) => { items.forEach((x) => { x.vat = rate; }); d.lines = d.lines.filter((l) => l.kind !== 'item' || (l.desc || '').trim() || num(l.price)); d.lines.push(...items); draw(); later(); });
    sFoot(page, async () => {
      d.lines = d.lines.filter((l) => l.kind !== 'item' || (l.desc || '').trim() || num(l.price));
      if (!d.lines.some((l) => l.kind === 'item')) { toast('Écrivez au moins une ligne de travail', 3500); d.lines.push({ id: lid(), kind: 'item', desc: '', unit: 'forfait', qty: 1, price: '', vat: rate }); return draw(); }
      const empty = d.lines.find((l) => l.kind === 'item' && !(l.desc || '').trim());
      if (empty) { toast('Une ligne n\'a pas de description', 3500); return; }
      clearTimeout(tmr); await save(); goStep('fini');
    }, 'Voir le résultat', () => goStep('tva'));
    return;
  }

  // fini : aperçu + envoi
  const t = totals(d);
  page.innerHTML = `<div class="s-done-h"><small>${kind === 'devis' ? 'Devis' : 'Facture'} pour</small><b>${esc(sName(client))}</b><span>${sMoney(t.total)} <small>avec TVA</small></span></div>
    <div class="s-actions" data-acts></div>
    <details class="s-preview" open><summary>Voir ${kind === 'devis' ? 'le devis' : 'la facture'}</summary><div class="s-doc" data-doc><p class="muted">Chargement…</p></div></details>
    <button class="s-big" data-edit>${I.edit} Modifier</button>`;
  $('[data-edit]', page).onclick = () => goStep('travail');
  docHtml(typ, it.id).then((r) => { const el = $('[data-doc]', page); if (el) el.innerHTML = r.html; }).catch((e) => { $('[data-doc]', page).innerHTML = `<p class="late">${esc(e.message)}</p>`; });
  const acts = $('[data-acts]', page);
  const peppolOk = typ === 'invoice' && typeof buyerInfo === 'function' && buyerInfo(client).peppolId && buyerInfo(client).isCompany;
  if (typ === 'invoice') {
    acts.innerHTML = `<p class="s-lead">En validant, la facture reçoit son numéro et ne peut plus être changée.</p>
      ${sBtn('data-a="mail"', 'mail', 'Valider et envoyer par e-mail', client.data.email ? esc(client.data.email) : 'vous choisirez l\'adresse', 'primary')}
      ${peppolOk ? sBtn('data-a="peppol"', 'send', 'Valider et envoyer par Peppol', 'facture électronique (entreprises)') : ''}
      ${sBtn('data-a="share"', 'download', 'Valider et partager le PDF', 'WhatsApp, SMS, enregistrer…')}
      ${sBtn('data-a="later"', 'file', 'Garder pour plus tard', 'pas encore validée')}`;
    $$('[data-a]', acts).forEach((b) => { b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'later') { toast('Facture gardée (pas encore validée)', 2500); return go('#/dashboard'); }
      if (!await emitSimple(it, client)) return;
      if (a === 'mail') return go(`#/print/invoice/${it.id}?mail=1`);
      if (a === 'peppol') { go(`#/s/doc/facture/${it.id}`); return setTimeout(() => peppolInvoice(it), 700); }
      go(`#/s/doc/facture/${it.id}`); setTimeout(() => sharePdfOf('invoice', it.id), 600);
    }; });
  } else {
    acts.innerHTML = `${sBtn('data-a="mail"', 'mail', 'Envoyer par e-mail', client.data.email ? esc(client.data.email) : 'vous choisirez l\'adresse', 'primary')}
      ${sBtn('data-a="share"', 'download', 'Partager le PDF', 'WhatsApp, SMS, enregistrer…')}
      ${sBtn('data-a="later"', 'file', 'Garder pour plus tard')}`;
    $$('[data-a]', acts).forEach((b) => { b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'later') { toast('Devis gardé', 2000); return go('#/dashboard'); }
      if (a === 'mail') return go(`#/print/quote/${it.id}?mail=1`);
      if (d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); await save(); }
      go(`#/s/doc/devis/${it.id}`); setTimeout(() => sharePdfOf('quote', it.id), 600);
    }; });
  }
}
// Valide la facture (numéro définitif)
async function emitSimple(it, client) {
  const d = it.data;
  if (d.reverse && !(client && client.data.vat)) { toast('Autoliquidation : ajoutez d\'abord le n° de TVA du client', 5000); return false; }
  if (!(d.title || '').trim()) d.title = `Travaux ${sName(client)}`;
  if (!confirm('Valider la facture ? Elle reçoit son numéro et ne pourra plus être modifiée.')) return false;
  const r = await api('POST', `number/${d.kind === 'avoir' ? 'avoir' : 'invoice'}`);
  it.number = r.number; d.status = 'emise'; d.emittedAt = today();
  if (!d.communication && company().country !== 'FR') d.communication = structComm(r.number.replace(/\D/g, ''));
  await persist('invoice', it, { silent: true });
  toast(`Facture n° ${it.number} validée ✓`, 2500);
  return true;
}
// Partager le PDF depuis n'importe quel écran (WhatsApp, SMS, enregistrer…)
async function sharePdfOf(typ, id) {
  const r = await docHtml(typ, id);
  const holder = document.createElement('div'); holder.className = 'print-page s-offscreen'; holder.innerHTML = r.html;
  document.body.appendChild(holder);
  const old = $$('.print-page').filter((x) => x !== holder); old.forEach((x) => x.classList.remove('print-page'));
  try { await sharePdf(r.title); } catch (e) { toast('PDF impossible : ' + e.message, 4000); } finally { holder.remove(); old.forEach((x) => x.classList.add('print-page')); }
}
function undoToast(msg, undo) {
  toast(msg, 5000);
  const t = $('#toast'); if (!t) return;
  const b = document.createElement('button'); b.className = 'toast-undo'; b.textContent = 'Annuler';
  b.onclick = () => { undo(); t.classList.remove('show'); }; t.appendChild(b);
}

// Nouveau client : particulier ou entreprise (le n° de TVA remplit la fiche)
function sNewClient() {
  return new Promise((res) => {
    let saved = null; let isCo = false;
    const m = modal(`${mhead('Nouveau client')}<form class="m-body s-form" autocomplete="off">
      <div class="s-seg"><button type="button" class="on" data-t="p">${I.contacts} Un particulier</button><button type="button" data-t="c">${I.crane} Une entreprise</button></div>
      <label class="field s-co" hidden><span>N° de TVA de l'entreprise</span><input name="vat" placeholder="BE0123456789" inputmode="text"><small class="muted">Tapez le numéro : le nom et l'adresse se remplissent tout seuls.</small></label>
      <label class="field"><span data-nl>Prénom et nom</span><input name="company" required></label>
      <label class="field"><span>Adresse (rue et numéro)</span><input name="address"></label>
      <div class="s-row2"><label class="field"><span>Code postal</span><input name="zip" inputmode="numeric"></label><label class="field"><span>Ville</span><input name="city"></label></div>
      <label class="field"><span>Téléphone</span><input name="phone" type="tel"></label>
      <label class="field"><span>E-mail (pour envoyer les factures)</span><input name="email" type="email"></label>
      <input name="country" type="hidden" value="Belgique"><button type="submit" hidden></button></form>
      <div class="m-foot"><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Enregistrer le client</button></div>`, { onClose: () => res(saved) });
    const f = $('form', m.el);
    $$('[data-t]', m.el).forEach((b) => { b.onclick = () => { isCo = b.dataset.t === 'c'; $$('[data-t]', m.el).forEach((x) => x.classList.toggle('on', x === b)); $('.s-co', m.el).hidden = !isCo; $('[data-nl]', m.el).textContent = isCo ? 'Nom de l\'entreprise' : 'Prénom et nom'; if (isCo) f.vat.focus(); }; });
    vatAutofill(f, { name: 'company', street: 'address', zip: 'zip', city: 'city', country: 'country', phone: 'phone', email: 'email' });
    const ok = async () => {
      const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, String(x).trim()]));
      if (!v.company) { toast(isCo ? 'Indiquez le nom de l\'entreprise' : 'Indiquez le nom du client', 3000); return f.company.focus(); }
      const data = { kind: 'client', country: v.country || 'Belgique', address: v.address, zip: v.zip, city: v.city, phone: v.phone, email: v.email, vat: isCo ? v.vat : '' };
      if (isCo) data.company = v.company; else { const parts = v.company.split(/\s+/); data.firstname = parts.length > 1 ? parts.shift() : ''; data.name = parts.join(' '); }
      saved = await persist('contact', { data }); m.close();
    };
    $('[data-ok]', m.el).onclick = ok; f.onsubmit = (e) => { e.preventDefault(); ok(); };
  });
}
// Nouveau chantier : à l'adresse du client par défaut
function sNewProject(client) {
  return new Promise((res) => {
    let saved = null; const cd = client.data;
    const m = modal(`${mhead('Nouveau chantier')}<form class="m-body s-form" autocomplete="off">
      <label class="field"><span>Nom du chantier</span><input name="name" value="${esc(`${cd.city ? cd.city + ' – ' : ''}${sName(client)}`)}"></label>
      <label class="field"><span>Adresse du chantier</span><input name="address" value="${esc(cd.address || '')}"></label>
      <div class="s-row2"><label class="field"><span>Code postal</span><input name="zip" value="${esc(cd.zip || '')}" inputmode="numeric"></label><label class="field"><span>Ville</span><input name="city" value="${esc(cd.city || '')}"></label></div>
      <button type="submit" hidden></button></form>
      <div class="m-foot"><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Créer le chantier</button></div>`, { onClose: () => res(saved) });
    const f = $('form', m.el);
    const ok = async () => {
      const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, String(x).trim()]));
      saved = await persist('project', { data: { name: v.name || sName(client), clientId: client.id, address: v.address, zip: v.zip, city: v.city, status: 'encours', managerId: S.me.id, start: today(), color: '#3b5bdb' } });
      m.close();
    };
    $('[data-ok]', m.el).onclick = ok; f.onsubmit = (e) => { e.preventDefault(); ok(); };
  });
}

// ---------------------------------------------------------------- J'ai acheté : photo du ticket → chantier → montant → c'est noté
async function buyWizard(id, step) {
  if (!id) {
    const page = sPage('J\'ai acheté quelque chose', '#/dashboard', { wiz: true, step: [1, 3] });
    page.innerHTML = `<p class="s-lead">Prenez le ticket ou la facture en photo. L'application lit le montant toute seule.</p>
      <button class="s-huge" data-cam>${I.camera}<b>Prendre une photo</b></button>
      <button class="s-big" data-file>${I.file} Choisir un fichier (PDF ou photo)</button>
      <button class="s-big" data-none>${I.edit} Pas de papier : écrire le montant</button>`;
    const go1 = async (files) => {
      const file = files && files[0]; if (!file && files) return;
      page.innerHTML = `<div class="s-wait"><span class="spin"></span><b>${file ? 'Je lis le ticket…' : 'Un instant…'}</b></div>`;
      try {
        const preset = file ? await purchasePreset(file, null) : { date: today(), category: 'mat', source: 'manuel' };
        const e = await persist('expense', { project_id: null, data: { ...preset, status: 'avalider', simple: true } });
        location.replace(`#/s/achat/${e.id}/chantier`);
      } catch (err) { toast('Erreur : ' + err.message, 5000); render(); }
    };
    $('[data-cam]', page).onclick = async () => go1(await pickFile('image/*', false, 'environment'));
    $('[data-file]', page).onclick = async () => go1(await pickFile('application/pdf,image/*,.xml'));
    $('[data-none]', page).onclick = () => go1(null);
    return;
  }
  const e = await db.get('expense', +id); const d = e.data;
  if (step === 'chantier') {
    const page = sPage('Pour quel chantier ?', `#/s/achat`, { wiz: true, step: [2, 3] });
    const projects = (await db.list('project')).filter((p) => !['termine', 'annule'].includes(p.data.status)).sort((a, b) => b.id - a.id);
    page.innerHTML = `<p class="s-lead">Choisissez où ce matériel sera utilisé.</p>
      <div class="s-list">${projects.map((p) => sBtn(`data-p="${p.id}"`, 'crane', esc(p.data.name), esc([p.data.address, p.data.city].filter(Boolean).join(', ')), e.project_id === p.id ? 'sel' : '')).join('')}</div>
      <button class="s-big" data-p="0">${I.gear} Pour l'entreprise (pas de chantier)</button>`;
    $$('[data-p]', page).forEach((b) => { b.onclick = async () => { e.project_id = +b.dataset.p || null; delete d.alloc; await persist('expense', e, { silent: true }); go(`#/s/achat/${e.id}/montant`); }; });
    return;
  }
  // montant : vérifier ce qui a été lu
  const page = sPage('Vérifiez', `#/s/achat/${e.id}/chantier`, { wiz: true, step: [3, 3] });
  const contacts = await db.list('contact');
  const sup = byId(contacts, d.supplierId); const guess = d.supplierGuess || {};
  const ttc = purchTtc(d);
  const cats = [['mat', 'Matériaux', 'download'], ['materiel', 'Outils / location', 'tool'], ['st', 'Sous-traitant', 'people'], ['divers', 'Autre', 'more']];
  page.innerHTML = `${d.fileId ? `<div class="s-thumb" data-view></div>` : ''}
    <form class="s-form" autocomplete="off" onsubmit="return false">
      <label class="field"><span>Magasin / fournisseur</span><input name="sup" list="s-sups" value="${esc(sup ? sName(sup) : guess.name || '')}" placeholder="Ex. : Brico, Gedimat…"></label>
      <datalist id="s-sups">${contacts.filter((c) => ['fournisseur', 'soustraitant'].includes(c.data.kind)).map((c) => `<option value="${esc(sName(c))}">`).join('')}</datalist>
      <label class="field s-amount"><span>Montant payé (avec TVA)</span><input name="ttc" inputmode="decimal" value="${ttc ? famt(ttc) : ''}" placeholder="0,00"><em>€</em></label>
      <label class="field"><span>Date</span><input name="date" type="date" value="${esc(d.date || today())}"></label>
      <div class="field"><span>C'est quoi ?</span><div class="s-chips">${cats.map(([k, l]) => `<button type="button" data-cat="${k}" class="${(d.category || 'mat') === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field"><span>Déjà payé ?</span><div class="s-seg"><button type="button" data-paid="1" class="${d.paid !== false ? 'on' : ''}">✓ Oui, c'est payé</button><button type="button" data-paid="0" class="${d.paid === false ? 'on' : ''}">Non, à payer</button></div></div>
    </form>`;
  if (d.fileId) purchViewer($('[data-view]', page), () => ({ fileId: d.fileId, fileName: d.fileName }), () => {});
  const f = $('form', page); let cat = d.category || 'mat'; let paid = d.paid !== false;
  $$('[data-cat]', page).forEach((b) => { b.onclick = () => { cat = b.dataset.cat; $$('[data-cat]', page).forEach((x) => x.classList.toggle('on', x === b)); }; });
  $$('[data-paid]', page).forEach((b) => { b.onclick = () => { paid = b.dataset.paid === '1'; $$('[data-paid]', page).forEach((x) => x.classList.toggle('on', x === b)); }; });
  sFoot(page, async () => {
    const total = r2(num(f.ttc.value));
    if (!total) { toast('Indiquez le montant payé', 3000); return f.ttc.focus(); }
    const name = f.sup.value.trim();
    let c = name ? contacts.find((x) => sName(x).toLowerCase() === name.toLowerCase()) : null;
    if (!c && name) c = await persist('contact', { data: { kind: cat === 'st' ? 'soustraitant' : 'fournisseur', company: name, vat: guess.vat || '', address: guess.address || '', zip: guess.zip || '', city: guess.city || '', iban: d.iban || '' } });
    // TVA lue sur la facture si le total correspond, sinon taux par défaut
    const lines = Array.isArray(d.vatLines) && d.vatLines.length && Math.abs(purchTtc(d) - total) < 0.02 ? d.vatLines : [{ rate: 21, amount: r2(total - total / 1.21) }];
    const vat = r2(lines.reduce((a, x) => a + num(x.amount), 0));
    Object.assign(d, { supplierId: c ? c.id : null, ttc: total, vatLines: lines, vatAmount: vat, vat: lines[0].rate, amount: r2(total - vat), date: f.date.value || today(), category: cat, status: 'validee', toCheck: false, desc: d.desc || (name ? `Achat ${name}` : 'Achat'), ref: d.ref || `Ticket ${fmtDate(f.date.value || today())}` });
    delete d.readNote; delete d.supplierGuess;
    d.payments = paid ? [{ date: d.date, amount: total, method: 'Carte' }] : [];
    purchSyncPaid(d); if (!paid) { d.paid = false; d.due = d.due || addDays(d.date, 30); }
    await persist('expense', e, { silent: true });
    const page2 = sPage('C\'est noté !', '#/dashboard', { wiz: true });
    page2.innerHTML = `<div class="s-ok">${I.check}<b>Achat enregistré</b><span>${sMoney(total)}${e.project_id ? ' · sur le chantier' : ''}</span></div>
      <button class="s-big primary" data-again>${I.camera} Encore un achat</button><button class="s-big" data-home>${I.dash} Retour à l'accueil</button>`;
    $('[data-again]', page2).onclick = () => go('#/s/achat');
    $('[data-home]', page2).onclick = () => go('#/dashboard');
  }, 'Enregistrer', () => go(`#/s/achat/${e.id}/chantier`));
}

// ---------------------------------------------------------------- On m'a payé
async function paidWizard(id) {
  const [invoices, contacts] = await Promise.all([db.list('invoice'), db.list('contact')]);
  if (!id) {
    const page = sPage('Qui vous a payé ?', '#/dashboard', { wiz: true });
    const open = invoices.map((i) => ({ i, s: invState(i) })).filter((x) => ['impayee', 'partielle', 'retard'].includes(x.s.s)).sort((a, b) => (a.i.data.date || '').localeCompare(b.i.data.date || ''));
    page.innerHTML = open.length ? `<p class="s-lead">Touchez la facture qui a été payée.</p><div class="s-list">${open.map((x) => sBtn(`data-i="${x.i.id}"`, 'coins', `${esc(sName(byId(contacts, x.i.data.clientId)))} – ${sMoney(x.s.rest)}`, `Facture ${esc(x.i.number || '')} du ${fmtDate(x.i.data.date)}${x.s.s === 'retard' ? ' · <em class="late">en retard</em>' : ''}`)).join('')}</div>`
      : `<div class="s-ok">${I.check}<b>Tout est payé</b><span>Aucune facture en attente de paiement.</span></div><button class="s-big" data-home>${I.dash} Retour à l'accueil</button>`;
    $$('[data-i]', page).forEach((b) => { b.onclick = () => go(`#/s/paye/${b.dataset.i}`); });
    const h = $('[data-home]', page); if (h) h.onclick = () => go('#/dashboard');
    return;
  }
  const it = invoices.find((x) => x.id === +id); if (!it) return go('#/s/paye');
  const st = invState(it); const c = byId(contacts, it.data.clientId);
  const page = sPage('Combien ?', '#/s/paye', { wiz: true });
  let method = 'Virement';
  page.innerHTML = `<div class="s-done-h"><small>${esc(sName(c))} · facture ${esc(it.number || '')}</small><b>Reste à payer</b><span>${sMoney(st.rest)}</span></div>
    <button class="s-big primary" data-all>${I.check} Tout est payé (${sMoney(st.rest)})</button>
    <p class="s-lead">ou une partie seulement :</p>
    <label class="field s-amount"><span>Montant reçu</span><input name="amt" inputmode="decimal" placeholder="0,00"><em>€</em></label>
    <div class="field"><span>Comment ?</span><div class="s-chips">${['Virement', 'Espèces', 'Carte'].map((x) => `<button type="button" data-m="${x}" class="${x === method ? 'on' : ''}">${x}</button>`).join('')}</div></div>`;
  $$('[data-m]', page).forEach((b) => { b.onclick = () => { method = b.dataset.m; $$('[data-m]', page).forEach((x) => x.classList.toggle('on', x === b)); }; });
  const pay = async (amount) => {
    amount = r2(amount); if (!amount) { toast('Indiquez le montant reçu', 3000); return; }
    if (amount - st.rest > 0.01) { toast(`C'est plus que le reste à payer (${sMoney(st.rest)})`, 4000); return; }
    it.data.payments = [...(it.data.payments || []), { date: today(), amount, method }];
    await persist('invoice', it, { silent: true });
    const left = invState(it).rest;
    const p2 = sPage('Merci !', '#/dashboard', { wiz: true });
    p2.innerHTML = `<div class="s-ok">${I.check}<b>Paiement enregistré</b><span>${sMoney(amount)}${left > 0.005 ? ` · il reste ${sMoney(left)}` : ' · facture payée ✓'}</span></div>
      <button class="s-big primary" data-more>${I.coins} Un autre paiement</button><button class="s-big" data-home>${I.dash} Retour à l'accueil</button>`;
    $('[data-more]', p2).onclick = () => go('#/s/paye'); $('[data-home]', p2).onclick = () => go('#/dashboard');
  };
  $('[data-all]', page).onclick = () => pay(st.rest);
  sFoot(page, () => pay(num($('[name=amt]', page).value)), 'Enregistrer');
}

// ---------------------------------------------------------------- Listes (factures, devis, achats)
const S_INV_ST = { brouillon: ['Pas encore envoyée', '#868e96'], impayee: ['Pas encore payée', '#f08c00'], partielle: ['Payée en partie', '#0c8599'], retard: ['En retard !', '#e5484d'], payee: ['Payée ✓', '#2f9e44'], avoir: ['Note de crédit', '#7048e8'] };
const S_Q_ST = { brouillon: ['Pas encore envoyé', '#868e96'], envoye: ['Attend la réponse', '#f08c00'], accepte: ['Accepté ✓', '#2f9e44'], refuse: ['Refusé', '#e5484d'], annule: ['Annulé', '#adb5bd'] };
async function listSimple(kind) {
  const f = new URLSearchParams(location.hash.split('?')[1] || '').get('f') || '';
  const contacts = await db.list('contact');
  if (kind === 'achats') {
    const [rows, projects] = await Promise.all([db.list('expense'), db.list('project')]);
    const page = sPage('Mes achats', '#/dashboard');
    rows.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
    page.innerHTML = `<button class="s-big primary" data-new>${I.camera} J'ai acheté quelque chose</button>
      <div class="s-cards">${rows.map((e) => { const stt = purchState(e); const p = byId(projects, e.project_id);
        return `<a class="s-card" href="#/s/achat/${e.id}/montant"><span class="s-ct"><b>${esc(sName(byId(contacts, e.data.supplierId)) !== '—' ? sName(byId(contacts, e.data.supplierId)) : e.data.desc || 'Achat')}</b><small>${fmtDate(e.data.date)}${p ? ` · ${esc(p.data.name)}` : ''}</small></span>
          <span class="s-ca"><b>${sMoney(purchTtc(e.data))}</b>${stt === 'avalider' ? '<em class="warn">À vérifier</em>' : stt === 'payee' ? '<em class="ok">Payé</em>' : '<em class="late">À payer</em>'}</span></a>`; }).join('') || '<p class="muted s-empty">Aucun achat pour l\'instant.</p>'}</div>`;
    $('[data-new]', page).onclick = () => go('#/s/achat');
    return;
  }
  const isInv = kind === 'factures'; const typ = isInv ? 'invoice' : 'quote';
  const rows = (await db.list(typ)).filter((x) => (x.data.lines || []).length || x.number);
  const ST = isInv ? S_INV_ST : S_Q_ST;
  const stOf = (x) => (isInv ? invState(x).s : x.data.status || 'brouillon');
  const filters = isInv ? [['', 'Toutes'], ['apayer', 'Pas payées'], ['brouillon', 'Pas envoyées'], ['payee', 'Payées']] : [['', 'Tous'], ['envoye', 'En attente'], ['accepte', 'Acceptés'], ['brouillon', 'Pas envoyés']];
  const match = (x) => { const s = stOf(x); return !f || (f === 'apayer' ? ['impayee', 'partielle', 'retard'].includes(s) : s === f); };
  const page = sPage(isInv ? 'Mes factures' : 'Mes devis', '#/dashboard');
  rows.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  page.innerHTML = `<button class="s-big primary" data-new>${I.plus} ${isInv ? 'Faire une facture' : 'Faire un devis'}</button>
    <div class="s-chips s-filter">${filters.map(([k, l]) => `<a href="#/s/liste/${kind}${k ? '?f=' + k : ''}" class="${f === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="s-cards">${rows.filter(match).map((x) => { const s = stOf(x); const t = totals(x.data); const rest = isInv ? invState(x).rest : 0;
      return `<a class="s-card" href="#/s/doc/${isInv ? 'facture' : 'devis'}/${x.id}"><span class="s-ct"><b>${esc(sName(byId(contacts, x.data.clientId)))}</b><small>${esc(x.number || 'Brouillon')} · ${fmtDate(x.data.date)}${x.data.title ? ` · ${esc(x.data.title)}` : ''}</small></span>
        <span class="s-ca"><b>${sMoney(isInv && ['impayee', 'partielle', 'retard'].includes(s) ? rest : t.total)}</b><em style="--c:${(ST[s] || ['', '#868e96'])[1]}">${esc((ST[s] || [s])[0])}</em></span></a>`; }).join('') || `<p class="muted s-empty">Rien ici pour l'instant.</p>`}</div>`;
  $('[data-new]', page).onclick = () => go(`#/s/${isInv ? 'facture' : 'devis'}/new`);
}

// ---------------------------------------------------------------- Une facture / un devis : grands boutons d'action
async function docSimple(kind, id) {
  const typ = kind === 'devis' ? 'quote' : 'invoice';
  const it = await db.get(typ, +id); const d = it.data;
  const contacts = await db.list('contact'); const c = byId(contacts, d.clientId);
  const page = sPage(`${kind === 'devis' ? 'Devis' : 'Facture'} ${it.number || '(brouillon)'}`, `#/s/liste/${kind === 'devis' ? 'devis' : 'factures'}`);
  const t = totals(d);
  const st = typ === 'invoice' ? invState(it) : null; const s = st ? st.s : d.status || 'brouillon';
  const ST = typ === 'invoice' ? S_INV_ST : S_Q_ST;
  const draft = typ === 'invoice' ? s === 'brouillon' : d.status === 'brouillon';
  page.innerHTML = `<div class="s-done-h"><small>${esc(sName(c))}${d.title ? ` · ${esc(d.title)}` : ''}</small><b style="color:${(ST[s] || ['', '#333'])[1]}">${esc((ST[s] || [s])[0])}</b><span>${sMoney(st && st.rest > 0.005 && s !== 'brouillon' ? st.rest : t.total)} <small>${st && st.paid > 0.005 && st.rest > 0.005 ? `reste à payer (sur ${sMoney(t.total)})` : 'avec TVA'}</small></span></div>
    <div class="s-actions" data-acts></div>
    <details class="s-preview"><summary>Voir ${kind === 'devis' ? 'le devis' : 'la facture'}</summary><div class="s-doc" data-doc></div></details>`;
  const acts = [];
  if (draft) acts.push(['edit', 'edit', kind === 'devis' ? 'Continuer le devis' : 'Continuer la facture', 'ajouter, modifier, puis envoyer', 'primary']);
  if (typ === 'invoice' && ['impayee', 'partielle', 'retard'].includes(s)) acts.push(['pay', 'check', 'On m\'a payé', 'enregistrer le paiement', 'primary']);
  if (!(typ === 'invoice' && draft)) {
    acts.push(['mail', 'mail', 'Envoyer par e-mail', c && c.data.email ? esc(c.data.email) : '']);
    acts.push(['share', 'download', 'Partager le PDF', 'WhatsApp, SMS, enregistrer…']);
  }
  if (typ === 'invoice' && !draft && c && typeof buyerInfo === 'function' && buyerInfo(c).peppolId && buyerInfo(c).isCompany) acts.push(['peppol', 'send', 'Envoyer par Peppol', d.peppol && d.peppol.sentAt ? `déjà envoyée le ${fmtDate(d.peppol.sentAt)}` : 'facture électronique']);
  if (typ === 'quote' && ['envoye', 'brouillon'].includes(d.status)) { acts.push(['yes', 'check', 'Le client a dit oui', 'je fais la facture', d.status === 'envoye' ? 'primary' : '']); acts.push(['no', 'x', 'Le client a dit non', '']); }
  if (typ === 'quote' && d.status === 'accepte') acts.push(['bill', 'coins', 'Faire la facture', 'tout le devis ou un acompte', 'primary']);
  acts.push(['pdf', 'eye', 'Voir en grand / imprimer', '']);
  $('[data-acts]', page).innerHTML = acts.map(([k, ic, l, sub, cls]) => sBtn(`data-a="${k}"`, ic, l, sub, cls || '')).join('');
  $('details', page).addEventListener('toggle', (e) => { if (e.target.open && !$('[data-doc] .doc', page)) docHtml(typ, it.id).then((r) => { $('[data-doc]', page).innerHTML = r.html; }); });
  $$('[data-a]', page).forEach((b) => { b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') return go(`#/s/${kind}/${it.id}/travail`);
    if (a === 'pay') return go(`#/s/paye/${it.id}`);
    if (a === 'mail') return go(`#/print/${typ}/${it.id}?mail=1`);
    if (a === 'pdf') return go(`#/print/${typ}/${it.id}`);
    if (a === 'peppol') return peppolInvoice(it);
    if (a === 'share') { if (typ === 'quote' && d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); await persist('quote', it, { silent: true }); } return sharePdfOf(typ, it.id); }
    if (a === 'no') { d.status = 'refuse'; await persist('quote', it, { silent: true }); return render(); }
    if (a === 'yes') { d.status = 'accepte'; d.acceptedAt = today(); await persist('quote', it, { silent: true }); }
    if (a === 'yes' || a === 'bill') return billQuote(it);
  }; });
}
// Devis accepté → facture (tout, ou un acompte en %)
function billQuote(q) {
  const d = q.data; const t = totals(d);
  const mk = async (lines, kind) => {
    const co = company();
    const it = await persist('invoice', { project_id: q.project_id, data: { kind, quoteId: q.id, clientId: d.clientId, title: d.title, reverse: !!d.reverse, status: 'brouillon', date: today(), due: addDays(today(), num(co.paymentDays) || 30), payDays: num(co.paymentDays) || 30, defaultVat: d.defaultVat ?? defVat(), ownerId: S.me.id, billSame: true, lines, payments: [], discount: num(d.discount), notes: co.invoiceNotes || '', simple: true } });
    go(`#/s/facture/${it.id}/fini`);
  };
  menuSheet('Quelle facture ?', [
    { label: `Tout le devis (${money(t.total)})`, icon: 'coins', primary: true, run: () => mk(d.lines.filter((l) => !l.option).map((l) => ({ ...l, id: lid() })), 'facture') },
    { label: 'Un acompte (30 %)', icon: 'percent', run: () => mk(t.vats.map((x) => ({ id: lid(), kind: 'item', desc: `Acompte de 30 % sur le devis ${q.number}`, unit: 'forfait', qty: 1, price: r2(x.base * 0.3), vat: x.rate, type: 'divers' })), 'acompte') },
    { label: 'Un autre pourcentage…', icon: 'percent', run: async () => {
      const v = await ask('Acompte', [{ name: 'pct', label: 'Pourcentage du devis', type: 'percent', required: true }], { pct: 50 }); if (!v) return;
      mk(t.vats.map((x) => ({ id: lid(), kind: 'item', desc: `Acompte de ${fnum(num(v.pct))} % sur le devis ${q.number}`, unit: 'forfait', qty: 1, price: r2(x.base * num(v.pct) / 100), vat: x.rate, type: 'divers' })), 'acompte');
    } },
  ]);
}

// ---------------------------------------------------------------- Mes informations (pour que les factures soient en règle)
async function meSimple() {
  const page = sPage('Mes informations', '#/dashboard');
  const co = { ...company() }; const a0 = splitAddress(co.address);
  page.innerHTML = `<p class="s-lead">Ces informations sont imprimées sur vos devis et factures.</p>
    <form class="s-form" autocomplete="off" onsubmit="return false">
      <label class="field"><span>Votre n° de TVA</span><input name="vat" value="${esc(co.vat || '')}" placeholder="BE0123456789"><small class="muted">Tapez-le : le nom et l'adresse se remplissent tout seuls.</small></label>
      <label class="field"><span>Nom de votre entreprise</span><input name="name" value="${esc(co.name || '')}"></label>
      <label class="field"><span>Adresse (rue et numéro)</span><input name="street" value="${esc(co.street || a0.street || '')}"></label>
      <div class="s-row2"><label class="field"><span>Code postal</span><input name="zip" inputmode="numeric" value="${esc(co.zip || a0.zip || '')}"></label><label class="field"><span>Ville</span><input name="city" value="${esc(co.city || a0.city || '')}"></label></div>
      <label class="field"><span>Téléphone</span><input name="phone" type="tel" value="${esc(co.phone || '')}"></label>
      <label class="field"><span>E-mail</span><input name="email" type="email" value="${esc(co.email || '')}"></label>
      <label class="field"><span>Compte bancaire (IBAN) – pour être payé</span><input name="iban" value="${esc(co.iban || '')}" placeholder="BE00 0000 0000 0000"></label>
      <div class="field"><span>Votre logo (facultatif)</span><div class="s-logo">${co.logoId ? `<img src="${fileUrl(co.logoId)}" alt="">` : '<span class="muted">Pas de logo</span>'}<button type="button" class="btn" data-logo>${I.camera} Choisir une image</button></div></div>
      <input type="hidden" name="country" value="${esc(co.country || 'BE')}"><input type="hidden" name="website" value="${esc(co.website || '')}">
    </form>
    <p class="s-help">Plus de réglages (TVA, numéros, modèle, Peppol, e-mail) : <a href="#/settings/company">réglages avancés</a>.</p>`;
  const f = $('form', page);
  vatAutofill(f, { name: 'name', street: 'street', zip: 'zip', city: 'city', country: 'country', phone: 'phone', email: 'email', website: 'website' }, { countryCode: true });
  $('[data-logo]', page).onclick = async () => { const [file] = await pickFile('image/*'); if (!file) return; const r = await resizeImage(await blobToImg(file), 600, 'image/png'); const res = await upload(new File([r.blob], 'logo.png', { type: 'image/png' })); co.logoId = res.id; $('.s-logo', page).firstElementChild.outerHTML = `<img src="${fileUrl(res.id)}" alt="">`; };
  sFoot(page, async () => {
    const v = Object.fromEntries([...new FormData(f)].map(([k, x]) => [k, String(x).trim()]));
    if (!v.name) { toast('Indiquez le nom de votre entreprise', 3000); return f.name.focus(); }
    Object.assign(co, v, { address: [v.street, [v.zip, v.city].filter(Boolean).join(' ')].filter(Boolean).join('\n') });
    await api('PUT', 'settings', { company: co }); S.settings.company = co;
    toast('Enregistré ✓', 2000); go('#/dashboard');
  }, 'Enregistrer');
}

// ---------------------------------------------------------------- Aiguillage #/s/…
route('s', async (screen, a, b) => {
  if (screen === 'facture' || screen === 'devis') return docWizard(screen, a, b);
  if (screen === 'achat') return buyWizard(a, b || (a ? 'montant' : ''));
  if (screen === 'paye') return paidWizard(a);
  if (screen === 'liste') return listSimple(a || 'factures');
  if (screen === 'doc') return docSimple(a, b);
  if (screen === 'moi') return meSimple();
  return go('#/dashboard');
});
