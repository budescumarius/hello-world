'use strict';
/* Constantes métier, calculs et éditeur de lignes commun (devis, factures, commandes) + impression des documents. */

// ---------------------------------------------------------------- Constantes
const CONTACT_KINDS = { client: 'Client', prospect: 'Prospect', fournisseur: 'Fournisseur', soustraitant: 'Sous-traitant', architecte: 'Architecte / BE', autre: 'Autre' };
const CONTACT_COLORS = { client: '#2f9e44', prospect: '#4dabf7', fournisseur: '#f08c00', soustraitant: '#7048e8', architecte: '#0c8599', autre: '#868e96' };
const OPP_STAGES = [
  ['nouveau', 'Nouvelle demande', '#868e96'], ['contact', 'Premier contact', '#4dabf7'], ['visite', 'Visite technique', '#7048e8'],
  ['devis', 'Devis envoyé', '#f08c00'], ['nego', 'Négociation', '#e8590c'], ['gagne', 'Gagnée', '#2f9e44'], ['perdu', 'Perdue', '#e5484d'],
];
const OPP_OPEN = ['nouveau', 'contact', 'visite', 'devis', 'nego'];
const QST = { brouillon: ['À envoyer', '#868e96'], envoye: ['Envoyé', '#3b5bdb'], accepte: ['Accepté', '#2f9e44'], refuse: ['Refusé', '#e5484d'], annule: ['Annulé', '#adb5bd'] };
const IST = { brouillon: ['À envoyer', '#868e96'], impayee: ['À payer', '#f08c00'], partielle: ['Partiellement payée', '#3b5bdb'], payee: ['Payée', '#2f9e44'], retard: ['En retard', '#e5484d'], avoir: ['Avoir', '#adb5bd'] };
const IKIND = { facture: 'Facture', acompte: "Facture d'acompte", situation: "Facture d'avancement", finale: 'Facture de solde', avoir: 'Note de crédit', proforma: 'Facture pro forma' };
const TYPES = { mo: "Main d'œuvre", mat: 'Matériaux', materiel: 'Matériel', st: 'Sous-traitance', divers: 'Divers' };
const TYPE_COLORS = { mo: '#f08c00', mat: '#3b5bdb', materiel: '#7048e8', st: '#0c8599', divers: '#868e96', ouvrage: '#2f9e44' };
const PST = { prospect: ['Avant-projet', '#868e96'], preparation: ['En préparation', '#4dabf7'], encours: ['En cours', '#f08c00'], reception: ['Réception', '#7048e8'], termine: ['Terminé', '#2f9e44'], annule: ['Annulé', '#adb5bd'] };
const OST = { brouillon: ['Brouillon', '#868e96'], envoyee: ['Envoyée', '#3b5bdb'], confirmee: ['Confirmée', '#7048e8'], livree: ['Livrée', '#2f9e44'], facturee: ['Facturée', '#0c8599'], annulee: ['Annulée', '#adb5bd'] };
const INTST = { aplanifier: ['À planifier', '#868e96'], planifiee: ['Planifiée', '#3b5bdb'], encours: ['En cours', '#f08c00'], terminee: ['Terminée', '#2f9e44'], facturee: ['Facturée', '#0c8599'], annulee: ['Annulée', '#adb5bd'] };
const INTKIND = { depannage: 'Dépannage', entretien: 'Entretien', installation: 'Installation', sav: 'SAV', visite: 'Visite technique', autre: 'Autre' };
const TST = { todo: ['À faire', '#868e96'], doing: ['En cours', '#f08c00'], done: ['Terminée', '#2f9e44'] };
const PRIO = { low: ['Basse', '#868e96'], normal: ['Normale', '#3b5bdb'], high: ['Haute', '#f08c00'], urgent: ['Urgente', '#e5484d'] };
const UNITS = ['u', 'pc', 'm', 'm²', 'm³', 'ml', 'kg', 't', 'l', 'h', 'j', 'ens', 'forfait'];
// liste des unités : toujours complète (la liste du navigateur ne montrait que ce qui commence comme la valeur déjà écrite, ex. « u »)
const UNIT_LABELS = { u: 'unité', pc: 'pièce', m: 'mètre', 'm²': 'mètre carré', 'm³': 'mètre cube', ml: 'mètre linéaire', kg: 'kilo', t: 'tonne', l: 'litre', h: 'heure', j: 'jour', ens: 'ensemble', forfait: 'forfait' };
let unitPopEl = null;
const unitPopClose = () => { if (unitPopEl) { unitPopEl.remove(); unitPopEl = null; } };
function unitPop(inp) {
  unitPopClose();
  const r = inp.getBoundingClientRect(); const cur = inp.value.trim();
  unitPopEl = document.createElement('div'); unitPopEl.className = 'unit-pop'; unitPopEl.setAttribute('role', 'listbox');
  unitPopEl.innerHTML = UNITS.map((u) => `<button type="button" role="option" data-u="${esc(u)}" class="${u === cur ? 'on' : ''}"><b>${esc(u)}</b><small>${esc(UNIT_LABELS[u] || '')}</small></button>`).join('') + '<small class="unit-pop-h">ou tapez une autre unité</small>';
  document.body.appendChild(unitPopEl);
  const h = unitPopEl.offsetHeight; const below = innerHeight - r.bottom > h + 8;
  unitPopEl.style.left = `${Math.max(8, Math.min(r.left, innerWidth - unitPopEl.offsetWidth - 8))}px`;
  unitPopEl.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;
  unitPopEl.addEventListener('mousedown', (e) => e.preventDefault()); // garder le focus dans le champ
  $$('[data-u]', unitPopEl).forEach((b) => { b.onclick = () => { inp.value = b.dataset.u; inp.dispatchEvent(new Event('input', { bubbles: true })); unitPopClose(); inp.blur(); }; });
}
document.addEventListener('focusin', (e) => { const t = e.target; if (t && t.matches && t.matches('input[data-units]') && !t.readOnly && !t.disabled) unitPop(t); });
document.addEventListener('focusout', (e) => { if (e.target && e.target.matches && e.target.matches('input[data-units]')) setTimeout(unitPopClose, 120); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') unitPopClose(); });
window.addEventListener('scroll', unitPopClose, true);
const PAY_METHODS = ['Virement', 'Espèces', 'Carte', 'Chèque', 'Domiciliation', 'Autre'];
const ABS_KINDS = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', intemperie: 'Intempéries', autre: 'Autre' };

const st = (map, k) => (map[k] ? badge(map[k][0], map[k][1]) : '');
const optsOf = (map) => Object.entries(map).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);
const company = () => S.settings.company || {};
const vatList = () => { const v = company().vatRates; return Array.isArray(v) && v.length ? v.map(Number) : [21, 12, 6, 0]; };
const vatOptions = (cur) => [...new Set([...vatList(), ...(cur === '' || cur == null ? [] : [num(cur)])])].map((r) => [r, `${fnum(r)} %`]);
const defVat = () => (company().defaultVat != null ? num(company().defaultVat) : 21);
function contactName(c) { if (!c) return '—'; const d = c.data || c; return d.company || [d.firstname, d.name].filter(Boolean).join(' ') || d.name || '—'; }
const byId = (list, id) => list.find((x) => x.id === +id);

// ---------------------------------------------------------------- Calculs
// lignes : { kind:'title'|'item'|'text', desc, unit, qty, cost, price, vat, type, costBy? }
function totals(doc) {
  if (doc._lite && doc._sum) return doc._sum;
  // remise globale : en % (discount) ou en montant (discountMode « amt » + discountAmt), répartie entre les taux au prorata
  const amtMode = doc.discountMode === 'amt' && num(doc.discountAmt) > 0;
  let d = amtMode ? 0 : num(doc.discount) / 100;
  const by = {}; const costBy = {};
  let net = 0; let cost = 0;
  for (const l of doc.lines || []) {
    if (l.kind !== 'item' || l.option) continue;
    const t = r2(num(l.qty) * num(l.price));
    net += t;
    by[num(l.vat)] = (by[num(l.vat)] || 0) + t;
    if (l.costBy) for (const [k, v] of Object.entries(l.costBy)) { const c = num(l.qty) * num(v); costBy[k] = (costBy[k] || 0) + c; cost += c; }
    else { const c = num(l.qty) * num(l.cost); cost += c; costBy[l.type || 'divers'] = (costBy[l.type || 'divers'] || 0) + c; }
  }
  net = r2(net);
  const want = amtMode && net > 0 ? r2(Math.min(num(doc.discountAmt), net)) : 0;
  if (amtMode && net > 0) d = want / net;
  // la remise est calculée par taux de TVA (règles EN 16931 / Peppol : total = somme des remises par taux)
  const vats = Object.keys(by).map(Number).sort((a, b) => b - a)
    .map((rate) => { const lines = r2(by[rate]); const allowance = r2(lines * d); const b = r2(lines - allowance); return { rate, lines, allowance, base: b, vat: doc.reverse ? 0 : r2(b * rate / 100) }; }).filter((v) => v.lines);
  // montant : l'écart d'arrondi (1 centime) va sur le premier taux, pour que la remise fasse exactement le montant demandé
  if (amtMode && vats.length) { const diff = r2(want - vats.reduce((s, v) => s + v.allowance, 0)); if (diff) { const v = vats[0]; v.allowance = r2(v.allowance + diff); v.base = r2(v.lines - v.allowance); v.vat = doc.reverse ? 0 : r2(v.base * v.rate / 100); } }
  const discount = r2(vats.reduce((s, v) => s + v.allowance, 0));
  const base = r2(net - discount);
  const vat = r2(vats.reduce((s, v) => s + v.vat, 0));
  return { net, discount, base, vats, vat, total: r2(base + vat), cost: r2(cost), costBy, margin: r2(base - cost) };
}
// remise globale exprimée en % (pour les calculs qui l'appliquent ligne par ligne : états d'avancement, factures depuis un devis)
function discPct(doc) { if (doc.discountMode === 'amt') { const t = totals(doc); return t.net ? (t.discount / t.net) * 100 : 0; } return num(doc.discount); }
const discLabel = (doc) => (doc.discountMode === 'amt' ? 'Remise' : `Remise ${fnum(num(doc.discount))} %`);
// remise sur un poste : le prix unitaire devient le prix remisé (4 décimales), le prix d'origine est gardé (l.listPrice)
const r4 = (x) => Math.round(x * 1e4) / 1e4;
function applyLineDisc(l) {
  if (!l.disc) return;
  const lp = num(l.listPrice); const v = num(l.disc.v);
  l.price = l.disc.mode === 'amt' ? (num(l.qty) ? r4(lp - v / num(l.qty)) : lp) : r4(lp * (1 - v / 100));
}
const lineDiscText = (l) => (l.disc ? (l.disc.mode === 'amt' ? `Remise de ${money(num(l.disc.v))} sur ce poste` : `Remise ${fnum(num(l.disc.v))} %`) + ` (prix unitaire avant remise : ${money(num(l.listPrice))})` : '');
// Numérotation à 3 niveaux : chapitre 1.0.0, sous-chapitre 1.1.0, ligne 1.1.1 (ou 1.0.1 sans sous-chapitre)
const tlevel = (l) => (l.kind === 'title' ? (+l.level === 2 ? 2 : 1) : 3);
// Numéros repris du métré (l.no, import Excel) : gardés tels quels, même si on supprime ou ajoute des lignes
const ownNos = (lines) => lines.some((l) => l.no != null && String(l.no).trim() !== '');
function numbering(lines) {
  if (ownNos(lines)) return lines.map((l) => (l.kind === 'text' ? '' : String(l.no ?? '').trim()));
  const hasT = lines.some((l) => l.kind === 'title');
  let c = 0; let s = 0; let n = 0;
  return lines.map((l) => {
    if (l.kind === 'title') { if (tlevel(l) === 2) { s++; n = 0; return `${c}.${s}.0`; } c++; s = 0; n = 0; return `${c}.0.0`; }
    if (l.kind === 'text') return '';
    n++; return hasT ? `${c}.${s}.${n}` : String(n);
  });
}
function sectionTotals(lines) {
  const m = {}; let c = null; let s = null;
  for (const l of lines) {
    if (l.kind === 'title') { if (tlevel(l) === 2) { s = l.id; m[s] = 0; } else { c = l.id; s = null; m[c] = 0; } } else if (l.kind === 'item' && !l.option) {
      const t = num(l.qty) * num(l.price);
      if (c) m[c] = r2(m[c] + t);
      if (s) m[s] = r2(m[s] + t);
    }
  }
  return m;
}
// Fin du bloc commençant à i (un chapitre emporte ses sous-chapitres et lignes)
function blockEnd(lines, i) {
  const lv = tlevel(lines[i]);
  if (lv === 3) return i + 1;
  let k = i + 1;
  while (k < lines.length && !(lines[k].kind === 'title' && tlevel(lines[k]) <= lv)) k++;
  return k;
}
function invState(inv) {
  const d = inv.data;
  const t = totals(d);
  const paid = r2((d.payments || []).reduce((s, p) => s + num(p.amount), 0));
  const rest = r2(t.total - paid);
  let s;
  if (d.kind === 'avoir') s = 'avoir';
  else if (d.status !== 'emise') s = 'brouillon';
  else if (rest <= 0.005) s = 'payee';
  else if (d.due && d.due < today()) s = 'retard';
  else if (paid > 0) s = 'partielle';
  else s = 'impayee';
  return { t, paid, rest, s };
}
const lid = () => Math.random().toString(36).slice(2, 10);
// Coût horaire de la main d'œuvre (déboursé €/h, Paramètres → Entreprise) : utilisé par les ouvrages
const moRate = () => num((S.settings.company || {}).moRate);
// Prix d'un article de bibliothèque ; un ouvrage additionne ses composants (avec % de pertes) et ses heures de main d'œuvre
function articleCost(a, all, depth = 0) {
  const d = a.data;
  // article simple, ou ouvrage sans composant ni heures : le déboursé encodé tel quel
  if (d.kind !== 'ouvrage' || !((d.components || []).length || num(d.moHours)) || depth > 4) return { cost: num(d.cost), costBy: { [d.kind === 'ouvrage' ? 'divers' : d.kind || 'divers']: num(d.cost) } };
  const costBy = {}; let cost = 0;
  if (num(d.moHours)) { const mo = num(d.moHours) * moRate(); cost += mo; costBy.mo = mo; }
  for (const c of d.components || []) {
    const sub = all.find((x) => x.id === +c.articleId);
    if (!sub) continue;
    const r = articleCost(sub, all, depth + 1);
    const q = num(c.qty) * (1 + num(c.loss) / 100);
    cost += r.cost * q;
    for (const [k, v] of Object.entries(r.costBy)) costBy[k] = (costBy[k] || 0) + v * q;
  }
  for (const k of Object.keys(costBy)) costBy[k] = r2(costBy[k] * 1e4) / 1e4;
  return { cost: r2(cost * 1e4) / 1e4, costBy };
}
function articlePrice(a, all) {
  const d = a.data;
  if (d.priceMode === 'fixed' && num(d.price)) return num(d.price);
  const cost = articleCost(a, all).cost;
  // sans déboursé connu : le prix de vente encodé dans la bibliothèque
  return cost > 0 ? r2(cost * (1 + num(d.margin) / 100)) : num(d.price);
}
function lineFromArticle(a, all) {
  const c = articleCost(a, all);
  const isO = a.data.kind === 'ouvrage';
  return { id: lid(), kind: 'item', articleId: a.id, desc: a.data.name + (a.data.desc ? '\n' + a.data.desc : ''), unit: a.data.unit || 'u', qty: 1,
    cost: c.cost, price: articlePrice(a, all), vat: a.data.vat === '' || a.data.vat == null ? defVat() : num(a.data.vat), type: isO ? 'ouvrage' : a.data.kind, ...(isO ? { costBy: c.costBy } : {}), supplierId: a.data.supplierId || null };
}

// ---------------------------------------------------------------- Éditeur de lignes (tableau éditable)
// doc : objet data (devis, facture, commande) ; opts : { showCost, onChange, readOnly, library, contacts }
// ---------------------------------------------------------------- Mémoire des prix : lignes des devis précédents + bibliothèque
const P_STOP = new Set(['les', 'des', 'pour', 'avec', 'sans', 'sur', 'dans', 'par', 'une', 'aux', 'compris', 'fourniture', 'pose', 'y', 'et', 'the', 'van', 'het', 'een', 'voor', 'met', 'type', 'suivant', 'selon', 'mise', 'realisation', 'execution', 'placement', 'travaux', 'ensemble']);
const pWords = (s) => new Set(String(s || '').split('\n')[0].slice(0, 160).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9²³]+/).filter((w) => w.length >= 3 && !P_STOP.has(w)).map((w) => (w.length > 3 && /[a-z][sx]$/.test(w) ? w.slice(0, -1) : w)));
const pUnit = (u) => String(u || '').toLowerCase().replace(/^m2$/, 'm²').replace(/^m3$/, 'm³').replace(/^(pce|pcs|piece|pièce|st)$/, 'pc').trim();
let pMemo = null; let pMemoAt = 0;
async function priceMemory() {
  if (pMemo && Date.now() - pMemoAt < 60000) return pMemo;
  // les 200 derniers devis suffisent (grosses firmes : pas des milliers de devis complets à charger)
  const [qs, arts] = await Promise.all([db.list('quote', { last: 200 }), db.list('article')]);
  const out = [];
  for (const q of qs) for (const l of q.data.lines || []) if (l.kind === 'item' && !l.option && num(l.price) > 0 && l.desc) out.push({ id: l.id, w: pWords(l.desc), unit: pUnit(l.unit), price: num(l.price), cost: num(l.cost), date: q.data.date || '', no: q.number || 'brouillon', ok: q.data.status === 'accepte', qid: q.id, line: l });
  for (const a of arts) out.push({ lib: a, w: pWords(a.data.name), unit: pUnit(a.data.unit), price: articlePrice(a, arts), cost: articleCost(a, arts).cost, date: a.data.buy ? a.data.buy.d : (a.data.quoteDate || ''), name: a.data.name, arts });
  pMemo = out; pMemoAt = Date.now(); return out;
}
// lignes semblables (mots communs, même unité) : prix déjà pratiqués
// désignations déjà utilisées qui ressemblent à ce qui est tapé (« peinture mur » ≈ « Mise en peinture des murs ») : bibliothèque puis devis récents
async function descHints(l, skipIds, selfQuote) {
  const raw = String(l.desc || '').split('\n')[0]; if (raw.length < 4 || String(l.desc).includes('\n')) return [];
  const w = [...pWords(raw)]; if (!w.length) return [];
  const last = raw.trim().split(/\s+/).pop().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const typingLast = !/\s$/.test(raw) && w[w.length - 1] && last.startsWith(w[w.length - 1].slice(0, 3));
  const own = normKey(raw); const seen = new Set(); const out = [];
  const cand = (await priceMemory()).filter((x) => (x.lib || (selfQuote ? x.qid !== selfQuote : !skipIds.has(x.id))));
  for (const x of cand) {
    let n = 0;
    w.forEach((t, i) => { if (x.w.has(t) || (typingLast && i === w.length - 1 && [...x.w].some((y) => y.startsWith(t)))) n++; });
    const cover = n / w.length; if (cover < (w.length === 1 ? 1 : 0.5)) continue;
    const text = x.lib ? x.lib.data.name : String(x.line.desc).split('\n')[0];
    const k = normKey(text); if (k === own) continue;
    out.push({ ...x, text, k, sc: cover + (2 * n) / (w.length + x.w.size) / 2 });
  }
  out.sort((a, b) => b.sc - a.sc || (a.lib ? -1 : 0) - (b.lib ? -1 : 0) || (b.date > a.date ? 1 : -1));
  return out.filter((x) => (seen.has(x.k) ? false : seen.add(x.k))).slice(0, 6);
}
async function priceHints(l, skipIds, selfQuote) {
  const w = pWords(l.desc); if (w.size < 2) return null;
  const u = pUnit(l.unit);
  const sc = (x) => { let n = 0; for (const t of w) if (x.w.has(t)) n++; return (2 * n) / (w.size + x.w.size); };
  const hits = (await priceMemory()).filter((x) => (selfQuote ? x.qid !== selfQuote : !skipIds.has(x.id)) && (!u || u === 'u' || !x.unit || x.unit === u || x.lib)).map((x) => ({ ...x, s: sc(x) })).filter((x) => x.s >= 0.6);
  const qs = hits.filter((x) => !x.lib).sort((a, b) => b.s - a.s || (b.date > a.date ? 1 : -1));
  const best = qs.length ? qs.filter((x) => x.s >= qs[0].s - 0.15).sort((a, b) => (b.date > a.date ? 1 : -1)) : [];
  const lib = hits.filter((x) => x.lib).sort((a, b) => b.s - a.s)[0] || null;
  if (!best.length && !lib) return null;
  return { last: best[0] || null, avg: best.length > 1 ? r2(best.reduce((t, x) => t + x.price, 0) / best.length) : null, n: best.length, okN: best.filter((x) => x.ok).length, lib };
}

