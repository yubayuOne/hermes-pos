import { useSyncExternalStore } from 'react';
import { addNetworkStateListener, getNetworkStateAsync, NetworkState } from 'expo-network';

/**
 * Whether the phone has internet, from Android's network state. Offline, requests fail at once instead of waiting for
 * the 15 s timeout, and the queue is sent as soon as the connection comes back. Unknown counts as online: a wrong
 * "online" only costs the timeout, a wrong "offline" would block every request.
 */
let online = true;
const listeners = new Set<() => void>();

function apply(s: NetworkState) {
  const next = s.isConnected !== false && s.isInternetReachable !== false;
  if (next === online) return;
  online = next;
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a listener must not break the others */
    }
  });
}

getNetworkStateAsync().then(apply, () => undefined);
addNetworkStateListener(apply);

export const isOnline = () => online;

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useOnline = () => useSyncExternalStore(subscribeNetwork, isOnline, isOnline);
