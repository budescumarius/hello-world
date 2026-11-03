<?php
// Retour de la connexion Microsoft 365 (« Se connecter avec Microsoft »).
// Microsoft exige une adresse de redirection sans « ? » : cette page transmet simplement à api.php?r=pilot/mail/callback.
$_GET['r'] = 'pilot/mail/callback';
require __DIR__ . '/api.php';
