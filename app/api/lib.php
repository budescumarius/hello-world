<?php
declare(strict_types=1);

const SYNC_STORES = ['projects', 'plans', 'points', 'companies', 'meetings', 'settings'];
const ID_RE = '/^[a-z0-9]{6,40}$/';
const MAX_BLOB = 60 * 1024 * 1024;

function connect(array $cfg): PDO
{
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['db_host'], $cfg['db_name']);
    return new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function create_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(60) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL DEFAULT '',
        pass_hash VARCHAR(255) NOT NULL,
        role VARCHAR(10) NOT NULL DEFAULT 'user',
        created DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS tokens (
        token CHAR(64) NOT NULL PRIMARY KEY,
        user_id INT NOT NULL,
        created DATETIME NOT NULL,
        last_used DATETIME NOT NULL,
        KEY (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS records (
        store VARCHAR(20) NOT NULL,
        id VARCHAR(40) NOT NULL,
        data MEDIUMTEXT NULL,
        deleted TINYINT NOT NULL DEFAULT 0,
        modified BIGINT NOT NULL DEFAULT 0,
        rev BIGINT NOT NULL,
        user_id INT NULL,
        PRIMARY KEY (store, id),
        KEY (rev)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS seq (
        id BIGINT AUTO_INCREMENT PRIMARY KEY
    ) ENGINE=InnoDB");
    $pdo->exec("CREATE TABLE IF NOT EXISTS blobs (
        id VARCHAR(40) NOT NULL PRIMARY KEY,
        mime VARCHAR(60) NOT NULL,
        size INT NOT NULL,
        created DATETIME NOT NULL,
        deleted TINYINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function blob_path(string $id): string
{
    return __DIR__ . '/uploads/' . substr($id, -2) . '/' . $id;
}

// ---------------------------------------------------------------- E-mail (SMTP per utilizator)
function ensure_mail_schema(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS smtp (
        user_id INT NOT NULL PRIMARY KEY,
        from_name VARCHAR(120) NOT NULL DEFAULT '',
        from_email VARCHAR(190) NOT NULL DEFAULT '',
        host VARCHAR(190) NOT NULL DEFAULT '',
        port INT NOT NULL DEFAULT 465,
        secure VARCHAR(8) NOT NULL DEFAULT 'ssl',
        username VARCHAR(190) NOT NULL DEFAULT '',
        password TEXT NULL,
        updated DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// Parola SMTP se păstrează criptată; cheia vine din config.php (nu din baza de date)
function secret_key(array $cfg): string
{
    return hash('sha256', ($cfg['secret'] ?? '') . '|' . $cfg['db_pass'] . '|' . $cfg['db_name'] . '|santier-smtp', true);
}
function encrypt_secret(string $plain, array $cfg): string
{
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', secret_key($cfg), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $ct);
}
function decrypt_secret(?string $enc, array $cfg): string
{
    if (!$enc) return '';
    $raw = base64_decode($enc, true);
    if ($raw === false || strlen($raw) < 29) return '';
    $pt = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', secret_key($cfg), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    return $pt === false ? '' : $pt;
}

function make_mailer(array $s): PHPMailer\PHPMailer\PHPMailer
{
    require_once __DIR__ . '/vendor/phpmailer/Exception.php';
    require_once __DIR__ . '/vendor/phpmailer/PHPMailer.php';
    require_once __DIR__ . '/vendor/phpmailer/SMTP.php';
    $m = new PHPMailer\PHPMailer\PHPMailer(true);
    $m->isSMTP();
    $m->Host = $s['host'];
    $m->Port = (int)$s['port'];
    $m->SMTPAuth = $s['username'] !== '';
    $m->Username = $s['username'];
    $m->Password = $s['password'];
    if ($s['secure'] === 'ssl') $m->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
    elseif ($s['secure'] === 'tls') $m->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    else { $m->SMTPSecure = ''; $m->SMTPAutoTLS = false; }
    $m->CharSet = 'UTF-8';
    $m->Timeout = 25;
    $m->getSMTPInstance()->Timelimit = 30; // nu așteptăm la nesfârșit un server care nu răspunde
    $m->setFrom($s['from_email'], $s['from_name']);
    return $m;
}

function text_to_html(string $t): string
{
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">'
        . nl2br(htmlspecialchars($t, ENT_QUOTES, 'UTF-8')) . '</div>';
}
