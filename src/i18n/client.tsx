"use client";

import { createContext, useContext } from "react";
import { getMessages, type Locale, type Messages } from "./index";

const I18nContext = createContext<{ locale: Locale; t: Messages }>({ locale: "en", t: getMessages("en") });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, t: getMessages(locale) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
