import { memo, useEffect, useRef, useState } from 'react';
import { Tap } from '../../components/Tap';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow, IconButton } from '../../components/Button';
import { Dashed, Stepper, Tag } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { TextField } from '../../components/Field';
import { TablePicker } from '../../components/TablePicker';
import { ActionFooter, Sheet, SheetBody, SheetHeader } from '../../components/Sheet';
import { useLayout } from '../../hooks/useLayout';
import { useAppStore } from '../../hooks/AppStore';
import { useBill } from '../../hooks/useBill';
import { useNotify } from '../../hooks/NotifyProvider';
import { isOnline } from '../../services/network/network';
import { billWaits } from '../../services/transaction/offlineQueue';
import { moveHeldBill } from '../../services/tables/tables';
import { useKeyboardOpen } from '../../hooks/useKeyboardOpen';
import { CartItem } from '../../types/domain';
import { discountLabel, lineDiscount, lineGross } from '../../utils/discount';
import { maxQty } from '../../utils/stock';
import { NOTE_MAX } from '../../utils/note';
import { VoucherSheet } from './sheets';
import { colors } from '../../theme';
import { money, t, useT } from '../../i18n';

export type BillHandlers = { onPay: () => void; onSplit: () => void; onOpenShift: () => void };
type FooterProps = BillHandlers & { onVoucher: () => void };
/** Told when a field of the bill gains or loses focus, so the panel hides its footer only for those, not for the menu search. */
type OnTyping = (on: boolean) => void;

/** Customer and table folded into one row (DESIGN I9a); opens two optional fields. */
function CustomerRow({ compact, onTyping }: { compact: boolean; onTyping?: OnTyping }) {
  const { customer, setCustomer, session, activeHeldBillId } = useAppStore();
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  /** A bill already held moves on the server (refused when occupied); a new bill just takes the table. */
  const pickTable = async (name: string) => {
    if (activeHeldBillId) {
      if (!isOnline()) return notify.toast('warning', t('Pindah meja perlu internet'), t('Bill ini tetap di meja lama sampai internet kembali.'));
      if (billWaits(activeHeldBillId)) return notify.toast('warning', t('Bill masih dikirim'), t('Tunggu sampai bill ini terkirim, lalu pindah meja.'));
      try {
        await moveHeldBill(activeHeldBillId, name);
      } catch (e) {
        return void notify.fail(t('Meja belum bisa dipindah'), e);
      }
    }
    setCustomer({ ...customer, table: name });
  };
  const summary = [customer.table ? t('Meja {n}', { n: customer.table }) : null, customer.name || null].filter(Boolean).join(' · ');
  if (open) {
    return (
      <View className="flex-row gap-2.5">
        <View className="w-[38%] min-w-0 gap-1">
          {compact ? null : <Text className="text-[13px] text-mute">{t('Meja')}</Text>}
          <TablePicker outletId={session?.outletId ?? ''} current={customer.table} onPick={pickTable} />
        </View>
        <TextField
          containerClassName="min-w-0 flex-1"
          label={compact ? undefined : t('Nama')}
          optional={!compact}
          placeholder={t('Nama (opsional)')}
          value={customer.name}
          onChangeText={(name) => setCustomer({ ...customer, name })}
          maxLength={40}
          onFocus={() => onTyping?.(true)}
          onBlur={() => {
            onTyping?.(false);
            if (!customer.table && !customer.name) setOpen(false);
          }}
        />
      </View>
    );
  }
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={summary || t('Tambah meja atau nama (opsional)')}
      onPress={() => setOpen(true)}
      className="h-[44px] flex-row items-center justify-between rounded-k px-3"
      style={({ pressed }) => ({ borderWidth: 1.5, borderColor: colors.ink, backgroundColor: pressed ? colors.tint : summary ? colors.tint : colors.slip })}
    >
      <Text numberOfLines={1} className={`min-w-0 flex-1 text-[15px] ${summary ? 'font-body-600' : 'text-mute'}`}>
        {summary || t('Tambah meja atau nama (opsional)')}
      </Text>
      <Icon name="chevron-down" size={18} />
    </Tap>
  );
}

