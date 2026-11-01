# Base de données

Migration : `supabase/migrations/20261101000000_core_schema.sql` (PostgreSQL 17 / Supabase).
Clés primaires UUID ; `created_at`, `updated_at` (trigger) et `created_by` (= `auth.uid()`) sur les tables métier.

## Tables

| Table | Rôle | Points clés |
|---|---|---|
| `profiles` | utilisateurs (1-1 avec `auth.users`) | `role` ∈ owner, admin, finance, project_manager, site_manager, employee ; `locale` fr/ro ; seul l'OWNER modifie rôles/activation ; impossible de retirer le dernier OWNER |
| `clients`, `suppliers`, `subcontractors` | tiers | délai de paiement, archivage ; assurance des sous-traitants |
| `employees` | personnel | coût horaire employeur HTVA, lien éventuel vers un profil |
| `projects` | chantiers | référence unique, montant de contrat HTVA **nullable** (inconnu ≠ 0), budget par poste, avancement + horodatage, archivage (pas de suppression) |
| `project_members` | affectation | détermine l'accès des chefs de chantier et employés |
| `change_orders` | avenants | statut, travaux commencés, date d'accord écrit obligatoire si approuvé |
| `invoices` | factures émises **et** reçues | `direction` issued/received ; contraintes : client pour une facture émise, exactement un fournisseur ou sous-traitant + poste de coût pour une facture reçue ; TVA 0/6/12/21 % ; `amount_total` calculé ; numéros uniques |
| `expenses` | coûts sans facture d'achat | `settlement` = `payroll` (main-d'œuvre interne réglée via les salaires) ou `payable` |
| `payments` | flux réels | entrant / sortant, lié à une facture, une dépense ou une obligation ; **trigger** : sens cohérent, pas de surpaiement, pas de paiement sur facture brouillon/annulée |
| `recurring_obligations` | prêts, lignes de crédit, leasings, salaires, ONSS, TVA, loyers, assurances | prochaine échéance ; confirmation explicite du paiement |
| `bank_balances` | soldes | saisie manuelle (`source`), un solde par compte et par date |
| `tasks` | tâches | statuts to do / en cours / en attente / terminée / annulée ; `source` manuelle/IA/import ; une seule tâche ouverte par `alert_key` |
| `documents` | métadonnées des fichiers | fichier dans le bucket privé `documents/<project_id ou general>/…` |
| `alerts` | constats des agents | clé stable (dédoublonnage), quoi/pourquoi/impact/action/qui/quand, statut, notification unique |
| `reports` | rapports | unique par (type, date) |
| `approvals` | demandes d'approbation | statut uniquement via `decide_approval` / `record_approval_execution` |
| `ai_runs` | exécutions IA et automatisations | tokens, outils appelés, erreurs, clé d'idempotence |
| `audit_logs` | journal | ajout seul (triggers bloquant UPDATE/DELETE, y compris pour le rôle service) |

## Règles financières (implémentées dans `src/lib/domain/finance.ts`)
- **Facturé HTVA** = factures émises au statut émise/contestée, notes de crédit en négatif.
- **Encaissé** = somme des paiements entrants enregistrés (TVAC).
- **Coûts engagés HTVA** = factures reçues non annulées + dépenses ; **coûts payés** = paiements sortants.
- **Coût final estimé** : prévision manuelle > coûts réels (chantier terminé) > tendance coûts ÷ avancement (avancement ≥ 10 %) > budget. Méthode toujours affichée.
- **Travaux non facturés** = contrat × avancement déclaré − facturé (l'avancement déclaré n'est pas une réception).
- **Prévisions** : 3 scénarios × 7/30/90 jours, hypothèses affichées (voir `SCENARIO_RULES` et `COMMON_RULES`).

## Matrice d'accès (RLS)

| Données | owner | admin | finance | project_manager | site_manager | employee |
|---|---|---|---|---|---|---|
| Chantiers | tous (écriture) | tous (écriture) | tous (lecture) | tous (écriture) | assignés | assignés |
| Factures, paiements | écriture | écriture | écriture | lecture (liés à un chantier) | – | – |
| Dépenses | écriture | écriture | écriture | saisie chantier | – | – |
| Banque, obligations | écriture | lecture | écriture | – | – | – |
| Tâches | toutes | toutes | toutes | toutes | ses chantiers / assignées | assignées |
| Approbations | décision | décision | décision (actions financières) | création | – | – |
| Audit | lecture | lecture | – | – | – | – |
| Rôles | modification | – | – | – | – | – |

Tests : `tests/db/rls.test.ts` (exécutés sur la base Supabase locale).
