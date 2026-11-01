'use strict';
/* PILOTAGE MADIBU – étape 2 : extraits bancaires importés à la main (Europabank en CODA, Belfius et BNP Paribas Fortis en PDF).
   Aucune connexion à une banque, aucun paiement possible depuis ce module. Réservé aux administrateurs, activé par firme.
   Les montants arrivent du serveur en CENTIMES entiers. */

const pilOn = () => isAdmin() && !!(S.settings.pilotage && S.settings.pilotage.enabled);
SPACES.push({ k: 'pilot', l: 'Pilotage', i: 'chart', h: '#/pilotage/directeur', show: pilOn,
  sec: [['Directeur', '#/pilotage/directeur'], ['Assistant', '#/pilotage/assistant'], ['Chantiers', '#/pilotage/chantiers'], ['Trésorerie', '#/pilotage/tresorerie'], ['Engagements', '#/pilotage/engagements'], ['Factures et échéances', '#/pilotage/echeances'], ['Contrôle bancaire', '#/pilotage'], ['Mouvements', '#/pilotage/mouvements'], ['Historique 24 mois', '#/pilotage/historique'], ['Importer un extrait', '#/pilotage/import'], ['Journal des imports', '#/pilotage/imports'], ['Comptes', '#/pilotage/comptes']] });

const pilMoney = (c) => (c == null ? '—' : money(c / 100));
const PIL_ST = { a_verifier: ['À vérifier', '#f08c00'], valide: ['Validé', '#2f9e44'] };
let pilCatsP = null;
const pilCats = () => (pilCatsP = pilCatsP || api('GET', 'pilot/dashboard').then((d) => d.categories).catch((e) => { pilCatsP = null; throw e; }));
const pilCatLabel = (cats, k) => (cats[k] ? cats[k][0] : k);
const pilCatColor = (cats, k) => (k === 'a_classer' ? '#e5484d' : !cats[k] ? '#868e96' : cats[k][1] === 'in' ? '#2f9e44' : cats[k][1] === 'int' ? '#7048e8' : '#3b5bdb');
const pilAccName = (a) => (a ? `${a.bank}${a.label ? ' – ' + a.label : ''}` : '—');

// ---------------------------------------------------------------- Lecture d'un PDF dans le navigateur (pdf.js de BatiPro)
// Mise en page : lignes (même hauteur ± 2) et morceaux de texte avec leur abscisse. Le serveur lit ensuite les colonnes.
async function pilPdfLayout(bytes) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i); const tc = await pg.getTextContent(); const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      let r = rows.find((q) => Math.abs(q.y - y) <= 2);
      if (!r) rows.push(r = { y, p: [] });
      r.p.push([Math.round(it.transform[4] * 10) / 10, it.str]);
    }
    rows.sort((a, c) => c.y - a.y).forEach((r) => r.p.sort((a, c) => a[0] - c[0]));
    pages.push({ w: Math.round(pg.view[2]), rows });
  }
  return pages;
}
function pilB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
async function pilReadFile(f) {
  const buf = await f.arrayBuffer();
  const isPdf = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(5, buf.byteLength))) === '%PDF-';
  return { name: f.name, content: pilB64(buf), layout: isPdf ? await pilPdfLayout(new Uint8Array(buf)) : null };
}

// ---------------------------------------------------------------- Pages
route('pilotage', async (sub, arg) => {
  if (!isAdmin()) { layout({ icon: 'chart', title: 'Pilotage' }).innerHTML = empty('Réservé aux administrateurs', 'Le pilotage financier est accessible aux administrateurs de l\'entreprise.'); return; }
  if (!pilOn()) return pilEnablePage();
  const pages = { directeur: pilDirectorPage, assistant: pilAssistantPage, chantiers: pilProjectsPage, tresorerie: pilTreasuryPage, engagements: pilCommitmentsPage, echeances: pilDuePage, mouvements: pilTxPage, historique: pilHistPage, import: pilImportPage, imports: pilImportsPage, comptes: pilAccountsPage };
  return (pages[sub] || pilDashPage)(arg);
});

