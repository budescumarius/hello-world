<?php
// PILOTAGE MADIBU – boîtes Outlook (Microsoft 365) : lecture, briefing, réponses préparées.
// Principes :
//  - connexion par « Se connecter avec Microsoft » (OAuth 2.0, Microsoft Graph) : BatiPro ne voit jamais le mot de passe ;
//    jetons chiffrés (AES-256-GCM, clé dans pilotage/.mail-key.php, hors base de données) ;
//  - une boîte n'est visible QUE par l'utilisateur BatiPro qui l'a connectée ;
//  - l'IA lit (texte nettoyé, IBAN masqués, PDF joints) et PRÉPARE : catégorie, urgence, action, chantier, brouillon de réponse ;
//  - AUCUN e-mail ne part sans que l'utilisateur ait relu le brouillon et cliqué « Envoyer » (journalisé) ; l'IA n'a aucun moyen d'envoyer ;
//  - site de test (config.php : test_mode) : rien ne part (envoi simulé).
declare(strict_types=1);

const PIL_MAIL_SCOPES = 'offline_access openid profile email User.Read Mail.ReadWrite Mail.Send'; // ReadWrite : ranger (déplacer) les publicités
const PIL_MAIL_PUB = 'Publicité'; // dossier où sont rangées automatiquement les publicités et newsletters
const PIL_MAIL_CATS = ['client' => 'Client', 'fournisseur' => 'Fournisseur / sous-traitant', 'architecte' => 'Architecte / bureau d\'études', 'administration' => 'Administration / social / fiscal',
    'banque' => 'Banque / assurance / leasing', 'interne' => 'Interne (équipe)', 'publicite' => 'Publicité / newsletter', 'autre' => 'Autre'];
const PIL_MAIL_KEEP_DAYS = 60;

