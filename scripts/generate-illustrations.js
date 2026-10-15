// Generates the illustrated placeholder images in public/img/illustrations/.
// They're shown when a project has no photo yet.
// Usage: node scripts/generate-illustrations.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'illustrations');
const W = 1600, H = 1200, FLOOR = 900;

// Three room moods so a gallery of placeholders doesn't repeat the same picture.
const ROOMS = {
  1: { wall: '#f1ebe2', wall2: '#e6ddd1', sky: ['#bcd6e6', '#eef3ef'], light: 'rgba(255,248,230,.35)' },
  2: { wall: '#e9e4dc', wall2: '#d9d2c7', sky: ['#f2c595', '#fbe8cf'], light: 'rgba(255,214,160,.30)' },
  3: { wall: '#dfe3df', wall2: '#cfd5cf', sky: ['#a9bccd', '#e2e6e2'], light: 'rgba(235,240,255,.25)' }
};
const WOOD = { light: '#e3bf8f', mid: '#c99862', dark: '#a7733f', deep: '#6b4423', walnut: '#7a4e2e' };

function defs(r) {
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r.sky[0]}"/><stop offset="1" stop-color="${r.sky[1]}"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WOOD.dark}"/><stop offset="1" stop-color="${WOOD.mid}"/></linearGradient>
    <linearGradient id="stone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f5f2"/><stop offset="1" stop-color="#dcd8d2"/></linearGradient>
    <linearGradient id="mirror" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4eef2"/><stop offset="1" stop-color="#9fb4bd"/></linearGradient>
    <pattern id="slats" width="34" height="40" patternUnits="userSpaceOnUse"><rect width="34" height="40" fill="${WOOD.mid}"/><rect width="26" height="40" fill="${WOOD.light}"/></pattern>
    <pattern id="veneer" width="120" height="60" patternUnits="userSpaceOnUse"><rect width="120" height="60" fill="${WOOD.light}"/><path d="M0 20 Q30 12 60 20 T120 20 M0 44 Q30 36 60 44 T120 44" stroke="${WOOD.mid}" stroke-width="2" fill="none" opacity=".5"/></pattern>
    <pattern id="herring" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="80" height="80" fill="${WOOD.mid}"/><rect width="38" height="78" fill="${WOOD.light}"/><rect x="40" y="0" width="38" height="38" fill="${WOOD.dark}"/><rect x="40" y="40" width="38" height="38" fill="${WOOD.mid}"/></pattern>
  </defs>`;
}

function room(r, opts = {}) {
  const planks = [];
  for (let i = -8; i <= 8; i++) planks.push(`<path d="M${800 + i * 70} ${FLOOR} L${800 + i * 240} ${H}" stroke="${WOOD.dark}" stroke-width="3" opacity=".6"/>`);
  return `<rect width="${W}" height="${H}" fill="${r.wall}"/>
    ${opts.noWindow ? '' : `<rect x="${opts.wx ?? 110}" y="150" width="380" height="560" fill="url(#sky)"/><rect x="${opts.wx ?? 110}" y="150" width="380" height="560" fill="none" stroke="#2f2a26" stroke-width="14"/><path d="M${(opts.wx ?? 110) + 190} 150 V710" stroke="#2f2a26" stroke-width="9"/>`}
    <rect y="${FLOOR - 14}" width="${W}" height="14" fill="${r.wall2}"/>
    ${opts.floor === 'herring' ? `<rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="url(#herring)"/>` : `<rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="url(#floor)"/>${planks.join('')}`}`;
}

function plant(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-45" y="-80" width="90" height="80" rx="10" fill="#d9cfc2"/><g fill="#5f8a55"><ellipse cx="-26" cy="-150" rx="26" ry="78" transform="rotate(-20 -26 -150)"/><ellipse cx="26" cy="-160" rx="24" ry="86" transform="rotate(18 26 -160)"/><ellipse cy="-176" rx="22" ry="94"/></g></g>`;
}

