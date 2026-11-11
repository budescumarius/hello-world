// Editorul de plan: desen cu mouse-ul, prindere (snap), introducere numerică a lungimilor,
// selecție, mutare, editarea punctelor și detectarea automată a camerelor.
import {
  MATERIALS, USES, addElement, byId, dist, sub, add, mul, norm, perp, dot, len, projectOnSegment, polyArea, polyCentroid,
  pointInPoly, wallOutline, wallLength, openingsOf, sortedStoreys, storeyOf, bbox,
} from './model.js';
import { A, emit, snapshot, deleteElements } from './state.js';

const PAPER = '#ffffff';
const INK = '#1d2433';
const SEL = '#2563eb';
const fmt = (v, d = 2) => Number(v).toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });

export class PlanEditor {
  constructor(canvas, ui) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui; // { status(text), numBox: element, onDblClick }
    this.v = { s: 40, cx: 5, cy: 4 };
    this.mouse = null; // poziția brută (m)
    this.snap = null; // { p, kind }
    this.draw = null; // desenul în curs: { pts: [], ... }
    this.drag = null;
    this.num = '';
    this.gridSnap = true;
    this.dirty = true;
    this.bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    const loop = () => { requestAnimationFrame(loop); if (this.dirty) { this.dirty = false; this.paint(); } };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- transformări
  resize() {
    const r = this.cv.getBoundingClientRect(), k = devicePixelRatio || 1;
    this.cv.width = Math.round(r.width * k); this.cv.height = Math.round(r.height * k);
    this.W = r.width; this.H = r.height; this.k = k;
    this.dirty = true;
  }
  toScreen(p) { return [(p[0] - this.v.cx) * this.v.s + this.W / 2, this.H / 2 - (p[1] - this.v.cy) * this.v.s]; }
  toWorld(x, y) { return [(x - this.W / 2) / this.v.s + this.v.cx, (this.H / 2 - y) / this.v.s + this.v.cy]; }
  invalidate() { this.dirty = true; }
  fit() {
    const els = A.p.elements.filter((e) => e.storey === A.storey);
    const pts = els.flatMap((e) => e.pts || [e.a, e.b, e.p].filter(Boolean));
    if (!pts.length) { this.v = { s: Math.max(8, Math.min(this.W || 600, this.H || 600) / 14), cx: 5, cy: 4 }; return this.invalidate(); }
    const b = bbox(pts);
    this.v.cx = (b.x0 + b.x1) / 2; this.v.cy = (b.y0 + b.y1) / 2;
    this.v.s = Math.min(this.W / Math.max(1, b.x1 - b.x0 + 4), this.H / Math.max(1, b.y1 - b.y0 + 4));
    this.invalidate();
  }
  gridStep() { const raw = 14 / this.v.s; for (const g of [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]) if (g >= raw) return g; return 10; }

  // ---------------------------------------------------------------- prindere
  storeyEls(id = A.storey) { return A.p.elements.filter((e) => e.storey === id || ((e.type === 'door' || e.type === 'window') && byId(A.p, e.wall)?.storey === id)); }
  snapPoint(raw, from, shift) {
    const tol = (this.touch ? 18 : 10) / this.v.s;
    const els = this.storeyEls();
    const below = this.belowStorey();
    const pool = below ? els.concat(this.storeyEls(below.id).filter((e) => e.type === 'wall' || e.type === 'column')) : els;
    const ignore = this.drag?.ignore || new Set();
    let best = null;
    const consider = (p, kind, pr) => { const d = dist(p, raw); if (d < tol && (!best || pr < best.pr || (pr === best.pr && d < best.d))) best = { p, kind, pr, d }; };
    for (const e of pool) {
      if (ignore.has(e.id)) continue;
      const pts = e.pts || [e.a, e.b, e.p].filter(Boolean);
      for (const q of pts) consider(q, 'capăt', 0);
      if (e.type === 'wall' || e.type === 'beam') {
        consider(mul(add(e.a, e.b), 0.5), 'mijloc', 1);
        if (e.type === 'wall') {
          // colțurile fețelor peretelui
          for (const q of wallOutline(A.p, e)) consider(q, 'colț', 0);
        }
      }
      if (e.pts) for (let i = 0; i < e.pts.length; i++) consider(mul(add(e.pts[i], e.pts[(i + 1) % e.pts.length]), 0.5), 'mijloc', 1);
    }
    if (best) return best;
    // pe axa sau pe fața unui perete / pe latura unui poligon
    let edge = null;
    const onSeg = (a, b, kind) => { const r = projectOnSegment(raw, a, b); if (r.d < tol && (!edge || r.d < edge.d)) edge = { p: r.q, kind, d: r.d, a, b }; };
    for (const e of pool) {
      if (ignore.has(e.id)) continue;
      if (e.type === 'wall') { const o = wallOutline(A.p, e); onSeg(e.a, e.b, 'pe axă'); onSeg(o[0], o[1], 'pe față'); onSeg(o[2], o[3], 'pe față'); }
      if (e.type === 'beam') onSeg(e.a, e.b, 'pe grindă');
      if (e.pts) for (let i = 0; i < e.pts.length; i++) onSeg(e.pts[i], e.pts[(i + 1) % e.pts.length], 'pe latură');
    }
    // unghiuri: Shift = orizontal/vertical; altfel atrage spre multipli de 15°
    let ang = null;
    if (from) {
      const v = sub(raw, from), L = len(v);
      if (L > 1e-6) {
        const a = Math.atan2(v[1], v[0]);
        const stepA = shift ? Math.PI / 2 : Math.PI / 12;
        const ra = Math.round(a / stepA) * stepA;
        if (shift || Math.abs(ra - a) < 0.05) {
          const dir = [Math.cos(ra), Math.sin(ra)];
          let l = dot(v, dir);
          if (edge) {
            // intersecția razei cu latura atinsă
            const e1 = sub(edge.b, edge.a), den = dir[0] * e1[1] - dir[1] * e1[0];
            if (Math.abs(den) > 1e-9) {
              const w = sub(edge.a, from), t = (w[0] * e1[1] - w[1] * e1[0]) / den;
              const q = add(from, mul(dir, t));
              if (dist(q, raw) < tol * 2) return { p: q, kind: 'unghi + ' + edge.kind };
            }
          }
          if (this.gridSnap) { const g = this.gridStep(); l = Math.round(l / g) * g; }
          ang = { p: add(from, mul(dir, l)), kind: shift ? 'ortogonal' : Math.round(ra * 180 / Math.PI) + '°' };
        }
      }
    }
    if (edge) return edge;
    if (ang) return ang;
    if (this.gridSnap) { const g = this.gridStep(); return { p: [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g], kind: '' }; }
    return { p: raw, kind: '' };
  }
  belowStorey() { const ss = sortedStoreys(A.p); const i = ss.findIndex((s) => s.id === A.storey); return i > 0 ? ss[i - 1] : null; }

