'use strict';
/* Procese-verbale de șantier (PV) cu antetul firmei și export PDF.
   Se încarcă înaintea app.js; folosește funcțiile ajutătoare din app.js doar la apel. */

// ---------------------------------------------------------------- Setări firmă (antet)
const SETTINGS_ID = 'companysettings';
const SETTINGS_DEFAULT = {
  id: SETTINGS_ID,
  name: 'Madibu Group',
  tagline: 'Entreprise générale',
  address: '', phone: '', email: '', website: '', vat: '',
  logoId: '', color: '#1f4fd8', lang: 'fr', remark: '',
};

async function getSettings() {
  return Object.assign({}, SETTINGS_DEFAULT, (await db.get('settings', SETTINGS_ID)) || {});
}

async function settingsSheet() {
  const st = await getSettings();
  let logoId = st.logoId;
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>Setări firmă (antet PV)</h2><button class="link strong" data-save>Salvează</button></div>
    <form class="sheet-body form">
      <div class="field"><span>Logo</span>
        <div class="logo-box"><div id="logoPrev" class="logo-prev"></div>
          <div class="btns"><label class="btn small">Alege logo<input type="file" accept="image/*" hidden id="logoFile"></label><button type="button" class="btn small danger" id="logoDel">Elimină</button></div></div>
        <div class="muted">PNG sau JPG, de preferat cu fundal alb sau transparent.</div></div>
      ${field({ name: 'name', label: 'Denumire firmă', required: true }, st.name)}
      ${field({ name: 'tagline', label: 'Activitate (apare în antet)', placeholder: 'ex. Entreprise générale' }, st.tagline)}
      ${field({ name: 'address', label: 'Adresă (subsol PV)' }, st.address)}
      <div class="row2">${field({ name: 'phone', label: 'Telefon', type: 'tel' }, st.phone)}${field({ name: 'email', label: 'Email', type: 'email' }, st.email)}</div>
      <div class="row2">${field({ name: 'website', label: 'Site web' }, st.website)}${field({ name: 'vat', label: 'Nr. TVA / BCE / CUI' }, st.vat)}</div>
      <div class="row2">
        ${field({ name: 'lang', label: 'Limba proceselor-verbale', type: 'select', options: [['fr', 'Français'], ['ro', 'Română'], ['nl', 'Nederlands'], ['en', 'English']] }, st.lang)}
        ${field({ name: 'color', label: 'Culoare accent', type: 'color' }, st.color)}
      </div>
      ${field({ name: 'remark', label: 'Remarcă generală (la finalul fiecărui PV, gol = text standard)', type: 'textarea', rows: 3 }, st.remark)}
      <div class="field"><span>E-mail</span><div class="btns">
        ${sync.enabled ? '<button type="button" class="btn" data-smtp>Adresa mea de trimitere</button>' : ''}
        <button type="button" class="btn" data-tpl>Șabloane e-mail</button></div>
        ${sync.enabled ? '' : '<div class="muted">Trimiterea directă din aplicație funcționează când aplicația rulează pe serverul tău (Hostico).</div>'}</div>
    </form>`, { full: true });
  const smtpBtn = $('[data-smtp]', s.el);
  if (smtpBtn) smtpBtn.onclick = smtpSheet;
  $('[data-tpl]', s.el).onclick = templatesSheet;
  const form = $('form', s.el);
  const drawLogo = async () => {
    const u = logoId ? await blobURL(logoId) : '';
    $('#logoPrev', form).innerHTML = u ? `<img src="${u}" alt="Logo">` : `<span>${esc(form.elements.name.value || 'Logo')}</span>`;
    $('#logoDel', form).hidden = !logoId;
  };
  $('#logoFile', form).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const img = await blobToImg(f);
      // PNG cu transparență păstrată, maxim 900 px
      const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      logoId = await saveBlob(await canvasToBlob(c, 'image/png'));
      drawLogo();
    } catch (err) { toast(err.message); }
  };
  $('#logoDel', form).onclick = () => { logoId = ''; drawLogo(); };
  $('[data-save]', s.el).onclick = async () => {
    const v = form.elements;
    if (!v.name.value.trim()) return toast('Completează denumirea firmei');
    if (st.logoId && st.logoId !== logoId) delBlob(st.logoId);
    await db.put('settings', Object.assign(st, {
      name: v.name.value.trim(), tagline: v.tagline.value.trim(), address: v.address.value.trim(), phone: v.phone.value.trim(),
      email: v.email.value.trim(), website: v.website.value.trim(), vat: v.vat.value.trim(), lang: v.lang.value, color: v.color.value,
      remark: v.remark.value.trim(), logoId,
    }));
    toast('Setări salvate');
    s.close();
  };
  drawLogo();
}

// La un proiect nou, firma proprie apare automat în lista de firme (pentru tabelul „Prezenți”)
async function addOwnCompany(pid) {
  const st = await getSettings();
  if (!st.name) return;
  await db.put('companies', { id: uid(), projectId: pid, created: Date.now(), name: st.name, trade: st.tagline || 'Entreprise générale', code: 'EG', contact: '', phone: st.phone, email: st.email });
}

// ---------------------------------------------------------------- Texte PV (pe limbi)
const PVL = {
  fr: {
    status: { open: 'Ouvert', progress: 'En cours', done: 'Résolu', closed: 'Clôturé' },
    prio: { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' },
    rep: { title: 'Rapport de chantier – points ouverts', generated: 'Généré le', total: 'Total', overdue: 'En retard', plan: 'Plan', points: 'Points', company: 'Entreprise', due: 'Échéance', priority: 'Priorité', statuses: 'Statuts', onlyOverdue: 'uniquement en retard', none: 'Aucun point pour ces critères.', late: 'dépassée' },
    mail: {
      pv: { subject: 'PV de chantier n° {nr} – {proiect} – {data}', body: 'Madame, Monsieur,\n\nVeuillez trouver ci-joint le procès-verbal de chantier n° {nr} du {data} concernant le chantier {proiect} ({adresa}).\n\nSans remarque de votre part endéans les 2 jours, son contenu est considéré comme accepté.\nProchaine réunion : {urmatoarea}.\n\nBien à vous,\n\n{expeditor}\n{firma}' },
      report: { subject: '{titlu} – {proiect} – {data}', body: 'Madame, Monsieur,\n\nVeuillez trouver ci-joint le rapport « {titlu} » du {data} concernant le chantier {proiect} ({adresa}), comprenant {nr_puncte} point(s).\n\nNous restons à votre disposition pour toute question.\n\nBien à vous,\n\n{expeditor}\n{firma}' },
    },
    transmission: 'E-Mail TRANSMISSION', to: 'To', from: 'From', date: 'Date', annex: 'Annexes',
    photos: (n) => `${n} photo${n > 1 ? 's' : ''}`,
    title: (addr, n, d) => `${addr ? addr + ' : ' : ''}PV de chantier n° ${n} du ${d}`,
    presents: 'Présents :', cols: ['Activité :', 'Société :', 'Nom :', 'Présents', 'Tél. :', 'E-Mail :'],
    subj: ['Sujets', 'Remarques', 'Date', 'Actions'],
    next: 'Prochaine réunion', nextText: (wd, d, t) => `${wd} ${d}${t ? ' à ' + t.replace(':', 'h') : ''}`, all: 'TOUS',
    generalRemark: 'Remarque générale :',
    remark: 'Sans remarque de votre part endéans les 2 jours, ce qui est indiqué ci-dessus est considéré comme accepté par les différents intervenants.\nLes remarques du pv précédent ont été acceptées par tous.',
    planPoints: 'Observations sur plan', footDate: 'DATE', site: 'CHANTIER', page: 'Page', pvShort: 'PV de chantier',
    annexTitle: 'Annexe – Photos', locale: 'fr-BE', done: 'OK',
    sections: ['Avancement et documents remis', 'Documents à recevoir', 'Remarques'],
  },
  ro: {
    status: { open: 'Deschis', progress: 'În lucru', done: 'Rezolvat', closed: 'Închis' },
    prio: { low: 'Scăzută', normal: 'Normală', high: 'Ridicată', urgent: 'Urgentă' },
    rep: { title: 'Raport de șantier – puncte deschise', generated: 'Generat la', total: 'Total', overdue: 'Întârziate', plan: 'Plan', points: 'Puncte', company: 'Firmă', due: 'Termen', priority: 'Prioritate', statuses: 'Statusuri', onlyOverdue: 'doar întârziate', none: 'Niciun punct pentru criteriile alese.', late: 'depășit' },
    mail: {
      pv: { subject: 'PV de șantier nr. {nr} – {proiect} – {data}', body: 'Bună ziua,\n\nVă transmitem atașat procesul-verbal de șantier nr. {nr} din {data} pentru șantierul {proiect} ({adresa}).\n\nÎn lipsa unor observații în termen de 2 zile, conținutul este considerat acceptat.\nUrmătoarea ședință: {urmatoarea}.\n\nCu stimă,\n\n{expeditor}\n{firma}' },
      report: { subject: '{titlu} – {proiect} – {data}', body: 'Bună ziua,\n\nVă transmitem atașat raportul „{titlu}” din {data} pentru șantierul {proiect} ({adresa}), cu {nr_puncte} punct(e).\n\nRămânem la dispoziție pentru orice întrebare.\n\nCu stimă,\n\n{expeditor}\n{firma}' },
    },
    transmission: 'TRANSMITERE E-MAIL', to: 'Către', from: 'De la', date: 'Data', annex: 'Anexe',
    photos: (n) => `${n} fotografi${n > 1 ? 'i' : 'e'}`,
    title: (addr, n, d) => `${addr ? addr + ' : ' : ''}Proces-verbal de șantier nr. ${n} din ${d}`,
    presents: 'Prezenți:', cols: ['Activitate', 'Firmă', 'Nume', 'Prezent', 'Tel.', 'E-mail'],
    subj: ['Subiecte', 'Observații', 'Termen', 'Acțiuni'],
    next: 'Următoarea ședință', nextText: (wd, d, t) => `${wd} ${d}${t ? ', ora ' + t : ''}`, all: 'TOȚI',
    generalRemark: 'Remarcă generală:',
    remark: 'În lipsa unor observații din partea dumneavoastră în termen de 2 zile, cele de mai sus sunt considerate acceptate de toți participanții.\nObservațiile din procesul-verbal anterior au fost acceptate de toți.',
    planPoints: 'Observații pe plan', footDate: 'DATA', site: 'ȘANTIER', page: 'Pagina', pvShort: 'PV de șantier',
    annexTitle: 'Anexă – Fotografii', locale: 'ro-RO', done: 'OK',
    sections: ['Progres și documente predate', 'Documente de primit', 'Observații'],
  },
  nl: {
    status: { open: 'Open', progress: 'In uitvoering', done: 'Opgelost', closed: 'Afgesloten' },
    prio: { low: 'Laag', normal: 'Normaal', high: 'Hoog', urgent: 'Dringend' },
    rep: { title: 'Werfrapport – open punten', generated: 'Aangemaakt op', total: 'Totaal', overdue: 'Te laat', plan: 'Plan', points: 'Punten', company: 'Firma', due: 'Termijn', priority: 'Prioriteit', statuses: 'Statussen', onlyOverdue: 'enkel te laat', none: 'Geen punten voor deze criteria.', late: 'verstreken' },
    mail: {
      pv: { subject: 'Werfverslag nr. {nr} – {proiect} – {data}', body: 'Geachte,\n\nIn bijlage vindt u het werfverslag nr. {nr} van {data} voor de werf {proiect} ({adresa}).\n\nZonder opmerkingen binnen 2 dagen wordt de inhoud als aanvaard beschouwd.\nVolgende vergadering: {urmatoarea}.\n\nMet vriendelijke groeten,\n\n{expeditor}\n{firma}' },
      report: { subject: '{titlu} – {proiect} – {data}', body: 'Geachte,\n\nIn bijlage vindt u het rapport "{titlu}" van {data} voor de werf {proiect} ({adresa}), met {nr_puncte} punt(en).\n\nMet vriendelijke groeten,\n\n{expeditor}\n{firma}' },
    },
    transmission: 'E-Mail TRANSMISSIE', to: 'Aan', from: 'Van', date: 'Datum', annex: 'Bijlagen',
    photos: (n) => `${n} foto${n > 1 ? "'s" : ''}`,
    title: (addr, n, d) => `${addr ? addr + ' : ' : ''}Werfverslag nr. ${n} van ${d}`,
    presents: 'Aanwezig :', cols: ['Activiteit :', 'Firma :', 'Naam :', 'Aanwezig', 'Tel. :', 'E-Mail :'],
    subj: ['Onderwerpen', 'Opmerkingen', 'Datum', 'Acties'],
    next: 'Volgende vergadering', nextText: (wd, d, t) => `${wd} ${d}${t ? ' om ' + t.replace(':', 'u') : ''}`, all: 'ALLEN',
    generalRemark: 'Algemene opmerking :',
    remark: 'Zonder opmerkingen van uwentwege binnen 2 dagen wordt het bovenstaande als aanvaard beschouwd door alle betrokkenen.\nDe opmerkingen van het vorige verslag werden door iedereen aanvaard.',
    planPoints: 'Opmerkingen op plan', footDate: 'DATUM', site: 'WERF', page: 'Pagina', pvShort: 'Werfverslag',
    annexTitle: 'Bijlage – Foto\'s', locale: 'nl-BE', done: 'OK',
    sections: ['Vordering en ontvangen documenten', 'Te ontvangen documenten', 'Opmerkingen'],
  },
  en: {
    status: { open: 'Open', progress: 'In progress', done: 'Resolved', closed: 'Closed' },
    prio: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' },
    rep: { title: 'Site report – open items', generated: 'Generated on', total: 'Total', overdue: 'Overdue', plan: 'Plan', points: 'Items', company: 'Company', due: 'Due', priority: 'Priority', statuses: 'Statuses', onlyOverdue: 'overdue only', none: 'No items for these criteria.', late: 'overdue' },
    mail: {
      pv: { subject: 'Site meeting report no. {nr} – {proiect} – {data}', body: 'Dear Sir or Madam,\n\nPlease find attached site meeting report no. {nr} of {data} for the {proiect} site ({adresa}).\n\nUnless we receive remarks within 2 days, its content is deemed accepted.\nNext meeting: {urmatoarea}.\n\nKind regards,\n\n{expeditor}\n{firma}' },
      report: { subject: '{titlu} – {proiect} – {data}', body: 'Dear Sir or Madam,\n\nPlease find attached the report "{titlu}" of {data} for the {proiect} site ({adresa}), with {nr_puncte} item(s).\n\nKind regards,\n\n{expeditor}\n{firma}' },
    },
    transmission: 'E-Mail TRANSMISSION', to: 'To', from: 'From', date: 'Date', annex: 'Attachments',
    photos: (n) => `${n} photo${n > 1 ? 's' : ''}`,
    title: (addr, n, d) => `${addr ? addr + ' : ' : ''}Site meeting report no. ${n} of ${d}`,
    presents: 'Attendees:', cols: ['Role', 'Company', 'Name', 'Present', 'Phone', 'E-mail'],
    subj: ['Topics', 'Remarks', 'Date', 'Actions'],
    next: 'Next meeting', nextText: (wd, d, t) => `${wd} ${d}${t ? ' at ' + t : ''}`, all: 'ALL',
    generalRemark: 'General remark:',
    remark: 'Unless remarks are received within 2 days, the above is deemed accepted by all parties.\nThe remarks of the previous report were accepted by all.',
    planPoints: 'Observations on plan', footDate: 'DATE', site: 'SITE', page: 'Page', pvShort: 'Site report',
    annexTitle: 'Appendix – Photos', locale: 'en-GB', done: 'OK',
    sections: ['Progress and documents received', 'Documents to be received', 'Remarks'],
  },
};
const pvDate = (d, L, short) => {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return short ? `${dd}/${m}` : `${dd}/${m}/${y}`;
};
const weekday = (d, L) => {
  const w = new Date(d + 'T12:00:00').toLocaleDateString(L.locale, { weekday: 'long' });
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// ---------------------------------------------------------------- Lista de ședințe
const newSection = (title = '') => ({ id: uid(), title, items: [] });
const newItem = () => ({ id: uid(), text: '', date: '', action: '', done: false });

// Ședințele create cu versiunea anterioară (titlu + notițe) se convertesc la structura nouă
function upgradeMeeting(m, idx) {
  if (m.sections) return m;
  m.number = m.number || parseInt(String(m.title || '').replace(/\D+/g, ''), 10) || idx;
  m.sections = [];
  const lines = String(m.notes || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (lines.length) m.sections.push({ id: uid(), title: 'Remarques', items: lines.map((t) => ({ ...newItem(), text: t })) });
  m.present = m.attendees || [];
  return m;
}

async function tabMeetings(pr, el) {
  const meetings = (await db.where('meetings', pr.id)).sort((a, b) => (b.number || 0) - (a.number || 0) || (b.date || '').localeCompare(a.date || ''));
  meetings.forEach((m, i) => upgradeMeeting(m, meetings.length - i));
  el.innerHTML = (meetings.length ? `<div class="list">${meetings.map((m) => {
    const open = m.sections.reduce((n, s) => n + s.items.filter((i) => !i.done).length, 0);
    return `<button class="row" data-m="${m.id}"><span class="num" style="--c:var(--primary)">${m.number}</span><span class="main">
      <div class="t">PV n° ${m.number} – ${fmtDate(m.date)}</div><div class="s">${(m.present || []).length} prezenți · ${open} remarci deschise${m.next ? ' · următoarea: ' + fmtDate(m.next) : ''}${m.sentLog && m.sentLog.length ? ` · <span style="color:#2f9e44;font-weight:600">✉ trimis ${fmtTime(m.sentLog[m.sentLog.length - 1].t)}</span>` : ''}</div></span></button>`;
  }).join('')}</div>` : empty('Niciun proces-verbal', 'Creează procesul-verbal al vizitei de șantier: participanți, subiecte cu termene și responsabili, fotografii. PDF-ul iese cu antetul și logo-ul firmei tale.'))
    + `<div class="muted" style="margin:14px 4px">Antetul, logo-ul și limba PV-ului se setează din <a href="#" data-set style="color:var(--primary);font-weight:600">Setări firmă</a>.</div>`
    + `<button class="fab" data-act="addm">${I.plus}<span>PV nou</span></button>`;
  $('[data-set]', el).onclick = (e) => { e.preventDefault(); settingsSheet(); };
  $('[data-act=addm]', el).onclick = () => editMeeting(pr, null, meetings[0]);
  $$('[data-m]', el).forEach((b) => { b.onclick = () => editMeeting(pr, meetings.find((m) => m.id === b.dataset.m)); });
}

// ---------------------------------------------------------------- Editor PV
async function editMeeting(pr, m, prev) {
  const [companies, points, plans, st] = await Promise.all([db.where('companies', pr.id), db.where('points', pr.id), db.where('plans', pr.id), getSettings()]);
  companies.sort((a, b) => (a.created || 0) - (b.created || 0));
  const L = PVL[st.lang] || PVL.fr;
  const isNew = !m;
  if (isNew) {
    // PV nou: preia subiectele nerezolvate din PV-ul anterior
    m = {
      id: uid(), projectId: pr.id, created: Date.now(), number: prev ? (prev.number || 0) + 1 : 1, date: today(), dateText: '',
      recipients: prev ? prev.recipients : [...new Set([pr.client, ...companies.filter((c) => c.code !== 'EG' && c.name !== st.name).map((c) => c.name)].filter(Boolean))].join(' / '),
      present: prev ? [...(prev.present || [])] : companies.map((c) => c.id),
      sections: prev ? prev.sections.map((s) => ({ id: uid(), title: s.title, items: s.items.filter((i) => !i.done).map((i) => ({ ...i, id: uid() })) }))
        : L.sections.map((t) => newSection(t)),
      pointIds: points.filter(isActive).map((p) => p.id), photos: [], next: '', nextTime: '', remark: '', withPointPhotos: false,
    };
  }
  m = structuredClone(m);
  m.photos = m.photos || [];
  const addedPhotos = [];
  let saved = false;
  const codes = [...new Set([...companies.map((c) => c.code).filter(Boolean), L.all])];

  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>${isNew ? 'PV nou' : 'PV n° ' + m.number}</h2><button class="link strong" data-save>Salvează</button></div>
  <form class="sheet-body form pv-form" autocomplete="off">
    <div class="row2">${field({ name: 'number', label: 'Nr. PV', type: 'number' }, m.number)}${field({ name: 'date', label: 'Data', type: 'date' }, m.date)}</div>
    ${field({ name: 'dateText', label: 'Date vizite (opțional, ex. „17 et 20-06-2022”)' }, m.dateText)}
    ${field({ name: 'recipients', label: 'Destinatari (To:)' }, m.recipients)}
    <div class="field"><span>Prezenți</span>${companies.length ? `<div class="checks">${companies.map((c) => `<label><input type="checkbox" name="present" value="${c.id}" ${m.present.includes(c.id) ? 'checked' : ''}><span><b>${esc(c.code || '')}</b> ${esc(c.name)}${c.contact ? ` <span class="muted">– ${esc(c.contact)}</span>` : ''}</span></label>`).join('')}</div>` : '<div class="muted">Adaugă participanții în tabul „Firme” (cu abreviere: MO, EG, AR…).</div>'}</div>
    <div class="section-title" style="margin:6px 0 0">Subiecte și remarci</div>
    <div id="sections"></div>
    <button type="button" class="btn" data-addsec>${I.plus} Adaugă subiect</button>
    <datalist id="pvcodes">${codes.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    ${points.length ? `<div class="field"><span>Puncte de pe plan incluse în PV</span><div class="checks">${[...points].sort((a, b) => (isActive(b) - isActive(a)) || a.number - b.number).map((p) => `<label><input type="checkbox" name="pts" value="${p.id}" ${(m.pointIds || []).includes(p.id) ? 'checked' : ''}><span class="num" style="--c:${STATUS[p.status].color};min-width:30px;height:26px">${p.number}</span><span>${esc(p.title)}</span></label>`).join('')}</div>
      <label class="inline-checks" style="margin-top:6px"><label><input type="checkbox" name="withPointPhotos" ${m.withPointPhotos ? 'checked' : ''}>Include și fotografiile acestor puncte în anexă</label></label></div>` : ''}
    <div class="field"><span>Fotografii (anexă PV)</span><div class="pv-photos" id="pvPhotos"></div></div>
    <div class="row2">${field({ name: 'next', label: 'Următoarea ședință', type: 'date' }, m.next)}${field({ name: 'nextTime', label: 'Ora', type: 'time' }, m.nextTime)}</div>
    ${field({ name: 'remark', label: 'Remarcă generală (gol = textul standard din Setări)', type: 'textarea', rows: 2 }, m.remark)}
    <div class="btns"><button type="button" class="btn primary" data-pdf>${I.print} Generează PDF</button>${!isNew ? '<button type="button" class="btn danger" data-del>Șterge</button>' : ''}</div>
  </form>`, { full: true, onClose: () => { if (!saved) addedPhotos.forEach(delBlob); else setTimeout(render, 250); } });
  const form = $('form', s.el);
  form.onsubmit = (e) => e.preventDefault();

  function drawSections() {
    $('#sections', form).innerHTML = m.sections.map((sec, si) => `<div class="pv-sec" data-si="${si}">
      <div class="pv-sec-head"><span class="num" style="--c:var(--primary);min-width:30px;height:30px">${si + 1}</span>
        <input data-sk="title" value="${esc(sec.title)}" placeholder="Subiect (ex. Remarques)">
        <button type="button" class="icon-btn" data-delsec title="Șterge subiectul">✕</button></div>
      ${sec.items.map((it, ii) => `<div class="pv-item ${it.done ? 'done' : ''}" data-ii="${ii}">
        <textarea data-k="text" rows="2" placeholder="ex. Technique – électricité : MO valide les emplacements…">${esc(it.text)}</textarea>
        <div class="pv-meta">
          <input type="date" data-k="date" value="${esc(it.date)}" title="Termen">
          <input data-k="action" list="pvcodes" value="${esc(it.action)}" placeholder="Acțiune (EG…)">
          <label class="pv-done"><input type="checkbox" data-k="done" ${it.done ? 'checked' : ''}>Rezolvat</label>
          <button type="button" class="icon-btn" data-delitem title="Șterge remarca">✕</button>
        </div></div>`).join('')}
      <button type="button" class="btn small" data-additem>${I.plus} Remarcă</button>
    </div>`).join('');
    $$('textarea', secs).forEach(grow);
  }
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  // editările se scriu direct în model, fără re-desenare (nu se pierde focusul)
  const secs = $('#sections', form);
  secs.addEventListener('input', (e) => {
    const secEl = e.target.closest('[data-si]');
    if (!secEl) return;
    const sec = m.sections[+secEl.dataset.si];
    if (e.target.dataset.sk) { sec.title = e.target.value; return; }
    const itEl = e.target.closest('[data-ii]');
    if (!itEl || !e.target.dataset.k) return;
    const it = sec.items[+itEl.dataset.ii];
    if (e.target.tagName === 'TEXTAREA') grow(e.target);
    it[e.target.dataset.k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.dataset.k === 'done') itEl.classList.toggle('done', e.target.checked);
  });
  secs.addEventListener('click', (e) => {
    const secEl = e.target.closest('[data-si]');
    if (!secEl) return;
    const si = +secEl.dataset.si;
    if (e.target.closest('[data-additem]')) {
      m.sections[si].items.push(newItem());
      drawSections();
      const items = $$(`[data-si="${si}"] textarea`, secs);
      items[items.length - 1].focus();
    } else if (e.target.closest('[data-delitem]')) {
      m.sections[si].items.splice(+e.target.closest('[data-ii]').dataset.ii, 1);
      drawSections();
    } else if (e.target.closest('[data-delsec]')) {
      if (m.sections[si].items.length && !confirm('Ștergi subiectul cu toate remarcile lui?')) return;
      m.sections.splice(si, 1);
      drawSections();
    }
  });
  $('[data-addsec]', form).onclick = () => { m.sections.push(newSection('')); drawSections(); $$('[data-sk]', secs).pop().focus(); };

  async function drawPhotos() {
    const box = $('#pvPhotos', form);
    const urls = await Promise.all(m.photos.map((p) => blobURL(p.id)));
    box.innerHTML = m.photos.map((p, i) => `<div class="pv-photo"><img src="${urls[i]}" alt=""><input data-cap="${i}" value="${esc(p.caption || '')}" placeholder="Legendă"><button type="button" class="icon-btn" data-delph="${i}">✕</button></div>`).join('')
      + `<label class="add">${I.camera}<span>Adaugă</span><input type="file" accept="image/*" multiple hidden></label>`;
    $('input[type=file]', box).onchange = async (e) => {
      for (const f of e.target.files) {
        try {
          const r = await resizeImage(await blobToImg(f), 1800, 'image/jpeg', 0.85);
          const id = await saveBlob(r.blob);
          addedPhotos.push(id);
          m.photos.push({ id, caption: '' });
        } catch (err) { toast(err.message); }
      }
      drawPhotos();
    };
    $$('[data-cap]', box).forEach((inp) => { inp.oninput = () => { m.photos[+inp.dataset.cap].caption = inp.value; }; });
    $$('[data-delph]', box).forEach((b) => { b.onclick = () => { m.photos.splice(+b.dataset.delph, 1); drawPhotos(); }; });
  }

  function collect() {
    const v = form.elements;
    Object.assign(m, {
      number: parseInt(v.number.value, 10) || m.number, date: v.date.value || today(), dateText: v.dateText.value.trim(),
      recipients: v.recipients.value.trim(), present: $$('input[name=present]:checked', form).map((x) => x.value),
      pointIds: $$('input[name=pts]:checked', form).map((x) => x.value), withPointPhotos: !!(v.withPointPhotos && v.withPointPhotos.checked),
      next: v.next.value, nextTime: v.nextTime.value, remark: v.remark.value.trim(),
    });
    m.sections.forEach((sec) => { sec.items = sec.items.filter((i) => i.text.trim() || i.date || i.action); });
  }
  async function save() {
    collect();
    const orig = await db.get('meetings', m.id);
    const keep = new Set(m.photos.map((p) => p.id));
    if (orig && orig.photos) for (const p of orig.photos) if (!keep.has(p.id)) delBlob(p.id);
    for (const id of addedPhotos) if (!keep.has(id)) delBlob(id);
    await db.put('meetings', m);
    saved = true;
  }
  $('[data-save]', s.el).onclick = async () => { await save(); toast(`PV n° ${m.number} salvat`); s.close(); };
  $('[data-pdf]', s.el).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    await save();
    drawSections();
    try { await exportPV(pr, m); } catch (err) { console.error(err); toast('Eroare PDF: ' + err.message, 5000); }
    btn.disabled = false;
  };
  const del = $('[data-del]', form);
  if (del) del.onclick = async () => {
    if (!confirm(`Ștergi PV n° ${m.number}?`)) return;
    for (const p of m.photos) await delBlob(p.id);
    await db.del('meetings', m.id);
    saved = true;
    s.close();
  };
  drawSections();
  drawPhotos();
}

