<?php
/*
 * Foto Șantier – serverul pentru hosting cPanel (PHP 7.4+ cu SQLite).
 * Toate cererile către api/* și files/* ajung aici (vezi .htaccess).
 * Sincronizare Google Drive din cron (opțional):  php api.php drive-sync
 */
declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '0');

$CONFIG = [
    'data_dir' => __DIR__ . '/data',
    'drive_folder_name' => 'Poze Șantier',
    'public_url' => '',
];
if (is_file(__DIR__ . '/config.php')) $CONFIG = array_merge($CONFIG, (array) require __DIR__ . '/config.php');

const ROLES = ['admin', 'responsabil', 'muncitor'];
$DATA = rtrim($CONFIG['data_dir'], '/');
$PHOTOS = $DATA . '/photos';

// ---------------------------------------------------------------- baza de date
function init_storage(): PDO {
    global $DATA, $PHOTOS;
    if (!is_dir($PHOTOS) && !@mkdir($PHOTOS, 0755, true)) {
        fail(500, 'Nu pot crea folderul de date. Verifică permisiunile pentru: ' . $GLOBALS['DATA']);
    }
    if (!is_file($DATA . '/.htaccess')) {
        @file_put_contents($DATA . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    }
    if (!is_file($DATA . '/index.html')) @file_put_contents($DATA . '/index.html', '');
    $db = new PDO('sqlite:' . $DATA . '/santier.db', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    $db->exec("
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','responsabil','muncitor')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, drive_folder_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS site_users (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (site_id, user_id));
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY, client_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('photo','note')),
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL DEFAULT '', file TEXT, thumb TEXT, size INTEGER NOT NULL DEFAULT 0, taken_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), drive_status TEXT NOT NULL DEFAULT 'pending', drive_file_id TEXT);
CREATE INDEX IF NOT EXISTS idx_entries_site ON entries(site_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_drive ON entries(drive_status);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS login_fail (k TEXT NOT NULL, at INTEGER NOT NULL);
");
    return $db;
}

function q(string $sql, array $p = []): PDOStatement {
    global $db;
    $st = $db->prepare($sql);
    $st->execute($p);
    return $st;
}
function one(string $sql, array $p = []) { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function val(string $sql, array $p = []) { $r = q($sql, $p)->fetchColumn(); return $r === false ? null : $r; }
function tx(callable $fn) {
    global $db;
    $db->beginTransaction();
    try { $r = $fn(); $db->commit(); return $r; } catch (Throwable $e) { $db->rollBack(); throw $e; }
}
function setting(string $k) { return val('SELECT value FROM settings WHERE key = ?', [$k]); }
function set_setting(string $k, $v): void {
    if ($v === null) q('DELETE FROM settings WHERE key = ?', [$k]);
    else q('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [$k, (string) $v]);
}

// ---------------------------------------------------------------- HTTP
function out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
}
function fail(int $code, string $msg): void { out(['error' => $msg], $code); exit; }
function body(): array {
    static $b = null;
    if ($b === null) { $b = json_decode((string) file_get_contents('php://input'), true); if (!is_array($b)) $b = []; }
    return $b;
}
function clean($s, int $max = 200): string {
    $s = trim((string) ($s ?? ''));
    return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
}
function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') || (($_SERVER['SERVER_PORT'] ?? '') == 443);
}
function base_path(): string { return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/'); }
function base_url(): string {
    global $CONFIG;
    if ($CONFIG['public_url']) return rtrim($CONFIG['public_url'], '/');
    return (is_https() ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . base_path();
}
function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? ''; }
function uuid(): string {
    $b = random_bytes(16);
    $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
    $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
}
// Trimite răspunsul acum și continuă în fundal (pentru Google Drive).
function finish_request(): void {
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); return; }
    if (function_exists('litespeed_finish_request')) { litespeed_finish_request(); return; }
    @ob_end_flush(); @flush();
}

