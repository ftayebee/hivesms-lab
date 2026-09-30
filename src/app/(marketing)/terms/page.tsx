import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Terms and Conditions", description: `Terms governing use of the ${siteConfig.name} SMS platform, API and services.`, path: "/terms" });

const S = siteConfig.name;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      updated="[date]"
      sections={[
        {
          id: "agreement",
          title: "Agreement",
          body: (
            <p>
              These Terms govern your use of {S} (the &quot;Service&quot;), operated by [{siteConfig.legalName}], [registered address], Bangladesh. By creating an account or using the Service, including the API, you agree to these Terms on behalf of yourself and the organization you represent.
            </p>
          ),
        },
        {
          id: "accounts",
          title: "Accounts and security",
          body: (
            <ul>
              <li>You must provide accurate registration details and keep them up to date.</li>
              <li>You are responsible for all activity under your account and API keys. Keep passwords and keys confidential and revoke compromised keys immediately.</li>
              <li>We may require verification of your identity or business (for example a trade licence) before enabling sending, sender IDs or higher limits.</li>
            </ul>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: (
            <>
              <p>You may only send messages to recipients who have given you permission to contact them, and only content that is lawful in Bangladesh. You must not use the Service to send:</p>
              <ul>
                <li>unsolicited promotional messages, or messages to purchased, rented or scraped number lists;</li>
                <li>fraudulent, phishing, deceptive or impersonating content, including messages pretending to be a bank, MFS provider or government body;</li>
                <li>content that is hateful, harassing, obscene, or that promotes illegal gambling, drugs or weapons;</li>
                <li>messages that violate any applicable law, regulation, regulator directive or operator policy.</li>
              </ul>
              <p>You must honour opt-out requests, identify your business in promotional messages, and follow any time-of-day or content rules that apply to promotional SMS.</p>
            </>
          ),
        },
        {
          id: "sender-ids",
          title: "Sender IDs",
          body: (
            <p>
              Masking sender IDs are subject to approval by upstream providers, mobile operators and, where applicable, regulators. We do not guarantee approval or approval times. You must have the right to use any name you request. Approved sender IDs may be suspended if they are misused or if approval is withdrawn by a third party.
            </p>
          ),
        },
        {
          id: "billing",
          title: "Pricing, balance and payment",
          body: (
            <ul>
              <li>Messages are charged per segment at the rates shown in your dashboard at the time of sending. Rates exclude VAT unless stated otherwise.</li>
              <li>Balance is prepaid. Sending stops when balance is insufficient.</li>
              <li>Balance validity: [state validity period, e.g. 12 months from the last top-up].</li>
              <li>
                Refunds are governed by the <Link href="/refund-policy">Refund Policy</Link>.
              </li>
              <li>We may change rates with [notice period] notice; changes do not affect messages already sent.</li>
            </ul>
          ),
        },
        {
          id: "delivery",
          title: "Delivery and service availability",
          body: (
            <p>
              Message delivery depends on upstream SMS providers, mobile operators and the recipient&apos;s handset, which are outside our control. We do not guarantee that any message will be delivered or delivered within a particular time. We report delivery status as received from providers. We aim to keep the Service available but do not guarantee uninterrupted operation; planned maintenance will be announced where practical.
            </p>
          ),
        },
        {
          id: "suspension",
          title: "Suspension and termination",
          body: (
            <p>
              We may review, hold, or refuse any message or campaign, and suspend or terminate accounts, where we reasonably believe these Terms, the law or operator policies are being breached, or to protect recipients, the network or the Service. You may close your account at any time. Unused balance on closure is handled according to the Refund Policy.
            </p>
          ),
        },
        {
          id: "data",
          title: "Data and privacy",
          body: (
            <p>
              You are the controller of the contact data you upload and are responsible for having a lawful basis to use it. We process it to provide the Service as described in the <Link href="/privacy">Privacy Policy</Link>. We keep message logs and audit records as needed for billing, security, legal and regulatory purposes.
            </p>
          ),
        },
        {
          id: "liability",
          title: "Liability",
          body: (
            <p>
              To the extent permitted by law, our total liability for any claim relating to the Service is limited to the amounts you paid us in the [three] months before the claim. We are not liable for indirect or consequential losses, or for failures caused by providers, operators or events outside our reasonable control.
            </p>
          ),
        },
        {
          id: "law",
          title: "Governing law",
          body: <p>These Terms are governed by the laws of Bangladesh. Disputes are subject to the courts of [Dhaka], Bangladesh.</p>,
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <p>
              Questions about these Terms: {siteConfig.contact.email}. Abuse reports: <Link href="/report-abuse">report-abuse page</Link> or {siteConfig.contact.abuseEmail}.
            </p>
          ),
        },
      ]}
    />
  );
}