// ---------------------------------------------------------------- Generare PDF
let pdfMakePromise;
function loadPdfMake() {
  if (window.pdfMake && window.pdfMake.vfs) return Promise.resolve(window.pdfMake);
  if (!pdfMakePromise) {
    const load = (src) => new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = src;
      sc.onload = res;
      sc.onerror = () => rej(new Error('Nu pot încărca ' + src));
      document.head.appendChild(sc);
    });
    pdfMakePromise = load('vendor/pdfmake.min.js').then(() => load('vendor/vfs_fonts.js')).then(() => window.pdfMake)
      .catch((e) => { pdfMakePromise = null; throw e; });
  }
  return pdfMakePromise;
}

async function blobDataURL(id, max = 1400, type = 'image/jpeg') {
  const b = await getBlob(id);
  if (!b) return null;
  const img = await blobToImg(b);
  if (type === 'image/png') {
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  return blobToDataURL((await resizeImage(img, max, type, 0.82)).blob);
}

// Textul de dinainte de „:” apare îngroșat, ca în modelul de PV
function richItem(text) {
  const t = String(text || '');
  const i = t.indexOf(':');
  if (i > 0 && i < 70 && !/\d$/.test(t.slice(0, i))) return [{ text: t.slice(0, i + 1), bold: true }, t.slice(i + 1)];
  return [t];
}

async function buildPVDoc(pr, m) {
  const [st, companies, points, plans] = await Promise.all([getSettings(), db.where('companies', pr.id), db.where('points', pr.id), db.where('plans', pr.id)]);
  companies.sort((a, b) => (a.created || 0) - (b.created || 0));
  const L = PVL[st.lang] || PVL.fr;
  const accent = st.color || '#1f4fd8';
  const logo = st.logoId ? await blobDataURL(st.logoId, 900, 'image/png') : null;
  const site = (pr.shortName || pr.name || '').toUpperCase();
  const dateStr = pvDate(m.date, L);
  const comp = (id) => companies.find((c) => c.id === id);

  // --- tabelul de subiecte: un rând pe remarcă, numărul și subiectul se întind pe toate rândurile
  const body = [['', ...L.subj].map((h) => ({ text: h, bold: true, fillColor: '#f2f2f2' }))];
  const starts = new Set([1]);
  const sections = m.sections.filter((s) => s.title.trim() || s.items.length).map((s) => ({ title: s.title, items: s.items.map((i) => ({ text: i.text, date: i.date, action: i.done ? L.done : i.action })) }));
  const pts = (m.pointIds || []).map((id) => points.find((p) => p.id === id)).filter(Boolean).sort((a, b) => a.number - b.number);
  if (pts.length) {
    sections.push({
      title: L.planPoints,
      items: pts.map((p) => {
        const pl = plans.find((x) => x.id === p.planId);
        const c = comp(p.companyId);
        return { text: `#${p.number} ${p.title}${pl ? ' (' + pl.name + ')' : ''} – ${STATUS[p.status].label}${p.desc ? '\n' + p.desc : ''}`, date: p.due, action: c ? (c.code || c.name) : '' };
      }),
    });
  }
  if (m.next) sections.push({ title: L.next, items: [{ text: L.nextText(weekday(m.next, L), pvDate(m.next, L), m.nextTime), date: m.next, action: L.all }] });
  sections.forEach((sec, k) => {
    const items = sec.items.length ? sec.items : [{ text: '', date: '', action: '' }];
    starts.add(body.length);
    items.forEach((it, j) => {
      body.push([
        j === 0 ? { text: String(k + 1), rowSpan: items.length } : '',
        j === 0 ? { text: sec.title, rowSpan: items.length } : '',
        it.text ? { columns: [{ width: 9, text: '•' }, { width: '*', text: richItem(it.text) }], columnGap: 3 } : '',
        { text: pvDate(it.date, L, true), alignment: 'center' },
        { text: it.action || '', alignment: 'center' },
      ]);
    });
  });
  starts.add(body.length);

  // --- fotografii în anexă
  const photoList = [...(m.photos || []).map((p) => ({ id: p.id, caption: p.caption || '' }))];
  if (m.withPointPhotos) pts.forEach((p) => (p.photos || []).forEach((id) => photoList.push({ id, caption: `#${p.number} ${p.title}` })));
  const photoImgs = [];
  for (const p of photoList) {
    const d = await blobDataURL(p.id, 1400);
    if (d) photoImgs.push({ d, caption: p.caption });
  }

  const present = new Set(m.present || []);
  const content = [
    {
      columns: [{ width: '*', text: '' }, {
        width: 270,
        table: {
          widths: ['*'],
          body: [
            [{ text: L.transmission, bold: true, fontSize: 12 }],
            [`${L.to}: ${m.recipients || ''}`],
            [`${L.from} : ${st.name}`],
            [`${L.date} : ${pvDate(today(), L)}`],
            ...(photoImgs.length ? [[`${L.annex} : ${L.photos(photoImgs.length)}`]] : []),
          ],
        },
        layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 3, paddingBottom: () => 3 },
      }],
      margin: [0, 0, 0, 18],
    },
    {
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: L.title(pr.address, m.number, m.dateText || dateStr), bold: true },
            ...(pr.desc ? [{ text: pr.desc, bold: true }] : []),
          ],
          alignment: 'center', fillColor: '#d9d9d9', margin: [4, 4, 4, 4],
        }]],
      },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6 },
      margin: [0, 0, 0, 14],
    },
    { text: L.presents, italics: true, margin: [0, 0, 0, 2] },
    {
      table: {
        headerRows: 1,
        widths: [78, 70, '*', 40, 62, 108],
        body: [
          L.cols.map((h) => ({ text: h, bold: true })),
          ...companies.map((c) => [
            c.trade || '', c.name || '',
            { text: [c.contact || '', c.code ? { text: (c.contact ? ' : ' : '') + c.code, bold: true } : ''] },
            { text: present.has(c.id) ? 'X' : '', alignment: 'center' },
            c.phone || '', { text: c.email || '', fontSize: 7.5 },
          ]),
        ],
      },
      fontSize: 8.5,
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 2, paddingBottom: () => 2 },
      margin: [0, 0, 0, 18],
    },
    {
      table: { headerRows: 1, dontBreakRows: true, widths: [14, 78, '*', 40, 40], body },
      fontSize: 9.5,
      layout: {
        hLineWidth: (i) => (starts.has(i) || i === 0 ? 0.6 : 0),
        vLineWidth: () => 0.6,
        paddingTop: (i) => (starts.has(i) ? 4 : 1),
        paddingBottom: (i) => (starts.has(i + 1) ? 4 : 1),
      },
    },
    {
      text: [{ text: L.generalRemark + '\n', bold: true }, m.remark || st.remark || L.remark],
      fontSize: 9, margin: [0, 16, 0, 0],
    },
  ];
  if (photoImgs.length) {
    content.push({ text: L.annexTitle, style: 'h2', pageBreak: 'before', margin: [0, 0, 0, 10] });
    const rows = [];
    for (let i = 0; i < photoImgs.length; i += 2) {
      rows.push([0, 1].map((k) => {
        const p = photoImgs[i + k];
        return p ? { stack: [{ image: p.d, fit: [245, 190], alignment: 'center' }, { text: p.caption || `${i + k + 1}`, fontSize: 8, alignment: 'center', margin: [0, 3, 0, 0] }], margin: [0, 0, 0, 10] } : '';
      }));
    }
    content.push({ table: { widths: ['*', '*'], body: rows, dontBreakRows: true }, layout: 'noBorders' });
  }

  return {
    ...pdfChrome(st, L, logo, `${L.pvShort} ${pr.shortName || pr.name}${pr.address ? ' – ' + pr.address : ''}`, dateStr, site),
    info: { title: `${L.pvShort} ${m.number} – ${pr.name}`, author: st.name },
    content,
  };
}

