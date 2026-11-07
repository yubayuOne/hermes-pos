export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; field?: string };

/** Every business's payment (admin_list_payments, migration 110). */
export type AdminPayment = {
  id: string;
  invoiceNumber: string;
  provider: 'manual' | 'midtrans';
  business: string;
  planCode: 'daily' | 'weekly' | 'monthly' | 'annual';
  extraOutlets: number;
  amountDue: number;
  amountPaid: number;
  status: 'pending' | 'submitted' | 'verified' | 'rejected';
  rejectReason: string | null;
  senderName: string;
  bankName: string;
  createdAt: string;
};
export type AdminPaymentList = { total: number; rows: AdminPayment[] };
