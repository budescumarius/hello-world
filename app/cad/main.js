// Proiectare: interfața aplicației (unelte, proprietăți, niveluri, cantități, sarcini, export).
import { MATERIALS, USES, TYPE_NAMES, newProject, sampleProject, quantities, takeoff, byId, sortedStoreys, storeyOf, polyArea } from './model.js';
import { A, emit, on, snapshot, undo, redo, deleteElements } from './state.js';
import { PlanEditor } from './editor2d.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d }));
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }

// ---------------------------------------------------------------- încărcare / salvare locală
const KEY = 'cad:project';
try { const s = localStorage.getItem(KEY); A.p = s ? JSON.parse(s) : sampleProject(); } catch { A.p = sampleProject(); }
A.storey = sortedStoreys(A.p)[0].id;
let saveT;
function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(A.p)); } catch { toast('Proiectul nu a putut fi salvat local (spațiu plin?)'); } }, 400); }

// ---------------------------------------------------------------- editoare
const plan = new PlanEditor($('#plan'), {
  numBox: $('#num'),
  status: (msg, err) => { const s = $('#status'); s.textContent = msg; s.className = err ? 'err' : ''; if (err) toast(msg); },
});
let view3d = null;
async function ensure3D() {
  if (view3d) return view3d;
  const { View3D } = await import('./view3d.js');
  view3d = new View3D($('#v3d'));
  return view3d;
}

