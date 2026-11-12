<?php
// Calculs financiers côté serveur – portage EXACT des fonctions JavaScript de BatiPro (assets/core.js, data.js).
// Toute modification doit garder l'équivalence vérifiée par tests/php/finance_test.php
// (mêmes résultats que tests/fixtures/finance-golden.json, produit à partir du code JavaScript).
declare(strict_types=1);

/** = num() de core.js : espaces retirés, PREMIÈRE virgule → point, puis lecture du nombre en tête (comme parseFloat). */
function pil_num($v): float {
    if (is_int($v) || is_float($v)) return is_finite((float)$v) ? (float)$v : 0.0;
    if ($v === null || is_bool($v) || is_array($v)) return 0.0;
    $s = preg_replace('/\s/u', '', (string)$v);
    $p = strpos($s, ',');
    if ($p !== false) $s = substr_replace($s, '.', $p, 1);
    if (!preg_match('/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/', $s, $m)) return 0.0;
    return (float)$m[0];
}

/** = r2() de core.js : Math.round((x + EPSILON) * 100) / 100 (arrondi « demi vers +∞ », comme Math.round). */
function pil_r2(float $x): float {
    return floor(($x + PHP_FLOAT_EPSILON) * 100 + 0.5) / 100;
}

/**
 * = totals(doc) de data.js : HT, remise répartie par taux (EN 16931), TVA, TTC, déboursé et marge.
 * @return array{net:float,discount:float,base:float,vats:array,vat:float,total:float,cost:float,costBy:array,margin:float}
 */
function pil_doc_totals(array $doc): array {
    $amtMode = ($doc['discountMode'] ?? null) === 'amt' && pil_num($doc['discountAmt'] ?? null) > 0;
    $d = $amtMode ? 0.0 : pil_num($doc['discount'] ?? null) / 100;
    $by = []; $costBy = []; $net = 0.0; $cost = 0.0;
    foreach (($doc['lines'] ?? []) as $l) {
        if (!is_array($l) || ($l['kind'] ?? null) !== 'item' || !empty($l['option'])) continue;
        $qty = pil_num($l['qty'] ?? null);
        $t = pil_r2($qty * pil_num($l['price'] ?? null));
        $net += $t;
        $rate = pil_num($l['vat'] ?? null);
        $key = (string)$rate; // les clés JS sont des chaînes ; on garde le taux numérique à côté
        $by[$key] = ['rate' => $rate, 'sum' => ($by[$key]['sum'] ?? 0.0) + $t];
        if (isset($l['costBy']) && is_array($l['costBy'])) { // en JS, un objet (même vide) est « vrai »
            foreach ($l['costBy'] as $k => $v) { $c = $qty * pil_num($v); $costBy[$k] = ($costBy[$k] ?? 0.0) + $c; $cost += $c; }
        } else {
            $c = $qty * pil_num($l['cost'] ?? null); $cost += $c;
            $ty = $l['type'] ?? null; $k = ($ty === null || $ty === '' || $ty === 0 || $ty === false) ? 'divers' : (string)$ty; // = l.type || 'divers'
            $costBy[$k] = ($costBy[$k] ?? 0.0) + $c;
        }
    }
    $net = pil_r2($net);
    $want = $amtMode && $net > 0 ? pil_r2(min(pil_num($doc['discountAmt'] ?? null), $net)) : 0.0;
    if ($amtMode && $net > 0) $d = $want / $net;
    usort($by, fn($a, $b) => $b['rate'] <=> $a['rate']);
    $vats = [];
    foreach ($by as $x) {
        $lines = pil_r2($x['sum']);
        if (!$lines) continue;
        $allowance = pil_r2($lines * $d);
        $base = pil_r2($lines - $allowance);
        $vats[] = ['rate' => $x['rate'], 'lines' => $lines, 'allowance' => $allowance, 'base' => $base, 'vat' => !empty($doc['reverse']) ? 0.0 : pil_r2($base * $x['rate'] / 100)];
    }
    if ($amtMode && $vats) { // = data.js : l'écart d'arrondi sur le premier taux
        $diff = pil_r2($want - array_sum(array_column($vats, 'allowance')));
        if ($diff) { $v = &$vats[0]; $v['allowance'] = pil_r2($v['allowance'] + $diff); $v['base'] = pil_r2($v['lines'] - $v['allowance']); $v['vat'] = !empty($doc['reverse']) ? 0.0 : pil_r2($v['base'] * $v['rate'] / 100); unset($v); }
    }
    $discount = pil_r2(array_sum(array_column($vats, 'allowance')));
    $base = pil_r2($net - $discount);
    $vat = pil_r2(array_sum(array_column($vats, 'vat')));
    return ['net' => $net, 'discount' => $discount, 'base' => $base, 'vats' => $vats, 'vat' => $vat, 'total' => pil_r2($base + $vat),
        'cost' => pil_r2($cost), 'costBy' => $costBy, 'margin' => pil_r2($base - $cost)];
}