  // ---------------------------------------------------------------- selecție
  hit(p) {
    const tol = (this.touch ? 12 : 6) / this.v.s;
    const els = this.storeyEls();
    const ord = (e) => ({ window: 0, door: 0, column: 1, wall: 2, beam: 3, dim: 4, zone: 6, roof: 7, slab: 8 }[e.type] ?? 9);
    const hits = [];
    for (const e of els) {
      let ok = false, edge = false;
      if (e.type === 'wall') ok = pointInPoly(p, wallOutline(A.p, e));
      else if (e.type === 'door' || e.type === 'window') {
        const w = byId(A.p, e.wall);
        if (w) { const r = projectOnSegment(p, w.a, w.b); ok = r.d < w.thickness / 2 + tol && Math.abs(r.along - e.pos) < e.width / 2; }
      } else if (e.type === 'column') ok = Math.abs(p[0] - e.p[0]) < e.w / 2 + tol && Math.abs(p[1] - e.p[1]) < e.d / 2 + tol;
      else if (e.type === 'beam') ok = projectOnSegment(p, e.a, e.b).d < e.w / 2 + tol;
      else if (e.type === 'dim') { const [a, b] = this.dimLine(e); ok = projectOnSegment(p, a, b).d < tol * 1.5; }
      else if (e.pts) {
        for (let i = 0; i < e.pts.length; i++) if (projectOnSegment(p, e.pts[i], e.pts[(i + 1) % e.pts.length]).d < tol) edge = true;
        ok = edge || pointInPoly(p, e.pts);
      }
      if (ok) hits.push({ e, pr: ord(e) - (edge ? 5 : 0) });
    }
    hits.sort((a, b) => a.pr - b.pr);
    return hits[0]?.e || null;
  }
  grips() {
    const out = [];
    if (A.sel.size !== 1) return out;
    const e = byId(A.p, [...A.sel][0]);
    if (!e) return out;
    if (e.a) { out.push({ e, key: 'a' }); out.push({ e, key: 'b' }); }
    if (e.pts) e.pts.forEach((_, i) => out.push({ e, key: i }));
    if (e.type === 'dim') out.push({ e, key: 'off' });
    return out;
  }
  gripPos(g) { if (g.key === 'off') return this.dimLine(g.e)[2]; return typeof g.key === 'number' ? g.e.pts[g.key] : g.e[g.key]; }

