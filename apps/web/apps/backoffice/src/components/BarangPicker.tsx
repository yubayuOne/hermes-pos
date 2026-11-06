import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Input, useI18n } from '@hermes-pos/ui';
import type { Ingredient } from '../lib/types';

/** A barang's id, LAIN for "Barang lain", or '' for none picked. */
export const LAIN = '__lain';

/**
 * Picks a barang by typing: the list filters as you type, so a long list stays usable (a plain dropdown does not).
 * The list opens under the field in the page's flow (never clipped by the dialog), arrows move, Enter picks, Esc closes.
 */
export function BarangPicker({
  items,
  value,
  onChange,
  allowFree = false,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  id,
  autoFocus,
}: {
  items: Ingredient[];
  value: string;
  onChange: (value: string) => void;
  /** Adds "Barang lain" as the last choice: a name, category, and unit typed on the row. */
  allowFree?: boolean;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const autoId = useId();
  const listId = `${id ?? autoId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const chosen = value === LAIN ? null : items.find((i) => i.id === value);
  const label = value === LAIN ? t('Barang lain') : (chosen?.name ?? '');
  const needle = query.trim().toLowerCase();
  const options = useMemo(() => {
    const matched = items.filter((i) => !needle || i.name.toLowerCase().includes(needle));
    const list: { value: string; name: string; meta: string }[] = matched.map((i) => ({
      value: i.id,
      name: i.name,
      meta: [i.kategori, i.baseUnit].filter(Boolean).join(' · '),
    }));
    if (allowFree && (!needle || t('Barang lain').toLowerCase().includes(needle))) list.push({ value: LAIN, name: t('Barang lain'), meta: '' });
    return list;
  }, [items, needle, allowFree, t]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (options.length ? (a + step + options.length) % options.length : 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      pick(options[active].value);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="grid gap-1">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={t('Cari barang')}
        value={open ? query : label}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={t('Barang')} className="max-h-64 overflow-y-auto rounded border border-rule bg-paper p-1">
          {options.length === 0 && <li className="px-3 py-2 text-mute">{t('Tidak ada yang cocok.')}</li>}
          {options.map((o, n) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 rounded px-3 py-2 ${n === active ? 'bg-tint' : ''} ${o.value === value ? 'font-semibold' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(n)}
              onClick={() => pick(o.value)}
            >
              <span>{o.name}</span>
              {o.meta && <span className="text-small text-mute">{o.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
