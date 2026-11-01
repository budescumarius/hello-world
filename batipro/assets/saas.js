'use strict';
/* Abonnements : inscription avec essai gratuit, bandeau d'essai, « Mon abonnement » (formule, paiement Mollie,
   factures, résiliation, export des données) et réglages de la vente en ligne pour le gestionnaire de la plateforme. */

const SUB_ST = { trial: ['Essai gratuit', '#3b5bdb'], active: ['Actif', '#2f9e44'], past_due: ['Paiement en retard', '#e8590c'], canceled: ['Résilié', '#868e96'], free: ['Sans abonnement', '#868e96'] };
const perLabel = (p) => (p === 'year' ? 'an' : 'mois');
const eur = (x) => money(num(x));

// ---------------------------------------------------------------- Inscription (avant connexion)
async function showSignup(pub) {
  closeModals();
  if (!pub) { try { pub = await api('GET', 'signup'); } catch (e) { pub = null; } }
  if (!pub || !pub.enabled) { location.hash = ''; return showLogin('Les inscriptions ne sont pas ouvertes.'); }
  let period = 'month'; let plan = (pub.plans[1] || pub.plans[0]).id;
  app.innerHTML = `<div class="login signup"><form class="login-box su-box" novalidate>
    <div class="brand big"><span class="brand-mark"></span><span>BâtiPro</span></div>
    <h1>Essai gratuit ${pub.trialDays} jours</h1>
    <p class="muted">Sans carte bancaire. Vous choisirez de payer (ou pas) à la fin de l'essai.</p>
    <div class="su-per"><button type="button" data-per="month" class="on">Mensuel</button><button type="button" data-per="year">Annuel <small>2 mois offerts</small></button></div>
    <div class="su-plans" data-plans></div>
    <div class="grid-form">
      <label class="field full"><span>Nom de l'entreprise *</span><input name="company" required autocomplete="organization"></label>
      <label class="field"><span>N° de TVA</span><input name="vat" placeholder="BE0123456789"></label>
      <label class="field"><span>Pays</span><select name="country"><option value="BE">Belgique</option><option value="FR">France</option><option value="LU">Luxembourg</option><option value="NL">Pays-Bas</option></select></label>
      <label class="field full"><span>Votre nom *</span><input name="name" required autocomplete="name"></label>
      <label class="field"><span>E-mail (identifiant) *</span><input name="email" type="email" required autocomplete="email"></label>
      <label class="field"><span>Mot de passe * <small class="muted">(10 caractères min.)</small></span><input name="password" type="password" required minlength="10" autocomplete="new-password"></label>
      <label class="su-hp" aria-hidden="true">Site web<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="chk full su-acc"><input type="checkbox" name="accept"> <span>J'accepte les <a href="legal.php?doc=cgu" target="_blank" rel="noopener">conditions générales</a>, la <a href="legal.php?doc=confidentialite" target="_blank" rel="noopener">politique de confidentialité</a> et l'<a href="legal.php?doc=dpa" target="_blank" rel="noopener">accord de traitement des données</a>.</span></label>
    </div>
    <button class="btn primary block" type="submit">Créer mon compte</button>
    <p class="muted">Déjà client ? <a href="#" data-login>Se connecter</a></p>
  </form></div>`;
  const f = $('form', app);
  const draw = () => {
    $('[data-plans]', f).innerHTML = pub.plans.map((p) => `<button type="button" class="su-plan ${p.id === plan ? 'on' : ''}" data-plan="${esc(p.id)}">
      <b>${esc(p.name)}</b><span class="su-price">${eur(period === 'year' ? p.year / 12 : p.month)}<small> HTVA / mois</small></span>
      <small>${period === 'year' ? `${eur(p.year)} HTVA par an` : 'sans engagement'}</small><span class="su-desc">${esc(p.desc || '')}</span>
      <small class="muted">${p.users ? `${p.users} utilisateur${p.users > 1 ? 's' : ''} bureau` : 'Utilisateurs illimités'}${p.field ? ` · ${p.field} accès terrain` : ''}</small></button>`).join('');
    $$('[data-plan]', f).forEach((b) => { b.onclick = () => { plan = b.dataset.plan; draw(); }; });
  };
  $$('[data-per]', f).forEach((b) => { b.onclick = () => { period = b.dataset.per; $$('[data-per]', f).forEach((x) => x.classList.toggle('on', x === b)); draw(); }; });
  $('[data-login]', f).onclick = (e) => { e.preventDefault(); location.hash = ''; showLogin(); };
  draw();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!f.accept.checked) return toast('Cochez l\'acceptation des conditions pour continuer', 3500);
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      await api('POST', 'signup', { company: f.company.value, vat: f.vat.value, country: f.country.value, name: f.name.value, email: f.email.value, password: f.password.value, website: f.website.value, accept: true, plan, period });
      location.hash = '#/dashboard'; await boot();
      setTimeout(() => toast('Bienvenue ! Votre essai gratuit commence maintenant.', 5000), 600);
    } catch (err) { toast(err.message, 5000); btn.disabled = false; }
  };
  setTimeout(() => f.company.focus(), 50);
}

