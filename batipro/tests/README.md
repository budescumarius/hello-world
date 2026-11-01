# Tests BatiPro (outil de développement – ne pas déployer)

```bash
cd tests && npm install      # une fois (installe acorn, utilisé pour lire les fonctions de assets/*.js)
cd .. && bash tests/run.sh   # calculs JS + API PHP sur une instance Docker jetable (Apache, PHP 8.1, MariaDB 10.6)
KEEP=1 bash tests/run.sh     # garde l'instance de test ouverte sur http://127.0.0.1:8081
cd tests && npm run golden   # régénère la référence dorée APRÈS une modification volontaire et vérifiée d'un calcul
```

Prérequis : Docker, Node.js ≥ 20, PHP ≥ 8.1 en ligne de commande avec curl et pdo_mysql.
Facultatif : Playwright (`npm i -g playwright && npx playwright install chromium`) pour le test dans un vrai navigateur (`tests/e2e/`).
Données : uniquement fictives. Ne jamais ajouter de vrais extraits bancaires ou de vraies données clients ici.
Détails : `docs/PILOTAGE-ETAPE-0.md`, `docs/PILOTAGE-ETAPE-1.md`.
