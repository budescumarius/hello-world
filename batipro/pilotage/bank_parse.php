<?php
// Lecture des extraits bancaires : CODA (norme Febelfin, toutes banques belges) et PDF Belfius / BNP Paribas Fortis.
// Les PDF arrivent sous forme de « mise en page » extraite dans le navigateur par pdf.js (celui de BatiPro) :
//   [ { w: largeur, rows: [ { y, p: [ [x, texte], … ] }, … ] }, … ]   (une entrée par page)
// Chaque lecteur renvoie un ou plusieurs relevés normalisés (montants en CENTIMES entiers) :
//   [ 'bank', 'format', 'iban', 'currency', 'number', 'opening' => ['date', 'amount'], 'closing' => [...],
//     'transactions' => [ [ 'seq', 'date', 'value_date', 'amount', 'counterparty_name', 'counterparty_iban',
//                           'communication', 'structured', 'bank_ref', 'type_code', 'raw' ], … ], 'warnings' => [] ]
// Aucun montant n'est deviné : une ligne illisible produit un avertissement, jamais une valeur inventée.
declare(strict_types=1);

const PIL_IBAN_RE = '/\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?)\b/';

/** « 1.234,56 », « +17.095,92 », « - 267,90 », « 10.600,00+ », « 24,20 - » → centimes signés ; null si illisible. */
function pil_parse_amount(string $s): ?int {
    $s = str_replace(["\u{00a0}", ' '], '', trim($s));
    if (!preg_match('/^([+-]?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})([+-]?)$/', $s, $m)) return null;
    if ($m[1] !== '' && $m[4] !== '') return null;
    $cents = (int)str_replace('.', '', $m[2]) * 100 + (int)$m[3];
    return ($m[1] === '-' || $m[4] === '-') ? -$cents : $cents;
}
/** jj-mm-aaaa ou jj/mm/aaaa → aaaa-mm-jj */
function pil_parse_date(string $s): ?string {
    if (!preg_match('/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/', trim($s), $m) || !checkdate((int)$m[2], (int)$m[1], (int)$m[3])) return null;
    return "$m[3]-$m[2]-$m[1]";
}
function pil_norm_iban(string $s): string { return strtoupper(preg_replace('/\s+/', '', $s)); }
function pil_iban_valid(string $iban): bool {
    $i = pil_norm_iban($iban);
    if (!preg_match('/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/', $i)) return false;
    $r = substr($i, 4) . substr($i, 0, 4); $n = '';
    foreach (str_split($r) as $c) $n .= ctype_alpha($c) ? (string)(ord($c) - 55) : $c;
    $mod = 0; foreach (str_split($n, 7) as $chunk) $mod = (int)(($mod . $chunk) % 97);
    return $mod === 1;
}
/** Communication structurée belge (+++123/4567/89012+++ ou 12 chiffres) → +++xxx/xxxx/xxxxx+++ si la clé modulo 97 est juste. */
function pil_structured(string $s): ?string {
    if (!preg_match('/(?:\+\+\+|\*\*\*)?\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*(?:\+\+\+|\*\*\*)?/', $s, $m) && !preg_match('/^\s*(\d{3})(\d{4})(\d{5})\s*$/', $s, $m)) return null;
    $d = $m[1] . $m[2] . $m[3];
    $k = (int)(intdiv((int)substr($d, 0, 10), 1) % 97) ?: 97;
    return $k === (int)substr($d, 10) ? "+++$m[1]/$m[2]/$m[3]+++" : null;
}
function pil_row_text(array $row): string { return trim(preg_replace('/\s+/', ' ', implode(' ', array_column($row['p'], 1)))); }

