// Builds the branded "indicative estimate" PDF: header, dimensioned sketch, configuration and price.
const { Pdf } = require('./pdf');
const M = require('../public/js/estimate-model');

const C = { ink: '#1f1a16', muted: '#6b6158', line: '#e7ddd0', brown: '#8d6442', dark: '#2b1d12', sand: '#e2c49d', paper: '#faf7f2', grey: '#373737', glass: '#d6e6ee', led: '#f2c94c' };

function header(pdf, settings, tr) {
  const top = 800;
  // Logo mark: the Timberway open frame.
  const frame = [[40, top + 6], [92, top + 6], [80, top - 18], [52, top - 18]];
  pdf.poly([frame[3], frame[0], frame[1], frame[2]], { stroke: C.grey, lineWidth: 4.2 }, false);
  pdf.poly([frame[3], frame[0], frame[1], frame[2]], { stroke: C.brown, lineWidth: 2.6 }, false);
  pdf.text('TIMBERWAY', 102, top - 4, { size: 17, bold: true, color: C.grey });
  const tagline = settings.tagline && (settings.tagline[tr.lang] || settings.tagline.fr);
  if (tagline) pdf.text(tagline, 102, top - 17, { size: 8, color: C.muted });
  const contact = [settings.phone, settings.email, settings.address].filter(Boolean);
  contact.forEach((line, i) => pdf.text(line, 555, top + 2 - i * 11, { size: 8.5, color: C.muted, align: 'right' }));
  pdf.line(40, 762, 555, 762, { color: C.brown, width: 1.2 });
}

// Dimension line with end ticks and a centred label (horizontal or vertical).
function dimH(pdf, x1, x2, y, label) {
  pdf.line(x1, y, x2, y, { color: C.muted, width: 0.6 });
  [x1, x2].forEach(x => pdf.line(x, y - 4, x, y + 4, { color: C.muted, width: 0.6 }));
  pdf.rect((x1 + x2) / 2 - pdf.textWidth(label, 8.5) / 2 - 3, y - 5, pdf.textWidth(label, 8.5) + 6, 10, { fill: C.paper });
  pdf.text(label, (x1 + x2) / 2, y - 3, { size: 8.5, color: C.ink, align: 'center' });
}
function dimV(pdf, x, y1, y2, label) {
  pdf.line(x, y1, x, y2, { color: C.muted, width: 0.6 });
  [y1, y2].forEach(y => pdf.line(x - 4, y, x + 4, y, { color: C.muted, width: 0.6 }));
  const w = pdf.textWidth(label, 8.5);
  pdf.rect(x - 5, (y1 + y2) / 2 - w / 2 - 3, 10, w + 6, { fill: C.paper });
  pdf.text(label, x + 3, (y1 + y2) / 2, { size: 8.5, color: C.ink, align: 'center', rotate: 90 });
}

// A row of cabinet fronts: doors, drawers (bottom, max 3 per column), glass doors, open shelves.
function fronts(pdf, x, y, w, h, { s, cols, drawers = 0, glass = 0, shelves = false, color }) {
  const cw = w / cols;
  let left = drawers;
  for (let i = 0; i < cols; i++) {
    const cx = x + i * cw;
    const isGlass = i >= cols - glass;
    const dr = isGlass ? 0 : Math.min(3, left);
    left -= dr;
    const dh = Math.min(0.2 * s, h / 4);
    for (let k = 0; k < dr; k++) {
      pdf.rect(cx + 1.5, y + 1.5 + k * dh, cw - 3, dh - 1.5, { fill: color, stroke: C.grey, lineWidth: 0.5 });
      pdf.line(cx + cw / 2 - 5, y + k * dh + dh / 2 + 1, cx + cw / 2 + 5, y + k * dh + dh / 2 + 1, { color: C.grey, width: 1 });
    }
    const dy = y + 1.5 + dr * dh;
    const doorH = h - 3 - dr * dh;
    if (doorH <= 2) continue;
    if (shelves && !isGlass) {
      pdf.rect(cx + 1.5, dy, cw - 3, doorH, { fill: '#efe7dc', stroke: C.grey, lineWidth: 0.5 });
      for (let sy = dy + 0.35 * s; sy < dy + doorH - 4; sy += 0.35 * s) pdf.line(cx + 1.5, sy, cx + cw - 1.5, sy, { color: C.grey, width: 0.7 });
    } else {
      pdf.rect(cx + 1.5, dy, cw - 3, doorH, { fill: isGlass ? C.glass : color, stroke: C.grey, lineWidth: 0.5 });
      const hx = i % 2 ? cx + 6 : cx + cw - 6;
      pdf.line(hx, dy + doorH / 2 - 8, hx, dy + doorH / 2 + 8, { color: C.grey, width: 1.1 });
    }
  }
}

