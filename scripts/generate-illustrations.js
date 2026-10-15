// Generates the illustrated placeholder images in public/img/illustrations/.
// They're shown when a project has no photo yet, and used by `npm run demo`.
// Usage: node scripts/generate-illustrations.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'illustrations');
const W = 1600, H = 1200;

const SKIES = {
  1: { top: '#9cc7e4', bottom: '#e9f1ec', sun: '#fff4d6', ground: '#7fa36a', ground2: '#6a8f57', tint: 'none' },
  2: { top: '#f3b884', bottom: '#fbe6c8', sun: '#fff1d0', ground: '#8b9a5b', ground2: '#76854b', tint: 'rgba(255,170,90,.10)' },
  3: { top: '#6f8fb0', bottom: '#d9c9b5', sun: '#ffe3b0', ground: '#6b8a5c', ground2: '#587649', tint: 'rgba(40,40,80,.08)' }
};

const WOOD = { light: '#e2b986', mid: '#c8955f', dark: '#a8743f', deep: '#6b4423', shadow: '#4a2f18' };

function defs(s) {
  return `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.top}"/><stop offset="1" stop-color="${s.bottom}"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe3ee"/><stop offset=".55" stop-color="#7f9fb3"/><stop offset="1" stop-color="#4f6b7d"/></linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${WOOD.dark}"/><stop offset="1" stop-color="${WOOD.mid}"/></linearGradient>
    <pattern id="slats" width="34" height="40" patternUnits="userSpaceOnUse"><rect width="34" height="40" fill="${WOOD.mid}"/><rect width="26" height="40" fill="${WOOD.light}"/><rect x="8" width="3" height="40" fill="${WOOD.mid}" opacity=".35"/></pattern>
    <pattern id="hboards" width="200" height="36" patternUnits="userSpaceOnUse"><rect width="200" height="36" fill="${WOOD.dark}"/><rect width="200" height="31" fill="${WOOD.mid}"/><rect x="40" y="10" width="70" height="2" fill="${WOOD.dark}" opacity=".35"/></pattern>
    <pattern id="bricks" width="80" height="40" patternUnits="userSpaceOnUse"><rect width="80" height="40" fill="#d8cfc4"/><rect x="2" y="2" width="76" height="16" fill="#a35b42"/><rect x="-38" y="22" width="76" height="16" fill="#9a523b"/><rect x="42" y="22" width="76" height="16" fill="#ad6449"/></pattern>
    <pattern id="tiles" width="50" height="34" patternUnits="userSpaceOnUse"><rect width="50" height="34" fill="#3d3b3a"/><rect x="1" y="1" width="48" height="28" rx="4" fill="#57524f"/></pattern>
    <pattern id="osb" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="#d9bb86"/><rect x="6" y="9" width="16" height="5" fill="#c7a46b" transform="rotate(20 14 11)"/><rect x="34" y="30" width="18" height="5" fill="#caa872" transform="rotate(-30 43 32)"/><rect x="14" y="44" width="12" height="4" fill="#bf9a5f"/></pattern>
    <pattern id="insul" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#f2d36b"/><path d="M0 20 Q10 8 20 20 T40 20" stroke="#e0bd4f" stroke-width="4" fill="none"/></pattern>
  </defs>`;
}

function backdrop(s, horizon = 900) {
  return `<rect width="${W}" height="${H}" fill="url(#sky)"/>
    <circle cx="1300" cy="230" r="90" fill="${s.sun}" opacity=".9"/>
    <g fill="#fff" opacity=".75"><ellipse cx="300" cy="200" rx="120" ry="34"/><ellipse cx="380" cy="180" rx="90" ry="40"/><ellipse cx="900" cy="140" rx="100" ry="26"/></g>
    <g fill="${s.ground2}" opacity=".7"><circle cx="90" cy="${horizon - 120}" r="110"/><circle cx="210" cy="${horizon - 80}" r="80"/><circle cx="1520" cy="${horizon - 110}" r="120"/></g>
    <rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${s.ground}"/>`;
}

