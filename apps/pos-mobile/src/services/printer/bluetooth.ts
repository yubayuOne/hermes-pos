import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { t } from '../../i18n';
import { PrinterDevice } from './types';

export interface PairedBluetoothPrinter {
  name: string;
  address: string;
}

const NativePrinter = NativeModules.HermesPosBluetoothPrinter as
  | {
      getPairedDevices: () => Promise<PairedBluetoothPrinter[]>;
      getBluetoothState?: () => Promise<{ available: boolean; enabled: boolean; canReadPaired: boolean }>;
      connect: (address: string) => Promise<void>;
      disconnect: (address: string) => Promise<void>;
      writeBase64: (address: string, data: string) => Promise<void>;
    }
  | undefined;

/** Thrown when Android has not granted Nearby devices. `blocked` means the system will not ask again. */
export class BluetoothPermissionError extends Error {
  constructor(public blocked: boolean) {
    super(
      blocked
        ? t('Izin Perangkat sekitar untuk HERMES POS diblokir. Buka Pengaturan aplikasi, Izin, lalu izinkan Perangkat sekitar.')
        : t('Izin Bluetooth ditolak. Izinkan Perangkat sekitar untuk HERMES POS di Pengaturan Android.'),
    );
    this.name = 'BluetoothPermissionError';
  }
}

/**
 * Android 12+ needs only BLUETOOTH_CONNECT to list paired printers and print. BLUETOOTH_SCAN is not requested:
 * it is not declared in the manifest, and Android answers an undeclared permission with "denied" right away.
 */
export async function requestBluetoothPermission(): Promise<'granted' | 'denied' | 'blocked'> {
  if (Platform.OS !== 'android') return 'denied';
  if (Number(Platform.Version) < 31) return 'granted';
  const perm = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(perm)) return 'granted';
  const r = await PermissionsAndroid.request(perm, {
    title: t('Izinkan Perangkat sekitar'),
    message: t('HERMES POS perlu izin ini untuk menemukan dan mencetak ke printer Bluetooth yang sudah di-pair.'),
    buttonPositive: t('Izinkan'),
    buttonNegative: t('Nanti'),
  });
  if (r === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
}

/** The native module rejects with Indonesian text (HermesPosBluetoothPrinterModule.kt); translate it here. */
const native = <T>(call: Promise<T>) =>
  call.catch((e: { message?: string }) => {
    throw new Error(t(e?.message ?? String(e)));
  });

async function ensurePermission() {
  const state = await requestBluetoothPermission();
  if (state !== 'granted') throw new BluetoothPermissionError(state === 'blocked');
}

export async function getPairedBluetoothPrinters(): Promise<PairedBluetoothPrinter[]> {
  if (!NativePrinter) throw new Error(t('Modul printer Bluetooth belum ada di aplikasi ini. Pasang APK HERMES POS terbaru.'));
  await ensurePermission();
  const devices = await native(NativePrinter.getPairedDevices());
  return devices ?? [];
}

export async function writeBluetooth(printer: PrinterDevice, data: Uint8Array) {
  if (!NativePrinter || !printer.address) throw new Error(t('Modul printer Bluetooth belum ada di aplikasi ini. Pasang APK HERMES POS terbaru.'));
  await ensurePermission();
  await native(NativePrinter.connect(printer.address));
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, Math.min(i + chunk, data.length)));
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    base64 +=
      chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (i + 1 < binary.length ? chars[(n >> 6) & 63] : '=') + (i + 2 < binary.length ? chars[n & 63] : '=');
  }
  await native(NativePrinter.writeBase64(printer.address, base64));
}
