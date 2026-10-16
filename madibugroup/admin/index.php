<?php
/**
 * Madibu Group — administration.
 * Projets (photos, avant/après), journal (blog), messages, abonnés, réglages.
 */
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/bootstrap.php';

start_session();
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'");

$a = preg_replace('~[^a-z_\-]~', '', (string)($_GET['a'] ?? 'dashboard'));
$isPost = $_SERVER['REQUEST_METHOD'] === 'POST';
$settings = load('settings');

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

if (empty($settings['admin_hash'])) {
    admin_setup($settings, $isPost);
    exit;
}

if ($a === 'logout') {
    if ($isPost) check_csrf();
    $_SESSION = [];
    session_destroy();
    redirect('/admin/');
}

$logged = !empty($_SESSION['admin']) && (time() - ($_SESSION['admin_seen'] ?? 0)) < 8 * 3600;
if (!$logged) {
    admin_login($settings, $isPost);
    exit;
}
$_SESSION['admin_seen'] = time();

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

if ($isPost) check_csrf();

try {
    switch ($a) {
        case 'projects': page_projects(); break;
        case 'project': $isPost ? save_project() : page_project_form(); break;
        case 'project-delete': if ($isPost) delete_project(); redirect('?a=projects');
        case 'project-move': if ($isPost) move_project(); redirect('?a=projects');
        case 'upload': if ($isPost) upload_json(); break;
        case 'posts': page_posts(); break;
        case 'post': $isPost ? save_post() : page_post_form(); break;
        case 'post-delete': if ($isPost) delete_post(); redirect('?a=posts');
        case 'preview': if ($isPost) { header('Content-Type: text/html; charset=utf-8'); echo markdown((string)($_POST['md'] ?? '')); } break;
        case 'messages': $isPost ? messages_action() : page_messages(); break;
        case 'subscribers': $isPost ? subscribers_action() : page_subscribers(); break;
        case 'export-subscribers': export_subscribers(); break;
        case 'settings': $isPost ? save_settings() : page_settings(); break;
        case 'optimize': $isPost ? optimize_batch() : page_optimize(); break;
        default: page_dashboard();
    }
} catch (Throwable $ex) {
    if (($_SERVER['HTTP_ACCEPT'] ?? '') === 'application/json') {
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['error' => $ex->getMessage()]);
        exit;
    }
    flash($ex->getMessage(), 'error');
    redirect($_SERVER['HTTP_REFERER'] ?? '?');
}

/* ================================================================== */
/* Layout                                                              */
/* ================================================================== */

function flash(string $msg, string $type = 'ok'): void
{
    $_SESSION['flash'][] = [$type, $msg];
}

function head(string $title, string $active = ''): void
{
    $msgs = load('messages');
    $unread = count(array_filter($msgs, fn($m) => empty($m['read'])));
    $nav = [
        'dashboard' => 'Tableau de bord',
        'projects' => 'Réalisations',
        'posts' => 'Journal',
        'messages' => 'Messages' . ($unread ? " <span class=\"pill\">$unread</span>" : ''),
        'subscribers' => 'Abonnés',
        'settings' => 'Réglages',
    ];
    ?><!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title><?= e($title) ?> · Admin Madibu Group</title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/admin.css?v=1">
<script src="/assets/admin.js?v=1" defer></script>
</head>
<body>
<header class="bar">
  <a class="brand" href="?"><svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="currentColor"/><path d="M10 37V12l14 14 14-14v25" fill="none" stroke="var(--bg)" stroke-width="4"/></svg> Madibu <span>admin</span></a>
  <nav class="tabs">
    <?php foreach ($nav as $k => $label): ?><a href="?a=<?= $k ?>"<?= $active === $k ? ' aria-current="page"' : '' ?>><?= $label ?></a><?php endforeach; ?>
  </nav>
  <div class="bar-end">
    <a href="/" target="_blank" rel="noopener">Voir le site ↗</a>
    <form method="post" action="?a=logout"><?= csrf_field() ?><button class="linkish" type="submit">Déconnexion</button></form>
  </div>
</header>
<main class="main">
<?php foreach ($_SESSION['flash'] ?? [] as [$type, $msg]): ?>
  <p class="flash flash-<?= e($type) ?>" role="status"><?= e($msg) ?></p>
<?php endforeach; unset($_SESSION['flash']);
}

function foot(): void
{
    echo '</main><input type="hidden" id="csrf" value="' . e(csrf_token()) . '"></body></html>';
}

function bare_page(string $title, callable $body): void
{
    ?><!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title><?= e($title) ?> · Madibu Group</title>
<link rel="stylesheet" href="/assets/admin.css?v=1"></head>
<body class="auth"><main class="auth-card">
<svg class="auth-logo" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="currentColor"/><path d="M10 37V12l14 14 14-14v25" fill="none" stroke="var(--bg)" stroke-width="4"/></svg>
<?php $body(); ?>
</main></body></html><?php
}

/* ================================================================== */
/* Setup & login                                                       */
/* ================================================================== */

function admin_setup(array $settings, bool $isPost): void
{
    $codeFile = DATA_DIR . '/setup-code.txt';
    if (!is_file($codeFile)) {
        if (!is_writable(DATA_DIR)) {
            bare_page('Installation', fn() => print('<h1>Installation</h1><p class="flash flash-error">Le dossier <code>data/</code> doit être accessible en écriture (permissions 755 ou 775).</p>'));
            return;
        }
        file_put_contents($codeFile, strtoupper(bin2hex(random_bytes(4))) . "\n");
    }
    $error = '';
    if ($isPost) {
        check_csrf();
        $code = strtoupper(trim((string)($_POST['code'] ?? '')));
        $pw = (string)($_POST['password'] ?? '');
        $pw2 = (string)($_POST['password2'] ?? '');
        if (!hash_equals(trim((string)file_get_contents($codeFile)), $code)) $error = 'Code d\'installation incorrect.';
        elseif (mb_strlen($pw) < 10) $error = 'Le mot de passe doit contenir au moins 10 caractères.';
        elseif ($pw !== $pw2) $error = 'Les deux mots de passe ne correspondent pas.';
        else {
            $settings['admin_hash'] = password_hash($pw, PASSWORD_DEFAULT);
            save('settings', $settings);
            @unlink($codeFile);
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['admin_seen'] = time();
            flash('Mot de passe enregistré. Bienvenue dans l\'administration.');
            redirect('/admin/');
        }
    }
    bare_page('Installation', function () use ($error) { ?>
      <h1>Créer le mot de passe administrateur</h1>
      <p class="muted">Pour prouver que vous gérez le serveur, ouvrez le fichier <code>data/setup-code.txt</code> dans le gestionnaire de fichiers de votre hébergement et recopiez le code ci-dessous.</p>
      <?php if ($error): ?><p class="flash flash-error"><?= e($error) ?></p><?php endif; ?>
      <form method="post" class="stack">
        <?= csrf_field() ?>
        <label>Code d'installation <input name="code" required autocomplete="off" autocapitalize="characters" id="setup-code"></label>
        <label>Nouveau mot de passe (10 caractères minimum) <input name="password" type="password" required minlength="10" autocomplete="new-password" id="setup-pw"></label>
        <label>Confirmer le mot de passe <input name="password2" type="password" required minlength="10" autocomplete="new-password" id="setup-pw2"></label>
        <button class="btn btn-primary" type="submit">Enregistrer</button>
      </form>
    <?php });
}

