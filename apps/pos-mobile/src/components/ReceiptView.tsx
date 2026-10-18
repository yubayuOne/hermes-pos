import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Mono } from './Text';
import { Slip, SlipBand, SlipRow, SlipRule } from './Slip';
import { ReceiptData } from '../services/printer/types';
import { loadReceiptSettings, ReceiptSettings } from '../services/printer/settings';
import { receiptTexts } from '../utils/receipt';
import { money, num, t, useT } from '../i18n';

/**
 * The receipt on screen (DESIGN I4): mono 14px, dashed separators, torn bottom edge. The total sits on an
 * orange band, except on the success screen where the change block already carries the weight.
 */
export function ReceiptView({
  data,
  totalBand = true,
  showPayment = true,
  className = '',
}: {
  data: ReceiptData;
  totalBand?: boolean;
  showPayment?: boolean;
  className?: string;
}) {
  useT();
  const [s, setS] = useState<ReceiptSettings | null>(null);
  useEffect(() => {
    void loadReceiptSettings().then(setS);
  }, []);
  const text = s ? receiptTexts(s, data) : null;
  const discount = data.discount ?? 0;
  // Customer receipts group items by preparation station: Kitchen first, then Bar.
  const kitchenItems = data.items.filter((item) => item.station === 'kitchen');
  const barItems = data.items.filter((item) => item.station === 'bar');
  const hasBothStations = kitchenItems.length > 0 && barItems.length > 0;
  const renderItems = (items: typeof data.items) =>
    items.map((i, k) => (
      <View key={`${i.station}-${i.name}-${k}`}>
        <SlipRow left={`${i.quantity}× ${i.name}`} right={num(i.total - (i.discount ?? 0))} />
        {i.note && s?.showNotes !== false ? <SlipRow sub left={`   ${i.note}`} /> : null}
      </View>
    ));
  return (
    <Slip className={className}>
      <View className="items-center">
        {data.logoUrl ? (
          <Image
            source={{ uri: data.logoUrl }}
            accessibilityIgnoresInvertColors
            accessibilityElementsHidden
            importantForAccessibility="no"
            resizeMode="contain"
            style={{ width: 72, height: 72, marginBottom: 6 }}
          />
        ) : null}
        {s?.businessName ? <Mono className="font-mono-600 text-[14px]">{s.businessName.toUpperCase()}</Mono> : null}
        <Mono className="text-center text-[13px] text-mute">
          {data.outlet}
          {data.outletPhone && s?.showPhone !== false ? ` · ${data.outletPhone}` : ''}
        </Mono>
        {text?.address ? <Mono className="text-center text-[13px] text-mute">{text.address}</Mono> : null}
        {text?.header[0] ? <Mono className="text-center text-[13px] text-mute">{text.header[0]}</Mono> : null}
      </View>
      <SlipRule />
      <SlipRow left={data.number} right={data.date} />
      {data.cashier && s?.showCashier !== false ? <SlipRow left={t('Kasir')} right={data.cashier} /> : null}
      {data.customer.table ? <SlipRow left={t('Meja')} right={data.customer.table} /> : null}
      {data.customer.name ? <SlipRow left={t('Pelanggan')} right={data.customer.name} /> : null}
      <SlipRule />
      {renderItems(kitchenItems)}
      {hasBothStations ? <SlipRule /> : null}
      {renderItems(barItems)}
      {discount > 0 ? (
        <>
          <SlipRule />
          <SlipRow left={t('Diskon dan voucher')} right={`-${money(discount)}`} tone="pine" />
        </>
      ) : null}
      {totalBand ? (
        <SlipBand left="TOTAL" right={money(data.total)} />
      ) : (
        <>
          <SlipRule />
          <SlipRow strong left="TOTAL" right={money(data.total)} />
        </>
      )}
      {showPayment && data.isPaid !== false ? (
        <>
          <SlipRow left={data.paymentMethod === 'qris' ? t('QRIS') : t('Tunai')} right={money(data.paid)} />
          {data.paymentMethod === 'cash' ? <SlipRow left={t('Kembalian')} right={money(data.change)} /> : null}
        </>
      ) : null}
      {data.provisional ? (
        <>
          <SlipRule />
          <SlipRow sub left={t('Nomor sementara. Nomor resmi terbit setelah sinkron.')} />
        </>
      ) : null}
      <SlipRule />
      <Mono className="text-center text-[13px] text-mute">{text?.footer[0] ?? t('Terima kasih')}</Mono>
    </Slip>
  );
}