// ===================================================================== CODA
/** @return array<int, array> relevés (un fichier CODA peut en contenir plusieurs) */
function pil_parse_coda(string $raw): array {
    // positions CODA = octets : on découpe sur le contenu brut, puis chaque champ texte est converti en UTF-8
    $utf8 = mb_check_encoding($raw, 'UTF-8') && preg_match('/[\x80-\xff]/', $raw);
    $txt = fn(string $s): string => mb_convert_encoding($s, 'UTF-8', 'Windows-1252'); // les lignes sont toujours découpées en octets Windows-1252
    $lines = preg_split('/\r\n|\r|\n/', $raw);
    $out = []; $st = null; $cur = null; $bankId = '';
    $amt = fn(string $sign, string $digits) => ($sign === '1' ? -1 : 1) * intdiv((int)$digits + 5, 10); // 3 décimales → centimes
    $d6 = function (string $s): ?string { if (!preg_match('/^(\d{2})(\d{2})(\d{2})$/', $s, $m) || !checkdate((int)$m[2], (int)$m[1], 2000 + (int)$m[3])) return null; return '20' . "$m[3]-$m[2]-$m[1]"; };
    $flush = function () use (&$cur, &$st, $txt) { if ($cur && $st) { $cur['communication'] = trim(preg_replace('/\s+/', ' ', $txt($cur['communication']))); $cur['counterparty_name'] = $txt($cur['counterparty_name']); $cur['raw'] = $txt($cur['raw']); $st['transactions'][] = $cur; } $cur = null; };
    foreach ($lines as $n => $line) {
        if (trim($line) === '') continue;
        if ($utf8) $line = mb_convert_encoding($line, 'Windows-1252', 'UTF-8'); // fichier ré-enregistré en UTF-8 : on revient aux octets d'origine
        $line = str_pad($line, 128);
        $rec = $line[0];
        if ($rec === '0') {
            $bankId = substr($line, 11, 3);
            $st = ['bank' => pil_bank_from_code($bankId), 'format' => 'coda', 'iban' => '', 'currency' => 'EUR', 'number' => null, 'opening' => null, 'closing' => null,
                'transactions' => [], 'warnings' => [], 'control' => null, 'created' => $d6(substr($line, 5, 6))];
        } elseif ($rec === '1' && $st) {
            $struct = $line[1];
            $acc = substr($line, 5, 37);
            if ($struct === '2' || $struct === '3') { $st['iban'] = pil_norm_iban(substr($acc, 0, 34)); $st['iban'] = preg_replace('/[^A-Z0-9].*$/', '', $st['iban']); $st['currency'] = trim(substr($line, 39, 3)) ?: 'EUR'; }
            else { $st['iban'] = trim(substr($acc, 0, 12)); $st['currency'] = trim(substr($line, 18, 3)) ?: 'EUR'; $st['warnings'][] = 'Ancien numéro de compte belge (non IBAN)'; }
            $st['number'] = (int)substr($line, 2, 3);
            $st['opening'] = ['date' => $d6(substr($line, 58, 6)), 'amount' => $amt($line[42], substr($line, 43, 15))];
        } elseif ($rec === '2' && $st) {
            $art = $line[1];
            if ($art === '1') {
                $flush();
                $commType = $line[61]; $comm = substr($line, 62, 53);
                $structured = null;
                if ($commType === '1' && substr($comm, 0, 3) === '101') $structured = pil_structured(substr($comm, 3, 12));
                $cur = ['seq' => (int)substr($line, 2, 4), 'detail' => (int)substr($line, 6, 4), 'bank_ref' => trim(substr($line, 10, 21)),
                    'amount' => $amt($line[31], substr($line, 32, 15)), 'value_date' => $d6(substr($line, 47, 6)), 'type_code' => substr($line, 53, 8),
                    'date' => $d6(substr($line, 115, 6)), 'communication' => $structured ? '' : $comm, 'structured' => $structured,
                    'counterparty_name' => '', 'counterparty_iban' => '', 'raw' => rtrim($line)];
                if ($cur['detail'] !== 0) { $cur['_detailOnly'] = true; } // détail d'une opération globalisée : signalé, non additionné
            } elseif ($art === '2' && $cur) {
                $cur['communication'] .= substr($line, 10, 53);
                $cur['raw'] .= "\n" . rtrim($line);
            } elseif ($art === '3' && $cur) {
                $acc = trim(substr($line, 10, 37));
                if ($acc !== '') { $cur['counterparty_iban'] = preg_replace('/(EUR|USD|GBP|CHF)$/', '', pil_norm_iban($acc)); }
                $cur['counterparty_name'] = trim(substr($line, 47, 35));
                $cur['communication'] .= substr($line, 82, 43);
                $cur['raw'] .= "\n" . rtrim($line);
            }
        } elseif ($rec === '3' && $cur) {
            $art = $line[1];
            $cur['communication'] .= ' ' . ($art === '1' ? substr($line, 40, 73) : substr($line, 10, 105));
            $cur['raw'] .= "\n" . rtrim($line);
        } elseif ($rec === '8' && $st) {
            $flush();
            $st['closing'] = ['date' => $d6(substr($line, 57, 6)), 'amount' => $amt($line[41], substr($line, 42, 15))];
        } elseif ($rec === '9' && $st) {
            $flush();
            $st['control'] = ['records' => (int)substr($line, 16, 6), 'debit' => intdiv((int)substr($line, 22, 15) + 5, 10), 'credit' => intdiv((int)substr($line, 37, 15) + 5, 10)];
            // les détails (globalisation) ne s'additionnent pas une seconde fois
            $st['transactions'] = array_values(array_filter($st['transactions'], fn($t) => empty($t['_detailOnly'])));
            $out[] = $st; $st = null;
        }
    }
    if ($st) { $flush(); $st['warnings'][] = 'Fichier CODA incomplet (enregistrement 9 absent)'; $out[] = $st; }
    foreach ($out as &$s) {
        foreach ($s['transactions'] as &$t) { unset($t['_detailOnly'], $t['detail']); $t['counterparty_iban'] = $t['counterparty_iban'] !== '' && pil_iban_valid($t['counterparty_iban']) ? $t['counterparty_iban'] : ''; }
        unset($t);
        if ($s['control']) {
            $deb = -array_sum(array_filter(array_column($s['transactions'], 'amount'), fn($a) => $a < 0));
            $cred = array_sum(array_filter(array_column($s['transactions'], 'amount'), fn($a) => $a > 0));
            if ($deb !== $s['control']['debit'] || $cred !== $s['control']['credit']) $s['warnings'][] = 'Totaux de contrôle CODA différents des mouvements lus';
        }
    }
    return $out;
}

