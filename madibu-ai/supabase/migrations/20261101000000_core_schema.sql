-- =============================================================================
-- MADIBU AI – schéma principal
-- Montants : numeric(14,2) (jamais de flottants). Montants HTVA par défaut, TVA séparée.
-- Sécurité : RLS activée sur toutes les tables exposées ; GRANT explicites uniquement.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------- types
create type public.app_role as enum ('owner','admin','finance','project_manager','site_manager','employee');
create type public.project_status as enum ('offer','signed','in_progress','on_hold','completed','handed_over','cancelled');
create type public.invoice_direction as enum ('issued','received');
create type public.invoice_kind as enum ('advance','progress','final','credit_note','standard');
create type public.invoice_status as enum ('draft','issued','received','approved','disputed','cancelled');
create type public.cost_category as enum ('materials','labour','subcontract','equipment','transport','overhead','other');
create type public.payment_direction as enum ('in','out');
create type public.payment_method as enum ('bank_transfer','direct_debit','card','cash','other');
create type public.task_status as enum ('todo','in_progress','waiting','completed','cancelled');
create type public.task_priority as enum ('low','normal','high','urgent');
create type public.record_source as enum ('manual','ai','import');
create type public.document_category as enum ('contract','quote','plan','technical','permit','invoice','photo','site_report','handover','other');
create type public.approval_action as enum ('send_email','issue_invoice','issue_credit_note','make_payment','order_materials',
  'sign_contract','financial_commitment','legal_commitment','modify_accounting','change_bank_details','other');
create type public.approval_status as enum ('pending','approved','rejected','executed','failed');
create type public.change_order_status as enum ('requested','quoted','approved','rejected');
create type public.obligation_kind as enum ('loan','credit_facility','leasing','salary','social_security','tax','rent','insurance','other');
create type public.frequency as enum ('once','monthly','quarterly','yearly');
create type public.alert_severity as enum ('info','warning','high','critical');
create type public.alert_status as enum ('open','acknowledged','resolved');
create type public.ai_run_kind as enum ('chat','analysis','report');
create type public.run_status as enum ('running','succeeded','failed');

-- ----------------------------------------------------------------------------- utilitaires
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ----------------------------------------------------------------------------- profils
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete restrict,
  full_name   text not null default '',
  email       text,
  role        public.app_role not null default 'employee',
  locale      text not null default 'fr' check (locale in ('fr','ro')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Fonctions d'autorisation (SECURITY DEFINER pour éviter la récursion RLS sur profiles)
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.role = any(roles) from public.profiles p where p.id = auth.uid() and p.active), false)
$$;

-- Nouvel utilisateur Auth → profil « employee » (le rôle est attribué ensuite par l'OWNER)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seul l'OWNER peut modifier rôle et activation ; chacun peut modifier son nom et sa langue.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email)
     and auth.uid() is not null and not public.has_role('owner') then
    raise exception 'Seul le propriétaire (OWNER) peut modifier les rôles et l''activation des comptes';
  end if;
  if old.role = 'owner' and new.role <> 'owner' and auth.uid() is not null
     and (select count(*) from public.profiles where role = 'owner' and active and id <> old.id) = 0 then
    raise exception 'Impossible de retirer le dernier OWNER';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile_update();
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------- tiers
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client_type   text not null default 'company' check (client_type in ('company','individual','public')),
  vat_number    text,
  email         text,
  phone         text,
  address       text,
  contact_person text,
  payment_terms_days int check (payment_terms_days between 0 and 180),
  notes         text,
  archived_at   timestamptz,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  vat_number    text,
  email         text,
  phone         text,
  address       text,
  contact_person text,
  categories    text[] not null default '{}',
  payment_terms_days int check (payment_terms_days between 0 and 180),
  notes         text,
  archived_at   timestamptz,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.subcontractors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  trade         text,
  vat_number    text,
  email         text,
  phone         text,
  address       text,
  contact_person text,
  payment_terms_days int check (payment_terms_days between 0 and 180),
  insurance_valid_until date,
  notes         text,
  archived_at   timestamptz,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  job_title     text,
  email         text,
  phone         text,
  hourly_cost   numeric(10,2) check (hourly_cost >= 0),   -- coût employeur horaire HTVA
  profile_id    uuid unique references public.profiles(id) on delete set null,
  active        boolean not null default true,
  hired_on      date,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------- chantiers