function admin_login(array $settings, bool $isPost): void
{
    $ip = hash('sha256', client_ip());
    $attempts = load('login-attempts');
    $mine = array_values(array_filter($attempts[$ip] ?? [], fn($t) => $t > time() - 900));
    $locked = count($mine) >= 6;
    $error = '';
    if ($isPost) {
        check_csrf();
        if ($locked) {
            $error = 'Trop de tentatives. Réessayez dans 15 minutes.';
        } elseif (password_verify((string)($_POST['password'] ?? ''), $settings['admin_hash'])) {
            unset($attempts[$ip]);
            save('login-attempts', $attempts);
            session_regenerate_id(true);
            $_SESSION['admin'] = true;
            $_SESSION['admin_seen'] = time();
            if (password_needs_rehash($settings['admin_hash'], PASSWORD_DEFAULT)) {
                $settings['admin_hash'] = password_hash((string)$_POST['password'], PASSWORD_DEFAULT);
                save('settings', $settings);
            }
            redirect('/admin/');
        } else {
            $mine[] = time();
            $attempts[$ip] = $mine;
            save('login-attempts', $attempts);
            usleep(400000);
            $error = 'Mot de passe incorrect.';
        }
    }
    bare_page('Connexion', function () use ($error) { ?>
      <h1>Administration</h1>
      <p class="muted">Madibu Group</p>
      <?php if ($error): ?><p class="flash flash-error"><?= e($error) ?></p><?php endif; ?>
      <form method="post" class="stack">
        <?= csrf_field() ?>
        <label>Mot de passe <input name="password" type="password" required autofocus autocomplete="current-password" id="login-pw"></label>
        <button class="btn btn-primary" type="submit">Se connecter</button>
      </form>
    <?php });
}

/* ================================================================== */
/* Dashboard                                                           */
/* ================================================================== */

function page_dashboard(): void
{
    $projects = load('projects');
    $posts = load('posts');
    $msgs = load('messages');
    $subs = load('subscribers');
    $unread = array_filter($msgs, fn($m) => empty($m['read']));
    $legacy = count(array_filter(all_images($projects), fn($im) => str_starts_with($im['src'] ?? '', '/wp-content/') && empty($im['legacy_failed'])));
    head('Tableau de bord', 'dashboard'); ?>
    <div class="page-top"><h1>Tableau de bord</h1>
      <div class="row-actions"><a class="btn btn-primary" href="?a=project">+ Nouvelle réalisation</a><a class="btn" href="?a=post">+ Nouvel article</a></div></div>
    <div class="stats">
      <a href="?a=projects" class="stat"><b><?= count($projects) ?></b><span>réalisations</span></a>
      <a href="?a=posts" class="stat"><b><?= count($posts) ?></b><span>articles</span></a>
      <a href="?a=messages" class="stat<?= $unread ? ' stat-hot' : '' ?>"><b><?= count($unread) ?></b><span>messages non lus</span></a>
      <a href="?a=subscribers" class="stat"><b><?= count($subs) ?></b><span>abonnés</span></a>
    </div>
    <?php if ($legacy): ?>
      <div class="notice"><b><?= $legacy ?> photos</b> viennent encore de l'ancien WordPress (<code>wp-content</code>). Optimisez-les pour un site plus rapide.<a class="btn btn-sm" href="?a=optimize">Optimiser les photos</a></div>
    <?php endif; ?>
    <section class="panel">
      <div class="panel-head"><h2>Dernières demandes</h2><a href="?a=messages">Tout voir</a></div>
      <?php if (!$msgs): ?><p class="muted">Aucune demande pour le moment. Elles arrivent ici depuis le formulaire de contact.</p><?php endif; ?>
      <ul class="list">
        <?php foreach (array_slice($msgs, 0, 5) as $m): ?>
          <li class="<?= empty($m['read']) ? 'is-unread' : '' ?>"><a href="?a=messages#m-<?= e($m['id']) ?>"><b><?= e($m['name']) ?></b> · <?= e($m['type'] ?? '') ?> · <?= e($m['city'] ?? '') ?><span class="muted"><?= e(date('d/m/Y H:i', strtotime($m['date']))) ?></span></a></li>
        <?php endforeach; ?>
      </ul>
    </section>
    <?php foot();
}

/* ================================================================== */
/* Projects                                                            */
/* ================================================================== */

function all_images(array $projects): array
{
    $out = [];
    foreach ($projects as $p) {
        foreach (['cover', 'before', 'after'] as $k) if (!empty($p[$k])) $out[] = $p[$k];
        foreach ($p['images'] ?? [] as $im) $out[] = $im;
    }
    return $out;
}

