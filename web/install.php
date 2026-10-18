<?php
// Assistant d'installation : crée les tables, le compte administrateur et config.php.
declare(strict_types=1);
$cfgFile = __DIR__ . '/config.php';
$done = is_file($cfgFile);
$err = '';
$ok = false;

if (!$done && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $p = fn($k) => trim((string)($_POST[$k] ?? ''));
    try {
        if (!filter_var($p('email'), FILTER_VALIDATE_EMAIL)) throw new Exception('Email administrateur invalide.');
        if (mb_strlen($p('password')) < 8) throw new Exception('Le mot de passe doit contenir au moins 8 caractères.');
        if (!is_writable(__DIR__)) throw new Exception("Le dossier de l'application n'est pas accessible en écriture (impossible de créer config.php).");
        if (!is_dir(__DIR__ . '/uploads')) mkdir(__DIR__ . '/uploads', 0755);
        if (!is_writable(__DIR__ . '/uploads')) throw new Exception('Le dossier uploads n\'est pas accessible en écriture.');
        $pdo = new PDO("mysql:host={$p('db_host')};dbname={$p('db_name')};charset=utf8mb4", $p('db_user'), $_POST['db_pass'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        foreach (array_filter(array_map('trim', explode(';', file_get_contents(__DIR__ . '/schema.sql')))) as $sql) $pdo->exec($sql);
        $now = date('Y-m-d H:i:s');
        $st = $pdo->prepare('INSERT INTO users (name, email, pass, role, color, created_at) VALUES (?,?,?,?,?,?)');
        $st->execute([$p('name') ?: 'Administrateur', mb_strtolower($p('email')), password_hash($p('password'), PASSWORD_DEFAULT), 'admin', '#3b5bdb', $now]);
        $company = ['name' => $p('company'), 'currency' => 'EUR', 'vatRates' => [21, 12, 6, 0], 'defaultVat' => 21, 'country' => 'BE'];
        $pdo->prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)')->execute(['company', json_encode($company, JSON_UNESCAPED_UNICODE)]);
        $config = "<?php\n// Généré par install.php le $now\nreturn " . var_export([
            'db' => ['host' => $p('db_host'), 'name' => $p('db_name'), 'user' => $p('db_user'), 'pass' => $_POST['db_pass'] ?? ''],
        ], true) . ";\n";
        if (file_put_contents($cfgFile, $config) === false) throw new Exception('Impossible d\'écrire config.php.');
        @chmod($cfgFile, 0640);
        $ok = true;
    } catch (Throwable $e) {
        $err = $e instanceof PDOException ? 'Connexion à la base de données impossible : ' . $e->getMessage() : $e->getMessage();
    }
}
$h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES);
?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installation</title>
<style>
body{font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f3f5f9;color:#16203a;margin:0;padding:24px}
.box{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
h1{margin:0 0 6px;font-size:22px}h2{font-size:15px;margin:22px 0 8px;color:#3b5bdb}
label{display:block;margin:10px 0 4px;font-weight:600;font-size:13px;color:#5b6478}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d5dae5;border-radius:9px;font:inherit}
button,.btn{margin-top:20px;background:#3b5bdb;color:#fff;border:0;border-radius:9px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-block}
.err{background:#fdecec;color:#b42318;padding:10px 12px;border-radius:9px;margin:12px 0}.ok{background:#e9f7ef;color:#1e7a46;padding:10px 12px;border-radius:9px;margin:12px 0}
.muted{color:#6b7385;font-size:13px}
</style></head><body><div class="box">
<?php if ($done && !$ok): ?>
  <h1>Application déjà installée</h1>
  <p>Le fichier <code>config.php</code> existe déjà. Pour des raisons de sécurité, vous pouvez supprimer <code>install.php</code> du serveur.</p>
  <a class="btn" href="./">Ouvrir l'application</a>
<?php elseif ($ok): ?>
  <h1>Installation terminée ✔</h1>
  <div class="ok">Les tables et le compte administrateur ont été créés.</div>
  <p><b>Important :</b> supprimez maintenant le fichier <code>install.php</code> du serveur (Gestionnaire de fichiers cPanel).</p>
  <a class="btn" href="./">Se connecter</a>
<?php else: ?>
  <h1>Installation</h1>
  <p class="muted">Créez d'abord une base MySQL et un utilisateur dans cPanel → <b>Bases de données MySQL</b> (donnez à l'utilisateur tous les privilèges sur la base), puis remplissez ce formulaire.</p>
  <?php if ($err): ?><div class="err"><?= $h($err) ?></div><?php endif; ?>
  <form method="post">
    <h2>Base de données</h2>
    <label>Serveur</label><input name="db_host" value="<?= $h($_POST['db_host'] ?? 'localhost') ?>" required>
    <label>Nom de la base</label><input name="db_name" value="<?= $h($_POST['db_name'] ?? '') ?>" placeholder="ex. moncompte_batipro" required>
    <label>Utilisateur</label><input name="db_user" value="<?= $h($_POST['db_user'] ?? '') ?>" required>
    <label>Mot de passe</label><input name="db_pass" type="password">
    <h2>Entreprise et administrateur</h2>
    <label>Nom de l'entreprise</label><input name="company" value="<?= $h($_POST['company'] ?? '') ?>" required>
    <label>Votre nom</label><input name="name" value="<?= $h($_POST['name'] ?? '') ?>" required>
    <label>Email (identifiant)</label><input name="email" type="email" value="<?= $h($_POST['email'] ?? '') ?>" required>
    <label>Mot de passe (8 caractères min.)</label><input name="password" type="password" minlength="8" required>
    <button type="submit">Installer</button>
  </form>
<?php endif; ?>
</div></body></html>
