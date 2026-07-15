"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tracks the user's `prefers-reduced-motion` setting so animations (e.g. the
 * Recharts graph transitions) can be disabled for those who opt out. Starts
 * `false` on the server/first paint and updates once mounted to avoid hydration
 * mismatches.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mql = window.matchMedia(QUERY);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
