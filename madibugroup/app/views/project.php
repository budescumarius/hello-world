<?php
/** @var array $p */
$GLOBALS['nav_current'] = 'projects';
$GLOBALS['page_title'] = tr($p['title']) . ' — ' . t('nav_projects') . ' Madibu Group';
$GLOBALS['page_desc'] = tr($p['summary'] ?? []) ?: t('prj_lede');
$cover = project_cover($p);
$GLOBALS['page_image'] = img($cover);
$GLOBALS['alt_url'] = url('projects', $p['slug'], lang() === 'fr' ? 'nl' : 'fr');
$cats = categories();
$all = projects();
$idx = array_search($p['slug'], array_column($all, 'slug'), true);
$next = $all[($idx + 1) % max(1, count($all))] ?? null;
if ($next && $next['slug'] === $p['slug']) $next = null;
$images = $p['images'] ?? [];
?>
<section class="project-hero">
  <?php if ($cover): ?><img src="<?= e(img($cover)) ?>" alt="<?= e($cover['alt'] ?? tr($p['title'])) ?>" fetchpriority="high"><?php endif; ?>
</section>
<section class="section section-tight">
  <div class="wrap project-head">
    <div>
      <p class="kicker"><a href="<?= url('projects') ?>"><?= e(t('prj_kicker')) ?></a></p>
      <h1 class="display-sm"><?= e(tr($p['title'])) ?></h1>
      <?php if (tr($p['summary'] ?? [])): ?><p class="lede"><?= e(tr($p['summary'])) ?></p><?php endif; ?>
    </div>
    <dl class="cartouche cartouche-static">
      <?php if (!empty($p['category']) && isset($cats[$p['category']])): ?><div class="cartouche-row"><dt><?= e(t('prj_type')) ?></dt><dd><?= e(tr($cats[$p['category']])) ?></dd></div><?php endif; ?>
      <?php if (!empty($p['commune'])): ?><div class="cartouche-row"><dt><?= e(t('prj_commune')) ?></dt><dd><?= e($p['commune']) ?></dd></div><?php endif; ?>
      <?php if (!empty($p['year'])): ?><div class="cartouche-row"><dt><?= e(t('prj_year')) ?></dt><dd><?= e($p['year']) ?></dd></div><?php endif; ?>
      <?php if (!empty($p['surface'])): ?><div class="cartouche-row"><dt><?= e(t('prj_surface')) ?></dt><dd><?= e($p['surface']) ?></dd></div><?php endif; ?>
      <div class="cartouche-row"><dt><?= e(t('prj_status')) ?></dt><dd><?= e(($p['status'] ?? '') === 'ongoing' ? t('prj_ongoing') : t('prj_done')) ?></dd></div>
    </dl>
  </div>
  <?php if (trim(tr($p['body'] ?? []))): ?>
  <div class="wrap"><div class="prose prose-narrow"><?= markdown(tr($p['body'])) ?></div></div>
  <?php endif; ?>
</section>

<?php if (!empty($p['before']) && !empty($p['after'])): ?>
<section class="section section-tight">
  <div class="wrap">
    <p class="kicker"><?= e(t('ba_kicker')) ?></p>
    <?= before_after($p['before'], $p['after'], tr($p['title'])) ?>
  </div>
</section>
<?php endif; ?>

<?php if ($images): ?>
<section class="section section-tight">
  <div class="wrap">
    <h2 class="h3 gallery-title"><?= e(t('prj_gallery')) ?> <span><?= count($images) ?> <?= e(t('prj_photos')) ?></span></h2>
    <div class="gallery" data-gallery>
      <?php foreach ($images as $im): ?>
        <a href="<?= e($im['src']) ?>" class="gallery-item" data-caption="<?= e($im['alt'] ?? '') ?>"><img src="<?= e(img($im, true)) ?>" alt="<?= e(($im['alt'] ?? '') ?: tr($p['title'])) ?>" loading="lazy"></a>
      <?php endforeach; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<section class="section section-alt">
  <div class="wrap similar">
    <div>
      <h2 class="h2"><?= e(t('prj_similar')) ?></h2>
      <p class="sec-lede"><?= e(t('prj_similar_d')) ?></p>
      <a class="btn btn-oak" href="<?= url('contact') ?>#form"><?= e(t('cta_visit')) ?></a>
    </div>
    <?php if ($next): ?>
    <div class="next-project">
      <p class="kicker"><?= e(t('prj_next')) ?></p>
      <?= project_card($next) ?>
    </div>
    <?php endif; ?>
  </div>
</section>
<?= newsletter_block() ?>