// Antetul (logo + firmă) și subsolul (dată, șantier, pagină, contact) comune tuturor documentelor
function pdfChrome(st, L, logo, runningTitle, dateStr, site) {
  const accent = st.color || '#1f4fd8';
  const contactLine = [st.address, st.phone, st.email, st.website, st.vat].filter(Boolean).join('   •   ');
  return {
    pageSize: 'A4',
    pageMargins: [36, 84, 36, 66],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.12 },
    styles: { h2: { fontSize: 13, bold: true, color: accent } },
    header: (page) => ({
      margin: [36, 22, 36, 0],
      stack: [
        page === 1 ? {
          columns: [
            logo ? { image: logo, fit: [170, 46], width: 180 } : { text: st.name.toUpperCase(), bold: true, fontSize: 18, color: accent, characterSpacing: 2, width: 'auto' },
            { width: '*', text: [{ text: st.name.toUpperCase(), bold: true, characterSpacing: 3, color: accent }, st.tagline ? { text: '\n' + st.tagline, fontSize: 8.5, color: '#555', characterSpacing: 1.5 } : ''], alignment: 'right', margin: [0, 8, 0, 0] },
          ],
        } : {
          columns: [
            { width: '*', text: runningTitle, fontSize: 8.5, italics: true, margin: [0, 18, 0, 0] },
            logo ? { image: logo, fit: [90, 26], width: 90, alignment: 'right' } : { text: st.name.toUpperCase(), fontSize: 9, bold: true, color: accent, characterSpacing: 2, width: 'auto', margin: [0, 18, 0, 0] },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: 523, y2: 4, lineWidth: 1, lineColor: accent }] },
      ],
    }),
    footer: (page, count) => ({
      margin: [36, 10, 36, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: '#999' }] },
        {
          columns: [
            { text: `${L.footDate}: ${dateStr}`, width: '*' },
            { text: `${L.site} : ${site}`, width: '*', alignment: 'center' },
            { text: `${L.page}: ${page}/${count}`, width: '*', alignment: 'right' },
          ],
          fontSize: 8, margin: [0, 4, 0, 2],
        },
        contactLine ? { text: contactLine, fontSize: 7, alignment: 'center', color: '#555', characterSpacing: 0.6 } : '',
      ],
    }),
  };
}

