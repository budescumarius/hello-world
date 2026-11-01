'use strict';
/* Gestiune: clienți, catalog de prețuri, devize/oferte, facturi și încasări, costuri reale de șantier și planning (Gantt).
   Se încarcă după app.js și folosește utilitarele de acolo. Toate datele rămân pe dispozitiv (IndexedDB). */

// ---------------------------------------------------------------- Constante
const QSTATUS = {
  draft:    { label: 'Ciornă',   color: '#868e96' },
  sent:     { label: 'Trimis',   color: '#1f4fd8' },
  accepted: { label: 'Acceptat', color: '#2f9e44' },
  refused:  { label: 'Refuzat',  color: '#e5484d' },
};
const ISTATUS = {
  unpaid:  { label: 'Neîncasată',     color: '#f08c00' },
  partial: { label: 'Încasată parțial', color: '#1f4fd8' },
  paid:    { label: 'Încasată',       color: '#2f9e44' },
  overdue: { label: 'Restantă',       color: '#e5484d' },
  credit:  { label: 'Notă de credit', color: '#868e96' },
};
const KINDS = { material: 'Material', labor: 'Manoperă', equipment: 'Utilaj', subcontract: 'Subcontractare', other: 'Altele' };
const KIND_COLORS = { material: '#1f4fd8', labor: '#f08c00', equipment: '#7048e8', subcontract: '#0c8599', other: '#868e96' };
const UNITS = ['buc', 'm', 'm²', 'm³', 'kg', 't', 'l', 'h', 'zi', 'set', 'forfet'];
const PAY_METHODS = ['Transfer bancar', 'Numerar', 'Card', 'Altele'];
const DEFAULT_SETTINGS = {
  name: '', vatNo: '', regNo: '', address: '', phone: '', email: '', bank: '', iban: '',
  currency: 'EUR', vatRates: '21; 6; 0', defaultVat: 21,
  quotePrefix: 'OF', invoicePrefix: 'FA', validDays: 30, payDays: 30,
  quoteTerms: 'Prețurile sunt valabile până la data indicată. Lucrările suplimentare se facturează separat, pe baza unui deviz acceptat.',
  invoiceNotes: 'Vă rugăm să menționați numărul facturii la plată.',
  reverseText: 'Taxare inversă – TVA se datorează de către beneficiar.',
  logoId: '',
};

I.gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>';

// ---------------------------------------------------------------- Setări și utilitare
let settings = { ...DEFAULT_SETTINGS, counters: {} };
async function loadSettings() {
  const saved = (await db.get('meta', 'settings')) || {};
  settings = Object.assign({}, DEFAULT_SETTINGS, saved, { id: 'settings', counters: { ...(saved.counters || {}) } });
  return settings;
}
const saveSettings = () => db.put('meta', settings);
const vatList = () => {
  const l = String(settings.vatRates).split(/[;\s]+/).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => !isNaN(x));
  return l.length ? l : [0];
};
const vatOptions = (cur) => [...new Set([...vatList(), ...(cur == null || cur === '' ? [] : [num(cur)])])].map((r) => [r, `${fnum(r)}%`]);

const num = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? 0 : x; };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const fnum = (x, d = 2) => (x || 0).toLocaleString('ro-RO', { maximumFractionDigits: d });
let _fmt; let _fmtCur;
function money(x) {
  if (_fmtCur !== settings.currency) {
    _fmtCur = settings.currency;
    try { _fmt = new Intl.NumberFormat('ro-RO', { style: 'currency', currency: settings.currency || 'EUR' }); } catch (e) {
      _fmt = { format: (v) => `${v.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${settings.currency}` };
    }
  }
  return _fmt.format(r2(x) || 0);
}

const DAY = 864e5;
const dnum = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const dstr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (s, k) => dstr(dnum(s) + k);

async function nextNumber(kind) {
  const y = new Date().getFullYear();
  const key = `${kind}-${y}`;
  settings.counters[key] = (settings.counters[key] || 0) + 1;
  await saveSettings();
  const prefix = kind === 'quote' ? settings.quotePrefix : settings.invoicePrefix;
  return `${prefix ? prefix + '-' : ''}${y}-${String(settings.counters[key]).padStart(3, '0')}`;
}

function clientOptions(clients) {
  return [['', '— fără client —'], ...clients.map((c) => [c.id, c.name]), ['__new', '+ Client nou…']];
}

function csvBlob(rows) {
  return new Blob(['﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')], { type: 'text/csv' });
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- Calcule devize / facturi
// Un document (deviz sau factură) are `lines`: capitole { kind:'title', desc } și articole { kind:'item', desc, unit, qty, cost, price, vat, type }.
function totals(doc) {
  const d = num(doc.discount) / 100;
  const by = {}; const costBy = {};
  let net = 0; let cost = 0;
  for (const l of doc.lines || []) {
    if (l.kind === 'title') continue;
    const t = r2(num(l.qty) * num(l.price));
    const c = num(l.qty) * num(l.cost);
    net += t; cost += c;
    by[num(l.vat)] = (by[num(l.vat)] || 0) + t;
    costBy[l.type || 'other'] = (costBy[l.type || 'other'] || 0) + c;
  }
  net = r2(net);
  const discount = r2(net * d);
  const base = r2(net - discount);
  const vats = Object.keys(by).map(Number).sort((a, b) => b - a)
    .map((rate) => { const b = r2(by[rate] * (1 - d)); return { rate, base: b, vat: doc.reverse ? 0 : r2(b * rate / 100) }; })
    .filter((v) => v.base);
  const vat = r2(vats.reduce((s, v) => s + v.vat, 0));
  return { net, discount, base, vats, vat, total: r2(base + vat), cost: r2(cost), costBy, margin: r2(base - cost) };
}
function numbering(lines) {
  let s = 0; let n = 0;
  return lines.map((l) => { if (l.kind === 'title') { s++; n = 0; return String(s); } n++; return s ? `${s}.${n}` : String(n); });
}
function sectionTotals(lines) {
  const m = {}; let cur = null;
  for (const l of lines) { if (l.kind === 'title') { cur = l.id; m[cur] = 0; } else if (cur) m[cur] = r2(m[cur] + num(l.qty) * num(l.price)); }
  return m;
}
function invState(inv) {
  const t = totals(inv);
  const paid = r2((inv.payments || []).reduce((s, p) => s + num(p.amount), 0));
  const rest = r2(t.total - paid);
  let st;
  if (inv.type === 'credit') st = 'credit';
  else if (rest <= 0.005) st = 'paid';
  else if (inv.due && inv.due < today()) st = 'overdue';
  else if (paid > 0) st = 'partial';
  else st = 'unpaid';
  return { t, paid, rest, st };
}
const catPrice = (c) => (num(c.cost) > 0 ? r2(num(c.cost) * (1 + num(c.margin) / 100)) : num(c.price));
const fromCatalog = (c) => ({ id: uid(), kind: 'item', catalogId: c.id, desc: c.name, unit: c.unit || 'buc', qty: 1, cost: num(c.cost), price: num(c.price) || catPrice(c), vat: c.vat === '' || c.vat == null ? num(settings.defaultVat) : num(c.vat), type: c.type || 'material' });

// ---------------------------------------------------------------- Pagina principală (tab-uri globale)
const HOME_TABS = [['', 'Proiecte'], ['quotes', 'Devize'], ['invoices', 'Facturi'], ['planning', 'Planning'], ['clients', 'Clienți'], ['catalog', 'Catalog']];
function homeNav(on) {
  return `<nav class="tabs">${HOME_TABS.map(([k, l]) => `<a href="#/${k ? 'g/' + k : ''}" class="${k === on ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
}

async function viewGlobal(tab) {
  const t = HOME_TABS.find(([k]) => k && k === tab);
  if (!t) return go('#/');
  app.innerHTML = `${bar({ title: 'Șantier', sub: t[1], right: `<button class="icon-btn" data-act="settings" aria-label="Setări">${I.gear}</button>` })}
    ${homeNav(tab)}<main class="content" id="tab"></main>`;
  $('[data-act=settings]').onclick = editSettings;
  await ({ quotes: gQuotes, invoices: gInvoices, planning: gPlanning, clients: gClients, catalog: gCatalog })[tab]($('#tab'));
}

// Alege proiectul pentru un document nou creat din lista globală
async function pickProject(title, run) {
  const projects = (await db.all('projects')).sort((a, b) => b.created - a.created);
  const items = projects.map((p) => ({ label: p.name, run: () => run(p) }));
  items.push({ label: '+ Proiect nou', run: () => editProject() });
  actionSheet(title, items);
}

function quoteRows(list, projects, clients) {
  return list.map((q) => {
    const t = totals(q);
    const pr = projects.find((p) => p.id === q.projectId);
    const c = clients.find((x) => x.id === q.clientId);
    return `<a class="row" href="#/q/${q.id}"><span class="dot" style="--c:${QSTATUS[q.status].color}"></span>
      <span class="main"><div class="t">${esc(q.number)} · ${esc(q.title || 'Deviz')}</div>
      <div class="s">${esc([QSTATUS[q.status].label, c && c.name, pr && pr.name, fmtDate(q.date)].filter(Boolean).join(' · '))}</div></span>
      <span class="amt">${money(t.total)}</span></a>`;
  }).join('');
}
function invoiceRows(list, projects, clients) {
  return list.map((inv) => {
    const s = invState(inv);
    const pr = projects.find((p) => p.id === inv.projectId);
    const c = clients.find((x) => x.id === inv.clientId);
    return `<a class="row" href="#/i/${inv.id}"><span class="dot" style="--c:${ISTATUS[s.st].color}"></span>
      <span class="main"><div class="t">${esc(inv.number)} · ${esc(inv.label || 'Factură')}</div>
      <div class="s">${esc([ISTATUS[s.st].label, c && c.name, pr && pr.name, fmtDate(inv.date)].filter(Boolean).join(' · '))}${s.st === 'partial' || s.st === 'overdue' ? ` · rest ${money(s.rest)}` : ''}</div></span>
      <span class="amt">${money(s.t.total)}</span></a>`;
  }).join('');
}

