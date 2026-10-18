<?php
// Assistant IA (Claude) : devis, calculs de matériaux et de prix, commandes, emails de demande de prix, questions techniques.
// Il crée des brouillons (devis, commandes, emails) mais n'envoie jamais rien lui-même.
declare(strict_types=1);

use Anthropic\Beta\Messages\BetaBase64ImageSource;
use Anthropic\Beta\Messages\BetaImageBlockParam;
use Anthropic\Beta\Messages\BetaMessage;
use Anthropic\Beta\Messages\BetaWebSearchTool20260209;
use Anthropic\Client;

const AI_MODEL = 'claude-opus-5-5';
const AI_MAX_STEPS = 10;

function ai_ready(): bool {
    return PHP_VERSION_ID >= 80100 && is_file(__DIR__ . '/vendor/autoload.php') && ai_key() !== '';
}

// Clé de la firme, sinon celle de la plateforme (firme 1)
function ai_key(): string {
    $own = setting('ai', []) ?: [];
    if (!empty($own['key'])) return (string)$own['key'];
    if (cid() !== 1) { $pf = setting('ai', [], 1) ?: []; if (!empty($pf['key']) && empty($pf['ownOnly'])) return (string)$pf['key']; }
    return '';
}

// Adresse de l'API (réglage technique facultatif : proxy d'entreprise ou tests)
function ai_base_url(): ?string {
    $own = setting('ai', []) ?: [];
    $u = (string)($own['baseUrl'] ?? '') ?: (cid() !== 1 ? (string)((setting('ai', [], 1) ?: [])['baseUrl'] ?? '') : '');
    return preg_match('#^https?://#', $u) ? $u : null;
}

function ai_system(array $me): string {
    $co = setting('company', []) ?: [];
    $rates = implode(', ', array_map(fn($r) => "$r %", $co['vatRates'] ?? [21, 12, 6, 0]));
    return <<<TXT
Tu es l'assistant intégré à BâtiPro, le logiciel de gestion de l'entreprise de construction « {$co['name']} » ({$co['country']}). Tu travailles pour {$me['name']}.

Ce que tu fais :
- Calculs de quantités de matériaux (surfaces, volumes, nombre de blocs, sacs, m³ de béton, chutes et pertes) et de prix (déboursé, marge, prix de vente, TVA). Montre le calcul de façon courte et vérifiable, avec les hypothèses.
- Préparation de devis : utilise d'abord les articles de la bibliothèque de l'entreprise (search_catalog) pour les prix ; si un prix manque, propose une estimation clairement indiquée comme telle (« prix estimé – à vérifier »). Structure en chapitres. Crée le devis avec create_quote seulement quand l'utilisateur le demande ou le confirme.
- Commandes fournisseurs et demandes de prix : trouve le fournisseur (search_contacts), crée la commande avec create_order si demandé, et rédige l'email avec draft_email (il sera relu et envoyé par l'utilisateur).
- Photos : quand l'utilisateur joint des photos (pièce à rénover, façade, toiture, dégâts…), décris brièvement ce que tu vois (surfaces, matériaux, état, éléments à démonter) et déduis-en les postes de travaux. Sans dimensions données, estime-les d'après les repères visibles (portes ≈ 2,10 m, carrelage, prises…), écris clairement les quantités supposées et ajoute dans le devis une ligne texte « Quantités estimées d'après photos – à vérifier sur place ». Si l'utilisateur demande le devis, crée-le quand même avec ces estimations plutôt que de bloquer, puis indique quelles mesures prendre pour l'ajuster.
- Client : quand un client est nommé (« la cliente Diana »), retrouve-le avec search_contacts et utilise son id dans le devis ; s'il y a plusieurs résultats possibles, demande lequel.
- Questions techniques de construction (mise en œuvre, normes et bonnes pratiques belges, PEB, dosages, temps de séchage, épaisseurs, ordre des travaux).
- Tu peux chercher sur le web (prix publics, fiches techniques) quand c'est utile ; cite la source.