// ---------------------------------------------------------------- unelte
const ICONS = {
  select: '<path d="M5 3l13 8-6 1.5L9 19z"/>',
  wall: '<path d="M3 9h18v6H3z"/><path d="M7 9v6M12 9v6M17 9v6"/>',
  door: '<path d="M4 20V4"/><path d="M4 4a16 16 0 0116 16"/><path d="M4 20h16" stroke-dasharray="2 2"/>',
  window: '<path d="M3 9h18v6H3z"/><path d="M3 12h18M8 9v6M16 9v6"/>',
  slab: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M3 9v3l9 5 9-5V9"/>',
  column: '<path d="M8 3h8v18H8z"/><path d="M8 3l8 18M16 3L8 21"/>',
  beam: '<path d="M2 9h20v5H2z" stroke-dasharray="3 2"/>',
  roof: '<path d="M2 13l10-8 10 8"/><path d="M5 11v8h14v-8"/>',
  zone: '<path d="M4 4h16v16H4z" stroke-dasharray="3 2"/><path d="M8 13h8M10 10h4"/>',
  dim: '<path d="M3 17h18M3 13v8M21 13v8"/><path d="M8 9h8"/>',
};
const TOOLS = [['select', 'Selecție', 'V'], 'hr', ['wall', 'Perete', 'W'], ['door', 'Ușă', 'D'], ['window', 'Fereastră', 'F'], ['column', 'Stâlp', 'C'], ['beam', 'Grindă', 'B'], ['slab', 'Placă', 'S'], ['roof', 'Acoperiș', 'R'], 'hr', ['zone', 'Zonă', 'Z'], ['dim', 'Cotă', 'Q']];
function renderTools() {
  $('#tools').innerHTML = TOOLS.map((t) => (t === 'hr' ? '<hr>' : `<button data-tool="${t[0]}" class="${A.tool === t[0] ? 'on' : ''}" title="${t[1]} (${t[2]})"><kbd>${t[2]}</kbd><svg viewBox="0 0 24 24">${ICONS[t[0]]}</svg>${t[1]}</button>`)).join('');
}
function setTool(t) {
  plan.cancelDraw();
  A.tool = t;
  if (t !== 'select') { A.sel.clear(); }
  renderTools(); renderSide(); plan.status(); plan.invalidate(); view3d?.invalidate('sel');
  $('#plan').focus();
}
$('#tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });

// ---------------------------------------------------------------- niveluri
function renderStoreys() {
  const ss = sortedStoreys(A.p).reverse();
  $('#storey').innerHTML = ss.map((s) => `<option value="${s.id}" ${s.id === A.storey ? 'selected' : ''}>${esc(s.name)} (${s.elev >= 0 ? '+' : ''}${fmt(s.elev)})</option>`).join('');
}
$('#storey').onchange = (e) => { A.storey = e.target.value; plan.cancelDraw(); A.sel.clear(); emit('storey'); };
$('#b-storeys').onclick = storeysDialog;

async function storeysDialog() {
  const d = $('#dlg');
  const rows = () => sortedStoreys(A.p).reverse().map((s) => `<tr data-id="${s.id}"><td><input class="field" data-k="name" value="${esc(s.name)}" style="width:150px"></td>
    <td><input class="field" type="number" step="0.01" data-k="elev" value="${s.elev}" style="width:90px"></td>
    <td><input class="field" type="number" step="0.01" min="1" data-k="height" value="${s.height}" style="width:90px"></td>
    <td><button type="button" class="ibtn" data-del="${s.id}" title="Șterge nivelul">✕</button></td></tr>`).join('');
  d.innerHTML = `<form method="dialog"><h2>Niveluri</h2>
    <table class="tbl"><thead><tr><th>Nume</th><th>Cotă ±0,00 (m)</th><th>Înălțime nivel (m)</th><th></th></tr></thead><tbody id="st-rows">${rows()}</tbody></table>
    <div class="acts"><button type="button" class="btn" id="st-add">+ Nivel deasupra</button></div>
    <p class="small">Înălțimea nivelului = distanța de la cota acestui nivel până la cota nivelului următor (include placa).</p>
    <div class="btns"><button class="btn" value="cancel">Renunță</button><button class="btn primary" value="ok">Aplică</button></div></form>`;
  const tbody = $('#st-rows', d);
  let work = JSON.parse(JSON.stringify(A.p.storeys));
  const read = () => { for (const tr of tbody.querySelectorAll('tr')) { const s = work.find((x) => x.id === tr.dataset.id); s.name = $('[data-k=name]', tr).value.trim() || s.name; s.elev = +$('[data-k=elev]', tr).value; s.height = Math.max(1, +$('[data-k=height]', tr).value || 3); } };
  $('#st-add', d).onclick = () => {
    read();
    const top = sortedStoreysOf(work).at(-1);
    const id = 's' + (Math.max(0, ...work.map((s) => +s.id.slice(1) || 0)) + 1);
    work.push({ id, name: `Etaj ${work.length}`, elev: Math.round((top.elev + top.height) * 100) / 100, height: top.height });
    A.p.storeys = work; tbody.innerHTML = rows(); work = JSON.parse(JSON.stringify(A.p.storeys));
  };
  tbody.onclick = (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    read();
    if (work.length < 2) return toast('Proiectul trebuie să aibă cel puțin un nivel');
    const n = A.p.elements.filter((x) => x.storey === b.dataset.del).length;
    if (n && !confirmInline(b, `Nivelul are ${n} elemente – apasă din nou pentru ștergere`)) return;
    work = work.filter((s) => s.id !== b.dataset.del);
    b.closest('tr').remove();
  };
  const backup = JSON.stringify(A.p.storeys);
  d.onclose = () => {
    if (d.returnValue !== 'ok') { A.p.storeys = JSON.parse(backup); emit('storey'); return; }
    read();
    snapshot();
    const removed = A.p.storeys.map((s) => s.id).filter((id) => !work.some((s) => s.id === id));
    A.p.storeys = JSON.parse(backup);
    if (removed.length) deleteElements(A.p.elements.filter((x) => removed.includes(x.storey)).map((x) => x.id));
    A.p.storeys = work;
    if (!work.some((s) => s.id === A.storey)) A.storey = sortedStoreys(A.p)[0].id;
    emit('model'); emit('storey');
  };
  d.returnValue = '';
  d.showModal();
}
const sortedStoreysOf = (list) => [...list].sort((a, b) => a.elev - b.elev);
function confirmInline(btn, msg) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; btn.textContent = '!'; toast(msg);
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = '✕'; }, 2500);
  return false;
}

