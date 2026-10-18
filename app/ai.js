'use strict';
/* Asistent AI (Claude): pilot automat zilnic care analizează facturile, devizele, costurile și planningul și propune acțiuni
   cu mesaje gata redactate; generare de articole de deviz dintr-o descriere; întrebări libere despre afacere.
   Se încarcă după gestiune.js. Cheia API rămâne doar pe dispozitiv (IndexedDB) și nu intră în backup.
   Cererile pleacă direct din browser la api.anthropic.com – restul datelor aplicației rămân locale. */

const AI_MODEL = 'claude-opus-5-5';
const AI_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.129.0/+esm';
const AI_KINDS = {
  invoice_reminder: { label: 'Factură de încasat', color: '#e5484d' },
  quote_followup:   { label: 'Ofertă de urmărit',  color: '#1f4fd8' },
  budget_alert:     { label: 'Buget depășit',      color: '#f08c00' },
  schedule_alert:   { label: 'Întârziere planning', color: '#7048e8' },
  defect_followup:  { label: 'Puncte restante',    color: '#0c8599' },
  other:            { label: 'Altele',             color: '#868e96' },
};
const AI_PRIO = { high: 'Urgent', normal: 'Normal', low: 'Scăzut' };

I.spark = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';

// ---------------------------------------------------------------- Configurare și client
async function aiConfig() {
  return Object.assign({ id: 'ai', key: '', auto: true, last: null, done: [] }, await db.get('meta', 'ai'));
}
const saveAiConfig = (c) => db.put('meta', c);

let _aiClient; let _aiClientKey;
async function aiClient() {
  const cfg = await aiConfig();
  if (!cfg.key) throw new Error('Adaugă cheia API Anthropic din Asistent AI → Setări');
  if (!navigator.onLine) throw new Error('Asistentul AI are nevoie de internet');
  if (!_aiClient || _aiClientKey !== cfg.key) {
    const { default: Anthropic } = await import(AI_SDK_URL);
    // Aplicația nu are server: cheia este a utilizatorului și stă doar pe dispozitivul lui.
    _aiClient = new Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true });
    _aiClientKey = cfg.key;
  }
  return _aiClient;
}

// O singură cerere către Claude. Cu `schema` răspunsul este JSON validat de API (structured outputs).
async function aiAsk({ system, prompt, schema, effort = 'medium' }) {
  const client = await aiClient();
  const params = {
    model: AI_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort },
    // dacă filtrele de siguranță refuză cererea, API-ul o reia automat pe un model de rezervă
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
  if (schema) params.output_config.format = { type: 'json_schema', schema };
  let res;
  try {
    res = await client.beta.messages.create(params);
  } catch (e) {
    if (e.status === 401) throw new Error('Cheia API nu este validă');
    if (e.status === 429) throw new Error('Prea multe cereri – încearcă din nou peste un minut');
    if (e.status >= 500) throw new Error('Serviciul AI este temporar indisponibil');
    throw new Error(e.message || 'Eroare de conexiune');
  }
  if (res.stop_reason === 'refusal') throw new Error('Asistentul a refuzat cererea');
  if (res.stop_reason === 'max_tokens') throw new Error('Răspunsul a fost prea lung – restrânge cererea');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return schema ? JSON.parse(text) : text;
}

