<?php
declare(strict_types=1);
require __DIR__ . '/app/bootstrap.php';
require __DIR__ . '/app/partials.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = '/' . trim(rawurldecode($path), '/');

/* Static files when using the PHP built-in server (php -S). */
if (PHP_SAPI === 'cli-server') {
    if (preg_match('~^/(data|app)(/|$)~', $path)) { http_response_code(403); exit; }
    if ($path === '/admin' || str_starts_with($path, '/admin/')) { require __DIR__ . '/admin/index.php'; return; }
    if ($path !== '/' && is_file(__DIR__ . $path)) return false;
}

/* ---------- old WordPress addresses → new pages (301) ---------- */
$legacy = legacy_redirect($path);
if ($legacy) redirect($legacy, 301);

/* ---------- language ---------- */
$segments = array_values(array_filter(explode('/', $path), 'strlen'));
if (($segments[0] ?? '') === 'nl') {
    $GLOBALS['lang'] = 'nl';
    array_shift($segments);
}
$routeMap = array_flip(ROUTES[lang()]);
$first = $segments[0] ?? '';
$route = $first === '' ? 'home' : ($routeMap[$first] ?? $first);
$slug = $segments[1] ?? null;
if (count($segments) > 2) $route = '404';

$view = null;
$vars = [];
$status = 200;

switch ($route) {
    case 'home':
        $view = 'home';
        break;

    case 'services':
        if ($slug === null) { $view = 'services'; break; }
        $svc = find_by_slug(services(), $slug);
        if ($svc) { $view = 'service'; $vars['svc'] = $svc; }
        break;

    case 'projects':
        if ($slug === null) { $view = 'projects'; break; }
        $p = find_by_slug(projects(), $slug);
        if ($p) { $view = 'project'; $vars['p'] = $p; }
        break;

    case 'blog':
        if ($slug === null) { $view = 'blog'; break; }
        $post = find_by_slug(posts(), $slug);
        if ($post) { $view = 'post'; $vars['post'] = $post; }
        break;

    case 'contact':
        if ($slug !== null) break;
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $vars = handle_contact();
        }
        $view = 'contact';
        break;

    case 'privacy':
        if ($slug === null) $view = 'privacy';
        break;

    case 'newsletter':
        if ($_SERVER['REQUEST_METHOD'] === 'POST') handle_newsletter();
        redirect(url('home'));

    case 'pontaj':
        $view = 'pontaj';
        break;

    case 'feed.xml':
        render_feed();
        exit;

    case 'sitemap.xml':
        render_sitemap();
        exit;

    case 'robots.txt':
        header('Content-Type: text/plain; charset=utf-8');
        echo "User-agent: *\nDisallow: /admin/\nDisallow: /pontaj\nSitemap: " . base_url() . "/sitemap.xml\n";
        exit;
}

if ($view === null) {
    $status = 404;
    $view = '404';
}

http_response_code($status);
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
render($view, $vars);

/* ================================================================== */

function render(string $view, array $vars = []): void
{
    extract($vars);
    ob_start();
    require __DIR__ . "/app/views/$view.php";
    $content = ob_get_clean();
    require __DIR__ . '/app/views/layout.php';
}

function legacy_redirect(string $path): ?string
{
    $p = rtrim($path, '/');
    if ($p === '') return null;
    // /2023/08/12/slug → /blog/slug
    if (preg_match('~^/\d{4}/\d{2}/\d{2}/([^/]+)$~', $p, $m)) {
        foreach (posts() as $po) {
            if ($po['slug'] === $m[1] || in_array($m[1], $po['old_slugs'] ?? [], true)) return url('blog', $po['slug'], 'fr');
        }
        return url('blog', null, 'fr');
    }
    if (preg_match('~^/services/([^/]+)$~', $p, $m)) {
        foreach (services() as $s) {
            if ($m[1] !== $s['slug'] && in_array($m[1], $s['old'], true)) return url('services', $s['slug'], 'fr');
        }
    }
    if (preg_match('~^/(?:projects|re_projects|portfolio)/([^/]+)$~', $p, $m)) {
        foreach (projects() as $pr) {
            if ($pr['slug'] === $m[1] || in_array($m[1], $pr['old_slugs'] ?? [], true)) return url('projects', $pr['slug'], 'fr');
        }
        return url('projects', null, 'fr');
    }
    $map = [
        '/photos-galllery' => url('projects', null, 'fr'),
        '/projects' => url('projects', null, 'fr'),
        '/realisation' => url('projects', null, 'fr'),
        '/politique-de-confidentialite' => url('privacy', null, 'fr'),
        '/home' => '/',
        '/home-style-1' => '/',
        '/contact-style-1' => url('contact', null, 'fr'),
        '/contact-style-2' => url('contact', null, 'fr'),
        '/our-services-style-2' => url('services', null, 'fr'),
        '/blog-2-columns' => url('blog', null, 'fr'),
        '/blog-3-columns' => url('blog', null, 'fr'),
        '/blog-left-sidebar' => url('blog', null, 'fr'),
    ];
    if (isset($map[$p])) return $map[$p];
    // trailing slash → canonical without slash
    if ($path !== '/' && str_ends_with($_SERVER['REQUEST_URI'] ?? '', '/') && !str_starts_with($path, '/admin')) {
        return $p;
    }
    return null;
}

