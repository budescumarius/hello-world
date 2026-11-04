<?php
// PILOTAGE – « Où est passé l'argent ? » : à partir des extraits bancaires importés, suit l'argent encaissé sur une période
// jusqu'aux dépenses qui l'ont consommé, avec les documents BatiPro (achats, factures, chantiers) et les e-mails liés.
// Méthode transparente et sans invention : l'argent est fongible, BatiPro applique une règle d'attribution explicite :
//  - « prudent » (premier entré, premier sorti) : l'argent déjà en banque avant la période est dépensé d'abord, puis les encaissements dans l'ordre ;
//  - « direct » : chaque dépense est d'abord payée avec les encaissements de la période (tant qu'il en reste).
// Les transferts entre vos propres comptes ne sont ni des encaissements ni des dépenses. Montants en centimes.
declare(strict_types=1);

function pil_trail(array $me, array $p): array {
    $d = fn($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    $from = $d($p['from'] ?? null); $to = $d($p['to'] ?? null);
    if (!$from || !$to || $from > $to) throw new PilError('Période des encaissements invalide.', 400);
    $until = $d($p['until'] ?? null) ?: date('Y-m-d'); if ($until < $to) $until = $to;
    $mode = ($p['mode'] ?? 'fifo') === 'direct' ? 'direct' : 'fifo';
    $min = max(0, (int)round((float)str_replace(',', '.', (string)($p['min'] ?? 0)) * 100));
    $qf = mb_strtolower(trim((string)($p['q'] ?? '')));
    $warn = [];

    // couverture des extraits (une période sans extrait = argent qu'on ne peut pas suivre)
    foreach (pil_accounts() as $a) {
        if (!$a['active']) continue;
        $cov = q("SELECT MIN(period_from) f, MAX(period_to) t FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe'", [cid(), $a['id']])->fetch();
        if (!$cov['f']) $warn[] = "{$a['bank']} {$a['label']} : aucun extrait importé (ce compte n'est pas suivi).";
        elseif ($cov['f'] > $from || $cov['t'] < $until) $warn[] = "{$a['bank']} {$a['label']} : extraits du " . pil_d($cov['f']) . ' au ' . pil_d($cov['t']) . ' (la période analysée n\'est pas entièrement couverte).';
    }
    $opening = pil_trail_opening($from);
    if ($opening === null) { $warn[] = 'Solde avant le ' . pil_d($from) . ' inconnu (pas d\'extrait couvrant cette date) : compté comme 0.'; $opening = 0; }

    $rows = q("SELECT t.*, a.bank, a.label AS acc_label FROM pil_bank_tx t JOIN pil_bank_accounts a ON a.id = t.account_id WHERE t.company_id = ? AND t.booking_date BETWEEN ? AND ? AND t.category <> 'transfert_interne' ORDER BY t.booking_date, (t.amount < 0), t.id",
        [cid(), $from, $until])->fetchAll();
    $isTarget = function (array $t) use ($from, $to, $min, $qf) {
        if ((int)$t['amount'] <= 0 || $t['booking_date'] < $from || $t['booking_date'] > $to || abs((int)$t['amount']) < $min) return false;
        if ($qf !== '' && !str_contains(mb_strtolower($t['cp_name'] . ' ' . $t['name_fix'] . ' ' . $t['communication']), $qf)) return false;
        return true;
    };
    // sacs d'argent : avant la période, encaissements ciblés, autres encaissements
    $bags = []; if ($opening > 0) $bags[] = ['k' => 'avant', 'left' => $opening, 'tx' => null];
    $targets = []; $alloc = []; $overdraft = 0;
    foreach ($rows as $t) {
        $amt = (int)$t['amount'];
        if ($amt > 0) {
            $tg = $isTarget($t);
            $bags[] = ['k' => $tg ? 'cible' : 'autre', 'left' => $amt, 'tx' => (int)$t['id']];
            if ($tg) $targets[] = ['id' => (int)$t['id'], 'date' => $t['booking_date'], 'amount' => $amt, 'cp' => $t['name_fix'] ?: $t['cp_name'], 'communication' => mb_substr((string)$t['communication'], 0, 140), 'account' => trim($t['bank'] . ' ' . $t['acc_label']), 'category' => $t['category']];
            continue;
        }
        $need = -$amt; $fromTarget = 0;
        $order = array_keys($bags);
        if ($mode === 'direct') usort($order, fn($x, $y) => ($bags[$x]['k'] === 'cible' ? 0 : 1) <=> ($bags[$y]['k'] === 'cible' ? 0 : 1) ?: $x <=> $y);
        foreach ($order as $i) {
            if ($need <= 0) break;
            if ($bags[$i]['left'] <= 0) continue;
            $take = min($need, $bags[$i]['left']); $bags[$i]['left'] -= $take; $need -= $take;
            if ($bags[$i]['k'] === 'cible') $fromTarget += $take;
        }
        if ($need > 0) $overdraft += $need;
        $bags = array_values(array_filter($bags, fn($b) => $b['left'] > 0));
        if ($fromTarget > 0) $alloc[] = ['t' => $t, 'part' => $fromTarget];
    }
    $total = array_sum(array_column($targets, 'amount'));
    $left = array_sum(array_map(fn($b) => $b['k'] === 'cible' ? $b['left'] : 0, $bags));
    $spent = array_sum(array_column($alloc, 'part'));

    // documents BatiPro liés (rapprochement fait, sinon achat de même montant à ±30 jours = « probable »)
    $items = pil_items(['expense', 'invoice', 'contact', 'project']);
    $byId = []; foreach ($items as $type => $l) foreach ($l as $it) $byId[$type][(int)$it['id']] = $it;
    $pname = fn($id) => $id && isset($byId['project'][(int)$id]) ? (string)($byId['project'][(int)$id]['data']['name'] ?? '') : '';
    $cname = fn($id) => $id && isset($byId['contact'][(int)$id]) ? pil_contact_label($byId['contact'][(int)$id]) : '';
    $expTtc = function (array $e) { $d = $e['data']; $ht = (float)($d['amount'] ?? 0); return (int)round(100 * (isset($d['ttc']) && $d['ttc'] !== '' ? (float)$d['ttc'] : $ht * (1 + (float)($d['vat'] ?? 0) / 100))); };
    $details = [];
    foreach ($alloc as $x) {
        $t = $x['t']; $doc = null;
        if ($t['match_type'] && $t['match_id'] && isset($byId[$t['match_type']][(int)$t['match_id']])) {
            $it = $byId[$t['match_type']][(int)$t['match_id']];
            $doc = ['type' => $t['match_type'], 'id' => (int)$it['id'], 'ref' => (string)($it['number'] ?: ($it['data']['ref'] ?? '')), 'tiers' => $cname($it['data']['supplierId'] ?? $it['data']['clientId'] ?? 0), 'project_id' => $it['project_id'] !== null ? (int)$it['project_id'] : null, 'sure' => true];
        } else {
            foreach ($byId['expense'] ?? [] as $e) {
                if (abs($expTtc($e) - abs((int)$t['amount'])) > 1) continue;
                $ed = (string)($e['data']['date'] ?? ''); if ($ed === '' || abs(strtotime($ed) - strtotime($t['booking_date'])) > 30 * 86400) continue;
                $doc = ['type' => 'expense', 'id' => (int)$e['id'], 'ref' => (string)($e['data']['ref'] ?? ''), 'tiers' => $cname($e['data']['supplierId'] ?? 0), 'project_id' => $e['project_id'] !== null ? (int)$e['project_id'] : null, 'sure' => false]; break;
            }
        }
        $details[] = ['id' => (int)$t['id'], 'date' => $t['booking_date'], 'cp' => $t['name_fix'] ?: $t['cp_name'], 'communication' => mb_substr((string)$t['communication'], 0, 160), 'category' => $t['category'],
            'category_label' => PIL_CATS[$t['category']][0] ?? $t['category'], 'amount' => -(int)$t['amount'], 'part' => $x['part'], 'account' => trim($t['bank'] . ' ' . $t['acc_label']), 'status' => $t['status'], 'doc' => $doc,
            'project_id' => $doc['project_id'] ?? null, 'project' => $pname($doc['project_id'] ?? null)];
    }
    // regroupements
    $group = function (callable $key) use ($details) { $g = [];
        foreach ($details as $x) { $k = $key($x); $g[$k] = $g[$k] ?? ['label' => $k, 'part' => 0, 'n' => 0]; $g[$k]['part'] += $x['part']; $g[$k]['n']++; }
        usort($g, fn($a, $b) => $b['part'] <=> $a['part']); return array_values($g); };
    $byCat = $group(fn($x) => $x['category_label']);
    $byCp = array_slice($group(fn($x) => ($x['doc']['tiers'] ?? '') ?: ($x['cp'] ?: '(sans nom)')), 0, 30);
    $byProj = $group(fn($x) => $x['project'] ?: 'Sans chantier identifié');
    $byMonth = $group(fn($x) => substr($x['date'], 0, 7)); usort($byMonth, fn($a, $b) => strcmp($a['label'], $b['label']));
    $unclassified = array_sum(array_map(fn($x) => $x['category'] === 'a_classer' ? $x['part'] : 0, $details));
    if ($unclassified) $warn[] = pil_fmt($unclassified) . ' attribué(s) à des mouvements « à classer » : classez-les (Transactions) pour un rapport plus précis.';
    if ($overdraft) $warn[] = 'Des dépenses ont dépassé l\'argent disponible (découvert) pour ' . pil_fmt($overdraft) . '.';

    // e-mails liés (boîtes de l'utilisateur uniquement) : même tiers / même montant / même référence, autour de la date du paiement
    usort($details, fn($a, $b) => $b['part'] <=> $a['part']);
    $accs = q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN);
    if ($accs && q("SHOW TABLES LIKE 'pil_mail_msgs'")->fetch()) {
        $in = implode(',', array_map('intval', $accs));
        foreach ($details as $i => $x) {
            if ($i >= 30) break;
            $terms = array_filter([pil_trail_word($x['doc']['tiers'] ?? ''), pil_trail_word($x['cp']), $x['doc']['ref'] ?? '', number_format($x['amount'] / 100, 2, ',', '.')], fn($v) => is_string($v) && mb_strlen($v) >= 4);
            if (!$terms) continue;
            $w = []; $pp = [cid(), date('Y-m-d', strtotime($x['date'] . ' -45 days')), date('Y-m-d 23:59:59', strtotime($x['date'] . ' +5 days'))];
            foreach ($terms as $tm) { $w[] = '(subject LIKE ? OR from_name LIKE ? OR body LIKE ?)'; $l = '%' . addcslashes($tm, '%_\\') . '%'; array_push($pp, $l, $l, $l); }
            $details[$i]['mails'] = array_map(fn($m) => ['id' => (int)$m['id'], 'at' => $m['at'], 'subject' => $m['subject'], 'from' => $m['from_name'] ?: $m['from_email'], 'folder' => $m['folder']],
                q("SELECT id, at, subject, from_name, from_email, folder FROM pil_mail_msgs WHERE company_id = ? AND account_id IN ($in) AND at BETWEEN ? AND ? AND (" . implode(' OR ', $w) . ') ORDER BY at DESC LIMIT 3', $pp)->fetchAll());
        }
    }
    return ['periode' => ['du' => $from, 'au' => $to, 'suivi_jusqu_au' => $until], 'methode' => $mode, 'filtre' => ['min' => $min, 'texte' => $qf],
        'encaisse' => $total, 'depense' => $spent, 'reste' => $left, 'solde_avant' => $opening, 'encaissements' => $targets, 'par_categorie' => $byCat, 'par_tiers' => $byCp, 'par_chantier' => $byProj, 'par_mois' => $byMonth,
        'depenses' => $details, 'avertissements' => $warn,
        '_source' => 'Extraits bancaires importés (hors transferts internes) + achats, factures et chantiers de BatiPro + vos e-mails relevés', '_methode' => $mode === 'fifo' ? 'Premier entré, premier sorti : l\'argent déjà en banque part d\'abord' : 'Les encaissements de la période paient d\'abord les dépenses suivantes'];
}
/** Argent en banque au début du jour $from (tous les comptes suivis) : solde d'ouverture du premier extrait + mouvements avant cette date ; null si un compte n'a pas d'extrait jusque-là. */
function pil_trail_opening(string $from): ?int {
    $tot = 0;
    foreach (pil_accounts() as $a) {
        if (!$a['active']) continue;
        $first = q("SELECT period_from, opening FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' AND opening IS NOT NULL ORDER BY period_from, id LIMIT 1", [cid(), $a['id']])->fetch();
        if (!$first || $first['period_from'] > $from) return null;
        $tot += (int)$first['opening'] + (int)q('SELECT COALESCE(SUM(amount),0) FROM pil_bank_tx WHERE company_id = ? AND account_id = ? AND booking_date < ? AND booking_date >= ?', [cid(), $a['id'], $from, $first['period_from']])->fetchColumn();
    }
    return $tot;
}
function pil_trail_word(string $s): string {
    $s = trim(preg_replace('/\b(SRL|SPRL|SA|NV|BV|BVBA|SCS|SNC|GMBH|LTD|SAS|SARL|ASBL|VZW)\b\.?/i', '', $s));
    $w = preg_split('/[\s,.\-\/]+/u', $s); usort($w, fn($a, $b) => mb_strlen($b) <=> mb_strlen($a));
    return (string)($w[0] ?? '');
}
/** Résumé par l'IA (facultatif) : uniquement à partir du calcul ci-dessus, montants vérifiés. */
function pil_trail_ai(array $r): array {
    if (!pil_ai_ready()) throw new PilError('Assistant IA non configuré (Paramètres → Assistant IA).', 400);
    $data = $r; $data['depenses'] = array_slice(array_map(fn($x) => array_diff_key($x, ['mails' => 1]), $r['depenses']), 0, 40);
    $client = new Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url());
    $resp = $client->beta->messages->create(maxTokens: 2500, model: AI_MODEL, system: pil_ai_system(),
        messages: [['role' => 'user', 'content' => "Voici le calcul de BâtiPro « Où est passé l'argent ? » (JSON, montants en CENTIMES). Rédige en français un rapport de direction de 10 à 15 lignes : combien a été encaissé, où il est parti (principales catégories, fournisseurs, chantiers), ce qui reste, ce qui est incertain (avertissements, mouvements à classer, rapprochements « probables »). Recopie les montants tels quels au format 1.234,56 € ; n'en invente aucun ; rappelle la méthode d'attribution.\n\n" . json_encode($data, JSON_UNESCAPED_UNICODE)]],
        outputConfig: ['effort' => 'low'], fallbacks: 'default', betas: ['server-side-fallback-2026-07-01']);
    $txt = ''; foreach ($resp->content as $b) if ($b->type === 'text') $txt .= $b->text;
    return ['texte' => trim($txt), 'verification' => pil_ai_verify($txt, $data)];
}
