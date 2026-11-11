// Interfața pentru fișierele .bimx: lista planșelor, vizualizatorul de planșe (zoom, deplasare),
// lista elementelor cu proprietăți și datele proiectului.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let B = null; // fișierul .bimx deschis
let tab = 'sheets';
const thumbUrls = [];

const root = document.createElement('section');
root.id = 'bx';
root.hidden = true;
root.innerHTML = `
  <header class="bx-top">
    <button class="icon-btn" data-x="close" aria-label="Înapoi la 3D" title="Înapoi la 3D"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    <div class="title"><div id="bx-title"></div><div id="bx-sub" class="muted"></div></div>
  </header>
  <nav class="bx-tabs"><button data-tab="sheets">Planșe</button><button data-tab="elems">Elemente</button><button data-tab="info">Proiect</button></nav>
  <div id="bx-body"></div>
  <div id="sv" hidden>
    <canvas id="sv-canvas"></canvas>
    <header class="sv-top">
      <button class="icon-btn" data-x="svclose" aria-label="Înapoi la listă"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="title"><div id="sv-title"></div><div id="sv-sub" class="muted"></div></div>
      <button class="icon-btn" data-x="prev" aria-label="Planșa anterioară"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <button class="icon-btn" data-x="next" aria-label="Planșa următoare"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>
      <button class="icon-btn" data-x="fit" aria-label="Încadrează"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
    </header>
  </div>`;
document.body.appendChild(root);

root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; render(); return; }
  const x = e.target.closest('[data-x]')?.dataset.x;
  if (x === 'close') hideBimx();
  if (x === 'svclose') closeSheet();
  if (x === 'fit') fit();
  if (x === 'prev' || x === 'next') {
    const i = B.sheets.indexOf(SV.sheet) + (x === 'next' ? 1 : -1);
    if (B.sheets[i]) openSheet(B.sheets[i]);
  }
  const s = e.target.closest('[data-sheet]');
  if (s) openSheet(B.sheets[+s.dataset.sheet]);
});

export function showBimx(data, visible = true) {
  if (data) {
    if (B !== data) {
      thumbUrls.forEach(URL.revokeObjectURL);
      thumbUrls.length = 0;
      clearCache();
      B = data;
      tab = 'sheets';
    }
  }
  if (!B || !visible) return;
  root.hidden = false;
  render();
}
export function hideBimx() { root.hidden = true; closeSheet(); }
export const currentBimx = () => B;

