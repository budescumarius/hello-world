<?php
// Vente de BâtiPro aux autres firmes : formules, essai gratuit, abonnement mensuel ou annuel payé par Mollie
// (Bancontact, carte, domiciliation SEPA), blocage quand l'abonnement est expiré, factures d'abonnement.
// Les firmes créées avant l'activation des abonnements (et la firme du gestionnaire) restent « gratuites ».
declare(strict_types=1);

const SAAS_LEGAL_VERSION = '2026-10';

// ---------------------------------------------------------------- Réglages de la plateforme (firme 1)
function saas_cfg(): array {
    $c = setting('saas', [], 1) ?: [];
    return $c + [
        'enabled' => false, 'trialDays' => 14, 'graceDays' => 7, 'vatRate' => 21, 'mollieKey' => '',
        'plans' => [
            ['id' => 'solo', 'name' => 'Simplifié', 'edition' => 'simple', 'month' => 24, 'year' => 240, 'users' => 1, 'field' => 0, 'desc' => 'Devis, factures, achats, Peppol – pour indépendants'],
            ['id' => 'pro', 'name' => 'Avancé', 'edition' => 'avance', 'month' => 69, 'year' => 690, 'users' => 3, 'field' => 10, 'desc' => 'Tous les modules : chantiers, planning, équipes, états d\'avancement'],
            ['id' => 'team', 'name' => 'Avancé Équipe', 'edition' => 'avance', 'month' => 119, 'year' => 1190, 'users' => 10, 'field' => 50, 'desc' => 'Pour les entreprises avec plusieurs conducteurs et beaucoup d\'ouvriers'],
        ],
    ];
}
function saas_plan(?string $id): ?array {
    foreach (saas_cfg()['plans'] as $p) if (($p['id'] ?? '') === $id) return $p;
    return null;
}
// Tarifs publics (pour la page d'inscription et le choix de formule)
function saas_public(): array {
    $c = saas_cfg();
    return ['enabled' => (bool)$c['enabled'], 'trialDays' => (int)$c['trialDays'], 'vatRate' => (float)$c['vatRate'], 'legalVersion' => SAAS_LEGAL_VERSION,
        'plans' => array_map(fn($p) => array_intersect_key($p, array_flip(['id', 'name', 'edition', 'month', 'year', 'users', 'field', 'desc'])), $c['plans']),
        'seller' => (string)((setting('company', [], 1) ?: [])['name'] ?? '')];
}