// ---------------------------------------------------------------- panoul de proprietăți
const matOpts = (filter) => Object.entries(MATERIALS).filter(([, m]) => !filter || filter(m)).map(([k, m]) => [k, m.name]);
const FIELDS = {
  wall: [['thickness', 'Grosime (cm)', 'cm'], ['height', 'Înălțime (m)', 'm'], ['base', 'Decalaj bază (m)', 'm'], ['material', 'Material', 'sel', matOpts((m) => m.kind !== 'acoperis')], ['bearing', 'Perete portant (preia încărcări)', 'chk'], ['exterior', 'Perete exterior', 'chk'], ['plaster', 'Tencuit pe ambele fețe', 'chk']],
  door: [['width', 'Lățime (m)', 'm'], ['height', 'Înălțime (m)', 'm'], ['sill', 'Prag (m)', 'm'], ['flip', 'Deschidere pe partea cealaltă', 'chk'], ['name', 'Denumire', 'text']],
  window: [['width', 'Lățime (m)', 'm'], ['height', 'Înălțime (m)', 'm'], ['sill', 'Parapet (m)', 'm'], ['name', 'Denumire', 'text']],
  slab: [['thickness', 'Grosime (cm)', 'cm'], ['offset', 'Decalaj față de nivel (m)', 'm'], ['material', 'Material', 'sel', matOpts((m) => ['beton', 'lemn', 'otel'].includes(m.kind))], ['use', 'Folosință (încărcare utilă)', 'sel', Object.entries(USES).map(([k, u]) => [k, `${u.name} · ${u.q} kN/m²`])], ['finishes', 'Straturi permanente (kN/m²)', 'num'], ['mode', 'Mod de desen', 'sel', [['rect', 'Dreptunghi'], ['poly', 'Poligon'], ['auto', 'Clic în cameră (automat)']], 'tool']],
  column: [['w', 'Latura x (cm)', 'cm'], ['d', 'Latura y (cm)', 'cm'], ['height', 'Înălțime (m)', 'm'], ['material', 'Material', 'sel', matOpts((m) => ['beton', 'lemn', 'otel', 'zidarie'].includes(m.kind))]],
  beam: [['w', 'Lățime (cm)', 'cm'], ['h', 'Înălțime (cm)', 'cm'], ['material', 'Material', 'sel', matOpts((m) => ['beton', 'lemn', 'otel'].includes(m.kind))]],
  roof: [['kind', 'Tip', 'sel', [['gable', 'În două ape'], ['mono', 'Într-o apă'], ['flat', 'Terasă (plat)']]], ['slope', 'Pantă (°)', 'num'], ['axis', 'Coama / panta pe', 'sel', [['x', 'Direcția X'], ['y', 'Direcția Y']]], ['offset', 'Cota streașinii față de nivel (m)', 'm'], ['thickness', 'Grosime (cm)', 'cm'], ['dead', 'Greutate învelitoare + șarpantă (kN/m²)', 'num'], ['material', 'Material', 'sel', matOpts((m) => ['acoperis', 'beton', 'lemn'].includes(m.kind))], ['mode', 'Mod de desen', 'sel', [['rect', 'Dreptunghi'], ['poly', 'Poligon']], 'tool']],
  zone: [['name', 'Nume', 'text'], ['number', 'Număr', 'text'], ['mode', 'Mod de desen', 'sel', [['auto', 'Clic în cameră (automat)'], ['rect', 'Dreptunghi'], ['poly', 'Poligon']], 'tool']],
  dim: [],
};
function fieldHtml([k, label, kind, opts, only], v, isTool) {
  if (only === 'tool' && !isTool) return '';
  const id = 'f-' + k;
  if (kind === 'chk') return `<label class="chkrow"><input type="checkbox" id="${id}" data-k="${k}" data-kind="chk" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
  let input;
  if (kind === 'sel') input = `<select id="${id}" data-k="${k}" data-kind="sel">${opts.map(([o, l]) => `<option value="${o}" ${o === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (kind === 'text') input = `<input class="field" id="${id}" data-k="${k}" data-kind="text" value="${esc(v ?? '')}">`;
  else {
    const shown = v == null || v === '' ? '' : kind === 'cm' ? Math.round(v * 1000) / 10 : Math.round(v * 1000) / 1000;
    input = `<input class="field" type="number" step="${kind === 'cm' ? 1 : 0.01}" id="${id}" data-k="${k}" data-kind="${kind}" value="${shown}">`;
  }
  return `<label for="${id}">${esc(label)}</label>${input}`;
}
function readField(inp) {
  const kind = inp.dataset.kind;
  if (kind === 'chk') return inp.checked;
  if (kind === 'sel' || kind === 'text') return inp.value;
  const n = parseFloat(inp.value);
  if (Number.isNaN(n)) return undefined;
  return kind === 'cm' ? n / 100 : n;
}

function renderSide() {
  const side = $('#side');
  const sel = [...A.sel].map((id) => byId(A.p, id)).filter(Boolean);
  if (!sel.length) {
    const t = A.tool;
    if (t === 'select') {
      const s = storeyOf(A.p, { storey: A.storey });
      const els = A.p.elements.filter((e) => e.storey === A.storey);
      const counts = {};
      for (const e of els) counts[e.type] = (counts[e.type] || 0) + 1;
      side.innerHTML = `<h3>${esc(s.name)}</h3>
        <table class="kv"><tbody><tr><td>Cotă</td><td>${fmt(s.elev)} m</td></tr><tr><td>Înălțime nivel</td><td>${fmt(s.height)} m</td></tr>
        ${Object.entries(counts).map(([k, n]) => `<tr><td>${TYPE_NAMES[k]}</td><td>${n}</td></tr>`).join('')}</tbody></table>
        <h4>Cum desenezi</h4>
        <p class="hint">Alege o unealtă din stânga. Fă clic pentru puncte. Pentru o lungime exactă, tastează valoarea (ex. <b>4.5</b>) și apasă Enter; pentru unghi: <b>4.5&lt;90</b>. Shift = doar orizontal/vertical. Punctele se prind automat de capete, colțuri, mijloace și fețe de pereți.</p>
        <p class="hint">Rotița mouse-ului = zoom, clic dreapta sau mijloc + trage = deplasare. Delete șterge selecția, Ctrl+Z anulează.</p>`;
      return;
    }
    const D = A.defaults[t];
    side.innerHTML = `<h3>Setări: ${esc(TYPE_NAMES[t])}</h3><p class="hint">Se aplică elementelor pe care le desenezi de acum înainte.</p>
      <div class="form" id="form">${FIELDS[t].map((f) => fieldHtml(f, D[f[0]], true)).join('')}</div>`;
    $('#form').onchange = (e) => { const k = e.target.dataset.k; if (!k) return; const v = readField(e.target); if (v !== undefined) D[k] = v; plan.status(); plan.invalidate(); };
    return;
  }
  const types = [...new Set(sel.map((e) => e.type))];
  const type = types.length === 1 ? types[0] : null;
  const first = sel[0];
  const title = sel.length === 1 ? `${TYPE_NAMES[first.type]} ${first.id.toUpperCase()}` : `${sel.length} elemente selectate`;
  const q = sel.length === 1 ? quantities(A.p, first) : null;
  side.innerHTML = `<h3>${esc(title)}</h3>
    ${type ? `<div class="form" id="form">${FIELDS[type].map((f) => fieldHtml(f, sel.every((e) => e[f[0]] === first[f[0]]) ? first[f[0]] : (f[2] === 'chk' ? false : ''), false)).join('')}</div>` : '<p class="hint">Elemente de tipuri diferite: le poți muta, copia sau șterge împreună.</p>'}
    ${q && Object.keys(q).length ? `<h4>Cantități</h4><table class="kv"><tbody>${Object.entries(q).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${typeof v === 'number' ? fmt(v) : esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${loadInfo(sel)}
    <div class="acts"><button class="btn" id="s-dup" title="Ctrl+D">Copiază alături</button><button class="btn danger" id="s-del">Șterge</button></div>`;
  const form = $('#form');
  if (form) form.onchange = (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const v = readField(e.target); if (v === undefined) return;
    snapshot();
    for (const el of sel) el[k] = v;
    emit('model');
  };
  $('#s-del').onclick = () => { snapshot(); deleteElements([...A.sel]); emit('model'); };
  $('#s-dup').onclick = duplicate;
}
function loadInfo(sel) {
  if (!A.loads || sel.length !== 1) return '';
  const r = A.loads.items.find((x) => x.id === sel[0].id);
  if (!r) return '';
  return `<h4>Sarcini (orientativ)</h4><table class="kv"><tbody>
    <tr><td>G (permanente)</td><td>${fmt(r.G, 1)} kN</td></tr><tr><td>Q (variabile)</td><td>${fmt(r.Q, 1)} kN</td></tr>
    ${r.trib ? `<tr><td>Arie aferentă</td><td>${fmt(r.trib)} m²</td></tr>` : ''}
    ${r.nEd != null ? `<tr><td>n<sub>Ed</sub> la bază</td><td>${fmt(r.nEd, 1)} kN/m</td></tr>` : `<tr><td>N<sub>Ed</sub></td><td>${fmt(r.NEd, 1)} kN</td></tr>`}
    ${r.util != null ? `<tr><td>Utilizare</td><td>${pill(r.util)}</td></tr>` : ''}
    ${r.B ? `<tr><td>Fundație</td><td>${fmt(r.B * 100, 0)} cm</td></tr>` : ''}</tbody></table>
    ${r.checks.map((c) => `<p class="hint">${esc(c)}</p>`).join('')}`;
}
const pill = (u) => `<span class="pill ${u < 0.6 ? 'ok' : u <= 1 ? 'warn' : 'bad'}">${Math.round(u * 100)}%</span>`;

function duplicate() {
  if (!A.sel.size) return;
  snapshot();
  const map = new Map();
  const off = [1, -1];
  const src = [...A.sel].map((id) => byId(A.p, id)).filter(Boolean);
  const out = [];
  for (const e of src) {
    if (e.type === 'door' || e.type === 'window') continue;
    const c = JSON.parse(JSON.stringify(e));
    delete c.id;
    if (c.a) { c.a = [c.a[0] + off[0], c.a[1] + off[1]]; c.b = [c.b[0] + off[0], c.b[1] + off[1]]; }
    if (c.p) c.p = [c.p[0] + off[0], c.p[1] + off[1]];
    if (c.pts) c.pts = c.pts.map((q) => [q[0] + off[0], q[1] + off[1]]);
    c.id = c.type[0] + A.p.nextId++;
    A.p.elements.push(c); map.set(e.id, c.id); out.push(c.id);
  }
  // golurile pereților copiați
  for (const o of A.p.elements.filter((x) => (x.type === 'door' || x.type === 'window') && map.has(x.wall))) {
    const c = { ...JSON.parse(JSON.stringify(o)), wall: map.get(o.wall) };
    c.id = c.type[0] + A.p.nextId++;
    A.p.elements.push(c);
  }
  A.sel = new Set(out);
  emit('model');
  toast('Copiat cu 1 m la dreapta și 1 m în jos – trage pentru a-l muta');
}

// ---------------------------------------------------------------- vederi
const work = $('#work');
function setView(v) {
  work.dataset.view = v;
  for (const b of document.querySelectorAll('#views button')) b.classList.toggle('on', b.dataset.view === v);
  try { localStorage.setItem('cad:view', v); } catch { /* */ }
  if (v !== 'plan') ensure3D().then((x) => { x.resize(); x.invalidate('model'); });
}
$('#views').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); };
$('#b-fit').onclick = () => plan.fit();
$('#b-fit3d').onclick = () => view3d?.fit();
$('#c-grid').onchange = (e) => { plan.gridSnap = e.target.checked; };
$('#c-upto').onchange = (e) => { if (view3d) { view3d.upTo = e.target.checked; view3d.invalidate('model'); } };
$('#c-zones').onchange = (e) => { if (view3d) { view3d.showZones = e.target.checked; view3d.invalidate('model'); } };
$('#c-loads').onchange = (e) => { A.showLoads = e.target.checked; plan.invalidate(); };

// ---------------------------------------------------------------- reacții la schimbări
on((kind) => {
  if (kind === 'model') { autosave(); $('#l-loads').hidden = true; }
  if (kind === 'storey' || kind === 'model') renderStoreys();
  renderSide();
  plan.invalidate();
  view3d?.invalidate(kind === 'storey' ? (view3d.upTo ? 'model' : 'sel') : kind);
  $('#b-undo').disabled = !A.undo.length; $('#b-redo').disabled = !A.redo.length;
  if (kind === 'model' && !$('#page').hidden && pageKind === 'qty') openQty();
});
$('#b-undo').onclick = () => undo();
$('#b-redo').onclick = () => redo();
const pname = $('#pname');
pname.onchange = () => { snapshot(); A.p.name = pname.value.trim() || 'Proiect'; emit('model'); };

addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select,dialog')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicate(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); for (const x of A.p.elements) if (x.storey === A.storey) A.sel.add(x.id); emit('sel'); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Home') { plan.fit(); return; }
  if (plan.draw && /^[0-9.,<-]$/.test(e.key)) { if (document.activeElement !== $('#plan')) plan.key(e); return; } // lungimea tastată
  const t = TOOLS.find((x) => x !== 'hr' && x[2].toLowerCase() === k);
  if (t && document.activeElement?.id !== 'pname') { setTool(t[0]); e.preventDefault(); return; }
  if (document.activeElement !== $('#plan')) plan.key(e);
});

