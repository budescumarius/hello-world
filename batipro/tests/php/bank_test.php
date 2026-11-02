<?php
// PILOTAGE étape 2 : import des extraits bancaires – avec des extraits 100 % FICTIFS (tests/fixtures/bank, voir make-bank-fixtures.mjs).
// 1. lecteurs CODA / PDF Belfius / PDF BNP Paribas Fortis (sans serveur)
// 2. API sur l'instance de test : droits, contrôles, doublons, continuité, transferts internes, rapprochement, historique.
declare(strict_types=1);
require __DIR__ . '/harness.php';
require __DIR__ . '/../../pilotage/bank_parse.php';

const FX = __DIR__ . '/../fixtures/bank/';
$X = json_decode(file_get_contents(FX . 'expected.json'), true);
$layout = fn(string $f) => json_decode(file_get_contents(FX . $f), true);
$sum = fn(array $s) => array_sum(array_column($s['transactions'], 'amount'));

echo "Lecture des extraits (fichiers fictifs)\n";
T::test('montants belges : formats Belfius, BNP et CODA ; texte illisible = null (jamais deviné)', function () {
    foreach (['+17.095,92' => 1709592, '-200.691,68' => -20069168, '- 267,90' => -26790, '10.600,00+' => 1060000, '24,20 -' => -2420, '155,32 +' => 15532, '0,05' => 5] as $s => $v) T::eq($v, pil_parse_amount($s), $s);
    foreach (['12,3', 'abc', '1.234', '+1,00-', ''] as $s) T::eq(null, pil_parse_amount($s), "« $s »");
});
T::test('IBAN et communication structurée : clés de contrôle vérifiées', function () use ($X) {
    foreach ($X['ACC'] as $i) T::ok(pil_iban_valid($i), "IBAN $i valide");
    T::ok(!pil_iban_valid('BE00671000010175'), 'clé IBAN fausse refusée');
    T::eq($X['COMM']['invoice'], pil_structured($X['COMM']['invoice']));
    T::eq(null, pil_structured('+++000/0012/02696+++'), 'clé modulo 97 fausse');
});
T::test('CODA Europabank : soldes, 5 mouvements, accents Windows-1252, contrepartie et communication structurée', function () use ($X, $sum) {
    $s = pil_parse_statement('x.cod', file_get_contents(FX . 'europabank-fictif-2026-01.cod'), null);
    T::eq(1, count($s)); $s = $s[0];
    T::eq(['Europabank', $X['ACC']['europabank'], 1, '2025-12-31', '2026-01-31'], [$s['bank'], $s['iban'], $s['number'], $s['opening']['date'], $s['closing']['date']]);
    T::eq([$X['europabank']['jan']['opening'], $X['europabank']['jan']['closing']], [$s['opening']['amount'], $s['closing']['amount']]);
    T::eq($X['europabank']['jan']['n'], count($s['transactions']));
    T::eq($s['closing']['amount'], $s['opening']['amount'] + $sum($s), 'solde initial + mouvements = solde final');
    T::ok(str_contains($s['transactions'][1]['communication'], 'débit'), 'é lu correctement : ' . $s['transactions'][1]['communication']);
    T::eq([$X['CP']['client'], 'CLIENT FICTIF SA', $X['COMM']['invoice']], [$s['transactions'][4]['counterparty_iban'], $s['transactions'][4]['counterparty_name'], $s['transactions'][4]['structured']]);
    T::eq([], $s['warnings']);
    // même fichier ré-enregistré en UTF-8 (éditeur de texte) : résultat identique
    $u = pil_parse_statement('x.cod', mb_convert_encoding(file_get_contents(FX . 'europabank-fictif-2026-01.cod'), 'UTF-8', 'Windows-1252'), null)[0];
    T::eq(array_column($s['transactions'], 'amount'), array_column($u['transactions'], 'amount'), 'version UTF-8');
    T::eq($s['transactions'][1]['communication'], $u['transactions'][1]['communication']);
});
T::test('CODA altéré (un montant changé) : écart de solde et totaux de contrôle signalés', function () use ($sum) {
    $s = pil_parse_statement('x.cod', file_get_contents(FX . 'europabank-fictif-altere.cod'), null)[0];
    T::eq(-100, $s['opening']['amount'] + $sum($s) - $s['closing']['amount']);
    T::ok(in_array('Totaux de contrôle CODA différents des mouvements lus', $s['warnings'], true), 'avertissement CODA');
});
T::test('PDF Belfius : montant en deux morceaux (« - » « 267,90 »), contreparties, annexe ignorée', function () use ($X, $layout, $sum) {
    $s = pil_parse_statement('b.pdf', null, $layout('belfius-fictif.layout.json'))[0];
    T::eq(['Belfius', $X['ACC']['belfius'], 12], [$s['bank'], $s['iban'], $s['number']]);
    T::eq([$X['belfius']['opening'], $X['belfius']['closing'], $X['belfius']['n']], [$s['opening']['amount'], $s['closing']['amount'], count($s['transactions'])]);
    T::eq($s['closing']['amount'], $s['opening']['amount'] + $sum($s));
    T::eq([12, '2026-01-06', '2026-01-05', 242000, $X['CP']['client'], $X['COMM']['invoice']], [$s['transactions'][0]['seq'], $s['transactions'][0]['date'], $s['transactions'][0]['value_date'], $s['transactions'][0]['amount'], $s['transactions'][0]['counterparty_iban'], $s['transactions'][0]['structured']]);
    T::eq(-150000, $s['transactions'][1]['amount'], 'montant « - » + « 1.500,00 »');
    T::eq($X['ACC']['europabank'], $s['transactions'][2]['counterparty_iban'], 'virement vers notre compte Europabank');
    T::ok(!str_contains(json_encode($s['transactions'], JSON_UNESCAPED_UNICODE), 'MONTANT EN INTERETS'), 'annexe non mélangée aux opérations');
});
T::test('PDF BNP Paribas Fortis : colonnes, ordre chronologique, solde répété en fin d\'extrait, avis de débit ignoré', function () use ($X, $layout, $sum) {
    $s = pil_parse_statement('n.pdf', null, $layout('bnp-fictif.layout.json'))[0];
    T::eq(['BNP Paribas Fortis', $X['ACC']['bnp'], 3], [$s['bank'], $s['iban'], $s['number']]);
    T::eq([$X['bnp']['opening'], $X['bnp']['closing'], $X['bnp']['n']], [$s['opening']['amount'], $s['closing']['amount'], count($s['transactions'])]);
    T::eq($s['closing']['amount'], $s['opening']['amount'] + $sum($s));
    T::eq([26, 27, 28, 29, 30, 31], array_column($s['transactions'], 'seq'), 'remis dans l\'ordre chronologique');
    T::eq('2026-01-01', $s['transactions'][0]['value_date'], 'date valeur « 01-01 » complétée avec l\'année');
    $cl = $s['transactions'][3];
    T::eq([1060000, $X['CP']['client'], 'CLIENT FICTIF SA', 'Solde chantier rue du Test'], [$cl['amount'], $cl['counterparty_iban'], $cl['counterparty_name'], $cl['communication']]);
    T::eq('QUINCAILLERIE FICTIVE BRUXELLES', $s['transactions'][5]['counterparty_name'], 'commerçant d\'un paiement par carte');
    T::eq([], $s['warnings']);
});
T::test('format inconnu refusé avec un message clair', function () {
    try { pil_parse_statement('x.pdf', null, [['w' => 595, 'rows' => [['y' => 800, 'p' => [[40, 'Autre Banque SA']]]]]]); T::ok(false, 'exception attendue'); }
    catch (RuntimeException $e) { T::ok(str_contains($e->getMessage(), 'non reconnu'), $e->getMessage()); }
});

