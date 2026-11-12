import { useEffect, useState } from 'react';
import { getLoginInfo, login, type LoginInfo, type Staff } from './api';

interface Props {
  onLoggedIn: (staff: Staff) => void;
}

const ROLE_LABELS: Record<Staff['role'], string> = {
  owner: 'Ägare',
  manager: 'Chef',
  cashier: 'Kassör',
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
const MAX_PIN = 8;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Pick your name, then enter your PIN on the keypad (or the keyboard). */
export function LoginScreen({ onLoggedIn }: Props) {
  const [info, setInfo] = useState<LoginInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLoginInfo()
      .then(setInfo)
      .catch((err: unknown) => setLoadError(message(err)));
  }, []);

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

  if (loadError) {
    return (
      <div className="center-message">
        <h1>Kassan kunde inte startas</h1>
        <p>{loadError}</p>
      </div>
    );
  }
  if (!info) return <div className="center-message">Laddar…</div>;

  return (
    <div className="login">
      <header className="login-header">
        <h1>{info.restaurant.name}</h1>
        <p className="muted">Kassa {info.register.designation}</p>
      </header>

      {!selected ? (
        <>
          <h2>Vem är du?</h2>
          {info.staff.length === 0 && (
            <p className="muted">Ingen personal med PIN-kod. Lägg till personal i back office.</p>
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
                <span className="muted small">{ROLE_LABELS[s.role]}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="pin-panel">
          <button type="button" className="link" onClick={() => setSelected(null)}>
            ← Byt person
          </button>
          <h2>Hej {selected.displayName}, ange PIN-kod</h2>
          <div className="pin-dots" aria-label={`${pin.length} siffror inmatade`}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={i < pin.length ? 'filled' : ''} />
            ))}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => press(k)}
                aria-label={k === '⌫' ? 'Radera' : k === 'C' ? 'Rensa' : k}
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
            {busy ? 'Loggar in…' : 'Logga in'}
          </button>
        </div>
      )}
    </div>
  );
}
