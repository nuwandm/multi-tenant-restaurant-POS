import { useCallback, useEffect, useState } from 'react';
import { api, hasToken, setLoggedOutHandler, type Me } from './api';
import { AuthPages } from './AuthPages';
import { linkFromHash, ResetPasswordPage, VerifyEmailPage } from './LinkPages';
import { useT } from './i18n';
import { Shell } from './Shell';

export function Root() {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(hasToken());
  const [link, setLink] = useState(linkFromHash);

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

  // Email links work whether or not the user is logged in.
  if (link?.page === 'verify') {
    return (
      <VerifyEmailPage
        token={link.token}
        onDone={() => {
          setLink(null);
          void refresh();
        }}
      />
    );
  }
  if (link?.page === 'reset') {
    return <ResetPasswordPage token={link.token} onDone={() => setLink(null)} />;
  }
  if (checking) return <div className="center-message">{t('Loading…')}</div>;
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
