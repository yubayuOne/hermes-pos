import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Tap } from '../components/Tap';
import { AccessibilityInfo, Animated, Easing, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Mono, Text } from '../components/Text';
import { Button, ButtonVariant } from '../components/Button';
import { useLayout } from './useLayout';
import { colors, shadow } from '../theme';
import { describeError } from '../utils/errors';
import { t } from '../i18n';

/*
 * Two kinds of messages, no Alert.alert anywhere (PRD X6):
 *   1. Toast  : short news. Phone: top of screen. Tablet: top right. Pine-soft for success, fire-soft for
 *               failure. Optional action (Batalkan, Coba lagi). 3.6 s, or 6 s with an action.
 *   2. Dialog : needs an answer. Centered, 6px hard shadow, a question as the title, buttons at the bottom right.
 */

export type NotifyTone = 'success' | 'info' | 'warning' | 'error';
export type ToastAction = { label: string; onPress: () => void };

export type DialogAction = { key: string; label: string; variant?: 'primary' | 'secondary' | 'danger' | 'pine' };
export type DialogDetail = { label: string; value: string; tone?: 'default' | 'success' | 'error' };
export type DialogOptions = {
  tone?: NotifyTone;
  title: string;
  message?: string;
  hint?: string;
  details?: DialogDetail[];
  actions?: DialogAction[];
  dismissKey?: string | null;
};
export type ProblemOptions = { hint?: string; details?: DialogDetail[]; actions?: DialogAction[] };
export type ConfirmOptions = {
  title: string;
  message?: string;
  hint?: string;
  details?: DialogDetail[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  tone?: NotifyTone;
};

export type Notify = {
  success(title: string, message?: string, action?: ToastAction): void;
  info(title: string, message?: string, action?: ToastAction): void;
  toast(tone: NotifyTone, title: string, message?: string, action?: ToastAction): void;
  error(title: string, message?: string, options?: ProblemOptions): Promise<string | null>;
  warning(title: string, message?: string, options?: ProblemOptions): Promise<string | null>;
  fail(title: string, error: unknown, fallback?: string, options?: ProblemOptions): Promise<string | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  dialog(options: DialogOptions): Promise<string | null>;
};

type ToastItem = { id: number; tone: NotifyTone; title: string; message?: string; action?: ToastAction };
type QueueItem = { id: number; options: DialogOptions; resolve: (key: string | null) => void };

const NotifyContext = createContext<Notify | null>(null);
const ToastStateContext = createContext<{ toast: ToastItem | null; dismiss: (id: number) => void }>({ toast: null, dismiss: () => undefined });

const TOAST_BG: Record<NotifyTone, string> = { success: colors.pineSoft, info: colors.slip, warning: colors.fireSoft, error: colors.fireSoft };

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const { wide } = useLayout();
  const anim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduce)
      .catch(() => undefined);
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, { toValue: 0, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => done.current());
  }, [anim]);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 200, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true }).start();
    const timer = setTimeout(close, item.action ? 6000 : 3600);
    return () => clearTimeout(timer);
  }, [anim, close, item.action]);

  const pos = wide ? { top: insets.top + 12, right: 16, width: 380 } : { top: insets.top + 12, left: 12, right: 12 };
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        zIndex: 100,
        ...pos,
        opacity: anim,
        transform: reduce ? [] : [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
      }}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="flex-row items-center gap-2 rounded-k px-3.5 py-3"
        style={{ backgroundColor: TOAST_BG[item.tone], borderWidth: 1.5, borderColor: colors.ink, ...shadow.toast }}
      >
        <View className="min-w-0 flex-1">
          <Text className="font-body-700 text-body" numberOfLines={2}>
            {item.title}
          </Text>
          {item.message ? (
            <Text className="mt-0.5 text-small text-mute" numberOfLines={3}>
              {item.message}
            </Text>
          ) : null}
        </View>
        {item.action ? (
          <Tap
            accessibilityRole="button"
            onPress={() => {
              item.action?.onPress();
              close();
            }}
            className="h-[44px] justify-center rounded-k border-k border-ink bg-slip px-3"
          >
            <Text className="font-body-600 text-small">{item.action.label}</Text>
          </Tap>
        ) : null}
        <Tap accessibilityRole="button" accessibilityLabel={t('Tutup')} onPress={close} className="h-[44px] justify-center px-1.5">
          <Text className="font-body-600 text-small underline">{t('Tutup')}</Text>
        </Tap>
      </View>
    </Animated.View>
  );
}

