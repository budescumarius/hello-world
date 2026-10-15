// Estimator model shared by the browser (window.EstimateModel) and the server (require):
// project types, limits, price calculation and a text summary of a configuration.
(function (root) {
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
  const COUNTS = { drawer: [0, 20], glass: [0, 12] };
  const WORKTOPS = { worktop_laminate: '#8a8580', worktop_wood: '#b98552', worktop_quartz: '#f1efeb' };
  // [colour, has wood grain]
  const WOOD = {
    melamine: ['#f3f1ec', false], lacquer: ['#e7e2da', false], oak_veneer: ['#d4b083', true], walnut_veneer: ['#7b5236', true],
    solid_oak: ['#c79c66', true], beech: ['#e2c49c', true], stairs_oak: ['#c79c66', true],
    laminate: ['#cdb595', true], engineered_oak: ['#d2ab7b', true], solid_oak_floor: ['#c49862', true]
  };

  function defaults(type, previousMat) {
    const t = TYPES[type];
    const dims = {};
    for (const [k, v] of Object.entries(t.dims)) dims[k] = v[2];
    return {
      type,
      dims,
      mat: t.mats.includes(previousMat) ? previousMat : t.mats[Math.min(2, t.mats.length - 1)],
      opts: { worktop: 'worktop_laminate', island: false, drawer: type === 'kitchen' ? 4 : 2, glass: 0, led: false, handrail: true, removal: false, sanding: true }
    };
  }

  // Bring any (possibly hand-crafted) configuration back within the allowed values.
  function sanitize(input) {
    const src = input && typeof input === 'object' ? input : {};
    const type = TYPES[src.type] ? src.type : 'kitchen';
    const out = defaults(type, src.mat);
    for (const [k, [min, max]] of Object.entries(TYPES[type].dims)) {
      const n = Number(src.dims && src.dims[k]);
      if (Number.isFinite(n)) out.dims[k] = Math.min(max, Math.max(min, n));
    }
    if (type === 'stairs') out.dims.steps = Math.round(out.dims.steps);
    const o = src.opts || {};
    for (const k of ['island', 'led', 'handrail', 'removal', 'sanding']) if (k in o) out.opts[k] = Boolean(o[k]);
    for (const [k, [min, max]] of Object.entries(COUNTS)) {
      const n = Math.round(Number(o[k]));
      if (Number.isFinite(n)) out.opts[k] = Math.min(max, Math.max(min, n));
    }
    if (WORKTOPS[o.worktop]) out.opts.worktop = o.worktop;
    return out;
  }

  function compute(state, p) {
    const t = state.type;
    const d = state.dims;
    const o = state.opts;
    const qty = { kitchen: d.length, wardrobe: d.width * d.height, bookcase: d.width * d.height, vanity: d.width, stairs: d.steps, parquet: d.area }[t];
    const base = qty * p.types[t] * p.materials[state.mat];
    const run = { kitchen: d.length, wardrobe: d.width, bookcase: d.width, vanity: d.width }[t] || 0;
    const has = k => TYPES[t].opts.includes(k);
    const lines = [];
    const add = (key, amount, qtyLabel) => { if (amount > 0) lines.push({ key, amount, qty: qtyLabel }); };
    if (has('worktop')) add(o.worktop, d.length * p.options[o.worktop], d.length);
    if (has('island') && o.island) add('island', p.options.island);
    if (has('drawer')) add('drawer', o.drawer * p.options.drawer, o.drawer);
    if (has('glass')) add('glass', o.glass * p.options.glass, o.glass);
    if (has('led') && o.led) add('led', run * p.options.led, run);
    if (has('handrail') && o.handrail) add('handrail', p.options.handrail);
    if (has('removal') && o.removal) add('removal', d.area * p.options.removal, d.area);
    if (has('sanding') && o.sanding) add('sanding', d.area * p.options.sanding, d.area);
    const options = lines.reduce((s, l) => s + l.amount, 0);
    const install = (base + options) * p.installPct / 100;
    const total = base + options + install;
    const r50 = n => Math.round(n / 50) * 50;
    return { qty, base, options, lines, install, total, min: r50(total * (1 - p.margin / 100)), max: r50(total * (1 + p.margin / 100)) };
  }

  // Human-readable one-liner; t(key) translates, num(n) formats numbers.
  function summary(state, t, num) {
    const unit = k => (k === 'steps' ? '' : k === 'area' ? ' m²' : ' m');
    const parts = [t('est.type.' + state.type)];
    for (const [k, v] of Object.entries(state.dims)) parts.push(`${t('est.dim.' + k)} ${num(v)}${unit(k)}`);
    parts.push(t('est.mat.' + state.mat));
    const o = state.opts;
    for (const k of TYPES[state.type].opts) {
      if (k === 'worktop') parts.push(`${t('est.opt.worktop')}: ${t('est.opt.' + o.worktop)}`);
      else if (COUNTS[k]) { if (o[k]) parts.push(`${t('est.opt.' + k)}: ${o[k]}`); }
      else if (o[k]) parts.push(t('est.opt.' + k));
    }
    return parts.join(' · ');
  }

  const M = { TYPES, COUNTS, WORKTOPS, WOOD, defaults, sanitize, compute, summary };
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.EstimateModel = M;
})(this);
