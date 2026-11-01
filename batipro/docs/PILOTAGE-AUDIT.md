# Audit BatiPro v141 – intégration du module « PILOTAGE MADIBU »

**Mission 1 / Prompt 1 – analyse uniquement. Aucun fichier de BatiPro n'a été modifié.**
Base analysée : archive `batipro-v141.zip` (66 fichiers hors `vendor/`, ≈ 19 300 lignes de code applicatif).
Chaque constat ci-dessous renvoie au code réel ; ce qui n'a pas pu être vérifié est indiqué « à confirmer ».

---

## Résumé pour la direction

1. **BatiPro couvre déjà l'essentiel de l'opérationnel.** Devis, factures, paiements clients, achats, commandes, heures, rentabilité par chantier et une liste d'actions « Aujourd'hui » existent et fonctionnent.
2. **Il manque toute la partie banque et trésorerie future.** Il n'y a aucune notion de compte bancaire, d'extrait, de crédit, de leasing, de charge fixe ni de prévision. Ce sont des ajouts sans doublon.
3. **Toute la logique financière actuelle tourne dans le navigateur (JavaScript)**, pas sur le serveur. Pour qu'un cron et l'IA puissent calculer, il faudra **porter ces calculs en PHP**, à l'identique et testés.
4. **Trois faiblesses existantes touchent directement les finances** (voir F). Le serveur ne bloque pas la modification ou la suppression d'une facture émise. La suppression d'un chantier efface ses factures et paiements. Aucun test automatisé n'existe.
5. **Le module doit être activable par firme.** BatiPro est vendu en abonnement à d'autres entreprises : le Pilotage ne doit apparaître que pour MADIBU tant qu'il n'est pas validé.

---

## A. Architecture actuelle

| Couche | Réalité dans le code |
|---|---|
| Serveur | PHP ≥ 8.1, **sans framework**. Un seul point d'entrée HTTP : `api.php?r=/route` (≈ 1 050 lignes, `switch` sur 22 routes). Fonctions communes dans `lib.php` (≈ 1 100 lignes). |
| Modules serveur | `ai.php` (assistant Claude, SDK PHP `anthropic-ai/sdk ^0.59`), `peppol_ap.php` (Peppyrus), `saas.php` (abonnements Mollie), `cron.php` (CLI uniquement), `install.php`, `legal.php`. |
| Client | Application monopage en **JavaScript sans framework** (`assets/*.js`, ≈ 13 000 lignes), routage par `#/…`. PWA (`sw.js`, `manifest.webmanifest`). |
| Bibliothèques client | jsPDF, html2canvas, **pdf.js** (lecture PDF), **SheetJS xlsx** (Excel), qrcode – toutes locales dans `assets/vendor/`. |
| Base | MySQL / MariaDB, PDO avec requêtes préparées et `EMULATE_PREPARES=false`. |
| Hébergement | cPanel (Hostico selon `HOSTING.md`), HTTPS forcé, `.htaccess`. |
| Multi-firmes | Toutes les données portent `company_id` ; `cid()` = firme courante ; super-administrateur de plateforme. |
| Éditions | « Avancé » / « Simplifié » choisies par firme (`setting('edition')`). |

### Modèle de données : un « magasin de documents » dans MySQL
`schema.sql` ne contient que **8 tables** : `companies`, `users`, `items`, `files`, `counters`, `settings`, `activity`, `logins`.
D'autres tables sont créées à la volée par le code : `remember_tokens`, `notifs`, `push_subs`, `ai_convs`. Des colonnes et index sont ajoutés au premier accès (`db()` avec des drapeaux `uploads/.db-idx2` et `.db-2fa`, `migrate()`).

**Tous les objets métier sont des lignes de `items`**, distinguées par `type`, avec leurs champs dans une colonne JSON `data` (LONGTEXT) :

