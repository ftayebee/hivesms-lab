import { siteConfig } from "@/config/site";
import type { EmailMessage } from "./index";

/**
 * Transactional email templates. Company details come from site config (placeholders until
 * configured). Every dynamic value is HTML-escaped.
 */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

interface LayoutInput {
  preheader: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
  rows?: [string, string][];
}

function layout(input: LayoutInput): { html: string; text: string } {
  const rows = input.rows?.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">${input.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;color:#52607A;border-bottom:1px solid #E2E7EF">${esc(k)}</td><td style="padding:8px 0;text-align:right;color:#0E1A36;border-bottom:1px solid #E2E7EF;font-weight:600">${esc(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const cta = input.cta
    ? `<p style="margin:24px 0"><a href="${esc(input.cta.url)}" style="background:#1E3FA8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(input.cta.label)}</a></p><p style="font-size:12px;color:#52607A">If the button does not work, copy this link:<br><span style="word-break:break-all">${esc(input.cta.url)}</span></p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(input.heading)}</title></head>
<body style="margin:0;background:#F6F8FB;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0E1A36">
<span style="display:none;max-height:0;overflow:hidden">${esc(input.preheader)}</span>
<table role="presentation" width="100%" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #E2E7EF;border-radius:12px;padding:32px">
<tr><td>
<p style="font-weight:700;font-size:16px;color:#1E3FA8;margin:0 0 24px">${esc(siteConfig.name)}</p>
<h1 style="font-size:20px;margin:0 0 16px">${esc(input.heading)}</h1>
${input.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(p)}</p>`).join("")}
${rows}${cta}
${input.footnote ? `<p style="font-size:13px;color:#52607A;margin-top:24px">${esc(input.footnote)}</p>` : ""}
</td></tr></table>
<p style="font-size:12px;color:#52607A;margin-top:16px">${esc(siteConfig.legalName)} · ${esc(siteConfig.contact.address)}<br>You received this email because of activity on your ${esc(siteConfig.name)} account.</p>
</td></tr></table></body></html>`;
  const text = [
    input.heading,
    "",
    ...input.paragraphs,
    ...(input.rows?.map(([k, v]) => `${k}: ${v}`) ?? []),
    ...(input.cta ? ["", `${input.cta.label}: ${input.cta.url}`] : []),
    ...(input.footnote ? ["", input.footnote] : []),
    "",
    `${siteConfig.name}`,
  ].join("\n");
  return { html, text };
}

const url = (p: string) => `${process.env.APP_URL ?? siteConfig.url}${p}`;

export const emailTemplates = {
  welcome(to: string, name: string): EmailMessage {
    const { html, text } = layout({
      preheader: "Your account is ready.",
      heading: `Welcome, ${name}`,
      paragraphs: [
        `Your ${siteConfig.name} account is ready. Next steps: verify your email, add balance, and request a sender ID if you need a branded sender name.`,
      ],
      cta: { label: "Open dashboard", url: url("/dashboard") },
    });
    return { to, subject: `Welcome to ${siteConfig.name}`, html, text, tag: "welcome" };
  },

  verifyEmail(to: string, name: string, link: string): EmailMessage {
    const { html, text } = layout({
      preheader: "Confirm your email address.",
      heading: "Confirm your email address",
      paragraphs: [`Hi ${name}, confirm this email address to start sending messages. The link expires in 24 hours.`],
      cta: { label: "Verify email", url: link },
      footnote: "If you did not create an account, you can ignore this email.",
    });
    return { to, subject: "Verify your email address", html, text, tag: "verify-email" };
  },

  passwordReset(to: string, name: string, link: string): EmailMessage {
    const { html, text } = layout({
      preheader: "Reset your password.",
      heading: "Reset your password",
      paragraphs: [`Hi ${name}, we received a request to reset your password. The link expires in 1 hour and can be used once.`],
      cta: { label: "Choose a new password", url: link },
      footnote: "If you did not request this, you can ignore this email. Your password will not change.",
    });
    return { to, subject: "Reset your password", html, text, tag: "password-reset" };
  },

  passwordChanged(to: string, name: string): EmailMessage {
    const { html, text } = layout({
      preheader: "Your password was changed.",
      heading: "Your password was changed",
      paragraphs: [`Hi ${name}, the password for your account was just changed and other sessions were signed out.`],
      footnote: `If this was not you, reset your password immediately and contact ${siteConfig.contact.supportEmail}.`,
    });
    return { to, subject: "Your password was changed", html, text, tag: "password-changed" };
  },

  invitation(to: string, orgName: string, inviterName: string, roleName: string, link: string): EmailMessage {
    const { html, text } = layout({
      preheader: `${inviterName} invited you to ${orgName}.`,
      heading: `Join ${orgName} on ${siteConfig.name}`,
      paragraphs: [`${inviterName} invited you to join ${orgName} as ${roleName}. The invitation expires in 7 days.`],
      cta: { label: "Accept invitation", url: link },
    });
    return { to, subject: `You're invited to ${orgName}`, html, text, tag: "invitation" };
  },

  paymentReceipt(to: string, data: { invoiceNumber: string; subtotal: string; vat: string; total: string; credit: string; method: string }): EmailMessage {
    const { html, text } = layout({
      preheader: `Payment received: ${data.total}.`,
      heading: "Payment received",
      paragraphs: ["Thank you. Your payment was confirmed and the balance has been added to your wallet."],
      rows: [
        ["Invoice", data.invoiceNumber],
        ["Subtotal", data.subtotal],
        ["VAT", data.vat],
        ["Total paid", data.total],
        ["Added to wallet", data.credit],
        ["Payment method", data.method],
      ],
      cta: { label: "View invoice", url: url("/dashboard/wallet") },
    });
    return { to, subject: `Payment receipt ${data.invoiceNumber}`, html, text, tag: "payment-receipt" };
  },

  lowBalance(to: string, balance: string, threshold: string): EmailMessage {
    const { html, text } = layout({
      preheader: `Balance is ${balance}.`,
      heading: "Your balance is running low",
      paragraphs: [`Your wallet balance is ${balance}, below your alert threshold of ${threshold}. Messages will not send once the balance runs out.`],
      cta: { label: "Add balance", url: url("/dashboard/wallet") },
      footnote: "You can change the alert threshold in Wallet settings.",
    });
    return { to, subject: "Low balance alert", html, text, tag: "low-balance" };
  },

  campaignCompleted(to: string, data: { name: string; recipients: number; delivered: number; failed: number; cost: string; campaignId: string }): EmailMessage {
    const { html, text } = layout({
      preheader: `${data.name} finished sending.`,
      heading: `Campaign completed: ${data.name}`,
      paragraphs: ["Your campaign has finished sending. Delivery reports may continue to arrive for a while."],
      rows: [
        ["Recipients", String(data.recipients)],
        ["Delivered", String(data.delivered)],
        ["Failed", String(data.failed)],
        ["Cost", data.cost],
      ],
      cta: { label: "View report", url: url(`/dashboard/campaigns/${data.campaignId}`) },
    });
    return { to, subject: `Campaign completed: ${data.name}`, html, text, tag: "campaign-completed" };
  },

  senderIdStatus(to: string, data: { value: string; status: "APPROVED" | "REJECTED" | "SUSPENDED"; reason?: string | null }): EmailMessage {
    const heading =
      data.status === "APPROVED" ? `Sender ID ${data.value} approved` : data.status === "REJECTED" ? `Sender ID ${data.value} was not approved` : `Sender ID ${data.value} suspended`;
    const { html, text } = layout({
      preheader: heading,
      heading,
      paragraphs: [
        data.status === "APPROVED"
          ? "You can now select this sender ID when sending messages."
          : `Reason: ${data.reason || "No reason was provided."} You can submit a new request with updated documents.`,
      ],
      cta: { label: "View sender IDs", url: url("/dashboard/sender-ids") },
    });
    return { to, subject: heading, html, text, tag: "sender-id-status" };
  },

  supportTicketUpdate(to: string, data: { number: number; subject: string; status: string; excerpt: string; ticketId: string }): EmailMessage {
    const { html, text } = layout({
      preheader: `Update on ticket #${data.number}`,
      heading: `Ticket #${data.number}: ${data.subject}`,
      paragraphs: [`Status: ${data.status}.`, data.excerpt],
      cta: { label: "View ticket", url: url(`/dashboard/support/${data.ticketId}`) },
    });
    return { to, subject: `[#${data.number}] ${data.subject}`, html, text, tag: "support-update" };
  },
};
