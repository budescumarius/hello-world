<?php
// API JSON de l'application. Route passée dans ?r=/chemin (fonctionne sans mod_rewrite).
declare(strict_types=1);
require __DIR__ . '/lib.php';

set_exception_handler(function (Throwable $e) {
    error_log('[batipro] ' . $e);
    fail(500, 'Erreur serveur : ' . ($e instanceof PDOException ? 'base de données' : $e->getMessage()));
});

$method = $_SERVER['REQUEST_METHOD'];
$path = trim((string)($_GET['r'] ?? ''), '/');
$seg = $path === '' ? [] : explode('/', $path);

// Les requêtes qui modifient des données doivent venir de l'application (protection CSRF avec le cookie SameSite)
if ($method !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'batipro') fail(403, 'Requête refusée');

$TYPE_RE = '/^[a-z_]{2,32}$/';

switch ($seg[0] ?? '') {
    // ------------------------------------------------------------ Authentification
    case 'auth':
        $act = $seg[1] ?? '';
        if ($act === 'login' && $method === 'POST') {
            $b = body();
            $ip = client_ip();
            q('DELETE FROM logins WHERE at < ?', [date('Y-m-d H:i:s', time() - 900)]);
            $tries = (int)q('SELECT COUNT(*) FROM logins WHERE ip = ?', [$ip])->fetchColumn();
            if ($tries >= 10) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
            $u = q('SELECT * FROM users WHERE email = ?', [mb_strtolower(trim((string)($b['email'] ?? '')))])->fetch();
            if (!$u || !$u['active'] || !password_verify((string)($b['password'] ?? ''), $u['pass'])) {
                q('INSERT INTO logins (ip, at) VALUES (?, ?)', [$ip, now()]);
                usleep(600000);
                fail(401, 'Email ou mot de passe incorrect.');
            }
            start_session();
            session_regenerate_id(true);
            $_SESSION['uid'] = (int)$u['id'];
            q('UPDATE users SET last_login = ? WHERE id = ?', [now(), $u['id']]);
            q('DELETE FROM logins WHERE ip = ?', [$ip]);
            out(['ok' => true]);
        }
        if ($act === 'logout' && $method === 'POST') {
            start_session();
            $_SESSION = [];
            session_destroy();
            out(['ok' => true]);
        }
        if ($act === 'me') {
            $u = current_user();
            out(['user' => $u]);
        }
        if ($act === 'password' && $method === 'POST') {
            $u = require_user();
            $b = body();
            $row = q('SELECT pass FROM users WHERE id = ?', [$u['id']])->fetch();
            if (!password_verify((string)($b['old'] ?? ''), $row['pass'])) fail(400, 'Mot de passe actuel incorrect.');
            if (mb_strlen((string)($b['new'] ?? '')) < 8) fail(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
            q('UPDATE users SET pass = ? WHERE id = ?', [password_hash($b['new'], PASSWORD_DEFAULT), $u['id']]);
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Données de départ
    case 'bootstrap':
        $u = require_user();
        $users = q('SELECT id, name, email, role, active, color, last_login FROM users ORDER BY name')->fetchAll();
        foreach ($users as &$x) { $x['id'] = (int)$x['id']; $x['active'] = (int)$x['active']; }
        $settings = [];
        foreach (q('SELECT k, v FROM settings')->fetchAll() as $r) $settings[$r['k']] = json_decode($r['v'], true);
        out(['user' => $u, 'users' => $users, 'settings' => $settings, 'version' => APP_VERSION]);

    // ------------------------------------------------------------ Utilisateurs
    case 'users':
        $id = isset($seg[1]) ? (int)$seg[1] : 0;
        if ($method === 'POST') {
            $me = require_admin();
            $b = body();
            $email = mb_strtolower(trim((string)($b['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Email invalide.');
            if (mb_strlen((string)($b['password'] ?? '')) < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
            if (q('SELECT id FROM users WHERE email = ?', [$email])->fetch()) fail(400, 'Cet email est déjà utilisé.');
            q('INSERT INTO users (name, email, pass, role, color, created_at) VALUES (?,?,?,?,?,?)', [
                trim((string)($b['name'] ?? $email)), $email, password_hash($b['password'], PASSWORD_DEFAULT),
                ($b['role'] ?? '') === 'admin' ? 'admin' : 'user', (string)($b['color'] ?? '#3b5bdb'), now()]);
            $nid = (int)db()->lastInsertId();
            log_activity($me['id'], 'create', 'user', $nid, null, $b['name'] ?? $email);
            out(['id' => $nid]);
        }
        if ($method === 'PUT' && $id) {
            $me = require_user();
            $b = body();
            if ($me['role'] !== 'admin' && $me['id'] !== $id) fail(403, 'Réservé aux administrateurs.');
            $fields = []; $args = [];
            if (isset($b['name'])) { $fields[] = 'name = ?'; $args[] = trim((string)$b['name']); }
            if (isset($b['color'])) { $fields[] = 'color = ?'; $args[] = (string)$b['color']; }
            if ($me['role'] === 'admin') {
                if (isset($b['email'])) { $fields[] = 'email = ?'; $args[] = mb_strtolower(trim((string)$b['email'])); }
                if (isset($b['role']) && $id !== $me['id']) { $fields[] = 'role = ?'; $args[] = $b['role'] === 'admin' ? 'admin' : 'user'; }
                if (isset($b['active']) && $id !== $me['id']) { $fields[] = 'active = ?'; $args[] = $b['active'] ? 1 : 0; }
                if (!empty($b['password'])) {
                    if (mb_strlen((string)$b['password']) < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
                    $fields[] = 'pass = ?'; $args[] = password_hash($b['password'], PASSWORD_DEFAULT);
                }
            }
            if ($fields) { $args[] = $id; q('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $args); }
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Paramètres de l'entreprise
    case 'settings':
        if ($method === 'PUT') {
            $me = require_admin();
            foreach (body() as $k => $v) if (preg_match('/^[a-z_]{2,40}$/', (string)$k)) set_setting($k, $v);
            log_activity($me['id'], 'update', 'settings', null, null, 'Paramètres');
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Numéro définitif (ex. facture émise)
    case 'number':
        require_user();
        $kind = $seg[1] ?? '';
        if (!preg_match($TYPE_RE, $kind) || $method !== 'POST') fail(400, 'Type invalide');
        db()->beginTransaction();
        $n = make_number($kind);
        db()->commit();
        out(['number' => $n]);

    // ------------------------------------------------------------ Éléments génériques
    case 'items':
        $me = require_user();
        $type = $seg[1] ?? '';
        $id = isset($seg[2]) ? (int)$seg[2] : 0;

        if ($method === 'GET' && $type === '') {
            // plusieurs types en une requête : ?types=a,b&project=ID
            $types = array_values(array_filter(explode(',', (string)($_GET['types'] ?? '')), fn($t) => preg_match($TYPE_RE, $t)));
            if (!$types) out([]);
            $sql = 'SELECT * FROM items WHERE type IN (' . implode(',', array_fill(0, count($types), '?')) . ')';
            $args = $types;
            if (isset($_GET['project'])) { $sql .= ' AND project_id = ?'; $args[] = (int)$_GET['project']; }
            $res = array_fill_keys($types, []);
            foreach (q($sql . ' ORDER BY id', $args)->fetchAll() as $r) $res[$r['type']][] = row_out($r);
            out($res);
        }
        if (!preg_match($TYPE_RE, $type)) fail(400, 'Type invalide');

        if ($method === 'GET' && !$id) {
            $sql = 'SELECT * FROM items WHERE type = ?'; $args = [$type];
            if (isset($_GET['project'])) { $sql .= ' AND project_id = ?'; $args[] = (int)$_GET['project']; }
            if (isset($_GET['parent'])) { $sql .= ' AND parent_id = ?'; $args[] = (int)$_GET['parent']; }
            out(array_map('row_out', q($sql . ' ORDER BY id', $args)->fetchAll()));
        }
        if ($method === 'GET') {
            $r = q('SELECT * FROM items WHERE id = ? AND type = ?', [$id, $type])->fetch();
            if (!$r) fail(404, 'Élément introuvable (supprimé ?)');
            out(row_out($r));
        }
        if ($method === 'POST' && !$id) {
            $b = body();
            $data = $b['data'] ?? [];
            $pid = isset($b['project_id']) && $b['project_id'] !== null && $b['project_id'] !== '' ? (int)$b['project_id'] : null;
            $parent = isset($b['parent_id']) && $b['parent_id'] ? (int)$b['parent_id'] : null;
            db()->beginTransaction();
            $number = null;
            if (isset(NUMBERED[$type])) $number = make_number($type);
            if ($type === 'point' && $pid) $number = (string)next_counter("point-$pid");
            q('INSERT INTO items (type, project_id, parent_id, number, data, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)',
              [$type, $pid, $parent, $number, json_encode($data, JSON_UNESCAPED_UNICODE), $me['id'], $me['id'], now(), now()]);
            $nid = (int)db()->lastInsertId();
            db()->commit();
            log_activity($me['id'], 'create', $type, $nid, $pid ?? ($type === 'project' ? $nid : null), $data['name'] ?? $data['title'] ?? $number);
            out(row_out(q('SELECT * FROM items WHERE id = ?', [$nid])->fetch()));
        }
        if ($method === 'PUT' && $id) {
            $b = body();
            $cur = q('SELECT * FROM items WHERE id = ? AND type = ?', [$id, $type])->fetch();
            if (!$cur) fail(404, 'Élément introuvable (supprimé ?)');
            if (isset($b['version']) && (int)$b['version'] !== (int)$cur['version'] && empty($b['force'])) {
                out(['error' => 'Cet élément a été modifié par un autre utilisateur entre-temps.', 'conflict' => row_out($cur)], 409);
            }
            $data = array_key_exists('data', $b) ? json_encode($b['data'], JSON_UNESCAPED_UNICODE) : $cur['data'];
            $pid = array_key_exists('project_id', $b) ? ($b['project_id'] === null || $b['project_id'] === '' ? null : (int)$b['project_id']) : $cur['project_id'];
            $number = array_key_exists('number', $b) ? $b['number'] : $cur['number'];
            q('UPDATE items SET data = ?, project_id = ?, number = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?',
              [$data, $pid, $number, $me['id'], now(), $id]);
            $d = json_decode($data, true) ?: [];
            if (empty($b['silent'])) log_activity($me['id'], 'update', $type, $id, $pid !== null ? (int)$pid : ($type === 'project' ? $id : null), $d['name'] ?? $d['title'] ?? $number);
            out(row_out(q('SELECT * FROM items WHERE id = ?', [$id])->fetch()));
        }
        if ($method === 'DELETE' && $id) {
            $cur = q('SELECT * FROM items WHERE id = ? AND type = ?', [$id, $type])->fetch();
            if (!$cur) out(['ok' => true]);
            $d = json_decode($cur['data'], true) ?: [];
            db()->beginTransaction();
            if ($type === 'project') {
                // un chantier supprimé emporte tout son contenu et ses fichiers
                foreach (q('SELECT path FROM files WHERE project_id = ?', [$id])->fetchAll() as $f) @unlink(__DIR__ . '/uploads/' . $f['path']);
                q('DELETE FROM files WHERE project_id = ?', [$id]);
                q('DELETE FROM items WHERE project_id = ?', [$id]);
            }
            q('DELETE FROM items WHERE id = ?', [$id]);
            db()->commit();
            log_activity($me['id'], 'delete', $type, $id, $cur['project_id'] !== null ? (int)$cur['project_id'] : null, $d['name'] ?? $d['title'] ?? $cur['number']);
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Fichiers
    case 'files':
        $me = require_user();
        $id = isset($seg[1]) ? (int)$seg[1] : 0;
        if ($method === 'POST' && !$id) {
            if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                $err = $_FILES['file']['error'] ?? -1;
                fail(400, $err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE ? 'Fichier trop volumineux pour le serveur.' : 'Envoi du fichier échoué.');
            }
            $f = $_FILES['file'];
            if ($f['size'] > MAX_UPLOAD) fail(400, 'Fichier trop volumineux (max. 32 Mo).');
            $name = preg_replace('/[\x00-\x1f\/\\\\]/', '_', (string)$f['name']);
            $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
            $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'dwg', 'dxf', 'zip', 'ppt', 'pptx', 'odt', 'ods'];
            if (!in_array($ext, $allowed, true)) fail(400, "Type de fichier non autorisé (.$ext).");
            $mime = class_exists('finfo') ? ((new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']) ?: 'application/octet-stream') : ((string)($f['type'] ?? '') ?: 'application/octet-stream');
            $dir = date('Y/m');
            if (!is_dir(__DIR__ . "/uploads/$dir")) mkdir(__DIR__ . "/uploads/$dir", 0755, true);
            $rel = "$dir/" . bin2hex(random_bytes(16)) . ".$ext";
            if (!move_uploaded_file($f['tmp_name'], __DIR__ . "/uploads/$rel")) fail(500, 'Impossible d\'enregistrer le fichier (droits du dossier uploads ?).');
            $pid = isset($_POST['project_id']) && $_POST['project_id'] !== '' ? (int)$_POST['project_id'] : null;
            q('INSERT INTO files (project_id, name, mime, size, path, created_by, created_at) VALUES (?,?,?,?,?,?,?)', [$pid, $name, $mime, (int)$f['size'], $rel, $me['id'], now()]);
            out(['id' => (int)db()->lastInsertId(), 'name' => $name, 'mime' => $mime, 'size' => (int)$f['size']]);
        }
        if ($method === 'GET' && $id) {
            $f = q('SELECT * FROM files WHERE id = ?', [$id])->fetch();
            if (!$f || !is_file(__DIR__ . '/uploads/' . $f['path'])) { http_response_code(404); exit('Fichier introuvable'); }
            $inline = preg_match('#^(image/|application/pdf)#', $f['mime']) && !isset($_GET['download']);
            header('Content-Type: ' . $f['mime']);
            header('Content-Length: ' . filesize(__DIR__ . '/uploads/' . $f['path']));
            header('Content-Disposition: ' . ($inline ? 'inline' : 'attachment') . "; filename*=UTF-8''" . rawurlencode($f['name']));
            header('Cache-Control: private, max-age=31536000, immutable');
            header("Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
            readfile(__DIR__ . '/uploads/' . $f['path']);
            exit;
        }
        if ($method === 'DELETE' && $id) {
            $f = q('SELECT * FROM files WHERE id = ?', [$id])->fetch();
            if ($f) { @unlink(__DIR__ . '/uploads/' . $f['path']); q('DELETE FROM files WHERE id = ?', [$id]); }
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Historique des actions
    case 'activity':
        require_user();
        $args = []; $sql = 'SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id';
        if (isset($_GET['project'])) { $sql .= ' WHERE a.project_id = ?'; $args[] = (int)$_GET['project']; }
        $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));
        out(q($sql . " ORDER BY a.id DESC LIMIT $limit", $args)->fetchAll());

    default:
        fail(404, 'Route inconnue');
}
