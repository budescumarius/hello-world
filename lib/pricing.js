// Catalogue and price grid for the online budget estimator. Everything here is editable in the
// admin ("Prețuri" tab): base prices, materials, kitchen worktops and options/accessories.
// Prices are in euro excl. VAT.
const PROJECT_TYPES = ['kitchen', 'wardrobe', 'bookcase', 'vanity', 'stairs', 'parquet'];
const FURNITURE = ['kitchen', 'wardrobe', 'bookcase', 'vanity'];
const UNITS = ['fixed', 'per_m', 'per_m2', 'per_step', 'per_piece'];
const EFFECTS = ['', 'led', 'drawer', 'glass', 'island', 'handrail'];
const n3 = (fr, nl, en) => ({ fr, nl, en });

const DEFAULT_PRICING = {
  margin: 15,      // ± % shown as a range around the computed price
  installPct: 10,  // installation, as % of manufacturing + options
  types: {         // base price: kitchen & vanity per linear metre, wardrobe & bookcase per m² of front, stairs per step, parquet per m²
    kitchen: 1100, wardrobe: 600, bookcase: 520, vanity: 850, stairs: 320, parquet: 45
  },
  materials: [
    { id: 'melamine', name: n3('Mélaminé blanc', 'Witte melamine', 'White melamine'), color: '#f3f1ec', grain: false, mult: 0.8, types: FURNITURE },
    { id: 'lacquer', name: n3('MDF laqué', 'Gelakte MDF', 'Lacquered MDF'), color: '#e7e2da', grain: false, mult: 1, types: FURNITURE },
    { id: 'oak_veneer', name: n3('Placage chêne', 'Eikenfineer', 'Oak veneer'), color: '#d4b083', grain: true, mult: 1.25, types: FURNITURE },
    { id: 'walnut_veneer', name: n3('Placage noyer', 'Notelaarfineer', 'Walnut veneer'), color: '#7b5236', grain: true, mult: 1.45, types: FURNITURE },
    { id: 'solid_oak', name: n3('Chêne massif', 'Massief eiken', 'Solid oak'), color: '#c79c66', grain: true, mult: 1.6, types: FURNITURE },
    { id: 'beech', name: n3('Hêtre', 'Beuken', 'Beech'), color: '#e2c49c', grain: true, mult: 0.9, types: ['stairs'] },
    { id: 'stairs_oak', name: n3('Chêne massif', 'Massief eiken', 'Solid oak'), color: '#c79c66', grain: true, mult: 1.3, types: ['stairs'] },
    { id: 'laminate', name: n3('Stratifié', 'Laminaat', 'Laminate'), color: '#cdb595', grain: true, mult: 0.7, types: ['parquet'] },
    { id: 'engineered_oak', name: n3('Chêne contrecollé', 'Eiken meerlagenparket', 'Engineered oak'), color: '#d2ab7b', grain: true, mult: 1.4, types: ['parquet'] },
    { id: 'solid_oak_floor', name: n3('Chêne massif', 'Massief eiken', 'Solid oak'), color: '#c49862', grain: true, mult: 2, types: ['parquet'] }
  ],
  worktops: [
    { id: 'worktop_laminate', name: n3('Stratifié', 'Laminaat', 'Laminate'), color: '#8a8580', price: 160 },
    { id: 'worktop_wood', name: n3('Bois massif', 'Massief hout', 'Solid wood'), color: '#b98552', price: 380 },
    { id: 'worktop_quartz', name: n3('Quartz', 'Kwarts', 'Quartz'), color: '#f1efeb', price: 600 }
  ],
  // kind: 'check' (on/off) or 'count' (visitor picks a quantity, priced per piece)
  options: [
    { id: 'island', name: n3('Îlot central', 'Kookeiland', 'Kitchen island'), kind: 'check', unit: 'fixed', price: 2200, types: ['kitchen'], effect: 'island', on: false },
    { id: 'drawer', name: n3('Tiroirs', 'Lades', 'Drawers'), kind: 'count', unit: 'per_piece', price: 140, types: FURNITURE, effect: 'drawer', def: 2, max: 20 },
    { id: 'glass', name: n3('Portes vitrées', 'Glazen deuren', 'Glass doors'), kind: 'count', unit: 'per_piece', price: 190, types: ['kitchen', 'wardrobe', 'bookcase'], effect: 'glass', def: 0, max: 12 },
    { id: 'led', name: n3('Éclairage LED intégré', 'Ingebouwde ledverlichting', 'Built-in LED lighting'), kind: 'check', unit: 'per_m', price: 70, types: FURNITURE, effect: 'led', on: false },
    { id: 'led_stairs', name: n3('Éclairage LED des marches', 'Ledverlichting in de treden', 'LED step lighting'), kind: 'check', unit: 'per_step', price: 45, types: ['stairs'], effect: 'led', on: false },
    { id: 'handrail', name: n3('Rampe / garde-corps', 'Leuning / balustrade', 'Handrail / balustrade'), kind: 'check', unit: 'fixed', price: 650, types: ['stairs'], effect: 'handrail', on: true },
    { id: 'removal', name: n3("Retrait de l'ancien sol", 'Oude vloer verwijderen', 'Remove old floor'), kind: 'check', unit: 'per_m2', price: 12, types: ['parquet'], effect: '', on: false },
    { id: 'sanding', name: n3('Ponçage & finition', 'Schuren & afwerking', 'Sanding & finish'), kind: 'check', unit: 'per_m2', price: 18, types: ['parquet'], effect: '', on: true }
  ]
};

