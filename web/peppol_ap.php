<?php
// Connexion à un point d'accès Peppol (Peppyrus, gratuit pour les entreprises belges) :
// réception automatique des factures fournisseurs dans « Achats & dépenses » et envoi direct des factures.
declare(strict_types=1);

const PAP_DOC_INVOICE = 'busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1';
const PAP_DOC_CREDIT = 'busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1';
const PAP_PROCESS = 'cenbii-procid-ubl::urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

function pap_cfg(): array {
    $c = setting('peppolap', []) ?: [];
    if (empty($c['key'])) throw new RuntimeException('Connexion Peppol non configurée (Paramètres › Peppol).');
    return $c;
}

function pap_req(string $method, string $path, ?array $body = null): array {
    $c = pap_cfg();
    $env = $c['env'] ?? 'prod';
    $base = $env === 'test' ? 'https://api.test.peppyrus.be/v1/' : 'https://api.peppyrus.be/v1/';
    if ($env === 'custom' && !empty($c['url'])) $base = rtrim((string)$c['url'], '/') . '/'; // tests / autre instance
    $headers = ['X-Api-Key: ' . $c['key'], 'Accept: application/json'];
    $payload = null;
    if ($body !== null) { $payload = json_encode($body); $headers[] = 'Content-Type: application/json'; }
    if (function_exists('curl_init')) {
        $ch = curl_init($base . $path);
        curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CONNECTTIMEOUT => 12, CURLOPT_HTTPHEADER => $headers]);
        if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        $raw = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false) throw new RuntimeException('Point d\'accès Peppol injoignable : ' . $err);
    } else {
        $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $payload ?? '', 'timeout' => 40, 'ignore_errors' => true]]);
        $raw = @file_get_contents($base . $path, false, $ctx);
        if ($raw === false) throw new RuntimeException('Point d\'accès Peppol injoignable depuis le serveur.');
        $code = preg_match('#HTTP/\S+ (\d+)#', $http_response_header[0] ?? '', $m) ? (int)$m[1] : 0;
    }
    if ($code === 401 || $code === 403) throw new RuntimeException('Clé API Peppol refusée : vérifiez-la dans Paramètres › Peppol.');
    $json = json_decode((string)$raw, true);
    if ($code >= 400) {
        $msg = is_array($json) ? ($json['message'] ?? $json['detail'] ?? $json['title'] ?? json_encode($json, JSON_UNESCAPED_UNICODE)) : trim((string)$raw);
        throw new RuntimeException("Peppol ($code) : " . mb_substr((string)$msg, 0, 400));
    }
    return is_array($json) ? $json : [];
}

// Lecture d'une facture / note de crédit UBL (même logique que parseUBL côté navigateur)
function ubl_parse(string $xml): array {
    $prev = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    $ok = $doc->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT);
    libxml_use_internal_errors($prev);
    if (!$ok || !$doc->documentElement) throw new RuntimeException('XML illisible');
    $root = $doc->documentElement;
    $kind = $root->localName;
    if (!in_array($kind, ['Invoice', 'CreditNote'], true)) throw new RuntimeException("Document Peppol non géré ($kind)");
    $kids = function (?DOMElement $el, string $name): array {
        $r = [];
        if ($el) foreach ($el->childNodes as $c) if ($c instanceof DOMElement && $c->localName === $name) $r[] = $c;
        return $r;
    };
    $one = function (?DOMElement $el, string ...$path) use ($kids): ?DOMElement {
        foreach ($path as $p) { $el = $kids($el, $p)[0] ?? null; if (!$el) return null; }
        return $el;
    };
    $txt = fn(?DOMElement $el, string ...$path): string => ($e = $one($el, ...$path)) ? trim($e->textContent) : '';
    $num = fn(string $s): float => (float)str_replace(',', '.', $s);
    $sign = $kind === 'CreditNote' ? -1 : 1;
    $sup = $one($root, 'AccountingSupplierParty', 'Party');
    $ep = $one($sup, 'EndpointID');
    $atts = [];
    foreach ($kids($root, 'AdditionalDocumentReference') as $ref) {
        $bin = $one($ref, 'Attachment', 'EmbeddedDocumentBinaryObject');
        if ($bin && trim($bin->textContent) !== '') {
            $atts[] = ['name' => $bin->getAttribute('filename') ?: ($txt($ref, 'ID') . '.pdf'), 'mime' => $bin->getAttribute('mimeCode') ?: 'application/pdf', 'data' => base64_decode(preg_replace('/\s+/', '', $bin->textContent))];
        }
    }
    $tax = 0.0;
    foreach ($kids($root, 'TaxTotal') as $t) { $v = $num($txt($t, 'TaxAmount')); if ($v) { $tax = $v; break; } }
    $lines = [];
    foreach (array_merge($kids($root, 'InvoiceLine'), $kids($root, 'CreditNoteLine')) as $l) { $n = $txt($l, 'Item', 'Name'); if ($n !== '') $lines[] = $n; }
    return [
        'kind' => $kind, 'number' => $txt($root, 'ID'), 'date' => $txt($root, 'IssueDate'),
        'due' => $txt($root, 'DueDate') ?: $txt($root, 'PaymentMeans', 'PaymentDueDate'),
        'supplier' => [
            'name' => $txt($sup, 'PartyLegalEntity', 'RegistrationName') ?: $txt($sup, 'PartyName', 'Name'),
            'vat' => $txt($sup, 'PartyTaxScheme', 'CompanyID'),
            'endpoint' => $ep ? $ep->getAttribute('schemeID') . ':' . trim($ep->textContent) : '',
            'street' => $txt($sup, 'PostalAddress', 'StreetName'), 'city' => $txt($sup, 'PostalAddress', 'CityName'),
            'zip' => $txt($sup, 'PostalAddress', 'PostalZone'), 'country' => $txt($sup, 'PostalAddress', 'Country', 'IdentificationCode'),
            'email' => $txt($sup, 'Contact', 'ElectronicMail'),
        ],
        'base' => $num($txt($root, 'LegalMonetaryTotal', 'TaxExclusiveAmount')) * $sign,
        'tax' => $tax * $sign,
        'total' => $num($txt($root, 'LegalMonetaryTotal', 'TaxInclusiveAmount')) * $sign,
        'lines' => $lines, 'attachments' => $atts,
        'vatLines' => array_map(fn($st) => ['rate' => $num($txt($st, 'TaxCategory', 'Percent')), 'amount' => round($num($txt($st, 'TaxAmount')) * $sign, 2)],
            array_merge(...array_map(fn($t) => $kids($t, 'TaxSubtotal'), $kids($root, 'TaxTotal')) ?: [[]])),
        'iban' => preg_replace('/\s+/', '', $txt($root, 'PaymentMeans', 'PayeeFinancialAccount', 'ID')),
        'bic' => $txt($root, 'PaymentMeans', 'PayeeFinancialAccount', 'FinancialInstitutionBranch', 'ID'),
        'payId' => $txt($root, 'PaymentMeans', 'PaymentID'),
    ];
}