/** Options for one line: the note (max 200). Promotions come from vouchers made in the backoffice. */
function LineOptions({ item, onTyping }: { item: CartItem; onTyping?: OnTyping }) {
  const { setItemNote } = useAppStore();
  const [note, setNote] = useState(item.note ?? '');
  useEffect(() => () => onTyping?.(false), [onTyping]); // closed or removed while focused: onBlur may never fire
  return (
    <View className="mt-2.5 gap-2.5 rounded-k border-k border-ink bg-paper p-3">
      <TextField
        label={t('Catatan')}
        placeholder={t('tanpa es, pedas sedang')}
        value={note}
        onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
        onFocus={() => onTyping?.(true)}
        onBlur={() => {
          onTyping?.(false);
          setItemNote(item.productId, note);
        }}
        onSubmitEditing={() => setItemNote(item.productId, note)}
        maxLength={NOTE_MAX}
        returnKeyType="done"
        help={t('Tercetak di struk, dapur, dan bar. Tidak mengubah harga.')}
      />
    </View>
  );
}

function BillLine({
  item,
  open,
  onToggle,
  minus,
  plus,
  remove,
  compact,
  onTyping,
}: {
  item: CartItem;
  open: boolean;
  onToggle: () => void;
  minus: () => void;
  plus: () => void;
  remove: () => void;
  compact: boolean;
  onTyping?: OnTyping;
}) {
  const cut = lineDiscount(item);
  const filled = !!item.note;
  return (
    <View className="py-3">
      <View className="flex-row items-start justify-between gap-3">
        <Text numberOfLines={2} className="min-w-0 flex-1 font-body-600 text-[15px]">
          {item.name}
        </Text>
        <Mono className="font-mono-600 text-[15px]">{money(lineGross(item) - cut)}</Mono>
      </View>
      <Mono className="mt-0.5 text-[14px] text-mute">
        {item.quantity} × {money(item.unitPrice)}
      </Mono>
      {item.note ? (
        <View className="mt-1.5 border-l-[3px] border-fire pl-2">
          <Text className="text-[14px]">{t('Catatan: {note}', { note: item.note })}</Text>
        </View>
      ) : null}
      {cut > 0 ? (
        <Mono className="mt-1 text-[14px] text-pine">
          {t('Diskon {label} · -{amount}', { label: discountLabel(item.discount, money), amount: money(cut) })}
        </Mono>
      ) : null}
      <View className="mt-2 flex-row items-center gap-2">
        <Stepper value={item.quantity} label={item.name} onMinus={minus} onPlus={plus} plusDisabled={item.quantity >= maxQty(item)} />
        <Tap
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t('Opsi {name}', { name: item.name })}
          onPress={onToggle}
          className="h-[44px] justify-center rounded-k px-3"
          style={({ pressed }) => ({
            borderWidth: 1.5,
            borderColor: colors.ink,
            backgroundColor: pressed ? colors.tint : filled || open ? colors.pineSoft : colors.slip,
          })}
        >
          <Text className="font-body-600 text-[14px]">{t('Opsi')}</Text>
        </Tap>
        <View className="flex-1" />
        {!compact ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel={t('Hapus {name}', { name: item.name })}
            onPress={remove}
            className="h-[44px] w-[44px] items-center justify-center"
          >
            <Icon name="trash" size={20} />
          </Tap>
        ) : null}
      </View>
      {open ? <LineOptions key={item.productId} item={item} onTyping={onTyping} /> : null}
      <Dashed className="mt-3" />
    </View>
  );
}

/** Lines and customer row; shared by the phone sheet and the tablet panel. */
function BillLines({ onOpenShift, onTyping }: { onOpenShift: () => void; onTyping?: OnTyping }) {
  const { cart } = useAppStore();
  const { phoneLandscape } = useLayout();
  const { minus, plus, removeLine } = useBill(onOpenShift);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <CustomerRow compact={phoneLandscape} onTyping={onTyping} />
      {cart.length === 0 ? (
        <Text className="mt-6 text-center text-[15px] text-mute">{t('Bill masih kosong. Ketuk menu untuk menambah.')}</Text>
      ) : (
        cart.map((item) => (
          <BillLine
            key={item.productId}
            item={item}
            compact={false}
            onTyping={onTyping}
            open={openId === item.productId}
            onToggle={() => setOpenId((id) => (id === item.productId ? null : item.productId))}
            minus={() => minus(item)}
            plus={() => plus(item)}
            remove={() => removeLine(item)}
          />
        ))
      )}
    </>
  );
}

