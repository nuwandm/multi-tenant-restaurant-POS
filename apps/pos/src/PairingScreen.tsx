import { useState, type FormEvent } from 'react';
import { pairDevice } from './api';
import { LanguageToggle, useT } from './i18n';

interface Props {
  onPaired: () => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** First start on a new tablet: enter the code from the back office to become a register. */
export function PairingScreen({ onPaired }: Props) {
  const t = useT();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pairDevice(code, name || t('Till'));
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
        <LanguageToggle />
        <h1>{t('Pair this device')}</h1>
        <ol className="muted">
          <li>{t('Log in to the back office and open Restaurants & registers.')}</li>
          <li>{t('Press Pair device next to the register this device should be.')}</li>
          <li>{t('Type the code here. It is valid for 15 minutes.')}</li>
        </ol>
        <label className="field">
          {t('Code')}
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
          {t('Device name (optional)')}
          <input
            placeholder={t('e.g. iPad at the bar')}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <button className="primary full" disabled={busy || code.replace(/[\s-]/g, '').length < 8}>
          {busy ? t('Pairing…') : t('Pair')}
        </button>
      </form>
    </div>
  );
}
