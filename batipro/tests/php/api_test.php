<?php
// Tests de non-régression de l'API BatiPro (comportement ACTUEL de la v141).
// Lancés par tests/run.sh contre une instance de test fraîchement installée avec install.php.
// Les tests « RISQUE CONNU » décrivent un comportement actuel jugé risqué dans l'audit, pas encore corrigé.
declare(strict_types=1);
require __DIR__ . '/harness.php';

const ADMIN = ['email' => 'admin@test.madibu.local', 'password' => 'Admin-Test-2026'];
$year = date('Y');

echo "Installation et protection des fichiers\n";
T::test('install.php refuse une seconde installation', function () {
    [$c, , $raw] = (new Client())->req('GET', '', null, ['raw' => 'install.php']);
    T::eq(200, $c); T::ok(str_contains($raw, 'déjà installée'), 'message « Application déjà installée » attendu');
});
T::test('.htaccess : fichiers internes inaccessibles depuis le web', function () {
    $cl = new Client();
    foreach (['config.php', 'lib.php', 'ai.php', 'cron.php', 'saas.php', 'peppol_ap.php', 'schema.sql', 'README.md', 'composer.lock', 'uploads/.htaccess'] as $f) {
        [$c] = $cl->req('GET', '', null, ['raw' => $f]);
        T::eq(403, $c, $f);
    }
});
T::test('cron.php refuse une exécution par le web', function () {
    [$c] = (new Client())->req('GET', '', null, ['raw' => 'cron.php']);
    T::ok(in_array($c, [403], true), "attendu 403, obtenu $c");
});

echo "\nAuthentification et CSRF\n";
T::test('accès sans session refusé (401)', function () {
    [$c] = (new Client())->req('GET', 'items/invoice');
    T::eq(401, $c);
});
T::test('mauvais mot de passe refusé (401)', function () {
    [$c, $j] = (new Client())->login(ADMIN['email'], 'mauvais');
    T::eq(401, $c); T::eq('Email ou mot de passe incorrect.', $j['error'] ?? null);
});
T::test('requête modifiante sans en-tête X-Requested-With refusée (CSRF, 403)', function () {
    [$c] = (new Client())->req('POST', 'auth/login', ADMIN, ['noCsrf' => true]);
    T::eq(403, $c);
});
$admin = new Client('admin');
T::test('connexion administrateur et données de départ', function () use ($admin) {
    [$c] = $admin->login(ADMIN['email'], ADMIN['password']);
    T::eq(200, $c);
    [$c, $j] = $admin->req('GET', 'bootstrap');
    T::eq(200, $c);
    T::eq('admin', $j['user']['role'] ?? null);
});

