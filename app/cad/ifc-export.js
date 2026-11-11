// Export IFC4 (Reference View): pereți cu goluri, uși, ferestre, plăci, stâlpi, grinzi, acoperișuri,
// spații (camere), materiale, culori, seturi de proprietăți și cantități de bază.
// Fișierul se poate deschide în ARCHICAD, Revit, Allplan, Tekla, BIMcollab, programe de calcul structural etc.
import { MATERIALS, USES, sortedStoreys, storeyOf, byId, wallLength, wallExtensions, polyArea, quantities, norm, sub } from './model.js';
import { elementGeometry } from './geometry3d.js';

const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
const guid = () => { let s = GUID_CHARS[Math.floor(Math.random() * 4)]; for (let i = 0; i < 21; i++) s += GUID_CHARS[Math.floor(Math.random() * 64)]; return s; };
// șiruri IFC: caracterele non-ASCII se codifică \X2\hhhh\X0\
const str = (s) => {
  if (s == null || s === '') return '$';
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else out += '\\X2\\' + c.toString(16).toUpperCase().padStart(4, '0') + '\\X0\\';
  }
  return `'${out}'`;
};
const num = (v) => { const r = Math.round(v * 1e6) / 1e6; return Number.isInteger(r) ? r.toFixed(1) : String(r); };

