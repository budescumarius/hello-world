<?php
$GLOBALS['nav_current'] = 'projects';
$GLOBALS['page_title'] = t('nav_projects') . ' — Madibu Group';
$GLOBALS['page_desc'] = t('prj_lede');
$GLOBALS['alt_url'] = url('projects', null, lang() === 'fr' ? 'nl' : 'fr');
$list = projects();
$used = array_unique(array_filter(array_column($list, 'category')));
$cats = categories();
?>
<section class="page-head">
  <div class="wrap">
    <p class="kicker"><?= e(t('prj_kicker')) ?></p>
    <h1 class="display-sm"><?= e(t('prj_title')) ?></h1>
    <p class="lede"><?= e(t('prj_lede')) ?></p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap">
    <?php if (!$list): ?>
      <p class="empty"><?= e(t('prj_empty')) ?></p>
    <?php else: ?>
      <?php if (count($used) > 1): ?>
      <div class="filters" role="group" aria-label="Filtre">
        <button type="button" class="chip" aria-pressed="true" data-filter=""><?= e(t('prj_filter_all')) ?></button>
        <?php foreach ($cats as $k => $label): if (!in_array($k, $used, true)) continue; ?>
          <button type="button" class="chip" aria-pressed="false" data-filter="<?= e($k) ?>"><?= e(tr($label)) ?></button>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
      <div class="pgrid" id="pgrid"><?php foreach ($list as $p) echo project_card($p); ?></div>
    <?php endif; ?>
  </div>
</section>
<?= newsletter_block() ?>
<?= cta_band() ?>
