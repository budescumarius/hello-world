// Model 3D – vizualizator BIM: navigare 3D, plimbare prin clădire, planuri 2D legate de 3D,
// proprietăți IFC, secțiuni, măsurători, notițe și vederi salvate. Funcționează offline.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildDemo } from './demo.js';

// ================================================================ Utilitare
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => Number(n).toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spațiu plin / mod privat */ } },
};
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const ICON = {
  models: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  storeys: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>',
  plan: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h7v9M14 3v7h7M14 14h7"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 019 9M21 12a9 9 0 01-9 9M12 21a9 9 0 01-9-9M3 12a9 9 0 019-9"/><path d="M19 9l2 3 2-3" />',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M9 21l2-6 3 3v3M8 12l3-4 3 1 2 3M11 8l1 5"/>',
  section: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z" opacity=".45"/><path d="M2 13h20" stroke-dasharray="3 2"/><path d="M3 13l9 4 9-4"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  note: '<path d="M12 21s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  views: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="7" cy="18" r="2" fill="currentColor"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  xray: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2"/><path d="M9 9h6v6H9z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.1 3.9M6.3 6.3C3.6 8 2 12 2 12s3.5 7 10 7a9.6 9.6 0 004.1-.9"/>',
  isolate: '<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5M11 8v6M8 11h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  props: '<path d="M4 6h16M4 12h10M4 18h13"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;

const CATS = {
  wall: ['Pereți', true], curtain: ['Pereți cortină', true], slab: ['Plăci / planșee', true], covering: ['Finisaje', true],
  roof: ['Acoperiș', true], window: ['Ferestre', true], door: ['Uși', true], column: ['Stâlpi', true], beam: ['Grinzi', true],
  stair: ['Scări / rampe', true], railing: ['Balustrade', true], furniture: ['Mobilier', true], sanitary: ['Obiecte sanitare', true],
  foundation: ['Fundații', true], mep: ['Instalații', true], other: ['Alte elemente', true], space: ['Spații (camere)', false], site: ['Teren', true],
};

// ================================================================ Stare
const S = {
  model: null,
  mode: 'orbit', // orbit | walk | plan
  tool: null, // measure | note
  storey: null, // nivelul izolat (null = toate)
  planStorey: null,
  cats: {},
  hidden: new Set(),
  isolated: null,
  xray: false,
  selected: null,
  section: { y: { on: false, v: 0 }, x: { on: false, v: 0, flip: false }, z: { on: false, v: 0, flip: false } },
  measures: [],
  pending: null,
  notes: [],
  views: [],
  walker: null, // {pos:Vector3 (ochi), yaw, pitch, vy}
  collide: store.get('bim:collide', true),
  panel: null,
};

// ================================================================ Scenă
const canvas = $('#canvas');
const view = $('#view');
const overlay = $('#overlay');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: false, preserveDrawingBuffer: false, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0xdfe7f0);
const PAPER = new THREE.Color(0xffffff);
scene.background = SKY;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 1, 0.35);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.45);
fill.position.set(-0.7, 0.4, -0.6);
scene.add(fill);

// luminile trebuie să fie vizibile și pentru camerele de plan (care văd doar stratul unui nivel)
scene.traverse((o) => { if (o.isLight) o.layers.enableAll(); });
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
const planCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000);
const mmCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 5000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.98;
const planControls = new OrbitControls(planCam, canvas);
planControls.enableRotate = false;
planControls.enableDamping = true;
planControls.screenSpacePanning = true;
planControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
planControls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planControls.minZoom = 0.2;
planControls.maxZoom = 40;
planControls.enabled = false;

const modelGroup = new THREE.Group();
scene.add(modelGroup);
const helpers = new THREE.Group();
helpers.renderOrder = 10;
scene.add(helpers);

// Planuri de secționare. Fețele interioare ale elementelor tăiate se colorează închis (hașură „poché”).
const planes = { y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0) };
const planPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const mmPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
const cutHeight = (s) => s.elevation + Math.min(1.2, (s.top - s.elevation) * 0.45);
// Capace de secțiune (hașura plină a elementelor tăiate), prin tehnica stencil:
// pentru fiecare plan se numără fețele din spate minus cele din față; unde rezultatul ≠ 0,
// planul taie un element solid și se desenează capacul.
const stencilOps = (op) => ({ stencilFail: op, stencilZFail: op, stencilZPass: op });
const stencilBack = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, side: THREE.BackSide, ...stencilOps(THREE.IncrementWrapStencilOp) });
const stencilFront = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, side: THREE.FrontSide, ...stencilOps(THREE.DecrementWrapStencilOp) });
const capMat = new THREE.MeshBasicMaterial({ color: 0x3a4250, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, ...stencilOps(THREE.ReplaceStencilOp) });
const capScene = new THREE.Scene();
const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMat);
capMesh.layers.enableAll();
capScene.add(capMesh);

