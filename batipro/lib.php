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
        // colonnes de la validation en deux étapes (ajoutées une seule fois sur les installations existantes)
        // index pour les grosses firmes (une fois) : éléments d'un chantier, fichiers, tentatives de connexion
        $fi = __DIR__ . '/uploads/.db-idx2';
        if (!is_file($fi)) {
            foreach (['ALTER TABLE items ADD lite MEDIUMTEXT NULL', 'ALTER TABLE items ADD KEY company_project (company_id, project_id)', 'ALTER TABLE files ADD KEY company_project (company_id, project_id)', 'ALTER TABLE notifs ADD KEY uc (user_id, company_id, id)'] as $sql) { try { $pdo->exec($sql); } catch (Throwable $e) { /* déjà là */ } }
            @file_put_contents($fi, '1');
        }
        $flag = __DIR__ . '/uploads/.db-2fa';
        if (!is_file($flag)) {
            try { $pdo->exec('ALTER TABLE users ADD COLUMN totp VARCHAR(64) NULL, ADD COLUMN totp_step BIGINT NOT NULL DEFAULT 0'); } catch (Throwable $e) { /* déjà là */ }
            @file_put_contents($flag, '1');
        }
    }
    return $pdo;
}

// ---------------------------------------------------------------- Validation en deux étapes (TOTP, RFC 6238 : Google Authenticator, Microsoft Authenticator…)
function b32_encode(string $bin): string {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    foreach (str_split($bin) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 5) as $chunk) $out .= $a[bindec(str_pad($chunk, 5, '0'))];
    return $out;
}
function b32_decode(string $s): string {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $c) $bits .= str_pad(decbin(strpos($a, $c)), 5, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
    return $out;
}
function totp_code(string $secret, int $step): string {
    $h = hash_hmac('sha1', pack('N2', 0, $step), b32_decode($secret), true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT);
}
// renvoie le pas de temps accepté (±30 s de décalage d'horloge), 0 si le code est faux ou déjà utilisé
function totp_verify(string $secret, string $code, int $lastStep = 0): int {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) return 0;
    $now = intdiv(time(), 30);
    for ($d = -1; $d <= 1; $d++) if ($now + $d > $lastStep && hash_equals(totp_code($secret, $now + $d), $code)) return $now + $d;
    return 0;
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
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if (strlen((string)$json) > 2048) gzip_start();
    echo $json;
    exit;
}
// Réponse compressée (gzip) si le navigateur l'accepte et que l'hébergement ne compresse pas déjà : les listes JSON passent ~8× plus vite
function gzip_start(): void {
    static $on = false;
    if ($on || headers_sent() || !extension_loaded('zlib') || ini_get('zlib.output_compression')) return;
    if (!str_contains((string)($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip')) return;
    $on = true; ob_start('ob_gzhandler', 65536);
}
// Une ligne de la table items en JSON, sans décoder ni réencoder les données (déjà du JSON écrit par l'application)
function row_json(array $r): string {
    $d = (string)$r['data']; if ($d === '' || $d === '[]' || $d === 'null') $d = '{}';
    return '{"id":' . (int)$r['id'] . ',"type":' . json_encode($r['type']) . ',"project_id":' . ($r['project_id'] !== null ? (int)$r['project_id'] : 'null')
        . ',"parent_id":' . ($r['parent_id'] !== null ? (int)$r['parent_id'] : 'null') . ',"number":' . json_encode($r['number'], JSON_UNESCAPED_UNICODE)
        . ',"version":' . (int)$r['version'] . ',"created_by":' . ($r['created_by'] !== null ? (int)$r['created_by'] : 'null') . ',"updated_by":' . ($r['updated_by'] !== null ? (int)$r['updated_by'] : 'null')
        . ',"created_at":' . json_encode($r['created_at']) . ',"updated_at":' . json_encode($r['updated_at']) . ',"data":' . $d . '}';
}
// Liste d'éléments envoyée au fil de la lecture (mémoire constante, même pour une firme de dizaines de milliers de documents).
// $group : réponse { type: [...] } (requête multi-types, lignes triées par type) ; $see / $view : filtre et vue (terrain, responsable)
// Liste « lite » : devis / factures / commandes sans leurs lignes, avec leur résumé des totaux (_sum, écrit par l'application)
const LITE_TYPES = ['quote', 'invoice', 'order'];
function lite_data(array $d): array {
    // nombre de lignes chiffrées gardé (brouillon vide ou non), puis les lignes retirées
    $d['_items'] = count(array_filter((array)($d['lines'] ?? []), fn($l) => is_array($l) && ($l['kind'] ?? '') === 'item'));
    unset($d['lines'], $d['progressRows']); $d['_lite'] = true; return $d;
}
// version « lite » enregistrée avec le document (colonne items.lite) : les listes la lisent sans rien recalculer
function lite_json(string $type, $data): ?string { return in_array($type, LITE_TYPES, true) && is_array($data) && isset($data['_sum']) ? json_encode(lite_data($data), JSON_UNESCAPED_UNICODE) : null; }
function stream_items(string $sql, array $args, ?array $group = null, ?callable $see = null, ?callable $view = null, bool $lite = false): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    gzip_start();
    $pdo = db();
    $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
    $st = $pdo->prepare($sql); $st->execute($args);
    $buf = ''; $cur = null; $first = true;
    echo $group !== null ? '{' : '[';
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
        if ($see && !$see($r)) continue;
        $isLite = $lite && in_array($r['type'], LITE_TYPES, true) && (($r['lite'] ?? null) !== null || str_contains((string)$r['data'], '"_sum"'));
        if ($isLite && ($r['lite'] ?? null) !== null) { $r['data'] = $r['lite']; $isLite = false; }
        if ($view) { $v = $view($r); if ($isLite && is_array($v['data'])) $v['data'] = lite_data($v['data']); $j = json_encode($v, JSON_UNESCAPED_UNICODE); }
        elseif ($isLite) { $r['data'] = json_encode(lite_data(json_decode((string)$r['data'], true) ?: []), JSON_UNESCAPED_UNICODE); $j = row_json($r); }
        else $j = row_json($r);
        if ($group !== null && $r['type'] !== $cur) {
            $buf .= ($cur === null ? '' : '],') . json_encode($r['type']) . ':['; $cur = $r['type']; unset($group[$cur]); $first = true;
        }
        $buf .= ($first ? '' : ',') . $j; $first = false;
        if (strlen($buf) > 65536) { echo $buf; $buf = ''; }
    }
    $st->closeCursor(); $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
    if ($group !== null) { if ($cur !== null) $buf .= ']'; foreach (array_keys($group) as $t) $buf .= ($cur === null && $t === array_key_first($group) ? '' : ',') . json_encode($t) . ':[]'; $buf .= '}'; }
    else $buf .= ']';
    echo $buf;
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
    ini_set('session.use_strict_mode', '1'); ini_set('session.use_only_cookies', '1');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}
// « Rester connecté » : jeton longue durée (30 jours) dans un cookie séparé, gardé haché en base (sélecteur + secret).
// Il recrée la session quand le serveur l'a effacée ou que le navigateur / l'app du téléphone a été fermé.
// Invalide si le mot de passe change ; supprimé à la déconnexion.
const REMEMBER_DAYS = 30;
function remember_table(): void {
    static $done = false; if ($done) return; $done = true;
    db()->exec('CREATE TABLE IF NOT EXISTS remember_tokens (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, selector CHAR(24) NOT NULL, hash CHAR(64) NOT NULL, pv CHAR(16) NOT NULL, expires DATETIME NOT NULL, created_at DATETIME NOT NULL, UNIQUE KEY sel (selector), KEY u (user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}
function remember_cookie(string $value, int $expires): void {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    if (!headers_sent()) setcookie('BPREM', $value, ['expires' => $expires, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
}
function remember_issue(int $uid, string $passHash): void {
    remember_table();
    q('DELETE FROM remember_tokens WHERE expires < ?', [now()]);
    $sel = bin2hex(random_bytes(12)); $val = bin2hex(random_bytes(32)); $exp = time() + REMEMBER_DAYS * 86400;
    q('INSERT INTO remember_tokens (user_id, selector, hash, pv, expires, created_at) VALUES (?,?,?,?,?,?)', [$uid, $sel, hash('sha256', $val), pass_version($passHash), date('Y-m-d H:i:s', $exp), now()]);
    remember_cookie("$sel:$val", $exp);
}
function remember_forget(): void {
    $c = (string)($_COOKIE['BPREM'] ?? '');
    if ($c !== '' && strpos($c, ':') !== false) { try { remember_table(); q('DELETE FROM remember_tokens WHERE selector = ?', [explode(':', $c, 2)[0]]); } catch (Throwable $e) { /* table absente */ } }
    remember_cookie('', time() - 3600);
}
// session perdue mais cookie « rester connecté » valable : la session est recréée (et le jeton renouvelé)
function remember_restore(): void {
    $c = (string)($_COOKIE['BPREM'] ?? '');
    if (!preg_match('/^([a-f0-9]{24}):([a-f0-9]{64})$/', $c, $m)) return;
    try { remember_table(); } catch (Throwable $e) { return; }
    $t = q('SELECT * FROM remember_tokens WHERE selector = ?', [$m[1]])->fetch();
    if (!$t) return;
    if ($t['expires'] < now() || !hash_equals($t['hash'], hash('sha256', $m[2]))) { q('DELETE FROM remember_tokens WHERE id = ?', [$t['id']]); remember_cookie('', time() - 3600); return; }
    $u = q('SELECT id, pass, active FROM users WHERE id = ?', [$t['user_id']])->fetch();
    if (!$u || !$u['active'] || $t['pv'] !== pass_version((string)$u['pass'])) { q('DELETE FROM remember_tokens WHERE id = ?', [$t['id']]); remember_cookie('', time() - 3600); return; }
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$u['id'], 'pv' => pass_version((string)$u['pass']), 'seen' => time(), 'remember' => 1];
    // même jeton, validité prolongée (30 jours glissants) : plusieurs requêtes simultanées ne s'annulent pas
    $exp = time() + REMEMBER_DAYS * 86400;
    q('UPDATE remember_tokens SET expires = ? WHERE id = ?', [date('Y-m-d H:i:s', $exp), $t['id']]);
    remember_cookie($c, $exp);
}
// empreinte du mot de passe gardée en session : un changement de mot de passe déconnecte les autres appareils
function pass_version(string $hash): string { return substr(hash('sha256', $hash), 0, 16);
}

function current_user(): ?array {
    start_session();
    if (empty($_SESSION['uid']) && empty($_SESSION['pending'])) remember_restore();
    if (empty($_SESSION['uid'])) return null;
    static $u = false;
    if ($u === false) {
        $u = q('SELECT u.id, u.name, u.email, u.role, u.active, u.color, u.company_id, u.super, u.pass, (u.totp IS NOT NULL) AS has2fa, c.active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?', [$_SESSION['uid']])->fetch() ?: null;
        if ($u && (!$u['active'] || (!$u['super'] && !(int)$u['company_active']))) $u = null;
        // mot de passe changé ailleurs, ou plus de 30 jours sans utiliser l'application : reconnexion
        if ($u && ((isset($_SESSION['pv']) && $_SESSION['pv'] !== pass_version((string)$u['pass'])) || (isset($_SESSION['seen']) && time() - (int)$_SESSION['seen'] > 30 * 86400))) { $_SESSION = []; $u = null; }
        if ($u) { unset($u['pass']); if (time() - (int)($_SESSION['seen'] ?? 0) > 300) $_SESSION['seen'] = time(); }
        if ($u) {
            foreach (['id', 'active', 'company_id', 'super', 'has2fa'] as $k) $u[$k] = (int)$u[$k];
            unset($u['company_active']);
            // le super-administrateur peut travailler dans une autre firme
            $GLOBALS['BP_CID'] = $u['super'] && !empty($_SESSION['cid']) ? (int)$_SESSION['cid'] : $u['company_id'];
        }
        if (!defined('BP_KEEP_SESSION') && session_status() === PHP_SESSION_ACTIVE) session_write_close();
    }
    return $u;
}

// Firme dans laquelle on travaille (toutes les données sont séparées par firme)
function cid(): int { return (int)($GLOBALS['BP_CID'] ?? 1); }

function require_user(): array {
    $u = current_user();
    if (!$u) fail(401, 'Session expirée, reconnectez-vous.');
    return $u;
}

function require_admin(): array {
    $u = require_user();
    if ($u['role'] !== 'admin' && !$u['super']) fail(403, 'Réservé aux administrateurs.');
    return $u;
}

// ---------------------------------------------------------------- Espace terrain (ouvriers, sous-traitants)
// Comptes limités : ils ne voient que les chantiers qui leur sont attribués, leurs heures, leurs rapports,
// les rapports qu'on leur envoie, leurs bons de commande et leur planning. Tout est vérifié ici, côté serveur.
const FIELD_ROLES = ['ouvrier', 'soustraitant'];
const USER_ROLES = ['admin', 'user', 'chef', 'ouvrier', 'soustraitant'];
// Responsable d'équipe / d'atelier : bureau sans la facturation (il la demande au patron via « billreq »)
const CHEF_READONLY = ['invoice', 'contract', 'expense'];
function is_chef(array $u): bool { return ($u['role'] ?? '') === 'chef' && empty($u['super']); }
// responsable(s) d'un membre du personnel (fiche RH → « Responsable »)
function chef_of_employee(int $eid): array {
    if (!$eid) return [];
    $r = q("SELECT data FROM items WHERE id = ? AND type = 'employee' AND company_id = ?", [$eid, cid()])->fetch();
    $c = (int)(($r ? json_decode($r['data'], true) : [])['chefId'] ?? 0);
    return $c ? [$c] : [];
}
function is_field(array $u): bool { return in_array($u['role'], FIELD_ROLES, true) && !$u['super']; }
function require_staff(): array {
    $u = require_user();
    if (is_field($u)) fail(403, 'Accès réservé au bureau.');
    return $u;
}
// Fiche liée au compte (personnel ou sous-traitant) et chantiers attribués
function field_scope(array $me): array {
    static $cache = [];
    if (isset($cache[$me['id']])) return $cache[$me['id']];
    $emp = 0; $con = 0;
    foreach (q("SELECT id, type, data FROM items WHERE company_id = ? AND type IN ('employee', 'contact')", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        if ((int)($d['userId'] ?? 0) !== $me['id']) continue;
        if ($r['type'] === 'employee') $emp = (int)$r['id']; else $con = (int)$r['id'];
    }
    $pids = [];
    foreach (q("SELECT id, type, project_id, data FROM items WHERE company_id = ? AND type IN ('project', 'phase', 'assign', 'order')", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $pid = $r['type'] === 'project' ? (int)$r['id'] : (int)$r['project_id'];
        if (!$pid) continue;
        $ok = match ($r['type']) {
            'project' => in_array($me['id'], array_map('intval', (array)($d['team'] ?? [])), true) || ($con && in_array($con, array_map('intval', (array)($d['subs'] ?? [])), true)),
            'phase' => ($emp && in_array($emp, array_map('intval', (array)($d['staff'] ?? [])), true)) || ($con && (int)($d['companyId'] ?? 0) === $con),
            'assign' => $emp && (int)($d['employeeId'] ?? 0) === $emp,
            'order' => $con && (int)($d['supplierId'] ?? 0) === $con,
            default => false,
        };
        if ($ok) $pids[$pid] = true;
    }
    return $cache[$me['id']] = ['employee' => $emp, 'contact' => $con, 'projects' => array_keys($pids)];
}
// Un élément peut-il être lu par ce compte terrain ?
function field_can_read(array $me, array $row): bool {
    $sc = field_scope($me);
    $d = json_decode((string)$row['data'], true) ?: [];
    $pid = (int)($row['project_id'] ?? 0);
    $inProj = $pid && in_array($pid, $sc['projects'], true);
    $mine = (int)$row['created_by'] === $me['id'];
    switch ($row['type']) {
        case 'project': return in_array((int)$row['id'], $sc['projects'], true);
        case 'phase': return $inProj;
        case 'assign': return $sc['employee'] && (int)($d['employeeId'] ?? 0) === $sc['employee'];
        case 'timesheet': return $mine || ($sc['employee'] && (int)($d['employeeId'] ?? 0) === $sc['employee']);
        case 'report': return $mine || in_array($me['id'], array_map('intval', (array)($d['to'] ?? [])), true);
        case 'order': return $sc['contact'] && (int)($d['supplierId'] ?? 0) === $sc['contact'] && ($d['status'] ?? 'brouillon') !== 'brouillon';
        case 'contact': return $sc['contact'] && (int)$row['id'] === $sc['contact'];
        case 'employee': return $sc['employee'] && (int)$row['id'] === $sc['employee'];
        case 'plan': return $inProj;
        case 'point': return $inProj && field_point_mine($me, $sc, $d);
        default: return false;
    }
}
// Ce qu'un compte terrain reçoit d'un élément lisible : jamais le client, le budget, les devis ni les coûts internes
const FIELD_KEEP = [
    'project' => ['name', 'address', 'zip', 'city', 'status', 'start', 'end', 'access', 'color'],
    'phase' => ['name', 'start', 'end', 'progress', 'staff', 'companyId'],
    'employee' => ['name', 'firstname', 'userId', 'active'],
    'contact' => ['company', 'firstname', 'name', 'kind', 'email', 'phone', 'mobile', 'userId'],
    'timesheet' => ['date', 'hours', 'task', 'site', 'employeeId', 'contactId', 'who'],
];
function field_view(array $r): array {
    $keep = FIELD_KEEP[$r['type']] ?? null;
    if ($keep === null) return $r;
    $d = json_decode((string)$r['data'], true) ?: [];
    $r['data'] = json_encode(array_intersect_key($d, array_flip($keep)), JSON_UNESCAPED_UNICODE);
    return $r;
}
// Mois clôturé : le terrain n'encode et ne corrige que les heures du mois en cours (heure belge) ; le bureau garde la main sur les archives
function field_month_open(?string $date): bool {
    return substr((string)$date, 0, 7) === (new DateTime('now', new DateTimeZone('Europe/Brussels')))->format('Y-m');
}
// Point sur plan attribué à ce compte terrain (son entreprise sous-traitante, ou lui-même)
function field_point_mine(array $me, array $sc, array $d): bool {
    return ($sc['contact'] && (int)($d['companyId'] ?? 0) === $sc['contact']) || (int)($d['assigneeId'] ?? 0) === $me['id'];
}
// Point modifié par le terrain : statut (jamais « clôturé », réservé au bureau), photos qu'il a envoyées, commentaires ajoutés.
// Tout le reste (titre, attribution, échéance, position…) reste tel que le bureau l'a écrit.
function field_point_update(array $me, array $cur, array $new): array {
    $d = json_decode((string)$cur['data'], true) ?: [];
    $labels = ['open' => 'Ouvert', 'progress' => 'En cours', 'done' => 'Levé', 'closed' => 'Clôturé'];
    $hist = array_values((array)($d['history'] ?? []));
    $stamp = gmdate('Y-m-d H:i:s');
    // commentaires ajoutés à la suite de l'historique connu
    foreach (array_slice(array_values((array)($new['history'] ?? [])), count($hist)) as $h) {
        $txt = trim((string)(is_array($h) ? ($h['text'] ?? '') : ''));
        if ($txt !== '' && ($h['kind'] ?? '') === 'comment') $hist[] = ['t' => $stamp, 'uid' => $me['id'], 'kind' => 'comment', 'text' => mb_substr($txt, 0, 2000)];
    }
    $was = (string)($d['status'] ?? 'open'); $st = (string)($new['status'] ?? $was);
    if ($st !== $was && $was !== 'closed' && in_array($st, ['open', 'progress', 'done'], true)) {
        $d['status'] = $st;
        $hist[] = ['t' => $stamp, 'uid' => $me['id'], 'kind' => 'sys', 'text' => 'Statut : ' . ($labels[$was] ?? $was) . ' → ' . $labels[$st]];
    }
    $photos = array_map('intval', (array)($d['photos'] ?? []));
    foreach ((array)($new['photos'] ?? []) as $fid) {
        $fid = (int)$fid;
        if ($fid && !in_array($fid, $photos, true) && q('SELECT 1 FROM files WHERE id = ? AND company_id = ? AND created_by = ?', [$fid, cid(), $me['id']])->fetchColumn()) $photos[] = $fid;
    }
    $d['photos'] = $photos; $d['history'] = $hist;
    return $d;
}
// Ce que la fiche d'un élément terrain peut contenir quand c'est le compte terrain qui l'écrit
function field_can_write(array $me, string $type, ?int $pid, array $data, ?array $cur): bool {
    $sc = field_scope($me);
    if ($cur && (int)$cur['created_by'] !== $me['id']) return false;
    if ($pid && !in_array($pid, $sc['projects'], true)) return false;
    // heures sur un de ses chantiers, ou sur un chantier pas encore créé au bureau (nom écrit par lui)
    if ($type === 'timesheet') return ($pid || (string)($data['site'] ?? '') !== '') && (!$sc['employee'] || (int)($data['employeeId'] ?? 0) === $sc['employee']);
    if ($type === 'report') return true;
    return false;
}

// Fichier lisible par un compte terrain : envoyé par lui, logo de la firme, ou joint à un rapport qu'il peut lire
function field_can_file(array $me, array $f): bool {
    if ((int)$f['created_by'] === $me['id']) return true;
    $co = setting('company', []) ?: [];
    if ((int)($co['logoId'] ?? 0) === (int)$f['id']) return true;
    // fichiers d'un rapport, d'un plan (version actuelle) ou d'un point qu'il peut lire
    foreach (q("SELECT * FROM items WHERE company_id = ? AND type IN ('report', 'plan', 'point')", [cid()])->fetchAll() as $r) {
        if (!field_can_read($me, $r)) continue;
        $d = json_decode($r['data'], true) ?: [];
        $ids = $r['type'] === 'plan' ? [(int)($d['fileId'] ?? 0), (int)($d['thumbId'] ?? 0)]
            : array_map(fn($x) => (int)(is_array($x) ? ($x['id'] ?? 0) : $x), array_merge((array)($d['photos'] ?? []), (array)($d['files'] ?? [])));
        if (in_array((int)$f['id'], $ids, true)) return true;
    }
    return false;
}
// ---------------------------------------------------------------- Responsable : uniquement ses projets et son équipe
// Ses projets : ceux dont il est le conducteur ou dans l'équipe ; son équipe : les fiches du personnel qui le désignent (et la sienne).
// Les clients de ses projets ; fournisseurs et sous-traitants restent visibles (commandes). Le reste de l'entreprise lui est caché.
function chef_scope(array $me, bool $fresh = false): array {
    static $cache = [];
    if (!$fresh && isset($cache[$me['id']])) return $cache[$me['id']];
    $uid = (int)$me['id']; $projects = []; $team = []; $clients = [];
    foreach (q("SELECT id, type, data FROM items WHERE company_id = ? AND type IN ('project', 'employee')", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        if ($r['type'] === 'project' && ((int)($d['managerId'] ?? 0) === $uid || in_array($uid, array_map('intval', (array)($d['team'] ?? [])), true))) {
            $projects[] = (int)$r['id'];
            if (!empty($d['clientId'])) $clients[] = (int)$d['clientId'];
        }
        if ($r['type'] === 'employee' && ((int)($d['chefId'] ?? 0) === $uid || (int)($d['userId'] ?? 0) === $uid)) $team[] = (int)$r['id'];
    }
    return $cache[$me['id']] = ['projects' => $projects, 'team' => $team, 'clients' => $clients];
}
function chef_can_read(array $me, array $row): bool {
    $sc = chef_scope($me);
    $d = json_decode((string)$row['data'], true) ?: [];
    $pid = $row['project_id'] !== null ? (int)$row['project_id'] : 0;
    $inProj = $pid && in_array($pid, $sc['projects'], true);
    $mine = (int)$row['created_by'] === (int)$me['id'];
    $emp = (int)($d['employeeId'] ?? 0);
    switch ($row['type']) {
        case 'project': return in_array((int)$row['id'], $sc['projects'], true);
        case 'employee': return in_array((int)$row['id'], $sc['team'], true);
        // heures, planning, absences de son équipe (sur un autre chantier : sans le nom, voir chef_view)
        case 'timesheet': case 'assign': case 'absence': return $inProj || ($emp && in_array($emp, $sc['team'], true)) || $mine;
        case 'contact': return in_array((string)($d['kind'] ?? ''), ['client', 'prospect'], true) ? ($mine || in_array((int)$row['id'], $sc['clients'], true)) : true;
        case 'article': return true;
        case 'expense':
            if ($inProj || $mine) return true;
            foreach ((array)($d['alloc'] ?? []) as $a) if (in_array((int)($a['pid'] ?? 0), $sc['projects'], true)) return true;
            return false;
        case 'task': case 'intervention': return $inProj || $mine || (int)($d['assigneeId'] ?? 0) === (int)$me['id'];
        case 'report': return $inProj || $mine || in_array((int)$me['id'], array_map('intval', (array)($d['to'] ?? [])), true);
        default: return $inProj || $mine;
    }
}
// Ce qu'il reçoit : les heures / le planning de son équipe sur un chantier qui n'est pas à lui, sans le nom du chantier ;
// un achat réparti sur plusieurs chantiers : seulement la part de ses projets
function chef_view(array $me, array $r): array {
    $sc = chef_scope($me);
    $pid = $r['project_id'] !== null ? (int)$r['project_id'] : 0;
    $d = json_decode((string)$r['data'], true) ?: [];
    if (in_array($r['type'], ['timesheet', 'assign'], true) && $pid && !in_array($pid, $sc['projects'], true)) {
        $r['project_id'] = null; $d['site'] = 'Autre chantier'; $d['otherSite'] = true; unset($d['task'], $d['note']);
        $r['data'] = json_encode($d, JSON_UNESCAPED_UNICODE);
    }
    if ($r['type'] === 'expense' && !empty($d['alloc']) && is_array($d['alloc'])) {
        $d['alloc'] = array_values(array_filter($d['alloc'], fn($a) => in_array((int)($a['pid'] ?? 0), $sc['projects'], true)));
        if (!$pid || !in_array($pid, $sc['projects'], true)) { $r['project_id'] = $d['alloc'] ? (int)$d['alloc'][0]['pid'] : null; $d['amount'] = array_sum(array_map(fn($a) => (float)($a['amount'] ?? 0), $d['alloc'])); unset($d['lines'], $d['items']); }
        $r['data'] = json_encode($d, JSON_UNESCAPED_UNICODE);
    }
    return $r;
}
// Peut-il écrire cet élément ? (déjà lisible par lui, et sur un de ses projets ou sans projet)
function chef_can_write(array $me, string $type, ?int $pid, ?array $cur): bool {
    $sc = chef_scope($me);
    if ($cur && !chef_can_read($me, $cur)) return false;
    if ($cur && in_array($type, ['timesheet', 'assign'], true) && $cur['project_id'] !== null && !in_array((int)$cur['project_id'], $sc['projects'], true)) return false;
    if ($type === 'project') return true;
    return !$pid || in_array($pid, $sc['projects'], true);
}
// Fichier lisible par le responsable : envoyé par lui, logo, fichier d'un de ses projets, ou joint à un élément qu'il peut lire
function chef_can_file(array $me, array $f): bool {
    if ((int)$f['created_by'] === (int)$me['id']) return true;
    $co = setting('company', []) ?: [];
    if ((int)($co['logoId'] ?? 0) === (int)$f['id']) return true;
    if ($f['project_id'] !== null && in_array((int)$f['project_id'], chef_scope($me)['projects'], true)) return true;
    $needle = (int)$f['id'];
    foreach (q("SELECT * FROM items WHERE company_id = ? AND data LIKE ?", [cid(), '%' . $needle . '%'])->fetchAll() as $r) {
        if (!chef_can_read($me, $r)) continue;
        $found = false;
        $walk = function ($v, $k = '') use (&$walk, &$found, $needle) {
            if ($found) return;
            if (is_array($v)) { foreach ($v as $kk => $vv) $walk($vv, is_string($kk) ? $kk : $k); return; }
            if ((int)$v === $needle && preg_match('/^(fileId|thumbId|photos|files|attachments|docs|fileIds|logoId|signatureId)$/', (string)$k)) $found = true;
        };
        $walk(json_decode($r['data'], true) ?: []);
        if ($found) return true;
    }
    return false;
}
// Lie un compte terrain à sa fiche (personnel RH ou contact sous-traitant) ; délie les autres fiches
function link_field_user(int $uid, string $role, $link): void {
    $want = $role === 'ouvrier' ? ['employee', (int)(is_array($link) ? ($link['employeeId'] ?? 0) : 0)] : ($role === 'soustraitant' ? ['contact', (int)(is_array($link) ? ($link['contactId'] ?? 0) : 0)] : [null, 0]);
    foreach (q("SELECT id, type, data FROM items WHERE company_id = ? AND type IN ('employee', 'contact')", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $has = (int)($d['userId'] ?? 0) === $uid;
        $should = $want[0] === $r['type'] && (int)$r['id'] === $want[1];
        if ($has === $should) continue;
        if ($should) $d['userId'] = $uid; else unset($d['userId']);
        q('UPDATE items SET data = ?, version = version + 1 WHERE id = ?', [json_encode($d, JSON_UNESCAPED_UNICODE), $r['id']]);
    }
}

// Heures encodées par un compte terrain : rattachées à sa fiche, avec son coût horaire (jamais celui envoyé par le téléphone)
function field_timesheet(array $me, array $data, ?int $pid = null): array {
    $sc = field_scope($me);
    unset($data['employeeId'], $data['contactId'], $data['rate']);
    $site = mb_substr(trim(preg_replace('/\s+/u', ' ', (string)($data['site'] ?? ''))), 0, 120);
    if ($pid || $site === '') unset($data['site']); else $data['site'] = $site;
    foreach (['employee' => 'employeeId', 'contact' => 'contactId'] as $t => $k) {
        if (!$sc[$t]) continue;
        $r = q('SELECT data FROM items WHERE id = ? AND company_id = ?', [$sc[$t], cid()])->fetch();
        $d = $r ? (json_decode($r['data'], true) ?: []) : [];
        $data[$k] = $sc[$t];
        $data['who'] = trim((string)($d['name'] ?? $d['company'] ?? '')) ?: $me['name'];
        if ($t === 'employee') $data['rate'] = (float)($d['costRate'] ?? 0);
    }
    $data['hours'] = max(0, min(24, (float)($data['hours'] ?? 0)));
    return $data;
}

function require_super(): array {
    $u = require_user();
    if (!$u['super']) fail(403, 'Réservé au gestionnaire de la plateforme.');
    return $u;
}

// Mise à jour d'une installation mono-entreprise vers la version multi-firmes (une seule fois)
function migrate(): void {
    if (q("SHOW TABLES LIKE 'companies'")->fetch()) return;
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS companies (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(190) NOT NULL, active TINYINT NOT NULL DEFAULT 1, created_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $co = q("SELECT v FROM settings WHERE k = 'company'")->fetch();
    $name = $co ? ((json_decode($co['v'], true) ?: [])['name'] ?? 'Ma firme') : 'Ma firme';
    q('INSERT INTO companies (id, name, active, created_at) VALUES (1, ?, 1, ?)', [$name ?: 'Ma firme', now()]);
    $pdo->exec('ALTER TABLE users ADD company_id INT NOT NULL DEFAULT 1, ADD super TINYINT NOT NULL DEFAULT 0');
    $first = q("SELECT MIN(id) FROM users WHERE role = 'admin'")->fetchColumn();
    if ($first) q('UPDATE users SET super = 1 WHERE id = ?', [$first]);
    $pdo->exec('ALTER TABLE items ADD company_id INT NOT NULL DEFAULT 1, ADD KEY company_type (company_id, type)');
    $pdo->exec('ALTER TABLE files ADD company_id INT NOT NULL DEFAULT 1');
    $pdo->exec('ALTER TABLE activity ADD company_id INT NOT NULL DEFAULT 1, ADD KEY company (company_id)');
    $pdo->exec('ALTER TABLE settings ADD company_id INT NOT NULL DEFAULT 1, DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, k)');
    $pdo->exec('ALTER TABLE counters ADD company_id INT NOT NULL DEFAULT 1, DROP PRIMARY KEY, ADD PRIMARY KEY (company_id, k)');
}

// réglages réservés au serveur : jamais envoyés au navigateur ni modifiables par l'API (clé privée des notifications…)
const SERVER_SETTINGS = ['vapid', 'remind_done', 'peppol_sync', 'backup', 'sub', 'saas', 'saas_daily', 'legal'];

function client_ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '?', 0, 64); }

function setting(string $k, $default = null, ?int $company = null) {
    $r = q('SELECT v FROM settings WHERE company_id = ? AND k = ?', [$company ?? cid(), $k])->fetch();
    return $r ? json_decode($r['v'], true) : $default;
}

function set_setting(string $k, $v, ?int $company = null): void {
    q('INSERT INTO settings (company_id, k, v) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [$company ?? cid(), $k, json_encode($v, JSON_UNESCAPED_UNICODE)]);
}

// Compteur atomique (à appeler dans une transaction)
function next_counter(string $key): int {
    q('INSERT INTO counters (company_id, k, n) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE n = n', [cid(), $key]);
    $n = (int)q('SELECT n FROM counters WHERE company_id = ? AND k = ? FOR UPDATE', [cid(), $key])->fetchColumn() + 1;
    q('UPDATE counters SET n = ? WHERE company_id = ? AND k = ?', [$n, cid(), $key]);
    return $n;
}

// Identifiant Peppol de la firme : celui des paramètres, sinon (Belgique) 0208 + n° d'entreprise tiré du n° de TVA – comme l'écran
function company_peppol_id(): string {
    $co = setting('company', []) ?: [];
    $id = trim((string)($co['peppolId'] ?? ''));
    if ($id !== '' && str_contains($id, ':')) { [$sc, $v] = explode(':', $id, 2); return preg_replace('/\D/', '', $sc) . ':' . preg_replace('/[\s.\-\/]/', '', $v); }
    if ($id !== '') return $id;
    $c = strtoupper(trim((string)($co['country'] ?? '')));
    $vat = strtoupper(preg_replace('/[\s.\-]/', '', (string)($co['vat'] ?? '')));
    $be = $c === '' || $c === 'BE' || str_starts_with($c, 'BELG') || str_starts_with($vat, 'BE');
    $dg = preg_replace('/\D/', '', (string)($co['enterprise'] ?? '')) ?: preg_replace('/\D/', '', $vat);
    if (strlen($dg) === 9) $dg = '0' . $dg;
    return $be && strlen($dg) === 10 ? '0208:' . $dg : '';
}
function make_number(string $kind): string {
    $prefixes = setting('prefixes', []) ?: [];
    $defaults = NUMBERED + ['invoice' => 'FAC', 'avoir' => 'NC', 'proforma' => 'PF', 'estimate' => 'EST'];
    $prefix = $prefixes[$kind] ?? ($defaults[$kind] ?? strtoupper(substr($kind, 0, 3)));
    $y = date('Y');
    $n = next_counter("$kind-$y");
    $pad = max(1, min(6, (int)setting('numpad', 4)));
    return ($prefix !== '' ? $prefix . '-' : '') . $y . '-' . str_pad((string)$n, $pad, '0', STR_PAD_LEFT);
}

function log_activity(?int $uid, string $action, string $type, ?int $id, ?int $pid, ?string $label): void {
    q('INSERT INTO activity (company_id, user_id, action, type, item_id, project_id, label, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [cid(), $uid, $action, $type, $id, $pid, $label !== null ? mb_substr($label, 0, 250) : null, now()]);
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
    if (empty($cfg['host']) && cid() !== 1 && ($pf = setting('smtp', [], 1)) && !empty($pf['host'])) $cfg = ['fromName' => ''] + $pf; // serveur de la plateforme, au nom de la firme
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

// ---------------------------------------------------------------- TVA : service VIES de la Commission européenne
// Renvoie { valid, vat, cc, name, street, zip, city, country, checked } ; nom / adresse vides si le pays ne les publie pas
// N° de TVA de test acceptés sans contrôle (comptes de démonstration) ; config.php peut définir TEST_VATS
function test_vats(): array {
    $list = defined('TEST_VATS') ? (array)TEST_VATS : ['BE123456789'];
    return array_map(fn($x) => preg_replace('/^BE(\d{9})$/', 'BE0$1', strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$x))), $list);
}

function vat_lookup(string $raw, string $defCc = 'BE'): array {
    $v = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $raw));
    $cc = preg_match('/^([A-Z]{2})(.+)$/', $v, $m) ? $m[1] : strtoupper($defCc);
    $num = preg_match('/^[A-Z]{2}(.+)$/', $v, $m) ? $m[1] : $v;
    if ($cc === 'GR') $cc = 'EL';
    if ($cc === 'BE' && preg_match('/^\d{9}$/', $num)) $num = '0' . $num; // ancien format à 9 chiffres
    if (in_array($cc . $num, test_vats(), true)) {
        return ['valid' => true, 'test' => true, 'vat' => $cc . $num, 'cc' => $cc, 'country' => $cc === 'BE' ? 'Belgique' : $cc, 'name' => '', 'street' => '', 'zip' => '', 'city' => '', 'checked' => date('Y-m-d H:i')];
    }
    if ($cc === 'BE' && !preg_match('/^[01]\d{9}$/', $num)) fail(400, 'Numéro de TVA belge invalide : 10 chiffres (ex. BE0693697280)');
    if (!preg_match('/^[A-Z]{2}$/', $cc) || !preg_match('/^[A-Z0-9]{4,14}$/', $num)) fail(400, 'Numéro de TVA invalide');
    if ($cc === 'BE' && (97 - ((int)substr($num, 0, 8) % 97)) !== (int)substr($num, 8, 2)) {
        return ['valid' => false, 'vat' => $cc . $num, 'cc' => $cc, 'error' => 'Numéro incorrect (chiffres de contrôle) : vérifiez la saisie.'];
    }
    $out = ['vat' => $cc . $num, 'cc' => $cc, 'checked' => date('Y-m-d H:i')];
    $countries = ['BE' => 'Belgique', 'FR' => 'France', 'LU' => 'Luxembourg', 'NL' => 'Pays-Bas', 'DE' => 'Allemagne', 'RO' => 'Roumanie', 'IT' => 'Italie', 'ES' => 'Espagne', 'PT' => 'Portugal', 'PL' => 'Pologne'];
    $out['country'] = $countries[$cc] ?? $cc;
    $viesErr = null; $v = null;
    try { $v = vies_query($cc, $num); } catch (Throwable $e) { $viesErr = $e->getMessage(); }
    // Belgique : registre public des entreprises (BCE / KBO Public Search) pour le statut, la forme légale, le téléphone…
    $k = null;
    if ($cc === 'BE') { try { $k = kbo_lookup($num); } catch (Throwable $e) { $k = null; } }
    if (!$v && !$k) fail(502, $viesErr ?: 'Services VIES et BCE injoignables, réessayez plus tard');
    if ($v) $out += ['valid' => $v['valid'], 'name' => $v['name'], 'street' => $v['street'], 'zip' => $v['zip'], 'city' => $v['city']];
    if ($k) {
        $out['kbo'] = $k;
        foreach (['street', 'zip', 'city'] as $f) if (empty($out[$f]) && !empty($k[$f])) $out[$f] = $k[$f];
        if (empty($out['name'])) $out['name'] = trim(($k['abbr'] ? $k['abbr'] . ' ' : '') . $k['name']);
        foreach (['phone', 'email', 'website', 'legalForm', 'status', 'start'] as $f) $out[$f] = $k[$f] ?? '';
        if (!$v) $out['valid'] = $k['active'];
        $out['active'] = $k['active'];
    }
    if ($viesErr && $k) $out['note'] = 'VIES indisponible : données de la BCE';
    return $out;
}

// Service VIES (Commission européenne) : n° de TVA actif + nom / adresse
function vies_query(string $cc, string $num): array {
    $base = defined('VIES_URL') ? VIES_URL : 'https://ec.europa.eu/taxation_customs/vies/rest-api';
    $url = rtrim($base, '/') . '/ms/' . $cc . '/vat/' . rawurlencode($num);
    $raw = false; $code = 0;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: BatiPro']]);
        $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
    } else {
        $raw = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => 15, 'header' => "Accept: application/json\r\n"]]));
        $code = $raw === false ? 0 : 200;
    }
    if ($raw === false || $raw === '' || $code >= 500) throw new RuntimeException('Service VIES (Commission européenne) injoignable, réessayez plus tard');
    $j = json_decode((string)$raw, true);
    if (!is_array($j)) throw new RuntimeException('Réponse VIES illisible');
    $err = (string)($j['userError'] ?? '');
    if ($err !== '' && !in_array($err, ['VALID', 'INVALID'], true)) throw new RuntimeException('VIES indisponible pour ce pays (' . $err . '), réessayez plus tard');
    $valid = (bool)($j['isValid'] ?? $j['valid'] ?? false);
    $clean = fn($x) => trim(preg_replace('/\s+/', ' ', (string)$x)) === '---' ? '' : trim((string)$x);
    $name = $clean($j['name'] ?? '');
    $addr = preg_split('/\r?\n/', $clean($j['address'] ?? ''));
    $addr = array_values(array_filter(array_map('trim', $addr), 'strlen'));
    $street = $addr[0] ?? ''; $zip = ''; $city = '';
    $last = count($addr) > 1 ? $addr[count($addr) - 1] : '';
    if (preg_match('/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/u', $last, $m)) { $zip = $m[1]; $city = $m[2]; }
    elseif (count($addr) === 1 && preg_match('/^(.*?),?\s+(\d{4,5})\s+(.+)$/u', $street, $m)) { $street = $m[1]; $zip = $m[2]; $city = $m[3]; }
    elseif ($last !== '') $city = $last;
    $countries = ['BE' => 'Belgique', 'FR' => 'France', 'LU' => 'Luxembourg', 'NL' => 'Pays-Bas', 'DE' => 'Allemagne', 'RO' => 'Roumanie', 'IT' => 'Italie', 'ES' => 'Espagne', 'PT' => 'Portugal', 'PL' => 'Pologne'];
    return ['valid' => $valid, 'name' => $name, 'street' => $street, 'zip' => $zip, 'city' => $city];
}

// BCE / KBO Public Search : page publique d'une entreprise belge (statut, dénomination, siège, forme légale, contacts)
function kbo_lookup(string $num): ?array {
    $base = defined('KBO_URL') ? KBO_URL : 'https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html';
    $html = http_get($base . '?lang=fr&ondernemingsnummer=' . $num, 15, 'text/html');
    if ($html === null || stripos($html, $num) === false && stripos($html, substr($num, 0, 4) . '.' . substr($num, 4, 3)) === false) return null;
    $rows = [];
    foreach (preg_split('/<tr[^>]*>/i', $html) as $tr) {
        if (!preg_match_all('/<td[^>]*>(.*?)<\/td>/is', $tr, $m) || count($m[1]) < 2) continue;
        $label = trim(str_replace("\u{00A0}", ' ', html_entity_decode(strip_tags($m[1][0]), ENT_QUOTES | ENT_HTML5, 'UTF-8')), " \t\n\r\0\x0B:");
        $raw = preg_replace('/<span[^>]*class="upd"[^>]*>.*?<\/span>/is', '', $m[1][1]);
        $raw = preg_replace('/<br\s*\/?>/i', "\n", $raw);
        $val = html_entity_decode(strip_tags($raw), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $val = str_replace("\u{00A0}", ' ', $val);
        $lines = array_values(array_filter(array_map(fn($l) => trim(preg_replace('/\s+/u', ' ', $l)), explode("\n", $val)),
            fn($l) => $l !== '' && !preg_match('/^(Depuis le|Sinds|Dénomination en|Benaming in|Pas de données|Geen gegevens)/iu', $l)));
        if ($label !== '' && !isset($rows[$label])) $rows[$label] = $lines;
    }
    $get = function (array $labels) use ($rows) { foreach ($rows as $k => $v) foreach ($labels as $l) if (stripos($k, $l) === 0) return $v; return []; };
    $name = $get(['Dénomination', 'Naam', 'Benaming'])[0] ?? '';
    if ($name === '') return null;
    $addr = $get(['Adresse du siège', 'Adres van de zetel', 'Adresse de l\'unité']);
    $street = $addr[0] ?? ''; $zip = ''; $city = '';
    if (isset($addr[1]) && preg_match('/^(\d{4})\s+(.+)$/u', $addr[1], $mm)) { $zip = $mm[1]; $city = $mm[2]; }
    $status = $get(['Statut', 'Status'])[0] ?? '';
    $abbr = $get(['Abréviation', 'Afkorting'])[0] ?? '';
    $legal = $get(['Forme légale', 'Forme juridique', 'Rechtsvorm'])[0] ?? '';
    $short = ['société à responsabilité limitée' => 'SRL', 'société anonyme' => 'SA', 'société coopérative' => 'SC', 'société en commandite' => 'SComm', 'société en nom collectif' => 'SNC',
        'association sans but lucratif' => 'ASBL', 'société privée à responsabilité limitée' => 'SPRL', 'personne physique' => ''];
    $form = '';
    foreach ($short as $k => $v) if (stripos($legal, $k) === 0) { $form = $v; break; }
    return ['name' => $name, 'abbr' => $form, 'legalForm' => $legal, 'status' => $status, 'active' => (bool)preg_match('/^(actif|actief)/iu', $status),
        'street' => $street, 'zip' => $zip, 'city' => $city, 'start' => $get(['Date de début', 'Begindatum'])[0] ?? '',
        'phone' => $get(['Numéro de téléphone', 'Telefoonnummer'])[0] ?? '', 'email' => $get(['Adresse e-mail', 'E-mail'])[0] ?? '',
        'website' => $get(['Adresse web', 'Webadres'])[0] ?? ''];
}

// Requête GET simple (curl ou flux PHP) ; null si injoignable
function http_get(string $url, int $timeout = 15, string $accept = 'application/json'): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout, CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HTTPHEADER => ['Accept: ' . $accept, 'Accept-Language: fr-BE,fr;q=0.9', 'User-Agent: Mozilla/5.0 (BatiPro)']]);
        $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        return ($r === false || $code >= 400) ? null : (string)$r;
    }
    $r = @file_get_contents($url, false, stream_context_create(['http' => ['timeout' => $timeout, 'header' => "Accept: $accept\r\nUser-Agent: Mozilla/5.0 (BatiPro)\r\n"]]));
    return $r === false ? null : $r;
}