function pil_mail_schema(): void {
    static $done = false; if ($done) return; $done = true;
    if (q("SHOW TABLES LIKE 'pil_mail_drafts'")->fetch()) { pil_mail_migrate(); return; }
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_mail_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, user_id INT NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(190) NULL,
        token_enc TEXT NULL, expires_at INT NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'ok', last_sync DATETIME NULL, last_error VARCHAR(500) NULL,
        created_at DATETIME NOT NULL, UNIQUE KEY company_email (company_id, email), KEY company_user (company_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_mail_msgs (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, account_id INT NOT NULL, graph_id VARCHAR(255) NOT NULL, conv_id VARCHAR(255) NULL, folder VARCHAR(8) NOT NULL,
        from_email VARCHAR(190) NULL, from_name VARCHAR(190) NULL, to_json TEXT NULL, subject VARCHAR(500) NULL, at DATETIME NOT NULL, preview VARCHAR(400) NULL, body MEDIUMTEXT NULL,
        atts TEXT NULL, web_link VARCHAR(1000) NULL, is_read TINYINT NOT NULL DEFAULT 0, analysis TEXT NULL, analyzed_at DATETIME NULL, state VARCHAR(10) NOT NULL DEFAULT 'nouveau',
        project_id INT NULL, done_by INT NULL, done_at DATETIME NULL, created_at DATETIME NOT NULL,
        UNIQUE KEY account_graph (account_id, graph_id(190)), KEY company_account_at (company_id, account_id, at), KEY conv (account_id, conv_id(190))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_mail_drafts (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, account_id INT NOT NULL, msg_id INT NULL, to_json TEXT NOT NULL, cc_json TEXT NULL, subject VARCHAR(500) NOT NULL,
        body MEDIUMTEXT NOT NULL, origin VARCHAR(12) NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'brouillon', check_json TEXT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
        sent_at DATETIME NULL, sent_by INT NULL, note VARCHAR(500) NULL, KEY company_account (company_id, account_id, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    pil_mail_migrate();
}
// boîtes hébergées (IMAP) : colonnes ajoutées sans toucher aux données existantes
function pil_mail_migrate(): void {
    if (!q("SHOW COLUMNS FROM pil_mail_accounts LIKE 'kind'")->fetch()) db()->exec("ALTER TABLE pil_mail_accounts ADD kind VARCHAR(8) NOT NULL DEFAULT 'graph' AFTER user_id");
    if (!q("SHOW COLUMNS FROM pil_mail_msgs LIKE 'msg_ref'")->fetch()) db()->exec('ALTER TABLE pil_mail_msgs ADD msg_ref TEXT NULL AFTER conv_id');
    if (!q("SHOW COLUMNS FROM pil_mail_msgs LIKE 'moved'")->fetch()) db()->exec('ALTER TABLE pil_mail_msgs ADD moved VARCHAR(120) NULL, ADD keep_in TINYINT NOT NULL DEFAULT 0');
    if (!q("SHOW COLUMNS FROM pil_mail_accounts LIKE 'opts'")->fetch()) db()->exec('ALTER TABLE pil_mail_accounts ADD opts TEXT NULL');
    // Les identifiants Microsoft distinguent majuscules et minuscules (…AbC ≠ …abc) : comparés sans en tenir compte, un nouvel e-mail
    // était pris pour un ancien (ignoré à la relève, « ✓ » au diagnostic). Comparaison exacte (binaire), sans toucher aux données.
    $col = q("SHOW FULL COLUMNS FROM pil_mail_msgs LIKE 'graph_id'")->fetch();
    if ($col && !str_ends_with((string)($col['Collation'] ?? ''), '_bin')) {
        db()->exec('ALTER TABLE pil_mail_msgs MODIFY graph_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, MODIFY conv_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL');
        foreach (q("SELECT id, opts FROM pil_mail_accounts WHERE kind = 'graph'")->fetchAll() as $a) { // relire 14 jours : rattraper les e-mails ignorés
            $o = json_decode((string)$a['opts'], true) ?: []; unset($o['since_utc']); q('UPDATE pil_mail_accounts SET opts = ? WHERE id = ?', [json_encode($o), $a['id']]); }
    }
    db()->exec('CREATE TABLE IF NOT EXISTS pil_mail_oauth (state CHAR(32) PRIMARY KEY, company_id INT NOT NULL, user_id INT NOT NULL, verifier VARCHAR(100) NOT NULL, created_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

// --------------------------------------------------------------------- Chiffrement des jetons (clé hors base de données)
function pil_mail_key(): string {
    static $k = null; if ($k !== null) return $k;
    $f = __DIR__ . '/.mail-key.php';
    if (!is_file($f)) {
        $new = base64_encode(random_bytes(32));
        if (@file_put_contents($f, "<?php\n// Clé de chiffrement des connexions Outlook (ne pas supprimer : sinon, reconnecter les boîtes)\nreturn '$new';\n", LOCK_EX) === false) throw new PilError('Impossible de créer la clé de chiffrement (dossier pilotage/ non accessible en écriture).', 500);
        @chmod($f, 0600);
    }
    $v = include $f;
    $k = base64_decode((string)$v, true);
    if (!$k || strlen($k) !== 32) throw new PilError('Clé de chiffrement invalide (pilotage/.mail-key.php).', 500);
    return $k;
}
function pil_mail_enc(array $v): string {
    $iv = random_bytes(12); $tag = '';
    $c = openssl_encrypt(json_encode($v), 'aes-256-gcm', pil_mail_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $c);
}
function pil_mail_dec(?string $s): ?array {
    if (!$s) return null; $b = base64_decode($s, true); if ($b === false || strlen($b) < 29) return null;
    $p = openssl_decrypt(substr($b, 28), 'aes-256-gcm', pil_mail_key(), OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
    return $p === false ? null : (json_decode($p, true) ?: null);
}

// --------------------------------------------------------------------- Application Microsoft (Entra ID) : réglage du propriétaire
function pil_mail_conf(): array { return setting('pilotage_mail', []) ?: []; }
function pil_mail_ready(): bool { $c = pil_mail_conf(); return !empty($c['clientId']) && !empty($c['secret']); }
// adresses Microsoft (remplacées par un faux serveur uniquement dans config.php de l'instance de test)
function pil_ms_login(): string { return rtrim((string)(config()['ms_login_base'] ?? 'https://login.microsoftonline.com'), '/'); }
function pil_ms_graph(): string { return rtrim((string)(config()['ms_graph_base'] ?? 'https://graph.microsoft.com/v1.0'), '/'); }
function pil_mail_redirect(): string {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    $dir = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api.php'))), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir . '/outlook-callback.php'; // sans « ? » (exigé par Microsoft)
}
function pil_http(string $method, string $url, array $headers, $body = null, bool $form = false): array {
    $ch = curl_init($url);
    $h = $headers;
    if ($body !== null) { $data = $form ? http_build_query($body) : json_encode($body, JSON_UNESCAPED_UNICODE); $h[] = 'Content-Type: ' . ($form ? 'application/x-www-form-urlencoded' : 'application/json'); curl_setopt($ch, CURLOPT_POSTFIELDS, $data); }
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 45, CURLOPT_CONNECTTIMEOUT => 10]);
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch); curl_close($ch);
    if ($r === false) throw new PilError('Microsoft injoignable : ' . $err, 502);
    return [$code, json_decode((string)$r, true) ?? [], (string)$r];
}
function pil_ms_token(array $params): array {
    $c = pil_mail_conf();
    [$code, $j] = pil_http('POST', pil_ms_login() . '/' . rawurlencode((string)($c['tenant'] ?? '') ?: 'organizations') . '/oauth2/v2.0/token', [],
        ['client_id' => $c['clientId'], 'client_secret' => pil_mail_dec($c['secret'])['s'] ?? '', 'scope' => PIL_MAIL_SCOPES] + $params, true);
    if (($code !== 200 || empty($j['access_token'])) && ($params['grant_type'] ?? '') === 'refresh_token') {
        [$code, $j] = pil_http('POST', pil_ms_login() . '/' . rawurlencode((string)($c['tenant'] ?? '') ?: 'organizations') . '/oauth2/v2.0/token', [],
            ['client_id' => $c['clientId'], 'client_secret' => pil_mail_dec($c['secret'])['s'] ?? '', 'scope' => 'offline_access User.Read Mail.Read Mail.Send'] + $params, true);
    }
    if ($code !== 200 || empty($j['access_token'])) throw new PilError('Connexion Microsoft refusée : ' . mb_substr((string)($j['error_description'] ?? $j['error'] ?? "HTTP $code"), 0, 300), 502);
    return $j;
}
/** Jeton d'accès valide d'une boîte (renouvelé si besoin). */
function pil_mail_access(array $acc): string {
    static $mem = [];
    if (isset($mem[$acc['id']]) && $mem[$acc['id']][1] > time() + 120) return $mem[$acc['id']][0];
    $acc = q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch() ?: $acc; // jeton le plus récent (une autre relève a pu le renouveler)
    $t = pil_mail_dec($acc['token_enc']);
    if (!$t) throw new PilError('Connexion à reconnecter (jeton illisible).', 401);
    if (!empty($t['access']) && (int)$acc['expires_at'] > time() + 120) { $mem[$acc['id']] = [(string)$t['access'], (int)$acc['expires_at']]; return (string)$t['access']; }
    try { $j = pil_ms_token(['grant_type' => 'refresh_token', 'refresh_token' => $t['refresh'] ?? '']); }
    catch (PilError $e) { q("UPDATE pil_mail_accounts SET status = 'reconnect', last_error = ? WHERE id = ?", [mb_substr($e->getMessage(), 0, 500), $acc['id']]); throw new PilError('Boîte ' . $acc['email'] . ' : reconnectez-la (' . $e->getMessage() . ').', 401); }
    q('UPDATE pil_mail_accounts SET token_enc = ?, expires_at = ?, status = ? WHERE id = ?', [pil_mail_enc(['access' => $j['access_token'], 'refresh' => $j['refresh_token'] ?? ($t['refresh'] ?? '')]), time() + (int)($j['expires_in'] ?? 3600), 'ok', $acc['id']]);
    $mem[$acc['id']] = [(string)$j['access_token'], time() + (int)($j['expires_in'] ?? 3600)];
    return (string)$j['access_token'];
}
function pil_graph(array $acc, string $method, string $path, $body = null): array {
    $url = str_starts_with($path, 'http') ? $path : pil_ms_graph() . $path;
    // sécurité : jamais le jeton vers une autre adresse que Microsoft Graph (liens « nextLink » compris)
    if (!str_starts_with($url, pil_ms_graph() . '/')) throw new PilError('Adresse Microsoft inattendue.', 502);
    [$code, $j, $raw] = pil_http($method, $url, ['Authorization: Bearer ' . pil_mail_access($acc), 'Prefer: outlook.body-content-type="text"'], $body);
    if ($code >= 400) throw new PilError('Outlook : ' . mb_substr((string)($j['error']['message'] ?? "HTTP $code"), 0, 300), $code === 401 ? 401 : 502);
    return $j;
}

// --------------------------------------------------------------------- Connexion d'une boîte
function pil_mail_connect_url(array $me): string {
    if (!pil_mail_ready()) throw new PilError('Connexion Outlook pas encore configurée : le propriétaire doit enregistrer l\'application Microsoft (Paramètres → Outlook).', 400);
    $c = pil_mail_conf();
    $verifier = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    $state = bin2hex(random_bytes(16));
    q('INSERT INTO pil_mail_oauth (state, company_id, user_id, verifier, created_at) VALUES (?,?,?,?,?)', [$state, cid(), (int)$me['id'], $verifier, now()]);
    return pil_ms_login() . '/' . rawurlencode((string)($c['tenant'] ?? '') ?: 'organizations') . '/oauth2/v2.0/authorize?' . http_build_query([
        'client_id' => $c['clientId'], 'response_type' => 'code', 'redirect_uri' => pil_mail_redirect(), 'response_mode' => 'query', 'scope' => PIL_MAIL_SCOPES,
        'state' => $state, 'prompt' => 'select_account', 'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='), 'code_challenge_method' => 'S256']);
}
/**
 * Retour de Microsoft. Fonctionne aussi dans une fenêtre séparée (téléphone, application installée) qui n'a pas la session de BatiPro :
 * la demande est retrouvée par son « state » (aléatoire, à usage unique, 15 minutes), gardé en base.
 * Affiche une petite page : « Boîte connectée » (la fenêtre se ferme et BatiPro se met à jour) ou la raison de l'échec, avec « Retour à BatiPro ».
 */
function pil_mail_callback_public(): void {
    $app = rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/api.php'))), '/') . '/';
    $page = function (bool $ok, string $msg, string $email = '') use ($app) {
        $link = $app . '#/pilotage/emails' . ($ok ? '?connected=' . rawurlencode($email) : '?err=' . rawurlencode($msg));
        header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store');
        $e = fn($s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        echo '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BatiPro</title></head>'
            . '<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;color:#16203a">'
            . '<h2>' . ($ok ? '✓ Boîte connectée' : 'Connexion non faite') . '</h2><p>' . $e($ok ? $email : $msg) . '</p>'
            . '<p><a href="' . $e($link) . '" style="display:inline-block;background:#0f1a3d;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none">Retour à BatiPro</a></p>'
            . '<p style="color:#6b7385;font-size:14px">Vous pouvez aussi fermer cette fenêtre.</p>'
            . '<script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(' . json_encode(['bp' => 'mail', 'ok' => $ok, 'email' => $email, 'msg' => $msg]) . ',location.origin);setTimeout(function(){window.close()},600);}else{setTimeout(function(){location.replace(' . json_encode($link) . ')},' . ($ok ? 900 : 4000) . ');}}catch(e){}</script></body></html>';
        exit;
    };
    pil_mail_schema();
    $st = (string)($_GET['state'] ?? '');
    $s = $st !== '' ? q('SELECT * FROM pil_mail_oauth WHERE state = ?', [$st])->fetch() : null;
    if ($s) q('DELETE FROM pil_mail_oauth WHERE state = ?', [$st]); // usage unique
    q('DELETE FROM pil_mail_oauth WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 3600)]);
    if (!$s || strtotime($s['created_at']) < time() - 900) $page(false, 'Connexion expirée ou invalide : recommencez depuis BatiPro.');
    $GLOBALS['BP_CID'] = (int)$s['company_id'];
    $me = q('SELECT * FROM users WHERE id = ? AND company_id = ? AND active = 1', [(int)$s['user_id'], cid()])->fetch();
    if (!$me) $page(false, 'Utilisateur introuvable.');
    if (!empty($_GET['error'])) $page(false, 'Microsoft : ' . mb_substr((string)($_GET['error_description'] ?? $_GET['error']), 0, 300));
    try {
        $j = pil_ms_token(['grant_type' => 'authorization_code', 'code' => (string)($_GET['code'] ?? ''), 'redirect_uri' => pil_mail_redirect(), 'code_verifier' => (string)$s['verifier']]);
        [$code, $u] = pil_http('GET', pil_ms_graph() . '/me?$select=displayName,mail,userPrincipalName', ['Authorization: Bearer ' . $j['access_token']]);
        $email = mb_strtolower(trim((string)($u['mail'] ?? '') ?: (string)($u['userPrincipalName'] ?? '')));
        if ($code !== 200 || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new PilError('Adresse de la boîte introuvable.', 502);
        $tok = pil_mail_enc(['access' => $j['access_token'], 'refresh' => $j['refresh_token'] ?? '']);
        $ex = q('SELECT id, user_id FROM pil_mail_accounts WHERE company_id = ? AND email = ?', [cid(), $email])->fetch();
        if ($ex && (int)$ex['user_id'] !== (int)$me['id']) $page(false, "La boîte $email est déjà connectée par un autre utilisateur.");
        if ($ex) q("UPDATE pil_mail_accounts SET kind = 'graph', token_enc = ?, expires_at = ?, status = 'ok', last_error = NULL, name = ? WHERE id = ?", [$tok, time() + (int)($j['expires_in'] ?? 3600), mb_substr((string)($u['displayName'] ?? ''), 0, 190), $ex['id']]);
        else q('INSERT INTO pil_mail_accounts (company_id, user_id, email, name, token_enc, expires_at, status, created_at) VALUES (?,?,?,?,?,?,?,?)', [cid(), $me['id'], $email, mb_substr((string)($u['displayName'] ?? ''), 0, 190), $tok, time() + (int)($j['expires_in'] ?? 3600), 'ok', now()]);
        $aid = $ex ? (int)$ex['id'] : (int)db()->lastInsertId();
        pil_audit('boite_mail_connectee', 'mail_account', $aid, null, ['email' => $email], 'utilisateur', (int)$me['id']);
        try { pil_mail_subscribe(q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$aid])->fetch()); } catch (Throwable $e) { error_log('[pilotage mail] abonnement : ' . $e->getMessage()); }
        $page(true, '', $email);
    } catch (Throwable $e) { $page(false, $e->getMessage()); }
}
function pil_mail_accounts(array $me): array {
    return array_map(fn($a) => ['id' => (int)$a['id'], 'kind' => $a['kind'] ?? 'graph', 'autoPub' => pil_mail_opts($a)['autoPub'], 'email' => $a['email'], 'name' => $a['name'], 'status' => $a['status'], 'last_sync' => $a['last_sync'], 'last_error' => $a['last_error']],
        q('SELECT * FROM pil_mail_accounts WHERE company_id = ? AND user_id = ? ORDER BY id', [cid(), $me['id']])->fetchAll());
}
function pil_mail_account(array $me, int $id): array {
    $a = q('SELECT * FROM pil_mail_accounts WHERE id = ? AND company_id = ? AND user_id = ?', [$id, cid(), $me['id']])->fetch();
    if (!$a) fail(404, 'Boîte introuvable');
    return $a;
}

// --------------------------------------------------------------------- Relève (boîte de réception + éléments envoyés)
/** Texte utile d'un e-mail : sans l'historique cité, sans signature trop longue, espaces réduits. */
function pil_mail_clean(string $t): string {
    $t = str_replace("\r", '', $t);
    $cut = preg_split('/\n(?:-{2,}\s*(?:Original Message|Message d\'origine|Oorspronkelijk bericht)|_{5,}|De\s?:\s.+\nEnvoy[ée]\s?:|From:\s.+\nSent:|Van:\s.+\nVerzonden:|Le .{5,80} a écrit\s?:|On .{5,80} wrote:|Op .{5,80} schreef)/iu', $t, 2);
    $t = $cut[0];
    $t = preg_replace("/\n-- \n.*$/s", '', $t);
    $t = preg_replace('/[ \t]+/', ' ', $t); $t = preg_replace("/\n{3,}/", "\n\n", $t);
    return trim(mb_substr($t, 0, 12000));
}
/** IBAN et numéros de carte masqués avant toute analyse IA. */
function pil_mail_mask(string $t): string {
    $t = preg_replace_callback('/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/', fn($m) => substr(preg_replace('/\s/', '', $m[0]), 0, 4) . ' **** **** ' . substr(preg_replace('/\s/', '', $m[0]), -2), $t);
    return preg_replace('/\b(?:\d[ -]?){13,19}\b/', '[numéro masqué]', $t);
}
/** E-mail déjà connu (même Message-ID) revenu dans la boîte de réception : nouvelle adresse, et on ne le range plus. */
function pil_mail_back_in(array $acc, string $mid, string $graphId, ?string $from = null): bool {
    if ($mid === '') return false;
    $id = q("SELECT id FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in' AND msg_ref LIKE ?" . ($from !== null && $from !== '' ? ' AND (from_email = ? OR from_email IS NULL OR from_email = \'\')' : '') . ' LIMIT 1',
        array_merge([$acc['id'], '%"mid":' . addcslashes(json_encode($mid, JSON_UNESCAPED_SLASHES), '%_\\') . '%'], $from !== null && $from !== '' ? [$from] : []))->fetchColumn();
    if (!$id) return false;
    q('UPDATE pil_mail_msgs SET keep_in = IF(moved IS NULL, keep_in, 1), moved = NULL, graph_id = ? WHERE id = ? AND graph_id <> ?', [$graphId, $id, $graphId]); // MySQL : affectations dans l'ordre (keep_in lit l'ancien « moved »)
    return true;
}
function pil_mail_sync(array $acc, bool $deep = false): array {
    if (($acc['kind'] ?? 'graph') === 'imap') { require_once __DIR__ . '/imap.php'; return pil_imap_sync($acc, $deep); }
    // l'heure envoyée à Microsoft doit être en UTC (gmdate) : avec date(), un hébergeur réglé sur un autre fuseau (ex. Bucarest)
    // demandait les e-mails « depuis » une heure trop tardive, et ceux arrivés entre-temps étaient sautés.
    // Marge de 6 h (les doublons sont ignorés) ; une fois, après cette correction, relecture des 14 derniers jours pour rattraper ce qui a été sauté.
    $o = pil_mail_opts($acc);
    if (empty($o['since_utc'])) { $deep = true; $o['since_utc'] = 1; q('UPDATE pil_mail_accounts SET opts = ? WHERE id = ?', [json_encode($o), $acc['id']]); }
    $since = $acc['last_sync'] && !$deep ? gmdate('Y-m-d\TH:i:s\Z', strtotime($acc['last_sync']) - 6 * 3600) : gmdate('Y-m-d\TH:i:s\Z', time() - 14 * 86400);
    $new = 0;
    $t0 = microtime(true); $partial = false;
    foreach (['inbox' => 'receivedDateTime', 'sentitems' => 'sentDateTime'] as $folder => $dt) {
        if (microtime(true) - $t0 > 20) { $partial = true; break; }
        $sel = $folder === 'inbox' ? 'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,isRead,webLink' : 'id,conversationId,subject,toRecipients,ccRecipients,sentDateTime,bodyPreview,body,hasAttachments,webLink';
        $url = "/me/mailFolders/$folder/messages?" . http_build_query(['$top' => 25, '$orderby' => "$dt desc", '$filter' => "$dt ge $since", '$select' => $sel]);
        for ($page = 0; $page < 12 && $url; $page++) {
            if ($page && microtime(true) - $t0 > ($folder === 'inbox' ? 18 : 24)) { $partial = true; break; }
            $j = pil_graph($acc, 'GET', $url);
            foreach ($j['value'] ?? [] as $m) {
                $at = date('Y-m-d H:i:s', strtotime((string)($m[$dt] ?? 'now')));
                $isIn = $folder === 'inbox';
                $from = $isIn ? ($m['from']['emailAddress'] ?? []) : ['address' => $acc['email'], 'name' => $acc['name']];
                $to = array_map(fn($r) => ['email' => mb_strtolower((string)($r['emailAddress']['address'] ?? '')), 'name' => (string)($r['emailAddress']['name'] ?? '')], array_merge($m['toRecipients'] ?? [], $m['ccRecipients'] ?? []));
                $mid = (string)($m['internetMessageId'] ?? '');
                if ($isIn && !q('SELECT id FROM pil_mail_msgs WHERE account_id = ? AND graph_id = ?', [$acc['id'], (string)$m['id']])->fetch() && pil_mail_back_in($acc, $mid, (string)$m['id'], mb_strtolower((string)($from['address'] ?? '')))) {
                    q("UPDATE pil_mail_msgs SET at = ? WHERE account_id = ? AND graph_id = ?", [$at, $acc['id'], (string)$m['id']]); continue; }
                $r = q('INSERT IGNORE INTO pil_mail_msgs (company_id, account_id, graph_id, conv_id, msg_ref, folder, from_email, from_name, to_json, subject, at, preview, body, atts, web_link, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [cid(), $acc['id'], (string)$m['id'], (string)($m['conversationId'] ?? ''), json_encode(['mid' => $mid], JSON_UNESCAPED_SLASHES), $isIn ? 'in' : 'sent', mb_strtolower((string)($from['address'] ?? '')), mb_substr((string)($from['name'] ?? ''), 0, 190),
                     json_encode($to, JSON_UNESCAPED_UNICODE), mb_substr((string)($m['subject'] ?? ''), 0, 500), $at, mb_substr((string)($m['bodyPreview'] ?? ''), 0, 400),
                     pil_mail_clean((string)($m['body']['content'] ?? '')), $isIn && !empty($m['hasAttachments']) ? '[]' : null, mb_substr((string)($m['webLink'] ?? ''), 0, 1000) ?: null, $isIn ? (!empty($m['isRead']) ? 1 : 0) : 1, now()]);
                if ($r->rowCount()) $new++;
                // déjà relevé : lu/non lu, et la date et l'objet de Microsoft font foi (corrige une ligne enregistrée de travers)
                elseif ($isIn) q("UPDATE pil_mail_msgs SET is_read = ?, at = ?, folder = 'in', subject = ? WHERE account_id = ? AND graph_id = ?", [!empty($m['isRead']) ? 1 : 0, $at, mb_substr((string)($m['subject'] ?? ''), 0, 500), $acc['id'], (string)$m['id']]);
            }
            $url = $j['@odata.nextLink'] ?? null;
        }
    }
    // un message auquel on a répondu depuis Outlook ne reste pas « à faire »
    q("UPDATE pil_mail_msgs m JOIN (SELECT conv_id, MAX(at) AS last_sent FROM pil_mail_msgs WHERE account_id = ? AND folder = 'sent' GROUP BY conv_id) s ON s.conv_id = m.conv_id
        SET m.state = 'repondu' WHERE m.account_id = ? AND m.folder = 'in' AND m.state IN ('nouveau', 'a_faire') AND s.last_sent > m.at", [$acc['id'], $acc['id']]);
    q('DELETE FROM pil_mail_msgs WHERE account_id = ? AND at < ?', [$acc['id'], date('Y-m-d H:i:s', time() - PIL_MAIL_KEEP_DAYS * 86400)]);
    q("UPDATE pil_mail_accounts SET last_sync = ?, status = 'ok', last_error = NULL WHERE id = ?", [now(), $acc['id']]);
    return ['new' => $new];
}

// --------------------------------------------------------------------- Analyse IA (prépare, ne décide ni n'envoie rien)
function pil_mail_ai_tool(): array {
    return ['name' => 'classer_emails', 'description' => 'Enregistre l\'analyse de chaque e-mail reçu (un objet par e-mail, dans l\'ordre reçu).',
        'inputSchema' => ['type' => 'object', 'properties' => ['emails' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
            'id' => ['type' => 'integer', 'description' => 'Numéro de l\'e-mail (#id)'],
            'categorie' => ['type' => 'string', 'enum' => array_keys(PIL_MAIL_CATS)],
            'urgence' => ['type' => 'string', 'enum' => ['haute', 'normale', 'basse']],
            'resume' => ['type' => 'string', 'description' => 'Résumé en une phrase, en français'],
            'action_requise' => ['type' => 'boolean'],
            'action' => ['type' => 'string', 'description' => 'Ce que la direction doit faire, en une phrase (vide si rien)'],
            'echeance' => ['type' => 'string', 'description' => 'Date limite AAAA-MM-JJ si l\'e-mail en donne une, sinon vide'],
            'chantier_id' => ['type' => 'integer', 'description' => 'Identifiant du chantier concerné (liste fournie), 0 si aucun ou incertain'],
            'pieces' => ['type' => 'string', 'description' => 'Ce que contiennent les PDF joints (facture, devis, plan, attestation…), avec numéro et montant tels qu\'écrits ; vide si aucun'],
            'reponse_necessaire' => ['type' => 'boolean'],
            'brouillon' => ['type' => 'string', 'description' => 'Si une réponse est nécessaire : brouillon complet dans la LANGUE de l\'expéditeur, poli et court, signé ; jamais d\'engagement de prix, de date ou de paiement qui ne figure pas dans l\'e-mail ; vide sinon'],
        ], 'required' => ['id', 'categorie', 'urgence', 'resume', 'action_requise', 'action', 'reponse_necessaire', 'brouillon']]]], 'required' => ['emails']]];
}
function pil_mail_analyze(array $acc, array $me, int $max = 10): array {
    if (!pil_ai_ready()) return ['analyzed' => 0, 'ai' => false];
    $rows = q("SELECT * FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in' AND analyzed_at IS NULL AND state = 'nouveau' ORDER BY at DESC LIMIT " . (int)$max, [$acc['id']])->fetchAll();
    if (!$rows) return ['analyzed' => 0, 'ai' => true];
    $projects = array_map(fn($p) => ['id' => (int)$p['id'], 'nom' => $p['data']['name'] ?? '', 'ville' => $p['data']['city'] ?? '', 'adresse' => $p['data']['address'] ?? ''],
        array_values(array_filter(pil_items(['project'])['project'] ?? [], fn($p) => !in_array($p['data']['status'] ?? '', ['annule'], true))));
    $co = setting('company', []) ?: [];
    $content = [['type' => 'text', 'text' => "Entreprise : " . ($co['name'] ?? 'MADIBU Group') . " (construction, Belgique). Boîte : {$acc['email']}. Signature à utiliser : {$me['name']} – " . ($co['name'] ?? '') . (($co['phone'] ?? '') ? ' – ' . $co['phone'] : '') . ".\nChantiers (id, nom, ville, adresse) : " . json_encode(array_slice($projects, 0, 150), JSON_UNESCAPED_UNICODE) . "\n\nAnalyse les e-mails suivants et appelle classer_emails."]];
    $budget = 2; // PDF joints : au plus 2 par e-mail, 3 Mo chacun
    foreach ($rows as $r) {
        $content[] = ['type' => 'text', 'text' => "\n#{$r['id']} · reçu le {$r['at']} · de : {$r['from_name']} <{$r['from_email']}> · objet : {$r['subject']}\n" . pil_mail_mask(mb_substr((string)$r['body'], 0, 5000))];
        if ($r['atts'] !== null && ($acc['kind'] ?? 'graph') === 'imap') {
            try { foreach (pil_imap_pdfs($acc, $r, $budget) as $pdf) { $content[] = ['type' => 'text', 'text' => "Pièce jointe PDF de l'e-mail #{$r['id']} : {$pdf['name']}"]; $content[] = ['type' => 'document', 'source' => ['type' => 'base64', 'mediaType' => 'application/pdf', 'data' => base64_encode($pdf['data'])]]; } }
            catch (Throwable $e) { error_log('[pilotage mail] pièces jointes IMAP : ' . $e->getMessage()); }
        } elseif ($r['atts'] !== null) {
            try {
                $att = pil_graph($acc, 'GET', '/me/messages/' . rawurlencode($r['graph_id']) . '/attachments?$select=id,name,contentType,size,isInline');
                $list = []; $n = 0;
                foreach ($att['value'] ?? [] as $a) {
                    if (!empty($a['isInline'])) continue;
                    $list[] = ['name' => (string)$a['name'], 'size' => (int)($a['size'] ?? 0), 'type' => (string)($a['contentType'] ?? '')];
                    $isPdf = str_contains(strtolower((string)($a['contentType'] ?? '')), 'pdf') || preg_match('/\.pdf$/i', (string)$a['name']);
                    if ($isPdf && $n < $budget && (int)($a['size'] ?? 0) <= 3 * 1024 * 1024) {
                        $full = pil_graph($acc, 'GET', '/me/messages/' . rawurlencode($r['graph_id']) . '/attachments/' . rawurlencode((string)$a['id']));
                        if (!empty($full['contentBytes'])) { $content[] = ['type' => 'text', 'text' => "Pièce jointe PDF de l'e-mail #{$r['id']} : {$a['name']}"]; $content[] = ['type' => 'document', 'source' => ['type' => 'base64', 'mediaType' => 'application/pdf', 'data' => $full['contentBytes']]]; $n++; }
                    }
                }
                q('UPDATE pil_mail_msgs SET atts = ? WHERE id = ?', [json_encode($list, JSON_UNESCAPED_UNICODE), $r['id']]);
            } catch (Throwable $e) { error_log('[pilotage mail] pièces jointes : ' . $e->getMessage()); }
        }
    }
    $system = "Tu es l'assistant de direction de " . ($co['name'] ?? 'MADIBU Group') . ". Tu tries les e-mails reçus et prépares le travail ; tu ne décides rien et tu n'envoies rien : chaque brouillon sera relu, modifié si besoin et envoyé par la direction elle-même.\n"
        . "Règles : n'invente aucun fait, montant, date ou engagement ; recopie les montants tels qu'écrits ; publicité et newsletters : urgence basse, pas d'action, pas de réponse ; un e-mail qui demande une réponse, une décision, un paiement, un document ou une date : action_requise ; chantier_id seulement si le nom, l'adresse ou le client correspond clairement.";
    $client = new Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url());
    @set_time_limit(240);
    $resp = $client->beta->messages->create(maxTokens: 12000, model: AI_MODEL, system: $system, tools: [pil_mail_ai_tool()], toolChoice: ['type' => 'tool', 'name' => 'classer_emails'],
        messages: [['role' => 'user', 'content' => $content]], outputConfig: ['effort' => 'low'], fallbacks: 'default', betas: ['server-side-fallback-2026-07-01']);
    $out = [];
    foreach ($resp->content as $b) if ($b->type === 'tool_use') { $in = json_decode(json_encode($b->input), true) ?: []; $out = $in['emails'] ?? []; }
    $ids = array_column($rows, null, 'id'); $done = 0; $pids = array_column($projects, 'id');
    foreach ($out as $e) {
        $id = (int)($e['id'] ?? 0); if (!isset($ids[$id])) continue;
        $row = $ids[$id];
        // montants cités par l'IA : comparés au texte de l'e-mail (ceux des PDF sont signalés « à vérifier sur la pièce »)
        $known = pil_amounts_in_data([(string)$row['body'], (string)$row['subject']]);
        $bad = []; foreach (pil_amounts_in_text(($e['action'] ?? '') . ' ' . ($e['brouillon'] ?? '') . ' ' . ($e['resume'] ?? '')) as $a) if (!isset($known[abs($a)])) $bad[] = pil_fmt($a);
        $an = ['categorie' => isset(PIL_MAIL_CATS[$e['categorie'] ?? '']) ? $e['categorie'] : 'autre', 'urgence' => in_array($e['urgence'] ?? '', ['haute', 'normale', 'basse'], true) ? $e['urgence'] : 'normale',
            'resume' => mb_substr((string)($e['resume'] ?? ''), 0, 400), 'action_requise' => !empty($e['action_requise']), 'action' => mb_substr((string)($e['action'] ?? ''), 0, 400),
            'echeance' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($e['echeance'] ?? '')) ? $e['echeance'] : '', 'pieces' => mb_substr((string)($e['pieces'] ?? ''), 0, 600),
            'reponse_necessaire' => !empty($e['reponse_necessaire']), 'non_verifie' => $bad];
        $pid = in_array((int)($e['chantier_id'] ?? 0), $pids, true) ? (int)$e['chantier_id'] : null;
        $state = $an['action_requise'] || $an['reponse_necessaire'] ? 'a_faire' : 'info';
        q('UPDATE pil_mail_msgs SET analysis = ?, analyzed_at = ?, state = ?, project_id = ? WHERE id = ?', [json_encode($an, JSON_UNESCAPED_UNICODE), now(), $state, $pid, $id]);
        $draft = trim((string)($e['brouillon'] ?? ''));
        if ($an['reponse_necessaire'] && $draft !== '' && $row['from_email'] && !q("SELECT id FROM pil_mail_drafts WHERE msg_id = ? AND status = 'brouillon'", [$id])->fetch()) {
            q('INSERT INTO pil_mail_drafts (company_id, account_id, msg_id, to_json, subject, body, origin, status, check_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [cid(), $acc['id'], $id, json_encode([['email' => $row['from_email'], 'name' => $row['from_name']]], JSON_UNESCAPED_UNICODE), mb_substr('RE: ' . preg_replace('/^(re|tr|fw|fwd|aw)\s*:\s*/i', '', (string)$row['subject']), 0, 500),
                 $draft, 'ia', 'brouillon', json_encode(['non_verifie' => $bad], JSON_UNESCAPED_UNICODE), now(), now()]);
        }
        $done++;
    }
    pil_audit('emails_analyses', 'mail_account', (int)$acc['id'], null, ['nombre' => $done, 'pdf_lus' => true], 'ia', (int)$me['id']);
    return ['analyzed' => $done, 'ai' => true];
}

