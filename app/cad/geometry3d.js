// Geometria 3D a elementelor (folosită atât de vederea 3D cât și de exportul IFC).
// Sistemul three.js: x = x plan, y = cotă (sus), z = -y plan.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATERIALS, byId, storeyOf, wallPieces, wallLength, norm, sub, bbox } from './model.js';

const toIndexed = (g) => { if (!g.index) { const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); } for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
const merge = (list) => (list.length === 1 ? toIndexed(list[0]) : mergeGeometries(list.map(toIndexed)));

// cutie în coordonatele locale ale unui element liniar (u de-a lungul axei, v transversal, z vertical)
function localBox(u0, u1, v0, v1, z0, z1) {
  return new THREE.BoxGeometry(u1 - u0, z1 - z0, v1 - v0).translate((u0 + u1) / 2, (z0 + z1) / 2, (v0 + v1) / 2);
}
// matricea care duce sistemul local (u, z, v) al segmentului a→b la cota z0 în sistemul three.js
function lineMatrix(a, b, z0) {
  const d = norm(sub(b, a));
  const ang = Math.atan2(d[1], d[0]); // în plan, CCW de la x
  // u -> (dx, 0, -dy); v (local z) -> perpendicular în plan
  return new THREE.Matrix4().makeRotationY(ang).setPosition(a[0], z0, -a[1]);
}

// Extrudarea unui poligon din plan între două cote
function prism(pts, z0, z1) {
  const shape = new THREE.Shape(pts.map((q) => new THREE.Vector2(q[0], q[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  // forma e în XY (plan), extrudată pe +Z: rotim ca Y-ul planului să devină -Z și Z-ul extrudării să devină +Y
  g.rotateX(-Math.PI / 2).translate(0, z0, 0);
  return g;
}

// Acoperiș: plat (prismă) sau în două ape / o apă pe dreptunghiul de încadrare
function roofGeometry(e, base) {
  if (e.kind === 'flat') return [{ geo: prism(e.pts, base, base + e.thickness), color: MATERIALS.beton.c3 }];
  const b = bbox(e.pts);
  const tan = Math.tan(e.slope * Math.PI / 180);
  const alongX = e.axis === 'x';
  const span = alongX ? b.y1 - b.y0 : b.x1 - b.x0, length = alongX ? b.x1 - b.x0 : b.y1 - b.y0;
  const out = [];
  const color = MATERIALS[e.material]?.c3 || 0xa65a42;
  const plane = (w) => {
    // placă înclinată de lățime w (pe orizontală), ridicată de la streașină spre coamă
    const slopeLen = w / Math.cos(e.slope * Math.PI / 180);
    const g = new THREE.BoxGeometry(length, e.thickness, slopeLen).translate(0, e.thickness / 2, -slopeLen / 2);
    g.rotateX(Math.atan(tan));
    return g;
  };
  if (e.kind === 'gable') {
    const half = span / 2;
    const rise = half * tan;
    for (const side of [1, -1]) {
      const g = plane(half);
      // poziționare: streașina la marginea dreptunghiului, coama la mijloc
      if (side === -1) g.rotateY(Math.PI);
      if (alongX) g.translate((b.x0 + b.x1) / 2, base, side === 1 ? -b.y0 : -b.y1);
      else { g.rotateY(-Math.PI / 2); g.translate(side === 1 ? b.x0 : b.x1, base, -(b.y0 + b.y1) / 2); }
      out.push({ geo: g, color });
    }
    // timpane (triunghiuri verticale la capete)
    for (const end of [0, 1]) {
      const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(span, 0), new THREE.Vector2(span / 2, Math.max(0, rise - e.thickness / Math.cos(e.slope * Math.PI / 180) * 0.2))]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false });
      const inset = Math.min(0.5, length * 0.06);
      if (alongX) { g.rotateY(Math.PI / 2); g.translate(end ? b.x1 - inset - 0.25 : b.x0 + inset, base, -b.y0); } else { g.translate(b.x0, base, -(end ? b.y1 - inset : b.y0 + inset + 0.25)); }
      out.push({ geo: g, color: 0xece6da });
    }
  } else {
    const g = plane(span);
    if (alongX) g.translate((b.x0 + b.x1) / 2, base, -b.y0);
    else { g.rotateY(-Math.PI / 2); g.translate(b.x0, base, -(b.y0 + b.y1) / 2); }
    out.push({ geo: g, color });
  }
  return out;
}

// Returnează pentru fiecare element o listă de { geo, color, opacity } în coordonate three.js
export function elementGeometry(p, e) {
  const s = storeyOf(p, e);
  const z = s.elev;
  const mat = MATERIALS[e.material];
  switch (e.type) {
    case 'wall': {
      const pieces = wallPieces(p, e).map(([u0, u1, z0, z1]) => localBox(u0, u1, -e.thickness / 2, e.thickness / 2, z0, z1));
      if (!pieces.length) return [];
      const g = merge(pieces).applyMatrix4(lineMatrix(e.a, e.b, z + (e.base || 0)));
      return [{ geo: g, color: mat?.c3 || 0xdddddd }];
    }
    case 'door': case 'window': {
      const w = byId(p, e.wall);
      if (!w) return [];
      const ws = storeyOf(p, w);
      const m = lineMatrix(w.a, w.b, ws.elev + (w.base || 0));
      const u0 = e.pos - e.width / 2, u1 = e.pos + e.width / 2, z0 = e.sill, z1 = Math.min(w.height, e.sill + e.height);
      const f = 0.06, t = Math.min(0.07, w.thickness * 0.5);
      const frame = [localBox(u0, u0 + f, -t / 2, t / 2, z0, z1), localBox(u1 - f, u1, -t / 2, t / 2, z0, z1), localBox(u0, u1, -t / 2, t / 2, z1 - f, z1)];
      if (e.type === 'window') frame.push(localBox(u0, u1, -t / 2, t / 2, z0, z0 + f));
      const out = [{ geo: merge(frame).applyMatrix4(m), color: 0xf5f5f5 }];
      if (e.type === 'window') out.push({ geo: localBox(u0 + f, u1 - f, -0.012, 0.012, z0 + f, z1 - f).applyMatrix4(m), color: 0x9cc8e8, opacity: 0.4 });
      else out.push({ geo: localBox(u0 + f, u1 - f, -0.02, 0.02, z0, z1 - f).applyMatrix4(m), color: 0x9a6b43 });
      void wallLength;
      return out;
    }
    case 'slab': {
      const top = z + (e.offset || 0);
      return [{ geo: prism(e.pts, top - e.thickness, top), color: mat?.c3 || 0xcccccc }];
    }
    case 'column': {
      const h = e.height;
      const g = new THREE.BoxGeometry(e.w, h, e.d).translate(e.p[0], z + h / 2, -e.p[1]);
      return [{ geo: g, color: mat?.c3 || 0xbbbbbb }];
    }
    case 'beam': {
      const top = z + s.height;
      const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const g = localBox(0, L, -e.w / 2, e.w / 2, top - e.h, top).applyMatrix4(lineMatrix(e.a, e.b, 0));
      return [{ geo: g, color: mat?.c3 || 0xbbbbbb }];
    }
    case 'roof': return roofGeometry(e, z + (e.offset ?? s.height));
    case 'zone': {
      const g = prism(e.pts, z + 0.01, z + Math.min(2.6, s.height - 0.2));
      return [{ geo: g, color: 0xffc44d, opacity: 0.18 }];
    }
    default: return [];
  }
}
