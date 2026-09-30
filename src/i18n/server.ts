import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getMessages, isLocale, LOCALE_COOKIE, type Locale } from "./index";

/** Locale for the current request: cookie, then DEFAULT_LOCALE, then English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const def = process.env.DEFAULT_LOCALE;
  return isLocale(def) ? def : "en";
});

export async function getT() {
  const locale = await getLocale();
  return { locale, t: getMessages(locale) };
}
