"use client";

import { useMemo, useState } from "react";
import { calculateSegments, STANDARD_RULES } from "@/lib/sms-segments";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "English OTP", text: "Your verification code is 482913. It expires in 5 minutes." },
  { label: "Bangla notice", text: "প্রিয় গ্রাহক, আপনার অর্ডারটি আজ ডেলিভারি করা হবে। অনুগ্রহ করে ফোনটি চালু রাখুন।" },
  { label: "Long English", text: "Hi Karim, your order #10234 has been packed and handed to our delivery partner. Expect it within 2 working days. Track it any time from your account page. Thank you for shopping with us." },
];

/** Interactive demo of the same segmentation logic the composer and billing use. */
export function SegmentPlayground() {
  const [text, setText] = useState(PRESETS[1].text);
  const info = useMemo(() => calculateSegments(text, STANDARD_RULES), [text]);
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Example messages">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setText(p.text)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", text === p.text ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label htmlFor="segment-demo" className="sr-only">
        Message text
      </label>
      <Textarea id="segment-demo" value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-4 font-bangla text-[15px]" />
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
        {[
          ["Encoding", info.encoding === "GSM7" ? "GSM-7" : "Unicode"],
          ["Characters", `${info.characters}`],
          ["Segments", `${info.segments}`],
          ["Per segment", `${info.perSegment}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md bg-surface px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="text-base font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {info.encoding === "UCS2"
          ? "Bangla or other Unicode characters switch the whole message to Unicode: 70 characters for one segment, 67 per segment when longer."
          : "Plain Latin text fits 160 characters in one segment, 153 per segment when longer."}{" "}
        Limits are configurable per provider.
      </p>
    </div>
  );
}