// ---------------------------------------------------------------- État de l'abonnement d'une firme
function sub_get(int $cid): array { return setting('sub', [], $cid) ?: []; }
function sub_set(int $cid, array $s): void { set_setting('sub', $s, $cid); }
// Accès : free (sans abonnement), trial (essai), active, past_due (paiement raté, délai de grâce), canceled (résilié, jusqu'à la fin de la période)
function sub_state(int $cid): array {
    $s = sub_get($cid);
    $st = (string)($s['status'] ?? 'free');
    if ($st === 'free' || $cid === 1) return ['status' => 'free', 'locked' => false];
    $cfg = saas_cfg(); $today = date('Y-m-d');
    $until = $st === 'trial' ? (string)($s['trialUntil'] ?? '') : (string)($s['paidUntil'] ?? '');
    $grace = in_array($st, ['active', 'past_due'], true) ? (int)$cfg['graceDays'] : 0;
    $end = $until !== '' ? date('Y-m-d', strtotime("$until +$grace days")) : '';
    $locked = $until === '' || $end < $today;
    $plan = saas_plan($s['plan'] ?? null);
    return ['status' => $st, 'locked' => $locked, 'plan' => $s['plan'] ?? null, 'planName' => $plan['name'] ?? '', 'period' => $s['period'] ?? 'month',
        'until' => $until, 'daysLeft' => $until !== '' ? (int)floor((strtotime($until) - strtotime($today)) / 86400) : 0,
        'late' => $until !== '' && $until < $today, 'users' => (int)($plan['users'] ?? 0), 'field' => (int)($plan['field'] ?? 0),
        'hasSub' => !empty($s['subscriptionId']), 'deleteRequested' => $s['deleteRequested'] ?? null];
}
// Limites de la formule (0 = illimité) au moment de créer ou réactiver un accès
function sub_check_users(int $cid, string $role, int $exceptId = 0): void {
    $st = sub_state($cid);
    if ($st['status'] === 'free') return;
    $field = in_array($role, FIELD_ROLES, true);
    $max = $field ? $st['field'] : $st['users'];
    if ($max <= 0 && !$field) return;
    $n = (int)q('SELECT COUNT(*) FROM users WHERE company_id = ? AND active = 1 AND id <> ? AND role ' . ($field ? 'IN' : 'NOT IN') . " ('ouvrier', 'soustraitant')", [$cid, $exceptId])->fetchColumn();
    if ($n >= $max) fail(402, $field
        ? ($max ? "Votre formule « {$st['planName']} » permet $max accès terrain (ouvriers, sous-traitants). Passez à la formule supérieure dans « Mon abonnement »." : "Votre formule « {$st['planName']} » ne comprend pas l'espace terrain. Passez à la formule Avancé dans « Mon abonnement ».")
        : "Votre formule « {$st['planName']} » permet $max utilisateur(s) au bureau. Passez à la formule supérieure dans « Mon abonnement ».");
}
// Le prix d'une période (HTVA) et la TVA : autoliquidation pour un client assujetti d'un autre pays de l'UE
function sub_price(array $plan, string $period, int $cid): array {
    $ht = (float)($period === 'year' ? $plan['year'] : $plan['month']);
    $co = setting('company', [], $cid) ?: [];
    $vat = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($co['vat'] ?? '')));
    $reverse = $vat !== '' && substr($vat, 0, 2) !== 'BE' && preg_match('/^(AT|BG|CY|CZ|DE|DK|EE|EL|GR|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)/', $vat);
    $rate = $reverse ? 0.0 : (float)saas_cfg()['vatRate'];
    return ['ht' => round($ht, 2), 'rate' => $rate, 'vat' => round($ht * $rate / 100, 2), 'ttc' => round($ht * (1 + $rate / 100), 2), 'reverse' => (bool)$reverse];
}
function sub_admins(int $cid): array { return array_map('intval', q("SELECT id FROM users WHERE company_id = ? AND role = 'admin' AND active = 1", [$cid])->fetchAll(PDO::FETCH_COLUMN)); }
function sub_supers(): array { return array_map('intval', q('SELECT id FROM users WHERE super = 1 AND active = 1')->fetchAll(PDO::FETCH_COLUMN)); }
// Notification + e-mail aux administrateurs d'une firme (dans le contexte de cette firme)
function sub_notify(int $cid, string $title, string $body, string $href = '#/abonnement', bool $email = true): void {
    $prev = $GLOBALS['BP_CID'] ?? null; $GLOBALS['BP_CID'] = $cid;
    try { notify(sub_admins($cid), 'sub', $title, $body, $href, $email); } catch (Throwable $e) { error_log('[batipro abonnement] ' . $e->getMessage()); }
    finally { $GLOBALS['BP_CID'] = $prev; }
}
function sub_notify_supers(string $title, string $body, string $href = '#/platform'): void {
    $prev = $GLOBALS['BP_CID'] ?? null; $GLOBALS['BP_CID'] = 1;
    try { notify(sub_supers(), 'sub', $title, $body, $href, true); } catch (Throwable $e) { error_log('[batipro abonnement] ' . $e->getMessage()); }
    finally { $GLOBALS['BP_CID'] = $prev; }
}
function app_base_url(): string {
    $cfg = config();
    if (!empty($cfg['base_url'])) return rtrim((string)$cfg['base_url'], '/');
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
}