  // ---------------------------------------------------------------- evenimente
  bind() {
    const cv = this.cv;
    let pan = null;
    let spaceDown = false;
    addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.target.closest('input,textarea,select')) { spaceDown = true; e.preventDefault(); } });
    addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const before = this.toWorld(x, y);
      this.v.s = Math.max(2, Math.min(2000, this.v.s * Math.exp(-e.deltaY * 0.0015)));
      const after = this.toWorld(x, y);
      this.v.cx += before[0] - after[0]; this.v.cy += before[1] - after[1];
      this.invalidate();
    }, { passive: false });
    // ---- atingere (iPad / telefon): un deget țintește cu un cursor deasupra degetului, două degete = zoom și deplasare
    const touches = new Map();
    let pinch = null, tpan = null;
    const OFFSET = 70;
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const startPinch = () => {
      const [a, b] = [...touches.values()];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s: this.v.s, world: this.toWorld(mx, my) };
    };
    cv.addEventListener('pointerdown', (e) => {
      const [x, y] = local(e);
      this.touch = e.pointerType === 'touch';
      if (e.pointerType === 'touch') {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        touches.set(e.pointerId, [x, y]);
        if (touches.size === 2) {
          // al doilea deget: anulăm acțiunea începută cu primul (fără să plasăm puncte)
          if (this.drag?.kind === 'move' && this.drag.moved) this.up(this.toWorld(x, y), { button: -1 });
          this.drag = null; this.aim = null; tpan = null; this.finger = null; this.snap = null;
          startPinch();
          this.invalidate();
          return;
        }
        if (touches.size > 2) return;
        if (A.tool === 'select') {
          this.down(this.toWorld(x, y), e);
          if (this.drag?.kind === 'box') { this.drag = null; tpan = { x, y, cx: this.v.cx, cy: this.v.cy, moved: false }; }
          return;
        }
        this.aim = true;
        this.finger = [x, y];
        this.move(this.toWorld(x, y - OFFSET), e);
        return;
      }
      cv.focus();
      if (e.button === 1 || (e.button === 0 && spaceDown) || (e.button === 2 && !this.draw)) { pan = { x, y, cx: this.v.cx, cy: this.v.cy, moved: false }; cv.setPointerCapture(e.pointerId); return; }
      if (e.button === 2) { this.finishDraw(); return; }
      if (e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      this.down(this.toWorld(x, y), e);
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = local(e);
      if (e.pointerType === 'touch') {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, [x, y]);
        if (pinch && touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          this.v.s = Math.max(2, Math.min(2000, pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
          const w = this.toWorld(mx, my);
          this.v.cx += pinch.world[0] - w[0]; this.v.cy += pinch.world[1] - w[1];
          this.invalidate();
          return;
        }
        if (tpan) { if (Math.hypot(x - tpan.x, y - tpan.y) > 6) tpan.moved = true; this.v.cx = tpan.cx - (x - tpan.x) / this.v.s; this.v.cy = tpan.cy + (y - tpan.y) / this.v.s; this.invalidate(); return; }
        if (this.aim) { this.finger = [x, y]; this.move(this.toWorld(x, y - OFFSET), e); return; }
        if (this.drag) this.move(this.toWorld(x, y), e);
        return;
      }
      if (pan) { this.v.cx = pan.cx - (x - pan.x) / this.v.s; this.v.cy = pan.cy + (y - pan.y) / this.v.s; pan.moved = true; this.invalidate(); return; }
      this.move(this.toWorld(x, y), e);
    });
    const touchEnd = (e) => {
      const [x, y] = local(e);
      touches.delete(e.pointerId);
      if (pinch) { if (touches.size < 2) pinch = null; if (!touches.size) this.finger = null; return; }
      if (tpan) { if (!tpan.moved) { A.sel.clear(); emit('sel'); } tpan = null; return; }
      if (this.aim) {
        this.aim = null; this.finger = null;
        if (e.type === 'pointerup') this.up(this.toWorld(x, y - OFFSET), { button: 0, shiftKey: false });
        this.snap = null; this.invalidate();
        return;
      }
      if (this.drag) this.up(this.toWorld(x, y), e);
    };
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return touchEnd(e);
      if (pan) { pan = null; return; }
      const [x, y] = local(e);
      this.up(this.toWorld(x, y), e);
    });
    cv.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') touchEnd(e); pan = null; });
    cv.addEventListener('dblclick', () => this.finishDraw(true));
    cv.addEventListener('pointerleave', () => { this.mouse = null; this.invalidate(); });
    cv.tabIndex = 0;
    cv.addEventListener('keydown', (e) => this.key(e));
  }

  key(e) {
    if (e.target.closest('input,textarea,select') && e.target !== this.cv) return;
    const k = e.key;
    if (this.draw && this.draw.pts.length && /^[0-9.,<\-]$/.test(k)) { this.num += k === ',' ? '.' : k; this.showNum(); e.preventDefault(); return; }
    if (this.num && k === 'Backspace') { this.num = this.num.slice(0, -1); this.showNum(); e.preventDefault(); return; }
    if (k === 'Enter') {
      if (this.num) { this.applyNum(); e.preventDefault(); return; }
      this.finishDraw(true); return;
    }
    if (k === 'Escape') { if (this.num) { this.num = ''; this.showNum(); } else if (this.draw) { this.cancelDraw(); } else { A.sel.clear(); emit('sel'); } return; }
    if ((k === 'Delete' || k === 'Backspace') && A.sel.size) { snapshot(); deleteElements([...A.sel]); emit('model'); e.preventDefault(); }
  }
  showNum() {
    const box = this.ui.numBox;
    box.hidden = !this.num;
    box.textContent = 'Lungime' + (this.num.includes('<') ? ' < unghi' : '') + ': ' + this.num + ' m';
    this.invalidate();
  }
  applyNum() {
    const [lStr, aStr] = this.num.split('<');
    const L = parseFloat(lStr);
    this.num = ''; this.showNum();
    if (!(L > 0) || !this.draw?.pts.length) return;
    const from = this.draw.pts[this.draw.pts.length - 1];
    let dir;
    if (aStr !== undefined && aStr !== '') { const a = parseFloat(aStr) * Math.PI / 180; dir = [Math.cos(a), Math.sin(a)]; } else {
      const to = this.snap?.p || this.mouse || add(from, [1, 0]);
      dir = norm(sub(to, from));
      if (!len(sub(to, from))) dir = [1, 0];
    }
    this.place(add(from, mul(dir, L)));
    this.ui.onDraw?.();
  }

  down(p, e) {
    this.mouse = p;
    const t = A.tool;
    if (t === 'select') {
      // apucare de punct (grip)
      for (const g of this.grips()) {
        if (dist(this.gripPos(g), p) < (this.touch ? 16 : 7) / this.v.s) {
          snapshot();
          const e0 = g.e;
          const old = this.gripPos(g).slice();
          // la pereți: capetele altor pereți din același punct se mută împreună
          const linked = [];
          if (e0.type === 'wall' && (g.key === 'a' || g.key === 'b')) {
            for (const o of this.storeyEls()) if (o.type === 'wall' && o !== e0) for (const k of ['a', 'b']) if (dist(o[k], old) < 0.01) linked.push([o, k]);
          }
          this.drag = { kind: 'grip', g, linked, ignore: new Set([e0.id, ...linked.map(([o]) => o.id)]) };
          return;
        }
      }
      const h = this.hit(p);
      if (h) {
        if (e.shiftKey) { if (A.sel.has(h.id)) A.sel.delete(h.id); else A.sel.add(h.id); } else if (!A.sel.has(h.id)) { A.sel.clear(); A.sel.add(h.id); }
        emit('sel');
        const snap0 = this.snapPoint(p);
        this.drag = { kind: 'move', start: snap0.p, raw0: p, ids: [...A.sel], orig: JSON.stringify(A.p.elements), moved: false, ignore: new Set(A.sel) };
      } else {
        if (!e.shiftKey) { A.sel.clear(); emit('sel'); }
        this.drag = { kind: 'box', a: p, b: p };
      }
      return;
    }
  }
  move(p, e) {
    this.mouse = p;
    const d = this.drag;
    if (d?.kind === 'box') { d.b = p; this.invalidate(); return; }
    if (d?.kind === 'grip') {
      const s = this.snapPoint(p, d.g.key === 'off' ? null : this.gripAnchor(d.g), e.shiftKey);
      this.snap = s;
      const g = d.g;
      if (g.key === 'off') {
        const dir = norm(sub(g.e.b, g.e.a));
        g.e.offset = dot(sub(s.p, g.e.a), perp(dir));
      } else if (typeof g.key === 'number') g.e.pts[g.key] = s.p.slice();
      else { g.e[g.key] = s.p.slice(); for (const [o, k] of d.linked) o[k] = s.p.slice(); }
      emit('model');
      return;
    }
    if (d?.kind === 'move') {
      if (!d.moved && dist(p, d.raw0) < 4 / this.v.s) return;
      if (!d.moved) { snapshot(); d.moved = true; }
      const s = this.snapPoint(p, d.start, e.shiftKey);
      this.snap = s;
      const delta = sub(s.p, d.start);
      const orig = new Map(JSON.parse(d.orig).map((x) => [x.id, x]));
      for (const id of d.ids) {
        const el = byId(A.p, id), o = orig.get(id);
        if (!el || !o) continue;
        if (el.type === 'door' || el.type === 'window') {
          if (d.ids.includes(el.wall)) continue;
          const w = byId(A.p, el.wall);
          const r = projectOnSegment(s.p, w.a, w.b);
          el.pos = Math.max(el.width / 2, Math.min(wallLength(w) - el.width / 2, r.along));
          if (this.gridSnap) el.pos = Math.round(el.pos / 0.05) * 0.05;
          continue;
        }
        if (o.a) { el.a = add(o.a, delta); el.b = add(o.b, delta); }
        if (o.p) el.p = add(o.p, delta);
        if (o.pts) el.pts = o.pts.map((q) => add(q, delta));
      }
      emit('model');
      return;
    }
    const from = this.draw?.pts[this.draw.pts.length - 1];
    this.snap = A.tool === 'select' ? null : this.snapPoint(p, from, e.shiftKey);
    this.status();
    this.invalidate();
  }
  gripAnchor(g) {
    const e = g.e;
    if (typeof g.key === 'number') return e.pts[(g.key + e.pts.length - 1) % e.pts.length];
    return g.key === 'a' ? e.b : e.a;
  }
  up(p, e) {
    const d = this.drag;
    this.drag = null;
    this.snap = null;
    if (d?.kind === 'box') {
      const b = { x0: Math.min(d.a[0], d.b[0]), x1: Math.max(d.a[0], d.b[0]), y0: Math.min(d.a[1], d.b[1]), y1: Math.max(d.a[1], d.b[1]) };
      if (b.x1 - b.x0 > 4 / this.v.s || b.y1 - b.y0 > 4 / this.v.s) {
        for (const el of this.storeyEls()) {
          let pts = el.pts || [el.a, el.b, el.p].filter(Boolean);
          if (el.type === 'door' || el.type === 'window') { const w = byId(A.p, el.wall); if (!w) continue; const dir = norm(sub(w.b, w.a)); pts = [add(w.a, mul(dir, el.pos))]; }
          if (pts.length && pts.every((q) => q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.y0 && q[1] <= b.y1)) A.sel.add(el.id);
        }
        emit('sel');
      }
      this.invalidate();
      return;
    }
    if (d) { this.invalidate(); return; }
    if (A.tool !== 'select' && e.button === 0) {
      const s = this.snapPoint(p, this.draw?.pts[this.draw.pts.length - 1], e.shiftKey);
      this.click(s.p, p);
    }
  }

  // ---------------------------------------------------------------- unelte de desen
  click(p, raw) {
    this.click0(p, raw);
    this.ui.onDraw?.();
  }
  click0(p, raw) {
    const t = A.tool, D = A.defaults[t];
    if (t === 'column') { snapshot(); const el = addElement(A.p, { type: 'column', storey: A.storey, p, ...D }); this.selectOnly(el); return; }
    if (t === 'door' || t === 'window') { this.placeOpening(raw); return; }
    if (t === 'zone' && D.mode === 'auto') { this.autoZone(raw); return; }
    if (t === 'slab' && D.mode === 'auto') { this.autoZone(raw, 'slab'); return; }
    this.place(p);
  }
  place(p) {
    const t = A.tool, D = A.defaults[t];
    if (!this.draw) this.draw = { pts: [] };
    const pts = this.draw.pts;
    if ((t === 'wall' || t === 'beam') && pts.length) {
      const a = pts[pts.length - 1];
      if (dist(a, p) < 0.02) return;
      snapshot();
      const el = addElement(A.p, t === 'wall' ? { type: 'wall', storey: A.storey, a: a.slice(), b: p.slice(), ...D } : { type: 'beam', storey: A.storey, a: a.slice(), b: p.slice(), ...D });
      A.sel.clear(); A.sel.add(el.id);
      emit('model');
      if (dist(p, pts[0]) < 0.01 && pts.length > 1) { this.draw = null; return; }
    }
    if (t === 'dim') {
      pts.push(p);
      if (pts.length === 3) {
        snapshot();
        const [a, b, c] = pts;
        const dir = norm(sub(b, a));
        const el = addElement(A.p, { type: 'dim', storey: A.storey, a, b, offset: dot(sub(c, a), perp(dir)) });
        this.draw = null; this.selectOnly(el);
      }
      this.invalidate();
      return;
    }
    if (['slab', 'zone', 'roof'].includes(t)) {
      if (D.mode === 'rect' && pts.length === 1) {
        const a = pts[0];
        if (Math.abs(a[0] - p[0]) < 0.05 || Math.abs(a[1] - p[1]) < 0.05) return;
        this.addPoly([[a[0], a[1]], [p[0], a[1]], [p[0], p[1]], [a[0], p[1]]]);
        return;
      }
      if (pts.length > 2 && dist(p, pts[0]) < 8 / this.v.s) { this.addPoly(pts.slice()); return; }
    }
    pts.push(p.slice());
    this.invalidate();
    this.ui.onDraw?.();
  }
  addPoly(pts) {
    const t = A.tool, D = { ...A.defaults[t] };
    delete D.mode;
    if (polyArea(pts) < 0) pts.reverse();
    snapshot();
    const extra = t === 'zone' ? { name: D.name, number: D.number || this.nextZoneNumber() } : {};
    const el = addElement(A.p, { type: t, storey: A.storey, pts, ...D, ...extra });
    this.draw = null;
    this.selectOnly(el);
    this.ui.onDraw?.();
  }
  nextZoneNumber() {
    const s = storeyOf(A.p, { storey: A.storey });
    const n = A.p.elements.filter((e) => e.type === 'zone' && e.storey === A.storey).length + 1;
    return (s.name[0] || 'Z').toUpperCase() + '.' + String(n).padStart(2, '0');
  }
  selectOnly(el) { A.sel.clear(); A.sel.add(el.id); emit('model'); }
  finishDraw(byUser) {
    const t = A.tool, d = this.draw;
    if (!d) return;
    if (['slab', 'zone', 'roof'].includes(t) && d.pts.length >= 3 && byUser) { this.addPoly(d.pts.slice()); return; }
    this.cancelDraw();
  }
  closePoly() { if (['slab', 'zone', 'roof'].includes(A.tool) && this.draw?.pts.length >= 3) this.addPoly(this.draw.pts.slice()); }
  // lungime introdusă din bara de desen (tastatura numerică de pe telefon)
  typed(L, ang) { if (!(L > 0)) return; this.num = String(L) + (ang !== '' && ang != null ? '<' + ang : ''); this.applyNum(); }
  cancelDraw() { this.draw = null; this.num = ''; this.showNum(); this.invalidate(); this.ui.onDraw?.(); }

  nearestWall(p) {
    let best = null;
    for (const w of this.storeyEls()) {
      if (w.type !== 'wall') continue;
      const r = projectOnSegment(p, w.a, w.b);
      if (r.d < w.thickness / 2 + 12 / this.v.s && (!best || r.d < best.r.d)) best = { w, r };
    }
    return best;
  }
  openingPreview(raw) {
    const t = A.tool, D = A.defaults[t];
    const n = this.nearestWall(raw);
    if (!n) return null;
    const L = wallLength(n.w);
    if (L < D.width + 0.1) return null;
    let pos = n.r.along;
    if (this.gridSnap) pos = Math.round(pos / 0.05) * 0.05;
    pos = Math.max(D.width / 2 + 0.05, Math.min(L - D.width / 2 - 0.05, pos));
    const dir = norm(sub(n.w.b, n.w.a));
    const side = dot(sub(raw, n.w.a), perp(dir)) < 0;
    return { wall: n.w, pos, flip: side };
  }
  placeOpening(raw) {
    const t = A.tool, D = A.defaults[t];
    const o = this.openingPreview(raw);
    if (!o) { this.ui.status('Așază ușile și ferestrele pe un perete', true); return; }
    snapshot();
    const el = addElement(A.p, { type: t, wall: o.wall.id, pos: o.pos, ...D, ...(t === 'door' ? { flip: o.flip } : {}) });
    this.selectOnly(el);
  }

  // Detectare automată a conturului unei camere din pereți (umplere pe o grilă de 5 cm)
  autoZone(raw, as = 'zone') {
    const walls = this.storeyEls().filter((e) => e.type === 'wall');
    if (!walls.length) { this.ui.status('Nu sunt pereți pe acest nivel', true); return; }
    const outlines = walls.map((w) => wallOutline(A.p, w));
    const all = bbox(outlines.flat());
    if (!pointInPoly(raw, [[all.x0, all.y0], [all.x1, all.y0], [all.x1, all.y1], [all.x0, all.y1]])) { this.ui.status('Fă clic în interiorul unei încăperi închise de pereți', true); return; }
    const h = 0.05, x0 = all.x0 - h, y0 = all.y0 - h;
    const nx = Math.ceil((all.x1 - all.x0) / h) + 3, ny = Math.ceil((all.y1 - all.y0) / h) + 3;
    if (nx * ny > 4e6) { this.ui.status('Clădirea e prea mare pentru detectarea automată – desenează conturul manual', true); return; }
    const grid = new Uint8Array(nx * ny); // 1 = perete
    outlines.forEach((o) => {
      const b = bbox(o);
      for (let j = Math.max(0, Math.floor((b.y0 - y0) / h)); j <= Math.min(ny - 1, Math.ceil((b.y1 - y0) / h)); j++) {
        for (let i = Math.max(0, Math.floor((b.x0 - x0) / h)); i <= Math.min(nx - 1, Math.ceil((b.x1 - x0) / h)); i++) {
          if (pointInPoly([x0 + (i + 0.5) * h, y0 + (j + 0.5) * h], o)) grid[j * nx + i] = 1;
        }
      }
    });
    // golurile de uși nu închid camera: le ignorăm (pereții rămân continui la detectare)
    const si = Math.floor((raw[0] - x0) / h), sj = Math.floor((raw[1] - y0) / h);
    if (grid[sj * nx + si]) { this.ui.status('Ai făcut clic pe un perete – fă clic în interiorul camerei', true); return; }
    const fill = new Uint8Array(nx * ny);
    const stack = [sj * nx + si];
    fill[stack[0]] = 1;
    let leaked = false, count = 0;
    while (stack.length) {
      const c = stack.pop(); count++;
      const i = c % nx, j = (c - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) { leaked = true; break; }
      for (const n of [c - 1, c + 1, c - nx, c + nx]) if (!grid[n] && !fill[n]) { fill[n] = 1; stack.push(n); }
    }
    if (leaked) { this.ui.status('Conturul nu este închis de pereți – desenează zona manual', true); return; }
    // conturul zonei umplute: urmărim marginile celulelor (pătrate) și simplificăm
    const edges = new Map();
    const key = (i, j) => i + ',' + j;
    const addE = (a, b) => edges.set(key(...a), b);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      if (!fill[j * nx + i]) continue;
      if (!fill[(j - 1) * nx + i]) addE([i, j], [i + 1, j]);
      if (!fill[j * nx + i + 1]) addE([i + 1, j], [i + 1, j + 1]);
      if (!fill[(j + 1) * nx + i]) addE([i + 1, j + 1], [i, j + 1]);
      if (!fill[j * nx + i - 1]) addE([i, j + 1], [i, j]);
    }
    // cel mai lung contur (exteriorul camerei)
    const seen = new Set();
    let bestLoop = [];
    for (const k0 of edges.keys()) {
      if (seen.has(k0)) continue;
      const loop = [];
      let k = k0;
      while (!seen.has(k)) { seen.add(k); const [i, j] = k.split(',').map(Number); loop.push([x0 + i * h, y0 + j * h]); const nxt = edges.get(k); if (!nxt) break; k = key(...nxt); }
      if (loop.length > bestLoop.length) bestLoop = loop;
    }
    let pts = simplify(bestLoop, 0.04);
    if (pts.length < 3) return;
    if (polyArea(pts) < 0) pts.reverse();
    pts = pts.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
    const prev = A.tool;
    A.tool = as;
    this.addPoly(pts);
    A.tool = prev;
    void count;
  }

  status() {
    if (!this.ui.status) return;
    const t = A.tool;
    const s = this.snap;
    let msg = '';
    const pts = this.draw?.pts || [];
    if (pts.length && s) {
      const a = pts[pts.length - 1], v = sub(s.p, a);
      msg = `L = ${fmt(len(v))} m · ${fmt((Math.atan2(v[1], v[0]) * 180 / Math.PI + 360) % 360, 1)}° · Δx ${fmt(v[0])} · Δy ${fmt(v[1])}`;
    } else if (s) msg = `x ${fmt(s.p[0])} · y ${fmt(s.p[1])}`;
    if (s?.kind) msg += ` · ${s.kind}`;
    const hints = {
      wall: pts.length ? 'Clic pentru următorul punct · tastează lungimea + Enter · dublu-clic/Esc pentru final' : 'Clic pentru începutul peretelui',
      beam: pts.length ? 'Clic pentru capătul grinzii · tastează lungimea + Enter' : 'Clic pentru începutul grinzii',
      slab: A.defaults.slab.mode === 'auto' ? 'Clic în interiorul pereților pentru placă' : pts.length ? 'Clic pe colțul opus / următorul punct' : 'Clic pentru primul colț',
      zone: A.defaults.zone.mode === 'auto' ? 'Clic în interiorul unei camere – conturul se detectează din pereți' : pts.length ? 'Clic pe colțul opus / următorul punct' : 'Clic pentru primul colț',
      roof: pts.length ? 'Clic pe colțul opus / următorul punct' : 'Clic pentru primul colț al acoperișului (cu streașina)',
      door: 'Clic pe un perete · partea pe care ești alege sensul de deschidere', window: 'Clic pe un perete',
      column: 'Clic pentru poziția stâlpului', dim: ['Clic pe primul punct', 'Clic pe al doilea punct', 'Clic pentru poziția liniei de cotă'][pts.length] || '',
      select: 'Clic pe element · Shift pentru mai multe · trage pentru a muta · Delete pentru ștergere',
    };
    this.ui.status((hints[t] || '') + (msg ? '   |   ' + msg : ''));
  }

  // ---------------------------------------------------------------- desen
  dimLine(e) {
    const dir = norm(sub(e.b, e.a)), n = perp(dir);
    const a = add(e.a, mul(n, e.offset || 0)), b = add(e.b, mul(n, e.offset || 0));
    return [a, b, mul(add(a, b), 0.5)];
  }
  paint() {
    const c = this.ctx, k = this.k;
    c.setTransform(k, 0, 0, k, 0, 0);
    c.fillStyle = PAPER;
    c.fillRect(0, 0, this.W, this.H);
    this.paintGrid();
    const below = this.belowStorey();
    if (below) {
      c.globalAlpha = 0.35;
      for (const e of this.storeyEls(below.id)) if (e.type === 'wall') this.poly(wallOutline(A.p, e), null, '#9aa3b2', 1);
      c.globalAlpha = 1;
    }
    const els = this.storeyEls();
    const by = (t) => els.filter((e) => e.type === t);
    const selected = (e) => A.sel.has(e.id);
    for (const e of by('slab')) this.poly(e.pts, e.use === 'A_bal' ? '#eef3ea' : '#f1f2f5', selected(e) ? SEL : '#b8bfcc', selected(e) ? 2 : 1);
    for (const e of by('zone')) this.paintZone(e, selected(e));
    for (const e of by('roof')) this.paintRoof(e, selected(e));
    for (const e of by('beam')) this.paintBeam(e, selected(e));
    // pereți: întâi conturul gros, apoi umplutura – liniile interioare de la îmbinări dispar
    const walls = by('wall');
    for (const w of walls) this.poly(wallOutline(A.p, w), null, A.sel.has(w.id) ? SEL : INK, A.sel.has(w.id) ? 3 : 2);
    for (const w of walls) this.poly(wallOutline(A.p, w), this.wallFill(w), null);
    for (const w of walls) if (MATERIALS[w.material]?.kind === 'zidarie') this.hatch(wallOutline(A.p, w), w);
    for (const e of els) if (e.type === 'door' || e.type === 'window') this.paintOpening(e, selected(e));
    for (const e of by('column')) this.paintColumn(e, selected(e));
    for (const e of by('dim')) this.paintDim(e, selected(e));
    if (A.showLoads && A.loads) this.paintLoads();
    for (const w of walls) if (A.sel.has(w.id) && A.sel.size < 6) this.lengthLabel(w);
    // puncte de apucare
    for (const g of this.grips()) { const [x, y] = this.toScreen(this.gripPos(g)); c.fillStyle = '#fff'; c.strokeStyle = SEL; c.lineWidth = 1.5; c.fillRect(x - 4, y - 4, 8, 8); c.strokeRect(x - 4, y - 4, 8, 8); }
    this.paintPreview();
    if (this.drag?.kind === 'box') {
      const [x0, y0] = this.toScreen(this.drag.a), [x1, y1] = this.toScreen(this.drag.b);
      c.fillStyle = 'rgba(37,99,235,.08)'; c.strokeStyle = SEL; c.lineWidth = 1; c.setLineDash([4, 3]);
      c.fillRect(x0, y0, x1 - x0, y1 - y0); c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.setLineDash([]);
    }
    if (this.snap && (A.tool !== 'select' || this.drag)) {
      const [x, y] = this.toScreen(this.snap.p);
      c.strokeStyle = '#e8590c'; c.lineWidth = 1.5;
      if (this.snap.kind) { c.strokeRect(x - 5, y - 5, 10, 10); c.font = '11px system-ui, sans-serif'; c.fillStyle = '#e8590c'; c.fillText(this.snap.kind, x + 9, y - 8); }
      c.beginPath(); c.moveTo(x - 9, y); c.lineTo(x + 9, y); c.moveTo(x, y - 9); c.lineTo(x, y + 9); c.stroke();
    }
    if (this.finger && this.snap) {
      const [fx, fy] = this.finger, [x, y] = this.toScreen(this.snap.p);
      c.strokeStyle = 'rgba(232,89,12,.6)'; c.lineWidth = 1; c.setLineDash([3, 3]);
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(x, y); c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(232,89,12,.18)'; c.beginPath(); c.arc(fx, fy, 22, 0, Math.PI * 2); c.fill();
    }
    this.paintScale();
  }
  paintGrid() {
    const c = this.ctx, g = this.gridStep();
    const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.W, this.H);
    const major = g * 5;
    for (const [step, color] of [[g, '#f0f2f6'], [major, '#e1e5ec']]) {
      if (step * this.v.s < 6) continue;
      c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { const sx = Math.round(this.toScreen([x, 0])[0]) + 0.5; c.moveTo(sx, 0); c.lineTo(sx, this.H); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const sy = Math.round(this.toScreen([0, y])[1]) + 0.5; c.moveTo(0, sy); c.lineTo(this.W, sy); }
      c.stroke();
    }
    // axele de origine
    const o = this.toScreen([0, 0]);
    c.strokeStyle = '#f3c4c4'; c.beginPath(); c.moveTo(o[0], 0); c.lineTo(o[0], this.H); c.moveTo(0, o[1]); c.lineTo(this.W, o[1]); c.stroke();
  }
  paintScale() {
    const c = this.ctx;
    const targets = [0.5, 1, 2, 5, 10, 20, 50];
    const m = targets.find((t) => t * this.v.s > 60) || 50;
    const x = 14, y = this.H - 16, w = m * this.v.s;
    c.strokeStyle = INK; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y - 4); c.stroke();
    c.font = '11px system-ui, sans-serif'; c.fillStyle = INK; c.fillText(`${m} m`, x + w + 6, y);
  }
  path(pts) { const c = this.ctx; c.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toScreen(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); }
  poly(pts, fill, stroke, lw = 1) {
    const c = this.ctx;
    this.path(pts);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
  }
  wallFill(w) {
    if (A.sel.has(w.id)) return '#dbe6ff';
    const m = MATERIALS[w.material];
    if (!m) return '#ccc';
    if (m.kind === 'beton') return '#9aa1ab';
    if (m.kind === 'usor') return '#f6f6f3';
    return m.color;
  }
  hatch(pts, w) {
    const c = this.ctx;
    if (this.v.s < 25) return;
    c.save(); this.path(pts); c.clip();
    const b = bbox(pts.map((p) => this.toScreen(p)));
    c.strokeStyle = 'rgba(80,60,40,.35)'; c.lineWidth = 1; c.beginPath();
    const step = 7;
    for (let x = b.x0 - (b.y1 - b.y0); x < b.x1; x += step) { c.moveTo(x, b.y1); c.lineTo(x + (b.y1 - b.y0), b.y0); }
    c.stroke(); c.restore();
    void w;
  }
  paintZone(e, sel) {
    const c = this.ctx;
    this.poly(e.pts, sel ? 'rgba(37,99,235,.12)' : 'rgba(255,196,77,.13)', sel ? SEL : 'rgba(205,140,0,.55)', sel ? 2 : 1);
    if (this.v.s < 12) return;
    const [x, y] = this.toScreen(polyCentroid(e.pts));
    c.textAlign = 'center'; c.fillStyle = '#4a3b12';
    c.font = '600 12px system-ui, sans-serif'; c.fillText(e.name || '', x, y - 4);
    c.font = '11px system-ui, sans-serif'; c.fillText(`${e.number ? e.number + ' · ' : ''}${fmt(Math.abs(polyArea(e.pts)))} m²`, x, y + 10);
    c.textAlign = 'start';
  }
  paintRoof(e, sel) {
    const c = this.ctx;
    c.setLineDash([8, 4]);
    this.poly(e.pts, null, sel ? SEL : '#a8452f', sel ? 2 : 1.2);
    c.setLineDash([]);
    if (e.kind === 'flat') return;
    const b = bbox(e.pts);
    c.strokeStyle = sel ? SEL : '#a8452f'; c.lineWidth = 1; c.beginPath();
    if (e.kind === 'gable') {
      const [p, q] = e.axis === 'x' ? [[b.x0, (b.y0 + b.y1) / 2], [b.x1, (b.y0 + b.y1) / 2]] : [[(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1]];
      const [x0, y0] = this.toScreen(p), [x1, y1] = this.toScreen(q); c.moveTo(x0, y0); c.lineTo(x1, y1);
    } else {
      const m = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
      const [x0, y0] = this.toScreen(e.axis === 'x' ? [m[0], b.y1 - 0.3] : [b.x1 - 0.3, m[1]]), [x1, y1] = this.toScreen(e.axis === 'x' ? [m[0], b.y0 + 0.3] : [b.x0 + 0.3, m[1]]);
      c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x1 - 5, y1 - 8 * Math.sign(y1 - y0 || 1)); c.moveTo(x1, y1); c.lineTo(x1 + 5, y1 - 8 * Math.sign(y1 - y0 || 1));
    }
    c.stroke();
  }
  paintBeam(e, sel) {
    const c = this.ctx;
    const d = norm(sub(e.b, e.a)), n = mul(perp(d), e.w / 2);
    c.setLineDash([6, 4]); c.strokeStyle = sel ? SEL : '#5c6b80'; c.lineWidth = sel ? 2 : 1.2;
    for (const s of [1, -1]) { const [x0, y0] = this.toScreen(add(e.a, mul(n, s))), [x1, y1] = this.toScreen(add(e.b, mul(n, s))); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
    c.setLineDash([]);
  }
  paintColumn(e, sel) {
    const pts = [[e.p[0] - e.w / 2, e.p[1] - e.d / 2], [e.p[0] + e.w / 2, e.p[1] - e.d / 2], [e.p[0] + e.w / 2, e.p[1] + e.d / 2], [e.p[0] - e.w / 2, e.p[1] + e.d / 2]];
    this.poly(pts, sel ? '#7aa2ff' : '#5f6672', sel ? SEL : INK, sel ? 2 : 1.5);
    const c = this.ctx; c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1;
    const [a, b2] = [this.toScreen(pts[0]), this.toScreen(pts[2])], [a2, b3] = [this.toScreen(pts[1]), this.toScreen(pts[3])];
    c.beginPath(); c.moveTo(...a); c.lineTo(...b2); c.moveTo(...a2); c.lineTo(...b3); c.stroke();
  }
  openingGeom(e) {
    const w = byId(A.p, e.wall);
    if (!w) return null;
    const d = norm(sub(w.b, w.a)), n = perp(d), h = w.thickness / 2;
    const c0 = add(w.a, mul(d, e.pos - e.width / 2)), c1 = add(w.a, mul(d, e.pos + e.width / 2));
    return { w, d, n, h, c0, c1 };
  }
  paintOpening(e, sel) {
    const g = this.openingGeom(e);
    if (!g) return;
    const c = this.ctx, { d, n, h, c0, c1 } = g;
    const rect = [add(c0, mul(n, h + 0.005)), add(c1, mul(n, h + 0.005)), sub(c1, mul(n, h + 0.005)), sub(c0, mul(n, h + 0.005))];
    this.poly(rect, PAPER, null);
    const line = (p, q, color = INK, lw = 1) => { const [x0, y0] = this.toScreen(p), [x1, y1] = this.toScreen(q); c.strokeStyle = color; c.lineWidth = lw; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
    const col = sel ? SEL : INK;
    // glafuri
    line(add(c0, mul(n, h)), sub(c0, mul(n, h)), col, 1.5);
    line(add(c1, mul(n, h)), sub(c1, mul(n, h)), col, 1.5);
    if (e.type === 'window') {
      line(add(c0, mul(n, h * 0.35)), add(c1, mul(n, h * 0.35)), col, 1);
      line(sub(c0, mul(n, h * 0.35)), sub(c1, mul(n, h * 0.35)), col, 1);
      line(c0, c1, col, 1);
    } else {
      const s = e.flip ? -1 : 1;
      const hinge = add(c0, mul(n, s * h)), tip = add(hinge, mul(n, s * e.width));
      line(hinge, tip, col, 1.5);
      const [hx, hy] = this.toScreen(hinge);
      const a0 = Math.atan2(-(tip[1] - hinge[1]), tip[0] - hinge[0]);
      const end = add(c1, mul(n, s * h));
      const a1 = Math.atan2(-(end[1] - hinge[1]), end[0] - hinge[0]);
      c.strokeStyle = col; c.lineWidth = 0.8; c.setLineDash([3, 3]); c.beginPath();
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      c.arc(hx, hy, e.width * this.v.s, a0, a1, da < 0); c.stroke(); c.setLineDash([]);
    }
    void d;
  }
  paintDim(e, sel) {
    const c = this.ctx;
    const [a, b, m] = this.dimLine(e);
    const col = sel ? SEL : '#334155';
    const [ax, ay] = this.toScreen(a), [bx, by] = this.toScreen(b), [ex, ey] = this.toScreen(e.a), [fx, fy] = this.toScreen(e.b);
    c.strokeStyle = col; c.lineWidth = 1;
    c.beginPath(); c.moveTo(ex, ey); c.lineTo(ax, ay); c.moveTo(fx, fy); c.lineTo(bx, by); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    for (const [x, y] of [[ax, ay], [bx, by]]) { c.beginPath(); c.moveTo(x - 4, y + 4); c.lineTo(x + 4, y - 4); c.lineWidth = 2; c.stroke(); c.lineWidth = 1; }
    const [mx, my] = this.toScreen(m);
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    c.save(); c.translate(mx, my); c.rotate(ang); c.fillStyle = col; c.font = '12px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(fmt(dist(e.a, e.b)), 0, -4); c.restore();
  }
  lengthLabel(w) {
    const c = this.ctx;
    const d = norm(sub(w.b, w.a)), n = perp(d);
    const m = add(mul(add(w.a, w.b), 0.5), mul(n, w.thickness / 2 + 14 / this.v.s));
    const [x, y] = this.toScreen(m);
    let ang = -Math.atan2(d[1], d[0]);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = SEL; c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(`${fmt(wallLength(w))} m`, 0, 4); c.restore();
  }
  paintPreview() {
    const c = this.ctx, t = A.tool, s = this.snap;
    if (!s || t === 'select') return;
    const pts = this.draw?.pts || [];
    const D = A.defaults[t];
    if ((t === 'door' || t === 'window') && this.mouse) {
      const o = this.openingPreview(this.mouse);
      if (o) {
        const fake = { type: t, wall: o.wall.id, pos: o.pos, ...D, flip: o.flip };
        c.globalAlpha = 0.7; this.paintOpening(fake, true); c.globalAlpha = 1;
      }
      return;
    }
    if (t === 'column') { c.globalAlpha = 0.6; this.paintColumn({ p: s.p, ...D }, true); c.globalAlpha = 1; return; }
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    c.strokeStyle = SEL; c.lineWidth = 1.5;
    if (t === 'wall') {
      const fake = { type: 'wall', a: last, b: s.p, thickness: D.thickness, storey: '__' };
      if (dist(last, s.p) > 0.01) this.poly(wallOutline(A.p, fake), 'rgba(37,99,235,.15)', SEL, 1.5);
    } else if (t === 'beam') this.paintBeam({ a: last, b: s.p, w: D.w }, true);
    else if (t === 'dim') {
      if (pts.length === 1) { this.path([last, s.p]); c.stroke(); } else { const dir = norm(sub(pts[1], pts[0])); this.paintDim({ a: pts[0], b: pts[1], offset: dot(sub(s.p, pts[0]), perp(dir)) }, true); }
    } else if (['slab', 'zone', 'roof'].includes(t)) {
      if (D.mode === 'rect') { const a = pts[0]; this.poly([a, [s.p[0], a[1]], s.p, [a[0], s.p[1]]], 'rgba(37,99,235,.08)', SEL, 1.5); } else {
        c.beginPath(); pts.concat([s.p]).forEach((p, i) => { const [x, y] = this.toScreen(p); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
        for (const p of pts) { const [x, y] = this.toScreen(p); c.fillStyle = SEL; c.fillRect(x - 3, y - 3, 6, 6); }
      }
    }
    // eticheta cu lungimea segmentului curent
    if (t !== 'dim' || pts.length === 1) {
      const L = dist(last, s.p);
      if (L > 0.01) {
        const [x, y] = this.toScreen(mul(add(last, s.p), 0.5));
        const txt = this.num ? this.num + ' m' : fmt(L) + ' m';
        c.font = '600 12px system-ui, sans-serif';
        const w = c.measureText(txt).width + 10;
        c.fillStyle = 'rgba(29,36,51,.85)'; c.fillRect(x - w / 2, y - 22, w, 18);
        c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(txt, x, y - 9); c.textAlign = 'start';
      }
    }
  }
  paintLoads() {
    const c = this.ctx, L = A.loads;
    const color = (u) => u == null ? '#64748b' : u < 0.6 ? '#16a34a' : u < 0.9 ? '#d97706' : '#dc2626';
    for (const r of L.items) {
      const e = byId(A.p, r.id);
      if (!e || e.storey !== A.storey) continue;
      if (e.type === 'wall' && r.bearing) {
        this.poly(wallOutline(A.p, e), color(r.util) + 'cc', null);
        const d = norm(sub(e.b, e.a)), n = perp(d);
        const m = add(mul(add(e.a, e.b), 0.5), mul(n, -(e.thickness / 2 + 16 / this.v.s)));
        const [x, y] = this.toScreen(m);
        let ang = -Math.atan2(d[1], d[0]); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        c.save(); c.translate(x, y); c.rotate(ang); c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'center';
        const txt = `${fmt(r.nEd, 1)} kN/m`; const w = c.measureText(txt).width + 8;
        c.fillStyle = '#fff'; c.fillRect(-w / 2, -6, w, 15); c.fillStyle = color(r.util); c.fillText(txt, 0, 5); c.restore();
      }
      if (e.type === 'column' || e.type === 'beam') {
        const p = e.p || mul(add(e.a, e.b), 0.5);
        const [x, y] = this.toScreen(p);
        const txt = e.type === 'column' ? `N=${fmt(r.NEd, 0)} kN` : `q=${fmt(r.qEd, 1)} kN/m`;
        c.font = '600 11px system-ui, sans-serif'; const w = c.measureText(txt).width + 8;
        c.fillStyle = '#fff'; c.fillRect(x + 8, y - 16, w, 15); c.strokeStyle = color(r.util); c.strokeRect(x + 8, y - 16, w, 15);
        c.fillStyle = color(r.util); c.fillText(txt, x + 12, y - 5);
      }
    }
  }
}

// Douglas–Peucker pentru un contur închis
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  // pornim din punctul cel mai îndepărtat de primul, ca să tratăm conturul închis
  let far = 0, fd = 0;
  for (let i = 1; i < pts.length; i++) { const d = dist(pts[0], pts[i]); if (d > fd) { fd = d; far = i; } }
  const rdp = (a) => {
    if (a.length < 3) return a;
    let idx = 0, md = 0;
    for (let i = 1; i < a.length - 1; i++) { const d = projectOnSegment(a[i], a[0], a[a.length - 1]).d; if (d > md) { md = d; idx = i; } }
    if (md <= tol) return [a[0], a[a.length - 1]];
    const l = rdp(a.slice(0, idx + 1)), r = rdp(a.slice(idx));
    return l.slice(0, -1).concat(r);
  };
  const p1 = rdp(pts.slice(0, far + 1)), p2 = rdp(pts.slice(far).concat([pts[0]]));
  return p1.slice(0, -1).concat(p2.slice(0, -1));
}

export { USES };