| `type` | Contenu |
|---|---|
| `contact` | clients, prospects, fournisseurs, sous-traitants, architectes (IBAN des tiers dans `data`) |
| `project` | chantiers (statut, dates, responsable, équipe, sous-traitants, budget libre) |
| `quote` | devis, avenants (= devis liés), estimatifs ; lignes avec déboursé `cost` / `costBy`, prix, TVA |
| `invoice` | factures, acomptes, états d'avancement (`situation`), soldes, notes de crédit (`kind: 'avoir'`, quantités négatives), pro forma ; **paiements reçus dans `data.payments[]`** |
| `expense` | factures d'achat ; **paiements dans `data.payments[]`** ; ventilation multi-chantiers dans `data.alloc[]` ; source Peppol/PDF/photo |
| `order` | bons de commande fournisseurs / sous-traitants |
| `timesheet` | heures (heures × taux = coût main-d'œuvre) |
| `employee`, `absence`, `assign` | RH, congés, planning d'équipe |
| `article` | bibliothèque de prix et ouvrages composés |
| `point`, `plan`, `meeting`, `report`, `diary`, `form`, `phase`, `task`, `intervention`, `installation`, `contract`, `opportunity`, `billreq`, `mgrreport`, … | suivi de chantier, CRM, documents |

Index existants sur `items` : `(company_id, type)`, `(type, project_id)`, `(type, parent_id)`, `(company_id, project_id)`. Le contenu JSON **n'est pas indexé** : on ne peut pas faire de requête SQL efficace sur un montant, une échéance ou une communication.

## B. Cartographie des modules existants

| Espace (menu) | Modules | Fichiers principaux |
|---|---|---|
| Aujourd'hui | liste d'actions triées par urgence, carte « Votre argent », tâches, planning | `admin.js` (route `dashboard`), `planning.js` |
| Affaires | opportunités (Kanban), devis, avenants, estimatifs, bibliothèque, import Excel de devis | `crm.js`, `sales.js`, `import.js` |
| Chantiers | fiche chantier (Aperçu financier, Devis, Commandes, Factures, Achats, Heures, Planning, Plans, Points, PV, Formulaires, Journal, Documents, Contrats), interventions, installations | `chantier.js`, `field.js`, `docs.js`, `contracts.js` |
| Argent | factures, paiements, achats (import PDF/XML/photo, Peppol), commandes, chiffres, **export comptable** | `invoice.js`, `purchase.js`, `achats.js`, `peppol.js`, `compta.js` |
| Carnet | contacts, équipe, pointage, absences | `crm.js`, `crew.js`, `social.js` |
| Terrain | application ouvriers / sous-traitants | `terrain.js`, `resp.js` (responsables « chef ») |
| Transversal | assistant IA, e-mails SMTP, notifications push, sauvegardes, plateforme multi-firmes, abonnements | `ai.js`/`ai.php`, `mail.js`, `lib.php`, `saas.js`/`saas.php` |
| Automatisations (`cron.php`, toutes les 15 min) | relève Peppol des factures fournisseurs, sauvegarde quotidienne, rappel de fin de journée des heures non encodées, rappels d'abonnement, envoi des notifications push | `cron.php`, `lib.php` |

### Rôles existants (`lib.php`)
`USER_ROLES = ['admin', 'user', 'chef', 'ouvrier', 'soustraitant']` plus l'indicateur `super` (gestionnaire de plateforme).
- **admin** : tout, y compris les paramètres et utilisateurs (`require_admin`).
- **user** : tout le métier, **y compris toutes les factures et achats**, sans les paramètres.
- **chef** (responsable) : ses chantiers ; lecture seule sur `invoice`, `contract`, `expense` (`CHEF_READONLY`), prépare des estimatifs.
- **ouvrier / soustraitant** : espace terrain filtré côté serveur (`field_scope`, `field_view`) ; ne reçoivent ni prix, ni clients, ni factures.

Le cloisonnement terrain et chef est **bien fait côté serveur**. En revanche, il n'existe aucun rôle « finance » ni « comptable » distinct.

## C. Structure et relations de la base

- Relations portées par `items.project_id` et `items.parent_id`, puis **par des identifiants dans le JSON** : `data.clientId`, `data.supplierId`, `data.quoteId`, `data.alloc[].pid`, `data.managerId`, `data.team[]`, etc.
- **Aucune clé étrangère** ; intégrité assurée par le code.
- Versionnement optimiste : `items.version` (conflit 409 si deux personnes modifient).
- Numérotation atomique : `counters` (`next_counter` sous `SELECT … FOR UPDATE`), préfixes réglables (`FAC`, `NC`, `DEV`, `BC`, …).
- Journal : `activity` (qui, quoi, quand, libellé), **sans ancienne ni nouvelle valeur**.
- Fichiers : `files` + dossier `uploads/AAAA/MM/` (noms aléatoires), servis uniquement par `api.php` après authentification.
- Réglages : `settings(company_id, k, v JSON)` ; certaines clés sont réservées au serveur (`SERVER_SETTINGS`).
- Montants : nombres JSON calculés en JavaScript (arrondi `r2`) ; **aucun type DECIMAL côté base**.

## D. Fonctionnalités financières existantes (vérifiées)

| Fonction | Où | Remarque |
|---|---|---|
| Totaux de document (HT, remise par taux, TVA, TTC, déboursé, marge) | `data.js` `totals()` | conforme EN 16931 pour la remise |
| État d'une facture (brouillon, émise, partielle, payée, en retard, note de crédit) | `data.js` `invState()` | « payé » = somme de `data.payments[]` saisis à la main |
| État d'un achat (à valider, à payer, partiel, payé, en retard, refusé) | `purchase.js` `purchState()` | paiements multiples, ventilation par chantier |
| Finances d'un chantier : montant des devis acceptés, déboursé prévu, coût réel (achats ventilés + heures × taux), **engagé** (commandes non facturées), facturé HT, encaissé TTC, reste dû, marge estimée = budget − max(prévu ; réel + engagé) | `chantier.js` `projectFinance()` | bonne base ; calcul **uniquement côté navigateur** |
| États d'avancement cumulés, déduction d'acompte, facture de solde, avenants inclus | `sales.js`, `invoice.js` | |
| « Votre argent » : à recevoir, dont en retard, à payer aux fournisseurs | `admin.js` dashboard | instantané ; aucune projection |
| Statistiques : CA, encaissements, coûts, pipeline, rentabilité | `admin.js` route `stats` | navigateur |
| Communication structurée belge (modulo 97) | `purchase.js` `commOk()` | **réutilisable pour le rapprochement bancaire** |
| Export comptable trimestriel (PDF + journaux ventes et achats CSV, envoi au comptable) | `compta.js` | |
| Peppol : émission UBL, réception automatique des achats | `peppol.js`, `peppol_ap.php` | |
| Rappels de factures en retard | liste « Aujourd'hui » | pas d'e-mail de relance automatique préparé |

**Absent, vérifié par recherche dans tout le code** : comptes bancaires, extraits, solde bancaire, transactions, rapprochement, virements internes, crédits, leasings, charges fixes et récurrentes (salaires, ONSS, précompte, TVA à payer), prévision de trésorerie, scénarios, alertes de risque calculées, rapport quotidien, centre d'approbation, rôle finance ou comptable, audit avec valeurs avant/après, tests automatisés.

Seule mention de l'ONSS : `social.js`, pour la déclaration 30bis/Checkin@Work et le calcul des retenues sur sous-traitants. Pas de suivi des cotisations.

## E. Fonctionnalités à ajouter (sans doublon)

| Besoin | Décision |
|---|---|
| Clients, fournisseurs, chantiers, factures, achats, commandes, heures, utilisateurs | **réutiliser `items` et `users`** ; aucune copie |
| Comptes bancaires, imports d'extraits, transactions, rapprochements, virements internes | **nouveau** |
| Crédits, leasings, charges fixes et obligations | **nouveau** (registre confirmé par l'utilisateur) |
| Prévision 7 / 30 / 90 j, 3 scénarios, fiabilité | **nouveau**, à partir de la banque validée et des factures et achats ouverts de BatiPro |
| Rentabilité réelle et prévisionnelle des chantiers | **réutiliser `projectFinance()`**, la porter en PHP et l'enrichir (coût payé ≠ engagé, cash du chantier, tendance) |
| Alertes de risque, rapport quotidien, historique des décisions | **nouveau** ; affichage aussi dans « Aujourd'hui » |
| Centre d'approbation | **nouveau** (statuts : en attente, approuvée, refusée, annulée, expirée, exécutée, échec) |
| Assistant IA de direction | **étendre `ai.php`** (même SDK, même stockage `ai_convs`) avec des outils financiers en lecture seule |
| Rôles finance et comptable | **étendre `USER_ROLES`** |
| Journal d'audit renforcé | **nouveau** (avant/après, chaînage d'empreintes) ; `activity` reste en place |

## F. Risques techniques et de sécurité

### F1. Risques existants à traiter ou à contourner
1. **Facture émise modifiable et supprimable côté serveur.** La route `PUT/DELETE items/invoice/{id}` ne vérifie que le rôle (seul le « chef » est bloqué). La règle « une facture validée n'est jamais supprimée » n'est appliquée que dans l'interface. Un appel direct ou un bug client peut altérer l'historique financier.
2. **Suppression d'un chantier = suppression en cascade** de tous ses `items` (factures, paiements, achats non ventilés, heures) et de ses fichiers (`api.php`, `DELETE items/project`). Le Pilotage s'appuyant sur ces données, c'est le risque n° 1 de perte d'historique.
3. **Calculs financiers uniquement en JavaScript.** Ils sont inutilisables par le cron et par l'IA, et une réimplémentation en PHP peut diverger. Il faut des tests d'équivalence.
4. **Montants en nombres flottants JSON.** Arrondis `r2` corrects en pratique, mais pas de DECIMAL : les nouveaux modules utiliseront DECIMAL(14,2) et des centimes entiers.
5. **Aucun test automatisé** dans le projet.
6. **Route `files` : tout utilisateur « bureau » lit n'importe quel fichier de la firme par son id.** Les extraits bancaires ne doivent donc **pas** être stockés dans `files`.
7. **Sauvegarde hebdomadaire envoyée par e-mail en clair** (base complète, toutes firmes). Une fois les transactions bancaires en base, elles partiraient par e-mail : il faut une décision (exclure les tables bancaires de la copie e-mail ou la chiffrer).
8. **`.htaccess` : liste noire de fichiers PHP.** Seuls `config|lib|ai|peppol_ap|cron|saas.php` sont fermés. **Un nouveau fichier PHP à la racine serait appelable directement depuis le web.** Les nouveaux fichiers iront dans un dossier fermé.
9. **CSRF** : protection par l'en-tête `X-Requested-With: batipro` combinée au cookie `SameSite=Lax`. Acceptable ; on la garde telle quelle pour les nouvelles routes.
10. `cron.php` appelle `backup_auto()` deux fois (sans effet grâce au verrou de 20 h). Il tourne toutes les 15 minutes : le Pilotage doit s'exécuter **une fois par jour** avec un verrou.
11. Migrations « à la volée » (ALTER au premier accès, fichiers drapeaux dans `uploads/`). Pour le Pilotage, il faut des migrations **versionnées, additives, idempotentes**, sans ALTER sur les tables existantes.
12. **Produit SaaS multi-firmes** : toute nouvelle table porte `company_id` ; le module est derrière un réglage d'activation par firme.

### F2. Risques propres au futur module
- **Extraction PDF incertaine** : formats différents selon la banque, et scans. pdf.js lit le texte d'un PDF natif, mais il n'y a **pas d'OCR sur cPanel**. L'OCR via Claude impliquerait d'envoyer un extrait bancaire à l'API : à n'utiliser qu'avec accord explicite, page par page, et jamais par défaut.
- **Double comptage** : un encaissement apparaît à la fois dans `invoice.data.payments[]` (saisi à la main) et dans la banque. Règle : **la banque est la vérité pour le cash** ; un rapprochement confirmé relie le paiement de la facture à la transaction (`bankTxId`), sans en créer un second.
- **Virements entre les 3 comptes** : à neutraliser dans tous les totaux consolidés.
- **Limites d'hébergement mutualisé** (temps d'exécution, mémoire) : imports traités par lots de quelques centaines de lignes.
- **Confidentialité** : IBAN et transactions réservés aux rôles admin/finance ; l'IA ne reçoit que des agrégats, jamais l'extrait brut ni les IBAN complets.

