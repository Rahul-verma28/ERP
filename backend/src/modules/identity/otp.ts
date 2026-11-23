import type { OtpPurpose } from '@prisma/client';
import { db } from '../../kernel/db';
import { AppError } from '../../kernel/errors';
import { otpCode, pepperedHash } from '../../kernel/crypto';
import { sendMessage } from '../notifications/service';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const BLOCK_MS = 15 * 60 * 1000;

const codeHash = (target: string, purpose: string, code: string) => pepperedHash(`${purpose}:${target}:${code}`);

/** Create and deliver a 6-digit OTP. The code only ever leaves by SMS or email (and the dev log). */
export async function sendOtp(target: string, purpose: OtpPurpose) {
  const tx = db();
  const recent = await tx.otpCode.findFirst({ where: { target, purpose }, orderBy: { createdAt: 'desc' } });
  if (recent && recent.attempts >= MAX_ATTEMPTS && recent.createdAt.getTime() > Date.now() - BLOCK_MS) {
    throw new AppError('RATE_LIMITED', 'Too many wrong attempts. Try again in 15 minutes.', { retryAfter: 900 });
  }
  const code = otpCode();
  const channel = target.includes('@') ? 'email' : 'sms';
  await tx.otpCode.create({
    data: { target, purpose, channel, codeHash: codeHash(target, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });
  await sendMessage({ channel, to: target, template: `otp.${purpose}`, text: `Your AHEAD verification code is ${code}. It expires in 5 minutes.` });
  return { channel };
}

/** Check the latest OTP for target+purpose and consume it. Returns the OTP row id. */
export async function consumeOtp(target: string, purpose: OtpPurpose, code: string): Promise<string> {
  return matchOtp(target, purpose, code, true);
}

/**
 * Check a code without using it up, so a form can confirm it before asking for the rest (a new
 * password). A wrong code still counts towards the three tries; the final step consumes it.
 */
export async function checkOtp(target: string, purpose: OtpPurpose, code: string): Promise<void> {
  await matchOtp(target, purpose, code, false);
}

async function matchOtp(target: string, purpose: OtpPurpose, code: string, consume: boolean): Promise<string> {
  const tx = db();
  const otp = await tx.otpCode.findFirst({ where: { target, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!otp || otp.expiresAt < new Date()) throw new AppError('OTP_INVALID', 'The code has expired. Please request a new one.');
  if (otp.attempts >= MAX_ATTEMPTS) throw new AppError('RATE_LIMITED', 'Too many wrong attempts. Try again in 15 minutes.', { retryAfter: 900 });
  if (otp.codeHash !== codeHash(target, purpose, code)) {
    await tx.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new AppError('OTP_INVALID', 'The code is incorrect.', { attemptsLeft: MAX_ATTEMPTS - otp.attempts - 1 });
  }
  if (consume) await tx.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return otp.id;
}
