# PILOTAGE MADIBU – Étape 2 : import des extraits bancaires

**But :** les extraits des 3 comptes (Europabank, Belfius, BNP Paribas Fortis) sont importés **à la main**. Ils sont contrôlés, dédoublonnés et classés, puis rapprochés des factures et achats de BâtiPro. Les 24 mois d'historique sont reconstitués à partir des extraits.
**Aucune connexion bancaire, aucune API bancaire, aucun paiement possible** depuis ce module. Le test « aucune route de paiement ni de connexion bancaire » le vérifie.

## Formats pris en charge

| Banque | Format | Comment il est lu |
|---|---|---|
| Europabank | **CODA** (.cod, norme Febelfin) | lu par le serveur (`pil_parse_coda`), positions exactes de la norme, accents Windows-1252. Les totaux de contrôle du fichier (enregistrement 9) sont vérifiés. |
| Belfius | **PDF** de l'extrait | le navigateur lit le PDF avec le pdf.js déjà présent dans BâtiPro (lignes + position de chaque morceau de texte) ; le serveur reconnaît ensuite les opérations (`pil_parse_belfius`). |
| BNP Paribas Fortis | **PDF** de l'extrait | même principe, lecture par colonnes : description, contrepartie, valeur, montant (`pil_parse_bnp`). Les opérations sont remises dans l'ordre chronologique ; les annexes « Avis de débit » et « Détail opération » sont ignorées. |

Chaque format a été vérifié sur un vrai extrait fourni par MADIBU. Ces extraits sont restés hors du dépôt et ont été effacés du conteneur de test après la vérification.

| Extrait réel | Résultat |
|---|---|
| CODA Europabank | 9 mouvements, solde initial + mouvements = solde final **au centime** |
| PDF Belfius | 10 mouvements, même contrôle **exact** |
| PDF BNP Paribas Fortis | 17 pages, 105 mouvements, même contrôle **exact** |

Les trois ont aussi été importés par l'interface réelle dans un navigateur, sans aucune erreur.

Pour **CSV / XLS / XLSX**, aucun lecteur n'a été écrit sans exemple réel : il faudrait inventer le format. Il suffit de fournir un export de la banque concernée pour l'ajouter.

## Déroulement d'un import (menu **Pilotage → Importer un extrait**)

1. Choix du compte (ou détection automatique par l'IBAN de l'extrait) et du ou des fichiers.
2. **Lecture et contrôles, rien n'est enregistré à ce stade :**
   - **Contrôle des soldes** : solde initial + mouvements = solde final. Un écart d'un seul centime **bloque** l'import (« lecture incomplète »).
   - Montant ou date illisible : **bloque** l'import. Aucune valeur n'est jamais devinée.
   - **Même fichier** déjà importé (empreinte SHA-256) : bloqué.
   - **Doublons** : un mouvement déjà enregistré (même compte, même date, même montant, même rang) est ignoré, même s'il vient d'un autre fichier ou d'un autre format. Si tous les mouvements sont déjà connus, l'import est bloqué.
   - **Continuité** : le solde de départ doit être égal au solde final de l'extrait précédent, sinon « un extrait manque ». Même contrôle avec l'extrait suivant, et avertissement si la numérotation saute.
   - Périodes qui se chevauchent : avertissement.
3. **Aperçu** : soldes, contrôle ✓/✗, continuité, chaque mouvement avec la catégorie proposée, doublons barrés.
4. **Confirmation** : les mouvements sont enregistrés au statut **« À vérifier »**, et l'extrait original est gardé dans `uploads/pilotage/<firme>/`, dossier fermé au web.

## Classement, transferts internes, rapprochement