function sketch(pdf, cfg, tr, box, pricing) {
  const { t, num } = tr;
  const d = cfg.dims;
  const o = M.effects(cfg, pricing);
  const mat = M.material(cfg, pricing);
  const color = mat.color;
  const area = { x: box.x + 45, y: box.y + 32, w: box.w - 90, h: box.h - 78 };
  let view = 'pdf.front';

  if (cfg.type === 'wardrobe' || cfg.type === 'bookcase') {
    const s = Math.min(area.w / d.width, area.h / d.height);
    const w = d.width * s, h = d.height * s;
    const x = area.x + (area.w - w) / 2, y = area.y;
    pdf.rect(x, y, w, h, { fill: color, stroke: C.grey, lineWidth: 1 });
    fronts(pdf, x + 3, y + 3, w - 6, h - 6, { s, cols: Math.max(1, Math.round(d.width / 0.5)), drawers: o.drawer, glass: o.glass, shelves: cfg.type === 'bookcase', color });
    if (o.led) pdf.line(x + 6, y + h - 6, x + w - 6, y + h - 6, { color: C.led, width: 2.2 });
    dimH(pdf, x, x + w, y - 14, `${num(d.width)} m`);
    dimV(pdf, x - 16, y, y + h, `${num(d.height)} m`);
  } else if (cfg.type === 'kitchen') {
    const L = d.length;
    const islandW = o.island ? Math.min(2, L * 0.6) : 0;
    const totalW = L + (o.island ? islandW + 0.6 : 0);
    const s = Math.min(area.w / totalW, area.h / 2.2);
    const x = area.x + (area.w - totalW * s) / 2, y = area.y;
    const cols = Math.max(1, Math.round(L / 0.6));
    const worktop = (M.worktop(cfg, pricing) || { color: '#8a8580' }).color;
    pdf.rect(x, y, L * s, 0.1 * s, { fill: C.grey });
    pdf.rect(x, y + 0.1 * s, L * s, 0.76 * s, { fill: color, stroke: C.grey, lineWidth: 1 });
    fronts(pdf, x + 2, y + 0.1 * s + 2, L * s - 4, 0.76 * s - 4, { s, cols, drawers: o.drawer, color });
    pdf.rect(x - 2, y + 0.86 * s, L * s + 4, Math.max(2.5, 0.04 * s), { fill: worktop, stroke: C.grey, lineWidth: 0.6 });
    pdf.rect(x, y + 1.45 * s, L * s, 0.7 * s, { fill: color, stroke: C.grey, lineWidth: 1 });
    fronts(pdf, x + 2, y + 1.45 * s + 2, L * s - 4, 0.7 * s - 4, { s, cols, glass: o.glass, color });
    if (o.led) pdf.line(x + 4, y + 1.45 * s - 1.5, x + L * s - 4, y + 1.45 * s - 1.5, { color: C.led, width: 2.2 });
    dimH(pdf, x, x + L * s, y - 14, `${num(L)} m`);
    dimV(pdf, x - 16, y, y + 0.9 * s, '0,90 m');
    dimV(pdf, x - 34, y, y + 2.15 * s, '2,15 m');
    if (o.island) {
      const ix = x + (L + 0.6) * s;
      pdf.rect(ix, y, islandW * s, 0.1 * s, { fill: C.grey });
      pdf.rect(ix, y + 0.1 * s, islandW * s, 0.76 * s, { fill: color, stroke: C.grey, lineWidth: 1 });
      fronts(pdf, ix + 2, y + 0.1 * s + 2, islandW * s - 4, 0.76 * s - 4, { s, cols: 3, color });
      pdf.rect(ix - 2, y + 0.86 * s, islandW * s + 4, Math.max(2.5, 0.04 * s), { fill: worktop, stroke: C.grey, lineWidth: 0.6 });
      pdf.text(t('pdf.island'), ix + islandW * s / 2, y + 1.05 * s, { size: 8.5, color: C.muted, align: 'center' });
    }
  } else if (cfg.type === 'vanity') {
    const W = d.width;
    const s = Math.min(area.w / Math.max(W, 1.4), area.h / 1.9);
    const x = area.x + (area.w - W * s) / 2, y = area.y;
    pdf.line(area.x, y, area.x + area.w, y, { color: C.line, width: 1 });
    pdf.rect(x, y + 0.35 * s, W * s, 0.5 * s, { fill: color, stroke: C.grey, lineWidth: 1 });
    fronts(pdf, x + 2, y + 0.35 * s + 2, W * s - 4, 0.5 * s - 4, { s, cols: Math.max(1, Math.round(W / 0.6)), drawers: o.drawer, color });
    pdf.rect(x - 2, y + 0.85 * s, W * s + 4, 0.03 * s, { fill: '#f4f2ee', stroke: C.grey, lineWidth: 0.6 });
    const basins = W >= 1.2 ? 2 : 1;
    for (let i = 0; i < basins; i++) pdf.ellipse(x + (W * s * (i + 1)) / (basins + 1), y + 0.88 * s + 4, 0.2 * s, 5, { fill: '#ffffff', stroke: C.grey, lineWidth: 0.6 });
    if (o.led) pdf.line(x + 4, y + 0.35 * s - 1.5, x + W * s - 4, y + 0.35 * s - 1.5, { color: C.led, width: 2.2 });
    const mw = Math.min(W * 0.8, 1.2) * s;
    pdf.rect(x + (W * s - mw) / 2, y + 1.05 * s, mw, 0.7 * s, { fill: C.glass, stroke: C.grey, lineWidth: 0.8 });
    pdf.text(t('pdf.mirror'), x + W * s / 2, y + 1.38 * s, { size: 8.5, color: C.muted, align: 'center' });
    dimH(pdf, x, x + W * s, y + 0.35 * s - 14, `${num(W)} m`);
    dimV(pdf, x - 16, y, y + 0.85 * s, '0,85 m');
  } else if (cfg.type === 'stairs') {
    view = 'pdf.side';
    const n = d.steps, rise = 0.18, run = 0.25;
    const s = Math.min(area.w / (n * run), area.h / (n * rise + 0.9));
    const x = area.x + (area.w - n * run * s) / 2, y = area.y;
    const pts = [[x, y]];
    for (let i = 0; i < n; i++) { pts.push([x + i * run * s, y + (i + 1) * rise * s]); pts.push([x + (i + 1) * run * s, y + (i + 1) * rise * s]); }
    pts.push([x + n * run * s, y]);
    pdf.poly(pts, { fill: color, stroke: C.grey, lineWidth: 1 });
    if (o.led) {
      for (let i = 0; i < n; i++) pdf.line(x + i * run * s + 1, y + (i + 1) * rise * s - 2, x + (i + 1) * run * s - 1, y + (i + 1) * rise * s - 2, { color: C.led, width: 1.6 });
    }
    if (o.handrail) {
      const ax = x + 0.5 * run * s, ay = y + rise * s + 0.9 * s;
      const bx = x + (n - 0.5) * run * s, by = y + n * rise * s + 0.9 * s;
      pdf.line(ax, ay, bx, by, { color: C.brown, width: 2.4 });
      pdf.line(ax, ay, ax, y + rise * s, { color: C.brown, width: 1.6 });
      pdf.line(bx, by, bx, y + n * rise * s, { color: C.brown, width: 1.6 });
    }
    dimH(pdf, x, x + n * run * s, y - 14, `${num(n * run)} m (${t('pdf.run')})`);
    dimV(pdf, x + n * run * s + 16, y, y + n * rise * s, `${num(n * rise)} m`);
    pdf.text(`${n} × ${num(rise * 100, 0)} cm`, x, y + n * rise * s, { size: 9, color: C.muted });
  } else if (cfg.type === 'parquet') {
    view = 'pdf.plan';
    const side = Math.sqrt(d.area);
    const size = Math.min(area.w, area.h);
    const x = area.x + (area.w - size) / 2, y = area.y;
    pdf.rect(x, y, size, size, { fill: color, stroke: C.grey, lineWidth: 1 });
    pdf.clip(x, y, size, size, () => {
      if (mat.id === 'laminate') {
        for (let ly = y; ly < y + size; ly += 10) {
          pdf.line(x, ly, x + size, ly, { color: '#9c8466', width: 0.4 });
          for (let lx = x + ((ly - y) / 10 % 2) * 30; lx < x + size; lx += 60) pdf.line(lx, ly, lx, ly + 10, { color: '#9c8466', width: 0.4 });
        }
      } else {
        for (let k = -size; k < size * 2; k += 12) {
          pdf.line(x + k, y, x + k + size, y + size, { color: '#9c7a52', width: 0.4 });
          pdf.line(x + k, y + size, x + k + size, y, { color: '#9c7a52', width: 0.25 });
        }
      }
    });
    pdf.rect(x + size / 2 - 38, y + size / 2 - 10, 76, 20, { fill: '#ffffff', stroke: C.line });
    pdf.text(`${num(d.area, 0)} m²`, x + size / 2, y + size / 2 - 4, { size: 11, bold: true, align: 'center' });
    dimH(pdf, x, x + size, y - 14, `~ ${num(side, 1)} m`);
    dimV(pdf, x - 16, y, y + size, `~ ${num(side, 1)} m`);
  }
  pdf.text(`${t('pdf.drawing')} — ${t(view)}`, box.x + 12, box.y + box.h - 18, { size: 9, bold: true, color: C.muted });
}

