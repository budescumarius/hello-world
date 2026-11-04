<?php
// PILOTAGE – « Où est passé l'argent ? » : scénario fictif entièrement maîtrisé (année 2025, compte dédié), contrôlé au centime.
// 5.000 € en banque ; 100.000 € encaissés en janvier ; puis matériaux 30.000 (achat rapproché, chantier), salaires 20.000,
// transfert vers un autre compte 50.000 (ne compte pas), sous-traitant 10.000 (achat non rapproché, même montant → « probable »).
declare(strict_types=1);
require __DIR__ . '/harness.php';

$admin = new Client('admin'); $admin->login('admin@test.madibu.local', 'Admin-Test-2026');
$user = new Client('user'); $user->login('user@test.madibu.local', 'Role-Test-2026');
$pdo = db(); $cid = 1; $uid = (int)$pdo->query("SELECT id FROM users WHERE email = 'admin@test.madibu.local'")->fetchColumn();
$admin->req('GET', 'pilot/accounts'); // tables du module
$pdo->exec('UPDATE pil_bank_accounts SET active = 0 WHERE company_id = 1'); // seul le compte du scénario compte
$pdo->exec("INSERT INTO pil_bank_accounts (company_id, bank, iban, label, currency, active, created_at) VALUES (1, 'Banque Fictive', 'BE00TRAIL0000001', 'Scénario', 'EUR', 1, NOW()), (1, 'Banque Fictive', 'BE00TRAIL0000002', 'Épargne', 'EUR', 0, NOW())");
$acc = (int)$pdo->query("SELECT id FROM pil_bank_accounts WHERE iban = 'BE00TRAIL0000001'")->fetchColumn(); $acc2 = (int)$pdo->query("SELECT id FROM pil_bank_accounts WHERE iban = 'BE00TRAIL0000002'")->fetchColumn();
$pdo->prepare("INSERT INTO pil_bank_imports (company_id, account_id, filename, sha256, format, period_from, period_to, opening, closing, status, created_at) VALUES (1, ?, 'scenario.cod', ?, 'coda', '2025-01-01', '2025-04-30', 500000, 0, 'importe', NOW())")->execute([$acc, hash('sha256', 'trail')]);
$imp = (int)$pdo->lastInsertId();
[, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Chantier Trail Fictif', 'status' => 'encours']]);
[, $sup] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'fournisseur', 'company' => 'Négoce Trail Fictif']]);
[, $st] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'soustraitant', 'company' => 'Plafonnage Trail Fictif']]);
[, $e1] = $admin->req('POST', 'items/expense', ['project_id' => $p['id'], 'data' => ['supplierId' => $sup['id'], 'ref' => 'MAT-1', 'date' => '2025-01-14', 'amount' => 30000, 'vat' => 0, 'category' => 'mat']]);
[, $e2] = $admin->req('POST', 'items/expense', ['project_id' => $p['id'], 'data' => ['supplierId' => $st['id'], 'ref' => 'ST-9', 'date' => '2025-02-25', 'amount' => 10000, 'vat' => 0, 'category' => 'st']]);
$tx = $pdo->prepare("INSERT INTO pil_bank_tx (company_id, account_id, import_id, booking_date, amount, cp_name, communication, fp, category, status, match_type, match_id, transfer_account_id) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'valide', ?, ?, ?)");
foreach ([['2025-01-10', 10000000, 'CLIENT DUPONT FICTIF', 'Acompte chantier', 'encaissement_client', null, null, null], ['2025-01-15', -3000000, 'NEGOCE TRAIL FICTIF', 'MAT-1', 'materiaux', 'expense', $e1['id'], null],
    ['2025-02-01', -2000000, 'SECRETARIAT SOCIAL', 'Salaires janvier', 'salaires', null, null, null], ['2025-02-10', -5000000, 'MADIBU EPARGNE', 'Vers épargne', 'transfert_interne', null, null, $acc2],
    ['2025-03-01', -1000000, 'PLAFONNAGE TRAIL FICTIF', 'Facture ST-9', 'sous_traitance', null, null, null]] as $i => $r)
    $tx->execute([$acc, $imp, $r[0], $r[1], $r[2], $r[3], hash('sha256', "trail$i"), $r[4], $r[5], $r[6], $r[7]]);