async function gQuotes(el) {
  const [quotes, projects, clients] = await Promise.all([db.all('quotes'), db.all('projects'), db.all('clients')]);
  const f = state.qf || (state.qf = { status: '', q: '' });
  el.innerHTML = `<div class="summary">${Object.entries(QSTATUS).map(([k, s]) => {
    const l = quotes.filter((q) => q.status === k);
    return `<button class="chip ${f.status === k ? 'on' : ''}" data-st="${k}" style="--c:${s.color}"><span class="dot"></span>${s.label}: ${l.length} · ${money(l.reduce((a, q) => a + totals(q).base, 0))}</button>`;
  }).join('')}</div>
    <div class="toolbar"><input type="search" placeholder="Caută (nr., titlu, client, proiect…)" value="${esc(f.q)}" data-q></div>
    <div id="ql"></div>
    <button class="fab" data-act="new">${I.plus}<span>Deviz nou</span></button>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const list = quotes.filter((x) => (!f.status || x.status === f.status) && (!q || [x.number, x.title, (clients.find((c) => c.id === x.clientId) || {}).name, (projects.find((p) => p.id === x.projectId) || {}).name].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
    $('#ql', el).innerHTML = list.length ? `<div class="list">${quoteRows(list, projects, clients)}</div>` : empty(quotes.length ? 'Niciun deviz pentru filtrul ales' : 'Niciun deviz încă', 'Un deviz aparține unui proiect. Apasă „Deviz nou” și alege proiectul.');
  };
  $('[data-q]', el).oninput = (e) => { f.q = e.target.value; draw(); };
  $$('[data-st]', el).forEach((b) => { b.onclick = () => { f.status = f.status === b.dataset.st ? '' : b.dataset.st; render(); }; });
  $('[data-act=new]', el).onclick = () => pickProject('Deviz pentru proiectul…', createQuote);
  draw();
}

async function gInvoices(el) {
  const [invoices, projects, clients] = await Promise.all([db.all('invoices'), db.all('projects'), db.all('clients')]);
  const years = [...new Set(invoices.map((i) => (i.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const f = state.ivf || (state.ivf = { status: '', year: String(new Date().getFullYear()), q: '' });
  const inYear = invoices.filter((i) => !f.year || (i.date || '').startsWith(f.year));
  const states = inYear.map((i) => ({ inv: i, ...invState(i) }));
  const sum = (fn) => states.reduce((a, s) => a + fn(s), 0);
  el.innerHTML = `<div class="kpis">
      <div class="kpi"><small>Facturat ${esc(f.year || '')} (fără TVA)</small><b>${money(sum((s) => s.t.base))}</b></div>
      <div class="kpi good"><small>Încasat</small><b>${money(sum((s) => s.paid))}</b></div>
      <div class="kpi"><small>De încasat</small><b>${money(sum((s) => (s.st === 'credit' ? 0 : Math.max(0, s.rest))))}</b></div>
      <div class="kpi bad"><small>Restant</small><b>${money(sum((s) => (s.st === 'overdue' ? s.rest : 0)))}</b></div>
    </div>
    <div class="toolbar">
      <input type="search" placeholder="Caută (nr., client, proiect…)" value="${esc(f.q)}" data-f="q">
      <select data-f="status"><option value="">Toate</option><option value="open">De încasat (toate)</option>${Object.entries(ISTATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <select data-f="year"><option value="">Toți anii</option>${[...new Set([String(new Date().getFullYear()), ...years])].map((y) => `<option value="${y}">${y}</option>`).join('')}</select>
      <button class="btn" data-act="csv">Export CSV (contabil)</button>
    </div>
    <div id="il"></div>
    <button class="fab" data-act="new">${I.plus}<span>Factură nouă</span></button>`;
  const filtered = () => {
    const q = f.q.toLowerCase();
    return states.filter((s) => (!f.status || s.st === f.status || (f.status === 'open' && ['unpaid', 'partial', 'overdue'].includes(s.st)))
      && (!q || [s.inv.number, s.inv.label, (clients.find((c) => c.id === s.inv.clientId) || {}).name, (projects.find((p) => p.id === s.inv.projectId) || {}).name].join(' ').toLowerCase().includes(q)))
      .map((s) => s.inv).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  };
  const draw = () => {
    const list = filtered();
    $('#il', el).innerHTML = list.length ? `<div class="list">${invoiceRows(list, projects, clients)}</div>` : empty(invoices.length ? 'Nicio factură pentru filtrul ales' : 'Nicio factură încă', 'Facturile se creează dintr-un deviz (avans, situație de lucrări, finală) sau libere, în cadrul unui proiect.');
  };
  $$('[data-f]', el).forEach((inp) => {
    inp.value = f[inp.dataset.f];
    inp.addEventListener(inp.tagName === 'INPUT' ? 'input' : 'change', () => { f[inp.dataset.f] = inp.value; if (inp.dataset.f === 'year') render(); else draw(); });
  });
  $('[data-act=csv]', el).onclick = () => {
    const rows = [['Număr', 'Tip', 'Data', 'Scadența', 'Client', 'CUI client', 'Proiect', 'Bază impozabilă', 'TVA', 'Total', 'Încasat', 'Rest', 'Status', 'Monedă']];
    for (const inv of filtered().reverse()) {
      const s = invState(inv);
      const c = clients.find((x) => x.id === inv.clientId) || {};
      rows.push([inv.number, inv.label, fmtDate(inv.date), fmtDate(inv.due), c.name || '', c.vatNo || '', (projects.find((p) => p.id === inv.projectId) || {}).name || '',
        fnum(s.t.base), fnum(s.t.vat), fnum(s.t.total), fnum(s.paid), fnum(s.rest), ISTATUS[s.st].label, settings.currency]);
    }
    shareOrDownload(csvBlob(rows), `facturi-${f.year || 'toate'}-${today()}.csv`);
  };
  $('[data-act=new]', el).onclick = () => pickProject('Factură pentru proiectul…', newInvoice);
  draw();
}

// ---------------------------------------------------------------- Clienți
async function gClients(el) {
  const [clients, projects, invoices] = await Promise.all([db.all('clients'), db.all('projects'), db.all('invoices')]);
  clients.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  const f = state.clf || (state.clf = { q: '' });
  el.innerHTML = `<div class="toolbar"><input type="search" placeholder="Caută client…" value="${esc(f.q)}" data-q></div><div id="cl"></div>
    <button class="fab" data-act="new">${I.plus}<span>Client nou</span></button>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const list = clients.filter((c) => !q || [c.name, c.vatNo, c.email, c.phone, c.city, c.address].join(' ').toLowerCase().includes(q));
    $('#cl', el).innerHTML = list.length ? `<div class="list">${list.map((c) => {
      const prs = projects.filter((p) => p.clientId === c.id).length;
      const rest = invoices.filter((i) => i.clientId === c.id).reduce((a, i) => { const s = invState(i); return a + (s.st === 'credit' ? 0 : Math.max(0, s.rest)); }, 0);
      return `<button class="row" data-c="${c.id}"><span class="main"><div class="t">${esc(c.name)}</div>
        <div class="s">${esc([c.vatNo, c.phone, c.email].filter(Boolean).join(' · ') || '—')} · ${prs} proiecte</div></span>
        ${rest > 0.005 ? `<span class="chip red">de încasat ${money(rest)}</span>` : ''}</button>`;
    }).join('')}</div>` : empty(clients.length ? 'Niciun client găsit' : 'Niciun client încă', 'Adaugă clienții pentru a-i folosi în proiecte, devize și facturi.');
    $$('[data-c]', el).forEach((b) => { b.onclick = () => editClient(clients.find((c) => c.id === b.dataset.c)); });
  };
  $('[data-q]', el).oninput = (e) => { f.q = e.target.value; draw(); };
  $('[data-act=new]', el).onclick = () => editClient();
  draw();
}

function editClient(c, onSaved) {
  formSheet({
    title: c ? 'Client' : 'Client nou', values: c || { kind: 'company' },
    fields: [
      { name: 'name', label: 'Nume / denumire', required: true },
      { name: 'kind', label: 'Tip', type: 'select', options: [['company', 'Firmă'], ['person', 'Persoană fizică']], half: true },
      { name: 'vatNo', label: 'CUI / Nr. TVA', half: true },
      { name: 'regNo', label: 'Nr. Reg. Comerțului', half: true },
      { name: 'contact', label: 'Persoană de contact', half: true },
      { name: 'address', label: 'Adresă', type: 'textarea', rows: 2 },
      { name: 'phone', label: 'Telefon', type: 'tel', half: true },
      { name: 'email', label: 'Email', type: 'email', half: true },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    async onSave(v) {
      const o = Object.assign(c || { id: uid(), created: Date.now() }, v);
      await db.put('clients', o);
      if (onSaved) await onSaved(o); else render();
    },
    onDelete: c ? async () => { await db.del('clients', c.id); render(); } : null,
  });
}

// ---------------------------------------------------------------- Catalog de prețuri
async function gCatalog(el) {
  const items = (await db.all('catalog')).sort((a, b) => (a.category || '').localeCompare(b.category || '', 'ro') || a.name.localeCompare(b.name, 'ro'));
  const f = state.cf || (state.cf = { q: '', type: '' });
  el.innerHTML = `<div class="toolbar">
      <input type="search" placeholder="Caută (cod, denumire, categorie)…" value="${esc(f.q)}" data-f="q">
      <select data-f="type"><option value="">Toate tipurile</option>${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="btn" data-act="menu">${I.more}</button>
    </div><div id="cl"></div>
    <button class="fab" data-act="new">${I.plus}<span>Articol nou</span></button>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const list = items.filter((c) => (!f.type || c.type === f.type) && (!q || [c.code, c.name, c.category].join(' ').toLowerCase().includes(q)));
    let html = ''; let cat = null;
    for (const c of list) {
      if ((c.category || '') !== cat) { if (cat !== null) html += '</div>'; cat = c.category || ''; html += `<div class="section-title">${esc(cat || 'Fără categorie')}</div><div class="list">`; }
      html += `<button class="row" data-c="${c.id}"><span class="dot" style="--c:${KIND_COLORS[c.type] || '#999'}"></span><span class="main"><div class="t tw">${esc(c.name)}</div>
        <div class="s">${esc([c.code, KINDS[c.type], `cost ${money(c.cost)}`, `marjă ${fnum(num(c.margin))}%`].filter(Boolean).join(' · '))}</div></span>
        <span class="amt">${money(c.price)}<small class="muted">/${esc(c.unit)}</small></span></button>`;
    }
    if (cat !== null) html += '</div>';
    $('#cl', el).innerHTML = html || `${empty(items.length ? 'Nimic găsit' : 'Catalogul este gol', 'Adaugă articolele tale (materiale, manoperă, utilaje, subcontractări) cu cost și marjă. Le vei introduce apoi în devize cu o atingere.')}
      ${items.length ? '' : '<div class="btns" style="max-width:420px;margin:0 auto"><button class="btn" data-act="seed">Adaugă câteva articole exemplu</button><button class="btn" data-act="imp">Importă CSV</button></div>'}`;
    $$('[data-c]', el).forEach((b) => { b.onclick = () => editCatalogItem(items.find((c) => c.id === b.dataset.c)); });
    const seed = $('[data-act=seed]', el); if (seed) seed.onclick = seedCatalog;
    const imp = $('[data-act=imp]', el); if (imp) imp.onclick = importCatalog;
  };
  $$('[data-f]', el).forEach((inp) => {
    inp.value = f[inp.dataset.f];
    inp.addEventListener(inp.tagName === 'INPUT' ? 'input' : 'change', () => { f[inp.dataset.f] = inp.value; draw(); });
  });
  $('[data-act=new]', el).onclick = () => editCatalogItem();
  $('[data-act=menu]', el).onclick = () => actionSheet('Catalog', [
    { label: 'Importă din CSV / Excel', run: importCatalog },
    { label: 'Exportă CSV', run: () => exportCatalog(items) },
    { label: 'Mărește / scade prețurile cu un procent', run: () => bulkPrice(items) },
    { label: 'Adaugă articole exemplu', run: seedCatalog },
  ]);
  draw();
}

function pricingFields() {
  return [
    { name: 'cost', label: 'Cost unitar (al tău)', mode: 'decimal', half: true },
    { name: 'margin', label: 'Marjă %', mode: 'decimal', half: true },
    { name: 'price', label: 'Preț unitar vânzare (fără TVA)', mode: 'decimal', half: true },
  ];
}
// Leagă câmpurile cost / marjă / preț: modifici costul sau marja → se recalculează prețul; modifici prețul → se recalculează marja
function linkPricing(form, onChange) {
  const E = form.elements;
  const upd = (from) => {
    const cost = num(E.cost.value);
    if (from === 'price') E.margin.value = cost > 0 ? r2((num(E.price.value) / cost - 1) * 100) : '';
    else if (from && cost > 0) E.price.value = r2(cost * (1 + num(E.margin.value) / 100));
    if (onChange) onChange();
  };
  E.cost.oninput = () => upd('cost');
  E.margin.oninput = () => upd('margin');
  E.price.oninput = () => upd('price');
  upd();
}
const marginOf = (cost, price) => (num(cost) > 0 ? r2((num(price) / num(cost) - 1) * 100) : '');

async function editCatalogItem(c) {
  const all = await db.all('catalog');
  const cats = [...new Set(all.map((x) => x.category).filter(Boolean))];
  const v0 = c ? { ...c, margin: marginOf(c.cost, c.price) } : { unit: 'buc', type: 'material', vat: settings.defaultVat, margin: 20 };
  const s = formSheet({
    title: c ? 'Articol catalog' : 'Articol nou', values: v0,
    fields: [
      { name: 'name', label: 'Denumire', required: true, placeholder: 'ex. Zidărie BCA 25 cm' },
      { name: 'code', label: 'Cod', half: true },
      { name: 'category', label: 'Categorie', list: 'cats', half: true },
      { name: 'type', label: 'Tip', type: 'select', options: Object.entries(KINDS), half: true },
      { name: 'unit', label: 'UM', list: 'units', half: true },
      ...pricingFields(),
      { name: 'vat', label: 'TVA', type: 'select', options: vatOptions(v0.vat), half: true },
    ],
    extra: `<datalist id="cats">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>`,
    async onSave(v) {
      const o = Object.assign(c || { id: uid(), created: Date.now() }, v, { cost: num(v.cost), margin: num(v.margin), price: num(v.price), vat: num(v.vat) });
      await db.put('catalog', o);
      render();
    },
    onDelete: c ? async () => { await db.del('catalog', c.id); render(); } : null,
  });
  linkPricing($('form', s.el));
}

function exportCatalog(items) {
  const rows = [['Cod', 'Denumire', 'Categorie', 'UM', 'Tip', 'Cost', 'Marja', 'Pret', 'TVA']];
  for (const c of items) rows.push([c.code, c.name, c.category, c.unit, KINDS[c.type] || '', fnum(c.cost), fnum(c.margin), fnum(c.price), fnum(c.vat)]);
  shareOrDownload(csvBlob(rows), `catalog-${today()}.csv`);
}

async function importCatalog() {
  const [file] = await pickFile('.csv,text/csv,text/plain');
  if (!file) return;
  try {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) throw new Error('Fișierul nu are rânduri');
    const h = rows[0].map(norm);
    const col = (...names) => h.findIndex((x) => names.includes(x));
    const ix = { code: col('cod', 'code'), name: col('denumire', 'nume', 'descriere', 'name'), category: col('categorie', 'category', 'grupa'), unit: col('um', 'unitate', 'unit'),
      type: col('tip', 'type'), cost: col('cost', 'pretcost'), margin: col('marja', 'margin', 'marjă'), price: col('pret', 'pretvanzare', 'price'), vat: col('tva', 'vat') };
    if (ix.name < 0) throw new Error('Lipsește coloana „Denumire”');
    const existing = await db.all('catalog');
    let n = 0;
    for (const r of rows.slice(1)) {
      const g = (k) => (ix[k] >= 0 ? (r[ix[k]] || '').trim() : '');
      if (!g('name')) continue;
      const tRaw = norm(g('type'));
      const type = Object.keys(KINDS).find((k) => k === tRaw || norm(KINDS[k]) === tRaw) || 'material';
      const o = { code: g('code'), name: g('name'), category: g('category'), unit: g('unit') || 'buc', type, cost: num(g('cost')), margin: num(g('margin')), price: num(g('price')), vat: g('vat') === '' ? num(settings.defaultVat) : num(g('vat')) };
      if (!o.price) o.price = catPrice(o);
      if (o.cost && !g('margin')) o.margin = num(marginOf(o.cost, o.price));
      const same = existing.find((x) => (o.code && x.code === o.code) || (!o.code && x.name === o.name));
      await db.put('catalog', Object.assign(same || { id: uid(), created: Date.now() }, o));
      n++;
    }
    toast(`${n} articole importate / actualizate`);
    render();
  } catch (e) { toast('Import eșuat: ' + e.message, 4000); }
}

async function bulkPrice(items) {
  const p = num(prompt('Cu cât modifici costurile și prețurile? (%, ex. 5 sau -3)', '5'));
  if (!p) return;
  for (const c of items) { c.cost = r2(num(c.cost) * (1 + p / 100)); c.price = r2(num(c.price) * (1 + p / 100)); await db.put('catalog', c); }
  toast(`Prețuri actualizate cu ${fnum(p)}%`);
  render();
}

async function seedCatalog() {
  const ex = [
    ['TER-01', 'Săpătură manuală în pământ', 'Terasamente', 'm³', 'labor', 25, 25],
    ['STR-01', 'Beton C25/30 turnat în fundații', 'Structură', 'm³', 'material', 95, 20],
    ['STR-02', 'Armătură BST500 fasonată și montată', 'Structură', 'kg', 'material', 1.2, 20],
    ['ZID-01', 'Zidărie BCA 25 cm (manoperă + material)', 'Zidărie', 'm²', 'labor', 38, 25],
    ['FIN-01', 'Tencuială interioară mecanizată', 'Finisaje', 'm²', 'labor', 12, 25],
    ['FIN-02', 'Glet + vopsea lavabilă, 2 straturi', 'Finisaje', 'm²', 'labor', 9, 30],
    ['FIN-03', 'Placare gresie / faianță (manoperă)', 'Finisaje', 'm²', 'labor', 22, 25],
    ['FIN-04', 'Gresie porțelanată', 'Finisaje', 'm²', 'material', 18, 15],
    ['FAT-01', 'Termoizolație EPS 10 cm la fațadă', 'Fațadă', 'm²', 'subcontract', 30, 20],
    ['INS-01', 'Instalație electrică – punct de lumină', 'Instalații', 'buc', 'subcontract', 45, 20],
    ['DIV-01', 'Oră manoperă muncitor calificat', 'Diverse', 'h', 'labor', 28, 30],
    ['DIV-02', 'Container moloz 7 m³', 'Diverse', 'buc', 'equipment', 180, 15],
  ];
  for (const [code, name, category, unit, type, cost, margin] of ex) {
    await db.put('catalog', { id: uid(), created: Date.now(), code, name, category, unit, type, cost, margin, price: r2(cost * (1 + margin / 100)), vat: num(settings.defaultVat) });
  }
  toast('Am adăugat 12 articole exemplu – modifică-le prețurile după nevoie');
  render();
}

async function pickFromCatalog(onPick, done) {
  const items = (await db.all('catalog')).sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  if (!items.length) { toast('Catalogul este gol. Adaugă articole din pagina principală → Catalog.', 3500); return; }
  let added = 0;
  const s = sheet(`<div class="sheet-head"><span style="width:70px"></span><h2>Adaugă din catalog</h2><button class="link strong" data-close>Gata</button></div>
    <div class="sheet-body"><input type="search" class="search" placeholder="Caută articol…"><div class="muted" style="margin:8px 4px">Atinge un articol pentru a-l adăuga (poți alege mai multe).</div><div id="pick"></div></div>`,
  { full: true, onClose: () => { if (added) done(); } });
  const draw = (q = '') => {
    q = q.toLowerCase();
    const list = items.filter((c) => !q || [c.code, c.name, c.category].join(' ').toLowerCase().includes(q));
    $('#pick', s.el).innerHTML = list.length ? `<div class="list">${list.map((c) => `<button class="row" data-c="${c.id}"><span class="dot" style="--c:${KIND_COLORS[c.type] || '#999'}"></span><span class="main"><div class="t tw">${esc(c.name)}</div>
      <div class="s">${esc([c.code, c.category, KINDS[c.type]].filter(Boolean).join(' · '))}</div></span><span class="amt">${money(c.price)}<small class="muted">/${esc(c.unit)}</small></span></button>`).join('')}</div>` : empty('Nimic găsit', '');
    $$('[data-c]', s.el).forEach((b) => {
      b.onclick = () => { onPick(items.find((c) => c.id === b.dataset.c)); added++; b.classList.add('picked'); toast(`Adăugat (${added})`, 1000); };
    });
  };
  $('input', s.el).oninput = (e) => draw(e.target.value);
  draw();
}

// ---------------------------------------------------------------- Editare linii (comune devizelor și facturilor)
function linesBlock(doc, showCost) {
  if (!doc.lines.length) return `<div class="list">${empty('Niciun articol', 'Adaugă capitole (ex. „Demolări”, „Finisaje”) și articole – manual sau din catalog.')}</div>`;
  const nos = numbering(doc.lines);
  const st = sectionTotals(doc.lines);
  return `<div class="list">${doc.lines.map((l, i) => (l.kind === 'title'
    ? `<button class="row line-title" data-line="${i}"><span class="lno">${nos[i]}</span><span class="main"><div class="t tw">${esc(l.desc)}</div></span><span class="amt">${money(st[l.id])}</span></button>`
    : `<button class="row" data-line="${i}"><span class="lno">${nos[i]}</span><span class="main"><div class="t tw">${esc(l.desc)}</div>
        <div class="s">${fnum(num(l.qty), 3)} ${esc(l.unit)} × ${money(l.price)} · TVA ${fnum(num(l.vat))}%${showCost && num(l.cost) ? ` · cost ${money(l.cost)} (${KINDS[l.type] || ''})` : ''}</div></span>
        <span class="amt">${money(num(l.qty) * num(l.price))}</span></button>`)).join('')}</div>`;
}

function moveLine(lines, i, dir) {
  if (lines[i].kind !== 'title') {
    const j = i + dir;
    if (j >= 0 && j < lines.length) [lines[i], lines[j]] = [lines[j], lines[i]];
    return;
  }
  // un capitol se mută împreună cu articolele lui
  const nextT = (from) => { for (let k = from; k < lines.length; k++) if (lines[k].kind === 'title') return k; return lines.length; };
  const end = nextT(i + 1);
  if (dir < 0) {
    let p = -1;
    for (let k = i - 1; k >= 0; k--) if (lines[k].kind === 'title') { p = k; break; }
    if (p < 0) return;
    lines.splice(p, 0, ...lines.splice(i, end - i));
  } else {
    if (end >= lines.length) return;
    const blk = lines.splice(end, nextT(end + 1) - end);
    lines.splice(i, 0, ...blk);
  }
}

function editLine(doc, idx, save, kind, showCost) {
  const isNew = idx < 0;
  const l = isNew
    ? (kind === 'title' ? { id: uid(), kind: 'title', desc: '' } : { id: uid(), kind: 'item', desc: '', unit: 'buc', qty: 1, cost: 0, price: 0, vat: num(settings.defaultVat), type: 'material' })
    : doc.lines[idx];
  let op = null;
  const ops = isNew ? '' : `<div class="btns"><button type="button" class="btn small" data-op="-1">↑ Mută sus</button><button type="button" class="btn small" data-op="1">↓ Mută jos</button><button type="button" class="btn small" data-op="dup">Duplică</button></div>`;
  const isTitle = l.kind === 'title';
  const fields = isTitle
    ? [{ name: 'desc', label: 'Denumire capitol', required: true, placeholder: 'ex. Demolări, Zidărie, Finisaje' }]
    : [
      { name: 'desc', label: 'Descriere', type: 'textarea', rows: 3, required: true },
      { name: 'qty', label: 'Cantitate', mode: 'decimal', half: true },
      { name: 'unit', label: 'UM', list: 'units', half: true },
      ...(showCost ? pricingFields() : [{ name: 'price', label: 'Preț unitar (fără TVA)', mode: 'decimal', half: true }]),
      { name: 'vat', label: 'TVA', type: 'select', options: vatOptions(l.vat), half: true },
      ...(showCost ? [{ name: 'type', label: 'Tip (pentru urmărirea costurilor)', type: 'select', options: Object.entries(KINDS), half: true }] : []),
    ];
  const s = formSheet({
    title: isTitle ? (isNew ? 'Capitol nou' : 'Capitol') : (isNew ? 'Articol nou' : 'Articol'),
    values: { ...l, margin: marginOf(l.cost, l.price) },
    fields,
    extra: `<datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      ${isTitle ? '' : `<div class="totals"><div class="tr"><span>Total linie (fără TVA)</span><b id="ltot"></b></div></div>`}
      ${!isTitle && isNew && showCost ? '<div class="inline-checks"><label><input type="checkbox" name="toCat">Salvează articolul și în catalog</label></div>' : ''}
      ${ops}`,
    async onSave(v) {
      if (isTitle) l.desc = v.desc;
      else {
        Object.assign(l, { desc: v.desc, unit: v.unit, qty: num(v.qty), price: num(v.price), vat: num(v.vat) });
        if (showCost) Object.assign(l, { cost: num(v.cost), type: v.type });
      }
      if (isNew) doc.lines.push(l);
      else if (op === 'dup') {
        if (isTitle) {
          let end = idx + 1;
          while (end < doc.lines.length && doc.lines[end].kind !== 'title') end++;
          doc.lines.splice(end, 0, ...doc.lines.slice(idx, end).map((x) => ({ ...structuredClone(x), id: uid() })));
        } else doc.lines.splice(idx + 1, 0, { ...structuredClone(l), id: uid() });
      } else if (op) moveLine(doc.lines, idx, +op);
      const toCat = $('[name=toCat]', s.el);
      if (toCat && toCat.checked) {
        await db.put('catalog', { id: uid(), created: Date.now(), code: '', name: l.desc, category: '', unit: l.unit, type: l.type, cost: l.cost, margin: num(marginOf(l.cost, l.price)), price: l.price, vat: l.vat });
        l.catalogId = '';
      }
      await save();
    },
    onDelete: isNew ? null : async () => {
      if (isTitle) {
        const keep = confirm('Ștergi și articolele din acest capitol?\n\nOK = da, șterge tot capitolul\nAnulează = păstrează articolele');
        let end = idx + 1;
        if (keep) while (end < doc.lines.length && doc.lines[end].kind !== 'title') end++;
        doc.lines.splice(idx, end - idx);
      } else doc.lines.splice(idx, 1);
      await save();
    },
  });
  $$('[data-op]', s.el).forEach((b) => { b.onclick = () => { op = b.dataset.op; $('[data-save]', s.el).click(); }; });
  if (!isTitle) {
    const form = $('form', s.el);
    const showTot = () => { $('#ltot', form).textContent = money(num(form.elements.qty.value) * num(form.elements.price.value)); };
    if (showCost) linkPricing(form, showTot); else form.elements.price.oninput = showTot;
    form.elements.qty.oninput = showTot;
    showTot();
    if (isNew) setTimeout(() => form.elements.desc.focus(), 250);
  }
}

function totalsCard(t, doc, internal) {
  return `<div class="totals">
    <div class="tr"><span>Total fără TVA</span><b>${money(t.net)}</b></div>
    ${t.discount ? `<div class="tr"><span>Discount ${fnum(num(doc.discount))}%</span><b>−${money(t.discount)}</b></div><div class="tr"><span>Bază impozabilă</span><b>${money(t.base)}</b></div>` : ''}
    ${doc.reverse ? '<div class="tr"><span>TVA – taxare inversă</span><b>0</b></div>' : t.vats.map((v) => `<div class="tr"><span>TVA ${fnum(v.rate)}% (bază ${money(v.base)})</span><b>${money(v.vat)}</b></div>`).join('')}
    <div class="tr big"><span>Total</span><span>${money(t.total)}</span></div>
    ${internal ? `<div class="tr int"><span>Cost estimat (intern)</span><span>${money(t.cost)}</span></div>
      <div class="tr int"><span>Marjă brută (intern)</span><span>${money(t.margin)}${t.base ? ` · ${fnum((t.margin / t.base) * 100, 1)}%` : ''}</span></div>` : ''}
  </div>`;
}

function headFields(isQuote, clients) {
  return [
    { name: 'title', label: isQuote ? 'Obiectul ofertei' : 'Denumire factură', required: true },
    { name: 'clientId', label: 'Client', type: 'select', options: clientOptions(clients) },
    { name: 'date', label: 'Data', type: 'date', half: true },
    isQuote ? { name: 'valid', label: 'Valabilă până la', type: 'date', half: true } : { name: 'due', label: 'Scadența', type: 'date', half: true },
    { name: 'discount', label: 'Discount global (%)', mode: 'decimal', half: true },
    { name: 'reverse', label: 'Regim TVA', type: 'select', options: [['', 'Normal'], ['1', 'Taxare inversă']], half: true },
    ...(isQuote ? [{ name: 'intro', label: 'Text introductiv (apare în PDF)', type: 'textarea', rows: 3 }] : []),
    { name: 'notes', label: isQuote ? 'Condiții / mențiuni' : 'Mențiuni pe factură', type: 'textarea', rows: 4 },
  ];
}
function editHead(doc, isQuote, clients, save) {
  formSheet({
    title: isQuote ? 'Date deviz' : 'Date factură',
    values: { ...doc, title: isQuote ? doc.title : doc.label, reverse: doc.reverse ? '1' : '' },
    fields: headFields(isQuote, clients),
    async onSave(v) {
      const newClient = v.clientId === '__new';
      Object.assign(doc, v, { discount: num(v.discount), reverse: !!v.reverse, clientId: newClient ? doc.clientId : v.clientId });
      if (!isQuote) { doc.label = v.title; delete doc.title; }
      await save();
      if (newClient) editClient(null, async (c) => { doc.clientId = c.id; await save(); });
    },
  });
}

// ---------------------------------------------------------------- Devize
async function tabQuotes(pr, el) {
  const [quotes, clients] = await Promise.all([db.where('quotes', pr.id), db.all('clients')]);
  quotes.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const acc = quotes.filter((q) => q.status === 'accepted');
  el.innerHTML = `${quotes.length ? `<div class="kpis">
      <div class="kpi"><small>Devize</small><b>${quotes.length}</b></div>
      <div class="kpi good"><small>Acceptate (fără TVA)</small><b>${money(acc.reduce((a, q) => a + totals(q).base, 0))}</b></div>
      <div class="kpi"><small>În așteptare</small><b>${money(quotes.filter((q) => q.status === 'sent' || q.status === 'draft').reduce((a, q) => a + totals(q).base, 0))}</b></div>
    </div><div class="list">${quoteRows(quotes, [pr], clients)}</div>`
    : empty('Niciun deviz', 'Creează un deviz cu capitole și articole (manual sau din catalog), apoi trimite-l clientului ca PDF.')}
    <button class="fab" data-act="new">${I.plus}<span>Deviz nou</span></button>`;
  $('[data-act=new]', el).onclick = () => createQuote(pr);
}

async function createQuote(pr) {
  const q = {
    id: uid(), projectId: pr.id, number: await nextNumber('quote'), title: pr.name, date: today(), valid: addDays(today(), num(settings.validDays) || 30),
    status: 'draft', clientId: pr.clientId || '', discount: 0, reverse: false, intro: '', notes: settings.quoteTerms, lines: [], created: Date.now(),
  };
  await db.put('quotes', q);
  go(`#/q/${q.id}`);
}

async function viewQuote(id) {
  const q = await db.get('quotes', id);
  if (!q) return go('#/g/quotes');
  const [pr, clients] = await Promise.all([db.get('projects', q.projectId), db.all('clients')]);
  clients.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  const c = clients.find((x) => x.id === q.clientId);
  const t = totals(q);
  const save = async () => { q.updated = Date.now(); await db.put('quotes', q); render(); };
  app.innerHTML = `${bar({ back: pr ? `#/p/${pr.id}/quotes` : '#/g/quotes', title: `Deviz ${q.number}`, sub: pr ? pr.name : '',
    right: `<a class="btn small primary" href="#/doc/q/${q.id}">${I.print} PDF</a><button class="icon-btn" data-act="more" aria-label="Acțiuni">${I.more}</button>` })}
  <main class="content">
    <button class="card head-card" data-act="head">
      <div class="card-title">${esc(q.title || 'Deviz')}</div>
      <div class="muted">${c ? esc(c.name) : '<span class="overdue">Fără client – atinge pentru a alege</span>'}</div>
      <div class="muted">Data ${fmtDate(q.date)} · valabil până la ${fmtDate(q.valid)}${q.discount ? ` · discount ${fnum(q.discount)}%` : ''}${q.reverse ? ' · taxare inversă' : ''}</div>
    </button>
    <div class="seg" style="margin:12px 0">${Object.entries(QSTATUS).map(([k, s]) => `<button type="button" data-qs="${k}" style="--c:${s.color}" class="${q.status === k ? 'on' : ''}">${s.label}</button>`).join('')}</div>
    ${linesBlock(q, true)}
    <div class="btns" style="margin:12px 0"><button class="btn" data-add="title">+ Capitol</button><button class="btn" data-add="item">+ Articol</button><button class="btn primary" data-add="cat">+ Din catalog</button></div>
    ${totalsCard(t, q, true)}
    <div class="muted" style="margin:10px 4px">Costul și marja sunt doar pentru tine – nu apar în PDF-ul trimis clientului.</div>
  </main>`;
  $('[data-act=head]').onclick = () => editHead(q, true, clients, save);
  $$('[data-qs]').forEach((b) => { b.onclick = () => { q.status = b.dataset.qs; if (q.status === 'accepted') q.acceptedAt = Date.now(); save(); }; });
  $$('[data-line]').forEach((b) => { b.onclick = () => editLine(q, +b.dataset.line, save, null, true); });
  $('[data-add=title]').onclick = () => editLine(q, -1, save, 'title', true);
  $('[data-add=item]').onclick = () => editLine(q, -1, save, 'item', true);
  $('[data-add=cat]').onclick = () => pickFromCatalog((ci) => q.lines.push(fromCatalog(ci)), save);
  $('[data-act=more]').onclick = () => actionSheet(`Deviz ${q.number}`, [
    { label: 'Creează factură din deviz…', run: () => invoiceFromQuote(q) },
    { label: 'Generează planning din capitole', run: () => planFromQuote(q) },
    { label: 'Editează datele devizului', run: () => editHead(q, true, clients, save) },
    { label: 'Duplică devizul (variantă nouă)', run: async () => {
      const n = { ...structuredClone(q), id: uid(), number: await nextNumber('quote'), status: 'draft', date: today(), valid: addDays(today(), num(settings.validDays) || 30), created: Date.now() };
      delete n.acceptedAt;
      await db.put('quotes', n); toast(`Creat devizul ${n.number}`); go(`#/q/${n.id}`);
    } },
    { label: 'Șterge devizul', danger: true, run: async () => { if (confirm(`Ștergi devizul ${q.number}?`)) { await db.del('quotes', q.id); go(pr ? `#/p/${pr.id}/quotes` : '#/g/quotes'); } } },
  ]);
}

