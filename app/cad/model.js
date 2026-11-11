// Modelul proiectului: niveluri, elemente, materiale, geometrie și cantități.
// Coordonate în plan: x spre dreapta, y în sus, în metri. Cotele (z) sunt în metri față de ±0,00.

export const MATERIALS = {
  beton: { name: 'Beton armat C25/30', gamma: 25, fd: 16.7, color: '#a9adb3', c3: 0xb8bbc0, kind: 'beton' },
  bca: { name: 'Zidărie BCA (GBN 50)', gamma: 7, fd: 0.9, color: '#e7dcc6', c3: 0xece6da, kind: 'zidarie' },
  porotherm: { name: 'Zidărie cărămidă cu goluri', gamma: 10, fd: 1.4, color: '#d9a07f', c3: 0xd8b49c, kind: 'zidarie' },
  caramida: { name: 'Zidărie cărămidă plină', gamma: 18, fd: 1.8, color: '#c8755a', c3: 0xc98f78, kind: 'zidarie' },
  gips: { name: 'Gips-carton pe profile metalice', gamma: 3, fd: 0, color: '#f2f2f2', c3: 0xf4f3f0, kind: 'usor' },
  lemn: { name: 'Lemn ecarisat C24', gamma: 4.2, fd: 13, color: '#c9a26b', c3: 0xc6a57a, kind: 'lemn' },
  otel: { name: 'Oțel S235', gamma: 78.5, fd: 235, color: '#6f7b8a', c3: 0x8b95a3, kind: 'otel' },
  invelitoare: { name: 'Învelitoare țiglă + șarpantă lemn', gamma: 5, fd: 0, color: '#b0533b', c3: 0xa65a42, kind: 'acoperis' },
};

// Încărcări utile (variabile) recomandate, SR EN 1991-1-1 tabel 6.2 (valori uzuale; se pot modifica)
export const USES = {
  A: { name: 'A – Locuințe (planșee)', q: 1.5 },
  A_sc: { name: 'A – Scări', q: 2.0 },
  A_bal: { name: 'A – Balcoane', q: 2.5 },
  B: { name: 'B – Birouri', q: 2.5 },
  C1: { name: 'C1 – Spații cu mese (școli, cafenele)', q: 3.0 },
  C3: { name: 'C3 – Spații fără obstacole (săli, holuri publice)', q: 4.0 },
  D1: { name: 'D1 – Magazine', q: 4.0 },
  E1: { name: 'E1 – Depozite', q: 7.5 },
  F: { name: 'F – Garaje autoturisme', q: 2.5 },
  H: { name: 'H – Terase necirculabile', q: 0.4 },
  I: { name: 'I – Terase circulabile', q: 1.5 },
  sol: { name: 'Placă pe sol', q: 2.0 },
};

export const TYPE_NAMES = {
  wall: 'Perete', door: 'Ușă', window: 'Fereastră', slab: 'Placă', column: 'Stâlp', beam: 'Grindă', roof: 'Acoperiș', zone: 'Zonă (cameră)', dim: 'Cotă',
};

// Setări implicite ale uneltelor (ce se desenează la următorul clic)
export const DEFAULTS = {
  wall: { thickness: 0.3, height: 2.8, material: 'bca', bearing: true, exterior: true, plaster: 0.02 },
  door: { width: 0.9, height: 2.1, sill: 0, flip: false, name: 'Ușă' },
  window: { width: 1.2, height: 1.4, sill: 0.9, name: 'Fereastră' },
  slab: { thickness: 0.15, offset: 0, material: 'beton', finishes: 1.5, use: 'A', mode: 'rect' },
  column: { w: 0.3, d: 0.3, height: 2.8, material: 'beton' },
  beam: { w: 0.25, h: 0.45, material: 'beton' },
  roof: { kind: 'gable', slope: 35, thickness: 0.25, offset: 2.8, axis: 'x', dead: 1.0, material: 'invelitoare', mode: 'rect' },
  zone: { name: 'Cameră', number: '', mode: 'auto' },
  dim: {},
};

export function newProject(name = 'Proiect nou') {
  return {
    version: 1,
    name,
    nextId: 1,
    storeys: [
      { id: 's1', name: 'Parter', elev: 0, height: 3.0 },
      { id: 's2', name: 'Etaj 1', elev: 3.0, height: 3.0 },
    ],
    elements: [],
    loads: { sk: 2.0, Ce: 1.0, Ct: 1.0, partitions: 0.8, sigma: 200, gG: 1.35, gQ: 1.5 },
    created: Date.now(),
  };
}

