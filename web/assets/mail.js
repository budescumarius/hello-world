// ---------------------------------------------------------------- Envoi par email depuis l'application (PDF du document en pièce jointe)
// recipients : [{ name, email, role, group, checked, contact }] — `contact` permet d'enregistrer un email saisi sur la fiche
function sendMailDialog({ subject, body, recipients = [], ref = {}, projectId, pdfName, onSent }) {
  const rcpts = [];
  recipients.forEach((r) => { if (!rcpts.some((x) => x.email && r.email && x.email.toLowerCase() === r.email.toLowerCase()) && !rcpts.some((x) => x.contact && r.contact && x.contact.id === r.contact.id)) rcpts.push({ ...r }); });
  const groups = [...new Set(rcpts.map((r) => r.group || 'Destinataires'))];
  const row = (r, i) => `<div class="rcpt"><label class="chk"><input type="checkbox" data-r="${i}" ${r.checked && r.email ? 'checked' : ''}>
      <span class="grow"><b>${esc(r.name || r.email)}</b>${r.role ? ` <small class="muted">${esc(r.role)}</small>` : ''}${r.email ? `<br><small class="muted">${esc(r.email)}</small>` : ''}</span></label>
      ${r.email ? '' : `<input type="email" inputmode="email" data-re="${i}" placeholder="Email (pas d'adresse sur la fiche)" autocomplete="off">`}</div>`;
  const m = modal(`${mhead('Envoyer par email')}<form class="m-body mail-form">
    ${groups.map((g) => `<div class="section-t">${esc(g)}</div>${rcpts.map((r, i) => ((r.group || 'Destinataires') === g ? row(r, i) : '')).join('')}`).join('') || '<p class="muted">Aucun destinataire proposé : saisissez les adresses ci-dessous.</p>'}
    <label class="field full"><span>Autres destinataires</span><input name="others" type="text" inputmode="email" placeholder="adresse1@exemple.be, adresse2@exemple.be" autocomplete="off"></label>
    <label class="field chk"><input type="checkbox" name="copy" checked><span>M'envoyer une copie (${esc(S.me.email)})</span></label>
    <label class="field full"><span>Objet *</span><input name="subject" type="text" value="${esc(subject)}"></label>
    <label class="field full"><span>Message</span><textarea name="body" rows="9">${esc(body)}</textarea></label>
    ${pdfName ? `<label class="field chk"><input type="checkbox" name="pdf" checked><span>Joindre le PDF (${esc(pdfName)})</span></label>` : ''}
    <button type="submit" hidden></button></form>
    <div class="m-foot"><small class="muted" data-cnt></small><span class="grow"></span><button class="btn" data-close>Annuler</button><button class="btn primary" data-send>${I.mail} Envoyer</button></div>`, { wide: true });
  const form = $('form', m.el);
  const isMail = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s);
  const collect = () => {
    const to = [];
    $$('[data-r]', form).forEach((cb) => {
      const r = rcpts[+cb.dataset.r]; const inp = $(`[data-re="${cb.dataset.r}"]`, form);
      const email = (r.email || (inp ? inp.value.trim() : '')).toLowerCase();
      if (cb.checked && email) to.push({ email, name: r.name || '', r, typed: !r.email });
    });
    form.others.value.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((email) => to.push({ email, name: '' }));
    return to;
  };
  const count = () => { const n = collect().length; $('[data-cnt]', m.el).textContent = n ? `${n} destinataire${n > 1 ? 's' : ''}` : 'Aucun destinataire'; };
  $$('[data-re]', form).forEach((inp) => { inp.oninput = () => { const cb = $(`[data-r="${inp.dataset.re}"]`, form); cb.checked = isMail(inp.value.trim()); count(); }; });
  form.addEventListener('change', count); form.others.oninput = count; count();
  $$('[data-close]', m.el).forEach((b) => { b.onclick = () => m.close(); });
  const send = async () => {
    const to = collect();
    const bad = to.find((x) => !isMail(x.email));
    if (bad) return toast(`Adresse email invalide : ${bad.email}`, 4000);
    if (!to.length) return toast('Choisissez au moins un destinataire');
    const subj = form.subject.value.trim();
    if (!subj) return toast('Objet manquant');
    const btn = $('[data-send]', m.el); btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const fd = new FormData();
      fd.append('to', JSON.stringify(to.map(({ email, name }) => ({ email, name }))));
      fd.append('cc', JSON.stringify(form.copy.checked ? [{ email: S.me.email, name: S.me.name }] : []));
      fd.append('subject', subj); fd.append('body', form.body.value);
      if (ref.type) fd.append('ref_type', ref.type);
      if (ref.id) fd.append('ref_id', ref.id);
      if (projectId) fd.append('project_id', projectId);
      if (pdfName && form.pdf.checked) fd.append('att', new File([await makePdf()], pdfName, { type: 'application/pdf' }));
      const r = await api('POST', 'mail', fd);
      // adresse saisie pour un contact sans email : enregistrée sur sa fiche
      for (const x of to) if (x.typed && x.r.contact) { x.r.contact.data.email = x.email; persist('contact', x.r.contact).catch(() => {}); }
      m.close();
      toast(`Email envoyé à ${to.length} destinataire${to.length > 1 ? 's' : ''}${r.sent > to.length ? ' (+ copie)' : ''}`, 3500);
      if (onSent) onSent(to.map((x) => x.email));
    } catch (e) {
      toast(e.message, 7000);
    } finally { btn.disabled = false; btn.innerHTML = `${I.mail} Envoyer`; }
  };
  $('[data-send]', m.el).onclick = send;
  form.onsubmit = (e) => { e.preventDefault(); send(); };
  return m;
}
const contactRcpt = (c, group, checked, role) => ({ name: contactName(c), email: (c.data.email || '').trim(), role: role || [CONTACT_KINDS[c.data.kind], c.data.trade].filter(Boolean).join(' · '), group, checked, contact: c });
const userRcpt = (u, group, checked) => ({ name: u.name, email: u.email, role: 'Notre équipe', group, checked });
const mailSign = () => `Cordialement,\n${S.me.name}\n${company().name || ''}${company().phone ? '\n' + company().phone : ''}`;
const sentLine = (d) => ((d.sent || []).length ? `Envoyé le ${fmtDT(d.sent[d.sent.length - 1].t)} à ${d.sent[d.sent.length - 1].to.length} destinataire(s)` : '');