create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,
  name                   text not null,
  client_id              uuid references public.clients(id) on delete restrict,
  site_address           text,
  architect_name         text,
  architect_email        text,
  architect_phone        text,
  engineer_name          text,
  engineer_email         text,
  status                 public.project_status not null default 'offer',
  contract_amount_excl   numeric(14,2) check (contract_amount_excl >= 0),  -- NULL = inconnu (jamais inventé)
  vat_rate               numeric(5,2) check (vat_rate in (0, 6, 12, 21)),
  start_date             date,
  planned_end_date       date,
  actual_end_date        date,
  progress_pct           numeric(5,2) check (progress_pct between 0 and 100),
  progress_updated_at    timestamptz,
  budget_materials       numeric(14,2) check (budget_materials >= 0),
  budget_labour          numeric(14,2) check (budget_labour >= 0),
  budget_subcontract     numeric(14,2) check (budget_subcontract >= 0),
  budget_other           numeric(14,2) check (budget_other >= 0),
  forecast_cost_override numeric(14,2) check (forecast_cost_override >= 0), -- prévision manuelle du coût final
  project_manager_id     uuid references public.profiles(id) on delete set null,
  site_manager_id        uuid references public.profiles(id) on delete set null,
  notes                  text,
  archived_at            timestamptz,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (planned_end_date is null or start_date is null or planned_end_date >= start_date)
);

create table public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create or replace function public.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m where m.project_id = p_project and m.profile_id = auth.uid()
  ) or exists (
    select 1 from public.projects p where p.id = p_project and auth.uid() in (p.project_manager_id, p.site_manager_id)
  )
$$;

-- Accès « bureau » : voit tous les chantiers ; sinon uniquement les chantiers assignés
create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','admin','finance','project_manager')
      or (public.has_role('site_manager','employee') and public.is_project_member(p_project))
$$;

-- Avenants / travaux supplémentaires (accord écrit du client requis)
create table public.change_orders (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete restrict,
  description   text not null,
  amount_excl   numeric(14,2) check (amount_excl >= 0),
  status        public.change_order_status not null default 'requested',
  work_started  boolean not null default false,
  requested_on  date not null default current_date,
  approved_on   date,
  approval_document_id uuid,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'approved' or approved_on is not null)
);

-- ----------------------------------------------------------------------------- finances
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  direction        public.invoice_direction not null,
  number           text not null,
  kind             public.invoice_kind not null default 'standard',
  project_id       uuid references public.projects(id) on delete restrict,
  client_id        uuid references public.clients(id) on delete restrict,
  supplier_id      uuid references public.suppliers(id) on delete restrict,
  subcontractor_id uuid references public.subcontractors(id) on delete restrict,
  cost_category    public.cost_category,           -- pour les factures reçues : poste de coût
  issue_date       date not null,
  due_date         date not null,
  amount_excl      numeric(14,2) not null check (amount_excl >= 0),
  vat_rate         numeric(5,2) not null check (vat_rate in (0, 6, 12, 21)),
  vat_amount       numeric(14,2) not null check (vat_amount >= 0),
  amount_total     numeric(14,2) generated always as (amount_excl + vat_amount) stored,
  status           public.invoice_status not null,
  source           public.record_source not null default 'manual',
  notes            text,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (due_date >= issue_date),
  check (
    (direction = 'issued' and client_id is not null and supplier_id is null and subcontractor_id is null
       and status in ('draft','issued','disputed','cancelled'))
    or
    (direction = 'received' and client_id is null and num_nonnulls(supplier_id, subcontractor_id) = 1
       and status in ('received','approved','disputed','cancelled') and cost_category is not null)
  )
);
create unique index invoices_issued_number_uq on public.invoices(number) where direction = 'issued';
create unique index invoices_received_number_uq on public.invoices(coalesce(supplier_id, subcontractor_id), number) where direction = 'received';