function buildEstimatePdf({ config, pricing, settings, tr, client = {}, ref, date = new Date() }) {
  const cfg = M.sanitize(config, pricing);
  const r = M.compute(cfg, pricing);
  const { t, num, money } = tr;
  const pdf = new Pdf({ title: `${t('pdf.title')} ${ref}` });

  header(pdf, settings, tr);
  pdf.text(t('pdf.title'), 40, 728, { size: 21, bold: true });
  pdf.text(`${t('pdf.ref')} : ${ref}`, 555, 735, { size: 9, align: 'right', color: C.muted });
  pdf.text(`${t('pdf.date')} : ${tr.date(date)}`, 555, 722, { size: 9, align: 'right', color: C.muted });
  const who = [client.name, client.email, client.phone].filter(Boolean).join('  ·  ');
  if (who) pdf.text(`${t('pdf.client')} : ${who}`, 40, 708, { size: 10, color: C.ink });

  // Sketch
  const box = { x: 40, y: 420, w: 515, h: 272 };
  pdf.rect(box.x, box.y, box.w, box.h, { fill: C.paper, stroke: C.line });
  sketch(pdf, cfg, tr, box, pricing);

  // Configuration (left)
  let y = 392;
  pdf.text(t('pdf.config'), 40, y, { size: 12, bold: true });
  y -= 20;
  const unit = k => (k === 'steps' ? '' : k === 'area' ? ' m²' : ' m');
  const rows = [[t('est.step1'), t('est.type.' + cfg.type)]];
  for (const [k, v] of Object.entries(cfg.dims)) rows.push([t('est.dim.' + k), `${num(v)}${unit(k)}`]);
  const pick = names => M.pick(names, tr.lang);
  rows.push([t('est.step3'), pick(M.material(cfg, pricing).name)]);
  if (cfg.type === 'kitchen' && M.worktop(cfg, pricing)) rows.push([t('est.opt.worktop'), pick(M.worktop(cfg, pricing).name)]);
  for (const opt of M.optionsFor(cfg.type, pricing)) {
    const v = cfg.opts[opt.id];
    if (v) rows.push([pick(opt.name), opt.kind === 'count' ? String(v) : '•']);
  }
  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) pdf.rect(40, y - 5, 285, 17, { fill: '#f6f1ea' });
    pdf.text(label, 48, y, { size: 9.5, color: C.muted });
    pdf.text(value, 317, y, { size: 9.5, bold: true, align: 'right' });
    y -= 17;
  });
  // material swatch next to the material row
  const matRow = rows.findIndex(([l]) => l === t('est.step3'));
  pdf.rect(330, 392 - 20 - matRow * 17 - 3, 12, 12, { fill: M.material(cfg, pricing).color, stroke: C.grey, lineWidth: 0.5 });

  // Price box (right)
  const px = 355, pw = 200, ptop = 404;
  const lines = [[t('est.base'), r.base], ...r.lines.map(l => [(l.worktop ? `${t('est.opt.worktop')} ` : '') + pick(l.name) + (l.qty && !l.worktop ? ` (${l.qty})` : ''), l.amount]), [`${t('est.install')} (${num(pricing.installPct, 0)} %)`, r.install]];
  const ph = 86 + lines.length * 14;
  pdf.rect(px, ptop - ph, pw, ph, { fill: C.dark });
  pdf.text(t('pdf.price').toUpperCase(), px + 14, ptop - 20, { size: 8, bold: true, color: C.sand });
  pdf.text(`${money(r.min)} – ${money(r.max)}`, px + 14, ptop - 42, { size: 17, bold: true, color: '#ffffff' });
  let ly = ptop - 64;
  lines.forEach(([label, amount]) => {
    pdf.text(label, px + 14, ly, { size: 8.5, color: '#e9e1d4' });
    pdf.text(money(Math.round(amount / 10) * 10), px + pw - 14, ly, { size: 8.5, color: '#e9e1d4', align: 'right' });
    ly -= 14;
  });
  pdf.line(px + 14, ly + 6, px + pw - 14, ly + 6, { color: '#6b5a48', width: 0.5 });
  pdf.text(`± ${num(pricing.margin, 0)} %`, px + pw - 14, ly - 6, { size: 8, color: C.sand, align: 'right' });

  // Notes
  let ny = Math.min(y, ptop - ph) - 26;
  for (const line of pdf.wrap(t('pdf.note'), 515, 8.5)) { pdf.text(line, 40, ny, { size: 8.5, color: C.muted }); ny -= 12; }
  ny -= 6;
  pdf.text(t('pdf.next'), 40, ny, { size: 9.5, bold: true, color: C.brown });

  // Footer
  pdf.line(40, 58, 555, 58, { color: C.line });
  const foot = ['Timberway', settings.phone, settings.email, 'timberway.be'].filter(Boolean).join('  ·  ');
  pdf.text(foot, 297.6, 42, { size: 8, color: C.muted, align: 'center' });

  return { buffer: pdf.toBuffer(), estimate: r, config: cfg };
}

module.exports = { buildEstimatePdf };
