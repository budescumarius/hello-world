<?php
declare(strict_types=1);
/**
 * PILOTAGE – outils de l'assistant pour relier e-mails et chantiers (« que penses-tu du chantier X ? »).
 * Lecture seule. E-mails : uniquement les boîtes de l'utilisateur qui pose la question, IBAN masqués, textes limités.
 * Montants en centimes (comme les autres outils) ; l'IA ne fait que lire et relier.
 */

function pil_ask_tool_defs(): array {
    $o = fn(array $props = [], array $req = []) => ['type' => 'object', 'properties' => (object)$props, 'required' => $req];
    return [
        ['name' => 'fiche_chantier', 'description' => 'FICHE COMPLÈTE D\'UN CHANTIER (par nom, numéro, client ou ville, ou par id) : client, adresse, statut, dates ; analyse financière (marché, facturé, encaissé, coûts, marge, avancement) ; devis ; factures clients (reste, retard) ; achats et sous-traitants (reste à payer) ; points ouverts (à faire / à voir) ; derniers PV de réunion (notes) ; heures ; nombre d\'e-mails liés. Utilise-la AVANT de donner un avis sur un chantier.',
            'inputSchema' => $o(['recherche' => ['type' => 'string', 'description' => 'nom, numéro, client ou ville du chantier'], 'chantier_id' => ['type' => 'integer']])],
        ['name' => 'chercher_emails', 'description' => 'CHERCHE DANS LES E-MAILS de l\'utilisateur (reçus et envoyés, 120 derniers jours) : par texte (objet, expéditeur, contenu), expéditeur, chantier (e-mails liés au chantier ou citant son nom / son adresse), depuis une date. Renvoie pour chaque e-mail : id (à citer « #id »), date, de, à, objet, résumé, pièces jointes, état (à faire, fait…). Pour le texte complet : lire_email.',
            'inputSchema' => $o(['recherche' => ['type' => 'string'], 'expediteur' => ['type' => 'string', 'description' => 'nom ou adresse'], 'chantier_id' => ['type' => 'integer'], 'depuis' => ['type' => 'string', 'description' => 'AAAA-MM-JJ'], 'limite' => ['type' => 'integer', 'description' => 'au plus 40 (défaut 20)']])],
        ['name' => 'lire_email', 'description' => 'Texte d\'un e-mail (id trouvé avec chercher_emails), avec ses pièces jointes (noms) et son tri (résumé, action, échéance). IBAN masqués.',
            'inputSchema' => $o(['id' => ['type' => 'integer']], ['id'])],
    ];
}

function pil_ask_me(): ?array { return $GLOBALS['PIL_ASK_ME'] ?? null; }
function pil_ask_accounts(): array {
    $me = pil_ask_me(); if (!$me) return [];
    try { return array_map('intval', q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN)); }
    catch (Throwable $e) { return []; } // module e-mails pas encore utilisé
}
function pil_ask_find_project(array $in, array $projects): ?array {
    if (!empty($in['chantier_id'])) { foreach ($projects as $p) if ($p['id'] === (int)$in['chantier_id']) return $p; return null; }
    $q = mb_strtolower(trim((string)($in['recherche'] ?? ''))); if ($q === '') return null;
    $best = null; $score = 0;
    foreach ($projects as $p) { $d = $p['data'];
        $hay = mb_strtolower(implode(' ', [$d['name'] ?? '', $p['number'] ?? '', $d['city'] ?? '', $d['address'] ?? '', $d['_client'] ?? '']));
        $s = str_contains($hay, $q) ? 100 : 0;
        foreach (preg_split('/\s+/', $q) as $w) if (mb_strlen($w) >= 3 && str_contains($hay, $w)) $s += 10;
        if (in_array($d['status'] ?? '', ['encours', 'preparation', 'reception'], true)) $s += 1;
        if ($s > $score) { $score = $s; $best = $p; } }
    return $score >= 10 ? $best : null;
}