function page_projects(): void
{
    $list = projects(false);
    $cats = categories();
    head('Réalisations', 'projects'); ?>
    <div class="page-top"><h1>Réalisations</h1><a class="btn btn-primary" href="?a=project">+ Nouvelle réalisation</a></div>
    <p class="muted">L'ordre ci-dessous est celui du site (flèches ↑ ↓). Le projet « À la une » donne la grande photo de la page d'accueil.</p>
    <div class="cards">
      <?php foreach ($list as $i => $p): $c = project_cover($p); ?>
        <article class="card">
          <a class="card-media" href="?a=project&amp;id=<?= e($p['id']) ?>"><?php if ($c): ?><img src="<?= e(img($c, true)) ?>" alt="" loading="lazy"><?php endif; ?></a>
          <div class="card-body">
            <div class="tags">
              <?php if (empty($p['published'])): ?><span class="tag tag-muted">Brouillon</span><?php endif; ?>
              <?php if (!empty($p['featured'])): ?><span class="tag tag-accent">À la une</span><?php endif; ?>
              <?php if (($p['status'] ?? '') === 'ongoing'): ?><span class="tag">En cours</span><?php endif; ?>
            </div>
            <h2><a href="?a=project&amp;id=<?= e($p['id']) ?>"><?= e(tr($p['title'])) ?></a></h2>
            <p class="muted"><?= e(implode(' · ', array_filter([tr($cats[$p['category'] ?? ''] ?? ''), $p['commune'] ?? '', $p['year'] ?? '']))) ?> · <?= count($p['images'] ?? []) ?> photos</p>
            <div class="row-actions">
              <a class="btn btn-sm" href="?a=project&amp;id=<?= e($p['id']) ?>">Modifier</a>
              <form method="post" action="?a=project-move"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['id']) ?>"><input type="hidden" name="dir" value="up"><button class="btn btn-sm" type="submit" title="Monter"<?= $i === 0 ? ' disabled' : '' ?>>↑</button></form>
              <form method="post" action="?a=project-move"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['id']) ?>"><input type="hidden" name="dir" value="down"><button class="btn btn-sm" type="submit" title="Descendre"<?= $i === count($list) - 1 ? ' disabled' : '' ?>>↓</button></form>
              <?php if (!empty($p['published'])): ?><a class="btn btn-sm" href="<?= e(url('projects', $p['slug'], 'fr')) ?>" target="_blank" rel="noopener">Voir ↗</a><?php endif; ?>
            </div>
          </div>
        </article>
      <?php endforeach; ?>
    </div>
    <?php foot();
}

function find_index(array $items, string $id): ?int
{
    foreach ($items as $i => $it) if (($it['id'] ?? '') === $id) return $i;
    return null;
}

function unique_slug(array $items, string $slug, string $selfId): string
{
    $base = $slug ?: 'projet';
    $n = 1;
    $taken = array_column(array_filter($items, fn($x) => ($x['id'] ?? '') !== $selfId), 'slug');
    while (in_array($slug, $taken, true)) $slug = $base . '-' . (++$n);
    return $slug;
}

function page_project_form(): void
{
    $id = (string)($_GET['id'] ?? '');
    $p = $id !== '' ? (find_by_id(load('projects'), $id)) : null;
    if ($id !== '' && !$p) { flash('Projet introuvable.', 'error'); redirect('?a=projects'); }
    $p ??= ['id' => '', 'slug' => '', 'title' => ['fr' => '', 'nl' => ''], 'summary' => ['fr' => '', 'nl' => ''], 'body' => ['fr' => '', 'nl' => ''],
        'category' => 'renovation', 'commune' => '', 'year' => date('Y'), 'surface' => '', 'status' => 'done', 'featured' => false, 'published' => true, 'images' => []];
    $isNew = $p['id'] === '';
    $cover = $p['cover']['src'] ?? '';
    $before = $p['before']['src'] ?? '';
    $after = $p['after']['src'] ?? '';
    head($isNew ? 'Nouvelle réalisation' : tr($p['title']), 'projects'); ?>
    <div class="page-top">
      <h1><?= $isNew ? 'Nouvelle réalisation' : e(tr($p['title'])) ?></h1>
      <?php if (!$isNew && !empty($p['published'])): ?><a class="btn" href="<?= e(url('projects', $p['slug'], 'fr')) ?>" target="_blank" rel="noopener">Voir sur le site ↗</a><?php endif; ?>
    </div>
    <form method="post" action="?a=project<?= $isNew ? '' : '&amp;id=' . e($p['id']) ?>" enctype="multipart/form-data" class="editor" id="project-form">
      <?= csrf_field() ?>
      <input type="hidden" name="id" value="<?= e($p['id']) ?>">
      <div class="editor-main">
        <section class="panel">
          <div class="lang-tabs" data-tabs>
            <button type="button" aria-pressed="true" data-tab="fr">Français</button>
            <button type="button" aria-pressed="false" data-tab="nl">Nederlands <small>(optionnel)</small></button>
          </div>
          <?php foreach (['fr', 'nl'] as $l): ?>
          <div class="stack" data-pane="<?= $l ?>"<?= $l === 'nl' ? ' hidden' : '' ?>>
            <label>Titre<?= $l === 'fr' ? ' *' : '' ?> <input name="title_<?= $l ?>" id="p-title-<?= $l ?>" value="<?= e($p['title'][$l] ?? '') ?>"<?= $l === 'fr' ? ' required' : '' ?> placeholder="Ex. : Rénovation complète rue du Sceptre"></label>
            <label>Résumé <small>une ou deux phrases, affichées sous le titre</small><textarea name="summary_<?= $l ?>" id="p-summary-<?= $l ?>" rows="2"><?= e($p['summary'][$l] ?? '') ?></textarea></label>
            <label>Description du chantier <small>travaux réalisés, défis, matériaux…</small>
              <?= md_toolbar("p-body-$l") ?>
              <textarea name="body_<?= $l ?>" id="p-body-<?= $l ?>" rows="10" class="md"><?= e($p['body'][$l] ?? '') ?></textarea></label>
            <?php if ($l === 'nl'): ?><p class="muted">Laissez vide pour afficher le texte français sur la version néerlandaise.</p><?php endif; ?>
          </div>
          <?php endforeach; ?>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Photos <span class="muted" id="photo-count">(<?= count($p['images'] ?? []) ?>)</span></h2></div>
          <?php if ($isNew): ?>
            <p class="muted">Enregistrez d'abord le projet, puis ajoutez les photos.</p>
            <label>Photos (vous pouvez en choisir plusieurs) <input type="file" name="photos[]" accept="image/*" multiple id="p-photos-new"></label>
          <?php else: ?>
          <div class="dropzone" data-upload data-project="<?= e($p['id']) ?>">
            <input type="file" accept="image/*" multiple id="p-photos" aria-label="Ajouter des photos">
            <p><b>Glissez vos photos ici</b> ou <span class="linkish">choisissez-les</span>. Depuis un téléphone : appareil photo ou galerie.</p>
            <div class="progress" hidden><span></span></div>
            <p class="upload-status muted" role="status"></p>
          </div>
          <p class="muted">Faites glisser les photos pour changer leur ordre. Cochez la couverture, et éventuellement une photo « avant » et une « après » pour le comparateur.</p>
          <div class="photo-grid" id="photo-grid">
            <?php foreach ($p['images'] ?? [] as $i => $im): $src = $im['src']; ?>
              <figure class="photo" draggable="true">
                <img src="<?= e(img($im, true)) ?>" alt="" loading="lazy">
                <input type="hidden" name="img_src[]" value="<?= e($src) ?>">
                <input type="hidden" name="img_thumb[]" value="<?= e($im['thumb'] ?? $src) ?>">
                <input name="img_alt[]" value="<?= e($im['alt'] ?? '') ?>" placeholder="Légende (optionnelle)" aria-label="Légende">
                <div class="photo-roles">
                  <label><input type="radio" name="cover" value="<?= e($src) ?>"<?= $cover === $src ? ' checked' : '' ?>> Couverture</label>
                  <label><input type="radio" name="before" value="<?= e($src) ?>"<?= $before === $src ? ' checked' : '' ?>> Avant</label>
                  <label><input type="radio" name="after" value="<?= e($src) ?>"<?= $after === $src ? ' checked' : '' ?>> Après</label>
                  <label class="danger"><input type="checkbox" name="img_delete[]" value="<?= e($src) ?>"> Supprimer</label>
                </div>
              </figure>
            <?php endforeach; ?>
          </div>
          <?php if ($p['images'] ?? []): ?>
          <div class="row-actions"><label class="inline"><input type="radio" name="before" value=""<?= $before === '' ? ' checked' : '' ?>> Pas d'avant/après</label></div>
          <?php endif; ?>
          <?php endif; ?>
        </section>
      </div>

      <aside class="editor-side">
        <section class="panel stack">
          <label class="switch"><input type="checkbox" name="published" value="1"<?= !empty($p['published']) ? ' checked' : '' ?>> Publié sur le site</label>
          <label class="switch"><input type="checkbox" name="featured" value="1"<?= !empty($p['featured']) ? ' checked' : '' ?>> À la une (grande photo de l'accueil)</label>
          <label>Statut
            <select name="status" id="p-status"><option value="done"<?= ($p['status'] ?? '') === 'done' ? ' selected' : '' ?>>Terminé</option><option value="ongoing"<?= ($p['status'] ?? '') === 'ongoing' ? ' selected' : '' ?>>Chantier en cours</option></select></label>
          <label>Type de projet
            <select name="category" id="p-category"><?php foreach (categories() as $k => $c): ?><option value="<?= e($k) ?>"<?= ($p['category'] ?? '') === $k ? ' selected' : '' ?>><?= e($c['fr']) ?></option><?php endforeach; ?></select></label>
          <label>Commune <input name="commune" id="p-commune" value="<?= e($p['commune'] ?? '') ?>" placeholder="Ex. : Uccle"></label>
          <div class="two">
            <label>Année <input name="year" id="p-year" value="<?= e($p['year'] ?? '') ?>" inputmode="numeric" maxlength="4"></label>
            <label>Surface <input name="surface" id="p-surface" value="<?= e($p['surface'] ?? '') ?>" placeholder="120 m²"></label>
          </div>
          <label>Adresse de la page <small>/realisations/…</small><input name="slug" id="p-slug" value="<?= e($p['slug']) ?>" placeholder="automatique"></label>
          <button class="btn btn-primary btn-block" type="submit">Enregistrer</button>
        </section>
        <?php if (!$isNew): ?>
        <section class="panel">
          <p class="muted">Supprimer définitivement ce projet et ses photos.</p>
          <button class="btn btn-danger btn-sm" type="submit" form="delete-form" data-confirm="Supprimer « <?= e(tr($p['title'])) ?> » et toutes ses photos ?">Supprimer le projet</button>
        </section>
        <?php endif; ?>
      </aside>
    </form>
    <?php if (!$isNew): ?>
    <form method="post" action="?a=project-delete" id="delete-form"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['id']) ?>"></form>
    <?php endif;
    foot();
}