## G. Architecture proposée pour PILOTAGE MADIBU

```
index.html ── assets/pilotage.js (+ pilotage-import.js)      ← nouvel espace « Pilotage » (visible admin / finance / comptable)
     │  fetch api.php?r=pilot/...  (même session, même en-tête CSRF)
api.php ── case 'pilot': require 'pilotage/routes.php'         ← une seule ligne ajoutée au switch
pilotage/  (dossier fermé par .htaccess « Require all denied »)
   ├── schema.php      migrations versionnées (CREATE TABLE IF NOT EXISTS, aucune modification des tables existantes)
   ├── money.php       centimes entiers, DECIMAL(14,2)
   ├── bank_import.php CODA, CSV, XLSX (lecture côté client avec SheetJS puis validation serveur), PDF texte
   ├── bank_match.php  doublons, virements internes, rapprochement factures/achats (communication structurée, montant, IBAN)
   ├── finance.php     projectFinance() porté en PHP + créances, dettes, obligations, prévisions 3 scénarios
   ├── analysis.php    règles d'alerte déterministes (quoi, pourquoi, impact, action, qui, quand)
   ├── report.php      « MADIBU – DAILY FINANCIAL REPORT »
   ├── approvals.php   centre d'approbation + exécution contrôlée (ex. envoi de relance via send_mail existant)
   ├── audit.php       journal avant/après avec chaînage SHA-256 (contrôle d'intégrité)
   └── ai_tools.php    outils lecture seule pour l'assistant de direction
cron.php ── + pilot_daily() une fois par jour et par firme active (verrou setting 'pil_daily')
ai.php   ── + mode « direction » : autre prompt système, outils financiers ; calculs faits en PHP, jamais par le modèle
```

