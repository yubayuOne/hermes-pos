import { useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Button, Card, Dialog, Empty, Field, FormAlert, Input, Tag, Wordmark, dateShort, money, useI18n } from '@hermes-pos/ui';
import { Pagination } from '../components/Pagination';
import { paymentStatuses } from '../lib/schemas';
import type { AdminPayment } from '../lib/types';
import { useAction } from '../lib/useAction';
import { isPlatformAdmin, listAdminPayments, rejectPayment, signOut, verifyPayment } from '../server/admin';

type Search = { status?: (typeof paymentStatuses)[number]; page: number };
const PAGE = 20;

/** Platform admin: every business's payments. Anyone not signed in as an admin goes to the sign-in page (110). */
export const Route = createFileRoute('/admin')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    status: (paymentStatuses as readonly string[]).includes(s.status as string) ? (s.status as Search['status']) : undefined,
    page: Number(s.page) > 1 ? Math.floor(Number(s.page)) : 1,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!(await isPlatformAdmin())) throw redirect({ to: '/login' });
    return listAdminPayments({ data: { status: deps.status ?? null, page: deps.page } });
  },
  component: AdminPayments,
});

const STATUS = { pending: ['Menunggu bayar', 'mute'], submitted: ['Diperiksa', 'fire'], verified: ['Lunas', 'pine'], rejected: ['Ditolak', 'mute'] } as const;
const PLAN = { daily: 'Harian', weekly: 'Mingguan', monthly: 'Bulanan', annual: 'Tahunan' } as const;

function AdminPayments() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/admin' });
  const set = (patch: Partial<Search>) => navigate({ search: (s: Search) => ({ ...s, ...patch }) });
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  return (
    <div className="min-h-dvh">
      <header className="flex flex-wrap items-center gap-4 border-b-[1.5px] border-ink px-4 py-4 md:px-10">
        <Wordmark size={28} />
        <span className="font-mono text-small text-mute">admin pembayaran</span>
        <div className="ml-auto">
          <Button sm onClick={async () => { await signOut(); await navigate({ to: '/login' }); }}>
            Keluar
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-8 md:px-10">
        <h1 className="page-t">Pembayaran langganan</h1>
        <nav aria-label="Filter status" className="mt-6 flex flex-wrap gap-2">
          <Button sm variant={search.status ? 'plain' : 'fire'} onClick={() => set({ status: undefined, page: 1 })}>
            Semua
          </Button>
          {paymentStatuses.map((s) => (
            <Button key={s} sm variant={search.status === s ? 'fire' : 'plain'} onClick={() => set({ status: s, page: 1 })}>
              {t(STATUS[s][0])}
            </Button>
          ))}
        </nav>
        {data.rows.length === 0 ? (
          <Empty className="mt-8" title="Belum ada pembayaran." />
        ) : (
          <div className="mt-6 grid gap-4">
            {data.rows.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
            <div className="grid justify-items-center">
              <Pagination page={search.page} pages={pages} onPage={(p) => set({ page: p })} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function PaymentRow({ payment: p }: { payment: AdminPayment }) {
  const { t, lang } = useI18n();
  const act = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const open = p.status === 'submitted';
  return (
    <Card as="article" aria-label={p.invoiceNumber}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {p.business} · {PLAN[p.planCode]}
            {p.extraOutlets > 0 ? ` · +${p.extraOutlets} outlet` : ''}
          </p>
          <p className="mt-1 font-mono text-small text-mute">
            {p.invoiceNumber} · {p.provider === 'midtrans' ? 'Midtrans' : 'Transfer bank'} · {dateShort(p.createdAt, lang)}
          </p>
          {p.provider === 'manual' && (
            <p className="mt-1 text-small text-mute">
              {p.senderName} · {p.bankName}
            </p>
          )}
          {p.rejectReason && <p className="mt-1 text-small text-error">{p.rejectReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tag tone={STATUS[p.status][1]}>{t(STATUS[p.status][0])}</Tag>
          <span className="font-mono font-semibold">{money(p.amountDue)}</span>
          {open && (
            <>
              <Button sm variant="fire" busy={act.busy} onClick={() => act.run(() => verifyPayment({ data: { id: p.id } }), { success: 'Pembayaran diterima.' })}>
                Terima
              </Button>
              <Button sm onClick={() => setRejecting(true)} disabled={act.busy}>
                Tolak
              </Button>
            </>
          )}
        </div>
      </div>
      {rejecting && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRejecting(false)}
          title={`Tolak pembayaran ${p.invoiceNumber}?`}
          footer={
            <>
              <Button onClick={() => setRejecting(false)}>Batal</Button>
              <Button
                variant="fire"
                busy={act.busy}
                onClick={async () => {
                  const res = await act.run(() => rejectPayment({ data: { id: p.id, reason } }), { success: 'Pembayaran ditolak.' });
                  if (res) setRejecting(false);
                }}
              >
                Tolak
              </Button>
            </>
          }
        >
          <Field label="Alasan">
            <Input value={reason} maxLength={200} autoFocus onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormAlert>{act.error}</FormAlert>
        </Dialog>
      )}
    </Card>
  );
}
