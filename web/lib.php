<?php
// Fonctions communes : base de données, session, réponses JSON.
declare(strict_types=1);

const APP_VERSION = '1.0.0';
const MAX_UPLOAD = 32 * 1024 * 1024;
// Types de documents numérotés automatiquement à la création (préfixe par défaut)
const NUMBERED = ['quote' => 'DEV', 'order' => 'BC', 'project' => 'CH', 'intervention' => 'INT', 'opportunity' => 'OPP'];

function config(): array {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        if (!is_file($f)) fail(503, "L'application n'est pas installée. Ouvrez install.php.");
        $c = require $f;
    }
    return $c;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $d = config()['db'];
        $pdo = new PDO("mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4", $d['user'], $d['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function now(): string { return date('Y-m-d H:i:s'); }

function out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $code, string $msg): void { out(['error' => $msg], $code); }

function body(): array {
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input');
        $b = $raw ? json_decode($raw, true) : [];
        if (!is_array($b)) fail(400, 'Requête invalide');
    }
    return $b;
}

function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('BPSESS');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}

function current_user(): ?array {
    start_session();
    if (empty($_SESSION['uid'])) return null;
    static $u = false;
    if ($u === false) {
        $u = q('SELECT id, name, email, role, active, color FROM users WHERE id = ?', [$_SESSION['uid']])->fetch() ?: null;
        if ($u && !$u['active']) $u = null;
        if ($u) { $u['id'] = (int)$u['id']; $u['active'] = (int)$u['active']; }
    }
    return $u;
}

function require_user(): array {
    $u = current_user();
    if (!$u) fail(401, 'Session expirée, reconnectez-vous.');
    return $u;
}

function require_admin(): array {
    $u = require_user();
    if ($u['role'] !== 'admin') fail(403, 'Réservé aux administrateurs.');
    return $u;
}

function client_ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '?', 0, 64); }

function setting(string $k, $default = null) {
    $r = q('SELECT v FROM settings WHERE k = ?', [$k])->fetch();
    return $r ? json_decode($r['v'], true) : $default;
}

function set_setting(string $k, $v): void {
    q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$k, json_encode($v, JSON_UNESCAPED_UNICODE)]);
}

// Compteur atomique (à appeler dans une transaction)
function next_counter(string $key): int {
    q('INSERT INTO counters (k, n) VALUES (?, 0) ON DUPLICATE KEY UPDATE n = n', [$key]);
    $n = (int)q('SELECT n FROM counters WHERE k = ? FOR UPDATE', [$key])->fetchColumn() + 1;
    q('UPDATE counters SET n = ? WHERE k = ?', [$n, $key]);
    return $n;
}

function make_number(string $kind): string {
    $prefixes = setting('prefixes', []) ?: [];
    $defaults = NUMBERED + ['invoice' => 'FAC', 'avoir' => 'NC'];
    $prefix = $prefixes[$kind] ?? ($defaults[$kind] ?? strtoupper(substr($kind, 0, 3)));
    $y = date('Y');
    $n = next_counter("$kind-$y");
    $pad = max(1, min(6, (int)setting('numpad', 4)));
    return ($prefix !== '' ? $prefix . '-' : '') . $y . '-' . str_pad((string)$n, $pad, '0', STR_PAD_LEFT);
}

function log_activity(int $uid, string $action, string $type, ?int $id, ?int $pid, ?string $label): void {
    q('INSERT INTO activity (user_id, action, type, item_id, project_id, label, created_at) VALUES (?,?,?,?,?,?,?)',
      [$uid, $action, $type, $id, $pid, $label !== null ? mb_substr($label, 0, 250) : null, now()]);
}

function row_out(array $r): array {
    return [
        'id' => (int)$r['id'], 'type' => $r['type'],
        'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null,
        'parent_id' => $r['parent_id'] !== null ? (int)$r['parent_id'] : null,
        'number' => $r['number'], 'version' => (int)$r['version'],
        'created_by' => $r['created_by'] !== null ? (int)$r['created_by'] : null,
        'updated_by' => $r['updated_by'] !== null ? (int)$r['updated_by'] : null,
        'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'],
        'data' => json_decode($r['data'], true) ?: new stdClass(),
    ];
}

// ---------------------------------------------------------------- Envoi d'emails (SMTP configuré dans les paramètres, sinon mail() de l'hébergement)
function mail_header_enc(string $s): string {
    return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}
function mail_addr(string $email, string $name = ''): string {
    $name = trim(preg_replace('/[\r\n"<>]+/', ' ', $name));
    return $name !== '' ? mail_header_enc($name) . " <$email>" : $email;
}

