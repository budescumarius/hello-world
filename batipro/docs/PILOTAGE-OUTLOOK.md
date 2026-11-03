# Pilotage – Briefing e-mails (Outlook / Microsoft 365)

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

## Mise en place (une fois, propriétaire + administrateur Microsoft 365)
1. entra.microsoft.com → Applications → Inscriptions d'applications → Nouvelle inscription : nom « BatiPro », « Comptes dans cet annuaire d'organisation uniquement ».
2. URI de redirection (Web) : celle affichée dans Pilotage → Briefing e-mails (`https://VOTRE-SITE/api.php?r=pilot/mail/callback`).
3. Copier l'ID d'application (client) et l'ID de l'annuaire (locataire).
4. Certificats et secrets → Nouveau secret client → copier la **Valeur**.
5. Autorisations des API → Microsoft Graph → déléguées : Mail.Read, Mail.Send, User.Read, offline_access → Accorder le consentement administrateur.
6. Dans BatiPro (propriétaire) : coller les trois valeurs → Enregistrer. Puis chaque utilisateur : « + Connecter une boîte Outlook », une fois par boîte.
7. Le secret client expire (24 mois max) : en créer un nouveau et le recoller avant l'échéance.
