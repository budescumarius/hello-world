/**
 * Matrice des permissions côté application (l'autorité finale reste la RLS PostgreSQL).
 * Utilisée pour l'affichage (navigation, boutons) ET pour vérifier chaque action serveur.
 */
import type { Role } from "./domain/types";

export const ROLES: Role[] = ["owner", "admin", "finance", "project_manager", "site_manager", "employee"];

export type Permission =
  | "dashboard.view" | "finance.view" | "finance.write" | "bank.write" | "projects.view_all" | "projects.write"
  | "parties.view" | "clients.write" | "suppliers.write" | "employees.view" | "employees.write"
  | "tasks.write" | "documents.view" | "documents.write" | "assistant.use" | "approvals.view" | "approvals.decide"
  | "analysis.run" | "settings.users" | "audit.view" | "import.run" | "export.run" | "expenses.write";

const OFFICE: Role[] = ["owner", "admin", "finance", "project_manager"];

const MATRIX: Record<Permission, Role[]> = {
  "dashboard.view": ROLES,
  "finance.view": ["owner", "admin", "finance"],
  "finance.write": ["owner", "admin", "finance"],
  "bank.write": ["owner", "finance"],
  "projects.view_all": OFFICE,
  "projects.write": ["owner", "admin", "project_manager"],
  "parties.view": OFFICE,
  "clients.write": ["owner", "admin", "project_manager"],
  "suppliers.write": ["owner", "admin", "finance", "project_manager"],
  "employees.view": OFFICE,
  "employees.write": ["owner", "admin"],
  "expenses.write": ["owner", "admin", "finance", "project_manager"],
  "tasks.write": ["owner", "admin", "finance", "project_manager", "site_manager"],
  "documents.view": ["owner", "admin", "finance", "project_manager", "site_manager", "employee"],
  "documents.write": ["owner", "admin", "finance", "project_manager", "site_manager"],
  "assistant.use": OFFICE,
  "approvals.view": ["owner", "admin", "finance"],
  "approvals.decide": ["owner", "admin", "finance"],
  "analysis.run": ["owner", "admin", "finance"],
  "settings.users": ["owner"],
  "audit.view": ["owner", "admin"],
  "import.run": ["owner", "admin", "finance"],
  "export.run": ["owner", "admin", "finance", "project_manager"],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && MATRIX[perm].includes(role);
}

/** Actions que l'IA peut faire seule / actions nécessitant une approbation humaine. */
export const AI_AUTONOMOUS = [
  "read_data", "analyse", "calculate_indicators", "generate_reports", "create_internal_tasks", "detect_risks", "prepare_proposals",
] as const;
export const AI_REQUIRES_APPROVAL = [
  "send_email", "issue_invoice", "issue_credit_note", "make_payment", "order_materials", "sign_contract",
  "financial_commitment", "legal_commitment", "modify_accounting", "change_bank_details",
] as const;
export type ApprovalAction = (typeof AI_REQUIRES_APPROVAL)[number] | "other";