function pil_bank_from_code(string $code): string {
    return ['671' => 'Europabank', '068' => 'Belfius', '001' => 'BNP Paribas Fortis', '002' => 'BNP Paribas Fortis', '003' => 'BNP Paribas Fortis', '734' => 'KBC', '735' => 'KBC', '063' => 'Belfius', '310' => 'ING'][$code] ?? "Banque $code";
}
/** Banque déduite d'un IBAN belge (code banque = 3 premiers chiffres du numéro). */
function pil_bank_from_iban(string $iban): string {
    $i = pil_norm_iban($iban);
    if (!str_starts_with($i, 'BE')) return '';
    $c = substr($i, 4, 3);
    if ($c >= '050' && $c <= '099') return 'Belfius';
    if ($c >= '000' && $c <= '049') return 'BNP Paribas Fortis';
    return pil_bank_from_code($c);
}

// ===================================================================== PDF Belfius
function pil_parse_belfius(array $pages): array {
    $st = ['bank' => 'Belfius', 'format' => 'pdf', 'iban' => '', 'currency' => 'EUR', 'number' => null, 'opening' => null, 'closing' => null, 'transactions' => [], 'warnings' => []];
    $cur = null; $done = false;
    $skip = '/^(Belfius Banque SA|Place Charles Rogier|IBAN: BE23 0529|RPM Bruxelles|Agent d\'assurances|Belfius Connect|-{5,}|BELFIUS BUSINESS|DATE :|PAGE :|\d{2}-\d{2}-\d{4} \d+\/\d+$|TAUX D\'INTERET|CE PRODUIT|PLUS D\'INFOS)/u';
    $flush = function () use (&$cur, &$st) { if ($cur) { $cur['communication'] = trim(preg_replace('/\s+/', ' ', $cur['communication'])); pil_extract_counterparty($cur, $st['iban']); $st['transactions'][] = $cur; } $cur = null; };
    foreach ($pages as $pg) {
        foreach ($pg['rows'] as $row) {
            if ($done) break 2;
            $t = pil_row_text($row);
            if (!$st['iban'] && preg_match('/^-{5,} (BE\d{2}(?: \d{4}){3})/', $t, $m)) $st['iban'] = pil_norm_iban($m[1]);
            if ($st['number'] === null && preg_match('/^PAGE : (\d+)\/\d+/', $t, $m)) $st['number'] = (int)$m[1];
            if (str_starts_with($t, 'ANNEXE AU MOUVEMENT')) { $flush(); $done = true; break; }
            if (preg_match('/^SOLDE AU (\d{2}-\d{2}-\d{4})(?: \d{2}:\d{2})? (EUR|USD) (.+)$/', $t, $m)) {
                $flush();
                $bal = ['date' => pil_parse_date($m[1]), 'amount' => pil_parse_amount($m[3])];
                if ($st['opening'] === null) { $st['opening'] = $bal; $st['currency'] = $m[2]; } else { $st['closing'] = $bal; $done = true; }
                continue;
            }
            if (preg_match($skip, $t)) continue;
            $first = $row['p'][0];
            if ($first[0] < 95 && preg_match('/^(\d{4}) (\d{2}-\d{2}-\d{4}) \(VAL\. (\d{2}-\d{2}-\d{4})\) (.+)$/', $t, $m)) {
                $flush();
                $amount = pil_parse_amount($m[4]);
                if ($amount === null) $st['warnings'][] = "Montant illisible pour l'opération $m[1] : « $m[4] »";
                $cur = ['seq' => (int)$m[1], 'date' => pil_parse_date($m[2]), 'value_date' => pil_parse_date($m[3]), 'amount' => $amount, 'communication' => '',
                    'structured' => null, 'counterparty_name' => '', 'counterparty_iban' => '', 'bank_ref' => '', 'type_code' => '', 'raw' => $t];
                continue;
            }
            if ($cur && $st['opening'] !== null) { $cur['communication'] .= ' ' . $t; $cur['raw'] .= "\n" . $t; }
        }
    }
    $flush();
    if ($st['closing'] === null) $st['warnings'][] = 'Solde final introuvable';
    return [$st];
}