async function exportPV(pr, m) {
  toast('Se generează PDF-ul…', 20000);
  const pdfMake = await loadPdfMake();
  const dd = await buildPVDoc(pr, m);
  const blob = await new Promise((res) => pdfMake.createPdf(dd).getBlob(res));
  const name = `PV${String(m.number).padStart(2, '0')}-${(pr.shortName || pr.name).replace(/[^\w\-]+/g, '_')}-${m.date.replace(/-/g, '').slice(2)}.pdf`;
  toast('PDF gata');
  const st = await getSettings();
  const L = PVL[st.lang] || PVL.fr;
  const companies = await db.where('companies', pr.id);
  pdfReadySheet(blob, name, {
    kind: 'pv', pr,
    vars: {
      nr: m.number, data: m.dateText || pvDate(m.date, L), proiect: pr.name, adresa: pr.address || '', descriere: pr.desc || '',
      urmatoarea: m.next ? L.nextText(weekday(m.next, L), pvDate(m.next, L), m.nextTime) : '—',
    },
    preselect: companies.filter((c) => c.email && c.code !== 'EG' && c.name !== st.name).map((c) => c.id),
    async onSent(to) {
      const cur = await db.get('meetings', m.id);
      if (!cur) return;
      cur.sentLog = [...(cur.sentLog || []), { t: Date.now(), to }];
      await db.put('meetings', cur);
    },
  });
  return blob;
}

