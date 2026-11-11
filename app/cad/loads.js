// Coborârea încărcărilor (calcul orientativ de predimensionare) după principiile SR EN 1990 / SR EN 1991:
//  - încărcări permanente G: greutatea proprie din geometrie + straturi (finisaje, învelitoare);
//  - încărcări variabile Q: utile pe categorii de folosință (EN 1991-1-1), pereți despărțitori mobili, zăpadă (EN 1991-1-3);
//  - ariile aferente ale plăcilor se împart pe reazemul cel mai apropiat (perete portant, grindă sau stâlp);
//  - încărcările coboară nivel cu nivel până la fundații; combinația SLU: γG·G + γQ·Q (6.10), SLS caracteristică: G + Q.
// NU include seismul (P100-1), vântul, excentricitățile, flambajul detaliat sau armarea. Nu înlocuiește proiectul de rezistență.
import { MATERIALS, USES, sortedStoreys, storeyOf, wallLength, openingsOf, projectOnSegment, polyArea, pointInPoly, bbox, dist, sub, norm, dot } from './model.js';

const PARTITION_USES = new Set(['A', 'B', 'C1', 'C3', 'D1']);

export function snowLoad(P, slopeDeg) {
  const a = slopeDeg ?? 0;
  const mu = a <= 30 ? 0.8 : a < 60 ? 0.8 * (60 - a) / 30 : 0;
  return mu * P.Ce * P.Ct * P.sk;
}