// ---------------------------------------------------------------- Facturi
async function tabInvoices(pr, el) {
  const [invoices, clients] = await Promise.all([db.where('invoices', pr.id), db.all('clients')]);
  invoices.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  const st = invoices.map(invState);
  el.innerHTML = `${invoices.length ? `<div class="kpis">
      <div class="kpi"><small>Facturat (fără TVA)</small><b>${money(st.reduce((a, s) => a + s.t.base, 0))}</b></div>
      <div class="kpi good"><small>Încasat</small><b>${money(st.reduce((a, s) => a + s.paid, 0))}</b></div>
      <div class="kpi ${st.some((s) => s.st === 'overdue') ? 'bad' : ''}"><small>De încasat</small><b>${money(st.reduce((a, s) => a + (s.st === 'credit' ? 0 : Math.max(0, s.rest)), 0))}</b></div>
    </div><div class="list">${invoiceRows(invoices, [pr], clients)}</div>`
    : empty('Nicio factură', 'Creează facturi din devize (integral, avans, situații de lucrări, finală) sau facturi libere.')}
    <button class="fab" data-act="new">${I.plus}<span>Factură nouă</span></button>`;
  $('[data-act=new]', el).onclick = () => newInvoice(pr);
}

async function newInvoice(pr) {
  const quotes = (await db.where('quotes', pr.id)).sort((a, b) => (b.status === 'accepted') - (a.status === 'accepted') || b.created - a.created);
  const items = quotes.map((q) => ({ label: `Din devizul ${q.number} (${QSTATUS[q.status].label}, ${money(totals(q).base)})`, run: () => invoiceFromQuote(q) }));
  items.push({ label: 'Factură liberă (fără deviz)', run: () => createInvoice(pr, {}) });
  if (items.length === 1) return items[0].run();
  actionSheet('Factură nouă', items);
}

