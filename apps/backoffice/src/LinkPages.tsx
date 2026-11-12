import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { message } from './format';
import { useAction } from './useLoad';

/** Pages opened from email links: #/verify?token=… and #/reset?token=… */
export function linkFromHash(): { page: 'verify' | 'reset'; token: string } | null {
  const match = /^#\/(verify|reset)\?token=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  return match ? { page: match[1] as 'verify' | 'reset', token: match[2]! } : null;
}

function leave(onDone: () => void) {
  window.location.hash = '#/overview';
  onDone();
}

export function VerifyEmailPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, setState] = useState<'working' | 'ok' | string>('working');

  useEffect(() => {
    api
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err: unknown) => setState(message(err)));
  }, [token]);

  return (
    <div className="auth">
      <div className="auth-card stack">
        <p className="brand">Restaurang POS</p>
        <h1>Bekräfta e-post</h1>
        {state === 'working' && <p className="muted">Bekräftar…</p>}
        {state === 'ok' && <p>Tack! Din e-postadress är bekräftad.</p>}
        {state !== 'working' && state !== 'ok' && <p className="error">{state}</p>}
        <button className="primary" onClick={() => leave(onDone)}>
          Fortsätt
        </button>
      </div>
    </div>
  );
}

export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.confirmPasswordReset(token, password))) setDone(true);
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <p className="brand">Restaurang POS</p>
        {done ? (
          <div className="stack">
            <h1>Lösenordet är bytt</h1>
            <p>Logga in med ditt nya lösenord. Du har loggats ut överallt annars.</p>
            <button className="primary" onClick={() => leave(onDone)}>
              Till inloggningen
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <h1>Välj nytt lösenord</h1>
            <label className="field">
              Nytt lösenord (minst 10 tecken)
              <input
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              Upprepa
              <input
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
            {repeat && repeat !== password && <p className="error">Lösenorden är inte lika.</p>}
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy || password !== repeat}>
              Spara
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.requestPasswordReset(email))) setSent(true);
  }

  return sent ? (
    <div className="stack">
      <h1>Kolla din e-post</h1>
      <p>
        Om det finns ett konto för {email} har vi skickat en länk för att välja nytt lösenord.
        Länken gäller i en timme.
      </p>
      <button className="secondary" onClick={onBack}>
        Tillbaka till inloggningen
      </button>
    </div>
  ) : (
    <form className="stack" onSubmit={submit}>
      <h1>Glömt lösenord</h1>
      <label className="field">
        E-post
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        Skicka länk
      </button>
      <button type="button" className="link" onClick={onBack}>
        Tillbaka
      </button>
    </form>
  );
}