const SCENES = {
  // Kitchen: wood base units, island with stools, open shelves and pendant lights
  kitchen: r => `${room(r)}
    <rect x="560" y="470" width="980" height="420" fill="url(#veneer)"/>
    <path d="M800 470 V890 M1050 470 V890 M1300 470 V890" stroke="${WOOD.dark}" stroke-width="4"/>
    <rect x="540" y="450" width="1020" height="26" fill="url(#stone)"/>
    <rect x="600" y="190" width="420" height="16" fill="${WOOD.dark}"/><rect x="600" y="300" width="420" height="16" fill="${WOOD.dark}"/>
    <g fill="#f4f1ec"><rect x="630" y="140" width="40" height="50" rx="6"/><rect x="690" y="150" width="30" height="40" rx="6"/><circle cx="900" cy="268" r="30"/><rect x="960" y="250" width="34" height="50" rx="6"/></g>
    <rect x="1120" y="160" width="300" height="250" fill="#2f2a26"/><rect x="1132" y="172" width="276" height="226" fill="#3b3631"/>
    <g stroke="#2f2a26" stroke-width="4"><path d="M560 0 V120 M760 0 V140"/></g><g fill="#2f2a26"><path d="M520 120 h80 l-14 40 h-52 z"/><path d="M720 140 h80 l-14 40 h-52 z"/></g>
    <rect x="300" y="700" width="760" height="200" fill="${WOOD.mid}"/><rect x="280" y="680" width="800" height="28" fill="url(#stone)"/>
    <path d="M490 708 V900 M680 708 V900 M870 708 V900" stroke="${WOOD.dark}" stroke-width="4"/>
    <g fill="#2f2a26"><rect x="360" y="760" width="90" height="16" rx="6"/><rect x="372" y="776" width="8" height="190"/><rect x="430" y="776" width="8" height="190"/><rect x="900" y="760" width="90" height="16" rx="6"/><rect x="912" y="776" width="8" height="190"/><rect x="970" y="776" width="8" height="190"/></g>
    <path d="M400 690 q20 -60 0 -110 M430 690 q-10 -70 20 -120" stroke="#5f8a55" stroke-width="8" fill="none"/>`,
  // Bespoke wardrobe / bookcase wall
  furniture: r => {
    const books = [];
    const colors = ['#8c5a3c', '#3f5b6b', '#c9a46a', '#6b6f4b', '#a4473a', '#2f2a26'];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
      const h = 90 + ((i * 37 + row * 13) % 50);
      books.push(`<rect x="${1000 + i * 30}" y="${300 + row * 190 - h + 160}" width="24" height="${h}" fill="${colors[(i + row) % colors.length]}"/>`);
    }
    return `${room(r, { wx: 90 })}
      <rect x="560" y="120" width="940" height="770" fill="url(#veneer)"/>
      <rect x="560" y="120" width="940" height="770" fill="none" stroke="${WOOD.dark}" stroke-width="12"/>
      <path d="M730 120 V890 M900 120 V890" stroke="${WOOD.dark}" stroke-width="5"/>
      <g fill="${WOOD.deep}"><rect x="712" y="450" width="8" height="120" rx="4"/><rect x="740" y="450" width="8" height="120" rx="4"/><rect x="882" y="450" width="8" height="120" rx="4"/></g>
      <rect x="980" y="130" width="500" height="750" fill="${WOOD.walnut}" opacity=".25"/>
      <g fill="${WOOD.dark}"><rect x="980" y="300" width="500" height="14"/><rect x="980" y="490" width="500" height="14"/><rect x="980" y="680" width="500" height="14"/></g>
      ${books.join('')}
      <g fill="#f4f1ec"><circle cx="1360" cy="270" r="26"/><rect x="1330" y="430" width="60" height="60" rx="6"/></g>
      ${plant(470, 890, 1)}`;
  },
  // Bathroom vanity with curved wood cabinet, round mirror and basin
  bathroom: r => `<rect width="${W}" height="${H}" fill="${r.wall}"/>
    <rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="#d8d2c8"/><path d="M0 ${FLOOR + 100} H${W} M0 ${FLOOR + 220} H${W} M400 ${FLOOR} V${H} M800 ${FLOOR} V${H} M1200 ${FLOOR} V${H}" stroke="#c6beb2" stroke-width="3"/>
    <rect x="0" y="0" width="300" height="${FLOOR}" fill="url(#slats)"/>
    <circle cx="820" cy="320" r="190" fill="url(#mirror)" stroke="${WOOD.dark}" stroke-width="14"/>
    <path d="M700 230 q60 -40 120 -30" stroke="#fff" stroke-width="10" opacity=".5" fill="none"/>
    <path d="M460 600 H1180 Q1240 600 1240 660 V760 Q1240 820 1180 820 H460 Q400 820 400 760 V660 Q400 600 460 600 Z" fill="url(#veneer)" stroke="${WOOD.dark}" stroke-width="8"/>
    <path d="M820 610 V810" stroke="${WOOD.dark}" stroke-width="5"/>
    <rect x="390" y="580" width="860" height="26" rx="10" fill="url(#stone)"/>
    <ellipse cx="820" cy="580" rx="150" ry="34" fill="#fff"/><path d="M820 480 v60 q0 20 30 20" stroke="#2f2a26" stroke-width="12" fill="none" stroke-linecap="round"/>
    <path d="M1320 300 h160 a40 40 0 0 1 0 80 h-160 z M1320 460 h200 a40 40 0 0 1 0 80 h-200 z" fill="${WOOD.mid}"/>
    <g fill="#f4f1ec"><rect x="1350" y="240" width="40" height="60" rx="8"/><rect x="1400" y="410" width="60" height="50" rx="8"/></g>
    ${plant(1450, 900, .9)}
    <rect width="${W}" height="${H}" fill="${r.light}" opacity=".4"/>`,
  // Floating oak staircase with slatted wall
  stairs: r => {
    const steps = [];
    for (let i = 0; i < 9; i++) steps.push(`<rect x="${760 + i * 70}" y="${880 - i * 70}" width="${520 - i * 70}" height="24" fill="${WOOD.mid}"/><rect x="${760 + i * 70}" y="${904 - i * 70}" width="${520 - i * 70}" height="46" fill="${r.wall2}"/>`);
    return `${room(r, { wx: 120 })}
      <rect x="1290" y="0" width="310" height="${FLOOR}" fill="url(#slats)"/>
      ${steps.join('')}
      <path d="M760 880 L1400 240" stroke="#2f2a26" stroke-width="8"/><path d="M800 600 V860 M900 500 V780 M1000 400 V680 M1100 300 V580" stroke="#2f2a26" stroke-width="4" opacity=".8"/>
      ${plant(640, 900, 1)}
      <path d="M140 720 L560 720 L700 ${H} L-100 ${H} Z" fill="${r.light}"/>`;
  },
  // Empty room with a fresh herringbone parquet floor
  parquet: r => `${room(r, { floor: 'herring', wx: 610 })}
    <rect x="${W / 2 - 400}" y="${FLOOR}" width="800" height="${H - FLOOR}" fill="${r.light}" opacity=".6"/>
    <rect x="0" y="0" width="${W}" height="40" fill="${r.wall2}"/>
    <g transform="translate(240 900)" fill="${WOOD.walnut}"><rect x="-120" y="-200" width="240" height="20" rx="6"/><rect x="-100" y="-180" width="14" height="180"/><rect x="86" y="-180" width="14" height="180"/><rect x="-60" y="-230" width="80" height="30" rx="6" fill="#f4f1ec"/></g>
    ${plant(1360, 900, 1.1)}`,
  // House with a timber-clad extension and large glazing
  exterior: r => `<rect width="${W}" height="${H}" fill="url(#sky)"/>
    <rect y="900" width="${W}" height="${H - 900}" fill="#8fa874"/>
    <rect x="160" y="420" width="560" height="480" fill="#efe9df"/><path d="M130 430 L440 210 L750 430 Z" fill="#8a4b38"/>
    <rect x="250" y="520" width="120" height="150" fill="url(#mirror)" stroke="#5a5550" stroke-width="10"/>
    <rect x="720" y="480" width="740" height="420" fill="url(#slats)"/><rect x="705" y="462" width="770" height="26" fill="#2f2a26"/>
    <rect x="850" y="560" width="500" height="320" fill="url(#mirror)"/><path d="M1016 560 V880 M1183 560 V880" stroke="#5a5550" stroke-width="10"/><rect x="850" y="560" width="500" height="320" fill="none" stroke="#5a5550" stroke-width="12"/>
    <rect x="700" y="900" width="800" height="40" fill="#d9d4cc"/>
    <rect width="${W}" height="${H}" fill="${r.light}" opacity=".4"/>`,
  // Workbench with a chair being restored, tools on the wall
  restoration: r => `<rect width="${W}" height="${H}" fill="${r.wall2}"/>
    <rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="#b7aa98"/>
    <rect x="160" y="140" width="1280" height="320" fill="url(#veneer)" opacity=".55"/>
    <g stroke="#2f2a26" stroke-width="10" stroke-linecap="round"><path d="M300 200 v140 M420 190 v170 M560 210 v120"/></g>
    <g fill="#2f2a26"><rect x="270" y="330" width="60" height="30" rx="6"/><rect x="400" y="350" width="40" height="40" rx="6"/><path d="M540 330 h40 l-6 40 h-28z"/></g>
    <path d="M760 220 h260 v40 h-260z" fill="${WOOD.dark}"/><path d="M1100 200 l120 120" stroke="#8a8f94" stroke-width="16" stroke-linecap="round"/>
    <rect x="140" y="640" width="1320" height="44" fill="${WOOD.dark}"/><rect x="180" y="684" width="40" height="216" fill="${WOOD.deep}"/><rect x="1380" y="684" width="40" height="216" fill="${WOOD.deep}"/>
    <g transform="translate(760 640)">
      <rect x="-130" y="-170" width="260" height="30" rx="8" fill="${WOOD.mid}"/>
      <rect x="-120" y="-140" width="18" height="140" fill="${WOOD.dark}"/><rect x="102" y="-140" width="18" height="140" fill="${WOOD.dark}"/>
      <rect x="102" y="-400" width="18" height="230" fill="${WOOD.dark}"/><rect x="-120" y="-400" width="18" height="230" fill="${WOOD.light}"/>
      <path d="M-102 -380 H102 M-102 -320 H102 M-102 -260 H102" stroke="${WOOD.mid}" stroke-width="16"/>
    </g>
    <rect x="1080" y="590" width="200" height="50" rx="8" fill="#d9822b"/><rect x="1100" y="570" width="160" height="24" rx="6" fill="#2f2a26"/>
    <g fill="${WOOD.light}" opacity=".9"><circle cx="980" cy="630" r="6"/><circle cx="1010" cy="622" r="4"/><circle cx="560" cy="632" r="5"/></g>
    <rect width="${W}" height="${H}" fill="${r.light}" opacity=".5"/>`
};

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.svg')) fs.rmSync(path.join(OUT, f));
let count = 0;
for (const [name, draw] of Object.entries(SCENES)) {
  for (const [v, r] of Object.entries(ROOMS)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs(r)}${draw(r)}</svg>\n`;
    fs.writeFileSync(path.join(OUT, `${name}-${v}.svg`), svg);
    count++;
  }
}
console.log(`Wrote ${count} illustrations to ${OUT}`);
