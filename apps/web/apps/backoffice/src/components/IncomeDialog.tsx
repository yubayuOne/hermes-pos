import { useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, Select, useI18n } from '@hermes-pos/ui';
import { incomeEditSchema, incomeIdSchema, incomeSchema } from '../lib/schemas';
import type { OutletIncome } from '../lib/types';
import { useAction } from '../lib/useAction';
import { addOutletIncome, deleteOutletIncome, updateOutletIncome } from '../server/income';

/** Money into the outlet from outside the shifts (104). New income takes an outlet and a date; a change keeps the outlet. */
export function IncomeDialog({
  income,
  outlets,
  outletId,
  today,
  onClose,
}: {
  income: OutletIncome | null;
  outlets: { id: string; name: string }[];
  outletId: string | null;
  today: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const act = useAction();
  const [outlet, setOutlet] = useState(income?.outletId ?? outletId ?? outlets[0]?.id ?? '');
  const [date, setDate] = useState(income?.businessDate ?? today);
  const [amount, setAmount] = useState(income ? String(income.amount) : '');
  const [reason, setReason] = useState(income?.reason ?? '');
  const [confirming, setConfirming] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amountValue = Number(amount.replace(/\./g, ''));
    if (income) {
      const check = incomeEditSchema.safeParse({ id: income.id, businessDate: date, amount: amountValue, reason: reason.trim() });
      if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
      const res = await act.run(() => updateOutletIncome({ data: check.data }), { success: t('Pemasukan disimpan.') });
      if (res) onClose();
      return;
    }
    const check = incomeSchema.safeParse({ outletId: outlet, businessDate: date, amount: amountValue, reason: reason.trim() });
    if (!check.success) return act.setError(check.error.issues[0]?.message ?? 'Data tidak valid.');
    const res = await act.run(() => addOutletIncome({ data: check.data }), { success: t('Pemasukan dicatat.') });
    if (res) onClose();
  }

  async function remove() {
    if (!income) return;
    const res = await act.run(() => deleteOutletIncome({ data: incomeIdSchema.parse({ id: income.id }) }), { success: t('Pemasukan dihapus.') });
    if (res) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={confirming ? t('Hapus pemasukan ini?') : income ? t('Ubah pemasukan') : t('Tambah pemasukan')}
      description={confirming ? t('Kas outlet dihitung ulang tanpa pemasukan ini. Catatannya tidak disimpan.') : t('Uang masuk dari luar shift, langsung ke kas outlet.')}
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button className="border-error bg-error text-paper" onClick={remove} busy={act.busy} busyLabel={t('Menghapus...')}>
              {t('Hapus')}
            </Button>
          </>
        ) : (
          <>
            {income && (
              <Button className="mr-auto text-error" onClick={() => setConfirming(true)} disabled={act.busy}>
                {t('Hapus')}
              </Button>
            )}
            <Button onClick={onClose} disabled={act.busy}>
              {t('Batal')}
            </Button>
            <Button type="submit" form="income" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {t('Simpan')}
            </Button>
          </>
        )
      }
    >
      {confirming ? (
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      ) : (
        <form id="income" noValidate onSubmit={save} className="grid gap-4">
          {!income && outlets.length > 1 && (
            <Field label={t('Outlet')}>
              <Select value={outlet} onChange={(e) => setOutlet(e.target.value)}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Tanggal')}>
              <Input type="date" max={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            <Field label={t('Jumlah')}>
              <Input inputMode="numeric" className="font-mono" value={amount && Number(amount).toLocaleString('id-ID')} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <Field label={t('Alasan')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Misalnya modal tambahan')} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {[t('Modal tambahan'), t('Uang titipan')].map((s) => (
              <Button key={s} type="button" sm onClick={() => setReason(s)}>
                {s}
              </Button>
            ))}
          </div>
          <FormAlert>{act.error && t(act.error)}</FormAlert>
        </form>
      )}
    </Dialog>
  );
}
