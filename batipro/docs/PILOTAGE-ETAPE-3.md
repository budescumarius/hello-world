# PILOTAGE MADIBU – Étape 3 : trésorerie, engagements et prévisions

**Principe :** aucun montant n'est inventé. Chaque flux prévu vient de l'une de ces sources :
- un extrait bancaire ;
- une facture ou un achat de BâtiPro ;
- un engagement (crédit, leasing, charge) **confirmé par l'utilisateur** ;
- un paiement enregistré dans BâtiPro mais pas encore visible sur un extrait.

Les montants **confirmés** et **estimés** sont toujours séparés.

## Écrans (espace Pilotage)

### Trésorerie

- **Soldes** : chaque compte, avec son solde « au JJ/MM (dernier extrait) » et l'âge de l'extrait, puis la trésorerie consolidée. Un solde ancien n'est jamais présenté comme le solde du jour. Le « solde ajusté » ajoute les paiements enregistrés dans BâtiPro après le dernier extrait.
- **Prévision** :
  - 3 scénarios (optimiste, réaliste, pessimiste) × 3 horizons (7, 30, 90 jours) ;
  - présentation : solde de départ + entrées (confirmées / estimées) − sorties (confirmées / estimées) = solde final ;
  - solde minimum avec sa date, et date de passage en négatif ;
  - graphique des 3 scénarios et tableau comparatif.
- **Alertes** : chaque alerte indique le problème, le montant, la date, l'impact, le risque et l'action recommandée. Cas couverts :
  - solde prévu négatif ;
  - extrait ancien ;
  - échéance de crédit ou de leasing dans les 7 jours ;
  - fin de contrat dans les 60 jours ;
  - facture client en retard ;
  - facture fournisseur à payer dans les 7 jours ou échue ;
  - salaires / ONSS / précompte non couverts ;
  - TVA à payer, ou aucune échéance de TVA enregistrée ;
  - charges fixes supérieures aux encaissements moyens des 6 derniers mois.
- **Flux prévus** : liste détaillée, avec lien vers la facture ou l'achat. La liste « Non inclus » explique ce qui est écarté et pourquoi.
- **Graphiques** :
  - trésorerie réelle sur 24 mois ;
  - dépenses par catégorie ;
  - encaissements clients par mois ;
  - paiements fournisseurs par mois ;
  - échéances des 30 prochains jours ;
  - crédits et leasing (capital restant).
- **Fiabilité** (note sur 100), calculée à partir de :
  - extraits complets et récents ;
  - mouvements validés ;
  - encaissements rapprochés ;
  - achats validés ;
  - engagements confirmés.

### Engagements

Registre des crédits (6 types), des leasings (4 types) et des charges fixes (11 catégories).

- **Champs** :
  - organisme ;
  - compte débité ;
  - montant et fréquence ;
  - date de prélèvement ;
  - début et fin ;
  - pour un crédit : capital initial, capital restant dû et sa date, taux, mode de remboursement (mensualités ou in fine), garanties ;
  - pour un leasing : valeur de rachat ;
  - documents (stockés hors du web) ;
  - statut.
- **Échéancier d'un crédit** :
  - avec un taux et le capital restant à une date : répartition intérêts / capital et capital restant recalculé ;
  - sans ces données : seules les mensualités sont prévues, avec un message « non recalculé » ;
  - sans mensualité : aucune échéance.
- **Détection dans les extraits** : un même bénéficiaire et un montant stable pendant au moins 3 mois donnent une *proposition*. Elle reste **« à confirmer »** et **n'entre pas dans les prévisions** avant votre confirmation. Une saisie manuelle vaut confirmation.

### Factures et échéances

- **Factures clients**, avec ces états :
  - non échu ;
  - échu ;
  - partiellement payé ;
  - payé ;
  - **contesté** : marque propre au Pilotage, qui ne modifie pas la facture BâtiPro ;
  - **en attente d'approbation**, **approuvé – à facturer** : états d'avancement existants de BâtiPro.
- **Factures fournisseurs** : engagé, échu, partiellement payé, payé, à valider. Le chantier est indiqué.

## Hypothèses (modifiables : bouton « Hypothèses des scénarios »)

| | Optimiste | Réaliste | Pessimiste |
|---|---|---|---|
| Délai client | p25 observé | médiane observée (du client si ≥ 2 factures, sinon globale) | p75 observé + 15 j |
| Probabilité d'encaissement des factures en retard | non | oui, observée (seulement avec ≥ 5 factures) | oui |
| Factures en retard de plus de 60 j | comptées | comptées | exclues |
| États d'avancement approuvés / envoyés | oui / oui | oui / non | non / non |
| Marge de prudence sur les sorties | 0 % | 0 % | 5 %, ligne séparée « Prudence » |

Sans historique de paiement, aucun délai ni aucune probabilité n'est inventé : le montant entier est compté à l'échéance, et la fiabilité baisse. Les sorties (achats, engagements confirmés) sont les mêmes dans les trois scénarios : les dépenses obligatoires sont maintenues.

## Pas de double comptage (règles testées une par une)

1. Factures et achats : seul le **reste à payer** est compté.
2. Paiement BâtiPro postérieur au dernier extrait, sans lien bancaire et hors espèces : compté **une fois**. Un paiement antérieur, ou déjà rapproché, est déjà dans le solde.
3. Échéance d'un engagement antérieure au dernier extrait du compte débité : déjà dans le solde, donc ignorée.
4. Engagement lié à un fournisseur : l'échéance est **remplacée** par l'achat saisi (± 15 jours).
5. Engagements « à confirmer » : jamais comptés.
6. Notes de crédit : déjà déduites de la facture d'origine. Facture contestée : exclue.

Une échéance passée depuis le dernier extrait est placée à aujourd'hui et signalée « après le dernier extrait ». Plus les extraits sont anciens, plus il y en a : il faut donc importer les extraits récents.

## Corrigé au passage

Le bouton « Ajouter un compte » de l'étape 2 ne fonctionnait pas : il était cherché dans la page au lieu de l'en-tête. Il est corrigé, et un test navigateur le vérifie désormais.

## Fichiers

- Nouveau : `pilotage/treasury.php` (calculs purs en tête de fichier, puis base de données et routes).
- Modifiés :
  - `pilotage/bank.php` : renvoi des nouvelles routes ;
  - `assets/pilotage.js` : 3 écrans ;
  - `assets/style.css` : règles `.pil-*` ;
  - `tests/run.sh`.
- Tables ajoutées : `pil_commitments`, `pil_doc_flags`. Réglage `pilotage_hyp`. **Aucune table existante modifiée.**

## Tests

`tests/php/treasury_test.php` contient 27 tests :
- échéances (fin de mois, trimestriel, date de fin) ;
- crédit amortissable : intérêts exacts, capital entièrement remboursé ;
- crédit in fine ;
- données incomplètes ;
- leasing avec rachat ;
- percentiles et probabilités ;
- projection jour par jour ;
- **les 6 règles anti-double comptage** ;
- scénarios ;
- API : droits, soldes datés, confirmation obligatoire, détection sans création, documents protégés, cohérence fin = départ + entrées + sorties, facture contestée, hypothèses, champs des alertes, états des factures.

Le test navigateur couvre les 3 écrans, le changement de scénario, la modification d'une hypothèse et la saisie d'un leasing.
