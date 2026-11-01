<?php
// PILOTAGE étape 4 : AI Director – analyse des chantiers, risques, alertes suivies, rapport quotidien, cron, assistant.
// L'IA est remplacée par un faux serveur local (tests/mock/claude_mock.php) : aucune donnée ne sort de l'instance de test.
declare(strict_types=1);
require __DIR__ . '/harness.php';
if (!function_exists('setting')) { function setting($k, $d = null) { return $d; } }
require __DIR__ . '/../../pilotage/bank_parse.php';
require __DIR__ . '/../../pilotage/finance.php';
require __DIR__ . '/../../pilotage/director.php';

echo "Vérification des montants cités par l'IA\n";
T::test('montants belges extraits d\'un texte (points, espaces fines, négatifs)', function () {
    T::eq([123456, 50, -200000, 1234567890], pil_amounts_in_text("Solde 1.234,56 € puis 0,50 €, perte -2.000,00 € et 12\u{202F}345\u{202F}678,90 €."));
});
T::test('réponse vérifiée : montant présent dans les données = ok ; montant inventé = signalé', function () {
    $data = ['total' => 1954681, 'nested' => ['x' => 'reste 605,00 €']];
    T::eq(['ok' => true, 'unverified' => []], pil_ai_verify('Trésorerie : 19.546,81 € ; achat 605,00 €.', $data));
    T::eq(['ok' => false, 'unverified' => ['999.999,99 €']], pil_ai_verify('Vous aurez 999.999,99 €.', $data));
});

// ===================================================================== API
echo "\nAnalyse des chantiers et alertes (instance de test)\n";
$admin = new Client('admin'); $admin->login('admin@test.madibu.local', 'Admin-Test-2026');
$user = new Client('user'); $user->login('user@test.madibu.local', 'Role-Test-2026');
$T = date('Y-m-d'); $ago = fn(int $d) => date('Y-m-d', strtotime("-$d days"));
$P = [];

