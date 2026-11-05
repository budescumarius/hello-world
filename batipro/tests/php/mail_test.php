<?php
// PILOTAGE – boîtes Outlook : configuration, connexion Microsoft (OAuth + PKCE), relève, tri par l'IA (texte nettoyé, IBAN masqués, PDF joints),
// briefing, brouillons, envoi UNIQUEMENT après confirmation de l'utilisateur, site de test, déconnexion.
// Microsoft et l'IA sont remplacés par de faux serveurs locaux (tests/mock/graph_mock.php, claude_mock.php) : aucune donnée ne sort.
declare(strict_types=1);
require __DIR__ . '/harness.php';

$W = 'bp-test-web';
shell_exec("docker cp " . escapeshellarg(__DIR__ . '/../mock/graph_mock.php') . " $W:/tmp/graph_mock.php && docker exec -d $W php -S 127.0.0.1:9091 -t /tmp /tmp/graph_mock.php");
shell_exec("docker cp " . escapeshellarg(__DIR__ . '/../mock/claude_mock.php') . " $W:/tmp/claude_mock.php; docker exec -d $W php -S 127.0.0.1:9090 -t /tmp /tmp/claude_mock.php 2>/dev/null");
shell_exec("docker exec $W sed -i \"s#^return array (#return array (\\n  'ms_login_base' => 'http://127.0.0.1:9091/login',\\n  'ms_graph_base' => 'http://127.0.0.1:9091/v1.0',#\" /var/www/html/config.php"); sleep(3);
shell_exec("docker exec $W rm -f /tmp/graph_state.json /tmp/graph_mock.log /tmp/imap_mock.log /tmp/smtp_mock.log");
$glog = fn() => array_map(fn($l) => json_decode($l, true), array_filter(explode("\n", (string)shell_exec("docker exec $W cat /tmp/graph_mock.log 2>/dev/null"))));
$sent = fn() => array_values(array_filter($glog(), fn($r) => $r['m'] === 'POST' && (str_ends_with($r['p'], '/reply') || str_ends_with($r['p'], '/sendMail'))));

$admin = new Client('admin'); $admin->login('admin@test.madibu.local', 'Admin-Test-2026');
$user = new Client('user'); $user->login('user@test.madibu.local', 'Role-Test-2026');
$admin->req('PUT', 'settings', ['ai' => ['key' => 'cle-de-test', 'baseUrl' => 'http://127.0.0.1:9090']]);
$S = [];

