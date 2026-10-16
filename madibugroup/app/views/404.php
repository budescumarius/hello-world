<?php $GLOBALS['page_title'] = t('404_title') . ' — Madibu Group'; $GLOBALS['noindex'] = true; ?>
<section class="page-head page-404">
  <div class="wrap">
    <p class="kicker">404</p>
    <h1 class="display-sm"><?= e(t('404_title')) ?></h1>
    <p class="lede"><?= e(t('404_text')) ?></p>
    <div class="actions"><a class="btn btn-oak" href="<?= url('home') ?>"><?= e(t('back_home')) ?></a><a class="btn btn-ghost" href="<?= url('projects') ?>"><?= e(t('nav_projects')) ?></a></div>
  </div>
</section>
