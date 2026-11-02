<?php
// PILOTAGE étape 5 : rôles et permissions (côté serveur), centre d'approbation, journal d'audit, protection des données,
// import CSV / Excel (fichiers fictifs), vérification de la restauration d'une sauvegarde.
declare(strict_types=1);
require __DIR__ . '/harness.php';

const FX = __DIR__ . '/../fixtures/bank/';
$X = json_decode(file_get_contents(FX . 'expected.json'), true);
$owner = new Client('owner'); $owner->login('admin@test.madibu.local', 'Admin-Test-2026');
$none = new Client('user'); $none->login('user@test.madibu.local', 'Role-Test-2026');
$C = []; $U = [];
echo "Rôles et permissions (contrôlés par le serveur)\n";
T::test('création des comptes : finance, comptable, chef de projet, second administrateur ; rôles attribués par le propriétaire', function () use ($owner, &$C, &$U) {
    foreach ([['finance', 'user', 'finance'], ['compta', 'user', 'accountant'], ['pm', 'chef', 'project_manager'], ['admin2', 'admin', null]] as [$k, $brole, $prole]) {
        [$c, $j] = $owner->req('POST', 'users', ['name' => ucfirst($k) . ' Fictif', 'email' => "$k@test.madibu.local", 'password' => 'Role-Test-2026', 'role' => $brole]); T::eq(200, $c, json_encode($j));
        $U[$k] = (int)db()->query("SELECT id FROM users WHERE email = '$k@test.madibu.local'")->fetchColumn();
        if ($prole) { [$c, $r] = $owner->req('PUT', "pilot/roles/{$U[$k]}", ['role' => $prole]); T::eq(200, $c, json_encode($r)); T::eq(true, $r['done']); }
        $C[$k] = new Client($k); [$c] = $C[$k]->login("$k@test.madibu.local", 'Role-Test-2026'); T::eq(200, $c);
    }
    [, $me] = $C['admin2']->req('GET', 'pilot/me'); T::eq('admin', $me['role'], 'administrateur BatiPro = administrateur du module par défaut');
    [, $me] = $owner->req('GET', 'pilot/me'); T::eq('owner', $me['role']);
});
T::test('matrice des permissions appliquée par le serveur, rôle par rôle', function () use ($owner, $none, &$C) {
    $tx = (int)db()->query('SELECT id FROM pil_bank_tx WHERE company_id = 1 ORDER BY id LIMIT 1')->fetchColumn();
    $who = ['owner' => $owner, 'admin' => $C['admin2'], 'finance' => $C['finance'], 'accountant' => $C['compta'], 'project_manager' => $C['pm'], 'none' => $none];
    $cases = [ // [méthode, route, corps, rôles autorisés]
        ['GET', 'pilot/tx', null, ['owner', 'admin', 'finance', 'accountant']],
        ['PUT', "pilot/tx/$tx", ['note' => 'contrôle'], ['owner', 'admin', 'finance']],
        ['GET', 'pilot/forecast', null, ['owner', 'admin', 'finance', 'accountant']],
        ['PUT', 'pilot/hypotheses', [], ['owner', 'finance']],
        ['GET', 'pilot/reports', null, ['owner', 'admin', 'finance']],
        ['GET', 'pilot/projects', null, ['owner', 'admin', 'finance', 'project_manager']],
        ['GET', 'pilot/audit', null, ['owner', 'admin', 'accountant']],
        ['GET', 'pilot/settings', null, ['owner']],
        ['GET', 'pilot/approvals', null, ['owner', 'admin', 'finance', 'accountant', 'project_manager']],
    ];
    foreach ($cases as [$m, $r, $b, $ok]) foreach ($who as $role => $cl) { [$c] = $cl->req($m, $r, $b); T::eq(in_array($role, $ok, true) ? 200 : 403, $c, "$m $r pour $role"); }
    [$c, , $raw] = $C['finance']->req('GET', 'pilot/export/tx'); T::eq(200, $c); T::ok(str_contains($raw, 'Compte;Montant;Contrepartie') && substr_count($raw, "\n") > 10, 'export CSV');
    [$c] = $C['admin2']->req('GET', 'pilot/export/tx'); T::eq(403, $c, 'export interdit à l\'administrateur');
    [$c] = $C['compta']->req('POST', 'pilot/ask', ['question' => 'x']); T::eq(403, $c, 'assistant interdit au comptable');
});
T::test('chef de projet : uniquement ses chantiers', function () use ($owner, &$C, &$U) {
    [, $p] = $owner->req('POST', 'items/project', ['data' => ['name' => 'Chantier du chef de projet', 'status' => 'encours', 'managerId' => $U['pm'], 'budget' => 5000]]);
    [$c, $l] = $C['pm']->req('GET', 'pilot/projects'); T::eq(200, $c);
    T::eq([$p['id']], array_column($l, 'id'));
    [, $all] = $owner->req('GET', 'pilot/projects'); T::ok(count($all) > 1, 'le propriétaire voit tout');
});

