import { Clock, MailX, ShieldCheck, Tags, UserCheck, Languages } from "lucide-react";
import { CheckList, CtaBand, FaqList, FeatureGrid, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { Alert } from "@/components/ui/misc";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Promotional SMS marketing in Bangladesh",
  description: "Run promotional SMS campaigns to opted-in customers in Bangladesh with consent tracking, automatic opt-out filtering, quiet hours and campaign review.",
  path: "/promotional-sms",
});

export default function PromotionalPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Promotional SMS", path: "/promotional-sms" }])} />
      <PageHero
        eyebrow="Promotional SMS"
        title="Promotions your customers asked to receive"
        description="Send offers and announcements to opted-in contacts, with opt-outs honoured automatically and sending restricted to appropriate hours."
        primary={{ label: "Start a promotion", href: "/register" }}
        secondary={{ label: "Bulk SMS overview", href: "/bulk-sms" }}
      />

      <Section labelledBy="rules-h">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <SectionHeading id="rules-h" title="Promotional messages have extra rules" description="Promotional SMS is regulated more closely than transactional SMS in Bangladesh, and operator policies change. The platform enforces the safeguards below; the exact rules (such as allowed hours or language requirements) are configured by the platform operator to match current regulations and provider terms." />
            <CheckList
              className="mt-8"
              items={[
                "Send only to contacts who gave consent, and record where it came from.",
                "Every promotional campaign skips numbers on your suppression list.",
                "Sending is blocked during configured quiet hours (Asia/Dhaka).",
                "Campaigns can require review before they go out.",
                "Include a way to opt out, for example \"Reply STOP to opt out\".",
              ]}
            />
          </div>
          <Alert tone="warning" title="Your responsibility as a sender" className="h-fit">
            You are responsible for having permission to message your recipients and for the content you send. Accounts that send unsolicited, misleading or fraudulent messages are suspended. See the Terms and Conditions.
          </Alert>
        </div>
      </Section>

      <Section tone="surface" labelledBy="feat-h">
        <SectionHeading id="feat-h" title="Tools for responsible promotions" />
        <div className="mt-10">
          <FeatureGrid
            items={[
              { icon: UserCheck, title: "Consent status", body: "Mark each contact as opted in, unknown or opted out, with the source and date." },
              { icon: MailX, title: "Suppression list", body: "Opt-outs from STOP replies (where supported), imports and manual entries." },
              { icon: Clock, title: "Quiet hours", body: "Promotional sends are held outside the allowed window." },
              { icon: Tags, title: "Segmentation", body: "Target groups and tags instead of your whole list." },
              { icon: ShieldCheck, title: "Campaign review", body: "Large or new-account campaigns are reviewed before sending." },
              { icon: Languages, title: "Bangla copy", body: "Write offers in Bangla with accurate segment counts." },
            ]}
          />
        </div>
      </Section>

      <Section labelledBy="faq-h">
        <SectionHeading id="faq-h" title="Promotional SMS questions" />
        <div className="mt-8 max-w-3xl">
          <FaqList
            items={[
              { q: "Can I buy a list of numbers and send promotions?", a: "No. Messaging purchased or scraped lists is prohibited on this platform. Use contacts who opted in to hear from your business." },
              { q: "Why was my campaign skipped for some contacts?", a: "Promotional campaigns skip contacts marked as opted out, numbers on your suppression list, numbers blocked platform-wide, and invalid numbers. The campaign report lists the counts." },
              { q: "Is a masking sender ID required for promotions?", a: "Not by the platform. Operator and regulatory rules for promotional sender IDs can change, so check with support before planning a large promotion." },
            ]}
          />
        </div>
      </Section>

      <CtaBand title="Plan your next promotion" description="Import opted-in contacts, pick a segment and schedule your campaign." primary={{ label: "Get started", href: "/register" }} secondary={{ label: "See pricing", href: "/pricing" }} />
    </>
  );
}
