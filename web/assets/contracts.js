'use strict';
/* Contrats : modèles types (Paramètres → Contrats types) dont les champs {…} se remplissent tout seuls depuis
   le chantier, le client, le devis, le sous-traitant ou le bon de commande. On ne modifie que ce qu'on veut,
   puis PDF, envoi par e-mail, contrat signé. Les fichiers (contrats scannés…) s'ajoutent à côté. */

const CT_FILL = '[à compléter]';
const CT_PARTIES = { client: 'Client (maître d\'ouvrage)', soustraitant: 'Sous-traitant', autre: 'Autre' };
const CT_ST = { brouillon: ['Brouillon', '#868e96'], envoye: ['Envoyé', '#3b5bdb'], signe: ['Signé ✓', '#2f9e44'] };
// Champs disponibles dans les modèles
const CT_VARS = [
  ['date', 'Date du jour'], ['societe', 'Votre entreprise'], ['societe_adresse', 'Adresse de l\'entreprise'], ['societe_tva', 'N° TVA de l\'entreprise'], ['societe_tel', 'Téléphone'], ['societe_email', 'E-mail'], ['societe_iban', 'IBAN'],
  ['client', 'Client'], ['client_adresse', 'Adresse du client'], ['client_tva', 'TVA du client'], ['client_email', 'E-mail du client'], ['client_tel', 'Téléphone du client'],
  ['chantier', 'Nom du chantier'], ['chantier_adresse', 'Adresse du chantier'], ['date_debut', 'Début des travaux'], ['date_fin', 'Fin prévue'], ['responsable', 'Conducteur de travaux'],
  ['devis_numero', 'N° du devis'], ['devis_date', 'Date du devis'], ['devis_ht', 'Montant du devis HTVA'], ['devis_tva', 'TVA du devis'], ['devis_tvac', 'Montant du devis TVAC'], ['taux_tva', 'Taux de TVA'],
  ['soustraitant', 'Sous-traitant'], ['soustraitant_adresse', 'Adresse du sous-traitant'], ['soustraitant_tva', 'TVA du sous-traitant'], ['commande_numero', 'N° du bon de commande'], ['commande_ht', 'Montant de la commande HTVA'],
];
// Modèles proposés (à adapter et à faire vérifier par votre conseiller juridique)
const CT_DEFAULTS = [
  { name: 'Contrat d\'entreprise (travaux)', party: 'client', body: `CONTRAT D'ENTREPRISE

Entre {societe}, {societe_adresse}, TVA {societe_tva}, ci-après « l'entrepreneur »,
et {client}, {client_adresse}, ci-après « le maître d'ouvrage ».

Article 1 – Objet
L'entrepreneur s'engage à réaliser les travaux décrits dans le devis n° {devis_numero} du {devis_date}, qui fait partie intégrante du présent contrat, sur le chantier « {chantier} » situé {chantier_adresse}.

Article 2 – Prix
Le prix des travaux s'élève à {devis_ht} hors TVA, soit {devis_tvac} TVA comprise (TVA {taux_tva}). Tout travail supplémentaire ou toute modification demandée par le maître d'ouvrage fait l'objet d'un avenant écrit avant son exécution.

Article 3 – Délais
Les travaux débuteront le {date_debut} et devraient être terminés le {date_fin}, sauf intempéries, force majeure ou retard imputable au maître d'ouvrage ou à d'autres intervenants.

Article 4 – Paiement
Un acompte de ${CT_FILL} % est payable à la signature. Les travaux sont ensuite facturés par états d'avancement. Chaque état est soumis à l'approbation du maître d'ouvrage, qui dispose de ${CT_FILL} jours pour formuler ses remarques par écrit ; à défaut, il est réputé accepté. Les factures sont payables dans les ${CT_FILL} jours.

Article 5 – Obligations du maître d'ouvrage
Le maître d'ouvrage donne libre accès au chantier, met à disposition l'eau et l'électricité nécessaires et obtient les autorisations requises (permis d'urbanisme…), sauf convention contraire.

Article 6 – Réception
La réception provisoire a lieu à l'achèvement des travaux et fait l'objet d'un procès-verbal signé par les parties. La réception définitive intervient ${CT_FILL} mois après la réception provisoire. Les vices apparents doivent être signalés au plus tard lors de la réception provisoire.

Article 7 – Responsabilité et assurances
L'entrepreneur est couvert par une assurance responsabilité civile professionnelle et, pour les travaux qui y sont soumis, par l'assurance obligatoire de la responsabilité décennale. Il répond de ses travaux conformément à la législation belge.

Article 8 – Résiliation
En cas de manquement grave d'une partie, l'autre partie peut résilier le contrat après une mise en demeure restée sans effet pendant quinze jours. Le maître d'ouvrage qui met fin au contrat de sa propre initiative indemnise l'entrepreneur conformément à l'article 1794 du Code civil.

Article 9 – Conditions générales et litiges
Les conditions générales de l'entrepreneur s'appliquent pour autant qu'elles ne dérogent pas au présent contrat. Le droit belge est applicable ; en cas de litige, les tribunaux de l'arrondissement du siège de l'entrepreneur sont compétents, sans préjudice des règles protectrices du consommateur.

Fait à ${CT_FILL}, le {date}, en deux exemplaires, chaque partie reconnaissant avoir reçu le sien.` },
  { name: 'Contrat de sous-traitance', party: 'soustraitant', body: `CONTRAT DE SOUS-TRAITANCE

Entre {societe}, {societe_adresse}, TVA {societe_tva}, ci-après « l'entrepreneur principal »,
et {soustraitant}, {soustraitant_adresse}, TVA {soustraitant_tva}, ci-après « le sous-traitant ».

Article 1 – Objet
L'entrepreneur principal confie au sous-traitant les travaux décrits dans le bon de commande n° {commande_numero}, sur le chantier « {chantier} » situé {chantier_adresse}.

Article 2 – Prix
Les travaux sont rémunérés {commande_ht} hors TVA. Lorsque l'autoliquidation s'applique, la TVA est due par l'entrepreneur principal (article 20 de l'arrêté royal n° 1).

Article 3 – Délais et planning
Le sous-traitant exécute les travaux du {date_debut} au {date_fin}, selon le planning de l'entrepreneur principal, et l'informe sans délai de tout retard prévisible.

Article 4 – Obligations sociales et fiscales
Le sous-traitant déclare être inscrit à la Banque-Carrefour des Entreprises et en règle de cotisations sociales et fiscales. S'il a des dettes sociales ou fiscales au moment du paiement, l'entrepreneur principal effectue les retenues prévues par l'article 30bis de la loi du 27 juin 1969 et l'article 403 du Code des impôts sur les revenus 1992. Le sous-traitant enregistre ses travailleurs présents sur le chantier (Checkin@Work) lorsque la loi l'impose.

Article 5 – Exécution et sécurité
Le sous-traitant exécute les travaux selon les règles de l'art, les plans, le cahier des charges et les instructions de l'entrepreneur principal. Il respecte le plan de sécurité et de santé et les consignes du coordinateur sécurité-santé.

Article 6 – Assurances et responsabilité
Le sous-traitant dispose d'une assurance responsabilité civile professionnelle et, s'il y a lieu, de l'assurance de la responsabilité décennale. Il garantit l'entrepreneur principal contre tout recours lié à ses travaux.

Article 7 – Réception et paiement
Les travaux du sous-traitant sont réceptionnés en même temps que ceux de l'entrepreneur principal par le maître d'ouvrage. Ses factures sont payables à ${CT_FILL} jours, sous réserve des retenues légales.

Article 8 – Sous-traitance en cascade
Le sous-traitant ne peut lui-même sous-traiter tout ou partie des travaux sans l'accord écrit préalable de l'entrepreneur principal.

Article 9 – Litiges
Le droit belge est applicable. En cas de litige, les tribunaux de l'arrondissement du siège de l'entrepreneur principal sont compétents.

Fait à ${CT_FILL}, le {date}, en deux exemplaires.` },
  { name: 'Avenant (travaux supplémentaires)', party: 'client', body: `AVENANT N° ${CT_FILL}

Entre {societe} (l'entrepreneur) et {client} (le maître d'ouvrage), pour le chantier « {chantier} », {chantier_adresse}.

Article 1 – Modifications
Les parties conviennent des modifications suivantes aux travaux prévus au devis n° {devis_numero} :
${CT_FILL}

Article 2 – Prix
Ces modifications augmentent / diminuent (biffer la mention inutile) le prix de ${CT_FILL} hors TVA.

Article 3 – Délais
Le délai d'exécution est prolongé de ${CT_FILL} jours ouvrables.

Toutes les autres clauses du contrat restent inchangées.

Fait à ${CT_FILL}, le {date}, en deux exemplaires.` },
  { name: 'Procès-verbal de réception provisoire', party: 'client', body: `PROCÈS-VERBAL DE RÉCEPTION PROVISOIRE

Chantier : « {chantier} », {chantier_adresse}
Maître d'ouvrage : {client}
Entrepreneur : {societe}
Devis / contrat : n° {devis_numero}

Les parties, réunies sur le chantier le {date}, constatent l'achèvement des travaux.

Article 1 – Réception
La réception provisoire est accordée sans réserve / avec les réserves suivantes (biffer la mention inutile) :
${CT_FILL}

Article 2 – Levée des réserves
L'entrepreneur s'engage à lever les réserves éventuelles dans un délai de ${CT_FILL} jours.

Article 3 – Réception définitive
La réception définitive interviendra le ${CT_FILL}, sauf remarque écrite d'une des parties.

Fait sur le chantier, le {date}, en deux exemplaires.` },
];

