@AGENTS.md

# MADIBU AI – conventions de développement

## Pile
Next.js 16 (App Router, `src/proxy.ts` remplace `middleware.ts`, Cache Components **désactivé**), React 19, TypeScript strict,
Tailwind CSS 4, composants shadcn/ui écrits à la main dans `src/components/ui` (le registre shadcn n'était pas accessible),
Recharts, Supabase (PostgreSQL, Auth, Storage), Zod 4, SDK Anthropic (`@anthropic-ai/sdk`), Vitest, Playwright.

## Règles métier non négociables
- Montants : `numeric(14,2)` en base ; **centimes entiers** dans `src/lib/domain` (`toCents` / `fromCents`). Jamais de calcul en flottant sur des euros.
- Rentabilité en HTVA ; trésorerie en TVAC. Facturé ≠ encaissé ; coût engagé ≠ coût payé.
- Une facture n'est payée que par des lignes `payments`. Ne jamais déduire un paiement.
- Donnée inconnue = `null` + entrée dans `missing`. Ne jamais remplacer par une estimation silencieuse.
- Les fonctions de `src/lib/domain/*` sont **pures** et testées (`tests/unit`). Toute nouvelle règle = nouveau test.

## Sécurité
- Chaque Server Action / Route Handler appelle `requirePermission()` (ou `getCurrentUser()` + `can()`), puis utilise
  `createClient()` (session utilisateur → RLS). `createServiceClient()` est réservé à l'analyse système et à la création de comptes.
- Toute nouvelle table : RLS activée, policies, GRANT explicites (les tables ne sont pas exposées automatiquement), trigger d'audit.
- L'IA ne décide jamais d'une approbation : statut modifié uniquement par `decide_approval` / `record_approval_execution`.
- Les outils IA (`src/lib/ai/tools.ts`) valident leurs entrées avec Zod et s'exécutent avec la session de l'utilisateur.

## Arborescence
```
src/app/(app)/…          pages authentifiées (+ _actions/index.ts : Server Actions)
src/app/api/…            routes (chat IA, cron, exports CSV, documents)
src/lib/domain/          finance.ts, analysis.ts, reports.ts (pur, testé)
src/lib/analysis/        moteur d'automatisation (alertes, tâches, rappels, rapports)
src/lib/ai/              assistant Claude + outils
supabase/migrations/     schéma, RLS, triggers, stockage
tests/unit · tests/db · tests/e2e
```

## Vérifications avant commit
`npm run lint && npm run typecheck && npm test` ; `npm run test:e2e` après `npm run db:reset && npm run seed:demo`.