**Principes**
- Les données existantes sont **lues** dans `items` (factures, achats, devis, commandes, heures, contacts, chantiers). Le Pilotage n'écrit dans `items` qu'à travers une action confirmée par un humain (enregistrer un paiement rapproché), avec audit.
- Les nouvelles données sont dans des **tables relationnelles** (et non dans `items`). Raisons : volume (≈ 5 000 à 15 000 transactions sur 24 mois), index pour les doublons et le rapprochement, montants DECIMAL, et isolation des données bancaires.
- Activation par firme : `setting('pilotage') = true`, uniquement pour MADIBU au départ.
- Interface en français, avec le style existant (`style.css`, composants `layout()`, `card`, `badge`), responsive.

## H. Tables nouvelles (préfixe `pil_`, toutes avec `company_id`)

| Table | Contenu principal |
|---|---|
| `pil_bank_accounts` | banque, nom interne, IBAN (masqué hors rôles autorisés), devise, début/fin d'historique, solde initial/final, actif |
| `pil_bank_imports` | fichier (chemin `uploads/bank/…`, hash SHA-256 pour détecter un fichier déjà importé), compte, période, utilisateur, nb lignes, contrôles, erreurs, statut (aperçu / confirmé / annulé) |
| `pil_bank_transactions` | compte, import, date comptable, date valeur, montant DECIMAL, devise, sens, communication structurée/libre, contrepartie (nom, IBAN), solde après, référence banque, **empreinte de dédoublonnage**, **colonnes d'origine (raw JSON) séparées des colonnes corrigées**, catégorie, sous-catégorie, confiance, statut de validation |
| `pil_bank_links` | transaction ↔ facture / achat / contact / chantier : montant affecté (paiements partiels et groupés), statut (confirmée, proposée, à vérifier), auteur |
| `pil_transfers` | paire de transactions entre les 3 comptes (confirmée / non confirmée) |
| `pil_balances` | soldes d'extraits par compte et date (contrôle de continuité, périodes manquantes) |
| `pil_commitments` | crédits, leasings, charges fixes : type, organisme, capital, taux, mensualité, jour de prélèvement, début/fin, fréquence, compte débité, valeur de rachat, garanties, **statut « confirmé par l'utilisateur »** |
| `pil_forecast_assumptions` | hypothèses modifiables par scénario |
| `pil_alerts` | clé stable (pas de doublon), titre, description, catégorie, gravité, montant, données utilisées, calcul, action, responsable, échéance, statut (nouvelle, en cours, résolue, ignorée) |
| `pil_reports` | rapport quotidien unique par (firme, date) + données chiffrées |
| `pil_approvals` | type, description, origine (utilisateur/IA), données, montant, justification, risques, statut, décideur, exécution, résultat |
| `pil_decisions` | décisions et actions de la direction (historique) |
| `pil_audit` | journal avant/après, origine, empreinte chaînée |
| `pil_runs` | exécutions du cron et de l'IA (verrou d'idempotence, durée, erreurs) |