async function ctTemplates() {
  let list = await db.list('contracttpl');
  if (!list.length) { for (const t of CT_DEFAULTS) list.push(await persist('contracttpl', { data: { ...t, builtin: true } }, { silent: true })); }
  return list.sort((a, b) => (a.data.name || '').localeCompare(b.data.name || ''));
}
// rue + code postal + ville sur une ligne (l'adresse de l'entreprise contient parfois déjà la ville)
const ctAddr = (d) => { const st = String(d.street || d.address || '').trim().replace(/\s*\n\s*/g, ', '); return d.city && st.includes(d.city) ? st : [st, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', '); };
// Valeurs des champs pour un chantier, une partie, un devis et un bon de commande
function ctValues({ project, party, quote, order, contacts }) {
  const co = company(); const pd = (project && project.data) || {};
  const client = byId(contacts, pd.clientId) || (party && party.data.kind !== 'soustraitant' ? party : null);
  const sub = party && party.data.kind === 'soustraitant' ? party : (order ? byId(contacts, order.data.supplierId) : null);
  const qt = quote ? totals(quote.data) : null; const ot = order ? totals(order.data) : null;
  const cd = (client && client.data) || {}; const sd = (sub && sub.data) || {};
  return {
    date: dateFr(today()), societe: co.name, societe_adresse: ctAddr(co), societe_tva: co.vat, societe_tel: co.phone, societe_email: co.email, societe_iban: co.iban ? ibanFmt(co.iban) : '',
    client: client ? contactName(client) : '', client_adresse: ctAddr(cd), client_tva: cd.vat, client_email: cd.email, client_tel: cd.phone || cd.mobile,
    chantier: pd.name, chantier_adresse: ctAddr(pd), date_debut: dateFr(pd.start), date_fin: dateFr(pd.end), responsable: pd.managerId ? userName(+pd.managerId) : '',
    devis_numero: quote ? quote.number : '', devis_date: quote ? dateFr(quote.data.date) : '', devis_ht: qt ? money(qt.base) : '', devis_tva: qt ? (quote.data.reverse ? 'autoliquidation' : money(qt.vat)) : '', devis_tvac: qt ? money(qt.total) : '',
    taux_tva: qt ? (quote.data.reverse ? 'autoliquidation' : qt.vats.map((v) => `${fnum(v.rate)} %`).join(' et ')) : '',
    soustraitant: sub ? contactName(sub) : '', soustraitant_adresse: ctAddr(sd), soustraitant_tva: sd.vat, commande_numero: order ? order.number : '', commande_ht: ot ? money(ot.base) : '',
  };
}
const ctFill = (body, vals) => String(body || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? (vals[k] ? String(vals[k]) : CT_FILL) : m));
const ctTodo = (body) => (String(body || '').match(/\[à compléter\]/g) || []).length;