async function createInvoice(pr, o) {
  const inv = Object.assign({
    id: uid(), projectId: pr.id, quoteId: '', type: 'invoice', kind: 'free', label: 'Factură', date: today(), due: addDays(today(), num(settings.payDays)),
    clientId: pr.clientId || '', discount: 0, reverse: false, lines: [], payments: [], notes: settings.invoiceNotes, created: Date.now(),
  }, o);
  inv.number = await nextNumber('invoice');
  await db.put('invoices', inv);
  toast(`Factura ${inv.number} a fost creată`);
  go(`#/i/${inv.id}`);
}

async function invoiceFromQuote(q) {
  const pr = await db.get('projects', q.projectId);
  if (!pr) return;
  const prev = (await db.all('invoices')).filter((i) => i.quoteId === q.id);
  const d = num(q.discount) / 100;
  const base = { quoteId: q.id, clientId: q.clientId || pr.clientId || '', reverse: !!q.reverse };
  const qt = totals(q);
  const prevBase = (list) => {
    const m = {};
    for (const i of list) for (const v of totals(i).vats) m[v.rate] = r2((m[v.rate] || 0) + v.base);
    return m;
  };
  const discounted = (l) => (l.kind === 'title' ? { ...l, id: uid() } : { ...l, id: uid(), price: r2(num(l.price) * (1 - d)), srcId: l.id });
  const many = qt.vats.length > 1;
  if (prev.length && !confirm(`Pentru acest deviz există deja ${prev.length} factur${prev.length > 1 ? 'i' : 'ă'} (${prev.map((i) => i.number).join(', ')}). Continui?`)) return;

  actionSheet(`Factură din devizul ${q.number}`, [
    { label: `Integrală – toate articolele (${money(qt.base)} + TVA)`, run: () => createInvoice(pr, { ...base, kind: 'full', label: 'Factură', discount: num(q.discount), lines: q.lines.map((l) => ({ ...l, id: uid() })) }) },
    { label: 'Avans – un procent din deviz', run: () => {
      const p = num(prompt('Procent avans (%)', '30'));
      if (!p) return;
      createInvoice(pr, { ...base, kind: 'advance', label: 'Factură de avans', lines: qt.vats.map((v) => ({ id: uid(), kind: 'item', desc: `Avans ${fnum(p)}% conform ofertei ${q.number}${many ? ` (cota TVA ${fnum(v.rate)}%)` : ''}`, unit: 'forfet', qty: 1, price: r2(v.base * p / 100), vat: v.rate, cost: 0, type: 'other' })) });
    } },
    { label: 'Situație de lucrări – % realizat pe articole', run: () => progressSheet(q, prev, pr, base) },
    { label: 'Finală – soldul rămas de facturat', run: () => {
      const pb = prevBase(prev);
      const lines = q.lines.map(discounted);
      const nums = prev.map((i) => i.number).join(', ');
      if (Object.values(pb).some((b) => Math.abs(b) > 0.005)) lines.push({ id: uid(), kind: 'title', desc: 'Deduceri' });
      for (const [rate, b] of Object.entries(pb)) if (Math.abs(b) > 0.005) lines.push({ id: uid(), kind: 'item', desc: `Deducere facturi anterioare (${nums})${many ? ` – TVA ${fnum(+rate)}%` : ''}`, unit: 'forfet', qty: 1, price: -b, vat: +rate, cost: 0, type: 'other' });
      createInvoice(pr, { ...base, kind: 'final', label: 'Factură finală', lines });
    } },
  ]);
}