function find_by_id(array $items, string $id): ?array
{
    $i = find_index($items, $id);
    return $i === null ? null : $items[$i];
}

function md_toolbar(string $target): string
{
    $b = fn($cmd, $label, $title) => '<button type="button" data-md="' . $cmd . '" title="' . $title . '">' . $label . '</button>';
    return '<span class="md-bar" data-target="' . e($target) . '">'
        . $b('h2', 'Titre', 'Intertitre') . $b('h3', 'Sous-titre', 'Sous-titre') . $b('b', '<b>G</b>', 'Gras') . $b('i', '<i>I</i>', 'Italique')
        . $b('ul', '• Liste', 'Liste à puces') . $b('quote', '❝', 'Citation') . $b('link', 'Lien', 'Lien') . $b('img', 'Photo', 'Insérer une photo')
        . $b('preview', 'Aperçu', 'Aperçu') . '</span>';
}

function save_project(): void
{
    $id = (string)($_POST['id'] ?? '');
    $title = clean_line((string)($_POST['title_fr'] ?? ''));
    if ($title === '') throw new RuntimeException('Le titre en français est obligatoire.');

    $savedId = update_store('projects', function (&$all) use ($id, $title) {
        $i = $id !== '' ? find_index($all, $id) : null;
        if ($id !== '' && $i === null) throw new RuntimeException('Projet introuvable.');
        $p = $i !== null ? $all[$i] : ['id' => bin2hex(random_bytes(6)), 'images' => [], 'created' => date('Y-m-d H:i:s'), 'sort' => 0];

        $p['title'] = ['fr' => $title, 'nl' => clean_line((string)($_POST['title_nl'] ?? ''))];
        $p['summary'] = ['fr' => clean_line((string)($_POST['summary_fr'] ?? ''), 400), 'nl' => clean_line((string)($_POST['summary_nl'] ?? ''), 400)];
        $p['body'] = ['fr' => mb_substr((string)($_POST['body_fr'] ?? ''), 0, 20000), 'nl' => mb_substr((string)($_POST['body_nl'] ?? ''), 0, 20000)];
        $p['category'] = array_key_exists($_POST['category'] ?? '', categories()) ? $_POST['category'] : 'renovation';
        $p['status'] = ($_POST['status'] ?? '') === 'ongoing' ? 'ongoing' : 'done';
        $p['commune'] = clean_line((string)($_POST['commune'] ?? ''), 80);
        $p['year'] = preg_replace('~\D~', '', (string)($_POST['year'] ?? ''));
        $p['surface'] = clean_line((string)($_POST['surface'] ?? ''), 40);
        $p['published'] = !empty($_POST['published']);
        $p['featured'] = !empty($_POST['featured']);
        $p['slug'] = unique_slug($all, slugify((string)($_POST['slug'] ?? '') ?: $title), $p['id']);
        $p['updated'] = date('Y-m-d H:i:s');

        // Photos: order, captions, deletions, roles
        if (isset($_POST['img_src'])) {
            $delete = (array)($_POST['img_delete'] ?? []);
            $byId = [];
            foreach ($p['images'] as $im) $byId[$im['src']] = $im;
            $images = [];
            foreach ((array)$_POST['img_src'] as $k => $src) {
                if (!isset($byId[$src])) continue;
                $im = $byId[$src];
                if (in_array($src, $delete, true)) { delete_image($im); continue; }
                $im['alt'] = clean_line((string)($_POST['img_alt'][$k] ?? ''), 160);
                $images[] = $im;
                unset($byId[$src]);
            }
            foreach ($byId as $src => $im) $images[] = $im; // uploaded meanwhile
            $p['images'] = $images;
        }
        $find = function ($src) use ($p) {
            foreach ($p['images'] as $im) if ($im['src'] === $src) return $im;
            return null;
        };
        $p['cover'] = $find((string)($_POST['cover'] ?? ($p['cover']['src'] ?? ''))) ?? ($p['images'][0] ?? null);
        $before = $find((string)($_POST['before'] ?? ''));
        $after = $find((string)($_POST['after'] ?? ''));
        $p['before'] = $before && $after && $before['src'] !== $after['src'] ? $before : null;
        $p['after'] = $p['before'] ? $after : null;

        // Photos sent with the first save (no JavaScript)
        if (!empty($_FILES['photos']['name'][0])) {
            foreach ($_FILES['photos']['name'] as $k => $n) {
                $f = ['name' => $n, 'type' => $_FILES['photos']['type'][$k], 'tmp_name' => $_FILES['photos']['tmp_name'][$k], 'error' => $_FILES['photos']['error'][$k], 'size' => $_FILES['photos']['size'][$k]];
                if ($f['error'] === UPLOAD_ERR_NO_FILE) continue;
                $p['images'][] = process_upload($f, 'projets');
            }
            $p['cover'] ??= $p['images'][0] ?? null;
        }

        if ($i !== null) $all[$i] = $p; else $all[] = $p;
        return $p['id'];
    });
    flash('Réalisation enregistrée.');
    redirect('?a=project&id=' . rawurlencode($savedId));
}