export function addElement(p, el) {
  el.id = el.id || (el.type[0] + p.nextId++);
  p.elements.push(el);
  return el;
}
export const byId = (p, id) => p.elements.find((e) => e.id === id);
export const storeyOf = (p, el) => p.storeys.find((s) => s.id === el.storey) || p.storeys[0];
export const sortedStoreys = (p) => [...p.storeys].sort((a, b) => a.elev - b.elev);

// ---------------------------------------------------------------- Geometrie 2D
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export function projectOnSegment(p, a, b) {
  const ab = sub(b, a), L2 = dot(ab, ab) || 1e-12;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
  const q = add(a, mul(ab, t));
  return { t, q, d: dist(p, q), along: t * Math.sqrt(L2) };
}
export function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
export function polyPerimeter(pts) { let s = 0; for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]); return s; }
export function polyCentroid(pts) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], f = a[0] * b[1] - b[0] * a[1];
    A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f;
  }
  if (Math.abs(A) < 1e-9) return pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length], [0, 0]);
  return [cx / (3 * A), cy / (3 * A)];
}
export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function bbox(pts) {
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ---------------------------------------------------------------- Pereți și goluri
export const wallLength = (w) => dist(w.a, w.b);
export const openingsOf = (p, w) => p.elements.filter((e) => (e.type === 'door' || e.type === 'window') && e.wall === w.id);

// Capetele pereților care se întâlnesc într-un colț se prelungesc cu jumătate de grosime, ca să se închidă colțul.
export function wallExtensions(p, w) {
  const others = p.elements.filter((e) => e.type === 'wall' && e !== w && e.storey === w.storey);
  const ext = (pt) => (others.some((o) => dist(o.a, pt) < 0.01 || dist(o.b, pt) < 0.01) ? w.thickness / 2 : 0);
  return [ext(w.a), ext(w.b)];
}

// Contur 2D al peretelui (patrulater), cu prelungirile de colț
export function wallOutline(p, w) {
  const d = norm(sub(w.b, w.a)), n = perp(d), h = w.thickness / 2;
  const [e0, e1] = wallExtensions(p, w);
  const a = sub(w.a, mul(d, e0)), b = add(w.b, mul(d, e1));
  return [add(a, mul(n, h)), add(b, mul(n, h)), sub(b, mul(n, h)), sub(a, mul(n, h))];
}

// Segmentele pline ale peretelui în coordonate locale: [u0, u1, z0, z1] (u de-a lungul axei, z de la baza peretelui)
export function wallPieces(p, w) {
  const L = wallLength(w);
  const [e0, e1] = wallExtensions(p, w);
  const ops = openingsOf(p, w).map((o) => ({ u0: o.pos - o.width / 2, u1: o.pos + o.width / 2, z0: o.sill, z1: Math.min(w.height, o.sill + o.height) }))
    .filter((o) => o.u1 > 0 && o.u0 < L).sort((a, b) => a.u0 - b.u0);
  const out = [];
  let u = -e0;
  for (const o of ops) {
    if (o.u0 > u) out.push([u, o.u0, 0, w.height]);
    if (o.z0 > 0) out.push([Math.max(o.u0, u), o.u1, 0, o.z0]);
    if (o.z1 < w.height) out.push([Math.max(o.u0, u), o.u1, o.z1, w.height]);
    u = Math.max(u, o.u1);
  }
  if (L + e1 > u) out.push([u, L + e1, 0, w.height]);
  return out;
}

// ---------------------------------------------------------------- Cantități
export function quantities(p, el) {
  const m = MATERIALS[el.material] || null;
  const r2 = (v) => Math.round(v * 100) / 100;
  switch (el.type) {
    case 'wall': {
      const L = wallLength(el);
      const ops = openingsOf(p, el);
      const opA = ops.reduce((s, o) => s + o.width * Math.min(o.height, el.height - o.sill), 0);
      const net = L * el.height - opA;
      return { 'Lungime (m)': r2(L), 'Înălțime (m)': r2(el.height), 'Grosime (m)': r2(el.thickness), 'Arie goluri (m²)': r2(opA), 'Arie netă (m²)': r2(net), 'Volum (m³)': r2(net * el.thickness), 'Tencuială 2 fețe (m²)': r2(el.plaster ? net * 2 : 0), 'Greutate proprie (kN)': r2(net * el.thickness * (m?.gamma || 0)) };
    }
    case 'door': case 'window':
      return { 'Lățime (m)': r2(el.width), 'Înălțime (m)': r2(el.height), 'Parapet (m)': r2(el.sill), 'Arie (m²)': r2(el.width * el.height) };
    case 'slab': {
      const A = Math.abs(polyArea(el.pts));
      return { 'Arie (m²)': r2(A), 'Perimetru (m)': r2(polyPerimeter(el.pts)), 'Grosime (m)': r2(el.thickness), 'Volum (m³)': r2(A * el.thickness), 'Greutate proprie (kN)': r2(A * el.thickness * (m?.gamma || 0)) };
    }
    case 'column': {
      const s = storeyOf(p, el);
      void s;
      return { 'Secțiune (m)': `${r2(el.w)} × ${r2(el.d)}`, 'Înălțime (m)': r2(el.height), 'Volum (m³)': r2(el.w * el.d * el.height), 'Greutate proprie (kN)': r2(el.w * el.d * el.height * (m?.gamma || 0)) };
    }
    case 'beam': {
      const L = dist(el.a, el.b);
      return { 'Lungime (m)': r2(L), 'Secțiune (m)': `${r2(el.w)} × ${r2(el.h)}`, 'Volum (m³)': r2(L * el.w * el.h), 'Greutate proprie (kN)': r2(L * el.w * el.h * (m?.gamma || 0)) };
    }
    case 'roof': {
      const A = Math.abs(polyArea(el.pts));
      const k = el.kind === 'flat' ? 1 : 1 / Math.cos(el.slope * Math.PI / 180);
      return { 'Arie în plan (m²)': r2(A), 'Arie înclinată (m²)': r2(A * k), 'Pantă': el.kind === 'flat' ? '—' : el.slope + '°' };
    }
    case 'zone': {
      const A = Math.abs(polyArea(el.pts));
      return { 'Arie (m²)': r2(A), 'Perimetru (m)': r2(polyPerimeter(el.pts)) };
    }
    case 'dim':
      return { 'Lungime (m)': r2(dist(el.a, el.b)) };
    default: return {};
  }
}

// Extras de cantități pe categorii de lucrări
export function takeoff(p) {
  const rows = [];
  const acc = new Map();
  const put = (cat, item, unit, v) => {
    const k = cat + '|' + item + '|' + unit;
    acc.set(k, (acc.get(k) || 0) + v);
  };
  for (const el of p.elements) {
    const q = quantities(p, el);
    const s = storeyOf(p, el).name;
    const mat = MATERIALS[el.material]?.name;
    if (el.type === 'wall') {
      put(MATERIALS[el.material]?.kind === 'beton' ? 'Beton armat' : 'Pereți', `${mat}, ${Math.round(el.thickness * 100)} cm`, 'm³', q['Volum (m³)']);
      put('Pereți', `${mat}, ${Math.round(el.thickness * 100)} cm`, 'm²', q['Arie netă (m²)']);
      if (el.plaster) put('Finisaje', 'Tencuieli pereți', 'm²', q['Tencuială 2 fețe (m²)']);
    }
    if (el.type === 'slab') { put('Beton armat', 'Plăci ' + mat, 'm³', q['Volum (m³)']); put('Finisaje', 'Pardoseli', 'm²', q['Arie (m²)']); }
    if (el.type === 'column') put('Beton armat', 'Stâlpi ' + mat, 'm³', q['Volum (m³)']);
    if (el.type === 'beam') put('Beton armat', 'Grinzi ' + mat, 'm³', q['Volum (m³)']);
    if (el.type === 'roof') put('Acoperiș', 'Învelitoare (arie înclinată)', 'm²', q['Arie înclinată (m²)']);
    if (el.type === 'door') put('Tâmplărie', `Uși ${Math.round(el.width * 100)}×${Math.round(el.height * 100)}`, 'buc', 1);
    if (el.type === 'window') put('Tâmplărie', `Ferestre ${Math.round(el.width * 100)}×${Math.round(el.height * 100)}`, 'buc', 1);
    if (el.type === 'zone') put('Suprafețe', `${s} – arie utilă`, 'm²', q['Arie (m²)']);
  }
  for (const [k, v] of acc) { const [cat, item, unit] = k.split('|'); rows.push({ cat, item, unit, qty: Math.round(v * 100) / 100 }); }
  const order = ['Beton armat', 'Pereți', 'Acoperiș', 'Tâmplărie', 'Finisaje', 'Suprafețe'];
  rows.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat) || a.item.localeCompare(b.item, 'ro'));
  return rows;
}

