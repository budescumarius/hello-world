<?php
declare(strict_types=1);
/**
 * PILOTAGE – Conseiller e-mails : ce que vos e-mails demandent, croisé avec BatiPro (factures impayées, achats, chantiers).
 * 1) Signaux calculés par BatiPro (toujours disponibles, sans IA) : chaque conseil cite les e-mails et les montants d'où il vient.
 * 2) Conseil du jour rédigé par l'IA (facultatif) à partir de ces seuls signaux : montants vérifiés, rien n'est exécuté ni envoyé.
 */

/** Signaux du jour pour les boîtes de l'utilisateur. */
function pil_mail_signals(array $me, string $today): array {
    $accs = array_map('intval', q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN));
    if (!$accs) return ['conseils' => [], 'stats' => []];
    $in = implode(',', $accs);
    $since = date('Y-m-d H:i:s', strtotime("$today -30 days"));
    $msgs = array_map(fn($r) => pil_mail_msg_out($r) + ['conv_id' => $r['conv_id'], 'has_att' => $r['atts'] !== null], q("SELECT * FROM pil_mail_msgs WHERE company_id = ? AND account_id IN ($in) AND folder = 'in' AND moved IS NULL AND at >= ? ORDER BY at DESC", [cid(), $since])->fetchAll());
    $open = array_values(array_filter($msgs, fn($m) => in_array($m['state'], ['a_faire', 'nouveau'], true)));
    $who = fn($m) => $m['from_name'] ?: $m['from_email'];
    $ref = fn($m) => ['id' => $m['id'], 'de' => $who($m), 'objet' => $m['subject'], 'recu' => $m['at']];
    $days = fn($at) => max(0, (int)floor((strtotime($today . ' 23:59:59') - strtotime((string)$at)) / 86400));
    $out = [];
    $add = function (string $kind, string $level, string $titre, string $detail, array $list = [], ?int $montant = null, ?string $href = null) use (&$out) {
        $out[] = ['kind' => $kind, 'level' => $level, 'titre' => $titre, 'detail' => $detail, 'emails' => array_slice($list, 0, 8), 'montant' => $montant, 'href' => $href];
    };

    // 1. urgent
    $urg = array_values(array_filter($open, fn($m) => ($m['analysis']['urgence'] ?? '') === 'haute'));
    if ($urg) $add('urgent', 'haute', count($urg) . ' e-mail(s) urgent(s) à traiter', implode(' · ', array_map(fn($m) => $who($m) . ' : ' . ($m['analysis']['action'] ?? $m['subject']), array_slice($urg, 0, 3))), array_map($ref, $urg));
    // 2. échéances demandées dans les e-mails (aujourd'hui, demain, dépassées)
    $due = array_values(array_filter($open, fn($m) => !empty($m['analysis']['echeance']) && $m['analysis']['echeance'] <= date('Y-m-d', strtotime("$today +1 day"))));
    usort($due, fn($a, $b) => strcmp($a['analysis']['echeance'], $b['analysis']['echeance']));
    if ($due) $add('echeance', 'haute', count($due) . ' demande(s) avec une échéance aujourd\'hui, demain ou dépassée', implode(' · ', array_map(fn($m) => pil_d($m['analysis']['echeance']) . ' – ' . $who($m) . ' : ' . ($m['analysis']['action'] ?? $m['subject']), array_slice($due, 0, 3))), array_map($ref, $due));
    // 3. on vous attend : réponse nécessaire, sans réponse depuis plus de 2 jours
    $wait = array_values(array_filter($open, fn($m) => !empty($m['analysis']['reponse_necessaire']) && $days($m['at']) > 2));
    usort($wait, fn($a, $b) => strcmp($a['at'], $b['at']));
    if ($wait) $add('attente', 'normale', count($wait) . ' personne(s) attendent votre réponse depuis plus de 2 jours', 'Le plus ancien : ' . $who($wait[0]) . ' (' . $days($wait[0]['at']) . ' jours) – « ' . $wait[0]['subject'] . ' ». Une réponse courte (« bien reçu, je reviens vers vous jeudi ») évite les relances.', array_map($ref, $wait));
    // 4. réponses préparées qui attendent votre relecture
    $drafts = (int)q("SELECT COUNT(*) FROM pil_mail_drafts WHERE company_id = ? AND account_id IN ($in) AND status = 'brouillon'", [cid()])->fetchColumn();
    if ($drafts) $add('brouillons', 'normale', "$drafts réponse(s) préparée(s) attendent votre relecture", 'Relisez, corrigez si besoin, puis « Envoyer » : rien ne part sans vous.', [], null, 'drafts');

    // contacts BatiPro connus par leur e-mail
    $contacts = [];
    foreach (q("SELECT id, data FROM items WHERE company_id = ? AND type = 'contact'", [cid()])->fetchAll() as $r) { $d = json_decode($r['data'], true) ?: [];
        foreach (preg_split('/[,;\s]+/', mb_strtolower((string)($d['email'] ?? ''))) as $e) if ($e !== '') $contacts[$e] = ['id' => (int)$r['id'], 'kind' => (string)($d['kind'] ?? ''), 'name' => (string)($d['company'] ?? '') ?: trim(($d['firstname'] ?? '') . ' ' . ($d['name'] ?? ''))]; }

    // 5. un client qui vous écrit alors qu'il a des factures échues (seulement si l'utilisateur voit la trésorerie)
    if (pil_can($me, 'treasury.read')) {
        require_once __DIR__ . '/treasury.php';
        $rec = pil_receivables($today); $late = [];
        foreach ($rec['invoices'] as $i) if ($i['ea'] === null && $i['rest'] > 0 && in_array($i['state'], ['echu', 'partiel_echu'], true) && $i['client']) {
            $late[$i['client']] = ['montant' => ($late[$i['client']]['montant'] ?? 0) + $i['rest'], 'factures' => array_merge($late[$i['client']]['factures'] ?? [], [$i['number']]), 'retard' => max($late[$i['client']]['retard'] ?? 0, $i['late_days'])]; }
        $seen = [];
        foreach ($msgs as $m) { $c = $contacts[(string)$m['from_email']] ?? null;
            if (!$c || !isset($late[$c['id']]) || isset($seen[$c['id']]) || $days($m['at']) > 14) continue; $seen[$c['id']] = true; $l = $late[$c['id']];
            $add('client_impaye', 'haute', $c['name'] . ' vous a écrit et doit ' . pil_fmt($l['montant']), count($l['factures']) . ' facture(s) échue(s) (' . implode(', ', array_slice($l['factures'], 0, 4)) . ', retard jusqu\'à ' . $l['retard'] . ' jours). En lui répondant, rappelez le paiement – ou attendez le paiement avant d\'engager de nouveaux frais pour lui.', [$ref($m)], $l['montant']); }
    }
    // 6. factures de fournisseurs reçues par e-mail et pas encore encodées dans les achats
    $refs = [];
    foreach (q("SELECT data FROM items WHERE company_id = ? AND type = 'expense'", [cid()])->fetchAll(PDO::FETCH_COLUMN) as $d) { $r = mb_strtolower(trim((string)((json_decode($d, true) ?: [])['ref'] ?? ''))); if ($r !== '') $refs[$r] = true; }
    $toBook = [];
    foreach ($msgs as $m) {
        if ($m['state'] === 'fait' || $days($m['at']) > 21) continue;
        $isInv = preg_match('/factur|invoice|faktuur|rekening|note de cr[ée]dit|creditnota/i', (string)$m['subject']) && ($m['has_att'] || ($m['analysis']['pieces'] ?? ''));
        $isInv = $isInv || (($m['analysis']['categorie'] ?? '') === 'fournisseur' && preg_match('/factur|invoice|faktuur/i', (string)($m['analysis']['resume'] ?? '') . ' ' . $m['subject']) && $m['has_att']);
        if (!$isInv) continue;
        $c = $contacts[(string)$m['from_email']] ?? null; if ($c && $c['kind'] === 'client') continue;
        preg_match_all('/[A-Za-z0-9][A-Za-z0-9\/._-]*\d[A-Za-z0-9\/._-]*/', (string)$m['subject'], $tok);
        $known = false; foreach ($tok[0] as $t) if (mb_strlen($t) >= 3 && isset($refs[mb_strtolower($t)])) $known = true;
        if (!$known) $toBook[] = $m;
    }
    if ($toBook) $add('achats', 'normale', count($toBook) . ' facture(s) de fournisseur reçue(s) par e-mail, pas encore dans les achats', 'Encodez-les (Achats → importer le PDF) pour que la trésorerie, les échéances et la rentabilité des chantiers soient justes. ' . implode(' · ', array_map(fn($m) => $who($m) . ' : ' . $m['subject'], array_slice($toBook, 0, 3))), array_map($ref, $toBook));
    // 7. chantiers qui demandent de l'attention
    $byP = []; foreach ($open as $m) if ($m['project_id']) $byP[$m['project_id']][] = $m;
    if ($byP) { $names = []; foreach (q("SELECT id, data FROM items WHERE company_id = ? AND type = 'project'", [cid()])->fetchAll() as $r) $names[(int)$r['id']] = (string)((json_decode($r['data'], true) ?: [])['name'] ?? '');
        uasort($byP, fn($a, $b) => count($b) <=> count($a));
        foreach (array_slice($byP, 0, 3, true) as $pid => $l) if (count($l) >= 2) $add('chantier', 'normale', ($names[$pid] ?? 'Chantier') . ' : ' . count($l) . ' e-mails ouverts', 'Plusieurs demandes sur le même chantier : traitez-les ensemble (un appel au chef de chantier ou au client règle souvent tout).', array_map($ref, $l), null, "#/project/$pid"); }
    // 8. vous avez écrit, personne n'a répondu (3 à 14 jours)
    $sent = q("SELECT s.id, s.subject, s.at, s.to_json, s.conv_id FROM pil_mail_msgs s WHERE s.company_id = ? AND s.account_id IN ($in) AND s.folder = 'sent' AND s.at BETWEEN ? AND ? AND s.conv_id IS NOT NULL AND s.conv_id <> ''
        AND NOT EXISTS (SELECT 1 FROM pil_mail_msgs r WHERE r.account_id = s.account_id AND r.folder = 'in' AND r.conv_id = s.conv_id AND r.at > s.at) ORDER BY s.at", [cid(), date('Y-m-d H:i:s', strtotime("$today -14 days")), date('Y-m-d H:i:s', strtotime("$today -3 days"))])->fetchAll();
    $sent = array_values(array_filter($sent, function ($s) use ($contacts) { $to = json_decode((string)$s['to_json'], true) ?: []; return $to && (bool)array_filter($to, fn($r) => isset($contacts[$r['email'] ?? ''])); }));
    if ($sent) { $to = fn($s) => implode(', ', array_map(fn($r) => $r['name'] ?: $r['email'], array_slice(json_decode((string)$s['to_json'], true) ?: [], 0, 2)));
        $add('relance', 'info', count($sent) . ' e-mail(s) envoyé(s) à vos contacts sans réponse', 'À relancer si c\'est important : ' . implode(' · ', array_map(fn($s) => $to($s) . ' – « ' . $s['subject'] . ' » (' . pil_d(substr($s['at'], 0, 10)) . ')', array_slice($sent, 0, 3))),
            array_map(fn($s) => ['id' => (int)$s['id'], 'de' => 'À : ' . $to($s), 'objet' => $s['subject'], 'recu' => $s['at']], $sent)); }
    // 9. pas encore triés (IA absente ou en attente)
    $new = array_values(array_filter($msgs, fn($m) => $m['state'] === 'nouveau'));
    if (count($new) >= 5) $add('tri', 'info', count($new) . ' e-mails pas encore triés', pil_ai_ready() ? 'Le tri automatique les traite à chaque relève (15 à la fois).' : 'Sans l\'assistant IA, BatiPro ne peut pas lire et classer vos e-mails : Paramètres → Assistant IA (clé API Claude).', [], null, pil_ai_ready() ? 'new' : '#/settings/ai');

    $rank = ['haute' => 0, 'normale' => 1, 'info' => 2]; usort($out, fn($a, $b) => $rank[$a['level']] <=> $rank[$b['level']]);
    $todayN = count(array_filter($msgs, fn($m) => substr($m['at'], 0, 10) === $today));
    return ['conseils' => $out, 'stats' => ['recus_aujourdhui' => $todayN, 'ouverts' => count($open), 'urgents' => count($urg), 'attente' => count($wait), 'brouillons' => $drafts, 'non_lus' => count(array_filter($msgs, fn($m) => !$m['is_read']))],
        '_source' => 'E-mails relevés dans BatiPro (30 derniers jours), contacts, factures clients et achats de BatiPro (calculs PHP)'];
}