// ---------------------------------------------------------------- Paramètres › Email
function mailSettings(page) {
  const s = (S.settings.smtp && typeof S.settings.smtp === 'object') ? S.settings.smtp : {};
  const fields = [
    { name: 'host', label: 'Serveur SMTP', placeholder: 'mail.mondomaine.be', hint: 'Laisser vide pour utiliser la fonction mail() de l\'hébergement' },
    { name: 'port', label: 'Port', type: 'number', placeholder: '465' },
    { name: 'secure', label: 'Sécurité', type: 'select', options: [['ssl', 'SSL (port 465)'], ['tls', 'STARTTLS (port 587)'], ['none', 'Aucune']] },
    { name: 'user', label: 'Identifiant (adresse email complète)', placeholder: 'chantier@mondomaine.be' },
    { name: 'pass', label: 'Mot de passe', type: 'password', placeholder: s.hasPass ? '•••••••• (inchangé)' : '' },
    { name: 'from', label: 'Adresse d\'expédition', placeholder: 'chantier@mondomaine.be', hint: 'Doit appartenir à votre domaine' },
    { name: 'fromName', label: 'Nom de l\'expéditeur', placeholder: company().name || '' },
  ];
  page.innerHTML = `<div class="card"><div class="card-h"><h3>Envoi des emails</h3><button class="btn sm" data-test>${I.mail} Envoyer un test</button></div>
    <form>${fieldsGrid(fields, { ...s, pass: '', secure: s.secure || 'ssl', port: s.port || '' })}<div class="btns"><button class="btn primary" type="submit">Enregistrer</button></div></form></div>
    <div class="card"><div class="card-h"><h3>Conseils</h3></div><ol class="steps">
      <li>Dans cPanel › <b>Comptes de messagerie</b>, créez une adresse (ex. <b>chantier@votredomaine.be</b>).</li>
      <li>« Configurer le client de messagerie » indique le serveur sortant : en général <b>mail.votredomaine.be</b>, port <b>465</b> (SSL).</li>
      <li>Saisissez ici ce serveur, l'adresse complète comme identifiant et son mot de passe, puis cliquez « Envoyer un test ».</li>
      <li>Les réponses des destinataires arrivent directement chez l'utilisateur qui a envoyé (Reply-To).</li>
      <li>Sans serveur SMTP, l'application utilise la fonction mail() de l'hébergement : cela fonctionne souvent, mais les messages risquent davantage d'arriver dans les indésirables.</li>
    </ol></div>`;
  const form = $('form', page);
  form.secure.onchange = () => { if (!form.port.value || ['465', '587', '25'].includes(form.port.value)) form.port.value = { ssl: '465', tls: '587', none: '25' }[form.secure.value]; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = readFields(form, fields);
    v.port = v.port === '' ? '' : Math.round(v.port);
    await api('PUT', 'settings', { smtp: v });
    S.settings.smtp = { ...v, hasPass: !!v.pass || !!s.hasPass }; delete S.settings.smtp.pass;
    toast('Paramètres email enregistrés'); mailSettings(page);
  };
  $('[data-test]', page).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const r = await api('POST', 'mail/test'); toast(`Email de test envoyé à ${r.to}`, 4000); } catch (err) { toast(err.message, 8000); } finally { b.disabled = false; }
  };
}
