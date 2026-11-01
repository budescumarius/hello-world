<?php
// PILOTAGE MADIBU – étape 3 : trésorerie, engagements (crédits, leasing, charges fixes) et prévisions 7 / 30 / 90 jours.
// Règles :
//  - rien n'est inventé : chaque flux prévu vient d'une facture, d'un achat, d'un engagement CONFIRMÉ par l'utilisateur,
//    ou d'un paiement enregistré dans BatiPro mais pas encore visible sur un extrait ;
//  - montants confirmés et estimés toujours séparés ; hypothèses de chaque scénario visibles et modifiables ;
//  - pas de double comptage (voir pil_collect_flows : chaque règle est couverte par tests/php/treasury_test.php).
// Montants en centimes entiers. Les fonctions « pures » (sans base de données) sont en tête de fichier.
declare(strict_types=1);
require_once __DIR__ . '/bank.php';

const PIL_FREQ = ['mensuel' => [1, 'Mensuel'], 'bimestriel' => [2, 'Tous les 2 mois'], 'trimestriel' => [3, 'Trimestriel'], 'semestriel' => [6, 'Semestriel'], 'annuel' => [12, 'Annuel'], 'unique' => [0, 'Une seule fois']];
const PIL_KINDS = [
    'credit' => ['Crédit', ['investissement' => 'Crédit d\'investissement', 'caisse' => 'Crédit de caisse', 'professionnel' => 'Crédit professionnel', 'hypothecaire' => 'Crédit hypothécaire', 'temperament' => 'Prêt à tempérament', 'autre' => 'Autre financement']],
    'leasing' => ['Leasing', ['vehicule' => 'Véhicule', 'machine' => 'Machine', 'materiel' => 'Matériel', 'autre' => 'Autre leasing']],
    'charge' => ['Charge fixe', ['salaires' => 'Salaires', 'onss' => 'ONSS', 'precompte' => 'Précompte professionnel', 'tva' => 'TVA', 'assurances' => 'Assurances', 'comptabilite' => 'Comptabilité',
        'loyer' => 'Loyers', 'telecom' => 'Télécommunications', 'energie' => 'Énergie', 'abonnements' => 'Abonnements', 'autre' => 'Autres charges']],
];
const PIL_HYP_DEFAULT = [
    'optimiste' => ['label' => 'Optimiste', 'delay' => 'p25', 'extraDays' => 0, 'useProbability' => false, 'excludeOverdueAfter' => null, 'includeEaSent' => true, 'includeEaApproved' => true, 'prudencePct' => 0],
    'realiste' => ['label' => 'Réaliste', 'delay' => 'median', 'extraDays' => 0, 'useProbability' => true, 'excludeOverdueAfter' => null, 'includeEaSent' => false, 'includeEaApproved' => true, 'prudencePct' => 0],
    'pessimiste' => ['label' => 'Pessimiste', 'delay' => 'p75', 'extraDays' => 15, 'useProbability' => true, 'excludeOverdueAfter' => 60, 'includeEaSent' => false, 'includeEaApproved' => false, 'prudencePct' => 5],
];

// ===================================================================== Fonctions pures
function pil_days(string $a, string $b): int { return (int)round((strtotime($b . ' 12:00') - strtotime($a . ' 12:00')) / 86400); }
function pil_add_days(string $d, int $n): string { return date('Y-m-d', strtotime("$d 12:00 " . ($n >= 0 ? '+' : '') . "$n days")); }
/** Ajoute des mois en gardant le jour d'origine (31 → dernier jour du mois quand il n'existe pas). */
function pil_add_months(string $anchor, int $months): string {
    [$y, $m, $d] = array_map('intval', explode('-', $anchor));
    $m += $months; $y += intdiv($m - 1, 12); $m = ($m - 1) % 12 + 1;
    if ($m <= 0) { $m += 12; $y--; }
    return sprintf('%04d-%02d-%02d', $y, $m, min($d, (int)date('t', mktime(12, 0, 0, $m, 1, $y))));
}
/** Dates d'échéance d'un engagement entre $from et $to inclus (première échéance = next_date, jamais après end_date). */
function pil_occurrences(array $c, string $from, string $to): array {
    $first = (string)($c['next_date'] ?? ''); if ($first === '') return [];
    $step = PIL_FREQ[$c['frequency'] ?? 'mensuel'][0] ?? 1;
    $end = !empty($c['end_date']) ? min($to, (string)$c['end_date']) : $to;
    $out = [];
    for ($i = 0; $i < 1200; $i++) {
        $d = $step ? pil_add_months($first, $i * $step) : $first;
        if ($d > $end) break;
        if ($d >= $from) $out[] = $d;
        if (!$step) break;
    }
    return $out;
}
/**
 * Échéancier d'un crédit : seulement avec les données disponibles.
 * - mensualité + dates → paiements ; avec taux + capital restant (à une date) → répartition intérêts / capital et capital restant.
 * - remboursement « in_fine » : intérêts périodiques (mensualité saisie, ou capital × taux si non saisie), capital à la date de fin.
 * @return array{rows: array, remaining: ?int, notes: array}
 */
function pil_credit_schedule(array $c, string $from, string $to): array {
    $notes = []; $rows = [];
    $amount = isset($c['amount']) && $c['amount'] !== null && $c['amount'] !== '' ? (int)$c['amount'] : null;
    $rate = isset($c['rate']) && $c['rate'] !== null && $c['rate'] !== '' ? (float)$c['rate'] : null;
    $cap = isset($c['capital_remaining']) && $c['capital_remaining'] !== null && $c['capital_remaining'] !== '' ? (int)$c['capital_remaining'] : null;
    $asof = (string)($c['capital_asof'] ?? '') ?: null;
    $step = PIL_FREQ[$c['frequency'] ?? 'mensuel'][0] ?? 1;
    $inFine = ($c['repayment'] ?? '') === 'in_fine';
    // toutes les échéances depuis la date du capital connu (pour le faire évoluer), puis on garde celles de la période
    $start = $asof ? pil_add_days($asof, 1) : $from;
    $dates = pil_occurrences($c, min($start, $from), $to);
    $calc = $rate !== null && $cap !== null && $asof !== null && $step > 0;
    if (!$calc && $cap !== null) $notes[] = 'Capital restant non recalculé : taux, date du capital restant ou fréquence manquant.';
    $remaining = $cap;
    foreach ($dates as $d) {
        $interest = null; $capital = null; $pay = $amount;
        if ($calc && $d > $asof) {
            $interest = (int)round($remaining * $rate / 100 * $step / 12);
            if ($inFine) { $pay = $amount ?? $interest; $capital = 0; }
            else {
                if ($pay === null) break; // mensualité inconnue : rien n'est inventé
                $capital = min($remaining, $pay - $interest);
                if ($capital < 0) { $notes[] = 'Mensualité inférieure aux intérêts : vérifiez le taux ou la mensualité.'; $capital = 0; }
                $pay = $capital + $interest; $remaining -= $capital;
            }
        }
        if ($pay === null) continue;
        if ($d >= $from) $rows[] = ['date' => $d, 'amount' => $pay, 'interest' => $interest, 'capital' => $capital, 'remaining' => $calc ? $remaining : null];
        if ($calc && !$inFine && $remaining <= 0) break;
    }
    if ($inFine && $cap !== null && !empty($c['end_date']) && $c['end_date'] >= $from && $c['end_date'] <= $to)
        $rows[] = ['date' => $c['end_date'], 'amount' => $calc ? $remaining : $cap, 'interest' => 0, 'capital' => $calc ? $remaining : $cap, 'remaining' => 0, 'balloon' => true];
    if ($amount === null && !$inFine) $notes[] = 'Mensualité non renseignée : aucune échéance prévue.';
    return ['rows' => $rows, 'remaining' => $calc ? $remaining : $cap, 'notes' => $notes];
}
/** Percentile (interpolation linéaire) d'une liste de nombres ; null si vide. */
function pil_percentile(array $v, float $p): ?float {
    if (!$v) return null; sort($v); $i = ($p / 100) * (count($v) - 1); $lo = (int)floor($i); $hi = (int)ceil($i);
    return $v[$lo] + ($v[$hi] - $v[$lo]) * ($i - $lo);
}
/**
 * Délais de paiement observés : jours entre l'échéance et le paiement complet des factures soldées.
 * @param array $invoices [ ['client' => id, 'due' => date, 'paid_date' => date|null (paiement complet), 'open' => bool] ]
 * @return array{global: array, clients: array, buckets: array}
 */
