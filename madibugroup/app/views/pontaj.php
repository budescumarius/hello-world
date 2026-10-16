<?php
$GLOBALS['noindex'] = true;
$GLOBALS['page_title'] = 'Pontaj — Madibu Group';
$src = settings()['pontaj_url'] ?: 'https://app.smartsheet.eu/b/form/5f1577a9e6494247a687ea3fd1dbd7b1';
?>
<section class="section-tight"><div class="wrap wrap-narrow">
  <h1 class="h2">Pontaj</h1>
  <iframe class="pontaj" src="<?= e($src) ?>" title="Pontaj" loading="lazy"></iframe>
</div></section>