// ---------------------------------------------------------------- Éditions : « BâtiPro Avancé » (complet) ou « BâtiPro Simplifié » (indépendants)
// Choisie par firme dans Plateforme ; valeur par défaut des nouvelles firmes : 'edition' => 'simple' dans config.php
function edition_default(): string { $e = config()['edition'] ?? 'avance'; return $e === 'simple' ? 'simple' : 'avance'; }
function edition(?int $company = null): string { $e = setting('edition', null, $company); return in_array($e, ['simple', 'avance'], true) ? $e : edition_default(); }


// ---------------------------------------------------------------- Notifications : dans l'application, push sur le téléphone, e-mail
// Le push est envoyé SANS contenu (rien ne transite par Google / Apple) : le téléphone réveille l'application,
// qui lit ses notifications sur votre serveur et les affiche.
function notif_tables(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    // une seule fois (pas un CREATE TABLE à chaque requête)
    $flag = __DIR__ . '/uploads/.db-notif';
    if (is_file($flag)) return;
    register_shutdown_function(fn() => @file_put_contents($flag, '1'));
    db()->exec("CREATE TABLE IF NOT EXISTS notifs (id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, user_id INT NOT NULL, kind VARCHAR(30) NOT NULL, title VARCHAR(190) NOT NULL, body VARCHAR(500) NOT NULL DEFAULT '', href VARCHAR(190) NOT NULL DEFAULT '', created_at DATETIME NOT NULL, read_at DATETIME NULL, KEY u (user_id, read_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db()->exec('CREATE TABLE IF NOT EXISTS push_subs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, endpoint VARCHAR(700) NOT NULL, created_at DATETIME NOT NULL, KEY u (user_id), UNIQUE KEY ep (endpoint(250))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}
function notif_cfg(): array {
    return (setting('notif', []) ?: []) + ['hour' => '17:30', 'remind' => true, 'summary' => true, 'events' => true, 'emailRemind' => true, 'emailSummary' => true, 'emailEvents' => false];
}
function b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
// Clés VAPID (une paire pour toute l'installation), créées au premier besoin
function vapid_keys(): array {
    $k = setting('vapid', null, 1);
    if (!$k || empty($k['pem'])) {
        $res = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if (!$res) throw new RuntimeException('OpenSSL ne peut pas créer les clés de notification.');
        openssl_pkey_export($res, $pem);
        $det = openssl_pkey_get_details($res);
        $pub = "\x04" . str_pad($det['ec']['x'], 32, "\0", STR_PAD_LEFT) . str_pad($det['ec']['y'], 32, "\0", STR_PAD_LEFT);
        $k = ['pem' => $pem, 'pub' => b64url($pub)];
        set_setting('vapid', $k, 1);
    }
    return $k;
}
// Jeton VAPID (JWT ES256) pour le service de push du navigateur
function vapid_jwt(string $endpoint, array $k): string {
    $p = parse_url($endpoint);
    $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    $co = setting('company', [], 1) ?: [];
    $mail = filter_var($co['email'] ?? '', FILTER_VALIDATE_EMAIL) ? $co['email'] : 'admin@' . preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $h = b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $c = b64url(json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => 'mailto:' . $mail]));
    openssl_sign("$h.$c", $der, $k['pem'], OPENSSL_ALGO_SHA256);
    // signature DER (SEQUENCE { INTEGER r, INTEGER s }) → r || s sur 64 octets
    $i = 2 + ((ord($der[1]) & 0x80) ? (ord($der[1]) & 0x7f) : 0);
    $rl = ord($der[$i + 1]); $r = substr($der, $i + 2, $rl); $i += 2 + $rl;
    $sl = ord($der[$i + 1]); $s = substr($der, $i + 2, $sl);
    $fix = fn($x) => str_pad(substr(ltrim($x, "\0"), -32), 32, "\0", STR_PAD_LEFT);
    return "$h.$c." . b64url($fix($r) . $fix($s));
}
// Services de push des navigateurs acceptés (jamais d'adresse interne)
function push_endpoint_ok(string $url): bool {
    $p = parse_url($url);
    if (($p['scheme'] ?? '') !== 'https' || empty($p['host'])) return defined('PUSH_TEST_HOST') && ($p['host'] ?? '') === PUSH_TEST_HOST;
    return (bool)preg_match('/(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i', $p['host'])
        || (defined('PUSH_TEST_HOST') && $p['host'] === PUSH_TEST_HOST);
}
function push_send(string $endpoint): int {
    if (!function_exists('curl_init') || !push_endpoint_ok($endpoint)) return 0;
    $k = vapid_keys();
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => '', CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 6,
        CURLOPT_HTTPHEADER => ['TTL: 86400', 'Urgency: high', 'Content-Length: 0', 'Authorization: vapid t=' . vapid_jwt($endpoint, $k) . ', k=' . $k['pub']]]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
}
// Les push partent après la réponse (l'utilisateur n'attend pas les serveurs de Google / Apple)
function push_flush(): void {
    $q = $GLOBALS['BP_PUSHQ'] ?? [];
    $GLOBALS['BP_PUSHQ'] = [];
    if (!$q) return;
    if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
    foreach (q('SELECT id, endpoint FROM push_subs WHERE user_id IN (' . implode(',', array_map('intval', array_unique($q))) . ')')->fetchAll() as $s) {
        try { $code = push_send($s['endpoint']); } catch (Throwable $e) { $code = 0; }
        if ($code === 404 || $code === 410) q('DELETE FROM push_subs WHERE id = ?', [$s['id']]);
    }
}
function notify(array $uids, string $kind, string $title, string $body = '', string $href = '', bool $email = false): void {
    notif_tables();
    $uids = array_values(array_unique(array_filter(array_map('intval', $uids))));
    if (!$uids) return;
    foreach ($uids as $u) q('INSERT INTO notifs (company_id, user_id, kind, title, body, href, created_at) VALUES (?,?,?,?,?,?,?)', [cid(), $u, $kind, mb_substr($title, 0, 190), mb_substr($body, 0, 500), mb_substr($href, 0, 190), now()]);
    if (!isset($GLOBALS['BP_PUSHQ'])) { $GLOBALS['BP_PUSHQ'] = []; register_shutdown_function('push_flush'); }
    array_push($GLOBALS['BP_PUSHQ'], ...$uids);
    if (!$email) return;
    $base = (!empty($_SERVER['HTTP_HOST']) ? ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://') . $_SERVER['HTTP_HOST'] . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/' : '');
    foreach (q('SELECT name, email FROM users WHERE id IN (' . implode(',', $uids) . ') AND active = 1')->fetchAll() as $u) {
        try { send_mail([['email' => $u['email'], 'name' => $u['name']]], [], $title, "Bonjour {$u['name']},\n\n" . ($body ? "$body\n\n" : '') . ($base && $href ? "Ouvrir : $base$href\n" : ''), []); }
        catch (Throwable $e) { error_log('[batipro notif mail] ' . $e->getMessage()); }
    }
}
// Bureau à prévenir : administrateurs actifs (+ conducteur du chantier)
function office_ids(?int $pid = null): array {
    $ids = array_map('intval', q("SELECT id FROM users WHERE company_id = ? AND active = 1 AND role = 'admin'", [cid()])->fetchAll(PDO::FETCH_COLUMN));
    if ($pid) {
        $p = q("SELECT data FROM items WHERE id = ? AND type = 'project' AND company_id = ?", [$pid, cid()])->fetch();
        $m = (int)(($p ? json_decode($p['data'], true) : [])['managerId'] ?? 0);
        if ($m) $ids[] = $m;
    }
    return array_values(array_unique($ids));
}
function item_label(string $type, int $id): string {
    $r = q('SELECT data FROM items WHERE id = ? AND type = ? AND company_id = ?', [$id, $type, cid()])->fetch();
    $d = $r ? (json_decode($r['data'], true) ?: []) : [];
    return (string)($d['name'] ?? $d['title'] ?? $d['company'] ?? '');
}
// Ce qu'on signale quand quelqu'un ajoute quelque chose
function notify_item(array $me, string $type, array $row, ?array $before = null): void {
    $cfg = notif_cfg();
    $d = json_decode((string)$row['data'], true) ?: [];
    $pid = $row['project_id'] !== null ? (int)$row['project_id'] : null;
    $site = $pid ? item_label('project', $pid) : '';
    // le terrain lève, commente ou photographie un point qui lui est attribué
    if (is_field($me) && $before && $type === 'point') {
        if (!$cfg['events']) return;
        $was = json_decode((string)$before['data'], true) ?: [];
        $no = 'n° ' . ($row['number'] ?? '') . ' – ' . ($d['title'] ?? '');
        if (($d['status'] ?? '') !== ($was['status'] ?? '')) $title = (($d['status'] ?? '') === 'done' ? "{$me['name']} a levé le point " : "{$me['name']} a mis à jour le point ") . $no;
        elseif (count((array)($d['photos'] ?? [])) > count((array)($was['photos'] ?? []))) $title = "{$me['name']} a ajouté une photo au point $no";
        elseif (count((array)($d['history'] ?? [])) > count((array)($was['history'] ?? []))) $title = "{$me['name']} a commenté le point $no";
        else return;
        $last = (array)($d['history'] ?? []); $last = $last ? end($last) : [];
        notify(office_ids($pid), 'point', $title, trim($site . (($last['kind'] ?? '') === 'comment' ? ' – ' . mb_substr((string)$last['text'], 0, 160) : '')), $pid ? "#/project/$pid/points" : '#/dashboard', (bool)$cfg['emailEvents']);
        return;
    }
    if (is_field($me) && !$before && $cfg['events']) {
        if ($type === 'timesheet') {
            $where = $site !== '' ? $site : ((string)($d['site'] ?? '') !== '' ? 'Chantier pas encore créé : ' . $d['site'] : '');
            notify(array_merge(office_ids($pid), chef_of_employee((int)($d['employeeId'] ?? 0))), 'hours', "{$me['name']} a encodé " . rtrim(rtrim(number_format((float)($d['hours'] ?? 0), 2, ',', ''), '0'), ',') . ' h', trim($where . ((string)($d['task'] ?? '') !== '' ? ' – ' . $d['task'] : '')), $pid ? "#/project/$pid/hours" : '#/hr/timesheets', (bool)$cfg['emailEvents']);
        }
        if ($type === 'report') {
            $n = count((array)($d['photos'] ?? []));
            $title = ($d['kind'] ?? '') === 'photos' ? "{$me['name']} a envoyé $n photo" . ($n > 1 ? 's' : '') : "Nouveau rapport de {$me['name']}";
            notify(office_ids($pid), 'report', $title, trim($site . (($d['text'] ?? '') !== '' ? ' – ' . mb_substr((string)$d['text'], 0, 160) : '')), '#/report/' . (int)$row['id'], (bool)$cfg['emailEvents']);
        }
        return;
    }
    if (is_field($me)) return;
    if ($type === 'billreq' && !$before) {
        notify(office_ids(), 'billreq', "{$me['name']} demande une facture" . ($site !== '' ? " : $site" : ''), trim(rtrim(rtrim(number_format((float)($d['amount'] ?? 0), 2, ',', '.'), '0'), ',') . ' € HT' . ((string)($d['note'] ?? '') !== '' ? ' – ' . mb_substr((string)$d['note'], 0, 160) : '')), '#/resp/demandes', true);
    }
    if ($type === 'billreq' && $before) {
        $was = json_decode((string)$before['data'], true) ?: [];
        if (($d['status'] ?? '') === 'facturee' && ($was['status'] ?? '') !== 'facturee' && (int)$row['created_by'] !== $me['id']) notify([(int)$row['created_by']], 'billreq', 'Facture faite ✓' . ($site !== '' ? " : $site" : ''), (string)($d['invoiceNumber'] ?? ''), '#/resp/demandes');
    }
    // estimatif du responsable : envoyé au bureau, renvoyé avec une remarque, transformé en devis
    if ($type === 'quote' && $before) {
        $was = json_decode((string)$before['data'], true) ?: [];
        $t = (string)($d['title'] ?? '') !== '' ? (string)$d['title'] : (string)$row['number'];
        if (!empty($d['estimate']) && ($d['estStatus'] ?? '') === 'soumis' && ($was['estStatus'] ?? '') !== 'soumis') notify(office_ids(), 'quote', "{$me['name']} envoie un estimatif à vérifier : $t", trim($site . ' – ' . number_format((float)($d['estTotal'] ?? 0), 2, ',', '.') . ' € HT', ' –'), '#/quote/' . (int)$row['id'], true);
        if (!empty($d['estimate']) && ($d['estStatus'] ?? '') === 'a_revoir' && ($was['estStatus'] ?? '') !== 'a_revoir') notify([(int)$row['created_by']], 'quote', "Estimatif à revoir : $t", mb_substr((string)($d['estNote'] ?? ''), 0, 160), '#/quote/' . (int)$row['id']);
        if (empty($d['estimate']) && !empty($was['estimate']) && (int)$row['created_by'] !== $me['id']) notify([(int)$row['created_by']], 'quote', "Votre estimatif est devenu le devis {$row['number']}", $t, '#/quote/' . (int)$row['id']);
    }
    if ($type === 'mgrreport' && !$before) notify(office_ids(), 'report', "Rapport de {$me['name']} : " . ($d['title'] ?? ''), mb_substr((string)($d['comment'] ?? ''), 0, 160), '#/resp/rapport/' . (int)$row['id'], true);
    // bureau → terrain
    if ($type === 'report' && !$before && !empty($d['to'])) notify((array)$d['to'], 'report', 'Nouveau rapport du bureau : ' . ($d['title'] ?? ''), mb_substr((string)($d['text'] ?? ''), 0, 160), '#/t/rapport/' . (int)$row['id'], (bool)$cfg['emailEvents']);
    if ($type === 'order' && ($d['status'] ?? 'brouillon') !== 'brouillon') {
        $was = $before ? (json_decode((string)$before['data'], true) ?: []) : [];
        $u = field_user_of('contact', (int)($d['supplierId'] ?? 0));
        if ($u && (($was['status'] ?? 'brouillon') === 'brouillon')) notify([$u], 'order', 'Nouveau bon de commande ' . ($row['number'] ?? ''), $site, '#/print/order/' . (int)$row['id'], (bool)$cfg['emailEvents']);
        elseif ($u && ($d['status'] ?? '') === 'facturee' && ($was['status'] ?? '') !== 'facturee') notify([$u], 'order', 'Bon de commande ' . ($row['number'] ?? '') . ' : facturé ✓', $site, '#/t/commandes');
    }
    // point sur plan attribué à un sous-traitant (son entreprise) ou à un ouvrier
    if ($type === 'point') {
        $was = $before ? (json_decode((string)$before['data'], true) ?: []) : [];
        $to = [];
        $u = field_user_of('contact', (int)($d['companyId'] ?? 0));
        if ($u && (int)($was['companyId'] ?? 0) !== (int)($d['companyId'] ?? 0)) $to[] = $u;
        $a = (int)($d['assigneeId'] ?? 0);
        if ($a && $a !== (int)($was['assigneeId'] ?? 0) && in_array((string)q('SELECT role FROM users WHERE id = ? AND company_id = ?', [$a, cid()])->fetchColumn(), FIELD_ROLES, true)) $to[] = $a;
        if ($to && $pid) notify(array_values(array_unique($to)), 'point', 'Point à traiter : n° ' . ($row['number'] ?? '') . ' – ' . ($d['title'] ?? ''), $site, '#/t/point/' . (int)$row['id'], (bool)$cfg['emailEvents']);
    }
    if ($type === 'assign' && !$before) {
        $u = field_user_of('employee', (int)($d['employeeId'] ?? 0));
        if ($u && ($d['date'] ?? '') >= date('Y-m-d')) notify([$u], 'plan', 'Planning : ' . ($site ?: 'chantier') . ' le ' . date('d/m', strtotime((string)$d['date'])), (string)($d['note'] ?? ''), '#/t/planning');
    }
}
function field_user_of(string $type, int $id): int {
    if (!$id) return 0;
    $r = q('SELECT data FROM items WHERE id = ? AND type = ? AND company_id = ?', [$id, $type, cid()])->fetch();
    return $r ? (int)((json_decode($r['data'], true) ?: [])['userId'] ?? 0) : 0;
}
// Fin de journée (heure belge) : rappel à ceux qui n'ont pas encodé leurs heures, résumé au bureau. Une fois par jour.
function daily_reminders(bool $force = false): array {
    $cfg = notif_cfg();
    $now = new DateTime('now', new DateTimeZone('Europe/Brussels'));
    $day = $now->format('Y-m-d');
    if (!$force) {
        if ((int)$now->format('N') >= 6 || $now->format('H:i') < (string)$cfg['hour'] || (!$cfg['remind'] && !$cfg['summary'])) return [];
        if (setting('remind_done') === $day) return [];
    }
    set_setting('remind_done', $day);
    $items = q("SELECT type, project_id, data FROM items WHERE company_id = ? AND type IN ('timesheet', 'absence', 'phase', 'assign')", [cid()])->fetchAll();
    $missing = []; $byChef = [];
    foreach (q("SELECT id, name, email, role, 0 AS super FROM users WHERE company_id = ? AND active = 1 AND role IN ('ouvrier', 'soustraitant')", [cid()])->fetchAll() as $u) {
        $u['id'] = (int)$u['id']; $u['super'] = 0;
        $sc = field_scope($u);
        $expected = false; $hours = 0.0; $absent = false;
        foreach ($items as $r) {
            $d = json_decode($r['data'], true) ?: [];
            if ($r['type'] === 'timesheet' && ($d['date'] ?? '') === $day && (($sc['employee'] && (int)($d['employeeId'] ?? 0) === $sc['employee']) || ($sc['contact'] && (int)($d['contactId'] ?? 0) === $sc['contact']))) $hours += (float)($d['hours'] ?? 0);
            if ($r['type'] === 'absence' && $sc['employee'] && (int)($d['employeeId'] ?? 0) === $sc['employee'] && ($d['from'] ?? '') <= $day && ($d['to'] ?? '') >= $day) $absent = true;
            if ($r['type'] === 'assign' && $sc['employee'] && (int)($d['employeeId'] ?? 0) === $sc['employee'] && ($d['date'] ?? '') === $day) $expected = true;
            if ($r['type'] === 'phase' && ($d['start'] ?? '9') <= $day && ($d['end'] ?? '0') >= $day && (($sc['contact'] && (int)($d['companyId'] ?? 0) === $sc['contact']) || ($sc['employee'] && in_array($sc['employee'], array_map('intval', (array)($d['staff'] ?? [])), true)))) $expected = true;
        }
        if ($u['role'] === 'ouvrier' && $sc['employee']) $expected = true; // un ouvrier pointe chaque jour ouvrable
        if (!$expected || $absent || $hours > 0) continue;
        $missing[] = $u['name'];
        foreach (chef_of_employee((int)$sc['employee']) as $c) $byChef[$c][] = $u['name'];
        if ($cfg['remind']) notify([$u['id']], 'remind', "N'oubliez pas vos heures d'aujourd'hui", 'Touchez ici pour les encoder (30 secondes).', '#/t/heures', (bool)$cfg['emailRemind']);
    }
    if ($missing && $cfg['summary']) notify(office_ids(), 'summary', count($missing) > 1 ? count($missing) . " personnes n'ont pas encodé leurs heures aujourd'hui" : "1 personne n'a pas encodé ses heures aujourd'hui", implode(', ', $missing), '#/hr/timesheets', (bool)$cfg['emailSummary']);
    if ($cfg['summary']) foreach ($byChef as $c => $names) notify([$c], 'summary', count($names) > 1 ? count($names) . " personnes de votre équipe n'ont pas encodé leurs heures" : "1 personne de votre équipe n'a pas encodé ses heures", implode(', ', $names), '#/resp');
    return $missing;
}

// ---------------------------------------------------------------- Sauvegardes
// Dossier des sauvegardes : à côté de l'application (hors du site public) si possible, sinon web/backups (fermé par .htaccess)
function backup_dir(): string {
    $d = (string)(config()['backup_dir'] ?? '');
    if ($d === '') {
        $out = dirname(__DIR__) . '/batipro-sauvegardes';
        $d = ((is_dir($out) || @mkdir($out, 0700, true)) && is_writable($out)) ? $out : __DIR__ . '/backups';
    }
    if (!is_dir($d)) @mkdir($d, 0700, true);
    if (!is_file("$d/.htaccess")) @file_put_contents("$d/.htaccess", "Require all denied\nDeny from all\n");
    if (!is_file("$d/index.html")) @file_put_contents("$d/index.html", '');
    return $d;
}
// Copie complète de la base de données (toutes les firmes) en SQL compressé, restaurable dans phpMyAdmin
function backup_db(string $file): void {
    @set_time_limit(0); ignore_user_abort(true);
    $gz = gzopen($file, 'wb4');
    if (!$gz) throw new RuntimeException('Impossible d\'écrire la sauvegarde.');
    gzwrite($gz, "-- Sauvegarde BatiPro du " . date('Y-m-d H:i:s') . "\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n");
    foreach (db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) {
        $create = db()->query("SHOW CREATE TABLE `$t`")->fetch(PDO::FETCH_NUM)[1];
        gzwrite($gz, "\nDROP TABLE IF EXISTS `$t`;\n$create;\n");
        // lecture ligne par ligne (sans tout charger en mémoire : une grosse base dépasserait la limite de PHP et la sauvegarde serait vide)
        $pdo = db(); $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, false);
        $st = $pdo->query("SELECT * FROM `$t`", PDO::FETCH_NUM);
        $rows = [];
        $flush = function () use (&$rows, $gz, $t) { if ($rows) gzwrite($gz, "INSERT INTO `$t` VALUES\n" . implode(",\n", $rows) . ";\n"); $rows = []; };
        while ($r = $st->fetch(PDO::FETCH_NUM)) {
            $rows[] = '(' . implode(',', array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote((string)$v), $r)) . ')';
            if (count($rows) >= 200) $flush();
        }
        $st->closeCursor(); $pdo->setAttribute(PDO::MYSQL_ATTR_USE_BUFFERED_QUERY, true);
        $flush();
    }
    gzwrite($gz, "\nSET FOREIGN_KEY_CHECKS = 1;\n");
    gzclose($gz);
}
// Sauvegarde du jour (une fois par 24 h) : garde 14 jours + le 1er de chaque mois pendant un an ;
// une fois par semaine, la copie part par e-mail aux gestionnaires de la plateforme (copie hors de l'hébergement)
function backup_auto(bool $force = false): ?string {
    $st = setting('backup', [], 1) ?: [];
    if (!$force && !empty($st['at']) && time() - strtotime((string)$st['at']) < 20 * 3600) return null;
    set_setting('backup', ['at' => date('Y-m-d H:i:s')] + $st, 1); // verrou : une seule sauvegarde à la fois
    $dir = backup_dir();
    $file = "$dir/batipro-" . date('Y-m-d-His') . '.sql.gz';
    backup_db($file);
    $all = glob("$dir/batipro-*.sql.gz") ?: []; rsort($all);
    $keepMonths = [];
    foreach ($all as $i => $f) {
        $m = substr(basename($f), 8, 7);
        if ($i < 14) continue;
        if (!isset($keepMonths[$m]) && count($keepMonths) < 12) { $keepMonths[$m] = 1; continue; }
        @unlink($f);
    }
    $st = ['at' => date('Y-m-d H:i:s'), 'file' => basename($file), 'size' => filesize($file)] + $st;
    if (empty($st['mailed']) || time() - strtotime((string)$st['mailed']) > 6.5 * 86400) {
        $to = q('SELECT name, email FROM users WHERE super = 1 AND active = 1')->fetchAll();
        if ($to && filesize($file) < 15 * 1024 * 1024) {
            $prevCid = $GLOBALS['BP_CID'] ?? null;
            try {
                $GLOBALS['BP_CID'] = 1;
                send_mail(array_map(fn($u) => ['email' => $u['email'], 'name' => $u['name']], $to), [], 'Sauvegarde BâtiPro du ' . date('d/m/Y'),
                    "Bonjour,\n\nVoici la sauvegarde hebdomadaire de la base de données BâtiPro (toutes les firmes).\nGardez cet e-mail : en cas de problème chez l'hébergeur, ce fichier permet de tout restaurer (phpMyAdmin → Importer).\n\nLes fichiers envoyés (photos, PDF, plans) se téléchargent depuis Plateforme → Sauvegardes → « Tout télécharger ».\n",
                    [['name' => basename($file), 'mime' => 'application/gzip', 'data' => file_get_contents($file)]]);
                $st['mailed'] = date('Y-m-d H:i:s');
                unset($st['mailError']);
            } catch (Throwable $e) { $st['mailError'] = $e->getMessage(); error_log('[batipro sauvegarde] ' . $e->getMessage()); }
            finally { $GLOBALS['BP_CID'] = $prevCid; }
        }
    }
    set_setting('backup', $st, 1);
    return $file;
}
