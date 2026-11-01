# PILOTAGE MADIBU – Étape 1 : protection de l'historique financier

**Problème (audit F1-1 et F1-2, confirmé par les tests de l'étape 0)**
- Une facture validée pouvait être modifiée ou supprimée par n'importe quel compte « bureau » via l'API. Seule l'interface l'empêchait.
- Supprimer un chantier effaçait toutes ses factures, notes de crédit et factures d'achat.

## Règles appliquées par le serveur

| Situation | Avant | Maintenant |
|---|---|---|
| Changer montants, TVA, client, date, type, numéro ou autoliquidation d'une facture / note de crédit **validée** | possible | **refusé à tous**, avec le message « Corrigez-la avec une note de crédit » |
| Ajouter un paiement, envoyer, Peppol, commentaires, lien avec une note de crédit sur une facture validée | possible | **inchangé** |
| Rouvrir ou supprimer une facture validée (fonction existante « Modifier / supprimer quand même ») | tout compte bureau | **administrateur uniquement**, après **copie intégrale** dans la table `item_archive` (empreinte SHA-256) et une entrée « reopen » dans le journal |
| Même chose avec le réglage `invoice_lock = strict` | – | **refusé à tous** : seule la note de crédit est possible |
| Supprimer un chantier contenant une facture validée, une note de crédit ou une facture d'achat | tout est effacé | **refusé** : passer le chantier en « Terminé » ou « Annulé » |
| Brouillons, pro forma, chantier sans document comptable | libres | **inchangés** |

Le contrôle porte sur l'**empreinte fiscale** de la facture, pas sur le texte brut : totaux par taux de TVA calculés par `pilotage/finance.php`, client, date, type, numéro, nombre de lignes. Un identifiant technique de ligne ou un champ d'affichage ne bloque donc jamais un paiement.

## Fichiers

- `api.php` : **3 lignes ajoutées**, rien d'autre de modifié (un `require` et deux appels de contrôle dans la route `items`).
- `pilotage/guard.php` : les règles ci-dessus.
- `pilotage/finance.php` : calcul des totaux en PHP, **équivalent exact** du JavaScript. Il est vérifié sur la référence dorée, y compris les arrondis négatifs des notes de crédit.
- `pilotage/.htaccess` : dossier fermé au web.
- Nouvelle table `item_archive`, créée automatiquement à la première archive. Aucune table existante n'est modifiée.

Les refus utilisent le code **403**. L'interface traite tout 409 comme « modifié par un autre utilisateur » et propose « écraser » ; un 409 aurait donc enfermé l'utilisateur dans une boucle. Ce problème a été trouvé par le test dans le navigateur, puis corrigé.

## Tests (`bash tests/run.sh`)

- JavaScript : 10/10.
- Équivalence PHP ↔ JS : 4/4.
- API : 28/28. Les deux anciens tests « RISQUE CONNU » sont remplacés par 10 tests de protection.
- `cron.php` : OK.
- **Navigateur, interface réelle** : 5/5.
  - validation par « Soumettre » ;
  - paiement partiel accepté ;
  - modification du prix refusée avec un message clair et sans boîte « écraser » ;
  - suppression du chantier facturé refusée ;
  - aucune erreur JavaScript.

## À décider

- **Mode strict pour MADIBU** (`invoice_lock = strict`) : recommandé. En Belgique, une facture validée se corrige par note de crédit. Il s'active par firme et ne touche pas les autres clients de BatiPro.
- Le risque F1-6 (un compte « user » lit tous les fichiers de la firme) n'est pas traité ici. Les extraits bancaires de l'étape 2 utiliseront un stockage séparé et protégé.

## Retour arrière

Retirer les 3 lignes de `api.php`, ou revenir au commit précédent. La table `item_archive` peut rester : elle n'a aucun effet sur l'application.
