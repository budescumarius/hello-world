<?php
// Notifications Microsoft 365 : « un nouvel e-mail vient d'arriver » (abonnement Microsoft Graph créé à la connexion d'une boîte).
// Microsoft attend une réponse en moins de 3 secondes : on répond tout de suite, puis BatiPro relève la boîte et prévient l'utilisateur.
// Aucune session : chaque notification est vérifiée par son secret (clientState) propre à la boîte. Rien n'est jamais envoyé d'ici.
declare(strict_types=1);
// validation de l'adresse par Microsoft (création ou renouvellement de l'abonnement) : renvoyer le jeton tel quel, en texte
if (isset($_GET['validationToken'])) { header('Content-Type: text/plain; charset=utf-8'); echo (string)$_GET['validationToken']; exit; }
$raw = (string)file_get_contents('php://input');
http_response_code(202); header('Content-Length: 0'); header('Connection: close');
ignore_user_abort(true); @set_time_limit(240);
while (ob_get_level()) ob_end_flush(); flush();
if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request(); elseif (function_exists('litespeed_finish_request')) @litespeed_finish_request();
$j = json_decode($raw, true);
if (!is_array($j) || empty($j['value'])) exit;
require __DIR__ . '/lib.php';
require_once __DIR__ . '/pilotage/bank.php';
require_once __DIR__ . '/pilotage/director.php';
require_once __DIR__ . '/pilotage/mail.php';
try { pil_mail_notified($j['value']); } catch (Throwable $e) { error_log('[pilotage mail notify] ' . $e->getMessage()); }
