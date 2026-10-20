import { useEffect, useRef, useState } from 'react';
import { Button, FormAlert, decimal, useI18n } from '@hermes-pos/ui';
import { useLock } from '../lib/app';
import { describeError } from '../lib/errors';
import { compressProductImage } from '../lib/productImage';
import { useAction } from '../lib/useAction';
import type { Product } from '../lib/types';
import { removeProductImage, uploadProductImage } from '../server/manage';

/**
 * A product's photo for the cashier app's Foto view (migration 080). Like the outlet logo: compressed here, and the
 * preview shows the exact file that will be uploaded. Saved at once, apart from the product form.
 */
export function ProductPhoto({ outletId, product }: { outletId: string; product: Product }) {
  const { t, lang } = useI18n();
  const lock = useLock();
  const act = useAction();
  const input = useRef<HTMLInputElement>(null);
  // The dialog keeps the product it opened with, so the saved photo is tracked here.
  const [saved, setSaved] = useState(product.imageUrl);
  const [draft, setDraft] = useState<{ blob: Blob; url: string } | null>(null);
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
      const blob = await compressProductImage(file);
      setDraft({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      act.setError(describeError(err));
    } finally {
      setCompressing(false);
    }
  }

  async function save() {
    if (!draft) return;
    const form = new FormData();
    form.set('outletId', outletId);
    form.set('productId', product.id);
    form.set('file', draft.blob, draft.blob.type === 'image/jpeg' ? 'photo.jpg' : 'photo.webp');
    if (await act.run(() => uploadProductImage({ data: form }), { success: t('Foto {name} disimpan.', { name: product.name }) })) {
      setSaved(draft.url);
      setDraft(null);
    }
  }

  async function remove() {
    if (await act.run(() => removeProductImage({ data: { outletId, productId: product.id } }), { success: t('Foto {name} dihapus.', { name: product.name }) }))
      setSaved(null);
  }

  const src = draft?.url ?? saved;
  return (
    <div className="fld">
      <span className="fld-l">{t('Foto')}</span>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-[88px] shrink-0 place-items-center overflow-hidden border border-dashed border-ink">
          {src ? (
            <img src={src} alt={t('Foto {name}', { name: product.name })} className="size-full object-cover" />
          ) : (
            <span className="text-[12px] text-mute">{t('Belum ada')}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <Button variant="fire" sm busy={act.busy} onClick={save} {...lock.props}>
                {lock.label(t('Simpan foto'))}
              </Button>
              <Button sm disabled={act.busy} onClick={() => setDraft(null)}>
                {t('Batal')}
              </Button>
            </>
          ) : (
            <>
              <Button sm busy={compressing} onClick={() => input.current?.click()} {...lock.props}>
                {lock.label(saved ? t('Ganti foto') : t('Pilih foto'))}
              </Button>
              {saved && (
                <Button sm busy={act.busy} onClick={remove} {...lock.props}>
                  {lock.label(t('Hapus foto'))}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
      <p className="help">
        {draft ? t('Sudah diperkecil: {size} KB.', { size: decimal(draft.blob.size / 1024, lang) }) : t('JPG, PNG, atau WebP sampai 5 MB. Dipotong persegi.')}
      </p>
      <FormAlert>{act.error && t(act.error)}</FormAlert>
    </div>
  );
}