Catégories bancaires : **liste fixe dans le code** (celle de votre Prompt 2), sans table.
Aucune table existante n'est modifiée. Un seul ajout éventuel se fait dans le JSON existant : `bankTxId` dans `invoice.data.payments[]` et `expense.data.payments[]`, ignoré par l'ancien code.

## I. Sauvegarde et retour arrière

1. **Avant tout** : sauvegarde complète via « Plateforme → Sauvegardes → Tout télécharger » (base + `uploads/`), copie conservée hors serveur, **test de restauration** sur l'environnement de test.
2. **Dépôt Git privé** avec la v141 telle quelle (commit de référence). Chaque étape = une branche, puis validation de votre part avant fusion.
3. **Environnement de test séparé** : sous-domaine cPanel (ex. `test.…`) avec une copie de la base. **Jamais de développement sur la production.**
4. Migrations **additives** uniquement (nouvelles tables `pil_*`). Retour arrière = désactiver le réglage `pilotage` et remettre les fichiers précédents ; les tables `pil_*` peuvent rester sans effet sur BatiPro.
5. Mise en production : sauvegarde → déploiement des fichiers → première ouverture (migrations) → contrôles → activation pour MADIBU seulement.

## J. Plan de développement par étapes (chaque étape attend votre validation)

| Étape | Contenu | Livrable testable |
|---|---|---|
| 0. Préparation | dépôt Git, environnement de test, PHPUnit + MariaDB de test, **tests d'équivalence** des calculs actuels (JS) sur des données fictives | base saine, aucun changement fonctionnel |
| 1. Durcissement (optionnel, à valider) | blocage serveur de la modification/suppression d'une facture émise et de la suppression d'un chantier facturé | correctif de sécurité, testé |
| 2. Banque (Prompt 2) | comptes, import CODA/CSV/XLSX/PDF texte, aperçu, doublons, contrôle des soldes, virements internes, catégorisation, rapprochement, tableau de contrôle, historique 24 mois | import des 3 comptes sur données fictives, puis sur vos vrais extraits **en test** |
| 3. Trésorerie (Prompt 3) | registre crédits/leasings/charges, soldes consolidés, prévisions 7/30/90 j × 3 scénarios, indice de fiabilité, graphiques | prévisions expliquées ligne par ligne |
| 4. Direction IA (Prompt 4) | règles d'alerte, rapport quotidien via cron, assistant de direction (outils PHP en lecture seule), historique | rapport du jour reproductible |
| 5. Contrôle (Prompt 5) | centre d'approbation, rôles finance/comptable, audit chaîné, permissions serveur, tests complets | critères 1 à 15 de votre cahier des charges |
| 6. Intégration (Prompt final) | espace « Pilotage » (15 pages), « Aujourd'hui » enrichi, documentation, mise en production contrôlée | recette finale |