export function computeLoads(p) {
  const P = { sk: 2.0, Ce: 1, Ct: 1, partitions: 0.8, sigma: 200, gG: 1.35, gQ: 1.5, ...p.loads };
  const ss = sortedStoreys(p);
  const R = new Map();
  const warn = [];
  const res = (e) => {
    if (!R.has(e.id)) R.set(e.id, { id: e.id, type: e.type, name: label(p, e), storey: storeyOf(p, e).name, G: 0, Q: 0, self: 0, trib: 0, checks: [] });
    return R.get(e.id);
  };
  const els = (s, f) => p.elements.filter((e) => e.storey === s.id && f(e));
  const bearing = (s) => els(s, (e) => (e.type === 'wall' && e.bearing) || e.type === 'column' || e.type === 'beam');
  let ground = { G: 0, Q: 0, area: 0 };

  // împarte un poligon încărcat pe reazemele cele mai apropiate (eșantionare pe grilă)
  function distribute(pts, g, q, supports, src) {
    const A = Math.abs(polyArea(pts));
    if (A < 1e-6) return;
    const b = bbox(pts);
    const h = Math.max(0.1, Math.sqrt(A / 6000));
    const share = new Map();
    let n = 0;
    for (let y = b.y0 + h / 2; y < b.y1; y += h) {
      for (let x = b.x0 + h / 2; x < b.x1; x += h) {
        const pt = [x, y];
        if (!pointInPoly(pt, pts)) continue;
        n++;
        let best = null, bd = Infinity;
        for (const s of supports) {
          const d = s.type === 'column' ? dist(pt, s.p) : projectOnSegment(pt, s.a, s.b).d;
          if (d < bd) { bd = d; best = s; }
        }
        if (best) share.set(best, (share.get(best) || 0) + 1);
      }
    }
    if (!n) return;
    for (const [s, k] of share) {
      const a = A * k / n;
      const r = res(s);
      r.G += a * g; r.Q += a * q; r.trib += a;
    }
    void src;
  }

  for (let i = ss.length - 1; i >= 0; i--) {
    const s = ss[i], below = ss[i - 1];

    // a) acoperișurile acestui nivel
    for (const roof of els(s, (e) => e.type === 'roof')) {
      const r = res(roof);
      const A = Math.abs(polyArea(roof.pts));
      const slope = roof.kind === 'flat' ? 0 : roof.slope;
      const g = (roof.dead || 0) + (roof.kind === 'flat' ? (MATERIALS[roof.material]?.gamma || 0) * roof.thickness : 0);
      const snow = snowLoad(P, slope);
      const q = Math.max(snow, USES.H.q);
      Object.assign(r, { area: A, g, q, snow });
      r.checks.push(`zăpadă s = μ1·Ce·Ct·sk = ${snow.toFixed(2)} kN/m² (pantă ${slope}°)`);
      let sup = [];
      for (let j = i; j >= 0 && !sup.length; j--) sup = bearing(ss[j]);
      if (!sup.length) { warn.push(`${r.name}: nu are reazeme (pereți portanți, grinzi sau stâlpi) dedesubt.`); continue; }
      distribute(roof.pts, g, q, sup, roof);
      r.G = A * g; r.Q = A * q;
    }

    // b) grinzile: greutate proprie + încărcări primite, reacțiuni la capete (simplu rezemate)
    for (const bm of els(s, (e) => e.type === 'beam')) {
      const r = res(bm);
      const L = dist(bm.a, bm.b);
      r.self = (MATERIALS[bm.material]?.gamma || 25) * bm.w * bm.h * L;
      r.G += r.self;
      r.L = L;
      r.qEd = (P.gG * r.G + P.gQ * r.Q) / Math.max(L, 0.01);
      r.MEd = r.qEd * L * L / 8;
      r.VEd = r.qEd * L / 2;
      const kind = MATERIALS[bm.material]?.kind;
      if (kind === 'beton') {
        const hmin = L / 12;
        r.util = hmin / bm.h;
        r.checks.push(`h = ${(bm.h * 100).toFixed(0)} cm; recomandat ≥ L/12 = ${(hmin * 100).toFixed(0)} cm`);
      }
      r.checks.push(`M_Ed ≈ q·L²/8 = ${r.MEd.toFixed(1)} kNm; V_Ed ≈ ${r.VEd.toFixed(1)} kN`);
      const ends = [bm.a, bm.b];
      for (const pt of ends) {
        const sup = els(s, (e) => (e.type === 'wall' && e.bearing) || e.type === 'column')
          .map((e) => ({ e, d: e.type === 'column' ? dist(pt, e.p) : projectOnSegment(pt, e.a, e.b).d - e.thickness / 2 }))
          .filter((x) => x.d < 0.4).sort((a, b) => a.d - b.d)[0];
        if (sup) { const rs = res(sup.e); rs.G += r.G / 2; rs.Q += r.Q / 2; } else warn.push(`${r.name}: capătul (${pt[0].toFixed(2)}; ${pt[1].toFixed(2)}) nu reazemă pe un stâlp sau perete portant.`);
      }
    }

    // c) pereții portanți și stâlpii: greutate proprie, apoi transmitere în jos
    const belowSupports = below ? bearing(below) : [];
    for (const e of els(s, (x) => (x.type === 'wall' && x.bearing) || x.type === 'column')) {
      const r = res(e);
      const m = MATERIALS[e.material];
      r.bearing = true;
      if (e.type === 'wall') {
        const L = wallLength(e);
        const ops = openingsOf(p, e);
        const opA = ops.reduce((a, o) => a + o.width * Math.min(o.height, e.height - o.sill), 0);
        r.self = (m?.gamma || 0) * e.thickness * (L * e.height - opA);
        r.G += r.self;
        r.L = L;
        const Leff = Math.max(0.1, L - ops.reduce((a, o) => a + o.width, 0));
        r.NEd = P.gG * r.G + P.gQ * r.Q;
        r.nEd = r.NEd / L;
        r.nk = (r.G + r.Q) / L;
        const sigma = r.NEd / (e.thickness * Leff) / 1000; // MPa
        r.sigma = sigma;
        if (m && m.fd) {
          const fd = m.kind === 'beton' ? 0.4 * m.fd : 0.75 * m.fd;
          r.util = sigma / fd;
          r.checks.push(`σ = N_Ed/(t·L_plin) = ${sigma.toFixed(2)} MPa; capacitate orientativă ${fd.toFixed(2)} MPa (${m.kind === 'beton' ? '0,4·fcd' : 'Φ=0,75 · fd'})`);
        }
      } else {
        const A = e.w * e.d;
        r.self = (m?.gamma || 25) * A * e.height;
        r.G += r.self;
        r.NEd = P.gG * r.G + P.gQ * r.Q;
        r.nk = r.G + r.Q;
        if (m?.kind === 'beton') {
          const nu = r.NEd / (A * m.fd * 1000);
          r.util = nu / 0.4;
          r.checks.push(`ν = N_Ed/(A·fcd) = ${nu.toFixed(2)}; limită recomandată 0,40 (ductilitate, P100-1)`);
          if (Math.min(e.w, e.d) < 0.25) r.checks.push('Latura minimă recomandată pentru stâlpi de beton armat: 25–30 cm');
        } else if (m?.fd) {
          const sg = r.NEd / A / 1000;
          r.util = sg / (0.6 * m.fd);
          r.checks.push(`σ = ${sg.toFixed(2)} MPa; capacitate orientativă 0,6·fd = ${(0.6 * m.fd).toFixed(1)} MPa (fără flambaj)`);
        }
      }
      // transmitere
      if (!below) {
        r.foundation = true;
        if (e.type === 'wall') {
          const nk = (r.G + r.Q) / wallLength(e) * 1.1; // +10% greutatea fundației
          r.B = Math.max(0.4, nk / P.sigma);
          r.checks.push(`Fundație continuă: B ≥ 1,1·(G+Q)/(L·σ_adm) = ${(r.B * 100).toFixed(0)} cm (σ_adm = ${P.sigma} kPa)`);
        } else {
          const nk = (r.G + r.Q) * 1.1;
          r.B = Math.max(0.6, Math.sqrt(nk / P.sigma));
          r.checks.push(`Fundație izolată: latura ≥ √(1,1·(G+Q)/σ_adm) = ${(r.B * 100).toFixed(0)} cm`);
        }
        continue;
      }
      const targets = [];
      if (e.type === 'wall') {
        const L = wallLength(e), d = norm(sub(e.b, e.a));
        let covered = 0;
        for (const o of belowSupports) {
          if (o.type === 'column') continue;
          const od = norm(sub(o.b, o.a));
          if (Math.abs(Math.abs(dot(d, od)) - 1) > 0.02) continue;
          const off = projectOnSegment(e.a, o.a, o.b);
          const lineDist = Math.abs((e.a[0] - o.a[0]) * od[1] - (e.a[1] - o.a[1]) * od[0]);
          if (lineDist > (e.thickness + (o.thickness || o.w)) / 2 + 0.02) continue;
          void off;
          const t0 = dot(sub(o.a, e.a), d), t1 = dot(sub(o.b, e.a), d);
          const ov = Math.max(0, Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
          if (ov > 0.01) { targets.push([o, ov]); covered += ov; }
        }
        if (covered < 0.95 * L) {
          if (covered < 0.5 * L) warn.push(`${r.name} (${s.name}): nu are perete portant continuu dedesubt (${Math.round(covered / L * 100)}% reazem). Verifică grinda sau peretele de sub el.`);
          const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
          const near = belowSupports.map((o) => ({ o, d: o.type === 'column' ? dist(mid, o.p) : projectOnSegment(mid, o.a, o.b).d })).sort((a, b) => a.d - b.d)[0];
          if (near) targets.push([near.o, Math.max(0.01, L - covered)]);
          else if (!targets.length) warn.push(`${r.name}: încărcările nu au unde coborî – lipsesc elemente portante la ${below.name}.`);
        }
        const tot = targets.reduce((a, t) => a + t[1], 0);
        for (const [o, w] of targets) { const ro = res(o); ro.G += r.G * w / tot; ro.Q += r.Q * w / tot; }
      } else {
        let t = belowSupports.find((o) => o.type === 'column' && dist(o.p, e.p) < 0.3);
        if (!t) t = belowSupports.find((o) => o.type !== 'column' && projectOnSegment(e.p, o.a, o.b).d < (o.thickness || o.w) / 2 + 0.1);
        if (!t) { warn.push(`${r.name} (${s.name}): nu reazemă pe un stâlp, perete sau grindă la ${below.name}.`); continue; }
        const ro = res(t); ro.G += r.G; ro.Q += r.Q;
      }
    }

    // d) plăcile acestui nivel: pe reazemele de la nivelul de dedesubt (sau pe teren)
    for (const sl of els(s, (e) => e.type === 'slab')) {
      const r = res(sl);
      const A = Math.abs(polyArea(sl.pts));
      const m = MATERIALS[sl.material];
      let g = (m?.gamma || 25) * sl.thickness + (sl.finishes || 0);
      // pereții neportanți așezați pe placă: greutatea lor se întinde pe placă
      const light = els(s, (e) => e.type === 'wall' && !e.bearing && pointInPoly([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], sl.pts));
      const wLight = light.reduce((a, w) => a + (MATERIALS[w.material]?.gamma || 0) * w.thickness * w.height * wallLength(w), 0);
      g += wLight / A;
      const qk = USES[sl.use]?.q ?? 1.5;
      const q = qk + (PARTITION_USES.has(sl.use) ? P.partitions : 0);
      Object.assign(r, { area: A, g, q, G: A * g, Q: A * q });
      r.checks.push(`g = ${g.toFixed(2)} kN/m² (placă ${(sl.thickness * 100).toFixed(0)} cm + straturi ${sl.finishes ?? 0}${wLight ? ' + pereți ușori' : ''}); q = ${q.toFixed(2)} kN/m² (${USES[sl.use]?.name || ''}${PARTITION_USES.has(sl.use) ? ' + pereți despărțitori' : ''})`);
      r.pEd = P.gG * g + P.gQ * q;
      const b = bbox(sl.pts), span = Math.min(b.x1 - b.x0, b.y1 - b.y0);
      if (!below || sl.use === 'sol') { ground.G += r.G; ground.Q += r.Q; ground.area += A; r.onGround = true; continue; }
      const sup = bearing(below);
      if (!sup.length) { warn.push(`${r.name} (${s.name}): nu are reazeme la ${below.name}.`); continue; }
      distribute(sl.pts, g, q, sup, sl);
      // grosimea minimă orientativă: lumina cea mai mică / 35 (placă pe două direcții)
      const supWalls = sup.filter((x) => x.type !== 'column');
      let lspan = span;
      if (supWalls.length) {
        // distanța medie dintre reazeme paralele care traversează placa ≈ deschiderea
        const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        const dx = supWalls.filter((w) => Math.abs(w.a[0] - w.b[0]) < 0.05).map((w) => w.a[0]).sort((a1, a2) => a1 - a2);
        const dy = supWalls.filter((w) => Math.abs(w.a[1] - w.b[1]) < 0.05).map((w) => w.a[1]).sort((a1, a2) => a1 - a2);
        const gap = (arr, v) => { let lo = -Infinity, hi = Infinity; for (const x of arr) { if (x <= v) lo = x; else { hi = x; break; } } return hi - lo; };
        lspan = Math.min(gap(dx, c[0]), gap(dy, c[1]), span);
      }
      r.span = lspan;
      const tmin = lspan / 35;
      r.util = tmin / sl.thickness;
      r.checks.push(`grosime ${(sl.thickness * 100).toFixed(0)} cm; recomandat ≥ L/35 = ${(tmin * 100).toFixed(0)} cm (L ≈ ${lspan.toFixed(2)} m)`);
    }
    // pereții neportanți de la cel mai de jos nivel merg direct pe teren
    if (!below) for (const w of els(s, (e) => e.type === 'wall' && !e.bearing)) { const g = (MATERIALS[w.material]?.gamma || 0) * w.thickness * w.height * wallLength(w); ground.G += g; }
  }

  const items = [...R.values()].map((r) => ({ ...r, NEd: r.NEd ?? (P.gG * r.G + P.gQ * r.Q) }));
  const order = { roof: 0, slab: 1, beam: 2, wall: 3, column: 4 };
  items.sort((a, b) => sortedStoreys(p).findIndex((s) => s.name === b.storey) - sortedStoreys(p).findIndex((s) => s.name === a.storey) || order[a.type] - order[b.type]);
  const fnd = items.filter((x) => x.foundation);
  const totalG = fnd.reduce((a, x) => a + x.G, 0) + ground.G, totalQ = fnd.reduce((a, x) => a + x.Q, 0) + ground.Q;
  const over = items.filter((x) => x.util > 1);
  for (const x of over) warn.push(`${x.name} (${x.storey}): grad de utilizare orientativ ${Math.round(x.util * 100)}% – mărește secțiunea sau verifică detaliat.`);
  return {
    params: P, items, warnings: warn,
    summary: { G: totalG, Q: totalQ, NEd: P.gG * totalG + P.gQ * totalQ, ground },
  };
}

function label(p, e) {
  const names = { wall: 'Perete', slab: 'Placă', column: 'Stâlp', beam: 'Grindă', roof: 'Acoperiș' };
  const n = p.elements.filter((x) => x.type === e.type && x.storey === e.storey).indexOf(e) + 1;
  return `${names[e.type] || e.type} ${e.id.toUpperCase()}${e.name ? ' ' + e.name : ''}`.trim() + (n ? '' : '');
}
