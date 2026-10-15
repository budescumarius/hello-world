// Estimator model shared by the browser (window.EstimateModel) and the server (require).
// Materials, worktops and options come from the admin's catalogue (`pricing`), so new ones
// appear automatically; this file only knows the project types and their dimensions.
(function (root) {
  // dims: [min, max, default, step]
  const TYPES = {
    kitchen: { dims: { length: [1.5, 8, 3.6, 0.1] } },
    wardrobe: { dims: { width: [0.6, 6, 2.4, 0.1], height: [1.8, 3, 2.5, 0.05] } },
    bookcase: { dims: { width: [0.8, 6, 3, 0.1], height: [1, 3, 2.2, 0.05] } },
    vanity: { dims: { width: [0.6, 2.4, 1.2, 0.05] } },
    stairs: { dims: { steps: [6, 20, 14, 1] } },
    parquet: { dims: { area: [5, 200, 30, 1] } }
  };
  const RISE = 0.18; // stair step height, m
  const RUN = 0.25;  // stair step depth, m

  const pick = (names, lang) => (names && (names[lang] || names.fr || names.nl || names.en)) || '';
  const materialsFor = (type, p) => p.materials.filter(m => m.types.includes(type));
  const optionsFor = (type, p) => p.options.filter(o => o.types.includes(type));
  const material = (state, p) => p.materials.find(m => m.id === state.mat) || materialsFor(state.type, p)[0] || { mult: 1, color: '#d4b083', grain: true, name: {} };
  const worktop = (state, p) => p.worktops.find(w => w.id === state.opts.worktop) || p.worktops[0];

  function defaults(type, p, previousMat) {
    const dims = {};
    for (const [k, v] of Object.entries(TYPES[type].dims)) dims[k] = v[2];
    const mats = materialsFor(type, p);
    const preferred = mats.find(m => m.id === previousMat) || mats.find(m => m.id === 'oak_veneer') || mats[Math.min(1, mats.length - 1)] || mats[0];
    const opts = { worktop: p.worktops[0] ? p.worktops[0].id : '' };
    for (const o of optionsFor(type, p)) opts[o.id] = o.kind === 'count' ? Math.min(o.def, o.max) : o.on;
    if (type === 'kitchen' && opts.drawer !== undefined) opts.drawer = Math.max(opts.drawer, 4);
    return { type, dims, mat: preferred ? preferred.id : '', opts };
  }

  // Bring any (possibly hand-crafted) configuration back within the allowed values.
  function sanitize(input, p) {
    const src = input && typeof input === 'object' ? input : {};
    const type = TYPES[src.type] ? src.type : 'kitchen';
    const out = defaults(type, p, src.mat);
    for (const [k, [min, max]] of Object.entries(TYPES[type].dims)) {
      const n = Number(src.dims && src.dims[k]);
      if (Number.isFinite(n)) out.dims[k] = Math.min(max, Math.max(min, n));
    }
    if (type === 'stairs') out.dims.steps = Math.round(out.dims.steps);
    const o = src.opts || {};
    for (const opt of optionsFor(type, p)) {
      if (!(opt.id in o)) continue;
      if (opt.kind === 'count') {
        const n = Math.round(Number(o[opt.id]));
        if (Number.isFinite(n)) out.opts[opt.id] = Math.min(opt.max, Math.max(0, n));
      } else out.opts[opt.id] = Boolean(o[opt.id]);
    }
    if (p.worktops.some(w => w.id === o.worktop)) out.opts.worktop = o.worktop;
    return out;
  }

  // Quantities an option's unit refers to, per project type.
  function measures(state) {
    const d = state.dims;
    switch (state.type) {
      case 'kitchen': return { length: d.length, area: d.length * 2.15, steps: 0 };
      case 'wardrobe': case 'bookcase': return { length: d.width, area: d.width * d.height, steps: 0 };
      case 'vanity': return { length: d.width, area: d.width * 0.5, steps: 0 };
      case 'stairs': return { length: d.steps * RUN, area: d.steps * RUN * 0.9, steps: d.steps };
      default: return { length: Math.sqrt(d.area) * 4, area: d.area, steps: 0 };
    }
  }

  function compute(state, p) {
    const t = state.type;
    const d = state.dims;
    const qty = { kitchen: d.length, wardrobe: d.width * d.height, bookcase: d.width * d.height, vanity: d.width, stairs: d.steps, parquet: d.area }[t];
    const base = qty * p.types[t] * material(state, p).mult;
    const m = measures(state);
    const lines = [];
    if (t === 'kitchen' && worktop(state, p)) {
      const w = worktop(state, p);
      lines.push({ id: w.id, name: w.name, amount: d.length * w.price, qty: d.length, worktop: true });
    }
    for (const o of optionsFor(t, p)) {
      const v = state.opts[o.id];
      if (!v) continue;
      const factor = o.kind === 'count' ? v : { fixed: 1, per_m: m.length, per_m2: m.area, per_step: m.steps }[o.unit] ?? 1;
      if (factor > 0) lines.push({ id: o.id, name: o.name, amount: factor * o.price, qty: o.kind === 'count' ? v : null });
    }
    const options = lines.reduce((s, l) => s + l.amount, 0);
    const install = (base + options) * p.installPct / 100;
    const total = base + options + install;
    const r50 = n => Math.round(n / 50) * 50;
    return { qty, base, options, lines, install, total, min: r50(total * (1 - p.margin / 100)), max: r50(total * (1 + p.margin / 100)) };
  }

  // What the 3D view and the PDF sketch should show, from the options' "effect".
  function effects(state, p) {
    const out = { led: false, drawer: 0, glass: 0, island: false, handrail: false };
    for (const o of optionsFor(state.type, p)) {
      const v = state.opts[o.id];
      if (!o.effect || !v) continue;
      if (o.effect === 'drawer' || o.effect === 'glass') out[o.effect] += o.kind === 'count' ? v : 1;
      else out[o.effect] = true;
    }
    return out;
  }

  // Human-readable one-liner; t(key) translates, num(n) formats numbers.
  function summary(state, p, t, num, lang) {
    const unit = k => (k === 'steps' ? '' : k === 'area' ? ' m²' : ' m');
    const parts = [t('est.type.' + state.type)];
    for (const [k, v] of Object.entries(state.dims)) parts.push(`${t('est.dim.' + k)} ${num(v)}${unit(k)}`);
    parts.push(pick(material(state, p).name, lang));
    if (state.type === 'kitchen' && worktop(state, p)) parts.push(`${t('est.opt.worktop')}: ${pick(worktop(state, p).name, lang)}`);
    for (const o of optionsFor(state.type, p)) {
      const v = state.opts[o.id];
      if (!v) continue;
      parts.push(o.kind === 'count' ? `${pick(o.name, lang)}: ${v}` : pick(o.name, lang));
    }
    return parts.join(' · ');
  }

  const M = { TYPES, RISE, RUN, pick, materialsFor, optionsFor, material, worktop, defaults, sanitize, compute, effects, summary };
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.EstimateModel = M;
})(this);
