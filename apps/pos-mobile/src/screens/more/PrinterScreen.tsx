import { useEffect, useState } from 'react';
import { Tap } from '../../components/Tap';
import { Linking, ScrollView, View } from 'react-native';
import { Display, Mono, Text } from '../../components/Text';
import { Button, ButtonRow } from '../../components/Button';
import { Card, Chip, Label, Tabs, Tag } from '../../components/bits';
import { Icon } from '../../components/Icon';
import { Header } from '../../components/chrome';
import { useLayout } from '../../hooks/useLayout';
import { useNotify } from '../../hooks/NotifyProvider';
import { BluetoothPermissionError, getPairedBluetoothPrinters } from '../../services/printer/bluetooth';
import { loadPrinters, removePrinter, updatePrinter, upsertPrinter } from '../../services/printer/registry';
import { detectPrinterProfile, printerService } from '../../services/printer/service';
import { PrinterDevice, PrinterRole } from '../../services/printer/types';
import { colors } from '../../theme';
import { fmtTime, t, useT } from '../../i18n';

const ROLES: Array<{ key: PrinterRole; label: string }> = [
  { key: 'receipt', label: 'Struk pelanggan' },
  { key: 'kitchen', label: 'Dapur' },
  { key: 'bar', label: 'Bar' },
  { key: 'reprint', label: 'Cetak ulang' },
  { key: 'report', label: 'Laporan' },
];

/**
 * Printers (DESIGN I5.17, PRD D1 to D4): any Bluetooth ESC/POS printer, 58 or 80 mm, assigned by role.
 * The brand is only a label. Receipt content (header, footer) is set in the backoffice.
 */