// --------------------------------------------------------------------- Briefing : ce qu'il faut faire, ce qui attend, ce qui est préparé
function pil_mail_msg_out(array $r): array {
    return ['id' => (int)$r['id'], 'account_id' => (int)$r['account_id'], 'from_email' => $r['from_email'], 'from_name' => $r['from_name'], 'subject' => $r['subject'], 'at' => $r['at'],
        'preview' => $r['preview'], 'atts' => $r['atts'] ? (json_decode($r['atts'], true) ?: []) : [], 'web_link' => $r['web_link'], 'is_read' => (bool)$r['is_read'],
        'analysis' => $r['analysis'] ? json_decode($r['analysis'], true) : null, 'state' => $r['state'], 'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null, 'moved' => $r['moved'] ?? null];
}
function pil_mail_draft_out(array $d): array {
    return ['id' => (int)$d['id'], 'account_id' => (int)$d['account_id'], 'msg_id' => $d['msg_id'] !== null ? (int)$d['msg_id'] : null, 'to' => json_decode($d['to_json'], true) ?: [], 'cc' => json_decode((string)$d['cc_json'], true) ?: [],
        'subject' => $d['subject'], 'body' => $d['body'], 'origin' => $d['origin'], 'status' => $d['status'], 'check' => json_decode((string)$d['check_json'], true) ?: [], 'updated_at' => $d['updated_at'], 'sent_at' => $d['sent_at'], 'note' => $d['note']];
}
function pil_mail_brief(array $me, string $today): array {
    $accs = q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN);
    if (!$accs) return ['accounts' => [], 'todo' => [], 'waiting' => [], 'drafts' => [], 'info' => [], 'new' => [], 'counts' => ['todo' => 0, 'waiting' => 0, 'drafts' => 0, 'info' => 0, 'new' => 0, 'urgent' => 0],
        'ai' => pil_ai_ready(), 'configured' => pil_mail_ready(), 'folders' => [], 'drafts' => []];
    $in = implode(',', array_map('intval', $accs));
    $msgs = array_map('pil_mail_msg_out', q("SELECT * FROM pil_mail_msgs WHERE company_id = ? AND account_id IN ($in) AND folder = 'in' AND at >= ? ORDER BY at DESC", [cid(), date('Y-m-d', strtotime("$today -30 days"))])->fetchAll());
    $rank = fn($m) => [($m['analysis']['urgence'] ?? 'normale') === 'haute' ? 0 : 1, ($m['analysis']['echeance'] ?? '') ?: '9999', $m['at']];
    $todo = array_values(array_filter($msgs, fn($m) => $m['state'] === 'a_faire'));
    usort($todo, fn($a, $b) => $rank($a) <=> $rank($b));
    // sans réponse depuis plus de 2 jours (réponse attendue)
    $waiting = array_values(array_filter($todo, fn($m) => !empty($m['analysis']['reponse_necessaire']) && strtotime($m['at']) < strtotime("$today -2 days")));
    $drafts = array_map('pil_mail_draft_out', q("SELECT * FROM pil_mail_drafts WHERE company_id = ? AND account_id IN ($in) AND status = 'brouillon' ORDER BY id DESC", [cid()])->fetchAll());
    $info = array_values(array_filter($msgs, fn($m) => $m['state'] === 'info'));
    $new = array_values(array_filter($msgs, fn($m) => $m['state'] === 'nouveau'));
    return ['accounts' => pil_mail_accounts($me), 'todo' => $todo, 'waiting' => $waiting, 'drafts' => $drafts, 'info' => array_slice($info, 0, 60), 'new' => array_slice($new, 0, 60),
        'counts' => ['todo' => count($todo), 'waiting' => count($waiting), 'drafts' => count($drafts), 'info' => count($info), 'new' => count($new), 'urgent' => count(array_filter($todo, fn($m) => ($m['analysis']['urgence'] ?? '') === 'haute'))],
        'ai' => pil_ai_ready(), 'configured' => pil_mail_ready(), 'folders' => pil_mail_folders($me)];
}

