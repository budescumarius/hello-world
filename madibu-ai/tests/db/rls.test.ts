/**
 * Tests de sécurité au niveau base de données (RLS, garde-fous, audit).
 * Exécutés contre la base Supabase locale (DATABASE_URL) ; chaque test est annulé (ROLLBACK).
 * Ignorés si aucune base n'est disponible.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local" });
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

let db: Client;
type Role = "owner" | "admin" | "finance" | "project_manager" | "site_manager" | "employee";

async function makeUser(role: Role) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')", [id, `${role}-${id.slice(0, 6)}@test.local`]);
  await db.query("update public.profiles set role = $2 where id = $1", [id, role]);
  return id;
}
async function as(userId: string | null) {
  await db.query("reset role");
  if (userId) {
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify({ sub: userId, role: "authenticated" }), userId]);
    await db.query("set local role authenticated");
  }
}
async function tx(fn: () => Promise<void>) {
  await db.query("begin");
  try { await fn(); } finally { await db.query("rollback"); }
}
async function fails(sql: string, params: unknown[] = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, params);
    await db.query("release savepoint s");
    return false;
  } catch {
    await db.query("rollback to savepoint s");
    return true;
  }
}

d("RLS et garde-fous PostgreSQL", () => {
  beforeAll(async () => { db = new Client({ connectionString: url }); await db.connect(); });
  afterAll(async () => { await db?.end(); });

  async function fixture() {
    const ids = {
      owner: await makeUser("owner"), finance: await makeUser("finance"), pm: await makeUser("project_manager"),
      site: await makeUser("site_manager"), emp: await makeUser("employee"), admin: await makeUser("admin"),
    };
    const client = (await db.query("insert into public.clients (name, email) values ('Client test', 'c@test.local') returning id")).rows[0].id;
    const p1 = (await db.query("insert into public.projects (reference, name, client_id, status, contract_amount_excl) values ($1,'Chantier A',$2,'in_progress',100000) returning id", [`T-${randomUUID().slice(0, 8)}`, client])).rows[0].id;
    const p2 = (await db.query("insert into public.projects (reference, name, client_id, status) values ($1,'Chantier B',$2,'in_progress') returning id", [`T-${randomUUID().slice(0, 8)}`, client])).rows[0].id;
    await db.query("insert into public.project_members (project_id, profile_id) values ($1, $2)", [p1, ids.site]);
    const inv = (await db.query(`insert into public.invoices (direction, number, project_id, client_id, issue_date, due_date, amount_excl, vat_rate, vat_amount, status)
      values ('issued', $1, $2, $3, '2026-09-01', '2026-10-01', 1000, 21, 210, 'issued') returning id`, [`F-${randomUUID().slice(0, 8)}`, p1, client])).rows[0].id;
    return { ...ids, client, p1, p2, inv };
  }

  it("un chef de chantier ne voit que ses chantiers et aucune donnée financière", () => tx(async () => {
    const f = await fixture();
    await as(f.site);
    const projects = (await db.query("select id from public.projects where id = any($1)", [[f.p1, f.p2]])).rows.map((r) => r.id);
    expect(projects).toEqual([f.p1]);
    expect((await db.query("select * from public.invoices")).rowCount).toBe(0);
    expect((await db.query("select * from public.bank_balances")).rowCount).toBe(0);
  }));

  it("un employé ne voit rien des finances ni des chantiers non assignés", () => tx(async () => {
    const f = await fixture();
    await as(f.emp);
    expect((await db.query("select * from public.projects where id = any($1)", [[f.p1, f.p2]])).rowCount).toBe(0);
    expect((await db.query("select * from public.payments")).rowCount).toBe(0);
    expect(await fails("insert into public.invoices (direction, number, client_id, issue_date, due_date, amount_excl, vat_rate, vat_amount, status) values ('issued','X',$1,'2026-01-01','2026-01-02',1,21,0,'issued')", [f.client])).toBe(true);
  }));

  it("la finance peut enregistrer un paiement, mais jamais au-delà du solde", () => tx(async () => {
    const f = await fixture();
    await as(f.finance);
    expect(await fails("insert into public.payments (direction, amount, payment_date, invoice_id) values ('in', 500, '2026-10-05', $1)", [f.inv])).toBe(false);
    expect(await fails("insert into public.payments (direction, amount, payment_date, invoice_id) values ('in', 800, '2026-10-06', $1)", [f.inv])).toBe(true);
    expect(await fails("insert into public.payments (direction, amount, payment_date, invoice_id) values ('out', 10, '2026-10-06', $1)", [f.inv])).toBe(true);
  }));

  it("un chef de projet ne peut pas écrire de facture ni de paiement", () => tx(async () => {
    const f = await fixture();
    await as(f.pm);
    expect(await fails("insert into public.payments (direction, amount, payment_date, invoice_id) values ('in', 10, '2026-10-05', $1)", [f.inv])).toBe(true);
    expect((await db.query("select id from public.invoices where id = $1", [f.inv])).rowCount).toBe(1); // lecture autorisée
  }));

  it("seul l'OWNER peut changer un rôle", () => tx(async () => {
    const f = await fixture();
    await as(f.admin);
    expect(await fails("update public.profiles set role = 'owner' where id = $1", [f.admin])).toBe(true);
    await as(f.owner);
    expect(await fails("update public.profiles set role = 'finance' where id = $1", [f.emp])).toBe(false);
  }));

  it("une approbation demandée par l'IA ne peut être décidée que par un humain habilité", () => tx(async () => {
    const f = await fixture();
    await as(f.pm);
    const ap = (await db.query("insert into public.approvals (action_type, title, payload, requested_by_ai) values ('send_email','Rappel',$1, true) returning id",
      [JSON.stringify({ to: "c@test.local" })])).rows[0].id;
    // création directement « approuvée » interdite
    expect(await fails("insert into public.approvals (action_type, title, status) values ('make_payment','x','approved')")).toBe(true);
    // pas de mise à jour directe
    expect(await fails("update public.approvals set status = 'approved' where id = $1", [ap])).toBe(true);
    // un chef de projet ne peut pas décider
    expect(await fails("select public.decide_approval($1, true, null)", [ap])).toBe(true);
    // un appel sans utilisateur (IA/système) est refusé
    await as(null);
    await db.query("set local role service_role");
    expect(await fails("select public.decide_approval($1, true, null)", [ap])).toBe(true);
    expect(await fails("update public.approvals set status = 'approved' where id = $1", [ap])).toBe(true);
    // l'OWNER décide
    await as(f.owner);
    const r = await db.query("select status, decided_by from public.decide_approval($1, true, 'ok')", [ap]);
    expect(r.rows[0]).toEqual({ status: "approved", decided_by: f.owner });
    expect(await fails("select public.decide_approval($1, false, null)", [ap])).toBe(true); // déjà traitée
  }));

  it("le journal d'audit enregistre les écritures et reste immuable", () => tx(async () => {
    const f = await fixture();
    await as(f.finance);
    await db.query("insert into public.payments (direction, amount, payment_date, invoice_id) values ('in', 100, '2026-10-05', $1)", [f.inv]);
    await as(f.owner);
    const logs = await db.query("select actor_id, actor_type, action from public.audit_logs where table_name = 'payments' and actor_id = $1", [f.finance]);
    expect(logs.rows[0]).toEqual({ actor_id: f.finance, actor_type: "user", action: "insert" });
    await as(null);
    expect(await fails("update public.audit_logs set action = 'x'")).toBe(true);
    expect(await fails("delete from public.audit_logs")).toBe(true);
  }));

  it("une facture reçue exige un fournisseur ou sous-traitant et un poste de coût", () => tx(async () => {
    const f = await fixture();
    await as(f.finance);
    expect(await fails("insert into public.invoices (direction, number, issue_date, due_date, amount_excl, vat_rate, vat_amount, status) values ('received','R1','2026-01-01','2026-01-31',100,21,21,'received')")).toBe(true);
    expect(await fails("insert into public.invoices (direction, number, client_id, issue_date, due_date, amount_excl, vat_rate, vat_amount, status) values ('issued','I1',$1,'2026-01-01','2026-01-31',100,7,7,'issued')", [f.client])).toBe(true); // TVA 7 % refusée
  }));
});
