import { useCallback, useEffect, useRef } from "react";

export interface UsePollingOptions {
  intervalMs: number;
  enabled?: boolean;
  /** Separate requests by key, e.g. selected robot id. */
  key?: string;
}

/**
 * Run an async refresh immediately and then on an interval without overlapping
 * the same keyed request. Changing keys allows the new selection to load while
 * an older request is still settling.
 */
export function usePolling(
  task: () => Promise<unknown> | void,
  { intervalMs, enabled = true, key = "default" }: UsePollingOptions,
): () => Promise<void> {
  const taskRef = useRef(task);
  const inFlightRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();

    const active = inFlightRef.current.get(key);
    if (active) return active;

    const request = Promise.resolve()
      .then(() => taskRef.current())
      .then(() => undefined)
      .finally(() => {
        if (inFlightRef.current.get(key) === request) {
          inFlightRef.current.delete(key);
        }
      });
    inFlightRef.current.set(key, request);
    return request;
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    if (intervalMs <= 0) return;

    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return refresh;
}
