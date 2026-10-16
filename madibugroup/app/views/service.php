<?php
/** @var array $svc */
$GLOBALS['nav_current'] = 'services';
$GLOBALS['page_title'] = tr($svc['title']) . ' — Madibu Group';
$GLOBALS['page_desc'] = tr($svc['short']);
$GLOBALS['page_image'] = service_image($svc);
$GLOBALS['alt_url'] = url('services', $svc['slug'], lang() === 'fr' ? 'nl' : 'fr');
$related = array_slice(array_values(array_filter(projects(), fn($p) => in_array($p['category'] ?? '', $svc['cats'] ?? [], true))), 0, 3);
if (!$related) $related = array_slice(projects(), 0, 3);
?>
<section class="page-head page-head-split">
  <div class="wrap split">
    <div>
      <p class="kicker"><a href="<?= url('services') ?>"><?= e(t('svc_kicker')) ?></a> · <?= e(t('lot')) ?> <?= e($svc['lot']) ?></p>
      <h1 class="display-sm"><?= e(tr($svc['title'])) ?></h1>
      <p class="lede"><?= e(tr($svc['short'])) ?></p>
      <div class="actions"><a class="btn btn-oak" href="<?= url('contact') ?>#form"><?= e(t('cta_visit')) ?></a></div>
    </div>
    <div class="split-media"><img src="<?= e(service_image($svc)) ?>" alt="<?= e(tr($svc['title'])) ?>"></div>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap prose-wrap">
    <div class="prose"><?= markdown(tr($svc['body'])) ?></div>
    <aside class="side-list">
      <h2 class="footer-h"><?= e(t('svc_all')) ?></h2>
      <ul>
        <?php foreach (services() as $o): ?>
          <li><a href="<?= url('services', $o['slug']) ?>"<?= $o['slug'] === $svc['slug'] ? ' aria-current="page"' : '' ?>><span><?= e($o['lot']) ?></span> <?= e(tr($o['title'])) ?></a></li>
        <?php endforeach; ?>
      </ul>
    </aside>
  </div>
</section>
<?php if ($related): ?>
<section class="section section-alt">
  <div class="wrap">
    <div class="sec-head"><div><p class="kicker"><?= e(t('prj_kicker')) ?></p><h2 class="h2"><?= e(t('prj_title')) ?></h2></div></div>
    <div class="pgrid"><?php foreach ($related as $p) echo project_card($p); ?></div>
  </div>
</section>
<?php endif; ?>
<?= cta_band() ?>