const matCache = new Map();
function getMat(hex, opacity = 1) {
  const key = hex + ':' + Math.round(opacity * 100);
  let m = matCache.get(key);
  if (m) return m;
  const transparent = opacity < 0.99;
  m = new THREE.MeshLambertMaterial({ color: hex, transparent, opacity, side: THREE.DoubleSide, depthWrite: !transparent, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  matCache.set(key, m);
  return m;
}
const HL = new THREE.MeshLambertMaterial({ color: 0x3d7bff, emissive: 0x0d2a80, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const GHOST = new THREE.MeshLambertMaterial({ color: 0x9fb0c8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });

// ================================================================ Încărcarea modelului
function toIndexed(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

// un element „închis” (solid) are fiecare muchie comună unui număr par de triunghiuri
function isClosed(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  if (!idx || idx.count / 3 > 200000 || pos.count > 2000000) return false;
  const vid = new Map();
  const ids = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    let id = vid.get(k);
    if (id === undefined) { id = vid.size; vid.set(k, id); }
    ids[i] = id;
  }
  const edges = new Map();
  for (let t = 0; t < idx.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ids[idx.getX(t + e)], b = ids[idx.getX(t + (e + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const c of edges.values()) if (c % 2) return false;
  return edges.size > 0;
}

function buildMesh(el) {
  // grupează părțile pe culori: o singură plasă (mesh) pe element, cu materiale multiple
  const groups = new Map();
  for (const p of el.parts) {
    let color = p.color, opacity = p.opacity ?? 1;
    if (Array.isArray(color)) [color, opacity] = color;
    const key = color + ':' + opacity;
    if (!groups.has(key)) groups.set(key, { mat: getMat(color, opacity), geos: [] });
    groups.get(key).geos.push(toIndexed(p.geo));
  }
  const list = [...groups.values()];
  const merged = list.map((g) => (g.geos.length === 1 ? g.geos[0] : mergeGeometries(g.geos)));
  let geo, mat;
  if (merged.length === 1) { geo = merged[0]; mat = list[0].mat; } else { geo = mergeGeometries(merged, true); mat = list.map((g) => g.mat); }
  // eliberăm geometriile intermediare
  for (const g of list) for (const x of g.geos) if (x !== geo) x.dispose();
  for (const x of merged) if (x !== geo) x.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  mesh.userData.el = el;
  el.mesh = mesh;
  el.baseMat = mat;
  el.box = geo.boundingBox.clone();
  el.transparent = (Array.isArray(mat) ? mat : [mat]).every((m) => m.transparent);
  el.closed = !el.transparent && el.category !== 'space' && el.category !== 'site' && isClosed(geo);
  delete el.parts;
  return mesh;
}

function clearModel() {
  if (!S.model) return;
  for (const el of S.model.elements) { el.mesh.geometry.dispose(); }
  modelGroup.clear();
  S.model.dispose?.();
  S.model = null;
}

async function openModel(data, key) {
  clearModel();
  closePanel();
  deselect();
  const m = { ...data, key };
  m.byId = new Map();
  for (const el of m.elements) {
    if (!CATS[el.category]) el.category = 'other';
    modelGroup.add(buildMesh(el));
    m.byId.set(el.id, el);
  }
  // nivelurile: elevația se deduce din geometrie (indiferent de unitățile din fișier)
  const st = new Map(m.storeys.map((s) => [s.id, { ...s, els: [] }]));
  for (const el of m.elements) if (el.storeyId && st.has(el.storeyId)) st.get(el.storeyId).els.push(el);
  for (const s of st.values()) {
    if (s.elevation != null) continue;
    // baza pereților (apoi a stâlpilor) dă cota reală a nivelului
    const by = (re) => s.els.filter((e) => re.test(e.category));
    const walls = by(/^wall$/).length ? by(/^wall$/) : by(/^column$/).length ? by(/^column$/) : by(/curtain|door|window/);
    const pool = walls.length ? walls : s.els.filter((e) => e.category !== 'space' && e.category !== 'site');
    const ys = (pool.length ? pool : s.els).map((e) => e.box.min.y).sort((a, b) => a - b);
    s.elevation = ys.length ? ys[Math.floor(ys.length * 0.15)] : (Number(s.rawElevation) || 0);
  }
  let storeys = [...st.values()].filter((s) => s.els.length).sort((a, b) => a.elevation - b.elevation);
  if (!storeys.length) storeys = [{ id: 'all', name: 'Model', elevation: m.elements.reduce((a, e) => Math.min(a, e.box.min.y), Infinity) || 0, els: [] }];
  // elemente fără nivel -> nivelul cel mai apropiat de dedesubt
  for (const el of m.elements) {
    if (el.storeyId && st.has(el.storeyId)) continue;
    let s = storeys[0];
    for (const x of storeys) if (x.elevation <= el.box.min.y + 0.3) s = x;
    el.storeyId = s.id;
    s.els.push(el);
  }
  storeys.forEach((s, i) => {
    s.index = i;
    s.top = storeys[i + 1] ? storeys[i + 1].elevation : s.elevation + 3;
    s.box = new THREE.Box3();
    for (const e of s.els) if (e.category !== 'site') s.box.union(e.box);
    if (s.box.isEmpty()) for (const e of s.els) s.box.union(e.box);
    s.layer = 1 + (i % 30);
    for (const e of s.els) e.mesh.layers.enable(s.layer);
  });
  m.storeys = storeys;
  // cota ±0,00: nivelul cu elevația IFC cea mai apropiată de zero (sau primul nivel peste teren)
  const withRaw = storeys.filter((s) => s.rawElevation != null && isFinite(s.rawElevation));
  const zeroSt = withRaw.length ? withRaw.reduce((a, b) => (Math.abs(b.rawElevation) < Math.abs(a.rawElevation) ? b : a)) : storeys.find((s) => s.elevation > -0.5) || storeys[0];
  m.zero = storeys.every((s) => s.rawElevation === undefined) ? 0 : zeroSt.elevation; // modelul demo are deja cote reale
  m.storeyById = new Map(storeys.map((s) => [s.id, s]));
  m.box = new THREE.Box3();
  for (const el of m.elements) if (el.category !== 'site') m.box.union(el.box);
  if (m.box.isEmpty()) for (const el of m.elements) m.box.union(el.box);
  for (const el of m.elements) el.mesh.updateMatrix();
  S.model = m;

  // stare per model
  S.cats = Object.fromEntries(Object.entries(CATS).map(([k, [, on]]) => [k, on]));
  S.hidden = new Set();
  S.isolated = null;
  S.storey = null;
  S.xray = false;
  S.planStorey = storeys[0].id;
  const sz = m.box.getSize(new THREE.Vector3());
  S.section = { y: { on: false, v: m.box.min.y + sz.y * 0.55 }, x: { on: false, v: m.box.min.x + sz.x / 2, flip: false }, z: { on: false, v: m.box.min.z + sz.z / 2, flip: false } };
  S.measures.forEach(disposeMeasure);
  S.measures = store.get(`bim:measures:${key}`, []).map(makeMeasure);
  S.notes = store.get(`bim:notes:${key}`, []);
  S.views = store.get(`bim:views:${key}`, []);
  S.walker = null;
  S.pending = null;
  camera.far = Math.max(500, sz.length() * 20);
  camera.updateProjectionMatrix();
  $('#model-name').textContent = m.name;
  $('#model-sub').textContent = `${m.elements.length} elemente · ${storeys.length} niveluri`;
  document.title = m.name + ' – Model 3D';
  store.set('bim:last', key);
  applySection();
  setMode('orbit', true);
  updateVisibility();
  home(true);
  renderOverlay();
}

// ================================================================ Vizibilitate și materiale
function isShown(el) {
  if (!S.cats[el.category]) return false;
  if (S.hidden.has(el.id)) return false;
  if (S.isolated && !S.isolated.has(el.id)) return false;
  if (S.mode !== 'plan' && S.storey && el.storeyId !== S.storey) return false;
  return true;
}
let pickables = [];
function updateVisibility() {
  if (!S.model) return;
  pickables = [];
  for (const el of S.model.elements) {
    el.mesh.visible = isShown(el);
    if (el.mesh.visible) pickables.push(el.mesh);
    applyMat(el);
  }
  renderToolbar();
  invalidate();
}
function applyMat(el) {
  const base = el.baseMat;
  const arr = Array.isArray(base);
  if (S.selected === el) el.mesh.material = arr ? base.map(() => HL) : HL;
  else if (S.xray && S.mode !== 'plan') el.mesh.material = arr ? base.map(() => GHOST) : GHOST;
  else el.mesh.material = base;
}

// ================================================================ Camere și moduri
function visibleBox(filter) {
  const b = new THREE.Box3();
  for (const el of S.model.elements) if (el.mesh.visible && el.category !== 'site' && (!filter || filter(el))) b.union(el.box);
  return b.isEmpty() ? S.model.box.clone() : b;
}

let tween = null;
function flyTo(pos, target, ms = 650) {
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const start = performance.now();
  tween = (now) => {
    const k = clamp((now - start) / ms, 0, 1);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(p0, pos, e);
    controls.target.lerpVectors(t0, target, e);
    if (k >= 1) tween = null;
  };
  invalidate();
}
function fitBox(box, instant = false, dir = new THREE.Vector3(1, 0.75, 1.25)) {
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = r / Math.sin(Math.min(fov, fov * camera.aspect) / 2) * 1.05;
  const pos = c.clone().add(dir.clone().normalize().multiplyScalar(dist));
  if (instant) { camera.position.copy(pos); controls.target.copy(c); controls.update(); invalidate(); } else flyTo(pos, c);
}
function home(instant) {
  if (!S.model) return;
  if (S.mode === 'plan') return fitPlan();
  if (S.mode === 'walk') setMode('orbit');
  fitBox(visibleBox(), instant);
}

function setMode(mode, silent) {
  const prev = S.mode;
  S.mode = mode;
  document.body.classList.toggle('walking', mode === 'walk');
  controls.enabled = mode === 'orbit';
  planControls.enabled = mode === 'plan';
  $('#joystick').hidden = mode !== 'walk';
  $('#minimap').hidden = mode !== 'walk';
  if (mode === 'walk') {
    if (!S.walker) startWalk();
    camera.near = 0.05;
  } else {
    camera.near = 0.1;
  }
  camera.updateProjectionMatrix();
  if (mode === 'orbit' && prev === 'walk' && S.walker) {
    // revenim în orbită în jurul punctului privit
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).add(dir.multiplyScalar(4));
    controls.update();
  }
  if (mode === 'plan') { if (prev !== 'plan') fitPlan(); }
  scene.background = mode === 'plan' ? PAPER : SKY;
  applySection();
  updateVisibility();
  renderHud();
  if (!silent && S.panel) openPanel(S.panel);
  renderOverlay();
  invalidate();
}

// ---------------------------------------------------------------- Plan 2D
function planStorey() { return S.model.storeyById.get(S.planStorey) || S.model.storeys[0]; }
function fitPlan() {
  const s = planStorey();
  const b = s.box.isEmpty() ? S.model.box : s.box;
  const c = b.getCenter(new THREE.Vector3());
  planCam.position.set(c.x, s.elevation + 200, c.z + 0.0001);
  planControls.target.set(c.x, s.elevation, c.z);
  planCam.zoom = 1;
  planCam.userData.half = Math.max((b.max.z - b.min.z) / 2, (b.max.x - b.min.x) / 2 / Math.max(planAspect(), 0.3), 2) * 1.12;
  resize();
  planControls.update();
  invalidate();
}
function planAspect() { return view.clientWidth / Math.max(1, view.clientHeight); }
function setPlanFrustum(cam, half, aspect) {
  cam.left = -half * aspect; cam.right = half * aspect; cam.top = half; cam.bottom = -half;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------- Mers
function storeyAt(y) {
  let s = S.model.storeys[0];
  for (const x of S.model.storeys) if (x.elevation <= y + 0.4) s = x;
  return s;
}
function startWalk(at, storeyId) {
  const s = storeyId ? S.model.storeyById.get(storeyId) : (S.storey ? S.model.storeyById.get(S.storey) : S.model.storeys.find((x) => x.elevation > -0.5) || S.model.storeys[0]);
  let p = at;
  if (!p) {
    const spaces = s.els.filter((e) => e.category === 'space').sort((a, b) => volume(b.box) - volume(a.box));
    p = (spaces[0] ? spaces[0].box : s.box).getCenter(new THREE.Vector3());
  }
  let yaw = S.walker?.yaw;
  if (yaw == null) {
    // privește de-a lungul laturii mai lungi a camerei
    const sz = (at ? s.box : (s.els.filter((e) => e.category === 'space').sort((a, b) => volume(b.box) - volume(a.box))[0]?.box || s.box)).getSize(new THREE.Vector3());
    yaw = sz.x > sz.z ? -Math.PI / 2 : 0;
  }
  S.walker = { pos: new THREE.Vector3(p.x, s.elevation + 1.6, p.z), yaw, pitch: 0, vy: 0 };
  const f = floorBelow(S.walker.pos, 1.6 + 0.5);
  if (f != null) S.walker.pos.y = f + 1.6;
}
const volume = (b) => { const v = b.getSize(new THREE.Vector3()); return v.x * v.z; };
const ray = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
function solidList(forFloor) {
  return pickables.filter((m) => {
    const c = m.userData.el.category;
    if (c === 'space' || m.userData.el.transparent && !forFloor) return false;
    if (!forFloor && (c === 'door' || c === 'furniture' || c === 'sanitary' || c === 'site' || c === 'covering')) return false;
    return true;
  });
}
function clipOk(p) {
  for (const pl of activePlanes()) if (pl.distanceToPoint(p) < -1e-4) return false;
  return true;
}
function floorBelow(eye, maxDrop) {
  // caută podeaua sub ochi, ignorând obiectele mai sus de genunchi (permite urcarea treptelor)
  ray.set(new THREE.Vector3(eye.x, eye.y - 1.6 + 0.45, eye.z), DOWN);
  ray.far = maxDrop;
  ray.layers.enableAll();
  const hits = ray.intersectObjects(walkFloor.length ? walkFloor : solidList(true), false);
  for (const h of hits) if (clipOk(h.point)) return h.point.y;
  return null;
}
let walkFloor = [], walkSolid = [];
const keys = new Set();
const joy = { x: 0, y: 0 };
function stepWalk(dt) {
  const w = S.walker;
  walkFloor = solidList(true);
  walkSolid = solidList(false);
  let fx = 0, fz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
  if (keys.has('KeyA')) fx -= 1;
  if (keys.has('KeyD')) fx += 1;
  if (keys.has('ArrowLeft')) w.yaw += dt * 1.8;
  if (keys.has('ArrowRight')) w.yaw -= dt * 1.8;
  fx += joy.x; fz += -joy.y;
  const len = Math.hypot(fx, fz);
  let moving = false;
  if (len > 0.02) {
    const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.6 : 1.5) * Math.min(1, len) * dt;
    const fwd = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    const right = new THREE.Vector3(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
    const d = fwd.multiplyScalar(fz / len * sp).add(right.multiplyScalar(fx / len * sp));
    for (const axis of ['x', 'z']) {
      const step = new THREE.Vector3(axis === 'x' ? d.x : 0, 0, axis === 'z' ? d.z : 0);
      const l = step.length();
      if (l < 1e-6) continue;
      if (S.collide) {
        const dir = step.clone().normalize();
        let blocked = false;
        for (const h of [1.05, 0.55]) {
          ray.set(new THREE.Vector3(w.pos.x, w.pos.y - 1.6 + h, w.pos.z), dir);
          ray.far = l + 0.3;
          const hit = ray.intersectObjects(walkSolid, false).find((x) => clipOk(x.point));
          if (hit) { blocked = true; break; }
        }
        if (blocked) continue;
      }
      w.pos.add(step);
      moving = true;
    }
  }
  // gravitație / urcare
  const f = floorBelow(w.pos, 40);
  if (f != null) {
    const target = f + 1.6;
    if (target > w.pos.y) { w.pos.y += Math.min(target - w.pos.y, dt * 4); w.vy = 0; } else {
      w.vy = Math.min(w.vy + 9.8 * dt, 20);
      w.pos.y = Math.max(target, w.pos.y - w.vy * dt);
      if (w.pos.y === target) w.vy = 0;
    }
  }
  camera.position.copy(w.pos);
  camera.quaternion.setFromEuler(new THREE.Euler(w.pitch, w.yaw, 0, 'YXZ'));
  return moving || (f != null && Math.abs(w.pos.y - (f + 1.6)) > 1e-3);
}

// ================================================================ Secțiuni
function activePlanes() {
  if (S.mode === 'plan') return [planPlane];
  const out = [];
  if (S.section.y.on) out.push(planes.y);
  if (S.section.x.on) out.push(planes.x);
  if (S.section.z.on) out.push(planes.z);
  return out;
}
function applySection() {
  const s = S.section;
  planes.y.set(new THREE.Vector3(0, -1, 0), s.y.v);
  planes.x.set(new THREE.Vector3(s.x.flip ? 1 : -1, 0, 0), s.x.flip ? -s.x.v : s.x.v);
  planes.z.set(new THREE.Vector3(0, 0, s.z.flip ? 1 : -1), s.z.flip ? -s.z.v : s.z.v);
  if (S.model) {
    const ps = planStorey();
    planPlane.set(new THREE.Vector3(0, -1, 0), cutHeight(ps));
  }
  invalidate();
}

// ================================================================ Selecție
function select(el, { zoom = false } = {}) {
  const prev = S.selected;
  S.selected = el;
  if (prev) applyMat(prev);
  if (el) applyMat(el);
  renderCard();
  if (S.mode === 'plan') renderOverlay();
  if (zoom && el) zoomTo(el);
  invalidate();
}
function deselect() { if (S.selected) select(null); }
function zoomTo(el) {
  if (S.mode === 'plan') {
    const c = el.box.getCenter(new THREE.Vector3());
    planControls.target.set(c.x, planControls.target.y, c.z);
    planCam.position.set(c.x, planCam.position.y, c.z + 0.0001);
    planControls.update();
    return invalidate();
  }
  if (S.mode === 'walk') setMode('orbit');
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.75, 1.25);
  const b = el.box.clone().expandByScalar(0.3);
  fitBox(b, false, dir);
}

const ndc = new THREE.Vector2();
function pickAt(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  const cam = S.mode === 'plan' ? planCam : camera;
  ray.setFromCamera(ndc, cam);
  ray.far = Infinity;
  ray.layers.enableAll();
  let list = pickables;
  if (S.mode === 'plan') { const s = planStorey(); list = pickables.filter((m) => m.userData.el.storeyId === s.id); }
  const hits = ray.intersectObjects(list, false).filter((h) => clipOk(h.point));
  if (!hits.length) return null;
  if (S.mode !== 'plan') { const solid = hits.find((h) => h.object.userData.el.category !== 'space'); if (solid) return solid; }
  return hits[0];
}
function snapPoint(hit) {
  // atrage punctul spre cel mai apropiat colț al triunghiului atins
  const p = hit.point.clone();
  if (!hit.face) return p;
  const pos = hit.object.geometry.attributes.position;
  const tol = S.mode === 'plan' ? 0.15 / planCam.zoom * (planCam.userData.half || 10) / 10 : Math.min(0.25, hit.distance * 0.025);
  let best = null, bd = tol;
  for (const i of [hit.face.a, hit.face.b, hit.face.c]) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const d = v.distanceTo(p);
    if (d < bd) { bd = d; best = v; }
  }
  return best || p;
}

// ================================================================ Măsurători
const measureMat = new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true });
const dotGeo = new THREE.SphereGeometry(1, 12, 8);
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true });
function makeMeasure(m) {
  const a = new THREE.Vector3(...m.a), b = new THREE.Vector3(...m.b);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), measureMat);
  line.renderOrder = 999;
  const g = new THREE.Group();
  g.add(line);
  for (const p of [a, b]) { const d = new THREE.Mesh(dotGeo, dotMat); d.position.copy(p); d.renderOrder = 999; d.userData.dot = true; g.add(d); }
  helpers.add(g);
  return { ...m, obj: g, va: a, vb: b };
}
function disposeMeasure(m) { helpers.remove(m.obj); m.obj.children[0].geometry.dispose(); }
function saveMeasures() { store.set(`bim:measures:${S.model.key}`, S.measures.map(({ id, a, b }) => ({ id, a, b }))); }

