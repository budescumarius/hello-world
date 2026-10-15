// Adds six demo projects with illustrated images, so the site can be previewed before real photos exist.
// Usage: npm run demo            (add demo projects)
//        npm run demo -- --remove (remove them again)
const fs = require('fs');
const path = require('path');
const store = require('../lib/db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const ILLU = path.join(__dirname, '..', 'public', 'img', 'illustrations');

const DEMO = [
  { category: 'extension', location: 'Gent', year: '2026', featured: true,
    title: { nl: 'Houten aanbouw met grote glaspartij', fr: 'Extension en bois avec grande baie vitrée', en: 'Timber extension with large glazing' },
    description: { nl: 'Leefkeuken van 35 m² achter een rijwoning, afgewerkt met verticale gevelbekleding en een terras.', fr: 'Cuisine ouverte de 35 m² à l\'arrière d\'une maison mitoyenne, bardage vertical et terrasse.', en: '35 m² kitchen-diner behind a terraced house, finished with vertical cladding and a deck.' } },
  { category: 'timber-frame', location: 'Leuven', year: '2025', featured: true,
    title: { nl: 'Nieuwbouw in houtskelet', fr: 'Maison neuve en ossature bois', en: 'New timber frame home' },
    description: { nl: 'Prefab wanden en dakspanten, winddicht in twee weken.', fr: 'Murs et fermes préfabriqués, hors d\'eau en deux semaines.', en: 'Prefabricated walls and trusses, weathertight in two weeks.' } },
  { category: 'roof-carport', location: 'Namur', year: '2025', featured: false,
    title: { nl: 'Carport in eik', fr: 'Carport en chêne', en: 'Oak carport' },
    description: { nl: 'Dubbele carport met plat dak en geïntegreerde regenafvoer.', fr: 'Carport double à toit plat avec évacuation intégrée.', en: 'Double carport with a flat roof and built-in drainage.' } },
  { category: 'terrace-cladding', location: 'Brugge', year: '2024', featured: false,
    title: { nl: 'Terras en gevelbekleding', fr: 'Terrasse et bardage', en: 'Deck and façade cladding' },
    description: { nl: 'Thermisch gewijzigd hout voor terras en gevel, onderhoudsarm.', fr: 'Bois thermotraité pour la terrasse et la façade, peu d\'entretien.', en: 'Thermally modified timber for deck and façade, low maintenance.' } },
  { category: 'interior', location: 'Brussel', year: '2024', featured: false,
    title: { nl: 'Zwevende eiken trap', fr: 'Escalier flottant en chêne', en: 'Floating oak staircase' },
    description: { nl: 'Maatwerk trap met lattenwand in eik.', fr: 'Escalier sur mesure avec paroi à lattes en chêne.', en: 'Bespoke staircase with an oak slatted wall.' } },
  { category: 'renovation', location: 'Liège', year: '2023', featured: false,
    title: { nl: 'Dakrenovatie met isolatie', fr: 'Rénovation de toiture avec isolation', en: 'Roof renovation with insulation' },
    description: { nl: 'Nieuwe dakopbouw, isolatie en pannen voor een betere EPC.', fr: 'Nouvelle toiture, isolation et tuiles pour un meilleur PEB.', en: 'New roof build-up, insulation and tiles for a better EPC.' } }
];

const db = store.load();
const isDemo = a => a.demo === true;

// Always start from a clean slate so running the script twice doesn't duplicate.
for (const a of db.albums.filter(isDemo)) {
  for (const p of a.photos) fs.rmSync(path.join(UPLOAD_DIR, p.file), { force: true });
}
db.albums = db.albums.filter(a => !isDemo(a));

if (process.argv.includes('--remove')) {
  store.save();
  console.log('Demo projects removed.');
  process.exit(0);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
DEMO.forEach((d, i) => {
  const photos = [1, 2, 3].map(v => {
    const file = `demo-${d.category}-${v}.svg`;
    fs.copyFileSync(path.join(ILLU, `${d.category}-${v}.svg`), path.join(UPLOAD_DIR, file));
    return { id: store.id(), file, caption: { nl: '', fr: '', en: '' } };
  });
  db.albums.push({
    id: store.id(), demo: true, ...d, published: true, photos, coverId: photos[0].id,
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
});
store.save();
console.log(`Added ${DEMO.length} demo projects. Remove them later with: npm run demo -- --remove`);
