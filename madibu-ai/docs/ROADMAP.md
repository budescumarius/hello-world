# Feuille de route

## Livraison 1 – fondation MVP (réalisée)

| Phase | Contenu | État |
|---|---|---|
| 1 | Projet Next.js 16 + Supabase, schéma, RLS, authentification, navigation, tableau de bord | ✅ |
| 2 | Chantiers (CRUD, archivage, fiche à onglets, avenants, équipe), clients | ✅ |
| 3 | Contrôle financier : factures, dépenses, paiements partiels, banque, obligations, rentabilité, balance âgée, prévisions 3 scénarios × 7/30/90 j, exports CSV | ✅ |
| 4 | Tâches (liste + Kanban) et centre d'approbation | ✅ |
| 5 | Assistant Claude avec outils serveur | ✅ (boucle testée avec modèle simulé ; à valider avec une clé réelle) |
| 6 | Moteur d'analyse, alertes, tâches et rappels automatiques, rapports quotidien/hebdo, route cron | ✅ (exécution planifiée à brancher chez l'hébergeur) |
| 7 | Tests (unitaires, sécurité base, E2E bureau + mobile), revue de sécurité, documentation | ✅ ; déploiement : à faire |

Tests : 36 Vitest + 16 Playwright, tous au vert sur Supabase local.

## Prochaines étapes

### Phase 8 – mise en production
- Projet Supabase en région UE, migrations via `supabase db push`, MFA pour les rôles financiers, sauvegardes.
- Hébergement Next.js (ex. Vercel, région Francfort) ; cron quotidien vers `/api/cron/daily` à 6 h 30.
- Création du compte OWNER réel, import CSV des chantiers et factures en cours, saisie des soldes bancaires.
- Clé `ANTHROPIC_API_KEY` et validation de l'assistant sur des questions réelles.
- CI GitHub Actions (lint, typecheck, Vitest avec Supabase, build).

### Phase 9 – assistant administratif (Microsoft 365)
- Application Entra ID, Microsoft Graph : lecture de la boîte de réception, classement (clients, architectes, fournisseurs, sous-traitants, banques, assurances, comptabilité, juridique, employés, administration), extraction des demandes et échéances, création de tâches.
- Brouillons de réponse en français dans Outlook ; **envoi uniquement après approbation** (exécution automatique de l'action approuvée).
- Agenda : préparation des réunions ; rapport administratif du matin.
- SharePoint : arborescence par chantier synchronisée avec `documents`.

### Phase 10 – achats
- Tables `purchase_requests`, `supplier_quotes`, `purchase_orders`, `deliveries`, historique de prix.
- Comparaison des devis, bon de commande **soumis à approbation**, suivi des livraisons, écarts quantité/prix.

### Phase 11 – chantier
- Rapports journaliers (présences, sous-traitants, travaux, livraisons, problèmes, sécurité), photos, pointage des heures → coût main-d'œuvre.
- Distinction planifié / commencé / terminé / réceptionné par lot de travaux ; historique chronologique.
- Aucune déduction de conformité technique à partir de photos ; signalement pour inspection.

### Phase 12 – métrés et devis
- Bibliothèque de prix (fournisseurs réels), métrés par lot, heures et coûts, frais de chantier, provision pour risques, marge.
- Distinction mesuré / hypothèse ; liste des points manquants ou ambigus ; devis en brouillon soumis à validation.

### Phase 13 – banque
- Import CODA/CSV des relevés, rapprochement automatique proposé (validation humaine), remplacement de la saisie manuelle des soldes.