/** Dossiers de chaque boîte (comme dans Outlook) : réception (non lus), envoyés, publicité rangée. */
function pil_mail_folders(array $me): array {
    $out = [];
    foreach (q('SELECT id, email, name, kind FROM pil_mail_accounts WHERE company_id = ? AND user_id = ? ORDER BY id', [cid(), $me['id']])->fetchAll() as $a) {
        $c = q("SELECT SUM(folder = 'in' AND moved IS NULL) AS inbox, SUM(folder = 'in' AND moved IS NULL AND is_read = 0) AS unread, SUM(folder = 'sent') AS sent, SUM(folder = 'in' AND moved IS NOT NULL) AS pub, MAX(IF(folder = 'in', at, NULL)) AS newest FROM pil_mail_msgs WHERE account_id = ?", [$a['id']])->fetch();
        $out[] = ['id' => (int)$a['id'], 'email' => $a['email'], 'name' => $a['name'], 'kind' => $a['kind'] ?? 'graph', 'inbox' => (int)$c['inbox'], 'unread' => (int)$c['unread'], 'sent' => (int)$c['sent'], 'pub' => (int)$c['pub'], 'newest' => $c['newest']];
    }
    return $out;
}
/** Liste d'un dossier : box = id de boîte ou « all » ; folder = in | sent | pub | todo | waiting | info | new ; q = recherche ; before = pages suivantes. */
function pil_mail_list(array $me, array $g): array {
    $accs = array_map('intval', q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN));
    if (!$accs) return ['items' => [], 'more' => false];
    $box = (string)($g['box'] ?? 'all');
    $ids = $box === 'all' ? $accs : array_values(array_intersect($accs, [(int)$box]));
    if (!$ids) fail(404, 'Boîte introuvable');
    $w = ['m.company_id = ?', 'm.account_id IN (' . implode(',', $ids) . ')']; $p = [cid()];
    $f = (string)($g['folder'] ?? 'in');
    $w[] = match ($f) {
        'sent' => "m.folder = 'sent'",
        'pub' => "m.folder = 'in' AND m.moved IS NOT NULL",
        'todo' => "m.folder = 'in' AND m.state = 'a_faire'",
        'waiting' => "m.folder = 'in' AND m.state = 'a_faire' AND m.analysis LIKE '%\"reponse_necessaire\":true%' AND m.at < '" . date('Y-m-d H:i:s', time() - 2 * 86400) . "'",
        'info' => "m.folder = 'in' AND m.state = 'info' AND m.moved IS NULL",
        'new' => "m.folder = 'in' AND m.state = 'nouveau'",
        default => "m.folder = 'in' AND m.moved IS NULL",
    };
    $qs = trim((string)($g['q'] ?? ''));
    if ($qs !== '') { $w[] = '(m.subject LIKE ? OR m.from_name LIKE ? OR m.from_email LIKE ? OR m.preview LIKE ? OR m.to_json LIKE ?)'; $l = '%' . addcslashes($qs, '%_\\') . '%'; array_push($p, $l, $l, $l, $l, $l); }
    if (!empty($g['before']) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', (string)$g['before'])) { $w[] = 'm.at < ?'; $p[] = $g['before']; }
    $rows = q('SELECT m.*, a.email AS account_email FROM pil_mail_msgs m JOIN pil_mail_accounts a ON a.id = m.account_id WHERE ' . implode(' AND ', $w) . ' ORDER BY m.at DESC LIMIT 61', $p)->fetchAll();
    $more = count($rows) > 60; $rows = array_slice($rows, 0, 60);
    return ['items' => array_map(fn($r) => pil_mail_msg_out($r) + ['account_email' => $r['account_email'], 'folder' => $r['folder'], 'to' => json_decode((string)$r['to_json'], true) ?: []], $rows), 'more' => $more];
}