/** Renders the active toast. Mounted at the root and inside each Sheet, because a Modal covers the root. */
export function ToastHost() {
  const { toast, dismiss } = useContext(ToastStateContext);
  if (!toast) return null;
  return <Toast key={toast.id} item={toast} onDone={() => dismiss(toast.id)} />;
}

const VARIANT: Record<NonNullable<DialogAction['variant']>, ButtonVariant> = { primary: 'fire', secondary: 'plain', danger: 'danger-solid', pine: 'pine' };

function DialogCard({ options, onAction }: { options: DialogOptions; onAction: (key: string) => void }) {
  const { width, height } = useLayout();
  const actions: DialogAction[] = options.actions?.length ? options.actions : [{ key: 'ok', label: t('Mengerti'), variant: 'primary' }];
  // Two buttons side by side only when both labels fit; otherwise stacked with the primary action last (thumb).
  const stack = actions.length > 2 || (actions.length === 2 && (width < 430 || actions.some((a) => a.label.length > 16)));
  return (
    <View className="rounded-k border-k border-ink bg-slip" style={{ width: Math.min(480, width - 40), maxHeight: height - 80, ...shadow.dialog }}>
      <ScrollView contentContainerClassName="px-5 pt-5 pb-2" showsVerticalScrollIndicator={false}>
        <Display size={26} accessibilityRole="header">
          {options.title}
        </Display>
        {options.message ? <Text className="mt-2 text-body leading-[22px] text-mute">{options.message}</Text> : null}
        {options.details?.length ? (
          <View className="mt-3 rounded-k border-k border-ink bg-paper px-3 py-2">
            {options.details.map((d, i) => (
              <View key={i} className="flex-row justify-between gap-3 py-1">
                <Mono className="text-small text-mute">{d.label}</Mono>
                <Mono
                  className="font-mono-600 text-small"
                  style={{ color: d.tone === 'error' ? colors.error : d.tone === 'success' ? colors.pine : colors.ink }}
                >
                  {d.value}
                </Mono>
              </View>
            ))}
          </View>
        ) : null}
        {options.hint ? (
          <View
            accessibilityRole="alert"
            className="mt-3 rounded-k px-3 py-2.5"
            style={{
              backgroundColor: options.tone === 'error' || options.tone === 'warning' ? colors.fireSoft : colors.tint3,
              borderWidth: 1.5,
              borderColor: colors.ink,
            }}
          >
            <Text className="text-small leading-[20px]">{options.hint}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View className={`gap-2.5 px-5 pb-5 pt-3 ${stack ? '' : 'flex-row justify-end'}`}>
        {actions.map((a) => (
          <Button
            key={a.key}
            label={a.label}
            variant={VARIANT[a.variant ?? (a === actions[actions.length - 1] ? 'primary' : 'secondary')]}
            grow={stack ? undefined : 1}
            onPress={() => onAction(a.key)}
          />
        ))}
      </View>
    </View>
  );
}

/** Root dialog, used when no sheet is open. */
function Dialog({ options, onAction, onDismiss }: { options: DialogOptions | null; onAction: (key: string) => void; onDismiss: () => void }) {
  return (
    <Modal visible={!!options} transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <View accessibilityViewIsModal className="flex-1 items-center justify-center p-5" style={{ backgroundColor: 'rgba(16,20,18,0.6)' }}>
        {options ? <DialogCard options={options} onAction={onAction} /> : null}
      </View>
    </Modal>
  );
}

/*
 * A Modal opened later can still render below an earlier one (react-native-web), so while sheets are open the
 * dialog is drawn inside the topmost sheet instead of in its own Modal. Each Sheet registers itself as a layer.
 */
type LayerApi = { register: (id: string) => () => void; top: string | null; current: DialogOptions | null; settle: (k: string | null) => void };
const LayerContext = createContext<LayerApi>({ register: () => () => undefined, top: null, current: null, settle: () => undefined });

export function useDialogLayer(id: string, active: boolean) {
  const { register } = useContext(LayerContext);
  useEffect(() => (active ? register(id) : undefined), [id, active, register]);
}

/** Dialog drawn inside a sheet's Modal when that sheet is on top. */
export function DialogHost({ layerId }: { layerId: string }) {
  const { top, current, settle } = useContext(LayerContext);
  if (top !== layerId || !current) return null;
  return (
    <View
      accessibilityViewIsModal
      className="items-center justify-center p-5"
      style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: 'rgba(16,20,18,0.6)' }}
    >
      <DialogCard options={current} onAction={settle} />
    </View>
  );
}

