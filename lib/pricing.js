// Price grid for the online budget estimator. Prices are in euro excl. VAT, installation included
// via installPct. Every number here can be changed in the admin ("Prețuri" tab).
const DEFAULT_PRICING = {
  margin: 15,      // ± % shown as a range around the computed price
  installPct: 10,  // installation, as % of manufacturing + options
  types: {
    kitchen: 1100,   // € per linear metre
    wardrobe: 600,   // € per m² of front
    bookcase: 520,   // € per m² of front
    vanity: 850,     // € per linear metre
    stairs: 320,     // € per step
    parquet: 45      // € per m² (laying), multiplied by the floor material
  },
  materials: {
    melamine: 0.8, lacquer: 1, oak_veneer: 1.25, walnut_veneer: 1.45, solid_oak: 1.6,
    beech: 0.9, stairs_oak: 1.3,
    laminate: 0.7, engineered_oak: 1.4, solid_oak_floor: 2
  },
  options: {
    led: 70,               // € per linear metre
    drawer: 140,           // € per drawer
    glass: 190,            // € per glass door
    island: 2200,          // € fixed
    worktop_laminate: 160, // € per linear metre
    worktop_wood: 380,
    worktop_quartz: 600,
    handrail: 650,         // € fixed
    removal: 12,           // € per m²
    sanding: 18            // € per m²
  }
};

// Keep the grid's shape; accept only finite, non-negative numbers for known keys.
function cleanPricing(input, current = DEFAULT_PRICING) {
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : fallback;
  };
  const out = { margin: num(input.margin, current.margin), installPct: num(input.installPct, current.installPct) };
  for (const group of ['types', 'materials', 'options']) {
    out[group] = {};
    for (const k of Object.keys(DEFAULT_PRICING[group])) {
      out[group][k] = num(input[group] && input[group][k], (current[group] || {})[k] ?? DEFAULT_PRICING[group][k]);
    }
  }
  return out;
}

function withDefaults(pricing) {
  return cleanPricing(pricing || {}, DEFAULT_PRICING);
}

module.exports = { DEFAULT_PRICING, cleanPricing, withDefaults };