// ---------------------------------------------------------------- Bandeau en haut : essai, retard de paiement, résiliation
function subBand() {
  const s = S.sub; if (!s || s.status === 'free' || s.super || isField()) return '';
  const link = isAdmin() ? '<a class="btn sm" href="#/abonnement">Mon abonnement</a>' : '';
  if (s.status === 'trial') return `<div class="sub-band ${s.daysLeft <= 3 ? 'warn' : ''}">Essai gratuit <b>${esc(s.planName)}</b> : ${s.daysLeft > 0 ? `encore <b>${s.daysLeft} jour${s.daysLeft > 1 ? 's' : ''}</b>` : '<b>dernier jour</b>'}${link ? ` ${link.replace('Mon abonnement', 'Choisir ma formule')}` : ''}</div>`;
  if (s.status === 'past_due') return `<div class="sub-band bad">Le paiement de l'abonnement a échoué : mettez à jour votre moyen de paiement ${link}</div>`;
  if (s.status === 'canceled' && !s.locked) return `<div class="sub-band">Abonnement résilié : accès jusqu'au <b>${fmtDate(s.until)}</b> ${link}</div>`;
  return '';
}
// Accès bloqué (essai fini, impayé) : l'administrateur va à son abonnement, les autres sont informés
function subLocked() {
  if (isAdmin()) { location.hash = '#/abonnement'; return; }
  const page = layout({ title: 'Accès suspendu', icon: 'key' });
  page.innerHTML = `<div class="todo-empty">${I.key}<b>L'abonnement de votre entreprise est expiré</b><span>Vos données sont conservées. Demandez à l'administrateur de votre entreprise de renouveler l'abonnement.</span></div>`;
}
// le serveur refuse (402) : l'abonnement vient d'expirer
window.addEventListener('bp-locked', () => { if (S.sub) { S.sub.locked = true; render(); } });