echo "\nDonnées métier (items)\n";
$ids = [];
T::test('création client, chantier, facture ; numéros de chantier séquentiels', function () use ($admin, &$ids, $year) {
    [$c, $cli] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client Fictif SA']]);
    T::eq(200, $c); $ids['client'] = $cli['id'];
    [$c, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Chantier test', 'clientId' => $cli['id'], 'status' => 'encours']]);
    T::eq(200, $c); $ids['project'] = $p['id'];
    T::ok(preg_match("/^CH-$year-0*1$/", (string)$p['number']) === 1, 'numéro de chantier CH-ANNÉE-0001 attendu, obtenu ' . $p['number']);
    [, $p2] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Chantier test 2']]);
    T::ok(preg_match("/^CH-$year-0*2$/", (string)$p2['number']) === 1, 'numéro suivant attendu');
    $ids['project2'] = $p2['id'];
    $inv = ['clientId' => $cli['id'], 'status' => 'emise', 'date' => "$year-10-01", 'due' => "$year-10-31",
        'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 1, 'price' => 1000, 'vat' => 21]], 'payments' => [['date' => "$year-10-15", 'amount' => 500]]];
    [$c, $i] = $admin->req('POST', 'items/invoice', ['project_id' => $p['id'], 'data' => $inv]);
    T::eq(200, $c); $ids['invoice'] = $i['id'];
    T::eq(500, $i['data']['payments'][0]['amount'] ?? null, 'paiement conservé dans le JSON de la facture');
});
T::test('numérotation des factures : FAC-ANNÉE-0001 puis 0002 (route number)', function () use ($admin, $year) {
    [, $a] = $admin->req('POST', 'number/invoice');
    [, $b] = $admin->req('POST', 'number/invoice');
    T::ok(preg_match("/^FAC-$year-0*1$/", (string)$a['number']) === 1, 'obtenu ' . json_encode($a));
    T::ok(preg_match("/^FAC-$year-0*2$/", (string)$b['number']) === 1, 'obtenu ' . json_encode($b));
});
T::test('verrou optimiste : modification concurrente détectée (409)', function () use ($admin, &$ids) {
    [, $i] = $admin->req('GET', "items/invoice/{$ids['invoice']}");
    $d = $i['data']; $d['note'] = 'A';
    [$c] = $admin->req('PUT', "items/invoice/{$ids['invoice']}", ['data' => $d, 'version' => $i['version']]);
    T::eq(200, $c);
    $d['note'] = 'B';
    [$c, $j] = $admin->req('PUT', "items/invoice/{$ids['invoice']}", ['data' => $d, 'version' => $i['version']]);
    T::eq(409, $c); T::ok(isset($j['conflict']), 'version actuelle renvoyée');
});
T::test('journal d\'activité alimenté (création et modification)', function () use (&$ids) {
    $n = (int)db()->query("SELECT COUNT(*) FROM activity WHERE type = 'invoice' AND item_id = {$ids['invoice']}")->fetchColumn();
    T::ok($n >= 2, "au moins 2 entrées attendues, $n trouvée(s)");
});
T::test('cloisonnement multi-firmes : une donnée d\'une autre firme est invisible', function () use ($admin) {
    db()->exec("INSERT INTO companies (id, name, active, created_at) VALUES (2, 'Autre firme', 1, NOW()) ON DUPLICATE KEY UPDATE name = name");
    db()->exec("INSERT INTO items (company_id, type, data, version, created_at, updated_at) VALUES (2, 'invoice', '{\"status\":\"emise\",\"title\":\"SECRET\"}', 1, NOW(), NOW())");
    $other = (int)db()->lastInsertId();
    [, $list] = $admin->req('GET', 'items/invoice');
    T::ok(!in_array($other, array_column($list, 'id'), true), 'la facture de la firme 2 ne doit pas apparaître');
    [$c] = $admin->req('GET', "items/invoice/$other");
    T::eq(404, $c);
});

echo "\nRôles\n";
$user = new Client('user'); $chef = new Client('chef'); $ouvrier = new Client('ouvrier');
T::test('création des comptes user, chef, ouvrier par l\'administrateur', function () use ($admin, $user, $chef, $ouvrier) {
    [, $emp] = $admin->req('POST', 'items/employee', ['data' => ['name' => 'Ouvrier Fictif']]);
    foreach ([['user', $user, null], ['chef', $chef, null], ['ouvrier', $ouvrier, $emp['id']]] as [$role, $cl, $link]) {
        [$c, $j] = $admin->req('POST', 'users', ['name' => ucfirst($role) . ' Test', 'email' => "$role@test.madibu.local", 'password' => 'Role-Test-2026', 'role' => $role, 'link' => $link]);
        T::eq(200, $c, "création $role : " . json_encode($j));
        [$c] = $cl->login("$role@test.madibu.local", 'Role-Test-2026');
        T::eq(200, $c, "connexion $role");
    }
});
T::test('« user » : pas d\'accès aux paramètres (403)', function () use ($user) {
    [$c] = $user->req('PUT', 'settings', ['company' => ['name' => 'Piratage']]);
    T::eq(403, $c);
});
T::test('« chef » : ne peut pas créer de facture (403)', function () use ($chef, &$ids) {
    [$c] = $chef->req('POST', 'items/invoice', ['project_id' => $ids['project'], 'data' => ['status' => 'brouillon']]);
    T::eq(403, $c);
});
T::test('« ouvrier » : aucune facture visible, création interdite', function () use ($ouvrier, &$ids) {
    [$c, $list] = $ouvrier->req('GET', 'items/invoice');
    T::eq(200, $c); T::eq([], $list);
    [$c] = $ouvrier->req('GET', "items/invoice/{$ids['invoice']}");
    T::eq(404, $c);
    [$c] = $ouvrier->req('POST', 'items/invoice', ['data' => ['status' => 'brouillon']]);
    T::eq(403, $c);
});

echo "\nFichiers\n";
T::test('envoi d\'un PDF puis lecture authentifiée ; type .php refusé ; accès direct à uploads/ refusé', function () use ($admin) {
    $tmp = tempnam(sys_get_temp_dir(), 'pdf'); file_put_contents($tmp, "%PDF-1.4\n% fichier de test\n");
    [$c, $f] = $admin->req('POST', 'files', null, ['multipart' => ['file' => new CURLFile($tmp, 'application/pdf', 'extrait-fictif.pdf')]]);
    T::eq(200, $c, json_encode($f));
    [$c, , $raw] = $admin->req('GET', "files/{$f['id']}");
    T::eq(200, $c); T::ok(str_contains($raw, 'fichier de test'), 'contenu attendu');
    [$c] = (new Client())->req('GET', "files/{$f['id']}");
    T::eq(401, $c, 'sans session');
    $path = db()->query("SELECT path FROM files WHERE id = {$f['id']}")->fetchColumn();
    [$c] = (new Client())->req('GET', '', null, ['raw' => "uploads/$path"]);
    T::eq(403, $c, 'accès direct au dossier uploads');
    $php = tempnam(sys_get_temp_dir(), 'php'); file_put_contents($php, '<?php echo 1;');
    [$c] = $admin->req('POST', 'files', null, ['multipart' => ['file' => new CURLFile($php, 'text/plain', 'shell.php')]]);
    T::eq(400, $c);
    @unlink($tmp); @unlink($php);
});
T::test('RISQUE CONNU (audit F1-6) : un compte « user » lit n\'importe quel fichier de la firme', function () use ($user) {
    $id = (int)db()->query('SELECT MAX(id) FROM files')->fetchColumn();
    [$c] = $user->req('GET', "files/$id");
    T::eq(200, $c, 'comportement actuel');
});

echo "\nÉtape 1 : protection de l'historique financier (risques F1-1 et F1-2 corrigés)\n";
$validated = function (array $extra = []) use ($admin, &$ids) {
    $data = array_merge(['clientId' => $ids['client'], 'status' => 'emise', 'date' => '2026-10-01', 'due' => '2026-10-31',
        'lines' => [['kind' => 'item', 'desc' => 'Travaux', 'qty' => 2, 'price' => 500, 'vat' => 21]]], $extra);
    [$c, $i] = $admin->req('POST', 'items/invoice', ['project_id' => $ids['project2'], 'number' => null, 'data' => $data]);
    T::eq(200, $c);
    db()->exec("UPDATE items SET number = 'FAC-TEST-" . $i['id'] . "' WHERE id = " . (int)$i['id']);
    [, $i] = $admin->req('GET', "items/invoice/{$i['id']}");
    return $i;
};
T::test('facture validée : montant modifié refusé (403, pas 409 : l\'interface traite 409 comme un conflit de version), même par l\'administrateur', function () use ($admin, $validated) {
    $i = $validated(); $d = $i['data']; $d['lines'][0]['price'] = 600;
    [$c, $j] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $d, 'version' => $i['version']]);
    T::eq(403, $c); T::ok(str_contains($j['error'], 'note de crédit'), 'message orientant vers une note de crédit');
});
T::test('facture validée : client, date, TVA ou numéro modifiés refusés (403)', function () use ($admin, $validated, &$ids) {
    $i = $validated();
    foreach ([['date', '2026-09-01'], ['reverse', true]] as [$k, $v]) {
        $d = $i['data']; $d[$k] = $v;
        [$c] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $d]); T::eq(403, $c, $k);
    }
    $d = $i['data']; $d['lines'][0]['vat'] = 6;
    [$c] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $d]); T::eq(403, $c, 'taux de TVA');
    [$c] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $i['data'], 'number' => 'FAC-AUTRE']); T::eq(403, $c, 'numéro');
});
T::test('facture validée : paiement, envoi et commentaire restent possibles (« user »)', function () use ($user, $validated) {
    $i = $validated(); $d = $i['data'];
    $d['payments'] = [['date' => '2026-10-20', 'amount' => 605]]; $d['sent'] = [['to' => 'client@example.test', 'at' => '2026-10-02']]; $d['comments'] = [['txt' => 'Relancé']];
    $d['lines'][0]['id'] = 'ligne-renommee'; // identifiant technique de ligne : sans effet fiscal
    [$c, $j] = $user->req('PUT', "items/invoice/{$i['id']}", ['data' => $d, 'version' => $i['version']]);
    T::eq(200, $c, json_encode($j)); T::eq(605, $j['data']['payments'][0]['amount']);
});
T::test('facture validée : suppression refusée à « user » (403)', function () use ($user, $validated) {
    $i = $validated();
    [$c] = $user->req('DELETE', "items/invoice/{$i['id']}");
    T::eq(403, $c);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM items WHERE id = {$i['id']}")->fetchColumn());
});
T::test('facture validée : réouverture refusée à « user » (403)', function () use ($user, $validated) {
    $i = $validated(); $d = $i['data']; $d['status'] = 'brouillon';
    [$c] = $user->req('PUT', "items/invoice/{$i['id']}", ['data' => $d]);
    T::eq(403, $c);
});
T::test('administrateur : réouverture et suppression autorisées (fonction existante) avec copie intégrale archivée', function () use ($admin, $validated) {
    $i = $validated(); $d = $i['data']; $d['status'] = 'brouillon'; $d['reopened'] = ['at' => '2026-11-01'];
    [$c] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $d, 'silent' => true]);
    T::eq(200, $c, 'réouverture');
    $a = db()->query("SELECT action, row_json, sha256 FROM item_archive WHERE item_id = {$i['id']}")->fetch();
    T::eq('reopen', $a['action']); T::eq(hash('sha256', $a['row_json']), $a['sha256'], 'empreinte de la copie');
    T::eq('emise', json_decode(json_decode($a['row_json'], true)['data'], true)['status'], 'copie = facture validée d\'origine');
    $j = $validated();
    [$c] = $admin->req('DELETE', "items/invoice/{$j['id']}");
    T::eq(200, $c, 'suppression');
    T::eq('delete', db()->query("SELECT action FROM item_archive WHERE item_id = {$j['id']}")->fetchColumn());
});
T::test('mode « strict » (réglage invoice_lock) : même l\'administrateur doit passer par une note de crédit', function () use ($admin, $validated) {
    [$c] = $admin->req('PUT', 'settings', ['invoice_lock' => 'strict']); T::eq(200, $c);
    $i = $validated();
    [$c] = $admin->req('DELETE', "items/invoice/{$i['id']}"); T::eq(403, $c, 'suppression');
    $d = $i['data']; $d['status'] = 'brouillon';
    [$c] = $admin->req('PUT', "items/invoice/{$i['id']}", ['data' => $d]); T::eq(403, $c, 'réouverture');
    $admin->req('PUT', 'settings', ['invoice_lock' => 'admin']);
});
T::test('brouillons et pro forma : inchangés (modification et suppression libres)', function () use ($user, &$ids) {
    foreach ([['status' => 'brouillon'], ['status' => 'emise', 'kind' => 'proforma']] as $data) {
        [, $i] = $user->req('POST', 'items/invoice', ['project_id' => $ids['project'], 'data' => $data + ['lines' => [['kind' => 'item', 'qty' => 1, 'price' => 10, 'vat' => 21]]]]);
        $d = $i['data']; $d['lines'][0]['price'] = 20;
        [$c] = $user->req('PUT', "items/invoice/{$i['id']}", ['data' => $d]); T::eq(200, $c, 'modification ' . json_encode($data));
        [$c] = $user->req('DELETE', "items/invoice/{$i['id']}"); T::eq(200, $c, 'suppression ' . json_encode($data));
    }
});
T::test('chantier avec facture validée ou facture d\'achat : suppression refusée (403), rien n\'est effacé', function () use ($admin, &$ids) {
    $n = (int)db()->query("SELECT COUNT(*) FROM items WHERE project_id = {$ids['project2']}")->fetchColumn();
    [$c, $j] = $admin->req('DELETE', "items/project/{$ids['project2']}");
    T::eq(403, $c); T::ok(str_contains($j['error'], 'Terminé'), 'conseil : passer au statut Terminé ou Annulé');
    T::eq($n + 1, (int)db()->query("SELECT COUNT(*) FROM items WHERE project_id = {$ids['project2']} OR id = {$ids['project2']}")->fetchColumn());
    [, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Chantier avec un achat']]);
    $admin->req('POST', 'items/expense', ['project_id' => $p['id'], 'data' => ['amount' => 100, 'vat' => 21]]);
    [$c] = $admin->req('DELETE', "items/project/{$p['id']}"); T::eq(403, $c, 'facture d\'achat');
});
T::test('chantier sans document comptable : suppression toujours possible', function () use ($admin) {
    [, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Chantier brouillon']]);
    $admin->req('POST', 'items/quote', ['project_id' => $p['id'], 'data' => ['status' => 'brouillon']]);
    $admin->req('POST', 'items/invoice', ['project_id' => $p['id'], 'data' => ['status' => 'brouillon']]);
    [$c] = $admin->req('DELETE', "items/project/{$p['id']}"); T::eq(200, $c);
});

exit(T::done());