Règles :
- Réponds dans la langue de l'utilisateur (souvent roumain ou français). Les documents (devis, commandes, emails aux fournisseurs et clients) sont rédigés en français, sauf demande contraire.
- Taux de TVA disponibles : {$rates}. En Belgique, 6 % pour la rénovation de logements privés de plus de 10 ans (avec attestation), 21 % sinon ; autoliquidation entre entrepreneurs enregistrés.
- Tu ne fais qu'utiliser les outils fournis : tu n'envoies jamais d'email et tu ne modifies jamais un document existant. Tout ce que tu crées est un brouillon que l'utilisateur vérifie.
- S'il manque une information importante (dimensions, client, fournisseur, quantités), pose une question courte au lieu d'inventer.
- Sois concis. Mets les montants au format 1.234,56 €.
TXT;
}

function ai_tools(): array {
    $line = [
        'type' => 'object',
        'properties' => [
            'kind' => ['type' => 'string', 'enum' => ['chapter', 'subchapter', 'item', 'text'], 'description' => 'chapter/subchapter = titre de section, item = ligne chiffrée, text = commentaire'],
            'desc' => ['type' => 'string', 'description' => 'Désignation (et description éventuelle sur les lignes suivantes)'],
            'unit' => ['type' => 'string', 'description' => 'm², m³, m, h, u, forfait, kg, sac…'],
            'qty' => ['type' => 'number'],
            'price' => ['type' => 'number', 'description' => 'Prix de vente unitaire HT'],
            'cost' => ['type' => 'number', 'description' => 'Déboursé unitaire HT (coût), si connu'],
            'vat' => ['type' => 'number', 'description' => 'Taux de TVA en %'],
            'type' => ['type' => 'string', 'enum' => ['mo', 'mat', 'materiel', 'st', 'divers'], 'description' => "mo = main d'œuvre, mat = matériaux, materiel = matériel, st = sous-traitance"],
            'articleId' => ['type' => 'integer', 'description' => 'Id de l\'article de la bibliothèque, si la ligne en vient'],
        ],
        'required' => ['kind', 'desc'],
    ];
    return [
        ['name' => 'search_catalog', 'description' => "Cherche dans la bibliothèque de prix de l'entreprise (articles, matériaux, main d'œuvre, ouvrages). Renvoie id, désignation, unité, déboursé et prix de vente HT, TVA, fournisseur. Chaîne vide = premiers articles.",
            'inputSchema' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string'], 'limit' => ['type' => 'integer']], 'required' => ['query']]],
        ['name' => 'search_contacts', 'description' => 'Cherche des contacts (clients, fournisseurs, sous-traitants, architectes) par nom, société, métier ou ville. Renvoie id, nom, type, métier, email, téléphone.',
            'inputSchema' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string'], 'kind' => ['type' => 'string', 'enum' => ['client', 'prospect', 'fournisseur', 'soustraitant', 'architecte', 'autre']]], 'required' => ['query']]],
        ['name' => 'list_projects', 'description' => 'Liste les chantiers (id, numéro, nom, adresse, statut, client). Filtre facultatif sur le nom, le client ou la localité.',
            'inputSchema' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string']]]],
        ['name' => 'get_project', 'description' => 'Détails d\'un chantier : adresse, client, budget (devis acceptés), coûts réels (achats, heures), devis et commandes liés.',
            'inputSchema' => ['type' => 'object', 'properties' => ['id' => ['type' => 'integer']], 'required' => ['id']]],
        ['name' => 'get_quote', 'description' => 'Lit un devis (par id ou numéro, ex. DEV-2026-0012) : client, chantier, lignes, totaux.',
            'inputSchema' => ['type' => 'object', 'properties' => ['id' => ['type' => 'integer'], 'number' => ['type' => 'string']]]],
        ['name' => 'create_quote', 'description' => 'Crée un NOUVEAU devis en brouillon (jamais envoyé). À utiliser quand l\'utilisateur demande ou confirme la création. Renvoie le numéro et le lien.',
            'inputSchema' => ['type' => 'object', 'properties' => [
                'title' => ['type' => 'string'], 'clientId' => ['type' => 'integer'], 'projectId' => ['type' => 'integer'],
                'intro' => ['type' => 'string', 'description' => 'Texte d\'introduction facultatif'],
                'lines' => ['type' => 'array', 'items' => $line]], 'required' => ['title', 'lines']]],
        ['name' => 'create_order', 'description' => 'Crée une commande fournisseur ou sous-traitant en brouillon (jamais envoyée). Renvoie le numéro et le lien.',
            'inputSchema' => ['type' => 'object', 'properties' => [
                'supplierId' => ['type' => 'integer'], 'projectId' => ['type' => 'integer'], 'deliveryDate' => ['type' => 'string', 'description' => 'AAAA-MM-JJ'],
                'notes' => ['type' => 'string'],
                'lines' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['desc' => ['type' => 'string'], 'unit' => ['type' => 'string'], 'qty' => ['type' => 'number'], 'price' => ['type' => 'number', 'description' => 'Prix unitaire HT convenu ou estimé (0 si inconnu)'], 'vat' => ['type' => 'number']], 'required' => ['desc', 'qty']]]],
                'required' => ['supplierId', 'lines']]],
        ['name' => 'draft_email', 'description' => "Prépare un email (demande de prix, commande, relance, envoi d'informations au client…). L'utilisateur le relit, peut le modifier et l'envoie lui-même : il n'est PAS envoyé.",
            'inputSchema' => ['type' => 'object', 'properties' => [
                'to' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['name' => ['type' => 'string'], 'email' => ['type' => 'string'], 'contactId' => ['type' => 'integer']], 'required' => ['email']]],
                'subject' => ['type' => 'string'], 'body' => ['type' => 'string'], 'projectId' => ['type' => 'integer']], 'required' => ['to', 'subject', 'body']]],
        BetaWebSearchTool20260209::with(maxUses: 4),
    ];
}

