# BâtiPro – aplicație web de gestiune pentru construcții (modèle de documents Madibu)

Aplicație web multi-utilizator, în franceză, pe care o instalezi pe domeniul tău (găzduire cPanel cu PHP + MySQL).
Toți utilizatorii conectați văd toate proiectele firmei, iar fiecare element arată cine l-a creat și cine l-a modificat.

## Navigation – « espaces » (interface Atelier Madibu)
Pas de menu latéral : 5 espaces, dans l'ordre de vie d'un chantier, toujours à la même place.
- **Avancé** : Aujourd'hui · Affaires (devis, opportunités, prix) · Chantiers (chantiers, interventions, installations, fiches) · Argent (factures, paiements, achats, commandes, chiffres) · Carnet (clients, fournisseurs, sous-traitants, équipe, pointage, absences).
- **Simplifié** : Accueil · Facturer (factures, devis) · Achats · Chantiers (chantiers, clients, fournisseurs, prix) · Moi.
- Ordinateur : capsule des espaces en haut, rubriques en pastilles, recherche (⌘K), « Créer » et le compte (avatar) à droite. Téléphone : espaces en bas, « + Créer » en haut à droite, compte en haut à gauche.

## Module
- **Aujourd'hui**: une seule liste d'actions triées par urgence (factures en retard à relancer, tâches, interventions du jour, achats à payer ou à vérifier, devis acceptés à facturer, devis sans réponse), « Votre argent » et chantiers en cours.
- **Contacts**: clients, prospects, fournisseurs, sous-traitants, architectes – fiche avec tout l'historique.
- **Opportunités**: pipeline Kanban (glisser-déposer), relances, montant pondéré.
- **Devis**: chapitres, lignes, textes, options, éléments de la bibliothèque, déboursés et marges par ligne, TVA par ligne, remise, autoliquidation, PDF. À l'acceptation, le chantier se crée automatiquement.
- **Bibliothèque**: articles (main d'œuvre, matériaux, matériel, sous-traitance) et **ouvrages composés**, import/export CSV, indexation des prix.
- **Fiches techniques** et **dossiers de fin de chantier**.
- **Commandes** fournisseurs / sous-traitants, générées depuis le devis (une commande par fournisseur).
- **Chantiers** avec onglets : Aperçu financier (budget, déboursé prévu, coût réel, engagé, facturé, encaissé, marge), Devis, Commandes, Factures, Achats, Heures, Planning, **Plans, Points, PV de réunion, Formulaires, Journal, Documents** (partie Aproplan).
- **Import Excel / CSV** : devis créé depuis un fichier Excel (chapitres, sous-chapitres, lignes et textes reconnus automatiquement, aperçu modifiable avant import), lignes importées dans un devis / une facture existant(e), liste de clients et fournisseurs (Excel, CSV ou vCard, colonnes associées automatiquement, doublons détectés), bibliothèque de prix.
- **Modèles de documents** (Paramètres → Modèles) : devis et factures au format « Madibu » (logo, bloc société, cadre client, chapitres 1.0.0 / sous-chapitres 1.1.0, totaux en bandes colorées, texte de virement, remarque), couleurs, police, titres, colonnes, CSS personnalisé et numérotation reprise de votre série actuelle (ex. 2026-117).
- **Mentions obligatoires** automatiques : texte TVA 6 % (logement > 10 ans) et autoliquidation (avec n° TVA du client obligatoire) – textes modifiables.
- **États d'avancement** : avancement cumulé par poste (en % ou en quantité, ou par chapitre), quantité prévue / avancée, déduction de l'acompte au prorata (ou montant libre) avec « reste à déduire X % », récapitulatif du marché, modification possible tant que la facture n'est pas validée.
- **Envoi par email**: PV de réunion, rapports de points, devis, factures et bons de commande envoyés directement depuis l'application (PDF joint) aux présents, aux intervenants concernés ou à toute autre adresse ; serveur SMTP configurable, réponses vers l'expéditeur.
- **Assistant IA (Claude)**: bouton « Assistant » sur toutes les pages – calculs de matériaux et de prix, devis et commandes en brouillon à partir de la bibliothèque de prix, emails de demande de prix prêts à relire et envoyer, questions techniques de construction (avec recherche web). Clé API Anthropic dans *Paramètres › Assistant IA*.
- **Achats**: import des factures fournisseurs en PDF (lecture automatique du n°, des dates, des montants et du n° de TVA ; facture électronique intégrée au PDF reconnue), en XML Peppol/UBL ou en photo ; répartition d'un achat sur plusieurs chantiers (montant et type de coût par chantier), repris dans le suivi financier de chaque chantier.
- **Peppol (facturation électronique)**: export UBL Peppol BIS Billing 3.0 des factures et notes de crédit (validé contre les règles officielles EN 16931 + Peppol et le schéma UBL 2.1), contrôles avant envoi, identifiant Peppol des clients (0208 + n° d'entreprise) avec vérification dans l'annuaire Peppol, import des factures fournisseurs reçues (XML avec PDF intégré) dans les achats.
- **Factures**: facture, acompte %, état d'avancement (% cumulé par ligne, déduction des acomptes), facture de solde, note de crédit, numérotation définitive à la validation, communication structurée belge, paiements, export comptable.
- **Interventions** (rapport, photos, signature client, facturation) et **Installations** (contrats d'entretien, prochaines échéances).
- **Tâches**, **Planning des chantiers** (Gantt) et **Planning des équipes** (semaine, glisser-déposer).
- **RH**: personnel (coût horaire), pointage, absences.
- **Statistiques**: CA, encaissements, coûts, pipeline, rentabilité par chantier.
- **Paramètres**: entreprise, logo, TVA, préfixes, mentions, utilisateurs (admin / utilisateur), journal d'activité.
- **N° de TVA de test** : `BE123456789` est accepté sans vérification VIES / BCE (comptes de démonstration). Pour changer la liste : `define('TEST_VATS', ['BE123456789', ...]);` dans `config.php`.

## Instalare pe cPanel (aprox. 10 minute)
1. **Bază de date**: cPanel → *Bases de données MySQL* (*MySQL Databases*):
   - creează o bază (ex. `cont_batipro`) și un utilizator cu parolă;
   - adaugă utilizatorul la bază cu **toate privilegiile**.
2. **Fișiere**: cPanel → *Gestionnaire de fichiers*:
   - urcă arhiva `batipro.zip` în `public_html` (sau într-un subdosar, ex. `public_html/gestion`);
   - dezarhiveaz-o (*Extract*).
   - Fișierele `.htaccess` sunt incluse (pot fi ascunse în File Manager; activează „Show hidden files”).
3. Deschide în browser `https://domeniul-tau.be/install.php` (sau `/gestion/install.php`):
   - completează datele bazei de date, numele firmei și contul tău de administrator.
4. **Șterge `install.php`** din File Manager după instalare.
5. Conectează-te, apoi mergi la ⚙ *Paramètres*:
   - completează firma, logo-ul, IBAN-ul, cotele TVA și prefixele;
   - creează conturi pentru colegi din *Utilisateurs*;
   - în *Peppol*: lipește cheia API Peppyrus (cont gratuit pe peppyrus.be) – facturile furnizorilor intră singure în *Achats & dépenses*, iar facturile tale se trimit direct pe Peppol. Opțional, în cPanel › *Cron Jobs*, la fiecare 15 minute: `php /home/CONTUL_TAU/public_html/cron.php`;
   - în *Assistant IA*: lipește o cheie API de pe console.anthropic.com (plătești consumul direct la Anthropic). Arhiva conține deja dosarul `vendor/` cu SDK-ul Anthropic – nu trebuie instalat nimic. Cheia platformei servește și firmelor care nu au cheia lor;
   - în *Email*: pune serverul SMTP al unei adrese create în cPanel (ex. `mail.domeniultau.be`, port 465 SSL, adresa completă + parola) și apasă „Envoyer un test”. PV-urile, rapoartele de puncte, devizele, facturile și comenzile se trimit apoi direct din aplicație, cu PDF-ul atașat.

**Cerințe:** PHP 8.1+ (cPanel › *Select PHP Version*) cu PDO MySQL, MySQL 5.7+ sau MariaDB 10.3+ și HTTPS (certificatul gratuit AutoSSL din cPanel). Fișierele încărcate stau în `uploads/` și sunt servite numai utilizatorilor conectați.

## Mai multe firme pe aceeași instalare

- Primul cont creat la instalare (sau, la o actualizare, primul administrator) este **gestionarul platformei**: în meniul de jos are iconița *Plateforme*.
- *Plateforme › Nouvelle firme* creează o firmă nouă cu primul ei administrator (nume, email, parolă). Datele fiecărei firme (clienți, devize, facturi, șantiere, achiziții, setări, Peppol, email) sunt complet separate.
- Administratorul unei firme își creează singur colegii în *Paramètres › Utilisateurs*, cu rolul **Administrateur** sau **Utilisateur**. Gestionarul platformei poate face același lucru: *Entrer* în firmă → *Paramètres › Utilisateurs*, apoi *Revenir à ma firme*.
- *Suspendre* blochează conectarea unei firme fără să-i șteargă datele.
- Fiecare firmă are propriul identificator Peppol (numărul ei de întreprindere), deci propriul cont Peppyrus și propria cheie API. Serverul de email al platformei e folosit pentru firmele care nu și-au configurat unul.
- La actualizarea unei instalări existente, baza de date se transformă automat la prima deschidere (datele existente devin firma n° 1).

## Backup
- cPanel → *Sauvegarde*: descarcă baza de date.
- Păstrează și o copie a dosarului `uploads/`.

## Rulare locală (dezvoltare)
```bash
php -S localhost:8080   # din dosarul web/, cu o bază MySQL locală
```

## Éditions (noms internes)

- **BâtiPro Avancé** : tous les modules (planning, commandes, interventions, RH, statistiques, assistant IA…).
- **BâtiPro Simplifié** (indépendants) : devis, factures clients et paiements, achats / factures fournisseurs
  (PDF, photo, Peppol) affectés aux chantiers, chantiers simples (facturé / encaissé / consommé), contacts, Peppol.

Les deux éditions utilisent le même code et la même base. L'édition se choisit **par firme** dans
*Plateforme* (création ou modification d'une firme). Les firmes existantes restent en « Avancé ».
Pour qu'une installation crée par défaut des firmes « Simplifié », ajoutez dans `config.php` :
`'edition' => 'simple',`
