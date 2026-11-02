# PILOTAGE MADIBU – Étape 5 : approbations, sécurité, rôles, audit, tests

## 1. Principe : l'IA prépare, l'humain décide

| L'IA peut | L'IA ne peut jamais (vérifié dans le code et les tests) |
|---|---|
| Lire les données via 11 fonctions métier contrôlées (aucun SQL) | Payer, signer, accepter un contrat |
| Calculer via ces fonctions, détecter les risques | Envoyer un e-mail ou une commande externe (`proposer_action` → centre d'approbation) |
| Préparer un e-mail de relance (`proposer_action`) | Modifier une facture validée ou un montant définitif |
| Créer une tâche interne BâtiPro (`creer_tache_interne`) | Supprimer un historique, modifier des droits |

Aucun appel réseau sortant dans le module, sauf l'API Claude de BâtiPro (test « aucun appel réseau »).

## 2. Centre d'approbation (`Pilotage → Approbations`)

Chaque demande indique :
- le type, la description et l'origine (utilisateur ou **IA**) ;
- les données concernées, le montant, la justification, les risques et les documents ;
- les dates de création et d'expiration ;
- la décision (qui, quand, note) et l'exécution (qui, quand, résultat ou erreur).

Statuts : **en attente → approuvée → exécutée**, ou refusée / annulée / expirée.

**Approuver n'est pas exécuter.** Une demande approuvée attend le bouton « Exécuter ». L'exécution passe par un exécuteur dédié, qui revérifie tout (une facture déjà soldée ne reçoit pas de second paiement) et journalise le résultat. Si l'exécution échoue, la demande reste « approuvée », l'erreur est conservée, et on peut réessayer.

| Action sensible | Qui peut demander | Qui décide | Exécution |
|---|---|---|---|
| Annuler un import bancaire | rôles avec accès bancaire en écriture | propriétaire | propriétaire ou administrateur |
| Enregistrer un paiement dans une facture ou un achat (rapprochement) | finance, administrateur, **IA** (le propriétaire l'enregistre directement) | propriétaire | idem |
| Supprimer un crédit, leasing ou charge | rôles avec accès aux engagements | propriétaire | idem |
| Modifier les droits d'un utilisateur | administrateur (le propriétaire les modifie directement) | propriétaire | idem |
| E-mail externe (relance client…) | tous les rôles du module, **IA** | propriétaire | idem (envoi par le SMTP de BâtiPro) |

- **Double contrôle** (réglage) : le demandeur ne peut pas approuver sa propre demande.
- **Expiration** : 14 jours par défaut (réglable). Le contrôle se fait à chaque consultation et chaque matin par le cron.

## 3. Rôles (contrôlés par le serveur pour chaque route)

Les rôles BâtiPro existants ne changent pas. Le module ajoute son propre rôle par utilisateur :

| Rôle Pilotage | Droits | Par défaut |
|---|---|---|
| **Propriétaire (OWNER)** | tout, et seul à approuver | le premier administrateur de la firme (modifiable dans Paramètres) |
| **Administrateur** | imports, classements, engagements, alertes, rapports, exécution des demandes approuvées, journal d'audit | administrateurs BâtiPro |
| **Finance** | données bancaires et financières, imports, rapprochements (paiements : sur approbation), prévisions et hypothèses, assistant, export | attribué par le propriétaire |
| **Comptable** | lecture des données bancaires et de trésorerie, export CSV, journal d'audit | attribué |
| **Chef de projet** | analyse financière de **ses** chantiers uniquement (responsable ou membre de l'équipe) | attribué |
| **Chef de chantier / Employé / Aucun** | aucun accès au Pilotage (ils gardent l'espace terrain BâtiPro) | tous les autres |

La matrice complète est affichée dans `Pilotage → Paramètres`. L'interface masque ce qui n'est pas permis ; le serveur refuse quand même (403), ce que vérifie le test « matrice des permissions » (9 routes × 6 rôles).

## 4. Journal d'audit (`Pilotage → Journal d'audit`)

Événements journalisés :
- connexions et exports ;
- imports et annulations, téléchargements d'extraits originaux ;
- corrections, classifications, rapprochements, paiements écrits dans les documents ;
- comptes ;
- crédits, leasing et charges : ajout, modification, confirmation, documents, suppression ;
- hypothèses de prévision, contestations ;
- rapports quotidiens (processus `cron` ou utilisateur) ;
- actions de l'IA : questions, commentaires, propositions, tâches ;
- alertes, décisions, rôles, paramètres ;
- approbations : demande, accord, refus, annulation, expiration, exécution, échec.

Chaque entrée contient l'utilisateur ou le processus (utilisateur, IA, cron, système), la date et l'heure, l'action, l'objet concerné, l'**ancienne et la nouvelle valeur**, et l'origine (route web et adresse IP, ou tâche planifiée).

**Protections**, sans prétendre à une inviolabilité absolue :
1. Aucune route ne permet de modifier ou de supprimer le journal (testé).
2. **Déclencheurs MySQL** : toute UPDATE ou DELETE sur `pil_audit` est refusée par la base. Ils sont recréés automatiquement s'ils ont été retirés. Cela suppose que l'hébergeur autorise les déclencheurs ; la page indique si c'est le cas.
3. **Chaîne d'empreintes SHA-256** : chaque entrée contient l'empreinte de la précédente.
4. **Ancre** (nombre d'entrées et dernière empreinte), conservée à part et recopiée chaque jour dans le rapport quotidien.

Le bouton de vérification recalcule tout. Le test simule un administrateur serveur qui retire les déclencheurs, falsifie une entrée, puis supprime la dernière : les deux manipulations sont **détectées**.

Un administrateur du serveur avec un accès direct à la base peut toujours modifier les données. Ce contrôle permet alors de le **détecter**, pas de l'empêcher.

## 5. Protection des données

| Exigence | Mise en œuvre |
|---|---|
| Contrôle d'accès strict | Rôle et permission vérifiés par le serveur pour chaque route du module ; cloisonnement par firme (`company_id`) testé |
| Protection des fichiers | Extraits et documents dans `uploads/pilotage/` (fermé au web, testé), téléchargement journalisé, jamais via la table `files` (risque F1-6) |
| Validation des uploads | Base64 contrôlé, 20 Mo maximum, format reconnu (CODA, PDF par signature, CSV, Excel), extensions de documents limitées, `.php` refusé (testé) |
| CSRF | En-tête `X-Requested-With: batipro` obligatoire (existant, testé) |
| Injections SQL | Requêtes préparées partout (`q()`) ; filtre hostile testé |
| XSS | Tout texte affiché passe par `esc()` (une note HTML est stockée telle quelle et affichée comme du texte) |
| Sessions | Gestion BâtiPro existante (cookie HttpOnly, SameSite, 2FA, régénération) ; connexions journalisées |
| Secrets API | Clé Claude jamais renvoyée au navigateur (testé) |
| Données vers l'IA | Pas d'IBAN, pas de texte bancaire brut ; résultats agrégés (testé sur le faux serveur) |
| Sauvegardes | Quotidienne complète sur le serveur ; e-mail hebdomadaire **sans** les tables bancaires (option b) ; **restauration vérifiée** par test (toutes les tables, mêmes lignes) |
| RGPD | Données bancaires visibles seulement des rôles bancaires ; le chef de projet ne voit que ses chantiers, sans banque ; le comptable est en lecture seule |

## 6. Import CSV et Excel (complète l'étape 2)

- **Toutes banques.** L'utilisateur choisit les colonnes : date, montant (ou débit et crédit), date valeur, contrepartie, IBAN, communication, solde, n°. Elles sont présélectionnées d'après leur titre (FR / NL / EN). Aucun format bancaire n'est deviné.
- **CSV** : relu par le serveur, avec détection du séparateur et de l'encodage.
- **Excel** : lu par SheetJS (déjà présent dans BâtiPro) dans le navigateur. Le fichier original est conservé.
- **Contrôle des soldes maintenu** :
  - soit grâce à une colonne « Solde », ligne par ligne ;
  - soit avec le solde de l'extrait précédent et le solde final saisi par l'utilisateur.

  Sans solde final, l'import est refusé.
- Doublons, continuité, transferts internes et classement : identiques aux autres formats.
- Le compte doit être choisi.

## 7. Tests (`bash tests/run.sh`, dernière exécution : tout réussi)

| Fichier | Tests | Couvre |
|---|---|---|
| `tests/js/*.test.mjs` | 10 | calculs JavaScript de BâtiPro |
| `tests/php/finance_test.php` | 7 | portage PHP = JavaScript (totaux, `invState`, achats, `projectFinance`) |
| `tests/php/api_test.php` | 28 | non-régression BâtiPro (étapes 0–1) |
| `tests/php/bank_test.php` | 29 | import PDF / CODA, doublons, transferts, soldes, rapprochement, paiements |
| `tests/php/treasury_test.php` | 27 | échéanciers, prévisions, anti-double comptage |
| `tests/php/director_test.php` | 18 | chantiers, alertes, rapport, cron, IA (faux serveur) |
| `tests/php/security_test.php` | 19 | permissions, approbations, audit et falsification, CSV, Excel, protections, restauration |
| `tests/e2e/ui_invoice.cjs`, `ui_pilotage.cjs` | 5 + 40 vérifications | vrai navigateur : factures, et tout le Pilotage, y compris PDF et Excel lus dans le navigateur, approbation et rôles |

Toutes les données de test sont **fictives** (`tests/fixtures/bank/make-bank-fixtures.mjs`). Les vrais extraits ne sont jamais dans Git. Ils ont seulement servi à vérifier les lecteurs, dans un conteneur détruit ensuite.

## 8. Mise en production (checklist)

1. **Sauvegarde du code** : télécharger le dossier de BâtiPro depuis cPanel (gestionnaire de fichiers → compresser).
2. **Sauvegarde de la base** : phpMyAdmin → Exporter, ou Plateforme → Sauvegardes → « Sauvegarder maintenant ».
3. **Vérifier la restauration** : importer la sauvegarde dans une base vide (le test `security_test.php` fait exactement cela).
4. **Environnement séparé** : installer d'abord sur un sous-domaine de test (copie du site + copie de la base), puis valider.
5. **Mise en ligne** : envoyer les fichiers listés en section 10 (aucun fichier existant n'est supprimé). Les tables se créent seules à la première utilisation.
6. **Permissions** : propriétaire et rôles dans `Pilotage → Paramètres` ; vérifier qu'un compte « user » ne voit pas le module.
7. **Cron** : la tâche existante `php …/cron.php` (toutes les 15 minutes) suffit ; le rapport est produit une fois par jour après 6 h. Vérifier `Pilotage → Directeur → Exécutions` le lendemain.
8. **Retour arrière** :
   - remettre les fichiers sauvegardés à l'étape 1 ;
   - dans la base, exécuter `pilotage/rollback.sql`, qui ne supprime que les tables et réglages du module ;
   - ou restaurer la sauvegarde complète.

Les modifications des fichiers BâtiPro existants sont petites et listées. Les migrations ne font qu'**ajouter** des tables (aucun ALTER sur une table existante).

## 9. Critères de validation

| # | Critère | État | Preuve |
|---|---|---|---|
| 1 | Les 3 comptes peuvent être importés | ✅ | vrais extraits Europabank (CODA), Belfius (PDF), BNP (PDF 17 p.) : contrôle exact ; tests fictifs |
| 2 | Transactions correctement extraites | ✅ | soldes initial + mouvements = final au centime, sur les vrais extraits et les fictifs |
| 3 | Doublons détectés | ✅ | même fichier, autre format, période qui chevauche |
| 4 | Transferts internes neutres | ✅ | exclus des entrées et sorties, appariés |
| 5 | Soldes contrôlés | ✅ | contrôle bloquant, continuité, solde recalculé = solde banque |
| 6 | Factures rapprochées | ✅ | propositions, rapprochement, paiement (sur approbation hors propriétaire) |
| 7 | Transactions incertaines signalées | ✅ | « à vérifier », « à classer », probabilités, ruptures |
| 8 | Prévisions explicables | ✅ | flux détaillés, hypothèses, revue « prévu vs réel » |
| 9 | Alertes justifiées par des données | ✅ | données utilisées et calcul pour chaque alerte |
| 10 | Rapports quotidiens générés | ✅ | cron, une fois par jour, journalisé |
| 11 | Permissions fonctionnent réellement | ✅ | matrice testée (serveur) et menu par rôle (navigateur) |
| 12 | Approbations obligatoires | ✅ | 5 actions sensibles ; approuver ≠ exécuter |
| 13 | Journaux d'audit conservés | ✅ | chaîne, ancre, déclencheurs, falsification détectée |
| 14 | Tests réussis | ✅ | 138 tests PHP / JS + 45 vérifications navigateur |
| 15 | Aucune fonction BâtiPro cassée | ✅ | 28 tests de non-régression et test navigateur des factures, à chaque exécution |

## 10. Limites restantes (honnêtes)

- **CSV / Excel** : testés uniquement sur des fichiers fictifs. Les colonnes sont choisies à la main au premier import ; un vrai export de chaque banque permettra de vérifier les titres reconnus.
- **E-mail externe** : l'exécution réelle passe par le SMTP de BâtiPro. L'environnement de test n'a pas de SMTP, donc le test vérifie le chemin d'échec (demande conservée, erreur affichée, nouvel essai possible).
- **IA** : testée avec un faux serveur local. La première utilisation réelle se fera avec la clé Claude de BâtiPro.
- **Déclencheurs MySQL** : ils dépendent des droits accordés par l'hébergeur. Sinon, la chaîne d'empreintes et l'ancre restent actives et la page le signale.
- **Belfius PDF** : le nom de la contrepartie et la communication ne sont pas séparés dans le PDF (affichage « nom + texte »).
- **Classement automatique** : les noms des fournisseurs de MADIBU ne sont pas inscrits dans le code. L'apprentissage (par IBAN ou par nom) les reprend après les premières validations.
- **Documents et assurances des sous-traitants** : non enregistrés dans BâtiPro. Ils sont signalés « non vérifiable ».
- **Reste l'étape finale d'intégration** (prompt final) : page « Vue générale – Direction générale » (trésorerie, prévision 30 jours, créances, dettes), ordre des 15 pages, performance et cache, livrable de documentation complet.
