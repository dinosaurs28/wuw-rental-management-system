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

// ── Diagnostics (admin) ─────────────────────────────────────────────────────
// Mirrors the settings getTransporter() uses so the admin sees exactly what the
// server will try. Never exposes the password.

export interface SmtpStatus {
  configured: boolean;
  missing: string[];
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  fromEmail: string | null;
  fromName: string;
}

export function getSmtpStatus(): SmtpStatus {
  const missing = (["SMTP_USER", "SMTP_APP_PASSWORD"] as const).filter(
    (name) => !process.env[name]?.trim(),
  );
  return {
    configured: missing.length === 0,
    missing,
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== "false",
    user: process.env.SMTP_USER?.trim() || null,
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || null,
    fromName: process.env.SMTP_FROM_NAME || "WUW Support",
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${Math.round(timeoutMs / 1000)} s`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Connects and authenticates without sending anything. */
export async function verifySmtpConnection(
  timeoutMs = 15_000,
): Promise<{ ok: boolean; durationMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await withTimeout(getTransporter().verify(), timeoutMs, "SMTP connection");
    return { ok: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** sendMail with an upper bound on how long the caller waits. */
export function sendMailWithTimeout(params: SendMailParams, timeoutMs = 20_000): Promise<void> {
  return withTimeout(sendMail(params), timeoutMs, "Sending the email");
}
