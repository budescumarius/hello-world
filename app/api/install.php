<?php
/* Instalare server Șantier: creează config.php, tabelele și contul de administrator.
   Funcționează o singură dată; după instalare poți șterge acest fișier. */
declare(strict_types=1);
require __DIR__ . '/lib.php';

$cfgFile = __DIR__ . '/config.php';
$msg = '';
$ok = false;
$installed = is_file($cfgFile);

if (!$installed && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $cfg = [
        'db_host' => trim($_POST['db_host'] ?? 'localhost'),
        'db_name' => trim($_POST['db_name'] ?? ''),
        'db_user' => trim($_POST['db_user'] ?? ''),
        'db_pass' => (string)($_POST['db_pass'] ?? ''),
    ];
    $user = strtolower(trim($_POST['admin_user'] ?? ''));
    $pass = (string)($_POST['admin_pass'] ?? '');
    try {
        if (!preg_match('/^[a-z0-9._-]{3,60}$/', $user)) throw new RuntimeException('Utilizator administrator invalid (litere mici, cifre, . _ -, minim 3 caractere).');
        if (strlen($pass) < 6) throw new RuntimeException('Parola administratorului trebuie să aibă minim 6 caractere.');
        $pdo = connect($cfg);
        create_schema($pdo);
        $pdo->prepare('INSERT INTO users (username, name, pass_hash, role, created) VALUES (?, ?, ?, ?, ?)')
            ->execute([$user, trim($_POST['admin_name'] ?? ''), password_hash($pass, PASSWORD_DEFAULT), 'admin', gmdate('Y-m-d H:i:s')]);
        if (!is_dir(__DIR__ . '/uploads')) mkdir(__DIR__ . '/uploads', 0755, true);
        $php = "<?php\n// Generat de install.php – nu publica acest fișier.\nreturn " . var_export($cfg, true) . ";\n";
        if (file_put_contents($cfgFile, $php) === false) throw new RuntimeException('Nu pot scrie config.php – verifică permisiunile folderului api/.');
        $ok = true;
        $installed = true;
    } catch (PDOException $e) {
        $msg = 'Conectarea la baza de date a eșuat: ' . $e->getMessage();
    } catch (Throwable $e) {
        $msg = $e->getMessage();
    }
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?><!doctype html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Instalare Șantier</title>
<style>
  body{font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6fb;color:#141a2a;margin:0;padding:24px 16px}
  .box{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;box-shadow:0 4px 16px rgba(0,0,0,.08)}
  h1{margin-top:0;font-size:22px} label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px;color:#555}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccd;border-radius:10px;font-size:16px}
  button,.btn{margin-top:20px;width:100%;padding:12px;border:0;border-radius:10px;background:#1f4fd8;color:#fff;font-weight:700;font-size:16px;display:block;text-align:center;text-decoration:none}
  .err{background:#fde8e7;color:#b42318;padding:10px 12px;border-radius:10px}.ok{background:#e6f6ec;color:#1b6b3a;padding:10px 12px;border-radius:10px}
  h2{font-size:16px;margin:22px 0 0;border-top:1px solid #eee;padding-top:16px}
  small{color:#667}
</style></head><body><div class="box">
<h1>Instalare server Șantier</h1>
<?php if ($ok): ?>
  <p class="ok">Instalare reușită! Contul de administrator <b><?= $h($user) ?></b> a fost creat.</p>
  <p><b>Important:</b> șterge acum fișierul <code>api/install.php</code> din File Manager (cPanel).</p>
  <a class="btn" href="../">Deschide aplicația</a>
<?php elseif ($installed): ?>
  <p class="ok">Serverul este deja instalat.</p>
  <p>Pentru siguranță, șterge fișierul <code>api/install.php</code>. Pentru reinstalare, șterge mai întâi <code>api/config.php</code>.</p>
  <a class="btn" href="../">Deschide aplicația</a>
<?php else: ?>
  <?php if ($msg): ?><p class="err"><?= $h($msg) ?></p><?php endif; ?>
  <p><small>Creează mai întâi o bază de date MySQL și un utilizator în cPanel → „MySQL Databases” (Baze de date MySQL), apoi completează datele de mai jos.</small></p>
  <form method="post" autocomplete="off">
    <h2>Baza de date</h2>
    <label>Server MySQL</label><input name="db_host" value="<?= $h($_POST['db_host'] ?? 'localhost') ?>">
    <label>Nume bază de date</label><input name="db_name" required value="<?= $h($_POST['db_name'] ?? '') ?>" placeholder="ex. contcpanel_santier">
    <label>Utilizator MySQL</label><input name="db_user" required value="<?= $h($_POST['db_user'] ?? '') ?>" placeholder="ex. contcpanel_santier">
    <label>Parolă MySQL</label><input name="db_pass" type="password">
    <h2>Cont administrator al aplicației</h2>
    <label>Nume complet</label><input name="admin_name" value="<?= $h($_POST['admin_name'] ?? '') ?>">
    <label>Utilizator (pentru logare)</label><input name="admin_user" required value="<?= $h($_POST['admin_user'] ?? '') ?>" placeholder="ex. marius" autocapitalize="none">
    <label>Parolă (minim 6 caractere)</label><input name="admin_pass" type="password" required minlength="6">
    <button type="submit">Instalează</button>
  </form>
<?php endif; ?>
</div></body></html>
