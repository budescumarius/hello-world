<?php
$GLOBALS['nav_current'] = 'services';
$GLOBALS['page_title'] = t('svc_title') . ' — Madibu Group';
$GLOBALS['alt_url'] = url('services', null, lang() === 'fr' ? 'nl' : 'fr');
?>
<section class="page-head">
  <div class="wrap">
    <p class="kicker"><?= e(t('svc_kicker')) ?></p>
    <h1 class="display-sm"><?= e(t('svc_title')) ?></h1>
    <p class="lede"><?= e(t('svc_lede')) ?></p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap svc-cards">
    <?php foreach (services() as $svc): ?>
      <a class="svc-card" href="<?= url('services', $svc['slug']) ?>">
        <span class="svc-card-media"><img src="<?= e(service_image($svc)) ?>" alt="" loading="lazy"></span>
        <span class="svc-lot"><?= e(t('lot')) ?> <?= e($svc['lot']) ?></span>
        <span class="svc-card-title"><?= e(tr($svc['title'])) ?></span>
        <span class="svc-card-text"><?= e(tr($svc['short'])) ?></span>
        <span class="link-arrow"><?= e(t('svc_more')) ?></span>
      </a>
    <?php endforeach; ?>
  </div>
</section>
<?= cta_band() ?>
