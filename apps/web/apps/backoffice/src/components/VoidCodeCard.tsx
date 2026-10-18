import { useEffect, useState } from 'react';
import { Button, Card, CardTitle, Field, Input, Tag, useI18n } from '@hermes-pos/ui';
import { voidCodeSchema } from '../lib/schemas';
import { useAction } from '../lib/useAction';
import { saveVoidCode, voidCodeStatus } from '../server/settings';

/**
 * Owner approval code for voids on the POS (PRD C8, migration 032). A cashier can only void a paid bill when the
 * owner types this code on the device. Stored as a hash; nobody can read it back, so a forgotten code is replaced.
 * Lives on the Kasir page, next to the cashiers' PINs.
 */
export function VoidCodeCard() {
  const { t } = useI18n();
  const [has, setHas] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = useAction();
  useEffect(() => {
    void voidCodeStatus()
      .then(setHas)
      .catch(() => setHas(null));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = voidCodeSchema.safeParse({ code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Kode persetujuan harus 6 digit angka.');
      return;
    }
    const res = await act.run(() => saveVoidCode({ data: parsed.data }), { success: t('Kode persetujuan disimpan. Berlaku langsung di semua kasir.') });
    if (res) {
      setHas(true);
      setCode('');
    }
  }
  return (
    <Card>
      <CardTitle sub={t('Kasir hanya bisa membatalkan bill yang sudah dibayar kalau pemilik mengetik kode ini di perangkat kasir.')}>
        {t('Kode persetujuan void')}
      </CardTitle>
      <p className="mt-3 flex items-center gap-2 text-[15px]">
        {has === null ? (
          <span className="text-mute">{t('Status kode belum dimuat.')}</span>
        ) : has ? (
          <Tag tone="pine">{t('sudah dibuat')}</Tag>
        ) : (
          <Tag tone="fire">{t('belum dibuat')}</Tag>
        )}
      </p>
      <form method="post" noValidate onSubmit={submit} className="mt-4 grid max-w-[420px] gap-3">
        <Field
          label={has ? t('Kode baru') : t('Kode 6 digit')}
          error={(error && t(error)) || (act.error && t(act.error))}
          help={t('Kode disimpan sebagai hash dan tidak bisa dilihat lagi. Kalau lupa, buat kode baru di sini. Lima kali salah mengunci void selama 5 menit.')}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="font-mono tracking-[.2em]"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
          />
        </Field>
        <div>
          <Button type="submit" variant="ink" busy={act.busy} busyLabel={t('Menyimpan...')}>
            {has ? t('Ganti kode') : t('Simpan kode')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
