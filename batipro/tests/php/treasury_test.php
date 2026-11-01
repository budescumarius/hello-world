<?php
// PILOTAGE étape 3 : trésorerie et prévisions.
// 1. calculs purs (échéances, crédits, délais de paiement, projection, règles anti-double comptage) – sans serveur ;
// 2. API sur l'instance de test (après bank_test.php : extraits fictifs déjà importés).
declare(strict_types=1);
require __DIR__ . '/harness.php';
// fonctions de l'application utilisées par les calculs purs
if (!function_exists('setting')) { function setting($k, $d = null) { return $d; } }
require __DIR__ . '/../../pilotage/bank_parse.php';
require __DIR__ . '/../../pilotage/finance.php';
// treasury.php charge bank.php (tables, routes) : les fonctions de base de données ne sont pas appelées ici
require __DIR__ . '/../../pilotage/treasury.php';

const TODAY = '2026-03-10';
$H = PIL_HYP_DEFAULT;
$bal = ['accounts' => [['id' => 1, 'bank' => 'A', 'date' => '2026-03-05', 'balance' => 100000, 'age_days' => 5], ['id' => 2, 'bank' => 'B', 'date' => '2026-02-28', 'balance' => 50000, 'age_days' => 10]],
    'total' => 150000, 'latest_date' => '2026-03-05', 'oldest_date' => '2026-02-28', 'missing' => 0];
$noStats = ['global' => ['n' => 0, 'p25' => null, 'median' => null, 'p75' => null], 'clients' => [], 'buckets' => [0 => ['n' => 0, 'p' => null], 30 => ['n' => 0, 'p' => null], 60 => ['n' => 0, 'p' => null], 90 => ['n' => 0, 'p' => null]]];
$inv = fn(array $x) => $x + ['id' => 1, 'number' => 'F1', 'kind' => 'facture', 'ea' => null, 'client' => 7, 'client_name' => 'Client', 'date' => '2026-02-01', 'due' => '2026-03-20', 'approve_by' => null, 'pay_days' => 30,
    'total' => 121000, 'paid' => 0, 'rest' => 121000, 'paid_date' => null, 'payments' => [], 'flag' => null];
$exp = fn(array $x) => $x + ['id' => 50, 'ref' => 'A1', 'supplier' => 9, 'supplier_name' => 'Fournisseur', 'date' => '2026-03-01', 'due' => '2026-03-31', 'to_validate' => false, 'total' => 60500, 'paid' => 0, 'rest' => 60500, 'payments' => []];
$com = fn(array $x) => $x + ['id' => 3, 'kind' => 'charge', 'subtype' => 'loyer', 'label' => 'Loyer dépôt', 'account_id' => 1, 'supplier_id' => null, 'amount' => 150000, 'frequency' => 'mensuel',
    'next_date' => '2026-01-05', 'end_date' => null, 'status' => 'confirme', 'buyback' => 0, 'residual' => null];
$sumSrc = fn(array $flows, string $src) => array_sum(array_map(fn($f) => $f['amount'], array_filter($flows, fn($f) => $f['source'] === $src)));

