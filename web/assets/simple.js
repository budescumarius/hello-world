'use strict';
/* BâtiPro Simplifié : écrans « une question à la fois » pour les indépendants qui n'aiment pas l'informatique.
   Principes : gros boutons avec icône + mot simple, une seule chose par écran, pas de jargon (« sans TVA » au lieu de HT),
   tout est enregistré tout seul, dictée vocale pour décrire le travail, retour à l'accueil toujours visible.
   Les données sont les mêmes que dans l'édition complète (devis, factures, achats, chantiers, contacts). */

const S_UNITS = [['pc', 'pièce'], ['u', 'unité'], ['m²', 'm²'], ['m', 'mètre'], ['h', 'heure'], ['j', 'jour'], ['forfait', 'forfait']];
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
// Dictée vocale.
// iPhone / iPad : la reconnaissance vocale du navigateur est peu fiable (surtout dans l'application installée : elle peut
// rester bloquée sans jamais répondre) → on ouvre le clavier et on montre le micro du clavier, qui fonctionne toujours.
// Android / ordinateur : reconnaissance vocale du navigateur, avec arrêt au 2e appui et délai maximum (jamais bloquée).
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const speechOk = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !isIOS();
function keyboardDictation(ta) {
  ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* */ }
  const m = modal(`${mhead('Dicter avec le clavier')}<div class="m-body s-dict">
    <div class="s-dict-kb"><span>a z e r t y</span><span class="s-dict-mic">🎤</span></div>
    <p>Touchez le <b>micro 🎤 du clavier</b> (en bas, à côté de la barre d'espace), parlez, puis touchez <b>OK</b> ou le clavier.</p>
    <p class="muted">Si le micro n'apparaît pas : Réglages du téléphone › Général › Clavier › activer « Dictée ».</p></div>
    <div class="m-foot"><button class="btn primary" data-close>J'ai compris</button></div>`);
  $('[data-close]', m.el).addEventListener('click', () => setTimeout(() => ta.focus(), 50));
}
let activeRec = null;
// Langue de dictée : français, ou roumain traduit automatiquement en français (assistant IA)
const dictLang = () => { try { return localStorage.getItem('bp-dict-lang') === 'ro' && S.translate ? 'ro' : 'fr'; } catch (e) { return 'fr'; } };
const appendText = (ta, t) => { ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1); ta.dispatchEvent(new Event('input', { bubbles: true })); };
function micFor(btn, ta, onText = (t) => appendText(ta, t)) {
  btn.onclick = () => {
    if (!speechOk()) {
      // iPhone : une seule explication, ensuite le clavier s'ouvre directement
      let seen = false; try { seen = !!localStorage.getItem('bp-dict-tip'); localStorage.setItem('bp-dict-tip', '1'); } catch (e) { /* */ }
      if (dictLang() === 'ro') { ta.focus(); toast('Clavier en roumain (🌐), touchez 🎤 et parlez : je traduis en français ensuite', 5000); return; }
      if (seen) { ta.focus(); toast('Touchez le 🎤 du clavier pour parler', 3500); } else keyboardDictation(ta);
      return;
    }
    if (activeRec) { try { activeRec.abort(); } catch (e) { /* */ } return; } // 2e appui : arrêter
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; let rec;
    try { rec = new R(); } catch (e) { keyboardDictation(ta); return; }
    activeRec = rec; let got = false; let started = false;
    rec.lang = dictLang() === 'ro' ? 'ro-RO' : 'fr-BE'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
    const stop = () => { clearTimeout(t1); clearTimeout(t2); btn.classList.remove('on'); if (activeRec === rec) activeRec = null; };
    // ne démarre pas (permission, réseau) ou ne finit jamais : on arrête et on propose le clavier
    const t1 = setTimeout(() => { if (!started) { try { rec.abort(); } catch (e) { /* */ } stop(); keyboardDictation(ta); } }, 4000);
    const t2 = setTimeout(() => { try { rec.stop(); } catch (e) { /* */ } setTimeout(() => { if (activeRec === rec) { try { rec.abort(); } catch (e) { /* */ } stop(); } }, 1500); }, 15000);
    rec.onstart = () => { started = true; btn.classList.add('on'); toast('Parlez… (touchez à nouveau 🎤 pour arrêter)', 4000); };
    rec.onaudiostart = () => { started = true; };
    rec.onresult = (e) => { got = true; onText(e.results[0][0].transcript); };
    rec.onerror = (e) => { stop(); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Le micro est refusé : autorisez-le dans les réglages du navigateur', 5000); keyboardDictation(ta); } else if (e.error !== 'aborted' && !got) toast('Je n\'ai pas entendu, réessayez', 2500); };
    rec.onend = () => stop();
    try { rec.start(); } catch (e) { stop(); keyboardDictation(ta); }
  };
}
const grow = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };

// ---------------------------------------------------------------- Accueil
// Brouillons vides (aucune ligne, pas de numéro) laissés par un ancien parcours abandonné : supprimés, jamais comptés
const realDoc = (x) => !!x.number && x.data.status !== 'brouillon' || (x.data.lines || []).some((l) => l.kind === 'item' && ((l.desc || '').trim() || num(l.price)));
async function purgeEmpty(list, typ) {
  const junk = list.filter((x) => !realDoc(x) && (x.data.status || 'brouillon') === 'brouillon' && !(x.data.payments || []).length && (x.data.simple || !x.data.clientId));
  for (const x of junk) { try { await db.del(typ, x.id); } catch (e) { /* déjà supprimé */ } }
  return list.filter((x) => !junk.includes(x) && !S.pendingDel.has(`${typ}:${x.id}`));
}
// suppressions en attente (6 s pour « Annuler ») : déjà masquées partout
S.pendingDel = S.pendingDel || new Set();
// Achats abandonnés avant d'avoir un montant ou un ticket (anciennes versions) : supprimés
async function purgeEmptyBuys(list) {
  const junk = list.filter((e) => e.data.simple && e.data.status === 'avalider' && !e.data.fileId && !num(e.data.ttc) && !num(e.data.amount));
  for (const x of junk) { try { await db.del('expense', x.id); } catch (err) { /* déjà supprimé */ } }
  return list.filter((x) => !junk.includes(x));
}
async function homeSimple() {
  const all = await db.many(['quote', 'invoice', 'project', 'expense']);
  all.expense = await purgeEmptyBuys(all.expense);
  all.invoice = await purgeEmpty(all.invoice, 'invoice'); all.quote = await purgeEmpty(all.quote, 'quote');
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
    ${peppolApOn() ? '' : `<a class="s-note" href="#/s/peppol">${I.send}<span><b>Factures électroniques (Peppol)</b> : pas encore activé</span><b>Activer</b></a>`}
    <div class="s-list">
      ${sBtn('data-go="#/s/liste/factures"', 'coins', 'Mes factures', `${all.invoice.length} facture(s)`)}
      ${sBtn('data-go="#/s/liste/devis"', 'calc', 'Mes devis', `${all.quote.length} devis`)}
      ${sBtn('data-go="#/s/liste/achats"', 'download', 'Mes achats', `${all.expense.length} achat(s)`)}
      ${sBtn('data-go="#/projects"', 'crane', 'Mes chantiers', `${all.project.filter((p) => !['termine', 'annule'].includes(p.data.status)).length} en cours`)}
      ${sBtn('data-go="#/contacts/client"', 'contacts', 'Mes clients')}
      ${sBtn('data-go="#/s/peppol"', 'send', 'Factures électroniques (Peppol)', peppolApOn() ? '✓ activé – envoyer et recevoir' : 'pas encore activé')}
      ${sBtn('data-go="#/s/moi"', 'gear', 'Mes informations', 'nom, adresse, TVA, banque, logo')}
    </div>`;
  $$('[data-go]', page).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  // factures fournisseurs reçues par Peppol : relevées en arrivant sur l'accueil (au plus toutes les 10 minutes)
  if (peppolApOn()) peppolSync().then((r) => { if (r && r.created.length && /^#\/(dashboard)?$/.test(location.hash || '#/')) render(); }).catch(() => {});
}

// ---------------------------------------------------------------- Facture / devis : parcours en 5 étapes
const DOC_STEPS = ['client', 'chantier', 'tva', 'travail', 'fini'];
async function docWizard(kind, id, step) {
  const typ = kind === 'devis' ? 'quote' : 'invoice'; const word = kind === 'devis' ? 'devis' : 'facture';
  // nouvelle pièce : rien n'est enregistré avant le choix du client (pas de brouillons vides si on revient en arrière)
  let it;
  if (id === 'new') {
    const co = company();
    const base = kind === 'devis'
      ? { status: 'brouillon', date: today(), valid: addDays(today(), num(co.quoteValidity) || 30), ownerId: S.me.id, lines: [], discount: 0, reverse: false, notes: co.quoteNotes || '', simple: true }
      : { kind: 'facture', status: 'brouillon', date: today(), due: addDays(today(), num(co.paymentDays) || 30), payDays: num(co.paymentDays) || 30, defaultVat: defVat(), ownerId: S.me.id, billSame: true, lines: [], payments: [], discount: 0, reverse: false, notes: co.invoiceNotes || '', simple: true };
    it = { project_id: null, data: base }; step = 'client';
  } else it = await db.get(typ, +id);
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
    page.innerHTML = `<p class="s-lead">Écrivez ou dites (🎤) le travail, la quantité et le prix.</p>
      <div class="s-lang"><span>Je parle :</span><button type="button" data-lang="fr">🇫🇷 Français</button><button type="button" data-lang="ro">🇷🇴 Română</button></div><div data-lines></div>
      <div class="s-row2"><button class="s-big" data-add>${I.plus} Ajouter une ligne</button><button class="s-big" data-lib>${I.book} Mes prix</button></div>
      <div class="s-total" data-tot></div>`;
    const box = $('[data-lines]', page);
    const drawTot = () => {
      const t = totals(d);
      $('[data-tot]', page).innerHTML = `<div><span>Sans TVA</span><b>${sMoney(t.base)}</b></div><div><span>${d.reverse ? 'TVA (autoliquidation)' : 'TVA'}</span><b>${sMoney(t.vat)}</b></div><div class="big"><span>Total ${kind === 'devis' ? 'du devis' : 'à payer'}</span><b>${sMoney(t.total)}</b></div>`;
    };
    // roumain : la ligne est traduite en français (après la dictée, ou en quittant le champ)
    const pend = new Set();
    const translate = (ta, l, text, append) => {
      const wrap = ta.closest('.s-desc'); wrap.classList.add('tr');
      const before = ta.value;
      const p = api('POST', 'ai/translate', { text }).then((r) => {
        ta.value = append ? (before ? before.trimEnd() + ' ' : '') + r.text : r.text; ta.dataset.fr = ta.value;
        l.desc = ta.value; grow(ta); later();
        undoToast('Traduit en français ✓', () => { ta.value = append ? (before ? before.trimEnd() + ' ' : '') + text : before; ta.dataset.fr = ta.value; l.desc = ta.value; grow(ta); later(); });
      }).catch((e) => { if (append) appendText(ta, text); toast(e.message || 'Traduction impossible', 4000); })
        .finally(() => { wrap.classList.remove('tr'); pend.delete(p); });
      pend.add(p); return p;
    };
    const drawLang = () => $$('[data-lang]', page).forEach((b) => b.classList.toggle('on', b.dataset.lang === dictLang()));
    $$('[data-lang]', page).forEach((b) => { b.onclick = () => {
      if (b.dataset.lang === 'ro' && !S.translate) { toast('La traduction demande l\'assistant IA (clé API à mettre par l\'administrateur de la plateforme)', 5000); return; }
      try { localStorage.setItem('bp-dict-lang', b.dataset.lang); } catch (e) { /* */ }
      drawLang(); if (b.dataset.lang === 'ro') toast('Vorbiți în română: traduc automat în franceză 🇫🇷', 3500);
    }; });
    drawLang();
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
        ta.dataset.fr = ta.value;
        micFor($('[data-mic]', row), ta, (t) => (dictLang() === 'ro' ? translate(ta, l, t, true) : appendText(ta, t)));
        ta.onchange = () => { if (dictLang() === 'ro' && ta.value.trim() && ta.value !== ta.dataset.fr) translate(ta, l, ta.value, false); };
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
      if (document.activeElement && document.activeElement.matches('.s-line textarea')) document.activeElement.blur();
      if (pend.size) { toast('Traduction en cours…', 2000); await Promise.allSettled([...pend]); }
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
  page.innerHTML = `<div class="s-done-h"><small>${kind === 'devis' ? 'Devis' : d.kind === 'avoir' ? `Note de crédit (annule la facture ${esc(d.refInvoice || '')})` : 'Facture'} pour</small><b>${esc(sName(client))}</b><span>${sMoney(t.total)} <small>avec TVA</small></span></div>
    <div class="s-actions" data-acts></div>
    <details class="s-preview" open><summary>Voir ${kind === 'devis' ? 'le devis' : 'la facture'}</summary><div class="s-doc" data-doc><p class="muted">Chargement…</p></div></details>
    <button class="s-big" data-edit>${I.edit} Modifier</button>`;
  $('[data-edit]', page).onclick = () => goStep('travail');
  docHtml(typ, it.id).then((r) => { const el = $('[data-doc]', page); if (el) el.innerHTML = r.html; }).catch((e) => { $('[data-doc]', page).innerHTML = `<p class="late">${esc(e.message)}</p>`; });
  const acts = $('[data-acts]', page);
  const peppolOk = typ === 'invoice' && buyerInfo(client).peppolId && buyerInfo(client).isCompany;
  if (typ === 'invoice') {
    acts.innerHTML = `<p class="s-lead">En validant, la facture reçoit son numéro et ne peut plus être changée.</p>
      ${sBtn('data-a="mail"', 'mail', 'Valider et envoyer par e-mail', client.data.email ? esc(client.data.email) : 'vous choisirez l\'adresse', 'primary')}
      ${peppolOk ? sBtn('data-a="peppol"', 'send', 'Valider et envoyer par Peppol', peppolApOn() ? 'facture électronique – conseillé pour une entreprise' : 'Peppol pas encore activé : on vous guide', 'primary') : `<p class="s-help">${client.data.company || client.data.vat ? 'Pour envoyer par Peppol, ajoutez le n° de TVA du client dans sa fiche.' : 'Client particulier : Peppol n\'est pas utilisé, envoyez par e-mail ou WhatsApp.'}</p>`}
      ${sBtn('data-a="share"', 'download', 'Valider et partager le PDF', 'WhatsApp, SMS, enregistrer…')}
      ${sBtn('data-a="later"', 'file', 'Garder pour plus tard', 'pas encore validée')}`;
    $$('[data-a]', acts).forEach((b) => { b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'later') { toast('Facture gardée (pas encore validée)', 2500); return go('#/dashboard'); }
      if (!await emitSimple(it, client)) return;
      if (a === 'mail') return go(`#/print/invoice/${it.id}?mail=1`);
      if (a === 'peppol') { if (!peppolApOn()) { toast('Activez d\'abord Peppol (2 minutes)', 4000); return go('#/s/peppol'); } go(`#/s/doc/facture/${it.id}`); return setTimeout(() => peppolInvoice(it), 700); }
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
  const cn = d.kind === 'avoir';
  if (!confirm(cn ? 'Valider la note de crédit ? Elle reçoit son numéro et annule la facture (ou la partie indiquée).' : it.number ? `Valider à nouveau la facture n° ${it.number} (même numéro) ?` : 'Valider la facture ? Elle reçoit son numéro et ne pourra plus être modifiée.')) return false;
  if (!it.number) { const r = await api('POST', `number/${cn ? 'avoir' : 'invoice'}`); it.number = r.number; }
  d.status = 'emise'; d.emittedAt = d.emittedAt || today();
  if (d.reopened) { d.reopened.revalidatedAt = new Date().toISOString(); }
  if (!cn && !d.communication && company().country !== 'FR') d.communication = structComm(it.number.replace(/\D/g, ''));
  await persist('invoice', it, { silent: true });
  // note de crédit : la facture annulée est soldée (« payée » par la note de crédit)
  if (cn && d.refInvoiceId) {
    try {
      const orig = await db.get('invoice', +d.refInvoiceId); const st = invState(orig);
      const amt = Math.min(st.rest, Math.abs(totals(d).total));
      if (amt > 0.005) { orig.data.payments = [...(orig.data.payments || []), { date: today(), amount: r2(amt), method: 'Note de crédit', note: `Note de crédit ${it.number}` }]; }
      const sumCn = (await db.list('invoice')).filter((x) => x.data.kind === 'avoir' && x.data.status === 'emise' && +x.data.refInvoiceId === orig.id).reduce((sum, x) => sum + Math.abs(totals(x.data).total), 0);
      if (sumCn >= totals(orig.data).total - 0.01) orig.data.creditedBy = it.id;
      else orig.data.creditNotes = [...new Set([...(orig.data.creditNotes || []), it.id])];
      await persist('invoice', orig, { silent: true });
    } catch (e) { /* facture d'origine supprimée */ }
  }
  toast(`${cn ? 'Note de crédit' : 'Facture'} n° ${it.number} validée ✓`, 2500);
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
    $('[data-none]', page).onclick = () => go('#/s/achat/new/chantier'); // rien n'est créé avant « Enregistrer »
    return;
  }
  const e = id === 'new' ? { project_id: S.buyDraftPid || null, data: { date: today(), category: 'mat', source: 'manuel', status: 'avalider', simple: true } } : await db.get('expense', +id); const d = e.data;
  const eid = e.id || 'new';
  if (step === 'chantier') {
    const page = sPage('Pour quel chantier ?', `#/s/achat`, { wiz: true, step: [2, 3] });
    const projects = (await db.list('project')).filter((p) => !['termine', 'annule'].includes(p.data.status)).sort((a, b) => b.id - a.id);
    page.innerHTML = `<p class="s-lead">Choisissez où ce matériel sera utilisé.</p>
      <div class="s-list">${projects.map((p) => sBtn(`data-p="${p.id}"`, 'crane', esc(p.data.name), esc([p.data.address, p.data.city].filter(Boolean).join(', ')), e.project_id === p.id ? 'sel' : '')).join('')}</div>
      <button class="s-big" data-p="0">${I.gear} Pour l'entreprise (pas de chantier)</button>`;
    $$('[data-p]', page).forEach((b) => { b.onclick = async () => { e.project_id = +b.dataset.p || null; delete d.alloc; if (e.id) await persist('expense', e, { silent: true }); else S.buyDraftPid = e.project_id; go(`#/s/achat/${eid}/montant`); }; });
    return;
  }
  // montant : vérifier ce qui a été lu
  const page = sPage('Vérifiez', `#/s/achat/${eid}/chantier`, { wiz: true, step: [3, 3] });
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
    await persist('expense', e, { silent: true }); S.buyDraftPid = null;
    const page2 = sPage('C\'est noté !', '#/dashboard', { wiz: true });
    page2.innerHTML = `<div class="s-ok">${I.check}<b>Achat enregistré</b><span>${sMoney(total)}${e.project_id ? ' · sur le chantier' : ''}</span></div>
      <button class="s-big primary" data-again>${I.camera} Encore un achat</button><button class="s-big" data-home>${I.dash} Retour à l'accueil</button>`;
    $('[data-again]', page2).onclick = () => go('#/s/achat');
    $('[data-home]', page2).onclick = () => go('#/dashboard');
  }, 'Enregistrer', () => go(`#/s/achat/${eid}/chantier`));
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
const S_INV_ST = { brouillon: ['Pas encore envoyée', '#868e96'], impayee: ['Pas encore payée', '#f08c00'], partielle: ['Payée en partie', '#0c8599'], retard: ['En retard !', '#e5484d'], payee: ['Payée ✓', '#2f9e44'], avoir: ['Note de crédit', '#7048e8'], annulee: ['Annulée (note de crédit)', '#7048e8'] };
const S_Q_ST = { brouillon: ['Pas encore envoyé', '#868e96'], envoye: ['Attend la réponse', '#f08c00'], accepte: ['Accepté ✓', '#2f9e44'], refuse: ['Refusé', '#e5484d'], annule: ['Annulé', '#adb5bd'] };
async function listSimple(kind) {
  const f = new URLSearchParams(location.hash.split('?')[1] || '').get('f') || '';
  const contacts = await db.list('contact');
  if (kind === 'achats') {
    const [rows0, projects] = await Promise.all([db.list('expense'), db.list('project')]);
    const rows = await purgeEmptyBuys(rows0);
    const page = sPage('Mes achats', '#/dashboard');
    rows.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
    page.innerHTML = `<button class="s-big primary" data-new>${I.camera} J'ai acheté quelque chose</button>
      ${peppolApOn() ? `<button class="s-big" data-sync>${I.download} Recevoir mes factures Peppol</button>` : `<a class="s-note" href="#/s/peppol">${I.send}<span>Recevoir les factures des fournisseurs par <b>Peppol</b></span><b>Activer</b></a>`}
      <div class="s-cards">${rows.map((e) => { const stt = purchState(e); const p = byId(projects, e.project_id);
        return `<a class="s-card" href="#/s/achat/${e.id}/montant"><span class="s-ct"><b>${esc(sName(byId(contacts, e.data.supplierId)) !== '—' ? sName(byId(contacts, e.data.supplierId)) : e.data.desc || 'Achat')}</b><small>${e.data.source === 'peppol' || e.data.peppol ? '📥 Peppol · ' : ''}${fmtDate(e.data.date)}${p ? ` · ${esc(p.data.name)}` : ''}</small></span>
          <span class="s-ca"><b>${sMoney(purchTtc(e.data))}</b>${stt === 'avalider' ? '<em class="warn">À vérifier</em>' : stt === 'payee' ? '<em class="ok">Payé</em>' : '<em class="late">À payer</em>'}</span></a>`; }).join('') || '<p class="muted s-empty">Aucun achat pour l\'instant.</p>'}</div>`;
    $('[data-new]', page).onclick = () => go('#/s/achat');
    const sy = $('[data-sync]', page); if (sy) sy.onclick = async () => { sy.disabled = true; const r = await peppolSync({ force: true, quiet: false }); sy.disabled = false; if (r && r.created.length) render(); else if (r) toast('Aucune nouvelle facture', 2500); };
    return;
  }
  const isInv = kind === 'factures'; const typ = isInv ? 'invoice' : 'quote';
  const rows = await purgeEmpty(await db.list(typ), typ);
  const ST = isInv ? S_INV_ST : S_Q_ST;
  const stOf = (x) => (isInv ? (x.data.creditedBy && x.data.status === 'emise' ? 'annulee' : invState(x).s) : x.data.status || 'brouillon');
  const filters = isInv ? [['', 'Toutes'], ['apayer', 'Pas payées'], ['brouillon', 'Pas envoyées'], ['payee', 'Payées']] : [['', 'Tous'], ['envoye', 'En attente'], ['accepte', 'Acceptés'], ['brouillon', 'Pas envoyés']];
  const match = (x) => { const s = stOf(x); return !f || (f === 'apayer' ? ['impayee', 'partielle', 'retard'].includes(s) : s === f); };
  const page = sPage(isInv ? 'Mes factures' : 'Mes devis', '#/dashboard');
  rows.sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
  page.innerHTML = `<button class="s-big primary" data-new>${I.plus} ${isInv ? 'Faire une facture' : 'Faire un devis'}</button>
    ${isInv ? `<a class="s-note" href="#/s/avoir">${I.copy}<span>Annuler ou corriger une facture : <b>note de crédit</b></span><b>${I.chevron}</b></a>` : ''}
    <div class="s-chips s-filter">${filters.map(([k, l]) => `<a href="#/s/liste/${kind}${k ? '?f=' + k : ''}" class="${f === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="s-cards">${rows.filter(match).map((x) => { const s = stOf(x); const t = totals(x.data); const rest = isInv ? invState(x).rest : 0;
      const card = `<a class="s-card" href="#/s/doc/${isInv ? 'facture' : 'devis'}/${x.id}"><span class="s-ct"><b>${esc(sName(byId(contacts, x.data.clientId)))}</b><small>${esc(isInv && s === 'brouillon' ? 'Brouillon' : x.number || 'Brouillon')} · ${fmtDate(x.data.date)}${x.data.title ? ` · ${esc(x.data.title)}` : ''}</small></span>
        <span class="s-ca"><b>${sMoney(isInv && ['impayee', 'partielle', 'retard'].includes(s) ? rest : t.total)}</b><em style="--c:${(ST[s] || ['', '#868e96'])[1]}">${esc((ST[s] || [s])[0])}</em></span></a>`;
      // brouillon : modifier ou supprimer directement depuis la liste
      return (isInv ? x.data.status !== 'emise' : s === 'brouillon') ? `<div class="s-cardw" data-w="${x.id}">${card}<div class="s-cardacts"><a href="#/s/${isInv ? 'facture' : 'devis'}/${x.id}/travail">${I.edit} Modifier</a><button type="button" data-del="${x.id}">${I.trash} Supprimer</button></div></div>` : card; }).join('') || `<p class="muted s-empty">Rien ici pour l'instant.</p>`}</div>`;
  $('[data-new]', page).onclick = () => go(`#/s/${isInv ? 'facture' : 'devis'}/new`);
  $$('[data-del]', page).forEach((b) => { b.onclick = () => sDeleteDraft(typ, rows.find((x) => x.id === +b.dataset.del), b.closest('.s-cardw')); });
}