// ---------------------------------------------------------------- Instantaneu al afacerii (trimis ca context)
const daysBetween = (a, b) => dnum(b) - dnum(a);
async function aiSnapshot() {
  const [projects, clients, quotes, invoices, costs, tasks, points, companies] = await Promise.all(
    ['projects', 'clients', 'quotes', 'invoices', 'costs', 'tasks', 'points', 'companies'].map((s) => db.all(s)));
  const t0 = today();
  const cl = (id) => clients.find((c) => c.id === id) || {};
  const pn = (id) => (projects.find((p) => p.id === id) || {}).name || '';
  const invs = invoices.map((inv) => ({ inv, s: invState(inv) })).filter(({ s }) => s.st !== 'paid' && s.st !== 'credit')
    .map(({ inv, s }) => ({
      ref: inv.id, number: inv.number, label: inv.label || '', project: pn(inv.projectId), client: cl(inv.clientId).name || '',
      client_contact: cl(inv.clientId).contact || '', client_email: cl(inv.clientId).email || '',
      date: inv.date, due: inv.due || '', days_overdue: inv.due && inv.due < t0 ? daysBetween(inv.due, t0) : 0,
      total: s.t.total, paid: s.paid, rest: s.rest, reminders_sent: (inv.reminders || []).length,
    }));
  const qs = quotes.filter((q) => q.status === 'sent' || q.status === 'draft').map((q) => ({
    ref: q.id, number: q.number, title: q.title || '', status: q.status, project: pn(q.projectId), client: cl(q.clientId).name || '',
    client_contact: cl(q.clientId).contact || '', client_email: cl(q.clientId).email || '', date: q.date, valid_until: q.valid || '',
    days_since: q.date ? daysBetween(q.date, t0) : 0, total_without_vat: totals(q).base,
  }));
  const prj = projects.map((pr) => {
    const acc = quotes.filter((q) => q.projectId === pr.id && q.status === 'accepted').map(totals);
    const pc = costs.filter((c) => c.projectId === pr.id);
    const pts = points.filter((p) => p.projectId === pr.id);
    return {
      ref: pr.id, name: pr.name, client: pr.client || '', manager: pr.manager || '',
      budget: r2(acc.reduce((a, t) => a + t.base, 0)), estimated_cost: r2(acc.reduce((a, t) => a + t.cost, 0)),
      real_cost: r2(pc.reduce((a, c) => a + num(c.amount), 0)),
      invoiced: r2(invoices.filter((i) => i.projectId === pr.id).reduce((a, i) => a + invState(i).t.base, 0)),
      open_points: pts.filter(isActive).length,
      overdue_points: pts.filter(isOverdue).slice(0, 15).map((p) => {
        const co = companies.find((c) => c.id === p.companyId) || {};
        return { number: p.number, title: p.title, due: p.due, priority: p.priority, company: co.name || '', company_email: co.email || '' };
      }),
      late_tasks: tasks.filter((t) => t.projectId === pr.id && t.end < t0 && num(t.progress) < 100).slice(0, 15)
        .map((t) => ({ name: t.name, start: t.start, end: t.end, progress: num(t.progress) })),
    };
  });
  return {
    today: t0, currency: settings.currency, company: settings.name || '', company_email: settings.email || '', company_phone: settings.phone || '',
    unpaid_invoices: invs, open_quotes: qs, projects: prj,
  };
}

// ---------------------------------------------------------------- Pilot automat (analiză zilnică → acțiuni)
const AI_ACTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'priority', 'title', 'detail', 'ref', 'to_email', 'subject', 'message'],
        properties: {
          kind: { type: 'string', enum: Object.keys(AI_KINDS) },
          priority: { type: 'string', enum: Object.keys(AI_PRIO) },
          title: { type: 'string' },
          detail: { type: 'string' },
          ref: { type: 'string' },
          to_email: { type: 'string' },
          subject: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};