// ---------------------------------------------------------------- Outils (toujours limités à la firme courante)
function ai_items(string $type, ?int $pid = null): array {
    $sql = 'SELECT id, project_id, number, data FROM items WHERE company_id = ? AND type = ?'; $a = [cid(), $type];
    if ($pid) { $sql .= ' AND project_id = ?'; $a[] = $pid; }
    return array_map(fn($r) => ['id' => (int)$r['id'], 'project_id' => $r['project_id'] !== null ? (int)$r['project_id'] : null, 'number' => $r['number'], 'd' => json_decode($r['data'], true) ?: []], q($sql . ' ORDER BY id', $a)->fetchAll());
}
function ai_match(string $hay, string $q): bool {
    $norm = fn($s) => mb_strtolower(trim(preg_replace('/\s+/', ' ', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string)$s) ?: (string)$s)));
    $h = $norm($hay);
    foreach (preg_split('/\s+/', $norm($q)) as $w) if ($w !== '' && !str_contains($h, $w)) return false;
    return true;
}
function ai_contact_name(?array $c): string {
    if (!$c) return '';
    $d = $c['d'];
    return (string)(($d['company'] ?? '') ?: trim(($d['firstname'] ?? '') . ' ' . ($d['name'] ?? '')));
}
function ai_article_cost(array $a, array $all, int $depth = 0): float {
    $d = $a['d'];
    if (($d['kind'] ?? '') !== 'ouvrage' || $depth > 4) return (float)($d['cost'] ?? 0);
    $cost = 0.0;
    foreach ($d['components'] ?? [] as $c) {
        foreach ($all as $s) if ($s['id'] === (int)($c['articleId'] ?? 0)) { $cost += ai_article_cost($s, $all, $depth + 1) * (float)($c['qty'] ?? 0); break; }
    }
    return round($cost, 4);
}
function ai_totals(array $lines, float $discount = 0): array {
    $base = 0.0; $vat = 0.0;
    foreach ($lines as $l) {
        if (($l['kind'] ?? 'item') !== 'item' || !empty($l['option'])) continue;
        $t = (float)($l['qty'] ?? 0) * (float)($l['price'] ?? 0);
        $base += $t; $vat += $t * (float)($l['vat'] ?? 0) / 100;
    }
    $k = 1 - $discount / 100;
    return ['ht' => round($base * $k, 2), 'tva' => round($vat * $k, 2), 'ttc' => round(($base + $vat) * $k, 2)];
}
function ai_lid(): string { return substr(bin2hex(random_bytes(5)), 0, 8); }