echo "Échéances et crédits\n";
T::test('mois ajoutés en gardant le jour (31 janvier → 28 février → 31 mars)', function () {
    T::eq(['2026-02-28', '2026-03-31', '2025-12-31', '2028-02-28', '2028-02-29'], [pil_add_months('2026-01-31', 1), pil_add_months('2026-01-31', 2), pil_add_months('2026-01-31', -1), pil_add_months('2027-02-28', 12), pil_add_months('2027-01-31', 13)]);
});
T::test('échéances : mensuel, trimestriel, unique, date de fin respectée', function () {
    T::eq(['2026-02-28', '2026-03-31', '2026-04-30'], pil_occurrences(['next_date' => '2026-01-31', 'frequency' => 'mensuel'], '2026-02-01', '2026-04-30'));
    T::eq(['2026-04-15', '2026-07-15'], pil_occurrences(['next_date' => '2026-01-15', 'frequency' => 'trimestriel', 'end_date' => '2026-07-15'], '2026-02-01', '2027-12-31'));
    T::eq(['2026-06-01'], pil_occurrences(['next_date' => '2026-06-01', 'frequency' => 'unique'], '2026-01-01', '2026-12-31'));
    T::eq([], pil_occurrences(['next_date' => null, 'frequency' => 'mensuel'], '2026-01-01', '2026-12-31'), 'sans date : rien');
});
T::test('crédit amortissable : intérêts = capital restant × taux / 12, capital remboursé exactement, dernière échéance ajustée', function () {
    $c = ['next_date' => '2026-02-01', 'frequency' => 'mensuel', 'amount' => 100000, 'rate' => 6, 'capital_remaining' => 1200000, 'capital_asof' => '2026-01-31'];
    $s = pil_credit_schedule($c, '2026-02-01', '2030-12-31');
    T::eq([6000, 94000, 1106000], [$s['rows'][0]['interest'], $s['rows'][0]['capital'], $s['rows'][0]['remaining']], '1re échéance : 60,00 d\'intérêts');
    T::eq(1200000, array_sum(array_column($s['rows'], 'capital')), 'somme du capital remboursé = capital restant');
    T::eq(0, $s['remaining']); T::eq(13, count($s['rows']));
    T::ok(end($s['rows'])['amount'] < 100000, 'dernière échéance plus petite');
    T::eq([], $s['notes']);
});
T::test('crédit « in fine » (straight loan) : intérêts mensuels puis capital à la date de fin', function () {
    $c = ['next_date' => '2026-02-28', 'frequency' => 'mensuel', 'amount' => null, 'rate' => 7.2, 'capital_remaining' => 20000000, 'capital_asof' => '2026-01-31', 'repayment' => 'in_fine', 'end_date' => '2026-04-30'];
    $s = pil_credit_schedule($c, '2026-02-01', '2026-12-31');
    T::eq([120000, 120000, 120000, 20000000], array_column($s['rows'], 'amount'));
    T::eq(true, end($s['rows'])['balloon']);
});
T::test('données incomplètes : rien d\'inventé (taux manquant → pas de calcul du capital ; mensualité manquante → aucune échéance)', function () {
    $s = pil_credit_schedule(['next_date' => '2026-02-01', 'frequency' => 'mensuel', 'amount' => 50000, 'capital_remaining' => 900000], '2026-02-01', '2026-04-30');
    T::eq([50000, 50000, 50000], array_column($s['rows'], 'amount')); T::eq([null, null, null], array_column($s['rows'], 'interest'));
    T::ok(str_contains(implode(' ', $s['notes']), 'non recalculé'), 'note affichée');
    $s = pil_credit_schedule(['next_date' => '2026-02-01', 'frequency' => 'mensuel', 'amount' => null], '2026-02-01', '2026-04-30');
    T::eq([], $s['rows']); T::ok(str_contains(implode(' ', $s['notes']), 'Mensualité non renseignée'), 'note');
});
T::test('leasing : mensualités puis valeur de rachat à la fin si le rachat est prévu', function () {
    $l = ['kind' => 'leasing', 'amount' => 89200, 'frequency' => 'mensuel', 'next_date' => '2026-02-02', 'end_date' => '2026-04-02', 'buyback' => 1, 'residual' => 250000];
    T::eq([-89200, -89200, -89200, -250000], array_column(pil_commitment_flows($l, '2026-02-01', '2026-12-31'), 'amount'));
});