function linesEditor(el, doc, opts) {
  doc.lines = doc.lines || [];
  const showCost = opts.showCost && ui.showCost !== false;
  const draw = () => {
    // colonne « TM » (type de marché : QF, QP, FT…) affichée dès qu'une ligne en a un
    const showTm = doc.lines.some((l) => l.kind === 'item' && String(l.tm || '').trim());
    const span = (showCost ? 7 : 5) + (showTm ? 1 : 0);
    const nos = numbering(doc.lines); const own = ownNos(doc.lines);
    const noCell = (l, i) => (own && !opts.readOnly ? `<input class="in no" data-k="no" value="${esc(l.no ?? '')}" placeholder="—">` : nos[i]);
    const st = sectionTotals(doc.lines);
    el.innerHTML = `<div class="lines-wrap"><table class="lines ${showCost ? 'with-cost' : ''}">
      <thead><tr><th class="c-no">N°</th><th>Désignation</th>${showTm ? '<th class="c-tm" title="Type de marché">TM</th>' : ''}<th class="c-u">Unité</th><th class="c-n">Qté</th>
        ${showCost ? '<th class="c-n">Déboursé u.</th><th class="c-n">Marge %</th>' : ''}<th class="c-n">PU HT</th><th class="c-v">TVA</th><th class="c-n">Total HT</th><th class="c-a"></th></tr></thead>
      <tbody>${doc.lines.map((l, i) => {
        if (l.kind === 'title') return `<tr class="l-title ${tlevel(l) === 2 ? 'lv2' : ''}" data-i="${i}"><td class="c-no">${noCell(l, i)}</td><td colspan="${span}"><input class="in" data-k="desc" value="${esc(l.desc)}" placeholder="${tlevel(l) === 2 ? 'Titre du sous-chapitre' : 'Titre du chapitre'}" ${opts.readOnly ? 'readonly' : ''}></td><td class="c-n"><b data-sec="${l.id}">${money(st[l.id])}</b></td><td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
        if (l.kind === 'text') return `<tr class="l-text" data-i="${i}"><td></td><td colspan="${span + 1}"><textarea class="in" data-k="desc" rows="1" placeholder="Texte libre / commentaire" ${opts.readOnly ? 'readonly' : ''}>${esc(l.desc)}</textarea></td><td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
        const m = num(l.cost) > 0 ? r2((num(l.price) / num(l.cost) - 1) * 100) : '';
        return `<tr class="l-item ${l.option ? 'opt' : ''}" data-i="${i}"><td class="c-no">${noCell(l, i)}${l.type ? `<i class="tdot" style="--c:${TYPE_COLORS[l.type] || '#999'}" title="${esc(TYPES[l.type] || 'Ouvrage')}"></i>` : ''}</td>
          <td class="c-d"><textarea class="in" data-k="desc" rows="1" placeholder="Désignation" ${opts.readOnly ? 'readonly' : ''}>${esc(l.desc)}</textarea>${l.note != null ? `<textarea class="in l-note" data-k="note" rows="1" placeholder="Remarque sur ce poste (imprimée en italique sous la désignation)" ${opts.readOnly ? 'readonly' : ''}>${esc(l.note)}</textarea>` : ''}${l.option ? '<small class="muted">En option – non compris dans le total</small>' : ''}${l.calc ? `<small class="muted l-calcd">Prix calculé : ${esc(calcSummary(l.calc))}</small>` : ''}${l.disc ? `<small class="l-discd">${esc(lineDiscText(l))}</small>` : ''}
            ${opts.readOnly ? '' : `<div class="l-acts"><button type="button" class="${l.option ? 'on' : ''}" data-lopt="${i}" title="Poste en option : affiché mais non compris dans le total">${l.option ? '☑' : '☐'} Option</button><button type="button" data-lcalc="${i}" title="Matériaux, temps, marge → prix unitaire">🧮 Calculer le prix</button><button type="button" class="${l.disc ? 'on' : ''}" data-ldisc="${i}" title="Remise en % ou en montant sur ce poste">％ ${l.disc ? esc(l.disc.mode === 'amt' ? `−${money(num(l.disc.v))}` : `−${fnum(num(l.disc.v))} %`) : 'Remise'}</button>${l.note == null ? `<button type="button" data-lnote="${i}">💬 Remarque</button>` : ''}</div>`}<div class="l-sugg" data-sg></div></td>
          ${showTm ? `<td class="c-tm" data-l="TM"><input class="in" data-k="tm" value="${esc(l.tm || '')}" maxlength="6" ${opts.readOnly ? 'readonly' : ''}></td>` : ''}
          <td class="c-u" data-l="Unité"><input class="in" data-k="unit" value="${esc(l.unit)}" data-units autocomplete="off" ${opts.readOnly ? 'readonly' : ''}></td>
          <td class="c-n" data-l="Qté"><input class="in r" data-k="qty" inputmode="decimal" value="${esc(l.qty)}" ${opts.readOnly ? 'readonly' : ''}></td>
          ${showCost ? `<td class="c-n" data-l="Déboursé u."><input class="in r" data-k="cost" inputmode="decimal" value="${esc(l.cost ?? '')}" ${opts.readOnly || l.costBy ? 'readonly' : ''} title="${l.costBy ? 'Ouvrage : ' + Object.entries(l.costBy).map(([k, v]) => `${TYPES[k] || k} ${money(v)}`).join(', ') : ''}"></td>
            <td class="c-n" data-l="Marge %"><input class="in r" data-k="margin" inputmode="decimal" value="${esc(m)}" ${opts.readOnly || l.disc ? 'readonly' : ''}></td>` : ''}
          <td class="c-n" data-l="PU HT"><input class="in r" data-k="price" inputmode="decimal" value="${esc(l.disc ? r2(num(l.price)) : l.price)}" ${opts.readOnly || l.disc ? 'readonly' : ''} ${l.disc ? `title="Prix remisé – avant remise ${esc(money(num(l.listPrice)))} : bouton « Remise » pour le modifier"` : ''}></td>
          <td class="c-v" data-l="TVA"><select class="in" data-k="vat" ${opts.readOnly ? 'disabled' : ''}>${vatOptions(l.vat).map(([v, t]) => `<option value="${v}" ${num(v) === num(l.vat) ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td class="c-n tot" data-l="Total HT">${money(num(l.qty) * num(l.price))}</td>
          <td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
      }).join('') || `<tr><td colspan="${span + 3}" class="empty">Aucune ligne. Ajoutez un chapitre, une ligne ou des éléments de la bibliothèque.</td></tr>`}</tbody></table></div>
      <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      ${opts.readOnly ? '' : `<div class="btns lines-add"><button class="btn" data-add="title">${I.plus} Chapitre</button><button class="btn" data-add="sub">${I.plus} Sous-chapitre</button><button class="btn" data-add="item">${I.plus} Ligne</button><button class="btn" data-add="text">${I.plus} Texte</button>
        ${opts.library !== false ? `<button class="btn primary" data-add="lib">${I.book} Depuis la bibliothèque</button>` : ''}<button class="btn" data-add="xls">${I.file} Importer Excel / PDF</button>${own ? '<button class="btn" data-autono title="Numéros du métré remplacés par 1.1.1, 1.1.2…">Numérotation automatique</button>' : ''}${doc.lines.some((l) => l.kind === 'item') ? `<button class="btn" data-allvat>${I.percent || ''} TVA de toutes les lignes</button><button class="btn" data-gdisc>％ Remise${doc.discountMode === 'amt' && num(doc.discountAmt) ? ` (${money(num(doc.discountAmt))})` : num(doc.discount) ? ` (${fnum(num(doc.discount))} %)` : ''}</button>` : ''}
        ${opts.showCost ? `<label class="chk small"><input type="checkbox" data-showcost ${showCost ? 'checked' : ''}>Afficher déboursés et marges</label>` : ''}</div>`}`;
    bind();
  };
  const changed = () => opts.onChange && opts.onChange();
  const autoGrow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  // toutes les zones de texte d'un coup : d'abord toutes les écritures, puis toutes les lectures (une seule mise en page,
  // au lieu d'une par ligne : un devis de 400 lignes s'ouvrait en plusieurs secondes)
  const growAll = () => { const ts = $$('textarea.in', el); ts.forEach((t) => { t.style.height = 'auto'; }); const hs = ts.map((t) => t.scrollHeight); ts.forEach((t, i) => { t.style.height = hs[i] + 'px'; }); };
  function bind() {
    growAll();
    requestAnimationFrame(growAll); // après la mise en page (cartes sur téléphone)
    $$('tr[data-i]', el).forEach((tr) => {
      const l = doc.lines[+tr.dataset.i];
      $$('[data-k]', tr).forEach((inp) => {
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          const k = inp.dataset.k;
          if (inp.tagName === 'TEXTAREA') autoGrow(inp);
          if (k === 'desc' || k === 'unit' || k === 'note') l[k] = inp.value;
          else if (k === 'no') l.no = inp.value.trim();
          else if (k === 'tm') l.tm = inp.value.trim().toUpperCase();
          else if (k === 'vat') l.vat = num(inp.value);
          else if (k === 'margin') { if (num(l.cost) > 0) { l.price = r2(num(l.cost) * (1 + num(inp.value) / 100)); $('[data-k=price]', tr).value = l.price; } }
          else {
            l[k] = inp.value.trim() === '' ? '' : num(inp.value);
            if (k === 'qty' && l.disc && l.disc.mode === 'amt') { applyLineDisc(l); const pi = $('[data-k=price]', tr); if (pi) pi.value = r2(num(l.price)); }
            const mi = $('[data-k=margin]', tr);
            if (k === 'cost' && mi && mi.value !== '' && num(l.cost) > 0) { l.price = r2(num(l.cost) * (1 + num(mi.value) / 100)); $('[data-k=price]', tr).value = l.price; }
            else if (mi && num(l.cost) > 0) mi.value = r2((num(l.price) / num(l.cost) - 1) * 100);
          }
          const tot = $('.tot', tr); if (tot) tot.textContent = money(num(l.qty) * num(l.price));
          const secs = sectionTotals(doc.lines);
          $$('[data-sec]', el).forEach((x) => { x.textContent = money(secs[x.dataset.sec]); });
          changed();
        });
        if (inp.dataset.k !== 'desc') inp.addEventListener('blur', () => { if (!['unit', 'tm', 'no', 'note'].includes(inp.dataset.k)) drawSoon(); });
        // désignation d'une ligne : prix déjà pratiqués pour des lignes semblables
        if (inp.dataset.k === 'desc' && l.kind === 'item' && !opts.readOnly) {
          let t; const go2 = () => { clearTimeout(t); t = setTimeout(() => showHints(tr, l), 450); };
          inp.addEventListener('input', go2); inp.addEventListener('focus', go2);
        }
      });
    });
    $$('[data-menu]', el).forEach((b) => { b.onclick = () => lineMenu(+b.dataset.menu); });
    $$('[data-add]', el).forEach((b) => { b.onclick = () => add(b.dataset.add); });
    const an = $('[data-autono]', el); if (an) an.onclick = () => { if (!confirm('Remplacer les numéros du métré par une numérotation automatique (1.1.1, 1.1.2…) ?')) return; doc.lines.forEach((l) => { delete l.no; }); draw(); changed(); };
    const av = $('[data-allvat]', el); if (av) av.onclick = () => setVat(0, doc.lines.length, 'toutes les lignes');
    const gd = $('[data-gdisc]', el); if (gd) gd.onclick = () => discountModal(doc, null, () => { draw(); changed(); });
    const sc = $('[data-showcost]', el); if (sc) sc.onchange = () => { ui.showCost = sc.checked; saveUi(); linesEditor(el, doc, opts); };
  }
  async function showHints(tr, l) {
    const box = $('[data-sg]', tr); if (!box) return;
    const skip = new Set(doc.lines.map((x) => x.id));
    const [h, ds] = await Promise.all([priceHints(l, skip, opts.selfQuote), descHints(l, skip, opts.selfQuote)]);
    if (!h && !ds.length) { box.innerHTML = ''; return; }
    const u = l.unit ? `/${esc(l.unit)}` : '';
    const dl = ds.length ? `<div class="sg-list"><small>Déjà utilisé – cliquez pour reprendre la désignation${ds.some((x) => x.lib) ? ', l\'unité et le prix' : ' et le prix'} :</small>${ds.map((x, i) => `<button type="button" class="sg-d" data-sd="${i}"><span>${esc(x.text)}</span><em>${esc(x.lib ? x.lib.data.unit || 'u' : x.line.unit || '')} · ${money(x.price)}</em><small>${x.lib ? 'bibliothèque' : `${esc(x.no)}${x.ok ? ' ✓' : ''}`}</small></button>`).join('')}</div>` : '';
    box.innerHTML = `${dl}${h ? `<span class="sg-i">💡</span>${h.last ? `<button type="button" class="sg-b" data-sp="${h.last.price}" data-sc="${h.last.cost || ''}" title="Appliquer ce prix">${money(h.last.price)}${u}</button><span>${esc(h.last.no)}${h.last.date ? ` · ${fmtDate(h.last.date)}` : ''}${h.last.ok ? ' <b class="ok">✓ accepté</b>' : ''}</span>` : ''}
      ${h.avg != null ? `<button type="button" class="sg-b" data-sp="${h.avg}" title="Appliquer la moyenne">moyenne ${money(h.avg)}</button><span>sur ${h.n} devis${h.okN ? ` (${h.okN} accepté${h.okN > 1 ? 's' : ''})` : ''}</span>` : ''}
      ${h.lib ? `<button type="button" class="sg-b lib" data-sp="${h.lib.price}" data-sc="${h.lib.cost || ''}" title="${esc(h.lib.name)}">bibliothèque ${money(h.lib.price)}</button>${h.lib.cost ? `<span>déboursé ${money(h.lib.cost)}${h.lib.date ? ` (acheté ${fmtDate(h.lib.date)})` : ''}</span>` : ''}` : ''}` : ''}`;
    // reprendre une désignation : texte complet, unité, prix, déboursé (un article de la bibliothèque est lié à la ligne)
    $$('[data-sd]', box).forEach((b) => {
      b.onmousedown = (ev) => ev.preventDefault();
      b.onclick = () => {
        const x = ds[+b.dataset.sd];
        const src = x.lib ? lineFromArticle(x.lib, x.arts) : x.line;
        Object.assign(l, { desc: src.desc, unit: src.unit || l.unit, price: num(src.price), cost: src.cost ?? '', type: src.type || l.type, ...(src.articleId ? { articleId: src.articleId } : {}) });
        if (src.costBy) l.costBy = src.costBy; else delete l.costBy;
        box.innerHTML = ''; draw(); changed(); toast('Désignation et prix repris', 1500);
      };
    });
    $$('[data-sp]', box).forEach((b) => {
      b.onmousedown = (ev) => ev.preventDefault(); // garde le focus dans la désignation
      b.onclick = () => {
        l.price = num(b.dataset.sp); if (b.dataset.sc !== '') l.cost = num(b.dataset.sc);
        const pi = $('[data-k=price]', tr); if (pi) pi.value = l.price; const ci = $('[data-k=cost]', tr); if (ci && b.dataset.sc !== '') ci.value = l.cost;
        const mi = $('[data-k=margin]', tr); if (mi) mi.value = num(l.cost) > 0 ? r2((num(l.price) / num(l.cost) - 1) * 100) : '';
        const tot = $('.tot', tr); if (tot) tot.textContent = money(num(l.qty) * num(l.price));
        const secs = sectionTotals(doc.lines); $$('[data-sec]', el).forEach((x) => { x.textContent = money(secs[x.dataset.sec]); });
        box.innerHTML = ''; changed(); toast(`Prix appliqué : ${money(l.price)}`, 1500);
      };
    });
  }
  let drawT;
  const drawSoon = () => { clearTimeout(drawT); drawT = setTimeout(() => { if (!el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') { draw(); changed(); } }, 150); };
  const newItem = () => ({ id: lid(), kind: 'item', desc: '', unit: 'u', qty: 1, cost: '', price: 0, vat: opts.defVat != null && opts.defVat !== '' ? num(opts.defVat) : defVat(), type: 'divers' });
  async function add(k, at) {
    const pos = at == null ? doc.lines.length : at;
    if (k === 'lib') return pickArticles((items) => { doc.lines.splice(pos, 0, ...items); draw(); changed(); });
    if (k === 'xls') return importLinesExcel((items) => { doc.lines.splice(pos, 0, ...items); draw(); changed(); });
    const l = k === 'title' ? { id: lid(), kind: 'title', desc: '' } : k === 'sub' ? { id: lid(), kind: 'title', level: 2, desc: '' } : k === 'text' ? { id: lid(), kind: 'text', desc: '' } : newItem();
    doc.lines.splice(pos, 0, l);
    draw(); changed();
    const inp = $(`tr[data-i="${pos}"] [data-k=desc]`, el); if (inp) inp.focus();
  }
  // déplace une ligne, ou un (sous-)chapitre avec son contenu, d'un cran parmi ses frères
  function moveBlock(i, dir) {
    const L = doc.lines;
    if (L[i].kind !== 'title') { const j = i + dir; if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; return; }
    const lv = tlevel(L[i]); const end = blockEnd(L, i);
    if (dir < 0) {
      let p = -1;
      for (let k = i - 1; k >= 0; k--) { if (L[k].kind === 'title' && tlevel(L[k]) < lv) break; if (L[k].kind === 'title' && tlevel(L[k]) === lv) { p = k; break; } }
      if (p >= 0) L.splice(p, 0, ...L.splice(i, end - i));
    } else if (end < L.length && L[end].kind === 'title' && tlevel(L[end]) === lv) L.splice(i, 0, ...L.splice(end, blockEnd(L, end) - end));
  }
  // TVA appliquée d'un coup à toutes les lignes (ou à un chapitre)
  async function setVat(from, to, what) {
    const items = doc.lines.slice(from, to).filter((x) => x.kind === 'item');
    if (!items.length) return toast('Aucune ligne chiffrée');
    const v = await ask(`TVA – ${what}`, [{ name: 'vat', label: `Taux pour ${items.length} ligne(s)`, type: 'select', options: vatOptions(items[0].vat) }], { vat: items[0].vat });
    if (!v) return;
    items.forEach((x) => { x.vat = num(v.vat); });
    draw(); changed(); toast(`TVA ${fnum(num(v.vat))} % appliquée à ${items.length} ligne(s)`, 3000);
  }
  // boutons de la ligne : option, calcul du prix, remarque
  // (un seul écouteur par zone, même si l'éditeur est recréé sur la même zone)
  el.__lineActs = (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-lopt],[data-lcalc],[data-lnote],[data-ldisc]'); if (!b || opts.readOnly) return;
    const l = doc.lines[+(b.dataset.lopt ?? b.dataset.lcalc ?? b.dataset.lnote ?? b.dataset.ldisc)]; if (!l) return;
    if (b.dataset.ldisc != null) return discountModal(doc, [l], () => { draw(); changed(); });
    if (b.dataset.lopt != null) { l.option = !l.option; draw(); changed(); toast(l.option ? 'En option : affiché, non compris dans le total' : 'Compris dans le total', 2500); }
    else if (b.dataset.lnote != null) { l.note = ''; draw(); changed(); const t = $(`tr[data-i="${b.dataset.lnote}"] [data-k=note]`, el); if (t) t.focus(); }
    else priceCalc(l, () => { draw(); changed(); });
  };
  if (!el.__lineActsOn) { el.__lineActsOn = true; el.addEventListener('click', (ev) => { if (el.__lineActs) el.__lineActs(ev); }); }
  function lineMenu(i) {
    const l = doc.lines[i];
    menuSheet(l.kind === 'title' ? (tlevel(l) === 2 ? 'Sous-chapitre' : 'Chapitre') : 'Ligne', [
      ...(l.kind === 'title' ? [{ label: 'TVA de tout ce chapitre…', run: () => setVat(i, blockEnd(doc.lines, i), `Chapitre « ${l.desc || '—'} »`) },
        { label: 'Remise sur tout ce chapitre…', run: () => discountModal(doc, doc.lines.slice(i, blockEnd(doc.lines, i)).filter((x) => x.kind === 'item' && !x.option), () => { draw(); changed(); }, `Chapitre « ${l.desc || '—'} »`) }] : []),
      ...(l.kind === 'title' ? [{ label: tlevel(l) === 2 ? 'Transformer en chapitre' : 'Transformer en sous-chapitre', run: () => { if (tlevel(l) === 2) delete l.level; else l.level = 2; draw(); changed(); } }] : []),
      { label: 'Insérer une ligne en dessous', run: () => add('item', i + 1) },
      { label: 'Insérer depuis la bibliothèque en dessous', run: () => add('lib', i + 1) },
      { label: 'Monter', run: () => { moveBlock(i, -1); draw(); changed(); } },
      { label: 'Descendre', run: () => { moveBlock(i, 1); draw(); changed(); } },
      { label: 'Dupliquer', run: () => {
        const end = blockEnd(doc.lines, i);
        doc.lines.splice(end, 0, ...doc.lines.slice(i, end).map((x) => ({ ...JSON.parse(JSON.stringify(x)), id: lid() })));
        draw(); changed();
      } },
      ...(l.kind === 'item' ? [
        { label: 'Type de déboursé…', run: async () => { const v = await ask('Type de déboursé', [{ name: 'type', label: 'Type', type: 'select', options: optsOf(TYPES) }], { type: l.type }); if (v) { l.type = v.type; delete l.costBy; draw(); changed(); } } },
        { label: l.option ? 'Inclure dans le total' : 'Mettre en option (hors total)', run: () => { l.option = !l.option; draw(); changed(); } },
        { label: 'Calculer le prix (matériaux, temps, marge)…', run: () => priceCalc(l, () => { draw(); changed(); }) },
        { label: l.disc ? 'Modifier la remise de ce poste…' : 'Remise sur ce poste…', run: () => discountModal(doc, [l], () => { draw(); changed(); }) },
        ...(l.note != null ? [{ label: 'Retirer la remarque', run: () => { delete l.note; draw(); changed(); } }] : [{ label: 'Ajouter une remarque', run: () => { l.note = ''; draw(); changed(); } }]),
        { label: 'Enregistrer dans la bibliothèque', run: () => editArticle(null, { name: l.desc.split('\n')[0], desc: l.desc.split('\n').slice(1).join('\n'), unit: l.unit, kind: TYPES[l.type] ? l.type : 'divers', cost: l.cost, margin: num(l.cost) > 0 ? r2((num(l.price) / num(l.cost) - 1) * 100) : 0, vat: l.vat }) },
      ] : []),
      { label: l.kind === 'title' ? 'Supprimer avec tout son contenu' : 'Supprimer', danger: true, run: () => {
        doc.lines.splice(i, blockEnd(doc.lines, i) - i); draw(); changed();
      } },
    ]);
  }
  draw();
  return { redraw: draw };
}

// ---------------------------------------------------------------- Calcul du prix d'un poste : matériaux + temps + autres frais, puis marge
// Tout est « par unité » du poste (par m², par pièce…). Le détail reste sur la ligne (l.calc) pour le reprendre plus tard.
const calcCost = (c) => {
  const mat = r2((c.mats || []).reduce((a, m) => a + num(m.qty) * num(m.price) * (1 + num(m.loss) / 100), 0));
  const mo = r2(num(c.hours) * num(c.rate)); const other = r2(num(c.other));
  const cost = r2(mat + mo + other); return { mat, mo, other, cost, price: r2(cost * (1 + num(c.margin) / 100)) };
};
const calcSummary = (c) => { const x = calcCost(c); return [x.mat && `matériaux ${money(x.mat)}`, x.mo && `main d'œuvre ${fnum(num(c.hours))} h × ${money(num(c.rate))}`, x.other && `autres ${money(x.other)}`, `marge ${fnum(num(c.margin))} %`].filter(Boolean).join(' · '); };
async function priceCalc(l, onDone) {
  const arts = await db.list('article').catch(() => []);
  const c = JSON.parse(JSON.stringify(l.calc || { mats: [], hours: '', rate: moRate() || '', other: '', margin: num(l.cost) > 0 && num(l.price) > 0 ? r2((num(l.price) / num(l.cost) - 1) * 100) : 25 }));
  if (!c.mats.length) c.mats.push({ name: '', qty: '', price: '', loss: '' });
  const unit = l.unit || 'unité';
  const m = modal(`${mhead('Calculer le prix')}<div class="m-body pc">
    <p class="muted">Pour <b>1 ${esc(unit)}</b> de « ${esc((l.desc || 'ce poste').split('\n')[0].slice(0, 80))} » : ce qu'il faut en matériaux et en temps. BatiPro calcule le prix unitaire.</p>
    <h4>Matériaux (par ${esc(unit)})</h4>
    <table class="pc-mats"><thead><tr><th>Matériau</th><th class="r">Qté</th><th class="r">Prix u. (achat)</th><th class="r">Pertes %</th><th class="r">Coût</th><th></th></tr></thead><tbody data-mats></tbody></table>
    <button type="button" class="btn sm" data-addm>＋ Matériau</button>
    <datalist id="pc-arts">${arts.filter((a) => a.data.kind !== 'ouvrage').slice(0, 500).map((a) => `<option value="${esc(a.data.name)}">`).join('')}</datalist>
    <h4>Main d'œuvre (par ${esc(unit)})</h4>
    <div class="grid2"><label class="field"><span>Temps (heures)</span><input data-c="hours" inputmode="decimal" value="${esc(c.hours)}" placeholder="ex. 0,5"></label>
      <label class="field"><span>Coût horaire (€/h)</span><input data-c="rate" inputmode="decimal" value="${esc(c.rate)}" placeholder="ex. 45"></label></div>
    <div class="grid2"><label class="field"><span>Autres frais par ${esc(unit)} (€, sous-traitance, location…)</span><input data-c="other" inputmode="decimal" value="${esc(c.other)}"></label>
      <label class="field"><span>Marge (%)</span><input data-c="margin" inputmode="decimal" value="${esc(c.margin)}"></label></div>
    <div class="pc-res" data-res></div></div>
    <div class="m-foot">${l.calc ? '<button class="btn ghost" data-rm>Retirer le calcul</button>' : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Appliquer ce prix</button></div>`, { wide: true });
  const res = () => { const x = calcCost(c); $('[data-res]', m.el).innerHTML = `<div class="tr"><span>Matériaux</span><b>${money(x.mat)}</b></div><div class="tr"><span>Main d'œuvre</span><b>${money(x.mo)}</b></div>${x.other ? `<div class="tr"><span>Autres frais</span><b>${money(x.other)}</b></div>` : ''}
      <div class="tr"><span>Déboursé par ${esc(unit)}</span><b>${money(x.cost)}</b></div><div class="tr big"><span>Prix de vente HT par ${esc(unit)}</span><b>${money(x.price)}</b></div>${num(l.qty) ? `<div class="tr muted"><span>× ${fnum(num(l.qty))} ${esc(unit)}</span><span>${money(x.price * num(l.qty))} HT</span></div>` : ''}`; };
  const drawM = () => {
    $('[data-mats]', m.el).innerHTML = c.mats.map((x, i) => `<tr data-m="${i}"><td><input data-f="name" list="pc-arts" value="${esc(x.name)}" placeholder="ex. Colle carrelage"></td><td><input class="r" data-f="qty" inputmode="decimal" value="${esc(x.qty)}"></td><td><input class="r" data-f="price" inputmode="decimal" value="${esc(x.price)}"></td><td><input class="r" data-f="loss" inputmode="decimal" value="${esc(x.loss)}" placeholder="0"></td><td class="r" data-mc>${money(num(x.qty) * num(x.price) * (1 + num(x.loss) / 100))}</td><td><button type="button" class="icon-btn sm" data-rmm="${i}" aria-label="Retirer">✕</button></td></tr>`).join('');
    $$('[data-m]', m.el).forEach((tr) => { const x = c.mats[+tr.dataset.m];
      $$('[data-f]', tr).forEach((inp) => { inp.oninput = () => { x[inp.dataset.f] = inp.value;
        if (inp.dataset.f === 'name') { const a = arts.find((y) => y.data.name === inp.value); if (a) { x.price = r2(num(articleCost(a, arts).cost) || num(a.data.cost) || num(a.data.price)); $('[data-f=price]', tr).value = x.price; } }
        $('[data-mc]', tr).textContent = money(num(x.qty) * num(x.price) * (1 + num(x.loss) / 100)); res(); }; }); });
    $$('[data-rmm]', m.el).forEach((b) => { b.onclick = () => { c.mats.splice(+b.dataset.rmm, 1); drawM(); res(); }; });
  };
  $$('[data-c]', m.el).forEach((inp) => { inp.oninput = () => { c[inp.dataset.c] = inp.value; res(); }; });
  $('[data-addm]', m.el).onclick = () => { c.mats.push({ name: '', qty: '', price: '', loss: '' }); drawM(); const ins = $$('[data-f=name]', m.el); ins[ins.length - 1].focus(); };
  const rm = $('[data-rm]', m.el); if (rm) rm.onclick = () => { delete l.calc; delete l.costBy; m.close(); onDone(); };
  $('[data-ok]', m.el).onclick = () => {
    c.mats = c.mats.filter((x) => String(x.name).trim() || num(x.qty) || num(x.price));
    const x = calcCost(c); if (!(x.price > 0)) { toast('Indiquez au moins un matériau ou un temps', 3000); return; }
    l.calc = c; l.price = x.price; l.cost = x.cost; l.costBy = Object.fromEntries(Object.entries({ mat: x.mat, mo: x.mo, divers: x.other }).filter(([, v]) => v));
    if (!l.type || l.type === 'divers') l.type = Object.keys(l.costBy).length > 1 ? 'ouvrage' : Object.keys(l.costBy)[0];
    m.close(); onDone(); toast(`Prix unitaire : ${money(x.price)} HT`, 3000);
  };
  drawM(); res();
}

// ---------------------------------------------------------------- Remises : sur tout le document, sur un poste ou sur un chapitre ; en % ou en montant
// lines = null : remise globale (en bas du document) ; sinon les postes concernés (le prix unitaire devient le prix remisé, le prix d'origine est gardé)
function discountModal(doc, lines, onDone, label) {
  const global = !lines; const one = lines && lines.length === 1 ? lines[0] : null;
  if (lines && !lines.length) { toast('Aucun poste dans ce chapitre', 3000); return; }
  const cur = global ? (doc.discountMode === 'amt' ? { mode: 'amt', v: num(doc.discountAmt) } : { mode: 'pct', v: num(doc.discount) }) : (one && one.disc ? { ...one.disc } : { mode: 'pct', v: '' });
  const listOf = (l) => (l.disc ? num(l.listPrice) : num(l.price));
  const before = global ? totals({ ...doc, discount: 0, discountMode: '', discountAmt: 0 }).net : r2(lines.reduce((a, l) => a + r2(num(l.qty) * listOf(l)), 0));
  const title = global ? 'Remise globale' : one ? 'Remise sur ce poste' : `Remise – ${label || `${lines.length} postes`}`;
  const m = modal(`${mhead(title)}<div class="m-body">
    <p class="muted">${global ? 'Déduite du total HT, avant la TVA (répartie entre les taux de TVA).' : one ? `« ${esc(String(one.desc || '').split('\n')[0].slice(0, 80))} » – ${fnum(num(one.qty))} ${esc(one.unit || '')} × ${money(listOf(one))}` : `${lines.length} poste(s) : la même remise sur chacun.`}</p>
    <div class="seg dmode">${[['pct', 'Pourcentage (%)'], ['amt', 'Montant (€)']].map(([k, t]) => `<button type="button" data-dm="${k}" class="${cur.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <label class="field"><span data-dl>${cur.mode === 'amt' ? (global ? 'Montant de la remise (€ HT)' : one ? 'Montant de la remise sur ce poste (€ HT)' : 'Montant de la remise par poste (€ HT)') : 'Remise (%)'}</span><input data-dv inputmode="decimal" value="${esc(cur.v || '')}" placeholder="${cur.mode === 'amt' ? 'ex. 250' : 'ex. 10'}"></label>
    <div class="pay-rest" data-dres></div></div>
    <div class="m-foot">${(global && (num(doc.discount) || num(doc.discountAmt))) || (lines && lines.some((l) => l.disc)) ? '<button class="btn ghost danger" data-drm>Retirer la remise</button>' : ''}<span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-dok>Appliquer</button></div>`);
  let mode = cur.mode;
  const val = () => num($('[data-dv]', m.el).value);
  const res = () => { const v = val(); const red = mode === 'amt' ? (global || one ? Math.min(v, before) : Math.min(v * lines.length, before)) : r2(before * v / 100);
    $('[data-dres]', m.el).innerHTML = `<div><span>${global ? 'Total HT avant remise' : 'Montant HT avant remise'}</span><b>${money(before)}</b></div><div><span>Remise</span><b>− ${money(red)}</b></div><div class="big ok"><span>Après remise</span><b>${money(r2(before - red))}</b></div>`; };
  $$('[data-dm]', m.el).forEach((b) => { b.onclick = () => { mode = b.dataset.dm; $$('[data-dm]', m.el).forEach((x) => x.classList.toggle('on', x === b)); $('[data-dl]', m.el).textContent = mode === 'amt' ? (global ? 'Montant de la remise (€ HT)' : one ? 'Montant de la remise sur ce poste (€ HT)' : 'Montant de la remise par poste (€ HT)') : 'Remise (%)'; res(); }; });
  $('[data-dv]', m.el).oninput = res;
  const clear = () => {
    if (global) { doc.discount = 0; doc.discountMode = ''; doc.discountAmt = 0; }
    else lines.forEach((l) => { if (l.disc) { l.price = num(l.listPrice); delete l.disc; delete l.listPrice; } });
  };
  const rm = $('[data-drm]', m.el); if (rm) rm.onclick = () => { clear(); m.close(); onDone(); toast('Remise retirée', 2500); };
  $('[data-dok]', m.el).onclick = () => {
    const v = val(); if (!(v > 0)) { clear(); m.close(); onDone(); return; }
    if (mode === 'pct' && v >= 100) { toast('Une remise doit rester sous 100 %', 3000); return; }
    if (global) { if (mode === 'amt') { doc.discountMode = 'amt'; doc.discountAmt = r2(v); doc.discount = 0; } else { doc.discountMode = ''; doc.discountAmt = 0; doc.discount = v; } }
    else lines.forEach((l) => { if (!l.disc) l.listPrice = num(l.price); l.disc = { mode, v: mode === 'amt' ? r2(v) : v }; applyLineDisc(l); });
    m.close(); onDone(); toast(global ? 'Remise globale appliquée' : 'Remise appliquée', 2500);
  };
  res(); setTimeout(() => $('[data-dv]', m.el).focus(), 50);
}

// Sélecteur d'articles de la bibliothèque (choix multiple avec quantités)
async function pickArticles(onPick) {
  const all = await db.list('article');
  if (!all.length) { toast('La bibliothèque est vide – ajoutez des articles dans le menu Bibliothèque', 4000); return; }
  all.sort((a, b) => (a.data.category || '').localeCompare(b.data.category || '') || a.data.name.localeCompare(b.data.name));
  const picked = new Map();
  const m = modal(`${mhead('Ajouter depuis la bibliothèque')}<div class="m-body">
    <div class="dt-tools"><label class="search">${I.search}<input type="search" placeholder="Rechercher (code, nom, catégorie)…"></label>
      <select data-kind><option value="">Tous les types</option>${Object.entries({ ...TYPES, ouvrage: 'Ouvrages' }).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="pick-list"></div></div>
    <div class="m-foot"><span class="muted" data-cnt>0 sélectionné</span><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-ok>Ajouter</button></div>`, { wide: true });
  const draw = () => {
    const q = $('input[type=search]', m.el).value.toLowerCase(); const k = $('[data-kind]', m.el).value;
    const list = all.filter((a) => (!k || a.data.kind === k) && (!q || [a.data.code, a.data.name, a.data.category].join(' ').toLowerCase().includes(q)));
    $('.pick-list', m.el).innerHTML = list.slice(0, 300).map((a) => `<label class="pick-row"><input type="checkbox" data-a="${a.id}" ${picked.has(a.id) ? 'checked' : ''}>
      <i class="tdot" style="--c:${TYPE_COLORS[a.data.kind] || '#999'}"></i><span class="grow"><b>${esc(a.data.name)}</b><small class="muted">${esc([a.data.code, a.data.category, a.data.kind === 'ouvrage' ? 'Ouvrage' : TYPES[a.data.kind]].filter(Boolean).join(' · '))}</small></span>
      <input class="qty" data-q="${a.id}" inputmode="decimal" value="${picked.get(a.id) ?? 1}" title="Quantité"><span class="muted">${esc(a.data.unit || '')}</span><b class="r">${money(articlePrice(a, all))}</b></label>`).join('') || '<div class="empty">Aucun résultat</div>';
    $$('[data-a]', m.el).forEach((c) => { c.onchange = () => { const id = +c.dataset.a; if (c.checked) picked.set(id, num($(`[data-q="${id}"]`, m.el).value) || 1); else picked.delete(id); $('[data-cnt]', m.el).textContent = `${picked.size} sélectionné(s)`; }; });
    $$('[data-q]', m.el).forEach((inp) => { inp.oninput = () => { const id = +inp.dataset.q; if (picked.has(id)) picked.set(id, num(inp.value)); }; inp.onclick = (e) => e.stopPropagation(); });
  };
  $('input[type=search]', m.el).oninput = draw; $('[data-kind]', m.el).onchange = draw;
  $('[data-ok]', m.el).onclick = () => {
    const items = [...picked].map(([id, q]) => ({ ...lineFromArticle(all.find((a) => a.id === id), all), qty: q }));
    m.close(); if (items.length) onPick(items);
  };
  draw();
}

function totalsBox(t, doc, internal) {
  return `<div class="totals">
    <div class="tr"><span>Total HT</span><b>${money(t.net)}</b></div>
    ${t.discount ? `<div class="tr"><span>Remise ${fnum(num(doc.discount))} %</span><b>−${money(t.discount)}</b></div><div class="tr"><span>Total HT après remise</span><b>${money(t.base)}</b></div>` : ''}
    ${doc.reverse ? '<div class="tr"><span>TVA – autoliquidation</span><b>0,00</b></div>' : t.vats.map((v) => `<div class="tr"><span>TVA ${fnum(v.rate)} % sur ${money(v.base)}</span><b>${money(v.vat)}</b></div>`).join('')}
    <div class="tr big"><span>Total TVAC</span><span>${money(t.total)}</span></div>
    ${internal ? `<div class="tr int"><span>Déboursé sec</span><span>${money(t.cost)}</span></div><div class="tr int"><span>Marge brute</span><span>${money(t.margin)}${t.base ? ` · ${fnum((t.margin / t.base) * 100, 1)} %` : ''}</span></div>
      ${Object.entries(t.costBy).filter(([, v]) => v).map(([k, v]) => `<div class="tr int sm"><span><i class="tdot" style="--c:${TYPE_COLORS[k] || '#999'}"></i>${esc(TYPES[k] || k)}</span><span>${money(v)}</span></div>`).join('')}` : ''}
  </div>`;
}

// ---------------------------------------------------------------- Page d'impression (documents : voir docs.js)
// mail : fonction qui ouvre la fenêtre d'envoi par email (bouton « Envoyer » affiché si présent)
function printPage(title, html, back, mail, fname) {
  const fn = fname || fileTitle(title);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  app.innerHTML = `<div class="print-shell"><header class="top no-print"><a class="icon-btn" href="${back}" aria-label="Retour">${I.back}</a><div class="top-title"><h1>${esc(title)}</h1></div>
    <div class="top-actions">${mail ? `<button class="btn primary" data-act="mail">${I.mail} Envoyer</button>` : ''}<button class="btn" data-act="dl">${I.download} Télécharger</button><button class="btn ${mail ? '' : 'primary'}" data-act="pdf">${I.file} PDF / Partager</button>${standalone ? '' : `<button class="btn" data-act="print">${I.print} Imprimer</button>`}</div></header><div class="print-page">${html}</div></div>`;
  if (mail) $('[data-act=mail]').onclick = () => mail();
  const pr = $('[data-act=print]');
  if (pr) pr.onclick = () => { const old = document.title; document.title = fn; window.print(); setTimeout(() => { document.title = old; }, 800); };
  // téléchargement direct du PDF (qualité normale)
  $('[data-act=dl]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const blob = await makePdf(); const a = document.createElement('a'); const url = URL.createObjectURL(blob);
      a.href = url; a.download = fn + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000); toast('PDF téléchargé', 2000);
    } catch (err) { console.error(err); toast('PDF impossible : ' + err.message, 5000); } finally { btn.disabled = false; }
  };
  $('[data-act=pdf]').onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { await sharePdf(title, fn); } catch (err) { console.error(err); toast('PDF impossible : ' + err.message, 5000); } finally { btn.disabled = false; }
  };
}
const fileTitle = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'document';
const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) scriptCache[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error('chargement impossible')); }; document.head.appendChild(s); });
  return scriptCache[src];
}
// Génère un vrai PDF A4 dans le navigateur (fonctionne aussi sur iPhone, où l'impression est bloquée dans l'app installée)
// src : HTML d'un document à convertir (par défaut, la page d'impression affichée)
// opt.light : PDF plus léger (exports groupés, envoi au comptable)
// html2canvas ne lit pas color(srgb …) (produit par color-mix) : converti en rgba dans la copie capturée
const h2cToRgb = (v) => v.replace(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/g, (m0, r, g, bl, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)}, ${a ?? 1})`);
function h2cFixColors(cdoc) {
  const win = cdoc.defaultView;
  cdoc.querySelectorAll('*').forEach((el) => {
    const cs = win.getComputedStyle(el);
    for (const prop of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color']) {
      const v = cs.getPropertyValue(prop);
      if (v && v.includes('color(')) el.style.setProperty(prop, h2cToRgb(v));
    }
    const bg = cs.getPropertyValue('background-image');
    if (bg && bg.includes('color(')) el.style.setProperty('background-image', h2cToRgb(bg));
  });
}
async function makePdf(src, opt = {}) {
  if (src == null) toast('Création du PDF…', 60000);
  await Promise.all([loadScript('assets/vendor/html2canvas-1.4.1.min.js'), loadScript('assets/vendor/jspdf-2.5.1.umd.min.js')]);
  const page = $('.print-page');
  const holder = document.createElement('div');
  holder.innerHTML = src ?? page.innerHTML;
  // A4 portrait (794 px à 96 dpi) ou paysage (1123 px) selon le document
  const land = !!holder.querySelector('.doc[data-land="1"]');
  const W = land ? 1123 : 794; const PW = land ? 297 : 210; const PH = land ? 210 : 297;
  holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${W}px;background:#fff;`;
  holder.querySelectorAll('.no-print').forEach((x) => x.remove());
  // modèle Madibu : la règle de chantier et le pied de page légal sont redessinés sur chaque page du PDF
  holder.querySelectorAll('.mb-foot, .mb-ruler').forEach((x) => x.remove());
  holder.querySelectorAll('.mb-sheet').forEach((x) => { x.style.minHeight = '0'; x.style.boxShadow = 'none'; x.style.margin = '0'; x.style.borderRadius = '0'; x.style.paddingBottom = '10px'; });
  const docEl = holder.querySelector('.doc') || holder;
  const brand = docEl.dataset && docEl.dataset.ink ? { ink: docEl.dataset.ink, acc: docEl.dataset.acc, foot: docEl.dataset.foot || '' } : null;
  docEl.style.cssText += ';max-width:none;width:' + W + 'px;margin:0;box-shadow:none;border-radius:0;zoom:1;';
  document.body.appendChild(holder);
  try {
    await Promise.all([...holder.querySelectorAll('img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // points de coupure possibles : bas de chaque ligne / bloc (évite de couper une ligne ou le bloc des totaux en deux)
    // mesurés dans la copie rendue par html2canvas (même largeur, mêmes règles CSS que le PDF)
    const ATOM = '.mb-bottom, .mb-recap, .mb-mention, .mb-sign, .mb-legal h4, .d-tot, .d-sign';
    const cuts = []; const forced = [];
    const measure = (root) => {
      const top = root.getBoundingClientRect().top;
      root.querySelectorAll('.pdf-break').forEach((el) => forced.push(el.getBoundingClientRect().top - top));
      root.querySelectorAll('tr, .mb-head, .mb-parties, .mb-object, .d-pt, .d-sec, .d-head, .d-parties, p, h2, .pre, img, ' + ATOM).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (el.matches(ATOM)) cuts.push(r.top - top, r.bottom - top);
        else if (!el.parentElement || !el.parentElement.closest(ATOM)) cuts.push(r.bottom - top);
      });
      cuts.sort((a, b) => a - b);
    };
    docEl.setAttribute('data-pdf-root', '1');
    // léger (e-mail, export comptable) : environ deux fois plus petit, toujours bien lisible
    const scale = opt.scale || (opt.light ? 1.3 : 1.6);
    // html2canvas ne connaît pas les couleurs « color(srgb …) » produites par color-mix() : conversion en rgba
    const toRgb = (v) => v.replace(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/g, (m0, r, g, bl, a) => `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)}, ${a ?? 1})`);
    const onclone = (cdoc) => {
      const win = cdoc.defaultView;
      cdoc.querySelectorAll('*').forEach((el) => {
        const cs = win.getComputedStyle(el);
        for (const prop of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color']) {
          const v = cs.getPropertyValue(prop);
          if (v && v.includes('color(')) el.style.setProperty(prop, toRgb(v));
        }
        const bg = cs.getPropertyValue('background-image');
        if (bg && bg.includes('color(')) el.style.setProperty('background-image', toRgb(bg));
      });
      const root = cdoc.querySelector('[data-pdf-root]');
      if (root) measure(root);
    };
    const canvas = await window.html2canvas(docEl, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: W + 40, onclone });
    const { jsPDF } = window.jspdf;
    // opt.into : document jsPDF existant (plusieurs documents dans un seul PDF) – on y ajoute les pages
    const pdf = opt.into || new jsPDF({ unit: 'mm', format: 'a4', orientation: land ? 'landscape' : 'portrait', compress: true });
    const first = opt.into ? !opt.into.bpUsed : true; if (opt.into) opt.into.bpUsed = true;
    const m = 8; const pw = PW - 2 * m; const ph = PH - 2 * m - (brand ? 12 : 6);
    if (!cuts.length) measure(docEl);
    const k = canvas.width / docEl.offsetWidth; // px canvas par px CSS
    const pageH = ph * (canvas.width / pw);
    const breaks = []; let y = 0;
    while (y < canvas.height - 2) {
      let next = y + pageH;
      const f = forced.map((v) => v * k).find((v) => v > y + 2 && v < Math.min(next, canvas.height));
      if (f != null) { breaks.push([y, f]); y = f; continue; }
      if (next < canvas.height) { const c = cuts.map((v) => v * k).filter((v) => v > y + pageH * 0.5 && v <= next); if (c.length) next = c[c.length - 1]; } else next = canvas.height;
      breaks.push([y, next]); y = next;
    }
    breaks.forEach(([a, b], i) => {
      const part = document.createElement('canvas'); part.width = canvas.width; part.height = Math.ceil(b - a);
      const ctx = part.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height); ctx.drawImage(canvas, 0, -a);
      if (i || !first) pdf.addPage('a4', land ? 'landscape' : 'portrait');
      const top = brand ? m + 4 : m;
      pdf.addImage(part.toDataURL('image/jpeg', opt.q || (opt.light ? 0.7 : 0.8)), 'JPEG', m, top, pw, (b - a) * pw / canvas.width);
      if (brand) {
        // règle de chantier : bande, graduations tous les 2 mm (1 cm plus longues), segment d'accent
        pdf.setFillColor(brand.ink); pdf.rect(0, 0, PW, 3.2, 'F');
        pdf.setFillColor(brand.acc); pdf.rect(PW - 12 - 30, 0, 30, 3.2, 'F');
        pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.15);
        for (let x = 2; x < PW; x += 2) pdf.line(x, 0, x, x % 10 === 0 ? 2.1 : 1.1);
        pdf.setDrawColor(228, 230, 238); pdf.setLineWidth(0.25); pdf.line(m + 4, PH - 10.5, PW - m - 4, PH - 10.5);
        pdf.setFontSize(7); pdf.setTextColor(107, 112, 128);
        const foot = pdf.splitTextToSize(brand.foot, pw - 30)[0] || '';
        pdf.text(foot, m + 4, PH - 6.5);
        pdf.setTextColor(brand.ink); pdf.text(`${i + 1} / ${breaks.length}`, PW - m - 4, PH - 6.5, { align: 'right' });
      } else { pdf.setFontSize(8); pdf.setTextColor(120); pdf.text(`Page ${i + 1}/${breaks.length}`, PW - m, PH - 5, { align: 'right' }); }
    });
    return opt.into ? pdf : pdf.output('blob');
  } finally { holder.remove(); const t = $('#toast'); if (t) t.classList.remove('show'); }
}
// ---------------------------------------------------------------- ZIP (sans compression) : plusieurs PDF en un seul téléchargement
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// files : [{ name: 'dossier/fichier.pdf', data: Uint8Array }] ; noms en UTF-8, doublons renommés
function makeZip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0; const seen = new Set();
  const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    let nm = f.name; for (let k = 2; seen.has(nm); k++) nm = f.name.replace(/(\.[^./]+)?$/, ` (${k})$1`); seen.add(nm);
    const name = enc.encode(nm); const data = f.data; const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const size = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const csvBytes = (rows) => new TextEncoder().encode('\ufeff' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'));
async function sharePdf(title, fname) {
  // partagé par e-mail / WhatsApp : version légère (environ deux fois plus petite)
  const blob = await makePdf(undefined, { light: true });
  const name = (fname || fileTitle(title)) + '.pdf';
  const file = new File([blob], name, { type: 'application/pdf' });
  // ordinateur : le partage système (Chrome / Mac) n'ouvre souvent rien → fenêtre Ouvrir / Télécharger
  const desktop = window.matchMedia('(pointer: fine)').matches && !('ontouchstart' in window);
  const canShare = !desktop && navigator.canShare && navigator.canShare({ files: [file] });
  if (canShare) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  // le geste de l'utilisateur a expiré pendant la génération (iPhone) : nouvelle fenêtre avec boutons
  const url = URL.createObjectURL(blob);
  const m = modal(`${mhead('PDF prêt')}<div class="m-body"><p class="muted">${esc(name)} · ${Math.round(blob.size / 1024)} Ko</p>
    <div class="pdf-acts">${canShare ? `<button class="btn primary" data-act="share">${I.file} Partager / Enregistrer</button>` : ''}
    <a class="btn ${canShare ? '' : 'primary'}" href="${url}" target="_blank" rel="noopener">Ouvrir le PDF</a>
    <a class="btn" href="${url}" download="${esc(name)}">Télécharger</a></div></div>`);
  const sh = $('[data-act=share]', m.el);
  if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file], title }); m.close(); } catch (e) { if (e.name !== 'AbortError') toast('Partage impossible : ' + e.message, 4000); } };
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
}

