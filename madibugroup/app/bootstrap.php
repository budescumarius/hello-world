<?php
/**
 * Madibu Group — noyau commun du site public et de l'administration.
 * Stockage en fichiers JSON (dossier data/), images dans uploads/.
 */
declare(strict_types=1);

define('ROOT', dirname(__DIR__));
define('DATA_DIR', ROOT . '/data');
define('UPLOAD_DIR', ROOT . '/uploads');
define('UPLOAD_URL', '/uploads');

mb_internal_encoding('UTF-8');
date_default_timezone_set('Europe/Brussels');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function slugify(string $s): string
{
    $s = trim($s);
    if (class_exists('Transliterator')) {
        $t = Transliterator::create('Any-Latin; Latin-ASCII; Lower()');
        if ($t) $s = $t->transliterate($s);
    } else {
        $s = strtolower(iconv('UTF-8', 'ASCII//TRANSLIT', $s) ?: $s);
    }
    $s = preg_replace('~[^a-z0-9]+~', '-', strtolower($s));
    return trim($s, '-') ?: 'item';
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function base_url(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? 'www.madibugroup.be';
    $host = preg_replace('~[^a-z0-9.:\-]~i', '', $host);
    return (is_https() ? 'https' : 'http') . '://' . $host;
}

function redirect(string $to, int $code = 302): never
{
    header('Location: ' . $to, true, $code);
    exit;
}

/* ------------------------------------------------------------------ */
/* JSON store with file locking                                        */
/* ------------------------------------------------------------------ */

function store_path(string $name): string
{
    return DATA_DIR . '/' . preg_replace('~[^a-z0-9_\-]~', '', $name) . '.json';
}

function load(string $name, $default = [])
{
    $p = store_path($name);
    if (!is_file($p)) return $default;
    $fh = fopen($p, 'rb');
    if (!$fh) return $default;
    flock($fh, LOCK_SH);
    $raw = stream_get_contents($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    $data = json_decode((string)$raw, true);
    return is_array($data) ? $data : $default;
}

function save(string $name, $data): void
{
    $p = store_path($name);
    $tmp = $p . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (file_put_contents($tmp, $json, LOCK_EX) === false) {
        throw new RuntimeException('Impossible d\'écrire dans data/. Vérifiez les permissions du dossier.');
    }
    rename($tmp, $p);
}

/** Read-modify-write under an exclusive lock. */
function update_store(string $name, callable $fn, $default = [])
{
    $lock = fopen(store_path($name) . '.lock', 'c');
    flock($lock, LOCK_EX);
    try {
        $data = load($name, $default);
        $result = $fn($data);
        save($name, $data);
        return $result;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function settings(): array
{
    static $s = null;
    if ($s === null) {
        $s = array_merge([
            'phone' => '+32 472 67 38 19',
            'email' => 'info@madibugroup.be',
            'address' => '1730 Asse',
            'area' => 'Bruxelles, Brabant flamand et toute la Belgique',
            'facebook' => 'https://www.facebook.com/MadibuGroupSPRL/',
            'instagram' => '',
            'linkedin' => '',
            'vat' => '',
            'hours' => 'Lun – Ven : 8h00 – 17h00',
            'notify_email' => 'info@madibugroup.be',
            'ga_id' => '',
            'pontaj_url' => '',
        ], load('settings'));
    }
    return $s;
}

function tel_href(string $phone): string
{
    return 'tel:' . preg_replace('~[^0-9+]~', '', $phone);
}

/* ------------------------------------------------------------------ */
/* Languages                                                           */
/* ------------------------------------------------------------------ */

const LANGS = ['fr', 'nl'];

/** Translated route segments. */
const ROUTES = [
    'fr' => ['services' => 'services', 'projects' => 'realisations', 'blog' => 'blog', 'contact' => 'contact', 'privacy' => 'confidentialite'],
    'nl' => ['services' => 'diensten', 'projects' => 'realisaties', 'blog' => 'blog', 'contact' => 'contact', 'privacy' => 'privacy'],
];

$GLOBALS['lang'] = 'fr';

function lang(): string
{
    return $GLOBALS['lang'];
}

function url(string $route = 'home', ?string $slug = null, ?string $lang = null): string
{
    $lang ??= lang();
    $prefix = $lang === 'fr' ? '' : '/' . $lang;
    if ($route === 'home') return $prefix === '' ? '/' : $prefix;
    $path = $prefix . '/' . ROUTES[$lang][$route];
    if ($slug !== null && $slug !== '') $path .= '/' . rawurlencode($slug);
    return $path;
}

/** Pick the current-language value of a {fr,nl} field, falling back to French. */
function tr($field): string
{
    if (!is_array($field)) return (string)$field;
    $v = trim((string)($field[lang()] ?? ''));
    return $v !== '' ? $v : (string)($field['fr'] ?? '');
}

function t(string $key): string
{
    static $strings = null;
    $strings ??= require __DIR__ . '/strings.php';
    return $strings[lang()][$key] ?? $strings['fr'][$key] ?? $key;
}

function format_date(string $iso): string
{
    $ts = strtotime($iso) ?: time();
    if (class_exists('IntlDateFormatter')) {
        $f = new IntlDateFormatter(lang() === 'nl' ? 'nl_BE' : 'fr_BE', IntlDateFormatter::LONG, IntlDateFormatter::NONE, 'Europe/Brussels');
        return (string)$f->format($ts);
    }
    return date('d/m/Y', $ts);
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

function services(): array
{
    static $s = null;
    return $s ??= require __DIR__ . '/services.php';
}

function categories(): array
{
    return [
        'renovation'   => ['fr' => 'Rénovation', 'nl' => 'Renovatie'],
        'construction' => ['fr' => 'Construction', 'nl' => 'Nieuwbouw'],
        'technique'    => ['fr' => 'Techniques', 'nl' => 'Technieken'],
        'toiture'      => ['fr' => 'Toiture & façade', 'nl' => 'Dak & gevel'],
        'menuiserie'   => ['fr' => 'Menuiserie', 'nl' => 'Schrijnwerk'],
        'commercial'   => ['fr' => 'Commerce & bureaux', 'nl' => 'Handel & kantoren'],
    ];
}

function projects(bool $onlyPublished = true): array
{
    $all = load('projects');
    if ($onlyPublished) $all = array_values(array_filter($all, fn($p) => !empty($p['published'])));
    usort($all, fn($a, $b) => [$b['sort'] ?? 0, $b['created'] ?? ''] <=> [$a['sort'] ?? 0, $a['created'] ?? '']);
    return $all;
}

function posts(bool $onlyPublished = true): array
{
    $all = load('posts');
    if ($onlyPublished) {
        $now = date('Y-m-d H:i:s');
        $all = array_values(array_filter($all, fn($p) => !empty($p['published']) && ($p['date'] ?? '') <= $now));
    }
    usort($all, fn($a, $b) => strcmp($b['date'] ?? '', $a['date'] ?? ''));
    return $all;
}

function find_by_slug(array $items, string $slug): ?array
{
    foreach ($items as $it) if (($it['slug'] ?? '') === $slug) return $it;
    return null;
}

function reading_minutes(string $text): int
{
    return max(1, (int)round(str_word_count(strip_tags($text)) / 200));
}

/** Image URL helper: prefer thumbnail when asked and available. */
function img(?array $image, bool $thumb = false): string
{
    if (!$image) return '';
    return (string)($thumb && !empty($image['thumb']) ? $image['thumb'] : ($image['src'] ?? ''));
}

function project_cover(array $p): ?array
{
    if (!empty($p['cover'])) return $p['cover'];
    return $p['images'][0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Markdown (small, safe subset)                                       */
/* ------------------------------------------------------------------ */

function md_inline(string $s): string
{
    $s = e($s);
    // images ![alt](src) — local paths or https only
    $s = preg_replace_callback('~!\[([^\]]*)\]\(((?:/|https://)[^\s)]+)\)~', fn($m) =>
        '<figure><img src="' . $m[2] . '" alt="' . $m[1] . '" loading="lazy">' . ($m[1] !== '' ? '<figcaption>' . $m[1] . '</figcaption>' : '') . '</figure>', $s);
    // links [text](url)
    $s = preg_replace_callback('~\[([^\]]+)\]\(((?:/|https?://|mailto:|tel:)[^\s)]+)\)~', function ($m) {
        $ext = preg_match('~^https?://~', html_entity_decode($m[2])) ? ' target="_blank" rel="noopener"' : '';
        return '<a href="' . $m[2] . '"' . $ext . '>' . $m[1] . '</a>';
    }, $s);
    $s = preg_replace('~\*\*(.+?)\*\*~s', '<strong>$1</strong>', $s);
    $s = preg_replace('~(?<![\*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)~s', '<em>$1</em>', $s);
    return $s;
}

function markdown(string $text): string
{
    $text = str_replace(["\r\n", "\r"], "\n", trim($text));
    $blocks = preg_split("~\n{2,}~", $text);
    $html = '';
    foreach ($blocks as $b) {
        $b = trim($b);
        if ($b === '') continue;
        $lines = explode("\n", $b);
        if (preg_match('~^(#{2,4})\s+(.+)$~', $b, $m) && count($lines) === 1) {
            $lvl = strlen($m[1]);
            $html .= "<h$lvl>" . md_inline($m[2]) . "</h$lvl>\n";
        } elseif (preg_match('~^[-*]\s~', $lines[0]) && count(array_filter($lines, fn($l) => !preg_match('~^[-*]\s~', $l))) === 0) {
            $html .= '<ul>' . implode('', array_map(fn($l) => '<li>' . md_inline(preg_replace('~^[-*]\s+~', '', $l)) . '</li>', $lines)) . "</ul>\n";
        } elseif (preg_match('~^\d+[.)]\s~', $lines[0]) && count(array_filter($lines, fn($l) => !preg_match('~^\d+[.)]\s~', $l))) === 0) {
            $html .= '<ol>' . implode('', array_map(fn($l) => '<li>' . md_inline(preg_replace('~^\d+[.)]\s+~', '', $l)) . '</li>', $lines)) . "</ol>\n";
        } elseif (str_starts_with($b, '>')) {
            $html .= '<blockquote><p>' . md_inline(implode(' ', array_map(fn($l) => ltrim(substr($l, 1)), $lines))) . "</p></blockquote>\n";
        } elseif (preg_match('~^!\[[^\]]*\]\([^)]+\)$~', $b)) {
            $html .= md_inline($b) . "\n";
        } else {
            $html .= '<p>' . implode("<br>\n", array_map('md_inline', $lines)) . "</p>\n";
        }
    }
    return $html;
}

function excerpt_from(string $md, int $len = 180): string
{
    $plain = trim(preg_replace('~\s+~', ' ', preg_replace('~[#*>\[\]!]|\([^)]*\)~', '', $md)));
    return mb_strlen($plain) > $len ? rtrim(mb_substr($plain, 0, $len), ' ,.;:') . '…' : $plain;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/**
 * Validate an uploaded image, re-encode it (removes EXIF/GPS data),
 * and create a large version and a thumbnail. Returns ['src','thumb','alt'].
 */
function process_upload(array $file, string $folder, string $alt = '', bool $localFile = false): array
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $msg = [
            UPLOAD_ERR_INI_SIZE => 'La photo dépasse la taille autorisée par le serveur.',
            UPLOAD_ERR_FORM_SIZE => 'La photo est trop lourde.',
            UPLOAD_ERR_PARTIAL => 'Le transfert a été interrompu. Réessayez.',
            UPLOAD_ERR_NO_FILE => 'Aucune photo reçue.',
        ][$file['error'] ?? 0] ?? 'Erreur de transfert.';
        throw new RuntimeException($msg);
    }
    if (!$localFile && !is_uploaded_file($file['tmp_name'])) {
        throw new RuntimeException('Fichier refusé.');
    }
    if ($file['size'] > 25 * 1024 * 1024) throw new RuntimeException('Photo trop lourde (25 Mo maximum).');

    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        throw new RuntimeException('Format non pris en charge (' . e((string)$mime) . '). Utilisez JPG, PNG ou WebP.');
    }
    if (!function_exists('imagecreatefromjpeg')) throw new RuntimeException('L\'extension PHP GD est requise pour traiter les photos.');

    @ini_set('memory_limit', '512M');
    $im = match ($mime) {
        'image/jpeg' => @imagecreatefromjpeg($file['tmp_name']),
        'image/png' => @imagecreatefrompng($file['tmp_name']),
        'image/webp' => @imagecreatefromwebp($file['tmp_name']),
    };
    if (!$im) throw new RuntimeException('Photo illisible.');

    if ($mime === 'image/jpeg' && function_exists('exif_read_data')) {
        $exif = @exif_read_data($file['tmp_name']);
        $o = (int)($exif['Orientation'] ?? 1);
        if ($o === 3) $im = imagerotate($im, 180, 0);
        elseif ($o === 6) $im = imagerotate($im, -90, 0);
        elseif ($o === 8) $im = imagerotate($im, 90, 0);
    }

    $folder = preg_replace('~[^a-z0-9\-]~', '', strtolower($folder)) ?: 'divers';
    $dir = UPLOAD_DIR . '/' . $folder;
    if (!is_dir($dir) && !mkdir($dir, 0775, true)) throw new RuntimeException('Impossible de créer le dossier uploads/' . $folder);

    $base = date('Ymd') . '-' . bin2hex(random_bytes(5));
    $ext = function_exists('imagewebp') ? 'webp' : 'jpg';
    $large = "$base.$ext";
    $thumb = "$base-thumb.$ext";
    write_resized($im, "$dir/$large", 2000, $ext);
    write_resized($im, "$dir/$thumb", 720, $ext);
    imagedestroy($im);

    return ['src' => UPLOAD_URL . "/$folder/$large", 'thumb' => UPLOAD_URL . "/$folder/$thumb", 'alt' => $alt];
}

function write_resized(GdImage $im, string $path, int $max, string $ext): void
{
    $w = imagesx($im);
    $h = imagesy($im);
    $scale = min(1, $max / max($w, $h));
    $nw = max(1, (int)round($w * $scale));
    $nh = max(1, (int)round($h * $scale));
    $out = imagecreatetruecolor($nw, $nh);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagecopyresampled($out, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    $ok = $ext === 'webp' ? imagewebp($out, $path, 80) : imagejpeg($out, $path, 82);
    imagedestroy($out);
    if (!$ok) throw new RuntimeException('Impossible d\'enregistrer la photo.');
}

/** Delete an uploaded image (only files inside uploads/). */
function delete_image(?array $image): void
{
    if (!$image) return;
    foreach (['src', 'thumb'] as $k) {
        $u = $image[$k] ?? '';
        if (str_starts_with($u, UPLOAD_URL . '/')) {
            $p = realpath(ROOT . $u);
            if ($p && str_starts_with($p, realpath(UPLOAD_DIR) . DIRECTORY_SEPARATOR)) @unlink($p);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Sessions & CSRF                                                     */
/* ------------------------------------------------------------------ */

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('madibu_sess');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function csrf_token(): string
{
    start_session();
    return $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

function check_csrf(): void
{
    start_session();
    if (!hash_equals($_SESSION['csrf'] ?? '', (string)($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('Session expirée. Rechargez la page et réessayez.');
    }
}

function client_ip(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function clean_line(string $s, int $max = 200): string
{
    return mb_substr(trim(str_replace(["\r", "\n", "\0"], ' ', $s)), 0, $max);
}