function delete_project(): void
{
    $id = (string)($_POST['id'] ?? '');
    update_store('projects', function (&$all) use ($id) {
        $i = find_index($all, $id);
        if ($i === null) return;
        foreach (all_images([$all[$i]]) as $im) delete_image($im);
        array_splice($all, $i, 1);
    });
    flash('Réalisation supprimée.');
}

function move_project(): void
{
    $id = (string)($_POST['id'] ?? '');
    $dir = ($_POST['dir'] ?? '') === 'up' ? -1 : 1;
    update_store('projects', function (&$all) use ($id, $dir) {
        $ordered = $all;
        usort($ordered, fn($a, $b) => [$b['sort'] ?? 0, $b['created'] ?? ''] <=> [$a['sort'] ?? 0, $a['created'] ?? '']);
        $ids = array_column($ordered, 'id');
        $pos = array_search($id, $ids, true);
        if ($pos === false) return;
        $to = $pos + $dir;
        if ($to < 0 || $to >= count($ids)) return;
        [$ids[$pos], $ids[$to]] = [$ids[$to], $ids[$pos]];
        $n = count($ids);
        foreach ($all as &$p) $p['sort'] = $n - array_search($p['id'], $ids, true);
        unset($p);
    });
}

/** AJAX: upload one photo to a project, or to the blog/settings library. */
function upload_json(): void
{
    header('Content-Type: application/json');
    $target = (string)($_POST['target'] ?? '');
    $file = $_FILES['file'] ?? null;
    if (!$file) throw new RuntimeException('Aucune photo reçue (le fichier dépasse peut-être la limite du serveur).');
    if (str_starts_with($target, 'project:')) {
        $id = substr($target, 8);
        $im = process_upload($file, 'projets');
        $count = update_store('projects', function (&$all) use ($id, $im) {
            $i = find_index($all, $id);
            if ($i === null) { delete_image($im); throw new RuntimeException('Projet introuvable.'); }
            $all[$i]['images'][] = $im;
            if (empty($all[$i]['cover'])) $all[$i]['cover'] = $im;
            $all[$i]['updated'] = date('Y-m-d H:i:s');
            return count($all[$i]['images']);
        });
        echo json_encode(['ok' => true, 'image' => $im, 'count' => $count]);
        return;
    }
    $im = process_upload($file, $target === 'blog' ? 'journal' : 'divers', clean_line((string)($_POST['alt'] ?? ''), 160));
    echo json_encode(['ok' => true, 'image' => $im]);
}

/* ================================================================== */
/* Blog                                                                */
/* ================================================================== */

function page_posts(): void
{
    $list = posts(false);
    head('Journal', 'posts'); ?>
    <div class="page-top"><h1>Journal</h1><a class="btn btn-primary" href="?a=post">+ Nouvel article</a></div>
    <p class="muted">Un article par mois suffit à faire revenir les visiteurs et à améliorer le référencement Google. Idées : un chantier en cours, un avant/après, un conseil (primes, PEB, choix des matériaux).</p>
    <?php if (!$list): ?><p class="muted">Aucun article.</p><?php endif; ?>
    <ul class="list list-posts">
      <?php foreach ($list as $p):
        $future = ($p['date'] ?? '') > date('Y-m-d H:i:s'); ?>
        <li>
          <a href="?a=post&amp;id=<?= e($p['id']) ?>">
            <?php if (!empty($p['cover'])): ?><img src="<?= e(img($p['cover'], true)) ?>" alt=""><?php else: ?><span class="noimg"></span><?php endif; ?>
            <span><b><?= e(tr($p['title'])) ?></b>
            <span class="muted"><?= e(date('d/m/Y', strtotime($p['date']))) ?>
              <?php if (empty($p['published'])): ?> · <span class="tag tag-muted">Brouillon</span><?php elseif ($future): ?> · <span class="tag">Programmé</span><?php endif; ?>
              <?php if (empty($p['body']['nl'])): ?> · FR uniquement<?php endif; ?></span></span>
          </a>
        </li>
      <?php endforeach; ?>
    </ul>
    <?php foot();
}

