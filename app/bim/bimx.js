// Citirea fișierelor .bimx (hipermodele publicate din ARCHICAD) – partea care se poate decoda:
// planșele 2D (imagini pe plăci de 512 px), proprietățile elementelor și datele proiectului.
// Geometria 3D (fișierul .sda din arhivă) folosește un format binar nedocumentat și nu este citită.
//
// Structura containerului: arhive imbricate. La sfârșitul fiecărei arhive:
//   [director][u32 număr intrări][u32 lungime director][u32 versiune]["KPXB"]
// O intrare din director: u32 lungime nume, nume (UTF-8), u64 dată, u64 mărime, u64 poziție (relativă la arhivă), 40 octeți SHA-1 hex.
// Fișierele se citesc din File/Blob pe bucăți, fără a încărca tot fișierul în memorie.

const dec = new TextDecoder();

async function readArchive(blob, base, size) {
  const tail = new DataView(await blob.slice(base + size - 16, base + size).arrayBuffer());
  if (dec.decode(new Uint8Array(tail.buffer, 12, 4)) !== 'KPXB') throw new Error('Structură .bimx necunoscută');
  const count = tail.getUint32(0, true), dirSize = tail.getUint32(4, true);
  const dirStart = base + size - 16 - dirSize;
  const dir = new DataView(await blob.slice(dirStart, dirStart + dirSize).arrayBuffer());
  const files = new Map();
  let o = 0;
  for (let i = 0; i < count; i++) {
    const n = dir.getUint32(o, true);
    const name = dec.decode(new Uint8Array(dir.buffer, o + 4, n));
    const p = o + 4 + n;
    const sz = Number(dir.getBigUint64(p + 8, true));
    const off = Number(dir.getBigUint64(p + 16, true));
    files.set(name, { off: base + off, size: sz });
    o = p + 64;
  }
  return files;
}

const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const attr = (el, k) => el?.getAttribute(k) ?? '';

