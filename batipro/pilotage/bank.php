<?php
// PILOTAGE MADIBU – étape 2 : extraits bancaires importés à la main (aucune connexion bancaire, aucun paiement possible).
// Tables propres au module (préfixe pil_, une colonne company_id partout), créées à la première utilisation.
// Montants : centimes entiers (BIGINT) – jamais de flottants pour l'argent de la banque.
// Données brutes de la banque gardées telles quelles ; les corrections de l'utilisateur sont à part (catégorie, nom, note) et historisées.
declare(strict_types=1);
require_once __DIR__ . '/bank_parse.php';
require_once __DIR__ . '/finance.php';
require_once __DIR__ . '/security.php';

// Catégories : [libellé, sens] – sens 'in' entrée, 'out' sortie, 'int' neutre (transfert entre nos comptes : ni recette ni dépense)
const PIL_CATS = [
    'encaissement_client' => ['Encaissement client', 'in'],
    'autre_entree' => ['Autre entrée', 'in'],
    'sous_traitance' => ['Sous-traitance', 'out'],
    'materiaux' => ['Matériaux et fournitures', 'out'],
    'fournisseur' => ['Fournisseur (autre)', 'out'],
    'salaires' => ['Salaires et rémunérations', 'out'],
    'social' => ['Secrétariat social / ONSS', 'out'],
    'impots' => ['Impôts et TVA', 'out'],
    'credit' => ['Crédit / emprunt', 'out'],
    'leasing' => ['Leasing et véhicules', 'out'],
    'assurances' => ['Assurances', 'out'],
    'carburant' => ['Carburant, parking, mobilité', 'out'],
    'telecom' => ['Télécom, logiciels, abonnements', 'out'],
    'frais_bancaires' => ['Frais bancaires', 'out'],
    'loyer' => ['Loyer et charges', 'out'],
    'autre_sortie' => ['Autre dépense', 'out'],
    'transfert_interne' => ['Transfert interne', 'int'],
    'a_classer' => ['À classer', ''],
];
// Règles par mots-clés (texte de l'opération, en majuscules sans accents). Première règle trouvée = proposition, toujours « à vérifier ».
const PIL_RULES = [
    ['frais_bancaires', '/\b(FRAIS DE DOSSIER|FRAIS D.OPERATIONS|FRAIS DE GESTION|COTISATION MENSUELLE|FRAIS DE PORT|REDEVANCE|TARIF|FLEX PRO|ADVICE PRO|BANK CARD COMPANY)\b/'],
    ['credit', '/\b(STRAIGHT LOAN|REMBOURSEMENT CREDIT|CREDIT \d{3}-|PRET|LENING|AFLOSSING)\b/'],
    ['leasing', '/\b(LEASE|LEASING|AUTOLEASE|LEASEPLAN|ATHLON|ARVAL|ALPHABET)/'],
    ['social', '/\b(LIANTIS|ONSS|RSZ|PARTENA|SECUREX|ACERTA|GROUP S|SD WORX|SECRETARIAT SOCIAL|CAISSE D.ASSURANCES SOCIALES)\b/'],
    ['impots', '/\b(SPF FINANCES|FOD FINANCIEN|TVA|BTW|PRECOMPTE|IMPOT|BELASTING|COMMUNE|GEMEENTE)\b/'],
    ['assurances', '/\b(ASSURANCE|INSURANCE|ETHIAS|AXA|AG INSURANCE|BALOISE|P&V|VERZEKERING|FEDERALE)\b/'],
    ['carburant', '/\b(TOTAL|Q8|SHELL|ESSO|LUKOIL|DATS|TEXACO|PARKING|PARK BRU|ARRIVE|SNCB|NMBS|STIB|MOBILITY)\b/'],
    ['telecom', '/\b(PROXIMUS|ORANGE|TELENET|BASE|VOO|SCARLET|MICROSOFT|GOOGLE|APPLE\.COM)\b/'],
    ['salaires', '/\b(SALAIRE|REMUNERATION|LOON|WEDDE|ACOMPTE SALAIRE|PECULE)\b/'],
    ['materiaux', '/\b(FACQ|CEBEO|BRICO|GAMMA|HUBO|IKEA|BIGMAT|LAMBERT|ELECTRO DEPOT|LOXAM|SAINT-GOBAIN|VANDEMOORTELE|POINT P|TOOLSTATION|WURTH|WÜRTH)\b/'],
    ['loyer', '/\b(LOYER|HUUR|SYNDIC|CHARGES LOCATIVES)\b/'],
];

function pil_bank_schema(): void {
    static $done = false;
    if ($done) return;
    $done = true;
    if (q("SHOW TABLES LIKE 'pil_bank_tx'")->fetch()) {
        if (!q("SHOW COLUMNS FROM pil_bank_tx LIKE 'match_paid'")->fetch()) db()->exec('ALTER TABLE pil_bank_tx ADD match_paid TINYINT NOT NULL DEFAULT 0 AFTER match_at');
        if (!q("SHOW INDEX FROM pil_bank_tx WHERE Key_name = 'company_cat_date'")->fetch()) db()->exec('ALTER TABLE pil_bank_tx ADD KEY company_cat_date (company_id, category, booking_date), ADD KEY company_match (company_id, match_type, match_id), ADD KEY company_cp (company_id, cp_iban)');
        return;
    }
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_bank_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, bank VARCHAR(60) NOT NULL, iban VARCHAR(34) NOT NULL, label VARCHAR(120) NOT NULL DEFAULT '',
        currency CHAR(3) NOT NULL DEFAULT 'EUR', active TINYINT NOT NULL DEFAULT 1, created_by INT NULL, created_at DATETIME NOT NULL,
        UNIQUE KEY company_iban (company_id, iban)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_bank_imports (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, account_id INT NOT NULL, filename VARCHAR(190) NOT NULL, sha256 CHAR(64) NOT NULL,
        format VARCHAR(10) NOT NULL, stored VARCHAR(255) NOT NULL DEFAULT '', size INT NOT NULL DEFAULT 0, statement_no INT NULL, statement_year INT NULL,
        period_from DATE NULL, period_to DATE NULL, opening BIGINT NULL, closing BIGINT NULL, tx_count INT NOT NULL DEFAULT 0, tx_new INT NOT NULL DEFAULT 0, tx_dup INT NOT NULL DEFAULT 0,
        warnings TEXT NULL, status VARCHAR(12) NOT NULL DEFAULT 'importe', created_by INT NULL, created_at DATETIME NOT NULL, cancelled_by INT NULL, cancelled_at DATETIME NULL,
        KEY company_account (company_id, account_id), KEY company_sha (company_id, sha256)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_bank_tx (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, account_id INT NOT NULL, import_id INT NOT NULL, seq INT NULL,
        booking_date DATE NOT NULL, value_date DATE NULL, amount BIGINT NOT NULL, cp_name VARCHAR(190) NOT NULL DEFAULT '', cp_iban VARCHAR(34) NOT NULL DEFAULT '',
        communication TEXT NULL, structured VARCHAR(24) NULL, bank_ref VARCHAR(40) NOT NULL DEFAULT '', type_code VARCHAR(10) NOT NULL DEFAULT '', raw TEXT NULL, fp CHAR(64) NOT NULL,
        category VARCHAR(30) NOT NULL DEFAULT 'a_classer', cat_source VARCHAR(16) NOT NULL DEFAULT 'auto', status VARCHAR(12) NOT NULL DEFAULT 'a_verifier',
        transfer_account_id INT NULL, transfer_tx_id INT NULL, match_type VARCHAR(12) NULL, match_id INT NULL, match_by INT NULL, match_at DATETIME NULL, match_paid TINYINT NOT NULL DEFAULT 0,
        name_fix VARCHAR(190) NULL, note VARCHAR(255) NULL, history TEXT NULL, updated_by INT NULL, updated_at DATETIME NULL,
        KEY company_account_date (company_id, account_id, booking_date), KEY company_fp (company_id, fp), KEY company_import (company_id, import_id),
        KEY company_cat_date (company_id, category, booking_date), KEY company_match (company_id, match_type, match_id), KEY company_cp (company_id, cp_iban)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS pil_bank_rules (
        id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, cp_key VARCHAR(190) NOT NULL, category VARCHAR(30) NOT NULL, created_by INT NULL, updated_at DATETIME NOT NULL,
        UNIQUE KEY company_key (company_id, cp_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/** Refus métier (message pour l'utilisateur, code HTTP) – exception pour pouvoir traiter un lot sans tout interrompre. */
class PilError extends RuntimeException {}

function pil_enabled(): bool { $s = setting('pilotage', []); return is_array($s) && !empty($s['enabled']); }

/** Accès au module : administrateur de la firme (ou super-administrateur), module activé pour cette firme. */
function pil_require(?string $perm = null): array {
    $me = require_user();
    if (!pil_enabled()) fail(403, 'Le module Pilotage n\'est pas activé pour cette entreprise.');
    pil_bank_schema(); pil_security_schema();
    if ($perm) pil_need($me, $perm);
    return $me;
}

function pil_upper(string $s): string {
    $s = mb_strtoupper($s, 'UTF-8');
    return strtr($s, ['À' => 'A', 'Â' => 'A', 'Ä' => 'A', 'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Î' => 'I', 'Ï' => 'I', 'Ô' => 'O', 'Ö' => 'O', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ç' => 'C', '’' => "'"]);
}

function pil_accounts(): array {
    $r = q('SELECT * FROM pil_bank_accounts WHERE company_id = ? ORDER BY id', [cid()])->fetchAll();
    foreach ($r as &$a) { $a['id'] = (int)$a['id']; $a['active'] = (int)$a['active']; }
    return $r;
}

// ------------------------------------------------------------------ Empreinte (doublons)
// Même compte + même date comptable + même montant + rang parmi les opérations identiques de l'extrait.
// Indépendante du format (CODA ou PDF de la même période donnent la même empreinte) : un mouvement n'est jamais compté deux fois.
function pil_fingerprints(int $accountId, array $txs): array {
    $seen = []; $out = [];
    foreach ($txs as $i => $t) {
        $k = $t['date'] . '|' . $t['amount'];
        $n = $seen[$k] = ($seen[$k] ?? -1) + 1;
        $out[$i] = hash('sha256', "$accountId|$k|$n");
    }
    return $out;
}

// ------------------------------------------------------------------ Classification proposée (toujours « à vérifier »)
function pil_classify(array $t, array $ownIbans, array $contactsByIban, array $learned): array {
    $iban = $t['counterparty_iban'] ?? '';
    if ($iban !== '' && isset($ownIbans[$iban])) return ['transfert_interne', 'compte', $ownIbans[$iban]];
    $lk = pil_learn_key($iban, (string)($t['counterparty_name'] ?? ''));
    if ($lk !== '' && isset($learned[$lk])) return [$learned[$lk], 'appris', null];
    $txt = pil_upper(($t['counterparty_name'] ?? '') . ' ' . ($t['communication'] ?? '') . ' ' . ($t['raw'] ?? ''));
    foreach (PIL_RULES as [$cat, $re]) if (preg_match($re, $txt)) return [$cat, 'mot-cle', null];
    if ($iban !== '' && isset($contactsByIban[$iban])) {
        $k = $contactsByIban[$iban]['kind'];
        if ($k === 'client' && $t['amount'] > 0) return ['encaissement_client', 'contact', null];
        if ($k === 'soustraitant') return ['sous_traitance', 'contact', null];
        if ($k === 'fournisseur') return ['fournisseur', 'contact', null];
    }
    if ($t['amount'] > 0 && !empty($t['structured'])) return ['encaissement_client', 'communication', null];
    return ['a_classer', 'auto', null];
}

/** Contacts BatiPro (clients, fournisseurs, sous-traitants) indexés par IBAN. */
function pil_contacts_by_iban(): array {
    $out = [];
    foreach (q("SELECT id, data FROM items WHERE company_id = ? AND type = 'contact'", [cid()])->fetchAll() as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $ib = pil_norm_iban((string)($d['iban'] ?? ''));
        if ($ib !== '' && !isset($out[$ib])) $out[$ib] = ['id' => (int)$r['id'], 'kind' => (string)($d['kind'] ?? ''), 'name' => (string)($d['company'] ?? '') ?: trim(($d['firstname'] ?? '') . ' ' . ($d['name'] ?? ''))];
    }
    return $out;
}
function pil_learned(): array {
    $o = [];
    foreach (q('SELECT cp_key, category FROM pil_bank_rules WHERE company_id = ?', [cid()])->fetchAll() as $r) $o[$r['cp_key']] = $r['category'];
    return $o;
}
/** Clé d'apprentissage : l'IBAN de la contrepartie, sinon son nom (paiement par carte, domiciliation sans IBAN). */
function pil_learn_key(string $iban, string $name): string {
    if ($iban !== '') return $iban;
    $n = trim(preg_replace('/\s+/', ' ', pil_upper($name)));
    return $n === '' ? '' : 'NOM:' . mb_substr($n, 0, 180);
}

// ------------------------------------------------------------------ Analyse d'un extrait (aperçu, rien n'est enregistré)
/**
 * @param array $file ['name', 'bytes' (contenu brut), 'layout' (mise en page PDF ou null)]
 * @return array aperçu : relevés, contrôles bloquants (errors) et avertissements, opérations avec doublons et classement proposé
 */
function pil_analyse(array $file, ?int $forceAccount = null): array {
    $sha = hash('sha256', $file['bytes']);
    $isPdf = str_starts_with($file['bytes'], '%PDF');
    $accounts = pil_accounts();
    $table = $file['table'] ?? null; $fmt = $isPdf ? 'pdf' : 'coda';
    if ($table) { // tableur : compte imposé ; CSV relu par le serveur, Excel lu par le navigateur (fichier original conservé)
        $acc = $forceAccount ? (array_column($accounts, null, 'id')[$forceAccount] ?? null) : null;
        if (!$acc) return ['sha256' => $sha, 'format' => 'tableur', 'errors' => ['Choisissez le compte bancaire concerné (un tableur ne contient pas toujours l\'IBAN).'], 'warnings' => [], 'statements' => []];
        $isXlsx = str_starts_with($file['bytes'], "PK\x03\x04") || str_starts_with($file['bytes'], "\xD0\xCF\x11\xE0");
        $fmt = $isXlsx ? 'xlsx' : 'csv';
        if (!$isXlsx) $table['rows'] = pil_csv_rows($file['bytes']);
        $meta = (array)($table['meta'] ?? []);
        if ((!isset($meta['opening']) || $meta['opening'] === '' || $meta['opening'] === null)) { // solde de départ = solde final de l'extrait précédent
            $prev = q("SELECT closing FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_to DESC, id DESC LIMIT 1", [cid(), $acc['id']])->fetchColumn();
            if ($prev !== false) $meta['opening'] = (int)$prev;
        }
        $table['meta'] = ['iban' => $acc['iban'], 'bank' => $acc['bank'], 'format' => $fmt] + $meta;
        $sts = pil_parse_table($table);
        if ($sts[0]['opening'] === null && !$sts[0]['errors']) $sts[0]['errors'][] = 'Solde de départ inconnu : indiquez-le (premier import de ce compte).';
    } else {
        try {
            $sts = pil_parse_statement($file['name'], $isPdf ? null : $file['bytes'], $isPdf ? $file['layout'] : null);
        } catch (RuntimeException $e) { return ['sha256' => $sha, 'errors' => [$e->getMessage()], 'statements' => []]; }
        if ($isPdf && !$file['layout']) return ['sha256' => $sha, 'errors' => ['PDF reçu sans sa mise en page : rechargez la page et réessayez.'], 'statements' => []];
    }
    $byIban = array_column($accounts, null, 'iban');
    $own = array_column($accounts, 'id', 'iban');
    $contacts = pil_contacts_by_iban(); $learned = pil_learned();
    $already = q("SELECT id, filename, created_at FROM pil_bank_imports WHERE company_id = ? AND sha256 = ? AND status = 'importe'", [cid(), $sha])->fetch();
    $res = ['sha256' => $sha, 'format' => $fmt, 'errors' => [], 'warnings' => [], 'statements' => []];
    if ($already) $res['errors'][] = "Ce fichier a déjà été importé le " . date('d/m/Y H:i', strtotime($already['created_at'])) . " (« {$already['filename']} »).";
    if (count($sts) > 1) $res['warnings'][] = count($sts) . ' extraits dans ce fichier.';
    foreach ($sts as $s) {
        $errs = $s['errors'] ?? []; $warn = $s['warnings'];
        $acc = $byIban[$s['iban']] ?? null;
        if ($forceAccount && (!$acc || $acc['id'] !== $forceAccount)) $errs[] = "L'extrait concerne le compte {$s['iban']}, pas le compte choisi.";
        if (!$acc) $errs[] = "Compte {$s['iban']} inconnu : ajoutez-le d'abord dans « Comptes bancaires ».";
        if (!$s['iban']) $errs[] = 'Numéro de compte (IBAN) introuvable dans l\'extrait.';
        if ($s['opening'] === null || $s['opening']['amount'] === null) $errs[] = 'Solde initial introuvable.';
        if ($s['closing'] === null || $s['closing']['amount'] === null) $errs[] = 'Solde final introuvable.';
        $txs = $s['transactions'];
        foreach ($txs as $t) if ($t['amount'] === null || !$t['date']) $errs[] = "Opération n° {$t['seq']} : " . ($t['amount'] === null ? 'montant illisible' : 'date illisible') . '.';
        $sum = array_sum(array_map(fn($t) => (int)$t['amount'], $txs));
        $check = null;
        if ($s['opening'] && $s['closing'] && $s['opening']['amount'] !== null && $s['closing']['amount'] !== null) {
            $check = $s['opening']['amount'] + $sum - $s['closing']['amount'];
            if ($check !== 0) $errs[] = sprintf('Contrôle des soldes : solde initial %s + mouvements %s ≠ solde final %s (écart %s). Lecture incomplète : rien ne sera importé.',
                pil_fmt($s['opening']['amount']), pil_fmt($sum), pil_fmt($s['closing']['amount']), pil_fmt($check));
        }
        $from = $s['opening']['date'] ?? null; $to = $s['closing']['date'] ?? null;
        foreach ($txs as $t) if ($t['date'] && $from && $to && ($t['date'] < $from || $t['date'] > $to)) { $warn[] = "Opération n° {$t['seq']} datée du " . pil_d($t['date']) . ' en dehors de la période de l\'extrait.'; }
        $continuity = null; $dups = []; $out = [];
        if ($acc) {
            $continuity = pil_continuity($acc['id'], $s);
            if ($continuity['message']) $warn[] = $continuity['message'];
            $fps = pil_fingerprints($acc['id'], array_map(fn($t) => ['date' => $t['date'], 'amount' => $t['amount']], $txs));
            $exist = [];
            if ($fps) {
                $in = implode(',', array_fill(0, count($fps), '?'));
                foreach (q("SELECT fp, id FROM pil_bank_tx WHERE company_id = ? AND fp IN ($in)", array_merge([cid()], array_values($fps)))->fetchAll() as $r) $exist[$r['fp']] = (int)$r['id'];
            }
            foreach ($txs as $i => $t) {
                [$cat, $why, $other] = pil_classify($t, $own, $contacts, $learned);
                if ($cat === 'transfert_interne' && $other === $acc['id']) [$cat, $why, $other] = ['a_classer', 'auto', null];
                $out[] = $t + ['fp' => $fps[$i], 'duplicate' => $exist[$fps[$i]] ?? null, 'category' => $cat, 'cat_source' => $why, 'transfer_account_id' => $other];
                if (isset($exist[$fps[$i]])) $dups[] = $i;
            }
            if ($dups && count($dups) === count($txs)) $errs[] = 'Toutes les opérations de cet extrait sont déjà enregistrées (extrait déjà importé, peut-être sous un autre format).';
            elseif ($dups) $warn[] = count($dups) . ' opération(s) déjà enregistrée(s) (période qui chevauche un import précédent) : elles seront ignorées.';
            $ov = q("SELECT id, filename, period_from, period_to FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' AND period_from < ? AND period_to > ?", [cid(), $acc['id'], $to ?? '9999-12-31', $from ?? '0000-01-01'])->fetchAll();
            foreach ($ov as $o) $warn[] = 'Période qui chevauche l\'import « ' . $o['filename'] . ' » (' . pil_d($o['period_from']) . ' – ' . pil_d($o['period_to']) . ').';
        } else $out = $txs;
        $in = array_sum(array_map(fn($t) => max(0, (int)$t['amount']), $txs)); $outS = array_sum(array_map(fn($t) => min(0, (int)$t['amount']), $txs));
        $res['statements'][] = ['bank' => $s['bank'], 'iban' => $s['iban'], 'account' => $acc ? ['id' => $acc['id'], 'label' => $acc['label'], 'bank' => $acc['bank']] : null,
            'currency' => $s['currency'], 'number' => $s['number'], 'year' => $s['year'] ?? ($to ? (int)substr($to, 0, 4) : null), 'opening' => $s['opening'], 'closing' => $s['closing'],
            'credits' => $in, 'debits' => $outS, 'balance_gap' => $check, 'continuity' => $continuity, 'errors' => $errs, 'warnings' => array_values(array_unique($warn)),
            'duplicates' => count($dups), 'transactions' => $out];
        foreach ($errs as $e) $res['errors'][] = ($s['iban'] ? $s['iban'] . ' : ' : '') . $e;
    }
    if (!$sts) $res['errors'][] = 'Aucun extrait trouvé dans ce fichier.';
    return $res;
}

/** Continuité avec l'extrait précédent du même compte : solde, date, numéro. */
function pil_continuity(int $accountId, array $s): array {
    $from = $s['opening']['date'] ?? null;
    $prev = $from ? q("SELECT * FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' AND period_to <= ? ORDER BY period_to DESC, id DESC LIMIT 1", [cid(), $accountId, $from])->fetch() : null;
    $next = $from ? q("SELECT * FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' AND period_from >= ? ORDER BY period_from, id LIMIT 1", [cid(), $accountId, $s['closing']['date'] ?? $from])->fetch() : null;
    $r = ['previous' => null, 'next' => null, 'ok' => true, 'message' => ''];
    $msgs = [];
    if ($prev) {
        $r['previous'] = ['id' => (int)$prev['id'], 'to' => $prev['period_to'], 'closing' => (int)$prev['closing'], 'number' => $prev['statement_no'] !== null ? (int)$prev['statement_no'] : null];
        if ((int)$prev['closing'] !== ($s['opening']['amount'] ?? null)) { $r['ok'] = false; $msgs[] = sprintf('Solde de départ %s différent du solde final de l\'extrait précédent (%s au %s) : un extrait manque probablement entre les deux.', pil_fmt((int)$s['opening']['amount']), pil_fmt((int)$prev['closing']), pil_d($prev['period_to'])); }
        elseif ($prev['statement_no'] !== null && $s['number'] !== null && (int)$prev['statement_year'] === (int)($s['year'] ?? substr((string)$s['closing']['date'], 0, 4)) && (int)$s['number'] !== (int)$prev['statement_no'] + 1) $msgs[] = 'Numérotation : extrait n° ' . $s['number'] . ' après le n° ' . $prev['statement_no'] . ' (soldes cohérents).';
    }
    if ($next) {
        $r['next'] = ['id' => (int)$next['id'], 'from' => $next['period_from'], 'opening' => (int)$next['opening']];
        if ((int)$next['opening'] !== ($s['closing']['amount'] ?? null)) { $r['ok'] = false; $msgs[] = sprintf('Solde final %s différent du solde de départ de l\'extrait suivant déjà importé (%s au %s).', pil_fmt((int)$s['closing']['amount']), pil_fmt((int)$next['opening']), pil_d($next['period_from'])); }
    }
    $r['message'] = implode(' ', $msgs);
    return $r;
}

function pil_fmt(int $cents): string { return ($cents < 0 ? '-' : '') . number_format(abs($cents) / 100, 2, ',', '.') . ' €'; }
function pil_d(?string $d): string { return $d ? date('d/m/Y', strtotime($d)) : '?'; }

// ------------------------------------------------------------------ Enregistrement de l'import (après confirmation)
function pil_store_original(string $sha, string $ext, string $bytes): string {
    $dir = dirname(__DIR__) . '/uploads/pilotage/' . cid();
    if (!is_dir($dir) && !mkdir($dir, 0750, true) && !is_dir($dir)) throw new RuntimeException('Impossible de créer le dossier des extraits.');
    if (!is_file("$dir/.htaccess")) file_put_contents("$dir/.htaccess", "Require all denied\nDeny from all\n");
    $rel = 'pilotage/' . cid() . "/$sha.$ext";
    if (!is_file(dirname(__DIR__) . "/uploads/$rel") && file_put_contents(dirname(__DIR__) . "/uploads/$rel", $bytes) === false) throw new RuntimeException('Impossible d\'enregistrer l\'extrait original.');
    return $rel;
}

function pil_import(array $file, array $me, ?int $forceAccount = null): array {
    $an = pil_analyse($file, $forceAccount);
    if ($an['errors']) return ['ok' => false] + $an;
    $ext = ['pdf' => 'pdf', 'csv' => 'csv', 'xlsx' => (str_starts_with($file['bytes'], 'PK') ? 'xlsx' : 'xls')][$an['format']] ?? 'cod';
    $stored = pil_store_original($an['sha256'], $ext, $file['bytes']);
    $pdo = db(); $ids = [];
    $pdo->beginTransaction();
    try {
        foreach ($an['statements'] as $s) {
            $new = array_values(array_filter($s['transactions'], fn($t) => !$t['duplicate']));
            q('INSERT INTO pil_bank_imports (company_id, account_id, filename, sha256, format, stored, size, statement_no, statement_year, period_from, period_to, opening, closing, tx_count, tx_new, tx_dup, warnings, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [cid(), $s['account']['id'], mb_substr($file['name'], 0, 190), $an['sha256'], $an['format'], $stored, strlen($file['bytes']), $s['number'], $s['year'], $s['opening']['date'], $s['closing']['date'],
                 $s['opening']['amount'], $s['closing']['amount'], count($s['transactions']), count($new), $s['duplicates'], json_encode($s['warnings'], JSON_UNESCAPED_UNICODE), 'importe', $me['id'], now()]);
            $iid = (int)$pdo->lastInsertId(); $ids[] = $iid;
            // insertion par lots de 200 lignes (gros extraits : moins d'allers-retours avec MySQL)
            $cols = '(company_id, account_id, import_id, seq, booking_date, value_date, amount, cp_name, cp_iban, communication, structured, bank_ref, type_code, raw, fp, category, cat_source, status, transfer_account_id)';
            foreach (array_chunk($new, 200) as $chunk) {
                $vals = []; $args = [];
                foreach ($chunk as $t) { $vals[] = '(' . implode(',', array_fill(0, 19, '?')) . ')';
                    array_push($args, cid(), $s['account']['id'], $iid, $t['seq'], $t['date'], $t['value_date'] ?: null, $t['amount'], mb_substr((string)$t['counterparty_name'], 0, 190), (string)$t['counterparty_iban'],
                        (string)$t['communication'], $t['structured'], mb_substr((string)$t['bank_ref'], 0, 40), (string)$t['type_code'], (string)$t['raw'], $t['fp'], $t['category'], $t['cat_source'], 'a_verifier', $t['transfer_account_id']); }
                q("INSERT INTO pil_bank_tx $cols VALUES " . implode(',', $vals), $args);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
    pil_pair_transfers();
    log_activity($me['id'], 'create', 'bank_import', $ids[0] ?? null, null, 'Import extrait ' . $file['name']);
    foreach ($an['statements'] as $k => $s) pil_audit('import_bancaire', 'bank_import', $ids[$k] ?? null, null, ['fichier' => $file['name'], 'sha256' => $an['sha256'], 'format' => $an['format'], 'compte' => $s['iban'],
        'periode' => [$s['opening']['date'], $s['closing']['date']], 'soldes' => [$s['opening']['amount'], $s['closing']['amount']], 'mouvements' => count($s['transactions']), 'doublons_ignores' => $s['duplicates']]);
    return ['ok' => true, 'imports' => $ids] + $an;
}

/** Transferts internes : relie chaque sortie vers un de nos comptes à l'entrée correspondante (même montant, ± 5 jours). */
function pil_pair_transfers(): int {
    $n = 0;
    $open = q("SELECT id, account_id, transfer_account_id, booking_date, amount FROM pil_bank_tx WHERE company_id = ? AND category = 'transfert_interne' AND transfer_tx_id IS NULL AND transfer_account_id IS NOT NULL", [cid()])->fetchAll();
    foreach ($open as $t) {
        $m = q("SELECT id FROM pil_bank_tx WHERE company_id = ? AND account_id = ? AND amount = ? AND transfer_tx_id IS NULL AND ABS(DATEDIFF(booking_date, ?)) <= 5 ORDER BY ABS(DATEDIFF(booking_date, ?)), id LIMIT 1",
            [cid(), (int)$t['transfer_account_id'], -(int)$t['amount'], $t['booking_date'], $t['booking_date']])->fetch();
        if (!$m) continue;
        q('UPDATE pil_bank_tx SET transfer_tx_id = ? WHERE id = ? AND company_id = ?', [(int)$m['id'], (int)$t['id'], cid()]);
        q("UPDATE pil_bank_tx SET transfer_tx_id = ?, transfer_account_id = ?, category = 'transfert_interne', cat_source = IF(cat_source = 'manuel', cat_source, 'compte') WHERE id = ? AND company_id = ?", [(int)$t['id'], (int)$t['account_id'], (int)$m['id'], cid()]);
        $n++;
    }
    return $n;
}

/** Annulation d'un import : ses mouvements sont retirés, le journal et le fichier original sont gardés. */
function pil_cancel_import(int $id, array $me): void {
    $imp = q("SELECT * FROM pil_bank_imports WHERE id = ? AND company_id = ? AND status = 'importe'", [$id, cid()])->fetch();
    if (!$imp) fail(404, 'Import introuvable ou déjà annulé.');
    $pdo = db(); $pdo->beginTransaction();
    try {
        // paiements écrits dans les factures / achats par ces mouvements : retirés eux aussi
        foreach (q('SELECT * FROM pil_bank_tx WHERE company_id = ? AND import_id = ? AND match_paid = 1', [cid(), $id])->fetchAll() as $t) pil_payment_remove((string)$t['match_type'], (int)$t['match_id'], $t, $me);
        $ids = array_map('intval', q('SELECT id FROM pil_bank_tx WHERE company_id = ? AND import_id = ?', [cid(), $id])->fetchAll(PDO::FETCH_COLUMN));
        if ($ids) {
            $in = implode(',', $ids);
            q("UPDATE pil_bank_tx SET transfer_tx_id = NULL WHERE company_id = ? AND transfer_tx_id IN ($in)", [cid()]);
            q("DELETE FROM pil_bank_tx WHERE company_id = ? AND import_id = ?", [cid(), $id]);
        }
        q("UPDATE pil_bank_imports SET status = 'annule', cancelled_by = ?, cancelled_at = ? WHERE id = ? AND company_id = ?", [$me['id'], now(), $id, cid()]);
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
    log_activity($me['id'], 'delete', 'bank_import', $id, null, 'Annulation import ' . $imp['filename']);
    pil_audit('import_annule', 'bank_import', $id, ['status' => 'importe', 'fichier' => $imp['filename'], 'mouvements' => count($ids)], ['status' => 'annule']);
}

// ------------------------------------------------------------------ Mouvements : lecture et corrections
function pil_tx_out(array $r): array {
    foreach (['id', 'account_id', 'import_id', 'seq', 'amount', 'transfer_account_id', 'transfer_tx_id', 'match_id', 'match_by', 'updated_by', 'match_paid'] as $k) if (isset($r[$k])) $r[$k] = (int)$r[$k];
    $r['history'] = $r['history'] ? json_decode($r['history'], true) : [];
    unset($r['company_id'], $r['fp']);
    return $r;
}

function pil_tx_list(array $f): array {
    $w = ['company_id = ?']; $a = [cid()];
    if (!empty($f['account'])) { $w[] = 'account_id = ?'; $a[] = (int)$f['account']; }
    if (!empty($f['from'])) { $w[] = 'booking_date >= ?'; $a[] = (string)$f['from']; }
    if (!empty($f['to'])) { $w[] = 'booking_date <= ?'; $a[] = (string)$f['to']; }
    if (!empty($f['status'])) { $w[] = 'status = ?'; $a[] = (string)$f['status']; }
    if (!empty($f['category'])) { $w[] = 'category = ?'; $a[] = (string)$f['category']; }
    if (!empty($f['import'])) { $w[] = 'import_id = ?'; $a[] = (int)$f['import']; }
    $rows = q('SELECT * FROM pil_bank_tx WHERE ' . implode(' AND ', $w) . ' ORDER BY booking_date DESC, account_id, seq DESC, id DESC LIMIT 5000', $a)->fetchAll();
    return array_map('pil_tx_out', $rows);
}

/** Correction par l'utilisateur : catégorie, nom affiché, note, statut. Le brut de la banque n'est jamais modifié. */
function pil_tx_update(int $id, array $b, array $me): array {
    // un rapprochement peut écrire un paiement dans la facture ou l'achat : tout ou rien
    if (array_key_exists('match', $b) && !db()->inTransaction()) {
        db()->beginTransaction();
        try { $r = pil_tx_update($id, $b, $me); db()->commit(); return $r; }
        catch (Throwable $e) { db()->rollBack(); throw $e; }
    }
    $t = q('SELECT * FROM pil_bank_tx WHERE id = ? AND company_id = ? FOR UPDATE', [$id, cid()])->fetch();
    if (!$t) throw new PilError('Mouvement introuvable', 404);
    $hist = $t['history'] ? (json_decode($t['history'], true) ?: []) : [];
    $set = []; $args = [];
    $chg = function (string $col, $val) use (&$set, &$args, &$hist, $t, $me) {
        if ((string)$t[$col] === (string)$val) return;
        $set[] = "$col = ?"; $args[] = $val;
        $hist[] = ['at' => now(), 'by' => $me['id'], 'field' => $col, 'from' => $t[$col], 'to' => $val];
    };
    if (array_key_exists('category', $b)) {
        $c = (string)$b['category'];
        if (!isset(PIL_CATS[$c])) throw new PilError('Catégorie inconnue', 400);
        if ($c === 'transfert_interne' && !$t['transfer_account_id'] && !$t['transfer_tx_id']) throw new PilError('Transfert interne : la contrepartie doit être un de vos comptes bancaires.', 400);
        $chg('category', $c);
        if ($t['cat_source'] !== 'manuel') $set[] = "cat_source = 'manuel'"; // catégorie choisie ou confirmée par l'utilisateur
        // apprentissage : même IBAN (ou même nom, sans IBAN) → même catégorie proposée aux prochains imports
        $lk = pil_learn_key((string)$t['cp_iban'], (string)$t['cp_name']);
        if (!empty($b['learn']) && $lk !== '' && $c !== 'transfert_interne' && $c !== 'a_classer')
            q('INSERT INTO pil_bank_rules (company_id, cp_key, category, created_by, updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE category = VALUES(category), created_by = VALUES(created_by), updated_at = VALUES(updated_at)', [cid(), $lk, $c, $me['id'], now()]);
    }
    if (array_key_exists('name_fix', $b)) $chg('name_fix', ($v = trim((string)$b['name_fix'])) === '' ? null : mb_substr($v, 0, 190));
    if (array_key_exists('note', $b)) $chg('note', ($v = trim((string)$b['note'])) === '' ? null : mb_substr($v, 0, 255));
    if (array_key_exists('status', $b)) {
        if (!in_array($b['status'], ['a_verifier', 'valide'], true)) throw new PilError('Statut inconnu', 400);
        $cat = $b['category'] ?? $t['category'];
        if ($b['status'] === 'valide' && $cat === 'a_classer') throw new PilError('Choisissez une catégorie avant de valider ce mouvement.', 400);
        $chg('status', $b['status']);
    }
    if (array_key_exists('match', $b)) {
        $m = $b['match'];
        // ancien rapprochement qui avait ajouté un paiement : ce paiement est retiré du document
        if ($t['match_id'] && (int)$t['match_paid']) { pil_payment_remove((string)$t['match_type'], (int)$t['match_id'], $t, $me); $set[] = 'match_paid = 0'; $hist[] = ['at' => now(), 'by' => $me['id'], 'field' => 'paiement', 'from' => 'enregistré', 'to' => 'retiré']; }
        if ($m === null) { $chg('match_type', null); $chg('match_id', null); $set[] = 'match_by = NULL'; $set[] = 'match_at = NULL'; }
        else {
            $type = (string)($m['type'] ?? ''); $mid = (int)($m['id'] ?? 0);
            if (!in_array($type, ['invoice', 'expense'], true) || !$mid) throw new PilError('Rapprochement invalide', 400);
            if (!q('SELECT id FROM items WHERE id = ? AND company_id = ? AND type = ?', [$mid, cid(), $type])->fetch()) throw new PilError('Document introuvable', 404);
            if (($type === 'invoice') !== ((int)$t['amount'] > 0)) throw new PilError($type === 'invoice' ? 'Une facture se rapproche d\'une entrée d\'argent.' : 'Un achat se rapproche d\'une sortie d\'argent.', 400);
            $chg('match_type', $type); $chg('match_id', $mid); $set[] = 'match_by = ?'; $args[] = $me['id']; $set[] = 'match_at = ?'; $args[] = now();
            if (!empty($m['pay'])) {
                $r = pil_payment_add($type, $mid, $t, $me);
                if ($r === 'ajoute') { $set[] = 'match_paid = 1'; $hist[] = ['at' => now(), 'by' => $me['id'], 'field' => 'paiement', 'from' => null, 'to' => 'enregistré dans ' . ($type === 'invoice' ? 'la facture' : 'l\'achat')]; }
            }
        }
    }
    if ($set) {
        $set[] = 'history = ?'; $args[] = json_encode($hist, JSON_UNESCAPED_UNICODE);
        $set[] = 'updated_by = ?'; $args[] = $me['id']; $set[] = 'updated_at = ?'; $args[] = now();
        $args[] = $id; $args[] = cid();
        q('UPDATE pil_bank_tx SET ' . implode(', ', $set) . ' WHERE id = ? AND company_id = ?', $args);
        $changes = array_slice($hist, count(json_decode((string)($t['history'] ?? '[]'), true) ?: []));
        if ($changes) pil_audit(array_key_exists('match', $b) ? 'rapprochement' : (array_intersect(array_column($changes, 'field'), ['category']) ? 'classification' : 'correction_mouvement'), 'bank_tx', $id,
            array_combine(array_column($changes, 'field'), array_column($changes, 'from')), array_combine(array_column($changes, 'field'), array_column($changes, 'to')));
    }
    return pil_tx_out(q('SELECT * FROM pil_bank_tx WHERE id = ? AND company_id = ?', [$id, cid()])->fetch());
}

// ------------------------------------------------------------------ Paiement écrit dans la facture / l'achat (après confirmation)
/** Total, déjà payé et reste d'un document BatiPro, en centimes (mêmes règles que invState / purchState). */
function pil_doc_due(string $type, array $d): array {
    if ($type === 'invoice') {
        $total = (int)round(pil_doc_totals($d)['total'] * 100);
        $paid = (int)round(array_sum(array_map(fn($p) => pil_num($p['amount'] ?? 0), (array)($d['payments'] ?? []))) * 100);
    } else {
        $total = (int)round(pil_purch_ttc($d) * 100);
        $paid = is_array($d['payments'] ?? null) && $d['payments'] ? (int)round(array_sum(array_map(fn($p) => pil_num($p['amount'] ?? 0), $d['payments'])) * 100) : (!empty($d['paid']) ? $total : 0);
    }
    return ['total' => $total, 'paid' => $paid, 'rest' => $total - $paid];
}
/** Paiement déjà présent (saisi à la main) : même montant, ± 7 jours. */
function pil_payment_existing(array $d, array $t): ?array {
    foreach ((array)($d['payments'] ?? []) as $p) {
        if (!empty($p['bankTx'])) continue;
        if ((int)round(pil_num($p['amount'] ?? 0) * 100) === abs((int)$t['amount']) && !empty($p['date']) && abs(strtotime((string)$p['date']) - strtotime((string)$t['booking_date'])) <= 7 * 86400) return $p;
    }
    return null;
}
function pil_doc_save(string $type, array $row, array $d, array $me, string $label): void {
    q('UPDATE items SET data = ?, lite = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        [json_encode($d, JSON_UNESCAPED_UNICODE), lite_json($type, $d), $me['id'], now(), (int)$row['id'], cid()]);
    log_activity($me['id'], 'update', $type, (int)$row['id'], $row['project_id'] !== null ? (int)$row['project_id'] : null, $label);
    pil_audit('paiement_document', $type, (int)$row['id'], ['paiements' => (json_decode((string)$row['data'], true) ?: [])['payments'] ?? []], ['paiements' => $d['payments'] ?? [], 'libelle' => $label]);
}
/** = purchSyncPaid() de purchase.js : « paid » / « paidDate » recalculés. */
function pil_purch_sync(array &$d): void {
    $full = !empty($d['payments']) && abs(pil_doc_due('expense', ['paid' => false] + $d)['rest']) < 1;
    $d['paid'] = $full; $dates = array_column($d['payments'], 'date'); sort($dates);
    $d['paidDate'] = $full ? end($dates) : null;
}
/**
 * Ajoute le paiement du mouvement bancaire au document. Renvoie 'ajoute', 'deja' (déjà enregistré) ou lève une PilError.
 * Le montant est celui de la banque ; il ne peut pas dépasser le reste à payer.
 */
function pil_payment_add(string $type, int $mid, array $t, array $me): string {
    $row = q('SELECT * FROM items WHERE id = ? AND company_id = ? AND type = ? FOR UPDATE', [$mid, cid(), $type])->fetch();
    $d = json_decode((string)$row['data'], true) ?: [];
    foreach ((array)($d['payments'] ?? []) as $p) if ((int)($p['bankTx'] ?? 0) === (int)$t['id']) return 'deja';
    if (pil_payment_existing($d, $t)) return 'deja';
    if ($type === 'invoice') {
        if (($d['status'] ?? '') !== 'emise' || in_array($d['kind'] ?? '', ['proforma', 'avoir'], true)) throw new PilError('Seule une facture validée peut recevoir un paiement.', 400);
    } else {
        if (!empty($d['refused'])) throw new PilError('Cet achat est refusé : aucun paiement possible.', 400);
        if (($d['status'] ?? '') === 'avalider' || !empty($d['toCheck'])) throw new PilError('Validez d\'abord la facture d\'achat dans BâtiPro, puis rapprochez-la.', 400);
        // ancien achat marqué « payé » sans détail : la tranche est reconstituée (comme purchPayment)
        if (!empty($d['paid']) && empty($d['payments'])) $d['payments'] = [['date' => $d['paidDate'] ?? $t['booking_date'], 'amount' => pil_purch_ttc($d), 'method' => 'Virement']];
    }
    $due = pil_doc_due($type, $d); $amt = abs((int)$t['amount']);
    if ($amt > $due['rest']) throw new PilError(sprintf('Le montant du mouvement (%s) dépasse le reste à payer (%s). Rapprochez sans enregistrer le paiement, ou corrigez le document.', pil_fmt($amt), pil_fmt($due['rest'])), 400);
    $acc = q('SELECT bank FROM pil_bank_accounts WHERE id = ? AND company_id = ?', [(int)$t['account_id'], cid()])->fetch();
    $d['payments'] = array_values((array)($d['payments'] ?? []));
    $d['payments'][] = ['date' => $t['booking_date'], 'amount' => $amt / 100, 'method' => 'Virement',
        'note' => 'Extrait ' . ($acc['bank'] ?? 'banque') . ($t['seq'] !== null ? ' – opération n° ' . $t['seq'] : ''), 'bankTx' => (int)$t['id']];
    if ($type === 'expense') {
        pil_purch_sync($d);
        $d['history'][] = ['t' => gmdate('Y-m-d\TH:i:s.v\Z'), 'uid' => $me['id'], 'txt' => 'Paiement de ' . pil_fmt($amt) . ' (extrait bancaire) le ' . pil_d($t['booking_date'])];
    }
    pil_doc_save($type, $row, $d, $me, 'Paiement ' . pil_fmt($amt) . ' (rapprochement bancaire)');
    return 'ajoute';
}
/** Retire le paiement ajouté par un rapprochement (et seulement celui-là). */
function pil_payment_remove(string $type, int $mid, array $t, array $me): void {
    $row = q('SELECT * FROM items WHERE id = ? AND company_id = ? AND type = ? FOR UPDATE', [$mid, cid(), $type])->fetch();
    if (!$row) return;
    $d = json_decode((string)$row['data'], true) ?: [];
    $before = count((array)($d['payments'] ?? []));
    $d['payments'] = array_values(array_filter((array)($d['payments'] ?? []), fn($p) => (int)($p['bankTx'] ?? 0) !== (int)$t['id']));
    if (count($d['payments']) === $before) return;
    if ($type === 'expense') { pil_purch_sync($d); $d['history'][] = ['t' => gmdate('Y-m-d\TH:i:s.v\Z'), 'uid' => $me['id'], 'txt' => 'Paiement de ' . pil_fmt(abs((int)$t['amount'])) . ' retiré (rapprochement bancaire annulé)']; }
    pil_doc_save($type, $row, $d, $me, 'Paiement retiré (rapprochement bancaire annulé)');
}

// ------------------------------------------------------------------ Rapprochement avec les factures et achats de BatiPro (propositions)
/** Propositions pour un mouvement : communication structurée identique (sûr), sinon même montant + même IBAN/contact (probable). Rien n'est écrit dans BatiPro. */
function pil_match_suggestions(array $t): array {
    $amt = (int)$t['amount']; $out = [];
    $comm = $t['structured'] ? preg_replace('/\D/', '', $t['structured']) : '';
    static $cache = []; // une seule lecture des documents par requête (rapprochement de nombreux mouvements)
    $contacts = $cache['contacts'] ??= pil_contacts_by_iban();
    $cpContact = $t['cp_iban'] !== '' ? ($contacts[$t['cp_iban']]['id'] ?? null) : null;
    $type = $amt > 0 ? 'invoice' : 'expense';
    $cache[$type] ??= q('SELECT id, project_id, number, data FROM items WHERE company_id = ? AND type = ?', [cid(), $type])->fetchAll();
    foreach ($cache[$type] as $r) {
        $d = json_decode($r['data'], true) ?: [];
        if ($type === 'invoice') {
            if (($d['status'] ?? '') !== 'emise' || ($d['kind'] ?? '') === 'proforma' || ($d['kind'] ?? '') === 'avoir') continue;
            $total = (int)round(pil_doc_totals($d)['total'] * 100);
            $paid = (int)round(array_sum(array_map(fn($p) => pil_num($p['amount'] ?? 0), $d['payments'] ?? [])) * 100);
            $rest = $total - $paid; $who = (int)($d['clientId'] ?? 0); $ref = (string)($r['number'] ?? '');
        } else {
            if (!empty($d['refused'])) continue;
            $total = (int)round(pil_purch_ttc($d) * 100);
            $paid = (int)round((is_array($d['payments'] ?? null) && $d['payments'] ? array_sum(array_map(fn($p) => pil_num($p['amount'] ?? 0), $d['payments'])) : (!empty($d['paid']) ? $total / 100 : 0)) * 100);
            $rest = $total - $paid; $who = (int)($d['supplierId'] ?? 0); $ref = (string)($d['ref'] ?? '');
        }
        $dc = preg_replace('/\D/', '', (string)($d['communication'] ?? ''));
        $score = 0; $why = [];
        if ($comm !== '' && $dc === $comm) { $score += 100; $why[] = 'communication structurée identique'; }
        if (abs($amt) === $rest && $rest !== 0) { $score += 40; $why[] = 'montant = reste à payer'; }
        elseif (abs($amt) === $total) { $score += 30; $why[] = 'montant = total TTC'; }
        if ($cpContact && $who === $cpContact) { $score += 30; $why[] = 'même contact (IBAN)'; }
        elseif ($type === 'expense' && $t['cp_iban'] !== '' && pil_norm_iban((string)($d['iban'] ?? '')) === $t['cp_iban']) { $score += 30; $why[] = 'même IBAN que l\'achat'; }
        if ($score < 60) continue;
        $ex = pil_payment_existing($d, $t);
        $out[] = ['type' => $type, 'id' => (int)$r['id'], 'ref' => $ref, 'date' => $d['date'] ?? null, 'total' => $total, 'rest' => $rest, 'contact_id' => $who ?: null,
            'score' => $score, 'level' => $score >= 100 ? 'sûr' : 'probable', 'why' => $why, 'existing_payment' => $ex['date'] ?? null,
            'can_pay' => !$ex && abs($amt) <= $rest && ($type === 'invoice' || (($d['status'] ?? '') !== 'avalider' && empty($d['toCheck'])))];
    }
    usort($out, fn($a, $b) => $b['score'] <=> $a['score']);
    return array_slice($out, 0, 5);
}
/** = purchTtc() de purchase.js */
function pil_purch_ttc(array $d): float {
    if (isset($d['ttc']) && $d['ttc'] !== '' && $d['ttc'] !== null) return pil_num($d['ttc']);
    $co = setting('company', []) ?: [];
    $def = isset($co['defaultVat']) ? pil_num($co['defaultVat']) : 21.0;
    if (is_array($d['vatLines'] ?? null) && $d['vatLines']) $vat = array_sum(array_map(fn($x) => pil_num($x['amount'] ?? 0), $d['vatLines']));
    else $vat = isset($d['vatAmount']) && $d['vatAmount'] !== '' && $d['vatAmount'] !== null ? pil_num($d['vatAmount']) : pil_r2(pil_num($d['amount'] ?? 0) * pil_num($d['vat'] ?? $def) / 100);
    return pil_r2(pil_num($d['amount'] ?? 0) + $vat);
}

// ------------------------------------------------------------------ Tableau de contrôle et historique mensuel
function pil_dashboard(): array {
    $accs = pil_accounts(); $out = [];
    foreach ($accs as $a) {
        $imps = q("SELECT * FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_from, id", [cid(), $a['id']])->fetchAll();
        $breaks = [];
        for ($i = 1; $i < count($imps); $i++) {
            if ((int)$imps[$i - 1]['closing'] !== (int)$imps[$i]['opening'])
                $breaks[] = ['after' => $imps[$i - 1]['period_to'], 'before' => $imps[$i]['period_from'], 'closing' => (int)$imps[$i - 1]['closing'], 'opening' => (int)$imps[$i]['opening'], 'gap' => (int)$imps[$i]['opening'] - (int)$imps[$i - 1]['closing']];
        }
        $last = $imps ? end($imps) : null; $first = $imps[0] ?? null;
        $cnt = q("SELECT status, COUNT(*) n FROM pil_bank_tx WHERE company_id = ? AND account_id = ? GROUP BY status", [cid(), $a['id']])->fetchAll(PDO::FETCH_KEY_PAIR);
        $sum = (int)q('SELECT COALESCE(SUM(amount),0) FROM pil_bank_tx WHERE company_id = ? AND account_id = ?', [cid(), $a['id']])->fetchColumn();
        $out[] = $a + ['imports' => count($imps), 'from' => $first['period_from'] ?? null, 'to' => $last['period_to'] ?? null,
            'opening' => $first ? (int)$first['opening'] : null, 'balance' => $last ? (int)$last['closing'] : null,
            // solde recalculé = premier solde + tous les mouvements enregistrés ; doit égaler le dernier solde de la banque
            'computed' => $first ? (int)$first['opening'] + $sum : null, 'breaks' => $breaks,
            'to_check' => (int)($cnt['a_verifier'] ?? 0), 'validated' => (int)($cnt['valide'] ?? 0)];
    }
    $unpaired = (int)q("SELECT COUNT(*) FROM pil_bank_tx WHERE company_id = ? AND category = 'transfert_interne' AND transfer_tx_id IS NULL", [cid()])->fetchColumn();
    $unclassed = (int)q("SELECT COUNT(*) FROM pil_bank_tx WHERE company_id = ? AND category = 'a_classer'", [cid()])->fetchColumn();
    $last = q("SELECT i.*, a.label, a.bank FROM pil_bank_imports i JOIN pil_bank_accounts a ON a.id = i.account_id WHERE i.company_id = ? ORDER BY i.id DESC LIMIT 10", [cid()])->fetchAll();
    return ['accounts' => $out, 'unpaired_transfers' => $unpaired, 'unclassified' => $unclassed, 'recent' => array_map('pil_import_out', $last), 'categories' => PIL_CATS];
}

function pil_import_out(array $r): array {
    foreach (['id', 'account_id', 'size', 'statement_no', 'statement_year', 'opening', 'closing', 'tx_count', 'tx_new', 'tx_dup', 'created_by', 'cancelled_by'] as $k) if (isset($r[$k])) $r[$k] = (int)$r[$k];
    $r['warnings'] = $r['warnings'] ? json_decode($r['warnings'], true) : [];
    unset($r['company_id'], $r['stored'], $r['sha256']);
    return $r;
}

/** Historique mois par mois (24 mois par défaut) : solde début, entrées, sorties, transferts internes, solde fin – par compte et consolidé. */
function pil_monthly(int $months = 24, ?string $until = null): array {
    $until = $until ?: date('Y-m');
    $end = new DateTimeImmutable("$until-01");
    $list = []; for ($i = $months - 1; $i >= 0; $i--) $list[] = $end->modify("-$i month")->format('Y-m');
    $accs = pil_accounts(); $res = ['months' => $list, 'accounts' => [], 'total' => []];
    foreach ($accs as $a) {
        $first = q("SELECT period_from, opening FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe' ORDER BY period_from, id LIMIT 1", [cid(), $a['id']])->fetch();
        $rows = q("SELECT DATE_FORMAT(booking_date, '%Y-%m') m, SUM(CASE WHEN category = 'transfert_interne' THEN 0 WHEN amount > 0 THEN amount ELSE 0 END) inn,
                SUM(CASE WHEN category = 'transfert_interne' THEN 0 WHEN amount < 0 THEN amount ELSE 0 END) outt, SUM(CASE WHEN category = 'transfert_interne' THEN amount ELSE 0 END) intr, COUNT(*) n
            FROM pil_bank_tx WHERE company_id = ? AND account_id = ? GROUP BY m", [cid(), $a['id']])->fetchAll();
        $by = array_column($rows, null, 'm');
        $cover = q("SELECT period_from, period_to FROM pil_bank_imports WHERE company_id = ? AND account_id = ? AND status = 'importe'", [cid(), $a['id']])->fetchAll();
        $bal = $first ? (int)$first['opening'] : null;
        // mouvements avant la fenêtre affichée : ajoutés au solde de départ
        if ($first) $bal += (int)q('SELECT COALESCE(SUM(amount),0) FROM pil_bank_tx WHERE company_id = ? AND account_id = ? AND booking_date < ?', [cid(), $a['id'], $list[0] . '-01'])->fetchColumn();
        $line = [];
        foreach ($list as $m) {
            $r = $by[$m] ?? null; $mStart = "$m-01"; $mEnd = date('Y-m-t', strtotime($mStart));
            $covered = 0;
            foreach ($cover as $c) { $s = max($mStart, $c['period_from']); $e = min($mEnd, $c['period_to']); if ($s <= $e) $covered += (strtotime($e) - strtotime($s)) / 86400 + 1; }
            $days = (int)date('t', strtotime($mStart));
            $started = $first && $mEnd >= $first['period_from'];
            $o = $started ? $bal : null;
            $in = (int)($r['inn'] ?? 0); $out = (int)($r['outt'] ?? 0); $int = (int)($r['intr'] ?? 0);
            if ($started) $bal += $in + $out + $int;
            $line[] = ['m' => $m, 'opening' => $o, 'in' => $in, 'out' => $out, 'internal' => $int, 'closing' => $started ? $bal : null, 'n' => (int)($r['n'] ?? 0),
                'coverage' => $started ? min(1, round($covered / $days, 2)) : 0];
        }
        $res['accounts'][] = ['id' => $a['id'], 'label' => $a['label'], 'bank' => $a['bank'], 'iban' => $a['iban'], 'months' => $line];
    }
    foreach ($list as $i => $m) {
        $t = ['m' => $m, 'opening' => 0, 'in' => 0, 'out' => 0, 'internal' => 0, 'closing' => 0, 'complete' => true];
        foreach ($res['accounts'] as $a) { $x = $a['months'][$i]; foreach (['opening', 'in', 'out', 'internal', 'closing'] as $k) $t[$k] += (int)$x[$k]; if ($x['coverage'] < 1) $t['complete'] = false; }
        $res['total'][] = $t;
    }
    return $res;
}

// ------------------------------------------------------------------ Routes : api.php?r=pilot/...
function pil_route(string $method, array $seg): void {
    $sub = $seg[1] ?? '';
    // activation par firme (administrateur) : seule route ouverte quand le module est éteint
    if ($sub === 'enable' && $method === 'POST') {
        $me = require_admin();
        if (pil_enabled()) { pil_bank_schema(); pil_security_schema(); pil_need($me, 'settings.write'); }
        $on = !empty(body()['enabled']);
        set_setting('pilotage', ['enabled' => $on, 'by' => $me['id'], 'at' => now()] + (setting('pilotage', []) ?: []));
        log_activity($me['id'], 'update', 'settings', null, null, 'Module Pilotage ' . ($on ? 'activé' : 'désactivé'));
        pil_bank_schema(); pil_security_schema(); pil_audit($on ? 'module_active' : 'module_desactive', 'settings', null, null, ['enabled' => $on]);
        out(['ok' => true, 'enabled' => $on]);
    }
    $me = pil_require();
    if (pil_role($me) === 'none' && $sub !== 'me') fail(403, 'Vous n\'avez pas accès au module Pilotage.');
    $perm = pil_route_perm($sub, $method, $seg);
    if ($perm) pil_need($me, $perm);
    $id = isset($seg[2]) ? (int)$seg[2] : 0;
    switch ($sub) {
        case 'me': case 'approvals': case 'audit': case 'roles': case 'export': case 'settings':
            pil_security_route($method, $seg, $me);
        case 'accounts':
            if ($method === 'GET') out(pil_accounts());
            if ($method === 'POST') {
                $b = body();
                $iban = pil_norm_iban((string)($b['iban'] ?? ''));
                if (!pil_iban_valid($iban)) fail(400, 'IBAN invalide.');
                $bank = trim((string)($b['bank'] ?? '')) ?: pil_bank_from_iban($iban);
                if (q('SELECT id FROM pil_bank_accounts WHERE company_id = ? AND iban = ?', [cid(), $iban])->fetch()) fail(400, 'Ce compte existe déjà.');
                q('INSERT INTO pil_bank_accounts (company_id, bank, iban, label, currency, active, created_by, created_at) VALUES (?,?,?,?,?,1,?,?)',
                    [cid(), mb_substr($bank, 0, 60), $iban, mb_substr(trim((string)($b['label'] ?? '')), 0, 120), 'EUR', $me['id'], now()]);
                $nid = (int)db()->lastInsertId();
                log_activity($me['id'], 'create', 'bank_account', $nid, null, "Compte bancaire $bank $iban");
                pil_audit('compte_ajoute', 'bank_account', $nid, null, ['banque' => $bank, 'iban' => $iban]);
                out(pil_accounts());
            }
            if ($method === 'PUT' && $id) {
                $b = body();
                $old = q('SELECT bank, label, active FROM pil_bank_accounts WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                if (!$old) fail(404, 'Compte introuvable');
                pil_audit('compte_modifie', 'bank_account', $id, $old, ['bank' => $b['bank'] ?? '', 'label' => $b['label'] ?? '', 'active' => empty($b['active']) ? 0 : 1]);
                q('UPDATE pil_bank_accounts SET label = ?, bank = ?, active = ? WHERE id = ? AND company_id = ?', [mb_substr(trim((string)($b['label'] ?? '')), 0, 120), mb_substr(trim((string)($b['bank'] ?? '')), 0, 60), empty($b['active']) ? 0 : 1, $id, cid()]);
                out(pil_accounts());
            }
            break;
        case 'preview': case 'import':
            if ($method !== 'POST') break;
            $b = body();
            $bytes = base64_decode((string)($b['content'] ?? ''), true);
            if ($bytes === false || $bytes === '') fail(400, 'Fichier vide ou illisible.');
            if (strlen($bytes) > 20 * 1024 * 1024) fail(400, 'Fichier trop volumineux (max. 20 Mo).');
            $name = preg_replace('/[\x00-\x1f\/\\\\]/', '_', (string)($b['name'] ?? 'extrait'));
            $file = ['name' => $name, 'bytes' => $bytes, 'layout' => is_array($b['layout'] ?? null) ? $b['layout'] : null, 'table' => is_array($b['table'] ?? null) ? $b['table'] : null];
            $acc = !empty($b['account']) ? (int)$b['account'] : null;
            if ($sub === 'preview') out(pil_analyse($file, $acc));
            $r = pil_import($file, $me, $acc);
            if (!$r['ok']) $r['error'] = 'Import refusé : ' . implode(' ', $r['errors']); // message lisible pour l'utilisateur
            out($r, $r['ok'] ? 200 : 422);
        case 'imports':
            if ($method === 'GET' && !$id) out(array_map('pil_import_out', q('SELECT * FROM pil_bank_imports WHERE company_id = ? ORDER BY id DESC', [cid()])->fetchAll()));
            if ($method === 'GET' && $id && ($seg[3] ?? '') === 'file') {
                $imp = q('SELECT * FROM pil_bank_imports WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                $path = $imp ? dirname(__DIR__) . '/uploads/' . $imp['stored'] : '';
                if (!$imp || !is_file($path)) fail(404, 'Fichier introuvable');
                pil_audit('telechargement_extrait', 'bank_import', $id, null, ['fichier' => $imp['filename']]);
                header('Content-Type: ' . ($imp['format'] === 'pdf' ? 'application/pdf' : ($imp['format'] === 'csv' ? 'text/csv' : 'application/octet-stream')));
                header('Content-Disposition: attachment; filename="' . str_replace('"', '', $imp['filename']) . '"');
                header('X-Content-Type-Options: nosniff');
                readfile($path); exit;
            }
            if ($method === 'DELETE' && $id) {
                $imp = q("SELECT * FROM pil_bank_imports WHERE id = ? AND company_id = ? AND status = 'importe'", [$id, cid()])->fetch();
                if (!$imp) fail(404, 'Import introuvable ou déjà annulé.');
                $paid = (int)q('SELECT COUNT(*) FROM pil_bank_tx WHERE company_id = ? AND import_id = ? AND match_paid = 1', [cid(), $id])->fetchColumn();
                out(['done' => false, 'approval' => pil_approval_request(['type' => 'annulation_import', 'description' => 'Annuler l\'import « ' . $imp['filename'] . ' » (' . pil_d($imp['period_from']) . ' – ' . pil_d($imp['period_to']) . ', ' . $imp['tx_new'] . ' mouvements)',
                    'payload' => ['import_id' => $id], 'justification' => trim((string)(body()['justification'] ?? '')) ?: null,
                    'risks' => array_values(array_filter(['Les mouvements, classements et rapprochements de cet import seront retirés.', $paid ? "$paid paiement(s) enregistré(s) dans des factures ou achats seront retirés." : null])), 'documents' => [['type' => 'bank_import', 'id' => $id, 'name' => $imp['filename']]]], $me)], 202);
            }
            break;
        case 'tx':
            if ($method === 'GET' && !$id) out(pil_tx_list($_GET));
            if ($method === 'GET' && $id && ($seg[3] ?? '') === 'suggest') {
                $t = q('SELECT * FROM pil_bank_tx WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
                if (!$t) fail(404, 'Mouvement introuvable');
                out(pil_match_suggestions($t));
            }
            if ($method === 'PUT' && $id) {
                $b = body();
                if (!empty($b['match']['pay']) && !pil_can($me, 'bank.pay')) {
                    $t = q('SELECT * FROM pil_bank_tx WHERE id = ? AND company_id = ?', [$id, cid()])->fetch(); if (!$t) fail(404, 'Mouvement introuvable');
                    $type = (string)($b['match']['type'] ?? ''); $mid = (int)($b['match']['id'] ?? 0);
                    $doc = q('SELECT number, data FROM items WHERE id = ? AND company_id = ? AND type = ?', [$mid, cid(), $type])->fetch(); if (!$doc || !in_array($type, ['invoice', 'expense'], true)) fail(404, 'Document introuvable');
                    $dd = json_decode($doc['data'], true) ?: [];
                    out(['done' => false, 'approval' => pil_approval_request(['type' => 'paiement_rapprochement', 'description' => 'Enregistrer le paiement de ' . pil_fmt(abs((int)$t['amount'])) . ' du ' . pil_d($t['booking_date']) . ' dans ' . ($type === 'invoice' ? 'la facture ' . ($doc['number'] ?: '#' . $mid) : 'l\'achat ' . (($dd['ref'] ?? '') ?: '#' . $mid)),
                        'payload' => ['tx_id' => $id, 'type' => $type, 'id' => $mid], 'amount' => abs((int)$t['amount']), 'justification' => trim((string)($b['justification'] ?? '')) ?: null,
                        'risks' => ['Modifie l\'état de paiement du document dans BâtiPro.'], 'documents' => [['type' => $type, 'id' => $mid, 'name' => $doc['number'] ?: ($dd['ref'] ?? '')]]], $me)], 202);
                }
                try { out(pil_tx_update($id, $b, $me)); } catch (PilError $e) { fail($e->getCode() ?: 400, $e->getMessage()); }
            }
            if ($method === 'POST' && $id === 0 && ($seg[2] ?? '') === 'bulk') {
                $b = body(); $done = 0; $errors = [];
                $set = array_intersect_key((array)($b['set'] ?? []), ['category' => 1, 'status' => 1]); // en lot : classement et validation seulement (jamais de paiement)
                foreach (array_slice((array)($b['ids'] ?? []), 0, 2000) as $tid) { try { pil_tx_update((int)$tid, $set, $me); $done++; } catch (PilError $e) { $errors[$e->getMessage()] = ($errors[$e->getMessage()] ?? 0) + 1; } }
                out(['ok' => true, 'done' => $done, 'refused' => $errors]);
            }
            break;
        case 'dashboard': if ($method === 'GET') out(pil_dashboard()); break;
        case 'overview': case 'explain': case 'reconcile': case 'projects': case 'alerts': case 'reports': case 'decisions': case 'compare': case 'review': case 'runs': case 'ask': case 'convs': case 'pinned':
            require_once __DIR__ . '/director.php';
            pil_director_route($method, $seg, $me);
        case 'forecast': case 'receivables': case 'hypotheses': case 'flags': case 'commitments':
            require_once __DIR__ . '/treasury.php';
            pil_treasury_route($method, $seg, $me);
        case 'monthly': if ($method === 'GET') out(pil_monthly(max(1, min(60, (int)($_GET['months'] ?? 24))), preg_match('/^\d{4}-\d{2}$/', (string)($_GET['until'] ?? '')) ? $_GET['until'] : null)); break;
    }
    fail(404, 'Route inconnue');
}
