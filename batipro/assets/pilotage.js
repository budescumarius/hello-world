'use strict';
/* PILOTAGE MADIBU – étape 2 : extraits bancaires importés à la main (Europabank en CODA, Belfius et BNP Paribas Fortis en PDF).
   Aucune connexion à une banque, aucun paiement possible depuis ce module. Réservé aux administrateurs, activé par firme.
   Les montants arrivent du serveur en CENTIMES entiers. */

const pilOn = () => isAdmin() && !!(S.settings.pilotage && S.settings.pilotage.enabled);
SPACES.push({ k: 'pilot', l: 'Pilotage', i: 'chart', h: '#/pilotage', show: pilOn,
  sec: [['Contrôle', '#/pilotage'], ['Mouvements', '#/pilotage/mouvements'], ['Historique 24 mois', '#/pilotage/historique'], ['Importer un extrait', '#/pilotage/import'], ['Journal des imports', '#/pilotage/imports'], ['Comptes', '#/pilotage/comptes']] });

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
  const pages = { mouvements: pilTxPage, historique: pilHistPage, import: pilImportPage, imports: pilImportsPage, comptes: pilAccountsPage };
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
  $('[data-add]', page).onclick = () => formModal({ title: 'Nouveau compte bancaire', fields: [{ name: 'iban', label: 'IBAN', required: true, placeholder: 'BE00 0000 0000 0000' }, { name: 'label', label: 'Nom (ex. Compte courant)' }, { name: 'bank', label: 'Banque', hint: 'Déduite de l\'IBAN si vide' }],
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
        if (!confirm(`Annuler l'import « ${i.filename} » ?\n\nSes ${i.tx_new} mouvement(s) seront retirés (avec leurs classements et rapprochements). Le journal et le fichier original sont conservés.`)) return;
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
    box.innerHTML = `<div class="alert ok">Rapproché avec ${t.match_type === 'invoice' ? 'la facture' : 'l\'achat'} <a href="${href({ type: t.match_type, id: t.match_id })}">n° ${t.match_id}</a> (${fmtDT(t.match_at)}, ${esc(userName(t.match_by))}). <button class="btn sm" data-unmatch>Retirer</button></div>`;
    $('[data-unmatch]', box).onclick = async () => { await api('PUT', `pilot/tx/${t.id}`, { match: null }); m.close(); render(); };
    return;
  }
  if (t.category === 'transfert_interne') { box.innerHTML = '<p class="muted">Transfert entre vos comptes : pas de rapprochement.</p>'; return; }
  try {
    const sug = await api('GET', `pilot/tx/${t.id}/suggest`);
    box.innerHTML = sug.length ? `<div class="rows">${sug.map((x, i) => `<div class="row static"><span class="grow"><a href="${href(x)}">${x.type === 'invoice' ? 'Facture' : 'Achat'} ${esc(x.ref || '#' + x.id)}</a> · ${fmtDate(x.date)} · total ${pilMoney(x.total)} · reste ${pilMoney(x.rest)}<br><small class="muted">${badge(x.level, x.level === 'sûr' ? '#2f9e44' : '#f08c00')} ${esc(x.why.join(', '))}</small></span><button class="btn sm" data-m="${i}">Rapprocher</button></div>`).join('')}</div>
      <small class="muted">Le rapprochement relie le mouvement au document ; il n'enregistre pas de paiement dans la facture ou l'achat.</small>`
      : '<p class="muted">Aucune facture ni aucun achat correspondant (communication structurée, montant, IBAN).</p>';
    $$('[data-m]', box).forEach((b) => { b.onclick = async () => { const x = sug[+b.dataset.m]; await api('PUT', `pilot/tx/${t.id}`, { match: { type: x.type, id: x.id } }); m.close(); toast('Rapprochement enregistré'); render(); }; });
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
