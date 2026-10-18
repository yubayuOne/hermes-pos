import { useCallback } from 'react';
import { useAppStore } from './AppStore';
import { useNotify } from './NotifyProvider';
import { saveHeldBill, updateHeldBill } from '../services/transaction/heldBills';
import { billWaits, enqueueCheckout, queueFirst, waitsForQueue } from '../services/transaction/offlineQueue';
import { nextBill } from '../services/local/billNumber';
import { isOnline } from '../services/network/network';
import { isUnknownCheckoutOutcome } from '../utils/errors';
import { billTotals } from '../utils/voucher';
import { CartItem } from '../types/domain';
import { haptic } from '../utils/haptics';
import { t } from '../i18n';

/** Bill actions shared by the phone sheet and the tablet panel: hold or save, remove with undo, clear with undo. */
export function useBill(onOpenShift: () => void) {
  const notify = useNotify();
  const s = useAppStore();
  const { session, shift, cart, customer, billDiscount, voucher, activeHeldBillId } = s;
  const totals = billTotals(cart, billDiscount, voucher);

  const explainNoShift = useCallback(async () => {
    const choice = await notify.dialog({
      tone: 'warning',
      title: t('Shift belum dibuka.'),
      message: t('Buka shift dengan kas awal dulu, lalu lanjut jualan.'),
      actions: [
        { key: 'later', label: t('Nanti'), variant: 'secondary' },
        { key: 'open', label: t('Buka shift'), variant: 'primary' },
      ],
    });
    if (choice === 'open') onOpenShift();
  }, [notify, onOpenShift]);

  /** Tahan (new bill) or Simpan (recalled held bill). Offline holds go to the queue (PRD E2). */
  const hold = useCallback(async (): Promise<boolean> => {
    if (!cart.length || !session) return false;
    if (!shift) {
      await explainNoShift();
      return false;
    }
    const ids = cart.map((i) => i.productId);
    if (activeHeldBillId) {
      try {
        // Queued for this bill (its offline hold, earlier changes): the change goes behind them, not straight out.
        if (waitsForQueue(shift.id, ids) || billWaits(activeHeldBillId)) throw queueFirst();
        await updateHeldBill({ transactionId: activeHeldBillId, items: cart, customer, billDiscount });
        s.clearCart();
        s.setActiveHeldBillId(null);
        s.setActiveHeldNumber(null);
        s.bumpHeld();
        notify.success(t('Bill disimpan'), t('Perubahan tersimpan di bill yang sama.'));
        return true;
      } catch (e) {
        if (!isUnknownCheckoutOutcome(e)) {
          void notify.fail(t('Bill belum tersimpan'), e);
          return false;
        }
        // Offline: the change waits in the queue (sent before a later payment of the same bill); a recall reads it from there.
        try {
          await enqueueCheckout({
            idempotencyKey: `update:${activeHeldBillId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            kind: 'update',
            existingTransactionId: activeHeldBillId,
            shiftId: shift.id,
            cashierId: session.cashierId,
            outletId: session.outletId,
            items: cart,
            customer,
            billDiscount,
            payment: { method: 'cash', amountReceived: 0 },
            total: billTotals(cart, billDiscount, null).total,
          });
        } catch (err) {
          void notify.fail(t('Bill belum tersimpan'), err, t('Bill tidak bisa disimpan di perangkat. Bill tetap di layar.'));
          return false;
        }
        s.clearCart();
        s.setActiveHeldBillId(null);
        s.setActiveHeldNumber(null);
        notify.toast('warning', t('Perubahan disimpan di perangkat'), t('Tidak ada internet. Perubahan dikirim otomatis saat internet kembali.'));
        return true;
      }
    }
    const idempotencyKey = `hold:${session.cashierId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    // This phone's id and final number (054): a bill held offline can be recalled, split and paid before it is sent.
    const own = await nextBill(session.outletId).catch(() => null);
    const args = {
      shiftId: shift.id,
      cashierId: session.cashierId,
      outletId: session.outletId,
      items: cart,
      customer,
      billDiscount,
      idempotencyKey,
      transactionId: own?.transactionId ?? null,
      number: own?.number ?? null,
    };
    const droppedVoucher = !!voucher;
    const waits = waitsForQueue(shift.id, ids);
    // Whether the request leaves the phone: if it does and gets no answer, the server may have the bill (maybeSent).
    const tried = !waits && isOnline();
    try {
      if (waits) throw queueFirst();
      await saveHeldBill(args);
      s.clearCart();
      s.bumpHeld();
      notify.success(t('Bill ditahan'), droppedVoucher ? t('Voucher dilepas. Pasang lagi saat bill dibayar.') : t('Panggil lagi dari tab Bill.'));
      return true;
    } catch (error) {
      if (!isUnknownCheckoutOutcome(error)) {
        void notify.fail(t('Bill belum ditahan'), error);
        return false;
      }
      try {
        // A held bill is saved without its voucher, so its queued total leaves the voucher out too.
        await enqueueCheckout({
          ...args,
          kind: 'hold',
          maybeSent: tried,
          payment: { method: 'cash', amountReceived: 0 },
          total: billTotals(cart, billDiscount, null).total,
        });
      } catch (e) {
        void notify.fail(t('Bill belum ditahan'), e, t('Bill tidak bisa disimpan di perangkat. Bill tetap di layar.'));
        return false;
      }
      s.clearCart();
      notify.toast('warning', t('Bill ditahan di perangkat'), t('Tidak ada internet. Bill dikirim otomatis saat internet kembali.'));
      return true;
    }
  }, [cart, session, shift, activeHeldBillId, customer, billDiscount, voucher, s, notify, explainNoShift]);

  const removeLine = useCallback(
    (item: CartItem) => {
      const index = cart.findIndex((i) => i.productId === item.productId);
      s.removeItem(item.productId);
      haptic.select();
      notify.success(t('{name} dihapus dari bill', { name: item.name }), undefined, { label: t('Batalkan'), onPress: () => s.restoreItem(item, index) });
    },
    [cart, s, notify],
  );

  const minus = useCallback(
    (item: CartItem) => {
      if (item.quantity <= 1) {
        removeLine(item);
        return;
      }
      s.changeQty(item.productId, -1);
      haptic.select();
    },
    [removeLine, s],
  );

  const plus = useCallback(
    (item: CartItem) => {
      s.changeQty(item.productId, 1);
      haptic.select();
    },
    [s],
  );

  const clearAll = useCallback(() => {
    const snap = { cart, customer, billDiscount, voucher, heldId: activeHeldBillId, heldNo: s.activeHeldNumber };
    s.clearCart();
    s.setActiveHeldBillId(null);
    s.setActiveHeldNumber(null);
    notify.success(t('Bill dikosongkan'), undefined, {
      label: t('Batalkan'),
      onPress: () => {
        s.replaceCart(snap.cart, snap.customer, snap.billDiscount);
        if (snap.voucher) s.setVoucher(snap.voucher);
        if (snap.heldId) {
          s.setActiveHeldBillId(snap.heldId);
          s.setActiveHeldNumber(snap.heldNo);
        }
      },
    });
  }, [cart, customer, billDiscount, voucher, activeHeldBillId, s, notify]);

  return { totals, hold, minus, plus, removeLine, clearAll, explainNoShift };
}