-- Dépenses sans facture d'achat (main-d'œuvre interne, achats comptant, carburant...)
create table public.expenses (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid references public.projects(id) on delete restrict,
  category         public.cost_category not null,
  description      text not null,
  supplier_id      uuid references public.suppliers(id) on delete restrict,
  subcontractor_id uuid references public.subcontractors(id) on delete restrict,
  employee_id      uuid references public.employees(id) on delete restrict,
  expense_date     date not null,
  hours            numeric(8,2) check (hours >= 0),
  amount_excl      numeric(14,2) not null check (amount_excl >= 0),
  vat_rate         numeric(5,2) not null default 0 check (vat_rate in (0, 6, 12, 21)),
  vat_amount       numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_total     numeric(14,2) generated always as (amount_excl + vat_amount) stored,
  -- 'payroll' : main-d'œuvre interne réglée via les salaires (obligations) – n'est pas une dette fournisseur
  settlement       text not null default 'payable' check (settlement in ('payable','payroll')),
  source           public.record_source not null default 'manual',
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Obligations récurrentes : prêts, crédits, leasings, salaires, ONSS, TVA, loyers, assurances
create table public.recurring_obligations (
  id             uuid primary key default gen_random_uuid(),
  kind           public.obligation_kind not null,
  label          text not null,
  counterparty   text,
  amount         numeric(14,2) not null check (amount > 0),
  frequency      public.frequency not null,
  next_due_date  date not null,
  end_date       date,
  active         boolean not null default true,
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Paiements réels (entrants / sortants). Une facture n'est payée que par des paiements enregistrés ici.
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  direction      public.payment_direction not null,
  amount         numeric(14,2) not null check (amount > 0),
  payment_date   date not null,
  invoice_id     uuid references public.invoices(id) on delete restrict,
  expense_id     uuid references public.expenses(id) on delete restrict,
  obligation_id  uuid references public.recurring_obligations(id) on delete restrict,
  project_id     uuid references public.projects(id) on delete restrict,
  method         public.payment_method not null default 'bank_transfer',
  reference      text,
  reconciled     boolean not null default false,
  notes          text,
  source         public.record_source not null default 'manual',
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (num_nonnulls(invoice_id, expense_id, obligation_id) <= 1),
  check (direction = 'out' or (expense_id is null and obligation_id is null))
);

-- Cohérence des paiements : sens ↔ type de facture, pas de surpaiement, chantier hérité
create or replace function public.validate_payment() returns trigger
language plpgsql set search_path = '' as $$
declare
  inv record; paid numeric(14,2); exp record;
begin
  if new.invoice_id is not null then
    select * into inv from public.invoices where id = new.invoice_id;
    if inv.status in ('cancelled','draft') then
      raise exception 'Paiement impossible sur une facture % ', inv.status;
    end if;
    if (inv.direction = 'issued' and new.direction <> 'in') or (inv.direction = 'received' and new.direction <> 'out') then
      raise exception 'Sens du paiement incohérent avec la facture';
    end if;
    select coalesce(sum(amount), 0) into paid from public.payments
      where invoice_id = new.invoice_id and id <> new.id;
    if paid + new.amount > inv.amount_total then
      raise exception 'Le paiement (%) dépasse le solde de la facture % (%)', new.amount, inv.number, inv.amount_total - paid;
    end if;
    new.project_id := coalesce(new.project_id, inv.project_id);
  elsif new.expense_id is not null then
    select * into exp from public.expenses where id = new.expense_id;
    select coalesce(sum(amount), 0) into paid from public.payments where expense_id = new.expense_id and id <> new.id;
    if paid + new.amount > exp.amount_total then
      raise exception 'Le paiement dépasse le montant de la dépense';
    end if;
    new.project_id := coalesce(new.project_id, exp.project_id);
  end if;
  return new;
end $$;
create trigger payments_validate before insert or update on public.payments
  for each row execute function public.validate_payment();

-- Soldes bancaires saisis manuellement (aucune connexion bancaire en phase 1)
create table public.bank_balances (
  id            uuid primary key default gen_random_uuid(),
  account_label text not null,
  balance       numeric(14,2) not null,
  as_of         date not null,
  source        text not null default 'manual' check (source in ('manual','import','bank_feed')),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_label, as_of)
);