## K. Fichiers à créer ou modifier

**À créer** : `pilotage/` (avec `.htaccess` de refus et les fichiers PHP listés en G), `assets/pilotage.js`, `assets/pilotage-import.js`, `assets/pilotage.css` (ou ajout dans `style.css`), `tests/` (PHPUnit + fichiers fictifs CODA/CSV/XLSX/PDF), `docs/PILOTAGE.md`.

**À modifier (modifications minimales et ciblées)**

| Fichier | Modification |
|---|---|
| `api.php` | une entrée `case 'pilot'` ; si l'étape 1 est validée, contrôles serveur sur les factures émises et sur la suppression d'un chantier |
| `lib.php` | rôles `finance` et `comptable` dans `USER_ROLES` et `require_staff` ; fonction `require_pilot()` |
| `cron.php` | appel de `pilot_daily()` une fois par jour |
| `ai.php` | mode « direction » et outils financiers en lecture seule |
| `index.html` | chargement des nouveaux scripts |
| `assets/core.js` | entrée de menu « Pilotage », visible selon le rôle et l'activation de la firme |
| `assets/admin.js` | alertes du Pilotage dans « Aujourd'hui » ; nouveaux rôles dans l'écran Utilisateurs |
| `sw.js` | liste des fichiers mis en cache |
| `.htaccess` | rien d'obligatoire (le dossier `pilotage/` a son propre `.htaccess`) ; option : passer à une liste blanche `api.php` et `install.php` |
| `lib.php` `backup_*` | selon votre décision sur l'envoi des sauvegardes par e-mail |