// ---------------------------------------------------------------- pagini: Cantități, Sarcini
let pageKind = null;
function openPage(kind, title, html, acts = '') {
  pageKind = kind;
  $('#page-title').textContent = title;
  $('#page-body').innerHTML = html;
  $('#page-acts').innerHTML = acts;
  $('#page').hidden = false;
}
$('#page-close').onclick = () => { $('#page').hidden = true; pageKind = null; };

function csvDownload(name, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map((r) => r.map((v) => q(typeof v === 'number' ? fmt(v) : v)).join(';')).join('\n')], { type: 'text/csv' });
  download(blob, name);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function openQty() {
  const rows = takeoff(A.p);
  const elems = A.p.elements.filter((e) => e.type !== 'dim');
  let lastCat = '';
  const html = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Lucrare / material</th><th class="n">Cantitate</th><th>U.M.</th></tr></thead><tbody>
    ${rows.map((r) => { const g = r.cat !== lastCat ? `<tr class="grp"><td colspan="3">${esc(r.cat)}</td></tr>` : ''; lastCat = r.cat; return g + `<tr><td>${esc(r.item)}</td><td class="n">${fmt(r.qty)}</td><td>${r.unit}</td></tr>`; }).join('')}
    </tbody></table></div>
    <h3 style="margin:20px 0 8px">Elemente (${elems.length})</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Element</th><th>Nivel</th><th>Material / tip</th><th>Cantități</th></tr></thead><tbody>
    ${elems.map((e) => `<tr class="click" data-id="${e.id}"><td>${TYPE_NAMES[e.type]} ${e.id.toUpperCase()}${e.name ? ' – ' + esc(e.name) : ''}</td><td>${esc(storeyOf(A.p, e.wall ? byId(A.p, e.wall) || e : e).name)}</td><td>${esc(MATERIALS[e.material]?.name || USES[e.use]?.name || '')}</td>
      <td class="small">${Object.entries(quantities(A.p, e)).map(([k, v]) => `${esc(k)}: <b>${typeof v === 'number' ? fmt(v) : esc(v)}</b>`).join(' · ')}</td></tr>`).join('')}
    </tbody></table></div>`;
  openPage('qty', 'Cantități', html, '<button class="btn" id="qty-csv">Export CSV (Excel)</button> ');
  $('#qty-csv').onclick = () => csvDownload(`Cantitati - ${A.p.name}.csv`, [['Categorie', 'Lucrare / material', 'Cantitate', 'U.M.'], ...rows.map((r) => [r.cat, r.item, r.qty, r.unit])]);
  $('#page-body').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectFromPage(tr.dataset.id); };
}
function selectFromPage(id) {
  const el = byId(A.p, id);
  if (!el) return;
  const host = el.wall ? byId(A.p, el.wall) : el;
  A.storey = host.storey;
  A.sel = new Set([id]);
  $('#page').hidden = true; pageKind = null;
  setTool('select');
  A.sel = new Set([id]);
  emit('storey'); emit('sel');
}
$('#b-qty').onclick = openQty;

async function openLoads() {
  const { computeLoads, snowLoad } = await import('./loads.js');
  const P = A.p.loads;
  const run = () => { A.loads = computeLoads(A.p); $('#l-loads').hidden = false; };
  run();
  const draw = () => {
    const L = A.loads, S = L.summary;
    const area = A.p.elements.filter((e) => e.type === 'slab').reduce((a, e) => a + Math.abs(require_area(e)), 0);
    const items = L.items.filter((x) => ['wall', 'column', 'beam', 'slab', 'roof'].includes(x.type) && (x.type !== 'wall' || x.bearing));
    let last = '';
    const html = `<div class="notice"><b>Calcul orientativ de predimensionare.</b> Încărcări gravitaționale după SR EN 1990 și SR EN 1991-1-1 / 1-1-3 (valori recomandate, modificabile). Nu include seismul (P100-1/2013), vântul, excentricitățile și armarea. Proiectul de rezistență pentru autorizație se face și se semnează de un inginer structurist atestat și se verifică conform Legii 10/1995.</div>
      <div class="params" id="lp">
        <label><span>Zăpadă la sol s<sub>k</sub> (kN/m²)</span><input class="field" type="number" step="0.1" data-k="sk" value="${P.sk}"><span class="small">CR 1-1-3: ex. București 2,0; Brașov 2,0–2,5; Cluj 1,5</span></label>
        <label><span>Coeficient de expunere C<sub>e</sub></span><input class="field" type="number" step="0.1" data-k="Ce" value="${P.Ce}"><span class="small">0,8 expus · 1,0 normal · 1,2 adăpostit</span></label>
        <label><span>Pereți despărțitori mobili (kN/m²)</span><input class="field" type="number" step="0.1" data-k="partitions" value="${P.partitions}"><span class="small">EN 1991-1-1 6.3.1.2: 0,5 / 0,8 / 1,2</span></label>
        <label><span>Presiune admisibilă teren σ<sub>adm</sub> (kPa)</span><input class="field" type="number" step="10" data-k="sigma" value="${P.sigma}"><span class="small">din studiul geotehnic</span></label>
        <label><span>Coeficienți parțiali γ<sub>G</sub> / γ<sub>Q</sub></span><span style="display:flex;gap:6px"><input class="field" type="number" step="0.05" data-k="gG" value="${P.gG}"><input class="field" type="number" step="0.05" data-k="gQ" value="${P.gQ}"></span><span class="small">combinația fundamentală SLU (6.10)</span></label>
      </div>
      <div class="cards">
        <div class="card"><small>Greutate permanentă G</small><b>${fmt(S.G, 0)} kN</b></div>
        <div class="card"><small>Încărcări variabile Q</small><b>${fmt(S.Q, 0)} kN</b></div>
        <div class="card"><small>SLU: ${P.gG}·G + ${P.gQ}·Q</small><b>${fmt(S.NEd, 0)} kN</b></div>
        <div class="card"><small>Medie pe m² de planșeu (G+Q)</small><b>${area ? fmt((S.G + S.Q) / area, 1) : '—'} kN/m²</b></div>
        <div class="card"><small>Zăpadă pe acoperiș (pantă 0–30°)</small><b>${fmt(snowLoad(P, 0), 2)} kN/m²</b></div>
      </div>
      ${L.warnings.length ? `<ul class="warns">${L.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="small">Nicio problemă detectată la coborârea încărcărilor.</p>'}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Element</th><th class="n">Arie aferentă</th><th class="n">G (kN)</th><th class="n">Q (kN)</th><th class="n">N<sub>Ed</sub> / q<sub>Ed</sub></th><th class="n">Utilizare</th><th>Fundație</th><th>Detalii</th></tr></thead><tbody>
      ${items.map((x) => {
        const g = x.storey !== last ? `<tr class="grp"><td colspan="8">${esc(x.storey)}</td></tr>` : ''; last = x.storey;
        const ned = x.type === 'wall' ? `${fmt(x.nEd, 1)} kN/m` : x.type === 'beam' ? `${fmt(x.qEd, 1)} kN/m` : x.type === 'slab' || x.type === 'roof' ? (x.pEd ? `${fmt(x.pEd, 2)} kN/m²` : `g ${fmt(x.g, 2)} + q ${fmt(x.q, 2)} kN/m²`) : `${fmt(x.NEd, 1)} kN`;
        return g + `<tr class="click" data-id="${x.id}"><td>${esc(x.name)}</td><td class="n">${x.trib ? fmt(x.trib) + ' m²' : x.area ? fmt(x.area) + ' m²' : '—'}</td><td class="n">${fmt(x.G, 1)}</td><td class="n">${fmt(x.Q, 1)}</td><td class="n">${ned}</td>
          <td class="n">${x.util != null ? pill(x.util) : '—'}</td><td>${x.B ? (x.type === 'wall' ? 'talpă B ≥ ' : 'bloc ') + fmt(x.B * 100, 0) + ' cm' : x.onGround ? 'pe teren' : ''}</td><td class="small">${x.checks.map(esc).join('<br>')}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    openPage('loads', 'Calcul sarcini', html, '<button class="btn" id="ld-csv">Export CSV</button> <button class="btn" id="ld-plan">Arată pe plan</button> ');
    $('#lp').onchange = (e) => { const k = e.target.dataset.k; if (!k) return; snapshot(); A.p.loads[k] = parseFloat(e.target.value) || 0; autosave(); run(); draw(); };
    $('#ld-csv').onclick = () => csvDownload(`Sarcini - ${A.p.name}.csv`, [['Nivel', 'Element', 'Arie aferentă (m²)', 'G (kN)', 'Q (kN)', 'N_Ed (kN)', 'n_Ed (kN/m)', 'Utilizare (%)', 'Fundație (cm)', 'Verificări'],
      ...items.map((x) => [x.storey, x.name, x.trib || x.area || '', x.G, x.Q, x.NEd, x.nEd ?? x.qEd ?? '', x.util != null ? Math.round(x.util * 100) : '', x.B ? Math.round(x.B * 100) : '', x.checks.join(' | ')])]);
    $('#ld-plan').onclick = () => { A.showLoads = true; $('#c-loads').checked = true; $('#page').hidden = true; pageKind = null; setView(work.dataset.view === '3d' ? 'plan' : work.dataset.view); plan.invalidate(); };
    $('#page-body').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) selectFromPage(tr.dataset.id); };
  };
  draw();
}
const require_area = (e) => polyArea(e.pts);
$('#b-loads').onclick = openLoads;