-- ----------------------------------------------------------------------------- tâches, documents
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(title) between 1 and 300),
  description  text,
  project_id   uuid references public.projects(id) on delete restrict,
  assigned_to  uuid references public.profiles(id) on delete set null,
  priority     public.task_priority not null default 'normal',
  status       public.task_status not null default 'todo',
  due_date     date,
  source       public.record_source not null default 'manual',
  alert_key    text,
  completed_at timestamptz,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- une seule tâche ouverte par alerte (dédoublonnage des tâches automatiques)
create unique index tasks_alert_open_uq on public.tasks(alert_key)
  where alert_key is not null and status in ('todo','in_progress','waiting');

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete restrict,
  name          text not null,
  category      public.document_category not null default 'other',
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  uploaded_by   uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.change_orders add constraint change_orders_doc_fk
  foreign key (approval_document_id) references public.documents(id) on delete set null;

-- ----------------------------------------------------------------------------- IA, alertes, approbations
create table public.ai_runs (
  id              uuid primary key default gen_random_uuid(),
  kind            public.ai_run_kind not null,
  trigger         text not null check (trigger in ('manual','schedule','chat')),
  triggered_by    uuid references public.profiles(id) on delete set null,
  status          public.run_status not null default 'running',
  idempotency_key text unique,
  model           text,
  input_summary   text,
  output_summary  text,
  tool_calls      jsonb not null default '[]',
  input_tokens    int,
  output_tokens   int,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.alerts (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  agent          text not null,
  category       text not null,
  severity       public.alert_severity not null,
  title          text not null,            -- que s'est-il passé ?
  why            text,                     -- pourquoi est-ce important ?
  impact_amount  numeric(14,2),            -- impact financier chiffré (si calculable)
  recommendation text,                     -- que faut-il faire ?
  responsible    text,                     -- qui ?
  due_date       date,                     -- pour quand ?
  project_id     uuid references public.projects(id) on delete cascade,
  entity_table   text,
  entity_id      uuid,
  status         public.alert_status not null default 'open',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('daily_financial','weekly_projects','daily_admin')),
  report_date  date not null,
  title        text not null,
  content_md   text not null,
  data         jsonb not null default '{}',
  ai_run_id    uuid references public.ai_runs(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (kind, report_date)
);

create table public.approvals (
  id               uuid primary key default gen_random_uuid(),
  action_type      public.approval_action not null,
  title            text not null,
  payload          jsonb not null default '{}',
  justification    text,
  project_id       uuid references public.projects(id) on delete set null,
  status           public.approval_status not null default 'pending',
  requested_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_by_ai  boolean not null default false,
  ai_run_id        uuid references public.ai_runs(id) on delete set null,
  decided_by       uuid references public.profiles(id) on delete set null,
  decided_at       timestamptz,
  decision_note    text,
  executed_by      uuid references public.profiles(id) on delete set null,
  executed_at      timestamptz,
  execution_result text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Décision humaine : seule voie pour changer le statut d'une approbation.
-- - réservé à OWNER / ADMIN, et FINANCE pour les actions financières ;
-- - une demande ne peut jamais être approuvée par l'IA (appel sans utilisateur authentifié refusé) ;
-- - une demande humaine ne peut pas être approuvée par son propre demandeur, sauf OWNER.
create or replace function public.decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns public.approvals
language plpgsql security definer set search_path = '' as $$
declare
  a public.approvals; uid uuid := auth.uid(); r public.app_role;
begin
  if uid is null then raise exception 'Décision réservée à un utilisateur humain authentifié'; end if;
  r := public.current_app_role();
  select * into a from public.approvals where id = p_id for update;
  if not found then raise exception 'Demande introuvable'; end if;
  if a.status <> 'pending' then raise exception 'Demande déjà traitée (%)', a.status; end if;
  if r is null or r not in ('owner','admin','finance') then
    raise exception 'Droits insuffisants pour décider';
  end if;
  if r = 'finance' and a.action_type not in ('make_payment','issue_invoice','issue_credit_note','send_email','financial_commitment','modify_accounting') then
    raise exception 'FINANCE ne peut décider que des actions financières';
  end if;
  if not a.requested_by_ai and a.requested_by = uid and r <> 'owner' then
    raise exception 'Le demandeur ne peut pas approuver sa propre demande';
  end if;
  update public.approvals
     set status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end,
         decided_by = uid, decided_at = now(), decision_note = p_note
   where id = p_id returning * into a;
  return a;
end $$;

-- Enregistrement du résultat d'exécution d'une action approuvée (par un humain habilité)
create or replace function public.record_approval_execution(p_id uuid, p_success boolean, p_result text)
returns public.approvals
language plpgsql security definer set search_path = '' as $$
declare a public.approvals; uid uuid := auth.uid();
begin
  if uid is null or not public.has_role('owner','admin','finance') then
    raise exception 'Droits insuffisants';
  end if;
  update public.approvals
     set status = case when p_success then 'executed'::public.approval_status else 'failed'::public.approval_status end,
         executed_by = uid, executed_at = now(), execution_result = p_result
   where id = p_id and status = 'approved' returning * into a;
  if not found then raise exception 'Seule une demande approuvée peut être exécutée'; end if;
  return a;
end $$;

-- Garde-fou : aucune modification directe du statut ni des champs de décision hors des fonctions ci-dessus
create or replace function public.guard_approval_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.status, new.decided_by, new.decided_at, new.executed_at, new.requested_by_ai, new.payload::text, new.action_type)
         is distinct from (old.status, old.decided_by, old.decided_at, old.executed_at, old.requested_by_ai, old.payload::text, old.action_type)
     and current_user not in ('postgres', 'supabase_admin') then
    -- les fonctions SECURITY DEFINER s'exécutent en tant que propriétaire (postgres) et passent ce contrôle
    raise exception 'Les approbations ne se modifient que via decide_approval / record_approval_execution';
  end if;
  return new;
end $$;
create trigger approvals_guard before update on public.approvals for each row execute function public.guard_approval_update();

create or replace function public.guard_approval_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('postgres','supabase_admin','service_role') then
    if new.status <> 'pending' or new.decided_by is not null or new.executed_at is not null then
      raise exception 'Une demande d''approbation est toujours créée au statut « pending »';
    end if;
    new.requested_by := auth.uid();
  end if;
  return new;
end $$;
create trigger approvals_guard_insert before insert on public.approvals for each row execute function public.guard_approval_insert();

-- ----------------------------------------------------------------------------- audit (en ajout seul)
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,
  actor_type  text not null check (actor_type in ('user','ai','system')),
  action      text not null,
  table_name  text,
  record_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hdr text := coalesce(current_setting('request.headers', true), '{}');
  actor text;
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  actor := case
    when (hdr::jsonb ->> 'x-madibu-actor') = 'ai' or rec ->> 'source' = 'ai' or (rec ->> 'requested_by_ai')::boolean then 'ai'
    when auth.uid() is null then 'system'
    else 'user' end;
  insert into public.audit_logs(actor_id, actor_type, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), actor, lower(tg_op), tg_table_name, (rec ->> 'id')::uuid,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create or replace function public.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Le journal d''audit est en ajout seul';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_immutable();

-- ----------------------------------------------------------------------------- triggers communs
do $$
declare t text;
begin
  foreach t in array array['clients','suppliers','subcontractors','employees','projects','change_orders','invoices',
                           'expenses','recurring_obligations','payments','bank_balances','tasks','documents',
                           'ai_runs','alerts','reports','approvals']
  loop
    execute format('create trigger %1$s_updated before update on public.%1$s for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['profiles','clients','suppliers','subcontractors','employees','projects','project_members',
                           'change_orders','invoices','expenses','recurring_obligations','payments','bank_balances',
                           'tasks','documents','approvals']
  loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- tâches : horodatage de clôture
create or replace function public.task_completed_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then new.completed_at := now();
  elsif new.status <> 'completed' then new.completed_at := null; end if;
  return new;
end $$;
create trigger tasks_completed before insert or update on public.tasks for each row execute function public.task_completed_at();

-- avancement : horodatage de mise à jour
create or replace function public.project_progress_ts() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.progress_pct is not null then new.progress_updated_at := now();
  elsif tg_op = 'UPDATE' and new.progress_pct is distinct from old.progress_pct then new.progress_updated_at := now(); end if;
  return new;
end $$;
create trigger projects_progress before insert or update on public.projects for each row execute function public.project_progress_ts();

-- Mise à jour de l'avancement par un chef de chantier assigné (sans droit d'édition complet)
create or replace function public.update_project_progress(p_project uuid, p_progress numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_role('owner','admin','project_manager') or (public.has_role('site_manager') and public.is_project_member(p_project))) then
    raise exception 'Droits insuffisants';
  end if;
  if p_progress < 0 or p_progress > 100 then raise exception 'Avancement entre 0 et 100'; end if;
  update public.projects set progress_pct = p_progress where id = p_project;
