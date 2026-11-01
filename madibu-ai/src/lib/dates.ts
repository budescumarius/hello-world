/** Dates métier en fuseau Europe/Brussels, manipulées en chaînes ISO AAAA-MM-JJ. */
export const TZ = "Europe/Brussels";

export function todayBrussels(now: Date = new Date()): string {
  // en-CA produit le format AAAA-MM-JJ
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function hourBrussels(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now));
}

function toUTC(d: string): number {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  return new Date(toUTC(d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function addMonths(d: string, n: number): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(day, last))).toISOString().slice(0, 10);
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

export function weekStart(d: string): string {
  const wd = (new Date(toUTC(d)).getUTCDay() + 6) % 7; // lundi = 0
  return addDays(d, -wd);
}

export function isoWeek(d: string): string {
  const date = new Date(toUTC(d));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function formatDate(d: string | null | undefined, locale = "fr"): string {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return locale === "ro" ? `${day}.${m}.${y}` : `${day}/${m}/${y}`;
}
