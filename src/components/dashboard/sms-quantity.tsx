import { Badge } from "@/components/ui/badge";

/** Masking and non-masking message counts side by side. A null count shows as a dash. */
export function SmsQuantity({ masking, nonMasking }: { masking: string | null; nonMasking: string | null }) {
  return (
    <dl className="grid grid-cols-2 divide-x divide-border rounded-md border border-border text-center">
      <div className="p-3">
        <dt>
          <Badge className="bg-destructive text-destructive-foreground">Masking</Badge>
        </dt>
        <dd className="mt-2 text-xl font-semibold tabular">{masking ?? "-"}</dd>
      </div>
      <div className="p-3">
        <dt>
          <Badge className="bg-primary text-primary-foreground">Non-Mask</Badge>
        </dt>
        <dd className="mt-2 text-xl font-semibold tabular">{nonMasking ?? "-"}</dd>
      </div>
    </dl>
  );
}