// --------------------------------------------------------------------- Envoi : seulement par l'utilisateur, après relecture (jamais par l'IA ni par une tâche planifiée)
function pil_mail_send(array $me, int $draftId, array $b): array {
    $d = q('SELECT * FROM pil_mail_drafts WHERE id = ? AND company_id = ?', [$draftId, cid()])->fetch();
    if (!$d) fail(404, 'Brouillon introuvable');
    $acc = pil_mail_account($me, (int)$d['account_id']); // la boîte doit être celle de l'utilisateur
    if ($d['status'] !== 'brouillon') fail(409, 'Ce brouillon a déjà été traité.');
    if (empty($b['confirm'])) fail(400, 'Confirmez l\'envoi.');
    // le texte envoyé est celui relu à l'écran (et enregistré)
    $to = pil_mail_rcpts($b['to'] ?? json_decode($d['to_json'], true)); $cc = pil_mail_rcpts($b['cc'] ?? (json_decode((string)$d['cc_json'], true) ?: []));
    $subject = trim(preg_replace('/[\r\n]+/', ' ', (string)($b['subject'] ?? $d['subject']))); $body = (string)($b['body'] ?? $d['body']);
    if (!$to) fail(400, 'Aucun destinataire.'); if ($subject === '' || trim($body) === '') fail(400, 'Objet ou message vide.');
    q('UPDATE pil_mail_drafts SET to_json = ?, cc_json = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', [json_encode($to), json_encode($cc), mb_substr($subject, 0, 500), $body, now(), $draftId]);
    $msg = $d['msg_id'] ? q('SELECT * FROM pil_mail_msgs WHERE id = ? AND account_id = ?', [(int)$d['msg_id'], $acc['id']])->fetch() : null;
    $rc = fn($l) => array_map(fn($r) => ['emailAddress' => ['address' => $r['email'], 'name' => $r['name'] ?? '']], $l);
    $note = null;
    if (test_mode()) { $note = 'Site de test : e-mail NON envoyé (simulation).'; error_log('[BatiPro mode test] e-mail Outlook NON envoyé : ' . $subject); }
    elseif (($acc['kind'] ?? 'graph') === 'imap') { require_once __DIR__ . '/imap.php'; $note = pil_imap_send($acc, $me, $to, $cc, $subject, $body, $msg); }
    elseif ($msg) pil_graph($acc, 'POST', '/me/messages/' . rawurlencode($msg['graph_id']) . '/reply', ['message' => ['toRecipients' => $rc($to), 'ccRecipients' => $rc($cc)], 'comment' => $body]);
    else pil_graph($acc, 'POST', '/me/sendMail', ['message' => ['subject' => $subject, 'body' => ['contentType' => 'Text', 'content' => $body], 'toRecipients' => $rc($to), 'ccRecipients' => $rc($cc)], 'saveToSentItems' => true]);
    q("UPDATE pil_mail_drafts SET status = 'envoye', sent_at = ?, sent_by = ?, note = ? WHERE id = ?", [now(), $me['id'], $note, $draftId]);
    if ($msg) q("UPDATE pil_mail_msgs SET state = 'repondu', done_by = ?, done_at = ? WHERE id = ?", [$me['id'], now(), $msg['id']]);
    pil_audit('email_envoye', 'mail_draft', $draftId, null, ['boite' => $acc['email'], 'a' => array_column($to, 'email'), 'objet' => $subject, 'origine_brouillon' => $d['origin'], 'relu_et_confirme_par' => (int)$me['id'], 'simulation' => test_mode()]);
    return pil_mail_draft_out(q('SELECT * FROM pil_mail_drafts WHERE id = ?', [$draftId])->fetch());
}
function pil_mail_rcpts($l): array {
    $out = [];
    foreach ((array)$l as $r) { $e = mb_strtolower(trim((string)(is_array($r) ? ($r['email'] ?? '') : $r))); if ($e === '') continue; if (!filter_var($e, FILTER_VALIDATE_EMAIL)) fail(400, "Adresse invalide : $e"); $out[$e] = ['email' => $e, 'name' => is_array($r) ? (string)($r['name'] ?? '') : '']; }
    if (count($out) > 20) fail(400, 'Maximum 20 destinataires.');
    return array_values($out);
}

