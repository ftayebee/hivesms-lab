import { db } from "@/lib/db";
import { formatBDT } from "@/lib/format";
import { notify } from "@/services/notify";
import { emailTemplates } from "@/services/email/templates";

/**
 * Sends one low-balance alert when the balance first drops below the threshold. The flag resets
 * when the wallet is topped up above the threshold (see creditWallet).
 */
export async function checkLowBalance(organizationId: string) {
  // Atomic claim: only the caller whose UPDATE flips the flag sends the alert.
  const changed = await db.$executeRaw`
    UPDATE wallets SET lowBalanceNotifiedAt = ${new Date()}
    WHERE organizationId = ${organizationId} AND balance < lowBalanceThreshold AND lowBalanceNotifiedAt IS NULL`;
  if (!changed) return;
  const claimed = await db.$queryRaw<{ balance: string; threshold: string }[]>`
    SELECT CAST(balance AS CHAR) AS balance, CAST(lowBalanceThreshold AS CHAR) AS threshold FROM wallets WHERE organizationId = ${organizationId}`;
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
