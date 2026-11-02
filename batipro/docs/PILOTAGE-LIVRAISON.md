# PILOTAGE MADIBU dans BâtiPro – livrable final

Une seule application, BâtiPro (PHP / MySQL), qui gère les opérations quotidiennes et donne à la direction une vision financière fiable et prévisionnelle de MADIBU Group.
- Aucune connexion bancaire.
- Aucun paiement exécuté par le système.
- Aucun montant inventé par l'IA.

Documents détaillés par étape : `PILOTAGE-AUDIT.md`, puis `PILOTAGE-ETAPE-0.md` à `PILOTAGE-ETAPE-5.md`.

## 1. Fonctionnalités opérationnelles (espace « Pilotage MADIBU », 15 pages)

| # | Page | Contenu |
|---|---|---|
| 1 | **Vue générale** | Direction générale : trésorerie consolidée, prévision 30 jours, créances clients, dettes fournisseurs. Chaque chiffre porte son statut (confirmé, estimé ou à vérifier) et un bouton « Comment est-ce calculé ? » qui montre la source, la période, les éléments utilisés, les hypothèses et les incertitudes. Les **7 décisions préparées** : que faire aujourd'hui, combien payer cette semaine, quels fournisseurs régler, quels clients relancer, quels chantiers perdent de l'argent, solde à 30 et 90 jours, risques urgents. |
| 2 | Trésorerie | Soldes datés par compte (jamais présentés comme soldes du jour), trésorerie réelle sur 24 mois, dépenses par catégorie, encaissements et paiements par mois, crédits et leasing. |
| 3 | Comptes bancaires | Contrôle des soldes (solde recalculé = solde banque, ruptures, couverture sur 24 mois) et liste des comptes. |
| 4 | Import des extraits | CODA (Europabank), PDF Belfius et BNP Paribas Fortis, CSV et Excel de toute banque. Contrôle des soldes bloquant, doublons, continuité, aperçu avant confirmation. Journal des imports. |
| 5 | Transactions | Mouvements : classement proposé « à vérifier » puis appris, corrections historisées, validation en lot, export CSV. Historique sur 24 mois. |
| 6 | Rapprochement bancaire | Mouvements non rapprochés avec la meilleure proposition (sûre ou probable). Paiement écrit dans la facture ou l'achat : directement par le propriétaire, sur approbation pour les autres. Factures clients et fournisseurs avec leurs états. |
| 7 | Crédits et leasing | Registre avec échéancier calculé à partir des seules données disponibles (intérêts et capital, in fine, valeur de rachat) et documents joints. |
| 8 | Charges fixes | Registre. Charges détectées dans les extraits proposées « à confirmer », jamais incluses avant confirmation. |
| 9 | Prévisions | 3 scénarios × 7/30/90 jours, hypothèses modifiables, flux détaillés confirmés ou estimés, liste « non inclus », fiabilité, alertes de trésorerie. |
| 10 | Rentabilité des chantiers | Marché (devis et avenants), facturé, encaissé, coûts facturés, engagés, payés et restants, marges prévue, à date et finale, avancement. |
| 11 | Alertes | Risques fondés sur des données. Chaque alerte précise les données utilisées, le calcul, l'action, le responsable, la date limite et le statut. Pas de doublons ; résolution automatique quand la condition disparaît. |
| 12 | Rapports quotidiens | « MADIBU – DAILY FINANCIAL REPORT » (sections A à E, 5 priorités), commentaire de l'IA vérifié, décisions, comparaison de deux mois, prévision passée comparée à la réalité. |
| 13 | Assistant IA | Questions en français ou en roumain. Fonctions métier contrôlées, sans SQL ; source, période et hypothèses affichées ; montants vérifiés ; réponses importantes conservées. |
| 14 | Centre d'approbation | Actions sensibles : demande, décision du propriétaire, puis exécution contrôlée et journalisée. L'IA ne fait que proposer. |
| 15 | Paramètres | Rôles du module, propriétaire, double contrôle, durée de validité des demandes, exécutions du cron, désactivation. Journal d'audit avec vérification d'intégrité. |

Protections ajoutées au cœur de BâtiPro (étape 1) :
- une facture validée ne peut plus être modifiée hors note de crédit ;
- l'administrateur peut toujours rouvrir ou supprimer une facture validée, avec copie archivée ;
- un chantier facturé ne peut plus être supprimé.

## 2. Fichiers