function render() {
  $('#bx-title').textContent = B.name;
  $('#bx-sub').textContent = `${B.sheets.length} planșe · ${B.elements.length} elemente · ${B.stories.length} niveluri`;
  for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  const body = $('#bx-body');
  if (tab === 'sheets') {
    const groups = {};
    B.sheets.forEach((s, i) => (groups[s.type] ||= []).push([s, i]));
    body.innerHTML = (B.has3D ? `<div class="bx-note">Modelul 3D din fișierele .bimx folosește un format binar închis și nu poate fi afișat aici. Pentru 3D, mers prin clădire și secțiuni, exportă proiectul din ARCHICAD ca <b>IFC</b>.</div>` : '')
      + Object.entries(groups).map(([g, list]) => `<h3>${esc(g === 'Plan' ? 'Planuri' : g === 'Secțiune' ? 'Secțiuni' : g === 'Fațadă' ? 'Fațade' : 'Alte planșe')} (${list.length})</h3>
      <div class="bx-grid">${list.map(([s, i]) => `<button class="bx-card" data-sheet="${i}"><img data-thumb="${i}" alt=""><div><b>${esc(s.number ? s.number + ' ' : '')}${esc(s.name)}</b><small>${esc([s.scale, s.path.split('\\').slice(-2, -1)[0]].filter(Boolean).join(' · '))}</small></div></button>`).join('')}</div>`).join('');
    for (const img of body.querySelectorAll('img[data-thumb]')) {
      const s = B.sheets[+img.dataset.thumb];
      if (!s.thumb) continue;
      const u = URL.createObjectURL(B.png(s.thumb));
      thumbUrls.push(u);
      img.src = u;
    }
  } else if (tab === 'elems') {
    body.innerHTML = `<input class="field" type="search" id="bx-q" placeholder="Caută (nume, tip, nivel, material…)" autocomplete="off"><div id="bx-list" class="list" style="margin-top:8px"></div>`;
    const q = $('#bx-q');
    const draw = () => {
      const v = q.value.trim().toLowerCase();
      const found = B.elements.filter((e) => !v || (e.name + ' ' + e.type + ' ' + e.storyName + ' ' + e.layerName + ' ' + JSON.stringify(e.props)).toLowerCase().includes(v));
      $('#bx-list').innerHTML = found.slice(0, 300).map((e) => `<details class="pset"><summary><span>${esc(e.name)}<br><small class="muted">${esc([e.type, e.storyName, e.layerName].filter(Boolean).join(' · '))}</small></span></summary>
        ${Object.entries(e.props).map(([bn, rows]) => `<table class="kv"><tbody>${Object.entries(rows).map(([k, val]) => `<tr><td>${esc(k)}</td><td>${esc(val)}</td></tr>`).join('')}</tbody></table>`).join('')}</details>`).join('')
        + (found.length > 300 ? `<div class="empty">Încă ${found.length - 300} rezultate – restrânge căutarea</div>` : found.length ? '' : '<div class="empty">Niciun rezultat</div>');
    };
    q.oninput = draw;
    draw();
  } else {
    body.innerHTML = `<table class="kv"><tbody>${Object.entries(B.project).filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
      ${B.stories.length ? `<h3>Niveluri</h3><table class="kv"><tbody>${[...B.stories].reverse().map((s) => `<tr><td>${esc(s.name)}</td><td>${s.level >= 0 ? '+' : ''}${s.level.toFixed(2)} m</td></tr>`).join('')}</tbody></table>` : ''}`;
  }
}

// ================================================================ Vizualizatorul de planșe
const SV = { sheet: null, s: 1, x: 0, y: 0, cache: new Map(), pending: new Set(), thumb: null };
const cv = $('#sv-canvas', root);
const ctx = cv.getContext('2d');
const dpr = () => Math.min(devicePixelRatio || 1, 2);

function clearCache() {
  for (const b of SV.cache.values()) b.close?.();
  SV.cache.clear();
  SV.pending.clear();
}
async function openSheet(s) {
  SV.sheet = s;
  SV.thumb = null;
  $('#sv').hidden = false;
  $('#sv-title').textContent = (s.number ? s.number + ' ' : '') + s.name;
  $('#sv-sub').textContent = [s.type, s.scale].filter(Boolean).join(' · ');
  resizeSV();
  fit();
  if (s.thumb) createImageBitmap(B.png(s.thumb)).then((b) => { if (SV.sheet === s) { SV.thumb = b; draw(); } }).catch(() => {});
}
function closeSheet() { $('#sv').hidden = true; SV.sheet = null; }

function pageSize() { const s = SV.sheet, d0 = s.levels[0]; return [s.pageW * d0, s.pageH * d0]; }
function fit() {
  if (!SV.sheet) return;
  const [W, H] = pageSize();
  const cw = cv.clientWidth, ch = cv.clientHeight;
  SV.s = Math.min(cw / W, (ch - 60) / H) * 0.96;
  SV.x = (cw - W * SV.s) / 2;
  SV.y = 60 + (ch - 60 - H * SV.s) / 2;
  draw();
}
function resizeSV() {
  cv.width = Math.round(cv.clientWidth * dpr());
  cv.height = Math.round(cv.clientHeight * dpr());
  draw();
}
new ResizeObserver(() => { if (SV.sheet) resizeSV(); }).observe(cv);