end $$;

-- ----------------------------------------------------------------------------- index
create index projects_client_idx on public.projects(client_id);
create index projects_status_idx on public.projects(status) where archived_at is null;
create index invoices_project_idx on public.invoices(project_id);
create index invoices_due_idx on public.invoices(direction, due_date) where status not in ('cancelled','draft');
create index invoices_client_idx on public.invoices(client_id);
create index invoices_supplier_idx on public.invoices(supplier_id);
create index invoices_sub_idx on public.invoices(subcontractor_id);
create index expenses_project_idx on public.expenses(project_id);
create index payments_invoice_idx on public.payments(invoice_id);
create index payments_expense_idx on public.payments(expense_id);
create index payments_project_idx on public.payments(project_id);
create index payments_date_idx on public.payments(payment_date);
create index tasks_assignee_idx on public.tasks(assigned_to) where status in ('todo','in_progress','waiting');
create index tasks_project_idx on public.tasks(project_id);
create index documents_project_idx on public.documents(project_id);
create index alerts_status_idx on public.alerts(status, severity);
create index approvals_status_idx on public.approvals(status);
create index ai_runs_user_idx on public.ai_runs(triggered_by, started_at desc);
create index change_orders_project_idx on public.change_orders(project_id);

-- ----------------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.suppliers enable row level security;
alter table public.subcontractors enable row level security;
alter table public.employees enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.change_orders enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.recurring_obligations enable row level security;
alter table public.payments enable row level security;
alter table public.bank_balances enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.ai_runs enable row level security;
alter table public.alerts enable row level security;
alter table public.reports enable row level security;
alter table public.approvals enable row level security;
alter table public.audit_logs enable row level security;

