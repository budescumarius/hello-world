'use strict';
/* Obligations sociales belges (construction) :
   - déclaration de travaux (art. 30bis) et enregistrement Checkin@Work, sur la page du chantier ;
   - obligation de retenue (dettes sociales / fiscales) avant de payer un sous-traitant.
   Les services officiels (socialsecurity.be) demandent une connexion eID / itsme : l'application prépare les données à recopier,
   ouvre le service et garde le numéro de déclaration, le résultat de la vérification et l'attestation. */

const SOC_DEF = {
  urlDecl: 'https://www.socialsecurity.be/site_fr/employer/applics/30bis/index.htm',
  urlCheckin: 'https://www.socialsecurity.be/site_fr/employer/applics/checkinatwork/index.htm',
  urlRetenue: 'https://www.socialsecurity.be/site_fr/employer/applics/30bis/index.htm',
  seuilDecl: 30000, seuilCheckin: 500000, tauxSocial: 35, tauxFiscal: 15,
};
const soc = () => ({ ...SOC_DEF, ...(S.settings.social || {}) });

const copyTxt = async (v) => { try { await navigator.clipboard.writeText(v); toast('Copié', 1200); } catch (e) { toast('Copie impossible : sélectionnez le texte', 2500); } };
// Liste « libellé / valeur » avec un bouton copier par ligne
const copyRows = (rows) => `<div class="copy-rows">${rows.filter(([, v]) => v).map(([l, v], i) => `<div><span class="muted">${esc(l)}</span><b>${esc(v)}</b><button type="button" class="icon-btn sm" data-cp="${i}" title="Copier">${I.copy}</button></div>`).join('')}</div>`;
const bindCopy = (root, rows) => { const list = rows.filter(([, v]) => v); $$('[data-cp]', root).forEach((b) => { b.onclick = () => copyTxt(String(list[+b.dataset.cp][1])); }); };
const entNo = (vat) => { const e = enterpriseNo(vat); return e ? `${e.slice(0, 4)}.${e.slice(4, 7)}.${e.slice(7)}` : ''; };