function progressSheet(q, prev, pr, base) {
  const d = num(q.discount) / 100;
  const nos = numbering(q.lines);
  const prevPct = (id) => Math.max(0, ...prev.filter((i) => i.progress).map((i) => num(i.progress[id])));
  const advances = prev.filter((i) => i.kind === 'advance');
  const situations = prev.filter((i) => i.kind === 'progress').length;
  const s = sheet(`<div class="sheet-head"><button class="link" data-close>Anulează</button><h2>Situație de lucrări nr. ${situations + 1}</h2><button class="link strong" data-ok>Creează</button></div>
    <div class="sheet-body form">
      <div class="muted">Completează procentul <b>cumulat</b> realizat pentru fiecare articol. Se facturează diferența față de situațiile anterioare.</div>
      <div class="btns"><button type="button" class="btn small" data-all="100">Toate la 100%</button><button type="button" class="btn small" data-all="prev">Resetează</button></div>
      <div class="list">${q.lines.map((l, i) => (l.kind === 'title'
        ? `<div class="row line-title" style="cursor:default"><span class="lno">${nos[i]}</span><span class="main"><div class="t tw">${esc(l.desc)}</div></span></div>`
        : `<label class="row prow" style="cursor:default"><span class="lno">${nos[i]}</span><span class="main"><div class="t tw">${esc(l.desc)}</div>
            <div class="s">${money(num(l.qty) * num(l.price) * (1 - d))} · anterior ${fnum(prevPct(l.id))}%</div></span>
            <input data-pid="${l.id}" data-prev="${prevPct(l.id)}" inputmode="decimal" value="${prevPct(l.id)}"><span>%</span></label>`)).join('')}</div>
      ${advances.length ? `<div class="inline-checks"><label><input type="checkbox" name="ded" checked>Deduc avansul proporțional (${advances.map((a) => a.number).join(', ')})</label></div>` : ''}
      <div class="totals"><div class="tr big"><span>De facturat (fără TVA)</span><span id="ptot"></span></div></div>
    </div>`, { full: true });
  const inputs = $$('[data-pid]', s.el);
  const lineOf = (id) => q.lines.find((l) => l.id === id);
  const calc = () => inputs.reduce((a, inp) => { const l = lineOf(inp.dataset.pid); return a + num(l.qty) * num(l.price) * (1 - d) * (Math.min(100, num(inp.value)) - num(inp.dataset.prev)) / 100; }, 0);
  const upd = () => { $('#ptot', s.el).textContent = money(calc()); };
  inputs.forEach((inp) => { inp.oninput = upd; });
  $$('[data-all]', s.el).forEach((b) => { b.onclick = () => { inputs.forEach((inp) => { inp.value = b.dataset.all === 'prev' ? inp.dataset.prev : 100; }); upd(); }; });
  upd();
  $('[data-ok]', s.el).onclick = async () => {
    const progress = {};
    const lines = [];
    let pendingTitle = null;
    const byRate = {};
    for (const l of q.lines) {
      if (l.kind === 'title') { pendingTitle = l; continue; }
      const inp = inputs.find((x) => x.dataset.pid === l.id);
      const cum = Math.min(100, Math.max(0, num(inp.value)));
      const pv = num(inp.dataset.prev);
      progress[l.id] = Math.max(cum, pv);
      const delta = cum - pv;
      if (Math.abs(delta) < 0.0001) continue;
      if (pendingTitle) { lines.push({ ...pendingTitle, id: uid() }); pendingTitle = null; }
      const qty = Math.round(num(l.qty) * delta / 100 * 1000) / 1000;
      const price = r2(num(l.price) * (1 - d));
      lines.push({ ...l, id: uid(), srcId: l.id, desc: `${l.desc} (realizat cumulat ${fnum(cum)}%, anterior ${fnum(pv)}%)`, qty, price });
      byRate[num(l.vat)] = (byRate[num(l.vat)] || 0) + qty * price;
    }
    if (!lines.length) return toast('Nu există progres nou de facturat');
    const ded = $('[name=ded]', s.el);
    if (ded && ded.checked) {
      const qv = Object.fromEntries(totals(q).vats.map((v) => [v.rate, v.base]));
      const adv = {};
      for (const a of advances) for (const v of totals(a).vats) adv[v.rate] = (adv[v.rate] || 0) + v.base;
      if (Object.keys(byRate).some((r) => adv[r] && qv[r]) && lines.some((l) => l.kind === 'title')) lines.push({ id: uid(), kind: 'title', desc: 'Deduceri' });
      for (const [rate, b] of Object.entries(byRate)) {
        if (!adv[rate] || !qv[rate]) continue;
        const amount = r2(adv[rate] * b / qv[rate]);
        if (amount) lines.push({ id: uid(), kind: 'item', desc: `Deducere avans proporțional (${advances.map((a) => a.number).join(', ')})`, unit: 'forfet', qty: 1, price: -amount, vat: +rate, cost: 0, type: 'other' });
      }
    }
    s.close();
    createInvoice(pr, { ...base, kind: 'progress', label: `Situație de lucrări nr. ${situations + 1}`, lines, progress });
  };
}

