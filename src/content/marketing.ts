/**
 * Marketing copy as structured data. Original copy written for SMSFlow BD. Claims are kept
 * verifiable: anything that depends on the upstream provider, operators or regulators says so.
 * To add Bangla, create a parallel file (marketing.bn.ts) with the same shape.
 */

export const faqs = {
  general: [
    {
      q: "What is the difference between masking and non-masking SMS?",
      a: "A masking sender ID shows your brand name (for example YOURBRAND) as the sender. A non-masking message shows a phone number. Masking IDs need approval through the provider and operators, which can take several working days and may require documents such as a trade licence.",
    },
    {
      q: "How are messages priced?",
      a: "You pay per SMS segment in BDT. The rate depends on your plan, whether the message is transactional or promotional, and whether you use a masking or non-masking sender. Your dashboard and the composer always show the exact rate and the estimated cost before you send.",
    },
    {
      q: "What is an SMS segment?",
      a: "A standard SMS holds up to 160 characters of plain Latin text. Longer messages are split into segments of 153 characters. Messages with Bangla or other Unicode characters hold up to 70 characters, or 67 per segment when split. Each segment is billed. These limits are configurable because some providers count differently.",
    },
    {
      q: "Do you support Bangla messages?",
      a: "Yes. Bangla text is sent as Unicode. The composer detects it automatically and shows the character count, segments and cost as you type.",
    },
    {
      q: "Is VAT included in prices?",
      a: "Listed SMS rates exclude VAT. VAT is added when you top up your wallet and shown separately on your invoice. The applicable rate is configured by the operator of this platform.",
    },
    {
      q: "Does purchased balance expire?",
      a: "Balance validity is set in the pricing policy and shown on the pricing page. Contact support if you need an extension.",
    },
  ],
  delivery: [
    {
      q: "Can you guarantee delivery?",
      a: "No SMS platform can honestly guarantee delivery: handsets can be switched off, numbers can be inactive, and operators can filter traffic. We report the status of every message so you can see exactly what happened, and failed messages are refunded according to the refund policy.",
    },
    {
      q: "How do delivery reports work?",
      a: "Each message moves through statuses such as queued, sent, delivered or failed. Statuses come from the connected SMS provider's delivery reports. You can see them per message in Reports, per campaign, through the API, or receive them on your own webhook.",
    },
    {
      q: "Why did a message fail?",
      a: "Common reasons are an unreachable handset, an invalid or inactive number, an unapproved sender ID, or operator filtering. The failure reason reported by the provider is shown next to each message.",
    },
  ],
  compliance: [
    {
      q: "What is the difference between transactional and promotional SMS?",
      a: "Transactional messages are triggered by something the recipient did or needs to know: OTPs, order confirmations, payment alerts. Promotional messages advertise offers. Promotional messages must only go to people who agreed to receive them, respect opt-outs, and may be restricted to certain hours.",
    },
    {
      q: "How do opt-outs work?",
      a: "Each organization has a suppression list. Numbers on it are automatically skipped for promotional messages. Numbers are added when a recipient replies with an opt-out keyword (where the provider supports inbound messages), or when you add them manually or by import.",
    },
    {
      q: "Do you review campaigns?",
      a: "New accounts and large campaigns can require review before sending. Review protects your sender reputation and helps keep the platform free of spam and fraud.",
    },
  ],
  developers: [
    {
      q: "Is there an API?",
      a: "Yes. A versioned REST API (/api/v1) with Bearer API keys, JSON requests and responses, idempotency keys, rate-limit headers and signed webhooks for delivery reports. See the documentation for examples in cURL, JavaScript, PHP and Python.",
    },
    {
      q: "Can I test without sending real messages?",
      a: "Development environments of this platform can run with a mock provider that never sends real messages and simulates delivery results. Ask your account contact about a sandbox key for your integration.",
    },
  ],
};

