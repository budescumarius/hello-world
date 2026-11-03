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
    T::eq(true, $g['hasSecret']); T::ok(!str_contains($raw, 'secret-fictif'), 'secret absent de la réponse'); T::ok(str_contains($g['redirect'], 'api.php?r=pilot/mail/callback'), $g['redirect']);
    T::ok(!str_contains((string)db()->query("SELECT v FROM settings WHERE k = 'pilotage_mail'")->fetchColumn(), 'secret-fictif'), 'secret chiffré en base');
});
T::test('connexion : adresse Microsoft avec PKCE et « state » ; un « state » falsifié est refusé', function () use ($admin) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/connect'); T::eq(200, $c);
    parse_str((string)parse_url($r['url'], PHP_URL_QUERY), $q);
    T::eq('11111111-2222-3333-4444-555555555555', $q['client_id']); T::eq('S256', $q['code_challenge_method']); T::ok(strlen($q['state']) === 32 && str_contains($q['scope'], 'Mail.Send'), 'state / scope');
    T::ok(str_contains($r['url'], '/madibu-fictif.be/oauth2/v2.0/authorize'), $r['url']);
    [$c] = $admin->req('GET', 'pilot/mail/callback&code=code-fictif&state=faux', null, ['noCsrf' => true]); T::eq(302, $c);
    T::eq(0, (int)db()->query('SELECT COUNT(*) FROM pil_mail_accounts')->fetchColumn(), 'aucune boîte connectée');
});
T::test('connexion acceptée : boîte enregistrée, jetons chiffrés (jamais en clair en base)', function () use ($admin) {
    [, $r] = $admin->req('POST', 'pilot/mail/connect'); parse_str((string)parse_url($r['url'], PHP_URL_QUERY), $q);
    [$c] = $admin->req('GET', 'pilot/mail/callback&code=code-fictif&state=' . $q['state'], null, ['noCsrf' => true]); T::eq(302, $c);
    $a = db()->query('SELECT * FROM pil_mail_accounts')->fetch();
    T::eq('direction@madibu-fictif.be', $a['email'] ?? null); T::ok(!str_contains($a['token_enc'], 'rafraichi') && !str_contains($a['token_enc'], 'acces-1'), 'jetons chiffrés');
    [, $l] = $admin->req('GET', 'pilot/mail/accounts'); T::eq(1, count($l)); T::ok(!isset($l[0]['token_enc']), 'jetons jamais envoyés au navigateur');
});
T::test('relève : réception + envoyés ; e-mail déjà répondu dans Outlook reconnu ; tri par l\'IA', function () use ($admin, &$S) {
    [$c, $r] = $admin->req('POST', 'pilot/mail/sync'); T::eq(200, $c, json_encode($r, JSON_UNESCAPED_UNICODE));
    T::eq(4, $r['results'][0]['new']); T::eq(2, $r['results'][0]['analyzed']);
    T::eq('repondu', db()->query("SELECT state FROM pil_mail_msgs WHERE graph_id = 'AAA3'")->fetchColumn(), 'répondu depuis Outlook');
    T::ok(!str_contains((string)db()->query("SELECT body FROM pil_mail_msgs WHERE graph_id = 'AAA1'")->fetchColumn(), 'Ancien message cité'), 'historique cité retiré');
    $S['brief'] = $r['brief'];
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
    T::ok(str_contains(json_decode($s[0]['body'], true)['comment'], 'Texte relu et corrigé'), 'texte relu envoyé');
    T::eq('repondu', db()->query("SELECT state FROM pil_mail_msgs WHERE graph_id = 'AAA1'")->fetchColumn());
    T::ok((bool)db()->query("SELECT id FROM pil_audit WHERE action = 'email_envoye'")->fetch(), 'journal d\'audit');
    [$c] = $admin->req('POST', "pilot/mail/drafts/{$S['draft']}/send", ['confirm' => true]); T::eq(409, $c, 'pas deux fois');
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
T::test('déconnexion : boîte, e-mails relevés et brouillons effacés de BatiPro', function () use ($admin) {
    $id = (int)db()->query('SELECT id FROM pil_mail_accounts')->fetchColumn();
    [$c] = $admin->req('DELETE', "pilot/mail/accounts/$id"); T::eq(200, $c);
    T::eq(0, (int)db()->query('SELECT (SELECT COUNT(*) FROM pil_mail_accounts) + (SELECT COUNT(*) FROM pil_mail_msgs) + (SELECT COUNT(*) FROM pil_mail_drafts)')->fetchColumn());
});
shell_exec("docker exec $W sed -i \"/'ms_login_base'/d; /'ms_graph_base'/d\" /var/www/html/config.php");
exit(T::done());
