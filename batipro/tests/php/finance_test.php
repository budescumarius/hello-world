<?php
// Équivalence du portage PHP (pilotage/finance.php) avec les calculs JavaScript de BatiPro,
// mesurée sur la référence dorée tests/fixtures/finance-golden.json (produite par le code JS).
declare(strict_types=1);
require __DIR__ . '/harness.php';
require __DIR__ . '/../../pilotage/finance.php';

$golden = json_decode(file_get_contents(__DIR__ . '/../fixtures/finance-golden.json'), true);
$sc = json_decode(file_get_contents(__DIR__ . '/../fixtures/finance-scenarios.json'), true);

function near($a, $b, string $msg): void {
    if (is_array($a) || is_array($b)) {
        T::ok(is_array($a) && is_array($b) && count($a) === count($b), "$msg : structures différentes " . json_encode([$a, $b]));
        foreach ($a as $k => $v) { T::ok(array_key_exists($k, $b), "$msg : clé $k absente"); near($v, $b[$k], "$msg.$k"); }
        return;
    }
    if (is_numeric($a) && is_numeric($b)) { T::ok(abs((float)$a - (float)$b) < 1e-9, "$msg : JS $a ≠ PHP $b"); return; }
    T::eq($a, $b, $msg);
}

echo "Portage PHP des calculs (équivalence avec le JavaScript)\n";
T::test('num() : mêmes valeurs que le JavaScript pour 13 saisies types', function () use ($golden) {
    foreach ($golden['num'] as $k => $expected) near($expected, pil_num(json_decode((string)$k, true)), "num($k)");
});
T::test('r2() : mêmes arrondis, y compris négatifs (notes de crédit)', function () use ($golden) {
    foreach ($golden['r2'] as $k => $expected) near($expected, pil_r2((float)$k), "r2($k)");
});
T::test('totals() : documents (remise par taux, autoliquidation, note de crédit, ouvrage ventilé)', function () use ($golden, $sc) {
    foreach ($sc['documents'] as $k => $doc) near($golden['totals'][$k], pil_doc_totals($doc), $k);
});
T::test('totals() : TTC des factures de test', function () use ($golden, $sc) {
    foreach ($sc['invoices'] as $k => $inv) near($golden['invState'][$k]['total'], pil_doc_totals($inv['data'])['total'], $k);
});
T::test('invState() : états et restes identiques au JavaScript (brouillon, en retard, partielle, avoir…)', function () use ($golden, $sc) {
    foreach ($sc['invoices'] as $k => $inv) { $s = pil_inv_state($inv, $golden['today']); near($golden['invState'][$k], ['s' => $s['s'], 'paid' => $s['paid'], 'rest' => $s['rest'], 'total' => $s['t']['total']], "invState $k"); }
});
T::test('purchTtc / purchPaid / purchState : achats identiques au JavaScript', function () use ($golden, $sc) {
    foreach ($sc['purchases'] as $k => $e) { $d = $e['data']; $t = pil_purch_total($d); $pd = pil_purch_paid($d);
        near($golden['purchases'][$k], ['ttc' => $t, 'paid' => $pd, 'rest' => pil_r2($t - $pd), 'state' => pil_purch_state($e, $golden['today'])], "achat $k"); }
});
T::test('projectFinance() : budget, coûts prévus et réels, engagé, facturé, encaissé, marge identiques au JavaScript', function () use ($golden, $sc) {
    near($golden['projectFinance'], pil_project_finance($sc['project']['p'], $sc['project']['all'], $golden['today']), 'projectFinance');
});
exit(T::done());
