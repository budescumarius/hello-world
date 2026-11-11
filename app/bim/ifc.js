// Import IFC (ARCHICAD, Revit, Allplan, Tekla etc.) cu web-ifc (WebAssembly).
// Biblioteca se descarcă doar la primul import și apoi rămâne în cache pentru lucru offline.
import * as THREE from 'three';

const WEB_IFC = 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.68/';
let apiPromise = null;

async function getApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const W = await import(WEB_IFC + 'web-ifc-api.js');
      const api = new W.IfcAPI();
      api.SetWasmPath(WEB_IFC, true);
      await api.Init(undefined, true); // un singur fir: nu necesită izolare cross-origin
      return { W, api };
    })().catch((e) => { apiPromise = null; throw new Error('Biblioteca IFC nu s-a putut încărca (e nevoie de internet la primul import). ' + e.message); });
  }
  return apiPromise;
}

const CATEGORY = [
  [/^IFCWALL/, 'wall'], [/^IFCCURTAINWALL|^IFCPLATE|^IFCMEMBER/, 'curtain'], [/^IFCSLAB/, 'slab'], [/^IFCCOVERING/, 'covering'],
  [/^IFCROOF/, 'roof'], [/^IFCWINDOW/, 'window'], [/^IFCDOOR/, 'door'], [/^IFCCOLUMN/, 'column'], [/^IFCBEAM/, 'beam'],
  [/^IFCSTAIR|^IFCRAMP/, 'stair'], [/^IFCRAILING/, 'railing'], [/^IFCFURNI|^IFCFURNISHING/, 'furniture'],
  [/^IFCSANITARY|^IFCFLOWTERMINAL/, 'sanitary'], [/^IFCSPACE/, 'space'], [/^IFCSITE|^IFCGEOGRAPHIC/, 'site'],
  [/^IFCFOOTING|^IFCPILE/, 'foundation'], [/^IFCDUCT|^IFCPIPE|^IFCFLOW|^IFCCABLE|^IFCDISTRIBUTION|^IFCENERGY/, 'mep'],
  [/^IFCOPENING/, 'opening'],
];
const categoryOf = (t) => (CATEGORY.find(([re]) => re.test(t)) || [0, 'other'])[1];

// IFCWALLSTANDARDCASE -> IfcWallStandardCase
const WORDS = 'BUILDING ELEMENT PROXY STANDARD CASE ELEMENTED WALL SLAB WINDOW DOOR COLUMN BEAM STAIR FLIGHT RAILING ROOF COVERING SPACE SITE FURNISHING FURNITURE MEMBER PLATE CURTAIN OPENING FOOTING PILE RAMP FLOW TERMINAL SEGMENT FITTING SANITARY DISTRIBUTION PART DUCT PIPE CABLE CARRIER LIGHT FIXTURE ENERGY CONVERSION DEVICE CONTROLLER VIRTUAL GEOGRAPHIC TRANSPORT SHADING CHIMNEY SYSTEM STOREY ANNOTATION GRID REINFORCING BAR MESH TENDON DISCRETE ACCESSORY FASTENER MECHANICAL CIVIL CHAMBER ELECTRIC APPLIANCE OUTLET SWITCHING AIR VALVE PUMP TANK FAN BOILER MOVING STORAGE TREATMENT FIRE SUPPRESSION ALARM SENSOR ACTUATOR'.split(' ').sort((a, b) => b.length - a.length);
function PRETTY(t) {
  let s = t.replace(/^IFC/, ''), out = 'Ifc';
  while (s) {
    const w = WORDS.find((x) => s.startsWith(x)) || s;
    out += w[0] + w.slice(1).toLowerCase();
    s = s.slice(w.length);
  }
  return out;
}

