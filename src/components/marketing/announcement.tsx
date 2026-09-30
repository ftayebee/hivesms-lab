import Link from "next/link";
import { getSiteContent } from "@/services/settings";

/** Optional site-wide announcement configured in Admin → Settings → Website content. */
export async function Announcement() {
  const { announcement } = await getSiteContent();
  if (!announcement.enabled || !announcement.text) return null;
  const inner = <span className="font-medium">{announcement.text}</span>;
  return (
    <div className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground" role="region" aria-label="Announcement">
      {announcement.href ? (
        <Link href={announcement.href} className="underline-offset-4 hover:underline">
          {inner} →
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}
