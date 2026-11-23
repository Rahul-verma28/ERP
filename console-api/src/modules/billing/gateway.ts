import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env, isDev } from '../../config/env';
import { AppError } from '../../kernel/errors';

// Payment gateway adapter. Razorpay when keys are set; otherwise, in
// development only, a built-in "test" gateway whose links open a local page with a Pay button.
// Both deliver payments through the same signed-webhook path, so the code that turns money
// into access (capturePayment) never knows which one was used.

export interface LinkRequest {
  orderId: string;
  amountPaise: number;
  description: string;
  customer: { name: string; email: string; mobile: string };
  expiresAt: Date;
}

/** A gateway event already verified and reduced to what billing needs. */
export interface PaidEvent {
  eventId: string;
  type: 'payment_link.paid' | 'other';
  linkId: string | null;
  paymentId: string | null;
  amountPaise: number;
  method: string | null;
}

export interface Gateway {
  name: 'razorpay' | 'test';
  createLink(req: LinkRequest): Promise<{ linkId: string; url: string }>;
  verify(rawBody: Buffer | string, signature: string | undefined): boolean;
  parse(body: unknown, headerEventId?: string): PaidEvent;
}

const hmac = (secret: string, body: Buffer | string) => createHmac('sha256', secret).update(body).digest('hex');

/** Constant-time HMAC-SHA256 check, as Razorpay signs webhooks (X-Razorpay-Signature). */
export function verifySignature(secret: string, rawBody: Buffer | string, signature: string | undefined) {
  if (!signature) return false;
  const expected = Buffer.from(hmac(secret, rawBody));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

type RazorpayEvent = {
  event?: string;
  created_at?: number;
  payload?: {
    payment_link?: { entity?: { id?: string; reference_id?: string } };
    payment?: { entity?: { id?: string; amount?: number; method?: string } };
  };
};

/** Pure: Razorpay webhook JSON → PaidEvent. */
export function parseRazorpay(body: unknown, headerEventId?: string): PaidEvent {
  const b = body as RazorpayEvent;
  const payment = b.payload?.payment?.entity;
  const link = b.payload?.payment_link?.entity;
  return {
    eventId: headerEventId || `${b.event}:${payment?.id ?? link?.id ?? b.created_at}`,
    type: b.event === 'payment_link.paid' ? 'payment_link.paid' : 'other',
    linkId: link?.id ?? null,
    paymentId: payment?.id ?? null,
    amountPaise: payment?.amount ?? 0,
    method: payment?.method ?? null,
  };
}

const configured = (v: string | undefined) => !!v && v.trim().length > 0;

const razorpay: Gateway = {
  name: 'razorpay',
  async createLink(req) {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: req.amountPaise,
        currency: 'INR',
        reference_id: req.orderId,
        description: req.description.slice(0, 2048),
        customer: { name: req.customer.name, email: req.customer.email, contact: req.customer.mobile },
        notify: { sms: true, email: true },
        reminder_enable: true,
        expire_by: Math.floor(req.expiresAt.getTime() / 1000),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; short_url?: string; error?: { description?: string } };
    if (!res.ok || !body.id || !body.short_url) {
      throw new AppError('PROVIDER_UNAVAILABLE', `Razorpay could not create the payment link${body.error?.description ? `: ${body.error.description}` : '.'}`);
    }
    return { linkId: body.id, url: body.short_url };
  },
  verify: (raw, sig) => configured(env.RAZORPAY_WEBHOOK_SECRET) && verifySignature(env.RAZORPAY_WEBHOOK_SECRET!, raw, sig),
  parse: parseRazorpay,
};

/** Development stand-in: links open a page on this API with a Pay button that posts a signed fake webhook. */
export const TEST_WEBHOOK_SECRET = 'ahead-dev-test-gateway';
const testGateway: Gateway = {
  name: 'test',
  async createLink(req) {
    const linkId = `plink_test_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    return { linkId, url: `${env.PUBLIC_URL}/api/v1/pay/test/${linkId}?amount=${req.amountPaise}` };
  },
  verify: (raw, sig) => verifySignature(TEST_WEBHOOK_SECRET, raw, sig),
  parse: parseRazorpay,
};

export function gateway(): Gateway {
  if (configured(env.RAZORPAY_KEY_ID) && configured(env.RAZORPAY_KEY_SECRET)) return razorpay;
  if (isDev) return testGateway;
  throw new AppError('PROVIDER_UNAVAILABLE', 'Online payments are not configured. Record the payment offline instead.');
}

/** Webhook verification by gateway name (the URL path says which gateway is calling). */
export function webhookGateway(name: string): Gateway | null {
  if (name === 'razorpay') return razorpay;
  if (name === 'test' && isDev) return testGateway;
  return null;
}

/** Dev only: the body + signature the test gateway sends when "Pay" is pressed. */
export function testWebhook(linkId: string, amountPaise: number) {
  const paymentId = `pay_test_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const body = JSON.stringify({
    event: 'payment_link.paid',
    created_at: Math.floor(Date.now() / 1000),
    payload: { payment_link: { entity: { id: linkId } }, payment: { entity: { id: paymentId, amount: amountPaise, method: 'test' } } },
  });
  return { body, signature: hmac(TEST_WEBHOOK_SECRET, body), eventId: `evt_test_${paymentId}` };
}
