# Pilotage – Briefing e-mails (boîtes Hostico / cPanel ou Microsoft 365)

## Ce que fait le module
- Relève les boîtes Outlook connectées (réception + éléments envoyés, 14 jours au départ, puis toutes les 25 minutes par la tâche cron existante).
- L'IA trie chaque e-mail : catégorie, urgence, résumé, action à faire, échéance, chantier concerné, contenu des PDF joints, et prépare un brouillon de réponse dans la langue de l'expéditeur.
- Page **Pilotage → Briefing e-mails** : À faire (urgent d'abord), Sans réponse > 2 jours, Réponses préparées (à relire), Pour info.
- **Aucun e-mail ne part sans relecture** : « Relire et envoyer… » → « Envoyer… » → « Oui, envoyer ». L'IA et la tâche planifiée n'ont aucun moyen d'envoyer. Chaque envoi est inscrit au journal d'audit.

## Sécurité et confidentialité
- Connexion « Se connecter avec Microsoft » (OAuth 2.0 + PKCE) : BatiPro ne voit jamais le mot de passe.
- Jetons et secret chiffrés (AES-256-GCM) ; clé dans `pilotage/.mail-key.php` (créée automatiquement, hors base de données, à garder avec les fichiers du site).
- Une boîte n'est visible que par l'utilisateur BatiPro qui l'a connectée.
- Texte envoyé à l'IA : nettoyé (sans l'historique cité), IBAN et numéros de carte masqués ; PDF joints (2 par e-mail, 3 Mo max) transmis tels quels à l'IA (choix de la direction).
- Montants cités par l'IA comparés au texte de l'e-mail : un montant absent est signalé « à vérifier ».
- E-mails gardés 60 jours dans BatiPro ; « Déconnecter » efface la boîte, ses e-mails relevés et ses brouillons de BatiPro (rien n'est effacé dans Outlook).
- Copie de sauvegarde envoyée par e-mail : sans les tables `pil_mail_*`.
- Site de test (`test_mode`) : envoi simulé, rien ne part.

## Boîtes hébergées chez Hostico / cPanel (cas de MADIBU)
- Pilotage → Briefing e-mails → « + Connecter une boîte (Hostico / cPanel) » : adresse + mot de passe de la boîte (les mêmes que dans Outlook).
- Serveurs proposés : mail.<domaine>, réception IMAP 993 (SSL), envoi SMTP 465 (SSL) ; autres réglages possibles (143 / 587 en STARTTLS). Connexion en clair refusée.
- BatiPro vérifie la réception ET l'envoi avant d'enregistrer ; mot de passe chiffré. Relève en lecture seule (les e-mails restent « non lus » dans Outlook).
- Réponse envoyée par le SMTP de la boîte, en réponse au bon e-mail (In-Reply-To / References), puis copiée dans le dossier « Envoyés » : Outlook l'affiche comme un envoi normal.
- Mot de passe changé dans cPanel : menu de la boîte → « Reconnecter (nouveau mot de passe…) ».

## Microsoft 365 (facultatif : seulement pour des boîtes hébergées chez Microsoft)
1. entra.microsoft.com → Applications → Inscriptions d'applications → Nouvelle inscription : nom « BatiPro », « Comptes dans cet annuaire d'organisation uniquement ».
2. URI de redirection (Web) : celle affichée dans Pilotage → Briefing e-mails (`https://VOTRE-SITE/api.php?r=pilot/mail/callback`).
3. Copier l'ID d'application (client) et l'ID de l'annuaire (locataire).
4. Certificats et secrets → Nouveau secret client → copier la **Valeur**.
5. Autorisations des API → Microsoft Graph → déléguées : Mail.ReadWrite, Mail.Send, User.Read, offline_access → Accorder le consentement administrateur.
6. Dans BatiPro (propriétaire) : coller les trois valeurs → Enregistrer. Puis chaque utilisateur : « + Connecter une boîte Outlook », une fois par boîte.
7. Le secret client expire (24 mois max) : en créer un nouveau et le recoller avant l'échéance.

## Rangement automatique (publicités)
- À chaque relève, les publicités et newsletters (catégorie « Publicité » donnée par l'IA) sont déplacées dans le dossier **« Publicité »** de la boîte (créé au besoin ; chez cPanel : INBOX.Publicité). Rien n'est supprimé.
- Jamais rangé : un expéditeur présent dans les contacts BatiPro, un e-mail avec une action ou une réponse attendue, un e-mail remis à la main dans la boîte de réception.
- « Remettre dans la boîte de réception » (BatiPro) ou un déplacement à la main dans Outlook : l'e-mail n'est plus jamais rangé, sans doublon.
- Désactivable par boîte (menu ⋯ de la boîte). Microsoft 365 : autorisation Mail.ReadWrite nécessaire.
- Briefing : « Regrouper » par catégorie, chantier ou expéditeur.