echo "\nCentre d'approbation\n";
$ap = fn(array $r) => $r['approval']['id'] ?? null;
T::test('finance : paiement d\'une facture → demande d\'approbation (202), rien n\'est écrit dans la facture', function () use ($owner, &$C, &$U, $ap) {
    [, $cli] = $owner->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client Approbation SA']]);
    [, $inv] = $owner->req('POST', 'items/invoice', ['data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => '2026-02-01', 'due' => '2026-03-01', 'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => 4000, 'vat' => 21]]]]);
    $t = (int)db()->query("SELECT id FROM pil_bank_tx WHERE amount = 484000 AND match_id IS NULL LIMIT 1")->fetchColumn();
    if (!$t) { // le CSV de février n'est pas encore importé : on prend un autre encaissement libre de même montant inexistant → mouvement fictif ajouté
        db()->exec("INSERT INTO pil_bank_tx (company_id, account_id, import_id, booking_date, amount, fp, raw, category, status) SELECT 1, id, 0, '2026-02-20', 484000, 'test-ap', 'TEST', 'encaissement_client', 'a_verifier' FROM pil_bank_accounts WHERE company_id = 1 LIMIT 1");
        $t = (int)db()->lastInsertId();
    }
    [$c, $r] = $C['finance']->req('PUT', "pilot/tx/$t", ['match' => ['type' => 'invoice', 'id' => $inv['id'], 'pay' => true], 'justification' => 'virement du client']); T::eq(202, $c, json_encode($r));
    T::eq(['paiement_rapprochement', 'en_attente', 484000], [$r['approval']['type'], $r['approval']['status'], $r['approval']['amount']]);
    [, $f] = $owner->req('GET', "items/invoice/{$inv['id']}"); T::eq([], $f['data']['payments'] ?? [], 'aucun paiement avant approbation');
    $GLOBALS['AP'] = ['inv' => $inv, 'tx' => $t, 'id' => $ap($r)];
});
T::test('approuver ≠ exécuter ; exécution contrôlée et journalisée ; seul le propriétaire approuve', function () use ($owner, &$C) {
    ['inv' => $inv, 'id' => $id] = $GLOBALS['AP'];
    [$c] = $C['admin2']->req('POST', "pilot/approvals/$id/approve"); T::eq(403, $c, 'l\'administrateur ne peut pas approuver');
    [$c] = $C['admin2']->req('POST', "pilot/approvals/$id/execute"); T::eq(409, $c, 'exécution refusée tant que ce n\'est pas approuvé');
    [$c, $a] = $owner->req('POST', "pilot/approvals/$id/approve", ['note' => 'vu le relevé']); T::eq(200, $c); T::eq('approuvee', $a['status']);
    [, $f] = $owner->req('GET', "items/invoice/{$inv['id']}"); T::eq([], $f['data']['payments'] ?? [], 'approuvée mais pas encore exécutée : facture inchangée');
    [$c, $a] = $C['admin2']->req('POST', "pilot/approvals/$id/execute"); T::eq(200, $c, json_encode($a)); T::eq('executee', $a['status']);
    [, $f] = $owner->req('GET', "items/invoice/{$inv['id']}"); T::eq(4840, $f['data']['payments'][0]['amount'] ?? null, 'paiement écrit à l\'exécution');
    [$c] = $owner->req('POST', "pilot/approvals/$id/execute"); T::eq(409, $c, 'pas de seconde exécution');
    $acts = db()->query("SELECT action FROM pil_audit WHERE entity_type = 'approval' AND entity_id = $id ORDER BY id")->fetchAll(PDO::FETCH_COLUMN);
    T::eq(['approbation_demandee', 'approbation_accordee', 'approbation_executee'], $acts);
});
T::test('refus, annulation par le demandeur, expiration', function () use ($owner, &$C) {
    $mk = function () use ($C) { [, $r] = $C['finance']->req('POST', 'pilot/approvals', ['type' => 'email_externe', 'payload' => ['to' => 'client@exemple.invalid', 'subject' => 'Rappel', 'body' => 'Bonjour']]); return $r['id']; };
    $a = $mk(); [$c, $r] = $owner->req('POST', "pilot/approvals/$a/refuse", ['note' => 'non']); T::eq('refusee', $r['status']);
    [$c] = $owner->req('POST', "pilot/approvals/$a/execute"); T::eq(409, $c, 'refusée : jamais exécutée');
    $b = $mk(); [$c, $r] = $C['finance']->req('POST', "pilot/approvals/$b/cancel"); T::eq('annulee', $r['status']);
    $d = $mk(); db()->exec("UPDATE pil_approvals SET expires_at = '2020-01-01 00:00:00' WHERE id = $d");
    [, $l] = $owner->req('GET', 'pilot/approvals'); T::eq('expiree', array_values(array_filter($l, fn($x) => $x['id'] === $d))[0]['status']);
    [$c] = $owner->req('POST', "pilot/approvals/$d/approve"); T::eq(409, $c, 'expirée : plus de décision possible');
    [$c] = $C['finance']->req('POST', 'pilot/approvals', ['type' => 'paiement_rapprochement', 'payload' => []]); T::eq(400, $c, 'une demande de paiement ne se fabrique pas à la main');
});
T::test('e-mail externe approuvé : exécution réelle tentée ; échec d\'envoi conservé, la demande reste « approuvée »', function () use ($owner, &$C) {
    [, $r] = $C['finance']->req('POST', 'pilot/approvals', ['type' => 'email_externe', 'payload' => ['to' => 'client@exemple.invalid', 'subject' => 'Rappel', 'body' => 'Bonjour']]);
    $owner->req('POST', "pilot/approvals/{$r['id']}/approve");
    [$c, $e] = $owner->req('POST', "pilot/approvals/{$r['id']}/execute");
    if ($c === 200) T::eq('executee', $e['status']);
    else { T::eq(422, $c); $st = db()->query("SELECT status, last_error FROM pil_approvals WHERE id = {$r['id']}")->fetch(); T::eq('approuvee', $st['status']); T::ok($st['last_error'] !== null, 'erreur conservée'); }
});
T::test('double contrôle : le demandeur ne peut pas approuver sa propre demande', function () use ($owner) {
    $owner->req('PUT', 'pilot/settings', ['fourEyes' => true, 'approvalDays' => 14]);
    [, $r] = $owner->req('POST', 'pilot/approvals', ['type' => 'email_externe', 'payload' => ['to' => 'x@exemple.invalid', 'subject' => 'S', 'body' => 'B']]);
    [$c, $j] = $owner->req('POST', "pilot/approvals/{$r['id']}/approve"); T::eq(403, $c); T::ok(str_contains($j['error'], 'Double contrôle'), $j['error']);
    $owner->req('PUT', 'pilot/settings', ['fourEyes' => false, 'approvalDays' => 14]);
});
T::test('suppression d\'un engagement et changement de rôle par un administrateur : demandes d\'approbation', function () use ($owner, &$C, &$U) {
    [, $cm] = $owner->req('POST', 'pilot/commitments', ['kind' => 'charge', 'subtype' => 'telecom', 'label' => 'Abonnement à supprimer', 'amount' => 1000, 'next_date' => '2026-12-01']);
    [$c, $r] = $owner->req('DELETE', "pilot/commitments/{$cm['id']}"); T::eq(202, $c);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_commitments WHERE id = {$cm['id']}")->fetchColumn(), 'toujours présent');
    $owner->req('POST', "pilot/approvals/{$r['approval']['id']}/approve"); [$c] = $owner->req('POST', "pilot/approvals/{$r['approval']['id']}/execute"); T::eq(200, $c);
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_commitments WHERE id = {$cm['id']}")->fetchColumn(), 'supprimé après exécution');
    [$c, $r] = $C['admin2']->req('PUT', "pilot/roles/{$U['compta']}", ['role' => 'finance']); T::eq(202, $c); T::eq('changement_role', $r['approval']['type']);
    [, $me] = $C['compta']->req('GET', 'pilot/me'); T::eq('accountant', $me['role'], 'droits inchangés avant approbation');
    [$c] = $C['admin2']->req('PUT', "pilot/roles/" . 1, ['role' => 'none']); T::eq(202, $c, 'demande possible ; l\'exécution sera refusée (propriétaire)');
});
T::test('assistant IA : proposer une relance crée une demande (origine IA), jamais un envoi', function () use ($owner) {
    $n = (int)db()->query("SELECT COUNT(*) FROM pil_approvals WHERE origin = 'ia'")->fetchColumn();
    [, $cli] = $owner->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client À Relancer SA', 'email' => 'compta@client-fictif.invalid']]);
    [, $inv] = $owner->req('POST', 'items/invoice', ['data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => '2026-01-05', 'due' => '2026-02-05', 'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => 1000, 'vat' => 21]]]]);
    db()->exec("UPDATE items SET number = 'FAC-RELANCE' WHERE id = {$inv['id']}");
    [$c, $r] = $owner->req('POST', 'pilot/ask', ['question' => "PROPOSE une relance de la facture {$inv['id']}"]); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    $p = json_decode((string)db()->query("SELECT payload FROM pil_approvals WHERE origin = 'ia' ORDER BY id DESC LIMIT 1")->fetchColumn(), true);
    T::eq('compta@client-fictif.invalid', $p['to'] ?? null); T::ok(str_contains($p['body'], 'FAC-RELANCE') && str_contains($p['body'], '1.210,00 €'), $p['body'] ?? '');
    T::eq('proposer_action', $r['tools'][0]['outil'] ?? null);
    T::eq($n + 1, (int)db()->query("SELECT COUNT(*) FROM pil_approvals WHERE origin = 'ia'")->fetchColumn());
    T::eq('en_attente', db()->query("SELECT status FROM pil_approvals WHERE origin = 'ia' ORDER BY id DESC LIMIT 1")->fetchColumn());
});

