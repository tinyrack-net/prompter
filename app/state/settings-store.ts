import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS,
  loadRecent,
  loadSettings,
  RECENT_STORAGE_KEY,
  type RecentDocument,
  SETTINGS_STORAGE_KEY,
  type Settings,
  sanitizeSettings,
  saveSettings,
} from '~core/settings.ts';

type Listener = () => void;

/**
 * A tiny observable value persisted to localStorage. During server rendering
 * there is no storage, so the server snapshot is the default value; the
 * browser switches to the stored value after hydration.
 */
function createStore<T>(options: {
  key: string;
  load: () => T;
  save?: (value: T) => void;
  serverValue: T;
}) {
  let value: T | undefined;
  const listeners = new Set<Listener>();

  const get = (): T => {
    if (value === undefined) value = options.load();
    return value;
  };

  const set = (next: T) => {
    value = next;
    options.save?.(next);
    for (const l of listeners) l();
  };

  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    // Keep other tabs in sync.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== options.key) return;
      value = options.load();
      listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  };

  const getServer = () => options.serverValue;

  return { get, set, subscribe, getServer };
}

const settingsStore = createStore<Settings>({
  key: SETTINGS_STORAGE_KEY,
  load: loadSettings,
  save: saveSettings,
  serverValue: DEFAULT_SETTINGS,
});

const recentStore = createStore<RecentDocument[]>({
  key: RECENT_STORAGE_KEY,
  load: loadRecent,
  serverValue: [],
});

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.get,
    settingsStore.getServer,
  );
  const update = (patch: Partial<Settings>) =>
    settingsStore.set(sanitizeSettings({ ...settingsStore.get(), ...patch }));
  return [settings, update];
}

export function useRecentDocuments(): [RecentDocument[], (next: RecentDocument[]) => void] {
  const recent = useSyncExternalStore(
    recentStore.subscribe,
    recentStore.get,
    recentStore.getServer,
  );
  return [recent, recentStore.set];
}