// ---------- validation ----------
const num = (v, fallback, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback;
};
const text = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const color = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const slug = v => text(v, 40).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
const names = (v, fallback = {}) => {
  const out = {};
  for (const l of ['fr', 'nl', 'en']) out[l] = text(v && v[l]) || fallback[l] || '';
  if (!out.fr) out.fr = out.nl || out.en;
  return out;
};
const typeList = v => (Array.isArray(v) ? PROJECT_TYPES.filter(t => v.includes(t)) : []);
function uniqueIds(list) {
  const seen = new Set();
  return list.filter(item => {
    if (!item.id || seen.has(item.id) || !item.name.fr) return false;
    seen.add(item.id);
    return true;
  });
}

function cleanMaterial(m, fb = {}) {
  return { id: slug(m.id) || fb.id, name: names(m.name, fb.name), color: color(m.color, fb.color || '#d4b083'), grain: m.grain === undefined ? Boolean(fb.grain) : Boolean(m.grain), mult: num(m.mult, fb.mult ?? 1, 100), types: m.types ? typeList(m.types) : (fb.types || []) };
}
function cleanWorktop(w, fb = {}) {
  return { id: slug(w.id) || fb.id, name: names(w.name, fb.name), color: color(w.color, fb.color || '#8a8580'), price: num(w.price, fb.price ?? 0) };
}
function cleanOption(o, fb = {}) {
  const kind = ['check', 'count'].includes(o.kind) ? o.kind : fb.kind || 'check';
  return {
    id: slug(o.id) || fb.id,
    name: names(o.name, fb.name),
    kind,
    unit: kind === 'count' ? 'per_piece' : UNITS.includes(o.unit) && o.unit !== 'per_piece' ? o.unit : fb.unit || 'fixed',
    price: num(o.price, fb.price ?? 0),
    types: o.types ? typeList(o.types) : (fb.types || []),
    effect: EFFECTS.includes(o.effect) ? o.effect : fb.effect || '',
    on: o.on === undefined ? Boolean(fb.on) : Boolean(o.on),
    def: Math.round(num(o.def, fb.def ?? 0, 99)),
    max: Math.max(1, Math.round(num(o.max, fb.max ?? 20, 99)))
  };
}

// Older sites stored materials/options as { id: number }; keep their numbers on the default catalogue.
function fromLegacy(p) {
  const out = { ...p };
  if (p.materials && !Array.isArray(p.materials)) {
    out.materials = DEFAULT_PRICING.materials.map(m => ({ ...m, mult: p.materials[m.id] ?? m.mult }));
  }
  if (p.options && !Array.isArray(p.options)) {
    const legacy = p.options;
    out.options = DEFAULT_PRICING.options.map(o => ({ ...o, price: legacy[o.id] ?? o.price }));
    out.worktops = DEFAULT_PRICING.worktops.map(w => ({ ...w, price: legacy[w.id] ?? w.price }));
  }
  return out;
}

function cleanPricing(input, current = DEFAULT_PRICING) {
  const src = fromLegacy(input || {});
  const cur = fromLegacy(current || DEFAULT_PRICING);
  const byId = (list, id) => (list || []).find(x => x.id === id) || {};
  const out = { margin: num(src.margin, cur.margin ?? 15, 90), installPct: num(src.installPct, cur.installPct ?? 10, 100), types: {} };
  for (const t of PROJECT_TYPES) out.types[t] = num(src.types && src.types[t], (cur.types || DEFAULT_PRICING.types)[t] ?? DEFAULT_PRICING.types[t]);
  const list = (key, clean) => uniqueIds((Array.isArray(src[key]) ? src[key] : cur[key] || DEFAULT_PRICING[key]).slice(0, 60).map(x => clean(x || {}, byId(cur[key], x && x.id))));
  out.materials = list('materials', cleanMaterial);
  out.worktops = list('worktops', cleanWorktop);
  out.options = list('options', cleanOption);
  return out;
}

// Every project type needs at least one material, and the kitchen at least one worktop.
function validate(p) {
  const missing = PROJECT_TYPES.filter(t => !p.materials.some(m => m.types.includes(t)));
  if (missing.length) return `type_without_material:${missing.join(',')}`;
  if (!p.worktops.length) return 'no_worktop';
  return null;
}

function withDefaults(pricing) {
  return cleanPricing(pricing || DEFAULT_PRICING, DEFAULT_PRICING);
}

module.exports = { DEFAULT_PRICING, PROJECT_TYPES, UNITS, EFFECTS, cleanPricing, validate, withDefaults };