T::test('réservé aux administrateurs', function () use ($user) { foreach (['reports', 'alerts', 'projects', 'decisions'] as $r) { [$c] = $user->req('GET', "pilot/$r"); T::eq(403, $c, $r); } [$c] = $user->req('POST', 'pilot/ask', ['question' => 'x']); T::eq(403, $c); });
T::test('chantier : marché (devis + avenant accepté), coûts facturés / engagés / payés / restants, marges, avancement', function () use ($admin, $T, $ago, &$P) {
    [, $cli] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Maître d\'ouvrage Fictif']]);
    [, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Rénovation Directeur', 'clientId' => $cli['id'], 'status' => 'encours', 'start' => $ago(60), 'end' => $ago(10), 'managerId' => 1]]);
    $line = fn($price, $cost, $type) => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => $price, 'cost' => $cost, 'type' => $type, 'vat' => 21]];
    [, $q] = $admin->req('POST', 'items/quote', ['project_id' => $p['id'], 'data' => ['status' => 'accepte', 'date' => $ago(70), 'lines' => $line(10000, 6000, 'mat')]]);
    $admin->req('POST', 'items/quote', ['project_id' => $p['id'], 'data' => ['status' => 'accepte', 'avenantOf' => $q['id'], 'avenantNo' => 1, 'date' => $ago(40), 'lines' => $line(2000, 1500, 'st')]]);
    [, $av2] = $admin->req('POST', 'items/quote', ['project_id' => $p['id'], 'data' => ['status' => 'envoye', 'avenantOf' => $q['id'], 'avenantNo' => 2, 'date' => $ago(30), 'lines' => $line(500, 300, 'mat')]]);
    [, $sup] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'fournisseur', 'company' => 'Négoce Fictif']]);
    $admin->req('POST', 'items/expense', ['project_id' => $p['id'], 'data' => ['supplierId' => $sup['id'], 'ref' => 'NF-1', 'date' => $ago(20), 'due' => $ago(-10), 'amount' => 9000, 'vat' => 21, 'category' => 'mat', 'status' => 'validee', 'payments' => [['date' => $ago(5), 'amount' => 5445, 'method' => 'Virement']]]]);
    $admin->req('POST', 'items/timesheet', ['project_id' => $p['id'], 'data' => ['date' => $ago(15), 'hours' => 10, 'rate' => 50]]);
    $admin->req('POST', 'items/order', ['project_id' => $p['id'], 'data' => ['kind' => 'fournisseur', 'status' => 'envoyee', 'supplierId' => $sup['id'], 'lines' => [['kind' => 'item', 'desc' => 'Location', 'qty' => 1, 'price' => 1000, 'vat' => 21]]]]);
    $admin->req('POST', 'items/invoice', ['project_id' => $p['id'], 'data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => $ago(25), 'due' => $ago(-5), 'lines' => [['kind' => 'item', 'desc' => 'Acompte', 'qty' => 1, 'price' => 3000, 'vat' => 21]]]]);
    [$c, $l] = $admin->req('GET', 'pilot/projects'); T::eq(200, $c);
    $x = array_values(array_filter($l, fn($r) => $r['id'] === $p['id']))[0];
    T::eq([1000000, 200000, 1200000], [$x['quote_main'], $x['avenants_accepted'], $x['contract']], 'marché = devis + avenant accepté (pas l\'avenant en attente)');
    T::eq([900000, 0, 50000, 900000, 1050000, 100000, 450000, 750000, 0], [$x['cost_purchases'], $x['cost_subcontracting'], $x['cost_labour'], $x['cost_invoiced'], $x['cost_engaged'], $x['cost_open_orders'], $x['cost_paid'], $x['cost_estimated'], $x['cost_remaining']],
        'facturé 9.000 (fournisseur), engagé 9.000 + 500 MO + 1.000 commande, payé 50 % de l\'achat, restant 0 (déjà dépassé)');
    T::eq([450000, 300000 - 950000, 150000, 12.5], [$x['margin_planned'], $x['margin_to_date'], $x['margin_final'], (float)$x['margin_final_pct']], 'marges prévue, à date (facturé − coûts réels), finale');
    T::eq([25.0, 140.0, 10], [(float)$x['progress_billing'], (float)$x['progress_cost'], $x['late_days']], 'avancement facturé 3.000 / 12.000, coûts 10.500 / 7.500');
    T::eq([$av2['id']], array_column($x['avenants_pending'], 'id'));
    $P = ['project' => $p, 'supplier' => $sup, 'client' => $cli];
});
T::test('rapport quotidien : sections A à E, 5 priorités maximum avec pourquoi / impact / montant / qui / quand', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/reports', ['noAi' => true]); T::eq(200, $c, json_encode($r));
    $d = $r['report']['data'];
    T::eq('MADIBU – DAILY FINANCIAL REPORT', $d['title']);
    foreach (['A', 'B', 'C', 'D', 'E'] as $k) T::ok(isset($d[$k]), "section $k");
    T::ok(isset($d['A']['latest_statement'], $d['A']['forecast']['realiste'][30]), 'soldes datés et prévision');
    T::ok(count($d['E']) <= 5 && count($d['E']) > 0, 'priorités');
    foreach ($d['E'] as $e) foreach (['why', 'impact', 'amount', 'who', 'when'] as $k) T::ok(array_key_exists($k, $e), "priorité : $k");
    T::ok(in_array('Documents obligatoires et assurances des sous-traitants : non enregistrés dans BâtiPro (aucune date d\'expiration disponible).', $d['not_verifiable'], true), 'risque non vérifiable signalé, pas inventé');
    T::eq(['sous_traitants', 'fournisseurs', 'salaires', 'onss', 'tva', 'credits', 'leasing', 'autres'], array_values(array_intersect(['sous_traitants', 'fournisseurs', 'salaires', 'onss', 'tva', 'credits', 'leasing', 'autres'], array_keys($d['C']['next_30d']))));
});
T::test('alertes : chaque champ demandé ; risques de chantier détectés avec données et calcul', function () use ($admin, &$P) {
    [, $l] = $admin->req('GET', 'pilot/alerts');
    foreach ($l as $a) foreach (['title', 'description', 'category', 'severity', 'first_seen', 'amount', 'entity_label', 'data', 'calc', 'action', 'owner', 'due', 'status'] as $k) T::ok(array_key_exists($k, $a), "champ $k");
    $keys = array_column($l, 'akey'); $pid = $P['project']['id'];
    foreach (["chantier:ecart:$pid", "chantier:rythme:$pid", "chantier:retard:$pid"] as $k) T::ok(in_array($k, $keys, true), "alerte $k");
    T::ok((bool)array_filter($keys, fn($k) => str_starts_with($k, 'chantier:avenant:')), 'avenant sans accord écrit depuis 30 jours');
    $e = array_values(array_filter($l, fn($a) => $a['akey'] === "chantier:ecart:$pid"))[0];
    T::eq([300000, 'elevee', 'Responsable du chantier (Admin Test)'], [$e['amount'], $e['severity'], $e['owner']], 'écart 10.500 − 7.500, responsable proposé = chef de chantier');
    T::ok(str_contains($e['calc'], 'déboursé') && isset($e['data']['Montant contractuel HT']), 'données utilisées et explication du calcul');
    T::ok(in_array($e['severity'], ['faible', 'moyenne', 'elevee', 'critique'], true), 'gravité sur 4 niveaux');
});
T::test('alertes non répétées : même jour = même rapport et mêmes alertes ; le statut, le responsable et la date choisis sont conservés', function () use ($admin, &$P) {
    $n = (int)db()->query('SELECT COUNT(*) FROM pil_alerts')->fetchColumn();
    [, $r] = $admin->req('POST', 'pilot/reports', ['noAi' => true]); T::ok(str_contains($r['message'], 'inchangé'), $r['message']);
    T::eq(1, (int)db()->query('SELECT COUNT(*) FROM pil_reports WHERE rdate = CURDATE()')->fetchColumn(), 'un seul rapport pour la date');
    T::eq($n, (int)db()->query('SELECT COUNT(*) FROM pil_alerts')->fetchColumn());
    $id = (int)db()->query("SELECT id FROM pil_alerts WHERE akey = 'chantier:ecart:{$P['project']['id']}'")->fetchColumn();
    [$c, $a] = $admin->req('PUT', "pilot/alerts/$id", ['status' => 'en_cours', 'owner' => 'Conducteur de travaux', 'due' => '2027-01-15', 'note' => 'Avenant n° 3 à proposer au client']); T::eq(200, $c);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_decisions WHERE alert_id = $id")->fetchColumn(), 'décision enregistrée');
    db()->exec("UPDATE pil_reports SET hash = 'x' WHERE rdate = CURDATE()");
    $admin->req('POST', 'pilot/reports', ['noAi' => true]);
    $a = db()->query("SELECT status, owner, due, occurrences FROM pil_alerts WHERE id = $id")->fetch();
    T::eq(['en_cours', 'Conducteur de travaux', '2027-01-15', 1], [$a['status'], $a['owner'], $a['due'], (int)$a['occurrences']]);
    T::eq(2, (int)db()->query('SELECT version FROM pil_reports WHERE rdate = CURDATE()')->fetchColumn(), 'données changées : rapport mis à jour (version 2), pas dupliqué');
});
T::test('alerte résolue automatiquement quand la condition disparaît, rouverte si elle revient ; « ignorée » reste ignorée', function () use ($admin, &$P) {
    $p = $P['project']; $k = "chantier:retard:{$p['id']}";
    [, $cur] = $admin->req('GET', "items/project/{$p['id']}");
    $cur['data']['end'] = date('Y-m-d', strtotime('+30 days')); [$c] = $admin->req('PUT', "items/project/{$p['id']}", ['data' => $cur['data'], 'version' => $cur['version']]); T::eq(200, $c);
    $admin->req('POST', 'pilot/reports', ['noAi' => true]);
    T::eq('resolue', db()->query("SELECT status FROM pil_alerts WHERE akey = '$k'")->fetchColumn());
    [, $cur] = $admin->req('GET', "items/project/{$p['id']}"); $cur['data']['end'] = date('Y-m-d', strtotime('-3 days')); $admin->req('PUT', "items/project/{$p['id']}", ['data' => $cur['data'], 'version' => $cur['version']]);
    $admin->req('POST', 'pilot/reports', ['noAi' => true]);
    $a = db()->query("SELECT id, status, history FROM pil_alerts WHERE akey = '$k'")->fetch();
    T::eq('nouvelle', $a['status']); T::ok(str_contains($a['history'], 'réapparue'), 'historique');
    $admin->req('PUT', "pilot/alerts/{$a['id']}", ['status' => 'ignoree']);
    db()->exec("UPDATE pil_reports SET hash = 'x' WHERE rdate = CURDATE()"); $admin->req('POST', 'pilot/reports', ['noAi' => true]);
    T::eq('ignoree', db()->query("SELECT status FROM pil_alerts WHERE akey = '$k'")->fetchColumn());
});
T::test('fournisseurs : facture enregistrée deux fois et fournisseur payé plus que la facture', function () use ($admin, &$P) {
    $s = $P['supplier']['id'];
    [, $e1] = $admin->req('POST', 'items/expense', ['data' => ['supplierId' => $s, 'ref' => 'DBL-77', 'date' => date('Y-m-d'), 'amount' => 100, 'vat' => 21, 'status' => 'validee']]);
    [, $e2] = $admin->req('POST', 'items/expense', ['data' => ['supplierId' => $s, 'ref' => 'dbl-77', 'date' => date('Y-m-d'), 'amount' => 100, 'vat' => 21, 'status' => 'validee', 'payments' => [['date' => date('Y-m-d'), 'amount' => 200, 'method' => 'Virement']]]]);
    db()->exec("UPDATE pil_reports SET hash = 'x' WHERE rdate = CURDATE()"); $admin->req('POST', 'pilot/reports', ['noAi' => true]);
    $keys = db()->query("SELECT akey FROM pil_alerts WHERE status IN ('nouvelle','en_cours')")->fetchAll(PDO::FETCH_COLUMN);
    T::ok(in_array("fournisseur:double_facture:{$e1['id']}-{$e2['id']}", $keys, true), 'double facture');
    T::ok(in_array("fournisseur:trop_paye:{$e2['id']}", $keys, true), 'trop payé (200,00 pour 121,00)');
    T::eq(7900, (int)db()->query("SELECT amount FROM pil_alerts WHERE akey = 'fournisseur:trop_paye:{$e2['id']}'")->fetchColumn());
});
T::test('tâche planifiée : une analyse par jour et par firme, journalisée ; pas de second traitement le même jour', function () {
    $run = fn() => shell_exec('docker exec -e PIL_CRON_FORCE=1 -u www-data bp-test-web php /var/www/html/cron.php 2>&1');
    $o1 = (string)$run(); T::ok(str_contains($o1, 'pilotage firme 1'), $o1);
    $o2 = (string)$run(); T::ok(!str_contains($o2, 'pilotage firme 1'), 'second passage ignoré : ' . $o2);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_runs WHERE source = 'cron' AND rdate = CURDATE()")->fetchColumn());
    T::eq('ok', db()->query("SELECT status FROM pil_runs WHERE source = 'cron' ORDER BY id DESC LIMIT 1")->fetchColumn());
    T::eq(1, (int)db()->query('SELECT COUNT(*) FROM pil_reports WHERE rdate = CURDATE()')->fetchColumn(), 'toujours un seul rapport pour la date');
});