// $atts : [['name' => ..., 'mime' => ..., 'data' => contenu binaire], ...]
function send_mail(array $to, array $cc, string $subject, string $text, array $atts, array $replyTo = []): void {
    $cfg = setting('smtp', []) ?: [];
    $co = setting('company', []) ?: [];
    $host = preg_replace('/^www\./', '', strtolower((string)($_SERVER['HTTP_HOST'] ?? 'localhost')));
    $host = preg_replace('/:\d+$/', '', $host);
    $from = trim((string)($cfg['from'] ?? '')) ?: (trim((string)($cfg['user'] ?? '')) ?: 'noreply@' . $host);
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) $from = 'noreply@' . $host;
    $fromName = trim((string)($cfg['fromName'] ?? '')) ?: (string)($co['name'] ?? 'BâtiPro');

    $b = 'b' . bin2hex(random_bytes(12));
    $h = [
        'Date: ' . date('r'),
        'From: ' . mail_addr($from, $fromName),
        'To: ' . implode(', ', array_map(fn($a) => mail_addr($a['email'], $a['name'] ?? ''), $to)),
    ];
    if ($cc) $h[] = 'Cc: ' . implode(', ', array_map(fn($a) => mail_addr($a['email'], $a['name'] ?? ''), $cc));
    if ($replyTo) $h[] = 'Reply-To: ' . mail_addr($replyTo['email'], $replyTo['name'] ?? '');
    $h[] = 'Message-ID: <' . bin2hex(random_bytes(10)) . '@' . (strpos($from, '@') ? substr($from, strpos($from, '@') + 1) : $host) . '>';
    $h[] = 'MIME-Version: 1.0';
    $h[] = 'X-Mailer: BatiPro';
    $h[] = "Content-Type: multipart/mixed; boundary=\"$b\"";
    $body = "--$b\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode(str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $text)));
    foreach ($atts as $a) {
        $fn = preg_replace('/[\r\n"\\\\]+/', '_', (string)$a['name']);
        $body .= "--$b\r\nContent-Type: " . ($a['mime'] ?: 'application/octet-stream') . "; name=\"" . mail_header_enc($fn) . "\"\r\n"
            . "Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"" . mail_header_enc($fn) . "\"\r\n\r\n"
            . chunk_split(base64_encode($a['data']));
    }
    $body .= "--$b--\r\n";
    $subj = mail_header_enc($subject);
    $rcpt = array_merge(array_column($to, 'email'), array_column($cc, 'email'));

    if (!empty($cfg['host'])) {
        smtp_send($cfg, $from, $rcpt, 'Subject: ' . $subj . "\r\n" . implode("\r\n", $h) . "\r\n\r\n" . $body);
        return;
    }
    if (!function_exists('mail')) throw new RuntimeException("La fonction mail() est désactivée sur l'hébergement : configurez un serveur SMTP dans Paramètres › Email.");
    // mail() ajoute lui-même To et Subject
    $hdr = array_values(array_filter($h, fn($l) => strncmp($l, 'To: ', 4) !== 0));
    $toLine = implode(', ', array_map(fn($a) => mail_addr($a['email'], $a['name'] ?? ''), $to));
    $ok = @mail($toLine, $subj, $body, implode("\r\n", $hdr), '-f' . $from);
    if (!$ok) throw new RuntimeException("L'hébergement a refusé l'envoi (mail()). Configurez un serveur SMTP dans Paramètres › Email.");
}

function smtp_send(array $cfg, string $from, array $rcpt, string $data): void {
    $port = (int)($cfg['port'] ?? 0) ?: 587;
    $sec = (string)($cfg['secure'] ?? ($port === 465 ? 'ssl' : 'tls'));
    $remote = ($sec === 'ssl' ? 'ssl://' : 'tcp://') . $cfg['host'] . ':' . $port;
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
    $fp = @stream_socket_client($remote, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) throw new RuntimeException("Connexion SMTP impossible ({$cfg['host']}:$port) : $errstr");
    stream_set_timeout($fp, 30);
    $read = function () use ($fp): array {
        $all = '';
        while (($line = fgets($fp, 1024)) !== false) { $all .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; }
        return [(int)substr($all, 0, 3), trim($all)];
    };
    $cmd = function (string $c, array $okCodes, string $show = '') use ($fp, $read): array {
        fwrite($fp, $c . "\r\n");
        [$code, $msg] = $read();
        if (!in_array($code, $okCodes, true)) throw new RuntimeException('Erreur SMTP' . ($show ? " ($show)" : '') . ' : ' . $msg);
        return [$code, $msg];
    };
    try {
        [$code, $msg] = $read();
        if ($code !== 220) throw new RuntimeException('Serveur SMTP : ' . $msg);
        $ehlo = preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
        [, $caps] = $cmd("EHLO $ehlo", [250], 'EHLO');
        if ($sec === 'tls') {
            $cmd('STARTTLS', [220], 'STARTTLS');
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new RuntimeException('Échec du chiffrement TLS');
            [, $caps] = $cmd("EHLO $ehlo", [250], 'EHLO');
        }
        if (!empty($cfg['user'])) {
            $cmd('AUTH LOGIN', [334], 'AUTH');
            $cmd(base64_encode((string)$cfg['user']), [334], 'utilisateur');
            $cmd(base64_encode((string)($cfg['pass'] ?? '')), [235], 'identifiant ou mot de passe');
        }
        $cmd("MAIL FROM:<$from>", [250], 'expéditeur');
        foreach ($rcpt as $r) $cmd("RCPT TO:<$r>", [250, 251], $r);
        $cmd('DATA', [354], 'DATA');
        $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\r", "\n"], ["\n", "\n", "\r\n"], $data));
        $cmd($data . "\r\n.", [250], 'envoi');
        fwrite($fp, "QUIT\r\n");
    } finally {
        fclose($fp);
    }
}