- **Catégorie proposée**, jamais validée automatiquement. L'ordre de recherche est le suivant :
  1. IBAN d'un de nos comptes (→ transfert interne).
  2. Vos choix précédents pour le même IBAN ou, sans IBAN (paiement par carte), le même nom.
  3. Mots-clés (frais bancaires, crédit, leasing, secrétariat social, impôts, assurances, carburant, télécom, salaires, matériaux).
  4. Contact BâtiPro ayant cet IBAN (client, fournisseur, sous-traitant).
  5. Communication structurée sur une entrée.
  6. Sinon « À classer ».
- **Transferts internes** : un virement vers un des 3 comptes n'est **jamais** compté comme recette ou dépense. La sortie et l'entrée correspondante (même montant, ± 5 jours) sont reliées automatiquement. Une sortie dont l'entrée n'est pas encore importée apparaît dans « Transferts internes non appariés ».
- **Corrections** : catégorie, nom affiché, note, statut. Les **données de la banque ne sont jamais modifiées**. Chaque correction est historisée (date, auteur, ancienne et nouvelle valeur). Un mouvement « À classer » ne peut pas être validé. La validation groupée est possible.
- **Rapprochement** : pour chaque mouvement, BâtiPro propose les factures (entrées) ou achats (sorties) correspondants.
  - « **sûr** » : même communication structurée.
  - « **probable** » : montant = reste à payer ou total TTC, et même contact ou même IBAN.

  Deux boutons par proposition (décision du 01/11/2026) :
  - « **Rapprocher et enregistrer le paiement** » : le paiement est ajouté dans la facture ou l'achat (`data.payments[]`).
    - Montant et date sont ceux de la banque, mode « Virement », avec une remarque « Extrait <banque> – opération n° … » et le lien `bankTx`.
    - La version du document augmente et l'opération est notée dans le journal d'activité. Pour un achat, « payé » et la date de paiement sont recalculés comme dans BâtiPro, et une ligne est ajoutée à son historique.
    - **Refusé** si le montant dépasse le reste à payer, si la facture n'est pas validée, ou si l'achat est refusé ou encore « à valider ». Dans ce cas, rien n'est enregistré, pas même le rapprochement.
    - **Jamais en double** : pas de second ajout pour le même mouvement, ni si un paiement du même montant (± 7 jours) a déjà été saisi à la main.
    - Retirer le rapprochement, ou annuler l'import, **retire ce paiement** et seulement celui-là. Un paiement saisi à la main n'est jamais touché.
  - « **Rapprocher seulement** » : lien sans aucune modification du document.

## Écrans (espace **Pilotage**, visible seulement par les administrateurs d'une firme où le module est activé)

- **Contrôle** :
  - solde total ;
  - mouvements à vérifier et non classés ;
  - ruptures de solde ;
  - transferts non appariés ;
  - une carte par compte (dernier solde, période, « solde recalculé = solde de la banque », couverture des 24 derniers mois) ;
  - derniers imports.
- **Mouvements** : filtres (compte, catégorie, mois, statut), recherche, totaux hors transferts internes, fiche détaillée (texte brut de la banque, corrections, rapprochement, historique).
- **Historique 24 mois** :
  - consolidé et par compte : solde début, entrées, sorties, transferts internes, solde fin ;
  - mois incomplets signalés.

  Les soldes de départ des 24 mois viennent du **premier extrait importé** de chaque compte. Il suffit donc d'importer les extraits depuis le début de la période voulue.
- **Journal des imports** : qui, quand, quel fichier, période, soldes, mouvements et doublons, remarques. On peut y télécharger l'original ou **annuler** un import : ses mouvements sont retirés, mais le journal et le fichier original sont conservés.
- **Comptes** : IBAN vérifié (clé de contrôle), banque déduite de l'IBAN.

## Sécurité