export function PrinterScreen({ onBack, onQueue, onBell }: { onBack: () => void; onQueue: () => void; onBell: () => void }) {
  useT();
  const notify = useNotify();
  const { wide } = useLayout();
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [devices, setDevices] = useState<Array<{ name: string; address: string }>>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string; at: number }>>({});

  const refresh = async () => setPrinters(await loadPrinters());
  useEffect(() => {
    void refresh();
  }, []);

  const scan = async () => {
    setScanning(true);
    try {
      const found = await getPairedBluetoothPrinters();
      const known = new Set(printers.map((p) => p.address));
      setDevices(found.filter((d) => !known.has(d.address)));
      if (!found.length)
        void notify.warning(t('Belum ada perangkat Bluetooth yang di-pair'), t('Pair printer di Pengaturan Bluetooth Android dulu, lalu cari lagi di sini.'));
    } catch (e) {
      if (e instanceof BluetoothPermissionError) {
        const key = await notify.error(t('Izin Perangkat sekitar belum aktif'), e.message, {
          actions: [
            { key: 'close', label: t('Tutup'), variant: 'secondary' },
            { key: 'settings', label: t('Buka pengaturan'), variant: 'primary' },
          ],
        });
        if (key === 'settings') void Linking.openSettings();
      } else {
        void notify.fail(t('Bluetooth bermasalah'), e, undefined, {
          hint: t('Pastikan Bluetooth menyala dan printer sudah di-pair di Pengaturan Bluetooth Android.'),
        });
      }
    } finally {
      setScanning(false);
    }
  };

  const add = async (d: { name: string; address: string }) => {
    const printer: PrinterDevice = {
      id: `bt-${d.address.replace(/[^a-zA-Z0-9]/g, '')}`,
      name: d.name || t('Printer Bluetooth'),
      ...detectPrinterProfile(d.name || ''),
      address: d.address,
      connectionType: 'bluetooth',
      paperWidth: 58,
      roles: printers.length ? [] : ['receipt'],
      enabled: true,
      autoPrint: true,
      status: 'disconnected',
      capabilities: { cut: true, cashDrawer: true, image: false },
    };
    try {
      setPrinters(await upsertPrinter(printer));
      setDevices((list) => list.filter((x) => x.address !== d.address));
      notify.success(t('Printer ditambahkan'), t('Pilih perannya, lalu cetak uji.'));
    } catch (e) {
      void notify.fail(t('Printer belum ditambahkan'), e);
    }
  };

  const patch = async (p: PrinterDevice, fields: Partial<PrinterDevice>) => setPrinters(await updatePrinter(p.id, fields));
  const toggleRole = (p: PrinterDevice, role: PrinterRole) =>
    void patch(p, { roles: p.roles.includes(role) ? p.roles.filter((r) => r !== role) : [...p.roles, role] });

  const test = async (p: PrinterDevice) => {
    setTesting(p.id);
    try {
      const r = (await printerService.testPrint(p))[0];
      setResults((x) => ({
        ...x,
        [p.id]: {
          ok: !!r?.ok,
          text: r?.ok ? t('Cetak uji berhasil. Periksa kertasnya: teks tidak terpotong.') : r?.error || t('Printer tidak merespons.'),
          at: Date.now(),
        },
      }));
    } catch (e: any) {
      setResults((x) => ({ ...x, [p.id]: { ok: false, text: String(e?.message || t('Printer tidak merespons.')), at: Date.now() } }));
    } finally {
      setTesting(null);
      await refresh();
    }
  };

  const remove = async (p: PrinterDevice) => {
    const ok = await notify.confirm({
      title: t('Hapus printer ini?'),
      message: t('{name} dilepas dari HERMES POS. Pairing di Bluetooth Android tetap ada.', { name: p.name }),
      confirmLabel: t('Hapus printer'),
      destructive: true,
    });
    if (!ok) return;
    setPrinters(await removePrinter(p.id));
  };

  const card = (p: PrinterDevice) => {
    const res = results[p.id];
    const tag =
      p.status === 'connected' ? (
        <Tag tone="pine" label={t('terhubung')} />
      ) : p.status === 'error' ? (
        <Tag tone="error" label={t('galat')} />
      ) : (
        <Tag label={t('belum diuji')} />
      );
    return (
      <Card key={p.id}>
        <View className="flex-row items-start gap-2">
          <View className="min-w-0 flex-1">
            <Display size={22} numberOfLines={1}>
              {p.name}
            </Display>
            <Mono className="mt-0.5 text-small text-mute">
              {[p.brand && p.brand !== 'generic' ? p.brand : t('generik'), `${p.paperWidth} mm`, 'ESC/POS', 'Bluetooth'].join(' · ')}
            </Mono>
          </View>
          {tag}
        </View>
        {p.lastError && p.status === 'error' ? (
          <View className="mt-3 rounded-k px-3 py-2" style={{ borderWidth: 1.5, borderColor: colors.errorLine, backgroundColor: colors.errorSoft }}>
            <Text className="text-small text-error">{p.lastError}</Text>
          </View>
        ) : null}
        <Label className="mt-3">{t('Dipakai untuk')}</Label>
        <View className="mt-1.5 flex-row flex-wrap gap-2">
          {ROLES.map((r) => (
            <Chip key={r.key} label={t(r.label)} selected={p.roles.includes(r.key)} onPress={() => toggleRole(p, r.key)} />
          ))}
        </View>
        <Label className="mt-3">{t('Lebar kertas')}</Label>
        <View className="mt-1.5" style={{ maxWidth: 240 }}>
          <Tabs
            items={[
              { key: '58', label: '58 mm' },
              { key: '80', label: '80 mm' },
            ]}
            value={String(p.paperWidth) as '58' | '80'}
            onChange={(k) => void patch(p, { paperWidth: k === '80' ? 80 : 58 })}
          />
        </View>
        {res ? (
          <View
            accessibilityLiveRegion="polite"
            className="mt-3 rounded-k px-3 py-2"
            style={{ borderWidth: 1.5, borderColor: res.ok ? colors.ink : colors.errorLine, backgroundColor: res.ok ? colors.pineSoft : colors.errorSoft }}
          >
            <Text className="text-small" style={{ color: res.ok ? colors.ink : colors.error }}>
              {res.text} <Mono className="text-small text-mute">{fmtTime(res.at)}</Mono>
            </Text>
          </View>
        ) : null}
        <ButtonRow className="mt-3">
          <Button variant="danger" label={t('Hapus')} onPress={() => void remove(p)} />
          <Button label={testing === p.id ? t('Mencetak...') : t('Cetak uji')} loading={testing === p.id} disabled={!!testing} onPress={() => void test(p)} />
        </ButtonRow>
      </Card>
    );
  };

  const addCard = (
    <Card>
      <Display size={22}>{t('Tambah printer')}</Display>
      <Text className="mt-1.5 text-small text-mute">
        {t('Pair printer di Bluetooth Android dulu, lalu cari di sini.')}
      </Text>
      <Button className="mt-3" variant="pine" label={scanning ? t('Mencari...') : t('Cari printer Bluetooth')} loading={scanning} onPress={() => void scan()} />
      {devices.map((d) => (
        <Tap
          key={d.address}
          accessibilityRole="button"
          accessibilityLabel={t('Tambah {name}', { name: d.name })}
          onPress={() => void add(d)}
          className="mt-2 min-h-[56px] flex-row items-center gap-3 rounded-k border-k border-ink px-3"
          style={({ pressed }) => ({ backgroundColor: pressed ? colors.tint : colors.paper })}
        >
          <View className="min-w-0 flex-1">
            <Text className="font-body-600 text-body">{d.name || t('Printer Bluetooth')}</Text>
            <Mono className="text-small text-mute">{d.address}</Mono>
          </View>
          <Icon name="plus" size={20} />
        </Tap>
      ))}
    </Card>
  );

  return (
    <View className="flex-1 bg-paper">
      <Header title={t('Printer')} onBack={onBack} onQueue={onQueue} onBell={onBell} />
      <ScrollView contentContainerClassName="gap-3 px-3.5 pb-8 pt-3">
        {wide ? (
          <View className="flex-row gap-3">
            <View className="flex-1 gap-3">{addCard}</View>
            <View className="flex-1 gap-3">{printers.map(card)}</View>
          </View>
        ) : (
          <>
            {addCard}
            {printers.map(card)}
          </>
        )}
        <Text className="text-small text-mute">
          {t(
            'Isi struk diatur pemilik di backoffice, menu Outlet.',
          )}
        </Text>
      </ScrollView>
    </View>
  );
}