let raf = 0;
function draw() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}
function paint() {
  const s = SV.sheet;
  if (!s) return;
  const k = dpr();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.fillStyle = '#c9ced8';
  ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
  const [W, H] = pageSize();
  ctx.fillStyle = '#fff';
  ctx.fillRect(SV.x, SV.y, W * SV.s, H * SV.s);
  ctx.imageSmoothingQuality = 'high';
  if (SV.thumb) ctx.drawImage(SV.thumb, SV.x, SV.y, W * SV.s, H * SV.s);
  // nivelul de detaliu: cel mai mic dpi care încă e suficient de clar pe ecran
  const d0 = s.levels[0];
  const need = SV.s * k * d0;
  let li = 0;
  s.levels.forEach((dpi, i) => { if (dpi >= need * 0.9) li = i; });
  // desenează întâi nivelurile mai grosiere (ca fundal), apoi nivelul ales
  for (let l = s.levels.length - 1; l >= li; l--) drawLevel(l, l === li);
}
function drawLevel(l, request) {
  const s = SV.sheet, d0 = s.levels[0], dpi = s.levels[l];
  const T = s.tile * d0 / dpi; // dimensiunea plăcii în pixeli de nivel 0
  const cols = Math.ceil(s.pageW * dpi / s.tile), rows = Math.ceil(s.pageH * dpi / s.tile);
  const x0 = Math.max(0, Math.floor(-SV.x / SV.s / T)), x1 = Math.min(cols - 1, Math.floor((cv.clientWidth - SV.x) / SV.s / T));
  const y0 = Math.max(0, Math.floor(-SV.y / SV.s / T)), y1 = Math.min(rows - 1, Math.floor((cv.clientHeight - SV.y) / SV.s / T));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const name = `${l}_1_${tx}_${ty}.png`;
      const key = s.id + '/' + name;
      const bmp = SV.cache.get(key);
      if (bmp) {
        const f = d0 / dpi * SV.s;
        ctx.drawImage(bmp, SV.x + tx * T * SV.s, SV.y + ty * T * SV.s, bmp.width * f, bmp.height * f);
        SV.cache.delete(key); SV.cache.set(key, bmp); // LRU
      } else if (request && s.tiles.has(name) && !SV.pending.has(key)) {
        SV.pending.add(key);
        createImageBitmap(B.png(s.tiles.get(name))).then((b) => {
          SV.pending.delete(key);
          SV.cache.set(key, b);
          while (SV.cache.size > 220) { const [k0, v0] = SV.cache.entries().next().value; v0.close?.(); SV.cache.delete(k0); }
          if (SV.sheet === s) draw();
        }).catch(() => SV.pending.delete(key));
      }
    }
  }
}

// ---------------- zoom și deplasare (mouse, rotiță, două degete)
const pts = new Map();
let lastTap = 0;
function zoomAt(px, py, f) {
  const [W] = pageSize();
  const min = cv.clientWidth / W * 0.3, max = 4;
  const ns = Math.max(min, Math.min(max, SV.s * f));
  f = ns / SV.s;
  SV.x = px - (px - SV.x) * f;
  SV.y = py - (py - SV.y) * f;
  SV.s = ns;
  draw();
}
cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) {
    const now = performance.now();
    if (now - lastTap < 300) { const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2); lastTap = 0; } else lastTap = now;
  }
});
cv.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  if (pts.size === 1) {
    SV.x += e.clientX - p.x; SV.y += e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    draw();
  } else if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    const d0 = Math.hypot(a.x - b.x, a.y - b.y), m0 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    p.x = e.clientX; p.y = e.clientY;
    const d1 = Math.hypot(a.x - b.x, a.y - b.y), m1 = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    const r = cv.getBoundingClientRect();
    SV.x += m1[0] - m0[0]; SV.y += m1[1] - m0[1];
    if (d0 > 0) zoomAt(m1[0] - r.left, m1[1] - r.top, d1 / d0);
  }
});
const up = (e) => pts.delete(e.pointerId);
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  if (root.hidden || e.target.closest('input,textarea')) return;
  if (e.key === 'Escape') { if (SV.sheet) closeSheet(); else hideBimx(); e.stopImmediatePropagation(); }
  if (SV.sheet && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const i = B.sheets.indexOf(SV.sheet) + (e.key === 'ArrowRight' ? 1 : -1);
    if (B.sheets[i]) openSheet(B.sheets[i]);
  }
}, true);
