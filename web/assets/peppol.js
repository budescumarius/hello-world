'use strict';
/* Facturation électronique Peppol : export UBL (Peppol BIS Billing 3.0), contrôles EN 16931, vérification
   de l'enregistrement d'un client dans l'annuaire Peppol et import des factures fournisseurs reçues (UBL). */

const COUNTRIES = { belgique: 'BE', belgie: 'BE', belgië: 'BE', belgium: 'BE', france: 'FR', luxembourg: 'LU', 'pays-bas': 'NL', nederland: 'NL', netherlands: 'NL', allemagne: 'DE', deutschland: 'DE', germany: 'DE', roumanie: 'RO', romania: 'RO', 'românia': 'RO', suisse: 'CH', italie: 'IT', espagne: 'ES', portugal: 'PT' };
function countryCode(name, fallback) {
  const s = String(name || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRIES[s.toLowerCase()] || fallback || company().country || 'BE';
}
// Numéro d'entreprise belge (10 chiffres) à partir d'un n° TVA « BE 0123.456.789 »
const enterpriseNo = (vat) => { const dg = String(vat || '').replace(/\D/g, ''); return dg.length === 9 ? '0' + dg : dg.length === 10 ? dg : ''; };
const vatId = (vat, cc) => { const v = String(vat || '').replace(/[\s.\-]/g, '').toUpperCase(); if (!v) return ''; return /^[A-Z]{2}/.test(v) ? v : (cc || 'BE') + v; };
// Identifiant Peppol « schéma:valeur » ; en Belgique : 0208 + numéro d'entreprise
function peppolIdOf(d, cc) {
  if (d.peppolId) return String(d.peppolId).trim();
  if ((cc || 'BE') === 'BE' && enterpriseNo(d.vat)) return '0208:' + enterpriseNo(d.vat);
  if (d.vat) return `${{ FR: '9957', NL: '9944', LU: '9938', DE: '9930' }[cc] || '9925'}:${vatId(d.vat, cc)}`;
  return '';
}
const UNIT_CODES = { u: 'C62', pc: 'H87', 'pièce': 'H87', m: 'MTR', ml: 'MTR', 'm²': 'MTK', m2: 'MTK', 'm³': 'MTQ', m3: 'MTQ', kg: 'KGM', t: 'TNE', l: 'LTR', h: 'HUR', j: 'DAY', jour: 'DAY', ens: 'SET', forfait: 'C62', sac: 'C62' };
const unitCode = (u) => UNIT_CODES[String(u || '').trim().toLowerCase()] || 'C62';
const xe = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const amt = (x) => (r2(x) || 0).toFixed(2);
const qtyS = (x) => String(Math.round(num(x) * 10000) / 10000);
// Adresse multi-lignes → { street, zip, city }
function splitAddress(text) {
  const lines = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const out = { street: lines[0] || '', zip: '', city: '' };
  const last = lines.length > 1 ? lines[lines.length - 1] : '';
  const m = last.match(/^(?:[A-Z]{1,2}[-\s]?)?(\d{4,5})\s+(.+)$/);
  if (m) { out.zip = m[1]; out.city = m[2]; }
  return out;
}
function sellerInfo() {
  const co = company();
  const a = splitAddress(co.address);
  const cc = countryCode(co.country, 'BE');
  return { name: co.name, street: co.street || a.street, zip: co.zip || a.zip, city: co.city || a.city, cc, vat: vatId(co.vat, cc), enterprise: co.enterprise || enterpriseNo(co.vat),
    peppolId: co.peppolId || (cc === 'BE' && (co.enterprise || enterpriseNo(co.vat)) ? '0208:' + (co.enterprise || enterpriseNo(co.vat)) : ''), email: co.email, phone: co.phone, iban: String(co.iban || '').replace(/\s/g, ''), bic: co.bic };
}
function buyerInfo(c) {
  const d = (c && c.data) || {};
  const cc = countryCode(d.country);
  return { name: contactName(c), street: d.address || '', zip: d.zip || '', city: d.city || '', cc, vat: vatId(d.vat, cc), enterprise: cc === 'BE' ? enterpriseNo(d.vat) : '', peppolId: peppolIdOf(d, cc), email: d.email, isCompany: !!(d.company || d.vat) };
}

// ---------------------------------------------------------------- Contrôles avant envoi
function peppolChecks(it, client) {
  const d = it.data; const s = sellerInfo(); const b = buyerInfo(client);
  const err = []; const warn = [];
  if (d.status !== 'emise') err.push('La facture doit être validée (numéro définitif) avant l\'envoi Peppol.');
  if (!client) err.push('Aucun client sur la facture.');
  if (!s.name) err.push('Raison sociale de votre entreprise manquante (Paramètres).');
  if (!s.vat) err.push('Numéro de TVA de votre entreprise manquant (Paramètres).');
  if (!s.peppolId) err.push('Identifiant Peppol de votre entreprise manquant (Paramètres → Peppol).');
  if (!s.street || !s.city || !s.zip) err.push('Adresse de votre entreprise incomplète : rue, code postal et localité (Paramètres → Peppol).');
  if (!s.iban) warn.push('IBAN absent : le client ne verra pas de coordonnées de paiement.');
  if (client) {
    if (!b.peppolId) err.push(`Identifiant Peppol du client manquant : indiquez son n° de TVA ou d'entreprise (fiche de ${b.name}).`);
    if (!b.street || !b.city || !b.zip) err.push(`Adresse du client incomplète (fiche de ${b.name}).`);
    if (!b.isCompany) warn.push('Le client semble être un particulier : Peppol concerne les entreprises (B2B). Pour un particulier, envoyez le PDF.');
  }
  if (d.reverse && !b.vat) err.push('Autoliquidation : le n° de TVA du client est obligatoire.');
  const items = (d.lines || []).filter((l) => l.kind === 'item' && !l.option);
  if (!items.length) err.push('La facture ne contient aucune ligne.');
  if (items.some((l) => !String(l.desc || '').trim())) err.push('Certaines lignes n\'ont pas de désignation.');
  const t = totals(d);
  if (d.kind !== 'avoir' && t.total < 0) err.push('Le total est négatif : utilisez une note de crédit.');
  if (d.kind === 'avoir' && t.total > 0) err.push('Une note de crédit doit avoir un total négatif dans l\'application (quantités négatives).');
  return { err, warn, s, b };
}

// ---------------------------------------------------------------- Génération UBL (Peppol BIS Billing 3.0)
function buildUBL(it, client, project) {
  const d = it.data; const s = sellerInfo(); const b = buyerInfo(client);
  const isCN = d.kind === 'avoir';
  const sign = isCN ? -1 : 1; // une note de crédit Peppol porte des montants positifs
  const cur = company().currency || 'EUR';
  const t = totals(d);
  const cat = (rate) => (d.reverse ? 'AE' : num(rate) === 0 ? 'Z' : 'S');
  const taxCat = (rate, tag = 'cac:TaxCategory') => `<${tag}><cbc:ID>${cat(rate)}</cbc:ID><cbc:Percent>${d.reverse ? 0 : num(rate)}</cbc:Percent>${d.reverse && tag === 'cac:TaxCategory' ? '<cbc:TaxExemptionReasonCode>VATEX-EU-AE</cbc:TaxExemptionReasonCode><cbc:TaxExemptionReason>Autoliquidation</cbc:TaxExemptionReason>' : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></${tag}>`;
  const [sScheme, ...sRest] = s.peppolId.split(':'); const [bScheme, ...bRest] = b.peppolId.split(':');
  const party = (p, scheme, id, withEnterprise) => `<cac:Party>
      <cbc:EndpointID schemeID="${xe(scheme)}">${xe(id)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${xe(p.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress><cbc:StreetName>${xe(p.street)}</cbc:StreetName><cbc:CityName>${xe(p.city)}</cbc:CityName><cbc:PostalZone>${xe(p.zip)}</cbc:PostalZone><cac:Country><cbc:IdentificationCode>${p.cc}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${p.vat ? `<cac:PartyTaxScheme><cbc:CompanyID>${xe(p.vat)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xe(p.name)}</cbc:RegistrationName>${withEnterprise && p.enterprise ? `<cbc:CompanyID schemeID="0208">${xe(p.enterprise)}</cbc:CompanyID>` : ''}</cac:PartyLegalEntity>
      ${p.email || p.phone ? `<cac:Contact>${p.phone ? `<cbc:Telephone>${xe(p.phone)}</cbc:Telephone>` : ''}${p.email ? `<cbc:ElectronicMail>${xe(p.email)}</cbc:ElectronicMail>` : ''}</cac:Contact>` : ''}
    </cac:Party>`;
  // Lignes : le prix net ne peut pas être négatif (BR-27) → une déduction devient une quantité négative
  const items = (d.lines || []).filter((l) => l.kind === 'item' && !l.option);
  const lineTag = isCN ? 'CreditNoteLine' : 'InvoiceLine'; const qtyTag = isCN ? 'CreditedQuantity' : 'InvoicedQuantity';
  let sumLines = 0;
  const lines = items.map((l, i) => {
    let q = num(l.qty) * sign; let p = num(l.price);
    if (p < 0) { p = -p; q = -q; }
    const ext = r2(num(l.qty) * num(l.price)) * sign;
    sumLines += ext;
    const [name, ...more] = String(l.desc || '').split('\n');
    return `<cac:${lineTag}><cbc:ID>${i + 1}</cbc:ID><cbc:${qtyTag} unitCode="${unitCode(l.unit)}">${qtyS(q)}</cbc:${qtyTag}><cbc:LineExtensionAmount currencyID="${cur}">${amt(ext)}</cbc:LineExtensionAmount>
      <cac:Item>${more.join(' ').trim() ? `<cbc:Description>${xe(more.join(' ').trim())}</cbc:Description>` : ''}<cbc:Name>${xe(name.slice(0, 200) || 'Prestation')}</cbc:Name>${taxCat(l.vat, 'cac:ClassifiedTaxCategory')}</cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${cur}">${p.toFixed(4).replace(/0{1,2}$/, '')}</cbc:PriceAmount></cac:Price></cac:${lineTag}>`;
  });
  const allowances = t.vats.filter((v) => v.allowance).map((v) => `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReason>Remise ${fnum(num(d.discount))} %</cbc:AllowanceChargeReason><cbc:Amount currencyID="${cur}">${amt(v.allowance * sign)}</cbc:Amount>${taxCat(v.rate)}</cac:AllowanceCharge>`).join('');
  const subtotals = t.vats.map((v) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${cur}">${amt(v.base * sign)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${cur}">${amt(v.vat * sign)}</cbc:TaxAmount>${taxCat(v.rate)}</cac:TaxSubtotal>`).join('');
  const paid = isCN ? 0 : r2((d.payments || []).reduce((a, p) => a + num(p.amount), 0));
  const due = r2(t.total * sign - paid);
  const root = isCN ? 'CreditNote' : 'Invoice';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xe(it.number)}</cbc:ID>
  <cbc:IssueDate>${d.date}</cbc:IssueDate>
  ${!isCN && d.due ? `<cbc:DueDate>${d.due}</cbc:DueDate>` : ''}
  <cbc:${isCN ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${isCN ? 381 : 380}</cbc:${isCN ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  ${[d.title, d.notes].filter(Boolean).length ? `<cbc:Note>${xe([d.title, d.notes].filter(Boolean).join(' – ').slice(0, 1000))}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xe(d.ref || (project ? project.data.name : '') || it.number)}</cbc:BuyerReference>
  ${isCN && d.refInvoice ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xe(d.refInvoice)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  ${project && !isCN ? `<cac:ProjectReference><cbc:ID>${xe(project.number || project.data.name)}</cbc:ID></cac:ProjectReference>` : ''}
  <cac:AccountingSupplierParty>${party(s, sScheme, sRest.join(':'), true)}</cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>${party(b, bScheme, bRest.join(':'), true)}</cac:AccountingCustomerParty>
  ${s.iban && !isCN ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>${d.communication || it.number ? `<cbc:PaymentID>${xe(d.communication || it.number)}</cbc:PaymentID>` : ''}<cac:PayeeFinancialAccount><cbc:ID>${xe(s.iban)}</cbc:ID>${s.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${xe(s.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount></cac:PaymentMeans>` : ''}
  ${!isCN && d.due ? `<cac:PaymentTerms><cbc:Note>Paiement avant le ${fmtDate(d.due)}</cbc:Note></cac:PaymentTerms>` : ''}
  ${allowances}
  <cac:TaxTotal><cbc:TaxAmount currencyID="${cur}">${amt(t.vat * sign)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${amt(sumLines)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${amt(t.base * sign)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${amt(t.total * sign)}</cbc:TaxInclusiveAmount>
    ${t.discount ? `<cbc:AllowanceTotalAmount currencyID="${cur}">${amt(t.discount * sign)}</cbc:AllowanceTotalAmount>` : ''}
    ${paid ? `<cbc:PrepaidAmount currencyID="${cur}">${amt(paid)}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount currencyID="${cur}">${amt(due)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lines.join('\n  ')}
</${root}>`.replace(/\n\s*\n/g, '\n');
}

// ---------------------------------------------------------------- Écran Peppol d'une facture
async function peppolInvoice(it) {
  const [contacts, project] = await Promise.all([db.list('contact'), it.project_id ? db.get('project', it.project_id).catch(() => null) : null]);
  const client = byId(contacts, it.data.clientId);
  const { err, warn, b } = peppolChecks(it, client);
  const pe = it.data.peppol || {};
  const m = modal(`${mhead('Facturation électronique Peppol')}<div class="m-body">
    <div class="peppol-st">${pe.sentAt ? badge(`Envoyée via Peppol le ${fmtDate(pe.sentAt)}`, '#2f9e44') : pe.generatedAt ? badge(`Fichier UBL généré le ${fmtDate(pe.generatedAt)}`, '#3b5bdb') : badge('Pas encore envoyée', '#868e96')}</div>
    <div class="kv-list"><div><span>Client</span><b>${esc(b.name)}</b></div><div><span>Identifiant Peppol</span><b>${esc(b.peppolId || '—')}</b> <button class="btn sm" data-look ${b.peppolId ? '' : 'disabled'}>Vérifier dans l'annuaire</button></div><div data-lookres></div></div>
    ${err.length ? `<div class="alert"><b>À corriger avant l'envoi :</b><ul>${err.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '<div class="alert ok">✔ La facture respecte les règles Peppol BIS 3.0 vérifiées par l\'application.</div>'}
    ${warn.length ? `<div class="alert info"><ul>${warn.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <p class="muted sm">Le fichier UBL (format Peppol BIS Billing 3.0) est accepté par tous les points d'accès Peppol. ${peppolApOn() ? 'Avec la connexion Peppyrus, « Envoyer via Peppol » l\'envoie directement.' : 'Importez-le dans le portail de votre point d\'accès Peppol, puis marquez la facture comme envoyée.'}</p>
  </div><div class="m-foot"><button class="btn" data-mark>${pe.sentAt ? 'Annuler « envoyée »' : 'Marquer comme envoyée'}</button><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn ${peppolApOn() ? '' : 'primary'}" data-dl ${err.length ? 'disabled' : ''}>Télécharger le fichier UBL</button>${peppolApOn() ? `<button class="btn primary" data-send ${err.length || pe.sentAt ? 'disabled' : ''}>Envoyer via Peppol</button>` : ''}</div>`, { wide: true });
  const snd = $('[data-send]', m.el);
  if (snd) snd.onclick = async () => {
    if (!confirm(`Envoyer la facture ${it.number} à ${b.name} (${b.peppolId}) via Peppol ?`)) return;
    snd.disabled = true; snd.textContent = 'Envoi…';
    try {
      const r = await api('POST', 'peppol/send', { xml: buildUBL(it, client, project), recipient: b.peppolId, credit: it.data.kind === 'avoir', invoice_id: it.id });
      it.data.peppol = { ...pe, generatedAt: today(), sentAt: today(), sentBy: S.me.id, msgId: r.id || null, via: 'peppyrus' };
      await persist('invoice', it); m.close(); toast('Facture envoyée via Peppol', 3500); render();
    } catch (e) { toast(e.message, 8000); snd.disabled = false; snd.textContent = 'Envoyer via Peppol'; }
  };
  $('[data-dl]', m.el).onclick = async () => {
    const xml = buildUBL(it, client, project);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    a.download = `${it.number}.xml`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    it.data.peppol = { ...pe, generatedAt: today() };
    await persist('invoice', it, { silent: true });
    toast('Fichier UBL téléchargé');
  };
  $('[data-mark]', m.el).onclick = async () => {
    it.data.peppol = { ...pe, sentAt: pe.sentAt ? null : today(), sentBy: S.me.id };
    await persist('invoice', it); m.close(); render();
  };
  $('[data-look]', m.el).onclick = () => peppolLookupInto($('[data-lookres]', m.el), b.peppolId);
}
async function peppolLookupInto(box, id) {
  box.innerHTML = '<span class="muted">Recherche dans l\'annuaire Peppol…</span>';
  try {
    const r = await api('GET', `peppol/lookup&id=${encodeURIComponent(id)}`);
    box.innerHTML = r.registered ? `<div class="alert ok">✔ Enregistré sur Peppol${r.name ? ` : <b>${esc(r.name)}</b>` : ''}${r.country ? ` (${esc(r.country)})` : ''}</div>`
      : '<div class="alert">✖ Cet identifiant n\'est pas (encore) enregistré sur Peppol. Envoyez la facture en PDF ou vérifiez l\'identifiant.</div>';
  } catch (e) { box.innerHTML = `<div class="alert">Vérification impossible : ${esc(e.message)}</div>`; }
}

// ---------------------------------------------------------------- Import d'une facture fournisseur reçue (UBL)
function parseUBL(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Fichier XML illisible');
  const root = doc.documentElement;
  const local = root.localName;
  if (!['Invoice', 'CreditNote'].includes(local)) throw new Error('Ce fichier n\'est pas une facture UBL / Peppol');
  const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
  const one = (el, ...path) => { let cur = el; for (const p of path) { cur = cur && kids(cur, p)[0]; } return cur || null; };
  const txt = (el, ...path) => { const e = one(el, ...path); return e ? e.textContent.trim() : ''; };
  const sup = one(root, 'AccountingSupplierParty', 'Party');
  const sign = local === 'CreditNote' ? -1 : 1;
  const attachments = [];
  for (const ref of kids(root, 'AdditionalDocumentReference')) {
    const bin = one(ref, 'Attachment', 'EmbeddedDocumentBinaryObject');
    if (bin && bin.textContent.trim()) attachments.push({ name: bin.getAttribute('filename') || txt(ref, 'ID') + '.pdf', mime: bin.getAttribute('mimeCode') || 'application/pdf', data: bin.textContent.replace(/\s/g, '') });
  }
  const tax = kids(root, 'TaxTotal').map((t) => num(txt(t, 'TaxAmount'))).find((x) => x) || 0;
  const base = num(txt(root, 'LegalMonetaryTotal', 'TaxExclusiveAmount'));
  return {
    kind: local, number: txt(root, 'ID'), date: txt(root, 'IssueDate'), due: txt(root, 'DueDate') || txt(root, 'PaymentMeans', 'PaymentDueDate'),
    currency: txt(root, 'DocumentCurrencyCode'),
    supplier: { name: txt(sup, 'PartyLegalEntity', 'RegistrationName') || txt(sup, 'PartyName', 'Name'), vat: txt(sup, 'PartyTaxScheme', 'CompanyID'),
      endpoint: (() => { const e = one(sup, 'EndpointID'); return e ? `${e.getAttribute('schemeID')}:${e.textContent.trim()}` : ''; })(),
      street: txt(sup, 'PostalAddress', 'StreetName'), city: txt(sup, 'PostalAddress', 'CityName'), zip: txt(sup, 'PostalAddress', 'PostalZone'),
      country: txt(sup, 'PostalAddress', 'Country', 'IdentificationCode'), email: txt(sup, 'Contact', 'ElectronicMail') },
    base: base * sign, tax: tax * sign, total: num(txt(root, 'LegalMonetaryTotal', 'TaxInclusiveAmount')) * sign, payable: num(txt(root, 'LegalMonetaryTotal', 'PayableAmount')) * sign,
    lines: [...kids(root, 'InvoiceLine'), ...kids(root, 'CreditNoteLine')].map((l) => txt(l, 'Item', 'Name')).filter(Boolean),
    attachments,
  };
}
// ---------------------------------------------------------------- Paramètres Peppol
function peppolSettings(page) {
  const co = { ...company() }; const s = sellerInfo();
  const fields = [
    { name: 'enterprise', label: 'Numéro d\'entreprise (BCE / KBO)', placeholder: '0123.456.789' },
    { name: 'peppolId', label: 'Identifiant Peppol', placeholder: '0208:0123456789', hint: 'Belgique : 0208 suivi du numéro d\'entreprise (10 chiffres)' },
    { name: 'street', label: 'Rue et numéro', cls: 'full' }, { name: 'zip', label: 'Code postal' }, { name: 'city', label: 'Localité' },
  ];
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Votre entreprise sur Peppol</h3><button class="btn sm" data-look>Vérifier mon enregistrement</button></div>
    <div data-lookres></div><form>${fieldsGrid(fields, { enterprise: s.enterprise, peppolId: s.peppolId, street: s.street, zip: s.zip, city: s.city })}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div></form></div>
    <div class="card"><div class="card-h"><h3>Réception et envoi automatiques</h3>${peppolApOn() ? badge('Connecté', '#2f9e44') : badge('Non connecté', '#868e96')}</div>
      <p class="muted">Avec un point d'accès <b>Peppyrus</b> (gratuit pour les entreprises belges), les factures de vos fournisseurs arrivent toutes seules dans <b>Achats & dépenses</b> (avec leur PDF), et vos factures partent directement sur Peppol depuis l'application.</p>
      <form data-ap>${fieldsGrid(AP_FIELDS(), { env: (S.settings.peppolap || {}).env || 'prod', key: '' })}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" data-aptest ${peppolApOn() ? '' : 'disabled'}>Tester la connexion</button><button class="btn" type="button" data-apsync ${peppolApOn() ? '' : 'disabled'}>Relever maintenant</button></div></form>
      ${S.settings.peppol_sync && S.settings.peppol_sync.at ? `<p class="muted sm">Dernière relève : ${fmtDT(S.settings.peppol_sync.at)}${S.settings.peppol_sync.errors && S.settings.peppol_sync.errors.length ? ` – <span class="late">${esc(S.settings.peppol_sync.errors[0])}</span>` : ''}</p>` : ''}
      <ol class="steps">
        <li>Créez un compte gratuit sur <a href="https://www.peppyrus.be" target="_blank" rel="noopener">peppyrus.be</a> et enregistrez votre entreprise (identifiant <b>0208:</b> + numéro d'entreprise).</li>
        <li>Un identifiant Peppol ne peut être actif que chez <b>un seul point d'accès</b> : si vous recevez aujourd'hui vos factures ailleurs (par ex. via Vertuoza), demandez-leur de <b>libérer votre identifiant Peppol</b>, puis activez-le chez Peppyrus. Faites-le après avoir traité les dernières factures reçues là-bas.</li>
        <li>Dans Peppyrus, créez une <b>clé API</b> et collez-la ci-dessus, puis « Tester la connexion ».</li>
        <li>Les factures reçues sont relevées à l'ouverture de l'application (toutes les 10 minutes au plus). Pour une relève même quand personne n'est connecté, ajoutez dans cPanel › <b>Tâches cron</b> (toutes les 15 minutes) : <code>php ${esc(location.pathname.replace(/[^/]*$/, ''))}cron.php</code> avec le chemin complet de votre dossier (ex. <code>/home/votrecompte/public_html/cron.php</code>).</li>
      </ol></div>
    <div class="card"><div class="card-h"><h3>Comment ça marche</h3></div><ol class="steps">
      <li>Depuis le 1<sup>er</sup> janvier 2026, les factures entre entreprises belges doivent être envoyées et reçues via le réseau <b>Peppol</b>.</li>
      <li>Pour envoyer et recevoir, il faut être inscrit auprès d'un <b>point d'accès Peppol</b> agréé (fournisseur de services, souvent payant ; le SPF Finances propose aussi la solution gratuite <b>Hermes</b> pour de petits volumes).</li>
      <li>Dans l'application : validez la facture, puis <b>Actions → Peppol</b>. Les données sont contrôlées et le fichier <b>UBL Peppol BIS 3.0</b> est généré ; importez-le chez votre point d'accès.</li>
      <li>Sans connexion automatique, les factures fournisseurs (PDF ou XML) s'importent dans <b>Finances → Achats & dépenses → Importer une facture</b>.</li>
      <li>Vérifiez sur chaque fiche client que son numéro de TVA / d'entreprise est correct : l'identifiant Peppol en est déduit, et le bouton « Vérifier » consulte l'annuaire officiel.</li>
    </ol></div>`;
  const form = $('form', page);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = readFields(form, fields);
    v.enterprise = v.enterprise.replace(/\D/g, '');
    if (v.enterprise.length === 9) v.enterprise = '0' + v.enterprise;
    if (!v.peppolId && v.enterprise) v.peppolId = '0208:' + v.enterprise;
    Object.assign(co, v);
    await api('PUT', 'settings', { company: co }); S.settings.company = co;
    toast('Paramètres Peppol enregistrés'); render();
  };
  $('[data-look]', page).onclick = () => { const id = sellerInfo().peppolId; if (!id) return toast('Indiquez d\'abord votre identifiant Peppol'); peppolLookupInto($('[data-lookres]', page), id); };
  const apf = $('[data-ap]', page);
  apf.onsubmit = async (e) => {
    e.preventDefault();
    const v = readFields(apf, AP_FIELDS());
    await api('PUT', 'settings', { peppolap: { provider: 'peppyrus', env: v.env, key: v.key } });
    S.settings.peppolap = { provider: 'peppyrus', env: v.env, hasKey: !!v.key || peppolApOn() };
    toast('Connexion Peppol enregistrée'); render();
  };
  $('[data-aptest]', page).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api('POST', 'peppol/test'); toast(`Connexion réussie – ${r.waiting} document(s) en attente`, 4000); } catch (err) { toast(err.message, 8000); } finally { b.disabled = false; }
  };
  $('[data-apsync]', page).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; await peppolSync({ force: true, quiet: false }); b.disabled = false; };
}
const AP_FIELDS = () => [
  { name: 'key', label: 'Clé API Peppyrus', type: 'password', placeholder: peppolApOn() ? '•••••••• (inchangée)' : 'collez la clé API' },
  { name: 'env', label: 'Environnement', type: 'select', options: [['prod', 'Production'], ['test', 'Test (api.test.peppyrus.be)']] },
];