// Partajarea trebuie pornită dintr-o atingere nouă (cerință iOS), de aceea apare o fereastră cu butoane
function pdfReadySheet(blob, name, mail) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], name, { type: 'application/pdf' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>PDF gata</h2><button class="link" data-close>Închide</button></div>
    <div class="sheet-body"><div class="card" style="margin-bottom:12px"><div class="card-title">${esc(name)}</div><div class="muted">${(blob.size / 1024).toFixed(0)} KB</div></div>
    <div class="actions" style="padding:0">
      ${mail && sync.enabled ? '<button class="btn primary" data-a="mail">✉ Trimite pe e-mail din aplicație</button>' : ''}
      ${canShare ? `<button class="btn ${mail && sync.enabled ? '' : 'primary'}" data-a="share">Partajează (Mail, WhatsApp…)</button>` : ''}
      <a class="btn" href="${url}" target="_blank" rel="noopener">Deschide PDF</a>
      <a class="btn" href="${url}" download="${esc(name)}">Descarcă</a>
    </div></div>`, { onClose: () => setTimeout(() => URL.revokeObjectURL(url), 60000) });
  const mb = $('[data-a=mail]', s.el);
  if (mb) mb.onclick = () => composeMail({ ...mail, blob, filename: name });
  const sh = $('[data-a=share]', s.el);
  if (sh) sh.onclick = async () => { try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } };
}


// ---------------------------------------------------------------- Raport de puncte (PDF cu antetul firmei)
async function buildReportDoc(pr, o) {
  const [st, companies, points, plans] = await Promise.all([getSettings(), db.where('companies', pr.id), db.where('points', pr.id), db.where('plans', pr.id)]);
  const L = PVL[st.lang] || PVL.fr;
  const accent = st.color || '#1f4fd8';
  const logo = st.logoId ? await blobDataURL(st.logoId, 900, 'image/png') : null;
  const list = filterReport(points, o).sort((a, b) => a.number - b.number);
  const comp = (id) => companies.find((c) => c.id === id);
  const planOf = (id) => plans.find((p) => p.id === id);
  const dateStr = pvDate(today(), L);
  const filt = [o.company && `${L.rep.company}: ${(comp(o.company) || {}).name || ''}`, o.plan && `${L.rep.plan}: ${(planOf(o.plan) || {}).name || ''}`,
    `${L.rep.statuses}: ${o.statuses.map((k) => L.status[k]).join(', ')}`, o.overdue && L.rep.onlyOverdue].filter(Boolean).join('  ·  ');

  const content = [
    {
      table: { widths: ['*'], body: [[{ stack: [{ text: o.title, bold: true, fontSize: 12 }, { text: [pr.name, pr.address].filter(Boolean).join(' – '), bold: true }, ...(pr.desc ? [{ text: pr.desc }] : [])], alignment: 'center', fillColor: '#d9d9d9', margin: [4, 4, 4, 4] }]] },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6 }, margin: [0, 0, 0, 8],
    },
    { text: `${L.rep.generated} ${dateStr}   ·   ${filt}`, fontSize: 8.5, color: '#555', margin: [0, 0, 0, 8] },
    {
      table: {
        widths: Array(6).fill('*'),
        body: [
          [L.rep.total, ...Object.keys(STATUS).map((k) => L.status[k]), L.rep.overdue].map((h) => ({ text: h, bold: true, alignment: 'center', fillColor: '#f2f2f2' })),
          [list.length, ...Object.keys(STATUS).map((k) => list.filter((p) => p.status === k).length), list.filter(isOverdue).length].map((v) => ({ text: String(v), alignment: 'center' })),
        ],
      },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6 }, margin: [0, 0, 0, 12],
    },
  ];
  if (o.plans) {
    for (const pl of plans) {
      const pts = list.filter((p) => p.planId === pl.id && p.x != null);
      if (!pts.length) continue;
      content.push({ stack: [{ text: `${L.rep.plan}: ${pl.name} (${pts.length})`, style: 'h2', margin: [0, 6, 0, 6] }, { image: await planWithPins(pl, pts, 1800), fit: [523, 640], alignment: 'center' }], unbreakable: true, margin: [0, 0, 0, 10] });
    }
  }
  content.push({ text: `${L.rep.points} (${list.length})`, style: 'h2', margin: [0, 8, 0, 6] });
  if (!list.length) content.push({ text: L.rep.none });
  for (const p of list) {
    const pl = planOf(p.planId);
    const c = comp(p.companyId);
    const crop = o.crop && pl && p.x != null ? await cropPlan(pl, p, 300, 300) : null;
    const photos = [];
    if (o.photos) for (const id of p.photos || []) { const d = await blobDataURL(id, 900); if (d) photos.push(d); }
    const late = isOverdue(p);
    const details = [
      { text: [{ text: `#${p.number}  `, bold: true, color: STATUS[p.status].color }, { text: p.title, bold: true }], fontSize: 10.5 },
      { text: [{ text: L.status[p.status], bold: true, color: STATUS[p.status].color }, `   ·   ${L.rep.priority}: ${L.prio[p.priority] || '-'}`, p.category ? `   ·   ${p.category}` : ''], fontSize: 8.5, margin: [0, 2, 0, 0] },
      { text: [`${L.rep.company}: `, { text: c ? c.name : '—', bold: true }, p.due ? `   ·   ${L.rep.due}: ` : '', p.due ? { text: pvDate(p.due, L) + (late ? ` (${L.rep.late})` : ''), bold: true, color: late ? '#d92d20' : '#222' } : '', pl ? `   ·   ${L.rep.plan}: ${pl.name}` : ''], fontSize: 8.5, margin: [0, 2, 0, 0] },
      ...(p.desc ? [{ text: p.desc, margin: [0, 4, 0, 0] }] : []),
      ...(o.hist && p.history && p.history.length ? [{ stack: p.history.map((h) => ({ text: `${fmtTime(h.t)} – ${h.text}`, fontSize: 7.5, color: '#555' })), margin: [0, 4, 0, 0] }] : []),
    ];
    const rows = [[...(crop ? [{ image: crop, width: 110 }] : []), { stack: details }]];
    for (let i = 0; i < photos.length; i += 4) {
      rows.push([{ columns: photos.slice(i, i + 4).map((d) => ({ image: d, fit: [122, 92], width: 125 })), columnGap: 6, colSpan: crop ? 2 : 1 }, ...(crop ? [''] : [])]);
    }
    content.push({
      table: { widths: crop ? [110, '*'] : ['*'], body: rows, dontBreakRows: true },
      layout: { hLineWidth: (i, n) => (i === 0 || i === n.table.body.length ? 0.6 : 0), vLineWidth: (i, n) => (i === 0 || i === n.table.widths.length ? 0.6 : 0), hLineColor: () => '#bbb', vLineColor: () => '#bbb', paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 6, paddingRight: () => 6 },
      unbreakable: photos.length <= 4, margin: [0, 0, 0, 8],
    });
  }
  return {
    ...pdfChrome(st, L, logo, `${o.title} – ${pr.name}`, dateStr, (pr.shortName || pr.name || '').toUpperCase()),
    info: { title: `${o.title} – ${pr.name}`, author: st.name },
    content,
    _count: list.length,
  };
}

