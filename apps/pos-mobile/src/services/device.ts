import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { Shift } from '../types/domain';

/**
 * This phone's id (migration 051): made once at install, sent as x-device-id on every request. A shift belongs to the
 * phone that opened it; another phone cannot write into or close it. Kept across sign-outs on purpose: the same phone
 * stays the same phone. A reinstall makes a new id; the owner moves the shift over with the approval code.
 */
const KEY = '@hermes-pos/device-id';
let loaded: string | null = null;
let loading: Promise<string> | null = null;

export function deviceId(): Promise<string> {
  if (!loading)
    loading = (async () => {
      const saved = await AsyncStorage.getItem(KEY).catch(() => null);
      const id = saved || randomUUID();
      if (!saved) await AsyncStorage.setItem(KEY, id).catch(() => undefined);
      loaded = id;
      return id;
    })();
  return loading;
}

/** True when the shift was opened on another phone (only known once this phone's id is loaded). */
export const onOtherDevice = (shift: Pick<Shift, 'deviceId'> | null) => !!shift?.deviceId && !!loaded && shift.deviceId !== loaded;