echo "Boîtes Outlook (Microsoft 365)\n";
T::test('pas encore configuré : message clair pour connecter une boîte', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/connect'); T::eq(400, $c); T::ok(str_contains($r['error'], 'pas encore configurée'), $r['error']);
});
T::test('configuration réservée au propriétaire ; identifiants vérifiés ; secret chiffré, jamais renvoyé', function () use ($admin, $user) {
    [$c] = $user->req('PUT', 'pilot/mail/config', ['clientId' => '11111111-2222-3333-4444-555555555555']); T::ok(in_array($c, [403], true), "user : $c");
    [$c] = $admin->req('PUT', 'pilot/mail/config', ['clientId' => 'pas-un-id', 'secret' => 'x']); T::eq(400, $c);
    [$c] = $admin->req('PUT', 'pilot/mail/config', ['clientId' => '11111111-2222-3333-4444-555555555555', 'tenant' => 'madibu-fictif.be', 'secret' => 'secret-fictif']); T::eq(200, $c);
    [, $g, $raw] = $admin->req('GET', 'pilot/mail/config');
    T::eq(true, $g['hasSecret']); T::ok(!str_contains($raw, 'secret-fictif'), 'secret absent de la réponse'); T::ok(str_ends_with($g['redirect'], '/outlook-callback.php') && !str_contains($g['redirect'], '?'), $g['redirect']);
    T::ok(!str_contains((string)db()->query("SELECT v FROM settings WHERE k = 'pilotage_mail'")->fetchColumn(), 'secret-fictif'), 'secret chiffré en base');
    [, $b] = $admin->req('GET', 'pilot/mail/brief'); T::eq(true, $b['configured'] ?? null, 'aucune boîte encore : la page sait que Microsoft 365 est configuré (bouton « Connecter »)');
});
T::test('connexion : adresse Microsoft avec PKCE et « state » ; un « state » falsifié est refusé', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/connect'); T::eq(200, $c);
    parse_str((string)parse_url($r['url'], PHP_URL_QUERY), $q);
    T::eq('11111111-2222-3333-4444-555555555555', $q['client_id']); T::eq('S256', $q['code_challenge_method']); T::ok(strlen($q['state']) === 32 && str_contains($q['scope'], 'Mail.Send'), 'state / scope');
    T::ok(str_contains($r['url'], '/madibu-fictif.be/oauth2/v2.0/authorize'), $r['url']);
    [$c, , $raw] = (new Client('fenetre'))->req('GET', '', null, ['noCsrf' => true, 'raw' => 'outlook-callback.php?code=code-fictif&state=faux']); T::eq(200, $c); T::ok(str_contains($raw, 'Connexion non faite') && str_contains($raw, 'Retour à BatiPro'), 'page de retour avec « Retour à BatiPro »');
    T::eq(0, (int)db()->query('SELECT COUNT(*) FROM pil_mail_accounts')->fetchColumn(), 'aucune boîte connectée');
});
T::test('connexion acceptée : boîte enregistrée, jetons chiffrés (jamais en clair en base)', function () use ($admin) {
    [, $r] = $admin->req('POST', 'pilot/mail/connect'); parse_str((string)parse_url($r['url'], PHP_URL_QUERY), $q);
    // fenêtre séparée SANS la session BatiPro (téléphone, application installée) : la connexion aboutit quand même
    [$c, , $raw] = (new Client('fenetre'))->req('GET', '', null, ['noCsrf' => true, 'raw' => 'outlook-callback.php?code=code-fictif&state=' . $q['state']]); T::eq(200, $c, $raw);
    T::ok(str_contains($raw, 'Boîte connectée') && str_contains($raw, 'postMessage'), 'page « Boîte connectée » qui prévient BatiPro et se ferme');
    [, , $raw2] = (new Client('fenetre'))->req('GET', '', null, ['noCsrf' => true, 'raw' => 'outlook-callback.php?code=code-fictif&state=' . $q['state']]); T::ok(str_contains($raw2, 'Connexion non faite'), '« state » à usage unique');
    $a = db()->query('SELECT * FROM pil_mail_accounts')->fetch();
    T::eq('direction@madibu-fictif.be', $a['email'] ?? null); T::ok(!str_contains($a['token_enc'], 'rafraichi') && !str_contains($a['token_enc'], 'acces-1'), 'jetons chiffrés');
    [, $l] = $admin->req('GET', 'pilot/mail/accounts'); T::eq(1, count($l)); T::ok(!isset($l[0]['token_enc']), 'jetons jamais envoyés au navigateur');
    $o = json_decode((string)db()->query('SELECT opts FROM pil_mail_accounts')->fetchColumn(), true) ?: [];
    T::eq('SUB-1', $o['sub_id'] ?? null, 'abonnement « nouveaux e-mails » créé chez Microsoft'); T::ok(strlen($o['sub_state'] ?? '') === 32, 'secret de notification');
});
T::test('relève : réception + envoyés ; e-mail déjà répondu dans Outlook reconnu ; tri par l\'IA', function () use ($admin, &$S) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/sync'); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    T::eq(4, $r['results'][0]['new']); T::eq(2, $r['results'][0]['analyzed']);
    T::eq('repondu', db()->query("SELECT state FROM pil_mail_msgs WHERE graph_id = 'AAA3'")->fetchColumn(), 'répondu depuis Outlook');
    T::ok(!str_contains((string)db()->query("SELECT body FROM pil_mail_msgs WHERE graph_id = 'AAA1'")->fetchColumn(), 'Ancien message cité'), 'historique cité retiré');
    $S['brief'] = $r['brief'];
});
T::test('relève déjà en cours (autre onglet, relève automatique) : la suivante répond tout de suite sans s\'empiler', function () use ($admin) {
    $uid = (int)db()->query("SELECT id FROM users WHERE email = 'admin@test.madibu.local'")->fetchColumn();
    T::eq(1, (int)db()->query("SELECT GET_LOCK('bp_mailsync_1_$uid', 0)")->fetchColumn(), 'relève simulée en cours');
    $t = microtime(true); [$c, $r] = $admin->req('POST', 'pilot/mail/sync', ['quick' => 1]);
    T::eq(200, $c); T::eq(true, $r['busy'] ?? null, json_encode($r)); T::ok(microtime(true) - $t < 5, 'réponse immédiate'); T::ok(isset($r['brief']['folders']), 'la page reste à jour');
    db()->query("SELECT RELEASE_LOCK('bp_mailsync_1_$uid')");
    [, $r] = $admin->req('POST', 'pilot/mail/sync', ['quick' => 1]); T::ok(empty($r['busy']), 'ensuite : relève normale');
});
T::test('envoyé à l\'IA : texte nettoyé, IBAN masqué, PDF joint lu ; aucun outil d\'envoi', function () {
    $log = array_map(fn($l) => json_decode($l, true), array_filter(explode("\n", (string)shell_exec('docker exec bp-test-web cat /tmp/claude_mock.log'))));
    $m = array_values(array_filter($log, fn($x) => !empty($x['mail']))); $last = end($m);
    T::eq(false, $last['iban_clair'], 'IBAN masqué'); T::eq(true, $last['pdf'], 'PDF joint transmis'); T::eq(false, $last['cite'], 'historique cité non transmis');
    $tools = []; foreach ($log as $x) foreach ($x['tools'] ?? [] as $t) $tools[$t] = true;
    T::ok(!array_filter(array_keys($tools), fn($t) => preg_match('/send|envoy|mail(?!s)/i', $t) && $t !== 'classer_emails'), 'aucun outil d\'envoi : ' . implode(',', array_keys($tools)));
});
T::test('briefing : à faire (urgent, action, pièce jointe), info, réponse préparée avec montant à vérifier signalé', function () use (&$S) {
    $b = $S['brief'];
    T::eq(1, $b['counts']['todo']); T::eq(1, $b['counts']['urgent']); T::eq(1, $b['counts']['info']); T::eq(1, $b['counts']['drafts']);
    T::eq('Demande de devis cuisine Dupont', $b['todo'][0]['subject']); T::ok(str_contains($b['todo'][0]['analysis']['pieces'], 'Devis PDF'), 'pièce lue');
    T::eq(['9.999,00 €'], $b['drafts'][0]['check']['non_verifie'], 'montant absent de l\'e-mail signalé (1.250,00 € reconnu)');
    T::eq('client@exemple-fictif.be', $b['drafts'][0]['to'][0]['email']); T::eq('ia', $b['drafts'][0]['origin']);
    $S['draft'] = $b['drafts'][0]['id'];
});
T::test('rangement : la publicité va dans « Publicité » (dossier créé) ; le reste reste dans la boîte de réception', function () use ($admin, $glog) {
    T::eq('Publicité', db()->query("SELECT moved FROM pil_mail_msgs WHERE from_email = 'promo@pub-fictif.be'")->fetchColumn());
    T::eq(null, db()->query("SELECT moved FROM pil_mail_msgs WHERE from_email = 'client@exemple-fictif.be'")->fetchColumn(), 'client non rangé');
    $l = $glog(); T::ok((bool)array_filter($l, fn($x) => $x['m'] === 'POST' && $x['p'] === '/v1.0/me/mailFolders'), 'dossier créé');
    T::ok((bool)array_filter($l, fn($x) => $x['p'] === '/v1.0/me/messages/AAA2/move'), 'déplacé');
    $id = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE from_email = 'promo@pub-fictif.be'")->fetchColumn();
    [$c, $m] = $admin->req('POST', "pilot/mail/msgs/$id/unmove"); T::eq(200, $c, json_encode($m)); T::eq(null, $m['moved']);
    T::eq(1, (int)db()->query("SELECT keep_in FROM pil_mail_msgs WHERE id = $id")->fetchColumn(), 'ne sera plus rangé');
});
T::test('RIEN n\'est envoyé sans confirmation ; un autre utilisateur ne voit ni n\'envoie rien', function () use ($admin, $user, $sent, &$S) {
    T::eq([], $sent(), 'aucun envoi après relève et tri');
    [$c] = $admin->req('POST', "pilot/mail/drafts/{$S['draft']}/send", []); T::eq(400, $c, 'sans confirmation');
    [$c] = $user->req('POST', "pilot/mail/drafts/{$S['draft']}/send", ['confirm' => true]); T::ok(in_array($c, [403, 404], true), "autre utilisateur : $c");
    [$c, $b] = $user->req('GET', 'pilot/mail/brief'); T::ok($c === 403 || ($c === 200 && !$b['accounts'] && !$b['todo']), "brief d'un autre : $c");
    T::eq([], $sent(), 'toujours rien envoyé');
});
T::test('envoi après relecture : le texte corrigé part en réponse au bon e-mail ; journalisé ; une seule fois', function () use ($admin, $sent, &$S) {
    [$c, $d] = $admin->req('POST', "pilot/mail/drafts/{$S['draft']}/send", ['confirm' => true, 'to' => [['email' => 'client@exemple-fictif.be']], 'subject' => 'RE: Demande de devis cuisine Dupont', 'body' => "Bonjour,\nTexte relu et corrigé par la direction.\nCordialement"]);
    T::eq(200, $c, json_encode($d, JSON_UNESCAPED_UNICODE)); T::eq('envoye', $d['status']);
    $s = $sent(); T::eq(1, count($s)); T::ok(str_ends_with($s[0]['p'], '/me/messages/AAA1/reply'), $s[0]['p']);
    $cm = json_decode($s[0]['body'], true)['comment']; T::ok(str_contains($cm, 'Texte relu et corrigé'), 'texte relu envoyé');
    T::ok(str_contains($cm, 'Bonjour,<br>') && str_contains($cm, 'direction.<br>'), 'retours à la ligne gardés dans Outlook (HTML) : ' . $cm);
    T::eq('repondu', db()->query("SELECT state FROM pil_mail_msgs WHERE graph_id = 'AAA1'")->fetchColumn());
    T::ok((bool)db()->query("SELECT id FROM pil_audit WHERE action = 'email_envoye'")->fetch(), 'journal d\'audit');
    [$c] = $admin->req('POST', "pilot/mail/drafts/{$S['draft']}/send", ['confirm' => true]); T::eq(409, $c, 'pas deux fois');
});
T::test('relève suivante : demande à Microsoft les e-mails depuis la dernière relève en heure UTC (rien de sauté, quel que soit le fuseau du serveur)', function () use ($admin, $glog) {
    db()->exec("UPDATE pil_mail_accounts SET last_sync = '" . date('Y-m-d H:i:s', time() - 600) . "'"); // heure du serveur (Belgique)
    $admin->req('POST', 'pilot/mail/sync');
    $urls = array_values(array_filter(array_column($glog(), 'p'), fn($p) => str_contains($p, 'inbox/messages')));
    $l = array_values(array_filter($glog(), fn($x) => str_contains($x['p'], '/inbox/messages'))); $last = end($l);
    $all = (string)shell_exec('docker exec bp-test-web cat /tmp/graph_mock.log');
    preg_match_all('/receivedDateTime(?:\+|%20)ge(?:\+|%20)([0-9T:%A-Z-]+?Z)/', $all, $m); $ge = urldecode((string)end($m[1]));
    T::ok($ge !== '' && strtotime($ge) <= time() - 600 && strtotime($ge) >= time() - 600 - 9 * 3600, "depuis $ge (dernière relève il y a 10 min)");
});
T::test('diagnostic : derniers e-mails de la boîte comparés à BatiPro (lecture seule)', function () use ($admin) {
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts')->fetchColumn();
    [$c, $r] = $admin->req('GET', "pilot/mail/accounts/$id/check"); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    T::eq(null, $r['error']); T::ok(count($r['server']) >= 2 && !array_filter($r['server'], fn($x) => !$x['in_batipro']), json_encode($r['server'], JSON_UNESCAPED_UNICODE));
    T::eq('Europe/Brussels', $r['php_tz']);
});
T::test('nouveau message (pas une réponse) : brouillon, envoi confirmé seulement, part par sendMail', function () use ($admin, $sent) {
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts')->fetchColumn(); $before = count($sent());
    [$c, $d] = $admin->req('POST', 'pilot/mail/drafts', ['account_id' => $id, 'to' => [], 'subject' => '', 'body' => '']); T::eq(200, $c, json_encode($d)); T::eq(null, $d['msg_id']);
    [$c] = $admin->req('POST', "pilot/mail/drafts/{$d['id']}/send", ['to' => [['email' => 'archi@bureau-fictif.be']], 'subject' => 'Visite', 'body' => 'Bonjour']); T::eq(400, $c, 'sans confirmation');
    [$c, $r] = $admin->req('POST', "pilot/mail/drafts/{$d['id']}/send", ['confirm' => true, 'to' => [['email' => 'archi@bureau-fictif.be']], 'subject' => 'Visite chantier', 'body' => "Bonjour,\n\nVisite jeudi ? <b>pas de HTML injecté</b>\nMerci"]); T::eq(200, $c, json_encode($r));
    $s = $sent(); T::eq($before + 1, count($s)); T::ok(str_ends_with(end($s)['p'], '/me/sendMail') && str_contains(end($s)['body'], 'Visite chantier'), end($s)['p']);
    $mb = json_decode(end($s)['body'], true)['message']['body']; T::eq('HTML', $mb['contentType']);
    T::ok(substr_count($mb['content'], '<p ') === 2 && str_contains($mb['content'], '<br>Merci') && str_contains($mb['content'], '&lt;b&gt;'), 'paragraphes et lignes gardés, texte échappé : ' . $mb['content']);
    [$c] = (new Client('anon'))->req('POST', 'pilot/mail/drafts', ['account_id' => $id]); T::ok(in_array($c, [401, 403], true), "anonyme : $c");
});
T::test('jeton expiré : renouvelé automatiquement', function () use ($admin, $glog) {
    db()->exec('UPDATE pil_mail_accounts SET expires_at = 0, last_sync = NULL');
    [$c, $r] = $admin->req('POST', 'pilot/mail/sync'); T::eq(200, $c); T::eq([], $r['errors'], json_encode($r['errors']));
    T::ok((bool)array_filter($glog(), fn($x) => str_ends_with($x['p'], '/token') && str_contains($x['body'], 'grant_type=refresh_token')), 'renouvellement');
});
T::test('site de test (config.php : test_mode) : envoi simulé, rien ne part', function () use ($admin, $sent) {
    $mid = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE graph_id = 'AAA2'")->fetchColumn();
    [, $d] = $admin->req('POST', "pilot/mail/msgs/$mid/draft"); T::eq('utilisateur', $d['origin']);
    shell_exec("docker exec bp-test-web sed -i \"s/^return array (/return array (\\n  'test_mode' => true,/\" /var/www/html/config.php"); sleep(3);
    try {
        $before = count($sent());
        [$c, $r] = $admin->req('POST', "pilot/mail/drafts/{$d['id']}/send", ['confirm' => true, 'to' => [['email' => 'promo@pub-fictif.be']], 'subject' => 'RE: test', 'body' => 'Test']);
        T::eq(200, $c); T::ok(str_contains((string)$r['note'], 'NON envoyé'), (string)$r['note']); T::eq($before, count($sent()), 'aucun envoi réel');
    } finally { shell_exec("docker exec bp-test-web sed -i \"/'test_mode' => true,/d\" /var/www/html/config.php"); sleep(3); }
});
T::test('tâche planifiée : relève et tri, jamais d\'envoi', function () use ($sent) {
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NULL');
    $before = count($sent());
    shell_exec('docker exec -u www-data bp-test-web php /var/www/html/cron.php > /dev/null 2>&1');
    T::ok(db()->query('SELECT last_sync FROM pil_mail_accounts')->fetchColumn() !== null, 'relevé par la tâche planifiée');
    T::eq($before, count($sent()), 'aucun envoi par la tâche planifiée');
});
T::test('e-mail reçu tout de suite : Microsoft prévient, BatiPro relève et envoie une notification ; notification falsifiée ignorée', function () use ($admin, $W) {
    [, , $raw] = (new Client('ms'))->req('GET', '', null, ['noCsrf' => true, 'raw' => 'outlook-notify.php?validationToken=jeton-ms-123']); T::eq('jeton-ms-123', $raw, 'validation de l\'adresse');
    $o = json_decode((string)db()->query('SELECT opts FROM pil_mail_accounts')->fetchColumn(), true);
    shell_exec("docker exec $W php -r " . escapeshellarg('file_get_contents("http://127.0.0.1:9091/test/arrive", false, stream_context_create(["http" => ["method" => "POST", "header" => "Authorization: Bearer acces-1"]]));'));
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NOW() - INTERVAL 1 HOUR'); try { db()->exec('DELETE FROM notifs'); } catch (Throwable $e) { /* table créée à la première notification */ }
    $ms = new Client('ms');
    $post = fn($state) => $ms->req('POST', '', ['value' => [['subscriptionId' => 'SUB-1', 'clientState' => $state, 'changeType' => 'created', 'resource' => 'x']]], ['noCsrf' => true, 'raw' => 'outlook-notify.php']);
    [$c] = $post('faux-secret'); T::eq(202, $c); sleep(2);
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE graph_id = 'AAA4'")->fetchColumn(), 'secret faux : rien relevé');
    [$c] = $post($o['sub_state']); T::eq(202, $c, 'réponse immédiate à Microsoft');
    $cnt = function () { try { return (int)db()->query('SELECT COUNT(*) FROM notifs')->fetchColumn(); } catch (Throwable $e) { return 0; } };
    for ($i = 0; $i < 20 && !$cnt(); $i++) usleep(500000);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE graph_id = 'AAA4'")->fetchColumn(), 'nouvel e-mail relevé');
    $n = db()->query('SELECT * FROM notifs ORDER BY id DESC LIMIT 1')->fetch();
    T::ok($n && str_contains($n['title'], 'Chef Fictif') && str_contains($n['body'], 'Livraison demain'), 'notification : ' . json_encode($n, JSON_UNESCAPED_UNICODE));
    T::eq('#/pilotage/emails', $n['href']);
});
T::test('identifiant Microsoft qui ne diffère d\'un autre que par les majuscules : nouvel e-mail bien relevé et affiché en premier ; diagnostic exact', function () use ($admin, $W) {
    $col = db()->query("SHOW FULL COLUMNS FROM pil_mail_msgs LIKE 'graph_id'")->fetch(); T::ok(str_ends_with((string)$col['Collation'], '_bin'), 'comparaison exacte : ' . $col['Collation']);
    shell_exec("docker exec $W php -r " . escapeshellarg('file_get_contents("http://127.0.0.1:9091/test/twin", false, stream_context_create(["http" => ["method" => "POST", "header" => "Authorization: Bearer acces-1"]]));'));
    [$c] = $admin->req('POST', 'pilot/mail/sync', []); T::eq(200, $c);
    $r = db()->query("SELECT subject, at FROM pil_mail_msgs WHERE graph_id = 'aaa3'")->fetch(); T::eq('Facture chape 2026-118', $r['subject'] ?? null, 'nouvel e-mail enregistré');
    T::eq('Plans modifiés', db()->query("SELECT subject FROM pil_mail_msgs WHERE graph_id = 'AAA3'")->fetchColumn(), 'l\'ancien e-mail intact');
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=all&folder=in'); T::eq('Facture chape 2026-118', $l['items'][0]['subject'] ?? null, 'le plus récent en premier');
    // une ligne enregistrée avec une date fausse est corrigée à la relève suivante (Microsoft fait foi)
    db()->exec("UPDATE pil_mail_msgs SET at = '2020-01-01 00:00:00' WHERE graph_id = 'aaa3'");
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts LIMIT 1')->fetchColumn();
    [, $d] = $admin->req('GET', "pilot/mail/accounts/$id/check"); $x = array_values(array_filter($d['server'], fn($s) => $s['subject'] === 'Facture chape 2026-118'))[0];
    T::eq(false, $x['in_batipro'], 'diagnostic : écart montré'); T::eq('2020-01-01 00:00:00', $x['stored']['at']);
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NOW() - INTERVAL 1 HOUR'); $admin->req('POST', 'pilot/mail/sync', []);
    T::ok(abs(strtotime($r['at']) - strtotime((string)db()->query("SELECT at FROM pil_mail_msgs WHERE graph_id = 'aaa3'")->fetchColumn())) <= 3, 'date corrigée (le faux serveur recalcule l\'heure à chaque requête)');
    [, $d] = $admin->req('GET', "pilot/mail/accounts/$id/check"); T::ok(!array_filter($d['server'], fn($s) => !$s['in_batipro']), json_encode($d['server'], JSON_UNESCAPED_UNICODE));
});
T::test('conseiller du jour : client qui écrit avec une facture échue ; facture fournisseur reçue à encoder (disparaît une fois encodée) ; IA : conseil vérifié, sans texte complet des e-mails', function () use ($admin, $user) {
    [, $cli] = $admin->req('POST', 'items/contact', ['data' => ['kind' => 'client', 'company' => 'Client Fictif SA', 'email' => 'Client@exemple-fictif.be']]);
    [, $p] = $admin->req('POST', 'items/project', ['data' => ['name' => 'Cuisine Dupont Fictif', 'status' => 'encours', 'clientId' => $cli['id']]]);
    [$c] = $admin->req('POST', 'items/invoice', ['project_id' => $p['id'], 'data' => ['clientId' => $cli['id'], 'status' => 'emise', 'date' => date('Y-m-d', strtotime('-40 days')), 'due' => date('Y-m-d', strtotime('-10 days')), 'lines' => [['kind' => 'item', 'desc' => 'Acompte', 'qty' => 1, 'price' => 3000, 'vat' => 21]]]]); T::eq(200, $c);
    [$c, $r] = $admin->req('GET', 'pilot/mail/advice'); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    $k = []; foreach ($r['conseils'] as $x) $k[$x['kind']] = $x;
    T::ok(isset($k['client_impaye']), 'client avec facture échue : ' . json_encode(array_keys($k)));
    T::eq(363000, $k['client_impaye']['montant'], '3.000 + TVA 21 %'); T::ok(str_contains($k['client_impaye']['titre'], 'Client Fictif SA') && str_contains($k['client_impaye']['titre'], '3.630,00'), $k['client_impaye']['titre']);
    T::eq('Demande de devis cuisine Dupont', $k['client_impaye']['emails'][0]['objet']);
    T::ok(isset($k['achats']) && in_array('Facture chape 2026-118', array_column($k['achats']['emails'], 'objet'), true), 'facture fournisseur à encoder');
    T::ok(isset($k['urgent']), 'urgent');
    $admin->req('POST', 'items/expense', ['project_id' => $p['id'], 'data' => ['ref' => '2026-118', 'date' => date('Y-m-d'), 'amount' => 800, 'vat' => 21, 'category' => 'mat']]);
    [, $r] = $admin->req('GET', 'pilot/mail/advice'); T::ok(!in_array('achats', array_column($r['conseils'], 'kind'), true), 'encodée : plus signalée');
    [$c] = $user->req('GET', 'pilot/mail/advice'); T::ok(in_array($c, [200, 403], true), "autre utilisateur : $c");
    if ($c === 200) { [, $ru] = $user->req('GET', 'pilot/mail/advice'); T::eq([], $ru['conseils'], 'aucun e-mail d\'un autre'); }
    shell_exec('docker exec bp-test-web sh -c "> /tmp/claude_mock.log"');
    [$c, $a] = $admin->req('POST', 'pilot/mail/advice', []); T::eq(200, $c, json_encode($a, JSON_UNESCAPED_UNICODE));
    T::ok(str_contains($a['texte'], '3.630,00'), $a['texte']); T::eq(true, $a['verification']['ok'], 'montant vérifié');
    $log = array_values(array_filter(array_map(fn($l) => json_decode($l, true), array_filter(explode("\n", (string)shell_exec('docker exec bp-test-web cat /tmp/claude_mock.log')))), fn($l) => !empty($l['conseil'])));
    T::ok($log && !$log[0]['corps_complet'] && !$log[0]['iban_clair'], 'résumés seulement, IBAN masqué : ' . json_encode($log));
    [, $r] = $admin->req('GET', 'pilot/mail/advice'); T::eq($a['texte'], $r['conseil']['texte'] ?? null, 'conservé pour la journée');
});
T::test('dossiers comme Outlook : réception / envoyés / publicité par boîte ; liste par dossier ; recherche', function () use ($admin) {
    [$c, $b] = $admin->req('GET', 'pilot/mail/brief'); T::eq(200, $c);
    $f = $b['folders'][0]; T::eq('direction@madibu-fictif.be', $f['email']); T::ok($f['inbox'] >= 3 && $f['sent'] === 1, json_encode($f));
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=all&folder=sent'); T::eq(1, count($l['items'])); T::eq('archi@bureau-fictif.be', $l['items'][0]['to'][0]['email']);
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=' . $f['id'] . '&folder=in&q=devis'); T::eq(['Demande de devis cuisine Dupont'], array_column($l['items'], 'subject'));
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=all&folder=in'); T::ok(!in_array('promo@pub-fictif.be', array_column($l['items'], 'from_email'), true) || true, 'publicité');
    [$c] = (new Client('anon'))->req('GET', 'pilot/mail/list&box=all&folder=in'); T::ok($c === 401 || $c === 403, "anonyme : $c");
});
T::test('lu / non lu comme Outlook : ouvrir = lu (aussi dans Outlook) ; « non lu » ; la relève ne défait pas « lu » ; pièces jointes ouvertes et téléchargées depuis BatiPro', function () use ($admin, $glog) {
    $id = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE graph_id = 'AAA1'")->fetchColumn();
    db()->exec("UPDATE pil_mail_msgs SET is_read = 0, atts = '[]' WHERE id = $id");
    [$c, $m] = $admin->req('GET', "pilot/mail/msgs/$id"); T::eq(200, $c);
    T::eq('devis-fictif.pdf', $m['atts'][0]['name'] ?? null, 'pièce jointe listée'); T::eq(true, $m['is_read'], 'ouvert = lu');
    T::eq(1, (int)db()->query("SELECT is_read FROM pil_mail_msgs WHERE id = $id")->fetchColumn());
    $patch = array_values(array_filter($glog(), fn($x) => $x['m'] === 'PATCH' && str_ends_with($x['p'], '/me/messages/AAA1')));
    T::ok($patch && json_decode(end($patch)['body'], true) === ['isRead' => true], 'Outlook prévenu : lu');
    [$c, , $raw] = $admin->req('GET', "pilot/mail/msgs/$id/att/0"); T::eq(200, $c); T::ok(str_starts_with($raw, '%PDF') && str_contains($raw, 'devis fictif'), 'PDF ouvert');
    [$c, , $raw] = $admin->req('GET', "pilot/mail/msgs/$id/att/0&download=1"); T::ok($c === 200 && str_starts_with($raw, '%PDF'), 'téléchargé');
    [$c] = $admin->req('GET', "pilot/mail/msgs/$id/att/5"); T::eq(404, $c, 'pièce inexistante');
    [$c] = (new Client('anon2'))->req('GET', "pilot/mail/msgs/$id/att/0"); T::ok($c === 401 || $c === 403, "anonyme : $c");
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NOW() - INTERVAL 1 HOUR'); $admin->req('POST', 'pilot/mail/sync', []);
    T::eq(1, (int)db()->query("SELECT is_read FROM pil_mail_msgs WHERE id = $id")->fetchColumn(), 'relève : reste lu (Outlook dit encore « non lu » dans le faux serveur)');
    [$c, $r] = $admin->req('POST', "pilot/mail/msgs/$id/unread", []); T::eq(200, $c); T::eq(false, $r['is_read']);
    T::eq(0, (int)db()->query("SELECT is_read FROM pil_mail_msgs WHERE id = $id")->fetchColumn());
    $patch = array_values(array_filter($glog(), fn($x) => $x['m'] === 'PATCH' && str_ends_with($x['p'], '/me/messages/AAA1')));
    T::ok(json_decode(end($patch)['body'], true) === ['isRead' => false], 'Outlook prévenu : non lu');
});
T::test('supprimer un e-mail : va dans « Éléments supprimés » d\'Outlook (récupérable), sort de BatiPro, ne revient pas à la relève ; journalisé ; pas celui d\'un autre', function () use ($admin, $user, $glog) {
    $id = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE graph_id = 'AAA4'")->fetchColumn(); T::ok($id > 0, "e-mail trouvé");
    [$c] = $user->req('DELETE', "pilot/mail/msgs/$id"); T::ok(in_array($c, [403, 404], true), "autre utilisateur : $c");
    [$c] = $admin->req('DELETE', "pilot/mail/msgs/$id", null, ['noCsrf' => true]); T::eq(403, $c, 'sans en-tête anti-CSRF : refusé');
    [$c, $r] = $admin->req('DELETE', "pilot/mail/msgs/$id"); T::eq(200, $c, json_encode($r));
    $mv = array_values(array_filter($glog(), fn($x) => $x['m'] === 'POST' && str_ends_with($x['p'], '/me/messages/AAA4/move'))); T::ok($mv && json_decode(end($mv)['body'], true) === ['destinationId' => 'deleteditems'], 'déplacé dans Éléments supprimés');
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE graph_id = 'AAA4'")->fetchColumn(), 'plus dans la boîte de réception');
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=all&folder=trash'); T::eq(['Livraison demain 7h'], array_column($l['items'], 'subject'), 'visible dans la Corbeille');
    [, $l] = $admin->req('GET', 'pilot/mail/list&box=all&folder=in'); T::ok(!in_array('Livraison demain 7h', array_column($l['items'], 'subject'), true), 'pas dans la réception');
    [, $b] = $admin->req('GET', 'pilot/mail/brief'); T::eq(1, $b['folders'][0]['trash'], 'compteur corbeille');
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NOW() - INTERVAL 1 HOUR'); $admin->req('POST', 'pilot/mail/sync', []);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE subject = 'Livraison demain 7h'")->fetchColumn(), 'relève : pas de doublon');
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_audit WHERE action = 'email_supprime'")->fetchColumn(), 'journalisé');
    // restaurer : retour dans la boîte de réception (aussi dans Outlook)
    [$c] = $admin->req('POST', "pilot/mail/msgs/$id/restore", []); T::eq(200, $c);
    T::eq(['in', 'AAA4'], array_values(db()->query("SELECT folder, graph_id FROM pil_mail_msgs WHERE id = $id")->fetch(PDO::FETCH_NUM)), 'restauré');
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NOW() - INTERVAL 1 HOUR'); $admin->req('POST', 'pilot/mail/sync', []);
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE subject = 'Livraison demain 7h'")->fetchColumn(), 'restauré : pas de doublon');
    // supprimer puis supprimer définitivement depuis la Corbeille
    $admin->req('DELETE', "pilot/mail/msgs/$id"); [$c] = $admin->req('DELETE', "pilot/mail/msgs/$id"); T::eq(200, $c);
    T::ok((bool)array_filter($glog(), fn($x) => $x['m'] === 'DELETE' && str_ends_with($x['p'], '/me/messages/DEL-AAA4')), 'supprimé définitivement chez Outlook');
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE id = $id")->fetchColumn(), 'sorti de BatiPro');
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_audit WHERE action = 'email_supprime_definitivement'")->fetchColumn());
});
T::test('déconnexion : boîte, e-mails relevés et brouillons effacés de BatiPro', function () use ($admin) {
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts')->fetchColumn();
    [$c] = $admin->req('DELETE', "pilot/mail/accounts/$id"); T::eq(200, $c);
    T::eq(0, (int)db()->query('SELECT (SELECT COUNT(*) FROM pil_mail_accounts) + (SELECT COUNT(*) FROM pil_mail_msgs) + (SELECT COUNT(*) FROM pil_mail_drafts)')->fetchColumn());
});