function ai_run_tool(string $name, array $in, array $me, array &$actions): array {
    switch ($name) {
        case 'search_catalog': {
            $all = ai_items('article');
            $q = (string)($in['query'] ?? '');
            $out = [];
            foreach ($all as $a) {
                $d = $a['d'];
                if ($q !== '' && !ai_match(implode(' ', [$d['name'] ?? '', $d['code'] ?? '', $d['category'] ?? '', $d['desc'] ?? '']), $q)) continue;
                $cost = ai_article_cost($a, $all);
                $price = ($d['priceMode'] ?? '') === 'fixed' && (float)($d['price'] ?? 0) ? (float)$d['price'] : round($cost * (1 + (float)($d['margin'] ?? 0) / 100), 2);
                $out[] = ['id' => $a['id'], 'name' => $d['name'] ?? '', 'code' => $d['code'] ?? '', 'kind' => $d['kind'] ?? '', 'unit' => $d['unit'] ?? 'u', 'cost' => $cost, 'price' => $price,
                    'vat' => ($d['vat'] ?? '') === '' ? null : (float)$d['vat'], 'category' => $d['category'] ?? '', 'supplierId' => $d['supplierId'] ?? null];
                if (count($out) >= min(60, max(1, (int)($in['limit'] ?? 25)))) break;
            }
            return ['count' => count($out), 'articles' => $out];
        }
        case 'search_contacts': {
            $out = [];
            foreach (ai_items('contact') as $c) {
                $d = $c['d'];
                if (!empty($in['kind']) && ($d['kind'] ?? '') !== $in['kind']) continue;
                if (!ai_match(implode(' ', [$d['company'] ?? '', $d['firstname'] ?? '', $d['name'] ?? '', $d['trade'] ?? '', $d['city'] ?? '', $d['email'] ?? '']), (string)($in['query'] ?? ''))) continue;
                $out[] = ['id' => $c['id'], 'name' => ai_contact_name($c), 'kind' => $d['kind'] ?? '', 'trade' => $d['trade'] ?? '', 'email' => $d['email'] ?? '', 'phone' => ($d['phone'] ?? '') ?: ($d['mobile'] ?? ''), 'city' => $d['city'] ?? '', 'vat' => $d['vat'] ?? ''];
                if (count($out) >= 30) break;
            }
            return ['count' => count($out), 'contacts' => $out];
        }
        case 'list_projects': {
            $contacts = ai_items('contact'); $out = [];
            foreach (ai_items('project') as $p) {
                $d = $p['d']; $cl = null;
                foreach ($contacts as $c) if ($c['id'] === (int)($d['clientId'] ?? 0)) { $cl = $c; break; }
                if (!empty($in['query']) && !ai_match(implode(' ', [$p['number'], $d['name'] ?? '', $d['city'] ?? '', $d['address'] ?? '', ai_contact_name($cl)]), (string)$in['query'])) continue;
                $out[] = ['id' => $p['id'], 'number' => $p['number'], 'name' => $d['name'] ?? '', 'address' => trim(($d['address'] ?? '') . ' ' . ($d['zip'] ?? '') . ' ' . ($d['city'] ?? '')), 'status' => $d['status'] ?? '', 'client' => ai_contact_name($cl), 'clientId' => $cl['id'] ?? null];
            }
            return ['count' => count($out), 'projects' => array_slice($out, 0, 50)];
        }
        case 'get_project': {
            $pid = (int)($in['id'] ?? 0);
            $p = q("SELECT id, number, data FROM items WHERE company_id = ? AND type = 'project' AND id = ?", [cid(), $pid])->fetch();
            if (!$p) return ['error' => 'Chantier introuvable'];
            $d = json_decode($p['data'], true) ?: [];
            $quotes = array_map(fn($x) => ['id' => $x['id'], 'number' => $x['number'], 'title' => $x['d']['title'] ?? '', 'status' => $x['d']['status'] ?? '', 'totals' => ai_totals($x['d']['lines'] ?? [], (float)($x['d']['discount'] ?? 0))], ai_items('quote', $pid));
            $orders = array_map(fn($x) => ['id' => $x['id'], 'number' => $x['number'], 'status' => $x['d']['status'] ?? '', 'supplierId' => $x['d']['supplierId'] ?? null, 'totals' => ai_totals($x['d']['lines'] ?? [])], ai_items('order', $pid));
            $spent = 0.0;
            foreach (ai_items('expense') as $e) {
                $alloc = $e['d']['alloc'] ?? null;
                if (is_array($alloc) && $alloc) { foreach ($alloc as $x) if ((int)($x['pid'] ?? 0) === $pid) $spent += (float)$x['amount']; }
                elseif ($e['project_id'] === $pid) $spent += (float)($e['d']['amount'] ?? 0);
            }
            $hours = 0.0; $labour = 0.0;
            foreach (ai_items('timesheet', $pid) as $t) { $hours += (float)($t['d']['hours'] ?? 0); $labour += (float)($t['d']['hours'] ?? 0) * (float)($t['d']['rate'] ?? 0); }
            return ['id' => (int)$p['id'], 'number' => $p['number'], 'name' => $d['name'] ?? '', 'address' => trim(($d['address'] ?? '') . ' ' . ($d['zip'] ?? '') . ' ' . ($d['city'] ?? '')),
                'status' => $d['status'] ?? '', 'clientId' => $d['clientId'] ?? null, 'description' => $d['desc'] ?? ($d['notes'] ?? ''), 'start' => $d['start'] ?? null, 'end' => $d['end'] ?? null,
                'quotes' => $quotes, 'orders' => $orders, 'purchases_ht' => round($spent, 2), 'hours' => $hours, 'labour_cost' => round($labour, 2)];
        }
        case 'get_quote': {
            $r = !empty($in['id']) ? q("SELECT * FROM items WHERE company_id = ? AND type = 'quote' AND id = ?", [cid(), (int)$in['id']])->fetch()
                : q("SELECT * FROM items WHERE company_id = ? AND type = 'quote' AND number = ?", [cid(), (string)($in['number'] ?? '')])->fetch();
            if (!$r) return ['error' => 'Devis introuvable'];
            $d = json_decode($r['data'], true) ?: [];
            $lines = array_map(fn($l) => array_intersect_key($l, array_flip(['kind', 'level', 'desc', 'unit', 'qty', 'price', 'cost', 'vat', 'type', 'option'])), $d['lines'] ?? []);
            return ['id' => (int)$r['id'], 'number' => $r['number'], 'title' => $d['title'] ?? '', 'status' => $d['status'] ?? '', 'clientId' => $d['clientId'] ?? null, 'projectId' => $r['project_id'] !== null ? (int)$r['project_id'] : null,
                'discount' => $d['discount'] ?? 0, 'lines' => $lines, 'totals' => ai_totals($d['lines'] ?? [], (float)($d['discount'] ?? 0))];
        }
        case 'create_quote': {
            $co = setting('company', []) ?: [];
            $defVat = (float)($co['defaultVat'] ?? 21);
            $lines = [];
            foreach ($in['lines'] ?? [] as $l) {
                $k = $l['kind'] ?? 'item';
                if ($k === 'chapter') $lines[] = ['id' => ai_lid(), 'kind' => 'title', 'desc' => (string)$l['desc']];
                elseif ($k === 'subchapter') $lines[] = ['id' => ai_lid(), 'kind' => 'title', 'level' => 2, 'desc' => (string)$l['desc']];
                elseif ($k === 'text') $lines[] = ['id' => ai_lid(), 'kind' => 'text', 'desc' => (string)$l['desc']];
                else $lines[] = array_filter(['id' => ai_lid(), 'kind' => 'item', 'desc' => (string)$l['desc'], 'unit' => (string)($l['unit'] ?? 'u'), 'qty' => (float)($l['qty'] ?? 1),
                    'cost' => isset($l['cost']) ? (float)$l['cost'] : '', 'price' => round((float)($l['price'] ?? 0), 2), 'vat' => isset($l['vat']) ? (float)$l['vat'] : $defVat,
                    'type' => in_array($l['type'] ?? '', ['mo', 'mat', 'materiel', 'st', 'divers'], true) ? $l['type'] : 'divers', 'articleId' => isset($l['articleId']) ? (int)$l['articleId'] : null], fn($v) => $v !== null);
            }
            if (!$lines) return ['error' => 'Aucune ligne'];
            $pid = !empty($in['projectId']) && q("SELECT id FROM items WHERE company_id = ? AND type = 'project' AND id = ?", [cid(), (int)$in['projectId']])->fetch() ? (int)$in['projectId'] : null;
            $client = !empty($in['clientId']) && q("SELECT id FROM items WHERE company_id = ? AND type = 'contact' AND id = ?", [cid(), (int)$in['clientId']])->fetch() ? (int)$in['clientId'] : null;
            $data = ['status' => 'brouillon', 'date' => date('Y-m-d'), 'valid' => date('Y-m-d', strtotime('+' . ((int)($co['quoteValidity'] ?? 0) ?: 30) . ' days')), 'ownerId' => $me['id'],
                'title' => (string)$in['title'], 'clientId' => $client, 'intro' => (string)($in['intro'] ?? ''), 'lines' => $lines, 'discount' => 0, 'reverse' => false, 'notes' => (string)($co['quoteNotes'] ?? ''), 'byAI' => true];
            db()->beginTransaction();
            $number = make_number('quote');
            q('INSERT INTO items (company_id, type, project_id, parent_id, number, data, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
              [cid(), 'quote', $pid, null, $number, json_encode($data, JSON_UNESCAPED_UNICODE), $me['id'], $me['id'], now(), now()]);
            $id = (int)db()->lastInsertId();
            db()->commit();
            log_activity($me['id'], 'create', 'quote', $id, $pid, $data['title'] . ' (assistant IA)');
            $t = ai_totals($lines);
            $actions[] = ['type' => 'quote', 'id' => $id, 'number' => $number, 'title' => $data['title'], 'total' => $t['ht'], 'link' => "#/quote/$id"];
            return ['ok' => true, 'id' => $id, 'number' => $number, 'totals' => $t, 'note' => 'Brouillon créé ; l\'utilisateur peut l\'ouvrir avec le bouton affiché.'];
        }
        case 'create_order': {
            $sup = q("SELECT id, data FROM items WHERE company_id = ? AND type = 'contact' AND id = ?", [cid(), (int)($in['supplierId'] ?? 0)])->fetch();
            if (!$sup) return ['error' => 'Fournisseur introuvable : cherchez-le avec search_contacts'];
            $sd = json_decode($sup['data'], true) ?: [];
            $defVat = (float)((setting('company', []) ?: [])['defaultVat'] ?? 21);
            $lines = array_map(fn($l) => ['id' => ai_lid(), 'kind' => 'item', 'desc' => (string)($l['desc'] ?? ''), 'unit' => (string)($l['unit'] ?? 'u'), 'qty' => (float)($l['qty'] ?? 1),
                'price' => round((float)($l['price'] ?? 0), 2), 'vat' => isset($l['vat']) ? (float)$l['vat'] : $defVat, 'type' => 'mat'], $in['lines'] ?? []);
            if (!$lines) return ['error' => 'Aucune ligne'];
            $pid = !empty($in['projectId']) && q("SELECT id FROM items WHERE company_id = ? AND type = 'project' AND id = ?", [cid(), (int)$in['projectId']])->fetch() ? (int)$in['projectId'] : null;
            $data = ['kind' => ($sd['kind'] ?? '') === 'soustraitant' ? 'soustraitant' : 'fournisseur', 'supplierId' => (int)$sup['id'], 'status' => 'brouillon', 'date' => date('Y-m-d'),
                'deliveryDate' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($in['deliveryDate'] ?? '')) ? $in['deliveryDate'] : '', 'notes' => (string)($in['notes'] ?? ''), 'lines' => $lines, 'byAI' => true];
            db()->beginTransaction();
            $number = make_number('order');
            q('INSERT INTO items (company_id, type, project_id, parent_id, number, data, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?,?)',
              [cid(), 'order', $pid, null, $number, json_encode($data, JSON_UNESCAPED_UNICODE), $me['id'], $me['id'], now(), now()]);
            $id = (int)db()->lastInsertId();
            db()->commit();
            log_activity($me['id'], 'create', 'order', $id, $pid, 'Commande ' . ai_contact_name(['d' => $sd]) . ' (assistant IA)');
            $actions[] = ['type' => 'order', 'id' => $id, 'number' => $number, 'title' => ai_contact_name(['d' => $sd]), 'total' => ai_totals($lines)['ht'], 'link' => "#/order/$id"];
            return ['ok' => true, 'id' => $id, 'number' => $number, 'totals' => ai_totals($lines)];
        }
        case 'draft_email': {
            $to = [];
            foreach ($in['to'] ?? [] as $r) {
                $e = mb_strtolower(trim((string)($r['email'] ?? '')));
                if (filter_var($e, FILTER_VALIDATE_EMAIL)) $to[] = ['email' => $e, 'name' => (string)($r['name'] ?? ''), 'contactId' => isset($r['contactId']) ? (int)$r['contactId'] : null];
            }
            $actions[] = ['type' => 'email', 'to' => $to, 'subject' => (string)($in['subject'] ?? ''), 'body' => (string)($in['body'] ?? ''), 'projectId' => isset($in['projectId']) ? (int)$in['projectId'] : null];
            return ['ok' => true, 'note' => count($to) ? 'Email préparé : l\'utilisateur le relit et l\'envoie.' : 'Email préparé sans adresse valide : l\'utilisateur devra saisir le destinataire.'];
        }
    }
    return ['error' => "Outil inconnu : $name"];
}