// ---------------------------------------------------------------- export IFC și Model 3D
async function ifcText() { const { exportIfc } = await import('./ifc-export.js'); return exportIfc(A.p); }
$('#b-ifc').onclick = async () => {
  try { download(new Blob([await ifcText()], { type: 'application/x-step' }), `${A.p.name}.ifc`); toast('Fișier IFC salvat'); } catch (e) { console.error(e); toast('Exportul IFC a eșuat: ' + e.message, 5000); }
};
$('#b-open3d').onclick = async () => {
  // modelul se pune în biblioteca aplicației Model 3D (aceeași origine) și se deschide acolo
  try {
    const text = await ifcText();
    const blob = new Blob([text], { type: 'application/x-step' });
    const id = 'proiectare:' + (A.p.created || 0);
    const db = await new Promise((res, rej) => { const r = indexedDB.open('bim-models', 1); r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res, rej) => { const t = db.transaction(['meta', 'files'], 'readwrite'); t.objectStore('meta').put({ id, name: A.p.name, size: blob.size, date: Date.now() }); t.objectStore('files').put(blob, id); t.oncomplete = res; t.onerror = () => rej(t.error); });
    localStorage.setItem('bim:last', JSON.stringify(id));
    location.href = '../bim/';
  } catch (e) { console.error(e); toast('Nu s-a putut deschide în Model 3D: ' + e.message, 5000); }
};