// --------------------------------------------------------------------- E-mails reçus tout de suite (Microsoft 365) : abonnement aux nouveaux messages
// Microsoft prévient outlook-notify.php dès qu'un e-mail arrive ; BatiPro relève alors la boîte et envoie une notification (téléphone).
function pil_mail_base(): string {
    $c = pil_mail_conf();
    if (!empty($_SERVER['HTTP_HOST'])) return preg_replace('#/outlook-callback\.php$#', '', pil_mail_redirect());
    return rtrim((string)($c['base'] ?? ''), '/');
}
function pil_mail_subscribe(array $acc): void {
    if (($acc['kind'] ?? 'graph') !== 'graph') return;
    $base = pil_mail_base(); if (!str_starts_with($base, 'https://') && empty(config()['ms_graph_base'])) return; // Microsoft exige https
    $o = pil_mail_opts($acc); $exp = gmdate('Y-m-d\TH:i:s\Z', time() + 4200 * 60); // ~70 h (maximum Microsoft : 7 jours)
    if (!empty($o['sub_id'])) {
        try { pil_graph($acc, 'PATCH', '/subscriptions/' . rawurlencode($o['sub_id']), ['expirationDateTime' => $exp]); $o['sub_exp'] = time() + 4200 * 60; q('UPDATE pil_mail_accounts SET opts = ? WHERE id = ?', [json_encode($o), $acc['id']]); return; }
        catch (Throwable $e) { unset($o['sub_id']); } // expiré ou supprimé chez Microsoft : on en recrée un
    }
    $state = bin2hex(random_bytes(16));
    $j = pil_graph($acc, 'POST', '/subscriptions', ['changeType' => 'created', 'notificationUrl' => $base . '/outlook-notify.php', 'resource' => "me/mailFolders('Inbox')/messages", 'expirationDateTime' => $exp, 'clientState' => $state]);
    $o['sub_id'] = (string)($j['id'] ?? ''); $o['sub_state'] = $state; $o['sub_exp'] = time() + 4200 * 60;
    q('UPDATE pil_mail_accounts SET opts = ? WHERE id = ?', [json_encode($o), $acc['id']]);
}
/** Notifications reçues : relève des boîtes concernées, tri, rangement, notification à l'utilisateur. */
function pil_mail_notified(array $values): void {
    $done = [];
    foreach ($values as $v) {
        $sid = (string)($v['subscriptionId'] ?? ''); if ($sid === '' || isset($done[$sid])) continue; $done[$sid] = true;
        $acc = null;
        foreach (q("SELECT * FROM pil_mail_accounts WHERE kind = 'graph' AND opts LIKE ?", ['%' . addcslashes(json_encode($sid), '%_\\') . '%'])->fetchAll() as $a) { $o = pil_mail_opts($a); if (($o['sub_id'] ?? '') === $sid) $acc = $a; }
        if (!$acc || !hash_equals((string)(pil_mail_opts($acc)['sub_state'] ?? ''), (string)($v['clientState'] ?? ''))) continue; // notification non authentifiée : ignorée
        $GLOBALS['BP_CID'] = (int)$acc['company_id'];
        if (!pil_enabled()) continue;
        pil_mail_schema();
        if ($acc['last_sync'] && time() - strtotime($acc['last_sync']) < 10) continue; // plusieurs e-mails d'un coup : une seule relève
        $start = now();
        try {
            pil_mail_sync($acc);
            $u = q('SELECT * FROM users WHERE id = ? AND company_id = ? AND active = 1', [(int)$acc['user_id'], cid()])->fetch();
            if (!$u) continue;
            $fresh = q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch();
            try { pil_mail_analyze($fresh, $u, 10); pil_mail_tidy($fresh); } catch (Throwable $e) { error_log('[pilotage mail notify] tri : ' . $e->getMessage()); }
            $new = q("SELECT from_name, from_email, subject, analysis FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in' AND moved IS NULL AND created_at >= ? ORDER BY at DESC", [$acc['id'], $start])->fetchAll();
            if (count($new) === 1) { $a = json_decode((string)$new[0]['analysis'], true) ?: [];
                notify([(int)$u['id']], 'mail', ($a['urgence'] ?? '') === 'haute' ? '⚑ Urgent – ' . ($new[0]['from_name'] ?: $new[0]['from_email']) : '✉ ' . ($new[0]['from_name'] ?: $new[0]['from_email']), (string)$new[0]['subject'] . (!empty($a['action']) ? ' – ' . $a['action'] : ''), '#/pilotage/emails'); }
            elseif (count($new) > 1) notify([(int)$u['id']], 'mail', '✉ ' . count($new) . ' nouveaux e-mails (' . $acc['email'] . ')', implode(' · ', array_map(fn($m) => $m['from_name'] ?: $m['from_email'], array_slice($new, 0, 4))), '#/pilotage/emails');
        } catch (Throwable $e) { q('UPDATE pil_mail_accounts SET last_error = ? WHERE id = ?', [mb_substr($e->getMessage(), 0, 500), $acc['id']]); }
    }
}