// ---------------------------------------------------------------- Conversation (une par fil, propre à l'utilisateur ; l'historique n'est jamais réécrit)
function ai_conv_load(int $id, array $me): ?array {
    $r = q('SELECT * FROM ai_convs WHERE id = ? AND company_id = ? AND user_id = ?', [$id, cid(), $me['id']])->fetch();
    if (!$r) return null;
    return ['id' => (int)$r['id'], 'title' => $r['title'], 'turns' => json_decode($r['turns'], true) ?: []];
}

// Contenu d'un message utilisateur avec photos : les photos sont gardées comme fichiers et relues à l'identique à chaque envoi
function ai_user_content(array $blocks): array {
    $out = [];
    foreach ($blocks as $b) {
        if (($b['type'] ?? '') === 'img') {
            $f = q('SELECT path, mime FROM files WHERE id = ? AND company_id = ?', [(int)$b['fileId'], cid()])->fetch();
            $raw = $f ? @file_get_contents(__DIR__ . '/uploads/' . $f['path']) : false;
            $out[] = $raw !== false && $raw !== ''
                ? BetaImageBlockParam::with(source: BetaBase64ImageSource::with(data: base64_encode($raw), mediaType: $f['mime']))
                : ['type' => 'text', 'text' => '[photo indisponible]'];
        } else $out[] = $b;
    }
    return $out;
}