-- profils
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('owner','admin','finance','project_manager'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_role('owner')) with check (id = auth.uid() or public.has_role('owner'));

-- tiers : bureau en lecture ; écriture selon le métier
create policy clients_select on public.clients for select to authenticated
  using (public.has_role('owner','admin','finance','project_manager')
         or exists (select 1 from public.projects p where p.client_id = clients.id and public.is_project_member(p.id)));
create policy clients_write on public.clients for all to authenticated
  using (public.has_role('owner','admin','project_manager')) with check (public.has_role('owner','admin','project_manager'));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_role('owner','admin','finance','project_manager','site_manager'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_role('owner','admin','finance','project_manager')) with check (public.has_role('owner','admin','finance','project_manager'));

create policy subcontractors_select on public.subcontractors for select to authenticated
  using (public.has_role('owner','admin','finance','project_manager','site_manager'));
create policy subcontractors_write on public.subcontractors for all to authenticated
  using (public.has_role('owner','admin','finance','project_manager')) with check (public.has_role('owner','admin','finance','project_manager'));

-- employés : données RH visibles par la direction et la finance (coûts horaires)
create policy employees_select on public.employees for select to authenticated
  using (public.has_role('owner','admin','finance','project_manager') or profile_id = auth.uid());
create policy employees_write on public.employees for all to authenticated
  using (public.has_role('owner','admin')) with check (public.has_role('owner','admin'));

