import { useCallback, useEffect, useState } from 'react';
import { message } from './format';
import { notifyError } from './notify';

/** Loads data when deps change; reload() fetches again after a change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoad = useCallback(load, deps);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    stableLoad()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(message(err)));
    return () => {
      cancelled = true;
    };
  }, [stableLoad, version]);

  return { data, error, reload: () => setVersion((v) => v + 1) };
}

/**
 * Runs an action, keeping busy and error state. Forms show the error inline; for quick actions
 * in tables pass { toast: true } to show it as a notification instead.
 */
export function useAction(options: { toast?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      if (options.toast) notifyError(message(err));
      else setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}
