import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  PEPPER: z.string().min(16),
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Razorpay (design v2 Step 4b). Without keys, development uses a built-in test gateway.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // Email over SMTP (Gmail for now: an app password). Without it, email is written to the server log.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // SMS through textbee.dev (an Android phone sends them). Without it, SMS is written to the server log.
  TEXTBEE_API_KEY: z.string().optional(),
  TEXTBEE_URL: z.string().url().default('https://api.textbee.dev/api/v1'),
  // Files in Amazon S3 (or Cloudflare R2 with S3_ENDPOINT). Without a bucket, files stay on this computer.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  // Licences and Console <-> ERP calls (docs/architecture/console-erp-split.md). npm run licence:keys
  // makes them. The private key belongs only where the Console runs.
  LICENCE_PUBLIC_KEY: z.string().optional(),
  LICENCE_PRIVATE_KEY: z.string().optional(),
  /** Shared key for signed calls between the Console and this ERP */
  PROVISION_KEY: z.string().min(32).optional(),
  /** Which ERP installation this is (licences name it) */
  DEPLOYMENT_ID: z.string().regex(/^[a-z0-9-]{3,40}$/).default('cloud-dev'),
  RUN_WORKER: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
});

// An empty value (e.g. S3_ENDPOINT= in docker-compose) counts as not set
const parsed = EnvSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isDev = env.NODE_ENV !== 'production';
