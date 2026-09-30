import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();
  return (
    <I18nProvider locale={locale}>
      <div lang={locale} className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,34rem)]">
        <main id="main" className="flex flex-col px-4 py-8 sm:px-8">
          <Link href="/" className="w-fit rounded-md" aria-label="SMSFlow BD home">
            <Logo />
          </Link>
          <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">{children}</div>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link href="/contact" className="hover:text-foreground">
              Help
            </Link>
          </p>
        </main>
        <aside className="relative hidden overflow-hidden bg-code text-code-foreground lg:flex lg:flex-col lg:justify-center lg:px-12">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_10%,rgb(44_199_184/0.22),transparent_70%),radial-gradient(50%_40%_at_10%_90%,rgb(120_146_255/0.22),transparent_70%)]" />
          <div className="relative max-w-sm">
            <h2 className="text-2xl font-semibold tracking-tight">SMS for Bangladesh, without the guesswork.</h2>
            <ul className="mt-8 space-y-4 text-sm text-code-foreground/80">
              {[
                "See segments and cost before every send",
                "Delivery status for every message",
                "REST API with scoped keys and webhooks",
                "BDT wallet with VAT invoices",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#2cc7b8]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </I18nProvider>
  );
}
