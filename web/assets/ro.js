'use strict';
/* Interface en roumain pour le responsable et le terrain (choix 🌐, voir tLang) : les textes affichés sont remplacés à l'écran.
   Le bureau reste en français, et les documents (devis, factures, PDF : .doc) ne sont jamais traduits. */

const RO_UI = {
  // commun
  'Retour': 'Înapoi', 'Fermer': 'Închide', 'Annuler': 'Anulează', 'Enregistrer': 'Salvează', 'Valider': 'Confirmă', 'Supprimer': 'Șterge', 'Modifier': 'Modifică',
  'Ajouter': 'Adaugă', 'Ajouter…': 'Adaugă…', 'Nouveau': 'Nou', 'Actions': 'Acțiuni', "Plus d'actions": 'Mai multe acțiuni', 'Rechercher…': 'Caută…', 'Tous': 'Toate', 'Toutes': 'Toate', 'Tout': 'Tot',
  'Tout voir': 'Vezi tot', 'Total': 'Total', 'Date': 'Dată', 'Date ▼': 'Dată ▼', 'Statut': 'Stare', 'Catégorie': 'Categorie', 'Photos': 'Poze', 'Enregistré': 'Salvat', 'Modification…': 'Se modifică…',
  'Rechercher ou faire…': 'Caută sau fă…', 'Rechercher ou faire une action': 'Caută sau fă o acțiune', 'Espaces': 'Meniu', 'Mon compte': 'Contul meu',
  'Remonter en haut': 'Sus', 'Remonter en haut de la page': 'Sus în pagină', "Aujourd'hui": 'Azi', 'Itinéraire': 'Traseu', 'Chantier': 'Șantier', 'Chantiers': 'Șantiere', 'chantier': 'șantier',
  'En cours': 'În lucru', 'En préparation': 'În pregătire', 'Avant-projet': 'Ante-proiect', 'Réception': 'Recepție', 'Terminé': 'Terminat', 'Annulé': 'Anulat', 'Terminés': 'Terminate', 'Terminées': 'Terminate',
  'Journée': 'Zi întreagă', 'Matin': 'Dimineața', 'Après-midi': 'După-amiaza', 'Heures': 'Ore', 'heures': 'ore', 'Plans': 'Planuri', 'Plan': 'Plan', 'Point': 'Punct', 'Points': 'Puncte', 'Rapport': 'Raport', 'Rapports': 'Rapoarte',
  'Documents': 'Documente', 'Équipe': 'Echipă', 'Responsable': 'Responsabil', 'Client': 'Client', 'Adresse': 'Adresă', 'Début': 'Început', 'Fin prévue': 'Final prevăzut', 'Échéance': 'Termen',
  'Notifications': 'Notificări', 'Activer les notifications sur cet appareil': 'Activează notificările pe acest telefon', 'Mon profil': 'Profilul meu',
  "Installer l'application sur le téléphone": 'Instalează aplicația pe telefon', 'Conditions et confidentialité': 'Condiții și confidențialitate', 'Se déconnecter': 'Deconectare',
  'Activer les notifications': 'Activează notificările', 'Pour ne rien rater du bureau': 'Ca să nu pierzi nimic de la birou',
  // planning
  'Planning des équipes': 'Planningul echipelor', '‹ Semaine préc.': '‹ Săpt. trecută', 'Cette semaine': 'Săptămâna asta', 'Semaine suiv. ›': 'Săpt. următoare ›',
  'Copier la semaine précédente': 'Copiază săptămâna trecută', 'Semaine (grille)': 'Săptămână (tabel)', 'Diagramme': 'Diagramă', 'Ouvrier': 'Muncitor', 'équipe du chantier': 'echipa șantierului',
  'Autre chantier': 'Alt șantier', 'sous-traitant du chantier': 'subcontractor pe șantier',
  "Cliquez sur une case pour affecter un ouvrier à un chantier · glissez une affectation pour la déplacer · en pointillé : attribué par une phase ou par l'équipe / les sous-traitants du chantier (jours ouvrables).": 'Atinge o căsuță ca să repartizezi un muncitor pe un șantier · trage o repartizare ca s-o muți · punctat: atribuit printr-o etapă sau prin echipa / subcontractorii șantierului (zile lucrătoare).',
  'Planning des chantiers': 'Planningul șantierelor', 'Chantiers + phases': 'Șantiere + etape', 'Afficher aussi les terminés': 'Arată și cele terminate', 'Jours': 'Zile', 'Semaines': 'Săptămâni', 'Mois': 'Luni',
  'Planifié': 'Planificat', 'En retard': 'Întârziat',
  'La barre va du début à la fin prévue du chantier (fiche du chantier) ; sans dates, elles sont reprises des phases. Cliquez sur une barre pour ouvrir le planning du chantier.': 'Bara merge de la începutul până la finalul prevăzut al șantierului; fără date, sunt luate din etape. Atinge o bară ca să deschizi planningul șantierului.',
  'Détails (jours de planning, phases)': 'Detalii (zile de planning, etape)', 'Personne / chantier': 'Persoană / șantier',
  'Pour chaque personne : ses chantiers, du début à la fin prévue. La pastille de couleur devant le nom choisit la couleur de la personne.': 'Pentru fiecare persoană: șantierele ei, de la început până la finalul prevăzut. Bulina colorată din fața numelui alege culoarea persoanei.',
  'Générer depuis un devis': 'Generează din deviz', 'Nouvelle phase': 'Etapă nouă', 'Phase': 'Etapă',
  // projet
  'Résumé': 'Rezumat', 'Ajouter des plans (PDF / image)': 'Adaugă planuri (PDF / imagine)',
  'Remarques et photos envoyées par le terrain, rapports envoyés à vos ouvriers et sous-traitants.': 'Observații și poze trimise de pe teren, rapoarte trimise muncitorilor și subcontractorilor.',
  'Envoyer un rapport': 'Trimite un raport', 'Ajouter des fichiers': 'Adaugă fișiere', 'Glissez des fichiers ici': 'Trage fișierele aici',
  "Vue d'ensemble": 'Ansamblu', 'Budget HT (devis acceptés)': 'Buget fără TVA (devize acceptate)', 'Déboursé prévu': 'Cost prevăzut', 'Coût réel': 'Cost real', 'Engagé (commandes ouvertes)': 'Angajat (comenzi deschise)',
  'Facturé HT': 'Facturat fără TVA', 'Encaissé TVAC': 'Încasat cu TVA', 'Reste à encaisser': 'Rămas de încasat', 'Marge estimée': 'Marjă estimată', 'Prévu / réel par type de déboursé': 'Prevăzut / real pe tip de cost',
  "Main d'œuvre": 'Manoperă', 'Matériaux': 'Materiale', 'Sous-traitance': 'Subcontractare', 'Suivi de chantier': 'Urmărirea șantierului', 'Voir les points': 'Vezi punctele', 'Points ouverts': 'Puncte deschise',
  'Points en retard': 'Puncte întârziate', 'Avancement': 'Avans', 'Heures prestées': 'Ore lucrate', 'Obligations sociales': 'Obligații sociale', 'Déclaration de travaux (30bis)': 'Declarație de lucrări (30bis)',
  'Voir / modifier': 'Vezi / modifică', 'Conducteur': 'Responsabil', 'Activité récente': 'Activitate recentă', 'a créé': 'a creat', 'a modifié': 'a modificat', 'facture': 'factură', 'billreq': 'cerere de factură',
  'Ouvert': 'Deschis', 'Levé': 'Rezolvat', 'Clôturé': 'Închis', 'Envoyer aux intervenants': 'Trimite celor implicați', 'Rapport PDF': 'Raport PDF', 'Nouveau point': 'Punct nou', 'Ouverts + en cours': 'Deschise + în lucru',
  'Intervenant': 'Executant', 'Encoder des heures': 'Introdu ore', 'Total du chantier': 'Total șantier', 'Par mois': 'Pe luni', 'mois en cours': 'luna curentă', 'Travail': 'Lucru', 'Coût': 'Cost',
  'Ajouter au chantier': 'Adaugă la șantier', 'Devis': 'Estimativ', 'Demander une facture au bureau': 'Cere o factură de la birou', 'Commande fournisseur': 'Comandă la furnizor',
  'Point (observation / réserve)': 'Punct (observație / rezervă)', 'PV de réunion': 'Proces-verbal de ședință', 'Rapport au terrain (ouvriers, sous-traitants)': 'Raport pentru teren (muncitori, subcontractori)', 'Tâche': 'Sarcină',
  // bibliothèque, tâches, personnel
  'Bibliothèque': 'Biblioteca', 'Remplir depuis achats et devis': 'Completează din achiziții și devize', 'Importer Excel / CSV': 'Importă Excel / CSV', 'Exporter CSV': 'Exportă CSV', 'Indexer les prix': 'Indexează prețurile',
  'Nouvel article': 'Articol nou', 'Matériel': 'Echipament', 'Divers': 'Diverse', 'Ouvrage (composé)': 'Lucrare (compusă)', 'Ouvrage': 'Lucrare', 'Ouvrages': 'Lucrări', 'Prix en hausse': 'Prețuri în creștere', 'Code': 'Cod',
  'Désignation': 'Denumire', 'Unité': 'Unitate', 'Déboursé': 'Cost', 'Dernier achat': 'Ultima achiziție', 'Marge': 'Marjă', 'Prix HT': 'Preț fără TVA', 'forfait': 'forfet',
  "Prix d'achat des factures fournisseurs validées et prix de vente des devis acceptés": 'Prețuri de achiziție din facturile furnizorilor și prețuri de vânzare din devizele acceptate',
  'Tâches': 'Sarcini', 'Nouvelle tâche': 'Sarcină nouă', 'Mes tâches': 'Sarcinile mele', 'Toutes à faire': 'Toate de făcut', 'Aucune tâche': 'Nicio sarcină',
  "Accès à l'application ✓": 'Acces la aplicație ✓', 'Fiche du personnel': 'Fișa personalului', 'Chantiers en cours': 'Șantiere în lucru', 'Heures ce mois': 'Ore luna asta', 'Points à traiter': 'Puncte de rezolvat',
  'Ses chantiers dans le temps': 'Șantierele lui în timp', 'Chantier / affectation': 'Șantier / repartizare', 'Chantiers attribués': 'Șantiere atribuite', 'Planning à venir': 'Planning viitor',
  'Barre du chantier : du début à la fin prévue · en dessous : ses jours au planning des équipes (regroupés en périodes) et ses phases.': 'Bara șantierului: de la început până la finalul prevăzut · dedesubt: zilele lui din planning (pe perioade) și etapele lui.',
  'Heures encodées': 'Ore introduse', 'Tout le pointage': 'Tot pontajul', 'à créer': 'de creat', 'Points sur plan attribués': 'Puncte pe plan atribuite',
  'Pointage': 'Pontaj', 'Export (secrétariat social)': 'Export (secretariat social)', "Coût main d'œuvre": 'Cost manoperă', 'Chantiers à créer': 'Șantiere de creat',
  "Heures encodées sur un chantier qui n'existe pas encore": 'Ore introduse pe un șantier care încă nu există', 'Créer / rattacher': 'Creează / atașează', 'archives': 'arhivă',
  'Absences': 'Absențe', 'Nouvelle absence': 'Absență nouă', 'En cours et à venir': 'În curs și viitoare', 'Aucune absence': 'Nicio absență',
  // estimatif (éditeur de devis)
  'Estimatif': 'Estimativ', 'Estimatif en préparation': 'Estimativ în lucru', 'À vérifier par le bureau': 'De verificat la birou', 'À revoir': 'De revăzut', 'Objet': 'Obiect', 'À définir': 'De stabilit',
  'Date · validité': 'Dată · valabilitate', "Chiffrez les postes. Quand c'est prêt, envoyez-le au bureau : il le vérifie et en fait un devis.": 'Calculează pozițiile. Când e gata, trimite-l la birou: îl verifică și face din el un deviz.',
  'Envoyer au bureau pour vérification': 'Trimite la birou pentru verificare', 'Reprendre pour modifier': 'Reia pentru modificare', 'Estimatif envoyé au bureau ✓': 'Estimativ trimis la birou ✓',
  'Vous pouvez le modifier': 'Îl poți modifica', 'Remarque du bureau :': 'Observația biroului:', 'À envoyer': 'De trimis', 'Envoyé': 'Trimis', 'Accepté': 'Acceptat', 'Refusé': 'Refuzat',
  'Qté': 'Cant.', 'Déboursé u.': 'Cost unit.', 'Marge %': 'Marjă %', 'PU HT': 'Preț unit.', 'TVA': 'TVA', 'Total HT': 'Total fără TVA', 'Total TVAC': 'Total cu TVA', 'Déboursé sec': 'Cost direct', 'Marge brute': 'Marjă brută',
  'Aucune ligne. Ajoutez un chapitre, une ligne ou des éléments de la bibliothèque.': 'Nicio linie. Adaugă un capitol, o linie sau elemente din bibliotecă.',
  'Chapitre': 'Capitol', 'Sous-chapitre': 'Subcapitol', 'Ligne': 'Linie', 'Texte': 'Text', 'Depuis la bibliothèque': 'Din bibliotecă', 'Importer Excel / PDF': 'Importă Excel / PDF', 'Afficher déboursés et marges': 'Arată costuri și marje',
  'Titre du chapitre': 'Titlul capitolului', 'Titre du sous-chapitre': 'Titlul subcapitolului', 'TVA de toutes les lignes': 'TVA pentru toate liniile', 'Texte libre / commentaire': 'Text liber / comentariu',
  'Objet du devis': 'Obiectul estimativului', 'Objet du devis *': 'Obiectul estimativului *', '+ Nouveau contact…': '+ Contact nou…', "— aucun (créé à l'acceptation) —": '— niciunul —', "Valable jusqu'au": 'Valabil până la',
  'Votre référence': 'Referința clientului', 'Remise globale %': 'Reducere globală %', 'Autoliquidation (TVA due par le client assujetti)': 'Taxare inversă (TVA plătită de client)', 'Adresse du chantier': 'Adresa șantierului',
  "Texte d'introduction": 'Text de introducere', 'Conditions / mentions en bas du devis': 'Condiții / mențiuni la final',
  "Modifier l'en-tête (objet, client, projet)": 'Modifică antetul (obiect, client, proiect)', "Supprimer l'estimatif": 'Șterge estimativul',
  'Ajouter depuis la bibliothèque': 'Adaugă din bibliotecă', 'Tous les types': 'Toate tipurile', 'Rechercher (code, nom, catégorie)…': 'Caută (cod, nume, categorie)…', 'Quantité': 'Cantitate',
  'TVA de tout ce chapitre…': 'TVA pentru tot capitolul…', 'Transformer en sous-chapitre': 'Transformă în subcapitol', 'Transformer en chapitre': 'Transformă în capitol', 'Insérer une ligne en dessous': 'Inserează o linie dedesubt',
  'Insérer depuis la bibliothèque en dessous': 'Inserează din bibliotecă dedesubt', 'Monter': 'Mută sus', 'Descendre': 'Mută jos', 'Dupliquer': 'Duplică', 'Supprimer avec tout son contenu': 'Șterge cu tot conținutul',
  'Supprimer la ligne': 'Șterge linia', 'En option': 'Opțional', 'Option': 'Opțiune',
  // terrain
  'Mes heures': 'Orele mele', 'à encoder': 'de introdus', 'photos, remarques': 'poze, observații', 'À faire': 'De făcut', 'Mon planning ici': 'Planningul meu aici', 'Du bureau': 'De la birou',
  'plans du chantier': 'planurile șantierului', 'Rien reçu du bureau pour ce chantier.': 'Nimic primit de la birou pentru acest șantier.', "Rien d'encodé ce jour-là.": 'Nimic introdus în ziua asta.',
  'Ajouter des heures': 'Adaugă ore', 'Modifier mes heures': 'Modifică orele', 'Total du mois': 'Total pe lună', 'Mois clôturé. Pour une correction, demandez au bureau.': 'Lună închisă. Pentru o corectare, cere biroului.',
  'Aucune heure ce mois-là.': 'Nicio oră în luna aceea.', 'Messages du bureau': 'Mesaje de la birou', 'Prendre des photos': 'Fă poze', 'Remarques': 'Observații', 'Envoyer au bureau': 'Trimite la birou',
  'Ce qui a été fait, ce qui manque, les problèmes…': 'Ce s-a făcut, ce lipsește, problemele…', 'Dicter': 'Dictează', 'Mes travaux prévus': 'Lucrările mele planificate', 'Plans du chantier': 'Planurile șantierului',
  'Fait – le bureau vérifie': 'Gata – biroul verifică', 'Validé ✓': 'Validat ✓', 'Filtres': 'Filtre', 'Annoter': 'Adnotează', "C'est fait": 'Gata, e făcut', 'Ajouter une photo': 'Adaugă o poză',
  'Commentaires': 'Comentarii', 'Pas encore de commentaire.': 'Încă niciun comentariu.', 'Envoyer le commentaire': 'Trimite comentariul', 'Écrire un commentaire…': 'Scrie un comentariu…',
  '➕ Autre chantier (pas dans la liste)': '➕ Alt șantier (nu e în listă)', 'Nom ou adresse du chantier': 'Numele sau adresa șantierului',
  "Un chantier où le bureau vous a envoyé et qui n'est pas encore dans l'application : le bureau le créera.": 'Un șantier unde te-a trimis biroul și care nu e încă în aplicație: biroul îl va crea.',
  'Travail fait / remarque': 'Lucru făcut / observație', 'Ex. : Rue de la Loi 12, Bruxelles': 'Ex.: Rue de la Loi 12, Bruxelles', 'Ex. : intervention fuite chez le client, pose du carrelage…': 'Ex.: reparat o scurgere la client, montat gresie…',
  'Heures enregistrées ✓': 'Ore salvate ✓', 'Ajoutez au moins un poste': 'Adaugă cel puțin o poziție', 'Brouillon enregistré': 'Ciornă salvată', 'Supprimer ces heures ?': 'Ștergi aceste ore?', 'Envoyé ✓': 'Trimis ✓', 'Nouveau rapport': 'Raport nou', 'Rapport envoyé ✓': 'Raport trimis ✓',
};
const RO_MONTHS = { janvier: 'ianuarie', février: 'februarie', mars: 'martie', avril: 'aprilie', mai: 'mai', juin: 'iunie', juillet: 'iulie', août: 'august', septembre: 'septembrie', octobre: 'octombrie', novembre: 'noiembrie', décembre: 'decembrie',
  'janv.': 'ian.', 'févr.': 'feb.', 'avr.': 'apr.', 'juil.': 'iul.', 'sept.': 'sept.', 'oct.': 'oct.', 'nov.': 'nov.', 'déc.': 'dec.' };