async function viewInvoice(id) {
  const inv = await db.get('invoices', id);
  if (!inv) return go('#/g/invoices');
  const [pr, clients, quote] = await Promise.all([db.get('projects', inv.projectId), db.all('clients'), inv.quoteId ? db.get('quotes', inv.quoteId) : null]);
  clients.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  const c = clients.find((x) => x.id === inv.clientId);
  const s = invState(inv);
  inv.payments = inv.payments || [];
  const save = async () => { inv.updated = Date.now(); await db.put('invoices', inv); render(); };
  const back = pr ? `#/p/${pr.id}/invoices` : '#/g/invoices';
  app.innerHTML = `${bar({ back, title: `${inv.type === 'credit' ? 'Notă de credit' : 'Factura'} ${inv.number}`, sub: pr ? pr.name : '',
    right: `<a class="btn small primary" href="#/doc/i/${inv.id}">${I.print} PDF</a><button class="icon-btn" data-act="more" aria-label="Acțiuni">${I.more}</button>` })}
  <main class="content">
    <button class="card head-card" data-act="head">
      <div class="card-title">${esc(inv.label || 'Factură')} <span class="chip" style="vertical-align:middle"><span class="dot" style="--c:${ISTATUS[s.st].color}"></span>${ISTATUS[s.st].label}</span></div>
      <div class="muted">${c ? esc(c.name) : '<span class="overdue">Fără client – atinge pentru a alege</span>'}</div>
      <div class="muted">Data ${fmtDate(inv.date)} · scadența ${fmtDate(inv.due)}${quote ? ` · din devizul ${esc(quote.number)}` : ''}${inv.reverse ? ' · taxare inversă' : ''}</div>
    </button>
    <div class="section-title">Articole</div>
    ${linesBlock(inv, false)}
    <div class="btns" style="margin:12px 0"><button class="btn" data-add="title">+ Capitol</button><button class="btn" data-add="item">+ Articol</button><button class="btn" data-add="cat">+ Din catalog</button></div>
    ${totalsCard(s.t, inv, false)}
    ${inv.type === 'credit' ? '' : `<div class="section-title">Încasări</div>
    <div class="list">${inv.payments.length ? inv.payments.map((p, i) => `<button class="row" data-pay="${i}"><span class="main"><div class="t">${money(p.amount)}</div><div class="s">${fmtDate(p.date)} · ${esc(p.method || '')}${p.note ? ' · ' + esc(p.note) : ''}</div></span></button>`).join('') : '<div class="row" style="cursor:default"><span class="muted">Nicio încasare înregistrată.</span></div>'}</div>
    <div class="totals" style="margin-top:12px"><div class="tr"><span>Încasat</span><b>${money(s.paid)}</b></div><div class="tr big"><span>Rest de încasat</span><span class="${s.st === 'overdue' ? 'overdue' : ''}">${money(s.rest)}</span></div></div>
    <button class="fab" data-act="pay">${I.plus}<span>Încasare</span></button>`}
  </main>`;
  $('[data-act=head]').onclick = () => editHead(inv, false, clients, save);
  $$('[data-line]').forEach((b) => { b.onclick = () => editLine(inv, +b.dataset.line, save, null, false); });
  $('[data-add=title]').onclick = () => editLine(inv, -1, save, 'title', false);
  $('[data-add=item]').onclick = () => editLine(inv, -1, save, 'item', false);
  $('[data-add=cat]').onclick = () => pickFromCatalog((ci) => inv.lines.push(fromCatalog(ci)), save);
  const editPay = (i) => {
    const p = i == null ? { date: today(), amount: Math.max(0, s.rest), method: PAY_METHODS[0] } : inv.payments[i];
    formSheet({
      title: i == null ? 'Încasare nouă' : 'Încasare', values: p,
      fields: [
        { name: 'amount', label: `Sumă (${settings.currency})`, mode: 'decimal', required: true, half: true },
        { name: 'date', label: 'Data', type: 'date', half: true },
        { name: 'method', label: 'Metodă', type: 'select', options: PAY_METHODS.map((m) => [m, m]) },
        { name: 'note', label: 'Notă' },
      ],
      async onSave(v) { Object.assign(p, v, { amount: num(v.amount) }); if (i == null) inv.payments.push(p); await save(); },
      onDelete: i == null ? null : async () => { inv.payments.splice(i, 1); await save(); },
    });
  };
  $$('[data-pay]').forEach((b) => { b.onclick = () => editPay(+b.dataset.pay); });
  const payBtn = $('[data-act=pay]'); if (payBtn) payBtn.onclick = () => editPay(null);
  $('[data-act=more]').onclick = () => actionSheet(`Factura ${inv.number}`, [
    { label: 'Editează datele facturii', run: () => editHead(inv, false, clients, save) },
    ...(inv.type === 'credit' ? [] : [{ label: 'Emite notă de credit (stornare)', run: async () => {
      if (!confirm(`Creezi o notă de credit care anulează factura ${inv.number}?`)) return;
      await createInvoice(pr || { id: inv.projectId }, {
        type: 'credit', kind: 'credit', label: 'Notă de credit', quoteId: inv.quoteId, clientId: inv.clientId, discount: inv.discount, reverse: inv.reverse, refInvoice: inv.number,
        lines: inv.lines.map((l) => (l.kind === 'title' ? { ...l, id: uid() } : { ...l, id: uid(), qty: -num(l.qty) })), notes: `Stornare factura ${inv.number} din ${fmtDate(inv.date)}.`,
      });
    } }]),
    ...(quote ? [{ label: `Deschide devizul ${quote.number}`, run: () => go(`#/q/${quote.id}`) }] : []),
    { label: 'Șterge factura', danger: true, run: async () => {
      if (confirm(`Ștergi factura ${inv.number}?\n\nAtenție: o factură emisă către client se anulează de regulă printr-o notă de credit, nu prin ștergere.`)) { await db.del('invoices', inv.id); go(back); }
    } },
  ]);
}