export function NotifyProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [current, setCurrent] = useState<QueueItem | null>(null);
  const [layers, setLayers] = useState<string[]>([]);
  const register = useCallback((id: string) => {
    setLayers((l) => [...l.filter((x) => x !== id), id]);
    return () => setLayers((l) => l.filter((x) => x !== id));
  }, []);
  const currentRef = useRef<QueueItem | null>(null);
  const pending = useRef<QueueItem[]>([]);
  const seq = useRef(0);

  const showToast = useCallback((tone: NotifyTone, title: string, message?: string, action?: ToastAction) => {
    seq.current += 1;
    setToast({ id: seq.current, tone, title, message, action });
  }, []);
  const dismissToast = useCallback((id: number) => setToast((c) => (c && c.id === id ? null : c)), []);

  const dialog = useCallback(
    (options: DialogOptions) =>
      new Promise<string | null>((resolve) => {
        seq.current += 1;
        const item: QueueItem = { id: seq.current, options, resolve };
        if (currentRef.current) pending.current.push(item);
        else {
          currentRef.current = item;
          setCurrent(item);
        }
      }),
    [],
  );

  const settle = useCallback((key: string | null) => {
    const item = currentRef.current;
    if (!item) return;
    const next = pending.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
    item.resolve(key);
  }, []);

  const api = useMemo<Notify>(() => {
    const problem = (tone: 'error' | 'warning', title: string, message?: string, o?: ProblemOptions) =>
      dialog({ tone, title, message, hint: o?.hint, details: o?.details, actions: o?.actions });
    return {
      success: (title, message, action) => showToast('success', title, message, action),
      info: (title, message, action) => showToast('info', title, message, action),
      toast: showToast,
      error: (title, message, o) => problem('error', title, message, o),
      warning: (title, message, o) => problem('warning', title, message, o),
      fail: (title, error, fallback, o) => {
        const info = describeError(error, fallback);
        return problem('error', title, info.message, { ...o, hint: o?.hint ?? info.hint });
      },
      confirm: async (o) => {
        const key = await dialog({
          tone: o.tone ?? (o.destructive ? 'warning' : 'info'),
          title: o.title,
          message: o.message,
          hint: o.hint,
          details: o.details,
          actions: [
            { key: 'cancel', label: o.cancelLabel ?? t('Batal'), variant: 'secondary' },
            { key: 'confirm', label: o.confirmLabel ?? t('Ya, lanjutkan'), variant: o.destructive ? 'danger' : 'primary' },
          ],
        });
        return key === 'confirm';
      },
      dialog,
    };
  }, [dialog, showToast]);

  const toastValue = useMemo(() => ({ toast, dismiss: dismissToast }), [toast, dismissToast]);
  const top = layers.length ? layers[layers.length - 1] : null;
  const layerValue = useMemo<LayerApi>(() => ({ register, top, current: current?.options ?? null, settle }), [register, top, current, settle]);

  return (
    <NotifyContext.Provider value={api}>
      <ToastStateContext.Provider value={toastValue}>
        <LayerContext.Provider value={layerValue}>
          <View style={{ flex: 1 }}>
            {children}
            <ToastHost />
          </View>
          <Dialog options={top ? null : (current?.options ?? null)} onAction={settle} onDismiss={() => settle(current?.options.dismissKey ?? null)} />
        </LayerContext.Provider>
      </ToastStateContext.Provider>
    </NotifyContext.Provider>
  );
}

export function useNotify(): Notify {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify must be used inside <NotifyProvider>');
  return ctx;
}
