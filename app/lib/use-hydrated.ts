import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False during server rendering and the hydration pass, true afterwards.
 * Browser-only values (speech support, fullscreen, browser language) are
 * read only once this is true, so server and client markup always match.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