echo "\nIA (faux serveur Claude local)\n";
shell_exec('docker cp ' . escapeshellarg(__DIR__ . '/../mock/claude_mock.php') . ' bp-test-web:/tmp/claude_mock.php && docker exec -d bp-test-web php -S 127.0.0.1:9090 -t /tmp /tmp/claude_mock.php');
usleep(800000);
T::test('assistant non configuré : message clair', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/ask', ['question' => 'Combien avons-nous ?']); T::eq(400, $c); T::ok(str_contains($r['error'], 'non configuré'), $r['error']);
});
$admin->req('PUT', 'settings', ['ai' => ['key' => 'cle-de-test', 'baseUrl' => 'http://127.0.0.1:9090']]);
T::test('question : l\'IA appelle une requête métier contrôlée, cite source et période ; montant vérifié ; conversation conservée', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/ask', ['question' => 'Quel sera notre solde bancaire dans 30 jours ?']); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    T::eq('tresorerie', $r['tools'][0]['outil']); T::eq(true, $r['check']['ok'], json_encode($r['check'])); T::ok(str_contains($r['answer'], 'source'), $r['answer']);
    [, $c2] = $admin->req('GET', "pilot/convs/{$r['conv_id']}"); T::eq(1, count($c2['turns']));
    [$c] = $admin->req('PUT', "pilot/convs/{$r['conv_id']}", ['index' => 0, 'pinned' => true]); T::eq(200, $c);
    [, $pins] = $admin->req('GET', 'pilot/pinned'); T::eq('Quel sera notre solde bancaire dans 30 jours ?', $pins[0]['q'] ?? null, 'réponse importante conservée');
    $log = (string)shell_exec('docker exec bp-test-web cat /tmp/claude_mock.log');
    T::ok(!str_contains($log, '"iban":true'), 'aucun IBAN complet envoyé à l\'IA');
    T::ok(str_contains($log, '"tresorerie"') && !preg_match('/sql|query/i', $log), 'outils métier seulement, aucun accès SQL');
});
T::test('montant inventé par l\'IA : signalé à l\'utilisateur', function () use ($admin) {
    [, $r] = $admin->req('POST', 'pilot/ask', ['question' => 'INVENTE un montant']);
    T::eq(false, $r['check']['ok']); T::eq(['999.999,99 €'], $r['check']['unverified']);
});
T::test('question sur les sous-traitants depuis janvier : totaux des achats BatiPro par type de fournisseur', function () use ($admin) {
    [, $r] = $admin->req('POST', 'pilot/ask', ['question' => 'Combien avons-nous payé aux sous-traitants depuis janvier ?']);
    T::eq(['totaux_achats', 'soustraitant'], [$r['tools'][0]['outil'], $r['tools'][0]['parametres']['type_fournisseur']]);
});
T::test('commentaire IA du rapport : montants vérifiés contre le rapport, pas d\'IBAN envoyé', function () use ($admin) {
    db()->exec('DELETE FROM pil_reports WHERE rdate = CURDATE()');
    [$c, $r] = $admin->req('POST', 'pilot/reports', []); T::eq(200, $c);
    T::ok(str_starts_with((string)$r['report']['ai_comment'], 'Commentaire de direction'), (string)$r['report']['ai_comment']);
    T::eq(true, $r['report']['ai_check']['ok'], json_encode($r['report']['ai_check']));
    T::ok(!str_contains((string)shell_exec('docker exec bp-test-web cat /tmp/claude_mock.log'), '"iban":true'), 'pas d\'IBAN');
});