// ---------------------------------------------------------------- Mon abonnement
route('abonnement', async () => {
  if (!isAdmin()) return go('#/dashboard');
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  // retour de la page de paiement : vérifier le paiement tout de suite
  if (q.has('retour')) {
    history.replaceState(null, '', '#/abonnement');
    const page = layout({ title: 'Mon abonnement', icon: 'coins' });
    page.innerHTML = `<div class="todo-empty">${I.clock}<b>Confirmation du paiement…</b><span>Quelques secondes.</span></div>`;
    for (let i = 0; i < 6; i++) {
      const r = await api('POST', 'billing/refresh').catch(() => null);
      if (r && ['paid', 'already'].includes(r.result)) { toast('Paiement reçu – merci ! ✓', 4000); break; }
      if (r && /^first-/.test(r.result)) { toast('Le paiement n\'a pas abouti. Vous pouvez réessayer.', 5000); break; }
      await new Promise((res) => setTimeout(res, 2000));
    }
    const b = await api('GET', 'bootstrap'); S.sub = b.sub; S.edition = b.edition || S.edition;
    return render();
  }
  const r = await api('GET', 'billing');
  const s = r.state; const pub = r.pub;
  S.sub = { ...S.sub, ...s };
  const page = layout({ title: 'Mon abonnement', icon: 'coins', sub: badge(...(SUB_ST[s.status] || SUB_ST.free)) });
  if (s.status === 'free') { page.innerHTML = `<div class="card"><p>Votre entreprise n'a pas d'abonnement payant : aucun paiement n'est demandé.</p></div>${dataCard()}`; bindData(page); return; }
  const cur = pub.plans.find((p) => p.id === s.plan) || pub.plans[0];
  const priceOf = (id, per) => (r.prices.find((x) => x.id === id) || {})[per] || { ht: 0, ttc: 0, rate: 0 };
  let period = s.period || 'month';
  const canChange = s.status === 'active' && s.hasSub;
  const head = s.status === 'trial' ? `Essai gratuit de la formule <b>${esc(s.planName)}</b> jusqu'au <b>${fmtDate(s.until)}</b>${s.locked ? ' : <b class="late">terminé</b>' : ` (${s.daysLeft} jour${s.daysLeft > 1 ? 's' : ''})`}. Vos données restent conservées.`
    : s.status === 'active' ? `Formule <b>${esc(s.planName)}</b>, paiement ${s.period === 'year' ? 'annuel' : 'mensuel'} automatique. Payé jusqu'au <b>${fmtDate(s.until)}</b>${s.hasSub ? ' – prochain prélèvement à cette date' : ''}.`
      : s.status === 'past_due' ? `<b class="late">Le dernier paiement a échoué.</b> Payez maintenant pour garder l'accès (payé jusqu'au ${fmtDate(s.until)}).`
        : `Abonnement résilié : ${s.locked ? '<b class="late">accès suspendu</b>' : `accès jusqu'au <b>${fmtDate(s.until)}</b>`}. Vos données sont conservées 90 jours.`;
  page.innerHTML = `<div class="card sub-head">${s.locked ? `<div class="alert">${I.key} Accès suspendu : choisissez une formule pour retrouver toutes vos données.</div>` : ''}<p>${head}</p>
      <p class="muted">Utilisation : ${r.counts.users} utilisateur(s) bureau${cur.users ? ` sur ${cur.users}` : ''} · ${r.counts.field} accès terrain${cur.field ? ` sur ${cur.field}` : ''}.</p>
      ${r.pending ? '<p class="muted">Un paiement est en attente de confirmation.</p>' : ''}
      ${!((S.settings.company || {}).street && (S.settings.company || {}).city) ? `<div class="hint-box warn">Complétez l'adresse${(S.settings.company || {}).vat ? '' : ' et le n° de TVA'} de votre entreprise : ils figurent sur vos factures d'abonnement. <a href="#/settings">Paramètres → Entreprise</a></div>` : ''}</div>
    <div class="card"><div class="card-h"><h3>${canChange ? 'Changer de formule' : 'Choisir une formule'}</h3><div class="su-per sm"><button type="button" data-per="month">Mensuel</button><button type="button" data-per="year">Annuel <small>2 mois offerts</small></button></div></div>
      <div class="su-plans" data-plans></div>
      <p class="muted sm">Paiement sécurisé par Mollie (Bancontact, carte, domiciliation). Le premier paiement active le prélèvement automatique ; une facture est disponible ci-dessous à chaque paiement. Résiliable à tout moment, effet à la fin de la période payée.</p></div>
    <div class="card"><div class="card-h"><h3>Factures</h3></div>${r.invoices.length ? `<div class="rows">${r.invoices.map((i) => `<div class="row static"><span class="grow"><b>${esc(i.number)}</b><small class="muted">${fmtDate(i.date)} · ${esc(i.label || '')}</small></span><b>${eur(i.ttc)}</b><a class="btn sm" href="api.php?r=billing/invoice/${i.id}" target="_blank" rel="noopener">Voir / PDF</a></div>`).join('')}</div>` : '<p class="muted">Aucune facture pour l\'instant.</p>'}</div>
    ${dataCard(s)}`;
  const draw = () => {
    $$('[data-per]', page).forEach((x) => x.classList.toggle('on', x.dataset.per === period));
    $('[data-plans]', page).innerHTML = pub.plans.map((p) => { const pr = priceOf(p.id, period); const mine = p.id === s.plan && period === (s.period || 'month') && s.status === 'active';
      return `<div class="su-plan ${mine ? 'on' : ''}"><b>${esc(p.name)}</b><span class="su-price">${eur(pr.ht)}<small> HTVA / ${perLabel(period)}</small></span>
        <small>${pr.rate ? `${eur(pr.ttc)} TVAC (TVA ${fnum(pr.rate)} %)` : 'Autoliquidation de la TVA'}</small><span class="su-desc">${esc(p.desc || '')}</span>
        <small class="muted">${p.users ? `${p.users} utilisateur${p.users > 1 ? 's' : ''} bureau` : 'Utilisateurs illimités'}${p.field ? ` · ${p.field} accès terrain` : ' · sans espace terrain'}</small>
        ${mine ? '<span class="badge" style="--c:#2f9e44">Votre formule</span>' : `<button type="button" class="btn ${p.id === s.plan ? 'primary' : ''}" data-go="${esc(p.id)}">${canChange ? 'Passer à cette formule' : `Payer et activer`}</button>`}</div>`; }).join('');
    $$('[data-go]', page).forEach((b) => { b.onclick = () => choose(b.dataset.go); });
  };
  const choose = async (id) => {
    const p = pub.plans.find((x) => x.id === id); const pr = priceOf(id, period);
    const msg = canChange && period === s.period ? `Passer à la formule ${p.name} ?\n\nNouveau montant : ${eur(pr.ttc)} TVAC par ${perLabel(period)}, à partir du prochain prélèvement (${fmtDate(s.until)}). La nouvelle formule est active tout de suite.`
      : `Activer la formule ${p.name} : ${eur(pr.ttc)} TVAC par ${perLabel(period)}.\n\nVous allez être redirigé vers la page de paiement sécurisée (Mollie).`;
    if (!confirm(msg)) return;
    try {
      const res = await api('POST', canChange ? 'billing/change' : 'billing/checkout', { plan: id, period });
      const url = res.checkoutUrl || (res.checkout && res.checkout.checkoutUrl);
      if (url) { location.href = url; return; }
      toast('Formule modifiée ✓', 3000); const b = await api('GET', 'bootstrap'); S.sub = b.sub; S.edition = b.edition || S.edition; render();
    } catch (e) { toast(e.message, 6000); }
  };
  $$('[data-per]', page).forEach((b) => { b.onclick = () => { period = b.dataset.per; draw(); }; });
  draw();
  bindData(page, s);
});
// Mes données : export complet (RGPD), résiliation, suppression du compte
function dataCard(s = {}) {
  return `<div class="card"><div class="card-h"><h3>Mes données</h3></div>
    <p class="muted">Vos données vous appartiennent : téléchargez-les à tout moment (clients, devis, factures, chantiers, achats, photos, documents).</p>
    <div class="btns"><a class="btn" href="api.php?r=export/all">${I.download} Exporter toutes mes données (ZIP)</a>
      ${['active', 'past_due'].includes(s.status) && s.hasSub ? '<button class="btn" data-cancel>Résilier l\'abonnement</button>' : ''}
      ${s.status && s.status !== 'free' ? `<button class="btn danger ghost" data-delreq ${s.deleteRequested ? 'disabled' : ''}>${s.deleteRequested ? `Suppression demandée le ${fmtDate(String(s.deleteRequested).slice(0, 10))}` : 'Supprimer mon compte'}</button>` : ''}</div>
    <p class="muted sm">Conditions : <a href="legal.php?doc=cgu" target="_blank" rel="noopener">CGU</a> · <a href="legal.php?doc=confidentialite" target="_blank" rel="noopener">Confidentialité</a> · <a href="legal.php?doc=dpa" target="_blank" rel="noopener">Traitement des données</a></p></div>`;
}
function bindData(page, s = {}) {
  const c = $('[data-cancel]', page);
  if (c) c.onclick = async () => {
    const v = await ask('Résilier l\'abonnement', [{ name: 'info', type: 'html', cls: 'full', html: `<p>Plus aucun prélèvement. Vous gardez l'accès jusqu'au <b>${fmtDate(s.until)}</b>, puis vos données sont conservées 90 jours (exportables).</p>` }, { name: 'reason', label: 'Pourquoi partez-vous ? (facultatif, nous aide à nous améliorer)', type: 'textarea', cls: 'full' }]);
    if (!v) return;
    try { await api('POST', 'billing/cancel', { reason: v.reason || '' }); toast('Abonnement résilié', 3000); const b = await api('GET', 'bootstrap'); S.sub = b.sub; render(); } catch (e) { toast(e.message, 5000); }
  };
  const d = $('[data-delreq]', page);
  if (d) d.onclick = async () => {
    const v = await ask('Supprimer mon compte', [{ name: 'info', type: 'html', cls: 'full', html: '<div class="hint-box warn">L\'abonnement est arrêté et toutes les données de l\'entreprise (clients, factures, chantiers, fichiers) seront <b>supprimées définitivement</b> sous 30 jours. Pensez à <b>exporter vos données</b> avant : la loi vous oblige à conserver vos factures 7 ans.</div>' },
      { name: 'password', label: 'Votre mot de passe pour confirmer', type: 'password', required: true, cls: 'full' }]);
    if (!v) return;
    try { await api('POST', 'billing/delete-request', { password: v.password }); toast('Demande enregistrée', 3000); render(); } catch (e) { toast(e.message, 5000); }
  };
}

