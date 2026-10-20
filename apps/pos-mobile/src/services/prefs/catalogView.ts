import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Catalog look per device (PRD C1a): Ringkas or Foto, saved under @hermes-pos/catalog-view once the cashier picks one.
 * Until then the phone shows Foto as soon as any product has a photo (owner's decision, 21 Oct 2026).
 */
export type CatalogView = 'compact' | 'photo';
const KEY = '@hermes-pos/catalog-view';
let chosen: CatalogView | null = null;
let hasImages = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const resolveCatalogView = (choice: CatalogView | null, images: boolean): CatalogView => choice ?? (images ? 'photo' : 'compact');

AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === 'photo' || v === 'compact') {
      chosen = v;
      emit();
    }
  })
  .catch(() => undefined);

export function setCatalogView(v: CatalogView) {
  chosen = v;
  emit();
  void AsyncStorage.setItem(KEY, v).catch(() => undefined);
}

/** Called by the app store whenever the catalog changes. */
export function setCatalogHasImages(v: boolean) {
  if (v === hasImages) return;
  hasImages = v;
  emit();
}

const current = () => resolveCatalogView(chosen, hasImages);

export function useCatalogView(): CatalogView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    current,
    current,
  );
}