// ================================================================ Notițe
const NOTE_COLORS = ['#e5484d', '#f59e0b', '#30a46c', '#1f4fd8', '#8e4ec6'];
function saveNotes() { store.set(`bim:notes:${S.model.key}`, S.notes); }
function saveViews() { store.set(`bim:views:${S.model.key}`, S.views); }
function captureView() {
  return {
    mode: S.mode, cam: camera.position.toArray(), target: controls.target.toArray(),
    walker: S.walker ? { pos: S.walker.pos.toArray(), yaw: S.walker.yaw, pitch: S.walker.pitch } : null,
    plan: { storey: S.planStorey, pos: planCam.position.toArray(), target: planControls.target.toArray(), zoom: planCam.zoom },
    storey: S.storey, xray: S.xray, section: JSON.parse(JSON.stringify(S.section)),
  };
}
function restoreView(v) {
  if (!v) return;
  S.section = JSON.parse(JSON.stringify(v.section || S.section));
  S.storey = v.storey && S.model.storeyById.has(v.storey) ? v.storey : null;
  S.xray = !!v.xray;
  if (v.plan && S.model.storeyById.has(v.plan.storey)) S.planStorey = v.plan.storey;
  applySection();
  if (v.mode === 'walk' && v.walker) {
    S.walker = { pos: new THREE.Vector3(...v.walker.pos), yaw: v.walker.yaw, pitch: v.walker.pitch, vy: 0 };
    setMode('walk');
  } else if (v.mode === 'plan') {
    setMode('plan');
    if (v.plan.pos) { planCam.position.fromArray(v.plan.pos); planControls.target.fromArray(v.plan.target); planCam.zoom = v.plan.zoom || 1; planCam.updateProjectionMatrix(); planControls.update(); }
  } else {
    setMode('orbit');
    flyTo(new THREE.Vector3(...v.cam), new THREE.Vector3(...v.target));
  }
  updateVisibility();
}