echo "\nHistorique, comparaisons, revue des prévisions\n";
T::test('comparaison de deux mois : banque, facturation, achats, sources', function () use ($admin) {
    [$c, $r] = $admin->req('GET', 'pilot/compare&m1=2026-01&m2=2026-02'); T::eq(200, $c);
    T::ok($r['m1']['bank'] !== null && $r['m2']['bank'] !== null, 'mois couverts par les extraits');
    T::eq($r['m2']['bank']['closing'] - $r['m1']['bank']['closing'], $r['diff']['closing']);
    T::ok(str_contains($r['sources'], 'Banque'), 'sources indiquées');
});
T::test('revue d\'une prévision passée : réalité bancaire comparée, écart décomposé ; refus explicite si les extraits ne couvrent pas la date', function () use ($admin) {
    [$c] = $admin->req('POST', 'pilot/reports&today=2026-01-10', ['noAi' => true]); T::eq(200, $c);
    [, $r] = $admin->req('GET', 'pilot/review&date=2026-01-10&days=10'); T::eq(true, $r['available'], json_encode($r, JSON_UNESCAPED_UNICODE));
    $e = $r['explained'];
    T::eq($r['gap'], $e['encaissements_prevus_non_recus'] + $e['sorties_prevues_non_realisees'] + $e['entrees_imprevues'] + $e['sorties_imprevues'] + $e['reste_non_explique']);
    T::eq($r['actual'] - $r['predicted'], $r['gap']);
    T::ok($r['unforeseen'] !== [], 'mouvements imprévus listés (ex. transferts, frais)');
    [, $r2] = $admin->req('GET', 'pilot/review&date=2026-01-10&days=60'); T::eq(false, $r2['available']); T::ok(str_contains($r2['reason'], 'ne couvrent pas'), $r2['reason']);
    [, $r3] = $admin->req('GET', 'pilot/review&date=2025-06-01'); T::eq(false, $r3['available']);
});
T::test('historique : rapports, exécutions et décisions conservés', function () use ($admin) {
    [, $l] = $admin->req('GET', 'pilot/reports'); T::ok(count($l) >= 2, 'rapports');
    [, $runs] = $admin->req('GET', 'pilot/runs'); T::ok(count($runs) >= 3 && isset($runs[0]['message']), 'exécutions journalisées');
    [$c] = $admin->req('POST', 'pilot/decisions', ['text' => 'Relancer le client principal', 'kind' => 'action']); T::eq(200, $c);
    [, $d] = $admin->req('GET', 'pilot/decisions'); T::ok(count($d) >= 2, 'décisions');
});

exit(T::done());