const AI_PILOT_SYSTEM = `Ești asistentul de administrare al unei firme de construcții din România. Primești un instantaneu JSON al afacerii și pregătești lista de acțiuni pentru ziua de azi, ca proprietarul să le poată bifa în câteva minute.

Reguli:
- Scrie totul în limba română, profesionist și politicos, fără exagerări.
- O acțiune pentru fiecare problemă reală: facturi restante sau aproape de scadență (kind invoice_reminder), oferte trimise de peste 5 zile fără răspuns sau care expiră curând (quote_followup), proiecte unde costul real depășește costul estimat sau se apropie de buget (budget_alert), sarcini întârziate (schedule_alert), puncte de șantier restante la o firmă (defect_followup).
- Nu inventa date. Folosește doar cifrele, numele și adresele din instantaneu. Sumele se scriu cu moneda dată.
- În "ref" pune exact valoarea "ref" a facturii, devizului sau proiectului vizat, altfel șir gol.
- Pentru acțiunile care cer un mesaj către client sau firmă, redactează în "message" emailul complet, semnat cu numele firmei, iar în "subject" subiectul; în "to_email" adresa din instantaneu, sau șir gol dacă lipsește. Tonul crește treptat cu numărul de remindere deja trimise. Pentru alertele interne lasă "to_email", "subject" și "message" goale și explică în "detail" ce trebuie verificat.
- priority: high pentru restanțe peste 15 zile sau depășiri de buget, normal pentru restul, low pentru simple observații.
- Ordonează acțiunile de la cea mai urgentă. Dacă nu există nimic de făcut, întoarce o listă goală.
- În "summary" scrie 2–3 propoziții: starea generală a afacerii și cele mai importante cifre (de încasat, oferte în așteptare).`;

const actionKey = (a) => `${a.kind}:${a.ref}:${a.title}`;

async function aiRunPilot({ silent = false } = {}) {
  const snap = await aiSnapshot();
  if (!snap.unpaid_invoices.length && !snap.open_quotes.length && !snap.projects.length) {
    if (!silent) toast('Nu există încă date de analizat');
    return null;
  }
  const out = await aiAsk({ system: AI_PILOT_SYSTEM, prompt: `Instantaneul afacerii:\n${JSON.stringify(snap)}`, schema: AI_ACTIONS_SCHEMA });
  const cfg = await aiConfig();
  cfg.last = { date: today(), at: Date.now(), summary: out.summary, actions: out.actions };
  await saveAiConfig(cfg);
  return cfg.last;
}

// Rulează analiza o dată pe zi, la deschiderea aplicației, dacă pilotul automat este activ.
async function aiAutoRun() {
  try {
    const cfg = await aiConfig();
    if (!cfg.key || !cfg.auto || !navigator.onLine || (cfg.last && cfg.last.date === today())) return;
    const r = await aiRunPilot({ silent: true });
    if (!r) return;
    const n = r.actions.filter((a) => !cfg.done.includes(actionKey(a))).length;
    if (n) toast(`Asistentul AI a pregătit ${n} ${n === 1 ? 'acțiune' : 'acțiuni'} pentru azi`, 4000);
    if (location.hash === '#/g/ai') render();
  } catch (e) {
    console.warn('Pilot automat AI:', e);
  }
}

