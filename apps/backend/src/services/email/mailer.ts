import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

interface SendMailParams {
  to: string;
  subject: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: process.env.SMTP_SECURE !== "false",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, html }: SendMailParams): Promise<void> {
  const fromName = process.env.SMTP_FROM_NAME || "WUW Support";
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;

  await getTransporter().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html,
  });
}