// ---------------------------------------------------------------- N° de TVA : vérification VIES et remplissage automatique
// map : { name: 'company', street: 'address', zip: 'zip', city: 'city', country: 'country' } (champs du formulaire à remplir)
// opts.address : champ unique (textarea) qui reçoit « rue \n cp ville » ; opts.countryCode : le champ pays contient un code (BE)
function vatAutofill(form, map = {}, opts = {}) {
  const E = (n) => (form.elements ? form.elements[n] : form.querySelector(`[name="${n}"]`));
  const inp = E(opts.field || 'vat'); if (!inp) return;
  const host = inp.closest('label, .field') || inp.parentElement;
  let box = $('.vat-res', host); if (!box) { box = document.createElement('div'); box.className = 'vat-res'; host.appendChild(box); }
  let last = '';
  const ccOf = () => { const c = map.country && E(map.country) ? E(map.country).value : ''; return /^[A-Z]{2}$/.test(c) ? c : countryCode(c || 'Belgique', 'BE'); };
  const values = (r) => {
    const out = {};
    if (map.name) out[map.name] = r.name;
    if (opts.address) out[opts.address] = [r.street, [r.zip, r.city].filter(Boolean).join(' ')].filter(Boolean).join('\n');
    if (map.street) out[map.street] = r.street;
    if (map.zip) out[map.zip] = r.zip;
    if (map.city) out[map.city] = r.city;
    if (map.country && E(map.country)) out[map.country] = opts.countryCode ? r.cc : r.country;
    if (map.phone && r.phone) out[map.phone] = r.phone;
    if (map.email && r.email) out[map.email] = r.email;
    if (map.website && r.website) out[map.website] = r.website;
    return Object.fromEntries(Object.entries(out).filter(([k, v]) => v && E(k)));
  };
  const put = (vals, force) => { let n = 0; for (const [k, v] of Object.entries(vals)) { const el = E(k); if (force || !el.value.trim() || (el.tagName === 'SELECT')) { if (el.value !== v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); n++; } } } return n; };
  const check = async (force) => {
    const v = inp.value.replace(/[\s.\-]/g, '').toUpperCase();
    if (v.replace(/^[A-Z]{2}/, '').length < 8) { box.innerHTML = ''; return; }
    if (v === last && !force) return; last = v;
    box.innerHTML = '<span class="muted">Vérification du n° de TVA (VIES)…</span>';
    try {
      const r = await api('GET', `vat/lookup&vat=${encodeURIComponent(v)}&cc=${ccOf()}`);
      form.dataset.vatcheck = JSON.stringify({ valid: r.valid, vat: r.vat, name: r.name || '', date: today() });
      if (r.test) { box.innerHTML = '<div class="vat-ok">✓ N° de TVA de test (exception : pas de vérification VIES / BCE). Complétez le nom et l\'adresse à la main.</div>'; return; }
      if (!r.valid && !r.kbo) { box.innerHTML = `<div class="vat-bad">✗ ${esc(r.error || 'Ce numéro n\'est pas actif à la TVA (VIES)')} </div>`; return; }
      if (opts.normalize !== false && inp.value !== r.vat) inp.value = r.vat;
      const vals = values(r);
      const filled = put(vals, false);
      const differ = Object.entries(vals).some(([k, x]) => E(k).value !== x);
      const k = r.kbo;
      const head = r.valid ? '✓ TVA active' : r.enterprise ? '✓ Entreprise active à la BCE – pas assujettie à la TVA' : k && k.active ? '⚠ Entreprise active (BCE) mais n° non actif à la TVA' : '✗ Entreprise non active';
      box.innerHTML = `<div class="${r.valid || r.enterprise ? 'vat-ok' : 'vat-bad'}">${head}${r.enterprise ? '<br><small>Ex. syndicat, assurance, ASBL : le numéro d\'entreprise est valable, mais facturez avec TVA (pas d\'autoliquidation).</small>' : ''}${r.name ? ` – <b>${esc(r.name)}</b>` : ''}${r.street ? `<br><small>${esc([r.street, [r.zip, r.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</small>` : ''}
        ${k ? `<br><small>${esc([k.status && `Statut : ${k.status}`, k.legalForm, k.start && `depuis le ${k.start}`].filter(Boolean).join(' · '))}</small>` : ''}
        <small class="muted"> · vérifié ${r.note ? esc(r.note) : k ? 'VIES + BCE' : 'VIES'} le ${fmtDate(today())}${filled ? ` · ${filled} champ(s) rempli(s)` : ''}</small>${differ ? ' <button type="button" class="link-btn" data-vatfill>Remplacer par ces données</button>' : ''}</div>`;
      const b = $('[data-vatfill]', box); if (b) b.onclick = () => { put(vals, true); b.remove(); };
    } catch (e) { last = ''; box.innerHTML = `<div class="vat-bad">${/invalide/i.test(e.message) ? '✗ ' : 'Vérification impossible : '}${esc(e.message)} <button type="button" class="link-btn" data-vatretry>Réessayer</button></div>`; const b = $('[data-vatretry]', box); if (b) b.onclick = () => check(true); }
  };
  inp.addEventListener('change', () => check(false));
  inp.addEventListener('blur', () => check(false));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(true); } });
  if (opts.now && inp.value.trim()) check(false);
  return { check };
}

