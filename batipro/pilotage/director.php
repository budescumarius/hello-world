<?php
// PILOTAGE MADIBU – étape 4 : « AI Director » – analyse automatique, alertes suivies, rapport quotidien, assistant.
// Séparation stricte :
//   1. calculs déterministes en PHP (chantiers, risques, rapport, comparaisons, revue des prévisions) – ce fichier ;
//   2. requêtes métier contrôlées (pil_tool_*) : seules données que l'IA peut demander, jamais de SQL libre ;
//   3. l'IA (Claude) explique et priorise à partir de ces résultats ; chaque montant qu'elle écrit est vérifié.
// Montants en centimes entiers.
declare(strict_types=1);
require_once __DIR__ . '/treasury.php';

const PIL_SEV = ['critique' => 0, 'elevee' => 1, 'moyenne' => 2, 'faible' => 3];
const PIL_AST = ['nouvelle', 'en_cours', 'resolue', 'ignoree'];
const PIL_MARGIN_MIN = 10; // % : marge finale jugée insuffisante en dessous (réglable : setting pilotage_director.marginMin)

function pil_director_schema(): void {
    static $done = false; if ($done) return; $done = true;
    pil_treasury_schema();
    if (q("SHOW TABLES LIKE 'pil_alerts'")->fetch()) return;
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_alerts (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, akey VARCHAR(120) NOT NULL, category VARCHAR(20) NOT NULL, severity VARCHAR(10) NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT NULL, amount BIGINT NULL, entity_type VARCHAR(20) NULL, entity_id INT NULL, entity_label VARCHAR(190) NULL,
        data TEXT NULL, calc TEXT NULL, action TEXT NULL, owner VARCHAR(120) NULL, due DATE NULL, status VARCHAR(10) NOT NULL DEFAULT 'nouvelle',
        first_seen DATE NOT NULL, last_seen DATE NOT NULL, occurrences INT NOT NULL DEFAULT 1, resolved_at DATETIME NULL, history TEXT NULL, updated_at DATETIME NOT NULL,
        UNIQUE KEY company_key (company_id, akey), KEY company_status (company_id, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_reports (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, rdate DATE NOT NULL, data MEDIUMTEXT NOT NULL, hash CHAR(64) NOT NULL, ai_comment TEXT NULL, ai_check TEXT NULL,
        source VARCHAR(10) NOT NULL DEFAULT 'manuel', version INT NOT NULL DEFAULT 1, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
        UNIQUE KEY company_date (company_id, rdate)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_decisions (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, rdate DATE NOT NULL, alert_id INT NULL, text TEXT NOT NULL, kind VARCHAR(12) NOT NULL DEFAULT 'decision',
        status VARCHAR(12) NOT NULL DEFAULT 'decidee', created_by INT NULL, created_at DATETIME NOT NULL, done_by INT NULL, done_at DATETIME NULL,
        KEY company_date (company_id, rdate)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_ai_convs (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, user_id INT NOT NULL, title VARCHAR(190) NOT NULL, turns MEDIUMTEXT NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
        KEY company_user (company_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_runs (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, rdate DATE NOT NULL, source VARCHAR(10) NOT NULL, started_at DATETIME NOT NULL, finished_at DATETIME NULL,
        status VARCHAR(10) NOT NULL DEFAULT 'en_cours', message TEXT NULL, KEY company_date (company_id, rdate)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

// ===================================================================== Données BatiPro (lecture seule)
function pil_items(array $types): array {
    $out = array_fill_keys($types, []);
    $in = implode(',', array_fill(0, count($types), '?'));
    foreach (q("SELECT id, type, project_id, number, data FROM items WHERE company_id = ? AND type IN ($in)", array_merge([cid()], $types))->fetchAll() as $r)
        $out[$r['type']][] = ['id' => (int)$r['id'], 'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null, 'number' => $r['number'], 'data' => json_decode((string)$r['data'], true) ?: []];
    return $out;
}
function pil_c(float $euros): int { return (int)round($euros * 100); }
function pil_users(): array { return array_column(q('SELECT id, name, role FROM users WHERE company_id = ? AND active = 1', [cid()])->fetchAll(), null, 'id'); }
function pil_direction(): string {
    $a = array_values(array_filter(pil_users(), fn($u) => $u['role'] === 'admin'));
    return 'Direction' . ($a ? ' (' . $a[0]['name'] . ')' : '');
}
function pil_contact_label(array $c): string { $d = $c['data']; return (string)($d['company'] ?? '') ?: trim(($d['firstname'] ?? '') . ' ' . ($d['name'] ?? '')); }

// ===================================================================== Analyse des chantiers
function pil_projects_analysis(string $today, ?array $all = null): array {
    $all = $all ?? pil_items(['project', 'quote', 'invoice', 'expense', 'timesheet', 'order', 'contact']);
    $co = setting('company', []) ?: []; $defVat = isset($co['defaultVat']) ? pil_num($co['defaultVat']) : 21.0;
    $users = pil_users(); $contacts = array_column($all['contact'], null, 'id');
    $by = fn(string $t, int $pid) => array_values(array_filter($all[$t], fn($x) => $x['project_id'] === $pid));
    $minPct = (float)((setting('pilotage_director', []) ?: [])['marginMin'] ?? PIL_MARGIN_MIN);
    $out = [];
    foreach ($all['project'] as $p) {
        $pd = $p['data']; $st = (string)($pd['status'] ?? '');
        if (in_array($st, ['prospect', 'annule'], true)) continue;
        $pid = $p['id'];
        $quotes = $by('quote', $pid); $invoices = $by('invoice', $pid); $ts = $by('timesheet', $pid);
        $f = pil_project_finance($p, ['quote' => $quotes, 'invoice' => $invoices, 'expense' => $all['expense'], 'timesheet' => $ts, 'order' => $by('order', $pid)], $today);
        $main = 0.0; $avAcc = 0.0; $avPending = [];
        foreach ($quotes as $q) {
            $qd = $q['data']; $t = pil_doc_totals($qd);
            if (!empty($qd['estimate'])) continue;
            if (!empty($qd['avenantOf'])) {
                if (($qd['status'] ?? '') === 'accepte') $avAcc += $t['base'];
                elseif (in_array($qd['status'] ?? '', ['brouillon', 'envoye'], true)) $avPending[] = ['id' => $q['id'], 'number' => $q['number'], 'no' => $qd['avenantNo'] ?? null, 'amount' => pil_c($t['base']), 'status' => $qd['status'], 'date' => $qd['date'] ?? null, 'age' => !empty($qd['date']) ? pil_days($qd['date'], $today) : null];
            } elseif (($qd['status'] ?? '') === 'accepte') $main += $t['base'];
        }
        // coûts par nature ; payé = part payée de chaque achat (TTC payé / TTC total) appliquée au montant HT ventilé
        $paidCost = 0.0; $suppliers = [];
        foreach ($all['expense'] as $e) {
            if (!empty($e['data']['refused'])) continue;
            $parts = array_filter(pil_expense_parts($e), fn($x) => $x['pid'] === $pid); if (!$parts) continue;
            $tot = pil_purch_total($e['data'], $defVat); $ratio = $tot > 0 ? min(1, pil_purch_paid($e['data'], $defVat) / $tot) : 0;
            foreach ($parts as $x) { $paidCost += $x['amount'] * $ratio; $sid = (int)($e['data']['supplierId'] ?? 0); if ($sid) $suppliers[$sid] = ($suppliers[$sid] ?? 0) + $x['amount']; }
        }
        $rb = $f['realBy']; $labour = $rb['mo'] ?? 0; $sub = $rb['st'] ?? 0; $purch = ($rb['mat'] ?? 0) + ($rb['materiel'] ?? 0); $other = $f['real'] - $labour - $sub - $purch;
        $eaToBill = 0.0;
        foreach ($invoices as $i) if (($i['data']['kind'] ?? '') === 'situation' && ($i['data']['status'] ?? '') !== 'emise' && ((($i['data']['ea'] ?? [])['status'] ?? '') === 'approuve')) $eaToBill += pil_doc_totals($i['data'])['base'];
        $engagedTotal = $f['real'] + $f['engaged'];
        $progBill = $f['budget'] > 0 ? $f['invoiced'] / $f['budget'] : null;
        $progCost = $f['est'] > 0 ? $engagedTotal / $f['est'] : null;
        $mgr = (int)($pd['managerId'] ?? 0);
        $out[] = ['id' => $pid, 'number' => $p['number'], 'name' => (string)($pd['name'] ?? ''), 'status' => $st, 'client' => isset($contacts[(int)($pd['clientId'] ?? 0)]) ? pil_contact_label($contacts[(int)$pd['clientId']]) : '',
            'manager' => $mgr && isset($users[$mgr]) ? $users[$mgr]['name'] : null, 'start' => $pd['start'] ?? null, 'end' => $pd['end'] ?? null,
            'quote_main' => pil_c($main), 'avenants_accepted' => pil_c($avAcc), 'avenants_pending' => $avPending, 'contract' => pil_c($f['budget']), 'contract_from_quotes' => $main + $avAcc > 0,
            'invoiced' => pil_c($f['invoiced']), 'cashed' => pil_c($f['cashed']), 'due' => pil_c($f['due']),
            'cost_purchases' => pil_c($purch), 'cost_subcontracting' => pil_c($sub), 'cost_labour' => pil_c($labour), 'cost_other' => pil_c($other), 'hours' => $f['hours'],
            'cost_invoiced' => pil_c($f['real'] - $labour), 'cost_engaged' => pil_c($engagedTotal), 'cost_open_orders' => pil_c($f['engaged']), 'cost_paid' => pil_c($paidCost),
            'cost_estimated' => pil_c($f['est']), 'cost_remaining' => $f['est'] > 0 ? pil_c(max(0, $f['est'] - $engagedTotal)) : null,
            'margin_planned' => $f['est'] > 0 ? pil_c($f['budget'] - $f['est']) : null, 'margin_to_date' => pil_c($f['invoiced'] - $f['real']), 'margin_final' => pil_c($f['margin']),
            'margin_final_pct' => $f['budget'] > 0 ? round($f['margin'] / $f['budget'] * 100, 1) : null, 'margin_min_pct' => $minPct,
            'progress_billing' => $progBill !== null ? round($progBill * 100, 1) : null, 'progress_cost' => $progCost !== null ? round($progCost * 100, 1) : null,
            'ea_to_bill' => pil_c($eaToBill), 'late_days' => !empty($pd['end']) && in_array($st, ['preparation', 'encours'], true) && $pd['end'] < $today ? pil_days($pd['end'], $today) : 0,
            'top_suppliers' => $suppliers];
    }
    return $out;
}

// ===================================================================== Détection des risques (seulement avec des données identifiables)
function pil_risk_candidates(string $today, ?array $fc = null): array {
    $all = pil_items(['project', 'quote', 'invoice', 'expense', 'timesheet', 'order', 'contact']);
    $fc = $fc ?? pil_forecast($today);
    $dir = pil_direction(); $c = [];
    $contacts = array_column($all['contact'], null, 'id');
    $due = fn(string $sev, ?string $limit = null) => min($limit ?? '9999-12-31', pil_add_days($today, ['critique' => 1, 'elevee' => 3, 'moyenne' => 7, 'faible' => 14][$sev]));
    $add = function (array $a) use (&$c) { $c[$a['akey']] = $a; };
    $mk = fn(string $key, string $cat, string $sev, string $title, string $desc, ?int $amount, ?array $ent, array $data, string $calc, string $action, string $owner, string $dueDate)
        => ['akey' => $key, 'category' => $cat, 'severity' => $sev, 'title' => $title, 'description' => $desc, 'amount' => $amount, 'entity_type' => $ent['type'] ?? null, 'entity_id' => $ent['id'] ?? null,
            'entity_label' => $ent['label'] ?? null, 'data' => $data, 'calc' => $calc, 'action' => $action, 'owner' => $owner, 'due' => $dueDate];

    // --- trésorerie (prévisions de l'étape 3)
    $r = $fc['scenarios']['realiste']['horizons'][90];
    if ($r['negative_date']) { $sev = pil_days($today, $r['negative_date']) <= 30 ? 'critique' : 'elevee';
        $add($mk('tresorerie:negatif', 'tresorerie', $sev, 'Déficit de trésorerie prévisible le ' . pil_d($r['negative_date']), "Scénario réaliste : le solde consolidé passe sous zéro le " . pil_d($r['negative_date']) . ' et descend jusqu\'à ' . pil_fmt($r['min']) . ' le ' . pil_d($r['min_date']) . '.', $r['min'], null,
            ['Solde de départ' => pil_fmt($r['start']), 'Entrées prévues 90 j' => pil_fmt($r['in_confirmed'] + $r['in_estimated']), 'Sorties prévues 90 j' => pil_fmt($r['out_confirmed'] + $r['out_estimated']), 'Fiabilité de la prévision' => $fc['reliability']['score'] . ' / 100'],
            'Solde des derniers extraits + flux prévus jour par jour (factures au délai médian observé, achats à l\'échéance, engagements confirmés).', 'Accélérer les encaissements en retard, reporter les dépenses non obligatoires, négocier une ligne de crédit avant cette date.', $dir, $due($sev, $r['negative_date']))); }
    foreach ($fc['alerts'] as $a) {
        if ($a['code'] === 'salaires') $add($mk('tresorerie:salaires:' . $a['date'], 'tresorerie', 'critique', 'Salaires / obligations sociales non couverts', $a['problem'] . ' ' . $a['impact'], $a['amount'], null, ['Échéance' => pil_d($a['date'])], 'Solde prévu (scénario réaliste) juste après le paiement de l\'échéance.', $a['action'], $dir, $due('critique', $a['date'])));
        if ($a['code'] === 'charges_fixes') $add($mk('structure:charges_fixes', 'structure', 'elevee', 'Charges fixes trop élevées par rapport aux recettes', $a['impact'], $a['amount'], null, ['Charges fixes confirmées / mois' => pil_fmt((int)$a['amount'])], 'Somme mensualisée des charges et engagements confirmés comparée à la moyenne mensuelle des entrées bancaires (hors transferts internes) des 6 derniers mois.', $a['action'], $dir, $due('elevee')));
        if ($a['code'] === 'tva') $add($mk('obligation:tva:' . $a['date'], 'decaissements', 'moyenne', 'TVA à payer le ' . pil_d($a['date']), $a['problem'], $a['amount'], null, ['Échéance' => pil_d($a['date'])], 'Échéance de TVA enregistrée dans les engagements.', $a['action'], 'Comptabilité', $due('moyenne', $a['date'])));
        if ($a['code'] === 'echeance_credit') $add($mk('obligation:credit:' . md5($a['problem']) . ':' . $a['date'], 'decaissements', 'moyenne', $a['problem'], $a['impact'], $a['amount'], null, ['Échéance' => pil_d($a['date'])], 'Échéancier du registre des engagements.', $a['action'], $dir, $due('moyenne', $a['date'])));
        if ($a['code'] === 'extrait_ancien') $add($mk('donnees:extrait:' . md5($a['problem']), 'donnees', 'moyenne', $a['problem'], $a['impact'], $a['amount'], null, ['Dernier extrait' => pil_d($a['date'])], 'Date du dernier extrait importé comparée à aujourd\'hui (alerte au-delà de 10 jours).', $a['action'], $dir, $due('moyenne')));
    }
    // --- clients : factures non encaissées, dépendance
    $byClient = []; $total12 = 0;
    foreach ($all['invoice'] as $i) {
        $d = $i['data']; if (in_array($d['kind'] ?? '', ['proforma'], true) || ($d['status'] ?? '') !== 'emise') continue;
        $s = pil_inv_state($i, $today); $cl = (int)($d['clientId'] ?? 0); $cname = isset($contacts[$cl]) ? pil_contact_label($contacts[$cl]) : 'client inconnu';
        if (($d['date'] ?? '') >= pil_add_days($today, -365) && $s['s'] !== 'avoir') { $byClient[$cl] = ($byClient[$cl] ?? 0) + pil_c($s['t']['base']); $total12 += pil_c($s['t']['base']); }
        if ($s['s'] !== 'retard') continue;
        $late = pil_days($d['due'], $today); $sev = $late > 90 ? 'elevee' : ($late > 30 ? 'moyenne' : 'faible');
        $add($mk('encaissement:facture:' . $i['id'], 'encaissements', $sev, 'Facture ' . ($i['number'] ?: '#' . $i['id']) . " non encaissée ($cname)", "Échue depuis le " . pil_d($d['due']) . " ($late jours), reste " . pil_fmt(pil_c($s['rest'])) . '.', pil_c($s['rest']), ['type' => 'invoice', 'id' => $i['id'], 'label' => $cname],
            ['Total TTC' => pil_fmt(pil_c($s['t']['total'])), 'Déjà payé' => pil_fmt(pil_c($s['paid'])), 'Échéance' => pil_d($d['due'])], 'Reste = total TTC − paiements enregistrés dans BâtiPro ; retard = aujourd\'hui − échéance.',
            $late > 60 ? 'Mise en demeure ou plan de paiement ; vérifier une éventuelle contestation.' : 'Relancer le client (appel puis rappel écrit).', 'Bureau (facturation)', $due($sev)));
    }
    if ($total12 > 0 && count($byClient) >= 2) { arsort($byClient); $top = (int)array_key_first($byClient); $share = $byClient[$top] / $total12 * 100;
        if ($share >= 40) { $cname = isset($contacts[$top]) ? pil_contact_label($contacts[$top]) : 'client inconnu'; $sev = $share >= 60 ? 'elevee' : 'moyenne';
            $add($mk('structure:dependance:' . $top, 'structure', $sev, "Dépendance envers un client : $cname", sprintf('%s représente %.0f %% du chiffre d\'affaires facturé des 12 derniers mois.', $cname, $share), $byClient[$top], ['type' => 'contact', 'id' => $top, 'label' => $cname],
                ['CA HT 12 mois (client)' => pil_fmt($byClient[$top]), 'CA HT 12 mois (total)' => pil_fmt($total12), 'Nombre de clients' => (string)count($byClient)], 'Part = factures émises HT du client / total des factures émises HT, 12 derniers mois.', 'Diversifier la clientèle ; surveiller de près les paiements de ce client.', $dir, $due($sev))); } }
    // --- chantiers
    foreach (pil_projects_analysis($today, $all) as $p) {
        $ent = ['type' => 'project', 'id' => $p['id'], 'label' => trim(($p['number'] ? $p['number'] . ' – ' : '') . $p['name'])];
        $owner = $p['manager'] ? 'Responsable du chantier (' . $p['manager'] . ')' : $dir;
        $base = ['Montant contractuel HT' => pil_fmt($p['contract']), 'Coûts prévus (déboursé)' => pil_fmt($p['cost_estimated']), 'Coûts réels' => pil_fmt($p['cost_purchases'] + $p['cost_subcontracting'] + $p['cost_labour'] + $p['cost_other']), 'Commandes ouvertes' => pil_fmt($p['cost_open_orders']), 'Facturé HT' => pil_fmt($p['invoiced'])];
        if ($p['contract'] > 0 && $p['margin_final'] < 0) { $sev = -$p['margin_final'] > $p['contract'] * 0.1 ? 'critique' : 'elevee';
            $add($mk('chantier:deficit:' . $p['id'], 'chantiers', $sev, "Chantier déficitaire : {$ent['label']}", 'Rentabilité finale prévue : ' . pil_fmt($p['margin_final']) . " ({$p['margin_final_pct']} %).", -$p['margin_final'], $ent, $base,
                'Marge finale = montant contractuel − max(coûts prévus, coûts réels + commandes ouvertes) (même calcul que la fiche chantier).', 'Analyser les dépassements, facturer les travaux supplémentaires (avenant), renégocier les achats restants.', $owner, $due($sev))); }
        elseif ($p['contract'] > 0 && $p['margin_final_pct'] !== null && $p['margin_final_pct'] < $p['margin_min_pct'])
            $add($mk('chantier:marge:' . $p['id'], 'chantiers', 'moyenne', "Marge insuffisante : {$ent['label']}", "Marge finale prévue {$p['margin_final_pct']} % (seuil {$p['margin_min_pct']} %).", $p['margin_final'], $ent, $base, 'Marge finale / montant contractuel.', 'Contrôler les coûts restants ; vérifier les travaux supplémentaires non facturés.', $owner, $due('moyenne')));
        $eng = $p['cost_engaged'];
        if ($p['cost_estimated'] > 0 && $eng > $p['cost_estimated'] * 1.1)
            $add($mk('chantier:ecart:' . $p['id'], 'chantiers', 'elevee', "Coûts au-delà du devis : {$ent['label']}", sprintf('Coûts réels + engagés %s pour %s prévus (+%.0f %%).', pil_fmt($eng), pil_fmt($p['cost_estimated']), ($eng / $p['cost_estimated'] - 1) * 100), $eng - $p['cost_estimated'], $ent, $base,
                'Écart = (coûts réels + commandes ouvertes) − déboursé des devis acceptés ; alerte au-delà de 10 %.', 'Identifier les postes en dépassement (fiche chantier, onglet coûts) et vérifier s\'ils justifient un avenant.', $owner, $due('elevee')));
        if ($p['progress_cost'] !== null && $p['progress_billing'] !== null && $p['progress_cost'] >= 30 && $p['progress_cost'] - $p['progress_billing'] > 20)
            $add($mk('chantier:rythme:' . $p['id'], 'chantiers', 'moyenne', "Coûts plus rapides que l'avancement : {$ent['label']}", "Coûts engagés à {$p['progress_cost']} % du déboursé prévu, facturation à {$p['progress_billing']} % du marché.", null, $ent, $base,
                'Avancement mesuré par la facturation (facturé / marché) ; consommation = (coûts réels + engagés) / déboursé prévu ; alerte si l\'écart dépasse 20 points.', 'Facturer l\'avancement réel (état d\'avancement) ou vérifier la dérive des coûts.', $owner, $due('moyenne')));
        if ($p['ea_to_bill'] > 0)
            $add($mk('chantier:a_facturer:' . $p['id'], 'chantiers', 'moyenne', "Travaux approuvés non facturés : {$ent['label']}", 'État(s) d\'avancement approuvé(s) par le client mais pas encore facturé(s) : ' . pil_fmt($p['ea_to_bill']) . ' HT.', $p['ea_to_bill'], $ent, $base, 'Somme HT des états d\'avancement au statut « approuvé ».', 'Facturer l\'état d\'avancement approuvé.', 'Bureau (facturation)', $due('moyenne')));
        if (in_array($p['status'], ['reception', 'termine'], true) && $p['contract'] > 0 && $p['contract'] - $p['invoiced'] > 100)
            $add($mk('chantier:reste_a_facturer:' . $p['id'], 'chantiers', 'elevee', "Chantier terminé, reste à facturer : {$ent['label']}", 'Marché ' . pil_fmt($p['contract']) . ', facturé ' . pil_fmt($p['invoiced']) . '.', $p['contract'] - $p['invoiced'], $ent, $base, 'Reste = montant contractuel HT − factures émises HT (chantier en réception ou terminé).', 'Établir la facture de solde ou documenter la moins-value.', 'Bureau (facturation)', $due('elevee')));
        foreach ($p['avenants_pending'] as $av) if ($av['age'] !== null && $av['age'] > 15)
            $add($mk('chantier:avenant:' . $av['id'], 'chantiers', 'moyenne', "Avenant sans accord écrit depuis {$av['age']} jours : {$ent['label']}", 'Avenant ' . ($av['number'] ?: '#' . $av['id']) . ' (' . ($av['status'] === 'envoye' ? 'envoyé' : 'pas encore envoyé') . ') de ' . pil_fmt($av['amount']) . ' HT, non accepté.', $av['amount'], $ent,
                ['Avenant' => (string)($av['number'] ?: '#' . $av['id']), 'Date' => pil_d($av['date']), 'Statut' => $av['status']], 'Avenant (devis lié au devis principal) au statut brouillon ou envoyé depuis plus de 15 jours.', 'Obtenir l\'accord écrit du client avant d\'exécuter ou de facturer ces travaux.', $owner, $due('moyenne')));
        if ($p['late_days'] > 0)
            $add($mk('chantier:retard:' . $p['id'], 'chantiers', $p['late_days'] > 30 ? 'elevee' : 'moyenne', "Chantier en retard de {$p['late_days']} jours : {$ent['label']}", 'Date de fin prévue ' . pil_d($p['end']) . ' dépassée, chantier toujours ' . ($p['status'] === 'encours' ? 'en cours' : 'en préparation') . '.', null, $ent, ['Fin prévue' => pil_d($p['end']), 'Statut' => $p['status']],
                'Date de fin de la fiche chantier comparée à aujourd\'hui.', 'Mettre à jour le planning ; évaluer les coûts du retard (main-d\'œuvre, location, pénalités).', $owner, $due('moyenne')));
    }
    // --- fournisseurs : double paiement, double facture, trop-payé, retenue sous-traitant
    $co = setting('company', []) ?: []; $defVat = isset($co['defaultVat']) ? pil_num($co['defaultVat']) : 21.0;
    $seen = [];
    foreach ($all['expense'] as $e) {
        $d = $e['data']; if (!empty($d['refused'])) continue;
        $sid = (int)($d['supplierId'] ?? 0); $sname = isset($contacts[$sid]) ? pil_contact_label($contacts[$sid]) : 'fournisseur inconnu';
        $ent = ['type' => 'expense', 'id' => $e['id'], 'label' => $sname];
        $ref = strtoupper(trim((string)($d['ref'] ?? '')));
        if ($ref !== '' && $sid) { $k = "$sid|$ref"; if (isset($seen[$k])) $add($mk('fournisseur:double_facture:' . min($seen[$k], $e['id']) . '-' . max($seen[$k], $e['id']), 'fournisseurs', 'elevee', "Facture fournisseur enregistrée deux fois : $sname n° {$d['ref']}", 'Deux achats portent le même fournisseur et le même numéro de facture.', pil_c(pil_purch_total($d, $defVat)), $ent, ['Achats' => '#' . $seen[$k] . ' et #' . $e['id'], 'N° de facture' => (string)$d['ref']], 'Même fournisseur + même numéro de facture.', 'Supprimer le doublon ou corriger le numéro ; vérifier qu\'il n\'a pas été payé deux fois.', 'Comptabilité', $due('elevee'))); else $seen[$k] = $e['id']; }
        $tot = pil_purch_total($d, $defVat); $paid = pil_purch_paid($d, $defVat);
        if ($paid - $tot > 0.01) $add($mk('fournisseur:trop_paye:' . $e['id'], 'fournisseurs', 'elevee', "Fournisseur payé plus que la facture : $sname", 'Paiements enregistrés ' . pil_fmt(pil_c($paid)) . ' pour une facture de ' . pil_fmt(pil_c($tot)) . '.', pil_c($paid - $tot), $ent, ['Total TTC' => pil_fmt(pil_c($tot)), 'Payé' => pil_fmt(pil_c($paid))], 'Somme des paiements de l\'achat − total TTC.', 'Demander le remboursement ou un avoir au fournisseur.', 'Comptabilité', $due('elevee')));
        $kind = isset($contacts[$sid]) ? (string)($contacts[$sid]['data']['kind'] ?? '') : '';
        if ($kind === 'soustraitant' && $tot - $paid > 0.01 && empty(($d['retention'] ?? [])['result']) && ($d['status'] ?? '') !== 'avalider')
            $add($mk('conformite:retenue:' . $e['id'], 'conformite', 'moyenne', "Sous-traitant : obligation de retenue non vérifiée ($sname)", 'Facture de sous-traitance à payer sans vérification de l\'obligation de retenue ONSS / SPF Finances (art. 30bis) dans BâtiPro.', pil_c($tot - $paid), $ent, ['Reste à payer' => pil_fmt(pil_c($tot - $paid))], 'Achat d\'un contact « sous-traitant » non soldé, sans résultat de vérification de retenue.', 'Vérifier l\'obligation de retenue le jour du paiement (bouton dans l\'achat).', 'Comptabilité', $due('moyenne')));
    }
    // --- banque : même bénéficiaire, même montant, à moins de 7 jours (possible double paiement) ; dépenses anormales
    foreach (q("SELECT a.id ida, b.id idb, a.amount, a.cp_iban, a.cp_name, a.booking_date da, b.booking_date db FROM pil_bank_tx a JOIN pil_bank_tx b ON b.company_id = a.company_id AND b.cp_iban = a.cp_iban AND b.amount = a.amount AND b.id > a.id
            AND ABS(DATEDIFF(a.booking_date, b.booking_date)) <= 7 WHERE a.company_id = ? AND a.amount <= -10000 AND a.cp_iban <> '' AND a.category <> 'transfert_interne' AND a.booking_date >= ?", [cid(), pil_add_days($today, -120)])->fetchAll() as $x)
        $add($mk('fournisseur:double_paiement:' . $x['ida'] . '-' . $x['idb'], 'fournisseurs', 'moyenne', 'Paiement possible en double : ' . ($x['cp_name'] ?: $x['cp_iban']), 'Deux virements identiques de ' . pil_fmt(-(int)$x['amount']) . ' le ' . pil_d($x['da']) . ' et le ' . pil_d($x['db']) . '.', -(int)$x['amount'], ['type' => 'bank_tx', 'id' => (int)$x['idb'], 'label' => $x['cp_name'] ?: $x['cp_iban']],
            ['IBAN' => $x['cp_iban'], 'Dates' => pil_d($x['da']) . ' et ' . pil_d($x['db'])], 'Extraits : même IBAN bénéficiaire, même montant (≥ 100 €), à moins de 7 jours d\'intervalle.', 'Vérifier s\'il s\'agit de deux factures différentes ; sinon demander le remboursement.', 'Comptabilité', $due('moyenne')));
    $rows = q("SELECT id, category, amount, booking_date, cp_name, name_fix FROM pil_bank_tx WHERE company_id = ? AND amount < 0 AND category NOT IN ('transfert_interne', 'a_classer', 'credit', 'impots', 'salaires') AND booking_date >= ?", [cid(), pil_add_days($today, -365)])->fetchAll();
    $cat = []; foreach ($rows as $x) $cat[$x['category']][] = -(int)$x['amount'];
    foreach ($rows as $x) { $l = $cat[$x['category']]; if (count($l) < 5 || $x['booking_date'] < pil_add_days($today, -60)) continue; $med = pil_percentile($l, 50); $a = -(int)$x['amount'];
        if ($a >= 100000 && $a > 3 * $med) $add($mk('depense:anormale:' . $x['id'], 'depenses', 'moyenne', 'Dépense inhabituelle : ' . (($x['name_fix'] ?: $x['cp_name']) ?: 'sans nom'), pil_fmt($a) . ' le ' . pil_d($x['booking_date']) . sprintf(', %.1f fois la dépense médiane de cette catégorie.', $a / $med), $a, ['type' => 'bank_tx', 'id' => (int)$x['id'], 'label' => (string)(($x['name_fix'] ?: $x['cp_name']) ?: '')],
            ['Catégorie' => (string)$x['category'], 'Médiane 12 mois' => pil_fmt((int)$med), 'Nombre de dépenses comparées' => (string)count($l)], 'Montant comparé à la médiane des sorties de la même catégorie sur 12 mois (au moins 5 dépenses) ; alerte au-delà de 3 fois et de 1.000 €.', 'Vérifier la justification (facture, chantier concerné).', 'Comptabilité', $due('moyenne'))); }
    // --- assurances expirées (registre des engagements)
    foreach (pil_commitments('confirme') as $cm) if ($cm['subtype'] === 'assurances' && !empty($cm['end_date']) && $cm['end_date'] < $today)
        $add($mk('conformite:assurance:' . $cm['id'], 'conformite', 'elevee', "Assurance expirée : {$cm['label']}", 'Date de fin ' . pil_d($cm['end_date']) . ' dépassée.', $cm['amount'], ['type' => 'commitment', 'id' => $cm['id'], 'label' => $cm['label']], ['Fin' => pil_d($cm['end_date']), 'Organisme' => $cm['lender']], 'Date de fin de l\'assurance enregistrée dans les engagements.', 'Vérifier le renouvellement auprès de l\'assureur et mettre à jour la date de fin.', $dir, $due('elevee')));
    return $c;
}

/** Les alertes connues sont mises à jour (jamais recréées) ; celles qui ne sont plus détectées sont résolues automatiquement. */
function pil_alerts_sync(array $cand, string $today): array {
    $cur = q('SELECT * FROM pil_alerts WHERE company_id = ?', [cid()])->fetchAll();
    $byKey = array_column($cur, null, 'akey'); $n = ['new' => 0, 'updated' => 0, 'resolved' => 0, 'reopened' => 0];
    foreach ($cand as $k => $a) {
        $data = json_encode($a['data'], JSON_UNESCAPED_UNICODE);
        if (!isset($byKey[$k])) {
            q('INSERT INTO pil_alerts (company_id, akey, category, severity, title, description, amount, entity_type, entity_id, entity_label, data, calc, action, owner, due, status, first_seen, last_seen, history, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [cid(), $k, $a['category'], $a['severity'], mb_substr($a['title'], 0, 255), $a['description'], $a['amount'], $a['entity_type'], $a['entity_id'], $a['entity_label'] !== null ? mb_substr($a['entity_label'], 0, 190) : null, $data, $a['calc'], $a['action'], mb_substr($a['owner'], 0, 120), $a['due'], 'nouvelle', $today, $today,
                 json_encode([['at' => now(), 'by' => null, 'event' => 'détectée']], JSON_UNESCAPED_UNICODE), now()]);
            $n['new']++; continue;
        }
        $o = $byKey[$k]; $hist = json_decode((string)$o['history'], true) ?: [];
        $status = $o['status'];
        if ($status === 'resolue') { $status = 'nouvelle'; $hist[] = ['at' => now(), 'by' => null, 'event' => 'réapparue']; $n['reopened']++; }
        if ((int)$o['amount'] !== (int)$a['amount'] || $o['severity'] !== $a['severity']) $hist[] = ['at' => now(), 'by' => null, 'event' => 'mise à jour', 'from' => ['amount' => $o['amount'] !== null ? (int)$o['amount'] : null, 'severity' => $o['severity']], 'to' => ['amount' => $a['amount'], 'severity' => $a['severity']]];
        // le responsable et la date limite choisis par l'utilisateur sont conservés
        q('UPDATE pil_alerts SET category = ?, severity = ?, title = ?, description = ?, amount = ?, entity_label = ?, data = ?, calc = ?, action = ?, status = ?, last_seen = ?, occurrences = occurrences + ?, history = ?, updated_at = ? WHERE id = ?',
            [$a['category'], $a['severity'], mb_substr($a['title'], 0, 255), $a['description'], $a['amount'], $a['entity_label'] !== null ? mb_substr($a['entity_label'], 0, 190) : null, $data, $a['calc'], $a['action'], $status, $today, $o['last_seen'] === $today ? 0 : 1, json_encode($hist, JSON_UNESCAPED_UNICODE), now(), $o['id']]);
        $n['updated']++;
    }
    foreach ($cur as $o) if (!isset($cand[$o['akey']]) && in_array($o['status'], ['nouvelle', 'en_cours'], true)) {
        $hist = json_decode((string)$o['history'], true) ?: []; $hist[] = ['at' => now(), 'by' => null, 'event' => 'résolue automatiquement : condition disparue'];
        q("UPDATE pil_alerts SET status = 'resolue', resolved_at = ?, history = ?, updated_at = ? WHERE id = ?", [now(), json_encode($hist, JSON_UNESCAPED_UNICODE), now(), $o['id']]);
        $n['resolved']++;
    }
    return $n;
}
function pil_alert_out(array $r): array {
    foreach (['id', 'amount', 'entity_id', 'occurrences'] as $k) if ($r[$k] !== null) $r[$k] = (int)$r[$k];
    $r['data'] = json_decode((string)$r['data'], true) ?: []; $r['history'] = json_decode((string)$r['history'], true) ?: [];
    unset($r['company_id']); return $r;
}
function pil_alerts_list(?array $status = null): array {
    $rows = q('SELECT * FROM pil_alerts WHERE company_id = ?' . ($status ? ' AND status IN (' . implode(',', array_fill(0, count($status), '?')) . ')' : ''), array_merge([cid()], $status ?? []))->fetchAll();
    $rows = array_map('pil_alert_out', $rows);
    usort($rows, fn($a, $b) => PIL_SEV[$a['severity']] <=> PIL_SEV[$b['severity']] ?: (int)$b['amount'] <=> (int)$a['amount']);
    return $rows;
}

// ===================================================================== Rapport quotidien
function pil_report_build(string $today): array {
    $fc = pil_forecast($today);
    $cand = pil_risk_candidates($today, $fc);
    $sync = pil_alerts_sync($cand, $today);
    $open = pil_alerts_list(['nouvelle', 'en_cours']);
    $rec = pil_receivables($today);
    $bal = $fc['balances'];
    // A. trésorerie : entrées / sorties des 7 derniers jours couverts par les extraits
    $from = $bal['latest_date'] ? pil_add_days($bal['latest_date'], -6) : null;
    $recent = $from ? q("SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END),0) i, COALESCE(SUM(CASE WHEN amount < 0 THEN amount END),0) o, COUNT(*) n FROM pil_bank_tx WHERE company_id = ? AND category <> 'transfert_interne' AND booking_date BETWEEN ? AND ?", [cid(), $from, $bal['latest_date']])->fetch() : ['i' => 0, 'o' => 0, 'n' => 0];
    $hz = []; foreach (['optimiste', 'realiste', 'pessimiste'] as $s) foreach ([7, 30, 90] as $h) { $x = $fc['scenarios'][$s]['horizons'][$h]; $hz[$s][$h] = ['end' => $x['end'], 'min' => $x['min'], 'min_date' => $x['min_date'], 'negative_date' => $x['negative_date']]; }
    // B. encaissements
    $openInv = array_values(array_filter($rec['invoices'], fn($i) => $i['ea'] === null && $i['rest'] > 0));
    $overdue = array_values(array_filter($openInv, fn($i) => in_array($i['state'], ['echu', 'partiel_echu'], true)));
    $chase = []; foreach ($overdue as $i) { $k = $i['client_name'] ?: '?'; $chase[$k] = ['client' => $k, 'amount' => ($chase[$k]['amount'] ?? 0) + $i['rest'], 'invoices' => ($chase[$k]['invoices'] ?? 0) + 1, 'max_late' => max($chase[$k]['max_late'] ?? 0, $i['late_days'])]; }
    usort($chase, fn($a, $b) => $b['amount'] <=> $a['amount']);
    $flows30 = array_filter($fc['scenarios']['realiste']['flows'], fn($f) => pil_days($today, $f['date']) <= 30);
    $expIn = array_sum(array_map(fn($f) => $f['amount'], array_filter($flows30, fn($f) => in_array($f['source'], ['facture', 'etat_avancement'], true))));
    // C. décaissements à 30 jours, par nature
    $out = ['fournisseurs' => 0, 'sous_traitants' => 0, 'salaires' => 0, 'onss' => 0, 'tva' => 0, 'credits' => 0, 'leasing' => 0, 'autres' => 0];
    $contacts = array_column(pil_items(['contact'])['contact'], null, 'id');
    $sup = []; foreach ($rec['expenses'] as $e) $sup[$e['id']] = $e;
    foreach ($flows30 as $f) {
        if ($f['amount'] >= 0 || $f['source'] === 'prudence') continue; $a = -$f['amount'];
        if ($f['source'] === 'achat') { $sid = $sup[$f['ref']['id']]['supplier'] ?? 0; $k = (($contacts[$sid]['data']['kind'] ?? '') === 'soustraitant') ? 'sous_traitants' : 'fournisseurs'; }
        elseif ($f['source'] === 'credit') $k = 'credits'; elseif ($f['source'] === 'leasing') $k = 'leasing';
        elseif ($f['source'] === 'charge') $k = ['salaires' => 'salaires', 'onss' => 'onss', 'precompte' => 'onss', 'tva' => 'tva'][$f['category'] ?? ''] ?? 'autres';
        else $k = 'autres';
        $out[$k] += $a;
    }
    $toPay = array_values(array_filter($rec['expenses'], fn($e) => $e['rest'] > 0 && $e['state'] !== 'a_valider' && (!$e['due'] || pil_days($today, $e['due']) <= 14)));
    usort($toPay, fn($a, $b) => strcmp((string)$a['due'], (string)$b['due']));
    // D. chantiers
    $proj = pil_projects_analysis($today);
    $risk = array_values(array_filter($open, fn($a) => $a['category'] === 'chantiers'));
    $avPend = []; foreach ($proj as $p) foreach ($p['avenants_pending'] as $v) $avPend[] = $v + ['project' => $p['name']];
    // E. priorités : les 5 alertes ouvertes les plus graves (puis les plus gros montants)
    $prio = array_map(fn($a) => ['alert_id' => $a['id'], 'action' => $a['action'], 'title' => $a['title'], 'why' => $a['description'], 'impact' => $a['severity'] === 'critique' ? 'Critique pour la continuité de l\'entreprise' : ($a['amount'] !== null ? 'Montant en jeu : ' . pil_fmt((int)$a['amount']) : $a['calc']),
        'amount' => $a['amount'], 'who' => $a['owner'], 'when' => $a['due'], 'severity' => $a['severity']], array_slice($open, 0, 5));
    $data = [
        'title' => 'MADIBU – DAILY FINANCIAL REPORT', 'date' => $today,
        'A' => ['accounts' => $bal['accounts'], 'total' => $bal['total'], 'adjustment' => $bal['adjustment'], 'latest_statement' => $bal['latest_date'], 'oldest_statement' => $bal['oldest_date'],
            'recent' => ['from' => $from, 'to' => $bal['latest_date'], 'in' => (int)$recent['i'], 'out' => (int)$recent['o'], 'count' => (int)$recent['n']], 'forecast' => $hz, 'reliability' => $fc['reliability']['score'], 'reliability_level' => $fc['reliability']['level']],
        'B' => ['pending_count' => count($openInv), 'pending_amount' => array_sum(array_column($openInv, 'rest')), 'overdue_count' => count($overdue), 'overdue_amount' => array_sum(array_column($overdue, 'rest')),
            'expected_30d' => $expIn, 'to_chase' => array_slice($chase, 0, 10),
            'ea_pending' => array_sum(array_map(fn($i) => $i['total'], array_filter($rec['invoices'], fn($i) => $i['ea'] === 'envoye')))],
        'C' => ['next_30d' => $out, 'total_30d' => array_sum($out), 'to_pay' => array_map(fn($e) => ['id' => $e['id'], 'supplier' => $e['supplier_name'], 'ref' => $e['ref'], 'due' => $e['due'], 'rest' => $e['rest']], array_slice($toPay, 0, 15))],
        'D' => ['at_risk' => array_map(fn($a) => ['title' => $a['title'], 'severity' => $a['severity'], 'amount' => $a['amount']], $risk),
            'deficit' => array_values(array_map(fn($p) => ['name' => trim(($p['number'] ? $p['number'] . ' – ' : '') . $p['name']), 'margin' => $p['margin_final']], array_filter($proj, fn($p) => $p['contract'] > 0 && $p['margin_final'] < 0))),
            'to_invoice' => array_values(array_map(fn($p) => ['name' => trim(($p['number'] ? $p['number'] . ' – ' : '') . $p['name']), 'amount' => $p['ea_to_bill'] ?: $p['contract'] - $p['invoiced']], array_filter($proj, fn($p) => $p['ea_to_bill'] > 0 || (in_array($p['status'], ['reception', 'termine'], true) && $p['contract'] - $p['invoiced'] > 100)))),
            'abnormal' => array_values(array_map(fn($a) => ['title' => $a['title'], 'amount' => $a['amount']], array_filter($open, fn($a) => $a['category'] === 'depenses'))),
            'avenants_pending' => $avPend],
        'E' => $prio,
        'alerts' => ['open' => count($open), 'by_severity' => array_count_values(array_column($open, 'severity')), 'sync' => $sync],
        'not_verifiable' => ['Documents obligatoires et assurances des sous-traitants : non enregistrés dans BâtiPro (aucune date d\'expiration disponible).'],
        // instantané pour la revue future des prévisions (pourquoi la réalité a été différente)
        'snapshot' => ['start' => $bal['total'], 'series' => array_map(fn($s) => [$s['d'], $s['b']], $fc['scenarios']['realiste']['series']),
            'flows' => array_map(fn($f) => ['d' => $f['date'], 'a' => $f['amount'], 'l' => $f['label'], 's' => $f['source'], 'r' => $f['ref'] ?? null], array_slice($fc['scenarios']['realiste']['flows'], 0, 400))],
    ];
    return $data;
}

/** Rapport du jour : un seul par date ; régénéré seulement si les données ont changé (même contenu → même rapport). */
function pil_report_run(string $today, string $source, ?array $me = null, bool $withAi = true): array {
    pil_director_schema();
    q('INSERT INTO pil_runs (company_id, rdate, source, started_at) VALUES (?,?,?,?)', [cid(), $today, $source, now()]);
    $run = (int)db()->lastInsertId();
    try {
        $data = pil_report_build($today);
        $data['signature'] = pil_data_signature(); // pour savoir, plus tard dans la journée, si le rapport est encore à jour
        $cmp = $data; unset($cmp['alerts']['sync']);
        $hash = hash('sha256', json_encode($cmp));
        $cur = q('SELECT id, hash, version FROM pil_reports WHERE company_id = ? AND rdate = ?', [cid(), $today])->fetch();
        $msg = '';
        if ($cur && $cur['hash'] === $hash) $msg = 'Rapport inchangé (mêmes données) : non régénéré.';
        else {
            [$comment, $check] = $withAi ? pil_ai_comment($data) : [null, null];
            if ($comment !== null) pil_audit('commentaire_ia', 'report', null, null, ['date' => $today, 'verification' => $check], 'ia');
            // ancre du journal d'audit recopiée dans le rapport du jour (détection d'une suppression des dernières entrées)
            $data['audit_anchor'] = setting('pilotage_audit_anchor', null);
            if ($cur) q('UPDATE pil_reports SET data = ?, hash = ?, ai_comment = ?, ai_check = ?, source = ?, version = version + 1, updated_at = ? WHERE id = ?', [json_encode($data, JSON_UNESCAPED_UNICODE), $hash, $comment, $check ? json_encode($check, JSON_UNESCAPED_UNICODE) : null, $source, now(), $cur['id']]);
            else q('INSERT INTO pil_reports (company_id, rdate, data, hash, ai_comment, ai_check, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [cid(), $today, json_encode($data, JSON_UNESCAPED_UNICODE), $hash, $comment, $check ? json_encode($check, JSON_UNESCAPED_UNICODE) : null, $source, now(), now()]);
            $msg = $cur ? 'Rapport mis à jour (données modifiées).' : 'Rapport créé.';
        }
        $s = $data['alerts']['sync'];
        $msg .= " Alertes : {$s['new']} nouvelle(s), {$s['updated']} mise(s) à jour, {$s['resolved']} résolue(s).";
        q("UPDATE pil_runs SET finished_at = ?, status = 'ok', message = ? WHERE id = ?", [now(), $msg, $run]);
        pil_audit('rapport_quotidien', 'report', $run, null, ['date' => $today, 'message' => $msg], $source === 'cron' ? 'cron' : 'utilisateur', $me['id'] ?? null);
        if ($me) log_activity($me['id'], 'create', 'pilot_report', null, null, 'Rapport financier du ' . pil_d($today));
        return ['ok' => true, 'message' => $msg];
    } catch (Throwable $e) {
        q("UPDATE pil_runs SET finished_at = ?, status = 'erreur', message = ? WHERE id = ?", [now(), mb_substr($e->getMessage(), 0, 1000), $run]);
        throw $e;
    }
}
function pil_report_get(string $date): ?array {
    $r = q('SELECT * FROM pil_reports WHERE company_id = ? AND rdate = ?', [cid(), $date])->fetch();
    if (!$r) return null;
    $d = json_decode($r['data'], true); unset($d['snapshot']);
    return ['date' => $r['rdate'], 'data' => $d, 'ai_comment' => $r['ai_comment'], 'ai_check' => $r['ai_check'] ? json_decode($r['ai_check'], true) : null, 'version' => (int)$r['version'], 'source' => $r['source'], 'updated_at' => $r['updated_at'],
        'decisions' => array_map(fn($x) => ['id' => (int)$x['id'], 'text' => $x['text'], 'kind' => $x['kind'], 'status' => $x['status'], 'alert_id' => $x['alert_id'] !== null ? (int)$x['alert_id'] : null, 'created_at' => $x['created_at'], 'created_by' => (int)$x['created_by'], 'done_at' => $x['done_at']],
            q('SELECT * FROM pil_decisions WHERE company_id = ? AND rdate = ? ORDER BY id', [cid(), $date])->fetchAll())];
}

// ===================================================================== Comparaisons et revue des prévisions
/** Solde consolidé réel à une date, seulement si chaque compte a un extrait couvrant cette date. */
function pil_actual_balance(string $date): ?int {
    $tot = 0;
    foreach (pil_accounts() as $a) {
        if (!$a['active']) continue;
        $first = q("SELECT period_from, opening FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_from, id LIMIT 1", [cid(), $a['id']])->fetch();
        $cover = (int)q("SELECT COUNT(*) FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' AND period_from <= ? AND period_to >= ?", [cid(), $a['id'], $date, $date])->fetchColumn();
        if (!$first || !$cover) return null;
        $tot += (int)$first['opening'] + (int)q('SELECT COALESCE(SUM(amount),0) FROM pil_bank_tx WHERE company_id = ? AND account_id = ? AND booking_date <= ?', [cid(), $a['id'], $date])->fetchColumn();
    }
    return $tot;
}
/** Pourquoi la prévision du rapport du JJ/MM a différé de la réalité : décomposition déterministe. */
function pil_forecast_review(string $rdate, int $days = 30): array {
    $r = q('SELECT data FROM pil_reports WHERE company_id = ? AND rdate = ?', [cid(), $rdate])->fetch();
    if (!$r) return ['available' => false, 'reason' => 'Aucun rapport enregistré pour le ' . pil_d($rdate) . '.'];
    $snap = (json_decode($r['data'], true) ?: [])['snapshot'] ?? null;
    if (!$snap) return ['available' => false, 'reason' => 'Ce rapport ne contient pas d\'instantané de prévision.'];
    $target = pil_add_days($rdate, $days);
    $pred = null; foreach ($snap['series'] as [$d, $b]) if ($d <= $target) $pred = $b;
    $actual = pil_actual_balance($target);
    if ($actual === null) return ['available' => false, 'reason' => 'Les extraits bancaires ne couvrent pas encore le ' . pil_d($target) . ' pour tous les comptes : impossible de comparer avec la réalité.', 'predicted' => $pred, 'target' => $target];
    $flows = array_filter($snap['flows'], fn($f) => $f['d'] <= $target);
    $missIn = 0; $missOut = 0; $details = [];
    $items = pil_items(['invoice', 'expense']);
    $byId = []; foreach ($items as $t => $l) foreach ($l as $x) $byId[$t][$x['id']] = $x;
    foreach ($flows as $f) {
        $done = null;
        if (($f['r']['type'] ?? '') === 'invoice' && isset($byId['invoice'][$f['r']['id']])) { $d = $byId['invoice'][$f['r']['id']]['data']; $paidIn = array_sum(array_map(fn($p) => ($p['date'] ?? '') > $rdate && ($p['date'] ?? '') <= $target ? pil_c(pil_num($p['amount'] ?? 0)) : 0, (array)($d['payments'] ?? []))); $done = $paidIn >= $f['a'] - 1; if (!$done) { $missIn += $f['a'] - min($f['a'], $paidIn); } }
        elseif (($f['r']['type'] ?? '') === 'expense' && isset($byId['expense'][$f['r']['id']])) { $d = $byId['expense'][$f['r']['id']]['data']; $paidOut = array_sum(array_map(fn($p) => ($p['date'] ?? '') > $rdate && ($p['date'] ?? '') <= $target ? pil_c(pil_num($p['amount'] ?? 0)) : 0, (array)($d['payments'] ?? []))); $done = $paidOut >= -$f['a'] - 1; if (!$done) $missOut += -$f['a'] - min(-$f['a'], $paidOut); }
        else { $done = (bool)q('SELECT id FROM pil_bank_tx WHERE company_id = ? AND amount = ? AND booking_date BETWEEN ? AND ? LIMIT 1', [cid(), $f['a'], pil_add_days($f['d'], -5), pil_add_days($f['d'], 5)])->fetch(); if (!$done) { if ($f['a'] > 0) $missIn += $f['a']; else $missOut += -$f['a']; } }
        if (!$done) $details[] = ['date' => $f['d'], 'label' => $f['l'], 'amount' => $f['a'], 'status' => 'prévu, non réalisé'];
    }
    // mouvements bancaires réels de la période qui n'étaient pas prévus (même montant à ± 5 jours)
    $unf = [];
    foreach (q("SELECT booking_date, amount, cp_name, category FROM pil_bank_tx WHERE company_id = ? AND category <> 'transfert_interne' AND booking_date > ? AND booking_date <= ?", [cid(), $rdate, $target])->fetchAll() as $t) {
        $hit = false; foreach ($flows as $f) if ($f['a'] === (int)$t['amount'] && abs(pil_days($f['d'], $t['booking_date'])) <= 5) { $hit = true; break; }
        if (!$hit) $unf[] = ['date' => $t['booking_date'], 'amount' => (int)$t['amount'], 'label' => (string)$t['cp_name'], 'category' => $t['category']];
    }
    usort($unf, fn($a, $b) => abs($b['amount']) <=> abs($a['amount']));
    $unfIn = array_sum(array_filter(array_column($unf, 'amount'), fn($a) => $a > 0)); $unfOut = array_sum(array_filter(array_column($unf, 'amount'), fn($a) => $a < 0));
    $gap = $actual - $pred;
    return ['available' => true, 'report_date' => $rdate, 'target' => $target, 'predicted' => $pred, 'actual' => $actual, 'gap' => $gap,
        'explained' => ['encaissements_prevus_non_recus' => -$missIn, 'sorties_prevues_non_realisees' => $missOut, 'entrees_imprevues' => $unfIn, 'sorties_imprevues' => $unfOut,
            'reste_non_explique' => $gap - (-$missIn + $missOut + $unfIn + $unfOut)],
        'not_realized' => array_slice($details, 0, 30), 'unforeseen' => array_slice($unf, 0, 30),
        'method' => 'Prévision = scénario réaliste enregistré dans le rapport du ' . pil_d($rdate) . '. Réalité = solde reconstitué à partir des extraits. Chaque flux prévu est vérifié (paiement enregistré dans BâtiPro ou mouvement bancaire de même montant à ± 5 jours) ; les mouvements bancaires sans flux prévu correspondant sont « imprévus ».'];
}
/** Comparaison d'un mois à l'autre : banque (extraits), facturation, achats, et situation des rapports de fin de mois. */
function pil_compare_months(string $m1, string $m2): array {
    $mo = pil_monthly(60, max($m1, $m2));
    $it = pil_items(['invoice', 'expense']); $co = setting('company', []) ?: []; $defVat = isset($co['defaultVat']) ? pil_num($co['defaultVat']) : 21.0;
    $one = function (string $m) use ($mo, $it, $defVat) {
        $i = array_search($m, $mo['months'], true); $t = $i !== false ? $mo['total'][$i] : null;
        $inv = 0; foreach ($it['invoice'] as $x) if (($x['data']['status'] ?? '') === 'emise' && ($x['data']['kind'] ?? '') !== 'proforma' && str_starts_with((string)($x['data']['date'] ?? ''), $m)) $inv += pil_c(pil_doc_totals($x['data'])['base']);
        $exp = 0; foreach ($it['expense'] as $x) if (empty($x['data']['refused']) && str_starts_with((string)($x['data']['date'] ?? ''), $m)) $exp += pil_c(pil_num($x['data']['amount'] ?? 0));
        $rep = q('SELECT rdate, data FROM pil_reports WHERE company_id = ? AND rdate LIKE ? ORDER BY rdate DESC LIMIT 1', [cid(), "$m-%"])->fetch();
        $rd = $rep ? json_decode($rep['data'], true) : null;
        return ['month' => $m, 'bank' => $t ? ['opening' => $t['opening'], 'in' => $t['in'], 'out' => $t['out'], 'internal' => $t['internal'], 'closing' => $t['closing'], 'complete' => $t['complete']] : null,
            'invoiced_ht' => $inv, 'purchases_ht' => $exp,
            'report' => $rd ? ['date' => $rep['rdate'], 'receivables' => $rd['B']['pending_amount'], 'overdue' => $rd['B']['overdue_amount'], 'payables_30d' => $rd['C']['total_30d'], 'forecast_30d' => $rd['A']['forecast']['realiste'][30]['end'], 'alerts_open' => $rd['alerts']['open']] : null];
    };
    $a = $one($m1); $b = $one($m2);
    $diff = fn($x, $y) => $x !== null && $y !== null ? $y - $x : null;
    return ['m1' => $a, 'm2' => $b, 'diff' => ['bank_in' => $diff($a['bank']['in'] ?? null, $b['bank']['in'] ?? null), 'bank_out' => $diff($a['bank']['out'] ?? null, $b['bank']['out'] ?? null), 'closing' => $diff($a['bank']['closing'] ?? null, $b['bank']['closing'] ?? null),
        'invoiced_ht' => $b['invoiced_ht'] - $a['invoiced_ht'], 'purchases_ht' => $b['purchases_ht'] - $a['purchases_ht']],
        'sources' => 'Banque : extraits importés (hors transferts internes). Facturation : factures émises (date de facture). Achats : factures fournisseurs HT (date de facture). Situation : dernier rapport quotidien du mois.'];
}

// ===================================================================== Requêtes métier pour l'IA (aucun accès SQL libre)
function pil_ai_tools(): array {
    $o = fn(array $props = [], array $req = []) => ['type' => 'object', 'properties' => (object)$props, 'required' => $req];
    $date = ['type' => 'string', 'description' => 'Date AAAA-MM-JJ'];
    return [
        ['name' => 'tresorerie', 'description' => 'Soldes bancaires (dernier extrait de chaque compte, avec sa date), trésorerie consolidée, prévisions 7/30/90 jours des 3 scénarios (solde final, minimum, date négative), hypothèses et fiabilité.', 'inputSchema' => $o()],
        ['name' => 'encaissements', 'description' => 'Factures clients à encaisser : totaux, factures échues, clients à relancer triés par montant et retard, encaissements attendus à 30 jours.', 'inputSchema' => $o()],
        ['name' => 'decaissements', 'description' => 'Paiements à venir sur N jours (défaut 30) : achats à payer, sous-traitants, salaires, ONSS, TVA, crédits, leasing, autres ; obligatoires et estimés séparés.', 'inputSchema' => $o(['jours' => ['type' => 'integer']])],
        ['name' => 'chantiers', 'description' => 'Analyse financière des chantiers (marché, avenants, facturé, encaissé, coûts par nature, facturé/engagé/payé/restant, marges, avancement). Filtre facultatif par nom ou numéro.', 'inputSchema' => $o(['recherche' => ['type' => 'string']])],
        ['name' => 'totaux_bancaires', 'description' => 'Somme des mouvements bancaires (extraits) par catégorie et période. Catégories : ' . implode(', ', array_keys(PIL_CATS)) . '. Indique si la période est entièrement couverte par les extraits.', 'inputSchema' => $o(['categorie' => ['type' => 'string'], 'du' => $date, 'au' => $date], ['du', 'au'])],
        ['name' => 'totaux_achats', 'description' => 'Factures fournisseurs enregistrées dans BâtiPro sur une période, par type de fournisseur (fournisseur / soustraitant) : total TTC, payé, reste.', 'inputSchema' => $o(['type_fournisseur' => ['type' => 'string', 'enum' => ['tous', 'fournisseur', 'soustraitant']], 'du' => $date, 'au' => $date], ['du', 'au'])],
        ['name' => 'alertes', 'description' => 'Alertes de direction ouvertes (ou toutes) : titre, gravité, montant, données utilisées, calcul, action, responsable, date limite, statut.', 'inputSchema' => $o(['toutes' => ['type' => 'boolean']])],
        ['name' => 'comparer_mois', 'description' => 'Compare deux mois (AAAA-MM) : banque, facturation, achats, situation des rapports.', 'inputSchema' => $o(['mois1' => ['type' => 'string'], 'mois2' => ['type' => 'string']], ['mois1', 'mois2'])],
        ['name' => 'proposer_action', 'description' => 'PROPOSE une action sensible à la direction : elle est placée dans le centre d\'approbation et ne sera JAMAIS exécutée sans approbation humaine. Types : relance_client (e-mail préparé au client d\'une facture en retard), paiement_rapprochement (enregistrer dans une facture ou un achat le paiement d\'un mouvement bancaire).',
            'inputSchema' => $o(['type' => ['type' => 'string', 'enum' => ['relance_client', 'paiement_rapprochement']], 'facture_id' => ['type' => 'integer'], 'mouvement_id' => ['type' => 'integer'], 'document_type' => ['type' => 'string', 'enum' => ['invoice', 'expense']], 'document_id' => ['type' => 'integer'], 'justification' => ['type' => 'string'], 'texte_email' => ['type' => 'string']], ['type', 'justification'])],
        ['name' => 'creer_tache_interne', 'description' => 'Crée une tâche interne BâtiPro (action autorisée sans approbation : aucune conséquence externe ni financière).', 'inputSchema' => $o(['titre' => ['type' => 'string'], 'details' => ['type' => 'string'], 'echeance' => $date], ['titre'])],
        ['name' => 'revue_prevision', 'description' => 'Explique pourquoi la prévision d\'un rapport passé (date) a différé de la réalité bancaire N jours plus tard.', 'inputSchema' => $o(['date_rapport' => $date, 'jours' => ['type' => 'integer']], ['date_rapport'])],
    ];
}
function pil_run_tool(string $name, array $in, string $today): array {
    $src = fn(array $r, string $source, string $period = '', array $hyp = [], array $missing = []) => $r + ['_source' => $source, '_periode' => $period ?: 'au ' . pil_d($today), '_hypotheses' => $hyp, '_manquant' => $missing];
    $dateOk = fn($d) => is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
    switch ($name) {
        case 'tresorerie':
            $f = pil_forecast($today); $hz = [];
            foreach ($f['scenarios'] as $k => $s) $hz[$k] = $s['horizons'];
            foreach ($f['balances']['accounts'] as &$ac) unset($ac['iban']); unset($ac); // données limitées : pas d'IBAN vers l'IA
            return $src(['soldes' => $f['balances'], 'prevision' => $hz, 'fiabilite' => $f['reliability'], 'non_inclus' => $f['excluded']], 'Extraits bancaires importés + factures, achats et engagements confirmés de BâtiPro (calculs PHP)', '', $f['hypotheses'],
                $f['balances']['missing'] ? [$f['balances']['missing'] . ' compte(s) sans extrait'] : []);
        case 'encaissements':
            $r = pil_report_build_light($today);
            return $src($r['B'], 'Factures clients émises dans BâtiPro, paiements enregistrés ; délais observés pour les encaissements attendus');
        case 'decaissements':
            $days = max(1, min(120, (int)($in['jours'] ?? 30)));
            $f = pil_forecast($today); $flows = array_values(array_filter($f['scenarios']['realiste']['flows'], fn($x) => $x['amount'] < 0 && $x['source'] !== 'prudence' && pil_days($today, $x['date']) <= $days));
            $byS = []; foreach ($flows as $x) $byS[$x['source']] = ($byS[$x['source']] ?? 0) - $x['amount'];
            return $src(['total' => -array_sum(array_column($flows, 'amount')), 'par_origine' => $byS, 'obligatoires_confirmes' => -array_sum(array_map(fn($x) => $x['certainty'] === 'confirme' ? $x['amount'] : 0, $flows)),
                'detail' => array_map(fn($x) => ['date' => $x['date'], 'libelle' => $x['label'], 'montant' => -$x['amount'], 'statut' => $x['certainty']], array_slice($flows, 0, 60))], 'Achats BâtiPro (reste à payer) et engagements confirmés', "du " . pil_d($today) . " au " . pil_d(pil_add_days($today, $days)), [], []);
        case 'chantiers':
            $q = mb_strtolower(trim((string)($in['recherche'] ?? '')));
            $l = array_values(array_filter(pil_projects_analysis($today), fn($p) => $q === '' || str_contains(mb_strtolower($p['name'] . ' ' . $p['number'] . ' ' . $p['client']), $q)));
            foreach ($l as &$p) unset($p['top_suppliers']); unset($p);
            return $src(['chantiers' => array_slice($l, 0, 40), 'nombre' => count($l)], 'Devis, avenants, factures, achats ventilés, heures et commandes de BâtiPro (même calcul que la fiche chantier)', '', ['Coût payé : part payée de chaque achat appliquée à sa ventilation HT ; main-d\'œuvre comptée au coût horaire saisi, sans date de paiement.']);
        case 'totaux_bancaires':
            if (!$dateOk($in['du'] ?? null) || !$dateOk($in['au'] ?? null)) return ['error' => 'Dates invalides (AAAA-MM-JJ).'];
            $cat = (string)($in['categorie'] ?? '');
            if ($cat !== '' && !isset(PIL_CATS[$cat])) return ['error' => 'Catégorie inconnue.'];
            $r = q('SELECT COALESCE(SUM(amount),0) s, COUNT(*) n, SUM(status = \'valide\') v FROM pil_bank_tx WHERE company_id = ? AND booking_date BETWEEN ? AND ?' . ($cat ? ' AND category = ?' : " AND category <> 'transfert_interne'"), array_merge([cid(), $in['du'], $in['au']], $cat ? [$cat] : []))->fetch();
            $miss = [];
            foreach (pil_accounts() as $a) { $cov = q("SELECT MIN(period_from) f, MAX(period_to) t FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe'", [cid(), $a['id']])->fetch();
                if (!$cov['f'] || $cov['f'] > $in['du'] || $cov['t'] < $in['au']) $miss[] = "{$a['bank']} : extraits " . ($cov['f'] ? 'du ' . pil_d($cov['f']) . ' au ' . pil_d($cov['t']) : 'absents') . ', période demandée partiellement couverte'; }
            return $src(['categorie' => $cat ?: 'toutes (hors transferts internes)', 'total' => (int)$r['s'], 'mouvements' => (int)$r['n'], 'valides' => (int)$r['v']], 'Extraits bancaires importés (catégories proposées puis vérifiées par l\'utilisateur)', 'du ' . pil_d($in['du']) . ' au ' . pil_d($in['au']), (int)$r['v'] < (int)$r['n'] ? ['Certains mouvements ne sont pas encore validés : leur catégorie peut changer.'] : [], $miss);
        case 'totaux_achats':
            if (!$dateOk($in['du'] ?? null) || !$dateOk($in['au'] ?? null)) return ['error' => 'Dates invalides (AAAA-MM-JJ).'];
            $kind = (string)($in['type_fournisseur'] ?? 'tous'); $all = pil_items(['expense', 'contact']); $ct = array_column($all['contact'], null, 'id');
            $co = setting('company', []) ?: []; $dv = isset($co['defaultVat']) ? pil_num($co['defaultVat']) : 21.0; $t = 0; $p = 0; $n = 0; $by = [];
            foreach ($all['expense'] as $e) { $d = $e['data']; if (!empty($d['refused']) || ($d['date'] ?? '') < $in['du'] || ($d['date'] ?? '') > $in['au']) continue; $sid = (int)($d['supplierId'] ?? 0); $k = (string)($ct[$sid]['data']['kind'] ?? '');
                if ($kind !== 'tous' && $k !== $kind) continue; $tt = pil_c(pil_purch_total($d, $dv)); $pp = pil_c(pil_purch_paid($d, $dv)); $t += $tt; $p += $pp; $n++; $nm = isset($ct[$sid]) ? pil_contact_label($ct[$sid]) : '?'; $by[$nm] = ($by[$nm] ?? 0) + $tt; }
            arsort($by);
            return $src(['factures' => $n, 'total_ttc' => $t, 'paye' => $p, 'reste' => $t - $p, 'par_fournisseur' => array_slice($by, 0, 15, true)], 'Factures fournisseurs enregistrées dans BâtiPro (date de facture)', 'du ' . pil_d($in['du']) . ' au ' . pil_d($in['au']));
        case 'alertes':
            $l = pil_alerts_list(!empty($in['toutes']) ? null : ['nouvelle', 'en_cours']);
            return $src(['alertes' => array_map(fn($a) => array_diff_key($a, ['history' => 1, 'akey' => 1]), array_slice($l, 0, 40)), 'nombre' => count($l)], 'Alertes de direction calculées par BâtiPro (règles déterministes)');
        case 'comparer_mois':
            if (!preg_match('/^\d{4}-\d{2}$/', (string)($in['mois1'] ?? '')) || !preg_match('/^\d{4}-\d{2}$/', (string)($in['mois2'] ?? ''))) return ['error' => 'Mois invalides (AAAA-MM).'];
            return $src(pil_compare_months($in['mois1'], $in['mois2']), 'Extraits, factures, achats et rapports quotidiens', $in['mois1'] . ' et ' . $in['mois2']);
        case 'proposer_action':
            $me = current_user(); $just = mb_substr(trim((string)($in['justification'] ?? '')), 0, 2000);
            if (($in['type'] ?? '') === 'relance_client') {
                $inv = q("SELECT id, number, data FROM items WHERE id = ? AND company_id = ? AND type = 'invoice'", [(int)($in['facture_id'] ?? 0), cid()])->fetch();
                if (!$inv) return ['error' => 'Facture introuvable.'];
                $d = json_decode($inv['data'], true) ?: []; $s = pil_inv_state(['data' => $d], $today);
                $cl = q("SELECT data FROM items WHERE id = ? AND company_id = ? AND type = 'contact'", [(int)($d['clientId'] ?? 0), cid()])->fetch(); $cd = $cl ? (json_decode($cl['data'], true) ?: []) : [];
                if (empty($cd['email'])) return ['error' => 'Le client n\'a pas d\'adresse e-mail dans BâtiPro : relance impossible à préparer.', '_manquant' => ['e-mail du client']];
                $co = setting('company', []) ?: [];
                $body = trim((string)($in['texte_email'] ?? '')) ?: "Madame, Monsieur,\n\nSauf erreur de notre part, la facture n° {$inv['number']} du " . pil_d($d['date'] ?? null) . ' (échéance ' . pil_d($d['due'] ?? null) . ') présente un solde impayé de ' . pil_fmt(pil_c($s['rest'])) . ".\nNous vous remercions de bien vouloir procéder au règlement.\n\nCordialement,\n" . ($co['name'] ?? '');
                $a = pil_approval_request(['type' => 'email_externe', 'origin' => 'ia', 'description' => 'Relance de la facture ' . $inv['number'] . ' (' . pil_contact_label(['data' => $cd]) . ')', 'amount' => pil_c($s['rest']), 'justification' => $just,
                    'payload' => ['to' => $cd['email'], 'to_name' => pil_contact_label(['data' => $cd]), 'subject' => 'Rappel – facture ' . $inv['number'], 'body' => $body, 'invoice_id' => (int)$inv['id']], 'risks' => ['E-mail externe envoyé au client au nom de l\'entreprise'], 'documents' => [['type' => 'invoice', 'id' => (int)$inv['id'], 'name' => $inv['number']]]], $me);
                return ['proposition_creee' => true, 'demande' => $a['id'], 'statut' => 'en attente d\'approbation', '_source' => 'Centre d\'approbation'];
            }
            if (($in['type'] ?? '') === 'paiement_rapprochement') {
                $t = q('SELECT * FROM pil_bank_tx WHERE id = ? AND company_id = ?', [(int)($in['mouvement_id'] ?? 0), cid()])->fetch(); if (!$t) return ['error' => 'Mouvement introuvable.'];
                $type = in_array($in['document_type'] ?? '', ['invoice', 'expense'], true) ? $in['document_type'] : ''; $doc = $type ? q('SELECT id, number FROM items WHERE id = ? AND company_id = ? AND type = ?', [(int)($in['document_id'] ?? 0), cid(), $type])->fetch() : null;
                if (!$doc) return ['error' => 'Document introuvable.'];
                $a = pil_approval_request(['type' => 'paiement_rapprochement', 'origin' => 'ia', 'description' => 'Proposition IA : enregistrer le paiement de ' . pil_fmt(abs((int)$t['amount'])) . ' du ' . pil_d($t['booking_date']) . ' dans ' . ($type === 'invoice' ? 'la facture ' : 'l\'achat ') . ($doc['number'] ?: '#' . $doc['id']),
                    'payload' => ['tx_id' => (int)$t['id'], 'type' => $type, 'id' => (int)$doc['id']], 'amount' => abs((int)$t['amount']), 'justification' => $just, 'risks' => ['Modifie l\'état de paiement du document dans BâtiPro.']], $me);
                return ['proposition_creee' => true, 'demande' => $a['id'], 'statut' => 'en attente d\'approbation', '_source' => 'Centre d\'approbation'];
            }
            return ['error' => 'Type d\'action non autorisé.'];
        case 'creer_tache_interne':
            $title = mb_substr(trim((string)($in['titre'] ?? '')), 0, 190); if ($title === '') return ['error' => 'Titre vide.'];
            $data = ['title' => $title, 'notes' => mb_substr((string)($in['details'] ?? ''), 0, 2000), 'due' => $dateOk($in['echeance'] ?? null) ? $in['echeance'] : null, 'status' => 'todo', 'priority' => 'normal', 'source' => 'Pilotage (assistant IA)'];
            q('INSERT INTO items (company_id, type, project_id, parent_id, number, data, lite, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)', [cid(), 'task', null, null, null, json_encode($data, JSON_UNESCAPED_UNICODE), null, current_user()['id'] ?? null, current_user()['id'] ?? null, now(), now()]);
            $tid = (int)db()->lastInsertId(); pil_audit('tache_ia', 'task', $tid, null, $data, 'ia');
            return ['tache_creee' => $tid, 'titre' => $title, '_source' => 'Tâches BâtiPro'];
        case 'revue_prevision':
            if (!$dateOk($in['date_rapport'] ?? null)) return ['error' => 'Date invalide (AAAA-MM-JJ).'];
            return $src(pil_forecast_review($in['date_rapport'], max(1, min(90, (int)($in['jours'] ?? 30)))), 'Rapport quotidien enregistré + extraits bancaires + paiements BâtiPro');
    }
    return ['error' => 'Outil inconnu'];
}
/** Section B du rapport sans écrire d'alertes (lecture pour l'assistant). */
function pil_report_build_light(string $today): array {
    $rec = pil_receivables($today); $fc = pil_forecast($today);
    $openInv = array_values(array_filter($rec['invoices'], fn($i) => $i['ea'] === null && $i['rest'] > 0));
    $overdue = array_values(array_filter($openInv, fn($i) => in_array($i['state'], ['echu', 'partiel_echu'], true)));
    $chase = []; foreach ($overdue as $i) { $k = $i['client_name'] ?: '?'; $chase[$k] = ['client' => $k, 'montant' => ($chase[$k]['montant'] ?? 0) + $i['rest'], 'factures' => ($chase[$k]['factures'] ?? 0) + 1, 'retard_max_jours' => max($chase[$k]['retard_max_jours'] ?? 0, $i['late_days'])]; }
    usort($chase, fn($a, $b) => $b['montant'] <=> $a['montant']);
    $exp = array_sum(array_map(fn($f) => $f['amount'], array_filter($fc['scenarios']['realiste']['flows'], fn($f) => in_array($f['source'], ['facture', 'etat_avancement'], true) && pil_days($today, $f['date']) <= 30)));
    return ['B' => ['a_encaisser' => array_sum(array_column($openInv, 'rest')), 'factures_ouvertes' => count($openInv), 'echu' => array_sum(array_column($overdue, 'rest')), 'factures_echues' => count($overdue), 'encaissements_attendus_30j_realiste' => $exp, 'clients_a_relancer' => array_slice($chase, 0, 15)]];
}

// ===================================================================== IA : explication et assistant
function pil_ai_ready(): bool {
    if (!function_exists('ai_ready')) require_once dirname(__DIR__) . '/ai.php';
    if (!ai_ready()) return false;
    require_once dirname(__DIR__) . '/vendor/autoload.php';
    return true;
}
/** Montants (format belge 1.234,56) présents dans un texte. */
function pil_amounts_in_text(string $t): array {
    preg_match_all('/-?\d{1,3}(?:[.\x{202F}\x{00A0} ]\d{3})*,\d{2}/u', $t, $m);
    return array_values(array_unique(array_map(fn($s) => (int)str_replace([',', '.', "\u{202F}", "\u{00A0}", ' '], ['', '', '', '', ''], $s), $m[0])));
}
/** Tous les montants (en centimes) présents dans des données, pour vérifier que l'IA n'en invente pas. */
function pil_amounts_in_data($d, array &$acc = []): array {
    if (is_array($d)) { foreach ($d as $v) pil_amounts_in_data($v, $acc); }
    elseif (is_int($d) && abs($d) >= 100) { $acc[abs($d)] = true; }
    elseif (is_string($d)) foreach (pil_amounts_in_text($d) as $a) $acc[abs($a)] = true;
    return $acc;
}
function pil_ai_verify(string $text, array $data): array {
    $known = pil_amounts_in_data($data); $bad = [];
    foreach (pil_amounts_in_text($text) as $a) if (!isset($known[abs($a)])) $bad[] = pil_fmt($a);
    return ['ok' => !$bad, 'unverified' => $bad];
}
function pil_ai_system(): string {
    $co = setting('company', []) ?: [];
    return "Tu es le directeur financier et opérationnel virtuel de « " . ($co['name'] ?? 'MADIBU Group') . " », entreprise de construction en Belgique. Tu aides la direction à décider.\n"
        . "Règles absolues :\n"
        . "- Tu n'utilises QUE les données fournies (rapport ou résultats des outils). Tu n'inventes jamais un montant, une date, un client ou un fait.\n"
        . "- Tu ne fais pas de nouveaux calculs financiers : les montants sont calculés par BâtiPro ; recopie-les tels quels (format 1.234,56 €). Les montants des données sont en CENTIMES : 123456 = 1.234,56 €.\n"
        . "- Pour chaque réponse, indique la période, la source et les hypothèses (champs _periode, _source, _hypotheses).\n"
        . "- Si une information manque (champ _manquant, extraits non couverts, donnée absente de BâtiPro), dis-le explicitement au lieu de deviner.\n"
        . "- Tu ne peux exécuter aucun paiement, signer, accepter un contrat, envoyer un e-mail ou une commande, ni modifier une donnée financière : pour une action sensible, utilise proposer_action (elle va au centre d'approbation, la direction décide). Tu peux créer une tâche interne.\n"
        . "- Réponds dans la langue de la question (souvent roumain ou français), de façon concise et structurée.";
}
/** Commentaire du rapport quotidien par l'IA (facultatif) ; les montants cités sont vérifiés contre le rapport. */
function pil_ai_comment(array $data): array {
    try { if (!pil_ai_ready()) return [null, null]; } catch (Throwable $e) { return [null, null]; }
    $d = $data; unset($d['snapshot']);
    // données limitées : pas d'IBAN ni de texte bancaire brut
    foreach ($d['A']['accounts'] as &$a) unset($a['iban']); unset($a);
    try {
        $client = new Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url());
        $resp = $client->beta->messages->create(maxTokens: 2500, model: AI_MODEL, system: pil_ai_system(),
            messages: [['role' => 'user', 'content' => "Voici le rapport financier quotidien calculé par BâtiPro (JSON). Rédige en français un commentaire de direction de 8 à 12 lignes : situation de trésorerie, principaux risques, et pourquoi les 5 priorités sont dans cet ordre. Cite uniquement des montants présents dans le JSON.\n\n" . json_encode($d, JSON_UNESCAPED_UNICODE)]],
            outputConfig: ['effort' => 'low'], fallbacks: 'default', betas: ['server-side-fallback-2026-07-01']);
        $txt = ''; foreach ($resp->content as $b) if ($b->type === 'text') $txt .= $b->text;
        $txt = trim($txt); if ($txt === '') return [null, null];
        return [$txt, pil_ai_verify($txt, $d)];
    } catch (Throwable $e) { error_log('[pilotage IA] ' . $e->getMessage()); return [null, ['ok' => false, 'error' => 'IA indisponible : ' . mb_substr($e->getMessage(), 0, 200)]]; }
}
/** Question en langage naturel : l'IA appelle les requêtes métier contrôlées, puis répond ; réponse vérifiée et conservée. */
function pil_ask(array $me, string $question, ?int $convId, string $today): array {
    if (!pil_ai_ready()) fail(400, 'Assistant IA non configuré : ajoutez la clé API Claude dans Paramètres → Assistant IA.');
    @set_time_limit(180);
    $conv = $convId ? q('SELECT * FROM pil_ai_convs WHERE id = ? AND company_id = ? AND user_id = ?', [$convId, cid(), $me['id']])->fetch() : null;
    if ($convId && !$conv) fail(404, 'Conversation introuvable');
    $turns = $conv ? (json_decode($conv['turns'], true) ?: []) : [];
    $msgs = [];
    foreach (array_slice($turns, -8) as $t) { $msgs[] = ['role' => 'user', 'content' => $t['q']]; $msgs[] = ['role' => 'assistant', 'content' => $t['a'] !== '' ? $t['a'] : '(pas de réponse)']; }
    $msgs[] = ['role' => 'user', 'content' => $question . "\n\n[Date du jour : $today]"];
    $client = new Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url());
    $used = []; $data = [];
    for ($i = 0; $i < 8; $i++) {
        $resp = $client->beta->messages->create(maxTokens: 6000, model: AI_MODEL, system: pil_ai_system(), tools: pil_ai_tools(), messages: $msgs, outputConfig: ['effort' => 'medium'], fallbacks: 'default', betas: ['server-side-fallback-2026-07-01']);
        $msgs[] = ['role' => 'assistant', 'content' => $resp->content];
        if ($resp->stopReason !== 'tool_use') break;
        $res = [];
        foreach ($resp->content as $b) {
            if ($b->type !== 'tool_use') continue;
            $in = is_array($b->input) ? $b->input : (array)$b->input; $used[] = ['outil' => $b->name, 'parametres' => $in];
            try { $r = pil_run_tool($b->name, $in, $today); } catch (Throwable $e) { $r = ['error' => $e->getMessage()]; }
            $data[] = $r;
            $res[] = ['type' => 'tool_result', 'toolUseID' => $b->id, 'content' => json_encode($r, JSON_UNESCAPED_UNICODE), 'isError' => isset($r['error'])];
        }
        $msgs[] = ['role' => 'user', 'content' => $res];
    }
    $answer = ''; foreach ($resp->content as $b) if ($b->type === 'text') $answer .= $b->text;
    $answer = trim($answer) ?: 'Je n\'ai pas pu formuler de réponse fiable à partir des données disponibles.';
    $check = pil_ai_verify($answer, $data);
    pil_audit('question_ia', 'ai_conv', $convId, null, ['question' => $question, 'outils' => $used, 'verification' => $check], 'ia', (int)$me['id']);
    $turns[] = ['q' => $question, 'a' => $answer, 'tools' => $used, 'check' => $check, 'at' => now(), 'pinned' => false];
    if ($conv) q('UPDATE pil_ai_convs SET turns = ?, updated_at = ? WHERE id = ?', [json_encode($turns, JSON_UNESCAPED_UNICODE), now(), $conv['id']]);
    else { q('INSERT INTO pil_ai_convs (company_id, user_id, title, turns, created_at, updated_at) VALUES (?,?,?,?,?,?)', [cid(), $me['id'], mb_substr($question, 0, 190), json_encode($turns, JSON_UNESCAPED_UNICODE), now(), now()]); $convId = (int)db()->lastInsertId(); }
    return ['conv_id' => $convId ?: (int)$conv['id'], 'answer' => $answer, 'tools' => $used, 'check' => $check, 'index' => count($turns) - 1];
}

// ===================================================================== Tâche planifiée (cron.php)
/** Une analyse par firme et par jour (à partir de 6 h), seulement pour les firmes où le module est activé. */
function pil_cron(): array {
    $done = [];
    if ((int)date('G') < 6 && !getenv('PIL_CRON_FORCE')) return $done;
    foreach (q("SELECT company_id, v FROM settings WHERE k = 'pilotage'")->fetchAll() as $r) {
        $s = json_decode((string)$r['v'], true) ?: []; if (empty($s['enabled'])) continue;
        $GLOBALS['BP_CID'] = (int)$r['company_id'];
        try {
            pil_director_schema();
            $today = date('Y-m-d');
            pil_security_schema(); pil_approvals_expire(); // demandes d'approbation dépassées → « expirée »
            if (q("SELECT id FROM pil_runs WHERE company_id = ? AND rdate = ? AND source = 'cron' AND status = 'ok'", [cid(), $today])->fetch()) continue; // déjà fait aujourd'hui
            $done[cid()] = pil_report_run($today, 'cron')['message'];
        } catch (Throwable $e) { error_log('[pilotage cron] firme ' . cid() . ' : ' . $e->getMessage()); $done[cid()] = 'erreur : ' . $e->getMessage(); }
    }
    return $done;
}

// ===================================================================== Vue générale (direction), explications, rapprochement
/** Empreinte légère des données utilisées par les analyses : si rien n'a changé, le rapport du jour est réutilisé tel quel. */
function pil_data_signature(): string {
    $parts = [
        q("SELECT CONCAT(COUNT(*), '/', COALESCE(MAX(id),0), '/', COALESCE(SUM(status = 'importe'),0)) FROM pil_bank_imports WHERE company_id = ?", [cid()])->fetchColumn(),
        q("SELECT CONCAT(COUNT(*), '/', COALESCE(MAX(updated_at),'')) FROM pil_bank_tx WHERE company_id = ?", [cid()])->fetchColumn(),
        q("SELECT CONCAT(COUNT(*), '/', COALESCE(MAX(updated_at),''), '/', COALESCE(MAX(id),0)) FROM items WHERE company_id = ? AND type IN ('invoice','expense','quote','project','order','timesheet','contact')", [cid()])->fetchColumn(),
        q("SELECT CONCAT(COUNT(*), '/', COALESCE(MAX(updated_at),''), '/', COALESCE(MAX(id),0)) FROM pil_commitments WHERE company_id = ?", [cid()])->fetchColumn(),
        json_encode(setting('pilotage_hyp', null)), q('SELECT COUNT(*) FROM pil_doc_flags WHERE company_id = ?', [cid()])->fetchColumn(),
    ];
    return hash('sha256', implode('|', $parts));
}
/** Vue générale : lue dans le rapport du jour (calculé par le cron) ; recalculée seulement si les données ont changé depuis. */
function pil_overview(string $today): array {
    $r = q('SELECT data, updated_at FROM pil_reports WHERE company_id = ? AND rdate = ?', [cid(), $today])->fetch();
    $sig = pil_data_signature();
    if (!$r || ((json_decode($r['data'], true) ?: [])['signature'] ?? '') !== $sig) { pil_report_run($today, 'manuel', null, false); $r = q('SELECT data, updated_at FROM pil_reports WHERE company_id = ? AND rdate = ?', [cid(), $today])->fetch(); }
    $d = json_decode($r['data'], true);
    $series = $d['snapshot']['series'] ?? [];
    // capacité de paiement : point le plus bas du solde prévu (réaliste) sur 30 jours = ce qui peut sortir en plus sans passer sous zéro
    $min30 = null; $minDate = null;
    foreach ($series as [$day, $bal]) if (pil_days($today, $day) <= 30 && ($min30 === null || $bal < $min30)) { $min30 = $bal; $minDate = $day; }
    $sup = $d['C']['to_pay'];
    usort($sup, fn($a, $b) => strcmp((string)($a['due'] ?: '9999'), (string)($b['due'] ?: '9999')));
    $alerts = array_slice(pil_alerts_list(['nouvelle', 'en_cours']), 0, 3);
    $rec = pil_receivables($today);
    $toValidate = array_sum(array_map(fn($e) => $e['rest'], array_filter($rec['expenses'], fn($e) => $e['rest'] > 0 && $e['state'] === 'a_valider')));
    return ['date' => $today, 'computed_at' => $r['updated_at'], 'reliability' => ['score' => $d['A']['reliability'], 'level' => $d['A']['reliability_level']],
        'kpi' => [
            'tresorerie' => ['value' => $d['A']['total'], 'status' => 'confirme', 'date' => $d['A']['latest_statement'], 'oldest' => $d['A']['oldest_statement']],
            'prevision30' => ['value' => $d['A']['forecast']['realiste'][30]['end'], 'status' => 'estime', 'pessimiste' => $d['A']['forecast']['pessimiste'][30]['end'], 'optimiste' => $d['A']['forecast']['optimiste'][30]['end']],
            'creances' => ['value' => $d['B']['pending_amount'], 'status' => 'confirme', 'overdue' => $d['B']['overdue_amount'], 'count' => $d['B']['pending_count']],
            'dettes' => ['value' => array_sum(array_map(fn($e) => $e['rest'], array_filter($rec['expenses'], fn($e) => $e['rest'] > 0))), 'status' => $toValidate ? 'a_verifier' : 'confirme', 'to_validate' => $toValidate],
        ],
        'decisions' => [
            'payer_semaine' => ['capacity' => $min30 !== null ? max(0, $min30) : null, 'min' => $min30, 'min_date' => $minDate, 'due_7d' => array_sum(array_map(fn($e) => $e['rest'], array_filter($sup, fn($e) => $e['due'] && pil_days($today, $e['due']) <= 7)))],
            'fournisseurs' => array_slice($sup, 0, 5),
            'clients' => array_slice($d['B']['to_chase'], 0, 5),
            'chantiers' => $d['D']['deficit'],
            'soldes' => ['j30' => $d['A']['forecast']['realiste'][30], 'j90' => $d['A']['forecast']['realiste'][90], 'j30_pess' => $d['A']['forecast']['pessimiste'][30], 'j90_pess' => $d['A']['forecast']['pessimiste'][90]],
            'risques' => array_map(fn($a) => ['id' => $a['id'], 'title' => $a['title'], 'severity' => $a['severity'], 'amount' => $a['amount']], $alerts),
            'aujourdhui' => $d['E'],
        ]];
}
/** Explication d'un indicateur : source, période, transactions ou documents utilisés, hypothèses, incertitudes. */
function pil_explain(string $k, string $today): array {
    if ($k === 'tresorerie') {
        $bal = pil_balances($today); $rows = [];
        foreach ($bal['accounts'] as $a) { $i = q("SELECT filename, period_from, period_to, opening, closing, tx_count FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_to DESC LIMIT 1", [cid(), $a['id']])->fetch();
            $rows[] = ['label' => "{$a['bank']}" . ($a['label'] ? " – {$a['label']}" : ''), 'amount' => $a['balance'], 'detail' => $i ? "solde final de l'extrait « {$i['filename']} » (" . pil_d($i['period_from']) . ' → ' . pil_d($i['period_to']) . ", {$i['tx_count']} mouvements)" : 'aucun extrait importé', 'link' => "#/pilotage/mouvements"]; }
        $unval = (int)q("SELECT COUNT(*) FROM pil_bank_tx WHERE company_id = ? AND status <> 'valide'", [cid()])->fetchColumn();
        $breaks = 0; foreach (pil_dashboard()['accounts'] as $a) $breaks += count($a['breaks']);
        return ['title' => 'Trésorerie consolidée', 'value' => $bal['total'], 'status' => 'confirme', 'source' => 'Soldes finaux des derniers extraits bancaires importés (un par compte).',
            'period' => $bal['oldest_date'] ? 'Extraits du ' . pil_d($bal['oldest_date']) . ' au ' . pil_d($bal['latest_date']) : 'aucun extrait', 'items' => $rows,
            'hypotheses' => ['Aucune : montant lu sur les extraits de la banque.'],
            'uncertainties' => array_values(array_filter(array_merge(array_map(fn($a) => $a['age_days'] > 7 ? "{$a['bank']} : extrait vieux de {$a['age_days']} jours (mouvements plus récents inconnus)." : null, $bal['accounts']),
                [$bal['missing'] ? "{$bal['missing']} compte(s) sans extrait." : null, $breaks ? "$breaks rupture(s) de solde entre extraits." : null, $unval ? "$unval mouvement(s) pas encore validé(s) (sans effet sur le solde, seulement sur leur classement)." : null])))];
    }
    if ($k === 'prevision30') {
        $f = pil_forecast($today); $h = $f['scenarios']['realiste']['horizons'][30];
        $fl = array_values(array_filter($f['scenarios']['realiste']['flows'], fn($x) => pil_days($today, $x['date']) <= 30));
        return ['title' => 'Prévision de trésorerie à 30 jours (scénario réaliste)', 'value' => $h['end'], 'status' => 'estime', 'source' => 'Soldes des extraits + factures clients (délais observés) + achats à payer + engagements confirmés.',
            'period' => 'du ' . pil_d($today) . ' au ' . pil_d(pil_add_days($today, 30)),
            'items' => array_map(fn($x) => ['label' => pil_d($x['date']) . ' – ' . $x['label'], 'amount' => $x['amount'], 'detail' => $x['certainty'] === 'confirme' ? 'confirmé' : 'estimé', 'link' => ($x['ref']['type'] ?? '') === 'invoice' ? "#/invoice/{$x['ref']['id']}" : (($x['ref']['type'] ?? '') === 'expense' ? "#/purchase/{$x['ref']['id']}" : null)], $fl),
            'summary' => ['Solde de départ' => $h['start'], 'Entrées confirmées' => $h['in_confirmed'], 'Entrées estimées' => $h['in_estimated'], 'Sorties confirmées' => $h['out_confirmed'], 'Sorties estimées' => $h['out_estimated'], 'Solde final' => $h['end'], 'Minimum' => $h['min']],
            'hypotheses' => ['Délai client : ' . $f['hypotheses']['realiste']['delay'] . ' observé' . ($f['stats']['global']['n'] ? " ({$f['stats']['global']['n']} factures payées)" : ' (aucun historique : échéance contractuelle)'), 'Probabilité d\'encaissement observée pour les factures en retard : ' . ($f['hypotheses']['realiste']['useProbability'] ? 'oui' : 'non'), 'Achats payés à leur échéance ; engagements confirmés à leurs dates.'],
            'uncertainties' => array_merge(["Fiabilité de la prévision : {$f['reliability']['score']}/100 ({$f['reliability']['level']})."], array_map(fn($x) => 'Non inclus : ' . $x['label'] . ' (' . $x['reason'] . ')', array_slice($f['excluded'], 0, 10)))];
    }
    if ($k === 'creances' || $k === 'dettes') {
        $rec = pil_receivables($today);
        if ($k === 'creances') { $l = array_values(array_filter($rec['invoices'], fn($i) => $i['ea'] === null && $i['rest'] > 0));
            return ['title' => 'Créances clients', 'value' => array_sum(array_column($l, 'rest')), 'status' => 'confirme', 'source' => 'Factures émises dans BâtiPro, moins les paiements enregistrés.', 'period' => 'au ' . pil_d($today),
                'items' => array_map(fn($i) => ['label' => ($i['number'] ?: '#' . $i['id']) . ' – ' . $i['client_name'], 'amount' => $i['rest'], 'detail' => 'échéance ' . pil_d($i['due']) . ($i['late_days'] ? " · {$i['late_days']} j de retard" : '') . ($i['state'] === 'conteste' ? ' · contestée' : ''), 'link' => "#/invoice/{$i['id']}"], $l),
                'hypotheses' => ['Montant dû = total TTC − paiements enregistrés (aucune estimation).'],
                'uncertainties' => array_values(array_filter([($n = count(array_filter($l, fn($i) => $i['late_days'] > 60))) ? "$n facture(s) en retard de plus de 60 jours : encaissement incertain." : null, ($n2 = count(array_filter($l, fn($i) => $i['state'] === 'conteste'))) ? "$n2 facture(s) contestée(s)." : null]))]; }
        $l = array_values(array_filter($rec['expenses'], fn($e) => $e['rest'] > 0));
        return ['title' => 'Dettes fournisseurs', 'value' => array_sum(array_column($l, 'rest')), 'status' => 'confirme', 'source' => 'Factures fournisseurs et sous-traitants enregistrées dans BâtiPro (non refusées), moins les paiements.', 'period' => 'au ' . pil_d($today),
            'items' => array_map(fn($e) => ['label' => ($e['ref'] ?: '#' . $e['id']) . ' – ' . $e['supplier_name'], 'amount' => $e['rest'], 'detail' => ($e['due'] ? 'échéance ' . pil_d($e['due']) : 'échéance non renseignée') . ($e['to_validate'] ? ' · à valider' : ''), 'link' => "#/purchase/{$e['id']}"], $l),
            'hypotheses' => ['Montant dû = total TTC − paiements enregistrés.'],
            'uncertainties' => array_values(array_filter([($n = count(array_filter($l, fn($e) => $e['to_validate']))) ? "$n facture(s) encore « à valider » : montants à vérifier." : null, ($n2 = count(array_filter($l, fn($e) => !$e['due']))) ? "$n2 facture(s) sans échéance." : null]))];
    }
    fail(404, 'Indicateur inconnu');
}
/** Mouvements non rapprochés (hors transferts internes), avec la meilleure proposition pour chacun. */
function pil_reconcile_list(string $today): array {
    $rows = q("SELECT * FROM pil_bank_tx WHERE company_id = ? AND match_id IS NULL AND category <> 'transfert_interne' AND ABS(amount) >= 100 AND booking_date >= ? ORDER BY booking_date DESC LIMIT 300", [cid(), pil_add_days($today, -400)])->fetchAll();
    $out = []; $sure = 0;
    foreach ($rows as $t) { $s = pil_match_suggestions($t); $best = $s[0] ?? null; if ($best && $best['level'] === 'sûr') $sure++;
        $out[] = ['tx' => pil_tx_out($t), 'best' => $best, 'others' => count($s) - ($best ? 1 : 0)]; }
    $matched = (int)q("SELECT COUNT(*) FROM pil_bank_tx WHERE company_id = ? AND match_id IS NOT NULL", [cid()])->fetchColumn();
    return ['rows' => $out, 'matched' => $matched, 'with_sure' => $sure];
}

// ===================================================================== Routes
function pil_director_route(string $method, array $seg, array $me): void {
    pil_director_schema();
    $sub = $seg[1]; $id = isset($seg[2]) ? (int)$seg[2] : 0;
    $today = preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['today'] ?? '')) ? $_GET['today'] : date('Y-m-d');
    switch ($sub) {
        case 'overview': if ($method === 'GET') out(pil_overview($today)); break;
        case 'explain': if ($method === 'GET') out(pil_explain((string)($seg[2] ?? ''), $today)); break;
        case 'reconcile': if ($method === 'GET') out(pil_reconcile_list($today)); break;
        case 'projects':
            if ($method === 'GET') {
                $l = pil_projects_analysis($today);
                if (pil_role($me) === 'project_manager') { // ses chantiers uniquement (responsable ou membre de l'équipe)
                    $mine = []; foreach (pil_items(['project'])['project'] as $p) if ((int)($p['data']['managerId'] ?? 0) === (int)$me['id'] || in_array((int)$me['id'], array_map('intval', (array)($p['data']['team'] ?? [])), true)) $mine[$p['id']] = true;
                    $l = array_values(array_filter($l, fn($p) => isset($mine[$p['id']])));
                }
                out($l);
            }
            break;
        case 'alerts':
            if ($method === 'GET') out(pil_alerts_list(!empty($_GET['all']) ? null : ['nouvelle', 'en_cours']));
            if ($method === 'PUT' && $id) {
                $a = q('SELECT * FROM pil_alerts WHERE id = ? AND company_id = ?', [$id, cid()])->fetch(); if (!$a) fail(404, 'Alerte introuvable');
                $b = body(); $hist = json_decode((string)$a['history'], true) ?: []; $set = []; $args = [];
                if (isset($b['status'])) { if (!in_array($b['status'], PIL_AST, true)) fail(400, 'Statut inconnu'); $set[] = 'status = ?'; $args[] = $b['status']; $set[] = 'resolved_at = ?'; $args[] = $b['status'] === 'resolue' ? now() : null; }
                if (array_key_exists('owner', $b)) { $set[] = 'owner = ?'; $args[] = mb_substr(trim((string)$b['owner']), 0, 120); }
                if (array_key_exists('due', $b)) { if ($b['due'] !== null && $b['due'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$b['due'])) fail(400, 'Date invalide'); $set[] = 'due = ?'; $args[] = $b['due'] ?: null; }
                $hist[] = ['at' => now(), 'by' => $me['id'], 'event' => 'modifiée par l\'utilisateur', 'to' => array_intersect_key($b, ['status' => 1, 'owner' => 1, 'due' => 1]), 'note' => mb_substr(trim((string)($b['note'] ?? '')), 0, 500)];
                $set[] = 'history = ?'; $args[] = json_encode($hist, JSON_UNESCAPED_UNICODE); $set[] = 'updated_at = ?'; $args[] = now();
                q('UPDATE pil_alerts SET ' . implode(', ', $set) . ' WHERE id = ?', array_merge($args, [$id]));
                pil_audit('alerte_modifiee', 'alert', $id, array_intersect_key($a, ['status' => 1, 'owner' => 1, 'due' => 1]), array_intersect_key($b, ['status' => 1, 'owner' => 1, 'due' => 1, 'note' => 1]));
                if (trim((string)($b['note'] ?? '')) !== '') q('INSERT INTO pil_decisions (company_id, rdate, alert_id, text, kind, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [cid(), $today, $id, mb_substr(trim((string)$b['note']), 0, 2000), 'decision', ($b['status'] ?? '') === 'resolue' ? 'realisee' : 'decidee', $me['id'], now()]);
                out(pil_alert_out(q('SELECT * FROM pil_alerts WHERE id = ?', [$id])->fetch()));
            }
            break;
        case 'reports':
            if ($method === 'GET' && ($seg[2] ?? '') === '') out(q('SELECT rdate, version, source, updated_at, (ai_comment IS NOT NULL) ai FROM pil_reports WHERE company_id = ? ORDER BY rdate DESC LIMIT 400', [cid()])->fetchAll());
            if ($method === 'GET') { $d = (string)$seg[2]; if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) fail(400, 'Date invalide'); $r = pil_report_get($d); if (!$r) fail(404, 'Aucun rapport pour cette date'); out($r); }
            if ($method === 'POST') { $r = pil_report_run($today, 'manuel', $me, empty(body()['noAi'])); out($r + ['report' => pil_report_get($today)]); }
            break;
        case 'decisions':
            if ($method === 'GET') out(array_map(fn($x) => $x + ['id' => (int)$x['id']], q('SELECT id, rdate, alert_id, text, kind, status, created_by, created_at, done_at FROM pil_decisions WHERE company_id = ? ORDER BY id DESC LIMIT 500', [cid()])->fetchAll()));
            if ($method === 'POST') { $b = body(); $t = trim((string)($b['text'] ?? '')); if ($t === '') fail(400, 'Texte vide');
                q('INSERT INTO pil_decisions (company_id, rdate, alert_id, text, kind, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [cid(), $today, !empty($b['alert_id']) ? (int)$b['alert_id'] : null, mb_substr($t, 0, 2000), in_array($b['kind'] ?? '', ['decision', 'action', 'recommandation'], true) ? $b['kind'] : 'decision', 'decidee', $me['id'], now()]);
                $did = (int)db()->lastInsertId(); pil_audit('decision', 'decision', $did, null, ['texte' => $t, 'alerte' => $b['alert_id'] ?? null]);
                out(['ok' => true, 'id' => $did]); }
            if ($method === 'PUT' && $id) { $st = (string)(body()['status'] ?? ''); if (!in_array($st, ['decidee', 'realisee', 'abandonnee'], true)) fail(400, 'Statut inconnu');
                q('UPDATE pil_decisions SET status = ?, done_by = ?, done_at = ? WHERE id = ? AND company_id = ?', [$st, $me['id'], $st === 'decidee' ? null : now(), $id, cid()]); pil_audit('decision_statut', 'decision', $id, null, ['status' => $st]); out(['ok' => true]); }
            break;
        case 'compare': if ($method === 'GET') { foreach (['m1', 'm2'] as $k) if (!preg_match('/^\d{4}-\d{2}$/', (string)($_GET[$k] ?? ''))) fail(400, 'Mois invalide'); out(pil_compare_months($_GET['m1'], $_GET['m2'])); } break;
        case 'review': if ($method === 'GET') { if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($_GET['date'] ?? ''))) fail(400, 'Date invalide'); out(pil_forecast_review($_GET['date'], max(1, min(90, (int)($_GET['days'] ?? 30))))); } break;
        case 'runs': if ($method === 'GET') out(q('SELECT rdate, source, started_at, finished_at, status, message FROM pil_runs WHERE company_id = ? ORDER BY id DESC LIMIT 60', [cid()])->fetchAll()); break;
        case 'ask':
            if ($method === 'POST') { $b = body(); $qq = trim((string)($b['question'] ?? '')); if ($qq === '') fail(400, 'Question vide'); out(pil_ask($me, mb_substr($qq, 0, 2000), !empty($b['conv_id']) ? (int)$b['conv_id'] : null, $today)); }
            break;
        case 'convs':
            if ($method === 'GET' && !$id) out(q('SELECT id, title, updated_at FROM pil_ai_convs WHERE company_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 50', [cid(), $me['id']])->fetchAll());
            if ($method === 'GET' && $id) { $c = q('SELECT * FROM pil_ai_convs WHERE id = ? AND company_id = ? AND user_id = ?', [$id, cid(), $me['id']])->fetch(); if (!$c) fail(404, 'Conversation introuvable'); out(['id' => (int)$c['id'], 'title' => $c['title'], 'turns' => json_decode($c['turns'], true)]); }
            if ($method === 'PUT' && $id) { // réponse importante : épinglée (historique)
                $c = q('SELECT * FROM pil_ai_convs WHERE id = ? AND company_id = ? AND user_id = ?', [$id, cid(), $me['id']])->fetch(); if (!$c) fail(404, 'Conversation introuvable');
                $t = json_decode($c['turns'], true) ?: []; $k = (int)(body()['index'] ?? -1); if (!isset($t[$k])) fail(400, 'Réponse introuvable');
                $t[$k]['pinned'] = !empty(body()['pinned']); q('UPDATE pil_ai_convs SET turns = ? WHERE id = ?', [json_encode($t, JSON_UNESCAPED_UNICODE), $id]); out(['ok' => true]); }
            break;
        case 'pinned':
            if ($method === 'GET') { $o = []; foreach (q('SELECT id, turns FROM pil_ai_convs WHERE company_id = ?', [cid()])->fetchAll() as $c) foreach (json_decode($c['turns'], true) ?: [] as $i => $t) if (!empty($t['pinned'])) $o[] = ['conv_id' => (int)$c['id'], 'index' => $i, 'q' => $t['q'], 'a' => $t['a'], 'at' => $t['at']]; out($o); }
            break;
    }
    fail(404, 'Route inconnue');
}
