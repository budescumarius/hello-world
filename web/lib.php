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
        $u = q('SELECT u.id, u.name, u.email, u.role, u.active, u.color, u.company_id, u.super, c.active AS company_active FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = ?', [$_SESSION['uid']])->fetch() ?: null;
        if ($u && (!$u['active'] || (!$u['super'] && !(int)$u['company_active']))) $u = null;
        if ($u) {
            foreach (['id', 'active', 'company_id', 'super'] as $k) $u[$k] = (int)$u[$k];
            unset($u['company_active']);
            // le super-administrateur peut travailler dans une autre firme
            $GLOBALS['BP_CID'] = $u['super'] && !empty($_SESSION['cid']) ? (int)$_SESSION['cid'] : $u['company_id'];
        }
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
const USER_ROLES = ['admin', 'user', 'ouvrier', 'soustraitant'];
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
        default: return false;
    }
}
// Ce que la fiche d'un élément terrain peut contenir quand c'est le compte terrain qui l'écrit
function field_can_write(array $me, string $type, ?int $pid, array $data, ?array $cur): bool {
    $sc = field_scope($me);
    if ($cur && (int)$cur['created_by'] !== $me['id']) return false;
    if ($pid && !in_array($pid, $sc['projects'], true)) return false;
    if ($type === 'timesheet') return $pid && (!$sc['employee'] || (int)($data['employeeId'] ?? 0) === $sc['employee']);
    if ($type === 'report') return true;
    return false;
}

// Fichier lisible par un compte terrain : envoyé par lui, logo de la firme, ou joint à un rapport qu'il peut lire
function field_can_file(array $me, array $f): bool {
    if ((int)$f['created_by'] === $me['id']) return true;
    $co = setting('company', []) ?: [];
    if ((int)($co['logoId'] ?? 0) === (int)$f['id']) return true;
    foreach (q("SELECT * FROM items WHERE company_id = ? AND type = 'report'", [cid()])->fetchAll() as $r) {
        if (!field_can_read($me, $r)) continue;
        $d = json_decode($r['data'], true) ?: [];
        $ids = array_map(fn($x) => (int)(is_array($x) ? ($x['id'] ?? 0) : $x), array_merge((array)($d['photos'] ?? []), (array)($d['files'] ?? [])));
        if (in_array((int)$f['id'], $ids, true)) return true;
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

function make_number(string $kind): string {
    $prefixes = setting('prefixes', []) ?: [];
    $defaults = NUMBERED + ['invoice' => 'FAC', 'avoir' => 'NC'];
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

