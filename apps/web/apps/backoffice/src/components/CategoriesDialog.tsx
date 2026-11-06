import { useEffect, useState } from 'react';
import { Button, Dialog, Field, FormAlert, Input, useI18n } from '@hermes-pos/ui';
import { describeError } from '../lib/errors';
import type { ExpenseCategory } from '../lib/types';
import { useAction } from '../lib/useAction';
import { listExpenseCategories, saveExpenseCategory } from '../server/expenses';

/** The owner's expense categories: add, rename, and switch off (a switched-off one is not offered, its items keep their name). */
export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const act = useAction();
  const [list, setList] = useState<ExpenseCategory[] | null>(null);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<ExpenseCategory | null>(null);
  const reload = () => listExpenseCategories().then(setList, (err) => act.setError(describeError(err)));
  useEffect(() => {
    let live = true;
    listExpenseCategories().then((c) => live && setList(c), (err) => live && act.setError(describeError(err)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const target = editing;
    const res = await act.run(() => saveExpenseCategory({ data: { id: target?.id ?? null, name, active: target?.active ?? true } }), {
      success: target ? t('Kategori diubah.') : t('Kategori ditambahkan.'),
    });
    if (res) {
      setName('');
      setEditing(null);
      await reload();
    }
  }
  async function toggle(c: ExpenseCategory) {
    const res = await act.run(() => saveExpenseCategory({ data: { id: c.id, name: c.name, active: !c.active } }));
    if (res) await reload();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Kategori pengeluaran')}
      description={t('Yang dimatikan tidak bisa dipilih lagi.')}
    >
      <div className="grid gap-4">
        <form noValidate onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={editing ? t('Ubah nama kategori') : t('Kategori baru')}>
            <Input value={name} maxLength={40} placeholder={editing?.name ?? t('Contoh: listrik')} onChange={(ev) => setName(ev.target.value)} />
          </Field>
          <div className="flex gap-2">
            {editing && (
              <Button onClick={() => setEditing(null)} disabled={act.busy}>
                {t('Batal')}
              </Button>
            )}
            <Button type="submit" variant="fire" busy={act.busy} busyLabel={t('Menyimpan...')}>
              {editing ? t('Simpan') : t('Tambah')}
            </Button>
          </div>
        </form>
        {list === null ? null : list.length === 0 ? (
          <p className="text-mute">{t('Belum ada kategori.')}</p>
        ) : (
          <ul className="grid gap-2" aria-label={t('Kategori pengeluaran')}>
            {list.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-2">
                <span className={c.active ? 'font-semibold' : 'text-mute line-through'}>{c.name}</span>
                <span className="flex gap-2">
                  <Button sm onClick={() => { setEditing(c); setName(c.name); }} disabled={act.busy} aria-label={`${t('Ubah')} ${c.name}`}>
                    {t('Ubah')}
                  </Button>
                  <Button sm onClick={() => toggle(c)} disabled={act.busy}>
                    {c.active ? t('Matikan') : t('Aktifkan')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <FormAlert>{act.error && t(act.error)}</FormAlert>
      </div>
    </Dialog>
  );
}