/** = invState(inv) de data.js : { t, paid, rest, s } (s : brouillon, avoir, payee, retard, partielle, impayee). */
function pil_inv_state(array $inv, string $today): array {
    $d = $inv['data'] ?? [];
    $t = pil_doc_totals($d);
    $paid = pil_r2(array_sum(array_map(fn($p) => pil_num($p['amount'] ?? null), (array)($d['payments'] ?? []))));
    $rest = pil_r2($t['total'] - $paid);
    if (($d['kind'] ?? '') === 'avoir') $s = 'avoir';
    elseif (($d['status'] ?? '') !== 'emise') $s = 'brouillon';
    elseif ($rest <= 0.005) $s = 'payee';
    elseif (!empty($d['due']) && $d['due'] < $today) $s = 'retard';
    elseif ($paid > 0) $s = 'partielle';
    else $s = 'impayee';
    return ['t' => $t, 'paid' => $paid, 'rest' => $rest, 's' => $s];
}
/** = purchVat / purchTtc / purchPaid / purchState de purchase.js */
function pil_purch_vat(array $d, float $defVat = 21.0): array {
    if (is_array($d['vatLines'] ?? null) && $d['vatLines']) return array_map(fn($x) => ['rate' => pil_num($x['rate'] ?? null), 'amount' => pil_num($x['amount'] ?? null)], $d['vatLines']);
    $rate = array_key_exists('vat', $d) && $d['vat'] !== null ? pil_num($d['vat']) : $defVat;
    $amount = isset($d['vatAmount']) && $d['vatAmount'] !== '' ? pil_num($d['vatAmount']) : pil_r2(pil_num($d['amount'] ?? null) * $rate / 100);
    return [['rate' => $rate, 'amount' => $amount]];
}
function pil_purch_total(array $d, float $defVat = 21.0): float {
    return isset($d['ttc']) && $d['ttc'] !== '' && $d['ttc'] !== null ? pil_num($d['ttc']) : pil_r2(pil_num($d['amount'] ?? null) + array_sum(array_column(pil_purch_vat($d, $defVat), 'amount')));
}
function pil_purch_paid(array $d, float $defVat = 21.0): float {
    return is_array($d['payments'] ?? null) && $d['payments'] ? pil_r2(array_sum(array_map(fn($p) => pil_num($p['amount'] ?? null), $d['payments']))) : (!empty($d['paid']) ? pil_purch_total($d, $defVat) : 0.0);
}
function pil_purch_state(array $e, string $today, float $defVat = 21.0): string {
    $d = $e['data'] ?? [];
    if (!empty($d['refused'])) return 'refusee';
    if (($d['status'] ?? '') === 'avalider' || !empty($d['toCheck'])) return 'avalider';
    $paid = pil_purch_paid($d, $defVat); $rest = pil_r2(pil_purch_total($d, $defVat) - $paid);
    if (($paid != 0 || !empty($d['paid']) || !pil_purch_total($d, $defVat)) && abs($rest) < 0.01) return 'payee';
    if (!empty($d['due']) && $d['due'] < $today) return 'retard';
    return $paid ? 'partiel' : 'apayer';
}
/** = expenseParts(e) de achats.js : ventilation d'un achat par chantier et catégorie. */
function pil_expense_parts(array $e): array {
    $d = $e['data'] ?? []; $a = $d['alloc'] ?? null;
    if (is_array($a) && $a) return array_map(fn($x) => ['pid' => !empty($x['pid']) ? (int)$x['pid'] : null, 'amount' => pil_num($x['amount'] ?? null), 'category' => ($x['category'] ?? '') ?: (($d['category'] ?? '') ?: 'divers')], $a);
    return [['pid' => !empty($e['project_id']) ? (int)$e['project_id'] : null, 'amount' => pil_num($d['amount'] ?? null), 'category' => ($d['category'] ?? '') ?: 'divers']];
}
/** = projectFinance(p, all) de chantier.js (devis acceptés, coûts prévus et réels, engagé, facturé, encaissé, marge). */
function pil_project_finance(array $p, array $all, string $today): array {
    $acc = array_values(array_filter($all['quote'] ?? [], fn($q) => (($q['data'] ?? [])['status'] ?? '') === 'accepte'));
    $qt = array_map(fn($q) => pil_doc_totals($q['data']), $acc);
    $budget = $acc ? array_sum(array_column($qt, 'base')) : pil_num(($p['data'] ?? [])['budget'] ?? null);
    $est = array_sum(array_column($qt, 'cost'));
    $estBy = [];
    foreach ($qt as $t) foreach ($t['costBy'] as $k => $v) { $kk = $k === 'ouvrage' ? 'divers' : $k; $estBy[$kk] = ($estBy[$kk] ?? 0) + $v; }
    $realBy = [];
    foreach ($all['expense'] ?? [] as $e) { if (!empty(($e['data'] ?? [])['refused'])) continue; foreach (pil_expense_parts($e) as $x) if ($x['pid'] === (int)$p['id']) $realBy[$x['category']] = ($realBy[$x['category']] ?? 0) + $x['amount']; }
    foreach ($all['timesheet'] ?? [] as $h) $realBy['mo'] = ($realBy['mo'] ?? 0) + pil_num(($h['data'] ?? [])['hours'] ?? null) * pil_num(($h['data'] ?? [])['rate'] ?? null);
    $real = array_sum($realBy);
    $engaged = 0.0;
    foreach ($all['order'] ?? [] as $o) if (!in_array((($o['data'] ?? [])['status'] ?? ''), ['facturee', 'annulee'], true)) $engaged += pil_doc_totals($o['data'])['base'];
    $ist = array_values(array_filter(array_map(fn($i) => pil_inv_state($i, $today), $all['invoice'] ?? []), fn($s) => $s['s'] !== 'brouillon'));
    $invoiced = array_sum(array_map(fn($s) => $s['t']['base'], $ist));
    $cashed = array_sum(array_column($ist, 'paid'));
    $due = array_sum(array_map(fn($s) => $s['s'] === 'avoir' ? 0 : max(0, $s['rest']), $ist));
    $hours = array_sum(array_map(fn($h) => pil_num(($h['data'] ?? [])['hours'] ?? null), $all['timesheet'] ?? []));
    return ['budget' => $budget, 'est' => $est, 'estBy' => $estBy, 'real' => $real, 'realBy' => $realBy, 'engaged' => $engaged, 'invoiced' => $invoiced, 'cashed' => $cashed, 'due' => $due, 'hours' => $hours,
        'margin' => $budget - max($est, $real + $engaged)];
}
