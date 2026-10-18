<?php
// Tâche planifiée (cPanel › Tâches cron), par ex. toutes les 15 minutes :
//   php /home/VOTRE_COMPTE/public_html/cron.php
// Relève les factures fournisseurs reçues via Peppol et les ajoute aux achats.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit('Réservé aux tâches planifiées'); }
require __DIR__ . '/lib.php';
require __DIR__ . '/peppol_ap.php';
migrate();
// chaque firme active connectée à Peppol
foreach (q("SELECT c.id, c.name FROM companies c JOIN settings s ON s.company_id = c.id AND s.k = 'peppolap' WHERE c.active = 1")->fetchAll() as $c) {
    $GLOBALS['BP_CID'] = (int)$c['id'];
    $ap = setting('peppolap', []) ?: [];
    if (empty($ap['key'])) continue;
    try {
        $r = pap_sync(null);
        echo date('c') . " {$c['name']} : " . count($r['created']) . " achat(s) reçu(s) via Peppol\n";
        foreach ($r['created'] as $x) log_activity(null, 'create', 'expense', $x['id'], null, 'Reçu via Peppol : ' . $x['label']);
        foreach ($r['errors'] ?? [] as $e) echo "  erreur $e\n";
    } catch (Throwable $e) {
        echo date('c') . " {$c['name']} : " . $e->getMessage() . "\n";
    }
}