// --------------------------------------------------------------------- Rangement automatique : publicités et newsletters → dossier « Publicité »
// Jamais : un expéditeur présent dans les contacts BatiPro, un e-mail avec une action ou une réponse attendue, un e-mail remis à la main dans la boîte de réception.
function pil_mail_opts(array $acc): array { return (json_decode((string)($acc['opts'] ?? ''), true) ?: []) + ['autoPub' => true]; }
function pil_mail_tidy(array $acc): int {
    if (!pil_mail_opts($acc)['autoPub']) return 0;
    $known = [];
    foreach (pil_items(['contact'])['contact'] ?? [] as $c) foreach (['email', 'email2', 'invoiceEmail'] as $k) if (!empty($c['data'][$k])) $known[mb_strtolower(trim((string)$c['data'][$k]))] = true;
    $rows = q("SELECT * FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in' AND moved IS NULL AND keep_in = 0 AND state = 'info' AND analysis IS NOT NULL ORDER BY at DESC LIMIT 60", [$acc['id']])->fetchAll();
    $todo = array_values(array_filter($rows, function ($r) use ($known) { $a = json_decode((string)$r['analysis'], true) ?: [];
        return ($a['categorie'] ?? '') === 'publicite' && empty($a['action_requise']) && empty($a['reponse_necessaire']) && !isset($known[(string)$r['from_email']]); }));
    if (!$todo) return 0;
    $n = 0;
    if (($acc['kind'] ?? 'graph') === 'imap') { require_once __DIR__ . '/imap.php'; $n = pil_imap_tidy($acc, $todo); }
    else {
        $dest = pil_graph_folder($acc, PIL_MAIL_PUB);
        foreach ($todo as $r) {
            try { $j = pil_graph($acc, 'POST', '/me/messages/' . rawurlencode($r['graph_id']) . '/move', ['destinationId' => $dest]); q('UPDATE pil_mail_msgs SET graph_id = ?, moved = ? WHERE id = ?', [(string)($j['id'] ?? $r['graph_id']), PIL_MAIL_PUB, $r['id']]); $n++; }
            catch (Throwable $e) { error_log('[pilotage mail] rangement : ' . $e->getMessage()); break; }
        }
    }
    if ($n) pil_audit('emails_ranges', 'mail_account', (int)$acc['id'], null, ['dossier' => PIL_MAIL_PUB, 'nombre' => $n], 'systeme');
    return $n;
}
/** Dossier Outlook (Microsoft 365) : trouvé ou créé. */
function pil_graph_folder(array $acc, string $name): string {
    $j = pil_graph($acc, 'GET', '/me/mailFolders?' . http_build_query(['$filter' => "displayName eq '" . str_replace("'", "''", $name) . "'", '$select' => 'id,displayName']));
    if (!empty($j['value'][0]['id'])) return (string)$j['value'][0]['id'];
    $c = pil_graph($acc, 'POST', '/me/mailFolders', ['displayName' => $name]);
    return (string)$c['id'];
}
/** Remettre un e-mail rangé dans la boîte de réception (il n'est plus rangé ensuite). */
function pil_mail_unmove(array $acc, array $row): void {
    if (!$row['moved']) return;
    if (($acc['kind'] ?? 'graph') === 'imap') { require_once __DIR__ . '/imap.php'; $gid = pil_imap_unmove($acc, $row); }
    else { $j = pil_graph($acc, 'POST', '/me/messages/' . rawurlencode($row['graph_id']) . '/move', ['destinationId' => 'inbox']); $gid = (string)($j['id'] ?? $row['graph_id']); }
    q('UPDATE pil_mail_msgs SET graph_id = ?, moved = NULL, keep_in = 1 WHERE id = ?', [$gid, $row['id']]);
}

// --------------------------------------------------------------------- Tâche planifiée : relève et analyse (aucun envoi)
function pil_mail_cron(): void {
    pil_mail_schema();
    foreach (q("SELECT * FROM pil_mail_accounts WHERE company_id = ? AND status = 'ok' AND (last_sync IS NULL OR last_sync < ?)", [cid(), date('Y-m-d H:i:s', time() - 10 * 60)])->fetchAll() as $acc) {
        try {
            $o = pil_mail_opts($acc); if (($acc['kind'] ?? 'graph') === 'graph' && (empty($o['sub_id']) || (int)($o['sub_exp'] ?? 0) < time() + 86400)) { try { pil_mail_subscribe($acc); } catch (Throwable $e) { error_log('[pilotage mail] abonnement : ' . $e->getMessage()); } }
            pil_mail_sync($acc);
            $u = q('SELECT * FROM users WHERE id = ? AND company_id = ? AND active = 1', [(int)$acc['user_id'], cid()])->fetch();
            if ($u) { pil_mail_analyze(q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch(), $u, 15); pil_mail_tidy(q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch()); }
        } catch (Throwable $e) { q('UPDATE pil_mail_accounts SET last_error = ? WHERE id = ?', [mb_substr($e->getMessage(), 0, 500), $acc['id']]); error_log('[pilotage mail cron] ' . $acc['email'] . ' : ' . $e->getMessage()); }
    }
}