// ===================================================================== PDF BNP Paribas Fortis
function pil_parse_bnp(array $pages): array {
    $st = ['bank' => 'BNP Paribas Fortis', 'format' => 'pdf', 'iban' => '', 'currency' => 'EUR', 'number' => null, 'opening' => null, 'closing' => null, 'transactions' => [], 'warnings' => []];
    $cur = null; $day = null; $done = false; $started = false;
    $flush = function () use (&$cur, &$st) {
        if (!$cur) return;
        $desc = trim(preg_replace('/\s+/', ' ', implode(' ', $cur['_desc'])));
        $cp = $cur['_cp'];
        foreach ($cp as $i => $l) {
            $l2 = preg_replace('/ (EUR|USD|GBP|CHF)$/', '', $l);
            if (!$cur['counterparty_iban'] && preg_match('/^([A-Z]{2}\d{2}(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?)$/', $l2, $m) && pil_iban_valid($m[1])) { unset($cp[$i]); if (pil_norm_iban($m[1]) !== $st['iban']) $cur['counterparty_iban'] = pil_norm_iban($m[1]); }
            elseif (preg_match('/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/', $l)) unset($cp[$i]); // BIC
        }
        $cur['counterparty_name'] = trim((string)(array_values($cp)[0] ?? ''));
        if (preg_match('/Communication : (.+?)(?= Référence| Date d\'exécution|$)/u', $desc, $m)) {
            $s = pil_structured($m[1]);
            if ($s) $cur['structured'] = $s; else $cur['communication'] = trim($m[1]);
        }
        if (preg_match('/Référence banque : (\d+)/u', $desc, $m)) $cur['bank_ref'] = $m[1];
        if (!$cur['communication'] && !$cur['structured']) $cur['communication'] = $desc;
        if (!$cur['counterparty_name'] && preg_match('/^Paiement par carte[^:]*?Numéro [0-9X ]+ (.+?) \d{2}-\d{2}-\d{4} \d{2}:\d{2}/u', $desc, $m)) $cur['counterparty_name'] = trim($m[1]);
        $cur['raw'] = $desc . ($cur['_cp'] ? ' | ' . implode(' / ', $cur['_cp']) : '');
        unset($cur['_desc'], $cur['_cp']);
        $st['transactions'][] = $cur; $cur = null;
    };
    foreach ($pages as $pg) {
        $col = ['cp' => 300.0, 'val' => 440.0, 'amt' => 480.0];
        foreach ($pg['rows'] as $row) {
            if ($done) break 2;
            $t = pil_row_text($row);
            if (preg_match('/^(BE\d{2}(?: \d{4}){3}) (EUR|USD)$/', $t, $m) && !$st['iban']) { $st['iban'] = pil_norm_iban($m[1]); $st['currency'] = $m[2]; continue; }
            if (preg_match('/Extrait N° (\d{4}) - (\d+)/u', $t, $m)) { $st['number'] = (int)$m[2]; $st['year'] = (int)$m[1]; continue; }
            if (preg_match('/^Solde actuel au (\d{2}-\d{2}-\d{4}) (.+)$/u', $t, $m)) { $st['closing'] = ['date' => pil_parse_date($m[1]), 'amount' => pil_parse_amount($m[2])]; continue; }
            if (preg_match('/^Solde précédent au (\d{2}-\d{2}-\d{4}) (.+)$/u', $t, $m)) {
                if ($started) { $flush(); $done = true; break; }
                $st['opening'] = ['date' => pil_parse_date($m[1]), 'amount' => pil_parse_amount($m[2])]; continue;
            }
            if (str_contains($t, 'Type d\'opération / description')) { foreach ($row['p'] as [$x, $s]) { if ($s === 'Contrepartie') $col['cp'] = $x - 5; if ($s === 'Valeur') $col['val'] = $x - 5; if (str_starts_with($s, 'Montant')) $col['amt'] = $x - 20; } continue; }
            if (preg_match('/^(BNP Paribas Fortis SA|RPM Bruxelles|Tél\. 02|P\.DOC|\d{8}-\d{2}:\d{2}|\d+ \/ \d+$|SRL |Flex Pro|BIC [A-Z]{8}|Date$|Les dépôts)/u', $t)) continue;
            if (preg_match('/^\.{10,}/', $t)) { $flush(); continue; }
            if (count($row['p']) === 1 && preg_match('/^\d{2}-\d{2}-\d{4}$/', $t) && $row['p'][0][0] < 60) { $flush(); $day = pil_parse_date($t); continue; }
            $first = $row['p'][0];
            $last = end($row['p']);
            if ($first[0] < 60 && preg_match('/^\d{4}$/', $first[1]) && $last[0] >= $col['amt'] && ($amount = pil_parse_amount($last[1])) !== null) {
                $flush(); $started = true;
                $val = null; $desc = []; $cp = [];
                foreach (array_slice($row['p'], 1, -1) as [$x, $s]) {
                    if ($x >= $col['val'] && preg_match('/^(\d{2})-(\d{2})$/', $s, $vm) && $day) {
                        $y = (int)substr($day, 0, 4); if ((int)$vm[2] - (int)substr($day, 5, 2) > 6) $y--; elseif ((int)substr($day, 5, 2) - (int)$vm[2] > 6) $y++;
                        $val = sprintf('%04d-%s-%s', $y, $vm[2], $vm[1]);
                    } elseif ($x >= $col['cp']) $cp[] = $s; else $desc[] = $s;
                }
                if (!$day) $st['warnings'][] = "Date de l'opération {$first[1]} introuvable";
                $cur = ['seq' => (int)$first[1], 'date' => $day, 'value_date' => $val ?? $day, 'amount' => $amount, 'communication' => '', 'structured' => null,
                    'counterparty_name' => '', 'counterparty_iban' => '', 'bank_ref' => '', 'type_code' => '', 'raw' => '', '_desc' => [implode(' ', $desc)], '_cp' => $cp];
                continue;
            }
            if ($cur) {
                $d = []; $c = [];
                foreach ($row['p'] as [$x, $s]) { if ($x >= $col['cp'] && $x < $col['val']) $c[] = $s; else $d[] = $s; }
                if ($d) $cur['_desc'][] = implode(' ', $d);
                if ($c) $cur['_cp'][] = implode(' ', $c);
            }
        }
    }
    $flush();
    // l'extrait BNP liste les opérations de la plus récente à la plus ancienne : remise dans l'ordre chronologique
    usort($st['transactions'], fn($a, $b) => $a['seq'] <=> $b['seq']);
    if ($st['closing'] === null) $st['warnings'][] = 'Solde actuel introuvable';
    if ($st['opening'] === null) $st['warnings'][] = 'Solde précédent introuvable';
    return [$st];
}