echo "\nJournal d'audit\n";
T::test('événements journalisés avec utilisateur ou processus, date, action, données, ancienne et nouvelle valeur, origine', function () use ($owner) {
    $acts = db()->query('SELECT DISTINCT action FROM pil_audit WHERE company_id = 1')->fetchAll(PDO::FETCH_COLUMN);
    foreach (['connexion', 'import_bancaire', 'import_annule', 'classification', 'rapprochement', 'paiement_document', 'engagement_ajoute', 'engagement_confirme', 'engagement_supprime', 'hypotheses_prevision', 'rapport_quotidien', 'question_ia', 'commentaire_ia', 'approbation_demandee', 'approbation_accordee', 'approbation_refusee', 'approbation_executee', 'role_modifie'] as $a)
        T::ok(in_array($a, $acts, true), "action journalisée : $a");
    $r = db()->query("SELECT * FROM pil_audit WHERE action = 'classification' ORDER BY id DESC LIMIT 1")->fetch();
    T::ok($r['user_id'] && $r['at'] && $r['old_value'] !== null && $r['new_value'] !== null && str_contains($r['origin'], 'web PUT pilot/tx'), json_encode($r));
    T::eq('cron', db()->query("SELECT process FROM pil_audit WHERE action = 'rapport_quotidien' AND process = 'cron' LIMIT 1")->fetchColumn() ?: 'cron absent');
    [, $l] = $owner->req('GET', 'pilot/audit&action=question_ia'); T::ok(count($l) > 0 && $l[0]['process'] === 'ia', 'action IA identifiée comme telle');
});
T::test('aucune route de modification ou de suppression ; intégrité vérifiée', function () use ($owner) {
    foreach (['PUT', 'DELETE', 'POST'] as $m) { [$c] = $owner->req($m, 'pilot/audit/1'); T::eq(404, $c, "$m refusé"); }
    [, $v] = $owner->req('GET', 'pilot/audit/verify'); T::eq(true, $v['ok'], json_encode($v)); T::ok($v['entries'] > 20, 'entrées');
    T::ok(str_contains($v['note'], 'DÉTECTER'), 'aucune promesse d\'inviolabilité absolue');
});
T::test('protection en base (déclencheurs) et détection d\'une falsification directe', function () use ($owner) {
    [, $v] = $owner->req('GET', 'pilot/audit/verify');
    $id = (int)db()->query("SELECT id FROM pil_audit WHERE company_id = 1 ORDER BY id LIMIT 1 OFFSET 5")->fetchColumn();
    if ($v['db_protection']) {
        try { db()->exec("UPDATE pil_audit SET action = 'falsifie' WHERE id = $id"); T::ok(false, 'UPDATE aurait dû être refusé'); } catch (PDOException $e) { T::ok(str_contains($e->getMessage(), 'interdite'), $e->getMessage()); }
        try { db()->exec("DELETE FROM pil_audit WHERE id = $id"); T::ok(false, 'DELETE aurait dû être refusé'); } catch (PDOException $e) { T::ok(str_contains($e->getMessage(), 'interdite'), $e->getMessage()); }
    }
    // administrateur du serveur (accès root) : retire les déclencheurs et falsifie → détecté
    $root = new PDO('mysql:host=127.0.0.1;port=3307;dbname=batipro_test;charset=utf8mb4', 'root', 'root-test', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $orig = $root->query("SELECT action FROM pil_audit WHERE id = $id")->fetchColumn();
    $root->exec('DROP TRIGGER IF EXISTS pil_audit_no_update'); $root->exec("UPDATE pil_audit SET action = 'falsifie' WHERE id = $id");
    [, $v] = $owner->req('GET', 'pilot/audit/verify'); T::eq([false, $id], [$v['ok'], $v['broken_at']], 'falsification détectée à la bonne entrée');
    $root->exec('DROP TRIGGER IF EXISTS pil_audit_no_update'); // la vérification a recréé la protection : il faut la retirer à nouveau pour réparer
    $root->exec("UPDATE pil_audit SET action = " . $root->quote($orig) . " WHERE id = $id");
    [, $v] = $owner->req('GET', 'pilot/audit/verify'); T::eq(true, $v['ok'], 'intègre après remise en état'); T::eq(true, $v['db_protection'], 'déclencheur recréé automatiquement');
    // suppression des dernières entrées (sans casser la chaîne) : détectée par l'ancre
    $root->exec('DROP TRIGGER IF EXISTS pil_audit_no_delete'); $last = $root->query('SELECT * FROM pil_audit WHERE company_id = 1 ORDER BY id DESC LIMIT 1')->fetch(PDO::FETCH_ASSOC);
    $root->exec("DELETE FROM pil_audit WHERE id = {$last['id']}");
    [, $v] = $owner->req('GET', 'pilot/audit/verify'); T::eq([false, false], [$v['ok'], $v['anchor_ok']], 'dernière entrée supprimée : détectée par l\'ancre');
    $cols = array_keys($last); $root->prepare('INSERT INTO pil_audit (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')')->execute(array_values($last));
    [, $v] = $owner->req('GET', 'pilot/audit/verify'); T::eq(true, $v['ok'], 'rétabli');
});

echo "\nImport CSV et Excel (fichiers fictifs)\n";
$file = fn(string $f, array $table, int $acc) => ['name' => $f, 'content' => base64_encode(file_get_contents(FX . $f)), 'account' => $acc, 'table' => $table];
$acc = fn(string $bank) => (int)db()->query("SELECT id FROM pil_bank_accounts WHERE company_id = 1 AND bank = '$bank'")->fetchColumn();
$csvMap = ['seq' => 0, 'date' => 1, 'value_date' => 2, 'amount' => 3, 'cp_iban' => 7, 'cp_name' => 8, 'communication' => 9];
T::test('CSV (export BNP fictif, du plus récent au plus ancien) : sans solde final → refusé ; avec → contrôle exact, continuité, structurée', function () use ($owner, $file, $acc, $csvMap, $X) {
    $a = $acc('BNP Paribas Fortis');
    [, $p] = $owner->req('POST', 'pilot/preview', $file('bnp-fictif-2026-02.csv', ['map' => $csvMap, 'meta' => ['header_row' => 0, 'decimal' => ',']], $a));
    T::ok(str_contains(implode(' ', $p['errors']), 'solde final'), implode(' ', $p['errors']));
    [$c, $p] = $owner->req('POST', 'pilot/import', $file('bnp-fictif-2026-02.csv', ['map' => $csvMap, 'meta' => ['header_row' => 0, 'decimal' => ',', 'closing' => $X['bnpFeb']['closing']]], $a)); T::eq(200, $c, json_encode($p['errors'] ?? null));
    $s = $p['statements'][0];
    T::eq(['csv', 0, $X['bnpFeb']['opening'], 3], [$p['format'], $s['balance_gap'], $s['opening']['amount'], count($s['transactions'])]);
    T::ok($s['continuity']['ok'], 'suit le PDF de janvier');
    T::eq($X['COMM']['invoice'], $s['transactions'][1]['structured']);
    [$c, $p] = $owner->req('POST', 'pilot/import', $file('bnp-fictif-2026-02.csv', ['map' => $csvMap, 'meta' => ['header_row' => 0, 'decimal' => ',', 'closing' => $X['bnpFeb']['closing']]], $a)); T::eq(422, $c, 'même fichier refusé');
});
T::test('CSV : un solde final faux bloque l\'import ; colonne mal choisie → lignes illisibles signalées', function () use ($owner, $file, $acc, $csvMap, $X) {
    $a = $acc('BNP Paribas Fortis');
    db()->exec("DELETE FROM pil_bank_tx WHERE import_id IN (SELECT id FROM pil_bank_imports WHERE format = 'csv')"); db()->exec("UPDATE pil_bank_imports SET status = 'annule' WHERE format = 'csv'");
    [, $p] = $owner->req('POST', 'pilot/preview', $file('bnp-fictif-2026-02.csv', ['map' => $csvMap, 'meta' => ['header_row' => 0, 'closing' => $X['bnpFeb']['closing'] + 100]], $a));
    T::ok(str_contains(implode(' ', $p['errors']), 'Contrôle des soldes'), implode(' ', $p['errors']));
    [, $p] = $owner->req('POST', 'pilot/preview', $file('bnp-fictif-2026-02.csv', ['map' => ['date' => 1, 'amount' => 6], 'meta' => ['header_row' => 0, 'closing' => 1]], $a));
    T::ok(str_contains(implode(' ', $p['errors']), 'montant illisible'), implode(' ', $p['errors']));
    [, $p] = $owner->req('POST', 'pilot/preview', ['name' => 'x.csv', 'content' => base64_encode(file_get_contents(FX . 'bnp-fictif-2026-02.csv')), 'table' => ['map' => $csvMap]]);
    T::ok(str_contains(implode(' ', $p['errors']), 'Choisissez le compte'), 'compte obligatoire');
    [$c] = $owner->req('POST', 'pilot/import', $file('bnp-fictif-2026-02.csv', ['map' => $csvMap, 'meta' => ['header_row' => 0, 'closing' => $X['bnpFeb']['closing']]], $a)); T::eq(200, $c, 'réimport propre');
});
T::test('Excel (export Belfius fictif, lignes lues par SheetJS) : soldes pris dans la colonne « Solde », contrôle exact', function () use ($owner, $file, $acc, $X) {
    $a = $acc('Belfius');
    $t = ['rows' => json_decode(file_get_contents(FX . 'belfius-fictif-2026-02.rows.json'), true), 'map' => ['date' => 1, 'value_date' => 6, 'amount' => 7, 'cp_iban' => 3, 'cp_name' => 4, 'communication' => 9, 'balance' => 10], 'meta' => ['header_row' => 0, 'decimal' => ',']];
    [$c, $p] = $owner->req('POST', 'pilot/import', $file('belfius-fictif-2026-02.xlsx', $t, $a)); T::eq(200, $c, json_encode($p['errors'] ?? null));
    $s = $p['statements'][0];
    T::eq(['xlsx', 0, $X['belfFeb']['opening'], $X['belfFeb']['closing'], 3], [$p['format'], $s['balance_gap'], $s['opening']['amount'], $s['closing']['amount'], count($s['transactions'])]);
    $stored = db()->query("SELECT stored FROM pil_bank_imports WHERE format = 'xlsx' ORDER BY id DESC LIMIT 1")->fetchColumn(); T::ok(str_ends_with($stored, '.xlsx'), 'original Excel conservé : ' . $stored);
});

echo "\nProtection des données\n";
T::test('entrées hostiles : injection SQL dans un filtre, contenu non base64, fichier géant, HTML dans une note (stocké tel quel, échappé à l\'affichage)', function () use ($owner) {
    [$c, $l] = $owner->req('GET', 'pilot/tx&category=' . rawurlencode("x' OR '1'='1")); T::eq([200, []], [$c, $l], 'filtre traité comme une valeur');
    [$c] = $owner->req('POST', 'pilot/preview', ['name' => 'x', 'content' => '%%%pas du base64%%%']); T::eq(400, $c);
    $t = (int)db()->query('SELECT id FROM pil_bank_tx WHERE company_id = 1 LIMIT 1')->fetchColumn();
    [$c, $r] = $owner->req('PUT', "pilot/tx/$t", ['note' => '<img src=x onerror=alert(1)>']); T::eq(200, $c); T::eq('<img src=x onerror=alert(1)>', $r['note']);
    $js = file_get_contents(__DIR__ . '/../../assets/pilotage.js'); T::ok(str_contains($js, 'esc(t.note'), 'note échappée à l\'affichage (esc)');
    [$c] = $owner->req('PUT', "pilot/tx/$t", ['note' => '']);
});
T::test('secrets : la clé API n\'est jamais renvoyée au navigateur ; requêtes sans en-tête de l\'application refusées (CSRF)', function () use ($owner) {
    [, $b] = $owner->req('GET', 'bootstrap'); T::ok(!str_contains(json_encode($b), 'cle-de-test'), 'clé IA absente du bootstrap'); T::eq(true, $b['settings']['ai']['hasKey'] ?? null);
    [$c] = $owner->req('PUT', 'pilot/hypotheses', [], ['noCsrf' => true]); T::eq(403, $c);
});
T::test('sauvegarde complète puis restauration dans une base vierge : mêmes tables, mêmes lignes', function () {
    $out = shell_exec("docker exec bp-test-web php -r 'require \"/var/www/html/lib.php\"; backup_db(\"/tmp/bk.sql.gz\"); echo \"ok\";' 2>&1"); T::eq('ok', trim((string)$out));
    shell_exec('docker exec bp-test-db mariadb -uroot -proot-test -e "DROP DATABASE IF EXISTS restore_test; CREATE DATABASE restore_test CHARACTER SET utf8mb4"');
    shell_exec('docker exec bp-test-web cat /tmp/bk.sql.gz | gunzip | docker exec -i bp-test-db mariadb -uroot -proot-test restore_test 2>&1');
    $root = new PDO('mysql:host=127.0.0.1;port=3307;charset=utf8mb4', 'root', 'root-test', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $tables = $root->query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'batipro_test'")->fetchAll(PDO::FETCH_COLUMN);
    T::ok(count($tables) > 15 && in_array('pil_audit', $tables, true), count($tables) . ' tables');
    foreach ($tables as $t) T::eq((int)$root->query("SELECT COUNT(*) FROM batipro_test.`$t`")->fetchColumn(), (int)$root->query("SELECT COUNT(*) FROM restore_test.`$t`")->fetchColumn(), "table $t");
    $root->exec('DROP DATABASE restore_test');
});

echo "\nSite de test (config.php : test_mode)\n";
T::test('mode test : bandeau, e-mail approuvé « exécuté » sans rien envoyer (journal du serveur), Peppol et notifications bloqués', function () use ($owner) {
    shell_exec("docker exec bp-test-web sed -i \"s/^return array (/return array (\\n  'test_mode' => true,/\" /var/www/html/config.php"); sleep(3); // opcache relit config.php toutes les 2 secondes
    try {
        [, $b] = $owner->req('GET', 'bootstrap'); T::eq(true, $b['testMode'] ?? null, 'indicateur envoyé à l\'interface');
        [, $r] = $owner->req('POST', 'pilot/approvals', ['type' => 'email_externe', 'payload' => ['to' => 'client-reel@exemple.invalid', 'subject' => 'Ne doit pas partir', 'body' => 'x']]);
        $owner->req('POST', "pilot/approvals/{$r['id']}/approve");
        [$c, $e] = $owner->req('POST', "pilot/approvals/{$r['id']}/execute"); T::eq(200, $c, json_encode($e));
        $log = (string)shell_exec('docker logs bp-test-web 2>&1 | grep "mode test"'); // Apache écrit les accents en \\xc3\\xa9
        T::ok(str_contains($log, 'e-mail NON envoy') && str_contains($log, 'client-reel@exemple.invalid'), 'envoi intercepté et journalisé : ' . trim($log));
        $php = 'require "/var/www/html/lib.php"; require "/var/www/html/peppol_ap.php"; echo push_send("https://fcm.googleapis.com/x"), "|"; try { pap_req("GET", "x"); echo "PEPPOL-PARTI"; } catch (Throwable $e) { echo $e->getMessage(); }';
        $out = trim((string)shell_exec('docker exec bp-test-web php -r ' . escapeshellarg($php) . ' 2>&1'));
        T::ok(str_starts_with($out, '0|Site de test : Peppol est désactivé'), $out);
    } finally { shell_exec("docker exec bp-test-web sed -i \"/'test_mode' => true,/d\" /var/www/html/config.php"); sleep(3); }
    [, $b] = $owner->req('GET', 'bootstrap'); T::eq(false, $b['testMode'] ?? null, 'mode normal rétabli');
});

exit(T::done());
