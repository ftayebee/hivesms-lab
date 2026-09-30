import { db } from "@/lib/db";
import { formatBDT } from "@/lib/format";
import { notify } from "@/services/notify";
import { emailTemplates } from "@/services/email/templates";

/**
 * Sends one low-balance alert when the balance first drops below the threshold. The flag resets
 * when the wallet is topped up above the threshold (see creditWallet).
 */
export async function checkLowBalance(organizationId: string) {
  const claimed = await db.$queryRaw<{ balance: string; threshold: string }[]>`
    UPDATE wallets SET "lowBalanceNotifiedAt" = now()
    WHERE "organizationId" = ${organizationId}::uuid AND balance < "lowBalanceThreshold" AND "lowBalanceNotifiedAt" IS NULL
    RETURNING balance::text, "lowBalanceThreshold"::text AS threshold`;
  if (!claimed.length) return;
  const balance = formatBDT(claimed[0].balance);
  const threshold = formatBDT(claimed[0].threshold);
  await notify({
    organizationId,
    type: "balance.low",
    title: "Low balance",
    body: `Your balance is ${balance}, below your alert threshold of ${threshold}.`,
    link: "/dashboard/wallet",
    email: (to) => emailTemplates.lowBalance(to, balance, threshold),
  });
}