// ================================================================ Dialog simplu
function dialog({ title, body, ok = 'Salvează', danger }) {
  const d = $('#dlg');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${body}<div class="btns">
    <button class="btn" value="cancel" formnovalidate>Renunță</button><button class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(ok)}</button></div></form>`;
  return new Promise((res) => {
    d.onclose = () => res(d.returnValue === 'ok' ? new FormData($('form', d)) : null);
    d.returnValue = '';
    d.showModal();
    const f = $('input:not([type=radio]),textarea', d);
    if (f) setTimeout(() => f.focus(), 50);
  });
}

// ================================================================ Interacțiune pe pânză
let down = null;
let lastTap = 0;
const look = { id: null, x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, multi: !!down };
  if (S.mode === 'walk' && look.id == null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; canvas.setPointerCapture(e.pointerId); }
});
canvas.addEventListener('pointermove', (e) => {
  if (S.mode === 'walk' && look.id === e.pointerId && S.walker) {
    const k = e.pointerType === 'touch' ? 0.005 : 0.004;
    S.walker.yaw -= (e.clientX - look.x) * k;
    S.walker.pitch = clamp(S.walker.pitch - (e.clientY - look.y) * k, -1.4, 1.4);
    look.x = e.clientX; look.y = e.clientY;
    invalidate();
  }
});
const endPointer = (e) => {
  if (look.id === e.pointerId) look.id = null;
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const dt = performance.now() - down.t;
  const multi = down.multi;
  down = null;
  if (e.type === 'pointerup' && moved < 7 && dt < 450 && !multi) {
    const now = performance.now();
    const dbl = now - lastTap < 320;
    lastTap = dbl ? 0 : now;
    onTap(e.clientX, e.clientY, dbl);
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

async function onTap(x, y, dbl) {
  if (!S.model) return;
  const hit = pickAt(x, y);
  if (S.tool === 'measure') {
    if (!hit) return;
    const p = snapPoint(hit);
    if (!S.pending) { S.pending = p; renderOverlay(); renderHud(); return; }
    const m = makeMeasure({ id: uid(), a: S.pending.toArray(), b: p.toArray() });
    S.measures.push(m);
    S.pending = null;
    saveMeasures();
    renderHud();
    renderOverlay();
    if (S.panel === 'measure') openPanel('measure');
    invalidate();
    return;
  }
  if (S.tool === 'note') {
    if (!hit) return toast('Atinge o suprafață a modelului');
    const p = hit.point.clone();
    const n = hit.face ? hit.face.normal.clone() : new THREE.Vector3();
    p.add(n.multiplyScalar(0.02));
    const el = hit.object.userData.el;
    const fd = await dialog({
      title: 'Notiță nouă',
      body: `<div class="muted">Pe: ${esc(el.name)}</div>
        <input class="field" name="title" placeholder="Titlu (ex. Fisură tencuială)" required maxlength="120">
        <textarea class="field" name="text" placeholder="Descriere"></textarea>
        <div class="colors">${NOTE_COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i ? '' : 'checked'}><span style="--c:${c}"></span></label>`).join('')}</div>`,
    });
    if (!fd) return;
    S.notes.push({ id: uid(), p: p.toArray(), title: fd.get('title'), text: fd.get('text'), color: fd.get('color'), elId: el.id, elName: el.name, date: Date.now(), view: captureView() });
    saveNotes();
    setTool(null);
    renderOverlay();
    openPanel('notes');
    return;
  }
  if (dbl && hit) {
    if (S.mode === 'orbit') {
      const p = hit.point;
      const off = camera.position.clone().sub(controls.target);
      flyTo(p.clone().add(off.setLength(Math.min(off.length(), Math.max(4, off.length() * 0.6)))), p.clone());
      return;
    }
    if (S.mode === 'walk' && S.walker) {
      const p = hit.point;
      const n = hit.face?.normal;
      if (n && Math.abs(n.y) > 0.7 && p.y < S.walker.pos.y) { walkTo(p); return; }
    }
    if (S.mode === 'plan') { goWalkHere(hit.point); return; }
  }
  if (!hit) { deselect(); return; }
  S.lastHit = hit.point.clone();
  select(hit.object.userData.el);
}

function walkTo(p) {
  const w = S.walker;
  const from = w.pos.clone();
  const to = new THREE.Vector3(p.x, p.y + 1.6, p.z);
  const start = performance.now();
  const ms = clamp(from.distanceTo(to) * 220, 300, 1400);
  tween = (now) => {
    const k = clamp((now - start) / ms, 0, 1);
    w.pos.lerpVectors(from, to, 1 - Math.pow(1 - k, 3));
    if (k >= 1) tween = null;
  };
  invalidate();
}
function goWalkHere(p) {
  const s = planStorey();
  const keepYaw = S.walker?.yaw;
  S.walker = null;
  startWalk(new THREE.Vector3(p.x, s.elevation, p.z), s.id);
  if (keepYaw != null) S.walker.yaw = keepYaw;
  if (S.storey && S.storey !== s.id) S.storey = null;
  setMode('walk');
  deselect();
}

// ---------------------------------------------------------------- Joystick
{
  const js = $('#joystick'), knob = $('.knob', js);
  let id = null;
  const set = (e) => {
    const r = js.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    joy.x = dx; joy.y = dy;
    knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    invalidate();
  };
  js.addEventListener('pointerdown', (e) => { id = e.pointerId; js.setPointerCapture(id); set(e); e.preventDefault(); });
  js.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  js.addEventListener('pointerup', end);
  js.addEventListener('pointercancel', end);
}
$('#minimap').addEventListener('click', (e) => {
  // atingere pe minihartă -> te muți acolo, pe nivelul curent
  if (!S.walker) return;
  const r = $('#minimap').getBoundingClientRect();
  const v = new THREE.Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0).unproject(mmCam);
  const s = storeyAt(S.walker.pos.y - 1.6);
  const w = S.walker;
  w.pos.set(v.x, s.elevation + 1.6, v.z);
  const f = floorBelow(w.pos, 2.5);
  if (f != null) w.pos.y = f + 1.6;
  invalidate();
});

addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select,dialog')) return;
  keys.add(e.code);
  if (S.mode === 'walk') invalidate();
  if (e.code === 'Escape') { if (S.tool) setTool(null); else if (S.selected) deselect(); else closePanel(); }
  if (e.code === 'Digit1') setMode('orbit');
  if (e.code === 'Digit2') setMode('walk');
  if (e.code === 'Digit3') setMode('plan');
  if (e.code === 'KeyF' && S.selected) zoomTo(S.selected);
  if (e.code === 'KeyH') home();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ================================================================ Randare
let dirty = true;
function invalidate() { dirty = true; }
controls.addEventListener('change', invalidate);
planControls.addEventListener('change', invalidate);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  setPlanFrustum(planCam, planCam.userData.half || 10, w / h);
  invalidate();
}
new ResizeObserver(resize).observe(view);

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (tween) { tween(now); dirty = true; }
  if (S.mode === 'orbit' && controls.update()) dirty = true;
  if (S.mode === 'plan' && planControls.update()) dirty = true;
  if (S.mode === 'walk' && S.walker && S.model) {
    if (stepWalk(dt) || keys.size || joy.x || joy.y) dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  render();
}
requestAnimationFrame(loop);

