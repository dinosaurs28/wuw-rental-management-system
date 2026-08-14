import dotenv from "dotenv";
dotenv.config();

import { sendMail } from "../src/services/email/mailer.js";
import { generatePasswordResetEmailTemplate } from "../src/services/email/passwordResetTemplate.js";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: tsx scripts/test-mailer.ts <recipient-email>");
    process.exit(1);
  }

  await sendMail({
    to,
    subject: "VRMS SMTP Test — Password Reset Email",
    html: generatePasswordResetEmailTemplate({
      userName: "Test User",
      resetLink: "https://example.com/auth/reset-password/sample-token-123",
      expiryMinutes: 30,
    }),
  });

  console.log(`Test email sent to ${to}`);
}

main().catch((err) => {
  console.error("Failed to send test email:", err);
  process.exit(1);
});