-- chantiers
create policy projects_select on public.projects for select to authenticated using (public.can_view_project(id));
create policy projects_insert on public.projects for insert to authenticated with check (public.has_role('owner','admin','project_manager'));
create policy projects_update on public.projects for update to authenticated
  using (public.has_role('owner','admin','project_manager')) with check (public.has_role('owner','admin','project_manager'));
-- pas de suppression : les chantiers sont archivés (archived_at)

create policy members_select on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy members_write on public.project_members for all to authenticated
  using (public.has_role('owner','admin','project_manager')) with check (public.has_role('owner','admin','project_manager'));

create policy change_orders_select on public.change_orders for select to authenticated using (public.can_view_project(project_id));
create policy change_orders_write on public.change_orders for all to authenticated
  using (public.has_role('owner','admin','project_manager')) with check (public.has_role('owner','admin','project_manager'));

-- finances : OWNER/ADMIN/FINANCE ; PROJECT_MANAGER en lecture (+ saisie des dépenses chantier)
create policy invoices_select on public.invoices for select to authenticated
  using (public.has_role('owner','admin','finance') or (public.has_role('project_manager') and project_id is not null));
create policy invoices_write on public.invoices for all to authenticated
  using (public.has_role('owner','admin','finance')) with check (public.has_role('owner','admin','finance'));

create policy expenses_select on public.expenses for select to authenticated
  using (public.has_role('owner','admin','finance') or (public.has_role('project_manager') and project_id is not null));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_role('owner','admin','finance') or (public.has_role('project_manager') and project_id is not null));
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_role('owner','admin','finance')) with check (public.has_role('owner','admin','finance'));
create policy expenses_delete on public.expenses for delete to authenticated using (public.has_role('owner','admin'));

create policy payments_select on public.payments for select to authenticated
  using (public.has_role('owner','admin','finance') or (public.has_role('project_manager') and project_id is not null));
create policy payments_write on public.payments for all to authenticated
  using (public.has_role('owner','admin','finance')) with check (public.has_role('owner','admin','finance'));

create policy obligations_select on public.recurring_obligations for select to authenticated using (public.has_role('owner','admin','finance'));
create policy obligations_write on public.recurring_obligations for all to authenticated
  using (public.has_role('owner','finance')) with check (public.has_role('owner','finance'));

create policy bank_select on public.bank_balances for select to authenticated using (public.has_role('owner','admin','finance'));
create policy bank_write on public.bank_balances for all to authenticated
  using (public.has_role('owner','finance')) with check (public.has_role('owner','finance'));

