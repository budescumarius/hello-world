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
const IKIND = { facture: 'Facture', acompte: "Facture d'acompte", situation: "Facture d'avancement", finale: 'Facture de solde', avoir: 'Note de crédit' };
const TYPES = { mo: "Main d'œuvre", mat: 'Matériaux', materiel: 'Matériel', st: 'Sous-traitance', divers: 'Divers' };
const TYPE_COLORS = { mo: '#f08c00', mat: '#3b5bdb', materiel: '#7048e8', st: '#0c8599', divers: '#868e96', ouvrage: '#2f9e44' };
const PST = { prospect: ['Avant-projet', '#868e96'], preparation: ['En préparation', '#4dabf7'], encours: ['En cours', '#f08c00'], reception: ['Réception', '#7048e8'], termine: ['Terminé', '#2f9e44'], annule: ['Annulé', '#adb5bd'] };
const OST = { brouillon: ['Brouillon', '#868e96'], envoyee: ['Envoyée', '#3b5bdb'], confirmee: ['Confirmée', '#7048e8'], livree: ['Livrée', '#2f9e44'], facturee: ['Facturée', '#0c8599'], annulee: ['Annulée', '#adb5bd'] };
const INTST = { aplanifier: ['À planifier', '#868e96'], planifiee: ['Planifiée', '#3b5bdb'], encours: ['En cours', '#f08c00'], terminee: ['Terminée', '#2f9e44'], facturee: ['Facturée', '#0c8599'], annulee: ['Annulée', '#adb5bd'] };
const INTKIND = { depannage: 'Dépannage', entretien: 'Entretien', installation: 'Installation', sav: 'SAV', visite: 'Visite technique', autre: 'Autre' };
const TST = { todo: ['À faire', '#868e96'], doing: ['En cours', '#f08c00'], done: ['Terminée', '#2f9e44'] };
const PRIO = { low: ['Basse', '#868e96'], normal: ['Normale', '#3b5bdb'], high: ['Haute', '#f08c00'], urgent: ['Urgente', '#e5484d'] };
const UNITS = ['u', 'pc', 'm', 'm²', 'm³', 'ml', 'kg', 't', 'l', 'h', 'j', 'ens', 'forfait'];
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
  const d = num(doc.discount) / 100;
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
  // la remise est calculée par taux de TVA (règles EN 16931 / Peppol : total = somme des remises par taux)
  const vats = Object.keys(by).map(Number).sort((a, b) => b - a)
    .map((rate) => { const lines = r2(by[rate]); const allowance = r2(lines * d); const b = r2(lines - allowance); return { rate, lines, allowance, base: b, vat: doc.reverse ? 0 : r2(b * rate / 100) }; }).filter((v) => v.lines);
  const discount = r2(vats.reduce((s, v) => s + v.allowance, 0));
  const base = r2(net - discount);
  const vat = r2(vats.reduce((s, v) => s + v.vat, 0));
  return { net, discount, base, vats, vat, total: r2(base + vat), cost: r2(cost), costBy, margin: r2(base - cost) };
}
// Numérotation à 3 niveaux : chapitre 1.0.0, sous-chapitre 1.1.0, ligne 1.1.1 (ou 1.0.1 sans sous-chapitre)
const tlevel = (l) => (l.kind === 'title' ? (+l.level === 2 ? 2 : 1) : 3);
function numbering(lines) {
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
// Prix d'un article de bibliothèque ; un ouvrage additionne ses composants
function articleCost(a, all, depth = 0) {
  const d = a.data;
  if (d.kind !== 'ouvrage' || depth > 4) return { cost: num(d.cost), costBy: { [d.kind === 'ouvrage' ? 'divers' : d.kind || 'divers']: num(d.cost) } };
  const costBy = {}; let cost = 0;
  for (const c of d.components || []) {
    const sub = all.find((x) => x.id === +c.articleId);
    if (!sub) continue;
    const r = articleCost(sub, all, depth + 1);
    const q = num(c.qty);
    cost += r.cost * q;
    for (const [k, v] of Object.entries(r.costBy)) costBy[k] = (costBy[k] || 0) + v * q;
  }
  for (const k of Object.keys(costBy)) costBy[k] = r2(costBy[k] * 1e4) / 1e4;
  return { cost: r2(cost * 1e4) / 1e4, costBy };
}
function articlePrice(a, all) {
  const d = a.data;
  if (d.priceMode === 'fixed' && num(d.price)) return num(d.price);
  return r2(articleCost(a, all).cost * (1 + num(d.margin) / 100));
}
function lineFromArticle(a, all) {
  const c = articleCost(a, all);
  const isO = a.data.kind === 'ouvrage';
  return { id: lid(), kind: 'item', articleId: a.id, desc: a.data.name + (a.data.desc ? '\n' + a.data.desc : ''), unit: a.data.unit || 'u', qty: 1,
    cost: c.cost, price: articlePrice(a, all), vat: a.data.vat === '' || a.data.vat == null ? defVat() : num(a.data.vat), type: isO ? 'ouvrage' : a.data.kind, ...(isO ? { costBy: c.costBy } : {}), supplierId: a.data.supplierId || null };
}

// ---------------------------------------------------------------- Éditeur de lignes (tableau éditable)
// doc : objet data (devis, facture, commande) ; opts : { showCost, onChange, readOnly, library, contacts }
function linesEditor(el, doc, opts) {
  doc.lines = doc.lines || [];
  const showCost = opts.showCost && ui.showCost !== false;
  const draw = () => {
    const nos = numbering(doc.lines);
    const st = sectionTotals(doc.lines);
    el.innerHTML = `<div class="lines-wrap"><table class="lines ${showCost ? 'with-cost' : ''}">
      <thead><tr><th class="c-no">N°</th><th>Désignation</th><th class="c-u">Unité</th><th class="c-n">Qté</th>
        ${showCost ? '<th class="c-n">Déboursé u.</th><th class="c-n">Marge %</th>' : ''}<th class="c-n">PU HT</th><th class="c-v">TVA</th><th class="c-n">Total HT</th><th class="c-a"></th></tr></thead>
      <tbody>${doc.lines.map((l, i) => {
        if (l.kind === 'title') return `<tr class="l-title ${tlevel(l) === 2 ? 'lv2' : ''}" data-i="${i}"><td class="c-no">${nos[i]}</td><td colspan="${showCost ? 7 : 5}"><input class="in" data-k="desc" value="${esc(l.desc)}" placeholder="${tlevel(l) === 2 ? 'Titre du sous-chapitre' : 'Titre du chapitre'}" ${opts.readOnly ? 'readonly' : ''}></td><td class="c-n"><b data-sec="${l.id}">${money(st[l.id])}</b></td><td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
        if (l.kind === 'text') return `<tr class="l-text" data-i="${i}"><td></td><td colspan="${showCost ? 8 : 6}"><textarea class="in" data-k="desc" rows="1" placeholder="Texte libre / commentaire" ${opts.readOnly ? 'readonly' : ''}>${esc(l.desc)}</textarea></td><td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
        const m = num(l.cost) > 0 ? r2((num(l.price) / num(l.cost) - 1) * 100) : '';
        return `<tr class="l-item ${l.option ? 'opt' : ''}" data-i="${i}"><td class="c-no">${nos[i]}${l.type ? `<i class="tdot" style="--c:${TYPE_COLORS[l.type] || '#999'}" title="${esc(TYPES[l.type] || 'Ouvrage')}"></i>` : ''}</td>
          <td><textarea class="in" data-k="desc" rows="1" placeholder="Désignation" ${opts.readOnly ? 'readonly' : ''}>${esc(l.desc)}</textarea>${l.option ? '<small class="muted">En option – non compris dans le total</small>' : ''}</td>
          <td class="c-u"><input class="in" data-k="unit" value="${esc(l.unit)}" list="units" ${opts.readOnly ? 'readonly' : ''}></td>
          <td class="c-n"><input class="in r" data-k="qty" inputmode="decimal" value="${esc(l.qty)}" ${opts.readOnly ? 'readonly' : ''}></td>
          ${showCost ? `<td class="c-n"><input class="in r" data-k="cost" inputmode="decimal" value="${esc(l.cost ?? '')}" ${opts.readOnly || l.costBy ? 'readonly' : ''} title="${l.costBy ? 'Ouvrage : ' + Object.entries(l.costBy).map(([k, v]) => `${TYPES[k] || k} ${money(v)}`).join(', ') : ''}"></td>
            <td class="c-n"><input class="in r" data-k="margin" inputmode="decimal" value="${esc(m)}" ${opts.readOnly ? 'readonly' : ''}></td>` : ''}
          <td class="c-n"><input class="in r" data-k="price" inputmode="decimal" value="${esc(l.price)}" ${opts.readOnly ? 'readonly' : ''}></td>
          <td class="c-v"><select class="in" data-k="vat" ${opts.readOnly ? 'disabled' : ''}>${vatOptions(l.vat).map(([v, t]) => `<option value="${v}" ${num(v) === num(l.vat) ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
          <td class="c-n tot">${money(num(l.qty) * num(l.price))}</td>
          <td class="c-a">${opts.readOnly ? '' : `<button class="icon-btn sm" data-menu="${i}">${I.more}</button>`}</td></tr>`;
      }).join('') || `<tr><td colspan="${showCost ? 10 : 8}" class="empty">Aucune ligne. Ajoutez un chapitre, une ligne ou des éléments de la bibliothèque.</td></tr>`}</tbody></table></div>
      <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      ${opts.readOnly ? '' : `<div class="btns lines-add"><button class="btn" data-add="title">${I.plus} Chapitre</button><button class="btn" data-add="sub">${I.plus} Sous-chapitre</button><button class="btn" data-add="item">${I.plus} Ligne</button><button class="btn" data-add="text">${I.plus} Texte</button>
        ${opts.library !== false ? `<button class="btn primary" data-add="lib">${I.book} Depuis la bibliothèque</button>` : ''}<button class="btn" data-add="xls">${I.file} Importer Excel</button>
        ${opts.showCost ? `<label class="chk small"><input type="checkbox" data-showcost ${showCost ? 'checked' : ''}>Afficher déboursés et marges</label>` : ''}</div>`}`;
    bind();
  };
  const changed = () => opts.onChange && opts.onChange();
  const autoGrow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  function bind() {
    $$('textarea.in', el).forEach(autoGrow);
    $$('tr[data-i]', el).forEach((tr) => {
      const l = doc.lines[+tr.dataset.i];
      $$('[data-k]', tr).forEach((inp) => {
        inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          const k = inp.dataset.k;
          if (inp.tagName === 'TEXTAREA') autoGrow(inp);
          if (k === 'desc' || k === 'unit') l[k] = inp.value;
          else if (k === 'vat') l.vat = num(inp.value);
          else if (k === 'margin') { if (num(l.cost) > 0) { l.price = r2(num(l.cost) * (1 + num(inp.value) / 100)); $('[data-k=price]', tr).value = l.price; } }
          else {
            l[k] = inp.value.trim() === '' ? '' : num(inp.value);
            const mi = $('[data-k=margin]', tr);
            if (k === 'cost' && mi && mi.value !== '' && num(l.cost) > 0) { l.price = r2(num(l.cost) * (1 + num(mi.value) / 100)); $('[data-k=price]', tr).value = l.price; }
            else if (mi && num(l.cost) > 0) mi.value = r2((num(l.price) / num(l.cost) - 1) * 100);
          }
          const tot = $('.tot', tr); if (tot) tot.textContent = money(num(l.qty) * num(l.price));
          const secs = sectionTotals(doc.lines);
          $$('[data-sec]', el).forEach((x) => { x.textContent = money(secs[x.dataset.sec]); });
          changed();
        });
        if (inp.dataset.k !== 'desc') inp.addEventListener('blur', () => { if (inp.dataset.k !== 'unit') drawSoon(); });
      });
    });
    $$('[data-menu]', el).forEach((b) => { b.onclick = () => lineMenu(+b.dataset.menu); });
    $$('[data-add]', el).forEach((b) => { b.onclick = () => add(b.dataset.add); });
    const sc = $('[data-showcost]', el); if (sc) sc.onchange = () => { ui.showCost = sc.checked; saveUi(); linesEditor(el, doc, opts); };
  }
  let drawT;
  const drawSoon = () => { clearTimeout(drawT); drawT = setTimeout(() => { if (!el.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') { draw(); changed(); } }, 150); };
  const newItem = () => ({ id: lid(), kind: 'item', desc: '', unit: 'u', qty: 1, cost: '', price: 0, vat: defVat(), type: 'divers' });
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
  function lineMenu(i) {
    const l = doc.lines[i];
    menuSheet(l.kind === 'title' ? (tlevel(l) === 2 ? 'Sous-chapitre' : 'Chapitre') : 'Ligne', [
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
function printPage(title, html, back) {
  app.innerHTML = `<div class="print-shell"><header class="top no-print"><a class="icon-btn" href="${back}" aria-label="Retour">${I.back}</a><div class="top-title"><h1>${esc(title)}</h1></div>
    <div class="top-actions"><button class="btn primary" data-act="print">${I.print} Imprimer / PDF</button></div></header><div class="print-page">${html}</div></div>`;
  $('[data-act=print]').onclick = () => { const old = document.title; document.title = title.replace(/[^\w\- ]+/g, '').trim(); window.print(); setTimeout(() => { document.title = old; }, 800); };
}
