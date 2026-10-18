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
const TPL_DEF = {
  primary: '#2b3270', band: '#4c5fc7', light: '#d9dcf2', payColor: '#e03131', noteColor: '#1c7ed6', font: 'Montserrat', size: 10.5,
  quoteTitle: 'DEVIS N°{numero}', invoiceTitle: 'Facture n°{numero}', creditTitle: 'Note de crédit n°{numero}', orderTitle: 'Bon de commande n°{numero}',
  showTM: true, tmLabel: 'TM', showManager: true, thousands: '.',
  payText: 'Merci de faire le virement sur le compte {societe}', payTerms: '{jours} jour(s) Après date de facturation',
  mention6: MENTION_6, mention12: '', mention21: MENTION_21, mentionAL: MENTION_AL, mentionsOnQuote: true,
  recap: true, footer: '', css: '',
  cgvTitle: 'Conditions générales', cgv: '', cgvInvoice: true, cgvQuote: true, cgvOrder: false, cgvCols: false,
};
const tpl = () => ({ ...TPL_DEF, ...(S.settings.template || {}) });
const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
const CUR_SYM = { EUR: '€', CHF: 'CHF', RON: 'lei' };
function dmoney(x, t = tpl()) {
  const v = r2(x) || 0;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, t.thousands || '.')},${d} ${CUR_SYM[company().currency || 'EUR'] || company().currency}`;
}
const dnum2 = (x) => (num(x) || 0).toFixed(2).replace('.', ',');
const pctS = (x) => `${(Math.round(num(x) * 10) / 10).toFixed(1).replace('.', ',')}%`;
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

// ---------------------------------------------------------------- Rendu commun
function docBlocks(kind, it, c, project, t) {
  const d = it.data; const co = company(); const s = sellerInfo();
  const cd = (c && c.data) || {};
  const isInv = kind === 'invoice'; const isQ = kind === 'quote';
  const title = fill(isQ ? t.quoteTitle : kind === 'order' ? t.orderTitle : d.kind === 'avoir' ? t.creditTitle : t.invoiceTitle, { numero: it.number || 'BROUILLON' });
  const days = d.due && d.date ? Math.max(0, dnum(d.due) - dnum(d.date)) : null;
  const resp = userName(+(d.ownerId || it.created_by));
  const refTxt = d.ref || (d.kind === 'situation' && d.situationNo ? `EA${d.situationNo}` : (isQ ? d.title : ''));
  const meta = [
    refTxt ? `<div class="vz-ref">${isQ ? '<b>Référence :</b> ' : ''}${esc(refTxt)}</div>` : '',
    d.kind === 'situation' && d.situationNo ? `<div>N° avancement : ${d.situationNo}</div>` : '',
    d.kind === 'avoir' && d.refInvoice ? `<div>Concerne la facture : ${esc(d.refInvoice)}</div>` : '',
    `<div>Date : ${esc(longDate(d.date))}</div>`,
    isQ ? `<div><b>Valable jusqu'au :</b> ${esc(longDate(d.valid))}</div>` : '',
    `<div>${isQ ? '<b>Responsable :</b>' : 'Responsable :'} ${esc(resp)}</div>`,
    isInv && d.kind !== 'avoir' && days != null ? `<div>Paiement : ${esc(fill(t.payTerms, { jours: days, date: fmtDate(d.due) }))}</div>` : '',
    kind === 'order' && d.deliveryDate ? `<div>Livraison souhaitée : ${esc(longDate(d.deliveryDate))}</div>` : '',
  ].join('');
  const bill = kind !== 'order' && it.data.billSame === false;
  const clientBox = bill ? `<div class="vz-client"><b>${esc(it.data.billName || clientLabel(c))}</b><div class="vz-addr">${esc(it.data.billAddress || '').replace(/\n/g, '<br>')}</div>${it.data.billVat ? `<div>TVA : ${esc(it.data.billVat)}</div>` : ''}</div>`
    : `<div class="vz-client"><b>${esc(kind === 'order' ? contactName(c) : clientLabel(c))}</b>
    ${cd.company && (cd.name || cd.firstname) ? `<div>Att. ${esc([cd.civility, cd.name, cd.firstname].filter(Boolean).join(' '))}</div>` : ''}
    <div class="vz-addr">${[cd.address, [cd.zip, cd.city].filter(Boolean).join(' '), cd.country].filter(Boolean).map(esc).join('<br>')}</div>
    ${cd.vat ? `<div>TVA : ${esc(cd.vat)}</div>` : ''}</div>`;
  const head = `<div class="vz-head">
    <div class="vz-left">${co.logoId ? `<img class="vz-logo" src="${fileUrl(co.logoId)}" alt="">` : ''}
      <div class="vz-co"><b>${esc(co.name || '')}</b><br>${esc(s.street)}<br>${esc([s.cc && s.zip ? `${s.cc}-${s.zip}` : s.zip, s.city].filter(Boolean).join(' '))}
        ${co.email ? `<br>${esc(co.email)}` : ''}${co.website ? `<br><u>${esc(co.website)}</u>` : ''}${co.phone ? `<br>Tél. : ${esc(co.phone)}` : ''}
        ${co.vat ? `<br>TVA : ${esc(co.vat)}` : ''}${co.iban && !isQ ? `<br>IBAN : ${esc(String(co.iban).replace(/\s/g, ''))}` : ''}</div></div>
    <div class="vz-right"><h1>${esc(title)}</h1><div class="vz-meta">${meta}</div>${clientBox}</div></div>`;
  const pa = project ? [project.data.address, [project.data.zip, project.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : (d.siteAddress || '');
  const info = `<div class="vz-info">
    ${project || d.title ? `<div>Chantier : &nbsp;${esc(project ? project.data.name : d.title)}</div>` : ''}
    ${pa ? `<div>Adresse du chantier : ${esc(pa)}</div>` : ''}
    ${isInv && d.communication && d.kind !== 'avoir' ? `<div>Communication structurée : &nbsp;${esc(d.communication)}</div>` : ''}
    ${isQ && t.showManager && project && project.data.managerId ? `<div><b>Gestionnaire du chantier :</b> ${esc(userName(+project.data.managerId))}</div>` : (isQ && t.showManager ? `<div><b>Gestionnaire du chantier :</b> ${esc(resp)}</div>` : '')}
  </div>`;
  return { head, info, title };
}

// Tableau des lignes : chapitres (bande foncée), sous-chapitres (bande claire), lignes
function linesTable(d, t) {
  const lines = (d.lines || []).filter((l) => !isDeduction(l));
  const nos = numbering(lines); const st = sectionTotals(lines);
  const tm = t.showTM;
  return `<table class="vz-lines"><thead><tr><th class="c-no">N°</th><th>Description</th>${tm ? `<th class="c-tm">${esc(t.tmLabel)}</th>` : ''}<th class="r">Qte.</th><th class="c-u">U</th><th class="r">PU(€)</th><th class="r">TOTAL</th></tr></thead><tbody>
    ${lines.map((l, i) => {
      if (l.kind === 'title' && !String(l.desc || '').trim()) return '';
      if (l.kind === 'title') return `<tr class="${tlevel(l) === 2 ? 'vz-l2' : 'vz-l1'}"><td>${nos[i]}</td><td colspan="${tm ? 5 : 4}">${esc(l.desc)}</td><td class="r">${dmoney(st[l.id], t)}</td></tr>`;
      if (l.kind === 'text') return `<tr class="vz-txt"><td></td><td colspan="${tm ? 6 : 5}" class="pre">${esc(l.desc)}</td></tr>`;
      return `<tr class="${l.option ? 'opt' : ''}"><td>${nos[i]}</td><td class="pre">${esc(l.desc)}${l.option ? '<br><i>(en option, non comprise dans le total)</i>' : ''}</td>${tm ? `<td class="c-tm">${esc(l.tm || '')}</td>` : ''}<td class="r">${dnum2(l.qty)}</td><td class="c-u">${esc(l.unit)}</td><td class="r">${dmoney(l.price, t)}</td><td class="r">${dmoney(num(l.qty) * num(l.price), t)}</td></tr>`;
    }).join('')}</tbody></table>`;
}

// Tableau d'un état d'avancement : quantités prévues / avancées et % cumulés
function progressTable(d, t) {
  const rows = d.progressRows || [];
  const tm = t.showTM;
  const nos = numbering(rows.map((r) => ({ kind: r.kind, level: r.level })));
  const period = (r) => { const l = (d.lines || []).find((x) => x.srcId === r.lineId && !isDeduction(x)); return l ? r2(num(l.qty) * num(l.price)) : 0; };
  return `<table class="vz-lines vz-prog"><thead><tr><th class="c-no">N°</th><th>DESCRIPTION</th>${tm ? `<th class="c-tm">${esc(t.tmLabel)}</th>` : ''}<th class="r">QTE<br>PREVU</th><th class="c-u">U</th><th class="r">QTE<br>AVAN.</th><th class="r">%<br>AVAN.</th><th class="r">PU(€)</th><th class="r">TOTAL</th></tr></thead><tbody>
    <tr class="vz-txt"><td></td><td colspan="${tm ? 8 : 7}">Référence de l'avancement ; ${esc(d.ref || `EA${d.situationNo || ''}`)}${d.title ? `<br>Référence de Chantier ; ${esc(d.title)}` : ''}</td></tr>
    ${rows.map((r, i) => {
      if (r.kind === 'title') {
        const sub = rows.slice(i + 1, blockEnd(rows.map((x) => ({ kind: x.kind, level: x.level })), i)).filter((x) => x.kind === 'item');
        return `<tr class="${+r.level === 2 ? 'vz-l2' : 'vz-l1'}"><td>${nos[i]}</td><td colspan="${tm ? 7 : 6}">${esc(r.desc)}</td><td class="r">${dmoney(sub.reduce((a, x) => a + period(x), 0), t)}</td></tr>`;
      }
      return `<tr><td>${nos[i]}</td><td class="pre">${esc(r.desc)}</td>${tm ? '<td class="c-tm"></td>' : ''}<td class="r">${dnum2(r.qty)}</td><td class="c-u">${esc(r.unit)}</td><td class="r">${dnum2(num(r.qty) * num(r.cum) / 100)}</td><td class="r">${pctS(r.cum)}</td><td class="r">${dmoney(r.price, t)}</td><td class="r">${dmoney(period(r), t)}</td></tr>`;
    }).join('')}</tbody></table>`;
}
function progressRecap(d, t) {
  const rows = (d.progressRows || []).filter((r) => r.kind === 'item');
  const market = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price)), 0);
  const cum = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price) * num(r.cum) / 100), 0);
  const prev = rows.reduce((a, r) => a + r2(num(r.qty) * num(r.price) * num(r.prev) / 100), 0);
  return `<table class="vz-recap"><tr><th colspan="2">Récapitulatif de l'avancement</th></tr>
    <tr><td>Montant du marché HT</td><td class="r">${dmoney(market, t)}</td></tr>
    <tr><td>Travaux réalisés à ce jour (${market ? pctS((cum / market) * 100) : '0,0%'})</td><td class="r">${dmoney(cum, t)}</td></tr>
    <tr><td>Facturé lors des états précédents</td><td class="r">${dmoney(prev, t)}</td></tr>
    <tr><td><b>Présent état d'avancement</b></td><td class="r"><b>${dmoney(cum - prev, t)}</b></td></tr>
    <tr><td>Reste à facturer</td><td class="r">${dmoney(market - cum, t)}</td></tr></table>`;
}

