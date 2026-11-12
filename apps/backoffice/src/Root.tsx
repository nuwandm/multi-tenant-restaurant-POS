import { useCallback, useEffect, useState } from 'react';
import { api, hasToken, setLoggedOutHandler, type Me } from './api';
import { AuthPages } from './AuthPages';
import { Shell } from './Shell';

export function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(hasToken());

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch {
      setMe(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    setLoggedOutHandler(() => setMe(null));
    if (hasToken()) void refresh();
  }, [refresh]);

  if (checking) return <div className="center-message">Laddar…</div>;
  if (!me) return <AuthPages onLoggedIn={() => void refresh()} />;
  return (
    <Shell
      me={me}
      onChanged={refresh}
      onLogout={() => {
        void api.logout().finally(() => setMe(null));
      }}
    />
  );
}