function ai_messages(array $turns): array {
    $out = [];
    foreach ($turns as $t) {
        if ($t['role'] === 'assistant') $out[] = ['role' => 'assistant', 'content' => BetaMessage::fromArray($t['msg'])->content];
        elseif (!empty($t['photos'])) $out[] = ['role' => 'user', 'content' => ai_user_content($t['content'])];
        else $out[] = ['role' => 'user', 'content' => $t['content']];
    }
    return $out;
}

function ai_chat(array $me, ?int $convId, string $text, array $ctx, array $photos = []): array {
    require_once __DIR__ . '/vendor/autoload.php';
    @set_time_limit(300);
    $conv = $convId ? ai_conv_load($convId, $me) : null;
    if ($convId && !$conv) fail(404, 'Conversation introuvable');
    $turns = $conv['turns'] ?? [];
    $note = [];
    if (!empty($ctx['page'])) $note[] = 'Page ouverte : ' . mb_substr((string)$ctx['page'], 0, 120);
    if (!empty($ctx['label'])) $note[] = 'Élément affiché : ' . mb_substr((string)$ctx['label'], 0, 200);
    $full = $text . ($note ? "\n\n[Contexte : " . implode(' · ', $note) . ' · date du jour ' . date('Y-m-d') . ']' : '');
    $turns[] = $photos
        ? ['role' => 'user', 'photos' => true, 'content' => array_merge(array_map(fn($id) => ['type' => 'img', 'fileId' => $id], $photos), [['type' => 'text', 'text' => $full]])]
        : ['role' => 'user', 'content' => $full];

    $client = new Client(apiKey: ai_key(), baseUrl: ai_base_url());
    $actions = []; $steps = [];
    for ($i = 0; $i < AI_MAX_STEPS; $i++) {
        $resp = $client->beta->messages->create(
            maxTokens: 16000,
            messages: ai_messages($turns),
            model: AI_MODEL,
            cacheControl: ['type' => 'ephemeral'],
            fallbacks: 'default',
            outputConfig: ['effort' => 'medium'],
            system: ai_system($me),
            tools: ai_tools(),
            betas: ['server-side-fallback-2026-07-01'],
        );
        $turns[] = ['role' => 'assistant', 'msg' => $resp->jsonSerialize()];
        if ($resp->stopReason === 'refusal') break;
        if ($resp->stopReason === 'pause_turn') continue; // recherche web longue : on relance tel quel
        if ($resp->stopReason !== 'tool_use') break;
        $results = [];
        foreach ($resp->content as $block) {
            if ($block->type !== 'tool_use') continue;
            $steps[] = $block->name;
            try { $res = ai_run_tool($block->name, is_array($block->input) ? $block->input : (array)$block->input, $me, $actions); }
            catch (Throwable $e) { $res = ['error' => $e->getMessage()]; }
            $results[] = ['type' => 'tool_result', 'toolUseID' => $block->id, 'content' => json_encode($res, JSON_UNESCAPED_UNICODE), 'isError' => isset($res['error'])];
        }
        $turns[] = ['role' => 'user', 'content' => $results];
    }
    $last = end($turns);
    $reply = '';
    if ($last['role'] === 'assistant') {
        $m = BetaMessage::fromArray($last['msg']);
        foreach ($m->content as $b) if ($b->type === 'text') $reply .= $b->text;
        if ($m->stopReason === 'refusal') $reply = $reply ?: "Je ne peux pas répondre à cette demande.";
        if ($m->stopReason === 'max_tokens') $reply .= "\n\n(réponse coupée : demandez la suite)";
    }
    if ($reply === '' && !$actions) $reply = 'Je n\'ai pas pu terminer : reformulez ou précisez la demande.';
    $display = ['actions' => $actions, 'steps' => array_values(array_unique($steps))];
    $turns[count($turns) - 1]['display'] = $display; // pour réafficher l'historique

    $title = $conv['title'] ?? mb_substr(trim(preg_replace('/\s+/', ' ', $text)), 0, 80);
    if ($conv) q('UPDATE ai_convs SET turns = ?, updated_at = ? WHERE id = ?', [json_encode($turns, JSON_UNESCAPED_UNICODE), now(), $conv['id']]);
    else {
        q('INSERT INTO ai_convs (company_id, user_id, title, turns, created_at, updated_at) VALUES (?,?,?,?,?,?)', [cid(), $me['id'], $title, json_encode($turns, JSON_UNESCAPED_UNICODE), now(), now()]);
        $convId = (int)db()->lastInsertId();
    }
    return ['conv_id' => $convId, 'title' => $title, 'reply' => $reply, 'actions' => $actions, 'steps' => $display['steps']];
}

// Historique lisible d'une conversation (questions, réponses et documents créés)
function ai_conv_view(array $conv): array {
    $out = [];
    foreach ($conv['turns'] as $t) {
        if ($t['role'] === 'user' && is_string($t['content'])) $out[] = ['role' => 'user', 'text' => preg_replace('/\n\n\[Contexte : [^\]]*\]$/u', '', $t['content'])];
        elseif ($t['role'] === 'user' && !empty($t['photos'])) {
            $txt = ''; $imgs = [];
            foreach ($t['content'] as $b) { if (($b['type'] ?? '') === 'img') $imgs[] = (int)$b['fileId']; elseif (($b['type'] ?? '') === 'text') $txt .= $b['text']; }
            $out[] = ['role' => 'user', 'text' => preg_replace('/\n\n\[Contexte : [^\]]*\]$/u', '', $txt), 'photos' => $imgs];
        }
        elseif ($t['role'] === 'assistant' && isset($t['display'])) {
            $txt = '';
            foreach ($t['msg']['content'] ?? [] as $b) if (($b['type'] ?? '') === 'text') $txt .= $b['text'];
            $out[] = ['role' => 'assistant', 'text' => $txt, 'actions' => $t['display']['actions'] ?? []];
        }
    }
    return $out;
}