// ---------------------------------------------------------------- Mollie (API v2)
function mollie(string $method, string $path, ?array $body = null): array {
    if (test_mode()) throw new RuntimeException('Site de test : les paiements sont désactivés.');
    $key = trim((string)saas_cfg()['mollieKey']);
    if ($key === '') throw new RuntimeException('Paiement non configuré : clé Mollie manquante (Plateforme → Abonnements).');
    $base = defined('MOLLIE_URL') ? MOLLIE_URL : 'https://api.mollie.com/v2';
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_TIMEOUT => 25,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $key, 'Content-Type: application/json', 'Accept: application/json']]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) throw new RuntimeException('Mollie injoignable : ' . $err);
    $j = $raw === '' ? [] : (json_decode((string)$raw, true) ?: []);
    if ($code >= 400) throw new RuntimeException('Mollie : ' . ($j['detail'] ?? $j['title'] ?? "erreur $code"), $code);
    return $j;
}
function mollie_amount(float $v): array { return ['currency' => 'EUR', 'value' => number_format($v, 2, '.', '')]; }
function mollie_customer(int $cid): string {
    $s = sub_get($cid);
    if (!empty($s['customerId'])) return (string)$s['customerId'];
    $co = setting('company', [], $cid) ?: [];
    $admin = q("SELECT email FROM users WHERE company_id = ? AND role = 'admin' AND active = 1 ORDER BY id LIMIT 1", [$cid])->fetchColumn();
    $c = mollie('POST', '/customers', ['name' => (string)($co['name'] ?? 'Firme ' . $cid), 'email' => (string)$admin, 'metadata' => ['cid' => $cid]]);
    $s = sub_get($cid); $s['customerId'] = $c['id']; sub_set($cid, $s);
    return (string)$c['id'];
}
// Premier paiement : il crée le mandat (Bancontact, carte…) puis l'abonnement automatique
function sub_checkout(int $cid, string $planId, string $period): array {
    $plan = saas_plan($planId); if (!$plan) fail(400, 'Formule inconnue.');
    $period = $period === 'year' ? 'year' : 'month';
    $pr = sub_price($plan, $period, $cid);
    $co = setting('company', [], $cid) ?: [];
    $base = app_base_url();
    $p = mollie('POST', '/payments', [
        'amount' => mollie_amount($pr['ttc']), 'customerId' => mollie_customer($cid), 'sequenceType' => 'first',
        'description' => "BâtiPro {$plan['name']} – " . ($period === 'year' ? 'annuel' : 'mensuel') . ' – ' . ($co['name'] ?? ''),
        'redirectUrl' => $base . '/#/abonnement?retour=1', 'webhookUrl' => $base . '/api.php?r=mollie/webhook',
        'metadata' => ['cid' => $cid, 'plan' => $planId, 'period' => $period, 'kind' => 'first'],
    ]);
    $s = sub_get($cid); $s['pending'] = ['paymentId' => $p['id'], 'plan' => $planId, 'period' => $period, 'at' => now()]; sub_set($cid, $s);
    return ['checkoutUrl' => $p['_links']['checkout']['href'] ?? '', 'paymentId' => $p['id']];
}
// Traitement d'un paiement Mollie (webhook, ou vérification au retour sur la page Abonnement)
function sub_handle_payment(string $paymentId): string {
    $p = mollie('GET', '/payments/' . rawurlencode($paymentId));
    $meta = $p['metadata'] ?? [];
    $cid = (int)($meta['cid'] ?? 0);
    if (!$cid && !empty($p['subscriptionId'])) {
        foreach (q("SELECT company_id, v FROM settings WHERE k = 'sub'")->fetchAll() as $r) if ((string)((json_decode($r['v'], true) ?: [])['subscriptionId'] ?? '') === (string)$p['subscriptionId']) $cid = (int)$r['company_id'];
    }
    if (!$cid || !q('SELECT id FROM companies WHERE id = ?', [$cid])->fetch()) return 'unknown';
    $s = sub_get($cid);
    $done = (array)($s['payments'] ?? []);
    $status = (string)($p['status'] ?? '');
    $first = ($p['sequenceType'] ?? '') === 'first';
    if ($status === 'paid') {
        if (in_array($paymentId, $done, true)) return 'already';
        $planId = (string)($first ? ($meta['plan'] ?? $s['plan'] ?? '') : ($s['plan'] ?? $meta['plan'] ?? ''));
        $period = (string)($first ? ($meta['period'] ?? 'month') : ($s['period'] ?? $meta['period'] ?? 'month'));
        $plan = saas_plan($planId);
        if (!$plan) return 'unknown-plan';
        // la nouvelle période commence à la fin de celle déjà payée (ou aujourd'hui)
        $from = (string)($s['paidUntil'] ?? '') >= date('Y-m-d') ? (string)$s['paidUntil'] : date('Y-m-d');
        $until = date('Y-m-d', strtotime($from . ($period === 'year' ? ' +1 year' : ' +1 month')));
        $s = array_merge($s, ['status' => 'active', 'plan' => $planId, 'period' => $period, 'paidUntil' => $until]);
        unset($s['pending'], $s['failedAt']);
        $s['payments'] = array_slice(array_merge($done, [$paymentId]), -60);
        set_setting('edition', $plan['edition'], $cid);
        // premier paiement : abonnement automatique à partir de la fin de la période payée (remplace l'ancien)
        if ($first) {
            $pr = sub_price($plan, $period, $cid);
            if (!empty($s['subscriptionId']) && !empty($s['customerId'])) { try { mollie('DELETE', "/customers/{$s['customerId']}/subscriptions/{$s['subscriptionId']}"); } catch (Throwable $e) { /* déjà arrêté */ } }
            $sub = mollie('POST', "/customers/{$p['customerId']}/subscriptions", [
                'amount' => mollie_amount($pr['ttc']), 'interval' => $period === 'year' ? '12 months' : '1 month', 'startDate' => $until,
                'description' => "BâtiPro {$plan['name']} – " . ($period === 'year' ? 'annuel' : 'mensuel') . " – firme $cid", 'webhookUrl' => app_base_url() . '/api.php?r=mollie/webhook',
                'metadata' => ['cid' => $cid, 'plan' => $planId, 'period' => $period],
            ]);
            $s['subscriptionId'] = $sub['id']; $s['customerId'] = $p['customerId'];
            unset($s['cancelAt']);
        }
        sub_set($cid, $s);
        $inv = sub_invoice($cid, $plan, $period, $from, $until, (float)($p['amount']['value'] ?? 0), $paymentId, (string)($p['method'] ?? ''));
        $s = sub_get($cid); $s['invoices'] = array_slice(array_merge((array)($s['invoices'] ?? []), [$inv]), -120); sub_set($cid, $s);
        sub_notify($cid, 'Paiement reçu – merci !', "Abonnement {$plan['name']} payé jusqu'au " . date('d/m/Y', strtotime($until)) . ". Facture {$inv['number']} disponible dans « Mon abonnement ».");
        sub_notify_supers('Paiement reçu : ' . ((setting('company', [], $cid) ?: [])['name'] ?? "firme $cid"), number_format((float)($p['amount']['value'] ?? 0), 2, ',', ' ') . " € – {$plan['name']} (" . ($period === 'year' ? 'annuel' : 'mensuel') . ") – facture {$inv['number']}" . (preg_match('/^BE/i', preg_replace('/\s+/', '', (string)((setting('company', [], $cid) ?: [])['vat'] ?? ''))) ? ' à envoyer via Peppol (client belge assujetti)' : ''), '#/invoice/' . $inv['id']);
        return 'paid';
    }
    if (in_array($status, ['failed', 'canceled', 'expired'], true)) {
        if ($first) { if (($s['pending']['paymentId'] ?? '') === $paymentId) { unset($s['pending']); sub_set($cid, $s); } return 'first-' . $status; }
        if (empty($s['failedAt'])) {
            $s['status'] = 'past_due'; $s['failedAt'] = now(); sub_set($cid, $s);
            sub_notify($cid, 'Le paiement de votre abonnement a échoué', 'Mettez à jour votre moyen de paiement dans « Mon abonnement » pour garder l\'accès (délai de ' . (int)saas_cfg()['graceDays'] . ' jours).');
        }
        return 'failed';
    }
    return $status;
}
// Facture de l'abonnement, émise par la firme du gestionnaire (firme 1) : elle apparaît dans ses factures, déjà payée
function sub_invoice(int $cid, array $plan, string $period, string $from, string $until, float $paid, string $paymentId, string $method): array {
    $prev = $GLOBALS['BP_CID'] ?? null;
    $pr = sub_price($plan, $period, $cid);
    $co = setting('company', [], $cid) ?: [];
    $GLOBALS['BP_CID'] = 1;
    try {
        // le client (la firme abonnée) dans les contacts de la firme 1
        $contactId = 0;
        foreach (q("SELECT id, data FROM items WHERE company_id = 1 AND type = 'contact'")->fetchAll() as $r) if ((int)((json_decode($r['data'], true) ?: [])['saasCid'] ?? 0) === $cid) $contactId = (int)$r['id'];
        $cd = ['kind' => 'client', 'company' => (string)($co['name'] ?? "Firme $cid"), 'vat' => (string)($co['vat'] ?? ''), 'address' => (string)($co['street'] ?? ''), 'zip' => (string)($co['zip'] ?? ''), 'city' => (string)($co['city'] ?? ''),
            'country' => (string)($co['country'] ?? 'BE'), 'email' => (string)q("SELECT email FROM users WHERE company_id = ? AND role = 'admin' ORDER BY id LIMIT 1", [$cid])->fetchColumn(), 'saasCid' => $cid];
        if ($contactId) {
            $old = json_decode((string)q('SELECT data FROM items WHERE id = ?', [$contactId])->fetchColumn(), true) ?: [];
            q('UPDATE items SET data = ?, version = version + 1, updated_at = ? WHERE id = ?', [json_encode(array_merge($old, $cd), JSON_UNESCAPED_UNICODE), now(), $contactId]);
        } else { q('INSERT INTO items (company_id, type, data, version, created_at, updated_at) VALUES (1, ?, ?, 1, ?, ?)', ['contact', json_encode($cd, JSON_UNESCAPED_UNICODE), now(), now()]); $contactId = (int)db()->lastInsertId(); }
        db()->beginTransaction();
        $number = make_number('invoice');
        $label = "Abonnement BâtiPro {$plan['name']} – " . ($period === 'year' ? 'annuel' : 'mensuel') . ' – du ' . date('d/m/Y', strtotime($from)) . ' au ' . date('d/m/Y', strtotime("$until -1 day"));
        $data = ['kind' => 'facture', 'status' => 'emise', 'clientId' => $contactId, 'date' => date('Y-m-d'), 'due' => date('Y-m-d'), 'emittedAt' => date('Y-m-d'),
            'title' => 'Abonnement BâtiPro', 'reverse' => $pr['reverse'], 'defaultVat' => $pr['rate'], 'saasCid' => $cid, 'saasPayment' => $paymentId,
            'lines' => [['id' => 'l' . bin2hex(random_bytes(4)), 'kind' => 'item', 'desc' => $label, 'unit' => $period === 'year' ? 'an' : 'mois', 'qty' => 1, 'price' => $pr['ht'], 'vat' => $pr['rate']]],
            'payments' => [['date' => date('Y-m-d'), 'amount' => round($paid, 2), 'method' => 'Mollie' . ($method ? " ($method)" : ''), 'note' => $paymentId]],
            'notes' => $pr['reverse'] ? 'Autoliquidation – article 196 de la directive 2006/112/CE : TVA due par le preneur.' : ''];
        q('INSERT INTO items (company_id, type, number, data, version, created_at, updated_at) VALUES (1, ?, ?, ?, 1, ?, ?)', ['invoice', $number, json_encode($data, JSON_UNESCAPED_UNICODE), now(), now()]);
        $iid = (int)db()->lastInsertId();
        db()->commit();
        return ['id' => $iid, 'number' => $number, 'date' => date('Y-m-d'), 'ht' => $pr['ht'], 'ttc' => round($paid, 2), 'label' => $label];
    } finally { $GLOBALS['BP_CID'] = $prev; }
}
// Changer de formule pendant un abonnement actif : nouveau montant à la prochaine échéance, nouvelle formule tout de suite
function sub_change(int $cid, string $planId, string $period): array {
    $s = sub_get($cid); $plan = saas_plan($planId);
    if (!$plan) fail(400, 'Formule inconnue.');
    $period = $period === 'year' ? 'year' : 'month';
    if (empty($s['subscriptionId']) || ($s['status'] ?? '') !== 'active') return ['checkout' => sub_checkout($cid, $planId, $period)];
    // passage au paiement annuel : nouveau paiement (la période change), sinon simple mise à jour
    if ($period !== ($s['period'] ?? 'month')) return ['checkout' => sub_checkout($cid, $planId, $period)];
    $pr = sub_price($plan, $period, $cid);
    mollie('PATCH', "/customers/{$s['customerId']}/subscriptions/{$s['subscriptionId']}", ['amount' => mollie_amount($pr['ttc']),
        'description' => "BâtiPro {$plan['name']} – " . ($period === 'year' ? 'annuel' : 'mensuel') . " – firme $cid", 'metadata' => ['cid' => $cid, 'plan' => $planId, 'period' => $period]]);
    $s['plan'] = $planId; sub_set($cid, $s);
    set_setting('edition', $plan['edition'], $cid);
    return ['ok' => true];
}
function sub_cancel(int $cid, string $reason = ''): void {
    $s = sub_get($cid);
    if (!empty($s['subscriptionId']) && !empty($s['customerId'])) { try { mollie('DELETE', "/customers/{$s['customerId']}/subscriptions/{$s['subscriptionId']}"); } catch (Throwable $e) { error_log('[batipro abonnement] ' . $e->getMessage()); } }
    unset($s['subscriptionId']);
    if (in_array($s['status'] ?? '', ['active', 'past_due'], true)) $s['status'] = 'canceled';
    $s['cancelAt'] = now(); $s['cancelReason'] = mb_substr($reason, 0, 500);
    sub_set($cid, $s);
    sub_notify_supers('Abonnement résilié : ' . ((setting('company', [], $cid) ?: [])['name'] ?? "firme $cid"), $reason !== '' ? "Raison : $reason" : '');
}

