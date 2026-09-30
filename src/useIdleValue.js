import { useEffect, useState } from "react";

/**
 * Computes an expensive value when the browser is idle (keeps the previous
 * value while recomputing, so there is no flicker).
 */
export default function useIdleValue(compute, deps) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const run = () => !cancelled && setValue(compute());
    const idle = typeof window.requestIdleCallback === "function";
    const id = idle
      ? window.requestIdleCallback(run, { timeout: 300 })
      : setTimeout(run, 16);
    return () => {
      cancelled = true;
      idle ? window.cancelIdleCallback(id) : clearTimeout(id);
    };
  }, deps);
  return value;
}
