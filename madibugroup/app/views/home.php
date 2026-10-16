<?php
$GLOBALS['body_class'] = 'home';
$GLOBALS['alt_url'] = url('home', null, lang() === 'fr' ? 'nl' : 'fr');
$s = settings();
$allProjects = projects();
$hero = null;
foreach ($allProjects as $p) { if (!empty($p['featured']) && project_cover($p)) { $hero = $p; break; } }
if (!$hero) foreach ($allProjects as $p) { if (project_cover($p)) { $hero = $p; break; } }
$GLOBALS['page_image'] = $hero ? img(project_cover($hero)) : '';
$featured = array_slice($allProjects, 0, 6);
$ba = null;
foreach ($allProjects as $p) { if (!empty($p['before']) && !empty($p['after'])) { $ba = $p; break; } }
$latest = array_slice(posts(), 0, 3);
?>
<section class="hero">
  <div class="hero-media">
    <?php if ($hero): $hc = project_cover($hero); ?>
      <img src="<?= e(img($hc)) ?>" alt="<?= e($hc['alt'] ?? tr($hero['title'])) ?>" fetchpriority="high">
    <?php endif; ?>
  </div>
  <div class="wrap hero-inner">
    <div class="hero-copy">
      <p class="kicker kicker-light"><?= e(t('hero_kicker')) ?></p>
      <h1 class="display"><?= t('hero_title') ?></h1>
      <p class="lede"><?= e(t('hero_lede')) ?></p>
      <div class="actions">
        <a class="btn btn-oak" href="<?= url('contact') ?>#form"><?= e(t('cta_visit')) ?></a>
        <a class="btn btn-ghost-light" href="<?= url('projects') ?>"><?= e(t('hero_projects')) ?></a>
      </div>
    </div>
    <?php if ($hero): ?>
    <a class="cartouche" href="<?= url('projects', $hero['slug']) ?>">
      <span class="cartouche-row"><span><?= e(t('hero_caption')) ?></span><b><?= e(tr($hero['title'])) ?></b></span>
      <?php if (!empty($hero['commune'])): ?><span class="cartouche-row"><span><?= e(t('prj_commune')) ?></span><b><?= e($hero['commune']) ?></b></span><?php endif; ?>
      <span class="cartouche-row"><span><?= e(t('prj_status')) ?></span><b><?= e(($hero['status'] ?? '') === 'ongoing' ? t('prj_ongoing') : t('prj_done')) ?></b></span>
    </a>
    <?php endif; ?>
  </div>
</section>

<section class="proof" aria-label="Madibu Group">
  <div class="wrap proof-row">
    <?php for ($i = 1; $i <= 4; $i++): ?>
      <div class="proof-item"><b><?= e(t("proof_{$i}_t")) ?></b><span><?= e(t("proof_{$i}_d")) ?></span></div>
    <?php endfor; ?>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="sec-head">
      <div>
        <p class="kicker"><?= e(t('svc_kicker')) ?></p>
        <h2 class="h2"><?= e(t('svc_title')) ?></h2>
      </div>
      <p class="sec-lede"><?= e(t('svc_lede')) ?></p>
    </div>
    <div class="svc-list">
      <?php foreach (services() as $svc): ?>
        <a class="svc-row" href="<?= url('services', $svc['slug']) ?>">
          <span class="svc-lot"><?= e(t('lot')) ?> <?= e($svc['lot']) ?></span>
          <span class="svc-name"><?= e(tr($svc['title'])) ?></span>
          <span class="svc-short"><?= e(tr($svc['short'])) ?></span>
          <span class="svc-img"><img src="<?= e(service_image($svc)) ?>" alt="" loading="lazy"></span>
          <span class="svc-arrow" aria-hidden="true">→</span>
        </a>
      <?php endforeach; ?>
    </div>
  </div>
</section>

<?php if ($featured): ?>
<section class="section section-alt">
  <div class="wrap">
    <div class="sec-head">
      <div>
        <p class="kicker"><?= e(t('prj_kicker')) ?></p>
        <h2 class="h2"><?= e(t('prj_title')) ?></h2>
      </div>
      <p class="sec-lede"><?= e(t('prj_lede')) ?> <a class="link-arrow" href="<?= url('projects') ?>"><?= e(t('prj_all')) ?></a></p>
    </div>
    <div class="pgrid pgrid-home">
      <?php foreach ($featured as $i => $p) echo project_card($p, $i === 0 ? 'pcard-xl' : ''); ?>
    </div>
  </div>
</section>
<?php endif; ?>

<?php if ($ba): ?>
<section class="section ba-section">
  <div class="wrap ba-grid">
    <div>
      <p class="kicker"><?= e(t('ba_kicker')) ?></p>
      <h2 class="h2"><?= e(t('ba_title')) ?></h2>
      <p class="sec-lede"><?= e(tr($ba['summary'] ?? []) ) ?></p>
      <a class="link-arrow" href="<?= url('projects', $ba['slug']) ?>"><?= e(tr($ba['title'])) ?></a>
    </div>
    <?= before_after($ba['before'], $ba['after'], tr($ba['title'])) ?>
  </div>
</section>
<?php endif; ?>

<section class="section section-dark">
  <div class="wrap">
    <div class="sec-head">
      <div>
        <p class="kicker kicker-light"><?= e(t('method_kicker')) ?></p>
        <h2 class="h2"><?= e(t('method_title')) ?></h2>
      </div>
    </div>
    <ol class="steps">
      <?php for ($i = 1; $i <= 5; $i++): ?>
        <li><h3><?= e(t("m{$i}_t")) ?></h3><p><?= e(t("m{$i}_d")) ?></p></li>
      <?php endfor; ?>
    </ol>
  </div>
</section>

<section class="section quotes">
  <div class="wrap">
    <p class="kicker"><?= e(t('quotes_kicker')) ?></p>
    <div class="quote-grid">
      <figure class="quote quote-lg">
        <blockquote><?= e(t('quote_1')) ?></blockquote>
        <figcaption><span class="stars" aria-label="5/5">★★★★★</span> <?= e(t('quote_1_a')) ?></figcaption>
      </figure>
      <figure class="quote">
        <blockquote><?= e(t('quote_2')) ?></blockquote>
        <figcaption><span class="stars" aria-label="5/5">★★★★★</span> <?= e(t('quote_2_a')) ?></figcaption>
      </figure>
    </div>
  </div>
</section>

<?php if ($latest): ?>
<section class="section section-alt">
  <div class="wrap">
    <div class="sec-head">
      <div>
        <p class="kicker"><?= e(t('blog_kicker')) ?></p>
        <h2 class="h2"><?= e(t('blog_title')) ?></h2>
      </div>
      <p class="sec-lede"><?= e(t('blog_lede')) ?> <a class="link-arrow" href="<?= url('blog') ?>"><?= e(t('blog_all')) ?></a></p>
    </div>
    <div class="post-grid">
      <?php foreach ($latest as $p) echo post_card($p); ?>
    </div>
  </div>
</section>
<?php endif; ?>

<?= newsletter_block() ?>
<?= cta_band() ?>
