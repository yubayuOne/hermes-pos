import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { applyQueuedStock } from '../services/transaction/offlineQueue';
import { isSoldOut, isTracked, maxQty } from '../utils/stock';
import { AppSession, CartItem, Category, CustomerInfo, Discount, Product, Shift, Voucher } from '../types/domain';
import { cleanNote } from '../utils/note';

export interface SplitBillPart {
  id: string;
  items: CartItem[];
  status: 'unpaid' | 'paid';
  transactionId?: string;
  transactionNumber?: string;
}

export interface SplitBillDraft {
  parentTransactionId: string | null;
  customer: CustomerInfo;
  sourceItems: CartItem[];
  parts: SplitBillPart[];
}

interface State {
  session: AppSession | null;
  products: Product[];
  categories: Category[];
  shift: Shift | null;
  cart: CartItem[];
  customer: CustomerInfo;
  /** Discount on the whole bill (active cart). Per-item discounts live in CartItem.discount. */
  billDiscount: Discount | null;
  search: string;
  categoryId: string | null;
  splitBill: SplitBillDraft | null;
  activeHeldBillId: string | null;
  paymentIntent: { key: string; fingerprint: string } | null;
  /** Voucher previewed on the current bill (one per bill). Cleared with the bill. */
  voucher: Voucher | null;
  setVoucher: (v: Voucher | null) => void;
  /** Held bills in the open shift, for the badge on the Bill tab. */
  heldCount: number;
  setHeldCount: (n: number) => void;
  /** Bumped after hold, pay, or delete so the held count is fetched again. */
  heldTick: number;
  bumpHeld: () => void;
  /** Number of the recalled held bill, shown as "dipanggil · #HPOS-...". */
  activeHeldNumber: string | null;
  setActiveHeldNumber: (n: string | null) => void;
  /** Put a removed line back (Batalkan on the toast). */
  restoreItem: (item: CartItem, index: number) => void;
  setSession: (v: AppSession | null) => void;
  setCatalog: (p: Product[], c: Category[]) => void;
  /** Reduce local stock (sales that went into the offline queue). */
  adjustStock: (items: Array<{ productId: string; quantity: number }>) => void;
  setShift: (v: Shift | null) => void;
  setCustomer: (v: CustomerInfo) => void;
  setSearch: (v: string) => void;
  setCategoryId: (v: string | null) => void;
  addProduct: (p: Product, qty?: number) => void;
  changeQty: (id: string, delta: number) => void;
  removeItem: (id: string) => void;
  setItemDiscount: (productId: string, discount: Discount | null) => void;
  setBillDiscount: (discount: Discount | null) => void;
  /** Drop manual bill and item discounts (only old held bills have them); used when a voucher is applied. */
  clearManualDiscounts: () => void;
  setItemNote: (productId: string, note: string | null) => void;
  clearCart: () => void;
  replaceCart: (items: CartItem[], customer: CustomerInfo, billDiscount?: Discount | null) => void;
  startSplitBill: (customer: CustomerInfo) => void;
  setSplitParentTransaction: (id: string) => void;
  updateSplitParts: (parts: SplitBillPart[]) => void;
  markSplitPartPaid: (partId: string, transactionId: string, transactionNumber: string) => void;
  clearSplitBill: () => void;
  setActiveHeldBillId: (id: string | null) => void;
  beginPaymentIntent: (fingerprint: string) => string;
  clearPaymentIntent: () => void;
  /** Clear all session state (used on logout so the previous cashier's data does not carry over). */
  resetAll: () => void;
}

const Ctx = createContext<State | null>(null);

// Narrow contexts keep app bootstrap and shell navigation from subscribing to every cart edit.
interface RootState {
  session: AppSession | null;
}
interface RootActions {
  setSession: React.Dispatch<React.SetStateAction<AppSession | null>>;
  setShift: React.Dispatch<React.SetStateAction<Shift | null>>;
  resetAll: () => void;
}
interface ShellState {
  session: AppSession | null;
  shift: Shift | null;
  hasCart: boolean;
  activeHeldBillId: string | null;
  activeHeldNumber: string | null;
  heldTick: number;
  heldCount: number;
  setHeldCount: React.Dispatch<React.SetStateAction<number>>;
  setActiveHeldBillId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveHeldNumber: React.Dispatch<React.SetStateAction<string | null>>;
  clearCart: () => void;
  clearSplitBill: () => void;
  resetAll: () => void;
  bumpHeld: () => void;
}
const RootStateCtx = createContext<RootState | null>(null);
const RootActionsCtx = createContext<RootActions | null>(null);
const ShellCtx = createContext<ShellState | null>(null);