// ===================================================================== API
echo "\nAPI du module Pilotage (instance de test)\n";
$admin = new Client('admin'); $admin->login('admin@test.madibu.local', 'Admin-Test-2026');
$user = new Client('user'); $user->login('user@test.madibu.local', 'Role-Test-2026');
$file = function (string $f, ?string $layoutFile = null, array $extra = []) use ($layout) {
    return ['name' => basename($f), 'content' => base64_encode(file_get_contents(FX . $f)), 'layout' => $layoutFile ? $layout($layoutFile) : null] + $extra;
};
$acc = [];

T::test('module éteint par défaut : routes refusées (403) ; activation réservée à l\'administrateur', function () use ($admin, $user) {
    [$c] = $admin->req('GET', 'pilot/dashboard'); T::eq(403, $c);
    [$c] = $user->req('POST', 'pilot/enable', ['enabled' => true]); T::eq(403, $c, 'user ne peut pas activer');
    [$c] = $admin->req('POST', 'pilot/enable', ['enabled' => true]); T::eq(200, $c);
    [$c] = $user->req('GET', 'pilot/dashboard'); T::eq(403, $c, 'module réservé aux administrateurs');
    [$c] = $admin->req('GET', 'pilot/dashboard'); T::eq(200, $c);
});
T::test('comptes bancaires : IBAN vérifié, banque déduite, doublon refusé', function () use ($admin, $X, &$acc) {
    [$c] = $admin->req('POST', 'pilot/accounts', ['iban' => 'BE00 6710 0001 0175']); T::eq(400, $c, 'IBAN invalide');
    foreach (['europabank' => 'Europabank', 'belfius' => 'Belfius', 'bnp' => 'BNP Paribas Fortis'] as $k => $bank) {
        [$c, $l] = $admin->req('POST', 'pilot/accounts', ['iban' => trim(chunk_split($X['ACC'][$k], 4, ' ')), 'label' => 'Compte courant']);
        T::eq(200, $c, json_encode($l));
        $a = array_values(array_filter($l, fn($a) => $a['iban'] === $X['ACC'][$k]))[0];
        T::eq($bank, $a['bank'], 'banque déduite de l\'IBAN'); $acc[$k] = $a['id'];
    }
    [$c] = $admin->req('POST', 'pilot/accounts', ['iban' => $X['ACC']['bnp']]); T::eq(400, $c, 'compte déjà existant');
});
T::test('aperçu CODA : contrôles OK, classement proposé, rien d\'enregistré avant confirmation', function () use ($admin, $file) {
    [$c, $p] = $admin->req('POST', 'pilot/preview', $file('europabank-fictif-2026-01.cod'));
    T::eq(200, $c); T::eq([], $p['errors']); $s = $p['statements'][0];
    T::eq(0, $s['balance_gap']);
    T::eq(['frais_bancaires', 'frais_bancaires', 'materiaux', 'transfert_interne', 'encaissement_client'], array_column($s['transactions'], 'category'));
    T::eq(0, (int)db()->query('SELECT COUNT(*) FROM pil_bank_tx')->fetchColumn(), 'aucun mouvement enregistré par l\'aperçu');
});
T::test('import CODA ; le même fichier une seconde fois est refusé', function () use ($admin, $file) {
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('europabank-fictif-2026-01.cod')); T::eq(200, $c, json_encode($r['errors'] ?? $r));
    T::eq(5, (int)db()->query("SELECT COUNT(*) FROM pil_bank_tx WHERE status = 'a_verifier'")->fetchColumn(), 'tout est « à vérifier »');
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('europabank-fictif-2026-01.cod')); T::eq(422, $c);
    T::ok(str_contains(implode(' ', $r['errors']), 'déjà été importé'), implode(' ', $r['errors']));
});
T::test('extrait dont les soldes ne concordent pas : import bloqué', function () use ($admin, $file) {
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('europabank-fictif-altere.cod')); T::eq(422, $c);
    T::ok(str_contains(implode(' ', $r['errors']), 'Contrôle des soldes'), implode(' ', $r['errors']));
});
T::test('extrait manquant : rupture signalée, puis comblée par l\'import de l\'extrait manquant', function () use ($admin, $file, $acc) {
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('europabank-fictif-2026-03.cod')); T::eq(200, $c);
    T::ok(str_contains(implode(' ', $r['statements'][0]['warnings']), 'extrait manque'), 'avertissement de continuité');
    [, $d] = $admin->req('GET', 'pilot/dashboard');
    $e = array_values(array_filter($d['accounts'], fn($a) => $a['id'] === $acc['europabank']))[0];
    T::eq(1, count($e['breaks'])); T::ok($e['computed'] !== $e['balance'], 'solde recalculé ≠ solde banque tant qu\'il manque février');
    [$c] = $admin->req('POST', 'pilot/import', $file('europabank-fictif-2026-02.cod')); T::eq(200, $c);
    [, $d] = $admin->req('GET', 'pilot/dashboard');
    $e = array_values(array_filter($d['accounts'], fn($a) => $a['id'] === $acc['europabank']))[0];
    T::eq(0, count($e['breaks'])); T::eq($e['balance'], $e['computed'], 'solde recalculé = solde banque');
});
T::test('PDF Belfius : virement vers Europabank reconnu comme transfert interne et apparié des deux côtés', function () use ($admin, $file, $acc) {
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('belfius-fictif.pdf', 'belfius-fictif.layout.json')); T::eq(200, $c, json_encode($r['errors'] ?? null));
    $t = db()->query("SELECT * FROM pil_bank_tx WHERE account_id = {$acc['belfius']} AND amount = -100000")->fetch();
    T::eq('transfert_interne', $t['category']); T::eq($acc['europabank'], (int)$t['transfer_account_id']);
    $o = db()->query('SELECT * FROM pil_bank_tx WHERE id = ' . (int)$t['transfer_tx_id'])->fetch();
    T::eq([$acc['europabank'], 100000, (int)$t['id']], [(int)$o['account_id'], (int)$o['amount'], (int)$o['transfer_tx_id']]);
});
T::test('PDF sans sa mise en page : refusé ; mise en page d\'un autre compte : refusée si un compte est imposé', function () use ($admin, $file, $acc) {
    [$c, $r] = $admin->req('POST', 'pilot/preview', $file('bnp-fictif.pdf')); T::ok($r['errors'], 'erreur attendue');
    [$c, $r] = $admin->req('POST', 'pilot/preview', $file('bnp-fictif.pdf', 'bnp-fictif.layout.json', ['account' => $acc['belfius']]));
    T::ok(str_contains(implode(' ', $r['errors']), 'pas le compte choisi'), implode(' ', $r['errors']));
});
T::test('PDF BNP : import ; transfert vers Belfius sans contrepartie importée = « non apparié »', function () use ($admin, $file) {
    [$c, $r] = $admin->req('POST', 'pilot/import', $file('bnp-fictif.pdf', 'bnp-fictif.layout.json')); T::eq(200, $c, json_encode($r['errors'] ?? null));
    [, $d] = $admin->req('GET', 'pilot/dashboard'); T::eq(1, $d['unpaired_transfers']);
});
T::test('même extrait sous un autre fichier (autre format/export) : toutes les opérations reconnues comme doublons, import bloqué', function () use ($admin, $layout) {
    $bytes = file_get_contents(FX . 'bnp-fictif.pdf') . "\n% export n°2\n";
    [$c, $r] = $admin->req('POST', 'pilot/import', ['name' => 'bnp-copie.pdf', 'content' => base64_encode($bytes), 'layout' => $layout('bnp-fictif.layout.json')]);
    T::eq(422, $c); T::ok(str_contains(implode(' ', $r['errors']), 'déjà enregistrées'), implode(' ', $r['errors']));
});
T::test('correction : catégorie, nom, note historisés ; le brut de la banque reste intact ; validation d\'un « à classer » refusée', function () use ($admin, $acc) {
    $t = db()->query("SELECT * FROM pil_bank_tx WHERE account_id = {$acc['bnp']} AND amount = -78236")->fetch();
    [$c, $u] = $admin->req('PUT', "pilot/tx/{$t['id']}", ['category' => 'credit', 'name_fix' => 'Banque – prêt camionnette', 'note' => 'mensualité', 'status' => 'valide']);
    T::eq(200, $c, json_encode($u));
    T::eq(['credit', 'manuel', 'valide', 'Banque – prêt camionnette'], [$u['category'], $u['cat_source'], $u['status'], $u['name_fix']]);
    T::ok(count($u['history']) >= 3, 'historique des corrections');
    $after = db()->query("SELECT raw, amount, cp_name, communication FROM pil_bank_tx WHERE id = {$t['id']}")->fetch();
    T::eq([$t['raw'], $t['amount'], $t['cp_name'], $t['communication']], [$after['raw'], $after['amount'], $after['cp_name'], $after['communication']], 'données de la banque inchangées');
    $x = db()->query("SELECT id FROM pil_bank_tx WHERE category = 'a_classer' LIMIT 1")->fetchColumn();
    if ($x) { [$c] = $admin->req('PUT', "pilot/tx/$x", ['status' => 'valide']); T::eq(400, $c); }
    [$c] = $admin->req('PUT', "pilot/tx/{$t['id']}", ['category' => 'transfert_interne']); T::eq(400, $c, 'transfert interne sans compte opposé refusé');
});
T::test('validation groupée : les refus sont comptés, pas d\'arrêt au premier', function () use ($admin) {
    $ids = array_map('intval', db()->query('SELECT id FROM pil_bank_tx ORDER BY id LIMIT 8')->fetchAll(PDO::FETCH_COLUMN));
    [$c, $r] = $admin->req('POST', 'pilot/tx/bulk', ['ids' => $ids, 'set' => ['status' => 'valide']]);
    T::eq(200, $c); T::eq(count($ids), $r['done'] + array_sum($r['refused']));
});
T::test('rapprochement : facture trouvée par sa communication structurée (sûr), achat par communication + IBAN ; BatiPro non modifié', function () use ($admin, $X, $acc) {
    [, $cli] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client Fictif SA', 'iban' => $X['CP']['client']]]);
    [, $inv] = $admin->req('POST', 'items/invoice', ['data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => '2026-01-10', 'due' => '2026-02-10', 'communication' => preg_replace('/\D/', '', $X['COMM']['invoice']),
        'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => 2000, 'vat' => 21]]]]);
    db()->exec("UPDATE items SET number = 'FAC-TEST-RAP' WHERE id = " . (int)$inv['id']); $inv['number'] = 'FAC-TEST-RAP';
    [, $sup] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'fournisseur', 'company' => 'Fournisseur Fictif SRL', 'iban' => $X['CP']['fournisseur']]]);
    [, $exp] = $admin->req('POST', 'items/expense', ['data' => ['supplierId' => $sup['id'], 'date' => '2026-02-01', 'amount' => 500, 'vat' => 21, 'communication' => preg_replace('/\D/', '', $X['COMM']['expense']), 'structured' => true, 'iban' => $X['CP']['fournisseur']]]);
    $t = db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['europabank']} AND amount = 242000")->fetchColumn();
    [$c, $s] = $admin->req('GET', "pilot/tx/$t/suggest"); T::eq(200, $c);
    T::eq(['invoice', $inv['id'], 'sûr', $inv['number']], [$s[0]['type'], $s[0]['id'], $s[0]['level'], $s[0]['ref']], json_encode($s, JSON_UNESCAPED_UNICODE));
    $e = db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['europabank']} AND amount = -60500")->fetchColumn();
    [, $s2] = $admin->req('GET', "pilot/tx/$e/suggest"); T::eq(['expense', $exp['id']], [$s2[0]['type'] ?? null, $s2[0]['id'] ?? null], json_encode($s2, JSON_UNESCAPED_UNICODE));
    T::eq(true, $s[0]['can_pay'], 'paiement possible');
    [$c, $u] = $admin->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id']]]); T::eq(200, $c);
    T::eq(['invoice', $inv['id'], 0], [$u['match_type'], $u['match_id'], $u['match_paid']]);
    [, $after] = $admin->req('GET', "items/invoice/{$inv['id']}");
    T::eq([$inv['version'], []], [$after['version'], $after['data']['payments'] ?? []], '« rapprocher seulement » : la facture n\'est pas modifiée');
    $GLOBALS['RAP'] = ['inv' => $inv, 'exp' => $exp, 't' => (int)$t, 'e' => (int)$e, 'cli' => $cli['id']];
});
T::test('rapprocher et enregistrer le paiement : paiement ajouté à la facture (montant et date de la banque), une seule fois ; retiré avec le rapprochement', function () use ($admin) {
    ['inv' => $inv, 't' => $t] = $GLOBALS['RAP'];
    [$c, $u] = $admin->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]); T::eq(200, $c, json_encode($u, JSON_UNESCAPED_UNICODE));
    T::eq(1, $u['match_paid']);
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}");
    T::eq(1, count($f['data']['payments'])); $p = $f['data']['payments'][0];
    T::eq([2420, '2026-01-25', 'Virement', $t], [$p['amount'], $p['date'], $p['method'], $p['bankTx']]);
    T::ok($f['version'] > $inv['version'], 'version de la facture augmentée (pas de conflit silencieux avec un autre utilisateur)');
    [$c] = $admin->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]); T::eq(200, $c);
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq(1, count($f['data']['payments']), 'pas de double paiement');
    T::ok((int)db()->query("SELECT COUNT(*) FROM activity WHERE type = 'invoice' AND item_id = {$inv['id']} AND label LIKE 'Paiement%rapprochement%'")->fetchColumn() >= 1, 'journal d\'activité');
    [$c, $u] = $admin->req('PUT', "pilot/tx/$t", ['match' => null]); T::eq(200, $c); T::eq(0, $u['match_paid']);
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq([], $f['data']['payments'], 'paiement retiré avec le rapprochement');
    [$c] = $admin->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]); T::eq(200, $c);
});
T::test('paiement refusé s\'il dépasse le reste à payer (rien n\'est enregistré) ; sens entrée/sortie vérifié', function () use ($admin, $acc) {
    ['inv' => $inv, 'e' => $e] = $GLOBALS['RAP'];
    $b = (int)db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['belfius']} AND amount = 242000")->fetchColumn();
    [$c, $r] = $admin->req('PUT', "pilot/tx/$b", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]);
    T::eq(400, $c); T::ok(str_contains($r['error'], 'dépasse le reste'), $r['error']);
    T::eq(null, db()->query("SELECT match_id FROM pil_bank_tx WHERE id = $b")->fetchColumn(), 'rapprochement annulé lui aussi (tout ou rien)');
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq(1, count($f['data']['payments']));
    [$c] = $admin->req('PUT', "pilot/tx/$e", ['match' => ['type' => 'invoice', 'id' => $inv['id']]]); T::eq(400, $c, 'une sortie ne se rapproche pas d\'une facture');
});
T::test('achat : paiement ajouté, « payé » et date de paiement mis à jour, historique de l\'achat ; retiré si le rapprochement est retiré', function () use ($admin) {
    ['exp' => $exp, 'e' => $e] = $GLOBALS['RAP'];
    [$c, $u] = $admin->req('PUT', "pilot/tx/$e", ['match' => ['type' => 'expense', 'id' => $exp['id'], 'pay' => true]]); T::eq(200, $c, json_encode($u, JSON_UNESCAPED_UNICODE));
    [, $x] = $admin->req('GET', "items/expense/{$exp['id']}");
    T::eq([605, true, '2026-02-10'], [$x['data']['payments'][0]['amount'], $x['data']['paid'], $x['data']['paidDate']]);
    T::ok(str_contains(end($x['data']['history'])['txt'], 'extrait bancaire'), 'historique de l\'achat');
    [$c] = $admin->req('PUT', "pilot/tx/$e", ['match' => null]); T::eq(200, $c);
    [, $x] = $admin->req('GET', "items/expense/{$exp['id']}");
    T::eq([[], false, null], [$x['data']['payments'], $x['data']['paid'], $x['data']['paidDate']]);
});
T::test('paiement déjà saisi à la main (même montant, ± 7 jours) : pas ajouté une seconde fois', function () use ($admin, $acc) {
    $cli = $GLOBALS['RAP']['cli'];
    [, $inv] = $admin->req('POST', 'items/invoice', ['data' => ['clientId' => $cli, 'status' => 'emise', 'date' => '2026-01-05', 'lines' => [['kind' => 'item', 'desc' => 'Solde', 'qty' => 1, 'price' => 10600, 'vat' => 0]],
        'payments' => [['date' => '2026-01-26', 'amount' => 10600, 'method' => 'Virement']]]]);
    $t = (int)db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['bnp']} AND amount = 1060000")->fetchColumn();
    [, $s] = $admin->req('GET', "pilot/tx/$t/suggest");
    $sx = array_values(array_filter($s, fn($x) => $x['id'] === $inv['id']))[0] ?? null;
    T::ok($sx && $sx['existing_payment'] === '2026-01-26' && !$sx['can_pay'], json_encode($s, JSON_UNESCAPED_UNICODE));
    [$c, $u] = $admin->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]); T::eq(200, $c);
    T::eq(0, $u['match_paid']);
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq(1, count($f['data']['payments']));
    [$c] = $admin->req('PUT', "pilot/tx/$t", ['match' => null]); T::eq(200, $c);
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq(1, count($f['data']['payments']), 'le paiement saisi à la main n\'est jamais retiré');
});
T::test('historique mensuel : transferts internes exclus des entrées/sorties ; soldes reconstitués = soldes de la banque', function () use ($admin, $X, $acc) {
    [$c, $m] = $admin->req('GET', 'pilot/monthly&months=3&until=2026-03'); T::eq(200, $c);
    T::eq(['2026-01', '2026-02', '2026-03'], $m['months']);
    $jan = $m['total'][0];
    T::eq(242000 + 242000 + 1060000, $jan['in'], 'entrées de janvier (clients) sans les 1.000,00 venus de Belfius');
    T::eq(-50000, $jan['internal'], 'transferts : +1.000 / -1.000 s\'annulent, reste -500 vers Belfius (contrepartie non importée)');
    $eu = array_values(array_filter($m['accounts'], fn($a) => $a['id'] === $acc['europabank']))[0]['months'];
    T::eq([$X['europabank']['jan']['closing'], $X['europabank']['feb']['closing'], $X['europabank']['mar']['closing']], array_column($eu, 'closing'));
    T::eq([1.0, 1.0, 1.0], array_map('floatval', array_column($eu, 'coverage')), 'mois couverts entièrement par les extraits');
});
T::test('annulation d\'un import : mouvements retirés, journal et original conservés ; ré-import possible ; catégorie apprise par le nom reproposée', function () use ($admin, $file, $acc) {
    // apprentissage par le nom (paiement par carte, sans IBAN) : retenu pour le prochain import
    $card = db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['bnp']} AND cp_name = 'QUINCAILLERIE FICTIVE BRUXELLES'")->fetchColumn();
    [$c] = $admin->req('PUT', "pilot/tx/$card", ['category' => 'materiaux', 'learn' => true]); T::eq(200, $c);
    // paiement enregistré par un mouvement de cet import : retiré lors de l'annulation
    [, $inv] = $admin->req('POST', 'items/invoice', ['data' => ['clientId' => $GLOBALS['RAP']['cli'], 'status' => 'emise', 'date' => '2026-01-05', 'lines' => [['kind' => 'item', 'desc' => 'Solde', 'qty' => 1, 'price' => 10600, 'vat' => 0]]]]);
    $cl = (int)db()->query("SELECT id FROM pil_bank_tx WHERE account_id = {$acc['bnp']} AND amount = 1060000")->fetchColumn();
    [$c] = $admin->req('PUT', "pilot/tx/$cl", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true]]); T::eq(200, $c);
    $imp = db()->query("SELECT * FROM pil_bank_imports WHERE account_id = {$acc['bnp']} AND status = 'importe'")->fetch();
    // annulation = demande d'approbation (étape 5), approuvée puis exécutée
    [$c, $r] = $admin->req('DELETE', "pilot/imports/{$imp['id']}", ['justification' => 'test']); T::eq(202, $c); T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_bank_tx WHERE import_id = {$imp['id']} LIMIT 1")->fetchColumn() > 0 ? 1 : 0, 'rien n\'est annulé avant approbation');
    [$c] = $admin->req('POST', "pilot/approvals/{$r['approval']['id']}/approve", ['note' => 'ok']); T::eq(200, $c);
    [$c] = $admin->req('POST', "pilot/approvals/{$r['approval']['id']}/execute"); T::eq(200, $c);
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_bank_tx WHERE import_id = {$imp['id']}")->fetchColumn());
    [, $f] = $admin->req('GET', "items/invoice/{$inv['id']}"); T::eq([], $f['data']['payments'] ?? [], 'paiement retiré de la facture avec l\'import');
    T::eq('annule', db()->query("SELECT status FROM pil_bank_imports WHERE id = {$imp['id']}")->fetchColumn());
    [$c, , $raw] = $admin->req('GET', "pilot/imports/{$imp['id']}/file"); T::eq(200, $c); T::ok(str_starts_with($raw, '%PDF'), 'original téléchargeable');
    [$c] = $admin->req('POST', 'pilot/import', $file('bnp-fictif.pdf', 'bnp-fictif.layout.json')); T::eq(200, $c, 'ré-import après annulation');
    T::eq(['materiaux', 'appris'], array_values(db()->query("SELECT category, cat_source FROM pil_bank_tx WHERE account_id = {$acc['bnp']} AND cp_name = 'QUINCAILLERIE FICTIVE BRUXELLES'")->fetch()), 'catégorie apprise par le nom');
});
T::test('sécurité : original inaccessible en direct, « user » refusé, autre firme invisible', function () use ($admin, $user) {
    $imp = db()->query("SELECT * FROM pil_bank_imports WHERE status = 'importe' LIMIT 1")->fetch();
    [$c] = $admin->req('GET', '', null, ['raw' => 'uploads/' . $imp['stored']]); T::eq(403, $c, 'uploads/pilotage fermé');
    [$c] = $user->req('GET', "pilot/imports/{$imp['id']}/file"); T::eq(403, $c);
    [$c] = $user->req('GET', 'pilot/tx'); T::eq(403, $c);
    db()->exec("INSERT INTO pil_bank_tx (company_id, account_id, import_id, booking_date, amount, fp, raw) VALUES (2, 999, 999, '2026-01-01', 123456, 'x', 'SECRET AUTRE FIRME')");
    [, $l] = $admin->req('GET', 'pilot/tx');
    T::ok(!str_contains(json_encode($l), 'SECRET AUTRE FIRME'), 'mouvement d\'une autre firme visible !');
    [$c] = $admin->req('PUT', 'pilot/tx/' . (int)db()->lastInsertId(), ['note' => 'x']); T::eq(404, $c);
});
T::test('sauvegarde : la copie e-mail hebdomadaire ne contient pas les tables bancaires ; la sauvegarde du serveur les contient', function () {
    $php = 'require "/var/www/html/lib.php"; $m = backup_mail_copy(sys_get_temp_dir()); $s = implode("", gzfile($m)); unlink($m);'
        . ' echo str_contains($s, "CREATE TABLE `items`") ? "I" : "-", str_contains($s, "pil_bank") ? "B" : "-";'
        . ' $f = sys_get_temp_dir() . "/full.sql.gz"; backup_db($f); $s = implode("", gzfile($f)); unlink($f); echo str_contains($s, "CREATE TABLE `pil_bank_tx`") ? "F" : "-";';
    $r = trim((string)shell_exec('docker exec bp-test-web php -r ' . escapeshellarg($php) . ' 2>&1'));
    T::eq('I-F', $r, 'I = données BatiPro présentes, - = pas de tables bancaires dans l\'e-mail, F = sauvegarde complète sur le serveur');
});
T::test('aucune connexion bancaire ni ordre de virement : aucun appel réseau sortant dans le module', function () {
    $src = file_get_contents(__DIR__ . '/../../pilotage/bank.php') . file_get_contents(__DIR__ . '/../../pilotage/bank_parse.php');
    T::ok(!preg_match('/curl_|fsockopen|file_get_contents\(\s*[\'"]https?:|stream_socket/i', $src), 'aucun appel réseau sortant');
});

exit(T::done());
