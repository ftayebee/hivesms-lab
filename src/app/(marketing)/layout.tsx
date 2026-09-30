import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { TooltipProvider } from "@/components/ui/menu";
import { Announcement } from "@/components/marketing/announcement";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <div className="relative flex min-h-dvh flex-col">
        <Announcement />
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </TooltipProvider>
  );
}
