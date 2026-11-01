# PILOTAGE MADIBU – Étape 0 : préparation

**But** : disposer d'une base de référence sûre avant toute modification de BatiPro.
**Aucun fichier de l'application n'a été modifié.** Seuls des dossiers d'outillage ont été ajoutés : `tests/`, `dev/` et `docs/`.

## 1. Dépôt Git de référence

- Dépôt : `budescumarius/hello-world` (privé), branche **`batipro-pilotage`**, dossier `batipro/`.
- Commit `c2ad8b5` « BatiPro v141 : version de référence, inchangée » : copie exacte de `batipro-v141.zip` (SHA-256 commençant par `472c4392…`).
  - Le dossier `vendor/` (SDK Anthropic et Guzzle) n'est pas versionné. Il provient de l'archive d'origine et se réinstalle avec `composer install`, d'après `composer.lock`.
  - Les bibliothèques JavaScript `assets/vendor/` **sont** versionnées. Elles ont été ajoutées de force, car le `.gitignore` d'origine les excluait par erreur (motif `vendor/`).
- Règle de travail : une branche par étape ; rien n'est fusionné ni déployé sans votre validation.
- **Retour arrière** : à tout moment, `git checkout c2ad8b5 -- .` redonne la v141 exacte.

## 2. Environnement de test

Il reproduit un hébergement cPanel : **Apache + PHP 8.1 + MariaDB 10.6**, avec `.htaccess` actif, dans Docker (`dev/Dockerfile`).
- Instance jetable, base en mémoire, **données 100 % fictives**, installée avec le **vrai** `install.php`.
- `bash tests/run.sh` : crée l'instance, installe, lance les tests, puis détruit tout.
- `KEEP=1 bash tests/run.sh` : garde l'instance ouverte sur http://127.0.0.1:8081 (identifiant `admin@test.madibu.local`, mot de passe `Admin-Test-2026`, fictifs).
- Le dossier de travail n'est jamais modifié par les tests : le code est copié dans le conteneur.

Pour un test sur l'hébergement réel, il faudra un **sous-domaine distinct** avec sa propre base, alimentée par une copie restaurée de la sauvegarde. Jamais la base de production.

## 3. Tests de non-régression (résultat : 30 / 30 réussis, plus le cron OK)

### a) Calculs financiers actuels – `tests/js/` (10 tests)
Les fonctions sont lues **telles quelles** dans `assets/*.js`, sans copie : `totals`, `invState`, `purchVat/Ttc/Paid/Rest/State`, `expenseParts`, `projectFinance`.
Les valeurs attendues ont été **calculées à la main** sur des scénarios fictifs (`tests/fixtures/finance-scenarios.json`) :

- remise répartie par taux de TVA ;
- autoliquidation et notes de crédit ;
- paiements partiels, retards, anciens achats « payés » ;
- achat ventilé sur plusieurs chantiers ;
- aperçu financier complet d'un chantier : budget, déboursé, réel, engagé, facturé, encaissé, reste dû, marge.

`tests/fixtures/finance-golden.json` est la **référence d'équivalence** : le futur code PHP du Pilotage devra donner exactement ces résultats. Une empreinte du code source des calculs fait échouer les tests si quelqu'un modifie un calcul sans le vouloir.

Limite constatée : `num('1.234,56')` donne `1,234` (point des milliers non géré). C'est sans conséquence à la saisie, mais le Pilotage, notamment l'import bancaire, ne doit pas reproduire cette limite.

### b) API PHP – `tests/php/api_test.php` (20 tests)
Couverture :
- installation et refus d'une seconde installation ;
- fichiers internes inaccessibles (`.htaccess`) ;
- `cron.php` fermé au web ;
- session obligatoire, mauvais mot de passe, protection CSRF ;
- numérotation séquentielle des chantiers et des factures ;
- verrou de modification concurrente (409) ;
- journal d'activité ;
- **cloisonnement multi-firmes** ;
- rôles `user`, `chef`, `ouvrier` ;
- envoi et lecture de fichiers, type `.php` refusé, dossier `uploads/` fermé.

Les **risques connus de l'audit sont confirmés par exécution réelle** :
- F1-1 : une facture émise est supprimée sans résistance par l'API ;
- F1-2 : supprimer un chantier efface ses factures ;
- F1-6 : un compte « user » lit n'importe quel fichier de la firme, donc les futurs extraits bancaires ne doivent pas passer par ce mécanisme.

Ces tests sont marqués « RISQUE CONNU ». Ils échoueront volontairement si l'étape 1 (durcissement) corrige ces points, et seront alors mis à jour.

### c) Tâche planifiée
`cron.php` s'exécute sans erreur en ligne de commande.

## 4. Déploiement : ce qu'il ne faut PAS envoyer sur l'hébergement

Les dossiers `tests/`, `dev/` et `docs/` sont des outils de développement. Chacun contient un `.htaccess` « Require all denied » par sécurité, mais **ils ne doivent pas être copiés en production**. L'archive de déploiement contiendra uniquement les fichiers de l'application, plus `vendor/`.

## 5. Prochaine étape proposée

**Étape 1 – durcissement (à valider)** : refuser côté serveur la modification ou la suppression d'une facture émise et la suppression d'un chantier facturé.
Sinon, passage direct à l'**étape 2 – import bancaire** (CODA en priorité), après réception des informations demandées dans l'audit (§ L) :
- les banques et formats d'extraits ;
- le sous-domaine de test ;
- les accès au Pilotage ;
- la décision sur la copie de sauvegarde par e-mail.