// Mise en page du contrat (feuille A4 du modèle Madibu)
function ctHtml(ct, contacts) {
  const d = ct.data; const co = company(); const t = tpl();
  const party = byId(contacts, d.partyId);
  const paras = String(d.body || '').split(/\n{2,}/);
  const p0 = (paras[0] || '').replace(/\[à compléter\]/g, '');
  const first = p0.trim() && !p0.includes('\n') && p0 === p0.toUpperCase() && p0.length < 90 ? paras.shift() : '';
  const kind = /^PROC/.test(first) ? 'Procès-verbal' : /^AVENANT/.test(first) ? 'Avenant' : 'Contrat';
  const fmt = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[à compléter\]/g, '<mark class="ct-todo">[à compléter]</mark>').replace(/\n/g, '<br>');
  const body = paras.map((p) => { const l = p.split('\n'); const m = l[0].match(/^Article\s+(\d+)\s*[–:.-]\s*(.+)$/i);
    return m ? `<div class="ct-art"><h4><span class="mb-art">${m[1]}</span>${esc(m[2])}</h4><p>${fmt(l.slice(1).join('\n'))}</p></div>` : `<p>${fmt(p)}</p>`; }).join('');
  const sideB = d.party === 'soustraitant' ? 'Le sous-traitant' : d.party === 'client' ? 'Le maître d\'ouvrage' : 'L\'autre partie';
  return `<style>${docCSS(t)}</style><div class="doc mb mb-paper" data-foot="${esc(legalLine(t))}" data-ink="${esc(t.ink)}" data-acc="${esc(t.accent)}"><div class="mb-sheet ct-sheet"><div class="mb-ruler"></div>
    <header class="mb-head"><div class="mb-brand">${co.logoId ? `<img class="mb-logo" src="${fileUrl(co.logoId)}" alt="">` : `<div class="mb-mono">${esc(monoOf(co.name))}</div><div class="mb-brand-n">${esc(co.name || '')}</div>`}</div>
      <div class="mb-id"><div class="mb-kind">${kind}</div><div class="mb-no ct-no">${esc(first || d.title || 'Contrat')}</div><dl class="mb-meta"><dt>Date</dt><dd>${esc(dateFr(d.date || today()))}</dd>${party ? `<dt>${esc(CT_PARTIES[d.party] || 'Partie')}</dt><dd>${esc(contactName(party))}</dd>` : ''}</dl></div></header>
    <div class="ct-body">${body}</div>
    <section class="mb-sign"><div><small>Pour ${esc(co.name || 'l\'entreprise')}</small><span class="mb-sl"></span><em>Date, nom et signature, précédés de « Lu et approuvé »</em></div><div><small>${esc(sideB)}${party ? ` – ${esc(contactName(party))}` : ''}</small><span class="mb-sl"></span><em>Date, nom et signature, précédés de « Lu et approuvé »</em></div></section>
    <footer class="mb-foot"><span>${esc(legalLine(t))}</span><span class="mb-pg">1</span></footer></div></div>`;
}

