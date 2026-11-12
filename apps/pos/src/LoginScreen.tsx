import { useEffect, useState } from 'react';
import { login, type DeviceInfo, type Staff } from './api';
import { LanguageToggle, useT } from './i18n';

interface Props {
  device: DeviceInfo;
  onLoggedIn: (staff: Staff) => void;
}

const ROLE_LABELS: Record<Staff['role'], string> = {
  owner: 'Owner',
  manager: 'Manager',
  cashier: 'Cashier',
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
const MAX_PIN = 8;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Pick your name, then enter your PIN on the keypad (or the keyboard). */
export function LoginScreen({ device: info, onLoggedIn }: Props) {
  const t = useT();
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function press(key: string) {
    setError(null);
    if (key === 'C') setPin('');
    else if (key === '⌫') setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length < MAX_PIN ? p + key : p));
  }

  async function submit() {
    if (!selected || pin.length < 4 || busy) return;
    setBusy(true);
    try {
      onLoggedIn(await login(selected.userId, pin));
    } catch (err) {
      setError(message(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  // Physical keyboard support for desktops.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') void submit();
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="login">
      <header className="login-header">
        <LanguageToggle />
        <h1>{info.restaurant.name}</h1>
        <p className="muted">
          {info.company.legalName} · {t('Register {name}', { name: info.register.designation })} ·{' '}
          {info.device.name}
        </p>
        {info.company.status === 'pending' && (
          <p className="notice">
            {t('The company is waiting for approval. You can log in and train, but not sell yet.')}
          </p>
        )}
      </header>

      {!selected ? (
        <>
          <h2>{t('Who are you?')}</h2>
          {info.staff.length === 0 && (
            <p className="muted">{t('No staff with a PIN. Add staff in the back office.')}</p>
          )}
          <div className="staff-grid">
            {info.staff.map((s) => (
              <button
                key={s.userId}
                type="button"
                className="staff-tile"
                onClick={() => {
                  setSelected(s);
                  setPin('');
                  setError(null);
                }}
              >
                <span className="avatar" aria-hidden="true">
                  {s.displayName.slice(0, 1)}
                </span>
                <span className="staff-name">{s.displayName}</span>
                <span className="muted small">{t(ROLE_LABELS[s.role])}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="pin-panel">
          <button type="button" className="link" onClick={() => setSelected(null)}>
            {t('← Change person')}
          </button>
          <h2>{t('Hi {name}, enter your PIN', { name: selected.displayName })}</h2>
          <div className="pin-dots" aria-label={t('{count} digits entered', { count: pin.length })}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={i < pin.length ? 'filled' : ''} />
            ))}
          </div>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                aria-label={k === '⌫' ? t('Delete') : k === 'C' ? t('Clear') : k}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="primary full"
            disabled={pin.length < 4 || busy}
            onClick={submit}
          >
            {busy ? t('Logging in…') : t('Log in')}
          </button>
        </div>
      )}
    </div>
  );
}