// Téléphone : un devis / une facture s'affiche comme un PDF (feuille A4 entière, réduite à la largeur de l'écran ; zoom avec deux doigts)
function fitDocs() {
  $$('.doc.mb-paper').forEach((d) => {
    const host = d.parentElement; if (!host) return;
    const cs = getComputedStyle(host);
    const w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const dw = d.classList.contains('mb-land') ? 1123 : 794;
    const z = Math.min(1, w / dw);
    d.style.width = `${dw}px`; d.style.maxWidth = 'none';
    d.style.zoom = z < 0.999 ? String(Math.floor(z * 1000) / 1000) : '';
  });
  // autres documents imprimables (PV, résumé de chantier, journal, bon de commande…) : réduits s'ils dépassent l'écran
  $$('.print-shell .doc:not(.mb-paper)').forEach((d) => {
    const host = d.parentElement; if (!host) return;
    d.style.zoom = '';
    const cs = getComputedStyle(host);
    const w = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const sw = d.scrollWidth;
    if (sw > w + 2) d.style.zoom = String(Math.floor((w / sw) * 1000) / 1000);
  });
}
(() => {
  let raf = 0; const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fitDocs); };
  window.addEventListener('resize', run);
  new MutationObserver((ms) => { if (ms.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('.doc') || n.querySelector('.doc'))))) run(); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
