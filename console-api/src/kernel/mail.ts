import nodemailer, { type Transporter } from 'nodemailer';
import { env, testing } from '../config/env';
import { AppError } from './errors';

// Email from the Console (staff invites, password resets, owner setup links). Without SMTP set,
// or in tests, the message is written to the server log instead.

let mailer: Transporter | null = null;
const ready = () => !testing && !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

/** Development: the last messages, for checking links without a mailbox */
export const sentLog: { to: string; subject: string; text: string; at: string }[] = [];

export async function sendEmail(to: string, subject: string, text: string) {
  sentLog.unshift({ to, subject, text, at: new Date().toISOString() });
  sentLog.length = Math.min(sentLog.length, 50);
  if (!ready()) {
    console.log(`\n✉️  [console email] to ${to}: ${subject}\n   ${text}\n`);
    return;
  }
  mailer ??= nodemailer.createTransport({
    host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  try {
    await mailer.sendMail({ from: env.EMAIL_FROM || env.SMTP_USER, to, subject, text });
  } catch (e) {
    console.error(`✉️  Email to ${to} failed: ${e instanceof Error ? e.message : e}`);
    throw new AppError('PROVIDER_UNAVAILABLE', "The email couldn't be sent just now. Try again in a minute.");
  }
}
