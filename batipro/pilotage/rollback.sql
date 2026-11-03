-- PILOTAGE MADIBU – retour arrière complet de la base (à exécuter dans phpMyAdmin APRÈS avoir fait une sauvegarde).
-- Supprime uniquement les tables et réglages du module ; aucune table BatiPro existante n'est touchée.
-- Les paiements déjà enregistrés dans des factures / achats par un rapprochement restent (ce sont des données BatiPro) :
-- ils portent la mention « Extrait … » et la clé bankTx dans data.payments.
DROP TABLE IF EXISTS pil_audit, pil_approvals, pil_user_roles, pil_runs, pil_ai_convs, pil_decisions, pil_reports, pil_alerts,
  pil_doc_flags, pil_commitments, pil_bank_rules, pil_bank_tx, pil_bank_imports, pil_bank_accounts, pil_mail_drafts, pil_mail_msgs, pil_mail_accounts;
DELETE FROM settings WHERE k IN ('pilotage', 'pilotage_hyp', 'pilotage_security', 'pilotage_audit_anchor', 'pilotage_director', 'pilotage_mail');
-- (supprimez aussi le fichier pilotage/.mail-key.php : clé des connexions Outlook, devenue inutile)
-- (la table item_archive de l'étape 1 contient les copies des factures validées supprimées ou rouvertes : à conserver)
