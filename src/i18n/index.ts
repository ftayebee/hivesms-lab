import { en, type Messages } from "./messages/en";
import { bn } from "./messages/bn";

export const LOCALES = ["en", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "sf_locale";
export const LOCALE_LABELS: Record<Locale, string> = { en: "English", bn: "বাংলা" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown> | undefined): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>) : v ?? base[k];
  }
  return out as T;
}

const cache = new Map<Locale, Messages>();

/** Full dictionary for a locale, with English fallback for missing keys. */
export function getMessages(locale: Locale): Messages {
  let m = cache.get(locale);
  if (!m) {
    m = locale === "en" ? en : deepMerge(en, bn as Record<string, unknown>);
    cache.set(locale, m);
  }
  return m;
}

export type { Messages };