async function exportReport(pr, o) {
  toast('Se generează raportul…', 30000);
  const pdfMake = await loadPdfMake();
  const dd = await buildReportDoc(pr, o);
  const count = dd._count;
  delete dd._count;
  const blob = await new Promise((res) => pdfMake.createPdf(dd).getBlob(res));
  const st = await getSettings();
  const L = PVL[st.lang] || PVL.fr;
  const name = `Rapport-${(pr.shortName || pr.name).replace(/[^\w\-]+/g, '_')}-${today().replace(/-/g, '').slice(2)}.pdf`;
  toast('Raport gata');
  const companies = await db.where('companies', pr.id);
  pdfReadySheet(blob, name, {
    kind: 'report', pr,
    vars: { titlu: o.title, data: pvDate(today(), L), proiect: pr.name, adresa: pr.address || '', nr_puncte: count },
    preselect: o.company ? [o.company] : companies.filter((c) => c.email && c.code !== 'EG' && c.name !== st.name).map((c) => c.id),
  });
}

// ---------------------------------------------------------------- E-mail: adresa de trimitere, șabloane, compunere
const SMTP_PRESETS = {
  cpanel: { label: 'Hostico / cPanel (adresa ta pe domeniu)', port: 465, secure: 'ssl' },
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: 'ssl' },
  outlook: { label: 'Outlook / Office 365', host: 'smtp.office365.com', port: 587, secure: 'tls' },
  other: { label: 'Alt furnizor' },
};

