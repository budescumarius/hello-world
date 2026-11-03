<?php
// Faux Microsoft (connexion OAuth + Graph) pour les tests : aucune donnée ne sort de l'instance de test. Données 100 % fictives.
// Lancé dans le conteneur de test : php -S 127.0.0.1:9091 graph_mock.php
// config.php de test : 'ms_login_base' => 'http://127.0.0.1:9091/login', 'ms_graph_base' => 'http://127.0.0.1:9091/v1.0'
$u = parse_url($_SERVER['REQUEST_URI']); $path = $u['path']; parse_str($u['query'] ?? '', $qs);
$raw = (string)file_get_contents('php://input');
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
file_put_contents(sys_get_temp_dir() . '/graph_mock.log', json_encode(['m' => $_SERVER['REQUEST_METHOD'], 'p' => $path, 'auth' => $auth !== '', 'body' => $raw]) . "\n", FILE_APPEND);
$json = function ($v, int $code = 200) { http_response_code($code); header('Content-Type: application/json'); echo json_encode($v); exit; };
if (str_ends_with($path, '/oauth2/v2.0/token')) {
    parse_str($raw, $f);
    if (($f['grant_type'] ?? '') === 'authorization_code' && ($f['code'] ?? '') === 'code-fictif' && !empty($f['code_verifier']) && ($f['client_secret'] ?? '') === 'secret-fictif')
        $json(['access_token' => 'acces-1', 'refresh_token' => 'rafraichi-1', 'expires_in' => 3600]);
    if (($f['grant_type'] ?? '') === 'refresh_token' && ($f['refresh_token'] ?? '') === 'rafraichi-1') $json(['access_token' => 'acces-2', 'refresh_token' => 'rafraichi-1', 'expires_in' => 3600]);
    $json(['error' => 'invalid_grant', 'error_description' => 'code refusé'], 400);
}
if (!preg_match('/^Bearer acces-\d$/', $auth)) $json(['error' => ['message' => 'jeton absent']], 401);
$g = '/v1.0';
$stf = sys_get_temp_dir() . '/graph_state.json'; $state = is_file($stf) ? json_decode((string)file_get_contents($stf), true) : ['moved' => [], 'folder' => null];
$save = function () use (&$state, $stf) { file_put_contents($stf, json_encode($state)); };
if ($path === "$g/me/mailFolders" && $_SERVER['REQUEST_METHOD'] === 'GET') $json(['value' => $state['folder'] ? [['id' => 'F-PUB', 'displayName' => 'Publicité']] : []]);
if ($path === "$g/me/mailFolders" && $_SERVER['REQUEST_METHOD'] === 'POST') { $state['folder'] = json_decode($raw, true)['displayName'] ?? ''; $save(); $json(['id' => 'F-PUB', 'displayName' => $state['folder']], 201); }
if (preg_match("#^$g/me/messages/([^/]+)/move$#", $path, $mv) && $_SERVER['REQUEST_METHOD'] === 'POST') { $to = json_decode($raw, true)['destinationId'] ?? ''; if ($to === 'F-PUB') $state['moved'][] = $mv[1]; else $state['moved'] = array_values(array_diff($state['moved'], [preg_replace('/^MOVED-/', '', $mv[1])])); $save(); $json(['id' => $to === 'F-PUB' ? 'MOVED-' . $mv[1] : preg_replace('/^MOVED-/', '', $mv[1])], 201); }
if ($path === "$g/me") $json(['displayName' => 'Direction Fictive', 'mail' => 'direction@madibu-fictif.be', 'userPrincipalName' => 'direction@madibu-fictif.be']);
$now = time();
$msg = fn($id, $conv, $from, $name, $subj, $body, $ago, $att = false) => ['id' => $id, 'conversationId' => $conv, 'subject' => $subj, 'from' => ['emailAddress' => ['address' => $from, 'name' => $name]],
    'toRecipients' => [['emailAddress' => ['address' => 'direction@madibu-fictif.be', 'name' => 'Direction']]], 'ccRecipients' => [], 'receivedDateTime' => gmdate('Y-m-d\TH:i:s\Z', $now - $ago),
    'bodyPreview' => mb_substr($body, 0, 120), 'body' => ['contentType' => 'text', 'content' => $body], 'hasAttachments' => $att, 'isRead' => false, 'webLink' => "https://outlook.office.com/mail/fictif/$id"];
if ($path === "$g/me/mailFolders/inbox/messages") $json(['value' => array_values(array_filter([
    $msg('AAA1', 'C1', 'client@exemple-fictif.be', 'Client Fictif', 'Demande de devis cuisine Dupont', "Bonjour,\nPouvez-vous nous envoyer le devis pour la cuisine avant vendredi ? Acompte prévu de 1.250,00 €.\nVirement depuis BE68 5390 0754 7034.\n\nDe : MADIBU\nEnvoyé : lundi\nAncien message cité", 3600 * 5, true),
    $msg('AAA2', 'C2', 'promo@pub-fictif.be', 'Promo Fictive', 'Soldes -30 % sur l\'outillage', 'Profitez de nos promotions.', 3600 * 30),
    $msg('AAA3', 'C3', 'archi@bureau-fictif.be', 'Architecte Fictif', 'Plans modifiés', 'Voici les plans modifiés.', 3600 * 72),
], fn($m) => !in_array($m['id'], $state['moved'], true)))]);
if ($path === "$g/me/mailFolders/sentitems/messages") $json(['value' => [['id' => 'SSS3', 'conversationId' => 'C3', 'subject' => 'RE: Plans modifiés', 'toRecipients' => [['emailAddress' => ['address' => 'archi@bureau-fictif.be']]], 'sentDateTime' => gmdate('Y-m-d\TH:i:s\Z', $now - 3600 * 48)]]]);
if ($path === "$g/me/messages/AAA1/attachments") $json(['value' => [['id' => 'P1', 'name' => 'devis-fictif.pdf', 'contentType' => 'application/pdf', 'size' => 400, 'isInline' => false]]]);
if ($path === "$g/me/messages/AAA1/attachments/P1") $json(['id' => 'P1', 'name' => 'devis-fictif.pdf', 'contentBytes' => base64_encode("%PDF-1.4\n% devis fictif 1.250,00\n%%EOF")]);
if (preg_match("#^$g/me/messages/[^/]+/attachments$#", $path)) $json(['value' => []]);
if (preg_match("#^$g/me/messages/([^/]+)/reply$#", $path) && $_SERVER['REQUEST_METHOD'] === 'POST') { http_response_code(202); exit; }
if ($path === "$g/me/sendMail" && $_SERVER['REQUEST_METHOD'] === 'POST') { http_response_code(202); exit; }
$json(['error' => ['message' => "route fictive inconnue $path"]], 404);
