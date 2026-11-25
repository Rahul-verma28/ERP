import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { AppError } from '../../kernel/errors';

// Real delivery: email over SMTP (Gmail for now) and SMS through textbee.dev. A channel with no
// provider set up is only written to the server log. Tests never send anything. Outside production
// nothing reaches a stranger: email goes to MAIL_REDIRECT_TO (or the SMTP mailbox), and SMS only to
// the numbers in SMS_ALLOW.

const testing = env.NODE_ENV === 'test' || !!process.env.VITEST;

export const providers = {
  email: !testing && !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS),
  sms: !testing && !!env.TEXTBEE_API_KEY,
  whatsapp: false,
};

let mailer: Transporter | null = null;
const transport = () =>
  (mailer ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // A slow mail server must not hold a request (or a database transaction) for long
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }));

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain text kept as it is, links made clickable, in a simple readable layout */
const html = (text: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:560px">${escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2450D8">$1</a>')
    .replace(/\n/g, '<br>')}<p style="margin-top:24px;font-size:12px;color:#9ca3af">Sent by AHEAD ERP</p></div>`;

const production = env.NODE_ENV === 'production';

/** Reserved test domains (RFC 2606: .test, .example, .invalid, .localhost, example.com/net/org) never
 *  receive email, in production too: demo and test data use them, and they only bounce */
export const reservedEmail = (to: string) => /@(?:[^@\s]+\.)?(?:example\.(?:com|net|org)|[^@\s]+\.(?:test|example|invalid|localhost))$/i.test(to.trim());

export async function sendEmail(to: string, subject: string, text: string) {
  if (reservedEmail(to)) {
    console.log(`✉️  Email to ${to} held (test address): ${subject}`);
    return;
  }
  const redirect = production ? null : env.MAIL_REDIRECT_TO ?? env.SMTP_USER ?? null;
  try {
    await transport().sendMail({ from: env.EMAIL_FROM || env.SMTP_USER, to: redirect ?? to, subject: redirect && redirect !== to ? `[for ${to}] ${subject}` : subject, text, html: html(text) });
  } catch (e) {
    console.error(`✉️  Email to ${to} failed: ${e instanceof Error ? e.message : e}`);
    throw new AppError('PROVIDER_UNAVAILABLE', "The email couldn't be sent just now. Try again in a minute.");
  }
}

/** Indian numbers stored as 10 digits get +91; numbers already with a country code stay */
export function smsNumber(to: string) {
  const digits = to.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

export async function sendSms(to: string, text: string) {
  if (!production) {
    const allowed = (env.SMS_ALLOW ?? '').split(',').map((n) => smsNumber(n.trim())).filter(Boolean);
    if (!allowed.includes(smsNumber(to))) {
      console.log(`📱 SMS to ${to} held (not in SMS_ALLOW outside production): ${text.slice(0, 80)}`);
      return;
    }
  }
  const fail = (why: string) => {
    console.error(`📱 SMS to ${to} failed: ${why}`);
    return new AppError('PROVIDER_UNAVAILABLE', "The SMS couldn't be sent just now. Try again in a minute.");
  };
  let res: Response;
  try {
    res = await fetch(`${env.TEXTBEE_URL}/gateway/send-sms`, {
      method: 'POST',
      headers: { 'x-api-key': env.TEXTBEE_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: [smsNumber(to)], message: text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw fail(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw fail(`${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
}
