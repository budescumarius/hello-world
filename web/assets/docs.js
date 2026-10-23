'use strict';
/* Modèles de documents (devis, factures, états d'avancement, notes de crédit, commandes) + mentions légales obligatoires.
   Tout est paramétrable dans Paramètres → Modèles. */

const MENTION_6 = "Taux de TVA: en l'absence de contestation par écrit, dans un délai d'un mois à compter de la réception de la facture, le client est présumé reconnaître que\n(1) les travaux sont effectués à un bâtiment d'habitation dont la première occupation a eu lieu au cours d'une année civile qui précède d'au moins (dix ou quinze ans) la date de la première facture relative à ces travaux,\n(2) qu'après l'exécution de ces travaux, l'habitation est utilisée, soit exclusivement, soit à titre principal comme logement privé et\n(3) que ces travaux sont fournis et facturés à un consommateur final.\nSi au moins une de ces conditions n'est pas remplie, le taux normal de TVA de 21% sera applicable et le client endossera, par rapport à ces conditions, la responsabilité quant au paiement de la taxe, des intérêts et des amendes dus.";
const MENTION_AL = "Autoliquidation – TVA due par le cocontractant en application de l'article 51, § 2, alinéa 1er, 5° du Code de la TVA (article 20 de l'arrêté royal n° 1).";
const MENTION_21 = "Taux normal de TVA de 21 % : appliqué aux constructions neuves, aux bâtiments de moins de dix ans et aux travaux qui ne remplissent pas les conditions du taux réduit de 6 % (logement privé de plus de dix ans, utilisé à titre principal comme habitation et facturé au consommateur final).";
// Conditions générales proposées par défaut (modifiables dans Paramètres → Modèles) : à faire vérifier par votre conseiller
const CGV_DEF = `Article 1 – Champ d'application
Les présentes conditions générales s'appliquent à toutes nos offres, devis, commandes, travaux et factures. Toute dérogation doit faire l'objet d'un accord écrit. Les conditions du client ne nous sont pas opposables.

Article 2 – Devis et commande
Nos devis sont valables pendant la durée qui y est indiquée. La commande est ferme dès la signature du devis par le client ou dès le paiement de l'acompte. Les travaux non prévus au devis font l'objet d'un avenant ou sont facturés en régie.

Article 3 – Prix
Les prix s'entendent hors TVA. Le taux de TVA appliqué dépend des informations communiquées par le client (âge du bâtiment, affectation, qualité de consommateur final) ; toute modification de ces éléments entraîne la correction du taux.

Article 4 – Délais d'exécution
Les délais sont donnés à titre indicatif. Les retards dus aux intempéries, à un cas de force majeure, aux autres corps de métier ou à des retards de livraison des fournisseurs ne peuvent donner lieu à une indemnité ni à la résiliation du contrat.

Article 5 – Acomptes et états d'avancement
Un acompte peut être demandé à la commande. Les travaux sont facturés au fur et à mesure de leur avancement. L'acompte est déduit des factures suivantes.

Article 6 – Paiement
Nos factures sont payables au compte indiqué, dans le délai mentionné sur la facture. En cas de non-paiement à l'échéance, des intérêts de retard et une indemnité forfaitaire peuvent être réclamés conformément à la législation belge applicable (loi du 2 août 2002 pour les professionnels, Code de droit économique pour les consommateurs). En cas de retard de paiement, nous nous réservons le droit de suspendre les travaux.

Article 7 – Réception et réclamations
La réception des travaux a lieu à leur achèvement. Toute réclamation relative à une facture doit être adressée par écrit dans les 15 jours de sa réception. Les vices apparents doivent être signalés au plus tard à la réception.

Article 8 – Propriété des matériaux
Les matériaux livrés restent notre propriété jusqu'au paiement complet du prix.

Article 9 – Litiges
Le droit belge est applicable. En cas de litige, les tribunaux de l'arrondissement judiciaire du siège social de l'entreprise sont compétents, sans préjudice des règles protectrices du consommateur.`;
// Modèle « Madibu » : mise en page propre à l'entreprise (règle de chantier en tête, trois cartouches émetteur / client / chantier,
// codes de ligne, totaux en carte, bloc de paiement avec QR code bancaire, pied de page légal répété sur chaque page du PDF).
const TPL_DEF = {
  style: 'madibu',
  ink: '#1f2a5a', accent: '#e0a12a', tint: '#f4f5fa', font: 'Manrope', size: 9.5, tagline: '',
  quoteTitle: 'Devis', invoiceTitle: 'Facture', creditTitle: 'Note de crédit', orderTitle: 'Bon de commande',
  showCodes: true, showTM: false, tmLabel: 'TM', showManager: true, thousands: '.',
  qr: true, payText: 'Merci de régler ce montant au plus tard le {date} sur le compte indiqué, avec la communication structurée.', payTerms: '{jours} jours après la date de facture',
  mention6: MENTION_6, mention12: '', mention21: MENTION_21, mentionAL: MENTION_AL, mentionsOnQuote: true,
  recap: true, footer: '', css: '',
  cgvTitle: 'Conditions générales', cgv: '', cgvInvoice: true, cgvQuote: true, cgvOrder: false, cgvCols: false,
};
// réglages d'apparence de l'ancien modèle : ignorés tant que le modèle Madibu n'a pas été enregistré
const TPL_OLD_LOOK = ['primary', 'band', 'light', 'payColor', 'noteColor', 'font', 'size', 'quoteTitle', 'invoiceTitle', 'creditTitle', 'orderTitle', 'payText', 'payTerms', 'css', 'showTM', 'tmLabel'];
const tpl = () => {
  const s = { ...(S.settings.template || {}) };
  if (s.style !== 'madibu') TPL_OLD_LOOK.forEach((k) => delete s[k]);
  return { ...TPL_DEF, ...s, style: 'madibu' };
};
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const CUR_SYM = { EUR: '€', CHF: 'CHF', RON: 'lei' };
function dmoney(x, t = tpl()) {
  const v = r2(x) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, t.thousands || '.')},${d} ${CUR_SYM[company().currency || 'EUR'] || company().currency}`;
}
const dnum2 = (x) => (num(x) || 0).toFixed(2).replace('.', ',');
const pctS = (x) => `${(Math.round(num(x) * 10) / 10).toFixed(1).replace('.', ',')} %`;
const dateFr = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
function longDate(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
const ibanFmt = (s) => String(s || '').replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();
const isDeduction = (l) => !!l.deduction || /^(Déduction|Deduction|Déjà facturé)/i.test(String(l.desc || ''));
function clientLabel(c) {
  if (!c) return '—';
  const d = c.data;
  if (d.company) return d.company;
  return [d.civility, d.name, d.firstname].filter(Boolean).join(' ') || '—';
}
// Intitulé du document (« Facture », « Facture d'acompte », « Note de crédit »…) sans le numéro
const isEAdoc = (kind, d) => kind === 'invoice' && d.kind === 'situation' && d.status !== 'emise';
function docLabel(kind, d, t) {
  if (isEAdoc(kind, d)) return 'État d\'avancement';
  const raw = kind === 'quote' ? t.quoteTitle : kind === 'order' ? t.orderTitle : d.kind === 'avoir' ? t.creditTitle
    : d.kind && d.kind !== 'facture' && IKIND[d.kind] ? IKIND[d.kind] : t.invoiceTitle;
  return fill(raw, { numero: '' }).replace(/\s*n[°º]?\s*$/i, '').trim() || 'Document';
}
// Ligne légale du pied de page (répétée sur chaque page du PDF)
function legalLine(t) {
  const co = company(); const s = sellerInfo();
  return [co.name, [s.street, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), co.vat && `TVA ${co.vat}`, co.iban && `IBAN ${ibanFmt(co.iban)}`, co.phone, co.email, co.website, t.footer || co.footer].filter(Boolean).join(' · ');
}
const monoOf = (n) => String(n || '?').split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// ---------------------------------------------------------------- Rendu commun
function docBlocks(kind, it, c, project, t) {
  const d = it.data; const co = company(); const s = sellerInfo();
  const cd = (c && c.data) || {};
  const isInv = kind === 'invoice'; const isQ = kind === 'quote';
  const label = docLabel(kind, d, t);
  const ea = isEAdoc(kind, d);
  const shown = ea ? `EA${d.situationNo || ''}` : it.number;
  const title = `${label} ${shown || 'brouillon'}`;
  const days = d.due && d.date ? Math.max(0, dnum(d.due) - dnum(d.date)) : null;
  const resp = userName(+(d.ownerId || it.created_by));
  const meta = [
    ['Date', dateFr(d.date)],
    isQ && ['Valable jusqu\'au', dateFr(d.valid)],
    isInv && !ea && d.kind !== 'avoir' && d.due && ['Échéance', dateFr(d.due)],
    isInv && !ea && d.kind !== 'avoir' && days != null && ['Conditions', fill(t.payTerms, { jours: days, date: fmtDate(d.due) })],
    ea && d.ea && d.ea.approveBy && ['À approuver avant', dateFr(d.ea.approveBy)],
    d.kind === 'situation' && d.situationNo && ['Avancement', `n° ${d.situationNo}`],
    d.kind === 'avoir' && d.refInvoice && ['Facture', d.refInvoice],
    kind === 'order' && d.deliveryDate && ['Livraison', dateFr(d.deliveryDate)],
    d.ref && ['Référence', d.ref],
    ['Responsable', resp],
  ].filter((x) => x && x[1]);
  const brand = co.logoId ? `<img class="mb-logo" src="${fileUrl(co.logoId)}" alt="">` : `<div class="mb-mono">${esc(monoOf(co.name))}</div>`;
  const head = `<header class="mb-head">
    <div class="mb-brand">${brand}${co.logoId ? '' : `<div class="mb-brand-n">${esc(co.name || '')}</div>`}${t.tagline ? `<div class="mb-brand-t">${esc(t.tagline)}</div>` : ''}</div>
    <div class="mb-id"><div class="mb-kind">${esc(label)}</div><div class="mb-no ${shown ? '' : 'draft'}">${esc(shown || 'Brouillon')}</div>
      <dl class="mb-meta">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div></header>`;
  // cartouches : émetteur, client (ou adresse de facturation), chantier
  const from = `<div class="mb-party"><small>Émetteur</small><b>${esc(co.name || '')}</b>${[s.street, [s.cc && s.zip ? `${s.cc}-${s.zip}` : s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>')}
    ${co.vat ? `<br>TVA ${esc(co.vat)}` : ''}${co.phone ? `<br>${esc(co.phone)}` : ''}${co.email ? `<br>${esc(co.email)}` : ''}</div>`;
  const bill = kind !== 'order' && d.billSame === false;
  const toLabel = kind === 'order' ? 'Fournisseur' : isInv ? (bill ? 'Facturé à' : 'Client') : 'Client';
  const to = bill ? `<div class="mb-party mb-to"><small>${toLabel}</small><b>${esc(d.billName || clientLabel(c))}</b>${esc(d.billAddress || '').replace(/\n/g, '<br>')}${d.billVat ? `<br>TVA ${esc(d.billVat)}` : ''}</div>`
    : `<div class="mb-party mb-to"><small>${toLabel}</small><b>${esc(kind === 'order' ? contactName(c) : clientLabel(c))}</b>
      ${cd.company && (cd.name || cd.firstname) ? `<div>Att. ${esc([cd.civility, cd.name, cd.firstname].filter(Boolean).join(' '))}</div>` : ''}
      ${[cd.address, [cd.zip, cd.city].filter(Boolean).join(' '), cd.country && !/^(Belgique|BE)$/i.test(cd.country) ? cd.country : ''].filter(Boolean).map(esc).join('<br>')}
      ${cd.vat ? `<br>TVA ${esc(cd.vat)}` : ''}</div>`;
  const pa = project ? [project.data.address, [project.data.zip, project.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : (d.siteAddress || '');
  const manager = isQ && t.showManager ? userName(+((project && project.data.managerId) || d.ownerId || it.created_by)) : '';
  const site = project || pa ? `<div class="mb-party"><small>Chantier</small>${project ? `<b>${esc(project.data.name)}</b>` : ''}${pa ? esc(pa) : ''}
    ${manager ? `<br>Gestionnaire : ${esc(manager)}` : ''}</div>` : '';
  const cols = site ? 3 : 2;
  const info = `<section class="mb-parties" style="--cols:${cols}">${from}${to}${site}</section>
    ${d.title && (!project || d.title !== project.data.name) ? `<div class="mb-object"><small>Objet</small><b>${esc(d.title)}</b></div>` : ''}`;
  return { head, info, title, label };
}

// Lignes : code (1.2.3) devant la description, quantité avec l'unité, TVA par ligne, chapitres avec sous-total
function linesTable(d, t, kind) {
  const lines = (d.lines || []).filter((l) => !isDeduction(l));
  const nos = numbering(lines); const st = sectionTotals(lines);
  const vat = kind !== 'order' && !d.reverse;
  const n = vat ? 5 : 4;
  const code = (i) => (t.showCodes && nos[i] ? `<span class="mb-code">${esc(String(nos[i]).replace(/(\.0)+$/, ''))}</span>` : '');
  return `<table class="mb-lines"><thead><tr><th>Description</th><th class="r">Quantité</th><th class="r">Prix unit. HT</th>${vat ? '<th class="r c-v">TVA</th>' : ''}<th class="r">Montant HT</th></tr></thead><tbody>
    ${lines.map((l, i) => {
      if (l.kind === 'title' && !String(l.desc || '').trim()) return '';
      if (l.kind === 'title') return `<tr class="${tlevel(l) === 2 ? 'mb-sub' : 'mb-ch'}"><td colspan="${n - 1}"><div class="mb-dl">${code(i)}<span>${esc(l.desc)}</span></div></td><td class="r">${dmoney(st[l.id], t)}</td></tr>`;
      if (l.kind === 'text') return `<tr class="mb-txt"><td colspan="${n}" class="pre">${esc(l.desc)}</td></tr>`;
      return `<tr class="${l.option ? 'mb-opt' : ''}"><td><div class="mb-dl">${code(i)}<span class="pre">${esc(l.desc)}${t.showTM && l.tm ? `<span class="mb-tag">${esc(t.tmLabel)} ${esc(l.tm)}</span>` : ''}${l.option ? '<em class="mb-pill">Option</em>' : ''}</span></div></td>
        <td class="r">${dnum2(l.qty)}<span class="mb-u">${esc(l.unit || '')}</span></td><td class="r">${dmoney(l.price, t)}</td>${vat ? `<td class="r c-v">${fnum(num(l.vat))} %</td>` : ''}<td class="r">${dmoney(num(l.qty) * num(l.price), t)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// État d'avancement : prévu, avancement (avec barre), prix, montant de la période
function progressTable(d, t) {
  const rows = d.progressRows || [];
  const nos = numbering(rows.map((r) => ({ kind: r.kind, level: r.level })));
  const period = (r) => { const l = (d.lines || []).find((x) => x.srcId === r.lineId && !isDeduction(x)); return l ? r2(num(l.qty) * num(l.price)) : 0; };
  const code = (i) => (t.showCodes && nos[i] ? `<span class="mb-code">${esc(String(nos[i]).replace(/(\.0)+$/, ''))}</span>` : '');
  return `<table class="mb-lines mb-prog"><thead><tr><th>Description</th><th class="r">Prévu</th><th class="r">Avancement</th><th class="r">Prix unit. HT</th><th class="r">Période HT</th></tr></thead><tbody>
    <tr class="mb-txt"><td colspan="5">Avancement ${esc(d.ref || `EA${d.situationNo || ''}`)}${d.title ? ` · ${esc(d.title)}` : ''}</td></tr>
    ${rows.map((r, i) => {
      if (r.kind === 'title') {
        const sub = rows.slice(i + 1, blockEnd(rows.map((x) => ({ kind: x.kind, level: x.level })), i)).filter((x) => x.kind === 'item');
        return `<tr class="${+r.level === 2 ? 'mb-sub' : 'mb-ch'}"><td colspan="4"><div class="mb-dl">${code(i)}<span>${esc(r.desc)}</span></div></td><td class="r">${dmoney(sub.reduce((a, x) => a + period(x), 0), t)}</td></tr>`;
      }
      const pc = Math.max(0, Math.min(100, num(r.cum)));
      return `<tr><td><div class="mb-dl">${code(i)}<span class="pre">${esc(r.desc)}</span></div></td><td class="r">${dnum2(r.qty)}<span class="mb-u">${esc(r.unit || '')}</span></td>
        <td class="r">${dnum2(num(r.qty) * num(r.cum) / 100)} · <b>${pctS(r.cum)}</b><div class="mb-bar"><i style="width:${pc}%"></i></div></td><td class="r">${dmoney(r.price, t)}</td><td class="r">${dmoney(period(r), t)}</td></tr>`;
    }).join('')}</tbody></table>`;
}
function progressRecap(d, t) {
  const rows = (d.progressRows || []).filter((r) => r.kind === 'item');
  const market = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price)), 0);
  const cum = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price) * num(r.cum) / 100), 0);
  const prev = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price) * num(r.prev) / 100), 0);
  return `<table class="mb-recap"><tr><th colspan="2">Récapitulatif de l'avancement</th></tr>
    <tr><td>Montant du marché HT</td><td class="r">${dmoney(market, t)}</td></tr>
    <tr><td>Travaux réalisés à ce jour (${market ? pctS((cum / market) * 100) : '0,0 %'})</td><td class="r">${dmoney(cum, t)}</td></tr>
    <tr><td>Facturé lors des états précédents</td><td class="r">${dmoney(prev, t)}</td></tr>
    <tr><td><b>Présent état d'avancement</b></td><td class="r"><b>${dmoney(cum - prev, t)}</b></td></tr>
    <tr><td>Reste à facturer</td><td class="r">${dmoney(market - cum, t)}</td></tr></table>`;
}

// QR code de virement (norme EPC « SCT », recommandation Febelfin : communication structurée belge dans la référence)
function epcPayload({ name, iban, bic, amount, comm, text }) {
  const clean = (s, n) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const ref = /^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/.test(comm || '') ? comm : '';
  return ['BCD', '002', '1', 'SCT', clean(bic, 11), clean(name, 70), String(iban || '').replace(/\s/g, '').toUpperCase(), `EUR${(r2(amount) || 0).toFixed(2)}`, '', ref, ref ? '' : clean(text || comm, 140)].join('\n').replace(/\n+$/, ''); // pas de ligne vide finale
}
async function qrDataUrl(text) {
  await loadScript('assets/vendor/qrcode-generator-1.4.4.js');
  const q = window.qrcode(0, 'M');
  window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
  q.addData(text, 'Byte'); q.make();
  return q.createDataURL(6, 0);
}

// Bas du document : paiement (IBAN, communication, QR) ou acceptation, et carte des totaux
async function totalsBlock(kind, it, t, paid) {
  const d = it.data; const tt = totals(d); const co = company();
  const deds = (d.lines || []).filter((l) => l.kind === 'item' && !l.option && isDeduction(l));
  const gross = r2((d.lines || []).filter((l) => l.kind === 'item' && !l.option && !isDeduction(l)).reduce((a, l) => a + r2(num(l.qty) * num(l.price)), 0));
  const dedGroups = {};
  for (const l of deds) { const k = l.deduction === 'acompte' || /acompte/i.test(l.desc) ? 'Déduction acompte' : String(l.desc).split(/[(–-]/)[0].trim() || 'Déduction'; dedGroups[k] = (dedGroups[k] || 0) + r2(num(l.qty) * num(l.price)); }
  const row = (label, val, cls = '') => `<div class="mb-tr ${cls}"><span>${label}</span><b>${typeof val === 'number' ? dmoney(val, t) : val}</b></div>`;
  const isCn = d.kind === 'avoir';
  let rows = row('Total HT', gross, tt.discount || deds.length ? '' : 'mb-sum');
  if (tt.discount) rows += row(`Remise ${fnum(num(d.discount))} %`, -tt.discount);
  for (const [k, v] of Object.entries(dedGroups)) rows += row(esc(k), v);
  if (tt.discount || deds.length) rows += row('Total HT net', tt.base, 'mb-sum');
  rows += d.reverse ? row('TVA', 'Autoliquidation') : tt.vats.map((v) => row(`TVA ${fnum(v.rate)} % <small>sur ${dmoney(v.base, t)}</small>`, v.vat)).join('');
  const due = r2(tt.total - (paid || 0));
  const card = `<div class="mb-totals">${rows}<div class="mb-grand"><span>${isCn ? 'Total crédité' : isEAdoc(kind, d) ? 'Total de cet état TVAC' : 'Total TVAC'}</span><b>${dmoney(tt.total, t)}</b></div>
    ${kind === 'invoice' && !isCn && !isEAdoc(kind, d) && paid ? `${row('Déjà payé', -paid)}<div class="mb-due"><span>Reste à payer</span><b>${dmoney(due, t)}</b></div>` : ''}</div>`;
  const side = [];
  const ea = isEAdoc(kind, d);
  if (ea) side.push(`<div class="mb-accept"><h4>Approbation</h4>Merci de vérifier cet état d'avancement et de nous le retourner approuvé${d.ea && d.ea.approveBy ? ` avant le <b>${esc(dateFr(d.ea.approveBy))}</b>` : ''}. Sans remarque écrite dans ce délai, il sera considéré comme accepté et facturé.</div>`);
  if (kind === 'invoice' && !isCn && !ea && co.iban) {
    const comm = d.communication || it.number || '';
    let qr = '';
    if (t.qr && due > 0.005 && (company().currency || 'EUR') === 'EUR') {
      try { qr = await qrDataUrl(epcPayload({ name: co.name, iban: co.iban, bic: co.bic, amount: due, comm, text: `${docLabel(kind, d, t)} ${it.number || ''}` })); } catch (e) { qr = ''; }
    }
    side.push(`<div class="mb-pay"><div><h4>Paiement</h4><dl class="mb-kv"><dt>Bénéficiaire</dt><dd>${esc(co.name || '')}</dd><dt>IBAN</dt><dd>${esc(ibanFmt(co.iban))}</dd>${co.bic ? `<dt>BIC</dt><dd>${esc(co.bic)}</dd>` : ''}
      <dt>Communication</dt><dd class="mb-comm">${esc(comm)}</dd>${d.due ? `<dt>Échéance</dt><dd>${esc(dateFr(d.due))}</dd>` : ''}</dl>
      ${t.payText ? `<p class="mb-paytxt">${esc(fill(t.payText, { societe: co.name || '', iban: ibanFmt(co.iban), date: d.due ? dateFr(d.due) : 'la date d\'échéance', jours: d.due && d.date ? Math.max(0, dnum(d.due) - dnum(d.date)) : '' }))}</p>` : ''}</div>
      ${qr ? `<figure class="mb-qr"><img src="${qr}" alt="QR code de paiement"><figcaption>Scannez avec votre app bancaire</figcaption></figure>` : ''}</div>`);
  }
  if (kind === 'quote' && d.valid) side.push(`<div class="mb-accept"><h4>Validité</h4>Offre valable jusqu'au <b>${esc(dateFr(d.valid))}</b>. Les travaux démarrent après signature du devis${d.deposit ? ' et paiement de l\'acompte' : ''}.</div>`);
  if (d.docNote) side.push(`<div class="mb-note pre">${esc(d.docNote)}</div>`);
  return `<div class="mb-bottom"><div class="mb-side">${side.join('')}</div>${card}</div>`;
}

// Conditions générales : 2e feuille ; « Article n – titre » mis en évidence
function cgvBlock(kind, t) {
  const on = { invoice: t.cgvInvoice, quote: t.cgvQuote, order: t.cgvOrder }[kind];
  const txt = String(t.cgv || company().terms || CGV_DEF).trim();
  if (!on || !txt) return '';
  const body = txt.split(/\n{2,}/).map((para) => {
    const first = para.split('\n')[0];
    const m = first.match(/^(?:article|art\.)\s*(\d+)\s*[–:.-]?\s*(.*)$/i);
    const rest = esc(para.split('\n').slice(1).join('\n')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    if (m && first.length < 90) return `<p><b><span class="mb-art">${m[1]}</span>${esc(m[2])}</b>${rest ? `<br>${rest}` : ''}</p>`;
    const h = esc(para).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return /^(\d+[.)]\s|[IVX]+[.)]\s)/i.test(para) && first.length < 90 ? `<p><b>${h.replace(/<br>/, '</b><br>')}${h.includes('<br>') ? '' : '</b>'}</p>` : `<p>${h}</p>`;
  }).join('');
  return `<div class="mb-sheet mb-cgv pdf-break ${t.cgvCols ? 'cgv-cols' : ''}"><div class="mb-ruler"></div><h3><span>${esc(t.cgvTitle || 'Conditions générales')}</span><small>${esc(company().name || '')}</small></h3><div class="mb-cgv-body">${body}</div>
    <footer class="mb-foot"><span>${esc(legalLine(t))}</span><span class="mb-pg">2 / 2</span></footer></div>`;
}
// Coordonnées de l'entreprise ou du client manquantes : avertissement à l'écran (non imprimé)
function coMissing(kind, c) {
  if (isField()) return '';
  const co = company(); const s = sellerInfo();
  const miss = [!s.street && 'adresse', !s.zip && 'code postal', !s.city && 'localité', !co.vat && 'n° de TVA', kind !== 'quote' && !co.iban && 'IBAN', !co.email && 'e-mail', !co.phone && 'téléphone'].filter(Boolean);
  const out = [];
  if (miss.length) out.push(`Coordonnées de l'entreprise à compléter pour qu'elles apparaissent sur le document : <b>${miss.join(', ')}</b>.${isAdmin() ? ' <a href="#/settings/company">Paramètres → Entreprise</a>' : ''}`);
  if (!c) out.push(`Aucun ${kind === 'order' ? 'fournisseur' : 'client'} choisi : le cadre de l'adresse reste vide.`);
  return out.length ? `<div class="mb-warn-top no-print">${out.map((x) => `<div>⚠ ${x}</div>`).join('')}</div>` : '';
}

// Mentions légales obligatoires selon les taux utilisés
function mentionsBlock(kind, d, t) {
  if (kind === 'order') return '';
  if (kind === 'quote' && !t.mentionsOnQuote) return '';
  const rates = new Set((d.lines || []).filter((l) => l.kind === 'item' && !l.option).map((l) => num(l.vat)));
  const out = [];
  if (d.reverse) out.push(['Autoliquidation', t.mentionAL]);
  else {
    if (rates.has(6) && t.mention6) out.push(['TVA 6 %', t.mention6]);
    if (rates.has(12) && t.mention12) out.push(['TVA 12 %', t.mention12]);
    if (rates.has(21) && t.mention21) out.push(['TVA 21 %', t.mention21]);
  }
  return out.length ? `<section class="mb-legal"><h4>Mentions TVA</h4>${out.map(([k, v]) => `<div class="mb-mention"><b>${k}</b><div class="pre">${esc(v)}</div></div>`).join('')}</section>` : '';
}

async function printDoc(kind, id) {
  const r = await docHtml(kind, id);
  const { it, d, c, project, title, html, typ, co } = r;
  return printDocPage(kind, id, it, d, c, project, title, html, typ, co);
}
// Rendu du document (devis, facture, commande) : utilisé pour l'impression, l'aperçu et le PDF
async function docHtml(kind, id) {
  const typ = { quote: 'quote', invoice: 'invoice', order: 'order' }[kind];
  const it = await db.get(typ, id);
  const d = it.data;
  const [contacts, project] = await Promise.all([db.list('contact'), it.project_id ? db.get('project', it.project_id).catch(() => null) : null]);
  const c = byId(contacts, kind === 'order' ? d.supplierId : d.clientId);
  const t = tpl(); const co = company();
  const { head, info, title } = docBlocks(kind, it, c, project, t);
  const paid = kind === 'invoice' ? invState(it).paid : 0;
  const isProg = kind === 'invoice' && d.kind === 'situation' && (d.progressRows || []).length;
  const cgv = cgvBlock(kind, t);
  const legal = legalLine(t);
  const html = `<style>${docCSS(t)}</style><div class="doc mb mb-paper" data-foot="${esc(legal)}" data-ink="${esc(t.ink)}" data-acc="${esc(t.accent)}"><div class="mb-sheet"><div class="mb-ruler"></div>
    ${coMissing(kind, c)}${head}${info}
    ${d.intro ? `<p class="pre mb-intro">${esc(d.intro)}</p>` : ''}
    ${isProg ? progressTable(d, t) : linesTable(d, t, kind)}
    ${await totalsBlock(kind, it, t, paid)}
    ${isProg && t.recap ? progressRecap(d, t) : ''}
    ${d.reverse && c && !(c.data || {}).vat ? '<p class="mb-warn no-print">⚠ Autoliquidation : le numéro de TVA du client doit figurer sur la facture.</p>' : ''}
    ${d.notes ? `<div class="mb-notes pre">${esc(d.notes)}</div>` : ''}
    ${isEAdoc(kind, d) ? `<section class="mb-sign"><div><small>Pour ${esc(co.name || "l'entreprise")}</small><span class="mb-sl"></span><em>Nom et signature</em></div><div><small>Approuvé – le client</small><span class="mb-sl"></span><em>Date, nom et signature, précédés de « Lu et approuvé »</em></div></section>` : ''}
    ${kind === 'quote' ? `<section class="mb-sign"><div><small>Pour ${esc(co.name || "l'entreprise")}</small><span class="mb-sl"></span><em>Nom et signature</em></div><div><small>Bon pour accord – le client</small><span class="mb-sl"></span><em>Date, nom et signature, précédés de « Bon pour accord »</em></div></section>${co.terms && !t.cgvQuote ? `<div class="mb-terms pre">${esc(co.terms)}</div>` : ''}` : ''}
    ${mentionsBlock(kind, d, t)}
    <footer class="mb-foot"><span>${esc(legal)}</span><span class="mb-pg">1 / ${cgv ? 2 : 1}</span></footer></div>
    ${cgv}
  </div>`;
  return { it, d, c, project, title, html, typ, co };
}
function printDocPage(kind, id, it, d, c, project, title, html, typ, co) {
  const mailDoc = () => {
    const tot = money(totals(d).total);
    const site = project ? ` – ${project.data.name}` : '';
    const ea = isEAdoc(kind, d);
    const label = ea ? `État d'avancement EA${d.situationNo || ''}` : kind === 'invoice' ? (IKIND[d.kind] || 'Facture') : kind === 'quote' ? 'Devis' : 'Bon de commande';
    const body = ea ? `Bonjour,\n\nVeuillez trouver ci-joint notre état d'avancement EA${d.situationNo || ''}${site ? ` pour le chantier ${project.data.name}` : ''}, d'un montant de ${tot} TVAC pour cette période.\n\nMerci de nous le retourner approuvé${d.ea && d.ea.approveBy ? ` avant le ${fmtDate(d.ea.approveBy)}` : ''}. Sans remarque de votre part dans ce délai, il sera considéré comme accepté et nous établirons la facture correspondante.\n\n${mailSign()}`
      : kind === 'quote' ? `Bonjour,\n\nVeuillez trouver ci-joint notre devis ${it.number}${d.title ? ` « ${d.title} »` : ''} d'un montant de ${tot} TVAC.\n\nNous restons à votre disposition pour toute question.\n\n${mailSign()}`
      : kind === 'invoice' ? `Bonjour,\n\nVeuillez trouver ci-joint notre ${label.toLowerCase()} ${it.number || ''} d'un montant de ${tot} TVAC${d.due ? `, payable avant le ${fmtDate(d.due)}` : ''}${co.iban ? ` sur le compte ${co.iban} avec la communication ${d.communication || it.number}` : ''}.\n\n${mailSign()}`
      : `Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande ${it.number}${d.deliveryDate ? `, livraison souhaitée le ${fmtDate(d.deliveryDate)}` : ''}${project ? ` sur le chantier ${project.data.name} (${[project.data.address, project.data.city].filter(Boolean).join(', ')})` : ''}.\n\nMerci de nous confirmer la bonne réception.\n\n${mailSign()}`;
    sendMailDialog({
      subject: ea ? `${label} – à approuver${d.ea && d.ea.approveBy ? ` avant le ${fmtDate(d.ea.approveBy)}` : ''}${site}` : `${label} ${it.number || ''}${site}`.trim(), body,
      recipients: [...(c ? [contactRcpt(c, kind === 'order' ? 'Fournisseur' : 'Client', true)] : []), ...S.users.filter((u) => u.active && u.id !== S.me.id).map((u) => userRcpt(u, 'Notre équipe', false))],
      ref: { type: typ, id: it.id }, projectId: it.project_id, pdfName: `${fileTitle(title)}.pdf`,
      onSent: (to) => {
        d.sent = [...(d.sent || []), { t: new Date().toISOString(), to, by: S.me.id }];
        if (kind === 'quote' && d.status === 'brouillon') { d.status = 'envoye'; d.sentAt = today(); }
        if (kind === 'order' && d.status === 'brouillon') d.status = 'envoyee';
        persist(typ, it).catch(() => {});
      },
    });
  };
  if (isField()) return printPage(title, html, '#/t/commandes', null);
  printPage(title, html, (isSimple() && kind !== 'order' ? { quote: `#/s/doc/devis/${id}`, invoice: `#/s/doc/facture/${id}` } : { quote: `#/quote/${id}`, invoice: `#/invoice/${id}`, order: `#/order/${id}` })[kind], mailDoc);
  if (new URLSearchParams(location.hash.split('?')[1] || '').has('mail')) mailDoc();
}
route('print', (kind, id) => printDoc(kind, +id));

function docCSS(t) {
  const fonts = { Manrope: "'Manrope', 'Segoe UI', Helvetica, Arial, sans-serif", Montserrat: "'Montserrat', Helvetica, Arial, sans-serif", Serif: "Georgia, 'Times New Roman', serif" };
  return `.doc.mb{--ink:${t.ink};--acc:${t.accent};--tint:${t.tint};font-family:${fonts[t.font] || 'Helvetica, Arial, sans-serif'};font-size:${num(t.size) || 9.5}pt}
  ${t.css || ''}`;
}

// ---------------------------------------------------------------- Paramètres → Modèles
function templateSettings(page) {
  const t = tpl();
  const fields = [
    { name: 'h1', type: 'html', cls: 'full', html: '<div class="section-t">Apparence – modèle Madibu</div><small class="muted">Mise en page propre à votre entreprise : règle de chantier en tête, cartouches émetteur / client / chantier, QR code de paiement.</small>' },
    { name: 'ink', label: 'Couleur principale (en-tête, chapitres, total)', type: 'color' }, { name: 'accent', label: 'Couleur d\'accent (règle, codes, reste à payer)', type: 'color' },
    { name: 'tint', label: 'Fond des cartouches et chapitres', type: 'color' }, { name: 'font', label: 'Police', type: 'select', options: [['Manrope', 'Manrope (modèle Madibu)'], ['Montserrat', 'Montserrat'], ['Helvetica', 'Helvetica / Arial'], ['Serif', 'Georgia (serif)']] },
    { name: 'size', label: 'Taille du texte (pt)', type: 'number' }, { name: 'thousands', label: 'Séparateur des milliers', type: 'select', options: [['.', '14.588,10 €'], [' ', '14 588,10 €'], ['', '14588,10 €']] },
    { name: 'tagline', label: 'Slogan sous le logo (facultatif)', placeholder: 'Ex. : Rénovation & construction depuis 2015', cls: 'full' },
    { name: 'h2', type: 'html', cls: 'full', html: '<div class="section-t">Intitulés et colonnes</div>' },
    { name: 'quoteTitle', label: 'Intitulé des devis' }, { name: 'invoiceTitle', label: 'Intitulé des factures' },
    { name: 'creditTitle', label: 'Intitulé des notes de crédit' }, { name: 'orderTitle', label: 'Intitulé des bons de commande' },
    { name: 'showCodes', label: 'Codes de ligne (1.1.1) devant les descriptions', type: 'check' }, { name: 'showTM', label: 'Afficher le code TM des lignes', type: 'check' },
    { name: 'showManager', label: 'Afficher le gestionnaire du chantier sur les devis', type: 'check' }, { name: 'recap', label: 'Récapitulatif sous les états d\'avancement', type: 'check' },
    { name: 'h3', type: 'html', cls: 'full', html: '<div class="section-t">Paiement</div><small class="muted">Variables : {societe}, {iban}, {jours}, {date}</small>' },
    { name: 'qr', label: 'QR code de paiement sur les factures (scanné par l\'app bancaire du client : montant, IBAN et communication déjà remplis)', type: 'check', cls: 'full' },
    { name: 'payText', label: 'Texte de paiement', cls: 'full' }, { name: 'payTerms', label: 'Conditions de paiement (en-tête)', cls: 'full' },
    { name: 'h4', type: 'html', cls: 'full', html: '<div class="section-t">Mentions obligatoires</div><small class="muted">Ajoutées automatiquement quand la facture contient des lignes au taux concerné, ou en autoliquidation. Vérifiez les textes avec votre comptable.</small>' },
    { name: 'mention6', label: 'Mention TVA 6 %', type: 'textarea', rows: 7, cls: 'full' },
    { name: 'mention12', label: 'Mention TVA 12 % (facultatif)', type: 'textarea', rows: 3, cls: 'full' },
    { name: 'mention21', label: 'Mention TVA 21 % (facultatif, videz pour ne rien afficher)', type: 'textarea', rows: 3, cls: 'full' },
    { name: 'mentionAL', label: 'Mention autoliquidation', type: 'textarea', rows: 3, cls: 'full' },
    { name: 'mentionsOnQuote', label: 'Imprimer aussi ces mentions sur les devis', type: 'check' },
    { name: 'h6', type: 'html', cls: 'full', html: '<div class="section-t">Conditions générales (nouvelle page)</div><small class="muted">Imprimées sur une page à part, après le document (page 2 du PDF). Un paragraphe par article, séparés par une ligne vide ; **texte** = gras.</small>' },
    { name: 'cgvTitle', label: 'Titre' }, { name: 'cgvCols', label: 'Sur deux colonnes à l\'écran et à l\'impression (le PDF reste sur une colonne)', type: 'check' },
    { name: 'cgv', label: 'Texte des conditions générales', type: 'textarea', rows: 12, cls: 'full', placeholder: 'Vide = conditions générales proposées par défaut (9 articles)' },
    { name: 'cgvInvoice', label: 'Sur les factures', type: 'check' }, { name: 'cgvQuote', label: 'Sur les devis', type: 'check' }, { name: 'cgvOrder', label: 'Sur les bons de commande', type: 'check' },
    { name: 'h5', type: 'html', cls: 'full', html: '<div class="section-t">Avancé</div>' },
    { name: 'footer', label: 'Texte ajouté au pied de page (ex. n° d\'entreprise, assurance)', cls: 'full' },
    { name: 'css', label: 'CSS personnalisé (modifie librement la mise en page des documents)', type: 'textarea', rows: 5, cls: 'full', hint: 'Classes : .mb-head, .mb-id, .mb-parties, .mb-party, .mb-lines, .mb-ch, .mb-sub, .mb-totals, .mb-grand, .mb-pay, .mb-qr, .mb-legal, .mb-foot' },
  ];
  page.innerHTML = `<div class="card"><form>${fieldsGrid(fields, t)}
    <div class="btns"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" data-prev="quote">Aperçu d'un devis</button><button class="btn" type="button" data-prev="invoice">Aperçu d'une facture</button><button class="btn danger ghost" type="button" data-reset>Rétablir les valeurs par défaut</button></div></form></div>
    <div class="card"><div class="card-h"><h3>Numérotation</h3></div><div data-num></div></div>`;
  const form = $('form', page);
  const save = async () => { const v = readFields(form, fields); S.settings.template = { ...t, ...v, style: 'madibu' }; await api('PUT', 'settings', { template: S.settings.template }); };
  form.onsubmit = async (e) => { e.preventDefault(); await save(); toast('Modèles enregistrés'); };
  $$('[data-prev]', page).forEach((b) => {
    b.onclick = async () => {
      await save();
      const list = (await db.list(b.dataset.prev)).sort((a, x) => x.id - a.id);
      const pick = b.dataset.prev === 'invoice' ? (list.find((i) => i.data.kind === 'situation') || list[0]) : list[0];
      if (!pick) return toast(b.dataset.prev === 'quote' ? 'Créez d\'abord un devis' : 'Créez d\'abord une facture');
      go(`#/print/${b.dataset.prev}/${pick.id}`);
    };
  });
  $('[data-reset]', page).onclick = async () => {
    if (!confirm('Rétablir l\'apparence par défaut du modèle Madibu ? (mentions et conditions générales conservées)')) return;
    const keep = Object.fromEntries(['mention6', 'mention12', 'mention21', 'mentionAL', 'mentionsOnQuote', 'cgvTitle', 'cgv', 'cgvInvoice', 'cgvQuote', 'cgvOrder', 'cgvCols', 'footer'].filter((k) => k in (S.settings.template || {})).map((k) => [k, S.settings.template[k]]));
    S.settings.template = { ...keep, style: 'madibu' }; await api('PUT', 'settings', { template: S.settings.template }); render();
  };
  numberingSettings($('[data-num]', page));
}
async function numberingSettings(box) {
  const c = await api('GET', 'counters');
  const y = new Date().getFullYear();
  const kinds = [['invoice', 'Factures'], ['avoir', 'Notes de crédit'], ['quote', 'Devis'], ['order', 'Commandes']];
  const pre = S.settings.prefixes || {};
  const values = { pad: S.settings.numpad ?? 4 };
  kinds.forEach(([k]) => { values['n_' + k] = (c[`${k}-${y}`] || 0) + 1; values['p_' + k] = pre[k] ?? { invoice: 'FAC', avoir: 'NC', quote: 'DEV', order: 'BC' }[k]; });
  const fields = [
    { name: 'pad', label: 'Nombre de chiffres', type: 'select', options: [[3, '3 (2026-117)'], [4, '4 (2026-0117)'], [5, '5']] },
    { name: 'hint', type: 'html', html: '<small class="muted">Préfixe vide = numéro « 2026-117 ». Le prochain numéro permet de continuer votre numérotation actuelle.</small>' },
    ...kinds.flatMap(([k, l]) => [{ name: 'p_' + k, label: `Préfixe ${l.toLowerCase()}` }, { name: 'n_' + k, label: `Prochain n° ${l.toLowerCase()} ${y}`, type: 'number' }]),
  ];
  box.innerHTML = `<form>${fieldsGrid(fields, values)}<div class="btns"><button class="btn primary" type="submit">Enregistrer la numérotation</button></div></form>`;
  $('form', box).onsubmit = async (e) => {
    e.preventDefault();
    const v = readFields($('form', box), fields);
    const prefixes = { ...pre }; kinds.forEach(([k]) => { prefixes[k] = v['p_' + k]; });
    await api('PUT', 'settings', { prefixes, numpad: +v.pad });
    await api('PUT', 'counters', Object.fromEntries(kinds.map(([k]) => [`${k}-${y}`, Math.max(0, Math.round(num(v['n_' + k])) - 1)])));
    S.settings.prefixes = prefixes; S.settings.numpad = +v.pad;
    toast('Numérotation enregistrée');
  };
}