/** null = outil inconnu ici (laissé aux outils financiers). */
function pil_ask_tool(string $name, array $in, string $today): ?array {
    if (!in_array($name, ['fiche_chantier', 'chercher_emails', 'lire_email'], true)) return null;
    require_once __DIR__ . '/mail.php'; pil_mail_schema();
    $all = pil_items(['project', 'contact']); $cn = []; foreach ($all['contact'] as $c) $cn[$c['id']] = pil_contact_label($c);
    foreach ($all['project'] as &$p) $p['data']['_client'] = $cn[(int)($p['data']['clientId'] ?? 0)] ?? ''; unset($p);
    $src = fn(array $r, string $s) => $r + ['_source' => $s, '_periode' => 'au ' . pil_d($today)];

    if ($name === 'fiche_chantier') {
        $p = pil_ask_find_project($in, $all['project']);
        if (!$p) return ['error' => 'Chantier introuvable. Chantiers en cours : ' . implode(' ; ', array_map(fn($x) => $x['data']['name'] ?? '', array_slice(array_values(array_filter($all['project'], fn($x) => in_array($x['data']['status'] ?? '', ['encours', 'preparation', 'reception'], true))), 0, 30)))];
        $pid = $p['id']; $d = $p['data'];
        $fin = null; foreach (pil_projects_analysis($today) as $a) if ((int)($a['id'] ?? 0) === $pid) { unset($a['top_suppliers']); $fin = $a; }
        $rec = pil_receivables($today);
        $items = pil_items(['quote', 'point', 'meeting', 'timesheet', 'order']);
        $mine = fn($t) => array_values(array_filter($items[$t], fn($x) => $x['project_id'] === $pid));
        $quotes = array_map(fn($x) => ['numero' => $x['number'], 'date' => $x['data']['date'] ?? null, 'titre' => $x['data']['title'] ?? '', 'statut' => $x['data']['status'] ?? '', 'total_ht' => isset($x['data']['_sum']['base']) ? pil_c((float)$x['data']['_sum']['base']) : null], array_filter($mine('quote'), fn($x) => empty($x['data']['estimate'])));
        $inv = array_values(array_map(fn($i) => ['numero' => $i['number'], 'date' => $i['date'], 'echeance' => $i['due'], 'total' => $i['total'], 'reste' => $i['rest'], 'etat' => $i['state'], 'retard_jours' => $i['late_days']], array_filter($rec['invoices'], fn($i) => $i['project_id'] === $pid)));
        $exp = array_values(array_map(fn($e) => ['fournisseur' => $e['supplier_name'], 'ref' => $e['ref'], 'date' => $e['date'], 'echeance' => $e['due'], 'total' => $e['total'], 'reste' => $e['rest'], 'etat' => $e['state']], array_filter($rec['expenses'], fn($e) => $e['project_id'] === $pid)));
        $kind = fn($x) => in_array($x['data']['kind'] ?? '', ['voir', 'remarque'], true) ? $x['data']['kind'] : 'faire';
        $pts = array_values(array_map(fn($x) => ['n' => $x['number'], 'type' => $kind($x), 'titre' => $x['data']['title'] ?? '', 'intervenant' => $cn[(int)($x['data']['companyId'] ?? 0)] ?? 'notre équipe', 'echeance' => $x['data']['due'] ?? null, 'en_retard' => !empty($x['data']['due']) && $x['data']['due'] < $today],
            array_filter($mine('point'), fn($x) => in_array($x['data']['status'] ?? '', ['open', 'progress'], true))));
        $mts = $mine('meeting'); usort($mts, fn($a, $b) => strcmp((string)($b['data']['date'] ?? ''), (string)($a['data']['date'] ?? '')));
        $hours = array_sum(array_map(fn($t) => (float)($t['data']['hours'] ?? 0), $mine('timesheet')));
        $accs = pil_ask_accounts(); $nMail = 0;
        if ($accs) $nMail = (int)q('SELECT COUNT(*) FROM pil_mail_msgs WHERE account_id IN (' . implode(',', $accs) . ') AND (project_id = ? OR subject LIKE ?)', [$pid, '%' . addcslashes((string)($d['name'] ?? '#'), '%_\\') . '%'])->fetchColumn();
        return $src(['chantier' => ['id' => $pid, 'numero' => $p['number'], 'nom' => $d['name'] ?? '', 'client' => $d['_client'], 'adresse' => trim(($d['address'] ?? '') . ' ' . ($d['city'] ?? '')), 'statut' => $d['status'] ?? '', 'debut' => $d['start'] ?? null, 'fin' => $d['end'] ?? null],
            'finances' => $fin, 'devis' => array_slice(array_values($quotes), 0, 20), 'factures_clients' => array_slice($inv, 0, 30), 'achats' => array_slice($exp, 0, 40),
            'points_ouverts' => array_slice($pts, 0, 40), 'nombre_points_ouverts' => count($pts),
            'derniers_pv' => array_map(fn($m) => ['date' => $m['data']['date'] ?? null, 'titre' => $m['data']['title'] ?? '', 'notes' => mb_substr((string)($m['data']['notes'] ?? ''), 0, 800), 'prochaine' => $m['data']['next'] ?? null], array_slice($mts, 0, 3)),
            'heures' => round($hours, 1), 'commandes' => count($mine('order')), 'emails_lies' => $nMail,
            '_conseil' => $nMail ? 'Pour les échanges : chercher_emails avec chantier_id = ' . $pid : 'Aucun e-mail lié trouvé par le nom ; essayer chercher_emails avec le nom du client ou l\'adresse.'],
            'Chantier, devis, factures, achats, points, PV et heures de BâtiPro (calculs PHP)');
    }

    $accs = pil_ask_accounts();
    if (!$accs) return ['error' => 'Aucune boîte e-mail connectée pour cet utilisateur (E-mails → Connexions).'];
    $in_ = implode(',', $accs);
    if ($name === 'lire_email') {
        $m = q("SELECT * FROM pil_mail_msgs WHERE id = ? AND account_id IN ($in_)", [(int)($in['id'] ?? 0)])->fetch();
        if (!$m) return ['error' => 'E-mail introuvable dans vos boîtes.'];
        $a = json_decode((string)$m['analysis'], true) ?: [];
        return $src(['id' => (int)$m['id'], 'dossier' => $m['folder'], 'date' => $m['at'], 'de' => trim($m['from_name'] . ' <' . $m['from_email'] . '>'), 'a' => array_map(fn($r) => $r['email'] ?? '', json_decode((string)$m['to_json'], true) ?: []),
            'objet' => $m['subject'], 'texte' => pil_mail_mask(mb_substr((string)($m['body'] ?: $m['preview']), 0, 6000)), 'pieces_jointes' => array_column(json_decode((string)$m['atts'], true) ?: [], 'name'),
            'tri' => array_intersect_key($a, array_flip(['categorie', 'urgence', 'resume', 'action', 'echeance'])), 'etat' => $m['state'], 'chantier_id' => $m['project_id'] !== null ? (int)$m['project_id'] : null], 'E-mails relevés dans BâtiPro (boîtes de l\'utilisateur)');
    }
    // chercher_emails
    $w = ["account_id IN ($in_)", "folder IN ('in', 'sent')", 'at >= ?']; $p = [!empty($in['depuis']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$in['depuis']) ? $in['depuis'] : date('Y-m-d', strtotime("$today -120 days"))];
    $like = fn($s) => '%' . addcslashes($s, '%_\\') . '%';
    $t = trim((string)($in['recherche'] ?? ''));
    if ($t !== '') { $sub = []; foreach (array_slice(array_filter(preg_split('/\s+/', $t), fn($x) => mb_strlen($x) >= 2), 0, 6) as $word) { $sub[] = '(subject LIKE ? OR from_name LIKE ? OR from_email LIKE ? OR preview LIKE ? OR body LIKE ? OR to_json LIKE ?)'; array_push($p, ...array_fill(0, 6, $like($word))); } if ($sub) $w[] = implode(' AND ', $sub); }
    $e = trim((string)($in['expediteur'] ?? '')); if ($e !== '') { $w[] = '(from_name LIKE ? OR from_email LIKE ? OR to_json LIKE ?)'; array_push($p, $like($e), $like($e), $like($e)); }
    if (!empty($in['chantier_id'])) {
        $pr = pil_ask_find_project(['chantier_id' => (int)$in['chantier_id']], $all['project']);
        $alt = []; $ap = [(int)$in['chantier_id']];
        if ($pr) foreach (array_filter([$pr['data']['name'] ?? '', $pr['data']['address'] ?? '', $pr['number'] ?? '']) as $k) if (mb_strlen($k) >= 4) { $alt[] = '(subject LIKE ? OR body LIKE ?)'; array_push($ap, $like($k), $like($k)); }
        $w[] = '(project_id = ?' . ($alt ? ' OR ' . implode(' OR ', $alt) : '') . ')'; array_push($p, ...$ap);
    }
    $lim = max(1, min(40, (int)($in['limite'] ?? 20)));
    $rows = q('SELECT id, folder, at, from_name, from_email, to_json, subject, preview, analysis, atts, state, project_id FROM pil_mail_msgs WHERE ' . implode(' AND ', $w) . " ORDER BY at DESC LIMIT $lim", $p)->fetchAll();
    return $src(['emails' => array_map(function ($m) { $a = json_decode((string)$m['analysis'], true) ?: [];
        return ['id' => (int)$m['id'], 'dossier' => $m['folder'] === 'sent' ? 'envoyé' : 'reçu', 'date' => $m['at'], 'de' => $m['from_name'] ?: $m['from_email'], 'a' => implode(', ', array_slice(array_map(fn($r) => $r['email'] ?? '', json_decode((string)$m['to_json'], true) ?: []), 0, 3)),
            'objet' => $m['subject'], 'resume' => pil_mail_mask((string)($a['resume'] ?? $m['preview'])), 'action' => $a['action'] ?? null, 'pieces_jointes' => array_column(json_decode((string)$m['atts'], true) ?: [], 'name'), 'etat' => $m['state'], 'chantier_id' => $m['project_id'] !== null ? (int)$m['project_id'] : null]; }, $rows),
        'nombre' => count($rows)], 'E-mails relevés dans BâtiPro (boîtes de l\'utilisateur, 120 derniers jours par défaut)');
}
