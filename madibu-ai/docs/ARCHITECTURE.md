# Architecture – MADIBU AI

## 1. Analyse des besoins (synthèse)

MADIBU GROUP gère en parallèle plusieurs chantiers (rénovation, gros œuvre, toitures, techniques spéciales, finitions)
avec clients, architectes, employés, sous-traitants et fournisseurs. Les risques majeurs pour une PME de construction
belge, et donc les priorités du système :

1. **Trésorerie** : préfinancement des chantiers, retards de paiement clients, échéances fixes (salaires, ONSS, TVA,
   prêts, leasings) concentrées en fin de mois.
2. **Rentabilité par chantier** : dérive des coûts, travaux supplémentaires exécutés sans avenant signé, travaux réalisés
   non facturés.
3. **Charge administrative** : relances, suivi documentaire, préparation de rapports.
4. **Contrôle** : l'administrateur doit garder la décision sur tout ce qui engage l'entreprise.

Principes retenus : données réelles uniquement (aucune invention), distinction stricte facturé / encaissé et engagé / payé,
autonomie supervisée de l'IA, journalisation intégrale.

## 2. Vue d'ensemble

```
Navigateur (PWA-ready, mobile)                       Planificateur externe (cron)
   │  pages React Server Components                       │ GET /api/cron/daily (CRON_SECRET)
   ▼                                                      ▼
Next.js 16 (serveur Node) ── proxy.ts : session + en-têtes de sécurité
   ├── Server Actions (Zod + requirePermission) ─┐
   ├── Route Handlers : /api/ai/chat, exports CSV, documents
   ├── src/lib/domain : règles financières pures (centimes)  ◄── testées (Vitest)
   ├── src/lib/analysis/engine : agents → alertes, tâches, rappels, rapports
   └── src/lib/ai : Claude + outils (session utilisateur)
            │                                  │
            ▼                                  ▼
   Supabase : PostgreSQL (RLS, triggers d'audit, fonctions d'approbation),     API Claude (Anthropic)
              Auth (e-mail/mot de passe), Storage (bucket privé « documents »)
```

- **Autorisation à deux niveaux** : vérification serveur (`src/lib/permissions.ts`) + RLS PostgreSQL, autorité finale.
- **Client « service »** (contourne la RLS) uniquement pour l'analyse système et la création de comptes, après contrôle.
- **Cache Components** non activé : application entièrement authentifiée, rendu dynamique à chaque requête.

## 3. Agents

| Agent | Implémentation actuelle | Constats produits |
|---|---|---|
| Contrôleur financier | `financialControllerFindings` | créances en retard (rappels gradués), dettes échues, factures contestées, solde bancaire absent/ancien, manque de trésorerie 7/30/90 j (réaliste, pessimiste), obligations non confirmées, chantiers en perte, budget dépassé, absence d'acompte, chantier préfinancé, données manquantes |
| Chef de projet | `projectManagerFindings` | retard, échéance proche, avancement en retard sur le planning (linéaire), avancement non mis à jour, contrat signé absent, réception non documentée, avenants sans accord écrit (travaux commencés), travaux non facturés, tâches en retard |
| Assistant administratif | `adminFindings` | factures d'achat sans chantier, clients sans e-mail, assurance sous-traitant expirée |
| COO virtuel (Claude) | `src/lib/ai/assistant.ts` | dialogue, priorisation, synthèse quotidienne ajoutée au rapport |
| Achats, chef de chantier, métreur | **non implémentés** | voir ROADMAP |

Les agents sont **déterministes** (règles explicites, gratuites, testées). Claude intervient pour le dialogue et la
synthèse ; il ne calcule pas les chiffres, il les lit via les outils.

Chaque constat porte : quoi (`title`), pourquoi (`why`), impact chiffré, action recommandée, responsable, échéance.

### Moteur d'automatisation (`runAnalysis`)
1. journalise l'exécution (`ai_runs`, clé d'idempotence quotidienne pour le planificateur) ;
2. exécute les agents ; synchronise `alerts` (création, réouverture, résolution automatique) ;
3. crée les tâches (une seule tâche ouverte par alerte, pas de recréation pendant 7 j après clôture humaine) ;
4. prépare les rappels de paiement comme **demandes d'approbation** `send_email` (une par facture et par niveau) ;
5. enregistre le rapport financier quotidien (+ hebdomadaire le lundi ou à la demande), unique par jour ;
6. notifie une seule fois chaque nouvelle alerte critique/élevée via webhook (si configuré).

## 4. Assistant IA
- Modèle `claude-opus-5-5` (configurable), effort `medium`, repli serveur en cas de refus (`fallbacks: "default"`).
- Boucle manuelle d'outils (8 tours max) ; entrées validées par Zod ; erreurs renvoyées au modèle sans détails internes.
- Outils : synthèse, chantiers, fiche chantier, créances, dettes, prévisions, alertes, tâches, approbations en attente,
  `create_task` (autonome), `propose_action` (dépose une approbation, n'exécute rien).
- Les outils utilisent la **session de l'utilisateur** : l'IA ne voit que ce que l'utilisateur a le droit de voir.
- Limitation : 20 requêtes / 10 min / utilisateur (persistée en base), historique limité à 20 messages.

## 5. Intégrations

| Intégration | État | Mise en œuvre prévue |
|---|---|---|
| Supabase (DB, Auth, Storage) | ✅ en service, testée | – |
| API Claude | ✅ code en place, boucle testée avec modèle simulé ; **non testée avec une vraie clé** dans cet environnement | définir `ANTHROPIC_API_KEY` |
| Webhook de notification | ✅ code en place, non testé contre un vrai flux | flux Power Automate « requête HTTP » → Teams / Outlook |
| Planification | ✅ route cron protégée et idempotente | Vercel Cron, `pg_cron` + `pg_net`, ou Power Automate (récurrence) |
| Excel | ✅ via CSV (« ; », virgule décimale) | import `.xlsx` natif si nécessaire |
| Outlook / Calendar | ❌ non implémenté | Microsoft Graph (application Entra ID) : lecture et classement des e-mails, brouillons ; envoi uniquement après approbation |
| SharePoint | ❌ non implémenté | Graph : synchronisation des dossiers chantier ; aujourd'hui Supabase Storage |
| Banque | ❌ (soldes saisis manuellement, signalés comme tels) | import CODA / Isabel / PSD2 |

## 6. Choix techniques
- Imposés par le cahier des charges : Next.js, TypeScript, Tailwind, shadcn/ui, Recharts, Supabase, Zod, Claude, Vitest, Playwright.
- Pas de dépendance payante supplémentaire : Supabase et Vercel ont des offres gratuites suffisantes au démarrage.
- Fuseau `Europe/Brussels` pour toutes les dates métier (`src/lib/dates.ts`).