function pilEnablePage() {
  const page = layout({ icon: 'chart', title: 'Pilotage' });
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Module Pilotage (contrôle de trésorerie)</h3></div>
    <p>Import manuel des extraits bancaires (CODA, PDF Belfius et BNP Paribas Fortis), contrôle des soldes, doublons, transferts internes, classement et rapprochement avec les factures et achats de BâtiPro.</p>
    <ul class="muted"><li>Aucune connexion à une banque, aucun paiement ne peut partir d'ici.</li><li>Réservé aux administrateurs de cette entreprise.</li><li>Les extraits originaux sont gardés dans un dossier fermé du serveur.</li></ul>
    <div class="btns"><button class="btn primary" data-on>Activer le module pour cette entreprise</button></div></div>`;
  $('[data-on]', page).onclick = async () => {
    await api('POST', 'pilot/enable', { enabled: true });
    S.settings.pilotage = { enabled: true }; toast('Module Pilotage activé'); render();
  };
}

// ---------- Contrôle
async function pilDashPage() {
  const [d, mo] = await Promise.all([api('GET', 'pilot/dashboard'), api('GET', 'pilot/monthly&months=24')]);
  const page = layout({ icon: 'chart', title: 'Contrôle bancaire', sub: 'Extraits importés, soldes et points à vérifier', actions: '<a class="btn primary" href="#/pilotage/import">Importer un extrait</a>' });
  if (!d.accounts.length) { page.innerHTML = empty('Aucun compte bancaire', 'Ajoutez d\'abord vos comptes (Europabank, Belfius, BNP Paribas Fortis).', '<a class="btn primary" href="#/pilotage/comptes">Ajouter un compte</a>'); return; }
  const known = d.accounts.filter((a) => a.balance != null);
  const total = known.reduce((s, a) => s + a.balance, 0);
  const toCheck = d.accounts.reduce((s, a) => s + a.to_check, 0);
  const breaks = d.accounts.reduce((s, a) => s + a.breaks.length, 0);
  const bad = d.accounts.filter((a) => a.balance != null && a.computed !== a.balance).length;
  page.innerHTML = `<div class="kpis">${kpi('Solde total (derniers extraits)', pilMoney(total), { sub: known.length < d.accounts.length ? `${d.accounts.length - known.length} compte(s) sans extrait` : `${known.length} comptes` })}
      ${kpi('Mouvements à vérifier', String(toCheck), { cls: toCheck ? 'late' : 'good', href: '#/pilotage/mouvements' })}${kpi('Non classés', String(d.unclassified), { cls: d.unclassified ? 'late' : 'good', href: '#/pilotage/mouvements' })}
      ${kpi('Ruptures de solde', String(breaks + bad), { cls: breaks + bad ? 'late' : 'good', sub: breaks + bad ? 'extrait manquant probable' : 'continuité OK' })}${kpi('Transferts internes non appariés', String(d.unpaired_transfers), { cls: d.unpaired_transfers ? 'late' : '' })}</div>
    <div class="cols-2">${d.accounts.map((a) => {
      const ok = a.balance == null || a.computed === a.balance;
      const cov = (mo.accounts.find((x) => x.id === a.id) || { months: [] }).months;
      return `<div class="card"><div class="card-h"><h3>${esc(pilAccName(a))}</h3><span class="muted">${esc(ibanFmt(a.iban))}</span></div>
        <div class="info">
          <div class="kv"><span>Dernier solde</span><b>${pilMoney(a.balance)}${a.to ? ` <small class="muted">au ${fmtDate(a.to)}</small>` : ''}</b></div>
          <div class="kv"><span>Période importée</span><span>${a.from ? `${fmtDate(a.from)} → ${fmtDate(a.to)} · ${a.imports} extrait(s)` : '<span class="muted">aucun extrait</span>'}</span></div>
          <div class="kv"><span>Contrôle</span><span class="${ok ? 'good' : 'late'}">${a.balance == null ? '—' : ok ? '✓ solde recalculé = solde de la banque' : `✗ solde recalculé ${pilMoney(a.computed)} ≠ ${pilMoney(a.balance)}`}</span></div>
          <div class="kv"><span>À vérifier</span><span>${a.to_check} mouvement(s) · ${a.validated} validé(s)</span></div>
        </div>
        ${a.breaks.map((b) => `<div class="alert">Rupture entre le ${fmtDate(b.after)} (solde ${pilMoney(b.closing)}) et le ${fmtDate(b.before)} (solde ${pilMoney(b.opening)}) : écart ${pilMoney(b.gap)} – un extrait manque.</div>`).join('')}
        <div class="pil-cov" title="Mois couverts par des extraits (24 derniers mois)">${cov.map((m) => `<i class="${m.coverage >= 1 ? 'full' : m.coverage > 0 ? 'part' : ''}" title="${esc(m.m)} : ${Math.round(m.coverage * 100)} %"></i>`).join('')}</div>
        <small class="muted">Couverture des 24 derniers mois : ${cov.filter((m) => m.coverage >= 1).length} complet(s), ${cov.filter((m) => m.coverage > 0 && m.coverage < 1).length} partiel(s)</small></div>`;
    }).join('')}</div>
    <div class="card"><div class="card-h"><h3>Derniers imports</h3><a href="#/pilotage/imports">Journal complet</a></div><div class="rows">${d.recent.map((i) => `<div class="row static"><span class="grow"><b>${esc(i.bank)} ${esc(i.label || '')}</b> · ${esc(i.filename)} <small class="muted">${fmtDate(i.period_from)} → ${fmtDate(i.period_to)}</small></span>${i.status === 'annule' ? badge('Annulé', '#868e96') : `<span class="muted">${i.tx_new} mvt${i.tx_dup ? ` · ${i.tx_dup} doublon(s) ignoré(s)` : ''}</span>`}</div>`).join('') || '<div class="empty">Aucun import</div>'}</div></div>`;
  bindKpis(page);
}

// ---------- Comptes
async function pilAccountsPage() {
  const accs = await api('GET', 'pilot/accounts');
  const page = layout({ icon: 'chart', title: 'Comptes bancaires', actions: '<button class="btn primary" data-add>Ajouter un compte</button>' });
  page.innerHTML = '<div id="tbl"></div><p class="muted">Les extraits sont rattachés au compte par leur IBAN. Un virement vers un de ces comptes est un transfert interne : jamais compté comme recette ni comme dépense.</p>';
  dataTable($('#tbl'), {
    rows: accs, columns: [{ l: 'Banque', v: (a) => esc(a.bank) }, { l: 'Nom', v: (a) => esc(a.label) }, { l: 'IBAN', v: (a) => `<span class="nowrap">${esc(ibanFmt(a.iban))}</span>` }, { l: 'Actif', v: (a) => (a.active ? 'Oui' : 'Non') }],
    onRow: (a) => formModal({ title: 'Compte bancaire', fields: [{ name: 'bank', label: 'Banque' }, { name: 'label', label: 'Nom (ex. Compte courant)' }, { name: 'active', label: 'Compte actif', type: 'check' }], values: a,
      async onSave(v) { await api('PUT', `pilot/accounts/${a.id}`, v); render(); } }),
    empty: 'Aucun compte : ajoutez vos comptes Europabank, Belfius et BNP Paribas Fortis',
  });
  $('[data-add]').onclick = () => formModal({ title: 'Nouveau compte bancaire', fields: [{ name: 'iban', label: 'IBAN', required: true, placeholder: 'BE00 0000 0000 0000' }, { name: 'label', label: 'Nom (ex. Compte courant)' }, { name: 'bank', label: 'Banque', hint: 'Déduite de l\'IBAN si vide' }],
    async onSave(v) { await api('POST', 'pilot/accounts', v); toast('Compte ajouté'); render(); } });
}

// ---------- Import
async function pilImportPage() {
  const accs = await api('GET', 'pilot/accounts');
  const page = layout({ icon: 'chart', title: 'Importer un extrait', sub: 'CODA (.cod) pour Europabank · PDF pour Belfius et BNP Paribas Fortis' });
  page.innerHTML = `<div class="card"><div class="grid-form">
      <label class="field"><span>Compte</span><select data-acc><option value="">Détection automatique (IBAN de l'extrait)</option>${accs.filter((a) => a.active).map((a) => `<option value="${a.id}">${esc(pilAccName(a))} · ${esc(ibanFmt(a.iban))}</option>`).join('')}</select></label>
      <label class="field"><span>Extrait(s)</span><input type="file" data-file multiple accept=".cod,.coda,.txt,.cod2,.pdf,application/pdf"></label></div>
      <p class="muted">Étapes : lecture → contrôle des soldes (solde initial + mouvements = solde final) → recherche des doublons et des périodes manquantes → aperçu → votre confirmation. Rien n'est enregistré avant la confirmation.</p></div>
    <div data-out></div>`;
  if (!accs.length) $('[data-out]', page).innerHTML = `<div class="alert">Aucun compte bancaire. <a href="#/pilotage/comptes">Ajoutez vos comptes</a> avant d'importer.</div>`;
  $('[data-file]', page).onchange = async (e) => {
    const out = $('[data-out]', page); out.innerHTML = '';
    for (const f of e.target.files) {
      const box = document.createElement('div'); box.className = 'card'; box.innerHTML = `<div class="card-h"><h3>${esc(f.name)}</h3></div><p class="muted">Lecture…</p>`; out.appendChild(box);
      try {
        const payload = { ...(await pilReadFile(f)), account: $('[data-acc]', page).value || null };
        const pv = await api('POST', 'pilot/preview', payload);
        pilPreview(box, f.name, pv, payload);
      } catch (err) { box.innerHTML = `<div class="card-h"><h3>${esc(f.name)}</h3></div><div class="alert">${esc(err.message)}</div>`; }
    }
    e.target.value = '';
  };
}

function pilPreview(box, name, pv, payload) {
  const cats = {};
  pilCats().then((c) => Object.assign(cats, c)).catch(() => {}).finally(() => draw());
  const draw = () => {
    box.innerHTML = `<div class="card-h"><h3>${esc(name)}</h3><span class="muted">${esc((pv.format || '').toUpperCase())}</span></div>
      ${pv.errors.length ? `<div class="alert"><b>Import impossible</b><ul>${pv.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${(pv.warnings || []).map((w) => `<div class="alert info">${esc(w)}</div>`).join('')}
      ${pv.statements.map((s) => `
        <div class="info">
          <div class="kv"><span>Compte</span><b>${s.account ? esc(pilAccName(s.account)) : esc(s.bank)} · ${esc(ibanFmt(s.iban))}</b></div>
          <div class="kv"><span>Extrait</span><span>${s.number != null ? `n° ${s.number}${s.year ? ' / ' + s.year : ''} · ` : ''}${fmtDate(s.opening && s.opening.date)} → ${fmtDate(s.closing && s.closing.date)}</span></div>
          <div class="kv"><span>Soldes</span><span>${pilMoney(s.opening && s.opening.amount)} + entrées ${pilMoney(s.credits)} − sorties ${pilMoney(-s.debits)} = <b>${pilMoney(s.closing && s.closing.amount)}</b>
            ${s.balance_gap === 0 ? ' <span class="good">✓ contrôle exact</span>' : s.balance_gap != null ? ` <span class="late">✗ écart ${pilMoney(s.balance_gap)}</span>` : ''}</span></div>
          <div class="kv"><span>Continuité</span><span>${!s.continuity ? '—' : !s.continuity.previous && !s.continuity.next ? '<span class="muted">premier extrait de ce compte</span>' : s.continuity.ok ? '<span class="good">✓ suit l\'extrait précédent</span>' : '<span class="late">✗ rupture (voir ci-dessous)</span>'}</span></div>
          <div class="kv"><span>Mouvements</span><span>${s.transactions.length}${s.duplicates ? ` · <span class="late">${s.duplicates} déjà enregistré(s), ignoré(s)</span>` : ''}</span></div>
        </div>
        ${s.warnings.map((w) => `<div class="alert info">${esc(w)}</div>`).join('')}
        <div class="pil-tx-wrap"><table class="dt"><thead><tr><th>N°</th><th>Date</th><th>Contrepartie</th><th>Communication</th><th>Catégorie proposée</th><th class="r">Montant</th></tr></thead><tbody>
          ${s.transactions.map((t) => `<tr class="${t.duplicate ? 'pil-dup' : ''}"><td>${t.seq ?? ''}</td><td class="nowrap">${fmtDate(t.date)}</td>
            <td>${esc(t.counterparty_name || '')}<br><small class="muted">${esc(ibanFmt(t.counterparty_iban))}</small></td>
            <td><small>${esc(t.structured || (t.communication || '').slice(0, 90))}</small></td>
            <td>${t.duplicate ? badge('Doublon – ignoré', '#868e96') : t.category ? badge(pilCatLabel(cats, t.category), pilCatColor(cats, t.category)) : ''}</td>
            <td class="r nowrap ${t.amount < 0 ? '' : 'good'}"><b>${pilMoney(t.amount)}</b></td></tr>`).join('')}
        </tbody></table></div>`).join('')}
      <div class="btns">${pv.errors.length ? '' : '<button class="btn primary" data-go>Confirmer l\'import</button>'}<span class="muted">Les catégories proposées restent « à vérifier » jusqu'à votre validation.</span></div>`;
    const go = $('[data-go]', box);
    if (go) go.onclick = async () => {
      go.disabled = true; go.textContent = 'Import…';
      try {
        const r = await api('POST', 'pilot/import', payload);
        const n = r.statements.reduce((a, s) => a + s.transactions.filter((t) => !t.duplicate).length, 0);
        box.innerHTML = `<div class="card-h"><h3>${esc(name)}</h3></div><div class="alert ok">✓ Import enregistré : ${n} mouvement(s). <a href="#/pilotage/mouvements">Vérifier les mouvements</a></div>`;
        pilCatsP = null;
      } catch (err) { go.disabled = false; go.textContent = 'Confirmer l\'import'; toast('Erreur : ' + err.message, 5000); }
    };
  };
}

// ---------- Journal des imports
async function pilImportsPage() {
  const [imps, accs] = await Promise.all([api('GET', 'pilot/imports'), api('GET', 'pilot/accounts')]);
  const acc = (id) => accs.find((a) => a.id === id);
  const page = layout({ icon: 'chart', title: 'Journal des imports' });
  page.innerHTML = '<div id="tbl"></div>';
  dataTable($('#tbl'), {
    rows: imps, state: { sort: -1 }, search: (i) => [i.filename, pilAccName(acc(i.account_id))].join(' '),
    columns: [{ l: 'Importé le', v: (i) => fmtDT(i.created_at), sort: (i) => i.created_at }, { l: 'Par', v: (i) => esc(userName(i.created_by)) }, { l: 'Compte', v: (i) => esc(pilAccName(acc(i.account_id))) },
      { l: 'Fichier', v: (i) => `${esc(i.filename)} <small class="muted">${esc(i.format.toUpperCase())}${i.statement_no != null ? ` · n° ${i.statement_no}` : ''}</small>` },
      { l: 'Période', v: (i) => `<span class="nowrap">${fmtDate(i.period_from)} → ${fmtDate(i.period_to)}</span>`, sort: (i) => i.period_from },
      { l: 'Solde initial', cls: 'r', v: (i) => pilMoney(i.opening) }, { l: 'Solde final', cls: 'r', v: (i) => pilMoney(i.closing) },
      { l: 'Mouvements', cls: 'r', v: (i) => `${i.tx_new}${i.tx_dup ? ` <small class="muted">(+${i.tx_dup} doublons)</small>` : ''}` },
      { l: 'Statut', v: (i) => (i.status === 'annule' ? badge('Annulé', '#868e96') + `<br><small class="muted">${fmtDT(i.cancelled_at)}</small>` : (i.warnings || []).length ? badge('Avec remarques', '#f08c00') : badge('Importé', '#2f9e44')) }],
    onRow: (i) => menuSheet(i.filename, [
      ...(i.warnings || []).length ? [{ label: `Remarques : ${i.warnings.join(' · ')}`, run: () => {} }] : [],
      { label: 'Télécharger l\'extrait original', icon: 'download', run: () => { location.href = `api.php?r=pilot/imports/${i.id}/file`; } },
      { label: 'Voir les mouvements', icon: 'eye', run: () => { ui.pilTx = { ...(ui.pilTx || {}), import: i.id }; go('#/pilotage/mouvements'); } },
      ...(i.status === 'importe' ? [{ sep: true }, { label: 'Annuler cet import…', icon: 'trash', danger: true, run: async () => {
        if (!confirm(`Annuler l'import « ${i.filename} » ?\n\nSes ${i.tx_new} mouvement(s) seront retirés (avec leurs classements et rapprochements), ainsi que les paiements qu\'ils ont ajoutés aux factures et achats. Le journal et le fichier original sont conservés.`)) return;
        await api('DELETE', `pilot/imports/${i.id}`); pilCatsP = null; toast('Import annulé'); render();
      } }] : []),
    ]),
    empty: 'Aucun extrait importé',
  });
}

// ---------- Mouvements
async function pilTxPage() {
  const f = ui.pilTx = ui.pilTx || { status: 'a_verifier' };
  const qs = new URLSearchParams(Object.entries({ account: f.account || '', category: f.category || '', import: f.import || '', from: f.month ? f.month + '-01' : '', to: f.month ? f.month + '-31' : '' }).filter(([, v]) => v)).toString();
  const [rows, accs, cats] = await Promise.all([api('GET', 'pilot/tx' + (qs ? '&' + qs : '')), api('GET', 'pilot/accounts'), pilCats()]);
  const acc = (id) => accs.find((a) => a.id === id);
  const page = layout({ icon: 'chart', title: 'Mouvements bancaires' });
  page.innerHTML = `<div class="card"><div class="grid-form">
      <label class="field"><span>Compte</span><select data-k="account"><option value="">Tous les comptes</option>${accs.map((a) => `<option value="${a.id}" ${String(f.account) === String(a.id) ? 'selected' : ''}>${esc(pilAccName(a))}</option>`).join('')}</select></label>
      <label class="field"><span>Catégorie</span><select data-k="category"><option value="">Toutes</option>${Object.entries(cats).map(([k, [l]]) => `<option value="${k}" ${f.category === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field"><span>Mois</span><input type="month" data-k="month" value="${esc(f.month || '')}"></label>
      ${f.import ? `<div class="field"><span>Import</span><button class="btn sm" data-noimp>n° ${f.import} ✕</button></div>` : ''}</div></div><div id="tbl"></div>`;
  $$('[data-k]', page).forEach((el) => { el.onchange = () => { f[el.dataset.k] = el.value; saveUi(); render(); }; });
  const ni = $('[data-noimp]', page); if (ni) ni.onclick = () => { delete f.import; saveUi(); render(); };
  const sumIn = (l) => l.filter((t) => t.category !== 'transfert_interne' && t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const sumOut = (l) => l.filter((t) => t.category !== 'transfert_interne' && t.amount < 0).reduce((a, t) => a + t.amount, 0);
  dataTable($('#tbl'), {
    rows, state: f.tbl = f.tbl || { sort: -1 },
    filters: { def: f.status || '', options: [['a_verifier', 'À vérifier', '#f08c00'], ['valide', 'Validés', '#2f9e44'], ['a_classer', 'Non classés', '#e5484d'], ['', 'Tous']], match: (t, k) => (k === 'a_classer' ? t.category === 'a_classer' : t.status === k) },
    search: (t) => [t.cp_name, t.name_fix, t.cp_iban, t.communication, t.structured, t.note, t.amount / 100].join(' '),
    columns: [
      { l: 'Date', v: (t) => `<span class="nowrap">${fmtDate(t.booking_date)}</span>`, sort: (t) => t.booking_date + String(t.seq).padStart(6, '0') },
      { l: 'Compte', v: (t) => `<small>${esc((acc(t.account_id) || {}).bank || '')}</small>` },
      { l: 'Contrepartie', v: (t) => `${esc(t.name_fix || t.cp_name || '')}${t.transfer_account_id ? `<br><small class="muted">↔ ${esc(pilAccName(acc(t.transfer_account_id)))}</small>` : t.cp_iban ? `<br><small class="muted">${esc(ibanFmt(t.cp_iban))}</small>` : ''}` },
      { l: 'Communication', v: (t) => `<small>${esc(t.structured || (t.communication || '').slice(0, 80))}</small>` },
      { l: 'Catégorie', v: (t) => badge(pilCatLabel(cats, t.category), pilCatColor(cats, t.category)) + (t.match_id ? ' <small class="good" title="Rapproché">✓ rapproché</small>' : ''), sort: (t) => pilCatLabel(cats, t.category) },
      { l: 'Statut', v: (t) => st(PIL_ST, t.status) },
      { l: 'Montant', cls: 'r', v: (t) => `<b class="nowrap ${t.amount > 0 ? 'good' : ''}">${pilMoney(t.amount)}</b>`, sort: (t) => t.amount }],
    footer: (l) => `<tr><td colspan="6">Entrées ${pilMoney(sumIn(l))} · Sorties ${pilMoney(sumOut(l))} <small class="muted">(hors transferts internes)</small></td><td class="r"><b>${pilMoney(l.reduce((a, t) => a + t.amount, 0))}</b></td></tr>`,
    onRow: (t) => pilTxModal(t, cats, accs),
    select: { actions: (picked) => [
      { label: `Valider (${picked.length})`, icon: 'check', primary: true, run: () => pilBulk(picked, { status: 'valide' }) },
      { label: 'Changer la catégorie…', icon: 'edit', run: async () => {
        const v = await ask('Catégorie', [{ name: 'category', label: 'Catégorie', type: 'select', options: Object.entries(cats).filter(([k]) => k !== 'transfert_interne').map(([k, [l]]) => [k, l]) }, { name: 'valide', label: 'Valider en même temps', type: 'check' }], { valide: true });
        if (v) pilBulk(picked, { category: v.category, ...(v.valide ? { status: 'valide' } : {}) });
      } },
      { label: 'Remettre à vérifier', run: () => pilBulk(picked, { status: 'a_verifier' }) }] },
    empty: rows.length ? 'Aucun mouvement pour ce filtre' : 'Aucun mouvement importé',
  });
  $$('[data-f]', page).forEach((b) => b.addEventListener('click', () => { f.status = b.dataset.f; saveUi(); }));
}
async function pilBulk(list, set) {
  const r = await api('POST', 'pilot/tx/bulk', { ids: list.map((t) => t.id), set });
  const refused = Object.entries(r.refused || {});
  toast(`${r.done} mouvement(s) mis à jour${refused.length ? ' · refusés : ' + refused.map(([m, n]) => `${n} (${m})`).join(', ') : ''}`, refused.length ? 6000 : 2600);
  render();
}

async function pilTxModal(t, cats, accs) {
  const acc = (id) => accs.find((a) => a.id === id);
  const m = modal(`${mhead(`${pilMoney(t.amount)} · ${fmtDate(t.booking_date)}`)}<div class="m-body">
    <div class="info">
      <div class="kv"><span>Compte</span><span>${esc(pilAccName(acc(t.account_id)))} · opération n° ${t.seq ?? '—'}</span></div>
      <div class="kv"><span>Dates</span><span>comptable ${fmtDate(t.booking_date)} · valeur ${fmtDate(t.value_date)}</span></div>
      <div class="kv"><span>Contrepartie</span><span>${esc(t.cp_name || '—')} ${t.cp_iban ? `<small class="muted">${esc(ibanFmt(t.cp_iban))}</small>` : ''}</span></div>
      ${t.transfer_account_id ? `<div class="kv"><span>Transfert interne</span><span>↔ ${esc(pilAccName(acc(t.transfer_account_id)))} ${t.transfer_tx_id ? '<span class="good">✓ mouvement opposé trouvé</span>' : '<span class="late">mouvement opposé pas encore importé</span>'}</span></div>` : ''}
      <div class="kv"><span>Communication</span><span>${esc(t.structured || t.communication || '—')}</span></div>
      <div class="kv"><span>Texte de la banque</span><small class="muted pil-raw">${esc(t.raw || '')}</small></div>
    </div>
    <div class="grid-form">
      <label class="field"><span>Catégorie</span><select name="category">${Object.entries(cats).map(([k, [l]]) => `<option value="${k}" ${t.category === k ? 'selected' : ''} ${k === 'transfert_interne' && !t.transfer_account_id ? 'disabled' : ''}>${esc(l)}</option>`).join('')}</select>
        <small class="muted">Proposée par : ${esc({ auto: 'aucune règle', 'mot-cle': 'mots-clés', contact: 'contact BâtiPro (IBAN)', compte: 'IBAN d\'un de vos comptes', appris: 'vos choix précédents (même IBAN ou même nom)', communication: 'communication structurée', manuel: 'vous' }[t.cat_source] || t.cat_source)}</small></label>
      <label class="field"><span>Nom affiché (correction)</span><input name="name_fix" value="${esc(t.name_fix || '')}" placeholder="${esc(t.cp_name || '')}"></label>
      <label class="field full"><span>Note</span><input name="note" value="${esc(t.note || '')}"></label>
      ${t.cp_iban || t.cp_name ? `<label class="field chk full"><input type="checkbox" name="learn" checked><span>Retenir : proposer cette catégorie pour les prochains mouvements ${t.cp_iban ? 'de cet IBAN' : `de « ${esc(t.cp_name)} »`}</span></label>` : ''}
    </div>
    <h4>Rapprochement avec BâtiPro</h4><div data-match><p class="muted">Recherche…</p></div>
    ${(t.history || []).length ? `<details><summary class="muted">Historique des corrections (${t.history.length})</summary><div class="rows">${t.history.map((h) => `<div class="row static"><small>${fmtDT(h.at)} · ${esc(userName(h.by))} · ${esc(h.field)} : ${esc(h.from ?? '—')} → ${esc(h.to ?? '—')}</small></div>`).join('')}</div></details>` : ''}
  </div><div class="m-foot"><button class="btn" data-close>Fermer</button><span class="grow"></span><button class="btn" data-save="a_verifier">Enregistrer</button><button class="btn primary" data-save="valide">Enregistrer et valider</button></div>`, { wide: true });
  const F = (n) => $(`[name="${n}"]`, m.el);
  $$('[data-save]', m.el).forEach((b) => { b.onclick = async () => {
    try {
      await api('PUT', `pilot/tx/${t.id}`, { category: F('category').value, name_fix: F('name_fix').value, note: F('note').value, learn: F('learn') ? F('learn').checked : false, status: b.dataset.save === 'valide' ? 'valide' : t.status });
      m.close(); toast('Enregistré'); render();
    } catch (e) { toast('Erreur : ' + e.message, 5000); }
  }; });
  const box = $('[data-match]', m.el);
  const href = (x) => (x.type === 'invoice' ? `#/invoice/${x.id}` : `#/purchase/${x.id}`);
  if (t.match_id) {
    box.innerHTML = `<div class="alert ok">Rapproché avec ${t.match_type === 'invoice' ? 'la facture' : 'l\'achat'} <a href="${href({ type: t.match_type, id: t.match_id })}">n° ${t.match_id}</a> (${fmtDT(t.match_at)}, ${esc(userName(t.match_by))}).
      ${t.match_paid ? `<br>Paiement de ${pilMoney(Math.abs(t.amount))} enregistré dans ${t.match_type === 'invoice' ? 'la facture' : 'l\'achat'}.` : '<br><small>Aucun paiement ajouté par ce rapprochement.</small>'}
      <button class="btn sm" data-unmatch>Retirer</button></div>`;
    $('[data-unmatch]', box).onclick = async () => {
      if (t.match_paid && !confirm(`Retirer le rapprochement ?\n\nLe paiement de ${pilMoney(Math.abs(t.amount))} ajouté dans ${t.match_type === 'invoice' ? 'la facture' : 'l\'achat'} sera supprimé.`)) return;
      try { await api('PUT', `pilot/tx/${t.id}`, { match: null }); m.close(); render(); } catch (e) { toast('Erreur : ' + e.message, 5000); }
    };
    return;
  }
  if (t.category === 'transfert_interne') { box.innerHTML = '<p class="muted">Transfert entre vos comptes : pas de rapprochement.</p>'; return; }
  try {
    const sug = await api('GET', `pilot/tx/${t.id}/suggest`);
    const amt = Math.abs(t.amount);
    box.innerHTML = sug.length ? `<div class="rows">${sug.map((x, i) => `<div class="row static"><span class="grow"><a href="${href(x)}">${x.type === 'invoice' ? 'Facture' : 'Achat'} ${esc(x.ref || '#' + x.id)}</a> · ${fmtDate(x.date)} · total ${pilMoney(x.total)} · reste ${pilMoney(x.rest)}<br><small class="muted">${badge(x.level, x.level === 'sûr' ? '#2f9e44' : '#f08c00')} ${esc(x.why.join(', '))}</small>
        ${x.existing_payment ? `<br><small>Paiement de ce montant déjà enregistré le ${fmtDate(x.existing_payment)} : il ne sera pas ajouté une seconde fois.</small>` : !x.can_pay && amt > x.rest ? `<br><small class="late">Le mouvement (${pilMoney(amt)}) dépasse le reste à payer : rapprochement sans paiement.</small>` : ''}</span>
        <span class="btns">${x.can_pay ? `<button class="btn sm primary" data-m="${i}" data-pay="1">Rapprocher et enregistrer le paiement</button>` : ''}<button class="btn sm" data-m="${i}" data-pay="0">Rapprocher seulement</button></span></div>`).join('')}</div>
      <small class="muted">« Enregistrer le paiement » ajoute ${pilMoney(amt)} à la date du ${fmtDate(t.booking_date)} dans la facture ou l'achat (retiré si vous annulez le rapprochement ou l'import).</small>`
      : '<p class="muted">Aucune facture ni aucun achat correspondant (communication structurée, montant, IBAN).</p>';
    $$('[data-m]', box).forEach((b) => { b.onclick = async () => {
      const x = sug[+b.dataset.m]; const pay = b.dataset.pay === '1';
      try { await api('PUT', `pilot/tx/${t.id}`, { match: { type: x.type, id: x.id, pay } }); m.close(); toast(pay ? 'Rapprochement et paiement enregistrés' : 'Rapprochement enregistré'); render(); } catch (e) { toast('Erreur : ' + e.message, 6000); }
    }; });
  } catch (e) { box.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
}

// ---------- Historique mois par mois
async function pilHistPage() {
  const d = await api('GET', 'pilot/monthly&months=24');
  const page = layout({ icon: 'chart', title: 'Historique 24 mois', sub: 'Entrées et sorties hors transferts internes · soldes reconstitués à partir des extraits' });
  const ML = (m) => { const [y, mo] = m.split('-'); return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+mo - 1]} ${y}`; };
  const anyData = d.total.some((t) => t.in || t.out || t.closing);
  page.innerHTML = `${anyData ? `<div class="cols-2"><div class="card"><div class="card-h"><h3>Entrées par mois</h3></div>${barChart(d.total.map((t) => ({ l: t.m.slice(5), v: t.in / 100 })), { color: '#2f9e44' })}</div>
      <div class="card"><div class="card-h"><h3>Sorties par mois</h3></div>${barChart(d.total.map((t) => ({ l: t.m.slice(5), v: -t.out / 100 })), { color: '#e5484d' })}</div></div>` : ''}
    <div class="card"><div class="card-h"><h3>Consolidé (tous les comptes)</h3></div><div class="pil-tx-wrap"><table class="dt"><thead><tr><th>Mois</th><th class="r">Solde début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Net</th><th class="r">Transferts internes</th><th class="r">Solde fin</th><th>Extraits</th></tr></thead><tbody>
      ${d.total.slice().reverse().map((t) => `<tr><td class="nowrap">${ML(t.m)}</td><td class="r">${pilMoney(t.opening)}</td><td class="r good">${pilMoney(t.in)}</td><td class="r">${pilMoney(t.out)}</td><td class="r"><b>${pilMoney(t.in + t.out)}</b></td><td class="r muted">${t.internal ? pilMoney(t.internal) : '—'}</td><td class="r"><b>${pilMoney(t.closing)}</b></td><td>${t.complete ? '<span class="good">✓ complets</span>' : '<span class="late">incomplets</span>'}</td></tr>`).join('')}
    </tbody></table></div><small class="muted">Un mois « incomplet » n'est pas entièrement couvert par les extraits d'un des comptes : ses totaux sont partiels. Les transferts internes s'annulent entre comptes (somme nulle quand les deux côtés sont importés).</small></div>
    ${d.accounts.map((a) => `<div class="card"><div class="card-h"><h3>${esc(pilAccName(a))}</h3><span class="muted">${esc(ibanFmt(a.iban))}</span></div><div class="pil-tx-wrap"><table class="dt"><thead><tr><th>Mois</th><th class="r">Solde début</th><th class="r">Entrées</th><th class="r">Sorties</th><th class="r">Transferts internes</th><th class="r">Solde fin</th><th class="r">Mvts</th><th>Couverture</th></tr></thead><tbody>
      ${a.months.slice().reverse().filter((x) => x.opening != null).map((x) => `<tr><td class="nowrap">${ML(x.m)}</td><td class="r">${pilMoney(x.opening)}</td><td class="r good">${pilMoney(x.in)}</td><td class="r">${pilMoney(x.out)}</td><td class="r muted">${x.internal ? pilMoney(x.internal) : '—'}</td><td class="r"><b>${pilMoney(x.closing)}</b></td><td class="r">${x.n}</td><td>${x.coverage >= 1 ? '<span class="good">100 %</span>' : `<span class="late">${Math.round(x.coverage * 100)} %</span>`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun extrait importé pour ce compte</td></tr>'}
    </tbody></table></div></div>`).join('')}`;
}

// ================================================================ Étape 3 : trésorerie, engagements, factures et échéances
const PIL_SC = { optimiste: ['Optimiste', '#2f9e44'], realiste: ['Réaliste', '#3b5bdb'], pessimiste: ['Pessimiste', '#e5484d'] };
const PIL_RISK = { eleve: ['Risque élevé', '#e5484d'], moyen: ['Risque moyen', '#f08c00'], faible: ['Risque faible', '#868e96'] };
const PIL_SRC = { facture: 'Facture client', etat_avancement: 'État d\'avancement', achat: 'Facture fournisseur', credit: 'Crédit', leasing: 'Leasing', charge: 'Charge fixe', prudence: 'Prudence', paiement_non_vu: 'Paiement pas encore sur l\'extrait' };
const PIL_FREQ_L = { mensuel: 'Mensuel', bimestriel: 'Tous les 2 mois', trimestriel: 'Trimestriel', semestriel: 'Semestriel', annuel: 'Annuel', unique: 'Une seule fois' };
const PIL_KIND_L = {
  credit: ['Crédits', { investissement: 'Crédit d\'investissement', caisse: 'Crédit de caisse', professionnel: 'Crédit professionnel', hypothecaire: 'Crédit hypothécaire', temperament: 'Prêt à tempérament', autre: 'Autre financement' }],
  leasing: ['Leasing', { vehicule: 'Véhicule', machine: 'Machine', materiel: 'Matériel', autre: 'Autre leasing' }],
  charge: ['Charges fixes', { salaires: 'Salaires', onss: 'ONSS', precompte: 'Précompte professionnel', tva: 'TVA', assurances: 'Assurances', comptabilite: 'Comptabilité', loyer: 'Loyers', telecom: 'Télécommunications', energie: 'Énergie', abonnements: 'Abonnements', autre: 'Autres charges' }],
};
const PIL_CST = { confirme: ['Confirmé', '#2f9e44'], a_confirmer: ['À confirmer', '#f08c00'], suspendu: ['Suspendu', '#868e96'], termine: ['Terminé', '#adb5bd'] };
const certBadge = (c) => (c === 'confirme' ? badge('Confirmé', '#2f9e44') : badge('Estimé', '#f08c00'));

// graphique en lignes (SVG) : séries [{ name, color, values: [nombres] }], libellés en abscisse
function pilLine(series, labels, { h = 220, fmt = (v) => pilMoney(v), zero = true } = {}) {
  const all = series.flatMap((s) => s.values).filter((v) => v != null); if (!all.length) return '<div class="empty">Aucune donnée</div>';
  let lo = Math.min(...all, zero ? 0 : Infinity); let hi = Math.max(...all, zero ? 0 : -Infinity); if (hi === lo) { hi += 1; lo -= 1; }
  const W = 640; const P = 8; const n = labels.length; const x = (i) => P + (W - 2 * P) * (n > 1 ? i / (n - 1) : 0.5); const y = (v) => P + (h - 2 * P) * (1 - (v - lo) / (hi - lo));
  const path = (vals) => vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const step = Math.max(1, Math.ceil(n / 8));
  return `<div class="pil-chart"><svg viewBox="0 0 ${W} ${h + 18}" preserveAspectRatio="none" role="img">
    ${lo < 0 && hi > 0 ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="pil-zero"/>` : ''}
    ${series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" points="${path(s.values)}"><title>${esc(s.name)}</title></polyline>`).join('')}
    ${labels.map((l, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${h + 14}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
  </svg><div class="pil-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}<span class="muted">max ${fmt(hi)} · min ${fmt(lo)}</span></div></div>`;
}
const hbars = (rows) => { const max = Math.max(1, ...rows.map((r) => Math.abs(r.v))); return `<div class="pil-hbars">${rows.map((r) => `<div><span>${esc(r.l)}</span><i style="width:${(Math.abs(r.v) / max * 100).toFixed(1)}%;background:${r.c || '#3b5bdb'}"></i><b>${pilMoney(r.v)}</b></div>`).join('') || '<div class="empty">Aucune donnée</div>'}</div>`; };

async function pilTreasuryPage() {
  const [f, mo, coms, tx, cats] = await Promise.all([api('GET', 'pilot/forecast'), api('GET', 'pilot/monthly&months=24'), api('GET', 'pilot/commitments'), api('GET', 'pilot/tx'), pilCats()]);
  const st = ui.pilTr = ui.pilTr || { sc: 'realiste', hz: 30 };
  const page = layout({ icon: 'chart', title: 'Trésorerie et prévisions', sub: `Calcul du ${fmtDate(f.today)} · aucun montant inventé : extraits, factures, achats et engagements confirmés`,
    actions: '<button class="btn" data-hyp>Hypothèses des scénarios</button>' });
  const b = f.balances; const rel = f.reliability; const S0 = f.scenarios[st.sc]; const H = S0.horizons[st.hz];
  const relC = rel.level === 'bonne' ? '#2f9e44' : rel.level === 'moyenne' ? '#f08c00' : '#e5484d';
  const flows = S0.flows.filter((x) => (new Date(x.date) - new Date(f.today)) / 864e5 <= st.hz);
  const months12 = mo.months.slice(-12);
  const txIn = (m, pred) => tx.filter((t) => t.booking_date.startsWith(m) && pred(t)).reduce((a, t) => a + t.amount, 0);
  const byCat = {}; tx.filter((t) => t.amount < 0 && t.category !== 'transfert_interne' && t.booking_date >= `${months12[0]}-01`).forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const upcoming = f.scenarios.realiste.flows.filter((x) => x.amount < 0 && x.source !== 'prudence' && (new Date(x.date) - new Date(f.today)) / 864e5 <= 30);
  const fin = coms.filter((c) => ['credit', 'leasing'].includes(c.kind) && c.status === 'confirme');
  page.innerHTML = `
    <div class="card pil-rel"><div class="card-h"><h3>Fiabilité des prévisions</h3><span class="pil-score" style="--c:${relC}">${rel.score} / 100 · ${esc(rel.level)}</span></div>
      <div class="pil-factors">${Object.values(rel.factors).map((x) => `<div><span>${esc(x.label)}</span><div class="meter"><i style="width:${Math.round(x.score * 100)}%"></i></div><small class="muted">${esc(x.detail)}</small></div>`).join('')}</div></div>
    <div class="card"><div class="card-h"><h3>Soldes bancaires</h3><span class="muted">dernière situation connue de chaque compte – pas un solde « du jour »</span></div>
      <div class="kpis">${b.accounts.map((a) => kpi(`${a.bank}${a.label ? ' – ' + a.label : ''}`, pilMoney(a.balance), { sub: a.date ? `au ${fmtDate(a.date)} (dernier extrait)${a.age_days > 7 ? ` · <span class="late">il y a ${a.age_days} jours</span>` : ''}` : '<span class="late">aucun extrait</span>' })).join('')}
        ${kpi('Trésorerie bancaire consolidée', pilMoney(b.total), { cls: 'good', sub: b.oldest_date ? `extraits du ${fmtDate(b.oldest_date)} au ${fmtDate(b.latest_date)}` : '' })}
        ${b.adjustment ? kpi('Ajusté des paiements connus', pilMoney(b.total + b.adjustment), { sub: `${pilMoney(b.adjustment)} enregistrés dans BâtiPro après le dernier extrait` }) : ''}</div></div>
    <div class="card"><div class="card-h"><h3>Prévision</h3><div class="chips">${Object.entries(PIL_SC).map(([k, [l, c]]) => `<button class="chip ${st.sc === k ? 'on' : ''}" data-sc="${k}" style="--c:${c}"><i class="dot"></i>${l}</button>`).join('')}
        ${[7, 30, 90].map((d) => `<button class="chip ${st.hz === d ? 'on' : ''}" data-hz="${d}">${d} jours</button>`).join('')}</div></div>
      <div class="pil-formula">
        <div><span>Solde de départ</span><b>${pilMoney(H.start)}</b></div>
        <div><span>+ Entrées confirmées</span><b class="good">${pilMoney(H.in_confirmed)}</b></div><div><span>+ Entrées estimées</span><b class="good">${pilMoney(H.in_estimated)}</b></div>
        <div><span>− Sorties confirmées</span><b>${pilMoney(H.out_confirmed)}</b></div><div><span>− Sorties estimées</span><b>${pilMoney(H.out_estimated)}</b></div>
        <div class="tot"><span>= Solde final estimé</span><b class="${H.end < 0 ? 'late' : ''}">${pilMoney(H.end)}</b></div>
        <div><span>Solde minimum</span><b class="${H.min < 0 ? 'late' : ''}">${pilMoney(H.min)}</b><small class="muted">le ${fmtDate(H.min_date)}</small></div>
        <div><span>Trésorerie négative</span><b class="${H.negative_date ? 'late' : 'good'}">${H.negative_date ? 'le ' + fmtDate(H.negative_date) : 'non'}</b></div></div>
      ${pilLine(Object.entries(PIL_SC).map(([k, [l, c]]) => ({ name: l, color: c, values: f.scenarios[k].series.map((p) => p.b) })), f.scenarios.realiste.series.map((p) => p.d.slice(8, 10) + '/' + p.d.slice(5, 7)))}
      <table class="dt"><thead><tr><th>Scénario</th>${[7, 30, 90].map((d) => `<th class="r">Fin à ${d} j</th><th class="r">Minimum ${d} j</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(PIL_SC).map(([k, [l]]) => `<tr><td>${l}</td>${[7, 30, 90].map((d) => { const x = f.scenarios[k].horizons[d]; return `<td class="r ${x.end < 0 ? 'late' : ''}">${pilMoney(x.end)}</td><td class="r ${x.min < 0 ? 'late' : ''}">${pilMoney(x.min)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="card"><div class="card-h"><h3>Alertes (${f.alerts.length})</h3></div><div class="rows">${f.alerts.map((a) => `<div class="row static pil-alert"><span class="grow">${badge(PIL_RISK[a.risk][0], PIL_RISK[a.risk][1])} <b>${esc(a.problem)}</b>
        <br><small>${a.amount != null ? `Montant : <b>${pilMoney(a.amount)}</b> · ` : ''}${a.date ? `Date : ${fmtDate(a.date)} · ` : ''}Impact : ${esc(a.impact)}</small><br><small class="muted">Action recommandée : ${esc(a.action)}</small></span></div>`).join('') || '<div class="empty">Aucune alerte</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>Flux prévus – ${PIL_SC[st.sc][0].toLowerCase()}, ${st.hz} jours (${flows.length})</h3></div><div class="pil-tx-wrap"><table class="dt"><thead><tr><th>Date</th><th>Origine</th><th>Libellé</th><th>Statut</th><th class="r">Montant</th></tr></thead><tbody>
      ${flows.map((x) => `<tr><td class="nowrap">${fmtDate(x.date)}</td><td><small>${esc(PIL_SRC[x.source] || x.source)}</small></td><td>${x.ref && x.ref.type === 'invoice' ? `<a href="#/invoice/${x.ref.id}">${esc(x.label)}</a>` : x.ref && x.ref.type === 'expense' ? `<a href="#/purchase/${x.ref.id}">${esc(x.label)}</a>` : esc(x.label)}</td><td>${certBadge(x.certainty)}</td><td class="r nowrap ${x.amount > 0 ? 'good' : ''}"><b>${pilMoney(x.amount)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun flux prévu</td></tr>'}</tbody></table></div>
      ${f.excluded.length ? `<details><summary class="muted">Non inclus dans la prévision (${f.excluded.length})</summary><div class="rows">${f.excluded.map((x) => `<div class="row static"><span class="grow">${esc(x.label)} <small class="muted">– ${esc(x.reason)}</small></span>${x.amount != null ? `<b>${pilMoney(x.amount)}</b>` : ''}</div>`).join('')}</div></details>` : ''}
      <small class="muted">Délais clients observés : ${f.stats.global.n ? `${f.stats.global.n} factures payées, médiane ${Math.round(f.stats.global.median)} j après l'échéance (p25 ${Math.round(f.stats.global.p25)} j, p75 ${Math.round(f.stats.global.p75)} j)` : 'aucune facture payée dans l\'historique : délais non estimés'}.</small></div>
    <div class="cols-2">
      <div class="card"><div class="card-h"><h3>Trésorerie réelle sur 24 mois</h3><span class="muted">fin de mois, tous comptes</span></div>${pilLine([{ name: 'Solde consolidé', color: '#3b5bdb', values: mo.total.map((t, i) => (mo.accounts.some((a) => a.months[i].closing != null) ? t.closing : null)) }], mo.months.map((m) => m.slice(5) + '/' + m.slice(2, 4)))}</div>
      <div class="card"><div class="card-h"><h3>Dépenses par catégorie</h3><span class="muted">12 derniers mois, extraits</span></div>${hbars(Object.entries(byCat).sort((a, c) => a[1] - c[1]).slice(0, 10).map(([k, v]) => ({ l: pilCatLabel(cats, k), v, c: pilCatColor(cats, k) })))}</div>
      <div class="card"><div class="card-h"><h3>Encaissements clients par mois</h3></div>${barChart(months12.map((m) => ({ l: m.slice(5), v: txIn(m, (t) => t.category === 'encaissement_client') / 100 })), { color: '#2f9e44' })}</div>
      <div class="card"><div class="card-h"><h3>Paiements fournisseurs et sous-traitants par mois</h3></div>${barChart(months12.map((m) => ({ l: m.slice(5), v: -txIn(m, (t) => ['materiaux', 'fournisseur', 'sous_traitance'].includes(t.category)) / 100 })), { color: '#f08c00' })}</div>
      <div class="card"><div class="card-h"><h3>Échéances des 30 prochains jours</h3></div><div class="rows">${upcoming.map((x) => `<div class="row static"><span class="nowrap">${fmtDate(x.date)}</span><span class="grow">${esc(x.label)}</span>${certBadge(x.certainty)}<b>${pilMoney(x.amount)}</b></div>`).join('') || '<div class="empty">Aucune échéance</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>Crédits et leasing</h3><a href="#/pilotage/engagements">Registre</a></div><div class="rows">${fin.map((c) => `<div class="row static"><span class="grow"><b>${esc(c.label)}</b><br><small class="muted">${esc(c.lender || '')} · ${c.amount != null ? pilMoney(c.amount) + ' ' + (PIL_FREQ_L[c.frequency] || '').toLowerCase() : 'mensualité non renseignée'}${c.end_date ? ' · fin ' + fmtDate(c.end_date) : ''}</small></span><span class="r">${c.kind === 'credit' ? `capital restant<br><b>${c.remaining_now != null ? pilMoney(c.remaining_now) : '—'}</b>` : `reste à payer<br><b>${pilMoney(c.remaining_total)}</b>`}</span></div>`).join('') || '<div class="empty">Aucun crédit ni leasing confirmé</div>'}</div></div>
    </div>`;
  $$('[data-sc]', page).forEach((x) => { x.onclick = () => { st.sc = x.dataset.sc; saveUi(); render(); }; });
  $$('[data-hz]', page).forEach((x) => { x.onclick = () => { st.hz = +x.dataset.hz; saveUi(); render(); }; });
  $('[data-hyp]').onclick = () => pilHypModal(f.hypotheses);
}

function pilHypModal(h) {
  const keys = Object.keys(PIL_SC);
  const D = { p25: 'Rapide (25 % des clients paient plus vite)', median: 'Habituel (délai médian observé)', p75: 'Lent (75 % des clients paient plus vite)' };
  const m = modal(`${mhead('Hypothèses des scénarios')}<div class="m-body"><p class="muted">Ces réglages s'appliquent aux factures clients (jamais certaines). Les sorties confirmées sont les mêmes dans les trois scénarios.</p>
    <table class="dt"><thead><tr><th></th>${keys.map((k) => `<th>${PIL_SC[k][0]}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Délai de paiement des clients</td>${keys.map((k) => `<td><select data-k="${k}" data-f="delay">${Object.entries(D).map(([v, l]) => `<option value="${v}" ${h[k].delay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`).join('')}</tr>
      <tr><td>Retard supplémentaire (jours)</td>${keys.map((k) => `<td><input data-k="${k}" data-f="extraDays" inputmode="numeric" value="${h[k].extraDays}"></td>`).join('')}</tr>
      <tr><td>Probabilité d'encaissement observée pour les factures en retard</td>${keys.map((k) => `<td><input type="checkbox" data-k="${k}" data-f="useProbability" ${h[k].useProbability ? 'checked' : ''}></td>`).join('')}</tr>
      <tr><td>Exclure les factures en retard de plus de … jours (vide = non)</td>${keys.map((k) => `<td><input data-k="${k}" data-f="excludeOverdueAfter" inputmode="numeric" value="${h[k].excludeOverdueAfter ?? ''}"></td>`).join('')}</tr>
      <tr><td>Compter les états d'avancement approuvés (pas encore facturés)</td>${keys.map((k) => `<td><input type="checkbox" data-k="${k}" data-f="includeEaApproved" ${h[k].includeEaApproved ? 'checked' : ''}></td>`).join('')}</tr>
      <tr><td>Compter les états d'avancement envoyés (non approuvés)</td>${keys.map((k) => `<td><input type="checkbox" data-k="${k}" data-f="includeEaSent" ${h[k].includeEaSent ? 'checked' : ''}></td>`).join('')}</tr>
      <tr><td>Marge de prudence sur les sorties (%)</td>${keys.map((k) => `<td><input data-k="${k}" data-f="prudencePct" inputmode="decimal" value="${h[k].prudencePct}"></td>`).join('')}</tr>
    </tbody></table></div><div class="m-foot"><button class="btn" data-reset>Valeurs par défaut</button><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-save>Enregistrer</button></div>`, { wide: true });
  const read = () => { const o = {}; keys.forEach((k) => { o[k] = {}; }); $$('[data-k]', m.el).forEach((el) => { o[el.dataset.k][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value === '' ? null : el.tagName === 'SELECT' ? el.value : num(el.value); }); return o; };
  $('[data-save]', m.el).onclick = async () => { await api('PUT', 'pilot/hypotheses', read()); m.close(); toast('Hypothèses enregistrées'); render(); };
  $('[data-reset]', m.el).onclick = async () => { if (!confirm('Revenir aux hypothèses par défaut ?')) return; await api('PUT', 'pilot/hypotheses', {}); m.close(); render(); };
}

// ---------- Engagements : crédits, leasing, charges fixes
async function pilCommitmentsPage(tab) {
  const [list, accs] = await Promise.all([api('GET', 'pilot/commitments'), api('GET', 'pilot/accounts')]);
  const t = ['credit', 'leasing', 'charge', 'a_confirmer'].includes(tab) ? tab : 'credit';
  const page = layout({ icon: 'chart', title: 'Engagements', sub: 'Crédits, leasing et charges fixes – seuls les engagements confirmés entrent dans les prévisions',
    actions: `<button class="btn" data-detect>Détecter dans les extraits</button><button class="btn primary" data-add>Ajouter</button>` });
  const toConf = list.filter((c) => c.status === 'a_confirmer');
  const rows = t === 'a_confirmer' ? toConf : list.filter((c) => c.kind === t && c.status !== 'a_confirmer');
  page.innerHTML = `<div class="chips pil-tabs">${[['credit', 'Crédits'], ['leasing', 'Leasing'], ['charge', 'Charges fixes'], ['a_confirmer', `À confirmer (${toConf.length})`]].map(([k, l]) => `<a class="chip ${k === t ? 'on' : ''}" href="#/pilotage/engagements/${k}">${l}</a>`).join('')}</div><div id="tbl"></div>`;
  const accName = (id) => pilAccName(accs.find((a) => a.id === id));
  dataTable($('#tbl'), {
    rows, search: (c) => [c.label, c.lender].join(' '),
    columns: [{ l: 'Libellé', v: (c) => `<b>${esc(c.label)}</b>${c.docs.length ? ` <small class="muted">📎 ${c.docs.length}</small>` : ''}<br><small class="muted">${esc(PIL_KIND_L[c.kind][1][c.subtype] || c.subtype)}${c.lender ? ' · ' + esc(c.lender) : ''}</small>` },
      { l: 'Montant', cls: 'r', v: (c) => (c.amount != null ? `${pilMoney(c.amount)}<br><small class="muted">${esc(PIL_FREQ_L[c.frequency] || '')}</small>` : '<small class="muted">non renseigné</small>'), sort: (c) => c.amount || 0 },
      { l: 'Prochaine échéance', v: (c) => (c.next_flows[0] ? `${fmtDate(c.next_flows[0].date)}<br><small class="muted">${esc(c.next_flows[0].detail || '')}</small>` : '—'), sort: (c) => (c.next_flows[0] || {}).date || '9' },
      { l: 'Fin', v: (c) => fmtDate(c.end_date) || '—', sort: (c) => c.end_date || '9' },
      { l: t === 'credit' ? 'Capital restant' : '12 prochains mois', cls: 'r', v: (c) => (c.kind === 'credit' ? (c.remaining_now != null ? pilMoney(c.remaining_now) : '—') + (c.schedule_notes && c.schedule_notes.length ? `<br><small class="late">${esc(c.schedule_notes[0])}</small>` : '') : pilMoney(c.next_12m)) },
      { l: 'Compte', v: (c) => `<small>${esc(c.account_id ? accName(c.account_id) : '—')}</small>` },
      { l: 'Statut', v: (c) => st(PIL_CST, c.status) }],
    onRow: (c) => pilCommitmentForm(c.kind, c, accs),
    empty: t === 'a_confirmer' ? 'Rien à confirmer' : 'Aucun engagement : cliquez sur « Ajouter »',
  });
  $('[data-add]').onclick = () => pilCommitmentForm(t === 'a_confirmer' ? 'charge' : t, null, accs);
  $('[data-detect]').onclick = () => pilDetectModal(accs);
}

function pilCommitmentForm(kind, c, accs) {
  const v = c ? { ...c } : { kind, status: 'confirme', frequency: 'mensuel', repayment: 'mensualites', subtype: Object.keys(PIL_KIND_L[kind][1])[0] };
  ['amount', 'capital_initial', 'capital_remaining', 'residual'].forEach((k) => { if (v[k] != null) v[k] = String(v[k] / 100).replace('.', ','); });
  const accOpts = [['', '—'], ...accs.map((a) => [a.id, pilAccName(a)])];
  const fields = [
    { name: 'subtype', label: 'Type', type: 'select', options: Object.entries(PIL_KIND_L[kind][1]) },
    { name: 'label', label: 'Libellé', required: true },
    { name: 'lender', label: kind === 'charge' ? 'Bénéficiaire' : 'Organisme financier' },
    { name: 'account_id', label: 'Compte bancaire débité', type: 'select', options: accOpts },
    { name: 'amount', label: kind === 'charge' ? 'Montant de l\'échéance (€)' : 'Mensualité / échéance (€)', type: 'money' },
    { name: 'frequency', label: 'Fréquence', type: 'select', options: Object.entries(PIL_FREQ_L) },
    { name: 'next_date', label: 'Prochaine échéance (date de prélèvement)', type: 'date' },
    { name: 'start_date', label: 'Date de début', type: 'date' },
    { name: 'end_date', label: 'Date de fin', type: 'date' },
    ...(kind === 'credit' ? [{ name: 'capital_initial', label: 'Capital initial (€)', type: 'money' }, { name: 'capital_remaining', label: 'Capital restant dû (€)', type: 'money' },
      { name: 'capital_asof', label: 'Capital restant à la date du', type: 'date', hint: 'Date à laquelle ce capital est connu (tableau d\'amortissement)' },
      { name: 'rate', label: 'Taux d\'intérêt annuel (%)', type: 'percent' }, { name: 'repayment', label: 'Remboursement', type: 'select', options: [['mensualites', 'Mensualités (capital + intérêts)'], ['in_fine', 'In fine (intérêts, capital à la fin)']] },
      { name: 'guarantees', label: 'Garanties', cls: 'full' }] : []),
    ...(kind === 'leasing' ? [{ name: 'residual', label: 'Valeur de rachat (€)', type: 'money' }, { name: 'buyback', label: 'Rachat prévu à la fin (compté dans les prévisions)', type: 'check' }] : []),
    { name: 'supplier_id', label: 'Fournisseur BâtiPro (si ses factures sont saisies dans les achats)', type: 'select', options: [['', '—']], hint: 'Évite de compter deux fois : l\'échéance est ignorée quand un achat de ce fournisseur existe à ± 15 jours' },
    { name: 'status', label: 'Statut', type: 'select', options: Object.entries(PIL_CST).map(([k, [l]]) => [k, l]) },
    { name: 'notes', label: 'Notes', type: 'textarea', cls: 'full' },
  ];
  formModal({
    title: c ? c.label : `Nouveau : ${PIL_KIND_L[kind][0].toLowerCase()}`, fields, values: v, wide: true, saveLabel: c && c.status === 'a_confirmer' ? 'Enregistrer' : 'Enregistrer',
    extra: c ? `<div class="field full"><span>Documents</span><div class="rows">${c.docs.map((d, i) => `<div class="row static"><a href="api.php?r=pilot/commitments/${c.id}/doc/${i}">${esc(d.name)}</a><small class="muted">${fmtDT(d.at)}</small></div>`).join('') || '<small class="muted">Aucun document</small>'}</div>
      <input type="file" data-doc accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"></div>${c.status === 'a_confirmer' ? '<div class="alert info full">Engagement détecté ou à vérifier : vérifiez les montants et dates, puis choisissez le statut « Confirmé » pour l\'intégrer aux prévisions.</div>' : ''}` : '',
    after: async (form) => {
      const sel = form.elements.supplier_id;
      const contacts = await db.list('contact').catch(() => []);
      sel.innerHTML = `<option value="">—</option>${contacts.filter((x) => ['fournisseur', 'soustraitant'].includes(x.data.kind)).map((x) => `<option value="${x.id}" ${x.id === v.supplier_id ? 'selected' : ''}>${esc(contactName(x))}</option>`).join('')}`;
      const doc = form.querySelector('[data-doc]');
      if (doc) doc.onchange = async () => { const fd = new FormData(); fd.append('file', doc.files[0]); try { await api('POST', `pilot/commitments/${c.id}/doc`, fd); toast('Document ajouté'); closeModals(); render(); } catch (e) { toast('Erreur : ' + e.message, 5000); } };
    },
    async onSave(x) {
      const body = { ...x, kind, account_id: x.account_id || null, supplier_id: x.supplier_id ? +x.supplier_id : null, buyback: !!x.buyback };
      ['amount', 'capital_initial', 'capital_remaining', 'residual'].forEach((k) => { body[k] = x[k] === '' || x[k] == null ? null : Math.round(num(x[k]) * 100); });
      body.rate = x.rate === '' || x.rate == null ? null : num(x.rate);
      if (c) await api('PUT', `pilot/commitments/${c.id}`, body); else await api('POST', 'pilot/commitments', body);
      toast('Enregistré'); render();
    },
    onDelete: c ? async () => { await api('DELETE', `pilot/commitments/${c.id}`); render(); } : null,
  });
}

async function pilDetectModal(accs) {
  const list = await api('GET', 'pilot/commitments/detect');
  const m = modal(`${mhead('Charges récurrentes détectées dans les extraits')}<div class="m-body"><p class="muted">Montants semblables payés au même bénéficiaire pendant au moins 3 mois (12 derniers mois). Ce sont des <b>propositions</b> : une fois ajoutées, elles restent « à confirmer » et n'entrent pas dans les prévisions avant votre confirmation.</p>
    <div class="rows">${list.map((x, i) => `<div class="row static"><span class="grow"><b>${esc(x.label)}</b><br><small class="muted">${x.months} mois · ${x.count} paiements · ${pilMoney(x.min)} à ${pilMoney(x.max)} · dernier le ${fmtDate(x.last)}</small></span><b>${pilMoney(x.amount)}</b>
      ${x.already ? '<small class="muted">déjà ajoutée</small>' : `<button class="btn sm" data-i="${i}">Ajouter (à confirmer)</button>`}</div>`).join('') || '<div class="empty">Aucune charge récurrente détectée (il faut au moins 3 mois d\'extraits)</div>'}</div></div>`, { wide: true });
  $$('[data-i]', m.el).forEach((b) => { b.onclick = async () => {
    const x = list[+b.dataset.i];
    const sub = { telecom: 'telecom', assurances: 'assurances', social: 'onss', impots: 'tva', loyer: 'loyer', salaires: 'salaires' }[x.category] || 'autre';
    await api('POST', 'pilot/commitments', { kind: x.kind, subtype: x.kind === 'charge' ? sub : 'autre', label: x.label, amount: x.amount, frequency: 'mensuel', next_date: x.next, source: 'detecte', detect_key: x.key });
    b.replaceWith(Object.assign(document.createElement('small'), { className: 'good', textContent: 'ajoutée – à confirmer' }));
  }; });
}

// ---------- Factures clients et fournisseurs : états et échéances
async function pilDuePage(tab) {
  const r = await api('GET', 'pilot/receivables');
  const t = tab === 'fournisseurs' ? 'fournisseurs' : 'clients';
  const IST = { non_echu: ['Non échu', '#3b5bdb'], echu: ['Échu', '#e5484d'], partiel: ['Partiellement payé', '#e8a10c'], partiel_echu: ['Part. payé – échu', '#e8590c'], paye: ['Payé', '#2f9e44'], conteste: ['Contesté', '#7048e8'],
    attente_approbation: ['En attente d\'approbation', '#868e96'], approuve_a_facturer: ['Approuvé – à facturer', '#0c8599'], brouillon_ea: ['État à envoyer', '#adb5bd'] };
  const EST = { engage: ['Engagé – à payer', '#3b5bdb'], echu: ['Échu', '#e5484d'], partiel: ['Partiellement payé', '#e8a10c'], paye: ['Payé', '#2f9e44'], a_valider: ['À valider', '#f08c00'] };
  const page = layout({ icon: 'chart', title: 'Factures et échéances' });
  const sum = (l, k) => l.reduce((a, x) => a + x[k], 0);
  const inv = r.invoices; const exp = r.expenses;
  page.innerHTML = `<div class="kpis">${kpi('Clients : reste à encaisser', pilMoney(sum(inv.filter((i) => i.ea === null && i.state !== 'conteste'), 'rest')), { sub: `dont échu ${pilMoney(sum(inv.filter((i) => ['echu', 'partiel_echu'].includes(i.state)), 'rest'))}` })}
      ${kpi('Contesté', pilMoney(sum(inv.filter((i) => i.state === 'conteste'), 'rest')))}${kpi('États d\'avancement pas encore facturés', pilMoney(sum(inv.filter((i) => i.ea !== null && i.ea !== 'conteste'), 'total')))}
      ${kpi('Fournisseurs : engagé à payer', pilMoney(sum(exp, 'rest')), { sub: `dont échu ${pilMoney(sum(exp.filter((e) => e.state === 'echu'), 'rest'))} · à valider ${pilMoney(sum(exp.filter((e) => e.state === 'a_valider'), 'rest'))}` })}</div>
    <div class="chips pil-tabs"><a class="chip ${t === 'clients' ? 'on' : ''}" href="#/pilotage/echeances/clients">Factures clients</a><a class="chip ${t === 'fournisseurs' ? 'on' : ''}" href="#/pilotage/echeances/fournisseurs">Factures fournisseurs</a></div><div id="tbl"></div>`;
  if (t === 'clients') dataTable($('#tbl'), {
    rows: inv, state: { sort: 4 }, search: (i) => [i.number, i.client_name].join(' '),
    filters: { def: '', options: [['', 'Toutes'], ...Object.entries(IST).map(([k, [l, c]]) => [k, l, c])], match: (i, k) => i.state === k },
    columns: [{ l: 'Facture', v: (i) => `<a href="#/invoice/${i.id}">${esc(i.number || (i.ea !== null ? 'État d\'avancement' : '#' + i.id))}</a>` }, { l: 'Client', v: (i) => esc(i.client_name) },
      { l: 'Date', v: (i) => fmtDate(i.date), sort: (i) => i.date || '' }, { l: 'Échéance', v: (i) => `${fmtDate(i.due)}${i.late_days ? `<br><small class="late">${i.late_days} j de retard</small>` : ''}`, sort: (i) => i.due || '9' },
      { l: 'Total', cls: 'r', v: (i) => pilMoney(i.total), sort: (i) => i.total }, { l: 'Reste', cls: 'r', v: (i) => `<b>${pilMoney(i.ea !== null ? i.total : i.rest)}</b>`, sort: (i) => i.rest },
      { l: 'État', v: (i) => st(IST, i.state) + (i.flag_note ? `<br><small class="muted">${esc(i.flag_note)}</small>` : '') },
      { l: '', v: (i) => (i.ea === null && i.rest > 0 ? `<button class="btn sm" data-flag="${i.id}">${i.flag === 'conteste' ? 'Retirer « contesté »' : 'Marquer contestée'}</button>` : '') }],
    footer: (l) => `<tr><td colspan="5">${l.length} document(s)</td><td class="r"><b>${pilMoney(l.reduce((a, i) => a + (i.ea !== null ? i.total : i.rest), 0))}</b></td><td colspan="2"></td></tr>`,
    empty: 'Aucune facture',
  });
  else dataTable($('#tbl'), {
    rows: exp, state: { sort: 4 }, search: (e) => [e.ref, e.supplier_name].join(' '),
    filters: { def: '', options: [['', 'Tous'], ...Object.entries(EST).map(([k, [l, c]]) => [k, l, c])], match: (e, k) => e.state === k },
    columns: [{ l: 'Facture', v: (e) => `<a href="#/purchase/${e.id}">${esc(e.ref || '#' + e.id)}</a>` }, { l: 'Fournisseur', v: (e) => esc(e.supplier_name) }, { l: 'Date', v: (e) => fmtDate(e.date), sort: (e) => e.date || '' },
      { l: 'Échéance', v: (e) => fmtDate(e.due) || '<small class="muted">non renseignée</small>', sort: (e) => e.due || '9' }, { l: 'Total TTC', cls: 'r', v: (e) => pilMoney(e.total), sort: (e) => e.total },
      { l: 'Payé', cls: 'r', v: (e) => `${pilMoney(e.paid)}${e.payments_count > 1 ? `<br><small class="muted">${e.payments_count} paiements</small>` : ''}` }, { l: 'Reste', cls: 'r', v: (e) => `<b>${pilMoney(e.rest)}</b>`, sort: (e) => e.rest },
      { l: 'État', v: (e) => st(EST, e.state) }, { l: 'Chantier', v: (e) => (e.project_id ? `<a href="#/project/${e.project_id}">voir</a>` : '') }],
    footer: (l) => `<tr><td colspan="6">${l.length} facture(s)</td><td class="r"><b>${pilMoney(l.reduce((a, e) => a + e.rest, 0))}</b></td><td colspan="2"></td></tr>`,
    empty: 'Aucune facture fournisseur',
  });
  $('#tbl').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-flag]'); if (!b) return;
    const i = inv.find((x) => x.id === +b.dataset.flag);
    if (i.flag === 'conteste') { await api('PUT', `pilot/flags/${i.id}`, { flag: '' }); render(); return; }
    const v = await ask('Facture contestée', [{ name: 'note', label: 'Motif (facultatif)' }]);
    if (v) { await api('PUT', `pilot/flags/${i.id}`, { flag: 'conteste', note: v.note }); toast('Facture marquée contestée : exclue des prévisions'); render(); }
  });
}

// ================================================================ Étape 4 : AI Director, rapport quotidien, assistant, chantiers
const PIL_SEVL = { critique: ['Critique', '#c92a2a'], elevee: ['Élevée', '#e5484d'], moyenne: ['Moyenne', '#f08c00'], faible: ['Faible', '#868e96'] };
const PIL_ASTL = { nouvelle: ['Nouvelle', '#3b5bdb'], en_cours: ['En cours', '#7048e8'], resolue: ['Résolue', '#2f9e44'], ignoree: ['Ignorée', '#adb5bd'] };
const PIL_CATL = { tresorerie: 'Trésorerie', encaissements: 'Encaissements', decaissements: 'Décaissements', chantiers: 'Chantiers', fournisseurs: 'Fournisseurs', depenses: 'Dépenses', structure: 'Structure', conformite: 'Conformité', donnees: 'Données' };
const PIL_OUT = { fournisseurs: 'Fournisseurs', sous_traitants: 'Sous-traitants', salaires: 'Salaires', onss: 'ONSS / précompte', tva: 'TVA', credits: 'Crédits', leasing: 'Leasing', autres: 'Autres obligations' };
const pilVerif = (c) => (!c ? '' : c.ok ? '<small class="good">✓ montants vérifiés dans les données de BâtiPro</small>' : c.error ? `<small class="late">${esc(c.error)}</small>` : `<small class="late">⚠ montant(s) introuvable(s) dans les données : ${esc(c.unverified.join(', '))} – à ne pas utiliser</small>`);

async function pilDirectorPage() {
  const list = await api('GET', 'pilot/reports');
  const date = ui.pilRep && list.some((r) => r.rdate === ui.pilRep) ? ui.pilRep : (list[0] || {}).rdate;
  const [rep, alerts] = await Promise.all([date ? api('GET', `pilot/reports/${date}`) : null, api('GET', 'pilot/alerts&all=1')]);
  const page = layout({ icon: 'chart', title: 'Directeur', sub: 'MADIBU – DAILY FINANCIAL REPORT · analyses calculées par BâtiPro, commentaire par l\'IA',
    actions: `${list.length ? `<select data-rep>${list.map((r) => `<option value="${r.rdate}" ${r.rdate === date ? 'selected' : ''}>Rapport du ${fmtDate(r.rdate)}</option>`).join('')}</select>` : ''}<button class="btn primary" data-gen>Actualiser le rapport du jour</button>` });
  const sel = $('[data-rep]'); if (sel) sel.onchange = () => { ui.pilRep = sel.value; saveUi(); render(); };
  $('[data-gen]').onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Analyse en cours…'; try { const r = await api('POST', 'pilot/reports', {}); ui.pilRep = null; toast(r.message, 5000); render(); } catch (err) { toast('Erreur : ' + err.message, 6000); e.target.disabled = false; } };
  if (!rep) { page.innerHTML = empty('Aucun rapport', 'Le rapport est créé chaque matin par la tâche planifiée, ou maintenant avec « Actualiser le rapport du jour ».'); return; }
  const d = rep.data; const A = d.A; const B = d.B; const C = d.C; const D = d.D;
  const open = alerts.filter((a) => ['nouvelle', 'en_cours'].includes(a.status));
  const ast = ui.pilAst = ui.pilAst || 'ouvertes';
  const shown = alerts.filter((a) => (ast === 'ouvertes' ? ['nouvelle', 'en_cours'].includes(a.status) : ast === 'toutes' ? true : a.status === ast));
  const fc = (s, h) => A.forecast[s][h];
  page.innerHTML = `
    <div class="card pil-report-h"><div class="card-h"><h3>${esc(d.title)} – ${fmtDate(d.date)}</h3><span class="muted">version ${rep.version} · ${rep.source === 'cron' ? 'automatique' : 'manuel'} · ${fmtDT(rep.updated_at)}</span></div>
      ${rep.ai_comment ? `<div class="pil-ai"><b>Commentaire de l'IA</b> <small class="muted">(explication des chiffres ci-dessous, aucune décision prise)</small><p>${esc(rep.ai_comment).replace(/\n/g, '<br>')}</p>${pilVerif(rep.ai_check)}</div>` : `<p class="muted">${rep.ai_check && rep.ai_check.error ? esc(rep.ai_check.error) : 'Commentaire IA non disponible (clé API non configurée) : les chiffres et priorités ci-dessous sont calculés par BâtiPro.'}</p>`}</div>
    <div class="card"><div class="card-h"><h3>E. Les 5 priorités</h3></div><div class="pil-prio">${d.E.map((p, i) => `<div class="pil-prio-i"><span class="pil-n">${i + 1}</span><div class="grow"><b>${esc(p.action)}</b> ${badge(PIL_SEVL[p.severity][0], PIL_SEVL[p.severity][1])}
        <div class="pil-kv"><span>Pourquoi</span><span>${esc(p.title)} – ${esc(p.why)}</span><span>Impact</span><span>${esc(p.impact)}</span><span>Montant</span><span>${p.amount != null ? `<b>${pilMoney(p.amount)}</b>` : '—'}</span><span>Qui</span><span>${esc(p.who)}</span><span>Pour le</span><span>${fmtDate(p.when)}</span></div></div>
        <button class="btn sm" data-dec="${p.alert_id}">Décision…</button></div>`).join('') || '<div class="empty">Aucune action prioritaire</div>'}</div></div>
    <div class="cols-2">
      <div class="card"><div class="card-h"><h3>A. Trésorerie</h3><span class="muted">fiabilité ${A.reliability}/100 (${esc(A.reliability_level)})</span></div><div class="rows">
        ${A.accounts.map((a) => `<div class="row static"><span class="grow">${esc(a.bank)}${a.label ? ' – ' + esc(a.label) : ''}<br><small class="muted">${a.date ? `extrait du ${fmtDate(a.date)}${a.age_days > 7 ? ` · <span class="late">il y a ${a.age_days} j</span>` : ''}` : 'aucun extrait'}</small></span><b>${pilMoney(a.balance)}</b></div>`).join('')}
        <div class="row static"><span class="grow"><b>Trésorerie bancaire consolidée</b></span><b>${pilMoney(A.total)}</b></div>
        <div class="row static"><span class="grow">Mouvements du ${fmtDate(A.recent.from)} au ${fmtDate(A.recent.to)} (hors transferts internes)</span><span class="good">${pilMoney(A.recent.in)}</span>&nbsp;<span>${pilMoney(A.recent.out)}</span></div></div>
        <table class="dt"><thead><tr><th>Prévision</th><th class="r">7 j</th><th class="r">30 j</th><th class="r">90 j</th></tr></thead><tbody>${Object.entries(PIL_SC).map(([k, [l]]) => `<tr><td>${l}</td>${[7, 30, 90].map((h) => `<td class="r ${fc(k, h).end < 0 ? 'late' : ''}">${pilMoney(fc(k, h).end)}${fc(k, h).negative_date ? `<br><small class="late">négatif le ${fmtDate(fc(k, h).negative_date)}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="card-h"><h3>B. Encaissements</h3></div><div class="kpis">${kpi('Factures en attente', pilMoney(B.pending_amount), { sub: `${B.pending_count} facture(s)` })}${kpi('Échues', pilMoney(B.overdue_amount), { cls: B.overdue_count ? 'late' : '', sub: `${B.overdue_count} facture(s)` })}${kpi('Attendus à 30 j (réaliste)', pilMoney(B.expected_30d), { sub: 'estimé' })}</div>
        <div class="rows">${B.to_chase.map((c) => `<div class="row static"><span class="grow"><b>${esc(c.client)}</b><br><small class="muted">${c.invoices} facture(s), jusqu'à ${c.max_late} j de retard</small></span><b>${pilMoney(c.amount)}</b></div>`).join('') || '<div class="empty">Aucun client à relancer</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>C. Décaissements (30 prochains jours)</h3><b>${pilMoney(C.total_30d)}</b></div>${hbars(Object.entries(PIL_OUT).map(([k, l]) => ({ l, v: -(C.next_30d[k] || 0), c: '#e5484d' })).filter((x) => x.v))}
        <details><summary class="muted">Fournisseurs à payer (${C.to_pay.length})</summary><div class="rows">${C.to_pay.map((e) => `<a class="row" href="#/purchase/${e.id}"><span class="grow">${esc(e.supplier)} <small class="muted">${esc(e.ref || '')}</small></span><span>${fmtDate(e.due) || '—'}</span><b>${pilMoney(e.rest)}</b></a>`).join('')}</div></details></div>
      <div class="card"><div class="card-h"><h3>D. Chantiers</h3><a href="#/pilotage/chantiers">Analyse complète</a></div><div class="rows">
        ${D.at_risk.map((a) => `<div class="row static"><span class="grow">${badge(PIL_SEVL[a.severity][0], PIL_SEVL[a.severity][1])} ${esc(a.title)}</span>${a.amount != null ? `<b>${pilMoney(a.amount)}</b>` : ''}</div>`).join('') || '<div class="empty">Aucun chantier à risque</div>'}
        ${D.to_invoice.map((x) => `<div class="row static"><span class="grow">À facturer : ${esc(x.name)}</span><b>${pilMoney(x.amount)}</b></div>`).join('')}
        ${D.avenants_pending.map((v) => `<div class="row static"><span class="grow">Avenant en attente : ${esc(v.project)} ${v.age != null ? `<small class="muted">(${v.age} j)</small>` : ''}</span><b>${pilMoney(v.amount)}</b></div>`).join('')}
        ${D.abnormal.map((x) => `<div class="row static"><span class="grow">${esc(x.title)}</span><b>${pilMoney(x.amount)}</b></div>`).join('')}</div></div>
    </div>
    ${(d.not_verifiable || []).length ? `<div class="alert info">Non vérifiable avec les données actuelles : ${d.not_verifiable.map(esc).join(' ')}</div>` : ''}
    <div class="card"><div class="card-h"><h3>Décisions et actions du ${fmtDate(rep.date)}</h3><button class="btn sm" data-dec="">Ajouter</button></div><div class="rows">${rep.decisions.map((x) => `<div class="row static"><span class="grow">${esc(x.text)}<br><small class="muted">${esc(userName(x.created_by))} · ${fmtDT(x.created_at)}</small></span>
      <select data-dst="${x.id}">${[['decidee', 'Décidée'], ['realisee', 'Réalisée'], ['abandonnee', 'Abandonnée']].map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`).join('') || '<div class="empty">Aucune décision notée</div>'}</div></div>
    <div class="card"><div class="card-h"><h3>Alertes (${open.length} ouvertes)</h3><div class="chips">${[['ouvertes', 'Ouvertes'], ['resolue', 'Résolues'], ['ignoree', 'Ignorées'], ['toutes', 'Toutes']].map(([k, l]) => `<button class="chip ${ast === k ? 'on' : ''}" data-ast="${k}">${l}</button>`).join('')}</div></div>
      <div class="rows">${shown.map((a) => `<div class="row static pil-alert" data-al="${a.id}"><span class="grow">${badge(PIL_SEVL[a.severity][0], PIL_SEVL[a.severity][1])} <small class="muted">${esc(PIL_CATL[a.category] || a.category)}</small> <b>${esc(a.title)}</b><br><small>${esc(a.description || '')}</small>
        <br><small class="muted">Responsable : ${esc(a.owner || '—')} · pour le ${fmtDate(a.due)} · détectée le ${fmtDate(a.first_seen)}${a.occurrences > 1 ? ` · vue ${a.occurrences} jours` : ''}</small></span>${a.amount != null ? `<b>${pilMoney(a.amount)}</b>` : ''}${st(PIL_ASTL, a.status)}</div>`).join('') || '<div class="empty">Aucune alerte</div>'}</div></div>
    <div class="cols-2">
      <div class="card"><div class="card-h"><h3>Comparer deux mois</h3></div><div class="grid-form"><label class="field"><span>Mois 1</span><input type="month" data-m1></label><label class="field"><span>Mois 2</span><input type="month" data-m2></label></div><button class="btn" data-cmp>Comparer</button><div data-cmpout></div></div>
      <div class="card"><div class="card-h"><h3>Prévision passée vs réalité</h3></div><div class="grid-form"><label class="field"><span>Rapport du</span><select data-rvd>${list.map((r) => `<option>${r.rdate}</option>`).join('')}</select></label><label class="field"><span>Horizon (jours)</span><input data-rvh inputmode="numeric" value="30"></label></div><button class="btn" data-rv>Expliquer l'écart</button><div data-rvout></div></div>
    </div>`;
  $$('[data-ast]', page).forEach((b) => { b.onclick = () => { ui.pilAst = b.dataset.ast; saveUi(); render(); }; });
  $$('[data-al]', page).forEach((r) => { r.onclick = () => pilAlertModal(alerts.find((a) => a.id === +r.dataset.al)); });
  $$('[data-dec]', page).forEach((b) => { b.onclick = async () => { const v = await ask('Décision ou action', [{ name: 'text', label: 'Décision prise / action à réaliser', type: 'textarea', required: true }]); if (v) { await api('POST', 'pilot/decisions', { text: v.text, alert_id: b.dataset.dec ? +b.dataset.dec : null, kind: 'decision' }); toast('Décision enregistrée'); render(); } }; });
  $$('[data-dst]', page).forEach((s2) => { s2.onchange = async () => { await api('PUT', `pilot/decisions/${s2.dataset.dst}`, { status: s2.value }); toast('Enregistré'); }; });
  const m1 = new Date(); m1.setMonth(m1.getMonth() - 2); const m2 = new Date(); m2.setMonth(m2.getMonth() - 1);
  $('[data-m1]', page).value = m1.toISOString().slice(0, 7); $('[data-m2]', page).value = m2.toISOString().slice(0, 7);
  $('[data-cmp]', page).onclick = async () => {
    const r = await api('GET', `pilot/compare&m1=${$('[data-m1]', page).value}&m2=${$('[data-m2]', page).value}`);
    const row = (l, a, b, dd) => `<tr><td>${l}</td><td class="r">${a == null ? '—' : pilMoney(a)}</td><td class="r">${b == null ? '—' : pilMoney(b)}</td><td class="r ${dd < 0 ? 'late' : 'good'}">${dd == null ? '—' : pilMoney(dd)}</td></tr>`;
    $('[data-cmpout]', page).innerHTML = `<table class="dt"><thead><tr><th></th><th class="r">${r.m1.month}</th><th class="r">${r.m2.month}</th><th class="r">Écart</th></tr></thead><tbody>
      ${row('Entrées bancaires', r.m1.bank && r.m1.bank.in, r.m2.bank && r.m2.bank.in, r.diff.bank_in)}${row('Sorties bancaires', r.m1.bank && r.m1.bank.out, r.m2.bank && r.m2.bank.out, r.diff.bank_out)}${row('Solde fin de mois', r.m1.bank && r.m1.bank.closing, r.m2.bank && r.m2.bank.closing, r.diff.closing)}
      ${row('Facturé HT', r.m1.invoiced_ht, r.m2.invoiced_ht, r.diff.invoiced_ht)}${row('Achats HT', r.m1.purchases_ht, r.m2.purchases_ht, r.diff.purchases_ht)}
      ${row('Créances (rapport de fin de mois)', r.m1.report && r.m1.report.receivables, r.m2.report && r.m2.report.receivables, null)}</tbody></table><small class="muted">${esc(r.sources)}</small>`;
  };
  $('[data-rv]', page).onclick = async () => {
    const r = await api('GET', `pilot/review&date=${$('[data-rvd]', page).value}&days=${num($('[data-rvh]', page).value) || 30}`);
    if (!r.available) { $('[data-rvout]', page).innerHTML = `<div class="alert info">${esc(r.reason)}</div>`; return; }
    const e = r.explained;
    $('[data-rvout]', page).innerHTML = `<div class="pil-kv"><span>Prévu le ${fmtDate(r.target)}</span><b>${pilMoney(r.predicted)}</b><span>Réel (extraits)</span><b>${pilMoney(r.actual)}</b><span>Écart</span><b class="${r.gap < 0 ? 'late' : 'good'}">${pilMoney(r.gap)}</b>
      <span>Encaissements prévus non reçus</span><span>${pilMoney(e.encaissements_prevus_non_recus)}</span><span>Sorties prévues non réalisées</span><span>${pilMoney(e.sorties_prevues_non_realisees)}</span><span>Entrées imprévues</span><span>${pilMoney(e.entrees_imprevues)}</span><span>Sorties imprévues</span><span>${pilMoney(e.sorties_imprevues)}</span><span>Non expliqué</span><span>${pilMoney(e.reste_non_explique)}</span></div>
      <details><summary class="muted">Détail (${r.not_realized.length} prévus non réalisés, ${r.unforeseen.length} imprévus)</summary><div class="rows">${r.not_realized.map((x) => `<div class="row static"><span>${fmtDate(x.date)}</span><span class="grow">${esc(x.label)}</span><b>${pilMoney(x.amount)}</b></div>`).join('')}${r.unforeseen.map((x) => `<div class="row static"><span>${fmtDate(x.date)}</span><span class="grow">Imprévu : ${esc(x.label || x.category)}</span><b>${pilMoney(x.amount)}</b></div>`).join('')}</div></details><small class="muted">${esc(r.method)}</small>`;
  };
}

function pilAlertModal(a) {
  const m = modal(`${mhead(a.title)}<div class="m-body"><p>${badge(PIL_SEVL[a.severity][0], PIL_SEVL[a.severity][1])} ${st(PIL_ASTL, a.status)} <small class="muted">${esc(PIL_CATL[a.category] || a.category)} · ${esc(a.entity_label || '')}</small></p>
    <p>${esc(a.description || '')}</p>${a.amount != null ? `<p>Montant concerné : <b>${pilMoney(a.amount)}</b></p>` : ''}
    <div class="info">${Object.entries(a.data || {}).map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>
    <p><small class="muted">Calcul : ${esc(a.calc || '')}</small></p><p><b>Action recommandée :</b> ${esc(a.action || '')}</p>
    <div class="grid-form"><label class="field"><span>Statut</span><select name="status">${Object.entries(PIL_ASTL).map(([k, [l]]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Responsable</span><input name="owner" value="${esc(a.owner || '')}"></label><label class="field"><span>Date limite</span><input type="date" name="due" value="${esc(a.due || '')}"></label>
      <label class="field full"><span>Décision / action réalisée (conservée dans l'historique)</span><input name="note"></label></div>
    <details><summary class="muted">Historique (${a.history.length})</summary><div class="rows">${a.history.map((h) => `<div class="row static"><small>${fmtDT(h.at)} · ${h.by ? esc(userName(h.by)) : 'analyse automatique'} · ${esc(h.event)}${h.note ? ' – ' + esc(h.note) : ''}</small></div>`).join('')}</div></details>
    ${a.entity_type === 'project' ? `<a href="#/project/${a.entity_id}">Ouvrir le chantier</a>` : a.entity_type === 'invoice' ? `<a href="#/invoice/${a.entity_id}">Ouvrir la facture</a>` : a.entity_type === 'expense' ? `<a href="#/purchase/${a.entity_id}">Ouvrir l'achat</a>` : ''}
  </div><div class="m-foot"><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-save>Enregistrer</button></div>`, { wide: true });
  const F = (n) => $(`[name="${n}"]`, m.el);
  $('[data-save]', m.el).onclick = async () => { await api('PUT', `pilot/alerts/${a.id}`, { status: F('status').value, owner: F('owner').value, due: F('due').value || null, note: F('note').value }); m.close(); toast('Alerte mise à jour'); render(); };
}

async function pilAssistantPage(convId) {
  const convs = await api('GET', 'pilot/convs');
  const conv = convId ? await api('GET', `pilot/convs/${convId}`).catch(() => null) : null;
  const page = layout({ icon: 'spark', title: 'Assistant de direction', sub: 'Réponses fondées uniquement sur les données de BâtiPro et des extraits – sources, périodes et hypothèses indiquées', actions: '<a class="btn" href="#/pilotage/assistant">Nouvelle conversation</a>' });
  const EX = ['Combien d\'argent avons-nous réellement disponible ?', 'Quels sont les paiements obligatoires avant la fin du mois ?', 'Quel chantier nous coûte le plus cher actuellement ?', 'Combien avons-nous payé aux sous-traitants depuis janvier ?', 'Quels clients ont le plus de retard ?', 'Quel sera notre solde bancaire dans 30 jours ?', 'Quels sont les trois risques financiers les plus importants ?'];
  const turn = (t, i) => `<div class="pil-q">${esc(t.q)}</div><div class="pil-a">${esc(t.a).replace(/\n/g, '<br>')}<div class="pil-a-f">${pilVerif(t.check)}${t.tools && t.tools.length ? `<small class="muted">Données consultées : ${t.tools.map((x) => esc(x.outil)).join(', ')}</small>` : ''}
    ${conv ? `<button class="btn sm ghost" data-pin="${i}">${t.pinned ? '★ Réponse conservée' : '☆ Conserver cette réponse'}</button>` : ''}</div></div>`;
  page.innerHTML = `<div class="pil-chat-wrap"><aside class="card pil-convs"><b>Conversations</b>${convs.map((c) => `<a href="#/pilotage/assistant/${c.id}" class="${conv && conv.id === c.id ? 'on' : ''}">${esc(c.title)}<small class="muted">${fmtDT(c.updated_at)}</small></a>`).join('') || '<small class="muted">Aucune</small>'}</aside>
    <section class="card pil-chat"><div class="pil-turns" data-turns>${conv ? conv.turns.map(turn).join('') : `<div class="chips">${EX.map((q) => `<button class="chip" data-ex>${esc(q)}</button>`).join('')}</div>`}</div>
      <form class="pil-ask" data-nosubmit><textarea name="q" rows="2" placeholder="Posez votre question (français ou roumain)…"></textarea><button class="btn primary">Envoyer</button></form>
      <small class="muted">L'assistant ne peut ni payer ni modifier quoi que ce soit. Il ne fait pas de calcul lui-même : les montants viennent des calculs de BâtiPro, et chaque montant cité est contrôlé.</small></section></div>`;
  const form = $('.pil-ask', page);
  const send = async (q) => {
    if (!q.trim()) return;
    const box = $('[data-turns]', page); if (!conv) box.innerHTML = '';
    box.insertAdjacentHTML('beforeend', `<div class="pil-q">${esc(q)}</div><div class="pil-a muted" data-wait>Analyse des données…</div>`);
    form.q.value = ''; form.querySelector('button').disabled = true;
    try {
      const r = await api('POST', 'pilot/ask', { question: q, conv_id: conv ? conv.id : null });
      if (!conv) { location.hash = `#/pilotage/assistant/${r.conv_id}`; return; }
      render();
    } catch (e) { $('[data-wait]', page).outerHTML = `<div class="alert">${esc(e.message)}</div>`; form.querySelector('button').disabled = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(form.q.value); });
  $$('[data-ex]', page).forEach((b) => { b.onclick = () => send(b.textContent); });
  $$('[data-pin]', page).forEach((b) => { b.onclick = async () => { const i = +b.dataset.pin; await api('PUT', `pilot/convs/${conv.id}`, { index: i, pinned: !conv.turns[i].pinned }); render(); }; });
}

async function pilProjectsPage() {
  const rows = await api('GET', 'pilot/projects');
  const page = layout({ icon: 'crane', title: 'Analyse des chantiers', sub: 'Marché, facturation, encaissements, coûts facturés / engagés / payés / restants et marges – calculés par BâtiPro' });
  const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')} %`);
  page.innerHTML = `<div class="kpis">${kpi('Marché total', pilMoney(rows.reduce((a, p) => a + p.contract, 0)))}${kpi('Facturé', pilMoney(rows.reduce((a, p) => a + p.invoiced, 0)))}${kpi('Encaissé', pilMoney(rows.reduce((a, p) => a + p.cashed, 0)), { cls: 'good' })}
    ${kpi('Chantiers déficitaires', String(rows.filter((p) => p.contract > 0 && p.margin_final < 0).length), { cls: rows.some((p) => p.contract > 0 && p.margin_final < 0) ? 'late' : '' })}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), {
    rows, state: { sort: 9 }, search: (p) => [p.number, p.name, p.client].join(' '),
    filters: { def: '', options: [['', 'Tous'], ['risque', 'Marge insuffisante ou négative', '#e5484d'], ['retard', 'En retard', '#f08c00'], ['afacturer', 'À facturer', '#0c8599']], match: (p, k) => (k === 'risque' ? p.contract > 0 && p.margin_final_pct != null && p.margin_final_pct < p.margin_min_pct : k === 'retard' ? p.late_days > 0 : p.ea_to_bill > 0 || (['reception', 'termine'].includes(p.status) && p.contract - p.invoiced > 100)) },
    columns: [{ l: 'Chantier', v: (p) => `<a href="#/project/${p.id}">${esc(p.number || '')}</a> ${esc(p.name)}<br><small class="muted">${esc(p.client)}${p.manager ? ' · ' + esc(p.manager) : ''}</small>` },
      { l: 'Marché HT', cls: 'r', v: (p) => `${pilMoney(p.contract)}${p.avenants_accepted ? `<br><small class="muted">dont avenants ${pilMoney(p.avenants_accepted)}</small>` : ''}`, sort: (p) => p.contract },
      { l: 'Facturé', cls: 'r', v: (p) => `${pilMoney(p.invoiced)}<br><small class="muted">${pct(p.progress_billing)}</small>`, sort: (p) => p.invoiced },
      { l: 'Encaissé', cls: 'r', v: (p) => pilMoney(p.cashed), sort: (p) => p.cashed },
      { l: 'Coûts prévus', cls: 'r', v: (p) => pilMoney(p.cost_estimated), sort: (p) => p.cost_estimated },
      { l: 'Coûts engagés', cls: 'r', v: (p) => `${pilMoney(p.cost_engaged)}<br><small class="muted">${pct(p.progress_cost)} du prévu</small>`, sort: (p) => p.cost_engaged },
      { l: 'Payés', cls: 'r', v: (p) => pilMoney(p.cost_paid), sort: (p) => p.cost_paid },
      { l: 'Restant estimé', cls: 'r', v: (p) => (p.cost_remaining == null ? '<small class="muted">non estimable</small>' : pilMoney(p.cost_remaining)) },
      { l: 'Marge finale', cls: 'r', v: (p) => `<b class="${p.margin_final < 0 ? 'late' : p.margin_final_pct != null && p.margin_final_pct < p.margin_min_pct ? 'late' : 'good'}">${pilMoney(p.margin_final)}</b><br><small class="muted">${pct(p.margin_final_pct)}</small>`, sort: (p) => p.margin_final_pct ?? 0 },
      { l: 'Alertes', v: (p) => [p.late_days ? `retard ${p.late_days} j` : '', p.avenants_pending.length ? `${p.avenants_pending.length} avenant(s) en attente` : '', p.ea_to_bill ? 'à facturer' : ''].filter(Boolean).map((x) => `<small class="late">${esc(x)}</small>`).join('<br>') }],
    onRow: (p) => modal(`${mhead(p.name)}<div class="m-body"><div class="pil-kv">
      <span>Devis accepté (HT)</span><b>${pilMoney(p.quote_main)}</b><span>Avenants approuvés</span><b>${pilMoney(p.avenants_accepted)}</b><span>Montant contractuel</span><b>${pilMoney(p.contract)}</b>${p.contract_from_quotes ? '' : '<span></span><small class="muted">budget de la fiche chantier (aucun devis accepté)</small>'}
      <span>Facturé HT</span><span>${pilMoney(p.invoiced)}</span><span>Encaissé</span><span>${pilMoney(p.cashed)}</span><span>Reste dû par le client</span><span>${pilMoney(p.due)}</span>
      <span>Achats</span><span>${pilMoney(p.cost_purchases)}</span><span>Sous-traitance</span><span>${pilMoney(p.cost_subcontracting)}</span><span>Main-d'œuvre</span><span>${pilMoney(p.cost_labour)} <small class="muted">(${fnum(p.hours)} h)</small></span><span>Autres dépenses</span><span>${pilMoney(p.cost_other)}</span>
      <span>Coût facturé (fournisseurs)</span><span>${pilMoney(p.cost_invoiced)}</span><span>Coût engagé (+ main-d'œuvre + commandes)</span><span>${pilMoney(p.cost_engaged)}</span><span>Coût payé</span><span>${pilMoney(p.cost_paid)}</span><span>Coût estimé restant</span><span>${p.cost_remaining == null ? 'non estimable (devis sans déboursé)' : pilMoney(p.cost_remaining)}</span>
      <span>Marge prévue (devis)</span><span>${p.margin_planned == null ? '—' : pilMoney(p.margin_planned)}</span><span>Marge à date (facturé − coûts réels)</span><span>${pilMoney(p.margin_to_date)}</span><span>Rentabilité finale prévue</span><b>${pilMoney(p.margin_final)} (${pct(p.margin_final_pct)})</b></div>
      <p><small class="muted">Facturation ≠ encaissement ≠ rentabilité : le facturé est ce qui a été demandé au client, l'encaissé ce qui a été reçu, la rentabilité compare le marché aux coûts (prévus, réels et engagés). Coût payé : part payée de chaque facture fournisseur ; la main-d'œuvre est comptée au coût horaire saisi.</small></p>
      ${p.avenants_pending.length ? `<h4>Avenants en attente</h4><div class="rows">${p.avenants_pending.map((v) => `<a class="row" href="#/quote/${v.id}"><span class="grow">Avenant ${esc(v.number || '#' + v.id)} – ${v.status === 'envoye' ? 'envoyé' : 'à envoyer'}${v.age != null ? ` depuis ${v.age} j` : ''}</span><b>${pilMoney(v.amount)}</b></a>`).join('')}</div>` : ''}</div>`, { wide: true }),
    empty: 'Aucun chantier en cours',
  });
}
