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
    $d = pil_num($doc['discount'] ?? null) / 100;
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
    usort($by, fn($a, $b) => $b['rate'] <=> $a['rate']);
    $vats = [];
    foreach ($by as $x) {
        $lines = pil_r2($x['sum']);
        if (!$lines) continue;
        $allowance = pil_r2($lines * $d);
        $base = pil_r2($lines - $allowance);
        $vats[] = ['rate' => $x['rate'], 'lines' => $lines, 'allowance' => $allowance, 'base' => $base, 'vat' => !empty($doc['reverse']) ? 0.0 : pil_r2($base * $x['rate'] / 100)];
    }
    $discount = pil_r2(array_sum(array_column($vats, 'allowance')));
    $base = pil_r2($net - $discount);
    $vat = pil_r2(array_sum(array_column($vats, 'vat')));
    return ['net' => $net, 'discount' => $discount, 'base' => $base, 'vats' => $vats, 'vat' => $vat, 'total' => pil_r2($base + $vat),
        'cost' => pil_r2($cost), 'costBy' => $costBy, 'margin' => pil_r2($base - $cost)];
}