const RO_DAYS = { lundi: 'luni', mardi: 'marți', mercredi: 'miercuri', jeudi: 'joi', vendredi: 'vineri', samedi: 'sâmbătă', dimanche: 'duminică',
  'lun.': 'lun.', 'mar.': 'mar.', 'mer.': 'mie.', 'jeu.': 'joi', 'ven.': 'vin.', 'sam.': 'sâm.', 'dim.': 'dum.', Lun: 'Lun', Mar: 'Mar', Mer: 'Mie', Jeu: 'Joi', Ven: 'Vin', Sam: 'Sâm', Dim: 'Dum' };
const roDateWords = (s) => s.replace(/(\p{L}+\.?)/gu, (w) => { const l = w.toLowerCase(); const r = RO_MONTHS[l] || RO_DAYS[w] || RO_DAYS[l]; if (!r) return w; return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r; });
// textes avec un nombre, un nom ou une date dedans
const RO_RX = [
  [/^Estimatif (EST-.+)$/, 'Estimativ $1'], [/^(\d+) éléments?$/, '$1 elemente'], [/^(\d+) sélectionnés?$/, '$1 selectate'], [/^(\d+) plan\(s\)$/, '$1 plan(uri)'], [/^(\d+) points?$/, '$1 puncte'],
  [/^(\d+) points? sur plan$/, '$1 puncte pe plan'], [/^\((\d+) composants?\)$/, '($1 componente)'], [/^Tous \((\d+)\)$/, 'Toate ($1)'], [/^Plans \((\d+)\)$/, 'Planuri ($1)'], [/^Administratif \((\d+)\)$/, 'Administrativ ($1)'],
  [/^Photos \((\d+)\)$/, 'Poze ($1)'], [/^Contrats \((\d+)\)$/, 'Contracte ($1)'], [/^Fiches techniques \((\d+)\)$/, 'Fișe tehnice ($1)'], [/^Plan · onglet Plans · (.+)$/, 'Plan · fila Planuri · $1'],
  [/^(\d[\d,.]*) jour\(s\) travaillé\(s\)$/, '$1 zi(le) lucrate'], [/^(.+) h au total$/, '$1 h în total'], [/^Planning · (\d+) jours?$/, 'Planning · $1 zile'], [/^(.+) · phase$/, '$1 · etapă'], [/^(.+) · affecté$/, '$1 · repartizat'],
  [/^équipe du chantier · phase « (.+) » · planning$/, 'echipa șantierului · etapa « $1 » · planning'], [/^n° (\d+) – (.+)$/, 'nr. $1 – $2'], [/^Point n° (\d+)$/, 'Punctul nr. $1'], [/^Voir sur le plan · (.+)$/, 'Vezi pe plan · $1'],
  [/^(.+) \(sous-traitant\)$/, '$1 (subcontractor)'], [/^Sous-traitant · (.+)$/, 'Subcontractor · $1'], [/^Couleur de (.+)$/, 'Culoarea: $1'], [/^(.+) · (\d+) j$/, '$1 · $2 z'],
  [/^(.+) · En cours$/, '$1 · În lucru'], [/^(.+) · En préparation$/, '$1 · În pregătire'], [/^(.+) · Terminé$/, '$1 · Terminat'], [/^(.+) · Divers$/, '$1 · Diverse'], [/^(.+) · Ouvrage$/, '$1 · Lucrare'], [/^(.+) · Matériaux$/, '$1 · Materiale'],
  [/^(\d\d\/\d\d\/\d{4}) · à (.+)$/, '$1 · către $2'], [/^(.*)du (\d\d\/\d\d\/\d{4}) au (\d\d\/\d\d\/\d{4})$/, '$1de la $2 până la $3'],
  [/^Envoyé au bureau le (.+)\. Il va le vérifier et en faire un devis pour le client\.$/, 'Trimis la birou pe $1. Biroul îl verifică și face din el un deviz pentru client.'],
  [/^marge prévue (.+)$/, 'marjă prevăzută $1'], [/^(.+) % du prévu$/, '$1 % din prevăzut'], [/^(.+) % du budget$/, '$1 % din buget'], [/^Prévu (.+) · Réel (.+)$/, 'Prevăzut $1 · Real $2'],
  [/^Devis acceptés : (.+)$/, 'Devize acceptate: $1'], [/^(.+) · depuis le début$/, '$1 · de la început'], [/^Non obligatoire sous (.+?) HT(.*)$/, 'Neobligatoriu sub $1 fără TVA'],
  [/^Ce mois-ci \((.+)\)$/, (m, a) => `Luna asta (${roDateWords(a)})`], [/^Heures – (.+)$/, (m, a) => `Ore – ${roDateWords(a)}`],
];
const roOn = () => typeof tLang === 'function' && S.me && (isChef() || isField()) && tLang() === 'ro';
function roText(t) {
  const k = t.trim(); if (!k) return null;
  let v = RO_UI[k];
  if (v === undefined) for (const [rx, r] of RO_RX) { if (rx.test(k)) { v = k.replace(rx, r); break; } }
  // dates : « vendredi 30 octobre », « Lun 26/10 », « Octobre 2026 : 78 h »
  if (v === undefined && k.length <= 45 && /^(\p{L}+\.?,? \d|\d{1,2} \p{L}|\p{L}+\.? \d{4})/u.test(k) && /(janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\b(Lun|Mar|Mer|Jeu|Ven|Sam|Dim)\b)/i.test(k)) { const r = roDateWords(k); if (r !== k) v = r; }
  if (v === undefined && /^(lun|mar|mer|jeu|ven|sam|dim)\.$/.test(k)) v = RO_DAYS[k];
  return v === undefined ? null : t.replace(k, v);
}
function roApply(root) {
  if (!root || !roOn()) return;
  const skip = (el) => el && el.closest && el.closest('.doc, [data-notr], textarea, script, style');
  const skipA = (el) => el && el.closest && el.closest('.doc, [data-notr]');
  if (root.nodeType === 3) { if (!skip(root.parentElement)) { const v = roText(root.nodeValue); if (v !== null) root.nodeValue = v; } return; }
  if (root.nodeType !== 1 || skip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
  nodes.forEach((n) => { if (skip(n.parentElement)) return; const v = roText(n.nodeValue); if (v !== null) n.nodeValue = v; });
  [root, ...root.querySelectorAll('[placeholder],[title],[aria-label],[data-l]')].forEach((e) => {
    if (!e.getAttribute || skipA(e)) return;
    ['placeholder', 'title', 'aria-label', 'data-l'].forEach((a) => { const x = e.getAttribute(a); if (x) { const v = roText(x); if (v !== null) e.setAttribute(a, v); } });
  });
}
new MutationObserver((ms) => { if (!roOn()) return; ms.forEach((m) => m.addedNodes.forEach((n) => roApply(n))); }).observe(document.documentElement, { childList: true, subtree: true });
// changement de page : tout l'écran (ce qui a été créé avant la connexion, ex. bouton « remonter »)
window.addEventListener('hashchange', () => setTimeout(() => roApply(document.body), 60));