function page_post_form(): void
{
    $id = (string)($_GET['id'] ?? '');
    $p = $id !== '' ? find_by_id(load('posts'), $id) : null;
    if ($id !== '' && !$p) { flash('Article introuvable.', 'error'); redirect('?a=posts'); }
    $p ??= ['id' => '', 'slug' => '', 'title' => ['fr' => '', 'nl' => ''], 'excerpt' => ['fr' => '', 'nl' => ''], 'body' => ['fr' => '', 'nl' => ''], 'cover' => null, 'date' => date('Y-m-d H:i:s'), 'published' => false];
    $isNew = $p['id'] === '';
    head($isNew ? 'Nouvel article' : tr($p['title']), 'posts'); ?>
    <div class="page-top">
      <h1><?= $isNew ? 'Nouvel article' : e(tr($p['title'])) ?></h1>
      <?php if (!$isNew && !empty($p['published'])): ?><a class="btn" href="<?= e(url('blog', $p['slug'], 'fr')) ?>" target="_blank" rel="noopener">Voir sur le site ↗</a><?php endif; ?>
    </div>
    <form method="post" action="?a=post<?= $isNew ? '' : '&amp;id=' . e($p['id']) ?>" enctype="multipart/form-data" class="editor">
      <?= csrf_field() ?>
      <input type="hidden" name="id" value="<?= e($p['id']) ?>">
      <div class="editor-main">
        <section class="panel">
          <div class="lang-tabs" data-tabs>
            <button type="button" aria-pressed="true" data-tab="fr">Français</button>
            <button type="button" aria-pressed="false" data-tab="nl">Nederlands <small>(optionnel)</small></button>
          </div>
          <?php foreach (['fr', 'nl'] as $l): ?>
          <div class="stack" data-pane="<?= $l ?>"<?= $l === 'nl' ? ' hidden' : '' ?>>
            <label>Titre<?= $l === 'fr' ? ' *' : '' ?> <input name="title_<?= $l ?>" id="b-title-<?= $l ?>" value="<?= e($p['title'][$l] ?? '') ?>"<?= $l === 'fr' ? ' required' : '' ?>></label>
            <label>Chapeau <small>résumé affiché dans la liste et sur Google</small><textarea name="excerpt_<?= $l ?>" id="b-excerpt-<?= $l ?>" rows="2"><?= e($p['excerpt'][$l] ?? '') ?></textarea></label>
            <label>Texte
              <?= md_toolbar("b-body-$l") ?>
              <textarea name="body_<?= $l ?>" id="b-body-<?= $l ?>" rows="20" class="md"><?= e($p['body'][$l] ?? '') ?></textarea></label>
            <div class="md-preview prose" id="b-body-<?= $l ?>-preview" hidden></div>
          </div>
          <?php endforeach; ?>
          <details class="help"><summary>Mise en forme</summary>
            <p><code>## Intertitre</code> · <code>**gras**</code> · <code>*italique*</code> · <code>- élément de liste</code> · <code>[texte](https://lien)</code> · <code>&gt; citation</code>. Laissez une ligne vide entre deux paragraphes. Le bouton « Photo » envoie une image et l'insère dans le texte.</p>
          </details>
        </section>
      </div>
      <aside class="editor-side">
        <section class="panel stack">
          <label class="switch"><input type="checkbox" name="published" value="1"<?= !empty($p['published']) ? ' checked' : '' ?>> Publié</label>
          <label>Date de publication <small>une date future programme l'article</small><input type="datetime-local" name="date" id="b-date" value="<?= e(date('Y-m-d\TH:i', strtotime($p['date']))) ?>"></label>
          <div class="stack">
            <span class="label">Photo de couverture</span>
            <?php if (!empty($p['cover'])): ?>
              <img class="cover-preview" src="<?= e(img($p['cover'], true)) ?>" alt="">
              <label class="inline danger"><input type="checkbox" name="cover_remove" value="1"> Retirer la photo</label>
            <?php endif; ?>
            <input type="file" name="cover" accept="image/*" id="b-cover" aria-label="Photo de couverture">
          </div>
          <label>Adresse de la page <small>/blog/…</small><input name="slug" id="b-slug" value="<?= e($p['slug']) ?>" placeholder="automatique"></label>
          <button class="btn btn-primary btn-block" type="submit">Enregistrer</button>
        </section>
        <?php if (!$isNew): ?>
        <section class="panel">
          <button class="btn btn-danger btn-sm" type="submit" form="delete-form" data-confirm="Supprimer cet article ?">Supprimer l'article</button>
        </section>
        <?php endif; ?>
      </aside>
    </form>
    <?php if (!$isNew): ?>
    <form method="post" action="?a=post-delete" id="delete-form"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($p['id']) ?>"></form>
    <?php endif;
    foot();
}

function save_post(): void
{
    $id = (string)($_POST['id'] ?? '');
    $title = clean_line((string)($_POST['title_fr'] ?? ''));
    if ($title === '') throw new RuntimeException('Le titre en français est obligatoire.');
    $newCover = !empty($_FILES['cover']['name']) && ($_FILES['cover']['error'] ?? 4) !== UPLOAD_ERR_NO_FILE
        ? process_upload($_FILES['cover'], 'journal') : null;

    $savedId = update_store('posts', function (&$all) use ($id, $title, $newCover) {
        $i = $id !== '' ? find_index($all, $id) : null;
        if ($id !== '' && $i === null) throw new RuntimeException('Article introuvable.');
        $p = $i !== null ? $all[$i] : ['id' => bin2hex(random_bytes(6)), 'created' => date('Y-m-d H:i:s'), 'cover' => null];
        $p['title'] = ['fr' => $title, 'nl' => clean_line((string)($_POST['title_nl'] ?? ''))];
        $p['excerpt'] = ['fr' => clean_line((string)($_POST['excerpt_fr'] ?? ''), 400), 'nl' => clean_line((string)($_POST['excerpt_nl'] ?? ''), 400)];
        $p['body'] = ['fr' => mb_substr((string)($_POST['body_fr'] ?? ''), 0, 60000), 'nl' => mb_substr((string)($_POST['body_nl'] ?? ''), 0, 60000)];
        $p['published'] = !empty($_POST['published']);
        $ts = strtotime((string)($_POST['date'] ?? '')) ?: time();
        $p['date'] = date('Y-m-d H:i:s', $ts);
        $p['slug'] = unique_slug($all, slugify((string)($_POST['slug'] ?? '') ?: $title), $p['id']);
        if ($newCover || !empty($_POST['cover_remove'])) {
            delete_image($p['cover'] ?? null);
            $p['cover'] = $newCover;
        }
        $p['updated'] = date('Y-m-d H:i:s');
        if ($i !== null) $all[$i] = $p; else $all[] = $p;
        return $p['id'];
    });
    flash('Article enregistré.');
    redirect('?a=post&id=' . rawurlencode($savedId));
}

function delete_post(): void
{
    $id = (string)($_POST['id'] ?? '');
    update_store('posts', function (&$all) use ($id) {
        $i = find_index($all, $id);
        if ($i === null) return;
        delete_image($all[$i]['cover'] ?? null);
        array_splice($all, $i, 1);
    });
    flash('Article supprimé.');
}

