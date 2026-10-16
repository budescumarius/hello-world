<?php
/* API Șantier: autentificare, sincronizare date, fișiere (planuri și fotografii). */
declare(strict_types=1);
require __DIR__ . '/lib.php';

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function json_in(): array
{
    $d = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($d) ? $d : [];
}
function method(): string { return $_SERVER['REQUEST_METHOD'] ?? 'GET'; }
function now(): string { return gmdate('Y-m-d H:i:s'); }

set_exception_handler(function (Throwable $e) {
    error_log('santier api: ' . $e->getMessage());
    fail('Eroare de server', 500);
});

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) fail('Serverul nu este instalat. Deschide api/install.php', 503);
$cfg = require $cfgFile;
$pdo = connect($cfg);
$r = $_GET['r'] ?? '';

if ($r === 'ping') out(['ok' => true, 'app' => 'santier', 'version' => 1]);

if ($r === 'login') {
    $in = json_in();
    $st = $pdo->prepare('SELECT * FROM users WHERE username = ?');
    $st->execute([trim((string)($in['username'] ?? ''))]);
    $u = $st->fetch();
    if (!$u || !password_verify((string)($in['password'] ?? ''), $u['pass_hash'])) {
        usleep(700000);
        fail('Utilizator sau parolă greșită', 401);
    }
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO tokens (token, user_id, created, last_used) VALUES (?, ?, ?, ?)')
        ->execute([$token, $u['id'], now(), now()]);
    out(['token' => $token, 'user' => ['id' => (int)$u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role']]]);
}

// --- de aici în jos e nevoie de autentificare
$token = $_SERVER['HTTP_X_TOKEN'] ?? '';
if (!preg_match('/^[a-f0-9]{64}$/', $token)) fail('Neautentificat', 401);
$st = $pdo->prepare('SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?');
$st->execute([$token]);
$me = $st->fetch();
if (!$me) fail('Sesiune expirată', 401);
$pdo->prepare('UPDATE tokens SET last_used = ? WHERE token = ?')->execute([now(), $token]);
$isAdmin = $me['role'] === 'admin';

switch ($r) {
    case 'me':
        out(['user' => ['id' => (int)$me['id'], 'username' => $me['username'], 'name' => $me['name'], 'role' => $me['role']]]);

    case 'logout':
        $pdo->prepare('DELETE FROM tokens WHERE token = ?')->execute([$token]);
        out(['ok' => true]);

    case 'password':
        $in = json_in();
        if (!password_verify((string)($in['old'] ?? ''), $me['pass_hash'])) fail('Parola actuală este greșită', 403);
        $new = (string)($in['new'] ?? '');
        if (strlen($new) < 6) fail('Parola nouă trebuie să aibă minim 6 caractere');
        $pdo->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $me['id']]);
        out(['ok' => true]);

    case 'sync':
        $in = json_in();
        $since = max(0, (int)($in['since'] ?? 0));
        $changes = is_array($in['changes'] ?? null) ? $in['changes'] : [];
        if ($changes) {
            // Un singur scriitor odată, ca numerele de revizie să apară în ordinea în care sunt confirmate
            $pdo->query("SELECT GET_LOCK('santier_sync', 20)");
            try {
                $pdo->beginTransaction();
                $get = $pdo->prepare('SELECT modified FROM records WHERE store = ? AND id = ?');
                $put = $pdo->prepare('INSERT INTO records (store, id, data, deleted, modified, rev, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE data = VALUES(data), deleted = VALUES(deleted), modified = VALUES(modified), rev = VALUES(rev), user_id = VALUES(user_id)');
                foreach ($changes as $c) {
                    $store = (string)($c['store'] ?? '');
                    $id = (string)($c['id'] ?? '');
                    if (!in_array($store, SYNC_STORES, true) || !preg_match(ID_RE, $id)) continue;
                    $del = ($c['op'] ?? '') === 'del';
                    $data = $del ? null : ($c['data'] ?? null);
                    if (!$del && (!is_array($data) || ($data['id'] ?? '') !== $id)) continue;
                    $mod = (int)($c['mod'] ?? 0);
                    $get->execute([$store, $id]);
                    $cur = $get->fetch();
                    if ($cur && (int)$cur['modified'] > $mod) continue; // pe server există o versiune mai nouă
                    $pdo->exec('INSERT INTO seq () VALUES ()');
                    $rev = (int)$pdo->lastInsertId();
                    $put->execute([$store, $id, $del ? null : json_encode($data, JSON_UNESCAPED_UNICODE), $del ? 1 : 0, $mod, $rev, $me['id']]);
                }
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $e;
            } finally {
                $pdo->query("SELECT RELEASE_LOCK('santier_sync')");
            }
        }
        $limit = 1000;
        $st = $pdo->prepare("SELECT store, id, data, deleted, rev FROM records WHERE rev > ? ORDER BY rev LIMIT $limit");
        $st->execute([$since]);
        $rows = $st->fetchAll();
        $res = [];
        $rev = $since;
        foreach ($rows as $row) {
            $rev = (int)$row['rev'];
            $res[] = ['store' => $row['store'], 'id' => $row['id'], 'del' => (bool)$row['deleted'], 'data' => $row['deleted'] ? null : json_decode((string)$row['data'], true)];
        }
        out(['rev' => $rev, 'changes' => $res, 'more' => count($rows) === $limit]);

    case 'blob':
        $id = (string)($_GET['id'] ?? '');
        if (!preg_match(ID_RE, $id)) fail('ID invalid');
        $path = blob_path($id);
        if (method() === 'POST') {
            $mime = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
            if (!preg_match('#^image/(jpeg|png|webp|gif)$#', $mime)) fail('Tip de fișier nepermis');
            $body = file_get_contents('php://input');
            if ($body === false || $body === '') fail('Fișier gol (poate depășește limita de upload a serverului)');
            if (strlen($body) > MAX_BLOB) fail('Fișier prea mare', 413);
            if (!is_dir(dirname($path))) mkdir(dirname($path), 0755, true);
            if (file_put_contents($path, $body) === false) fail('Nu pot salva fișierul (permisiuni uploads/)', 500);
            $pdo->prepare('INSERT INTO blobs (id, mime, size, created, deleted) VALUES (?, ?, ?, ?, 0)
                ON DUPLICATE KEY UPDATE mime = VALUES(mime), size = VALUES(size), deleted = 0')
                ->execute([$id, $mime, strlen($body), now()]);
            out(['ok' => true]);
        }
        if (method() === 'DELETE') {
            $pdo->prepare('UPDATE blobs SET deleted = 1 WHERE id = ?')->execute([$id]);
            if (is_file($path)) unlink($path);
            out(['ok' => true]);
        }
        $st = $pdo->prepare('SELECT mime FROM blobs WHERE id = ? AND deleted = 0');
        $st->execute([$id]);
        $b = $st->fetch();
        if (!$b || !is_file($path)) fail('Fișier inexistent', 404);
        header('Content-Type: ' . $b['mime']);
        header('Content-Length: ' . filesize($path));
        header('Cache-Control: private, max-age=31536000, immutable');
        readfile($path);
        exit;

    case 'users':
        if (!$isAdmin) fail('Doar administratorul poate gestiona utilizatorii', 403);
        if (method() === 'GET') {
            out(['users' => $pdo->query('SELECT id, username, name, role, created FROM users ORDER BY username')->fetchAll()]);
        }
        if (method() === 'POST') {
            $in = json_in();
            $username = strtolower(trim((string)($in['username'] ?? '')));
            $name = trim((string)($in['name'] ?? ''));
            $role = ($in['role'] ?? '') === 'admin' ? 'admin' : 'user';
            $pass = (string)($in['password'] ?? '');
            if (!preg_match('/^[a-z0-9._-]{3,60}$/', $username)) fail('Utilizator invalid (litere mici, cifre, . _ -, minim 3)');
            $id = (int)($in['id'] ?? 0);
            if ($id) {
                if ($id === (int)$me['id'] && $role !== 'admin') fail('Nu îți poți scoate singur drepturile de administrator');
                $pdo->prepare('UPDATE users SET username = ?, name = ?, role = ? WHERE id = ?')->execute([$username, $name, $role, $id]);
                if ($pass !== '') {
                    if (strlen($pass) < 6) fail('Parola trebuie să aibă minim 6 caractere');
                    $pdo->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($pass, PASSWORD_DEFAULT), $id]);
                    $pdo->prepare('DELETE FROM tokens WHERE user_id = ?')->execute([$id]);
                }
            } else {
                if (strlen($pass) < 6) fail('Parola trebuie să aibă minim 6 caractere');
                $st = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
                $st->execute([$username]);
                if ($st->fetch()) fail('Utilizatorul există deja');
                $pdo->prepare('INSERT INTO users (username, name, pass_hash, role, created) VALUES (?, ?, ?, ?, ?)')
                    ->execute([$username, $name, password_hash($pass, PASSWORD_DEFAULT), $role, now()]);
            }
            out(['ok' => true]);
        }
        if (method() === 'DELETE') {
            $id = (int)($_GET['id'] ?? 0);
            if ($id === (int)$me['id']) fail('Nu te poți șterge pe tine');
            $pdo->prepare('DELETE FROM tokens WHERE user_id = ?')->execute([$id]);
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
            out(['ok' => true]);
        }
        fail('Metodă nepermisă', 405);

    case 'smtp':
        ensure_mail_schema($pdo);
        $st = $pdo->prepare('SELECT * FROM smtp WHERE user_id = ?');
        $st->execute([$me['id']]);
        $row = $st->fetch() ?: null;
        if (method() === 'POST') {
            $in = json_in();
            $email = trim((string)($in['from_email'] ?? ''));
            $host = trim((string)($in['host'] ?? ''));
            $port = (int)($in['port'] ?? 465);
            $secure = in_array($in['secure'] ?? '', ['ssl', 'tls', 'none'], true) ? $in['secure'] : 'ssl';
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Adresa de e-mail nu este validă');
            if (!preg_match('/^[a-z0-9.-]+$/i', $host)) fail('Serverul SMTP nu este valid');
            if ($port < 1 || $port > 65535) fail('Port invalid');
            $pass = (string)($in['password'] ?? '');
            $enc = $pass !== '' ? encrypt_secret($pass, $cfg) : ($row['password'] ?? null);
            $pdo->prepare('REPLACE INTO smtp (user_id, from_name, from_email, host, port, secure, username, password, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$me['id'], trim((string)($in['from_name'] ?? '')), $email, $host, $port, $secure, trim((string)($in['username'] ?? '')), $enc, now()]);
            out(['ok' => true]);
        }
        if (!$row) out(['smtp' => null]);
        unset($row['password']);
        $row['has_password'] = true;
        out(['smtp' => $row]);

    case 'smtp-test':
    case 'mail':
        if (method() !== 'POST') fail('Metodă nepermisă', 405);
        ensure_mail_schema($pdo);
        $st = $pdo->prepare('SELECT * FROM smtp WHERE user_id = ?');
        $st->execute([$me['id']]);
        $s = $st->fetch();
        if (!$s) fail('Configurează mai întâi adresa ta de trimitere (Setări → E-mail)');
        $s['password'] = decrypt_secret($s['password'], $cfg);
        try {
            $m = make_mailer($s);
            if ($r === 'smtp-test') {
                $m->addAddress($s['from_email']);
                $m->Subject = 'Test e-mail Șantier';
                $m->Body = "Acesta este un e-mail de test trimis din aplicația Șantier.\nConfigurarea funcționează.";
                $m->send();
                out(['ok' => true]);
            }
            $split = fn($v) => array_values(array_filter(array_map('trim', preg_split('/[,;\s]+/', (string)$v))));
            $to = $split($_POST['to'] ?? '');
            $cc = $split($_POST['cc'] ?? '');
            if (!$to) fail('Alege cel puțin un destinatar');
            if (count($to) + count($cc) > 40) fail('Prea mulți destinatari (maxim 40)');
            foreach (array_merge($to, $cc) as $a) if (!filter_var($a, FILTER_VALIDATE_EMAIL)) fail('Adresă invalidă: ' . $a);
            foreach ($to as $a) $m->addAddress($a);
            foreach ($cc as $a) $m->addCC($a);
            if (!empty($_POST['copy'])) $m->addBCC($s['from_email']);
            $m->addReplyTo($s['from_email'], $s['from_name']);
            $m->Subject = trim((string)($_POST['subject'] ?? ''));
            $body = (string)($_POST['body'] ?? '');
            $m->isHTML(true);
            $m->Body = text_to_html($body);
            $m->AltBody = $body;
            $f = $_FILES['file'] ?? null;
            if ($f) {
                if ($f['error'] !== UPLOAD_ERR_OK) fail('Atașamentul nu a ajuns pe server (cod ' . $f['error'] . ' – poate e prea mare)');
                if ($f['size'] > 24 * 1024 * 1024) fail('Atașamentul depășește 24 MB – reduceți numărul de fotografii');
                $name = preg_replace('/[^\w.\-]+/u', '_', (string)($_POST['filename'] ?? 'document.pdf'));
                $m->addAttachment($f['tmp_name'], $name, 'base64', 'application/pdf');
            }
            $m->send();
            out(['ok' => true, 'sent' => count($to) + count($cc)]);
        } catch (Throwable $e) {
            $msg = isset($m) && $m->ErrorInfo ? $m->ErrorInfo : $e->getMessage();
            fail('Trimiterea a eșuat: ' . $msg, 502);
        }

    default:
        fail('Rută necunoscută', 404);
}