// ---------------------------------------------------------------- meniul proiectului
$('#b-menu').onclick = () => {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2>Proiect</h2><div class="menu">
    <button class="btn" value="new">Proiect nou (gol)</button>
    <button class="btn" value="sample">Încarcă proiectul exemplu</button>
    <button class="btn" value="open">Deschide fișier proiect (.json)…</button>
    <button class="btn" value="save">Salvează fișier proiect (.json)</button>
    </div><p class="small">Proiectul curent se salvează automat în browser. Fișierul .json e copia ta de siguranță și se poate muta pe alt calculator.</p>
    <div class="btns"><button class="btn" value="cancel">Închide</button></div></form>`;
  d.onclose = () => {
    const v = d.returnValue;
    if (v === 'new' || v === 'sample') { snapshot(); A.p = v === 'new' ? newProject() : sampleProject(); A.storey = sortedStoreys(A.p)[0].id; A.sel.clear(); pname.value = A.p.name; emit('model'); emit('storey'); plan.fit(); view3d && (view3d.fitted = false); }
    if (v === 'open') $('#file').click();
    if (v === 'save') download(new Blob([JSON.stringify(A.p, null, 1)], { type: 'application/json' }), `${A.p.name}.json`);
  };
  d.returnValue = '';
  d.showModal();
};
$('#file').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    if (!Array.isArray(p.elements) || !Array.isArray(p.storeys)) throw new Error('fișierul nu este un proiect');
    snapshot(); A.p = p; A.storey = sortedStoreys(p)[0].id; A.sel.clear(); pname.value = p.name; emit('model'); emit('storey'); plan.fit();
    toast('Proiect deschis');
  } catch (err) { toast('Nu s-a putut deschide: ' + err.message, 5000); }
};

// ---------------------------------------------------------------- pornire
pname.value = A.p.name;
renderTools(); renderStoreys(); renderSide();
setView((() => { try { return localStorage.getItem('cad:view') || 'split'; } catch { return 'split'; } })());
requestAnimationFrame(() => { plan.resize(); plan.fit(); plan.status(); });
$('#b-undo').disabled = true; $('#b-redo').disabled = true;
window.__cad = { A, plan, emit, get view3d() { return view3d; } };
