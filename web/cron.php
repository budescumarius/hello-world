<?php
// Tâche planifiée (cPanel › Tâches cron), par ex. toutes les 15 minutes :
//   php /home/VOTRE_COMPTE/public_html/cron.php
// Relève les factures fournisseurs reçues via Peppol et les ajoute aux achats.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('Réservé aux tâches planifiées'); }
require __DIR__ . '/lib.php';
require __DIR__ . '/peppol_ap.php';
$ap = setting('peppolap', []) ?: [];
if (empty($ap['key'])) { echo "Peppol non configuré\n"; exit(0); }
try {
    $r = pap_sync(null);
    echo date('c') . ' Peppol : ' . count($r['created']) . " achat(s) créé(s)\n";
    foreach ($r['errors'] ?? [] as $e) echo "  erreur $e\n";
} catch (Throwable $e) {
    echo date('c') . ' Peppol : ' . $e->getMessage() . "\n";
    exit(1);
}