// Bloc des totaux (bandes colorées) + textes de paiement à gauche
function totalsBlock(kind, it, t, paid) {
  const d = it.data; const tt = totals(d);
  const deds = (d.lines || []).filter((l) => l.kind === 'item' && !l.option && isDeduction(l));
  const gross = r2((d.lines || []).filter((l) => l.kind === 'item' && !l.option && !isDeduction(l)).reduce((a, l) => a + r2(num(l.qty) * num(l.price)), 0));
  const dedGroups = {};
  for (const l of deds) { const k = l.deduction === 'acompte' || /acompte/i.test(l.desc) ? 'Deduction Acompte' : String(l.desc).split(/[(–-]/)[0].trim() || 'Déduction'; dedGroups[k] = (dedGroups[k] || 0) + r2(num(l.qty) * num(l.price)); }
  const row = (label, val, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${dmoney(val, t)}</td></tr>`;
  const isQ = kind === 'quote';
  let rows = row(isQ ? 'Total HT' : 'Sous-total n°1', gross, 'b1');
  if (tt.discount) rows += row(`Remise ${fnum(num(d.discount))} %`, -tt.discount);
  for (const [k, v] of Object.entries(dedGroups)) rows += row(esc(k), v);
  if (tt.discount || deds.length) rows += row(isQ ? 'Total HT après remise' : 'Sous-total n°2', tt.base, 'b1');
  rows += d.reverse ? '<tr><td>TVA</td><td class="r">Autoliquidation</td></tr>' : tt.vats.map((v) => row(`TVA ${fnum(v.rate, 1).replace(/^(\d+)$/, '$1,0')}%`, v.vat)).join('');
  rows += row(isQ ? 'Total TVAC' : 'Total TTC', tt.total, 'b1');
  if (kind === 'invoice' && d.kind !== 'avoir') {
    if (paid) rows += row('Déjà payé', -paid);
    rows += row('Total TTC à payer', tt.total - (paid || 0), 'b2');
  }
  const co = company();
  const left = `<div class="vz-pay">
    ${kind === 'invoice' && d.kind !== 'avoir' && co.iban ? `<div class="vz-red">${esc(fill(t.payText, { societe: (co.name || '').toUpperCase(), iban: ibanFmt(co.iban) }))}</div><div class="vz-red">${esc(ibanFmt(co.iban))}</div>` : ''}
    ${d.docNote ? `<div class="vz-blue pre">${esc(d.docNote)}</div>` : ''}</div>`;
  return `<div class="vz-bottom">${left}<table class="vz-tot">${rows}</table></div>`;
}

// Conditions générales : sur une nouvelle page (page 2 du PDF), texte libre ; **gras** et titres « Article … » mis en évidence
function cgvBlock(kind, t) {
  const on = { invoice: t.cgvInvoice, quote: t.cgvQuote, order: t.cgvOrder }[kind];
  const txt = String(t.cgv || company().terms || CGV_DEF).trim();
  if (!on || !txt) return '';
  const body = txt.split(/\n{2,}/).map((para) => {
    const h = esc(para).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return /^(article|art\.|\d+[.)]\s|[IVX]+[.)]\s)/i.test(para) && para.split('\n')[0].length < 90 ? `<p><b>${h.replace(/<br>/, '</b><br>')}${h.includes('<br>') ? '' : '</b>'}</p>` : `<p>${h}</p>`;
  }).join('');
  return `<div class="vz-sheet vz-cgv pdf-break ${t.cgvCols ? 'cgv-cols' : ''}"><h3>${esc(t.cgvTitle || 'Conditions générales')}</h3><div class="vz-cgv-body">${body}</div><div class="vz-pgno no-print">Page 2/2</div></div>`;
}
// Coordonnées de l'entreprise ou du client manquantes : avertissement à l'écran (non imprimé)
function coMissing(kind, c) {
  const co = company(); const s = sellerInfo();
  const miss = [!s.street && 'adresse', !s.zip && 'code postal', !s.city && 'localité', !co.vat && 'n° de TVA', kind !== 'quote' && !co.iban && 'IBAN', !co.email && 'e-mail', !co.phone && 'téléphone'].filter(Boolean);
  const out = [];
  if (miss.length) out.push(`Coordonnées de l'entreprise à compléter pour qu'elles apparaissent sur le document : <b>${miss.join(', ')}</b>.${isAdmin() ? ' <a href="#/settings/company">Paramètres → Entreprise</a>' : ''}`);
  if (!c) out.push(`Aucun ${kind === 'order' ? 'fournisseur' : 'client'} choisi : le cadre de l'adresse reste vide.`);
  return out.length ? `<div class="vz-warn vz-warn-top no-print">${out.map((x) => `<div>⚠ ${x}</div>`).join('')}</div>` : '';
}

// Mentions légales obligatoires selon les taux utilisés
function mentionsBlock(kind, d, t) {
  if (kind === 'order') return '';
  if (kind === 'quote' && !t.mentionsOnQuote) return '';
  const rates = new Set((d.lines || []).filter((l) => l.kind === 'item' && !l.option).map((l) => num(l.vat)));
  const out = [];
  if (d.reverse) out.push(['Autoliquidation :', t.mentionAL]);
  else {
    if (rates.has(6) && t.mention6) out.push(['TVA 6,0% :', t.mention6]);
    if (rates.has(12) && t.mention12) out.push(['TVA 12,0% :', t.mention12]);
    if (rates.has(21) && t.mention21) out.push(['TVA 21,0% :', t.mention21]);
  }
  return out.map(([k, v]) => `<div class="vz-mention"><u>${k}</u><div class="pre">${esc(v)}</div></div>`).join('');
}

async function printDoc(kind, id) {
  const r = await docHtml(kind, id);
  const { it, d, c, project, title, html, typ, co } = r;
  return printDocPage(kind, id, it, d, c, project, title, html, typ, co);
}
// Rendu du document (devis, facture, commande) : utilisé pour l'impression et l'aperçu « Visualisation »
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
  const html = `<style>${docCSS(t)}</style><div class="doc vz vz-paper"><div class="vz-sheet">
    ${coMissing(kind, c)}${head}${info}
    ${d.intro ? `<p class="pre vz-intro">${esc(d.intro)}</p>` : ''}
    ${isProg ? progressTable(d, t) : linesTable(d, t)}
    ${totalsBlock(kind, it, t, paid)}
    ${isProg && t.recap ? progressRecap(d, t) : ''}
    ${d.reverse && c && !(c.data || {}).vat ? '<p class="vz-warn no-print">⚠ Autoliquidation : le numéro de TVA du client doit figurer sur la facture.</p>' : ''}
    ${mentionsBlock(kind, d, t)}
    ${d.notes ? `<div class="vz-notes pre">${esc(d.notes)}</div>` : ''}
    ${kind === 'quote' ? `${co.terms && !t.cgvQuote ? `<div class="vz-terms pre">${esc(co.terms)}</div>` : ''}<div class="vz-sign"><div>Pour ${esc(co.name || "l'entreprise")}</div><div>Pour accord, le client<br><small>Date, nom et signature précédés de la mention « Bon pour accord »</small></div></div>` : ''}
    ${t.footer || co.footer ? `<div class="vz-foot">${esc(t.footer || co.footer)}</div>` : ''}
    <div class="vz-pgno no-print">Page 1${cgv ? '/2' : '/1'}</div></div>
    ${cgv}
  </div>`;
  return { it, d, c, project, title, html, typ, co };
}
function printDocPage(kind, id, it, d, c, project, title, html, typ, co) {
  const mailDoc = () => {
    const tot = money(totals(d).total);
    const site = project ? ` – ${project.data.name}` : '';
    const label = kind === 'invoice' ? (IKIND[d.kind] || 'Facture') : kind === 'quote' ? 'Devis' : 'Bon de commande';
    const body = kind === 'quote' ? `Bonjour,\n\nVeuillez trouver ci-joint notre devis ${it.number}${d.title ? ` « ${d.title} »` : ''} d'un montant de ${tot} TVAC.\n\nNous restons à votre disposition pour toute question.\n\n${mailSign()}`
      : kind === 'invoice' ? `Bonjour,\n\nVeuillez trouver ci-joint notre ${label.toLowerCase()} ${it.number || ''} d'un montant de ${tot} TVAC${d.due ? `, payable avant le ${fmtDate(d.due)}` : ''}${co.iban ? ` sur le compte ${co.iban} avec la communication ${d.communication || it.number}` : ''}.\n\n${mailSign()}`
      : `Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande ${it.number}${d.deliveryDate ? `, livraison souhaitée le ${fmtDate(d.deliveryDate)}` : ''}${project ? ` sur le chantier ${project.data.name} (${[project.data.address, project.data.city].filter(Boolean).join(', ')})` : ''}.\n\nMerci de nous confirmer la bonne réception.\n\n${mailSign()}`;
    sendMailDialog({
      subject: `${label} ${it.number || ''}${site}`.trim(), body,
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
  printPage(title, html, { quote: `#/quote/${id}`, invoice: `#/invoice/${id}`, order: `#/order/${id}` }[kind], mailDoc);
  if (new URLSearchParams(location.hash.split('?')[1] || '').has('mail')) mailDoc();
}
route('print', (kind, id) => printDoc(kind, +id));

function docCSS(t) {
  const font = t.font === 'Montserrat' ? "'Montserrat', Helvetica, Arial, sans-serif" : t.font === 'Serif' ? "Georgia, 'Times New Roman', serif" : 'Helvetica, Arial, sans-serif';
  return `.doc.vz{--p:${t.primary};--band:${t.band};--light:${t.light};--payc:${t.payColor};--notec:${t.noteColor};font-family:${font};font-size:${num(t.size) || 10.5}pt;color:#222}
  @page{@bottom-right{content:"Page " counter(page) "/" counter(pages);font-size:8pt;color:#555}}
  ${t.css || ''}`;
}

// ---------------------------------------------------------------- Paramètres → Modèles
function templateSettings(page) {
  const t = tpl();
  const fields = [
    { name: 'h1', type: 'html', cls: 'full', html: '<div class="section-t">Apparence</div>' },
    { name: 'primary', label: 'Couleur principale (titres, chapitres)', type: 'color' }, { name: 'band', label: 'Couleur des sous-totaux', type: 'color' },
    { name: 'light', label: 'Couleur des sous-chapitres', type: 'color' }, { name: 'font', label: 'Police', type: 'select', options: [['Montserrat', 'Montserrat (comme vos documents)'], ['Helvetica', 'Helvetica / Arial'], ['Serif', 'Georgia (serif)']] },
    { name: 'size', label: 'Taille du texte (pt)', type: 'number' }, { name: 'thousands', label: 'Séparateur des milliers', type: 'select', options: [['.', '14.588,10 €'], [' ', '14 588,10 €'], ['', '14588,10 €']] },
    { name: 'payColor', label: 'Couleur du texte de paiement', type: 'color' }, { name: 'noteColor', label: 'Couleur de la remarque', type: 'color' },
    { name: 'h2', type: 'html', cls: 'full', html: '<div class="section-t">Titres et colonnes</div><small class="muted">Variable disponible : {numero}</small>' },
    { name: 'quoteTitle', label: 'Titre des devis' }, { name: 'invoiceTitle', label: 'Titre des factures' },
    { name: 'creditTitle', label: 'Titre des notes de crédit' }, { name: 'orderTitle', label: 'Titre des bons de commande' },
    { name: 'showTM', label: 'Afficher la colonne TM', type: 'check' }, { name: 'tmLabel', label: 'Intitulé de la colonne TM' },
    { name: 'showManager', label: 'Afficher « Gestionnaire du chantier » sur les devis', type: 'check' }, { name: 'recap', label: 'Récapitulatif sous les états d\'avancement', type: 'check' },
    { name: 'h3', type: 'html', cls: 'full', html: '<div class="section-t">Paiement</div><small class="muted">Variables : {societe}, {iban}, {jours}, {date}</small>' },
    { name: 'payText', label: 'Texte de paiement (en rouge)', cls: 'full' }, { name: 'payTerms', label: 'Conditions de paiement (en-tête)', cls: 'full' },
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
    { name: 'footer', label: 'Pied de page', cls: 'full' },
    { name: 'css', label: 'CSS personnalisé (modifie librement la mise en page des documents)', type: 'textarea', rows: 5, cls: 'full', hint: 'Classes : .vz-head, .vz-co, .vz-client, .vz-lines, .vz-l1, .vz-l2, .vz-tot, .vz-red, .vz-blue, .vz-mention' },
  ];
  page.innerHTML = `<div class="card"><form>${fieldsGrid(fields, t)}
    <div class="btns"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" data-prev="quote">Aperçu d'un devis</button><button class="btn" type="button" data-prev="invoice">Aperçu d'une facture</button><button class="btn danger ghost" type="button" data-reset>Rétablir les valeurs par défaut</button></div></form></div>
    <div class="card"><div class="card-h"><h3>Numérotation</h3></div><div data-num></div></div>`;
  const form = $('form', page);
  const save = async () => { const v = readFields(form, fields); S.settings.template = { ...t, ...v }; await api('PUT', 'settings', { template: S.settings.template }); };
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
  $('[data-reset]', page).onclick = async () => { if (!confirm('Rétablir le modèle par défaut ?')) return; S.settings.template = {}; await api('PUT', 'settings', { template: {} }); render(); };
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
