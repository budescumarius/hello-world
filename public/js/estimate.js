// Online budget estimator: pick a project type, dimensions, material and options,
// see a live CSS-3D model and an instant price range from the admin's price grid.
(function () {
  const FURNITURE_MATS = ['melamine', 'lacquer', 'oak_veneer', 'walnut_veneer', 'solid_oak'];
  // dims: [min, max, default, step]
  const TYPES = {
    kitchen: { mats: FURNITURE_MATS, dims: { length: [1.5, 8, 3.6, 0.1] }, opts: ['worktop', 'island', 'drawer', 'glass', 'led'] },
    wardrobe: { mats: FURNITURE_MATS, dims: { width: [0.6, 6, 2.4, 0.1], height: [1.8, 3, 2.5, 0.05] }, opts: ['drawer', 'glass', 'led'] },
    bookcase: { mats: FURNITURE_MATS, dims: { width: [0.8, 6, 3, 0.1], height: [1, 3, 2.2, 0.05] }, opts: ['drawer', 'glass', 'led'] },
    vanity: { mats: FURNITURE_MATS, dims: { width: [0.6, 2.4, 1.2, 0.05] }, opts: ['drawer', 'led'] },
    stairs: { mats: ['beech', 'stairs_oak'], dims: { steps: [6, 20, 14, 1] }, opts: ['handrail'] },
    parquet: { mats: ['laminate', 'engineered_oak', 'solid_oak_floor'], dims: { area: [5, 200, 30, 1] }, opts: ['removal', 'sanding'] }
  };
  const ICONS = {
    kitchen: '<rect x="3" y="11" width="18" height="9" rx="1"/><path d="M3 15h18M9 11v9M15 11v9"/><path d="M6 7h4M14 4v4M12 4h4"/>',
    wardrobe: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M10 11v2M14 11v2"/>',
    bookcase: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M3 15h18M7 5v3M9 5v3M15 11v3M17 17v3"/>',
    vanity: '<path d="M4 10h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M12 10V6M9 6h6M12 13v3"/>',
    stairs: '<path d="M3 21h5v-5h5v-5h5V6h3"/><path d="M3 21V9"/>',
    parquet: '<path d="M3 3l6 6-6 6M9 3l6 6-6 6M15 3l6 6-6 6M3 15l6 6M9 15l6 6M15 15l6 6"/>'
  };
  const WOOD = {
    melamine: ['#f3f1ec', false], lacquer: ['#e7e2da', false], oak_veneer: ['#d4b083', true], walnut_veneer: ['#7b5236', true],
    solid_oak: ['#c79c66', true], beech: ['#e2c49c', true], stairs_oak: ['#c79c66', true],
    laminate: ['#cdb595', true], engineered_oak: ['#d2ab7b', true], solid_oak_floor: ['#c49862', true]
  };
  const WORKTOPS = { worktop_laminate: '#8a8580', worktop_wood: '#b98552', worktop_quartz: '#f1efeb' };
  const COUNTS = { drawer: [0, 20], glass: [0, 12] };

  let pricing = null;
  const state = { type: 'kitchen', dims: {}, mat: 'oak_veneer', opts: {} };

  function resetFor(type) {
    const t = TYPES[type];
    state.type = type;
    state.dims = {};
    for (const [k, v] of Object.entries(t.dims)) state.dims[k] = v[2];
    if (!t.mats.includes(state.mat)) state.mat = t.mats[Math.min(2, t.mats.length - 1)];
    state.opts = { worktop: 'worktop_laminate', island: false, drawer: type === 'kitchen' ? 4 : 2, glass: 0, led: false, handrail: true, removal: false, sanding: true };
  }

  // ---------- price ----------
  function compute() {
    const p = pricing;
    const t = state.type;
    const d = state.dims;
    const o = state.opts;
    const qty = { kitchen: d.length, wardrobe: d.width * d.height, bookcase: d.width * d.height, vanity: d.width, stairs: d.steps, parquet: d.area }[t];
    const base = qty * p.types[t] * p.materials[state.mat];
    const run = { kitchen: d.length, wardrobe: d.width, bookcase: d.width, vanity: d.width }[t] || 0;
    const has = k => TYPES[t].opts.includes(k);
    let options = 0;
    if (has('led') && o.led) options += run * p.options.led;
    if (has('drawer')) options += o.drawer * p.options.drawer;
    if (has('glass')) options += o.glass * p.options.glass;
    if (has('island') && o.island) options += p.options.island;
    if (has('worktop')) options += d.length * p.options[o.worktop];
    if (has('handrail') && o.handrail) options += p.options.handrail;
    if (has('removal') && o.removal) options += d.area * p.options.removal;
    if (has('sanding') && o.sanding) options += d.area * p.options.sanding;
    const install = (base + options) * p.installPct / 100;
    const total = base + options + install;
    const r50 = n => Math.round(n / 50) * 50;
    return { base, options, install, min: r50(total * (1 - p.margin / 100)), max: r50(total * (1 + p.margin / 100)) };
  }

  const money = n => new Intl.NumberFormat({ fr: 'fr-BE', nl: 'nl-BE', en: 'en-IE' }[App.lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const num = (n, digits = 2) => new Intl.NumberFormat({ fr: 'fr-BE', nl: 'nl-BE', en: 'en-IE' }[App.lang], { maximumFractionDigits: digits }).format(n);
  const unit = k => (k === 'steps' ? '' : k === 'area' ? ' m²' : ' m');

  function summary() {
    const t = state.type;
    const parts = [App.t('est.type.' + t)];
    for (const [k, v] of Object.entries(state.dims)) parts.push(`${App.t('est.dim.' + k)} ${num(v)}${unit(k)}`);
    parts.push(App.t('est.mat.' + state.mat));
    const o = state.opts;
    for (const k of TYPES[t].opts) {
      if (k === 'worktop') parts.push(`${App.t('est.opt.worktop')}: ${App.t('est.opt.' + o.worktop)}`);
      else if (COUNTS[k]) { if (o[k]) parts.push(`${App.t('est.opt.' + k)}: ${o[k]}`); }
      else if (o[k]) parts.push(App.t('est.opt.' + k));
    }
    return parts.join(' · ');
  }

  // ---------- controls ----------
  function renderControls() {
    const t = TYPES[state.type];
    document.getElementById('types').innerHTML = Object.keys(TYPES).map(k => `
      <button type="button" class="type-btn" data-type="${k}" aria-pressed="${k === state.type}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>
        <span>${App.esc(App.t('est.type.' + k))}</span>
      </button>`).join('');

    document.getElementById('dims').innerHTML = Object.entries(t.dims).map(([k, [min, max, , step]]) => `
      <label class="range">
        <span class="range-head"><span>${App.esc(App.t('est.dim.' + k))}</span><output id="out-${k}">${num(state.dims[k])}${unit(k)}</output></span>
        <input type="range" data-dim="${k}" min="${min}" max="${max}" step="${step}" value="${state.dims[k]}">
      </label>`).join('');

    document.getElementById('materials').innerHTML = t.mats.map(m => `
      <button type="button" class="swatch" data-mat="${m}" aria-pressed="${m === state.mat}">
        <span class="chip-color" style="background:${surface(m)}"></span><span>${App.esc(App.t('est.mat.' + m))}</span>
      </button>`).join('');

    document.getElementById('options').innerHTML = t.opts.map(k => {
      if (k === 'worktop') {
        return `<div class="opt-row"><span>${App.esc(App.t('est.opt.worktop'))}</span>
          <select data-opt="worktop">${Object.keys(WORKTOPS).map(w => `<option value="${w}" ${state.opts.worktop === w ? 'selected' : ''}>${App.esc(App.t('est.opt.' + w))}</option>`).join('')}</select></div>`;
      }
      if (COUNTS[k]) {
        return `<div class="opt-row"><span>${App.esc(App.t('est.opt.' + k))}</span>
          <span class="stepper"><button type="button" data-step="${k}" data-delta="-1" aria-label="−">−</button><output>${state.opts[k]}</output><button type="button" data-step="${k}" data-delta="1" aria-label="+">+</button></span></div>`;
      }
      return `<label class="opt-row check-row"><span>${App.esc(App.t('est.opt.' + k))}</span><input type="checkbox" data-opt="${k}" ${state.opts[k] ? 'checked' : ''}></label>`;
    }).join('');
  }

  function update() {
    if (!pricing) return;
    const r = compute();
    document.getElementById('price').innerHTML = `<small>${App.esc(App.t('est.between'))}</small> ${money(r.min)} <small>${App.esc(App.t('est.and'))}</small> ${money(r.max)}`;
    document.getElementById('breakdown').innerHTML = [['est.base', r.base], ['est.options', r.options], ['est.install', r.install]]
      .filter(([, v]) => v > 0).map(([k, v]) => `<dt>${App.esc(App.t(k))}</dt><dd>≈ ${money(v)}</dd>`).join('');
    document.getElementById('summary').textContent = summary();
    document.getElementById('price-small').textContent = `${money(r.min)} – ${money(r.max)}`;
    draw();
  }

  function bindControls() {
    const panel = document.querySelector('.est-panel');
    panel.addEventListener('click', e => {
      const typeBtn = e.target.closest('[data-type]');
      const matBtn = e.target.closest('[data-mat]');
      const stepBtn = e.target.closest('[data-step]');
      if (typeBtn) { resetFor(typeBtn.dataset.type); renderControls(); update(); }
      if (matBtn) { state.mat = matBtn.dataset.mat; renderControls(); update(); }
      if (stepBtn) {
        const k = stepBtn.dataset.step;
        const [min, max] = COUNTS[k];
        state.opts[k] = Math.min(max, Math.max(min, state.opts[k] + Number(stepBtn.dataset.delta)));
        stepBtn.parentElement.querySelector('output').textContent = state.opts[k];
        update();
      }
    });
    panel.addEventListener('input', e => {
      const dim = e.target.dataset.dim;
      if (dim) {
        state.dims[dim] = Number(e.target.value);
        document.getElementById('out-' + dim).textContent = num(state.dims[dim]) + unit(dim);
        update();
      }
    });
    panel.addEventListener('change', e => {
      const k = e.target.dataset.opt;
      if (!k) return;
      state.opts[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      update();
    });
    document.getElementById('to-quote').addEventListener('click', () => {
      const msg = document.getElementById('q-msg');
      if (!msg.value.trim()) msg.value = summary();
      document.getElementById('q-service').value = state.type;
    });
  }

  // ---------- 3D (CSS transforms) ----------
  const scene = () => document.getElementById('scene');
  let S = 100; // pixels per metre

  function surface(mat, angle = 90) {
    const [color, grain] = WOOD[mat] || [mat, false];
    return grain
      ? `repeating-linear-gradient(${angle}deg, rgba(0,0,0,.05) 0 2px, transparent 2px 9px, rgba(255,255,255,.06) 9px 11px, transparent 11px 17px), ${color}`
      : color;
  }

  // A box with its bottom-centre at (x, y, z) in metres; faces get light/shade like a lit object.
  function box({ w, h, d, x = 0, y = 0, z = 0, bg, front = '', top = null, rx = 0, cls = '' }) {
    const el = document.createElement('div');
    el.className = 'b3 ' + cls;
    el.style.transform = `translate3d(${x * S}px, ${-(y + h / 2) * S}px, ${z * S}px) rotateX(${rx}deg)`;
    const W = w * S, H = h * S, D = d * S;
    const faces = [
      ['front', W, H, `translateZ(${D / 2}px)`, 1],
      ['back', W, H, `rotateY(180deg) translateZ(${D / 2}px)`, 0.8],
      ['right', D, H, `rotateY(90deg) translateZ(${W / 2}px)`, 0.82],
      ['left', D, H, `rotateY(-90deg) translateZ(${W / 2}px)`, 0.9],
      ['top', W, D, `rotateX(90deg) translateZ(${H / 2}px)`, 1.08],
      ['bottom', W, D, `rotateX(-90deg) translateZ(${H / 2}px)`, 0.6]
    ];
    el.innerHTML = faces.map(([name, fw, fh, tf, light]) => `
      <div class="f f-${name}" style="width:${fw}px;height:${fh}px;margin:${-fh / 2}px 0 0 ${-fw / 2}px;transform:${tf};background:${name === 'top' && top ? top : bg};filter:brightness(${light})">${name === 'front' ? front : ''}</div>`).join('');
    scene().appendChild(el);
    return el;
  }

  // Door / drawer layout drawn on a cabinet front.
  function fronts({ width, doors, drawers = 0, glass = 0, shelves = false }) {
    const n = Math.max(1, doors || Math.round(width / 0.5));
    let drawersLeft = drawers;
    const cols = [];
    for (let i = 0; i < n; i++) {
      const isGlass = i >= n - glass;
      const dr = Math.min(3, drawersLeft, isGlass ? 0 : 3);
      drawersLeft -= dr;
      const top = shelves && !isGlass ? '<div class="shelves"></div>' : `<div class="door ${isGlass ? 'glass' : ''}"><i></i></div>`;
      cols.push(`<div class="col">${top}${Array.from({ length: dr }, () => '<div class="drawer"><i></i></div>').join('')}</div>`);
    }
    return `<div class="fronts" style="grid-template-columns:repeat(${n},1fr)">${cols.join('')}</div>`;
  }

  function draw() {
    const el = scene();
    el.innerHTML = '';
    const t = state.type;
    const d = state.dims;
    const o = state.opts;
    const bg = surface(state.mat);
    const led = o.led ? '<span class="led"></span>' : '';
    let size = 2;
    let label = '';

    if (t === 'kitchen') {
      const L = d.length;
      size = Math.max(L, 2.6) * 1.05;
      S = 260 / size;
      const z0 = o.island ? -0.5 : 0;
      box({ w: L + 0.4, h: 2.4, d: 0.03, z: z0 - 0.32, bg: '#efe9df' });
      box({ w: L, h: 0.86, d: 0.6, z: z0, bg, front: fronts({ width: L, doors: Math.round(L / 0.6), drawers: o.drawer }) });
      box({ w: L + 0.02, h: 0.04, d: 0.64, y: 0.86, z: z0, bg: WORKTOPS[o.worktop] });
      box({ w: L, h: 0.7, d: 0.35, y: 1.45, z: z0 - 0.125, bg, front: fronts({ width: L, doors: Math.round(L / 0.6), glass: o.glass }) + led });
      if (o.island) {
        box({ w: Math.min(2, L * 0.6), h: 0.86, d: 0.9, z: 0.9, bg, front: fronts({ width: 1.8, doors: 3 }) });
        box({ w: Math.min(2, L * 0.6) + 0.04, h: 0.04, d: 0.94, y: 0.86, z: 0.9, bg: WORKTOPS[o.worktop] });
      }
      label = `${num(L)} m`;
    } else if (t === 'wardrobe' || t === 'bookcase') {
      const W = d.width, H = d.height, D = t === 'wardrobe' ? 0.6 : 0.4;
      size = Math.max(W, H) * 1.1;
      S = 260 / size;
      box({ w: W, h: H, d: D, bg, front: fronts({ width: W, drawers: o.drawer, glass: o.glass, shelves: t === 'bookcase' }) + led });
      label = `${num(W)} × ${num(H)} m`;
    } else if (t === 'vanity') {
      const W = d.width;
      size = 2;
      S = 260 / size;
      box({ w: W, h: 0.5, d: 0.48, y: 0.35, bg, front: fronts({ width: W, doors: Math.max(1, Math.round(W / 0.6)), drawers: o.drawer }) + led });
      box({ w: W + 0.02, h: 0.03, d: 0.5, y: 0.85, bg: '#f4f2ee' });
      box({ w: Math.min(W * 0.8, 1.2), h: 0.7, d: 0.02, y: 1.05, z: -0.24, bg: 'linear-gradient(135deg,#e4eef2,#9fb4bd)' });
      label = `${num(W)} m`;
    } else if (t === 'stairs') {
      const n = d.steps, rise = 0.18, run = 0.25, W = 0.9;
      size = Math.max(n * rise, n * run) * 1.1;
      S = 260 / size;
      for (let i = 0; i < n; i++) {
        box({ w: W, h: rise * (i + 1), d: run, z: (n / 2 - i - 0.5) * run, bg: 'linear-gradient(#e9e4dc,#e9e4dc)', top: bg });
      }
      if (o.handrail) {
        // Rail runs from the bottom post to the top post, 0.9 m above the treads.
        const len = Math.hypot((n - 1) * run, (n - 1) * rise);
        const angle = Math.atan2(rise, run) * 180 / Math.PI;
        box({ w: 0.05, h: 0.05, d: len, x: W / 2 - 0.03, y: (n + 1) * rise / 2 + 0.85, z: 0, rx: -angle, bg });
        box({ w: 0.04, h: 0.9, d: 0.04, x: W / 2 - 0.03, y: rise, z: (n / 2 - 0.5) * run, bg });
        box({ w: 0.04, h: 0.9, d: 0.04, x: W / 2 - 0.03, y: n * rise, z: (-n / 2 + 0.5) * run, bg });
      }
      label = `${n} × ${num(rise * 100, 0)} cm`;
    } else if (t === 'parquet') {
      const side = Math.sqrt(d.area);
      size = 2.6;
      S = 260 / size;
      const floor = WOOD[state.mat][0];
      const pattern = state.mat === 'laminate'
        ? `repeating-linear-gradient(90deg, rgba(0,0,0,.12) 0 1px, transparent 1px 22px), repeating-linear-gradient(0deg, rgba(0,0,0,.08) 0 1px, transparent 1px 90px), ${floor}`
        : `repeating-linear-gradient(45deg, rgba(0,0,0,.10) 0 1px, transparent 1px 16px), repeating-linear-gradient(-45deg, rgba(0,0,0,.10) 0 1px, transparent 1px 48px), ${floor}`;
      box({ w: 2.2, h: 0.03, d: 2.2, bg: floor, top: pattern });
      box({ w: 2.2, h: 1.2, d: 0.04, z: -1.12, bg: '#efe9df' });
      label = `${num(d.area, 0)} m² (≈ ${num(side, 1)} × ${num(side, 1)} m)`;
    }
    document.getElementById('dim-label').textContent = label;
    el.style.setProperty('--lift', `${(t === 'parquet' ? 0.3 : size / 2.4) * S}px`);
  }

  // Drag (or swipe) to rotate; slow auto-rotation until the visitor interacts.
  let angle = -28;
  let auto = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function spin() {
    scene().style.transform = `translateY(var(--lift)) rotateX(-18deg) rotateY(${angle}deg)`;
  }
  function bindRotation() {
    const viewer = document.getElementById('viewer');
    let startX = null;
    let startAngle = 0;
    viewer.addEventListener('pointerdown', e => { startX = e.clientX; startAngle = angle; auto = false; viewer.setPointerCapture(e.pointerId); });
    viewer.addEventListener('pointermove', e => { if (startX !== null) { angle = startAngle + (e.clientX - startX) * 0.5; spin(); } });
    const end = () => { startX = null; };
    viewer.addEventListener('pointerup', end);
    viewer.addEventListener('pointercancel', end);
    let t0 = performance.now();
    (function loop(now) {
      if (auto) { angle += (now - t0) * 0.012; spin(); }
      t0 = now;
      requestAnimationFrame(loop);
    })(t0);
    spin();
  }

  window.Estimator = {
    current() {
      if (!pricing) return null;
      const r = compute();
      return { summary: summary(), min: r.min, max: r.max };
    }
  };

  App.onLang(() => {
    document.title = `${App.t('est.kicker')} — ${App.settings ? App.settings.companyName : 'Timberway'}`;
    if (pricing) { renderControls(); update(); }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const wanted = new URLSearchParams(location.search).get('type');
    resetFor(TYPES[wanted] ? wanted : 'kitchen');
    pricing = await fetch('/api/pricing').then(r => r.json());
    renderControls();
    bindControls();
    bindRotation();
    update();
  });
})();
