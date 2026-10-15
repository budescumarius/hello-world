// Imports Timberway's projects with their photos (French text, translated to NL/EN).
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

const t = (fr, nl, en) => ({ fr, nl, en });

const PROJECTS = [
  {
    slug: 'cuisine-campagne-ilot-chene', category: 'kitchen', featured: true, cover: 0,
    title: t('Cuisine campagne chic & îlot en chêne', 'Landelijke keuken met eiken eiland', 'Country-style kitchen with oak island'),
    description: t(
      'Cuisine sur mesure aux façades bleu pastel, vitrines cannées et hotte enduite, autour d\'un îlot en chêne rustique avec plan en quartz.',
      'Maatkeuken met pastelblauwe fronten, kastjes met rieten vlechtwerk en een gepleisterde dampkap, rond een rustiek eiken eiland met kwartsblad.',
      'Bespoke kitchen with pastel blue fronts, cane-panelled cabinets and a plastered hood, around a rustic oak island with a quartz top.'),
    captions: [
      t('Vue d\'ensemble de la cuisine.', 'Overzicht van de keuken.', 'Overview of the kitchen.'),
      t('Îlot central en chêne massif, tiroirs et poignées laiton.', 'Kookeiland in massief eiken, lades en messing grepen.', 'Solid oak island with drawers and brass handles.')
    ]
  },
  {
    slug: 'bibliotheque-arches-bleue', category: 'furniture', featured: true,
    title: t('Bibliothèque en arches & meuble TV', 'Boekenkast met bogen & tv-meubel', 'Arched bookcase & TV wall'),
    description: t(
      'Meuble mural sur mesure : niches en arche, étagères en chêne, panneau TV et cheminée électrique intégrée.',
      'Wandmeubel op maat: boognissen, eiken legplanken, tv-paneel en ingebouwde elektrische haard.',
      'Bespoke wall unit with arched niches, oak shelves, a TV panel and a built-in electric fireplace.'),
    captions: [t('Meuble mural bleu et chêne sur parquet en chevron.', 'Blauw en eiken wandmeubel op visgraatparket.', 'Blue and oak wall unit over herringbone parquet.')]
  },
  {
    slug: 'escalier-rangement-chene', category: 'stairs', featured: true,
    title: t('Escalier-rangement en chêne', 'Eiken trap met opbergruimte', 'Oak staircase with storage'),
    description: t(
      'Escalier sculptural en chêne menant à une mezzanine, avec placards intégrés aux angles arrondis.',
      'Sculpturale eiken trap naar een mezzanine, met ingebouwde kasten met afgeronde hoeken.',
      'A sculptural oak staircase up to a mezzanine, with built-in cupboards with rounded corners.'),
    captions: [t('Escalier et placards en chêne.', 'Trap en kasten in eiken.', 'Oak staircase and cupboards.')]
  },
  {
    slug: 'meuble-vasque-courbe', category: 'bathroom',
    title: t('Meuble double vasque aux lignes courbes', 'Dubbel badkamermeubel met gebogen lijnen', 'Curved double vanity unit'),
    description: t(
      'Meuble de salle de bain sur mesure aux angles arrondis, façades sans poignées et plan double vasque.',
      'Badkamermeubel op maat met afgeronde hoeken, greeploze fronten en dubbele wastafel.',
      'Bespoke bathroom unit with rounded corners, handleless fronts and a double basin top.'),
    captions: [t('Meuble vasque aux formes courbes.', 'Wastafelmeubel met gebogen vormen.', 'Vanity unit with curved shapes.')]
  },
  {
    slug: 'parquet-chevron-loft', category: 'parquet',
    title: t('Parquet en chevron – loft', 'Visgraatparket – loft', 'Herringbone parquet – loft'),
    description: t(
      'Pose d\'un parquet en chêne en chevron dans un grand loft industriel.',
      'Plaatsing van eiken visgraatparket in een grote industriële loft.',
      'Oak herringbone parquet laid in a large industrial loft.'),
    captions: [t('Parquet en chêne posé en chevron.', 'Eiken parket in visgraat gelegd.', 'Oak parquet laid in herringbone.')]
  },
  {
    slug: 'bibliotheque-tv-verte', category: 'furniture',
    title: t('Meuble TV & bibliothèque vert sauge', 'Tv-meubel & boekenkast in saliegroen', 'Sage green TV unit & bookcase'),
    description: t(
      'Ensemble mural avec arches, lambris bois, étagères en chêne et foyer intégré.',
      'Wandgeheel met bogen, houten lambrisering, eiken legplanken en ingebouwde haard.',
      'Wall unit with arches, wood panelling, oak shelves and a built-in fireplace.'),
    captions: [t('Bibliothèque en arches et foyer intégré.', 'Boekenkast met bogen en ingebouwde haard.', 'Arched bookcase with built-in fireplace.')]
  },
  {
    slug: 'hotte-chene-sur-mesure', category: 'kitchen',
    title: t('Hotte en chêne sur mesure', 'Eiken dampkap op maat', 'Bespoke oak range hood'),
    description: t(
      'Habillage de hotte en chêne aux lignes courbes, moulures teintées noir et rivets laiton.',
      'Eiken dampkapbekleding met gebogen lijnen, zwarte lijsten en messing nagels.',
      'Curved oak hood cladding with black mouldings and brass studs.'),
    captions: [t('Détail des courbes et des moulures.', 'Detail van de rondingen en lijsten.', 'Detail of the curves and mouldings.')]
  },
  {
    slug: 'dressing-sous-combles', category: 'furniture',
    title: t('Dressing sous combles', 'Dressing onder het dak', 'Attic walk-in wardrobe'),
    description: t(
      'Dressing sur mesure épousant la pente du toit, avec éclairage LED, penderies escamotables et tiroirs.',
      'Dressing op maat die de dakhelling volgt, met ledverlichting, neerklapbare kledingstangen en lades.',
      'Made-to-measure wardrobe following the roof slope, with LED lighting, pull-down rails and drawers.'),
    captions: [t('Dressing éclairé sous les combles.', 'Verlichte dressing onder het dak.', 'Lit wardrobe in the attic.')]
  },
  {
    slug: 'armoire-sous-pente', category: 'furniture',
    title: t('Armoire sous pente – chambre d\'enfant', 'Kast onder schuin dak – kinderkamer', 'Sloped-ceiling wardrobe – kids\' room'),
    description: t(
      'Armoire sur mesure adaptée au plafond en pente, façades imprimées et niche ouverte.',
      'Maatkast aangepast aan het schuine plafond, met bedrukte fronten en open nis.',
      'Bespoke wardrobe fitted to the sloping ceiling, with printed fronts and an open niche.'),
    captions: [t('Armoire sous pente aux façades graphiques.', 'Kast onder schuin dak met grafische fronten.', 'Sloped wardrobe with graphic fronts.')]
  },
  {
    slug: 'rangements-sous-escalier', category: 'stairs',
    title: t('Rangements sous escalier', 'Opbergkasten onder de trap', 'Under-stair storage'),
    description: t(
      'Placards intégrés sous l\'escalier, façades sans poignées et garde-corps en bois.',
      'Ingebouwde kasten onder de trap, greeploze fronten en houten leuning.',
      'Built-in cupboards under the stairs, handleless fronts and a wooden balustrade.'),
    captions: [t('Placards affleurants sous l\'escalier.', 'Vlakke kasten onder de trap.', 'Flush cupboards under the stairs.')]
  },
  {
    slug: 'comptoir-restaurant', category: 'stairs',
    title: t('Comptoir de restaurant', 'Toog voor een restaurant', 'Restaurant counter'),
    description: t(
      'Agencement commercial : comptoir sur mesure en lames effet marbre noir, plan en chêne et vitrine intégrée.',
      'Winkelinrichting: toog op maat met lamellen in zwart marmereffect, eiken blad en ingebouwde vitrine.',
      'Commercial fit-out: a bespoke counter with black marble-effect slats, an oak top and a built-in display case.'),
    captions: [t('Comptoir rétroéclairé et vitrine.', 'Verlichte toog en vitrine.', 'Backlit counter and display case.')]
  },
  {
    slug: 'escalier-chene-quart-tournant', category: 'stairs',
    title: t('Escalier en chêne quart tournant', 'Eiken kwartdraaitrap', 'Quarter-turn oak staircase'),
    description: t(
      'Escalier en chêne massif réalisé sur mesure, pendant la phase de pose.',
      'Massief eiken trap op maat, tijdens de plaatsing.',
      'A made-to-measure solid oak staircase, during installation.'),
    captions: [t('Pose de l\'escalier en chêne.', 'Plaatsing van de eiken trap.', 'Installing the oak staircase.')]
  },
  {
    slug: 'cuisine-grise-en-l', category: 'kitchen',
    title: t('Cuisine en L', 'L-vormige keuken', 'L-shaped kitchen'),
    description: t(
      'Cuisine en L avec façades à cadre, colonne four et long plan de travail.',
      'L-vormige keuken met kaderfronten, ovenkolom en lang werkblad.',
      'L-shaped kitchen with framed fronts, an oven tower and a long worktop.'),
    captions: [t('Vue d\'ensemble.', 'Overzicht.', 'Overview.')]
  },
  {
    slug: 'kitchenette-blanche', category: 'kitchen',
    title: t('Kitchenette compacte', 'Compacte kitchenette', 'Compact kitchenette'),
    description: t(
      'Petite cuisine optimisée : rangements jusqu\'au plafond et électroménager intégré.',
      'Kleine, geoptimaliseerde keuken: kasten tot aan het plafond en ingebouwde toestellen.',
      'A small, optimised kitchen with floor-to-ceiling storage and built-in appliances.'),
    captions: [t('Kitchenette blanche sur mesure.', 'Witte kitchenette op maat.', 'White bespoke kitchenette.')]
  },
  {
    slug: 'ixelles', category: 'kitchen', location: 'Ixelles', year: '2025',
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
    slug: 'bruxelles-salle-de-bain', category: 'bathroom', location: 'Bruxelles', year: '2025',
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
  const { slug, captions, cover: coverIndex, ...fields } = proj;
  const dir = path.join(PHOTOS, slug);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => IMAGE.test(f)).sort() : [];
  const photos = files.map((f, n) => {
    const file = `seed-${slug}-${f}`;
    fs.copyFileSync(path.join(dir, f), path.join(UPLOAD_DIR, file));
    return { id: store.id(), file, caption: captions[n] || { fr: '', nl: '', en: '' } };
  });
  // Cover: the last photo (usually the finished result, not a "before" shot) unless set explicitly.
  const cover = photos[coverIndex ?? photos.length - 1];
  // Projects without photos stay hidden until photos are added in the admin.
  db.albums.push({
    id: store.id(), seed: slug, location: '', year: '', featured: false, ...fields, published: photos.length > 0, photos, coverId: cover ? cover.id : null,
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
  console.log(`  ${fields.title.fr}: ${photos.length} photo(s)`);
});
store.save();
console.log('Done. Remove with: npm run seed -- --remove');
