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
