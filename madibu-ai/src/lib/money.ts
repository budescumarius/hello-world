/**
 * Montants : la base stocke des numeric(14,2) ; PostgREST les renvoie en nombre JSON.
 * Tous les calculs métier se font en CENTIMES ENTIERS pour éviter les erreurs d'arrondi.
 */
export type Cents = number;

export function toCents(value: number | string | null | undefined): Cents | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) throw new Error(`Montant invalide : ${value}`);
  return Math.round(n * 100);
}

/** Centimes → valeur décimale pour l'écriture en base (numeric). */
export function fromCents(cents: Cents | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Math.round(cents) / 100;
}

export function vatCents(excl: Cents, rate: number): Cents {
  // arrondi commercial au centime
  return Math.round((excl * rate) / 100);
}

export const VAT_RATES = [21, 12, 6, 0] as const;

export function sum(values: Array<Cents | null | undefined>): Cents {
  let s = 0;
  for (const v of values) if (typeof v === "number") s += v;
  return s;
}

const fmt = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, digits: number) {
  const k = `${locale}:${digits}`;
  if (!fmt.has(k)) {
    fmt.set(k, new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "fr-BE", {
      style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits,
    }));
  }
  return fmt.get(k)!;
}

export function formatEur(cents: Cents | null | undefined, opts: { locale?: string; digits?: 0 | 2; empty?: string } = {}) {
  if (cents === null || cents === undefined) return opts.empty ?? "—";
  return formatter(opts.locale ?? "fr", opts.digits ?? 2).format(cents / 100);
}

export function formatPct(v: number | null | undefined, empty = "—") {
  if (v === null || v === undefined || !Number.isFinite(v)) return empty;
  return `${v.toFixed(1).replace(".", ",")} %`;
}