export function exportIfc(p) {
  const L = [];
  let n = 0;
  const e = (s) => { n++; L.push(`#${n}=${s};`); return `#${n}`; };
  const pt = (x, y, z) => e(z === undefined ? `IFCCARTESIANPOINT((${num(x)},${num(y)}))` : `IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const dir = (x, y, z) => e(z === undefined ? `IFCDIRECTION((${num(x)},${num(y)}))` : `IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  const Z = dir(0, 0, 1), X = dir(1, 0, 0);
  const place3 = (x, y, z, ref) => e(`IFCAXIS2PLACEMENT3D(${pt(x, y, z)},${Z},${ref || X})`);
  const local = (rel, x, y, z, ref) => e(`IFCLOCALPLACEMENT(${rel || '$'},${place3(x, y, z, ref)})`);

  const owner = '$';
  const wcs = place3(0, 0, 0);
  const ctx = e(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${wcs},$)`);
  const body = e(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = e(`IFCUNITASSIGNMENT((${e('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')},${e('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)')},${e('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)')},${e('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')}))`);
  const project = e(`IFCPROJECT('${guid()}',${owner},${str(p.name)},$,$,$,$,(${ctx}),${units})`);
  const sitePl = local(null, 0, 0, 0);
  const site = e(`IFCSITE('${guid()}',${owner},'Teren',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldPl = local(sitePl, 0, 0, 0);
  const bld = e(`IFCBUILDING('${guid()}',${owner},${str(p.name)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${project},(${site}))`);
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${site},(${bld}))`);

  // culori pe material
  const styles = new Map();
  const style = (hex, alpha = 0) => {
    const k = hex + ':' + alpha;
    if (!styles.has(k)) {
      const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
      const col = e(`IFCCOLOURRGB($,${num(r)},${num(g)},${num(b)})`);
      const rend = e(`IFCSURFACESTYLERENDERING(${col},${num(alpha)},$,$,$,$,$,$,.NOTDEFINED.)`);
      styles.set(k, e(`IFCSURFACESTYLE($,.BOTH.,(${rend}))`));
    }
    return styles.get(k);
  };
  const shape = (items, kind = 'SweptSolid', color, alpha) => {
    if (color != null) for (const it of items) e(`IFCSTYLEDITEM(${it},(${style(color, alpha)}),$)`);
    const rep = e(`IFCSHAPEREPRESENTATION(${body},'Body','${kind}',(${items.join(',')}))`);
    return e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  const rectSolid = (cx, cy, xd, yd, h, z0 = 0) => {
    const prof = e(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${e(`IFCAXIS2PLACEMENT2D(${pt(cx, cy)},$)`)},${num(xd)},${num(yd)})`);
    return e(`IFCEXTRUDEDAREASOLID(${prof},${place3(0, 0, z0)},${Z},${num(h)})`);
  };
  const polySolid = (pts, h) => {
    const ps = pts.map((q) => pt(q[0], q[1]));
    const line = e(`IFCPOLYLINE((${ps.join(',')},${ps[0]}))`);
    const prof = e(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${line})`);
    return e(`IFCEXTRUDEDAREASOLID(${prof},${place3(0, 0, 0)},${Z},${num(h)})`);
  };
  const brep = (geo) => {
    // din coordonate three.js (x, sus, -y) înapoi în coordonate IFC (x, y, z)
    const pos = geo.attributes.position, idx = geo.index;
    const P = [];
    const id = (i) => (P[i] ||= pt(pos.getX(i), -pos.getZ(i), pos.getY(i)));
    const faces = [];
    const tri = idx ? idx.count : pos.count;
    for (let t = 0; t < tri; t += 3) {
      const [a, b, c] = idx ? [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)] : [t, t + 1, t + 2];
      faces.push(e(`IFCFACE((${e(`IFCFACEOUTERBOUND(${e(`IFCPOLYLOOP((${id(a)},${id(b)},${id(c)}))`)},.T.)`)}))`));
    }
    return e(`IFCFACETEDBREP(${e(`IFCCLOSEDSHELL((${faces.join(',')}))`)})`);
  };
  const props = (el, name, values) => {
    const ps = Object.entries(values).filter(([, v]) => v != null).map(([k, v]) => {
      const val = typeof v === 'boolean' ? `IFCBOOLEAN(.${v ? 'T' : 'F'}.)` : typeof v === 'number' ? `IFCREAL(${num(v)})` : `IFCLABEL(${str(v)})`;
      return e(`IFCPROPERTYSINGLEVALUE(${str(k)},$,${val},$)`);
    });
    if (!ps.length) return;
    const set = e(`IFCPROPERTYSET('${guid()}',${owner},${str(name)},$,(${ps.join(',')}))`);
    e(`IFCRELDEFINESBYPROPERTIES('${guid()}',${owner},$,$,(${el}),${set})`);
  };
  const qto = (el, name, values) => {
    const qs = Object.entries(values).map(([k, [kind, v]]) => e(`IFCQUANTITY${kind.toUpperCase()}(${str(k)},$,$,${num(v)},$)`));
    const set = e(`IFCELEMENTQUANTITY('${guid()}',${owner},${str(name)},$,$,(${qs.join(',')}))`);
    e(`IFCRELDEFINESBYPROPERTIES('${guid()}',${owner},$,$,(${el}),${set})`);
  };
  const matUse = new Map();
  const useMat = (key, el) => { if (!key || !MATERIALS[key]) return; if (!matUse.has(key)) matUse.set(key, []); matUse.get(key).push(el); };

  const storeyIfc = new Map();
  const contained = new Map();
  const spaces = new Map();
  for (const s of sortedStoreys(p)) {
    const pl = local(bldPl, 0, 0, s.elev);
    const st = e(`IFCBUILDINGSTOREY('${guid()}',${owner},${str(s.name)},$,$,${pl},$,$,.ELEMENT.,${num(s.elev)})`);
    storeyIfc.set(s.id, { st, pl, s });
    contained.set(s.id, []);
    spaces.set(s.id, []);
  }
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${bld},(${[...storeyIfc.values()].map((x) => x.st).join(',')}))`);

  const wallIfc = new Map();
  for (const el of p.elements) {
    const S = storeyIfc.get(el.storey) || storeyIfc.get(storeyOf(p, el).id);
    if (!S) continue;
    const m = MATERIALS[el.material];
    const q = quantities(p, el);
    if (el.type === 'wall') {
      const Lw = wallLength(el), d = norm(sub(el.b, el.a));
      const [e0, e1] = wallExtensions(p, el);
      const pl = local(S.pl, el.a[0], el.a[1], el.base || 0, dir(d[0], d[1], 0));
      const solid = rectSolid((Lw + e1 - e0) / 2, 0, Lw + e0 + e1, el.thickness, el.height);
      const w = e(`IFCWALL('${guid()}',${owner},${str((el.exterior ? 'Perete exterior ' : 'Perete interior ') + el.id.toUpperCase())},$,$,${pl},${shape([solid], 'SweptSolid', m?.c3)},$,.${el.bearing ? 'SOLIDWALL' : 'PARTITIONING'}.)`);
      wallIfc.set(el.id, { w, pl, el });
      contained.get(S.s.id).push(w);
      props(w, 'Pset_WallCommon', { IsExternal: !!el.exterior, LoadBearing: !!el.bearing });
      qto(w, 'Qto_WallBaseQuantities', { Length: ['length', Lw], Height: ['length', el.height], Width: ['length', el.thickness], NetSideArea: ['area', q['Arie netă (m²)']], NetVolume: ['volume', q['Volum (m³)']] });
      useMat(el.material, w);
    } else if (el.type === 'slab') {
      const pl = local(S.pl, 0, 0, (el.offset || 0) - el.thickness);
      const s = e(`IFCSLAB('${guid()}',${owner},${str('Placă ' + el.id.toUpperCase())},$,$,${pl},${shape([polySolid(el.pts, el.thickness)], 'SweptSolid', m?.c3)},$,.${el.use === 'sol' ? 'BASESLAB' : 'FLOOR'}.)`);
      contained.get(S.s.id).push(s);
      props(s, 'Pset_SlabCommon', { LoadBearing: true, IsExternal: el.use === 'A_bal' || el.use === 'H' || el.use === 'I' });
      props(s, 'Încărcări', { 'Categorie de folosință': USES[el.use]?.name, 'Încărcare utilă qk (kN/m²)': USES[el.use]?.q, 'Straturi permanente (kN/m²)': el.finishes || 0 });
      qto(s, 'Qto_SlabBaseQuantities', { Width: ['length', el.thickness], GrossArea: ['area', Math.abs(polyArea(el.pts))], NetVolume: ['volume', q['Volum (m³)']] });
      useMat(el.material, s);
    } else if (el.type === 'column') {
      const pl = local(S.pl, el.p[0], el.p[1], 0);
      const c = e(`IFCCOLUMN('${guid()}',${owner},${str('Stâlp ' + el.id.toUpperCase())},$,$,${pl},${shape([rectSolid(0, 0, el.w, el.d, el.height)], 'SweptSolid', m?.c3)},$,.COLUMN.)`);
      contained.get(S.s.id).push(c);
      props(c, 'Pset_ColumnCommon', { LoadBearing: true });
      useMat(el.material, c);
    } else if (el.type === 'beam') {
      const Lb = Math.hypot(el.b[0] - el.a[0], el.b[1] - el.a[1]), d = norm(sub(el.b, el.a));
      const pl = local(S.pl, el.a[0], el.a[1], S.s.height - el.h, dir(d[0], d[1], 0));
      const b = e(`IFCBEAM('${guid()}',${owner},${str('Grindă ' + el.id.toUpperCase())},$,$,${pl},${shape([rectSolid(Lb / 2, 0, Lb, el.w, el.h)], 'SweptSolid', m?.c3)},$,.BEAM.)`);
      contained.get(S.s.id).push(b);
      props(b, 'Pset_BeamCommon', { LoadBearing: true, Span: Lb });
      useMat(el.material, b);
    } else if (el.type === 'roof') {
      const pl = local(S.pl, 0, 0, 0);
      let rep;
      if (el.kind === 'flat') {
        const pl2 = local(S.pl, 0, 0, el.offset ?? S.s.height);
        rep = shape([polySolid(el.pts, el.thickness)], 'SweptSolid', MATERIALS.beton.c3);
        const r = e(`IFCROOF('${guid()}',${owner},${str('Acoperiș terasă ' + el.id.toUpperCase())},$,$,${pl2},${rep},$,.FLAT_ROOF.)`);
        contained.get(S.s.id).push(r);
        continue;
      }
      const parts = elementGeometry(p, el);
      const items = parts.map((part) => {
        // geometria three.js e în coordonate absolute; o mutăm relativ la nivel
        const g = part.geo.clone().translate(0, -S.s.elev, 0);
        return brep(g);
      });
      for (let i = 0; i < items.length; i++) e(`IFCSTYLEDITEM(${items[i]},(${style(parts[i].color)}),$)`);
      rep = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${e(`IFCSHAPEREPRESENTATION(${body},'Body','Brep',(${items.join(',')}))`)}))`);
      const r = e(`IFCROOF('${guid()}',${owner},${str('Acoperiș ' + el.id.toUpperCase())},$,$,${pl},${rep},$,.${el.kind === 'gable' ? 'GABLE_ROOF' : 'SHED_ROOF'}.)`);
      contained.get(S.s.id).push(r);
      props(r, 'Pset_RoofCommon', { Pantă: el.slope + '°' });
      useMat(el.material, r);
    } else if (el.type === 'zone') {
      const h = Math.min(2.6, S.s.height - 0.2);
      const pl = local(S.pl, 0, 0, 0);
      const sp = e(`IFCSPACE('${guid()}',${owner},${str(el.number || el.id)},$,$,${pl},${shape([polySolid(el.pts, h)], 'SweptSolid', 0xffc44d, 0.8)},${str(el.name)},.ELEMENT.,.INTERNAL.,$)`);
      spaces.get(S.s.id).push(sp);
      qto(sp, 'Qto_SpaceBaseQuantities', { NetFloorArea: ['area', Math.abs(polyArea(el.pts))], Height: ['length', h] });
    }
  }
  // goluri + uși/ferestre
  for (const el of p.elements) {
    if (el.type !== 'door' && el.type !== 'window') continue;
    const W = wallIfc.get(el.wall);
    if (!W) continue;
    const host = W.el, t = host.thickness;
    const h = Math.min(el.height, host.height - el.sill);
    const opPl = local(W.pl, el.pos, 0, el.sill);
    const op = e(`IFCOPENINGELEMENT('${guid()}',${owner},'Gol',$,$,${opPl},${shape([rectSolid(0, 0, el.width, t + 0.1, h)])},$,.OPENING.)`);
    e(`IFCRELVOIDSELEMENT('${guid()}',${owner},$,$,${W.w},${op})`);
    const fillPl = local(opPl, 0, 0, 0);
    const isWin = el.type === 'window';
    const geo = shape([rectSolid(0, 0, el.width, isWin ? 0.07 : 0.05, h)], 'SweptSolid', isWin ? 0x9cc8e8 : 0x9a6b43, isWin ? 0.55 : 0);
    const f = isWin
      ? e(`IFCWINDOW('${guid()}',${owner},${str(el.name || 'Fereastră')},$,$,${fillPl},${geo},$,${num(h)},${num(el.width)},.WINDOW.,.SINGLE_PANEL.,$)`)
      : e(`IFCDOOR('${guid()}',${owner},${str(el.name || 'Ușă')},$,$,${fillPl},${geo},$,${num(h)},${num(el.width)},.DOOR.,.SINGLE_SWING_LEFT.,$)`);
    e(`IFCRELFILLSELEMENT('${guid()}',${owner},$,$,${op},${f})`);
    const st = storeyOf(p, host).id;
    contained.get(st).push(f);
    props(f, isWin ? 'Pset_WindowCommon' : 'Pset_DoorCommon', { IsExternal: !!host.exterior });
  }
  for (const [sid, list] of contained) if (list.length) e(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',${owner},$,$,(${list.join(',')}),${storeyIfc.get(sid).st})`);
  for (const [sid, list] of spaces) if (list.length) e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${storeyIfc.get(sid).st},(${list.join(',')}))`);
  for (const [key, list] of matUse) {
    const mat = e(`IFCMATERIAL(${str(MATERIALS[key].name)},$,$)`);
    e(`IFCRELASSOCIATESMATERIAL('${guid()}',${owner},$,$,(${list.join(',')}),${mat})`);
  }
  void byId;

  const now = new Date().toISOString().slice(0, 19);
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME(${str(p.name + '.ifc')},'${now}',(''),(''),'Santier Proiectare','Santier Proiectare','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${L.join('\n')}
ENDSEC;
END-ISO-10303-21;
`;
}
