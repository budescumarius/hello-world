# MADIBU AI

Plateforme de gestion pour **MADIBU GROUP** (construction et rénovation, Belgique) : chantiers, contrôle financier, tâches,
documents, agents d'analyse automatiques, assistant IA (Claude) et centre d'approbation humaine.

> Interface en **français** (par défaut) et **roumain**. Montants en EUR, rentabilité **HTVA** (TVA stockée à part),
> fuseau **Europe/Brussels**.

## Ce qui fonctionne (MVP, testé)

| Module | Contenu |
|---|---|
| Connexion | Supabase Auth (e-mail + mot de passe), inscriptions publiques désactivées, comptes créés par l'OWNER |
| Tableau de bord | Chantiers actifs, contrats signés, **facturé ≠ encaissé**, créances / dettes ouvertes, coûts engagés ≠ payés, tâches (en retard), alertes IA, trésorerie prévisionnelle |
| Chantiers | Création, modification, archivage, fiche à onglets (vue d'ensemble, finances, tâches, documents, activité), avenants, avancement, équipe |
| Finances | Factures clients et fournisseurs, dépenses, paiements partiels, balance âgée, rentabilité par chantier, prévisions **optimiste / réaliste / pessimiste à 7, 30 et 90 jours**, prêts / leasings / obligations, soldes bancaires saisis manuellement |
| Tiers | Clients, fournisseurs, sous-traitants (assurance), employés (coût horaire) |
| Tâches | Liste et Kanban, filtres (mes tâches, en retard, créées par l'IA) |
| Documents | Stockage privé Supabase, accès par chantier, liens signés de 60 s |
| Analyse automatique | Agents contrôleur financier, chef de projet, assistant administratif → alertes (quoi / pourquoi / impact / action / qui / quand), tâches, rappels de paiement **en attente d'approbation**, rapport « MADIBU – DAILY FINANCIAL REPORT », rapport hebdomadaire des chantiers |
| Assistant IA | Claude avec outils serveur validés (Zod), exécutés avec la session de l'utilisateur (RLS) |
| Approbations | Toute action externe ou à fort impact attend une décision humaine ; une demande IA ne peut jamais s'auto-approuver (contrôle PostgreSQL) |
| Import / export | Import CSV chantiers, factures, dépenses (validation complète avant écriture) ; export CSV financier et chantiers |
| Audit | Journal en ajout seul alimenté par triggers sur toutes les tables métier |

**Non implémenté à ce stade** (voir [docs/ROADMAP.md](docs/ROADMAP.md)) : connexion Outlook / Calendar / SharePoint,
envoi réel d'e-mails, flux bancaires, achats / bons de commande, rapports journaliers de chantier, métrés et devis.
Ces actions ne sont **pas simulées** : après approbation, l'application indique qu'elles sont à exécuter manuellement.

## Démarrage local

Prérequis : Node.js 22+, Docker (pour Supabase local).

```bash
npm install
cp .env.example .env.local          # puis compléter avec `npx supabase status -o env`
npm run db:start                    # démarre Supabase et applique les migrations
DEMO_PASSWORD='choisir-un-mot-de-passe' npm run seed:demo   # données SYNTHÉTIQUES (local uniquement)
npm run dev                         # http://localhost:3000
```

Comptes de démonstration (mot de passe = `DEMO_PASSWORD`) : `owner@madibu.test`, `admin@madibu.test`,
`finance@madibu.test`, `project.manager@madibu.test`, `site.manager@madibu.test`, `employee@madibu.test`.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | Développement, build et serveur de production |
| `npm run lint` / `typecheck` | ESLint, TypeScript |
| `npm test` | Vitest : règles financières et agents (unitaires) + sécurité RLS et assistant IA (base locale) |
| `npm run test:e2e` | Playwright : parcours complets (bureau + mobile). Nécessite base réinitialisée + seed + `DEMO_PASSWORD` |
| `npm run db:reset` | Réinitialise la base locale (migrations) |
| `npm run seed:demo` | Charge les données de démonstration (refuse une base non locale) |

## Analyse planifiée

`GET /api/cron/daily` avec `Authorization: Bearer $CRON_SECRET` : exécute tous les agents, une seule fois par jour
(clé d'idempotence). À appeler chaque matin depuis Vercel Cron, Supabase `pg_cron` + `pg_net`, Power Automate ou un cron système.
Le bouton « Lancer l'analyse » permet une exécution manuelle (OWNER, ADMIN, FINANCE).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – analyse des besoins, architecture, agents, intégrations
- [docs/DATABASE.md](docs/DATABASE.md) – schéma, règles financières, RLS
- [docs/SECURITY.md](docs/SECURITY.md) – rôles, risques, mesures, RGPD
- [docs/ROADMAP.md](docs/ROADMAP.md) – phases réalisées et suivantes
- [CLAUDE.md](CLAUDE.md) – conventions pour le développement assisté