const tmpV = new THREE.Vector3();
// Desenează scena cu planurile de secțiune date și capacele hașurate.
const capTmp = new THREE.Vector3();
function drawScene(cam, cuts, background) {
  renderer.autoClear = false;
  renderer.setClearColor(background, 1);
  renderer.clear(true, true, true);
  const bg = scene.background;
  scene.background = null;
  if (cuts.length) {
    const off = [];
    for (const el of S.model.elements) if (el.mesh.visible && !el.closed) { el.mesh.visible = false; off.push(el.mesh); }
    helpers.visible = false;
    const size = S.model.box.getSize(capTmp).length() * 2 + 20;
    for (const p of cuts) {
      renderer.clear(false, false, true);
      renderer.clippingPlanes = cuts;
      scene.overrideMaterial = stencilBack;
      renderer.render(scene, cam);
      scene.overrideMaterial = stencilFront;
      renderer.render(scene, cam);
      scene.overrideMaterial = null;
      p.coplanarPoint(capMesh.position);
      capMesh.lookAt(capTmp.copy(capMesh.position).add(p.normal));
      capMesh.scale.setScalar(size);
      capMesh.updateMatrixWorld();
      renderer.clippingPlanes = cuts.filter((q) => q !== p);
      renderer.render(capScene, cam);
    }
    for (const m of off) m.visible = true;
    helpers.visible = true;
  }
  renderer.clippingPlanes = cuts;
  renderer.render(scene, cam);
  scene.background = bg;
  renderer.autoClear = true;
}

function render() {
  if (!S.model) { renderer.render(scene, camera); return; }
  const cuts = activePlanes();
  // punctele de măsurare au mărime constantă pe ecran
  const cam = S.mode === 'plan' ? planCam : camera;
  for (const g of helpers.children) for (const d of g.children) if (d.userData.dot) {
    const s = S.mode === 'plan' ? (planCam.top - planCam.bottom) / planCam.zoom / view.clientHeight * 5 : d.position.distanceTo(camera.position) * 0.006;
    d.scale.setScalar(s);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, view.clientWidth, view.clientHeight);
  if (S.mode === 'plan') {
    planCam.layers.set(planStorey().layer);
    drawScene(planCam, cuts, PAPER);
    // ajutoarele (măsurători) sunt pe stratul 0
    planCam.layers.set(0);
    renderer.autoClear = false;
    const vis = modelGroup.visible, bg = scene.background;
    modelGroup.visible = false;
    scene.background = null;
    renderer.render(scene, planCam);
    modelGroup.visible = vis;
    scene.background = bg;
    renderer.autoClear = true;
  } else {
    camera.layers.enableAll();
    drawScene(camera, cuts, SKY);
    if (S.mode === 'walk' && S.walker) renderMinimap();
  }
  renderOverlayPositions(cam);
}

function renderMinimap() {
  const mm = $('#minimap');
  const r = mm.getBoundingClientRect(), vr = view.getBoundingClientRect();
  const s = storeyAt(S.walker.pos.y - 1.6);
  const b = s.box.isEmpty() ? S.model.box : s.box;
  const c = b.getCenter(tmpV);
  const half = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 * 1.1 + 0.5;
  mmCam.position.set(c.x, s.elevation + 200, c.z + 0.0001);
  mmCam.lookAt(c.x, s.elevation, c.z);
  setPlanFrustum(mmCam, half, r.width / r.height);
  mmCam.layers.set(s.layer);
  mmPlane.constant = cutHeight(s);
  const x = r.left - vr.left, y = vr.bottom - r.bottom;
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, r.width, r.height);
  renderer.setViewport(x, y, r.width, r.height);
  // în minihartă nu folosim rază X
  const xr = S.xray;
  if (xr) { S.xray = false; for (const el of s.els) applyMat(el); }
  drawScene(mmCam, [mmPlane], PAPER);
  if (xr) { S.xray = true; for (const el of s.els) applyMat(el); }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, view.clientWidth, view.clientHeight);
  $('.mm-title', mm).textContent = s.name;
  const p = S.walker.pos.clone().project(mmCam);
  const me = $('#me');
  me.style.left = ((p.x + 1) / 2 * r.width) + 'px';
  me.style.top = ((1 - p.y) / 2 * r.height) + 'px';
  me.style.setProperty('--a', (-S.walker.yaw * 180 / Math.PI) + 'deg');
}

// ---------------------------------------------------------------- Suprapuneri HTML (etichete, notițe, camere)
let overlayItems = [];
function renderOverlay() {
  overlay.innerHTML = '';
  overlayItems = [];
  if (!S.model) return;
  const addItem = (html, pos, onclick) => {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    const node = tpl.content.firstChild;
    overlay.appendChild(node);
    if (onclick) node.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
    overlayItems.push({ node, pos });
  };
  for (const m of S.measures) {
    const mid = m.va.clone().add(m.vb).multiplyScalar(0.5);
    addItem(`<div class="tag">${fmt(m.va.distanceTo(m.vb))} m</div>`, mid);
  }
  if (S.pending) addItem('<div class="dotpt"></div>', S.pending.clone());
  S.notes.forEach((n, i) => addItem(`<button class="pin" style="--c:${esc(n.color)}" title="${esc(n.title)}"><span><i>${i + 1}</i></span></button>`, new THREE.Vector3(...n.p), () => openNote(n)));
  if (S.mode === 'plan') {
    const s = planStorey();
    for (const el of s.els) {
      if (el.category !== 'space') continue;
      const c = el.box.getCenter(new THREE.Vector3());
      c.y = s.elevation + 0.5;
      const name = el.label || el.name;
      addItem(`<div class="room ${S.selected === el ? 'on' : ''}"><b>${esc(name)}</b>${el.area ? `${fmt(el.area)} m²` : ''}</div>`, c, () => select(el));
    }
    if (S.walker && storeyAt(S.walker.pos.y - 1.6).id === s.id) {
      addItem('<div class="here" title="Ești aici – atinge pentru a continua plimbarea"></div>', S.walker.pos.clone(), () => setMode('walk'));
    }
  }
  invalidate();
}
function renderOverlayPositions(cam) {
  const w = view.clientWidth, h = view.clientHeight;
  for (const it of overlayItems) {
    tmpV.copy(it.pos).project(cam);
    const behind = tmpV.z > 1 || tmpV.z < -1;
    const clipped = S.mode !== 'plan' && !clipOk(it.pos);
    if (behind || clipped || Math.abs(tmpV.x) > 1.2 || Math.abs(tmpV.y) > 1.2) { it.node.style.display = 'none'; continue; }
    it.node.style.display = '';
    it.node.style.left = ((tmpV.x + 1) / 2 * w) + 'px';
    it.node.style.top = ((1 - tmpV.y) / 2 * h) + 'px';
    if (it.node.classList.contains('here') && S.walker) it.node.style.setProperty('--a', (-S.walker.yaw * 180 / Math.PI) + 'deg');
  }
}

// ================================================================ Interfață: bara de unelte și HUD
function renderToolbar() {
  const t = (k, icon, label, on) => `<button data-t="${k}" class="${on ? 'on' : ''}" title="${label}">${ico(icon)}<span>${label}</span></button>`;
  $('#toolbar').innerHTML = [
    t('models', 'models', 'Modele', S.panel === 'models'),
    t('storeys', 'storeys', 'Niveluri', S.panel === 'storeys' || !!S.storey),
    '<span class="sep"></span>',
    t('orbit', 'orbit', '3D', S.mode === 'orbit'),
    t('walk', 'walk', 'Mers', S.mode === 'walk'),
    t('plan', 'plan', 'Plan 2D', S.mode === 'plan'),
    '<span class="sep"></span>',
    t('section', 'section', 'Secțiune', S.panel === 'section' || activePlanes().length > 0 && S.mode !== 'plan'),
    t('measure', 'measure', 'Măsoară', S.tool === 'measure'),
    t('notes', 'note', 'Notițe', S.tool === 'note' || S.panel === 'notes'),
    t('views', 'views', 'Vederi', S.panel === 'views'),
    t('layers', 'layers', 'Straturi', S.panel === 'layers'),
    t('xray', 'xray', 'Rază X', S.xray),
    t('home', 'home', 'Acasă', false),
  ].join('');
}
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-t]');
  if (!b || !S.model && b.dataset.t !== 'models') return;
  const k = b.dataset.t;
  if (k === 'orbit' || k === 'walk' || k === 'plan') {
    if (k === 'plan' && S.mode !== 'plan') {
      if (S.walker && S.mode === 'walk') S.planStorey = storeyAt(S.walker.pos.y - 1.6).id;
      else if (S.storey) S.planStorey = S.storey;
    }
    setMode(k);
    if (k === 'walk') toast(matchMedia('(pointer:coarse)').matches ? 'Joystick: mers · glisează pe ecran: privire · dublu-tap pe podea: mergi acolo' : 'W A S D / săgeți: mers · Shift: alergare · trage cu mouse-ul: privire · dublu-clic pe podea: mergi acolo', 4500);
    return;
  }
  if (k === 'measure') { setTool(S.tool === 'measure' ? null : 'measure'); if (S.tool) openPanel('measure'); return; }
  if (k === 'notes') { if (S.panel === 'notes') { closePanel(); setTool(null); } else openPanel('notes'); return; }
  if (k === 'xray') { S.xray = !S.xray; updateVisibility(); return; }
  if (k === 'home') { home(); return; }
  if (S.panel === k) closePanel(); else openPanel(k);
});