function sameProducts(a: Product[], b: Product[]) {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.id === y.id &&
        x.categoryId === y.categoryId &&
        x.name === y.name &&
        x.hpp === y.hpp &&
        x.price === y.price &&
        x.stock === y.stock &&
        x.trackStock === y.trackStock &&
        x.imageUrl === y.imageUrl &&
        x.station === y.station
      );
    })
  );
}
function sameCategories(a: Category[], b: Category[]) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.name === b[i].name);
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [shift, setShift] = useState<Shift | null>(null),
    [cart, setCart] = useState<CartItem[]>([]),
    [customer, setCustomer] = useState<CustomerInfo>({ name: '', phone: '', table: '' }),
    [search, setSearch] = useState(''),
    [categoryId, setCategoryId] = useState<string | null>(null),
    [splitBill, setSplitBill] = useState<SplitBillDraft | null>(null),
    [activeHeldBillId, setActiveHeldBillId] = useState<string | null>(null),
    [billDiscount, setBillDiscount] = useState<Discount | null>(null),
    [paymentIntent, setPaymentIntent] = useState<{ key: string; fingerprint: string } | null>(null),
    [voucher, setVoucher] = useState<Voucher | null>(null),
    [heldCount, setHeldCount] = useState(0),
    [heldTick, setHeldTick] = useState(0),
    [activeHeldNumber, setActiveHeldNumber] = useState<string | null>(null);
  const bumpHeld = useCallback(() => setHeldTick((n) => n + 1), []);
  const restoreItem = useCallback(
    (item: CartItem, index: number) =>
      setCart((x) => {
        if (x.some((i) => i.productId === item.productId)) return x;
        const next = [...x];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      }),
    [],
  );

  const addProduct = useCallback(
    (p: Product, qty = 1) =>
      setCart((x) => {
        const old = x.find((i) => i.productId === p.id);
        if (old) return x.map((i) => (i.productId === p.id ? { ...i, quantity: Math.min(i.quantity + qty, maxQty(p)) } : i));
        return !isSoldOut(p)
          ? [
              ...x,
              {
                productId: p.id,
                name: p.name,
                unitPrice: p.price,
                hpp: p.hpp,
                quantity: Math.min(qty, maxQty(p)),
                stock: p.stock,
                trackStock: isTracked(p),
                station: p.station,
              },
            ]
          : x;
      }),
    [],
  );
  const changeQty = useCallback(
    (id: string, delta: number) =>
      setCart((x) =>
        x
          .map((i) => {
            if (i.productId !== id) return i;
            const quantity = Math.max(0, Math.min(i.quantity + delta, maxQty(i)));
            // An amount discount must not exceed the shrinking line price.
            const gross = i.unitPrice * quantity;
            const discount = i.discount && i.discount.type === 'amount' && i.discount.value > gross ? { ...i.discount, value: gross } : i.discount;
            return { ...i, quantity, discount: discount && discount.value > 0 ? discount : null };
          })
          .filter((i) => i.quantity > 0),
      ),
    [],
  );
  const setItemDiscount = useCallback(
    (id: string, discount: Discount | null) => setCart((x) => x.map((i) => (i.productId === id ? { ...i, discount } : i))),
    [],
  );
  const setItemNote = useCallback(
    (id: string, note: string | null) => setCart((x) => x.map((i) => (i.productId === id ? { ...i, note: cleanNote(note) || null } : i))),
    [],
  );
  const removeItem = useCallback((id: string) => setCart((x) => x.filter((i) => i.productId !== id)), []);
  const adjustStock = useCallback((used: Array<{ productId: string; quantity: number }>) => {
    const byId = new Map<string, number>();
    used.forEach((u) => byId.set(u.productId, (byId.get(u.productId) ?? 0) + u.quantity));
    setProducts((list) => list.map((p) => (byId.has(p.id) && isTracked(p) ? { ...p, stock: Math.max(0, p.stock - (byId.get(p.id) ?? 0)) } : p)));
  }, []);
  const clearPaymentIntent = useCallback(() => setPaymentIntent(null), []);
  const clearSplitBill = useCallback(() => setSplitBill(null), []);
  const setCatalog = useCallback((p: Product[], c: Category[]) => {
    // Preserve references when the server returns the same catalogue. This avoids invalidating
    // the global store context every minute when no menu, price, or stock has changed.
    const nextProducts = applyQueuedStock(p);
    setProducts((current) => (sameProducts(current, nextProducts) ? current : nextProducts));
    setCategories((current) => (sameCategories(current, c) ? current : c));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setBillDiscount(null);
    setCustomer({ name: '', phone: '', table: '' });
    setPaymentIntent(null);
    setVoucher(null);
  }, []);

  const beginPaymentIntent = (fingerprint: string) => {
    if (paymentIntent?.fingerprint === fingerprint) return paymentIntent.key;

    const key = `${session?.cashierId ?? 'cashier'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    setPaymentIntent({ key, fingerprint });
    return key;
  };

  const startSplitBill = (info: CustomerInfo) => {
    setSplitBill({ parentTransactionId: null, customer: info, sourceItems: cart.map((i) => ({ ...i })), parts: [] });
  };

  const resetAll = useCallback(() => {
    setSession(null);
    setProducts([]);
    setCategories([]);
    setShift(null);
    setCart([]);
    setBillDiscount(null);
    setCustomer({ name: '', phone: '', table: '' });
    setSearch('');
    setCategoryId(null);
    setSplitBill(null);
    setActiveHeldBillId(null);
    setPaymentIntent(null);
    setVoucher(null);
    setHeldCount(0);
    setActiveHeldNumber(null);
  }, []);

  const rootStateValue = useMemo(() => ({ session }), [session]);
  const rootActionsValue = useMemo(() => ({ setSession, setShift, resetAll }), [setSession, setShift, resetAll]);
  const hasCart = cart.length > 0;
  const shellValue = useMemo<ShellState>(
    () => ({
      session,
      shift,
      hasCart,
      activeHeldBillId,
      activeHeldNumber,
      heldTick,
      heldCount,
      setHeldCount,
      setActiveHeldBillId,
      setActiveHeldNumber,
      clearCart,
      clearSplitBill,
      resetAll,
      bumpHeld,
    }),
    [session, shift, hasCart, activeHeldBillId, activeHeldNumber, heldTick, heldCount, clearCart, clearSplitBill, resetAll, bumpHeld],
  );

  const value = useMemo(
    () => ({
      session,
      products,
      categories,
      shift,
      cart,
      customer,
      billDiscount,
      search,
      categoryId,
      splitBill,
      activeHeldBillId,
      paymentIntent,
      voucher,
      setVoucher,
      heldCount,
      setHeldCount,
      heldTick,
      bumpHeld,
      activeHeldNumber,
      setActiveHeldNumber,
      restoreItem,
      setSession,
      adjustStock,
      setCatalog,

      setShift,
      setCustomer,
      setSearch,
      setCategoryId,
      addProduct,
      changeQty,
      removeItem,
      setItemDiscount,
      setItemNote,
      setBillDiscount,
      clearManualDiscounts: () => {
        setBillDiscount(null);
        setCart((x) => (x.some((i) => i.discount) ? x.map((i) => (i.discount ? { ...i, discount: null } : i)) : x));
      },
      clearCart,

      replaceCart: (items: CartItem[], info: CustomerInfo, bill?: Discount | null) => {
        setCart(items);
        setCustomer(info);
        setBillDiscount(bill && bill.value > 0 ? bill : null);
        setVoucher(null);
      },
      startSplitBill,
      setSplitParentTransaction: (id: string) => setSplitBill((x) => (x ? { ...x, parentTransactionId: id } : x)),

      updateSplitParts: (parts: SplitBillPart[]) => setSplitBill((x) => (x ? { ...x, parts } : x)),

      markSplitPartPaid: (partId: string, transactionId: string, transactionNumber: string) =>
        setSplitBill((x) =>
          x
            ? {
                ...x,
                parts: x.parts.map((part) =>
                  part.id === partId
                    ? {
                        ...part,
                        status: 'paid',
                        transactionId,
                        transactionNumber,
                      }
                    : part,
                ),
              }
            : x,
        ),
      clearSplitBill,
      setActiveHeldBillId,
      beginPaymentIntent,
      clearPaymentIntent,
      resetAll,
    }),
    [
      session,
      products,
      categories,
      shift,
      cart,
      customer,
      billDiscount,
      search,
      categoryId,
      splitBill,
      activeHeldBillId,
      paymentIntent,
      voucher,
      heldCount,
      heldTick,
      activeHeldNumber,
      addProduct,
      changeQty,
      removeItem,
      setItemDiscount,
      setItemNote,
      clearCart,
      clearPaymentIntent,
      setCatalog,
      clearSplitBill,
      resetAll,
    ],
  );

  return (
    <RootStateCtx.Provider value={rootStateValue}>
      <RootActionsCtx.Provider value={rootActionsValue}>
        <ShellCtx.Provider value={shellValue}>
          <Ctx.Provider value={value}>{children}</Ctx.Provider>
        </ShellCtx.Provider>
      </RootActionsCtx.Provider>
    </RootStateCtx.Provider>
  );
}

export const useAppStore = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppStore must be used inside AppStoreProvider');
  return v;
};

export const useRootState = () => {
  const value = useContext(RootStateCtx);
  if (!value) throw new Error('useRootState must be used inside AppStoreProvider');
  return value;
};
export const useRootActions = () => {
  const value = useContext(RootActionsCtx);
  if (!value) throw new Error('useRootActions must be used inside AppStoreProvider');
  return value;
};
export const useShellStore = () => {
  const value = useContext(ShellCtx);
  if (!value) throw new Error('useShellStore must be used inside AppStoreProvider');
  return value;
};
