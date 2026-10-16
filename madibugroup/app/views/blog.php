<?php
$GLOBALS['nav_current'] = 'blog';
$GLOBALS['page_title'] = t('blog_kicker') . ' — Madibu Group';
$GLOBALS['page_desc'] = t('blog_lede');
$GLOBALS['alt_url'] = url('blog', null, lang() === 'fr' ? 'nl' : 'fr');
$list = posts();
?>
<section class="page-head">
  <div class="wrap">
    <p class="kicker"><?= e(t('blog_kicker')) ?></p>
    <h1 class="display-sm"><?= e(t('blog_title')) ?></h1>
    <p class="lede"><?= e(t('blog_lede')) ?></p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap">
    <?php if (!$list): ?>
      <p class="empty"><?= e(t('blog_empty')) ?></p>
    <?php else: ?>
      <div class="post-grid post-grid-blog">
        <?php foreach ($list as $i => $p) echo post_card($p, $i === 0); ?>
      </div>
    <?php endif; ?>
  </div>
</section>
<?= newsletter_block() ?>
