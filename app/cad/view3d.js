// Vederea 3D, generată automat din model la fiecare modificare.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { elementGeometry } from './geometry3d.js';
import { sortedStoreys } from './model.js';
import { A, emit } from './state.js';

export class View3D {
  constructor(canvas) {
    this.cv = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe4e9f0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(0.5, 1, 0.3); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-0.6, 0.4, -0.7); this.scene.add(fill);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xc9d4bf }));
    ground.position.y = -0.31; this.scene.add(ground);
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
    this.cam.position.set(18, 14, 18);
    this.ctl = new OrbitControls(this.cam, canvas);
    this.ctl.enableDamping = true;
    this.ctl.target.set(5, 1.5, -4);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.mats = new Map();
    this.hl = new THREE.MeshLambertMaterial({ color: 0x3d7bff, emissive: 0x0d2a80 });
    this.upTo = false; // afișează doar până la nivelul curent
    this.showZones = false;
    this.dirty = true; this.needBuild = true; this.fitted = false;
    this.ctl.addEventListener('change', () => (this.dirty = true));
    new ResizeObserver(() => this.resize()).observe(canvas);
    let down = null;
    canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    canvas.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) this.pick(e); down = null; });
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.visible()) return;
      if (this.needBuild) this.build();
      if (this.ctl.update()) this.dirty = true;
      if (this.dirty) { this.dirty = false; this.r.render(this.scene, this.cam); }
    };
    requestAnimationFrame(loop);
  }
  visible() { return this.cv.offsetParent !== null && this.cv.clientWidth > 0; }
  resize() {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    const first = !this.sized; this.sized = true;
    this.r.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
    if (first && this.group.children.length) this.fit();
    this.dirty = true;
  }
  invalidate(kind) { if (kind === 'model' || kind === 'storey') this.needBuild = true; else this.applySel(); this.dirty = true; }
  mat(color, opacity = 1) {
    const k = color + ':' + opacity;
    if (!this.mats.has(k)) this.mats.set(k, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide }));
    return this.mats.get(k);
  }
  build() {
    this.needBuild = false;
    for (const m of this.group.children) m.geometry.dispose();
    this.group.clear();
    const ss = sortedStoreys(A.p);
    const cur = ss.findIndex((s) => s.id === A.storey);
    const allowed = new Set(ss.filter((s, i) => !this.upTo || i <= cur).map((s) => s.id));
    for (const e of A.p.elements) {
      if (e.type === 'dim' || (e.type === 'zone' && !this.showZones)) continue;
      const host = e.wall ? A.p.elements.find((w) => w.id === e.wall) : e;
      if (!host || !allowed.has(host.storey)) continue;
      let parts;
      try { parts = elementGeometry(A.p, e); } catch (err) { console.warn('geometrie', e.id, err); continue; }
      for (const part of parts) {
        const m = new THREE.Mesh(part.geo, this.mat(part.color, part.opacity ?? 1));
        m.userData.id = e.id;
        m.userData.base = m.material;
        this.group.add(m);
      }
    }
    this.applySel();
    if (!this.fitted && this.group.children.length) { this.fit(); this.fitted = true; }
    this.dirty = true;
  }
  applySel() {
    for (const m of this.group.children) m.material = A.sel.has(m.userData.id) ? this.hl : m.userData.base;
    this.dirty = true;
  }
  fit() {
    const b = new THREE.Box3().setFromObject(this.group);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2;
    this.ctl.target.copy(c);
    const vf = THREE.MathUtils.degToRad(this.cam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * this.cam.aspect);
    this.cam.position.copy(c).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(r / Math.sin(Math.min(vf, hf) / 2) * 0.95));
    this.ctl.update();
    this.dirty = true;
  }
  pick(e) {
    const r = this.cv.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.cam);
    const hit = ray.intersectObjects(this.group.children, false)[0];
    if (!e.shiftKey) A.sel.clear();
    if (hit) {
      const id = hit.object.userData.id;
      if (e.shiftKey && A.sel.has(id)) A.sel.delete(id); else A.sel.add(id);
      const el = A.p.elements.find((x) => x.id === id);
      const st = el?.wall ? A.p.elements.find((w) => w.id === el.wall)?.storey : el?.storey;
      if (st && st !== A.storey) { A.storey = st; emit('storey'); }
    }
    emit('sel');
  }
}