-- tâches : bureau = tout ; terrain = tâches assignées ou de ses chantiers
create policy tasks_select on public.tasks for select to authenticated
  using (public.has_role('owner','admin','finance','project_manager') or assigned_to = auth.uid()
         or (project_id is not null and public.has_role('site_manager') and public.is_project_member(project_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.has_role('owner','admin','finance','project_manager')
              or (public.has_role('site_manager') and project_id is not null and public.is_project_member(project_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (public.has_role('owner','admin','finance','project_manager') or assigned_to = auth.uid()
         or (project_id is not null and public.has_role('site_manager') and public.is_project_member(project_id)))
  with check (public.has_role('owner','admin','finance','project_manager') or assigned_to = auth.uid()
         or (project_id is not null and public.has_role('site_manager') and public.is_project_member(project_id)));
create policy tasks_delete on public.tasks for delete to authenticated using (public.has_role('owner','admin'));

-- documents
create policy documents_select on public.documents for select to authenticated
  using (case when project_id is null then public.has_role('owner','admin','finance','project_manager')
              else public.can_view_project(project_id) end);
create policy documents_insert on public.documents for insert to authenticated
  with check (case when project_id is null then public.has_role('owner','admin','finance','project_manager')
                   else public.can_view_project(project_id) and not public.has_role('employee') end);
create policy documents_delete on public.documents for delete to authenticated using (public.has_role('owner','admin'));

-- IA, alertes, rapports
create policy ai_runs_select on public.ai_runs for select to authenticated
  using (triggered_by = auth.uid() or public.has_role('owner','admin'));
create policy ai_runs_insert on public.ai_runs for insert to authenticated with check (triggered_by = auth.uid());
create policy ai_runs_update on public.ai_runs for update to authenticated
  using (triggered_by = auth.uid()) with check (triggered_by = auth.uid());

create policy alerts_select on public.alerts for select to authenticated
  using (public.has_role('owner','admin','finance') or
         (public.has_role('project_manager') and category <> 'finance') or
         (project_id is not null and public.has_role('site_manager') and public.is_project_member(project_id) and category <> 'finance'));
create policy alerts_ack on public.alerts for update to authenticated
  using (public.has_role('owner','admin','finance','project_manager')) with check (true);

create policy reports_select on public.reports for select to authenticated
  using (public.has_role('owner','admin','finance') or (kind = 'weekly_projects' and public.has_role('project_manager')));

-- approbations
create policy approvals_select on public.approvals for select to authenticated
  using (public.has_role('owner','admin','finance') or requested_by = auth.uid());
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.has_role('owner','admin','finance','project_manager'));
-- pas de policy UPDATE/DELETE : décisions uniquement via decide_approval / record_approval_execution

-- audit : lecture OWNER/ADMIN ; aucune écriture directe
create policy audit_select on public.audit_logs for select to authenticated using (public.has_role('owner','admin'));

-- ----------------------------------------------------------------------------- GRANT explicites
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.clients, public.suppliers, public.subcontractors, public.employees,
  public.projects, public.change_orders, public.invoices, public.expenses, public.recurring_obligations,
  public.payments, public.bank_balances, public.tasks to authenticated;
grant select, insert, delete on public.project_members, public.documents to authenticated;
grant delete on public.expenses, public.tasks, public.change_orders to authenticated;
grant select, insert, update on public.ai_runs to authenticated;
grant select on public.alerts to authenticated;
grant update (status, resolved_at) on public.alerts to authenticated;
grant select on public.reports to authenticated;
grant select, insert on public.approvals to authenticated;
grant select on public.audit_logs to authenticated;
revoke update, delete on public.audit_logs from service_role;
grant insert on public.audit_logs to service_role;
grant execute on function public.decide_approval(uuid, boolean, text), public.record_approval_execution(uuid, boolean, text),
  public.update_project_progress(uuid, numeric), public.has_role(public.app_role[]), public.current_app_role(),
  public.can_view_project(uuid), public.is_project_member(uuid) to authenticated;
revoke execute on function public.decide_approval(uuid, boolean, text), public.record_approval_execution(uuid, boolean, text) from anon, public;

-- ----------------------------------------------------------------------------- stockage des documents
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

-- chemin : <project_id ou 'general'>/<uuid>-<nom>
create policy documents_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    case when (storage.foldername(name))[1] = 'general' then public.has_role('owner','admin','finance','project_manager')
         else public.can_view_project(((storage.foldername(name))[1])::uuid) end));
create policy documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and not public.has_role('employee') and (
    case when (storage.foldername(name))[1] = 'general' then public.has_role('owner','admin','finance','project_manager')
         else public.can_view_project(((storage.foldername(name))[1])::uuid) end));
create policy documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.has_role('owner','admin'));
