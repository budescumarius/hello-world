'use strict';
/* PILOTAGE – « Où est passé l'argent ? » : l'argent encaissé sur une période, suivi jusqu'aux dépenses qui l'ont consommé
   (extraits bancaires + documents BatiPro + e-mails). Calcul du serveur, règle d'attribution affichée ; l'IA ne fait que résumer. */

async function pilTrailPage() {
  const st = ui.trail || (ui.trail = { from: `${today().slice(0, 4)}-01-01`, to: `${today().slice(0, 4)}-01-31`, until: '', mode: 'fifo', min: '', q: '' });
  const page = layout({ icon: 'search', title: 'Où est passé l\'argent ?', sub: 'Suivez l\'argent encaissé sur une période jusqu\'aux dépenses qu\'il a payées' });
  page.innerHTML = `<div class="card"><form class="grid-form pt-form" data-f>
      <label class="field"><span>Encaissements du</span><input type="date" name="from" value="${esc(st.from)}" required></label>
      <label class="field"><span>au</span><input type="date" name="to" value="${esc(st.to)}" required></label>
      <label class="field"><span>Suivre les dépenses jusqu'au</span><input type="date" name="until" value="${esc(st.until || today())}"></label>
      <label class="field"><span>Client / texte (facultatif)</span><input name="q" value="${esc(st.q)}" placeholder="ex. Dupont"></label>
      <label class="field"><span>Montant minimum (€, facultatif)</span><input name="min" inputmode="decimal" value="${esc(st.min)}" placeholder="ex. 1000"></label>
      <label class="field"><span>Règle d'attribution</span><select name="mode"><option value="fifo" ${st.mode === 'fifo' ? 'selected' : ''}>Prudente : l'argent déjà en banque part d'abord</option><option value="direct" ${st.mode === 'direct' ? 'selected' : ''}>Directe : ces encaissements paient d'abord</option></select></label>
      <div class="btns full"><button class="btn primary" type="submit">Analyser</button></div></form>
      <p class="muted sm">L'argent n'a pas d'étiquette : BatiPro applique la règle choisie, mouvement par mouvement, sur vos extraits importés (les transferts entre vos comptes ne comptent pas). Rien n'est estimé ni inventé.</p></div>
    <div data-out></div>`;
  const f = $('[data-f]', page); const out = $('[data-out]', page);
  const run = async () => {
    Object.assign(st, { from: f.from.value, to: f.to.value, until: f.until.value, mode: f.mode.value, min: f.min.value, q: f.q.value }); saveUi();
    out.innerHTML = '<p class="muted">Analyse des extraits, des documents et des e-mails…</p>';
    let r; try { r = await api('GET', `pilot/trail&from=${st.from}&to=${st.to}&until=${st.until || today()}&mode=${st.mode}&min=${encodeURIComponent(st.min || 0)}&q=${encodeURIComponent(st.q || '')}`); }
    catch (e) { out.innerHTML = `<div class="alert warn">${esc(e.message)}</div>`; return; }
    pilTrailDraw(out, r, st);
  };
  f.onsubmit = (e) => { e.preventDefault(); run(); };
  if (st.ran) run();
}
function pilTrailDraw(out, r, st) {
  st.ran = true; saveUi();
  const pct = (v) => (r.encaisse ? Math.round((v / r.encaisse) * 1000) / 10 : 0);
  const bars = (list, title) => `<div class="card"><div class="card-h"><h3>${title}</h3></div>${list.length ? list.map((g) => `<div class="pt-bar"><span class="grow">${esc(g.label)} <small class="muted">${g.n} mouvement(s)</small></span><b>${pilMoney(g.part)}</b><small class="muted">${pct(g.part)} %</small><i style="--w:${Math.max(1, pct(g.part))}%"></i></div>`).join('') : '<p class="muted">—</p>'}</div>`;
  const docLink = (d) => (!d ? '<small class="muted">aucun document</small>' : `<a href="#/${d.type === 'invoice' ? 'invoice' : 'purchase'}/${d.id}">${d.type === 'invoice' ? 'Facture' : 'Achat'} ${esc(d.ref || '')}</a>${d.tiers ? ` <small>${esc(d.tiers)}</small>` : ''}${d.sure ? '' : ' <small class="muted" title="Même montant à ±30 jours, pas encore rapproché">(probable)</small>'}`);
  out.innerHTML = `${(r.avertissements || []).map((w) => `<div class="alert warn">${esc(w)}</div>`).join('')}
    <div class="kpis">${kpi('Encaissé sur la période', pilMoney(r.encaisse), { sub: `${r.encaissements.length} encaissement(s) · ${pil_d_js(r.periode.du)} → ${pil_d_js(r.periode.au)}` })}${kpi('Dépensé à ce jour', pilMoney(r.depense), { sub: `${pct(r.depense)} % · jusqu'au ${pil_d_js(r.periode.suivi_jusqu_au)}` })}${kpi('Encore en banque', pilMoney(r.reste), { cls: 'good', sub: `${pct(r.reste)} %` })}${kpi('Solde avant la période', pilMoney(r.solde_avant), { sub: r.methode === 'fifo' ? 'dépensé en premier (règle prudente)' : 'utilisé après les encaissements' })}</div>
    <div class="btns pt-acts"><button class="btn" data-csv>${I.download} Exporter (CSV)</button>${S.ai ? '<button class="btn" data-ai>Résumé de direction (IA)</button>' : ''}</div><div data-aitxt></div>
    <div class="pt-grid">${bars(r.par_categorie, 'Par nature de dépense')}${bars(r.par_chantier, 'Par chantier')}${bars(r.par_tiers.slice(0, 12), 'Principaux fournisseurs / bénéficiaires')}${bars(r.par_mois, 'Par mois')}</div>
    <div class="card"><div class="card-h"><h3>Dépenses payées avec cet argent (${r.depenses.length})</h3><span class="muted">les plus importantes d'abord</span></div><div class="pil-tx-wrap"><table class="dt"><thead><tr><th>Date</th><th>Bénéficiaire</th><th>Nature</th><th>Document BatiPro</th><th>Chantier</th><th class="r">Payé avec cet argent</th><th>E-mails liés</th></tr></thead><tbody>
      ${r.depenses.map((x) => `<tr><td class="nowrap">${pil_d_js(x.date)}</td><td><b>${esc(x.cp || '—')}</b><br><small class="muted">${esc(x.communication || '')}</small></td><td>${esc(x.category_label)}${x.status === 'a_verifier' ? ' <small class="muted">(à vérifier)</small>' : ''}</td><td>${docLink(x.doc)}</td><td>${x.project_id ? `<a href="#/project/${x.project_id}">${esc(x.project)}</a>` : '<small class="muted">—</small>'}</td><td class="r nowrap"><b>${pilMoney(x.part)}</b>${x.part !== x.amount ? `<br><small class="muted">sur ${pilMoney(x.amount)}</small>` : ''}</td>
        <td>${(x.mails || []).map((m) => `<button type="button" class="pt-mail" data-mail="${m.id}" title="${esc(m.from || '')}">✉ ${esc((m.subject || '(sans objet)').slice(0, 40))} <small class="muted">${pil_d_js(String(m.at).slice(0, 10))}</small></button>`).join('') || '<small class="muted">—</small>'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune dépense attribuée : l\'argent est encore en banque, ou aucun extrait ne couvre la suite.</td></tr>'}</tbody></table></div></div>
    <details class="card"><summary><b>Encaissements suivis (${r.encaissements.length})</b></summary><table class="dt"><thead><tr><th>Date</th><th>De</th><th>Compte</th><th class="r">Montant</th></tr></thead><tbody>${r.encaissements.map((t) => `<tr><td>${pil_d_js(t.date)}</td><td><b>${esc(t.cp || '—')}</b><br><small class="muted">${esc(t.communication || '')}</small></td><td>${esc(t.account)}</td><td class="r">${pilMoney(t.amount)}</td></tr>`).join('')}</tbody></table></details>
    <p class="muted sm">Méthode : ${esc(r._methode)}. Source : ${esc(r._source)}.</p>`;
  $$('[data-mail]', out).forEach((b) => { b.onclick = () => pilMailOpen(+b.dataset.mail, []); });
  $('[data-csv]', out).onclick = () => {
    const rows = [['Date', 'Bénéficiaire', 'Communication', 'Nature', 'Document', 'Chantier', 'Montant du paiement', 'Payé avec l\'argent suivi'], ...r.depenses.map((x) => [x.date, x.cp, x.communication, x.category_label, x.doc ? `${x.doc.type === 'invoice' ? 'Facture' : 'Achat'} ${x.doc.ref}${x.doc.sure ? '' : ' (probable)'}` : '', x.project || '', (x.amount / 100).toFixed(2).replace('.', ','), (x.part / 100).toFixed(2).replace('.', ',')])];
    const csv = '﻿' + rows.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `ou-est-passe-l-argent-${r.periode.du}-${r.periode.au}.csv`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  const ai = $('[data-ai]', out); if (ai) ai.onclick = async () => {
    ai.disabled = true; const box = $('[data-aitxt]', out); box.innerHTML = '<p class="muted">Rédaction du résumé…</p>';
    try { const x = await api('POST', 'pilot/trail/ai', { from: st.from, to: st.to, until: st.until || today(), mode: st.mode, min: st.min || 0, q: st.q || '' });
      box.innerHTML = `<div class="card"><div class="card-h"><h3>Résumé de direction</h3>${x.verification.ok ? badge('Montants vérifiés', '#2f9e44') : badge('Montant(s) à vérifier', '#e5484d')}</div><div class="pre">${esc(x.texte)}</div>${x.verification.ok ? '' : `<p class="late">Montant(s) absent(s) du calcul : ${x.verification.unverified.map(esc).join(', ')}</p>`}</div>`; }
    catch (e) { box.innerHTML = `<div class="alert warn">${esc(e.message)}</div>`; } finally { ai.disabled = false; }
  };
}
const pil_d_js = (d) => (d ? fmtDate(String(d).slice(0, 10)) : '—');