function setTool(t) {
  S.tool = t;
  S.pending = null;
  renderToolbar();
  renderHud();
  renderOverlay();
}

function renderHud() {
  const hud = $('#hud');
  const parts = [];
  if (S.tool === 'measure') parts.push(`<span class="chip hint">${S.pending ? 'Atinge al doilea punct' : 'Atinge primul punct'} · se prinde de colțuri</span><button class="chip" data-h="endtool">Gata</button>`);
  if (S.tool === 'note') parts.push('<span class="chip hint">Atinge locul notiței pe model</span><button class="chip" data-h="endtool">Renunță</button>');
  if (S.mode === 'plan' && S.model) {
    parts.push(S.model.storeys.map((s) => `<button class="chip ${s.id === S.planStorey ? 'on' : ''}" data-plan="${esc(s.id)}">${esc(s.name)}</button>`).join(''));
  }
  if (S.mode === 'walk') parts.push(`<button class="chip ${S.collide ? 'on' : ''}" data-h="collide">Coliziuni</button>`);
  if (S.model && (S.isolated || S.hidden.size || S.storey)) parts.push('<button class="chip" data-h="showall">Arată tot</button>');
  hud.innerHTML = parts.join('');
}
$('#hud').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.plan) { S.planStorey = b.dataset.plan; applySection(); fitPlan(); renderHud(); renderOverlay(); deselect(); return; }
  const h = b.dataset.h;
  if (h === 'endtool') setTool(null);
  if (h === 'collide') { S.collide = !S.collide; store.set('bim:collide', S.collide); renderHud(); }
  if (h === 'showall') { S.isolated = null; S.hidden.clear(); S.storey = null; updateVisibility(); renderHud(); if (S.panel) openPanel(S.panel); }
});