// Supprimer un brouillon : disparaît tout de suite, « Annuler » pendant 6 secondes, puis suppression définitive
function sDeleteDraft(typ, x, el, after) {
  if (!x) return;
  const word = typ === 'invoice' ? (x.data.kind === 'avoir' ? 'Note de crédit' : 'Facture') : 'Devis';
  const what = x.number ? `${word} n° ${x.number} supprimé${typ === 'invoice' ? 'e' : ''}` : `${word} brouillon supprimé${typ === 'invoice' ? 'e' : ''}`;
  const key = `${typ}:${x.id}`; S.pendingDel.add(key);
  if (el) el.hidden = true;
  let undone = false;
  const tm = setTimeout(async () => { if (undone) return; try { await db.del(typ, x.id); } catch (e) { toast('Suppression impossible : ' + e.message, 4000); if (el) el.hidden = false; } S.pendingDel.delete(key); }, 6000);
  undoToast(what, () => { undone = true; clearTimeout(tm); S.pendingDel.delete(key); if (el) el.hidden = false; else render(); });
  if (after) after();
}

// ---------------------------------------------------------------- Une facture / un devis : grands boutons d'action
async function docSimple(kind, id) {
  const typ = kind === 'devis' ? 'quote' : 'invoice';
  const it = await db.get(typ, +id); const d = it.data;
  const contacts = await db.list('contact'); const c = byId(contacts, d.clientId);
  const page = sPage(`${kind === 'devis' ? 'Devis' : d.kind === 'avoir' ? 'Note de crédit' : 'Facture'} ${it.number || '(brouillon)'}`, `#/s/liste/${kind === 'devis' ? 'devis' : 'factures'}`);
  const t = totals(d);
  const st = typ === 'invoice' ? invState(it) : null; const s = st ? (d.creditedBy && d.status === 'emise' ? 'annulee' : st.s) : d.status || 'brouillon';
  const ST = typ === 'invoice' ? S_INV_ST : S_Q_ST;
  const draft = typ === 'invoice' ? d.status !== 'emise' : d.status === 'brouillon';
  page.innerHTML = `<div class="s-done-h"><small>${esc(sName(c))}${d.title ? ` · ${esc(d.title)}` : ''}</small><b style="color:${(ST[s] || ['', '#333'])[1]}">${esc((ST[s] || [s])[0])}</b><span>${sMoney(st && st.rest > 0.005 && s !== 'brouillon' ? st.rest : t.total)} <small>${st && st.paid > 0.005 && st.rest > 0.005 ? `reste à payer (sur ${sMoney(t.total)})` : 'avec TVA'}</small></span></div>
    ${d.reopened && draft ? `<div class="s-warn">⚠ Facture n° ${esc(it.number || '')} rouverte le ${fmtDate(d.reopened.at)} : pensez à prévenir votre comptable et le client.</div>` : ''}
    ${d.creditedBy ? `<a class="s-info" href="#/s/doc/facture/${d.creditedBy}">Annulée par une note de crédit ${I.chevron}</a>` : ''}
    ${(d.creditNotes || []).map((n) => `<a class="s-info" href="#/s/doc/facture/${n}">Note de crédit partielle ${I.chevron}</a>`).join('')}
    ${d.kind === 'avoir' && d.refInvoiceId ? `<a class="s-info" href="#/s/doc/facture/${d.refInvoiceId}">Annule la facture ${esc(d.refInvoice || '')} ${I.chevron}</a>` : ''}
    <div class="s-actions" data-acts></div>
    ${typ === 'invoice' && (d.payments || []).length ? `<div class="s-pays"><b>Paiements reçus</b>${d.payments.map((p, i) => `<div class="s-pay"><span>${fmtDate(p.date)} · ${esc(p.method || '')}${p.note ? ` · ${esc(p.note)}` : ''}</span><b>${sMoney(p.amount)}</b><button type="button" data-pdel="${i}" aria-label="Supprimer ce paiement">${I.trash}</button></div>`).join('')}</div>` : ''}
    <details class="s-preview"><summary>Voir ${kind === 'devis' ? 'le devis' : 'la facture'}</summary><div class="s-doc" data-doc></div></details>
    ${!draft ? `<div class="s-list s-danger-zone">${typ === 'invoice' ? sBtn('data-a="fix"', 'edit', `Modifier ou supprimer cette ${d.kind === 'avoir' ? 'note de crédit' : 'facture'}`, 'elle est validée : on vous explique les règles') : sBtn('data-a="qedit"', 'edit', 'Modifier ce devis', '') + sBtn('data-a="qdel"', 'trash', 'Supprimer ce devis', '', 'danger')}</div>` : ''}
    ${d.correctionId && !draft ? sBtn('data-a="corr"', 'edit', 'Voir la facture corrigée', 'préparée avec la note de crédit', 'primary') : ''}`;
  const acts = [];
  if (draft) acts.push(['edit', 'edit', kind === 'devis' ? 'Continuer le devis' : 'Continuer la facture', 'ajouter, modifier, puis envoyer', 'primary']);
  if (typ === 'invoice' && ['impayee', 'partielle', 'retard'].includes(s)) acts.push(['pay', 'check', 'On m\'a payé', 'enregistrer le paiement', 'primary']);
  if (!(typ === 'invoice' && draft)) {
    acts.push(['mail', 'mail', 'Envoyer par e-mail', c && c.data.email ? esc(c.data.email) : '']);
    acts.push(['share', 'download', 'Partager le PDF', 'WhatsApp, SMS, enregistrer…']);
  }
  if (typ === 'invoice' && !draft && c && buyerInfo(c).peppolId && buyerInfo(c).isCompany) acts.push(['peppol', 'send', 'Envoyer par Peppol', d.peppol && d.peppol.sentAt ? `✓ déjà envoyée le ${fmtDate(d.peppol.sentAt)}` : peppolApOn() ? 'facture électronique (entreprise)' : 'Peppol pas encore activé', d.peppol && d.peppol.sentAt ? '' : 'primary']);
  if (typ === 'quote' && ['envoye', 'brouillon'].includes(d.status)) { acts.push(['yes', 'check', 'Le client a dit oui', 'je fais la facture', d.status === 'envoye' ? 'primary' : '']); acts.push(['no', 'x', 'Le client a dit non', '']); }
  if (typ === 'quote' && d.status === 'accepte') acts.push(['bill', 'coins', 'Faire la facture', 'tout le devis ou un acompte', 'primary']);
  if (typ === 'invoice' && !draft && d.kind !== 'avoir' && !d.creditedBy) acts.push(['credit', 'copy', 'Faire une note de crédit', 'annuler toute la facture ou une partie']);
  acts.push(['pdf', 'eye', 'Voir en grand / imprimer', '']);
  if (draft) acts.push(['del', 'trash', kind === 'devis' ? 'Supprimer ce devis' : 'Supprimer ce brouillon', 'il n\'a pas encore été envoyé', 'danger']);
  $('[data-acts]', page).innerHTML = acts.map(([k, ic, l, sub, cls]) => sBtn(`data-a="${k}"`, ic, l, sub, cls || '')).join('');
  // supprimer un paiement enregistré par erreur
  $$('[data-pdel]', page).forEach((b) => { b.onclick = async () => {
    const i = +b.dataset.pdel; const p = d.payments[i];
    if (!confirm(`Supprimer le paiement de ${sMoney(p.amount)} du ${fmtDate(p.date)} ?\n\nAttention : si la facture est déjà chez votre comptable, il a peut-être déjà encodé ce paiement (banque). Prévenez-le.`)) return;
    d.payments.splice(i, 1); await persist(typ, it, { silent: true }); render();
    undoToast('Paiement supprimé', async () => { d.payments.splice(i, 0, p); await persist(typ, it, { silent: true }); render(); });
  }; });
  $('details', page).addEventListener('toggle', (e) => { if (e.target.open && !$('[data-doc] .doc', page)) docHtml(typ, it.id).then((r) => { $('[data-doc]', page).innerHTML = r.html; }); });
  $$('[data-a]', page).forEach((b) => { b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'edit') return go(`#/s/${kind}/${it.id}/travail`);
    if (a === 'fix') return validatedInvoiceChange(it, c);
    if (a === 'credit') return go(`#/s/avoir/${it.id}`);
    if (a === 'corr') return go(`#/s/doc/facture/${d.correctionId}`);
    if (a === 'qedit') { if (d.status === 'accepte' && !confirm('Ce devis est accepté par le client. Le modifier quand même ? (Prévenez le client.)')) return; return go(`#/s/devis/${it.id}/travail`); }
    if (a === 'qdel') { const inv = (await db.list('invoice')).filter((x) => +x.data.quoteId === it.id); if (!confirm(inv.length ? `Ce devis a ${inv.length} facture(s). Supprimer quand même le devis ? (les factures restent)` : 'Supprimer ce devis ?')) return; return sDeleteDraft('quote', it, null, () => go('#/s/liste/devis')); }
    if (a === 'del') return sDeleteDraft(typ, it, null, () => go(`#/s/liste/${kind === 'devis' ? 'devis' : 'factures'}`));
    if (a === 'pay') return go(`#/s/paye/${it.id}`);
    if (a === 'mail') return go(`#/print/${typ}/${it.id}?mail=1`);
    if (a === 'pdf') return go(`#/print/${typ}/${it.id}`);
    if (a === 'peppol') return peppolApOn() ? peppolInvoice(it) : go('#/s/peppol');
    if (a === 'share') { if (typ === 'quote' && d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); await persist('quote', it, { silent: true }); } return sharePdfOf(typ, it.id); }
    if (a === 'no') { d.status = 'refuse'; await persist('quote', it, { silent: true }); return render(); }
    if (a === 'yes') { d.status = 'accepte'; d.acceptedAt = today(); await persist('quote', it, { silent: true }); }
    if (a === 'yes' || a === 'bill') return billQuote(it);
  }; });
}
// Facture validée : modifier ou supprimer → avertissement (règles belges) et choix
function validatedInvoiceChange(it, c) {
  const d = it.data; const st = invState(it); const cn = d.kind === 'avoir';
  const sentMail = (d.sent || []).length; const sentPep = d.peppol && d.peppol.sentAt;
  const facts = [
    `Elle a le n° <b>${esc(it.number)}</b>${d.emittedAt ? ` (validée le ${fmtDate(d.emittedAt)})` : ''}.`,
    sentPep ? `Elle a été <b>envoyée par Peppol</b> le ${fmtDate(sentPep)} : elle est déjà chez le client et ne peut pas être reprise.` : sentMail ? `Elle a été <b>envoyée au client</b> par e-mail.` : '',
    st.paid > 0.005 ? `Le client a déjà payé <b>${sMoney(st.paid)}</b>.` : '',
  ].filter(Boolean);
  const m = modal(`${mhead(cn ? '⚠ Attention : note de crédit validée' : '⚠ Attention : facture validée')}<div class="m-body s-legal">
    <ul>${facts.map((f) => `<li>${f}</li>`).join('')}</ul>
    <p><b>En Belgique, une facture validée ne doit plus être changée ni supprimée.</b> Son contenu doit rester intact pendant toute la durée de conservation, et les numéros doivent se suivre sans trou.</p>
    <p>La bonne façon de corriger : faire une <b>note de crédit</b> (elle annule la facture), puis une <b>nouvelle facture</b> correcte.</p>
    <p class="s-acc">📒 <b>Votre comptable</b> a peut-être déjà encodé cette facture. Vérifiez avec lui avant de la changer.</p>
    <div class="s-list">
      ${cn ? '' : sBtn('data-c="credit"', 'check', 'Annuler avec une note de crédit', 'conseillé – puis refaire la facture correcte', 'primary')}
      ${sBtn('data-c="keep"', 'x', 'Ne rien changer', '')}
    </div>
    <details class="s-more"><summary>Je veux quand même modifier ou supprimer</summary>
      <label class="s-chk"><input type="checkbox" data-ok> Je comprends le risque et je préviens mon comptable (et le client).</label>
      <div class="s-list">${sBtn('data-c="edit" disabled', 'edit', 'Modifier quand même', 'garde le même numéro', 'danger')}${sBtn('data-c="del" disabled', 'trash', 'Supprimer quand même', 'le numéro manquera dans la suite', 'danger')}</div>
    </details></div>`);
  const ok = $('[data-ok]', m.el);
  ok.onchange = () => { $$('[data-c="edit"],[data-c="del"]', m.el).forEach((b) => { b.disabled = !ok.checked; }); };
  $$('[data-c]', m.el).forEach((b) => { b.onclick = async () => {
    const k = b.dataset.c; if (b.disabled) return;
    if (k === 'keep') return m.close();
    if (k === 'credit') {
      m.close(); return makeCreditNote(it, { redo: true });
    }
    if (k === 'edit') {
      d.reopened = { at: new Date().toISOString(), by: S.me.id, payments: (d.payments || []).length };
      d.status = 'brouillon'; await persist('invoice', it, { silent: true }); m.close();
      return go(`#/s/facture/${it.id}/travail`);
    }
    if (k === 'del') {
      if (!confirm(`Supprimer définitivement la facture n° ${it.number}${st.paid > 0.005 ? ' et ses paiements' : ''} ?`)) return;
      m.close();
      // note de crédit supprimée : la facture d'origine n'est plus soldée par elle
      if (cn && d.refInvoiceId) { try { const o = await db.get('invoice', +d.refInvoiceId); o.data.payments = (o.data.payments || []).filter((p) => p.note !== `Note de crédit ${it.number}`); o.data.creditedBy = null; await persist('invoice', o, { silent: true }); } catch (e) { /* facture d'origine supprimée */ } }
      return sDeleteDraft('invoice', it, null, () => go('#/s/liste/factures'));
    }
  }; });
}