### Créés
| Fichier | Rôle |
|---|---|
| `pilotage/.htaccess` | dossier fermé au web |
| `pilotage/guard.php` | protection des factures validées et des chantiers facturés (étape 1) |
| `pilotage/finance.php` | calculs de BâtiPro portés en PHP, à l'identique : totaux, `invState`, achats, `projectFinance` |
| `pilotage/bank_parse.php` | lecteurs CODA, PDF Belfius, PDF BNP, CSV et tableur |
| `pilotage/bank.php` | comptes, import, doublons, continuité, classement, transferts internes, rapprochement, paiement, historique, routes |
| `pilotage/treasury.php` | soldes, engagements, échéanciers, délais observés, prévisions, alertes de trésorerie, fiabilité |
| `pilotage/director.php` | chantiers, risques, alertes suivies, rapport quotidien, vue générale, explications, IA, cron |
| `pilotage/security.php` | rôles, permissions, centre d'approbation, journal d'audit, export, paramètres |
| `pilotage/rollback.sql` | retour arrière de la base (tables du module seulement) |
| `assets/pilotage.js` | les 15 pages |
| `docs/*.md`, `docs/.htaccess` | documentation (fermée au web) |
| `dev/Dockerfile`, `dev/.htaccess` | environnement de test (non nécessaire en production) |
| `tests/…` | 36 fichiers de tests et de données fictives (non nécessaires en production) |

### Fichiers existants modifiés (au total : 85 lignes ajoutées, 6 lignes modifiées)
| Fichier | Lignes | Changement |
|---|---|---|
| `api.php` | +11 | chargement de `guard.php` et 2 contrôles (étape 1) ; route `pilot` ; journalisation des connexions |
| `lib.php` | +15 / −4 | sauvegarde : copie envoyée par e-mail sans les tables bancaires (option b) |
| `cron.php` | +2 | analyse quotidienne du Pilotage |
| `assets/core.js` | 2 modifiées | espaces optionnels (`show`) et titre d'espace |
| `assets/style.css` | +54 | styles `.pil-*` |
| `index.html` | +1 | chargement de `assets/pilotage.js` |

## 3. Tables

**Ajoutées** (toutes avec `company_id`, créées automatiquement à la première utilisation) :
- `item_archive` (étape 1) ;
- `pil_bank_accounts`, `pil_bank_imports`, `pil_bank_tx`, `pil_bank_rules` ;
- `pil_commitments`, `pil_doc_flags` ;
- `pil_alerts`, `pil_reports`, `pil_decisions`, `pil_ai_convs`, `pil_runs` ;
- `pil_audit` (avec 2 déclencheurs anti-modification) ;
- `pil_user_roles`, `pil_approvals`.

Réglages ajoutés dans la table `settings` : `pilotage`, `pilotage_hyp`, `pilotage_security`, `pilotage_audit_anchor`, `pilotage_director` (facultatif), `invoice_lock` (facultatif).

**Modifiées : aucune.** Aucune colonne ni table existante n'est changée.

Les données existantes sont réutilisées sans doublon :
- clients, fournisseurs, sous-traitants (`items.contact`) ;
- chantiers, devis et avenants ;
- factures, achats, commandes ;
- heures, tâches, utilisateurs.

Les nouvelles tables y font référence par leurs identifiants.

## 4. Documentation technique (principes)

- **Pas de framework.** Même architecture que BâtiPro : routes `api.php?r=pilot/...` et pages JavaScript « vanilla ».
- **Montants** en centimes entiers ; calculs financiers déterministes en PHP.
- **Sécurité** : chaque route passe par un contrôle central (rôle → permission) avant toute exécution. La matrice des droits est visible dans Paramètres.
- **Cache** : la vue générale lit le rapport du jour. Il est recalculé seulement si les données ont changé (empreinte légère des imports, mouvements, documents, engagements et hypothèses).
- **Performance** : index dédiés (catégorie et date, rapprochement, IBAN de la contrepartie, empreintes) ; insertion par lots de 200 lignes ; documents lus une seule fois par requête pour le rapprochement.
- **Transparence** : chaque indicateur de la vue générale est expliqué. Chaque alerte contient ses données et son calcul. Chaque prévision détaille ses flux et hypothèses. Statuts « confirmé / estimé / à vérifier » partout.

## 5. Installation

1. Sauvegarde complète du code et de la base (section 6).
2. Installer d'abord sur un **sous-domaine de test** (copie des fichiers et de la base), puis vérifier.
3. Envoyer les fichiers listés en section 2 : nouveaux dossiers `pilotage/` et `assets/pilotage.js`, fichiers modifiés. Les dossiers `tests/` et `dev/` sont inutiles en production.
4. Se connecter en administrateur, puis ouvrir `…/#/pilotage` et cliquer sur « Activer le module ». Les tables se créent seules.
5. **Paramètres** : vérifier le propriétaire (OWNER) et attribuer les rôles (Finance, Comptable, Chef de projet…).
6. **Comptes bancaires** : ajouter les 3 IBAN. **Import des extraits** : importer du plus ancien au plus récent, compte par compte. Les 24 mois d'historique et les soldes de départ viennent du premier extrait de chaque compte.
7. **Crédits et leasing / Charges fixes** : saisir ou confirmer les engagements (salaires, ONSS, TVA, crédits Belfius et BNP…).
8. Facultatif : clé API Claude (Paramètres de BâtiPro → Assistant IA), pour le commentaire du rapport et l'assistant.