export const allFaqs = [...faqs.general, ...faqs.delivery, ...faqs.compliance, ...faqs.developers];

export interface Solution {
  slug: string;
  name: string;
  title: string;
  summary: string;
  useCases: { title: string; body: string; example: string }[];
  recommended: string[];
}

export const solutions: Solution[] = [
  {
    slug: "ecommerce",
    name: "E-commerce",
    title: "SMS for online stores",
    summary: "Confirm orders, share delivery updates and send offers to customers who opted in.",
    useCases: [
      { title: "Order confirmation", body: "Send a confirmation the moment checkout completes, straight from your store backend.", example: "Your order #10234 is confirmed. We will text you when it ships." },
      { title: "Delivery updates", body: "Tell customers when the rider is on the way so fewer deliveries fail.", example: "Your parcel is out for delivery today. Keep your phone reachable." },
      { title: "Cash-on-delivery verification", body: "Verify phone numbers with an OTP before accepting COD orders.", example: "Your verification code is 482913. It expires in 5 minutes." },
      { title: "Seasonal offers", body: "Run Eid or Pohela Boishakh campaigns to your opted-in segment only.", example: "Eid offer: 15% off selected items this week. Reply STOP to opt out." },
    ],
    recommended: ["SMS API", "Webhooks", "Contact groups", "Scheduling"],
  },
  {
    slug: "education",
    name: "Education",
    title: "SMS for schools, colleges and coaching centres",
    summary: "Reach guardians and students with notices, results and fee reminders.",
    useCases: [
      { title: "Notices and closures", body: "Send class, exam or closure notices to every guardian in minutes.", example: "School will remain closed tomorrow due to weather. Classes resume Sunday." },
      { title: "Fee reminders", body: "Schedule reminders ahead of due dates with personalised student names.", example: "Dear guardian, tuition fee for {{name}} is due on 10 March." },
      { title: "Attendance alerts", body: "Notify guardians automatically from your school management software via the API.", example: "{{name}} was marked absent today." },
      { title: "Result publication", body: "Announce results with a link to the portal.", example: "HSC test results are published. Check the portal with your roll number." },
    ],
    recommended: ["Bulk SMS", "Templates", "Scheduling", "Bangla messages"],
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    title: "SMS for hospitals, clinics and diagnostic centres",
    summary: "Appointment reminders and report-ready alerts that reduce missed visits and calls.",
    useCases: [
      { title: "Appointment reminders", body: "Remind patients a day before their appointment.", example: "Reminder: your appointment with Dr. {{doctor}} is tomorrow at 11:00." },
      { title: "Report ready", body: "Tell patients when test reports can be collected or downloaded.", example: "Your test report is ready. Collect it from the front desk." },
      { title: "Queue updates", body: "Reduce crowding by texting patients when their turn is close.", example: "Your serial is next. Please come to room 204." },
      { title: "Health camps", body: "Invite opted-in patients to screening days.", example: "Free screening this Friday at all branches. Reply STOP to opt out." },
    ],
    recommended: ["Transactional SMS", "Scheduling", "Team roles", "Audit logs"],
  },
  {
    slug: "banking-fintech",
    name: "Banking & fintech",
    title: "SMS for banks, MFS and fintech products",
    summary: "OTPs and account alerts through an API with scoped keys, audit logs and delivery tracking.",
    useCases: [
      { title: "Login and transaction OTP", body: "Send one-time codes with idempotent API requests so retries never double-send.", example: "Your OTP is 739201. Never share it with anyone, including bank staff." },
      { title: "Account alerts", body: "Notify customers about debits, credits and balance changes.", example: "BDT 2,500 debited from A/C ***4412 on 12 Mar. Balance BDT 18,240." },
      { title: "Security notices", body: "Alert customers to new device logins or password changes.", example: "A new device signed in to your account. If this wasn't you, call us." },
      { title: "Payment reminders", body: "Remind borrowers ahead of instalment dates.", example: "Your instalment of BDT 4,200 is due on 5 April." },
    ],
    recommended: ["SMS API", "IP allowlists", "Webhooks", "Audit logs"],
  },
  {
    slug: "retail",
    name: "Retail",
    title: "SMS for shops and retail chains",
    summary: "Loyalty updates, new arrivals and in-store offers for customers who opted in.",
    useCases: [
      { title: "Loyalty points", body: "Tell members their points balance after each purchase.", example: "You earned 120 points. Your balance is 860 points." },
      { title: "New arrivals", body: "Announce collections to a segment of opted-in customers.", example: "New winter collection now in store. Reply STOP to opt out." },
      { title: "Store events", body: "Invite nearby customers to openings and sales.", example: "Our Uttara branch opens on Friday. Visit us for opening offers." },
      { title: "Receipts", body: "Send a short digital receipt instead of paper.", example: "Thank you for shopping. Total BDT 1,240. Receipt #A-5521." },
    ],
    recommended: ["Contact import", "Groups and tags", "Opt-out management", "Scheduling"],
  },
  {
    slug: "logistics",
    name: "Logistics",
    title: "SMS for courier and logistics companies",
    summary: "Pickup, in-transit and delivery notifications triggered from your tracking system.",
    useCases: [
      { title: "Pickup confirmation", body: "Confirm parcel pickup with a tracking reference.", example: "Parcel picked up. Tracking ID CX20931. Track at the link in your receipt." },
      { title: "Out for delivery", body: "Notify recipients with the rider's contact.", example: "Your parcel is out for delivery. Rider: 01XXXXXXXXX." },
      { title: "Delivery OTP", body: "Confirm handover with a one-time code.", example: "Share code 4471 with the rider to receive your parcel." },
      { title: "Failed attempt", body: "Explain next steps after a missed delivery.", example: "We couldn't reach you today. We'll try again tomorrow." },
    ],
    recommended: ["SMS API", "Bulk API", "Delivery webhooks", "Reports"],
  },
  {
    slug: "government-ngo",
    name: "Government & NGO",
    title: "SMS for public services and development programmes",
    summary: "Programme notices, reminders and field updates with approvals and audit trails.",
    useCases: [
      { title: "Beneficiary notices", body: "Tell beneficiaries about distribution dates and locations.", example: "Distribution will take place on 14 May at the union parishad office." },
      { title: "Health campaigns", body: "Send vaccination or awareness reminders in Bangla.", example: "আগামী শনিবার টিকাদান কর্মসূচি অনুষ্ঠিত হবে।" },
      { title: "Field staff alerts", body: "Coordinate field teams with quick updates.", example: "Team meeting moved to 3pm at the district office." },
      { title: "Surveys", body: "Invite participants to phone or web surveys.", example: "Please join our 5-minute survey. Your answers are anonymous." },
    ],
    recommended: ["Bangla messages", "Campaign review", "Team roles", "Audit logs"],
  },
  {
    slug: "software",
    name: "Software companies",
    title: "SMS for SaaS and software products",
    summary: "Add SMS to your product with a clean REST API, webhooks and per-environment keys.",
    useCases: [
      { title: "Two-factor authentication", body: "Send login codes from your auth service.", example: "Your sign-in code is 118204." },
      { title: "Usage alerts", body: "Notify customers when usage or billing thresholds are reached.", example: "You've used 90% of your monthly quota." },
      { title: "Incident updates", body: "Reach on-call staff and key customers when email isn't enough.", example: "Incident resolved. All services are operating normally." },
      { title: "White-label messaging", body: "Send on behalf of your customers with separate keys and reporting.", example: "Your appointment at {{business}} is confirmed." },
    ],
    recommended: ["REST API", "Scoped API keys", "Webhooks", "Rate-limit headers"],
  },
];

export const industries = ["E-commerce", "Education", "Healthcare", "Retail", "SaaS", "Finance", "Logistics", "NGOs"];
