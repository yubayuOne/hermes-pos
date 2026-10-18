import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Tag } from '../../components/bits';
import { Slip, SlipRow, SlipRule } from '../../components/Slip';
import { useNotify } from '../../hooks/NotifyProvider';
import { planLabel, refreshSubscription, useSubscription } from '../../services/subscription/subscription';
import { BRAND } from '../../brand';
import { fmtDate, money, t, useT } from '../../i18n';

/** Plan prices (PRD 6) for the renewal line. The server decides; this is only what the owner will see. */
const PRICE: Record<string, { amount: number; per: string }> = {
  monthly: { amount: 149000, per: 'bulan' },
  semiannual: { amount: 699000, per: '6 bulan' },
  annual: { amount: 1399000, per: 'tahun' },
};

/**
 * Locked screen (DESIGN I5.20, PRD G3, G4): shown on Jual when the subscription has expired. Bills stay readable,
 * void and new shifts are disabled, and the queue made before expiry still syncs.
 */
export function LockedScreen({ onOpenBills }: { onOpenBills: () => void }) {
  useT();
  const notify = useNotify();
  const { status } = useSubscription();
  const [checking, setChecking] = useState(false);
  const price = PRICE[status?.planCode ?? ''] ?? PRICE.monthly;
  const check = async () => {
    setChecking(true);
    try {
      const s = await refreshSubscription();
      if (s && s.state !== 'expired') notify.success(t('Langganan aktif lagi'), t('Penjualan baru sudah dibuka.'));
      else notify.toast('warning', t('Langganan masih berakhir'), t('Pemilik perlu memperpanjang paket di backoffice.'));
    } catch (e) {
      void notify.fail(t('Status langganan belum bisa diperiksa'), e);
    } finally {
      setChecking(false);
    }
  };
  const steps = [
    t('Pemilik masuk ke {host} dari HP atau laptop.', { host: BRAND.backofficeHost }),
    t('Buka Pengaturan, tab Langganan, lalu Pilih paket dan bayar.'),
    t('Setelah pembayaran diverifikasi, kasir bisa jualan lagi tanpa memasang ulang aplikasi.'),
  ];
  return (
    <ScrollView contentContainerClassName="px-4 pb-8 pt-4" contentContainerStyle={{ maxWidth: 640 }}>
      <Tag tone="error" label={t('Langganan berakhir · {date}', { date: status?.expiresAt ? fmtDate(status.expiresAt) : '-' })} />
      <Display size={34} className="mt-3" accessibilityRole="header">
        {t('Penjualan baru dikunci.')}
      </Display>
      <Text className="mt-2 text-[15px] leading-[22px] text-mute">
        {t('Data bisnis tetap aman. Riwayat bill dan laporan shift masih bisa dibuka. Pembayaran offline yang dibuat sebelum berakhir tetap dikirim.')}
      </Text>
      <Slip className="mt-4 w-full max-w-[400px]">
        <View className="flex-row items-center justify-between">
          <Mono className="font-mono-600 text-[14px]">{t('LANGGANAN')}</Mono>
          <Tag tone="error" label={t('berakhir')} />
        </View>
        <SlipRule />
        <SlipRow left={t('Paket')} right={planLabel(status)} />
        <SlipRow left={t('Berakhir')} right={status?.expiresAt ? fmtDate(status.expiresAt) : '-'} />
        <SlipRow left={t('Perpanjang')} right={`${money(price.amount)}/${t(price.per)}`} />
        <SlipRule />
        <SlipRow sub left={t('Data tidak pernah dihapus selama langganan berakhir.')} />
      </Slip>
      <Display size={22} className="mt-6">
        {t('Cara memperpanjang')}
      </Display>
      <View className="mt-2 gap-2.5">
        {steps.map((s, i) => (
          <View key={i} className="flex-row items-start gap-2.5">
            <View className="h-[28px] w-[28px] items-center justify-center rounded-k border-k border-ink bg-slip">
              <Mono className="text-[14px]">{i + 1}</Mono>
            </View>
            <Text className="min-w-0 flex-1 pt-0.5 text-[15px]">{s}</Text>
          </View>
        ))}
      </View>
      <Text className="mt-3 text-[14px] text-mute">{t('Perlu bantuan? WhatsApp {wa}.', { wa: BRAND.whatsapp })}</Text>
      <ButtonRow className="mt-4">
        <Button label={t('Lihat riwayat bill')} onPress={onOpenBills} />
        <Button variant="pine" label={checking ? t('Memeriksa...') : t('Periksa status langganan')} loading={checking} onPress={() => void check()} />
      </ButtonRow>
    </ScrollView>
  );
}