function store_file(string $name, string $mime, string $data, ?int $uid): int {
    $name = preg_replace('/[\x00-\x1f\/\\\\]/', '_', $name);
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION)) ?: 'bin';
    if (!in_array($ext, ['pdf', 'xml', 'jpg', 'jpeg', 'png'], true)) { $ext = 'pdf'; $name .= '.pdf'; }
    $dir = date('Y/m');
    if (!is_dir(__DIR__ . "/uploads/$dir")) mkdir(__DIR__ . "/uploads/$dir", 0755, true);
    $rel = "$dir/" . bin2hex(random_bytes(16)) . ".$ext";
    if (file_put_contents(__DIR__ . "/uploads/$rel", $data) === false) throw new RuntimeException('Impossible d\'enregistrer le fichier (droits du dossier uploads ?)');
    q('INSERT INTO files (company_id, project_id, name, mime, size, path, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)', [cid(), null, $name, $mime, strlen($data), $rel, $uid, now()]);
    return (int)db()->lastInsertId();
}

function insert_item(string $type, array $data, ?int $uid, ?int $pid = null): int {
    q('INSERT INTO items (company_id, type, project_id, parent_id, number, data, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
      [cid(), $type, $pid, null, null, json_encode($data, JSON_UNESCAPED_UNICODE), $uid, $uid, now(), now()]);
    return (int)db()->lastInsertId();
}