export async function openBimx(blob, fileName, onProgress = () => {}) {
  const head = dec.decode(await blob.slice(0, 4).arrayBuffer());
  if (head !== 'BIMx') throw new Error('Nu este un fișier BIMx');
  onProgress(0.1, 'Se citește cuprinsul…');
  const outer = await readArchive(blob, 0, blob.size);
  const text = async (f) => dec.decode(await blob.slice(f.off, f.off + f.size).arrayBuffer());

  // ---------------- Proiect
  const project = {};
  const idx = outer.get('index.xml');
  if (idx) {
    const x = parseXml(await text(idx));
    project['Hipermodel'] = x.querySelector('HyperModel')?.textContent || '';
    for (const info of x.querySelectorAll('ProjectInfo FixInfoList Info, ProjectInfo Info')) {
      const v = info.querySelector('value')?.textContent;
      const k = attr(info, 'name') || attr(info, 'key');
      if (v && k && !(k in project)) project[k] = v;
    }
    const ac = x.querySelector('ARCHICAD');
    if (ac) project['ARCHICAD'] = attr(ac, 'version');
    const pub = x.querySelector('PublishingInformation');
    if (pub) project['Publicat'] = attr(pub, 'itemTime').replace('T', ' ');
  }

  // ---------------- Planșe (.bxp + .xml cu același GUID)
  onProgress(0.3, 'Se citesc planșele…');
  const sheets = [];
  for (const [name, f] of outer) {
    if (!name.endsWith('.bxp')) continue;
    const id = name.slice(0, -4);
    const meta = outer.get(id + '.xml');
    const info = { id, name: id, number: '', path: '', type: 'Planșă', scale: '' };
    if (meta) {
      const x = parseXml(await text(meta));
      const lay = x.querySelector('Layout');
      info.name = attr(lay, 'name') || info.name;
      info.number = attr(lay, 'number');
      info.path = attr(lay, 'path');
      const types = [...x.querySelectorAll('Geometry')].map((g) => attr(g, 'type'));
      info.type = types.includes('Story') ? 'Plan' : types.includes('Elevation') ? 'Fațadă' : types.includes('Section') ? 'Secțiune' : 'Planșă';
      const st = x.querySelector('Settings');
      if (st) info.scale = attr(st, 'scale') ? '1:' + attr(st, 'scale') : '';
    }
    const arc = await readArchive(blob, f.off, f.size);
    const ts = arc.get('tileset.xml');
    if (!ts) continue;
    const tx = parseXml(await text(ts));
    const tsEl = tx.querySelector('Tileset');
    const page = tx.querySelector('Page');
    info.tile = +attr(tsEl, 'tileWidth') || 512;
    info.pageW = +attr(page, 'width');
    info.pageH = +attr(page, 'height');
    info.levels = [...tx.querySelectorAll('Level')].map((l) => +attr(l, 'dpi'));
    info.tiles = arc;
    info.thumb = arc.get('thumb_1_.png');
    sheets.push(info);
  }
  const order = { Plan: 0, 'Secțiune': 1, 'Fațadă': 2, 'Planșă': 3 };
  sheets.sort((a, b) => (order[a.type] - order[b.type]) || a.number.localeCompare(b.number, 'ro', { numeric: true }) || a.name.localeCompare(b.name, 'ro'));

  // ---------------- Elemente (arhiva .mdp: un XML per element) și niveluri
  onProgress(0.6, 'Se citesc elementele…');
  const elements = [];
  const stories = [];
  const layers = new Map();
  for (const [name, f] of outer) {
    if (!name.endsWith('.mdp')) continue;
    const buf = await blob.slice(f.off, f.off + f.size).arrayBuffer();
    const sub = await readArchive(new Blob([buf]), 0, buf.byteLength);
    const u8 = new Uint8Array(buf);
    for (const [n, e] of sub) {
      if (!n.endsWith('.xml')) continue;
      const x = parseXml(dec.decode(u8.subarray(e.off, e.off + e.size)));
      const root = x.documentElement;
      if (root.nodeName === 'PublisherItem') {
        for (const s of x.querySelectorAll('Stories Story')) stories.push({ name: attr(s, 'name'), number: +attr(s, 'number'), level: +attr(s, 'level') });
        for (const l of x.querySelectorAll('Layer')) layers.set(attr(l, 'index'), attr(l, 'name'));
        const bb = x.querySelector('ModelBoundingBox')?.textContent;
        if (bb) project['Gabarit model'] = bb.split(';').map(Number).reduce((a, v, i, arr) => (i < 3 ? [...a, (arr[i + 3] - v).toFixed(1)] : a), []).join(' × ') + ' m';
        continue;
      }
      if (root.nodeName !== 'Elem') continue;
      const props = {};
      for (const block of root.querySelectorAll('Block')) {
        const rows = {};
        for (const i of block.querySelectorAll('Info')) {
          const k = attr(i, 'key');
          if (!k || k in rows) continue;
          rows[k] = attr(i, 'value') + (attr(i, 'unit') ? ' ' + attr(i, 'unit') : '');
        }
        props[attr(block, 'name') || 'Proprietăți'] = rows;
      }
      const first = Object.values(props)[0] || {};
      elements.push({ id: attr(root, 'id'), name: attr(root, 'name').trim() || first.ID || '—', type: first.Type || attr(root, 'type'), floor: +attr(root, 'floornum'), layer: attr(root, 'layer'), props });
    }
  }
  stories.sort((a, b) => a.level - b.level);
  for (const e of elements) {
    e.layerName = layers.get(e.layer) || '';
    e.storyName = stories.find((s) => s.number === e.floor)?.name || '';
  }
  elements.sort((a, b) => a.type.localeCompare(b.type, 'ro') || a.name.localeCompare(b.name, 'ro', { numeric: true }));
  onProgress(0.95, 'Gata');

  const has3D = [...outer.keys()].some((n) => n.endsWith('.sda'));
  return {
    name: project['Hipermodel'] || fileName.replace(/\.bimx$/i, ''),
    project, sheets, elements, stories, has3D,
    // returnează imaginea unei plăci (sau a miniaturii) ca Blob PNG
    png: (f) => blob.slice(f.off, f.off + f.size, 'image/png'),
  };
}