function pil_delay_stats(array $invoices, string $today): array {
    $all = []; $per = [];
    foreach ($invoices as $i) {
        if (empty($i['due']) || empty($i['paid_date'])) continue;
        $d = pil_days($i['due'], $i['paid_date']); $all[] = $d; $per[$i['client']][] = $d;
    }
    $stat = fn(array $x) => ['n' => count($x), 'p25' => pil_percentile($x, 25), 'median' => pil_percentile($x, 50), 'p75' => pil_percentile($x, 75)];
    // probabilité d'être payée après N jours de retard : parmi les factures restées impayées au moins N jours, part finalement payée
    $buckets = [];
    foreach ([0, 30, 60, 90] as $k) {
        $pop = 0; $paid = 0;
        foreach ($invoices as $i) {
            if (empty($i['due']) || pil_days($i['due'], $today) < $k) continue;
            $late = $i['paid_date'] ? pil_days($i['due'], $i['paid_date']) : pil_days($i['due'], $today);
            if ($late < $k) continue;
            $pop++; if ($i['paid_date']) $paid++;
        }
        $buckets[$k] = ['n' => $pop, 'p' => $pop >= 5 ? round($paid / $pop, 2) : null];
    }
    $cl = [];
    foreach ($per as $k => $x) $cl[$k] = $stat($x);
    return ['global' => $stat($all), 'clients' => $cl, 'buckets' => $buckets];
}
/**
 * Prévision : solde jour par jour à partir des flux. Un flux daté avant $today est placé à $today (encore à venir).
 * @param array $flows [ ['date', 'amount' (centimes signés), 'certainty' => 'confirme'|'estime', ...] ]
 */
function pil_project(int $start, array $flows, string $today, int $days = 90): array {
    $byDay = array_fill(0, $days + 1, 0); $series = [];
    foreach ($flows as $f) { $k = max(0, pil_days($today, $f['date'])); if ($k <= $days) $byDay[$k] += $f['amount']; }
    $bal = $start; $min = $start; $minDate = $today; $neg = $start < 0 ? $today : null;
    $hz = [];
    for ($k = 0; $k <= $days; $k++) {
        $bal += $byDay[$k]; $d = pil_add_days($today, $k); $series[] = ['d' => $d, 'b' => $bal];
        if ($bal < $min) { $min = $bal; $minDate = $d; }
        if ($bal < 0 && $neg === null) $neg = $d;
        if (in_array($k, [7, 30, 90], true) && $k <= $days) {
            $sel = array_filter($flows, fn($f) => pil_days($today, $f['date']) <= $k);
            $sum = fn(string $cert, int $sign) => array_sum(array_map(fn($f) => $f['amount'], array_filter($sel, fn($f) => ($f['certainty'] ?? 'estime') === $cert && ($sign > 0 ? $f['amount'] > 0 : $f['amount'] < 0))));
            $hz[$k] = ['start' => $start, 'in_confirmed' => $sum('confirme', 1), 'in_estimated' => $sum('estime', 1), 'out_confirmed' => $sum('confirme', -1), 'out_estimated' => $sum('estime', -1),
                'end' => $bal, 'min' => $min, 'min_date' => $minDate, 'negative_date' => $neg];
        }
    }
    return ['series' => $series, 'horizons' => $hz];
}

