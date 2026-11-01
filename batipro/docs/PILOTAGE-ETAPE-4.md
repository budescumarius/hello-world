# PILOTAGE MADIBU – Étape 4 : AI Director, rapport quotidien, assistant

## Architecture (séparation demandée)

| Couche | Où | Rôle |
|---|---|---|
| **Calculs financiers déterministes** | `pilotage/finance.php`, `treasury.php`, `director.php` (PHP) | Tous les montants : chantiers, risques, prévisions, rapport, comparaisons, revue des prévisions. |
| **Requêtes métier contrôlées** | `pil_ai_tools()` / `pil_run_tool()` | 9 fonctions en lecture seule. **Aucun accès SQL** pour l'IA. Chaque résultat indique sa source, sa période, ses hypothèses et les données manquantes. |
| **Analyse et explication par l'IA** | Claude, via la clé et le SDK déjà présents dans BâtiPro (`ai.php`) | Commente, explique, priorise. Elle ne calcule pas, ne paie rien et ne modifie rien. |

**Contrôle anti-invention** : chaque montant écrit par l'IA (format 1.234,56) est recherché dans les données qu'elle a reçues. Un montant introuvable est signalé à l'écran : « ⚠ montant(s) introuvable(s) dans les données – à ne pas utiliser ».

**Données limitées** : les IBAN et les textes bancaires bruts ne sont jamais envoyés à l'IA. Sans clé API, tout fonctionne sauf le commentaire et l'assistant.

## Analyse des chantiers (`pilotage/chantiers`)

Pour chaque chantier :
- devis accepté, avenants approuvés et avenants en attente, montant contractuel ;
- facturé, encaissé, reste dû ;
- achats, sous-traitance, main-d'œuvre (heures × coût horaire), autres dépenses ;
- coûts **facturés / engagés / payés / estimés restants** ;
- marge prévue, marge à date, rentabilité finale prévue ;
- avancement de la facturation comparé à la consommation des coûts.

Le calcul de base est `projectFinance()` de BâtiPro, porté en PHP. Le test montre qu'il donne **exactement les mêmes résultats** que le JavaScript sur la référence dorée, ainsi que `invState` et `purchState`.

## Risques détectés (seulement avec des données identifiables)

**Chantiers :**
- chantier déficitaire ;
- marge insuffisante (< 10 %, réglable) ;
- coûts > devis + 10 % ;
- coûts plus rapides que l'avancement (écart > 20 points) ;
- états d'avancement approuvés non facturés ;
- chantier terminé avec un reste à facturer ;
- avenant sans accord écrit depuis plus de 15 jours ;
- chantier en retard.

