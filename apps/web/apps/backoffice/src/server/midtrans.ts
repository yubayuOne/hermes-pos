import { createHash, timingSafeEqual } from 'node:crypto';

// Pure, with no imports from this app: the tests run it as plain Node. Only the server calls it (110).

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is not set`);
  return v;
}

/** Sandbox until MIDTRANS_IS_PRODUCTION is 'true'. */
const base = () => (process.env.MIDTRANS_IS_PRODUCTION === 'true' ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com');

/** Creates a Snap transaction and returns the page the buyer pays on. Midtrans hosts that page, so no card data reaches us. */
export async function createSnapTransaction(order: { orderId: string; amount: number; name: string; email: string }): Promise<string> {
  const res = await fetch(`${base()}/snap/v1/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${env('MIDTRANS_SERVER_KEY')}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      transaction_details: { order_id: order.orderId, gross_amount: order.amount },
      customer_details: { first_name: order.name, email: order.email },
      expiry: { unit: 'hour', duration: 24 },
    }),
  });
  const body = (await res.json().catch(() => null)) as { redirect_url?: string } | null;
  if (!res.ok || !body?.redirect_url) throw new Error('Midtrans tidak bisa membuat pembayaran. Coba lagi.');
  return body.redirect_url;
}

/** Midtrans signs every notification: sha512(order_id + status_code + gross_amount + server key). Compared in constant time. */
export function notificationIsAuthentic(n: Record<string, unknown>): boolean {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) return false;
  const expected = createHash('sha512').update(`${n.order_id}${n.status_code}${n.gross_amount}${key}`).digest('hex');
  const given = String(n.signature_key ?? '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