// ---------------------------------------------------------------- Chantier : déclaration de travaux + Checkin@Work
// ht = montant HT des devis acceptés du chantier ; les enregistrements sont gardés sur le chantier (p.data.decl30bis / p.data.checkin)
function socialProjectCard(p, ht, quotes = []) {
  const d = p.data; const s = soc();
  // anciens enregistrements faits depuis un devis : repris
  const fromQ = (k) => (k in d ? d[k] : (quotes.find((q) => q.data[k]) || { data: {} }).data[k]);
  const needDecl = ht >= s.seuilDecl; const needCheckin = ht >= s.seuilCheckin;
  const line = (key, label, btn, need, why, rec) => `<div class="soc-row">
      <div class="grow"><b>${label}</b><br><small class="${need && !rec ? 'late' : 'muted'}">${esc(why)}</small>
      ${rec ? `<br><small class="good">✓ ${esc(rec.no ? 'N° ' + rec.no : 'Fait')} – ${fmtDate(rec.date)}</small>` : ''}</div>
      <button class="btn sm ${need && !rec ? 'primary' : ''}" data-soc="${key}">${rec ? 'Voir / modifier' : btn}</button></div>`;
  return `<div class="card soc-card"><div class="card-h"><h3>Obligations sociales</h3><small class="muted">Devis acceptés : ${money(ht)} HT</small></div>
    ${line('decl30bis', 'Déclaration de travaux (30bis)', 'Déclarer les travaux', needDecl, needDecl ? `Obligatoire : montant ≥ ${money(s.seuilDecl)} HT` : `Non obligatoire sous ${money(s.seuilDecl)} HT (sauf sous-traitance sur un chantier qui y est soumis)`, fromQ('decl30bis'))}
    ${line('checkin', 'Checkin@Work', 'Faire le Checkin', needCheckin, needCheckin ? `Obligatoire : chantier ≥ ${money(s.seuilCheckin)} HT – enregistrer chaque jour les personnes présentes` : `Non obligatoire sous ${money(s.seuilCheckin)} HT`, fromQ('checkin'))}
  </div>`;
}
function bindSocialProject(root, p, c, ht, quotes, after) {
  $$('[data-soc]', root).forEach((b) => { b.onclick = () => socialDialog(b.dataset.soc, p, c, ht, quotes, after); });
}
function socialDialog(key, p, c, ht, quotes, after) {
  const d = p.data; const s = soc(); const co = company(); const cd = (c && c.data) || {};
  const isDecl = key === 'decl30bis';
  const site = [d.address, [d.zip, d.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const rows = [
    ['Commettant (client)', contactName(c)],
    ['N° d\'entreprise du client', entNo(cd.vat) || (cd.vat ? cd.vat : 'particulier (pas de n° d\'entreprise)')],
    ['Adresse du client', [cd.address, [cd.zip, cd.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Adresse du chantier', site],
    ['Nature des travaux', d.name || ''],
    ['Montant des travaux HT', fnum(ht)],
    ['Date de début', fmtDate(d.start || today())],
    ['Date de fin prévue', fmtDate(d.end)],
    ['Notre n° d\'entreprise', entNo(co.vat)],
    ['Référence du chantier', p.number],
    ['Devis', quotes.filter((q) => q.data.status === 'accepte').map((q) => q.number).join(', ')],
  ];
  const rec = (key in d ? d[key] : (quotes.find((q) => q.data[key]) || { data: {} }).data[key]) || {};
  formModal({
    title: isDecl ? 'Déclaration de travaux (30bis)' : 'Checkin@Work', wide: true, saveLabel: 'Enregistrer',
    values: { no: rec.no || '', date: rec.date || today(), note: rec.note || '' },
    fields: [
      { name: 'h', type: 'html', cls: 'full', html: `<div class="hint-box">1. Ouvrez le service officiel (connexion eID / itsme). 2. Recopiez les données ci-dessous (bouton copier). 3. Notez ici le numéro ${isDecl ? 'de déclaration' : 'du chantier / de l\'enregistrement'}.</div>
        <div class="btns"><a class="btn primary" href="${esc(isDecl ? s.urlDecl : s.urlCheckin)}" target="_blank" rel="noopener">${I.send} Ouvrir ${isDecl ? 'la déclaration de travaux' : 'Checkin@Work'} (ONSS)</a></div>
        <div class="section-t">Données à recopier</div>${copyRows(rows)}` },
      { name: 'no', label: isDecl ? 'N° de la déclaration' : 'N° du chantier / de l\'enregistrement' }, { name: 'date', label: 'Date', type: 'date' },
      { name: 'note', label: 'Remarque', cls: 'full' },
    ],
    after: (form) => bindCopy(form, rows),
    onDelete: rec.date ? async () => { d[key] = null; await persist('project', p); if (after) after(); } : null,
    async onSave(v) { d[key] = { no: v.no, date: v.date || today(), note: v.note }; await persist('project', p); toast('Enregistré'); if (after) after(); },
  });
}

// ---------------------------------------------------------------- Sous-traitant : obligation de retenue (dettes sociales / fiscales)
const RET_RES = { none: 'Pas d\'obligation de retenue', social: 'Retenue : dettes sociales (ONSS)', fiscal: 'Retenue : dettes fiscales (SPF Finances)', both: 'Retenue : dettes sociales et fiscales' };
function retentionCalc(d) {
  const s = soc(); const r = (d.retention || {}).result; const ht = num(d.amount);
  const social = ['social', 'both'].includes(r) ? r2(ht * s.tauxSocial / 100) : 0;
  const fiscal = ['fiscal', 'both'].includes(r) ? r2(ht * s.tauxFiscal / 100) : 0;
  return { ht, social, fiscal, toSupplier: r2(purchTtc(d) - social - fiscal) };
}
// Encadré sur la page de la facture d'un sous-traitant
function retentionBox(box, e, supplier, onChange) {
  const d = e.data; const s = soc(); const sd = (supplier && supplier.data) || {};
  const draw = () => {
    const rt = d.retention || {}; const k = retentionCalc(d);
    const old = rt.date && rt.date !== today();
    box.innerHTML = `<div class="card-h"><h3>Obligation de retenue (sous-traitant)</h3>${rt.result ? badge(rt.result === 'none' ? 'Pas de retenue' : 'Retenue', rt.result === 'none' ? '#2f9e44' : '#e5484d') : badge('À vérifier', '#f08c00')}</div>
      <p class="muted">À vérifier le jour de chaque paiement : si le sous-traitant a des dettes sociales ou fiscales, vous devez retenir ${s.tauxSocial} % (ONSS) et/ou ${s.tauxFiscal} % (SPF Finances) du montant HTVA et les verser vous-même, sinon vous êtes solidairement responsable.</p>
      ${copyRows([['N° d\'entreprise du sous-traitant', entNo(sd.vat) || sd.vat || '']])}
      ${rt.result ? `<div class="soc-res"><b>${esc(RET_RES[rt.result])}</b> – vérifié le ${fmtDate(rt.date)}${old ? ' <span class="late">(à refaire le jour du paiement)</span>' : ''}${rt.fileName ? ` · attestation : ${esc(rt.fileName)}` : ''}</div>` : ''}
      ${rt.result && rt.result !== 'none' ? `<div class="pay-info"><div><span>Montant HTVA</span><b>${money(k.ht)}</b></div>${k.social ? `<div><span>À verser à l'ONSS (${s.tauxSocial} %)</span><b>${money(k.social)}</b></div>` : ''}${k.fiscal ? `<div><span>À verser au SPF Finances (${s.tauxFiscal} %)</span><b>${money(k.fiscal)}</b></div>` : ''}<div class="dark"><span>À payer au sous-traitant</span><b>${money(k.toSupplier)}</b></div></div>
        <small class="muted">La retenue est limitée au montant des dettes renseigné par le service officiel.</small>` : ''}
      <div class="btns"><a class="btn primary" href="${esc(s.urlRetenue)}" target="_blank" rel="noopener" data-open>${I.send} Vérifier sur le site officiel</a>
        <button type="button" class="btn" data-ret>${rt.result ? 'Modifier le résultat' : 'Encoder le résultat'}</button>
        <button type="button" class="btn" data-print ${rt.result ? '' : 'disabled'}>${I.print} Imprimer l'attestation</button></div>`;
    bindCopy(box, [['', entNo(sd.vat) || sd.vat || '']]);
    $('[data-open]', box).addEventListener('click', () => { const n = enterpriseNo(sd.vat); if (n) copyTxt(n); });
    $('[data-ret]', box).onclick = edit;
    $('[data-print]', box).onclick = () => retentionPrint(e, supplier);
  };
  const edit = () => {
    const rt = d.retention || {}; let file = rt.fileId ? { id: rt.fileId, name: rt.fileName } : null;
    formModal({
      title: 'Résultat de la vérification', values: { result: rt.result || 'none', date: rt.date || today(), ref: rt.ref || '' },
      fields: [
        { name: 'result', label: 'Résultat', type: 'select', options: Object.entries(RET_RES), cls: 'full' },
        { name: 'date', label: 'Date de la vérification', type: 'date' }, { name: 'ref', label: 'Référence de la consultation (facultatif)' },
        { name: 'f', type: 'html', cls: 'full', html: `<span class="lbl">Attestation (PDF ou capture du site officiel)</span><div class="file-pick"><span data-fn>${file ? esc(file.name) : '<span class="muted">Aucun fichier</span>'}</span><button type="button" class="btn sm" data-up>${I.upload} Joindre</button></div>` },
      ],
      after: (form) => { $('[data-up]', form).onclick = async () => { const [f] = await pickFile('application/pdf,image/*'); if (!f) return; toast('Envoi…', 15000); const r = f.type.startsWith('image/') ? await uploadPhoto(f) : await upload(f); file = { id: r.id, name: r.name }; $('[data-fn]', form).textContent = r.name; toast('Joint', 1200); }; },
      async onSave(v) {
        d.retention = { result: v.result, date: v.date || today(), ref: v.ref, fileId: file ? file.id : null, fileName: file ? file.name : null, by: S.me.id };
        purchLog(d, `Obligation de retenue vérifiée : ${RET_RES[v.result]}`);
        await persist('expense', e); draw(); if (onChange) onChange();
      },
    });
  };
  draw();
}
// Impression : l'attestation jointe, ou une fiche de vérification (date, résultat, montants à retenir)
function retentionPrint(e, supplier) {
  const d = e.data; const rt = d.retention || {}; const co = company(); const k = retentionCalc(d); const s = soc(); const sd = (supplier && supplier.data) || {};
  if (rt.fileId && confirm('Ouvrir l\'attestation jointe ?\n(Annuler = imprimer la fiche de vérification)')) { window.open(fileUrl(rt.fileId), '_blank'); return; }
  const html = `<div class="doc"><h1>Vérification de l'obligation de retenue</h1>
    <p class="muted">Articles 30bis loi du 27/06/1969 (dettes sociales) et 403 CIR 92 (dettes fiscales)</p>
    <table><tr><th>Donneur d'ordre</th><td>${esc(co.name || '')} – n° ${esc(entNo(co.vat))}</td></tr>
      <tr><th>Sous-traitant</th><td>${esc(contactName(supplier))} – n° ${esc(entNo(sd.vat) || sd.vat || '')}</td></tr>
      <tr><th>Facture</th><td>${esc(d.ref || '')} du ${fmtDate(d.date)} – ${money(k.ht)} HTVA / ${money(purchTtc(d))} TVAC</td></tr>
      <tr><th>Date de la vérification</th><td>${fmtDate(rt.date)}${rt.ref ? ` – réf. ${esc(rt.ref)}` : ''}</td></tr>
      <tr><th>Résultat</th><td><b>${esc(RET_RES[rt.result] || '—')}</b></td></tr>
      ${k.social ? `<tr><th>Retenue ONSS (${s.tauxSocial} %)</th><td>${money(k.social)}</td></tr>` : ''}${k.fiscal ? `<tr><th>Retenue SPF Finances (${s.tauxFiscal} %)</th><td>${money(k.fiscal)}</td></tr>` : ''}
      <tr><th>Montant à payer au sous-traitant</th><td><b>${money(k.toSupplier)}</b></td></tr>
      <tr><th>Vérifié par</th><td>${esc(userName(rt.by))}</td></tr></table>
    ${rt.fileName ? `<p>Attestation du service officiel jointe au dossier : ${esc(rt.fileName)}</p>` : ''}
    <p class="muted">Document interne généré par l'application – il ne remplace pas l'attestation du service officiel.</p></div>`;
  printPage(`Retenue ${d.ref || ''}`.trim(), html, `#/purchase/${e.id}`);
}
