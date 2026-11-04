<?php
// Retour de la connexion Microsoft 365 (« Se connecter avec Microsoft »).
// Microsoft exige une adresse sans « ? ». La page fonctionne aussi dans une fenêtre séparée sans la session BatiPro
// (la demande est retrouvée par son « state » à usage unique) ; elle se ferme ensuite et BatiPro se met à jour.
declare(strict_types=1);
require __DIR__ . '/lib.php';
require_once __DIR__ . '/pilotage/bank.php';
require_once __DIR__ . '/pilotage/director.php';
require_once __DIR__ . '/pilotage/mail.php';
pil_mail_callback_public();