## 6. Sauvegarde et restauration

- **Automatique** (existant) : une sauvegarde complète quotidienne sur le serveur (14 jours, plus une par mois pendant un an) et un e-mail hebdomadaire aux super-administrateurs, **sans** les tables bancaires.
- **Manuelle** : Plateforme → Sauvegardes, ou phpMyAdmin → Exporter, et une copie des fichiers (dont `uploads/`, qui contient les extraits originaux dans `uploads/pilotage/`).
- **Restauration** : phpMyAdmin → base vide → Importer le fichier `.sql.gz`. Les déclencheurs du journal d'audit se recréent automatiquement à la première utilisation. Le test `security_test.php` restaure une sauvegarde complète dans une base vierge et compare chaque table, ligne par ligne.
- **Retour arrière du module** :
  - remettre les fichiers d'avant l'installation ;
  - exécuter `pilotage/rollback.sql`, qui supprime uniquement les tables et réglages du module ;
  - ou restaurer la sauvegarde complète.

  Les paiements déjà écrits dans des factures restent : ce sont des données BâtiPro, marquées « Extrait… ».

## 7. Tâche planifiée (cron)

Le cron existant de BâtiPro suffit, par exemple dans cPanel :

```
*/15 * * * * php /home/VOTRE_COMPTE/public_html/cron.php
```

Le Pilotage s'exécute **une fois par jour et par firme** (après 6 h) : analyse, alertes, prévisions, échéances, expiration des demandes, rapport et commentaire IA. Les autres passages ne refont rien. Chaque exécution apparaît dans Paramètres → Module et tâche planifiée.

## 8. Résultats des tests (`bash tests/run.sh`, environnement de test séparé, données fictives)

Dernière exécution complète : **tout réussi**, deux fois de suite sur une instance neuve.

| Suite | Résultat |
|---|---|
| Calculs JavaScript de BâtiPro | 10 / 10 |
| Portage PHP = JavaScript | 7 / 7 |
| Non-régression BâtiPro (API, étapes 0–1) | 28 / 28 |
| Banque (CODA, PDF, doublons, transferts, soldes, rapprochement, paiements) | 29 / 29 |
| Trésorerie et prévisions (dont les 6 règles anti-double comptage) | 27 / 27 |
| Directeur (chantiers, alertes, rapport, cron, IA via un faux serveur) | 18 / 18 |
| Sécurité (rôles, approbations, audit et falsification, CSV, Excel, protections, restauration) | 19 / 19 |
| Navigateur : factures BâtiPro | 5 / 5 |
| Navigateur : Pilotage (15 pages, PDF et Excel lus dans le navigateur, approbation, rôles, explications, téléphone 390 px sans défilement horizontal) | 43 / 43 |
| Navigateur : **tout BâtiPro**, chaque page de chaque menu, sans erreur | 47 pages en administrateur, 32 en « user » |

Vérification supplémentaire avec les **3 vrais extraits** de MADIBU (Europabank CODA, Belfius PDF, BNP PDF de 17 pages), importés par l'interface : contrôle des soldes exact au centime, 124 mouvements. Elle a été faite dans un conteneur local détruit ensuite ; les extraits réels ne sont jamais dans Git.

## 9. Limites restantes

- **CSV / Excel** : testés sur des fichiers fictifs. Au premier vrai export, vérifier les colonnes présélectionnées.
- **IA** : testée avec un faux serveur local. Premier usage réel avec la clé Claude de BâtiPro.
- **E-mails externes approuvés** : envoyés par le SMTP de BâtiPro (à configurer). Sans SMTP, la demande reste « approuvée » avec l'erreur affichée.
- **Déclencheurs MySQL du journal** : selon les droits accordés par l'hébergeur. Sinon, la chaîne d'empreintes et l'ancre détectent toujours une modification.
- **Belfius PDF** : nom de la contrepartie et communication non séparés dans le PDF.
- **Classement automatique** : les noms des fournisseurs de MADIBU ne sont pas dans le code. Ils sont appris après les premières validations (par IBAN ou par nom).
- **Documents et assurances des sous-traitants** : non enregistrés dans BâtiPro, signalés « non vérifiable ».
- **Interface** : en français. Seul l'assistant répond aussi en roumain.
