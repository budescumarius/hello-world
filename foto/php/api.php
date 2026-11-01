<?php
/*
 * Foto Șantier – serverul pentru hosting cPanel (PHP 7.4+ cu SQLite).
 * Toate cererile către api/* și files/* ajung aici (vezi .htaccess).
 * Sincronizare Google Drive din cron (opțional):  php api.php drive-sync
 */
declare(strict_types=1);
error_reporting(E_ALL);
ini_set('display_errors', '0');

// Setări: implicit merg pe cPanel fără nimic de configurat. În Docker / VPS se pot da prin variabile de mediu
// (DATA_DIR, PUBLIC_URL, DRIVE_FOLDER_NAME, TRUST_PROXY) sau printr-un fișier config.php lângă api.php.
$CONFIG = [
    'data_dir' => getenv('DATA_DIR') ?: __DIR__ . '/data',
    'drive_folder_name' => getenv('DRIVE_FOLDER_NAME') ?: 'Poze Șantier',
    'public_url' => getenv('PUBLIC_URL') ?: '',
    'trust_proxy' => getenv('TRUST_PROXY') === '1', // în spatele unui proxy (Caddy în Docker): IP-ul real vine din X-Forwarded-For
];
if (is_file(__DIR__ . '/config.php')) $CONFIG = array_merge($CONFIG, (array) require __DIR__ . '/config.php');

const ROLES = ['admin', 'responsabil', 'muncitor'];
const VERSION = '25'; // la fel ca APP_VERSION din app.js
$DATA = rtrim($CONFIG['data_dir'], '/');
$PHOTOS = $DATA . '/photos';

