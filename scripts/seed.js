// Imports Timberway's projects (texts from the original site, translated to NL/EN).
// Photos are taken from seed/photos/<slug>/ in file-name order, if present;
// a project without photos shows an illustration until photos are added.
// Usage: npm run seed              (add or refresh these projects)
//        npm run seed -- --remove  (remove them again)
const fs = require('fs');
const path = require('path');
const store = require('../lib/db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const PHOTOS = path.join(__dirname, '..', 'seed', 'photos');
const IMAGE = /\.(jpe?g|png|webp|avif)$/i;

const PROJECTS = [
  {
    slug: 'ixelles', category: 'kitchen', location: 'Ixelles', year: '2025', featured: true,
    title: { fr: 'Cuisine en bois sur mesure – Ixelles', nl: 'Houten maatkeuken – Elsene', en: 'Bespoke wooden kitchen – Ixelles' },
    description: {
      fr: 'Cuisine sur mesure conçue pour s\'intégrer harmonieusement à l\'espace existant.\nUne attention particulière a été portée aux proportions, aux matériaux et aux finitions.',
      nl: 'Maatkeuken ontworpen om harmonieus op te gaan in de bestaande ruimte.\nBijzondere aandacht ging naar de verhoudingen, de materialen en de afwerking.',
      en: 'A bespoke kitchen designed to blend naturally into the existing space.\nSpecial attention was paid to proportions, materials and finishes.'
    },
    captions: [
      { fr: 'Cuisine existante avant transformation.', nl: 'Bestaande keuken vóór de verbouwing.', en: 'The existing kitchen before the makeover.' },
      { fr: 'Cuisine existante avant transformation.', nl: 'Bestaande keuken vóór de verbouwing.', en: 'The existing kitchen before the makeover.' },
      { fr: 'Phase de préparation et d\'adaptation de l\'espace.', nl: 'Voorbereiding en aanpassing van de ruimte.', en: 'Preparing and adapting the space.' },
      { fr: 'Restauration du parquet en bois.', nl: 'Restauratie van de houten parketvloer.', en: 'Restoring the wooden parquet floor.' },
      { fr: 'Détail des finitions et des lignes épurées.', nl: 'Detail van de afwerking en de strakke lijnen.', en: 'Detail of the finishes and clean lines.' },
      { fr: 'Îlot central en bois naturel, réalisé sur mesure.', nl: 'Kookeiland in natuurlijk hout, op maat gemaakt.', en: 'Made-to-measure kitchen island in natural wood.' },
      { fr: 'Vue d\'ensemble de la cuisine sur mesure.', nl: 'Overzicht van de maatkeuken.', en: 'Overview of the bespoke kitchen.' }
    ]
  },
  {
    slug: 'bruxelles-salle-de-bain', category: 'bathroom', location: 'Bruxelles', year: '2025', featured: true,
    title: { fr: 'Salle de bain & rangements sur mesure – Bruxelles', nl: 'Badkamer & opbergruimte op maat – Brussel', en: 'Bespoke bathroom & storage – Brussels' },
    description: {
      fr: 'Mobilier sur mesure réalisé pour une salle de bain, avec des rangements aux formes courbes conçus pour apporter douceur et fluidité à l\'espace.\nLe projet se distingue par la précision des détails, la qualité des matériaux et l\'équilibre entre esthétique et fonctionnalité.',
      nl: 'Maatmeubilair voor een badkamer, met gebogen opbergruimte die zachtheid en vloeiendheid in de ruimte brengt.\nHet project onderscheidt zich door precieze details, kwaliteitsvolle materialen en een evenwicht tussen esthetiek en functionaliteit.',
      en: 'Bespoke bathroom furniture with curved storage designed to bring softness and flow to the space.\nThe project stands out for its precise details, quality materials and balance between looks and function.'
    },
    captions: [
      { fr: 'Espace existant avant réaménagement.', nl: 'Bestaande ruimte vóór de herinrichting.', en: 'The space before the redesign.' },
      { fr: 'Espace existant avant réaménagement.', nl: 'Bestaande ruimte vóór de herinrichting.', en: 'The space before the redesign.' },
      { fr: 'Espace existant avant réaménagement.', nl: 'Bestaande ruimte vóór de herinrichting.', en: 'The space before the redesign.' },
      { fr: 'Phase de préparation et d\'adaptation de l\'espace.', nl: 'Voorbereiding en aanpassing van de ruimte.', en: 'Preparing and adapting the space.' },
      { fr: 'Phase de préparation et d\'adaptation de l\'espace.', nl: 'Voorbereiding en aanpassing van de ruimte.', en: 'Preparing and adapting the space.' },
      { fr: 'Vue d\'ensemble de la salle de bain sur mesure.', nl: 'Overzicht van de badkamer op maat.', en: 'Overview of the bespoke bathroom.' },
      { fr: 'Vue d\'ensemble de la salle de bain sur mesure.', nl: 'Overzicht van de badkamer op maat.', en: 'Overview of the bespoke bathroom.' },
      { fr: 'Rangements sur mesure aux lignes courbes.', nl: 'Opbergruimte op maat met gebogen lijnen.', en: 'Made-to-measure storage with curved lines.' },
      { fr: 'Rangements sur mesure aux lignes courbes.', nl: 'Opbergruimte op maat met gebogen lijnen.', en: 'Made-to-measure storage with curved lines.' }
    ]
  }
];

const db = store.load();
const seeded = a => typeof a.seed === 'string';

// Refresh: drop earlier seeded copies (and their files) so running twice doesn't duplicate.
for (const a of db.albums.filter(seeded)) {
  for (const p of a.photos) fs.rmSync(path.join(UPLOAD_DIR, p.file), { force: true });
}
db.albums = db.albums.filter(a => !seeded(a));

if (process.argv.includes('--remove')) {
  store.save();
  console.log('Seeded projects removed.');
  process.exit(0);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
PROJECTS.forEach((proj, i) => {
  const { slug, captions, ...fields } = proj;
  const dir = path.join(PHOTOS, slug);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => IMAGE.test(f)).sort() : [];
  const photos = files.map((f, n) => {
    const file = `seed-${slug}-${f}`;
    fs.copyFileSync(path.join(dir, f), path.join(UPLOAD_DIR, file));
    return { id: store.id(), file, caption: captions[n] || { fr: '', nl: '', en: '' } };
  });
  // Cover: the last photo (the finished result), not a "before" shot.
  const cover = photos[photos.length - 1];
  db.albums.push({
    id: store.id(), seed: slug, ...fields, published: true, photos, coverId: cover ? cover.id : null,
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
  console.log(`  ${fields.title.fr}: ${photos.length} photo(s)`);
});
store.save();
console.log('Done. Remove with: npm run seed -- --remove');
