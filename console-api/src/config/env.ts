import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5100),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PEPPER: z.string().min(16),
  /** 32 bytes, base64: encrypts two-step secrets at rest */
  MFA_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'MFA_KEY must be 32 bytes, base64'),
  /** Web apps allowed to call this API (comma separated origins) */
  APP_ORIGINS: z.string().default('http://localhost:3001').transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /** Ed25519 private key (base64 PKCS#8 DER): only the Console signs licences */
  LICENCE_PRIVATE_KEY: z.string().min(40),
  /** The cloud ERP installation */
  ERP_URL: z.string().url(),
  /** Where business owners open the ERP (setup links point there) */
  ERP_APP_URL: z.string().url().default('http://localhost:3000'),
  PROVISION_KEY: z.string().min(32),
  DEPLOYMENT_ID: z.string().regex(/^[a-z0-9-]{3,40}$/).default('cloud-dev'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** Where this API is reached from outside (payment pages, gateway webhooks) */
  PUBLIC_URL: z.string().url().default('http://localhost:5100'),
  // Razorpay payment links. Without keys, development uses a built-in test gateway.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Every email goes to this address instead (subject names the real recipient). Development: SMTP_USER unless set. */
  MAIL_REDIRECT_TO: z.string().email().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  RUN_WORKER: z.string().default('true').transform((v) => v !== 'false'),
});

// An empty value counts as not set
const parsed = EnvSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = { ...parsed.data, MAIL_REDIRECT_TO: parsed.data.MAIL_REDIRECT_TO ?? (parsed.data.NODE_ENV === 'production' ? undefined : parsed.data.SMTP_USER) };
export const isDev = env.NODE_ENV !== 'production';
export const testing = env.NODE_ENV === 'test' || !!process.env.VITEST;
