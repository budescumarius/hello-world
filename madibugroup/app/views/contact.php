<?php
$GLOBALS['nav_current'] = 'contact';
$GLOBALS['page_title'] = t('ct_title') . ' — Madibu Group';
$GLOBALS['page_desc'] = t('ct_lede');
$GLOBALS['alt_url'] = url('contact', null, lang() === 'fr' ? 'nl' : 'fr');
$s = settings();
$form = $form ?? [];
$errors = $errors ?? [];
$sent = isset($_GET['sent']);
$v = fn($k) => e($form[$k] ?? '');
$err = fn($k) => isset($errors[$k]) ? ' aria-invalid="true"' : '';
$types = array_map(fn($x) => tr($x['title']), services());
$types[] = t('f_type_other');
$budgets = explode('|', t('f_budget_opts'));
?>
<section class="page-head">
  <div class="wrap">
    <p class="kicker"><?= e(t('ct_kicker')) ?></p>
    <h1 class="display-sm"><?= e(t('ct_title')) ?></h1>
    <p class="lede"><?= e(t('ct_lede')) ?></p>
  </div>
</section>
<section class="section section-tight">
  <div class="wrap contact-grid">
    <dl class="contact-list">
      <div><dt><?= e(t('ct_phone')) ?></dt><dd><a href="<?= e(tel_href($s['phone'])) ?>"><?= e($s['phone']) ?></a></dd></div>
      <div><dt><?= e(t('ct_email')) ?></dt><dd><a href="mailto:<?= e($s['email']) ?>"><?= e($s['email']) ?></a></dd></div>
      <div><dt><?= e(t('ct_address')) ?></dt><dd><a href="https://www.google.com/maps/search/?api=1&amp;query=<?= rawurlencode($s['address'] . ', Belgique') ?>" target="_blank" rel="noopener"><?= e($s['address']) ?></a></dd></div>
      <div><dt><?= e(t('ct_area')) ?></dt><dd><?= e($s['area']) ?></dd></div>
      <?php if ($s['hours']): ?><div><dt><?= e(t('ct_hours')) ?></dt><dd><?= e($s['hours']) ?></dd></div><?php endif; ?>
    </dl>

    <div class="form-card" id="form">
      <?php if ($sent): ?>
        <div class="form-done" role="status">
          <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 25l7 7 13-15" fill="none" stroke="currentColor" stroke-width="3"/></svg>
          <h2 class="h3"><?= e(t('f_ok_t')) ?></h2>
          <p><?= e(t('f_ok_d')) ?></p>
          <a class="link-arrow" href="<?= url('projects') ?>"><?= e(t('hero_projects')) ?></a>
        </div>
      <?php else: ?>
      <form method="post" action="<?= url('contact') ?>#form" class="quote-form" novalidate>
        <?php if ($errors): ?><p class="form-error" role="alert"><?= e(t('f_err')) ?></p><?php endif; ?>
        <input type="hidden" name="t" value="<?= time() ?>">
        <div class="hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="field-row">
          <div class="field"><label for="f-name"><?= e(t('f_name')) ?> *</label><input id="f-name" name="name" required autocomplete="name" value="<?= $v('name') ?>"<?= $err('name') ?>></div>
          <div class="field"><label for="f-phone"><?= e(t('f_phone')) ?> *</label><input id="f-phone" name="phone" type="tel" required autocomplete="tel" value="<?= $v('phone') ?>"<?= $err('phone') ?>></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="f-email"><?= e(t('f_email')) ?> *</label><input id="f-email" name="email" type="email" required autocomplete="email" value="<?= $v('email') ?>"<?= $err('email') ?>></div>
          <div class="field"><label for="f-city"><?= e(t('f_city')) ?></label><input id="f-city" name="city" autocomplete="address-level2" value="<?= $v('city') ?>"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="f-type"><?= e(t('f_type')) ?></label>
            <select id="f-type" name="type"><?php foreach ($types as $o): ?><option<?= ($form['type'] ?? '') === $o ? ' selected' : '' ?>><?= e($o) ?></option><?php endforeach; ?></select></div>
          <div class="field"><label for="f-budget"><?= e(t('f_budget')) ?></label>
            <select id="f-budget" name="budget"><?php foreach ($budgets as $o): ?><option<?= ($form['budget'] ?? '') === $o ? ' selected' : '' ?>><?= e($o) ?></option><?php endforeach; ?></select></div>
        </div>
        <div class="field"><label for="f-msg"><?= e(t('f_msg')) ?> *</label><textarea id="f-msg" name="message" rows="6" required placeholder="<?= e(t('f_msg_ph')) ?>"<?= $err('message') ?>><?= $v('message') ?></textarea></div>
        <label class="check<?= isset($errors['consent']) ? ' is-invalid' : '' ?>"><input type="checkbox" name="consent" value="1" required<?= !empty($_POST['consent']) ? ' checked' : '' ?>> <span><?= e(t('f_consent')) ?> <a href="<?= url('privacy') ?>"><?= e(t('privacy')) ?></a></span></label>
        <button class="btn btn-oak btn-block" type="submit"><?= e(t('f_send')) ?></button>
      </form>
      <?php endif; ?>
    </div>
  </div>
</section>