/* ================================================================== */
/* Messages & subscribers                                              */
/* ================================================================== */

function page_messages(): void
{
    $msgs = load('messages');
    head('Messages', 'messages'); ?>
    <div class="page-top"><h1>Demandes de devis</h1></div>
    <?php if (!$msgs): ?><p class="muted">Aucune demande pour le moment.</p><?php endif; ?>
    <div class="messages">
      <?php foreach ($msgs as $m): ?>
        <article class="panel message<?= empty($m['read']) ? ' is-unread' : '' ?>" id="m-<?= e($m['id']) ?>">
          <header>
            <h2><?= e($m['name']) ?></h2>
            <span class="muted"><?= e(date('d/m/Y à H:i', strtotime($m['date']))) ?> · <?= strtoupper(e($m['lang'] ?? 'fr')) ?></span>
          </header>
          <dl class="kv">
            <div><dt>Téléphone</dt><dd><a href="<?= e(tel_href($m['phone'])) ?>"><?= e($m['phone']) ?></a></dd></div>
            <div><dt>E-mail</dt><dd><a href="mailto:<?= e($m['email']) ?>"><?= e($m['email']) ?></a></dd></div>
            <div><dt>Commune</dt><dd><?= e($m['city'] ?: '—') ?></dd></div>
            <div><dt>Travaux</dt><dd><?= e($m['type'] ?: '—') ?></dd></div>
            <div><dt>Budget</dt><dd><?= e($m['budget'] ?? '—') ?></dd></div>
          </dl>
          <p class="message-text"><?= nl2br(e($m['message'])) ?></p>
          <div class="row-actions">
            <a class="btn btn-sm btn-primary" href="mailto:<?= e($m['email']) ?>?subject=<?= rawurlencode('Votre demande – Madibu Group') ?>">Répondre</a>
            <form method="post" action="?a=messages"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($m['id']) ?>"><input type="hidden" name="do" value="<?= empty($m['read']) ? 'read' : 'unread' ?>"><button class="btn btn-sm" type="submit"><?= empty($m['read']) ? 'Marquer comme lu' : 'Marquer non lu' ?></button></form>
            <form method="post" action="?a=messages"><?= csrf_field() ?><input type="hidden" name="id" value="<?= e($m['id']) ?>"><input type="hidden" name="do" value="delete"><button class="btn btn-sm btn-danger" type="submit" data-confirm="Supprimer ce message ?">Supprimer</button></form>
          </div>
        </article>
      <?php endforeach; ?>
    </div>
    <?php foot();
}

function messages_action(): void
{
    $id = (string)($_POST['id'] ?? '');
    $do = (string)($_POST['do'] ?? '');
    update_store('messages', function (&$all) use ($id, $do) {
        $i = find_index($all, $id);
        if ($i === null) return;
        if ($do === 'delete') array_splice($all, $i, 1);
        else $all[$i]['read'] = $do === 'read';
    });
    redirect('?a=messages');
}

function page_subscribers(): void
{
    $subs = load('subscribers');
    head('Abonnés', 'subscribers'); ?>
    <div class="page-top"><h1>Abonnés aux nouvelles</h1><?php if ($subs): ?><a class="btn" href="?a=export-subscribers">Exporter (CSV)</a><?php endif; ?></div>
    <p class="muted">Importez le fichier CSV dans votre outil d'e-mailing (Brevo, Mailchimp…) pour envoyer vos nouvelles. Supprimez une adresse dès qu'une personne demande à être désinscrite.</p>
    <?php if (!$subs): ?><p class="muted">Aucun abonné pour le moment.</p><?php else: ?>
    <table class="table">
      <thead><tr><th>E-mail</th><th>Langue</th><th>Date</th><th></th></tr></thead>
      <tbody>
      <?php foreach (array_reverse($subs) as $s): ?>
        <tr><td><?= e($s['email']) ?></td><td><?= strtoupper(e($s['lang'] ?? 'fr')) ?></td><td><?= e(date('d/m/Y', strtotime($s['date']))) ?></td>
          <td><form method="post" action="?a=subscribers"><?= csrf_field() ?><input type="hidden" name="email" value="<?= e($s['email']) ?>"><button class="btn btn-sm btn-danger" type="submit" data-confirm="Retirer <?= e($s['email']) ?> ?">Retirer</button></form></td></tr>
      <?php endforeach; ?>
      </tbody>
    </table>
    <?php endif;
    foot();
}

function subscribers_action(): void
{
    $email = (string)($_POST['email'] ?? '');
    update_store('subscribers', function (&$all) use ($email) {
        $all = array_values(array_filter($all, fn($s) => strcasecmp($s['email'], $email) !== 0));
    });
    flash('Adresse retirée.');
    redirect('?a=subscribers');
}

function export_subscribers(): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="abonnes-madibu-' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['email', 'langue', 'date'], ';');
    foreach (load('subscribers') as $s) fputcsv($out, [$s['email'], $s['lang'] ?? 'fr', $s['date']], ';');
    fclose($out);
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

function page_settings(): void
{
    $s = settings();
    $fields = [
        'phone' => ['Téléphone', 'tel'], 'email' => ['E-mail affiché', 'email'], 'address' => ['Adresse', 'text'],
        'area' => ['Zone d\'intervention', 'text'], 'hours' => ['Horaires', 'text'], 'vat' => ['N° TVA / BCE', 'text'],
        'notify_email' => ['Recevoir les demandes de devis sur', 'email'],
        'facebook' => ['Page Facebook', 'url'], 'instagram' => ['Instagram', 'url'], 'linkedin' => ['LinkedIn', 'url'],
        'ga_id' => ['Google Analytics (G-XXXXXXX)', 'text'], 'pontaj_url' => ['Formulaire de pointage (Pontaj)', 'url'],
    ];
    head('Réglages', 'settings'); ?>
    <div class="page-top"><h1>Réglages</h1></div>
    <form method="post" action="?a=settings" enctype="multipart/form-data" class="settings">
      <?= csrf_field() ?>
      <section class="panel">
        <h2>Coordonnées</h2>
        <div class="grid-2">
          <?php foreach ($fields as $k => [$label, $type]): ?>
            <label><?= e($label) ?> <input type="<?= $type ?>" name="<?= $k ?>" id="s-<?= $k ?>" value="<?= e($s[$k] ?? '') ?>"></label>
          <?php endforeach; ?>
        </div>
      </section>
      <section class="panel">
        <h2>Photos des métiers</h2>
        <p class="muted">Remplacez les photos d'illustration par des photos de vos chantiers.</p>
        <div class="svc-photos">
          <?php foreach (services() as $svc): ?>
            <div class="svc-photo">
              <img src="<?= e(($s['service_images'][$svc['slug']]['src'] ?? '') ?: $svc['image']) ?>" alt="">
              <span><?= e($svc['title']['fr']) ?></span>
              <input type="file" name="svc_<?= e($svc['slug']) ?>" accept="image/*" aria-label="Nouvelle photo pour <?= e($svc['title']['fr']) ?>">
            </div>
          <?php endforeach; ?>
        </div>
      </section>
      <section class="panel">
        <h2>Changer le mot de passe</h2>
        <div class="grid-2">
          <label>Mot de passe actuel <input type="password" name="pw_current" id="s-pw-current" autocomplete="current-password"></label>
          <label>Nouveau mot de passe (10 caractères min.) <input type="password" name="pw_new" id="s-pw-new" autocomplete="new-password" minlength="10"></label>
        </div>
      </section>
      <button class="btn btn-primary" type="submit">Enregistrer les réglages</button>
    </form>
    <?php foot();
}

