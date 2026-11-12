import { useCallback, useEffect, useState } from 'react';
import { message } from './format';

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

/** Runs an action, keeping busy and error state for a form or button. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}
