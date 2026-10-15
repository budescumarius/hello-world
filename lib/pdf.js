// Tiny single-page PDF writer: Helvetica text, lines, rectangles, polygons and ellipses.
// Enough for a branded estimate with a vector drawing, without any dependency.
const zlib = require('zlib');

// Approximate Helvetica / Helvetica-Bold advance widths (per 1000 units) for text measuring.
const W_REG = { ' ': 278, '.': 278, ',': 278, ':': 278, ';': 278, '-': 333, '(': 333, ')': 333, '/': 278, "'": 191, '’': 222, '·': 278, '×': 584, '²': 333, '€': 556, '–': 556, '—': 1000, '%': 889, '+': 584, '~': 584, '|': 260 };
const W_BOLD = { ' ': 278, '.': 278, ',': 278, ':': 333, ';': 333, '-': 333, '(': 333, ')': 333, '/': 278, "'": 238, '’': 278, '·': 278, '×': 584, '²': 333, '€': 556, '–': 556, '—': 1000, '%': 889, '+': 584, '~': 584, '|': 280 };
const UPPER = { A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611 };
const LOWER = { a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500 };
const LOWER_BOLD = { a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500 };

// Characters outside Latin-1 that WinAnsiEncoding still has.
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, 'œ': 0x9c, 'Œ': 0x8c, 'Š': 0x8a, 'š': 0x9a, 'Ž': 0x8e, 'ž': 0x9e, 'Ÿ': 0x9f };
const SUBST = { '≈': '~', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', '→': '>', '✓': 'x' };

function winAnsi(str) {
  let out = '';
  for (const ch of String(str)) {
    const c = SUBST[ch] !== undefined ? SUBST[ch] : ch;
    const code = c.codePointAt(0);
    let byte;
    if (WIN[c] !== undefined) byte = WIN[c];
    else if (code < 128 || (code >= 160 && code < 256)) byte = code;
    else byte = 63; // '?'
    const b = String.fromCharCode(byte);
    out += b === '\\' || b === '(' || b === ')' ? '\\' + b : b;
  }
  return out;
}

function hex(color) {
  const h = String(color).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' ');
}
const f = n => (Math.round(n * 100) / 100).toString();

class Pdf {
  constructor({ width = 595.28, height = 841.89, title = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.ops = [];
  }

  textWidth(str, size, bold = false) {
    let w = 0;
    for (const ch of String(str)) {
      const base = ch.normalize('NFD')[0];
      const table = bold ? W_BOLD : W_REG;
      w += table[ch] ?? UPPER[base] ?? (bold ? LOWER_BOLD : LOWER)[base] ?? (/[0-9]/.test(base) ? 556 : 556);
    }
    return (w * size) / 1000;
  }

  wrap(str, maxWidth, size, bold = false) {
    const lines = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + ' ' + word : word;
        if (line && this.textWidth(next, size, bold) > maxWidth) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  text(str, x, y, { size = 10, bold = false, color = '#1f1a16', align = 'left', rotate = 0 } = {}) {
    let tx = x;
    if (align !== 'left') {
      const w = this.textWidth(str, size, bold);
      tx = align === 'right' ? x - w : x - w / 2;
    }
    const font = bold ? '/F2' : '/F1';
    if (rotate) {
      const r = (rotate * Math.PI) / 180;
      const c = Math.cos(r), s = Math.sin(r);
      const w = align === 'center' ? this.textWidth(str, size, bold) / 2 : 0;
      this.ops.push(`BT ${font} ${f(size)} Tf ${hex(color)} rg ${f(c)} ${f(s)} ${f(-s)} ${f(c)} ${f(x - w * c)} ${f(y - w * s)} Tm (${winAnsi(str)}) Tj ET`);
    } else {
      this.ops.push(`BT ${font} ${f(size)} Tf ${hex(color)} rg ${f(tx)} ${f(y)} Td (${winAnsi(str)}) Tj ET`);
    }
    return this;
  }

  paint({ fill, stroke, lineWidth = 0.8, dash }) {
    const pre = [];
    if (fill) pre.push(`${hex(fill)} rg`);
    if (stroke) pre.push(`${hex(stroke)} RG ${f(lineWidth)} w`);
    pre.push(dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d');
    const op = fill && stroke ? 'B' : fill ? 'f' : 'S';
    return { pre: pre.join(' '), op };
  }

  rect(x, y, w, h, style = { stroke: '#000' }) {
    const { pre, op } = this.paint(style);
    this.ops.push(`q ${pre} ${f(x)} ${f(y)} ${f(w)} ${f(h)} re ${op} Q`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#000', width = 0.8, dash } = {}) {
    const { pre } = this.paint({ stroke: color, lineWidth: width, dash });
    this.ops.push(`q ${pre} ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S Q`);
    return this;
  }

  poly(points, style = { stroke: '#000' }, close = true) {
    const { pre, op } = this.paint(style);
    const path = points.map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ');
    this.ops.push(`q ${pre} ${path} ${close ? 'h' : ''} ${close ? op : 'S'} Q`);
    return this;
  }

  ellipse(cx, cy, rx, ry, style = { stroke: '#000' }) {
    const k = 0.5523;
    const { pre, op } = this.paint(style);
    const p = [
      `${f(cx + rx)} ${f(cy)} m`,
      `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
      `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
      `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
      `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c`
    ];
    this.ops.push(`q ${pre} ${p.join(' ')} h ${op} Q`);
    return this;
  }

  // Run fn with drawing clipped to a rectangle.
  clip(x, y, w, h, fn) {
    this.ops.push(`q ${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n`);
    fn();
    this.ops.push('Q');
    return this;
  }

  toBuffer() {
    const content = zlib.deflateSync(Buffer.from(this.ops.join('\n'), 'latin1'));
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(this.width)} ${f(this.height)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      null, // content stream, written as binary below
      `<< /Title (${winAnsi(this.title)}) /Producer (Timberway site) >>`
    ];
    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let length = chunks[0].length;
    objects.forEach((obj, i) => {
      offsets.push(length);
      const parts = obj === null
        ? [Buffer.from(`${i + 1} 0 obj\n<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream\nendobj\n', 'latin1')]
        : [Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1')];
      parts.forEach(p => { chunks.push(p); length += p.length; });
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${length}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf };
