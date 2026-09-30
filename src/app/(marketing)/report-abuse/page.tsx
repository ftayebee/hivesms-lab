import { Container } from "@/components/marketing/blocks";
import { AbuseForm } from "@/components/marketing/abuse-form";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Report SMS abuse",
  description: "Report spam, scam or unwanted SMS sent through this platform. Reports are reviewed by our trust and safety team.",
  path: "/report-abuse",
});

export default function ReportAbusePage() {
  return (
    <Container className="max-w-3xl py-16 md:py-20">
      <h1 className="text-4xl font-semibold tracking-tight">Report an unwanted or suspicious SMS</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        If you received spam, a scam or a message you never agreed to from a sender on this platform, tell us. We investigate every report and suspend senders who break our terms.
      </p>
      <div className="mt-10 rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
        <AbuseForm />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">If you are in immediate danger or have lost money to fraud, contact your bank or mobile financial service provider and the police first.</p>
    </Container>
  );
}
