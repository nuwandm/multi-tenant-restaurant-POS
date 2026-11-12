import { useState, type FormEvent } from 'react';
import { api } from './api';
import { useAction } from './useLoad';

interface Props {
  onLoggedIn: () => void;
}

export function AuthPages({ onLoggedIn }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  return (
    <div className="auth">
      <div className="auth-card">
        <p className="brand">Restaurang POS</p>
        {mode === 'login' ? (
          <LoginForm onLoggedIn={onLoggedIn} onSignup={() => setMode('signup')} />
        ) : (
          <SignupForm onLoggedIn={onLoggedIn} onLogin={() => setMode('login')} />
        )}
      </div>
    </div>
  );
}

function LoginForm({ onLoggedIn, onSignup }: Props & { onSignup: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api.login(email, password))) onLoggedIn();
  }

  return (
    <form onSubmit={submit} className="stack">
      <h1>Logga in</h1>
      <label className="field">
        E-post
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        Lösenord
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? 'Loggar in…' : 'Logga in'}
      </button>
      <p className="muted center">
        Ny restaurang?{' '}
        <button type="button" className="link" onClick={onSignup}>
          Registrera ditt företag
        </button>
      </p>
    </form>
  );
}

function SignupForm({ onLoggedIn, onLogin }: Props & { onLogin: () => void }) {
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
      <h1>Registrera ditt företag</h1>
      <p className="muted">
        Du kan lägga upp meny, personal och kassor direkt. Kassorna kan sälja när vi har godkänt
        företaget.
      </p>
      <fieldset>
        <legend>Du</legend>
        <label className="field">
          Namn
          <input required value={form.ownerName} onChange={set('ownerName')} />
        </label>
        <label className="field">
          E-post
          <input
            type="email"
            required
            autoComplete="username"
            value={form.email}
            onChange={set('email')}
          />
        </label>
        <label className="field">
          Lösenord (minst 10 tecken)
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
        <legend>Företaget</legend>
        <label className="field">
          Företagsnamn
          <input
            required
            placeholder="Exempel Restaurang AB"
            value={form.legalName}
            onChange={set('legalName')}
          />
        </label>
        <label className="field">
          Organisationsnummer
          <input
            required
            placeholder="556677-8899"
            value={form.orgNumber}
            onChange={set('orgNumber')}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Första restaurangen</legend>
        <label className="field">
          Namn
          <input required value={form.restaurantName} onChange={set('restaurantName')} />
        </label>
        <label className="field">
          Adress (valfritt)
          <input value={form.restaurantAddress} onChange={set('restaurantAddress')} />
        </label>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {busy ? 'Registrerar…' : 'Registrera'}
      </button>
      <p className="muted center">
        Har du redan ett konto?{' '}
        <button type="button" className="link" onClick={onLogin}>
          Logga in
        </button>
      </p>
    </form>
  );
}
