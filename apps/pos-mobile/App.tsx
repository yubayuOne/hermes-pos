import './global.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// One import per weight, so only these eight font files end up in the app.
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { InstrumentSans_700Bold } from '@expo-google-fonts/instrument-sans/700Bold';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono/600SemiBold';
import { AppStoreProvider, useRootActions, useRootState, useShellStore } from './src/hooks/AppStore';
import { NotifyProvider, useNotify } from './src/hooks/NotifyProvider';
import { LangProvider, t } from './src/i18n';
import { BottomNav, Rail, Tab } from './src/components/chrome';
import { BellSheet, QueueSheet } from './src/components/overlays';
import { useLayout } from './src/hooks/useLayout';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { CashierPickerScreen } from './src/screens/auth/CashierPickerScreen';
import { SellScreen } from './src/screens/sell/SellScreen';
import { PaymentScreen } from './src/screens/pay/PaymentScreen';
import { BillsScreen } from './src/screens/bills/BillsScreen';
import { SplitBillScreen } from './src/screens/bills/SplitBillScreen';
import { ShiftScreen } from './src/screens/shift/ShiftScreen';
import { ShiftHistoryScreen } from './src/screens/shift/ShiftHistoryScreen';
import { MoreScreen } from './src/screens/more/MoreScreen';
import { PrinterScreen } from './src/screens/more/PrinterScreen';
import { cashierStillActive, clearActiveCashier, getAccountEmail, loadSession, signOut } from './src/services/supabase/session';
import { cachedOpenShift } from './src/services/transaction/repository';
import { readShift, syncShift } from './src/services/local/shiftData';
import { clearOldCaches } from './src/services/cache/cache';
import { markParentClosed, remainingForSplit, resolveOpenShift } from './src/services/transaction/offlineQueue';
import { invalidateCatalogFreshness } from './src/services/catalog/freshness';
import { useCheckoutQueue, useCheckoutQueueSync } from './src/services/transaction/useCheckoutQueue';
import { clearSubscription, loadCachedSubscription, refreshSubscription } from './src/services/subscription/subscription';
import { clearReceiptSettings, refreshReceiptSettings } from './src/services/printer/settings';
import { loadLogoRaster } from './src/services/printer/logo';
import { confirmSignOut } from './src/utils/logout';
import { AppSession, CartItem, CustomerInfo } from './src/types/domain';
import { isOnline } from './src/services/network/network';
import { canResumeOffline } from './src/utils/resume';
import { HermesSplash } from './src/components/HermesSplash';

type SplitState = { parentId: string; number: string | null; part: number };
type SplitPay = { items: CartItem[]; customer: CustomerInfo; meta: string };

