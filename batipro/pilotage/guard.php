<?php
// Étape 1 PILOTAGE – protection côté serveur de l'historique financier.
//
// 1. Facture / note de crédit VALIDÉE (status « emise », hors pro forma) : son contenu fiscal
//    (montants par taux de TVA, client, date, type, numéro, autoliquidation) ne change plus tant qu'elle reste validée.
//    Paiements, envois, Peppol, commentaires, liens vers la note de crédit… restent modifiables.
// 2. Rouvrir ou supprimer une facture validée (fonction existante « … quand même ») : administrateur uniquement,
//    après copie intégrale dans item_archive. Réglage « invoice_lock » = « strict » : interdit à tous (note de crédit).
// 3. Un chantier contenant des factures validées, des notes de crédit ou des factures d'achat ne se supprime plus.
//
// Appelé par api.php (route items) avant toute écriture. Chaque refus arrête la requête (fail()).
declare(strict_types=1);
require_once __DIR__ . '/finance.php';

const PIL_FISCAL_TYPES = ['invoice'];

function pil_is_validated_invoice(array $data): bool {
    return ($data['status'] ?? null) === 'emise' && ($data['kind'] ?? null) !== 'proforma';
}

/** Empreinte fiscale : ce qui ne doit plus bouger sur une facture validée. */
function pil_fiscal_fingerprint(array $data, ?string $number): array {
    $t = pil_doc_totals($data);
    return [
        'number' => (string)$number,
        'kind' => (string)($data['kind'] ?? ''),
        'clientId' => (string)($data['clientId'] ?? ''),
        'date' => (string)($data['date'] ?? ''),
        'reverse' => !empty($data['reverse']),
        'base' => $t['base'], 'vat' => $t['vat'], 'total' => $t['total'],
        'byRate' => array_map(fn($v) => [$v['rate'], $v['base'], $v['vat']], $t['vats']),
        'items' => count(array_filter($data['lines'] ?? [], fn($l) => is_array($l) && ($l['kind'] ?? null) === 'item' && empty($l['option']))),
    ];
}

function pil_is_admin(array $me): bool { return ($me['role'] ?? '') === 'admin' || !empty($me['super']); }

function pil_invoice_lock(): string { return setting('invoice_lock', 'admin') === 'strict' ? 'strict' : 'admin'; }

/** Copie intégrale d'un élément avant une opération irréversible (journal en ajout seul côté application). */
function pil_archive(array $me, array $row, string $action, ?string $reason = null): void {
    static $ready = false;
    if (!$ready) {
        db()->exec('CREATE TABLE IF NOT EXISTS item_archive (id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, item_id INT NOT NULL, type VARCHAR(32) NOT NULL,
            number VARCHAR(40) NULL, project_id INT NULL, action VARCHAR(20) NOT NULL, reason VARCHAR(255) NULL, row_json LONGTEXT NOT NULL, sha256 CHAR(64) NOT NULL,
            user_id INT NULL, created_at DATETIME NOT NULL, KEY company_item (company_id, item_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        $ready = true;
    }
    $json = json_encode($row, JSON_UNESCAPED_UNICODE);
    q('INSERT INTO item_archive (company_id, item_id, type, number, project_id, action, reason, row_json, sha256, user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [cid(), (int)$row['id'], (string)$row['type'], $row['number'], $row['project_id'], $action, $reason, $json, hash('sha256', $json), $me['id'] ?? null, now()]);
}

/** Avant PUT items/{type}/{id}. $b = corps de la requête (data, project_id, number…). */
function pil_guard_update(array $me, string $type, array $cur, array $b): void {
    if (!in_array($type, PIL_FISCAL_TYPES, true)) return;
    $was = json_decode((string)$cur['data'], true) ?: [];
    if (!pil_is_validated_invoice($was)) return;
    $new = array_key_exists('data', $b) && is_array($b['data']) ? $b['data'] : $was;
    $newNumber = array_key_exists('number', $b) ? (string)$b['number'] : (string)$cur['number'];
    $label = (($was['kind'] ?? '') === 'avoir' ? 'note de crédit' : 'facture') . ' ' . ($cur['number'] ? "n° {$cur['number']}" : "sans numéro (fiche {$cur['id']})");

    if (!pil_is_validated_invoice($new)) {
        // réouverture (retour en brouillon) d'une facture validée
        if (pil_invoice_lock() === 'strict') fail(403, "La $label est validée : elle ne peut plus être rouverte. Corrigez-la avec une note de crédit.");
        if (!pil_is_admin($me)) fail(403, "Seul un administrateur peut rouvrir la $label validée. La correction conseillée est une note de crédit.");
        pil_archive($me, $cur, 'reopen');
        log_activity($me['id'], 'reopen', $type, (int)$cur['id'], $cur['project_id'] !== null ? (int)$cur['project_id'] : null, "Facture validée rouverte : {$cur['number']}");
        return;
    }
    // première attribution d'un numéro (facture reprise d'un autre logiciel : créée validée, puis numérotée avec son n° d'origine) : autorisée
    $curNumber = (string)($cur['number'] ?? '');
    if (pil_fiscal_fingerprint($was, $curNumber === '' ? $newNumber : $curNumber) !== pil_fiscal_fingerprint($new, $newNumber)) {
        fail(403, "La $label est validée : montants, TVA, client, date et numéro ne sont plus modifiables. Corrigez-la avec une note de crédit.");
    }
}

/** Avant DELETE items/{type}/{id}. */
function pil_guard_delete(array $me, string $type, array $cur): void {
    $data = json_decode((string)$cur['data'], true) ?: [];
    if ($type === 'invoice' && pil_is_validated_invoice($data)) {
        $label = (($data['kind'] ?? '') === 'avoir' ? 'note de crédit' : 'facture') . ' n° ' . ($cur['number'] ?: $cur['id']);
        if (pil_invoice_lock() === 'strict') fail(403, "La $label est validée : elle ne peut pas être supprimée. Annulez-la avec une note de crédit.");
        if (!pil_is_admin($me)) fail(403, "Seul un administrateur peut supprimer la $label validée. La correction conseillée est une note de crédit.");
        pil_archive($me, $cur, 'delete');
        return;
    }
    if ($type === 'project') {
        $rows = q("SELECT type, data FROM items WHERE company_id = ? AND project_id = ? AND type IN ('invoice', 'expense')", [cid(), (int)$cur['id']])->fetchAll();
        $inv = 0; $exp = 0;
        foreach ($rows as $r) {
            $d = json_decode((string)$r['data'], true) ?: [];
            if ($r['type'] === 'invoice' && pil_is_validated_invoice($d)) $inv++;
            if ($r['type'] === 'expense') $exp++;
        }
        if ($inv || $exp) {
            $what = implode(' et ', array_filter([$inv ? "$inv facture(s) validée(s)" : '', $exp ? "$exp facture(s) d'achat" : '']));
            fail(403, "Ce chantier contient $what : il ne peut pas être supprimé (historique comptable). Passez-le au statut « Terminé » ou « Annulé ».");
        }
    }
}
