<?php
// PILOTAGE MADIBU – étape 5 : rôles, permissions (contrôlées côté serveur), journal d'audit, centre d'approbation.
// Principe : l'IA et les utilisateurs non habilités PRÉPARENT ; une action sensible ne s'exécute qu'après approbation,
// par un processus contrôlé et journalisé (approuver ≠ exécuter).
declare(strict_types=1);

// --------------------------------------------------------------------- Rôles du module (les rôles BatiPro existants ne changent pas)
const PIL_ROLES = [
    'owner' => ['Propriétaire (OWNER)', 'Accès complet ; seul à approuver les décisions sensibles.'],
    'admin' => ['Administrateur', 'Gestion opérationnelle : imports, classements, engagements, alertes ; exécute les actions approuvées.'],
    'finance' => ['Finance', 'Données financières, imports, rapprochements, prévisions, assistant.'],
    'accountant' => ['Comptable', 'Lecture des données bancaires et comptables, exports autorisés, journal d\'audit.'],
    'project_manager' => ['Chef de projet', 'Analyse financière de SES chantiers uniquement.'],
    'site_manager' => ['Chef de chantier', 'Aucun accès aux données financières du Pilotage (espace terrain BatiPro).'],
    'employee' => ['Employé', 'Aucun accès au Pilotage (ses tâches dans BatiPro).'],
    'none' => ['Aucun accès', 'Le module Pilotage est invisible.'],
];
// permission → rôles autorisés (tout ce qui n'est pas listé est refusé)
const PIL_PERMS = [
    'bank.read' => ['owner', 'admin', 'finance', 'accountant'],
    'bank.write' => ['owner', 'admin', 'finance'],
    'bank.pay' => ['owner'],                                     // paiement écrit directement dans une facture / un achat
    'treasury.read' => ['owner', 'admin', 'finance', 'accountant'],
    'commitments.write' => ['owner', 'admin', 'finance'],
    'hypotheses.write' => ['owner', 'finance'],
    'director.read' => ['owner', 'admin', 'finance'],
    'alerts.write' => ['owner', 'admin', 'finance'],
    'projects.read' => ['owner', 'admin', 'finance', 'project_manager'],
    'ai.ask' => ['owner', 'admin', 'finance'],
    'export' => ['owner', 'finance', 'accountant'],
    'audit.read' => ['owner', 'admin', 'accountant'],
    'approvals.request' => ['owner', 'admin', 'finance', 'accountant', 'project_manager'],
    'approvals.decide' => ['owner'],
    'approvals.execute' => ['owner', 'admin'],
    'roles.manage' => ['owner'],
    'settings.write' => ['owner'],
    'mail.use' => ['owner', 'admin', 'finance', 'accountant', 'project_manager'], // ses propres boîtes Outlook uniquement
];
// actions soumises à approbation : libellé, exécuteur
const PIL_APPROVAL_TYPES = [
    'annulation_import' => 'Annulation d\'un import bancaire (mouvements et paiements liés retirés)',
    'paiement_rapprochement' => 'Enregistrement d\'un paiement dans une facture ou un achat (rapprochement bancaire)',
    'suppression_engagement' => 'Suppression d\'un crédit, leasing ou charge du registre',
    'changement_role' => 'Modification des droits d\'un utilisateur sur le Pilotage',
    'email_externe' => 'Envoi d\'un e-mail externe (ex. relance client)',
];
const PIL_AP_STATUS = ['en_attente' => 'En attente', 'approuvee' => 'Approuvée', 'refusee' => 'Refusée', 'annulee' => 'Annulée', 'expiree' => 'Expirée', 'executee' => 'Exécutée'];

