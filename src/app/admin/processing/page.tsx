import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravelData, laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { ProcessingForm, type ProcessingSettings } from "@/features/admin-ops/components";

export const metadata = { title: "Campaign processing" };

export default async function ProcessingPage() {
  if (!laravelEnabled("admin")) notFound();
  await requirePlatform("admin:settings:manage");
  const value = await laravelPage(() => laravelData<ProcessingSettings>("admin/settings/campaign-processing"));
  return (
    <>
      <PageHeader title="Campaign processing" description="Batch sizes, provider throttling, Dynamic SMS limits, risk thresholds and manual payment rules. Every change is audited." />
      <Card>
        <CardContent className="pt-5">
          <ProcessingForm value={value} />
        </CardContent>
      </Card>
    </>
  );
}
