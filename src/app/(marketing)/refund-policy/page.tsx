import { LegalPage } from "@/components/marketing/legal-page";
import { siteConfig } from "@/config/site";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Refund Policy", description: "When SMS charges are refunded to your wallet, and how top-up refunds are handled.", path: "/refund-policy" });

export default function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      updated="[date]"
      sections={[
        {
          id: "automatic",
          title: "Automatic message refunds",
          body: (
            <>
              <p>The charge for a message is returned to your wallet automatically when:</p>
              <ul>
                <li>the message could not be submitted to the provider (rejected, or failed after retries);</li>
                <li>the message was cancelled before sending (for example a cancelled campaign);</li>
                <li>the provider reports a final failure, where the platform&apos;s refund setting for failed messages is enabled (it is enabled by default).</li>
              </ul>
              <p>Messages that the provider accepted but for which no delivery report arrives within 72 hours are marked expired and are not refunded, because the network may have delivered them. Each refund appears as its own line in your transaction history.</p>
            </>
          ),
        },
        {
          id: "not-refundable",
          title: "What is not refunded",
          body: (
            <ul>
              <li>Messages delivered to the recipient&apos;s handset.</li>
              <li>Messages sent to numbers you supplied that were valid but wrong or unwanted.</li>
              <li>Charges for messages blocked because they breached the Terms.</li>
            </ul>
          ),
        },
        {
          id: "topups",
          title: "Refunds of wallet balance",
          body: (
            <p>
              Unused balance is generally not refundable in cash. Exceptions: duplicate payments, payments that did not reach your wallet, or where required by law. Request within [30] days of payment via a support ticket. Approved refunds are returned to the original payment method within [10] working days, minus any non-refundable gateway fees.
            </p>
          ),
        },
        {
          id: "vat",
          title: "VAT",
          body: <p>Where a top-up is refunded, the VAT charged on it is refunded or adjusted by credit note as permitted by applicable tax rules.</p>,
        },
        {
          id: "contact",
          title: "How to request",
          body: <p>Open a ticket in Dashboard → Support with the payment reference, or email {siteConfig.contact.supportEmail}.</p>,
        },
      ]}
    />
  );
}
