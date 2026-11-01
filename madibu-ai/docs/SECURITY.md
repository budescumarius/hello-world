# Sécurité et protection des données

## Mesures en place
| Risque | Mesure | Vérifié par |
|---|---|---|
| Accès non authentifié | `proxy.ts` redirige / renvoie 401 ; chaque page et route vérifie la session côté serveur (`supabase.auth.getUser()`) | E2E « Authentification et accès » |
| Inscription d'inconnus | inscriptions publiques désactivées (`[auth] enable_signup = false`) ; comptes créés par l'OWNER | testé manuellement (422 `signup_disabled`) |
| Mots de passe faibles | 12 caractères minimum (Supabase Auth + formulaire) | config |
| Élévation de privilèges | rôle modifiable uniquement par l'OWNER (trigger) ; dernier OWNER protégé | `rls.test.ts` |
| Fuite de données entre rôles | RLS sur toutes les tables, GRANT explicites, aucune table exposée par défaut ; l'IA utilise la session de l'utilisateur | `rls.test.ts`, `ai-assistant.test.ts` |
| Action non autorisée de l'IA | outils limités ; actions sensibles = demandes `pending` ; `decide_approval` refuse tout appel sans utilisateur humain habilité (y compris rôle service) ; aucune mise à jour directe des approbations | `rls.test.ts`, E2E approbations |
| Données financières incohérentes | contraintes CHECK, trigger anti-surpaiement, montants `numeric`, centimes entiers côté application | tests unitaires et E2E |
| Injection / entrées invalides | Zod sur formulaires, CSV et outils IA ; requêtes paramétrées (PostgREST / pg) ; rendu Markdown sans HTML brut | tests |
| Effacement de traces | journal d'audit en ajout seul, non modifiable même par le rôle service | `rls.test.ts` |
| Fichiers | bucket privé, politiques par chantier, types autorisés, 25 Mo max, liens signés de 60 s | E2E Documents |
| Abus de l'IA / coûts | limite 20 requêtes / 10 min / utilisateur, 8 tours d'outils, historique tronqué | code |
| Planificateur | `CRON_SECRET` (≥ 16 caractères, comparaison à temps constant), idempotence quotidienne | E2E + test manuel |
| Secrets | `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET` lus uniquement côté serveur (`server-only`) ; `.env*` ignorés par git | revue |
| En-têtes | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, pas de `X-Powered-By` | code |

## Risques résiduels / à traiter avant production
- **Limitation de débit générale** : seule l'IA est limitée en base ; la connexion est limitée par Supabase Auth. Ajouter une limite globale (plateforme d'hébergement ou WAF).
- **Content-Security-Policy** non encore définie (nécessite des nonces avec Next.js).
- **MFA** : disponible dans Supabase Auth, à activer pour OWNER/ADMIN/FINANCE.
- **Sauvegardes** : activer les sauvegardes quotidiennes / PITR du projet Supabase.
- **Hébergement UE** : choisir une région Supabase et Vercel en Europe (ex. Francfort) ; vérifier les DPA.
- **Données de démonstration** : le script refuse une base non locale ; ne jamais déployer avec des comptes `*.test`.

## RGPD
- Données personnelles traitées : contacts clients/fournisseurs, employés (coût horaire), utilisateurs.
- Minimisation : pas de données bancaires de tiers, pas de numéro national.
- Envoi à l'API Claude : seules les données nécessaires à la question, sur demande d'un utilisateur ; vérifier les conditions de conservation de l'API et les mentionner dans le registre des traitements.
- Droits d'accès / rectification : via l'interface ; l'effacement doit tenir compte des obligations comptables (conservation 7 ans en Belgique) – archiver plutôt que supprimer.