**Finances :**
- déficit de trésorerie prévisible (critique s'il survient dans les 30 jours) ;
- salaires et obligations sociales non couverts ;
- TVA à payer ;
- échéance de crédit ;
- charges fixes supérieures aux recettes ;
- facture client non encaissée ;
- dépendance envers un client (≥ 40 % du chiffre d'affaires sur 12 mois).

**Fournisseurs :**
- facture enregistrée deux fois ;
- fournisseur payé plus que la facture ;
- virement identique au même IBAN à moins de 7 jours (possible double paiement) ;
- dépense inhabituelle (plus de 3 fois la médiane de sa catégorie).

**Conformité :**
- assurance expirée (registre des engagements) ;
- sous-traitant à payer sans vérification de l'obligation de retenue 30bis ;
- extraits trop anciens.

**Non vérifiable**, indiqué comme tel dans le rapport et jamais inventé : documents et assurances des sous-traitants. BâtiPro n'enregistre pas leurs dates d'expiration.

## Alertes

Champs de chaque alerte :
- titre, description, catégorie ;
- gravité : faible, moyenne, élevée ou critique ;
- date de détection, montant, chantier ou fournisseur concerné ;
- **données utilisées**, **explication du calcul**, action recommandée ;
- responsable proposé (le chef de chantier si la fiche en indique un), date limite proposée ;
- statut : nouvelle, en cours, résolue ou ignorée ;
- historique.

**Pas de répétition :** chaque alerte a une clé unique. Une alerte déjà connue est **mise à jour**, jamais recréée. Le statut, le responsable et la date choisis par l'utilisateur sont conservés. Une alerte dont la condition disparaît est résolue automatiquement, puis rouverte si la condition revient. Une alerte « ignorée » le reste.

## Rapport « MADIBU – DAILY FINANCIAL REPORT » (`pilotage/directeur`)

- **A. Trésorerie** : soldes datés, dernier extrait, mouvements récents, prévisions 3 scénarios × 7/30/90 jours, fiabilité.
- **B. Encaissements** : factures en attente, factures échues, encaissements attendus, clients à relancer.
- **C. Décaissements à 30 jours** : fournisseurs, sous-traitants, salaires, ONSS, TVA, crédits, leasing, autres.
- **D. Chantiers** : chantiers à risque et déficitaires, travaux à facturer, dépenses anormales, avenants en attente.
- **E. Les 5 priorités** : pourquoi, impact, montant, qui, pour quand. Bouton « Décision… » sur chacune.
- **Commentaire de l'IA**, avec la vérification des montants.

**Un seul rapport par date.** Le rapport est régénéré uniquement si les données ont changé ; sa version augmente alors.

## Automatisation (`cron.php` existant, 1 ligne ajoutée)

- Une fois par jour et par firme où le module est activé, à partir de 6 h : analyse, alertes, prévisions, échéances, rapport, commentaire IA.
- Les autres passages du cron (toutes les 15 minutes) ne refont rien.
- Chaque exécution est journalisée dans `pil_runs` (début, fin, résultat, message).

## Assistant (`pilotage/assistant`)

- Questions en langage naturel, en roumain ou en français, avec des exemples prêts à cliquer.
- Chaque réponse affiche les données consultées et la vérification de ses montants.
- Les données manquantes sont dites explicitement, par exemple « période partiellement couverte par les extraits ».
- Les conversations sont conservées, et les réponses importantes peuvent être épinglées.

## Historique

Sont conservés :
- les rapports quotidiens ;
- les alertes et leur historique ;
- les décisions et actions (statut : décidée, réalisée, abandonnée) ;
- les réponses épinglées ;
- les exécutions.

Outils d'historique :
- **Comparer deux mois** : banque, facturation, achats, situation des rapports de fin de mois.
- **Prévision passée vs réalité** : le scénario réaliste enregistré dans le rapport d'une date est comparé au solde réel reconstitué à partir des extraits. L'écart est décomposé :
  - encaissements prévus non reçus ;
  - sorties prévues non réalisées ;
  - entrées imprévues ;
  - sorties imprévues ;
  - reste non expliqué.

  Si les extraits ne couvrent pas la date, l'outil refuse explicitement la comparaison.

## Fichiers

- **Nouveaux :** `pilotage/director.php`, `tests/php/director_test.php`, `tests/mock/claude_mock.php` (faux serveur API Claude, uniquement pour les tests).
- **Modifiés :**
  - `pilotage/finance.php` : portage de `invState`, `purchState`, `expenseParts` et `projectFinance` ;
  - `pilotage/bank.php` : routes ;
  - `cron.php` : 1 ligne ;
  - `assets/pilotage.js` : 3 écrans ;
  - `assets/style.css` ;
  - `tests/php/finance_test.php` : 3 tests d'équivalence ;
  - `tests/run.sh`, `tests/e2e/ui_pilotage.cjs`.
- **Tables ajoutées :** `pil_alerts`, `pil_reports`, `pil_decisions`, `pil_ai_convs`, `pil_runs`. Aucune table existante n'est modifiée.

## Tests

- 7 tests d'équivalence PHP / JavaScript (dont `projectFinance`).
- 18 tests directeur :
  - vérification des montants de l'IA ;
  - analyse d'un chantier complet, valeur par valeur ;
  - sections du rapport ;
  - champs des alertes ;
  - non-répétition, conservation du statut et du responsable ;
  - résolution et réouverture automatiques ;
  - double facture et trop-payé ;
  - cron une seule fois par jour ;
  - assistant via le faux serveur : outil métier appelé, sans SQL ni IBAN, montant inventé signalé ;
  - commentaire du rapport ;
  - comparaison de deux mois ;
  - revue des prévisions, y compris le refus faute d'extraits ;
  - historique.
- Test navigateur sur les 3 écrans : rapport, prise en charge d'une alerte, comparaison, question à l'assistant, fiche d'un chantier.