// --------------------------------------------------------------------- Routes : pilot/mail/…
function pil_mail_route(string $method, array $seg, array $me): void {
    pil_mail_schema();
    $a = $seg[2] ?? ''; $id = (int)($seg[3] ?? 0);
    if ($a === 'callback' && $method === 'GET') pil_mail_callback_public();
    if ($a === 'config') {
        pil_need($me, 'settings.write');
        $c = pil_mail_conf();
        if ($method === 'GET') out(['clientId' => $c['clientId'] ?? '', 'tenant' => $c['tenant'] ?? '', 'hasSecret' => !empty($c['secret']), 'redirect' => pil_mail_redirect()]);
        if ($method === 'PUT') {
            $b = body();
            $n = ['clientId' => trim((string)($b['clientId'] ?? '')), 'tenant' => trim((string)($b['tenant'] ?? ''))] + $c;
            if ($n['clientId'] !== '' && !preg_match('/^[0-9a-f-]{36}$/i', $n['clientId'])) fail(400, 'ID d\'application (client) invalide : 36 caractères, ex. 1a2b3c4d-…');
            if ($n['tenant'] !== '' && !preg_match('/^([0-9a-f-]{36}|[a-z0-9.-]+\.[a-z]{2,})$/i', $n['tenant'])) fail(400, 'ID d\'annuaire (tenant) invalide.');
            if (trim((string)($b['secret'] ?? '')) !== '') $n['secret'] = pil_mail_enc(['s' => trim((string)$b['secret'])]);
            $n['base'] = pil_mail_base();
            set_setting('pilotage_mail', $n);
            pil_audit('outlook_configure', 'settings', null, null, ['clientId' => $n['clientId'], 'tenant' => $n['tenant'], 'secret_modifie' => trim((string)($b['secret'] ?? '')) !== '']);
            out(['ok' => true]);
        }
    }
    if ($a === 'connect' && $method === 'POST') out(['url' => pil_mail_connect_url($me)]);
    if ($a === 'imap' && $method === 'POST') { require_once __DIR__ . '/imap.php'; out(pil_imap_connect($me, body())); }
    if ($a === 'accounts' && $method === 'GET' && !$id) out(pil_mail_accounts($me));
    // diagnostic : ce que le serveur de messagerie a vraiment, comparé à ce que BatiPro a relevé (lecture seule)
    if ($a === 'accounts' && $method === 'GET' && $id && ($seg[4] ?? '') === 'check') {
        $acc = pil_mail_account($me, $id); $out = ['email' => $acc['email'], 'kind' => $acc['kind'] ?? 'graph', 'status' => $acc['status'], 'last_sync' => $acc['last_sync'], 'last_error' => $acc['last_error'],
            'server_time' => date('Y-m-d H:i:s T'), 'utc' => gmdate('Y-m-d H:i:s'), 'php_tz' => date_default_timezone_get(), 'version' => basename((string)(glob(dirname(__DIR__) . '/index.html') ? (preg_match('/core\.js\?v=(\d+)/', (string)file_get_contents(dirname(__DIR__) . '/index.html'), $vm) ? $vm[1] : '?') : '?')),
            'in_batipro' => (int)q("SELECT COUNT(*) FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in'", [$id])->fetchColumn(), 'newest_batipro' => q("SELECT MAX(at) FROM pil_mail_msgs WHERE account_id = ? AND folder = 'in'", [$id])->fetchColumn(),
            'cron_last' => q("SELECT MAX(last_sync) FROM pil_mail_accounts WHERE company_id = ?", [cid()])->fetchColumn(), 'opts' => array_intersect_key(pil_mail_opts($acc), array_flip(['autoPub', 'sub_exp', 'since_utc'])), 'server' => [], 'error' => null];
        try {
            if (($acc['kind'] ?? 'graph') === 'graph') {
                $j = pil_graph($acc, 'GET', '/me/mailFolders/inbox/messages?' . http_build_query(['$top' => 10, '$orderby' => 'receivedDateTime desc', '$select' => 'id,subject,from,receivedDateTime']));
                foreach ($j['value'] ?? [] as $m) { $row = q('SELECT id, at, folder, moved, subject FROM pil_mail_msgs WHERE account_id = ? AND graph_id = ?', [$id, (string)$m['id']])->fetch();
                    $at = date('Y-m-d H:i:s', strtotime((string)$m['receivedDateTime'])); $subj = mb_substr((string)($m['subject'] ?? ''), 0, 90);
                    // « dans BatiPro » seulement si c'est bien le même e-mail (même date et même objet), sinon l'écart est montré
                    $same = $row && abs(strtotime($row['at']) - strtotime($at)) <= 120 && mb_substr((string)$row['subject'], 0, 90) === $subj;
                    $out['server'][] = ['at' => $at, 'from' => (string)($m['from']['emailAddress']['address'] ?? ''), 'subject' => $subj, 'in_batipro' => (bool)$same,
                        'stored' => $row ? ['at' => $row['at'], 'folder' => $row['folder'], 'moved' => $row['moved'], 'subject' => mb_substr((string)$row['subject'], 0, 90)] : null]; }
            } else {
                require_once __DIR__ . '/imap.php'; $c = pil_imap_open(pil_imap_conf($acc)); $uv = $c->examine('INBOX'); $u = $c->since(date('Y-m-d', time() - 3 * 86400)); rsort($u);
                foreach ($c->fetch(array_slice($u, 0, 10), false) as $m) { $p = pil_mime_parse((string)$m['raw']); $out['server'][] = ['at' => $p['date'] ?? $m['date'], 'from' => $p['from'][0], 'subject' => mb_substr($p['subject'], 0, 90), 'in_batipro' => (bool)q('SELECT id FROM pil_mail_msgs WHERE account_id = ? AND (graph_id = ? OR msg_ref LIKE ?)', [$id, "imap:in:$uv:{$m['uid']}", '%' . addcslashes((string)$p['mid'], '%_\\') . '%'])->fetch()]; }
            }
        } catch (Throwable $e) { $out['error'] = $e->getMessage(); }
        out($out);
    }
    if ($a === 'accounts' && $method === 'PUT' && $id) {
        $acc = pil_mail_account($me, $id); $b = body();
        $o = pil_mail_opts($acc); if (array_key_exists('autoPub', $b)) $o['autoPub'] = !empty($b['autoPub']);
        q('UPDATE pil_mail_accounts SET opts = ? WHERE id = ?', [json_encode($o), $id]);
        out(pil_mail_accounts($me));
    }
    if ($a === 'accounts' && $method === 'DELETE' && $id) {
        $acc = pil_mail_account($me, $id);
        $o = pil_mail_opts($acc); if (!empty($o['sub_id'])) { try { pil_graph($acc, 'DELETE', '/subscriptions/' . rawurlencode($o['sub_id'])); } catch (Throwable $e) { /* déjà expiré */ } }
        q('DELETE FROM pil_mail_drafts WHERE account_id = ?', [$id]); q('DELETE FROM pil_mail_msgs WHERE account_id = ?', [$id]); q('DELETE FROM pil_mail_accounts WHERE id = ?', [$id]);
        pil_audit('boite_mail_deconnectee', 'mail_account', $id, ['email' => $acc['email']], null);
        out(['ok' => true]);
    }
    if ($a === 'sync' && $method === 'POST') {
        @set_time_limit(300);
        $GLOBALS['PIL_MAIL_CUR'] = null;
        register_shutdown_function(function () { $e = error_get_last(); $id = $GLOBALS['PIL_MAIL_CUR'] ?? null;
            if ($id && $e && in_array($e['type'], [E_ERROR, E_CORE_ERROR, E_COMPILE_ERROR], true)) { try { q('UPDATE pil_mail_accounts SET last_error = ? WHERE id = ?', [mb_substr('Relève interrompue par l\'hébergeur : ' . $e['message'], 0, 500), $id]); } catch (Throwable $x) { /* */ } } });
        $res = []; $errs = [];
        foreach (q('SELECT * FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll() as $acc) {
            $GLOBALS['PIL_MAIL_CUR'] = (int)$acc['id'];
            try { $s = pil_mail_sync($acc, !empty(body()['deep'])); $an = pil_mail_analyze(q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch(), $me, 15);
                $t = 0; try { $t = pil_mail_tidy(q('SELECT * FROM pil_mail_accounts WHERE id = ?', [$acc['id']])->fetch()); } catch (Throwable $e) { $errs[] = $acc['email'] . ' : rangement – ' . $e->getMessage(); }
                $res[] = ['email' => $acc['email']] + $s + $an + ['ranges' => $t]; }
            catch (Throwable $e) { $errs[] = $acc['email'] . ' : ' . $e->getMessage(); q('UPDATE pil_mail_accounts SET last_error = ? WHERE id = ?', [mb_substr($e->getMessage(), 0, 500), $acc['id']]); }
        }
        out(['results' => $res, 'errors' => $errs, 'brief' => pil_mail_brief($me, date('Y-m-d'))]);
    }
    if ($a === 'brief' && $method === 'GET') out(pil_mail_brief($me, date('Y-m-d')));
    // conseiller : signaux calculés (toujours) + conseil du jour de l'IA (à la demande, conservé pour la journée)
    if ($a === 'advice') {
        require_once __DIR__ . '/mail_advice.php';
        if ($method === 'GET') { $s = setting('mail_advice_' . (int)$me['id'], null); out(pil_mail_signals($me, date('Y-m-d')) + ['ai' => pil_ai_ready(), 'conseil' => is_array($s) ? $s : null]); }
        if ($method === 'POST') { pil_need($me, 'ai.ask'); @set_time_limit(120); out(pil_mail_advice_ai($me, date('Y-m-d'))); }
    }
    if ($a === 'list' && $method === 'GET') out(pil_mail_list($me, $_GET));
    if ($a === 'msgs' && $id) {
        $m = q('SELECT m.* FROM pil_mail_msgs m JOIN pil_mail_accounts a ON a.id = m.account_id WHERE m.id = ? AND m.company_id = ? AND a.user_id = ?', [$id, cid(), $me['id']])->fetch();
        if (!$m) fail(404, 'E-mail introuvable');
        if ($method === 'GET') out(pil_mail_msg_out($m) + ['body' => $m['body'], 'to' => json_decode((string)$m['to_json'], true) ?: [],
            'drafts' => array_map('pil_mail_draft_out', q('SELECT * FROM pil_mail_drafts WHERE msg_id = ? ORDER BY id DESC', [$id])->fetchAll())]);
        if ($method === 'PUT') {
            $b = body(); $st = (string)($b['state'] ?? '');
            if (!in_array($st, ['a_faire', 'fait', 'info', 'ignore'], true)) fail(400, 'État inconnu');
            q('UPDATE pil_mail_msgs SET state = ?, done_by = ?, done_at = ?, project_id = ? WHERE id = ?', [$st, $me['id'], now(), array_key_exists('project_id', $b) ? ($b['project_id'] ? (int)$b['project_id'] : null) : $m['project_id'], $id]);
            out(pil_mail_msg_out(q('SELECT * FROM pil_mail_msgs WHERE id = ?', [$id])->fetch()));
        }
        if ($method === 'POST' && ($seg[4] ?? '') === 'unmove') { pil_mail_unmove(pil_mail_account($me, (int)$m['account_id']), $m); out(pil_mail_msg_out(q('SELECT * FROM pil_mail_msgs WHERE id = ?', [$id])->fetch())); }
        if ($method === 'POST' && ($seg[4] ?? '') === 'draft') { // brouillon écrit à la main pour cet e-mail
            $d = q('SELECT id FROM pil_mail_drafts WHERE msg_id = ? AND status = ?', [$id, 'brouillon'])->fetch();
            if ($d) out(pil_mail_draft_out(q('SELECT * FROM pil_mail_drafts WHERE id = ?', [$d['id']])->fetch()));
            q('INSERT INTO pil_mail_drafts (company_id, account_id, msg_id, to_json, subject, body, origin, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
                [cid(), $m['account_id'], $id, json_encode([['email' => $m['from_email'], 'name' => $m['from_name']]]), mb_substr('RE: ' . preg_replace('/^(re|tr|fw|fwd|aw)\s*:\s*/i', '', (string)$m['subject']), 0, 500), '', 'utilisateur', 'brouillon', now(), now()]);
            out(pil_mail_draft_out(q('SELECT * FROM pil_mail_drafts WHERE id = ?', [(int)db()->lastInsertId()])->fetch()));
        }
    }
    if ($a === 'drafts' && $method === 'POST' && !$id) {
        $b = body(); $acc = pil_mail_account($me, (int)($b['account_id'] ?? 0));
        q('INSERT INTO pil_mail_drafts (company_id, account_id, msg_id, to_json, cc_json, subject, body, origin, status, created_at, updated_at) VALUES (?,?,NULL,?,?,?,?,?,?,?,?)',
            [cid(), $acc['id'], json_encode(pil_mail_rcpts($b['to'] ?? [])), json_encode(pil_mail_rcpts($b['cc'] ?? [])), mb_substr(trim((string)($b['subject'] ?? '')), 0, 500), (string)($b['body'] ?? ''), 'utilisateur', 'brouillon', now(), now()]);
        out(pil_mail_draft_out(q('SELECT * FROM pil_mail_drafts WHERE id = ?', [(int)db()->lastInsertId()])->fetch()));
    }
    if ($a === 'drafts' && $id) {
        $d = q('SELECT d.* FROM pil_mail_drafts d JOIN pil_mail_accounts a ON a.id = d.account_id WHERE d.id = ? AND d.company_id = ? AND a.user_id = ?', [$id, cid(), $me['id']])->fetch();
        if (!$d) fail(404, 'Brouillon introuvable');
        if ($method === 'PUT') {
            if ($d['status'] !== 'brouillon') fail(409, 'Ce brouillon a déjà été traité.');
            $b = body();
            q('UPDATE pil_mail_drafts SET to_json = ?, cc_json = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?', [json_encode(pil_mail_rcpts($b['to'] ?? [])), json_encode(pil_mail_rcpts($b['cc'] ?? [])), mb_substr(trim((string)($b['subject'] ?? '')), 0, 500), (string)($b['body'] ?? ''), now(), $id]);
            out(pil_mail_draft_out(q('SELECT * FROM pil_mail_drafts WHERE id = ?', [$id])->fetch()));
        }
        if ($method === 'POST' && ($seg[4] ?? '') === 'send') out(pil_mail_send($me, $id, body()));
        if ($method === 'POST' && ($seg[4] ?? '') === 'reject') { q("UPDATE pil_mail_drafts SET status = 'rejete', updated_at = ? WHERE id = ? AND status = 'brouillon'", [now(), $id]); out(['ok' => true]); }
    }
    fail(404, 'Route inconnue');
}