// ---------------------------------------------------------------- Pagina „Asistent AI”
async function gAI(el) {
  const cfg = await aiConfig();
  if (!cfg.key) {
    el.innerHTML = `<div class="empty"><h3>Asistent AI</h3><div>Conectează asistentul (Claude) cu o cheie API Anthropic. În fiecare zi, el verifică singur facturile restante, ofertele fără răspuns, bugetele și termenele, apoi îți pregătește acțiunile cu emailuri gata scrise. Poate genera și devize dintr-o simplă descriere.</div>
      <div style="margin-top:16px"><button class="btn primary" data-act="cfg">${I.spark} Conectează asistentul</button></div></div>`;
    $('[data-act=cfg]', el).onclick = aiSettings;
    return;
  }
  const last = cfg.last;
  const open = last ? last.actions.filter((a) => !cfg.done.includes(actionKey(a))) : [];
  const doneN = last ? last.actions.length - open.length : 0;
  el.innerHTML = `<div class="card">
      <div class="card-title" style="display:flex;align-items:center;gap:6px"><span style="width:20px;height:20px;display:inline-flex">${I.spark}</span>Pilot automat ${cfg.auto ? '<span class="chip" style="margin-left:6px">activ zilnic</span>' : '<span class="chip red" style="margin-left:6px">oprit</span>'}</div>
      <div class="muted" style="margin:6px 0 10px">${last ? `Ultima analiză: ${fmtTime(last.at)}` : 'Nicio analiză încă.'}</div>
      ${last && last.summary ? `<p style="margin:0 0 12px;line-height:1.5">${esc(last.summary)}</p>` : ''}
      <div class="btns"><button class="btn primary" data-act="run">Analizează acum</button><button class="btn" data-act="ask">Întreabă asistentul</button><button class="btn" data-act="cfg">Setări</button></div>
    </div>
    <div class="section-title">Acțiuni de făcut${open.length ? ` (${open.length})` : ''}</div>
    ${open.length ? `<div class="list">${open.map((a) => {
      const k = AI_KINDS[a.kind] || AI_KINDS.other;
      return `<button class="row" data-a="${esc(actionKey(a))}"><span class="dot" style="--c:${k.color}"></span><span class="main">
        <div class="t">${esc(a.title)}</div><div class="s">${esc([k.label, AI_PRIO[a.priority], a.message ? 'mesaj pregătit' : ''].filter(Boolean).join(' · '))}</div></span></button>`;
    }).join('')}</div>` : `<div class="muted" style="margin:0 4px">${last ? 'Totul este la zi.' : 'Apasă „Analizează acum” pentru prima analiză.'}</div>`}
    ${doneN ? `<div class="muted" style="margin:10px 4px">${doneN} ${doneN === 1 ? 'acțiune rezolvată' : 'acțiuni rezolvate'} din ultima analiză.</div>` : ''}
    <div class="muted" style="margin:16px 4px">Asistentul trimite către Anthropic doar un rezumat al datelor (facturi, oferte, costuri, termene), nu fotografii sau planuri. Verifică întotdeauna mesajele înainte de trimitere.</div>`;
  $('[data-act=cfg]', el).onclick = aiSettings;
  $('[data-act=ask]', el).onclick = aiQuestion;
  $('[data-act=run]', el).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Se analizează…';
    try { await aiRunPilot(); render(); } catch (err) { toast('AI: ' + err.message, 4000); b.disabled = false; b.textContent = 'Analizează acum'; }
  };
  $$('[data-a]', el).forEach((b) => { b.onclick = () => aiActionSheet(open.find((a) => actionKey(a) === b.dataset.a)); });
}

async function aiActionSheet(a) {
  const k = AI_KINDS[a.kind] || AI_KINDS.other;
  const [inv, q, pr] = a.ref ? await Promise.all([db.get('invoices', a.ref), db.get('quotes', a.ref), db.get('projects', a.ref)]) : [null, null, null];
  const link = inv ? `#/i/${inv.id}` : q ? `#/q/${q.id}` : pr ? `#/p/${pr.id}/${a.kind === 'schedule_alert' ? 'planning' : a.kind === 'defect_followup' ? 'points' : 'costs'}` : '';
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>${esc(k.label)}</h2><button class="link" data-close>Închide</button></div>
    <form class="sheet-body form">
      <div class="card-title">${esc(a.title)}</div>
      <p class="muted" style="line-height:1.5">${esc(a.detail)}</p>
      ${a.message ? `${field({ name: 'to', label: 'Către', type: 'email' }, a.to_email)}${field({ name: 'subject', label: 'Subiect' }, a.subject)}
        ${field({ name: 'message', label: 'Mesaj', type: 'textarea', rows: 10 }, a.message)}
        <div class="btns"><button type="button" class="btn primary" data-send>Trimite pe email</button><button type="button" class="btn" data-copy>Copiază</button></div>` : ''}
      <div class="btns" style="margin-top:8px">${link ? `<a class="btn" href="${link}">Deschide</a>` : ''}<button type="button" class="btn" data-done>Marchează ca rezolvat</button></div>
    </form>`, { full: !!a.message });
  const form = $('form', s.el);
  const done = async () => {
    const cfg = await aiConfig();
    if (!cfg.done.includes(actionKey(a))) cfg.done.push(actionKey(a));
    cfg.done = cfg.done.slice(-300);
    await saveAiConfig(cfg);
    s.close(); render();
  };
  $('[data-done]', s.el).onclick = done;
  if (!a.message) return;
  const msg = () => ({ to: form.elements.to.value.trim(), subject: form.elements.subject.value.trim(), body: form.elements.message.value });
  $('[data-copy]', s.el).onclick = async () => {
    try { await navigator.clipboard.writeText(msg().body); toast('Mesaj copiat'); } catch (e) { toast('Nu s-a putut copia'); }
  };
  $('[data-send]', s.el).onclick = async () => {
    const m = msg();
    location.href = `mailto:${encodeURIComponent(m.to)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    // ține evidența reminderelor ca următorul mesaj să fie mai ferm
    if (inv && a.kind === 'invoice_reminder') { inv.reminders = [...(inv.reminders || []), { date: today(), to: m.to }]; await db.put('invoices', inv); }
    await done();
  };
}