// ---------------------------------------------------------------- Inscription d'une nouvelle firme (essai gratuit)
function saas_signup(array $b): int {
    $cfg = saas_cfg();
    if (!$cfg['enabled']) fail(403, 'Les inscriptions sont fermées pour le moment.');
    if (trim((string)($b['website'] ?? '')) !== '') fail(400, 'Requête refusée.'); // champ piège pour les robots
    $ip = client_ip(); $key = 'su:' . $ip;
    q('DELETE FROM logins WHERE at < ?', [date('Y-m-d H:i:s', time() - 86400)]);
    if ((int)q('SELECT COUNT(*) FROM logins WHERE ip = ?', [$key])->fetchColumn() >= 3) fail(429, 'Trop d\'inscriptions depuis cette connexion. Réessayez demain ou contactez-nous.');
    $name = trim((string)($b['company'] ?? '')); $email = mb_strtolower(trim((string)($b['email'] ?? ''))); $pw = (string)($b['password'] ?? '');
    $vat = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($b['vat'] ?? '')));
    $plan = saas_plan((string)($b['plan'] ?? '')) ?: $cfg['plans'][0];
    if (mb_strlen($name) < 2) fail(400, 'Nom de l\'entreprise manquant.');
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'E-mail invalide.');
    if (mb_strlen($pw) < 10) fail(400, 'Le mot de passe doit contenir au moins 10 caractères.');
    if (empty($b['accept'])) fail(400, 'Veuillez accepter les conditions générales et la politique de confidentialité.');
    if (q('SELECT id FROM users WHERE email = ?', [$email])->fetch()) fail(400, 'Un compte existe déjà avec cet e-mail : connectez-vous.');
    if ($vat !== '') foreach (q("SELECT company_id, v FROM settings WHERE k = 'company'")->fetchAll() as $r) {
        if (strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)((json_decode($r['v'], true) ?: [])['vat'] ?? ''))) === $vat) fail(400, 'Cette entreprise (n° de TVA) a déjà un compte : connectez-vous ou contactez-nous.');
    }
    q('INSERT INTO logins (ip, at) VALUES (?, ?)', [$key, now()]);
    $country = in_array($b['country'] ?? 'BE', ['BE', 'FR', 'LU', 'NL', 'DE'], true) ? (string)$b['country'] : 'BE';
    db()->beginTransaction();
    q('INSERT INTO companies (name, active, created_at) VALUES (?, 1, ?)', [$name, now()]);
    $cid = (int)db()->lastInsertId();
    set_setting('edition', $plan['edition'], $cid);
    set_setting('company', ['name' => $name, 'currency' => 'EUR', 'vatRates' => [21, 12, 6, 0], 'defaultVat' => 21, 'country' => $country, 'vat' => $vat,
        'street' => trim((string)($b['street'] ?? '')), 'zip' => trim((string)($b['zip'] ?? '')), 'city' => trim((string)($b['city'] ?? '')), 'email' => $email, 'phone' => trim((string)($b['phone'] ?? ''))], $cid);
    $until = date('Y-m-d', strtotime('+' . (int)$cfg['trialDays'] . ' days'));
    sub_set($cid, ['status' => 'trial', 'plan' => $plan['id'], 'period' => ($b['period'] ?? '') === 'year' ? 'year' : 'month', 'trialUntil' => $until,
        'terms' => ['version' => SAAS_LEGAL_VERSION, 'at' => now(), 'ip' => $ip, 'ua' => mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200)]]);
    q('INSERT INTO users (company_id, name, email, pass, role, color, created_at) VALUES (?,?,?,?,?,?,?)',
      [$cid, trim((string)($b['name'] ?? '')) ?: $email, $email, password_hash($pw, PASSWORD_DEFAULT), 'admin', '#3b5bdb', now()]);
    $uid = (int)db()->lastInsertId();
    db()->commit();
    $GLOBALS['BP_CID'] = $cid;
    log_activity($uid, 'create', 'company', $cid, null, "Inscription – essai {$plan['name']}");
    try {
        send_mail([['email' => $email, 'name' => (string)($b['name'] ?? '')]], [], 'Bienvenue sur BâtiPro',
            "Bonjour,\n\nVotre compte BâtiPro pour « $name » est prêt. Votre essai gratuit de la formule {$plan['name']} court jusqu'au " . date('d/m/Y', strtotime($until)) . ".\n\nAdresse de connexion : " . app_base_url() . "/\nIdentifiant : $email\n\nConseil sécurité : activez la validation en deux étapes (Mon profil).\n\nBonne découverte !\n", []);
    } catch (Throwable $e) { error_log('[batipro inscription] ' . $e->getMessage()); }
    sub_notify_supers("Nouvelle inscription : $name", "$email · essai {$plan['name']} jusqu'au " . date('d/m/Y', strtotime($until)));
    return $uid;
}

