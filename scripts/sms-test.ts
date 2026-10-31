/**
 * Sends ONE real SMS through Automas, bypassing the wallet and the queue, to check credentials
 * and sender ID before going live. It costs real SMS balance. Reads the key from the environment.
 *
 *   npm run sms:test -- 8801XXXXXXXXX 8809XXXXXXXXXX "Test message"
 */
import "dotenv/config";
import { AutomasSmsProvider } from "@/services/sms/automas-provider";

async function main() {
  const [to, senderId, message] = process.argv.slice(2);
  if (!to || !senderId || !message) throw new Error('Usage: npm run sms:test -- 8801XXXXXXXXX SENDER_ID "Message"');
  const provider = new AutomasSmsProvider({ apiKey: process.env.SMS_PROVIDER_API_KEY ?? "" });
  const result = await provider.sendSms({
    reference: `sms-test-${Date.now()}`,
    to,
    message,
    senderId,
    senderType: /^\+?\d+$/.test(senderId) ? "NON_MASKING" : "MASKING",
    smsType: "TRANSACTIONAL",
    encoding: /^[\x00-\x7F]*$/.test(message) ? "GSM7" : "UCS2",
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