/** Conseil du jour (IA) : priorités, à déléguer, risques, ce qui peut attendre. Conservé pour la journée. */
function pil_mail_advice_ai(array $me, string $today): array {
    if (!pil_ai_ready()) throw new PilError('Assistant IA non configuré : Paramètres → Assistant IA (clé API Claude).', 400);
    $sig = pil_mail_signals($me, $today);
    $accs = implode(',', array_map('intval', q('SELECT id FROM pil_mail_accounts WHERE company_id = ? AND user_id = ?', [cid(), $me['id']])->fetchAll(PDO::FETCH_COLUMN)) ?: [0]);
    // données limitées : résumés et actions déjà extraits, pas les textes complets des e-mails
    $todo = array_map(function ($r) { $a = json_decode((string)$r['analysis'], true) ?: [];
        return ['id' => (int)$r['id'], 'recu' => $r['at'], 'de' => $r['from_name'] ?: $r['from_email'], 'objet' => $r['subject'], 'categorie' => $a['categorie'] ?? null, 'urgence' => $a['urgence'] ?? null,
            'resume' => $a['resume'] ?? mb_substr((string)$r['preview'], 0, 200), 'action' => $a['action'] ?? null, 'echeance' => $a['echeance'] ?? null, 'reponse_attendue' => !empty($a['reponse_necessaire']), 'chantier_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null]; },
        q("SELECT * FROM pil_mail_msgs WHERE company_id = ? AND account_id IN ($accs) AND folder = 'in' AND moved IS NULL AND state IN ('a_faire', 'nouveau') AND at >= ? ORDER BY at DESC LIMIT 40", [cid(), date('Y-m-d', strtotime("$today -30 days"))])->fetchAll());
    $data = ['date' => $today, 'utilisateur' => $me['name'], 'signaux' => $sig['conseils'], 'chiffres' => $sig['stats'], 'emails_ouverts' => $todo];
    if (pil_can($me, 'treasury.read')) { $l = pil_report_build_light($today); $data['finance'] = ['a_encaisser' => $l['B']['a_encaisser'], 'echu' => $l['B']['echu'], 'clients_a_relancer' => array_slice($l['B']['clients_a_relancer'], 0, 5)]; }
    foreach ($data['emails_ouverts'] as &$t) { $t['resume'] = pil_mail_mask((string)$t['resume']); $t['action'] = $t['action'] !== null ? pil_mail_mask((string)$t['action']) : null; } unset($t);
    $prompt = "Tu es le bras droit de la direction d'une entreprise de construction belge. Voici, en JSON, ce que BatiPro sait des e-mails de {$me['name']} aujourd'hui (signaux calculés, e-mails ouverts déjà résumés, et éventuellement la situation des factures clients ; montants en CENTIMES : 123456 = 1.234,56 €).\n"
        . "Rédige en français, de façon directe et concrète (pas de généralités), au plus 22 lignes :\n"
        . "1. **Aujourd'hui, dans cet ordre** : les 3 à 5 choses à faire, chacune avec la raison (argent en jeu, délai, client important, chantier bloqué) et l'e-mail concerné (#id).\n"
        . "2. **À déléguer** : ce qu'un collaborateur (secrétariat, chef de chantier, comptable) peut traiter, et quoi lui dire.\n"
        . "3. **Attention** : risques (paiement en retard, délai qui expire, client mécontent, facture non encodée) et comment les éviter.\n"
        . "4. **Peut attendre** : ce qui n'est pas prioritaire.\n"
        . "Règles : n'utilise QUE ces données ; n'invente ni montant, ni date, ni fait ; recopie les montants tels quels (format 1.234,56 €) ; si une information manque, dis-le. Tu ne peux rien envoyer ni exécuter : tu conseilles.\n\n" . json_encode($data, JSON_UNESCAPED_UNICODE);
    try {
        $client = new Anthropic\Client(apiKey: ai_key(), baseUrl: ai_base_url());
        $resp = $client->beta->messages->create(maxTokens: 2000, model: AI_MODEL, system: pil_ai_system(), messages: [['role' => 'user', 'content' => $prompt]],
            outputConfig: ['effort' => 'low'], fallbacks: 'default', betas: ['server-side-fallback-2026-07-01']);
    } catch (Throwable $e) { error_log('[pilotage mail conseil] ' . $e->getMessage()); throw new PilError('IA indisponible : ' . mb_substr($e->getMessage(), 0, 200), 502); }
    $txt = ''; foreach ($resp->content as $b) if ($b->type === 'text') $txt .= $b->text;
    $txt = trim($txt); if ($txt === '') throw new PilError('L\'IA n\'a pas répondu, réessayez.', 502);
    $res = ['date' => $today, 'at' => now(), 'texte' => $txt, 'verification' => pil_ai_verify($txt, $data)];
    set_setting('mail_advice_' . (int)$me['id'], $res);
    return $res;
}