// ---------------------------------------------------------------- Rappels quotidiens (fin d'essai, accès bloqué)
function saas_daily(): void {
    if (!saas_cfg()['enabled']) return;
    $today = date('Y-m-d');
    foreach (q("SELECT company_id, v FROM settings WHERE k = 'sub'")->fetchAll() as $r) {
        $cid = (int)$r['company_id']; $s = json_decode($r['v'], true) ?: [];
        $st = $s['status'] ?? 'free'; $sent = (array)($s['reminded'] ?? []);
        $until = $st === 'trial' ? (string)($s['trialUntil'] ?? '') : (string)($s['paidUntil'] ?? '');
        if ($until === '' || $st === 'free') continue;
        $days = (int)floor((strtotime($until) - strtotime($today)) / 86400);
        $key = null; $title = ''; $body = '';
        if ($st === 'trial' && $days <= 3 && $days > 0 && !in_array("t3-$until", $sent, true)) { $key = "t3-$until"; $title = "Votre essai se termine dans $days jour(s)"; $body = 'Choisissez votre formule dans « Mon abonnement » pour continuer sans interruption. Vos données sont conservées.'; }
        elseif ($st === 'trial' && $days <= 0 && !in_array("te-$until", $sent, true)) { $key = "te-$until"; $title = 'Votre essai est terminé'; $body = 'Vos données sont conservées. Choisissez une formule dans « Mon abonnement » pour retrouver l\'accès.'; }
        elseif ($st === 'canceled' && $days <= 0 && !in_array("ce-$until", $sent, true)) { $key = "ce-$until"; $title = 'Votre abonnement est terminé'; $body = 'Vos données restent disponibles pendant 90 jours : réabonnez-vous ou exportez-les depuis « Mon abonnement ».'; }
        // 90 jours après la fin : rappel au gestionnaire de la plateforme de supprimer les données (pas de suppression automatique)
        if (!$key && in_array($st, ['trial', 'canceled', 'past_due'], true) && $days <= -90 && !in_array("purge-$until", $sent, true)) {
            $s['reminded'] = array_slice(array_merge($sent, ["purge-$until"]), -20); sub_set($cid, $s);
            sub_notify_supers('Données à supprimer : ' . ((setting('company', [], $cid) ?: [])['name'] ?? "firme $cid"), "L'essai ou l'abonnement a pris fin le " . date('d/m/Y', strtotime($until)) . ' (plus de 90 jours). Exportez si besoin puis supprimez la firme (Plateforme → corbeille), comme prévu par les conditions générales.');
            continue;
        }
        if (!$key) continue;
        $s['reminded'] = array_slice(array_merge($sent, [$key]), -20);
        sub_set($cid, $s);
        sub_notify($cid, $title, $body);
    }
}