/** Contrepartie dans le texte libre (Belfius) : premier IBAN valide différent du compte, suivi du nom. */
function pil_extract_counterparty(array &$t, string $ownIban): void {
    $txt = $t['communication'];
    if (preg_match_all('/\b([A-Z]{2}\d{2}(?: \d{4}){3,4}(?: \d{1,4})?)\b/', $txt, $mm)) {
        foreach ($mm[1] as $ib) {
            $n = pil_norm_iban($ib);
            if ($n === $ownIban || !pil_iban_valid($n)) continue;
            $t['counterparty_iban'] = $n;
            if (preg_match('/' . preg_quote($ib, '/') . ' (.+?)(?: \+\+\+|$)/', $txt, $m)) {
                $name = preg_replace('/ (VERS|DE) BE\d{2}.*$/', '', $m[1]);
                $t['counterparty_name'] = mb_substr(trim($name), 0, 80);
            }
            break;
        }
    }
    $s = pil_structured($txt);
    if ($s) $t['structured'] = $s;
}

/** Détection du format et lecture. $layout : mise en page pdf.js (PDF) ; $raw : contenu brut (CODA). */
function pil_parse_statement(string $filename, ?string $raw, ?array $layout): array {
    if ($raw !== null && preg_match('/^0000\d/', ltrim($raw)) && str_contains($raw, "\n1")) return pil_parse_coda($raw);
    if ($layout) {
        $head = '';
        foreach (array_slice($layout[0]['rows'] ?? [], 0, 40) as $r) $head .= pil_row_text($r) . "\n";
        if (str_contains($head, 'Belfius')) return pil_parse_belfius($layout);
        foreach ($layout as $pg) foreach (array_slice($pg['rows'] ?? [], -6) as $r) if (str_contains(pil_row_text($r), 'BNP Paribas Fortis')) return pil_parse_bnp($layout);
        throw new RuntimeException("Format d'extrait PDF non reconnu (banques prises en charge : Belfius, BNP Paribas Fortis ; Europabank en CODA).");
    }
    throw new RuntimeException('Format de fichier non reconnu : CODA (.cod) ou PDF attendu.');
}