async function smtpSheet() {
  let cur;
  try { cur = (await apiJSON('smtp')).smtp; } catch (e) { toast(e.message); return; }
  cur = cur || { from_name: sync.user ? sync.user.name : '', from_email: '', host: '', port: 465, secure: 'ssl', username: '' };
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>Adresa mea de trimitere</h2><button class="link strong" data-save>Salvează</button></div>
    <form class="sheet-body form" autocomplete="off">
      <div class="muted">E-mailurile (PV-uri, rapoarte) pleacă de pe această adresă, iar răspunsurile vin tot aici. Fiecare utilizator își poate seta propria adresă.</div>
      ${field({ name: 'from_name', label: 'Numele afișat', placeholder: 'ex. Marius Budescu – Madibu Group' }, cur.from_name)}
      ${field({ name: 'from_email', label: 'Adresa ta de e-mail', type: 'email', required: true, placeholder: 'ex. marius@madibugroup.be' }, cur.from_email)}
      ${field({ name: 'preset', label: 'Furnizor', type: 'select', options: Object.entries(SMTP_PRESETS).map(([k, v]) => [k, v.label]) }, cur.host === 'smtp.gmail.com' ? 'gmail' : cur.host === 'smtp.office365.com' ? 'outlook' : 'cpanel')}
      <div class="muted" id="smtpHelp"></div>
      <div class="row2">${field({ name: 'host', label: 'Server SMTP', placeholder: 'mail.domeniul-tau.be' }, cur.host)}${field({ name: 'port', label: 'Port', type: 'number' }, cur.port)}</div>
      <div class="row2">${field({ name: 'secure', label: 'Securitate', type: 'select', options: [['ssl', 'SSL (port 465)'], ['tls', 'STARTTLS (port 587)'], ['none', 'Fără']] }, cur.secure)}
        ${field({ name: 'username', label: 'Utilizator (de obicei adresa de e-mail)' }, cur.username)}</div>
      ${field({ name: 'password', label: cur.has_password ? 'Parola (lasă gol pentru a o păstra pe cea salvată)' : 'Parola contului de e-mail', type: 'password' }, '')}
      <button type="button" class="btn" data-test>Salvează și trimite-mi un e-mail de test</button>
    </form>`, { full: true });
  const f = $('form', s.el).elements;
  f.password.setAttribute('autocomplete', 'new-password');
  const help = {
    cpanel: 'Creează adresa în cPanel → Email Accounts (ex. marius@madibugroup.be). Serverul este de obicei mail.domeniul-tău, port 465 SSL; utilizator = adresa completă, parola = parola căsuței de e-mail.',
    gmail: 'Pentru Gmail activează verificarea în 2 pași, apoi creează o „Parolă pentru aplicații” (Cont Google → Securitate) și folosește-o aici în locul parolei obișnuite.',
    outlook: 'Pentru Outlook / Office 365 folosește adresa și parola contului (sau o parolă de aplicație, dacă ai autentificare în 2 pași).',
    other: 'Completează datele SMTP primite de la furnizorul tău de e-mail.',
  };
  const applyPreset = (first) => {
    const k = f.preset.value;
    const p = SMTP_PRESETS[k];
    $('#smtpHelp', s.el).textContent = help[k];
    if (first) return;
    if (p.host) f.host.value = p.host;
    else if (k === 'cpanel' && f.from_email.value.includes('@')) f.host.value = 'mail.' + f.from_email.value.split('@')[1];
    if (p.port) f.port.value = p.port;
    if (p.secure) f.secure.value = p.secure;
  };
  f.preset.onchange = () => applyPreset(false);
  f.from_email.onchange = () => {
    if (!f.username.value) f.username.value = f.from_email.value;
    if (f.preset.value === 'cpanel' && !f.host.value && f.from_email.value.includes('@')) f.host.value = 'mail.' + f.from_email.value.split('@')[1];
  };
  applyPreset(true);
  const save = async () => {
    const body = { from_name: f.from_name.value.trim(), from_email: f.from_email.value.trim(), host: f.host.value.trim(), port: +f.port.value || 465, secure: f.secure.value, username: f.username.value.trim() || f.from_email.value.trim(), password: f.password.value };
    if (!cur.has_password && !body.password) throw new Error('Completează parola contului de e-mail');
    await apiJSON('smtp', { method: 'POST', body });
    cur.has_password = true;
    f.password.value = '';
  };
  $('[data-save]', s.el).onclick = async () => { try { await save(); toast('Adresa de trimitere a fost salvată'); s.close(); } catch (e) { toast(e.message, 5000); } };
  $('[data-test]', s.el).onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try { await save(); toast('Se trimite e-mailul de test…', 20000); await apiJSON('smtp-test', { method: 'POST' }); toast('Trimis! Verifică ' + f.from_email.value, 5000); } catch (err) { toast(err.message, 8000); }
    b.disabled = false;
  };
}

async function mailTemplate(kind) {
  const st = await getSettings();
  const L = PVL[st.lang] || PVL.fr;
  const t = (st.mailTpl && st.mailTpl[kind]) || {};
  return { subject: t.subject || L.mail[kind].subject, body: t.body || L.mail[kind].body, st };
}
const fillTpl = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

async function templatesSheet() {
  const st = await getSettings();
  const L = PVL[st.lang] || PVL.fr;
  const tpl = st.mailTpl || {};
  const v = (k, f) => (tpl[k] && tpl[k][f]) || L.mail[k][f];
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>Șabloane e-mail</h2><button class="link strong" data-save>Salvează</button></div>
    <form class="sheet-body form">
      <div class="muted">Textul se completează automat la trimitere și îl poți modifica de fiecare dată înainte de trimitere. Câmpuri disponibile:
        <b>{nr}</b> nr. PV, <b>{data}</b>, <b>{proiect}</b>, <b>{adresa}</b>, <b>{descriere}</b>, <b>{urmatoarea}</b> ședință, <b>{titlu}</b> raport, <b>{nr_puncte}</b>, <b>{firma}</b>, <b>{expeditor}</b>.</div>
      <div class="section-title" style="margin:4px 0 0">Proces-verbal</div>
      ${field({ name: 'pvSubject', label: 'Subiect' }, v('pv', 'subject'))}
      ${field({ name: 'pvBody', label: 'Mesaj', type: 'textarea', rows: 10 }, v('pv', 'body'))}
      <div class="section-title" style="margin:4px 0 0">Raport</div>
      ${field({ name: 'repSubject', label: 'Subiect' }, v('report', 'subject'))}
      ${field({ name: 'repBody', label: 'Mesaj', type: 'textarea', rows: 9 }, v('report', 'body'))}
      <button type="button" class="btn" data-reset>Revino la textele standard (${esc(st.lang.toUpperCase())})</button>
    </form>`, { full: true });
  const f = $('form', s.el).elements;
  $('[data-reset]', s.el).onclick = () => {
    f.pvSubject.value = L.mail.pv.subject; f.pvBody.value = L.mail.pv.body;
    f.repSubject.value = L.mail.report.subject; f.repBody.value = L.mail.report.body;
  };
  $('[data-save]', s.el).onclick = async () => {
    // textul identic cu cel standard nu se salvează, ca să urmeze limba aleasă
    const pick = (val, def) => (val.trim() === def ? '' : val);
    st.mailTpl = {
      pv: { subject: pick(f.pvSubject.value, L.mail.pv.subject), body: pick(f.pvBody.value, L.mail.pv.body) },
      report: { subject: pick(f.repSubject.value, L.mail.report.subject), body: pick(f.repBody.value, L.mail.report.body) },
    };
    await db.put('settings', st);
    toast('Șabloane salvate');
    s.close();
  };
}