// ================================================================ Fișa elementului
function renderCard(tab) {
  const card = $('#card');
  const el = S.selected;
  if (!el) { card.hidden = true; return; }
  const s = S.model.storeyById.get(el.storeyId);
  card.hidden = false;
  card.innerHTML = `<div class="head"><div class="grow"><b>${esc(el.name)}</b><small>${esc(el.ifcType)} · ${esc(CATS[el.category][0])}${s ? ' · ' + esc(s.name) : ''}</small></div>
    <button class="icon-btn" data-c="close" aria-label="Închide">${ico('close')}</button></div>
    <div class="acts">
      <button class="mini" data-c="props">${ico('props')}Proprietăți</button>
      ${S.mode === 'plan' ? `<button class="mini" data-c="walkhere">${ico('walk')}Mergi aici</button>` : ''}
      <button class="mini" data-c="zoom">${ico('zoom')}Zoom</button>
      <button class="mini" data-c="isolate">${ico('isolate')}Izolează</button>
      <button class="mini" data-c="hide">${ico('eyeOff')}Ascunde</button>
      <button class="mini" data-c="note">${ico('note')}Notiță</button>
    </div><div class="body"></div>`;
  if (tab === 'props' || store.get('bim:propsOpen', false)) showProps();
}
async function showProps() {
  const el = S.selected;
  const body = $('#card .body');
  if (!el || !body) return;
  store.set('bim:propsOpen', true);
  body.innerHTML = '<div class="empty">Se citesc proprietățile…</div>';
  let props;
  try { props = el.props || (S.model.getProps ? await S.model.getProps(el.expressID ?? el.id) : {}); } catch (e) { props = { Eroare: { Mesaj: e.message } }; }
  if (S.selected !== el) return;
  const s = S.model.storeyById.get(el.storeyId);
  const size = el.box.getSize(new THREE.Vector3());
  const general = { 'Nume': el.name, 'Clasă IFC': el.ifcType, 'Categorie': CATS[el.category][0], 'Nivel': s?.name || '—', 'Gabarit L×l×H [m]': `${fmt(size.x)} × ${fmt(size.z)} × ${fmt(size.y)}`, 'Cotă bază [m]': fmt(el.box.min.y - (s?.elevation ?? 0)) };
  const sections = [['General', general], ...Object.entries(props || {})];
  body.innerHTML = sections.map(([name, rows], i) => `<details class="pset" ${i < 3 ? 'open' : ''}><summary>${esc(name)}</summary><table class="kv"><tbody>
    ${Object.entries(rows).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'number' ? fmt(v, v % 1 ? 2 : 0) : v)}</td></tr>`).join('')}</tbody></table></details>`).join('');
}
$('#card').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-c]');
  if (!b) return;
  const el = S.selected;
  const c = b.dataset.c;
  if (c === 'close') { store.set('bim:propsOpen', false); deselect(); }
  if (c === 'props') { if ($('#card .body').innerHTML) { $('#card .body').innerHTML = ''; store.set('bim:propsOpen', false); } else showProps(); }
  if (c === 'zoom') zoomTo(el);
  if (c === 'isolate') { S.isolated = new Set([el.id]); updateVisibility(); renderHud(); if (S.mode !== 'plan') zoomTo(el); }
  if (c === 'hide') { S.hidden.add(el.id); deselect(); updateVisibility(); renderHud(); }
  if (c === 'walkhere') goWalkHere(S.lastHit || el.box.getCenter(new THREE.Vector3()));
  if (c === 'note') { setTool('note'); toast('Atinge locul exact al notiței'); }
});

// ================================================================ Panouri
function closePanel() { S.panel = null; $('#panel').hidden = true; renderToolbar(); }
function openPanel(name) {
  S.panel = name;
  const titles = { models: 'Modele', storeys: 'Niveluri', section: 'Secțiuni', measure: 'Măsurători', notes: 'Notițe', views: 'Vederi salvate', layers: 'Straturi și căutare' };
  $('#panel-title').textContent = titles[name] || '';
  const body = $('#panel-body');
  body.innerHTML = '';
  ({ models: pModels, storeys: pStoreys, section: pSection, measure: pMeasure, notes: pNotes, views: pViews, layers: pLayers })[name](body);
  $('#panel').hidden = false;
  renderToolbar();
}
$('#panel-close').onclick = () => { if (S.panel === 'measure' || S.panel === 'notes') setTool(null); closePanel(); };

const sw = (name, on, extra = '') => `<label class="sw"><input type="checkbox" ${extra} data-k="${esc(name)}" ${on ? 'checked' : ''}><i></i></label>`;

async function pModels(body) {
  const saved = await idb.list().catch(() => []);
  const cur = S.model?.key;
  body.innerHTML = `
    <div class="btns"><button class="btn primary block" data-a="open">${ico('upload')}Deschide fișier IFC</button></div>
    <div class="muted" style="font-size:13px;margin:0 2px 8px">Exportă modelul din ARCHICAD, Revit, Allplan, Tekla, Vectorworks etc. ca <b>IFC</b> (2x3 sau 4). Fișierul se procesează local, pe dispozitiv, și rămâne disponibil offline.</div>
    <h3>Modele pe acest dispozitiv</h3>
    <div class="list">
      <div class="row ${cur === 'demo' ? 'on' : ''}"><div class="grow"><div>Casă P+1 (demo)</div><small>Model demonstrativ</small></div><div class="acts"><button class="mini" data-a="demo">Deschide</button></div></div>
      ${saved.map((m) => `<div class="row ${cur === m.id ? 'on' : ''}"><div class="grow"><div>${esc(m.name)}</div><small>${fmt(m.size / 1048576, 1)} MB · ${new Date(m.date).toLocaleDateString('ro-RO')}</small></div>
        <div class="acts"><button class="mini" data-a="load" data-id="${esc(m.id)}">Deschide</button><button class="mini danger" data-a="del" data-id="${esc(m.id)}" aria-label="Șterge">${ico('trash')}</button></div></div>`).join('')}
    </div>
    ${S.model ? `<h3>Despre modelul deschis</h3><table class="kv"><tbody>
      ${Object.entries(S.model.project || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
      <tr><td>Niveluri</td><td>${S.model.storeys.length}</td></tr>
      <tr><td>Gabarit [m]</td><td>${(() => { const s = S.model.box.getSize(new THREE.Vector3()); return `${fmt(s.x, 1)} × ${fmt(s.z, 1)} × ${fmt(s.y, 1)}`; })()}</td></tr>
    </tbody></table>` : ''}`;
  body.onclick = async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'open') $('#file').click();
    if (a === 'demo') loadDemo();
    if (a === 'load') loadSaved(b.dataset.id);
    if (a === 'del') {
      if (!await dialog({ title: 'Ștergi modelul de pe dispozitiv?', body: '<div class="muted">Notițele și vederile lui se păstrează dacă îl deschizi din nou.</div>', ok: 'Șterge', danger: true })) return;
      await idb.del(b.dataset.id);
      if (store.get('bim:last') === b.dataset.id) store.set('bim:last', 'demo');
      openPanel('models');
    }
  };
}

function pStoreys(body) {
  const m = S.model;
  body.innerHTML = `<div class="list">
    <div class="row ${!S.storey ? 'on' : ''}"><div class="grow"><div>Toate nivelurile</div><small>${m.elements.length} elemente</small></div><div class="acts"><button class="mini" data-a="all">Arată</button></div></div>
    ${[...m.storeys].reverse().map((s) => `<div class="row ${S.storey === s.id ? 'on' : ''}">
      <div class="grow"><div>${esc(s.name)}</div><small>Cota ${s.elevation - m.zero >= 0 ? '+' : ''}${fmt(s.elevation - m.zero)} m · ${s.els.length} elemente</small></div>
      <div class="acts"><button class="mini" data-a="only" data-id="${esc(s.id)}">Doar</button><button class="mini" data-a="plan" data-id="${esc(s.id)}">Plan</button><button class="mini" data-a="walk" data-id="${esc(s.id)}">Mers</button><button class="mini" data-a="cut" data-id="${esc(s.id)}">Taie</button></div>
    </div>`).join('')}</div>
    <div class="muted" style="font-size:13px;margin:10px 2px">„Taie” face o secțiune orizontală la 1,2 m deasupra nivelului și ascunde ce e deasupra – vedere axonometrică a etajului.</div>`;
  body.onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const s = m.storeyById.get(b.dataset.id);
    const a = b.dataset.a;
    if (a === 'all') { S.storey = null; S.section.y.on = false; applySection(); updateVisibility(); if (S.mode === 'orbit') fitBox(visibleBox()); }
    if (a === 'only') { S.storey = s.id; updateVisibility(); if (S.mode === 'orbit') fitBox(visibleBox()); }
    if (a === 'plan') { S.planStorey = s.id; applySection(); if (S.mode === 'plan') fitPlan(); setMode('plan'); }
    if (a === 'walk') { S.storey = null; S.walker = null; startWalk(null, s.id); setMode('walk'); }
    if (a === 'cut') {
      S.storey = null;
      S.section.y = { on: true, v: cutHeight(s) };
      applySection();
      if (S.mode !== 'orbit') setMode('orbit');
      updateVisibility();
      fitBox(s.box, false, new THREE.Vector3(1, 1.3, 1.25));
    }
    renderHud();
    openPanel('storeys');
  };
}

function pSection(body) {
  const b = S.model.box, s = S.section;
  const ax = [['y', 'Orizontală (înălțime)', b.min.y, b.max.y], ['x', 'Verticală longitudinală (X)', b.min.x, b.max.x], ['z', 'Verticală transversală (Z)', b.min.z, b.max.z]];
  body.innerHTML = `${ax.map(([k, label, lo, hi]) => `<h3>${label}</h3>
    <div class="row"><div class="grow"><div>Activă</div><small data-val="${k}">${fmt(s[k].v)} m</small></div>
      ${k !== 'y' ? `<button class="mini" data-flip="${k}">Inversează</button>` : ''}${sw(k, s[k].on)}</div>
    <input class="range" type="range" data-r="${k}" min="${lo - 0.05}" max="${hi + 0.05}" step="0.01" value="${s[k].v}">`).join('')}
    <div class="btns"><button class="btn block" data-a="off">Dezactivează toate</button></div>`;
  body.oninput = (e) => {
    const k = e.target.dataset.r;
    if (k) { s[k].v = +e.target.value; s[k].on = true; $(`[data-k="${k}"]`, body).checked = true; $(`[data-val="${k}"]`, body).textContent = fmt(s[k].v) + ' m'; applySection(); renderToolbar(); }
  };
  body.onchange = (e) => { const k = e.target.dataset.k; if (k) { s[k].on = e.target.checked; applySection(); renderToolbar(); } };
  body.onclick = (e) => {
    const f = e.target.closest('[data-flip]');
    if (f) { s[f.dataset.flip].flip = !s[f.dataset.flip].flip; s[f.dataset.flip].on = true; applySection(); openPanel('section'); }
    if (e.target.closest('[data-a=off]')) { s.x.on = s.y.on = s.z.on = false; applySection(); openPanel('section'); }
  };
  if (S.mode === 'plan') setMode('orbit', true); // secțiunile se văd în 3D (planul are tăietura lui automată)
}

function pMeasure(body) {
  body.innerHTML = `<div class="btns"><button class="btn ${S.tool === 'measure' ? 'primary' : ''} block" data-a="tool">${ico('measure')}${S.tool === 'measure' ? 'Măsurare activă – atinge 2 puncte' : 'Măsoară o distanță'}</button></div>
    ${S.measures.length ? `<div class="list">${S.measures.map((m, i) => {
      const d = m.vb.clone().sub(m.va);
      return `<div class="row"><div class="grow"><div>${i + 1}. ${fmt(d.length())} m</div><small>Δx ${fmt(Math.abs(d.x))} · Δy ${fmt(Math.abs(d.z))} · Δh ${fmt(Math.abs(d.y))} m</small></div>
        <div class="acts"><button class="mini danger" data-del="${m.id}" aria-label="Șterge">${ico('trash')}</button></div></div>`;
    }).join('')}</div><div class="btns"><button class="btn danger block" data-a="clear">Șterge toate</button></div>` : '<div class="empty">Nicio măsurătoare. Punctele se prind automat de colțurile elementelor.</div>'}`;
  body.onclick = (e) => {
    if (e.target.closest('[data-a=tool]')) { setTool(S.tool === 'measure' ? null : 'measure'); openPanel('measure'); }
    const d = e.target.closest('[data-del]');
    if (d) { const m = S.measures.find((x) => x.id === d.dataset.del); disposeMeasure(m); S.measures = S.measures.filter((x) => x !== m); saveMeasures(); renderOverlay(); openPanel('measure'); }
    if (e.target.closest('[data-a=clear]')) { S.measures.forEach(disposeMeasure); S.measures = []; saveMeasures(); renderOverlay(); openPanel('measure'); }
  };
}

function pNotes(body) {
  body.innerHTML = `<div class="btns"><button class="btn ${S.tool === 'note' ? 'primary' : ''} block" data-a="tool">${ico('plus')}${S.tool === 'note' ? 'Atinge locul pe model…' : 'Adaugă notiță pe model'}</button></div>
    ${S.notes.length ? `<div class="list">${S.notes.map((n, i) => `<button class="row" data-open="${n.id}"><span class="swatch" style="background:${esc(n.color)}"></span>
      <div class="grow"><div>${i + 1}. ${esc(n.title)}</div><small>${esc(n.elName || '')} · ${new Date(n.date).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })}</small></div></button>`).join('')}</div>
      <div class="btns"><button class="btn block" data-a="csv">Export CSV (Excel)</button></div>` : '<div class="empty">Nicio notiță. Notițele se văd ca pini în 3D și pe planuri și păstrează unghiul de vedere.</div>'}`;
  body.onclick = (e) => {
    if (e.target.closest('[data-a=tool]')) { setTool(S.tool === 'note' ? null : 'note'); openPanel('notes'); }
    const o = e.target.closest('[data-open]');
    if (o) openNote(S.notes.find((n) => n.id === o.dataset.open));
    if (e.target.closest('[data-a=csv]')) exportNotes();
  };
}
async function openNote(n) {
  restoreView(n.view);
  const i = S.notes.indexOf(n) + 1;
  const fd = await dialog({
    title: `Notița ${i}`,
    body: `<input class="field" name="title" value="${esc(n.title)}" required maxlength="120"><textarea class="field" name="text">${esc(n.text)}</textarea>
      <div class="muted" style="font-size:13px">${esc(n.elName || '')} · ${new Date(n.date).toLocaleString('ro-RO')}</div>
      <label class="row"><div class="grow"><div>Șterge notița</div></div><label class="sw"><input type="checkbox" name="del"><i></i></label></label>`,
  });
  if (!fd) return;
  if (fd.get('del')) S.notes = S.notes.filter((x) => x !== n); else { n.title = fd.get('title'); n.text = fd.get('text'); }
  saveNotes();
  renderOverlay();
  if (S.panel === 'notes') openPanel('notes');
}
function exportNotes() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Nr', 'Titlu', 'Descriere', 'Element', 'Data', 'X', 'Y', 'Z'].map(q).join(';')];
  S.notes.forEach((n, i) => rows.push([i + 1, n.title, n.text, n.elName, new Date(n.date).toLocaleString('ro-RO'), fmt(n.p[0]), fmt(-n.p[2]), fmt(n.p[1])].map(q).join(';')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' }));
  a.download = `Notite - ${S.model.name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pViews(body) {
  const label = { orbit: '3D', walk: 'Mers', plan: 'Plan 2D' };
  body.innerHTML = `<div class="btns"><button class="btn primary block" data-a="save">${ico('plus')}Salvează vederea curentă</button></div>
    ${S.views.length ? `<div class="list">${S.views.map((v) => `<div class="row"><div class="grow"><div>${esc(v.name)}</div><small>${label[v.mode]}${v.section && (v.section.y.on || v.section.x.on || v.section.z.on) ? ' · secțiune' : ''}</small></div>
      <div class="acts"><button class="mini" data-go="${v.id}">${ico('go')}Vezi</button><button class="mini danger" data-del="${v.id}" aria-label="Șterge">${ico('trash')}</button></div></div>`).join('')}</div>` : '<div class="empty">Salvează unghiuri, secțiuni sau poziții de mers pentru a reveni rapid la ele (ex. la prezentarea către client).</div>'}`;
  body.onclick = async (e) => {
    if (e.target.closest('[data-a=save]')) {
      const fd = await dialog({ title: 'Salvează vederea', body: `<input class="field" name="name" required maxlength="80" value="Vedere ${S.views.length + 1}">` });
      if (!fd) return;
      S.views.push({ id: uid(), name: fd.get('name'), ...captureView() });
      saveViews();
      openPanel('views');
    }
    const g = e.target.closest('[data-go]');
    if (g) restoreView(S.views.find((v) => v.id === g.dataset.go));
    const d = e.target.closest('[data-del]');
    if (d) { S.views = S.views.filter((v) => v.id !== d.dataset.del); saveViews(); openPanel('views'); }
  };
}

function pLayers(body) {
  const counts = {};
  for (const el of S.model.elements) counts[el.category] = (counts[el.category] || 0) + 1;
  const swatch = (k) => { const el = S.model.elements.find((e) => e.category === k); const m = el && (Array.isArray(el.baseMat) ? el.baseMat[0] : el.baseMat); return m ? '#' + m.color.getHexString() : '#ccc'; };
  body.innerHTML = `<input class="field" type="search" id="search" placeholder="Caută element (nume, tip IFC)…" autocomplete="off">
    <div id="results" class="list" style="margin-top:8px"></div>
    <h3>Categorii</h3><div class="list">
    ${Object.keys(CATS).filter((k) => counts[k]).map((k) => `<label class="row"><span class="swatch" style="background:${swatch(k)}"></span><div class="grow"><div>${CATS[k][0]}</div><small>${counts[k]}</small></div>${sw(k, S.cats[k])}</label>`).join('')}
    </div>
    <div class="btns"><button class="btn" data-a="allon">Toate</button><button class="btn" data-a="arch">Doar arhitectură</button>${S.hidden.size ? `<button class="btn" data-a="unhide">Reafișează ascunse (${S.hidden.size})</button>` : ''}</div>`;
  body.onchange = (e) => { const k = e.target.dataset.k; if (k) { S.cats[k] = e.target.checked; updateVisibility(); } };
  const results = $('#results', body);
  $('#search', body).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) { results.innerHTML = ''; return; }
    const found = S.model.elements.filter((el) => (el.name + ' ' + el.ifcType + ' ' + (CATS[el.category][0])).toLowerCase().includes(q)).slice(0, 60);
    results.innerHTML = found.length ? found.map((el) => `<button class="row" data-sel="${el.id}"><div class="grow"><div>${esc(el.name)}</div><small>${esc(el.ifcType)} · ${esc(S.model.storeyById.get(el.storeyId)?.name || '')}</small></div></button>`).join('') : '<div class="empty">Niciun rezultat</div>';
  };
  body.onclick = (e) => {
    const s = e.target.closest('[data-sel]');
    if (s) {
      const el = S.model.byId.get(+s.dataset.sel);
      S.cats[el.category] = true; S.hidden.delete(el.id);
      if (S.storey && S.storey !== el.storeyId) S.storey = null;
      updateVisibility();
      select(el, { zoom: true });
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'allon') { for (const k in S.cats) S.cats[k] = k !== 'space'; updateVisibility(); openPanel('layers'); }
    if (a === 'arch') { for (const k in S.cats) S.cats[k] = !['furniture', 'sanitary', 'mep', 'space', 'site', 'other'].includes(k); updateVisibility(); openPanel('layers'); }
    if (a === 'unhide') { S.hidden.clear(); updateVisibility(); renderHud(); openPanel('layers'); }
  };
}