// un e-mail du sous-traitant (boîte de l'administrateur) quelques jours avant le paiement
$pdo->prepare("INSERT INTO pil_mail_accounts (company_id, user_id, kind, email, name, token_enc, expires_at, status, created_at) VALUES (1, ?, 'graph', 'trail@madibu-fictif.be', 'Trail', NULL, 0, 'ok', NOW())")->execute([$uid]);
$ma = (int)$pdo->lastInsertId();
$pdo->prepare("INSERT INTO pil_mail_msgs (company_id, account_id, graph_id, folder, from_email, from_name, to_json, subject, at, preview, body, created_at) VALUES (1, ?, 'TRAIL-1', 'in', 'compta@plafonnage-fictif.be', 'Plafonnage Trail Fictif', '[]', 'Facture ST-9 – travaux de plafonnage', '2025-02-26 10:00:00', 'Veuillez trouver la facture', 'Veuillez trouver la facture ST-9 de 10.000,00 €.', NOW())")->execute([$ma]);

echo "Où est passé l'argent ?\n";
$get = fn(array $q) => $admin->req('GET', 'pilot/trail&' . http_build_query($q));
T::test('règle prudente : l\'argent déjà en banque part d\'abord ; transfert entre ses comptes ignoré ; reste en banque', function () use ($get) {
    [$c, $r] = $get(['from' => '2025-01-01', 'to' => '2025-01-31', 'until' => '2025-04-30', 'mode' => 'fifo']); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    T::eq(500000, $r['solde_avant']); T::eq(10000000, $r['encaisse']);
    T::eq(5500000, $r['depense'], 'matériaux 25.000 (5.000 venaient d\'avant) + salaires 20.000 + sous-traitant 10.000');
    T::eq(4500000, $r['reste'], 'reste 45.000 en banque (le transfert vers l\'épargne n\'est pas une dépense)');
    $cat = array_column($r['par_categorie'], 'part', 'label');
    T::eq(2500000, $cat['Matériaux et fournitures']); T::eq(2000000, $cat['Salaires et rémunérations']); T::eq(1000000, $cat['Sous-traitance']); T::ok(!isset($cat['Transfert interne']), 'pas de transfert interne');
});
T::test('règle directe : les encaissements de la période paient d\'abord', function () use ($get) {
    [, $r] = $get(['from' => '2025-01-01', 'to' => '2025-01-31', 'until' => '2025-04-30', 'mode' => 'direct']);
    T::eq(6000000, $r['depense']); T::eq(4000000, $r['reste']);
});
T::test('documents BatiPro : achat rapproché (chantier) ; achat de même montant non rapproché = « probable »', function () use ($get, $p) {
    [, $r] = $get(['from' => '2025-01-01', 'to' => '2025-01-31', 'until' => '2025-04-30']);
    $by = []; foreach ($r['depenses'] as $x) $by[$x['category']] = $x;
    T::eq('MAT-1', $by['materiaux']['doc']['ref']); T::eq(true, $by['materiaux']['doc']['sure']); T::eq((int)$p['id'], $by['materiaux']['project_id']);
    T::eq('ST-9', $by['sous_traitance']['doc']['ref']); T::eq(false, $by['sous_traitance']['doc']['sure'], 'probable');
    $proj = array_column($r['par_chantier'], 'part', 'label'); T::eq(3500000, $proj['Chantier Trail Fictif'], 'matériaux 25.000 + sous-traitant 10.000');
});
T::test('e-mails liés : l\'e-mail du sous-traitant retrouvé (vos boîtes uniquement)', function () use ($get, $user) {
    [, $r] = $get(['from' => '2025-01-01', 'to' => '2025-01-31', 'until' => '2025-04-30']);
    $st = array_values(array_filter($r['depenses'], fn($x) => $x['category'] === 'sous_traitance'))[0];
    T::eq('Facture ST-9 – travaux de plafonnage', $st['mails'][0]['subject'] ?? null);
    [$c] = $user->req('GET', 'pilot/trail&from=2025-01-01&to=2025-01-31'); T::ok(in_array($c, [403], true), "rôle sans trésorerie : $c");
});
T::test('filtre (client) et avertissements (période non couverte par les extraits)', function () use ($get) {
    [, $r] = $get(['from' => '2025-01-01', 'to' => '2025-01-31', 'until' => '2025-06-30', 'q' => 'autre client']); T::eq(0, $r['encaisse']); T::eq(0, $r['depense']);
    T::ok((bool)array_filter($r['avertissements'], fn($w) => str_contains($w, 'pas entièrement couverte')), json_encode($r['avertissements'], JSON_UNESCAPED_UNICODE));
});
// remise en état
$pdo->exec("DELETE FROM pil_mail_msgs WHERE account_id = $ma"); $pdo->exec("DELETE FROM pil_mail_accounts WHERE id = $ma");
$pdo->exec("DELETE FROM pil_bank_tx WHERE import_id = $imp"); $pdo->exec("DELETE FROM pil_bank_imports WHERE id = $imp"); $pdo->exec("DELETE FROM pil_bank_accounts WHERE id IN ($acc, $acc2)");
$pdo->exec('UPDATE pil_bank_accounts SET active = 1 WHERE company_id = 1');
exit(T::done());