// Note de crédit : toute la facture (lignes en négatif) ou un montant TVAC réparti par taux de TVA
async function makeCreditNote(it, { amount = 0, reason = '', redo = false } = {}) {
  const d = it.data; const base = { kind: 'avoir', status: 'brouillon', clientId: d.clientId, date: today(), reverse: d.reverse, defaultVat: d.defaultVat, refInvoice: it.number, refInvoiceId: it.id, ownerId: S.me.id, payments: [], simple: true };
  let data;
  if (!amount) {
    data = { ...base, discount: d.discount, title: d.title || `Annulation facture ${it.number}`, lines: (d.lines || []).map((l) => (l.kind === 'item' ? { ...l, id: lid(), qty: -num(l.qty) } : { ...l, id: lid() })) };
  } else {
    const t = totals(d); const label = reason || 'Réduction';
    data = { ...base, title: d.title || `${label} – facture ${it.number}`, lines: t.vats.map((v) => { const ttc = amount * ((v.base + v.vat) / t.total); return { id: lid(), kind: 'item', desc: `${label} sur la facture ${it.number}${t.vats.length > 1 ? ` (partie TVA ${v.rate} %)` : ''}`, unit: 'forfait', qty: -1, price: r2(d.reverse ? ttc : ttc / (1 + v.rate / 100)), vat: v.rate }; }) };
  }
  if (redo) {
    const correction = await persist('invoice', { project_id: it.project_id, data: { ...JSON.parse(JSON.stringify(d)), status: 'brouillon', emittedAt: null, payments: [], sent: [], peppol: null, communication: '', date: today(), due: addDays(today(), num(d.payDays) || 30), simple: true, creditedBy: null, creditNotes: [], reopened: null } });
    data.correctionId = correction.id;
  }
  const cn = await persist('invoice', { project_id: it.project_id, data });
  toast('Note de crédit prête : vérifiez et validez-la', 4000);
  return go(`#/s/facture/${cn.id}/fini`);
}
// Assistant « Note de crédit » : choisir la facture, puis tout ou une partie
async function creditWizard(id) {
  const [invoices, contacts] = await Promise.all([db.list('invoice'), db.list('contact')]);
  const credited = (inv) => r2(invoices.filter((x) => x.data.kind === 'avoir' && +x.data.refInvoiceId === inv.id).reduce((sum, x) => sum + Math.abs(totals(x.data).total), 0));
  if (!id) {
    const page = sPage('Note de crédit', '#/s/liste/factures', { wiz: true });
    const ok = invoices.filter((x) => x.data.status === 'emise' && x.data.kind !== 'avoir' && !x.data.creditedBy).sort((a, b) => (b.data.date || '').localeCompare(a.data.date || '') || b.id - a.id);
    page.innerHTML = `<p class="s-lead">Une note de crédit <b>annule une facture</b> (toute ou une partie) : erreur, remise, travail pas fait… Elle reçoit son propre numéro.</p>
      ${ok.length ? `<p class="s-lead">Touchez la facture à corriger :</p><div class="s-list">${ok.map((x) => sBtn(`data-i="${x.id}"`, 'coins', `${esc(sName(byId(contacts, x.data.clientId)))} – ${sMoney(totals(x.data).total)}`, `Facture ${esc(x.number || '')} du ${fmtDate(x.data.date)}`)).join('')}</div>` : `<div class="s-ok">${I.check}<b>Aucune facture validée</b><span>Une note de crédit se fait toujours sur une facture déjà validée.</span></div>`}`;
    $$('[data-i]', page).forEach((b) => { b.onclick = () => go(`#/s/avoir/${b.dataset.i}`); });
    return;
  }
  const it = invoices.find((x) => x.id === +id); if (!it || it.data.status !== 'emise' || it.data.kind === 'avoir') return go('#/s/avoir');
  const d = it.data; const c = byId(contacts, d.clientId); const total = totals(d).total; const done = credited(it); const max = r2(total - done);
  const page = sPage('Note de crédit', '#/s/avoir', { wiz: true });
  let reason = '';
  page.innerHTML = `<div class="s-done-h"><small>${esc(sName(c))} · facture ${esc(it.number || '')}</small><b>Montant de la facture</b><span>${sMoney(total)} <small>avec TVA</small></span></div>
    ${done > 0.005 ? `<div class="s-warn">Déjà ${sMoney(done)} en note(s) de crédit sur cette facture. Il reste au maximum ${sMoney(max)}.</div>` : ''}
    ${max > 0.005 ? `<button class="s-big primary" data-all>${I.x} Annuler toute la facture (${sMoney(max)})</button>
    <label class="s-chk"><input type="checkbox" data-redo> Refaire ensuite une facture correcte (copie à modifier)</label>
    <p class="s-lead">ou <b>une partie seulement</b> :</p>
    <label class="field s-amount"><span>Montant à déduire (avec TVA)</span><input name="amt" inputmode="decimal" placeholder="0,00"><em>€</em></label>
    <p class="s-help" data-vat></p>
    <div class="field"><span>Pourquoi ?</span><div class="s-chips">${['Erreur de prix', 'Remise', 'Travail pas fait', 'Matériel repris', 'Geste commercial'].map((x) => `<button type="button" data-r="${x}">${x}</button>`).join('')}</div></div>
    <button class="s-big" data-part>${I.check} Faire la note de crédit</button>` : `<div class="s-ok">${I.check}<b>Facture déjà entièrement annulée</b></div>`}`;
  if (max <= 0.005) return;
  const amt = $('[name=amt]', page);
  amt.oninput = () => { const v = num(amt.value.replace(',', '.')); const t = totals(d);
    $('[data-vat]', page).textContent = v > 0 && !d.reverse ? `dont TVA : ${sMoney(r2(t.vats.reduce((sum, x) => { const ttc = v * ((x.base + x.vat) / t.total); return sum + ttc - ttc / (1 + x.rate / 100); }, 0)))}` : ''; };
  $$('[data-r]', page).forEach((b) => { b.onclick = () => { reason = reason === b.dataset.r ? '' : b.dataset.r; $$('[data-r]', page).forEach((x) => x.classList.toggle('on', x.dataset.r === reason)); }; });
  $('[data-all]', page).onclick = () => (done > 0.005 ? makeCreditNote(it, { amount: max, reason: 'Annulation du solde' }) : makeCreditNote(it, { redo: $('[data-redo]', page).checked }));
  $('[data-part]', page).onclick = () => {
    const v = r2(num(amt.value.replace(',', '.')));
    if (!(v > 0)) { toast('Indiquez le montant à déduire', 3000); return amt.focus(); }
    if (v - max > 0.01) { toast(`C'est plus que le maximum (${sMoney(max)})`, 4000); return; }
    return makeCreditNote(it, { amount: v, reason });
  };
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
    <a class="s-note" href="#/s/peppol">${I.send}<span><b>Factures électroniques (Peppol)</b> : ${peppolApOn() ? '✓ activé' : 'pas encore activé'}</span><b>${peppolApOn() ? 'Voir' : 'Activer'}</b></a>
    <p class="s-help">Plus de réglages (TVA, numéros, modèle, e-mail) : <a href="#/settings/company">réglages avancés</a>.</p>`;
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

// ---------------------------------------------------------------- Peppol : factures électroniques (envoyer et recevoir)
async function peppolSimple() {
  const page = sPage('Factures électroniques (Peppol)', '#/dashboard');
  const on = peppolApOn(); const s = sellerInfo(); const last = S.settings.peppol_sync && S.settings.peppol_sync.at;
  page.innerHTML = `<div class="s-pep ${on ? 'on' : ''}">${on ? I.check : I.send}<b>${on ? 'Peppol est activé' : 'Peppol n\'est pas encore activé'}</b>
      <span>${on ? 'Vos factures partent et arrivent toutes seules.' : 'Depuis 2026, les factures entre entreprises belges passent par Peppol.'}</span></div>
    ${on ? `<button class="s-big primary" data-sync>${I.download} Relever mes factures maintenant</button>
      <p class="s-help">${last ? `Dernière relève : ${fmtDT(last)}. ` : ''}Les factures reçues arrivent dans <a href="#/s/liste/achats">Mes achats</a>, marquées « À vérifier ».</p>
      <div class="s-list">${sBtn('data-look', 'search', 'Vérifier mon inscription', esc(s.peppolId || 'identifiant Peppol'))}${sBtn('data-adv', 'gear', 'Réglages détaillés', 'clé, environnement, relève automatique')}</div>`
    : `<p class="s-lead">C'est simple et gratuit pour une petite entreprise :</p>
      <ol class="s-how">
        <li><b>Créez votre compte gratuit</b> chez Peppyrus et inscrivez votre entreprise.<a class="s-big" href="https://www.peppyrus.be" target="_blank" rel="noopener">${I.send} Ouvrir peppyrus.be</a></li>
        <li><b>Dans Peppyrus, créez une « clé API »</b> et copiez-la.</li>
        <li><b>Collez la clé ici</b> puis touchez « Activer ».
          <form class="s-form" data-ap autocomplete="off" onsubmit="return false"><label class="field"><span>Clé API Peppyrus</span><input name="key" type="password" placeholder="collez la clé ici"></label></form>
          <button class="s-big primary" data-on>${I.check} Activer Peppol</button></li>
      </ol>
      <p class="s-help">Déjà inscrit ailleurs (Vertuoza, comptable…) ? Demandez-leur de « libérer votre identifiant Peppol », puis activez-le chez Peppyrus.</p>`}
    <div data-res></div>
    <div class="s-card-info"><b>Comment ça marche ?</b>
      <p>📤 <b>Envoyer</b> : quand vous faites une facture pour une <b>entreprise</b> (avec un n° de TVA), le bouton « Envoyer par Peppol » apparaît à la fin.</p>
      <p>📥 <b>Recevoir</b> : les factures de vos fournisseurs arrivent toutes seules dans « Mes achats » avec leur PDF.</p>
      <p>👤 Pour un <b>particulier</b>, Peppol n'est pas utilisé : envoyez la facture par e-mail ou WhatsApp.</p></div>`;
  const sync = $('[data-sync]', page);
  if (sync) sync.onclick = async () => { sync.disabled = true; const r = await peppolSync({ force: true, quiet: false }); sync.disabled = false; if (r) toast(r.created.length ? `${r.created.length} facture(s) reçue(s) → Mes achats` : 'Aucune nouvelle facture', 3500); };
  const look = $('[data-look]', page); if (look) look.onclick = () => { if (!s.peppolId) return toast('Ajoutez d\'abord votre n° de TVA dans Mes informations', 4000); peppolLookupInto($('[data-res]', page), s.peppolId); };
  const adv = $('[data-adv]', page); if (adv) adv.onclick = () => go('#/settings/peppol');
  const act = $('[data-on]', page);
  if (act) act.onclick = async () => {
    const key = $('[name=key]', page).value.trim(); if (!key) { toast('Collez d\'abord la clé API', 3000); return; }
    act.disabled = true;
    try {
      await api('PUT', 'settings', { peppolap: { provider: 'peppyrus', env: 'prod', key } });
      S.settings.peppolap = { provider: 'peppyrus', env: 'prod', hasKey: true };
      // identifiant Peppol déduit du n° de TVA de l'entreprise
      const co = { ...company() }; if (!co.peppolId && sellerInfo().peppolId) { co.peppolId = sellerInfo().peppolId; await api('PUT', 'settings', { company: co }); S.settings.company = co; }
      try { await api('POST', 'peppol/test'); toast('Peppol activé ✓', 3000); } catch (e) { toast(`Clé enregistrée, mais la connexion a échoué : ${e.message}`, 7000); }
      render();
    } finally { act.disabled = false; }
  };
}

// ---------------------------------------------------------------- Aiguillage #/s/…
route('s', async (screen, a, b) => {
  if (screen === 'facture' || screen === 'devis') return docWizard(screen, a, b);
  if (screen === 'achat') return buyWizard(a, b || (a ? 'montant' : ''));
  if (screen === 'paye') return paidWizard(a);
  if (screen === 'avoir') return creditWizard(a);
  if (screen === 'liste') return listSimple(a || 'factures');
  if (screen === 'doc') return docSimple(a, b);
  if (screen === 'moi') return meSimple();
  if (screen === 'peppol') return peppolSimple();
  return go('#/dashboard');
});