// ================================================================ Stocare modele (IndexedDB)
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('bim-models', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('meta', { keyPath: 'id' }); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => res(out?.result ?? out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  };
  return {
    list: async () => (await tx(['meta'], 'readonly', (t) => t.objectStore('meta').getAll())).sort((a, b) => b.date - a.date),
    put: (meta, blob) => tx(['meta', 'files'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('files').put(blob, meta.id); }),
    get: (id) => tx(['files'], 'readonly', (t) => t.objectStore('files').get(id)),
    meta: (id) => tx(['meta'], 'readonly', (t) => t.objectStore('meta').get(id)),
    del: (id) => tx(['meta', 'files'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('files').delete(id); }),
  };
})();

// ================================================================ Încărcare fișiere
function progress(p, msg) {
  $('#loading').hidden = p == null;
  if (msg) $('#load-msg').textContent = msg;
  if (p != null) $('#load-bar').style.width = Math.round(p * 100) + '%';
}
async function loadIfcBuffer(buf, name, key) {
  progress(0.01, 'Se pregătește…');
  try {
    const { loadIfc } = await import('./ifc.js');
    const data = await loadIfc(buf, name, (p, m) => progress(p, m));
    progress(0.95, 'Se construiește modelul 3D…');
    await new Promise((r) => setTimeout(r, 20));
    await openModel(data, key);
    toast(`${data.elements.length} elemente încărcate`);
  } catch (e) {
    console.error(e);
    toast('Eroare la deschiderea IFC: ' + e.message, 6000);
    if (!S.model) loadDemo();
  } finally {
    progress(null);
  }
}
async function openFile(file) {
  if (!file) return;
  if (!/\.ifc$/i.test(file.name)) { toast('Alege un fișier .ifc'); return; }
  const id = file.name + ':' + file.size;
  const buf = await file.arrayBuffer();
  try { await idb.put({ id, name: file.name.replace(/\.ifc$/i, ''), size: file.size, date: Date.now() }, new Blob([buf])); } catch (e) { console.warn('Nu s-a putut salva modelul local', e); }
  await loadIfcBuffer(buf, file.name, id);
}
async function loadSaved(id) {
  const blob = await idb.get(id);
  const meta = await idb.meta(id);
  if (!blob) { toast('Modelul nu mai există pe dispozitiv'); return loadDemo(); }
  await loadIfcBuffer(await blob.arrayBuffer(), (meta?.name || 'Model') + '.ifc', id);
}
function loadDemo() { openModel(buildDemo(), 'demo'); }

$('#btn-open').onclick = () => $('#file').click();
$('#file').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
let dragDepth = 0;
addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#drop').hidden = false; e.preventDefault(); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; openFile(e.dataTransfer.files[0]); });

// ================================================================ Pornire
renderToolbar();
renderHud();
resize();
(async () => {
  const url = new URLSearchParams(location.search).get('ifc');
  if (url) {
    try {
      progress(0.01, 'Se descarcă modelul…');
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'model.ifc';
      return await loadIfcBuffer(await res.arrayBuffer(), name, 'url:' + url);
    } catch (e) { progress(null); toast('Modelul nu s-a putut descărca: ' + e.message, 5000); }
  }
  const lastKey = store.get('bim:last', 'demo');
  if (lastKey && lastKey !== 'demo' && !lastKey.startsWith('url:')) {
    const meta = await idb.meta(lastKey).catch(() => null);
    if (meta) return loadSaved(lastKey);
  }
  loadDemo();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
}

// pentru teste și depanare
window.__bim = { S, THREE, camera, planCam, controls, setMode, select, openModel, loadDemo, pickAt, render: () => { dirty = true; } };
