// Clădire demonstrativă (casă P+1 cu acoperiș în două ape), generată procedural.
// Produce același format intern ca importul IFC: etaje + elemente cu geometrie și proprietăți.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  wallExt: 0xe9e4da, wallInt: 0xf4f2ee, slab: 0xc9c5bd, roof: 0xa4533a, glass: [0x9cc8e8, 0.35],
  frame: 0xf7f7f7, door: 0x9a6b43, ground: 0x8fae6b, stair: 0xb8a88e, rail: 0x555b66,
  wood: 0xb38755, fabric: 0x5f7fa6, white: 0xffffff, steel: 0xaab2bd, space: [0x4f8cff, 0.12],
};

export function buildDemo() {
  let nextId = 1;
  const storeys = [
    { id: 's0', name: 'Parter', elevation: 0 },
    { id: 's1', name: 'Etaj 1', elevation: 3 },
    { id: 's2', name: 'Acoperiș', elevation: 6 },
  ];
  const elements = [];

  const add = (o) => {
    const el = { id: nextId++, ...o };
    elements.push(el);
    return el;
  };

  // geometrie: listă de {geo, color} => geometrie unică cu grupuri pe culori
  const box = (cx, cy, cz, sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
  const boxMinMax = (x0, y0, z0, x1, y1, z1) =>
    box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  const part = (geo, color) => ({ geo, color });

  const r2 = (v) => Math.round(v * 100) / 100;

  // ---------------------------------------------------------------- Pereți cu goluri
  // Un perete de la (x0,z0) la (x1,z1), cu goluri {at, w, sill, h, kind:'window'|'door'|'opening', name}
  function wall({ x0, z0, x1, z1, t, base, h, ext, storey, name, openings = [] }) {
    const dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(x0, 0, z0);
    const pieces = [];
    const seg = (u0, u1, y0, y1) => { if (u1 - u0 > 1e-4 && y1 - y0 > 1e-4) pieces.push(box((u0 + u1) / 2, (y0 + y1) / 2, 0, u1 - u0, y1 - y0, t)); };
    const ops = [...openings].sort((a, b) => a.at - b.at);
    let u = 0;
    let openArea = 0;
    for (const o of ops) {
      seg(u, o.at, base, base + h);
      seg(o.at, o.at + o.w, base, base + o.sill);
      seg(o.at, o.at + o.w, base + o.sill + o.h, base + h);
      u = o.at + o.w;
      openArea += o.w * o.h;
    }
    seg(u, L, base, base + h);
    const geo = mergeGeometries(pieces).applyMatrix4(m);
    const color = ext ? C.wallExt : C.wallInt;
    const wallEl = add({
      category: 'wall', ifcType: 'IfcWall', name, storeyId: storey,
      parts: [part(geo, color)],
      props: {
        'Pset_WallCommon': { 'Exterior': ext ? 'Da' : 'Nu', 'Portant': ext ? 'Da' : 'Nu', 'Rezistență la foc': ext ? 'REI 120' : 'EI 30', 'Izolare acustică': ext ? '52 dB' : '42 dB' },
        'Material': ext
          ? { 'Structură': 'Zidărie BCA 25 cm', 'Termoizolație': 'Vată minerală bazaltică 10 cm (în 30 cm total cu tencuieli)', 'Finisaj exterior': 'Tencuială decorativă', 'U [W/m²K]': '0.23' }
          : { 'Structură': 'Gips-carton pe profile metalice', 'Finisaj': 'Vopsea lavabilă albă' },
        'Cantități': { 'Lungime [m]': r2(L), 'Înălțime [m]': r2(h), 'Grosime [m]': r2(t), 'Arie netă [m²]': r2(L * h - openArea), 'Volum net [m³]': r2((L * h - openArea) * t) },
      },
    });
    // tâmplărie în goluri
    for (const o of ops) {
      if (o.kind === 'opening') continue;
      const p = [];
      const fr = 0.06, ft = Math.min(0.08, t * 0.6);
      const y0 = base + o.sill, y1 = y0 + o.h;
      if (o.kind === 'window' || o.glass) {
        // ramă
        p.push(part(box(o.at + o.w / 2, y0 + fr / 2, 0, o.w, fr, ft), C.frame));
        p.push(part(box(o.at + o.w / 2, y1 - fr / 2, 0, o.w, fr, ft), C.frame));
        p.push(part(box(o.at + fr / 2, (y0 + y1) / 2, 0, fr, o.h, ft), C.frame));
        p.push(part(box(o.at + o.w - fr / 2, (y0 + y1) / 2, 0, fr, o.h, ft), C.frame));
        if (o.w > 1.2) p.push(part(box(o.at + o.w / 2, (y0 + y1) / 2, 0, fr, o.h, ft), C.frame));
        p.push(part(box(o.at + o.w / 2, (y0 + y1) / 2, 0, o.w - fr * 2, o.h - fr * 2, 0.024), C.glass));
      } else {
        p.push(part(box(o.at + 0.03, y0 + o.h / 2, 0, 0.06, o.h, t), C.frame));
        p.push(part(box(o.at + o.w - 0.03, y0 + o.h / 2, 0, 0.06, o.h, t), C.frame));
        p.push(part(box(o.at + o.w / 2, y1 - 0.03, 0, o.w, 0.06, t), C.frame));
        p.push(part(box(o.at + o.w / 2, y0 + (o.h - 0.06) / 2, 0, o.w - 0.12, o.h - 0.06, 0.045), o.entrance ? 0x3d4a5c : C.door));
        p.push(part(box(o.at + o.w - 0.16, y0 + 1.0, 0.05, 0.12, 0.025, 0.04), C.steel));
        p.push(part(box(o.at + o.w - 0.16, y0 + 1.0, -0.05, 0.12, 0.025, 0.04), C.steel));
      }
      p.forEach((q) => q.geo.applyMatrix4(m));
      const isWin = o.kind === 'window';
      add({
        category: isWin ? 'window' : 'door', ifcType: isWin ? 'IfcWindow' : 'IfcDoor',
        name: o.name || (isWin ? `Fereastră ${Math.round(o.w * 100)}×${Math.round(o.h * 100)}` : `Ușă ${Math.round(o.w * 100)}×${Math.round(o.h * 100)}`),
        storeyId: storey, parts: p, hostId: wallEl.id,
        props: {
          [isWin ? 'Pset_WindowCommon' : 'Pset_DoorCommon']: isWin
            ? { 'Exterior': 'Da', 'Tip': o.glass && o.sill === 0 ? 'Ușă-fereastră glisantă' : 'Oscilobatantă', 'Material ramă': 'PVC 7 camere, alb', 'Vitraj': 'Tripan Low-E, Ug=0.6', 'Uw [W/m²K]': '0.85' }
            : { 'Exterior': o.entrance ? 'Da' : 'Nu', 'Tip': o.entrance ? 'Ușă de intrare blindată' : 'Ușă interioară batantă', 'Material': o.entrance ? 'Oțel + MDF, gri antracit' : 'Lemn stratificat, furnir stejar', 'Rezistență la foc': o.entrance ? 'EI 30' : '—' },
          'Cantități': { 'Lățime [m]': r2(o.w), 'Înălțime [m]': r2(o.h), 'Parapet [m]': r2(o.sill), 'Arie [m²]': r2(o.w * o.h) },
        },
      });
    }
    return wallEl;
  }

  const W = 12, D = 9, TE = 0.3, TI = 0.15, H = 2.75;
  const win = (at, w = 2, h = 1.4, sill = 0.9, name) => ({ at, w, h, sill, kind: 'window', name });
  const door = (at, w = 0.9, h = 2.1, name) => ({ at, w, h, sill: 0, kind: 'door', name });

  // ---------------------------------------------------------------- Teren
  add({
    category: 'site', ifcType: 'IfcSite', name: 'Teren', storeyId: 's0',
    parts: [part(boxMinMax(-14, -0.45, -12, 26, -0.3, 22), C.ground)],
    props: { 'Date teren': { 'Suprafață teren [m²]': 1200, 'Regim de înălțime': 'P+1', 'POT': '9%', 'CUT': '0.18' } },
  });
  add({
    category: 'slab', ifcType: 'IfcSlab', name: 'Trotuar de gardă', storeyId: 's0',
    parts: [part(mergeGeometries([
      boxMinMax(-1.0, -0.3, -1.0, 13.0, -0.22, -0.15), boxMinMax(-1.0, -0.3, 9.15, 13.0, -0.22, 10.0),
      boxMinMax(-1.0, -0.3, -0.15, -0.15, -0.22, 9.15), boxMinMax(12.15, -0.3, -0.15, 13.0, -0.22, 9.15),
      boxMinMax(-3.5, -0.3, 5.9, -1.0, -0.22, 7.1),
    ]), 0xb9b4ab)],
    props: { 'Material': { 'Tip': 'Pavaj beton 6 cm' } },
  });

  // ---------------------------------------------------------------- Planșee
  const slab = (name, storey, y0, y1, holes = [], typeName = 'Placă beton armat') => {
    // placă dreptunghiulară cu goluri dreptunghiulare (pentru scară)
    const shape = new THREE.Shape();
    const e = TE / 2;
    shape.moveTo(-e, -e); shape.lineTo(W + e, -e); shape.lineTo(W + e, D + e); shape.lineTo(-e, D + e); shape.closePath();
    let holeArea = 0;
    for (const [hx0, hz0, hx1, hz1] of holes) {
      const p = new THREE.Path();
      p.moveTo(hx0, hz0); p.lineTo(hx0, hz1); p.lineTo(hx1, hz1); p.lineTo(hx1, hz0); p.closePath();
      shape.holes.push(p);
      holeArea += (hx1 - hx0) * (hz1 - hz0);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
    // forma e în planul XY => rotim ca Y-ul formei să devină Z
    geo.rotateX(Math.PI / 2).translate(0, y1, 0);
    const area = (W + TE) * (D + TE) - holeArea;
    add({
      category: 'slab', ifcType: 'IfcSlab', name, storeyId: storey,
      parts: [part(geo, C.slab)],
      props: {
        'Pset_SlabCommon': { 'Portant': 'Da', 'Rezistență la foc': 'REI 90', 'Tip': typeName },
        'Material': { 'Beton': 'C25/30', 'Armătură': 'BST500S', 'Pardoseală': storey === 's0' ? 'Gresie porțelanată + șapă 6 cm + EPS 10 cm' : 'Parchet stratificat + șapă 5 cm' },
        'Cantități': { 'Grosime [m]': r2(y1 - y0), 'Arie [m²]': r2(area), 'Volum [m³]': r2(area * (y1 - y0)) },
      },
    });
  };
  const stairHole = [0.3, 7.95, 3.85, 8.85];
  slab('Placă pe sol', 's0', -0.3, 0);
  slab('Planșeu peste parter', 's1', H, 3, [stairHole]);
  slab('Planșeu peste etaj', 's2', 3 + H, 6);

  // ---------------------------------------------------------------- Parter
  const ext = (o) => wall({ t: TE, h: H, ext: true, ...o });
  const int = (o) => wall({ t: TI, h: H, ext: false, ...o });
  ext({ name: 'Perete exterior Sud', storey: 's0', base: 0, x0: 0, z0: 0, x1: W, z1: 0, openings: [win(1.5, 2), win(4.6, 1.5), win(8.5, 2)] });
  ext({ name: 'Perete exterior Est', storey: 's0', base: 0, x0: W, z0: 0, x1: W, z1: D, openings: [win(2, 1.5), win(6.5, 1.5)] });
  ext({ name: 'Perete exterior Nord', storey: 's0', base: 0, x0: W, z0: D, x1: 0, z1: D, openings: [win(1.5, 2), { ...win(6.4, 0.8, 0.6, 1.5), name: 'Fereastră baie' }] });
  ext({
    name: 'Perete exterior Vest', storey: 's0', base: 0, x0: 0, z0: D, x1: 0, z1: 0,
    openings: [{ at: 2, w: 1, h: 2.1, sill: 0, kind: 'door', entrance: true, name: 'Ușă de intrare' }, { at: 5.5, w: 2, h: 2.2, sill: 0, kind: 'window', glass: true, name: 'Ușă-fereastră living' }],
  });
  int({ name: 'Perete interior hol/living', storey: 's0', base: 0, x0: 0, z0: 5.5, x1: W, z1: 5.5, openings: [door(2, 0.9, 2.1, 'Ușă living'), door(8, 0.9, 2.1, 'Ușă birou')] });
  int({ name: 'Perete interior living/bucătărie', storey: 's0', base: 0, x0: 7, z0: 0, x1: 7, z1: 5.5, openings: [{ at: 2, w: 2, h: 2.3, sill: 0, kind: 'opening' }] });
  int({ name: 'Perete interior hol/baie', storey: 's0', base: 0, x0: 4, z0: 5.5, x1: 4, z1: D, openings: [door(0.5, 0.8, 2.1, 'Ușă baie')] });
  int({ name: 'Perete interior baie/birou', storey: 's0', base: 0, x0: 6.5, z0: 5.5, x1: 6.5, z1: D });

  // ---------------------------------------------------------------- Etaj
  ext({ name: 'Perete exterior Sud', storey: 's1', base: 3, x0: 0, z0: 0, x1: W, z1: 0, openings: [win(1.5, 2), win(8.5, 2)] });
  ext({ name: 'Perete exterior Est', storey: 's1', base: 3, x0: W, z0: 0, x1: W, z1: D, openings: [win(2, 1.5), win(6.5, 1.5)] });
  ext({ name: 'Perete exterior Nord', storey: 's1', base: 3, x0: W, z0: D, x1: 0, z1: D, openings: [win(1.5, 1.5), { ...win(4.5, 0.8, 0.6, 1.5), name: 'Fereastră baie' }] });
  ext({ name: 'Perete exterior Vest', storey: 's1', base: 3, x0: 0, z0: D, x1: 0, z1: 0, openings: [win(5.5, 1.5)] });
  int({ name: 'Perete interior hol/dormitoare', storey: 's1', base: 3, x0: 0, z0: 5.5, x1: W, z1: 5.5, openings: [door(2, 0.9, 2.1, 'Ușă dormitor 1'), door(5.1, 0.8, 2.1, 'Ușă dormitor 2'), door(10, 0.8, 2.1, 'Ușă dressing')] });
  int({ name: 'Perete interior dormitoare', storey: 's1', base: 3, x0: 5, z0: 0, x1: 5, z1: 5.5 });
  int({ name: 'Perete interior hol/baie', storey: 's1', base: 3, x0: 6, z0: 5.5, x1: 6, z1: D, openings: [door(1.4, 0.8, 2.1, 'Ușă baie')] });
  int({ name: 'Perete interior baie/dressing', storey: 's1', base: 3, x0: 8.5, z0: 5.5, x1: 8.5, z1: D });

  // ---------------------------------------------------------------- Scară
  {
    const n = 16, rise = 3 / n, going = 0.22, x0 = 0.35, z0 = 7.95, z1 = 8.85;
    const steps = [];
    for (let i = 0; i < n; i++) steps.push(boxMinMax(x0 + i * going, i * rise, z0, x0 + (i + 1) * going, (i + 1) * rise, z1));
    add({
      category: 'stair', ifcType: 'IfcStair', name: 'Scară interioară', storeyId: 's0',
      parts: [part(mergeGeometries(steps), C.stair)],
      props: {
        'Pset_StairCommon': { 'Număr trepte': n, 'Înălțime treaptă [cm]': r2(rise * 100), 'Lățime treaptă [cm]': going * 100, 'Lățime rampă [m]': r2(z1 - z0), 'Formula pasului [cm]': r2(2 * rise * 100 + going * 100) },
        'Material': { 'Structură': 'Beton armat', 'Finisaj': 'Lemn masiv stejar' },
      },
    });
    const rails = [];
    for (let i = 0; i <= 8; i++) rails.push(box(0.27 + i * 0.445, 3.5, 7.92, 0.03, 1.0, 0.03));
    rails.push(box(2.075, 4.0, 7.92, 3.6, 0.05, 0.06));
    for (let i = 0; i <= 2; i++) rails.push(box(0.27, 3.5, 7.95 + i * 0.45, 0.03, 1.0, 0.03));
    rails.push(box(0.27, 4.0, 8.4, 0.06, 0.05, 0.95));
    add({
      category: 'railing', ifcType: 'IfcRailing', name: 'Balustradă gol scară', storeyId: 's1',
      parts: [part(mergeGeometries(rails), C.rail)],
      props: { 'Pset_RailingCommon': { 'Înălțime [m]': 1.0, 'Material': 'Oțel vopsit în câmp electrostatic' } },
    });
  }

  // ---------------------------------------------------------------- Acoperiș
  {
    const slope = 35 * Math.PI / 180, over = 0.5, half = D / 2 + over;
    const rise = half * Math.tan(slope), len = half / Math.cos(slope), th = 0.22;
    const geo = (sign) => {
      const g = new THREE.BoxGeometry(W + over * 2, th, len);
      g.translate(0, th / 2, 0);
      g.rotateX(-sign * slope);
      g.translate(W / 2, 6 + rise / 2 - 0.2, D / 2 - sign * half / 2);
      return g;
    };
    const roofProps = {
      'Pset_RoofCommon': { 'Tip': 'Acoperiș în două ape', 'Pantă': '35°', 'Învelitoare': 'Țiglă ceramică, culoare roșu natur' },
      'Material': { 'Structură': 'Șarpantă lemn ecarisat C24', 'Termoizolație': 'Vată minerală 25 cm', 'U [W/m²K]': '0.15' },
      'Cantități': { 'Arie [m²]': r2((W + over * 2) * len) },
    };
    add({ category: 'roof', ifcType: 'IfcRoof', name: 'Acoperiș – versant Sud', storeyId: 's2', parts: [part(geo(1), C.roof)], props: roofProps });
    add({ category: 'roof', ifcType: 'IfcRoof', name: 'Acoperiș – versant Nord', storeyId: 's2', parts: [part(geo(-1), C.roof)], props: roofProps });
    // timpane
    for (const [x, nm] of [[TE / 2, 'Timpan Vest'], [W + TE / 2, 'Timpan Est']]) {
      const s = new THREE.Shape();
      s.moveTo(-TE / 2, 0); s.lineTo(D + TE / 2, 0); s.lineTo(D / 2, rise - 0.25); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: TE, bevelEnabled: false });
      g.rotateY(-Math.PI / 2).translate(x, 6, 0);
      add({
        category: 'wall', ifcType: 'IfcWall', name: nm, storeyId: 's2', parts: [part(g, C.wallExt)],
        props: { 'Pset_WallCommon': { 'Exterior': 'Da', 'Portant': 'Nu' }, 'Material': { 'Structură': 'Zidărie BCA 25 cm' } },
      });
    }
  }

  // ---------------------------------------------------------------- Mobilier și obiecte sanitare
  const furn = (name, storey, color, boxes, props = {}, category = 'furniture', ifcType = 'IfcFurniture') =>
    add({ category, ifcType, name, storeyId: storey, parts: [part(mergeGeometries(boxes.map((b) => boxMinMax(...b))), color)], props: { 'Detalii': props } });
  const san = (name, storey, boxes, props) => furn(name, storey, C.white, boxes, props, 'sanitary', 'IfcSanitaryTerminal');
  // living
  furn('Canapea 3 locuri', 's0', C.fabric, [[0.5, 0, 0.6, 2.9, 0.42, 1.5], [0.5, 0.42, 0.6, 0.75, 0.8, 1.5], [0.5, 0.42, 0.6, 2.9, 0.65, 0.8], [0.5, 0.42, 1.3, 2.9, 0.65, 1.5]], { 'Producător': '—', 'Dimensiuni': '240×90 cm' });
  furn('Măsuță cafea', 's0', C.wood, [[1.3, 0.35, 2.0, 2.1, 0.4, 3.0], [1.35, 0, 2.05, 2.05, 0.35, 2.95]]);
  furn('Comodă TV', 's0', 0x3b3f47, [[0.2, 0, 3.0, 0.6, 0.5, 4.8]]);
  // bucătărie
  furn('Corp bucătărie', 's0', 0xdcd6cc, [[7.2, 0, 0.2, 11.8, 0.9, 0.8], [7.2, 1.5, 0.2, 11.8, 2.2, 0.55], [11.2, 0, 0.8, 11.8, 0.9, 2.8]], { 'Blat': 'Cuarț alb', 'Lungime [m]': 6.6 });
  furn('Masă dining', 's0', C.wood, [[8.3, 0.72, 2.7, 10.1, 0.76, 3.7], [8.35, 0, 2.75, 8.45, 0.72, 2.85], [9.95, 0, 2.75, 10.05, 0.72, 2.85], [8.35, 0, 3.55, 8.45, 0.72, 3.65], [9.95, 0, 3.55, 10.05, 0.72, 3.65]], { 'Locuri': 6 });
  // birou
  furn('Birou', 's0', C.wood, [[9.5, 0.72, 8.1, 11.6, 0.76, 8.8], [9.55, 0, 8.15, 9.6, 0.72, 8.75], [11.5, 0, 8.15, 11.55, 0.72, 8.75]]);
  furn('Bibliotecă', 's0', 0xe6e1d8, [[6.7, 0, 6.0, 7.05, 2.2, 8.6]]);
  // baie parter
  san('Vas WC', 's0', [[4.3, 0, 8.3, 4.75, 0.42, 8.85]], { 'Tip': 'Suspendat, cu rezervor încastrat' });
  san('Lavoar', 's0', [[5.6, 0.75, 8.4, 6.25, 0.88, 8.85]], { 'Tip': 'Lavoar pe mobilier 60 cm' });
  san('Cabină duș', 's0', [[5.4, 0, 5.75, 6.35, 0.05, 6.7]], { 'Tip': 'Duș walk-in 90×90' });
  // etaj
  furn('Pat dublu', 's1', 0xe8e2d6, [[1.2, 3, 0.4, 3.0, 3.5, 2.5], [1.2, 3, 0.25, 3.0, 4.0, 0.4]], { 'Dimensiuni': '160×200 cm' });
  furn('Dulap dormitor 1', 's1', 0xe6e1d8, [[3.8, 3, 3.8, 4.85, 5.3, 5.35]]);
  furn('Pat dublu', 's1', 0xe8e2d6, [[8, 3, 0.4, 9.8, 3.5, 2.5], [8, 3, 0.25, 9.8, 4.0, 0.4]], { 'Dimensiuni': '160×200 cm' });
  furn('Birou dormitor 2', 's1', C.wood, [[5.3, 3.72, 4.6, 6.8, 3.76, 5.3]]);
  furn('Rafturi dressing', 's1', 0xe6e1d8, [[8.7, 3, 6.6, 9.3, 5.3, 8.8], [11.4, 3, 5.7, 11.8, 5.3, 8.8]]);
  san('Cadă', 's1', [[6.2, 3, 7.1, 7.9, 3.55, 8.85]], { 'Tip': 'Cadă acrilică 170×75' });
  san('Vas WC', 's1', [[7.4, 3, 5.75, 7.85, 3.42, 6.3]], { 'Tip': 'Suspendat' });
  san('Lavoar dublu', 's1', [[8.0, 3.75, 5.75, 8.4, 3.88, 7.0]], { 'Tip': 'Lavoar dublu 120 cm' });

  // ---------------------------------------------------------------- Spații (camere)
  const finishes = {
    'Living': ['Parchet stejar', 'Vopsea lavabilă', 'Gips-carton'], 'Bucătărie': ['Gresie porțelanată', 'Faianță + vopsea', 'Vopsea lavabilă'],
    'Hol': ['Gresie porțelanată', 'Vopsea lavabilă', 'Vopsea lavabilă'], 'Baie': ['Gresie antiderapantă', 'Faianță h=2.4 m', 'Vopsea anti-mucegai'],
    'Birou': ['Parchet stejar', 'Vopsea lavabilă', 'Vopsea lavabilă'], 'Dormitor': ['Parchet stejar', 'Vopsea lavabilă', 'Vopsea lavabilă'],
    'Dressing': ['Parchet stejar', 'Vopsea lavabilă', 'Vopsea lavabilă'],
  };
  const space = (num, name, storey, x0, z0, x1, z1, base) => {
    const i = TI / 2;
    const ax0 = x0 + (x0 === 0 ? TE / 2 : i), ax1 = x1 - (x1 === W ? TE / 2 : i);
    const az0 = z0 + (z0 === 0 ? TE / 2 : i), az1 = z1 - (z1 === D ? TE / 2 : i);
    const area = (ax1 - ax0) * (az1 - az0);
    const f = finishes[name.replace(/ \d+$/, '')] || finishes.Hol;
    add({
      category: 'space', ifcType: 'IfcSpace', name: `${num} ${name}`, label: name, storeyId: storey,
      parts: [part(boxMinMax(ax0, base + 0.01, az0, ax1, base + H - 0.01, az1), C.space)],
      props: {
        'Pset_SpaceCommon': { 'Număr': num, 'Denumire': name, 'Funcțiune': /Baie|Bucătărie/.test(name) ? 'Spațiu umed' : 'Locuire' },
        'Finisaje': { 'Pardoseală': f[0], 'Pereți': f[1], 'Tavan': f[2] },
        'Cantități': { 'Arie utilă [m²]': r2(area), 'Perimetru [m]': r2(2 * (ax1 - ax0 + az1 - az0)), 'Înălțime liberă [m]': r2(H), 'Volum [m³]': r2(area * H) },
      },
      area: r2(area),
    });
  };
  space('P.01', 'Living', 's0', 0, 0, 7, 5.5, 0);
  space('P.02', 'Bucătărie', 's0', 7, 0, W, 5.5, 0);
  space('P.03', 'Hol', 's0', 0, 5.5, 4, D, 0);
  space('P.04', 'Baie', 's0', 4, 5.5, 6.5, D, 0);
  space('P.05', 'Birou', 's0', 6.5, 5.5, W, D, 0);
  space('E.01', 'Dormitor 1', 's1', 0, 0, 5, 5.5, 3);
  space('E.02', 'Dormitor 2', 's1', 5, 0, W, 5.5, 3);
  space('E.03', 'Hol', 's1', 0, 5.5, 6, D, 3);
  space('E.04', 'Baie', 's1', 6, 5.5, 8.5, D, 3);
  space('E.05', 'Dressing', 's1', 8.5, 5.5, W, D, 3);

  return {
    name: 'Casă P+1 (demo)',
    project: { 'Proiect': 'Locuință unifamilială P+1', 'Amplasament': 'Demo', 'Arie construită [m²]': r2((W + TE) * (D + TE)), 'Arie desfășurată [m²]': r2((W + TE) * (D + TE) * 2), 'Sursă': 'Model demonstrativ generat de aplicație' },
    storeys,
    elements,
  };
}
