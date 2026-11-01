import { fr, type Messages } from "./fr";
import { ro } from "./ro";

export type Locale = "fr" | "ro";
export const LOCALES: Locale[] = ["fr", "ro"];
export const DEFAULT_LOCALE: Locale = "fr";
const dictionaries: Record<Locale, Messages> = { fr, ro };

export function getMessages(locale: string | null | undefined): Messages {
  return dictionaries[(locale as Locale) in dictionaries ? (locale as Locale) : DEFAULT_LOCALE];
}
export type { Messages };