function save_settings(): void
{
    $uploads = [];
    foreach (services() as $svc) {
        $f = $_FILES['svc_' . $svc['slug']] ?? null;
        if ($f && ($f['error'] ?? 4) !== UPLOAD_ERR_NO_FILE) $uploads[$svc['slug']] = process_upload($f, 'metiers');
    }
    $msg = 'Réglages enregistrés.';
    update_store('settings', function (&$s) use ($uploads, &$msg) {
        foreach (['phone', 'email', 'address', 'area', 'hours', 'vat', 'notify_email', 'facebook', 'instagram', 'linkedin', 'ga_id', 'pontaj_url'] as $k) {
            $v = clean_line((string)($_POST[$k] ?? ''), 300);
            if (in_array($k, ['facebook', 'instagram', 'linkedin', 'pontaj_url'], true) && $v !== '' && !preg_match('~^https://~', $v)) $v = '';
            if ($k === 'ga_id') $v = preg_replace('~[^A-Z0-9\-]~', '', strtoupper($v));
            $s[$k] = $v;
        }
        foreach ($uploads as $slug => $im) {
            delete_image($s['service_images'][$slug] ?? null);
            $s['service_images'][$slug] = $im;
        }
        $new = (string)($_POST['pw_new'] ?? '');
        if ($new !== '') {
            if (!password_verify((string)($_POST['pw_current'] ?? ''), $s['admin_hash'])) throw new RuntimeException('Mot de passe actuel incorrect. Rien n\'a été modifié.');
            if (mb_strlen($new) < 10) throw new RuntimeException('Le nouveau mot de passe doit contenir au moins 10 caractères.');
            $s['admin_hash'] = password_hash($new, PASSWORD_DEFAULT);
            $msg = 'Réglages et mot de passe enregistrés.';
        }
    });
    flash($msg);
    redirect('?a=settings');
}

/* ================================================================== */
/* Optimise legacy WordPress photos                                    */
/* ================================================================== */

function page_optimize(): void
{
    $todo = count(array_filter(all_images(load('projects')), fn($im) => str_starts_with($im['src'] ?? '', '/wp-content/') && empty($im['legacy_failed'])));
    head('Optimiser les photos', 'projects'); ?>
    <div class="page-top"><h1>Optimiser les photos de l'ancien site</h1></div>
    <section class="panel stack">
      <p>Les photos importées de WordPress sont souvent très lourdes. Cet outil les copie dans <code>uploads/</code>, les redimensionne, crée des miniatures et retire les données GPS. Les originaux dans <code>wp-content</code> ne sont pas modifiés.</p>
      <p><b id="opt-left"><?= $todo ?></b> photos à traiter.</p>
      <?php if ($todo): ?>
        <button class="btn btn-primary" type="button" id="opt-start">Lancer l'optimisation</button>
        <div class="progress" hidden id="opt-progress"><span></span></div>
        <p class="muted" id="opt-status" role="status">Laissez cette page ouverte pendant le traitement.</p>
      <?php else: ?>
        <p class="flash flash-ok">Toutes les photos sont optimisées. Vous pouvez supprimer l'ancien WordPress du serveur (voir le guide d'installation).</p>
      <?php endif; ?>
    </section>
    <?php foot();
}

/** Process up to 3 legacy photos per request (keeps each request short). */
function optimize_batch(): void
{
    header('Content-Type: application/json');
    @set_time_limit(120);
    $done = 0;
    $errors = [];
    $left = update_store('projects', function (&$all) use (&$done, &$errors) {
        $map = [];
        foreach (all_images($all) as $im) {
            $src = $im['src'] ?? '';
            if (!str_starts_with($src, '/wp-content/') || !empty($im['legacy_failed']) || isset($map[$src])) continue;
            if ($done >= 3) break;
            $path = ROOT . $src;
            $real = realpath($path);
            if (!$real || !str_starts_with($real, realpath(ROOT) . DIRECTORY_SEPARATOR . 'wp-content')) {
                $errors[] = "Introuvable : $src";
                $map[$src] = ['src' => $src . '#missing', 'thumb' => $src, 'alt' => $im['alt'] ?? ''];
                continue;
            }
            try {
                $new = process_upload(['name' => basename($real), 'tmp_name' => $real, 'error' => UPLOAD_ERR_OK, 'size' => filesize($real)], 'projets', $im['alt'] ?? '', true);
                $map[$src] = $new;
                $done++;
            } catch (Throwable $e) {
                $errors[] = basename($src) . ' : ' . $e->getMessage();
                $map[$src] = ['src' => $src . '#skip', 'thumb' => $src, 'alt' => $im['alt'] ?? ''];
            }
        }
        $swap = function ($im) use ($map) {
            if (!$im) return $im;
            $n = $map[$im['src'] ?? ''] ?? null;
            if (!$n) return $im;
            if (str_contains($n['src'], '#')) return array_merge($im, ['src' => strtok($n['src'], '#'), 'legacy_failed' => true]);
            return array_merge($n, ['alt' => $im['alt'] ?? '']);
        };
        foreach ($all as &$p) {
            foreach (['cover', 'before', 'after'] as $k) $p[$k] = $swap($p[$k] ?? null);
            $p['images'] = array_map($swap, $p['images'] ?? []);
        }
        unset($p);
        return count(array_filter(all_images($all), fn($im) => str_starts_with($im['src'] ?? '', '/wp-content/') && empty($im['legacy_failed'])));
    });
    echo json_encode(['done' => $done, 'left' => $left, 'errors' => $errors]);
}