echo "\nDélais de paiement observés et projection\n";
T::test('délais : percentiles par client et global ; probabilité seulement avec au moins 5 factures', function () {
    $list = [];
    foreach ([0, 10, 20, 30] as $i => $d) $list[] = ['client' => 1, 'due' => '2026-01-01', 'paid_date' => pil_add_days('2026-01-01', $d)];
    $list[] = ['client' => 2, 'due' => '2025-10-01', 'paid_date' => null];
    $s = pil_delay_stats($list, TODAY);
    T::eq([4, 7.5, 15.0, 22.5], [$s['global']['n'], $s['global']['p25'], $s['global']['median'], $s['global']['p75']]);
    T::eq(5, $s['buckets'][0]['n']); T::eq(0.8, $s['buckets'][0]['p'], '4 payées sur 5 échues');
    T::eq(null, $s['buckets'][30]['p'], 'moins de 5 factures : pas de probabilité');
});
T::test('projection : solde jour par jour, minimum, date de passage en négatif, confirmé / estimé séparés', function () {
    $p = pil_project(10000, [['date' => '2026-03-01', 'amount' => -2000, 'certainty' => 'confirme'], ['date' => '2026-03-15', 'amount' => -15000, 'certainty' => 'confirme'], ['date' => '2026-03-20', 'amount' => 30000, 'certainty' => 'estime']], TODAY);
    $h7 = $p['horizons'][7]; $h30 = $p['horizons'][30];
    T::eq([10000, -17000, -17000, 0, 0, -7000], [$h7['start'], $h7['out_confirmed'], $h30['out_confirmed'], $h7['in_estimated'], $h7['out_estimated'], $h7['end']], 'le 15/03 est à 5 jours : dans l\'horizon 7 jours');
    T::eq(['2026-03-15', -7000, '2026-03-15'], [$h30['negative_date'], $h30['min'], $h30['min_date']]);
    T::eq([30000, 23000], [$h30['in_estimated'], $h30['end']]);
    T::eq(8000, $p['series'][0]['b'], 'flux passé (01/03) placé aujourd\'hui');
});

echo "\nAucun double comptage\n";
T::test('facture partiellement payée : seul le reste à encaisser est prévu', function () use ($bal, $noStats, $H, $inv) {
    $docs = ['invoices' => [$inv(['paid' => 21000, 'rest' => 100000, 'payments' => [['date' => '2026-02-15', 'amount' => 210]]])], 'expenses' => []];
    $f = pil_collect_flows($docs, [], $bal, $noStats, $H, TODAY)['flows'];
    foreach ($f as $k => $flows) T::eq(100000, array_sum(array_column($flows, 'amount')), $k);
});
T::test('paiement BatiPro après le dernier extrait, sans lien bancaire : compté une fois ; avant l\'extrait ou rapproché (bankTx) : jamais recompté', function () use ($bal, $noStats, $H, $inv, $sumSrc) {
    $pays = [['date' => '2026-03-01', 'amount' => 100, 'method' => 'Virement'], ['date' => '2026-03-07', 'amount' => 200, 'method' => 'Virement'], ['date' => '2026-03-08', 'amount' => 400, 'method' => 'Virement', 'bankTx' => 5], ['date' => '2026-03-08', 'amount' => 800, 'method' => 'Espèces']];
    $docs = ['invoices' => [$inv(['paid' => 150000, 'rest' => 0, 'total' => 150000, 'payments' => $pays])], 'expenses' => []];
    $f = pil_collect_flows($docs, [], $bal, $noStats, $H, TODAY)['flows']['realiste'];
    T::eq(20000, $sumSrc($f, 'paiement_non_vu'), 'seulement les 200,00 du 07/03');
    T::eq(0, $sumSrc($f, 'facture'), 'facture soldée : aucun encaissement prévu');
});
T::test('échéance d\'engagement déjà passée sur l\'extrait du compte débité : ignorée ; après l\'extrait : comptée une fois', function () use ($bal, $noStats, $H, $com) {
    $f = pil_collect_flows(['invoices' => [], 'expenses' => []], [$com(['next_date' => '2026-01-05'])], $bal, $noStats, $H, TODAY)['flows']['realiste'];
    T::eq(['2026-04-05', '2026-05-05', '2026-06-05'], array_column($f, 'date'), 'le 05/03 est déjà sur l\'extrait du compte 1 (au 05/03)');
    $f = pil_collect_flows(['invoices' => [], 'expenses' => []], [$com(['next_date' => '2026-01-05', 'account_id' => 2])], $bal, $noStats, $H, TODAY)['flows']['realiste'];
    T::eq('2026-03-10', $f[0]['date'], 'compte 2 (extrait au 28/02) : l\'échéance du 05/03 est encore à venir, placée aujourd\'hui');
    T::ok(str_contains($f[0]['label'], 'après le dernier extrait'), 'signalée');
});
T::test('engagement lié à un fournisseur : l\'achat saisi dans BatiPro remplace l\'échéance (pas deux fois le même leasing)', function () use ($bal, $noStats, $H, $com, $exp) {
    $c = $com(['kind' => 'leasing', 'subtype' => 'vehicule', 'label' => 'Leasing camionnette', 'supplier_id' => 9, 'amount' => 60500, 'next_date' => '2026-03-30']);
    $r = pil_collect_flows(['invoices' => [], 'expenses' => [$exp(['due' => '2026-03-31'])]], [$c], $bal, $noStats, $H, TODAY);
    $f = $r['flows']['realiste'];
    T::eq(1, count(array_filter($f, fn($x) => $x['date'] <= '2026-04-15')), 'mars : un seul flux (l\'achat)');
    T::eq('achat', $f[0]['source']);
    T::ok(str_contains(json_encode($r['excluded'], JSON_UNESCAPED_UNICODE), 'achat du même fournisseur déjà compté'), 'exclusion expliquée');
});
T::test('engagements « à confirmer » jamais dans la prévision ; facture contestée et note de crédit exclues', function () use ($bal, $noStats, $H, $com, $inv) {
    $r = pil_collect_flows(['invoices' => [$inv(['flag' => 'conteste']), $inv(['id' => 2, 'kind' => 'avoir', 'total' => -50000, 'rest' => -50000])], 'expenses' => []], [$com(['status' => 'a_confirmer'])], $bal, $noStats, $H, TODAY);
    foreach ($r['flows'] as $k => $flows) T::eq([], $flows, $k);
    T::eq(['à confirmer', 'contestée'], array_column($r['excluded'], 'reason'));
});

