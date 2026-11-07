import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { toast } from '../components/overlays';

/** Loads data on mount (and when `deps` change); exposes `reload` for after mutations. */
export function useApi<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}

/** Runs a mutation, surfacing its error and refreshing data on success. An optional message confirms it with a toast. */
export function useAction(onSuccess?: () => unknown) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successMessage?: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await onSuccess?.();
        if (successMessage) toast(successMessage);
        return true;
      } catch (err) {
        setError(errorMessage(err));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSuccess],
  );

  return { run, error, busy, clearError: () => setError(null) };
}