const val = (x) => {
  if (x == null) return null;
  if (typeof x !== 'object') return x;
  if ('value' in x) return x.value;
  return null;
};
const txt = (x) => {
  const v = val(x);
  if (v == null || v === '') return null;
  if (typeof v === 'string') return decodeIfc(v);
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  return String(v);
};
// Decodează \X2\...\X0\ (UTF-16) și \X\hh din șirurile IFC (ex. diacritice din ARCHICAD)
function decodeIfc(s) {
  return s
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (m, hex) => hex.match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join(''))
    .replace(/\\X\\([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (m, c) => String.fromCharCode(c.charCodeAt(0) + 128));
}

export async function loadIfc(buffer, fileName, onProgress = () => {}) {
  onProgress(0.02, 'Se încarcă biblioteca IFC…');
  const { W, api } = await getApi();
  onProgress(0.08, 'Se citește fișierul…');
  await new Promise((r) => setTimeout(r, 30));
  const modelID = api.OpenModel(new Uint8Array(buffer), { COORDINATE_TO_ORIGIN: true, CIRCLE_SEGMENTS: 16 });
  if (modelID < 0) throw new Error('Fișierul IFC nu poate fi deschis');

  const line = (id) => { try { return api.GetLine(modelID, id); } catch { return null; } };
  const ids = (type) => { const v = api.GetLineIDsWithType(modelID, type, true); const out = []; for (let i = 0; i < v.size(); i++) out.push(v.get(i)); return out; };

  // ---------------- Etaje și apartenența elementelor
  const storeyIds = ids(W.IFCBUILDINGSTOREY);
  const storeys = storeyIds.map((id, i) => {
    const l = line(id) || {};
    return { id: 's' + id, expressID: id, name: txt(l.LongName) || txt(l.Name) || `Nivel ${i + 1}`, rawElevation: val(l.Elevation) };
  });
  const storeyOf = new Map();
  for (const rid of ids(W.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const r = line(rid);
    const s = val(r?.RelatingStructure);
    if (!storeyIds.includes(s)) continue;
    for (const e of r.RelatedElements || []) storeyOf.set(val(e), 's' + s);
  }
  // agregări: spații în etaje, părți ale scărilor / pereților cortină etc.
  const aggs = ids(W.IFCRELAGGREGATES).map(line).filter(Boolean);
  for (let pass = 0; pass < 4; pass++) {
    for (const r of aggs) {
      const p = val(r.RelatingObject);
      const sid = storeyIds.includes(p) ? 's' + p : storeyOf.get(p);
      if (!sid) continue;
      for (const c of r.RelatedObjects || []) if (!storeyOf.has(val(c))) storeyOf.set(val(c), sid);
    }
  }
  // elemente din goluri (ferestre/uși) -> etajul peretelui gazdă
  const host = new Map();
  try {
    const voids = new Map();
    for (const rid of ids(W.IFCRELVOIDSELEMENT)) { const r = line(rid); voids.set(val(r.RelatedOpeningElement), val(r.RelatingBuildingElement)); }
    for (const rid of ids(W.IFCRELFILLSELEMENT)) { const r = line(rid); const w = voids.get(val(r.RelatingOpeningElement)); if (w) host.set(val(r.RelatedBuildingElement), w); }
  } catch { /* opțional */ }

  // ---------------- Geometrie
  const elements = new Map();
  const typeName = new Map();
  const mat = new THREE.Matrix4();
  onProgress(0.15, 'Se procesează geometria…');
  await new Promise((r) => setTimeout(r, 30));
  const onMesh = (mesh) => {
    const id = mesh.expressID;
    let el = elements.get(id);
    if (!el) {
      const code = api.GetLineType(modelID, id);
      let t = typeName.get(code);
      if (!t) { t = String(api.GetNameFromTypeCode(code) || 'IFCELEMENT').toUpperCase(); typeName.set(code, t); }
      const category = categoryOf(t);
      if (category === 'opening') return;
      const l = line(id) || {};
      el = {
        id, expressID: id, ifcType: PRETTY(t), category,
        name: txt(l.Name) || txt(l.LongName) || PRETTY(t),
        label: category === 'space' ? (txt(l.LongName) || txt(l.Name)) : undefined,
        storeyId: storeyOf.get(id) || storeyOf.get(host.get(id)),
        parts: [],
      };
      elements.set(id, el);
    }
    const geoms = mesh.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const g = api.GetGeometry(modelID, pg.geometryExpressID);
      const v = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const ix = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      if (v.length && ix.length) {
        const n = v.length / 6;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          pos[k * 3] = v[k * 6]; pos[k * 3 + 1] = v[k * 6 + 1]; pos[k * 3 + 2] = v[k * 6 + 2];
          nor[k * 3] = v[k * 6 + 3]; nor[k * 3 + 1] = v[k * 6 + 4]; nor[k * 3 + 2] = v[k * 6 + 5];
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
        geo.applyMatrix4(mat.fromArray(pg.flatTransformation));
        const c = pg.color;
        el.parts.push({ geo, color: new THREE.Color(c.x, c.y, c.z).getHex(THREE.LinearSRGBColorSpace), opacity: c.w });
      }
      g.delete();
    }
  };
  api.StreamAllMeshes(modelID, onMesh);
  // spațiile (camerele) nu sunt incluse implicit
  try {
    if (![...elements.values()].some((e) => e.category === 'space')) {
      const done = new Set(elements.keys());
      api.StreamAllMeshesWithTypes(modelID, [W.IFCSPACE], (mesh) => { if (!done.has(mesh.expressID)) onMesh(mesh); });
    }
  } catch (e) { console.warn('Spațiile nu au putut fi încărcate', e); }
  onProgress(0.9, 'Se pregătește modelul…');

  // ---------------- Informații proiect
  const project = {};
  try {
    const p = line(ids(W.IFCPROJECT)[0]);
    if (p) { project['Proiect'] = txt(p.LongName) || txt(p.Name); if (txt(p.Description)) project['Descriere'] = txt(p.Description); if (txt(p.Phase)) project['Fază'] = txt(p.Phase); }
    const b = line(ids(W.IFCBUILDING)[0]);
    if (b) project['Clădire'] = txt(b.LongName) || txt(b.Name);
    const hdr = api.GetHeaderLine?.(modelID, W.FILE_NAME);
    const app = hdr?.arguments?.[5]?.value || hdr?.arguments?.[4]?.value;
    if (app) project['Aplicație sursă'] = decodeIfc(String(app));
    project['Schemă'] = api.GetModelSchema?.(modelID) || 'IFC';
  } catch { /* informativ */ }
  project['Elemente'] = elements.size;

  // ---------------- Proprietăți la cerere (la selecție)
  const getProps = async (id) => {
    const out = {};
    const l = line(id) || {};
    const gen = {};
    gen['Nume'] = txt(l.Name);
    if (txt(l.LongName)) gen['Nume lung'] = txt(l.LongName);
    if (txt(l.Description)) gen['Descriere'] = txt(l.Description);
    if (txt(l.ObjectType)) gen['Tip obiect'] = txt(l.ObjectType);
    if (txt(l.Tag)) gen['Etichetă (Tag)'] = txt(l.Tag);
    if (txt(l.PredefinedType)) gen['Tip predefinit'] = txt(l.PredefinedType);
    gen['GlobalId'] = txt(l.GlobalId);
    gen['ID'] = id;
    out['IFC'] = gen;
    const add = (set, source) => {
      const name = (txt(set.Name) || 'Set') + (source ? ` (${source})` : '');
      const rows = {};
      for (const ref of set.HasProperties || []) {
        const p = line(val(ref));
        if (!p) continue;
        const k = txt(p.Name);
        let v = p.NominalValue !== undefined ? txt(p.NominalValue)
          : p.EnumerationValues ? (p.EnumerationValues || []).map(txt).join(', ')
            : p.ListValues ? (p.ListValues || []).map(txt).join(', ')
              : p.UpperBoundValue !== undefined ? `${txt(p.LowerBoundValue) ?? ''} – ${txt(p.UpperBoundValue) ?? ''}` : null;
        if (v === true || v === 'T' || v === '.T.') v = 'Da';
        if (v === false || v === 'F' || v === '.F.') v = 'Nu';
        if (k) rows[k] = v ?? '—';
      }
      for (const ref of set.Quantities || []) {
        const q = line(val(ref));
        if (!q) continue;
        const qv = q.LengthValue ?? q.AreaValue ?? q.VolumeValue ?? q.CountValue ?? q.WeightValue ?? q.TimeValue;
        if (txt(q.Name)) rows[txt(q.Name)] = txt(qv) ?? '—';
      }
      if (Object.keys(rows).length) out[name] = rows;
    };
    try {
      for (const s of await api.properties.getPropertySets(modelID, id, false)) add(s);
      for (const s of await api.properties.getPropertySets(modelID, id, false, true)) add(s, 'tip');
    } catch (e) { console.warn(e); }
    try {
      const mats = await api.properties.getMaterialsProperties(modelID, id, true, true);
      const names = [];
      const walk = (m, d = 0) => {
        if (!m || d > 4) return;
        if (Array.isArray(m)) return m.forEach((x) => walk(x, d + 1));
        if (m.Name && (m.type === W.IFCMATERIAL || !m.Material)) names.push(txt(m.Name));
        for (const k of ['Material', 'Materials', 'ForLayerSet', 'MaterialLayers', 'MaterialConstituents', 'MaterialProfiles']) if (m[k]) walk(m[k], d + 1);
      };
      walk(mats);
      const uniq = [...new Set(names.filter(Boolean))];
      if (uniq.length) out['Materiale'] = Object.fromEntries(uniq.map((n, i) => [`Material ${i + 1}`, n]));
    } catch { /* unele modele nu au materiale */ }
    return out;
  };

  return {
    name: fileName.replace(/\.ifc$/i, ''),
    project,
    storeys,
    elements: [...elements.values()].filter((e) => e.parts.length),
    getProps,
    dispose: () => { try { api.CloseModel(modelID); } catch { /* deja închis */ } },
  };
}