// ---------------------------------------------------------------- Plateforme : vente en ligne (formules, prix, essai, Mollie)
async function saasCard(box) {
  const c = await api('GET', 'platform/saas');
  box.innerHTML = `<div class="card-h"><h3>${I.coins} Vente en ligne (abonnements)</h3><span>${c.enabled ? badge('Inscriptions ouvertes', '#2f9e44') : badge('Inscriptions fermées', '#868e96')}</span></div>
    <form class="saas-f"><div class="grid-form">
      <label class="field chk full"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}><span>Ouvrir les inscriptions (lien « Essai gratuit » sur la page de connexion)</span></label>
      ${fieldHTML({ name: 'trialDays', label: 'Jours d\'essai gratuit', type: 'number' }, c.trialDays)}${fieldHTML({ name: 'graceDays', label: 'Délai de grâce après un paiement raté (jours)', type: 'number' }, c.graceDays)}
      ${fieldHTML({ name: 'vatRate', label: 'TVA (%)', type: 'number' }, c.vatRate)}
      ${fieldHTML({ name: 'mollieKey', label: `Clé API Mollie ${c.hasKey ? `(${c.keyMode === 'live' ? 'LIVE ✓' : 'test'} enregistrée – laisser vide pour la garder)` : ''}`, placeholder: 'live_… ou test_…', hint: 'Mollie → Développeurs → Clés API. Commencez par la clé test_ pour essayer.' }, '')}
    </div>
    <div class="field full"><span>Formules (prix HTVA ; bureau 0 = illimité ; terrain 0 = sans espace terrain)</span><div class="saas-plans" data-pl></div><button type="button" class="btn sm" data-addpl>${I.plus} Ajouter une formule</button></div>
    <p class="muted sm">Lien d'inscription : <code>${esc(c.signupUrl)}</code><br>Adresse des avis de paiement (automatique) : <code>${esc(c.webhook)}</code></p>
    <div class="btns"><button type="button" class="btn" data-legal>${I.file} Documents légaux</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`;
  const plans = c.plans.map((p) => ({ ...p }));
  const drawPl = () => {
    $('[data-pl]', box).innerHTML = `<table class="dt saas-tbl"><thead><tr><th>Code</th><th>Nom</th><th>Version</th><th class="r">€ / mois</th><th class="r">€ / an</th><th class="r">Bureau</th><th class="r">Terrain</th><th>Description</th><th></th></tr></thead><tbody>
      ${plans.map((p, i) => `<tr data-i="${i}"><td><input data-k="id" value="${esc(p.id)}" size="6"></td><td><input data-k="name" value="${esc(p.name)}"></td>
        <td><select data-k="edition"><option value="simple" ${p.edition === 'simple' ? 'selected' : ''}>Simplifié</option><option value="avance" ${p.edition !== 'simple' ? 'selected' : ''}>Avancé</option></select></td>
        <td><input data-k="month" value="${p.month}" size="5" inputmode="decimal"></td><td><input data-k="year" value="${p.year}" size="6" inputmode="decimal"></td>
        <td><input data-k="users" value="${p.users}" size="3" inputmode="numeric"></td><td><input data-k="field" value="${p.field}" size="3" inputmode="numeric"></td>
        <td><input data-k="desc" value="${esc(p.desc || '')}"></td><td><button type="button" class="icon-btn sm" data-rm="${i}">${I.trash}</button></td></tr>`).join('')}</tbody></table>`;
    $$('[data-pl] input, [data-pl] select', box).forEach((inp) => { inp.oninput = inp.onchange = () => { const i = +inp.closest('tr').dataset.i; plans[i][inp.dataset.k] = inp.value; }; });
    $$('[data-rm]', box).forEach((b) => { b.onclick = () => { plans.splice(+b.dataset.rm, 1); drawPl(); }; });
  };
  drawPl();
  $('[data-legal]', box).onclick = editLegal;
  $('[data-addpl]', box).onclick = () => { plans.push({ id: `f${plans.length + 1}`, name: 'Nouvelle formule', edition: 'avance', month: 0, year: 0, users: 0, field: 0, desc: '' }); drawPl(); };
  $('form', box).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      await api('PUT', 'platform/saas', { enabled: f.enabled.checked, trialDays: num(f.trialDays.value), graceDays: num(f.graceDays.value), vatRate: num(f.vatRate.value), mollieKey: f.mollieKey.value.trim(), plans: plans.map((p) => ({ ...p, month: num(p.month), year: num(p.year), users: num(p.users), field: num(p.field) })) });
      toast('Vente en ligne enregistrée ✓', 3000); saasCard(box);
    } catch (err) { toast(err.message, 5000); }
  };
}
// Plateforme : textes publics de legal.php (modèles pré-remplis avec les coordonnées de la firme 1)
async function editLegal() {
  const l = await api('GET', 'platform/legal');
  formModal({
    title: 'Documents légaux', wide: true,
    values: { tribunal: l.tribunal, hebergeur: l.hebergeur, date: l.date, ...Object.fromEntries(l.docs.map((d) => [`d_${d.id}`, d.text])) },
    fields: [{ name: 'info', type: 'html', cls: 'full', html: `<p class="muted sm">Pages publiques : <a href="legal.php" target="_blank" rel="noopener">voir</a>. Les mots entre accolades sont remplacés automatiquement : ${l.vars.map((k) => `<code>{${k}}</code>`).join(' ')}. Mise en forme : « ## » titre, « - » liste, **gras**. Vider un texte rétablit le modèle. Modèles à faire relire par un juriste.</p>` },
      { name: 'tribunal', label: 'Tribunaux compétents (arrondissement)' }, { name: 'hebergeur', label: 'Hébergeur' }, { name: 'date', label: 'En vigueur le' },
      ...l.docs.map((d) => ({ name: `d_${d.id}`, label: `${d.label}${d.custom ? ' (personnalisé)' : ' (modèle)'}`, type: 'textarea', rows: 12, cls: 'full' }))],
    async onSave(v) {
      await api('PUT', 'platform/legal', { tribunal: v.tribunal, hebergeur: v.hebergeur, date: v.date, docs: Object.fromEntries(l.docs.map((d) => [d.id, v[`d_${d.id}`]])) });
      toast('Documents légaux enregistrés ✓', 3000);
    },
  });
}
// Plateforme : abonnement d'une firme réglé à la main (offert, prolongé, formule)
async function editFirmSub(c) {
  const cfg = await api('GET', 'platform/saas'); const s = c.sub || {};
  formModal({
    title: `Abonnement – ${c.name}`, values: { status: s.status || 'free', plan: s.plan || '', period: s.period || 'month', until: s.until || '' },
    fields: [{ name: 'status', label: 'Statut', type: 'select', options: Object.entries(SUB_ST).map(([k, [l]]) => [k, l]), hint: '« Sans abonnement » = accès gratuit et illimité (firmes existantes, partenaires).' },
      { name: 'plan', label: 'Formule', type: 'select', options: [['', '—'], ...cfg.plans.map((p) => [p.id, p.name])] }, { name: 'period', label: 'Paiement', type: 'select', options: [['month', 'Mensuel'], ['year', 'Annuel']] },
      { name: 'until', label: 'Accès jusqu\'au (fin d\'essai ou période payée)', type: 'date' },
      { name: 'info', type: 'html', cls: 'full', html: `<p class="muted sm">${s.terms ? `Conditions acceptées le ${fmtDT(s.terms)}. ` : ''}${s.paidTotal ? `Total payé : ${eur(s.paidTotal)}. ` : ''}${s.cancelReason ? `Raison de la résiliation : « ${esc(s.cancelReason)} ». ` : ''}${s.deleteRequested ? `<b class="late">Suppression demandée le ${fmtDT(s.deleteRequested)}.</b>` : ''}</p>` }],
    async onSave(v) {
      const sub = { status: v.status, plan: v.plan || undefined, period: v.period };
      if (v.until) sub[v.status === 'trial' ? 'trialUntil' : 'paidUntil'] = v.until;
      await api('PUT', `platform/companies/${c.id}`, { sub }); toast('Abonnement modifié', 2500); render();
    },
  });
}
