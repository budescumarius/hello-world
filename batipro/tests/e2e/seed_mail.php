<?php
// Données fictives pour le test d'interface du briefing e-mails (boîte, e-mails triés, brouillon préparé).
require __DIR__ . '/../php/harness.php';
$pdo = db();
$pdo->exec("DELETE FROM pil_mail_drafts; DELETE FROM pil_mail_msgs; DELETE FROM pil_mail_accounts");
$cid = 1; $uid = (int)$pdo->query("SELECT id FROM users WHERE email = 'admin@test.madibu.local'")->fetchColumn();
$pdo->prepare("INSERT INTO settings (company_id, k, v) VALUES (1, 'pilotage_mail', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([json_encode(['clientId' => '11111111-2222-3333-4444-555555555555', 'tenant' => 'madibu-fictif.be', 'secret' => 'x'])]);
$pdo->prepare("INSERT INTO pil_mail_accounts (company_id, user_id, email, name, token_enc, expires_at, status, last_sync, created_at) VALUES (1, ?, 'direction@madibu-fictif.be', 'Direction', NULL, 0, 'ok', NOW(), NOW())")->execute([$uid]);
$acc = (int)$pdo->lastInsertId();
$ins = $pdo->prepare("INSERT INTO pil_mail_msgs (company_id, account_id, graph_id, conv_id, folder, from_email, from_name, to_json, subject, at, preview, body, atts, web_link, is_read, analysis, analyzed_at, state, created_at) VALUES (1, ?, ?, ?, 'in', ?, ?, '[]', ?, NOW() - INTERVAL ? HOUR, ?, ?, ?, 'https://outlook.office.com/mail/fictif', 0, ?, NOW(), ?, NOW())");
$ins->execute([$acc, 'G1', 'C1', 'client@exemple-fictif.be', 'Client Fictif', 'Demande de devis cuisine Dupont', 5, 'Pouvez-vous…', "Bonjour,\nPouvez-vous nous envoyer le devis avant vendredi ?", json_encode([['name' => 'plan-fictif.pdf', 'size' => 400, 'type' => 'application/pdf']]),
  json_encode(['categorie' => 'client', 'urgence' => 'haute', 'resume' => 'Le client demande le devis avant vendredi.', 'action_requise' => true, 'action' => 'Envoyer le devis cuisine Dupont', 'echeance' => '', 'pieces' => 'Plan PDF fictif', 'reponse_necessaire' => true, 'non_verifie' => []]), 'a_faire']);
$m1 = (int)$pdo->lastInsertId();
$ins->execute([$acc, 'G2', 'C2', 'promo@pub-fictif.be', 'Promo Fictive', 'Soldes outillage', 30, 'Promotions', 'Promotions', null, json_encode(['categorie' => 'publicite', 'urgence' => 'basse', 'resume' => 'Publicité.', 'action_requise' => false, 'action' => '', 'echeance' => '', 'pieces' => '', 'reponse_necessaire' => false, 'non_verifie' => []]), 'info']);
$pdo->prepare("INSERT INTO pil_mail_drafts (company_id, account_id, msg_id, to_json, subject, body, origin, status, check_json, created_at, updated_at) VALUES (1, ?, ?, ?, 'RE: Demande de devis cuisine Dupont', ?, 'ia', 'brouillon', ?, NOW(), NOW())")
  ->execute([$acc, $m1, json_encode([['email' => 'client@exemple-fictif.be', 'name' => 'Client Fictif']]), "Bonjour,\nNous vous envoyons le devis avant vendredi.\nCordialement", json_encode(['non_verifie' => ['9.999,00 €']])]);
$pdo->exec("UPDATE pil_mail_msgs SET moved = 'Publicité' WHERE from_email = 'promo@pub-fictif.be'");
$pdo->prepare("INSERT INTO pil_mail_msgs (company_id, account_id, graph_id, conv_id, folder, from_email, from_name, to_json, subject, at, preview, body, is_read, created_at) VALUES (1, ?, 'S1', 'C9', 'sent', 'direction@madibu-fictif.be', 'Direction', ?, 'RE: Plans', NOW() - INTERVAL 2 HOUR, 'Merci pour les plans', 'Merci pour les plans.', 1, NOW())")->execute([$acc, json_encode([['email' => 'archi@bureau-fictif.be', 'name' => 'Architecte Fictif']])]);
echo "ok\n";
