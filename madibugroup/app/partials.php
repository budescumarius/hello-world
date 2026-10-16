<?php
/** Reusable blocks shared by several pages. */

function project_card(array $p, string $size = ''): string
{
    $cover = project_cover($p);
    $cats = categories();
    $cat = isset($cats[$p['category'] ?? '']) ? tr($cats[$p['category']]) : '';
    $count = count($p['images'] ?? []);
    ob_start(); ?>
    <a class="pcard <?= e($size) ?>" href="<?= url('projects', $p['slug']) ?>" data-cat="<?= e($p['category'] ?? '') ?>">
      <span class="pcard-media">
        <?php if ($cover): ?><img src="<?= e(img($cover, true)) ?>" alt="<?= e($cover['alt'] ?? tr($p['title'])) ?>" loading="lazy"><?php endif; ?>
        <?php if (($p['status'] ?? '') === 'ongoing'): ?><span class="badge badge-live"><?= e(t('prj_ongoing')) ?></span><?php endif; ?>
      </span>
      <span class="pcard-body">
        <span class="pcard-meta"><?= e(implode(' · ', array_filter([$cat, $p['commune'] ?? '', $p['year'] ?? '']))) ?></span>
        <span class="pcard-title"><?= e(tr($p['title'])) ?></span>
        <?php if ($count): ?><span class="pcard-count"><?= $count ?> <?= e(t('prj_photos')) ?></span><?php endif; ?>
      </span>
    </a>
    <?php return ob_get_clean();
}

function post_card(array $p, bool $large = false): string
{
    $body = tr($p['body']);
    ob_start(); ?>
    <article class="post-card<?= $large ? ' post-card-lg' : '' ?>">
      <a href="<?= url('blog', $p['slug']) ?>" class="post-card-link">
        <?php if (!empty($p['cover'])): ?><span class="post-card-media"><img src="<?= e(img($p['cover'], true)) ?>" alt="" loading="lazy"></span><?php endif; ?>
        <span class="post-card-meta"><time datetime="<?= e(substr($p['date'], 0, 10)) ?>"><?= e(format_date($p['date'])) ?></time> · <?= reading_minutes($body) ?> <?= e(t('blog_min')) ?></span>
        <span class="post-card-title"><?= e(tr($p['title'])) ?></span>
        <span class="post-card-excerpt"><?= e(tr($p['excerpt'] ?? []) ?: excerpt_from($body)) ?></span>
        <span class="link-arrow"><?= e(t('blog_read')) ?></span>
      </a>
    </article>
    <?php return ob_get_clean();
}

function newsletter_block(): string
{
    $state = $_GET['news'] ?? '';
    $back = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    ob_start(); ?>
    <section class="newsletter" id="newsletter">
      <div class="wrap newsletter-row">
        <div>
          <h2 class="h3"><?= e(t('news_title')) ?></h2>
          <p><?= e(t('news_lede')) ?></p>
        </div>
        <form class="news-form" method="post" action="<?= lang() === 'nl' ? '/nl' : '' ?>/newsletter">
          <input type="hidden" name="back" value="<?= e($back) ?>">
          <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
          <label class="sr" for="news-email"><?= e(t('news_email')) ?></label>
          <input id="news-email" name="email" type="email" required placeholder="<?= e(t('news_email')) ?>" autocomplete="email">
          <button class="btn btn-oak" type="submit"><?= e(t('news_btn')) ?></button>
          <p class="news-note<?= $state ? ' is-' . e($state) : '' ?>" role="status"><?= e($state === 'ok' ? t('news_ok') : ($state === 'err' ? t('news_err') : t('news_consent'))) ?></p>
        </form>
      </div>
    </section>
    <?php return ob_get_clean();
}

function cta_band(): string
{
    $s = settings();
    ob_start(); ?>
    <section class="cta-band">
      <div class="wrap cta-row">
        <div>
          <h2 class="h2"><?= e(t('cta_title')) ?></h2>
          <p><?= e(t('cta_lede')) ?></p>
        </div>
        <div class="cta-actions">
          <a class="btn btn-oak" href="<?= url('contact') ?>#form"><?= e(t('cta_visit')) ?></a>
          <a class="btn btn-ghost-light" href="<?= e(tel_href($s['phone'])) ?>"><?= e($s['phone']) ?></a>
        </div>
      </div>
    </section>
    <?php return ob_get_clean();
}

function before_after(array $before, array $after, string $label = ''): string
{
    ob_start(); ?>
    <div class="ba" style="--pos:50%">
      <img class="ba-after" src="<?= e($after['src']) ?>" alt="<?= e(t('ba_after') . ($label ? ' – ' . $label : '')) ?>" loading="lazy">
      <div class="ba-before"><img src="<?= e($before['src']) ?>" alt="<?= e(t('ba_before') . ($label ? ' – ' . $label : '')) ?>" loading="lazy"></div>
      <span class="ba-tag ba-tag-before"><?= e(t('ba_before')) ?></span>
      <span class="ba-tag ba-tag-after"><?= e(t('ba_after')) ?></span>
      <span class="ba-handle" aria-hidden="true"></span>
      <input class="ba-range" type="range" min="0" max="100" value="50" aria-label="<?= e(t('ba_title')) ?>">
    </div>
    <?php return ob_get_clean();
}

function service_image(array $svc): string
{
    $over = settings()['service_images'][$svc['slug']] ?? null;
    return $over['src'] ?? $svc['image'];
}