// ---------------------------------------------------------------- Onglet « Contrats » du chantier : contrats + fichiers
async function tabContracts(p, el) {
  const [cts, docs, contacts] = await Promise.all([db.list('contract', { project: p.id }), db.list('document', { project: p.id }), db.list('contact')]);
  const files = docs.filter((x) => (x.data.folder || '') === 'Contrats');
  el.innerHTML = `<div class="toolbar"><span class="grow muted">Contrats créés depuis vos modèles (champs remplis automatiquement) et contrats reçus ou signés en fichier.</span>
      <button class="btn" data-act="upct">${I.upload} Ajouter un fichier</button><button class="btn primary" data-act="newct">${I.plus} Nouveau contrat</button></div>
    <div class="card ct-list">${cts.sort((a, b) => b.id - a.id).map((c) => { const n = ctTodo(c.data.body); return `<a class="rep-row" href="#/contract/${c.id}"><span class="rep-ic out">${I.fiche}</span><span class="rep-tx"><b>${esc(c.data.title || 'Contrat')}</b><small>${fmtDate(c.data.date)}${byId(contacts, c.data.partyId) ? ` · ${esc(contactName(byId(contacts, c.data.partyId)))}` : ''}${n ? ` · <span class="late">${n} champ(s) à compléter</span>` : ''}</small></span><span>${badge(...(CT_ST[c.data.status] || CT_ST.brouillon))}</span></a>`; }).join('')
      || '<p class="muted">Aucun contrat créé pour ce chantier.</p>'}</div>
    ${files.length ? `<h3 class="t-h">Fichiers – dossier Contrats</h3><div class="docs">${files.map((x) => `<div class="doc-card"><a href="${fileUrl(x.data.fileId)}" target="_blank" rel="noopener"><span class="doc-ic">${I.file}<b>${esc((x.data.name.split('.').pop() || '').toUpperCase())}</b></span></a><div class="dc-meta"><b title="${esc(x.data.name)}">${esc(x.data.name)}</b><small class="muted">${fnum((x.data.size || 0) / 1048576, 1)} Mo · ${esc(userName(x.created_by))}</small></div></div>`).join('')}</div>` : ''}`;
  $('[data-act=newct]', el).onclick = () => newContract(p.id);
  $('[data-act=upct]', el).onclick = async () => {
    const list = await pickFile('*/*', true); if (!list || !list.length) return;
    for (const f of list) { const r = await upload(f, p.id); await persist('document', { project_id: p.id, data: { name: r.name, fileId: r.id, mime: r.mime, size: r.size, folder: 'Contrats' } }, { silent: true }); }
    toast('Fichier(s) ajouté(s) au dossier Contrats'); render();
  };
}
async function newContract(projectId) {
  const [tpls, project, contacts, quotes, orders] = await Promise.all([ctTemplates(), db.get('project', projectId), db.list('contact'), db.list('quote', { project: projectId }), db.list('order', { project: projectId })]);
  const subs = contacts.filter((c) => c.data.kind === 'soustraitant');
  const m = formModal({
    title: 'Nouveau contrat', saveLabel: 'Créer le contrat',
    values: { tplId: (tpls.find((t) => /^Contrat d'entreprise/.test(t.data.name)) || tpls[0]).id, partyId: project.data.clientId || '', quoteId: (quotes.find((q) => q.data.status === 'accepte') || quotes[0] || {}).id || '', orderId: '' },
    fields: [
      { name: 'tplId', label: 'Modèle', type: 'select', options: tpls.map((t) => [t.id, t.data.name]), cls: 'full', hint: 'Modifiez ou ajoutez vos modèles dans Paramètres → Contrats types.' },
      { name: 'partyId', label: 'Avec', type: 'select', options: [['', '—'], ...contacts.filter((c) => ['client', 'prospect', 'soustraitant', 'architecte', 'autre'].includes(c.data.kind)).map((c) => [c.id, `${contactName(c)} (${CONTACT_KINDS[c.data.kind] || ''})`])], cls: 'full' },
      { name: 'quoteId', label: 'Devis concerné', type: 'select', options: [['', '—'], ...quotes.map((q) => [q.id, `${q.number} · ${q.data.title || ''}`])] },
      { name: 'orderId', label: 'Bon de commande (sous-traitance)', type: 'select', options: [['', '—'], ...orders.map((o) => [o.id, `${o.number} · ${contactName(byId(contacts, o.data.supplierId))}`])] },
    ],
    async onSave(v) {
      const t = byId(tpls, +v.tplId); const party = byId(contacts, +v.partyId); const quote = byId(quotes, +v.quoteId); const order = byId(orders, +v.orderId);
      const body = ctFill(t.data.body, ctValues({ project, party, quote, order, contacts }));
      const it = await persist('contract', { project_id: projectId, data: { title: `${t.data.name} – ${project.data.name}`, tplId: t.id, party: t.data.party, partyId: party ? party.id : null, quoteId: quote ? quote.id : null, orderId: order ? order.id : null, date: today(), status: 'brouillon', body } });
      go(`#/contract/${it.id}`);
    },
  });
  // le modèle « sous-traitance » propose le sous-traitant du bon de commande
  const f = $('form', m.el);
  const sync = () => { const t = byId(tpls, +$('[name=tplId]', f).value); if (t && t.data.party === 'soustraitant') { const o = byId(orders, +$('[name=orderId]', f).value) || orders.find((x) => subs.some((s) => s.id === +x.data.supplierId)); if (o) { $('[name=orderId]', f).value = o.id; $('[name=partyId]', f).value = o.data.supplierId; } } else if (project.data.clientId) $('[name=partyId]', f).value = project.data.clientId; };
  $('[name=tplId]', f).addEventListener('change', sync);
}

// ---------------------------------------------------------------- Éditer un contrat : texte à gauche, aperçu à droite
route('contract', async (id) => {
  const [ct, contacts] = await Promise.all([db.get('contract', +id), db.list('contact')]);
  const d = ct.data;
  const page = layout({ title: d.title || 'Contrat', icon: 'fiche', back: ct.project_id ? `#/project/${ct.project_id}/contracts` : '#/projects', sub: `${badge(...(CT_ST[d.status] || CT_ST.brouillon))} <span class="muted" data-saved></span>`,
    actions: `<button class="btn danger ghost" data-act="del">${I.trash}</button><a class="btn" href="#/contractpdf/${ct.id}">${I.print} PDF / Imprimer</a><a class="btn" href="#/contractpdf/${ct.id}?mail=1">${I.mail} Envoyer</a><button class="btn primary" data-act="sign">${I.check} ${d.status === 'signe' ? 'Signé ✓' : 'Marquer signé'}</button>` });
  const hint = (n) => (n ? `⚠ ${n} champ(s) <mark class="ct-todo">[à compléter]</mark> à remplacer dans le texte. <button type="button" class="btn sm" data-next>Suivant ›</button>` : '✓ Tous les champs sont remplis.');
  page.innerHTML = `<div class="ct-edit"><section class="card"><div class="grid-form">
      ${fieldHTML({ name: 'title', label: 'Titre', cls: 'full' }, d.title)}
      ${fieldHTML({ name: 'status', label: 'Statut', type: 'select', options: Object.entries(CT_ST).map(([k, [l]]) => [k, l]) }, d.status)}
      ${fieldHTML({ name: 'date', label: 'Date', type: 'date' }, d.date)}</div>
      <div class="ct-hint" data-todo>${hint(ctTodo(d.body))}</div>
      <label class="field full"><span>Texte du contrat <small class="muted">(un paragraphe par ligne vide · « Article 1 – Titre » en tête d'article · **gras**)</small></span><textarea name="body" rows="26" class="ct-ta">${esc(d.body || '')}</textarea></label>
      ${d.signedFileId ? `<p><a class="chip" href="${fileUrl(d.signedFileId)}" target="_blank" rel="noopener">${I.file} Contrat signé (scan)</a></p>` : ''}</section>
    <section class="ct-prev" data-prev></section></div>`;
  const prev = () => { $('[data-prev]', page).innerHTML = ctHtml(ct, contacts); $('[data-todo]', page).innerHTML = hint(ctTodo(d.body)); };
  const save = debounce(async () => { await persist('contract', ct, { silent: true }); const el = $('[data-saved]'); if (el) el.textContent = 'Enregistré'; }, 700);
  const changed = () => { const el = $('[data-saved]'); if (el) el.textContent = 'Modification…'; prev(); save(); };
  page.addEventListener('input', (e) => { const n = e.target.name; if (['title', 'body'].includes(n)) { d[n] = e.target.value; changed(); } });
  page.addEventListener('change', (e) => { const n = e.target.name; if (['status', 'date'].includes(n)) { d[n] = e.target.value; changed(); } });
  // « Suivant » : sélectionne le prochain [à compléter] dans le texte, prêt à être remplacé
  page.addEventListener('click', (e) => {
    if (!e.target.closest('[data-next]')) return;
    const ta = $('[name=body]', page); const k = CT_FILL;
    let i = ta.value.indexOf(k, ta.selectionEnd); if (i < 0) i = ta.value.indexOf(k); if (i < 0) return;
    ta.blur(); ta.setSelectionRange(i, i + k.length); ta.focus();
  });
  prev();
  cleanupView = () => save.flush();
  $('[data-act=del]').onclick = async () => { if (!confirm('Supprimer ce contrat ?')) return; await db.del('contract', ct.id); go(ct.project_id ? `#/project/${ct.project_id}/contracts` : '#/projects'); };
  $('[data-act=sign]').onclick = () => menuSheet('Contrat signé', [
    { label: 'Ajouter le scan du contrat signé', icon: 'upload', primary: true, run: async () => { const l = await pickFile('image/*,application/pdf', false); const f = l && l[0]; if (!f) return; await save.flush(); const r = await upload(f, ct.project_id); await persist('document', { project_id: ct.project_id, data: { name: r.name, fileId: r.id, mime: r.mime, size: r.size, folder: 'Contrats' } }, { silent: true }); Object.assign(d, { status: 'signe', signedAt: today(), signedFileId: r.id }); await persist('contract', ct); toast('Contrat signé enregistré ✓'); render(); } },
    { label: 'Marquer signé (sans fichier)', icon: 'check', run: async () => { await save.flush(); Object.assign(d, { status: 'signe', signedAt: today() }); await persist('contract', ct); render(); } },
  ]);
});
// Impression / PDF / e-mail du contrat
route('contractpdf', async (id) => {
  const [ct, contacts] = await Promise.all([db.get('contract', +id), db.list('contact')]);
  const d = ct.data; const party = byId(contacts, d.partyId);
  const mail = () => sendMailDialog({ subject: d.title || 'Contrat', body: `Bonjour,\n\nVeuillez trouver ci-joint le contrat « ${d.title || ''} ». Merci de nous le retourner signé.\n\n${mailSign()}`,
    recipients: party ? [contactRcpt(party, 'Destinataire', true)] : [], ref: { type: 'contract', id: ct.id }, projectId: ct.project_id, pdfName: `${fileTitle(d.title || 'Contrat')}.pdf`,
    onSent: () => { if (d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); persist('contract', ct, { silent: true }).catch(() => {}); } } });
  printPage(d.title || 'Contrat', ctHtml(ct, contacts), `#/contract/${ct.id}`, mail);
  if (ctTodo(d.body)) toast(`Attention : ${ctTodo(d.body)} champ(s) encore « à compléter »`, 4000);
  if (new URLSearchParams(location.hash.split('?')[1] || '').has('mail')) mail();
});

// ---------------------------------------------------------------- Paramètres → Contrats types
async function settingsContracts(page) {
  const tpls = await ctTemplates();
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Contrats types</h3><button class="btn primary" data-act="new">${I.plus} Nouveau modèle</button></div>
    <p class="muted">Écrivez le contrat une fois : les champs entre accolades, comme <code>{client}</code> ou <code>{devis_ht}</code>, se remplissent tout seuls depuis le chantier. Modèles proposés à titre d'exemple : faites-les vérifier par votre conseiller juridique.</p>
    <div class="rows">${tpls.map((t) => `<button class="row" data-t="${t.id}"><span class="grow"><b>${esc(t.data.name)}</b><small class="muted">${esc(CT_PARTIES[t.data.party] || '')} · ${(t.data.body || '').split(/\n{2,}/).length} paragraphes</small></span><span class="muted">Modifier ›</span></button>`).join('')}</div></div>`;
  const edit = (t) => {
    const m = formModal({
      title: t ? t.data.name : 'Nouveau modèle de contrat', wide: true, values: t ? t.data : { party: 'client', body: 'TITRE DU CONTRAT\n\nEntre {societe}, {societe_adresse}, et {client}, {client_adresse}.\n\nArticle 1 – Objet\n…\n\nFait à [à compléter], le {date}.' },
      fields: [{ name: 'name', label: 'Nom du modèle', required: true }, { name: 'party', label: 'Signé avec', type: 'select', options: Object.entries(CT_PARTIES) },
        { name: 'vars', type: 'html', cls: 'full', html: `<div class="field"><span>Champs automatiques (touchez pour insérer)</span><div class="chips ct-vars">${CT_VARS.map(([k, l]) => `<button type="button" class="chip" data-v="${k}" title="${esc(l)}">{${k}}</button>`).join('')}</div></div>` },
        { name: 'body', label: 'Texte du modèle', type: 'textarea', rows: 22, cls: 'full' }],
      onDelete: t ? async () => { await db.del('contracttpl', t.id); render(); } : null,
      async onSave(v) { const it = t || { data: {} }; it.data = { ...it.data, ...v }; delete it.data.vars; await persist('contracttpl', it); toast('Modèle enregistré'); render(); },
    });
    const ta = $('[name=body]', m.el);
    $$('[data-v]', m.el).forEach((b) => { b.onclick = () => { const s = ta.selectionStart; const ins = `{${b.dataset.v}}`; ta.setRangeText(ins, s, ta.selectionEnd, 'end'); ta.focus(); }; });
  };
  $$('[data-t]', page).forEach((b) => { b.onclick = () => edit(byId(tpls, +b.dataset.t)); });
  $('[data-act=new]', page).onclick = () => edit(null);
}
