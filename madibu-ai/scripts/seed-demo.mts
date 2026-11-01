/**
 * DONNÉES DE DÉMONSTRATION SYNTHÉTIQUES – développement local uniquement.
 * Noms, e-mails (domaine .test) et montants fictifs ; dates relatives au jour d'exécution.
 *
 *   npm run seed:demo           (base vide, après `npx supabase db reset`)
 *
 * Mot de passe des comptes de démo : variable DEMO_PASSWORD (sinon généré et affiché).
 * Refuse de s'exécuter si l'URL Supabase n'est pas locale, sauf ALLOW_REMOTE_SEED=1.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants (.env.local)");
if (!/127\.0\.0\.1|localhost/.test(url) && process.env.ALLOW_REMOTE_SEED !== "1") {
  throw new Error("Refus : base non locale. Ne chargez jamais de données de démonstration en production.");
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const password = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(9).toString("base64url")}`;

const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date()) + "T12:00:00Z");
const d = (n: number) => new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const monthDay = (day: number) => {
  const t = new Date(today); if (t.getUTCDate() > day) t.setUTCMonth(t.getUTCMonth() + 1);
  t.setUTCDate(day); return t.toISOString().slice(0, 10);
};
const vat = (excl: number, rate: number) => Math.round(excl * rate) / 100;

async function ins<T = { id: string }>(table: string, rows: object | object[], select = "id"): Promise<T[]> {
  const { data, error } = await sb.from(table).insert(rows as never).select(select);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as T[];
}

async function main() {
  const { count } = await sb.from("projects").select("id", { count: "exact", head: true });
  if (count) throw new Error("La base contient déjà des chantiers. Lancez `npx supabase db reset` avant le seed.");

  // --- comptes de démonstration
  const users: Record<string, string> = {};
  for (const [role, name] of [["owner", "Marius Démo (propriétaire)"], ["admin", "Ana Admin"], ["finance", "Fabienne Finance"],
    ["project_manager", "Pierre Projet"], ["site_manager", "Daniel Chantier"], ["employee", "Ionut Ouvrier"]] as const) {
    const email = `${role.replace("_", ".")}@madibu.test`;
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw new Error(`${email}: ${error.message}`);
    users[role] = data.user.id;
    await sb.from("profiles").update({ role, full_name: name }).eq("id", data.user.id);
  }

  // --- tiers
  const [c1, c2, c3, c4, c5] = await ins("clients", [
    { name: "M. et Mme Janssens", client_type: "individual", email: "janssens@exemple.test", phone: "+32 470 00 00 01", payment_terms_days: 30 },
    { name: "ACP Résidence Les Tilleuls", client_type: "company", email: "syndic.tilleuls@exemple.test", contact_person: "Syndic Démo", payment_terms_days: 30 },
    { name: "Mme Lambert", client_type: "individual", email: "lambert@exemple.test", payment_terms_days: 15 },
    { name: "Ville de Namur – service bâtiments (démo)", client_type: "public", email: "batiments@exemple.test", payment_terms_days: 60 },
    { name: "SRL Boulangerie Pirard", client_type: "company", payment_terms_days: 30 },
  ]);
  const [sBricks, sWood, sTech, sRent] = await ins("suppliers", [
    { name: "Briqueterie Démo SA", email: "compta@briqueterie.test", categories: ["briques", "blocs", "mortier"], payment_terms_days: 30 },
    { name: "Bois & Toitures Démo", categories: ["bois", "zinc", "tuiles"], payment_terms_days: 30 },
    { name: "Grossiste Sanitaire-Chauffage Démo", categories: ["sanitaire", "chauffage"], payment_terms_days: 30 },
    { name: "Location Matériel Démo", categories: ["location"], payment_terms_days: 15 },
  ]);
  const [subElec, subRoof] = await ins("subcontractors", [
    { name: "ElecPro Démo SRL", trade: "Électricité", email: "elecpro@exemple.test", insurance_valid_until: d(200), payment_terms_days: 30 },
    { name: "Étanchéité Toit Démo", trade: "Étanchéité", insurance_valid_until: d(-12), payment_terms_days: 30 },
  ]);
  const [eDaniel, eIonut, eMarc] = await ins("employees", [
    { full_name: "Daniel Chantier", job_title: "Chef de chantier", hourly_cost: 52, profile_id: users.site_manager, active: true },
    { full_name: "Ionut Ouvrier", job_title: "Maçon", hourly_cost: 43, profile_id: users.employee, active: true },
    { full_name: "Marc Démo", job_title: "Couvreur", hourly_cost: 45, active: true },
  ]);

  // --- chantiers
  const base = { project_manager_id: users.project_manager };
  const [pExt, pRoof, pApt, pHvac, , pDone] = await ins("projects", [
    { ...base, reference: "MAD-2026-007", name: "Extension et rénovation maison Janssens", client_id: c1.id, site_address: "Avenue Démo 210, 1180 Uccle",
      architect_name: "Atelier d'architecture Démo", architect_email: "archi@exemple.test", status: "in_progress", contract_amount_excl: 248000, vat_rate: 6,
      budget_materials: 71000, budget_labour: 78000, budget_subcontract: 42000, budget_other: 9000, start_date: d(-150), planned_end_date: d(75), progress_pct: 60,
      site_manager_id: users.site_manager },
    { ...base, reference: "MAD-2026-011", name: "Toiture et isolation – Résidence Les Tilleuls", client_id: c2.id, site_address: "Rue Démo 98, 1050 Ixelles",
      status: "in_progress", contract_amount_excl: 136500, vat_rate: 6, budget_materials: 46000, budget_labour: 31000, budget_subcontract: 28000, budget_other: 4500,
      start_date: d(-120), planned_end_date: d(-20), progress_pct: 85, site_manager_id: users.site_manager },
    { ...base, reference: "MAD-2026-014", name: "Rénovation complète appartement Lambert", client_id: c3.id, site_address: "Avenue Démo 301, 1150 Woluwe-Saint-Pierre",
      architect_name: "Atelier d'architecture Démo", status: "in_progress", contract_amount_excl: 94000, vat_rate: 6, budget_materials: 27000, budget_labour: 30000,
      budget_subcontract: 16000, budget_other: 2000, start_date: d(-90), planned_end_date: d(40), progress_pct: 70 },
    { ...base, reference: "MAD-2026-016", name: "Chauffage et ventilation – école communale", client_id: c4.id, site_address: "Rue Démo 15, 5000 Namur",
      architect_name: "Bureau Meuse Démo", status: "in_progress", start_date: d(-30), progress_pct: 15, notes: "Bon de commande communal attendu : montant du marché à confirmer par écrit." },
    { ...base, reference: "MAD-2026-018", name: "Transformation boulangerie Pirard", client_id: c5.id, site_address: "Rue Démo 44, 4000 Liège", status: "offer",
      contract_amount_excl: 67800, vat_rate: 21, planned_end_date: d(160) },
    { ...base, reference: "MAD-2025-031", name: "Salle de bain et électricité – maison Démo", client_id: c1.id, site_address: "Chaussée Démo 120, 1640 Rhode-Saint-Genèse",
      status: "handed_over", contract_amount_excl: 38400, vat_rate: 6, budget_materials: 12000, budget_labour: 11000, budget_subcontract: 7000,
      start_date: d(-240), planned_end_date: d(-170), actual_end_date: d(-172), progress_pct: 100 },
  ]);
  await sb.from("projects").update({ progress_updated_at: new Date(today.getTime() - 21 * 86_400_000).toISOString() }).eq("id", pRoof.id);
  await ins("project_members", [{ project_id: pExt.id, profile_id: users.site_manager }, { project_id: pRoof.id, profile_id: users.site_manager },
    { project_id: pExt.id, profile_id: users.employee }], "project_id");

  await ins("change_orders", [
    { project_id: pExt.id, description: "Velux supplémentaires et renfort de linteau", amount_excl: 7850, status: "approved", requested_on: d(-70), approved_on: d(-60), work_started: true },
    { project_id: pRoof.id, description: "Remplacement de chevrons pourris découverts à la dépose", amount_excl: 9400, status: "requested", requested_on: d(-30), work_started: true },
  ]);

  // --- factures clients
  const issued = (number: string, project: { id: string }, client: { id: string }, kind: string, issue: number, due: number, excl: number, rate = 6) =>
    ({ direction: "issued", number, project_id: project.id, client_id: client.id, kind, issue_date: d(issue), due_date: d(due), amount_excl: excl, vat_rate: rate, vat_amount: vat(excl, rate), status: "issued" });
  const [f1, f2, , f4, , f6, f7] = await ins<{ id: string; amount_total: number }>("invoices", [
    issued("F2026-0141", pExt, c1, "advance", -150, -135, 49600), issued("F2026-0188", pExt, c1, "progress", -60, -30, 62000),
    issued("F2026-0215", pExt, c1, "progress", -5, 25, 38000), issued("F2026-0162", pRoof, c2, "advance", -120, -105, 40950),
    issued("F2026-0179", pRoof, c2, "progress", -105, -75, 54600), issued("F2026-0201", pApt, c3, "advance", -90, -50, 28200),
    issued("F2025-0388", pDone, c1, "final", -170, -140, 38400),
  ], "id, amount_total");
  await ins("payments", [
    { direction: "in", invoice_id: f1.id, amount: f1.amount_total, payment_date: d(-133), reference: "Virement" },
    { direction: "in", invoice_id: f2.id, amount: 40000, payment_date: d(-25), reference: "Virement partiel" },
    { direction: "in", invoice_id: f4.id, amount: f4.amount_total, payment_date: d(-100) },
    { direction: "in", invoice_id: f6.id, amount: f6.amount_total, payment_date: d(-48) },
    { direction: "in", invoice_id: f7.id, amount: f7.amount_total, payment_date: d(-138) },
  ]);

  // --- factures fournisseurs / sous-traitants
  const recv = (number: string, party: { id: string }, isSub: boolean, project: { id: string } | null, cat: string, issue: number, due: number, excl: number, rate = 21, status = "received") =>
    ({ direction: "received", number, supplier_id: isSub ? null : party.id, subcontractor_id: isSub ? party.id : null, project_id: project?.id ?? null, cost_category: cat,
       issue_date: d(issue), due_date: d(due), amount_excl: excl, vat_rate: rate, vat_amount: vat(excl, rate), status });
  const [b1, , , b4, b5, , , , , , b11] = await ins<{ id: string; amount_total: number }>("invoices", [
    recv("BD-26-1120", sBricks, false, pExt, "materials", -110, -80, 21400), recv("BD-26-1408", sBricks, false, pExt, "materials", -40, -10, 16900),
    recv("EP-2026-077", subElec, true, pExt, "subcontract", -20, 10, 14200, 0), recv("BT-5521", sWood, false, pRoof, "materials", -100, -70, 38700),
    recv("ETD-0931", subRoof, true, pRoof, "subcontract", -65, -35, 33800, 0), recv("BT-5790", sWood, false, pRoof, "materials", -40, -35, 12300),
    recv("GSC-77812", sTech, false, pApt, "materials", -30, 5, 9850), recv("EP-2026-091", subElec, true, pApt, "subcontract", -12, 18, 6400, 0, "disputed"),
    recv("GSC-78140", sTech, false, pHvac, "materials", -8, 22, 18200), recv("LM-2210", sRent, false, null, "equipment", -15, 15, 1350),
    recv("BD-25-0921", sBricks, false, pDone, "materials", -200, -170, 11300),
  ], "id, amount_total");
  await ins("payments", [
    { direction: "out", invoice_id: b1.id, amount: b1.amount_total, payment_date: d(-78) },
    { direction: "out", invoice_id: b4.id, amount: b4.amount_total, payment_date: d(-68) },
    { direction: "out", invoice_id: b5.id, amount: 20000, payment_date: d(-30), reference: "Acompte" },
    { direction: "out", invoice_id: b11.id, amount: b11.amount_total, payment_date: d(-168) },
  ]);

  // --- main-d'œuvre interne (réglée via la paie)
  const labour = (project: { id: string }, emp: { id: string } | null, desc: string, hours: number, rate: number, ago: number) =>
    ({ project_id: project.id, employee_id: emp?.id ?? null, category: "labour", description: desc, hours, amount_excl: hours * rate, expense_date: d(ago), settlement: "payroll" });
  await ins("expenses", [
    labour(pExt, eIonut, "Équipe gros œuvre (4 ouvriers)", 1150, 45, -70), labour(pExt, eDaniel, "Finitions et coordination", 260, 45, -10),
    labour(pRoof, eMarc, "Équipe toiture (3 ouvriers)", 840, 45, -60), labour(pApt, eIonut, "Démolition et cloisons", 420, 45, -50),
    labour(pApt, eIonut, "Plafonnage", 180, 45, -15), labour(pHvac, eDaniel, "Relevés et préparation", 60, 45, -12), labour(pDone, eIonut, "Main-d'œuvre", 240, 45, -180),
    { project_id: pRoof.id, category: "equipment", description: "Échafaudage (location interne)", amount_excl: 6900, expense_date: d(-90), settlement: "payroll" },
  ]);

  // --- obligations récurrentes
  await ins("recurring_obligations", [
    { kind: "loan", label: "Crédit d'investissement – entrepôt", counterparty: "Banque Démo", amount: 2450, frequency: "monthly", next_due_date: monthDay(5), end_date: d(1400) },
    { kind: "leasing", label: "Leasing camionnette", counterparty: "Leasing Démo", amount: 890, frequency: "monthly", next_due_date: monthDay(10), end_date: d(600) },
    { kind: "leasing", label: "Leasing mini-pelle", counterparty: "Leasing Démo", amount: 640, frequency: "monthly", next_due_date: monthDay(15), end_date: d(420) },
    { kind: "credit_facility", label: "Ligne de crédit – intérêts", counterparty: "Banque Démo", amount: 310, frequency: "monthly", next_due_date: monthDay(25) },
    { kind: "salary", label: "Salaires nets ouvriers et employés", amount: 41500, frequency: "monthly", next_due_date: monthDay(28) },
    { kind: "social_security", label: "ONSS – cotisations trimestrielles", amount: 23800, frequency: "quarterly", next_due_date: d(9) },
    { kind: "tax", label: "TVA – déclaration mensuelle", amount: 7200, frequency: "monthly", next_due_date: monthDay(20) },
    { kind: "insurance", label: "Assurance RC et tous risques chantier", amount: 3150, frequency: "quarterly", next_due_date: d(-6) },
  ]);
  await ins("bank_balances", [
    { account_label: "Compte courant (démo)", balance: 52300, as_of: d(-1) },
    { account_label: "Compte épargne (démo)", balance: 15000, as_of: d(-1) },
  ]);

  // --- tâches manuelles
  await ins("tasks", [
    { title: "Commander le zinc manquant pour les rives", project_id: pRoof.id, priority: "high", due_date: d(-2), assigned_to: users.project_manager, status: "todo" },
    { title: "Préparer la réunion de chantier avec l'architecte", project_id: pExt.id, priority: "normal", due_date: d(3), assigned_to: users.site_manager, status: "in_progress" },
    { title: "Relevé des quantités cuisine", project_id: pApt.id, priority: "normal", due_date: d(6), assigned_to: users.employee, status: "todo" },
  ]);

  console.log("✔ Données de démonstration chargées.");
  console.log("Comptes : owner@madibu.test, admin@madibu.test, finance@madibu.test, project.manager@madibu.test, site.manager@madibu.test, employee@madibu.test");
  if (!process.env.DEMO_PASSWORD) console.log(`Mot de passe (généré) : ${password}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