function aiSettings() {
  aiConfig().then((cfg) => formSheet({
    title: 'Asistent AI',
    values: { key: cfg.key, auto: cfg.auto ? '1' : '0' },
    fields: [
      { name: 'key', label: 'Cheie API Anthropic', type: 'password', placeholder: 'sk-ant-…' },
      { name: 'auto', label: 'Pilot automat (analiză zilnică la deschiderea aplicației)', type: 'select', options: [['1', 'Activ'], ['0', 'Oprit']] },
    ],
    extra: '<p class="muted">Cheia se obține din console.anthropic.com → API Keys. Rămâne doar pe acest dispozitiv și nu este inclusă în backup. Fiecare analiză consumă câțiva cenți din contul tău Anthropic.</p>',
    async onSave(v) {
      const keyChanged = v.key !== cfg.key;
      Object.assign(cfg, { key: v.key, auto: v.auto === '1' });
      if (keyChanged) cfg.last = null;
      await saveAiConfig(cfg);
      toast('Setări AI salvate');
      render();
      if (keyChanged && cfg.key) aiAutoRun();
    },
  }));
}

// ---------------------------------------------------------------- Întrebări libere
const AI_QA_SYSTEM = `Ești asistentul de administrare al unei firme de construcții din România. Răspunzi la întrebările proprietarului folosind doar instantaneul JSON al afacerii primit. Dacă informația lipsește din instantaneu, spune asta. Răspunde în română, concis, cu cifre exacte și moneda dată. Text simplu, fără Markdown.`;