// ---------------------------------------------------------------- Document PDF (deviz / factură)
async function viewDoc(kind, id) {
  const isQuote = kind === 'q';
  const d = await db.get(isQuote ? 'quotes' : 'invoices', id);
  if (!d) return go('#/');
  const [pr, clients, logo] = await Promise.all([db.get('projects', d.projectId), db.all('clients'), settings.logoId ? blobURL(settings.logoId) : '']);
  const c = clients.find((x) => x.id === d.clientId) || {};
  const pdfName = `${isQuote ? 'Oferta' : d.type === 'credit' ? 'Nota-credit' : 'Factura'}-${d.number}`;
  const docTitle = isQuote ? 'Ofertă de preț' : d.type === 'credit' ? 'Notă de credit' : (d.label || 'Factură');
  const st = isQuote ? null : invState(d);
  const t = isQuote ? totals(d) : st.t;
  const nos = numbering(d.lines);
  const secT = sectionTotals(d.lines);
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const html = `<div class="fhead">
      <div class="from">${logo ? `<img class="logo" src="${logo}" alt="">` : ''}<b style="font-size:15px">${esc(settings.name || 'Numele firmei tale (completează în Setări)')}</b>
        <div>${nl(settings.address)}</div>
        <div>${esc([settings.vatNo && 'CUI/TVA: ' + settings.vatNo, settings.regNo && 'Reg. Com.: ' + settings.regNo].filter(Boolean).join(' · '))}</div>
        <div>${esc([settings.phone, settings.email].filter(Boolean).join(' · '))}</div></div>
      <div class="meta"><h1>${esc(docTitle)}</h1><div>Nr. <b>${esc(d.number)}</b></div><div>Data: <b>${fmtDate(d.date)}</b></div>
        ${isQuote ? `<div>Valabilă până la: <b>${fmtDate(d.valid)}</b></div>` : `<div>Scadența: <b>${fmtDate(d.due)}</b></div>`}
        ${d.refInvoice ? `<div>Referință: factura ${esc(d.refInvoice)}</div>` : ''}</div>
    </div>
    <div class="parties">
      <div class="box"><small>Client</small><b>${esc(c.name || pr?.client || '—')}</b>${c.address ? `<div>${nl(c.address)}</div>` : ''}
        <div>${esc([c.vatNo && 'CUI/TVA: ' + c.vatNo, c.regNo && 'Reg. Com.: ' + c.regNo].filter(Boolean).join(' · '))}</div>
        <div>${esc([c.contact, c.phone, c.email].filter(Boolean).join(' · '))}</div></div>
      <div class="box"><small>${isQuote ? 'Obiect / șantier' : 'Proiect / șantier'}</small><b>${esc(isQuote ? d.title : (pr ? pr.name : ''))}</b>${pr && pr.address ? `<div>${esc(pr.address)}</div>` : ''}</div>
    </div>
    ${isQuote && d.intro ? `<p class="pre">${esc(d.intro)}</p>` : ''}
    <table class="flines"><thead><tr><th>Nr.</th><th>Descriere</th><th>UM</th><th class="r">Cant.</th><th class="r">Preț unitar</th><th class="r">TVA</th><th class="r">Total</th></tr></thead><tbody>
    ${d.lines.map((l, i) => (l.kind === 'title'
    ? `<tr class="sec"><td><b>${nos[i]}</b></td><td colspan="5"><b>${esc(l.desc)}</b></td><td class="r"><b>${money(secT[l.id])}</b></td></tr>`
    : `<tr><td>${nos[i]}</td><td class="pre">${esc(l.desc)}</td><td>${esc(l.unit)}</td><td class="r">${fnum(num(l.qty), 3)}</td><td class="r">${money(l.price)}</td><td class="r">${fnum(num(l.vat))}%</td><td class="r">${money(num(l.qty) * num(l.price))}</td></tr>`)).join('') || '<tr><td colspan="7">—</td></tr>'}
    </tbody></table>
    <table class="ftot">
      <tr><td>Total fără TVA</td><td class="r">${money(t.net)}</td></tr>
      ${t.discount ? `<tr><td>Discount ${fnum(num(d.discount))}%</td><td class="r">−${money(t.discount)}</td></tr><tr><td>Bază impozabilă</td><td class="r">${money(t.base)}</td></tr>` : ''}
      ${d.reverse ? '<tr><td>TVA (taxare inversă)</td><td class="r">0</td></tr>' : t.vats.map((v) => `<tr><td>TVA ${fnum(v.rate)}% din ${money(v.base)}</td><td class="r">${money(v.vat)}</td></tr>`).join('')}
      <tr class="big"><td>Total ${isQuote ? '' : 'de plată'}</td><td class="r">${money(t.total)}</td></tr>
      ${st && st.paid ? `<tr><td>Încasat</td><td class="r">${money(st.paid)}</td></tr><tr class="big"><td>Rest de plată</td><td class="r">${money(st.rest)}</td></tr>` : ''}
    </table>
    ${d.reverse ? `<p><b>${esc(settings.reverseText)}</b></p>` : ''}
    ${d.notes ? `<p class="pre">${esc(d.notes)}</p>` : ''}
    ${!isQuote && d.type !== 'credit' && (settings.iban || settings.bank) ? `<div class="box" style="margin-top:12px"><small>Date de plată</small>${settings.bank ? `Banca: <b>${esc(settings.bank)}</b><br>` : ''}${settings.iban ? `IBAN: <b>${esc(settings.iban)}</b><br>` : ''}Referință plată: <b>${esc(d.number)}</b></div>` : ''}
    ${isQuote ? `<div class="sign"><div>Pentru ${esc(settings.name || 'furnizor')}<br>Semnătura</div><div>Pentru acord – Client<br>Nume, data și semnătura</div></div>` : ''}`;
  app.innerHTML = `${bar({ back: isQuote ? `#/q/${id}` : `#/i/${id}`, title: `${docTitle} ${d.number}`, sub: pr ? pr.name : '', right: `<button class="btn small primary" data-act="print">${I.print} PDF</button>` })}
    <main class="content"><div class="doc fin">${html}</div>
    <div class="muted no-print" style="margin:12px 4px">Pe iPhone/iPad: apasă „PDF”, apoi în ecranul de tipărire Partajează → Salvează în Fișiere, Mail sau WhatsApp.${settings.name ? '' : ' Completează datele firmei din Setări (rotița din pagina principală) ca să apară pe documente.'}</div></main>`;
  $('[data-act=print]').onclick = () => {
    const old = document.title;
    document.title = pdfName; // numele propus pentru fișierul PDF
    window.print();
    setTimeout(() => { document.title = old; }, 1000);
  };
}

// ---------------------------------------------------------------- Costuri reale + situație financiară
async function tabCosts(pr, el) {
  const [quotes, invoices, costs] = await Promise.all([db.where('quotes', pr.id), db.where('invoices', pr.id), db.where('costs', pr.id)]);
  const acc = quotes.filter((q) => q.status === 'accepted').map(totals);
  const budget = acc.reduce((a, t) => a + t.base, 0);
  const est = acc.reduce((a, t) => a + t.cost, 0);
  const estBy = {}; acc.forEach((t) => Object.entries(t.costBy).forEach(([k, v]) => { estBy[k] = (estBy[k] || 0) + v; }));
  const real = costs.reduce((a, c) => a + num(c.amount), 0);
  const realBy = {}; costs.forEach((c) => { realBy[c.type || 'other'] = (realBy[c.type || 'other'] || 0) + num(c.amount); });
  const ist = invoices.map(invState);
  const invoiced = ist.reduce((a, s) => a + s.t.base, 0);
  const cashed = ist.reduce((a, s) => a + s.paid, 0);
  const hours = costs.filter((c) => c.kind === 'hours').reduce((a, c) => a + num(c.hours), 0);
  const f = state.costf || (state.costf = { type: '' });
  const usedPct = est ? Math.round((real / est) * 100) : 0;
  el.innerHTML = `<div class="kpis">
      <div class="kpi"><small>Buget (devize acceptate)</small><b>${money(budget)}</b></div>
      <div class="kpi"><small>Cost estimat</small><b>${money(est)}</b></div>
      <div class="kpi ${est && real > est ? 'bad' : ''}"><small>Cost real${est ? ` (${usedPct}% din estimat)` : ''}</small><b>${money(real)}</b>${est ? `<div class="meter"><i style="width:${Math.min(100, usedPct)}%;--c:${real > est ? '#e5484d' : '#2f9e44'}"></i></div>` : ''}</div>
      <div class="kpi ${budget - real < 0 ? 'bad' : 'good'}"><small>Profit estimat</small><b>${money(budget - Math.max(real, est))}</b></div>
      <div class="kpi"><small>Facturat (fără TVA)</small><b>${money(invoiced)}</b>${budget ? `<div class="meter"><i style="width:${Math.min(100, (invoiced / budget) * 100)}%"></i></div>` : ''}</div>
      <div class="kpi"><small>Încasat (cu TVA)</small><b>${money(cashed)}</b></div>
      <div class="kpi ${invoiced - real < 0 ? 'bad' : ''}"><small>Rezultat curent (facturat − cost real)</small><b>${money(invoiced - real)}</b></div>
      <div class="kpi"><small>Ore lucrate</small><b>${fnum(hours, 1)} h</b></div>
    </div>
    ${!acc.length ? '<div class="muted" style="margin:0 4px 12px">Marchează un deviz ca „Acceptat” pentru a avea buget și cost estimat de comparat.</div>' : ''}
    <div class="section-title">Estimat vs. real pe tipuri</div>
    <div class="list">${Object.entries(KINDS).filter(([k]) => estBy[k] || realBy[k]).map(([k, l]) => {
      const e = estBy[k] || 0; const r = realBy[k] || 0;
      return `<div class="row" style="cursor:default"><span class="dot" style="--c:${KIND_COLORS[k]}"></span><span class="main"><div class="t">${l}</div>
        <div class="s">Estimat ${money(e)} · Real ${money(r)}</div><div class="meter"><i style="width:${e ? Math.min(100, (r / e) * 100) : 100}%;--c:${r > e ? '#e5484d' : KIND_COLORS[k]}"></i></div></span>
        <span class="amt ${r > e ? 'overdue' : ''}">${r > e ? '+' : ''}${money(r - e)}</span></div>`;
    }).join('') || '<div class="row" style="cursor:default"><span class="muted">Încă nu există costuri.</span></div>'}</div>
    <div class="section-title">Cheltuieli și ore</div>
    <div class="summary"><button class="chip ${!f.type ? 'on' : ''}" data-t="">Toate (${costs.length})</button>${Object.entries(KINDS).map(([k, l]) => `<button class="chip ${f.type === k ? 'on' : ''}" data-t="${k}" style="--c:${KIND_COLORS[k]}"><span class="dot"></span>${l}</button>`).join('')}</div>
    <div id="costl"></div>
    <button class="fab" data-act="add">${I.plus}<span>Cost</span></button>`;
  const list = costs.filter((c) => !f.type || c.type === f.type).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const thumbs = await Promise.all(list.map((c) => (c.photoId ? blobURL(c.photoId) : '')));
  $('#costl', el).innerHTML = list.length ? `<div class="list">${list.map((c, i) => `<button class="row" data-cost="${c.id}"><span class="dot" style="--c:${KIND_COLORS[c.type] || '#999'}"></span>
      <span class="main"><div class="t">${esc(c.desc || (c.kind === 'hours' ? `Ore – ${c.worker || ''}` : 'Cheltuială'))}</div>
      <div class="s">${esc([fmtDate(c.date), KINDS[c.type], c.kind === 'hours' ? `${c.worker || ''} · ${fnum(num(c.hours), 2)} h × ${money(c.rate)}` : c.supplier].filter(Boolean).join(' · '))}</div></span>
      ${thumbs[i] ? `<img class="thumb" src="${thumbs[i]}" alt="">` : ''}<span class="amt">${money(c.amount)}</span></button>`).join('')}</div>`
    : empty('Nicio cheltuială', 'Înregistrează facturile de la furnizori, bonurile și orele lucrate ca să vezi costul real față de deviz.');
  $$('[data-t]', el).forEach((b) => { b.onclick = () => { f.type = b.dataset.t; render(); }; });
  $$('[data-cost]', el).forEach((b) => { b.onclick = () => { const c = costs.find((x) => x.id === b.dataset.cost); editCost(pr, c.kind, c, costs); }; });
  $('[data-act=add]', el).onclick = () => actionSheet('Adaugă', [
    { label: 'Cheltuială (factură furnizor, bon, subcontractor)', run: () => editCost(pr, 'expense', null, costs) },
    { label: 'Ore lucrate (manoperă proprie)', run: () => editCost(pr, 'hours', null, costs) },
  ]);
}

async function editCost(pr, kind, c, costs) {
  const companies = await db.where('companies', pr.id);
  const isHours = kind === 'hours';
  const lastHours = costs.filter((x) => x.kind === 'hours').sort((a, b) => b.created - a.created)[0];
  const v0 = c || (isHours ? { date: today(), type: 'labor', hours: 8, rate: lastHours ? lastHours.rate : '', worker: lastHours ? lastHours.worker : '' } : { date: today(), type: 'material' });
  let photoId = v0.photoId || '';
  const added = [];
  let saved = false;
  const suppliers = [...new Set([...companies.map((x) => x.name), ...costs.map((x) => x.supplier).filter(Boolean)])];
  const workers = [...new Set(costs.map((x) => x.worker).filter(Boolean))];
  const s = formSheet({
    title: isHours ? (c ? 'Ore lucrate' : 'Ore lucrate – adaugă') : (c ? 'Cheltuială' : 'Cheltuială nouă'),
    values: v0,
    fields: isHours ? [
      { name: 'worker', label: 'Muncitor / echipă', list: 'workers', required: true },
      { name: 'date', label: 'Data', type: 'date', half: true },
      { name: 'hours', label: 'Ore', mode: 'decimal', half: true },
      { name: 'rate', label: `Cost orar (${settings.currency})`, mode: 'decimal', half: true },
      { name: 'type', label: 'Tip', type: 'select', options: Object.entries(KINDS), half: true },
      { name: 'desc', label: 'Activitate', placeholder: 'ex. Zidărie etaj 1' },
    ] : [
      { name: 'desc', label: 'Descriere', required: true, placeholder: 'ex. Factură materiale Dedeman' },
      { name: 'date', label: 'Data', type: 'date', half: true },
      { name: 'type', label: 'Tip', type: 'select', options: Object.entries(KINDS), half: true },
      { name: 'supplier', label: 'Furnizor', list: 'suppliers', half: true },
      { name: 'amount', label: `Sumă fără TVA (${settings.currency})`, mode: 'decimal', required: true, half: true },
      { name: 'ref', label: 'Nr. document furnizor' },
    ],
    extra: `<datalist id="suppliers">${suppliers.map((x) => `<option value="${esc(x)}">`).join('')}</datalist><datalist id="workers">${workers.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      ${isHours ? '<div class="totals"><div class="tr"><span>Cost</span><b id="htot"></b></div></div>' : '<div class="field"><span>Document (foto bon / factură)</span><div class="photos" id="cph"></div></div>'}`,
    onClose: () => { if (!saved) added.forEach(delBlob); },
    async onSave(v) {
      const o = Object.assign(c || { id: uid(), projectId: pr.id, kind, created: Date.now() }, v);
      if (isHours) { o.hours = num(v.hours); o.rate = num(v.rate); o.amount = r2(o.hours * o.rate); } else { o.amount = num(v.amount); o.photoId = photoId; }
      if (c && c.photoId && c.photoId !== photoId) await delBlob(c.photoId);
      saved = true;
      await db.put('costs', o);
      render();
    },
    onDelete: c ? async () => { await delBlob(c.photoId); saved = true; await db.del('costs', c.id); render(); } : null,
  });
  const form = $('form', s.el);
  if (isHours) {
    const upd = () => { $('#htot', form).textContent = money(num(form.elements.hours.value) * num(form.elements.rate.value)); };
    form.elements.hours.oninput = upd; form.elements.rate.oninput = upd; upd();
    return;
  }
  const drawPh = async () => {
    const box = $('#cph', form);
    const u = photoId ? await blobURL(photoId) : '';
    box.innerHTML = u ? `<img src="${u}" alt="Document" data-ph>` : `<label class="add">${I.camera}<span>Foto</span><input type="file" accept="image/*"></label>`;
    if (u) {
      $('[data-ph]', box).onclick = () => photoViewer(photoId, {
        onDelete() { photoId = ''; drawPh(); },
        onReplace(id) { added.push(id); photoId = id; drawPh(); },
      });
    } else {
      $('input', box).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const r = await resizeImage(await blobToImg(file), 2000, 'image/jpeg', 0.85);
        photoId = await saveBlob(r.blob); added.push(photoId); drawPh();
      };
    }
  };
  drawPh();
}

// ---------------------------------------------------------------- Planning (Gantt)
const ZOOMS = { day: ['Zile', 34], week: ['Săptămâni', 14], month: ['Luni', 5] };
const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const taskColor = (t) => (num(t.progress) >= 100 ? '#2f9e44' : t.end < today() ? '#e5484d' : t.start <= today() ? '#f08c00' : '#1f4fd8');

function ganttHTML(rows) {
  const tasks = rows.filter((r) => r.task).map((r) => r.task);
  if (!tasks.length) return '';
  const zoom = ZOOMS[state.gzoom] ? state.gzoom : 'week';
  const dw = ZOOMS[zoom][1];
  const t0 = dnum(today());
  let a = Math.min(t0, ...tasks.map((t) => dnum(t.start))) - 3;
  a -= (new Date(a * DAY).getUTCDay() + 6) % 7; // începe într-o zi de luni
  const b = Math.max(t0, ...tasks.map((t) => dnum(t.end))) + (zoom === 'month' ? 30 : 10);
  const days = b - a + 1;
  const W = days * dw;
  let months = ''; let ticks = ''; let we = '';
  for (let i = 0; i < days; i++) {
    const dt = new Date((a + i) * DAY);
    const dd = dt.getUTCDate(); const wd = dt.getUTCDay();
    if (dd === 1 || i === 0) {
      let len = 0; while (i + len < days && (len === 0 || new Date((a + i + len) * DAY).getUTCDate() !== 1)) len++;
      months += `<div class="g-m" style="left:${i * dw}px;width:${len * dw}px">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
    }
    if (zoom === 'day') ticks += `<div class="g-d ${wd === 0 || wd === 6 ? 'we' : ''}" style="left:${i * dw}px;width:${dw}px">${dd}</div>`;
    else if (zoom === 'week' && wd === 1) ticks += `<div class="g-d" style="left:${i * dw}px;width:${7 * dw}px;text-align:left;padding-left:3px">${dd}</div>`;
    if (wd === 6 && zoom !== 'month') we += `<div class="g-we" style="left:${i * dw}px;width:${2 * dw}px"></div>`;
  }
  const todayX = (t0 - a) * dw;
  return `<div class="gantt" id="gantt" data-today="${todayX}"><div class="g-inner" style="width:calc(var(--nw) + ${W}px)">
    <div class="g-over" style="width:${W}px">${we}<div class="g-today" style="left:${todayX + dw / 2}px"></div></div>
    <div class="g-row g-head"><div class="g-name"><small>Sarcină</small></div><div class="g-track" style="width:${W}px">${months}${ticks}</div></div>
    ${rows.map((r) => {
      if (!r.task) return `<div class="g-row g-group"><a class="g-name" href="${r.href || '#'}"><b>${esc(r.label)}</b></a><div class="g-track" style="width:${W}px"></div></div>`;
      const t = r.task;
      const x = (dnum(t.start) - a) * dw; const w = (dnum(t.end) - dnum(t.start) + 1) * dw;
      const p = Math.min(100, Math.max(0, num(t.progress)));
      return `<div class="g-row"><button class="g-name" data-task="${t.id}"><b>${esc(t.name)}</b><small>${fmtDate(t.start).slice(0, 5)} – ${fmtDate(t.end).slice(0, 5)}${r.sub ? ' · ' + esc(r.sub) : ''}</small></button>
        <div class="g-track" style="width:${W}px"><button class="g-bar" data-task="${t.id}" style="left:${x}px;width:${w}px;--c:${taskColor(t)}"><span class="g-fill" style="width:${p}%"></span><span class="g-lbl">${p}%${w > 120 ? ' · ' + esc(t.name) : ''}</span></button></div></div>`;
    }).join('')}
  </div></div>`;
}
function bindGantt(el, onTask) {
  $$('[data-z]', el).forEach((b) => { b.onclick = () => { state.gzoom = b.dataset.z; render(); }; });
  $$('[data-task]', el).forEach((b) => { b.onclick = () => onTask(b.dataset.task); });
  const g = $('#gantt', el);
  if (g) g.scrollLeft = Math.max(0, +g.dataset.today - 60);
}
const zoomChips = () => `<div class="summary">${Object.entries(ZOOMS).map(([k, [l]]) => `<button class="chip ${(ZOOMS[state.gzoom] ? state.gzoom : 'week') === k ? 'on' : ''}" data-z="${k}">${l}</button>`).join('')}
  <span class="chip"><span class="dot" style="--c:#1f4fd8"></span>Planificat</span><span class="chip"><span class="dot" style="--c:#f08c00"></span>În lucru</span><span class="chip"><span class="dot" style="--c:#e5484d"></span>Întârziat</span><span class="chip"><span class="dot" style="--c:#2f9e44"></span>Gata</span></div>`;
