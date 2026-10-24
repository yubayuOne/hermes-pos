import React, { createContext, useContext, useId } from 'react';
import { Tap } from './Tap';
import { KeyboardAvoidingView, Modal, ScrollView, ScrollViewProps, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Display, Text } from './Text';
import { IconButton } from './Button';
import { useLayout } from '../hooks/useLayout';
import { DialogHost, ToastHost, useDialogLayer } from '../hooks/NotifyProvider';
import { colors, shadow } from '../theme';
import { t } from '../i18n';

type Size = 'auto' | 'tall' | 'full';
const SheetCtx = createContext<{ size: Size; centered: boolean }>({ size: 'auto', centered: false });

/**
 * Bottom sheet on phones; on wide screens it becomes a centered dialog (max 560) with a 6px hard shadow
 * (DESIGN I3). `full` is a full screen on phones (Bayar, Berhasil) and a large dialog (max 940 x 720) on
 * wide screens. Start with <SheetHeader>, put content in <SheetBody>, end with <ActionFooter>.
 */
export function Sheet({
  visible,
  onClose,
  size = 'auto',
  children,
  label,
}: {
  visible: boolean;
  onClose: () => void;
  size?: Size;
  children: React.ReactNode;
  label?: string;
}) {
  const { wide, width, height } = useLayout();
  const insets = useSafeAreaInsets();
  const centered = wide;
  const full = size === 'full';
  const layerId = useId();
  useDialogLayer(layerId, visible);

  let box: object;
  if (centered) {
    box = full
      ? // Short screens: keep the dialog out from under the status bar and the gesture bar (the sheet is centered).
        { width: Math.min(940, width - 48), height: Math.min(720, height - (height < 520 ? 2 * Math.max(insets.top, insets.bottom, 6) : 32)), ...shadow.dialog }
      : // Phone landscape is short but wide: a wider dialog wraps less text, so less of it needs scrolling.
        {
          width: Math.min(height < 520 ? 720 : 560, width - 48),
          maxHeight: height - (height < 520 ? 2 * Math.max(insets.top, insets.bottom, 6) + 8 : 48),
          ...shadow.dialog,
        };
  } else if (full) {
    box = { width: '100%', height: '100%', paddingTop: insets.top };
  } else {
    box = { width: '100%', maxHeight: '92%', ...(size === 'tall' ? { height: '92%' } : null) };
  }

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={centered ? 'fade' : full ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={{
            flex: 1,
            justifyContent: centered ? 'center' : 'flex-end',
            alignItems: 'center',
            backgroundColor: full && !centered ? colors.paper : 'rgba(16,20,18,0.6)',
          }}
        >
          {!full || centered ? (
            <Tap accessibilityLabel={t('Tutup')} onPress={onClose} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
          ) : null}
          <View
            style={[
              box,
              {
                backgroundColor: full ? colors.paper : colors.slip,
                borderColor: colors.ink,
                borderWidth: centered ? 1.5 : 0,
                borderTopWidth: centered || full ? (centered ? 1.5 : 0) : 1.5,
                borderRadius: centered ? 4 : 0,
                overflow: 'hidden',
              },
            ]}
          >
            {!centered && !full ? (
              <View className="items-center pt-2">
                <View style={{ width: 44, height: 5, borderRadius: 2, backgroundColor: colors.line }} />
              </View>
            ) : null}
            <SheetCtx.Provider value={{ size, centered }}>{children}</SheetCtx.Provider>
          </View>
          <ToastHost />
          <DialogHost layerId={layerId} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Title (Bricolage 27), optional sub line, close button 44px, and room for extra actions. */
export function SheetHeader({
  title,
  subtitle,
  eyebrow,
  onClose,
  onBack,
  actions,
  right,
  titleSize = 27,
}: {
  title: string;
  titleSize?: number;
  subtitle?: string;
  eyebrow?: string;
  onClose?: () => void;
  onBack?: () => void;
  actions?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-start gap-3 border-b-k border-ink px-4 pb-3 pt-3">
      {onBack ? <IconButton icon="chevron-left" label={t('Kembali')} onPress={onBack} /> : null}
      <View className="min-w-0 flex-1">
        {eyebrow ? <Text className="font-mono text-[14px] text-mute">{eyebrow}</Text> : null}
        <Display size={titleSize} numberOfLines={2}>
          {title}
        </Display>
        {subtitle ? (
          <Text className="mt-1 text-[14px] text-mute" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {actions}
      {onClose ? <IconButton icon="close" label={t('Tutup')} onPress={onClose} /> : null}
    </View>
  );
}

export function SheetBody({ children, contentClassName = '', ...rest }: ScrollViewProps & { contentClassName?: string; children: React.ReactNode }) {
  const { size, centered } = useContext(SheetCtx);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      // A centered dialog only has a maxHeight (no fixed height), so `flex: 1` (basis 0) would collapse the body to nothing.
      style={size === 'full' || (size === 'tall' && !centered) ? { flex: 1 } : { flexGrow: 0 }}
      contentContainerClassName={`px-4 py-4 ${contentClassName}`}
      {...rest}
    >
      {children}
    </ScrollView>
  );
}

/**
 * Fixed footer for the actions. Keeps 20px + 16px above the gesture bar (PRD X4) on phones.
 * `plain` drops the top border (for a keypad).
 */
export function ActionFooter({ children, plain, className = '' }: { children: React.ReactNode; plain?: boolean; className?: string }) {
  const insets = useSafeAreaInsets();
  const { centered } = useContext(SheetCtx);
  const bottom = centered ? 16 : Math.max(insets.bottom, 20) + 16;
  return (
    <View className={`gap-3 bg-slip px-4 pt-3 ${plain ? '' : 'border-t-k border-ink'} ${className}`} style={{ paddingBottom: bottom }}>
      {children}
    </View>
  );
}