## L. Difficultés et dépendances

| Élément | Difficulté | Dépend de |
|---|---|---|
| Import **CODA** | moyenne | format bancaire belge standard, très fiable ; **le meilleur choix** |
| Import CSV / XLSX | moyenne | un modèle de colonnes par banque (BNP Paribas Fortis, KBC, Belfius, ING… ont des formats différents) |
| Import **PDF** | **élevée** | gabarit par banque ; les PDF scannés ne sont pas lisibles sans OCR, donc signalés « extraction incomplète » |
| Doublons, soldes, virements internes | moyenne | soldes d'ouverture et de clôture de chaque extrait |
| Rapprochement factures/achats | élevée | qualité des communications structurées ; paiements groupés et partiels |
| Port en PHP des calculs JS | moyenne | tests d'équivalence obligatoires |
| Prévisions et fiabilité | moyenne | registre des charges confirmé par vous |
| Alertes, rapport, IA | moyenne | étapes 2 et 3 terminées |
| Approbations, audit, rôles | moyenne | décisions sur les rôles |
| Tests | moyenne | MariaDB de test (Docker ou sous-domaine) |

### Ce dont j'ai besoin de votre part avant l'étape 2
1. **Les 3 banques** et les formats que vous pouvez télécharger. **Demandez le CODA à votre comptable ou à la banque** : c'est de loin le plus fiable ; tous les comptes professionnels belges y ont droit.
2. Un **sous-domaine de test** sur cPanel (ou l'accord pour tester en local avec Docker).
3. Qui aura accès au Pilotage : vous seul, un rôle « finance », votre comptable ?
4. **Sauvegarde hebdomadaire par e-mail** : faut-il exclure les données bancaires de la copie ou la chiffrer ?
5. **Étape 1 (durcissement des factures émises)** : l'acceptez-vous ? Elle change un comportement existant.
6. Une copie **anonymisée ou fictive** d'un extrait de chaque banque, pour construire les lecteurs. Les vrais extraits ne seront jamais versés dans Git.

---

## Proposition technique concrète

Je propose de commencer par l'**étape 0** : dépôt Git privé de la v141, environnement de test, tests d'équivalence des calculs existants. Viendrait ensuite l'**étape 2** (banque), en priorisant le format **CODA** puis CSV/XLSX, avec le PDF en dernier.

Les données bancaires seraient stockées dans des tables `pil_*` dédiées, dans un dossier `pilotage/` fermé au web. Les modifications de BatiPro se limitent aux 8 fichiers listés en K. Le module est activé uniquement pour MADIBU.

**J'attends votre validation explicite avant d'écrire la moindre ligne de code.**