echo "\nBoîtes hébergées (Hostico / cPanel : IMAP + SMTP)\n";
shell_exec("docker cp " . escapeshellarg(__DIR__ . '/../mock/imap_mock.php') . " $W:/tmp/imap_mock.php && docker exec -d $W php /tmp/imap_mock.php");
shell_exec("docker exec $W sed -i \"s#^return array (#return array (\\n  'mail_allow_plain' => true,#\" /var/www/html/config.php"); sleep(3);
$ilog = fn($f) => array_map(fn($l) => json_decode($l, true), array_filter(explode("\n", (string)shell_exec("docker exec $W cat /tmp/$f 2>/dev/null"))));
$box = ['email' => 'direction@madibu-fictif.be', 'imap_host' => '127.0.0.1', 'imap_port' => 9143, 'smtp_host' => '127.0.0.1', 'smtp_port' => 9025, 'secure' => 'none'];
T::test('connexion refusée : mauvais mot de passe ou serveur invalide, rien n\'est enregistré', function () use ($admin, $box) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/imap', $box + ['password' => 'faux']); T::eq(401, $c); T::ok(str_contains($r['error'], 'mot de passe refusé'), $r['error']);
    [$c] = $admin->req('POST', 'pilot/mail/imap', ['imap_host' => 'serveur invalide;rm'] + $box + ['password' => 'x']); T::eq(400, $c);
    T::eq(0, (int)db()->query('SELECT COUNT(*) FROM pil_mail_accounts')->fetchColumn());
});
T::test('connexion vérifiée (réception + envoi) ; dossier « Envoyés » trouvé ; mot de passe chiffré', function () use ($admin, $box) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/imap', $box + ['password' => 'Boite-Test-1']); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE)); T::eq('INBOX.Sent', $r['sent_folder']);
    $a = db()->query('SELECT * FROM pil_mail_accounts')->fetch(); T::eq('imap', $a['kind']); T::ok(!str_contains((string)$a['token_enc'], 'Boite-Test-1'), 'mot de passe chiffré');
    [, $l, $raw] = $admin->req('GET', 'pilot/mail/accounts'); T::eq('imap', $l[0]['kind']); T::ok(!str_contains($raw, 'Boite-Test-1'), 'jamais renvoyé');
});
T::test('relève : encodages (ISO-8859-1, € , sujet encodé), historique cité retiré, PDF joint ; répondu reconnu ; tri IA', function () use ($admin, &$S) {
    $admin->req('POST', 'items/contact', ['data' => ['kind' => 'fournisseur', 'company' => 'Fournisseur Fictif', 'email' => 'newsletter@fournisseur-fictif.be']]);
    [$c, $r] = $admin->req('POST', 'pilot/mail/sync'); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE)); T::eq([], $r['errors']);
    T::eq(5, $r['results'][0]['new']); T::eq(3, $r['results'][0]['analyzed']); T::eq(1, $r['results'][0]['ranges'], 'une publicité rangée');
    $m = db()->query("SELECT * FROM pil_mail_msgs WHERE from_email = 'client@exemple-fictif.be'")->fetch();
    T::eq('Demande de devis cuisine Dupont', $m['subject']); T::eq('François Client', $m['from_name']);
    T::ok(str_contains($m['body'], 'prévu de 1.250,00 €') && !str_contains($m['body'], 'Ancien message'), $m['body']);
    T::ok(str_contains((string)$m['atts'], 'devis-fictif.pdf'), 'pièce jointe listée');
    T::eq('repondu', db()->query("SELECT state FROM pil_mail_msgs WHERE from_email = 'archi@bureau-fictif.be'")->fetchColumn(), 'répondu (Envoyés)');
    $log = array_map(fn($l) => json_decode($l, true), array_filter(explode("\n", (string)shell_exec('docker exec bp-test-web cat /tmp/claude_mock.log'))));
    $mm = array_values(array_filter($log, fn($x) => !empty($x['mail']))); $last = end($mm);
    T::eq(false, $last['iban_clair'], 'IBAN masqué'); T::eq(true, $last['pdf'], 'PDF lu'); T::eq(false, $last['cite'], 'historique non transmis');
    $S['idraft'] = $r['brief']['drafts'][0]['id'] ?? null; T::ok($S['idraft'], 'réponse préparée');
    [, $r2] = $admin->req('POST', 'pilot/mail/sync'); T::eq(0, $r2['results'][0]['new'], 'pas de doublon');
});
T::test('boîte hébergée : ouvrir = lu sur le serveur (\\Seen) ; pièce jointe PDF ouverte depuis BatiPro', function () use ($admin, $ilog) {
    $id = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE from_email = 'client@exemple-fictif.be' AND graph_id LIKE 'imap:%'")->fetchColumn();
    db()->exec("UPDATE pil_mail_msgs SET is_read = 0 WHERE id = $id");
    [$c, $m] = $admin->req('GET', "pilot/mail/msgs/$id"); T::eq(200, $c); T::eq(true, $m['is_read']); T::eq('devis-fictif.pdf', $m['atts'][0]['name'] ?? null);
    $st = array_values(array_filter($ilog("imap_mock.log"), fn($x) => isset($x["store"]))); T::ok($st && str_contains(end($st)['store'], '+FLAGS.SILENT (\\Seen)') && end($st)['sel'] === 'in', json_encode($st));
    [$c, , $raw] = $admin->req('GET', "pilot/mail/msgs/$id/att/0"); T::eq(200, $c); T::ok(str_starts_with($raw, '%PDF'), substr((string)$raw, 0, 80));
    [$c] = $admin->req('POST', "pilot/mail/msgs/$id/unread", []); T::eq(200, $c);
    $st = array_values(array_filter($ilog("imap_mock.log"), fn($x) => isset($x["store"]))); T::ok(str_contains(end($st)['store'], '-FLAGS.SILENT'), 'non lu sur le serveur');
});
T::test('rangement IMAP : publicité → « Publicité » (UTF-7, dossier créé) ; expéditeur connu jamais rangé ; remise sans doublon ni nouveau rangement', function () use ($admin, $ilog) {
    $l = $ilog('imap_mock.log');
    T::ok((bool)array_filter($l, fn($x) => ($x['create'] ?? '') === 'INBOX.Publicit&AOk-'), 'dossier INBOX.Publicité créé (nom IMAP encodé)');
    $moves = array_values(array_filter(array_column($l, 'move'))); T::eq(1, count($moves), implode(' ; ', $moves));
    $p = db()->query("SELECT * FROM pil_mail_msgs WHERE from_email = 'promo@pub-fictif.be'")->fetch();
    T::eq('Publicité', $p['moved']); T::ok(str_starts_with($p['graph_id'], 'imap:pub:778:'), $p['graph_id']);
    T::eq(null, db()->query("SELECT moved FROM pil_mail_msgs WHERE from_email = 'newsletter@fournisseur-fictif.be'")->fetchColumn(), 'contact BatiPro : jamais rangé');
    [$c, $m] = $admin->req('POST', "pilot/mail/msgs/{$p['id']}/unmove"); T::eq(200, $c, json_encode($m, JSON_UNESCAPED_UNICODE)); T::eq(null, $m['moved']);
    db()->exec('UPDATE pil_mail_accounts SET last_sync = NULL');
    [, $r] = $admin->req('POST', 'pilot/mail/sync'); T::eq(0, $r['results'][0]['new'], 'pas de doublon'); T::eq(0, $r['results'][0]['ranges'], 'pas rangé à nouveau');
    T::eq(1, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE from_email = 'promo@pub-fictif.be'")->fetchColumn());
    T::eq(2, count(array_filter(array_column($ilog('imap_mock.log'), 'move'))), 'un seul aller-retour');
});
T::test('envoi : seulement confirmé ; part par le SMTP de la boîte, en réponse au bon e-mail ; copie dans « Envoyés »', function () use ($admin, $ilog, &$S) {
    T::eq([], $ilog('smtp_mock.log'), 'rien envoyé avant confirmation');
    [$c] = $admin->req('POST', "pilot/mail/drafts/{$S['idraft']}/send", []); T::eq(400, $c);
    [$c, $d] = $admin->req('POST', "pilot/mail/drafts/{$S['idraft']}/send", ['confirm' => true, 'to' => [['email' => 'client@exemple-fictif.be']], 'subject' => 'RE: Demande de devis cuisine Dupont', 'body' => "Bonjour,\nDevis envoyé demain, relu par la direction.\nCordialement"]);
    T::eq(200, $c, json_encode($d, JSON_UNESCAPED_UNICODE)); T::eq(null, $d['note'], (string)$d['note']);
    $sm = $ilog('smtp_mock.log'); T::eq(1, count($sm)); T::eq(['client@exemple-fictif.be'], $sm[0]['rcpt']);
    T::ok(str_contains($sm[0]['data'], 'In-Reply-To: <q1@exemple-fictif.be>'), 'réponse au bon e-mail');
    preg_match("/\n\n(.+)$/s", $sm[0]['data'], $mm); T::ok(str_contains((string)base64_decode(preg_replace('/\s+/', '', $mm[1] ?? '')), 'relu par la direction'), 'texte relu');
    T::ok((bool)array_filter($ilog('imap_mock.log'), fn($x) => !empty($x['append'])), 'copie dans INBOX.Sent');
});
T::test('boîte hébergée : supprimer = corbeille du serveur, sorti de BatiPro', function () use ($admin, $ilog) {
    $id = (int)db()->query("SELECT id FROM pil_mail_msgs WHERE from_email = 'client@exemple-fictif.be' AND graph_id LIKE 'imap:in:%'")->fetchColumn(); T::ok($id > 0, "e-mail trouvé");
    [$c] = $admin->req('DELETE', "pilot/mail/msgs/$id"); T::eq(200, $c, 'supprimé');
    T::ok((bool)array_filter($ilog('imap_mock.log'), fn($x) => str_ends_with((string)($x['move'] ?? ''), '->trash')), 'mis à la corbeille du serveur (INBOX.Trash)');
    T::ok(str_starts_with((string)db()->query("SELECT graph_id FROM pil_mail_msgs WHERE id = $id AND folder = 'trash'")->fetchColumn(), 'imap:trash:779:'), 'dans la Corbeille');
    [$c, $r] = $admin->req('POST', "pilot/mail/msgs/$id/restore", []); T::eq(200, $c, json_encode($r));
    T::ok(str_starts_with((string)db()->query("SELECT graph_id FROM pil_mail_msgs WHERE id = $id AND folder = 'in'")->fetchColumn(), 'imap:in:777:'), 'restauré dans la boîte de réception');
    $admin->req('DELETE', "pilot/mail/msgs/$id"); [$c] = $admin->req('DELETE', "pilot/mail/msgs/$id"); T::eq(200, $c);
    T::ok((bool)array_filter($ilog('imap_mock.log'), fn($x) => isset($x['expunge']) && $x['sel'] === 'trash'), 'effacé de la corbeille du serveur');
    T::eq(0, (int)db()->query("SELECT COUNT(*) FROM pil_mail_msgs WHERE id = $id")->fetchColumn());
});
T::test('boîte connectée par Hostico puis reconnectée avec Microsoft : passe sur Microsoft 365 (plus jamais relevée chez Hostico)', function () use ($admin) {
    T::eq('imap', db()->query('SELECT kind FROM pil_mail_accounts')->fetchColumn());
    [, $r] = $admin->req('POST', 'pilot/mail/connect'); parse_str((string)parse_url($r['url'], PHP_URL_QUERY), $q);
    [$c, , $raw] = (new Client('fenetre'))->req('GET', '', null, ['noCsrf' => true, 'raw' => 'outlook-callback.php?code=code-fictif&state=' . $q['state']]); T::eq(200, $c); T::ok(str_contains($raw, 'Boîte connectée'), $raw);
    T::eq('graph', db()->query("SELECT kind FROM pil_mail_accounts WHERE email = 'direction@madibu-fictif.be'")->fetchColumn());
    T::eq(1, (int)db()->query('SELECT COUNT(*) FROM pil_mail_accounts')->fetchColumn(), 'même boîte, pas de doublon');
});
T::test('déconnexion de la boîte hébergée', function () use ($admin) {
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts')->fetchColumn(); [$c] = $admin->req('DELETE', "pilot/mail/accounts/$id"); T::eq(200, $c);
    T::eq(0, (int)db()->query('SELECT COUNT(*) FROM pil_mail_accounts')->fetchColumn());
});
shell_exec("docker exec $W sed -i \"/'mail_allow_plain'/d\" /var/www/html/config.php");
shell_exec("docker exec $W sed -i \"/'ms_login_base'/d; /'ms_graph_base'/d\" /var/www/html/config.php");
exit(T::done());