// ---------------------------------------------------------------- baza de date
const SCHEMA = 10; // crește când se schimbă structura bazei
function open_db(string $file): PDO {
    $db = new PDO('sqlite:' . $file, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;');
    return $db;
}
function init_storage(): PDO {
    global $DATA, $PHOTOS;
    $dbFile = $DATA . '/santier.db';
    if (is_file($dbFile)) { // drum rapid: baza există, doar o deschidem
        $db = open_db($dbFile);
        if ((int) $db->query('PRAGMA user_version')->fetchColumn() >= SCHEMA) return $db;
        $db = null;
    }
    if (!is_dir($PHOTOS) && !@mkdir($PHOTOS, 0755, true)) {
        fail(500, 'Nu pot crea folderul de date. Verifică permisiunile pentru: ' . $GLOBALS['DATA']);
    }
    if (!is_file($DATA . '/.htaccess')) {
        @file_put_contents($DATA . '/.htaccess', "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n");
    }
    if (!is_file($DATA . '/index.html')) @file_put_contents($DATA . '/index.html', '');
    // O singură actualizare a structurii o dată; ceilalți așteaptă și apoi folosesc baza gata actualizată.
    $lock = fopen($DATA . '/migrate.lock', 'c');
    if ($lock) flock($lock, LOCK_EX);
    try {
        $db = open_db($dbFile);
        if ((int) $db->query('PRAGMA user_version')->fetchColumn() >= SCHEMA) return $db;
        @set_time_limit(900);
        migrate($db);
        return $db;
    } finally {
        if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    }
}

function migrate(PDO $db): void {
    $ver = (int) $db->query('PRAGMA user_version')->fetchColumn();
    $db->exec('PRAGMA journal_mode = WAL');
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
    // coloane adăugate în versiuni noi (NAS)
    $has = function (string $table, string $col) use ($db): bool {
        return in_array($col, array_column($db->query("PRAGMA table_info($table)")->fetchAll(), 'name'), true);
    };
    if (!$has('entries', 'nas_status')) $db->exec("ALTER TABLE entries ADD COLUMN nas_status TEXT NOT NULL DEFAULT 'pending'");
    if (!$has('entries', 'nas_path')) $db->exec('ALTER TABLE entries ADD COLUMN nas_path TEXT');
    if (!$has('sites', 'nas_folder')) $db->exec('ALTER TABLE sites ADD COLUMN nas_folder TEXT');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_entries_nas ON entries(nas_status)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_site_users_user ON site_users(user_id)');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_entries_time ON entries(taken_at DESC, id DESC)'); // galeria: cele mai noi primele, fără sortare

    // v5 – volum mare: indexuri complete pe șantier / autor + contoare ținute la zi de baza de date (triggere)
    if ($ver < 5) {
    $db->exec('BEGIN IMMEDIATE');
    try {
        $db->exec('CREATE INDEX IF NOT EXISTS idx_e_site ON entries(site_id, taken_at DESC, id DESC)');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_e_user ON entries(user_id, taken_at DESC, id DESC)');
        $db->exec('DROP INDEX IF EXISTS idx_entries_site');
        $db->exec('DROP INDEX IF EXISTS idx_entries_user');
        foreach (['photo_count INTEGER NOT NULL DEFAULT 0', 'last_at TEXT', 'cover_id INTEGER', 'cover_v TEXT', 'cover_at TEXT'] as $col) {
            if (!$has('sites', strtok($col, ' '))) $db->exec("ALTER TABLE sites ADD COLUMN $col");
        }
        if (!$has('users', 'photo_count')) $db->exec('ALTER TABLE users ADD COLUMN photo_count INTEGER NOT NULL DEFAULT 0');
        $db->exec("CREATE TABLE IF NOT EXISTS stats (k TEXT PRIMARY KEY, v INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO stats(k, v) VALUES ('unassigned', 0);");
        $add = "UPDATE sites SET photo_count = photo_count + 1,
                  last_at = CASE WHEN last_at IS NULL OR NEW.taken_at > last_at THEN NEW.taken_at ELSE last_at END WHERE id = NEW.site_id;
                UPDATE sites SET cover_id = NEW.id, cover_v = NEW.client_id, cover_at = NEW.taken_at
                  WHERE id = NEW.site_id AND NEW.kind = 'photo' AND (cover_at IS NULL OR NEW.taken_at >= cover_at);
                UPDATE stats SET v = v + 1 WHERE k = 'unassigned' AND NEW.site_id IS NULL;";
        $remove = "UPDATE sites SET photo_count = photo_count - 1,
                  last_at = (SELECT MAX(taken_at) FROM entries WHERE site_id = OLD.site_id) WHERE id = OLD.site_id;
                UPDATE sites SET cover_id = (SELECT id FROM entries WHERE site_id = OLD.site_id AND kind = 'photo' ORDER BY taken_at DESC, id DESC LIMIT 1)
                  WHERE id = OLD.site_id AND cover_id = OLD.id;
                UPDATE sites SET cover_v = (SELECT client_id FROM entries WHERE id = sites.cover_id), cover_at = (SELECT taken_at FROM entries WHERE id = sites.cover_id)
                  WHERE id = OLD.site_id AND (cover_id IS NULL OR cover_v IS NOT (SELECT client_id FROM entries WHERE id = sites.cover_id));
                UPDATE stats SET v = v - 1 WHERE k = 'unassigned' AND OLD.site_id IS NULL;";
        $db->exec('DROP TRIGGER IF EXISTS trg_e_ins; DROP TRIGGER IF EXISTS trg_e_del; DROP TRIGGER IF EXISTS trg_e_move;');
        $db->exec("CREATE TRIGGER trg_e_ins AFTER INSERT ON entries BEGIN $add UPDATE users SET photo_count = photo_count + 1 WHERE id = NEW.user_id; END;");
        $db->exec("CREATE TRIGGER trg_e_del AFTER DELETE ON entries BEGIN $remove UPDATE users SET photo_count = photo_count - 1 WHERE id = OLD.user_id; END;");
        $db->exec("CREATE TRIGGER trg_e_move AFTER UPDATE OF site_id ON entries WHEN OLD.site_id IS NOT NEW.site_id BEGIN $remove $add END;");
        // contoarele pentru datele existente (o singură dată)
        $db->exec("UPDATE sites SET photo_count = (SELECT COUNT(*) FROM entries e WHERE e.site_id = sites.id),
                     last_at = (SELECT MAX(taken_at) FROM entries e WHERE e.site_id = sites.id),
                     cover_id = (SELECT id FROM entries e WHERE e.site_id = sites.id AND e.kind = 'photo' ORDER BY taken_at DESC, id DESC LIMIT 1)");
        $db->exec('UPDATE sites SET cover_v = (SELECT client_id FROM entries WHERE id = sites.cover_id), cover_at = (SELECT taken_at FROM entries WHERE id = sites.cover_id)');
        $db->exec('UPDATE users SET photo_count = (SELECT COUNT(*) FROM entries e WHERE e.user_id = users.id)');
        $db->exec("UPDATE stats SET v = (SELECT COUNT(*) FROM entries WHERE site_id IS NULL) WHERE k = 'unassigned'");
        $db->exec('PRAGMA user_version = 5');
        $db->exec('COMMIT');
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
    }

    // v6 – foldere pe șantier („État des lieux”, „Réception”…) + cheie personală pentru scurtătura iPhone
    $db->exec('BEGIN IMMEDIATE');
    try {
        $db->exec("CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, name TEXT NOT NULL,
            drive_folder_id TEXT, nas_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_folders_site ON folders(site_id)');
        if (!$has('entries', 'folder_id')) $db->exec('ALTER TABLE entries ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_e_folder ON entries(folder_id, taken_at DESC, id DESC)');
        if (!$has('users', 'key_hash')) $db->exec('ALTER TABLE users ADD COLUMN key_hash TEXT');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_users_key ON users(key_hash)');
        // v7 – responsabilul își vede muncitorii creați de el, chiar înainte să-i pună pe un șantier
        if (!$has('users', 'created_by')) $db->exec('ALTER TABLE users ADD COLUMN created_by INTEGER');
        // v8 – dubluri: amprenta fișierului original (hash) și a pozei salvate (file_hash)
        if (!$has('entries', 'hash')) $db->exec('ALTER TABLE entries ADD COLUMN hash TEXT');
        if (!$has('entries', 'file_hash')) $db->exec('ALTER TABLE entries ADD COLUMN file_hash TEXT');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_e_hash ON entries(hash) WHERE hash IS NOT NULL');
        $db->exec('CREATE INDEX IF NOT EXISTS idx_e_file_hash ON entries(file_hash) WHERE file_hash IS NOT NULL');
        // v9 – jurnalul trimiterilor din scurtătura iPhone (ca omul să vadă în aplicație ce s-a întâmplat)
        $db->exec("CREATE TABLE IF NOT EXISTS shortcut_log (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), ok INTEGER NOT NULL, message TEXT NOT NULL)");
        $db->exec('CREATE INDEX IF NOT EXISTS idx_sclog_user ON shortcut_log(user_id, id DESC)');
        // v10 – cheia rămâne vizibilă în aplicație (ghidul nu mai generează alta la fiecare deschidere)
        if (!$has('users', 'api_key')) $db->exec('ALTER TABLE users ADD COLUMN api_key TEXT');
        $db->exec('PRAGMA user_version = ' . SCHEMA);
        $db->exec('COMMIT');
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
    $db->exec('ANALYZE');
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
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    // Răspunsurile mari pleacă comprimate (de ~5–9 ori mai mici), indiferent de setările hostingului.
    if (strlen($json) > 1400 && function_exists('gzencode') && !ini_get('zlib.output_compression')
        && strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip') !== false) {
        $json = gzencode($json, 5);
        header('Content-Encoding: gzip');
        header('Vary: Accept-Encoding');
    }
    header('Content-Length: ' . strlen($json));
    echo $json;
}
// Trimite răspunsul imediat, apoi continuă în fundal (Drive / NAS), fără ca telefonul să aștepte.
function respond_then($data): void {
    ignore_user_abort(true);
    @set_time_limit(120);
    if (!headers_sent()) header('Connection: close');
    out($data);
    finish_request();
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
function client_ip(): string {
    global $CONFIG;
    if ($CONFIG['trust_proxy'] && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    return $_SERVER['REMOTE_ADDR'] ?? '';
}
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
    while (ob_get_level() > 0) @ob_end_flush();
    @flush();
}

// ---------------------------------------------------------------- autentificare
function set_session(int $userId): void {
    $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    q('INSERT INTO sessions(token, user_id) VALUES (?, ?)', [$token, $userId]);
    if (random_int(1, 50) === 1) q("DELETE FROM sessions WHERE created_at < datetime('now', '-400 days')");
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
// Responsabilul gestionează muncitorii de pe șantierele lui (sau creați de el).
function manages(array $me, array $target): bool {
    if (is_admin($me)) return true;
    if ($me['role'] !== 'responsabil' || $target['role'] !== 'muncitor') return false;
    if ((int) ($target['created_by'] ?? 0) === $me['id']) return true;
    return (bool) array_intersect(assigned((int) $target['id']), assigned($me['id']));
}
function set_user_sites(int $userId, array $ids): void {
    q('DELETE FROM site_users WHERE user_id = ?', [$userId]);
    foreach (array_unique(array_map('intval', $ids)) as $sid) {
        q('INSERT OR IGNORE INTO site_users(site_id, user_id) SELECT id, ? FROM sites WHERE id = ?', [$userId, $sid]);
    }
}

// ---------------------------------------------------------------- intrări (poze / note)
const ENTRY_SELECT = "SELECT e.id, e.client_id, e.kind, e.site_id, e.folder_id, e.user_id, e.comment, e.taken_at, e.size, e.drive_status,
  s.name AS site_name, f.name AS folder_name, u.name AS user_name FROM entries e LEFT JOIN sites s ON s.id = e.site_id
  LEFT JOIN folders f ON f.id = e.folder_id LEFT JOIN users u ON u.id = e.user_id";
function fix_entry(array $e): array {
    foreach (['id', 'site_id', 'folder_id', 'user_id', 'size'] as $k) if ($e[$k] !== null) $e[$k] = (int) $e[$k];
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
// Folderul e valabil doar dacă aparține șantierului ales; altfel poza merge direct în șantier.
function resolve_folder($siteId, $folderId) {
    if (!$siteId || $folderId === null || $folderId === '' || !(int) $folderId) return null;
    return val('SELECT id FROM folders WHERE id = ? AND site_id = ?', [(int) $folderId, (int) $siteId]) ? (int) $folderId : null;
}
// Nume de folder deja folosit pe șantier? (fără deosebire de litere mari/mici, inclusiv É/é)
function folder_name_taken(int $sid, string $name, int $except = 0): bool {
    $low = function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
    foreach (all('SELECT id, name FROM folders WHERE site_id = ? AND id != ?', [$sid, $except]) as $f) {
        if ((function_exists('mb_strtolower') ? mb_strtolower($f['name'], 'UTF-8') : strtolower($f['name'])) === $low) return true;
    }
    return false;
}
function site_folders(array $siteIds): array { // [siteId => [[id, name], ...]]
    if (!$siteIds) return [];
    $by = [];
    foreach (all('SELECT id, site_id, name FROM folders WHERE site_id IN (' . implode(',', array_map('intval', $siteIds)) . ') ORDER BY name COLLATE NOCASE') as $f)
        $by[(int) $f['site_id']][] = ['id' => (int) $f['id'], 'name' => $f['name']];
    return $by;
}
// Număr nou pentru fiecare poză, niciodată refolosit (altfel, după ștergerea ultimei poze,
// telefonul ar putea arăta poza veche din memoria lui pentru același număr).
function next_entry_id(): int {
    $n = max((int) val('SELECT COALESCE(MAX(id), 0) FROM entries'), (int) setting('entry_seq')) + 1;
    set_setting('entry_seq', $n);
    return $n;
}
// Alocarea numărului și salvarea se fac sub blocare (BEGIN IMMEDIATE): doi oameni care trimit
// poze în aceeași clipă nu pot primi același număr. Primul parametru din $sql este id-ul.
function insert_entry(string $sql, array $params): int {
    global $db;
    $db->exec('BEGIN IMMEDIATE');
    try {
        $id = next_entry_id();
        q($sql, array_merge([$id], $params));
        $db->exec('COMMIT');
        return $id;
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
}
function is_jpeg(string $b): bool { return strlen($b) > 3 && substr($b, 0, 3) === "\xFF\xD8\xFF"; }

// Aceeași poză (același conținut) există deja? $hash = amprenta fișierului original, $fileHash = a pozei salvate.
function find_duplicate(?string $hash, string $fileHash) {
    $id = $hash ? val("SELECT id FROM entries WHERE hash = ? AND kind = 'photo' ORDER BY id LIMIT 1", [$hash]) : null;
    if (!$id) $id = val("SELECT id FROM entries WHERE file_hash = ? AND kind = 'photo' ORDER BY id LIMIT 1", [$fileHash]);
    return $id ? (int) $id : null;
}
// Salvează poza; dacă exact aceeași poză e deja pe server, o păstrează doar pe cea veche. Întoarce [id, eDublură].
function store_photo(array $u, string $cid, $sid, $fid, string $comment, string $full, string $thumb, string $taken, ?string $hash = null): array {
    global $PHOTOS, $db;
    $hash = ($hash && preg_match('/^[0-9a-f]{64}$/', $hash)) ? $hash : null;
    $fileHash = hash('sha256', $full);
    if ($dup = find_duplicate($hash, $fileHash)) return [$dup, true];
    $dir = substr($taken, 0, 7);
    if (!is_dir("$PHOTOS/$dir")) mkdir("$PHOTOS/$dir", 0755, true);
    $base = $dir . '/' . uuid();
    if (file_put_contents("$PHOTOS/$base.jpg", $full) === false || file_put_contents("$PHOTOS/{$base}_t.jpg", $thumb) === false) {
        fail(500, 'Nu pot salva poza (spațiu pe disc?)');
    }
    // verificare + salvare sub blocare: două trimiteri simultane ale aceleiași poze nu pot intra amândouă
    $db->exec('BEGIN IMMEDIATE');
    try {
        if ($dup = find_duplicate($hash, $fileHash)) {
            $db->exec('COMMIT');
            @unlink("$PHOTOS/$base.jpg"); @unlink("$PHOTOS/{$base}_t.jpg");
            return [$dup, true];
        }
        $id = next_entry_id();
        q("INSERT INTO entries(id, client_id, kind, site_id, folder_id, user_id, comment, file, thumb, size, taken_at, hash, file_hash) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [$id, $cid, $sid, $fid, $u['id'], $comment, "$base.jpg", "{$base}_t.jpg", strlen($full), $taken, $hash, $fileHash]);
        $db->exec('COMMIT');
        return [$id, false];
    } catch (Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
}

// Șterge o intrare cu fișierele ei; întoarce ce trebuie șters și din Drive / NAS.
function delete_entry_row(array $e): array {
    global $PHOTOS;
    q('DELETE FROM entries WHERE id = ?', [(int) $e['id']]);
    foreach ([$e['file'], $e['thumb']] as $f) if ($f) @unlink("$PHOTOS/$f");
    return [$e['drive_file_id'], $e['nas_path']];
}

// ---------------------------------------------------------------- scurtătura iPhone („Foto Șantier” din Partajează)
// Pozele vin direct de pe telefon (fără aplicație): serverul face poza mare (2048 px), miniatura,
// rotația corectă și scoate datele EXIF/GPS, ca aplicația.
function key_user() {
    $key = (string) ($_POST['key'] ?? $_GET['key'] ?? '');
    if (strlen($key) < 20) return null;
    $u = one('SELECT id, name, username, role FROM users WHERE key_hash = ? AND active = 1', [hash('sha256', $key)]);
    if ($u) $u['id'] = (int) $u['id'];
    return $u;
}
function text_out(string $t, int $code = 200, bool $then = false): void {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('Content-Length: ' . strlen($t));
    if ($then) { ignore_user_abort(true); @set_time_limit(120); header('Connection: close'); }
    echo $t;
    if ($then) finish_request();
}
// „Vindevogel”, „Vindevogel › État des lieux”, … => [siteId, folderId]
function destinations(array $u): array {
    $sites = is_admin($u)
        ? all('SELECT id, name FROM sites WHERE archived = 0 ORDER BY name COLLATE NOCASE')
        : all('SELECT s.id, s.name FROM sites s JOIN site_users su ON su.site_id = s.id WHERE su.user_id = ? AND s.archived = 0 ORDER BY s.name COLLATE NOCASE', [$u['id']]);
    $folders = site_folders(array_column($sites, 'id'));
    $d = [];
    foreach ($sites as $s) {
        $label = trim(str_replace(["\n", "\r"], ' ', $s['name']));
        if (isset($d[$label])) $label .= ' (#' . $s['id'] . ')';
        $d[$label] = [(int) $s['id'], null];
        foreach ($folders[(int) $s['id']] ?? [] as $f) $d[$label . ' › ' . $f['name']] = [(int) $s['id'], $f['id']];
    }
    $d['Fără șantier'] = [null, null];
    return $d;
}
function gd_load(string $path) { // imaginea, întoarsă corect după EXIF
    if (!function_exists('imagecreatefromstring')) return null;
    $im = @imagecreatefromstring((string) file_get_contents($path));
    if (!$im) return null;
    $o = function_exists('exif_read_data') ? (int) ((@exif_read_data($path) ?: [])['Orientation'] ?? 1) : 1;
    if (in_array($o, [2, 4, 5, 7], true) && function_exists('imageflip')) imageflip($im, IMG_FLIP_HORIZONTAL);
    $rot = [3 => 180, 4 => 180, 5 => 270, 6 => 270, 7 => 90, 8 => 90][$o] ?? 0;
    if ($rot) { $r = imagerotate($im, $rot, 0); if ($r) $im = $r; }
    return $im;
}
function gd_jpeg($im, int $max, int $q): string {
    $w = imagesx($im); $h = imagesy($im);
    $k = min(1, $max / max($w, $h));
    $nw = max(1, (int) round($w * $k)); $nh = max(1, (int) round($h * $k));
    $dst = imagecreatetruecolor($nw, $nh);
    imagecopyresampled($dst, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    ob_start(); imagejpeg($dst, null, $q); $out = (string) ob_get_clean();
    return $out;
}
function sc_log(array $u, bool $ok, string $msg): void {
    q('INSERT INTO shortcut_log(user_id, ok, message) VALUES (?, ?, ?)', [$u['id'], $ok ? 1 : 0, $msg]);
    q('DELETE FROM shortcut_log WHERE user_id = ? AND id NOT IN (SELECT id FROM shortcut_log WHERE user_id = ? ORDER BY id DESC LIMIT 20)', [$u['id'], $u['id']]);
}
// răspunde scurtăturii și notează în jurnal (vizibil în aplicație: Cont → Trimite din galerie)
function sc_reply(array $u, string $msg, int $code, bool $then = false): void { sc_log($u, $code < 300, $msg); text_out($msg, $code, $then); }
function ini_bytes(string $v): int {
    $n = (int) $v; $u = strtolower(substr(trim($v), -1));
    return $u === 'g' ? $n << 30 : ($u === 'm' ? $n << 20 : ($u === 'k' ? $n << 10 : $n));
}
function shortcut(string $route): void {
    $u = key_user();
    if (!$u) {
        // cheie veche / greșită: notăm (adminul o vede în aplicație) și spunem clar ce e de făcut
        $k = (string) ($_POST['key'] ?? $_GET['key'] ?? '');
        set_setting('shortcut_badkey', json_encode(['at' => gmdate('Y-m-d\TH:i:s\Z'), 'key' => $k === '' ? '(fără cheie)' : substr($k, 0, 10) . '…', 'what' => $route], JSON_UNESCAPED_UNICODE));
        $msg = '⚠️ Cheie veche sau greșită. Deschide aplicația → Cont → Trimite din galerie → Arată ghidul și copiază din nou adresa 1 și adresa 2 în scurtătură.';
        if (!empty($_GET['json'])) { out([$msg]); return; } // apare chiar în lista de alegere de pe iPhone
        text_out($msg, 401);
        return;
    }
    if ($route === 'GET api/shortcut/upload') {
        sc_reply($u, 'Trimiterea a sosit cu metoda GET. În ultima acțiune „Obtenir le contenu de l’URL” apasă › și pune Méthode: POST, Corps de la requête: Formulaire.', 405);
        return;
    }
    if ($route === 'POST api/shortcut/destinations') $route = 'POST api/shortcut/upload'; // s-a pus adresa 1 și la trimitere: merge oricum
    $dest = destinations($u);
    if ($route === 'GET api/shortcut/destinations') {
        if (!empty($_GET['json'])) { out(array_keys($dest)); return; } // listă gata de ales în Raccourcis (fără „Séparer le texte”)
        text_out(implode("\n", array_keys($dest)));
        return;
    }
    // cerere prea mare pentru hosting: PHP aruncă tot conținutul (și câmpul dest, și poza)
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > 0 && !$_POST && !$_FILES) {
        sc_reply($u, 'Poza e prea mare pentru hosting (' . round($len / 1048576, 1) . ' MB, limita e ' . ini_get('post_max_size') . '). '
            . 'Adaugă în scurtătură, înainte de trimitere, acțiunea „Redimensionner l’image” cu lățimea 2048.', 413);
        return;
    }
    $label = trim((string) ($_POST['dest'] ?? ''));
    if ($label === '') { sc_reply($u, 'Lipsește câmpul „dest” (șantierul ales). În ultima acțiune „Obtenir le contenu de l’URL” adaugă un câmp Texte „dest” = Élément choisi.', 400); return; }
    if (!isset($dest[$label])) { sc_reply($u, "Nu găsesc „{$label}” printre șantierele tale.", 400); return; }
    [$sid, $fid] = $dest[$label];
    // toate fișierele trimise, oricum ar fi numit câmpul (photo, photo[], file…)
    $files = []; $tooBig = 0;
    foreach ($_FILES as $f) {
        foreach ((array) $f['tmp_name'] as $i => $t) {
            $err = is_array($f['error']) ? $f['error'][$i] : $f['error'];
            if ($err === UPLOAD_ERR_OK) $files[] = $t;
            elseif (in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) $tooBig++;
        }
    }
    if (!$files && $tooBig) { sc_reply($u, 'Poza e prea mare pentru hosting (limita e ' . ini_get('upload_max_filesize') . '). Adaugă în scurtătură „Redimensionner l’image” cu lățimea 2048.', 413); return; }
    if (!$files) { sc_reply($u, 'Nu a sosit nicio poză. În ultima acțiune adaugă un câmp Fichier „photo” = Image redimensionnée (sau Image convertie).', 400); return; }
    $n = 0; $dups = 0; $errors = [];
    foreach ($files as $tmp) {
        $raw = (string) file_get_contents($tmp);
        $exif = function_exists('exif_read_data') ? (@exif_read_data($tmp) ?: []) : [];
        $taken = norm_date(isset($exif['DateTimeOriginal']) ? str_replace(':', '-', substr($exif['DateTimeOriginal'], 0, 10)) . substr($exif['DateTimeOriginal'], 10) : null);
        $im = gd_load($tmp);
        if ($im) { $full = gd_jpeg($im, 2048, 82); $thumb = gd_jpeg($im, 300, 62); }
        elseif (is_jpeg($raw)) { $full = $raw; $thumb = $raw; }
        else { $errors[] = 'o poză nu e JPEG: adaugă în scurtătură acțiunea „Convertește imaginea” (JPEG)'; continue; }
        $cid = 'sc-' . substr(sha1($u['id'] . '|' . sha1($raw) . '|' . microtime()), 0, 40);
        [, $dup] = store_photo($u, $cid, $sid, $fid, '', $full, $thumb, $taken, hash('sha256', $raw));
        $dup ? $dups++ : $n++;
    }
    $msg = $n ? "✓ $n " . ($n === 1 ? 'poză trimisă' : 'poze trimise') . " în $label" : ($dups ? '✓ Nicio poză nouă' : 'Nicio poză trimisă');
    if ($dups) $msg .= ' (' . $dups . ($dups === 1 ? ' era deja trimisă – păstrată o singură dată)' : ' erau deja trimise – păstrate o singură dată)');
    $n += $dups;
    if ($errors) $msg .= "\n" . implode("\n", array_unique($errors));
    if ($n - $dups > 0) $msg .= "\nLe găsești în aplicație: 🖼 Poze sau Șantiere → $label.";
    sc_reply($u, $msg, $n ? 200 : 400, $n > 0);
    if ($n && sync_active()) sync_work(25);
}

// ---------------------------------------------------------------- Google Drive
function drive_client(): array { return [setting('drive_client_id') ?: '', setting('drive_client_secret') ?: '']; }
function drive_configured(): bool { [$id, $s] = drive_client(); return $id !== '' && $s !== ''; }
function drive_connected(): bool { return drive_configured() && (bool) setting('drive_refresh_token'); }
function drive_active(): bool { return drive_connected() && setting('drive_enabled') !== '0'; }

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
    static $known = [];
    if (!$id) return false;
    if (isset($known[$id])) return true;
    try {
        $f = gapi('GET', "https://www.googleapis.com/drive/v3/files/$id?fields=id,trashed");
        if (!empty($f['trashed'])) return false;
        return $known[$id] = true;
    }
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
// Unde stă poza în Drive: <șantier>/<folder> sau direct <șantier>.
function drive_parent(array $e): string {
    $site = site_folder($e['site_id']);
    if (empty($e['folder_id']) || !$e['site_id']) return $site;
    $f = one('SELECT id, name, drive_folder_id FROM folders WHERE id = ?', [(int) $e['folder_id']]);
    if (!$f) return $site;
    if (folder_ok($f['drive_folder_id'])) return $f['drive_folder_id'];
    $id = create_folder($f['name'], $site);
    q('UPDATE folders SET drive_folder_id = ? WHERE id = ?', [$id, $f['id']]);
    return $id;
}
function drive_upload(array $e): string {
    global $PHOTOS;
    $d = str_replace(['T', ':'], ['_', '-'], substr($e['taken_at'], 0, 19));
    $who = trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '_', $e['user_name'] ?: 'necunoscut'), '_');
    $meta = ['name' => "{$d}_{$who}_{$e['id']}.jpg", 'parents' => [drive_parent($e)]];
    if ($e['comment'] !== '') $meta['description'] = $e['comment'];
    $b = 'b' . bin2hex(random_bytes(8));
    $body = "--$b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" . json_encode($meta, JSON_UNESCAPED_UNICODE)
        . "\r\n--$b\r\nContent-Type: image/jpeg\r\n\r\n" . file_get_contents($PHOTOS . '/' . $e['file']) . "\r\n--$b--";
    return gapi('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', $body, "multipart/related; boundary=$b")['id'];
}
function drive_update(int $entryId): void {
    $e = one('SELECT * FROM entries WHERE id = ?', [$entryId]);
    if (!drive_active() || !$e || !$e['drive_file_id']) return;
    try {
        $cur = gapi('GET', "https://www.googleapis.com/drive/v3/files/{$e['drive_file_id']}?fields=parents");
        $qs = http_build_query(['addParents' => drive_parent($e), 'removeParents' => implode(',', $cur['parents'] ?? [])]);
        gapi('PATCH', "https://www.googleapis.com/drive/v3/files/{$e['drive_file_id']}?$qs", json_encode(['description' => $e['comment']], JSON_UNESCAPED_UNICODE));
    } catch (Throwable $err) { error_log('Drive update: ' . $err->getMessage()); }
}
function drive_delete($fileId): void {
    if (!drive_active() || !$fileId) return;
    try { gapi('DELETE', "https://www.googleapis.com/drive/v3/files/$fileId"); }
    catch (Throwable $e) { if ($e->getCode() !== 404) error_log('Drive delete: ' . $e->getMessage()); }
}
// Trimite pozele care așteaptă, cel mult $seconds secunde. Un singur proces o dată.
function drive_work(int $seconds = 25): void {
    global $DATA;
    if (!drive_active()) return;
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

// ---------------------------------------------------------------- NAS (WebDAV: Synology, QNAP, Nextcloud…)
// Structura: <URL>/<Poze Șantier>/<șantier>/<data_ora_nume_id>.jpg (+ .txt cu comentariul)
function nas_configured(): bool { return (bool) setting('nas_url'); }
function nas_active(): bool { return nas_configured() && setting('nas_enabled') !== '0'; }
class NasError extends RuntimeException {}
function nas_url(string $rel = ''): string {
    $segs = array_filter(explode('/', $rel), 'strlen');
    return rtrim((string) setting('nas_url'), '/') . ($segs ? '/' . implode('/', array_map('rawurlencode', $segs)) : '/');
}
function nas_req(string $method, string $rel, array $headers = [], $body = null, ?array $cfg = null): int {
    $cfg = $cfg ?: ['url' => setting('nas_url'), 'user' => setting('nas_user'), 'pass' => setting('nas_pass'), 'insecure' => setting('nas_insecure') === '1'];
    $segs = array_filter(explode('/', $rel), 'strlen');
    $url = rtrim($cfg['url'], '/') . ($segs ? '/' . implode('/', array_map('rawurlencode', $segs)) : '/');
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 120, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_HTTPAUTH => CURLAUTH_ANY,
        CURLOPT_USERPWD => $cfg['user'] . ':' . $cfg['pass']]);
    if (!empty($cfg['insecure'])) { curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false); curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0); }
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    if (curl_exec($ch) === false) {
        $err = curl_error($ch); curl_close($ch);
        throw new NasError('NAS-ul nu răspunde: ' . $err);
    }
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code === 401 || $code === 403) throw new NasError('NAS: utilizator/parolă greșite sau fără drept de scriere', $code);
    return $code;
}
function nas_clean_name(string $s): string {
    $s = trim((string) preg_replace('#[\\\\/:*?"<>|\x00-\x1f]+#u', '-', $s), " .-");
    return $s === '' ? 'Șantier' : (function_exists('mb_substr') ? mb_substr($s, 0, 100) : substr($s, 0, 100));
}
function nas_root(): string { global $CONFIG; return nas_clean_name($CONFIG['drive_folder_name']); }
function nas_mkdir(string $rel): void {
    static $done = [];
    if (isset($done[$rel])) return;
    $c = nas_req('MKCOL', $rel);
    if (!in_array($c, [201, 405, 301, 200], true)) throw new NasError("NAS: nu pot crea folderul „{$rel}” (HTTP $c)", $c);
    $done[$rel] = true;
}
function nas_site_folder($siteId): string {
    $root = nas_root();
    nas_mkdir($root);
    $site = $siteId ? one('SELECT id, name, nas_folder FROM sites WHERE id = ?', [(int) $siteId]) : null;
    if (!$site) { nas_mkdir("$root/Fără șantier"); return "$root/Fără șantier"; }
    $name = $site['nas_folder'] ?: nas_clean_name($site['name']);
    nas_mkdir("$root/$name");
    if ($site['nas_folder'] !== $name) q('UPDATE sites SET nas_folder = ? WHERE id = ?', [$name, $site['id']]);
    return "$root/$name";
}
function nas_entry_folder(array $e): string {
    $site = nas_site_folder($e['site_id']);
    if (empty($e['folder_id']) || !$e['site_id']) return $site;
    $f = one('SELECT id, name, nas_name FROM folders WHERE id = ?', [(int) $e['folder_id']]);
    if (!$f) return $site;
    $name = $f['nas_name'] ?: nas_clean_name($f['name']);
    nas_mkdir("$site/$name");
    if ($f['nas_name'] !== $name) q('UPDATE folders SET nas_name = ? WHERE id = ?', [$name, $f['id']]);
    return "$site/$name";
}
function nas_file_name(array $e): string {
    $d = str_replace(['T', ':'], ['_', '-'], substr($e['taken_at'], 0, 19));
    $who = trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '_', $e['user_name'] ?: 'necunoscut'), '_');
    return "{$d}_{$who}_{$e['id']}.jpg";
}
function nas_txt(string $path): string { return preg_replace('/\.jpg$/', '.txt', $path); }
function nas_put_comment(string $path, string $comment): void {
    if ($comment !== '') nas_req('PUT', nas_txt($path), ['Content-Type: text/plain; charset=utf-8'], "\xEF\xBB\xBF" . $comment);
    else nas_req('DELETE', nas_txt($path));
}
function nas_upload(array $e): string {
    global $PHOTOS;
    $path = nas_entry_folder($e) . '/' . nas_file_name($e);
    $c = nas_req('PUT', $path, ['Content-Type: image/jpeg'], file_get_contents($PHOTOS . '/' . $e['file']));
    if ($c < 200 || $c >= 300) throw new NasError("NAS: nu pot salva poza (HTTP $c)", $c);
    if ($e['comment'] !== '') nas_put_comment($path, $e['comment']);
    return $path;
}
function nas_move(string $from, string $to): int {
    return nas_req('MOVE', $from, ['Destination: ' . nas_url($to), 'Overwrite: F']);
}
function nas_update(int $entryId): void {
    $e = one('SELECT * FROM entries WHERE id = ?', [$entryId]);
    if (!nas_active() || !$e || !$e['nas_path']) return;
    try {
        $path = $e['nas_path'];
        $folder = nas_entry_folder($e);
        if (dirname($path) !== $folder) {
            $to = $folder . '/' . basename($path);
            $c = nas_move($path, $to);
            if ($c === 404) { q("UPDATE entries SET nas_status='pending', nas_path=NULL WHERE id=?", [$entryId]); return; } // dispărută: o retrimitem
            nas_move(nas_txt($path), nas_txt($to));
            q('UPDATE entries SET nas_path = ? WHERE id = ?', [$to, $entryId]);
            $path = $to;
        }
        nas_put_comment($path, $e['comment']);
    } catch (Throwable $err) { error_log('NAS update: ' . $err->getMessage()); }
}
function nas_delete($path): void {
    if (!nas_active() || !$path) return;
    try { nas_req('DELETE', $path); nas_req('DELETE', nas_txt($path)); }
    catch (Throwable $e) { error_log('NAS delete: ' . $e->getMessage()); }
}
function nas_rename_site(array $site, string $newName): void {
    if (!nas_active() || !$site['nas_folder']) return;
    $new = nas_clean_name($newName);
    if ($new === $site['nas_folder']) return;
    try {
        $root = nas_root();
        $c = nas_move("$root/{$site['nas_folder']}", "$root/$new");
        if ($c >= 200 && $c < 300) {
            q('UPDATE sites SET nas_folder = ? WHERE id = ?', [$new, $site['id']]);
            foreach (all('SELECT id, nas_path FROM entries WHERE site_id = ? AND nas_path IS NOT NULL', [$site['id']]) as $r) {
                q('UPDATE entries SET nas_path = ? WHERE id = ?', ["$root/$new/" . basename($r['nas_path']), $r['id']]);
            }
        }
    } catch (Throwable $e) { error_log('NAS rename: ' . $e->getMessage()); }
}
function nas_work(int $seconds = 25): void {
    global $DATA;
    if (!nas_active()) return;
    $lock = fopen($DATA . '/nas.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) return;
    @set_time_limit($seconds + 60);
    $end = time() + $seconds;
    try {
        while (time() < $end) {
            $e = one("SELECT e.*, u.name AS user_name FROM entries e LEFT JOIN users u ON u.id = e.user_id
                WHERE e.kind='photo' AND e.nas_status='pending' ORDER BY e.id LIMIT 1");
            if (!$e) break;
            $path = nas_upload($e);
            q("UPDATE entries SET nas_status='done', nas_path=? WHERE id=?", [$path, $e['id']]);
            $now = one('SELECT site_id, comment FROM entries WHERE id = ?', [$e['id']]);
            if ($now && ($now['site_id'] !== $e['site_id'] || $now['comment'] !== $e['comment'])) nas_update((int) $e['id']);
        }
        set_setting('nas_last_error', null);
    } catch (Throwable $err) {
        set_setting('nas_last_error', $err->getMessage());
        error_log('NAS: ' . $err->getMessage());
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
function sync_active(): bool { return drive_active() || nas_active(); }
function sync_work(int $seconds = 25): void {
    $half = nas_active() && drive_active() ? intdiv($seconds, 2) : $seconds;
    drive_work($half);
    nas_work($half);
}

// ================================================================ pornire
try {
    $db = init_storage();
} catch (Throwable $e) {
    if (PHP_SAPI === 'cli') { fwrite(STDERR, $e->getMessage() . "\n"); exit(1); }
    fail(500, 'Baza de date nu poate fi deschisă: ' . $e->getMessage());
}

if (PHP_SAPI === 'cli') {
    if (in_array($argv[1] ?? '', ['sync', 'drive-sync'], true)) { sync_work(280); echo "ok\n"; }
    else echo "Folosire: php api.php sync\n";
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
        out(['needsSetup' => $needs, 'user' => $needs ? null : current_user(), 'version' => VERSION]);
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
        $fold = site_folders(array_column($sites, 'id'));
        foreach ($sites as &$s) { $s['id'] = (int) $s['id']; $s['folders'] = $fold[$s['id']] ?? []; }
        unset($s);
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
        if (!empty($_GET['lite'])) { // doar ce trebuie pentru liste de alegere
            $sites = all("SELECT s.id, s.name, s.address, s.archived FROM sites s $where ORDER BY s.archived, s.name COLLATE NOCASE", is_admin($u) ? [] : ['uid' => $u['id']]);
            foreach ($sites as &$s) { $s['id'] = (int) $s['id']; $s['archived'] = (int) $s['archived']; }
            out(['sites' => $sites]);
            return;
        }
        // contoarele (poze, ultima poză, copertă) sunt ținute la zi de baza de date: nimic de numărat aici
        $params = is_admin($u) ? [] : ['uid' => $u['id']];
        if (!empty($_GET['id'])) { // un singur șantier (pagina șantierului)
            $where .= ($where ? ' AND' : 'WHERE') . ' s.id = :sid';
            $params['sid'] = (int) $_GET['id'];
        }
        $sites = all("SELECT s.id, s.name, s.address, s.archived, s.created_at, s.photo_count AS count, s.last_at, s.cover_id, s.cover_v
            FROM sites s $where ORDER BY s.archived, s.name COLLATE NOCASE", $params);
        $members = !$sites ? [] : (!empty($_GET['id'])
            ? all('SELECT su.site_id, u.id, u.name, u.role FROM site_users su JOIN users u ON u.id = su.user_id WHERE su.site_id = ? ORDER BY u.name', [(int) $_GET['id']])
            : (is_admin($u)
            ? all('SELECT su.site_id, u.id, u.name, u.role FROM site_users su JOIN users u ON u.id = su.user_id ORDER BY u.name')
            : all('SELECT su.site_id, u.id, u.name, u.role FROM site_users su JOIN users u ON u.id = su.user_id
                   WHERE su.site_id IN (SELECT site_id FROM site_users WHERE user_id = ?) ORDER BY u.name', [$u['id']])));
        $bySite = [];
        foreach ($members as $mm) $bySite[(int) $mm['site_id']][] = ['id' => (int) $mm['id'], 'name' => $mm['name'], 'role' => $mm['role']];
        foreach ($sites as &$s) {
            foreach (['id', 'archived', 'count'] as $k) $s[$k] = (int) $s[$k];
            $s['cover_id'] = $s['cover_id'] === null ? null : (int) $s['cover_id'];
            $s['users'] = $bySite[$s['id']] ?? [];
        }
        unset($s);
        $un = is_admin($u) ? (int) val("SELECT v FROM stats WHERE k = 'unassigned'") : null;
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
        if (!($name !== $site['name'] && ($site['drive_folder_id'] || $site['nas_folder']))) { out(['ok' => true]); return; }
        {
            respond_then(['ok' => true]);
            if ($site['drive_folder_id'] && drive_active()) {
                try { gapi('PATCH', "https://www.googleapis.com/drive/v3/files/{$site['drive_folder_id']}", json_encode(['name' => $name], JSON_UNESCAPED_UNICODE)); }
                catch (Throwable $e) { error_log('Drive rename: ' . $e->getMessage()); }
            }
            nas_rename_site($site, $name);
        }
        return;
    }

    // ---------- utilizatori
    if ($route === 'GET api/users') {
        $u = need('admin', 'responsabil');
        // ?pick=1: listă scurtă pentru „Cine lucrează aici” (toți oamenii activi)
        if (!empty($_GET['pick'])) {
            $rows = all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE');
            foreach ($rows as &$r) $r['id'] = (int) $r['id'];
            out($rows);
            return;
        }
        $mine = is_admin($u) ? null : assigned($u['id']);
        $users = is_admin($u)
            ? all('SELECT u.id, u.name, u.username, u.role, u.active, u.photo_count AS count FROM users u ORDER BY u.active DESC, u.name COLLATE NOCASE')
            : all("SELECT u.id, u.name, u.username, u.role, u.active, u.photo_count AS count FROM users u
                   WHERE u.role = 'muncitor' AND (u.created_by = :me OR u.id IN (SELECT user_id FROM site_users WHERE site_id IN (SELECT site_id FROM site_users WHERE user_id = :me2)))
                   ORDER BY u.active DESC, u.name COLLATE NOCASE", ['me' => $u['id'], 'me2' => $u['id']]);
        $byUser = [];
        foreach (all('SELECT user_id, site_id FROM site_users') as $l) $byUser[(int) $l['user_id']][] = (int) $l['site_id'];
        foreach ($users as &$x) {
            foreach (['id', 'active', 'count'] as $k) $x[$k] = (int) $x[$k];
            $all = $byUser[$x['id']] ?? [];
            // responsabilul vede doar șantierele lui; restul doar ca număr
            $x['siteIds'] = $mine === null ? $all : array_values(array_intersect($all, $mine));
            if ($mine !== null) $x['otherSites'] = count($all) - count($x['siteIds']);
        }
        out($users);
        return;
    }
    if ($route === 'POST api/users') {
        $me = need('admin', 'responsabil');
        $b = body();
        $name = clean($b['name'] ?? '', 80); $user = clean($b['username'] ?? '', 40); $pw = (string) ($b['password'] ?? '');
        $role = in_array($b['role'] ?? '', ROLES, true) ? $b['role'] : 'muncitor';
        $sites = is_array($b['siteIds'] ?? null) ? array_map('intval', $b['siteIds']) : [];
        if (!is_admin($me)) { // responsabilul creează doar muncitori, pe șantierele lui
            $role = 'muncitor';
            $sites = array_values(array_intersect($sites, assigned($me['id'])));
        }
        if (!$name || !$user) fail(400, 'Completează numele și utilizatorul');
        if (strlen($pw) < 4) fail(400, 'Parola trebuie să aibă minim 4 caractere');
        if (val('SELECT 1 FROM users WHERE username = ?', [$user])) fail(400, 'Utilizatorul există deja');
        $id = tx(function () use ($name, $user, $pw, $role, $sites, $me, $db) {
            q('INSERT INTO users(name, username, pass_hash, role, created_by) VALUES (?, ?, ?, ?, ?)', [$name, $user, password_hash($pw, PASSWORD_DEFAULT), $role, $me['id']]);
            $id = (int) $db->lastInsertId();
            set_user_sites($id, $sites);
            return $id;
        });
        out(['id' => $id]);
        return;
    }
    if (preg_match('#^PATCH api/users/(\d+)$#', $route, $m)) {
        $me = need('admin', 'responsabil');
        $id = (int) $m[1];
        $u = one('SELECT * FROM users WHERE id = ?', [$id]);
        if (!$u) fail(404, 'Utilizator inexistent');
        $u['id'] = (int) $u['id'];
        if (!manages($me, $u)) fail(403, 'Poți modifica doar muncitorii de pe șantierele tale');
        $b = body();
        $admin = is_admin($me);
        $role = $admin && in_array($b['role'] ?? '', ROLES, true) ? $b['role'] : $u['role']; // responsabilul nu schimbă rolul
        $active = array_key_exists('active', $b) ? ($b['active'] ? 1 : 0) : (int) $u['active'];
        if ($id === $me['id'] && ($role !== 'admin' || !$active)) fail(400, 'Nu îți poți scoate singur drepturile de admin');
        $mySites = $admin ? [] : assigned($me['id']);
        $theirs = assigned($id);
        if (!$admin && $active !== (int) $u['active'] && array_diff($theirs, $mySites))
            fail(403, 'Muncitorul lucrează și pe alte șantiere: doar adminul îl poate dezactiva');
        $username = array_key_exists('username', $b) ? clean($b['username'], 40) : $u['username'];
        if (!$username) fail(400, 'Utilizator gol');
        if (val('SELECT 1 FROM users WHERE username = ? AND id != ?', [$username, $id])) fail(400, 'Utilizatorul există deja');
        $pw = (string) ($b['password'] ?? '');
        if ($pw !== '' && strlen($pw) < 4) fail(400, 'Parola trebuie să aibă minim 4 caractere');
        $name = array_key_exists('name', $b) ? (clean($b['name'], 80) ?: $u['name']) : $u['name'];
        $sites = null;
        if (is_array($b['siteIds'] ?? null)) {
            $want = array_map('intval', $b['siteIds']);
            // responsabilul schimbă doar șantierele lui; celelalte rămân cum sunt
            $sites = $admin ? $want : array_values(array_unique(array_merge(array_diff($theirs, $mySites), array_intersect($want, $mySites))));
        }
        tx(function () use ($id, $name, $username, $role, $active, $pw, $sites, $me) {
            q('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?', [$name, $username, $role, $active, $id]);
            if ($pw !== '') {
                q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $id]);
                if ($id !== $me['id']) q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            }
            if (!$active) q('DELETE FROM sessions WHERE user_id = ?', [$id]);
            if ($sites !== null) set_user_sites($id, $sites);
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
        $sid = resolve_site($u, $meta['siteId'] ?? null);
        [$newId, $dup] = store_photo($u, $cid, $sid, resolve_folder($sid, $meta['folderId'] ?? null), clean($meta['comment'] ?? '', 2000),
            $full, $thumb, norm_date($meta['takenAt'] ?? null), is_string($meta['hash'] ?? null) ? $meta['hash'] : null);
        if ($dup) { // poza era deja trimisă: se păstrează doar cea veche
            $e = one('SELECT * FROM entries WHERE id = ?', [$newId]);
            out($e && can_see_entry($u, $e) ? get_entry($newId) + ['duplicate' => true] : ['duplicate' => true, 'id' => $newId]);
            return;
        }
        out(get_entry($newId)); // copierea în Drive/NAS o pornește telefonul separat (api/sync/kick) + cron
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
        $sid = resolve_site($u, $b['siteId'] ?? null);
        $newId = insert_entry("INSERT INTO entries(id, client_id, kind, site_id, folder_id, user_id, comment, taken_at, drive_status) VALUES (?, ?, 'note', ?, ?, ?, ?, ?, 'none')",
            [$cid, $sid, resolve_folder($sid, $b['folderId'] ?? null), $u['id'], $comment, norm_date($b['takenAt'] ?? null)]);
        out(get_entry($newId));
        return;
    }
    if ($route === 'GET api/entries') {
        $u = need();
        $limit = min(max((int) ($_GET['limit'] ?? 60), 1), 200);
        // Derulare: rândurile de după ultimul văzut, în ordinea (dată, număr) descrescătoare.
        // Forma „taken_at <= ? AND (...)” lasă baza să sară direct la locul potrivit din index.
        $cur = ''; $cp = [];
        if (!empty($_GET['before'])) {
            $parts = explode('|', (string) $_GET['before']);
            $cur = ' AND e.taken_at <= ? AND (e.taken_at < ? OR e.id < ?)';
            $cp = [$parts[0], $parts[0], (int) ($parts[1] ?? 0)];
        }
        $order = " ORDER BY e.taken_at DESC, e.id DESC LIMIT $limit";
        $site = (string) ($_GET['site'] ?? '');
        $mine = !empty($_GET['mine']);
        $admin = is_admin($u);
        // Fiecare caz folosește un index: baza citește ~60 de rânduri, oricât de multe poze ar exista.
        if ($site === 'none' || $site !== '' || $mine || $admin) {
            $w = []; $p = [];
            if ($site === 'none') $w[] = 'e.site_id IS NULL';
            elseif ($site !== '') {
                $w[] = 'e.site_id = ?'; $p[] = (int) $site;
                $fq = (string) ($_GET['folder'] ?? '');
                if ($fq === 'root') $w[] = 'e.folder_id IS NULL';
                elseif ($fq !== '') { $w[] = 'e.folder_id = ?'; $p[] = (int) $fq; }
            }
            $ownOnly = $mine || (!$admin && ($site === 'none' || ($site !== '' && !in_array((int) $site, assigned($u['id']), true))));
            if ($ownOnly) { $w[] = 'e.user_id = ?'; $p[] = $u['id']; }
            $sql = ENTRY_SELECT . ' WHERE ' . ($w ? implode(' AND ', $w) : '1') . $cur . $order;
            $p = array_merge($p, $cp);
        } else {
            // Muncitor / responsabil, toate pozele lui: cele mai noi de pe fiecare șantier al lui + ale lui, apoi primele din total.
            $sites = assigned($u['id']);
            if (count($sites) <= 300) {
                $arms = []; $p = [];
                foreach ($sites as $sid) {
                    $arms[] = "SELECT id FROM (SELECT e.id FROM entries e WHERE e.site_id = ?$cur ORDER BY e.taken_at DESC, e.id DESC LIMIT $limit)";
                    $p = array_merge($p, [$sid], $cp);
                }
                $arms[] = "SELECT id FROM (SELECT e.id FROM entries e WHERE e.user_id = ?$cur ORDER BY e.taken_at DESC, e.id DESC LIMIT $limit)";
                $p = array_merge($p, [$u['id']], $cp);
                $sql = ENTRY_SELECT . ' WHERE e.id IN (' . implode(' UNION ', $arms) . ')' . $order;
            } else { // foarte multe șantiere: varianta generală
                $sql = ENTRY_SELECT . ' WHERE (e.user_id = ? OR e.site_id IN (SELECT site_id FROM site_users WHERE user_id = ?))' . $cur . $order;
                $p = array_merge([$u['id'], $u['id']], $cp);
            }
        }
        out(array_map('fix_entry', all($sql, $p)));
        return;
    }
    // Mai multe miniaturi într-o singură cerere (galeria): [id 4 octeți][lungime 4 octeți][JPEG]...
    if ($route === 'GET api/thumbs') {
        $u = need();
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', explode(',', (string) ($_GET['ids'] ?? '')))))), 0, 100);
        if (!$ids) fail(400, 'Lipsesc pozele');
        $mySites = is_admin($u) ? [] : array_flip(assigned($u['id']));
        $buf = '';
        foreach (all('SELECT id, user_id, site_id, kind, thumb FROM entries WHERE id IN (' . implode(',', $ids) . ')') as $e) {
            if ($e['kind'] !== 'photo' || !$e['thumb']) continue;
            $ok = is_admin($u) || (int) $e['user_id'] === $u['id'] || ($e['site_id'] !== null && isset($mySites[(int) $e['site_id']]));
            if (!$ok) continue;
            $data = @file_get_contents($PHOTOS . '/' . $e['thumb']);
            if ($data === false) continue;
            $buf .= pack('NN', (int) $e['id'], strlen($data)) . $data;
        }
        header('Content-Type: application/octet-stream');
        header('Cache-Control: private, no-store');
        header('Content-Length: ' . strlen($buf));
        echo $buf;
        return;
    }
    if (preg_match('#^(PATCH|DELETE) api/entries/(\d+)$#', $route, $m)) {
        $u = need();
        $e = one('SELECT * FROM entries WHERE id = ?', [(int) $m[2]]);
        if (!$e || !can_see_entry($u, $e)) fail(404, 'Nu există');
        $eid = (int) $e['id'];
        if ($m[1] === 'DELETE') {
            if (!can_delete_entry($u, $e)) fail(403, 'Poți șterge doar pozele făcute de tine');
            delete_entry_row($e);
            if ($e['drive_file_id'] || $e['nas_path']) { respond_then(['ok' => true]); drive_delete($e['drive_file_id']); nas_delete($e['nas_path']); }
            else out(['ok' => true]);
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
        $oldSite = $e['site_id'] === null ? null : (int) $e['site_id'];
        $oldFolder = $e['folder_id'] === null ? null : (int) $e['folder_id'];
        // folderul: cel cerut (dacă e al șantierului); la mutarea pe alt șantier, fără folder dacă nu se spune altfel
        if (array_key_exists('folderId', $b)) {
            $folderId = resolve_folder($siteId, $b['folderId']);
            if ($b['folderId'] !== null && $folderId === null) fail(400, 'Folderul nu e al acestui șantier');
        } else $folderId = $siteId === $oldSite ? $oldFolder : null;
        q('UPDATE entries SET site_id = ?, folder_id = ?, comment = ? WHERE id = ?', [$siteId, $folderId, $comment, $eid]);
        if (!(($e['drive_file_id'] || $e['nas_path']) && ($siteId !== $oldSite || $folderId !== $oldFolder || $comment !== $e['comment']))) { out(get_entry($eid)); return; }
        {
            respond_then(get_entry($eid));
            if ($e['drive_file_id']) drive_update($eid);
            if ($e['nas_path']) nas_update($eid);
        }
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

    // ---------- dubluri existente: păstrează cea mai veche poză din fiecare grup identic (admin)
    if ($route === 'POST api/dedupe') {
        need('admin');
        @set_time_limit(120);
        $end = microtime(true) + 15;
        $checked = 0;
        // 1) amprenta pozelor vechi (în bucăți, ca să nu depășească timpul serverului)
        while (microtime(true) < $end) {
            $rows = all("SELECT id, file FROM entries WHERE kind = 'photo' AND file_hash IS NULL AND file IS NOT NULL LIMIT 200");
            if (!$rows) break;
            foreach ($rows as $r) {
                $path = $PHOTOS . '/' . $r['file'];
                q('UPDATE entries SET file_hash = ? WHERE id = ?', [is_file($path) ? hash_file('sha256', $path) : 'lipsă-' . $r['id'], $r['id']]);
                $checked++;
            }
        }
        $remaining = (int) val("SELECT COUNT(*) FROM entries WHERE kind = 'photo' AND file_hash IS NULL AND file IS NOT NULL");
        if ($remaining) { out(['checked' => $checked, 'remaining' => $remaining, 'removed' => 0]); return; }
        // 2) grupuri identice: rămâne prima poză (cea mai veche), restul se șterg
        $remote = []; $removed = 0;
        foreach (['file_hash', 'hash'] as $col) {
            foreach (all("SELECT $col AS h, MIN(id) AS keep FROM entries WHERE kind = 'photo' AND $col IS NOT NULL AND $col NOT LIKE 'lipsă-%' GROUP BY $col HAVING COUNT(*) > 1") as $g) {
                foreach (all("SELECT * FROM entries WHERE $col = ? AND id != ? AND kind = 'photo'", [$g['h'], $g['keep']]) as $e) {
                    $remote[] = delete_entry_row($e); $removed++;
                }
            }
        }
        if (!$remote) { out(['checked' => $checked, 'remaining' => 0, 'removed' => 0]); return; }
        respond_then(['checked' => $checked, 'remaining' => 0, 'removed' => $removed]);
        foreach ($remote as [$driveId, $nasPath]) { drive_delete($driveId); nas_delete($nasPath); }
        return;
    }

    // ---------- foldere pe șantier
    if ($route === 'GET api/folders') {
        $u = need();
        $sid = (int) ($_GET['site'] ?? 0);
        if (!$sid || !can_use_site($u, $sid)) fail(403, 'Nu ai acces la acest șantier');
        $counts = [];
        foreach (all('SELECT folder_id, COUNT(*) AS n FROM entries WHERE site_id = ? GROUP BY folder_id', [$sid]) as $r) $counts[(int) $r['folder_id']] = (int) $r['n'];
        $folders = [];
        foreach (site_folders([$sid])[$sid] ?? [] as $f) $folders[] = $f + ['count' => $counts[$f['id']] ?? 0];
        out(['folders' => $folders, 'root' => $counts[0] ?? 0]);
        return;
    }
    if ($route === 'POST api/folders') {
        $u = need('admin', 'responsabil');
        $b = body();
        $sid = (int) ($b['siteId'] ?? 0);
        $name = clean($b['name'] ?? '', 80);
        if (!$sid || !can_use_site($u, $sid) || !val('SELECT 1 FROM sites WHERE id = ?', [$sid])) fail(403, 'Nu ai acces la acest șantier');
        if ($name === '') fail(400, 'Scrie numele folderului');
        if (folder_name_taken($sid, $name)) fail(400, 'Există deja un folder cu acest nume');
        q('INSERT INTO folders(site_id, name) VALUES (?, ?)', [$sid, $name]);
        out(['id' => (int) $db->lastInsertId(), 'name' => $name]);
        return;
    }
    if (preg_match('#^(PATCH|DELETE) api/folders/(\d+)$#', $route, $m)) {
        $u = need('admin', 'responsabil');
        $f = one('SELECT * FROM folders WHERE id = ?', [(int) $m[2]]);
        if (!$f || !can_use_site($u, (int) $f['site_id'])) fail(404, 'Folderul nu există');
        $fid = (int) $f['id'];
        if ($m[1] === 'PATCH') {
            $name = clean(body()['name'] ?? '', 80);
            if ($name === '') fail(400, 'Scrie numele folderului');
            if (folder_name_taken((int) $f['site_id'], $name, $fid)) fail(400, 'Există deja un folder cu acest nume');
            q('UPDATE folders SET name = ? WHERE id = ?', [$name, $fid]);
            if (!($f['drive_folder_id'] || $f['nas_name'])) { out(['ok' => true]); return; }
            respond_then(['ok' => true]);
            if ($f['drive_folder_id'] && drive_active()) {
                try { gapi('PATCH', "https://www.googleapis.com/drive/v3/files/{$f['drive_folder_id']}", json_encode(['name' => $name], JSON_UNESCAPED_UNICODE)); }
                catch (Throwable $e) { error_log('Drive rename folder: ' . $e->getMessage()); }
            }
            if ($f['nas_name'] && nas_active()) {
                try {
                    $site = nas_site_folder((int) $f['site_id']); $new = nas_clean_name($name);
                    $c = nas_move("$site/{$f['nas_name']}", "$site/$new");
                    if ($c >= 200 && $c < 300) {
                        q('UPDATE folders SET nas_name = ? WHERE id = ?', [$new, $fid]);
                        foreach (all('SELECT id, nas_path FROM entries WHERE folder_id = ? AND nas_path IS NOT NULL', [$fid]) as $r)
                            q('UPDATE entries SET nas_path = ? WHERE id = ?', ["$site/$new/" . basename($r['nas_path']), $r['id']]);
                    }
                } catch (Throwable $e) { error_log('NAS rename folder: ' . $e->getMessage()); }
            }
            return;
        }
        // ștergere: pozele rămân, direct în șantier (și se mută la fel în Drive / NAS)
        $moved = all('SELECT id FROM entries WHERE folder_id = ? AND (drive_file_id IS NOT NULL OR nas_path IS NOT NULL)', [$fid]);
        q('UPDATE entries SET folder_id = NULL WHERE folder_id = ?', [$fid]);
        q('DELETE FROM folders WHERE id = ?', [$fid]);
        if (!$moved && !$f['drive_folder_id'] && !$f['nas_name']) { out(['ok' => true]); return; }
        respond_then(['ok' => true]);
        foreach ($moved as $r) { drive_update((int) $r['id']); nas_update((int) $r['id']); }
        if ($f['drive_folder_id']) drive_delete($f['drive_folder_id']);
        if ($f['nas_name'] && nas_active()) { try { nas_req('DELETE', nas_site_folder((int) $f['site_id']) . '/' . $f['nas_name'] . '/'); } catch (Throwable $e) {} }
        return;
    }

    // ---------- cheie personală (scurtătura iPhone „Foto Șantier”)
    if ($route === 'GET api/key') {
        $u = need();
        $log = all('SELECT at, ok, message FROM shortcut_log WHERE user_id = ? ORDER BY id DESC LIMIT 8', [$u['id']]);
        foreach ($log as &$l) { $l['ok'] = (bool) $l['ok']; $l['at'] = str_replace(' ', 'T', $l['at']) . 'Z'; }
        $bad = is_admin($u) ? json_decode((string) setting('shortcut_badkey'), true) : null;
        out(['has' => (bool) val('SELECT key_hash FROM users WHERE id = ?', [$u['id']]), 'log' => $log, 'badKey' => $bad,
             'limit' => ini_get('upload_max_filesize') . ' / ' . ini_get('post_max_size')]);
        return;
    }
    if ($route === 'POST api/key') { // ?new=1: cheie nouă (cea veche nu mai merge); altfel cheia existentă
        $u = need();
        $key = empty($_GET['new']) ? val('SELECT api_key FROM users WHERE id = ? AND key_hash IS NOT NULL', [$u['id']]) : null;
        if (!$key) {
            $key = 'fs_' . bin2hex(random_bytes(20));
            q('UPDATE users SET key_hash = ?, api_key = ? WHERE id = ?', [hash('sha256', $key), $key, $u['id']]);
        }
        out(['key' => $key]);
        return;
    }
    if ($route === 'DELETE api/key') { $u = need(); q('UPDATE users SET key_hash = NULL, api_key = NULL WHERE id = ?', [$u['id']]); out(['ok' => true]); return; }
    if (preg_match('#^(GET|POST) api/shortcut/(destinations|upload)$#', $route)) {
        shortcut($route);
        return;
    }

    // ---------- Google Drive
    if ($route === 'GET api/drive') {
        global $CONFIG;
        need('admin');
        out(['configured' => drive_configured(), 'connected' => drive_connected(), 'editable' => true,
            'enabled' => setting('drive_enabled') !== '0',
            'nas' => ['configured' => nas_configured(), 'enabled' => setting('nas_enabled') !== '0',
                'url' => setting('nas_url') ?: '', 'user' => setting('nas_user') ?: '', 'insecure' => setting('nas_insecure') === '1',
                'folder' => nas_root(), 'lastError' => setting('nas_last_error'),
                'pending' => nas_configured() ? (int) val("SELECT COUNT(*) FROM entries WHERE kind='photo' AND nas_status='pending'") : 0],
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
    if ($route === 'POST api/sync/kick') { // după ce telefonul a terminat de trimis pozele
        need();
        respond_then(['ok' => true]);
        if (sync_active()) sync_work(50);
        return;
    }
    if ($route === 'POST api/drive/sync') {
        need('admin');
        respond_then(['ok' => true]);
        sync_work(50);
        return;
    }
    if ($route === 'POST api/drive/enabled') {
        need('admin');
        set_setting('drive_enabled', !empty(body()['enabled']) ? '1' : '0');
        out(['ok' => true]);
        return;
    }
    if ($route === 'POST api/nas/config') {
        need('admin');
        $b = body();
        $url = rtrim(clean($b['url'] ?? '', 500), '/');
        $user = clean($b['user'] ?? '', 200);
        $pass = (string) ($b['password'] ?? '');
        if ($pass === '' && $url === setting('nas_url') && $user === setting('nas_user')) $pass = (string) setting('nas_pass'); // parola rămâne
        if (!preg_match('#^https?://#i', $url)) fail(400, 'Adresa trebuie să înceapă cu https:// (de ex. https://numele-tau.synology.me:5006/photo)');
        $cfg = ['url' => $url, 'user' => $user, 'pass' => $pass, 'insecure' => !empty($b['insecure'])];
        try {
            $c = nas_req('PROPFIND', '', ['Depth: 0'], null, $cfg);
            if ($c === 404) throw new NasError('NAS: folderul din adresă nu există');
            if ($c >= 400) throw new NasError("NAS: răspuns neașteptat (HTTP $c). Verifică dacă WebDAV e pornit.");
            $c = nas_req('MKCOL', nas_root(), [], null, $cfg);
            if (!in_array($c, [201, 405, 301, 200], true)) throw new NasError("NAS: nu pot crea folderul „" . nas_root() . "” (HTTP $c). Verifică dreptul de scriere.");
        } catch (NasError $e) { fail(400, $e->getMessage()); }
        $changed = $url !== setting('nas_url');
        set_setting('nas_url', $url); set_setting('nas_user', $user); set_setting('nas_pass', $pass);
        set_setting('nas_insecure', $cfg['insecure'] ? '1' : '0'); set_setting('nas_enabled', '1'); set_setting('nas_last_error', null);
        if ($changed) { // NAS nou: copiem toate pozele de la început
            q("UPDATE entries SET nas_status='pending', nas_path=NULL WHERE kind='photo'");
            q('UPDATE sites SET nas_folder = NULL');
        }
        respond_then(['ok' => true]);
        nas_work(50);
        return;
    }
    if ($route === 'POST api/nas/enabled') {
        need('admin');
        set_setting('nas_enabled', !empty(body()['enabled']) ? '1' : '0');
        out(['ok' => true]);
        return;
    }
    if ($route === 'POST api/nas/remove') {
        need('admin');
        foreach (['nas_url', 'nas_user', 'nas_pass', 'nas_insecure', 'nas_last_error'] as $k) set_setting($k, null);
        out(['ok' => true]);
        return;
    }

    fail(404, 'Nu există');
}
