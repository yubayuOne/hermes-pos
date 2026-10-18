import { useEffect, useRef, useState } from 'react';
import { Button, FormAlert, decimal, useI18n } from '@hermes-pos/ui';
import { useLock } from '../lib/app';
import { describeError } from '../lib/errors';
import { compressLogo } from '../lib/logo';
import { useAction } from '../lib/useAction';
import type { Outlet } from '../lib/types';
import { removeOutletLogo, uploadOutletLogo } from '../server/manage';

/**
 * Outlet logo (POS header, cashier picker, on-screen receipt, and the printed receipt from its ESC/POS print
 * version). The file is compressed here and the preview shows the exact blob that will be uploaded.
 */
export function OutletLogo({ outlet }: { outlet: Outlet }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const act = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<{ blob: Blob; print: Uint8Array<ArrayBuffer>; url: string } | null>(null);
  const [compressing, setCompressing] = useState(false);
  useEffect(
    () => () => {
      if (draft) URL.revokeObjectURL(draft.url);
    },
    [draft],
  );

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    act.setError(null);
    setCompressing(true);
    try {
      const { blob, print } = await compressLogo(file);
      setDraft({ blob, print, url: URL.createObjectURL(blob) });
    } catch (err) {
      act.setError(describeError(err));
    } finally {
      setCompressing(false);
    }
  }

  async function save() {
    if (!draft) return;
    const form = new FormData();
    form.set('outletId', outlet.id);
    form.set('file', draft.blob, draft.blob.type === 'image/png' ? 'logo.png' : 'logo.webp');
    form.set('print', new Blob([draft.print], { type: 'application/octet-stream' }), 'logo.bin');
    if (await act.run(() => uploadOutletLogo({ data: form }), { success: t('Logo outlet disimpan.'), refreshAppContext: true })) setDraft(null);
  }

  const src = draft?.url ?? outlet.logoUrl;
  return (
    <div className="mt-5 border-t border-dashed border-ink pt-4">
      <p className="font-mono text-[14px] text-mute">{t('Logo outlet')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="grid h-[88px] w-[88px] shrink-0 place-items-center border border-dashed border-ink">
          {src ? (
            <img src={src} alt={t('Logo {name}', { name: outlet.name })} className="h-full w-full object-contain" />
          ) : (
            <span className="text-[12px] text-mute">{t('Belum ada')}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <Button variant="fire" sm busy={act.busy} onClick={save} {...lock.props}>
                {lock.label(t('Simpan logo'))}
              </Button>
              <Button sm disabled={act.busy} onClick={() => setDraft(null)}>
                {t('Batal')}
              </Button>
            </>
          ) : (
            <>
              <Button sm busy={compressing} onClick={() => input.current?.click()} {...lock.props}>
                {lock.label(outlet.logoUrl ? t('Ganti logo') : t('Unggah logo'))}
              </Button>
              {outlet.logoUrl && (
                <Button
                  sm
                  busy={act.busy}
                  onClick={() =>
                    act.run(() => removeOutletLogo({ data: { outletId: outlet.id } }), { success: t('Logo outlet dihapus.'), refreshAppContext: true })
                  }
                  {...lock.props}
                >
                  {lock.label(t('Hapus logo'))}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      <p className="mt-2 text-[14px] text-mute">
        {draft
          ? t('Sudah dikompres: {size} KB. Simpan untuk memakainya di aplikasi kasir.', { size: decimal(draft.blob.size / 1024, lang) })
          : t('PNG, JPEG, atau WebP sampai 10 MB. Persegi dengan latar transparan paling rapi.')}
      </p>
      <FormAlert>{act.error && t(act.error)}</FormAlert>
    </div>
  );
}
