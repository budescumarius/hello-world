'use strict';
/* PILOTAGE – Briefing e-mails : boîtes Outlook (Microsoft 365) de l'utilisateur, triées et préparées par l'IA.
   L'IA prépare (catégorie, urgence, action, chantier, brouillon) ; rien ne part sans relecture et clic « Envoyer » de l'utilisateur. */

const PIL_MCAT = { client: ['Client', '#3b5bdb'], fournisseur: ['Fournisseur', '#0c8599'], architecte: ['Architecte / BE', '#7048e8'], administration: ['Administration', '#e8590c'], banque: ['Banque / assurance', '#5c940d'], interne: ['Interne', '#868e96'], publicite: ['Publicité', '#adb5bd'], autre: ['Autre', '#868e96'] };
const PIL_MURG = { haute: ['Urgent', '#e5484d'], normale: ['Normal', '#f08c00'], basse: ['Faible', '#868e96'] };
const pilRcptTxt = (l) => (l || []).map((r) => r.email).join(', ');
const pilRcptParse = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean).map((email) => ({ email }));

async function pilMailPage() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('connected')) { toast(`Boîte ${q.get('connected')} connectée : première relève en cours…`, 4000); history.replaceState(null, '', '#/pilotage/emails'); setTimeout(() => pilMailSync(), 300); }
  if (q.get('err')) { toast(q.get('err'), 8000); history.replaceState(null, '', '#/pilotage/emails'); }
  const [b, projects] = await Promise.all([api('GET', 'pilot/mail/brief'), db.list('project').catch(() => [])]);
  const page = layout({ icon: 'mail', title: 'Briefing e-mails', sub: 'Vos boîtes Outlook triées chaque 25 minutes · rien ne part sans votre relecture',
    actions: b.accounts.length ? '<button class="btn" data-sync>Relever maintenant</button>' : '' });
  const pname = (id) => { const p = byId(projects, id); return p ? p.data.name : ''; };
  const c = b.counts;
  const card = (m) => { const a = m.analysis || {}; const cat = PIL_MCAT[a.categorie] || PIL_MCAT.autre; const u = PIL_MURG[a.urgence] || PIL_MURG.normale;
    return `<div class="pil-mail" data-m="${m.id}"><div class="pil-mail-h"><i class="dot" style="--c:${u[1]}" title="${u[0]}"></i><b class="grow">${esc(m.from_name || m.from_email)}</b>${badge(cat[0], cat[1])}<small class="muted">${fmtDT(m.at)}</small></div>
      <div class="pil-mail-s">${esc(m.subject || '(sans objet)')}</div>
      ${a.resume ? `<div class="muted">${esc(a.resume)}</div>` : `<div class="muted">${esc(m.preview || '')}</div>`}
      ${a.action ? `<div class="pil-mail-a">➜ ${esc(a.action)}${a.echeance ? ` <b class="${a.echeance <= today() ? 'late' : ''}">avant le ${fmtDate(a.echeance)}</b>` : ''}</div>` : ''}
      ${a.pieces ? `<div class="pil-mail-p">📎 ${esc(a.pieces)}</div>` : (m.atts || []).length ? `<div class="pil-mail-p">📎 ${m.atts.map((x) => esc(x.name)).join(', ')}</div>` : ''}
      ${m.project_id ? `<div><a href="#/project/${m.project_id}">🏗 ${esc(pname(m.project_id))}</a></div>` : ''}
      ${(a.non_verifie || []).length ? `<div class="late">⚠ Montant à vérifier : ${a.non_verifie.map(esc).join(', ')}</div>` : ''}
      <div class="btns"><button class="btn sm" data-open="${m.id}">Lire</button>${m.state === 'a_faire' || m.state === 'nouveau' ? `<button class="btn sm" data-reply="${m.id}">Répondre</button><button class="btn sm good" data-done="${m.id}">✓ Fait</button><button class="btn sm ghost" data-ign="${m.id}">Ignorer</button>` : ''}${m.web_link ? `<a class="btn sm ghost" href="${esc(m.web_link)}" target="_blank" rel="noopener">Outlook ↗</a>` : ''}</div></div>`; };
  const draftCard = (d) => `<div class="pil-mail draft" data-d="${d.id}"><div class="pil-mail-h"><b class="grow">À : ${esc(pilRcptTxt(d.to))}</b>${d.origin === 'ia' ? badge('Préparé par l\'IA', '#7048e8') : badge('Votre brouillon', '#3b5bdb')}</div>
      <div class="pil-mail-s">${esc(d.subject)}</div><div class="muted pil-mail-body">${esc((d.body || '').slice(0, 240))}${(d.body || '').length > 240 ? '…' : ''}</div>
      ${(d.check.non_verifie || []).length ? `<div class="late">⚠ Montant à vérifier : ${d.check.non_verifie.map(esc).join(', ')}</div>` : ''}
      <div class="btns"><button class="btn sm primary" data-edit="${d.id}">Relire et envoyer…</button><button class="btn sm ghost" data-rej="${d.id}">Supprimer</button></div></div>`;
  const accs = b.accounts.map((a) => `<span class="chip ${a.status === 'ok' ? '' : 'bad'}" title="${esc(a.last_error || '')}">✉ ${esc(a.email)}${a.status !== 'ok' ? ' · à reconnecter' : a.last_sync ? ` · ${fmtDT(a.last_sync)}` : ''} <button class="icon-btn sm" data-acc="${a.id}" aria-label="Options">${I.more}</button></span>`).join('');
  page.innerHTML = `${!b.configured ? (pilCan('settings.write') ? '<div data-conf></div>' : '<div class="alert warn">La connexion Outlook n\'est pas encore configurée : le propriétaire doit enregistrer l\'application Microsoft (cette page, en étant propriétaire).</div>') : ''}
    <div class="card"><div class="card-h"><h3>Boîtes connectées</h3>${b.configured ? '<button class="btn sm primary" data-connect>+ Connecter une boîte Outlook</button>' : ''}</div>
      <div class="chips">${accs || '<span class="muted">Aucune boîte : connectez vos boîtes Outlook (une par une, avec « Se connecter avec Microsoft »). Chacune n\'est visible que par vous.</span>'}</div>
      ${!b.ai && b.accounts.length ? '<p class="muted">Assistant IA non configuré : les e-mails sont relevés mais pas triés (Paramètres → Assistant IA).</p>' : ''}</div>
    ${b.accounts.length ? `<div class="kpis">${kpi('À faire', c.todo, { cls: c.urgent ? 'bad' : '', sub: c.urgent ? `dont ${c.urgent} urgent(s)` : '' })}${kpi('Sans réponse > 2 jours', c.waiting, { cls: c.waiting ? 'bad' : '' })}${kpi('Réponses préparées', c.drafts, { sub: 'à relire avant envoi' })}${kpi('Pour info', c.info)}</div>
    <div class="card"><div class="card-h"><h3>À faire</h3><span class="muted">urgent d'abord, puis par échéance</span></div><div class="pil-mails">${b.todo.map(card).join('') || '<p class="muted">Rien à faire. 👍</p>'}</div></div>
    <div class="card"><div class="card-h"><h3>Réponses préparées – à relire</h3><span class="muted">rien ne part sans votre clic « Envoyer »</span></div><div class="pil-mails">${b.drafts.map(draftCard).join('') || '<p class="muted">Aucune réponse en attente.</p>'}</div></div>
    ${(b.new || []).length ? `<div class="card"><div class="card-h"><h3>Pas encore triés (${b.new.length})</h3></div><div class="pil-mails">${b.new.map(card).join('')}</div></div>` : ''}
    <details class="card"><summary><b>Pour info (${c.info})</b> <span class="muted">publicités, notifications, informations sans action</span></summary><div class="pil-mails">${b.info.map(card).join('')}</div></details>` : ''}`;
  const conf = $('[data-conf]', page); if (conf) pilMailConfig(conf);
  const sy = $('[data-sync]', page); if (sy) sy.onclick = () => pilMailSync(sy);
  const cn = $('[data-connect]', page); if (cn) cn.onclick = async () => { const r = await api('POST', 'pilot/mail/connect'); location.href = r.url; };
  $$('[data-acc]', page).forEach((x) => { x.onclick = () => { const a = b.accounts.find((y) => y.id === +x.dataset.acc); menuSheet(a.email, [
    { label: 'Reconnecter (Microsoft)', icon: 'key', run: async () => { const r = await api('POST', 'pilot/mail/connect'); location.href = r.url; } },
    { label: 'Relire les 14 derniers jours', icon: 'download', run: () => pilMailSync(null, true) },
    { label: 'Déconnecter cette boîte', icon: 'trash', danger: true, run: async () => { if (!confirm(`Déconnecter ${a.email} ? Les e-mails relevés et les brouillons de cette boîte sont effacés de BatiPro (rien n'est effacé dans Outlook).`)) return; await api('DELETE', `pilot/mail/accounts/${a.id}`); toast('Boîte déconnectée'); render(); } },
  ]); }; });
  const all = [...b.todo, ...(b.new || []), ...b.info];
  $$('[data-open]', page).forEach((x) => { x.onclick = () => pilMailOpen(+x.dataset.open, projects); });
  $$('[data-done]', page).forEach((x) => { x.onclick = async () => { await api('PUT', `pilot/mail/msgs/${x.dataset.done}`, { state: 'fait' }); toast('Marqué fait'); render(); }; });
  $$('[data-ign]', page).forEach((x) => { x.onclick = async () => { await api('PUT', `pilot/mail/msgs/${x.dataset.ign}`, { state: 'ignore' }); render(); }; });
  $$('[data-reply]', page).forEach((x) => { x.onclick = async () => { const d = await api('POST', `pilot/mail/msgs/${x.dataset.reply}/draft`); pilDraftEdit(d, all.find((m) => m.id === +x.dataset.reply), b.accounts); }; });
  $$('[data-edit]', page).forEach((x) => { x.onclick = () => { const d = b.drafts.find((y) => y.id === +x.dataset.edit); pilDraftEdit(d, all.find((m) => m.id === d.msg_id), b.accounts); }; });
  $$('[data-rej]', page).forEach((x) => { x.onclick = async () => { if (!confirm('Supprimer ce brouillon ? (rien n\'a été envoyé)')) return; await api('POST', `pilot/mail/drafts/${x.dataset.rej}/reject`); render(); }; });
}
async function pilMailSync(btn, deep = false) {
  if (btn) { btn.disabled = true; btn.textContent = 'Relève en cours…'; }
  toast('Relève et tri des e-mails… (jusqu\'à une minute)', 60000);
  try { const r = await api('POST', 'pilot/mail/sync', { deep }); const n = r.results.reduce((a, x) => a + x.new, 0); toast(`${n} nouvel(s) e-mail(s)${r.results.some((x) => x.analyzed) ? ` · ${r.results.reduce((a, x) => a + (x.analyzed || 0), 0)} trié(s) par l'IA` : ''}${r.errors.length ? ` · ${r.errors.join(' · ')}` : ''}`, r.errors.length ? 8000 : 3500); }
  catch (e) { toast(e.message, 7000); }
  render();
}
// lecture complète d'un e-mail
async function pilMailOpen(id, projects) {
  const m = await api('GET', `pilot/mail/msgs/${id}`); const a = m.analysis || {};
  const md = modal(`${mhead(m.subject || '(sans objet)')}<div class="m-body">
    <p><b>${esc(m.from_name || '')}</b> &lt;${esc(m.from_email || '')}&gt; · ${fmtDT(m.at)}<br><small class="muted">À : ${esc(pilRcptTxt(m.to))}</small></p>
    ${a.resume ? `<div class="alert info"><b>Résumé :</b> ${esc(a.resume)}${a.action ? `<br><b>À faire :</b> ${esc(a.action)}` : ''}${a.pieces ? `<br><b>Pièces jointes :</b> ${esc(a.pieces)}` : ''}</div>` : ''}
    ${(m.atts || []).length ? `<p>📎 ${m.atts.map((x) => esc(x.name)).join(' · ')} <small class="muted">(à ouvrir dans Outlook)</small></p>` : ''}
    <div class="pre pil-mail-full">${esc(m.body || m.preview || '')}</div>
    <label class="field"><span>Chantier</span><select data-p><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === m.project_id ? 'selected' : ''}>${esc(p.data.name)}</option>`).join('')}</select></label></div>
    <div class="m-foot">${m.web_link ? `<a class="btn ghost" href="${esc(m.web_link)}" target="_blank" rel="noopener">Ouvrir dans Outlook ↗</a>` : ''}<span class="grow"></span><button class="btn" data-done>✓ Fait</button><button class="btn primary" data-reply>Répondre</button></div>`, { wide: true });
  $('[data-p]', md.el).onchange = async (e) => { await api('PUT', `pilot/mail/msgs/${id}`, { state: m.state === 'nouveau' ? 'a_faire' : m.state === 'repondu' ? 'fait' : m.state, project_id: e.target.value ? +e.target.value : null }); toast('Chantier enregistré'); };
  $('[data-done]', md.el).onclick = async () => { await api('PUT', `pilot/mail/msgs/${id}`, { state: 'fait' }); md.close(); render(); };
  $('[data-reply]', md.el).onclick = async () => { const d = (m.drafts || []).find((x) => x.status === 'brouillon') || await api('POST', `pilot/mail/msgs/${id}/draft`); md.close(); pilDraftEdit(d, m, null); };
}
// relecture d'un brouillon, puis envoi CONFIRMÉ par l'utilisateur
function pilDraftEdit(d, msg, accounts) {
  const acc = (accounts || []).find((x) => x.id === d.account_id);
  const md = modal(`${mhead(d.origin === 'ia' ? 'Réponse préparée par l\'IA – à relire' : 'Votre réponse')}<form class="m-body">
    ${d.origin === 'ia' ? '<div class="alert warn">Relisez et corrigez si besoin : l\'IA ne connaît que l\'e-mail reçu. Rien n\'est envoyé tant que vous ne confirmez pas.</div>' : ''}
    ${(d.check.non_verifie || []).length ? `<div class="alert warn">⚠ Montant(s) cité(s) qui ne figurent pas dans l'e-mail reçu : <b>${d.check.non_verifie.map(esc).join(', ')}</b> – vérifiez-les.</div>` : ''}
    ${msg ? `<details><summary class="muted">E-mail reçu : ${esc(msg.subject || '')}</summary><div class="pre pil-mail-full">${esc(msg.body || msg.preview || '')}</div></details>` : ''}
    <label class="field full"><span>À</span><input name="to" value="${esc(pilRcptTxt(d.to))}"></label>
    <label class="field full"><span>Cc</span><input name="cc" value="${esc(pilRcptTxt(d.cc))}"></label>
    <label class="field full"><span>Objet</span><input name="subject" value="${esc(d.subject)}"></label>
    <label class="field full"><span>Message</span><textarea name="body" rows="12">${esc(d.body)}</textarea></label>
    <div class="pil-confirm" data-conf hidden></div></form>
    <div class="m-foot"><button class="btn ghost" data-save>Enregistrer le brouillon</button><span class="grow"></span><button class="btn" data-close>Fermer</button><button class="btn primary" data-send>Envoyer…</button></div>`, { wide: true });
  const f = $('form', md.el);
  const val = () => ({ to: pilRcptParse(f.to.value), cc: pilRcptParse(f.cc.value), subject: f.subject.value, body: f.body.value });
  $('[data-save]', md.el).onclick = async () => { await api('PUT', `pilot/mail/drafts/${d.id}`, val()); toast('Brouillon enregistré (non envoyé)'); md.close(); render(); };
  $('[data-send]', md.el).onclick = () => {
    const v = val(); if (!v.to.length) return toast('Ajoutez un destinataire');
    const box = $('[data-conf]', md.el); box.hidden = false;
    box.innerHTML = `<div class="alert info"><b>Envoyer maintenant${acc ? ` depuis ${esc(acc.email)}` : ''} ?</b><br>À : ${esc(pilRcptTxt(v.to))}${v.cc.length ? ` · Cc : ${esc(pilRcptTxt(v.cc))}` : ''}<br>Objet : ${esc(v.subject)}
      <div class="btns"><button type="button" class="btn primary" data-yes>Oui, envoyer</button><button type="button" class="btn" data-no>Non, revenir</button></div></div>`;
    box.scrollIntoView({ block: 'nearest' });
    $('[data-no]', box).onclick = () => { box.hidden = true; };
    $('[data-yes]', box).onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api('POST', `pilot/mail/drafts/${d.id}/send`, { ...val(), confirm: true }); md.close(); toast(r.note || 'E-mail envoyé', 4000); render(); }
      catch (err) { e.target.disabled = false; toast(err.message, 7000); }
    };
  };
}
// configuration de l'application Microsoft (propriétaire), avec la marche à suivre
async function pilMailConfig(box) {
  const c = await api('GET', 'pilot/mail/config');
  box.innerHTML = `<div class="card"><div class="card-h"><h3>Configurer la connexion Outlook (une seule fois)</h3></div>
    <ol class="steps"><li>Ouvrez <b>entra.microsoft.com</b> avec un compte administrateur Microsoft 365 de l'entreprise → <b>Applications</b> → <b>Inscriptions d'applications</b> → <b>Nouvelle inscription</b>.</li>
      <li>Nom : <b>BatiPro</b> · Types de comptes : <b>Comptes dans cet annuaire d'organisation uniquement</b>.</li>
      <li>URI de redirection : <b>Web</b> → collez exactement : <code class="pil-copy" data-copy>${esc(c.redirect)}</code></li>
      <li>Après création : copiez <b>ID d'application (client)</b> et <b>ID de l'annuaire (locataire)</b> ci-dessous.</li>
      <li><b>Certificats et secrets</b> → <b>Nouveau secret client</b> (24 mois) → copiez la <b>Valeur</b> ci-dessous.</li>
      <li><b>Autorisations des API</b> → Microsoft Graph → <b>Autorisations déléguées</b> : <b>Mail.Read</b>, <b>Mail.Send</b>, <b>User.Read</b>, <b>offline_access</b> → <b>Accorder un consentement d'administrateur</b>.</li></ol>
    <div class="grid-form"><label class="field"><span>ID d'application (client)</span><input name="clientId" value="${esc(c.clientId)}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"></label>
      <label class="field"><span>ID de l'annuaire (locataire)</span><input name="tenant" value="${esc(c.tenant)}" placeholder="xxxxxxxx-… ou madibugroup.be"></label>
      <label class="field full"><span>Secret client (valeur)</span><input name="secret" type="password" placeholder="${c.hasSecret ? '•••••••• (enregistré – laisser vide pour le garder)' : ''}" autocomplete="off"></label></div>
    <div class="btns"><button class="btn primary" data-saveconf>Enregistrer</button></div>
    <p class="muted">Le secret est chiffré. Chaque utilisateur connecte ensuite ses propres boîtes avec « Se connecter avec Microsoft » (aucun mot de passe n'est donné à BatiPro).</p></div>`;
  const cp = $('[data-copy]', box); cp.onclick = () => { navigator.clipboard.writeText(c.redirect).then(() => toast('Adresse copiée')).catch(() => {}); };
  $('[data-saveconf]', box).onclick = async () => { await api('PUT', 'pilot/mail/config', { clientId: $('[name=clientId]', box).value, tenant: $('[name=tenant]', box).value, secret: $('[name=secret]', box).value }); toast('Connexion Outlook configurée'); render(); };
}