const sortTasks = (l) => l.sort((a, b) => a.start.localeCompare(b.start) || (a.order || 0) - (b.order || 0) || a.created - b.created);

async function tabPlanning(pr, el) {
  const [tasks, companies, quotes] = await Promise.all([db.where('tasks', pr.id), db.where('companies', pr.id), db.where('quotes', pr.id)]);
  sortTasks(tasks);
  const late = tasks.filter((t) => t.end < today() && num(t.progress) < 100).length;
  el.innerHTML = `${tasks.length ? `${zoomChips()}
    <div class="muted" style="margin:0 4px 8px">${tasks.length} sarcini · ${tasks.filter((t) => num(t.progress) >= 100).length} terminate${late ? ` · <span class="overdue">${late} întârziate</span>` : ''} · ${fmtDate(tasks[0].start)} – ${fmtDate(tasks.reduce((m, t) => (t.end > m ? t.end : m), tasks[0].end))}</div>
    ${ganttHTML(tasks.map((t) => ({ task: t, sub: (companies.find((c) => c.id === t.companyId) || {}).name })))}`
    : empty('Niciun planning', 'Adaugă etapele lucrării cu date de început și sfârșit, sau generează-le automat din capitolele unui deviz.')}
    ${quotes.length ? `<div class="btns" style="margin-top:12px"><button class="btn" data-act="gen">Generează din capitolele unui deviz</button></div>` : ''}
    <button class="fab" data-act="add">${I.plus}<span>Sarcină</span></button>`;
  bindGantt(el, (id) => editTask(pr, tasks.find((t) => t.id === id), companies));
  $('[data-act=add]', el).onclick = () => editTask(pr, null, companies);
  const gen = $('[data-act=gen]', el);
  if (gen) gen.onclick = () => (quotes.length === 1 ? planFromQuote(quotes[0]) : actionSheet('Din care deviz?', quotes.map((q) => ({ label: `${q.number} · ${q.title || ''} (${QSTATUS[q.status].label})`, run: () => planFromQuote(q) }))));
}

function editTask(pr, t, companies) {
  const start = t ? t.start : today();
  formSheet({
    title: t ? 'Sarcină' : 'Sarcină nouă',
    values: t || { start, end: addDays(start, 4), progress: 0 },
    fields: [
      { name: 'name', label: 'Denumire', required: true, placeholder: 'ex. Turnare fundații' },
      { name: 'start', label: 'Început', type: 'date', required: true, half: true },
      { name: 'end', label: 'Sfârșit', type: 'date', required: true, half: true },
      { name: 'progress', label: 'Progres', type: 'select', options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => [p, `${p}%`]), half: true },
      { name: 'companyId', label: 'Echipă / firmă', type: 'select', options: [['', '— proprie —'], ...companies.map((c) => [c.id, c.name])], half: true },
      { name: 'notes', label: 'Note', type: 'textarea', rows: 2 },
    ],
    async onSave(v) {
      if (v.end < v.start) [v.start, v.end] = [v.end, v.start];
      await db.put('tasks', Object.assign(t || { id: uid(), projectId: pr.id, created: Date.now() }, v, { progress: num(v.progress) }));
      render();
    },
    onDelete: t ? async () => { await db.del('tasks', t.id); render(); } : null,
  });
}

async function planFromQuote(q) {
  const titles = q.lines.filter((l) => l.kind === 'title');
  if (!titles.length) return toast('Devizul nu are capitole. Adaugă capitole ca să poată fi transformate în etape.', 3500);
  const pr = await db.get('projects', q.projectId);
  const days = num(prompt(`Se creează ${titles.length} etape consecutive, câte una pentru fiecare capitol.\nDurata implicită a unei etape (zile calendaristice):`, '7'));
  if (!days) return;
  let start = pr.start && pr.start > today() ? pr.start : today();
  let order = Date.now();
  for (const l of titles) {
    const end = addDays(start, days - 1);
    await db.put('tasks', { id: uid(), projectId: q.projectId, name: l.desc, start, end, progress: 0, companyId: '', notes: `Din devizul ${q.number}`, created: Date.now(), order: order++ });
    start = addDays(end, 1);
  }
  toast(`${titles.length} etape adăugate în planning`);
  go(`#/p/${q.projectId}/planning`);
}

async function gPlanning(el) {
  const [tasks, projects, companies] = await Promise.all([db.all('tasks'), db.all('projects'), db.all('companies')]);
  const rows = [];
  for (const pr of projects.sort((a, b) => a.name.localeCompare(b.name, 'ro'))) {
    const pt = sortTasks(tasks.filter((t) => t.projectId === pr.id));
    if (!pt.length) continue;
    rows.push({ label: pr.name, href: `#/p/${pr.id}/planning` });
    pt.forEach((t) => rows.push({ task: t, sub: (companies.find((c) => c.id === t.companyId) || {}).name }));
  }
  const thisWeek = tasks.filter((t) => t.start <= addDays(today(), 7) && t.end >= today() && num(t.progress) < 100);
  el.innerHTML = rows.length ? `${zoomChips()}
    <div class="muted" style="margin:0 4px 8px">Toate șantierele · ${thisWeek.length} sarcini active în următoarele 7 zile</div>${ganttHTML(rows)}`
    : empty('Niciun planning', 'Deschide un proiect → tabul „Planning” și adaugă etape sau generează-le dintr-un deviz.');
  bindGantt(el, (id) => {
    const t = tasks.find((x) => x.id === id);
    editTask(projects.find((p) => p.id === t.projectId), t, companies.filter((c) => c.projectId === t.projectId));
  });
}

// ---------------------------------------------------------------- Setări firmă
async function editSettings() {
  await loadSettings();
  const y = new Date().getFullYear();
  let logoId = settings.logoId;
  const added = [];
  let saved = false;
  const s = formSheet({
    title: 'Firma mea și setări',
    values: { ...settings, nextQuote: (settings.counters[`quote-${y}`] || 0) + 1, nextInvoice: (settings.counters[`invoice-${y}`] || 0) + 1 },
    fields: [
      { name: 'name', label: 'Denumirea firmei' },
      { name: 'vatNo', label: 'CUI / Nr. TVA', half: true },
      { name: 'regNo', label: 'Nr. Reg. Comerțului', half: true },
      { name: 'address', label: 'Adresă', type: 'textarea', rows: 2 },
      { name: 'phone', label: 'Telefon', type: 'tel', half: true },
      { name: 'email', label: 'Email', type: 'email', half: true },
      { name: 'bank', label: 'Banca', half: true },
      { name: 'iban', label: 'IBAN', half: true },
      { name: 'currency', label: 'Moneda (cod: EUR, RON, USD…)', half: true },
      { name: 'vatRates', label: 'Cote TVA (separate prin ;)', half: true },
      { name: 'defaultVat', label: 'Cota TVA implicită', mode: 'decimal', half: true },
      { name: 'validDays', label: 'Valabilitate ofertă (zile)', mode: 'numeric', half: true },
      { name: 'quotePrefix', label: 'Prefix devize', half: true },
      { name: 'nextQuote', label: `Următorul nr. deviz ${y}`, mode: 'numeric', half: true },
      { name: 'invoicePrefix', label: 'Prefix facturi', half: true },
      { name: 'nextInvoice', label: `Următorul nr. factură ${y}`, mode: 'numeric', half: true },
      { name: 'payDays', label: 'Termen de plată (zile)', mode: 'numeric' },
      { name: 'quoteTerms', label: 'Condiții implicite pe devize', type: 'textarea', rows: 3 },
      { name: 'invoiceNotes', label: 'Mențiuni implicite pe facturi', type: 'textarea', rows: 2 },
      { name: 'reverseText', label: 'Mențiune taxare inversă', type: 'textarea', rows: 2 },
    ],
    extra: '<div class="field"><span>Logo (apare pe devize și facturi)</span><div class="photos" id="logo"></div></div>',
    onClose: () => { if (!saved) added.forEach(delBlob); },
    async onSave(v) {
      const nq = Math.max(1, Math.round(num(v.nextQuote))); const ni = Math.max(1, Math.round(num(v.nextInvoice)));
      delete v.nextQuote; delete v.nextInvoice;
      if (settings.logoId && settings.logoId !== logoId) await delBlob(settings.logoId);
      Object.assign(settings, v, { currency: (v.currency || 'EUR').toUpperCase().slice(0, 3), defaultVat: num(v.defaultVat), validDays: num(v.validDays), payDays: num(v.payDays), logoId });
      settings.counters[`quote-${y}`] = nq - 1;
      settings.counters[`invoice-${y}`] = ni - 1;
      saved = true;
      await saveSettings();
      toast('Setări salvate');
      render();
    },
  });
  const drawLogo = async () => {
    const box = $('#logo', s.el);
    const u = logoId ? await blobURL(logoId) : '';
    box.innerHTML = (u ? `<img src="${u}" alt="Logo" style="object-fit:contain;background:#fff" data-rm>` : '') + `<label class="add">${I.camera}<span>${u ? 'Schimbă' : 'Adaugă'}</span><input type="file" accept="image/*"></label>`;
    const rm = $('[data-rm]', box);
    if (rm) rm.onclick = () => { if (confirm('Elimini logo-ul?')) { logoId = ''; drawLogo(); } };
    $('input', box).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = await resizeImage(await blobToImg(f), 600, 'image/png');
      logoId = await saveBlob(r.blob); added.push(logoId); drawLogo();
    };
  };
  drawLogo();
}