function tree(x, y, s, scale = 1) {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><rect x="-10" y="-40" width="20" height="120" fill="${WOOD.deep}"/><circle cy="-120" r="95" fill="${s.ground2}"/><circle cx="-50" cy="-70" r="60" fill="${s.ground}"/><circle cx="55" cy="-80" r="65" fill="${s.ground2}"/></g>`;
}

const SCENES = {
  // House under construction: slab, stud walls, roof trusses, some OSB sheathing
  'timber-frame': s => {
    const studs = [];
    for (let x = 380; x <= 1220; x += 60) studs.push(`<rect x="${x}" y="500" width="18" height="380" fill="${WOOD.light}"/>`);
    const truss = [];
    for (let x = 360; x <= 1240; x += 110) truss.push(`<path d="M${x} 500 L800 230 M${x} 500 L${x} 500" stroke="${WOOD.mid}" stroke-width="12"/>`);
    return `${backdrop(s)}${tree(1450, 880, s, 1.1)}
      <rect x="320" y="880" width="960" height="40" fill="#b9b4ad"/><rect x="320" y="915" width="960" height="12" fill="#8f8a83"/>
      <rect x="360" y="862" width="880" height="20" fill="${WOOD.dark}"/><rect x="360" y="490" width="880" height="20" fill="${WOOD.dark}"/>
      ${studs.join('')}
      <rect x="360" y="510" width="300" height="352" fill="url(#osb)" opacity=".95"/>
      <rect x="760" y="600" width="140" height="180" fill="none" stroke="${WOOD.dark}" stroke-width="14"/>
      <path d="M340 500 L800 220 L1260 500 Z" fill="none" stroke="${WOOD.dark}" stroke-width="22" stroke-linejoin="round"/>
      ${truss.join('')}
      <path d="M570 372 L800 500 L1030 372 M800 220 L800 500" stroke="${WOOD.mid}" stroke-width="12" fill="none"/>
      <g stroke="#9aa3a8" stroke-width="8"><path d="M240 920 V420 M300 920 V420 M240 560 H300 M240 700 H300 M240 840 H300 M240 420 L300 560"/></g>`;
  },
  // Brick house with a timber-clad flat-roof extension and a big glazed opening
  'extension': s => `${backdrop(s)}${tree(1480, 900, s)}
      <rect x="170" y="420" width="560" height="480" fill="url(#bricks)"/>
      <path d="M140 430 L450 210 L760 430 Z" fill="url(#tiles)"/><rect x="140" y="420" width="620" height="16" fill="#3a3533"/>
      <rect x="250" y="520" width="120" height="150" fill="url(#glass)" stroke="#f2ede6" stroke-width="10"/><rect x="520" y="520" width="120" height="150" fill="url(#glass)" stroke="#f2ede6" stroke-width="10"/>
      <rect x="730" y="520" width="700" height="380" fill="url(#slats)"/>
      <rect x="715" y="500" width="730" height="30" fill="#2f2a26"/>
      <rect x="840" y="590" width="470" height="290" fill="url(#glass)"/><path d="M1000 590 V880 M1155 590 V880" stroke="#2f2a26" stroke-width="10"/><rect x="840" y="590" width="470" height="290" fill="none" stroke="#2f2a26" stroke-width="12"/>
      <path d="M880 610 L960 610 L880 700 Z" fill="#fff" opacity=".25"/>
      <path d="M760 900 L1460 900 L1520 960 L700 960 Z" fill="url(#hboards)"/>
      <rect x="1350" y="830" width="60" height="70" rx="6" fill="#7a6a5a"/><circle cx="1380" cy="810" r="40" fill="${s.ground2}"/>`,
  // Timber carport next to a house, with a car underneath
  'roof-carport': s => `${backdrop(s)}
      <rect x="100" y="430" width="500" height="470" fill="#efe7da"/><path d="M70 440 L350 250 L630 440 Z" fill="url(#tiles)"/>
      <rect x="200" y="540" width="110" height="130" fill="url(#glass)" stroke="#fff" stroke-width="8"/><rect x="400" y="700" width="110" height="200" fill="${WOOD.dark}"/>
      <rect x="560" y="900" width="1000" height="70" fill="#b5ab9c"/>
      <rect x="600" y="470" width="940" height="40" fill="${WOOD.dark}"/><rect x="590" y="455" width="960" height="22" fill="#3b3330"/>
      <rect x="610" y="510" width="920" height="22" fill="${WOOD.mid}"/>
      <g fill="${WOOD.mid}"><rect x="640" y="510" width="34" height="400"/><rect x="1060" y="510" width="34" height="400"/><rect x="1470" y="510" width="34" height="400"/></g>
      <g fill="${WOOD.dark}"><path d="M674 560 L740 510 H760 L674 590 Z"/><path d="M1060 560 L994 510 H974 L1060 590 Z"/><path d="M1094 560 L1160 510 H1180 L1094 590 Z"/><path d="M1470 560 L1404 510 H1384 L1470 590 Z"/></g>
      <path d="M780 860 Q790 760 880 740 L960 680 Q1010 660 1140 660 Q1260 660 1300 720 L1360 760 Q1400 780 1400 860 Z" fill="#355c7d"/>
      <path d="M985 690 L1060 690 L1060 745 L940 745 Z M1080 690 L1170 690 Q1230 690 1255 745 L1080 745 Z" fill="url(#glass)"/>
      <g fill="#222"><circle cx="900" cy="870" r="48"/><circle cx="1280" cy="870" r="48"/></g><g fill="#999"><circle cx="900" cy="870" r="20"/><circle cx="1280" cy="870" r="20"/></g>`,
  // Wooden deck in perspective in front of a clad façade with sliding doors
  'terrace-cladding': s => {
    const boards = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const y = 760 + Math.pow(t, 1.6) * 440;
      boards.push(`<path d="M${200 - t * 260} ${y} H${1400 + t * 260}" stroke="${WOOD.dark}" stroke-width="${2 + t * 4}"/>`);
    }
    return `<rect width="${W}" height="${H}" fill="url(#sky)"/>
      <rect x="0" y="120" width="${W}" height="640" fill="url(#hboards)"/>
      <rect x="0" y="100" width="${W}" height="30" fill="#2f2a26"/>
      <rect x="380" y="260" width="840" height="500" fill="url(#glass)"/><path d="M800 260 V760" stroke="#2f2a26" stroke-width="14"/><rect x="380" y="260" width="840" height="500" fill="none" stroke="#2f2a26" stroke-width="16"/>
      <path d="M430 290 L560 290 L430 450 Z M850 290 L930 290 L850 390 Z" fill="#fff" opacity=".22"/>
      <path d="M200 760 H1400 L1660 1200 H-60 Z" fill="${WOOD.mid}"/>${boards.join('')}
      <g transform="translate(150 700)"><rect x="-70" y="0" width="140" height="160" rx="8" fill="#5a524b"/><circle cy="-30" r="90" fill="${s.ground2}"/><circle cx="-50" cy="10" r="50" fill="${s.ground}"/></g>
      <g transform="translate(1180 930)" fill="${WOOD.deep}"><rect x="-120" y="-90" width="240" height="20" rx="6"/><rect x="-100" y="-70" width="16" height="110"/><rect x="84" y="-70" width="16" height="110"/></g>
      <g transform="translate(900 960)" fill="#e9e1d4"><rect x="-70" y="-120" width="140" height="22" rx="8"/><rect x="-70" y="-240" width="22" height="140" rx="8"/><rect x="-60" y="-100" width="12" height="110"/><rect x="48" y="-100" width="12" height="110"/></g>`;
  },
  // Interior: oak staircase, slatted wall, plank floor and a large window
  'interior': s => {
    const steps = [];
    for (let i = 0; i < 9; i++) steps.push(`<rect x="${760 + i * 70}" y="${880 - i * 70}" width="${520 - i * 70}" height="24" fill="${WOOD.mid}"/><rect x="${760 + i * 70}" y="${904 - i * 70}" width="${520 - i * 70}" height="46" fill="#f3ede4"/>`);
    const planks = [];
    for (let i = 0; i < 12; i++) planks.push(`<path d="M${800 + (i - 6) * 70} 950 L${800 + (i - 6) * 260} ${H}" stroke="${WOOD.dark}" stroke-width="3"/>`);
    return `<rect width="${W}" height="${H}" fill="#f4eee6"/>
      <rect x="120" y="180" width="460" height="560" fill="url(#sky)"/><rect x="120" y="180" width="460" height="560" fill="none" stroke="#2f2a26" stroke-width="16"/><path d="M350 180 V740" stroke="#2f2a26" stroke-width="10"/>
      <path d="M140 760 L620 760 L760 1200 L-100 1200 Z" fill="#fff6dd" opacity=".35"/>
      <rect x="1290" y="0" width="310" height="950" fill="url(#slats)"/>
      ${steps.join('')}
      <path d="M760 880 L1400 240" stroke="#2f2a26" stroke-width="8"/><path d="M800 600 V860 M900 500 V780 M1000 400 V680 M1100 300 V580" stroke="#2f2a26" stroke-width="4" opacity=".8"/>
      <rect x="0" y="950" width="${W}" height="${H - 950}" fill="url(#floor)"/>${planks.join('')}
      <g transform="translate(640 940)"><rect x="-55" y="-90" width="110" height="90" rx="10" fill="#d9cfc2"/><g fill="#5f8a55"><ellipse cx="-30" cy="-170" rx="30" ry="90" transform="rotate(-20 -30 -170)"/><ellipse cx="30" cy="-180" rx="28" ry="100" transform="rotate(18 30 -180)"/><ellipse cy="-200" rx="26" ry="110"/></g></g>`;
  },
  // Roof renovation: rafters, insulation and new tiles going on, with scaffolding
  'renovation': s => {
    return `${backdrop(s)}${tree(120, 900, s, .9)}
      <rect x="320" y="520" width="960" height="380" fill="#efe7da"/>
      <rect x="430" y="610" width="140" height="160" fill="url(#glass)" stroke="#fff" stroke-width="10"/><rect x="1030" y="610" width="140" height="160" fill="url(#glass)" stroke="#fff" stroke-width="10"/><rect x="740" y="700" width="120" height="200" fill="${WOOD.dark}"/>
      <path d="M280 530 L800 190 L800 530 Z" fill="url(#tiles)"/>
      <path d="M800 190 L1320 530 L800 530 Z" fill="url(#insul)"/>
      <g stroke="${WOOD.mid}" stroke-width="18">${[0, 1, 2, 3, 4, 5].map(i => `<path d="M${830 + i * 85} ${210 + i * 55.5} L${830 + i * 85} 530"/>`).join('')}</g>
      <path d="M800 190 L1320 530" stroke="${WOOD.dark}" stroke-width="24"/><path d="M800 190 L1060 360 L800 360 Z" fill="url(#tiles)" opacity=".95"/>
      <rect x="260" y="520" width="1080" height="20" fill="${WOOD.dark}"/>
      <g stroke="#9aa3a8" stroke-width="9"><path d="M1360 900 V460 M1440 900 V460 M1360 560 H1440 M1360 700 H1440 M1360 840 H1440 M1360 560 L1440 700"/><path d="M1290 560 H1460" stroke="${WOOD.mid}" stroke-width="14"/></g>`;
  }
};

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [name, draw] of Object.entries(SCENES)) {
  for (const [v, sky] of Object.entries(SKIES)) {
    const tint = sky.tint === 'none' ? '' : `<rect width="${W}" height="${H}" fill="${sky.tint}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${defs(sky)}${draw(sky)}${tint}</svg>\n`;
    fs.writeFileSync(path.join(OUT, `${name}-${v}.svg`), svg);
    count++;
  }
}
console.log(`Wrote ${count} illustrations to ${OUT}`);