/** Footer: voucher, split (only for a recalled held bill), totals, then Tahan and Bayar. */
function BillFooter({ onPay, onSplit, onOpenShift, onVoucher }: FooterProps) {
  useT();
  const { cart, voucher, activeHeldBillId } = useAppStore();
  const { phoneLandscape } = useLayout();
  const { totals, hold } = useBill(onOpenShift);
  const [holding, setHolding] = useState(false);
  const holdLock = useRef(false); // a double tap lands before `holding` re-renders; each hold has its own key
  const empty = cart.length === 0;
  const row = (label: string, value: string, tone?: 'pine' | 'error') => (
    <View className="flex-row justify-between">
      <Text className="text-[14px] text-mute">{label}</Text>
      <Mono className="text-[14px]" style={{ color: tone === 'pine' ? colors.pine : tone === 'error' ? colors.error : colors.ink }}>
        {value}
      </Mono>
    </View>
  );
  const voucherButtons = (
    <ButtonRow className={phoneLandscape ? 'flex-1' : ''}>
      <Button size="sm" label={voucher ? voucher.code : t('Voucher')} disabled={empty} onPress={onVoucher} />
      {activeHeldBillId ? <Button size="sm" label={t('Pisah bill')} disabled={cart.reduce((n, i) => n + i.quantity, 0) < 2} onPress={onSplit} /> : null}
    </ButtonRow>
  );
  return (
    <>
      {phoneLandscape ? (
        // Short screen: voucher and total share one row to leave room for the lines above. The Bayar button carries no amount.
        <View className="flex-row items-center gap-2.5">
          {voucherButtons}
          <View className="items-end">
            <Text className="font-body-700 text-[14px]">{t('Total')}</Text>
            <Display size={24} numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: activeHeldBillId ? 110 : 140 }}>
              {money(totals.total)}
            </Display>
          </View>
        </View>
      ) : null}
      {phoneLandscape && totals.voucherError ? <Text className="font-body-600 text-[14px] text-error">{totals.voucherError}</Text> : null}
      {phoneLandscape ? null : (
        <>
          {voucherButtons}
          <View className="gap-0.5">
            {totals.itemDiscount || totals.billDiscount || totals.voucherCut ? row(t('Subtotal'), money(totals.gross)) : null}
            {totals.itemDiscount ? row(t('Diskon item'), `-${money(totals.itemDiscount)}`, 'pine') : null}
            {totals.billDiscount ? row(t('Diskon bill'), `-${money(totals.billDiscount)}`, 'pine') : null}
            {totals.voucherCut ? row(t('Voucher {code}', { code: voucher?.code ?? '' }), `-${money(totals.voucherCut)}`, 'pine') : null}
            {totals.voucherError ? <Text className="font-body-600 text-[14px] text-error">{totals.voucherError}</Text> : null}
          </View>
          <View className="flex-row items-end justify-between">
            <Text className="font-body-700 text-[15px]">{t('Total')}</Text>
            <Display size={32}>{money(totals.total)}</Display>
          </View>
        </>
      )}
      <ButtonRow>
        <Button
          size={phoneLandscape ? 'md' : 'lg'}
          grow={1}
          label={activeHeldBillId ? t('Simpan') : t('Tahan')}
          loading={holding}
          disabled={empty}
          onPress={async () => {
            if (holdLock.current) return;
            holdLock.current = true;
            setHolding(true);
            try {
              await hold();
            } finally {
              holdLock.current = false;
              setHolding(false);
            }
          }}
        />
        <Button
          size={phoneLandscape ? 'md' : 'lg'}
          grow={1}
          variant="fire"
          label={t('Bayar')}
          accessibilityLabel={t('Bayar {amount}', { amount: money(totals.total) })}
          disabled={empty || !!totals.voucherError}
          onPress={onPay}
        />
      </ButtonRow>
    </>
  );
}