echo "\nScénarios\n";
T::test('délais observés : optimiste p25, réaliste médiane du client, pessimiste p75 + 15 j ; factures toujours « estimées »', function () use ($bal, $H, $inv) {
    $stats = pil_delay_stats([['client' => 7, 'due' => '2026-01-01', 'paid_date' => '2026-01-05'], ['client' => 7, 'due' => '2026-01-01', 'paid_date' => '2026-01-21'], ['client' => 8, 'due' => '2026-01-01', 'paid_date' => '2026-01-31']], TODAY);
    $f = pil_collect_flows(['invoices' => [$inv([])], 'expenses' => []], [], $bal, $stats, $H, TODAY)['flows'];
    // client 7 (2 factures) : p25 = 8 j, médiane = 12 j, p75 = 16 j (+ 15 j pessimiste) – ses propres délais priment sur la moyenne globale
    T::eq(['2026-03-28', '2026-04-01', '2026-04-20'], [$f['optimiste'][0]['date'], $f['realiste'][0]['date'], $f['pessimiste'][0]['date']]);
    T::eq(['estime', 'estime', 'estime'], [$f['optimiste'][0]['certainty'], $f['realiste'][0]['certainty'], $f['pessimiste'][0]['certainty']]);
});
T::test('pessimiste : facture en retard de plus de 60 jours exclue ; marge de prudence ajoutée et identifiée', function () use ($bal, $noStats, $H, $inv, $exp, $sumSrc) {
    $docs = ['invoices' => [$inv(['due' => '2025-12-01'])], 'expenses' => [$exp([])]];
    $f = pil_collect_flows($docs, [], $bal, $noStats, $H, TODAY)['flows'];
    T::eq(121000, $sumSrc($f['realiste'], 'facture'), 'réaliste : sans historique, montant entier (aucune probabilité inventée)');
    T::eq(0, $sumSrc($f['pessimiste'], 'facture'), 'pessimiste : exclue (> 60 j de retard)');
    T::eq(-3025, $sumSrc($f['pessimiste'], 'prudence'), '5 % de 605,00');
    T::eq(0, $sumSrc($f['realiste'], 'prudence'));
});
T::test('états d\'avancement : approuvé compté (optimiste, réaliste), envoyé seulement en optimiste, contesté jamais', function () use ($bal, $noStats, $H, $inv) {
    $docs = ['invoices' => [$inv(['ea' => 'approuve', 'approve_by' => '2026-03-01', 'rest' => 0, 'paid' => 0]), $inv(['id' => 2, 'ea' => 'envoye', 'approve_by' => '2026-03-20']), $inv(['id' => 3, 'ea' => 'conteste'])], 'expenses' => []];
    $f = pil_collect_flows($docs, [], $bal, $noStats, $H, TODAY)['flows'];
    T::eq([2, 1, 0], [count($f['optimiste']), count($f['realiste']), count($f['pessimiste'])]);
    T::eq('2026-04-09', $f['realiste'][0]['date'], 'approuvé : aujourd\'hui + 30 jours de délai de paiement');
});

