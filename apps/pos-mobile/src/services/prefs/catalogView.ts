import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Catalog look per device (PRD C1a): Ringkas (default) or Foto. Saved under @hermes-pos/catalog-view. */
export type CatalogView = 'compact' | 'photo';
const KEY = '@hermes-pos/catalog-view';
let value: CatalogView = 'compact';
const listeners = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === 'photo' || v === 'compact') {
      value = v;
      listeners.forEach((l) => l());
    }
  })
  .catch(() => undefined);

export function setCatalogView(v: CatalogView) {
  value = v;
  listeners.forEach((l) => l());
  void AsyncStorage.setItem(KEY, v).catch(() => undefined);
}

export function useCatalogView(): CatalogView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => value,
    () => value,
  );
}