// ---------------------------------------------------------------- Facture d'abonnement, lisible et imprimable par la firme cliente
function sub_invoice_html(int $iid): string {
    $r = q("SELECT * FROM items WHERE id = ? AND company_id = 1 AND type = 'invoice'", [$iid])->fetch();
    if (!$r) return 'Facture introuvable';
    $d = json_decode((string)$r['data'], true) ?: [];
    $s = setting('company', [], 1) ?: [];
    $c = json_decode((string)q("SELECT data FROM items WHERE id = ? AND company_id = 1", [(int)($d['clientId'] ?? 0)])->fetchColumn(), true) ?: [];
    $e = fn($x) => htmlspecialchars((string)$x, ENT_QUOTES, 'UTF-8');
    $m = fn($x) => number_format((float)$x, 2, ',', ' ') . ' €';
    $ht = 0.0; $vat = 0.0; $rows = '';
    foreach ((array)($d['lines'] ?? []) as $l) {
        if (($l['kind'] ?? '') !== 'item') continue;
        $t = round((float)$l['qty'] * (float)$l['price'], 2); $ht += $t; $vat += round($t * (float)($l['vat'] ?? 0) / 100, 2);
        $rows .= '<tr><td>' . $e($l['desc']) . '</td><td class="r">' . $e(rtrim(rtrim(number_format((float)$l['qty'], 2, ',', ''), '0'), ',')) . ' ' . $e($l['unit'] ?? '') . '</td><td class="r">' . $m($l['price']) . '</td><td class="r">' . (($d['reverse'] ?? false) ? '0 %' : $e((float)($l['vat'] ?? 0)) . ' %') . '</td><td class="r">' . $m($t) . '</td></tr>';
    }
    $paid = array_sum(array_map(fn($p) => (float)($p['amount'] ?? 0), (array)($d['payments'] ?? [])));
    $addr = fn($a) => $e(trim(($a['street'] ?? $a['address'] ?? '') . ', ' . trim(($a['zip'] ?? '') . ' ' . ($a['city'] ?? '')), ', '));
    $date = date('d/m/Y', strtotime((string)($d['date'] ?? 'now')));
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Facture ' . $e($r['number']) . '</title><style>
      body{font:14px/1.5 Helvetica,Arial,sans-serif;color:#1c2550;background:#eef0f6;margin:0;padding:24px}.doc{max-width:780px;margin:0 auto;background:#fff;padding:40px 46px;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.08)}
      h1{font-size:26px;margin:0 0 4px}.top{display:flex;justify-content:space-between;gap:24px;margin-bottom:28px}.muted{color:#6b7080}.box{background:#f4f5fa;border-radius:8px;padding:12px 14px}
      table{width:100%;border-collapse:collapse;margin:22px 0}th{background:#1c2550;color:#fff;text-align:left;padding:8px;font-size:12px}td{padding:9px 8px;border-bottom:1px solid #e3e5ee}.r{text-align:right;white-space:nowrap}
      .tot{margin-left:auto;width:300px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .big{font-size:18px;font-weight:bold;border-top:2px solid #1c2550;margin-top:6px;padding-top:8px}
      .paid{display:inline-block;margin-top:14px;padding:6px 12px;border-radius:8px;background:#e3f4e8;color:#2b8a3e;font-weight:bold}.foot{margin-top:30px;font-size:11.5px;color:#6b7080;border-top:1px solid #e3e5ee;padding-top:10px}
      .bar{max-width:780px;margin:0 auto 12px;text-align:right}button{font:inherit;padding:8px 16px;border-radius:8px;border:0;background:#1c2550;color:#fff;cursor:pointer}@media print{body{background:#fff;padding:0}.doc{box-shadow:none}.bar{display:none}}
    </style></head><body><div class="bar"><button onclick="print()">Imprimer / PDF</button></div><div class="doc">
      <div class="top"><div><h1>Facture</h1><div class="muted">N° <b>' . $e($r['number']) . '</b> · ' . $date . '</div></div>
        <div style="text-align:right"><b>' . $e($s['name'] ?? '') . '</b><br>' . $addr($s) . '<br>TVA ' . $e($s['vat'] ?? '') . (!empty($s['enterprise']) ? '<br>BCE ' . $e($s['enterprise']) : '') . '<br>' . $e($s['email'] ?? '') . '</div></div>
      <div class="box"><span class="muted">Facturé à</span><br><b>' . $e($c['company'] ?? '') . '</b><br>' . $addr($c) . (!empty($c['vat']) ? '<br>TVA ' . $e($c['vat']) : '') . '</div>
      <table><thead><tr><th>Description</th><th class="r">Qté</th><th class="r">Prix HTVA</th><th class="r">TVA</th><th class="r">Total HTVA</th></tr></thead><tbody>' . $rows . '</tbody></table>
      <div class="tot"><div><span>Total HTVA</span><b>' . $m($ht) . '</b></div><div><span>TVA</span><b>' . $m($vat) . '</b></div><div class="big"><span>Total TVAC</span><span>' . $m($ht + $vat) . '</span></div></div>
      ' . ($paid >= $ht + $vat - 0.01 ? '<div class="paid">Payée le ' . $date . ' – ' . $e($d['payments'][0]['method'] ?? 'Mollie') . '</div>' : '') . '
      ' . (!empty($d['notes']) ? '<p><b>' . $e($d['notes']) . '</b></p>' : '') . '
      <div class="foot">' . $e($s['name'] ?? '') . ' · ' . $addr($s) . ' · TVA ' . $e($s['vat'] ?? '') . (!empty($s['iban']) ? ' · IBAN ' . $e($s['iban']) : '') . '</div></div></body></html>';
}
