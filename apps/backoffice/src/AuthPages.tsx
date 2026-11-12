import { useState, type FormEvent } from 'react';
import { api } from './api';
import { LanguageToggle, useT } from './i18n';
import { ForgotPasswordForm } from './LinkPages';
import { useAction } from './useLoad';

interface Props {
  onLoggedIn: () => void;
}

export function AuthPages({ onLoggedIn }: Props) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-top">
          <p className="brand">Restaurant POS</p>
          <LanguageToggle />
        </div>
        {mode === 'login' && (
          <LoginForm
            onLoggedIn={onLoggedIn}
            onSignup={() => setMode('signup')}
            onForgot={() => setMode('forgot')}
          />
        )}
        {mode === 'signup' && (
          <SignupForm onLoggedIn={onLoggedIn} onLogin={() => setMode('login')} />
        )}
        {mode === 'forgot' && <ForgotPasswordForm onBack={() => setMode('login')} />}
      </div>
    </div>
  );
}

function LoginForm({
  onLoggedIn,
  onSignup,
  onForgot,
}: Props & { onSignup: () => void; onForgot: () => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.login(email, password))) onLoggedIn();
  }

  return (
    <form onSubmit={submit} className="stack">
      <h1>{t('Log in')}</h1>
      <label className="field">
        {t('Email')}
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        {t('Password')}
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="error">{t(error)}</p>}
      <button className="primary" disabled={busy}>
        {busy ? t('Logging in…') : t('Log in')}
      </button>
      <p className="muted center">
        <button type="button" className="link" onClick={onForgot}>
          {t('Forgot password?')}
        </button>
      </p>
      <p className="muted center">
        {t('New restaurant?')}{' '}
        <button type="button" className="link" onClick={onSignup}>
          {t('Register your company')}
        </button>
      </p>
    </form>
  );
}

function SignupForm({ onLoggedIn, onLogin }: Props & { onLogin: () => void }) {
  const t = useT();
  const [form, setForm] = useState({
    ownerName: '',
    email: '',
    password: '',
    legalName: '',
    orgNumber: '',
    restaurantName: '',
    restaurantAddress: '',
  });
  const { busy, error, run } = useAction();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { restaurantAddress, ...rest } = form;
    if (await run(() => api.signup({ ...rest, ...(restaurantAddress && { restaurantAddress }) }))) {
      onLoggedIn();
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <h1>{t('Register your company')}</h1>
      <p className="muted">
        {t(
          'You can set up menu, staff and registers right away. The registers can sell once we have approved the company.',
        )}
      </p>
      <fieldset>
        <legend>{t('You')}</legend>
        <label className="field">
          {t('Name')}
          <input required value={form.ownerName} onChange={set('ownerName')} />
        </label>
        <label className="field">
          {t('Email')}
          <input
            type="email"
            required
            autoComplete="username"
            value={form.email}
            onChange={set('email')}
          />
        </label>
        <label className="field">
          {t('Password (at least 10 characters)')}
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>{t('Company')}</legend>
        <label className="field">
          {t('Company name')}
          <input
            required
            placeholder={t('Example Restaurant AB')}
            value={form.legalName}
            onChange={set('legalName')}
          />
        </label>
        <label className="field">
          {t('Organisation number')}
          <input
            required
            placeholder="556677-8899"
            value={form.orgNumber}
            onChange={set('orgNumber')}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>{t('First restaurant')}</legend>
        <label className="field">
          {t('Name')}
          <input required value={form.restaurantName} onChange={set('restaurantName')} />
        </label>
        <label className="field">
          {t('Address (optional)')}
          <input value={form.restaurantAddress} onChange={set('restaurantAddress')} />
        </label>
      </fieldset>
      {error && <p className="error">{t(error)}</p>}
      <button className="primary" disabled={busy}>
        {busy ? t('Registering…') : t('Register')}
      </button>
      <p className="muted center">
        {t('Already have an account?')}{' '}
        <button type="button" className="link" onClick={onLogin}>
          {t('Log in')}
        </button>
      </p>
    </form>
  );
}