/** Signed in with a cashier: four tabs (Jual, Bill, Shift, Lainnya), rail on wide screens (DESIGN I3). */
function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const notify = useNotify();
  const { wide } = useLayout();
  const store = useShellStore();
  const {
    session,
    shift,
    hasCart,
    activeHeldBillId,
    activeHeldNumber,
    heldTick,
    setHeldCount,
    setActiveHeldBillId,
    setActiveHeldNumber,
    clearCart,
    clearSplitBill,
    resetAll,
  } = store;
  const { setShift } = useRootActions();
  const [tab, setTab] = useState<Tab>('sell');
  const [printer, setPrinter] = useState(false);
  const [history, setHistory] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [split, setSplit] = useState<SplitState | null>(null);
  const [splitPay, setSplitPay] = useState<SplitPay | null>(null);
  const [openBill, setOpenBill] = useState(0);

  useCheckoutQueueSync(session ? { outletId: session.outletId } : null);

  // Subscription status: on sign-in, when the app comes back, and every 5 minutes (PRD G1).
  useEffect(() => {
    const run = () => {
      void refreshSubscription().catch(() => undefined);
    };
    run();
    void refreshReceiptSettings().catch(() => undefined);
    void clearOldCaches().catch(() => undefined); // copies left by app versions before the local database had their data
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const timer = setInterval(run, 5 * 60 * 1000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  // Download the printed logo now, so receipts printed offline still have it.
  useEffect(() => {
    void loadLogoRaster(session?.outletLogoPrintUrl);
  }, [session?.outletLogoPrintUrl]);

  // Held bills badge on the Bill tab: the server's count in the local copy of the shift (055), refreshed when a queued hold is
  // sent, on every hold or payment, and when the app comes back. Only the newest answer counts, so a slow old one never
  // overwrites it. Offline the last synced count stays.
  const queue = useCheckoutQueue();
  const queuedHolds = queue.filter((e) => e.shiftId === shift?.id && (e.kind === 'hold' || !!e.existingTransactionId || !!e.parentTransactionId)).length;
  // An opening or close made offline reached the server: load the shift again for its real number and state.
  const queuedShiftOps = queue.filter((e) => e.cashierId === session?.cashierId && (e.kind === 'open_shift' || e.kind === 'close_shift')).length;
  const prevShiftOps = useRef(queuedShiftOps);
  useEffect(() => {
    const sent = queuedShiftOps < prevShiftOps.current;
    prevShiftOps.current = queuedShiftOps;
    if (sent && session) resolveOpenShift(session.cashierId).then(setShift, () => undefined);
  }, [queuedShiftOps]); // eslint-disable-line react-hooks/exhaustive-deps
  const heldReq = useRef(0);
  useEffect(() => {
    if (!shift) {
      setHeldCount(0);
      return;
    }
    const shiftId = shift.id;
    const run = () => {
      const id = ++heldReq.current;
      if (!session) return;
      void syncShift(shiftId, session.outletId)
        .catch(() => undefined)
        .then(() => readShift(shiftId))
        .then((d) => {
          if (d && id === heldReq.current) setHeldCount(d.bills.filter((b) => b.status === 'held').length);
        })
        .catch(() => undefined);
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [shift?.id, heldTick, queuedHolds]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((next: Tab) => {
    setPrinter(false);
    setHistory(false);
    setTab(next);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (payOpen) {
        setPayOpen(false);
        return true;
      }
      if (splitPay) {
        setSplitPay(null);
        return true;
      }
      if (split) {
        setSplit(null);
        return true;
      }
      if (printer) {
        setPrinter(false);
        return true;
      }
      if (history) {
        setHistory(false);
        return true;
      }
      if (tab !== 'sell') {
        setTab('sell');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [payOpen, splitPay, split, printer, history, tab]);

  const switchCashier = async () => {
    // The next cashier's PIN is checked by the server (owner's choice, 18 Oct 2026).
    if (!isOnline()) {
      void notify.warning(t('Ganti kasir butuh internet'), t('PIN kasir berikutnya diperiksa server. Sambungkan internet dulu.'));
      return;
    }
    if (hasCart) {
      const ok = await notify.confirm({
        title: t('Ganti kasir dengan bill berisi?'),
        message: t('Bill yang sedang dibuat akan dikosongkan.'),
        hint: t('Tahan bill dulu kalau pesanan ini masih dilanjutkan.'),
        confirmLabel: t('Ganti kasir'),
        destructive: true,
      });
      if (!ok) return;
    }
    await clearActiveCashier();
    invalidateCatalogFreshness();
    resetAll();
  };

  const signOutAll = async () => {
    if (!(await confirmSignOut(notify))) return;
    await signOut();
    await clearSubscription();
    await clearReceiptSettings();
    resetAll();
    onSignedOut();
  };

  const startSplit = () => {
    if (!activeHeldBillId) return;
    setSplit({ parentId: activeHeldBillId, number: activeHeldNumber, part: 1 });
  };

  const afterSplitPart = async () => {
    const s = split;
    // Close the payment only with the split state change: closing it first remounts the split sheet on a bill
    // that may be fully paid, and opening that fails.
    if (!s) return setSplitPay(null);
    try {
      // Offline: the device count minus the queued parts (remainingForSplit).
      const left = shift ? await remainingForSplit(shift.id, s.parentId) : null;
      if (!left) throw new Error('no count');
      if (left.length === 0) {
        await markParentClosed(s.parentId); // queued last part: the held bill counts as paid until it is sent
        setSplitPay(null);
        setSplit(null);
        clearCart();
        clearSplitBill();
        setActiveHeldBillId(null);
        setActiveHeldNumber(null);
        store.bumpHeld();
        notify.success(s.number ? t('Bill {n} lunas', { n: s.number }) : t('Bill lunas'), t('{n} bagian sudah dibayar. Bill ini ditutup.', { n: s.part }));
        return;
      }
    } catch {
      notify.toast('warning', t('Sisa bill belum bisa dicek'), t('Pisah bill tetap terbuka. Lanjutkan bagian yang belum dibayar.'));
    }
    setSplitPay(null);
    setSplit({ ...s, part: s.part + 1 });
  };

  const common = { onQueue: () => setQueueOpen(true), onBell: () => setBellOpen(true) };
  // Jual stays mounted: going back to it from another tab shows the grid at once, with search, category and
  // scroll position kept. The other tabs mount when opened and show their last data while they refresh.
  const onSell = tab === 'sell' && !printer && !history;
  const sell = (
    <View style={{ flex: 1, display: onSell ? 'flex' : 'none' }}>
      <SellScreen
        {...common}
        active={onSell}
        onPay={() => setPayOpen(true)}
        onSplit={startSplit}
        onOpenShift={() => go('shift')}
        onOpenBills={() => go('bills')}
        openBillRequest={openBill}
      />
    </View>
  );
  const other = printer ? (
    <PrinterScreen {...common} onBack={() => setPrinter(false)} />
  ) : history ? (
    <ShiftHistoryScreen {...common} onBack={() => setHistory(false)} />
  ) : tab === 'sell' ? null : tab === 'bills' ? (
    <BillsScreen
      {...common}
      onOpenShift={() => go('shift')}
      onRecalled={() => {
        go('sell');
        setOpenBill((n) => n + 1);
      }}
    />
  ) : tab === 'shift' ? (
    <ShiftScreen {...common} onOpenBills={() => go('bills')} onOpenHistory={() => setHistory(true)} />
  ) : (
    <MoreScreen {...common} onOpenPrinter={() => setPrinter(true)} onSwitchCashier={() => void switchCashier()} onSignOut={() => void signOutAll()} />
  );
  const screen = (
    <>
      {sell}
      {other}
    </>
  );

  return (
    <View className="flex-1 bg-paper">
      {wide ? (
        <View className="flex-1 flex-row">
          <Rail tab={tab} onChange={go} />
          <View className="flex-1">{screen}</View>
        </View>
      ) : (
        <>
          <View className="flex-1">{screen}</View>
          <BottomNav tab={tab} onChange={go} />
        </>
      )}

      {shift ? (
        <PaymentScreen
          visible={payOpen}
          existingTransactionId={activeHeldBillId}
          onClose={() => setPayOpen(false)}
          onDone={() => {
            setPayOpen(false);
            setActiveHeldBillId(null);
            setActiveHeldNumber(null);
          }}
        />
      ) : null}
      {split && !splitPay ? (
        <SplitBillScreen
          parentTransactionId={split.parentId}
          number={split.number}
          part={split.part}
          onBack={() => {
            setSplit(null);
            clearSplitBill();
          }}
          onPay={(items, customer, meta) => setSplitPay({ items, customer, meta })}
        />
      ) : null}
      {split && splitPay && shift ? (
        <PaymentScreen
          visible
          itemsOverride={splitPay.items}
          customerOverride={splitPay.customer}
          parentTransactionId={split.parentId}
          clearCartOnSuccess={false}
          meta={splitPay.meta}
          onClose={() => setSplitPay(null)}
          onDone={() => void afterSplitPart()}
        />
      ) : null}
      <QueueSheet visible={queueOpen} onClose={() => setQueueOpen(false)} />
      <BellSheet visible={bellOpen} onClose={() => setBellOpen(false)} />
    </View>
  );
}

const BOOT_STEPS = 4; // fonts, cached subscription, account, session

function Root() {
  const notify = useNotify();
  const { session } = useRootState();
  const { setSession, setShift, resetAll } = useRootActions();
  const [boot, setBoot] = useState(true);
  const [bootDone, setBootDone] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [splashGone, setSplashGone] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  // The cashier still signed in when the app opened: their PIN is asked again before the shell (offlinePin.ts).
  const [resume, setResume] = useState<AppSession | null>(null);
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  useEffect(() => {
    if (Platform.OS === 'android') void NavigationBar.setStyle('dark');
  }, []);

  const loadShift = useCallback(
    async (cashierId: string) => {
      try {
        setShift(await resolveOpenShift(cashierId));
      } catch {
        notify.toast('warning', t('Status shift belum dimuat'), t('Periksa internet, lalu buka tab Shift untuk menyegarkan.'));
      }
    },
    [notify, setShift],
  );

  useEffect(() => {
    (async () => {
      try {
        await loadCachedSubscription();
        setBootDone((d) => d + 1);
        setAccountEmail(await getAccountEmail());
        setBootDone((d) => d + 1);
        setResume(await loadSession());
        setBootDone((d) => d + 1);
      } catch (e) {
        void notify.fail(t('Sesi kasir belum dimuat'), e, t('Periksa internet, lalu masuk lagi.'));
      } finally {
        setBoot(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Into the shell, after a PIN accepted by the server or, for the cashier still on shift, by the phone. */
  const enter = async (s: AppSession) => {
    const resumed = s.cashierId === resume?.cashierId;
    // Reopened without internet: only a shift opened in the last 24 hours goes on (owner's choice, 18 Oct 2026).
    const offlineShift = isOnline() ? null : await resolveOpenShift(s.cashierId).catch(() => null);
    if (offlineShift && !canResumeOffline(offlineShift.openedAt)) {
      void notify.warning(t('Shift sudah lebih dari 24 jam'), t('Sambungkan internet untuk lanjut. Penjualan yang belum terkirim tetap aman di HP.'));
      return;
    }
    setResume(null);
    setSession(s);
    // The device copy of the open shift shows at once; the server's answer replaces it when it arrives.
    const copy = offlineShift ?? (await cachedOpenShift(s.cashierId));
    if (copy) setShift(copy);
    void loadShift(s.cashierId);
    if (resumed)
      void cashierStillActive(s.cashierId).then(async (active) => {
        if (active) return;
        await clearActiveCashier();
        resetAll();
        notify.toast('warning', t('Kasir ini sudah tidak aktif'), t('Pemilik menonaktifkannya di backoffice. Pilih kasir lain.'));
      });
  };

  // Never hold the splash forever if fonts or the session load hang.
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(id);
  }, []);

  const fontsReady = fontsLoaded || !!fontError;
  const booting = !timedOut && (boot || !fontsReady);
  const steps = [fontsReady, bootDone >= 1, bootDone >= 2, bootDone >= 3];
  const done = steps.filter(Boolean).length;
  const labels = [t('Memuat huruf'), t('Memuat langganan'), t('Memeriksa akun'), t('Memeriksa sesi'), t('Siap')];
  // The splash sits on top of the app and fades out, so it also covers the first frames of the screen under it.
  const splash = splashGone ? null : (
    <HermesSplash
      ready={!booting}
      step={labels[done]}
      progress={done / BOOT_STEPS}
      onDone={() => setSplashGone(true)}
    />
  );

  let screen = null;
  if (!booting) {
    screen = !accountEmail ? (
      <LoginScreen onSignedIn={async () => setAccountEmail(await getAccountEmail())} />
    ) : !session ? (
      <CashierPickerScreen
        accountEmail={accountEmail}
        resumeCashierId={resume?.cashierId}
        onSelected={enter}
        onSignedOut={() => {
          setResume(null);
          resetAll();
          void clearSubscription();
          setAccountEmail(null);
        }}
      />
    ) : (
      <Shell onSignedOut={() => setAccountEmail(null)} />
    );
  }
  return (
    <>
      <StatusBar style="dark" />
      {screen}
      {splash}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LangProvider>
        <NotifyProvider>
          <AppStoreProvider>
            <Root />
          </AppStoreProvider>
        </NotifyProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