// Crée l'achat (et le fournisseur s'il est inconnu) à partir d'un document Peppol reçu
function pap_import(string $msgId, string $xml, ?int $uid): array {
    $xmlId = store_file("peppol-$msgId.xml", 'application/xml', $xml, $uid);
    try { $u = ubl_parse($xml); } catch (Throwable $e) {
        $id = insert_item('expense', ['desc' => 'Document Peppol à vérifier (' . $e->getMessage() . ')', 'category' => 'mat', 'date' => date('Y-m-d'), 'amount' => 0, 'vat' => 0, 'paid' => false,
            'fileId' => $xmlId, 'fileName' => "peppol-$msgId.xml", 'peppol' => true, 'peppolMsg' => $msgId, 'toCheck' => true], $uid);
        return ['id' => $id, 'label' => 'Document à vérifier'];
    }
    $digits = fn($v) => ltrim(preg_replace('/\D/', '', (string)$v), '0');
    $sup = null;
    foreach (q("SELECT id, data FROM items WHERE company_id = ? AND type = 'contact'", [cid()])->fetchAll() as $c) {
        $d = json_decode($c['data'], true) ?: [];
        if (($u['supplier']['vat'] !== '' && strlen($digits($u['supplier']['vat'])) >= 8 && $digits($d['vat'] ?? '') === $digits($u['supplier']['vat']))
            || ($u['supplier']['endpoint'] !== '' && ($d['peppolId'] ?? '') === $u['supplier']['endpoint'])) { $sup = (int)$c['id']; break; }
    }
    if (!$sup) {
        $s = $u['supplier'];
        $sup = insert_item('contact', ['kind' => 'fournisseur', 'company' => $s['name'] ?: 'Fournisseur Peppol', 'vat' => $s['vat'], 'peppolId' => $s['endpoint'],
            'address' => $s['street'], 'zip' => $s['zip'], 'city' => $s['city'], 'country' => $s['country'], 'email' => $s['email']], $uid);
    }
    $fileId = $xmlId; $fileName = "peppol-$msgId.xml";
    $att = null;
    foreach ($u['attachments'] as $a) if (stripos($a['mime'], 'pdf') !== false) { $att = $a; break; }
    $att = $att ?? ($u['attachments'][0] ?? null);
    if ($att && $att['data'] !== '' && $att['data'] !== false) {
        $fileName = preg_match('/\.\w+$/', $att['name']) ? $att['name'] : $att['name'] . '.pdf';
        $fileId = store_file($fileName, $att['mime'], $att['data'], $uid);
    }
    $co = setting('company', []) ?: [];
    $rates = is_array($co['vatRates'] ?? null) && $co['vatRates'] ? array_map('floatval', $co['vatRates']) : [21, 12, 6, 0];
    $rate = $u['base'] ? round($u['tax'] / $u['base'] * 100, 2) : 0;
    $near = $rates[0];
    foreach ($rates as $r) if (abs($r - $rate) < abs($near - $rate)) $near = $r;
    $label = ($u['kind'] === 'CreditNote' ? 'Note de crédit ' : 'Facture ') . $u['number'];
    $id = insert_item('expense', [
        'desc' => $label . ($u['lines'] ? ' – ' . $u['lines'][0] : ''), 'supplierId' => $sup, 'category' => 'mat',
        'date' => $u['date'] ?: date('Y-m-d'), 'due' => $u['due'], 'ref' => $u['number'],
        'amount' => round($u['base'], 2), 'vat' => abs($near - $rate) < 0.3 ? $near : $rate, 'vatAmount' => round($u['tax'], 2), 'paid' => false,
        'fileId' => $fileId, 'fileName' => $fileName, 'xmlFileId' => $xmlId, 'peppol' => true, 'peppolMsg' => $msgId, 'toCheck' => true,
        'status' => 'avalider', 'source' => 'peppol', 'ttc' => round($u['total'], 2),
        'vatLines' => $u['vatLines'] ?: [['rate' => abs($near - $rate) < 0.3 ? $near : $rate, 'amount' => round($u['tax'], 2)]],
        'iban' => $u['iban'], 'bic' => $u['bic'], 'communication' => preg_replace('/\D/', '', $u['payId']) !== '' && strlen(preg_replace('/\D/', '', $u['payId'])) === 12 ? preg_replace('/\D/', '', $u['payId']) : $u['payId'],
        'structured' => strlen(preg_replace('/\D/', '', $u['payId'])) === 12,
    ], $uid);
    return ['id' => $id, 'label' => $label . ' – ' . $u['supplier']['name']];
}

// Relève la boîte de réception du point d'accès ; renvoie les achats créés
function pap_sync(?int $uid): array {
    pap_cfg();
    if ((int)q('SELECT GET_LOCK(?, 0)', ['batipro_peppol_' . cid()])->fetchColumn() !== 1) return ['created' => [], 'busy' => true];
    $created = []; $errors = [];
    try {
        for ($page = 1; $page <= 5; $page++) {
            $list = pap_req('GET', 'message/list?folder=INBOX&confirmed=false&perPage=100&page=' . $page);
            $items = $list['items'] ?? [];
            foreach ($items as $m) {
                $id = (string)($m['id'] ?? '');
                if ($id === '' || !preg_match('/^[A-Za-z0-9_\-]{1,80}$/', $id)) continue;
                try {
                    $exists = q("SELECT id FROM items WHERE company_id = ? AND type = 'expense' AND data LIKE ?", [cid(), '%"peppolMsg":"' . $id . '"%'])->fetch();
                    if (!$exists) {
                        $full = pap_req('GET', 'message/' . rawurlencode($id));
                        $xml = base64_decode((string)($full['fileContent'] ?? ''), true);
                        if ($xml === false || $xml === '') throw new RuntimeException('message vide');
                        $created[] = pap_import($id, $xml, $uid);
                    }
                    pap_req('PATCH', 'message/' . rawurlencode($id) . '/confirm');
                } catch (Throwable $e) { $errors[] = "$id : " . $e->getMessage(); }
            }
            $pages = (int)($list['meta']['pages'] ?? 1);
            if ($page >= $pages || !$items) break;
        }
    } finally {
        set_setting('peppol_sync', ['at' => now(), 'created' => count($created), 'errors' => array_slice($errors, 0, 5)]);
        q('SELECT RELEASE_LOCK(?)', ['batipro_peppol_' . cid()]);
    }
    return ['created' => $created, 'errors' => $errors];
}