// Proiect exemplu: casă P+1 mică, desenată cu aceleași unelte
export function sampleProject() {
  const p = newProject('Casă P+1 (exemplu)');
  const W = 10, D = 8;
  const wall = (s, a, b, o = {}) => addElement(p, { type: 'wall', storey: s, a, b, ...DEFAULTS.wall, ...o });
  const op = (type, w, pos, o = {}) => addElement(p, { type, wall: w.id, pos, ...DEFAULTS[type], ...o });
  for (const s of ['s1', 's2']) {
    const S = wall(s, [0, 0], [W, 0]); const E = wall(s, [W, 0], [W, D]); const N = wall(s, [W, D], [0, D]); const V = wall(s, [0, D], [0, 0]);
    const i1 = wall(s, [0, 4.5], [W, 4.5], { thickness: 0.25, exterior: false });
    const i2 = wall(s, [5, 0], [5, 4.5], { thickness: 0.12, material: 'gips', bearing: false, exterior: false });
    const i3 = wall(s, [4, 4.5], [4, D], { thickness: 0.15, material: 'bca', bearing: false, exterior: false });
    op('door', i3, 1.6, { width: 0.8 });
    op('window', S, 2.5, { width: 1.8 }); op('window', S, 7.5, { width: 1.8 });
    op('window', E, 2.2); op('window', N, 3, { width: 1.5 }); op('window', V, 6.2, { width: 1 });
    if (s === 's1') op('door', N, 7.5, { width: 1.0, height: 2.2, name: 'Ușă intrare' });
    else op('window', N, 7.5, { width: 1.2 });
    op('door', i1, 2.5); op('door', i1, 7.5); op('door', i2, 3.2, { width: 0.8 });
  }
  addElement(p, { type: 'slab', storey: 's1', pts: [[-0.15, -0.15], [W + 0.15, -0.15], [W + 0.15, D + 0.15], [-0.15, D + 0.15]], ...DEFAULTS.slab, use: 'sol' });
  addElement(p, { type: 'slab', storey: 's2', pts: [[-0.15, -0.15], [W + 0.15, -0.15], [W + 0.15, D + 0.15], [-0.15, D + 0.15]], ...DEFAULTS.slab });
  addElement(p, { type: 'roof', storey: 's2', pts: [[-0.5, -0.5], [W + 0.5, -0.5], [W + 0.5, D + 0.5], [-0.5, D + 0.5]], ...DEFAULTS.roof });
  addElement(p, { type: 'column', storey: 's1', p: [W + 1.6, 2.0], ...DEFAULTS.column, height: 2.8 });
  addElement(p, { type: 'column', storey: 's1', p: [W + 1.6, 6.0], ...DEFAULTS.column, height: 2.8 });
  addElement(p, { type: 'beam', storey: 's1', a: [W + 1.6, 2.0], b: [W + 1.6, 6.0], ...DEFAULTS.beam });
  addElement(p, { type: 'slab', storey: 's2', pts: [[W + 0.15, 1.85], [W + 1.75, 1.85], [W + 1.75, 6.15], [W + 0.15, 6.15]], ...DEFAULTS.slab, use: 'A_bal', finishes: 1.2 });
  const zones = [['Living', [0, 0, 5, 4.5]], ['Bucătărie', [5, 0, W, 4.5]], ['Hol', [0, 4.5, 4, D]], ['Birou', [4, 4.5, W, D]]];
  const zonesUp = [['Dormitor 1', [0, 0, 5, 4.5]], ['Dormitor 2', [5, 0, W, 4.5]], ['Hol', [0, 4.5, 4, D]], ['Baie', [4, 4.5, W, D]]];
  for (const [s, list] of [['s1', zones], ['s2', zonesUp]]) {
    list.forEach(([name, [x0, y0, x1, y1]], i) => addElement(p, { type: 'zone', storey: s, name, number: (s === 's1' ? 'P.0' : 'E.0') + (i + 1), pts: [[x0 + 0.15, y0 + 0.15], [x1 - 0.15, y0 + 0.15], [x1 - 0.15, y1 - 0.15], [x0 + 0.15, y1 - 0.15]] }));
  }
  addElement(p, { type: 'dim', storey: 's1', a: [0, -0.15], b: [W, -0.15], offset: -1.2 });
  addElement(p, { type: 'dim', storey: 's1', a: [-0.15, 0], b: [-0.15, D], offset: 1.2 });
  return p;
}
