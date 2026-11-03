<?php
// Faux serveur de l'API Claude (Messages) pour les tests : aucune donnée ne sort de l'instance de test.
// Lancé dans le conteneur de test : php -S 127.0.0.1:9090 claude_mock.php ; réglage BâtiPro « ai.baseUrl » = http://127.0.0.1:9090
// Comportement :
//  - avec des outils et sans résultat d'outil : demande l'outil adapté à la question ;
//  - après les résultats : répond en citant le PREMIER montant trouvé dans le résultat (doit être vérifié comme exact) ;
//  - question contenant « INVENTE » : cite un montant absent des données (doit être signalé) ;
//  - sans outils (commentaire du rapport) : cite le solde total du rapport.
$raw = (string)file_get_contents('php://input'); $req = json_decode($raw, true) ?: [];
// journal : outils proposés et présence éventuelle d'un IBAN complet dans la requête (ne doit pas arriver pour le rapport)
file_put_contents(sys_get_temp_dir() . '/claude_mock.log', json_encode(['path' => $_SERVER['REQUEST_URI'], 'tools' => array_column($req['tools'] ?? [], 'name'), 'n' => count($req['messages'] ?? []), 'iban' => (bool)preg_match('/BE\d{14}/', $raw)]) . "\n", FILE_APPEND);
$fmt = fn(int $c) => ($c < 0 ? '-' : '') . number_format(abs($c) / 100, 2, ',', '.');
$msgs = $req['messages'] ?? [];
$last = end($msgs);
$text = function ($c) { if (is_string($c)) return $c; $t = ''; foreach ((array)$c as $b) if (($b['type'] ?? '') === 'text') $t .= $b['text']; return $t; };
$firstQ = $text($msgs[count($msgs) - 1]['content'] ?? '');
foreach ($msgs as $m) if ($m['role'] === 'user' && is_string($m['content'])) $firstQ = $m['content'];
$hasResult = is_array($last['content'] ?? null) && ($last['content'][0]['type'] ?? '') === 'tool_result';
$reply = function (array $content, string $stop) {
    header('Content-Type: application/json');
    echo json_encode(['id' => 'msg_mock_' . bin2hex(random_bytes(4)), 'type' => 'message', 'role' => 'assistant', 'model' => 'claude-opus-5-5', 'content' => $content,
        'stop_reason' => $stop, 'stop_sequence' => null, 'usage' => ['input_tokens' => 10, 'output_tokens' => 10]]);
    exit;
};
// tri des e-mails (outil forcé classer_emails) : une analyse par « #id » ; journal : IBAN en clair ? PDF joint ?
if (in_array('classer_emails', array_column($req['tools'] ?? [], 'name'), true)) {
    $all = ''; $pdf = false; foreach ((array)($last['content'] ?? []) as $b) { if (($b['type'] ?? '') === 'text') $all .= $b['text'] . "\n"; if (($b['type'] ?? '') === 'document') $pdf = true; }
    file_put_contents(sys_get_temp_dir() . '/claude_mock.log', json_encode(['mail' => true, 'iban_clair' => (bool)preg_match('/BE68\s?5390\s?0754\s?7034/', $all), 'pdf' => $pdf, 'cite' => str_contains($all, 'Ancien message cité')]) . "\n", FILE_APPEND);
    preg_match_all('/\n#(\d+) · reçu le [^·]+· de : [^<]*<([^>]*)> · objet : ([^\n]*)/u', $all, $mm, PREG_SET_ORDER);
    $out = [];
    foreach ($mm as $x) {
        $pub = str_contains($x[2], 'promo') || str_contains($x[2], 'newsletter');
        $out[] = ['id' => (int)$x[1], 'categorie' => $pub ? 'publicite' : 'client', 'urgence' => $pub ? 'basse' : 'haute', 'resume' => $pub ? 'Publicité.' : 'Le client demande le devis cuisine avant vendredi.',
            'action_requise' => !$pub, 'action' => $pub ? '' : 'Envoyer le devis cuisine Dupont avant vendredi', 'echeance' => '', 'chantier_id' => 0, 'pieces' => $pub ? '' : 'Devis PDF fictif (1.250,00 €)',
            'reponse_necessaire' => !$pub, 'brouillon' => $pub ? '' : "Bonjour,\nMerci pour votre message. Nous vous envoyons le devis avant vendredi (acompte de 1.250,00 €, total estimé 9.999,00 €).\nCordialement"];
    }
    $reply([['type' => 'tool_use', 'id' => 'toolu_mock_mail', 'name' => 'classer_emails', 'input' => ['emails' => $out]]], 'tool_use');
}
if (!empty($req['tools']) && !$hasResult) {
    if (preg_match('/PROPOSE.*facture (\d+)/', $firstQ, $mm)) $reply([['type' => 'tool_use', 'id' => 'toolu_mock_p', 'name' => 'proposer_action', 'input' => ['type' => 'relance_client', 'facture_id' => (int)$mm[1], 'justification' => 'Facture en retard de paiement']]], 'tool_use');
    $tool = str_contains(mb_strtolower($firstQ), 'sous-traitant') ? ['totaux_achats', ['type_fournisseur' => 'soustraitant', 'du' => '2026-01-01', 'au' => '2026-12-31']]
        : (str_contains(mb_strtolower($firstQ), 'chantier') ? ['chantiers', []] : ['tresorerie', []]);
    $reply([['type' => 'tool_use', 'id' => 'toolu_mock_1', 'name' => $tool[0], 'input' => (object)$tool[1]]], 'tool_use');
}
if ($hasResult) {
    $res = json_decode((string)$last['content'][0]['content'], true) ?: [];
    $amount = null;
    array_walk_recursive($res, function ($v, $k) use (&$amount) { if ($amount === null && is_int($v) && abs($v) >= 100 && in_array($k, ['total', 'total_ttc', 'end', 'contract'], true)) $amount = $v; });
    $a = str_contains($firstQ, 'INVENTE') ? 99999999 : ($amount ?? 0);
    $reply([['type' => 'text', 'text' => "Selon les données de BâtiPro (source : " . ($res['_source'] ?? '?') . ', ' . ($res['_periode'] ?? '?') . "), le montant est de {$fmt($a)} €."]], 'end_turn');
}
// commentaire du rapport quotidien
preg_match('/\{.*\}/s', $firstQ, $m); $rep = json_decode($m[0] ?? '{}', true) ?: [];
$reply([['type' => 'text', 'text' => 'Commentaire de direction : trésorerie consolidée de ' . $fmt((int)($rep['A']['total'] ?? 0)) . ' € selon les derniers extraits.']], 'end_turn');