// ---------------------------------------------------------------- autentificare
function set_session(int $userId): void {
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO sessions(token, user_id) VALUES (?, ?)', [$token, $userId]);
    setcookie('sid', $token, ['expires' => time() + 31536000, 'path' => base_path() . '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_https()]);
}
function current_user() {
    $sid = $_COOKIE['sid'] ?? '';
    if (!$sid) return null;
    $u = one('SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1', [$sid]);
    if ($u) $u['id'] = (int) $u['id'];
    return $u;
}
function need(string ...$roles): array {
    $u = current_user();
    if (!$u) fail(401, 'Nu ești conectat');
    if ($roles && !in_array($u['role'], $roles, true)) fail(403, 'Nu ai acces');
    return $u;
}
function is_admin(array $u): bool { return $u['role'] === 'admin'; }
function assigned(int $userId): array {
    return array_map('intval', array_column(all('SELECT site_id FROM site_users WHERE user_id = ?', [$userId]), 'site_id'));
}
function can_use_site(array $u, $siteId): bool { return is_admin($u) || in_array((int) $siteId, assigned($u['id']), true); }
// Vede: adminul tot; ceilalți pozele proprii + toate pozele de pe șantierele atribuite.
// (Pozele „Fără șantier” ale altora le vede doar adminul.)
function can_see_entry(array $u, array $e): bool {
    if (is_admin($u) || (int) $e['user_id'] === $u['id']) return true;
    return $e['site_id'] !== null && in_array((int) $e['site_id'], assigned($u['id']), true);
}
// Comentariu / mutare: autorul, adminul și responsabilul șantierului.
function can_edit_entry(array $u, array $e): bool {
    if (is_admin($u) || (int) $e['user_id'] === $u['id']) return true;
    return $u['role'] === 'responsabil' && can_see_entry($u, $e);
}
// Ștergere: doar autorul și adminul.
function can_delete_entry(array $u, array $e): bool { return is_admin($u) || (int) $e['user_id'] === $u['id']; }
function set_site_users(int $siteId, array $ids): void {
    q('DELETE FROM site_users WHERE site_id = ?', [$siteId]);
    foreach (array_unique(array_map('intval', $ids)) as $uid) {
        q('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT ?, id FROM users WHERE id = ?', [$siteId, $uid]);
    }
}
function set_user_sites(int $userId, array $ids): void {
    q('DELETE FROM site_users WHERE user_id = ?', [$userId]);
    foreach (array_unique(array_map('intval', $ids)) as $sid) {
        q('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT id, ? FROM sites WHERE id = ?', [$userId, $sid]);
    }
}

// ---------------------------------------------------------------- intrări (poze / note)
const ENTRY_SELECT = "SELECT e.id, e.client_id, e.kind, e.site_id, e.user_id, e.comment, e.taken_at, e.size, e.drive_status,
  s.name AS site_name, u.name AS user_name FROM entries e LEFT JOIN sites s ON s.id = e.site_id LEFT JOIN users u ON u.id = e.user_id";
function fix_entry(array $e): array {
    foreach (['id', 'site_id', 'user_id', 'size'] as $k) if ($e[$k] !== null) $e[$k] = (int) $e[$k];
    return $e;
}
function get_entry(int $id): array { return fix_entry(one(ENTRY_SELECT . ' WHERE e.id = ?', [$id])); }
function norm_date($s): string {
    $t = is_string($s) ? strtotime($s) : false;
    if ($t === false || $t > time() + 86400) $t = time();
    return gmdate('Y-m-d\TH:i:s.000\Z', $t);
}
function resolve_site(array $u, $siteId) {
    if ($siteId === null || $siteId === '') return null;
    return can_use_site($u, $siteId) && val('SELECT 1 FROM sites WHERE id = ?', [(int) $siteId]) ? (int) $siteId : null;
}
function is_jpeg(string $b): bool { return strlen($b) > 3 && substr($b, 0, 3) === "\xFF\xD8\xFF"; }

// ---------------------------------------------------------------- Google Drive
function drive_client(): array { return [setting('drive_client_id') ?: '', setting('drive_client_secret') ?: '']; }
function drive_configured(): bool { [$id, $s] = drive_client(); return $id !== '' && $s !== ''; }
function drive_connected(): bool { return drive_configured() && (bool) setting('drive_refresh_token'); }

function http_req(string $method, string $url, array $headers = [], $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 15]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $res = curl_exec($ch);
    if ($res === false) { $err = curl_error($ch); curl_close($ch); throw new RuntimeException('Rețea: ' . $err); }
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode((string) $res, true) ?: []];
}
function google_token(array $params): array {
    [$id, $sec] = drive_client();
    [$code, $j] = http_req('POST', 'https://oauth2.googleapis.com/token', ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query(array_merge(['client_id' => $id, 'client_secret' => $sec], $params)));
    if ($code >= 400) throw new RuntimeException($j['error_description'] ?? ($j['error'] ?? 'Eroare Google'));
    return $j;
}
function drive_access_token(): string {
    $tok = setting('drive_access_token');
    $exp = (int) setting('drive_access_exp');
    if ($tok && $exp > time() + 60) return $tok;
    $j = google_token(['refresh_token' => setting('drive_refresh_token'), 'grant_type' => 'refresh_token']);
    set_setting('drive_access_token', $j['access_token']);
    set_setting('drive_access_exp', time() + (int) $j['expires_in']);
    return $j['access_token'];
}
class DriveError extends RuntimeException {}
function gapi(string $method, string $url, $body = null, string $ctype = 'application/json'): array {
    $h = ['Authorization: Bearer ' . drive_access_token()];
    if ($body !== null) $h[] = 'Content-Type: ' . $ctype;
    [$code, $j] = http_req($method, $url, $h, $body);
    if ($code >= 400) throw new DriveError($j['error']['message'] ?? ('Drive HTTP ' . $code), $code);
    return $j;
}
function folder_ok($id): bool {
    if (!$id) return false;
    try { $f = gapi('GET', "https://www.googleapis.com/drive/v3/files/$id?fields=id,trashed"); return empty($f['trashed']); }
    catch (DriveError $e) { if ($e->getCode() === 404) return false; throw $e; }
}
function create_folder(string $name, $parent = null): string {
    $meta = ['name' => $name, 'mimeType' => 'application/vnd.google-apps.folder'];
    if ($parent) $meta['parents'] = [$parent];
    return gapi('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', json_encode($meta, JSON_UNESCAPED_UNICODE))['id'];
}
function root_folder(): string {
    global $CONFIG;
    $id = setting('drive_root_id');
    if (folder_ok($id)) return $id;
    $id = create_folder($CONFIG['drive_folder_name']);
    set_setting('drive_root_id', $id);
    return $id;
}
function site_folder($siteId): string {
    $site = $siteId ? one('SELECT id, name, drive_folder_id FROM sites WHERE id = ?', [(int) $siteId]) : null;
    if (!$site) {
        $id = setting('drive_nosite_id');
        if (folder_ok($id)) return $id;
        $id = create_folder('Fără șantier', root_folder());
        set_setting('drive_nosite_id', $id);
        return $id;
    }
    if (folder_ok($site['drive_folder_id'])) return $site['drive_folder_id'];
    $id = create_folder($site['name'], root_folder());
    q('UPDATE sites SET drive_folder_id = ? WHERE id = ?', [$id, $site['id']]);
    return $id;
}
function drive_upload(array $e): string {
    global $PHOTOS;
    $d = str_replace(['T', ':'], ['_', '-'], substr($e['taken_at'], 0, 19));
    $who = trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '_', $e['user_name'] ?: 'necunoscut'), '_');
    $meta = ['name' => "{$d}_{$who}_{$e['id']}.jpg", 'parents' => [site_folder($e['site_id'])]];
    if ($e['comment'] !== '') $meta['description'] = $e['comment'];
    $b = 'b' . bin2hex(random_bytes(8));
    $body = "--$b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" . json_encode($meta, JSON_UNESCAPED_UNICODE)
        . "\r\n--$b\r\nContent-Type: image/jpeg\r\n\r\n" . file_get_contents($PHOTOS . '/' . $e['file']) . "\r\n--$b--";
    return gapi('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', $body, "multipart/related; boundary=$b")['id'];
}
function drive_update(int $entryId): void {
    $e = one('SELECT * FROM entries WHERE id = ?', [$entryId]);
    if (!drive_connected() || !$e || !$e['drive_file_id']) return;
    try {
        $cur = gapi('GET', "https://www.googleapis.com/drive/v3/files/{$e['drive_file_id']}?fields=parents");
        $qs = http_build_query(['addParents' => site_folder($e['site_id']), 'removeParents' => implode(',', $cur['parents'] ?? [])]);
        gapi('PATCH', "https://www.googleapis.com/drive/v3/files/{$e['drive_file_id']}?$qs", json_encode(['description' => $e['comment']], JSON_UNESCAPED_UNICODE));
    } catch (Throwable $err) { error_log('Drive update: ' . $err->getMessage()); }
}
function drive_delete($fileId): void {
    if (!drive_connected() || !$fileId) return;
    try { gapi('DELETE', "https://www.googleapis.com/drive/v3/files/$fileId"); }
    catch (Throwable $e) { if ($e->getCode() !== 404) error_log('Drive delete: ' . $e->getMessage()); }
}
// Trimite pozele care așteaptă, cel mult $seconds secunde. Un singur proces o dată.
function drive_work(int $seconds = 25): void {
    global $DATA;
    if (!drive_connected()) return;
    $lock = fopen($DATA . '/drive.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;
    @set_time_limit($seconds + 60);
    $end = time() + $seconds;
    try {
        while (time() < $end) {
            $e = one("SELECT e.*, u.name AS user_name FROM entries e LEFT JOIN users u ON u.id = e.user_id
                WHERE e.kind='photo' AND e.drive_status='pending' ORDER BY e.id LIMIT 1");
            if (!$e) break;
            $id = drive_upload($e);
            q("UPDATE entries SET drive_status='done', drive_file_id=? WHERE id=?", [$id, $e['id']]);
            $now = one('SELECT site_id, comment FROM entries WHERE id = ?', [$e['id']]);
            if ($now && ($now['site_id'] !== $e['site_id'] || $now['comment'] !== $e['comment'])) drive_update((int) $e['id']);
        }
        set_setting('drive_last_error', null);
    } catch (Throwable $err) {
        set_setting('drive_last_error', $err->getMessage());
        error_log('Drive: ' . $err->getMessage());
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// ================================================================ pornire
try {
    $db = init_storage();
} catch (Throwable $e) {
    if (PHP_SAPI === 'cli') { fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
    fail(500, 'Baza de date nu poate fi deschisă: ' . $e->getMessage());
}

if (PHP_SAPI === 'cli') {
    if (($argv[1] ?? '') === 'drive-sync') { drive_work(280); echo "ok\n"; }
    else echo "Folosire: php api.php drive-sync\n";
    exit;
}

$uriPath = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
$path = trim(substr($uriPath, strlen(base_path())), '/');
$method = $_SERVER['REQUEST_METHOD'];
$override = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($method === 'POST' && in_array($override, ['PATCH', 'DELETE'], true)) $method = $override;
$route = $method . ' ' . $path;
$m = [];

try {
    route($route, $path, $method);
} catch (Throwable $e) {
    error_log('Foto Șantier: ' . $e);
    if (!headers_sent()) fail(500, 'Eroare pe server');
}

function route(string $route, string $path, string $method): void {
    global $PHOTOS, $db;

    // ---------- autentificare
    if ($route === 'GET api/state') {
        $needs = (int) val('SELECT COUNT(*) FROM users') === 0;
        out(['needsSetup' => $needs, 'user' => $needs ? null : current_user()]);
        return;
    }
    if ($route === 'POST api/setup') {
        if ((int) val('SELECT COUNT(*) FROM users') > 0) fail(400, 'Aplicația este deja configurată');
        $b = body();
        $name = clean($b['name'] ?? '', 80); $user = clean($b['username'] ?? '', 40); $pw = (string) ($b['password'] ?? '');
        if (!$name || !$user || strlen($pw) < 6) fail(400, 'Completează numele, utilizatorul și o parolă de minim 6 caractere');
        q("INSERT INTO users(name, username, pass_hash, role) VALUES (?, ?, ?, 'admin')", [$name, $user, password_hash($pw, PASSWORD_DEFAULT)]);
        set_session((int) $db->lastInsertId());
        out(['ok' => true]);
        return;
    }
    if ($route === 'POST api/login') {
        $b = body();
        $user = clean($b['username'] ?? '', 40);
        $k = client_ip() . '|' . strtolower($user);
        q('DELETE FROM login_fail WHERE at < ?', [time() - 600]);
        if ((int) val('SELECT COUNT(*) FROM login_fail WHERE k = ?', [$k]) >= 10) fail(429, 'Prea multe încercări. Așteaptă 10 minute.');
        $u = one('SELECT * FROM users WHERE username = ? AND active = 1', [$user]);
        if (!$u || !password_verify((string) ($b['password'] ?? ''), $u['pass_hash'])) {
            q('INSERT INTO login_fail(k, at) VALUES (?, ?)', [$k, time()]);
            fail(401, 'Utilizator sau parolă greșită');
        }
        q('DELETE FROM login_fail WHERE k = ?', [$k]);
        set_session((int) $u['id']);
        out(['ok' => true]);
        return;
    }
    if ($route === 'POST api/logout') {
        if (!empty($_COOKIE['sid'])) q('DELETE FROM sessions WHERE token = ?', [$_COOKIE['sid']]);
        setcookie('sid', '', ['expires' => 1, 'path' => base_path() . '/', 'httponly' => true, 'samesite' => 'Lax']);
        out(['ok' => true]);
        return;
    }
    if ($route === 'GET api/me') {
        $u = need();
        $sites = is_admin($u)
            ? all('SELECT id, name, address FROM sites WHERE archived = 0 ORDER BY name COLLATE NOCASE')
            : all('SELECT s.id, s.name, s.address FROM sites s JOIN site_users su ON su.site_id = s.id WHERE su.user_id = ? AND s.archived = 0 ORDER BY s.name COLLATE NOCASE', [$u['id']]);
        foreach ($sites as &$s) $s['id'] = (int) $s['id'];
        out(['user' => $u, 'sites' => $sites]);
        return;
    }
    if ($route === 'POST api/password') {
        $u = need();
        $b = body();
        $hash = val('SELECT pass_hash FROM users WHERE id = ?', [$u['id']]);
        if (!password_verify((string) ($b['old'] ?? ''), $hash)) fail(400, 'Parola actuală e greșită');
        if (strlen((string) ($b['password'] ?? '')) < 4) fail(400, 'Parola nouă trebuie să aibă minim 4 caractere');
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash((string) $b['password'], PASSWORD_DEFAULT), $u['id']]);
        out(['ok' => true]);
        return;
    }

    // ---------- șantiere
    if ($route === 'GET api/sites') {
        $u = need('admin', 'responsabil');
        $where = is_admin($u) ? '' : 'WHERE s.id IN (SELECT site_id FROM site_users WHERE user_id = :uid)';
        $sites = all("SELECT s.id, s.name, s.address, s.archived, s.created_at,
            (SELECT COUNT(*) FROM entries e WHERE e.site_id = s.id) AS count,
            (SELECT MAX(taken_at) FROM entries e WHERE e.site_id = s.id) AS last_at,
            (SELECT id FROM entries e WHERE e.site_id = s.id AND e.kind='photo' ORDER BY taken_at DESC LIMIT 1) AS cover_id
            FROM sites s $where ORDER BY s.archived, s.name COLLATE NOCASE", is_admin($u) ? [] : ['uid' => $u['id']]);
        $members = all('SELECT su.site_id, u.id, u.name, u.role FROM site_users su JOIN users u ON u.id = su.user_id ORDER BY u.name');
        foreach ($sites as &$s) {
            foreach (['id', 'archived', 'count'] as $k) $s[$k] = (int) $s[$k];
            $s['cover_id'] = $s['cover_id'] === null ? null : (int) $s['cover_id'];
            $s['users'] = [];
            foreach ($members as $mm) if ((int) $mm['site_id'] === $s['id']) $s['users'][] = ['id' => (int) $mm['id'], 'name' => $mm['name'], 'role' => $mm['role']];
        }
        unset($s);
        $un = is_admin($u) ? (int) val('SELECT COUNT(*) FROM entries WHERE site_id IS NULL') : null;
        out(['sites' => $sites, 'unassigned' => $un]);
        return;
    }
    if ($route === 'POST api/sites') {
        $u = need('admin', 'responsabil');
        $b = body();
        $name = clean($b['name'] ?? '', 120);
        if (!$name) fail(400, 'Scrie numele șantierului');
        $id = tx(function () use ($u, $b, $name, $db) {
            q('INSERT INTO sites(name, address, created_by) VALUES (?, ?, ?)', [$name, clean($b['address'] ?? '', 250), $u['id']]);
            $id = (int) $db->lastInsertId();
            $ids = is_array($b['userIds'] ?? null) ? $b['userIds'] : [];
            if ($u['role'] === 'responsabil') $ids[] = $u['id'];
            set_site_users($id, $ids);
            return $id;
        });
        out(['id' => $id]);
        return;
    }
    if (preg_match('#^(PATCH|DELETE) api/sites/(\d+)$#', $route, $m)) {
        $id = (int) $m[2];
        if ($m[1] === 'DELETE') {
            need('admin');
            q('DELETE FROM sites WHERE id = ?', [$id]);
            out(['ok' => true]);
            return;
        }
        $u = need('admin', 'responsabil');
        $site = one('SELECT * FROM sites WHERE id = ?', [$id]);
        if (!$site) fail(404, 'Șantier inexistent');
        if (!can_use_site($u, $id)) fail(403, 'Nu ai acces la acest șantier');
        $b = body();
        $name = array_key_exists('name', $b) ? clean($b['name'], 120) : $site['name'];
        if (!$name) fail(400, 'Scrie numele șantierului');
        $addr = array_key_exists('address', $b) ? clean($b['address'], 250) : $site['address'];
        $arch = array_key_exists('archived', $b) ? ($b['archived'] ? 1 : 0) : (int) $site['archived'];
        tx(function () use ($id, $name, $addr, $arch, $b, $u) {
            q('UPDATE sites SET name = ?, address = ?, archived = ? WHERE id = ?', [$name, $addr, $arch, $id]);
            if (is_array($b['userIds'] ?? null)) {
                $ids = $b['userIds'];
                if ($u['role'] === 'responsabil') $ids[] = $u['id'];
                set_site_users($id, $ids);
            }
        });
        out(['ok' => true]);
        if ($name !== $site['name'] && $site['drive_folder_id'] && drive_connected()) {
            finish_request();
            try { gapi('PATCH', "https://www.googleapis.com/drive/v3/files/{$site['drive_folder_id']}", json_encode(['name' => $name], JSON_UNESCAPED_UNICODE)); }
            catch (Throwable $e) { error_log('Drive rename: ' . $e->getMessage()); }
        }
        return;
    }

    // ---------- utilizatori
    if ($route === 'GET api/users') {
        $u = need('admin', 'responsabil');
        if (!is_admin($u)) {
            $rows = all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE');
            foreach ($rows as &$r) $r['id'] = (int) $r['id'];
            out($rows);
            return;
        }
        $users = all('SELECT u.id, u.name, u.username, u.role, u.active, (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id) AS count
            FROM users u ORDER BY u.active DESC, u.name COLLATE NOCASE');
        $links = all('SELECT user_id, site_id FROM site_users');
        foreach ($users as &$x) {
            foreach (['id', 'active', 'count'] as $k) $x[$k] = (int) $x[$k];
            $x['siteIds'] = [];
            foreach ($links as $l) if ((int) $l['user_id'] === $x['id']) $x['siteIds'][] = (int) $l['site_id'];
        }
        out($users);
        return;
    }
    if ($route === 'POST api/users') {
        need('admin');
        $b = body();
        $name = clean($b['name'] ?? '', 80); $user = clean($b['username'] ?? '', 40); $pw = (string) ($b['password'] ?? '');
        $role = in_array($b['role'] ?? '', ROLES, true) ? $b['role'] : 'muncitor';
        if (!$name || !$user) fail(400, 'Completează numele și utilizatorul');
        if (strlen($pw) < 4) fail(400, 'Parola trebuie să aibă minim 4 caractere');
        if (val('SELECT 1 FROM users WHERE username = ?', [$user])) fail(400, 'Utilizatorul există deja');
        $id = tx(function () use ($name, $user, $pw, $role, $b, $db) {
            q('INSERT INTO users(name, username, pass_hash, role) VALUES (?, ?, ?, ?)', [$name, $user, password_hash($pw, PASSWORD_DEFAULT), $role]);
            $id = (int) $db->lastInsertId();
            set_user_sites($id, is_array($b['siteIds'] ?? null) ? $b['siteIds'] : []);
            return $id;
        });
        out(['id' => $id]);
        return;
    }
    if (preg_match('#^PATCH api/users/(\d+)$#', $route, $m)) {
        $me = need('admin');
        $id = (int) $m[1];
        $u = one('SELECT * FROM users WHERE id = ?', [$id]);
        if (!$u) fail(404, 'Utilizator inexistent');
        $b = body();
        $role = in_array($b['role'] ?? '', ROLES, true) ? $b['role'] : $u['role'];
        $active = array_key_exists('active', $b) ? ($b['active'] ? 1 : 0) : (int) $u['active'];
        if ($id === $me['id'] && ($role !== 'admin' || !$active)) fail(400, 'Nu îți poți scoate singur drepturile de admin');
        $username = array_key_exists('username', $b) ? clean($b['username'], 40) : $u['username'];
        if (!$username) fail(400, 'Utilizator gol');
        if (val('SELECT 1 FROM users WHERE username = ? AND id != ?', [$username, $id])) fail(400, 'Utilizatorul există deja');
        $pw = (string) ($b['password'] ?? '');
        if ($pw !== '' && strlen($pw) < 4) fail(400, 'Parola trebuie să aibă minim 4 caractere');
        $name = array_key_exists('name', $b) ? (clean($b['name'], 80) ?: $u['name']) : $u['name'];
        tx(function () use ($id, $name, $username, $role, $active, $pw, $b, $me) {
            q('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?', [$name, $username, $role, $active, $id]);
            if ($pw !== '') {
                q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $id]);
                if ($id !== $me['id']) q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            }
            if (!$active) q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            if (is_array($b['siteIds'] ?? null)) set_user_sites($id, $b['siteIds']);
        });
        out(['ok' => true]);
        return;
    }

    // ---------- poze și note
    if ($route === 'POST api/entries/photo') {
        $u = need();
        $meta = json_decode(rawurldecode($_SERVER['HTTP_X_META'] ?? ''), true) ?: [];
        $cid = clean($meta['clientId'] ?? '', 64);
        if (!$cid) fail(400, 'Lipsește clientId');
        $ex = one('SELECT id, user_id FROM entries WHERE client_id = ?', [$cid]);
        if ($ex) { if ((int) $ex['user_id'] !== $u['id']) fail(409, 'Conflict'); out(get_entry((int) $ex['id'])); return; }
        $raw = (string) file_get_contents('php://input');
        if (strlen($raw) < 8) fail(400, 'Fișier lipsă (verifică post_max_size în PHP)');
        $tlen = unpack('N', substr($raw, 0, 4))[1];
        $full = substr($raw, 4 + $tlen);
        $thumb = $tlen > 0 ? substr($raw, 4, $tlen) : $full; // fără miniatură: folosim poza
        if (!is_jpeg($thumb) || !is_jpeg($full)) fail(400, 'Format invalid (doar JPEG)');
        $taken = norm_date($meta['takenAt'] ?? null);
        $dir = substr($taken, 0, 7);
        if (!is_dir("$PHOTOS/$dir")) mkdir("$PHOTOS/$dir", 0755, true);
        $base = $dir . '/' . uuid();
        if (file_put_contents("$PHOTOS/$base.jpg", $full) === false || file_put_contents("$PHOTOS/{$base}_t.jpg", $thumb) === false) {
            fail(500, 'Nu pot salva poza (spațiu pe disc?)');
        }
        q("INSERT INTO entries(client_id, kind, site_id, user_id, comment, file, thumb, size, taken_at) VALUES (?, 'photo', ?, ?, ?, ?, ?, ?, ?)",
            [$cid, resolve_site($u, $meta['siteId'] ?? null), $u['id'], clean($meta['comment'] ?? '', 2000), "$base.jpg", "{$base}_t.jpg", strlen($full), $taken]);
        out(get_entry((int) $db->lastInsertId()));
        if (drive_connected()) { finish_request(); drive_work(25); }
        return;
    }
    if ($route === 'POST api/entries/note') {
        $u = need();
        $b = body();
        $cid = clean($b['clientId'] ?? '', 64) ?: uuid();
        $comment = clean($b['comment'] ?? '', 2000);
        if ($comment === '') fail(400, 'Scrie ceva în notă');
        $ex = one('SELECT id, user_id FROM entries WHERE client_id = ?', [$cid]);
        if ($ex) { if ((int) $ex['user_id'] !== $u['id']) fail(409, 'Conflict'); out(get_entry((int) $ex['id'])); return; }
        q("INSERT INTO entries(client_id, kind, site_id, user_id, comment, taken_at, drive_status) VALUES (?, 'note', ?, ?, ?, ?, 'none')",
            [$cid, resolve_site($u, $b['siteId'] ?? null), $u['id'], $comment, norm_date($b['takenAt'] ?? null)]);
        out(get_entry((int) $db->lastInsertId()));
        return;
    }
    if ($route === 'GET api/entries') {
        $u = need();
        $w = []; $p = [];
        $site = $_GET['site'] ?? '';
        if ($site === 'none') $w[] = 'e.site_id IS NULL';
        elseif ($site !== '') { $w[] = 'e.site_id = :site'; $p['site'] = (int) $site; }
        if (!empty($_GET['mine'])) { $w[] = 'e.user_id = :me'; $p['me'] = $u['id']; }
        elseif (!is_admin($u)) {
            $w[] = '(e.user_id = :me1 OR e.site_id IN (SELECT site_id FROM site_users WHERE user_id = :me2))';
            $p['me1'] = $u['id']; $p['me2'] = $u['id'];
        }
        if (!empty($_GET['user'])) { $w[] = 'e.user_id = :uid'; $p['uid'] = (int) $_GET['user']; }
        if (!empty($_GET['before'])) {
            $parts = explode('|', (string) $_GET['before']);
            $w[] = '(e.taken_at < :bt1 OR (e.taken_at = :bt2 AND e.id < :bid))';
            $p['bt1'] = $parts[0]; $p['bt2'] = $parts[0]; $p['bid'] = (int) ($parts[1] ?? 0);
        }
        $limit = min(max((int) ($_GET['limit'] ?? 60), 1), 200);
        $rows = all(ENTRY_SELECT . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . " ORDER BY e.taken_at DESC, e.id DESC LIMIT $limit", $p);
        out(array_map('fix_entry', $rows));
        return;
    }
    if (preg_match('#^(PATCH|DELETE) api/entries/(\d+)$#', $route, $m)) {
        $u = need();
        $e = one('SELECT * FROM entries WHERE id = ?', [(int) $m[2]]);
        if (!$e || !can_see_entry($u, $e)) fail(404, 'Nu există');
        $eid = (int) $e['id'];
        if ($m[1] === 'DELETE') {
            if (!can_delete_entry($u, $e)) fail(403, 'Poți șterge doar pozele făcute de tine');
            q('DELETE FROM entries WHERE id = ?', [$eid]);
            foreach ([$e['file'], $e['thumb']] as $f) if ($f) @unlink("$PHOTOS/$f");
            out(['ok' => true]);
            if ($e['drive_file_id']) { finish_request(); drive_delete($e['drive_file_id']); }
            return;
        }
        if (!can_edit_entry($u, $e)) fail(403, 'Poți modifica doar pozele făcute de tine');
        $b = body();
        $siteId = $e['site_id'] === null ? null : (int) $e['site_id'];
        if (array_key_exists('siteId', $b)) {
            $siteId = $b['siteId'] === null ? null : resolve_site($u, $b['siteId']);
            if ($b['siteId'] !== null && $siteId === null) fail(403, 'Nu ai acces la acel șantier');
        }
        $comment = array_key_exists('comment', $b) ? clean($b['comment'], 2000) : $e['comment'];
        if ($e['kind'] === 'note' && $comment === '') fail(400, 'Nota nu poate fi goală');
        q('UPDATE entries SET site_id = ?, comment = ? WHERE id = ?', [$siteId, $comment, $eid]);
        out(get_entry($eid));
        $oldSite = $e['site_id'] === null ? null : (int) $e['site_id'];
        if ($e['drive_file_id'] && ($siteId !== $oldSite || $comment !== $e['comment'])) { finish_request(); drive_update($eid); }
        return;
    }
    if (preg_match('#^GET files/(\d+)/(full|thumb)$#', $route, $m)) {
        $u = current_user();
        if (!$u) { http_response_code(401); return; }
        $e = one('SELECT * FROM entries WHERE id = ?', [(int) $m[1]]);
        if (!$e || $e['kind'] !== 'photo' || !can_see_entry($u, $e)) { http_response_code(404); return; }
        $file = $PHOTOS . '/' . ($m[2] === 'full' ? $e['file'] : $e['thumb']);
        if (!is_file($file)) { http_response_code(404); return; }
        header('Content-Type: image/jpeg');
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: private, max-age=31536000, immutable');
        if (!empty($_GET['dl'])) header('Content-Disposition: attachment; filename="poza_' . substr($e['taken_at'], 0, 10) . '_' . $e['id'] . '.jpg"');
        readfile($file);
        return;
    }

    // ---------- Google Drive
    if ($route === 'GET api/drive') {
        global $CONFIG;
        need('admin');
        out(['configured' => drive_configured(), 'connected' => drive_connected(), 'editable' => true,
            'pending' => (int) val("SELECT COUNT(*) FROM entries WHERE kind='photo' AND drive_status='pending'"),
            'lastError' => setting('drive_last_error'), 'folder' => $CONFIG['drive_folder_name'],
            'redirectUri' => base_url() . '/api/drive/callback']);
        return;
    }
    if ($route === 'POST api/drive/config') {
        need('admin');
        $b = body();
        $id = clean($b['clientId'] ?? '', 300); $sec = clean($b['clientSecret'] ?? '', 300);
        if (($id === '') !== ($sec === '')) fail(400, 'Completează și Client ID și Client secret');
        set_setting('drive_client_id', $id ?: null);
        set_setting('drive_client_secret', $sec ?: null);
        set_setting('drive_refresh_token', null);
        set_setting('drive_access_token', null);
        out(['ok' => true]);
        return;
    }
    if ($route === 'GET api/drive/connect') {
        need('admin');
        if (!drive_configured()) fail(400, 'Completează întâi Client ID și Client secret');
        $state = bin2hex(random_bytes(16));
        set_setting('drive_oauth_state', $state . '|' . time());
        [$cid] = drive_client();
        header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
            'client_id' => $cid, 'redirect_uri' => base_url() . '/api/drive/callback', 'response_type' => 'code',
            'scope' => 'https://www.googleapis.com/auth/drive.file', 'access_type' => 'offline', 'prompt' => 'consent', 'state' => $state]));
        http_response_code(302);
        return;
    }
    if ($route === 'GET api/drive/callback') {
        need('admin');
        $back = base_path() . '/#cont?drive=';
        try {
            [$st, $t] = array_pad(explode('|', (string) setting('drive_oauth_state')), 2, '0');
            set_setting('drive_oauth_state', null);
            if (!$st || !hash_equals($st, (string) ($_GET['state'] ?? '')) || time() - (int) $t > 900) throw new RuntimeException('Cerere expirată, încearcă din nou');
            if (!empty($_GET['error'])) throw new RuntimeException((string) $_GET['error']);
            $j = google_token(['code' => (string) ($_GET['code'] ?? ''), 'redirect_uri' => base_url() . '/api/drive/callback', 'grant_type' => 'authorization_code']);
            if (empty($j['refresh_token'])) throw new RuntimeException('Google nu a trimis refresh_token');
            set_setting('drive_refresh_token', $j['refresh_token']);
            set_setting('drive_access_token', $j['access_token'] ?? null);
            set_setting('drive_access_exp', time() + (int) ($j['expires_in'] ?? 0));
            foreach (['drive_root_id', 'drive_nosite_id', 'drive_last_error'] as $k) set_setting($k, null);
            q('UPDATE sites SET drive_folder_id = NULL');
            q("UPDATE entries SET drive_status='pending', drive_file_id=NULL WHERE kind='photo'");
            header('Location: ' . $back . 'ok');
        } catch (Throwable $e) {
            header('Location: ' . $back . rawurlencode($e->getMessage()));
        }
        http_response_code(302);
        return;
    }
    if ($route === 'POST api/drive/disconnect') {
        need('admin');
        set_setting('drive_refresh_token', null);
        set_setting('drive_access_token', null);
        out(['ok' => true]);
        return;
    }
    if ($route === 'POST api/drive/sync') {
        need('admin');
        out(['ok' => true]);
        finish_request();
        drive_work(50);
        return;
    }

    fail(404, 'Nu există');
}
