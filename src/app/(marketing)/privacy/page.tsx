import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Privacy Policy", description: `How ${siteConfig.name} collects, uses, stores and protects personal data.`, path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="[date]"
      sections={[
        {
          id: "who",
          title: "Who we are",
          body: <p>This policy explains how [{siteConfig.legalName}] (&quot;we&quot;) handles personal data when you use {siteConfig.name}. Contact: {siteConfig.contact.email}.</p>,
        },
        {
          id: "collect",
          title: "Data we collect",
          body: (
            <ul>
              <li><strong>Account data:</strong> name, email, mobile number, organization, role and password (stored only as a one-way hash).</li>
              <li><strong>Contact data you upload:</strong> recipient numbers, names and any fields you add. You control this data.</li>
              <li><strong>Message data:</strong> message content, recipients, sender ID, timestamps and delivery status.</li>
              <li><strong>Billing data:</strong> top-ups, invoices and payment references. We do not store card numbers; card payments are handled by the payment provider.</li>
              <li><strong>Technical data:</strong> IP addresses, browser user agent, API request logs and security events.</li>
            </ul>
          ),
        },
        {
          id: "use",
          title: "How we use data",
          body: (
            <ul>
              <li>To provide the Service: route messages, report delivery, bill usage and support you.</li>
              <li>To keep the Service secure: detect abuse, prevent fraud and investigate reports.</li>
              <li>To meet legal, tax and regulatory obligations.</li>
              <li>To send service emails (verification, receipts, alerts). You can control non-essential notifications in settings.</li>
            </ul>
          ),
        },
        {
          id: "share",
          title: "Sharing",
          body: (
            <p>
              Message content and recipient numbers are shared with upstream SMS providers and mobile operators only to deliver your messages. Payment data is shared with the payment provider you choose. Service providers (hosting, email) process data on our behalf under contract. We disclose data to authorities where required by law. We do not sell personal data.
            </p>
          ),
        },
        {
          id: "retention",
          title: "Retention",
          body: <p>We keep message logs for [period] and billing records for as long as tax law requires. Audit logs are kept for [period]. When you delete contacts, they are removed from active use and purged from backups on the normal backup cycle.</p>,
        },
        {
          id: "security",
          title: "Security",
          body: <p>We use encryption in transit, hashed passwords and API keys, encrypted storage of provider credentials, role-based access, audit logging and data isolation between customer organizations. No system is perfectly secure; report suspected vulnerabilities to {siteConfig.contact.supportEmail}.</p>,
        },
        {
          id: "rights",
          title: "Your choices",
          body: <p>You can access and correct account data in settings, export your contacts and reports, and ask us to close your account. Recipients who no longer want messages from a sender can reply with an opt-out keyword where supported, contact the sender, or report abuse to us.</p>,
        },
        {
          id: "cookies",
          title: "Cookies",
          body: <p>We use strictly necessary cookies for signing in and security, and a preference cookie for your language. Theme preference is stored in your browser. We do not use advertising cookies.</p>,
        },
        {
          id: "changes",
          title: "Changes",
          body: <p>We will post changes to this policy here and notify account owners of material changes by email.</p>,
        },
      ]}
    />
  );
}
