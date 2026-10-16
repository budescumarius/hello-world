<?php
/** @var array $post */
$GLOBALS['nav_current'] = 'blog';
$GLOBALS['page_title'] = tr($post['title']) . ' — Madibu Group';
$GLOBALS['page_desc'] = tr($post['excerpt'] ?? []) ?: excerpt_from(tr($post['body']));
$GLOBALS['page_image'] = img($post['cover'] ?? null);
$GLOBALS['alt_url'] = url('blog', $post['slug'], lang() === 'fr' ? 'nl' : 'fr');
$more = array_slice(array_values(array_filter(posts(), fn($p) => $p['slug'] !== $post['slug'])), 0, 3);
$body = tr($post['body']);
?>
<article>
  <header class="page-head article-head">
    <div class="wrap wrap-narrow">
      <p class="kicker"><a href="<?= url('blog') ?>"><?= e(t('blog_kicker')) ?></a> · <time datetime="<?= e(substr($post['date'], 0, 10)) ?>"><?= e(format_date($post['date'])) ?></time> · <?= reading_minutes($body) ?> <?= e(t('blog_min')) ?></p>
      <h1 class="display-sm"><?= e(tr($post['title'])) ?></h1>
      <?php if (tr($post['excerpt'] ?? [])): ?><p class="lede"><?= e(tr($post['excerpt'])) ?></p><?php endif; ?>
    </div>
  </header>
  <?php if (!empty($post['cover'])): ?>
  <div class="wrap article-cover"><img src="<?= e(img($post['cover'])) ?>" alt="<?= e($post['cover']['alt'] ?? '') ?>"></div>
  <?php endif; ?>
  <div class="wrap wrap-narrow section-tight">
    <div class="prose"><?= markdown($body) ?></div>
    <div class="article-end">
      <a class="link-arrow link-back" href="<?= url('blog') ?>"><?= e(t('blog_back')) ?></a>
      <?php $share = base_url() . url('blog', $post['slug']); ?>
      <a class="share" href="https://www.facebook.com/sharer/sharer.php?u=<?= rawurlencode($share) ?>" target="_blank" rel="noopener">Facebook</a>
      <a class="share" href="https://wa.me/?text=<?= rawurlencode(tr($post['title']) . ' ' . $share) ?>" target="_blank" rel="noopener">WhatsApp</a>
    </div>
  </div>
</article>
<?= newsletter_block() ?>
<?php if ($more): ?>
<section class="section section-alt">
  <div class="wrap">
    <h2 class="h2"><?= e(t('blog_more')) ?></h2>
    <div class="post-grid"><?php foreach ($more as $p) echo post_card($p); ?></div>
  </div>
</section>
<?php endif; ?>
<?= cta_band() ?>
