import { useState, type FormEvent } from 'react';
import { pairDevice } from './api';

interface Props {
  onPaired: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** First start on a new tablet: enter the code from the back office to become a register. */
export function PairingScreen({ onPaired }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairDevice(code, name || 'Kassa');
      onPaired();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="pairing" onSubmit={submit}>
        <h1>Koppla den här enheten</h1>
        <ol className="muted">
          <li>
            Logga in i back office och öppna <strong>Restauranger &amp; kassor</strong>.
          </li>
          <li>
            Tryck <strong>Koppla enhet</strong> vid kassan som den här enheten ska vara.
          </li>
          <li>Skriv in koden här. Den gäller i 15 minuter.</li>
        </ol>
        <label className="field">
          Kod
          <input
            className="code-input"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="XXXX-XXXX"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          Namn på enheten (valfritt)
          <input
            placeholder="t.ex. iPad vid baren"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy || code.replace(/[\s-]/g, '').length < 8}>
          {busy ? 'Kopplar…' : 'Koppla'}
        </button>
      </form>
    </div>
  );
}