- Toutes les routes `api.php?r=pilot/...` exigent un **administrateur**, sauf l'activation, qui exige elle aussi un administrateur, et le **module activé pour la firme** (réglage `pilotage`, activé depuis la page Pilotage). Le rôle « user » reçoit 403 (testé).
- Chaque table a une colonne `company_id`. Un mouvement d'une autre firme reste invisible et ne peut pas être modifié (testé).
- Les extraits originaux ne sont **pas** dans la table `files` (que tout compte « user » peut lire, risque F1-6). Ils sont dans `uploads/pilotage/`, fermé au web (testé), et téléchargeables seulement par un administrateur.
- Les montants sont stockés en **centimes entiers** (BIGINT), jamais en nombres à virgule.
- **Tests avec des extraits 100 % fictifs** (`tests/fixtures/bank/`, générés par `make-bank-fixtures.mjs`) : faux noms, IBAN et communications inventés mais valides, structure identique aux vrais extraits.

### Sauvegarde hebdomadaire par e-mail (option b retenue)

La sauvegarde quotidienne du serveur reste **complète**, tables bancaires comprises. En revanche, la copie envoyée chaque semaine par **e-mail** est produite à part, **sans les tables `pil_bank_*`**. Le texte de l'e-mail le signale. Changement dans `lib.php` : `backup_db()` accepte des préfixes de tables à exclure, et une nouvelle fonction `backup_mail_copy()` produit cette copie. Un test le vérifie.

## Fichiers modifiés et ajoutés

Fichiers existants (**20 lignes ajoutées, 2 modifiées**) :

| Fichier | Changement |
|---|---|
| `api.php` | une route `pilot` (5 lignes) |
| `assets/core.js` | les espaces de navigation acceptent un espace optionnel (`show`) – 1 ligne |
| `index.html` | chargement de `assets/pilotage.js` |
| `assets/style.css` | 8 règles `.pil-*` |
| `tests/run.sh` | ajout des nouveaux tests |

Nouveaux fichiers :

| Fichier | Rôle |
|---|---|
| `pilotage/bank_parse.php` | lecteurs CODA / Belfius / BNP |
| `pilotage/bank.php` | tables, contrôles, import, classement, transferts, rapprochement, historique, routes |
| `assets/pilotage.js` | les écrans |

Tables ajoutées, créées automatiquement à la première utilisation du module : `pil_bank_accounts`, `pil_bank_imports`, `pil_bank_tx`, `pil_bank_rules`. **Aucune table existante n'est modifiée.**

## Tests (`bash tests/run.sh`)

- 10 tests de calcul en JavaScript.
- 4 tests d'équivalence des calculs PHP.
- 28 tests API de non-régression (étapes 0 et 1) : tous toujours verts.
- **24 nouveaux tests** dans `tests/php/bank_test.php` :
  - lecture : montants belges, IBAN, communications, CODA (y compris un fichier ré-enregistré en UTF-8 et un fichier **altéré** détecté), Belfius, BNP, format inconnu ;
  - API : droits, aperçu sans enregistrement, double import, soldes faux, extrait manquant puis comblé, transfert interne apparié, doublon venant d'un autre fichier, corrections historisées, validation groupée, rapprochement sans modification de BâtiPro, historique mensuel, annulation et ré-import, apprentissage, cloisonnement des firmes, absence de tout appel réseau.
- Navigateur : `tests/e2e/ui_pilotage.cjs`. Le PDF est lu par pdf.js dans Chromium, puis viennent l'aperçu avec contrôle exact et la confirmation. On y teste aussi la correction et la validation d'un mouvement, l'historique, le journal, et l'absence d'erreur JavaScript.

## Mise en ligne (après validation)

Fichiers à envoyer :

- `pilotage/bank.php`, `pilotage/bank_parse.php` ;
- `assets/pilotage.js` ;
- les fichiers modifiés `api.php`, `assets/core.js`, `assets/style.css`, `index.html`.

Ensuite :

1. Se connecter en administrateur MADIBU.
2. Ouvrir l'adresse `…/#/pilotage` et cliquer sur « Activer le module ».
3. Ajouter les 3 comptes.
4. Importer les extraits en commençant par le plus ancien de chaque compte.

Les autres firmes de la plateforme ne voient rien tant que le module n'est pas activé chez elles.