/** Phone: the bill as a 92% sheet. */
// Memoized like BillPanel: the Jual screen renders it again on every search keystroke; its own store reads still update it.
export const BillSheet = memo(function BillSheet({ visible, onClose, ...handlers }: BillHandlers & { visible: boolean; onClose: () => void }) {
  useT();
  const { cart, customer, activeHeldNumber } = useAppStore();
  const { clearAll } = useBill(handlers.onOpenShift);
  const keyboard = useKeyboardOpen();
  const [voucherOpen, setVoucherOpen] = useState(false);
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  return (
    <Sheet visible={visible} onClose={onClose} size="tall" label={t('Bill')}>
      <SheetHeader
        title={t('Bill')}
        subtitle={[t('{n} item', { n: count }), customer.table ? t('Meja {n}', { n: customer.table }) : null].filter(Boolean).join(' · ')}
        actions={
          <IconButton
            icon="trash"
            label={t('Kosongkan bill')}
            disabled={!cart.length}
            onPress={() => {
              clearAll();
              onClose();
            }}
          />
        }
        onClose={onClose}
      />
      <SheetBody>
        {activeHeldNumber ? <Tag className="mb-3" label={t('dipanggil · {n}', { n: activeHeldNumber })} tone="fire" /> : null}
        <BillLines onOpenShift={handlers.onOpenShift} />
      </SheetBody>
      {/* Hidden while typing (note, table, name) so the totals and buttons never cover the field. */}
      {keyboard ? null : (
        <ActionFooter>
          <BillFooter {...handlers} onVoucher={() => setVoucherOpen(true)} />
        </ActionFooter>
      )}
      <VoucherSheet visible={voucherOpen} onClose={() => setVoucherOpen(false)} />
    </Sheet>
  );
});

/** Tablet and phone landscape: the bill fixed on the right (404px, 340px). */
/** Memoized: re-renders from the store (cart, customer) and when its handlers change, not on every Jual render. */
export const BillPanel = memo(function BillPanel(handlers: BillHandlers) {
  useT();
  const insets = useSafeAreaInsets();
  const { panelWidth, phoneLandscape } = useLayout();
  const { cart, customer, activeHeldNumber, session, shift } = useAppStore();
  const { clearAll } = useBill(handlers.onOpenShift);
  const keyboard = useKeyboardOpen();
  const [typing, setTyping] = useState(false);
  const [voucherOpen, setVoucherOpen] = useState(false);
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  return (
    <View className="border-l-k border-ink bg-slip" style={{ width: panelWidth + insets.right, paddingRight: insets.right }}>
      <View
        className={`flex-row items-start gap-2 border-b-k border-ink px-4 ${phoneLandscape ? 'pb-1.5' : 'pb-3'}`}
        style={{ paddingTop: insets.top + (phoneLandscape ? 6 : 10) }}
      >
        <View className="min-w-0 flex-1">
          <Display size={phoneLandscape ? 22 : 30} accessibilityRole="header">
            {t('Bill')}
          </Display>
          <Mono numberOfLines={1} className="mt-0.5 text-[14px] text-mute">
            {[
              t('{n} item', { n: count }),
              customer.table ? t('Meja {n}', { n: customer.table }) : null,
              // The Jual header is gone in phone landscape, so who is on shift shows here.
              phoneLandscape ? session?.cashierName : null,
              phoneLandscape && shift ? t('Shift {n}', { n: shift.shiftNumber }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Mono>
        </View>
        <IconButton icon="trash" label={t('Kosongkan bill')} disabled={!cart.length} onPress={clearAll} />
      </View>
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="px-4 py-3">
        {activeHeldNumber ? <Tag className="mb-3" label={t('dipanggil · {n}', { n: activeHeldNumber })} tone="fire" /> : null}
        <BillLines onOpenShift={handlers.onOpenShift} onTyping={setTyping} />
      </ScrollView>
      {/* Hidden only while a bill field is typed in; the menu search keeps totals and Bayar in view. */}
      {keyboard && typing ? null : (
        <View
          className={`border-t-k border-ink px-4 ${phoneLandscape ? 'gap-2 pt-2' : 'gap-3 pt-3'}`}
          style={{ paddingBottom: Math.max(insets.bottom, phoneLandscape ? 8 : 12) + 4 }}
        >
          <BillFooter {...handlers} onVoucher={() => setVoucherOpen(true)} />
        </View>
      )}
      <VoucherSheet visible={voucherOpen} onClose={() => setVoucherOpen(false)} />
    </View>
  );
});
