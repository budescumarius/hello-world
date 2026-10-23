<?php
// API JSON de l'application. Route passée dans ?r=/chemin (fonctionne sans mod_rewrite).
declare(strict_types=1);
require __DIR__ . '/lib.php';
require __DIR__ . '/peppol_ap.php';
require __DIR__ . '/ai.php';

set_exception_handler(function (Throwable $e) {
    error_log('[batipro] ' . $e);
    fail(500, 'Erreur serveur : ' . ($e instanceof PDOException ? 'base de données' : $e->getMessage()));
});

$method = $_SERVER['REQUEST_METHOD'];
$path = trim((string)($_GET['r'] ?? ''), '/');
$seg = $path === '' ? [] : explode('/', $path);

// Les requêtes qui modifient des données doivent venir de l'application (protection CSRF avec le cookie SameSite)
if ($method !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'batipro') fail(403, 'Requête refusée');
migrate();

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
            if (!$u['super'] && !(int)q('SELECT active FROM companies WHERE id = ?', [$u['company_id']])->fetchColumn()) fail(403, 'Le compte de votre entreprise est suspendu. Contactez le gestionnaire de la plateforme.');
            start_session();
            session_regenerate_id(true);
            $_SESSION['uid'] = (int)$u['id'];
            unset($_SESSION['cid']);
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
        $users = q('SELECT id, name, email, role, active, color, last_login FROM users WHERE company_id = ? ORDER BY name', [cid()])->fetchAll();
        foreach ($users as &$x) { $x['id'] = (int)$x['id']; $x['active'] = (int)$x['active']; }
        unset($x);
        // le super-administrateur entré dans une autre firme apparaît aussi (auteur de ses modifications)
        if (!in_array($u['id'], array_column($users, 'id'), true)) $users[] = ['id' => $u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => 'admin', 'active' => 0, 'color' => $u['color'], 'last_login' => null];
        $settings = [];
        foreach (q('SELECT k, v FROM settings WHERE company_id = ?', [cid()])->fetchAll() as $r) $settings[$r['k']] = json_decode($r['v'], true);
        // le mot de passe SMTP ne quitte jamais le serveur
        if (isset($settings['smtp']) && is_array($settings['smtp'])) { $settings['smtp']['hasPass'] = !empty($settings['smtp']['pass']); unset($settings['smtp']['pass']); }
        if (isset($settings['peppolap']) && is_array($settings['peppolap'])) { $settings['peppolap']['hasKey'] = !empty($settings['peppolap']['key']); unset($settings['peppolap']['key']); }
        if (isset($settings['ai']) && is_array($settings['ai'])) { $settings['ai']['hasKey'] = !empty($settings['ai']['key']); unset($settings['ai']['key']); }
        $firm = q('SELECT id, name FROM companies WHERE id = ?', [cid()])->fetch() ?: ['id' => cid(), 'name' => ''];
        if (is_field($u)) {
            // espace terrain : uniquement ce qui sert à afficher les documents et les noms du bureau
            $settings = array_intersect_key($settings, array_flip(['company', 'template', 'prefixes', 'numpad']));
            if (isset($settings['company'])) $settings['company'] = array_intersect_key($settings['company'], array_flip(['name', 'appName', 'logoId', 'street', 'zip', 'city', 'address', 'country', 'phone', 'email', 'website', 'vat', 'currency']));
            $users = array_values(array_filter($users, fn($x) => $x['id'] === $u['id'] || $x['role'] === 'admin' || $x['role'] === 'user'));
            $users = array_map(fn($x) => ['id' => $x['id'], 'name' => $x['name'], 'role' => $x['role'], 'active' => $x['active'], 'color' => $x['color']], $users);
            $sc = field_scope($u);
            out(['user' => $u, 'users' => $users, 'settings' => $settings, 'version' => APP_VERSION, 'firm' => ['id' => (int)$firm['id'], 'name' => $firm['name'], 'own' => true],
                'edition' => edition(), 'ai' => false, 'translate' => ai_ready(), 'field' => ['employeeId' => $sc['employee'], 'contactId' => $sc['contact'], 'projects' => $sc['projects']]]);
        }
        out(['user' => $u, 'users' => $users, 'settings' => $settings, 'version' => APP_VERSION,
            'firm' => ['id' => (int)$firm['id'], 'name' => $firm['name'], 'own' => cid() === $u['company_id']], 'edition' => edition(), 'ai' => edition() === 'simple' ? false : ai_ready(), 'translate' => ai_ready()]);

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
            q('INSERT INTO users (company_id, name, email, pass, role, color, created_at) VALUES (?,?,?,?,?,?,?)', [cid(),
                trim((string)($b['name'] ?? $email)), $email, password_hash($b['password'], PASSWORD_DEFAULT),
                in_array($b['role'] ?? '', USER_ROLES, true) ? $b['role'] : 'user', (string)($b['color'] ?? '#3b5bdb'), now()]);
            $nid = (int)db()->lastInsertId();
            link_field_user($nid, (string)($b['role'] ?? ''), $b['link'] ?? null);
            log_activity($me['id'], 'create', 'user', $nid, null, $b['name'] ?? $email);
            out(['id' => $nid]);
        }
        if ($method === 'PUT' && $id) {
            $me = require_user();
            $b = body();
            $isAdmin = $me['role'] === 'admin' || $me['super'];
            if (!$isAdmin && $me['id'] !== $id) fail(403, 'Réservé aux administrateurs.');
            // un administrateur ne gère que les utilisateurs de sa firme
            if ($me['id'] !== $id && !q('SELECT id FROM users WHERE id = ? AND company_id = ?', [$id, cid()])->fetch()) fail(404, 'Utilisateur introuvable.');
            $fields = []; $args = [];
            if (isset($b['name'])) { $fields[] = 'name = ?'; $args[] = trim((string)$b['name']); }
            if (isset($b['color'])) { $fields[] = 'color = ?'; $args[] = (string)$b['color']; }
            if ($isAdmin) {
                if (isset($b['email'])) {
                    $em = mb_strtolower(trim((string)$b['email']));
                    if (!filter_var($em, FILTER_VALIDATE_EMAIL)) fail(400, 'Email invalide.');
                    if (q('SELECT id FROM users WHERE email = ? AND id <> ?', [$em, $id])->fetch()) fail(400, 'Cet email est déjà utilisé.');
                    $fields[] = 'email = ?'; $args[] = $em;
                }
                if (isset($b['role']) && $id !== $me['id']) { $fields[] = 'role = ?'; $args[] = in_array($b['role'], USER_ROLES, true) ? $b['role'] : 'user'; }
                if (isset($b['active']) && $id !== $me['id']) { $fields[] = 'active = ?'; $args[] = $b['active'] ? 1 : 0; }
                if (!empty($b['password'])) {
                    if (mb_strlen((string)$b['password']) < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
                    $fields[] = 'pass = ?'; $args[] = password_hash($b['password'], PASSWORD_DEFAULT);
                }
            }
            if ($fields) { $args[] = $id; q('UPDATE users SET ' . implode(', ', $fields) . ' WHERE id = ?', $args); }
            if ($isAdmin && $id !== $me['id'] && array_key_exists('link', $b)) link_field_user($id, (string)($b['role'] ?? ''), $b['link']);
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Paramètres de l'entreprise
    case 'settings':
        if ($method === 'PUT') {
            $me = require_admin();
            foreach (body() as $k => $v) {
                if (!preg_match('/^[a-z_]{2,40}$/', (string)$k) || $k === 'edition') continue; // l'édition se choisit dans Plateforme
                if ($k === 'smtp' && is_array($v)) {
                    // mot de passe vide = conserver l'ancien
                    $old = setting('smtp', []) ?: [];
                    if (($v['pass'] ?? '') === '' && empty($v['clearPass'])) $v['pass'] = $old['pass'] ?? '';
                    unset($v['hasPass'], $v['clearPass']);
                }
                if ($k === 'ai' && is_array($v)) {
                    $old = setting('ai', []) ?: [];
                    if (($v['key'] ?? '') === '' && empty($v['clearKey'])) $v['key'] = $old['key'] ?? '';
                    unset($v['hasKey'], $v['clearKey']);
                    $v += $old; // réglages techniques (adresse de l'API) conservés
                }
                if ($k === 'peppolap' && is_array($v)) {
                    $old = setting('peppolap', []) ?: [];
                    if (($v['key'] ?? '') === '' && empty($v['clearKey'])) $v['key'] = $old['key'] ?? '';
                    unset($v['hasKey'], $v['clearKey']);
                }
                set_setting($k, $v);
            }
            log_activity($me['id'], 'update', 'settings', null, null, 'Paramètres');
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Numéro définitif (ex. facture émise)
    case 'number':
        require_staff();
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
        $field = is_field($me);
        $see = fn(array $r) => !$field || field_can_read($me, $r);

        if ($method === 'GET' && $type === '') {
            // plusieurs types en une requête : ?types=a,b&project=ID
            $types = array_values(array_filter(explode(',', (string)($_GET['types'] ?? '')), fn($t) => preg_match($TYPE_RE, $t)));
            if (!$types) out([]);
            $sql = 'SELECT * FROM items WHERE company_id = ? AND type IN (' . implode(',', array_fill(0, count($types), '?')) . ')';
            $args = array_merge([cid()], $types);
            if (isset($_GET['project'])) { $sql .= ' AND project_id = ?'; $args[] = (int)$_GET['project']; }
            $res = array_fill_keys($types, []);
            foreach (q($sql . ' ORDER BY id', $args)->fetchAll() as $r) if ($see($r)) $res[$r['type']][] = row_out($r);
            out($res);
        }
        if (!preg_match($TYPE_RE, $type)) fail(400, 'Type invalide');

        if ($method === 'GET' && !$id) {
            $sql = 'SELECT * FROM items WHERE company_id = ? AND type = ?'; $args = [cid(), $type];
            if (isset($_GET['project'])) { $sql .= ' AND project_id = ?'; $args[] = (int)$_GET['project']; }
            if (isset($_GET['parent'])) { $sql .= ' AND parent_id = ?'; $args[] = (int)$_GET['parent']; }
            out(array_map('row_out', array_values(array_filter(q($sql . ' ORDER BY id', $args)->fetchAll(), $see))));
        }
        if ($method === 'GET') {
            $r = q('SELECT * FROM items WHERE id = ? AND type = ? AND company_id = ?', [$id, $type, cid()])->fetch();
            if (!$r || !$see($r)) fail(404, 'Élément introuvable (supprimé ?)');
            out(row_out($r));
        }
        if ($method === 'POST' && !$id) {
            $b = body();
            $data = $b['data'] ?? [];
            $pid = isset($b['project_id']) && $b['project_id'] !== null && $b['project_id'] !== '' ? (int)$b['project_id'] : null;
            $parent = isset($b['parent_id']) && $b['parent_id'] ? (int)$b['parent_id'] : null;
            if ($field) {
                // compte terrain : uniquement ses heures (sur sa fiche) et ses rapports, sur ses chantiers
                if ($type === 'timesheet' && is_array($data)) $data = field_timesheet($me, $data);
                if (!field_can_write($me, $type, $pid, is_array($data) ? $data : [], null)) fail(403, 'Action non autorisée pour votre compte.');
                $parent = null;
            }
            db()->beginTransaction();
            $number = null;
            if (isset(NUMBERED[$type])) $number = make_number($type);
            if ($type === 'point' && $pid) $number = (string)next_counter("point-$pid");
            q('INSERT INTO items (company_id, type, project_id, parent_id, number, data, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
              [cid(), $type, $pid, $parent, $number, json_encode($data, JSON_UNESCAPED_UNICODE), $me['id'], $me['id'], now(), now()]);
            $nid = (int)db()->lastInsertId();
            db()->commit();
            log_activity($me['id'], 'create', $type, $nid, $pid ?? ($type === 'project' ? $nid : null), $data['name'] ?? $data['title'] ?? $number);
            out(row_out(q('SELECT * FROM items WHERE id = ?', [$nid])->fetch()));
        }
        if ($method === 'PUT' && $id) {
            $b = body();
            $cur = q('SELECT * FROM items WHERE id = ? AND type = ? AND company_id = ?', [$id, $type, cid()])->fetch();
            if (!$cur) fail(404, 'Élément introuvable (supprimé ?)');
            if ($field) {
                $nd = array_key_exists('data', $b) && is_array($b['data']) ? $b['data'] : (json_decode($cur['data'], true) ?: []);
                $npid = array_key_exists('project_id', $b) ? ($b['project_id'] === null || $b['project_id'] === '' ? null : (int)$b['project_id']) : ($cur['project_id'] !== null ? (int)$cur['project_id'] : null);
                if ($type === 'timesheet') $nd = field_timesheet($me, $nd);
                if (!field_can_write($me, $type, $npid, $nd, $cur)) fail(403, 'Action non autorisée pour votre compte.');
                $b['data'] = $nd; unset($b['number']);
            }
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
            $cur = q('SELECT * FROM items WHERE id = ? AND type = ? AND company_id = ?', [$id, $type, cid()])->fetch();
            if (!$cur) out(['ok' => true]);
            if ($field && (!in_array($type, ['timesheet', 'report'], true) || (int)$cur['created_by'] !== $me['id'])) fail(403, 'Action non autorisée pour votre compte.');
            $d = json_decode($cur['data'], true) ?: [];
            db()->beginTransaction();
            if ($type === 'project') {
                // un chantier supprimé emporte tout son contenu et ses fichiers
                foreach (q('SELECT path FROM files WHERE project_id = ? AND company_id = ?', [$id, cid()])->fetchAll() as $f) @unlink(__DIR__ . '/uploads/' . $f['path']);
                q('DELETE FROM files WHERE project_id = ? AND company_id = ?', [$id, cid()]);
                q('DELETE FROM items WHERE project_id = ? AND company_id = ?', [$id, cid()]);
            }
            q('DELETE FROM items WHERE id = ? AND company_id = ?', [$id, cid()]);
            db()->commit();
            log_activity($me['id'], 'delete', $type, $id, $cur['project_id'] !== null ? (int)$cur['project_id'] : null, $d['name'] ?? $d['title'] ?? $cur['number']);
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Rapport lu (destinataire, sans modifier le rapport)
    case 'seen':
        $me = require_user();
        $id = (int)($seg[1] ?? 0);
        $r = q("SELECT * FROM items WHERE id = ? AND type = 'report' AND company_id = ?", [$id, cid()])->fetch();
        if (!$r || $method !== 'POST' || (is_field($me) && !field_can_read($me, $r))) fail(404, 'Rapport introuvable');
        $d = json_decode($r['data'], true) ?: [];
        $seen = array_map('intval', (array)($d['readBy'] ?? []));
        if (!in_array($me['id'], $seen, true)) { $d['readBy'] = [...$seen, $me['id']]; q('UPDATE items SET data = ? WHERE id = ?', [json_encode($d, JSON_UNESCAPED_UNICODE), $id]); }
        out(['ok' => true]);

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
            if (is_field($me) && $pid && !in_array($pid, field_scope($me)['projects'], true)) $pid = null;
            q('INSERT INTO files (company_id, project_id, name, mime, size, path, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [cid(), $pid, $name, $mime, (int)$f['size'], $rel, $me['id'], now()]);
            out(['id' => (int)db()->lastInsertId(), 'name' => $name, 'mime' => $mime, 'size' => (int)$f['size']]);
        }
        if ($method === 'GET' && $id) {
            $f = q('SELECT * FROM files WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
            if (!$f || !is_file(__DIR__ . '/uploads/' . $f['path']) || (is_field($me) && !field_can_file($me, $f))) { http_response_code(404); exit('Fichier introuvable'); }
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
            $f = q('SELECT * FROM files WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
            if ($f && is_field($me) && (int)$f['created_by'] !== $me['id']) fail(403, 'Action non autorisée pour votre compte.');
            if ($f) { @unlink(__DIR__ . '/uploads/' . $f['path']); q('DELETE FROM files WHERE id = ?', [$id]); }
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Compteurs de numérotation (reprise d'une numérotation existante)
    case 'counters':
        if ($method === 'GET') {
            require_staff();
            out((object)array_map('intval', array_column(q('SELECT k, n FROM counters WHERE company_id = ?', [cid()])->fetchAll(), 'n', 'k')));
        }
        if ($method === 'PUT') {
            $me = require_admin();
            foreach (body() as $k => $n) {
                if (!preg_match('/^[a-z_]{2,32}-\d{4}$/', (string)$k)) continue;
                q('INSERT INTO counters (company_id, k, n) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE n = VALUES(n)', [cid(), $k, max(0, (int)$n)]);
            }
            log_activity($me['id'], 'update', 'settings', null, null, 'Numérotation');
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Annuaire Peppol (participant enregistré ?)
    case 'peppol':
        $me = require_staff();
        $act = $seg[1] ?? '';
        if ($act === 'sync' && $method === 'POST') {
            try { $r = pap_sync($me['id']); } catch (Throwable $e) { fail(502, $e->getMessage()); }
            foreach ($r['created'] as $c) log_activity($me['id'], 'create', 'expense', $c['id'], null, 'Reçu via Peppol : ' . $c['label']);
            out($r);
        }
        if ($act === 'test' && $method === 'POST') {
            require_admin();
            try { $l = pap_req('GET', 'message/list?folder=INBOX&confirmed=false&perPage=1'); } catch (Throwable $e) { fail(502, $e->getMessage()); }
            out(['ok' => true, 'waiting' => (int)($l['meta']['total'] ?? count($l['items'] ?? []))]);
        }
        if ($act === 'send' && $method === 'POST') {
            $b = body();
            $xml = (string)($b['xml'] ?? '');
            $rcpt = trim((string)($b['recipient'] ?? ''));
            $co = setting('company', []) ?: [];
            $sender = trim((string)($co['peppolId'] ?? ''));
            if (!preg_match('/^\d{4}:[A-Za-z0-9.\-]{2,50}$/', $rcpt)) fail(400, 'Identifiant Peppol du client invalide.');
            if (!preg_match('/^\d{4}:[A-Za-z0-9.\-]{2,50}$/', $sender)) fail(400, 'Votre identifiant Peppol manque (Paramètres › Peppol).');
            if ($xml === '' || strlen($xml) > 15 * 1024 * 1024) fail(400, 'Fichier UBL manquant ou trop lourd.');
            try {
                $r = pap_req('POST', 'message', ['sender' => $sender, 'recipient' => $rcpt, 'processType' => PAP_PROCESS,
                    'documentType' => !empty($b['credit']) ? PAP_DOC_CREDIT : PAP_DOC_INVOICE, 'fileContent' => base64_encode($xml)]);
            } catch (Throwable $e) { fail(502, $e->getMessage()); }
            $iid = isset($b['invoice_id']) ? (int)$b['invoice_id'] : null;
            log_activity($me['id'], 'mail', 'invoice', $iid, null, 'Envoyée via Peppol à ' . $rcpt);
            out(['ok' => true, 'id' => $r['id'] ?? null]);
        }
        $id = trim((string)($_GET['id'] ?? ''));
        if (($seg[1] ?? '') !== 'lookup' || !preg_match('/^\d{4}:[A-Za-z0-9.\-]{2,50}$/', $id)) fail(400, 'Identifiant Peppol invalide (format 0208:0123456789)');
        $url = 'https://directory.peppol.eu/search/1.0/json?participant=' . rawurlencode('iso6523-actorid-upis::' . $id);
        $ctx = stream_context_create(['http' => ['timeout' => 12, 'header' => "Accept: application/json\r\nUser-Agent: BatiPro\r\n"]]);
        $raw = @file_get_contents($url, false, $ctx);
        if ($raw === false && function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
            $raw = curl_exec($ch);
            curl_close($ch);
        }
        if ($raw === false || $raw === null) fail(502, 'Annuaire Peppol injoignable depuis le serveur');
        // un résultat vide (corps vide ou 0 résultat) signifie « non enregistré »
        $j = json_decode((string)$raw, true) ?: [];
        $matches = $j['matches'] ?? [];
        $ent = $matches[0]['entities'][0] ?? [];
        $name = $ent['name'] ?? null;
        if (is_array($name)) $name = $name[0]['name'] ?? ($name['name'] ?? null);
        out(['registered' => (int)($j['total-result-count'] ?? 0) > 0 || count($matches) > 0, 'name' => is_string($name) ? $name : null, 'country' => $ent['countryCode'] ?? null]);

    // ------------------------------------------------------------ Numéro de TVA : vérification VIES (actif ?) + nom et adresse officiels
    case 'vat':
        require_staff();
        if (($seg[1] ?? '') !== 'lookup') fail(404, 'Route inconnue');
        out(vat_lookup((string)($_GET['vat'] ?? ''), (string)($_GET['cc'] ?? 'BE')));


    case 'mail':
        $me = require_staff();
        if ($method !== 'POST') fail(404, 'Route inconnue');
        $parse = function ($v): array {
            $list = is_array($v) ? $v : (json_decode((string)$v, true) ?: []);
            $outl = [];
            foreach ($list as $a) {
                $e = mb_strtolower(trim((string)(is_array($a) ? ($a['email'] ?? '') : $a)));
                if ($e === '') continue;
                if (!filter_var($e, FILTER_VALIDATE_EMAIL)) fail(400, "Adresse email invalide : $e");
                $outl[$e] = ['email' => $e, 'name' => is_array($a) ? (string)($a['name'] ?? '') : ''];
            }
            return array_values($outl);
        };
        if (($seg[1] ?? '') === 'test') {
            require_admin();
            try { send_mail([['email' => $me['email'], 'name' => $me['name']]], [], 'Test d\'envoi BâtiPro', "Bonjour,\n\nCet email de test confirme que l'envoi depuis BâtiPro fonctionne.\n", []); }
            catch (Throwable $e) { fail(502, $e->getMessage()); }
            out(['ok' => true, 'to' => $me['email']]);
        }
        $to = $parse($_POST['to'] ?? '[]');
        $cc = $parse($_POST['cc'] ?? '[]');
        $cc = array_values(array_filter($cc, fn($a) => !in_array($a['email'], array_column($to, 'email'), true)));
        if (!$to) fail(400, 'Choisissez au moins un destinataire.');
        if (count($to) + count($cc) > 40) fail(400, 'Maximum 40 destinataires.');
        $subject = trim(preg_replace('/[\r\n]+/', ' ', (string)($_POST['subject'] ?? '')));
        if ($subject === '') fail(400, 'Objet manquant.');
        $text = (string)($_POST['body'] ?? '');
        $atts = []; $total = 0;
        if (!empty($_FILES['att'])) {
            $f = $_FILES['att'];
            $n = is_array($f['name']) ? count($f['name']) : 1;
            for ($i = 0; $i < $n; $i++) {
                $err = is_array($f['error']) ? $f['error'][$i] : $f['error'];
                if ($err !== UPLOAD_ERR_OK) fail(400, $err === UPLOAD_ERR_INI_SIZE ? 'Pièce jointe trop volumineuse pour le serveur.' : 'Pièce jointe non reçue.');
                $tmp = is_array($f['tmp_name']) ? $f['tmp_name'][$i] : $f['tmp_name'];
                $total += filesize($tmp);
                $atts[] = ['name' => is_array($f['name']) ? $f['name'][$i] : $f['name'], 'mime' => (is_array($f['type']) ? $f['type'][$i] : $f['type']) ?: 'application/octet-stream', 'data' => file_get_contents($tmp)];
            }
        }
        if ($total > 20 * 1024 * 1024) fail(400, 'Pièces jointes trop lourdes (max. 20 Mo).');
        try { send_mail($to, $cc, $subject, $text, $atts, ['email' => $me['email'], 'name' => $me['name']]); }
        catch (Throwable $e) { error_log('[batipro mail] ' . $e->getMessage()); fail(502, 'Envoi impossible : ' . $e->getMessage()); }
        $pid = isset($_POST['project_id']) && $_POST['project_id'] !== '' ? (int)$_POST['project_id'] : null;
        $rtype = preg_match($TYPE_RE, (string)($_POST['ref_type'] ?? '')) ? (string)$_POST['ref_type'] : 'mail';
        $rid = isset($_POST['ref_id']) && $_POST['ref_id'] !== '' ? (int)$_POST['ref_id'] : null;
        log_activity($me['id'], 'mail', $rtype, $rid, $pid, mb_substr($subject . ' → ' . implode(', ', array_column(array_merge($to, $cc), 'email')), 0, 250));
        out(['ok' => true, 'sent' => count($to) + count($cc)]);

    // ------------------------------------------------------------ Plateforme : firmes clientes (super-administrateur)
    case 'platform':
        $me = require_super();
        $act = $seg[1] ?? '';
        $id = isset($seg[2]) ? (int)$seg[2] : 0;
        if ($act === 'companies' && $method === 'GET') {
            $rows = q("SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS users,
                (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.active = 1) AS users_active,
                (SELECT COUNT(*) FROM items i WHERE i.company_id = c.id AND i.type = 'project') AS projects,
                (SELECT MAX(u.last_login) FROM users u WHERE u.company_id = c.id) AS last_login,
                (SELECT GROUP_CONCAT(u.email ORDER BY u.id SEPARATOR ', ') FROM users u WHERE u.company_id = c.id AND u.role = 'admin') AS admins
                FROM companies c ORDER BY c.name")->fetchAll();
            foreach ($rows as &$r) { foreach (['id', 'active', 'users', 'users_active', 'projects'] as $k) $r[$k] = (int)$r[$k]; $r['edition'] = edition((int)$r['id']); }
            unset($r);
            out($rows);
        }
        if ($act === 'companies' && $method === 'POST' && !$id) {
            $b = body();
            $name = trim((string)($b['name'] ?? ''));
            $email = mb_strtolower(trim((string)($b['email'] ?? '')));
            if ($name === '') fail(400, 'Nom de la firme manquant.');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Email de l\'administrateur invalide.');
            if (mb_strlen((string)($b['password'] ?? '')) < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
            if (q('SELECT id FROM users WHERE email = ?', [$email])->fetch()) fail(400, 'Cet email est déjà utilisé (un email = un seul compte).');
            db()->beginTransaction();
            q('INSERT INTO companies (name, active, created_at) VALUES (?, 1, ?)', [$name, now()]);
            $cid = (int)db()->lastInsertId();
            set_setting('edition', in_array($b['edition'] ?? '', ['simple', 'avance'], true) ? $b['edition'] : edition_default(), $cid);
            $country = in_array($b['country'] ?? 'BE', ['BE', 'FR', 'LU', 'CH', 'RO'], true) ? $b['country'] : 'BE';
            set_setting('company', ['name' => $name, 'currency' => 'EUR', 'vatRates' => [21, 12, 6, 0], 'defaultVat' => 21, 'country' => $country,
                'vat' => trim((string)($b['vat'] ?? '')), 'street' => trim((string)($b['street'] ?? '')), 'zip' => trim((string)($b['zip'] ?? '')), 'city' => trim((string)($b['city'] ?? '')),
                'address' => trim(trim((string)($b['street'] ?? '')) . "\n" . trim(trim((string)($b['zip'] ?? '')) . ' ' . trim((string)($b['city'] ?? ''))))], $cid);
            q('INSERT INTO users (company_id, name, email, pass, role, color, created_at) VALUES (?,?,?,?,?,?,?)',
              [$cid, trim((string)($b['admin'] ?? '')) ?: $email, $email, password_hash((string)$b['password'], PASSWORD_DEFAULT), 'admin', '#3b5bdb', now()]);
            db()->commit();
            out(['id' => $cid]);
        }
        // suppression définitive d'une firme (jamais la sienne) : données, fichiers, utilisateurs, paramètres
        if ($act === 'companies' && $method === 'DELETE' && $id) {
            $c = q('SELECT * FROM companies WHERE id = ?', [$id])->fetch();
            if (!$c) fail(404, 'Firme introuvable');
            if ($id === (int)$me['company_id']) fail(400, 'Vous ne pouvez pas supprimer votre propre firme.');
            if (q('SELECT id FROM users WHERE company_id = ? AND super = 1', [$id])->fetch()) fail(400, 'Cette firme contient un administrateur de la plateforme.');
            if (mb_strtolower(trim((string)(body()['confirm'] ?? ''))) !== mb_strtolower(trim((string)$c['name']))) fail(400, 'Tapez exactement le nom de la firme pour confirmer.');
            $paths = q('SELECT path FROM files WHERE company_id = ?', [$id])->fetchAll();
            db()->beginTransaction();
            foreach (['items', 'files', 'counters', 'settings', 'activity', 'users'] as $t) q("DELETE FROM $t WHERE company_id = ?", [$id]);
            try { q('DELETE FROM ai_convs WHERE company_id = ?', [$id]); } catch (Throwable $e) { /* table absente */ }
            q('DELETE FROM companies WHERE id = ?', [$id]);
            db()->commit();
            foreach ($paths as $f) @unlink(__DIR__ . '/uploads/' . $f['path']);
            if ((int)($_SESSION['cid'] ?? 0) === $id) unset($_SESSION['cid']);
            log_activity($me['id'], 'delete', 'company', $id, null, 'Firme supprimée : ' . $c['name']);
            out(['ok' => true]);
        }
        if ($act === 'companies' && $method === 'PUT' && $id) {
            $b = body();
            if ($id === $me['company_id'] && array_key_exists('active', $b) && !$b['active']) fail(400, 'Vous ne pouvez pas suspendre votre propre firme.');
            if (isset($b['name']) && trim((string)$b['name']) !== '') q('UPDATE companies SET name = ? WHERE id = ?', [trim((string)$b['name']), $id]);
            if (array_key_exists('active', $b)) q('UPDATE companies SET active = ? WHERE id = ?', [$b['active'] ? 1 : 0, $id]);
            if (in_array($b['edition'] ?? '', ['simple', 'avance'], true)) set_setting('edition', $b['edition'], $id);
            out(['ok' => true]);
        }
        if ($act === 'switch' && $method === 'POST') {
            $b = body();
            $to = (int)($b['company_id'] ?? 0);
            if ($to && !q('SELECT id FROM companies WHERE id = ?', [$to])->fetch()) fail(404, 'Firme introuvable.');
            if (!$to || $to === $me['company_id']) unset($_SESSION['cid']); else $_SESSION['cid'] = $to;
            out(['ok' => true]);
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Assistant IA
    case 'ai':
        $me = require_user();
        if (is_field($me) && ($seg[1] ?? '') !== 'translate') fail(403, 'Accès réservé au bureau.');
        db()->exec('CREATE TABLE IF NOT EXISTS ai_convs (id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, user_id INT NOT NULL, title VARCHAR(190) NOT NULL, turns LONGTEXT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, KEY owner (company_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        $act = $seg[1] ?? '';
        $id = isset($seg[2]) ? (int)$seg[2] : 0;
        if ($act === 'convs' && $method === 'GET') {
            out(q('SELECT id, title, updated_at FROM ai_convs WHERE company_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 50', [cid(), $me['id']])->fetchAll());
        }
        if ($act === 'conv' && $id && $method === 'GET') {
            $c = ai_conv_load($id, $me); if (!$c) fail(404, 'Conversation introuvable');
            out(['id' => $c['id'], 'title' => $c['title'], 'messages' => ai_conv_view($c)]);
        }
        if ($act === 'conv' && $id && $method === 'DELETE') {
            q('DELETE FROM ai_convs WHERE id = ? AND company_id = ? AND user_id = ?', [$id, cid(), $me['id']]);
            out(['ok' => true]);
        }
        if ($act === 'chat' && $method === 'POST') {
            if (PHP_VERSION_ID < 80100) fail(503, "L'assistant IA demande PHP 8.1 ou plus récent (cPanel › Sélectionner la version PHP).");
            if (!is_file(__DIR__ . '/vendor/autoload.php')) fail(503, "Le dossier vendor/ manque : téléversez l'archive complète de l'application.");
            if (ai_key() === '') fail(503, "Assistant IA non configuré : ajoutez une clé API Anthropic dans Paramètres › Assistant IA.");
            // JSON, ou formulaire multipart quand des photos sont jointes
            $multi = !empty($_FILES['img']);
            $b = $multi ? ['text' => $_POST['text'] ?? '', 'conv_id' => $_POST['conv_id'] ?? null, 'context' => json_decode((string)($_POST['context'] ?? '[]'), true)] : body();
            $text = trim((string)($b['text'] ?? ''));
            if ($multi && $text === '') $text = 'Voici des photos.';
            if ($text === '' || mb_strlen($text) > 20000) fail(400, 'Message vide ou trop long.');
            $photos = [];
            if ($multi) {
                $f = $_FILES['img'];
                $n = is_array($f['name']) ? count($f['name']) : 1;
                if ($n > 6) fail(400, 'Maximum 6 photos par message.');
                for ($i = 0; $i < $n; $i++) {
                    $err = is_array($f['error']) ? $f['error'][$i] : $f['error'];
                    $tmp = is_array($f['tmp_name']) ? $f['tmp_name'][$i] : $f['tmp_name'];
                    if ($err !== UPLOAD_ERR_OK) fail(400, 'Photo non reçue (trop lourde ?).');
                    if (filesize($tmp) > 8 * 1024 * 1024) fail(400, 'Photo trop lourde (max. 8 Mo).');
                    $info = @getimagesize($tmp);
                    $mime = $info['mime'] ?? '';
                    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], true)) fail(400, 'Format de photo non pris en charge (JPEG, PNG, WebP).');
                    $photos[] = store_file('photo-assistant-' . ($i + 1) . '.' . ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'jpg', 'image/gif' => 'png'][$mime], $mime, file_get_contents($tmp), $me['id']);
                }
            }
            try {
                out(ai_chat($me, !empty($b['conv_id']) ? (int)$b['conv_id'] : null, $text, is_array($b['context'] ?? null) ? $b['context'] : [], $photos));
            } catch (\Anthropic\Core\Exceptions\AuthenticationException $e) {
                fail(502, 'Clé API Anthropic refusée : vérifiez-la dans Paramètres › Assistant IA.');
            } catch (\Anthropic\Core\Exceptions\RateLimitException $e) {
                fail(502, 'Trop de demandes à l\'assistant : réessayez dans une minute.');
            } catch (\Anthropic\Core\Exceptions\InternalServerException $e) {
                fail(502, 'Le service IA est momentanément indisponible, réessayez.');
            } catch (\Anthropic\Core\Exceptions\APIStatusException $e) {
                error_log('[batipro ai] ' . $e->getMessage());
                $msg = is_array($e->body ?? null) ? (string)($e->body['error']['message'] ?? '') : '';
                fail(502, 'Erreur IA (' . ($e->status ?? '?') . ') : ' . ($msg ?: 'requête refusée'));
            } catch (\Anthropic\Core\Exceptions\APITimeoutException $e) {
                fail(504, 'L\'assistant a mis trop de temps à répondre : simplifiez la demande ou réessayez.');
            } catch (\Anthropic\Core\Exceptions\APIConnectionException $e) {
                fail(502, 'Service IA injoignable depuis le serveur : ' . $e->getMessage());
            }
        }
        // Traduction d'une ligne dictée (roumain → français), aussi en édition Simplifiée
        if ($act === 'translate' && $method === 'POST') {
            if (!ai_ready()) fail(503, "Traduction indisponible : la clé de l'assistant IA n'est pas configurée.");
            $text = trim((string)(body()['text'] ?? ''));
            if ($text === '' || mb_strlen($text) > 2000) fail(400, 'Texte vide ou trop long.');
            try {
                out(['text' => ai_translate($text)]);
            } catch (\Anthropic\Core\Exceptions\AuthenticationException $e) {
                fail(502, 'Clé API Anthropic refusée.');
            } catch (\Throwable $e) {
                error_log('[batipro translate] ' . $e->getMessage());
                fail(502, 'Traduction impossible pour le moment, réessayez.');
            }
        }
        if ($act === 'test' && $method === 'POST') {
            require_admin();
            if (!ai_ready()) fail(503, 'Clé manquante ou PHP / vendor non disponible.');
            require_once __DIR__ . '/vendor/autoload.php';
            try {
                $r = (new \Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url()))->messages->create(maxTokens: 64, messages: [['role' => 'user', 'content' => 'Réponds juste : OK']], model: AI_MODEL, outputConfig: ['effort' => 'low']);
                out(['ok' => true, 'model' => $r->model]);
            } catch (Throwable $e) { fail(502, 'Test impossible : ' . $e->getMessage()); }
        }
        fail(404, 'Route inconnue');

    // ------------------------------------------------------------ Historique des actions
    case 'activity':
        require_staff();
        $args = [cid()]; $sql = 'SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.company_id = ?';
        if (isset($_GET['project'])) { $sql .= ' AND a.project_id = ?'; $args[] = (int)$_GET['project']; }
        $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));
        out(q($sql . " ORDER BY a.id DESC LIMIT $limit", $args)->fetchAll());

    default:
        fail(404, 'Route inconnue');
}