function pil_security_schema(): void {
    static $done = false; if ($done) return; $done = true;
    $pdo = db();
    if (!q("SHOW TABLES LIKE 'pil_audit'")->fetch()) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS pil_audit (
            id BIGINT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, at DATETIME NOT NULL, user_id INT NULL, process VARCHAR(12) NOT NULL, action VARCHAR(60) NOT NULL,
            entity_type VARCHAR(30) NULL, entity_id BIGINT NULL, old_value MEDIUMTEXT NULL, new_value MEDIUMTEXT NULL, origin VARCHAR(255) NULL, prev_hash CHAR(64) NOT NULL, hash CHAR(64) NOT NULL,
            KEY company_id_at (company_id, id), KEY company_entity (company_id, entity_type, entity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("CREATE TABLE IF NOT EXISTS pil_user_roles (
            company_id INT NOT NULL, user_id INT NOT NULL, role VARCHAR(20) NOT NULL, granted_by INT NULL, granted_at DATETIME NOT NULL, PRIMARY KEY (company_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $pdo->exec("CREATE TABLE IF NOT EXISTS pil_approvals (
            id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, type VARCHAR(30) NOT NULL, description TEXT NOT NULL, origin VARCHAR(12) NOT NULL, requested_by INT NULL,
            payload TEXT NOT NULL, amount BIGINT NULL, justification TEXT NULL, risks TEXT NULL, documents TEXT NULL, status VARCHAR(12) NOT NULL DEFAULT 'en_attente',
            created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, decided_by INT NULL, decided_at DATETIME NULL, decision_note TEXT NULL,
            executed_by INT NULL, executed_at DATETIME NULL, result TEXT NULL, last_error TEXT NULL, KEY company_status (company_id, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
    pil_audit_triggers();
}
/** Protection en base : modification et suppression du journal refusées par MySQL (si l'hébergeur autorise les déclencheurs). */
function pil_audit_triggers(): bool {
    static $ok = null; if ($ok !== null) return $ok;
    try {
        $have = array_column(q("SHOW TRIGGERS WHERE `Table` = 'pil_audit'")->fetchAll(), 'Trigger');
        // chaque protection recréée séparément si elle a disparu (ex. retirée à la main ou base restaurée)
        if (!in_array('pil_audit_no_update', $have, true)) db()->exec("CREATE TRIGGER pil_audit_no_update BEFORE UPDATE ON pil_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal d''audit : modification interdite'");
        if (!in_array('pil_audit_no_delete', $have, true)) db()->exec("CREATE TRIGGER pil_audit_no_delete BEFORE DELETE ON pil_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Journal d''audit : suppression interdite'");
        return $ok = true;
    } catch (Throwable $e) { error_log('[pilotage audit] déclencheurs non disponibles : ' . $e->getMessage()); return $ok = false; }
}

// --------------------------------------------------------------------- Rôle et permissions
function pil_owner_id(): int {
    $s = setting('pilotage', []) ?: [];
    if (!empty($s['owner'])) return (int)$s['owner'];
    return (int)q("SELECT MIN(id) FROM users WHERE company_id = ? AND role = 'admin' AND active = 1", [cid()])->fetchColumn();
}
function pil_role(array $u): string {
    if ((int)$u['id'] === pil_owner_id()) return 'owner';
    $r = q('SELECT role FROM pil_user_roles WHERE company_id = ? AND user_id = ?', [cid(), (int)$u['id']])->fetchColumn();
    if ($r && isset(PIL_ROLES[$r])) return $r;
    // par défaut : les administrateurs BatiPro (et le super-administrateur) sont « admin » du module ; les autres n'y ont pas accès
    return ($u['role'] ?? '') === 'admin' || !empty($u['super']) ? 'admin' : 'none';
}
function pil_can(array $u, string $perm): bool { return in_array(pil_role($u), PIL_PERMS[$perm] ?? [], true); }
function pil_need(array $u, string $perm): void {
    if (!pil_can($u, $perm)) fail(403, 'Action non autorisée pour votre rôle sur le Pilotage (' . PIL_ROLES[pil_role($u)][0] . ').');
}
/** Permission nécessaire pour une route (contrôle central, avant toute exécution). */
function pil_route_perm(string $sub, string $method, array $seg): ?string {
    $w = $method !== 'GET';
    return match ($sub) {
        'accounts', 'preview', 'import', 'tx' => $w ? 'bank.write' : 'bank.read',
        'imports' => $method === 'DELETE' ? 'approvals.request' : 'bank.read',
        'dashboard', 'monthly' => 'bank.read',
        'forecast', 'receivables', 'overview', 'explain' => 'treasury.read',
        'reconcile' => 'bank.read',
        'commitments' => $method === 'DELETE' ? 'approvals.request' : ($w ? 'commitments.write' : 'treasury.read'),
        'hypotheses' => $w ? 'hypotheses.write' : 'treasury.read',
        'flags' => 'bank.write',
        'reports', 'runs', 'compare', 'review', 'decisions' => $w ? 'alerts.write' : 'director.read',
        'alerts' => $w ? 'alerts.write' : 'director.read',
        'projects' => 'projects.read',
        'ask', 'convs', 'pinned' => 'ai.ask',
        'export' => 'export',
        'audit' => 'audit.read',
        'approvals' => $method === 'GET' || ($method === 'POST' && ($seg[2] ?? '') === '') ? 'approvals.request' : null, // décider / exécuter : contrôlé dans la route
        'roles' => $w ? 'approvals.request' : 'audit.read',
        'mail' => 'mail.use',
        'me' => null,
        default => 'settings.write',
    };
}

// --------------------------------------------------------------------- Journal d'audit (chaîne de hachage)
/** Écrit une entrée ; chaque entrée contient l'empreinte de la précédente : toute modification ou suppression ultérieure se voit. */
function pil_audit(string $action, ?string $etype = null, $eid = null, $old = null, $new = null, string $process = 'utilisateur', ?int $uid = null): void {
    pil_security_schema();
    if ($uid === null && $process === 'utilisateur') { $u = current_user(); $uid = $u ? (int)$u['id'] : null; }
    $origin = mb_substr(($process === 'cron' ? 'tâche planifiée' : 'web ' . ($_SERVER['REQUEST_METHOD'] ?? '') . ' ' . ($_GET['r'] ?? '')) . (isset($_SERVER['REMOTE_ADDR']) ? ' · ' . client_ip() : ''), 0, 255);
    $enc = fn($v) => $v === null ? null : (is_string($v) ? $v : json_encode($v, JSON_UNESCAPED_UNICODE));
    $lock = 'pil_audit_' . cid();
    q('SELECT GET_LOCK(?, 5)', [$lock]);
    try {
        $prev = (string)(q('SELECT hash FROM pil_audit WHERE company_id = ? ORDER BY id DESC LIMIT 1', [cid()])->fetchColumn() ?: str_repeat('0', 64));
        $row = ['company_id' => cid(), 'at' => now(), 'user_id' => $uid, 'process' => $process, 'action' => $action, 'entity_type' => $etype, 'entity_id' => $eid !== null ? (int)$eid : null,
            'old_value' => $enc($old), 'new_value' => $enc($new), 'origin' => $origin];
        $hash = pil_audit_hash($prev, $row);
        q('INSERT INTO pil_audit (company_id, at, user_id, process, action, entity_type, entity_id, old_value, new_value, origin, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', array_merge(array_values($row), [$prev, $hash]));
        // ancre : nombre d'entrées et dernière empreinte, conservées à part (détecte aussi une suppression des dernières lignes)
        $n = (int)q('SELECT COUNT(*) FROM pil_audit WHERE company_id = ?', [cid()])->fetchColumn();
        set_setting('pilotage_audit_anchor', ['count' => $n, 'hash' => $hash, 'at' => $row['at']]);
    } finally { q('SELECT RELEASE_LOCK(?)', [$lock]); }
}
function pil_audit_hash(string $prev, array $r): string {
    return hash('sha256', $prev . '|' . implode('|', array_map(fn($k) => (string)($r[$k] ?? ''), ['company_id', 'at', 'user_id', 'process', 'action', 'entity_type', 'entity_id', 'old_value', 'new_value', 'origin'])));
}
/** Contrôle d'intégrité : recalcule la chaîne et la compare à l'ancre. */
function pil_audit_verify(): array {
    pil_security_schema();
    $prev = str_repeat('0', 64); $n = 0; $bad = null;
    $st = db()->prepare('SELECT * FROM pil_audit WHERE company_id = ? ORDER BY id'); $st->execute([cid()]);
    while ($r = $st->fetch()) {
        $n++;
        if ($r['prev_hash'] !== $prev || pil_audit_hash($prev, $r) !== $r['hash']) { $bad = (int)$r['id']; break; }
        $prev = $r['hash'];
    }
    $anchor = setting('pilotage_audit_anchor', []) ?: [];
    $anchorOk = !$anchor || ((int)$anchor['count'] === $n && $anchor['hash'] === $prev);
    return ['ok' => $bad === null && $anchorOk, 'entries' => $n, 'broken_at' => $bad, 'anchor_ok' => $bad === null ? $anchorOk : null, 'db_protection' => pil_audit_triggers(),
        'note' => 'Le journal est protégé par une chaîne d\'empreintes (SHA-256), une ancre conservée à part' . (pil_audit_triggers() ? ' et des déclencheurs MySQL qui refusent modification et suppression' : '') . '. Un administrateur du serveur ayant un accès direct à la base peut toujours modifier les données : ce contrôle permet alors de DÉTECTER la modification, pas de l\'empêcher.'];
}
function pil_audit_list(array $f): array {
    $w = ['company_id = ?']; $a = [cid()];
    if (!empty($f['action'])) { $w[] = 'action = ?'; $a[] = (string)$f['action']; }
    if (!empty($f['entity'])) { $w[] = 'entity_type = ?'; $a[] = (string)$f['entity']; }
    if (!empty($f['from'])) { $w[] = 'at >= ?'; $a[] = $f['from'] . ' 00:00:00'; }
    if (!empty($f['to'])) { $w[] = 'at <= ?'; $a[] = $f['to'] . ' 23:59:59'; }
    $rows = q('SELECT id, at, user_id, process, action, entity_type, entity_id, old_value, new_value, origin FROM pil_audit WHERE ' . implode(' AND ', $w) . ' ORDER BY id DESC LIMIT 1000', $a)->fetchAll();
    foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['user_id'] = $r['user_id'] !== null ? (int)$r['user_id'] : null; foreach (['old_value', 'new_value'] as $k) { $j = $r[$k] !== null ? json_decode($r[$k], true) : null; if ($j !== null) $r[$k] = $j; } }
    return $rows;
}
/** Connexion réussie (appelé par api.php) : journalisée pour les firmes où le Pilotage est activé. */
function pil_audit_login(array $u): void {
    try {
        $prev = $GLOBALS['BP_CID'] ?? null; $GLOBALS['BP_CID'] = (int)$u['company_id'];
        $s = setting('pilotage', []) ?: [];
        if (!empty($s['enabled'])) pil_audit('connexion', 'user', (int)$u['id'], null, ['email' => $u['email']], 'utilisateur', (int)$u['id']);
        $GLOBALS['BP_CID'] = $prev;
    } catch (Throwable $e) { error_log('[pilotage audit] ' . $e->getMessage()); }
}

// --------------------------------------------------------------------- Centre d'approbation
function pil_approval_out(array $r): array {
    foreach (['id', 'requested_by', 'amount', 'decided_by', 'executed_by'] as $k) if ($r[$k] !== null) $r[$k] = (int)$r[$k];
    foreach (['payload', 'risks', 'documents', 'result'] as $k) $r[$k] = $r[$k] !== null ? (json_decode($r[$k], true) ?? $r[$k]) : null;
    $r['type_label'] = PIL_APPROVAL_TYPES[$r['type']] ?? $r['type'];
    unset($r['company_id']);
    return $r;
}
function pil_approvals_expire(): void {
    foreach (q("SELECT id FROM pil_approvals WHERE company_id = ? AND status IN ('en_attente', 'approuvee') AND expires_at < ?", [cid(), now()])->fetchAll(PDO::FETCH_COLUMN) as $id) {
        q("UPDATE pil_approvals SET status = 'expiree' WHERE id = ?", [(int)$id]);
        pil_audit('approbation_expiree', 'approval', (int)$id, null, ['status' => 'expiree'], 'systeme');
    }
}
/**
 * Crée une demande. Rien n'est exécuté.
 * @param array $d [type, description, payload, amount?, justification?, risks?, documents?, origin ('utilisateur'|'ia'), days?]
 */
function pil_approval_request(array $d, ?array $me): array {
    pil_security_schema();
    if (!isset(PIL_APPROVAL_TYPES[$d['type']])) throw new PilError('Type d\'action inconnu.', 400);
    $days = (int)($d['days'] ?? ((setting('pilotage_security', []) ?: [])['approvalDays'] ?? 14));
    q('INSERT INTO pil_approvals (company_id, type, description, origin, requested_by, payload, amount, justification, risks, documents, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [cid(), $d['type'], mb_substr((string)$d['description'], 0, 2000), $d['origin'] ?? 'utilisateur', $me['id'] ?? null, json_encode($d['payload'], JSON_UNESCAPED_UNICODE), $d['amount'] ?? null,
         isset($d['justification']) ? mb_substr((string)$d['justification'], 0, 2000) : null, json_encode($d['risks'] ?? [], JSON_UNESCAPED_UNICODE), json_encode($d['documents'] ?? [], JSON_UNESCAPED_UNICODE),
         'en_attente', now(), date('Y-m-d H:i:s', time() + max(1, $days) * 86400)]);
    $id = (int)db()->lastInsertId();
    pil_audit('approbation_demandee', 'approval', $id, null, ['type' => $d['type'], 'description' => $d['description'], 'montant' => $d['amount'] ?? null, 'donnees' => $d['payload']], ($d['origin'] ?? '') === 'ia' ? 'ia' : 'utilisateur', $me['id'] ?? null);
    return pil_approval_out(q('SELECT * FROM pil_approvals WHERE id = ?', [$id])->fetch());
}
/** Décision : approuver ou refuser (propriétaire uniquement ; le demandeur ne décide pas lui-même si le « double contrôle » est activé). */
function pil_approval_decide(int $id, string $decision, string $note, array $me): array {
    pil_need($me, 'approvals.decide');
    pil_approvals_expire();
    $a = q('SELECT * FROM pil_approvals WHERE id = ? AND company_id = ? FOR UPDATE', [$id, cid()])->fetch();
    if (!$a) fail(404, 'Demande introuvable');
    if ($a['status'] !== 'en_attente') fail(409, 'Demande déjà traitée (' . (PIL_AP_STATUS[$a['status']] ?? $a['status']) . ').');
    if (!empty((setting('pilotage_security', []) ?: [])['fourEyes']) && (int)$a['requested_by'] === (int)$me['id']) fail(403, 'Double contrôle activé : une autre personne doit approuver votre demande.');
    if (!in_array($decision, ['approuvee', 'refusee'], true)) fail(400, 'Décision inconnue');
    q('UPDATE pil_approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?', [$decision, $me['id'], now(), mb_substr($note, 0, 2000), $id]);
    pil_audit($decision === 'approuvee' ? 'approbation_accordee' : 'approbation_refusee', 'approval', $id, ['status' => 'en_attente'], ['status' => $decision, 'note' => $note]);
    return pil_approval_out(q('SELECT * FROM pil_approvals WHERE id = ?', [$id])->fetch());
}
/** Exécution contrôlée d'une demande approuvée (et seulement approuvée), journalisée avec son résultat. */
function pil_approval_execute(int $id, array $me): array {
    pil_need($me, 'approvals.execute');
    pil_approvals_expire();
    $a = q('SELECT * FROM pil_approvals WHERE id = ? AND company_id = ?', [$id, cid()])->fetch();
    if (!$a) fail(404, 'Demande introuvable');
    if ($a['status'] !== 'approuvee') fail(409, 'Seule une demande approuvée peut être exécutée (statut : ' . (PIL_AP_STATUS[$a['status']] ?? $a['status']) . ').');
    $p = json_decode($a['payload'], true) ?: [];
    try {
        $result = match ($a['type']) {
            'annulation_import' => (function () use ($p, $me) { pil_cancel_import((int)$p['import_id'], $me); return ['import' => (int)$p['import_id'], 'annule' => true]; })(),
            'paiement_rapprochement' => (function () use ($p, $me) { $t = pil_tx_update((int)$p['tx_id'], ['match' => ['type' => $p['type'], 'id' => (int)$p['id'], 'pay' => true]], $me); if (!$t['match_paid']) throw new PilError('Paiement non enregistré : un paiement de ce montant existe déjà dans le document.', 409); return ['mouvement' => $t['id'], 'paiement_enregistre' => (bool)$t['match_paid']]; })(),
            'suppression_engagement' => (function () use ($p, $me) { require_once __DIR__ . '/treasury.php'; pil_treasury_schema(); $c = q('SELECT * FROM pil_commitments WHERE id = ? AND company_id = ?', [(int)$p['commitment_id'], cid()])->fetch(); if (!$c) throw new PilError('Engagement déjà supprimé.', 404);
                q('DELETE FROM pil_commitments WHERE id = ? AND company_id = ?', [(int)$c['id'], cid()]); pil_audit('engagement_supprime', 'commitment', (int)$c['id'], $c, null); return ['supprime' => $c['label']]; })(),
            'changement_role' => (function () use ($p, $me) { return pil_role_set((int)$p['user_id'], (string)$p['role'], $me); })(),
            'email_externe' => (function () use ($p) { send_mail([['email' => (string)$p['to'], 'name' => (string)($p['to_name'] ?? '')]], [], (string)$p['subject'], (string)$p['body'], []); return ['envoye_a' => $p['to']]; })(),
        };
    } catch (PilError $e) { $err = $e->getMessage(); } catch (Throwable $e) { $err = $e->getMessage(); }
    if (isset($err)) {
        q('UPDATE pil_approvals SET last_error = ? WHERE id = ?', [mb_substr($err, 0, 2000), $id]);
        pil_audit('execution_echouee', 'approval', $id, null, ['erreur' => $err]);
        fail(422, 'Exécution impossible : ' . $err . ' (la demande reste approuvée ; vous pouvez réessayer).');
    }
    q("UPDATE pil_approvals SET status = 'executee', executed_by = ?, executed_at = ?, result = ?, last_error = NULL WHERE id = ?", [$me['id'], now(), json_encode($result, JSON_UNESCAPED_UNICODE), $id]);
    pil_audit('approbation_executee', 'approval', $id, ['status' => 'approuvee'], ['status' => 'executee', 'resultat' => $result]);
    return pil_approval_out(q('SELECT * FROM pil_approvals WHERE id = ?', [$id])->fetch());
}
function pil_role_set(int $uid, string $role, array $me): array {
    if (!isset(PIL_ROLES[$role]) || $role === 'owner') throw new PilError('Rôle invalide (le propriétaire se désigne dans les paramètres).', 400);
    $u = q('SELECT id, name FROM users WHERE id = ? AND company_id = ?', [$uid, cid()])->fetch();
    if (!$u) throw new PilError('Utilisateur introuvable.', 404);
    if ($uid === pil_owner_id()) throw new PilError('Le rôle du propriétaire ne se modifie pas ici.', 400);
    $old = q('SELECT role FROM pil_user_roles WHERE company_id = ? AND user_id = ?', [cid(), $uid])->fetchColumn() ?: null;
    q('REPLACE INTO pil_user_roles (company_id, user_id, role, granted_by, granted_at) VALUES (?,?,?,?,?)', [cid(), $uid, $role, $me['id'], now()]);
    pil_audit('role_modifie', 'user', $uid, ['role' => $old], ['role' => $role, 'nom' => $u['name']]);
    return ['utilisateur' => $u['name'], 'role' => $role];
}

// --------------------------------------------------------------------- Routes : pilot/me, pilot/approvals, pilot/audit, pilot/roles, pilot/export
function pil_security_route(string $method, array $seg, array $me): void {
    pil_security_schema();
    $sub = $seg[1]; $id = isset($seg[2]) ? (int)$seg[2] : 0;
    switch ($sub) {
        case 'me':
            $role = pil_role($me);
            out(['role' => $role, 'label' => PIL_ROLES[$role][0], 'perms' => array_keys(array_filter(PIL_PERMS, fn($r) => in_array($role, $r, true))), 'owner_id' => pil_owner_id()]);
        case 'approvals':
            pil_approvals_expire();
            if ($method === 'GET' && !$id) {
                $all = pil_can($me, 'approvals.decide') || pil_can($me, 'approvals.execute');
                $rows = q('SELECT * FROM pil_approvals WHERE company_id = ?' . ($all ? '' : ' AND requested_by = ?') . ' ORDER BY id DESC LIMIT 500', $all ? [cid()] : [cid(), $me['id']])->fetchAll();
                out(array_map('pil_approval_out', $rows));
            }
            if ($method === 'POST' && !$id) {
                $b = body(); if (($b['type'] ?? '') !== 'email_externe') fail(400, 'Seules les demandes d\'e-mail se créent directement ; les autres naissent de l\'action concernée.');
                foreach (['to', 'subject', 'body'] as $k) if (trim((string)($b['payload'][$k] ?? '')) === '') fail(400, "Champ manquant : $k");
                if (!filter_var($b['payload']['to'], FILTER_VALIDATE_EMAIL)) fail(400, 'Adresse e-mail invalide.');
                out(pil_approval_request(['type' => 'email_externe', 'description' => 'E-mail à ' . $b['payload']['to'] . ' : ' . $b['payload']['subject'], 'payload' => array_intersect_key($b['payload'], ['to' => 1, 'to_name' => 1, 'subject' => 1, 'body' => 1]),
                    'justification' => $b['justification'] ?? null, 'risks' => ['Communication externe au nom de l\'entreprise']], $me));
            }
            if ($method === 'POST' && $id && in_array($seg[3] ?? '', ['approve', 'refuse'], true)) out(pil_approval_decide($id, $seg[3] === 'approve' ? 'approuvee' : 'refusee', (string)(body()['note'] ?? ''), $me));
            if ($method === 'POST' && $id && ($seg[3] ?? '') === 'execute') out(pil_approval_execute($id, $me));
            if ($method === 'POST' && $id && ($seg[3] ?? '') === 'cancel') {
                $a = q('SELECT * FROM pil_approvals WHERE id = ? AND company_id = ?', [$id, cid()])->fetch(); if (!$a) fail(404, 'Demande introuvable');
                if ((int)$a['requested_by'] !== (int)$me['id'] && !pil_can($me, 'approvals.decide')) fail(403, 'Seul le demandeur ou le propriétaire peut annuler.');
                if (!in_array($a['status'], ['en_attente', 'approuvee'], true)) fail(409, 'Demande déjà terminée.');
                q("UPDATE pil_approvals SET status = 'annulee', decided_by = ?, decided_at = ? WHERE id = ?", [$me['id'], now(), $id]);
                pil_audit('approbation_annulee', 'approval', $id, ['status' => $a['status']], ['status' => 'annulee']);
                out(pil_approval_out(q('SELECT * FROM pil_approvals WHERE id = ?', [$id])->fetch()));
            }
            break;
        case 'audit':
            if ($method === 'GET' && ($seg[2] ?? '') === 'verify') out(pil_audit_verify());
            if ($method === 'GET') out(pil_audit_list($_GET));
            break; // aucune route de modification ou de suppression du journal
        case 'roles':
            if ($method === 'GET') {
                $users = q('SELECT id, name, email, role, active, super FROM users WHERE company_id = ? ORDER BY name', [cid()])->fetchAll();
                out(['roles' => PIL_ROLES, 'perms' => PIL_PERMS, 'users' => array_map(fn($u) => ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'batipro_role' => $u['role'], 'active' => (int)$u['active'], 'role' => pil_role($u)], $users)]);
            }
            if ($method === 'PUT' && $id) {
                $role = (string)(body()['role'] ?? '');
                if (pil_can($me, 'roles.manage')) { try { out(['done' => true] + pil_role_set($id, $role, $me)); } catch (PilError $e) { fail($e->getCode() ?: 400, $e->getMessage()); } }
                // non-propriétaire : demande d'approbation
                if (!isset(PIL_ROLES[$role])) fail(400, 'Rôle inconnu');
                $u = q('SELECT name FROM users WHERE id = ? AND company_id = ?', [$id, cid()])->fetch(); if (!$u) fail(404, 'Utilisateur introuvable');
                out(['done' => false, 'approval' => pil_approval_request(['type' => 'changement_role', 'description' => "Donner le rôle « " . PIL_ROLES[$role][0] . " » à {$u['name']}", 'payload' => ['user_id' => $id, 'role' => $role], 'risks' => ['Accès aux données financières']], $me)], 202);
            }
            break;
        case 'export':
            if ($method === 'GET' && ($seg[2] ?? '') === 'tx') {
                $rows = pil_tx_list($_GET);
                pil_audit('export', 'bank_tx', null, null, ['lignes' => count($rows), 'filtres' => array_intersect_key($_GET, ['account' => 1, 'from' => 1, 'to' => 1, 'category' => 1])]);
                header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="mouvements-bancaires.csv"');
                $o = fopen('php://output', 'w'); fwrite($o, "\xEF\xBB\xBF");
                fputcsv($o, ['Date', 'Date valeur', 'Compte', 'Montant', 'Contrepartie', 'IBAN contrepartie', 'Communication', 'Catégorie', 'Statut', 'Rapproché'], ';');
                $acc = array_column(pil_accounts(), null, 'id');
                foreach ($rows as $t) fputcsv($o, [$t['booking_date'], $t['value_date'], $acc[$t['account_id']]['iban'] ?? '', number_format($t['amount'] / 100, 2, ',', ''), $t['name_fix'] ?: $t['cp_name'], $t['cp_iban'], $t['structured'] ?: $t['communication'], PIL_CATS[$t['category']][0] ?? $t['category'], $t['status'], $t['match_type'] ? $t['match_type'] . ' #' . $t['match_id'] : ''], ';');
                fclose($o); exit;
            }
            break;
        case 'settings':
            if ($method === 'GET') out(['security' => (setting('pilotage_security', []) ?: []) + ['fourEyes' => false, 'approvalDays' => 14], 'owner_id' => pil_owner_id(), 'audit' => pil_audit_verify()]);
            if ($method === 'PUT') {
                $b = body(); $old = setting('pilotage_security', []) ?: [];
                $new = ['fourEyes' => !empty($b['fourEyes']), 'approvalDays' => max(1, min(90, (int)($b['approvalDays'] ?? 14)))];
                set_setting('pilotage_security', $new);
                if (!empty($b['owner']) && (int)$b['owner'] !== pil_owner_id()) {
                    $u = q("SELECT id FROM users WHERE id = ? AND company_id = ? AND role = 'admin' AND active = 1", [(int)$b['owner'], cid()])->fetch();
                    if (!$u) fail(400, 'Le propriétaire doit être un administrateur actif de l\'entreprise.');
                    $s = setting('pilotage', []) ?: []; $prev = pil_owner_id(); $s['owner'] = (int)$b['owner']; set_setting('pilotage', $s);
                    pil_audit('proprietaire_modifie', 'settings', null, ['owner' => $prev], ['owner' => (int)$b['owner']]);
                }
                pil_audit('parametres_securite', 'settings', null, $old, $new);
                out(['ok' => true]);
            }
            break;
    }
    fail(404, 'Route inconnue');
}
