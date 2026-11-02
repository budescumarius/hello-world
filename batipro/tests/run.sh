#!/usr/bin/env bash
# Tests de non-régression BatiPro – environnement de TEST jetable (jamais la production).
#   1. calculs financiers JavaScript actuels (Node ≥ 20, « npm install » une fois dans tests/)
#   2. API PHP sur une instance fraîche : Apache + PHP 8.1 + MariaDB 10.6 dans Docker,
#      installée avec le vrai install.php, données 100 % fictives, détruite à la fin.
# Usage : bash tests/run.sh            (depuis le dossier batipro/)
#         KEEP=1 bash tests/run.sh     (garde les conteneurs pour explorer http://127.0.0.1:8081)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
NET=bp-test DB=bp-test-db WEB=bp-test-web

echo "== 1. Calculs financiers (JavaScript actuel)"
(cd tests && [ -d node_modules ] || npm install --silent) >/dev/null
(cd tests && node --test js/*.test.mjs)

echo "== 2. API PHP sur instance de test"
cleanup() { [ "${KEEP:-0}" = 1 ] || docker rm -f "$DB" "$WEB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker rm -f "$DB" "$WEB" >/dev/null 2>&1 || true
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
docker image inspect batipro-test-web >/dev/null 2>&1 || docker build -q -t batipro-test-web dev >/dev/null
docker run -d --name "$DB" --network "$NET" --network-alias db --tmpfs /var/lib/mysql -p 127.0.0.1:3307:3306 \
  -e MARIADB_DATABASE=batipro_test -e MARIADB_USER=batipro -e MARIADB_PASSWORD=batipro-test -e MARIADB_ROOT_PASSWORD=root-test mariadb:10.6 >/dev/null
docker run -d --name "$WEB" --network "$NET" -p 127.0.0.1:8081:80 batipro-test-web >/dev/null
# copie du code (sans config.php, uploads/ ni outils de développement) dans le conteneur : le dossier de travail reste intact
tar --exclude=./config.php --exclude='./uploads/*' --exclude=./tests --exclude=./dev --exclude=./.git -cf - . \
  | docker exec -i "$WEB" tar -xf - -C /var/www/html
docker exec "$WEB" chown -R www-data:www-data /var/www/html
for i in $(seq 1 60); do docker exec "$DB" healthcheck.sh --connect >/dev/null 2>&1 && break; sleep 1; done
# installation par le vrai formulaire install.php
curl -s -o /dev/null -w "   install.php : HTTP %{http_code}\n" -X POST http://127.0.0.1:8081/install.php \
  --data-urlencode db_host=db --data-urlencode db_name=batipro_test --data-urlencode db_user=batipro --data-urlencode db_pass=batipro-test \
  --data-urlencode company="MADIBU TEST" --data-urlencode name="Admin Test" --data-urlencode email=admin@test.madibu.local --data-urlencode password=Admin-Test-2026
php tests/php/finance_test.php || exit 1
php tests/php/api_test.php || exit 1
php tests/php/bank_test.php || exit 1
php tests/php/treasury_test.php || exit 1
php tests/php/director_test.php || exit 1
php tests/php/security_test.php || exit 1
echo "== 3. Tâche planifiée"
docker exec -u www-data "$WEB" php /var/www/html/cron.php > /tmp/bp-cron.log 2>&1 && echo "   cron.php : exécution OK" || { echo "   cron.php : ÉCHEC"; cat /tmp/bp-cron.log; exit 1; }
echo "== 4. Interface réelle dans un navigateur (facultatif)"
if node -e "require('playwright')" 2>/dev/null; then node tests/e2e/ui_invoice.cjs || exit 1; node tests/e2e/ui_pilotage.cjs || exit 1; node tests/e2e/ui_peppol_groupes.cjs || exit 1; node tests/e2e/ui_factures_validees.cjs || exit 1; node tests/e2e/ui_smoke.cjs || exit 1; else echo "   Playwright absent : étape ignorée"; fi