// ===================================================================== API
echo "\nAPI trésorerie (instance de test)\n";
$admin = new Client('admin'); $admin->login('admin@test.madibu.local', 'Admin-Test-2026');
$user = new Client('user'); $user->login('user@test.madibu.local', 'Role-Test-2026');
$acc = db()->query("SELECT bank, id FROM pil_bank_accounts WHERE company_id = 1")->fetchAll(PDO::FETCH_KEY_PAIR);
$Q = '&today=2026-02-15';

T::test('réservé aux administrateurs', function () use ($user) { foreach (['forecast', 'commitments', 'receivables'] as $r) { [$c] = $user->req('GET', "pilot/$r"); T::eq(403, $c, $r); } });
T::test('soldes : dernier extrait de chaque compte avec sa date (jamais présenté comme solde du jour)', function () use ($admin, $Q) {
    [$c, $f] = $admin->req('GET', 'pilot/forecast' . $Q); T::eq(200, $c, json_encode($f));
    foreach ($f['balances']['accounts'] as $a) T::ok($a['date'] !== null && $a['age_days'] !== null, 'date et âge du solde');
    T::eq(array_sum(array_column($f['balances']['accounts'], 'balance')), $f['balances']['total']);
    T::eq($f['balances']['total'], $f['scenarios']['realiste']['horizons'][7]['start'], 'solde de départ = soldes bancaires');
});
T::test('engagements : validations, crédit avec échéancier, confirmation obligatoire pour une charge détectée', function () use ($admin, $acc, $Q) {
    [$c] = $admin->req('POST', 'pilot/commitments', ['kind' => 'credit', 'label' => '']); T::eq(400, $c, 'libellé obligatoire');
    [$c] = $admin->req('POST', 'pilot/commitments', ['kind' => 'credit', 'label' => 'X', 'next_date' => '2026-02-30']); T::eq(400, $c, 'date impossible');
    [$c, $cr] = $admin->req('POST', 'pilot/commitments', ['kind' => 'credit', 'subtype' => 'investissement', 'label' => 'Crédit camion', 'lender' => 'Banque fictive', 'account_id' => $acc['BNP Paribas Fortis'],
        'amount' => 78236, 'frequency' => 'mensuel', 'next_date' => '2026-02-27', 'end_date' => '2027-12-27', 'rate' => 4.5, 'capital_remaining' => 1500000, 'capital_asof' => '2026-01-31', 'guarantees' => 'gage sur véhicule']);
    T::eq(200, $c, json_encode($cr)); T::eq('confirme', $cr['status'], 'saisie manuelle = confirmée par l\'utilisateur');
    [, $list] = $admin->req('GET', 'pilot/commitments' . $Q);
    $x = array_values(array_filter($list, fn($l) => $l['id'] === $cr['id']))[0];
    T::ok($x['next_flows'][0]['date'] === '2026-02-27' && str_contains($x['next_flows'][0]['detail'], 'intérêts'), json_encode($x['next_flows'][0], JSON_UNESCAPED_UNICODE));
    [$c, $d] = $admin->req('POST', 'pilot/commitments', ['kind' => 'charge', 'subtype' => 'telecom', 'label' => 'Télécom (détecté)', 'amount' => 25099, 'next_date' => '2026-03-02', 'source' => 'detecte', 'status' => 'confirme', 'detect_key' => 'NOM:TELECOM FICTIF']);
    T::eq(200, $c); T::eq(['a_confirmer', null], [$d['status'], $d['confirmed_by']], 'détecté : toujours à confirmer, même si « confirme » est demandé');
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    T::ok(!str_contains(json_encode($f['scenarios'], JSON_UNESCAPED_UNICODE), 'Télécom (détecté)'), 'non confirmé : absent de la prévision');
    T::ok(str_contains(json_encode($f['excluded'], JSON_UNESCAPED_UNICODE), 'Télécom (détecté)'), 'listé comme exclu');
    $d['status'] = 'confirme'; [$c, $d2] = $admin->req('PUT', "pilot/commitments/{$d['id']}", $d); T::eq(200, $c);
    T::eq(1, $d2['confirmed_by'], 'confirmation tracée');
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    T::ok(str_contains(json_encode($f['scenarios']['realiste']['flows'], JSON_UNESCAPED_UNICODE), 'Télécom (détecté)'), 'confirmé : dans la prévision');
});
T::test('détection des charges récurrentes : seulement des propositions (rien n\'est créé)', function () use ($admin, $Q) {
    $n = (int)db()->query('SELECT COUNT(*) FROM pil_commitments')->fetchColumn();
    [$c, $l] = $admin->req('GET', 'pilot/commitments/detect' . $Q); T::eq(200, $c); T::ok(is_array($l), 'liste');
    T::eq($n, (int)db()->query('SELECT COUNT(*) FROM pil_commitments')->fetchColumn());
});
T::test('document justificatif : envoi, téléchargement par l\'administrateur, dossier fermé au web', function () use ($admin) {
    $id = (int)db()->query("SELECT id FROM pil_commitments WHERE label = 'Crédit camion'")->fetchColumn();
    $tmp = tempnam(sys_get_temp_dir(), 'pdf'); file_put_contents($tmp, "%PDF-1.4\ncontrat fictif\n");
    [$c, $r] = $admin->req('POST', "pilot/commitments/$id/doc", null, ['multipart' => ['file' => new CURLFile($tmp, 'application/pdf', 'contrat.pdf')]]); T::eq(200, $c, json_encode($r));
    T::eq('contrat.pdf', $r['docs'][0]['name']); T::ok(!isset($r['docs'][0]['stored']), 'chemin interne jamais envoyé');
    [$c, , $raw] = $admin->req('GET', "pilot/commitments/$id/doc/0"); T::eq(200, $c); T::ok(str_contains($raw, 'contrat fictif'), 'contenu');
    $stored = json_decode((string)db()->query("SELECT docs FROM pil_commitments WHERE id = $id")->fetchColumn(), true)[0]['stored'];
    [$c] = $admin->req('GET', '', null, ['raw' => 'uploads/' . $stored]); T::eq(403, $c);
    [$c] = $admin->req('POST', "pilot/commitments/$id/doc", null, ['multipart' => ['file' => new CURLFile($tmp, 'text/plain', 'x.php')]]); T::eq(400, $c, '.php refusé');
});
T::test('prévision : 3 scénarios × 7/30/90 jours, cohérence solde final = départ + entrées + sorties', function () use ($admin, $Q) {
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    foreach (['optimiste', 'realiste', 'pessimiste'] as $s) foreach ([7, 30, 90] as $h) {
        $x = $f['scenarios'][$s]['horizons'][$h];
        T::eq($x['end'], $x['start'] + $x['in_confirmed'] + $x['in_estimated'] + $x['out_confirmed'] + $x['out_estimated'], "$s $h j");
        T::ok($x['min'] <= $x['end'] && $x['min'] <= $x['start'], "minimum $s $h");
    }
    T::ok($f['scenarios']['optimiste']['horizons'][90]['end'] >= $f['scenarios']['pessimiste']['horizons'][90]['end'], 'optimiste ≥ pessimiste');
    T::eq(91, count($f['scenarios']['realiste']['series']));
    T::ok(is_int($f['reliability']['score']) && count($f['reliability']['factors']) === 5, 'fiabilité avec 5 critères');
});
T::test('facture rapprochée et payée par la banque : plus aucun encaissement prévu (pas de double comptage avec le solde)', function () use ($admin, $Q) {
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    T::ok(!str_contains(json_encode($f['scenarios'], JSON_UNESCAPED_UNICODE), 'FAC-TEST-RAP'), 'facture soldée par le rapprochement absente');
});
T::test('facture contestée (marque Pilotage) : exclue, puis réintégrée quand la marque est retirée', function () use ($admin, $Q) {
    [, $cli] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client Contesté SA']]);
    [, $i] = $admin->req('POST', 'items/invoice', ['data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => '2026-02-01', 'due' => '2026-03-01', 'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => 777, 'vat' => 0]]]]);
    $has = function () use ($admin, $Q) { [, $f] = $admin->req('GET', 'pilot/forecast' . $Q); return str_contains(json_encode($f['scenarios']['realiste']['flows'], JSON_UNESCAPED_UNICODE), 'Client Contesté SA'); };
    T::ok($has(), 'comptée');
    [$c] = $admin->req('PUT', "pilot/flags/{$i['id']}", ['flag' => 'conteste', 'note' => 'malfaçon']); T::eq(200, $c);
    T::ok(!$has(), 'exclue');
    [, $r] = $admin->req('GET', 'pilot/receivables' . $Q);
    T::eq('conteste', array_values(array_filter($r['invoices'], fn($x) => $x['id'] === $i['id']))[0]['state']);
    [$c] = $admin->req('PUT', "pilot/flags/{$i['id']}", ['flag' => '']); T::eq(200, $c); T::ok($has(), 'réintégrée');
    [, $after] = $admin->req('GET', "items/invoice/{$i['id']}"); T::eq(1, $after['version'], 'la facture BatiPro n\'est pas modifiée');
});
T::test('hypothèses modifiables, bornées, et appliquées', function () use ($admin, $Q) {
    [$c, $h] = $admin->req('PUT', 'pilot/hypotheses', ['pessimiste' => ['delay' => 'p75', 'extraDays' => 999, 'prudencePct' => 10, 'useProbability' => true, 'excludeOverdueAfter' => 60]]); T::eq(200, $c);
    T::eq([180, 10.0], [$h['pessimiste']['extraDays'], (float)$h['pessimiste']['prudencePct']], 'bornes');
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    T::ok(str_contains(json_encode($f['scenarios']['pessimiste']['flows'], JSON_UNESCAPED_UNICODE), 'Marge de prudence +10 %'), 'prudence 10 % appliquée');
    $admin->req('PUT', 'pilot/hypotheses', []);
});
T::test('alertes : chacune avec problème, montant, date, impact, risque et action', function () use ($admin, $Q) {
    [, $f] = $admin->req('GET', 'pilot/forecast' . $Q);
    T::ok(count($f['alerts']) > 0, 'au moins une alerte');
    foreach ($f['alerts'] as $a) { foreach (['problem', 'amount', 'date', 'impact', 'risk', 'action'] as $k) T::ok(array_key_exists($k, $a), "champ $k"); T::ok(in_array($a['risk'], ['faible', 'moyen', 'eleve'], true), 'niveau'); }
    [, $g] = $admin->req('GET', 'pilot/forecast&today=2026-02-22');
    T::ok(in_array('echeance_credit', array_column($g['alerts'], 'code'), true), 'échéance du crédit (27/02) dans les 7 jours');
    T::ok(!in_array('echeance_credit', array_column($f['alerts'], 'code'), true), 'pas d\'alerte 12 jours avant');
});
T::test('créances et dettes : états distincts (échu, non échu, payé, partiel, contesté, en attente d\'approbation ; achats engagés / payés)', function () use ($admin, $Q) {
    [$c, $r] = $admin->req('GET', 'pilot/receivables' . $Q); T::eq(200, $c);
    $states = array_unique(array_column($r['invoices'], 'state'));
    T::ok(in_array('paye', $states, true) && (in_array('echu', $states, true) || in_array('non_echu', $states, true)), json_encode($states));
    T::ok(array_intersect(['engage', 'echu', 'paye', 'partiel', 'a_valider'], array_column($r['expenses'], 'state')) !== [], 'états des achats');
});

exit(T::done());
