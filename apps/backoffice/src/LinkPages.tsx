import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { message } from './format';
import { useT } from './i18n';
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
  const t = useT();
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
        <p className="brand">Restaurant POS</p>
        <h1>{t('Confirm email')}</h1>
        {state === 'working' && <p className="muted">{t('Confirming…')}</p>}
        {state === 'ok' && <p>{t('Thank you! Your email address is confirmed.')}</p>}
        {state !== 'working' && state !== 'ok' && <p className="error">{t(state)}</p>}
        <button className="primary" onClick={() => leave(onDone)}>
          {t('Continue')}
        </button>
      </div>
    </div>
  );
}

export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const t = useT();
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
        <p className="brand">Restaurant POS</p>
        {done ? (
          <div className="stack">
            <h1>{t('Your password is changed')}</h1>
            <p>{t('Log in with your new password. You have been logged out everywhere else.')}</p>
            <button className="primary" onClick={() => leave(onDone)}>
              {t('Go to login')}
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <h1>{t('Choose a new password')}</h1>
            <label className="field">
              {t('New password (at least 10 characters)')}
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
              {t('Repeat')}
              <input
                type="password"
                required
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
            {repeat && repeat !== password && (
              <p className="error">{t('The passwords do not match.')}</p>
            )}
            {error && <p className="error">{t(error)}</p>}
            <button className="primary" disabled={busy || password !== repeat}>
              {t('Save')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.requestPasswordReset(email))) setSent(true);
  }

  return sent ? (
    <div className="stack">
      <h1>{t('Check your email')}</h1>
      <p>
        {t(
          'If there is an account for {email}, we have sent a link to choose a new password. The link is valid for one hour.',
          { email },
        )}
      </p>
      <button className="secondary" onClick={onBack}>
        {t('Back to login')}
      </button>
    </div>
  ) : (
    <form className="stack" onSubmit={submit}>
      <h1>{t('Forgot password')}</h1>
      <label className="field">
        {t('Email')}
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error && <p className="error">{t(error)}</p>}
      <button className="primary" disabled={busy}>
        {t('Send link')}
      </button>
      <button type="button" className="link" onClick={onBack}>
        {t('Back')}
      </button>
    </form>
  );
}
