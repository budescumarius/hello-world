<?php
/** @var string $content */
require_once __DIR__ . '/../partials.php';
$s = settings();
$title = $GLOBALS['page_title'] ?? 'Madibu Group — ' . t('tagline');
$desc = $GLOBALS['page_desc'] ?? t('meta_desc');
$ogImage = $GLOBALS['page_image'] ?? '';
$current = $GLOBALS['nav_current'] ?? '';
$otherLang = lang() === 'fr' ? 'nl' : 'fr';
$altPath = $GLOBALS['alt_url'] ?? url('home', null, $otherLang);
$navItems = [
    'services' => t('nav_services'),
    'projects' => t('nav_projects'),
    'blog' => t('nav_blog'),
];
?><!doctype html>
<html lang="<?= lang() ?>-BE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($title) ?></title>
<meta name="description" content="<?= e($desc) ?>">
<?php if (!empty($GLOBALS['noindex'])): ?><meta name="robots" content="noindex, nofollow"><?php endif; ?>
<link rel="alternate" hreflang="<?= $otherLang ?>-BE" href="<?= e(base_url() . $altPath) ?>">
<link rel="alternate" type="application/rss+xml" title="Madibu Group" href="/feed.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Madibu Group">
<meta property="og:title" content="<?= e($title) ?>">
<meta property="og:description" content="<?= e($desc) ?>">
<?php if ($ogImage): ?><meta property="og:image" content="<?= e(str_starts_with($ogImage, 'http') ? $ogImage : base_url() . $ogImage) ?>"><?php endif; ?>
<meta name="theme-color" content="#1b2328">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/site.css?v=1">
<script type="application/ld+json"><?= json_encode([
    '@context' => 'https://schema.org',
    '@type' => 'GeneralContractor',
    'name' => 'Madibu Group',
    'url' => base_url(),
    'telephone' => $s['phone'],
    'email' => $s['email'],
    'address' => ['@type' => 'PostalAddress', 'streetAddress' => $s['address'], 'addressCountry' => 'BE'],
    'areaServed' => 'BE',
    'sameAs' => array_values(array_filter([$s['facebook'], $s['instagram'], $s['linkedin']])),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?></script>
</head>
<body class="page-<?= e($GLOBALS['body_class'] ?? 'default') ?>">
<a class="skip" href="#main"><?= lang() === 'nl' ? 'Naar de inhoud' : 'Aller au contenu' ?></a>

<header class="site-header" id="top">
  <div class="wrap header-row">
    <a class="logo" href="<?= url('home') ?>" aria-label="Madibu Group">
      <svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="currentColor"/><path d="M10 37V12l14 14 14-14v25" fill="none" stroke="var(--logo-ink)" stroke-width="4"/><path d="M10 41h28" stroke="var(--oak)" stroke-width="3"/></svg>
      <span class="logo-text"><b>MADIBU</b> GROUP<small><?= e(t('tagline')) ?></small></span>
    </a>
    <nav class="main-nav" id="main-nav" aria-label="Menu">
      <?php foreach ($navItems as $r => $label): ?>
        <a href="<?= url($r) ?>"<?= $current === $r ? ' aria-current="page"' : '' ?>><?= e($label) ?></a>
      <?php endforeach; ?>
      <a href="<?= url('contact') ?>"<?= $current === 'contact' ? ' aria-current="page"' : '' ?>><?= e(t('nav_contact')) ?></a>
      <a class="nav-phone" href="<?= e(tel_href($s['phone'])) ?>"><?= e($s['phone']) ?></a>
    </nav>
    <div class="header-actions">
      <a class="lang-switch" href="<?= e($altPath) ?>" hreflang="<?= $otherLang ?>" lang="<?= $otherLang ?>"><?= strtoupper($otherLang) ?></a>
      <a class="btn btn-oak btn-sm header-cta" href="<?= url('contact') ?>#form"><?= e(t('cta_visit')) ?></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="main-nav" id="menu-toggle"><span></span><span></span><span class="sr">Menu</span></button>
    </div>
  </div>
</header>

<main id="main">
<?= $content ?>
</main>

<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="footer-brand">
      <a class="logo logo-light" href="<?= url('home') ?>" aria-label="Madibu Group">
        <svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="currentColor"/><path d="M10 37V12l14 14 14-14v25" fill="none" stroke="var(--logo-ink)" stroke-width="4"/><path d="M10 41h28" stroke="var(--oak)" stroke-width="3"/></svg>
        <span class="logo-text"><b>MADIBU</b> GROUP</span>
      </a>
      <p><?= e(t('footer_about')) ?></p>
    </div>
    <div>
      <h2 class="footer-h"><?= e(t('nav_services')) ?></h2>
      <ul class="footer-list">
        <?php foreach (services() as $svc): ?><li><a href="<?= url('services', $svc['slug']) ?>"><?= e(tr($svc['title'])) ?></a></li><?php endforeach; ?>
      </ul>
    </div>
    <div>
      <h2 class="footer-h"><?= e(t('footer_nav')) ?></h2>
      <ul class="footer-list">
        <li><a href="<?= url('projects') ?>"><?= e(t('nav_projects')) ?></a></li>
        <li><a href="<?= url('blog') ?>"><?= e(t('nav_blog')) ?></a></li>
        <li><a href="<?= url('contact') ?>"><?= e(t('nav_contact')) ?></a></li>
        <li><a href="<?= url('privacy') ?>"><?= e(t('privacy')) ?></a></li>
      </ul>
    </div>
    <div>
      <h2 class="footer-h"><?= e(t('nav_contact')) ?></h2>
      <ul class="footer-list">
        <li><a href="<?= e(tel_href($s['phone'])) ?>"><?= e($s['phone']) ?></a></li>
        <li><a href="mailto:<?= e($s['email']) ?>"><?= e($s['email']) ?></a></li>
        <li><?= e($s['address']) ?></li>
        <?php if ($s['vat']): ?><li><?= lang() === 'nl' ? 'Btw' : 'TVA' ?> <?= e($s['vat']) ?></li><?php endif; ?>
      </ul>
      <div class="socials">
        <?php if ($s['facebook']): ?><a href="<?= e($s['facebook']) ?>" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h3V4h-3c-2.8 0-4 1.7-4 4.3V10H7v4h3v8h4v-8h3l1-4h-4V8.6c0-.4.3-.6.6-.6z" fill="currentColor"/></svg></a><?php endif; ?>
        <?php if ($s['instagram']): ?><a href="<?= e($s['instagram']) ?>" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg></a><?php endif; ?>
        <?php if ($s['linkedin']): ?><a href="<?= e($s['linkedin']) ?>" target="_blank" rel="noopener" aria-label="LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4v11H4zM6 3a2 2 0 110 4 2 2 0 010-4zm4 6h4v1.6c.6-1 1.9-1.9 3.6-1.9 3.4 0 4.4 2.1 4.4 5.4V20h-4v-5.2c0-1.4-.3-2.6-1.8-2.6s-2.2 1.1-2.2 2.6V20h-4z" fill="currentColor"/></svg></a><?php endif; ?>
      </div>
    </div>
  </div>
  <div class="wrap footer-base">
    <span>© <?= date('Y') ?> Madibu Group</span>
    <a href="#top"><?= lang() === 'nl' ? 'Naar boven' : 'Haut de page' ?> ↑</a>
  </div>
</footer>

<div class="lightbox" id="lightbox" hidden>
  <button class="lb-close" type="button" aria-label="Fermer">×</button>
  <button class="lb-prev" type="button" aria-label="Précédente">‹</button>
  <figure><img alt=""><figcaption></figcaption></figure>
  <button class="lb-next" type="button" aria-label="Suivante">›</button>
</div>

<?php if ($s['ga_id']): ?>
<div class="cookie" id="cookie" hidden>
  <p><?= e(t('cookie_text')) ?> <a href="<?= url('privacy') ?>"><?= e(t('privacy')) ?></a></p>
  <div><button class="btn btn-ghost btn-sm" type="button" data-cookie="no"><?= e(t('cookie_no')) ?></button><button class="btn btn-oak btn-sm" type="button" data-cookie="yes"><?= e(t('cookie_ok')) ?></button></div>
</div>
<script>window.GA_ID = <?= json_encode($s['ga_id']) ?>;</script>
<?php endif; ?>
<script src="/assets/site.js?v=1" defer></script>
</body>
</html>