function handle_contact(): array
{
    $in = fn($k, $max = 200) => clean_line((string)($_POST[$k] ?? ''), $max);
    $data = [
        'name' => $in('name'),
        'email' => $in('email'),
        'phone' => $in('phone', 40),
        'city' => $in('city', 80),
        'type' => $in('type', 80),
        'budget' => $in('budget', 60),
        'message' => mb_substr(trim((string)($_POST['message'] ?? '')), 0, 5000),
    ];
    $errors = [];
    if ($data['name'] === '') $errors['name'] = true;
    if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) $errors['email'] = true;
    if ($data['phone'] === '') $errors['phone'] = true;
    if ($data['message'] === '') $errors['message'] = true;
    if (empty($_POST['consent'])) $errors['consent'] = true;

    // Anti-spam: honeypot + minimum fill time
    $isBot = !empty($_POST['website']) || (time() - (int)($_POST['t'] ?? 0)) < 3;

    if ($errors) return ['form' => $data, 'errors' => $errors];
    if ($isBot) redirect(url('contact') . '?sent=1#form', 303);

    $data['id'] = bin2hex(random_bytes(6));
    $data['date'] = date('Y-m-d H:i:s');
    $data['lang'] = lang();
    $data['read'] = false;
    update_store('messages', function (&$all) use ($data) { array_unshift($all, $data); });

    $s = settings();
    $to = $s['notify_email'] ?: $s['email'];
    if ($to) {
        $body = "Nouvelle demande via madibugroup.be\n\n"
            . "Nom : {$data['name']}\nE-mail : {$data['email']}\nTéléphone : {$data['phone']}\n"
            . "Commune : {$data['city']}\nTravaux : {$data['type']}\nBudget : {$data['budget']}\n\n{$data['message']}\n";
        $headers = "From: Madibu Group <no-reply@" . preg_replace('~^www\.~', '', $_SERVER['HTTP_HOST'] ?? 'madibugroup.be') . ">\r\n"
            . "Reply-To: {$data['name']} <{$data['email']}>\r\n"
            . "Content-Type: text/plain; charset=UTF-8";
        @mail($to, '=?UTF-8?B?' . base64_encode('Demande de devis – ' . $data['name']) . '?=', $body, $headers);
    }
    redirect(url('contact') . '?sent=1#form', 303);
}

function handle_newsletter(): never
{
    $email = clean_line((string)($_POST['email'] ?? ''), 160);
    $back = (string)($_POST['back'] ?? '/');
    if (!str_starts_with($back, '/') || str_starts_with($back, '//')) $back = '/';
    $back = preg_replace('~[?#].*$~', '', $back);
    if (!empty($_POST['website']) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        redirect($back . '?news=err#newsletter', 303);
    }
    update_store('subscribers', function (&$all) use ($email) {
        foreach ($all as $s) if (strcasecmp($s['email'], $email) === 0) return;
        $all[] = ['email' => $email, 'date' => date('Y-m-d H:i:s'), 'lang' => lang()];
    });
    redirect($back . '?news=ok#newsletter', 303);
}

function render_feed(): void
{
    header('Content-Type: application/rss+xml; charset=utf-8');
    $b = base_url();
    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    echo '<rss version="2.0"><channel><title>Madibu Group – Journal</title><link>' . $b . '/blog</link><description>' . e(t('blog_lede')) . "</description><language>fr-be</language>\n";
    foreach (array_slice(posts(), 0, 20) as $p) {
        echo '<item><title>' . e(tr($p['title'])) . '</title><link>' . $b . url('blog', $p['slug']) . '</link><guid>' . $b . url('blog', $p['slug']) . '</guid><pubDate>' . date(DATE_RSS, strtotime($p['date'])) . '</pubDate><description>' . e(tr($p['excerpt']) ?: excerpt_from(tr($p['body']))) . "</description></item>\n";
    }
    echo '</channel></rss>';
}

function render_sitemap(): void
{
    header('Content-Type: application/xml; charset=utf-8');
    $b = base_url();
    $urls = [];
    foreach (LANGS as $l) {
        foreach (['home', 'services', 'projects', 'blog', 'contact'] as $r) $urls[] = url($r, null, $l);
        foreach (services() as $s) $urls[] = url('services', $s['slug'], $l);
        foreach (projects() as $p) $urls[] = url('projects', $p['slug'], $l);
        foreach (posts() as $p) $urls[] = url('blog', $p['slug'], $l);
    }
    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n";
    foreach ($urls as $u) echo '<url><loc>' . e($b . $u) . "</loc></url>\n";
    echo '</urlset>';
}
