import {
  Alert,
  Anchor,
  Button,
  Divider,
  Group,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { api } from './api';
import { AuthLayout } from './AuthLayout';
import { useT } from './i18n';
import { ForgotPasswordForm } from './LinkPages';
import { useAction } from './useLoad';

interface Props {
  onLoggedIn: () => void;
}

export function AuthPages({ onLoggedIn }: Props) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  return (
    <AuthLayout>
      {mode === 'login' && (
        <LoginForm
          onLoggedIn={onLoggedIn}
          onSignup={() => setMode('signup')}
          onForgot={() => setMode('forgot')}
        />
      )}
      {mode === 'signup' && <SignupForm onLoggedIn={onLoggedIn} onLogin={() => setMode('login')} />}
      {mode === 'forgot' && <ForgotPasswordForm onBack={() => setMode('login')} />}
    </AuthLayout>
  );
}

export function FormError({ error }: { error: string | null }) {
  const t = useT();
  if (!error) return null;
  return (
    <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
      {t(error)}
    </Alert>
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
    <form onSubmit={submit}>
      <Stack gap="md">
        <div>
          <Title order={2} fz={26} lts={-0.3}>
            {t('Welcome back')}
          </Title>
          <Text c="dimmed" fz="sm" mt={4}>
            {t('Log in to manage your restaurants.')}
          </Text>
        </div>
        <TextInput
          label={t('Email')}
          type="email"
          autoComplete="username"
          required
          size="md"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <PasswordInput
          label={t('Password')}
          autoComplete="current-password"
          required
          size="md"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <Group justify="flex-end" mt={-6}>
          <Anchor component="button" type="button" fz="sm" onClick={onForgot}>
            {t('Forgot password?')}
          </Anchor>
        </Group>
        <FormError error={error} />
        <Button type="submit" size="md" loading={busy}>
          {t('Log in')}
        </Button>
        <Divider label={t('New restaurant?')} labelPosition="center" />
        <Button variant="default" size="md" onClick={onSignup}>
          {t('Register your company')}
        </Button>
      </Stack>
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
  // Read the value now: React clears currentTarget before a state updater runs.
  const set = (key: keyof typeof form) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { restaurantAddress, ...rest } = form;
    if (await run(() => api.signup({ ...rest, ...(restaurantAddress && { restaurantAddress }) }))) {
      onLoggedIn();
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="md">
        <div>
          <Title order={2} fz={26} lts={-0.3}>
            {t('Register your company')}
          </Title>
          <Text c="dimmed" fz="sm" mt={4}>
            {t(
              'You can set up menu, staff and registers right away. The registers can sell once we have approved the company.',
            )}
          </Text>
        </div>

        <Divider label={t('You')} labelPosition="left" />
        <TextInput label={t('Name')} required value={form.ownerName} onChange={set('ownerName')} />
        <TextInput
          label={t('Email')}
          type="email"
          required
          autoComplete="username"
          value={form.email}
          onChange={set('email')}
        />
        <PasswordInput
          label={t('Password')}
          description={t('At least 10 characters')}
          required
          minLength={10}
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
        />

        <Divider label={t('Company')} labelPosition="left" mt="xs" />
        <TextInput
          label={t('Company name')}
          required
          placeholder={t('Example Restaurant AB')}
          value={form.legalName}
          onChange={set('legalName')}
        />
        <TextInput
          label={t('Organisation number')}
          required
          placeholder="556677-8899"
          value={form.orgNumber}
          onChange={set('orgNumber')}
        />

        <Divider label={t('First restaurant')} labelPosition="left" mt="xs" />
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          <TextInput
            label={t('Name')}
            required
            value={form.restaurantName}
            onChange={set('restaurantName')}
          />
          <TextInput
            label={t('Address (optional)')}
            value={form.restaurantAddress}
            onChange={set('restaurantAddress')}
          />
        </SimpleGrid>

        <FormError error={error} />
        <Button type="submit" size="md" loading={busy}>
          {t('Create account')}
        </Button>
        <Text fz="sm" c="dimmed" ta="center">
          {t('Already have an account?')}{' '}
          <Anchor component="button" type="button" onClick={onLogin}>
            {t('Log in')}
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