// ===================================================================== Base de données
function pil_treasury_schema(): void {
    static $done = false; if ($done) return; $done = true;
    pil_bank_schema();
    if (q("SHOW TABLES LIKE 'pil_commitments'")->fetch()) return;
    db()->exec("CREATE TABLE IF NOT EXISTS pil_commitments (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, kind VARCHAR(10) NOT NULL, subtype VARCHAR(20) NOT NULL DEFAULT 'autre', label VARCHAR(190) NOT NULL,
        lender VARCHAR(120) NOT NULL DEFAULT '', account_id INT NULL, supplier_id INT NULL, amount BIGINT NULL, frequency VARCHAR(12) NOT NULL DEFAULT 'mensuel',
        next_date DATE NULL, start_date DATE NULL, end_date DATE NULL, capital_initial BIGINT NULL, capital_remaining BIGINT NULL, capital_asof DATE NULL,
        rate DECIMAL(7,4) NULL, repayment VARCHAR(12) NOT NULL DEFAULT 'mensualites', residual BIGINT NULL, buyback TINYINT NOT NULL DEFAULT 0,
        guarantees VARCHAR(255) NOT NULL DEFAULT '', notes TEXT NULL, docs TEXT NULL, status VARCHAR(12) NOT NULL DEFAULT 'a_confirmer', source VARCHAR(10) NOT NULL DEFAULT 'manuel',
        detect_key VARCHAR(190) NULL, confirmed_by INT NULL, confirmed_at DATETIME NULL, created_by INT NULL, created_at DATETIME NOT NULL, updated_by INT NULL, updated_at DATETIME NULL,
        KEY company_kind (company_id, kind)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    db()->exec("CREATE TABLE IF NOT EXISTS pil_doc_flags (
        company_id INT NOT NULL, item_id INT NOT NULL, flag VARCHAR(20) NOT NULL, note VARCHAR(255) NULL, flagged_by INT NULL, flagged_at DATETIME NOT NULL,
        PRIMARY KEY (company_id, item_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function pil_hypotheses(): array {
    $s = setting('pilotage_hyp', []) ?: [];
    $out = [];
    foreach (PIL_HYP_DEFAULT as $k => $def) $out[$k] = array_merge($def, array_intersect_key((array)($s[$k] ?? []), $def));
    return $out;
}

function pil_commitment_out(array $r): array {
    foreach (['id', 'account_id', 'supplier_id', 'amount', 'capital_initial', 'capital_remaining', 'residual', 'buyback', 'confirmed_by', 'created_by', 'updated_by'] as $k) if ($r[$k] !== null) $r[$k] = (int)$r[$k];
    $r['rate'] = $r['rate'] !== null ? (float)$r['rate'] : null;
    $r['docs'] = $r['docs'] ? (json_decode($r['docs'], true) ?: []) : [];
    foreach ($r['docs'] as &$d) unset($d['stored']); unset($d);
    unset($r['company_id']);
    return $r;
}
function pil_commitments(?string $status = null): array {
    $rows = q('SELECT * FROM pil_commitments WHERE company_id = ?' . ($status ? ' AND status = ?' : '') . ' ORDER BY kind, label', $status ? [cid(), $status] : [cid()])->fetchAll();
    return array_map('pil_commitment_out', $rows);
}
/** Échéances d'un engagement (crédit : échéancier ; leasing : mensualités + rachat ; charge : montants). */
function pil_commitment_flows(array $c, string $from, string $to): array {
    $out = [];
    if ($c['kind'] === 'credit') {
        $s = pil_credit_schedule($c, $from, $to);
        foreach ($s['rows'] as $r) $out[] = ['date' => $r['date'], 'amount' => -$r['amount'], 'detail' => !empty($r['balloon']) ? 'remboursement du capital' : ($r['interest'] !== null ? 'dont intérêts ' . pil_fmt($r['interest']) : '')];
        return $out;
    }
    if ($c['amount'] !== null) foreach (pil_occurrences($c, $from, $to) as $d) $out[] = ['date' => $d, 'amount' => -(int)$c['amount'], 'detail' => ''];
    if ($c['kind'] === 'leasing' && $c['buyback'] && $c['residual'] && !empty($c['end_date']) && $c['end_date'] >= $from && $c['end_date'] <= $to)
        $out[] = ['date' => $c['end_date'], 'amount' => -(int)$c['residual'], 'detail' => 'valeur de rachat'];
    return $out;
}

/** Soldes bancaires : dernier extrait de chaque compte (jamais présenté comme solde du jour) + paiements BatiPro pas encore vus en banque. */
function pil_balances(string $today): array {
    $accs = [];
    foreach (pil_accounts() as $a) {
        if (!$a['active']) continue;
        $last = q("SELECT period_to, closing FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_to DESC, id DESC LIMIT 1", [cid(), $a['id']])->fetch();
        $accs[] = ['id' => $a['id'], 'bank' => $a['bank'], 'label' => $a['label'], 'iban' => $a['iban'], 'balance' => $last ? (int)$last['closing'] : null, 'date' => $last['period_to'] ?? null,
            'age_days' => $last ? pil_days($last['period_to'], $today) : null];
    }
    $known = array_filter($accs, fn($a) => $a['balance'] !== null);
    $dates = array_column($known, 'date');
    return ['accounts' => $accs, 'total' => array_sum(array_column($known, 'balance')), 'missing' => count($accs) - count($known),
        'oldest_date' => $dates ? min($dates) : null, 'latest_date' => $dates ? max($dates) : null];
}

/** Documents BatiPro utiles à la prévision (factures émises, états d'avancement, achats), lus une fois. */
function pil_docs(): array {
    $inv = []; $exp = []; $flags = q('SELECT item_id, flag, note FROM pil_doc_flags WHERE company_id = ?', [cid()])->fetchAll(PDO::FETCH_UNIQUE);
    $names = [];
    foreach (q("SELECT id, data FROM items WHERE company_id = ? AND type = 'contact'", [cid()])->fetchAll() as $r) { $d = json_decode($r['data'], true) ?: []; $names[(int)$r['id']] = (string)($d['company'] ?? '') ?: trim(($d['firstname'] ?? '') . ' ' . ($d['name'] ?? '')); }
    foreach (q("SELECT id, number, project_id, data FROM items WHERE company_id = ? AND type = 'invoice'", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $kind = (string)($d['kind'] ?? 'facture');
        if ($kind === 'proforma') continue;
        $isEA = $kind === 'situation' && ($d['status'] ?? '') !== 'emise';
        if (!$isEA && ($d['status'] ?? '') !== 'emise') continue; // brouillon : pas une créance
        $due = pil_doc_due('invoice', $d);
        // date du paiement complet (le paiement qui solde la facture)
        $paidDate = null; $cum = 0;
        $pays = (array)($d['payments'] ?? []); usort($pays, fn($a, $b) => strcmp((string)($a['date'] ?? ''), (string)($b['date'] ?? '')));
        foreach ($pays as $p) { $cum += (int)round(pil_num($p['amount'] ?? 0) * 100); if ($due['total'] > 0 && $cum >= $due['total'] - 1 && !$paidDate) $paidDate = $p['date'] ?? null; }
        $inv[] = ['id' => (int)$r['id'], 'number' => $r['number'], 'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null, 'kind' => $kind, 'ea' => $isEA ? ((string)(($d['ea'] ?? [])['status'] ?? 'brouillon')) : null,
            'client' => (int)($d['clientId'] ?? 0), 'client_name' => $names[(int)($d['clientId'] ?? 0)] ?? '', 'date' => $d['date'] ?? null, 'due' => $d['due'] ?? ($d['date'] ?? null),
            'approve_by' => ($d['ea'] ?? [])['approveBy'] ?? null, 'pay_days' => (int)pil_num($d['payDays'] ?? 30),
            'total' => $due['total'], 'paid' => $due['paid'], 'rest' => $due['rest'], 'paid_date' => $paidDate, 'payments' => $pays, 'flag' => $flags[(int)$r['id']]['flag'] ?? null, 'flag_note' => $flags[(int)$r['id']]['note'] ?? null];
    }
    foreach (q("SELECT id, number, project_id, data FROM items WHERE company_id = ? AND type = 'expense'", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        if (!empty($d['refused'])) continue;
        $due = pil_doc_due('expense', $d);
        $exp[] = ['id' => (int)$r['id'], 'ref' => (string)($d['ref'] ?? ''), 'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null, 'supplier' => (int)($d['supplierId'] ?? 0),
            'supplier_name' => $names[(int)($d['supplierId'] ?? 0)] ?? '', 'date' => $d['date'] ?? null, 'due' => $d['due'] ?? null,
            'to_validate' => ($d['status'] ?? '') === 'avalider' || !empty($d['toCheck']), 'total' => $due['total'], 'paid' => $due['paid'], 'rest' => $due['rest'], 'payments' => (array)($d['payments'] ?? [])];
    }
    return ['invoices' => $inv, 'expenses' => $exp];
}

/**
 * Tous les flux prévus, par scénario. Règles anti-double comptage :
 *  1. factures et achats : seulement le RESTE à payer (les paiements déjà enregistrés sont soustraits) ;
 *  2. paiement enregistré dans BatiPro après le dernier extrait, sans lien bancaire (bankTx), hors espèces : compté une fois, « pas encore vu en banque » ;
 *     un paiement plus ancien que le dernier extrait est déjà dans le solde bancaire : jamais recompté ;
 *  3. échéance d'engagement antérieure au dernier extrait du compte débité : déjà dans le solde, ignorée ;
 *  4. engagement lié à un fournisseur : l'échéance est ignorée si un achat de ce fournisseur existe à ± 15 jours (l'achat est déjà compté) ;
 *  5. engagements « à confirmer » : jamais dans la prévision (listés à part) ;
 *  6. notes de crédit : déjà déduites de la facture d'origine dans BatiPro (paiement « Note de crédit ») : pas de flux séparé.
 */
function pil_collect_flows(array $docs, array $commitments, array $bal, array $stats, array $hyp, string $today, int $days = 90): array {
    $to = pil_add_days($today, $days);
    $latest = $bal['latest_date'] ?? null; $accDate = [];
    foreach ($bal['accounts'] as $a) $accDate[$a['id']] = $a['date'];
    $base = []; $excluded = [];
    // --- (2) paiements enregistrés mais pas encore sur un extrait
    if ($latest) foreach (['invoices' => 1, 'expenses' => -1] as $set => $sign) foreach ($docs[$set] as $x) foreach ($x['payments'] as $p) {
        if (!empty($p['bankTx']) || empty($p['date']) || $p['date'] <= $latest || $p['date'] > $today || in_array($p['method'] ?? '', ['Espèces', 'Note de crédit', 'Retenue ONSS', 'Retenue SPF Finances'], true)) continue;
        $base[] = ['date' => $today, 'amount' => $sign * (int)round(pil_num($p['amount'] ?? 0) * 100), 'certainty' => 'confirme', 'source' => 'paiement_non_vu',
            'label' => ($sign > 0 ? 'Encaissement ' : 'Paiement ') . 'du ' . pil_d($p['date']) . ' enregistré dans BâtiPro, pas encore sur un extrait', 'ref' => ['type' => $sign > 0 ? 'invoice' : 'expense', 'id' => $x['id']]];
    }
    // --- achats : reste à payer, à l'échéance (obligation maintenue dans tous les scénarios)
    foreach ($docs['expenses'] as $e) {
        if ($e['rest'] <= 0) continue;
        $date = $e['due'] ?: ($e['date'] ? pil_add_days($e['date'], 30) : $today);
        $base[] = ['date' => max($today, $date), 'amount' => -$e['rest'], 'certainty' => $e['to_validate'] || !$e['due'] ? 'estime' : 'confirme', 'source' => 'achat',
            'label' => 'Achat ' . ($e['ref'] ?: '#' . $e['id']) . ($e['supplier_name'] ? ' – ' . $e['supplier_name'] : '') . ($e['to_validate'] ? ' (à valider)' : '') . (!$e['due'] ? ' (échéance supposée à 30 jours)' : '') . ($date < $today ? ' – en retard' : ''),
            'ref' => ['type' => 'expense', 'id' => $e['id']], 'supplier' => $e['supplier'], 'doc_date' => $e['due'] ?: $e['date']];
    }
    // --- engagements confirmés
    foreach ($commitments as $c) {
        if ($c['status'] !== 'confirme') { if ($c['status'] === 'a_confirmer') $excluded[] = ['label' => $c['label'], 'reason' => 'à confirmer', 'amount' => $c['amount']]; continue; }
        $since = $c['account_id'] && !empty($accDate[$c['account_id']]) ? pil_add_days($accDate[$c['account_id']], 1) : ($latest ? pil_add_days($latest, 1) : $today); // (3)
        foreach (pil_commitment_flows($c, $since, $to) as $f) {
            if ($c['supplier_id']) { // (4)
                $hit = array_filter($docs['expenses'], fn($e) => $e['supplier'] === $c['supplier_id'] && ($e['due'] ?: $e['date']) && abs(pil_days($f['date'], $e['due'] ?: $e['date'])) <= 15);
                if ($hit) { $excluded[] = ['label' => $c['label'] . ' du ' . pil_d($f['date']), 'reason' => 'achat du même fournisseur déjà compté', 'amount' => -$f['amount']]; continue; }
            }
            $base[] = ['date' => max($today, $f['date']), 'amount' => $f['amount'], 'certainty' => 'confirme', 'source' => $c['kind'], 'category' => $c['subtype'],
                'label' => $c['label'] . ($f['detail'] ? ' – ' . $f['detail'] : '') . ($f['date'] < $today ? ' (échéance du ' . pil_d($f['date']) . ', après le dernier extrait)' : ''), 'ref' => ['type' => 'commitment', 'id' => $c['id']]];
        }
    }
    // --- factures clients : jamais certaines → toujours « estimé », par scénario
    $out = [];
    foreach ($hyp as $sk => $h) {
        $flows = $base;
        foreach ($docs['invoices'] as $i) {
            if ($i['kind'] === 'avoir') continue; // (6)
            if ($i['flag'] === 'conteste' || $i['ea'] === 'conteste') { if ($sk === 'realiste') $excluded[] = ['label' => 'Facture ' . ($i['number'] ?: '#' . $i['id']), 'reason' => 'contestée', 'amount' => $i['rest']]; continue; }
            if ($i['ea'] !== null) { // état d'avancement pas encore facturé
                if (!(($i['ea'] === 'approuve' && $h['includeEaApproved']) || ($i['ea'] === 'envoye' && $h['includeEaSent']))) continue;
                $ref = max($today, (string)($i['approve_by'] ?: $today));
                $due = pil_add_days($ref, $i['pay_days']);
            } else {
                if ($i['rest'] <= 0) continue;
                $due = (string)($i['due'] ?: $today);
            }
            $late = pil_days($due, $today);
            if ($h['excludeOverdueAfter'] !== null && $late > (int)$h['excludeOverdueAfter']) continue;
            $cs = $stats['clients'][$i['client']] ?? null;
            $src = $cs && $cs['n'] >= 2 ? $cs : ($stats['global']['n'] >= 3 ? $stats['global'] : null);
            $delay = $src ? (int)round((float)$src[$h['delay']]) : 0;
            $date = max($today, pil_add_days($due, $delay + (int)$h['extraDays']));
            $amount = $i['ea'] !== null ? $i['total'] : $i['rest'];
            $prob = 1.0;
            if ($h['useProbability'] && $late > 0) {
                $k = $late >= 90 ? 90 : ($late >= 60 ? 60 : ($late >= 30 ? 30 : 0));
                if ($stats['buckets'][$k]['p'] !== null) $prob = (float)$stats['buckets'][$k]['p'];
            }
            $amt = (int)round($amount * $prob);
            if ($amt <= 0) continue;
            $flows[] = ['date' => $date, 'amount' => $amt, 'certainty' => 'estime', 'source' => $i['ea'] !== null ? 'etat_avancement' : 'facture',
                'label' => ($i['ea'] !== null ? 'État d\'avancement ' . ($i['ea'] === 'approuve' ? 'approuvé' : 'envoyé') : 'Facture ' . ($i['number'] ?: '#' . $i['id'])) . ($i['client_name'] ? ' – ' . $i['client_name'] : '')
                    . ($late > 0 ? " – en retard de $late j" : '') . ($prob < 1 ? ' – ' . round($prob * 100) . ' % (probabilité observée)' : '') . ($delay ? ' – délai observé ' . ($delay > 0 ? '+' : '') . "$delay j" : ''),
                'ref' => ['type' => 'invoice', 'id' => $i['id']]];
        }
        // prudence (pessimiste) : supplément clairement identifié sur les sorties
        if ((float)$h['prudencePct'] > 0) {
            $byDay = [];
            foreach ($flows as $f) if ($f['amount'] < 0) $byDay[$f['date']] = ($byDay[$f['date']] ?? 0) + $f['amount'];
            foreach ($byDay as $d => $a) $flows[] = ['date' => $d, 'amount' => (int)round($a * (float)$h['prudencePct'] / 100), 'certainty' => 'estime', 'source' => 'prudence', 'label' => 'Marge de prudence +' . $h['prudencePct'] . ' % des sorties'];
        }
        usort($flows, fn($a, $b) => strcmp($a['date'], $b['date']) ?: $a['amount'] <=> $b['amount']);
        $out[$sk] = array_values(array_filter($flows, fn($f) => $f['date'] <= $to));
    }
    return ['flows' => $out, 'excluded' => $excluded];
}

/** Fiabilité (0–100) : extraits complets et récents, mouvements validés, rapprochement, achats validés, engagements confirmés. */
function pil_reliability(array $bal, array $docs, array $commitments): array {
    $f = [];
    $acc = $bal['accounts'];
    $fresh = $acc ? array_sum(array_map(fn($a) => $a['age_days'] === null ? 0 : max(0, min(1, 1 - ($a['age_days'] - 7) / 53)), $acc)) / count($acc) : 0;
    $breaks = 0; foreach (pil_dashboard()['accounts'] as $a) $breaks += count($a['breaks']);
    $f['extraits'] = ['label' => 'Extraits complets et récents', 'score' => round($fresh * ($breaks ? 0.5 : 1), 2), 'detail' => ($breaks ? "$breaks rupture(s) de solde, " : '') . implode(', ', array_map(fn($a) => $a['bank'] . ' : ' . ($a['date'] ? 'extrait du ' . pil_d($a['date']) : 'aucun extrait'), $acc))];
    $tx = q("SELECT COUNT(*) n, SUM(status = 'valide') v, SUM(category = 'encaissement_client') ci, SUM(category = 'encaissement_client' AND match_id IS NOT NULL) cm FROM pil_bank_tx WHERE company_id = ?", [cid()])->fetch();
    $f['valides'] = ['label' => 'Mouvements bancaires validés', 'score' => $tx['n'] ? round($tx['v'] / $tx['n'], 2) : 0, 'detail' => (int)$tx['v'] . ' / ' . (int)$tx['n']];
    $f['rapprochement'] = ['label' => 'Encaissements rapprochés des factures', 'score' => $tx['ci'] ? round($tx['cm'] / $tx['ci'], 2) : 0, 'detail' => (int)$tx['cm'] . ' / ' . (int)$tx['ci']];
    $open = array_filter($docs['expenses'], fn($e) => $e['rest'] > 0);
    $f['achats'] = ['label' => 'Achats à payer validés', 'score' => $open ? round(count(array_filter($open, fn($e) => !$e['to_validate'])) / count($open), 2) : 1, 'detail' => count(array_filter($open, fn($e) => !$e['to_validate'])) . ' / ' . count($open)];
    $cc = array_filter($commitments, fn($c) => in_array($c['status'], ['confirme', 'a_confirmer'], true));
    $f['engagements'] = ['label' => 'Charges et engagements confirmés', 'score' => $cc ? round(count(array_filter($cc, fn($c) => $c['status'] === 'confirme')) / count($cc), 2) : 0, 'detail' => count(array_filter($cc, fn($c) => $c['status'] === 'confirme')) . ' / ' . count($cc) . ($cc ? '' : ' (aucun engagement saisi)')];
    $w = ['extraits' => 30, 'valides' => 15, 'rapprochement' => 15, 'achats' => 15, 'engagements' => 25];
    $score = 0; foreach ($w as $k => $p) $score += $f[$k]['score'] * $p;
    return ['score' => (int)round($score), 'factors' => $f, 'level' => $score >= 75 ? 'bonne' : ($score >= 45 ? 'moyenne' : 'faible')];
}

/** Alertes : problème, montant, date, impact, risque, action. */
function pil_alerts(array $fc, array $docs, array $commitments, array $bal, string $today): array {
    $a = []; $real = $fc['scenarios']['realiste'];
    $add = function (string $code, string $risk, string $problem, ?int $amount, ?string $date, string $impact, string $action) use (&$a) { $a[] = compact('code', 'risk', 'problem', 'amount', 'date', 'impact', 'action'); };
    $neg = $real['horizons'][90]['negative_date'];
    if ($neg) $add('negatif', 'eleve', 'La trésorerie prévue (scénario réaliste) devient négative.', $real['horizons'][90]['min'], $neg, 'Point le plus bas ' . pil_fmt($real['horizons'][90]['min']) . ' le ' . pil_d($real['horizons'][90]['min_date']) . '.', 'Relancer les clients en retard, décaler les dépenses non obligatoires, contacter la banque (ligne de crédit) avant cette date.');
    elseif ($fc['scenarios']['pessimiste']['horizons'][90]['negative_date']) $add('negatif_pess', 'moyen', 'La trésorerie devient négative dans le scénario pessimiste.', $fc['scenarios']['pessimiste']['horizons'][90]['min'], $fc['scenarios']['pessimiste']['horizons'][90]['negative_date'], 'Risque si les clients paient en retard.', 'Surveiller les encaissements des factures en retard et préparer une solution de financement.');
    foreach ($bal['accounts'] as $x) if ($x['age_days'] !== null && $x['age_days'] > 10) $add('extrait_ancien', 'moyen', "Dernier extrait {$x['bank']} vieux de {$x['age_days']} jours.", $x['balance'], $x['date'], 'Le solde de départ des prévisions est ancien : la prévision est moins fiable.', 'Importer les derniers extraits de ce compte.');
    $bySet = $fc['scenarios']['realiste']['flows'];
    foreach ($commitments as $c) {
        if ($c['status'] !== 'confirme') continue;
        foreach (pil_commitment_flows($c, $today, pil_add_days($today, 7)) as $f) if (in_array($c['kind'], ['credit', 'leasing'], true))
            $add('echeance_credit', 'moyen', ($c['kind'] === 'credit' ? 'Échéance de crédit' : 'Échéance de leasing') . " : {$c['label']}.", -$f['amount'], $f['date'], 'Prélèvement automatique sur ' . ($c['account_id'] ? 'le compte prévu' : 'un compte non précisé') . '.', 'Vérifier que le compte débité est suffisamment approvisionné.');
        if (!empty($c['end_date']) && in_array($c['kind'], ['credit', 'leasing'], true) && $c['end_date'] >= $today && pil_days($today, $c['end_date']) <= 60)
            $add('fin_contrat', 'faible', ($c['kind'] === 'credit' ? 'Le crédit' : 'Le leasing') . " « {$c['label']} » arrive à échéance.", $c['kind'] === 'leasing' && $c['buyback'] ? $c['residual'] : null, $c['end_date'], $c['kind'] === 'leasing' && $c['buyback'] ? 'Valeur de rachat à payer.' : 'Fin des mensualités.', 'Décider du renouvellement, du rachat ou de la restitution.');
    }
    $late = array_filter($docs['invoices'], fn($i) => $i['ea'] === null && $i['kind'] !== 'avoir' && $i['rest'] > 0 && $i['due'] && $i['due'] < $today);
    usort($late, fn($x, $y) => $y['rest'] <=> $x['rest']);
    foreach (array_slice($late, 0, 15) as $i) { $d = pil_days($i['due'], $today);
        $add('facture_retard', $d > 60 ? 'eleve' : ($d > 30 ? 'moyen' : 'faible'), 'Facture ' . ($i['number'] ?: '#' . $i['id']) . ($i['client_name'] ? " ({$i['client_name']})" : '') . " impayée, en retard de $d jours." . ($i['flag'] === 'conteste' ? ' Contestée.' : ''), $i['rest'], $i['due'], 'Encaissement attendu non reçu.', $d > 60 ? 'Mise en demeure ou plan de paiement ; vérifier l\'existence d\'une contestation.' : 'Relancer le client (téléphone puis rappel écrit).'); }
    foreach ($docs['expenses'] as $e) {
        if ($e['rest'] <= 0 || !$e['due']) continue;
        $d = pil_days($today, $e['due']);
        if ($d <= 7) $add('achat_echeance', $d < 0 ? 'moyen' : 'faible', 'Facture fournisseur ' . ($e['ref'] ?: '#' . $e['id']) . ($e['supplier_name'] ? " ({$e['supplier_name']})" : '') . ($d < 0 ? ' échue depuis ' . -$d . ' jours.' : " à payer dans $d jour(s)."), $e['rest'], $e['due'], 'Sortie de trésorerie obligatoire.', $e['to_validate'] ? 'Valider la facture d\'achat puis programmer le paiement.' : 'Programmer le paiement (aucun paiement ne part d\'ici).');
    }
    // salaires et obligations sociales couverts ?
    foreach ($bySet as $f) {
        if (($f['source'] ?? '') !== 'charge' || !in_array($f['category'] ?? '', ['salaires', 'onss', 'precompte'], true) || pil_days($today, $f['date']) > 30) continue;
        $after = 0; foreach ($real['series'] as $s) if ($s['d'] === $f['date']) $after = $s['b'];
        if ($after < 0) $add('salaires', 'eleve', 'Salaires / obligations sociales non couverts : ' . $f['label'] . '.', -$f['amount'], $f['date'], 'Solde prévu après paiement : ' . pil_fmt($after) . '.', 'Priorité absolue : encaisser les créances, mobiliser une réserve ou une ligne de crédit avant cette date.');
    }
    // TVA
    $tva = array_filter($commitments, fn($c) => $c['status'] === 'confirme' && $c['subtype'] === 'tva');
    foreach ($tva as $c) foreach (pil_commitment_flows($c, $today, pil_add_days($today, 21)) as $f) $add('tva', 'moyen', "TVA à payer : {$c['label']}.", -$f['amount'], $f['date'], 'Paiement obligatoire au SPF Finances.', 'Vérifier le montant avec la déclaration du comptable et prévoir le virement.');
    if (!$tva) $add('tva_absente', 'faible', 'Aucune échéance de TVA enregistrée dans les charges.', null, null, 'La prévision ne contient pas les paiements de TVA.', 'Ajouter les échéances de TVA (montant communiqué par le comptable) dans Pilotage → Engagements.');
    // charges fixes vs encaissements habituels (6 derniers mois couverts par les extraits)
    $monthly = 0; foreach ($commitments as $c) if ($c['status'] === 'confirme' && $c['amount'] && ($k = PIL_FREQ[$c['frequency']][0] ?? 0)) $monthly += (int)round($c['amount'] / $k);
    $avgIn = (int)q("SELECT COALESCE(SUM(amount),0) / GREATEST(1, COUNT(DISTINCT DATE_FORMAT(booking_date,'%Y-%m'))) FROM pil_bank_tx WHERE company_id = ? AND amount > 0 AND category <> 'transfert_interne' AND booking_date >= ?", [cid(), pil_add_days($today, -183)])->fetchColumn();
    if ($monthly && $avgIn && $monthly > $avgIn) $add('charges_fixes', 'eleve', 'Les charges fixes confirmées dépassent les encaissements mensuels habituels.', $monthly, null, 'Charges ' . pil_fmt($monthly) . ' / mois contre ' . pil_fmt($avgIn) . ' d\'encaissements moyens (6 derniers mois).', 'Revoir les charges fixes et accélérer la facturation des chantiers.');
    $order = ['eleve' => 0, 'moyen' => 1, 'faible' => 2];
    usort($a, fn($x, $y) => $order[$x['risk']] <=> $order[$y['risk']] ?: strcmp((string)$x['date'], (string)$y['date']));
    return $a;
}

/** Prévision complète (3 scénarios × 7/30/90 jours), alertes et fiabilité. */
function pil_forecast(string $today): array {
    $bal = pil_balances($today); $docs = pil_docs(); $com = pil_commitments(); $hyp = pil_hypotheses();
    $stats = pil_delay_stats(array_map(fn($i) => ['client' => $i['client'], 'due' => $i['due'], 'paid_date' => $i['paid_date']], array_filter($docs['invoices'], fn($i) => $i['ea'] === null && $i['kind'] !== 'avoir' && $i['total'] > 0)), $today);
    $c = pil_collect_flows($docs, $com, $bal, $stats, $hyp, $today);
    $adj = array_sum(array_map(fn($f) => $f['amount'], array_filter($c['flows']['realiste'], fn($f) => $f['source'] === 'paiement_non_vu')));
    $sc = [];
    foreach ($c['flows'] as $k => $flows) $sc[$k] = ['label' => $hyp[$k]['label'], 'flows' => $flows] + pil_project($bal['total'], $flows, $today);
    $fc = ['today' => $today, 'balances' => $bal + ['adjustment' => $adj], 'hypotheses' => $hyp, 'stats' => ['global' => $stats['global'], 'buckets' => $stats['buckets'], 'clients' => count($stats['clients'])],
        'scenarios' => $sc, 'excluded' => $c['excluded']];
    $fc['alerts'] = pil_alerts($fc, $docs, $com, $bal, $today);
    $fc['reliability'] = pil_reliability($bal, $docs, $com);
    return $fc;
}

/** Créances et dettes : factures clients et fournisseurs avec leur état (pour l'écran « Factures et échéances »). */
function pil_receivables(string $today): array {
    $docs = pil_docs();
    $st = function (array $i) use ($today) {
        if ($i['ea'] !== null) return ['envoye' => 'attente_approbation', 'approuve' => 'approuve_a_facturer', 'conteste' => 'conteste'][$i['ea']] ?? 'brouillon_ea';
        if ($i['flag'] === 'conteste') return 'conteste';
        if ($i['rest'] <= 0) return 'paye';
        if ($i['paid'] > 0) return $i['due'] && $i['due'] < $today ? 'partiel_echu' : 'partiel';
        return $i['due'] && $i['due'] < $today ? 'echu' : 'non_echu';
    };
    $inv = []; foreach ($docs['invoices'] as $i) if ($i['kind'] !== 'avoir') { unset($i['payments']); $inv[] = $i + ['state' => $st($i), 'late_days' => $i['due'] && $i['rest'] > 0 ? max(0, pil_days($i['due'], $today)) : 0]; }
    $exp = []; foreach ($docs['expenses'] as $e) { $n = count($e['payments']); unset($e['payments']); $exp[] = $e + ['payments_count' => $n, 'state' => $e['rest'] <= 0 ? 'paye' : ($e['to_validate'] ? 'a_valider' : ($e['paid'] > 0 ? 'partiel' : ($e['due'] && $e['due'] < $today ? 'echu' : 'engage')))]; }
    return ['invoices' => $inv, 'expenses' => $exp];
}

/** Charges récurrentes probables dans les extraits (12 derniers mois) : PROPOSITIONS, rien n'est ajouté sans l'utilisateur. */
function pil_detect_recurring(string $today): array {
    $rows = q("SELECT booking_date, amount, cp_iban, cp_name, name_fix, category FROM pil_bank_tx WHERE company_id = ? AND amount < 0 AND category NOT IN ('transfert_interne') AND booking_date >= ?", [cid(), pil_add_days($today, -366)])->fetchAll();
    $g = [];
    foreach ($rows as $r) { $k = pil_learn_key((string)$r['cp_iban'], (string)($r['name_fix'] ?: $r['cp_name'])); if ($k === '') continue; $g[$k][] = $r; }
    $known = array_filter(array_column(q('SELECT detect_key FROM pil_commitments WHERE company_id = ? AND detect_key IS NOT NULL', [cid()])->fetchAll(), 'detect_key'));
    $out = [];
    foreach ($g as $k => $list) {
        $months = array_unique(array_map(fn($r) => substr($r['booking_date'], 0, 7), $list));
        if (count($months) < 3) continue;
        $amts = array_map(fn($r) => -(int)$r['amount'], $list);
        if (max($amts) > 1.2 * min($amts)) continue; // montants trop variables : pas une charge fixe
        if (count($list) > count($months) * 1.5) continue; // plusieurs fois par mois : achats courants
        $cats = array_count_values(array_column($list, 'category')); arsort($cats); $cat = (string)array_key_first($cats);
        $last = max(array_column($list, 'booking_date'));
        $out[] = ['key' => $k, 'label' => (string)($list[0]['name_fix'] ?: $list[0]['cp_name']) ?: $k, 'iban' => $list[0]['cp_iban'], 'months' => count($months), 'count' => count($list),
            'amount' => (int)pil_percentile($amts, 50), 'min' => min($amts), 'max' => max($amts), 'last' => $last, 'next' => pil_add_months($last, 1), 'category' => $cat,
            'kind' => $cat === 'credit' ? 'credit' : ($cat === 'leasing' ? 'leasing' : 'charge'), 'already' => in_array($k, $known, true)];
    }
    usort($out, fn($a, $b) => $b['amount'] <=> $a['amount']);
    return $out;
}

// ===================================================================== Routes : api.php?r=pilot/...
function pil_treasury_route(string $method, array $seg, array $me): void {
    pil_treasury_schema();
    $sub = $seg[1]; $id = isset($seg[2]) ? (int)$seg[2] : 0;
    // date du jour imposable pour les tests et l'analyse « au … » (lecture seule)
    $today = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['today'] ?? '')) ? $_GET['today'] : date('Y-m-d');
    switch ($sub) {
        case 'forecast': if ($method === 'GET') out(pil_forecast($today)); break;
        case 'receivables': if ($method === 'GET') out(pil_receivables($today)); break;
        case 'hypotheses':
            if ($method === 'GET') out(pil_hypotheses());
            if ($method === 'PUT') {
                $b = body(); $new = [];
                foreach (PIL_HYP_DEFAULT as $k => $def) {
                    $v = (array)($b[$k] ?? []);
                    $new[$k] = ['delay' => in_array($v['delay'] ?? '', ['p25', 'median', 'p75'], true) ? $v['delay'] : $def['delay'], 'extraDays' => max(0, min(180, (int)($v['extraDays'] ?? $def['extraDays']))),
                        'useProbability' => !empty($v['useProbability']), 'excludeOverdueAfter' => ($v['excludeOverdueAfter'] ?? null) === null || $v['excludeOverdueAfter'] === '' ? null : max(0, (int)$v['excludeOverdueAfter']),
                        'includeEaSent' => !empty($v['includeEaSent']), 'includeEaApproved' => !empty($v['includeEaApproved']), 'prudencePct' => max(0, min(50, (float)($v['prudencePct'] ?? 0)))];
                }
                set_setting('pilotage_hyp', $new);
                log_activity($me['id'], 'update', 'settings', null, null, 'Hypothèses des prévisions de trésorerie');
                out(pil_hypotheses());
            }
            break;
        case 'flags':
            if ($method === 'PUT' && $id) {
                $b = body(); $flag = (string)($b['flag'] ?? '');
                if (!q("SELECT id FROM items WHERE id = ? AND company_id = ? AND type = 'invoice'", [$id, cid()])->fetch()) fail(404, 'Facture introuvable');
                if ($flag === '') q('DELETE FROM pil_doc_flags WHERE company_id = ? AND item_id = ?', [cid(), $id]);
                elseif ($flag === 'conteste') q('REPLACE INTO pil_doc_flags (company_id, item_id, flag, note, flagged_by, flagged_at) VALUES (?,?,?,?,?,?)', [cid(), $id, $flag, mb_substr(trim((string)($b['note'] ?? '')), 0, 255), $me['id'], now()]);
                else fail(400, 'Statut inconnu');
                log_activity($me['id'], 'update', 'invoice', $id, null, $flag ? 'Facture marquée contestée (Pilotage)' : 'Contestation retirée (Pilotage)');
                out(['ok' => true]);
            }
            break;
        case 'commitments':
            if ($method === 'GET' && !$id && ($seg[2] ?? '') === 'detect') out(pil_detect_recurring($today));
            if ($method === 'GET' && !$id) {
                $list = pil_commitments();
                foreach ($list as &$c) {
                    $year = pil_commitment_flows($c, $today, pil_add_days($today, 365));
                    $c['next_flows'] = array_slice($year, 0, 6);
                    $c['next_12m'] = -array_sum(array_column($year, 'amount'));
                    if ($c['kind'] === 'credit') { $s = pil_credit_schedule($c, $today, '2100-12-31'); $c['remaining_now'] = pil_credit_schedule($c, $today, $today)['remaining']; $c['schedule_notes'] = $s['notes']; $c['remaining_total'] = -array_sum(array_map(fn($r) => -$r['amount'], $s['rows'])); }
                    if ($c['kind'] === 'leasing') { $all = pil_commitment_flows($c, $today, '2100-12-31'); $c['remaining_total'] = -array_sum(array_column($all, 'amount')); }
                } unset($c);
                out($list);
            }
            if ($method === 'GET' && $id && ($seg[3] ?? '') === 'doc') {
                $r = q('SELECT docs FROM pil_commitments WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                $docs = $r ? (json_decode((string)$r['docs'], true) ?: []) : []; $d = $docs[(int)($seg[4] ?? -1)] ?? null;
                $path = $d ? dirname(__DIR__) . '/uploads/' . $d['stored'] : '';
                if (!$d || !is_file($path)) fail(404, 'Document introuvable');
                header('Content-Type: ' . ($d['mime'] ?? 'application/octet-stream')); header('Content-Disposition: attachment; filename="' . str_replace('"', '', $d['name']) . '"'); header('X-Content-Type-Options: nosniff');
                readfile($path); exit;
            }
            if ($method === 'POST' && $id && ($seg[3] ?? '') === 'doc') {
                $r = q('SELECT docs FROM pil_commitments WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                if (!$r) fail(404, 'Engagement introuvable');
                $f = $_FILES['file'] ?? null;
                if (!$f || $f['error'] !== UPLOAD_ERR_OK) fail(400, 'Envoi du fichier échoué.');
                $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
                if (!in_array($ext, ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'], true)) fail(400, "Type de fichier non autorisé (.$ext).");
                if ($f['size'] > 20 * 1024 * 1024) fail(400, 'Fichier trop volumineux (max. 20 Mo).');
                $dir = dirname(__DIR__) . '/uploads/pilotage/' . cid() . '/docs';
                if (!is_dir($dir)) mkdir($dir, 0750, true);
                if (!is_file(dirname($dir) . '/.htaccess')) file_put_contents(dirname($dir) . '/.htaccess', "Require all denied\nDeny from all\n");
                $rel = 'pilotage/' . cid() . '/docs/' . bin2hex(random_bytes(16)) . ".$ext";
                if (!move_uploaded_file($f['tmp_name'], dirname(__DIR__) . "/uploads/$rel")) fail(500, 'Impossible d\'enregistrer le fichier.');
                $docs = json_decode((string)$r['docs'], true) ?: [];
                $docs[] = ['name' => preg_replace('/[\x00-\x1f\/\\\\"]/', '_', (string)$f['name']), 'stored' => $rel, 'mime' => class_exists('finfo') ? ((new finfo(FILEINFO_MIME_TYPE))->file(dirname(__DIR__) . "/uploads/$rel") ?: 'application/octet-stream') : 'application/octet-stream', 'size' => (int)$f['size'], 'at' => now(), 'by' => $me['id']];
                q('UPDATE pil_commitments SET docs = ?, updated_by = ?, updated_at = ? WHERE id = ? AND company_id = ?', [json_encode($docs, JSON_UNESCAPED_UNICODE), $me['id'], now(), $id, cid()]);
                out(pil_commitment_out(q('SELECT * FROM pil_commitments WHERE id = ?', [$id])->fetch()));
            }
            if ($method === 'POST' && !$id) out(pil_commitment_save(null, body(), $me));
            if ($method === 'PUT' && $id) out(pil_commitment_save($id, body(), $me));
            if ($method === 'DELETE' && $id) {
                $r = q('SELECT label FROM pil_commitments WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                if (!$r) fail(404, 'Engagement introuvable');
                q('DELETE FROM pil_commitments WHERE id = ? AND company_id = ?', [$id, cid()]);
                log_activity($me['id'], 'delete', 'commitment', $id, null, 'Engagement supprimé : ' . $r['label']);
                out(['ok' => true]);
            }
            break;
    }
    fail(404, 'Route inconnue');
}

function pil_commitment_save(?int $id, array $b, array $me): array {
    $kind = (string)($b['kind'] ?? '');
    if (!isset(PIL_KINDS[$kind])) fail(400, 'Type d\'engagement inconnu.');
    $sub = (string)($b['subtype'] ?? 'autre'); if (!isset(PIL_KINDS[$kind][1][$sub])) $sub = 'autre';
    $label = trim((string)($b['label'] ?? '')); if ($label === '') fail(400, 'Indiquez un libellé.');
    $freq = (string)($b['frequency'] ?? 'mensuel'); if (!isset(PIL_FREQ[$freq])) fail(400, 'Fréquence inconnue.');
    $date = function ($v, string $name) { if ($v === null || $v === '') return null; if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) fail(400, "Date invalide : $name."); return (string)$v; };
    $cents = function ($v, string $name) { if ($v === null || $v === '') return null; if (!is_numeric($v) || (float)$v < 0) fail(400, "Montant invalide : $name."); return (int)round((float)$v); };
    $acc = !empty($b['account_id']) ? (int)$b['account_id'] : null;
    if ($acc && !q('SELECT id FROM pil_bank_accounts WHERE id = ? AND company_id = ?', [$acc, cid()])->fetch()) fail(400, 'Compte bancaire inconnu.');
    $sup = !empty($b['supplier_id']) ? (int)$b['supplier_id'] : null;
    if ($sup && !q("SELECT id FROM items WHERE id = ? AND company_id = ? AND type = 'contact'", [$sup, cid()])->fetch()) fail(400, 'Fournisseur inconnu.');
    $status = (string)($b['status'] ?? 'confirme'); if (!in_array($status, ['a_confirmer', 'confirme', 'suspendu', 'termine'], true)) fail(400, 'Statut inconnu.');
    $v = ['kind' => $kind, 'subtype' => $sub, 'label' => mb_substr($label, 0, 190), 'lender' => mb_substr(trim((string)($b['lender'] ?? '')), 0, 120), 'account_id' => $acc, 'supplier_id' => $sup,
        'amount' => $cents($b['amount'] ?? null, 'montant'), 'frequency' => $freq, 'next_date' => $date($b['next_date'] ?? null, 'prochaine échéance'), 'start_date' => $date($b['start_date'] ?? null, 'début'),
        'end_date' => $date($b['end_date'] ?? null, 'fin'), 'capital_initial' => $cents($b['capital_initial'] ?? null, 'capital initial'), 'capital_remaining' => $cents($b['capital_remaining'] ?? null, 'capital restant'),
        'capital_asof' => $date($b['capital_asof'] ?? null, 'date du capital restant'), 'rate' => ($b['rate'] ?? '') === '' || $b['rate'] === null ? null : (float)$b['rate'],
        'repayment' => ($b['repayment'] ?? '') === 'in_fine' ? 'in_fine' : 'mensualites', 'residual' => $cents($b['residual'] ?? null, 'valeur de rachat'), 'buyback' => empty($b['buyback']) ? 0 : 1,
        'guarantees' => mb_substr(trim((string)($b['guarantees'] ?? '')), 0, 255), 'notes' => trim((string)($b['notes'] ?? '')) ?: null, 'status' => $status];
    if ($v['next_date'] && $v['end_date'] && $v['end_date'] < $v['next_date']) fail(400, 'La date de fin précède la prochaine échéance.');
    if ($v['rate'] !== null && ($v['rate'] < 0 || $v['rate'] > 50)) fail(400, 'Taux d\'intérêt invalide (en %).');
    if ($v['capital_remaining'] !== null && $v['capital_asof'] === null) $v['capital_asof'] = $v['next_date'] ? pil_add_days($v['next_date'], -1) : date('Y-m-d');
    if ($id) {
        $cur = q('SELECT * FROM pil_commitments WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
        if (!$cur) fail(404, 'Engagement introuvable');
        $conf = $status === 'confirme' && $cur['status'] !== 'confirme';
        $set = implode(', ', array_map(fn($k) => "$k = ?", array_keys($v))) . ', updated_by = ?, updated_at = ?' . ($conf ? ', confirmed_by = ?, confirmed_at = ?' : '');
        q("UPDATE pil_commitments SET $set WHERE id = ? AND company_id = ?", array_merge(array_values($v), [$me['id'], now()], $conf ? [$me['id'], now()] : [], [$id, cid()]));
        log_activity($me['id'], 'update', 'commitment', $id, null, ($conf ? 'Engagement confirmé : ' : 'Engagement modifié : ') . $v['label']);
    } else {
        $v += ['source' => ($b['source'] ?? '') === 'detecte' ? 'detecte' : 'manuel', 'detect_key' => ($b['detect_key'] ?? '') !== '' ? mb_substr((string)$b['detect_key'], 0, 190) : null];
        if ($v['source'] === 'detecte') $v['status'] = 'a_confirmer'; // détecté dans les extraits : toujours à confirmer par l'utilisateur
        $v += ['created_by' => $me['id'], 'created_at' => now(), 'confirmed_by' => $v['status'] === 'confirme' ? $me['id'] : null, 'confirmed_at' => $v['status'] === 'confirme' ? now() : null];
        q('INSERT INTO pil_commitments (company_id, ' . implode(', ', array_keys($v)) . ') VALUES (?' . str_repeat(',?', count($v)) . ')', array_merge([cid()], array_values($v)));
        $id = (int)db()->lastInsertId();
        log_activity($me['id'], 'create', 'commitment', $id, null, 'Engagement ajouté : ' . $v['label']);
    }
    return pil_commitment_out(q('SELECT * FROM pil_commitments WHERE id = ?', [$id])->fetch());
}
