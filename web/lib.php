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
    return ($prefix !== '' ? $prefix . '-' : '') . $y . '-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
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