function aiQuestion() {
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Întreabă asistentul</h2><button class="link" data-close>Închide</button></div>
    <form class="sheet-body form">
      ${field({ name: 'q', label: 'Întrebare', type: 'textarea', rows: 3, placeholder: 'ex. Care proiect îmi aduce cel mai mic profit? Cine îmi datorează cei mai mulți bani?' })}
      <button type="submit" class="btn primary block">Întreabă</button>
      <div id="ans" style="white-space:pre-wrap;line-height:1.55;margin-top:14px"></div>
    </form>`, { full: true });
  const form = $('form', s.el);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const q = form.elements.q.value.trim();
    if (!q) return;
    const b = $('button[type=submit]', form); const ans = $('#ans', form);
    b.disabled = true; ans.textContent = 'Se gândește…';
    try {
      const snap = await aiSnapshot();
      ans.textContent = await aiAsk({ system: AI_QA_SYSTEM, prompt: `Instantaneul afacerii:\n${JSON.stringify(snap)}\n\nÎntrebare: ${q}` });
    } catch (err) { ans.textContent = 'Eroare: ' + err.message; }
    b.disabled = false;
  };
}

// ---------------------------------------------------------------- Deviz generat din descriere
const AI_QUOTE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'desc', 'unit', 'qty', 'cost', 'price', 'type', 'catalog_id'],
        properties: {
          kind: { type: 'string', enum: ['title', 'item'] },
          desc: { type: 'string' },
          unit: { type: 'string' },
          qty: { type: 'number' },
          cost: { type: 'number' },
          price: { type: 'number' },
          type: { type: 'string', enum: Object.keys(KINDS) },
          catalog_id: { type: 'string' },
        },
      },
    },
  },
};
const AI_QUOTE_SYSTEM = `Ești devizier cu experiență la o firmă de construcții din România. Din descrierea lucrării întocmești articolele de deviz, grupate pe capitole.

Reguli:
- Fiecare capitol începe cu o linie kind "title" (doar "desc" contează; restul câmpurilor: unit "", qty 0, cost 0, price 0, type "other", catalog_id ""), urmată de articolele lui (kind "item").
- Separă materialele, manopera, utilajele și subcontractările (câmpul type). Unități uzuale: buc, m, m², m³, kg, t, l, h, zi, set, forfet.
- Calculează cantitățile din dimensiunile date, cu pierderi tehnologice rezonabile. Dacă lipsesc dimensiuni, alege valori tipice și precizează ipoteza în descrierea articolului.
- Dacă un articol se potrivește cu unul din catalogul firmei, folosește-i exact "id"-ul în catalog_id și prețurile lui (cost și price). Altfel catalog_id este "" și estimezi prețuri de piață actuale din România în moneda indicată: cost = costul firmei, price = prețul de vânzare fără TVA (cu marja implicită indicată).
- Descrieri scurte și clare, în română. Nu adăuga TVA, transport sau organizare de șantier decât dacă reiese din descriere.`;

async function aiQuote(q, save) {
  const catalog = await db.all('catalog');
  const s = formSheet({
    title: 'Deviz cu AI',
    fields: [
      { name: 'desc', label: 'Descrie lucrarea', type: 'textarea', rows: 6, required: true, placeholder: 'ex. Renovare completă baie 2,2 × 2,5 m, h 2,6 m: demontare faianță veche, hidroizolație, faianță pe pereți până la tavan, gresie, cadă înlocuită cu duș walk-in, obiecte sanitare de nivel mediu.' },
      { name: 'margin', label: 'Marja implicită (%)', mode: 'decimal', placeholder: '20' },
    ],
    values: { margin: '20' },
    extra: `<p class="muted">Articolele propuse se adaugă la sfârșitul devizului ${esc(q.number)}${catalog.length ? `, folosind prețurile din catalogul tău (${catalog.length} articole) acolo unde se potrivesc` : ''}. Verifică întotdeauna cantitățile și prețurile.</p>`,
    async onSave(v) {
      const b = $('[data-save]', s.el); b.textContent = 'Se generează…'; b.disabled = true;
      try {
        const cat = catalog.slice(0, 400).map((c) => ({ id: c.id, name: c.name, unit: c.unit, cost: num(c.cost), price: num(c.price) || catPrice(c), type: c.type }));
        const out = await aiAsk({
          system: AI_QUOTE_SYSTEM, effort: 'high', schema: AI_QUOTE_SCHEMA,
          prompt: `Moneda: ${settings.currency}\nMarja implicită: ${num(v.margin) || 20}%\nCatalogul firmei: ${JSON.stringify(cat)}\n\nDescrierea lucrării:\n${v.desc}`,
        });
        const vat = num(settings.defaultVat);
        const lines = out.lines.filter((l) => l.desc).map((l) => (l.kind === 'title'
          ? { id: uid(), kind: 'title', desc: l.desc }
          : { id: uid(), kind: 'item', catalogId: catalog.some((c) => c.id === l.catalog_id) ? l.catalog_id : '', desc: l.desc, unit: l.unit || 'buc', qty: r2(num(l.qty)), cost: r2(num(l.cost)), price: r2(num(l.price)), vat, type: KINDS[l.type] ? l.type : 'other' }));
        if (!lines.length) throw new Error('Asistentul nu a propus niciun articol');
        q.lines.push(...lines);
        toast(`Adăugate ${lines.filter((l) => l.kind === 'item').length} articole`);
        await save();
      } catch (e) {
        b.textContent = 'Salvează'; b.disabled = false;
        throw e;
      }
    },
  });
}

setTimeout(aiAutoRun, 1500);