async function composeMail({ kind, pr, vars, preselect = [], blob, filename, onSent }) {
  let smtp;
  try { smtp = (await apiJSON('smtp')).smtp; } catch (e) { toast(e.message); return; }
  if (!smtp) {
    if (confirm('Nu ai setat încă adresa de e-mail de pe care se trimite. O setezi acum?')) smtpSheet();
    return;
  }
  const [companies, tpl] = await Promise.all([db.where('companies', pr.id), mailTemplate(kind)]);
  const all = { ...vars, firma: tpl.st.name, expeditor: smtp.from_name || (sync.user && sync.user.name) || '' };
  const withMail = companies.filter((c) => c.email);
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>Trimite pe e-mail</h2><button class="link strong" data-send>Trimite</button></div>
    <form class="sheet-body form" autocomplete="off">
      <div class="muted">De la: <b>${esc(smtp.from_name ? smtp.from_name + ' <' + smtp.from_email + '>' : smtp.from_email)}</b></div>
      <div class="field"><span>Destinatari</span>${withMail.length ? `<div class="checks">${withMail.map((c) => `<label><input type="checkbox" name="rc" value="${esc(c.email)}" ${preselect.includes(c.id) ? 'checked' : ''}><span><b>${esc(c.code || '')}</b> ${esc(c.name)}${c.contact ? ' – ' + esc(c.contact) : ''}<br><span class="muted">${esc(c.email)}</span></span></label>`).join('')}</div>` : '<div class="muted">Nicio firmă din proiect nu are adresă de e-mail (le poți adăuga în tabul „Firme”).</div>'}</div>
      ${field({ name: 'extra', label: 'Alte adrese (separate prin virgulă)', type: 'email', placeholder: 'ex. client@exemplu.be' })}
      ${field({ name: 'cc', label: 'CC (opțional)', type: 'email' })}
      <label class="inline-checks"><label><input type="checkbox" name="copy" checked>Trimite-mi și mie o copie</label></label>
      ${field({ name: 'subject', label: 'Subiect' }, fillTpl(tpl.subject, all))}
      ${field({ name: 'body', label: 'Mesaj', type: 'textarea', rows: 12 }, fillTpl(tpl.body, all))}
      <div class="card" style="display:flex;gap:10px;align-items:center"><span style="font-size:22px">📎</span><div><div class="t" style="font-weight:600">${esc(filename)}</div><div class="muted">${(blob.size / 1024).toFixed(0)} KB</div></div></div>
    </form>`, { full: true });
  const f = $('form', s.el).elements;
  f.extra.setAttribute('multiple', ''); f.cc.setAttribute('multiple', '');
  $('[data-send]', s.el).onclick = async (e) => {
    const btn = e.currentTarget;
    const to = [...$$('input[name=rc]:checked', s.el).map((x) => x.value), ...f.extra.value.split(/[,;\s]+/).filter(Boolean)];
    if (!to.length) { toast('Alege cel puțin un destinatar'); return; }
    if (!f.subject.value.trim()) { toast('Completează subiectul'); return; }
    const fd = new FormData();
    fd.append('to', [...new Set(to)].join(','));
    fd.append('cc', f.cc.value);
    if (f.copy.checked) fd.append('copy', '1');
    fd.append('subject', f.subject.value.trim());
    fd.append('body', f.body.value);
    fd.append('filename', filename);
    fd.append('file', blob, filename);
    btn.disabled = true;
    btn.textContent = 'Se trimite…';
    try {
      await apiJSON('mail', { method: 'POST', form: fd });
      toast(`✉ Trimis la ${to.length} destinatar${to.length > 1 ? 'i' : ''}`, 4000);
      if (onSent) await onSent([...new Set(to)]);
      s.close();
    } catch (err) {
      toast(err.message, 9000);
      btn.disabled = false;
      btn.textContent = 'Trimite';
    }
  };
}
