"use client";

import { calculateSegments, type SegmentationRules } from "@/lib/sms-segments";
import { cn } from "@/lib/utils";

/** Live character / segment readout under a message textarea. */
export function SegmentMeter({ text, rules, className, id }: { text: string; rules: SegmentationRules; className?: string; id?: string }) {
  const info = calculateSegments(text, rules);
  return (
    <div id={id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)} aria-live="polite">
      <span>
        Characters:{" "}
        <span className="font-medium tabular text-foreground">
          {info.units}/{info.segments <= 1 ? rules[info.encoding === "GSM7" ? "gsm7" : "ucs2"].single : info.segments * info.perSegment}
        </span>
      </span>
      <span>
        SMS segments: <span className={cn("font-medium tabular", info.exceedsMax ? "text-destructive" : "text-foreground")}>{info.segments}</span>
      </span>
      <span>
        Encoding: <span className="font-medium text-foreground">{info.encoding === "GSM7" ? "GSM-7" : "Unicode"}</span>
      </span>
      {info.encoding === "UCS2" && info.nonGsmCharacters.length > 0 && (
        <span className="truncate">
          {info.nonGsmCharacters.some((c) => /[ঀ-৿]/.test(c)) ? (
            "Bangla text uses Unicode (70 characters per segment)"
          ) : (
            <>
              Unicode because of: <span className="text-foreground">{info.nonGsmCharacters.filter((c) => !/\p{M}/u.test(c)).join(" ")}</span>
            </>
          )}
        </span>
      )}
      {info.exceedsMax && <span className="font-medium text-destructive">Too long: maximum {rules.maxSegments} segments</span>}
    </div>
  );
}
