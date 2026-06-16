"use client";

import { useEffect, useState } from "react";

/**
 * Like `useState<string>` but persists the value to `localStorage` under `key`
 * so user-entered settings survive page reloads and tool switches.
 *
 * Only non-sensitive user configuration (e.g. entitlement/budget figures) should
 * be stored here - never uploaded report data, which must stay in memory.
 */
export function usePersistentState(
  key: string,
  initialValue = "",
): [string, React.Dispatch<React.SetStateAction<string>>] {
  // Read synchronously on first client render; on the server fall back to the
  // initial value since `localStorage` isn't available there.
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initialValue;
    return window.localStorage.getItem(key) ?? initialValue;
  });

  useEffect(() => {
    window.localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue];
}
