import { redirect } from "next/navigation";

/** The campaign builder and the SMS composer are the same screen. */
export default function NewCampaignPage() {
  redirect("/dashboard/send");
}
